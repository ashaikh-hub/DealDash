import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import type { EligibilityExpression } from '@dealdash/types';
import { evaluateEligibility, type EligibilityContext } from '../live-deals/eligibility.service';
import { Prisma } from '../generated/prisma/client';
import { CommercialService } from '../finance/commercial.service';
import { CampaignVersionService } from '../platform/campaign-version.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PointsLedgerService } from './points-ledger.service';

export interface LoyaltyEvent {
  eventType: string;
  userId: string;
  /** The campaign's product: LIVE_DEAL | EXCLUSIVE | VOUCHER | WATCH. */
  product?: string | null;
  campaignId?: string | null;
  /** The business that owns the campaign (business-owned rules apply only to their own campaigns). */
  organizationId?: string | null;
  /** What happened, for idempotency: VIEW | REDEMPTION | PURCHASE ... */
  sourceType: 'VIEW' | 'REDEMPTION' | 'EVENT';
  sourceId: string;
  /** Spend in halalas for spend-based rules (a voucher purchase). */
  amountHalalas?: number;
  city?: string | null;
  correlationId?: string | null;
  now?: Date;
}

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * Turns a VERIFIED product event into loyalty points under the active rules. Never rewards a click: callers only invoke it from
 * qualified views, verified redemptions and settled purchases. Every issuance is capped (per rule, per day, month and customer),
 * names its funder, draws the funder's prepaid funding in the same transaction, and links to the finance record.
 */
