import { Injectable } from '@nestjs/common';
import {
  diffLiveDealContent,
  liveDealIssues,
  type DealDetail,
  type DealIssue,
  type LiveDealContent,
  type LiveDealRow,
  type LiveDealView,
} from '@dealdash/validation';
import { LIVE_DEAL_APPROVED_STATUSES } from '@dealdash/types';
import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { parseContent, statusFromDates } from './deal-content';
import { DealCoreService, DEAL_INCLUDE, type DealRow } from './deal-core.service';
import { DealEventsService } from './deal-events.service';
import { DealPresenterService } from './deal-presenter.service';
import { DealViewService } from './deal-view.service';
import { EligibilityService, evaluateEligibility } from './eligibility.service';
import { GuardrailsService } from './guardrails.service';

export interface DealListQuery {
  limit: number;
  cursor?: string;
  status?: string;
  q?: string;
  branchId?: string;
  attention?: boolean;
}

const dedupe = (c: LiveDealContent): LiveDealContent => ({
  ...c,
  branchIds: [...new Set(c.branchIds)],
  media: c.media.filter((m, i, a) => a.findIndex((x) => x.fileId === m.fileId) === i),
  eligibility: { ...c.eligibility, valueRefs: [...new Set(c.eligibility.valueRefs)] },
});

function incomplete(issues: DealIssue[]): never {
  throw new AppError(
    'DEAL_INCOMPLETE',
    'Complete the required fields before submitting',
    422,
    undefined,
    issues.map((i) => ({ code: 'DEAL_INCOMPLETE', message: i.code, field: i.field })),
  );
}

