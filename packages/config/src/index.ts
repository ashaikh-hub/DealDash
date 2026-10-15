import { z } from 'zod';
import { DEFAULT_LAUNCH_CONTROLS } from './launch';
import { DEFAULT_OPERATIONS_CONFIG } from './operations';

export * from './launch';
export * from './operations';

const providerSchema = z.enum(['mock']).default('mock'); // real vendors are added when selected
const csv = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** API environment. Business parameters are NOT here: they live in SystemConfiguration (database). */
export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  /** Used to build links in invitation e-mails. */
  MERCHANT_APP_URL: z.string().url().default('http://localhost:3002'),
  /** Used to build links in partner invitation e-mails. */
  PARTNER_APP_URL: z.string().url().default('http://localhost:3004'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TEST_DATABASE_URL: z.string().optional(),
  CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:3004,http://localhost:3005',
    )
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  FIELD_ENCRYPTION_KEY: z.string().min(32, 'FIELD_ENCRYPTION_KEY must be at least 32 characters'),
  SMS_PROVIDER: providerSchema,
  EMAIL_PROVIDER: providerSchema,
  PUSH_PROVIDER: providerSchema,
  PAYMENT_PROVIDER: providerSchema,
  // `local` is the development storage adapter (files on local disk behind signed, expiring URLs).
  // `s3` = provider-neutral S3-compatible object storage (Google Cloud Storage via HMAC keys, Amazon S3, R2, MinIO, onshore stores).
  STORAGE_PROVIDER: z.enum(['mock', 'local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('.storage'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().min(3).optional(),
  /** Bucket region for signing; Google Cloud Storage accepts `auto`. */
  S3_REGION: z.string().default('auto'),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  VIDEO_PROVIDER: providerSchema,
  MAPS_PROVIDER: providerSchema,
  // ---- Stage 9: production readiness
  /** Deployment tier. Production never shares a database, secret, provider key, test user or test money with any other tier. */
  APP_ENV: z.enum(['local', 'development', 'test', 'staging', 'production']).optional(),
  /** Staging only: development adapters may stand in for providers not yet contracted (UAT). Refused in production. */
  ALLOW_MOCK_PROVIDERS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Staging test inbox (launch readiness G-1): messages that the development SMS / e-mail adapters "send" to these synthetic
   * recipients are kept (encrypted, 24 hours) so administrators can read sign-in codes and invitation links in the admin portal.
   * Comma-separated: mobile-number prefixes (at least 9 characters, e.g. +92000000) and e-mail domains on a reserved test TLD
   * (.test / .invalid / .example / .localhost; `test` = every *.test address). Staging only: refused in production.
   */
  STAGING_TEST_PHONE_PREFIXES: z.string().default('').transform(csv),
  STAGING_TEST_EMAIL_DOMAINS: z
    .string()
    .default('')
    .transform((v) => csv(v).map((d) => d.toLowerCase().replace(/^@|^\./, ''))),
  /** Settlement payouts (B2): `manual` = bank references recorded by finance; `mock` = development payout adapter. */
  PAYOUT_PROVIDER: z.enum(['manual', 'mock']).default('manual'),
  /** Shared secrets that sign provider callbacks (payout status, notification delivery status). Absent = callbacks refused. */
  PAYOUT_WEBHOOK_SECRET: z.string().min(32).optional(),
  NOTIFY_WEBHOOK_SECRET: z.string().min(32).optional(),
  /** Requests per minute per client IP for the whole API, and for sign-in / OTP routes. 0 = off. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(0),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(0),
  /** Number of reverse-proxy hops in front of the API (so client IPs are real). 0 when the API is reached directly. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** json = one structured line per event (production); pretty = human-readable (local). */
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty'),
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** The effective deployment tier (APP_ENV, else derived from NODE_ENV). */
export function appEnvOf(
  env: Pick<ApiEnv, 'APP_ENV' | 'NODE_ENV'>,
): NonNullable<ApiEnv['APP_ENV']> {
  return (
    env.APP_ENV ??
    (env.NODE_ENV === 'production' ? 'production' : env.NODE_ENV === 'test' ? 'test' : 'local')
  );
}

/**
 * Stage 9: a production process refuses to start with an unsafe configuration. Returns the problems (empty = safe). Messages name the
 * setting, never its value. Staging (NODE_ENV=production, APP_ENV=staging) may use development adapters only with ALLOW_MOCK_PROVIDERS.
 */
export function productionSafetyProblems(env: ApiEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const tier = appEnvOf(env);
  const problems: string[] = [];
  const mocksAllowed = tier === 'staging' && env.ALLOW_MOCK_PROVIDERS;
  if (tier === 'production' && env.ALLOW_MOCK_PROVIDERS)
    problems.push('ALLOW_MOCK_PROVIDERS must not be set in production');
  if (tier !== 'production' && tier !== 'staging')
    problems.push('APP_ENV must be staging or production when NODE_ENV=production');
  if (!mocksAllowed) {
    for (const k of [
      'SMS_PROVIDER',
      'EMAIL_PROVIDER',
      'PUSH_PROVIDER',
      'PAYMENT_PROVIDER',
      'VIDEO_PROVIDER',
      'MAPS_PROVIDER',
    ] as const)
      if (env[k] === 'mock')
        problems.push(
          `${k} is a development adapter (select and configure the contracted provider)`,
        );
    if (env.STORAGE_PROVIDER === 'mock') problems.push('STORAGE_PROVIDER is a development adapter');
    if (env.STORAGE_PROVIDER === 'local')
      problems.push('STORAGE_PROVIDER=local keeps files on one server disk (use object storage)');
    if (env.PAYOUT_PROVIDER === 'mock')
      problems.push('PAYOUT_PROVIDER=mock is a development adapter');
  }
  if (
    env.STORAGE_PROVIDER === 's3' &&
    !(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)
  )
    problems.push(
      'STORAGE_PROVIDER=s3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
    );
  if (env.S3_ENDPOINT && !env.S3_ENDPOINT.startsWith('https://'))
    problems.push('S3_ENDPOINT must be https');
  let db: URL | null = null;
  try {
    db = new URL(env.DATABASE_URL);
  } catch {
    problems.push('DATABASE_URL is not a valid URL');
  }
  if (db) {
    const name = db.pathname.replace(/^\//, '');
    if (/_(dev|test)$/.test(name))
      problems.push('DATABASE_URL points at a development / test database');
    // TLS on the wire, or the managed Cloud SQL connector's local socket (`host=/cloudsql/<instance>`): the connector carries the
    // connection to the instance over mutually-authenticated TLS, and the socket itself never leaves the container.
    const viaCloudSqlConnector = /(^|&)host=%2Fcloudsql%2F|(^|&)host=\/cloudsql\//.test(
      db.search.slice(1),
    );
    if (!viaCloudSqlConnector && !/sslmode=(require|verify-ca|verify-full)/.test(db.search))
      problems.push(
        'DATABASE_URL must require TLS (sslmode=require or verify-full) or use the Cloud SQL connector socket',
      );
    if (db.username === 'postgres')
      problems.push(
        'DATABASE_URL must use the least-privilege application role, not the administrative account',
      );
  }
  if (env.TEST_DATABASE_URL)
    problems.push('TEST_DATABASE_URL must not be configured in production / staging');
  if (env.SESSION_SECRET.length < 32)
    problems.push('SESSION_SECRET must be at least 32 characters');
  if (
    /^(ci-|dev|test|change_me)/i.test(env.SESSION_SECRET) ||
    /^(ci-|dev|test|change_me)/i.test(env.FIELD_ENCRYPTION_KEY)
  )
    problems.push('SESSION_SECRET / FIELD_ENCRYPTION_KEY look like development values');
  if (!env.API_PUBLIC_URL.startsWith('https://')) problems.push('API_PUBLIC_URL must be https');
  // launch readiness G-3: invitation links must open this environment's portals, never a developer's machine
  for (const k of ['MERCHANT_APP_URL', 'PARTNER_APP_URL'] as const)
    if (!env[k].startsWith('https://') || /localhost|127\.0\.0\.1/.test(env[k]))
      problems.push(`${k} must be the environment's https portal address (invitation links)`);
  for (const o of env.CORS_ORIGINS)
    if (!o.startsWith('https://') || /localhost|127\.0\.0\.1/.test(o))
      problems.push('CORS_ORIGINS must list only https production origins');
  if (env.RATE_LIMIT_PER_MINUTE === 0 || env.AUTH_RATE_LIMIT_PER_MINUTE === 0)
    problems.push('RATE_LIMIT_PER_MINUTE and AUTH_RATE_LIMIT_PER_MINUTE must be set');
  if (env.LOG_FORMAT !== 'json') problems.push('LOG_FORMAT must be json');
  if (tier === 'production' && hasStagingTestRecipients(env))
    problems.push(
      'STAGING_TEST_PHONE_PREFIXES / STAGING_TEST_EMAIL_DOMAINS must not be set in production',
    );
  problems.push(...stagingTestRecipientProblems(env));
  return problems;
}

// ---------------------------------------------------------------- staging test inbox (G-1)
const RESERVED_TEST_TLDS = ['test', 'invalid', 'example', 'localhost'];
type TestInboxEnv = Pick<
  ApiEnv,
  | 'APP_ENV'
  | 'NODE_ENV'
  | 'ALLOW_MOCK_PROVIDERS'
  | 'STAGING_TEST_PHONE_PREFIXES'
  | 'STAGING_TEST_EMAIL_DOMAINS'
>;

function hasStagingTestRecipients(env: TestInboxEnv) {
  return env.STAGING_TEST_PHONE_PREFIXES.length > 0 || env.STAGING_TEST_EMAIL_DOMAINS.length > 0;
}

/** Shape rules for the test-recipient lists (any tier): a prefix never covers a whole country, a domain is never a real one. */
export function stagingTestRecipientProblems(env: TestInboxEnv): string[] {
  const problems: string[] = [];
  for (const p of env.STAGING_TEST_PHONE_PREFIXES)
    if (!/^\+[1-9]\d{7,}$/.test(p))
      problems.push(
        'STAGING_TEST_PHONE_PREFIXES entries must be + and at least 8 digits (one narrow synthetic range)',
      );
  for (const d of env.STAGING_TEST_EMAIL_DOMAINS)
    if (!RESERVED_TEST_TLDS.includes(d.split('.').pop() ?? ''))
      problems.push(
        'STAGING_TEST_EMAIL_DOMAINS entries must be on a reserved test TLD (.test, .invalid, .example, .localhost)',
      );
  return [...new Set(problems)];
}

/** The staging test inbox exists only in staging, only with development adapters, only for configured synthetic recipients. */
export function stagingTestInboxEnabled(env: TestInboxEnv): boolean {
  return (
    appEnvOf(env) === 'staging' &&
    env.ALLOW_MOCK_PROVIDERS &&
    hasStagingTestRecipients(env) &&
    stagingTestRecipientProblems(env).length === 0
  );
}

/** Whether a message to `to` (E.164 mobile or e-mail address) is kept in the staging test inbox. */
export function isStagingTestRecipient(env: TestInboxEnv, to: string): boolean {
  if (!stagingTestInboxEnabled(env)) return false;
  const value = to.trim().toLowerCase();
  if (value.includes('@')) {
    const domain = value.slice(value.lastIndexOf('@') + 1);
    return env.STAGING_TEST_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
  }
  return env.STAGING_TEST_PHONE_PREFIXES.some((p) => value.startsWith(p));
}

const PRIVATE_IPV4 = /^(10\.\d+|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+$/;

/**
 * Browser origins the API accepts: CORS_ORIGINS, plus — on a local development machine only (NODE_ENV=development, tier
 * local/development) — the same app ports opened from a private-network address, so a phone on the same Wi-Fi can test the
 * apps without anyone's IP being configured. Staging and production (NODE_ENV=production) accept CORS_ORIGINS only.
 */
export function isAllowedBrowserOrigin(
  env: Pick<ApiEnv, 'CORS_ORIGINS' | 'NODE_ENV' | 'APP_ENV'>,
  origin: string,
): boolean {
  if (env.CORS_ORIGINS.includes(origin)) return true;
  const tier = appEnvOf(env);
  if (env.NODE_ENV !== 'development' || (tier !== 'local' && tier !== 'development')) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' || !PRIVATE_IPV4.test(url.hostname)) return false;
  // only the ports of locally configured app origins (http://localhost:3001 -> 3001)
  return env.CORS_ORIGINS.some((o) => {
    try {
      const c = new URL(o);
      return (c.hostname === 'localhost' || c.hostname === '127.0.0.1') && c.port === url.port;
    } catch {
      return false;
    }
  });
}

export function parseApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const parsed = apiEnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return parsed.data;
}

export const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
});
export type WebEnv = z.infer<typeof webEnvSchema>;

