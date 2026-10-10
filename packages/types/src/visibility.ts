/**
 * Phase 4: visibility and operations vocabulary. One governed analytics taxonomy for every product, metrics, targets, alerts and
 * operations health. Honesty rules are part of the vocabulary: an engagement is never an outcome (a click is not a sale, directions are
 * not a visit, a credential issued is not a redemption), and client-reported events are never "verified".
 */

export const ANALYTICS_PRODUCTS = [
  'LIVE',
  'EXCLUSIVE',
  'VOUCHER',
  'WATCH',
  'LOYALTY',
  'PLATFORM',
] as const;
export type AnalyticsProduct = (typeof ANALYTICS_PRODUCTS)[number];

/** ENGAGEMENT and INTENT come from the client (unverified); CREDENTIAL, VERIFIED_OUTCOME and FINANCIAL come only from server records. */
export const EVENT_CLASSES = [
  'ENGAGEMENT',
  'INTENT',
  'CREDENTIAL',
  'VERIFIED_OUTCOME',
  'FINANCIAL',
] as const;
export type EventClass = (typeof EVENT_CLASSES)[number];

export interface AnalyticsEventDef {
  product: AnalyticsProduct;
  cls: EventClass;
  /** True when only a server-side record of the source of truth may produce it. */
  serverOnly: boolean;
}

const def = (product: AnalyticsProduct, cls: EventClass): AnalyticsEventDef => ({
  product,
  cls,
  serverOnly: cls !== 'ENGAGEMENT' && cls !== 'INTENT',
});

