import { Injectable, Logger } from '@nestjs/common';
import type { CancelledBy, ReservationStatus } from '@dealdash/types';
import {
  commitmentMethodOf,
  type MyReservationBrief,
  type ReservationView,
  type HotDealContent,
} from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { EligibilityService, evaluateEligibility } from '../live-deals/eligibility.service';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import {
  formatManualCode,
  newManualCode,
  newQrToken,
  newReference,
  parseHotContent,
  qrText,
} from './hot-content';
import { HotCoreService } from './hot-core.service';
import { MarketService } from '../platform/markets/market.service';
import { NotificationsService, type NotificationInput } from './notifications.service';
import type { EndSituation } from './reservation-money';
import {
  MAX_PAYMENT_ATTEMPTS,
  ReservationPaymentsService,
  type PostCommit,
} from './reservation-payments.service';
import { ReservationPolicyService } from './reservation-policy.service';

const RES_INCLUDE = {
  deal: { include: { organization: { include: { merchant: true } } } },
  branch: true,
  // phase 2: the latest payment attempt (pay link) and the refunds the customer / merchant see
  payments: { orderBy: { attemptNo: 'desc' as const }, take: 1 },
  refunds: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.ReservationInclude;

/** Statuses that hold units and count toward the customer's limits (a reservation waiting for payment holds its units). */
const LIVE_STATUSES = ['HELD', 'PENDING_PAYMENT'] as const;
export type ResRow = Prisma.ReservationGetPayload<{ include: typeof RES_INCLUDE }>;

const MS_MINUTE = 60_000;

type Tx = Prisma.TransactionClient;

interface Releasable {
  id: string;
  dealId: string;
  branchId: string;
  organizationId: string;
  userId: string;
  quantity: number;
}

/**
 * Reservations and the per-branch stock behind them. FREE reservations confirm on creation (policy-allowed only); paid commitments
 * (full prepayment, deposit) wait in PENDING_PAYMENT for the payment window and confirm when the provider confirms the payment
 * (ReservationPaymentsService owns the money: payments, refunds, forfeits, ledger).
 *
 * Concurrency design (PostgreSQL, READ COMMITTED):
 *  - Stock moves ONLY through single conditional UPDATE statements on the HotDealInventory row
 *    (`... WHERE available >= q`). The UPDATE takes the row lock, so two concurrent reservations for the last unit are
 *    serialised by the database: exactly one matches, the other matches zero rows and is refused. CHECK constraints
 *    (never negative, total = available + reserved + redeemed) are the second line of defence.
 *  - Reservation state changes are conditional updates on `status = 'HELD'`, so cancel / expire / redeem can never
 *    both win for the same reservation.
 *  - Lock order is always inventory row, then deal row (never the reverse), so concurrent reservations cannot deadlock.
 *    A pause that lands in the same millisecond as a reservation is ordered by the database: the reservation made it in
 *    first and is honoured; every later attempt sees the paused deal.
 *  - The per-customer limit is serialised by a transaction-scoped advisory lock on (customer, deal).
 */
@Injectable()
export class ReservationsService {
  private readonly logger = new Logger('Reservations');

  constructor(
    private readonly core: HotCoreService,
    private readonly eligibility: EligibilityService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly policy: ReservationPolicyService,
    private readonly money: ReservationPaymentsService,
    private readonly markets: MarketService,
  ) {}

  /** Runs provider calls queued during a committed transaction (refunds, attempt cancellations); failures never fail the action. */
  private async runPost(post: PostCommit[]) {
    for (const fn of post)
      await Promise.resolve(fn()).catch((e: Error) => this.logger.warn(e.message));
  }

  private get prisma() {
    return this.core.prisma;
  }

  // ================================================================ stock helpers (conditional updates only)
  private async takeStock(tx: Tx, dealId: string, branchId: string, q: number): Promise<boolean> {
    const n = await tx.$executeRaw`
      UPDATE "HotDealInventory"
         SET "available" = "available" - ${q}, "reserved" = "reserved" + ${q}, "updatedAt" = now()
       WHERE "dealId" = ${dealId}::uuid AND "branchId" = ${branchId}::uuid AND "tracked" AND "available" >= ${q}`;
    return n === 1;
  }

  private async giveBackStock(tx: Tx, r: Pick<Releasable, 'dealId' | 'branchId' | 'quantity'>) {
    const n = await tx.$executeRaw`
      UPDATE "HotDealInventory"
         SET "available" = "available" + ${r.quantity}, "reserved" = "reserved" - ${r.quantity},
             "released" = "released" + ${r.quantity}, "updatedAt" = now()
       WHERE "dealId" = ${r.dealId}::uuid AND "branchId" = ${r.branchId}::uuid AND "reserved" >= ${r.quantity}`;
    if (n !== 1) throw new AppError('INVALID_STATE', 'Stock could not be released', 409);
  }

  /**
   * SOLD_OUT follows stock: no units available in any tracked branch -> SOLD_OUT; units back (cancelled, not completed,
   * added) -> LIVE again while the window is open. A conditional update, so racing callers cannot conflict.
   */
  async syncAvailability(tx: Tx, dealId: string, now = new Date()) {
    const rows = await tx.hotDealInventory.findMany({
      where: { dealId, tracked: true, branch: { status: 'ACTIVE' } },
      select: { available: true },
    });
    if (!rows.length) return;
    const available = rows.reduce((n, r) => n + r.available, 0);
    const deal = await tx.hotDeal.findUnique({
      where: { id: dealId },
      select: { id: true, organizationId: true, status: true, startAt: true, endAt: true },
    });
    if (!deal) return;
    if (available === 0 && deal.status === 'LIVE') {
      const res = await tx.hotDeal.updateMany({
        where: { id: dealId, status: 'LIVE' },
        data: { status: 'SOLD_OUT', version: { increment: 1 } },
      });
      if (res.count === 1)
        await this.core.record(tx, deal, {
          action: 'SOLD_OUT',
          from: 'LIVE',
          to: 'SOLD_OUT',
          actor: null,
          reason: 'No units left',
        });
    } else if (available > 0 && deal.status === 'SOLD_OUT') {
      const open =
        (!deal.startAt || deal.startAt.getTime() <= now.getTime()) &&
        (!deal.endAt || deal.endAt.getTime() > now.getTime());
      if (!open) return;
      const res = await tx.hotDeal.updateMany({
        where: { id: dealId, status: 'SOLD_OUT' },
        data: { status: 'LIVE', version: { increment: 1 } },
      });
      if (res.count === 1)
        await this.core.record(tx, deal, {
          action: 'REOPEN',
          from: 'SOLD_OUT',
          to: 'LIVE',
          actor: null,
          reason: 'Units available again',
        });
    }
  }

  private async event(
    tx: Tx,
    type:
      | 'RESERVATION_CREATED'
      | 'RESERVATION_CANCELLED'
      | 'RESERVATION_EXPIRED'
      | 'RESERVATION_REDEEMED',
    r: Releasable,
  ) {
    await tx.dealEvent.create({
      data: {
        type,
        productType: 'HOT',
        dealId: r.dealId,
        merchantOrgId: r.organizationId,
        branchId: r.branchId,
        userId: r.userId,
        anonymousId: `user:${r.userId}`.slice(0, 64),
      },
    });
  }

  private notice(type: NotificationInput['type'], r: ResRow, key: string): NotificationInput {
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
        expiresAt: r.expiresAt.toISOString(),
      },
    };
  }

  // ================================================================ create (customer)
  async reserve(
    actor: Actor,
    dealId: string,
    input: { branchId: string; quantity: number },
    meta: RequestMeta,
    now = new Date(),
  ): Promise<ReservationView> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.reserveOnce(actor, dealId, input, meta, now);
      } catch (e) {
        // A random code/reference collision (practically impossible) is retried with fresh codes.
        const code = (e as { code?: string }).code;
        if ((code === 'P2002' || code === 'P2034') && attempt < 3) continue;
        throw e;
      }
    }
  }

  private async reserveOnce(
    actor: Actor,
    dealId: string,
    input: { branchId: string; quantity: number },
    meta: RequestMeta,
    now: Date,
  ): Promise<ReservationView> {
    const userId = actor.userId;
    // a suspended agreement can choose to stop NEW reservations (default: live prepaid campaigns continue); issued codes always redeem
    const owner = await this.prisma.hotDeal.findUnique({
      where: { id: dealId },
      select: { organizationId: true },
    });
    if (owner)
      await this.core.commercial.assertCustomerExposureAllowed(owner.organizationId, {
        userId,
        scope: 'NEW_RESERVATIONS',
      });
    // Everything that reads configuration or other tables is done BEFORE the transaction opens, so the transaction holds
    // one database connection and never waits for a second one (no pool starvation under load).
    const restriction = await this.prisma.customerRestriction.findFirst({
      where: { userId, status: 'ACTIVE', endsAt: { gt: now } },
    });
    if (restriction)
      throw new AppError(
        'RESERVATIONS_PAUSED',
        'New reservations are paused for your account for a short time.',
        403,
        undefined,
        [
          {
            code: 'RESERVATIONS_PAUSED',
            message: 'New reservations are paused for your account for a short time.',
          },
          { code: 'RESTRICTION_ENDS', message: restriction.endsAt.toISOString() },
        ],
      );

    const deal = await this.prisma.hotDeal.findFirst({
      where: { id: dealId },
      include: {
        organization: { include: { merchant: true } },
        ruleSet: { include: { conditions: true } },
      },
    });
    const isOpen = (d: { startAt: Date | null; endAt: Date | null }) =>
      (!d.startAt || d.startAt.getTime() <= now.getTime()) &&
      (!d.endAt || d.endAt.getTime() > now.getTime());
    if (
      !deal ||
      !['LIVE', 'SOLD_OUT'].includes(deal.status) ||
      !isOpen(deal) ||
      deal.organization.status !== 'ACTIVE'
    )
      throw AppError.notFound();
    if (!deal.reservationsEnabled)
      throw new AppError(
        'OFFER_UNAVAILABLE',
        'This offer does not use reservations. Just visit the branch.',
        409,
      );
    // Reservation commitment model (2026-10-15). FREE only where the CURRENT effective policy allows it (RC-05, RC-22: a legacy free
    // deal takes no new free reservations elsewhere). Full prepayment and deposit go through the payment step (phase 2); card
    // pre-authorisation is build phase 3.
    const dealContent = parseHotContent(deal.content);
    const method = commitmentMethodOf(dealContent) ?? 'FREE';
    const effectivePolicy = await this.policy.forDeal(deal.organizationId, dealContent);
    if (method === 'FREE' && !effectivePolicy.freeAllowed)
      throw new AppError(
        'RESERVATION_METHOD_REQUIRED',
        'This offer cannot be reserved right now.',
        409,
      );
    if (method === 'CARD_PREAUTH')
      throw new AppError(
        'RESERVATION_PAYMENT_UNAVAILABLE',
        'Reserving this offer needs a payment, which is not available yet.',
        409,
      );
    const paid = method !== 'FREE';
    const unitAmount = dealContent.commitment.amountMinor;
    if (paid && (!unitAmount || unitAmount < 1))
      throw new AppError('OFFER_UNAVAILABLE', 'This offer cannot be reserved right now.', 409);
    // money is in the deal's market currency (never a fixed country)
    const currency = paid ? (await this.markets.profile(effectivePolicy.market)).currency : null;
    const noShowRefundPercent =
      method === 'FULL_PREPAYMENT'
        ? (dealContent.commitment.noShowRefundPercent ??
          effectivePolicy.fields.prepaymentRefundDefaultPercent)
        : null;
    const paymentWindowMinutes = effectivePolicy.fields.paymentWindowMinutes;

    const branch = await this.prisma.merchantBranch.findFirst({
      where: { id: input.branchId, organizationId: deal.organizationId },
    });
    const inv = await this.prisma.hotDealInventory.findUnique({
      where: { dealId_branchId: { dealId, branchId: input.branchId } },
    });
    if (!branch || !inv) throw AppError.notFound();
    if (branch.status !== 'ACTIVE' || !inv.tracked)
      throw new AppError('BRANCH_CLOSED', 'This branch is not taking reservations right now.', 409);

    // Eligibility is checked again at the moment of action, not only when the card was shown.
    const ctx = await this.eligibility.contextFor(userId, branch.city, now);
    const outcome = evaluateEligibility(
      deal.eligibilityKind,
      (deal.ruleSet?.conditions ?? []).map((c) => ({
        attrType: c.attrType,
        valueRef: c.valueRef,
        requiredLevel: c.requiredLevel,
      })),
      ctx,
      deal.ruleSet?.expression,
    );
    if (outcome.result !== 'ELIGIBLE')
      throw new AppError(
        'NOT_ELIGIBLE',
        outcome.message?.en ?? 'This offer is not available for your account',
        403,
      );
    const holdMinutes = await this.core.holdMinutes(deal);
    const maxActive = await this.core.maxActiveReservations();

    const out = await this.prisma.$transaction(async (tx) => {
      // Serialise this customer's reservations for this deal (limit checks).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`res:${userId}:${dealId}`}, 0))`;

      // The deal may have been paused between the checks above and now: confirm inside the transaction.
      const fresh = await tx.hotDeal.findUnique({
        where: { id: dealId },
        select: { status: true, startAt: true, endAt: true },
      });
      // SOLD_OUT is allowed through: units of overdue holds may be freed just below.
      if (!fresh || !['LIVE', 'SOLD_OUT'].includes(fresh.status) || !isOpen(fresh))
        throw AppError.notFound();

      const mine = await tx.reservation.findMany({
        where: { userId, status: { in: [...LIVE_STATUSES, 'REDEEMED'] } },
        select: { dealId: true, status: true, quantity: true, expiresAt: true },
      });
      const forDeal = mine
        .filter(
          (m) =>
            m.dealId === dealId &&
            (m.status === 'REDEEMED' || m.expiresAt.getTime() > now.getTime()),
        )
        .reduce((n, m) => n + m.quantity, 0);
      if (forDeal + input.quantity > deal.perCustomerLimit)
        throw new AppError(
          'LIMIT_REACHED',
          deal.perCustomerLimit === 1
            ? 'You have already reserved this offer.'
            : `You can reserve this offer up to ${deal.perCustomerLimit} times.`,
          409,
        );
      const active = mine.filter(
        (m) => m.status !== 'REDEEMED' && m.expiresAt.getTime() > now.getTime(),
      ).length;
      if (active >= maxActive)
        throw new AppError(
          'TOO_MANY_ACTIVE',
          `You can hold up to ${maxActive} reservations at a time. Use or cancel one first.`,
          409,
        );

      // Stock: the single atomic step.
      const lazyNotices: Array<NotificationInput & { id: string }> = [];
      let took = await this.takeStock(tx, dealId, input.branchId, input.quantity);
      if (!took) {
        // Holds that already elapsed but were not swept yet must not block a customer: free them, then retry once.
        const freed = await this.expireDueForBranch(tx, dealId, input.branchId, now);
        if (freed) {
          lazyNotices.push(...freed);
          took = await this.takeStock(tx, dealId, input.branchId, input.quantity);
        }
      }
      if (!took)
        throw new AppError('OUT_OF_STOCK', 'Sorry, this offer just sold out at this branch.', 409);

      const created = await tx.reservation.create({
        data: {
          campaignVersion: await this.core.versions.current(tx, 'EXCLUSIVE', dealId),
          reference: newReference(),
          dealId,
          branchId: input.branchId,
          organizationId: deal.organizationId,
          userId,
          quantity: input.quantity,
          holdMinutes,
          createdAt: now,
          // paid: the units wait for the payment window; the hold timer starts only when the payment is confirmed (RC-31, RC-32)
          expiresAt: paid
            ? new Date(now.getTime() + paymentWindowMinutes * MS_MINUTE)
            : new Date(now.getTime() + holdMinutes * MS_MINUTE),
          qrToken: newQrToken(),
          manualCode: newManualCode(),
          // RC-12 / RC-32: the commitment and the policy in force are kept on the reservation
          ...(paid
            ? {
                status: 'PENDING_PAYMENT' as const,
                commitmentMethod: method,
                paymentStatus: 'PENDING' as const,
                paymentDueAt: new Date(now.getTime() + paymentWindowMinutes * MS_MINUTE),
                amountMinor: unitAmount,
                currency,
                depositRefundable:
                  method === 'DEPOSIT' ? dealContent.commitment.depositRefundable : null,
                noShowRefundPercent,
                commissionBps: effectivePolicy.fields.commissionBps,
              }
            : {
                commitmentMethod: 'FREE' as const,
                paymentStatus: 'NOT_REQUIRED' as const,
                confirmedAt: now,
              }),
          termsSnapshot: {
            method,
            holdMinutes,
            ...(paid
              ? {
                  amountMinorPerUnit: unitAmount,
                  totalMinor: unitAmount! * input.quantity,
                  currency,
                  depositRefundable:
                    method === 'DEPOSIT' ? dealContent.commitment.depositRefundable : null,
                  cancelCutoffMinutes: dealContent.commitment.cancelCutoffMinutes,
                  noShowRefundPercent,
                  paymentWindowMinutes,
                  commissionBps: effectivePolicy.fields.commissionBps,
                }
              : {}),
            noShow: 'A reservation not used before it ends counts as a no-show (RC-50, RC-52).',
            policy: this.policy.snapshot(effectivePolicy, now),
          } as Prisma.InputJsonValue,
        },
        include: RES_INCLUDE,
      });
      await tx.reservationEvent.create({
        data: {
          reservationId: created.id,
          type: 'CREATED',
          toStatus: paid ? 'PENDING_PAYMENT' : 'HELD',
          actorUserId: userId,
          actorRole: 'CUSTOMER',
        },
      });
      const paymentId = paid ? await this.money.openAttempt(tx, created, actor, meta) : null;
      await this.event(tx, 'RESERVATION_CREATED', created);
      await this.core.audit.record(
        {
          action: 'reservation.create',
          entityType: 'Reservation',
          entityId: created.id,
          actor,
          subjectOrganizationId: deal.organizationId,
          meta,
        },
        tx,
      );
      await this.syncAvailability(tx, dealId, now);
      // a paid reservation is confirmed (and notified) when the provider confirms the payment, not here (RC-32)
      const sent = paid
        ? []
        : await this.notifications.emit(tx, [
            this.notice('RESERVATION_CONFIRMED', created, 'confirmed'),
          ]);
      return { created, paymentId, sent: [...lazyNotices, ...sent] };
    });
    await this.notifications.dispatch(out.sent);
    if (out.paymentId) await this.money.initiate(out.paymentId);
    const fresh = await this.prisma.reservation.findUniqueOrThrow({
      where: { id: out.created.id },
      include: RES_INCLUDE,
    });
    return (await this.views([fresh], now))[0]!;
  }

  /** Customer: another payment attempt inside the payment window (the previous one failed or was abandoned). */
  async retryPayment(actor: Actor, id: string, meta: RequestMeta, now = new Date()) {
    await this.money.retry(actor, id, meta, now);
    return this.getMine(actor.userId, id, now);
  }

  /** Expires holds of one branch that are past their time (used when a customer finds the branch "full"). */
  private async expireDueForBranch(
    tx: Tx,
    dealId: string,
    branchId: string,
    now: Date,
  ): Promise<Array<NotificationInput & { id: string }> | null> {
    const due = await tx.reservation.findMany({
      where: { dealId, branchId, status: 'HELD', expiresAt: { lte: now } },
      include: RES_INCLUDE,
      take: 50,
    });
    let any = false;
    const sent: Array<NotificationInput & { id: string }> = [];
    for (const r of due) {
      const done = await this.expireInTx(tx, r, now);
      if (done) {
        any = true;
        sent.push(...done);
      }
    }
    return any ? sent : null;
  }

  // ================================================================ cancel
  /**
   * Cancels a held reservation and returns the units. `by` is who asked; customers can only cancel their own.
   * Cancelling is NOT a no-show: only a hold that elapses unredeemed is counted.
   */
  async cancel(
    id: string,
    by: CancelledBy,
    actor: Actor | null,
    scope: { userId?: string; organizationId?: string },
    reason: string | null,
    meta: RequestMeta | null,
    now = new Date(),
  ): Promise<ReservationView> {
    const row = await this.prisma.reservation.findFirst({
      where: {
        id,
        ...(scope.userId ? { userId: scope.userId } : {}),
        ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      },
      include: RES_INCLUDE,
    });
    if (!row) throw AppError.notFound();
    const post: PostCommit[] = [];
    const sent = await this.prisma.$transaction((tx) =>
      this.cancelInTx(tx, row, by, actor, reason, meta, now, post),
    );
    await this.notifications.dispatch(sent);
    await this.runPost(post);
    const fresh = await this.prisma.reservation.findUniqueOrThrow({
      where: { id },
      include: RES_INCLUDE,
    });
    return (await this.views([fresh], now))[0]!;
  }

  async cancelInTx(
    tx: Tx,
    row: ResRow,
    by: CancelledBy,
    actor: Actor | null,
    reason: string | null,
    meta: RequestMeta | null,
    now: Date,
    /** Provider calls to make after commit (refunds). Without it, refunds are sent by the next sweep. */
    post?: PostCommit[],
  ) {
    // lock the row first: a payment callback confirming it at the same moment (it locks the same row) is serialised with this cancel
    await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "id" = ${row.id}::uuid FOR UPDATE`;
    const current = await tx.reservation.findUniqueOrThrow({
      where: { id: row.id },
      select: { status: true, cancelCutoffAt: true },
    });
    const from = current.status;
    const res = await tx.reservation.updateMany({
      where: {
        id: row.id,
        status: { in: [...LIVE_STATUSES] },
        ...(by === 'CUSTOMER' ? { expiresAt: { gt: now } } : {}),
      },
      data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: by, cancelReason: reason },
    });
    if (res.count !== 1 || (from !== 'HELD' && from !== 'PENDING_PAYMENT'))
      throw new AppError(
        'RESERVATION_NOT_CANCELLABLE',
        from === 'REDEEMED'
          ? 'This reservation was already used.'
          : 'This reservation can no longer be cancelled.',
        409,
      );
    await this.giveBackStock(tx, row);
    await tx.reservationEvent.create({
      data: {
        reservationId: row.id,
        type: 'CANCELLED',
        fromStatus: from,
        toStatus: 'CANCELLED',
        actorUserId: actor?.userId ?? null,
        actorRole: actor?.membership?.roleCode ?? (by === 'CUSTOMER' ? 'CUSTOMER' : 'SYSTEM'),
        note: reason,
      },
    });
    // money (RC-40..RC-43): never paid -> attempts cancelled, nothing charged; paid -> kept and / or refunded under the terms
    const queue = post ?? [];
    let moneyNotices: NotificationInput[] = [];
    if (from === 'PENDING_PAYMENT') await this.money.markUnpaid(tx, row.id, now, queue);
    else {
      const situation: EndSituation =
        by === 'CUSTOMER'
          ? current.cancelCutoffAt && now.getTime() >= current.cancelCutoffAt.getTime()
            ? 'CUSTOMER_LATE'
            : 'CUSTOMER_IN_TIME'
          : by === 'MERCHANT'
            ? 'MERCHANT_CANCELLED'
            : by === 'DEALDASH'
              ? 'DEALDASH_CANCELLED'
              : 'SYSTEM_CANCELLED';
      moneyNotices = await this.money.settleOnEnd(tx, row.id, situation, now, queue, { actor });
    }
    await this.event(tx, 'RESERVATION_CANCELLED', row);
    await this.core.audit.record(
      {
        action: 'reservation.cancel',
        entityType: 'Reservation',
        entityId: row.id,
        reason,
        actor,
        actorRole: actor ? undefined : 'SYSTEM',
        subjectOrganizationId: row.organizationId,
        meta,
      },
      tx,
    );
    await this.syncAvailability(tx, row.dealId, now);
    // The customer cancelled it themselves: no cancellation notice for that, but a merchant/DealDash/system cancel tells them.
    // Money notices (amount kept) go out either way; refund notices follow when the provider confirms.
    return this.notifications.emit(tx, [
      ...(by === 'CUSTOMER' ? [] : [this.notice('RESERVATION_CANCELLED', row, 'cancelled')]),
      ...moneyNotices,
    ]);
  }

  /**
   * Every held (or awaiting payment) reservation of a deal is cancelled (campaign cancelled by the merchant or DealDash). Paid ones are
   * refunded in full (RC-42); the refunds are sent to the provider by the next sweep (this runs inside the caller's transaction).
   */
  async cancelAllHeld(
    tx: Tx,
    dealId: string,
    by: CancelledBy,
    actor: Actor | null,
    reason: string,
    meta: RequestMeta | null,
    now = new Date(),
  ) {
    const held = await tx.reservation.findMany({
      where: { dealId, status: { in: [...LIVE_STATUSES] } },
      include: RES_INCLUDE,
    });
    const sent: Array<NotificationInput & { id: string }> = [];
    for (const r of held)
      sent.push(...(await this.cancelInTx(tx, r, by, actor, reason, meta, now)));
    return sent;
  }

  // ================================================================ expiry + notices (sweep)
  /** Expires one overdue hold in the caller's transaction. Returns true when it was this call that expired it. */
  private async expireInTx(
    tx: Tx,
    r: ResRow,
    now: Date,
    post?: PostCommit[],
  ): Promise<Array<NotificationInput & { id: string }> | null> {
    const res = await tx.reservation.updateMany({
      where: { id: r.id, status: 'HELD', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', noShowCounted: true },
    });
    if (res.count !== 1) return null;
    await this.giveBackStock(tx, r);
    await tx.reservationEvent.create({
      data: {
        reservationId: r.id,
        type: 'EXPIRED',
        fromStatus: 'HELD',
        toStatus: 'EXPIRED',
        actorRole: 'SYSTEM',
      },
    });
    await tx.reservationEvent.create({
      data: { reservationId: r.id, type: 'NO_SHOW_COUNTED', actorRole: 'SYSTEM' },
    });
    await this.event(tx, 'RESERVATION_EXPIRED', r);
    await this.syncAvailability(tx, r.dealId, now);
    // RC-50 / RC-51: a paid no-show keeps the deposit / the non-refundable share of a prepayment for the merchant
    const moneyNotices = await this.money.settleOnEnd(tx, r.id, 'NO_SHOW', now, post ?? []);
    return this.notifications.emit(tx, [
      this.notice('RESERVATION_EXPIRED', r, 'expired'),
      ...moneyNotices,
    ]);
  }

  /**
   * RC-31 / RC-33: a reservation whose payment window ended unpaid releases its units (no charge, no strike). The provider is asked
   * first: a payment completed a moment before the window ended confirms the reservation instead.
   */
  private async releaseUnpaid(r: ResRow, now: Date): Promise<boolean> {
    if ((await this.money.reconcileOpen(r.id)) === 'PAID') return false;
    const post: PostCommit[] = [];
    const sent = await this.prisma.$transaction(async (tx) => {
      const res = await tx.reservation.updateMany({
        where: { id: r.id, status: 'PENDING_PAYMENT', paymentDueAt: { lte: now } },
        data: { status: 'PAYMENT_FAILED' },
      });
      if (res.count !== 1) return null;
      await this.giveBackStock(tx, r);
      await this.money.markUnpaid(tx, r.id, now, post);
      await tx.reservationEvent.create({
        data: {
          reservationId: r.id,
          type: 'PAYMENT_FAILED',
          fromStatus: 'PENDING_PAYMENT',
          toStatus: 'PAYMENT_FAILED',
          actorRole: 'SYSTEM',
          note: 'payment window ended unpaid; units released',
        },
      });
      await this.core.audit.record(
        {
          action: 'reservation.payment_window_ended',
          entityType: 'Reservation',
          entityId: r.id,
          actorRole: 'SYSTEM',
          subjectOrganizationId: r.organizationId,
        },
        tx,
      );
      await this.syncAvailability(tx, r.dealId, now);
      return this.notifications.emit(tx, [
        {
          ...this.notice('RESERVATION_PAYMENT_FAILED', r, 'unpaid'),
          data: { ...this.notice('RESERVATION_PAYMENT_FAILED', r, 'unpaid').data, canRetry: false },
        },
      ]);
    });
    if (!sent) return false;
    await this.notifications.dispatch(sent);
    await this.runPost(post);
    return true;
  }

  async sweep(now = new Date()): Promise<{
    expired: number;
    notified: number;
    restrictions: number;
    unpaid: number;
    refundsSent: number;
  }> {
    let expired = 0;
    const users = new Set<string>();
    const due = await this.prisma.reservation.findMany({
      where: { status: 'HELD', expiresAt: { lte: now } },
      include: RES_INCLUDE,
      orderBy: { expiresAt: 'asc' },
      take: 500,
    });
    for (const r of due) {
      try {
        const post: PostCommit[] = [];
        const done = await this.prisma.$transaction((tx) => this.expireInTx(tx, r, now, post));
        if (done) {
          expired++;
          users.add(r.userId);
          await this.notifications.dispatch(done);
          await this.runPost(post);
        }
      } catch (e) {
        this.logger.warn(`Could not expire reservation ${r.id}: ${(e as Error).message}`);
      }
    }

    // Paid reservations whose payment window ended unpaid release their units (RC-33).
    let unpaid = 0;
    const unpaidDue = await this.prisma.reservation.findMany({
      where: { status: 'PENDING_PAYMENT', paymentDueAt: { lte: now } },
      include: RES_INCLUDE,
      orderBy: { paymentDueAt: 'asc' },
      take: 500,
    });
    for (const r of unpaidDue) {
      try {
        if (await this.releaseUnpaid(r, now)) unpaid++;
      } catch (e) {
        this.logger.warn(`Could not release unpaid reservation ${r.id}: ${(e as Error).message}`);
      }
    }
    // Refunds created inside other transactions (deal cancelled, lazy expiry) are sent to the provider here.
    const refundsSent = await this.money.sendUnsentRefunds();

    // "Expiring soon" notices, once per reservation.
    let notified = 0;
    const noticeMin = await this.core.expiringNoticeMinutes();
    const soon = await this.prisma.reservation.findMany({
      where: {
        status: 'HELD',
        expiringNoticeSentAt: null,
        expiresAt: { gt: now, lte: new Date(now.getTime() + noticeMin * MS_MINUTE) },
      },
      include: RES_INCLUDE,
      take: 500,
    });
    for (const r of soon) {
      // A hold shorter than the notice window would start "expiring" immediately: skip those.
      if (r.holdMinutes <= noticeMin) {
        await this.prisma.reservation.updateMany({
          where: { id: r.id },
          data: { expiringNoticeSentAt: now },
        });
        continue;
      }
      const sent = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.reservation.updateMany({
          where: { id: r.id, status: 'HELD', expiringNoticeSentAt: null },
          data: { expiringNoticeSentAt: now },
        });
        if (claimed.count !== 1) return [];
        await tx.reservationEvent.create({
          data: { reservationId: r.id, type: 'EXPIRING_NOTICE', actorRole: 'SYSTEM' },
        });
        return this.notifications.emit(tx, [this.notice('RESERVATION_EXPIRING', r, 'expiring')]);
      });
      await this.notifications.dispatch(sent);
      notified += sent.length;
    }

    // Restrictions that ran their course are closed; new ones are decided from confirmed no-shows.
    await this.prisma.customerRestriction.updateMany({
      where: { status: 'ACTIVE', endsAt: { lte: now } },
      data: { status: 'ENDED' },
    });
    let restrictions = 0;
    for (const userId of users) restrictions += (await this.applyStrikes(userId, now)) ? 1 : 0;
    if (expired || notified || restrictions || unpaid || refundsSent)
      this.logger.log(
        `Sweep: ${expired} expired, ${notified} notices, ${restrictions} restrictions, ${unpaid} unpaid released, ${refundsSent} refunds sent`,
      );
    return { expired, notified, restrictions, unpaid, refundsSent };
  }

  /**
   * No-show foundation: N confirmed no-shows (default 3) inside the window put a TEMPORARY restriction on new
   * reservations. Never a permanent ban; DealDash can review and lift it. Only no-shows after the previous restriction
   * started count, so a restricted customer starts fresh afterwards.
   */
  async applyStrikes(userId: string, now = new Date()): Promise<boolean> {
    const cfg = await this.core.noShow();
    const active = await this.prisma.customerRestriction.findFirst({
      where: { userId, status: 'ACTIVE', endsAt: { gt: now } },
    });
    if (active) return false;
    const last = await this.prisma.customerRestriction.findFirst({
      where: { userId },
      orderBy: { startsAt: 'desc' },
    });
    const windowStart = new Date(now.getTime() - cfg.windowDays * 86_400_000);
    const since = last && last.startsAt > windowStart ? last.startsAt : windowStart;
    const strikes = await this.prisma.reservation.count({
      where: { userId, status: 'EXPIRED', noShowCounted: true, expiresAt: { gt: since } },
    });
    if (strikes < cfg.threshold) return false;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.customerRestriction.create({
          data: {
            userId,
            reason: `${strikes} reservations not completed within ${cfg.windowDays} days`,
            strikes,
            endsAt: new Date(now.getTime() + cfg.blockDays * 86_400_000),
          },
        });
        await this.core.audit.record(
          {
            action: 'customer.restriction_applied',
            entityType: 'CustomerRestriction',
            entityId: userId,
            actorRole: 'SYSTEM',
            newState: { strikes, blockDays: cfg.blockDays },
          },
          tx,
        );
      });
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return false; // another sweep applied it first
      throw e;
    }
  }

  // ================================================================ views
  displayState(
    r: Pick<ResRow, 'status' | 'expiresAt' | 'cancelledBy'>,
    now: Date,
  ): ReservationView['displayState'] {
    if (r.status === 'REDEEMED') return 'REDEEMED';
    if (r.status === 'CANCELLED')
      return r.cancelledBy === 'CUSTOMER' ? 'CANCELLED_BY_YOU' : 'CANCELLED_BY_MERCHANT';
    if (r.status === 'PAYMENT_FAILED') return 'PAYMENT_FAILED';
    if (r.status === 'PENDING_PAYMENT')
      return r.expiresAt.getTime() <= now.getTime() ? 'PAYMENT_FAILED' : 'PAYMENT_PENDING';
    if (r.status === 'EXPIRED' || r.expiresAt.getTime() <= now.getTime()) return 'NOT_COMPLETED';
    return 'HELD';
  }

  /** Customer payment status of a paid reservation (RC-81); FREE reservations carry no payment block at all. */
  private paymentView(r: ResRow, now: Date): ReservationView['payment'] {
    if (r.commitmentMethod === 'FREE' || !r.amountMinor || !r.currency) return undefined;
    const attempt = r.payments[0] ?? null;
    const open =
      r.status === 'PENDING_PAYMENT' &&
      attempt &&
      (attempt.status === 'CREATED' || attempt.status === 'PENDING') &&
      (r.paymentDueAt?.getTime() ?? 0) > now.getTime();
    return {
      method: r.commitmentMethod as NonNullable<ReservationView['payment']>['method'],
      status: r.paymentStatus,
      amountMinor: r.amountMinor * r.quantity,
      currency: r.currency,
      dueAt: r.status === 'PENDING_PAYMENT' ? (r.paymentDueAt?.toISOString() ?? null) : null,
      redirectUrl: open ? (attempt.redirectUrl ?? null) : null,
      canRetry:
        r.status === 'PENDING_PAYMENT' &&
        !open &&
        (r.paymentDueAt?.getTime() ?? 0) > now.getTime() &&
        (attempt?.attemptNo ?? 0) < MAX_PAYMENT_ATTEMPTS,
      cancelCutoffAt: r.cancelCutoffAt?.toISOString() ?? null,
      depositRefundable: r.depositRefundable,
      noShowRefundPercent: r.noShowRefundPercent,
      keptMinor: r.keptMinor,
      refunds: r.refunds.map((f) => ({
        reference: f.reference,
        amountMinor: f.amountMinor,
        status: f.status,
        reasonCode: f.reasonCode,
        refundedAt: f.refundedAt?.toISOString() ?? null,
      })),
    };
  }

  async views(rows: ResRow[], now = new Date()): Promise<ReservationView[]> {
    const urls = await this.files.signedUrls(
      rows.map((r) => parseHotContent(r.deal.content).media[0]?.fileId),
    );
    return rows.map((r) => {
      const c = parseHotContent(r.deal.content);
      const state = this.displayState(r, now);
      const live = state === 'HELD';
      const first = c.media[0];
      const m = merchantDisplayName(r.deal.organization);
      const payment = this.paymentView(r, now);
      return {
        ...(payment ? { payment } : {}),
        id: r.id,
        publicRef: r.reference,
        status: r.status,
        displayState: state,
        quantity: r.quantity,
        holdMinutes: r.holdMinutes,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        redeemedAt: r.redeemedAt ? r.redeemedAt.toISOString() : null,
        cancelledAt: r.cancelledAt ? r.cancelledAt.toISOString() : null,
        cancelledBy: r.cancelledBy,
        serverNow: now.toISOString(),
        canCancel: live || state === 'PAYMENT_PENDING',
        deal: {
          id: r.dealId,
          title: c.title,
          offerLabel: c.offerLabel,
          imageUrl: first ? (urls.get(first.fileId) ?? null) : null,
          merchantName: m,
          merchantId: r.organizationId,
        },
        branch: {
          id: r.branch.id,
          name: { en: r.branch.nameEn, ar: r.branch.nameAr },
          address: { en: r.branch.addressEn, ar: r.branch.addressAr },
          latitude: r.branch.latitude === null ? null : Number(r.branch.latitude),
          longitude: r.branch.longitude === null ? null : Number(r.branch.longitude),
          phone: r.branch.phone ?? null,
        },
        code: live ? { qr: qrText(r.qrToken), manual: formatManualCode(r.manualCode) } : null,
      };
    });
  }

  // ================================================================ customer reads
  async listMine(
    userId: string,
    tab: 'active' | 'past',
    limit: number,
    now = new Date(),
  ): Promise<ReservationView[]> {
    const rows = await this.prisma.reservation.findMany({
      where:
        tab === 'active'
          ? { userId, status: { in: [...LIVE_STATUSES] }, expiresAt: { gt: now } }
          : { userId, NOT: { status: { in: [...LIVE_STATUSES] }, expiresAt: { gt: now } } },
      include: RES_INCLUDE,
      orderBy: tab === 'active' ? { expiresAt: 'asc' } : { createdAt: 'desc' },
      take: limit,
    });
    return this.views(rows, now);
  }

  async getMine(userId: string, id: string, now = new Date()): Promise<ReservationView> {
    const row = await this.prisma.reservation.findFirst({
      where: { id, userId },
      include: RES_INCLUDE,
    });
    if (!row) throw AppError.notFound();
    return (await this.views([row], now))[0]!;
  }

  /** Brief view for the deal detail ("you already hold this"). */
  async mineForDeal(
    userId: string,
    dealId: string,
    now = new Date(),
  ): Promise<MyReservationBrief[]> {
    const rows = await this.prisma.reservation.findMany({
      where: { userId, dealId, status: { in: [...LIVE_STATUSES] }, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status as ReservationStatus,
      quantity: r.quantity,
      branchId: r.branchId,
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  // ================================================================ merchant / admin reads
  private async firstNames(userIds: string[]) {
    const out = new Map<string, string>();
    if (!userIds.length) return out;
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, displayName: true, customer: { select: { firstName: true } } },
    });
    for (const u of users)
      out.set(u.id, (u.customer?.firstName || u.displayName.split(' ')[0] || '').trim());
    return out;
  }

  async listForDeal(
    organizationId: string,
    dealId: string,
    q: {
      limit: number;
      cursor?: string;
      status?: ReservationStatus;
      branchId?: string;
      q?: string;
    },
    capabilities: { canCancel: boolean; canReverse: boolean },
    now = new Date(),
  ) {
    const where: Prisma.ReservationWhereInput = {
      dealId,
      organizationId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.q ? { manualCode: { endsWith: q.q.toUpperCase().replace(/[^A-Z0-9]/g, '') } } : {}),
    };
    const page = await keysetPage({
      findMany: (query) =>
        this.prisma.reservation.findMany({ ...query, include: { branch: true, refunds: true } }),
      baseWhere: where as Record<string, unknown>,
      sort: { field: 'createdAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const names = await this.firstNames(page.items.map((r) => r.userId));
    return new Page(
      page.items.map((r) => ({
        id: r.id,
        codeLast4: r.manualCode.slice(-4),
        customerFirstName: names.get(r.userId) || null,
        quantity: r.quantity,
        branch: { en: r.branch.nameEn, ar: r.branch.nameAr },
        status: r.status,
        cancelledBy: r.cancelledBy,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        redeemedAt: r.redeemedAt ? r.redeemedAt.toISOString() : null,
        canCancel:
          capabilities.canCancel &&
          (r.status === 'HELD' || r.status === 'PENDING_PAYMENT') &&
          r.expiresAt.getTime() > now.getTime(),
        canReverse: capabilities.canReverse && r.status === 'REDEEMED',
        // RC-80: the merchant's financial view of a paid reservation (FREE reservations carry none)
        ...(r.commitmentMethod !== 'FREE' && r.amountMinor && r.currency
          ? {
              money: {
                method: r.commitmentMethod,
                paymentStatus: r.paymentStatus,
                amountMinor: r.amountMinor * r.quantity,
                currency: r.currency,
                refundedMinor: r.refunds
                  .filter((f) => f.status === 'REFUNDED')
                  .reduce((n, f) => n + f.amountMinor, 0),
                refundPendingMinor: r.refunds
                  .filter((f) => f.status === 'PROCESSING' || f.status === 'FAILED')
                  .reduce((n, f) => n + f.amountMinor, 0),
                keptMinor: r.keptMinor,
                feeMinor: r.feeMinor,
                netToMerchantMinor: r.keptMinor === null ? null : r.keptMinor - (r.feeMinor ?? 0),
              },
            }
          : {}),
      })),
      page.nextCursor,
    );
  }

  // ================================================================ stock changes by the merchant (live deals)
  /**
   * Add stock or take unreserved stock back. Removing is limited to units still available: reserved and redeemed
   * units are committed and can never be reduced (INVENTORY_BELOW_COMMITTED).
   */
  async adjustStock(
    actor: Actor,
    deal: { id: string; organizationId: string; status: string; content: unknown },
    branchId: string,
    delta: number,
    reason: string | undefined,
    maxUnits: number,
    meta: RequestMeta,
    now = new Date(),
  ) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.hotDealInventory.findUnique({
        where: { dealId_branchId: { dealId: deal.id, branchId } },
      });
      if (!inv || !inv.tracked) throw AppError.notFound();
      if (delta > 0 && inv.total + delta > maxUnits)
        throw AppError.validation(`A branch can hold at most ${maxUnits} units`, 'delta');
      const rows =
        delta > 0
          ? await tx.$queryRaw<Array<{ total: number }>>`
              UPDATE "HotDealInventory" SET "total" = "total" + ${delta}, "available" = "available" + ${delta}, "updatedAt" = now()
               WHERE "dealId" = ${deal.id}::uuid AND "branchId" = ${branchId}::uuid AND "tracked"
               RETURNING "total"`
          : await tx.$queryRaw<Array<{ total: number }>>`
              UPDATE "HotDealInventory" SET "total" = "total" + ${delta}, "available" = "available" + ${delta}, "updatedAt" = now()
               WHERE "dealId" = ${deal.id}::uuid AND "branchId" = ${branchId}::uuid AND "tracked" AND "available" >= ${-delta}
               RETURNING "total"`;
      if (!rows[0])
        throw new AppError(
          'INVENTORY_BELOW_COMMITTED',
          'Reserved and used units cannot be removed. You can remove only units that are still available.',
          409,
          'delta',
        );
      const content = parseHotContent(deal.content);
      const next: HotDealContent = {
        ...content,
        allocations: content.allocations.map((a) =>
          a.branchId === branchId ? { ...a, units: rows[0]!.total } : a,
        ),
      };
      await tx.hotDeal.update({
        where: { id: deal.id },
        data: { content: next as unknown as Prisma.InputJsonValue },
      });
      await this.core.record(tx, deal as { id: string; organizationId: string }, {
        action: 'STOCK_CHANGED',
        actor,
        reason: reason ?? null,
        fields: ['allocations'],
        snapshot: { branchId, delta, total: rows[0].total },
        meta,
      });
      await this.syncAvailability(tx, deal.id, now);
      return rows[0].total;
    });
  }
}
