import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { WatchBudgetDetail } from '@dealdash/validation';
import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { LedgerService } from '../vouchers/ledger.service';
import { newFundingReference } from './watch-content';
import { WatchCoreService, type WatchRowData } from './watch-core.service';

const FUNDABLE: ReadonlyArray<WatchRowData['status']> = [
  'DRAFT',
  'NEEDS_CHANGES',
  'PENDING_REVIEW',
  'SCHEDULED',
  'LIVE',
  'PAUSED',
];

/**
 * Campaign funding and budget accounting. Money is integer halalas and every movement is a balanced, idempotent ledger journal:
 *   funding      PSP clearing  (debit)  /  campaign budget (credit)
 *   consumption  campaign budget (debit) /  platform side  (credit)      one per qualified view
 *   credit back  the exact reverse of a consumption journal              a billed view later found invalid
 *   release      campaign budget (debit) /  campaign unused (credit)     close-out of the unused balance
 * The treatment of the unused balance (refund, carry forward, retain) is NOT decided: the ledger keeps it separately
 * identifiable and the rule is configuration plus a VALIDATE-KSA item. Nothing here is a legal or accounting conclusion.
 */
@Injectable()
export class WatchFundingService {
  constructor(
    private readonly core: WatchCoreService,
    private readonly ledger: LedgerService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  /**
   * Adds funds to the campaign budget. Over-funding is refused (the campaign holds at most what its paid views cost), and the
   * same idempotency key never funds twice. In development the payment is simulated (mock source); a real payment provider
   * plugs in behind the same journal.
   */
  async fund(
    actor: Actor,
    organizationId: string | null,
    id: string,
    amountHalalas: number,
    opts: {
      source: 'MOCK_PAYMENT' | 'ADMIN_CREDIT';
      idempotencyKey?: string;
      reason?: string;
      meta: RequestMeta;
    },
  ) {
    const c = organizationId
      ? await this.core.loadOwned(organizationId, id)
      : await this.core.loadAny(id);
    if (!FUNDABLE.includes(c.status))
      throw new AppError('INVALID_STATE', `A ${c.status} campaign cannot be funded`, 409);
    // FD-S7-1: a partner-owned budget is funded by that partner (DealDash Admin credits stay possible); never by the merchant
    const owner = c.sponsorOrganizationId ?? c.organizationId;
    if (
      c.sponsorOrganizationId &&
      organizationId &&
      actor.partnerContext?.partnerOrganizationId !== c.sponsorOrganizationId
    )
      throw new AppError(
        'INVALID_STATE',
        'This campaign budget is owned and funded by its sponsor',
        409,
      );
    const key = opts.idempotencyKey ?? randomUUID();
    const idemKey = `watch-fund:${c.id}:${key}`;
    await this.prisma.$transaction(async (tx) => {
      const dup = await tx.watchFunding.findUnique({ where: { idempotencyKey: idemKey } });
      if (dup) return; // a retry of the same request: nothing is added twice
      const required = c.requiredBudgetHalalas;
      // One conditional update: funding can never exceed what the campaign's paid views cost.
      const moved = await tx.$executeRaw`UPDATE "WatchCampaign"
        SET "fundedHalalas" = "fundedHalalas" + ${amountHalalas}, "updatedAt" = now()
        WHERE "id" = ${c.id}::uuid AND "closedOutAt" IS NULL
          AND "fundedHalalas" + ${amountHalalas} <= "requiredBudgetHalalas"`;
      if (moved !== 1)
        throw new AppError(
          'VALIDATION_FAILED',
          `The amount is more than the remaining budget (${Math.max(0, required - c.fundedHalalas)} halalas)`,
          422,
          'amountHalalas',
        );
      const ref = newFundingReference();
      const journal = await this.ledger.post(tx, {
        type: 'CAMPAIGN_FUNDING',
        sourceType: 'WatchCampaign',
        sourceId: c.id,
        idempotencyKey: `journal:${idemKey}`,
        currency: await this.currencyOf(tx, c.id),
        memo: `Campaign budget funding ${ref}`,
        reasonCode: opts.source,
        actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
        lines: [
          { family: 'PSP_CLEARING', amountHalalas, memo: 'Funding received (development mock)' },
          {
            family: 'CAMPAIGN_BUDGET',
            organizationId: owner,
            amountHalalas: -amountHalalas,
            memo: `Campaign ${c.id}`,
          },
        ],
      });
      await tx.watchFunding.create({
        data: {
          campaignId: c.id,
          organizationId: owner,
          amountHalalas,
          currency: await this.currencyOf(tx, c.id),
          source: opts.source,
          reference: ref,
          idempotencyKey: idemKey,
          journalId: journal.journalId,
          createdByUserId: actor.userId,
          createdByName:
            actor.membership?.organizationType === 'DEALDASH' ? 'DealDash' : actor.displayName,
        },
      });
      await this.core.record(tx, c, {
        action: 'FUND',
        from: c.status,
        to: c.status,
        actor,
        reason: opts.reason ?? null,
        snapshot: { amountHalalas, source: opts.source, reference: ref },
        meta: opts.meta,
      });
    });
  }

  async detail(c: WatchRowData, forMerchant: boolean): Promise<WatchBudgetDetail> {
    const [funding, journals] = await Promise.all([
      this.prisma.watchFunding.findMany({
        where: { campaignId: c.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.ledgerJournal.findMany({
        where: { sourceType: 'WatchCampaign', sourceId: c.id },
        orderBy: { postedAt: 'desc' },
        take: 20,
        include: { entries: { include: { account: true } } },
      }),
    ]);
    // Per-view consumption journals are keyed by the view, not the campaign: show the campaign-level journals plus a roll-up.
    return {
      budget: await this.core.budgetOf(c),
      funding: funding.map((f) => ({
        id: f.id,
        amountHalalas: f.amountHalalas,
        source: f.source,
        reference: f.reference,
        createdAt: f.createdAt.toISOString(),
        byName: forMerchant && f.source === 'ADMIN_CREDIT' ? 'DealDash' : (f.createdByName ?? null),
      })),
      journals: journals.map((j) => ({
        id: j.id,
        type: j.type,
        postedAt: j.postedAt.toISOString(),
        amountHalalas: Math.max(0, ...j.entries.map((e) => Math.abs(e.amountHalalas))),
        memo: j.memo,
      })),
      disclaimerKey: 'legal_treatment_validate_ksa',
    };
  }

  // ---------------------------------------------------------------- consumption (called inside the qualification transaction)
  /**
   * Spends one view's charge from the budget with a SINGLE conditional update. The database refuses any update that would push
   * spend above funding or views above the paid quantity, so concurrent completions can never overspend (returns false then).
   */
  async consume(
    tx: Prisma.TransactionClient,
    c: { id: string; organizationId: string },
    viewId: string,
    chargeHalalas: number,
  ): Promise<{ ok: boolean; exhausted: boolean; journalId: string | null }> {
    const rows = await tx.$queryRaw<
      Array<{
        qualifiedViews: number;
        paidViews: number;
        spentHalalas: number;
        fundedHalalas: number;
      }>
    >`UPDATE "WatchCampaign"
      SET "spentHalalas" = "spentHalalas" + ${chargeHalalas}, "qualifiedViews" = "qualifiedViews" + 1, "updatedAt" = now()
      WHERE "id" = ${c.id}::uuid AND "status" = 'LIVE' AND "closedOutAt" IS NULL
        AND "qualifiedViews" < "paidViews" AND "spentHalalas" + ${chargeHalalas} <= "fundedHalalas"
      RETURNING "qualifiedViews", "paidViews", "spentHalalas", "fundedHalalas"`;
    const r = rows[0];
    if (!r) return { ok: false, exhausted: false, journalId: null };
    const owner = await this.budgetOwner(tx, c);
    const journal = await this.ledger.post(tx, {
      type: 'CAMPAIGN_CONSUMPTION',
      sourceType: 'WatchView',
      sourceId: viewId,
      idempotencyKey: `watch-consume:${viewId}`,
      currency: await this.currencyOf(tx, c.id),
      memo: 'Qualified view charge',
      lines: [
        {
          family: 'CAMPAIGN_BUDGET',
          organizationId: owner,
          amountHalalas: chargeHalalas,
          memo: `Campaign ${c.id}`,
        },
        { family: 'PLATFORM_REVENUE', amountHalalas: -chargeHalalas, memo: 'Campaign view charge' },
      ],
    });
    const exhausted =
      r.qualifiedViews >= r.paidViews || r.fundedHalalas - r.spentHalalas < chargeHalalas;
    return { ok: true, exhausted, journalId: journal.journalId };
  }

  /** A campaign's money is in its own currency (its market's, fixed when it was priced). */
  private async currencyOf(tx: Prisma.TransactionClient, campaignId: string) {
    return (
      await tx.watchCampaign.findUniqueOrThrow({
        where: { id: campaignId },
        select: { currency: true },
      })
    ).currency;
  }

  /** A billed view was later found invalid: the merchant is credited back with the exact reverse journal. */
  async creditBack(
    tx: Prisma.TransactionClient,
    c: { id: string; organizationId: string; closedOutAt: Date | null },
    view: { id: string; chargeHalalas: number; consumptionJournalId: string | null },
    reason: string,
  ) {
    if (!view.consumptionJournalId || view.chargeHalalas <= 0) return;
    const charge = view.chargeHalalas;
    if (!c.closedOutAt) {
      await tx.$executeRaw`UPDATE "WatchCampaign"
        SET "spentHalalas" = "spentHalalas" - ${charge}, "qualifiedViews" = GREATEST("qualifiedViews" - 1, 0), "updatedAt" = now()
        WHERE "id" = ${c.id}::uuid AND "spentHalalas" >= ${charge}`;
      await this.ledger.reverse(tx, view.consumptionJournalId, {
        type: 'CAMPAIGN_CREDIT_BACK',
        sourceType: 'WatchView',
        sourceId: view.id,
        idempotencyKey: `watch-creditback:${view.id}`,
        memo: `Credit back: ${reason}`,
        reasonCode: 'CREDIT_BACK',
      });
      return;
    }
    // Already closed out: the credit goes straight to the separately identified unused balance.
    await tx.$executeRaw`UPDATE "WatchCampaign"
      SET "spentHalalas" = "spentHalalas" - ${charge}, "unusedHalalas" = "unusedHalalas" + ${charge},
          "qualifiedViews" = GREATEST("qualifiedViews" - 1, 0), "updatedAt" = now()
      WHERE "id" = ${c.id}::uuid AND "spentHalalas" >= ${charge}`;
    await this.ledger.post(tx, {
      type: 'CAMPAIGN_CREDIT_BACK',
      sourceType: 'WatchView',
      sourceId: view.id,
      idempotencyKey: `watch-creditback:${view.id}`,
      currency: await this.currencyOf(tx, c.id),
      memo: `Credit back after close-out: ${reason}`,
      reasonCode: 'CREDIT_BACK',
      reversesJournalId: view.consumptionJournalId,
      lines: [
        { family: 'PLATFORM_REVENUE', amountHalalas: charge },
        {
          family: 'CAMPAIGN_UNUSED',
          organizationId: await this.budgetOwner(tx, c),
          amountHalalas: -charge,
        },
      ],
    });
  }

  /**
   * Close-out: the unused part of the budget moves to its own identified balance exactly once. It is NOT paid out or retained
   * here; what happens to it is configuration (`watch.unused_budget_treatment`) and a VALIDATE-KSA decision.
   */
  async closeOut(
    tx: Prisma.TransactionClient,
    c: { id: string; organizationId: string },
    now: Date,
  ) {
    const rows = await tx.$queryRaw<Array<{ unused: number }>>`UPDATE "WatchCampaign"
      SET "unusedHalalas" = "fundedHalalas" - "spentHalalas", "closedOutAt" = ${now}, "updatedAt" = now()
      WHERE "id" = ${c.id}::uuid AND "closedOutAt" IS NULL
      RETURNING ("fundedHalalas" - "spentHalalas") AS unused`;
    const unused = Number(rows[0]?.unused ?? 0);
    if (!rows[0] || unused <= 0) return 0;
    const owner = await this.budgetOwner(tx, c);
    await this.ledger.post(tx, {
      type: 'CAMPAIGN_RELEASE',
      sourceType: 'WatchCampaign',
      sourceId: c.id,
      idempotencyKey: `watch-closeout:${c.id}`,
      currency: await this.currencyOf(tx, c.id),
      memo: 'Unused campaign budget released to a separate balance',
      reasonCode: 'CLOSE_OUT',
      lines: [
        { family: 'CAMPAIGN_BUDGET', organizationId: owner, amountHalalas: unused },
        { family: 'CAMPAIGN_UNUSED', organizationId: owner, amountHalalas: -unused },
      ],
    });
    return unused;
  }

  /** FD-S7-1: the organization whose campaign budget this is (the partner Sponsor / Funder that owns it, else the merchant). */
  private async budgetOwner(
    tx: Prisma.TransactionClient,
    c: { id: string; organizationId: string },
  ) {
    const row = await tx.watchCampaign.findUnique({
      where: { id: c.id },
      select: { sponsorOrganizationId: true },
    });
    return row?.sponsorOrganizationId ?? c.organizationId;
  }
}
