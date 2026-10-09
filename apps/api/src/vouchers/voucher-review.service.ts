import { Injectable } from '@nestjs/common';
import {
  voucherIssues,
  voucherSavings,
  type AdminVoucherDetail,
  type AdminVoucherRow,
} from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { MerchantVouchersService } from './merchant-vouchers.service';
import { parseVoucherContent } from './voucher-content';
import { VoucherCoreService, type VoucherRow } from './voucher-core.service';
import { VoucherViewService } from './voucher-view.service';

export interface AdminVoucherListQuery {
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
} satisfies Prisma.VoucherInclude;

/** DealDash Voucher review and controls (Admin). Every decision is audited (history + audit log). */
@Injectable()
export class VoucherReviewService {
  constructor(
    private readonly core: VoucherCoreService,
    private readonly view: VoucherViewService,
    private readonly merchantVouchers: MerchantVouchersService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  private row(d: Prisma.VoucherGetPayload<{ include: typeof ROW_INCLUDE }>): AdminVoucherRow {
    const c = parseVoucherContent(d.content);
    return {
      id: d.id,
      status: d.status,
      title: c.title,
      faceValueHalalas: d.faceValueHalalas,
      sellingPriceHalalas: d.sellingPriceHalalas,
      merchant: {
        id: d.organizationId,
        nameEn: d.organization.nameEn,
        nameAr: d.organization.nameAr,
        trustLevel: d.organization.merchant?.trustLevel ?? 'NEW',
      },
      branchCount: d.branches.length,
      totalQty: d.totalQty,
      submittedAt: d.submittedAt ? d.submittedAt.toISOString() : null,
      saleStartAt: d.saleStartAt ? d.saleStartAt.toISOString() : null,
      saleEndAt: d.saleEndAt ? d.saleEndAt.toISOString() : null,
    };
  }

  async list(q: AdminVoucherListQuery): Promise<Page<AdminVoucherRow>> {
    const where: Prisma.VoucherWhereInput = {
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
      findMany: (query) => this.prisma.voucher.findMany({ ...query, include: ROW_INCLUDE }),
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

  adminActions(actor: Actor, status: string): string[] {
    const out: string[] = [];
    if (actor.permissions.has('admin.campaigns.review') && status === 'PENDING_REVIEW')
      out.push('approve', 'request_changes', 'reject');
    if (actor.permissions.has('admin.campaigns.control')) {
      if (status === 'ON_SALE' || status === 'SCHEDULED' || status === 'SOLD_OUT')
        out.push('pause', 'suspend');
      if (status === 'PAUSED') out.push('resume', 'suspend');
      if (status === 'SUSPENDED') out.push('reinstate');
    }
    return out;
  }

  async detail(actor: Actor, id: string): Promise<AdminVoucherDetail> {
    const v = await this.core.loadAny(id);
    if (v.status === 'DRAFT') throw AppError.notFound(); // drafts are the merchant's private work
    const base = await this.view.build(v);
    const content = parseVoucherContent(v.content);
    const history = await this.prisma.voucherHistory.findMany({
      where: { voucherId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const limits = await this.core.limits();
    const policy = await this.core.refundPolicy();
    const fee = await this.core.feeRule();
    const savings = voucherSavings(content.faceValueHalalas, content.sellingPriceHalalas);
    return {
      ...base,
      merchant: {
        id: v.organizationId,
        nameEn: v.organization.nameEn,
        nameAr: v.organization.nameAr,
        legalName: v.organization.merchant?.legalName ?? null,
        commercialRegistration: v.organization.merchant?.commercialRegistrationNumber ?? null,
        status: v.organization.status,
        trustLevel: v.organization.merchant?.trustLevel ?? 'NEW',
        riskTier: v.organization.merchant?.riskTier ?? 'STANDARD',
      },
      branches: v.branches.map((b) => ({
        id: b.branch.id,
        name: { en: b.branch.nameEn, ar: b.branch.nameAr },
        city: b.branch.city,
        status: b.branch.status,
      })),
      history: history.map((h) => this.view.historyView(h, false)),
      preview: await this.merchantVouchers.previewOf(v),
      reviewTarget: v.status === 'PENDING_REVIEW' ? 'VOUCHER' : 'NONE',
      adminActions: this.adminActions(actor, v.status),
      commercial: {
        savings,
        reviewAboveDiscountPercent: limits.reviewAboveDiscountPercent,
        discountFlag: savings.savingsPercent > limits.reviewAboveDiscountPercent,
        refundPolicy: {
          windowHours: policy.windowHours,
          outsideWindow: policy.outsideWindow,
          placeholder: true,
        },
        payableRule: {
          accrualPoint: await this.core.accrualPoint(),
          feePercentBps: fee.percentBps,
          feeFixedHalalas: fee.fixedHalalas,
          placeholder: true,
        },
        expiredValuePolicy: await this.core.expiredValuePolicy(),
      },
    };
  }

  async auditTrail(id: string, q: { limit: number; cursor?: string }) {
    await this.core.loadAny(id);
    const page = await keysetPage({
      findMany: (query) => this.prisma.auditLog.findMany(query),
      baseWhere: { entityType: 'Voucher', entityId: id },
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

  async monitor(id: string) {
    return this.merchantVouchers.monitorOf(await this.core.loadAny(id), true);
  }

  // ---------------------------------------------------------------- review decisions
  private async pending(id: string) {
    const v = await this.core.loadAny(id);
    if (v.status !== 'PENDING_REVIEW')
      throw new AppError('INVALID_STATE', 'This voucher is not waiting for review', 409);
    return v;
  }

  async approve(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const v = await this.pending(id);
    const now = new Date();
    if (v.organization.status !== 'ACTIVE')
      throw new AppError('ORG_NOT_ACTIVE', 'The merchant account is not active', 409);
    const content = parseVoucherContent(v.content);
    const issues = voucherIssues(content, { now, limits: await this.core.limits() });
    if (issues.length)
      throw new AppError(
        'DEAL_INCOMPLETE',
        'The voucher is incomplete and cannot be approved',
        422,
        undefined,
        issues.map((i) => ({ code: 'DEAL_INCOMPLETE', message: i.code, field: i.field })),
      );
    await this.core.requireActiveBranch(v.organizationId, content.branchIds);
    await this.core.validateReferences(v.organizationId, content);
    await this.core.commercial.assertCanActivate('VOUCHER', id);
    await this.prisma.$transaction((tx) =>
      this.core.approve(
        tx,
        v,
        { action: 'APPROVE', actor, reason: body.reason, reasonAr: body.reasonAr, meta },
        now,
      ),
    );
    return this.detail(actor, id);
  }

  async requestChanges(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const v = await this.pending(id);
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, v, 'NEEDS_CHANGES', {
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
    const v = await this.pending(id);
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, v, 'REJECTED', {
        action: 'REJECT',
        actor,
        reason: body.reason,
        reasonAr: body.reasonAr,
        meta,
      }),
    );
    return this.detail(actor, id);
  }

  // ---------------------------------------------------------------- controls (admin.campaigns.control)
  private async control(
    actor: Actor,
    id: string,
    allowed: VoucherRow['status'][],
    to: (v: VoucherRow) => VoucherRow['status'],
    action: 'PAUSE' | 'RESUME' | 'SUSPEND' | 'REINSTATE',
    body: Decision,
    meta: RequestMeta,
    data: (v: VoucherRow, target: VoucherRow['status']) => Prisma.VoucherUncheckedUpdateManyInput,
  ) {
    const v = await this.core.loadAny(id);
    if (!allowed.includes(v.status))
      throw new AppError(
        'INVALID_STATE',
        `A ${v.status} voucher cannot be ${action.toLowerCase()}d`,
        409,
      );
    const target = to(v);
    await this.prisma.$transaction((tx) =>
      this.core.transition(tx, v, target, {
        action,
        actor,
        reason: body.reason,
        reasonAr: body.reasonAr,
        data: data(v, target),
        meta,
      }),
    );
    return this.detail(actor, id);
  }

  pause(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    return this.control(
      actor,
      id,
      ['ON_SALE', 'SCHEDULED', 'SOLD_OUT'],
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
      (v) => this.merchantVouchers.statusOnReturn(v, now),
      'RESUME',
      body,
      meta,
      (_v, t) => ({ pausedBy: null, ...(t === 'ENDED' ? { endedAt: now } : {}) }),
    );
  }

  /** Suspension stops sales AND blocks redemption of vouchers already sold until it is lifted. */
  suspend(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    return this.control(
      actor,
      id,
      ['ON_SALE', 'SCHEDULED', 'PAUSED', 'SOLD_OUT'],
      () => 'SUSPENDED',
      'SUSPEND',
      body,
      meta,
      (v) => ({ statusBeforeSuspension: v.status }),
    );
  }

  reinstate(actor: Actor, id: string, body: Decision, meta: RequestMeta) {
    const now = new Date();
    return this.control(
      actor,
      id,
      ['SUSPENDED'],
      (v) =>
        v.statusBeforeSuspension === 'PAUSED'
          ? 'PAUSED'
          : this.merchantVouchers.statusOnReturn(v, now),
      'REINSTATE',
      body,
      meta,
      (v, t) => ({
        statusBeforeSuspension: null,
        ...(v.statusBeforeSuspension === 'PAUSED' ? {} : { pausedBy: null }),
        ...(t === 'ENDED' ? { endedAt: now } : {}),
      }),
    );
  }
}
