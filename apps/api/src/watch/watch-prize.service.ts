import { randomInt } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  PRIZE_QR_PREFIX,
  type RedemptionResult,
  type WatchPrizeIneligible,
  type WatchPrizeKind,
} from '@dealdash/types';
import type {
  StaffReservationSummary,
  WatchContent,
  WatchPrizeGuardrails,
  WonPrize,
} from '@dealdash/validation';
import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import type { NotificationInput } from '../hot-deals/notifications.service';
import { codeHint, newManualCode, newQrToken } from '../hot-deals/hot-content';
import {
  RedemptionService,
  type StaffCodeExtension,
  type StaffScope,
} from '../hot-deals/redemption.service';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import { WatchCoreService } from './watch-core.service';

const DAY = 86_400_000;
/** Probability is expressed in basis points: a draw is a uniform integer in [0, 10000). */
export const PRIZE_DRAW_SPACE = 10_000;
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newPrizeRef = () => {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `DP-${s}`;
};

/**
 * The pure decision of FDR-19 (instant probabilistic allocation), separated so it can be tested exhaustively:
 * not eligible -> no roll, no prize; eligible -> won exactly when the server's roll is below the (guardrail-capped) probability.
 * Inventory is NOT decided here: a won roll still needs the atomic inventory claim to become a prize.
 */
export function decidePrize(input: {
  ineligible: WatchPrizeIneligible | null;
  probabilityBps: number;
  roll: () => number;
}): { roll: number | null; wins: boolean } {
  if (input.ineligible) return { roll: null, wins: false };
  const roll = input.roll();
  if (!Number.isInteger(roll) || roll < 0 || roll >= PRIZE_DRAW_SPACE)
    throw new Error('prize roll out of range');
  return { roll, wins: roll < input.probabilityBps };
}

/**
 * The card's prize OPPORTUNITY (null when the campaign has no prize or none is left). `guaranteed` only when every qualified view
 * wins while stock lasts, so the card never implies a guaranteed prize otherwise.
 */
export function prizeOpportunity(
  c: { prizeInventory: number; prizesAwarded: number },
  content: WatchContent,
) {
  const p = content.prize;
  if (!p) return null;
  const remaining = Math.max(0, c.prizeInventory - c.prizesAwarded);
  if (remaining <= 0) return null;
  return {
    title: p.title,
    kind: p.kind,
    remaining,
    guaranteed: p.winProbabilityBps >= PRIZE_DRAW_SPACE,
  };
}

const DRAW_INCLUDE = {
  view: {
    include: {
      campaign: { include: { organization: { include: { merchant: true } } } },
    },
  },
} satisfies Prisma.WatchPrizeDrawInclude;
type DrawRow = Prisma.WatchPrizeDrawGetPayload<{ include: typeof DRAW_INCLUDE }>;
type Input = { code: string; source: 'QR' | 'MANUAL' };

/**
 * Watch & Earn INSTANT PRIZES (WE-05, WE-44; FDR-19 decided 2026-10-16).
 *  - Every qualified view earns DealDash's points (unchanged). A campaign MAY add merchant / sponsor-funded prizes.
 *  - Right after a view qualifies (inside the same transaction), the SERVER decides: eligibility (risk review, per-customer limit,
 *    stock, guardrails), then a cryptographically random roll against the campaign's probability (capped by DealDash guardrails).
 *  - A winning roll claims ONE prize with a single conditional update (`prizesAwarded < prizeInventory`): never oversold, never
 *    awarded once the stock is gone. The decision row is unique per view, so a repeated completion or callback cannot create a
 *    second decision or prize. Every decision is recorded (eligibility, probability, roll, stock before / after) and audited.
 *  - A won prize is an entitlement with a QR / manual code, an expiry and its branches, redeemed by merchant staff through the SAME
 *    staff flow as reservations and vouchers (this service plugs into it). Nothing here is decided by the customer's or the
 *    merchant's app.
 */
@Injectable()
export class WatchPrizeService implements StaffCodeExtension, OnModuleInit {
  /** The server's random source (a uniform integer in [0, n)). Tests may replace it; production uses node:crypto. */
  random: (n: number) => number = (n) => randomInt(n);

