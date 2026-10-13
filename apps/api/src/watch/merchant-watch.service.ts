import { Injectable } from '@nestjs/common';
import {
  watchIssues,
  watchMaterialChanges,
  type WatchCampaignView,
  type WatchContent,
  type WatchMonitor,
  type WatchRow,
} from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { EligibilityService, evaluateEligibility } from '../live-deals/eligibility.service';
import { watchStatusFromDates, parseWatchContent } from './watch-content';
import { WATCH_APPROVED_STATUSES, WatchCoreService, type WatchRowData } from './watch-core.service';
import { WatchFundingService } from './watch-funding.service';
import { WatchViewService } from './watch-view.service';

export interface WatchListQuery {
  limit: number;
  cursor?: string;
  status?: string;
  q?: string;
}

const dedupe = (c: WatchContent): WatchContent => ({
  ...c,
  targeting: {
    ...c.targeting,
    cities: [...new Set(c.targeting.cities)],
    branchIds: [...new Set(c.targeting.branchIds)],
    eligibility: {
      ...c.targeting.eligibility,
      valueRefs: [...new Set(c.targeting.eligibility.valueRefs)],
    },
  },
});

function incomplete(issues: Array<{ field: string; code: string }>): never {
  throw new AppError(
    'DEAL_INCOMPLETE',
    'Complete the required fields before submitting',
    422,
    undefined,
    issues.map((i) => ({ code: 'DEAL_INCOMPLETE', message: i.code, field: i.field })),
  );
}

