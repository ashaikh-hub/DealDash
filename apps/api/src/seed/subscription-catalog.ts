import type { PrismaClient } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Pakistan commercial configuration (FD-24 is closed for the architecture and for these current Pakistan values).
 *
 * These are DATA, not application logic: DealDash Admin changes them later by publishing new plan / price versions, with no
 * deployment. Amounts are integer minor units (PKR x 100). A value marked `indicative` is a reference ("from ...") and is never charged
 * as a list price: a negotiated contract rate decides the real amount. Tax and accounting treatment are market configuration and are
 * not stated here.
 */
const PKR = 100;
const MARKET = 'PK';
const CURRENCY = 'PKR';

type Limit = { key: string; value: number | null; mode?: 'HARD' | 'SOFT'; period?: string; warnPercents?: number[]; softAction?: string; overageRateMinor?: number | null };
const limit = (key: string, value: number | null): Limit => ({ key, value, mode: 'HARD', period: 'NONE', warnPercents: [80, 100], softAction: 'WARN', overageRateMinor: null });

const MERCHANT_BASE_PRODUCTS = ['LIVE_DEAL', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'FEATURED_PLACEMENT'];

interface PlanSeed {
  code: string;
  nameEn: string;
  nameAr: string;
  entityType: 'MERCHANT' | 'BANK' | 'SCHEME' | 'CORPORATE';
  contractKind: string;
  isFree?: boolean;
  negotiated?: boolean;
  sortOrder: number;
  version: {
    defaultCadence: string;
    prices: Array<{ cadence: string; amountMinor: number; indicative?: boolean }>;
    fees?: Array<{ code: string; amountMinor: number; indicative?: boolean; note?: string }>;
    addOnPrices?: Record<string, { amountMinor: number; cadence: string; indicative?: boolean }>;
    products: string[];
    features: string[];
    limits: Limit[];
    addOnCodes?: string[];
    supportLevel: string;
    trialDays?: number | null;
    referencePricing?: Record<string, unknown>;
  };
}

const SCHEME_FEATURES = [
  'MERCHANT_INGESTION_MANUAL', 'MERCHANT_INGESTION_BULK', 'MERCHANT_INGESTION_API', 'OFFER_API_INTEGRATION', 'OFFER_SYNCHRONIZATION', 'ELIGIBILITY_SYNCHRONIZATION',
  'LOCAL_OFFERS', 'NATIONAL_OFFERS', 'REGIONAL_OFFERS', 'INTERNATIONAL_OFFERS', 'SPONSORED_VISIBILITY', 'API_ACCESS', 'BULK_IMPORT', 'WEBHOOKS', 'ADVANCED_REPORTING', 'NETWORK_INTEGRATION',
];

