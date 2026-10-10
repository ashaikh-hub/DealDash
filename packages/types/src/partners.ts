/**
 * Stage 7 — Enterprise Partner Portal vocabulary. The portal is another governed front end on the shared platform: partners are
 * Business Accounts (Organization type PARTNER) with legal entities, markets, contracts, entitlements and scoped roles. Nothing here
 * carries a price, a tax rate or a country rule: those come from the shared commercial, subscription and market configuration.
 */

/** Partner onboarding / readiness lifecycle. ACTIVE needs every mandatory readiness item and a second DealDash approver. */
export const PARTNER_LIFECYCLE = [
  'DRAFT',
  'UNDER_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'CONTRACT_ACTIVE',
  'FINANCE_READY',
  'PRODUCT_ENABLED',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
] as const;
export type PartnerLifecycle = (typeof PARTNER_LIFECYCLE)[number];

/** Allowed lifecycle moves. Who may make each move is decided by the service (partner submits; DealDash reviews and activates). */
export const PARTNER_TRANSITIONS: Record<PartnerLifecycle, readonly PartnerLifecycle[]> = {
  DRAFT: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'],
  CHANGES_REQUESTED: ['UNDER_REVIEW'],
  APPROVED: ['CONTRACT_ACTIVE', 'SUSPENDED'],
  CONTRACT_ACTIVE: ['FINANCE_READY', 'SUSPENDED'],
  FINANCE_READY: ['PRODUCT_ENABLED', 'SUSPENDED'],
  PRODUCT_ENABLED: ['ACTIVE', 'SUSPENDED'],
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
  REJECTED: [],
};
/** Lifecycle states where the partner may create new exposure (campaigns, benefits, sponsorship). */
export const PARTNER_OPERATING_STATES: readonly PartnerLifecycle[] = ['ACTIVE'];
/** Moves that a second DealDash administrator approves (requester never approves). */
export const PARTNER_APPROVAL_REQUIRED: readonly PartnerLifecycle[] = ['ACTIVE'];
/** Which readiness checks must be complete before each lifecycle step. */
export const PARTNER_STEP_REQUIRES: Partial<
  Record<PartnerLifecycle, readonly PartnerReadinessCheck[]>
> = {
  UNDER_REVIEW: ['PROFILE', 'LEGAL_ENTITY', 'MARKETS', 'CONTACTS', 'SIGNATORY'],
  CONTRACT_ACTIVE: ['CONTRACT'],
  FINANCE_READY: ['BILLING_ACCOUNT', 'FUNDING'],
  PRODUCT_ENABLED: ['ENTITLEMENTS'],
};

export const PARTNER_READINESS_CHECKS = [
  'PROFILE',
  'LEGAL_ENTITY',
  'MARKETS',
  'CONTACTS',
  'SIGNATORY',
  'CONTRACT',
  'BILLING_ACCOUNT',
  'FUNDING',
  'ENTITLEMENTS',
  'INTEGRATION',
  'MARKET_VALIDATIONS',
] as const;
export type PartnerReadinessCheck = (typeof PARTNER_READINESS_CHECKS)[number];
export const PARTNER_CHECK_STATES = [
  'OK',
  'MISSING',
  'VALIDATION_REQUIRED',
  'NOT_APPLICABLE',
] as const;
export type PartnerCheckState = (typeof PARTNER_CHECK_STATES)[number];
export const PARTNER_READINESS_STATES = [
  'READY',
  'NOT_READY',
  'VALIDATION_REQUIRED',
  'BLOCKED',
] as const;
export type PartnerReadinessState = (typeof PARTNER_READINESS_STATES)[number];

/** Portal modules. A module is shown only where the partner type profile offers it AND the contract entitles it. */
export const PARTNER_MODULES = [
  'CAMPAIGNS',
  'MERCHANT_NETWORK',
  'OFFERS',
  'ELIGIBILITY',
  'CARD_PROGRAMS',
  'EMPLOYER_PROGRAMS',
  'LIVE_DEAL_BENEFITS',
  'EXCLUSIVE',
  'VOUCHER',
  'WATCH_SPONSORSHIP',
  'LOYALTY',
  'PERFORMANCE',
  'FINANCE',
  'INTEGRATIONS',
  'AI_COPILOT',
] as const;
export type PartnerModule = (typeof PARTNER_MODULES)[number];

/**
 * The contract entitlement a module needs (subscription engine products / features). A module with no entry is part of every
 * partner licence. Market availability is checked separately (MarketService) wherever new exposure is created.
 */
export const PARTNER_MODULE_ENTITLEMENT: Partial<
  Record<PartnerModule, { product?: string; anyFeature?: readonly string[] }>
> = {
  EXCLUSIVE: { product: 'EXCLUSIVE' },
  VOUCHER: { product: 'VOUCHER' },
  LOYALTY: { product: 'LOYALTY' },
  WATCH_SPONSORSHIP: { product: 'LOYALTY' },
  LIVE_DEAL_BENEFITS: { product: 'MEMBER_BENEFIT' },
  CARD_PROGRAMS: { anyFeature: ['CARDHOLDER_ELIGIBILITY', 'ELIGIBILITY_SYNCHRONIZATION'] },
  EMPLOYER_PROGRAMS: { anyFeature: ['EMPLOYEE_PROGRAMS'] },
  INTEGRATIONS: { anyFeature: ['API_ACCESS'] },
  AI_COPILOT: { anyFeature: ['AI_COPILOT'] },
};
/**
 * Contract features that authorise each network ingestion method: at least ONE of `anyOf` (more than one partner licence feature can
 * qualify, e.g. a bank's merchant-network feature or a scheme's ingestion feature) AND every one of `allOf` (the shared platform
 * capability the method runs on: bulk files use BULK_IMPORT, API / feeds use API_ACCESS).
 */
