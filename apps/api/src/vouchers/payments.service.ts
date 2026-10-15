import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { LoyaltyIssuanceService } from '../loyalty/loyalty-issuance.service';
import type { ApiEnv } from '@dealdash/config';
import {
  canTransitionPayment,
  type PaymentEventOutcome,
  type PaymentStatus,
} from '@dealdash/types';
import type { OrderView, PaymentView } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { APP_ENV } from '../common/env';
import type { Actor, RequestMeta } from '../common/request-context';
import { NotificationsService, type NotificationInput } from '../hot-deals/notifications.service';
import { ReservationPaymentsService } from '../hot-deals/reservation-payments.service';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import { EligibilityService, evaluateEligibility } from '../live-deals/eligibility.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type PaymentWebhookEvent,
} from '../providers/interfaces';
import { LedgerService } from './ledger.service';
import {
  instanceExpiry,
  newManualCode,
  newQrToken,
  newRef,
  parseVoucherContent,
} from './voucher-content';
import { VOUCHER_INCLUDE, VoucherCoreService, type VoucherRow } from './voucher-core.service';
import { VoucherEventsService } from './voucher-events.service';
import { RefundsService } from './refunds.service';
import { voucherDiscoverable } from './voucher-view.service';
import { FilesService } from '../files/files.service';
import { voucherSavings } from '@dealdash/validation';

/** MVP: one voucher per order (a founder decision can raise it; everything below already supports quantity > 1). */
export const MVP_MAX_QUANTITY = 1;

const SETTLED: PaymentStatus[] = [
  'SUCCEEDED',
  'REFUND_PENDING',
  'REFUNDED',
  'REVERSED',
  'PARTIALLY_REFUNDED',
];

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

interface IncomingPaymentEvent {
  eventId: string;
  kind: 'PAYMENT' | 'REFUND';
  payloadHash: string;
  occurredAt: Date | null;
}

type PostCommit = () => Promise<void> | void;