/** Merchant Portal operations on Live Deals. Every method is scoped to the caller's own organisation. */
@Injectable()
export class MerchantDealsService {
  constructor(
    private readonly core: DealCoreService,
    private readonly view: DealViewService,
    private readonly presenter: DealPresenterService,
    private readonly guardrails: GuardrailsService,
    private readonly eligibility: EligibilityService,
    private readonly events: DealEventsService,
    private readonly files: FilesService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  // ---------------------------------------------------------------- reading
  async list(actor: Actor, organizationId: string, q: DealListQuery): Promise<Page<LiveDealRow>> {
    this.core.requireMerchantScope(actor, organizationId);
    const visible = await this.core.access.visibleCampaignIds(actor, 'LIVE_DEAL', organizationId);
    const only = visible ? { id: { in: visible } } : {};
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 86_400_000);
    const where: Prisma.LiveDealWhereInput = {
      organizationId,
      ...only,
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.branchId ? { branches: { some: { branchId: q.branchId } } } : {}),
      ...(q.q
        ? {
            OR: [
              { titleEn: { contains: q.q, mode: 'insensitive' } },
              { titleAr: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.attention
        ? {
            AND: [
              {
                OR: [
                  { status: 'NEEDS_CHANGES' },
                  { revisions: { some: { status: 'NEEDS_CHANGES' } } },
                  { status: { in: ['LIVE', 'SCHEDULED'] }, endAt: { gt: now, lte: soon } },
                ],
              },
            ],
          }
        : {}),
    };
    const page = await keysetPage({
      findMany: (query) =>
        this.prisma.liveDeal.findMany({
          ...query,
          include: {
            branches: true,
            revisions: { where: { status: { in: ['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES'] } } },
          },
        }),
      baseWhere: where as Record<string, unknown>,
      sort: { field: 'updatedAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const urls = await this.files.signedUrls(
      page.items.map((d) => parseContent(d.content).media[0]?.fileId),
      900,
    );
    const clicks = await this.events.directionsClicks(page.items.map((d) => d.id));
    const rows: LiveDealRow[] = page.items.map((d) => {
      const c = parseContent(d.content);
      const rev = d.revisions[0];
      const first = c.media[0];
      return {
        id: d.id,
        status: d.status,
        title: c.title,
        offerLabel: c.offerLabel,
        branchCount: d.branches.length,
        startAt: c.startAt,
        endAt: c.endAt,
        imageUrl: first ? (urls.get(first.fileId) ?? null) : null,
        hasPendingRevision: !!rev,
        needsAttention:
          d.status === 'NEEDS_CHANGES' ||
          rev?.status === 'NEEDS_CHANGES' ||
          (['LIVE', 'SCHEDULED'].includes(d.status) &&
            !!d.endAt &&
            d.endAt.getTime() > now.getTime() &&
            d.endAt.getTime() <= soon.getTime()),
        directionsClicks: clicks.get(d.id) ?? 0,
        updatedAt: d.updatedAt.toISOString(),
      };
    });
    return new Page(rows, page.nextCursor);
  }

  async summary(actor: Actor, organizationId: string) {
    this.core.requireMerchantScope(actor, organizationId);
    const visible = await this.core.access.visibleCampaignIds(actor, 'LIVE_DEAL', organizationId);
    const only = visible ? { id: { in: visible } } : {};
    const rows = await this.prisma.liveDeal.groupBy({
      by: ['status'],
      where: { organizationId, ...only },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r._count._all;
    return { counts: out, total: rows.reduce((n, r) => n + r._count._all, 0) };
  }

  async get(actor: Actor, organizationId: string, id: string): Promise<LiveDealView> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'LIVE_DEAL', organizationId, id, 'read');
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async history(actor: Actor, organizationId: string, id: string) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'LIVE_DEAL', organizationId, id, 'read');
    await this.core.loadOwned(organizationId, id);
    const rows = await this.prisma.liveDealHistory.findMany({
      where: { dealId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((h) => this.view.historyView(h, true));
  }

  /**
   * Customer preview of what is being edited: the open revision when there is one, otherwise the deal itself.
   * Shown with the label a signed-in customer without benefits would see (so locked states are visible to the merchant).
   */
  async preview(actor: Actor, organizationId: string, id: string): Promise<DealDetail> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'LIVE_DEAL', organizationId, id, 'read');
    const deal = await this.core.loadOwned(organizationId, id);
    const rev = await this.core.openRevision(id);
    const content = rev ? parseContent(rev.content) : parseContent(deal.content);
    return this.previewOf(deal, content);
  }

  /** Shared with the admin review (same preview, different authorisation). */
  async previewOf(deal: DealRow, content: LiveDealContent): Promise<DealDetail> {
    const [branches, category] = await Promise.all([
      this.prisma.merchantBranch.findMany({
        where: { id: { in: content.branchIds }, organizationId: deal.organizationId },
      }),
      content.categoryId
        ? this.prisma.category.findUnique({ where: { id: content.categoryId } })
        : null,
    ]);
    const city =
      content.eligibility.kind === 'GEOGRAPHY'
        ? (content.eligibility.valueRefs[0] ?? 'Riyadh')
        : 'Riyadh';
    const outcome = evaluateEligibility(
      content.eligibility.kind,
      this.eligibility.conditionsFor(content.eligibility),
      { userId: 'preview', city, attributes: [], now: new Date() },
      content.eligibility.expression,
    );
    const row: DealRow = {
      ...deal,
      category,
      branches: branches.map((b) => ({ dealId: deal.id, branchId: b.id, branch: b })),
    };
    return this.presenter.detail(
      row,
      content,
      { outcome, nearest: { distanceMeters: null, branchId: branches[0]?.id ?? null } },
      branches.filter((b) => b.status === 'ACTIVE'),
      new Map(),
    );
  }

  async performance(
    actor: Actor,
    organizationId: string,
    id: string,
    range: { from?: string; to?: string },
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'LIVE_DEAL', organizationId, id, 'read');
    const deal = await this.core.loadOwned(organizationId, id);
    const names = new Map(
      deal.branches.map((b) => [b.branch.id, { en: b.branch.nameEn, ar: b.branch.nameAr }]),
    );
    return this.events.performance(organizationId, id, range, names);
  }

  // ---------------------------------------------------------------- writing
  async create(
    actor: Actor,
    organizationId: string,
    input: LiveDealContent,
    meta: RequestMeta,
  ): Promise<LiveDealView> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.newCampaign(actor, 'LIVE_DEAL', organizationId, input);
    const content = dedupe(input);
    await this.core.validateReferences(organizationId, content);
    const id = await this.prisma.$transaction(async (tx) => {
      const deal = await tx.liveDeal.create({
        data: {
          organizationId,
          content: content as unknown as Prisma.InputJsonValue,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.core.applyContent(tx, deal, content, actor.userId, { bumpVersion: false });
      await this.core.record(tx, deal, { action: 'CREATE', to: 'DRAFT', actor, meta });
      return deal.id;
    });
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async update(
    actor: Actor,
    organizationId: string,
    id: string,
    input: LiveDealContent,
    expectedVersion: number | undefined,
    meta: RequestMeta,
  ): Promise<{
    deal: LiveDealView;
    outcome: 'SAVED' | 'APPLIED_MINOR' | 'REVISION_SAVED';
    material: string[];
  }> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'LIVE_DEAL', organizationId, id, 'write');
    await this.core.access.newCampaign(actor, 'LIVE_DEAL', organizationId, input);
    const deal = await this.core.loadOwned(organizationId, id);
    if (expectedVersion !== undefined && expectedVersion !== deal.version)
      throw new AppError(
        'VERSION_CONFLICT',
        'This deal was changed somewhere else. Reload to see the latest version.',
        409,
      );
    const next = dedupe(input);
    await this.core.validateReferences(organizationId, next);
    const live = parseContent(deal.content);
    const materialFields = await this.core.materialFields();
    const done = async (
      outcome: 'SAVED' | 'APPLIED_MINOR' | 'REVISION_SAVED',
      material: string[] = [],
    ) => ({
      deal: await this.view.build(await this.core.loadOwned(organizationId, id)),
      outcome,
      material,
    });

    // ---- free editing (drafts and requested changes)
    if (deal.status === 'DRAFT' || deal.status === 'NEEDS_CHANGES') {
      const diff = diffLiveDealContent(live, next, materialFields);
      if (!diff.changed.length) return done('SAVED');
      await this.prisma.$transaction(async (tx) => {
        await this.core.applyContent(tx, deal, next, actor.userId);
        await this.core.record(tx, deal, {
          action: 'UPDATE',
          from: deal.status,
          to: deal.status,
          actor,
          fields: diff.changed,
          meta,
        });
      });
      return done('SAVED');
    }

    // ---- approved deals: minor edits publish with audit, material edits go to review as a new version
    if (!LIVE_DEAL_APPROVED_STATUSES.includes(deal.status))
      throw new AppError('EDIT_LOCKED', 'This deal can no longer be edited', 409);
    const rev = await this.core.openRevision(id);
    if (rev?.status === 'PENDING_REVIEW')
      throw new AppError(
        'EDIT_LOCKED',
        'Your changes are being reviewed. Withdraw them to edit again.',
        409,
      );

    const now = new Date();
    const issues = liveDealIssues(next, { now });
    if (issues.length) incomplete(issues);
    await this.core.requireActiveBranch(organizationId, next.branchIds);
    const startedAt = deal.startAt;
    const nextStart = next.startAt ? new Date(next.startAt).getTime() : null;
    if (startedAt && startedAt.getTime() <= now.getTime() && nextStart !== startedAt.getTime())
      throw AppError.validation(
        'The start date cannot change after the deal has started',
        'startAt',
      );

    const diff = diffLiveDealContent(live, next, materialFields);
    if (!diff.changed.length) {
      if (rev) await this.withdrawRevision(actor, deal, rev.id, meta);
      return done('SAVED');
    }
    if (!diff.material.length) {
      await this.prisma.$transaction(async (tx) => {
        await this.core.applyContent(tx, deal, next, actor.userId);
        if (rev) {
          await tx.liveDealRevision.update({
            where: { id: rev.id },
            data: { status: 'WITHDRAWN' },
          });
          await this.core.record(tx, deal, {
            action: 'REVISION_DISCARD',
            actor,
            revisionId: rev.id,
            reason: 'Replaced by a minor edit',
            meta,
          });
        }
        await this.core.record(tx, deal, {
          action: 'MINOR_EDIT',
          from: deal.status,
          to: deal.status,
          actor,
          fields: diff.changed,
          snapshot: { before: live, after: next },
          meta,
        });
      });
      return done('APPLIED_MINOR');
    }

    // material: keep serving the approved version, save the proposal as a revision
    await this.prisma.$transaction(async (tx) => {
      if (rev) {
        await tx.liveDealRevision.update({
          where: { id: rev.id },
          data: {
            content: next as unknown as Prisma.InputJsonValue,
            materialFields: diff.material as Prisma.InputJsonValue,
            baseVersion: deal.version,
          },
        });
        await this.core.record(tx, deal, {
          action: 'UPDATE',
          from: deal.status,
          to: deal.status,
          actor,
          fields: diff.changed,
          revisionId: rev.id,
          meta,
        });
      } else {
        const last = await tx.liveDealRevision.aggregate({
          where: { dealId: id },
          _max: { number: true },
        });
        const created = await tx.liveDealRevision.create({
          data: {
            dealId: id,
            number: (last._max.number ?? 0) + 1,
            content: next as unknown as Prisma.InputJsonValue,
            materialFields: diff.material as Prisma.InputJsonValue,
            baseVersion: deal.version,
            createdByUserId: actor.userId,
          },
        });
        await this.core.record(tx, deal, {
          action: 'REVISION_SAVED',
          from: deal.status,
          to: deal.status,
          actor,
          fields: diff.material,
          revisionId: created.id,
          snapshot: { before: live, after: next },
          meta,
        });
      }
    });
    return done('REVISION_SAVED', diff.material);
  }

  async submit(
    actor: Actor,
    organizationId: string,
    id: string,
    meta: RequestMeta,
  ): Promise<{ deal: LiveDealView; outcome: 'SENT_FOR_REVIEW' | 'PUBLISHED' | 'SCHEDULED' }> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'LIVE_DEAL', organizationId, id, 'write');
    const deal = await this.core.loadOwned(organizationId, id);
    const now = new Date();
    const trust = await this.core.merchantTrust(organizationId);
    const finish = async (outcome: 'SENT_FOR_REVIEW' | 'PUBLISHED' | 'SCHEDULED') => ({
      deal: await this.view.build(await this.core.loadOwned(organizationId, id)),
      outcome,
    });

    if (deal.status === 'DRAFT' || deal.status === 'NEEDS_CHANGES') {
      const content = parseContent(deal.content);
      const issues = liveDealIssues(content, { now });
      if (issues.length) incomplete(issues);
      await this.core.validateReferences(organizationId, content);
      await this.core.requireActiveBranch(organizationId, content.branchIds);
      const g = await this.guardrails.evaluate(content, trust);
      if (g.outcome === 'AUTO_PUBLISH') {
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

    if (LIVE_DEAL_APPROVED_STATUSES.includes(deal.status)) {
      const rev = await this.core.openRevision(id);
      if (!rev || rev.status === 'PENDING_REVIEW')
        throw new AppError('INVALID_STATE', 'There are no changes to submit', 409);
      const content = parseContent(rev.content);
      const issues = liveDealIssues(content, { now });
      if (issues.length) incomplete(issues);
      await this.core.validateReferences(organizationId, content);
      await this.core.requireActiveBranch(organizationId, content.branchIds);
      const g = await this.guardrails.evaluate(content, trust);
      if (g.outcome === 'AUTO_PUBLISH') {
        await this.prisma.$transaction((tx) =>
          this.core.approveRevision(
            tx,
            deal,
            rev,
            {
              action: 'REVISION_AUTO_APPROVE',
              actor: null,
              reason: 'Approved by guardrails',
              meta,
            },
            now,
          ),
        );
        return finish('PUBLISHED');
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.liveDealRevision.update({
          where: { id: rev.id },
          data: { status: 'PENDING_REVIEW', submittedAt: now },
        });
        await this.core.record(tx, deal, {
          action: 'REVISION_SUBMIT',
          from: deal.status,
          to: deal.status,
          actor,
          revisionId: rev.id,
          fields: (rev.materialFields as string[]) ?? [],
          reason: g.reasons.join(', '),
          meta,
        });
      });
      return finish('SENT_FOR_REVIEW');
    }
    throw new AppError('INVALID_STATE', `A ${deal.status} deal cannot be submitted`, 409);
  }

  async pause(
    actor: Actor,
    organizationId: string,
    id: string,
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'LIVE_DEAL', organizationId, id, 'write');
    const deal = await this.core.loadOwned(organizationId, id);
    this.requireStatus(deal, ['LIVE', 'SCHEDULED'], 'paused');
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

  async resume(actor: Actor, organizationId: string, id: string, meta: RequestMeta) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'LIVE_DEAL', organizationId, id, 'write');
    const deal = await this.core.loadOwned(organizationId, id);
    this.requireStatus(deal, ['PAUSED'], 'resumed');
    if (deal.pausedBy === 'DEALDASH')
      throw new AppError(
        'INVALID_STATE',
        'DealDash paused this deal. Contact support to have it resumed.',
        409,
      );
    const to = statusFromDates(deal.startAt, deal.endAt, new Date());
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, deal, to, {
        action: 'RESUME',
        actor,
        data: { pausedBy: null, ...(to === 'EXPIRED' ? { endedAt: new Date() } : {}) },
        meta,
      }),
    );
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  /** End early (cancel): the deal expires now. */
  async end(actor: Actor, organizationId: string, id: string, reason: string, meta: RequestMeta) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'LIVE_DEAL', organizationId, id, 'write');
    const deal = await this.core.loadOwned(organizationId, id);
    this.requireStatus(deal, ['LIVE', 'SCHEDULED', 'PAUSED'], 'ended');
    await this.prisma.$transaction(async (tx) => {
      await this.core.transition(tx, deal, 'EXPIRED', {
        action: 'END',
        actor,
        reason,
        data: { endedAt: new Date(), pausedBy: null },
        meta,
      });
      // an open proposal for a deal that no longer exists is withdrawn with it
      await tx.liveDealRevision.updateMany({
        where: { dealId: id, status: { in: ['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES'] } },
        data: { status: 'WITHDRAWN' },
      });
    });
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async discardRevision(actor: Actor, organizationId: string, id: string, meta: RequestMeta) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'LIVE_DEAL', organizationId, id, 'write');
    const deal = await this.core.loadOwned(organizationId, id);
    const rev = await this.core.openRevision(id);
    if (!rev) throw new AppError('INVALID_STATE', 'There are no pending changes', 409);
    await this.withdrawRevision(actor, deal, rev.id, meta);
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  /** Merchants may only act on their own deal states; suspended deals are DealDash's to release. */
  private requireStatus(deal: DealRow, allowed: DealRow['status'][], verb: string) {
    if (!allowed.includes(deal.status))
      throw new AppError('INVALID_STATE', `A ${deal.status} deal cannot be ${verb}`, 409);
  }

  private async withdrawRevision(
    actor: Actor,
    deal: DealRow,
    revisionId: string,
    meta: RequestMeta,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.liveDealRevision.update({
        where: { id: revisionId },
        data: { status: 'WITHDRAWN' },
      });
      await this.core.record(tx, deal, {
        action: 'REVISION_DISCARD',
        actor,
        revisionId,
        meta,
      });
    });
  }
}

export { DEAL_INCLUDE };