/** The governed analytics taxonomy. New names are added here first; an unknown name is refused by the database. */
export const ANALYTICS_EVENTS = {
  // Live Deals (discovery and intent only: the merchant transaction is not observed)
  LIVE_IMPRESSION: def('LIVE', 'ENGAGEMENT'),
  LIVE_DETAIL_VIEW: def('LIVE', 'ENGAGEMENT'),
  LIVE_MERCHANT_PAGE_VISIT: def('LIVE', 'ENGAGEMENT'),
  LIVE_SAVE: def('LIVE', 'ENGAGEMENT'),
  LIVE_DIRECTIONS: def('LIVE', 'INTENT'),
  LIVE_ONLINE_CLICK: def('LIVE', 'INTENT'),
  MEMBER_BENEFIT_ACTIVATION: def('LIVE', 'CREDENTIAL'),
  MEMBER_BENEFIT_REDEMPTION_VERIFIED: def('LIVE', 'VERIFIED_OUTCOME'),
  // Exclusive Deals
  EXCLUSIVE_IMPRESSION: def('EXCLUSIVE', 'ENGAGEMENT'),
  EXCLUSIVE_VIEW: def('EXCLUSIVE', 'ENGAGEMENT'),
  EXCLUSIVE_SAVE: def('EXCLUSIVE', 'ENGAGEMENT'),
  EXCLUSIVE_DIRECTIONS: def('EXCLUSIVE', 'INTENT'),
  EXCLUSIVE_CREDENTIAL_ISSUED: def('EXCLUSIVE', 'CREDENTIAL'),
  EXCLUSIVE_RESERVATION_CANCELLED: def('EXCLUSIVE', 'CREDENTIAL'),
  EXCLUSIVE_RESERVATION_EXPIRED: def('EXCLUSIVE', 'CREDENTIAL'),
  EXCLUSIVE_REDEMPTION_VERIFIED: def('EXCLUSIVE', 'VERIFIED_OUTCOME'),
  EXCLUSIVE_REDEMPTION_REVERSED: def('EXCLUSIVE', 'VERIFIED_OUTCOME'),
  EXCLUSIVE_REDEMPTION_REJECTED: def('EXCLUSIVE', 'VERIFIED_OUTCOME'),
  // Vouchers
  VOUCHER_VIEW: def('VOUCHER', 'ENGAGEMENT'),
  VOUCHER_CHECKOUT_STARTED: def('VOUCHER', 'INTENT'),
  VOUCHER_PAYMENT_SUCCEEDED: def('VOUCHER', 'FINANCIAL'),
  VOUCHER_PAYMENT_FAILED: def('VOUCHER', 'FINANCIAL'),
  VOUCHER_ISSUED: def('VOUCHER', 'CREDENTIAL'),
  VOUCHER_REDEEMED: def('VOUCHER', 'VERIFIED_OUTCOME'),
  VOUCHER_REDEMPTION_REVERSED: def('VOUCHER', 'VERIFIED_OUTCOME'),
  VOUCHER_REDEMPTION_REJECTED: def('VOUCHER', 'VERIFIED_OUTCOME'),
  VOUCHER_EXPIRED: def('VOUCHER', 'CREDENTIAL'),
  VOUCHER_REFUNDED: def('VOUCHER', 'FINANCIAL'),
  // Watch & Earn
  WATCH_VIDEO_SERVED: def('WATCH', 'CREDENTIAL'),
  WATCH_VIEW_STARTED: def('WATCH', 'VERIFIED_OUTCOME'),
  WATCH_VIEW_COMPLETED: def('WATCH', 'VERIFIED_OUTCOME'),
  WATCH_QUALIFIED_VIEW: def('WATCH', 'VERIFIED_OUTCOME'),
  /** A qualified view reversed by Risk: its charge is credited back to the budget (subtracts from views and spend). */
  WATCH_VIEW_CREDITED_BACK: def('WATCH', 'VERIFIED_OUTCOME'),
  WATCH_VIEW_REJECTED: def('WATCH', 'VERIFIED_OUTCOME'),
  WATCH_FRAUD_HOLD: def('WATCH', 'VERIFIED_OUTCOME'),
  WATCH_ACTION: def('WATCH', 'INTENT'),
  WATCH_FUNDED: def('WATCH', 'FINANCIAL'),
  // Loyalty (points are a non-cash incentive: no cash value is ever stated)
  POINTS_ISSUED: def('LOYALTY', 'FINANCIAL'),
  POINTS_HELD: def('LOYALTY', 'FINANCIAL'),
  POINTS_RELEASED: def('LOYALTY', 'FINANCIAL'),
  POINTS_REDEEMED: def('LOYALTY', 'FINANCIAL'),
  POINTS_EXPIRED: def('LOYALTY', 'FINANCIAL'),
  POINTS_REVERSED: def('LOYALTY', 'FINANCIAL'),
  REWARD_ALLOCATED: def('LOYALTY', 'FINANCIAL'),
} as const satisfies Record<string, AnalyticsEventDef>;
export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export const ANALYTICS_EVENT_NAMES = Object.keys(ANALYTICS_EVENTS) as AnalyticsEventName[];

/** Metric -> how it is computed. COUNT/SUM read events; GAUGE reads the live source; RATIO divides two metrics (basis points). */
export interface MetricDef {
  product: AnalyticsProduct;
  kind: 'COUNT' | 'SUM' | 'GAUGE' | 'RATIO' | 'UNIQUE';
  events?: readonly AnalyticsEventName[];
  /** Events that subtract (a reversal undoes an outcome). */
  minus?: readonly AnalyticsEventName[];
  numerator?: string;
  denominator?: string;
  unit: 'COUNT' | 'MINOR' | 'BPS' | 'POINTS' | 'SECONDS';
}
const m = (
  product: AnalyticsProduct,
  kind: MetricDef['kind'],
  unit: MetricDef['unit'],
  rest: Partial<MetricDef> = {},
): MetricDef => ({ product, kind, unit, ...rest });

