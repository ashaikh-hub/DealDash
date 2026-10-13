import { Inject, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PAYOUT_PROVIDER, type PayoutProvider } from '../providers/interfaces';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { MarketConfigService } from '../platform/markets/market-config.service';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { LedgerService } from '../vouchers/ledger.service';
import { D, opsConfig, ref, requiresSecondPerson } from './ops-util';

const SETTLING_TYPES = ['ELIGIBLE', 'REDEMPTION_REVERSED', 'ADJUSTMENT'] as const;
const OPEN_FOR_PAYOUT = ['ELIGIBLE', 'PARTIALLY_PAID'];
type SettlementRow = Prisma.SettlementGetPayload<{ include: { payouts: true } }>;

/**
 * Stage 9 (B1): the latest instant at or before `at` whose wall-clock time in `timeZone` is `hhmm` (the settlement cut-off).
 * Uses the zone's real offset on that day, so it is correct for zones with or without daylight saving.
 */
export function latestCutoff(at: Date, hhmm: string, timeZone: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const offsetMs = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(d);
    const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return (
      Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) -
      Math.floor(d.getTime() / 1000) * 1000
    );
  };
  for (let back = 0; back <= 2; back++) {
    const local = new Date(at.getTime() + offsetMs(at) - back * 86_400_000);
    const candidateLocal = Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      h,
      m,
    );
    const candidate = new Date(candidateLocal - offsetMs(new Date(candidateLocal)));
    if (candidate.getTime() <= at.getTime()) return candidate;
  }
  return at;
}

