import { nextMidnightIn, startOfDayIn } from '@dealdash/localization';
import { MarketService } from '../platform/markets/market.service';
import { randomInt } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import type { RedemptionResult } from '@dealdash/types';
import type { StaffReservationSummary } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import { EligibilityService, evaluateEligibility } from '../live-deals/eligibility.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { codeHint, parseCode, parseHotContent } from './hot-content';
import { UsageService } from '../subscription/usage.service';
import { RestrictionCheckService } from '../operations/restriction-check.service';
import { LoyaltyIssuanceService } from '../loyalty/loyalty-issuance.service';
import { HotCoreService } from './hot-core.service';
import { NotificationsService, type NotificationInput } from './notifications.service';
import {
  ReservationPaymentsService,
  policyOf,
  type PostCommit,
} from './reservation-payments.service';
import { ReservationsService } from './reservations.service';

const RES_INCLUDE = {
  deal: {
    include: {
      organization: { include: { merchant: true } },
      ruleSet: { include: { conditions: true } },
    },
  },
  branch: true,
  redemption: { where: { status: 'REDEEMED' as const } },
  // reservation commitment (staff see the money state, read-only)
  refunds: { where: { status: 'REFUNDED' as const }, select: { amountMinor: true } },
  authorisations: { orderBy: { attemptNo: 'desc' as const }, take: 1, select: { status: true } },
} satisfies Prisma.ReservationInclude;
type Row = Prisma.ReservationGetPayload<{ include: typeof RES_INCLUDE }>;

export interface StaffScope {
  organizationId: string;
  /** The branch this staff member is limited to; null means every branch of the merchant. */
  branchId: string | null;
}

/**
 * Stage 5: another redeemable product (vouchers) plugs into the same Staff validation and redemption flow. The staff member does
 * the same thing for every code; the extension decides whether the code is its own (returns null when it is not).
 */
export interface StaffCodeExtension {
  validate(
    actor: Actor,
    scope: StaffScope,
    input: { code: string; source: 'QR' | 'MANUAL' },
    branchOverride: string | null,
    now: Date,
  ): Promise<{
    result: RedemptionResult;
    reservation: StaffReservationSummary | null;
    serverNow: string;
  } | null>;
  redeem(
    actor: Actor,
    scope: StaffScope,
    input: { code: string; source: 'QR' | 'MANUAL' },
    idempotencyKey: string | null,
    branchOverride: string | null,
    meta: RequestMeta,
    now: Date,
  ): Promise<{
    result: RedemptionResult;
    reference: string | null;
    redeemedAt: string | null;
    reservation: StaffReservationSummary | null;
    serverNow: string;
  } | null>;
  historyDetails(
    instanceIds: string[],
    organizationId: string,
  ): Promise<
    Map<
      string,
      {
        reference: string;
        title: { en: string; ar: string };
        quantity: number;
        customerFirstName: string | null;
      }
    >
  >;
}

const redemptionRef = () => {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[randomInt(a.length)];
  return `RD-${s}`;
};

/**
 * Staff validation and redemption. ONE adaptive result: VALID, REDEEMED, or exactly one reason it cannot be redeemed.
 * Safety properties (all enforced here and in the database, never by the app):
 *  - a redemption is one conditional update on `status = 'HELD' AND expiresAt > now`, so double taps, duplicate scans,
 *    QR replays and concurrent staff devices produce exactly ONE success; every other attempt sees ALREADY_REDEEMED;
 *  - a partial unique index allows one active Redemption per reservation even if the application were bypassed;
 *  - a codes from another merchant look exactly like an unknown code (the other merchant's data is never revealed);
 *  - failed attempts are logged (append-only) and rate limited, so codes cannot be guessed at the counter;
 *  - staff cannot reverse: reversal is a separate permission held by merchant managers and DealDash.
 */