export const METRICS = {
  // Live Deals
  'live.impressions': m('LIVE', 'COUNT', 'COUNT', { events: ['LIVE_IMPRESSION'] }),
  'live.detail_views': m('LIVE', 'COUNT', 'COUNT', { events: ['LIVE_DETAIL_VIEW'] }),
  'live.merchant_page_visits': m('LIVE', 'COUNT', 'COUNT', {
    events: ['LIVE_MERCHANT_PAGE_VISIT'],
  }),
  'live.saves': m('LIVE', 'COUNT', 'COUNT', { events: ['LIVE_SAVE'] }),
  'live.directions': m('LIVE', 'COUNT', 'COUNT', { events: ['LIVE_DIRECTIONS'] }),
  'live.online_clicks': m('LIVE', 'COUNT', 'COUNT', { events: ['LIVE_ONLINE_CLICK'] }),
  'live.member_benefit_activations': m('LIVE', 'COUNT', 'COUNT', {
    events: ['MEMBER_BENEFIT_ACTIVATION'],
  }),
  'live.member_benefit_redemptions': m('LIVE', 'COUNT', 'COUNT', {
    events: ['MEMBER_BENEFIT_REDEMPTION_VERIFIED'],
  }),
  // Exclusive Deals
  'exclusive.views': m('EXCLUSIVE', 'COUNT', 'COUNT', { events: ['EXCLUSIVE_VIEW'] }),
  'exclusive.credentials_issued': m('EXCLUSIVE', 'COUNT', 'COUNT', {
    events: ['EXCLUSIVE_CREDENTIAL_ISSUED'],
  }),
  'exclusive.verified_redemptions': m('EXCLUSIVE', 'COUNT', 'COUNT', {
    events: ['EXCLUSIVE_REDEMPTION_VERIFIED'],
    minus: ['EXCLUSIVE_REDEMPTION_REVERSED'],
  }),
  'exclusive.redemption_rejections': m('EXCLUSIVE', 'COUNT', 'COUNT', {
    events: ['EXCLUSIVE_REDEMPTION_REJECTED'],
  }),
  'exclusive.redemption_rate': m('EXCLUSIVE', 'RATIO', 'BPS', {
    numerator: 'exclusive.verified_redemptions',
    denominator: 'exclusive.credentials_issued',
  }),
  'exclusive.inventory_remaining': m('EXCLUSIVE', 'GAUGE', 'COUNT'),
  'exclusive.sponsor_utilization': m('EXCLUSIVE', 'GAUGE', 'BPS'),
  'exclusive.merchant_benefit_utilization': m('EXCLUSIVE', 'GAUGE', 'BPS'),
  // Vouchers
  'voucher.views': m('VOUCHER', 'COUNT', 'COUNT', { events: ['VOUCHER_VIEW'] }),
  'voucher.purchases': m('VOUCHER', 'COUNT', 'COUNT', { events: ['VOUCHER_PAYMENT_SUCCEEDED'] }),
  'voucher.payment_failures': m('VOUCHER', 'COUNT', 'COUNT', {
    events: ['VOUCHER_PAYMENT_FAILED'],
  }),
  'voucher.payment_success_rate': m('VOUCHER', 'RATIO', 'BPS', {
    numerator: 'voucher.purchases',
    denominator: 'voucher.payment_attempts',
  }),
  'voucher.payment_attempts': m('VOUCHER', 'COUNT', 'COUNT', {
    events: ['VOUCHER_PAYMENT_SUCCEEDED', 'VOUCHER_PAYMENT_FAILED'],
  }),
  'voucher.issued': m('VOUCHER', 'COUNT', 'COUNT', { events: ['VOUCHER_ISSUED'] }),
  'voucher.redeemed': m('VOUCHER', 'COUNT', 'COUNT', {
    events: ['VOUCHER_REDEEMED'],
    minus: ['VOUCHER_REDEMPTION_REVERSED'],
  }),
  'voucher.expired': m('VOUCHER', 'COUNT', 'COUNT', { events: ['VOUCHER_EXPIRED'] }),
  'voucher.refunded': m('VOUCHER', 'COUNT', 'COUNT', { events: ['VOUCHER_REFUNDED'] }),
  'voucher.sales_value': m('VOUCHER', 'SUM', 'MINOR', {
    events: ['VOUCHER_PAYMENT_SUCCEEDED'],
    minus: ['VOUCHER_REFUNDED'],
  }),
  'voucher.active': m('VOUCHER', 'GAUGE', 'COUNT'),
  'voucher.inventory_remaining': m('VOUCHER', 'GAUGE', 'COUNT'),
  'voucher.merchant_payable': m('VOUCHER', 'GAUGE', 'MINOR'),
  'voucher.settled': m('VOUCHER', 'GAUGE', 'MINOR'),
  // Watch & Earn
  'watch.videos_served': m('WATCH', 'COUNT', 'COUNT', { events: ['WATCH_VIDEO_SERVED'] }),
  'watch.starts': m('WATCH', 'COUNT', 'COUNT', { events: ['WATCH_VIEW_STARTED'] }),
  'watch.completions': m('WATCH', 'COUNT', 'COUNT', { events: ['WATCH_VIEW_COMPLETED'] }),
  'watch.qualified_views': m('WATCH', 'COUNT', 'COUNT', {
    events: ['WATCH_QUALIFIED_VIEW'],
    minus: ['WATCH_VIEW_CREDITED_BACK'],
  }),
  'watch.completion_rate': m('WATCH', 'RATIO', 'BPS', {
    numerator: 'watch.completions',
    denominator: 'watch.starts',
  }),
  'watch.actions': m('WATCH', 'COUNT', 'COUNT', { events: ['WATCH_ACTION'] }),
  'watch.fraud_holds': m('WATCH', 'COUNT', 'COUNT', { events: ['WATCH_FRAUD_HOLD'] }),
  'watch.spend': m('WATCH', 'SUM', 'MINOR', {
    events: ['WATCH_QUALIFIED_VIEW'],
    minus: ['WATCH_VIEW_CREDITED_BACK'],
  }),
  'watch.cpva': m('WATCH', 'RATIO', 'MINOR', {
    numerator: 'watch.spend',
    denominator: 'watch.qualified_views',
  }),
  'watch.points_issued': m('WATCH', 'SUM', 'POINTS', { events: ['POINTS_ISSUED'] }),
  'watch.remaining_budget': m('WATCH', 'GAUGE', 'MINOR'),
  // Loyalty
  'loyalty.points_issued': m('LOYALTY', 'SUM', 'POINTS', { events: ['POINTS_ISSUED'] }),
  'loyalty.points_reserved': m('LOYALTY', 'SUM', 'POINTS', {
    events: ['POINTS_HELD'],
    minus: ['POINTS_RELEASED'],
  }),
  'loyalty.points_redeemed': m('LOYALTY', 'SUM', 'POINTS', { events: ['POINTS_REDEEMED'] }),
  'loyalty.points_expired': m('LOYALTY', 'SUM', 'POINTS', { events: ['POINTS_EXPIRED'] }),
  'loyalty.points_reversed': m('LOYALTY', 'SUM', 'POINTS', { events: ['POINTS_REVERSED'] }),
  'loyalty.rewards_allocated': m('LOYALTY', 'COUNT', 'COUNT', { events: ['REWARD_ALLOCATED'] }),
  'loyalty.points_remaining': m('LOYALTY', 'GAUGE', 'POINTS'),
  'loyalty.customers': m('LOYALTY', 'UNIQUE', 'COUNT', { events: ['POINTS_ISSUED'] }),
} as const satisfies Record<string, MetricDef>;
export type MetricKey = keyof typeof METRICS;
export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

