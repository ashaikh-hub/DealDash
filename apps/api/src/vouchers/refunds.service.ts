import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LoyaltyIssuanceService } from '../loyalty/loyalty-issuance.service';
import type { PaymentEventOutcome, RefundStatus } from '@dealdash/types';
import type { AdminRefundRow, RefundView } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { NotificationsService, type NotificationInput } from '../hot-deals/notifications.service';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type PaymentWebhookEvent,
} from '../providers/interfaces';
import { LedgerService } from './ledger.service';
import { newRef, parseVoucherContent } from './voucher-content';
import { VoucherCoreService } from './voucher-core.service';
import { VoucherEventsService } from './voucher-events.service';

type Tx = Prisma.TransactionClient;
type PostCommit = () => Promise<void> | void;

const REFUND_INCLUDE = {
  order: { include: { voucher: { include: { organization: { include: { merchant: true } } } } } },
  payment: true,
  instance: true,
} satisfies Prisma.RefundInclude;
type RefundRow = Prisma.RefundGetPayload<{ include: typeof REFUND_INCLUDE }>;

/**
 * Refunds (full, before redemption: VC-36, PY-08). Rules are configuration (window, outside-window behaviour, second approver
 * threshold) and VALIDATE-KSA: nothing here hard-codes Saudi refund law.
 *
 *  - within the refund window a customer request is approved automatically; outside it, it is either blocked or sent to
 *    review (configuration);
 *  - a redeemed voucher can never be refunded here: the redemption must first be reversed under the redemption rules (RD-40);
 *  - the voucher is blocked from redemption the moment a refund is approved (VOIDED), and becomes REFUNDED when the provider
 *    confirms the money went back; a failed refund goes to an exception queue (admin retry) and the voucher stays blocked;
 *  - the provider call is idempotent per refund (its key) and the ledger journal is posted once per refund;
 *  - exceptional admin-initiated refunds need a second approver (maker-checker).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger('Refunds');

  constructor(
    private readonly core: VoucherCoreService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly events: VoucherEventsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Optional() private readonly loyalty?: LoyaltyIssuanceService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  // ---------------------------------------------------------------- views
  view(r: {
    id: string;
    reference: string;
    status: RefundStatus;
    kind: 'CUSTOMER_REQUEST' | 'ADMIN_INITIATED' | 'SYSTEM';
    amountHalalas: number;
    reasonCode: string;
    createdAt: Date;
    decidedAt: Date | null;
    refundedAt: Date | null;
    decisionNote: string | null;
  }): RefundView {
    return {
      id: r.id,
      reference: r.reference,
      status: r.status,
      kind: r.kind,
      amountHalalas: r.amountHalalas,
      reasonCode: r.reasonCode,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      refundedAt: r.refundedAt ? r.refundedAt.toISOString() : null,
      // only a rejection carries a customer-visible explanation
      decisionNote: r.status === 'REJECTED' ? r.decisionNote : null,
    };
  }

  async needsChecker(r: { kind: string; amountHalalas: number }): Promise<boolean> {
    if (r.kind !== 'ADMIN_INITIATED') return false;
    const p = await this.core.refundPolicy();
    return r.amountHalalas >= p.checkerThresholdHalalas;
  }

  async adminRow(r: RefundRow, actor: Actor): Promise<AdminRefundRow> {
    const checker = await this.needsChecker(r);
    const canManage = actor.permissions.has('admin.refunds.manage');
    const actions: Array<'approve' | 'reject' | 'retry'> = [];
    if (canManage) {
      if (r.status === 'REQUESTED' || r.status === 'UNDER_REVIEW') {
        const selfApproval = checker && r.requestedByUserId === actor.userId;
        if (!selfApproval) actions.push('approve');
        actions.push('reject');
      }
      if (r.status === 'FAILED') actions.push('retry');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: r.order.userId },
      select: { displayName: true, customer: { select: { firstName: true } } },
    });
    return {
      ...this.view(r),
      // admins see the real reason text
      decisionNote: r.decisionNote,
      orderReference: r.order.reference,
      voucherReference: r.instance?.reference ?? null,
      merchant: merchantDisplayName(r.order.voucher.organization),
      customerFirstName: user?.customer?.firstName || user?.displayName.split(' ')[0] || null,
      requestedByRole: r.requestedByRole,
      needsChecker: checker,
      actions,
      note: r.reason,
    };
  }

  async listAdmin(
    actor: Actor,
    q: { limit: number; cursor?: string; status?: RefundStatus },
  ): Promise<Page<AdminRefundRow>> {
    const page = await keysetPage({
      findMany: (query) => this.prisma.refund.findMany({ ...query, include: REFUND_INCLUDE }),
      baseWhere: (q.status ? { status: q.status } : {}) as Record<string, unknown>,
      sort: { field: 'createdAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    return new Page(
      await Promise.all(page.items.map((r) => this.adminRow(r as RefundRow, actor))),
      page.nextCursor,
    );
  }

  private async load(id: string): Promise<RefundRow> {
    const r = await this.prisma.refund.findUnique({ where: { id }, include: REFUND_INCLUDE });
    if (!r) throw AppError.notFound();
    return r;
  }

  private notifyData(r: RefundRow, extra: Record<string, unknown> = {}) {
    const c = parseVoucherContent(r.order.voucher.content);
    const m = merchantDisplayName(r.order.voucher.organization);
    return {
      voucherTitleEn: c.title.en,
      voucherTitleAr: c.title.ar,
      merchantNameEn: m.en,
      merchantNameAr: m.ar,
      refundReference: r.reference,
      instanceId: r.instanceId,
      amountHalalas: r.amountHalalas,
      ...extra,
    };
  }

  // ---------------------------------------------------------------- creation
  /** Money arrived for an order that is already closed (or a duplicate capture): refund it automatically. */
  async createSystemRefund(
    tx: Tx,
    input: {
      order: { id: string; organizationId: string; userId: string };
      paymentId: string;
      amountHalalas: number;
      note: string;
    },
  ) {
    const key = `sys-refund:${input.paymentId}`;
    const prior = await tx.refund.findUnique({ where: { idempotencyKey: key } });
    if (prior) return prior;
    const refund = await tx.refund.create({
      data: {
        reference: newRef('RF'),
        orderId: input.order.id,
        paymentId: input.paymentId,
        organizationId: input.order.organizationId,
        amountHalalas: input.amountHalalas,
        status: 'APPROVED',
        kind: 'SYSTEM',
        reasonCode: 'LATE_OR_DUPLICATE_PAYMENT',
        reason: input.note,
        requestedByRole: 'SYSTEM',
        decidedAt: new Date(),
        decisionNote: input.note,
        idempotencyKey: key,
      },
    });
    await this.core.audit.record(
      {
        action: 'refund.system_created',
        entityType: 'Refund',
        entityId: refund.id,
        actorRole: 'SYSTEM',
        subjectOrganizationId: input.order.organizationId,
        reason: input.note,
        newState: { amountHalalas: input.amountHalalas, paymentId: input.paymentId },
      },
      tx,
    );
    return refund;
  }

  private async succeededPayment(orderId: string) {
    const p = await this.prisma.payment.findFirst({
      where: { orderId, status: { in: ['SUCCEEDED', 'REFUND_PENDING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!p)
      throw new AppError('REFUND_NOT_AVAILABLE', 'There is no confirmed payment to refund', 409);
    return p;
  }

  private blockedByState(status: string): AppError {
    return status === 'REDEEMED'
      ? new AppError('REFUND_NOT_AVAILABLE', 'This voucher has already been used', 409)
      : new AppError('REFUND_NOT_AVAILABLE', 'A refund is not available for this voucher', 409);
  }

  /** The customer asks for a refund of an unused voucher. */
  async requestByCustomer(
    actor: Actor,
    instanceId: string,
    input: { reasonCode: string; note?: string },
    meta: RequestMeta,
    now = new Date(),
  ): Promise<RefundView> {
    const inst = await this.prisma.voucherInstance.findFirst({
      where: { id: instanceId, ownerUserId: actor.userId },
    });
    if (!inst) throw AppError.notFound();
    if (inst.status !== 'ACTIVE') throw this.blockedByState(inst.status);
    const policy = await this.core.refundPolicy();
    const windowEnd = new Date(inst.issuedAt.getTime() + policy.windowHours * 3_600_000);
    const within = now.getTime() <= windowEnd.getTime();
    if (!within && policy.outsideWindow === 'BLOCK')
      throw new AppError(
        'REFUND_WINDOW_PASSED',
        'The refund window for this voucher has passed',
        409,
      );
    const payment = await this.succeededPayment(inst.orderId);
    const n = await this.prisma.refund.count({ where: { instanceId } });
    let refundId: string;
    try {
      refundId = await this.prisma.$transaction(async (tx) => {
        const refund = await tx.refund.create({
          data: {
            reference: newRef('RF'),
            orderId: inst.orderId,
            paymentId: payment.id,
            instanceId: inst.id,
            organizationId: inst.organizationId,
            amountHalalas: inst.purchasePriceHalalas,
            status: within ? 'APPROVED' : 'UNDER_REVIEW',
            kind: 'CUSTOMER_REQUEST',
            reasonCode: input.reasonCode,
            reason: input.note ?? null,
            requestedByUserId: actor.userId,
            requestedByRole: 'CUSTOMER',
            decidedAt: within ? now : null,
            decisionNote: within ? 'Within the refund window' : null,
            idempotencyKey: `refund:${inst.id}:${n + 1}`,
          },
        });
        if (within) {
          const blocked = await tx.voucherInstance.updateMany({
            where: { id: inst.id, status: 'ACTIVE' },
            data: { status: 'VOIDED', voidedAt: now },
          });
          // redeemed in the same instant: the redemption won
          if (blocked.count !== 1)
            throw new AppError('REFUND_NOT_AVAILABLE', 'This voucher has already been used', 409);
        }
        await this.core.audit.record(
          {
            action: 'refund.request',
            entityType: 'Refund',
            entityId: refund.id,
            actor,
            subjectOrganizationId: inst.organizationId,
            reason: input.note ?? input.reasonCode,
            newState: { status: refund.status, within },
            meta,
          },
          tx,
        );
        return refund.id;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new AppError(
          'REFUND_ALREADY_OPEN',
          'A refund for this voucher is already in progress',
          409,
        );
      throw e;
    }
    const sent = await this.events.record(
      null,
      'REFUND_REQUESTED',
      { voucherId: inst.voucherId, organizationId: inst.organizationId },
      actor.userId,
      'voucher.refund_requested',
      { refundId },
    );
    sent();
    if (within) await this.execute(refundId, meta);
    else await this.notifyStatus(refundId);
    return this.view(await this.load(refundId));
  }

  /** Exceptional refund started by DealDash (maker). A second admin must approve it (checker). */
  async createByAdmin(
    actor: Actor,
    input: { instanceId: string; reason: string },
    meta: RequestMeta,
  ): Promise<AdminRefundRow> {
    const inst = await this.prisma.voucherInstance.findUnique({ where: { id: input.instanceId } });
    if (!inst) throw AppError.notFound();
    if (inst.status === 'REDEEMED')
      throw new AppError(
        'REDEMPTION_REVERSAL_REQUIRED',
        'A redeemed voucher can only be refunded after its redemption is reversed',
        409,
      );
    if (inst.status !== 'ACTIVE') throw this.blockedByState(inst.status);
    const payment = await this.succeededPayment(inst.orderId);
    const n = await this.prisma.refund.count({ where: { instanceId: inst.id } });
    try {
      const refund = await this.prisma.$transaction(async (tx) => {
        const r = await tx.refund.create({
          data: {
            reference: newRef('RF'),
            orderId: inst.orderId,
            paymentId: payment.id,
            instanceId: inst.id,
            organizationId: inst.organizationId,
            amountHalalas: inst.purchasePriceHalalas,
            status: 'REQUESTED',
            kind: 'ADMIN_INITIATED',
            reasonCode: 'ADMIN_EXCEPTION',
            reason: input.reason,
            requestedByUserId: actor.userId,
            requestedByRole: actor.membership?.roleCode ?? 'ADMIN',
            idempotencyKey: `refund:${inst.id}:${n + 1}`,
          },
        });
        await this.core.audit.record(
          {
            action: 'refund.admin_created',
            entityType: 'Refund',
            entityId: r.id,
            actor,
            subjectOrganizationId: inst.organizationId,
            reason: input.reason,
            meta,
          },
          tx,
        );
        return r;
      });
      return this.adminRow(await this.load(refund.id), actor);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        throw new AppError(
          'REFUND_ALREADY_OPEN',
          'A refund for this voucher is already in progress',
          409,
        );
      throw e;
    }
  }

  // ---------------------------------------------------------------- admin decisions
  async approve(actor: Actor, id: string, reason: string, meta: RequestMeta, now = new Date()) {
    const r = await this.load(id);
    if (r.status !== 'REQUESTED' && r.status !== 'UNDER_REVIEW')
      throw new AppError('INVALID_STATE', `A ${r.status} refund cannot be approved`, 409);
    if ((await this.needsChecker(r)) && r.requestedByUserId === actor.userId)
      throw new AppError(
        'CHECKER_REQUIRED',
        'A different administrator must approve this refund',
        403,
      );
    await this.prisma.$transaction(async (tx) => {
      const upd = await tx.refund.updateMany({
        where: { id, status: r.status },
        data: {
          status: 'APPROVED',
          decidedAt: now,
          decidedByUserId: actor.userId,
          decisionNote: reason,
        },
      });
      if (upd.count !== 1)
        throw new AppError('VERSION_CONFLICT', 'The refund changed. Reload and try again.', 409);
      if (r.instanceId) {
        const blocked = await tx.voucherInstance.updateMany({
          where: { id: r.instanceId, status: 'ACTIVE' },
          data: { status: 'VOIDED', voidedAt: now },
        });
        if (blocked.count !== 1)
          throw new AppError(
            'REFUND_NOT_AVAILABLE',
            'The voucher is no longer unused: reject this refund',
            409,
          );
      }
      await this.core.audit.record(
        {
          action: 'refund.approve',
          entityType: 'Refund',
          entityId: id,
          actor,
          reason,
          subjectOrganizationId: r.organizationId,
          previousState: { status: r.status },
          newState: { status: 'APPROVED' },
          meta,
        },
        tx,
      );
    });
    await this.execute(id, meta);
    return this.adminRow(await this.load(id), actor);
  }

  async reject(actor: Actor, id: string, reason: string, meta: RequestMeta, now = new Date()) {
    const r = await this.load(id);
    if (r.status !== 'REQUESTED' && r.status !== 'UNDER_REVIEW')
      throw new AppError('INVALID_STATE', `A ${r.status} refund cannot be rejected`, 409);
    await this.prisma.$transaction(async (tx) => {
      const upd = await tx.refund.updateMany({
        where: { id, status: r.status },
        data: {
          status: 'REJECTED',
          decidedAt: now,
          decidedByUserId: actor.userId,
          decisionNote: reason,
        },
      });
      if (upd.count !== 1)
        throw new AppError('VERSION_CONFLICT', 'The refund changed. Reload and try again.', 409);
      await this.core.audit.record(
        {
          action: 'refund.reject',
          entityType: 'Refund',
          entityId: id,
          actor,
          reason,
          subjectOrganizationId: r.organizationId,
          previousState: { status: r.status },
          newState: { status: 'REJECTED' },
          meta,
        },
        tx,
      );
    });
    await this.notifyStatus(id);
    return this.adminRow(await this.load(id), actor);
  }

  async retry(actor: Actor, id: string, meta: RequestMeta) {
    const r = await this.load(id);
    if (r.status !== 'FAILED')
      throw new AppError('INVALID_STATE', 'Only a failed refund can be retried', 409);
    await this.core.audit.record({
      action: 'refund.retry',
      entityType: 'Refund',
      entityId: id,
      actor,
      subjectOrganizationId: r.organizationId,
      meta,
    });
    await this.execute(id, meta);
    return this.adminRow(await this.load(id), actor);
  }

  // ---------------------------------------------------------------- execution (provider call; never inside a transaction)
  async execute(refundId: string, meta: RequestMeta | null = null, now = new Date()) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const upd = await tx.refund.updateMany({
        where: { id: refundId, status: { in: ['APPROVED', 'FAILED'] } },
        data: { status: 'PROCESSING', failureCode: null },
      });
      if (upd.count !== 1) return false;
      const r = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
      // payment: SUCCEEDED -> REFUND_PENDING (a retried refund finds it already pending, which is fine)
      await tx.payment.updateMany({
        where: { id: r.paymentId, status: 'SUCCEEDED' },
        data: { status: 'REFUND_PENDING' },
      });
      return true;
    });
    if (!claimed) return;
    const r = await this.load(refundId);
    let res: { refundReference: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' };
    try {
      res = await this.provider.refund({
        providerReference: r.payment.providerReference ?? '',
        amountHalalas: r.amountHalalas,
        idempotencyKey: r.idempotencyKey,
      });
    } catch (e) {
      this.logger.warn(`Provider refund call failed for ${r.reference}: ${(e as Error).message}`);
      res = { refundReference: '', status: 'FAILED' };
    }
    const sent: Array<NotificationInput & { id: string }> = [];
    const post: PostCommit[] = [];
    await this.prisma.$transaction(async (tx) => {
      if (res.status === 'SUCCEEDED')
        await this.completeInTx(tx, r.id, res.refundReference, now, sent, post);
      else if (res.status === 'PENDING')
        await tx.refund.update({
          where: { id: r.id },
          data: { providerRefundReference: res.refundReference },
        });
      else await this.failInTx(tx, r.id, 'PROVIDER_DECLINED', sent);
    });
    await this.notifications.dispatch(sent);
    for (const f of post) await Promise.resolve(f()).catch(() => undefined);
    void meta;
  }

  /** Provider confirmed the money went back: the voucher becomes REFUNDED and the ledger reverses the held amount. */
  private async completeInTx(
    tx: Tx,
    refundId: string,
    providerRef: string,
    now: Date,
    sent: Array<NotificationInput & { id: string }>,
    post: PostCommit[],
  ) {
    const r = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: REFUND_INCLUDE,
    });
    const upd = await tx.refund.updateMany({
      where: { id: refundId, status: 'PROCESSING' },
      data: {
        status: 'REFUNDED',
        refundedAt: now,
        providerRefundReference: providerRef || r.providerRefundReference,
      },
    });
    if (upd.count !== 1) return;
    await tx.payment.updateMany({
      where: { id: r.paymentId, status: { in: ['REFUND_PENDING', 'SUCCEEDED'] } },
      data: { status: 'REFUNDED' },
    });
    const paid = await tx.payment.findUnique({ where: { id: r.paymentId }, select: { orderId: true } });
    if (paid?.orderId) await this.loyalty?.reverseForSource(tx, { sourceType: 'EVENT', sourceId: paid.orderId, reason: 'PURCHASE_REFUNDED' });
    if (r.instanceId)
      await tx.voucherInstance.updateMany({
        where: { id: r.instanceId, status: { in: ['VOIDED', 'ACTIVE'] } },
        data: { status: 'REFUNDED', refundedAt: now, version: { increment: 1 } },
      });
    const j = await this.ledger.post(tx, {
      type: 'REFUND',
      sourceType: 'Refund',
      sourceId: r.id,
      idempotencyKey: `refund:${r.id}`,
      memo: `Refund ${r.reference}`,
      lines: [
        {
          family: 'MERCHANT_HELD',
          organizationId: r.organizationId,
          amountHalalas: r.amountHalalas,
        },
        { family: 'PSP_CLEARING', amountHalalas: -r.amountHalalas },
      ],
    });
    await tx.merchantPayableEvent.create({
      data: {
        organizationId: r.organizationId,
        voucherId: r.order.voucherId,
        instanceId: r.instanceId,
        type: 'REFUNDED',
        amountHalalas: r.amountHalalas,
        journalId: j.journalId,
        note: r.reference,
        createdAt: now,
      },
    });
    await this.core.audit.record(
      {
        action: 'refund.completed',
        entityType: 'Refund',
        entityId: r.id,
        actorRole: 'SYSTEM',
        subjectOrganizationId: r.organizationId,
        newState: { status: 'REFUNDED', providerRefundReference: providerRef },
      },
      tx,
    );
    post.push(
      await this.events.record(
        tx,
        'REFUND_COMPLETED',
        { voucherId: r.order.voucherId, organizationId: r.organizationId },
        r.order.userId,
        'voucher.refund_completed',
        { refundId: r.id },
      ),
    );
    sent.push(
      ...(await this.notifications.emit(tx, [
        {
          userId: r.order.userId,
          type: 'REFUND_UPDATED',
          dedupeKey: `refund:${r.id}:REFUNDED`,
          data: this.notifyData(r, { status: 'REFUNDED' }),
        },
      ])),
    );
  }

  private async failInTx(
    tx: Tx,
    refundId: string,
    code: string,
    sent: Array<NotificationInput & { id: string }>,
  ) {
    const r = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: REFUND_INCLUDE,
    });
    const upd = await tx.refund.updateMany({
      where: { id: refundId, status: 'PROCESSING' },
      data: { status: 'FAILED', failureCode: code },
    });
    if (upd.count !== 1) return;
    // the money did not move: the payment is simply SUCCEEDED again; the voucher stays blocked until Finance resolves it
    await tx.payment.updateMany({
      where: { id: r.paymentId, status: 'REFUND_PENDING' },
      data: { status: 'SUCCEEDED' },
    });
    await this.core.audit.record(
      {
        action: 'refund.failed',
        entityType: 'Refund',
        entityId: r.id,
        actorRole: 'SYSTEM',
        subjectOrganizationId: r.organizationId,
        reason: code,
        newState: { status: 'FAILED' },
      },
      tx,
    );
    sent.push(
      ...(await this.notifications.emit(tx, [
        {
          userId: r.order.userId,
          type: 'REFUND_UPDATED',
          dedupeKey: `refund:${r.id}:FAILED:${Date.now()}`,
          data: this.notifyData(r, { status: 'FAILED' }),
        },
      ])),
    );
  }

  /** Customer notification for review/rejection states. */
  async notifyStatus(refundId: string) {
    const r = await this.load(refundId);
    const sent = await this.prisma.$transaction((tx) =>
      this.notifications.emit(tx, [
        {
          userId: r.order.userId,
          type: 'REFUND_UPDATED',
          dedupeKey: `refund:${r.id}:${r.status}`,
          data: this.notifyData(r, { status: r.status }),
        },
      ]),
    );
    await this.notifications.dispatch(sent);
  }

  // ---------------------------------------------------------------- asynchronous provider result (webhook)
  async applyProviderRefund(
    event: Extract<PaymentWebhookEvent, { kind: 'REFUND' }>,
    _incoming: unknown,
    store: (
      tx: Tx,
      paymentId: string | null,
      status: string,
      outcome: PaymentEventOutcome,
      note: string | null,
    ) => Promise<unknown>,
    now = new Date(),
  ): Promise<PaymentEventOutcome> {
    const refund = await this.prisma.refund.findFirst({
      where: {
        OR: [
          { providerRefundReference: event.refundReference },
          { payment: { providerReference: event.providerReference }, status: 'PROCESSING' },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    const sent: Array<NotificationInput & { id: string }> = [];
    const post: PostCommit[] = [];
    const outcome = await this.prisma.$transaction(async (tx) => {
      if (!refund) {
        await store(tx, null, event.status, 'IGNORED', 'UNKNOWN_REFUND');
        return 'IGNORED' as PaymentEventOutcome;
      }
      await tx.$queryRaw`SELECT "id" FROM "Refund" WHERE "id" = ${refund.id}::uuid FOR UPDATE`;
      const fresh = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
      let out: PaymentEventOutcome = 'APPLIED';
      if (fresh.status !== 'PROCESSING') out = 'IGNORED';
      else if (event.status === 'SUCCEEDED')
        await this.completeInTx(tx, fresh.id, event.refundReference, now, sent, post);
      else await this.failInTx(tx, fresh.id, 'PROVIDER_FAILED', sent);
      await store(
        tx,
        fresh.paymentId,
        event.status,
        out,
        out === 'IGNORED' ? `Refund already ${fresh.status}` : null,
      );
      return out;
    });
    await this.notifications.dispatch(sent);
    for (const f of post) await Promise.resolve(f()).catch(() => undefined);
    return outcome;
  }
}
