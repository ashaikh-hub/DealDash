import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AlertsService } from '../visibility/alerts.service';
import { isAllowedBrowserOrigin, type ApiEnv } from '@dealdash/config';
import {
  canTransitionPayment,
  type PaymentEventOutcome,
  type PaymentStatus,
} from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { APP_ENV } from '../common/env';
import type { Actor, RequestMeta } from '../common/request-context';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYMENT_PROVIDER,
  supportsCardHolds,
  type CardHoldProvider,
  type CardHoldStatus,
  type PaymentProvider,
  type PaymentWebhookEvent,
} from '../providers/interfaces';
import { LedgerService } from '../vouchers/ledger.service';
import { parseHotContent } from './hot-content';
import { NotificationsService, type NotificationInput } from './notifications.service';
import {
  commissionOn,
  holdCaptureOnEnd,
  refundReasonOf,
  splitOnEnd,
  type EndSituation,
  type PaidCommitment,
} from './reservation-money';

type Tx = Prisma.TransactionClient;
type Sent = Array<NotificationInput & { id: string }>;
export type PostCommit = () => Promise<unknown> | unknown;

/** Payment attempts per reservation inside its payment window (a double tap never charges twice: one open attempt at a time). */
export const MAX_PAYMENT_ATTEMPTS = 3;

const MONEY_INCLUDE = {
  deal: { include: { organization: { include: { merchant: true } } } },
  branch: true,
} satisfies Prisma.ReservationInclude;
type MoneyRow = Prisma.ReservationGetPayload<{ include: typeof MONEY_INCLUDE }>;

export interface IncomingEvent {
  eventId: string;
  kind: 'PAYMENT' | 'REFUND' | 'AUTHORISATION';
  payloadHash: string;
  occurredAt: Date | null;
}

/** The reservation policy in force when the reservation was made (RC-12 snapshot): the card-hold rules that apply to it. */
export function policyOf(r: { termsSnapshot: Prisma.JsonValue | null }): {
  preauthImmediateCapture: boolean;
  preauthOnRedemption: 'RELEASE' | 'CAPTURE';
  captureFailureAlertThreshold: number;
} {
  const f =
    (r.termsSnapshot as { policy?: { fields?: Record<string, unknown> } } | null)?.policy?.fields ??
    {};
  const threshold = Number(f.captureFailureAlertThreshold);
  return {
    preauthImmediateCapture: f.preauthImmediateCapture === true,
    preauthOnRedemption: f.preauthOnRedemption === 'CAPTURE' ? 'CAPTURE' : 'RELEASE',
    captureFailureAlertThreshold: Number.isInteger(threshold) && threshold > 0 ? threshold : 3,
  };
}

