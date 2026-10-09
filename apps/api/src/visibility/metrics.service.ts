import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { METRICS, type MetricDef, type MetricKey } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { LedgerService } from '../vouchers/ledger.service';

/** What a query may see. null lists mean "no restriction" (DealDash staff); [] means "nothing". */
export interface MetricFilter {
  organizationIds: string[] | null;
  campaignIds?: string[] | null;
  branchIds?: string[] | null;
  /** A scoped member: events without a branch are visible only for campaigns in `visibleCampaignIds`. */
  branchAllowList?: Set<string> | null;
  visibleCampaignIds?: string[] | null;
  legalEntityIds?: string[] | null;
  countries?: string[] | null;
  products?: string[] | null;
  from: Date;
  to: Date;
}

/** Raw sums per event name (and per group key when grouped). */
export interface RawRow {
  group: string;
  name: string;
  count: number;
  amountMinor: number;
  points: number;
  currency: string;
}

export type GroupColumn =
  | 'organizationId'
  | 'legalEntityId'
  | 'branchId'
  | 'campaignId'
  | 'country'
  | 'product'
  | 'day'
  | 'none';

const hour = (d: Date) => new Date(Math.floor(d.getTime() / 3_600_000) * 3_600_000);

/**
 * Metric aggregation in PostgreSQL (no streaming infrastructure): hourly rollups per event name and dimension, recomputed
 * idempotently for recent buckets, plus live gauges read from the source tables (inventory, budget, payable, points outstanding).
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly ledger: LedgerService,
  ) {}

  /** Recomputes the hourly buckets touched in the last N hours (idempotent: same input, same rows). */
  async aggregate(now = new Date()): Promise<number> {
    const cfg = await this.config.get<{ reaggregateHours?: number }>(
      CONFIG_KEYS.VISIBILITY_ANALYTICS,
    );
    const from = hour(new Date(now.getTime() - (cfg?.reaggregateHours ?? 48) * 3_600_000));
    const n = await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "MetricAggregate" ("id", "bucket", "bucketStart", "name", "product", "organizationId", "legalEntityId", "branchId", "campaignId", "country", "currency", "count", "amountMinor", "points", "computedAt")
      SELECT gen_random_uuid(), 'HOUR', date_trunc('hour', e."occurredAt"), e."name", e."product",
             COALESCE(e."organizationId"::text, ''), COALESCE(e."legalEntityId"::text, ''), COALESCE(e."branchId"::text, ''),
             COALESCE(e."campaignId"::text, ''), COALESCE(e."country", ''), COALESCE(e."currency", ''),
             SUM(e."quantity")::int, COALESCE(SUM(e."amountMinor"), 0)::bigint, COALESCE(SUM(e."points"), 0)::bigint, now()
      FROM "AnalyticsEvent" e
      WHERE e."occurredAt" >= ${from}
      GROUP BY 3, 4, 5, 6, 7, 8, 9, 10, 11
      ON CONFLICT ("bucket", "bucketStart", "name", "organizationId", "legalEntityId", "branchId", "campaignId", "country", "currency")
      DO UPDATE SET "count" = EXCLUDED."count", "amountMinor" = EXCLUDED."amountMinor", "points" = EXCLUDED."points", "computedAt" = now()`);
    await this.prisma.analyticsWatermark.upsert({
      where: { source: 'aggregate' },
      update: { cursorAt: now },
      create: { source: 'aggregate', cursorAt: now },
    });
    return n;
  }

  /** When the numbers were last brought up to date ("as of" on every screen). */
  async asOf(): Promise<string | null> {
    const w = await this.prisma.analyticsWatermark.findUnique({ where: { source: 'aggregate' } });
    return w?.cursorAt.toISOString() ?? null;
  }

  private where(f: MetricFilter) {
    const parts: Prisma.Sql[] = [
      Prisma.sql`a."bucket" = 'HOUR'`,
      Prisma.sql`a."bucketStart" >= ${hour(f.from)}`,
      Prisma.sql`a."bucketStart" < ${f.to}`,
    ];
    const list = (col: string, xs: string[] | null | undefined) => {
      if (xs === null || xs === undefined) return;
      parts.push(
        xs.length
          ? Prisma.sql`${Prisma.raw(`a."${col}"`)} IN (${Prisma.join(xs)})`
          : Prisma.sql`false`,
      );
    };
    list('organizationId', f.organizationIds);
    list('campaignId', f.campaignIds);
    list('branchId', f.branchIds);
    list('legalEntityId', f.legalEntityIds);
    list('country', f.countries);
    list('product', f.products);
    if (f.branchAllowList) {
      const branches = [...f.branchAllowList];
      const camps = f.visibleCampaignIds ?? [];
      parts.push(
        Prisma.sql`(${branches.length ? Prisma.sql`a."branchId" IN (${Prisma.join(branches)})` : Prisma.sql`false`} OR (a."branchId" = '' AND ${camps.length ? Prisma.sql`a."campaignId" IN (${Prisma.join(camps)})` : Prisma.sql`false`}))`,
      );
    }
    return Prisma.join(parts, ' AND ');
  }

  /** Sums per event name, optionally grouped by one dimension column. */
  async raw(
    f: MetricFilter,
    names: string[],
    group: GroupColumn = 'none',
    tz = 'Asia/Riyadh',
  ): Promise<RawRow[]> {
    if (!names.length) return [];
    const g =
      group === 'none'
        ? Prisma.sql`''`
        : group === 'day'
          ? Prisma.sql`to_char((a."bucketStart" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`
          : Prisma.raw(`a."${group}"`);
    const rows = await this.prisma.$queryRaw<
      Array<{ g: string; name: string; c: bigint; amt: bigint; pts: bigint; cur: string }>
    >(Prisma.sql`
      SELECT ${g} AS g, a."name", SUM(a."count")::bigint AS c, SUM(a."amountMinor")::bigint AS amt, SUM(a."points")::bigint AS pts, MAX(a."currency") AS cur
      FROM "MetricAggregate" a
      WHERE ${this.where(f)} AND a."name" IN (${Prisma.join(names)})
      GROUP BY 1, 2`);
    return rows.map((r) => ({
      group: r.g ?? '',
      name: r.name,
      count: Number(r.c),
      amountMinor: Number(r.amt),
      points: Number(r.pts),
      currency: r.cur ?? '',
    }));
  }

  /** Distinct customers behind verified events (cannot be summed from hourly buckets). */
  async uniqueUsers(f: MetricFilter, names: string[]): Promise<number> {
    const parts: Prisma.Sql[] = [
      Prisma.sql`e."occurredAt" >= ${f.from}`,
      Prisma.sql`e."occurredAt" < ${f.to}`,
      Prisma.sql`e."userId" IS NOT NULL`,
      Prisma.sql`e."name" IN (${Prisma.join(names)})`,
    ];
    if (f.organizationIds)
      parts.push(
        f.organizationIds.length
          ? Prisma.sql`e."organizationId" IN (${Prisma.join(f.organizationIds.map((x) => Prisma.sql`${x}::uuid`))})`
          : Prisma.sql`false`,
      );
    if (f.campaignIds)
      parts.push(
        f.campaignIds.length
          ? Prisma.sql`e."campaignId" IN (${Prisma.join(f.campaignIds.map((x) => Prisma.sql`${x}::uuid`))})`
          : Prisma.sql`false`,
      );
    if (f.branchAllowList) {
      const b = [...f.branchAllowList];
      const camps = f.visibleCampaignIds ?? [];
      parts.push(
        Prisma.sql`(${b.length ? Prisma.sql`e."branchId" IN (${Prisma.join(b.map((x) => Prisma.sql`${x}::uuid`))})` : Prisma.sql`false`} OR (e."branchId" IS NULL AND ${camps.length ? Prisma.sql`e."campaignId" IN (${Prisma.join(camps.map((x) => Prisma.sql`${x}::uuid`))})` : Prisma.sql`false`}))`,
      );
    }
    const r = await this.prisma.$queryRaw<Array<{ n: bigint }>>(
      Prisma.sql`SELECT COUNT(DISTINCT e."userId")::bigint AS n FROM "AnalyticsEvent" e WHERE ${Prisma.join(parts, ' AND ')}`,
    );
    return Number(r[0]?.n ?? 0);
  }

  /** The event names a set of metrics needs (ratios pull in their parts). */
  namesFor(keys: MetricKey[]): string[] {
    const out = new Set<string>();
    const visit = (k: string) => {
      const d = METRICS[k as MetricKey] as MetricDef | undefined;
      if (!d) return;
      d.events?.forEach((e) => out.add(e));
      d.minus?.forEach((e) => out.add(e));
      if (d.numerator) visit(d.numerator);
      if (d.denominator) visit(d.denominator);
    };
    keys.forEach(visit);
    return [...out];
  }

  /** Metric values from raw sums of one group. Gauges and unique counts are filled by the caller. */
  compute(keys: MetricKey[], rows: RawRow[]): Partial<Record<MetricKey, number | null>> {
    const by = new Map<string, RawRow>();
    for (const r of rows) {
      const x = by.get(r.name);
      if (x) {
        x.count += r.count;
        x.amountMinor += r.amountMinor;
        x.points += r.points;
      } else by.set(r.name, { ...r });
    }
    const val = (k: string): number | null => {
      const d = METRICS[k as MetricKey] as MetricDef | undefined;
      if (!d) return null;
      const pick = (r: RawRow | undefined) =>
        r ? (d.unit === 'MINOR' ? r.amountMinor : d.unit === 'POINTS' ? r.points : r.count) : 0;
      if (d.kind === 'COUNT' || d.kind === 'SUM') {
        const plus = (d.events ?? []).reduce((n, e) => n + pick(by.get(e)), 0);
        const minus = (d.minus ?? []).reduce((n, e) => n + pick(by.get(e)), 0);
        return Math.max(0, plus - minus);
      }
      if (d.kind === 'RATIO') {
        const num = val(d.numerator!);
        const den = val(d.denominator!);
        if (num === null || !den) return null;
        return d.unit === 'BPS' ? Math.round((num * 10_000) / den) : Math.round(num / den);
      }
      return null;
    };
    const out: Partial<Record<MetricKey, number | null>> = {};
    for (const k of keys) out[k] = val(k);
    return out;
  }

  // ---------------------------------------------------------------- gauges (live state; never accumulated)
  async gauges(
    keys: MetricKey[],
    scope: { organizationIds: string[] | null; campaignIds?: string[] | null },
  ): Promise<Partial<Record<MetricKey, number | null>>> {
    const out: Partial<Record<MetricKey, number | null>> = {};
    const orgWhere = scope.organizationIds ? { organizationId: { in: scope.organizationIds } } : {};
    const camp = (field = 'id') =>
      scope.campaignIds ? { [field]: { in: scope.campaignIds } } : {};
    const p = this.prisma;
    for (const k of keys) {
      if (METRICS[k].kind !== 'GAUGE') continue;
      switch (k) {
        case 'exclusive.inventory_remaining': {
          const deals = await p.hotDeal.findMany({
            where: { ...orgWhere, ...camp() },
            select: { id: true },
          });
          const r = await p.hotDealInventory.aggregate({
            where: { dealId: { in: deals.map((d) => d.id) }, tracked: true },
            _sum: { available: true },
          });
          out[k] = r._sum.available ?? 0;
          break;
        }
        case 'exclusive.sponsor_utilization':
        case 'exclusive.merchant_benefit_utilization': {
          if (k === 'exclusive.merchant_benefit_utilization') {
            const deals = await p.hotDeal.findMany({
              where: { ...orgWhere, ...camp() },
              select: { id: true },
            });
            const r = await p.hotDealInventory.aggregate({
              where: { dealId: { in: deals.map((d) => d.id) }, tracked: true },
              _sum: { redeemed: true, total: true },
            });
            out[k] = r._sum.total
              ? Math.round(((r._sum.redeemed ?? 0) * 10_000) / r._sum.total)
              : null;
            break;
          }
          const cases = await p.commercialCase.findMany({
            where: {
              product: 'EXCLUSIVE',
              ...(scope.organizationIds
                ? { ownerOrganizationId: { in: scope.organizationIds } }
                : {}),
              ...(scope.campaignIds ? { subjectId: { in: scope.campaignIds } } : {}),
            },
            select: { commitments: { where: { kind: 'SPONSOR_FUNDING' } } },
          });
          const ms = cases.flatMap((c) => c.commitments);
          const max = ms.reduce((n, m) => n + m.upfrontHalalas + m.usageMaxHalalas, 0);
          out[k] = max
            ? Math.round((ms.reduce((n, m) => n + m.utilizedHalalas, 0) * 10_000) / max)
            : null;
          break;
        }
        case 'voucher.active':
          out[k] = await p.voucherInstance.count({
            where: {
              ...orgWhere,
              status: 'ACTIVE',
              ...(scope.campaignIds ? { voucherId: { in: scope.campaignIds } } : {}),
            },
          });
          break;
        case 'voucher.inventory_remaining': {
          const vs = await p.voucher.findMany({
            where: { ...orgWhere, ...camp() },
            select: { totalQty: true, soldQty: true, heldQty: true },
          });
          out[k] = vs.reduce((n, v) => n + Math.max(0, v.totalQty - v.soldQty - v.heldQty), 0);
          break;
        }
        case 'voucher.merchant_payable':
        case 'voucher.settled': {
          if (!scope.organizationIds || scope.organizationIds.length !== 1) {
            out[k] = null;
            break;
          }
          if (k === 'voucher.merchant_payable') {
            const pos = await this.ledger.merchantPosition(scope.organizationIds[0]!);
            out[k] = pos.heldHalalas + pos.settlementEligibleHalalas;
          } else {
            const r = await p.merchantPayableEvent.aggregate({
              where: { organizationId: scope.organizationIds[0]!, settlementId: { not: null } },
              _sum: { amountHalalas: true },
            });
            out[k] = r._sum.amountHalalas ?? 0;
          }
          break;
        }
        case 'watch.remaining_budget': {
          const r = await p.watchCampaign.aggregate({
            where: { ...orgWhere, ...camp() },
            _sum: { fundedHalalas: true, spentHalalas: true, unusedHalalas: true },
          });
          out[k] = Math.max(
            0,
            (r._sum.fundedHalalas ?? 0) - (r._sum.spentHalalas ?? 0) - (r._sum.unusedHalalas ?? 0),
          );
          break;
        }
        case 'loyalty.points_remaining': {
          // points still outstanding (unexpired lots) earned through this business's funding or campaigns; no cash value is implied
          const orgs = scope.organizationIds;
          const camps = scope.campaignIds;
          const r = await p.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
            SELECT COALESCE(SUM(l."remaining"), 0)::bigint AS n
            FROM "RewardLot" l JOIN "RewardEntry" e ON e."id" = l."entryId"
            WHERE l."remaining" > 0 AND (l."expiresAt" IS NULL OR l."expiresAt" > now())
              ${orgs ? (orgs.length ? Prisma.sql`AND e."fundingOrganizationId" IN (${Prisma.join(orgs.map((x) => Prisma.sql`${x}::uuid`))})` : Prisma.sql`AND false`) : Prisma.empty}
              ${camps ? (camps.length ? Prisma.sql`AND e."sourceCampaignId" IN (${Prisma.join(camps.map((x) => Prisma.sql`${x}::uuid`))})` : Prisma.sql`AND false`) : Prisma.empty}`);
          out[k] = Number(r[0]?.n ?? 0);
          break;
        }
        default:
          out[k] = null;
      }
    }
    return out;
  }
}
