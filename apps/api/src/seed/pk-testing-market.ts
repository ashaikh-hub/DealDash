/**
 * Pakistan TESTING market (founder approval 2026-10-13): prepares a database for Pakistan UAT through the governed services an
 * administrator uses (market master, lifecycle, product availability, configuration), each change validated and audited under a named
 * DealDash administrator with a reason. Never a raw table edit. Used by the development script `scripts/ops/pk-uat-market.ts` and by
 * the staging seed (launch readiness G-2).
 *
 *  - market PK: PKR, Asia/Karachi; lifecycle PLANNED -> CONFIGURING -> TESTING only. PILOT / ACTIVE are never requested here: they are
 *    gated (legal entity, providers, tax, invoicing, terms ...) and need a second approver
 *  - products TESTING, each noted CONFIGURATION REQUIRED / FOUNDER DECISION REQUIRED: no PKR commercial value (pricing agreement, rate
 *    card, fee) is created or assumed
 *  - selected Pakistani cities enabled for discovery (centres are public geographic coordinates)
 *  - PKR present in the campaign ledger currencies
 * Idempotent: a second run changes nothing.
 */
import { MARKET_PRODUCTS, type MarketStatus, type PermissionCode } from '@dealdash/types';
import { CONFIG_KEYS } from '@dealdash/config';
import { AuditService } from '../audit/audit.service';
import type { Actor, RequestMeta } from '../common/request-context';
import type { PrismaClient } from '../generated/prisma/client';
import { MarketService } from '../platform/markets/market.service';
import type { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { ensureMarketDefaults } from './markets';

export const PK_CODE = 'PK';
const CITIES: Record<string, { nameAr: string; latitude: number; longitude: number }> = {
  Karachi: { nameAr: 'كراتشي', latitude: 24.8607, longitude: 67.0011 },
  Lahore: { nameAr: 'لاهور', latitude: 31.5204, longitude: 74.3587 },
  Islamabad: { nameAr: 'إسلام آباد', latitude: 33.6844, longitude: 73.0479 },
};
const NOTE =
  'Pakistan UAT (development only). CONFIGURATION REQUIRED / FOUNDER DECISION REQUIRED: no PKR commercial value (pricing agreement, rate card, fee) is configured.';
export const PK_REASON =
  'Founder approval 2026-10-13: Pakistan development / UAT market (PKR, Asia/Karachi)';

/** The first active, unscoped DealDash administrator holding the market and configuration permissions. */
export async function adminActor(db: PrismaClient, sessionId: string): Promise<Actor> {
  const need: PermissionCode[] = ['admin.markets.manage', 'admin.config.manage'];
  const members = await db.organizationMembership.findMany({
    where: {
      status: 'ACTIVE',
      scoped: false,
      organization: { type: 'DEALDASH' },
      user: { status: 'ACTIVE' },
    },
    include: {
      user: true,
      role: { include: { permissions: { include: { permission: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const m = members.find((x) => {
    const codes = new Set(x.role.permissions.map((p) => p.permission.code));
    return need.every((n) => codes.has(n));
  });
  if (!m)
    throw new Error(
      'No active DealDash administrator holds the market and configuration permissions',
    );
  return {
    userId: m.userId,
    userType: m.user.userType,
    displayName: m.user.displayName,
    audience: 'admin',
    sessionId,
    mfaVerified: true,
    mfaRequired: true,
    membership: {
      id: m.id,
      organizationId: m.organizationId,
      organizationType: 'DEALDASH',
      roleCode: m.role.code as never,
      branchId: null,
      scoped: false,
    },
    memberships: [],
    permissions: new Set(m.role.permissions.map((p) => p.permission.code as PermissionCode)),
    viaCookie: false,
  } as Actor;
}

export interface PkMarketContext {
  db: PrismaService;
  audit: AuditService;
  config: SystemConfigService;
  markets: MarketService;
}

/** Governed services over a plain Prisma client (scripts and seeds run outside the Nest application). */
export function pkMarketContext(
  prisma: PrismaClient,
  env: { APP_ENV?: string; NODE_ENV: string },
): PkMarketContext {
  const db = prisma as unknown as PrismaService;
  const audit = new AuditService(db);
  const config = new SystemConfigService(db, audit);
  // unscoped administrator: the scope service is never consulted; the process environment decides whether the UAT gate applies
  const markets = new MarketService(db, audit, config, null as never, {
    APP_ENV: env.APP_ENV as never,
    NODE_ENV: env.NODE_ENV as never,
  });
  return { db, audit, config, markets };
}

/** Steps 1–5 (market master, lifecycle to TESTING, products TESTING, cities, PKR ledger currency). Returns the changes made. */
export async function preparePkTestingMarket(
  prisma: PrismaClient,
  ctx: PkMarketContext,
  actor: Actor,
  meta: RequestMeta,
): Promise<string[]> {
  const { markets, config } = ctx;
  const done: string[] = [];

  // 1. market master (region and register first: fills only what is empty, never moves a market's lifecycle)
  await ensureMarketDefaults(prisma);
  const before = await prisma.countryConfiguration.findUnique({ where: { code: PK_CODE } });
  const wanted = {
    currency: 'PKR',
    timezone: 'Asia/Karachi',
    callingCode: '+92',
    isoAlpha3: 'PAK',
    regionCode: 'SOUTH_ASIA',
  };
  const differs =
    !before ||
    Object.entries(wanted).some(([k, v]) => (before as Record<string, unknown>)[k] !== v) ||
    before.supportedCurrencies.join() !== 'PKR';
  if (differs) {
    await markets.upsert(
      actor,
      PK_CODE,
      {
        nameEn: 'Pakistan',
        nameAr: 'باكستان',
        ...wanted,
        supportedCurrencies: ['PKR'],
        billingCurrency: 'PKR',
        settlementCurrency: 'PKR',
        taxCurrency: 'PKR',
        currencyDecimals: 2,
        roundingRule: 'HALF_UP',
        // Urdu is founder-approved for the customer app but not built yet (open Launch Readiness item): add 'ur' when it ships
        languages: before?.languages.length ? before.languages : ['en'],
        defaultLanguage: before?.defaultLanguage ?? 'en',
        // no DealDash legal entity exists for Pakistan yet (founder decision): left empty, so PILOT stays gated
        dealdashLegalEntityId: before?.dealdashLegalEntityId ?? null,
      },
      meta,
    );
    done.push(before ? 'market PK master updated' : 'market PK created (PLANNED)');
  }
  await ensureMarketDefaults(prisma); // VALIDATE-PAKISTAN register + product rows

  // 2. lifecycle: up to TESTING only (no gate, no approval needed; PILOT / ACTIVE are refused here by design)
  const noActivation = async (to: MarketStatus) => {
    if (to === 'PILOT' || to === 'ACTIVE') throw new Error('This script never activates a market');
  };
  for (const [from, to] of [
    ['PLANNED', 'CONFIGURING'],
    ['CONFIGURING', 'TESTING'],
  ] as const) {
    const m = await prisma.countryConfiguration.findUniqueOrThrow({ where: { code: PK_CODE } });
    if (m.status === from) {
      await markets.requestTransition(actor, PK_CODE, to, PK_REASON, noActivation, meta);
      done.push(`market PK ${from} -> ${to}`);
    }
  }

  // 3. products: TESTING, each marked CONFIGURATION REQUIRED (no PKR commercial value exists)
  const rows = await prisma.marketProduct.findMany({ where: { market: PK_CODE } });
  for (const product of MARKET_PRODUCTS) {
    const r = rows.find((x) => x.product === product);
    if (r?.status === 'TESTING' && r.notes === NOTE) continue;
    await markets.setProduct(actor, PK_CODE, product, 'TESTING', NOTE, meta);
    done.push(`product ${product} TESTING`);
  }

  // 4. selected Pakistani cities (discovery + campaign targeting); existing cities are kept
  const cities = (await config.get<string[]>(CONFIG_KEYS.ENABLED_CITIES)) ?? [];
  const addCities = Object.keys(CITIES).filter((c) => !cities.includes(c));
  if (addCities.length) {
    await config.set(CONFIG_KEYS.ENABLED_CITIES, [...cities, ...addCities], PK_REASON, actor, meta);
    done.push(`enabled cities + ${addCities.join(', ')}`);
  }
  const centres =
    (await config.get<Record<string, unknown>>(CONFIG_KEYS.DISCOVERY_CITY_CENTERS)) ?? {};
  const addCentres = Object.keys(CITIES).filter((c) => !centres[c]);
  if (addCentres.length) {
    await config.set(
      CONFIG_KEYS.DISCOVERY_CITY_CENTERS,
      { ...centres, ...Object.fromEntries(addCentres.map((c) => [c, CITIES[c]])) },
      PK_REASON,
      actor,
      meta,
    );
    done.push(`city centres + ${addCentres.join(', ')}`);
  }

  // 5. PKR in the campaign ledger currencies (a stored setting overrides the code default)
  const stored = await prisma.systemConfiguration.findUnique({
    where: { key: CONFIG_KEYS.MARKETS },
  });
  const mc = (stored?.value ?? null) as { campaignLedgerCurrencies?: string[] } | null;
  if (mc?.campaignLedgerCurrencies && !mc.campaignLedgerCurrencies.includes('PKR')) {
    await config.set(
      CONFIG_KEYS.MARKETS,
      { ...mc, campaignLedgerCurrencies: [...mc.campaignLedgerCurrencies, 'PKR'] },
      PK_REASON,
      actor,
      meta,
    );
    done.push('campaign ledger currencies + PKR');
  }
  config.invalidate();
  return done;
}
