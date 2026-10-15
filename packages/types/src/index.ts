/**
 * Shared domain types and catalogues. No runtime dependencies.
 * The API is the source of truth for authorisation; this file is the shared vocabulary.
 */

// ---------------------------------------------------------------- locale
export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const RTL_LOCALES: readonly Locale[] = ['ar'];

/**
 * Languages the CUSTOMER app's interface can be shown in. Content (merchant text, partner names) stays bilingual (`Locale`): a UI
 * language without its own content column reads the English content. Urdu is customer-only; business portals stay EN / AR.
 */
export const UI_LOCALES = ['en', 'ar', 'ur'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
export const RTL_UI_LOCALES: readonly UiLocale[] = ['ar', 'ur'];
/** The content language a UI language reads (Urdu UI reads English content until content has an Urdu column). */
export const contentLocaleOf = (ui: UiLocale): Locale => (ui === 'ar' ? 'ar' : 'en');

/** Bilingual customer-facing text (one row, two languages; never duplicate rows per language). */
export interface BilingualText {
  en: string;
  ar: string;
}

// ---------------------------------------------------------------- audiences (apps)
export const AUDIENCES = ['customer', 'merchant', 'staff', 'partner', 'admin'] as const;
export type Audience = (typeof AUDIENCES)[number];

export type LoginMethod = 'otp' | 'password' | 'password_mfa';

export interface AudienceDefinition {
  audience: Audience;
  /** Cookie name; distinct per audience so apps on one host do not overwrite each other. */
  cookieName: string;
  loginMethod: LoginMethod;
  /** Local development port of the Next.js app. */
  devPort: number;
  label: BilingualText;
}

export const AUDIENCE_DEFINITIONS: Record<Audience, AudienceDefinition> = {
  customer: {
    audience: 'customer',
    cookieName: 'dd_customer',
    loginMethod: 'otp',
    devPort: 3001,
    label: { en: 'Customer', ar: 'العميل' },
  },
  merchant: {
    audience: 'merchant',
    cookieName: 'dd_merchant',
    loginMethod: 'password',
    devPort: 3002,
    label: { en: 'Merchant', ar: 'التاجر' },
  },
  staff: {
    audience: 'staff',
    cookieName: 'dd_staff',
    loginMethod: 'otp',
    devPort: 3003,
    label: { en: 'Staff', ar: 'الموظف' },
  },
  partner: {
    audience: 'partner',
    cookieName: 'dd_partner',
    loginMethod: 'password',
    devPort: 3004,
    label: { en: 'Partner', ar: 'الشريك' },
  },
  admin: {
    audience: 'admin',
    cookieName: 'dd_admin',
    loginMethod: 'password_mfa',
    devPort: 3005,
    label: { en: 'Admin', ar: 'الإدارة' },
  },
};

// ---------------------------------------------------------------- users and organisations
export const USER_TYPES = ['CUSTOMER', 'MERCHANT_USER', 'PARTNER_USER', 'ADMIN_USER'] as const;
export type UserType = (typeof USER_TYPES)[number];

export const USER_STATUSES = ['ACTIVE', 'INVITED', 'SUSPENDED', 'CLOSED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ORGANIZATION_TYPES = ['DEALDASH', 'MERCHANT', 'PARTNER'] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

/**
 * Partner types (configurable behaviour comes from the `partners.typeProfiles` configuration, never from a named partner).
 * SCHEME is the stored code of a CARD SCHEME (Visa, Mastercard, Amex, other approved schemes); EMPLOYER and CORPORATE are both
 * employer / company programmes.
 */
export const PARTNER_TYPES = [
  'BANK',
  'SCHEME',
  'EMPLOYER',
  'FINANCIAL_INSTITUTION',
  'CORPORATE',
  'STRATEGIC_PARTNER',
  'OTHER_APPROVED_PARTNER',
] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const ORGANIZATION_STATUSES = ['DRAFT', 'ACTIVE', 'SUSPENDED'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

// ---------------------------------------------------------------- roles
export const ROLE_SCOPES = ['CUSTOMER', 'MERCHANT', 'PARTNER', 'DEALDASH'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

export const ROLE_CODES = [
  'CUSTOMER',
  'MERCHANT_OWNER',
  'MERCHANT_ADMIN',
  'MERCHANT_FINANCE',
  'MERCHANT_CAMPAIGN_MANAGER',
  'MERCHANT_STAFF',
  'PARTNER_ADMIN',
  'PARTNER_CAMPAIGN_MANAGER',
  'PARTNER_BENEFITS_MANAGER',
  'PARTNER_ANALYST',
  'PARTNER_FINANCE_VIEWER',
  'PARTNER_READ_ONLY',
  // Stage 7: partner finance users, approval users, integration / API users and merchant network managers
  'PARTNER_FINANCE_MANAGER',
  'PARTNER_APPROVER',
  'PARTNER_INTEGRATION_MANAGER',
  'PARTNER_NETWORK_MANAGER',
  'DEALDASH_SUPER_ADMIN',
  'DEALDASH_OPERATIONS',
  'DEALDASH_MERCHANT_MANAGEMENT',
  'DEALDASH_PARTNER_MANAGEMENT',
  'DEALDASH_SUPPORT',
  'DEALDASH_FINANCE',
  'DEALDASH_RISK_COMPLIANCE',
  'DEALDASH_MARKETING_OPS',
  'DEALDASH_ANALYST',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLE_SCOPE_BY_CODE: Record<RoleCode, RoleScope> = {
  CUSTOMER: 'CUSTOMER',
  MERCHANT_OWNER: 'MERCHANT',
  MERCHANT_ADMIN: 'MERCHANT',
  MERCHANT_FINANCE: 'MERCHANT',
  MERCHANT_CAMPAIGN_MANAGER: 'MERCHANT',
  MERCHANT_STAFF: 'MERCHANT',
  PARTNER_ADMIN: 'PARTNER',
  PARTNER_CAMPAIGN_MANAGER: 'PARTNER',
  PARTNER_BENEFITS_MANAGER: 'PARTNER',
  PARTNER_ANALYST: 'PARTNER',
  PARTNER_FINANCE_VIEWER: 'PARTNER',
  PARTNER_READ_ONLY: 'PARTNER',
  PARTNER_FINANCE_MANAGER: 'PARTNER',
  PARTNER_APPROVER: 'PARTNER',
  PARTNER_INTEGRATION_MANAGER: 'PARTNER',
  PARTNER_NETWORK_MANAGER: 'PARTNER',
  DEALDASH_SUPER_ADMIN: 'DEALDASH',
  DEALDASH_OPERATIONS: 'DEALDASH',
  DEALDASH_MERCHANT_MANAGEMENT: 'DEALDASH',
  DEALDASH_PARTNER_MANAGEMENT: 'DEALDASH',
  DEALDASH_SUPPORT: 'DEALDASH',
  DEALDASH_FINANCE: 'DEALDASH',
  DEALDASH_RISK_COMPLIANCE: 'DEALDASH',
  DEALDASH_MARKETING_OPS: 'DEALDASH',
  DEALDASH_ANALYST: 'DEALDASH',
};

/** Which organisation type a role may be assigned within. */
export const ORG_TYPE_BY_ROLE_SCOPE: Record<RoleScope, OrganizationType | null> = {
  CUSTOMER: null,
  MERCHANT: 'MERCHANT',
  PARTNER: 'PARTNER',
  DEALDASH: 'DEALDASH',
};

// ---------------------------------------------------------------- permissions
export const PERMISSION_CODES = [
  // customer
  'customer.profile.read',
  'customer.profile.write',
  'customer.saved.manage',
  'customer.reservations.manage',
  // Stage 5: buy vouchers, pay, see My Vouchers, request refunds
  'customer.vouchers.manage',
  // Stage 6: watch campaigns, earn and redeem rewards
  'customer.rewards.manage',
  // merchant
  'merchant.profile.read',
  'merchant.profile.write',
  'merchant.branch.read',
  'merchant.branch.manage',
  'merchant.staff.read',
  'merchant.staff.manage',
  'merchant.users.manage',
  'merchant.deals.read',
  'merchant.deals.manage',
  'merchant.vouchers.manage',
  'merchant.watch.manage',
  // Stage 6: read campaigns, funding and analytics without editing content (Finance)
  'merchant.watch.read',
  'merchant.redemptions.read',
  'merchant.redemptions.perform',
  'merchant.redemptions.reverse',
  'merchant.insights.read',
  'merchant.finance.read',
  'merchant.finance.manage',
  'merchant.support.manage',
  'merchant.application.manage',
  'merchant.agreement.sign',
  // partner
  'partner.profile.read',
  'partner.profile.write',
  'partner.users.manage',
  'partner.campaigns.read',
  'partner.campaigns.manage',
  'partner.eligibility.read',
  'partner.eligibility.manage',
  'partner.merchants.read',
  'partner.reports.read',
  'partner.reports.export',
  'partner.finance.read',
  'partner.support.manage',
  'partner.activity.read',
  // dealdash internal
  'admin.org.read',
  'admin.org.manage',
  'admin.merchants.review',
  'admin.merchants.manage',
  'admin.partners.review',
  'admin.customers.read',
  'admin.customers.manage',
  'admin.campaigns.review',
  'admin.payments.read',
  'admin.refunds.manage',
  'admin.settlements.manage',
  'admin.rewards.manage',
  'admin.risk.manage',
  'admin.support.manage',
  'admin.content.manage',
  'admin.reports.read',
  'admin.users.manage',
  'admin.roles.manage',
  'admin.config.read',
  'admin.config.manage',
  'admin.audit.read',
  'admin.jobs.manage',
  // Stage 3: pause/suspend/reinstate live campaigns (review decisions use admin.campaigns.review)
  'admin.campaigns.control',
  // Stage 4: review/lift reservation restrictions, cancel reservations, look up and reverse redemptions
  'admin.reservations.manage',
  // Stage 5: look up orders, payments, refunds, redemptions and merchant payable (support context is redacted)
  'admin.vouchers.lookup',
  // Stage 6: Watch & Earn monitor, rewards read-only (Finance), reward adjustment requests (Support)
  'admin.watch.read',
  'admin.rewards.read',
  'admin.rewards.request',
  // Commercial governance and finance (shared by Vouchers, Watch & Earn and Exclusive Deals)
  'merchant.commercial.read',
  'merchant.commercial.prepare',
  'merchant.commercial.accept',
  'merchant.commercial.approve_internal',
  'merchant.commercial.approve_finance',
  'admin.finance.read',
  'admin.finance.manage',
  'admin.finance.pricing.manage',
  'admin.finance.credit.manage',
  'admin.finance.credit.approve',
  // Shared platform: organization structure, scoped access, contracts and markets
  'merchant.structure.read',
  'merchant.structure.manage',
  'merchant.access.manage',
  'partner.structure.read',
  'partner.structure.manage',
  'partner.access.manage',
  'admin.platform.read',
  'admin.platform.manage',
  'admin.contracts.manage',
  // Phase 2: master data, imports, integrations
  'admin.master.read',
  'admin.master.manage',
  'admin.imports.manage',
  'admin.integrations.manage',
  'merchant.imports.manage',
  'merchant.integrations.manage',
  'partner.imports.manage',
  'partner.integrations.manage',
  // Phase 3: loyalty, disputes, activity history
  'admin.loyalty.read',
  'admin.loyalty.manage',
  'admin.loyalty.approve',
  'merchant.loyalty.manage',
  'partner.loyalty.manage',
  'admin.disputes.read',
  'admin.disputes.manage',
  'merchant.disputes.manage',
  'partner.disputes.manage',
  'merchant.activity.read',
  'admin.conflicts.manage',
  // Subscription, licensing and commercial plan engine
  'admin.subscriptions.read',
  'admin.subscriptions.manage',
  'admin.subscriptions.approve',
  'merchant.subscription.read',
  'merchant.subscription.manage',
  'partner.subscription.read',
  'partner.subscription.manage',
  // Phase 4: visibility, targets, alerts, operations
  'merchant.performance.read',
  'merchant.targets.manage',
  'merchant.alerts.manage',
  'partner.performance.read',
  'partner.targets.manage',
  'partner.alerts.manage',
  'admin.analytics.read',
  'admin.alerts.manage',
  'admin.operations.read',
  // Phase 5: billing and finance (second finance person for issuing above threshold, FX rates, write-off)
  'admin.finance.approve',
  'partner.finance.manage',
  // Phase 5: governed AI agents (approving an AI draft also needs the underlying permission of the action)
  'customer.ai.use',
  'merchant.ai.use',
  'merchant.ai.approve',
  'partner.ai.use',
  'partner.ai.approve',
  'admin.ai.use',
  'admin.ai.manage',
  // Market / country configuration (pre-Stage-7 hardening)
  'admin.markets.read',
  'admin.markets.manage',
  'admin.markets.approve',
  // Stage 7: partner portal (commercial acceptance and approvals by the partner itself, merchant network, partner onboarding)
  'partner.commercial.read',
  'partner.commercial.accept',
  'partner.commercial.approve_internal',
  'partner.commercial.approve_finance',
  'partner.network.manage',
  'admin.partners.manage',
  'admin.partners.approve',
  // Stage 8: operational gap closure (restrictions / holds with a second approver, reconciliation exceptions, notification
  // operations, privacy data requests, customer reviews)
  'admin.restrictions.manage',
  'admin.restrictions.approve',
  'admin.reconciliation.manage',
  'admin.notifications.manage',
  'admin.privacy.manage',
  'admin.privacy.approve',
  'customer.reviews.manage',
  // Stage 9: emergency launch controls (market stops) - immediate, audited, reason required
  'admin.launch.control',
] as const;
export type PermissionCode = (typeof PERMISSION_CODES)[number];

const p = (prefix: string): PermissionCode[] =>
  PERMISSION_CODES.filter((c) => c.startsWith(prefix));

/**
 * Role -> permission matrix (foundation). Derived from the frozen role models; the API seeds this into
 * the database and enforces it at the backend. UI uses the resolved permission list for navigation only.
 */
export const ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[]> = {
  CUSTOMER: [
    'customer.profile.read',
    'customer.profile.write',
    'customer.saved.manage',
    'customer.reservations.manage',
    'customer.vouchers.manage',
    'customer.rewards.manage',
    'customer.ai.use',
    // Stage 8: write and report reviews (signed-in customers only, FDC-05)
    'customer.reviews.manage',
  ],

  MERCHANT_OWNER: p('merchant.'),
  // The applicant/signatory (Owner) manages the application and signs the agreement; Admin cannot.
  MERCHANT_ADMIN: p('merchant.').filter(
    (c) =>
      c !== 'merchant.finance.manage' &&
      c !== 'merchant.finance.read' &&
      c !== 'merchant.commercial.approve_finance' &&
      c !== 'merchant.application.manage' &&
      c !== 'merchant.agreement.sign',
  ),
  MERCHANT_FINANCE: [
    'merchant.profile.read',
    'merchant.branch.read',
    'merchant.finance.read',
    'merchant.finance.manage',
    'merchant.watch.read',
    'merchant.redemptions.read',
    'merchant.insights.read',
    'merchant.support.manage',
    'merchant.commercial.read',
    'merchant.commercial.approve_finance',
    'merchant.subscription.read',
    'merchant.performance.read',
    'merchant.ai.use',
  ],
  MERCHANT_CAMPAIGN_MANAGER: [
    'merchant.commercial.read',
    'merchant.commercial.prepare',
    'merchant.profile.read',
    'merchant.branch.read',
    'merchant.deals.read',
    'merchant.deals.manage',
    'merchant.vouchers.manage',
    'merchant.watch.manage',
    'merchant.watch.read',
    'merchant.redemptions.read',
    'merchant.insights.read',
    'merchant.performance.read',
    'merchant.targets.manage',
    'merchant.alerts.manage',
    'merchant.ai.use',
  ],
  MERCHANT_STAFF: [
    'merchant.branch.read',
    'merchant.redemptions.perform',
    'merchant.redemptions.read',
  ],

  PARTNER_ADMIN: p('partner.'),
  PARTNER_CAMPAIGN_MANAGER: [
    'partner.profile.read',
    'partner.campaigns.read',
    'partner.campaigns.manage',
    'partner.eligibility.read',
    'partner.merchants.read',
    'partner.reports.read',
    'partner.support.manage',
    'partner.performance.read',
    'partner.targets.manage',
    'partner.alerts.manage',
    'partner.ai.use',
    // Stage 7: sees the commercial terms of its campaigns and runs partner-funded loyalty
    'partner.commercial.read',
    'partner.loyalty.manage',
  ],
  PARTNER_BENEFITS_MANAGER: [
    'partner.profile.read',
    'partner.campaigns.read',
    'partner.eligibility.read',
    'partner.eligibility.manage',
    'partner.merchants.read',
    'partner.reports.read',
    'partner.support.manage',
    'partner.performance.read',
  ],
  PARTNER_ANALYST: [
    'partner.profile.read',
    'partner.campaigns.read',
    'partner.eligibility.read',
    'partner.merchants.read',
    'partner.reports.read',
    'partner.reports.export',
    'partner.performance.read',
  ],
  PARTNER_FINANCE_VIEWER: [
    'partner.profile.read',
    'partner.campaigns.read',
    'partner.finance.read',
    'partner.reports.read',
    'partner.performance.read',
    'partner.commercial.read',
    'partner.subscription.read',
  ],
  PARTNER_READ_ONLY: [
    'partner.profile.read',
    'partner.campaigns.read',
    'partner.eligibility.read',
    'partner.merchants.read',
    'partner.reports.read',
  ],
  PARTNER_FINANCE_MANAGER: [
    'partner.profile.read',
    'partner.campaigns.read',
    'partner.finance.read',
    'partner.finance.manage',
    'partner.commercial.read',
    'partner.commercial.accept',
    'partner.commercial.approve_finance',
    'partner.subscription.read',
    'partner.reports.read',
    'partner.reports.export',
    'partner.performance.read',
    'partner.alerts.manage',
    'partner.disputes.manage',
  ],
  // the second person of the partner's own maker-checker (never the person who accepted the quotation)
  PARTNER_APPROVER: [
    'partner.profile.read',
    'partner.campaigns.read',
    'partner.eligibility.read',
    'partner.merchants.read',
    'partner.commercial.read',
    'partner.commercial.approve_internal',
    'partner.reports.read',
    'partner.performance.read',
  ],
  PARTNER_INTEGRATION_MANAGER: [
    'partner.profile.read',
    'partner.merchants.read',
    'partner.imports.manage',
    'partner.integrations.manage',
    'partner.activity.read',
  ],
  PARTNER_NETWORK_MANAGER: [
    'partner.profile.read',
    'partner.campaigns.read',
    'partner.eligibility.read',
    'partner.merchants.read',
    'partner.network.manage',
    'partner.imports.manage',
    'partner.reports.read',
  ],

  DEALDASH_SUPER_ADMIN: p('admin.'),
  DEALDASH_OPERATIONS: [
    'admin.markets.read',
    'admin.org.read',
    'admin.merchants.review',
    'admin.partners.review',
    'admin.campaigns.review',
    'admin.campaigns.control',
    'admin.reservations.manage',
    'admin.vouchers.lookup',
    'admin.watch.read',
    'admin.customers.read',
    'admin.support.manage',
    'admin.reports.read',
    'admin.finance.read',
    'admin.platform.read',
    'admin.master.read',
    'admin.loyalty.read',
    'admin.loyalty.manage',
    'admin.subscriptions.read',
    'admin.subscriptions.manage',
    'admin.disputes.read',
    'admin.analytics.read',
    'admin.alerts.manage',
    'admin.operations.read',
    'admin.ai.use',
    // Stage 8: works operational cases, requests holds / restrictions (a second person approves), runs notification operations
    'admin.disputes.manage',
    'admin.restrictions.manage',
    'admin.notifications.manage',
    // Stage 9: may pull an emergency market stop (immediate, audited, reason required)
    'admin.launch.control',
  ],
  DEALDASH_MERCHANT_MANAGEMENT: [
    'admin.markets.read',
    'admin.analytics.read',
    'admin.ai.use',
    'admin.disputes.read',
    'admin.disputes.manage',
    'admin.conflicts.manage',
    'admin.subscriptions.read',
    'admin.master.read',
    'admin.master.manage',
    'admin.imports.manage',
    'admin.org.read',
    'admin.org.manage',
    'admin.merchants.review',
    'admin.merchants.manage',
    'admin.campaigns.review',
    'admin.campaigns.control',
    'admin.watch.read',
    'admin.reservations.manage',
    'admin.support.manage',
  ],
  DEALDASH_PARTNER_MANAGEMENT: [
    // Stage 7: creates partners, reviews onboarding, approves activation (a different person from the requester)
    'admin.partners.manage',
    'admin.partners.approve',
    'admin.platform.read',
    'admin.subscriptions.read',
    'admin.finance.read',
    'admin.markets.read',
    'admin.analytics.read',
    'admin.operations.read',
    'admin.master.read',
    'admin.integrations.manage',
    'admin.imports.manage',
    'admin.org.read',
    'admin.org.manage',
    'admin.partners.review',
    'admin.support.manage',
  ],
  DEALDASH_SUPPORT: [
    'admin.org.read',
    'admin.customers.read',
    'admin.support.manage',
    'admin.reservations.manage',
    'admin.vouchers.lookup',
    'admin.rewards.request',
    'admin.operations.read',
    'admin.ai.use',
    // Stage 8: customer complaints and support cases on the shared case framework; privacy data requests (a second person approves)
    'admin.disputes.read',
    'admin.disputes.manage',
    'admin.privacy.manage',
  ],
  DEALDASH_FINANCE: [
    'admin.analytics.read',
    'admin.operations.read',
    'admin.finance.approve',
    'admin.ai.use',
    'admin.org.read',
    'admin.vouchers.lookup',
    'admin.payments.read',
    'admin.refunds.manage',
    'admin.settlements.manage',
    'admin.watch.read',
    'admin.rewards.read',
    'admin.reports.read',
    'admin.finance.read',
    'admin.finance.manage',
    'admin.finance.pricing.manage',
    'admin.finance.credit.manage',
    'admin.finance.credit.approve',
    'admin.platform.read',
    'admin.loyalty.read',
    'admin.loyalty.approve',
    'admin.subscriptions.read',
    'admin.subscriptions.manage',
    'admin.subscriptions.approve',
    'admin.disputes.read',
    'admin.disputes.manage',
    // tax, invoice and settlement configuration per market (a second person approves)
    'admin.markets.read',
    'admin.markets.manage',
    'admin.markets.approve',
    // Stage 8: reconciliation exception workflow
    'admin.reconciliation.manage',
  ],
  DEALDASH_RISK_COMPLIANCE: [
    'admin.markets.read',
    'admin.org.read',
    'admin.customers.read',
    'admin.merchants.review',
    'admin.campaigns.control',
    'admin.risk.manage',
    'admin.rewards.manage',
    'admin.rewards.request',
    'admin.rewards.read',
    'admin.watch.read',
    'admin.audit.read',
    'admin.config.read',
    'admin.analytics.read',
    'admin.operations.read',
    // Stage 8: fraud cases, restrictions / holds (requests and the second-person approval), privacy approvals
    'admin.disputes.read',
    'admin.disputes.manage',
    'admin.restrictions.manage',
    'admin.restrictions.approve',
    'admin.privacy.approve',
  ],
  DEALDASH_MARKETING_OPS: [
    'admin.org.read',
    'admin.campaigns.review',
    'admin.watch.read',
    'admin.content.manage',
    'admin.reports.read',
    'admin.analytics.read',
  ],
  DEALDASH_ANALYST: ['admin.org.read', 'admin.reports.read', 'admin.analytics.read'],
};

// ---------------------------------------------------------------- API contracts shared by clients
export interface ApiErrorItem {
  code: string;
  message: string;
  field?: string;
}

export interface ApiMeta {
  requestId?: string;
  locale?: Locale;
  nextCursor?: string | null;
}

export interface ApiEnvelope<T> {
  data: T;
  meta: ApiMeta;
}

export const ERROR_CODES = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTH_INVALID: 'AUTH_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_LOCKED: 'OTP_LOCKED',
  OTP_RATE_LIMITED: 'OTP_RATE_LIMITED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_INVALID: 'MFA_INVALID',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_STATE: 'INVALID_STATE',
  APPLICATION_INCOMPLETE: 'APPLICATION_INCOMPLETE',
  APPLICATION_LOCKED: 'APPLICATION_LOCKED',
  FILE_INVALID: 'FILE_INVALID',
  SIGNATORY_ONLY: 'SIGNATORY_ONLY',
  SECOND_REVIEW_REQUIRED: 'SECOND_REVIEW_REQUIRED',
  LAST_OWNER: 'LAST_OWNER',
  ORG_NOT_ACTIVE: 'ORG_NOT_ACTIVE',
  LAST_ACTIVE_BRANCH: 'LAST_ACTIVE_BRANCH',
  DEAL_INCOMPLETE: 'DEAL_INCOMPLETE',
  EDIT_LOCKED: 'EDIT_LOCKED',
  CONTROLLED_NOT_ENABLED: 'CONTROLLED_NOT_ENABLED',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  LIMIT_REACHED: 'LIMIT_REACHED',
  TOO_MANY_ACTIVE: 'TOO_MANY_ACTIVE',
  RESERVATIONS_PAUSED: 'RESERVATIONS_PAUSED',
  OFFER_UNAVAILABLE: 'OFFER_UNAVAILABLE',
  BRANCH_CLOSED: 'BRANCH_CLOSED',
  RESERVATION_NOT_CANCELLABLE: 'RESERVATION_NOT_CANCELLABLE',
  // reservation commitment model (2026-10-15): FREE not allowed by the policy / the payment step is not available yet (phase 2)
  RESERVATION_METHOD_REQUIRED: 'RESERVATION_METHOD_REQUIRED',
  RESERVATION_PAYMENT_UNAVAILABLE: 'RESERVATION_PAYMENT_UNAVAILABLE',
  INVENTORY_BELOW_COMMITTED: 'INVENTORY_BELOW_COMMITTED',
  MATERIAL_EDIT_LOCKED: 'MATERIAL_EDIT_LOCKED',
  REVERSAL_NOT_ALLOWED: 'REVERSAL_NOT_ALLOWED',
  // Stage 5: vouchers, payments, refunds
  PAYMENT_RETRY_LIMIT: 'PAYMENT_RETRY_LIMIT',
  ORDER_NOT_PAYABLE: 'ORDER_NOT_PAYABLE',
  REFUND_NOT_AVAILABLE: 'REFUND_NOT_AVAILABLE',
  REFUND_WINDOW_PASSED: 'REFUND_WINDOW_PASSED',
  REFUND_ALREADY_OPEN: 'REFUND_ALREADY_OPEN',
  REDEMPTION_REVERSAL_REQUIRED: 'REDEMPTION_REVERSAL_REQUIRED',
  CHECKER_REQUIRED: 'CHECKER_REQUIRED',
  // Stage 6
  VIEW_NOT_ALLOWED: 'VIEW_NOT_ALLOWED',
  FUNDING_REQUIRED: 'FUNDING_REQUIRED',
  REWARD_INSUFFICIENT: 'REWARD_INSUFFICIENT',
  REWARD_OUT_OF_STOCK: 'REWARD_OUT_OF_STOCK',
  CAMPAIGN_NOT_AVAILABLE: 'CAMPAIGN_NOT_AVAILABLE',
  // Commercial governance
  ACTIVATION_BLOCKED: 'ACTIVATION_BLOCKED',
  COMMERCIAL_ACCEPTANCE_REQUIRED: 'COMMERCIAL_ACCEPTANCE_REQUIRED',
  COMMERCIAL_AMENDMENT_REQUIRED: 'COMMERCIAL_AMENDMENT_REQUIRED',
  CREDIT_LIMIT_EXCEEDED: 'CREDIT_LIMIT_EXCEEDED',
  FINANCIAL_HOLD: 'FINANCIAL_HOLD',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  ENTITLEMENT_REQUIRED: 'ENTITLEMENT_REQUIRED',
  ENTITLEMENT_LIMIT_REACHED: 'ENTITLEMENT_LIMIT_REACHED',
  SCOPE_FORBIDDEN: 'SCOPE_FORBIDDEN',
  LOYALTY_RULE_INVALID: 'LOYALTY_RULE_INVALID',
  INTEGRATION_AUTH_FAILED: 'INTEGRATION_AUTH_FAILED',
  IMPORT_NOT_READY: 'IMPORT_NOT_READY',
  COMMERCIAL_SUSPENDED: 'COMMERCIAL_SUSPENDED',
  CONTRACT_ENDED: 'CONTRACT_ENDED',
  PLAN_NOT_AVAILABLE: 'PLAN_NOT_AVAILABLE',
  DOWNGRADE_BLOCKED: 'DOWNGRADE_BLOCKED',
  AMENDMENT_INVALID: 'AMENDMENT_INVALID',
  PRICING_NOT_AVAILABLE: 'PRICING_NOT_AVAILABLE',
  // Phase 4 / Phase 5 / AI
  ALERT_RULE_INVALID: 'ALERT_RULE_INVALID',
  TARGET_INVALID: 'TARGET_INVALID',
  DOCUMENT_IMMUTABLE: 'DOCUMENT_IMMUTABLE',
  PO_REQUIRED: 'PO_REQUIRED',
  PO_INSUFFICIENT: 'PO_INSUFFICIENT',
  FX_RATE_REQUIRED: 'FX_RATE_REQUIRED',
  QUOTATION_EXPIRED: 'QUOTATION_EXPIRED',
  OVERPAYMENT: 'OVERPAYMENT',
  AI_NOT_ENTITLED: 'AI_NOT_ENTITLED',
  AI_AUTONOMY_EXCEEDED: 'AI_AUTONOMY_EXCEEDED',
  AI_APPROVAL_REQUIRED: 'AI_APPROVAL_REQUIRED',
  AI_TOOL_DENIED: 'AI_TOOL_DENIED',
  MARKET_PRODUCT_UNAVAILABLE: 'MARKET_PRODUCT_UNAVAILABLE',
  MARKET_NOT_READY: 'MARKET_NOT_READY',
  MARKET_TRANSITION_INVALID: 'MARKET_TRANSITION_INVALID',
  MARKET_CONFIG_INVALID: 'MARKET_CONFIG_INVALID',
  MARKET_CURRENCY_NOT_SUPPORTED: 'MARKET_CURRENCY_NOT_SUPPORTED',
  INVOICE_REQUIRED_FIELDS_MISSING: 'INVOICE_REQUIRED_FIELDS_MISSING',
  // Stage 7: partner portal
  PARTNER_NOT_READY: 'PARTNER_NOT_READY',
  PARTNER_TRANSITION_INVALID: 'PARTNER_TRANSITION_INVALID',
  PARTNER_NOT_ACTIVE: 'PARTNER_NOT_ACTIVE',
  PARTNER_CAPABILITY_UNAVAILABLE: 'PARTNER_CAPABILITY_UNAVAILABLE',
  PARTNER_MARKET_NOT_AUTHORIZED: 'PARTNER_MARKET_NOT_AUTHORIZED',
  PARTNER_MERCHANT_NOT_IN_NETWORK: 'PARTNER_MERCHANT_NOT_IN_NETWORK',
  PARTNER_MERCHANT_NOT_REGISTERED: 'PARTNER_MERCHANT_NOT_REGISTERED',
  DELEGATION_EXCEEDED: 'DELEGATION_EXCEEDED',
  CARD_DATA_FORBIDDEN: 'CARD_DATA_FORBIDDEN',
  // Stage 8: operations
  CASE_TRANSITION_INVALID: 'CASE_TRANSITION_INVALID',
  CASE_APPROVAL_PENDING: 'CASE_APPROVAL_PENDING',
  SETTLEMENT_RULE_MISSING: 'SETTLEMENT_RULE_MISSING',
  SETTLEMENT_ON_HOLD: 'SETTLEMENT_ON_HOLD',
  RESTRICTION_ACTIVE: 'RESTRICTION_ACTIVE',
  BRANCH_REDEMPTION_HELD: 'BRANCH_REDEMPTION_HELD',
  REVIEW_NOT_ALLOWED: 'REVIEW_NOT_ALLOWED',
  REVIEW_LIMIT_REACHED: 'REVIEW_LIMIT_REACHED',
  RECON_INVALID: 'RECON_INVALID',
  ADJUSTMENT_NOT_APPLICABLE: 'ADJUSTMENT_NOT_APPLICABLE',
  // Stage 9: launch controls and governed configuration
  PILOT_NOT_ENABLED: 'PILOT_NOT_ENABLED',
  LAUNCH_PAUSED: 'LAUNCH_PAUSED',
  CONFIG_CHANGE_STALE: 'CONFIG_CHANGE_STALE',
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  LEGAL_HOLD_ACTIVE: 'LEGAL_HOLD_ACTIVE',
  // launch readiness: money in one currency is never priced, funded or moved with another's (no silent conversion)
  MARKET_CURRENCY_MISMATCH: 'MARKET_CURRENCY_MISMATCH',
  // My benefits (customer eligibility: employer work email, added cards)
  BENEFIT_EMAIL_DOMAIN: 'BENEFIT_EMAIL_DOMAIN',
  BENEFIT_EMAIL_NOT_ALLOWED: 'BENEFIT_EMAIL_NOT_ALLOWED',
  BENEFIT_EMAIL_IN_USE: 'BENEFIT_EMAIL_IN_USE',
  BENEFIT_PROGRAM_UNAVAILABLE: 'BENEFIT_PROGRAM_UNAVAILABLE',
  BENEFIT_CARD_LIMIT: 'BENEFIT_CARD_LIMIT',
  /** Customer account: the profile set-up (age check, Terms and Privacy) must be finished before this action. */
  ONBOARDING_REQUIRED: 'ONBOARDING_REQUIRED',
  /** Customer account: Terms / Privacy changed and must be accepted again. */
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  /** Customer account: under the minimum age (AU-31); the account cannot be used. */
  AGE_RESTRICTED: 'AGE_RESTRICTED',
  PROFILE_DOB_LOCKED: 'PROFILE_DOB_LOCKED',
  MOBILE_IN_USE: 'MOBILE_IN_USE',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Money is always integer halalas. */
export interface Money {
  amount: number;
  currency: 'SAR';
}

// ---------------------------------------------------------------- audit and jobs vocabulary
export const AUDIT_ACTIONS = [
  'auth.otp.requested',
  'auth.login.succeeded',
  'auth.login.failed',
  'auth.logout',
  'auth.mfa.verified',
  'auth.mfa.failed',
  'rbac.membership.created',
  'rbac.membership.revoked',
  'organization.created',
  'organization.updated',
  'merchant.branch.created',
  'merchant.branch.updated',
  'config.updated',
  'job.enqueued',
  'job.failed',
  'access.denied',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number] | (string & {});

export const JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

// ---------------------------------------------------------------- resolved identity returned to clients
export interface MembershipView {
  organizationId: string;
  organizationType: OrganizationType;
  organizationName: BilingualText;
  organizationStatus: OrganizationStatus;
  roleCode: RoleCode;
  branchId: string | null;
}

export interface MeView {
  id: string;
  userType: UserType;
  displayName: string;
  locale: Locale;
  audience: Audience;
  mfaVerified: boolean;
  mfaRequired: boolean;
  activeMembership: MembershipView | null;
  memberships: MembershipView[];
  permissions: PermissionCode[];
}

// ================================================================ Stage 2: merchant onboarding and review
export const APPLICATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'RESUBMITTED',
  'APPROVED',
  'REJECTED',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Statuses in which the applicant may edit the application. */
export const APPLICATION_EDITABLE: readonly ApplicationStatus[] = ['DRAFT', 'CHANGES_REQUESTED'];
/** Statuses that appear in the Admin review queue. */
export const APPLICATION_IN_QUEUE: readonly ApplicationStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'RESUBMITTED',
];

export const TRUST_LEVELS = ['NEW', 'STANDARD', 'TRUSTED'] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const RISK_TIERS = ['STANDARD', 'ENHANCED'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export const DOCUMENT_STATUSES = ['UPLOADED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Application sections (wizard steps) that a reviewer can flag when requesting changes. */
export const APPLICATION_SECTIONS = [
  'BUSINESS',
  'DOCUMENTS',
  'REPRESENTATIVE',
  'CATEGORY',
  'BRANCHES',
  'SETTLEMENT',
  'AGREEMENT',
] as const;
export type ApplicationSection = (typeof APPLICATION_SECTIONS)[number];

export const FILE_KINDS = [
  'DOCUMENT',
  'LOGO',
  'COVER',
  'GALLERY',
  'DEAL_IMAGE',
  // Stage 6: Watch & Earn campaign video (MP4 or WebM)
  'WATCH_VIDEO',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const AGREEMENT_STATUSES = ['ACCEPTED', 'SUPERSEDED', 'REVOKED'] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Roles a merchant Owner/Admin may invite (Owner can only be created by DealDash/ownership transfer). */
export const MERCHANT_INVITABLE_ROLES = [
  'MERCHANT_ADMIN',
  'MERCHANT_FINANCE',
  'MERCHANT_CAMPAIGN_MANAGER',
  'MERCHANT_STAFF',
] as const;

/**
 * Merchant permissions available while the organisation is NOT yet active (onboarding) or when it is suspended.
 * (MR-05: before activation there are no campaigns, staff invites or settlement features; suspended merchants are blocked.)
 */
export const MERCHANT_INACTIVE_ALLOWED: readonly PermissionCode[] = [
  'merchant.profile.read',
  'merchant.profile.write',
  'merchant.branch.read',
  'merchant.branch.manage',
  'merchant.application.manage',
  'merchant.agreement.sign',
  'merchant.support.manage',
];
export const MERCHANT_SUSPENDED_ALLOWED: readonly PermissionCode[] = [
  'merchant.profile.read',
  'merchant.support.manage',
];

export * from './deals';
export * from './hot-deals';
export * from './vouchers';
export * from './watch';
export * from './commercial';
export * from './platform';
export * from './subscription';
export * from './visibility';
export * from './billing';
export * from './ai';
export * from './markets';
export * from './partners';
export * from './operations';
export * from './web-security';