/** Hierarchical reporting dimensions (drill-down order). */
export const REPORT_DIMENSIONS = [
  'ORGANIZATION',
  'COUNTRY',
  'LEGAL_ENTITY',
  'BRAND',
  'REGION',
  'CITY',
  'BRANCH',
  'CAMPAIGN',
  'PRODUCT',
  'DAY',
] as const;
export type ReportDimension = (typeof REPORT_DIMENSIONS)[number];
/** Dimensions that need the ADVANCED_REPORTING feature for a business (DealDash staff always may). */
export const ADVANCED_DIMENSIONS: readonly ReportDimension[] = [
  'COUNTRY',
  'LEGAL_ENTITY',
  'BRAND',
  'REGION',
  'CITY',
];

// ---------------------------------------------------------------- targets
export const TARGET_METRICS = {
  IMPRESSIONS: { metrics: ['live.impressions'], unit: 'COUNT', direction: 'UP' },
  QUALIFIED_VIEWS: { metrics: ['watch.qualified_views'], unit: 'COUNT', direction: 'UP' },
  REDEMPTIONS: {
    metrics: ['exclusive.verified_redemptions', 'voucher.redeemed'],
    unit: 'COUNT',
    direction: 'UP',
  },
  VOUCHER_SALES: { metrics: ['voucher.sales_value'], unit: 'MINOR', direction: 'UP' },
  CUSTOMER_ACQUISITION: { metrics: ['customers.unique'], unit: 'COUNT', direction: 'UP' },
  CONVERSION: { metrics: ['conversion'], unit: 'BPS', direction: 'UP' },
  CPVA: { metrics: ['watch.cpva'], unit: 'MINOR', direction: 'DOWN' },
  INVENTORY_UTILIZATION: { metrics: ['inventory.utilization'], unit: 'BPS', direction: 'UP' },
  REWARD_REDEMPTION: { metrics: ['loyalty.rewards_allocated'], unit: 'COUNT', direction: 'UP' },
  LOYALTY_UTILIZATION: { metrics: ['loyalty.points_redeemed'], unit: 'POINTS', direction: 'UP' },
  BRANCH_PERFORMANCE: {
    metrics: ['exclusive.verified_redemptions', 'voucher.redeemed'],
    unit: 'COUNT',
    direction: 'UP',
  },
  SPEND: { metrics: ['watch.spend'], unit: 'MINOR', direction: 'CAP' },
  SPONSOR_FUNDING_UTILIZATION: {
    metrics: ['exclusive.sponsor_utilization'],
    unit: 'BPS',
    direction: 'UP',
  },
} as const;
export type TargetMetric = keyof typeof TARGET_METRICS;
export const TARGET_METRIC_KEYS = Object.keys(TARGET_METRICS) as TargetMetric[];
export const DEFAULT_TARGET_THRESHOLDS = [25, 50, 75, 90, 100] as const;
/** Forecasts are estimates, never promises: every response carries this label. */
export const FORECAST_LABEL = 'FORECAST_ESTIMATE' as const;
export const TARGET_STATUSES = [
  'NOT_STARTED',
  'ON_TRACK',
  'AHEAD',
  'BEHIND',
  'AT_RISK',
  'ACHIEVED',
  'MISSED',
  'ENDED',
] as const;
export type TargetStatus = (typeof TARGET_STATUSES)[number];

