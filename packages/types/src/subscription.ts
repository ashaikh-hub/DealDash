/**
 * Subscription, licensing, entitlement and commercial plan vocabulary. A plan is a reusable template; a Contract is the customer's
 * agreement; ContractEntitlement is the one authorization source. Nothing here carries a price: prices are versioned configuration.
 */

/** The commercial type of a Contract. An Enterprise Licence is a Contract of an enterprise kind, not a separate architecture. */
export const CONTRACT_KINDS = [
  'MERCHANT_SUBSCRIPTION',
  'MERCHANT_ENTERPRISE',
  'BANK_ENTERPRISE',
  'SCHEME_NETWORK_LICENCE',
  'CORPORATE_PARTNER',
  'CUSTOM_ENTERPRISE',
] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

/** Commercial lifecycle (renewal is a separate field; upgrades, downgrades, add-ons and renewals are amendments, not statuses). */
export const CONTRACT_LIFECYCLE = [
  'DRAFT',
  'PENDING_ACTIVATION',
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
  'SUPERSEDED',
] as const;
export type ContractLifecycle = (typeof CONTRACT_LIFECYCLE)[number];
/** Lifecycle states in which a contract's entitlements are defined (new exposure is then decided by the enforcement policy). */
export const IN_FORCE_LIFECYCLE: readonly ContractLifecycle[] = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'];

export const RENEWAL_STATES = ['AUTO_RENEW', 'MANUAL_RENEWAL', 'NON_RENEWING', 'RENEWAL_PENDING'] as const;
export type RenewalState = (typeof RENEWAL_STATES)[number];

export const BILLING_CADENCES = ['NONE', 'MONTHLY', 'ANNUAL', 'MULTI_YEAR', 'MANUAL', 'CUSTOM'] as const;
export type BillingCadence = (typeof BILLING_CADENCES)[number];

export const ENTITY_TYPES_FOR_PLANS = ['MERCHANT', 'BANK', 'SCHEME', 'CORPORATE', 'PARTNER'] as const;

/** Where an entitlement row came from. Resolution: an OVERRIDE replaces the PLAN default; ADDON rows add. */
export const ENTITLEMENT_SOURCES = ['CONTRACT', 'PLAN', 'OVERRIDE', 'ADDON'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export const LIMIT_MODES = ['HARD', 'SOFT'] as const;
export type LimitMode = (typeof LIMIT_MODES)[number];
export const LIMIT_PERIODS = ['NONE', 'DAY', 'MONTH', 'YEAR', 'CONTRACT_TERM'] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];
export const SOFT_ACTIONS = ['WARN', 'OVERAGE_CHARGE', 'REQUIRE_APPROVAL'] as const;
export type SoftAction = (typeof SOFT_ACTIONS)[number];

/** Metrics measured live from the source of truth (a count of things that exist now), as opposed to period meters. */
export const RESOURCE_LIMITS = [
  'branches.max',
  'users.max',
  'campaigns.max_active',
  'legal_entities.max',
  'brands.max',
  'markets.max',
] as const;
/** Metrics accumulated over a period (events), reset by the limit's period. */
export const PERIOD_LIMITS = ['api.requests', 'bulk_import.rows', 'campaigns.per_period', 'exports.per_period'] as const;
export const ALL_LIMIT_KEYS = [...RESOURCE_LIMITS, ...PERIOD_LIMITS] as const;

/** Maps a limit key to the usage metric that measures it. */
export const METRIC_OF_LIMIT: Record<string, string> = {
  'branches.max': 'branch.count',
  'users.max': 'user.active_count',
  'campaigns.max_active': 'campaign.active_count',
  'legal_entities.max': 'legal_entity.count',
  'brands.max': 'brand.count',
  'markets.max': 'market.count',
  'api.requests': 'api.requests',
  'bulk_import.rows': 'bulk_import.rows',
  'campaigns.per_period': 'campaign.activations',
  'exports.per_period': 'data.exports',
};

