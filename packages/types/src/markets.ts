/**
 * Market / country configuration (pre-Stage-7 hardening of the existing CountryConfiguration). The market (country) — not the region —
 * drives tax, currency, invoicing, payments, settlement, regulation, product availability, legal wording, local providers and launch
 * state. Regions only group markets for reporting and administration. Statutory content is never invented: anything that needs
 * legal / regulatory confirmation is a validation item (VALIDATE-KSA, VALIDATE-UAE, VALIDATE-QATAR, VALIDATE-PAKISTAN, ...).
 */

/** Market lifecycle. A market can exist (and be configured) without being visible or commercially active. */
export const MARKET_STATUSES = [
  'PLANNED',
  'CONFIGURING',
  'TESTING',
  'PILOT',
  'ACTIVE',
  'SUSPENDED',
  'CLOSED',
] as const;
export type MarketStatus = (typeof MARKET_STATUSES)[number];

/** Allowed lifecycle moves. CLOSED is terminal. Moving to PILOT or ACTIVE needs the activation gate and a second approver. */
export const MARKET_TRANSITIONS: Record<MarketStatus, readonly MarketStatus[]> = {
  PLANNED: ['CONFIGURING', 'CLOSED'],
  CONFIGURING: ['TESTING', 'PLANNED', 'CLOSED'],
  TESTING: ['PILOT', 'CONFIGURING', 'CLOSED'],
  PILOT: ['ACTIVE', 'SUSPENDED', 'TESTING', 'CLOSED'],
  ACTIVE: ['SUSPENDED', 'CLOSED'],
  SUSPENDED: ['PILOT', 'ACTIVE', 'CLOSED'],
  CLOSED: [],
};
/** Transitions that need maker-checker approval (opening a market to businesses or customers). */
export const MARKET_APPROVAL_REQUIRED: readonly MarketStatus[] = ['PILOT', 'ACTIVE'];

/** Products (and commercial offerings) that are switched on per market. Product keys match the entitlement product keys. */
export const MARKET_PRODUCTS = [
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
  'MERCHANT_SUBSCRIPTION',
  'ENTERPRISE_LICENCE',
  'AI_ASSISTANT',
] as const;
export type MarketProduct = (typeof MARKET_PRODUCTS)[number];

export const MARKET_PRODUCT_STATUSES = [
  'DISABLED',
  'CONFIGURING',
  'TESTING',
  'PILOT',
  'ACTIVE',
  'SUSPENDED',
] as const;
export type MarketProductStatus = (typeof MARKET_PRODUCT_STATUSES)[number];
/** Product statuses under which businesses may create new campaigns / exposure (configurable: markets.available_statuses). */
export const MARKET_AVAILABLE_STATUSES: readonly string[] = ['PILOT', 'ACTIVE'];

/** Effective-dated configuration rows follow one approval lifecycle; approved rows are never edited (a new version supersedes them). */
export const MARKET_CONFIG_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RETIRED'] as const;
export type MarketConfigStatus = (typeof MARKET_CONFIG_STATUSES)[number];

// ---------------------------------------------------------------- tax
export const TAX_TYPES = [
  'VAT',
  'GST',
  'SALES_TAX',
  'WITHHOLDING',
  'DIGITAL_SERVICES',
  'OTHER',
] as const;
/**
 * What a tax rule applies to. Every commercial event maps to one taxable item, so a rule can treat subscriptions, licences, fees,
 * commissions and charges differently. `*` in a rule's applicability means every item.
 */
export const TAXABLE_ITEMS = [
  'MERCHANT_SUBSCRIPTION',
  'ENTERPRISE_LICENCE',
  'SETUP_FEE',
  'INTEGRATION_FEE',
  'API_FEE',
  'LIVE_DEAL_PAID_FEATURE',
  'EXCLUSIVE_DEAL_FEE',
  'VOUCHER_COMMISSION',
  'WATCH_CHARGE',
  'LOYALTY_CHARGE',
  'PROMOTIONAL_PLACEMENT',
  'AI_ADDON',
  'ADD_ON',
  'OVERAGE',
  'OTHER',
] as const;
export type TaxableItem = (typeof TAXABLE_ITEMS)[number];