// ---------------------------------------------------------------- alerts
export const ALERT_CATEGORIES = [
  'PERFORMANCE',
  'INVENTORY',
  'FUNDING',
  'FINANCE',
  'COMMERCIAL',
  'INTEGRATION',
  'RISK',
  'SUBSCRIPTION',
  'OPERATIONS',
] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];
export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** Every alert the platform can raise, with its category, default severity and the action it offers (when authorised). */
export const ALERT_CODES = {
  TARGET_MILESTONE: { category: 'PERFORMANCE', severity: 'INFO', action: 'VIEW_PERFORMANCE' },
  CAMPAIGN_BEHIND_TARGET: {
    category: 'PERFORMANCE',
    severity: 'WARNING',
    action: 'VIEW_PERFORMANCE',
  },
  CAMPAIGN_LOW_ACTIVITY: {
    category: 'PERFORMANCE',
    severity: 'WARNING',
    action: 'VIEW_PERFORMANCE',
  },
  BUDGET_PROJECTED_EXHAUST: { category: 'FUNDING', severity: 'WARNING', action: 'ADD_BUDGET' },
  INVENTORY_PROJECTED_EXHAUST: {
    category: 'INVENTORY',
    severity: 'WARNING',
    action: 'ADD_INVENTORY',
  },
  VOUCHER_INVENTORY_LOW: { category: 'INVENTORY', severity: 'WARNING', action: 'ADD_INVENTORY' },
  REWARD_INVENTORY_LOW: { category: 'INVENTORY', severity: 'WARNING', action: 'VIEW_REWARDS' },
  POINTS_FUNDING_LOW: { category: 'FUNDING', severity: 'WARNING', action: 'REVIEW_FUNDING' },
  SPONSOR_FUNDING_NEAR_LIMIT: {
    category: 'FUNDING',
    severity: 'WARNING',
    action: 'REVIEW_FUNDING',
  },
  CREDIT_NEAR_LIMIT: { category: 'FINANCE', severity: 'WARNING', action: 'VIEW_CREDIT' },
  PO_NEAR_LIMIT: { category: 'FINANCE', severity: 'WARNING', action: 'VIEW_PO' },
  CAMPAIGN_EXPIRY_APPROACHING: {
    category: 'COMMERCIAL',
    severity: 'INFO',
    action: 'VIEW_PERFORMANCE',
  },
  VOUCHER_EXPIRY_APPROACHING: {
    category: 'COMMERCIAL',
    severity: 'INFO',
    action: 'VIEW_PERFORMANCE',
  },
  REWARD_EXPIRY_APPROACHING: { category: 'COMMERCIAL', severity: 'INFO', action: 'VIEW_REWARDS' },
  QUOTATION_EXPIRING: { category: 'COMMERCIAL', severity: 'WARNING', action: 'REVIEW_QUOTATION' },
  INVOICE_DUE: { category: 'FINANCE', severity: 'INFO', action: 'VIEW_INVOICE' },
  INVOICE_OVERDUE: { category: 'FINANCE', severity: 'CRITICAL', action: 'VIEW_INVOICE' },
  SETTLEMENT_PENDING: { category: 'FINANCE', severity: 'INFO', action: 'VIEW_SETTLEMENT' },
  FEED_STALE: { category: 'INTEGRATION', severity: 'WARNING', action: 'VIEW_INTEGRATION' },
  INTEGRATION_ERROR: { category: 'INTEGRATION', severity: 'CRITICAL', action: 'VIEW_INTEGRATION' },
  PAYMENT_FAILURES_RISING: { category: 'RISK', severity: 'WARNING', action: 'VIEW_PAYMENTS' },
  REDEMPTION_REJECTIONS_RISING: {
    category: 'RISK',
    severity: 'WARNING',
    action: 'VIEW_PERFORMANCE',
  },
  SUSPICIOUS_BRANCH_ACTIVITY: { category: 'RISK', severity: 'CRITICAL', action: 'VIEW_RISK' },
  RECONCILIATION_DIFFERENCE: {
    category: 'FINANCE',
    severity: 'CRITICAL',
    action: 'VIEW_RECONCILIATION',
  },
  FUNDING_REQUIRED: { category: 'FUNDING', severity: 'WARNING', action: 'REVIEW_FUNDING' },
  MERCHANT_APPROVAL_REQUIRED: {
    category: 'OPERATIONS',
    severity: 'INFO',
    action: 'REVIEW_CAMPAIGN',
  },
  // Subscription signals turned into alerts (the Phase 4 consumer of the subscription engine's outbox)
  SUBSCRIPTION_LIMIT: { category: 'SUBSCRIPTION', severity: 'WARNING', action: 'VIEW_PLAN' },
  SUBSCRIPTION_LIFECYCLE: { category: 'SUBSCRIPTION', severity: 'WARNING', action: 'VIEW_PLAN' },
  FINANCIAL_HOLD: { category: 'FINANCE', severity: 'CRITICAL', action: 'VIEW_PLAN' },
  // Stage 8: operations (SLA escalation, delivery failures, fraud flags, settlement / reconciliation exceptions)
  SLA_WARNING: { category: 'OPERATIONS', severity: 'WARNING', action: 'VIEW_CASES' },
  SLA_BREACHED: { category: 'OPERATIONS', severity: 'CRITICAL', action: 'VIEW_CASES' },
  NOTIFICATION_FAILURE: { category: 'OPERATIONS', severity: 'WARNING', action: 'VIEW_NOTIFICATIONS' },
  FRAUD_FLAG_RAISED: { category: 'RISK', severity: 'WARNING', action: 'VIEW_RISK' },
  SETTLEMENT_EXCEPTION: { category: 'FINANCE', severity: 'WARNING', action: 'VIEW_SETTLEMENT' },
  RECONCILIATION_EXCEPTION: { category: 'FINANCE', severity: 'WARNING', action: 'VIEW_RECONCILIATION' },
  RESTRICTION_PLACED: { category: 'OPERATIONS', severity: 'CRITICAL', action: 'VIEW_CASES' },
  RESTRICTION_LIFTED: { category: 'OPERATIONS', severity: 'INFO', action: 'VIEW_CASES' },
} as const satisfies Record<
  string,
  { category: AlertCategory; severity: AlertSeverity; action: string }