export const PARTNER_INGESTION_FEATURES: Record<
  'MANUAL' | 'BULK' | 'API',
  { anyOf: readonly string[]; allOf: readonly string[] }
> = {
  MANUAL: { anyOf: ['MERCHANT_INGESTION_MANUAL', 'BANK_MERCHANT_NETWORK'], allOf: [] },
  BULK: { anyOf: ['MERCHANT_INGESTION_BULK', 'BANK_MERCHANT_NETWORK'], allOf: ['BULK_IMPORT'] },
  API: {
    anyOf: ['MERCHANT_INGESTION_API', 'NETWORK_INTEGRATION', 'BANK_MERCHANT_NETWORK'],
    allOf: ['API_ACCESS'],
  },
};

/** Merchant onboarding methods into a partner's merchant network (the same ingestion pipeline for all three). */
export const PARTNER_INGESTION_METHODS = ['MANUAL', 'BULK', 'API'] as const;
export type PartnerIngestionMethod = (typeof PARTNER_INGESTION_METHODS)[number];

/** Campaign products a partner can create (creator + commercial owner) at a registered fulfilment merchant of its network. */
export const PARTNER_CREATABLE_PRODUCTS = ['EXCLUSIVE', 'VOUCHER'] as const;
export type PartnerCreatableProduct = (typeof PARTNER_CREATABLE_PRODUCTS)[number];
/** A partner's role on a campaign in its portfolio. */
export const PARTNER_CAMPAIGN_ROLES = [
  'CREATOR',
  'SPONSOR',
  'LOYALTY_FUNDER',
  'BENEFIT_PROVIDER',
] as const;
export type PartnerCampaignRole = (typeof PARTNER_CAMPAIGN_ROLES)[number];

/** A partner-linked additional benefit on an existing (public) Live Deal. Never a redemption; never an Exclusive Deal by itself. */
export const PARTNER_BENEFIT_STATUSES = [
  'PROPOSED',
  'MERCHANT_APPROVED',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'SUSPENDED',
  'ENDED',
] as const;
export type PartnerBenefitStatus = (typeof PARTNER_BENEFIT_STATUSES)[number];
export const PARTNER_BENEFIT_KINDS = [
  'EXTRA_PERCENT',
  'EXTRA_AMOUNT',
  'FREE_ITEM',
  'OTHER',
] as const;
export type PartnerBenefitKind = (typeof PARTNER_BENEFIT_KINDS)[number];

/**
 * Card programme metadata. Only limited BIN / IIN prefixes (6 to 8 digits) with issuer, scheme, product and tier: never a full card
 * number (PAN), never a CVV. A prefix identifies a programme, not a card or a person.
 */
export const BIN_PREFIX_PATTERN = /^\d{6,8}$/;
/** Anything that looks like a full card number (13–19 digits, optionally spaced) is refused wherever text is accepted. */
export const PAN_LIKE_PATTERN = /(?:\d[ -]?){13,19}/;
export const CARD_PROGRAM_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type CardProgramStatus = (typeof CARD_PROGRAM_STATUSES)[number];
/** How a customer's link to a programme / employer is established. VERIFIED states need evidence from the named method. */
export const PARTNER_VERIFICATION_METHODS = [
  'SELF_DECLARED',
  'WORK_EMAIL_OTP',
  'ISSUER_TOKEN',
  'PARTNER_FEED',
] as const;
export type PartnerVerificationMethod = (typeof PARTNER_VERIFICATION_METHODS)[number];

/** Employer / corporate programme: work-email domains used as the verification reference (never a list of employees). */
export const EMPLOYER_PROGRAM_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type EmployerProgramStatus = (typeof EMPLOYER_PROGRAM_STATUSES)[number];

/** Network merchant state as seen by a partner. */
export const NETWORK_MERCHANT_STATES = [
  'REFERENCED',
  'REGISTERED',
  'REGISTERED_ACTIVE',
  'MERGED',
  'CLOSED',
] as const;
export type NetworkMerchantState = (typeof NETWORK_MERCHANT_STATES)[number];
/** What a merchant may do on DealDash. A referenced (network) merchant never gains controlled products automatically. */
export const NETWORK_CAPABILITIES = [
  'DISCOVERY_LISTING',
  'LIVE_DEAL',
  'EXCLUSIVE',
  'VOUCHER',
  'WATCH_REWARD',
  'STAFF_REDEMPTION',
  'SETTLEMENT',
  'FINANCE',
] as const;
export type NetworkCapability = (typeof NETWORK_CAPABILITIES)[number];

/** Drill-down levels of the partner performance view (Phase 4 aggregates, filtered to the partner's own campaigns). */
export const PARTNER_DRILL_LEVELS = [
  'MARKET',
  'LEGAL_ENTITY',
  'MERCHANT',
  'CITY',
  'BRANCH',
  'CAMPAIGN',
] as const;
export type PartnerDrillLevel = (typeof PARTNER_DRILL_LEVELS)[number];

export interface PartnerTypeProfile {
  /** Portal modules this partner type is offered (the contract still decides what is entitled). */
  modules: PartnerModule[];
  /** Eligibility attribute types this partner type may use in rules. */
  eligibilityAttributes: string[];
  /** How merchants enter the partner's network. */
  ingestionMethods: PartnerIngestionMethod[];
  /** Default contract kind expected for this partner type (subscription engine). */
  contractKinds: string[];
  /** Reporting is aggregate unless a contract explicitly allows more (never individual customers by default). */
  reporting: 'AGGREGATE';
}