/** Billing event type -> taxable item (the subscription engine's event vocabulary). */
export const TAXABLE_ITEM_OF_EVENT: Record<string, TaxableItem> = {
  MONTHLY_SUBSCRIPTION_RENEWAL: 'MERCHANT_SUBSCRIPTION',
  PLAN_CHANGE_ADJUSTMENT: 'MERCHANT_SUBSCRIPTION',
  ANNUAL_LICENCE_RENEWAL: 'ENTERPRISE_LICENCE',
  LICENCE_ACTIVATION: 'ENTERPRISE_LICENCE',
  SETUP_FEE: 'SETUP_FEE',
  INTEGRATION_FEE: 'INTEGRATION_FEE',
  API_FEE: 'API_FEE',
  ADD_ON_FEE: 'ADD_ON',
  PREMIUM_ANALYTICS_FEE: 'ADD_ON',
  FEATURED_PLACEMENT_FEE: 'PROMOTIONAL_PLACEMENT',
  CAMPAIGN_SETUP_FEE: 'OTHER',
  QUALIFIED_VIEW_USAGE: 'WATCH_CHARGE',
  VERIFIED_REDEMPTION_USAGE: 'EXCLUSIVE_DEAL_FEE',
  OVERAGE_USAGE: 'OVERAGE',
  VOUCHER_TRANSACTION_COMMISSION: 'VOUCHER_COMMISSION',
};
/** Campaign (commercial case) product -> taxable item for quotation fees. */
export const TAXABLE_ITEM_OF_PRODUCT: Record<string, TaxableItem> = {
  EXCLUSIVE: 'EXCLUSIVE_DEAL_FEE',
  WATCH: 'WATCH_CHARGE',
  VOUCHER: 'VOUCHER_COMMISSION',
  LIVE_BENEFIT: 'LIVE_DEAL_PAID_FEATURE',
  LOYALTY: 'LOYALTY_CHARGE',
};
export const ROUNDING_RULES = ['HALF_UP', 'HALF_EVEN', 'DOWN', 'UP'] as const;
export type RoundingRule = (typeof ROUNDING_RULES)[number];

// ---------------------------------------------------------------- invoices
export const INVOICE_CONFIG_KINDS = [
  'TAX_INVOICE',
  'INVOICE',
  'COMMERCIAL_INVOICE',
  'PROFORMA_INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
] as const;
/** Fields an invoice configuration can require before a document is issued. */
export const INVOICE_REQUIRED_FIELDS = [
  'legalName',
  'registeredAddress',
  'taxId',
  'invoiceContactEmail',
  'purchaseOrder',
] as const;
export const VALIDATION_STATES = ['CONFIGURED', 'VALIDATION_REQUIRED', 'VALIDATED'] as const;

// ---------------------------------------------------------------- providers, settlement, policies
export const PROVIDER_CAPABILITIES = [
  'PAYMENT',
  'SMS_OTP',
  'EMAIL',
  'PUSH',
  'VIDEO',
  'STORAGE_CDN',
  'MAPS',
  'E_INVOICING',
  'KYB',
  'IDENTITY',
  'ANALYTICS',
] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];
export const PAYMENT_METHODS = ['CARD', 'WALLET', 'BANK_TRANSFER', 'LOCAL_METHOD'] as const;
export const PROVIDER_ENVIRONMENTS = ['MOCK', 'SANDBOX', 'PRODUCTION'] as const;
export const PROVIDER_STATUSES = [
  'DISABLED',
  'CONFIGURING',
  'TESTING',
  'ACTIVE',
  'SUSPENDED',
] as const;
/** Secrets are never stored in configuration: only references to the secret store / environment. */
export const SECRET_REF_PATTERN = /^(env|secret):[A-Za-z0-9_./-]{2,120}$/;