/** Billable business events (event usage), distinct from resource counts and period meters. */
export const BILLABLE_METRICS = ['qualified_views', 'verified_redemptions', 'voucher_transactions'] as const;

/** Products and features a contract can switch on (the enterprise lists are all contract controlled). */
export const SUBSCRIPTION_PRODUCTS = [
  'LIVE_DEAL',
  'MEMBER_BENEFIT',
  'EXCLUSIVE',
  'VOUCHER',
  'WATCH',
  'LOYALTY',
  'SPONSORED_CAMPAIGNS',
  'PUSH_CAMPAIGNS',
  'FEATURED_PLACEMENT',
  'HOMEPAGE_PLACEMENT',
  'CATEGORY_SPONSORSHIP',
] as const;
export const SUBSCRIPTION_FEATURES = [
  'API_ACCESS',
  'BULK_IMPORT',
  'ADVANCED_REPORTING',
  'PREMIUM_ANALYTICS',
  'NETWORK_INTEGRATION',
  'AI_COPILOT',
  'WEBHOOKS',
  'DEDICATED_SUPPORT',
  'DATA_EXPORT',
  'MULTI_MARKET',
  'BANK_MERCHANT_NETWORK',
  'CARDHOLDER_ELIGIBILITY',
  'BANK_FUNDED_CAMPAIGNS',
  'MERCHANT_FUNDED_CAMPAIGNS',
  'CO_FUNDED_CAMPAIGNS',
  'MERCHANT_INGESTION_MANUAL',
  'MERCHANT_INGESTION_BULK',
  'MERCHANT_INGESTION_API',
  'OFFER_API_INTEGRATION',
  'OFFER_SYNCHRONIZATION',
  'ELIGIBILITY_SYNCHRONIZATION',
  'LOCAL_OFFERS',
  'NATIONAL_OFFERS',
  'REGIONAL_OFFERS',
  'INTERNATIONAL_OFFERS',
  'SPONSORED_VISIBILITY',
  'EMPLOYEE_PROGRAMS',
  'CUSTOMER_PROGRAMS',
  'CORPORATE_FUNDED_CAMPAIGNS',
  'REWARDS',
  'ELIGIBILITY_API',
  'BULK_ENROLLMENT',
] as const;

/** Revenue classification of a billing event. Funding of customer points, merchant reward commitments, sponsor funding, loyalty funding
 * and customer subsidies are NOT DealDash revenue and never appear here. */
export const BILLING_CATEGORIES = [
  'SUBSCRIPTION_LICENCE',
  'SETUP_INTEGRATION',
  'PRODUCT_USAGE',
  'TRANSACTION_COMMISSION',
  'CAMPAIGN_ADVERTISING',
  'PREMIUM_SERVICE',
] as const;
export type BillingCategory = (typeof BILLING_CATEGORIES)[number];

export const BILLING_EVENT_TYPES = {
  MONTHLY_SUBSCRIPTION_RENEWAL: 'SUBSCRIPTION_LICENCE',
  ANNUAL_LICENCE_RENEWAL: 'SUBSCRIPTION_LICENCE',
  LICENCE_ACTIVATION: 'SUBSCRIPTION_LICENCE',
  PLAN_CHANGE_ADJUSTMENT: 'SUBSCRIPTION_LICENCE',
  SETUP_FEE: 'SETUP_INTEGRATION',
  INTEGRATION_FEE: 'SETUP_INTEGRATION',
  API_FEE: 'SETUP_INTEGRATION',
  ADD_ON_FEE: 'PREMIUM_SERVICE',
  PREMIUM_ANALYTICS_FEE: 'PREMIUM_SERVICE',
  FEATURED_PLACEMENT_FEE: 'CAMPAIGN_ADVERTISING',
  CAMPAIGN_SETUP_FEE: 'CAMPAIGN_ADVERTISING',
  QUALIFIED_VIEW_USAGE: 'PRODUCT_USAGE',
  VERIFIED_REDEMPTION_USAGE: 'PRODUCT_USAGE',
  OVERAGE_USAGE: 'PRODUCT_USAGE',
  VOUCHER_TRANSACTION_COMMISSION: 'TRANSACTION_COMMISSION',
} as const satisfies Record<string, BillingCategory>;
export type BillingEventType = keyof typeof BILLING_EVENT_TYPES;

