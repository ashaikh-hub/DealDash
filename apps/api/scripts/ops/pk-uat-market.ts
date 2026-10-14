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
 *  - development only: the UAT gate that lets TESTING markets take new business (staging and production ignore it)
 * Idempotent: a second run changes nothing. Steps 1–5 are shared with the staging seed (src/seed/pk-testing-market.ts).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { CONFIG_KEYS } from '@dealdash/config';
import { loadDotEnv, loadEnv } from '../../src/common/env';
import type { RequestMeta } from '../../src/common/request-context';
import { PrismaClient } from '../../src/generated/prisma/client';
import {
  PK_CODE as CODE,
  adminActor,
  pkMarketContext,
  preparePkTestingMarket,
} from '../../src/seed/pk-testing-market';

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

async function main() {
  loadDotEnv();
  const env = loadEnv();
  const target = assertSafeTarget(env.DATABASE_URL);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  const ctx = pkMarketContext(prisma, env);
  const { config, markets } = ctx;
  const meta: RequestMeta = {
    requestId: `ops-pk-uat-${Date.now()}`,
    ip: null,
    userAgent: 'scripts/ops/pk-uat-market.ts',
    locale: 'en',
  };
  try {
    const actor = await adminActor(prisma, 'ops-pk-uat-market');

    // 1–5. market master, lifecycle to TESTING, products, cities, PKR ledger currency
    const done = await preparePkTestingMarket(prisma, ctx, actor, meta);

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
