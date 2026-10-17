import { Injectable } from '@nestjs/common';
import {
  watchIssues,
  type AdminWatchDetail,
  type AdminWatchOverview,
  type AdminWatchRow,
  type WatchMonitor,
} from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { MerchantWatchService } from './merchant-watch.service';
import { parseWatchContent } from './watch-content';
import { WatchCoreService, type WatchRowData } from './watch-core.service';
import { WatchFundingService } from './watch-funding.service';
import { WatchViewService } from './watch-view.service';

export interface AdminWatchListQuery {
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

/** DealDash review and live controls for Watch & Earn campaigns. Every decision is audited (history + audit log). */
@Injectable()
export class WatchReviewService {
  constructor(
    private readonly core: WatchCoreService,
    private readonly view: WatchViewService,
    private readonly merchant: MerchantWatchService,
    private readonly funding: WatchFundingService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  async list(q: AdminWatchListQuery): Promise<Page<AdminWatchRow>> {
    const where: Prisma.WatchCampaignWhereInput = {
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
      findMany: (query) =>
        this.prisma.watchCampaign.findMany({
          ...query,
          include: { organization: { include: { merchant: true } } },
        }),
      baseWhere: where as Record<string, unknown>,
      sort: q.queue ? { field: 'submittedAt', dir: 'asc' } : { field: 'updatedAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const flags = page.items.length
      ? await this.prisma.riskFlag.groupBy({
          by: ['campaignId'],
          where: { campaignId: { in: page.items.map((c) => c.id) }, status: { not: 'DECIDED' } },
          _count: { _all: true },
        })
      : [];
    const flagBy = new Map(flags.map((f) => [f.campaignId, f._count._all]));
    return new Page(
      page.items.map((d) => ({
        id: d.id,
        status: d.status,
        title: { en: d.titleEn, ar: d.titleAr },
        paidViews: d.paidViews,
        qualifiedViews: d.qualifiedViews,
        currency: d.currency,
        fundedHalalas: d.fundedHalalas,
        spentHalalas: d.spentHalalas,
        startAt: d.startAt ? d.startAt.toISOString() : null,
        endAt: d.endAt ? d.endAt.toISOString() : null,
        thumbnailUrl: null,
        updatedAt: d.updatedAt.toISOString(),
        merchant: {
          id: d.organizationId,
          nameEn: d.organization.nameEn,
          nameAr: d.organization.nameAr,
          trustLevel: d.organization.merchant?.trustLevel ?? 'NEW',
        },
        submittedAt: d.submittedAt ? d.submittedAt.toISOString() : null,
        flags: flagBy.get(d.id) ?? 0,
      })),
      page.nextCursor,
    );
  }

  adminActions(actor: Actor, status: string): string[] {
    const out: string[] = [];
    if (actor.permissions.has('admin.campaigns.review') && status === 'PENDING_REVIEW')
      out.push('approve', 'request_changes', 'reject');
    if (actor.permissions.has('admin.campaigns.control')) {
      if (status === 'LIVE' || status === 'SCHEDULED') out.push('pause', 'suspend', 'stop');
      if (status === 'PAUSED') out.push('resume', 'suspend', 'stop');
      if (status === 'SUSPENDED') out.push('reinstate', 'stop');
    }
    return out;
  }

  async detail(actor: Actor, id: string): Promise<AdminWatchDetail> {
    const c = await this.core.loadAny(id);
    if (c.status === 'DRAFT') throw AppError.notFound(); // drafts are the merchant's private work
    const base = await this.view.build(c);
    const content = parseWatchContent(c.content);
    const history = await this.prisma.watchCampaignHistory.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const [rate, rule, q, f, fraud] = await Promise.all([
      this.core.rateCard(),
      this.core.rewardRule(),
      this.core.qualifying(),
      this.core.frequency(),
      this.core.fraud(),
    ]);
    const reviewAbove = await this.core.reviewAbovePaidViews();
    return {
      ...base,
      merchant: {
        id: c.organizationId,
        nameEn: c.organization.nameEn,
        nameAr: c.organization.nameAr,
        legalName: c.organization.merchant?.legalName ?? null,
        commercialRegistration: c.organization.merchant?.commercialRegistrationNumber ?? null,
        status: c.organization.status,
        trustLevel: c.organization.merchant?.trustLevel ?? 'NEW',
        riskTier: c.organization.merchant?.riskTier ?? 'STANDARD',
      },
      history: history.map((h) => this.view.historyView(h, false)),
      preview: await this.merchant.previewOf(c),
      adminActions: this.adminActions(actor, c.status),
      economics: {
        currency: c.currency,
        chargePerViewHalalas: c.chargePerViewHalalas || rate.chargePerViewHalalas,
        rateCardVersion: c.rateCardVersion ?? rate.version,
        estimatedCostHalalas: c.paidViews * (c.chargePerViewHalalas || rate.chargePerViewHalalas),
        rewardPoints: this.core.pointsFor(rule, c.durationSec ?? content.durationSec ?? 0),
        rewardRuleVersion: rule.version,
        qualifyingWatchPct: q.watchPct,
        stillWatchingMode: q.stillWatching.mode,
        repeatWindowHours: c.repeatWindowHours,
        customerDailyCap: f.customerDailyCap,
        deviceMaxAccounts: f.deviceMaxAccounts,
        holdHours: fraud.holdHours,
        reviewAbovePaidViews: reviewAbove,
        largeBudgetFlag: c.paidViews > reviewAbove,
        unusedBudgetTreatment: await this.core.unusedTreatment(),
      },
    } as AdminWatchDetail;
  }

  async auditTrail(id: string, q: { limit: number; cursor?: string }) {
    await this.core.loadAny(id);
    const page = await keysetPage({
      findMany: (query) => this.prisma.auditLog.findMany(query),
      baseWhere: { entityType: 'WatchCampaign', entityId: id },
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

  async monitor(id: string): Promise<WatchMonitor> {
    return this.view.monitorOf(await this.core.loadAny(id));
  }

  async budget(id: string) {
    return this.funding.detail(await this.core.loadAny(id), false);
  }

  // ---------------------------------------------------------------- review decisions
  private async pending(id: string) {
    const c = await this.core.loadAny(id);
    if (c.status !== 'PENDING_REVIEW')
      throw new AppError('INVALID_STATE', 'This campaign is not waiting for review', 409);
    return c;
  }

  async approve(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const c = await this.pending(id);
    const now = new Date();
    if (c.organization.status !== 'ACTIVE')
      throw new AppError('ORG_NOT_ACTIVE', 'The merchant account is not active', 409);
    const content = parseWatchContent(c.content);
    const f = await this.core.frequency();
    const issues = watchIssues(content, {
      now,
      limits: await this.core.limits(),
      minRepeatWindowHours: f.minRepeatWindowHours,
      prizeGuardrails: await this.core.prizeGuardrails(),
    });
    if (issues.length)
      throw new AppError(
        'DEAL_INCOMPLETE',
        'The campaign is incomplete and cannot be approved',
        422,
        undefined,
        issues.map((i) => ({ code: 'DEAL_INCOMPLETE', message: i.code, field: i.field })),
      );
    await this.core.validateReferences(c.organizationId, content);
    await this.core.commercial.assertCanActivate('WATCH', id);
    await this.prisma.$transaction((tx) =>
      this.core.approve(
        tx,
        c,
        { action: 'APPROVE', actor, reason: body.reason, reasonAr: body.reasonAr, meta },
        now,
      ),
    );
    return this.detail(actor, id);
  }

  async requestChanges(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const c = await this.pending(id);
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, c, 'NEEDS_CHANGES', {
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

  /** A rejected campaign is final: its funding is closed out to the separate unused balance. */
  async reject(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const c = await this.pending(id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.core.transition(tx, c, 'REJECTED', {
        action: 'REJECT',
        actor,
        reason: body.reason,
        reasonAr: body.reasonAr,
        data: { endedAt: now },
        meta,
      });
      await this.funding.closeOut(tx, c, now);
    });
    return this.detail(actor, id);
  }

  // ---------------------------------------------------------------- controls (admin.campaigns.control)
  private async control(
    actor: Actor,
    id: string,
    allowed: WatchRowData['status'][],
    to: WatchRowData['status'],
    action: 'PAUSE' | 'SUSPEND',
    body: Decision,
    meta: RequestMeta,
    data: (c: WatchRowData) => Prisma.WatchCampaignUncheckedUpdateManyInput,
  ) {
    const c = await this.core.loadAny(id);
    if (!allowed.includes(c.status))
      throw new AppError(
        'INVALID_STATE',
        `A ${c.status} campaign cannot be ${action.toLowerCase()}d`,
        409,
      );
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, c, to, {
        action,
        actor,
        reason: body.reason,
        reasonAr: body.reasonAr,
        data: data(c),
        meta,
      }),
    );
    return this.detail(actor, id);
  }

  pause(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    return this.control(actor, id, ['LIVE', 'SCHEDULED'], 'PAUSED', 'PAUSE', body, meta, () => ({
      pausedBy: 'DEALDASH',
    }));
  }

  async resume(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const c = await this.core.loadAny(id);
    if (c.status !== 'PAUSED')
      throw new AppError('INVALID_STATE', `A ${c.status} campaign cannot be resumed`, 409);
    await this.merchant.resumeTo(actor, c, 'RESUME', meta, body);
    return this.detail(actor, id);
  }

  /** Suspension stops serving AND stops any in-flight view from being charged until it is lifted. */
  suspend(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    return this.control(
      actor,
      id,
      ['LIVE', 'SCHEDULED', 'PAUSED'],
      'SUSPENDED',
      'SUSPEND',
      body,
      meta,
      (c) => ({ statusBeforeSuspension: c.status }),
    );
  }

  async reinstate(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const c = await this.core.loadAny(id);
    if (c.status !== 'SUSPENDED')
      throw new AppError('INVALID_STATE', `A ${c.status} campaign cannot be reinstated`, 409);
    await this.merchant.resumeTo(actor, c, 'REINSTATE', meta, body);
    return this.detail(actor, id);
  }

  async stop(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const c = await this.core.loadAny(id);
    if (!['SCHEDULED', 'LIVE', 'PAUSED', 'SUSPENDED'].includes(c.status))
      throw new AppError('INVALID_STATE', `A ${c.status} campaign cannot be stopped`, 409);
    await this.merchant.stop(actor, c, body.reason, meta, true);
    return this.detail(actor, id);
  }

  // ---------------------------------------------------------------- operational overview
  async overview(): Promise<AdminWatchOverview> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [statuses, flags, q24, inv24, rew24, held, live] = await Promise.all([
      this.prisma.watchCampaign.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.riskFlag.count({ where: { status: { not: 'DECIDED' } } }),
      this.prisma.watchView.count({ where: { status: 'QUALIFIED', qualifiedAt: { gte: since } } }),
      this.prisma.watchView.count({
        where: { status: { in: ['INVALID', 'CAPPED'] }, createdAt: { gte: since } },
      }),
      this.prisma.watchView.count({
        where: { rewardState: 'EARNED', qualifiedAt: { gte: since } },
      }),
      this.prisma.watchView.count({ where: { rewardState: 'HELD' } }),
      this.prisma.watchCampaign.findMany({
        where: { status: { in: ['LIVE', 'PAUSED', 'SUSPENDED', 'SCHEDULED'] } },
        include: { organization: true },
        orderBy: { updatedAt: 'desc' },
        take: 25,
      }),
    ]);
    const n = (s: string) => statuses.find((x) => x.status === s)?._count._all ?? 0;
    const flagRows = live.length
      ? await this.prisma.riskFlag.groupBy({
          by: ['campaignId'],
          where: { campaignId: { in: live.map((c) => c.id) }, status: { not: 'DECIDED' } },
          _count: { _all: true },
        })
      : [];
    const fb = new Map(flagRows.map((f) => [f.campaignId, f._count._all]));
    return {
      counts: {
        live: n('LIVE'),
        pendingReview: n('PENDING_REVIEW'),
        paused: n('PAUSED') + n('SUSPENDED'),
        exhausted: n('COMPLETED'),
        openFlags: flags,
        qualified24h: q24,
        invalid24h: inv24,
        rewardsIssued24h: rew24,
        rewardsHeld: held,
      },
      campaigns: live.map((c) => ({
        id: c.id,
        title: { en: c.titleEn, ar: c.titleAr },
        merchantName: { en: c.organization.nameEn, ar: c.organization.nameAr },
        status: c.status,
        currency: c.currency,
        paidViews: c.paidViews,
        qualifiedViews: c.qualifiedViews,
        budgetPct:
          c.fundedHalalas > 0 ? Math.round((c.spentHalalas * 1000) / c.fundedHalalas) / 10 : 0,
        fundedHalalas: c.fundedHalalas,
        spentHalalas: c.spentHalalas,
        openFlags: fb.get(c.id) ?? 0,
      })),
      disclaimerKey: 'legal_treatment_validate_ksa',
    };
  }
}
