import { MarketService } from '../platform/markets/market.service';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import type { AnalyticsSink } from '@dealdash/analytics';
import type { DealEventType } from '@dealdash/types';
import type { DealPerformance } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { ANALYTICS_SINK } from '../analytics/analytics.module';
import { AppError } from '../common/errors';
import type { Actor } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

/** Maps the stored event types onto the shared analytics event contract names. */
const CONTRACT_NAME = {
  IMPRESSION: 'deal.impression',
  DETAIL_VIEW: 'deal.detail_viewed',
  MERCHANT_PAGE_VIEW: 'merchant.page_viewed',
  SAVE: 'deal.saved',
  UNSAVE: 'deal.saved',
  DIRECTIONS_CLICK: 'deal.directions_clicked',
  CTA_CLICK: 'watch.cta_clicked',
} as const satisfies Record<DealEventType, string>;

const WATCH_CONTRACT_NAME = {
  IMPRESSION: 'watch.impression',
  DETAIL_VIEW: 'watch.detail_viewed',
  CTA_CLICK: 'watch.cta_clicked',
} as const;

const HOT_CONTRACT_NAME = {
  IMPRESSION: 'hot_deal.impression',
  DETAIL_VIEW: 'hot_deal.detail_viewed',
  DIRECTIONS_CLICK: 'hot_deal.directions_clicked',
} as const;

const VOUCHER_CONTRACT_NAME = {
  IMPRESSION: 'voucher.impression',
  DETAIL_VIEW: 'voucher.detail_viewed',
  DIRECTIONS_CLICK: 'voucher.directions_clicked',
} as const;

export interface IncomingDealEvent {
  type: Exclude<DealEventType, 'SAVE' | 'UNSAVE'>;
  dealId?: string;
  merchantId?: string;
  branchId?: string;
  sourceDealId?: string;
  anonymousId: string;
  product?: 'LIVE' | 'HOT' | 'VOUCHER' | 'WATCH';
}

const utc = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
const DIRECTIONS_DEDUPE_SECONDS = 20;

/**
 * Discovery signals for general Live Deals: impressions, detail views, merchant page views, saves and directions clicks.
 * They are recorded server-side from validated references (the client cannot invent a merchant or a deal) and are
 * NEVER presented as visits, sales or revenue.
 */