/** Keys of platform parameters stored in SystemConfiguration (values are configuration, never hard-coded). */
export const CONFIG_KEYS = {
  OTP_TTL_SECONDS: 'auth.otp.ttl_seconds',
  OTP_MAX_ATTEMPTS: 'auth.otp.max_attempts',
  OTP_RESEND_COOLDOWN_SECONDS: 'auth.otp.resend_cooldown_seconds',
  OTP_MAX_REQUESTS_PER_HOUR: 'auth.otp.max_requests_per_hour',
  PASSWORD_MAX_FAILED_ATTEMPTS: 'auth.password.max_failed_attempts',
  PASSWORD_LOCK_MINUTES: 'auth.password.lock_minutes',
  SESSION_IDLE_MINUTES: 'auth.session.idle_minutes',
  SESSION_ABSOLUTE_HOURS: 'auth.session.absolute_hours',
  ADMIN_MFA_REQUIRED: 'auth.admin.mfa_required',
  COHORT_THRESHOLD: 'reporting.cohort_threshold',
  RESERVATION_HOLD_MINUTES: 'reservation.hold_minutes',
  ENABLED_CITIES: 'discovery.enabled_cities',
  DISCOVERY_CITY_CENTERS: 'discovery.city_centers',
  FILE_MAX_BYTES: 'files.max_bytes',
  FILE_ALLOWED_MIME: 'files.allowed_mime',
  MERCHANT_DOCUMENT_REQUIREMENTS: 'merchant.document_requirements',
  MERCHANT_CATEGORIES: 'merchant.categories',
  MERCHANT_RISK_CRITERIA: 'merchant.risk_criteria',
  MERCHANT_REAPPLY_AFTER_REJECTION: 'merchant.reapply_after_rejection',
  MERCHANT_INVITE_TTL_HOURS: 'merchant.invite_ttl_hours',
  // Stage 3: Live Deals and discovery
  LIVE_DEAL_MATERIAL_FIELDS: 'live_deals.material_fields',
  LIVE_DEAL_AUTO_PUBLISH: 'live_deals.auto_publish',
  LIVE_DEAL_GUARDRAILS: 'live_deals.guardrails',
  LIVE_DEAL_CONTROLLED_ENABLED: 'live_deals.controlled_enabled',
  DEAL_IMAGE_MAX_BYTES: 'deals.image_max_bytes',
  DEAL_IMAGE_ALLOWED_MIME: 'deals.image_allowed_mime',
  DEAL_IMAGE_MIN_WIDTH: 'deals.image_min_width',
  DEAL_IMAGE_MIN_HEIGHT: 'deals.image_min_height',
  IMPRESSION_WINDOW_MINUTES: 'analytics.impression_window_minutes',
  // Stage 4: Exclusive Deals, reservations, redemption
  HOT_DEAL_LIMITS: 'hot_deals.limits',
  HOT_DEAL_GUARDRAILS: 'hot_deals.guardrails',
  HOT_DEAL_AUTO_PUBLISH: 'hot_deals.auto_publish',
  RESERVATION_HOLD_LIMITS: 'reservation.hold_limits',
  RESERVATION_MAX_ACTIVE: 'reservation.max_active',
  RESERVATION_EXPIRING_NOTICE_MINUTES: 'reservation.expiring_notice_minutes',
  RESERVATION_NOSHOW: 'reservation.noshow',
  REDEMPTION_RECHECK_ELIGIBILITY: 'redemption.recheck_eligibility',
  REDEMPTION_MANUAL_PER_MINUTE: 'redemption.manual_attempts_per_minute',
  REDEMPTION_REVERSAL_WINDOW_HOURS: 'redemption.reversal_window_hours',
  STAFF_HISTORY_DAYS: 'staff.history_days',
  // Stage 5: Vouchers, payments, refunds, ledger (all MOCK defaults; legal/commercial values are VALIDATE-KSA)
  VOUCHER_LIMITS: 'vouchers.limits',
  VOUCHER_GUARDRAILS: 'vouchers.guardrails',
  VOUCHER_AUTO_PUBLISH: 'vouchers.auto_publish',
  VOUCHER_CHECKOUT_HOLD_MINUTES: 'vouchers.checkout_hold_minutes',
  VOUCHER_PAYMENT_RETRY_LIMIT: 'vouchers.payment_retry_limit',
  VOUCHER_REFUND_POLICY: 'vouchers.refund_policy',
  VOUCHER_EXPIRY_REMINDER_DAYS: 'vouchers.expiry_reminder_days',
  VOUCHER_FEE_RULE: 'vouchers.fee_rule',
  VOUCHER_PAYABLE_ACCRUAL_POINT: 'vouchers.payable_accrual_point',
  VOUCHER_EXPIRED_VALUE_POLICY: 'vouchers.expired_value_policy',
  PAYMENT_WEBHOOK_TOLERANCE_SECONDS: 'payments.webhook_tolerance_seconds',
  // Stage 6: Watch & Earn and Rewards (every value is a MOCK default; none is a final commercial or legal decision)
  WATCH_LIMITS: 'watch.limits',
  WATCH_RATE_CARD: 'watch.rate_card',
  WATCH_REWARD_RULE: 'watch.reward_rule',
  WATCH_QUALIFYING_POLICY: 'watch.qualifying_policy',
  WATCH_FREQUENCY: 'watch.frequency',
  WATCH_GUARDRAILS: 'watch.guardrails',
  WATCH_AUTO_PUBLISH: 'watch.auto_publish',
  WATCH_FRAUD: 'watch.fraud',
  WATCH_UNUSED_BUDGET_TREATMENT: 'watch.unused_budget_treatment',
  REWARDS_RULES: 'rewards.rules',
  // Commercial governance and finance (all MOCK defaults; the real values come from agreements and DealDash Admin)
  COMMERCIAL_DEFAULT_PRICING: 'commercial.default_pricing',
  COMMERCIAL_REQUIREMENTS: 'commercial.requirements',
  // Shared platform (organization units, scoped access, entitlements)
  PLATFORM_UNIT_KINDS: 'platform.unit_kinds',
  PLATFORM_ROLE_SCOPES: 'platform.role_scopes',
  PLATFORM_DEFAULT_ENTITLEMENTS: 'platform.default_entitlements',
  PLATFORM_MATCHING: 'platform.matching',
  PLATFORM_CONFLICT_POLICY: 'platform.conflict_policy',
  PLATFORM_INGEST: 'platform.ingest',
  PLATFORM_ELIGIBILITY: 'platform.eligibility',
  /** Customer "My benefits": employer work-email verification and added cards (EM-02..EM-22, BC-01..BC-14, EL-10..EL-13). */
  CUSTOMER_BENEFITS: 'customer.benefits',
  /** Customer profile set-up, minimum age and consent versions (Blueprint §5, CS-02 / CS-05, AU-31, NT-40). */
  CUSTOMER_ONBOARDING: 'customer.onboarding',
  /** Customer Live Deals map: the base-map tile provider (none = the app's own plain canvas with pins). */
  CUSTOMER_MAP: 'customer.map',
  PLATFORM_DISPUTES: 'platform.disputes',
  PLATFORM_LOYALTY: 'platform.loyalty',
  PLATFORM_CONFLICTS: 'platform.conflicts',
  COMMERCIAL_ENFORCEMENT: 'commercial.enforcement',
  COMMERCIAL_SIGNALS: 'commercial.signals',
  COMMERCIAL_TRIAL: 'commercial.trial',
  COMMERCIAL_METRICS: 'commercial.metrics',
  COMMERCIAL_CAMPAIGN_BILLING: 'commercial.campaign_billing',
  // Phase 4: visibility and operations
  VISIBILITY_ANALYTICS: 'visibility.analytics',
  VISIBILITY_ALERTS: 'visibility.alerts',
  VISIBILITY_HEALTH: 'visibility.health',
  // Phase 5: billing and finance, governed AI
  FINANCE_BILLING: 'finance.billing',
  AI_GOVERNANCE: 'ai.governance',
  // Market / country configuration (pre-Stage-7 hardening)
  MARKETS: 'markets',
  // Stage 7: partner portal (partner type profiles; behaviour is configuration, never a named partner)
  PARTNERS: 'partners',
  // Stage 8: operations (case lifecycle, SLAs, approval thresholds, reasons, risk rules, notification retries, reviews, queues)
  OPERATIONS: 'operations',
  // Stage 9: launch controls (pilot allow-list, per-market emergency stops)
  LAUNCH_CONTROLS: 'launch.controls',
} as const;