export const PAKISTAN_PLANS: PlanSeed[] = [
  {
    code: 'STARTER',
    nameEn: 'Merchant Starter',
    nameAr: 'تاجر - الباقة الأساسية',
    entityType: 'MERCHANT',
    contractKind: 'MERCHANT_SUBSCRIPTION',
    isFree: true,
    sortOrder: 10,
    version: {
      defaultCadence: 'NONE',
      prices: [],
      products: MERCHANT_BASE_PRODUCTS,
      features: [],
      limits: [limit('branches.max', 1), limit('users.max', 2)],
      addOnCodes: ['EXTRA_BRANCH', 'EXTRA_USER'],
      supportLevel: 'STANDARD',
    },
  },
  {
    code: 'GROWTH',
    nameEn: 'Merchant Growth',
    nameAr: 'تاجر - باقة النمو',
    entityType: 'MERCHANT',
    contractKind: 'MERCHANT_SUBSCRIPTION',
    sortOrder: 20,
    version: {
      defaultCadence: 'MONTHLY',
      prices: [{ cadence: 'MONTHLY', amountMinor: 4_999 * PKR }],
      products: [...MERCHANT_BASE_PRODUCTS, 'LOYALTY', 'MEMBER_BENEFIT'],
      features: ['BULK_IMPORT', 'ADVANCED_REPORTING'],
      limits: [limit('branches.max', 5), limit('users.max', 10)],
      addOnCodes: ['EXTRA_BRANCH', 'EXTRA_USER', 'PREMIUM_ANALYTICS', 'API_ACCESS', 'API_CAPACITY'],
      supportLevel: 'STANDARD',
      trialDays: 14,
    },
  },
  {
    code: 'BUSINESS',
    nameEn: 'Merchant Business',
    nameAr: 'تاجر - باقة الأعمال',
    entityType: 'MERCHANT',
    contractKind: 'MERCHANT_SUBSCRIPTION',
    sortOrder: 30,
    version: {
      defaultCadence: 'MONTHLY',
      prices: [{ cadence: 'MONTHLY', amountMinor: 14_999 * PKR }],
      products: [...MERCHANT_BASE_PRODUCTS, 'LOYALTY', 'MEMBER_BENEFIT', 'PUSH_CAMPAIGNS', 'HOMEPAGE_PLACEMENT'],
      features: ['BULK_IMPORT', 'ADVANCED_REPORTING', 'API_ACCESS', 'WEBHOOKS', 'PREMIUM_ANALYTICS', 'DATA_EXPORT'],
      limits: [limit('branches.max', 25), limit('users.max', 50)],
      addOnCodes: ['EXTRA_BRANCH', 'EXTRA_USER', 'API_CAPACITY', 'ADDITIONAL_MARKET', 'DEDICATED_SUPPORT'],
      supportLevel: 'PRIORITY',
      trialDays: 14,
    },
  },
  {
    // Custom / negotiated: not a fixed fifth tier. The figures below are reference quotation values, never mandatory pricing.
    code: 'MERCHANT_ENTERPRISE',
    nameEn: 'Merchant Enterprise',
    nameAr: 'تاجر - اتفاقية المؤسسات',
    entityType: 'MERCHANT',
    contractKind: 'MERCHANT_ENTERPRISE',
    negotiated: true,
    sortOrder: 40,
    version: {
      defaultCadence: 'MONTHLY',
      prices: [{ cadence: 'MONTHLY', amountMinor: 50_000 * PKR, indicative: true }],
      fees: [
        { code: 'SETUP_FEE', amountMinor: 100_000 * PKR, indicative: true, note: 'from' },
        { code: 'API_FEE', amountMinor: 250_000 * PKR, indicative: true, note: 'API integration, from' },
      ],
      products: ['LIVE_DEAL', 'MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY', 'SPONSORED_CAMPAIGNS', 'PUSH_CAMPAIGNS', 'FEATURED_PLACEMENT', 'HOMEPAGE_PLACEMENT'],
      features: ['API_ACCESS', 'BULK_IMPORT', 'WEBHOOKS', 'ADVANCED_REPORTING', 'PREMIUM_ANALYTICS', 'DEDICATED_SUPPORT', 'DATA_EXPORT', 'NETWORK_INTEGRATION'],
      limits: [],
      supportLevel: 'DEDICATED',
      referencePricing: { subscription: 'indicative from PKR 50,000 / month', setup: 'from PKR 100,000', apiIntegration: 'from PKR 250,000', customDevelopment: 'quoted separately', dedicatedSupport: 'included or custom' },
    },
  },
  {
    code: 'BANK_ENTERPRISE',
    nameEn: 'Bank Enterprise',
    nameAr: 'بنك - اتفاقية المؤسسات',
    entityType: 'BANK',
    contractKind: 'BANK_ENTERPRISE',
    sortOrder: 50,
    version: {
      defaultCadence: 'MONTHLY',
      prices: [
        { cadence: 'MONTHLY', amountMinor: 250_000 * PKR },
        { cadence: 'ANNUAL', amountMinor: 2_500_000 * PKR },
      ],
      fees: [
        { code: 'SETUP_FEE', amountMinor: 500_000 * PKR, indicative: true, note: 'from' },
        { code: 'API_FEE', amountMinor: 500_000 * PKR, indicative: true, note: 'standard API integration, from' },
      ],
      addOnPrices: { PREMIUM_ANALYTICS: { amountMinor: 100_000 * PKR, cadence: 'MONTHLY', indicative: true } },
      products: ['LIVE_DEAL', 'MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY', 'SPONSORED_CAMPAIGNS'],
      features: ['BANK_MERCHANT_NETWORK', 'CARDHOLDER_ELIGIBILITY', 'BANK_FUNDED_CAMPAIGNS', 'MERCHANT_FUNDED_CAMPAIGNS', 'CO_FUNDED_CAMPAIGNS', 'API_ACCESS', 'BULK_IMPORT', 'ADVANCED_REPORTING'],
      limits: [],
      addOnCodes: ['PREMIUM_ANALYTICS', 'API_CAPACITY'],
      supportLevel: 'DEDICATED',
      referencePricing: { customIntegration: 'custom', premiumAnalytics: 'from PKR 100,000 / month' },
    },
  },
  {
    code: 'SCHEME_COUNTRY_NETWORK',
    nameEn: 'Scheme Country Network Licence',
    nameAr: 'شبكة بطاقات - ترخيص شبكة دولة',
    entityType: 'SCHEME',
    contractKind: 'SCHEME_NETWORK_LICENCE',
    sortOrder: 60,
    version: {
      defaultCadence: 'ANNUAL',
      prices: [{ cadence: 'ANNUAL', amountMinor: 5_000_000 * PKR, indicative: true }],
      fees: [
        { code: 'SETUP_FEE', amountMinor: 1_000_000 * PKR, indicative: true, note: 'initial setup, from' },
        { code: 'API_FEE', amountMinor: 1_500_000 * PKR, indicative: true, note: 'standard API integration, from' },
      ],
      addOnPrices: { PREMIUM_ANALYTICS: { amountMinor: 250_000 * PKR, cadence: 'MONTHLY', indicative: true } },
      products: ['LIVE_DEAL', 'MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY', 'SPONSORED_CAMPAIGNS'],
      features: SCHEME_FEATURES,
      limits: [],
      addOnCodes: ['PREMIUM_ANALYTICS', 'API_CAPACITY', 'ADDITIONAL_MARKET'],
      supportLevel: 'DEDICATED',
      referencePricing: { licence: 'Pakistan network licence, from PKR 5,000,000 / year', advancedIntegration: 'custom' },
    },
  },
  {
    code: 'SCHEME_REGIONAL',
    nameEn: 'Scheme Regional Licence',
    nameAr: 'شبكة بطاقات - ترخيص إقليمي',
    entityType: 'SCHEME',
    contractKind: 'SCHEME_NETWORK_LICENCE',
    sortOrder: 70,
    version: {
      defaultCadence: 'ANNUAL',
      prices: [{ cadence: 'ANNUAL', amountMinor: 10_000_000 * PKR, indicative: true }],
      fees: [
        { code: 'SETUP_FEE', amountMinor: 1_000_000 * PKR, indicative: true, note: 'initial setup, from' },
        { code: 'API_FEE', amountMinor: 1_500_000 * PKR, indicative: true, note: 'standard API integration, from' },
      ],
      products: ['LIVE_DEAL', 'MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY', 'SPONSORED_CAMPAIGNS'],
      features: [...SCHEME_FEATURES, 'MULTI_MARKET'],
      limits: [limit('markets.max', 5)],
      addOnCodes: ['PREMIUM_ANALYTICS', 'API_CAPACITY', 'ADDITIONAL_MARKET'],
      supportLevel: 'DEDICATED',
      referencePricing: { licence: 'regional licence, from PKR 10,000,000 / year' },
    },
  },
  {
    code: 'SCHEME_MULTI_MARKET',
    nameEn: 'Scheme Multi-Market Licence',
    nameAr: 'شبكة بطاقات - ترخيص متعدد الأسواق',
    entityType: 'SCHEME',
    contractKind: 'SCHEME_NETWORK_LICENCE',
    negotiated: true,
    sortOrder: 80,
    version: {
      defaultCadence: 'ANNUAL',
      prices: [],
      products: ['LIVE_DEAL', 'MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY', 'SPONSORED_CAMPAIGNS'],
      features: [...SCHEME_FEATURES, 'MULTI_MARKET'],
      limits: [],
      supportLevel: 'DEDICATED',
      referencePricing: { licence: 'custom' },
    },
  },
  {
    code: 'SCHEME_INTERNATIONAL',
    nameEn: 'Scheme International / Custom Licence',
    nameAr: 'شبكة بطاقات - ترخيص دولي مخصص',
    entityType: 'SCHEME',
    contractKind: 'SCHEME_NETWORK_LICENCE',
    negotiated: true,
    sortOrder: 90,
    version: {
      defaultCadence: 'MULTI_YEAR',
      prices: [],
      products: ['LIVE_DEAL', 'MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY', 'SPONSORED_CAMPAIGNS'],
      features: [...SCHEME_FEATURES, 'MULTI_MARKET', 'INTERNATIONAL_OFFERS'],
      limits: [],
      supportLevel: 'DEDICATED',
      referencePricing: { licence: 'custom' },
    },
  },
  {
    code: 'CORPORATE_PARTNER',
    nameEn: 'Corporate / Partner Enterprise',
    nameAr: 'شركة / شريك - اتفاقية المؤسسات',
    entityType: 'CORPORATE',
    contractKind: 'CORPORATE_PARTNER',
    sortOrder: 100,
    version: {
      defaultCadence: 'MONTHLY',
      prices: [
        { cadence: 'MONTHLY', amountMinor: 100_000 * PKR },
        { cadence: 'ANNUAL', amountMinor: 1_000_000 * PKR },
      ],
      fees: [
        { code: 'SETUP_FEE', amountMinor: 250_000 * PKR, indicative: true, note: 'initial setup, from' },
        { code: 'API_FEE', amountMinor: 250_000 * PKR, indicative: true, note: 'basic API, from' },
      ],
      addOnPrices: { PREMIUM_ANALYTICS: { amountMinor: 50_000 * PKR, cadence: 'MONTHLY', indicative: true } },
      products: ['LIVE_DEAL', 'MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY', 'SPONSORED_CAMPAIGNS'],
      features: ['EMPLOYEE_PROGRAMS', 'CUSTOMER_PROGRAMS', 'CORPORATE_FUNDED_CAMPAIGNS', 'REWARDS', 'ELIGIBILITY_API', 'BULK_ENROLLMENT', 'API_ACCESS', 'BULK_IMPORT', 'ADVANCED_REPORTING'],
      limits: [],
      addOnCodes: ['PREMIUM_ANALYTICS', 'API_CAPACITY'],
      supportLevel: 'DEDICATED',
      referencePricing: { complexIntegration: 'custom', premiumAnalytics: 'from PKR 50,000 / month' },
    },
  },
];

