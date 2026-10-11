import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { looksLikeCardNumber, type ModerationDecision, type ReportReason } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { HotReviewService } from '../hot-deals/hot-review.service';
import { DealReviewService } from '../live-deals/deal-review.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { VoucherReviewService } from '../vouchers/voucher-review.service';
import { WatchReviewService } from '../watch/watch-review.service';
import { D, opsConfig } from './ops-util';

type ReviewRow = Prisma.ReviewGetPayload<object>;
const VISIBLE = ['PUBLISHED', 'REPORTED'];

/**
 * Reviews and content moderation (MR-52 / FDC-05). Only signed-in customers review; a review is "Verified" only when DealDash holds
 * evidence of a tracked merchant interaction (a voucher redemption or a redeemed Exclusive Deal reservation; a controlled-offer
 * redemption when that product is enabled). Watch & Earn viewing never qualifies. Anyone may report a review; merchants report
 * reviews about them; DealDash moderators approve, hide, restore or remove with a reason and audit. Reported campaign / merchant /
 * media content goes to the same queue; hiding a campaign uses the engine's own suspension (and restoring its reinstatement).
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  publicView(r: ReviewRow, names: Map<string, string>) {
    return {
      id: r.id,
      merchantOrganizationId: r.merchantOrganizationId,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      rating: r.rating,
      text: r.text,
      locale: r.locale,
      verified: r.verified,
      // only a first name: reviews never expose who the customer is beyond that
      author: names.get(r.customerUserId) ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  adminView(r: ReviewRow) {
    return {
      ...this.publicView(r, new Map()),
      status: r.status,
      customerUserId: r.customerUserId,
      verifiedInteractionType: r.verifiedInteractionType,
      verifiedInteractionId: r.verifiedInteractionId,
      reportCount: r.reportCount,
      moderatedByUserId: r.moderatedByUserId,
      moderatedAt: r.moderatedAt?.toISOString() ?? null,
      moderationReason: r.moderationReason,
    };
  }

  private async firstNames(userIds: string[]) {
    const rows = await this.prisma.customer.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, firstName: true },
    });
    return new Map(rows.filter((r) => r.firstName).map((r) => [r.userId, r.firstName!]));
  }

  /** The evidence that makes a review Verified (newest qualifying interaction), or null. Watch & Earn is never evidence. */
  async evidence(customerUserId: string, merchantOrganizationId: string) {
    const v = await this.prisma.voucherRedemption.findFirst({
      where: {
        organizationId: merchantOrganizationId,
        status: 'REDEEMED',
        instance: { ownerUserId: customerUserId },
      },
      orderBy: { redeemedAt: 'desc' },
      select: { id: true },
    });
    if (v) return { type: 'VOUCHER_REDEMPTION' as const, id: v.id };
    const e = await this.prisma.redemption.findFirst({
      where: {
        organizationId: merchantOrganizationId,
        status: 'REDEEMED',
        reservation: { userId: customerUserId },
      },
      orderBy: { redeemedAt: 'desc' },
      select: { id: true },
    });
    if (e) return { type: 'EXCLUSIVE_REDEMPTION' as const, id: e.id };
    return null;
  }

  async listForMerchant(merchantOrganizationId: string, opts: { all?: boolean } = {}) {
    const rows = await this.prisma.review.findMany({
      where: {
        merchantOrganizationId,
        ...(opts.all ? { status: { not: 'REMOVED' } } : { status: { in: VISIBLE } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const names = await this.firstNames(rows.map((r) => r.customerUserId));
    const visible = rows.filter((r) => VISIBLE.includes(r.status));
    return {
      summary: {
        count: visible.length,
        verified: visible.filter((r) => r.verified).length,
        average: visible.length
          ? Math.round((visible.reduce((n, r) => n + r.rating, 0) / visible.length) * 10) / 10
          : null,
      },
      items: rows.map((r) =>
        opts.all
          ? { ...this.publicView(r, names), status: r.status, reportCount: r.reportCount }
          : this.publicView(r, names),
      ),
    };
  }

  /** A signed-in customer writes a review (one per merchant per configured period). */
  async create(
    actor: Actor,
    merchantOrganizationId: string,
    b: {
      rating: number;
      text: string;
      locale?: string;
      subjectType?: string;
      subjectId?: string | null;
    },
    meta: RequestMeta,
  ) {
    const cfg = await opsConfig(this.config);
    const org = await this.prisma.organization.findFirst({
      where: { id: merchantOrganizationId, type: 'MERCHANT', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!org) throw AppError.notFound();
    if (b.text.trim().length < cfg.reviews.minTextLength)
      throw AppError.validation(`Write at least ${cfg.reviews.minTextLength} characters`, 'text');
    if (looksLikeCardNumber(b.text))
      throw new AppError('CARD_DATA_FORBIDDEN', 'Remove the card number from your review', 422);
    const since = new Date(Date.now() - cfg.reviews.perMerchantDays * D);
    if (
      await this.prisma.review.count({
        where: {
          customerUserId: actor.userId,
          merchantOrganizationId,
          createdAt: { gte: since },
          status: { not: 'REMOVED' },
        },
      })
    )
      throw new AppError(
        'REVIEW_LIMIT_REACHED',
        `You can review this merchant again after ${cfg.reviews.perMerchantDays} days`,
        409,
      );
    const ev = await this.evidence(actor.userId, merchantOrganizationId);
    const status = cfg.reviews.mode === 'PRE_MODERATION' ? 'PENDING_REVIEW' : 'PUBLISHED';
    const r = await this.prisma.$transaction(async (tx) => {
      const row = await tx.review.create({
        data: {
          merchantOrganizationId,
          customerUserId: actor.userId,
          subjectType: b.subjectType ?? 'MERCHANT',
          subjectId: b.subjectId ?? null,
          rating: b.rating,
          text: b.text.trim(),
          locale: b.locale ?? 'en',
          status,
          verified: !!ev,
          verifiedInteractionType: ev?.type ?? null,
          verifiedInteractionId: ev?.id ?? null,
        },
      });
      if (status === 'PENDING_REVIEW')
        await tx.moderationItem.create({
          data: {
            subjectType: 'REVIEW',
            subjectId: row.id,
            organizationId: merchantOrganizationId,
            status: 'PENDING_REVIEW',
            source: 'SYSTEM',
          },
        });
      await this.audit.record(
        {
          action: 'REVIEW_CREATED',
          entityType: 'Review',
          entityId: row.id,
          actor,
          subjectOrganizationId: merchantOrganizationId,
          newState: { rating: b.rating, verified: !!ev, status },
          meta,
        },
        tx,
      );
      return row;
    });
    return this.publicView(r, await this.firstNames([actor.userId]));
  }

  /** Anyone signed in reports a review (a merchant reports reviews about itself). Enough reports hide it until a moderator decides. */
  async report(
    actor: Actor,
    reviewId: string,
    b: { reason: ReportReason; note?: string | null },
    reporter: { type: 'CUSTOMER' | 'MERCHANT'; organizationId?: string | null },
    meta: RequestMeta,
  ) {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (
      !r ||
      r.status === 'REMOVED' ||
      (reporter.type === 'MERCHANT' && r.merchantOrganizationId !== reporter.organizationId)
    )
      throw AppError.notFound();
    if (reporter.type === 'CUSTOMER' && r.customerUserId === actor.userId)
      throw AppError.validation('You cannot report your own review');
    const cfg = await opsConfig(this.config);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.reviewReport.create({
          data: {
            reviewId,
            reporterType: reporter.type,
            reporterUserId: actor.userId,
            reporterOrganizationId: reporter.organizationId ?? null,
            reason: b.reason,
            note: b.note ?? null,
          },
        });
        const count = r.reportCount + 1;
        const hide = count >= cfg.reviews.hideAfterReports && r.status !== 'HIDDEN';
        await tx.review.update({
          where: { id: reviewId },
          data: {
            reportCount: { increment: 1 },
            status: hide ? 'HIDDEN' : r.status === 'PUBLISHED' ? 'REPORTED' : r.status,
          },
        });
        await tx.moderationItem.upsert({
          where: { subjectType_subjectId: { subjectType: 'REVIEW', subjectId: reviewId } },
          update: {
            status: 'REPORTED',
            reportCount: { increment: 1 },
            reasons: { push: b.reason },
          },
          create: {
            subjectType: 'REVIEW',
            subjectId: reviewId,
            organizationId: r.merchantOrganizationId,
            status: 'REPORTED',
            reasons: [b.reason],
            reportCount: 1,
          },
        });
        await this.audit.record(
          {
            action: 'REVIEW_REPORTED',
            entityType: 'Review',
            entityId: reviewId,
            actor,
            subjectOrganizationId: r.merchantOrganizationId,
            reason: b.reason,
            newState: { reporter: reporter.type, autoHidden: hide },
            meta,
          },
          tx,
        );
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new AppError('INVALID_STATE', 'You already reported this review', 409);
      throw e;
    }
    return { reported: true };
  }

  /** A customer or merchant reports campaign / merchant profile / media content. */
  async reportContent(
    actor: Actor,
    b: {
      subjectType: 'MERCHANT_PROFILE' | 'CAMPAIGN' | 'MEDIA';
      subjectId: string;
      product?: string | null;
      reason: ReportReason;
      note?: string | null;
    },
    meta: RequestMeta,
  ) {
    let organizationId: string | null = null;
    if (b.subjectType === 'MERCHANT_PROFILE')
      organizationId =
        (
          await this.prisma.organization.findFirst({
            where: { id: b.subjectId, type: 'MERCHANT' },
            select: { id: true },
          })
        )?.id ?? null;
    else if (b.subjectType === 'MEDIA')
      organizationId =
        (
          await this.prisma.storedFile.findUnique({
            where: { id: b.subjectId },
            select: { organizationId: true },
          })
        )?.organizationId ?? null;
    else {
      const p = b.product;
      const row =
        p === 'LIVE_DEAL'
          ? await this.prisma.liveDeal.findUnique({
              where: { id: b.subjectId },
              select: { organizationId: true },
            })
          : p === 'EXCLUSIVE'
            ? await this.prisma.hotDeal.findUnique({
                where: { id: b.subjectId },
                select: { organizationId: true },
              })
            : p === 'VOUCHER'
              ? await this.prisma.voucher.findUnique({
                  where: { id: b.subjectId },
                  select: { organizationId: true },
                })
              : p === 'WATCH'
                ? await this.prisma.watchCampaign.findUnique({
                    where: { id: b.subjectId },
                    select: { organizationId: true },
                  })
                : null;
      organizationId = row?.organizationId ?? null;
    }
    if (!organizationId) throw AppError.notFound();
    await this.prisma.moderationItem.upsert({
      where: { subjectType_subjectId: { subjectType: b.subjectType, subjectId: b.subjectId } },
      update: { status: 'REPORTED', reportCount: { increment: 1 }, reasons: { push: b.reason } },
      create: {
        subjectType: b.subjectType,
        subjectId: b.subjectId,
        product: b.product ?? null,
        organizationId,
        status: 'REPORTED',
        reasons: [b.reason],
        reportCount: 1,
      },
    });
    await this.audit.record({
      action: 'CONTENT_REPORTED',
      entityType: b.subjectType,
      entityId: b.subjectId,
      actor,
      subjectOrganizationId: organizationId,
      reason: b.reason,
      newState: { note: b.note ?? null, product: b.product ?? null },
      meta,
    });
    return { reported: true };
  }

  async queue(f: { status?: string; subjectType?: string }) {
    const items = await this.prisma.moderationItem.findMany({
      where: {
        ...(f.status ? { status: f.status } : { status: { in: ['PENDING_REVIEW', 'REPORTED'] } }),
        ...(f.subjectType ? { subjectType: f.subjectType } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    const reviews = await this.prisma.review.findMany({
      where: {
        id: { in: items.filter((i) => i.subjectType === 'REVIEW').map((i) => i.subjectId) },
      },
    });
    return items.map((i) => ({
      id: i.id,
      subjectType: i.subjectType,
      subjectId: i.subjectId,
      product: i.product,
      organizationId: i.organizationId,
      status: i.status,
      source: i.source,
      reasons: i.reasons,
      reportCount: i.reportCount,
      decidedByUserId: i.decidedByUserId,
      decidedAt: i.decidedAt?.toISOString() ?? null,
      decisionReason: i.decisionReason,
      createdAt: i.createdAt.toISOString(),
      review: (() => {
        const r = reviews.find((x) => x.id === i.subjectId);
        return r ? this.adminView(r) : null;
      })(),
    }));
  }

  private async campaignControl(
    actor: Actor,
    product: string | null,
    id: string,
    hide: boolean,
    reason: string,
    meta: RequestMeta,
  ) {
    if (!actor.permissions.has('admin.campaigns.control'))
      throw new AppError('FORBIDDEN', 'Hiding a campaign needs campaign control permission', 403);
    const svc =
      product === 'LIVE_DEAL'
        ? this.moduleRef.get(DealReviewService, { strict: false })
        : product === 'EXCLUSIVE'
          ? this.moduleRef.get(HotReviewService, { strict: false })
          : product === 'VOUCHER'
            ? this.moduleRef.get(VoucherReviewService, { strict: false })
            : product === 'WATCH'
              ? this.moduleRef.get(WatchReviewService, { strict: false })
              : null;
    if (!svc) throw AppError.validation('Unknown campaign product', 'product');
    await (hide
      ? svc.suspend(actor, id, { reason }, meta)
      : svc.reinstate(actor, id, { reason }, meta));
  }

  /** A moderator decides an item: APPROVE (keep / publish), REJECT (the report is unfounded), HIDE, RESTORE. Reason required. */
  async decide(
    actor: Actor,
    id: string,
    b: { decision: ModerationDecision; reasonCode: string; reason: string },
    meta: RequestMeta,
  ) {
    const cfg = await opsConfig(this.config);
    if (!cfg.reasons.moderation.some((r) => r.code === b.reasonCode))
      throw AppError.validation('Choose a configured reason', 'reasonCode');
    const item = await this.prisma.moderationItem.findUnique({ where: { id } });
    if (!item) throw AppError.notFound();
    const status =
      b.decision === 'APPROVE'
        ? 'APPROVED'
        : b.decision === 'REJECT'
          ? 'REJECTED'
          : b.decision === 'HIDE'
            ? 'HIDDEN'
            : 'RESTORED';
    // a review hidden automatically by reports is restorable from its REPORTED queue item; other content by its own HIDDEN state
    const hidden =
      item.subjectType === 'REVIEW'
        ? (
            await this.prisma.review.findUnique({
              where: { id: item.subjectId },
              select: { status: true },
            })
          )?.status === 'HIDDEN'
        : item.status === 'HIDDEN';
    if (b.decision === 'RESTORE' && !hidden)
      throw new AppError('INVALID_STATE', 'Only hidden content can be restored', 409);
    if (item.subjectType === 'REVIEW') {
      const r = await this.prisma.review.findUniqueOrThrow({ where: { id: item.subjectId } });
      // APPROVE / REJECT (report unfounded) / RESTORE publish it; HIDE hides it
      const reviewStatus = b.decision === 'HIDE' ? 'HIDDEN' : 'PUBLISHED';
      await this.prisma.review.update({
        where: { id: r.id },
        data: {
          status: reviewStatus,
          moderatedByUserId: actor.userId,
          moderatedAt: new Date(),
          moderationReason: `${b.reasonCode}: ${b.reason}`,
        },
      });
      await this.prisma.reviewReport.updateMany({
        where: { reviewId: r.id, status: 'OPEN' },
        data: {
          status: b.decision === 'HIDE' ? 'UPHELD' : 'DISMISSED',
          decidedByUserId: actor.userId,
          decidedAt: new Date(),
        },
      });
    } else if (
      item.subjectType === 'CAMPAIGN' &&
      (b.decision === 'HIDE' || b.decision === 'RESTORE')
    ) {
      await this.campaignControl(
        actor,
        item.product,
        item.subjectId,
        b.decision === 'HIDE',
        `${b.reasonCode}: ${b.reason}`,
        meta,
      );
    } else if (item.subjectType === 'MEDIA' && b.decision === 'HIDE') {
      // a hidden file is no longer served (signed URLs need an AVAILABLE file); restoring makes it available again
      await this.prisma.storedFile
        .update({ where: { id: item.subjectId }, data: { status: 'REJECTED' } })
        .catch(() => {
          throw new AppError('INVALID_STATE', 'This file cannot be hidden', 409);
        });
    } else if (item.subjectType === 'MEDIA' && b.decision === 'RESTORE') {
      await this.prisma.storedFile.update({
        where: { id: item.subjectId },
        data: { status: 'AVAILABLE' },
      });
    }
    await this.prisma.moderationItem.update({
      where: { id },
      data: {
        status,
        decidedByUserId: actor.userId,
        decidedAt: new Date(),
        decisionReason: `${b.reasonCode}: ${b.reason}`,
      },
    });
    await this.audit.record({
      action: 'MODERATION_DECIDED',
      entityType: item.subjectType,
      entityId: item.subjectId,
      actor,
      subjectOrganizationId: item.organizationId,
      reason: `${b.reasonCode}: ${b.reason}`,
      previousState: { status: item.status },
      newState: { status, decision: b.decision },
      meta,
    });
    return (await this.queue({ status })).find((x) => x.id === id) ?? null;
  }

  /** Moderators can also hide / remove a review directly (for example a legal request). */
  async removeReview(actor: Actor, reviewId: string, reason: string, meta: RequestMeta) {
    const r = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!r) throw AppError.notFound();
    await this.prisma.review.update({
      where: { id: reviewId },
      data: {
        status: 'REMOVED',
        moderatedByUserId: actor.userId,
        moderatedAt: new Date(),
        moderationReason: reason,
      },
    });
    await this.audit.record({
      action: 'REVIEW_REMOVED',
      entityType: 'Review',
      entityId: reviewId,
      actor,
      subjectOrganizationId: r.merchantOrganizationId,
      reason,
      previousState: { status: r.status },
      newState: { status: 'REMOVED' },
      meta,
    });
    return this.adminView(await this.prisma.review.findUniqueOrThrow({ where: { id: reviewId } }));
  }
}