>;
export type AlertCode = keyof typeof ALERT_CODES;
export const ALERT_CODE_KEYS = Object.keys(ALERT_CODES) as AlertCode[];

export const ALERT_ACTIONS = [
  'VIEW_PERFORMANCE',
  'ADD_BUDGET',
  'ADD_INVENTORY',
  'VIEW_REWARDS',
  'REVIEW_FUNDING',
  'VIEW_CREDIT',
  'VIEW_PO',
  'REVIEW_QUOTATION',
  'VIEW_INVOICE',
  'VIEW_SETTLEMENT',
  'VIEW_INTEGRATION',
  'VIEW_PAYMENTS',
  'VIEW_RISK',
  'VIEW_RECONCILIATION',
  'REVIEW_CAMPAIGN',
  'VIEW_PLAN',
  'VIEW_CASES',
  'VIEW_NOTIFICATIONS',
] as const;
export type AlertAction = (typeof ALERT_ACTIONS)[number];

export const ALERT_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH', 'SMS', 'TASK_INBOX'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];
export const ALERT_FREQUENCIES = ['IMMEDIATE', 'DIGEST', 'CRITICAL_ONLY'] as const;
export type AlertFrequency = (typeof ALERT_FREQUENCIES)[number];
export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

// ---------------------------------------------------------------- operations health
export const HEALTH_STATES = ['HEALTHY', 'DEGRADED', 'STALE', 'FAILING', 'NOT_CONFIGURED'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];
/** Integration families shown in the Command Centre (a family with no connection is NOT_CONFIGURED, never "healthy"). */
export const INTEGRATION_FAMILIES = [
  'VISA',
  'MASTERCARD',
  'BANK_FEED',
  'PARTNER_FEED',
  'BULK_IMPORT',
  'PAYMENT_GATEWAY',
  'SMS_OTP',
  'EMAIL',
  'PUSH',
  'VIDEO',
  'MAPS',
  'WEBHOOKS',
  'SYNC_JOBS',
] as const;
export type IntegrationFamily = (typeof INTEGRATION_FAMILIES)[number];
export const TIMELINE_KINDS = [
  'ACCOUNT',
  'RESERVATION',
  'REDEMPTION',
  'ORDER',
  'PAYMENT',
  'REFUND',
  'VOUCHER',
  'WATCH_VIEW',
  'POINTS',
  'REWARD',
  'SUPPORT_CASE',
  'DISPUTE',
  'RISK',
  'NOTIFICATION',
  // Stage 8: consolidated support timeline
  'ELIGIBILITY',
  'REVIEW',
  'RESTRICTION',
  'CONTACT',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];