/** Price book (usage, placement and transaction items). All Pakistan values are reference ("from") figures or ranges. */
export const PAKISTAN_PRICE_ITEMS: Array<{
  code: string;
  nameEn: string;
  nameAr: string;
  category: string;
  unit: string;
  product: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  version: { model: string; amountMinor?: number; rateBps?: number; rangeMin?: number; rangeMax?: number; reference: string };
}> = [
  { code: 'FEATURED_LIVE_DEAL', nameEn: 'Featured Live Deal placement', nameAr: 'إبراز عرض مباشر', category: 'CAMPAIGN_ADVERTISING', unit: 'PER_CAMPAIGN', product: 'LIVE_DEAL', version: { model: 'FIXED', amountMinor: 5_000 * PKR, reference: 'from PKR 5,000' } },
  { code: 'EXCLUSIVE_SETUP', nameEn: 'Exclusive Deal setup', nameAr: 'إعداد عرض حصري', category: 'CAMPAIGN_ADVERTISING', unit: 'PER_CAMPAIGN', product: 'EXCLUSIVE', version: { model: 'FIXED', amountMinor: 5_000 * PKR, reference: 'from PKR 5,000' } },
  { code: 'VOUCHER_COMMISSION', nameEn: 'Voucher transaction commission', nameAr: 'عمولة معاملة القسيمة', category: 'TRANSACTION_COMMISSION', unit: 'PERCENT', product: 'VOUCHER', version: { model: 'PERCENT_BPS', rangeMin: 800, rangeMax: 1_200, reference: '8% to 12%' } },
  { code: 'WATCH_QUALIFIED_VIEW', nameEn: 'Watch & Earn qualified view', nameAr: 'مشاهدة مؤهلة في شاهد واربح', category: 'PRODUCT_USAGE', unit: 'PER_VIEW', product: 'WATCH', version: { model: 'PER_UNIT', rangeMin: 3 * PKR, rangeMax: 7 * PKR, reference: 'PKR 3 to 7 and above per qualified view' } },
  { code: 'PLAY_AND_WIN', nameEn: 'Play & Win campaign', nameAr: 'حملة العب واربح', category: 'CAMPAIGN_ADVERTISING', unit: 'PER_CAMPAIGN', product: null, status: 'INACTIVE', version: { model: 'FIXED', amountMinor: 50_000 * PKR, reference: 'from PKR 50,000 per campaign, when activated (Phase 2 product)' } },
  { code: 'PUSH_CAMPAIGN', nameEn: 'Push campaign', nameAr: 'حملة إشعارات', category: 'CAMPAIGN_ADVERTISING', unit: 'PER_CAMPAIGN', product: 'PUSH_CAMPAIGNS', version: { model: 'FIXED', amountMinor: 10_000 * PKR, reference: 'from PKR 10,000' } },
  { code: 'HOMEPAGE_PLACEMENT', nameEn: 'Homepage placement', nameAr: 'إبراز في الصفحة الرئيسية', category: 'CAMPAIGN_ADVERTISING', unit: 'PER_CAMPAIGN', product: 'HOMEPAGE_PLACEMENT', version: { model: 'FIXED', amountMinor: 25_000 * PKR, reference: 'from PKR 25,000' } },
];

