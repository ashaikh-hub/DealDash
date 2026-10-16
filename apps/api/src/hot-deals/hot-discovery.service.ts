import { Injectable } from '@nestjs/common';
import type { HotDealCard, HotDealDetail } from '@dealdash/validation';
import { normalizeText } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { decodeCursor, encodeCursor, Page } from '../common/pagination';
import type { BenefitSource } from '@dealdash/types';
import {
  benefitMatch,
  DiscoveryService,
  searchTokens,
  sourceMatch,
} from '../live-deals/discovery.service';
import {
  EligibilityService,
  evaluateEligibility,
  type EligibilityContext,
  type EligibilityOutcome,
} from '../live-deals/eligibility.service';
import type { CardContext } from '../live-deals/deal-presenter.service';
import { parseHotContent } from './hot-content';
import { HOT_INCLUDE, HotCoreService, type HotRow } from './hot-core.service';
import { HotViewService } from './hot-view.service';
import { ReservationsService } from './reservations.service';

export interface HotDiscoveryParams {
  q?: string;
  category?: string;
  city?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  sort?: 'ending_soon' | 'nearest' | 'newest';
  eligibility?: 'all' | 'unlocked';
  /** My benefits: only partner-benefit offers, already unlocked or still to unlock. Absent = every offer (unchanged). */
  benefit?: 'unlocked' | 'locked';
  /** Browse offers by card / employer, or one merchant's offers. */
  source?: BenefitSource;
  merchantId?: string;
  limit: number;
  cursor?: string;
}

interface Candidate {
  id: string;
  branchId: string;
  dist: number | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);
void normalizeText;

