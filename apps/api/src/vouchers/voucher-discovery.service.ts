import { Injectable } from '@nestjs/common';
import type { VoucherCard, VoucherDetail } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { decodeCursor, encodeCursor, Page } from '../common/pagination';
import type { CardContext } from '../live-deals/deal-presenter.service';
import { DiscoveryService, searchTokens } from '../live-deals/discovery.service';
import {
  EligibilityService,
  evaluateEligibility,
  type EligibilityContext,
  type EligibilityOutcome,
} from '../live-deals/eligibility.service';
import { parseVoucherContent } from './voucher-content';
import { VOUCHER_INCLUDE, VoucherCoreService, type VoucherRow } from './voucher-core.service';
import { VoucherViewService } from './voucher-view.service';

export interface VoucherDiscoveryParams {
  q?: string;
  category?: string;
  city?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  sort?: 'newest' | 'price_low' | 'price_high' | 'savings' | 'nearest';
  eligibility?: 'all' | 'unlocked';
  limit: number;
  cursor?: string;
}

interface Candidate {
  id: string;
  branchId: string;
  dist: number | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Customer voucher discovery: browse, search, filter, sort. Eligibility-aware; sold-out vouchers stay visible, marked. */
@Injectable()
export class VoucherDiscoveryService {
  constructor(
    private readonly core: VoucherCoreService,
    private readonly view: VoucherViewService,
    private readonly eligibility: EligibilityService,
    private readonly live: DiscoveryService,
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

  private outcomeOf(row: VoucherRow, ctx: EligibilityContext): EligibilityOutcome {
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

  private async candidates(
    p: VoucherDiscoveryParams,
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
    const sort = p.sort ?? (hasPoint ? 'nearest' : 'newest');
    // sold-out vouchers always sink to the bottom of the list (they stay visible, clearly marked)
    const order =
      sort === 'nearest'
        ? Prisma.sql`(status = 'SOLD_OUT'), dist ASC NULLS LAST, "publishedAt" DESC NULLS LAST, id`
        : sort === 'price_low'
          ? Prisma.sql`(status = 'SOLD_OUT'), "sellingPriceHalalas" ASC, id`
          : sort === 'price_high'
            ? Prisma.sql`(status = 'SOLD_OUT'), "sellingPriceHalalas" DESC, id`
            : sort === 'savings'
              ? Prisma.sql`(status = 'SOLD_OUT'), pct DESC, id`
              : Prisma.sql`(status = 'SOLD_OUT'), "publishedAt" DESC NULLS LAST, id`;
    return this.prisma.$queryRaw<Candidate[]>(Prisma.sql`
      WITH cand AS (
        SELECT v."id", v."status"::text AS status, v."publishedAt", v."sellingPriceHalalas", b."id" AS "branchId",
               CASE WHEN v."faceValueHalalas" > 0
                    THEN (v."faceValueHalalas" - v."sellingPriceHalalas")::float8 / v."faceValueHalalas" ELSE 0 END AS pct,
               ${point ? Prisma.sql`ST_Distance(b."location", ${point})` : Prisma.sql`NULL::float8`} AS dist,
               concat_ws(' ', v."titleEn", v."titleAr",
                 v."content"->'shortDescription'->>'en', v."content"->'shortDescription'->>'ar',
                 o."nameEn", o."nameAr", m."tradeNameEn", m."tradeNameAr", c."nameEn", c."nameAr") AS haystack
        FROM "Voucher" v
        JOIN "Organization" o ON o."id" = v."organizationId" AND o."type" = 'MERCHANT' AND o."status" = 'ACTIVE'
        LEFT JOIN "Merchant" m ON m."organizationId" = o."id"
        LEFT JOIN "Category" c ON c."id" = v."categoryId"
        JOIN "VoucherBranch" vb ON vb."voucherId" = v."id"
        JOIN "MerchantBranch" b ON b."id" = vb."branchId" AND b."status" = 'ACTIVE' AND lower(b."city") = lower(${city})
        WHERE v."status" IN ('ON_SALE', 'SOLD_OUT')
          AND (v."saleStartAt" IS NULL OR v."saleStartAt" <= ${nowTs})
          AND (v."saleEndAt" IS NULL OR v."saleEndAt" > ${nowTs})
          ${p.category ? Prisma.sql`AND c."code" = ${p.category} AND c."active"` : Prisma.empty}
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
    p: VoucherDiscoveryParams,
    userId: string | null,
    now = new Date(),
  ): Promise<Page<VoucherCard>> {
    const { city, enabled } = await this.resolveCity(p.city);
    if (!enabled) return new Page<VoucherCard>([], null);
    const ctx = await this.eligibility.contextFor(userId, city, now);
    const dec = decodeCursor(p.cursor);
    let offset = dec && typeof dec.v === 'number' ? Math.max(0, dec.v) : 0;
    const kept: Array<{ row: VoucherRow; cand: Candidate; outcome: EligibilityOutcome }> = [];
    let more = false;
    for (let round = 0; round < 6 && kept.length < p.limit; round++) {
      const take = Math.max(p.limit * 2, 20);
      const cands = await this.candidates(p, city, offset, take, now);
      if (!cands.length) {
        more = false;
        break;
      }
      const rows = await this.prisma.voucher.findMany({
        where: { id: { in: cands.map((c) => c.id) } },
        include: VOUCHER_INCLUDE,
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
      now,
    );
    return new Page(cards, more ? encodeCursor({ v: offset, id: 'offset' }) : null);
  }

  /** Visible voucher detail; 404 when it is not public or the customer has no realistic way to unlock it. */
  async detail(
    id: string,
    userId: string | null,
    q: { city?: string; lat?: number; lng?: number },
    now = new Date(),
  ): Promise<VoucherDetail> {
    const { city } = await this.resolveCity(q.city);
    const row = await this.prisma.voucher.findFirst({
      where: {
        id,
        status: { in: ['ON_SALE', 'SOLD_OUT'] },
        OR: [{ saleStartAt: null }, { saleStartAt: { lte: now } }],
        AND: [{ OR: [{ saleEndAt: null }, { saleEndAt: { gt: now } }] }],
        organization: { status: 'ACTIVE' },
      },
      include: VOUCHER_INCLUDE,
    });
    const active = row?.branches.filter((b) => b.branch.status === 'ACTIVE') ?? [];
    if (!row || !active.length) throw AppError.notFound();
    const ctx = await this.eligibility.contextFor(userId, city, now);
    const outcome = this.outcomeOf(row, ctx);
    if (outcome.result === 'HIDDEN') throw AppError.notFound();
    const distances = await this.live.branchDistances(
      active.map((b) => b.branchId),
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
    if (userId) {
      const owned = await this.prisma.voucherInstance.count({
        where: {
          ownerUserId: userId,
          voucherId: id,
          status: { in: ['ACTIVE', 'REDEEMED', 'EXPIRED'] },
        },
      });
      const pending = await this.prisma.voucherOrder.aggregate({
        where: { userId, voucherId: id, status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
        _sum: { quantity: true },
      });
      // units in an open checkout of the customer's own do not block them from finishing it
      void pending;
      remainingForMe = Math.max(0, row.perCustomerLimit - owned);
    }
    return this.view.detail(
      row,
      parseVoucherContent(row.content),
      { outcome, city, nearest: { distanceMeters: nearestDist, branchId: nearestId } },
      distances,
      { remainingForMe, limitReached: remainingForMe !== null && remainingForMe <= 0 },
      now,
    );
  }
}