/** What a campaign is billed on, kept on the campaign so billing is never inferred from dashboard totals. */
export const BILLING_TRIGGERS = ['CAMPAIGN_ACTIVATION', 'QUALIFIED_VIEW', 'VERIFIED_REDEMPTION', 'TRANSACTION', 'FIXED_FEE'] as const;

export const FINANCIAL_STATUSES = ['GOOD_STANDING', 'GRACE', 'PAST_DUE', 'FINANCIAL_HOLD', 'SUSPENDED'] as const;
export type FinancialStatus = (typeof FINANCIAL_STATUSES)[number];

/** Actions the commercial engine can allow or refuse. The first group is new exposure; the second can never be blocked. */
export const NEW_EXPOSURE_ACTIONS = [
  'NEW_PAID_CAMPAIGN',
  'ACTIVATE_CAMPAIGN',
  'ADD_BRANCH',
  'ADD_USER',
  'PREMIUM_FEATURE',
  'API_OPERATION',
  'UPGRADE_EXPOSURE',
] as const;
export type NewExposureAction = (typeof NEW_EXPOSURE_ACTIONS)[number];
export const PROTECTED_ACTIONS = [
  'REDEMPTION',
  'VOUCHER_REDEMPTION',
  'REWARD_REDEMPTION',
  'REFUND',
  'INVOICE_ACCESS',
  'HISTORY_ACCESS',
  'FULFILMENT',
] as const;

export const AMENDMENT_TYPES = [
  'UPGRADE',
  'DOWNGRADE',
  'ADD_ON',
  'RENEWAL',
  'PRICING',
  'ENTITLEMENT',
  'MARKET_ADDITION',
  'EXTENSION',
] as const;
export type AmendmentType = (typeof AMENDMENT_TYPES)[number];
export const AMENDMENT_STATUSES = ['PROPOSED', 'ACCEPTED', 'APPLIED', 'REJECTED', 'CANCELLED'] as const;
export const EFFECTIVE_MODES = ['IMMEDIATE', 'NEXT_BILLING_CYCLE', 'CUSTOM_EFFECTIVE_DATE'] as const;

export const PROMOTION_KINDS = [
  'FREE_ONBOARDING',
  'PROMOTIONAL_PRICE',
  'SETUP_WAIVER',
  'CAMPAIGN_CREDIT',
  'TEMPORARY_UPGRADE',
  'ENTERPRISE_TRIAL',
] as const;
export const POST_PROMOTION = ['REVERT_TO_STANDARD', 'CONVERT_TO_PLAN', 'END'] as const;

/** Signals Phase 4 will turn into alerts (an outbox; no alert engine here). */
export const COMMERCIAL_SIGNALS = [
  'BRANCH_LIMIT_80_PERCENT',
  'BRANCH_LIMIT_REACHED',
  'USER_LIMIT_APPROACHING',
  'USER_LIMIT_REACHED',
  'API_LIMIT_APPROACHING',
  'API_LIMIT_REACHED',
  'LIMIT_APPROACHING',
  'LIMIT_REACHED',
  'TRIAL_EXPIRING',
  'PROMOTION_EXPIRING',
  'RENEWAL_APPROACHING',
  'CONTRACT_EXPIRING',
  'PAYMENT_GRACE_STARTED',
  'FINANCIAL_HOLD',
  'CONTRACT_SUSPENDED',
] as const;
export type CommercialSignalType = (typeof COMMERCIAL_SIGNALS)[number];

/** Largest amount a single minor-unit field holds (32-bit); larger custom amounts are split into billing events. */
export const MAX_MINOR_AMOUNT = 2_000_000_000;
