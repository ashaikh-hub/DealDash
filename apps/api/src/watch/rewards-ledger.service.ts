import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RewardEntryView, RewardItemView, RewardSummary } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import { PointsLedgerService, type PointsEntryInput } from '../loyalty/points-ledger.service';
import { WatchCoreService } from './watch-core.service';

export type ApplyInput = PointsEntryInput;

const newRedeemCode = () => `RW-${randomBytes(5).toString('hex').toUpperCase()}`;

/**
 * Reward points ledger (append-only). Points are a non-cash incentive: not money, not withdrawable, not transferable and no
 * SAR value exists anywhere in the model. Every change is a new entry carrying the customer, source, amount, bucket, reason,
 * actor and time; the cached balances on the account change in the SAME transaction through one SQL statement, so they cannot
 * drift (a test checks them against the entries) and nothing ever overwrites a balance silently.
 *
 *   EARN              points arrive in the available bucket
 *   HOLD / RELEASE    points arrive in the held bucket, later move to available (two legs of one release)
 *   REVERSE           points removed (fraud or an invalid view), from whichever bucket holds them
 *   REDEEM / EXPIRE   points leave the available bucket
 *   ADMIN_ADJUSTMENT  an authorised manual credit or debit
 */
@Injectable()
export class RewardsLedgerService {
  constructor(
    private readonly core: WatchCoreService,
    private readonly points: PointsLedgerService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  // ---------------------------------------------------------------- account + entries (one shared points ledger)
  ensureAccount(tx: Prisma.TransactionClient, userId: string): Promise<string> {
    return this.points.ensureAccount(tx, userId);
  }

  /** Writes one ledger entry and moves the cached balance by the same amount. Idempotent per key. */
  apply(tx: Prisma.TransactionClient, userId: string, i: ApplyInput) {
    return this.points.apply(tx, userId, i);
  }

  private lot(tx: Prisma.TransactionClient, accountId: string, entryId: string, points: number, expiresAt: Date | null) {
    return this.points.lot(tx, accountId, entryId, points, expiresAt);
  }

  private consumeLots(tx: Prisma.TransactionClient, accountId: string, points: number, preferEntryId?: string): Promise<number> {
    return this.points.consumeLots(tx, accountId, points, preferEntryId);
  }
  private async expiryFor(now: Date): Promise<Date | null> {
    const r = await this.core.rewardsRules();
    return r.expiryDays ? new Date(now.getTime() + r.expiryDays * 86_400_000) : null;
  }

  // ---------------------------------------------------------------- earning (called by the qualification pipeline)
  /** Credits a qualified view's reward: available now, or held for the review period. Exactly once per view. */
  async earnForView(
    tx: Prisma.TransactionClient,
    userId: string,
    viewId: string,
    points: number,
    held: boolean,
    now: Date,
    expiryDays?: number | null,
  ) {
    if (points <= 0) return null;
    const expiresAt =
      expiryDays === undefined
        ? await this.expiryFor(now)
        : expiryDays
          ? new Date(now.getTime() + expiryDays * 86_400_000)
          : null;
    if (held) {
      const r = await this.apply(tx, userId, {
        type: 'HOLD',
        bucket: 'HELD',
        points,
        sourceType: 'VIEW',
        sourceId: viewId,
        reasonCode: 'REVIEW_HOLD',
        idempotencyKey: `reward:view:${viewId}:hold`,
        earned: true,
      });
      return r.entry;
    }
    const r = await this.apply(tx, userId, {
      type: 'EARN',
      bucket: 'AVAILABLE',
      points,
      sourceType: 'VIEW',
      sourceId: viewId,
      expiresAt,
      idempotencyKey: `reward:view:${viewId}:earn`,
      earned: true,
    });
    if (r.created) await this.lot(tx, r.entry.accountId, r.entry.id, points, expiresAt);
    return r.entry;
  }

  /** Moves a held reward to the available bucket. Returns false when it was not held (already released or reversed). */
  async release(
    tx: Prisma.TransactionClient,
    viewId: string,
    reason: string,
    actor?: { userId: string; role: string | null },
    now = new Date(),
  ): Promise<boolean> {
    const claim = await tx.watchView.updateMany({
      where: { id: viewId, rewardState: 'HELD' },
      data: { rewardState: 'EARNED' },
    });
    if (claim.count !== 1) return false;
    const v = await tx.watchView.findUniqueOrThrow({ where: { id: viewId } });
    const expiresAt = await this.expiryFor(now);
    const meta = {
      actorType: actor ? ('ADMIN' as const) : ('SYSTEM' as const),
      actorUserId: actor?.userId ?? null,
      actorRole: actor?.role ?? null,
    };
    await this.apply(tx, v.userId, {
      type: 'RELEASE',
      bucket: 'HELD',
      points: -v.rewardPoints,
      sourceType: 'VIEW',
      sourceId: viewId,
      reasonCode: reason,
      idempotencyKey: `reward:view:${viewId}:release:held`,
      ...meta,
    });
    const a = await this.apply(tx, v.userId, {
      type: 'RELEASE',
      bucket: 'AVAILABLE',
      points: v.rewardPoints,
      sourceType: 'VIEW',
      sourceId: viewId,
      reasonCode: reason,
      expiresAt,
      idempotencyKey: `reward:view:${viewId}:release:available`,
      ...meta,
    });
    if (a.created) await this.lot(tx, a.entry.accountId, a.entry.id, v.rewardPoints, expiresAt);
    return true;
  }

  /** Removes a view's reward (fraud or an invalid view), whichever bucket currently holds it. Exactly once. */
  async reverse(
    tx: Prisma.TransactionClient,
    viewId: string,
    reason: string,
    actor?: { userId: string; role: string | null },
  ): Promise<boolean> {
    const v = await tx.watchView.findUnique({ where: { id: viewId } });
    if (!v || (v.rewardState !== 'EARNED' && v.rewardState !== 'HELD')) return false;
    const claim = await tx.watchView.updateMany({
      where: { id: viewId, rewardState: v.rewardState },
      data: { rewardState: 'REVERSED' },
    });
    if (claim.count !== 1) return false;
    const fromHeld = v.rewardState === 'HELD';
    const rules = await this.core.rewardsRules();
    const account = await tx.rewardAccount.findUniqueOrThrow({ where: { userId: v.userId } });
    let points = v.rewardPoints;
    // Policy: either the available bucket may go negative (the customer owes the points back) or the reversal stops at zero.
    if (!fromHeld && rules.negativeBalancePolicy === 'HOLD_AT_ZERO')
      points = Math.min(points, Math.max(0, account.availableBalance));
    if (points <= 0) return true;
    const e = await this.apply(tx, v.userId, {
      type: 'REVERSE',
      bucket: fromHeld ? 'HELD' : 'AVAILABLE',
      points: -points,
      sourceType: 'VIEW',
      sourceId: viewId,
      reasonCode: reason,
      actorType: actor ? 'ADMIN' : 'SYSTEM',
      actorUserId: actor?.userId ?? null,
      actorRole: actor?.role ?? null,
      idempotencyKey: `reward:view:${viewId}:reverse`,
      metadata: { shortfall: v.rewardPoints - points },
    });
    if (!fromHeld && e.created) {
      const earnEntry = await tx.rewardEntry.findFirst({
        where: {
          sourceType: 'VIEW',
          sourceId: viewId,
          type: { in: ['EARN', 'RELEASE'] },
          bucket: 'AVAILABLE',
        },
        select: { id: true },
      });
      await this.consumeLots(tx, e.entry.accountId, points, earnEntry?.id);
    }
    return true;
  }

  // ---------------------------------------------------------------- redemption (configurable catalogue)
  async redeem(userId: string, itemId: string, idempotencyKey: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const accountId = await this.ensureAccount(tx, userId);
      const dup = await tx.rewardRedemption.findUnique({
        where: { accountId_idempotencyKey: { accountId, idempotencyKey } },
        include: { item: true },
      });
      if (dup) {
        const acc = await tx.rewardAccount.findUniqueOrThrow({ where: { id: accountId } });
        return {
          redemptionId: dup.id,
          itemName: { en: dup.item.nameEn, ar: dup.item.nameAr },
          pointsCost: dup.pointsCost,
          code: dup.code,
          availableBalance: acc.availableBalance,
        };
      }
      const item = await tx.rewardCatalogueItem.findFirst({
        where: { id: itemId, status: 'ACTIVE' },
      });
      if (!item) throw AppError.notFound();
      // stock: one conditional update (unlimited stock = null)
      if (item.stock !== null) {
        const n =
          await tx.$executeRaw`UPDATE "RewardCatalogueItem" SET "stock" = "stock" - 1, "updatedAt" = now()
          WHERE "id" = ${item.id}::uuid AND "stock" > 0`;
        if (n !== 1) throw new AppError('REWARD_OUT_OF_STOCK', 'This reward is out of stock', 409);
      }
      // balance: one conditional update, so two simultaneous redemptions can never spend the same points
      const ok = await tx.$executeRaw`UPDATE "RewardAccount"
        SET "availableBalance" = "availableBalance" - ${item.pointsCost}, "lifetimeRedeemed" = "lifetimeRedeemed" + ${item.pointsCost},
            "updatedAt" = now()
        WHERE "id" = ${accountId}::uuid AND "availableBalance" >= ${item.pointsCost}`;
      if (ok !== 1)
        throw new AppError(
          'REWARD_INSUFFICIENT',
          'You do not have enough points for this reward',
          409,
        );
      const acc = await tx.rewardAccount.findUniqueOrThrow({ where: { id: accountId } });
      const entry = await tx.rewardEntry.create({
        data: {
          accountId,
          type: 'REDEEM',
          bucket: 'AVAILABLE',
          points: -item.pointsCost,
          availableAfter: acc.availableBalance,
          heldAfter: acc.heldBalance,
          sourceType: 'REDEMPTION',
          sourceId: item.id,
          actorType: 'CUSTOMER',
          actorUserId: userId,
          idempotencyKey: `reward:redeem:${accountId}:${idempotencyKey}`,
          metadata: { itemId: item.id, sample: item.isSample },
        },
      });
      await this.consumeLots(tx, accountId, item.pointsCost);
      const red = await tx.rewardRedemption.create({
        data: {
          accountId,
          itemId: item.id,
          entryId: entry.id,
          pointsCost: item.pointsCost,
          code: newRedeemCode(),
          idempotencyKey,
          expiresAt: item.validityDays
            ? new Date(now.getTime() + item.validityDays * 86_400_000)
            : null,
        },
      });
      return {
        redemptionId: red.id,
        itemName: { en: item.nameEn, ar: item.nameAr },
        pointsCost: item.pointsCost,
        code: red.code,
        availableBalance: acc.availableBalance,
      };
    });
  }

  // ---------------------------------------------------------------- expiry (off until the founder decides: VALIDATE-KSA)
  async expireDue(now: Date, take = 200): Promise<number> {
    // lots only carry an expiry date when an expiry was configured (platform default or a loyalty rule), so no further check is needed
    let n = 0;
    const lots = await this.prisma.rewardLot.findMany({
      where: { remaining: { gt: 0 }, expiresAt: { lte: now } },
      take,
    });
    for (const l of lots) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.$executeRaw`UPDATE "RewardLot" SET "remaining" = 0
            WHERE "id" = ${l.id}::uuid AND "remaining" > 0`;
          if (claimed !== 1) return;
          const cur = await tx.rewardLot.findUniqueOrThrow({ where: { id: l.id } });
          const acc = await tx.rewardAccount.findUniqueOrThrow({ where: { id: l.accountId } });
          await this.apply(tx, acc.userId, {
            type: 'EXPIRE',
            bucket: 'AVAILABLE',
            points: -l.remaining,
            sourceType: 'EXPIRY',
            sourceId: cur.id,
            reasonCode: 'EXPIRED',
            idempotencyKey: `reward:expire:${l.id}`,
          });
          n++;
        });
      } catch {
        /* another instance expired it first */
      }
    }
    return n;
  }

  // ---------------------------------------------------------------- admin adjustments (applied after any required second approval)
  async applyAdjustment(
    tx: Prisma.TransactionClient,
    adj: { id: string; userId: string; points: number; reasonCode: string },
    actor: { userId: string; role: string | null },
  ) {
    const accountId = await this.ensureAccount(tx, adj.userId);
    if (adj.points < 0) {
      const ok = await tx.$executeRaw`UPDATE "RewardAccount"
        SET "availableBalance" = "availableBalance" + ${adj.points}, "updatedAt" = now()
        WHERE "id" = ${accountId}::uuid AND "availableBalance" + ${adj.points} >= 0`;
      if (ok !== 1)
        throw new AppError(
          'REWARD_INSUFFICIENT',
          'The customer does not have that many points to remove',
          409,
        );
      const acc = await tx.rewardAccount.findUniqueOrThrow({ where: { id: accountId } });
      const entry = await tx.rewardEntry.create({
        data: {
          accountId,
          type: 'ADMIN_ADJUSTMENT',
          bucket: 'AVAILABLE',
          points: adj.points,
          availableAfter: acc.availableBalance,
          heldAfter: acc.heldBalance,
          sourceType: 'ADJUSTMENT',
          sourceId: adj.id,
          reasonCode: adj.reasonCode,
          actorType: 'ADMIN',
          actorUserId: actor.userId,
          actorRole: actor.role,
          idempotencyKey: `reward:adjust:${adj.id}`,
        },
      });
      await this.consumeLots(tx, accountId, -adj.points);
      return entry;
    }
    const expiresAt = await this.expiryFor(new Date());
    const r = await this.apply(tx, adj.userId, {
      type: 'ADMIN_ADJUSTMENT',
      bucket: 'AVAILABLE',
      points: adj.points,
      sourceType: 'ADJUSTMENT',
      sourceId: adj.id,
      reasonCode: adj.reasonCode,
      actorType: 'ADMIN',
      actorUserId: actor.userId,
      actorRole: actor.role,
      expiresAt,
      idempotencyKey: `reward:adjust:${adj.id}`,
      earned: true,
    });
    if (r.created) await this.lot(tx, accountId, r.entry.id, adj.points, expiresAt);
    return r.entry;
  }

  // ---------------------------------------------------------------- customer read models
  async summary(userId: string, now = new Date()): Promise<RewardSummary> {
    const [acc, rules, catalogueCount] = await Promise.all([
      this.prisma.rewardAccount.findUnique({ where: { userId } }),
      this.core.rewardsRules(),
      this.prisma.rewardCatalogueItem.count({ where: { status: 'ACTIVE' } }),
    ]);
    let expiringSoon: RewardSummary['expiringSoon'] = null;
    if (acc && rules.expiryDays) {
      const until = new Date(now.getTime() + rules.expiryReminderDays * 86_400_000);
      const agg = await this.prisma.rewardLot.aggregate({
        where: { accountId: acc.id, remaining: { gt: 0 }, expiresAt: { lte: until, gt: now } },
        _sum: { remaining: true },
        _min: { expiresAt: true },
      });
      if (agg._sum.remaining && agg._min.expiresAt)
        expiringSoon = { points: agg._sum.remaining, at: agg._min.expiresAt.toISOString() };
    }
    return {
      availableBalance: acc?.availableBalance ?? 0,
      heldBalance: acc?.heldBalance ?? 0,
      lifetimeEarned: acc?.lifetimeEarned ?? 0,
      lifetimeRedeemed: acc?.lifetimeRedeemed ?? 0,
      expiringSoon,
      cashValueShown: false,
      catalogueCount,
    };
  }

  /** Customer activity. The held-side leg of a release is hidden (the customer sees one "ready" line, not two). */
  async activity(
    userId: string,
    q: { limit: number; cursor?: string; type?: string },
  ): Promise<Page<RewardEntryView>> {
    const acc = await this.prisma.rewardAccount.findUnique({ where: { userId } });
    if (!acc) return new Page([], null);
    const page = await keysetPage({
      findMany: (query) => this.prisma.rewardEntry.findMany(query),
      baseWhere: {
        accountId: acc.id,
        NOT: { type: 'RELEASE', bucket: 'HELD' },
        ...(q.type ? { type: q.type } : {}),
      } as Record<string, unknown>,
      sort: { field: 'createdAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    return new Page(await this.views(page.items), page.nextCursor);
  }

  async views(
    entries: Array<{
      id: string;
      type: string;
      bucket: string;
      points: number;
      availableAfter: number;
      heldAfter: number;
      sourceType: string;
      sourceId: string | null;
      reasonCode: string | null;
      createdAt: Date;
      expiresAt: Date | null;
    }>,
  ): Promise<RewardEntryView[]> {
    const viewIds = entries
      .filter((e) => e.sourceType === 'VIEW' && e.sourceId)
      .map((e) => e.sourceId!);
    const views = viewIds.length
      ? await this.prisma.watchView.findMany({
          where: { id: { in: viewIds } },
          select: {
            id: true,
            campaign: {
              select: {
                titleEn: true,
                titleAr: true,
                organization: {
                  select: {
                    nameEn: true,
                    nameAr: true,
                    merchant: { select: { tradeNameEn: true, tradeNameAr: true } },
                  },
                },
              },
            },
          },
        })
      : [];
    const byId = new Map(views.map((v) => [v.id, v]));
    return entries.map((e) => {
      const v = e.sourceId ? byId.get(e.sourceId) : undefined;
      const org = v?.campaign.organization;
      return {
        id: e.id,
        type: e.type as never,
        points: e.points,
        bucket: e.bucket as never,
        balanceAfter: e.bucket === 'HELD' ? e.heldAfter : e.availableAfter,
        sourceType: e.sourceType,
        title: v ? { en: v.campaign.titleEn, ar: v.campaign.titleAr } : null,
        merchantName: org
          ? {
              en: org.merchant?.tradeNameEn || org.nameEn,
              ar: org.merchant?.tradeNameAr || org.nameAr,
            }
          : null,
        // customers see a plain reason class, never fraud or detection detail
        reasonClass: e.type === 'REVERSE' ? 'REMOVED' : e.type === 'HOLD' ? 'CHECKING' : null,
        createdAt: e.createdAt.toISOString(),
        expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
      };
    });
  }

  async catalogue(userId: string): Promise<RewardItemView[]> {
    const [items, acc] = await Promise.all([
      this.prisma.rewardCatalogueItem.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ pointsCost: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.rewardAccount.findUnique({ where: { userId } }),
    ]);
    const bal = acc?.availableBalance ?? 0;
    return items.map((i) => ({
      id: i.id,
      name: { en: i.nameEn, ar: i.nameAr },
      description: { en: i.descriptionEn, ar: i.descriptionAr },
      pointsCost: i.pointsCost,
      stockLeft: i.stock,
      isSample: i.isSample,
      canRedeem: bal >= i.pointsCost && (i.stock === null || i.stock > 0),
    }));
  }
}
