import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { UsageService } from '../subscription/usage.service';
import { RestrictionCheckService } from '../operations/restriction-check.service';
import { LoyaltyIssuanceService } from '../loyalty/loyalty-issuance.service';
import { CONFIG_KEYS } from '@dealdash/config';
import type { RedemptionResult } from '@dealdash/types';
import type { StaffReservationSummary } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { codeHint } from '../hot-deals/hot-content';
import { NotificationsService, type NotificationInput } from '../hot-deals/notifications.service';
import {
  RedemptionService,
  type StaffCodeExtension,
  type StaffScope,
} from '../hot-deals/redemption.service';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import { LedgerService } from './ledger.service';
import { faceValueLabel, newRef, parseVoucherCode } from './voucher-content';
import { VoucherCoreService } from './voucher-core.service';
import { VoucherEventsService } from './voucher-events.service';
import { parseVoucherContent } from './voucher-content';

const INSTANCE_INCLUDE = {
  voucher: {
    include: {
      organization: { include: { merchant: true } },
      branches: { include: { branch: true } },
    },
  },
  redemptions: { where: { status: 'REDEEMED' as const } },
} satisfies Prisma.VoucherInstanceInclude;
type Row = Prisma.VoucherInstanceGetPayload<{ include: typeof INSTANCE_INCLUDE }>;

type Input = { code: string; source: 'QR' | 'MANUAL' };

/**
 * Voucher validation and redemption for Merchant Staff: the SAME Staff app, the SAME rate limit and attempt log, the SAME
 * adaptive result and colour model as Stage 4. It plugs into RedemptionService (see `registerExtension`), so a scanned or
 * typed code is routed to the right product without the staff member doing anything different.
 *
 *  - one conditional update (`ACTIVE` and not expired) decides the single winner of any number of simultaneous attempts;
 *  - a partial unique index allows one active redemption per voucher instance even if the application were bypassed;
 *  - a voucher of another merchant reads exactly like an unknown code; branch, status, dates and merchant are all validated;
 *  - a redemption posts its ledger journal in the same transaction: the merchant amount moves from "held" to
 *    "settlement-eligible" (net of the versioned platform fee). Redemption never releases a payment (RD-31);
 *  - eligibility is NOT re-checked at redemption: the customer already paid (design rule: never for a paid voucher).
 */
