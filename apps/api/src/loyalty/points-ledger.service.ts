import { Injectable } from '@nestjs/common';
import type { RewardBucket, RewardEntryType } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';

export interface PointsEntryInput {
  type: RewardEntryType;
  bucket: RewardBucket;
  /** Signed change applied to `bucket`. */
  points: number;
  sourceType: 'VIEW' | 'REDEMPTION' | 'ADJUSTMENT' | 'EXPIRY' | 'EVENT';
  sourceId?: string | null;
  reasonCode?: string | null;
  actorType?: 'SYSTEM' | 'CUSTOMER' | 'ADMIN';
  actorUserId?: string | null;
  actorRole?: string | null;
  expiresAt?: Date | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  earned?: boolean;
  redeemed?: boolean;
  // ---- shared loyalty: why the points exist and who paid for them
  sourceProduct?: string | null;
  sourceCampaignId?: string | null;
  campaignVersion?: number | null;
  ruleId?: string | null;
  fundingSource?: string;
  fundingOrganizationId?: string | null;
  financialRef?: string | null;
  correlationId?: string | null;
}

/**
 * The ONE points ledger (append-only). Watch & Earn rewards and every loyalty rule write through this service, so the balance can
 * only move together with an entry that says who, what, why and who funded it. The cached balance changes in the same statement
 * as the entry is written; nothing overwrites a balance silently.
 */
@Injectable()
export class PointsLedgerService {
  async ensureAccount(tx: Prisma.TransactionClient, userId: string): Promise<string> {
    await tx.$executeRaw`INSERT INTO "RewardAccount" ("id", "userId", "updatedAt")
      VALUES (gen_random_uuid(), ${userId}::uuid, now()) ON CONFLICT ("userId") DO NOTHING`;
    const a = await tx.rewardAccount.findUniqueOrThrow({ where: { userId }, select: { id: true } });
    return a.id;
  }

  /** Writes one ledger entry and moves the cached balance by the same amount. Idempotent per key. */
  async apply(tx: Prisma.TransactionClient, userId: string, i: PointsEntryInput) {
    const existing = await tx.rewardEntry.findUnique({
      where: { idempotencyKey: i.idempotencyKey },
    });
    if (existing) return { entry: existing, created: false };
    const accountId = await this.ensureAccount(tx, userId);
    const a = i.bucket === 'AVAILABLE' ? i.points : 0;
    const h = i.bucket === 'HELD' ? i.points : 0;
    const rows = await tx.$queryRaw<Array<{ availableBalance: number; heldBalance: number }>>`
      UPDATE "RewardAccount"
      SET "availableBalance" = "availableBalance" + ${a}, "heldBalance" = "heldBalance" + ${h},
          "lifetimeEarned" = "lifetimeEarned" + ${i.earned ? Math.max(0, i.points) : 0},
          "lifetimeRedeemed" = "lifetimeRedeemed" + ${i.redeemed ? Math.abs(i.points) : 0},
          "updatedAt" = now()
      WHERE "id" = ${accountId}::uuid
      RETURNING "availableBalance", "heldBalance"`;
    const after = rows[0]!;
    const entry = await tx.rewardEntry.create({
      data: {
        accountId,
        type: i.type,
        bucket: i.bucket,
        points: i.points,
        availableAfter: after.availableBalance,
        heldAfter: after.heldBalance,
        sourceType: i.sourceType,
        sourceId: i.sourceId ?? null,
        reasonCode: i.reasonCode ?? null,
        actorType: i.actorType ?? 'SYSTEM',
        actorUserId: i.actorUserId ?? null,
        actorRole: i.actorRole ?? null,
        expiresAt: i.expiresAt ?? null,
        idempotencyKey: i.idempotencyKey,
        metadata: (i.metadata ?? {}) as Prisma.InputJsonValue,
        sourceProduct: i.sourceProduct ?? (i.sourceType === 'VIEW' ? 'WATCH' : null),
        sourceCampaignId: i.sourceCampaignId ?? null,
        campaignVersion: i.campaignVersion ?? null,
        ruleId: i.ruleId ?? null,
        fundingSource: i.fundingSource ?? 'DEALDASH',
        fundingOrganizationId: i.fundingOrganizationId ?? null,
        financialRef: i.financialRef ?? null,
        correlationId: i.correlationId ?? null,
      },
    });
    return { entry, created: true };
  }

  /** A lot tracks how much of an EARN / RELEASE entry is still unspent, and when it expires. */
  async lot(
    tx: Prisma.TransactionClient,
    accountId: string,
    entryId: string,
    points: number,
    expiresAt: Date | null,
  ) {
    await tx.rewardLot.create({
      data: { accountId, entryId, points, remaining: points, expiresAt },
    });
  }

  /** Takes points out of the lots (oldest expiry first; `preferEntryId` first for reversals). Returns what the lots covered. */
  async consumeLots(
    tx: Prisma.TransactionClient,
    accountId: string,
    points: number,
    preferEntryId?: string,
  ): Promise<number> {
    let left = points;
    const lots = await tx.$queryRaw<Array<{ id: string; remaining: number }>>`
      SELECT "id", "remaining" FROM "RewardLot"
      WHERE "accountId" = ${accountId}::uuid AND "remaining" > 0
      ORDER BY ${preferEntryId ? Prisma.sql`("entryId" = ${preferEntryId}::uuid) DESC,` : Prisma.empty}
               "expiresAt" ASC NULLS LAST, "createdAt" ASC
      FOR UPDATE`;
    for (const l of lots) {
      if (left <= 0) break;
      const take = Math.min(left, l.remaining);
      await tx.$executeRaw`UPDATE "RewardLot" SET "remaining" = "remaining" - ${take} WHERE "id" = ${l.id}::uuid`;
      left -= take;
    }
    return points - left;
  }
}
