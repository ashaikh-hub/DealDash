import { Injectable } from '@nestjs/common';
import { reasonClassOf, type WatchStatus } from '@dealdash/types';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  prizeLiabilityMinor,
  watchIssues,
  watchTranslationStatus,
  type WatchCampaignView,
  type WatchCard,
  type WatchContent,
  type WatchDetail,
  type WatchMonitor,
} from '@dealdash/validation';
import { FilesService } from '../files/files.service';
import { GuardrailsService } from '../live-deals/guardrails.service';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import type { EligibilityOutcome } from '../live-deals/eligibility.service';
import { WatchCoreService, type WatchRowData } from './watch-core.service';
import { prizeOpportunity } from './watch-prize.service';

export interface CardContext {
  outcome?: EligibilityOutcome;
  availability?: WatchCard['availability'];
  availableAgainAt?: Date | null;
  distanceMeters?: number | null;
  rewardPoints?: number;
  /** Saved by the signed-in customer (favourites); undefined for guests. */
  saved?: boolean;
}

const FRAUD_REASONS = new Set(['RISK_BLOCKED', 'FRAUD_REVERSED', 'TIMELINE_MISMATCH']);

/** Builds the merchant, admin and customer shapes of a Watch & Earn campaign. */
@Injectable()
export class WatchViewService {
  constructor(
    private readonly core: WatchCoreService,
    private readonly files: FilesService,
    private readonly guardrails: GuardrailsService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  // ---------------------------------------------------------------- guardrails
  async guardrail(
    content: WatchContent,
    trust: Parameters<GuardrailsService['evaluate']>[1],
  ): Promise<{ outcome: 'AUTO_PUBLISH' | 'MANUAL_REVIEW'; reasons: string[] }> {
    const base = await this.guardrails.evaluate(
      {
        mechanic: null,
        valueNumber: null,
        title: content.title,
        description: content.description,
        terms: { textEn: content.ctaLabel.en, textAr: content.ctaLabel.ar },
      },
      trust,
      { auto: CONFIG_KEYS.WATCH_AUTO_PUBLISH, rules: CONFIG_KEYS.WATCH_GUARDRAILS },
    );
    const reasons = [...base.reasons];
    if (content.paidViews > (await this.core.reviewAbovePaidViews())) reasons.push('LARGE_BUDGET');
    const uniq = [...new Set(reasons)];
    return { outcome: uniq.length ? 'MANUAL_REVIEW' : 'AUTO_PUBLISH', reasons: uniq };
  }

  // ---------------------------------------------------------------- actions
  merchantActions(
    c: Pick<WatchRowData, 'status' | 'pausedBy' | 'fundedHalalas' | 'requiredBudgetHalalas'>,
  ): string[] {
    const out = new Set<string>();
    switch (c.status) {
      case 'DRAFT':
      case 'NEEDS_CHANGES':
        out.add('edit');
        out.add('fund');
        out.add('submit');
        out.add('cancel');
        break;
      case 'PENDING_REVIEW':
        out.add('cancel');
        break;
      case 'SCHEDULED':
        out.add('edit_minor');
        out.add('pause');
        out.add('cancel');
        break;
      case 'LIVE':
        out.add('edit_minor');
        out.add('pause');
        out.add('cancel');
        break;
      case 'PAUSED':
        out.add('edit_minor');
        if (c.pausedBy === 'MERCHANT') out.add('resume');
        out.add('cancel');
        break;
      default:
        break;
    }
    return [...out];
  }

  historyView(
    h: {
      id: string;
      action: string;
      fromStatus: string | null;
      toStatus: string | null;
      reason: string | null;
      reasonAr: string | null;
      fields: unknown;
      actorRole: string | null;
      actorName: string | null;
      byDealDash: boolean;
      createdAt: Date;
    },
    forMerchant: boolean,
  ) {
    return {
      id: h.id,
      action: h.action as never,
      fromStatus: (h.fromStatus ?? null) as never,
      toStatus: (h.toStatus ?? null) as never,
      reason: h.reason,
      reasonAr: h.reasonAr,
      fields: Array.isArray(h.fields) ? (h.fields as string[]) : [],
      // Merchants never see which DealDash employee acted: staff show as "DealDash".
      actorRole: forMerchant && h.byDealDash ? 'DealDash' : h.actorRole,
      actorName: forMerchant && h.byDealDash ? null : h.actorName,
      byDealDash: h.byDealDash,
      createdAt: h.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------- merchant / admin view
  async build(c: WatchRowData): Promise<WatchCampaignView> {
    const content = this.core.content(c);
    const limits = await this.core.limits();
    const f = await this.core.frequency();
    const now = new Date();
    const urls = await this.files.signedUrls([c.videoFileId, c.thumbnailFileId], 1800);
    const latest = await this.prisma.watchCampaignHistory.findFirst({
      where: {
        campaignId: c.id,
        action: {
          in: ['REQUEST_CHANGES', 'REJECT', 'SUSPEND', 'APPROVE', 'AUTO_APPROVE', 'STOP', 'PAUSE'],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    const issues = watchIssues(content, {
      now,
      limits,
      minRepeatWindowHours: f.minRepeatWindowHours,
      prizeGuardrails: await this.core.prizeGuardrails(),
    });
    const trust = await this.core.merchantTrust(c.organizationId);
    return {
      id: c.id,
      organizationId: c.organizationId,
      status: c.status,
      version: c.version,
      content,
      videoUrl: c.videoFileId ? (urls.get(c.videoFileId) ?? null) : null,
      thumbnailUrl: c.thumbnailFileId ? (urls.get(c.thumbnailFileId) ?? null) : null,
      budget: await this.core.budgetOf(c),
      pausedBy: c.pausedBy ?? null,
      submittedAt: c.submittedAt ? c.submittedAt.toISOString() : null,
      publishedAt: c.publishedAt ? c.publishedAt.toISOString() : null,
      endedAt: c.endedAt ? c.endedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      translation: watchTranslationStatus(content),
      issues,
      guardrail: await this.guardrail(content, trust),
      latestDecision: latest ? this.historyView(latest, true) : null,
      allowedActions: this.merchantActions(c),
      serverNow: now.toISOString(),
    } as WatchCampaignView;
  }

  // ---------------------------------------------------------------- customer shapes
  async card(c: WatchRowData, ctx: CardContext = {}, now = new Date()): Promise<WatchCard> {
    const content = this.core.content(c);
    const urls = await this.files.signedUrls(
      [c.thumbnailFileId, c.organization.merchant?.logoFileId],
      6 * 3600,
    );
    const points =
      ctx.rewardPoints ??
      this.core.pointsFor(await this.core.rewardRule(), c.durationSec ?? content.durationSec ?? 0);
    const out: WatchCard = {
      id: c.id,
      merchantId: c.organizationId,
      merchantName: merchantDisplayName(c.organization),
      merchantLogoUrl: c.organization.merchant?.logoFileId
        ? (urls.get(c.organization.merchant.logoFileId) ?? null)
        : null,
      // display only: the merchant's category (a picture for a video without its own thumbnail)
      merchantCategory: c.organization.merchant?.categoryCode ?? null,
      title: content.title,
      description: content.description,
      thumbnailUrl: c.thumbnailFileId ? (urls.get(c.thumbnailFileId) ?? null) : null,
      durationSec: c.durationSec ?? content.durationSec ?? 0,
      rewardPoints: points,
      availability: ctx.availability ?? 'AVAILABLE',
      availableAgainAt: ctx.availableAgainAt ? ctx.availableAgainAt.toISOString() : null,
      endsAt: c.endAt ? c.endAt.toISOString() : null,
      distanceMeters: ctx.distanceMeters ?? null,
      eligibility: {
        result: ctx.outcome?.result ?? 'ELIGIBLE',
        kind: content.targeting.eligibility.kind,
        message: ctx.outcome?.message ?? null,
        unlockAction: ctx.outcome?.unlockAction ?? null,
      },
      // the instant-prize opportunity, from the campaign's own configuration and remaining stock (FDR-19)
      instantPrize: prizeOpportunity(c, content),
      ...(ctx.saved !== undefined ? { saved: ctx.saved } : {}),
      serverNow: now.toISOString(),
    };
    return out;
  }

  async detail(c: WatchRowData, ctx: CardContext = {}, now = new Date()): Promise<WatchDetail> {
    const content = this.core.content(c);
    const card = await this.card(c, ctx, now);
    return {
      ...card,
      ctaLabel: content.ctaLabel,
      link: {
        type: content.link.type,
        id: content.link.id,
        label: await this.linkLabel(c, content),
      },
      canStart: card.availability === 'AVAILABLE' && card.eligibility.result === 'ELIGIBLE',
      sponsored: true,
    };
  }

  /** Title of the merchant's own linked offer (so the customer sees where the button leads). */
  private async linkLabel(c: WatchRowData, content: WatchContent) {
    const { type, id } = content.link;
    if (type === 'NONE' || type === 'MERCHANT' || !id) return null;
    const row =
      type === 'LIVE_DEAL'
        ? await this.prisma.liveDeal.findFirst({
            where: { id, organizationId: c.organizationId },
            select: { titleEn: true, titleAr: true },
          })
        : type === 'HOT_DEAL'
          ? await this.prisma.hotDeal.findFirst({
              where: { id, organizationId: c.organizationId },
              select: { titleEn: true, titleAr: true },
            })
          : await this.prisma.voucher.findFirst({
              where: { id, organizationId: c.organizationId },
              select: { titleEn: true, titleAr: true },
            });
    return row ? { en: row.titleEn, ar: row.titleAr } : null;
  }

  // ---------------------------------------------------------------- monitor (verified numbers only)
  async monitorOf(c: WatchRowData): Promise<WatchMonitor> {
    const now = new Date();
    const [byStatus, ev, reasons, viewers, rewards, completed] = await Promise.all([
      this.prisma.watchView.groupBy({
        by: ['status'],
        where: { campaignId: c.id },
        _count: { _all: true },
      }),
      this.prisma.dealEvent.groupBy({
        by: ['type'],
        where: { productType: 'WATCH', dealId: c.id },
        _count: { _all: true },
      }),
      this.prisma.watchView.groupBy({
        by: ['reason'],
        where: { campaignId: c.id, status: { in: ['INVALID', 'CAPPED', 'CREDITED_BACK'] } },
        _count: { _all: true },
      }),
      this.prisma.watchView.groupBy({ by: ['userId'], where: { campaignId: c.id } }),
      this.prisma.watchView.groupBy({
        by: ['rewardState'],
        where: { campaignId: c.id, rewardState: { not: null } },
        _count: { _all: true },
        _sum: { rewardPoints: true },
      }),
      this.prisma.watchView.count({ where: { campaignId: c.id, completedAt: { not: null } } }),
    ]);
    const n = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
    const e = (t: string) => ev.find((x) => x.type === t)?._count._all ?? 0;
    const started = byStatus.reduce((a, x) => a + x._count._all, 0);
    const invalidByCategory: Record<string, number> = {};
    for (const r of reasons) {
      // Customers' detection signals stay private: fraud-related reasons are reported as "OTHER".
      const cls = FRAUD_REASONS.has(r.reason ?? '')
        ? 'OTHER'
        : reasonClassOf((r.reason ?? null) as never);
      invalidByCategory[cls] = (invalidByCategory[cls] ?? 0) + r._count._all;
    }
    const earned = rewards.find((r) => r.rewardState === 'EARNED');
    const held = rewards.find((r) => r.rewardState === 'HELD');
    const budget = await this.core.budgetOf(c);
    const schedulePct =
      c.startAt && c.endAt && c.endAt.getTime() > c.startAt.getTime()
        ? Math.max(
            0,
            Math.min(
              100,
              Math.round(
                ((now.getTime() - c.startAt.getTime()) * 1000) /
                  (c.endAt.getTime() - c.startAt.getTime()),
              ) / 10,
            ),
          )
        : null;
    return {
      status: c.status,
      serverNow: now.toISOString(),
      budget,
      delivery: {
        paidViews: c.paidViews,
        qualifiedViews: c.qualifiedViews,
        remainingViews: budget.remainingViews,
        pct: c.paidViews > 0 ? Math.round((c.qualifiedViews * 1000) / c.paidViews) / 10 : 0,
        schedulePct,
      },
      funnel: {
        impressions: e('IMPRESSION'),
        opened: e('DETAIL_VIEW'),
        started,
        completed,
        qualified: n('QUALIFIED') + n('CREDITED_BACK'),
        invalid: n('INVALID') + n('CREDITED_BACK'),
        capped: n('CAPPED'),
        invalidByCategory,
        ctaClicks: e('CTA_CLICK'),
      },
      reach: {
        uniqueViewers: viewers.length,
        averageFrequency: viewers.length ? Math.round((started * 10) / viewers.length) / 10 : 0,
      },
      completionRatePct: started > 0 ? Math.round((completed * 1000) / started) / 10 : null,
      costPerQualifiedViewHalalas:
        c.qualifiedViews > 0 ? Math.round(c.spentHalalas / c.qualifiedViews) : null,
      rewards: {
        rewardedViews: earned?._count._all ?? 0,
        pointsIssued: (earned?._sum.rewardPoints ?? 0) + (held?._sum.rewardPoints ?? 0),
        heldViews: held?._count._all ?? 0,
      },
      ...(await this.prizeMonitor(c, now)),
      disclaimerKey: 'views_and_verified_spend_only',
    };
  }

  /** Instant-prize stock and decision outcomes for the merchant and DealDash monitors (FDR-19). */
  private async prizeMonitor(c: WatchRowData, now: Date) {
    const p = this.core.content(c).prize;
    if (!p) return {};
    const where = { campaignId: c.id };
    const [issued, redeemed, expired, notWon, ineligible] = await Promise.all([
      this.prisma.watchPrizeDraw.count({
        where: { ...where, status: 'ISSUED', expiresAt: { gt: now } },
      }),
      this.prisma.watchPrizeDraw.count({ where: { ...where, status: 'REDEEMED' } }),
      this.prisma.watchPrizeDraw.count({
        where: {
          ...where,
          won: true,
          OR: [{ status: 'EXPIRED' }, { status: 'ISSUED', expiresAt: { lte: now } }],
        },
      }),
      this.prisma.watchPrizeDraw.count({ where: { ...where, won: false, eligible: true } }),
      this.prisma.watchPrizeDraw.count({ where: { ...where, eligible: false } }),
    ]);
    return {
      prizes: {
        inventory: c.prizeInventory,
        awarded: c.prizesAwarded,
        remaining: Math.max(0, c.prizeInventory - c.prizesAwarded),
        issued,
        redeemed,
        expired,
        notWon,
        ineligible,
        winProbabilityBps: p.winProbabilityBps,
        liabilityMinor: prizeLiabilityMinor(p),
      },
    };
  }

  statusLabelOrder: WatchStatus[] = [
    'LIVE',
    'SCHEDULED',
    'PAUSED',
    'PENDING_REVIEW',
    'NEEDS_CHANGES',
    'DRAFT',
    'COMPLETED',
    'EXPIRED',
    'CANCELLED',
    'REJECTED',
    'SUSPENDED',
  ];
}
