import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  hotDealIssues,
  hotMaterialChanges,
  type HotDealContent,
  type HotDealIssue,
  type HotDealRow,
  type HotDealView,
  type HotMonitor,
} from '@dealdash/validation';
import type { ReservationStatus } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { EligibilityService, evaluateEligibility } from '../live-deals/eligibility.service';
import { GuardrailsService } from '../live-deals/guardrails.service';
import { hotStatusFromDates, parseHotContent } from './hot-content';
import { HOT_APPROVED_STATUSES, HotCoreService, type HotRow } from './hot-core.service';
import { HotViewService } from './hot-view.service';
import { NotificationsService } from './notifications.service';
import { campaignCreator } from '../common/campaign-creator';
import { ReservationsService } from './reservations.service';

export interface HotListQuery {
  limit: number;
  cursor?: string;
  status?: string;
  q?: string;
}

const GUARD_KEYS = {
  auto: CONFIG_KEYS.HOT_DEAL_AUTO_PUBLISH,
  rules: CONFIG_KEYS.HOT_DEAL_GUARDRAILS,
} as const;

const dedupe = (c: HotDealContent): HotDealContent => ({
  ...c,
  allocations: c.allocations.filter(
    (a, i, all) => all.findIndex((x) => x.branchId === a.branchId) === i,
  ),
  media: c.media.filter((m, i, a) => a.findIndex((x) => x.fileId === m.fileId) === i),
  eligibility: { ...c.eligibility, valueRefs: [...new Set(c.eligibility.valueRefs)] },
});

function incomplete(issues: HotDealIssue[]): never {
  throw new AppError(
    'DEAL_INCOMPLETE',
    'Complete the required fields before submitting',
    422,
    undefined,
    issues.map((i) => ({ code: 'DEAL_INCOMPLETE', message: i.code, field: i.field })),
  );
}