const ADD_ONS: Array<{ code: string; nameEn: string; nameAr: string; effect: Array<{ kind: string; key: string; perUnit: number }>; eligiblePlanCodes: string[] }> = [
  { code: 'EXTRA_BRANCH', nameEn: 'Additional branch', nameAr: 'فرع إضافي', effect: [{ kind: 'LIMIT', key: 'branches.max', perUnit: 1 }], eligiblePlanCodes: ['STARTER', 'GROWTH', 'BUSINESS'] },
  { code: 'EXTRA_USER', nameEn: 'Additional user', nameAr: 'مستخدم إضافي', effect: [{ kind: 'LIMIT', key: 'users.max', perUnit: 1 }], eligiblePlanCodes: ['STARTER', 'GROWTH', 'BUSINESS'] },
  { code: 'PREMIUM_ANALYTICS', nameEn: 'Premium analytics', nameAr: 'تحليلات متقدمة', effect: [{ kind: 'FEATURE', key: 'PREMIUM_ANALYTICS', perUnit: 1 }], eligiblePlanCodes: ['GROWTH', 'BANK_ENTERPRISE', 'SCHEME_COUNTRY_NETWORK', 'SCHEME_REGIONAL', 'CORPORATE_PARTNER'] },
  { code: 'API_ACCESS', nameEn: 'API access', nameAr: 'الوصول عبر واجهة البرمجة', effect: [{ kind: 'FEATURE', key: 'API_ACCESS', perUnit: 1 }], eligiblePlanCodes: ['GROWTH'] },
  { code: 'API_CAPACITY', nameEn: 'Additional API capacity (10,000 requests)', nameAr: 'سعة إضافية لواجهة البرمجة (10,000 طلب)', effect: [{ kind: 'LIMIT', key: 'api.requests', perUnit: 10_000 }], eligiblePlanCodes: ['GROWTH', 'BUSINESS', 'BANK_ENTERPRISE', 'SCHEME_COUNTRY_NETWORK', 'SCHEME_REGIONAL', 'CORPORATE_PARTNER'] },
  { code: 'ADDITIONAL_MARKET', nameEn: 'Additional market', nameAr: 'سوق إضافي', effect: [{ kind: 'LIMIT', key: 'markets.max', perUnit: 1 }, { kind: 'FEATURE', key: 'MULTI_MARKET', perUnit: 1 }], eligiblePlanCodes: ['BUSINESS', 'SCHEME_COUNTRY_NETWORK', 'SCHEME_REGIONAL'] },
  { code: 'ADVANCED_REPORTING', nameEn: 'Advanced reporting', nameAr: 'تقارير متقدمة', effect: [{ kind: 'FEATURE', key: 'ADVANCED_REPORTING', perUnit: 1 }], eligiblePlanCodes: ['STARTER'] },
  { code: 'DEDICATED_SUPPORT', nameEn: 'Dedicated support', nameAr: 'دعم مخصص', effect: [{ kind: 'FEATURE', key: 'DEDICATED_SUPPORT', perUnit: 1 }], eligiblePlanCodes: ['BUSINESS'] },
  { code: 'CAMPAIGN_PACKAGE', nameEn: 'Campaign package (10 campaigns per period)', nameAr: 'حزمة حملات (10 حملات لكل فترة)', effect: [{ kind: 'LIMIT', key: 'campaigns.per_period', perUnit: 10 }], eligiblePlanCodes: ['GROWTH', 'BUSINESS'] },
];

