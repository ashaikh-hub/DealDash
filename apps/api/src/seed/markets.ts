import { MARKET_PRODUCTS } from '@dealdash/types';
import type { PrismaClient } from '../generated/prisma/client';

type Db = Pick<
  PrismaClient,
  'countryConfiguration' | 'marketRegion' | 'marketProduct' | 'marketValidationItem'
>;

/**
 * The existing VALIDATE-KSA items (docs/DEALDASH_BUSINESS_RULES.md §25, VK-01..VK-25) and the founder's launch-readiness items, mapped
 * into the one market validation register without losing their source. Topics are questions to confirm, never conclusions.
 */
const KSA_ITEMS: Array<[string, string, string]> = [
  [
    'VK-01',
    'Advertising and savings claims',
    'Price / savings claim and advertising truthfulness rules (LD-18)',
  ],
  [
    'VK-02',
    'Reservation deposits',
    'Legal nature of deposits / tokens on reservations if enabled (HD-21)',
  ],
  [
    'VK-03',
    'VAT and tax invoices',
    'VAT treatment, tax invoice / e-invoicing format, tax on fees, vouchers and campaign spend, receipts (VC-02, VC-16, PY-17, ST-08, ST-14)',
  ],
  [
    'VK-04',
    'Voucher consumer protection',
    'Voucher validity minimums, expiry, refund and consumer protection rights (VC-04, VC-33, VC-36)',
  ],
  [
    'VK-05',
    'Voucher funds',
    'Treatment and holding of voucher funds (escrow / segregation), payment-licensing implications (VC-42, ST-13)',
  ],
  [
    'VK-06',
    'Targeting attributes',
    'Use of age / gender and other personal attributes for targeting; minors (WE-04, WE-63, EL-06)',
  ],
  [
    'VK-07',
    'Video advertising content',
    'Advertising / content rules for video, restricted categories, sponsored labelling (WE-12, WE-64)',
  ],
  ['VK-08', 'Unused prepaid budget', 'Treatment of unused prepaid advertising budget (WE-54)'],
  [
    'VK-09',
    'Sharing with partners',
    'Legal basis for customer-level sharing with partners / employers (EL-07, EM-21, PR-09)',
  ],
  ['VK-10', 'Sponsored ranking disclosure', 'Rules on sponsored / paid ranking disclosure (EL-22)'],
  [
    'VK-11',
    'Personal data protection',
    'Minimisation, work-email handling, deletion vs financial record retention, data subject rights (EM-05, AU-25, RW-14)',
  ],
  [
    'VK-12',
    'Aggregation thresholds',
    'Aggregation / anonymisation standards and cohort thresholds for partner reports (PR-08, PR-22, PR-31)',
  ],
  [
    'VK-13',
    'Card data handling',
    'First-6 / last-4 storage, PCI scope, central bank and PSP requirements, saved cards (BC-02, PY-15)',
  ],
  ['VK-14', 'Scheme marks', 'Use of mada / Visa / Mastercard marks and scheme rules (BC-08)'],
  [
    'VK-15',
    'Retention periods',
    'Retention for audit, financial, KYC, communications, device and redemption data (AU-24, RD-52, MR-51)',
  ],
  [
    'VK-16',
    'Merchant of record',
    'Merchant-of-record model, PSP licensing, chargeback responsibility (PY, PY-13)',
  ],
  [
    'VK-17',
    'Loyalty points',
    'Legal classification of reward points / loyalty and expiry rules (RW-01, RW-08)',
  ],
  [
    'VK-18',
    'Merchant KYB',
    'Merchant onboarding documents, commercial registration, tax IDs, KYB / sanctions obligations (MR-02, MR-03)',
  ],
  [
    'VK-19',
    'Contracts and e-signature',
    'Contract / e-signature validity, offboarding notice and termination (MR-06, MR-50, PR-11)',
  ],
  [
    'VK-20',
    'Reviews and ratings',
    'Review / rating legal requirements, defamation, moderation (MR-52)',
  ],
  [
    'VK-21',
    'Brand usage',
    'Brand / logo usage permissions for banks, schemes and merchants (PR-13)',
  ],
  [
    'VK-22',
    'Device fingerprinting',
    'Consent and legal basis for device fingerprinting and fraud profiling (FR-33)',
  ],
  [
    'VK-23',
    'Marketing consent',
    'Marketing communications consent, SMS / push rules, quiet hours (NT, NT-41)',
  ],
  [
    'VK-24',
    'Complaint handling',
    'Consumer complaint-handling timelines and regulator escalation (SP-17)',
  ],
  ['VK-25', 'Data residency', 'Data residency, hosting location, cross-border transfers (AU-26)'],
  [
    'TAX-INVOICE',
    'Tax invoice format and numbering',
    'Saudi tax invoice format, numbering and QR / e-invoicing requirements (founder launch-readiness item; see VK-03)',
  ],
  [
    'WRITE-OFF',
    'Write-off treatment',
    'Treatment of written-off receivables and bad debt (founder launch-readiness item)',
  ],
  [
    'FX-SOURCE',
    'FX-rate source',
    'Source of record for exchange rates used on documents (founder launch-readiness item)',
  ],
  [
    'AI-RESIDENCY',
    'AI data residency',
    'Where AI processing and AI audit data may be hosted (founder launch-readiness item)',
  ],
  [
    'AI-CONSENT',
    'AI consent wording',
    'Customer and business consent wording for AI assistance (founder launch-readiness item)',
  ],
  [
    'ARABIC-REVIEW',
    'Native Arabic review',
    'Native Arabic review of all customer, business and legal copy (founder launch-readiness item)',
  ],
];
/** Markets planned next: open questions only (to be confirmed locally before launch). */
const NEXT_MARKET_ITEMS: Array<[string, string, string]> = [
  [
    'TAX',
    'Tax treatment',
    'Tax treatment of subscriptions, fees, commissions and campaign charges, and registration requirements',
  ],
  [
    'TAX-INVOICE',
    'Invoice / e-invoicing format',
    'Invoice and e-invoicing requirements (format, numbering, language, QR, provider)',
  ],
  [
    'CONSUMER-PROTECTION',
    'Consumer protection',
    'Voucher validity, refunds, cancellations and complaint handling',
  ],
  [
    'DATA-PROTECTION',
    'Data protection and residency',
    'Personal data protection, consent, retention and data residency',
  ],
  [
    'PAYMENTS',
    'Payments and settlement',
    'Payment licensing, merchant of record, settlement and holding of funds',
  ],
  [
    'KYB',
    'Business onboarding',
    'KYB / KYC documents, signatories, beneficial ownership and sanctions checks',
  ],
  [
    'ARABIC-REVIEW',
    'Language review',
    'Native review of customer, business and legal copy in the market languages',
  ],
];
const PREFIX: Record<string, string> = {
  SA: 'VALIDATE-KSA',
  AE: 'VALIDATE-UAE',
  QA: 'VALIDATE-QATAR',
  PK: 'VALIDATE-PAKISTAN',
};

