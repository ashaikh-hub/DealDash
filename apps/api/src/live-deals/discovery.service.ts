import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { DEFAULT_CITY, RIYADH_CENTER } from '@dealdash/types';
import {
  normalizeText,
  type DealCard,
  type DealDetail,
  type MerchantPage,
} from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { decodeCursor, encodeCursor, Page } from '../common/pagination';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { parseContent } from './deal-content';
import { DEAL_INCLUDE, DealCoreService, type DealRow } from './deal-core.service';
import { DealEventsService } from './deal-events.service';
import {
  DealPresenterService,
  merchantDisplayName,
  type CardContext,
} from './deal-presenter.service';
import type { EligibilityKind } from '@dealdash/types';
import {
  EligibilityService,
  evaluateEligibility,
  isPartnerBenefitRule,
  type EligibilityContext,
  type EligibilityOutcome,
} from './eligibility.service';

export type DiscoverySort = 'nearest' | 'newest' | 'ending_soon' | 'relevance';

export interface DiscoveryParams {
  q?: string;
  category?: string;
  city?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  sort?: DiscoverySort;
  eligibility?: 'all' | 'unlocked';
  /** My benefits: only partner-benefit offers, either already unlocked or still to unlock. Absent = every offer (unchanged). */
  benefit?: 'unlocked' | 'locked';
  limit: number;
  cursor?: string;
  organizationId?: string;
  onlyWithEndDate?: boolean;
}

interface Candidate {
  id: string;
  branchId: string;
  dist: number | null;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** My benefits filter shared by Live Deals, Exclusive Deals and Vouchers (the same engine outcome every list already computes). */
export function benefitMatch(
  row: {
    eligibilityKind: EligibilityKind;
    ruleSet?: {
      conditions: Array<{ attrType: string; valueRef: string }>;
      expression: unknown;
    } | null;
  },
  outcome: EligibilityOutcome,
  benefit: 'unlocked' | 'locked',
): boolean {
  if (
    !isPartnerBenefitRule(
      row.eligibilityKind,
      row.ruleSet?.conditions ?? [],
      row.ruleSet?.expression,
    )
  )
    return false;
  return benefit === 'unlocked'
    ? outcome.result === 'ELIGIBLE'
    : outcome.result === 'LOCKED_UNLOCKABLE';
}

/**
 * Search tokens: normalised the same way as the SQL function dd_norm_ar (alef forms, diacritics, teh marbuta, digits),
 * plus removal of the Arabic definite article from the front of a word so "الرياض" also finds "رياض".
 */
export function searchTokens(q: string | undefined): string[] {
  if (!q) return [];
  return normalizeText(q)
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.startsWith('ال') ? t.slice(2) : t))
    .slice(0, 6);
}