export const SETTLEMENT_FREQUENCIES = [
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'ON_DEMAND',
] as const;
export const RECONCILIATION_METHODS = [
  'STATEMENT_MATCH',
  'PER_TRANSACTION',
  'BATCH_TOTAL',
] as const;

export const MARKET_POLICY_CATEGORIES = [
  'REFUND_EXPIRY',
  'KYB',
  'PRIVACY_CONSENT',
  'LEGAL_TERMS',
  'SUPPORT',
  'RESTRICTION',
] as const;
export type MarketPolicyCategory = (typeof MARKET_POLICY_CATEGORIES)[number];
/** Policy keys per category (reusable settings; product rules may refine them). */
export const MARKET_POLICY_KEYS: Record<MarketPolicyCategory, readonly string[]> = {
  REFUND_EXPIRY: [
    'CUSTOMER_REFUND',
    'CANCELLATION_WINDOW',
    'PAYMENT_REVERSAL',
    'VOUCHER_REFUND',
    'VOUCHER_EXPIRY',
    'UNUSED_VALUE',
    'EXPIRED_REWARD',
    'LOYALTY_EXPIRY',
    'SETTLEMENT_ADJUSTMENT',
    'DISPUTE_WINDOW',
  ],
  KYB: [
    'COMPANY_REGISTRATION',
    'TAX_DOCUMENTS',
    'AUTHORIZED_SIGNATORY',
    'BENEFICIAL_OWNERSHIP',
    'BANK_ACCOUNT_VERIFICATION',
    'AGREEMENT',
    'SETTLEMENT_DOCUMENTS',
    'PRODUCT_PERMISSIONS',
  ],
  PRIVACY_CONSENT: [
    'PRIVACY_NOTICE',
    'CUSTOMER_CONSENT',
    'MERCHANT_AGREEMENT',
    'MARKETING_CONSENT',
    'AI_CONSENT',
    'DATA_RESIDENCY',
    'RETENTION',
    'AGE_RESTRICTION',
    'TRACKING',
    'LOCATION',
  ],
  LEGAL_TERMS: ['CUSTOMER_TERMS', 'MERCHANT_TERMS', 'PARTNER_TERMS'],
  SUPPORT: ['CUSTOMER_SUPPORT', 'BUSINESS_SUPPORT'],
  RESTRICTION: ['LOCAL_RESTRICTION'],
};

// ---------------------------------------------------------------- validation register and readiness
export const MARKET_VALIDATION_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'RESOLVED',
  'ACCEPTED_RISK',
  'NOT_APPLICABLE',
] as const;
export type MarketValidationStatus = (typeof MARKET_VALIDATION_STATUSES)[number];
/** Validation prefixes per market (VALIDATE-KSA for Saudi Arabia, VALIDATE-<ISO> otherwise). */
export const VALIDATION_PREFIX: Record<string, string> = {
  SA: 'VALIDATE-KSA',
  AE: 'VALIDATE-UAE',
  QA: 'VALIDATE-QATAR',
  PK: 'VALIDATE-PAKISTAN',
};
export const validationPrefixOf = (market: string) =>
  VALIDATION_PREFIX[market] ?? `VALIDATE-${market}`;

export const READINESS_STATES = ['READY', 'NOT_READY', 'BLOCKED', 'VALIDATION_REQUIRED'] as const;
export type ReadinessState = (typeof READINESS_STATES)[number];
export const READINESS_CHECKS = [
  'LEGAL_ENTITY',
  'DEFAULT_CURRENCY',
  'LANGUAGE_TIMEZONE',
  'PRODUCTS',
  'PRICING',
  'TAX',
  'INVOICE',
  'PAYMENT',
  'SETTLEMENT',
  'LEGAL_TERMS',
  'PRIVACY_CONSENT',
  'SUPPORT',
  'KYB',
  'PROVIDERS',
  'VALIDATIONS',
] as const;
export type ReadinessCheck = (typeof READINESS_CHECKS)[number];
export const READINESS_CHECK_STATES = ['OK', 'MISSING', 'VALIDATION_REQUIRED', 'BLOCKED'] as const;