/**
 * Document requirement definition. The default list below is a MOCK placeholder: exact Saudi KYB/document
 * requirements remain VALIDATE-KSA (VK-18). Operations edit this list through configuration without a release.
 */
export interface DocumentRequirementConfig {
  code: string;
  nameEn: string;
  nameAr: string;
  required: boolean;
  expiryRequired: boolean;
  /** True while the requirement has not been validated with Saudi counsel (shown as "to be confirmed"). */
  placeholder: boolean;
}

export interface MerchantRiskCriteria {
  /** Category codes that suggest the enhanced review tier (empty by default; MOCK). */
  enhancedCategories: string[];
  /** Suggest enhanced review when the IBAN account holder does not match the legal entity. */
  ibanNameMismatchSuggestsEnhanced: boolean;
  /** Suggest enhanced review when any document is rejected during review. */
  rejectedDocumentSuggestsEnhanced: boolean;
}
export type ConfigKey = (typeof CONFIG_KEYS)[keyof typeof CONFIG_KEYS];

/** Defaults used when a key has not been set yet. They mirror the approved initial values. */
export const CONFIG_DEFAULTS: Record<ConfigKey, unknown> = {
  'auth.otp.ttl_seconds': 300,
  'auth.otp.max_attempts': 5,
  'auth.otp.resend_cooldown_seconds': 30,
  'auth.otp.max_requests_per_hour': 5,
  'auth.password.max_failed_attempts': 5,
  'auth.password.lock_minutes': 15,
  'auth.session.idle_minutes': 60,
  'auth.session.absolute_hours': 24 * 14,
  'auth.admin.mfa_required': true,
  'reporting.cohort_threshold': 10,
  'reservation.hold_minutes': 30,
  'discovery.enabled_cities': ['Riyadh'],
  // City centres used to sort by distance when a customer has not shared a location. Add a city here and to enabled_cities to launch it.
  'discovery.city_centers': {
    Riyadh: { nameAr: 'الرياض', latitude: 24.7136, longitude: 46.6753 },
  },
  'files.max_bytes': 10 * 1024 * 1024,
  'files.allowed_mime': ['application/pdf', 'image/jpeg', 'image/png'],
  'merchant.document_requirements': [
    {
      code: 'CR',
      nameEn: 'Commercial registration / trade licence',
      nameAr: 'السجل التجاري / رخصة النشاط',
      required: true,
      expiryRequired: true,
      placeholder: true,
    },
    {
      code: 'AUTHORISATION',
      nameEn: 'Authorisation letter (if the signatory is not named on the registration)',
      nameAr: 'خطاب تفويض (إذا لم يكن الموقّع مذكوراً في السجل)',
      required: false,
      expiryRequired: false,
      placeholder: true,
    },
    {
      code: 'OTHER',
      nameEn: 'Other relevant business document',
      nameAr: 'مستند تجاري آخر ذو صلة',
      required: false,
      expiryRequired: false,
      placeholder: true,
    },
  ] satisfies DocumentRequirementConfig[],
  'merchant.categories': [
    { code: 'restaurants', nameEn: 'Restaurants', nameAr: 'المطاعم' },
    { code: 'cafes', nameEn: 'Cafes', nameAr: 'المقاهي' },
    { code: 'beauty', nameEn: 'Beauty and wellness', nameAr: 'الجمال والعافية' },
    { code: 'fitness', nameEn: 'Fitness', nameAr: 'اللياقة' },
    { code: 'retail', nameEn: 'Retail', nameAr: 'التجزئة' },
    { code: 'entertainment', nameEn: 'Entertainment', nameAr: 'الترفيه' },
    { code: 'services', nameEn: 'Services', nameAr: 'الخدمات' },
  ],
  'merchant.risk_criteria': {
    enhancedCategories: [],
    ibanNameMismatchSuggestsEnhanced: true,
    rejectedDocumentSuggestsEnhanced: true,
  } satisfies MerchantRiskCriteria,
  'merchant.reapply_after_rejection': true,
  'merchant.invite_ttl_hours': 72,
  'live_deals.material_fields': [
    'mechanic',
    'valueNumber',
    'offerLabel',
    'categoryId',
    'branchIds',
    'startAt',
    'endAt',
    'eligibility',
    'terms',
    'title',
    'shortDescription',
    'description',
    'redemptionMode',
  ],
  // Pilot posture (BP-03): everything is reviewed by hand. Auto-publish exists behind this switch for later.
  'live_deals.auto_publish': { enabled: false, minTrustLevel: 'TRUSTED' },
  // MOCK guardrail values for development; real ranges are a founder/legal decision (VALIDATE-KSA VK-01).
  'live_deals.guardrails': {
    maxPercentOff: 70,
    reviewMechanics: ['OTHER'],
    prohibitedTerms: ['guaranteed', 'free money', 'مضمون 100'],
  },
  'live_deals.controlled_enabled': false,
  'deals.image_max_bytes': 5 * 1024 * 1024,
  'deals.image_allowed_mime': ['image/jpeg', 'image/png'],
  'deals.image_min_width': 400,
  'deals.image_min_height': 250,
  'analytics.impression_window_minutes': 30,
  // ---- Stage 4 (development values; every one is editable by Operations in Admin > Configuration)
  'hot_deals.limits': {
    maxHours: 72,
    maxPerCustomer: 5,
    maxUnitsPerBranch: 5000,
    // remaining units are shown to customers when at or below this number
    showRemainingThreshold: 1000,
  },
  'hot_deals.guardrails': {
    maxPercentOff: 80,
    reviewMechanics: ['OTHER'],
    prohibitedTerms: ['guaranteed', 'free money', 'مضمون 100'],
  },
  'hot_deals.auto_publish': { enabled: false, minTrustLevel: 'TRUSTED' },
  'reservation.hold_limits': { minMinutes: 10, maxMinutes: 120 },
  'reservation.max_active': 3,
  'reservation.expiring_notice_minutes': 10,
  // initial product default (FDR-39 closed): 3 confirmed no-shows then a temporary restriction, never an automatic permanent ban
  'reservation.noshow': { threshold: 3, windowDays: 30, blockDays: 7 },
  'redemption.recheck_eligibility': true,
  'redemption.manual_attempts_per_minute': 5,
  'redemption.reversal_window_hours': 24,
  'staff.history_days': 2,
  // ---- Stage 5: Vouchers, payments, refunds, ledger. MOCK development values; every one is editable in Admin > Configuration.
  // The legal and commercial meaning of these numbers (refund rights, expiry, fees, funds treatment) is VALIDATE-KSA.
  'vouchers.limits': {
    minValidityDays: 7,
    maxValidityDays: 365,
    maxFaceValueHalalas: 500_000,
    maxQtyPerVoucher: 100_000,
    maxPerCustomer: 10,
    reviewAboveDiscountPercent: 70,
  },
  'vouchers.guardrails': {
    maxPercentOff: 80,
    reviewMechanics: [],
    prohibitedTerms: ['guaranteed', 'free money', 'مضمون 100'],
  },
  // Pilot posture: every voucher is reviewed by hand.
  'vouchers.auto_publish': { enabled: false, minTrustLevel: 'TRUSTED' },
  'vouchers.checkout_hold_minutes': 10,
  'vouchers.payment_retry_limit': 3,
  // MOCK: full refund before redemption within 24 h; later requests go to review (or 'BLOCK'). VALIDATE-KSA (VK-04).
  'vouchers.refund_policy': {
    windowHours: 24,
    outsideWindow: 'REVIEW',
    checkerThresholdHalalas: 0,
  },
  'vouchers.expiry_reminder_days': 3,
  // MOCK platform fee on a redeemed voucher: 10% of the price, versioned so later changes never alter history (FDR-16).
  'vouchers.fee_rule': { percentBps: 1000, fixedHalalas: 0, version: 1 },
  // Merchant payable becomes settlement-eligible on redemption (VC-40). The ledger can move this later without a schema change.
  'vouchers.payable_accrual_point': 'REDEMPTION',
  // What happens to the value of an expired voucher is NOT decided: the ledger only records it separately (VALIDATE-KSA VK-04).
  'vouchers.expired_value_policy': 'UNDECIDED_VALIDATE_KSA',
  'payments.webhook_tolerance_seconds': 300,
  // ---- Stage 6. MOCK values; the real ones are founder / operations settings (FDR) and VALIDATE-KSA items.
  'watch.limits': {
    minDurationSec: 5,
    maxDurationSec: 60,
    maxVideoBytes: 50 * 1024 * 1024,
    minPaidViews: 10,
    maxPaidViews: 100_000,
    maxCampaignDays: 90,
  },
  // DealDash rate card: what a merchant pays per qualified view. NOT hard-coded commercially; versioned (WE-02).
  'watch.rate_card': { chargePerViewHalalas: 100, version: 1 },
  // DealDash reward rule: points per qualified view by video length. The merchant never sets this (WE-01). No SAR value.
  'watch.reward_rule': {
    version: 1,
    tiers: [
      { upToSec: 15, points: 10 },
      { upToSec: 30, points: 20 },
      { upToSec: 600, points: 30 },
    ],
  },
  'watch.qualifying_policy': {
    watchPct: 80,
    watchSeconds: null,
    resumeGraceSec: 10,
    heartbeatSec: 2,
    maxSessionFactor: 3,
    // Low friction by default: a prompt appears only on some longer videos (configurable by DealDash).
    stillWatching: {
      mode: 'RANDOM',
      probability: 0.3,
      minDurationSec: 20,
      timeoutSec: 8,
      graceSec: 3,
    },
  },
  'watch.frequency': {
    minRepeatWindowHours: 24,
    maxQualifiedPerCustomerPerCampaign: 1,
    customerDailyCap: 10,
    deviceMaxAccounts: 2,
    accountMaxDevices: 3,
    maxConcurrentSessions: 1,
  },
  'watch.guardrails': { reviewAbovePaidViews: 5000 },
  'watch.auto_publish': { enabled: false, minTrustLevel: 'TRUSTED' },
  'watch.fraud': {
    holdHours: 24,
    thresholds: { hold: 30, flag: 60, block: 90 },
    newAccountHours: 24,
    newAccountMaxViews: 5,
    velocityWindowMinutes: 10,
    velocityMaxStarts: 8,
    minPromptResponseMs: 250,
    regularityStdDevMs: 15,
    dailyCapStreakDays: 3,
  },
  // What happens to unused campaign budget is NOT decided: the ledger only records it separately (VALIDATE-KSA VK-08 / VK-16).
  'watch.unused_budget_treatment': 'UNDECIDED_VALIDATE_KSA',
  // ---- Commercial governance. Fallback pricing used only when no active pricing agreement matches; Admin configures agreements.
  'commercial.default_pricing': {
    version: 1,
    currency: 'SAR',
    // null = tax not configured (VALIDATE-KSA); the quotation shows the tax line as "not configured", never an invented rate.
    taxBps: null,
    // There is NO default treatment of unused funding: it must come from the agreement (activation is blocked without it).
    unusedTreatment: null,
    products: {
      VOUCHER: [
        {
          code: 'commission',
          label: { en: 'DealDash commission', ar: 'عمولة ديل داش' },
          enabled: true,
          basis: 'PERCENT_OF_BASE',
          bps: 1000,
          base: 'SELLING_PRICE',
          trigger: 'VERIFIED_REDEMPTION',
          collection: 'NETTED',
          taxable: false,
        },
      ],
      WATCH: [
        {
          code: 'platform_fee',
          label: { en: 'Platform fee', ar: 'رسوم المنصة' },
          enabled: false,
          basis: 'PERCENT_OF_BASE',
          bps: 0,
          base: 'MEDIA_SPEND',
          trigger: 'UPFRONT',
          collection: 'CASH',
          taxable: true,
        },
      ],
      EXCLUSIVE: [
        {
          code: 'redemption_fee',
          label: { en: 'Redemption fee', ar: 'رسوم الاستخدام' },
          enabled: true,
          basis: 'PER_UNIT',
          amountHalalas: 100,
          trigger: 'VERIFIED_REDEMPTION',
          collection: 'CASH',
          taxable: true,
        },
        {
          code: 'setup_fee',
          label: { en: 'Campaign setup fee', ar: 'رسوم إعداد الحملة' },
          enabled: false,
          basis: 'FIXED',
          amountHalalas: 0,
          trigger: 'UPFRONT',
          collection: 'CASH',
          taxable: true,
        },
      ],
      LIVE_BENEFIT: [],
      LOYALTY: [],
    },
  },
  // ---- Shared platform. Which kinds of organization unit exist (Admin can extend the list).
  'platform.unit_kinds': {
    kinds: [
      'BRAND',
      'OPERATING_COMPANY',
      'FRANCHISEE',
      'COUNTRY',
      'REGION',
      'CITY',
      'BUSINESS_UNIT',
      'BRANCH',
      'OUTLET',
      'DEPARTMENT',
    ],
  },
  // ---- Which scope kinds each role may be held in (configuration, not code). A role missing here can only be held organisation-wide.
  'platform.role_scopes': {
    MERCHANT_OWNER: ['ORGANIZATION'],
    MERCHANT_ADMIN: ['ORGANIZATION', 'LEGAL_ENTITY', 'COUNTRY', 'UNIT'],
    MERCHANT_FINANCE: ['ORGANIZATION', 'LEGAL_ENTITY', 'COUNTRY', 'CAMPAIGN'],
    MERCHANT_CAMPAIGN_MANAGER: [
      'ORGANIZATION',
      'LEGAL_ENTITY',
      'COUNTRY',
      'UNIT',
      'BRANCH',
      'PRODUCT',
      'CAMPAIGN',
    ],
    MERCHANT_STAFF: ['BRANCH', 'UNIT'],
    PARTNER_ADMIN: ['ORGANIZATION', 'LEGAL_ENTITY', 'COUNTRY'],
    PARTNER_CAMPAIGN_MANAGER: [
      'ORGANIZATION',
      'LEGAL_ENTITY',
      'COUNTRY',
      'UNIT',
      'PRODUCT',
      'CAMPAIGN',
    ],
    PARTNER_BENEFITS_MANAGER: ['ORGANIZATION', 'COUNTRY', 'UNIT'],
    PARTNER_ANALYST: ['ORGANIZATION', 'LEGAL_ENTITY', 'COUNTRY', 'UNIT', 'CAMPAIGN'],
  },
  // ---- What an organisation may use when it has NO contract yet (an explicit contract replaces this completely).
  'platform.default_entitlements': {
    MERCHANT: {
      products: ['LIVE_DEAL', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY'],
      features: [],
      limits: {},
    },
    PARTNER: { products: [], features: [], limits: {} },
    DEALDASH: { products: [], features: [], limits: {} },
  }, // ---- Phase 2: how candidate duplicates are scored and how source / local disagreements are resolved. All configuration.
  'platform.matching': {
    /** Below this confidence two records are not even suggested as duplicates. */
    candidateMinConfidence: 72,
    /** Words that carry no identity ("llc", "ksa", "saudi arabia" ...), removed before names are compared. */
    stopWords: [
      'the',
      'co',
      'company',
      'llc',
      'ltd',
      'limited',
      'inc',
      'ksa',
      'saudi',
      'arabia',
      'sa',
      'branch',
      'store',
      'shop',
      'restaurant',
      'ال',
      'شركة',
      'مؤسسة',
      'فرع',
      'السعودية',
      'المملكة',
    ],
  },
  'platform.conflict_policy': {
    /** SOURCE_WINS | DEALDASH_WINS | MERCHANT_WINS | MANUAL_REVIEW. A field not listed uses `default`. */
    default: 'MANUAL_REVIEW',
    /** A registered merchant is the authority on its own data. */
    registeredMerchant: 'MERCHANT_WINS',
    fields: {},
  },
  'platform.ingest': {
    maxRecordsPerRequest: 500,
    maxImportRows: 5000,
    /** Imports run by a business always need DealDash approval; Admin imports above this many rows need a second Admin. */
    adminApprovalAboveRows: 200,
    webhookMaxAttempts: 5,
    webhookBackoffSeconds: [60, 300, 900, 3600, 21600],
  }, // ---- Phase 3: shared eligibility, loyalty, disputes and offer-conflict detection (all configuration).
  'platform.eligibility': {
    /** Age and gender criteria stay OFF until the market's rules are validated (VALIDATE-KSA). DealDash does not collect them today. */
    sensitiveAttributesEnabled: false,
  },
  'customer.benefits': {
    /**
     * EM-20 / EL-11: a verified employer expires after this many days and the customer re-verifies by a new work-email code.
     * PLACEHOLDER pending the founder's value (FDR-28 closed as "configurable"): change it here, never in code.
     */
    employerReverifyDays: 180,
    /**
     * EM-20 "a grace period applies": after the renewal date the employer benefit KEEPS WORKING for this many days while the
     * customer confirms the work email again; only then does it expire. PLACEHOLDER pending the founder's value (0 = no grace).
     */
    employerGraceDays: 14,
    /** The customer is reminded this many days before the renewal date (and again when the grace period starts). */
    reverifyNoticeDays: 14,
    /** EM-03: work-email code lifetime, attempts, request limits and cool-down. */
    emailOtpTtlSeconds: 600,
    emailOtpMaxAttempts: 5,
    emailOtpMaxPerHour: 5,
    emailOtpCooldownSeconds: 60,
    /** EM-02: subdomains of an approved domain are accepted (mail.company.com for company.com). */
    allowSubdomains: true,
    /** EM-07: generic / shared mailboxes and personal email domains are never accepted as a work email. */
    blockedLocalParts: [
      'info',
      'hr',
      'admin',
      'support',
      'contact',
      'sales',
      'hello',
      'office',
      'noreply',
      'no-reply',
    ],
    blockedDomains: [
      'gmail.com',
      'googlemail.com',
      'hotmail.com',
      'outlook.com',
      'live.com',
      'yahoo.com',
      'icloud.com',
      'me.com',
      'aol.com',
      'proton.me',
      'protonmail.com',
    ],
    /** BC-14: how many cards a customer may add. */
    maxCardEntries: 5,
  },
  'customer.onboarding': {
    /** AU-31 / FD-03: customers under this age cannot sign up (date of birth at onboarding). Per-market review: VK-06 / VK-11. */
    minimumAge: 18,
    /**
     * Reserving, buying, watching to earn and redeeming points need a completed profile (age checked, Terms and Privacy accepted).
     * Browsing, saving and My benefits never do.
     */
    requireCompleteForActions: true,
    /** The Terms and Privacy versions a customer must have accepted. Raising one asks every customer to accept again. */
    termsVersion: '2026-10',
    privacyVersion: '2026-10',
    /** Where the published documents live (null until Legal publishes them: the app then says the final text is pending). */
    termsUrl: null,
    privacyUrl: null,
  },
  'customer.map': {
    /**
     * XYZ tile URL of the licensed base-map provider, for example "https://tiles.example.com/{z}/{x}/{y}.png" (a provider contract:
     * external dependency). Null = no base map: pins, distance rings and "you are here" on a plain canvas.
     */
    tileUrlTemplate: null,
    /** The provider's required attribution text, shown on the map. */
    attribution: null,
  },
  'platform.loyalty': {
    /** A rule cannot be activated without a ceiling at least this small (points). Null = any ceiling is accepted. */
    maxAllocationPerRule: null,
    /** Funded rules need DealDash approval; a DealDash rule needs a different Admin to approve it. */
    approvalRequired: true,
    /** Event types the platform accepts rules for. Streaks and milestones are NOT in the MVP; a campaign bonus is a BONUS rule scoped to one campaign. */
    eventTypes: [
      'QUALIFIED_VIEW',
      'EXCLUSIVE_REDEMPTION',
      'VOUCHER_PURCHASE',
      'VOUCHER_REDEMPTION',
    ],
  },
  'platform.disputes': {
    types: [
      'REWARD_REFUSED',
      'REDEMPTION_DISPUTE',
      'SPONSOR_CHARGE_DISPUTE',
      'DUPLICATE_FUNDING',
      'SETTLEMENT_MISMATCH',
      'INVALID_VOUCHER_REDEMPTION',
      'IMPORT_CONFLICT',
      'FEED_DISCREPANCY',
      'RECONCILIATION_BREAK',
      'OTHER',
    ],
    /** Hours to resolve, by priority. */
    slaHours: { LOW: 120, NORMAL: 72, HIGH: 24, CRITICAL: 4 },
    /** A financial adjustment above this many halalas needs a second Admin to approve the resolution. Null = always two people. */
    adjustmentCheckerAboveHalalas: 0,
  },
  // ---- Subscription / licensing engine. Every number here is configuration, never application logic.
  'commercial.enforcement': {
    /** Grace after a contract goes past due. Resolved: contract, then plan version, then entity type, then market, then this default. VALIDATE: legal / market policy. */
    graceDays: 14,
    graceDaysByEntityType: {},
    graceDaysByMarket: {},
    /** After the grace the contract is suspended by the daily job; until then enforcement already treats it as suspended. */
    autoSuspendAfterGrace: true,
    treatElapsedGraceAsSuspended: true,
    /** What a SUSPENDED / elapsed-grace / ended contract and a financial hold refuse: NEW exposure only. Issued customer rights are never in this list. */
    blockedWhenSuspended: [
      'NEW_PAID_CAMPAIGN',
      'ACTIVATE_CAMPAIGN',
      'ADD_BRANCH',
      'ADD_USER',
      'PREMIUM_FEATURE',
      'API_OPERATION',
      'UPGRADE_EXPOSURE',
    ],
    blockedWhenEnded: [
      'NEW_PAID_CAMPAIGN',
      'ACTIVATE_CAMPAIGN',
      'ADD_BRANCH',
      'ADD_USER',
      'PREMIUM_FEATURE',
      'API_OPERATION',
      'UPGRADE_EXPOSURE',
    ],
    blockedOnFinancialHold: ['NEW_PAID_CAMPAIGN', 'ACTIVATE_CAMPAIGN', 'UPGRADE_EXPOSURE'],
    /** CONTINUE: an approved, live, prepaid campaign keeps running (default, protects customers). STOP_NEW_EXPOSURE: no new reservations, purchases or views. Stricter treatment is a contract / plan override. */
    liveCampaignsWhenSuspended: 'CONTINUE',
  },
  'commercial.signals': {
    /** Percent of a limit at which an approaching signal is raised. */
    thresholds: [80, 100],
    leadDays: {
      TRIAL_EXPIRING: 7,
      PROMOTION_EXPIRING: 7,
      RENEWAL_APPROACHING: 30,
      CONTRACT_EXPIRING: 30,
    },
  },
  'commercial.trial': {
    /** A trial never turns into Starter unless this is switched on (and a post-trial plan is configured). */
    convertToStarterWhenNoPostPlan: false,
    starterPlanCode: 'STARTER',
  },
  /** What each product is billed on, stored on the campaign when it is committed (never inferred later from dashboard totals). */
  'commercial.campaign_billing': {
    EXCLUSIVE: { trigger: 'VERIFIED_REDEMPTION', model: 'USAGE' },
    VOUCHER: { trigger: 'TRANSACTION', model: 'USAGE' },
    WATCH: { trigger: 'QUALIFIED_VIEW', model: 'USAGE' },
    LIVE_BENEFIT: { trigger: 'FIXED_FEE', model: 'INCLUDED' },
    LOYALTY: { trigger: 'CAMPAIGN_ACTIVATION', model: 'FIXED' },
  },
  'commercial.metrics': {
    users: { includePendingInvitations: true, excludeRoles: [] },
  },
  'platform.conflicts': {
    /** Public Live Deal vs Exclusive Deal: flag when the exclusive benefit is weaker than the public one. */
    flagWeakerExclusive: true,
    /** Percentage-points of difference below which two benefits are treated as equal. */
    equalWithinPoints: 0,
  }, // Which products must complete commercial governance before going live (founder decision: all of them).
  'commercial.requirements': {
    VOUCHER: true,
    WATCH: true,
    EXCLUSIVE: true,
    LIVE_BENEFIT: true,
    LOYALTY: true,
  },
  // ---------------------------------------------------------------- Phase 4: visibility and operations
  'visibility.analytics': {
    /** Rows read per source per projector pass (the projector catches up over several passes). */
    projectorBatch: 2000,
    /** Hours of history re-aggregated on every pass (late events land in already closed buckets). */
    reaggregateHours: 48,
    /** Minimum share of the period elapsed before a forecast is offered (earlier forecasts are noise). */
    forecastMinElapsedBps: 1000,
  },
  'visibility.alerts': {
    /** One alert per (code, subject) per window: avoids fatigue. */
    cooldownHours: 24,
    escalation: {
      afterMinutes: 240,
      toRoles: ['MERCHANT_OWNER', 'MERCHANT_ADMIN', 'DEALDASH_OPERATIONS'],
    },
    thresholds: {
      budgetExhaustHours: 48,
      inventoryExhaustHours: 24,
      voucherInventoryLowBps: 1000,
      rewardInventoryLow: 10,
      pointsFundingLowBps: 2000,
      sponsorNearLimitBps: 8000,
      creditNearLimitBps: 8000,
      poNearLimitBps: 8000,
      campaignExpiryDays: 3,
      voucherExpiryDays: 7,
      rewardExpiryDays: 7,
      quotationExpiryDays: 3,
      invoiceDueDays: 3,
      settlementPendingDays: 7,
      behindTargetBps: 7000,
      lowActivityHours: 48,
      paymentFailureRateBps: 3000,
      paymentFailureMinAttempts: 5,
      rejectionRateBps: 3000,
      rejectionMinAttempts: 5,
      suspiciousBranchFlags: 3,
    },
  },
  'visibility.health': {
    /** Connection error count at which it is FAILING (below: DEGRADED). */
    failingErrorCount: 5,
    jobBacklogWarning: 200,
    webhookFailureRateBps: 2000,
  },
  // ---------------------------------------------------------------- Phase 5: billing and finance
  'finance.billing': {
    defaultPaymentTermsDays: 30,
    /** Days after the due date that still count as GRACE in the financial status (enforcement stays a human decision). */
    overdueGraceDays: 7,
    /** Issuing a document at or above this total (minor units, per currency) needs a second finance person. */
    issueApprovalThresholdMinor: { SAR: 10_000_000, PKR: 50_000_000 },
    agingBucketDays: [30, 60, 90],
    /** Writing off a receivable is a statutory question per country (VALIDATE-KSA): off until confirmed. */
    writeOffAllowed: false,
    /** Proforma invoices are requests for payment, never receivables. */
    proformaForPrepaid: true,
    /** A quotation not accepted within this many days expires and must be re-issued. */
    quotationValidityDays: 14,
    /**
     * Overdue invoices are always reported (GRACE, then the reason INVOICES_OVERDUE_GRACE_ELAPSED). Only when this is switched on do
     * they turn the financial status to PAST_DUE (which blocks new exposure under the subscription policy). Off: Finance decides.
     */
    overdueDrivesPastDue: false,
  },
  // ---------------------------------------------------------------- Phase 5: governed AI agents
  'ai.governance': {
    enabled: true,
    customerAgentEnabled: true,
    /** MVP: explain, recommend, draft, execute only after a recorded human approval. */
    maxAutonomyLevel: 3,
    /** Level 4 (bounded autonomy) is architecture-ready but switched off; level 5 is always refused. */
    boundedAutonomyEnabled: false,
    provider: 'BUILTIN',
    model: 'dealdash-rules-v1',
    /** Estimated cost per request in minor units of SAR (the built-in provider has no external cost). */
    estimatedCostPerRequestMinor: 0,
    /** Currency of the estimated AI cost (DealDash's own provider cost, not a customer amount). */
    costCurrency: 'SAR',
    commercialTreatment: 'INCLUDED_FEATURE',
    /** Business agents need this contract feature; the customer agent does not. */
    businessFeature: 'AI_COPILOT',
  },
  // ---- Markets: the market (country) drives tax, currency, invoicing, payments, settlement, product availability and launch state.
  markets: {
    /** Market and product statuses under which businesses may create new campaigns / exposure. */
    availableStatuses: ['PILOT', 'ACTIVE'],
    /** Market of a business with no legal entity, contract market or branch country yet (explicit, never a guess). */
    defaultMarket: 'SA',
    /** Markets where the platform default campaign pricing is approved; other markets need market-specific pricing. */
    defaultPricingMarkets: ['SA'],
    /**
     * Currencies campaign funding may be booked in (governed: enabling a currency is a decision, not a code change). The ledger keeps one
     * account per currency and single-currency journals; nothing is converted. Create-only default for new databases; existing ones change
     * it through Rules and controls.
     */
    campaignLedgerCurrencies: ['SAR', 'PKR', 'AED', 'QAR'],
  },
  // ---- Partners (Stage 7): what each partner TYPE is offered. The contract (entitlements) still decides what is switched on, and the
  // market decides where. Nothing here names a particular bank, scheme or employer.
  partners: {
    typeProfiles: {
      BANK: {
        modules: [
          'CAMPAIGNS',
          'MERCHANT_NETWORK',
          'OFFERS',
          'ELIGIBILITY',
          'CARD_PROGRAMS',
          'LIVE_DEAL_BENEFITS',
          'EXCLUSIVE',
          'VOUCHER',
          'WATCH_SPONSORSHIP',
          'LOYALTY',
          'PERFORMANCE',
          'FINANCE',
          'INTEGRATIONS',
          'AI_COPILOT',
        ],
        eligibilityAttributes: [
          'CARD',
          'CARD_PRODUCT',
          'CARD_TIER',
          'SCHEME',
          'COUNTRY',
          'GEOGRAPHY',
          'SEGMENT',
          'MEMBERSHIP',
          'PRODUCT_OWNERSHIP',
        ],
        ingestionMethods: ['MANUAL', 'BULK', 'API'],
        contractKinds: ['BANK_ENTERPRISE'],
        reporting: 'AGGREGATE',
      },
      FINANCIAL_INSTITUTION: {
        modules: [
          'CAMPAIGNS',
          'MERCHANT_NETWORK',
          'OFFERS',
          'ELIGIBILITY',
          'CARD_PROGRAMS',
          'LIVE_DEAL_BENEFITS',
          'EXCLUSIVE',
          'VOUCHER',
          'LOYALTY',
          'PERFORMANCE',
          'FINANCE',
          'INTEGRATIONS',
          'AI_COPILOT',
        ],
        eligibilityAttributes: [
          'CARD',
          'CARD_PRODUCT',
          'CARD_TIER',
          'SCHEME',
          'COUNTRY',
          'GEOGRAPHY',
          'SEGMENT',
          'MEMBERSHIP',
          'PRODUCT_OWNERSHIP',
        ],
        ingestionMethods: ['MANUAL', 'BULK', 'API'],
        contractKinds: ['BANK_ENTERPRISE', 'CUSTOM_ENTERPRISE'],
        reporting: 'AGGREGATE',
      },
      SCHEME: {
        modules: [
          'CAMPAIGNS',
          'MERCHANT_NETWORK',
          'OFFERS',
          'ELIGIBILITY',
          'CARD_PROGRAMS',
          'LIVE_DEAL_BENEFITS',
          'EXCLUSIVE',
          'VOUCHER',
          'LOYALTY',
          'PERFORMANCE',
          'FINANCE',
          'INTEGRATIONS',
          'AI_COPILOT',
        ],
        eligibilityAttributes: [
          'SCHEME',
          'CARD_PRODUCT',
          'CARD_TIER',
          'COUNTRY',
          'GEOGRAPHY',
          'SEGMENT',
        ],
        ingestionMethods: ['MANUAL', 'BULK', 'API'],
        contractKinds: ['SCHEME_NETWORK_LICENCE'],
        reporting: 'AGGREGATE',
      },
      EMPLOYER: {
        modules: [
          'CAMPAIGNS',
          'MERCHANT_NETWORK',
          'ELIGIBILITY',
          'EMPLOYER_PROGRAMS',
          'LIVE_DEAL_BENEFITS',
          'EXCLUSIVE',
          'VOUCHER',
          'LOYALTY',
          'PERFORMANCE',
          'FINANCE',
          'AI_COPILOT',
        ],
        eligibilityAttributes: ['EMPLOYER', 'COUNTRY', 'GEOGRAPHY', 'SEGMENT', 'MEMBERSHIP'],
        ingestionMethods: ['MANUAL', 'BULK'],
        contractKinds: ['CORPORATE_PARTNER'],
        reporting: 'AGGREGATE',
      },
      CORPORATE: {
        modules: [
          'CAMPAIGNS',
          'MERCHANT_NETWORK',
          'ELIGIBILITY',
          'EMPLOYER_PROGRAMS',
          'LIVE_DEAL_BENEFITS',
          'EXCLUSIVE',
          'VOUCHER',
          'LOYALTY',
          'PERFORMANCE',
          'FINANCE',
          'AI_COPILOT',
        ],
        eligibilityAttributes: ['EMPLOYER', 'COUNTRY', 'GEOGRAPHY', 'SEGMENT', 'MEMBERSHIP'],
        ingestionMethods: ['MANUAL', 'BULK'],
        contractKinds: ['CORPORATE_PARTNER'],
        reporting: 'AGGREGATE',
      },
      STRATEGIC_PARTNER: {
        modules: [
          'CAMPAIGNS',
          'MERCHANT_NETWORK',
          'OFFERS',
          'ELIGIBILITY',
          'LIVE_DEAL_BENEFITS',
          'EXCLUSIVE',
          'VOUCHER',
          'LOYALTY',
          'PERFORMANCE',
          'FINANCE',
          'INTEGRATIONS',
          'AI_COPILOT',
        ],
        eligibilityAttributes: ['MEMBERSHIP', 'SEGMENT', 'COUNTRY', 'GEOGRAPHY'],
        ingestionMethods: ['MANUAL', 'BULK', 'API'],
        contractKinds: ['CUSTOM_ENTERPRISE'],
        reporting: 'AGGREGATE',
      },
      OTHER_APPROVED_PARTNER: {
        modules: [
          'CAMPAIGNS',
          'MERCHANT_NETWORK',
          'ELIGIBILITY',
          'LIVE_DEAL_BENEFITS',
          'PERFORMANCE',
          'FINANCE',
        ],
        eligibilityAttributes: ['MEMBERSHIP', 'COUNTRY', 'GEOGRAPHY'],
        ingestionMethods: ['MANUAL', 'BULK'],
        contractKinds: ['CUSTOM_ENTERPRISE'],
        reporting: 'AGGREGATE',
      },
    },
    /** Invitation link validity for partner users. */
    inviteTtlHours: 72,
  },
  // Rewards: no point-to-SAR value is configured or shown anywhere (RW-07). Expiry is off until decided (VK-17).
  'rewards.rules': {
    expiryDays: null,
    expiryReminderDays: 7,
    lifetimeBalanceCap: null,
    negativeBalancePolicy: 'ALLOW_NEGATIVE',
    adjustmentCheckerThresholdPoints: 100,
    // Stage 9 (B4): points taken back for a partial refund = earned × refunded ÷ order total, rounded by this policy
    // (FLOOR | NEAREST | CEIL). FLOOR never takes back more than the refunded share; a full refund always takes back everything.
    refundReversalRounding: 'FLOOR',
  },
  // ---- Stage 8: operations. Every value is configuration (Admin > Rules and controls), versioned and audited. Nothing here is a
  // market rule: refund rights, tax treatment, settlement cycles and retention come from the Market configuration and its
  // VALIDATE-<market> items.
  operations: DEFAULT_OPERATIONS_CONFIG,
  'launch.controls': DEFAULT_LAUNCH_CONTROLS,
};

export const FEATURE_FLAGS = {
  PRODUCT_LIVE_DEALS: 'product.live_deals',
  PRODUCT_HOT_DEALS: 'product.hot_deals',
  PRODUCT_VOUCHERS: 'product.vouchers',
  PRODUCT_WATCH_EARN: 'product.watch_earn',
} as const;
export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];
