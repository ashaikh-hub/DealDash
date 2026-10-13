import { Injectable } from '@nestjs/common';
import type { WatchCard, WatchDetail, WatchHub } from '@dealdash/validation';
import { AppError } from '../common/errors';
import { EligibilityService, evaluateEligibility } from '../live-deals/eligibility.service';
import { nextMarketMidnight, startOfMarketDay } from './watch-content';
import { WATCH_INCLUDE, WatchCoreService, type WatchRowData } from './watch-core.service';
import { RewardsLedgerService } from './rewards-ledger.service';
import { WatchQualificationService } from './watch-qualification.service';
import { WatchViewService } from './watch-view.service';

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

  async hub(
    userId: string | null,
    q: { city?: string; limit: number },
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
    const cards: WatchCard[] = [];
    for (const c of wider) {
      const r = await this.cardFor(c, userId, city, now);
      if (!r) continue;
      cards.push(
        await this.view.card(c, {
          outcome: r.outcome,
          availability: r.availability,
          availableAgainAt: r.again,
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
