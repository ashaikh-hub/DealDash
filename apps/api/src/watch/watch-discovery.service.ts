import { Injectable } from '@nestjs/common';
import type { WatchCard, WatchDetail, WatchHub } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { EligibilityService, evaluateEligibility } from '../live-deals/eligibility.service';
import { nextMarketMidnight, startOfMarketDay } from './watch-content';
import { WATCH_INCLUDE, WatchCoreService, type WatchRowData } from './watch-core.service';
import { RewardsLedgerService } from './rewards-ledger.service';
import { WatchQualificationService } from './watch-qualification.service';
import { WatchViewService } from './watch-view.service';

/** SavedItem type of a saved (favourite) Watch & Earn campaign. */
export const WATCH_SAVED_TYPE = 'WATCH_CAMPAIGN';

/** Customer discovery of Watch & Earn campaigns. Only LIVE campaigns of active merchants are ever shown. */
@Injectable()
export class WatchDiscoveryService {
  constructor(
    private readonly core: WatchCoreService,
    private readonly view: WatchViewService,
    private readonly qualification: WatchQualificationService,
    private readonly eligibility: EligibilityService,
    private readonly rewards: RewardsLedgerService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  private async resolveCity(city?: string) {
    const enabled = await this.core.enabledCities();
    const wanted = (city ?? enabled[0] ?? '').trim();
    const match = enabled.find((e) => e.trim().toLowerCase() === wanted.toLowerCase());
    return match ?? wanted;
  }

  private publicWhere(now: Date) {
    return {
      status: 'LIVE' as const,
      OR: [{ startAt: null }, { startAt: { lte: now } }],
      AND: [{ OR: [{ endAt: null }, { endAt: { gt: now } }] }],
      organization: { status: 'ACTIVE' as const },
    };
  }

  private async cardFor(c: WatchRowData, userId: string | null, city: string, now: Date) {
    const content = this.core.content(c);
    const ctx = await this.eligibility.contextFor(userId, city, now);
    const outcome = evaluateEligibility(
      content.targeting.eligibility.kind,
      this.eligibility.conditionsFor(content.targeting.eligibility),
      ctx,
      content.targeting.eligibility.expression,
    );
    const inCity = content.targeting.cities.some(
      (x) => x.trim().toLowerCase() === city.trim().toLowerCase(),
    );
    if (!inCity || outcome.result === 'HIDDEN') return null;
    let availability: WatchCard['availability'] = 'AVAILABLE';
    let again: Date | null = null;
    if (outcome.result !== 'ELIGIBLE') availability = 'NOT_ELIGIBLE';
    else if (userId) {
      const v = await this.qualification.startVerdict(userId, c.id, now);
      availability = v.availability;
      again = v.availableAgainAt;
    } else if (c.qualifiedViews >= c.paidViews) availability = 'BUDGET_EXHAUSTED';
    return { c, outcome, availability, again };
  }

  /** Distance (metres) from a point to each merchant's nearest active branch (PostGIS, the same measure as Live Deals). */
  private async merchantDistances(orgIds: string[], lat?: number, lng?: number) {
    const out = new Map<string, number>();
    if (!orgIds.length || lat === undefined || lng === undefined) return out;
    const point = Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography`;
    const rows = await this.prisma.$queryRaw<Array<{ org: string; dist: number }>>(Prisma.sql`
      SELECT b."organizationId" AS org, min(ST_Distance(b."location", ${point})) AS dist
      FROM "MerchantBranch" b
      WHERE b."organizationId" = ANY(${orgIds}::uuid[]) AND b."status" = 'ACTIVE' AND b."location" IS NOT NULL
      GROUP BY b."organizationId"`);
    for (const r of rows) out.set(r.org, Math.round(Number(r.dist)));
    return out;
  }

  /** The campaigns this customer saved (favourites). */
  private async savedIds(userId: string | null, ids: string[]) {
    if (!userId || !ids.length) return null;
    const rows = await this.prisma.savedItem.findMany({
      where: { userId, objectType: WATCH_SAVED_TYPE, objectId: { in: ids } },
      select: { objectId: true },
    });
    return new Set(rows.map((r) => r.objectId));
  }

  async hub(
    userId: string | null,
    q: { city?: string; limit: number; lat?: number; lng?: number },
    now = new Date(),
  ): Promise<WatchHub> {
    const city = await this.resolveCity(q.city);
    const rows = await this.prisma.watchCampaign.findMany({
      where: { ...this.publicWhere(now), cities: { has: city } },
      include: WATCH_INCLUDE,
      orderBy: [{ endAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    // also match cities regardless of letter case
    const wider = rows.length
      ? rows
      : (
          await this.prisma.watchCampaign.findMany({
            where: this.publicWhere(now),
            include: WATCH_INCLUDE,
            take: 100,
          })
        ).filter((c) => c.cities.some((x) => x.trim().toLowerCase() === city.trim().toLowerCase()));
    // the customer's position when shared, else the city centre (the same measure as Live Deals)
    let point: { lat?: number; lng?: number } = { lat: q.lat, lng: q.lng };
    if (q.lat === undefined || q.lng === undefined) {
      const centre = (await this.core.cityCenters())[city];
      point = centre ? { lat: centre.latitude, lng: centre.longitude } : {};
    }
    const [distances, saved] = await Promise.all([
      this.merchantDistances(
        [...new Set(wider.map((c) => c.organizationId))],
        point.lat,
        point.lng,
      ),
      this.savedIds(
        userId,
        wider.map((c) => c.id),
      ),
    ]);
    const cards: WatchCard[] = [];
    for (const c of wider) {
      const r = await this.cardFor(c, userId, city, now);
      if (!r) continue;
      cards.push(
        await this.view.card(c, {
          outcome: r.outcome,
          availability: r.availability,
          availableAgainAt: r.again,
          distanceMeters: distances.get(c.organizationId) ?? null,
          ...(saved ? { saved: saved.has(c.id) } : {}),
        }),
      );
    }
    // available first, then already-earned / capped (shown, clearly marked), then the rest
    const rank: Record<string, number> = {
      AVAILABLE: 0,
      NOT_ELIGIBLE: 1,
      ALREADY_EARNED: 2,
      DAILY_CAP: 2,
      BUDGET_EXHAUSTED: 3,
      ENDED: 3,
      UNAVAILABLE: 3,
    };
    cards.sort((a, b) => (rank[a.availability] ?? 9) - (rank[b.availability] ?? 9));
    const f = await this.core.frequency();
    // the customer's day is the day in their city's market time zone
    const tz = (await this.core.markets.profile(await this.core.markets.marketOfCity(q.city)))
      .timezone;
    const earnedToday = userId
      ? await this.prisma.watchView.count({
          where: { userId, status: 'QUALIFIED', qualifiedAt: { gte: startOfMarketDay(now, tz) } },
        })
      : 0;
    const summary = userId ? await this.rewards.summary(userId, now) : null;
    return {
      campaigns: cards.slice(0, q.limit),
      daily: {
        earnedViews: earnedToday,
        cap: f.customerDailyCap,
        resetsAt: nextMarketMidnight(now, tz).toISOString(),
      },
      balance: {
        availableBalance: summary?.availableBalance ?? 0,
        heldBalance: summary?.heldBalance ?? 0,
      },
      serverNow: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------- favourites (saved campaigns)
  async save(userId: string, id: string, now = new Date()) {
    const c = await this.prisma.watchCampaign.findFirst({
      where: { id, ...this.publicWhere(now) },
      select: { id: true },
    });
    if (!c) throw AppError.notFound();
    await this.prisma.savedItem.upsert({
      where: { userId_objectType_objectId: { userId, objectType: WATCH_SAVED_TYPE, objectId: id } },
      update: {},
      create: { userId, objectType: WATCH_SAVED_TYPE, objectId: id },
    });
    return { saved: true };
  }

  async unsave(userId: string, id: string) {
    await this.prisma.savedItem.deleteMany({
      where: { userId, objectType: WATCH_SAVED_TYPE, objectId: id },
    });
    return { saved: false };
  }

  /** The customer's saved campaigns that are still live (an ended campaign drops out of the list). */
  async saved(userId: string, q: { city?: string }, now = new Date()): Promise<WatchCard[]> {
    const items = await this.prisma.savedItem.findMany({
      where: { userId, objectType: WATCH_SAVED_TYPE },
      orderBy: { savedAt: 'desc' },
      take: 100,
    });
    if (!items.length) return [];
    const rows = await this.prisma.watchCampaign.findMany({
      where: { id: { in: items.map((i) => i.objectId) }, ...this.publicWhere(now) },
      include: WATCH_INCLUDE,
    });
    const order = new Map(items.map((i, n) => [i.objectId, n]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const city = await this.resolveCity(q.city);
    const out: WatchCard[] = [];
    for (const c of rows) {
      const r = await this.cardFor(c, userId, city, now);
      if (!r) continue;
      out.push(
        await this.view.card(c, {
          outcome: r.outcome,
          availability: r.availability,
          availableAgainAt: r.again,
          saved: true,
        }),
      );
    }
    return out;
  }

  async detail(
    userId: string | null,
    id: string,
    q: { city?: string },
    now = new Date(),
  ): Promise<WatchDetail> {
    const c = await this.prisma.watchCampaign.findFirst({
      where: { id, ...this.publicWhere(now) },
      include: WATCH_INCLUDE,
    });
    if (!c) throw AppError.notFound();
    const city = await this.resolveCity(q.city);
    const r = await this.cardFor(c, userId, city, now);
    if (!r) throw AppError.notFound();
    return this.view.detail(c, {
      outcome: r.outcome,
      availability: r.availability,
      availableAgainAt: r.again,
    });
  }
}