/** Customer Exclusive Deal discovery: urgent offers near the customer, eligibility-aware, with live stock. */
@Injectable()
export class HotDiscoveryService {
  constructor(
    private readonly core: HotCoreService,
    private readonly view: HotViewService,
    private readonly eligibility: EligibilityService,
    private readonly live: DiscoveryService,
    private readonly reservations: ReservationsService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  private async resolveCity(city?: string) {
    const enabled = await this.core.enabledCities();
    const wanted = (city ?? enabled[0] ?? '').trim();
    const match = enabled.find((c) => c.toLowerCase() === wanted.toLowerCase());
    return { city: match ?? wanted, enabled: !!match };
  }

  private outcomeOf(row: HotRow, ctx: EligibilityContext): EligibilityOutcome {
    return evaluateEligibility(
      row.eligibilityKind,
      (row.ruleSet?.conditions ?? []).map((c) => ({
        attrType: c.attrType,
        valueRef: c.valueRef,
        requiredLevel: c.requiredLevel,
      })),
      ctx,
      row.ruleSet?.expression,
    );
  }

  /**
   * One deal per row with its nearest participating branch. Visible = LIVE or SOLD_OUT, inside its dates, merchant
   * active, at least one active branch in the city. Dates are compared directly, so a late sweep never shows a stale deal.
   */
  private async candidates(
    p: HotDiscoveryParams,
    city: string,
    offset: number,
    take: number,
    now: Date,
  ): Promise<Candidate[]> {
    const hasPoint = p.lat !== undefined && p.lng !== undefined;
    const point = hasPoint
      ? Prisma.sql`ST_SetSRID(ST_MakePoint(${p.lng!}::float8, ${p.lat!}::float8), 4326)::geography`
      : null;
    const nowTs = Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
    const tokens = searchTokens(p.q);
    const textWhere = tokens.length
      ? Prisma.join(
          tokens.map(
            (t) => Prisma.sql`dd_norm_ar(haystack) LIKE ${'%' + escapeLike(t) + '%'} ESCAPE '\\'`,
          ),
          ' AND ',
        )
      : Prisma.sql`TRUE`;
    const sort = p.sort ?? (hasPoint ? 'nearest' : 'ending_soon');
    // sold-out offers always sink to the bottom of the list (they stay visible, clearly marked)
    const order =
      sort === 'nearest'
        ? Prisma.sql`(status = 'SOLD_OUT'), dist ASC NULLS LAST, "endAt" ASC NULLS LAST, id`
        : sort === 'newest'
          ? Prisma.sql`(status = 'SOLD_OUT'), "publishedAt" DESC NULLS LAST, id`
          : Prisma.sql`(status = 'SOLD_OUT'), "endAt" ASC NULLS LAST, dist ASC NULLS LAST, id`;
    return this.prisma.$queryRaw<Candidate[]>(Prisma.sql`
      WITH cand AS (
        SELECT d."id", d."status"::text AS status, d."publishedAt", d."endAt", b."id" AS "branchId",
               ${point ? Prisma.sql`ST_Distance(b."location", ${point})` : Prisma.sql`NULL::float8`} AS dist,
               concat_ws(' ', d."titleEn", d."titleAr",
                 d."content"->'offerLabel'->>'en', d."content"->'offerLabel'->>'ar',
                 d."content"->'shortDescription'->>'en', d."content"->'shortDescription'->>'ar',
                 o."nameEn", o."nameAr", m."tradeNameEn", m."tradeNameAr", c."nameEn", c."nameAr") AS haystack
        FROM "HotDeal" d
        JOIN "Organization" o ON o."id" = d."organizationId" AND o."type" = 'MERCHANT' AND o."status" = 'ACTIVE'
        LEFT JOIN "Merchant" m ON m."organizationId" = o."id"
        LEFT JOIN "Category" c ON c."id" = d."categoryId"
        JOIN "HotDealInventory" hi ON hi."dealId" = d."id"
        JOIN "MerchantBranch" b ON b."id" = hi."branchId" AND b."status" = 'ACTIVE' AND lower(b."city") = lower(${city})
        WHERE d."status" IN ('LIVE', 'SOLD_OUT')
          AND d."startAt" <= ${nowTs}
          AND (d."endAt" IS NULL OR d."endAt" > ${nowTs})
          ${p.category ? Prisma.sql`AND c."code" = ${p.category} AND c."active"` : Prisma.empty}
          ${p.merchantId ? Prisma.sql`AND d."organizationId" = ${p.merchantId}::uuid` : Prisma.empty}
          ${point && p.radiusMeters ? Prisma.sql`AND ST_DWithin(b."location", ${point}, ${p.radiusMeters}::float8)` : Prisma.empty}
      ), best AS (
        SELECT DISTINCT ON (id) * FROM cand ORDER BY id, dist ASC NULLS LAST
      )
      SELECT id, "branchId", dist FROM best
      WHERE ${textWhere}
      ORDER BY ${order}
      OFFSET ${offset}::int LIMIT ${take}::int`);
  }

  async list(
    p: HotDiscoveryParams,
    userId: string | null,
    now = new Date(),
  ): Promise<Page<HotDealCard>> {
    const { city, enabled } = await this.resolveCity(p.city);
    if (!enabled) return new Page<HotDealCard>([], null);
    const ctx = await this.eligibility.contextFor(userId, city, now);
    const dec = decodeCursor(p.cursor);
    let offset = dec && typeof dec.v === 'number' ? Math.max(0, dec.v) : 0;
    const kept: Array<{ row: HotRow; cand: Candidate; outcome: EligibilityOutcome }> = [];
    let more = false;
    for (let round = 0; round < 6 && kept.length < p.limit; round++) {
      const take = Math.max(p.limit * 2, 20);
      const cands = await this.candidates(p, city, offset, take, now);
      if (!cands.length) {
        more = false;
        break;
      }
      const rows = await this.prisma.hotDeal.findMany({
        where: { id: { in: cands.map((c) => c.id) } },
        include: HOT_INCLUDE,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      let consumed = 0;
      for (const cand of cands) {
        consumed++;
        const row = byId.get(cand.id);
        if (!row) continue;
        const outcome = this.outcomeOf(row, ctx);
        if (outcome.result === 'HIDDEN') continue;
        if (p.eligibility === 'unlocked' && outcome.result !== 'ELIGIBLE') continue;
        if (p.benefit && !benefitMatch(row, outcome, p.benefit)) continue;
        if (!sourceMatch(row, p.source)) continue;
        kept.push({ row, cand, outcome });
        if (kept.length === p.limit) break;
      }
      offset += consumed;
      more = consumed < cands.length || cands.length === take;
      if (kept.length >= p.limit) break;
    }
    const cx = new Map<string, CardContext>(
      kept.map((k) => [
        k.row.id,
        {
          outcome: k.outcome,
          nearest: {
            distanceMeters: k.cand.dist === null ? null : Math.round(Number(k.cand.dist)),
            branchId: k.cand.branchId,
          },
          city,
        },
      ]),
    );
    const cards = await this.view.cards(
      kept.map((k) => k.row),
      cx,
      (r) => parseHotContent(r.content),
      now,
    );
    return new Page(cards, more ? encodeCursor({ v: offset, id: 'offset' }) : null);
  }

  /** Visible Exclusive Deal detail; 404 when it is not public or the customer has no realistic way to unlock it. */
  async detail(
    id: string,
    userId: string | null,
    q: { city?: string; lat?: number; lng?: number },
    now = new Date(),
  ): Promise<HotDealDetail> {
    const { city } = await this.resolveCity(q.city);
    const row = await this.prisma.hotDeal.findFirst({
      where: {
        id,
        status: { in: ['LIVE', 'SOLD_OUT'] },
        startAt: { lte: now },
        OR: [{ endAt: null }, { endAt: { gt: now } }],
        organization: { status: 'ACTIVE' },
      },
      include: HOT_INCLUDE,
    });
    const active = row?.inventory.filter((i) => i.branch.status === 'ACTIVE') ?? [];
    if (!row || !active.length) throw AppError.notFound();
    const ctx = await this.eligibility.contextFor(userId, city, now);
    const outcome = this.outcomeOf(row, ctx);
    if (outcome.result === 'HIDDEN') throw AppError.notFound();
    const distances = await this.live.branchDistances(
      active.map((i) => i.branchId),
      q.lat,
      q.lng,
    );
    let nearestId: string | null = null;
    let nearestDist: number | null = null;
    for (const [bid, dist] of distances) {
      if (nearestDist === null || dist < nearestDist) {
        nearestId = bid;
        nearestDist = dist;
      }
    }

    let remainingForMe: number | null = null;
    let myReservations: HotDealDetail['myReservations'] = [];
    let restriction: HotDealDetail['restriction'] = null;
    if (userId) {
      const mine = await this.prisma.reservation.findMany({
        where: { userId, dealId: id, status: { in: ['HELD', 'REDEEMED'] } },
        select: { status: true, quantity: true, expiresAt: true },
      });
      const used = mine
        .filter((m) => m.status === 'REDEEMED' || m.expiresAt.getTime() > now.getTime())
        .reduce((n, m) => n + m.quantity, 0);
      remainingForMe = Math.max(0, row.perCustomerLimit - used);
      myReservations = await this.reservations.mineForDeal(userId, id, now);
      const r = await this.prisma.customerRestriction.findFirst({
        where: { userId, status: 'ACTIVE', endsAt: { gt: now } },
      });
      restriction = r ? { endsAt: r.endsAt.toISOString() } : null;
    }
    return this.view.detail(
      row,
      parseHotContent(row.content),
      { outcome, city, nearest: { distanceMeters: nearestDist, branchId: nearestId } },
      distances,
      { remainingForMe, myReservations, restriction },
      now,
    );
  }
}