/**
 * Orders, payment attempts and the provider webhook. The ONE rule that matters: a voucher exists only after a payment is
 * confirmed SUCCEEDED by the provider (webhook or server-side status check). A browser "success" page is never trusted.
 *
 * Safety properties:
 *  - checkout holds stock with one conditional UPDATE (no overselling) and releases it exactly once;
 *  - at most one open payment attempt per order (partial unique index); each attempt has a unique idempotency key;
 *  - duplicate and out-of-order provider callbacks are idempotent (unique provider event id + state-machine checks);
 *  - a late or duplicate capture never issues a second voucher: it is refunded automatically;
 *  - every financial effect is a ledger journal with an idempotency key.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly core: VoucherCoreService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly eligibility: EligibilityService,
    private readonly events: VoucherEventsService,
    private readonly refunds: RefundsService,
    private readonly files: FilesService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
    @Optional() private readonly loyalty?: LoyaltyIssuanceService,
    @Optional() private readonly reservationPayments?: ReservationPaymentsService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  // ================================================================ checkout (hold) ----------------------------------------
  async startCheckout(
    actor: Actor,
    input: { voucherId: string; quantity: number },
    idempotencyKey: string | null,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<OrderView> {
    const userId = actor.userId;
    if (input.quantity > MVP_MAX_QUANTITY)
      throw AppError.validation('Only one voucher can be bought per order for now', 'quantity');
    if (idempotencyKey) {
      const prior = await this.prisma.voucherOrder.findFirst({ where: { userId, idempotencyKey } });
      if (prior) return this.orderView(prior.id);
    }
    const v = await this.prisma.voucher.findUnique({
      where: { id: input.voucherId },
      include: VOUCHER_INCLUDE,
    });
    if (!v || !voucherDiscoverable(v, now).visible || v.status !== 'ON_SALE')
      throw new AppError('OFFER_UNAVAILABLE', 'This voucher is not on sale', 409);
    await this.requireEligible(userId, v, now);
    await this.core.commercial.assertCustomerExposureAllowed(v.organizationId, {
      userId,
      scope: 'NEW_PURCHASES',
    });

    const holdMinutes = await this.core.checkoutHoldMinutes();
    let orderId: string;
    try {
      orderId = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`voucher-buy:${userId}:${v.id}`}))`;
        // the customer already has an open checkout for this voucher: reuse it (no second hold)
        const open = await tx.voucherOrder.findFirst({
          where: { userId, voucherId: v.id, status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
          orderBy: { createdAt: 'desc' },
        });
        if (open) return open.id;
        const owned = await tx.voucherInstance.count({
          where: {
            ownerUserId: userId,
            voucherId: v.id,
            status: { in: ['ACTIVE', 'REDEEMED', 'EXPIRED'] },
          },
        });
        if (owned + input.quantity > v.perCustomerLimit)
          throw new AppError(
            'LIMIT_REACHED',
            'You have reached the purchase limit for this voucher',
            409,
          );
        // the one decisive step: stock moves only by a conditional update, so two buyers can never take the last unit
        const held = await tx.$executeRaw`
          UPDATE "Voucher" SET "heldQty" = "heldQty" + ${input.quantity}, "updatedAt" = now()
           WHERE "id" = ${v.id}::uuid AND "status" = 'ON_SALE'
             AND ("saleEndAt" IS NULL OR "saleEndAt" > (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC'))
             AND "totalQty" - "heldQty" - "soldQty" >= ${input.quantity}`;
        if (held !== 1) throw new AppError('OUT_OF_STOCK', 'This voucher just sold out', 409);
        const order = await tx.voucherOrder.create({
          data: {
            reference: newRef('ORD'),
            userId,
            voucherId: v.id,
            organizationId: v.organizationId,
            quantity: input.quantity,
            unitPriceHalalas: v.sellingPriceHalalas,
            faceValueHalalas: v.faceValueHalalas,
            // the order is priced in the voucher's currency (its market); payment, ledger and payables inherit it
            currency: v.currency,
            totalHalalas: v.sellingPriceHalalas * input.quantity,
            holdExpiresAt: new Date(now.getTime() + holdMinutes * 60_000),
            idempotencyKey,
          },
        });
        await this.syncSoldOut(tx, v.id);
        await this.events.record(
          tx,
          'CHECKOUT_STARTED',
          { voucherId: v.id, organizationId: v.organizationId },
          userId,
        );
        await this.core.audit.record(
          {
            action: 'voucher_order.create',
            entityType: 'VoucherOrder',
            entityId: order.id,
            actor,
            subjectOrganizationId: v.organizationId,
            newState: {
              voucherId: v.id,
              quantity: input.quantity,
              totalHalalas: order.totalHalalas,
            },
            meta,
          },
          tx,
        );
        return order.id;
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        idempotencyKey
      ) {
        const prior = await this.prisma.voucherOrder.findFirst({
          where: { userId, idempotencyKey },
        });
        if (prior) return this.orderView(prior.id);
      }
      throw e;
    }
    this.events.track('voucher.checkout_started', userId, v.organizationId, { voucherId: v.id });
    return this.orderView(orderId);
  }

  private async requireEligible(userId: string, v: VoucherRow, now: Date) {
    const city = v.branches.find((b) => b.branch.status === 'ACTIVE')?.branch.city ?? 'Riyadh';
    const ctx = await this.eligibility.contextFor(userId, city, now);
    const outcome = evaluateEligibility(
      v.eligibilityKind,
      (v.ruleSet?.conditions ?? []).map((c) => ({
        attrType: c.attrType,
        valueRef: c.valueRef,
        requiredLevel: c.requiredLevel,
      })),
      ctx,
      v.ruleSet?.expression,
    );
    if (outcome.result !== 'ELIGIBLE')
      throw new AppError('NOT_ELIGIBLE', 'This voucher is not available for your account', 403);
  }

  /** Sold-out follows issuance capacity: no unheld units left = SOLD_OUT; units coming back reopen the sale. */
  async syncSoldOut(tx: Prisma.TransactionClient, voucherId: string) {
    const row = await tx.voucher.findUnique({ where: { id: voucherId } });
    if (!row) return;
    const remaining = row.totalQty - row.heldQty - row.soldQty;
    try {
      if (row.status === 'ON_SALE' && remaining <= 0)
        await this.core.transition(tx, row, 'SOLD_OUT', { action: 'SOLD_OUT', actor: null });
      else if (row.status === 'SOLD_OUT' && remaining > 0)
        await this.core.transition(tx, row, 'ON_SALE', { action: 'REOPEN', actor: null });
    } catch (e) {
      // someone else moved the voucher at the same moment: their state is the truth
      if (!(e instanceof AppError && e.code === 'VERSION_CONFLICT')) throw e;
    }
  }

  /** Returns the held units to stock exactly once (the conditional order update decides who wins). */
  async releaseOrder(
    tx: Prisma.TransactionClient,
    order: { id: string; voucherId: string; quantity: number },
    to: 'CANCELLED' | 'FAILED' | 'EXPIRED',
    now: Date,
  ): Promise<boolean> {
    const upd = await tx.voucherOrder.updateMany({
      where: { id: order.id, status: 'PENDING_PAYMENT' },
      data: { status: to, ...(to === 'CANCELLED' ? { cancelledAt: now } : { failedAt: now }) },
    });
    if (upd.count !== 1) return false;
    await tx.$executeRaw`UPDATE "Voucher" SET "heldQty" = "heldQty" - ${order.quantity}, "updatedAt" = now()
      WHERE "id" = ${order.voucherId}::uuid AND "heldQty" >= ${order.quantity}`;
    await this.syncSoldOut(tx, order.voucherId);
    return true;
  }

  // ================================================================ pay (a payment attempt) --------------------------------
  async pay(
    actor: Actor,
    orderId: string,
    input: { acceptTerms: true; termsVersion: string; returnUrl?: string },
    meta: RequestMeta,
    now = new Date(),
  ): Promise<OrderView> {
    const order = await this.prisma.voucherOrder.findFirst({
      where: { id: orderId, userId: actor.userId },
      include: {
        voucher: { include: VOUCHER_INCLUDE },
        payments: { orderBy: { attemptNo: 'asc' } },
      },
    });
    if (!order) throw AppError.notFound();
    if (order.status !== 'PENDING_PAYMENT')
      throw new AppError('ORDER_NOT_PAYABLE', 'This order can no longer be paid', 409);
    if (order.voucher.status === 'SUSPENDED')
      throw new AppError('ORDER_NOT_PAYABLE', 'This voucher is not available right now', 409);
    if (order.holdExpiresAt.getTime() <= now.getTime()) {
      await this.settleOrDrop(order.id, now);
      throw new AppError('ORDER_NOT_PAYABLE', 'The checkout time ran out. Start again.', 409);
    }
    await this.requireEligible(actor.userId, order.voucher, now);

    const open = order.payments.find((p) => p.status === 'CREATED' || p.status === 'PENDING');
    if (open) return this.orderView(order.id);
    const limit = await this.core.paymentRetryLimit();
    if (order.payments.length >= limit) {
      await this.prisma.$transaction((tx) => this.releaseOrder(tx, order, 'FAILED', now));
      throw new AppError('PAYMENT_RETRY_LIMIT', 'Too many payment attempts for this order', 409);
    }

    const returnUrl = this.safeReturnUrl(input.returnUrl, order.id);
    const attemptNo = order.payments.length + 1;
    const idempotencyKey = `pay:${order.id}:${attemptNo}`;
    let paymentId: string;
    try {
      paymentId = await this.prisma.$transaction(async (tx) => {
        await tx.voucherOrder.update({
          where: { id: order.id },
          data: { termsVersion: input.termsVersion, termsAcceptedAt: now, returnUrl },
        });
        const p = await tx.payment.create({
          data: {
            orderId: order.id,
            provider: this.provider.name,
            amountHalalas: order.totalHalalas,
            currency: order.currency,
            attemptNo,
            idempotencyKey,
          },
        });
        await this.core.audit.record(
          {
            action: 'payment.create',
            entityType: 'Payment',
            entityId: p.id,
            actor,
            subjectOrganizationId: order.organizationId,
            newState: { orderId: order.id, attemptNo, amountHalalas: order.totalHalalas },
            meta,
          },
          tx,
        );
        return p.id;
      });
    } catch (e) {
      // a concurrent tap already opened the attempt: that one is the attempt
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        return this.orderView(order.id);
      throw e;
    }

    try {
      const res = await this.provider.initiate({
        orderId: order.reference,
        amountHalalas: order.totalHalalas,
        currency: order.currency,
        idempotencyKey,
        returnUrl,
      });
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          providerReference: res.providerReference,
          redirectUrl: res.redirectUrl ?? null,
          status: 'PENDING',
        },
      });
      if (res.status !== 'PENDING')
        await this.applyOutcome({
          providerReference: res.providerReference,
          status: res.status,
          source: 'SYNC',
        });
    } catch (e) {
      this.logger.warn(
        `Provider initiation failed for payment ${paymentId}: ${(e as Error).message}`,
      );
      await this.prisma.payment.updateMany({
        where: { id: paymentId, status: 'CREATED' },
        data: { status: 'FAILED', failureCode: 'PROVIDER_ERROR', completedAt: new Date() },
      });
    }
    const sent = await this.events.record(
      null,
      'PAYMENT_INITIATED',
      { voucherId: order.voucherId, organizationId: order.organizationId },
      actor.userId,
      'voucher.payment_initiated',
      { orderId: order.id, attemptNo },
    );
    sent();
    return this.orderView(order.id);
  }

  /** The return URL must belong to one of our own web origins (never an open redirect). */
  private safeReturnUrl(candidate: string | undefined, orderId: string): string {
    const origins = this.env.CORS_ORIGINS;
    if (candidate && origins.some((o) => candidate.startsWith(o))) return candidate;
    return `${origins[0] ?? 'http://localhost:3001'}/en/orders/${orderId}`;
  }

  // ================================================================ cancel / expiry -----------------------------------------
  async cancelOrder(
    actor: Actor,
    orderId: string,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<OrderView> {
    const order = await this.prisma.voucherOrder.findFirst({
      where: { id: orderId, userId: actor.userId },
      include: { payments: true },
    });
    if (!order) throw AppError.notFound();
    if (order.status === 'PENDING_PAYMENT')
      await this.settleOrDrop(order.id, now, actor, meta, 'CANCELLED');
    return this.orderView(order.id);
  }

  /**
   * Ends an unpaid order: first asks the provider whether the customer actually paid (they may have, a second before the
   * hold ran out), and only then cancels the attempt and returns the held units.
   */
  async settleOrDrop(
    orderId: string,
    now: Date,
    actor: Actor | null = null,
    meta: RequestMeta | null = null,
    to: 'CANCELLED' | 'EXPIRED' = 'EXPIRED',
  ) {
    const open = await this.prisma.payment.findFirst({
      where: { orderId, status: { in: ['CREATED', 'PENDING'] } },
    });
    if (open?.providerReference) {
      const status = await this.provider
        .getStatus(open.providerReference)
        .catch(() => 'PENDING' as const);
      if (status === 'SUCCEEDED') {
        await this.applyOutcome({
          providerReference: open.providerReference,
          status,
          source: 'RECONCILE',
        });
        return;
      }
      await this.provider.cancel(open.providerReference).catch(() => undefined);
    }
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.voucherOrder.findUnique({ where: { id: orderId } });
      if (!order) return;
      await tx.payment.updateMany({
        where: { orderId, status: { in: ['CREATED', 'PENDING'] } },
        data: { status: 'CANCELLED', completedAt: now },
      });
      const released = await this.releaseOrder(tx, order, to, now);
      if (released)
        await this.core.audit.record(
          {
            action: to === 'CANCELLED' ? 'voucher_order.cancel' : 'voucher_order.expire',
            entityType: 'VoucherOrder',
            entityId: orderId,
            actor,
            actorRole: actor ? undefined : 'SYSTEM',
            subjectOrganizationId: order.organizationId,
            meta,
          },
          tx,
        );
    });
  }

  // ================================================================ reading -------------------------------------------------
  private paymentView(p: {
    id: string;
    status: PaymentStatus;
    amountHalalas: number;
    currency: string;
    attemptNo: number;
    redirectUrl: string | null;
    failureCode: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }): PaymentView {
    const open = p.status === 'CREATED' || p.status === 'PENDING';
    return {
      id: p.id,
      status: p.status,
      amountHalalas: p.amountHalalas,
      currency: p.currency,
      attemptNo: p.attemptNo,
      redirectUrl: open ? p.redirectUrl : null,
      failureCode: p.failureCode,
      createdAt: p.createdAt.toISOString(),
      completedAt: p.completedAt ? p.completedAt.toISOString() : null,
    };
  }

  async orderView(orderId: string, now = new Date()): Promise<OrderView> {
    const o = await this.prisma.voucherOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        voucher: { include: { organization: { include: { merchant: true } } } },
        payments: { orderBy: { attemptNo: 'desc' }, take: 1 },
        instances: { select: { id: true }, take: 1 },
      },
    });
    const c = parseVoucherContent(o.voucher.content);
    const first = c.media[0];
    const urls = await this.files.signedUrls([first?.fileId]);
    const count = await this.prisma.payment.count({ where: { orderId } });
    const limit = await this.core.paymentRetryLimit();
    const latest = o.payments[0] ?? null;
    const pending = o.status === 'PENDING_PAYMENT' && o.holdExpiresAt.getTime() > now.getTime();
    const hasOpen = !!latest && (latest.status === 'CREATED' || latest.status === 'PENDING');
    const retriesLeft = Math.max(0, limit - count);
    return {
      id: o.id,
      reference: o.reference,
      status: o.status,
      quantity: o.quantity,
      unitPriceHalalas: o.unitPriceHalalas,
      faceValueHalalas: o.faceValueHalalas,
      totalHalalas: o.totalHalalas,
      currency: o.currency,
      holdExpiresAt: o.holdExpiresAt.toISOString(),
      termsVersion: o.termsVersion,
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt ? o.paidAt.toISOString() : null,
      voucher: {
        id: o.voucherId,
        title: c.title,
        imageUrl: first ? (urls.get(first.fileId) ?? null) : null,
        merchantName: merchantDisplayName(o.voucher.organization),
        reportedSavingsHalalas: voucherSavings(o.faceValueHalalas, o.unitPriceHalalas)
          .savingsHalalas,
      },
      payment: latest ? this.paymentView(latest) : null,
      voucherInstanceId: o.instances[0]?.id ?? null,
      retriesLeft,
      canRetry: pending && !hasOpen && retriesLeft > 0,
      canCancel: o.status === 'PENDING_PAYMENT',
      serverNow: now.toISOString(),
    };
  }

  async getOrder(userId: string, orderId: string): Promise<OrderView> {
    const own = await this.prisma.voucherOrder.findFirst({
      where: { id: orderId, userId },
      select: { id: true },
    });
    if (!own) throw AppError.notFound();
    return this.orderView(orderId);
  }

  async listOrders(userId: string, limit: number): Promise<OrderView[]> {
    const rows = await this.prisma.voucherOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.orderView(r.id)));
  }

  // ================================================================ provider webhook ----------------------------------------
  /**
   * Entry point for provider callbacks. Order of checks: signature, freshness (replay window), duplicate event id, then the
   * state machine. Every verified event is stored exactly once with its outcome (append-only).
   */
  async handleWebhook(
    rawBody: string,
    signature: string | undefined,
    meta: RequestMeta | null = null,
    now = new Date(),
  ) {
    const payloadHash = sha256(rawBody);
    const event = this.provider.parseWebhook(rawBody, signature);
    if (!event) {
      await this.core.audit.record({
        action: 'payment.webhook_rejected',
        entityType: 'PaymentEvent',
        entityId: payloadHash.slice(0, 32),
        reason: 'INVALID_SIGNATURE_OR_BODY',
        actorRole: 'PROVIDER',
        meta,
      });
      throw AppError.authInvalid('Invalid webhook signature');
    }
    const kind = event.kind ?? 'PAYMENT';
    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : null;
    const incoming: IncomingPaymentEvent = {
      eventId: event.eventId,
      kind,
      payloadHash,
      occurredAt,
    };

    const dup = await this.prisma.paymentEvent.findUnique({
      where: { providerEventId: event.eventId },
    });
    if (dup) {
      await this.core.audit.record({
        action: 'payment.webhook_duplicate',
        entityType: 'PaymentEvent',
        entityId: dup.id,
        actorRole: 'PROVIDER',
        meta,
      });
      return { outcome: 'DUPLICATE' as PaymentEventOutcome };
    }

    // replay protection: a validly signed but stale event is recorded and refused
    const tolerance = await this.core.webhookToleranceSeconds();
    if (occurredAt && Math.abs(now.getTime() - occurredAt.getTime()) > tolerance * 1000) {
      const payment = await this.prisma.payment.findUnique({
        where: { providerReference: event.providerReference },
        select: { id: true },
      });
      await this.storeEvent(
        this.prisma,
        incoming,
        payment?.id ?? null,
        String(event.status),
        'REJECTED',
        'STALE_EVENT',
        true,
      );
      throw new AppError('VALIDATION_FAILED', 'The webhook event is too old', 400);
    }

    try {
      // Reservation commitment payments (2026-10-15) share this provider webhook: their events are routed to the reservation engine
      // (after the same signature, freshness and duplicate checks); voucher events continue below unchanged.
      if (this.reservationPayments && (await this.reservationPayments.owns(event)))
        return { outcome: await this.reservationPayments.handleEvent(event, incoming) };
      if (event.kind === 'REFUND') {
        const r = await this.refunds.applyProviderRefund(
          event,
          incoming,
          (tx, paymentId, status, outcome, note) =>
            this.storeEvent(tx, incoming, paymentId, status, outcome, note, true),
        );
        return { outcome: r };
      }
      const r = await this.applyOutcome({
        providerReference: event.providerReference,
        status: event.status,
        failureCode: event.failureCode,
        methodType: event.methodType,
        source: 'WEBHOOK',
        event: incoming,
      });
      return { outcome: r.outcome };
    } catch (e) {
      // two identical callbacks raced: the loser sees the unique event id and is a duplicate
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        return { outcome: 'DUPLICATE' as PaymentEventOutcome };
      throw e;
    }
  }

  private storeEvent(
    db: Prisma.TransactionClient | Prisma.TransactionClient,
    e: IncomingPaymentEvent,
    paymentId: string | null,
    status: string,
    outcome: PaymentEventOutcome,
    note: string | null,
    verified: boolean,
  ) {
    return db.paymentEvent.create({
      data: {
        paymentId,
        providerEventId: e.eventId,
        kind: e.kind,
        status,
        payloadHash: e.payloadHash,
        signatureVerified: verified,
        outcome,
        note,
        occurredAt: e.occurredAt,
      },
    });
  }

  // ================================================================ the state machine ---------------------------------------
  async applyOutcome(input: {
    providerReference: string;
    status: PaymentStatus;
    failureCode?: string;
    methodType?: string;
    source: 'WEBHOOK' | 'RECONCILE' | 'SYNC';
    event?: IncomingPaymentEvent;
    now?: Date;
  }): Promise<{ outcome: PaymentEventOutcome; note: string | null }> {
    const now = input.now ?? new Date();
    const found = await this.prisma.payment.findUnique({
      where: { providerReference: input.providerReference },
      select: { id: true, orderId: true },
    });
    if (!found) {
      if (input.event)
        await this.storeEvent(
          this.prisma,
          input.event,
          null,
          input.status,
          'IGNORED',
          'UNKNOWN_PAYMENT',
          true,
        );
      return { outcome: 'IGNORED', note: 'UNKNOWN_PAYMENT' };
    }
    const post: PostCommit[] = [];
    const sent: Array<NotificationInput & { id: string }> = [];
    const result = await this.prisma.$transaction(async (tx) => {
      // serialise concurrent callbacks for the same payment and order
      await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${found.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "VoucherOrder" WHERE "id" = ${found.orderId}::uuid FOR UPDATE`;
      const pay = await tx.payment.findUniqueOrThrow({ where: { id: found.id } });
      const order = await tx.voucherOrder.findUniqueOrThrow({
        where: { id: found.orderId },
        include: { voucher: { include: { organization: { include: { merchant: true } } } } },
      });
      let outcome: PaymentEventOutcome = 'APPLIED';
      let note: string | null = null;
      const target = input.status;

      if (target === 'PENDING') {
        if (pay.status === 'CREATED')
          await tx.payment.update({ where: { id: pay.id }, data: { status: 'PENDING' } });
        else outcome = 'IGNORED';
      } else if (target === 'SUCCEEDED') {
        if (SETTLED.includes(pay.status)) {
          outcome = 'DUPLICATE';
        } else {
          const late = pay.status === 'FAILED' || pay.status === 'CANCELLED';
          if (!canTransitionPayment(pay.status, 'SUCCEEDED'))
            throw new AppError('INVALID_STATE', `Payment ${pay.status} cannot succeed`, 409);
          await tx.payment.update({
            where: { id: pay.id },
            data: {
              status: 'SUCCEEDED',
              completedAt: now,
              failureCode: null,
              ...(input.methodType ? { methodType: input.methodType } : {}),
            },
          });
          await this.postSale(tx, order, pay.id, now);
          const paid = await tx.voucherOrder.updateMany({
            where: { id: order.id, status: 'PENDING_PAYMENT' },
            data: { status: 'PAID', paidAt: now },
          });
          if (paid.count === 1) {
            await this.issue(tx, order, pay.id, now, sent, post);
            if (late) {
              outcome = 'LATE_SUCCESS';
              note = `Payment was ${pay.status} when the provider confirmed it; the order was still open, so it was applied`;
            }
          } else {
            // money arrived but the order is closed (cancelled, expired, failed, or paid by another attempt): refund it
            outcome = 'LATE_SUCCESS';
            note = `Order was ${order.status}; refunded automatically`;
            const refund = await this.refunds.createSystemRefund(tx, {
              order,
              paymentId: pay.id,
              amountHalalas: pay.amountHalalas,
              note,
            });
            post.push(() => this.refunds.execute(refund.id));
          }
          // other open attempts of the same order are no longer needed
          const others = await tx.payment.findMany({
            where: {
              orderId: order.id,
              id: { not: pay.id },
              status: { in: ['CREATED', 'PENDING'] },
            },
          });
          for (const o of others) {
            await tx.payment.update({
              where: { id: o.id },
              data: { status: 'CANCELLED', completedAt: now },
            });
            if (o.providerReference) {
              const ref = o.providerReference;
              post.push(async () => {
                await this.provider.cancel(ref).catch(() => undefined);
              });
            }
          }
          await this.core.audit.record(
            {
              action: 'payment.succeeded',
              entityType: 'Payment',
              entityId: pay.id,
              actorRole: input.source === 'WEBHOOK' ? 'PROVIDER' : 'SYSTEM',
              subjectOrganizationId: order.organizationId,
              previousState: { status: pay.status },
              newState: { status: 'SUCCEEDED', source: input.source, orderStatus: order.status },
            },
            tx,
          );
          const ev = await this.events.record(
            tx,
            'PAYMENT_SUCCEEDED',
            { voucherId: order.voucherId, organizationId: order.organizationId },
            order.userId,
            'voucher.payment_succeeded',
            { orderId: order.id },
          );
          post.push(ev);
        }
      } else if (target === 'FAILED' || target === 'CANCELLED') {
        if (pay.status === 'CREATED' || pay.status === 'PENDING') {
          await tx.payment.update({
            where: { id: pay.id },
            data: {
              status: target,
              completedAt: now,
              failureCode: input.failureCode ?? (target === 'FAILED' ? 'DECLINED' : 'CANCELLED'),
            },
          });
          if (target === 'FAILED') {
            const ev = await this.events.record(
              tx,
              'PAYMENT_FAILED',
              { voucherId: order.voucherId, organizationId: order.organizationId },
              order.userId,
              'voucher.payment_failed',
              { orderId: order.id },
            );
            post.push(ev);
            sent.push(
              ...(await this.notifications.emit(tx, [
                {
                  userId: order.userId,
                  type: 'PAYMENT_FAILED',
                  dedupeKey: `payment:${pay.id}:failed`,
                  data: this.notifData(order, { orderId: order.id }),
                },
              ])),
            );
          }
          // the order stays open for another try until the hold ends or the retry limit is reached
          const attempts = await tx.payment.count({ where: { orderId: order.id } });
          const open = await tx.payment.count({
            where: {
              orderId: order.id,
              id: { not: pay.id },
              status: { in: ['CREATED', 'PENDING'] },
            },
          });
          if (
            order.status === 'PENDING_PAYMENT' &&
            open === 0 &&
            attempts >= (await this.core.paymentRetryLimit())
          )
            await this.releaseOrder(tx, order, 'FAILED', now);
          await this.core.audit.record(
            {
              action: `payment.${target.toLowerCase()}`,
              entityType: 'Payment',
              entityId: pay.id,
              actorRole: input.source === 'WEBHOOK' ? 'PROVIDER' : 'SYSTEM',
              subjectOrganizationId: order.organizationId,
              previousState: { status: pay.status },
              newState: { status: target, source: input.source },
            },
            tx,
          );
        } else {
          // success (or a refund state) already recorded: a later failure message is out of order and ignored
          outcome = 'IGNORED';
          note = `Payment already ${pay.status}`;
        }
      }
      if (input.event) await this.storeEvent(tx, input.event, pay.id, target, outcome, note, true);
      return { outcome, note };
    });
    await this.notifications.dispatch(sent);
    for (const fn of post)
      await Promise.resolve(fn()).catch((e: Error) => this.logger.warn(e.message));
    return result;
  }

  private notifData(
    order: {
      voucher: { organization: Parameters<typeof merchantDisplayName>[0]; content: unknown };
    },
    extra: Record<string, unknown> = {},
  ) {
    const c = parseVoucherContent(order.voucher.content);
    const m = merchantDisplayName(order.voucher.organization);
    return {
      voucherTitleEn: c.title.en,
      voucherTitleAr: c.title.ar,
      merchantNameEn: m.en,
      merchantNameAr: m.ar,
      ...extra,
    };
  }

  /** Customer money received: PSP clearing up, merchant amount held (not yet settlement-eligible: VC-40, LG-02). */
  private async postSale(
    tx: Prisma.TransactionClient,
    order: { id: string; organizationId: string; voucherId: string },
    paymentId: string,
    now: Date,
  ) {
    const pay = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const j = await this.ledger.post(tx, {
      type: 'SALE',
      sourceType: 'Payment',
      sourceId: paymentId,
      idempotencyKey: `sale:${paymentId}`,
      currency: pay.currency,
      memo: `Voucher sale, order ${order.id}`,
      lines: [
        {
          family: 'PSP_CLEARING',
          amountHalalas: pay.amountHalalas,
          memo: pay.providerReference ?? undefined,
        },
        {
          family: 'MERCHANT_HELD',
          organizationId: order.organizationId,
          amountHalalas: -pay.amountHalalas,
        },
      ],
    });
    if (j.created)
      await tx.merchantPayableEvent.create({
        data: {
          organizationId: order.organizationId,
          voucherId: order.voucherId,
          type: 'SOLD',
          amountHalalas: pay.amountHalalas,
          currency: pay.currency,
          journalId: j.journalId,
          note: `payment ${paymentId}`,
          createdAt: now,
        },
      });
  }

  /** Creates the customer's voucher(s). Only ever reached from a confirmed payment, inside the same transaction. */
  private async issue(
    tx: Prisma.TransactionClient,
    order: Prisma.VoucherOrderGetPayload<{
      include: { voucher: { include: { organization: { include: { merchant: true } } } } };
    }>,
    paymentId: string,
    now: Date,
    sent: Array<NotificationInput & { id: string }>,
    post: PostCommit[],
  ) {
    const v = order.voucher;
    const moved = await tx.$executeRaw`UPDATE "Voucher"
         SET "heldQty" = "heldQty" - ${order.quantity}, "soldQty" = "soldQty" + ${order.quantity}, "updatedAt" = now()
       WHERE "id" = ${v.id}::uuid AND "heldQty" >= ${order.quantity}`;
    if (moved !== 1) throw new AppError('INVALID_STATE', 'Voucher stock could not be updated', 409);
    // validity ends at the end of a local day in the voucher's market time zone
    const tz = (await this.core.markets.profileOfCampaign(v.organizationId, v.content, tx))
      .timezone;
    const expiresAt = instanceExpiry(v, now, tz);
    const instances: Array<{ id: string; reference: string }> = [];
    for (let seq = 1; seq <= order.quantity; seq++) {
      const instance = await tx.voucherInstance.create({
        data: {
          campaignVersion: await this.core.versions.current(tx, 'VOUCHER', v.id),
          reference: newRef('VC'),
          voucherId: v.id,
          orderId: order.id,
          seq,
          organizationId: order.organizationId,
          ownerUserId: order.userId,
          purchasePriceHalalas: order.unitPriceHalalas,
          faceValueHalalas: order.faceValueHalalas,
          expiresAt,
          qrToken: newQrToken(),
          manualCode: await this.freeManualCode(tx),
          issuedAt: now,
        },
      });
      instances.push(instance);
      await tx.merchantPayableEvent.create({
        data: {
          organizationId: order.organizationId,
          voucherId: v.id,
          instanceId: instance.id,
          type: 'ISSUED',
          amountHalalas: order.unitPriceHalalas,
          currency: order.currency,
          note: `order ${order.reference}`,
          createdAt: now,
        },
      });
      await this.core.audit.record(
        {
          action: 'voucher_instance.issue',
          entityType: 'VoucherInstance',
          entityId: instance.id,
          actorRole: 'SYSTEM',
          subjectOrganizationId: order.organizationId,
          newState: { orderId: order.id, paymentId, reference: instance.reference },
        },
        tx,
      );
      const ev = await this.events.record(
        tx,
        'VOUCHER_ISSUED',
        { voucherId: v.id, organizationId: order.organizationId },
        order.userId,
        'voucher.issued',
        { instanceId: instance.id },
      );
      post.push(ev);
    }
    await this.loyalty?.issueForEvent(tx, {
      eventType: 'VOUCHER_PURCHASE',
      userId: order.userId,
      product: 'VOUCHER',
      campaignId: v.id,
      organizationId: order.organizationId,
      sourceType: 'EVENT',
      sourceId: order.id,
      amountHalalas: order.totalHalalas,
      now,
    });
    await this.loyalty?.recordOwnership(tx, order.userId, 'VOUCHER', v.id);
    post.push(() =>
      this.events.track('voucher.purchased', order.userId, order.organizationId, {
        voucherId: v.id,
        orderId: order.id,
        amountHalalas: order.totalHalalas,
      }),
    );
    const data = this.notifData(order, {
      orderId: order.id,
      instanceId: instances[0]?.id ?? null,
      amountHalalas: order.totalHalalas,
    });
    sent.push(
      ...(await this.notifications.emit(tx, [
        {
          userId: order.userId,
          type: 'PURCHASE_SUCCEEDED',
          dedupeKey: `order:${order.id}:paid`,
          data,
        },
        {
          userId: order.userId,
          type: 'VOUCHER_ISSUED',
          dedupeKey: `order:${order.id}:issued`,
          data,
        },
      ])),
    );
    await this.syncSoldOut(tx, v.id);
  }

  /** A manual code that exists in neither the reservation nor the voucher table (they share one typed-code space). */
  private async freeManualCode(tx: Prisma.TransactionClient): Promise<string> {
    for (let i = 0; i < 8; i++) {
      const code = newManualCode();
      const [a, b] = await Promise.all([
        tx.voucherInstance.count({ where: { manualCode: code } }),
        tx.reservation.count({ where: { manualCode: code } }),
      ]);
      if (a + b === 0) return code;
    }
    throw new AppError('INTERNAL', 'Could not allocate a code', 500);
  }

  // ================================================================ sweeps (called by the lifecycle job) --------------------
  /** Unpaid orders whose hold ran out: settled if the provider says paid, otherwise cancelled and the units returned. */
  async expireStaleOrders(now = new Date()) {
    const rows = await this.prisma.voucherOrder.findMany({
      where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    for (const r of rows)
      await this.settleOrDrop(r.id, now).catch((e: Error) => this.logger.warn(e.message));
    return rows.length;
  }

  /** Attempts created but never handed to the provider (a crash between the two steps) are closed. */
  async failStaleCreated(now = new Date()) {
    const cutoff = new Date(now.getTime() - 5 * 60_000);
    const res = await this.prisma.payment.updateMany({
      where: { status: 'CREATED', createdAt: { lt: cutoff } },
      data: { status: 'FAILED', failureCode: 'INITIATION_TIMEOUT', completedAt: now },
    });
    return res.count;
  }

  /** Pending attempts whose callback never arrived: ask the provider (reconciliation, PY-12). */
  async reconcilePending(now = new Date(), olderThanMs = 2 * 60_000) {
    const rows = await this.prisma.payment.findMany({
      where: {
        status: 'PENDING',
        providerReference: { not: null },
        updatedAt: { lt: new Date(now.getTime() - olderThanMs) },
      },
      take: 50,
    });
    let applied = 0;
    for (const p of rows) {
      const status = await this.provider
        .getStatus(p.providerReference!)
        .catch(() => 'PENDING' as const);
      if (status === 'PENDING') continue;
      await this.applyOutcome({
        providerReference: p.providerReference!,
        status,
        source: 'RECONCILE',
        now,
      });
      applied++;
    }
    return applied;
  }
}

export type { PaymentWebhookEvent };