@Injectable()
export class VoucherRedemptionService implements StaffCodeExtension, OnModuleInit {
  constructor(
    private readonly core: VoucherCoreService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly events: VoucherEventsService,
    private readonly redemptions: RedemptionService,
    @Optional() private readonly loyalty?: LoyaltyIssuanceService,
    @Optional() private readonly usage?: UsageService,
    @Optional() private readonly restrictions?: RestrictionCheckService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  onModuleInit() {
    this.redemptions.registerExtension(this);
  }

  // ---------------------------------------------------------------- lookup and assessment
  private async lookup(
    parsed: NonNullable<ReturnType<typeof parseVoucherCode>>,
  ): Promise<Row | null> {
    if (parsed.kind === 'QR_INVALID') return null;
    return this.prisma.voucherInstance.findFirst({
      where: parsed.kind === 'QR' ? { qrToken: parsed.value } : { manualCode: parsed.value },
      include: INSTANCE_INCLUDE,
    });
  }

  /** Where this redemption happens: the staff member's branch, else the override, else the voucher's first active branch. */
  private branchFor(row: Row, scope: StaffScope, override: string | null) {
    const applicable = row.voucher.branches;
    const wanted = scope.branchId ?? override;
    if (wanted) return applicable.find((b) => b.branchId === wanted) ?? null;
    return applicable.find((b) => b.branch.status === 'ACTIVE') ?? applicable[0] ?? null;
  }

  private assess(
    row: Row | null,
    scope: StaffScope,
    override: string | null,
    now: Date,
  ): { result: RedemptionResult; branchId: string | null } {
    // a code of another merchant is indistinguishable from an unknown code
    if (!row || row.organizationId !== scope.organizationId)
      return { result: 'INVALID_CODE', branchId: null };
    const branch = this.branchFor(row, scope, override);
    if (!branch) return { result: 'WRONG_BRANCH', branchId: null };
    const at = branch.branchId;
    if (row.status === 'REDEEMED') return { result: 'ALREADY_REDEEMED', branchId: at };
    if (row.status === 'REFUNDED' || row.status === 'VOIDED')
      return { result: 'REFUNDED', branchId: at };
    if (row.status === 'EXPIRED' || row.expiresAt.getTime() <= now.getTime())
      return { result: 'EXPIRED', branchId: at };
    if (row.validFrom && row.validFrom.getTime() > now.getTime())
      return { result: 'NOT_VALID_YET', branchId: at };
    // Paused, sold-out and ended products do NOT block vouchers already sold (VC-39); only a DealDash suspension does.
    if (row.voucher.status === 'SUSPENDED') return { result: 'VOUCHER_SUSPENDED', branchId: at };
    if (row.voucher.organization.status !== 'ACTIVE')
      return { result: 'CAMPAIGN_UNAVAILABLE', branchId: at };
    return { result: 'VALID', branchId: at };
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
    branchId: string | null,
  ): Promise<StaffReservationSummary | null> {
    if (!row || row.organizationId !== scope.organizationId) return null;
    const c = parseVoucherContent(row.voucher.content);
    const at = row.voucher.branches.find((b) => b.branchId === branchId)?.branch;
    const redeemed = row.redemptions[0];
    let redeemedBranch: { en: string; ar: string } | null = null;
    if (redeemed) {
      const b = await this.prisma.merchantBranch.findUnique({ where: { id: redeemed.branchId } });
      if (b) redeemedBranch = { en: b.nameEn, ar: b.nameAr };
    }
    const names = row.voucher.branches.map((b) => b.branch);
    return {
      kind: 'VOUCHER',
      faceValueHalalas: row.faceValueHalalas,
      ref: row.reference,
      quantity: 1,
      dealTitle: c.title,
      offerLabel: faceValueLabel(row.faceValueHalalas),
      merchantName: merchantDisplayName(row.voucher.organization),
      branchName: at
        ? { en: at.nameEn, ar: at.nameAr }
        : names[0]
          ? { en: names[0].nameEn, ar: names[0].nameAr }
          : { en: '', ar: '' },
      customerFirstName: await this.firstName(row.ownerUserId),
      expiresAt: row.expiresAt.toISOString(),
      startsAt: row.validFrom ? row.validFrom.toISOString() : null,
      redeemedAt: row.redeemedAt ? row.redeemedAt.toISOString() : null,
      redeemedBranchName: redeemedBranch,
      validBranchName:
        result === 'WRONG_BRANCH'
          ? {
              en: names.map((b) => b.nameEn).join(', '),
              ar: names.map((b) => b.nameAr).join('، '),
            }
          : null,
      requirement: null,
    };
  }

  private async logAttempt(
    actor: Actor,
    scope: StaffScope,
    input: Input,
    kind: 'VALIDATE' | 'REDEEM',
    result: RedemptionResult,
    row: Row | null,
    branchId: string | null,
    idempotencyKey: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    await (tx ?? this.prisma).redemptionAttempt.create({
      data: {
        staffUserId: actor.userId,
        organizationId: scope.organizationId,
        branchId: scope.branchId ?? branchId,
        voucherInstanceId: row && row.organizationId === scope.organizationId ? row.id : null,
        codeHint: codeHint(input.code),
        source: input.source,
        kind,
        result,
        idempotencyKey,
      },
    });
  }

  /** True when this input is a voucher code (a QR with the voucher prefix, or a typed code that exists as a voucher). */
  private async claims(input: Input): Promise<ReturnType<typeof parseVoucherCode> | 'NO'> {
    const parsed = parseVoucherCode(input.code);
    if (!parsed) return 'NO';
    if (parsed.kind === 'QR' || parsed.kind === 'QR_INVALID') return parsed;
    const hit = await this.prisma.voucherInstance.count({ where: { manualCode: parsed.value } });
    return hit > 0 ? parsed : 'NO';
  }

  // ---------------------------------------------------------------- StaffCodeExtension
  async validate(
    actor: Actor,
    scope: StaffScope,
    input: Input,
    branchOverride: string | null,
    now: Date,
  ) {
    const parsed = await this.claims(input);
    if (parsed === 'NO' || !parsed) return null;
    const row = await this.lookup(parsed);
    const { result, branchId } = this.assess(row, scope, branchOverride, now);
    await this.logAttempt(actor, scope, input, 'VALIDATE', result, row, branchId, null);
    return {
      result,
      reservation: await this.summary(row, result, scope, branchId),
      serverNow: now.toISOString(),
    };
  }

  async redeem(
    actor: Actor,
    scope: StaffScope,
    input: Input,
    idempotencyKey: string | null,
    branchOverride: string | null,
    meta: RequestMeta,
    now: Date,
  ) {
    const parsed = await this.claims(input);
    if (parsed === 'NO' || !parsed) return null;

    // same staff member, same key: the same success again (a request retried after a bad connection)
    if (idempotencyKey) {
      const prior = await this.prisma.voucherRedemption.findFirst({
        where: { staffUserId: actor.userId, idempotencyKey },
      });
      if (prior) {
        const row = await this.prisma.voucherInstance.findUnique({
          where: { id: prior.instanceId },
          include: INSTANCE_INCLUDE,
        });
        return {
          result: 'REDEEMED' as const,
          reference: prior.reference,
          redeemedAt: prior.redeemedAt.toISOString(),
          reservation: await this.summary(row, 'REDEEMED', scope, prior.branchId),
          serverNow: now.toISOString(),
        };
      }
    }

    let row = await this.lookup(parsed);
    let { result, branchId } = this.assess(row, scope, branchOverride, now);
    let reference: string | null = null;
    let redeemedAt: Date | null = null;
    // Stage 8: a governed branch redemption hold pauses redemption here; the customer keeps the voucher
    if (result === 'VALID' && branchId)
      await this.restrictions?.assertBranchRedemptionOpen(branchId);

    if (result === 'VALID' && row && branchId) {
      const target = row;
      const at = branchId;
      const sent: Array<NotificationInput & { id: string }> = [];
      const post: Array<() => void> = [];
      const rule = await this.core.feeRule();
      const fee = this.core.computeFee(target.purchasePriceHalalas, rule);
      const outcome = await this.prisma.$transaction(async (tx) => {
        // the one decisive step: only one caller can move ACTIVE -> REDEEMED
        const claimed = await tx.voucherInstance.updateMany({
          where: { id: target.id, status: 'ACTIVE', expiresAt: { gt: now } },
          data: { status: 'REDEEMED', redeemedAt: now, version: { increment: 1 } },
        });
        if (claimed.count !== 1) return { won: false as const };
        const created = await tx.voucherRedemption.create({
          data: {
            campaignVersion: await this.core.versions.current(tx, 'VOUCHER', target.voucherId),
            instanceId: target.id,
            voucherId: target.voucherId,
            branchId: at,
            organizationId: target.organizationId,
            staffUserId: actor.userId,
            source: input.source,
            reference: newRef('RV'),
            idempotencyKey,
            redeemedAt: now,
          },
        });
        await this.core.commercial.recordUtilization(
          'VOUCHER',
          target.voucherId,
          { sourceType: 'VOUCHER_REDEMPTION', sourceId: created.id },
          tx,
        );
        // the commission DealDash earns on this verified transaction (fee rule version retained) is the billable fact
        await this.usage?.recordBillable(
          {
            organizationId: target.organizationId,
            metric: 'voucher_transactions',
            eventType: 'VOUCHER_TRANSACTION_COMMISSION',
            sourceType: 'VOUCHER_REDEMPTION',
            sourceId: created.id,
            product: 'VOUCHER',
            campaignId: target.voucherId,
            unitRateMinor: fee,
            amountMinor: fee,
            currency: 'SAR',
            pricingVersionKey: `FEE:${rule.version}`,
            occurredAt: now,
            metadata: { grossHalalas: target.purchasePriceHalalas },
          },
          tx,
        );
        await this.loyalty?.issueForEvent(tx, {
          eventType: 'VOUCHER_REDEMPTION',
          userId: target.ownerUserId,
          product: 'VOUCHER',
          campaignId: target.voucherId,
          organizationId: target.organizationId,
          sourceType: 'REDEMPTION',
          sourceId: created.id,
          amountHalalas: target.purchasePriceHalalas,
          now,
        });
        const net = target.purchasePriceHalalas - fee;
        const j = await this.ledger.post(tx, {
          type: 'REDEMPTION',
          sourceType: 'VoucherRedemption',
          sourceId: created.id,
          idempotencyKey: `redemption:${created.id}`,
          memo: `Voucher ${target.reference} redeemed`,
          feeRuleVersion: rule.version,
          actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
          lines: [
            {
              family: 'MERCHANT_HELD',
              organizationId: target.organizationId,
              amountHalalas: target.purchasePriceHalalas,
            },
            { family: 'PLATFORM_REVENUE', amountHalalas: -fee, memo: `fee rule v${rule.version}` },
            {
              family: 'MERCHANT_SETTLEMENT_ELIGIBLE',
              organizationId: target.organizationId,
              amountHalalas: -net,
            },
          ],
        });
        await tx.merchantPayableEvent.createMany({
          data: [
            {
              organizationId: target.organizationId,
              voucherId: target.voucherId,
              instanceId: target.id,
              type: 'REDEEMED',
              amountHalalas: target.purchasePriceHalalas,
              journalId: j.journalId,
              note: created.reference,
              createdAt: now,
            },
            {
              organizationId: target.organizationId,
              voucherId: target.voucherId,
              instanceId: target.id,
              type: 'ELIGIBLE',
              amountHalalas: net,
              feeHalalas: fee,
              journalId: j.journalId,
              note: `settlement-eligible after redemption (fee rule v${rule.version})`,
              createdAt: now,
            },
          ],
        });
        post.push(
          await this.events.record(
            tx,
            'VOUCHER_REDEEMED',
            { voucherId: target.voucherId, organizationId: target.organizationId, branchId: at },
            target.ownerUserId,
            'voucher.redeemed',
            { instanceId: target.id },
          ),
        );
        await this.core.audit.record(
          {
            action: 'voucher_redemption.redeem',
            entityType: 'VoucherRedemption',
            entityId: created.id,
            actor,
            subjectOrganizationId: target.organizationId,
            newState: {
              instanceId: target.id,
              source: input.source,
              netHalalas: net,
              feeHalalas: fee,
            },
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
          at,
          idempotencyKey,
          tx,
        );
        const c = parseVoucherContent(target.voucher.content);
        const m = merchantDisplayName(target.voucher.organization);
        const branch = target.voucher.branches.find((b) => b.branchId === at)?.branch;
        sent.push(
          ...(await this.notifications.emit(tx, [
            {
              userId: target.ownerUserId,
              type: 'VOUCHER_REDEEMED',
              dedupeKey: `instance:${target.id}:redeemed`,
              data: {
                instanceId: target.id,
                voucherTitleEn: c.title.en,
                voucherTitleAr: c.title.ar,
                merchantNameEn: m.en,
                merchantNameAr: m.ar,
                branchNameEn: branch?.nameEn ?? '',
                branchNameAr: branch?.nameAr ?? '',
              },
            },
          ])),
        );
        return { won: true as const, created };
      });
      if (outcome.won) {
        await this.notifications.dispatch(sent);
        for (const f of post) f();
        reference = outcome.created.reference;
        redeemedAt = outcome.created.redeemedAt;
        result = 'REDEEMED';
        row = await this.prisma.voucherInstance.findUnique({
          where: { id: target.id },
          include: INSTANCE_INCLUDE,
        });
      } else {
        // lost the race (or it expired / was refunded in this very moment): report what is true now
        row = await this.prisma.voucherInstance.findUnique({
          where: { id: target.id },
          include: INSTANCE_INCLUDE,
        });
        ({ result, branchId } = this.assess(row, scope, branchOverride, now));
        if (result === 'VALID') result = 'ALREADY_REDEEMED';
        await this.logAttempt(actor, scope, input, 'REDEEM', result, row, branchId, idempotencyKey);
      }
    } else {
      await this.logAttempt(actor, scope, input, 'REDEEM', result, row, branchId, idempotencyKey);
    }
    return {
      result,
      reference,
      redeemedAt: redeemedAt ? redeemedAt.toISOString() : null,
      reservation: await this.summary(row, result, scope, branchId),
      serverNow: now.toISOString(),
    };
  }

  /** Details for staff history rows that concern vouchers. */
  async historyDetails(instanceIds: string[], organizationId: string) {
    const rows = instanceIds.length
      ? await this.prisma.voucherInstance.findMany({
          where: { id: { in: instanceIds }, organizationId },
          select: {
            id: true,
            reference: true,
            ownerUserId: true,
            voucher: { select: { content: true } },
          },
        })
      : [];
    const out = new Map<
      string,
      {
        reference: string;
        title: { en: string; ar: string };
        quantity: number;
        customerFirstName: string | null;
      }
    >();
    for (const r of rows)
      out.set(r.id, {
        reference: r.reference,
        title: parseVoucherContent(r.voucher.content).title,
        quantity: 1,
        customerFirstName: await this.firstName(r.ownerUserId),
      });
    return out;
  }

  // ---------------------------------------------------------------- reversal (merchant Owner/Admin or DealDash)
  /**
   * Reverses a completed voucher redemption: the instrument is ACTIVE again (if its validity still runs; the expiry sweep
   * handles it otherwise) and the ledger gets the exact opposite journal. Staff can never do this. Merchants only within
   * `redemption.reversal_window_hours`; DealDash with the finance permission at any time. Reason required, audited.
   */
  async reverse(
    actor: Actor,
    redemptionId: string,
    reason: string,
    scope: { organizationId: string | null },
    meta: RequestMeta,
    now = new Date(),
  ) {
    const red = await this.prisma.voucherRedemption.findFirst({
      where: {
        id: redemptionId,
        ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
      },
      include: { instance: true },
    });
    if (!red) throw AppError.notFound();
    if (red.status !== 'REDEEMED')
      throw new AppError('REVERSAL_NOT_ALLOWED', 'This redemption was already reversed', 409);
    if (scope.organizationId) {
      const hours = await this.core.config.getNumber(
        CONFIG_KEYS.REDEMPTION_REVERSAL_WINDOW_HOURS,
        24,
      );
      if (now.getTime() - red.redeemedAt.getTime() > hours * 3_600_000)
        throw new AppError(
          'REVERSAL_NOT_ALLOWED',
          'The reversal window for this redemption has passed',
          409,
        );
    }
    await this.prisma.$transaction(async (tx) => {
      const flipped = await tx.voucherRedemption.updateMany({
        where: { id: red.id, status: 'REDEEMED' },
        data: {
          status: 'REVERSED',
          reversedAt: now,
          reversedByUserId: actor.userId,
          reverseReason: reason,
        },
      });
      if (flipped.count !== 1)
        throw new AppError('REVERSAL_NOT_ALLOWED', 'This redemption was already reversed', 409);
      await this.core.commercial.reverseUtilization(
        'VOUCHER',
        red.voucherId,
        { sourceType: 'VOUCHER_REDEMPTION', sourceId: red.id },
        tx,
      );
      await this.usage?.voidBillable('VOUCHER_TRANSACTION_COMMISSION', red.id, tx);
      await this.loyalty?.reverseForSource(tx, {
        sourceType: 'REDEMPTION',
        sourceId: red.id,
        reason: 'REDEMPTION_REVERSED',
        actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
      });
      const back = await tx.voucherInstance.updateMany({
        where: { id: red.instanceId, status: 'REDEEMED' },
        data: { status: 'ACTIVE', redeemedAt: null, version: { increment: 1 } },
      });
      if (back.count !== 1)
        throw new AppError('INVALID_STATE', 'The voucher is not in a redeemed state', 409);
      const original = await tx.ledgerJournal.findUnique({
        where: { idempotencyKey: `redemption:${red.id}` },
        select: { id: true },
      });
      let journalId: string | null = null;
      let net = red.instance.purchasePriceHalalas;
      let fee = 0;
      if (original) {
        const j = await this.ledger.reverse(tx, original.id, {
          sourceType: 'VoucherRedemption',
          sourceId: red.id,
          idempotencyKey: `reversal:${red.id}`,
          memo: `Reversal of redemption ${red.reference}: ${reason}`,
          reasonCode: 'REDEMPTION_REVERSED',
          actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
        });
        journalId = j.journalId;
        const eligible = await tx.merchantPayableEvent.findFirst({
          where: { instanceId: red.instanceId, type: 'ELIGIBLE' },
          orderBy: { createdAt: 'desc' },
        });
        if (eligible) {
          net = eligible.amountHalalas;
          fee = eligible.feeHalalas;
        }
      }
      await tx.merchantPayableEvent.create({
        data: {
          organizationId: red.organizationId,
          voucherId: red.voucherId,
          instanceId: red.instanceId,
          type: 'REDEMPTION_REVERSED',
          amountHalalas: net,
          feeHalalas: fee,
          journalId,
          note: reason,
          createdAt: now,
        },
      });
      await this.core.audit.record(
        {
          action: 'voucher_redemption.reverse',
          entityType: 'VoucherRedemption',
          entityId: red.id,
          actor,
          reason,
          subjectOrganizationId: red.organizationId,
          previousState: { status: 'REDEEMED' },
          newState: { status: 'REVERSED' },
          meta,
        },
        tx,
      );
    });
    return { id: red.id, status: 'REVERSED' as const };
  }
}