  constructor(
    private readonly core: WatchCoreService,
    private readonly redemptions: RedemptionService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  onModuleInit() {
    this.redemptions.registerExtension(this);
  }

  // ================================================================ the decision (inside the qualification transaction)
  async draw(
    tx: Prisma.TransactionClient,
    a: {
      campaign: { id: string; organizationId: string; prizeInventory: number };
      content: WatchContent;
      viewId: string;
      userId: string;
      /** The view's reward is held for risk review: not eligible to win (fraud control). */
      held: boolean;
      guardrails: WatchPrizeGuardrails;
      now: Date;
    },
  ) {
    const p = a.content.prize;
    if (!p) return null;
    const existing = await tx.watchPrizeDraw.findUnique({ where: { viewId: a.viewId } });
    if (existing) return existing; // already decided for this view (idempotent)

    let ineligible: WatchPrizeIneligible | null = null;
    if (!a.guardrails.enabled) ineligible = 'GUARDRAILS_DISABLED';
    else if (a.held) ineligible = 'RISK_REVIEW';
    else {
      const mine = await tx.watchPrizeDraw.count({
        where: { campaignId: a.campaign.id, userId: a.userId, won: true },
      });
      if (mine >= p.perCustomerLimit) ineligible = 'CUSTOMER_LIMIT';
    }
    const stock = await tx.watchCampaign.findUniqueOrThrow({
      where: { id: a.campaign.id },
      select: { prizeInventory: true, prizesAwarded: true },
    });
    const before = Math.max(0, stock.prizeInventory - stock.prizesAwarded);
    if (!ineligible && before <= 0) ineligible = 'OUT_OF_STOCK';
    // the campaign's probability, never above DealDash's guardrail in force at the moment of the draw
    const probabilityBps = Math.min(p.winProbabilityBps, a.guardrails.maxWinProbabilityBps);
    const decision = decidePrize({
      ineligible,
      probabilityBps,
      roll: () => this.random(PRIZE_DRAW_SPACE),
    });
    let won = false;
    let after = before;
    if (decision.wins) {
      // the one decisive step: only a claim within the inventory succeeds (concurrent winners can never oversell)
      const claimed = await tx.watchCampaign.updateMany({
        where: { id: a.campaign.id, prizesAwarded: { lt: stock.prizeInventory } },
        data: { prizesAwarded: { increment: 1 } },
      });
      if (claimed.count === 1) {
        won = true;
        after = before - 1;
      } else ineligible = 'OUT_OF_STOCK';
    }
    const row = await tx.watchPrizeDraw.create({
      data: {
        campaignId: a.campaign.id,
        viewId: a.viewId,
        userId: a.userId,
        organizationId: a.campaign.organizationId,
        eligible: !ineligible,
        ineligibleReason: ineligible,
        probabilityBps,
        roll: decision.roll,
        won,
        inventoryBefore: before,
        inventoryAfter: after,
        status: won ? 'ISSUED' : 'NOT_WON',
        prizeTitleEn: p.title.en,
        prizeTitleAr: p.title.ar,
        prizeKind: p.kind,
        ...(won
          ? {
              reference: newPrizeRef(),
              qrToken: newQrToken(),
              manualCode: newManualCode(),
              branchIds: p.branchIds,
              expiresAt: new Date(a.now.getTime() + p.validityDays * DAY),
            }
          : {}),
        createdAt: a.now,
      },
    });
    await this.core.audit.record(
      {
        action: won ? 'watch.prize_awarded' : 'watch.prize_not_awarded',
        entityType: 'WatchPrizeDraw',
        entityId: row.id,
        actorRole: 'SYSTEM',
        subjectOrganizationId: a.campaign.organizationId,
        newState: {
          campaignId: a.campaign.id,
          viewId: a.viewId,
          userId: a.userId,
          eligible: !ineligible,
          ineligibleReason: ineligible,
          probabilityBps,
          roll: decision.roll,
          won,
          inventoryBefore: before,
          inventoryAfter: after,
          status: row.status,
          at: a.now.toISOString(),
        },
      },
      tx,
    );
    return row;
  }

  /**
   * The winner's in-app notification (shared notification engine, NT dedupe): built only from a decision row that WON, i.e.
   * after the server allocated the prize. The dedupe key is the decision itself, so a repeated completion, retry or callback
   * can never create a second notification. It carries what the customer needs (merchant, campaign, prize, validity, where to
   * open it) and nothing about the allocation (no probability, roll or stock) and no redemption code.
   */
  async winnerNotice(
    tx: Prisma.TransactionClient,
    row: {
      id: string;
      won: boolean;
      campaignId: string;
      userId: string;
      prizeTitleEn: string;
      prizeTitleAr: string;
      expiresAt: Date | null;
      organizationId: string;
    },
    campaign: { titleEn: string; titleAr: string },
  ): Promise<NotificationInput | null> {
    if (!row.won) return null;
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: row.organizationId },
      include: { merchant: true },
    });
    const merchant = merchantDisplayName(org);
    return {
      userId: row.userId,
      type: 'PRIZE_WON',
      dedupeKey: `prize-won:${row.id}`,
      data: {
        prizeId: row.id,
        campaignId: row.campaignId,
        merchantNameEn: merchant.en,
        merchantNameAr: merchant.ar,
        campaignTitleEn: campaign.titleEn,
        campaignTitleAr: campaign.titleAr,
        // the prize is the "deal" of the shared templates (push body, inbox row)
        dealTitleEn: row.prizeTitleEn,
        dealTitleAr: row.prizeTitleAr,
        expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      },
    };
  }

  // ================================================================ customer views
  private branchNames = async (orgId: string, ids: string[]) => {
    const rows = await this.prisma.merchantBranch.findMany({
      where: {
        organizationId: orgId,
        status: 'ACTIVE',
        ...(ids.length ? { id: { in: ids } } : {}),
      },
      orderBy: { nameEn: 'asc' },
      select: { nameEn: true, nameAr: true },
    });
    return rows.map((b) => ({ en: b.nameEn, ar: b.nameAr }));
  };

  private async view(d: DrawRow, now: Date): Promise<WonPrize> {
    const c = d.view.campaign;
    const content = this.core.content(c);
    const expired = d.status === 'EXPIRED' || (!!d.expiresAt && d.expiresAt <= now);
    const status = d.status === 'ISSUED' && expired ? 'EXPIRED' : d.status;
    return {
      id: d.id,
      reference: d.reference ?? '',
      title: { en: d.prizeTitleEn, ar: d.prizeTitleAr },
      kind: (d.prizeKind ?? 'FREE_ITEM') as WatchPrizeKind,
      merchantName: merchantDisplayName(c.organization),
      campaignTitle: content.title,
      status,
      code:
        status === 'ISSUED' && d.qrToken && d.manualCode
          ? { qr: `${PRIZE_QR_PREFIX}${d.qrToken}`, manual: d.manualCode }
          : null,
      branches: await this.branchNames(c.organizationId, d.branchIds),
      wonAt: d.createdAt.toISOString(),
      expiresAt: (d.expiresAt ?? d.createdAt).toISOString(),
      redeemedAt: d.redeemedAt ? d.redeemedAt.toISOString() : null,
    };
  }

  /** The decision for one of the customer's views (the outcome screen). */
  async forView(userId: string, viewId: string, now = new Date()) {
    const d = await this.prisma.watchPrizeDraw.findFirst({
      where: { viewId, userId },
      include: DRAW_INCLUDE,
    });
    if (!d) return null;
    return { won: d.won, prize: d.won ? await this.view(d, now) : null };
  }

  /** The customer's prizes (Rewards → Your prizes), newest first. */
  async mine(userId: string, now = new Date()): Promise<WonPrize[]> {
    const rows = await this.prisma.watchPrizeDraw.findMany({
      where: { userId, won: true },
      include: DRAW_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(rows.map((r) => this.view(r, now)));
  }

  /** One of the customer's won prizes (another customer's, or a decision that did not win, is not found). */
  async one(userId: string, id: string, now = new Date()): Promise<WonPrize> {
    const d = await this.prisma.watchPrizeDraw.findFirst({
      where: { id, userId, won: true },
      include: DRAW_INCLUDE,
    });
    if (!d) throw AppError.notFound();
    return this.view(d, now);
  }

  // ================================================================ staff (same flow as reservations and vouchers)
  private async lookup(input: Input): Promise<DrawRow | null | 'NOT_MINE'> {
    const raw = input.code.trim();
    if (raw.startsWith(PRIZE_QR_PREFIX)) {
      const token = raw.slice(PRIZE_QR_PREFIX.length);
      if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null;
      return this.prisma.watchPrizeDraw.findFirst({
        where: { qrToken: token },
        include: DRAW_INCLUDE,
      });
    }
    const manual = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (manual.length !== 8) return 'NOT_MINE';
    const hit = await this.prisma.watchPrizeDraw.findFirst({
      where: { manualCode: manual },
      include: DRAW_INCLUDE,
    });
    return hit ?? 'NOT_MINE';
  }

  /** Where the prize is redeemed: the staff member's branch (or override) when it is a prize branch, else the first one. */
  private async branchFor(d: DrawRow, scope: StaffScope, override: string | null) {
    const wanted = scope.branchId ?? override;
    const branches = await this.prisma.merchantBranch.findMany({
      where: {
        organizationId: d.organizationId,
        ...(d.branchIds.length ? { id: { in: d.branchIds } } : {}),
      },
      orderBy: { nameEn: 'asc' },
    });
    if (wanted) return branches.find((b) => b.id === wanted) ?? null;
    return branches.find((b) => b.status === 'ACTIVE') ?? branches[0] ?? null;
  }

  private async assess(
    d: DrawRow | null,
    scope: StaffScope,
    override: string | null,
    now: Date,
  ): Promise<{ result: RedemptionResult; branchId: string | null }> {
    // a prize of another merchant is indistinguishable from an unknown code
    if (!d || d.organizationId !== scope.organizationId || !d.won)
      return { result: 'INVALID_CODE', branchId: null };
    const branch = await this.branchFor(d, scope, override);
    if (!branch) return { result: 'WRONG_BRANCH', branchId: null };
    if (d.status === 'REDEEMED') return { result: 'ALREADY_REDEEMED', branchId: branch.id };
    if (d.status === 'EXPIRED' || !d.expiresAt || d.expiresAt.getTime() <= now.getTime())
      return { result: 'EXPIRED', branchId: branch.id };
    if (d.view.campaign.organization.status !== 'ACTIVE')
      return { result: 'CAMPAIGN_UNAVAILABLE', branchId: branch.id };
    return { result: 'VALID', branchId: branch.id };
  }

  private async summary(
    d: DrawRow | null,
    result: RedemptionResult,
    scope: StaffScope,
    branchId: string | null,
  ): Promise<StaffReservationSummary | null> {
    if (!d || d.organizationId !== scope.organizationId || !d.won) return null;
    const c = d.view.campaign;
    const at = branchId
      ? await this.prisma.merchantBranch.findUnique({ where: { id: branchId } })
      : null;
    const redeemedAt = d.redeemedBranchId
      ? await this.prisma.merchantBranch.findUnique({ where: { id: d.redeemedBranchId } })
      : null;
    const valid = await this.branchNames(d.organizationId, d.branchIds);
    const user = await this.prisma.user.findUnique({
      where: { id: d.userId },
      select: { displayName: true, customer: { select: { firstName: true } } },
    });
    return {
      kind: 'PRIZE',
      money: null,
      faceValueHalalas: null,
      ref: d.reference ?? '',
      quantity: 1,
      dealTitle: { en: d.prizeTitleEn, ar: d.prizeTitleAr },
      offerLabel: this.core.content(c).title,
      merchantName: merchantDisplayName(c.organization),
      branchName: at ? { en: at.nameEn, ar: at.nameAr } : (valid[0] ?? { en: '', ar: '' }),
      customerFirstName:
        (user?.customer?.firstName || user?.displayName.split(' ')[0] || '').trim() || null,
      expiresAt: (d.expiresAt ?? d.createdAt).toISOString(),
      startsAt: null,
      redeemedAt: d.redeemedAt ? d.redeemedAt.toISOString() : null,
      redeemedBranchName: redeemedAt ? { en: redeemedAt.nameEn, ar: redeemedAt.nameAr } : null,
      validBranchName:
        result === 'WRONG_BRANCH'
          ? {
              en: valid.map((b) => b.en).join(', '),
              ar: valid.map((b) => b.ar).join('، '),
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
    branchId: string | null,
    idempotencyKey: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    await (tx ?? this.prisma).redemptionAttempt.create({
      data: {
        staffUserId: actor.userId,
        organizationId: scope.organizationId,
        branchId: scope.branchId ?? branchId,
        codeHint: codeHint(input.code),
        source: input.source,
        kind,
        result,
        idempotencyKey,
      },
    });
  }

  async validate(
    actor: Actor,
    scope: StaffScope,
    input: Input,
    branchOverride: string | null,
    now: Date,
  ) {
    const d = await this.lookup(input);
    if (d === 'NOT_MINE') return null;
    const { result, branchId } = await this.assess(d, scope, branchOverride, now);
    await this.logAttempt(actor, scope, input, 'VALIDATE', result, branchId, null);
    return {
      result,
      reservation: await this.summary(d, result, scope, branchId),
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
    let d = await this.lookup(input);
    if (d === 'NOT_MINE') return null;
    // same staff member, same key: the same success again (a request retried after a bad connection)
    if (idempotencyKey && d && d.redeemIdempotencyKey === idempotencyKey) {
      if (d.redeemedByUserId === actor.userId && d.status === 'REDEEMED')
        return {
          result: 'REDEEMED' as const,
          reference: d.reference,
          redeemedAt: d.redeemedAt ? d.redeemedAt.toISOString() : null,
          reservation: await this.summary(d, 'REDEEMED', scope, d.redeemedBranchId),
          serverNow: now.toISOString(),
        };
    }
    let { result, branchId } = await this.assess(d, scope, branchOverride, now);
    let redeemedAt: Date | null = null;
    if (result === 'VALID' && d && branchId) {
      const target = d;
      const at = branchId;
      const won = await this.prisma.$transaction(async (tx) => {
        // the one decisive step: only one caller can move ISSUED -> REDEEMED
        const claimed = await tx.watchPrizeDraw.updateMany({
          where: { id: target.id, status: 'ISSUED', expiresAt: { gt: now } },
          data: {
            status: 'REDEEMED',
            redeemedAt: now,
            redeemedBranchId: at,
            redeemedByUserId: actor.userId,
            redeemIdempotencyKey: idempotencyKey,
          },
        });
        if (claimed.count !== 1) return false;
        await this.core.audit.record(
          {
            action: 'watch.prize_redeemed',
            entityType: 'WatchPrizeDraw',
            entityId: target.id,
            actor,
            subjectOrganizationId: target.organizationId,
            previousState: { status: 'ISSUED' },
            newState: { status: 'REDEEMED', branchId: at, source: input.source },
            meta,
          },
          tx,
        );
        await this.logAttempt(actor, scope, input, 'REDEEM', 'REDEEMED', at, idempotencyKey, tx);
        return true;
      });
      d = await this.prisma.watchPrizeDraw.findUnique({
        where: { id: target.id },
        include: DRAW_INCLUDE,
      });
      if (won) {
        result = 'REDEEMED';
        redeemedAt = now;
      } else {
        // lost the race (or it expired in this very moment): report what is true now
        ({ result, branchId } = await this.assess(d, scope, branchOverride, now));
        if (result === 'VALID') result = 'ALREADY_REDEEMED';
        await this.logAttempt(actor, scope, input, 'REDEEM', result, branchId, idempotencyKey);
      }
    } else {
      await this.logAttempt(actor, scope, input, 'REDEEM', result, branchId, idempotencyKey);
    }
    return {
      result,
      reference: result === 'REDEEMED' && d ? d.reference : null,
      redeemedAt: redeemedAt ? redeemedAt.toISOString() : null,
      reservation: await this.summary(d, result, scope, branchId),
      serverNow: now.toISOString(),
    };
  }

  /** Prize attempts are not linked to reservations or vouchers: nothing to add to those history rows. */
  async historyDetails() {
    return new Map<
      string,
      {
        reference: string;
        title: { en: string; ar: string };
        quantity: number;
        customerFirstName: string | null;
      }
    >();
  }
}