/**
 * The plan catalog, price book and add-on catalog for the configured markets. Idempotent. Existing rows are never edited: a market that
 * already has a version of a plan keeps it (a change is a NEW published version made by DealDash Admin).
 */
export async function seedSubscriptionCatalog(db: Db) {
  await db.countryConfiguration.upsert({
    where: { code: MARKET },
    update: {},
    create: {
      code: MARKET,
      nameEn: 'Pakistan',
      nameAr: 'باكستان',
      currency: CURRENCY,
      enabled: false,
      languages: ['en', 'ar'],
      taxProfile: { status: 'NOT_CONFIGURED_VALIDATE', note: 'Pakistan sales tax treatment is market configuration (VALIDATE)' },
      paymentProvider: null,
      settlement: { status: 'NOT_CONFIGURED_VALIDATE' },
      residency: { status: 'NOT_CONFIGURED_VALIDATE' },
    },
  });
  for (const a of ADD_ONS)
    await db.addOnDefinition.upsert({ where: { code: a.code }, update: {}, create: { code: a.code, nameEn: a.nameEn, nameAr: a.nameAr, effect: a.effect as Prisma.InputJsonValue, eligiblePlanCodes: a.eligiblePlanCodes } });
  for (const p of PAKISTAN_PLANS) {
    const plan = await db.commercialPlan.upsert({
      where: { code: p.code },
      update: {},
      create: { code: p.code, nameEn: p.nameEn, nameAr: p.nameAr, entityType: p.entityType, contractKind: p.contractKind, isFree: !!p.isFree, negotiated: !!p.negotiated, sortOrder: p.sortOrder },
    });
    if (await db.commercialPlanVersion.findFirst({ where: { planId: plan.id, market: MARKET } })) continue;
    const v = p.version;
    await db.commercialPlanVersion.create({
      data: {
        planId: plan.id,
        market: MARKET,
        currency: CURRENCY,
        version: 1,
        status: 'PUBLISHED',
        defaultCadence: v.defaultCadence,
        prices: v.prices as Prisma.InputJsonValue,
        fees: (v.fees ?? []) as Prisma.InputJsonValue,
        addOnPrices: (v.addOnPrices ?? {}) as Prisma.InputJsonValue,
        entitlements: { products: v.products, features: v.features, limits: v.limits.map((l) => ({ overageRateMinor: null, ...l })) } as unknown as Prisma.InputJsonValue,
        addOnCodes: v.addOnCodes ?? [],
        supportLevel: v.supportLevel,
        trialDays: v.trialDays ?? null,
        referencePricing: (v.referencePricing ?? {}) as Prisma.InputJsonValue,
        publishedAt: new Date(),
      },
    });
  }
  for (const i of PAKISTAN_PRICE_ITEMS) {
    const item = await db.priceItem.upsert({ where: { code: i.code }, update: {}, create: { code: i.code, nameEn: i.nameEn, nameAr: i.nameAr, category: i.category, unit: i.unit, product: i.product, status: i.status ?? 'ACTIVE' } });
    if (await db.priceItemVersion.findFirst({ where: { itemId: item.id, market: MARKET } })) continue;
    await db.priceItemVersion.create({
      data: {
        itemId: item.id,
        market: MARKET,
        currency: CURRENCY,
        version: 1,
        model: i.version.model,
        amountMinor: i.version.amountMinor ?? null,
        rateBps: i.version.rateBps ?? null,
        rangeMin: i.version.rangeMin ?? null,
        rangeMax: i.version.rangeMax ?? null,
        // every figure the founder gave is a reference ("from") or a range: never charged as a list price
        indicative: true,
        reference: i.version.reference,
        status: 'PUBLISHED',
      },
    });
  }
}

