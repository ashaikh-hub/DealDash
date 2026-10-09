import { Injectable } from '@nestjs/common';
import { liveDealIssues, type AdminDealDetail, type AdminDealRow } from '@dealdash/validation';
import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { decodeCursor, encodeCursor, keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { parseContent, statusFromDates } from './deal-content';
import { FilesService } from '../files/files.service';
import { DealCoreService, type DealRow } from './deal-core.service';
import { DealEventsService } from './deal-events.service';
import { DealViewService } from './deal-view.service';
import { MerchantDealsService } from './merchant-deals.service';

export interface AdminDealListQuery {
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
  branches: true,
} satisfies Prisma.LiveDealInclude;
type RowDeal = Prisma.LiveDealGetPayload<{ include: typeof ROW_INCLUDE }>;

/** DealDash campaign review (Admin): queue, inspection, decisions and emergency controls. Every decision is audited. */
@Injectable()
export class DealReviewService {
  constructor(
    private readonly core: DealCoreService,
    private readonly view: DealViewService,
    private readonly merchantDeals: MerchantDealsService,
    private readonly events: DealEventsService,
    private readonly files: FilesService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  private row(
    d: RowDeal,
    kind: 'NEW' | 'REVISION',
    submittedAt: Date | null,
    title?: { en: string; ar: string },
  ): AdminDealRow {
    const c = parseContent(d.content);
    return {
      id: d.id,
      status: d.status,
      kind,
      title: title ?? c.title,
      merchant: {
        id: d.organizationId,
        nameEn: d.organization.nameEn,
        nameAr: d.organization.nameAr,
        trustLevel: d.organization.merchant?.trustLevel ?? 'NEW',
      },
      branchCount: d.branches.length,
      submittedAt: submittedAt ? submittedAt.toISOString() : null,
      startAt: d.startAt ? d.startAt.toISOString() : null,
      endAt: d.endAt ? d.endAt.toISOString() : null,
    };
  }

  // ---------------------------------------------------------------- lists
  async list(q: AdminDealListQuery): Promise<Page<AdminDealRow>> {
    if (q.queue) return this.queue(q);
    const where: Prisma.LiveDealWhereInput = {
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
      status: q.status ? (q.status as never) : { not: 'DRAFT' },
    };
    const page = await keysetPage({
      findMany: (query) => this.prisma.liveDeal.findMany({ ...query, include: ROW_INCLUDE }),
      baseWhere: where as Record<string, unknown>,
      sort: { field: 'updatedAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    return new Page(
      page.items.map((d) => this.row(d, 'NEW', d.submittedAt)),
      page.nextCursor,
    );
  }

  /** Oldest first. Contains new deals and proposed new versions of approved deals. */
  private async queue(q: AdminDealListQuery): Promise<Page<AdminDealRow>> {
    const dec = decodeCursor(q.cursor);
    const cond = (idField: 'id' | 'dealId') =>
      dec
        ? {
            OR: [
              { submittedAt: { gt: new Date(dec.v as string) } },
              { submittedAt: new Date(dec.v as string), [idField]: { gt: dec.id } },
            ],
          }
        : {};
    const dealFilter: Prisma.LiveDealWhereInput = {
      ...(q.merchantId ? { organizationId: q.merchantId } : {}),
      ...(q.q
        ? {
            OR: [
              { titleEn: { contains: q.q, mode: 'insensitive' } },
              { titleAr: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const take = q.limit + 1;
    const [deals, revisions] = await Promise.all([
      this.prisma.liveDeal.findMany({
        where: { ...dealFilter, status: 'PENDING_REVIEW', ...cond('id') },
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        take,
        include: ROW_INCLUDE,
      }),
      this.prisma.liveDealRevision.findMany({
        where: { status: 'PENDING_REVIEW', deal: dealFilter, ...cond('dealId') },
        orderBy: [{ submittedAt: 'asc' }, { dealId: 'asc' }],
        take,
        include: { deal: { include: ROW_INCLUDE } },
      }),
    ]);
    const merged = [
      ...deals.map((d) => ({
        at: d.submittedAt ?? d.createdAt,
        key: d.id,
        row: this.row(d, 'NEW', d.submittedAt),
      })),
      ...revisions.map((r) => ({
        at: r.submittedAt ?? r.createdAt,
        key: r.dealId,
        row: this.row(r.deal, 'REVISION', r.submittedAt, parseContent(r.content).title),
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime() || (a.key < b.key ? -1 : 1));
    const hasMore = merged.length > q.limit;
    const items = merged.slice(0, q.limit);
    const last = items[items.length - 1];
    return new Page(
      items.map((i) => i.row),
      hasMore && last ? encodeCursor({ v: last.at.toISOString(), id: last.key }) : null,
    );
  }

  // ---------------------------------------------------------------- detail
  async detail(actor: Actor, id: string): Promise<AdminDealDetail> {
    const deal = await this.core.loadAny(id);
    // Drafts are the merchant's private work: DealDash sees a deal from its first submission.
    if (deal.status === 'DRAFT') throw AppError.notFound();
    const base = await this.view.build(deal);
    const rev = await this.core.openRevision(id);
    const reviewTarget: AdminDealDetail['reviewTarget'] =
      deal.status === 'PENDING_REVIEW'
        ? 'DEAL'
        : rev?.status === 'PENDING_REVIEW'
          ? 'REVISION'
          : 'NONE';
    const target =
      reviewTarget === 'REVISION' && rev ? parseContent(rev.content) : parseContent(deal.content);
    const history = await this.prisma.liveDealHistory.findMany({
      where: { dealId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const urls = deal.organization.merchant?.logoFileId
      ? await this.files.signedUrls([deal.organization.merchant.logoFileId], 900)
      : new Map<string, string>();
    return {
      ...base,
      merchant: {
        id: deal.organizationId,
        nameEn: deal.organization.nameEn,
        nameAr: deal.organization.nameAr,
        status: deal.organization.status,
        trustLevel: deal.organization.merchant?.trustLevel ?? 'NEW',
        riskTier: deal.organization.merchant?.riskTier ?? 'STANDARD',
        logoUrl: deal.organization.merchant?.logoFileId
          ? (urls.get(deal.organization.merchant.logoFileId) ?? null)
          : null,
      },
      history: history.map((h) => this.view.historyView(h, false)),
      preview: await this.merchantDeals.previewOf(deal, target),
      reviewTarget,
      adminActions: this.adminActions(actor, deal.status, reviewTarget),
    };
  }

  adminActions(actor: Actor, status: string, reviewTarget: string): string[] {
    const out: string[] = [];
    if (actor.permissions.has('admin.campaigns.review') && reviewTarget !== 'NONE')
      out.push('approve', 'request_changes', 'reject');
    if (actor.permissions.has('admin.campaigns.control')) {
      if (status === 'LIVE' || status === 'SCHEDULED') out.push('pause', 'suspend');
      if (status === 'PAUSED') out.push('resume', 'suspend');
      if (status === 'SUSPENDED') out.push('reinstate');
    }
    return out;
  }

  async auditTrail(id: string, q: { limit: number; cursor?: string }) {
    await this.core.loadAny(id);
    const page = await keysetPage({
      findMany: (query) => this.prisma.auditLog.findMany(query),
      baseWhere: { entityType: 'LiveDeal', entityId: id },
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

  async analytics() {
    return this.events.adminOverview();
  }

  // ---------------------------------------------------------------- review decisions
  private async reviewTarget(id: string) {
    const deal = await this.core.loadAny(id);
    if (deal.status === 'PENDING_REVIEW') return { deal, revision: null };
    const rev = await this.core.openRevision(id);
    if (rev?.status === 'PENDING_REVIEW') return { deal, revision: rev };
    throw new AppError('INVALID_STATE', 'This deal is not waiting for review', 409);
  }

  async approve(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const { deal, revision } = await this.reviewTarget(id);
    const now = new Date();
    if (deal.organization.status !== 'ACTIVE')
      throw new AppError('ORG_NOT_ACTIVE', 'The merchant account is not active', 409);
    const content = parseContent(revision ? revision.content : deal.content);
    const issues = liveDealIssues(content, { now });
    if (issues.length)
      throw new AppError(
        'DEAL_INCOMPLETE',
        'The deal is incomplete and cannot be approved',
        422,
        undefined,
        issues.map((i) => ({ code: 'DEAL_INCOMPLETE', message: i.code, field: i.field })),
      );
    await this.core.requireActiveBranch(deal.organizationId, content.branchIds);
    await this.core.validateReferences(deal.organizationId, content);
    await this.prisma.$transaction(async (tx) => {
      if (revision)
        await this.core.approveRevision(
          tx,
          deal,
          revision,
          { action: 'REVISION_APPROVE', actor, reason: body.reason, reasonAr: body.reasonAr, meta },
          now,
        );
      else
        await this.core.approveDeal(
          tx,
          deal,
          { action: 'APPROVE', actor, reason: body.reason, reasonAr: body.reasonAr, meta },
          now,
        );
    });
    return this.detail(actor, id);
  }

  async requestChanges(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const { deal, revision } = await this.reviewTarget(id);
    await this.prisma.$transaction(async (tx) => {
      if (revision) {
        await tx.liveDealRevision.update({
          where: { id: revision.id },
          data: { status: 'NEEDS_CHANGES', decidedAt: new Date(), decidedByUserId: actor.userId },
        });
        await this.core.record(tx, deal, {
          action: 'REVISION_REQUEST_CHANGES',
          from: deal.status,
          to: deal.status,
          actor,
          reason: body.reason,
          reasonAr: body.reasonAr,
          fields: body.fields,
          revisionId: revision.id,
          meta,
        });
      } else {
        await this.core.transition(tx, deal, 'NEEDS_CHANGES', {
          action: 'REQUEST_CHANGES',
          actor,
          reason: body.reason,
          reasonAr: body.reasonAr,
          fields: body.fields,
          meta,
        });
      }
    });
    return this.detail(actor, id);
  }

  async reject(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const { deal, revision } = await this.reviewTarget(id);
    await this.prisma.$transaction(async (tx) => {
      if (revision) {
        await tx.liveDealRevision.update({
          where: { id: revision.id },
          data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: actor.userId },
        });
        await this.core.record(tx, deal, {
          action: 'REVISION_REJECT',
          from: deal.status,
          to: deal.status,
          actor,
          reason: body.reason,
          reasonAr: body.reasonAr,
          revisionId: revision.id,
          meta,
        });
      } else {
        await this.core.transition(tx, deal, 'REJECTED', {
          action: 'REJECT',
          actor,
          reason: body.reason,
          reasonAr: body.reasonAr,
          meta,
        });
      }
    });
    return this.detail(actor, id);
  }

  // ---------------------------------------------------------------- emergency controls (admin.campaigns.control)
  private async control(
    actor: Actor,
    id: string,
    allowed: DealRow['status'][],
    to: (deal: DealRow) => DealRow['status'],
    action: 'PAUSE' | 'RESUME' | 'SUSPEND' | 'REINSTATE',
    body: Decision,
    meta: RequestMeta,
    data: (deal: DealRow) => Prisma.LiveDealUncheckedUpdateManyInput,
  ) {
    const deal = await this.core.loadAny(id);
    if (!allowed.includes(deal.status))
      throw new AppError(
        'INVALID_STATE',
        `A ${deal.status} deal cannot be ${action.toLowerCase()}d`,
        409,
      );
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, deal, to(deal), {
        action,
        actor,
        reason: body.reason,
        reasonAr: body.reasonAr,
        data: data(deal),
        meta,
      }),
    );
    return this.detail(actor, id);
  }

  pause(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    return this.control(
      actor,
      id,
      ['LIVE', 'SCHEDULED'],
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
      (d) => statusFromDates(d.startAt, d.endAt, now),
      'RESUME',
      body,
      meta,
      (d) => ({
        pausedBy: null,
        ...(statusFromDates(d.startAt, d.endAt, now) === 'EXPIRED' ? { endedAt: now } : {}),
      }),
    );
  }

  suspend(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    return this.control(
      actor,
      id,
      ['LIVE', 'SCHEDULED', 'PAUSED'],
      () => 'SUSPENDED',
      'SUSPEND',
      body,
      meta,
      (d) => ({ statusBeforeSuspension: d.status }),
    );
  }

  /** Releases a suspension: the deal returns to what it was (or expires if its end date passed meanwhile). */
  reinstate(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const now = new Date();
    const target = (d: DealRow): DealRow['status'] =>
      d.statusBeforeSuspension === 'PAUSED' ? 'PAUSED' : statusFromDates(d.startAt, d.endAt, now);
    return this.control(actor, id, ['SUSPENDED'], target, 'REINSTATE', body, meta, (d) => ({
      statusBeforeSuspension: null,
      ...(d.statusBeforeSuspension === 'PAUSED' ? {} : { pausedBy: null }),
      ...(target(d) === 'EXPIRED' ? { endedAt: now } : {}),
    }));
  }
}