@Injectable()
export class RedemptionService {
  constructor(
    private readonly core: HotCoreService,
    private readonly reservations: ReservationsService,
    private readonly eligibility: EligibilityService,
    private readonly notifications: NotificationsService,
    private readonly config: SystemConfigService,
    private readonly money: ReservationPaymentsService,
    @Optional() private readonly loyalty?: LoyaltyIssuanceService,
    @Optional() private readonly usage?: UsageService,
    @Optional() private readonly restrictions?: RestrictionCheckService,
    @Optional() private readonly markets?: MarketService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  /** Other redeemable products (Stage 5 vouchers; Watch & Earn prizes, FDR-19). The first that claims a code handles it. */
  private extensions: StaffCodeExtension[] = [];
  /** Called once by each product module at startup. */
  registerExtension(ext: StaffCodeExtension) {
    if (!this.extensions.includes(ext)) this.extensions.push(ext);
  }

  // ================================================================ scope
  scopeOf(actor: Actor): StaffScope {
    const m = actor.membership;
    if (!m || m.organizationType !== 'MERCHANT' || m.roleCode !== 'MERCHANT_STAFF')
      throw AppError.forbidden();
    return { organizationId: m.organizationId, branchId: m.branchId };
  }

  async me(actor: Actor) {
    const scope = this.scopeOf(actor);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: scope.organizationId },
      include: { merchant: true },
    });
    const branches = await this.prisma.merchantBranch.findMany({
      where: {
        organizationId: scope.organizationId,
        ...(scope.branchId ? { id: scope.branchId } : {}),
      },
      orderBy: { nameEn: 'asc' },
    });
    const own = scope.branchId ? branches.find((b) => b.id === scope.branchId) : null;
    return {
      displayName: actor.displayName,
      merchantName: merchantDisplayName(org),
      branch: own ? { en: own.nameEn, ar: own.nameAr } : null,
      branches: branches
        .filter((b) => b.status === 'ACTIVE')
        .map((b) => ({
          membershipId: actor.membership!.id,
          branchId: b.id,
          name: { en: b.nameEn, ar: b.nameAr },
        })),
      canRedeem: actor.permissions.has('merchant.redemptions.perform'),
      historyDays: await this.config.getNumber(CONFIG_KEYS.STAFF_HISTORY_DAYS, 2),
    };
  }

  // ================================================================ assessment (pure reading)
  private async lookup(
    parsed: NonNullable<ReturnType<typeof parseCode>>,
    db: Prisma.TransactionClient | typeof this.prisma,
  ): Promise<Row | null> {
    return db.reservation.findFirst({
      where: parsed.kind === 'QR' ? { qrToken: parsed.value } : { manualCode: parsed.value },
      include: RES_INCLUDE,
    });
  }

  private async requirementText(row: Row, now: Date) {
    const kind = row.deal.eligibilityKind;
    const en: Record<string, string> = {
      EMPLOYER: 'Offer for verified employees of a partner company',
      BANK_CARD: 'Offer for customers with a participating bank benefit',
      SCHEME: 'Offer for members of a participating scheme',
      GEOGRAPHY: 'Offer for customers in a specific area',
    };
    const ar: Record<string, string> = {
      EMPLOYER: 'عرض لموظفي شركة شريكة بعد التحقق',
      BANK_CARD: 'عرض لحاملي مزايا بنك مشارك',
      SCHEME: 'عرض لأعضاء برنامج مشارك',
      GEOGRAPHY: 'عرض لعملاء منطقة محددة',
    };
    void now;
    return { en: en[kind] ?? 'Eligibility requirement', ar: ar[kind] ?? 'شرط الأهلية' };
  }

  /** The single rule order for every code (the validation result matrix). */
  private async assess(
    row: Row | null,
    scope: StaffScope,
    branchOverride: string | null,
    now: Date,
  ): Promise<RedemptionResult> {
    // A code of another merchant is indistinguishable from an unknown code.
    if (!row || row.organizationId !== scope.organizationId) return 'INVALID_CODE';
    const wanted = scope.branchId ?? branchOverride;
    if (wanted && wanted !== row.branchId) return 'WRONG_BRANCH';
    if (row.status === 'REDEEMED') return 'ALREADY_REDEEMED';
    if (row.status === 'CANCELLED') return 'NOT_ACTIVE';
    if (row.status === 'EXPIRED' || row.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
    // Campaign not started yet (scheduled, or its start time is still ahead): recoverable, not a hard failure.
    if (
      row.deal.status === 'SCHEDULED' ||
      (row.deal.startAt && row.deal.startAt.getTime() > now.getTime())
    )
      return 'NOT_VALID_YET';
    // A held reservation stays valid if the campaign merely reached its end; paused/suspended/cancelled campaigns do not honour it.
    if (!['LIVE', 'SOLD_OUT', 'EXPIRED'].includes(row.deal.status)) return 'CAMPAIGN_UNAVAILABLE';
    if (row.deal.organization.status !== 'ACTIVE') return 'CAMPAIGN_UNAVAILABLE';
    if (await this.config.getBoolean(CONFIG_KEYS.REDEMPTION_RECHECK_ELIGIBILITY, true)) {
      const ctx = await this.eligibility.contextFor(row.userId, row.branch.city, now);
      const outcome = evaluateEligibility(
        row.deal.eligibilityKind,
        (row.deal.ruleSet?.conditions ?? []).map((c) => ({
          attrType: c.attrType,
          valueRef: c.valueRef,
          requiredLevel: c.requiredLevel,
        })),
        ctx,
        row.deal.ruleSet?.expression,
      );
      if (outcome.result !== 'ELIGIBLE') return 'INELIGIBLE';
    }
    return 'VALID';
  }

  private async firstName(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, customer: { select: { firstName: true } } },
    });
    return (u?.customer?.firstName || u?.displayName.split(' ')[0] || '').trim() || null;
  }

  private async summary(
    row: Row | null,
    result: RedemptionResult,
    scope: StaffScope,
    now: Date,
  ): Promise<StaffReservationSummary | null> {
    if (!row || row.organizationId !== scope.organizationId) return null;
    const c = parseHotContent(row.deal.content);
    const redeemed = row.redemption[0];
    let redeemedBranch: { en: string; ar: string } | null = null;
    if (redeemed) {
      const b = await this.prisma.merchantBranch.findUnique({ where: { id: redeemed.branchId } });
      if (b) redeemedBranch = { en: b.nameEn, ar: b.nameAr };
    }
    return {
      kind: 'RESERVATION' as const,
      faceValueHalalas: null,
      // RC-60: paid in full / deposit to credit / card hold — what the customer already paid or holds (staff cannot change it)
      money:
        row.commitmentMethod !== 'FREE' && row.amountMinor && row.currency
          ? {
              method: row.commitmentMethod,
              paymentStatus: row.paymentStatus,
              amountMinor: row.amountMinor * row.quantity,
              currency: row.currency,
              depositRefundable: row.depositRefundable,
              // staff credit the deposit to the bill unless it is a booking fee (2026-10-16)
              depositCredited:
                row.commitmentMethod === 'DEPOSIT' ? row.depositCredited !== false : null,
              holdStatus: row.authorisations[0]?.status ?? null,
              refundedMinor: row.refunds.reduce((n, f) => n + f.amountMinor, 0),
              keptMinor: row.keptMinor,
            }
          : null,
      ref: row.reference,
      quantity: row.quantity,
      dealTitle: c.title,
      offerLabel: c.offerLabel,
      merchantName: merchantDisplayName(row.deal.organization),
      branchName: { en: row.branch.nameEn, ar: row.branch.nameAr },
      customerFirstName: await this.firstName(row.userId),
      expiresAt: row.expiresAt.toISOString(),
      startsAt: row.deal.startAt ? row.deal.startAt.toISOString() : null,
      redeemedAt: row.redeemedAt ? row.redeemedAt.toISOString() : null,
      redeemedBranchName: redeemedBranch,
      validBranchName:
        result === 'WRONG_BRANCH' ? { en: row.branch.nameEn, ar: row.branch.nameAr } : null,
      requirement: result === 'INELIGIBLE' ? await this.requirementText(row, now) : null,
    };
  }

  // ================================================================ rate limit + attempt log
  private async guardRate(actor: Actor, scope: StaffScope, now: Date) {
    const limit = await this.config.getNumber(CONFIG_KEYS.REDEMPTION_MANUAL_PER_MINUTE, 5);
    const bad = await this.prisma.redemptionAttempt.count({
      where: {
        staffUserId: actor.userId,
        organizationId: scope.organizationId,
        result: 'INVALID_CODE',
        createdAt: { gt: new Date(now.getTime() - 60_000) },
      },
    });
    if (bad >= limit)
      throw AppError.rateLimited(
        'RATE_LIMITED',
        'Too many codes that did not match. Wait a minute and try again.',
      );
  }

  private async logAttempt(
    actor: Actor,
    scope: StaffScope,
    input: { code: string; source: 'QR' | 'MANUAL' },
    kind: 'VALIDATE' | 'REDEEM',
    result: RedemptionResult,
    row: Row | null,
    idempotencyKey: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    await (tx ?? this.prisma).redemptionAttempt.create({
      data: {
        staffUserId: actor.userId,
        organizationId: scope.organizationId,
        branchId: scope.branchId ?? row?.branchId ?? null,
        reservationId: row && row.organizationId === scope.organizationId ? row.id : null,
        codeHint: codeHint(input.code),
        source: input.source,
        kind,
        result,
        idempotencyKey,
      },
    });
  }

  // ================================================================ validate
  async validate(
    actor: Actor,
    input: { code: string; source: 'QR' | 'MANUAL' },
    branchId: string | null,
    now = new Date(),
  ) {
    const scope = this.scopeOf(actor);
    await this.guardRate(actor, scope, now);
    for (const ext of this.extensions) {
      const other = await ext.validate(actor, scope, input, branchId, now);
      if (other) return other;
    }
    const parsed = parseCode(input.code);
    const row = parsed ? await this.lookup(parsed, this.prisma) : null;
    const result = await this.assess(row, scope, branchId, now);
    await this.logAttempt(actor, scope, input, 'VALIDATE', result, row, null);
    return {
      result,
      reservation: await this.summary(row, result, scope, now),
      serverNow: now.toISOString(),
    };
  }

  // ================================================================ redeem
  async redeem(
    actor: Actor,
    input: { code: string; source: 'QR' | 'MANUAL' },
    idempotencyKey: string | null,
    branchId: string | null,
    meta: RequestMeta,
    now = new Date(),
  ) {
    const scope = this.scopeOf(actor);
    if (!actor.permissions.has('merchant.redemptions.perform')) throw AppError.forbidden();
    await this.guardRate(actor, scope, now);
    for (const ext of this.extensions) {
      const other = await ext.redeem(actor, scope, input, idempotencyKey, branchId, meta, now);
      if (other) return other;
    }
    const parsed = parseCode(input.code);

    // Same staff member, same key: the same success again (a retried request after a bad connection).
    if (idempotencyKey) {
      const prior = await this.prisma.redemption.findFirst({
        where: { staffUserId: actor.userId, idempotencyKey },
      });
      if (prior) {
        const row = await this.prisma.reservation.findUnique({
          where: { id: prior.reservationId },
          include: RES_INCLUDE,
        });
        return {
          result: 'REDEEMED' as const,
          reference: prior.reference,
          redeemedAt: prior.redeemedAt.toISOString(),
          reservation: await this.summary(row, 'REDEEMED', scope, now),
          serverNow: now.toISOString(),
        };
      }
    }

    let row = parsed ? await this.lookup(parsed, this.prisma) : null;
    let result = await this.assess(row, scope, branchId, now);
    let reference: string | null = null;
    let redeemedAt: Date | null = null;
    // Stage 8: a governed branch redemption hold pauses redemption here; the customer keeps the reservation
    if (result === 'VALID' && row)
      await this.restrictions?.assertBranchRedemptionOpen(row.branchId);

    if (result === 'VALID' && row) {
      const target = row;
      // card hold captures / releases decided at redemption go to the provider after commit (phase 3)
      const redeemPost: PostCommit[] = [];
      const outcome = await this.prisma.$transaction(async (tx) => {
        // The one decisive step: only one caller can move HELD -> REDEEMED.
        const claimed = await tx.reservation.updateMany({
          where: { id: target.id, status: 'HELD', expiresAt: { gt: now } },
          data: { status: 'REDEEMED', redeemedAt: now },
        });
        if (claimed.count !== 1) return { won: false as const };
        const moved = await tx.$executeRaw`
          UPDATE "HotDealInventory"
             SET "reserved" = "reserved" - ${target.quantity}, "redeemed" = "redeemed" + ${target.quantity}, "updatedAt" = now()
           WHERE "dealId" = ${target.dealId}::uuid AND "branchId" = ${target.branchId}::uuid AND "reserved" >= ${target.quantity}`;
        if (moved !== 1) throw new AppError('INVALID_STATE', 'Stock could not be updated', 409);
        const created = await tx.redemption.create({
          data: {
            campaignVersion: await this.core.versions.current(tx, 'EXCLUSIVE', target.dealId),
            reservationId: target.id,
            dealId: target.dealId,
            branchId: target.branchId,
            organizationId: target.organizationId,
            staffUserId: actor.userId,
            source: input.source,
            reference: redemptionRef(),
            idempotencyKey,
            redeemedAt: now,
          },
        });
        // RC-73 / RC-74: one customer transaction, one DealDash fee. A PAID reservation already pays DealDash its reservation
        // commission, so the Exclusive Deal per-redemption fee is NOT charged as well, unless the merchant's agreement explicitly
        // allows it (snapshotted on the reservation). FREE / walk-in deals keep the per-redemption fee unchanged.
        // phase 3: a card hold captured at redemption earns the commission too; a hold RELEASED at redemption earns none, so the
        // per-redemption fee is then the one DealDash fee (never both, never neither by accident)
        const paidReservation =
          target.commitmentMethod !== 'FREE' &&
          (target.paymentStatus === 'PAID' ||
            (target.paymentStatus === 'AUTHORISED' &&
              policyOf(target).preauthOnRedemption === 'CAPTURE'));
        const chargeRedemptionFee = !paidReservation || target.additionalFeeAllowed;
        // a VERIFIED redemption is the financial trigger: it draws down the funding commitments (idempotent per redemption);
        // sponsor funding is always drawn, the DealDash per-redemption CHARGE only when it applies
        const util = await this.core.commercial.recordUtilization(
          'EXCLUSIVE',
          target.dealId,
          {
            sourceType: 'REDEMPTION',
            sourceId: created.id,
            units: target.quantity,
            skipCharges: !chargeRedemptionFee,
          },
          tx,
        );
        // the usage fact always (plan limits count redemptions); the billing event only when the per-redemption fee applies
        await this.usage?.recordBillable(
          {
            organizationId: target.organizationId,
            metric: 'verified_redemptions',
            eventType: 'VERIFIED_REDEMPTION_USAGE',
            sourceType: 'REDEMPTION',
            sourceId: created.id,
            product: 'EXCLUSIVE',
            campaignId: target.dealId,
            quantity: target.quantity,
            pricingVersionKey: await this.usage.campaignPricingKey('EXCLUSIVE', target.dealId, tx),
            occurredAt: now,
            billable: chargeRedemptionFee,
          },
          tx,
        );
        if (paidReservation) {
          await tx.reservation.update({
            where: { id: target.id },
            data: { redemptionFeeMinor: chargeRedemptionFee ? util.chargeApplied : 0 },
          });
          await this.core.audit.record(
            {
              action: chargeRedemptionFee
                ? 'reservation.additional_fee_applied'
                : 'reservation.redemption_fee_not_charged',
              entityType: 'Reservation',
              entityId: target.id,
              actor,
              subjectOrganizationId: target.organizationId,
              reason: chargeRedemptionFee
                ? 'Merchant agreement explicitly allows the per-redemption fee in addition to the reservation commission (RC-74)'
                : 'Paid reservation: the reservation commission is the only DealDash fee (RC-73)',
              newState: {
                redemptionId: created.id,
                redemptionFeeMinor: chargeRedemptionFee ? util.chargeApplied : 0,
              },
              meta,
            },
            tx,
          );
        }
        await this.loyalty?.issueForEvent(tx, {
          eventType: 'EXCLUSIVE_REDEMPTION',
          userId: target.userId,
          product: 'EXCLUSIVE',
          campaignId: target.dealId,
          organizationId: target.organizationId,
          sourceType: 'REDEMPTION',
          sourceId: created.id,
          now,
        });
        await tx.reservationEvent.create({
          data: {
            reservationId: target.id,
            type: 'REDEEMED',
            fromStatus: 'HELD',
            toStatus: 'REDEEMED',
            actorUserId: actor.userId,
            actorRole: actor.membership?.roleCode ?? null,
            note: input.source,
          },
        });
        // RC-61: a paid reservation's amount is used / credited to the bill: kept for the merchant, net of the agreed commission
        await this.money.settleOnEnd(tx, target.id, 'REDEEMED', now, redeemPost, {
          redemptionId: created.id,
          actor,
        });
        await tx.dealEvent.create({
          data: {
            type: 'RESERVATION_REDEEMED',
            productType: 'HOT',
            dealId: target.dealId,
            merchantOrgId: target.organizationId,
            branchId: target.branchId,
            userId: target.userId,
            anonymousId: `user:${target.userId}`.slice(0, 64),
          },
        });
        await this.core.audit.record(
          {
            action: 'redemption.redeem',
            entityType: 'Redemption',
            entityId: created.id,
            actor,
            subjectOrganizationId: target.organizationId,
            newState: { reservationId: target.id, source: input.source },
            meta,
          },
          tx,
        );
        await this.logAttempt(
          actor,
          scope,
          input,
          'REDEEM',
          'REDEEMED',
          target,
          idempotencyKey,
          tx,
        );
        const c = parseHotContent(target.deal.content);
        const m = merchantDisplayName(target.deal.organization);
        const sent = await this.notifications.emit(tx, [
          {
            userId: target.userId,
            type: 'REDEMPTION_SUCCESS',
            dedupeKey: `reservation:${target.id}:redeemed`,
            data: {
              reservationId: target.id,
              dealId: target.dealId,
              dealTitleEn: c.title.en,
              dealTitleAr: c.title.ar,
              merchantNameEn: m.en,
              merchantNameAr: m.ar,
              branchNameEn: target.branch.nameEn,
              branchNameAr: target.branch.nameAr,
            },
          } satisfies NotificationInput,
        ]);
        return { won: true as const, created, sent };
      });
      if (outcome.won) {
        await this.notifications.dispatch(outcome.sent);
        for (const fn of redeemPost) await Promise.resolve(fn()).catch(() => undefined);
        reference = outcome.created.reference;
        redeemedAt = outcome.created.redeemedAt;
        result = 'REDEEMED';
        row = await this.prisma.reservation.findUnique({
          where: { id: target.id },
          include: RES_INCLUDE,
        });
      } else {
        // Lost the race (or the hold ran out in this very moment): report what is true now.
        row = await this.prisma.reservation.findUnique({
          where: { id: target.id },
          include: RES_INCLUDE,
        });
        result = await this.assess(row, scope, branchId, now);
        if (result === 'VALID') result = 'ALREADY_REDEEMED';
        await this.logAttempt(actor, scope, input, 'REDEEM', result, row, idempotencyKey);
      }
    } else {
      await this.logAttempt(actor, scope, input, 'REDEEM', result, row, idempotencyKey);
    }
    return {
      result,
      reference,
      redeemedAt: redeemedAt ? redeemedAt.toISOString() : null,
      reservation: await this.summary(row, result, scope, now),
      serverNow: now.toISOString(),
    };
  }

  // ================================================================ staff history
  /** `today` / `yesterday` as local calendar days in the staff member's branch market (else the business's market). */
  private async dayRange(
    day: 'today' | 'yesterday',
    now: Date,
    scope: { organizationId: string; branchId: string | null },
  ) {
    const branch = scope.branchId
      ? await this.prisma.merchantBranch.findUnique({
          where: { id: scope.branchId },
          select: { country: true },
        })
      : null;
    const tz = this.markets
      ? (branch?.country
          ? await this.markets.profile(branch.country)
          : await this.markets.profileOfOrganization(scope.organizationId)
        ).timezone
      : 'UTC';
    const today = startOfDayIn(now, tz);
    const start =
      day === 'yesterday' ? startOfDayIn(new Date(today.getTime() - 3_600_000), tz) : today;
    return { start, end: day === 'yesterday' ? today : nextMidnightIn(now, tz) };
  }

  async history(
    actor: Actor,
    q: {
      filter: 'all' | 'redeemed' | 'rejected';
      day: 'today' | 'yesterday';
      q?: string;
      limit: number;
    },
    now = new Date(),
  ) {
    const scope = this.scopeOf(actor);
    const { start, end } = await this.dayRange(q.day, now, scope);
    const base: Prisma.RedemptionAttemptWhereInput = {
      staffUserId: actor.userId,
      organizationId: scope.organizationId,
      createdAt: { gte: start, lt: end },
      // a scan that was valid is followed by its redeem attempt: show only redeem attempts and failed validations
      OR: [{ kind: 'REDEEM' }, { kind: 'VALIDATE', NOT: { result: 'VALID' } }],
    };
    const [redeemed, rejected] = await Promise.all([
      this.prisma.redemptionAttempt.count({ where: { ...base, result: 'REDEEMED' } }),
      this.prisma.redemptionAttempt.count({ where: { ...base, NOT: { result: 'REDEEMED' } } }),
    ]);
    const filter: Prisma.RedemptionAttemptWhereInput =
      q.filter === 'redeemed'
        ? { result: 'REDEEMED' }
        : q.filter === 'rejected'
          ? { NOT: { result: 'REDEEMED' } }
          : {};
    const rows = await this.prisma.redemptionAttempt.findMany({
      where: {
        AND: [
          base,
          filter,
          q.q ? { codeHint: { contains: q.q.replace(/[^A-Za-z0-9]/g, '') } } : {},
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    const ids = rows.map((r) => r.reservationId).filter((x): x is string => !!x);
    const res = ids.length
      ? await this.prisma.reservation.findMany({
          where: { id: { in: ids }, organizationId: scope.organizationId },
          select: {
            id: true,
            reference: true,
            quantity: true,
            userId: true,
            deal: { select: { content: true } },
          },
        })
      : [];
    const byId = new Map(res.map((r) => [r.id, r]));
    const names = new Map<string, string | null>();
    for (const r of res)
      if (!names.has(r.userId)) names.set(r.userId, await this.firstName(r.userId));
    // Stage 5: attempts that concerned a voucher (same history, same rows)
    const voucherIds = rows.map((r) => r.voucherInstanceId).filter((x): x is string => !!x);
    // every product extension contributes the rows it recognises (only vouchers are linked to attempts today)
    const vouchers = new Map<
      string,
      Awaited<ReturnType<StaffCodeExtension['historyDetails']>> extends Map<string, infer V>
        ? V
        : never
    >();
    for (const ext of this.extensions)
      for (const [k, v] of await ext.historyDetails(voucherIds, scope.organizationId))
        vouchers.set(k, v);
    return {
      counts: { redeemed, rejected },
      items: rows.map((a) => {
        const r = a.reservationId ? byId.get(a.reservationId) : undefined;
        const v = a.voucherInstanceId ? vouchers.get(a.voucherInstanceId) : undefined;
        return {
          id: a.id,
          result: a.result,
          at: a.createdAt.toISOString(),
          reference: v?.reference ?? r?.reference ?? null,
          dealTitle: v ? v.title : r ? parseHotContent(r.deal.content).title : null,
          quantity: v?.quantity ?? r?.quantity ?? null,
          customerFirstName: v ? v.customerFirstName : r ? (names.get(r.userId) ?? null) : null,
          source: a.source,
          kind: v ? ('VOUCHER' as const) : ('RESERVATION' as const),
        };
      }),
    };
  }

  // ================================================================ merchant manager + DealDash: list and reverse
  async listForOrganization(
    organizationId: string,
    q: { limit: number; cursor?: string; dealId?: string; branchId?: string },
    canReverse: boolean,
    now = new Date(),
    allowedBranchIds: string[] | null = null,
  ) {
    const windowH = await this.config.getNumber(CONFIG_KEYS.REDEMPTION_REVERSAL_WINDOW_HOURS, 24);
    const page = await keysetPage({
      findMany: (query) =>
        this.prisma.redemption.findMany({
          ...query,
          include: { reservation: { include: { deal: true, branch: true } } },
        }),
      baseWhere: {
        organizationId,
        ...(q.dealId ? { dealId: q.dealId } : {}),
        ...(allowedBranchIds
          ? {
              branchId: q.branchId
                ? allowedBranchIds.includes(q.branchId)
                  ? q.branchId
                  : { in: [] as string[] }
                : { in: allowedBranchIds },
            }
          : q.branchId
            ? { branchId: q.branchId }
            : {}),
      },
      sort: { field: 'redeemedAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const staff = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(page.items.map((r) => r.staffUserId))] } },
      select: { id: true, displayName: true },
    });
    const sn = new Map(staff.map((s) => [s.id, s.displayName]));
    return new Page(
      page.items.map((r) => ({
        id: r.id,
        reference: r.reference,
        status: r.status,
        source: r.source,
        redeemedAt: r.redeemedAt.toISOString(),
        reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null,
        reverseReason: r.reverseReason,
        dealId: r.dealId,
        dealTitle: parseHotContent(r.reservation.deal.content).title,
        branch: { en: r.reservation.branch.nameEn, ar: r.reservation.branch.nameAr },
        quantity: r.reservation.quantity,
        staffName: sn.get(r.staffUserId) ?? '',
        canReverse:
          canReverse &&
          r.status === 'REDEEMED' &&
          now.getTime() - r.redeemedAt.getTime() <= windowH * 3_600_000,
      })),
      page.nextCursor,
    );
  }

  /**
   * Manager / DealDash reversal (staff cannot). Gives the customer a fresh hold, or cancels the reservation when the campaign
   * is cancelled. Only inside the configured window unless DealDash does it. Always audited with a reason.
   */
  async reverse(
    actor: Actor,
    redemptionId: string,
    reason: string,
    scope: { organizationId?: string; byDealDash: boolean },
    meta: RequestMeta,
    now = new Date(),
  ) {
    const red = await this.prisma.redemption.findFirst({
      where: {
        id: redemptionId,
        ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      },
      include: { reservation: { include: { deal: true } } },
    });
    if (!red) throw AppError.notFound();
    const windowH = await this.config.getNumber(CONFIG_KEYS.REDEMPTION_REVERSAL_WINDOW_HOURS, 24);
    if (red.status !== 'REDEEMED')
      throw new AppError('REVERSAL_NOT_ALLOWED', 'This redemption was already reversed.', 409);
    if (!scope.byDealDash && now.getTime() - red.redeemedAt.getTime() > windowH * 3_600_000)
      throw new AppError(
        'REVERSAL_NOT_ALLOWED',
        `A redemption can be reversed within ${windowH} hours. Contact DealDash support.`,
        409,
      );
    const q = red.reservation.quantity;
    const cancelled = red.reservation.deal.status === 'CANCELLED';
    const hold = await this.core.holdMinutes(red.reservation.deal);
    const post: PostCommit[] = [];
    const moneyNotices = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.redemption.updateMany({
        where: { id: red.id, status: 'REDEEMED' },
        data: {
          status: 'REVERSED',
          reversedAt: now,
          reversedByUserId: actor.userId,
          reverseReason: reason,
        },
      });
      if (claimed.count !== 1)
        throw new AppError('REVERSAL_NOT_ALLOWED', 'This redemption was already reversed.', 409);
      await this.core.commercial.reverseUtilization(
        'EXCLUSIVE',
        red.reservation.dealId,
        { sourceType: 'REDEMPTION', sourceId: red.id },
        tx,
      );
      await this.usage?.voidBillable('VERIFIED_REDEMPTION_USAGE', red.id, tx);
      await this.loyalty?.reverseForSource(tx, {
        sourceType: 'REDEMPTION',
        sourceId: red.id,
        reason: 'REDEMPTION_REVERSED',
        actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
      });
      const res = await tx.reservation.updateMany({
        where: { id: red.reservationId, status: 'REDEEMED' },
        data: cancelled
          ? {
              status: 'CANCELLED',
              cancelledAt: now,
              cancelledBy: scope.byDealDash ? 'DEALDASH' : 'MERCHANT',
              cancelReason: reason,
              redeemedAt: null,
            }
          : {
              status: 'HELD',
              redeemedAt: null,
              expiresAt: new Date(now.getTime() + hold * 60_000),
              expiringNoticeSentAt: null,
            },
      });
      if (res.count !== 1)
        throw new AppError('INVALID_STATE', 'The reservation changed. Reload and try again.', 409);
      const moved = cancelled
        ? await tx.$executeRaw`UPDATE "HotDealInventory" SET "redeemed" = "redeemed" - ${q}, "available" = "available" + ${q}, "released" = "released" + ${q}, "updatedAt" = now()
            WHERE "dealId" = ${red.dealId}::uuid AND "branchId" = ${red.branchId}::uuid AND "redeemed" >= ${q}`
        : await tx.$executeRaw`UPDATE "HotDealInventory" SET "redeemed" = "redeemed" - ${q}, "reserved" = "reserved" + ${q}, "updatedAt" = now()
            WHERE "dealId" = ${red.dealId}::uuid AND "branchId" = ${red.branchId}::uuid AND "redeemed" >= ${q}`;
      if (moved !== 1) throw new AppError('INVALID_STATE', 'Stock could not be updated', 409);
      await tx.reservationEvent.create({
        data: {
          reservationId: red.reservationId,
          type: 'REDEMPTION_REVERSED',
          fromStatus: 'REDEEMED',
          toStatus: cancelled ? 'CANCELLED' : 'HELD',
          actorUserId: actor.userId,
          actorRole: actor.membership?.roleCode ?? null,
          note: reason,
        },
      });
      await this.core.audit.record(
        {
          action: 'redemption.reverse',
          entityType: 'Redemption',
          entityId: red.id,
          reason,
          actor,
          subjectOrganizationId: red.organizationId,
          meta,
        },
        tx,
      );
      await this.reservations.syncAvailability(tx, red.dealId, now);
      // a paid reservation: the amount kept at redemption is held for the merchant again; a cancelled campaign refunds it in full
      await this.money.unsettleRedemption(tx, red.reservationId, red.id, actor);
      return cancelled
        ? this.notifications.emit(
            tx,
            await this.money.settleOnEnd(
              tx,
              red.reservationId,
              scope.byDealDash ? 'DEALDASH_CANCELLED' : 'MERCHANT_CANCELLED',
              now,
              post,
              { actor },
            ),
          )
        : [];
    });
    await this.notifications.dispatch(moneyNotices);
    for (const fn of post) await Promise.resolve(fn()).catch(() => undefined);
    return { id: red.id, status: 'REVERSED' as const };
  }
}
