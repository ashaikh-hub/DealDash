import { Injectable } from '@nestjs/common';
import type { LoyaltyFinanceSummary } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface Row {
  ruleId: string | null;
  ruleName: string | null;
  fundingSource: string;
  fundingOrganizationId: string | null;
  maxAllocationPoints: number | null;
  rate: number | null;
  issued: bigint;
  reversed: bigint;
  expired: bigint;
  outstanding: bigint;
}

/**
 * Finance's view of loyalty: per rule and funder, how many points were allocated, issued, reversed, redeemed, expired and are still
 * outstanding, plus (only for business-funded rules) what has been drawn from the funder's prepaid funds. Money is never derived
 * from points: it is the funder's own agreed rate applied to points actually issued.
 */
@Injectable()
export class LoyaltyFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(organizationId: string | null | undefined): Promise<LoyaltyFinanceSummary> {
    const scope =
      organizationId === undefined
        ? Prisma.empty
        : Prisma.sql`AND (r."organizationId" = ${organizationId}::uuid OR r."fundingOrganizationId" = ${organizationId}::uuid)`;
    const rows = await this.prisma.$queryRaw<Row[]>(Prisma.sql`
      SELECT r."id" AS "ruleId", r."name" AS "ruleName", r."fundingSource", r."fundingOrganizationId", r."maxAllocationPoints",
             r."fundingHalalasPerPoint" AS "rate",
             COALESCE(SUM(e."points") FILTER (WHERE e."type" IN ('EARN', 'BONUS') AND e."points" > 0), 0)::bigint AS "issued",
             COALESCE(-SUM(e."points") FILTER (WHERE e."type" = 'REVERSE'), 0)::bigint AS "reversed",
             0::bigint AS "expired",
             0::bigint AS "outstanding"
      FROM "LoyaltyRule" r
      LEFT JOIN "RewardEntry" e ON e."ruleId" = r."id"
      WHERE true ${scope}
      GROUP BY r."id"
      ORDER BY r."createdAt" DESC`);
    const out: LoyaltyFinanceSummary['rows'] = [];
    for (const r of rows) {
      if (!r.ruleId) continue;
      const lots = await this.prisma.$queryRaw<
        Array<{ remaining: bigint; total: bigint }>
      >(Prisma.sql`
        SELECT COALESCE(SUM(l."remaining") FILTER (WHERE l."expiresAt" IS NULL OR l."expiresAt" > now()), 0)::bigint AS "remaining",
               COALESCE(SUM(l."points"), 0)::bigint AS "total"
        FROM "RewardLot" l JOIN "RewardEntry" e ON e."id" = l."entryId" WHERE e."ruleId" = ${r.ruleId}::uuid`);
      const expired = await this.prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
        SELECT COALESCE(-SUM(x."points"), 0)::bigint AS "n" FROM "RewardEntry" x
        WHERE x."type" = 'EXPIRE' AND x."sourceId" IN (SELECT l."id"::text FROM "RewardLot" l JOIN "RewardEntry" e ON e."id" = l."entryId" WHERE e."ruleId" = ${r.ruleId}::uuid)`);
      const issued = Number(r.issued);
      const reversed = Number(r.reversed);
      const outstanding = Number(lots[0]?.remaining ?? 0);
      const exp = Number(expired[0]?.n ?? 0);
      const redeemed = Math.max(0, issued - reversed - exp - outstanding);
      let util: number | null = null;
      let received: number | null = null;
      if (r.rate !== null && r.fundingSource !== 'DEALDASH') {
        const c = await this.prisma.commercialCase.findUnique({
          where: { product_subjectId: { product: 'LOYALTY', subjectId: r.ruleId } },
          include: { commitments: true },
        });
        util = c ? c.commitments.reduce((n, m) => n + m.utilizedHalalas, 0) : 0;
        received = c ? c.commitments.reduce((n, m) => n + m.receivedHalalas, 0) : 0;
      }
      out.push({
        ruleId: r.ruleId,
        ruleName: r.ruleName ?? '',
        fundingSource: r.fundingSource,
        fundingOrganizationId: r.fundingOrganizationId,
        allocated: r.maxAllocationPoints,
        issued,
        reversed,
        redeemed,
        expired: exp,
        outstanding,
        remainingAllocation: r.maxAllocationPoints === null ? null : r.maxAllocationPoints - issued,
        fundingHalalasPerPoint: r.rate,
        fundingUtilizedHalalas: util,
        fundingReceivedHalalas: received,
        outstandingLiabilityHalalas:
          r.rate !== null && r.fundingSource !== 'DEALDASH' ? outstanding * r.rate : null,
      });
    }
    const held = await this.prisma.rewardAccount.aggregate({ _sum: { heldBalance: true } });
    const sum = (f: (r: (typeof out)[number]) => number) => out.reduce((n, r) => n + f(r), 0);
    return {
      rows: out,
      totals: {
        issued: sum((r) => r.issued),
        reversed: sum((r) => r.reversed),
        redeemed: sum((r) => r.redeemed),
        expired: sum((r) => r.expired),
        outstanding: sum((r) => r.outstanding),
        held: held._sum.heldBalance ?? 0,
      },
      note: 'points_have_no_fixed_cash_value',
    };
  }
}
