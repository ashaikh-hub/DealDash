import { Injectable } from '@nestjs/common';
import { CASE_OPEN_STATUSES, type OrderRefundReason } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { DisputeService } from '../operations/dispute.service';
import { MarketConfigService } from '../platform/markets/market-config.service';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { RefundsService } from '../vouchers/refunds.service';
import { newRef } from '../vouchers/voucher-content';
import { CONFIG_KEYS } from '@dealdash/config';
import { opsConfig } from './ops-util';

/**
 * Customer support and refund operations (Stage 8) on the existing engines. The support desk sees a consolidated, minimised view
 * of one customer (timeline from the Command Centre service, open cases, restrictions, points) under Role + Scope; it never edits
 * financial history: a correction is a refund (Stage 5 engine, maker-checker), a governed adjustment or a reversal, each a NEW
 * record. Order-level exceptional refunds (duplicate payment, failed issuance) are refund records the second approver decides.
 * Refund rights, windows and tax treatment are Market configuration / VALIDATE-<market>, never invented here.
 */
@Injectable()
export class SupportOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly disputes: DisputeService,
    private readonly refunds: RefundsService,
    private readonly marketConfig: MarketConfigService,
    private readonly markets: MarketService,
  ) {}

  /** The customer card at the top of the support workspace (masked; no card or payment data). */
  async summary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { customer: true },
    });
    if (!user || user.userType !== 'CUSTOMER') throw AppError.notFound();
    const [openCases, supportCases, restrictions, account, activeVouchers, openRefunds] =
      await Promise.all([
        this.prisma.disputeCase.count({
          where: { customerUserId: userId, status: { in: [...CASE_OPEN_STATUSES] } },
        }),
        this.prisma.supportCase.count({ where: { userId, status: { not: 'RESOLVED' } } }),
        this.prisma.operationalRestriction.findMany({
          where: {
            subjectType: 'USER',
            subjectId: userId,
            status: { in: ['ACTIVE', 'PENDING_APPROVAL'] },
          },
          select: { id: true, reference: true, kind: true, status: true, endsAt: true },
        }),
        this.prisma.rewardAccount.findUnique({
          where: { userId },
          select: { availableBalance: true, heldBalance: true },
        }),
        this.prisma.voucherInstance.count({ where: { ownerUserId: userId, status: 'ACTIVE' } }),
        this.prisma.refund.count({
          where: {
            order: { userId },
            status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'FAILED'] },
          },
        }),
      ]);
    return {
      id: user.id,
      firstName: user.customer?.firstName ?? user.displayName.split(' ')[0] ?? null,
      mobileMasked: user.mobile ? `${user.mobile.slice(0, 4)}•••${user.mobile.slice(-2)}` : null,
      city: user.customer?.city ?? null,
      locale: user.locale,
      status: user.status,
      since: user.createdAt.toISOString(),
      openCases,
      openSupportRequests: supportCases,
      restrictions: restrictions.map((r) => ({ ...r, endsAt: r.endsAt.toISOString() })),
      points: account
        ? { available: account.availableBalance, held: account.heldBalance }
        : { available: 0, held: 0 },
      activeVouchers,
      openRefunds,
    };
  }

  /** Customer support requests (Stage 5) with a link to their escalated case, if any. */
  async supportRequests(f: { status?: string; userId?: string }) {
    const rows = await this.prisma.supportCase.findMany({
      where: {
        ...(f.status ? { status: f.status as never } : {}),
        ...(f.userId ? { userId: f.userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const escalated = await this.prisma.disputeCase.findMany({
      where: { supportCaseId: { in: rows.map((r) => r.id) } },
      select: { id: true, reference: true, status: true, supportCaseId: true },
    });
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      type: r.type,
      status: r.status,
      subject: r.subject,
      body: r.body,
      userId: r.userId,
      createdAt: r.createdAt.toISOString(),
      escalatedCase: escalated.find((e) => e.supportCaseId === r.id) ?? null,
    }));
  }

  /** Escalates a customer support request to the shared case framework (CUSTOMER_COMPLAINT), keeping the link both ways. */
  async escalate(
    actor: Actor,
    supportCaseId: string,
    b: { priority?: string; targetOrganizationId?: string | null },
    meta: RequestMeta,
  ) {
    const s = await this.prisma.supportCase.findUnique({ where: { id: supportCaseId } });
    if (!s) throw AppError.notFound();
    const existing = await this.prisma.disputeCase.findFirst({ where: { supportCaseId } });
    if (existing) return this.disputes.get(existing.id);
    const order = s.orderId
      ? await this.prisma.voucherOrder.findUnique({
          where: { id: s.orderId },
          select: { reference: true, organizationId: true },
        })
      : null;
    const c = await this.disputes.open(
      actor,
      null,
      {
        type:
          s.type === 'PAYMENT_ISSUE'
            ? 'PAYMENT_EXCEPTION'
            : s.type === 'REFUND_QUESTION'
              ? 'REFUND_EXCEPTION'
              : s.type === 'VOUCHER_ISSUE' || s.type === 'REDEMPTION_ISSUE'
                ? 'VOUCHER_EXCEPTION'
                : 'CUSTOMER_COMPLAINT',
        title: `${s.reference}: ${s.subject}`.slice(0, 160),
        description: s.body.slice(0, 2000),
        priority: b.priority ?? 'NORMAL',
        product: s.orderId || s.voucherInstanceId ? 'VOUCHER' : null,
        customerUserId: s.userId,
        targetOrganizationId: b.targetOrganizationId ?? order?.organizationId ?? null,
        relatedType: 'SupportCase',
        relatedId: s.id,
        sourceEvent: 'SUPPORT_REQUEST',
        sourceEventId: s.id,
        transactionRef: order?.reference ?? null,
        supportCaseId: s.id,
      },
      meta,
    );
    await this.prisma.supportCase.update({
      where: { id: s.id },
      data: { status: 'IN_PROGRESS', handledByUserId: actor.userId },
    });
    await this.audit.record({
      action: 'SUPPORT_REQUEST_ESCALATED',
      entityType: 'SupportCase',
      entityId: s.id,
      actor,
      newState: { caseId: c.id },
      market: c.market,
      meta,
    });
    return c;
  }

  // ---------------------------------------------------------------- refund operations
  /** Market refund policy and its open validation items (never decided here). */
  private async marketRefundPolicy(market: string) {
    const policy = await this.marketConfig
      .resolvePolicy(market, 'REFUND', 'refund_policy', { product: 'VOUCHER' })
      .catch(() => null);
    const validations = await this.prisma.marketValidationItem.findMany({
      where: {
        market,
        status: { in: ['OPEN', 'IN_REVIEW'] },
        OR: [
          { topic: { contains: 'refund', mode: 'insensitive' } },
          { description: { contains: 'refund', mode: 'insensitive' } },
        ],
      },
      select: { code: true, topic: true, status: true },
      take: 20,
    });
    return {
      marketPolicy: policy
        ? { version: policy.version, value: policy.value, validationCode: policy.validationCode }
        : null,
      validations,
    };
  }

  /** What a refund of this voucher or order would look like, and what stops it (the decision stays with a person). */
  async eligibility(q: { instanceId?: string; orderId?: string }, now = new Date()) {
    const inst = q.instanceId
      ? await this.prisma.voucherInstance.findUnique({ where: { id: q.instanceId } })
      : null;
    const orderId = inst?.orderId ?? q.orderId;
    if (!orderId) throw AppError.validation('Choose a voucher or an order', 'orderId');
    const order = await this.prisma.voucherOrder.findUnique({
      where: { id: orderId },
      include: {
        payments: true,
        instances: { select: { id: true, status: true } },
        refunds: {
          select: {
            id: true,
            reference: true,
            status: true,
            amountHalalas: true,
            instanceId: true,
          },
        },
      },
    });
    if (!order) throw AppError.notFound();
    const policy = await this.refundsPolicy();
    const succeeded = order.payments.filter((p) =>
      ['SUCCEEDED', 'REFUND_PENDING'].includes(p.status),
    );
    const blockers: string[] = [];
    let amountMinor = 0;
    let withinWindow: boolean | null = null;
    if (inst) {
      amountMinor = inst.purchasePriceHalalas;
      if (inst.status === 'REDEEMED') blockers.push('REDEEMED_REVERSAL_REQUIRED');
      else if (inst.status !== 'ACTIVE') blockers.push(`VOUCHER_${inst.status}`);
      withinWindow = now.getTime() <= inst.issuedAt.getTime() + policy.windowHours * 3_600_000;
      if (!withinWindow && policy.outsideWindow === 'BLOCK') blockers.push('WINDOW_PASSED');
      if (
        order.refunds.some(
          (r) => r.instanceId === inst.id && !['REJECTED', 'FAILED'].includes(r.status),
        )
      )
        blockers.push('REFUND_ALREADY_OPEN');
    } else {
      amountMinor = order.totalHalalas;
      if (!succeeded.length) blockers.push('NO_CONFIRMED_PAYMENT');
    }
    if (!succeeded.length && !blockers.includes('NO_CONFIRMED_PAYMENT'))
      blockers.push('NO_CONFIRMED_PAYMENT');
    const market = await this.markets.resolveMarket(order.organizationId).catch(() => null);
    return {
      orderId: order.id,
      orderReference: order.reference,
      instanceId: inst?.id ?? null,
      currency: order.currency,
      amountMinor,
      eligible: blockers.length === 0,
      blockers,
      withinWindow,
      policy,
      // order-level exceptional refunds DealDash can start (a second person approves)
      orderLevel: {
        duplicatePayment: succeeded.length > 1,
        failedIssuance: succeeded.length > 0 && order.instances.length === 0,
      },
      refunds: order.refunds.map((r) => ({ ...r })),
      // the order's payments (an order-level refund names the payment it returns)
      payments: order.payments.map((p) => ({
        id: p.id,
        status: p.status,
        amountMinor: p.amountHalalas,
        createdAt: p.createdAt.toISOString(),
      })),
      market,
      ...(market ? await this.marketRefundPolicy(market) : { marketPolicy: null, validations: [] }),
    };
  }

  private async refundsPolicy() {
    const v = ((await this.config.get<{
      windowHours?: number;
      outsideWindow?: string;
      checkerThresholdHalalas?: number;
    }>(CONFIG_KEYS.VOUCHER_REFUND_POLICY)) ?? {}) as {
      windowHours?: number;
      outsideWindow?: string;
      checkerThresholdHalalas?: number;
    };
    return {
      windowHours: v.windowHours ?? 24,
      outsideWindow: v.outsideWindow === 'BLOCK' ? 'BLOCK' : 'REVIEW',
      checkerThresholdMinor: v.checkerThresholdHalalas ?? 0,
    };
  }

  /**
   * Order-level exceptional refund (maker): a duplicate payment (one of two confirmed payments for the same order) or a failed
   * issuance (paid, nothing issued). It is a REQUESTED admin refund: a different person approves it through the refund engine,
   * which calls the provider idempotently, posts the ledger journal and tells the customer.
   */
  async orderRefund(
    actor: Actor,
    b: {
      orderId: string;
      paymentId: string;
      reason: OrderRefundReason;
      note: string;
      caseId?: string | null;
    },
    meta: RequestMeta,
  ) {
    const order = await this.prisma.voucherOrder.findUnique({
      where: { id: b.orderId },
      include: { payments: true, instances: { select: { id: true } } },
    });
    if (!order) throw AppError.notFound();
    const payment = order.payments.find((p) => p.id === b.paymentId);
    if (!payment || payment.status !== 'SUCCEEDED')
      throw AppError.validation('Choose a confirmed payment of this order', 'paymentId');
    const confirmed = order.payments.filter((p) =>
      ['SUCCEEDED', 'REFUND_PENDING', 'REFUNDED'].includes(p.status),
    );
    if (b.reason === 'DUPLICATE_PAYMENT' && confirmed.length < 2)
      throw new AppError('REFUND_NOT_AVAILABLE', 'This order has only one confirmed payment', 409);
    if (b.reason === 'FAILED_ISSUANCE' && order.instances.length > 0)
      throw new AppError(
        'REFUND_NOT_AVAILABLE',
        'Vouchers were issued for this order: refund them one by one',
        409,
      );
    if (b.reason === 'PAYMENT_REVERSAL')
      throw new AppError(
        'REFUND_NOT_AVAILABLE',
        'A provider reversal moves no money back through DealDash: open a PAYMENT_EXCEPTION case instead',
        409,
      );
    const key = `order-refund:${payment.id}`;
    const prior = await this.prisma.refund.findUnique({ where: { idempotencyKey: key } });
    if (prior) return { id: prior.id, reference: prior.reference, status: prior.status };
    const cfg = await opsConfig(this.config);
    const r = await this.prisma.$transaction(async (tx) => {
      const row = await tx.refund.create({
        data: {
          reference: newRef('RF'),
          orderId: order.id,
          paymentId: payment.id,
          organizationId: order.organizationId,
          amountHalalas: payment.amountHalalas,
          currency: payment.currency,
          status: 'REQUESTED',
          kind: 'ADMIN_INITIATED',
          reasonCode: b.reason,
          reason: b.note,
          requestedByUserId: actor.userId,
          requestedByRole: actor.membership?.roleCode ?? 'ADMIN',
          idempotencyKey: key,
          caseId: b.caseId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'refund.order_level_requested',
          entityType: 'Refund',
          entityId: row.id,
          actor,
          subjectOrganizationId: order.organizationId,
          reason: b.note,
          newState: {
            reason: b.reason,
            amountMinor: payment.amountHalalas,
            paymentId: payment.id,
            approvalMode: cfg.approvals.orderRefund.mode,
          },
          meta,
        },
        tx,
      );
      return row;
    });
    // with no second person configured it is decided at once by the same refund engine (still idempotent and audited)
    if (
      cfg.approvals.orderRefund.mode === 'NEVER' ||
      (cfg.approvals.orderRefund.mode === 'ABOVE_THRESHOLD' &&
        payment.amountHalalas <= cfg.approvals.orderRefund.thresholdMinor)
    )
      await this.refunds
        .approve(actor, r.id, `Order-level refund (${b.reason}) below the approval threshold`, meta)
        .catch(() => null);
    const fresh = await this.prisma.refund.findUniqueOrThrow({ where: { id: r.id } });
    return { id: fresh.id, reference: fresh.reference, status: fresh.status };
  }

  /** Links a refund to the operational case it belongs to. */
  async linkRefund(actor: Actor, refundId: string, caseId: string, meta: RequestMeta) {
    const r = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!r) throw AppError.notFound();
    await this.disputes.load(caseId);
    await this.prisma.refund.update({ where: { id: refundId }, data: { caseId } });
    await this.audit.record({
      action: 'refund.case_linked',
      entityType: 'Refund',
      entityId: refundId,
      actor,
      subjectOrganizationId: r.organizationId,
      newState: { caseId },
      meta,
    });
    return { id: refundId, caseId };
  }

  /** Refund operations queue: everything not finished, with the case it belongs to. */
  async refundQueue(f: { status?: string }) {
    const rows = await this.prisma.refund.findMany({
      where: f.status
        ? { status: f.status as never }
        : { status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'FAILED'] } },
      include: { order: { select: { reference: true, userId: true, currency: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map(
      (
        r: Prisma.RefundGetPayload<{
          include: { order: { select: { reference: true; userId: true; currency: true } } };
        }>,
      ) => ({
        id: r.id,
        reference: r.reference,
        status: r.status,
        kind: r.kind,
        reasonCode: r.reasonCode,
        amountMinor: r.amountHalalas,
        currency: r.order.currency,
        orderId: r.orderId,
        orderReference: r.order.reference,
        customerUserId: r.order.userId,
        organizationId: r.organizationId,
        caseId: r.caseId,
        requestedByUserId: r.requestedByUserId,
        failureCode: r.failureCode,
        createdAt: r.createdAt.toISOString(),
      }),
    );
  }
}
