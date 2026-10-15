import { randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ApiEnv } from '@dealdash/config';
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
  type PaymentProvider,
  type PaymentWebhookEvent,
} from '../providers/interfaces';
import { LedgerService } from '../vouchers/ledger.service';
import { parseHotContent } from './hot-content';
import { NotificationsService, type NotificationInput } from './notifications.service';
import {
  commissionOn,
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
  kind: 'PAYMENT' | 'REFUND';
  payloadHash: string;
  occurredAt: Date | null;
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
      | 'SETTLED_TO_MERCHANT',
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

  private returnUrl(reservationId: string) {
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
  async initiate(paymentId: string) {
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
        returnUrl: this.returnUrl(p.reservationId),
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
  async retry(actor: Actor, reservationId: string, meta: RequestMeta, now = new Date()) {
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
    await this.initiate(paymentId);
  }

  // ================================================================ provider outcomes (webhook, reconciliation, sync)
  /** Does this provider event belong to a reservation payment or refund? (The shared webhook routes on this.) */
  async owns(event: PaymentWebhookEvent): Promise<boolean> {
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
  private confirmation(r: MoneyRow, now: Date): Prisma.ReservationUpdateManyMutationInput {
    const expiresAt = new Date(now.getTime() + r.holdMinutes * 60_000);
    const terms = (r.termsSnapshot ?? {}) as { cancelCutoffMinutes?: number | null };
    const cutoffMin = terms.cancelCutoffMinutes ?? null;
    const cutoff =
      cutoffMin === null
        ? null
        : new Date(Math.max(now.getTime(), expiresAt.getTime() - cutoffMin * 60_000));
    return {
      status: 'HELD',
      paymentStatus: 'PAID',
      confirmedAt: now,
      expiresAt,
      cancelCutoffAt: cutoff,
      expiringNoticeSentAt: null,
    };
  }

  /** Reconciliation when the payment window ends: did the customer actually pay a moment ago? Then confirm instead of releasing. */
  async reconcileOpen(reservationId: string): Promise<'PAID' | 'UNPAID'> {
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
}
