/**
 * Pakistan UAT market (founder approval 2026-10-13, "PAKISTAN DEVELOPMENT / UAT MARKET"): prepares the DEVELOPMENT database for Pakistan
 * UAT through the governed services an administrator uses (market master, lifecycle, product availability, configuration), each change
 * validated and audited under a named DealDash administrator with a reason. Never a raw table edit, never a reset, never a seed.
 *
 *   pnpm --filter @dealdash/api exec tsx scripts/ops/pk-uat-market.ts      (DATABASE_URL from the repo-root .env)
 *
 *  - refuses anything but a LOCAL *_dev / *_test database, and production
 *  - market PK: PKR, Asia/Karachi; lifecycle PLANNED -> CONFIGURING -> TESTING only. PILOT / ACTIVE are never requested here: they are
 *    gated (legal entity, providers, tax, invoicing, terms ...) and need a second approver
 *  - products TESTING, each noted CONFIGURATION REQUIRED / FOUNDER DECISION REQUIRED: no PKR commercial value (pricing agreement, rate
 *    card, fee) is created or assumed
 *  - selected Pakistani cities enabled for discovery (centres are public geographic coordinates)
 *  - PKR present in the campaign ledger currencies
 * Idempotent: a second run changes nothing.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { MARKET_PRODUCTS, type MarketStatus, type PermissionCode } from '@dealdash/types';
import { CONFIG_KEYS } from '@dealdash/config';
import { AuditService } from '../../src/audit/audit.service';
import { loadDotEnv, loadEnv } from '../../src/common/env';
import type { Actor, RequestMeta } from '../../src/common/request-context';
import { PrismaClient } from '../../src/generated/prisma/client';
import { MarketService } from '../../src/platform/markets/market.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { ensureMarketDefaults } from '../../src/seed/markets';
import { SystemConfigService } from '../../src/system-config/system-config.service';

const CODE = 'PK';
const CITIES: Record<string, { nameAr: string; latitude: number; longitude: number }> = {
  Karachi: { nameAr: 'كراتشي', latitude: 24.8607, longitude: 67.0011 },
  Lahore: { nameAr: 'لاهور', latitude: 31.5204, longitude: 74.3587 },
  Islamabad: { nameAr: 'إسلام آباد', latitude: 33.6844, longitude: 73.0479 },
};
const NOTE =
  'Pakistan UAT (development only). CONFIGURATION REQUIRED / FOUNDER DECISION REQUIRED: no PKR commercial value (pricing agreement, rate card, fee) is configured.';
const REASON = 'Founder approval 2026-10-13: Pakistan development / UAT market (PKR, Asia/Karachi)';

function assertSafeTarget(url: string) {
  const u = new URL(url.split('?')[0]!);
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing: NODE_ENV is production');
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname))
    throw new Error(`Refusing a non-local database (${u.hostname})`);
  if (!/_(dev|test)$/.test(db))
    throw new Error(`Refusing "${db}": only a *_dev or *_test database is prepared for UAT`);
  return db;
}

async function adminActor(db: PrismaClient): Promise<Actor> {
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
    sessionId: 'ops-pk-uat-market',
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

async function main() {
  loadDotEnv();
  const env = loadEnv();
  const target = assertSafeTarget(env.DATABASE_URL);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  const db = prisma as unknown as PrismaService;
  const audit = new AuditService(db);
  const config = new SystemConfigService(db, audit);
  // unscoped administrator: the scope service is never consulted; the process environment decides whether the UAT gate applies
  const markets = new MarketService(db, audit, config, null as never, {
    APP_ENV: env.APP_ENV,
    NODE_ENV: env.NODE_ENV,
  });
  const meta: RequestMeta = {
    requestId: `ops-pk-uat-${Date.now()}`,
    ip: null,
    userAgent: 'scripts/ops/pk-uat-market.ts',
    locale: 'en',
  };
  const done: string[] = [];
  try {
    const actor = await adminActor(prisma);

    // 1. market master (region and register first: fills only what is empty, never moves a market's lifecycle)
    await ensureMarketDefaults(prisma);
    const before = await prisma.countryConfiguration.findUnique({ where: { code: CODE } });
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
        CODE,
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
      if (to === 'PILOT' || to === 'ACTIVE')
        throw new Error('This script never activates a market');
    };
    for (const [from, to] of [
      ['PLANNED', 'CONFIGURING'],
      ['CONFIGURING', 'TESTING'],
    ] as const) {
      const m = await prisma.countryConfiguration.findUniqueOrThrow({ where: { code: CODE } });
      if (m.status === from) {
        await markets.requestTransition(actor, CODE, to, REASON, noActivation, meta);
        done.push(`market PK ${from} -> ${to}`);
      }
    }

    // 3. products: TESTING, each marked CONFIGURATION REQUIRED (no PKR commercial value exists)
    const rows = await prisma.marketProduct.findMany({ where: { market: CODE } });
    for (const product of MARKET_PRODUCTS) {
      const r = rows.find((x) => x.product === product);
      if (r?.status === 'TESTING' && r.notes === NOTE) continue;
      await markets.setProduct(actor, CODE, product, 'TESTING', NOTE, meta);
      done.push(`product ${product} TESTING`);
    }

    // 4. selected Pakistani cities (discovery + campaign targeting); existing cities are kept
    const cities = (await config.get<string[]>(CONFIG_KEYS.ENABLED_CITIES)) ?? [];
    const addCities = Object.keys(CITIES).filter((c) => !cities.includes(c));
    if (addCities.length) {
      await config.set(CONFIG_KEYS.ENABLED_CITIES, [...cities, ...addCities], REASON, actor, meta);
      done.push(`enabled cities + ${addCities.join(', ')}`);
    }
    const centres =
      (await config.get<Record<string, unknown>>(CONFIG_KEYS.DISCOVERY_CITY_CENTERS)) ?? {};
    const addCentres = Object.keys(CITIES).filter((c) => !centres[c]);
    if (addCentres.length) {
      await config.set(
        CONFIG_KEYS.DISCOVERY_CITY_CENTERS,
        { ...centres, ...Object.fromEntries(addCentres.map((c) => [c, CITIES[c]])) },
        REASON,
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
        REASON,
        actor,
        meta,
      );
      done.push('campaign ledger currencies + PKR');
    }

    // 6. founder decision 2026-10-13 (option a): TESTING markets take new business on THIS development database only. The API honours
    //    the setting only in a local / development / test process; staging and production ignore it (normal lifecycle + readiness gates).
    const now = await prisma.systemConfiguration.findUnique({
      where: { key: CONFIG_KEYS.MARKETS },
    });
    const cur = (now?.value ?? {}) as Record<string, unknown>;
    if (cur.developmentUatTestingOpen !== true) {
      await config.set(
        CONFIG_KEYS.MARKETS,
        { ...cur, developmentUatTestingOpen: true },
        'Founder decision 2026-10-13 (option a): development-only UAT — TESTING markets may take new business',
        actor,
        meta,
      );
      done.push('development UAT gate: TESTING markets open for new business (this database)');
    }
    config.invalidate();

    // summary (no credentials, no personal data)
    const m = await prisma.countryConfiguration.findUniqueOrThrow({ where: { code: CODE } });
    const s = await markets.settings();
    const open = await markets.isAvailable(CODE, 'VOUCHER');
    const validations = await prisma.marketValidationItem.count({
      where: { market: CODE, status: { in: ['OPEN', 'IN_REVIEW'] } },
    });
    console.log(
      JSON.stringify(
        {
          database: target,
          actor: actor.displayName,
          changes: done.length ? done : ['none (already prepared)'],
          market: {
            code: m.code,
            status: m.status,
            currency: m.currency,
            supportedCurrencies: m.supportedCurrencies,
            timezone: m.timezone,
            languages: m.languages,
            legalEntity: m.dealdashLegalEntityId
              ? 'assigned'
              : 'none (founder decision: no entity yet)',
          },
          products: (await prisma.marketProduct.findMany({ where: { market: CODE } })).map(
            (p) => `${p.product}:${p.status}`,
          ),
          enabledCities: await config.get(CONFIG_KEYS.ENABLED_CITIES),
          campaignLedgerCurrencies: s.campaignLedgerCurrencies,
          newBusinessOpen: open.ok,
          newBusinessOpenStatuses: s.availableStatuses,
          developmentUatGate: s.developmentUatTestingOpen,
          openValidateItems: validations,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