@Injectable()
export class DealEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Inject(ANALYTICS_SINK) private readonly sink: AnalyticsSink,
    @Optional() private readonly markets?: MarketService,
  ) {}

  private async publicDeal(dealId: string, now: Date) {
    return this.prisma.liveDeal.findFirst({
      where: {
        id: dealId,
        status: { in: ['LIVE', 'SCHEDULED'] },
        startAt: { lte: now },
        OR: [{ endAt: null }, { endAt: { gt: now } }],
        organization: { status: 'ACTIVE' },
      },
      select: { id: true, organizationId: true, branches: { select: { branchId: true } } },
    });
  }

  /** Exclusive Deals are public while LIVE or SOLD_OUT (sold-out deals stay visible, clearly marked). */
  private async publicHotDeal(dealId: string, now: Date) {
    const d = await this.prisma.hotDeal.findFirst({
      where: {
        id: dealId,
        status: { in: ['LIVE', 'SOLD_OUT'] },
        startAt: { lte: now },
        OR: [{ endAt: null }, { endAt: { gt: now } }],
        organization: { status: 'ACTIVE' },
      },
      select: { id: true, organizationId: true, inventory: { select: { branchId: true } } },
    });
    return d ? { id: d.id, organizationId: d.organizationId, branches: d.inventory } : null;
  }

  /** Vouchers are public while ON_SALE or SOLD_OUT (sold-out vouchers stay visible, clearly marked). */
  private async publicVoucher(voucherId: string, now: Date) {
    const v = await this.prisma.voucher.findFirst({
      where: {
        id: voucherId,
        status: { in: ['ON_SALE', 'SOLD_OUT'] },
        OR: [{ saleStartAt: null }, { saleStartAt: { lte: now } }],
        AND: [{ OR: [{ saleEndAt: null }, { saleEndAt: { gt: now } }] }],
        organization: { status: 'ACTIVE' },
      },
      select: { id: true, organizationId: true, branches: { select: { branchId: true } } },
    });
    return v ? { id: v.id, organizationId: v.organizationId, branches: v.branches } : null;
  }

  /** Watch & Earn campaigns are public while LIVE (inside their schedule and merchant ACTIVE). */
  private async publicWatch(campaignId: string, now: Date) {
    const c = await this.prisma.watchCampaign.findFirst({
      where: {
        id: campaignId,
        status: 'LIVE',
        OR: [{ startAt: null }, { startAt: { lte: now } }],
        AND: [{ OR: [{ endAt: null }, { endAt: { gt: now } }] }],
        organization: { status: 'ACTIVE' },
      },
      select: { id: true, organizationId: true },
    });
    return c
      ? { id: c.id, organizationId: c.organizationId, branches: [] as Array<{ branchId: string }> }
      : null;
  }

  /** Server-side recording used by the save endpoint (it already validated the deal). */
  async recordDirect(
    type: 'SAVE' | 'UNSAVE',
    deal: { id: string; organizationId: string },
    userId: string,
  ) {
    await this.prisma.dealEvent.create({
      data: {
        type,
        dealId: deal.id,
        merchantOrgId: deal.organizationId,
        userId,
        anonymousId: `user:${userId}`.slice(0, 64),
      },
    });
    await this.sink.track({
      name: CONTRACT_NAME[type],
      userId,
      organizationId: deal.organizationId,
      timestamp: new Date().toISOString(),
      context: { app: 'api' },
      properties: { dealId: deal.id, action: type === 'SAVE' ? 'save' : 'unsave' },
    });
  }

  async record(events: IncomingDealEvent[], actor: Actor | undefined, now = new Date()) {
    const windowMin = await this.config.getNumber(CONFIG_KEYS.IMPRESSION_WINDOW_MINUTES, 30);
    let accepted = 0;
    const seen = new Set<string>();

    for (const e of events) {
      const userId = actor?.userType === 'CUSTOMER' ? actor.userId : null;
      let merchantOrgId: string | null = null;
      let dealId: string | null = null;
      let branchIds: string[] = [];
      let sourceDealId: string | null = null;

      if (e.type === 'MERCHANT_PAGE_VIEW') {
        if (!e.merchantId) continue;
        const org = await this.prisma.organization.findFirst({
          where: { id: e.merchantId, type: 'MERCHANT', status: 'ACTIVE' },
          select: { id: true },
        });
        if (!org) continue;
        merchantOrgId = org.id;
        if (e.sourceDealId) {
          const src = await this.publicDeal(e.sourceDealId, now);
          if (src && src.organizationId === org.id) sourceDealId = src.id;
        }
      } else {
        if (!e.dealId) continue;
        const deal =
          e.product === 'WATCH'
            ? await this.publicWatch(e.dealId, now)
            : e.product === 'VOUCHER'
              ? await this.publicVoucher(e.dealId, now)
              : e.product === 'HOT'
                ? await this.publicHotDeal(e.dealId, now)
                : await this.publicDeal(e.dealId, now);
        if (!deal) continue;
        dealId = deal.id;
        merchantOrgId = deal.organizationId;
        branchIds = deal.branches.map((b) => b.branchId);
      }
      if (!merchantOrgId) continue;
      const branchId = e.branchId && branchIds.includes(e.branchId) ? e.branchId : null;

      // De-duplication: the same visitor counts once per window (clicks: once per few seconds).
      const productType =
        e.product === 'WATCH' && dealId
          ? 'WATCH'
          : e.product === 'VOUCHER' && dealId
            ? 'VOUCHER'
            : e.product === 'HOT' && dealId
              ? 'HOT'
              : 'LIVE';
      const key = `${productType}:${e.type}:${dealId ?? merchantOrgId}:${e.anonymousId}`;
      if (seen.has(key)) continue;
      const cutoff = new Date(
        now.getTime() -
          (e.type === 'DIRECTIONS_CLICK' ? DIRECTIONS_DEDUPE_SECONDS * 1000 : windowMin * 60_000),
      );
      const dup = await this.prisma.dealEvent.findFirst({
        where: {
          type: e.type,
          productType,
          merchantOrgId,
          dealId,
          anonymousId: e.anonymousId,
          occurredAt: { gte: cutoff },
          ...(e.type === 'DIRECTIONS_CLICK' ? { branchId } : {}),
        },
        select: { id: true },
      });
      if (dup) continue;
      seen.add(key);

      await this.prisma.dealEvent.create({
        data: {
          type: e.type,
          productType,
          dealId,
          merchantOrgId,
          branchId,
          sourceDealId,
          userId,
          anonymousId: e.anonymousId,
          occurredAt: now,
        },
      });
      accepted++;
      await this.sink.track({
        name:
          productType === 'WATCH'
            ? (WATCH_CONTRACT_NAME[e.type as keyof typeof WATCH_CONTRACT_NAME] ??
              CONTRACT_NAME[e.type])
            : productType === 'VOUCHER'
              ? (VOUCHER_CONTRACT_NAME[e.type as keyof typeof VOUCHER_CONTRACT_NAME] ??
                CONTRACT_NAME[e.type])
              : productType === 'HOT'
                ? (HOT_CONTRACT_NAME[e.type as keyof typeof HOT_CONTRACT_NAME] ??
                  CONTRACT_NAME[e.type])
                : CONTRACT_NAME[e.type],
        userId,
        organizationId: merchantOrgId,
        timestamp: now.toISOString(),
        context: { app: 'customer' },
        properties: { dealId, branchId, product: productType },
      });
    }
    return { accepted };
  }

  private resolveRange(from?: string, to?: string) {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86_400_000);
    if (start.getTime() >= end.getTime())
      throw AppError.validation('The start of the range must be before its end', 'from');
    if (end.getTime() - start.getTime() > 366 * 86_400_000)
      throw AppError.validation('The range can be at most one year', 'from');
    return { start, end };
  }

  /** Per-deal performance for the merchant. Only measurable discovery signals; no sales, no revenue, no conversion. */
  async performance(
    organizationId: string,
    dealId: string,
    range: { from?: string; to?: string },
    branchNames: Map<string, { en: string; ar: string }>,
  ): Promise<DealPerformance> {
    const { start, end } = this.resolveRange(range.from, range.to);
    // days are calendar days in the merchant's market time zone
    const tz = this.markets
      ? (await this.markets.profileOfOrganization(organizationId)).timezone
      : 'UTC';
    const byDayRows = await this.prisma.$queryRaw<
      Array<{ day: string; type: string; n: number }>
    >(Prisma.sql`
      SELECT to_char((e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day,
             e."type"::text AS type, count(*)::int AS n
      FROM "DealEvent" e
      WHERE e."merchantOrgId" = ${organizationId}::uuid AND e."productType" = 'LIVE'
        AND (e."dealId" = ${dealId}::uuid OR (e."type" = 'MERCHANT_PAGE_VIEW' AND e."sourceDealId" = ${dealId}::uuid))
        AND e."occurredAt" >= ${utc(start)} AND e."occurredAt" < ${utc(end)}
      GROUP BY 1, 2 ORDER BY 1`);
    const byBranchRows = await this.prisma.$queryRaw<
      Array<{ branchId: string; type: string; n: number }>
    >(Prisma.sql`
      SELECT e."branchId" AS "branchId", e."type"::text AS type, count(*)::int AS n
      FROM "DealEvent" e
      WHERE e."merchantOrgId" = ${organizationId}::uuid AND e."dealId" = ${dealId}::uuid
        AND e."branchId" IS NOT NULL
        AND e."occurredAt" >= ${utc(start)} AND e."occurredAt" < ${utc(end)}
      GROUP BY 1, 2`);

    const totals = {
      impressions: 0,
      detailViews: 0,
      merchantPageViews: 0,
      saves: 0,
      unsaves: 0,
      directionsClicks: 0,
    };
    const days = new Map<
      string,
      {
        date: string;
        impressions: number;
        detailViews: number;
        saves: number;
        directionsClicks: number;
      }
    >();
    const bucket = (date: string) => {
      let d = days.get(date);
      if (!d) {
        d = { date, impressions: 0, detailViews: 0, saves: 0, directionsClicks: 0 };
        days.set(date, d);
      }
      return d;
    };
    for (const r of byDayRows) {
      const d = bucket(r.day);
      switch (r.type) {
        case 'IMPRESSION':
          totals.impressions += r.n;
          d.impressions += r.n;
          break;
        case 'DETAIL_VIEW':
          totals.detailViews += r.n;
          d.detailViews += r.n;
          break;
        case 'MERCHANT_PAGE_VIEW':
          totals.merchantPageViews += r.n;
          break;
        case 'SAVE':
          totals.saves += r.n;
          d.saves += r.n;
          break;
        case 'UNSAVE':
          totals.unsaves += r.n;
          break;
        case 'DIRECTIONS_CLICK':
          totals.directionsClicks += r.n;
          d.directionsClicks += r.n;
          break;
      }
    }
    const branches = new Map<string, { detailViews: number; directionsClicks: number }>();
    for (const r of byBranchRows) {
      const b = branches.get(r.branchId) ?? { detailViews: 0, directionsClicks: 0 };
      if (r.type === 'DETAIL_VIEW') b.detailViews += r.n;
      if (r.type === 'DIRECTIONS_CLICK') b.directionsClicks += r.n;
      branches.set(r.branchId, b);
    }
    return {
      range: { from: start.toISOString(), to: end.toISOString() },
      totals,
      byDay: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
      byBranch: [...branches.entries()].map(([branchId, v]) => ({
        branchId,
        name: branchNames.get(branchId) ?? { en: '', ar: '' },
        ...v,
      })),
      disclaimerKey: 'discovery_signals_only',
    };
  }

  /** All-time directions clicks per deal (the "signal" column in the Campaigns list). */
  async directionsClicks(dealIds: string[]): Promise<Map<string, number>> {
    if (!dealIds.length) return new Map();
    const rows = await this.prisma.dealEvent.groupBy({
      by: ['dealId'],
      where: { dealId: { in: dealIds }, type: 'DIRECTIONS_CLICK', productType: 'LIVE' },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.dealId as string, r._count._all]));
  }

  /** Platform-wide operational view for DealDash (the same events, aggregated). */
  async adminOverview(now = new Date()) {
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const [statusRows, typeRows, top] = await Promise.all([
      this.prisma.liveDeal.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.dealEvent.groupBy({
        by: ['type'],
        where: { occurredAt: { gte: since }, productType: 'LIVE' },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        Array<{ dealId: string; detail: number; directions: number }>
      >(Prisma.sql`
        SELECT e."dealId" AS "dealId",
               count(*) FILTER (WHERE e."type" = 'DETAIL_VIEW')::int AS detail,
               count(*) FILTER (WHERE e."type" = 'DIRECTIONS_CLICK')::int AS directions
        FROM "DealEvent" e
        WHERE e."dealId" IS NOT NULL AND e."productType" = 'LIVE' AND e."occurredAt" >= ${utc(since)}
        GROUP BY 1
        ORDER BY (count(*) FILTER (WHERE e."type" = 'DETAIL_VIEW') + count(*) FILTER (WHERE e."type" = 'DIRECTIONS_CLICK')) DESC
        LIMIT 5`),
    ]);
    const s = (st: string) => statusRows.find((r) => r.status === st)?._count._all ?? 0;
    const t = (ty: string) => typeRows.find((r) => r.type === ty)?._count._all ?? 0;
    const deals = top.length
      ? await this.prisma.liveDeal.findMany({
          where: { id: { in: top.map((x) => x.dealId) } },
          include: { organization: { include: { merchant: true } } },
        })
      : [];
    return {
      counts: {
        live: s('LIVE'),
        scheduled: s('SCHEDULED'),
        pendingReview: s('PENDING_REVIEW'),
        needsChanges: s('NEEDS_CHANGES'),
        paused: s('PAUSED'),
        suspended: s('SUSPENDED'),
      },
      last7Days: {
        impressions: t('IMPRESSION'),
        detailViews: t('DETAIL_VIEW'),
        merchantPageViews: t('MERCHANT_PAGE_VIEW'),
        saves: t('SAVE'),
        directionsClicks: t('DIRECTIONS_CLICK'),
      },
      topDeals: top.flatMap((x) => {
        const d = deals.find((y) => y.id === x.dealId);
        if (!d) return [];
        return [
          {
            id: d.id,
            title: { en: d.titleEn, ar: d.titleAr },
            merchantName: {
              en: d.organization.merchant?.tradeNameEn || d.organization.nameEn,
              ar: d.organization.merchant?.tradeNameAr || d.organization.nameAr,
            },
            detailViews: x.detail,
            directionsClicks: x.directions,
          },
        ];
      }),
      disclaimerKey: 'discovery_signals_only' as const,
    };
  }
}