/** Merchant Portal operations on Watch & Earn campaigns. Every method is scoped to the caller's own organisation. */
@Injectable()
export class MerchantWatchService {
  constructor(
    private readonly core: WatchCoreService,
    private readonly view: WatchViewService,
    private readonly funding: WatchFundingService,
    private readonly eligibility: EligibilityService,
    private readonly files: FilesService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  // ---------------------------------------------------------------- reading
  async options(actor: Actor, organizationId: string) {
    this.core.requireMerchantScope(actor, organizationId);
    const [limits, f] = await Promise.all([this.core.limits(), this.core.frequency()]);
    // the rate card of the business's market, in its currency (a market without a configured rate shows it as unavailable)
    const market = await this.core.markets.profileOfOrganization(organizationId);
    const rate = await this.core.rateCardFor(organizationId, {}).catch(() => null);
    return {
      limits,
      rateCard: {
        chargePerViewHalalas: rate?.chargePerViewHalalas ?? 0,
        version: rate?.version ?? 0,
        placeholder: true as const,
        currency: rate?.currency ?? market.currency,
        available: !!rate,
      },
      minRepeatWindowHours: f.minRepeatWindowHours,
      cities: await this.core.enabledCities(),
      unusedBudgetTreatment: await this.core.unusedTreatment(),
    };
  }

  async list(actor: Actor, organizationId: string, q: WatchListQuery): Promise<Page<WatchRow>> {
    this.core.requireMerchantScope(actor, organizationId);
    const visible = await this.core.access.visibleCampaignIds(actor, 'WATCH', organizationId);
    const only = visible ? { id: { in: visible } } : {};
    const where: Prisma.WatchCampaignWhereInput = {
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
      findMany: (query) => this.prisma.watchCampaign.findMany(query),
      baseWhere: where as Record<string, unknown>,
      sort: { field: 'updatedAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const urls = await this.files.signedUrls(
      page.items.map((d) => d.thumbnailFileId),
      900,
    );
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
        thumbnailUrl: d.thumbnailFileId ? (urls.get(d.thumbnailFileId) ?? null) : null,
        updatedAt: d.updatedAt.toISOString(),
      })),
      page.nextCursor,
    );
  }

  async summary(actor: Actor, organizationId: string) {
    this.core.requireMerchantScope(actor, organizationId);
    const visible = await this.core.access.visibleCampaignIds(actor, 'WATCH', organizationId);
    const only = visible ? { id: { in: visible } } : {};
    const [rows, money] = await Promise.all([
      this.prisma.watchCampaign.groupBy({
        by: ['status'],
        where: { organizationId, ...only },
        _count: { _all: true },
      }),
      this.prisma.watchCampaign.aggregate({
        where: { organizationId, ...only },
        _sum: {
          fundedHalalas: true,
          spentHalalas: true,
          unusedHalalas: true,
          qualifiedViews: true,
        },
      }),
    ]);
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r._count._all;
    return {
      counts,
      total: rows.reduce((n, r) => n + r._count._all, 0),
      money: {
        fundedHalalas: money._sum.fundedHalalas ?? 0,
        spentHalalas: money._sum.spentHalalas ?? 0,
        unusedHalalas: money._sum.unusedHalalas ?? 0,
        qualifiedViews: money._sum.qualifiedViews ?? 0,
      },
    };
  }

  async get(actor: Actor, organizationId: string, id: string): Promise<WatchCampaignView> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'read');
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async history(actor: Actor, organizationId: string, id: string) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'read');
    await this.core.loadOwned(organizationId, id);
    const rows = await this.prisma.watchCampaignHistory.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((h) => this.view.historyView(h, true));
  }

  async budget(actor: Actor, organizationId: string, id: string) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'read');
    return this.funding.detail(await this.core.loadOwned(organizationId, id), true);
  }

  async preview(actor: Actor, organizationId: string, id: string) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'read');
    return this.previewOf(await this.core.loadOwned(organizationId, id));
  }

  /** What a signed-in customer without benefits would see (so locked states are visible to the merchant and the reviewer). */
  async previewOf(c: WatchRowData) {
    const content = this.core.content(c);
    const city = content.targeting.cities[0] ?? 'Riyadh';
    const outcome = evaluateEligibility(
      content.targeting.eligibility.kind,
      this.eligibility.conditionsFor(content.targeting.eligibility),
      { userId: 'preview', city, attributes: [], now: new Date() },
      content.targeting.eligibility.expression,
    );
    return this.view.detail(
      {
        ...c,
        status: ['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES'].includes(c.status) ? 'LIVE' : c.status,
      },
      { outcome, availability: 'AVAILABLE' },
    );
  }

  async monitor(actor: Actor, organizationId: string, id: string): Promise<WatchMonitor> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'read');
    return this.view.monitorOf(await this.core.loadOwned(organizationId, id));
  }

  // ---------------------------------------------------------------- writing
  private async guardFunding(
    c: { fundedHalalas: number; organizationId: string },
    content: WatchContent,
  ) {
    const rate = await this.core.rateCardFor(c.organizationId, content);
    const required = content.paidViews * rate.chargePerViewHalalas;
    if (c.fundedHalalas > required)
      throw AppError.validation(
        'The campaign is already funded for more views than this. Cancel the campaign or contact DealDash.',
        'paidViews',
      );
  }

  async create(actor: Actor, organizationId: string, input: WatchContent, meta: RequestMeta) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.newCampaign(actor, 'WATCH', organizationId, input);
    const content = await this.core.validateReferences(organizationId, dedupe(input));
    const id = await this.prisma.$transaction(async (tx) => {
      // FD-S7-1: a campaign created through the partner portal records the partner as Campaign Creator and budget owner
      // (Sponsor / Funder); set only from the in-process partner context, never from content, so a merchant edit cannot change it.
      const partner = actor.partnerContext?.partnerOrganizationId ?? null;
      const c = await tx.watchCampaign.create({
        data: {
          organizationId,
          creatorOrganizationId: partner,
          sponsorOrganizationId: partner,
          // priced in the campaign's market currency (applyContent re-prices it while the campaign is editable)
          currency: (await this.core.rateCardFor(organizationId, content, tx)).currency,
          content: content as unknown as Prisma.InputJsonValue,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.core.applyContent(tx, { ...c, status: 'DRAFT' }, content, actor.userId, {
        bumpVersion: false,
      });
      await this.core.record(tx, c, { action: 'CREATE', to: 'DRAFT', actor, meta });
      return c.id;
    });
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async update(
    actor: Actor,
    organizationId: string,
    id: string,
    input: WatchContent,
    expectedVersion: number | undefined,
    meta: RequestMeta,
  ): Promise<{ campaign: WatchCampaignView; outcome: 'SAVED' | 'APPLIED_MINOR' }> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'write');
    await this.core.access.newCampaign(actor, 'WATCH', organizationId, input);
    const c = await this.core.loadOwned(organizationId, id);
    if (expectedVersion !== undefined && expectedVersion !== c.version)
      throw new AppError(
        'VERSION_CONFLICT',
        'This campaign was changed somewhere else. Reload to see the latest version.',
        409,
      );
    const live = parseWatchContent(c.content);
    const done = async (outcome: 'SAVED' | 'APPLIED_MINOR') => ({
      campaign: await this.view.build(await this.core.loadOwned(organizationId, id)),
      outcome,
    });
    const diffFields = (a: WatchContent, b: WatchContent) =>
      Object.keys(b).filter(
        (k) => JSON.stringify((a as never)[k]) !== JSON.stringify((b as never)[k]),
      );

    if (c.status === 'DRAFT' || c.status === 'NEEDS_CHANGES') {
      const next = await this.core.validateReferences(organizationId, dedupe(input));
      await this.guardFunding(c, next);
      const changed = diffFields(live, next);
      if (!changed.length) return done('SAVED');
      await this.prisma.$transaction(async (tx) => {
        await this.core.applyContent(tx, c, next, actor.userId);
        await this.core.record(tx, c, {
          action: 'UPDATE',
          from: c.status,
          to: c.status,
          actor,
          fields: changed,
          meta,
        });
      });
      return done('SAVED');
    }
    if (c.status === 'PENDING_REVIEW')
      throw new AppError(
        'EDIT_LOCKED',
        'Your campaign is being reviewed. You cannot edit it meanwhile.',
        409,
      );
    if (!WATCH_APPROVED_STATUSES.includes(c.status) || c.status === 'SUSPENDED')
      throw new AppError('EDIT_LOCKED', 'This campaign can no longer be edited', 409);

    // approved campaigns: wording and the cover image only
    const next = await this.core.validateReferences(
      organizationId,
      dedupe({ ...input, paidViews: live.paidViews }),
    );
    const material = watchMaterialChanges(live, next);
    if (material.length)
      throw new AppError(
        'MATERIAL_EDIT_LOCKED',
        'This change affects what customers see or what you pay for, so it cannot be made on an approved campaign. Stop it and create a new one, or contact DealDash.',
        409,
        material[0],
        material.map((f) => ({ code: 'MATERIAL_EDIT_LOCKED', message: f, field: f })),
      );
    const issues = watchIssues(next, { limits: await this.core.limits() });
    if (issues.length) incomplete(issues);
    const changed = diffFields(live, next);
    if (!changed.length) return done('SAVED');
    await this.prisma.$transaction(async (tx) => {
      await this.core.applyContent(tx, c, next, actor.userId);
      await this.core.record(tx, c, {
        action: 'UPDATE',
        from: c.status,
        to: c.status,
        actor,
        fields: changed,
        snapshot: { before: live, after: next, minor: true },
        meta,
      });
    });
    return done('APPLIED_MINOR');
  }

  async fund(
    actor: Actor,
    organizationId: string,
    id: string,
    amountHalalas: number,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'write');
    await this.funding.fund(actor, organizationId, id, amountHalalas, {
      source: 'MOCK_PAYMENT',
      idempotencyKey,
      meta,
    });
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async submit(
    actor: Actor,
    organizationId: string,
    id: string,
    meta: RequestMeta,
  ): Promise<{
    campaign: WatchCampaignView;
    outcome: 'SENT_FOR_REVIEW' | 'PUBLISHED' | 'SCHEDULED';
  }> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'write');
    const c = await this.core.loadOwned(organizationId, id);
    if (c.status !== 'DRAFT' && c.status !== 'NEEDS_CHANGES')
      throw new AppError('INVALID_STATE', `A ${c.status} campaign cannot be submitted`, 409);
    const now = new Date();
    const f = await this.core.frequency();
    const content = parseWatchContent(c.content);
    const issues = watchIssues(content, {
      now,
      limits: await this.core.limits(),
      minRepeatWindowHours: f.minRepeatWindowHours,
    });
    if (issues.length) incomplete(issues);
    await this.core.validateReferences(organizationId, content);
    if (c.fundedHalalas < c.requiredBudgetHalalas)
      throw new AppError(
        'FUNDING_REQUIRED',
        'Fund the campaign budget before sending it for review',
        402,
        'budget',
      );
    await this.core.commercial.assertCanSubmit('WATCH', id, actor);
    const trust = await this.core.merchantTrust(organizationId);
    const g = await this.view.guardrail(content, trust);
    const commerciallyReady = (await this.core.commercial.blockersFor('WATCH', id)).length === 0;
    const finish = async (outcome: 'SENT_FOR_REVIEW' | 'PUBLISHED' | 'SCHEDULED') => ({
      campaign: await this.view.build(await this.core.loadOwned(organizationId, id)),
      outcome,
    });
    // FD-S7-1: a partner-owned budget always goes through DealDash review (merchant trust never auto-publishes it)
    if (g.outcome === 'AUTO_PUBLISH' && commerciallyReady && !c.sponsorOrganizationId) {
      const to = await this.prisma.$transaction((tx) =>
        this.core.approve(
          tx,
          c,
          { action: 'AUTO_APPROVE', actor: null, reason: 'Approved by guardrails', meta },
          now,
        ),
      );
      return finish(to === 'LIVE' ? 'PUBLISHED' : 'SCHEDULED');
    }
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, c, 'PENDING_REVIEW', {
        action: 'SUBMIT',
        actor,
        reason: g.reasons.join(', '),
        data: { submittedAt: now },
        meta,
      }),
    );
    return finish('SENT_FOR_REVIEW');
  }

  private requireStatus(c: WatchRowData, allowed: WatchRowData['status'][], verb: string) {
    if (!allowed.includes(c.status))
      throw new AppError('INVALID_STATE', `A ${c.status} campaign cannot be ${verb}`, 409);
  }

  async pause(
    actor: Actor,
    organizationId: string,
    id: string,
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'write');
    const c = await this.core.loadOwned(organizationId, id);
    this.requireStatus(c, ['LIVE', 'SCHEDULED'], 'paused');
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, c, 'PAUSED', {
        action: 'PAUSE',
        actor,
        reason,
        data: { pausedBy: 'MERCHANT' },
        meta,
      }),
    );
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async resume(actor: Actor, organizationId: string, id: string, meta: RequestMeta) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'write');
    const c = await this.core.loadOwned(organizationId, id);
    this.requireStatus(c, ['PAUSED'], 'resumed');
    if (c.pausedBy !== 'MERCHANT')
      throw new AppError(
        'INVALID_STATE',
        'DealDash paused this campaign. Contact DealDash to resume it.',
        409,
      );
    await this.resumeTo(actor, c, 'RESUME', meta);
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  /** The status a paused or reinstated campaign returns to: its dates decide, then delivery (all views delivered = COMPLETED). */
  async resumeTo(
    actor: Actor | null,
    c: WatchRowData,
    action: 'RESUME' | 'REINSTATE',
    meta: RequestMeta,
    body: { reason?: string; reasonAr?: string } = {},
  ) {
    const now = new Date();
    let to: WatchRowData['status'] =
      c.qualifiedViews >= c.paidViews && c.paidViews > 0
        ? 'COMPLETED'
        : watchStatusFromDates(c.startAt, c.endAt, now);
    if (to === 'LIVE' && c.fundedHalalas - c.spentHalalas < c.chargePerViewHalalas)
      to = 'COMPLETED';
    await this.prisma.$transaction(async (tx) => {
      await this.core.transition(tx, c, to, {
        action,
        actor,
        reason: body.reason ?? null,
        reasonAr: body.reasonAr ?? null,
        data: {
          pausedBy: null,
          statusBeforeSuspension: null,
          ...(to === 'COMPLETED' || to === 'EXPIRED' ? { endedAt: now } : {}),
        },
        meta,
      });
      if (to === 'COMPLETED' || to === 'EXPIRED') await this.funding.closeOut(tx, c, now);
    });
    return to;
  }

  /** Stops the campaign. Views already qualified keep their rewards; the unused budget is closed out to its own balance. */
  async cancel(
    actor: Actor,
    organizationId: string,
    id: string,
    reason: string,
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'WATCH', organizationId, id, 'write');
    const c = await this.core.loadOwned(organizationId, id);
    this.requireStatus(
      c,
      ['DRAFT', 'NEEDS_CHANGES', 'PENDING_REVIEW', 'SCHEDULED', 'LIVE', 'PAUSED'],
      'cancelled',
    );
    await this.stop(actor, c, reason, meta);
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  /** Shared by the merchant "cancel" and the admin "stop". */
  async stop(actor: Actor, c: WatchRowData, reason: string, meta: RequestMeta, byAdmin = false) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.core.transition(tx, c, 'CANCELLED', {
        action: byAdmin ? 'STOP' : 'CANCEL',
        actor,
        reason,
        data: { endedAt: now, pausedBy: null },
        meta,
      });
      await this.funding.closeOut(tx, c, now);
    });
  }
}
