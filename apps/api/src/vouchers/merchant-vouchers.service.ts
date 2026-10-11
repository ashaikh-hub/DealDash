import { Injectable } from '@nestjs/common';
import {
  voucherIssues,
  voucherMaterialChanges,
  type MerchantVoucherSaleRow,
  type PayableEventRow,
  type PayableSummary,
  type VoucherContent,
  type VoucherDetail,
  type VoucherMonitor,
  type VoucherRow as VoucherListRow,
  type VoucherView,
} from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { EligibilityService, evaluateEligibility } from '../live-deals/eligibility.service';
import { LedgerService } from './ledger.service';
import { parseVoucherContent, voucherStatusFromDates } from './voucher-content';
import {
  VOUCHER_APPROVED_STATUSES,
  VoucherCoreService,
  type VoucherRow,
} from './voucher-core.service';
import { PaymentsService } from './payments.service';
import { VoucherRedemptionService } from './voucher-redemption.service';
import { VoucherViewService } from './voucher-view.service';
import { campaignCreator } from '../common/campaign-creator';

export interface VoucherListQuery {
  limit: number;
  cursor?: string;
  status?: string;
  q?: string;
}

const dedupe = (c: VoucherContent): VoucherContent => ({
  ...c,
  branchIds: [...new Set(c.branchIds)],
  media: c.media.filter((m, i, a) => a.findIndex((x) => x.fileId === m.fileId) === i),
  eligibility: { ...c.eligibility, valueRefs: [...new Set(c.eligibility.valueRefs)] },
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

/** Merchant Portal operations on Vouchers. Every method is scoped to the caller's own organisation. */
@Injectable()
export class MerchantVouchersService {
  constructor(
    private readonly core: VoucherCoreService,
    private readonly view: VoucherViewService,
    private readonly eligibility: EligibilityService,
    private readonly payments: PaymentsService,
    private readonly redemption: VoucherRedemptionService,
    private readonly ledger: LedgerService,
    private readonly files: FilesService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  // ---------------------------------------------------------------- reading
  async list(
    actor: Actor,
    organizationId: string,
    q: VoucherListQuery,
  ): Promise<Page<VoucherListRow>> {
    this.core.requireMerchantScope(actor, organizationId);
    const visible = await this.core.access.visibleCampaignIds(actor, 'VOUCHER', organizationId);
    const only = visible ? { id: { in: visible } } : {};
    const where: Prisma.VoucherWhereInput = {
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
      findMany: (query) => this.prisma.voucher.findMany({ ...query, include: { branches: true } }),
      baseWhere: where as Record<string, unknown>,
      sort: { field: 'updatedAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const urls = await this.files.signedUrls(
      page.items.map((d) => parseVoucherContent(d.content).media[0]?.fileId),
      900,
    );
    const redeemed = page.items.length
      ? await this.prisma.voucherInstance.groupBy({
          by: ['voucherId'],
          where: { voucherId: { in: page.items.map((d) => d.id) }, status: 'REDEEMED' },
          _count: { _all: true },
        })
      : [];
    const redeemedBy = new Map(redeemed.map((r) => [r.voucherId, r._count._all]));
    const rows: VoucherListRow[] = page.items.map((d) => {
      const c = parseVoucherContent(d.content);
      const first = c.media[0];
      return {
        id: d.id,
        status: d.status,
        title: c.title,
        faceValueHalalas: d.faceValueHalalas,
        sellingPriceHalalas: d.sellingPriceHalalas,
        branchCount: d.branches.length,
        saleStartAt: c.saleStartAt,
        saleEndAt: c.saleEndAt,
        imageUrl: first ? (urls.get(first.fileId) ?? null) : null,
        totalQty: d.totalQty,
        soldQty: d.soldQty,
        heldQty: d.heldQty,
        redeemedQty: redeemedBy.get(d.id) ?? 0,
        updatedAt: d.updatedAt.toISOString(),
      };
    });
    return new Page(rows, page.nextCursor);
  }

  async summary(actor: Actor, organizationId: string) {
    this.core.requireMerchantScope(actor, organizationId);
    const visible = await this.core.access.visibleCampaignIds(actor, 'VOUCHER', organizationId);
    const only = visible ? { id: { in: visible } } : {};
    const rows = await this.prisma.voucher.groupBy({
      by: ['status'],
      where: { organizationId, ...only },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r._count._all;
    return { counts, total: rows.reduce((n, r) => n + r._count._all, 0) };
  }

  async get(actor: Actor, organizationId: string, id: string): Promise<VoucherView> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'VOUCHER', organizationId, id, 'read');
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async history(actor: Actor, organizationId: string, id: string) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'VOUCHER', organizationId, id, 'read');
    await this.core.loadOwned(organizationId, id);
    const rows = await this.prisma.voucherHistory.findMany({
      where: { voucherId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((h) => this.view.historyView(h, true));
  }

  async preview(actor: Actor, organizationId: string, id: string): Promise<VoucherDetail> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'VOUCHER', organizationId, id, 'read');
    return this.previewOf(await this.core.loadOwned(organizationId, id));
  }

  /** What a signed-in customer without benefits would see (so locked states are visible to the merchant and the reviewer). */
  async previewOf(v: VoucherRow): Promise<VoucherDetail> {
    const content = parseVoucherContent(v.content);
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
    const planned = await this.prisma.merchantBranch.findMany({
      where: { id: { in: content.branchIds }, organizationId: v.organizationId },
    });
    const previewRow: VoucherRow = {
      ...v,
      status: ['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES'].includes(v.status)
        ? 'ON_SALE'
        : v.status,
      totalQty: Math.max(v.totalQty, content.totalQty),
      branches: planned.map((b) => ({ voucherId: v.id, branchId: b.id, branch: b })),
    };
    return this.view.detail(previewRow, content, { outcome, city }, new Map(), {
      remainingForMe: content.perCustomerLimit,
      limitReached: false,
    });
  }

  // ---------------------------------------------------------------- writing
  async create(actor: Actor, organizationId: string, input: VoucherContent, meta: RequestMeta) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.newCampaign(actor, 'VOUCHER', organizationId, input);
    const content = dedupe(input);
    content.commercial.creatorOrganizationId = campaignCreator(
      actor,
      null,
      content.commercial.creatorOrganizationId,
    );
    await this.core.validateReferences(organizationId, content);
    const id = await this.prisma.$transaction(async (tx) => {
      const v = await tx.voucher.create({
        data: {
          organizationId,
          content: content as unknown as Prisma.InputJsonValue,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        },
      });
      await this.core.applyContent(tx, { ...v, status: 'DRAFT' }, content, actor.userId, {
        bumpVersion: false,
      });
      await this.core.record(tx, v, { action: 'CREATE', to: 'DRAFT', actor, meta });
      return v.id;
    });
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  async update(
    actor: Actor,
    organizationId: string,
    id: string,
    input: VoucherContent,
    expectedVersion: number | undefined,
    meta: RequestMeta,
  ): Promise<{ voucher: VoucherView; outcome: 'SAVED' | 'APPLIED_MINOR' }> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'VOUCHER', organizationId, id, 'write');
    await this.core.access.newCampaign(actor, 'VOUCHER', organizationId, input);
    const v = await this.core.loadOwned(organizationId, id);
    if (expectedVersion !== undefined && expectedVersion !== v.version)
      throw new AppError(
        'VERSION_CONFLICT',
        'This voucher was changed somewhere else. Reload to see the latest version.',
        409,
      );
    const live = parseVoucherContent(v.content);
    const done = async (outcome: 'SAVED' | 'APPLIED_MINOR') => ({
      voucher: await this.view.build(await this.core.loadOwned(organizationId, id)),
      outcome,
    });
    const diffFields = (a: VoucherContent, b: VoucherContent) =>
      Object.keys(b).filter(
        (k) => JSON.stringify((a as never)[k]) !== JSON.stringify((b as never)[k]),
      );

    // ---- free editing (drafts and requested changes)
    if (v.status === 'DRAFT' || v.status === 'NEEDS_CHANGES') {
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
        await this.core.applyContent(tx, v, next, actor.userId);
        await this.core.record(tx, v, {
          action: 'UPDATE',
          from: v.status,
          to: v.status,
          actor,
          fields: changed,
          meta,
        });
      });
      return done('SAVED');
    }

    if (v.status === 'PENDING_REVIEW')
      throw new AppError(
        'EDIT_LOCKED',
        'Your voucher is being reviewed. You cannot edit it meanwhile.',
        409,
      );
    if (!VOUCHER_APPROVED_STATUSES.includes(v.status) || v.status === 'SUSPENDED')
      throw new AppError('EDIT_LOCKED', 'This voucher can no longer be edited', 409);

    // ---- approved vouchers: wording and photos only. Issuance capacity changes through the stock endpoint.
    const next = dedupe({ ...input, totalQty: live.totalQty });
    next.commercial.creatorOrganizationId = campaignCreator(
      actor,
      live.commercial.creatorOrganizationId,
      next.commercial.creatorOrganizationId,
    );
    await this.core.validateReferences(organizationId, next);
    const material = voucherMaterialChanges(live, next);
    if (material.length)
      throw new AppError(
        'MATERIAL_EDIT_LOCKED',
        'This change affects what customers buy, so it cannot be made on a voucher that is on sale. End the sale and create a new voucher, or contact DealDash.',
        409,
        material[0],
        material.map((f) => ({ code: 'MATERIAL_EDIT_LOCKED', message: f, field: f })),
      );
    const issues = voucherIssues(next, { limits: await this.core.limits() });
    if (issues.length) incomplete(issues);
    const changed = diffFields(live, next);
    if (!changed.length) return done('SAVED');
    await this.prisma.$transaction(async (tx) => {
      await this.core.applyContent(tx, v, next, actor.userId);
      await this.core.record(tx, v, {
        action: 'MINOR_EDIT',
        from: v.status,
        to: v.status,
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
  ): Promise<{ voucher: VoucherView; outcome: 'SENT_FOR_REVIEW' | 'PUBLISHED' | 'SCHEDULED' }> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'VOUCHER', organizationId, id, 'write');
    const v = await this.core.loadOwned(organizationId, id);
    if (v.status !== 'DRAFT' && v.status !== 'NEEDS_CHANGES')
      throw new AppError('INVALID_STATE', `A ${v.status} voucher cannot be submitted`, 409);
    const now = new Date();
    const content = parseVoucherContent(v.content);
    const issues = voucherIssues(content, { now, limits: await this.core.limits() });
    if (issues.length) incomplete(issues);
    await this.core.validateReferences(organizationId, content);
    await this.core.requireActiveBranch(organizationId, content.branchIds);
    await this.core.commercial.assertCanSubmit('VOUCHER', id, actor);
    const trust = await this.core.merchantTrust(organizationId);
    const g = await this.view.guardrail(content, trust);
    const commerciallyReady = (await this.core.commercial.blockersFor('VOUCHER', id)).length === 0;
    const finish = async (outcome: 'SENT_FOR_REVIEW' | 'PUBLISHED' | 'SCHEDULED') => ({
      voucher: await this.view.build(await this.core.loadOwned(organizationId, id)),
      outcome,
    });
    if (g.outcome === 'AUTO_PUBLISH' && commerciallyReady) {
      const to = await this.prisma.$transaction((tx) =>
        this.core.approve(
          tx,
          v,
          { action: 'AUTO_APPROVE', actor: null, reason: 'Approved by guardrails', meta },
          now,
        ),
      );
      return finish(to === 'ON_SALE' ? 'PUBLISHED' : 'SCHEDULED');
    }
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, v, 'PENDING_REVIEW', {
        action: 'SUBMIT',
        actor,
        reason: g.reasons.join(', '),
        data: { submittedAt: now },
        meta,
      }),
    );
    return finish('SENT_FOR_REVIEW');
  }

  private requireStatus(v: VoucherRow, allowed: VoucherRow['status'][], verb: string) {
    if (!allowed.includes(v.status))
      throw new AppError('INVALID_STATE', `A ${v.status} voucher cannot be ${verb}`, 409);
  }

  async pause(
    actor: Actor,
    organizationId: string,
    id: string,
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'VOUCHER', organizationId, id, 'write');
    const v = await this.core.loadOwned(organizationId, id);
    this.requireStatus(v, ['ON_SALE', 'SCHEDULED', 'SOLD_OUT'], 'paused');
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, v, 'PAUSED', {
        action: 'PAUSE',
        actor,
        reason,
        data: { pausedBy: 'MERCHANT' },
        meta,
      }),
    );
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  /** The status a paused or reinstated voucher returns to: its dates decide, then issuance capacity (none left = SOLD_OUT). */
  statusOnReturn(v: VoucherRow, now: Date): 'SCHEDULED' | 'ON_SALE' | 'SOLD_OUT' | 'ENDED' {
    const base = voucherStatusFromDates(v.saleStartAt, v.saleEndAt, now);
    if (base !== 'ON_SALE') return base;
    return v.totalQty - v.heldQty - v.soldQty <= 0 ? 'SOLD_OUT' : 'ON_SALE';
  }

  async resume(actor: Actor, organizationId: string, id: string, meta: RequestMeta) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'VOUCHER', organizationId, id, 'write');
    const v = await this.core.loadOwned(organizationId, id);
    this.requireStatus(v, ['PAUSED'], 'resumed');
    if (v.pausedBy !== 'MERCHANT')
      throw new AppError(
        'INVALID_STATE',
        'DealDash paused this voucher. Contact DealDash to resume it.',
        409,
      );
    const now = new Date();
    const to = this.statusOnReturn(v, now);
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, v, to, {
        action: 'RESUME',
        actor,
        data: { pausedBy: null, ...(to === 'ENDED' ? { endedAt: now } : {}) },
        meta,
      }),
    );
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  /** Stops selling. Vouchers already sold are NOT affected: they stay valid and redeemable (VC-39). */
  async end(
    actor: Actor,
    organizationId: string,
    id: string,
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'VOUCHER', organizationId, id, 'write');
    const v = await this.core.loadOwned(organizationId, id);
    this.requireStatus(v, ['ON_SALE', 'SCHEDULED', 'PAUSED', 'SOLD_OUT'], 'ended');
    const now = new Date();
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, v, 'ENDED', {
        action: 'END',
        actor,
        reason,
        data: { endedAt: now, pausedBy: null },
        meta,
      }),
    );
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  /** Adds (or removes still-unsold) issuance capacity. One conditional update: capacity can never drop below held + sold. */
  async stock(
    actor: Actor,
    organizationId: string,
    id: string,
    input: { delta: number; reason?: string },
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'VOUCHER', organizationId, id, 'write');
    const v = await this.core.loadOwned(organizationId, id);
    this.requireStatus(v, ['ON_SALE', 'SOLD_OUT', 'PAUSED'], 'restocked');
    const limits = await this.core.limits();
    if (v.totalQty + input.delta > limits.maxQtyPerVoucher)
      throw AppError.validation('That is more than the platform allows for one voucher', 'delta');
    if (input.delta > 0)
      await this.core.commercial.requireCoverage('VOUCHER', id, v.totalQty + input.delta, actor);
    const amendQuote =
      input.delta > 0 ? await this.core.commercial.acceptedQuotationId('VOUCHER', id) : null;
    await this.prisma.$transaction(async (tx) => {
      const moved =
        await tx.$executeRaw`UPDATE "Voucher" SET "totalQty" = "totalQty" + ${input.delta}, "updatedAt" = now()
         WHERE "id" = ${id}::uuid AND "organizationId" = ${organizationId}::uuid AND "status" IN ('ON_SALE', 'SOLD_OUT', 'PAUSED')
           AND "totalQty" + ${input.delta} >= "heldQty" + "soldQty"`;
      if (moved !== 1)
        throw new AppError(
          'INVENTORY_BELOW_COMMITTED',
          'Capacity cannot go below the vouchers already sold or held in checkout',
          409,
        );
      const fresh = await tx.voucher.findUniqueOrThrow({ where: { id } });
      const c = parseVoucherContent(fresh.content);
      await tx.voucher.update({
        where: { id },
        data: {
          content: { ...c, totalQty: fresh.totalQty } as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (input.delta > 0)
        await this.core.versions.recordLive(tx, {
          product: 'VOUCHER',
          subjectId: id,
          organizationId,
          content: { ...c, totalQty: fresh.totalQty },
          reason: 'AMENDMENT',
          quotationId: amendQuote,
          userId: actor.userId,
        });
      await this.core.record(tx, v, {
        action: 'STOCK_CHANGED',
        from: v.status,
        to: v.status,
        actor,
        reason: input.reason ?? null,
        snapshot: { delta: input.delta, total: fresh.totalQty },
        meta,
      });
      await this.payments.syncSoldOut(tx, id);
    });
    return this.view.build(await this.core.loadOwned(organizationId, id));
  }

  // ---------------------------------------------------------------- monitoring
  async monitor(actor: Actor, organizationId: string, id: string): Promise<VoucherMonitor> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.guard(actor, 'VOUCHER', organizationId, id, 'read');
    return this.monitorOf(
      await this.core.loadOwned(organizationId, id),
      actor.permissions.has('merchant.finance.read'),
    );
  }

  async monitorOf(v: VoucherRow, includeFinance: boolean): Promise<VoucherMonitor> {
    const [byStatus, ev, money] = await Promise.all([
      this.prisma.voucherInstance.groupBy({
        by: ['status'],
        where: { voucherId: v.id },
        _count: { _all: true },
        _sum: { purchasePriceHalalas: true },
      }),
      this.prisma.dealEvent.groupBy({
        by: ['type'],
        where: { productType: 'VOUCHER', dealId: v.id },
        _count: { _all: true },
      }),
      includeFinance
        ? this.prisma.merchantPayableEvent.groupBy({
            by: ['type'],
            where: { voucherId: v.id },
            _sum: { amountHalalas: true },
          })
        : Promise.resolve([]),
    ]);
    const n = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
    const sum = (s: string) => byStatus.find((x) => x.status === s)?._sum.purchasePriceHalalas ?? 0;
    const e = (t: string) => ev.find((x) => x.type === t)?._count._all ?? 0;
    const m = (t: string) => money.find((x) => x.type === t)?._sum.amountHalalas ?? 0;
    const sold = byStatus.reduce((a, x) => a + x._count._all, 0);
    const redeemed = n('REDEEMED');
    return {
      status: v.status,
      serverNow: new Date().toISOString(),
      stock: this.view.stockOf(v),
      sales: {
        sold,
        active: n('ACTIVE'),
        redeemed,
        expired: n('EXPIRED'),
        refunded: n('REFUNDED') + n('VOIDED'),
        redemptionRatePct: sold > 0 ? Math.round((redeemed * 1000) / sold) / 10 : null,
      },
      funnel: {
        impressions: e('IMPRESSION'),
        detailViews: e('DETAIL_VIEW'),
        checkoutsStarted: e('CHECKOUT_STARTED'),
        paymentsSucceeded: e('PAYMENT_SUCCEEDED'),
        paymentsFailed: e('PAYMENT_FAILED'),
      },
      finance: includeFinance
        ? {
            soldGrossHalalas: m('SOLD'),
            redeemedGrossHalalas: sum('REDEEMED'),
            settlementEligibleHalalas: m('ELIGIBLE') - m('REDEMPTION_REVERSED'),
            refundedHalalas: m('REFUNDED'),
          }
        : null,
      disclaimerKey: 'voucher_signals_and_verified_payments_only',
    };
  }

  /** Sold vouchers: first name, status and redemption only. Never contact data, never payment data. */
  async sales(
    actor: Actor,
    organizationId: string,
    q: { limit: number; cursor?: string; voucherId?: string; status?: string },
  ): Promise<Page<MerchantVoucherSaleRow>> {
    this.core.requireMerchantScope(actor, organizationId);
    const visible = await this.core.access.visibleCampaignIds(actor, 'VOUCHER', organizationId);
    const allowed = visible
      ? q.voucherId
        ? visible.filter((v) => v === q.voucherId)
        : visible
      : null;
    const page = await keysetPage({
      findMany: (query) =>
        this.prisma.voucherInstance.findMany({
          ...query,
          include: {
            voucher: { select: { content: true } },
            redemptions: { orderBy: { redeemedAt: 'desc' }, take: 1 },
          },
        }),
      baseWhere: {
        organizationId,
        ...(allowed
          ? { voucherId: { in: allowed } }
          : q.voucherId
            ? { voucherId: q.voucherId }
            : {}),
        ...(q.status ? { status: q.status } : {}),
      } as Record<string, unknown>,
      sort: { field: 'issuedAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const branchIds = [...new Set(page.items.flatMap((i) => i.redemptions.map((r) => r.branchId)))];
    const branches = branchIds.length
      ? await this.prisma.merchantBranch.findMany({ where: { id: { in: branchIds } } })
      : [];
    const userIds = [...new Set(page.items.map((i) => i.ownerUserId))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, displayName: true, customer: { select: { firstName: true } } },
        })
      : [];
    const canReverse = actor.permissions.has('merchant.redemptions.reverse');
    const hours = 24;
    const now = Date.now();
    return new Page(
      page.items.map((i) => {
        const red = i.redemptions.find((r) => r.status === 'REDEEMED') ?? null;
        const b = red ? branches.find((x) => x.id === red.branchId) : null;
        const u = users.find((x) => x.id === i.ownerUserId);
        return {
          id: i.id,
          reference: i.reference,
          voucherId: i.voucherId,
          title: parseVoucherContent(i.voucher.content).title,
          customerFirstName: u?.customer?.firstName || u?.displayName.split(' ')[0] || null,
          status: i.status,
          pricePaidHalalas: i.purchasePriceHalalas,
          faceValueHalalas: i.faceValueHalalas,
          issuedAt: i.issuedAt.toISOString(),
          expiresAt: i.expiresAt.toISOString(),
          redeemedAt: i.redeemedAt ? i.redeemedAt.toISOString() : null,
          redeemedBranch: b ? { en: b.nameEn, ar: b.nameAr } : null,
          redemptionId: red?.id ?? null,
          redemptionReference: red?.reference ?? null,
          canReverse: !!red && canReverse && now - red.redeemedAt.getTime() <= hours * 3_600_000,
        };
      }),
      page.nextCursor,
    );
  }

  async reverseRedemption(
    actor: Actor,
    organizationId: string,
    redemptionId: string,
    reason: string,
    meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, organizationId);
    if (this.core.access.isScoped(actor)) {
      const r = await this.prisma.voucherRedemption.findFirst({
        where: { id: redemptionId, organizationId },
        select: { branchId: true, voucherId: true },
      });
      if (!r) throw AppError.notFound();
      await this.core.access.branch(actor, 'merchant.redemptions.reverse', r.branchId, {
        product: 'VOUCHER',
        campaignId: r.voucherId,
      });
    }
    return this.redemption.reverse(actor, redemptionId, reason, { organizationId }, meta);
  }

  // ---------------------------------------------------------------- finance (merchant payable foundation)
  async payable(actor: Actor, organizationId: string): Promise<PayableSummary> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.org(actor, 'merchant.finance.read');
    return this.payableOf(organizationId);
  }

  async payableOf(organizationId: string): Promise<PayableSummary> {
    const [pos, groups] = await Promise.all([
      this.ledger.merchantPosition(organizationId),
      this.prisma.merchantPayableEvent.groupBy({
        by: ['type'],
        where: { organizationId },
        _count: { _all: true },
        _sum: { amountHalalas: true, feeHalalas: true },
      }),
    ]);
    const c = (t: string) => groups.find((g) => g.type === t)?._count._all ?? 0;
    const amt = (t: string) => groups.find((g) => g.type === t)?._sum.amountHalalas ?? 0;
    const fee = (t: string) => groups.find((g) => g.type === t)?._sum.feeHalalas ?? 0;
    return {
      currency: 'SAR',
      heldHalalas: pos.heldHalalas,
      settlementEligibleHalalas: pos.settlementEligibleHalalas,
      platformFeeHalalas: fee('ELIGIBLE') - fee('REDEMPTION_REVERSED'),
      refundedHalalas: amt('REFUNDED'),
      expiredValueHalalas: pos.expiredValueHalalas,
      accrualPoint: await this.core.accrualPoint(),
      counts: {
        sold: c('ISSUED'),
        redeemed: c('REDEEMED') - c('REDEMPTION_REVERSED'),
        refunded: c('REFUNDED'),
        expired: c('EXPIRED'),
      },
      disclaimerKey: 'legal_treatment_validate_ksa',
    };
  }

  async payableEvents(
    actor: Actor,
    organizationId: string,
    q: { limit: number; cursor?: string },
  ): Promise<Page<PayableEventRow>> {
    this.core.requireMerchantScope(actor, organizationId);
    await this.core.access.org(actor, 'merchant.finance.read');
    return this.payableEventsOf(organizationId, q);
  }

  async payableEventsOf(
    organizationId: string,
    q: { limit: number; cursor?: string },
  ): Promise<Page<PayableEventRow>> {
    const page = await keysetPage({
      findMany: (query) => this.prisma.merchantPayableEvent.findMany(query),
      baseWhere: { organizationId } as Record<string, unknown>,
      sort: { field: 'createdAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const instanceIds = [
      ...new Set(page.items.map((e) => e.instanceId).filter((x): x is string => !!x)),
    ];
    const inst = instanceIds.length
      ? await this.prisma.voucherInstance.findMany({
          where: { id: { in: instanceIds } },
          select: { id: true, reference: true, voucher: { select: { content: true } } },
        })
      : [];
    const byId = new Map(inst.map((i) => [i.id, i]));
    return new Page(
      page.items.map((e) => {
        const i = e.instanceId ? byId.get(e.instanceId) : undefined;
        return {
          id: e.id,
          type: e.type,
          amountHalalas: e.amountHalalas,
          feeHalalas: e.feeHalalas,
          instanceReference: i?.reference ?? null,
          voucherTitle: i ? parseVoucherContent(i.voucher.content).title : null,
          createdAt: e.createdAt.toISOString(),
          note: e.note,
        };
      }),
      page.nextCursor,
    );
  }
}