/** Non-statutory market facts (ISO, calling code, time zone, region grouping). Tax, legal and regulatory content is never seeded. */
const FACTS: Record<string, { region: string; iso3: string; calling: string; tz: string }> = {
  SA: { region: 'GCC', iso3: 'SAU', calling: '+966', tz: 'Asia/Riyadh' },
  AE: { region: 'GCC', iso3: 'ARE', calling: '+971', tz: 'Asia/Dubai' },
  QA: { region: 'GCC', iso3: 'QAT', calling: '+974', tz: 'Asia/Qatar' },
  PK: { region: 'SOUTH_ASIA', iso3: 'PAK', calling: '+92', tz: 'Asia/Karachi' },
};

/**
 * Market master defaults for markets created by seeds (the migration back-fills existing databases the same way). Idempotent: it only
 * fills what is empty and never changes a market an administrator already moved through its lifecycle. The enabled pilot market becomes
 * PILOT with its products in PILOT; other markets stay PLANNED with every product DISABLED.
 */
export async function ensureMarketDefaults(db: Db) {
  await db.marketRegion.upsert({
    where: { code: 'GCC' },
    update: {},
    create: {
      code: 'GCC',
      nameEn: 'Gulf Cooperation Council',
      nameAr: 'دول مجلس التعاون الخليجي',
      sortOrder: 10,
    },
  });
  await db.marketRegion.upsert({
    where: { code: 'SOUTH_ASIA' },
    update: {},
    create: { code: 'SOUTH_ASIA', nameEn: 'South Asia', nameAr: 'جنوب آسيا', sortOrder: 20 },
  });
  const markets = await db.countryConfiguration.findMany();
  for (const m of markets) {
    const f = FACTS[m.code];
    await db.countryConfiguration.update({
      where: { code: m.code },
      data: {
        ...(m.regionCode ? {} : { regionCode: f?.region ?? null }),
        ...(m.isoAlpha3 ? {} : { isoAlpha3: f?.iso3 ?? null }),
        ...(m.callingCode ? {} : { callingCode: f?.calling ?? null }),
        ...(m.timezone !== 'UTC' || !f ? {} : { timezone: f.tz }),
        ...(m.supportedCurrencies.length ? {} : { supportedCurrencies: [m.currency] }),
        ...(m.defaultLanguage !== 'en' || !m.languages[0]
          ? {}
          : { defaultLanguage: m.languages[0] }),
        ...(Object.keys((m.formatting as object) ?? {}).length
          ? {}
          : {
              formatting: { numerals: 'WESTERN', dateFormat: 'dd MMM yyyy', timeFormat: 'HH:mm' },
            }),
        ...(m.status === 'PLANNED' && m.enabled
          ? { status: 'PILOT', launchDate: m.launchDate ?? new Date() }
          : {}),
      },
    });
    const existing = new Set(
      (
        await db.marketProduct.findMany({ where: { market: m.code }, select: { product: true } })
      ).map((r) => r.product),
    );
    const missing = MARKET_PRODUCTS.filter((p) => !existing.has(p));
    if (missing.length)
      await db.marketProduct.createMany({
        data: missing.map((product) => ({
          market: m.code,
          product,
          status: m.enabled ? 'PILOT' : 'DISABLED',
        })),
        skipDuplicates: true,
      });
    const prefix = PREFIX[m.code];
    if (prefix) {
      const items = m.code === 'SA' ? KSA_ITEMS : NEXT_MARKET_ITEMS;
      await db.marketValidationItem.createMany({
        data: items.map(([code, topic, description]) => ({
          market: m.code,
          code: `${prefix}-${code}`,
          topic,
          description,
          blocksActivation: true,
          sourceRef:
            m.code === 'SA' && code.startsWith('VK-')
              ? `docs/DEALDASH_BUSINESS_RULES.md §25 ${code}`
              : m.code === 'SA'
                ? 'Founder approval 2026-10-09 (launch-readiness)'
                : 'Market configuration hardening (pre-Stage 7)',
        })),
        skipDuplicates: true,
      });
    }
  }
}