/**
 * DEVELOPMENT fixtures only: a zero-price plan version for the development market (SAR) and an agreement for the seeded merchants, so
 * the whole product can be exercised under a plan. Flagged developmentFixture; never a commercial price. Real pilot merchants must
 * receive an explicit plan / contract assignment from DealDash Admin before commercial launch (see the launch-readiness list).
 */
export async function seedSubscriptionFixtures(db: PrismaClient, opts: { skipOrganizations?: string[] } = {}) {
  const dev = PAKISTAN_PLANS.filter((p) => ['STARTER', 'GROWTH', 'BUSINESS'].includes(p.code));
  for (const p of dev) {
    const plan = await db.commercialPlan.findUniqueOrThrow({ where: { code: p.code } });
    if (await db.commercialPlanVersion.findFirst({ where: { planId: plan.id, market: 'SA' } })) continue;
    await db.commercialPlanVersion.create({
      data: {
        planId: plan.id,
        market: 'SA',
        currency: 'SAR',
        version: 1,
        status: 'PUBLISHED',
        defaultCadence: 'NONE',
        prices: [],
        entitlements: { products: p.version.products, features: p.version.features, limits: p.version.limits } as unknown as Prisma.InputJsonValue,
        addOnCodes: p.version.addOnCodes ?? [],
        supportLevel: p.version.supportLevel,
        developmentFixture: true,
        publishedAt: new Date(),
      },
    });
  }
  const orgs = await db.organization.findMany({ where: { type: 'MERCHANT', status: 'ACTIVE' }, select: { id: true, nameEn: true } });
  const business = await db.commercialPlanVersion.findFirstOrThrow({ where: { plan: { code: 'BUSINESS' }, market: 'SA' }, include: { plan: true } });
  const author = (await db.user.findFirst({ where: { userType: 'ADMIN_USER' }, select: { id: true } }))?.id;
  if (!author) return;
  for (const o of orgs) {
    if (opts.skipOrganizations?.includes(o.nameEn)) continue;
    if (await db.contract.findFirst({ where: { organizationId: o.id, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'PENDING_ACTIVATION'] } } })) continue;
    const from = new Date();
    const c = await db.contract.create({
      data: {
        organizationId: o.id,
        name: 'Merchant Business (development fixture)',
        planCode: 'BUSINESS',
        planVersionId: business.id,
        kind: 'MERCHANT_SUBSCRIPTION',
        market: 'SA',
        currency: 'SAR',
        billingCadence: 'NONE',
        renewalState: 'AUTO_RENEW',
        status: 'ACTIVE',
        effectiveFrom: from,
        activatedAt: from,
        createdByUserId: author,
        pricingVersionKey: `PLV:${business.id}`,
        developmentFixture: true,
      },
    });
    const e = business.entitlements as { products: string[]; features: string[]; limits: Limit[] };
    await db.contractEntitlement.createMany({
      data: [
        ...e.products.map((key) => ({ contractId: c.id, kind: 'PRODUCT', key, effectiveFrom: from, source: 'PLAN' })),
        ...e.features.map((key) => ({ contractId: c.id, kind: 'FEATURE', key, effectiveFrom: from, source: 'PLAN' })),
        ...e.limits.map((l) => ({ contractId: c.id, kind: 'LIMIT', key: l.key, limitValue: l.value, effectiveFrom: from, source: 'PLAN' })),
      ],
    });
  }
}

/**
 * DEVELOPMENT fixture only: the business AI assistants need the AI_COPILOT feature. No plan includes it (how AI is sold is a later
 * commercial decision), so the development-fixture agreements get it as an OVERRIDE entitlement. Idempotent; never touches a real
 * (non-fixture) agreement.
 */
export async function seedAiFixtures(db: PrismaClient) {
  const contracts = await db.contract.findMany({ where: { developmentFixture: true, status: { in: ['TRIAL', 'ACTIVE'] } }, select: { id: true, effectiveFrom: true } });
  for (const c of contracts) {
    if (await db.contractEntitlement.count({ where: { contractId: c.id, kind: 'FEATURE', key: 'AI_COPILOT' } })) continue;
    await db.contractEntitlement.create({ data: { contractId: c.id, kind: 'FEATURE', key: 'AI_COPILOT', effectiveFrom: c.effectiveFrom, source: 'OVERRIDE' } });
  }
  return contracts.length;
}