@Injectable()
export class LoyaltyIssuanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: PointsLedgerService,
    private readonly commercial: CommercialService,
    private readonly versions: CampaignVersionService,
    private readonly config: SystemConfigService,
  ) {}

  private async rulesFor(tx: Prisma.TransactionClient, ev: LoyaltyEvent, now: Date) {
    return tx.loyaltyRule.findMany({
      where: {
        status: 'ACTIVE',
        eventType: ev.eventType,
        effectiveFrom: { lte: now },
        AND: [
          { OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
          { OR: [{ productScope: null }, ...(ev.product ? [{ productScope: ev.product }] : [])] },
          { OR: [{ campaignId: null }, ...(ev.campaignId ? [{ campaignId: ev.campaignId }] : [])] },
          { OR: [{ organizationId: null }, ...(ev.organizationId ? [{ organizationId: ev.organizationId }] : [])] },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async eligible(tx: Prisma.TransactionClient, ruleSetId: string | null, ev: LoyaltyEvent, now: Date): Promise<boolean> {
    if (!ruleSetId) return true;
    const set = await tx.eligibilityRuleSet.findUnique({ where: { id: ruleSetId }, include: { conditions: true } });
    if (!set) return false;
    const customer = await tx.customer.findUnique({ where: { userId: ev.userId } });
    const attributes = await tx.eligibilityAttribute.findMany({ where: { userId: ev.userId } });
    const ctx: EligibilityContext = { userId: ev.userId, city: customer?.city ?? ev.city ?? '', country: 'SA', attributes, now };
    return (
      evaluateEligibility(
        set.kind,
        set.conditions.map((c) => ({ attrType: c.attrType, valueRef: c.valueRef, requiredLevel: c.requiredLevel })),
        ctx,
        set.expression as EligibilityExpression | null,
      ).result === 'ELIGIBLE'
    );
  }

  /** Signed points already issued by this rule to this customer since `since` (reversals count against the cap). */
  private async issuedSince(tx: Prisma.TransactionClient, ruleId: string, userId: string, since?: Date): Promise<number> {
    const r = await tx.rewardEntry.aggregate({
      _sum: { points: true },
      where: {
        ruleId,
        account: { userId },
        type: { in: ['EARN', 'BONUS', 'REVERSE'] },
        ...(since ? { createdAt: { gte: since } } : {}),
      },
    });
    return r._sum.points ?? 0;
  }

  /**
   * Issues points for every matching rule. Returns what was issued. Never throws for an expected refusal (a cap, an exhausted
   * allocation, missing funding): the customer's primary event must not fail because a bonus could not be paid.
   */
  async issueForEvent(tx: Prisma.TransactionClient, ev: LoyaltyEvent): Promise<Array<{ ruleId: string; points: number; entryId: string }>> {
    const now = ev.now ?? new Date();
    const rules = await this.rulesFor(tx, ev, now);
    if (!rules.length) return [];
    const rewardRules = await this.config.get<{ expiryDays: number | null }>(CONFIG_KEYS.REWARDS_RULES);
    const version = ev.product && ev.campaignId ? await this.versions.current(tx, ev.product === 'LIVE_DEAL' ? 'LIVE_DEAL' : ev.product, ev.campaignId) : null;
    const out: Array<{ ruleId: string; points: number; entryId: string }> = [];
    for (const rule of rules) {
      const key = `loyalty:${rule.id}:${ev.sourceType}:${ev.sourceId}:${ev.userId}`;
      if (await tx.rewardEntry.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) continue;
      if (!(await this.eligible(tx, rule.eligibilityRuleSetId, ev, now))) continue;
      const spend = Math.floor((ev.amountHalalas ?? 0) / 100) * rule.pointsPer100Halalas;
      let points = Math.round(((rule.basePoints + spend) * rule.multiplierBps) / 10_000) + rule.bonusPoints;
      if (points <= 0) continue;
      // ---- caps: the customer never gets more than the rule allows, per day, month and lifetime
      if (rule.dailyCap !== null) points = Math.min(points, rule.dailyCap - (await this.issuedSince(tx, rule.id, ev.userId, startOfDay(now))));
      if (rule.monthlyCap !== null) points = Math.min(points, rule.monthlyCap - (await this.issuedSince(tx, rule.id, ev.userId, startOfMonth(now))));
      if (rule.customerCap !== null) points = Math.min(points, rule.customerCap - (await this.issuedSince(tx, rule.id, ev.userId)));
      // ---- funding: points paid by a business are only issued while its prepaid funding covers them
      let rate = 0;
      if (rule.fundingSource !== 'DEALDASH') {
        rate = rule.fundingHalalasPerPoint ?? 0;
        if (rate > 0) {
          const room = await this.commercial.remainingUnits('LOYALTY', rule.id, tx);
          if (room === null) continue; // not funded (yet)
          points = Math.min(points, room);
        }
      }
      if (points <= 0) continue;
      // ---- allocation ceiling: one conditional update, so concurrent issuances can never go over
      const claimed = await tx.$executeRaw`UPDATE "LoyaltyRule" SET "allocatedPoints" = "allocatedPoints" + ${points}, "updatedAt" = now()
        WHERE "id" = ${rule.id}::uuid AND "status" = 'ACTIVE' AND ("maxAllocationPoints" IS NULL OR "allocatedPoints" + ${points} <= "maxAllocationPoints")`;
      if (claimed !== 1) {
        // the rule has less left than we wanted: issue what remains, if anything
        const fresh = await tx.loyaltyRule.findUnique({ where: { id: rule.id } });
        const left = fresh?.maxAllocationPoints === null || !fresh ? 0 : fresh.maxAllocationPoints - fresh.allocatedPoints;
        if (!fresh || left <= 0) continue;
        points = Math.min(points, left);
        if (rate > 0) {
          const room = await this.commercial.remainingUnits('LOYALTY', rule.id, tx);
          points = Math.min(points, room ?? 0);
        }
        if (points <= 0) continue;
        const again = await tx.$executeRaw`UPDATE "LoyaltyRule" SET "allocatedPoints" = "allocatedPoints" + ${points}, "updatedAt" = now()
          WHERE "id" = ${rule.id}::uuid AND "status" = 'ACTIVE' AND "allocatedPoints" + ${points} <= "maxAllocationPoints"`;
        if (again !== 1) continue;
      }
      let financialRef: string | null = null;
      if (rate > 0) {
        const u = await this.commercial.recordUtilization('LOYALTY', rule.id, { sourceType: 'POINTS', sourceId: key, units: points }, tx);
        financialRef = u.eventIds[0] ?? null;
      }
      const expiryDays = rule.expiryDays ?? rewardRules.expiryDays ?? null;
      const expiresAt = expiryDays ? new Date(now.getTime() + expiryDays * 86_400_000) : null;
      const r = await this.ledger.apply(tx, ev.userId, {
        type: rule.kind === 'BONUS' ? 'BONUS' : 'EARN',
        bucket: 'AVAILABLE',
        points,
        // A view must NOT be recorded as sourceType VIEW: that source is reserved for the Watch & Earn view reward (one credit
        // per view is a database rule, and fraud handling finds view rewards by it). Loyalty uses the generic event source.
        sourceType: ev.sourceType === 'REDEMPTION' ? 'REDEMPTION' : 'EVENT',
        sourceId: ev.sourceType === 'VIEW' ? `view:${ev.sourceId}` : ev.sourceId,
        reasonCode: ev.eventType,
        expiresAt,
        idempotencyKey: key,
        earned: true,
        sourceProduct: ev.product ?? null,
        sourceCampaignId: ev.campaignId ?? null,
        campaignVersion: version,
        ruleId: rule.id,
        fundingSource: rule.fundingSource,
        fundingOrganizationId: rule.fundingOrganizationId,
        financialRef,
        correlationId: ev.correlationId ?? null,
        metadata: { ruleName: rule.name },
      });
      if (r.created) {
        await this.ledger.lot(tx, r.entry.accountId, r.entry.id, points, expiresAt);
        out.push({ ruleId: rule.id, points, entryId: r.entry.id });
      }
    }
    return out;
  }

  /**
   * An event was reversed (a redemption, a view, a purchase): the points it earned are taken back as new REVERSE entries, the
   * rule's allocation and the funder's utilisation are returned. Exactly once per original entry.
   */
  async reverseForSource(
    tx: Prisma.TransactionClient,
    s: { sourceType: 'VIEW' | 'REDEMPTION' | 'EVENT'; sourceId: string; reason: string; actor?: { userId: string; role: string | null } },
  ): Promise<number> {
    const entries = await tx.rewardEntry.findMany({
      where: { sourceType: s.sourceType, sourceId: s.sourceId, ruleId: { not: null }, type: { in: ['EARN', 'BONUS'] }, points: { gt: 0 } },
      include: { account: true },
    });
    let total = 0;
    const policy = (await this.config.get<{ negativeBalancePolicy: string }>(CONFIG_KEYS.REWARDS_RULES)).negativeBalancePolicy;
    for (const e of entries) {
      const key = `loyalty-rev:${e.id}`;
      if (await tx.rewardEntry.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) continue;
      const acc = await tx.rewardAccount.findUniqueOrThrow({ where: { id: e.accountId } });
      // either the customer may owe the points back or the reversal stops at zero (same policy as Watch & Earn)
      const take = policy === 'HOLD_AT_ZERO' ? Math.min(e.points, Math.max(0, acc.availableBalance)) : e.points;
      if (take > 0) {
        const r = await this.ledger.apply(tx, acc.userId, {
          type: 'REVERSE',
          bucket: 'AVAILABLE',
          points: -take,
          sourceType: e.sourceType as 'VIEW' | 'REDEMPTION' | 'EVENT',
          sourceId: e.sourceId,
          reasonCode: s.reason,
          actorType: s.actor ? 'ADMIN' : 'SYSTEM',
          actorUserId: s.actor?.userId ?? null,
          actorRole: s.actor?.role ?? null,
          idempotencyKey: key,
          sourceProduct: e.sourceProduct,
          sourceCampaignId: e.sourceCampaignId,
          campaignVersion: e.campaignVersion,
          ruleId: e.ruleId,
          fundingSource: e.fundingSource,
          fundingOrganizationId: e.fundingOrganizationId,
          metadata: { reverses: e.id, shortfall: e.points - take },
        });
        if (r.created) await this.ledger.consumeLots(tx, e.accountId, take, e.id);
        total += take;
      }
      if (e.ruleId) {
        await tx.$executeRaw`UPDATE "LoyaltyRule" SET "reversedPoints" = "reversedPoints" + ${e.points}, "updatedAt" = now()
          WHERE "id" = ${e.ruleId}::uuid AND "reversedPoints" + ${e.points} <= "allocatedPoints"`;
        // the funder gets its funding back for the points that came back
        if (e.financialRef) {
          const rule = await tx.loyaltyRule.findUnique({ where: { id: e.ruleId }, select: { id: true } });
          if (rule) await this.commercial.reverseUtilization('LOYALTY', rule.id, { sourceType: 'POINTS', sourceId: e.idempotencyKey }, tx);
        }
      }
    }
    return total;
  }

  /** Remembers that the customer now owns/used a product (a fact other rules can test with PRODUCT_OWNERSHIP). */
  async recordOwnership(tx: Prisma.TransactionClient, userId: string, product: string, subjectId: string) {
    await tx.eligibilityAttribute.upsert({
      where: { userId_attrType_valueRef: { userId, attrType: 'PRODUCT_OWNERSHIP', valueRef: `${product}:${subjectId}` } },
      update: { status: 'VERIFIED', verifiedAt: new Date() },
      create: { userId, attrType: 'PRODUCT_OWNERSHIP', valueRef: `${product}:${subjectId}`, level: 'ISSUER_VERIFIED', status: 'VERIFIED', source: 'SYSTEM', verifiedAt: new Date() },
    });
  }
}