/** Customer / finance facing refund reference: random, never sequential. */
const ref = (prefix: string) => `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;

/**
 * Reservation commitment money, build phase 2 (founder decision 2026-10-15, RC-30..RC-82): full prepayment and deposit through the
 * payment provider (the mock adapter until a real one is chosen), refunds, forfeits and the ledger.
 *
 * Ledger (every journal balanced, append-only, one idempotency key per business event; LG rules):
 *  - payment received        PSP_CLEARING +A            MERCHANT_HELD(merchant) -A
 *  - amount kept (redeemed,  MERCHANT_HELD +K           PLATFORM_REVENUE -fee      MERCHANT_SETTLEMENT_ELIGIBLE -(K - fee)
 *    forfeited, kept part)
 *  - refund confirmed        MERCHANT_HELD +R           PSP_CLEARING -R
 * A reservation's paid amount A always ends as K + R. The fee is only DealDash's agreed commission on K (policy, default 0).
 *
 * Safety: one open attempt per reservation (partial unique index); provider callbacks are idempotent (unique event id, row locks,
 * state checks); money that arrives after the reservation ended is refunded automatically; a refund is sent once per idempotency key
 * and a failed refund stays visible for DealDash to retry.
 */
@Injectable()
export class ReservationPaymentsService {
  private readonly logger = new Logger('ReservationPayments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
    private readonly moduleRef: ModuleRef,
  ) {}

  // ================================================================ notices
  private notice(
    type: NotificationInput['type'],
    r: MoneyRow,
    key: string,
    extra: Record<string, unknown> = {},
  ): NotificationInput {
    const c = parseHotContent(r.deal.content);
    const m = merchantDisplayName(r.deal.organization);
    return {
      userId: r.userId,
      type,
      dedupeKey: `reservation:${r.id}:${key}`,
      data: {
        reservationId: r.id,
        dealId: r.dealId,
        dealTitleEn: c.title.en,
        dealTitleAr: c.title.ar,
        merchantNameEn: m.en,
        merchantNameAr: m.ar,
        branchNameEn: r.branch.nameEn,
        branchNameAr: r.branch.nameAr,
        currency: r.currency,
        ...extra,
      },
    };
  }

  private async event(
    tx: Tx,
    reservationId: string,
    type:
      | 'PAYMENT_PENDING'
      | 'PAYMENT_SUCCEEDED'
      | 'PAYMENT_FAILED'
      | 'REFUND_REQUESTED'
      | 'REFUNDED'
      | 'REFUND_FAILED'
      | 'FORFEITED'
      | 'SETTLED_TO_MERCHANT'
      | 'AUTHORISATION_REQUESTED'
      | 'AUTHORISED'
      | 'AUTHORISATION_FAILED'
      | 'AUTHORISATION_EXPIRED'
      | 'HOLD_RELEASED'
      | 'HOLD_CAPTURED',
    note: string | null,
    actor: { userId: string | null; role: string } | null = null,
    status?: {
      from: Prisma.ReservationEventCreateInput['fromStatus'];
      to: Prisma.ReservationEventCreateInput['toStatus'];
    },
  ) {
    await tx.reservationEvent.create({
      data: {
        reservationId,
        type,
        note,
        actorUserId: actor?.userId ?? null,
        actorRole: actor?.role ?? 'SYSTEM',
        fromStatus: status?.from ?? null,
        toStatus: status?.to ?? null,
      },
    });
  }

  /**
   * Where the provider's page returns to: the app's own address when it is one of DealDash's app origins (a phone on the local
   * network in development is one too), never an arbitrary site (no open redirect); otherwise the reservation page.
   */
  private returnUrl(reservationId: string, candidate?: string) {
    if (candidate) {
      try {
        if (isAllowedBrowserOrigin(this.env, new URL(candidate).origin)) return candidate;
      } catch {
        /* not a URL: the default below */
      }
    }
    return `${this.env.CORS_ORIGINS[0] ?? 'http://localhost:3001'}/en/reservations/${reservationId}`;
  }

  // ================================================================ payment attempts
  /**
   * Opens a payment attempt inside the caller's transaction (the reservation was just made, or the customer retries). The provider
   * is called AFTER the transaction commits (`initiate`), never while rows are locked.
   */
  async openAttempt(
    tx: Tx,
    r: {
      id: string;
      reference: string;
      organizationId: string;
      amountMinor: number | null;
      quantity: number;
      currency: string | null;
    },
    actor: Actor | null,
    meta: RequestMeta | null,
  ): Promise<string> {
    if (!r.amountMinor || !r.currency)
      throw new AppError('INVALID_STATE', 'This reservation has no amount to pay', 409);
    const attempts = await tx.reservationPayment.count({ where: { reservationId: r.id } });
    if (attempts >= MAX_PAYMENT_ATTEMPTS)
      throw new AppError(
        'PAYMENT_RETRY_LIMIT',
        'Too many payment attempts for this reservation',
        409,
      );
    const attemptNo = attempts + 1;
    const p = await tx.reservationPayment.create({
      data: {
        reservationId: r.id,
        provider: this.provider.name,
        amountMinor: r.amountMinor * r.quantity,
        currency: r.currency,
        attemptNo,
        idempotencyKey: `rpay:${r.id}:${attemptNo}`,
      },
    });
    await this.event(
      tx,
      r.id,
      'PAYMENT_PENDING',
      `attempt ${attemptNo}`,
      actor ? { userId: actor.userId, role: 'CUSTOMER' } : null,
    );
    await this.audit.record(
      {
        action: 'reservation.payment_created',
        entityType: 'ReservationPayment',
        entityId: p.id,
        actor,
        actorRole: actor ? undefined : 'SYSTEM',
        subjectOrganizationId: r.organizationId,
        newState: {
          reservationId: r.id,
          attemptNo,
          amountMinor: p.amountMinor,
          currency: p.currency,
        },
        meta,
      },
      tx,
    );
    return p.id;
  }

  /** Sends an opened attempt to the provider (after commit). A provider error fails the attempt; the customer may retry. */
  async initiate(paymentId: string, returnTo?: string) {
    const p = await this.prisma.reservationPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { reservation: { select: { id: true, reference: true } } },
    });
    try {
      const res = await this.provider.initiate({
        orderId: p.reservation.reference,
        amountHalalas: p.amountMinor,
        currency: p.currency,
        idempotencyKey: p.idempotencyKey,
        returnUrl: this.returnUrl(p.reservationId, returnTo),
      });
      await this.prisma.reservationPayment.updateMany({
        where: { id: p.id, status: 'CREATED' },
        data: {
          providerReference: res.providerReference,
          redirectUrl: res.redirectUrl ?? null,
          status: 'PENDING',
        },
      });
      if (res.status !== 'PENDING')
        await this.applyPaymentOutcome({
          providerReference: res.providerReference,
          status: res.status,
          source: 'SYNC',
        });
    } catch (e) {
      this.logger.warn(
        `Provider initiation failed for reservation payment ${p.id}: ${(e as Error).message}`,
      );
      await this.prisma.reservationPayment.updateMany({
        where: { id: p.id, status: 'CREATED' },
        data: { status: 'FAILED', failureCode: 'PROVIDER_ERROR', completedAt: new Date() },
      });
    }
  }

  /** Customer retry inside the payment window (RC-31): a new attempt when the previous one did not go through. */
  async retry(
    actor: Actor,
    reservationId: string,
    meta: RequestMeta,
    now = new Date(),
    returnTo?: string,
  ) {
    const r = await this.prisma.reservation.findFirst({
      where: { id: reservationId, userId: actor.userId },
    });
    if (!r) throw AppError.notFound();
    if (
      r.status !== 'PENDING_PAYMENT' ||
      !r.paymentDueAt ||
      r.paymentDueAt.getTime() <= now.getTime()
    )
      throw new AppError('ORDER_NOT_PAYABLE', 'This reservation can no longer be paid', 409);
    if (r.commitmentMethod === 'CARD_PREAUTH') {
      // phase 3: a new card hold request (the previous one was declined)
      const openHold = await this.prisma.reservationAuthorisation.findFirst({
        where: { reservationId, status: { in: ['REQUESTED', 'AUTHORISED'] } },
      });
      if (openHold) return;
      let authId: string;
      try {
        authId = await this.prisma.$transaction((tx) => this.openAuthorisation(tx, r, actor, meta));
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
        throw e;
      }
      await this.requestAuthorisation(authId, returnTo);
      return;
    }
    const open = await this.prisma.reservationPayment.findFirst({
      where: { reservationId, status: { in: ['CREATED', 'PENDING'] } },
    });
    if (open) return;
    let paymentId: string;
    try {
      paymentId = await this.prisma.$transaction((tx) => this.openAttempt(tx, r, actor, meta));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return; // a concurrent tap opened it
      throw e;
    }
    await this.initiate(paymentId, returnTo);
  }

  // ================================================================ provider outcomes (webhook, reconciliation, sync)
  /** Does this provider event belong to a reservation payment or refund? (The shared webhook routes on this.) */
  async owns(event: PaymentWebhookEvent): Promise<boolean> {
    if (event.kind === 'AUTHORISATION') {
      const a = await this.prisma.reservationAuthorisation.findUnique({
        where: { providerReference: event.providerReference },
        select: { id: true },
      });
      return !!a;
    }
    if (event.kind === 'REFUND') {
      const r = await this.prisma.reservationRefund.findUnique({
        where: { providerRefundReference: event.refundReference },
        select: { id: true },
      });
      if (r) return true;
    }
    const p = await this.prisma.reservationPayment.findUnique({
      where: { providerReference: event.providerReference },
      select: { id: true },
    });
    return !!p;
  }

  private storeEvent(
    db: Tx | PrismaService,
    e: IncomingEvent,
    reservationPaymentId: string | null,
    status: string,
    outcome: PaymentEventOutcome,
    note: string | null,
  ) {
    return db.paymentEvent.create({
      data: {
        reservationPaymentId,
        providerEventId: e.eventId,
        kind: e.kind,
        status,
        payloadHash: e.payloadHash,
        signatureVerified: true,
        outcome,
        note,
        occurredAt: e.occurredAt,
      },
    });
  }

  /** Entry point from the shared provider webhook (signature, freshness and duplicate event id already checked there). */
  async handleEvent(
    event: PaymentWebhookEvent,
    incoming: IncomingEvent,
  ): Promise<PaymentEventOutcome> {
    if (event.kind === 'REFUND') return this.applyRefundEvent(event, incoming);
    if (event.kind === 'AUTHORISATION')
      return (
        await this.applyHoldOutcome({
          providerReference: event.providerReference,
          status: event.status,
          capturedMinor: event.capturedMinor,
          captureReference: event.captureReference,
          failureCode: event.failureCode,
          source: 'WEBHOOK',
          event: incoming,
        })
      ).outcome;
    const r = await this.applyPaymentOutcome({
      providerReference: event.providerReference,
      status: event.status,
      failureCode: event.failureCode,
      methodType: event.methodType,
      source: 'WEBHOOK',
      event: incoming,
    });
    return r.outcome;
  }

  async applyPaymentOutcome(input: {
    providerReference: string;
    status: PaymentStatus | 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
    failureCode?: string;
    methodType?: string;
    source: 'WEBHOOK' | 'RECONCILE' | 'SYNC';
    event?: IncomingEvent;
    now?: Date;
  }): Promise<{ outcome: PaymentEventOutcome; note: string | null }> {
    const now = input.now ?? new Date();
    const found = await this.prisma.reservationPayment.findUnique({
      where: { providerReference: input.providerReference },
      select: { id: true, reservationId: true },
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
        );
      return { outcome: 'IGNORED', note: 'UNKNOWN_PAYMENT' };
    }
    const sent: Sent = [];
    const post: PostCommit[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      // serialise concurrent callbacks for the same attempt and reservation
      await tx.$queryRaw`SELECT "id" FROM "ReservationPayment" WHERE "id" = ${found.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${found.reservationId}::uuid FOR UPDATE`;
      const pay = await tx.reservationPayment.findUniqueOrThrow({ where: { id: found.id } });
      const r = await tx.reservation.findUniqueOrThrow({
        where: { id: found.reservationId },
        include: MONEY_INCLUDE,
      });
      const role = input.source === 'WEBHOOK' ? 'PROVIDER' : 'SYSTEM';
      let outcome: PaymentEventOutcome = 'APPLIED';
      let note: string | null = null;
      const target = input.status;

      if (target === 'PENDING') {
        if (pay.status === 'CREATED')
          await tx.reservationPayment.update({
            where: { id: pay.id },
            data: { status: 'PENDING' },
          });
        else outcome = 'IGNORED';
      } else if (target === 'SUCCEEDED') {
        if (pay.status === 'SUCCEEDED') outcome = 'DUPLICATE';
        else {
          if (!canTransitionPayment(pay.status, 'SUCCEEDED'))
            throw new AppError('INVALID_STATE', `Payment ${pay.status} cannot succeed`, 409);
          await tx.reservationPayment.update({
            where: { id: pay.id },
            data: {
              status: 'SUCCEEDED',
              completedAt: now,
              failureCode: null,
              ...(input.methodType ? { methodType: input.methodType } : {}),
            },
          });
          // the money is received whatever happens next: it is held for the merchant until kept or refunded
          await this.ledger.post(tx, {
            type: 'RESERVATION_PAYMENT',
            sourceType: 'ReservationPayment',
            sourceId: pay.id,
            idempotencyKey: `rpay-in:${pay.id}`,
            currency: pay.currency,
            memo: `Reservation ${r.reference} payment`,
            lines: [
              {
                family: 'PSP_CLEARING',
                amountHalalas: pay.amountMinor,
                memo: pay.providerReference ?? undefined,
              },
              {
                family: 'MERCHANT_HELD',
                organizationId: r.organizationId,
                amountHalalas: -pay.amountMinor,
              },
            ],
          });
          const confirmed =
            r.status === 'PENDING_PAYMENT'
              ? await tx.reservation.updateMany({
                  where: { id: r.id, status: 'PENDING_PAYMENT' },
                  data: this.confirmation(r, now),
                })
              : { count: 0 };
          await this.event(
            tx,
            r.id,
            'PAYMENT_SUCCEEDED',
            `attempt ${pay.attemptNo}${confirmed.count === 1 ? ': confirmed' : ': reservation already ended'}`,
            { userId: null, role },
            confirmed.count === 1 ? { from: 'PENDING_PAYMENT', to: 'HELD' } : undefined,
          );
          if (confirmed.count === 1) {
            const fresh = await tx.reservation.findUniqueOrThrow({
              where: { id: r.id },
              include: MONEY_INCLUDE,
            });
            // RC-32: payment success IS the confirmation (code issued, hold timer started, terms snapshot)
            sent.push(
              ...(await this.notifications.emit(tx, [
                this.notice('RESERVATION_CONFIRMED', fresh, 'confirmed', {
                  expiresAt: fresh.expiresAt.toISOString(),
                  paidMinor: pay.amountMinor,
                  method: fresh.commitmentMethod,
                }),
              ])),
            );
          } else {
            // money arrived but the reservation is no longer waiting (ended, released, or paid by another attempt): refund it all
            outcome = 'LATE_SUCCESS';
            note = `Reservation was ${r.status}; refunded automatically`;
            const refundId = await this.createRefund(
              tx,
              r,
              pay,
              pay.amountMinor,
              'LATE_PAYMENT',
              null,
            );
            post.push(() => this.executeRefund(refundId));
          }
          // other open attempts are no longer needed
          const others = await tx.reservationPayment.findMany({
            where: {
              reservationId: r.id,
              id: { not: pay.id },
              status: { in: ['CREATED', 'PENDING'] },
            },
          });
          for (const o of others) {
            await tx.reservationPayment.update({
              where: { id: o.id },
              data: { status: 'CANCELLED', completedAt: now },
            });
            if (o.providerReference) {
              const providerRef = o.providerReference;
              post.push(() => this.provider.cancel(providerRef).catch(() => undefined));
            }
          }
          await this.audit.record(
            {
              action: 'reservation.payment_succeeded',
              entityType: 'ReservationPayment',
              entityId: pay.id,
              actorRole: role,
              subjectOrganizationId: r.organizationId,
              previousState: { status: pay.status, reservationStatus: r.status },
              newState: { status: 'SUCCEEDED', source: input.source, outcome },
            },
            tx,
          );
        }
      } else if (target === 'FAILED' || target === 'CANCELLED') {
        if (pay.status === 'CREATED' || pay.status === 'PENDING') {
          await tx.reservationPayment.update({
            where: { id: pay.id },
            data: {
              status: target,
              completedAt: now,
              failureCode: input.failureCode ?? (target === 'FAILED' ? 'DECLINED' : 'CANCELLED'),
            },
          });
          await this.event(tx, r.id, 'PAYMENT_FAILED', input.failureCode ?? target, {
            userId: null,
            role,
          });
          if (target === 'FAILED')
            sent.push(
              ...(await this.notifications.emit(tx, [
                this.notice('RESERVATION_PAYMENT_FAILED', r, `payment:${pay.id}:failed`, {
                  canRetry: r.status === 'PENDING_PAYMENT' && pay.attemptNo < MAX_PAYMENT_ATTEMPTS,
                  dueAt: r.paymentDueAt?.toISOString() ?? null,
                }),
              ])),
            );
          await this.audit.record(
            {
              action: `reservation.payment_${target.toLowerCase()}`,
              entityType: 'ReservationPayment',
              entityId: pay.id,
              actorRole: role,
              subjectOrganizationId: r.organizationId,
              previousState: { status: pay.status },
              newState: { status: target, source: input.source },
            },
            tx,
          );
          // the reservation keeps its units for a retry until the payment window ends (released by the sweep)
        } else {
          outcome = 'IGNORED';
          note = `Payment already ${pay.status}`;
        }
      }
      if (input.event) await this.storeEvent(tx, input.event, pay.id, target, outcome, note);
      return { outcome, note };
    });
    await this.notifications.dispatch(sent);
    for (const fn of post)
      await Promise.resolve(fn()).catch((e: Error) => this.logger.warn(e.message));
    return result;
  }

  /** RC-32: the hold timer starts at confirmation; the cancellation cut-off is measured back from the end of the hold. */
  private confirmation(
    r: MoneyRow,
    now: Date,
    paymentStatus: 'PAID' | 'AUTHORISED' = 'PAID',
  ): Prisma.ReservationUpdateManyMutationInput {
    const expiresAt = new Date(now.getTime() + r.holdMinutes * 60_000);
    const terms = (r.termsSnapshot ?? {}) as { cancelCutoffMinutes?: number | null };
    const cutoffMin = terms.cancelCutoffMinutes ?? null;
    const cutoff =
      cutoffMin === null
        ? null
        : new Date(Math.max(now.getTime(), expiresAt.getTime() - cutoffMin * 60_000));
    return {
      status: 'HELD',
      paymentStatus,
      confirmedAt: now,
      expiresAt,
      cancelCutoffAt: cutoff,
      expiringNoticeSentAt: null,
    };
  }

  /** Reconciliation when the payment window ends: did the customer actually pay a moment ago? Then confirm instead of releasing. */
  async reconcileOpen(reservationId: string): Promise<'PAID' | 'UNPAID'> {
    // phase 3: a card hold the customer completed a moment before the window ended confirms the reservation
    const hold = await this.prisma.reservationAuthorisation.findFirst({
      where: { reservationId, status: 'REQUESTED' },
    });
    const holds = this.holdProvider();
    if (hold?.providerReference && holds) {
      const status = await holds
        .getHoldStatus(hold.providerReference)
        .catch(() => 'PENDING' as const);
      if (status === 'AUTHORISED') {
        await this.applyHoldOutcome({
          providerReference: hold.providerReference,
          status,
          source: 'RECONCILE',
        });
        const r = await this.prisma.reservation.findUnique({
          where: { id: reservationId },
          select: { status: true },
        });
        return r?.status === 'HELD' ? 'PAID' : 'UNPAID';
      }
    }
    const open = await this.prisma.reservationPayment.findFirst({
      where: { reservationId, status: { in: ['CREATED', 'PENDING'] } },
    });
    if (open?.providerReference) {
      const status = await this.provider
        .getStatus(open.providerReference)
        .catch(() => 'PENDING' as const);
      if (status === 'SUCCEEDED') {
        await this.applyPaymentOutcome({
          providerReference: open.providerReference,
          status,
          source: 'RECONCILE',
        });
        const r = await this.prisma.reservation.findUnique({
          where: { id: reservationId },
          select: { status: true },
        });
        return r?.status === 'HELD' ? 'PAID' : 'UNPAID';
      }
    }
    return 'UNPAID';
  }

  /**
   * The reservation ended without being paid (window elapsed, cancelled before paying): open attempts are cancelled (provider calls
   * after commit) and the money state is FAILED. Stock is released by the caller in the same transaction.
   */
  async markUnpaid(tx: Tx, reservationId: string, now: Date, post: PostCommit[]) {
    const open = await tx.reservationPayment.findMany({
      where: { reservationId, status: { in: ['CREATED', 'PENDING'] } },
    });
    for (const o of open) {
      await tx.reservationPayment.update({
        where: { id: o.id },
        data: { status: 'CANCELLED', completedAt: now },
      });
      if (o.providerReference) {
        const providerRef = o.providerReference;
        post.push(() => this.provider.cancel(providerRef).catch(() => undefined));
      }
    }
    // phase 3: an open card hold request is cancelled (and voided at the provider, in case it completes later)
    const openHolds = await tx.reservationAuthorisation.findMany({
      where: { reservationId, status: 'REQUESTED' },
    });
    for (const h of openHolds) {
      await tx.reservationAuthorisation.update({
        where: { id: h.id },
        data: { status: 'CANCELLED', releasedAt: now, releaseReason: 'NOT_COMPLETED' },
      });
      await this.event(tx, reservationId, 'AUTHORISATION_FAILED', 'hold request cancelled');
      const holds = this.holdProvider();
      if (h.providerReference && holds) {
        const providerRef = h.providerReference;
        post.push(() => holds.release(providerRef).catch(() => undefined));
      }
    }
    await tx.reservation.updateMany({
      where: { id: reservationId, paymentStatus: 'PENDING' },
      data: { paymentStatus: 'FAILED' },
    });
  }

  // ================================================================ end of a PAID reservation: keep and / or refund
  private paidCommitment(r: MoneyRow, paidMinor: number): PaidCommitment {
    return {
      method: r.commitmentMethod as PaidCommitment['method'],
      paidMinor,
      depositRefundable: r.depositRefundable,
      noShowRefundPercent: r.noShowRefundPercent,
    };
  }

  /**
   * RC-40..RC-51 and RC-61: settles the money of a reservation that just ended (in the caller's transaction). Posts the kept part to
   * the merchant net of DealDash's fee, creates the refund (sent to the provider after commit) and returns the customer notices.
   * Nothing happens for FREE reservations or ones that were never paid.
   */
  async settleOnEnd(
    tx: Tx,
    reservationId: string,
    situation: EndSituation,
    now: Date,
    post: PostCommit[],
    opts: { redemptionId?: string; actor?: Actor | null } = {},
  ): Promise<NotificationInput[]> {
    const r = await tx.reservation.findUniqueOrThrow({
      where: { id: reservationId },
      include: MONEY_INCLUDE,
    });
    // phase 3: an AUTHORISED card hold (not captured up front) is captured in part / in full or released
    if (r.commitmentMethod === 'CARD_PREAUTH' && r.paymentStatus === 'AUTHORISED')
      return this.settleHoldOnEnd(tx, r, situation, now, post, opts);
    if (r.commitmentMethod === 'FREE' || r.paymentStatus !== 'PAID') return [];
    const pay = await tx.reservationPayment.findFirst({
      where: { reservationId, status: 'SUCCEEDED' },
      orderBy: { completedAt: 'asc' },
    });
    if (!pay) return [];
    const split = splitOnEnd(this.paidCommitment(r, pay.amountMinor), situation);
    const notices: NotificationInput[] = [];
    const actor = opts.actor
      ? { userId: opts.actor.userId, role: opts.actor.membership?.roleCode ?? 'DEALDASH' }
      : null;

    if (split.keptMinor > 0) {
      const fee = commissionOn(split.keptMinor, r.commissionBps ?? 0);
      const key = opts.redemptionId
        ? `rsettle:${r.id}:redeem:${opts.redemptionId}`
        : `rsettle:${r.id}:end`;
      await this.ledger.post(tx, {
        type: 'RESERVATION_SETTLEMENT',
        sourceType: opts.redemptionId ? 'Redemption' : 'Reservation',
        sourceId: opts.redemptionId ?? r.id,
        idempotencyKey: key,
        currency: pay.currency,
        memo: `Reservation ${r.reference} ${situation === 'REDEEMED' ? 'redeemed' : 'amount kept'} (${situation})`,
        reasonCode: situation,
        actor,
        lines: [
          {
            family: 'MERCHANT_HELD',
            organizationId: r.organizationId,
            amountHalalas: split.keptMinor,
          },
          {
            family: 'PLATFORM_REVENUE',
            amountHalalas: -fee,
            memo: `commission ${r.commissionBps ?? 0} bps`,
          },
          {
            family: 'MERCHANT_SETTLEMENT_ELIGIBLE',
            organizationId: r.organizationId,
            amountHalalas: -(split.keptMinor - fee),
          },
        ],
      });
      await tx.reservation.update({
        where: { id: r.id },
        data: { keptMinor: split.keptMinor, feeMinor: fee, settledAt: now },
      });
      if (situation !== 'REDEEMED') {
        await this.event(tx, r.id, 'FORFEITED', `${split.keptMinor} kept (${situation})`, actor);
        notices.push(
          this.notice('RESERVATION_FORFEITED', r, `forfeited:${situation}`, {
            keptMinor: split.keptMinor,
            refundMinor: split.refundMinor,
            reason: situation,
          }),
        );
      }
      await this.event(
        tx,
        r.id,
        'SETTLED_TO_MERCHANT',
        `${split.keptMinor - fee} to the merchant, fee ${fee}`,
        actor,
      );
    }
    if (split.refundMinor > 0) {
      const refundId = await this.createRefund(
        tx,
        r,
        pay,
        split.refundMinor,
        situation,
        opts.actor ?? null,
      );
      post.push(() => this.executeRefund(refundId));
    }
    // money state: kept entirely = FORFEITED now; a refund changes it when the provider confirms; redeemed stays PAID
    if (situation !== 'REDEEMED' && split.refundMinor === 0)
      await tx.reservation.update({ where: { id: r.id }, data: { paymentStatus: 'FORFEITED' } });
    await this.audit.record(
      {
        action: 'reservation.money_settled',
        entityType: 'Reservation',
        entityId: r.id,
        actor: opts.actor ?? null,
        actorRole: opts.actor ? undefined : 'SYSTEM',
        subjectOrganizationId: r.organizationId,
        newState: {
          situation,
          paidMinor: pay.amountMinor,
          ...split,
          commissionBps: r.commissionBps ?? 0,
        },
      },
      tx,
    );
    return notices;
  }

  /** A reversed redemption (RD-40): the kept-for-merchant posting is reversed; the money is held again for the merchant. */
  async unsettleRedemption(tx: Tx, reservationId: string, redemptionId: string, actor: Actor) {
    const j = await tx.ledgerJournal.findUnique({
      where: { idempotencyKey: `rsettle:${reservationId}:redeem:${redemptionId}` },
      select: { id: true },
    });
    if (!j) return;
    await this.ledger.reverse(tx, j.id, {
      sourceType: 'Redemption',
      sourceId: redemptionId,
      idempotencyKey: `rsettle-rev:${reservationId}:redeem:${redemptionId}`,
      memo: 'Redemption reversed: amount held for the merchant again',
      actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
    });
    // the per-redemption drawdown (if any) is reversed by the commercial engine with the redemption; the record follows it
    await tx.reservation.update({
      where: { id: reservationId },
      data: { keptMinor: null, feeMinor: null, settledAt: null, redemptionFeeMinor: null },
    });
  }

  // ================================================================ refunds
  private async createRefund(
    tx: Tx,
    r: { id: string; organizationId: string },
    pay: { id: string; currency: string },
    amountMinor: number,
    situation: EndSituation,
    actor: Actor | null,
  ): Promise<string> {
    const reasonCode = refundReasonOf(situation);
    const refund = await tx.reservationRefund.create({
      data: {
        reference: ref('RRF'),
        reservationId: r.id,
        paymentId: pay.id,
        organizationId: r.organizationId,
        amountMinor,
        currency: pay.currency,
        status: 'PROCESSING',
        reasonCode,
        idempotencyKey: `rrefund:${r.id}:${pay.id}:${reasonCode}`,
      },
    });
    await this.event(
      tx,
      r.id,
      'REFUND_REQUESTED',
      `${amountMinor} (${reasonCode})`,
      actor ? { userId: actor.userId, role: actor.membership?.roleCode ?? 'DEALDASH' } : null,
    );
    await this.audit.record(
      {
        action: 'reservation.refund_requested',
        entityType: 'ReservationRefund',
        entityId: refund.id,
        actor,
        actorRole: actor ? undefined : 'SYSTEM',
        subjectOrganizationId: r.organizationId,
        newState: { amountMinor, currency: pay.currency, reasonCode },
      },
      tx,
    );
    return refund.id;
  }

  /** Sends a refund to the provider (idempotent per refund key). SUCCEEDED completes it; PENDING waits for the webhook. */
  async executeRefund(refundId: string) {
    const rf = await this.prisma.reservationRefund.findUnique({
      where: { id: refundId },
      include: { payment: true },
    });
    if (!rf || rf.status !== 'PROCESSING') return;
    const attempt = rf.attempts + 1;
    await this.prisma.reservationRefund.update({
      where: { id: rf.id },
      data: { attempts: attempt },
    });
    let res: { refundReference: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' };
    try {
      if (!rf.payment.providerReference) throw new Error('payment has no provider reference');
      res = await this.provider.refund({
        providerReference: rf.payment.providerReference,
        amountHalalas: rf.amountMinor,
        // the first send uses the refund's key; a retry follows a REFUSED attempt (no money moved), so it is a new request
        idempotencyKey: attempt === 1 ? rf.idempotencyKey : `${rf.idempotencyKey}:retry${attempt}`,
      });
    } catch (e) {
      this.logger.warn(`Refund ${rf.reference} could not be sent: ${(e as Error).message}`);
      res = { refundReference: '', status: 'FAILED' };
    }
    if (res.status === 'SUCCEEDED') await this.completeRefund(rf.id, res.refundReference, 'SYNC');
    else if (res.status === 'PENDING')
      await this.prisma.reservationRefund.update({
        where: { id: rf.id },
        data: { providerRefundReference: res.refundReference },
      });
    else await this.failRefund(rf.id, res.refundReference || null, 'PROVIDER_REFUSED', 'SYNC');
  }

  private async completeRefund(
    refundId: string,
    providerRefundReference: string | null,
    source: string,
  ) {
    const sent: Sent = [];
    const done = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.reservationRefund.updateMany({
        where: { id: refundId, status: 'PROCESSING' },
        data: {
          status: 'REFUNDED',
          refundedAt: new Date(),
          failureCode: null,
          ...(providerRefundReference ? { providerRefundReference } : {}),
        },
      });
      if (claimed.count !== 1) return false;
      const rf = await tx.reservationRefund.findUniqueOrThrow({
        where: { id: refundId },
        include: { payment: true },
      });
      await this.ledger.post(tx, {
        type: 'RESERVATION_REFUND',
        sourceType: 'ReservationRefund',
        sourceId: rf.id,
        idempotencyKey: `rrefund-out:${rf.id}`,
        currency: rf.currency,
        memo: `Reservation refund ${rf.reference} (${rf.reasonCode})`,
        reasonCode: rf.reasonCode,
        lines: [
          {
            family: 'MERCHANT_HELD',
            organizationId: rf.organizationId,
            amountHalalas: rf.amountMinor,
          },
          {
            family: 'PSP_CLEARING',
            amountHalalas: -rf.amountMinor,
            memo: rf.providerRefundReference ?? undefined,
          },
        ],
      });
      const refunded = await tx.reservationRefund.aggregate({
        where: { reservationId: rf.reservationId, status: 'REFUNDED' },
        _sum: { amountMinor: true },
      });
      const total = (refunded._sum.amountMinor ?? 0) >= rf.payment.amountMinor;
      const r = await tx.reservation.findUniqueOrThrow({
        where: { id: rf.reservationId },
        include: MONEY_INCLUDE,
      });
      // a late payment's refund never changes the money state of the reservation it did not pay for
      if (rf.reasonCode !== 'LATE_PAYMENT' || r.paymentStatus === 'PAID')
        await tx.reservation.update({
          where: { id: r.id },
          data: { paymentStatus: total ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
        });
      await this.event(tx, r.id, 'REFUNDED', `${rf.amountMinor} (${rf.reasonCode})`, {
        userId: null,
        role: source === 'WEBHOOK' ? 'PROVIDER' : 'SYSTEM',
      });
      await this.audit.record(
        {
          action: 'reservation.refund_completed',
          entityType: 'ReservationRefund',
          entityId: rf.id,
          actorRole: 'SYSTEM',
          subjectOrganizationId: rf.organizationId,
          newState: { amountMinor: rf.amountMinor, source },
        },
        tx,
      );
      sent.push(
        ...(await this.notifications.emit(tx, [
          this.notice('RESERVATION_REFUND_UPDATED', r, `refund:${rf.id}:done`, {
            refundId: rf.id,
            refundMinor: rf.amountMinor,
            status: 'REFUNDED',
          }),
        ])),
      );
      return true;
    });
    await this.notifications.dispatch(sent);
    return done;
  }

  private async failRefund(
    refundId: string,
    providerRefundReference: string | null,
    code: string,
    source: string,
  ) {
    const sent: Sent = [];
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.reservationRefund.updateMany({
        where: { id: refundId, status: 'PROCESSING' },
        data: {
          status: 'FAILED',
          failureCode: code,
          ...(providerRefundReference ? { providerRefundReference } : {}),
        },
      });
      if (claimed.count !== 1) return;
      const rf = await tx.reservationRefund.findUniqueOrThrow({ where: { id: refundId } });
      const r = await tx.reservation.findUniqueOrThrow({
        where: { id: rf.reservationId },
        include: MONEY_INCLUDE,
      });
      await this.event(tx, r.id, 'REFUND_FAILED', `${rf.reference}: ${code}`, {
        userId: null,
        role: source === 'WEBHOOK' ? 'PROVIDER' : 'SYSTEM',
      });
      await this.audit.record(
        {
          action: 'reservation.refund_failed',
          entityType: 'ReservationRefund',
          entityId: rf.id,
          actorRole: 'SYSTEM',
          subjectOrganizationId: rf.organizationId,
          newState: { failureCode: code, source },
        },
        tx,
      );
      // the customer is told we are on it; DealDash finance sees it in the failed-refund queue and retries
      sent.push(
        ...(await this.notifications.emit(tx, [
          this.notice('RESERVATION_REFUND_UPDATED', r, `refund:${rf.id}:failed:${rf.attempts}`, {
            refundId: rf.id,
            refundMinor: rf.amountMinor,
            status: 'DELAYED',
          }),
        ])),
      );
    });
    await this.notifications.dispatch(sent);
  }

  private async applyRefundEvent(
    event: Extract<PaymentWebhookEvent, { kind: 'REFUND' }>,
    incoming: IncomingEvent,
  ): Promise<PaymentEventOutcome> {
    const rf = await this.prisma.reservationRefund.findUnique({
      where: { providerRefundReference: event.refundReference },
    });
    if (!rf) {
      await this.storeEvent(this.prisma, incoming, null, event.status, 'IGNORED', 'UNKNOWN_REFUND');
      return 'IGNORED';
    }
    let outcome: PaymentEventOutcome = 'APPLIED';
    if (rf.status !== 'PROCESSING') outcome = 'DUPLICATE';
    else if (event.status === 'SUCCEEDED')
      await this.completeRefund(rf.id, event.refundReference, 'WEBHOOK');
    else await this.failRefund(rf.id, event.refundReference, 'PROVIDER_FAILED', 'WEBHOOK');
    await this.storeEvent(
      this.prisma,
      incoming,
      rf.paymentId,
      `REFUND_${event.status}`,
      outcome,
      rf.reference,
    );
    return outcome;
  }

  /** DealDash finance retries a failed refund (same idempotency key at the provider: never refunded twice). */
  async retryRefund(actor: Actor, refundId: string, meta: RequestMeta) {
    const res = await this.prisma.reservationRefund.updateMany({
      where: { id: refundId, status: 'FAILED' },
      data: { status: 'PROCESSING', failureCode: null },
    });
    if (res.count !== 1) {
      const exists = await this.prisma.reservationRefund.count({ where: { id: refundId } });
      if (!exists) throw AppError.notFound();
      throw new AppError('INVALID_STATE', 'Only a failed refund can be retried', 409);
    }
    const rf = await this.prisma.reservationRefund.findUniqueOrThrow({ where: { id: refundId } });
    await this.audit.record({
      action: 'reservation.refund_retried',
      entityType: 'ReservationRefund',
      entityId: rf.id,
      actor,
      subjectOrganizationId: rf.organizationId,
      meta,
    });
    await this.executeRefund(rf.id);
    return this.prisma.reservationRefund.findUniqueOrThrow({ where: { id: rf.id } });
  }

  /** Sweep: refunds created inside other services' transactions (deal cancelled, suspension) that were not sent yet. */
  async sendUnsentRefunds(limit = 50) {
    const due = await this.prisma.reservationRefund.findMany({
      where: { status: 'PROCESSING', attempts: 0 },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    for (const r of due)
      await this.executeRefund(r.id).catch((e: Error) => this.logger.warn(e.message));
    return due.length;
  }

  async failedRefunds(limit = 50) {
    return this.prisma.reservationRefund.findMany({
      where: { status: 'FAILED' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  // ================================================================ card pre-authorisation (phase 3, RC-90..RC-95)
  /** The configured provider's card-hold capability, or null (then no market can offer CARD_PREAUTH). */
  holdProvider(): (PaymentProvider & CardHoldProvider) | null {
    return supportsCardHolds(this.provider) ? this.provider : null;
  }

  /** Opens a hold request inside the caller's transaction; the provider is asked after commit (`requestAuthorisation`). */
  async openAuthorisation(
    tx: Tx,
    r: {
      id: string;
      organizationId: string;
      amountMinor: number | null;
      quantity: number;
      currency: string | null;
    },
    actor: Actor | null,
    meta: RequestMeta | null,
  ): Promise<string> {
    if (!r.amountMinor || !r.currency)
      throw new AppError('INVALID_STATE', 'This reservation has no amount to hold', 409);
    const attempts = await tx.reservationAuthorisation.count({ where: { reservationId: r.id } });
    if (attempts >= MAX_PAYMENT_ATTEMPTS)
      throw new AppError(
        'PAYMENT_RETRY_LIMIT',
        'Too many card hold attempts for this reservation',
        409,
      );
    const attemptNo = attempts + 1;
    const a = await tx.reservationAuthorisation.create({
      data: {
        reservationId: r.id,
        provider: this.provider.name,
        amountMinor: r.amountMinor * r.quantity,
        currency: r.currency,
        attemptNo,
        idempotencyKey: `rauth:${r.id}:${attemptNo}`,
      },
    });
    await this.event(
      tx,
      r.id,
      'AUTHORISATION_REQUESTED',
      `attempt ${attemptNo}: hold ${a.amountMinor} ${a.currency}`,
      actor ? { userId: actor.userId, role: 'CUSTOMER' } : null,
    );
    await this.audit.record(
      {
        action: 'reservation.authorisation_requested',
        entityType: 'ReservationAuthorisation',
        entityId: a.id,
        actor,
        actorRole: actor ? undefined : 'SYSTEM',
        subjectOrganizationId: r.organizationId,
        newState: {
          reservationId: r.id,
          attemptNo,
          amountMinor: a.amountMinor,
          currency: a.currency,
        },
        meta,
      },
      tx,
    );
    return a.id;
  }

  /** Sends a hold request to the provider (after commit). A provider error fails the request; the customer may retry. */
  async requestAuthorisation(authId: string, returnTo?: string) {
    const holds = this.holdProvider();
    const a = await this.prisma.reservationAuthorisation.findUniqueOrThrow({
      where: { id: authId },
      include: { reservation: { select: { reference: true } } },
    });
    try {
      if (!holds) throw new Error('the payment provider does not support card holds');
      const res = await holds.authorise({
        orderId: a.reservation.reference,
        amountMinor: a.amountMinor,
        currency: a.currency,
        idempotencyKey: a.idempotencyKey,
        returnUrl: this.returnUrl(a.reservationId, returnTo),
      });
      await this.prisma.reservationAuthorisation.updateMany({
        where: { id: a.id, status: 'REQUESTED' },
        data: { providerReference: res.providerReference, redirectUrl: res.redirectUrl ?? null },
      });
      if (res.status !== 'PENDING')
        await this.applyHoldOutcome({
          providerReference: res.providerReference,
          status: res.status,
          source: 'SYNC',
        });
    } catch (e) {
      this.logger.warn(`Card hold request ${a.id} failed: ${(e as Error).message}`);
      await this.prisma.reservationAuthorisation.updateMany({
        where: { id: a.id, status: 'REQUESTED' },
        data: { status: 'FAILED', failureCode: 'PROVIDER_ERROR' },
      });
    }
  }

  private storeHoldEvent(
    db: Tx | PrismaService,
    e: IncomingEvent,
    authId: string | null,
    status: string,
    outcome: PaymentEventOutcome,
    note: string | null,
  ) {
    return db.paymentEvent.create({
      data: {
        reservationAuthorisationId: authId,
        providerEventId: e.eventId,
        kind: e.kind,
        status,
        payloadHash: e.payloadHash,
        signatureVerified: true,
        outcome,
        note,
        occurredAt: e.occurredAt,
      },
    });
  }

  /**
   * The state machine of a card hold, driven by the provider (webhook, reconciliation or a synchronous answer). Every change is a
   * reservation event and an audit record; the reservation is confirmed only once the hold is AUTHORISED (RC-32).
   */
  async applyHoldOutcome(input: {
    providerReference: string;
    status: CardHoldStatus;
    capturedMinor?: number;
    captureReference?: string;
    failureCode?: string;
    source: 'WEBHOOK' | 'RECONCILE' | 'SYNC';
    event?: IncomingEvent;
    now?: Date;
  }): Promise<{ outcome: PaymentEventOutcome; note: string | null }> {
    const now = input.now ?? new Date();
    const found = await this.prisma.reservationAuthorisation.findUnique({
      where: { providerReference: input.providerReference },
      select: { id: true, reservationId: true },
    });
    if (!found) {
      if (input.event)
        await this.storeHoldEvent(
          this.prisma,
          input.event,
          null,
          input.status,
          'IGNORED',
          'UNKNOWN_HOLD',
        );
      return { outcome: 'IGNORED', note: 'UNKNOWN_HOLD' };
    }
    // captures and releases confirmed asynchronously by the provider complete through their own paths
    if (input.status === 'CAPTURED' || input.status === 'PARTIALLY_CAPTURED') {
      const done = await this.completeCapture(
        found.id,
        input.capturedMinor ?? null,
        input.captureReference ?? `${input.providerReference}:capture`,
        input.source,
      );
      if (input.event)
        await this.storeHoldEvent(
          this.prisma,
          input.event,
          found.id,
          input.status,
          done ? 'APPLIED' : 'DUPLICATE',
          null,
        );
      return { outcome: done ? 'APPLIED' : 'DUPLICATE', note: null };
    }
    if (input.status === 'RELEASED') {
      const done = await this.completeRelease(found.id, input.source);
      if (input.event)
        await this.storeHoldEvent(
          this.prisma,
          input.event,
          found.id,
          input.status,
          done ? 'APPLIED' : 'DUPLICATE',
          null,
        );
      return { outcome: done ? 'APPLIED' : 'DUPLICATE', note: null };
    }
    const sent: Sent = [];
    const post: PostCommit[] = [];
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ReservationAuthorisation" WHERE "id" = ${found.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${found.reservationId}::uuid FOR UPDATE`;
      const a = await tx.reservationAuthorisation.findUniqueOrThrow({ where: { id: found.id } });
      const r = await tx.reservation.findUniqueOrThrow({
        where: { id: found.reservationId },
        include: MONEY_INCLUDE,
      });
      const role = input.source === 'WEBHOOK' ? 'PROVIDER' : 'SYSTEM';
      let outcome: PaymentEventOutcome = 'APPLIED';
      let note: string | null = null;

      if (input.status === 'AUTHORISED') {
        if (a.status === 'CANCELLED' || a.status === 'FAILED') {
          // the provider placed a hold for a request we already closed: void it at the provider, nothing is charged
          outcome = 'LATE_SUCCESS';
          note = `Hold request was ${a.status}; released at the provider`;
          const holds = this.holdProvider();
          if (holds && a.providerReference) {
            const providerRef = a.providerReference;
            post.push(() => holds.release(providerRef).catch(() => undefined));
          }
        } else if (a.status !== 'REQUESTED') outcome = 'DUPLICATE';
        else {
          const validity = this.holdProvider()?.holdCapabilities.authValidityMinutes ?? 0;
          await tx.reservationAuthorisation.update({
            where: { id: a.id },
            data: {
              status: 'AUTHORISED',
              authorisedAt: now,
              authExpiresAt: new Date(now.getTime() + validity * 60_000),
              failureCode: null,
            },
          });
          const confirmed =
            r.status === 'PENDING_PAYMENT'
              ? await tx.reservation.updateMany({
                  where: { id: r.id, status: 'PENDING_PAYMENT' },
                  data: this.confirmation(r, now, 'AUTHORISED'),
                })
              : { count: 0 };
          await this.event(
            tx,
            r.id,
            'AUTHORISED',
            `hold ${a.amountMinor} ${a.currency}${confirmed.count === 1 ? ': confirmed' : ': reservation already ended'}`,
            { userId: null, role },
            confirmed.count === 1 ? { from: 'PENDING_PAYMENT', to: 'HELD' } : undefined,
          );
          if (confirmed.count === 1) {
            const fresh = await tx.reservation.findUniqueOrThrow({
              where: { id: r.id },
              include: MONEY_INCLUDE,
            });
            sent.push(
              ...(await this.notifications.emit(tx, [
                this.notice('RESERVATION_CONFIRMED', fresh, 'confirmed', {
                  expiresAt: fresh.expiresAt.toISOString(),
                  holdMinor: a.amountMinor,
                  method: 'CARD_PREAUTH',
                }),
              ])),
            );
            // RC-92: "immediate capture" policy: the whole hold is captured now and then behaves like a full prepayment
            if (policyOf(r).preauthImmediateCapture) {
              await tx.reservationAuthorisation.update({
                where: { id: a.id },
                data: { pendingCaptureMinor: a.amountMinor, captureReason: 'IMMEDIATE' },
              });
              post.push(() => this.executeCapture(a.id));
            }
          } else {
            // authorised after the reservation ended (released / cancelled / another hold): void it straight away
            outcome = 'LATE_SUCCESS';
            note = `Reservation was ${r.status}; hold released automatically`;
            await tx.reservationAuthorisation.update({
              where: { id: a.id },
              data: { releaseRequestedAt: now, releaseReason: 'LATE_AUTHORISATION' },
            });
            post.push(() => this.executeRelease(a.id));
          }
        }
      } else if (input.status === 'FAILED') {
        if (a.status === 'REQUESTED') {
          await tx.reservationAuthorisation.update({
            where: { id: a.id },
            data: { status: 'FAILED', failureCode: input.failureCode ?? 'DECLINED' },
          });
          await this.event(tx, r.id, 'AUTHORISATION_FAILED', input.failureCode ?? 'DECLINED', {
            userId: null,
            role,
          });
          sent.push(
            ...(await this.notifications.emit(tx, [
              this.notice('RESERVATION_PAYMENT_FAILED', r, `hold:${a.id}:failed`, {
                method: 'CARD_PREAUTH',
                canRetry: r.status === 'PENDING_PAYMENT' && a.attemptNo < MAX_PAYMENT_ATTEMPTS,
                dueAt: r.paymentDueAt?.toISOString() ?? null,
              }),
            ])),
          );
          // the units stay held for a retry until the payment window ends (released by the sweep)
        } else {
          outcome = 'IGNORED';
          note = `Hold already ${a.status}`;
        }
      } else if (input.status === 'EXPIRED') {
        if (a.status === 'AUTHORISED') {
          // the reservation it guaranteed is cancelled by the sweep (units released, customer told; not a strike)
          await tx.reservationAuthorisation.update({
            where: { id: a.id },
            data: { authExpiresAt: now },
          });
          note = 'hold lapsed at the provider; the reservation ends at the next sweep';
        } else outcome = 'IGNORED';
      } else outcome = 'IGNORED';
      if (outcome === 'APPLIED' || outcome === 'LATE_SUCCESS')
        await this.audit.record(
          {
            action: `reservation.authorisation_${input.status.toLowerCase()}`,
            entityType: 'ReservationAuthorisation',
            entityId: a.id,
            actorRole: role,
            subjectOrganizationId: r.organizationId,
            previousState: { status: a.status, reservationStatus: r.status },
            newState: { status: input.status, source: input.source, outcome },
          },
          tx,
        );
      if (input.event)
        await this.storeHoldEvent(tx, input.event, a.id, input.status, outcome, note);
      return { outcome, note };
    });
    await this.notifications.dispatch(sent);
    for (const fn of post)
      await Promise.resolve(fn()).catch((e: Error) => this.logger.warn(e.message));
    return result;
  }

  /**
   * RC-92 / RC-61: an AUTHORISED hold at the end of the reservation. Late cancellation / no-show: captured minus the released share;
   * redeemed: released or captured per policy; otherwise released in full. Captures and releases go to the provider after commit;
   * money is posted only when the capture is confirmed (no revenue at authorisation).
   */
  private async settleHoldOnEnd(
    tx: Tx,
    r: MoneyRow,
    situation: EndSituation,
    now: Date,
    post: PostCommit[],
    opts: { redemptionId?: string; actor?: Actor | null },
  ): Promise<NotificationInput[]> {
    const a = await tx.reservationAuthorisation.findFirst({
      where: { reservationId: r.id, status: 'AUTHORISED' },
    });
    if (!a) return [];
    const capture = holdCaptureOnEnd(
      a.amountMinor,
      r.noShowRefundPercent,
      situation,
      policyOf(r).preauthOnRedemption,
    );
    if (capture > 0) {
      await tx.reservationAuthorisation.update({
        where: { id: a.id },
        data: {
          pendingCaptureMinor: capture,
          captureReason: opts.redemptionId ? `REDEEMED:${opts.redemptionId}` : situation,
        },
      });
      post.push(() => this.executeCapture(a.id));
    } else {
      await tx.reservationAuthorisation.update({
        where: { id: a.id },
        data: { releaseRequestedAt: now, releaseReason: situation },
      });
      post.push(() => this.executeRelease(a.id));
    }
    await this.audit.record(
      {
        action: 'reservation.hold_decided',
        entityType: 'ReservationAuthorisation',
        entityId: a.id,
        actor: opts.actor ?? null,
        actorRole: opts.actor ? undefined : 'SYSTEM',
        subjectOrganizationId: r.organizationId,
        newState: {
          situation,
          holdMinor: a.amountMinor,
          captureMinor: capture,
          releaseMinor: a.amountMinor - capture,
        },
      },
      tx,
    );
    // the customer is told when the provider confirms the capture / release
    return [];
  }

  /** Sends a decided capture to the provider (after commit). A refusal stays pending for the sweep (or ends the hold if expired). */
  async executeCapture(authId: string) {
    const holds = this.holdProvider();
    const a = await this.prisma.reservationAuthorisation.findUnique({ where: { id: authId } });
    if (!holds || !a || a.status !== 'AUTHORISED' || !a.pendingCaptureMinor || !a.providerReference)
      return;
    // a refused capture moved no money, so the next try is a new provider request; the key is derived from the recorded refusals
    // (the same for concurrent senders, so a capture can never be sent twice under different keys at once)
    const refusals = await this.prisma.auditLog.count({
      where: { action: 'reservation.capture_failed', entityId: a.id },
    });
    const res = await holds
      .capture({
        providerReference: a.providerReference,
        amountMinor: a.pendingCaptureMinor,
        idempotencyKey: `${a.idempotencyKey}:capture${refusals ? `:retry${refusals}` : ''}`,
      })
      .catch((e: Error) => ({
        captureReference: '',
        status: 'FAILED' as const,
        failureCode: `PROVIDER_ERROR: ${e.message}`.slice(0, 120),
      }));
    const r = await this.prisma.reservation.findUniqueOrThrow({
      where: { id: a.reservationId },
      select: {
        id: true,
        reference: true,
        organizationId: true,
        dealId: true,
        termsSnapshot: true,
      },
    });
    if (res.status === 'SUCCEEDED') {
      const done = await this.completeCapture(
        a.id,
        a.pendingCaptureMinor,
        res.captureReference,
        'SYNC',
      );
      // recovery after refusals is logged (and linked to the finance alert, if one was raised)
      if (done && refusals > 0) {
        const alert = await this.prisma.alertEvent.findFirst({
          where: { code: 'RESERVATION_CAPTURE_FAILED', subjectId: a.id },
          select: { id: true },
        });
        await this.audit.record({
          action: 'reservation.capture_recovered',
          entityType: 'ReservationAuthorisation',
          entityId: a.id,
          actorRole: 'SYSTEM',
          subjectOrganizationId: r.organizationId,
          newState: {
            capturedMinor: a.pendingCaptureMinor,
            refusalsBefore: refusals,
            alertId: alert?.id ?? null,
          },
        });
      }
      return;
    }
    await this.prisma.reservationAuthorisation.update({
      where: { id: a.id },
      data: { failureCode: res.failureCode ?? 'CAPTURE_REFUSED' },
    });
    await this.audit.record({
      action: 'reservation.capture_failed',
      entityType: 'ReservationAuthorisation',
      entityId: a.id,
      actorRole: 'SYSTEM',
      subjectOrganizationId: r.organizationId,
      newState: {
        pendingCaptureMinor: a.pendingCaptureMinor,
        failureCode: res.failureCode ?? null,
        refusals: refusals + 1,
      },
    });
    // RC-96: after the configured number of refusals DealDash finance is alerted (once per hold); retries continue meanwhile.
    // No fee / commission is recognised: nothing is posted until a capture succeeds.
    const threshold = policyOf(r).captureFailureAlertThreshold;
    if (refusals + 1 >= threshold)
      await this.raiseCaptureAlert(a, r, refusals + 1, res.failureCode);
  }

  private async raiseCaptureAlert(
    a: { id: string; pendingCaptureMinor: number | null; currency: string },
    r: { id: string; reference: string; organizationId: string; dealId: string },
    refusals: number,
    failureCode: string | undefined,
  ) {
    let alerts: AlertsService | null = null;
    try {
      alerts = this.moduleRef.get(AlertsService, { strict: false });
    } catch {
      alerts = null; // alerts are optional infrastructure: the audit record below always exists
    }
    const raised = await alerts
      ?.raise({
        code: 'RESERVATION_CAPTURE_FAILED',
        organizationId: null, // DealDash finance / admin
        subjectType: 'ReservationAuthorisation',
        subjectId: a.id,
        once: true,
        product: 'EXCLUSIVE',
        campaignId: r.dealId,
        data: {
          reservationId: r.id,
          reservationReference: r.reference,
          merchantOrganizationId: r.organizationId,
          amountMinor: a.pendingCaptureMinor,
          currency: a.currency,
          refusals,
          failureCode: failureCode ?? null,
        },
      })
      .catch((e: Error) => {
        this.logger.warn(`Capture alert for ${a.id} could not be raised: ${e.message}`);
        return null;
      });
    if (raised?.created)
      await this.audit.record({
        action: 'reservation.capture_alert_raised',
        entityType: 'ReservationAuthorisation',
        entityId: a.id,
        actorRole: 'SYSTEM',
        subjectOrganizationId: r.organizationId,
        newState: { alertId: raised.id, refusals },
      });
  }

  /**
   * A confirmed capture: the captured amount becomes a SUCCEEDED reservation payment (money received, held for the merchant). An
   * IMMEDIATE capture stays held (the reservation is then PAID and settles at its end like a prepayment); a capture at the end of
   * the reservation is settled at once: kept for the merchant net of DealDash's agreed commission (one fee, RC-73).
   */
  private async completeCapture(
    authId: string,
    capturedMinor: number | null,
    captureReference: string,
    source: string,
  ): Promise<boolean> {
    const sent: Sent = [];
    const done = await this.prisma.$transaction(async (tx) => {
      const a = await tx.reservationAuthorisation.findUniqueOrThrow({ where: { id: authId } });
      const amount = capturedMinor ?? a.pendingCaptureMinor ?? a.amountMinor;
      const claimed = await tx.reservationAuthorisation.updateMany({
        where: { id: authId, status: 'AUTHORISED' },
        data: {
          status: amount >= a.amountMinor ? 'CAPTURED' : 'PARTIALLY_CAPTURED',
          capturedMinor: amount,
          capturedAt: new Date(),
          pendingCaptureMinor: null,
          failureCode: null,
        },
      });
      if (claimed.count !== 1) return false;
      const r = await tx.reservation.findUniqueOrThrow({
        where: { id: a.reservationId },
        include: MONEY_INCLUDE,
      });
      const attempts = await tx.reservationPayment.count({ where: { reservationId: r.id } });
      const pay = await tx.reservationPayment.create({
        data: {
          reservationId: r.id,
          provider: a.provider,
          providerReference: captureReference || null,
          status: 'SUCCEEDED',
          amountMinor: amount,
          currency: a.currency,
          attemptNo: attempts + 1,
          idempotencyKey: `rcapture:${a.id}`,
          methodType: 'card_hold_capture',
          completedAt: new Date(),
        },
      });
      // money received only now (never at authorisation): held for the merchant
      await this.ledger.post(tx, {
        type: 'RESERVATION_PAYMENT',
        sourceType: 'ReservationPayment',
        sourceId: pay.id,
        idempotencyKey: `rpay-in:${pay.id}`,
        currency: a.currency,
        memo: `Reservation ${r.reference} card hold captured (${a.captureReason ?? 'capture'})`,
        lines: [
          { family: 'PSP_CLEARING', amountHalalas: amount, memo: captureReference || undefined },
          { family: 'MERCHANT_HELD', organizationId: r.organizationId, amountHalalas: -amount },
        ],
      });
      const role = source === 'WEBHOOK' ? 'PROVIDER' : 'SYSTEM';
      await this.event(
        tx,
        r.id,
        'HOLD_CAPTURED',
        `${amount} of ${a.amountMinor} captured (${a.captureReason ?? 'capture'}); ${a.amountMinor - amount} released`,
        { userId: null, role },
      );
      if (a.captureReason === 'IMMEDIATE') {
        // held until the reservation ends; it then settles like a prepayment (refund / keep rules)
        await tx.reservation.update({ where: { id: r.id }, data: { paymentStatus: 'PAID' } });
      } else {
        const redemptionId = a.captureReason?.startsWith('REDEEMED:')
          ? a.captureReason.slice('REDEEMED:'.length)
          : null;
        const fee = commissionOn(amount, r.commissionBps ?? 0);
        await this.ledger.post(tx, {
          type: 'RESERVATION_SETTLEMENT',
          sourceType: redemptionId ? 'Redemption' : 'Reservation',
          sourceId: redemptionId ?? r.id,
          idempotencyKey: redemptionId
            ? `rsettle:${r.id}:redeem:${redemptionId}`
            : `rsettle:${r.id}:end`,
          currency: a.currency,
          memo: `Reservation ${r.reference} card hold kept (${a.captureReason ?? 'capture'})`,
          reasonCode: a.captureReason ?? undefined,
          lines: [
            { family: 'MERCHANT_HELD', organizationId: r.organizationId, amountHalalas: amount },
            {
              family: 'PLATFORM_REVENUE',
              amountHalalas: -fee,
              memo: `commission ${r.commissionBps ?? 0} bps`,
            },
            {
              family: 'MERCHANT_SETTLEMENT_ELIGIBLE',
              organizationId: r.organizationId,
              amountHalalas: -(amount - fee),
            },
          ],
        });
        // redeemed: the captured amount is "paid and used" (PAID, like a redeemed prepayment: a redemption reversal or a cancelled
        // campaign can still refund it); a late cancellation / no-show capture is final (CAPTURED)
        await tx.reservation.update({
          where: { id: r.id },
          data: {
            keptMinor: amount,
            feeMinor: fee,
            settledAt: new Date(),
            paymentStatus: redemptionId ? 'PAID' : 'CAPTURED',
          },
        });
        if (!redemptionId)
          await this.event(tx, r.id, 'FORFEITED', `${amount} kept (${a.captureReason})`, {
            userId: null,
            role,
          });
        await this.event(
          tx,
          r.id,
          'SETTLED_TO_MERCHANT',
          `${amount - fee} to the merchant, fee ${fee}`,
          { userId: null, role },
        );
      }
      await this.audit.record(
        {
          action: 'reservation.hold_captured',
          entityType: 'ReservationAuthorisation',
          entityId: a.id,
          actorRole: role,
          subjectOrganizationId: r.organizationId,
          newState: {
            capturedMinor: amount,
            releasedMinor: a.amountMinor - amount,
            reason: a.captureReason,
            source,
          },
        },
        tx,
      );
      sent.push(
        ...(await this.notifications.emit(tx, [
          this.notice('RESERVATION_HOLD_CAPTURED', r, `hold:${a.id}:captured`, {
            capturedMinor: amount,
            releasedMinor: a.amountMinor - amount,
            reason: a.captureReason,
          }),
        ])),
      );
      return true;
    });
    await this.notifications.dispatch(sent);
    return done;
  }

  /** Sends a decided release to the provider (after commit); retried by the sweep if the provider call fails. */
  async executeRelease(authId: string) {
    const holds = this.holdProvider();
    const a = await this.prisma.reservationAuthorisation.findUnique({ where: { id: authId } });
    if (!holds || !a || !a.releaseRequestedAt) return;
    if (a.status !== 'AUTHORISED' && a.status !== 'REQUESTED') return;
    try {
      if (a.providerReference) await holds.release(a.providerReference);
    } catch (e) {
      this.logger.warn(`Card hold release ${a.id} failed: ${(e as Error).message}`);
      return;
    }
    await this.completeRelease(a.id, 'SYNC');
  }

  /** A confirmed release: nothing is charged, nothing is posted to the ledger (no money moved). */
  private async completeRelease(authId: string, source: string): Promise<boolean> {
    const sent: Sent = [];
    const done = await this.prisma.$transaction(async (tx) => {
      const a = await tx.reservationAuthorisation.findUniqueOrThrow({ where: { id: authId } });
      const wasHeld = a.status === 'AUTHORISED';
      const claimed = await tx.reservationAuthorisation.updateMany({
        where: { id: authId, status: { in: ['AUTHORISED', 'REQUESTED'] } },
        data: {
          status: wasHeld ? 'RELEASED' : 'CANCELLED',
          releasedAt: new Date(),
          pendingCaptureMinor: null,
        },
      });
      if (claimed.count !== 1) return false;
      const r = await tx.reservation.findUniqueOrThrow({
        where: { id: a.reservationId },
        include: MONEY_INCLUDE,
      });
      if (wasHeld && r.paymentStatus === 'AUTHORISED')
        await tx.reservation.update({ where: { id: r.id }, data: { paymentStatus: 'VOIDED' } });
      const role = source === 'WEBHOOK' ? 'PROVIDER' : 'SYSTEM';
      await this.event(
        tx,
        r.id,
        'HOLD_RELEASED',
        `${a.amountMinor} released (${a.releaseReason ?? 'release'})`,
        {
          userId: null,
          role,
        },
      );
      await this.audit.record(
        {
          action: 'reservation.hold_released',
          entityType: 'ReservationAuthorisation',
          entityId: a.id,
          actorRole: role,
          subjectOrganizationId: r.organizationId,
          newState: { releasedMinor: a.amountMinor, reason: a.releaseReason, source },
        },
        tx,
      );
      if (wasHeld)
        sent.push(
          ...(await this.notifications.emit(tx, [
            this.notice('RESERVATION_HOLD_RELEASED', r, `hold:${a.id}:released`, {
              releasedMinor: a.amountMinor,
              reason: a.releaseReason,
            }),
          ])),
        );
      return true;
    });
    await this.notifications.dispatch(sent);
    return done;
  }

  /**
   * A live hold that lapsed (authExpiresAt passed, or the provider said EXPIRED): marked EXPIRED, nothing charged. The caller then
   * cancels the reservation it guaranteed (units released, not a strike) in the same transaction.
   */
  async expireHoldInTx(tx: Tx, authId: string): Promise<boolean> {
    const claimed = await tx.reservationAuthorisation.updateMany({
      where: { id: authId, status: 'AUTHORISED' },
      data: { status: 'EXPIRED', pendingCaptureMinor: null },
    });
    if (claimed.count !== 1) return false;
    const a = await tx.reservationAuthorisation.findUniqueOrThrow({ where: { id: authId } });
    await tx.reservation.updateMany({
      where: { id: a.reservationId, paymentStatus: 'AUTHORISED' },
      data: { paymentStatus: 'VOIDED' },
    });
    await this.event(
      tx,
      a.reservationId,
      'AUTHORISATION_EXPIRED',
      'card hold lapsed: nothing charged',
    );
    await this.audit.record(
      {
        action: 'reservation.authorisation_expired',
        entityType: 'ReservationAuthorisation',
        entityId: a.id,
        actorRole: 'SYSTEM',
        newState: { amountMinor: a.amountMinor },
      },
      tx,
    );
    return true;
  }

  /** Live holds that have lapsed (for the sweep). */
  dueExpiredHolds(now: Date, limit = 200) {
    return this.prisma.reservationAuthorisation.findMany({
      where: { status: 'AUTHORISED', authExpiresAt: { lte: now } },
      select: { id: true, reservationId: true },
      take: limit,
    });
  }

  /** Sweep: captures and releases decided inside other transactions, or refused / failed earlier, are (re)sent. */
  async sendPendingHoldActions(limit = 50) {
    const captures = await this.prisma.reservationAuthorisation.findMany({
      where: { status: 'AUTHORISED', pendingCaptureMinor: { not: null } },
      select: { id: true },
      take: limit,
    });
    for (const c of captures)
      await this.executeCapture(c.id).catch((e: Error) => this.logger.warn(e.message));
    const releases = await this.prisma.reservationAuthorisation.findMany({
      where: { status: { in: ['AUTHORISED', 'REQUESTED'] }, releaseRequestedAt: { not: null } },
      select: { id: true },
      take: limit,
    });
    for (const r of releases)
      await this.executeRelease(r.id).catch((e: Error) => this.logger.warn(e.message));
    return captures.length + releases.length;
  }
}
