import { Injectable, Optional } from '@nestjs/common';
import { ConflictService } from '../operations/conflict.service';
import { hotDealIssues, type AdminHotDetail, type AdminHotRow } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { parseHotContent } from './hot-content';
import { HotCoreService, type HotRow } from './hot-core.service';
import { HotViewService } from './hot-view.service';
import { MerchantHotDealsService } from './merchant-hot-deals.service';
import { NotificationsService } from './notifications.service';
import { ReservationsService } from './reservations.service';

export interface AdminHotListQuery {
  limit: number;
  cursor?: string;
  status?: string;
  queue?: boolean;
  merchantId?: string;
  q?: string;
}

export interface Decision {
  reason: string;
  reasonAr?: string;
  fields?: string[];
}

const ROW_INCLUDE = {
  organization: { include: { merchant: true } },
  inventory: true,
} satisfies Prisma.HotDealInclude;

/** DealDash Exclusive Deal review and live monitoring (Admin). Every decision is audited. */
@Injectable()
export class HotReviewService {
  constructor(
    private readonly core: HotCoreService,
    private readonly view: HotViewService,
    private readonly merchantDeals: MerchantHotDealsService,
    private readonly reservations: ReservationsService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    @Optional() private readonly conflicts?: ConflictService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  private row(d: Prisma.HotDealGetPayload<{ include: typeof ROW_INCLUDE }>): AdminHotRow {
    const c = parseHotContent(d.content);
    return {
      id: d.id,
      status: d.status,
      title: c.title,
      limitType: d.limitType,
      merchant: {
        id: d.organizationId,
        nameEn: d.organization.nameEn,
        nameAr: d.organization.nameAr,
        trustLevel: d.organization.merchant?.trustLevel ?? 'NEW',
      },
      branchCount: d.inventory.length,
      totalUnits: d.inventory.reduce((n, i) => n + i.total, 0),
      submittedAt: d.submittedAt ? d.submittedAt.toISOString() : null,
      startAt: d.startAt ? d.startAt.toISOString() : null,
      endAt: d.endAt ? d.endAt.toISOString() : null,
    };
  }

  // ---------------------------------------------------------------- lists
  async list(q: AdminHotListQuery): Promise<Page<AdminHotRow>> {
    const where: Prisma.HotDealWhereInput = {
      ...(q.merchantId ? { organizationId: q.merchantId } : {}),
      ...(q.q
        ? {
            OR: [
              { titleEn: { contains: q.q, mode: 'insensitive' } },
              { titleAr: { contains: q.q, mode: 'insensitive' } },
              { organization: { nameEn: { contains: q.q, mode: 'insensitive' } } },
              { organization: { nameAr: { contains: q.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
      // drafts are private to the merchant until submitted
      status: q.queue ? 'PENDING_REVIEW' : q.status ? (q.status as never) : { not: 'DRAFT' },
    };
    const page = await keysetPage({
      findMany: (query) => this.prisma.hotDeal.findMany({ ...query, include: ROW_INCLUDE }),
      baseWhere: where as Record<string, unknown>,
      sort: q.queue ? { field: 'submittedAt', dir: 'asc' } : { field: 'updatedAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    return new Page(
      page.items.map((d) => this.row(d)),
      page.nextCursor,
    );
  }

  // ---------------------------------------------------------------- detail
  async detail(actor: Actor, id: string): Promise<AdminHotDetail> {
    const deal = await this.core.loadAny(id);
    if (deal.status === 'DRAFT') throw AppError.notFound(); // drafts are the merchant's private work
    const base = await this.view.build(deal);
    const history = await this.prisma.hotDealHistory.findMany({
      where: { dealId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const content = parseHotContent(deal.content);
    const noShow = await this.core.noShow();
    return {
      ...base,
      merchant: {
        id: deal.organizationId,
        nameEn: deal.organization.nameEn,
        nameAr: deal.organization.nameAr,
        status: deal.organization.status,
        trustLevel: deal.organization.merchant?.trustLevel ?? 'NEW',
        riskTier: deal.organization.merchant?.riskTier ?? 'STANDARD',
      },
      history: history.map((h) => this.view.historyView(h, false)),
      preview: await this.merchantDeals.previewOf(deal),
      reviewTarget: deal.status === 'PENDING_REVIEW' ? 'DEAL' : 'NONE',
      adminActions: this.adminActions(actor, deal.status),
      reservationRules: {
        reservationsEnabled: content.reservationsEnabled,
        perCustomerLimit: content.perCustomerLimit,
        holdMinutes: await this.core.holdMinutes(deal),
        maxActivePerCustomer: await this.core.maxActiveReservations(),
        noShowThreshold: noShow.threshold,
        noShowBlockDays: noShow.blockDays,
      },
    };
  }

  adminActions(actor: Actor, status: string): string[] {
    const out: string[] = [];
    if (actor.permissions.has('admin.campaigns.review') && status === 'PENDING_REVIEW')
      out.push('approve', 'request_changes', 'reject');
    if (actor.permissions.has('admin.campaigns.control')) {
      if (status === 'LIVE' || status === 'SCHEDULED' || status === 'SOLD_OUT')
        out.push('pause', 'suspend');
      if (status === 'PAUSED') out.push('resume', 'suspend');
      if (status === 'SUSPENDED') out.push('reinstate');
    }
    return out;
  }

  async monitor(id: string) {
    return this.merchantDeals.monitorOf(await this.core.loadAny(id));
  }

  async activity(id: string) {
    await this.core.loadAny(id);
    return this.merchantDeals.activityOf(id, false);
  }

  /** Platform overview for Operations: counts by status and today's reservation / redemption activity. */
  async overview(now = new Date()) {
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const [byStatus, held, redeemed24, created24, expired24, cancelled24, restrictions, soon] =
      await Promise.all([
        this.prisma.hotDeal.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.reservation.count({ where: { status: 'HELD', expiresAt: { gt: now } } }),
        this.prisma.redemption.count({
          where: { status: 'REDEEMED', redeemedAt: { gte: dayAgo } },
        }),
        this.prisma.reservation.count({ where: { createdAt: { gte: dayAgo } } }),
        this.prisma.reservation.count({ where: { status: 'EXPIRED', expiresAt: { gte: dayAgo } } }),
        this.prisma.reservation.count({
          where: { status: 'CANCELLED', cancelledAt: { gte: dayAgo } },
        }),
        this.prisma.customerRestriction.count({ where: { status: 'ACTIVE', endsAt: { gt: now } } }),
        this.prisma.hotDeal.findMany({
          where: { status: { in: ['LIVE', 'SOLD_OUT'] } },
          include: ROW_INCLUDE,
          orderBy: { endAt: 'asc' },
          take: 10,
        }),
      ]);
    const counts: Record<string, number> = {};
    for (const r of byStatus) counts[r.status] = r._count._all;
    return {
      counts,
      last24h: {
        reservationsCreated: created24,
        redeemed: redeemed24,
        notCompleted: expired24,
        cancelled: cancelled24,
      },
      heldNow: held,
      activeRestrictions: restrictions,
      liveDeals: soon.map((d) => ({
        ...this.row(d),
        availableUnits: d.inventory.reduce((n, i) => n + i.available, 0),
        reservedUnits: d.inventory.reduce((n, i) => n + i.reserved, 0),
        redeemedUnits: d.inventory.reduce((n, i) => n + i.redeemed, 0),
      })),
    };
  }

  async auditTrail(id: string, q: { limit: number; cursor?: string }) {
    await this.core.loadAny(id);
    const page = await keysetPage({
      findMany: (query) => this.prisma.auditLog.findMany(query),
      baseWhere: { entityType: 'HotDeal', entityId: id },
      sort: { field: 'occurredAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    return new Page(
      page.items.map((a) => ({
        id: a.id,
        occurredAt: a.occurredAt.toISOString(),
        action: a.action,
        actorRole: a.actorRole,
        actorUserId: a.actorUserId,
        reason: a.reason,
        entityType: a.entityType,
      })),
      page.nextCursor,
    );
  }

  // ---------------------------------------------------------------- review decisions
  private async pending(id: string) {
    const deal = await this.core.loadAny(id);
    if (deal.status !== 'PENDING_REVIEW')
      throw new AppError('INVALID_STATE', 'This deal is not waiting for review', 409);
    return deal;
  }

  async approve(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const deal = await this.pending(id);
    const now = new Date();
    if (deal.organization.status !== 'ACTIVE')
      throw new AppError('ORG_NOT_ACTIVE', 'The merchant account is not active', 409);
    const content = parseHotContent(deal.content);
    const issues = [
      ...hotDealIssues(content, { now, limits: await this.core.limits() }),
      // RC-21: the commitment is checked again at approval (the policy may have changed since submission)
      ...(await this.core.commitmentIssues(deal.organizationId, content)),
    ];
    if (issues.length)
      throw new AppError(
        'DEAL_INCOMPLETE',
        'The deal is incomplete and cannot be approved',
        422,
        undefined,
        issues.map((i) => ({ code: 'DEAL_INCOMPLETE', message: i.code, field: i.field })),
      );
    await this.core.requireActiveBranch(
      deal.organizationId,
      content.allocations.map((a) => a.branchId),
    );
    await this.core.validateReferences(deal.organizationId, content);
    await this.core.commercial.assertCanActivate('EXCLUSIVE', id);
    await this.prisma.$transaction((tx) =>
      this.core.approveDeal(
        tx,
        deal,
        { action: 'APPROVE', actor, reason: body.reason, reasonAr: body.reasonAr, meta },
        now,
      ),
    );
    // never blocks approval: a weaker-than-public or duplicate offer is flagged for a person to decide
    await this.conflicts?.detectForHotDeal(id).catch(() => undefined);
    return this.detail(actor, id);
  }

  async requestChanges(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const deal = await this.pending(id);
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, deal, 'NEEDS_CHANGES', {
        action: 'REQUEST_CHANGES',
        actor,
        reason: body.reason,
        reasonAr: body.reasonAr,
        fields: body.fields,
        meta,
      }),
    );
    return this.detail(actor, id);
  }

  async reject(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const deal = await this.pending(id);
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, deal, 'REJECTED', {
        action: 'REJECT',
        actor,
        reason: body.reason,
        reasonAr: body.reasonAr,
        meta,
      }),
    );
    return this.detail(actor, id);
  }

  // ---------------------------------------------------------------- emergency controls (admin.campaigns.control)
  private async control(
    actor: Actor,
    id: string,
    allowed: HotRow['status'][],
    to: (deal: HotRow) => Promise<HotRow['status']> | HotRow['status'],
    action: 'PAUSE' | 'RESUME' | 'SUSPEND' | 'REINSTATE',
    body: Decision,
    meta: RequestMeta,
    data: (deal: HotRow, target: HotRow['status']) => Prisma.HotDealUncheckedUpdateManyInput,
  ) {
    const deal = await this.core.loadAny(id);
    if (!allowed.includes(deal.status))
      throw new AppError(
        'INVALID_STATE',
        `A ${deal.status} deal cannot be ${action.toLowerCase()}d`,
        409,
      );
    const target = await to(deal);
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, deal, target, {
        action,
        actor,
        reason: body.reason,
        reasonAr: body.reasonAr,
        data: data(deal, target),
        meta,
      }),
    );
    return this.detail(actor, id);
  }

  pause(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    return this.control(
      actor,
      id,
      ['LIVE', 'SCHEDULED', 'SOLD_OUT'],
      () => 'PAUSED',
      'PAUSE',
      body,
      meta,
      () => ({
        pausedBy: 'DEALDASH',
      }),
    );
  }

  resume(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const now = new Date();
    return this.control(
      actor,
      id,
      ['PAUSED'],
      (d) => this.merchantDeals.statusOnReturn(d, now),
      'RESUME',
      body,
      meta,
      (_d, t) => ({ pausedBy: null, ...(t === 'EXPIRED' ? { endedAt: now } : {}) }),
    );
  }

  suspend(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    return this.control(
      actor,
      id,
      ['LIVE', 'SCHEDULED', 'PAUSED', 'SOLD_OUT'],
      () => 'SUSPENDED',
      'SUSPEND',
      body,
      meta,
      (d) => ({ statusBeforeSuspension: d.status }),
    );
  }

  /** Releases a suspension: the deal returns to what it was (paused stays paused; otherwise dates and stock decide). */
  reinstate(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const now = new Date();
    return this.control(
      actor,
      id,
      ['SUSPENDED'],
      (d) =>
        d.statusBeforeSuspension === 'PAUSED'
          ? 'PAUSED'
          : this.merchantDeals.statusOnReturn(d, now),
      'REINSTATE',
      body,
      meta,
      (d, t) => ({
        statusBeforeSuspension: null,
        ...(d.statusBeforeSuspension === 'PAUSED' ? {} : { pausedBy: null }),
        ...(t === 'EXPIRED' ? { endedAt: now } : {}),
      }),
    );
  }

  /** DealDash may cancel a campaign (policy breach): held reservations are cancelled and customers notified. */
  async cancel(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const deal = await this.core.loadAny(id);
    if (!['LIVE', 'SCHEDULED', 'PAUSED', 'SOLD_OUT', 'SUSPENDED'].includes(deal.status))
      throw new AppError('INVALID_STATE', `A ${deal.status} deal cannot be cancelled`, 409);
    const now = new Date();
    const sent = await this.prisma.$transaction(async (tx) => {
      await this.core.transition(tx, deal, 'CANCELLED', {
        action: 'CANCEL',
        actor,
        reason: body.reason,
        reasonAr: body.reasonAr,
        data: { endedAt: now, pausedBy: null },
        meta,
      });
      return this.reservations.cancelAllHeld(
        tx,
        id,
        'DEALDASH',
        actor,
        `Campaign cancelled by DealDash: ${body.reason}`,
        meta,
        now,
      );
    });
    await this.notifications.dispatch(sent);
    return this.detail(actor, id);
  }
}