/** Merchant Portal operations on Exclusive Deals. Every method is scoped to the caller's own organisation. */
@Injectable()
export class MerchantHotDealsService {
  constructor(
    private readonly core: HotCoreService,
    private readonly view: HotViewService,
    private readonly guardrails: GuardrailsService,
    private readonly eligibility: EligibilityService,
    private readonly reservations: ReservationsService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  // ---------------------------------------------------------------- reading
  async list(actor: Actor, organizationId: string, q: HotListQuery): Promise<Page<HotDealRow>> {
    this.core.requireMerchantScope(actor, organizationId);
    const visible = await this.core.access.visibleCampaignIds(actor, 'EXCLUSIVE', organizationId);
    const only = visible ? { id: { in: visible } } : {};
    const where: Prisma.HotDealWhereInput = {
      organizationId,
      ...only,
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.q
        ? {
            OR: [
              { titleEn: { contains: q.q, mode: 'insensitive' } },
              { titleAr: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const page = await keysetPage({
      findMany: (query) => this.prisma.hotDeal.findMany({ ...query, include: { inventory: true } }),
      baseWhere: where as Record<string, unknown>,
      sort: { field: 'updatedAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const urls = await this.files.signedUrls(
      page.items.map((d) => parseHotContent(d.content).media[0]?.fileId),
      900,
    );
    const rows: HotDealRow[] = page.items.map((d) => {
      const c = parseHotContent(d.content);
      const first = c.media[0];
      const sum = (f: 'total' | 'available' | 'reserved' | 'redeemed') =>
        d.inventory.reduce((n, i) => n + i[f], 0);
      return {
        id: d.id,
        status: d.status,
        title: c.title,
        offerLabel: c.offerLabel,
        limitType: d.limitType,
        branchCount: d.inventory.length,
        startAt: c.startAt,
        endAt: c.endAt,
        imageUrl: first ? (urls.get(first.fileId) ?? null) : null,
        availableUnits: sum('available'),
        totalUnits: sum('total'),
        reservedUnits: sum('reserved'),
        redeemedUnits: sum('redeemed'),
        updatedAt: d.updatedAt.toISOString(),
      };
    });
    return new Page(rows, page.nextCursor);
  }

  async summary(actor: Actor, organizationId: string) {
    this.core.requireMerchantScope(actor, organizationId);
    const visible = await this.core.access.visibleCampaignIds(actor, 'EXCLUSIVE', organizationId);
    const only = visible ? { id: { in: visible } } : {};
    const rows = await this.prisma.hotDeal.groupBy({
      by: ['status'],
      where: { organizationId, ...only },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r._count._all;
    return { counts, total: rows.reduce((n, r) => n + r._count._all, 0) };
  }

  async get(actor: Actor, organizationId: string, id: string): Promise<HotDealView> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'read');
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async history(actor: Actor, organizationId: string, id: string) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'read');
    await this.core.loadOwned(organizationId, id);
    const rows = await this.prisma.hotDealHistory.findMany({
      where: { dealId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((h) => this.view.historyView(h, true));
  }

  /** Customer preview: what a signed-in customer without benefits would see (so locked states are visible). */
  async preview(actor: Actor, organizationId: string, id: string) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'read');
    return this.previewOf(await this.core.loadOwned(organizationId, id));
  }

  async previewOf(deal: HotRow) {
    const content = parseHotContent(deal.content);
    const city =
      content.eligibility.kind === 'GEOGRAPHY'
        ? (content.eligibility.valueRefs[0] ?? 'Riyadh')
        : await this.core.enabledCities().then((c) => c[0] ?? 'Riyadh');
    const outcome = evaluateEligibility(
      content.eligibility.kind,
      this.eligibility.conditionsFor(content.eligibility),
      { userId: 'preview', city, attributes: [], now: new Date() },
      content.eligibility.expression,
    );
    // preview shows the planned allocation even before stock rows exist
    const branches = await this.prisma.merchantBranch.findMany({
      where: {
        id: { in: content.allocations.map((a) => a.branchId) },
        organizationId: deal.organizationId,
      },
    });
    const planned: HotRow = {
      ...deal,
      status: deal.status,
      inventory: branches.map((b) => {
        const existing = deal.inventory.find((i) => i.branchId === b.id);
        const units = content.allocations.find((a) => a.branchId === b.id)?.units ?? 0;
        return (
          existing ?? {
            dealId: deal.id,
            branchId: b.id,
            total: units,
            available: units,
            reserved: 0,
            redeemed: 0,
            released: 0,
            tracked: units > 0,
            updatedAt: new Date(),
            branch: b,
          }
        );
      }),
    };
    return this.view.detail(
      {
        ...planned,
        status:
          deal.status === 'DRAFT' ||
          deal.status === 'PENDING_REVIEW' ||
          deal.status === 'NEEDS_CHANGES'
            ? 'LIVE'
            : deal.status,
      },
      content,
      { outcome },
      new Map(),
      { remainingForMe: content.perCustomerLimit, myReservations: [], restriction: null },
    );
  }

  // ---------------------------------------------------------------- writing
  async create(
    actor: Actor,
    organizationId: string,
    input: HotDealContent,
    meta: RequestMeta,
  ): Promise<HotDealView> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.newCampaign(actor, 'EXCLUSIVE', organizationId, input);
    const content = dedupe(input);
    content.commercial.creatorOrganizationId = campaignCreator(
      actor,
      null,
      content.commercial.creatorOrganizationId,
    );
    await this.core.validateReferences(organizationId, content);
    const id = await this.prisma.$transaction(async (tx) => {
      const deal = await tx.hotDeal.create({
        data: {
          organizationId,
          content: content as unknown as Prisma.InputJsonValue,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.core.applyContent(tx, { ...deal, status: 'DRAFT' }, content, actor.userId, {
        bumpVersion: false,
      });
      await this.core.record(tx, deal, { action: 'CREATE', to: 'DRAFT', actor, meta });
      return deal.id;
    });
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async update(
    actor: Actor,
    organizationId: string,
    id: string,
    input: HotDealContent,
    expectedVersion: number | undefined,
    meta: RequestMeta,
  ): Promise<{ deal: HotDealView; outcome: 'SAVED' | 'APPLIED_MINOR' }> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'write');
    await this.core.access.newCampaign(actor, 'EXCLUSIVE', organizationId, input);
    const deal = await this.core.loadOwned(organizationId, id);
    if (expectedVersion !== undefined && expectedVersion !== deal.version)
      throw new AppError(
        'VERSION_CONFLICT',
        'This deal was changed somewhere else. Reload to see the latest version.',
        409,
      );
    const live = parseHotContent(deal.content);
    const done = async (outcome: 'SAVED' | 'APPLIED_MINOR') => ({
      deal: await this.view.build(await this.core.loadOwned(organizationId, id)),
      outcome,
    });
    const diffFields = (a: HotDealContent, b: HotDealContent) =>
      Object.keys(b).filter(
        (k) => JSON.stringify((a as never)[k]) !== JSON.stringify((b as never)[k]),
      );

    // ---- free editing (drafts and requested changes)
    if (deal.status === 'DRAFT' || deal.status === 'NEEDS_CHANGES') {
      const next = dedupe(input);
      next.commercial.creatorOrganizationId = campaignCreator(
        actor,
        live.commercial.creatorOrganizationId,
        next.commercial.creatorOrganizationId,
      );
      await this.core.validateReferences(organizationId, next);
      const changed = diffFields(live, next);
      if (!changed.length) return done('SAVED');
      await this.prisma.$transaction(async (tx) => {
        await this.core.applyContent(tx, deal, next, actor.userId);
        await this.core.record(tx, deal, {
          action: 'UPDATE',
          from: deal.status,
          to: deal.status,
          actor,
          fields: changed,
          meta,
        });
      });
      return done('SAVED');
    }

    if (deal.status === 'PENDING_REVIEW')
      throw new AppError(
        'EDIT_LOCKED',
        'Your Exclusive Deal is being reviewed. You cannot edit it meanwhile.',
        409,
      );
    if (!HOT_APPROVED_STATUSES.includes(deal.status) || deal.status === 'SUSPENDED')
      throw new AppError('EDIT_LOCKED', 'This deal can no longer be edited', 409);

    // ---- approved deals: wording and photos only. Stock is changed through the stock endpoint.
    const next = dedupe({ ...input, allocations: live.allocations });
    next.commercial.creatorOrganizationId = campaignCreator(
      actor,
      live.commercial.creatorOrganizationId,
      next.commercial.creatorOrganizationId,
    );
    await this.core.validateReferences(organizationId, next);
    const material = hotMaterialChanges(live, next);
    if (material.length)
      throw new AppError(
        'MATERIAL_EDIT_LOCKED',
        'This change affects what customers receive, so it cannot be made on a live Exclusive Deal. Cancel it and create a new one, or contact DealDash.',
        409,
        material[0],
        material.map((f) => ({ code: 'MATERIAL_EDIT_LOCKED', message: f, field: f })),
      );
    const issues = hotDealIssues(next, { limits: await this.core.limits() }).filter(
      (i) => i.field !== 'startAt',
    );
    if (issues.length) incomplete(issues);
    const changed = diffFields(live, next);
    if (!changed.length) return done('SAVED');
    await this.prisma.$transaction(async (tx) => {
      await this.core.applyContent(tx, deal, next, actor.userId);
      await this.core.record(tx, deal, {
        action: 'MINOR_EDIT',
        from: deal.status,
        to: deal.status,
        actor,
        fields: changed,
        snapshot: { before: live, after: next },
        meta,
      });
    });
    return done('APPLIED_MINOR');
  }

  async submit(
    actor: Actor,
    organizationId: string,
    id: string,
    meta: RequestMeta,
  ): Promise<{ deal: HotDealView; outcome: 'SENT_FOR_REVIEW' | 'PUBLISHED' | 'SCHEDULED' }> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'write');
    const deal = await this.core.loadOwned(organizationId, id);
    if (deal.status !== 'DRAFT' && deal.status !== 'NEEDS_CHANGES')
      throw new AppError('INVALID_STATE', `A ${deal.status} deal cannot be submitted`, 409);
    const now = new Date();
    const content = parseHotContent(deal.content);
    const issues = hotDealIssues(content, { now, limits: await this.core.limits() });
    if (issues.length) incomplete(issues);
    await this.core.validateReferences(organizationId, content);
    // RC-21: a deal with reservations needs a commitment method the effective reservation policy allows
    const commitment = await this.core.commitmentIssues(organizationId, content);
    if (commitment.length) incomplete(commitment);
    await this.core.requireActiveBranch(
      organizationId,
      content.allocations.map((a) => a.branchId),
    );
    // Commercial governance: the owner must have reviewed and accepted the economics before anything is sent to DealDash.
    await this.core.commercial.assertCanSubmit('EXCLUSIVE', id, actor);
    const trust = await this.core.merchantTrust(organizationId);
    const g = await this.guardrails.evaluate(content, trust, GUARD_KEYS);
    const commerciallyReady =
      (await this.core.commercial.blockersFor('EXCLUSIVE', id)).length === 0;
    const finish = async (outcome: 'SENT_FOR_REVIEW' | 'PUBLISHED' | 'SCHEDULED') => ({
      deal: await this.view.build(await this.core.loadOwned(organizationId, id)),
      outcome,
    });
    if (g.outcome === 'AUTO_PUBLISH' && commerciallyReady) {
      const to = await this.prisma.$transaction((tx) =>
        this.core.approveDeal(
          tx,
          deal,
          { action: 'AUTO_APPROVE', actor: null, reason: 'Approved by guardrails', meta },
          now,
        ),
      );
      return finish(to === 'LIVE' ? 'PUBLISHED' : 'SCHEDULED');
    }
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, deal, 'PENDING_REVIEW', {
        action: 'SUBMIT',
        actor,
        reason: g.reasons.join(', '),
        data: { submittedAt: now },
        meta,
      }),
    );
    return finish('SENT_FOR_REVIEW');
  }

  private requireStatus(deal: HotRow, allowed: HotRow['status'][], verb: string) {
    if (!allowed.includes(deal.status))
      throw new AppError('INVALID_STATE', `A ${deal.status} deal cannot be ${verb}`, 409);
  }

  async pause(
    actor: Actor,
    organizationId: string,
    id: string,
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'write');
    const deal = await this.core.loadOwned(organizationId, id);
    this.requireStatus(deal, ['LIVE', 'SCHEDULED', 'SOLD_OUT'], 'paused');
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, deal, 'PAUSED', {
        action: 'PAUSE',
        actor,
        reason,
        data: { pausedBy: 'MERCHANT' },
        meta,
      }),
    );
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  /** The status a paused or reinstated deal returns to: its dates decide, then stock (no units left = SOLD_OUT). */
  async statusOnReturn(
    deal: HotRow,
    now: Date,
  ): Promise<'SCHEDULED' | 'LIVE' | 'SOLD_OUT' | 'EXPIRED'> {
    const base = hotStatusFromDates(deal.startAt, deal.endAt, now);
    if (base !== 'LIVE') return base;
    const tracked = deal.inventory.filter((i) => i.tracked && i.branch.status === 'ACTIVE');
    return tracked.length && tracked.every((i) => i.available <= 0) ? 'SOLD_OUT' : 'LIVE';
  }

  async resume(actor: Actor, organizationId: string, id: string, meta: RequestMeta) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'write');
    const deal = await this.core.loadOwned(organizationId, id);
    this.requireStatus(deal, ['PAUSED'], 'resumed');
    if (deal.pausedBy === 'DEALDASH')
      throw new AppError(
        'INVALID_STATE',
        'DealDash paused this deal. Contact support to have it resumed.',
        409,
      );
    const now = new Date();
    const to = await this.statusOnReturn(deal, now);
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, deal, to, {
        action: 'RESUME',
        actor,
        data: { pausedBy: null, ...(to === 'EXPIRED' ? { endedAt: now } : {}) },
        meta,
      }),
    );
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  /** Cancel the campaign: held reservations are cancelled and their customers told, units are released. */
  async cancel(
    actor: Actor,
    organizationId: string,
    id: string,
    reason: string,
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'write');
    const deal = await this.core.loadOwned(organizationId, id);
    this.requireStatus(deal, ['LIVE', 'SCHEDULED', 'PAUSED', 'SOLD_OUT'], 'cancelled');
    const now = new Date();
    const sent = await this.prisma.$transaction(async (tx) => {
      await this.core.transition(tx, deal, 'CANCELLED', {
        action: 'CANCEL',
        actor,
        reason,
        data: { endedAt: now, pausedBy: null },
        meta,
      });
      return this.reservations.cancelAllHeld(
        tx,
        id,
        'MERCHANT',
        actor,
        `Campaign cancelled: ${reason}`,
        meta,
        now,
      );
    });
    await this.notifications.dispatch(sent);
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async addStock(
    actor: Actor,
    organizationId: string,
    id: string,
    body: { branchId: string; delta: number; reason?: string },
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'write');
    const deal = await this.core.loadOwned(organizationId, id);
    this.requireStatus(deal, ['SCHEDULED', 'LIVE', 'PAUSED', 'SOLD_OUT'], 'restocked');
    const { maxUnitsPerBranch } = await this.core.limits();
    if (body.delta > 0) {
      const inv = await this.prisma.hotDealInventory.findMany({
        where: { dealId: id, tracked: true },
      });
      await this.core.commercial.requireCoverage(
        'EXCLUSIVE',
        id,
        inv.reduce((n, i) => n + i.total, 0) + body.delta,
        actor,
      );
    }
    await this.reservations.adjustStock(
      actor,
      deal,
      body.branchId,
      body.delta,
      body.reason,
      maxUnitsPerBranch,
      meta,
    );
    if (body.delta > 0) {
      // an accepted increase is a controlled amendment: it becomes the next campaign version
      const fresh = await this.core.loadOwned(organizationId, id);
      const quotationId = await this.core.commercial.acceptedQuotationId('EXCLUSIVE', id);
      await this.prisma.$transaction((tx) =>
        this.core.versions.recordLive(tx, {
          product: 'EXCLUSIVE',
          subjectId: id,
          organizationId,
          content: fresh.content,
          reason: 'AMENDMENT',
          quotationId,
          userId: actor.userId,
        }),
      );
    }
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  // ---------------------------------------------------------------- live monitor
  async monitor(
    actor: Actor,
    organizationId: string,
    id: string,
    now = new Date(),
  ): Promise<HotMonitor> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'read');
    return this.monitorOf(await this.core.loadOwned(organizationId, id), now);
  }

  /** Shared with the admin monitor. Measurable steps only: no sales, no revenue. */
  async monitorOf(deal: HotRow, now = new Date()): Promise<HotMonitor> {
    const noticeMin = await this.core.expiringNoticeMinutes();
    const [byStatus, soon, events] = await Promise.all([
      this.prisma.reservation.groupBy({
        by: ['status'],
        where: { dealId: deal.id },
        _count: { _all: true },
      }),
      this.prisma.reservation.count({
        where: {
          dealId: deal.id,
          status: 'HELD',
          expiresAt: { gt: now, lte: new Date(now.getTime() + noticeMin * 60_000) },
        },
      }),
      this.prisma.dealEvent.groupBy({
        by: ['type'],
        where: { dealId: deal.id, productType: 'HOT', type: { in: ['IMPRESSION', 'DETAIL_VIEW'] } },
        _count: { _all: true },
      }),
    ]);
    const n = (s: ReservationStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
    const created = byStatus.reduce((a, r) => a + r._count._all, 0);
    const ev = (t: string) => events.find((e) => e.type === t)?._count._all ?? 0;
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
    const inventory = this.view.inventoryRows(deal);
    const sum = (f: 'total' | 'available' | 'reserved' | 'redeemed') =>
      deal.inventory.reduce((x, i) => x + i[f], 0);
    return {
      status: deal.status,
      startAt: deal.startAt ? deal.startAt.toISOString() : null,
      endAt: deal.endAt ? deal.endAt.toISOString() : null,
      serverNow: now.toISOString(),
      totals: {
        total: sum('total'),
        available: sum('available'),
        reserved: sum('reserved'),
        redeemed: sum('redeemed'),
      },
      inventory,
      reservations: {
        held: n('HELD'),
        redeemed: n('REDEEMED'),
        expired: n('EXPIRED'),
        cancelled: n('CANCELLED'),
        expiringSoon: soon,
      },
      funnel: {
        impressions: ev('IMPRESSION'),
        detailViews: ev('DETAIL_VIEW'),
        reservationsCreated: created,
        reservationsCancelled: n('CANCELLED'),
        reservationsExpired: n('EXPIRED'),
        redeemed: n('REDEEMED'),
        notCompleted: n('EXPIRED'),
        viewToReservationPct: pct(created, ev('DETAIL_VIEW')),
        reservationToRedeemedPct: pct(n('REDEEMED'), created),
      },
      disclaimerKey: 'discovery_and_reservation_signals_only',
    };
  }

  async activity(actor: Actor, organizationId: string, id: string) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'read');
    await this.core.loadOwned(organizationId, id);
    return this.activityOf(id, true);
  }

  async activityOf(dealId: string, forMerchant: boolean) {
    const [hist, events] = await Promise.all([
      this.prisma.hotDealHistory.findMany({
        where: { dealId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.reservationEvent.findMany({
        where: { reservation: { dealId }, type: { not: 'EXPIRING_NOTICE' } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { reservation: { select: { manualCode: true } } },
      }),
    ]);
    const items = [
      ...hist.map((h) => ({
        id: h.id,
        at: h.createdAt.toISOString(),
        source: 'deal' as const,
        code: h.action as string,
        note: h.reason,
        actor: forMerchant && h.byDealDash ? 'DealDash' : h.actorName,
        ref: null as string | null,
      })),
      ...events.map((e) => ({
        id: e.id,
        at: e.createdAt.toISOString(),
        source: 'reservation' as const,
        code: e.type as string,
        note: e.note,
        actor: null as string | null,
        ref: e.reservation.manualCode.slice(-4),
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
    return items.slice(0, 60);
  }

  // ---------------------------------------------------------------- reservations of one deal
  async reservationsFor(
    actor: Actor,
    organizationId: string,
    id: string,
    q: {
      limit: number;
      cursor?: string;
      status?: ReservationStatus;
      branchId?: string;
      q?: string;
    },
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'EXCLUSIVE', organizationId, id, 'read');
    await this.core.loadOwned(organizationId, id);
    return this.reservations.listForDeal(organizationId, id, q, {
      canCancel: actor.permissions.has('merchant.deals.manage'),
      canReverse: actor.permissions.has('merchant.redemptions.reverse'),
    });
  }

  async cancelReservation(
    actor: Actor,
    organizationId: string,
    reservationId: string,
    reason: string,
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    if (this.core.access.isScoped(actor)) {
      const r = await this.prisma.reservation.findFirst({
        where: { id: reservationId, organizationId },
        select: { dealId: true, branchId: true },
      });
      if (!r) throw AppError.notFound();
      await this.core.access.branch(actor, 'merchant.deals.manage', r.branchId, {
        product: 'EXCLUSIVE',
        campaignId: r.dealId,
      });
    }
    return this.reservations.cancel(
      reservationId,
      'MERCHANT',
      actor,
      { organizationId },
      reason,
      meta,
    );
  }
}