/**
 * Merchant settlement operations. A run takes a business's settlement-eligible payable (append-only payable events: eligible
 * redemptions net of fee, reversals, adjustments) under the APPROVED settlement rule of its market (frequency, minimum, hold days,
 * dispute treatment come from the Market configuration; no cycle is invented here). Holds (financial hold, payout hold, open
 * disputes with a financial impact, unverified destination) stop the payout, never the record. Payouts are recorded (manual payout
 * in the MVP; a payout provider is VALIDATE-<market>) with a balanced ledger journal; a negative balance is carried forward once.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly markets: MarketService,
    private readonly marketConfig: MarketConfigService,
    private readonly ledger: LedgerService,
    @Optional() @Inject(PAYOUT_PROVIDER) private readonly payouts?: PayoutProvider,
  ) {}

  async view(s: SettlementRow) {
    const org = await this.prisma.organization.findUnique({
      where: { id: s.organizationId },
      select: { nameEn: true, nameAr: true },
    });
    const items = await this.prisma.settlementItem.groupBy({
      by: ['type'],
      where: { settlementId: s.id },
      _count: { _all: true },
    });
    return {
      id: s.id,
      reference: s.reference,
      organizationId: s.organizationId,
      merchantNameEn: org?.nameEn ?? null,
      merchantNameAr: org?.nameAr ?? null,
      legalEntityId: s.legalEntityId,
      market: s.market,
      currency: s.currency,
      product: s.product,
      status: s.status,
      periodFrom: s.periodFrom.toISOString(),
      periodTo: s.periodTo.toISOString(),
      grossMinor: s.grossMinor,
      feesMinor: s.feesMinor,
      taxMinor: s.taxMinor,
      adjustmentsMinor: s.adjustmentsMinor,
      carriedForwardMinor: s.carriedForwardMinor,
      payableMinor: s.payableMinor,
      paidMinor: s.paidMinor,
      outstandingMinor: Math.max(0, s.payableMinor - s.paidMinor),
      settlementDate: s.settlementDate?.toISOString() ?? null,
      destinationRef: s.destinationRef,
      reconciliationStatus: s.reconciliationStatus,
      holdReason: s.holdReason,
      failureReason: s.failureReason,
      carriedIntoId: s.carriedIntoId,
      // Stage 9 (B1 / B2)
      reserveMinor: s.reserveMinor,
      reserveReleaseAt: s.reserveReleaseAt?.toISOString() ?? null,
      reserveReleasedMinor: s.reserveReleasedMinor,
      payoutAttempts: s.payoutAttempts,
      items: Object.fromEntries(items.map((i) => [i.type, i._count._all])),
      payouts: s.payouts.map((p) => ({
        id: p.id,
        status: p.status,
        amountMinor: p.amountMinor,
        externalRef: p.externalRef,
        provider: p.provider,
        reason: p.reason,
        createdAt: p.createdAt.toISOString(),
      })),
      /** Whether payouts are sent through a payout provider (else finance records the bank reference). */
      payoutProvider: this.payouts?.sendsInstructions ? this.payouts.name : null,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private async load(id: string, organizationId?: string) {
    const s = await this.prisma.settlement.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
      include: { payouts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!s) throw AppError.notFound();
    return s;
  }

  async list(f: {
    status?: string;
    organizationId?: string;
    market?: string;
    exceptions?: boolean;
  }) {
    const rows = await this.prisma.settlement.findMany({
      where: {
        ...(f.status
          ? { status: f.status }
          : f.exceptions
            ? { status: { in: ['HELD', 'DISPUTE_HOLD', 'FAILED', 'REVERSED'] } }
            : {}),
        ...(f.organizationId ? { organizationId: f.organizationId } : {}),
        ...(f.market ? { market: f.market } : {}),
      },
      include: { payouts: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async get(id: string, organizationId?: string) {
    return this.view(await this.load(id, organizationId));
  }

  /** What stops a payout right now for this business (empty = nothing). */
  async holdsFor(
    organizationId: string,
  ): Promise<{ status: 'HELD' | 'DISPUTE_HOLD'; reason: string } | null> {
    const fin = await this.prisma.financialHold.findFirst({
      where: { organizationId, status: 'ACTIVE' },
    });
    if (fin) return { status: 'HELD', reason: `FINANCIAL_HOLD: ${fin.reason}` };
    const acc = await this.prisma.merchantSettlementAccount.findUnique({
      where: { organizationId },
    });
    if (!acc) return { status: 'HELD', reason: 'DESTINATION_MISSING' };
    if (acc.payoutHold) return { status: 'HELD', reason: 'PAYOUT_HOLD' };
    if (acc.verificationStatus !== 'VERIFIED')
      return { status: 'HELD', reason: 'DESTINATION_NOT_VERIFIED' };
    const disputed = await this.prisma.disputeCase.count({
      where: {
        organizationId,
        status: { notIn: ['RESOLVED', 'CLOSED', 'REJECTED'] },
        financialImpactMinor: { gt: 0 },
      },
    });
    if (disputed) return { status: 'DISPUTE_HOLD', reason: `OPEN_DISPUTES:${disputed}` };
    return null;
  }

  /** Runs settlement for one business or every business with unsettled payable in a market. */
  async run(
    actor: Actor,
    b: {
      market: string;
      organizationId?: string | null;
      currency?: string;
      periodTo?: string | null;
    },
    meta: RequestMeta,
  ) {
    const market = b.market.toUpperCase();
    // a run is in the market's settlement currency (Market / Country Configuration) unless one is named; nothing is converted
    const currency = b.currency ?? (await this.markets.profile(market)).settlementCurrency;
    const periodTo = b.periodTo ? new Date(b.periodTo) : new Date();
    const orgIds = b.organizationId
      ? [b.organizationId]
      : (
          await this.prisma.merchantPayableEvent.findMany({
            where: { type: { in: [...SETTLING_TYPES] }, currency, createdAt: { lte: periodTo } },
            distinct: ['organizationId'],
            select: { organizationId: true },
            take: 500,
          })
        ).map((r) => r.organizationId);
    const results: Array<{
      organizationId: string;
      outcome: string;
      settlementId?: string;
      payableMinor?: number;
    }> = [];
    for (const organizationId of orgIds) {
      const orgMarket = await this.markets.resolveMarket(organizationId).catch(() => null);
      if (orgMarket !== market) {
        if (b.organizationId)
          throw AppError.validation('This business does not settle in that market', 'market');
        continue;
      }
      const rule = await this.marketConfig.resolveSettlement(market, {
        organizationId,
        product: 'VOUCHER',
        currency,
        at: periodTo,
      });
      if (!rule) {
        if (b.organizationId)
          throw new AppError(
            'SETTLEMENT_RULE_MISSING',
            `No approved settlement rule for ${market} ${currency} (VALIDATE-${market})`,
            409,
          );
        results.push({ organizationId, outcome: 'NO_RULE' });
        continue;
      }
      // Stage 9 (B1): the rule's cut-off (HH:MM in the market's time zone) closes the period at the latest cut-off already passed
      const tz =
        (
          await this.prisma.countryConfiguration.findUnique({
            where: { code: market },
            select: { timezone: true },
          })
        )?.timezone ?? 'UTC';
      const effectiveTo = rule.cutoffTime ? latestCutoff(periodTo, rule.cutoffTime, tz) : periodTo;
      results.push(
        await this.runOne(actor, organizationId, market, currency, effectiveTo, rule, meta),
      );
    }
    return { market, currency, periodTo: periodTo.toISOString(), results };
  }

  private async runOne(
    actor: Actor,
    organizationId: string,
    market: string,
    currency: string,
    periodTo: Date,
    rule: {
      id: string;
      minimumMinor: number;
      holdDays: number;
      cycleDays: number;
      reserveBps?: number;
      reserveReleaseDays?: number;
      taxTreatment?: string;
    },
    meta: RequestMeta,
  ) {
    const cutoff = new Date(periodTo.getTime() - rule.holdDays * D);
    const hold = await this.holdsFor(organizationId);
    const acc = await this.prisma.merchantSettlementAccount.findUnique({
      where: { organizationId },
    });
    const fee = await this.marketConfig.resolveTax(market, 'PLATFORM_FEE').catch(() => null);
    return this.prisma.$transaction(async (tx) => {
      // one run per business at a time: an event can never be settled twice
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settlement:${organizationId}`}))`;
      const taken = (
        await tx.settlementItem.findMany({
          where: { settlement: { organizationId, status: { not: 'REVERSED' } } },
          select: { payableEventId: true },
        })
      ).map((i) => i.payableEventId);
      const events = await tx.merchantPayableEvent.findMany({
        where: {
          organizationId,
          type: { in: [...SETTLING_TYPES] },
          // only this run's currency: payables in another currency settle in their own run
          currency,
          createdAt: { lte: cutoff },
          id: { notIn: taken },
        },
        orderBy: { createdAt: 'asc' },
      });
      // a reserve whose release date has come is paid even when nothing new happened (Stage 9, B1)
      const reserveDue = await tx.settlement.count({
        where: {
          organizationId,
          currency,
          reserveMinor: { gt: 0 },
          reserveReleasedIntoId: null,
          reserveReleaseAt: { lte: periodTo },
          status: { not: 'REVERSED' },
        },
      });
      if (!events.length && !reserveDue) return { organizationId, outcome: 'NOTHING_TO_SETTLE' };
      let net = 0;
      let fees = 0;
      let adjustments = 0;
      for (const e of events) {
        if (e.type === 'ELIGIBLE') {
          net += e.amountHalalas;
          fees += e.feeHalalas;
        } else if (e.type === 'REDEMPTION_REVERSED') {
          net -= e.amountHalalas;
          fees -= e.feeHalalas;
        } else adjustments += e.amountHalalas;
      }
      const carried = await tx.settlement.findFirst({
        where: {
          organizationId,
          currency,
          payableMinor: { lt: 0 },
          carriedIntoId: null,
          status: { not: 'REVERSED' },
        },
        orderBy: { createdAt: 'desc' },
      });
      const carriedForward = carried?.payableMinor ?? 0;
      // Stage 9 (B1): reserves withheld by earlier statements whose release date has come are paid with this one (once)
      const releasable = await tx.settlement.findMany({
        where: {
          organizationId,
          currency,
          reserveMinor: { gt: 0 },
          reserveReleasedIntoId: null,
          reserveReleaseAt: { lte: periodTo },
          status: { not: 'REVERSED' },
        },
        select: { id: true, reserveMinor: true },
      });
      const released = releasable.reduce((n, r) => n + r.reserveMinor, 0);
      // tax on the platform fee follows the market tax rule when one is approved: shown on the statement (INFORMATIONAL, the fee is
      // invoiced by DealDash) or deducted (WITHHELD) per the rule; the treatment itself is VALIDATE-<market>
      const taxMinor =
        fee && !fee.exempt && !fee.inclusive ? Math.round((fees * fee.rateBps) / 10_000) : 0;
      const withheldTax = rule.taxTreatment === 'WITHHELD' ? taxMinor : 0;
      const beforeReserve = net + adjustments + carriedForward + released - withheldTax;
      // Stage 9 (B1): a rolling reserve (basis points of a positive payable) is withheld and released after the configured days
      const reserveMinor =
        beforeReserve > 0 && (rule.reserveBps ?? 0) > 0
          ? Math.floor((beforeReserve * (rule.reserveBps ?? 0)) / 10_000)
          : 0;
      const payable = beforeReserve - reserveMinor;
      if (payable > 0 && payable < rule.minimumMinor)
        return { organizationId, outcome: 'BELOW_MINIMUM', payableMinor: payable };
      const status = payable <= 0 ? 'COMPLETED' : hold ? hold.status : 'ELIGIBLE';
      const s = await tx.settlement.create({
        data: {
          reference: ref('STL'),
          organizationId,
          market,
          currency,
          product: 'VOUCHER',
          settlementRuleId: rule.id,
          periodFrom: events[0]?.createdAt ?? periodTo,
          periodTo,
          status,
          grossMinor: net + fees,
          feesMinor: fees,
          taxMinor,
          adjustmentsMinor: adjustments,
          carriedForwardMinor: carriedForward,
          payableMinor: payable,
          settlementDate: new Date(periodTo.getTime() + rule.cycleDays * D),
          destinationRef: acc?.ibanMasked ?? null,
          holdReason:
            payable > 0
              ? (hold?.reason ?? null)
              : payable < 0
                ? 'NEGATIVE_BALANCE_CARRIED_FORWARD'
                : null,
          createdByUserId: actor.userId,
          heldByUserId: hold ? actor.userId : null,
          reserveMinor,
          reserveReleaseAt:
            reserveMinor > 0
              ? new Date(periodTo.getTime() + (rule.reserveReleaseDays ?? 0) * D)
              : null,
          reserveReleasedMinor: released,
        },
      });
      if (releasable.length)
        await tx.settlement.updateMany({
          where: { id: { in: releasable.map((r) => r.id) }, reserveReleasedIntoId: null },
          data: { reserveReleasedIntoId: s.id },
        });
      await tx.settlementItem.createMany({
        data: events.map((e) => ({
          settlementId: s.id,
          payableEventId: e.id,
          type: e.type,
          amountMinor: e.type === 'REDEMPTION_REVERSED' ? -e.amountHalalas : e.amountHalalas,
          feeMinor: e.type === 'REDEMPTION_REVERSED' ? -e.feeHalalas : e.feeHalalas,
        })),
      });
      if (carried)
        await tx.settlement.update({ where: { id: carried.id }, data: { carriedIntoId: s.id } });
      await this.audit.record(
        {
          action: 'SETTLEMENT_CREATED',
          entityType: 'Settlement',
          entityId: s.id,
          actor,
          subjectOrganizationId: organizationId,
          newState: {
            status,
            payableMinor: payable,
            events: events.length,
            carriedForwardMinor: carriedForward,
            rule: rule.id,
          },
          market,
          meta,
        },
        tx,
      );
      return { organizationId, outcome: status, settlementId: s.id, payableMinor: payable };
    });
  }

  private async transition(
    actor: Actor,
    s: SettlementRow,
    data: Prisma.SettlementUpdateInput,
    action: string,
    reason: string,
    meta: RequestMeta,
    tx: Prisma.TransactionClient,
  ) {
    const r = await tx.settlement.updateMany({
      where: { id: s.id, status: s.status, paidMinor: s.paidMinor },
      data: data as Prisma.SettlementUpdateManyMutationInput,
    });
    if (r.count !== 1)
      throw new AppError('VERSION_CONFLICT', 'The settlement changed. Reload and try again.', 409);
    await this.audit.record(
      {
        action,
        entityType: 'Settlement',
        entityId: s.id,
        actor,
        subjectOrganizationId: s.organizationId,
        reason,
        previousState: { status: s.status, paidMinor: s.paidMinor },
        newState: JSON.parse(JSON.stringify(data)) as unknown,
        market: s.market,
        meta,
      },
      tx,
    );
  }

  async hold(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    const s = await this.load(id);
    if (!OPEN_FOR_PAYOUT.includes(s.status))
      throw new AppError('INVALID_STATE', `A ${s.status} settlement cannot be held`, 409);
    await this.prisma.$transaction((tx) =>
      this.transition(
        actor,
        s,
        { status: 'HELD', holdReason: reason, heldByUserId: actor.userId },
        'SETTLEMENT_HELD',
        reason,
        meta,
        tx,
      ),
    );
    return this.get(id);
  }

  /** Releasing a hold or a failure is a settlement override: a different finance person, and the cause must be gone. */
  async release(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    const s = await this.load(id);
    if (!['HELD', 'DISPUTE_HOLD', 'FAILED'].includes(s.status))
      throw new AppError('INVALID_STATE', `A ${s.status} settlement is not on hold`, 409);
    const cfg = await opsConfig(this.config);
    if (requiresSecondPerson({ mode: cfg.approvals.settlementOverride }, s.payableMinor)) {
      if (!actor.permissions.has('admin.finance.approve')) throw AppError.forbidden();
      if (s.heldByUserId === actor.userId || s.createdByUserId === actor.userId)
        throw new AppError(
          'CHECKER_REQUIRED',
          'A different finance person must release this settlement',
          403,
        );
    }
    const cause = await this.holdsFor(s.organizationId);
    if (cause && s.status !== 'FAILED')
      throw new AppError('SETTLEMENT_ON_HOLD', `The hold is still in place: ${cause.reason}`, 409);
    await this.prisma.$transaction((tx) =>
      this.transition(
        actor,
        s,
        {
          status: s.paidMinor > 0 ? 'PARTIALLY_PAID' : 'ELIGIBLE',
          holdReason: null,
          failureReason: null,
          approvedByUserId: actor.userId,
        },
        'SETTLEMENT_RELEASED',
        reason,
        meta,
        tx,
      ),
    );
    return this.get(id);
  }

  /** Records a payout made outside DealDash (manual payout in the MVP). A partial payout needs a finance approver. */
  async payout(
    actor: Actor,
    id: string,
    b: { amountMinor?: number | null; externalRef: string; idempotencyKey?: string | null },
    meta: RequestMeta,
  ) {
    const s = await this.load(id);
    if (!OPEN_FOR_PAYOUT.includes(s.status))
      throw new AppError('INVALID_STATE', `A ${s.status} settlement cannot be paid`, 409);
    const outstanding = s.payableMinor - s.paidMinor;
    const amount = b.amountMinor ?? outstanding;
    if (amount <= 0 || amount > outstanding)
      throw AppError.validation(`The payout must be between 1 and ${outstanding}`, 'amountMinor');
    if (amount < outstanding && !actor.permissions.has('admin.finance.approve'))
      throw new AppError('APPROVAL_REQUIRED', 'A partial settlement needs a finance approver', 403);
    const cause = await this.holdsFor(s.organizationId);
    if (cause) {
      await this.prisma.$transaction((tx) =>
        this.transition(
          actor,
          s,
          { status: cause.status, holdReason: cause.reason, heldByUserId: actor.userId },
          'SETTLEMENT_HELD',
          cause.reason,
          meta,
          tx,
        ),
      );
      throw new AppError('SETTLEMENT_ON_HOLD', `The settlement is on hold: ${cause.reason}`, 409);
    }
    const key = `stl-payout:${s.id}:${b.idempotencyKey ?? meta.requestId}`;
    if (await this.prisma.settlementPayout.findUnique({ where: { idempotencyKey: key } }))
      return this.get(id);
    await this.prisma.$transaction(async (tx) => {
      const j = await this.ledger.post(tx, {
        type: 'SETTLEMENT_PAYOUT',
        sourceType: 'Settlement',
        sourceId: s.id,
        idempotencyKey: key,
        currency: s.currency,
        memo: `Settlement payout ${s.reference} (${b.externalRef})`,
        actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
        lines: [
          {
            family: 'MERCHANT_SETTLEMENT_ELIGIBLE',
            organizationId: s.organizationId,
            amountHalalas: amount,
          },
          { family: 'PSP_CLEARING', amountHalalas: -amount },
        ],
      });
      await tx.settlementPayout.create({
        data: {
          settlementId: s.id,
          status: 'PAID',
          amountMinor: amount,
          externalRef: b.externalRef,
          journalId: j.journalId,
          recordedByUserId: actor.userId,
          idempotencyKey: key,
        },
      });
      const paid = s.paidMinor + amount;
      await this.transition(
        actor,
        s,
        {
          status: paid >= s.payableMinor ? 'COMPLETED' : 'PARTIALLY_PAID',
          paidMinor: paid,
          settlementDate: new Date(),
        },
        'SETTLEMENT_PAID',
        b.externalRef,
        meta,
        tx,
      );
    });
    return this.get(id);
  }

  /** The payout attempt failed (bank / provider rejected it before money left): nothing is posted. */
  async fail(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    const s = await this.load(id);
    if (!OPEN_FOR_PAYOUT.includes(s.status))
      throw new AppError('INVALID_STATE', `A ${s.status} settlement cannot fail`, 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.settlementPayout.create({
        data: {
          settlementId: s.id,
          status: 'FAILED',
          amountMinor: Math.max(1, s.payableMinor - s.paidMinor),
          reason,
          recordedByUserId: actor.userId,
          idempotencyKey: `stl-fail:${s.id}:${meta.requestId}`,
        },
      });
      await this.transition(
        actor,
        s,
        { status: 'FAILED', failureReason: reason, heldByUserId: actor.userId },
        'SETTLEMENT_FAILED',
        reason,
        meta,
        tx,
      );
    });
    return this.get(id);
  }

  // ---------------------------------------------------------------- Stage 9 (B2): payout instructions through a payout adapter
  /**
   * Sends the outstanding amount to the payout adapter (finance approver, never the person who prepared the statement). The
   * instruction is an append-only INSTRUCTED payout row; the statement waits in PAYOUT_PENDING until the provider (signed callback)
   * or a status check reports PAID (ledger posted, as a recorded payout) or FAILED. A failed instruction may be retried up to the
   * rule's limit; beyond it the statement needs a case. With the manual adapter finance keeps recording bank references instead.
   */
  async instructPayout(actor: Actor, id: string, meta: RequestMeta) {
    if (!this.payouts?.sendsInstructions)
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        'Payouts are manual: record the bank reference instead',
        409,
      );
    if (!actor.permissions.has('admin.finance.approve')) throw AppError.forbidden();
    const s = await this.load(id);
    if (![...OPEN_FOR_PAYOUT, 'FAILED'].includes(s.status))
      throw new AppError('INVALID_STATE', `A ${s.status} settlement cannot be paid out`, 409);
    if (s.createdByUserId === actor.userId)
      throw new AppError(
        'CHECKER_REQUIRED',
        'A different finance person must send the payout',
        403,
      );
    const rule = s.settlementRuleId
      ? await this.prisma.settlementRule.findUnique({
          where: { id: s.settlementRuleId },
          select: { failedRetryMaxAttempts: true },
        })
      : null;
    if (s.status === 'FAILED' && s.payoutAttempts >= 1 + (rule?.failedRetryMaxAttempts ?? 3))
      throw new AppError(
        'INVALID_STATE',
        'The payout failed too many times: open a case and fix the destination first',
        409,
      );
    const cause = await this.holdsFor(s.organizationId);
    if (cause)
      throw new AppError('SETTLEMENT_ON_HOLD', `The settlement is on hold: ${cause.reason}`, 409);
    const amount = s.payableMinor - s.paidMinor;
    if (amount <= 0) throw new AppError('INVALID_STATE', 'Nothing is outstanding', 409);
    const key = `stl-instruct:${s.id}:${s.payoutAttempts + 1}`;
    const res = await this.payouts.instruct({
      settlementReference: s.reference,
      amountMinor: amount,
      currency: s.currency,
      destinationRef: s.destinationRef,
      idempotencyKey: key,
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.settlementPayout.create({
        data: {
          settlementId: s.id,
          status: 'INSTRUCTED',
          amountMinor: amount,
          externalRef: res.providerRef,
          provider: this.payouts!.name,
          recordedByUserId: actor.userId,
          idempotencyKey: key,
        },
      });
      await this.transition(
        actor,
        s,
        {
          status: 'PAYOUT_PENDING',
          payoutAttempts: s.payoutAttempts + 1,
          failureReason: null,
          approvedByUserId: actor.userId,
        },
        'SETTLEMENT_PAYOUT_INSTRUCTED',
        res.providerRef,
        meta,
        tx,
      );
    });
    if (res.status !== 'PENDING')
      await this.payoutResult(res.providerRef, res.status, res.failureReason ?? null, null);
    return this.get(id);
  }

  /**
   * The provider's answer for an instruction (signed callback or status poll). Idempotent: a repeated or late answer for an
   * instruction already settled changes nothing. PAID posts the same balanced journal as a recorded payout.
   */
  async payoutResult(
    providerRef: string,
    status: 'PAID' | 'FAILED' | 'PENDING',
    failureReason: string | null,
    bankRef: string | null,
  ) {
    if (status === 'PENDING') return { applied: false };
    const instruction = await this.prisma.settlementPayout.findFirst({
      where: { externalRef: providerRef, status: 'INSTRUCTED' },
      orderBy: { createdAt: 'desc' },
    });
    if (!instruction) return { applied: false };
    const s = await this.load(instruction.settlementId);
    if (s.status !== 'PAYOUT_PENDING') return { applied: false };
    const system: Actor = {
      userId: instruction.recordedByUserId!,
      userType: 'ADMIN_USER',
      displayName: 'Payout provider',
      audience: 'admin',
      sessionId: 'provider',
      mfaVerified: true,
      mfaRequired: true,
      membership: null,
      memberships: [],
      permissions: new Set(),
      viaCookie: false,
    };
    const meta: RequestMeta = {
      requestId: `payout:${providerRef}`,
      ip: null,
      userAgent: `payout:${this.payouts?.name ?? 'unknown'}`,
      locale: 'en',
    };
    const key = `stl-result:${instruction.id}`;
    if (await this.prisma.settlementPayout.findUnique({ where: { idempotencyKey: key } }))
      return { applied: false };
    await this.prisma.$transaction(async (tx) => {
      if (status === 'PAID') {
        const j = await this.ledger.post(tx, {
          type: 'SETTLEMENT_PAYOUT',
          sourceType: 'Settlement',
          sourceId: s.id,
          idempotencyKey: key,
          currency: s.currency,
          memo: `Settlement payout ${s.reference} (${bankRef ?? providerRef})`,
          actor: { userId: system.userId, role: null },
          lines: [
            {
              family: 'MERCHANT_SETTLEMENT_ELIGIBLE',
              organizationId: s.organizationId,
              amountHalalas: instruction.amountMinor,
            },
            { family: 'PSP_CLEARING', amountHalalas: -instruction.amountMinor },
          ],
        });
        await tx.settlementPayout.create({
          data: {
            settlementId: s.id,
            status: 'PAID',
            amountMinor: instruction.amountMinor,
            externalRef: bankRef ?? providerRef,
            provider: instruction.provider,
            journalId: j.journalId,
            recordedByUserId: system.userId,
            idempotencyKey: key,
          },
        });
        const paid = s.paidMinor + instruction.amountMinor;
        await this.transition(
          system,
          s,
          {
            status: paid >= s.payableMinor ? 'COMPLETED' : 'PARTIALLY_PAID',
            paidMinor: paid,
            settlementDate: new Date(),
          },
          'SETTLEMENT_PAID',
          bankRef ?? providerRef,
          meta,
          tx,
        );
      } else {
        await tx.settlementPayout.create({
          data: {
            settlementId: s.id,
            status: 'FAILED',
            amountMinor: instruction.amountMinor,
            externalRef: providerRef,
            provider: instruction.provider,
            reason: failureReason ?? 'PROVIDER_FAILED',
            recordedByUserId: system.userId,
            idempotencyKey: key,
          },
        });
        await this.transition(
          system,
          s,
          { status: 'FAILED', failureReason: failureReason ?? 'PROVIDER_FAILED' },
          'SETTLEMENT_FAILED',
          failureReason ?? 'PROVIDER_FAILED',
          meta,
          tx,
        );
      }
    });
    return { applied: true };
  }

  /** Job / on demand: asks the provider about instructions still pending (covers a missed callback). */
  async pollPendingPayouts() {
    if (!this.payouts?.sendsInstructions) return 0;
    const pending = await this.prisma.settlement.findMany({
      where: { status: 'PAYOUT_PENDING' },
      include: {
        payouts: { where: { status: 'INSTRUCTED' }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      take: 50,
    });
    let n = 0;
    for (const s of pending) {
      const i = s.payouts[0];
      if (!i?.externalRef) continue;
      const r = await this.payouts.getStatus(i.externalRef).catch(() => null);
      if (
        r &&
        r.status !== 'PENDING' &&
        (
          await this.payoutResult(
            i.externalRef,
            r.status,
            r.failureReason ?? null,
            r.bankRef ?? null,
          )
        ).applied
      )
        n++;
    }
    return n;
  }

  /**
   * Reverses a settlement (for example the payout came back): the paid amount is restored to the merchant's settlement-eligible
   * balance by a reversing journal, and the settlement's events can be settled again by a later run. A finance approver only.
   */
  async reverse(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    const s = await this.load(id);
    if (['REVERSED'].includes(s.status))
      throw new AppError('INVALID_STATE', 'This settlement is already reversed', 409);
    if (!actor.permissions.has('admin.finance.approve')) throw AppError.forbidden();
    if (s.carriedIntoId)
      throw new AppError(
        'INVALID_STATE',
        'Its balance was carried into a later settlement: reverse that one first',
        409,
      );
    await this.prisma.$transaction(async (tx) => {
      if (s.paidMinor > 0) {
        const key = `stl-reversal:${s.id}`;
        const j = await this.ledger.post(tx, {
          type: 'SETTLEMENT_REVERSAL',
          sourceType: 'Settlement',
          sourceId: s.id,
          idempotencyKey: key,
          currency: s.currency,
          memo: `Settlement reversal ${s.reference}: ${reason}`,
          actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
          lines: [
            {
              family: 'MERCHANT_SETTLEMENT_ELIGIBLE',
              organizationId: s.organizationId,
              amountHalalas: -s.paidMinor,
            },
            { family: 'PSP_CLEARING', amountHalalas: s.paidMinor },
          ],
        });
        await tx.settlementPayout.create({
          data: {
            settlementId: s.id,
            status: 'REVERSED',
            amountMinor: s.paidMinor,
            reason,
            journalId: j.journalId,
            recordedByUserId: actor.userId,
            idempotencyKey: key,
          },
        });
      }
      // a settlement that consumed a carried-forward balance hands it back
      await tx.settlement.updateMany({
        where: { carriedIntoId: s.id },
        data: { carriedIntoId: null },
      });
      // ... and reserves it released go back to waiting for release (Stage 9, B1)
      await tx.settlement.updateMany({
        where: { reserveReleasedIntoId: s.id },
        data: { reserveReleasedIntoId: null },
      });
      await this.transition(
        actor,
        s,
        { status: 'REVERSED', approvedByUserId: actor.userId },
        'SETTLEMENT_REVERSED',
        reason,
        meta,
        tx,
      );
    });
    return this.get(id);
  }

  /** The merchant's own statements (finance users of the merchant). */
  async forMerchant(organizationId: string) {
    return this.list({ organizationId });
  }
}