/** Customer discovery: nearby (PostGIS), categories, bilingual search (PostgreSQL), eligibility-aware visibility. */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: DealCoreService,
    private readonly presenter: DealPresenterService,
    private readonly eligibility: EligibilityService,
    private readonly events: DealEventsService,
    private readonly files: FilesService,
    private readonly config: SystemConfigService,
  ) {}

  // ---------------------------------------------------------------- SQL
  private nowTs(now: Date) {
    return Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
  }

  private point(lat: number, lng: number) {
    return Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography`;
  }

  /**
   * One deal per row with its nearest participating branch. Visible = approved status, inside its dates, merchant
   * active, at least one active branch in the city. Distances are geography metres (PostGIS); the radius filter uses
   * ST_DWithin so the GiST index on MerchantBranch.location is used.
   */
  private async candidates(
    p: DiscoveryParams,
    city: string,
    offset: number,
    take: number,
    now: Date,
  ): Promise<Candidate[]> {
    const hasPoint = p.lat !== undefined && p.lng !== undefined;
    const point = hasPoint ? this.point(p.lat!, p.lng!) : null;
    const tokens = searchTokens(p.q);
    const nowTs = this.nowTs(now);

    const sort: DiscoverySort =
      p.sort ?? (tokens.length ? 'relevance' : hasPoint ? 'nearest' : 'newest');

    const textWhere = tokens.length
      ? Prisma.join(
          tokens.map(
            (t) => Prisma.sql`dd_norm_ar(haystack) LIKE ${'%' + escapeLike(t) + '%'} ESCAPE '\\'`,
          ),
          ' AND ',
        )
      : Prisma.sql`TRUE`;
    const score = tokens.length
      ? Prisma.join(
          tokens.map(
            (
              t,
            ) => Prisma.sql`(CASE WHEN dd_norm_ar(title_hay) LIKE ${'%' + escapeLike(t) + '%'} ESCAPE '\\' THEN 3 ELSE 0 END
              + CASE WHEN dd_norm_ar(merchant_hay) LIKE ${'%' + escapeLike(t) + '%'} ESCAPE '\\' THEN 2 ELSE 0 END)`,
          ),
          ' + ',
        )
      : Prisma.sql`0`;

    const order =
      sort === 'nearest'
        ? Prisma.sql`dist ASC NULLS LAST, "publishedAt" DESC NULLS LAST, id`
        : sort === 'ending_soon'
          ? Prisma.sql`"endAt" ASC NULLS LAST, id`
          : sort === 'relevance'
            ? Prisma.sql`score DESC, dist ASC NULLS LAST, "publishedAt" DESC NULLS LAST, id`
            : Prisma.sql`"publishedAt" DESC NULLS LAST, id`;

    return this.prisma.$queryRaw<Candidate[]>(Prisma.sql`
      WITH cand AS (
        SELECT d."id", d."publishedAt", d."endAt", b."id" AS "branchId",
               ${point ? Prisma.sql`ST_Distance(b."location", ${point})` : Prisma.sql`NULL::float8`} AS dist,
               concat_ws(' ', d."titleEn", d."titleAr",
                 d."content"->'offerLabel'->>'en', d."content"->'offerLabel'->>'ar',
                 d."content"->'shortDescription'->>'en', d."content"->'shortDescription'->>'ar',
                 o."nameEn", o."nameAr", m."tradeNameEn", m."tradeNameAr", c."nameEn", c."nameAr") AS haystack,
               concat_ws(' ', d."titleEn", d."titleAr", d."content"->'offerLabel'->>'en', d."content"->'offerLabel'->>'ar') AS title_hay,
               concat_ws(' ', o."nameEn", o."nameAr", m."tradeNameEn", m."tradeNameAr") AS merchant_hay
        FROM "LiveDeal" d
        JOIN "Organization" o ON o."id" = d."organizationId" AND o."type" = 'MERCHANT' AND o."status" = 'ACTIVE'
        LEFT JOIN "Merchant" m ON m."organizationId" = o."id"
        LEFT JOIN "Category" c ON c."id" = d."categoryId"
        JOIN "LiveDealBranch" lb ON lb."dealId" = d."id"
        JOIN "MerchantBranch" b ON b."id" = lb."branchId" AND b."status" = 'ACTIVE'
             AND lower(b."city") = lower(${city})
        WHERE d."status" IN ('SCHEDULED', 'LIVE')
          AND d."startAt" <= ${nowTs}
          AND (d."endAt" IS NULL OR d."endAt" > ${nowTs})
          ${p.category ? Prisma.sql`AND c."code" = ${p.category} AND c."active"` : Prisma.empty}
          ${p.organizationId ? Prisma.sql`AND d."organizationId" = ${p.organizationId}::uuid` : Prisma.empty}
          ${p.onlyWithEndDate ? Prisma.sql`AND d."endAt" IS NOT NULL` : Prisma.empty}
          ${
            point && p.radiusMeters
              ? Prisma.sql`AND ST_DWithin(b."location", ${point}, ${p.radiusMeters}::float8)`
              : Prisma.empty
          }
      ), best AS (
        SELECT DISTINCT ON (id) *, (${score}) AS score FROM cand ORDER BY id, dist ASC NULLS LAST
      )
      SELECT id, "branchId", dist FROM best
      WHERE ${textWhere}
      ORDER BY ${order}
      OFFSET ${offset}::int LIMIT ${take}::int`);
  }

  /** Distances (metres) from a point to specific branches. */
  async branchDistances(branchIds: string[], lat?: number, lng?: number) {
    const out = new Map<string, number>();
    if (!branchIds.length || lat === undefined || lng === undefined) return out;
    const rows = await this.prisma.$queryRaw<Array<{ id: string; dist: number }>>(Prisma.sql`
      SELECT b."id", ST_Distance(b."location", ${this.point(lat, lng)}) AS dist
      FROM "MerchantBranch" b
      WHERE b."id" = ANY(${branchIds}::uuid[]) AND b."location" IS NOT NULL`);
    for (const r of rows) out.set(r.id, Math.round(Number(r.dist)));
    return out;
  }

  // ---------------------------------------------------------------- cities
  /** Public app configuration: the enabled cities (configuration, not code) with their centres. */
  async appConfig() {
    const [enabled, centers, map] = await Promise.all([
      this.core.enabledCities(),
      this.core.cityCenters(),
      this.config.get<{ tileUrlTemplate?: string | null; attribution?: string | null }>(
        CONFIG_KEYS.CUSTOMER_MAP,
      ),
    ]);
    return {
      defaultCity: enabled[0] ?? DEFAULT_CITY,
      cities: enabled.map((name) => ({
        name,
        nameAr: centers[name]?.nameAr ?? name,
        latitude: centers[name]?.latitude ?? null,
        longitude: centers[name]?.longitude ?? null,
      })),
      // the map's base layer is a provider choice: with none configured the app draws pins on its own plain canvas
      map: {
        tileUrlTemplate: map?.tileUrlTemplate ?? null,
        attribution: map?.attribution ?? null,
      },
    };
  }

  private async resolveCity(city?: string) {
    const enabled = await this.core.enabledCities();
    const wanted = (city ?? enabled[0] ?? DEFAULT_CITY).trim();
    const match = enabled.find((c) => c.toLowerCase() === wanted.toLowerCase());
    return { city: match ?? wanted, enabled: !!match };
  }

  private outcomeOf(row: DealRow, ctx: EligibilityContext): EligibilityOutcome {
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

  private async savedSet(userId: string | null, ids: string[]) {
    if (!userId || !ids.length) return new Set<string>();
    const rows = await this.prisma.savedItem.findMany({
      where: { userId, objectType: 'LIVE_DEAL', objectId: { in: ids } },
      select: { objectId: true },
    });
    return new Set(rows.map((r) => r.objectId));
  }

  // ---------------------------------------------------------------- listing
  /**
   * Visible deals as cards. Candidates come from SQL in order; eligibility is applied afterwards (deals the customer
   * can never unlock are dropped, locked ones are kept unless `eligibility=unlocked`). The cursor is an opaque offset
   * into the ordered candidate list, which keeps paging stable while eligibility filtering happens.
   */
  async list(p: DiscoveryParams, userId: string | null, now = new Date()): Promise<Page<DealCard>> {
    const { city, enabled } = await this.resolveCity(p.city);
    if (!enabled) return new Page<DealCard>([], null);
    const ctx = await this.eligibility.contextFor(userId, city, now);
    const dec = decodeCursor(p.cursor);
    let offset = dec && typeof dec.v === 'number' ? Math.max(0, dec.v) : 0;
    const kept: Array<{ row: DealRow; cand: Candidate; outcome: EligibilityOutcome }> = [];
    let more = false;

    for (let round = 0; round < 6 && kept.length < p.limit; round++) {
      const take = Math.max(p.limit * 2, 20);
      const cands = await this.candidates(p, city, offset, take, now);
      if (!cands.length) {
        more = false;
        break;
      }
      const rows = await this.prisma.liveDeal.findMany({
        where: { id: { in: cands.map((c) => c.id) } },
        include: DEAL_INCLUDE,
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
        kept.push({ row, cand, outcome });
        if (kept.length === p.limit) break;
      }
      offset += consumed;
      more = consumed < cands.length || cands.length === take;
      if (kept.length >= p.limit) break;
    }

    const saved = await this.savedSet(
      userId,
      kept.map((k) => k.row.id),
    );
    const cx = new Map<string, CardContext>(
      kept.map((k) => [
        k.row.id,
        {
          outcome: k.outcome,
          nearest: {
            distanceMeters: k.cand.dist === null ? null : Math.round(Number(k.cand.dist)),
            branchId: k.cand.branchId,
          },
          saved: saved.has(k.row.id),
          city,
        },
      ]),
    );
    const cards = await this.presenter.cards(
      kept.map((k) => k.row),
      cx,
      (r) => parseContent(r.content),
    );
    return new Page(cards, more ? encodeCursor({ v: offset, id: 'offset' }) : null);
  }

  async nearby(
    p: DiscoveryParams & { lat: number; lng: number },
    userId: string | null,
  ): Promise<Page<DealCard>> {
    return this.list({ ...p, sort: 'nearest', radiusMeters: p.radiusMeters ?? 5000 }, userId);
  }

  // ---------------------------------------------------------------- home
  async home(
    q: { city?: string; lat?: number; lng?: number },
    userId: string | null,
    now = new Date(),
  ) {
    const { city, enabled } = await this.resolveCity(q.city);
    const categories = await this.prisma.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    if (!enabled)
      return {
        city,
        cityEnabled: false,
        categories: categories.map((c) => ({ ...this.categoryView(c), dealCount: 0 })),
        liveNow: [],
        nearYou: [],
        endingSoon: [],
      };

    // Category counts reflect what THIS customer can see (eligibility applied), not raw totals.
    const all = await this.candidates({ limit: 500 }, city, 0, 500, now);
    const ctx = await this.eligibility.contextFor(userId, city, now);
    const rows = all.length
      ? await this.prisma.liveDeal.findMany({
          where: { id: { in: all.map((c) => c.id) } },
          include: { ruleSet: { include: { conditions: true } } },
        })
      : [];
    const counts = new Map<string, number>();
    for (const r of rows) {
      const o = evaluateEligibility(
        r.eligibilityKind,
        r.ruleSet?.conditions.map((c) => ({
          attrType: c.attrType,
          valueRef: c.valueRef,
          requiredLevel: c.requiredLevel,
        })) ?? [],
        ctx,
        r.ruleSet?.expression,
      );
      if (o.result !== 'HIDDEN' && r.categoryId)
        counts.set(r.categoryId, (counts.get(r.categoryId) ?? 0) + 1);
    }

    const centers = await this.core.cityCenters();
    const centre = centers[city] ?? Object.values(centers)[0] ?? RIYADH_CENTER;
    const point =
      q.lat !== undefined && q.lng !== undefined
        ? { lat: q.lat, lng: q.lng }
        : { lat: centre.latitude, lng: centre.longitude };
    const [liveNow, nearYou, endingSoon] = await Promise.all([
      this.list({ city, limit: 10, sort: 'newest' }, userId, now),
      this.list({ city, limit: 10, sort: 'nearest', ...point }, userId, now),
      this.list({ city, limit: 10, sort: 'ending_soon', onlyWithEndDate: true }, userId, now),
    ]);
    return {
      city,
      cityEnabled: true,
      categories: categories.map((c) => ({
        ...this.categoryView(c),
        dealCount: counts.get(c.id) ?? 0,
      })),
      liveNow: liveNow.items,
      nearYou: nearYou.items,
      endingSoon: endingSoon.items,
    };
  }

  private categoryView(c: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string;
    icon: string | null;
    sortOrder: number;
    active: boolean;
  }) {
    return {
      id: c.id,
      code: c.code,
      nameEn: c.nameEn,
      nameAr: c.nameAr,
      icon: c.icon,
      sortOrder: c.sortOrder,
      active: c.active,
    };
  }

  // ---------------------------------------------------------------- detail
  /** Visible deal detail, 404 when the deal is not public or the customer has no realistic way to unlock it. */
  async detail(
    id: string,
    userId: string | null,
    q: { city?: string; lat?: number; lng?: number },
    now = new Date(),
  ): Promise<DealDetail> {
    const { city } = await this.resolveCity(q.city);
    const row = await this.prisma.liveDeal.findFirst({
      where: {
        id,
        status: { in: ['SCHEDULED', 'LIVE'] },
        startAt: { lte: now },
        OR: [{ endAt: null }, { endAt: { gt: now } }],
        organization: { status: 'ACTIVE' },
      },
      include: DEAL_INCLUDE,
    });
    const activeBranches =
      row?.branches.map((b) => b.branch).filter((b) => b.status === 'ACTIVE') ?? [];
    if (!row || !activeBranches.length) throw AppError.notFound();
    const ctx = await this.eligibility.contextFor(userId, city, now);
    const outcome = this.outcomeOf(row, ctx);
    if (outcome.result === 'HIDDEN') throw AppError.notFound();
    const distances = await this.branchDistances(
      activeBranches.map((b) => b.id),
      q.lat,
      q.lng,
    );
    const nearestId =
      [...distances.entries()].sort((a, b) => a[1] - b[1])[0]?.[0] ?? activeBranches[0]!.id;
    const saved = await this.savedSet(userId, [id]);
    return this.presenter.detail(
      row,
      parseContent(row.content),
      {
        outcome,
        nearest: { distanceMeters: distances.get(nearestId) ?? null, branchId: nearestId },
        saved: saved.has(id),
      },
      activeBranches,
      distances,
    );
  }

  // ---------------------------------------------------------------- merchant page
  async merchantPage(
    id: string,
    userId: string | null,
    q: { city?: string; lat?: number; lng?: number },
    now = new Date(),
  ): Promise<MerchantPage> {
    const org = await this.prisma.organization.findFirst({
      where: { id, type: 'MERCHANT', status: 'ACTIVE' },
      include: {
        merchant: true,
        branches: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!org?.merchant || !org.branches.length) throw AppError.notFound();
    const { city } = await this.resolveCity(q.city);
    const distances = await this.branchDistances(
      org.branches.map((b) => b.id),
      q.lat,
      q.lng,
    );
    const deals = await this.list(
      {
        city,
        limit: 50,
        organizationId: id,
        lat: q.lat,
        lng: q.lng,
        sort: q.lat !== undefined ? 'nearest' : 'newest',
      },
      userId,
      now,
    );
    const urls = await this.files.signedUrls([org.merchant.logoFileId, org.merchant.coverFileId]);
    // the merchant's category is the one most of its live deals use
    const catCount = new Map<string, { n: number; cat: NonNullable<DealCard['category']> }>();
    for (const d of deals.items)
      if (d.category) {
        const e = catCount.get(d.category.code) ?? { n: 0, cat: d.category };
        e.n++;
        catCount.set(d.category.code, e);
      }
    const top = [...catCount.values()].sort((a, b) => b.n - a.n)[0];
    return {
      id: org.id,
      name: merchantDisplayName(org as unknown as DealRow['organization']),
      logoUrl: this.presenter.urlOf(urls, org.merchant.logoFileId),
      coverUrl: this.presenter.urlOf(urls, org.merchant.coverFileId),
      description: { en: org.merchant.descriptionEn, ar: org.merchant.descriptionAr },
      category: top?.cat ?? null,
      // Only public display information: the business phone, never e-mail, registration or settlement details.
      phone: org.merchant.businessPhone,
      branches: org.branches
        .map((b) => this.presenter.publicBranch(b, distances.get(b.id) ?? null))
        .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)),
      deals: deals.items,
    };
  }

  // ---------------------------------------------------------------- search
  async search(p: DiscoveryParams, userId: string | null, now = new Date()) {
    const { city, enabled } = await this.resolveCity(p.city);
    const query = (p.q ?? '').trim();
    if (!enabled || !query) return { query, deals: [], merchants: [] };
    const deals = await this.list({ ...p, q: query, city }, userId, now);
    const tokens = searchTokens(query);
    const hasPoint = p.lat !== undefined && p.lng !== undefined;
    const nowTs = this.nowTs(now);
    const where = Prisma.join(
      tokens.map(
        (t) =>
          Prisma.sql`dd_norm_ar(concat_ws(' ', o."nameEn", o."nameAr", m."tradeNameEn", m."tradeNameAr")) LIKE ${'%' + escapeLike(t) + '%'} ESCAPE '\\'`,
      ),
      ' AND ',
    );
    const rows = tokens.length
      ? await this.prisma.$queryRaw<
          Array<{ id: string; deals: number; dist: number | null }>
        >(Prisma.sql`
          SELECT o."id", count(DISTINCT d."id")::int AS deals,
                 ${hasPoint ? Prisma.sql`min(ST_Distance(b."location", ${this.point(p.lat!, p.lng!)}))` : Prisma.sql`NULL::float8`} AS dist
          FROM "Organization" o
          JOIN "Merchant" m ON m."organizationId" = o."id"
          JOIN "LiveDeal" d ON d."organizationId" = o."id" AND d."status" IN ('SCHEDULED', 'LIVE')
               AND d."startAt" <= ${nowTs} AND (d."endAt" IS NULL OR d."endAt" > ${nowTs})
          JOIN "LiveDealBranch" lb ON lb."dealId" = d."id"
          JOIN "MerchantBranch" b ON b."id" = lb."branchId" AND b."status" = 'ACTIVE' AND lower(b."city") = lower(${city})
          WHERE o."type" = 'MERCHANT' AND o."status" = 'ACTIVE' AND ${where}
          GROUP BY o."id"
          ORDER BY deals DESC, o."id"
          LIMIT 10`)
      : [];
    const orgs = rows.length
      ? await this.prisma.organization.findMany({
          where: { id: { in: rows.map((r) => r.id) } },
          include: { merchant: true },
        })
      : [];
    const urls = await this.files.signedUrls(orgs.map((o) => o.merchant?.logoFileId));
    return {
      query,
      deals: deals.items,
      merchants: rows.flatMap((r) => {
        const o = orgs.find((x) => x.id === r.id);
        if (!o) return [];
        const cat = deals.items.find((d) => d.merchantId === o.id)?.category ?? null;
        return [
          {
            id: o.id,
            name: merchantDisplayName(o as unknown as DealRow['organization']),
            logoUrl: this.presenter.urlOf(urls, o.merchant?.logoFileId),
            category: cat,
            dealCount: r.deals,
            distanceMeters: r.dist === null ? null : Math.round(Number(r.dist)),
          },
        ];
      }),
    };
  }

  // ---------------------------------------------------------------- saved
  async saved(userId: string, now = new Date()): Promise<DealCard[]> {
    const items = await this.prisma.savedItem.findMany({
      where: { userId, objectType: 'LIVE_DEAL' },
      orderBy: { savedAt: 'desc' },
      take: 100,
    });
    if (!items.length) return [];
    const rows = await this.prisma.liveDeal.findMany({
      where: { id: { in: items.map((i) => i.objectId) } },
      include: DEAL_INCLUDE,
    });
    const order = new Map(items.map((i, n) => [i.objectId, n]));
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const ctx = await this.eligibility.contextFor(userId, await this.core.defaultCity(), now);
    const cx = new Map<string, CardContext>(
      rows.map((r) => [r.id, { outcome: this.outcomeOf(r, ctx), saved: true }]),
    );
    const cards = await this.presenter.cards(rows, cx, (r) => parseContent(r.content));
    // An ended or paused deal stays visible to its savers with its real state; a deal hidden by the merchant lifecycle
    // (for example suspended) shows as unavailable.
    return cards.map((c, i) => {
      const r = rows[i]!;
      const visible =
        (r.status === 'LIVE' || r.status === 'SCHEDULED') &&
        r.organization.status === 'ACTIVE' &&
        (!r.endAt || r.endAt.getTime() > now.getTime());
      return visible
        ? c
        : {
            ...c,
            availability:
              r.status === 'PAUSED'
                ? 'PAUSED'
                : r.status === 'EXPIRED' || (r.endAt && r.endAt <= now)
                  ? 'ENDED'
                  : 'UNAVAILABLE',
          };
    });
  }

  async save(userId: string, dealId: string, now = new Date()) {
    const deal = await this.prisma.liveDeal.findFirst({
      where: {
        id: dealId,
        status: { in: ['SCHEDULED', 'LIVE'] },
        startAt: { lte: now },
        OR: [{ endAt: null }, { endAt: { gt: now } }],
        organization: { status: 'ACTIVE' },
      },
      select: { id: true, organizationId: true },
    });
    if (!deal) throw AppError.notFound();
    const existing = await this.prisma.savedItem.findUnique({
      where: { userId_objectType_objectId: { userId, objectType: 'LIVE_DEAL', objectId: dealId } },
    });
    if (existing) return { saved: true };
    await this.prisma.savedItem.create({
      data: { userId, objectType: 'LIVE_DEAL', objectId: dealId },
    });
    await this.events.recordDirect('SAVE', deal, userId);
    return { saved: true };
  }

  async unsave(userId: string, dealId: string) {
    const res = await this.prisma.savedItem.deleteMany({
      where: { userId, objectType: 'LIVE_DEAL', objectId: dealId },
    });
    if (res.count) {
      const deal = await this.prisma.liveDeal.findUnique({
        where: { id: dealId },
        select: { id: true, organizationId: true },
      });
      if (deal) await this.events.recordDirect('UNSAVE', deal, userId);
    }
    return { saved: false };
  }
}
