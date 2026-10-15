import { z } from 'zod';

/**
 * Stage 8 operations configuration (`operations`). All values are DEVELOPMENT defaults editable by DealDash Admin (Rules and
 * controls), versioned and audited. Market-specific meaning (refund rights, tax adjustments, credit-note rules, settlement cycles,
 * retention, communications consent) is never decided here: it comes from the Market configuration and its VALIDATE-<market> items.
 */
const approvalMode = z.enum(['ALWAYS', 'ABOVE_THRESHOLD', 'NEVER']);
const approvalRule = z.object({
  mode: approvalMode,
  /** Minor units (or points for points adjustments). ABOVE_THRESHOLD: amounts strictly above need a second person. */
  thresholdMinor: z.number().int().min(0).default(0),
});
const escalationStep = z.object({
  level: z.number().int().min(1).max(5),
  /** Minutes after the breach (0 = at the breach). */
  afterBreachMinutes: z.number().int().min(0),
  toRoles: z.array(z.string()).min(1),
});
const slaRule = z.object({
  /** Hours to complete, by priority (LOW / NORMAL / HIGH / CRITICAL). */
  targetHours: z.record(z.string(), z.number().positive()),
  /** Percent of the target after which the item is at WARNING. */
  warnPct: z.number().int().min(1).max(99),
  escalation: z.array(escalationStep),
});
const riskRule = z.object({
  enabled: z.boolean(),
  threshold: z.number().int().min(1),
  windowMinutes: z.number().int().min(1),
  /** Rule-based MVP: ALLOW (record only), FLAG (human review), BLOCK (stop the action now; a person reviews). */
  decision: z.enum(['ALLOW', 'FLAG', 'BLOCK']),
});
const reasonList = z.array(
  z.object({ code: z.string().min(2).max(60), en: z.string(), ar: z.string() }),
);

export const operationsConfigSchema = z.object({
  /** Allowed case status moves (the case lifecycle). Terminal statuses have no moves. */
  caseLifecycle: z.record(z.string(), z.array(z.string())),
  /** Routing per case type: the team that owns it and its default severity. */
  caseTypes: z.record(z.string(), z.object({ team: z.string(), severity: z.string() })),
  /** A case resolution carrying a financial impact above this needs a second person (finance approver). Null = never. */
  caseApprovalAboveMinor: z.number().int().min(0).nullable(),
  sla: z.record(z.string(), slaRule),
  approvals: z.object({
    adjustments: z.record(z.string(), approvalRule),
    /** Direct (legacy) adjustment endpoints refuse amounts above this; larger corrections go through the governed workflow. */
    directAdjustmentMaxMinor: z.number().int().min(0),
    /** Order-level exceptional refunds (duplicate payment, failed issuance, payment reversal). */
    orderRefund: approvalRule,
    /** Customer refunds sent to review: a second person approves above this. Null = one reviewer (Stage 5 default). */
    refundReviewCheckerAboveMinor: z.number().int().min(0).nullable(),
    restrictions: z.record(z.string(), approvalMode),
    settlementOverride: approvalMode,
    dataRequests: approvalMode,
  }),
  reasons: z.object({
    refund: reasonList,
    dispute: reasonList,
    adjustment: reasonList,
    hold: reasonList,
    moderation: reasonList,
  }),
  risk: z.object({ rules: z.record(z.string(), riskRule) }),
  restrictions: z.object({
    /** Longest a restriction / hold may last without a new decision, in days. */
    maxDays: z.record(z.string(), z.number().int().min(1)),
    /** Whether the subject is told (customers and businesses are told unless a lawful reason says otherwise: VALIDATE). */
    notifySubject: z.record(z.string(), z.boolean()),
  }),
  notifications: z.object({
    maxAttempts: z.number().int().min(1).max(10),
    /** Minutes before each retry. */
    retryMinutes: z.array(z.number().int().min(1)),
    /** Template registry: notification type -> version and channels (the text lives in the bilingual dictionaries). */
    templates: z.record(
      z.string(),
      z.object({ version: z.number().int().min(1), channels: z.array(z.string()) }),
    ),
    /** Stage 9 (B3): at most this many SMS / e-mail / push messages per person per channel per hour (in-app is never limited). */
    throttlePerUserPerHour: z.number().int().min(1).max(500).optional(),
    /** Stage 9 (B3): channel to try when a channel finally fails (only where approved; none by default). */
    fallback: z
      .record(z.enum(['PUSH', 'SMS', 'EMAIL']), z.enum(['PUSH', 'SMS', 'EMAIL']))
      .optional(),
  }),
  reviews: z.object({
    /** PUBLISH_THEN_MODERATE: a review shows at once and can be reported; PRE_MODERATION: DealDash approves first. */
    mode: z.enum(['PUBLISH_THEN_MODERATE', 'PRE_MODERATION']),
    /** One review per customer per merchant within this many days. */
    perMerchantDays: z.number().int().min(1),
    minTextLength: z.number().int().min(0),
    /** A review reported this many times is hidden until a moderator decides. */
    hideAfterReports: z.number().int().min(1),
  }),
  supportQueues: z.array(
    z.object({
      code: z.string(),
      en: z.string(),
      ar: z.string(),
      team: z.string(),
      caseTypes: z.array(z.string()),
    }),
  ),
});
export type OperationsConfig = z.infer<typeof operationsConfigSchema>;

const sla = (
  hours: [number, number, number, number],
  warnPct = 75,
  finalRole = 'DEALDASH_SUPER_ADMIN',
  firstRole = 'DEALDASH_OPERATIONS',
) => ({
  targetHours: { LOW: hours[0], NORMAL: hours[1], HIGH: hours[2], CRITICAL: hours[3] },
  warnPct,
  escalation: [
    { level: 1, afterBreachMinutes: 0, toRoles: [firstRole] },
    { level: 2, afterBreachMinutes: 240, toRoles: [finalRole] },
  ],
});
const r = (code: string, en: string, ar: string) => ({ code, en, ar });

export const DEFAULT_OPERATIONS_CONFIG: OperationsConfig = {
  caseLifecycle: {
    OPEN: [
      'INVESTIGATING',
      'AWAITING_CUSTOMER',
      'AWAITING_MERCHANT',
      'AWAITING_PARTNER',
      'AWAITING_FINANCE',
      'RESOLVED',
      'CLOSED',
      'REJECTED',
    ],
    INVESTIGATING: [
      'AWAITING_CUSTOMER',
      'AWAITING_MERCHANT',
      'AWAITING_PARTNER',
      'AWAITING_FINANCE',
      'AWAITING_APPROVAL',
      'RESOLVED',
      'CLOSED',
      'REJECTED',
    ],
    IN_REVIEW: [
      'INVESTIGATING',
      'AWAITING_CUSTOMER',
      'AWAITING_MERCHANT',
      'AWAITING_PARTNER',
      'AWAITING_FINANCE',
      'AWAITING_APPROVAL',
      'RESOLVED',
      'CLOSED',
      'REJECTED',
    ],
    WAITING: ['INVESTIGATING', 'RESOLVED', 'CLOSED', 'REJECTED'],
    AWAITING_CUSTOMER: ['INVESTIGATING', 'RESOLVED', 'CLOSED'],
    AWAITING_MERCHANT: ['INVESTIGATING', 'AWAITING_FINANCE', 'RESOLVED', 'CLOSED'],
    AWAITING_PARTNER: ['INVESTIGATING', 'AWAITING_FINANCE', 'RESOLVED', 'CLOSED'],
    AWAITING_FINANCE: ['INVESTIGATING', 'AWAITING_APPROVAL', 'RESOLVED', 'CLOSED'],
    AWAITING_APPROVAL: ['INVESTIGATING', 'RESOLVED', 'REJECTED'],
    RESOLVED: [],
    CLOSED: [],
    REJECTED: [],
  },
  caseTypes: {
    PAYMENT_EXCEPTION: { team: 'FINANCE', severity: 'HIGH' },
    REFUND_EXCEPTION: { team: 'FINANCE', severity: 'HIGH' },
    VOUCHER_EXCEPTION: { team: 'SUPPORT', severity: 'MEDIUM' },
    EXCLUSIVE_REDEMPTION_EXCEPTION: { team: 'SUPPORT', severity: 'MEDIUM' },
    LIVE_BENEFIT_EXCEPTION: { team: 'OPERATIONS', severity: 'LOW' },
    WATCH_EARN_EXCEPTION: { team: 'OPERATIONS', severity: 'MEDIUM' },
    LOYALTY_EXCEPTION: { team: 'OPERATIONS', severity: 'MEDIUM' },
    SETTLEMENT_EXCEPTION: { team: 'FINANCE', severity: 'HIGH' },
    RECONCILIATION_EXCEPTION: { team: 'FINANCE', severity: 'HIGH' },
    BILLING_EXCEPTION: { team: 'FINANCE', severity: 'MEDIUM' },
    MERCHANT_DATA_EXCEPTION: { team: 'MERCHANT_MANAGEMENT', severity: 'LOW' },
    PARTNER_DATA_EXCEPTION: { team: 'PARTNER_MANAGEMENT', severity: 'LOW' },
    INTEGRATION_EXCEPTION: { team: 'OPERATIONS', severity: 'HIGH' },
    FRAUD_REVIEW: { team: 'RISK', severity: 'HIGH' },
    CUSTOMER_COMPLAINT: { team: 'SUPPORT', severity: 'MEDIUM' },
    OTHER_OPERATIONAL_EXCEPTION: { team: 'OPERATIONS', severity: 'LOW' },
  },
  caseApprovalAboveMinor: 0,
  sla: {
    CASE: sla([120, 72, 24, 4]),
    APPROVAL: sla([72, 48, 24, 8]),
    REFUND: sla([72, 48, 24, 8], 75, 'DEALDASH_SUPER_ADMIN', 'DEALDASH_FINANCE'),
    ADJUSTMENT: sla([72, 48, 24, 8], 75, 'DEALDASH_SUPER_ADMIN', 'DEALDASH_FINANCE'),
    RECONCILIATION: sla([120, 72, 48, 24], 75, 'DEALDASH_SUPER_ADMIN', 'DEALDASH_FINANCE'),
    SETTLEMENT: sla([120, 72, 48, 24], 75, 'DEALDASH_SUPER_ADMIN', 'DEALDASH_FINANCE'),
    FRAUD: sla([48, 24, 8, 2], 75, 'DEALDASH_SUPER_ADMIN', 'DEALDASH_RISK_COMPLIANCE'),
    INTEGRATION: sla([48, 24, 8, 2]),
    RESTRICTION: sla([48, 24, 8, 2], 75, 'DEALDASH_SUPER_ADMIN', 'DEALDASH_RISK_COMPLIANCE'),
    MODERATION: sla([72, 48, 24, 8]),
    DATA_REQUEST: sla([240, 168, 72, 24], 75, 'DEALDASH_SUPER_ADMIN', 'DEALDASH_SUPPORT'),
  },
  approvals: {
    adjustments: {
      INVOICE_CORRECTION: { mode: 'ALWAYS', thresholdMinor: 0 },
      CREDIT_NOTE: { mode: 'ALWAYS', thresholdMinor: 0 },
      DEBIT_NOTE: { mode: 'ALWAYS', thresholdMinor: 0 },
      SETTLEMENT_ADJUSTMENT: { mode: 'ABOVE_THRESHOLD', thresholdMinor: 100_000 },
      RECONCILIATION_ADJUSTMENT: { mode: 'ABOVE_THRESHOLD', thresholdMinor: 10_000 },
      POINTS_ADJUSTMENT: { mode: 'ABOVE_THRESHOLD', thresholdMinor: 100 },
      REWARD_REVERSAL: { mode: 'ABOVE_THRESHOLD', thresholdMinor: 100 },
      FUNDING_ADJUSTMENT: { mode: 'ALWAYS', thresholdMinor: 0 },
      CAMPAIGN_UTILIZATION_CORRECTION: { mode: 'ALWAYS', thresholdMinor: 0 },
      ADMIN_ADJUSTMENT: { mode: 'ALWAYS', thresholdMinor: 0 },
    },
    directAdjustmentMaxMinor: 100_000,
    orderRefund: { mode: 'ALWAYS', thresholdMinor: 0 },
    refundReviewCheckerAboveMinor: null,
    restrictions: {
      CUSTOMER_RESTRICTION: 'ALWAYS',
      MERCHANT_CAMPAIGN_HOLD: 'ALWAYS',
      BRANCH_REDEMPTION_HOLD: 'ALWAYS',
      USER_SUSPENSION: 'ALWAYS',
      INTEGRATION_SUSPENSION: 'NEVER',
      FINANCIAL_HOLD: 'ALWAYS',
    },
    settlementOverride: 'ALWAYS',
    dataRequests: 'ALWAYS',
  },
  reasons: {
    refund: [
      r('CUSTOMER_REQUEST', 'Customer request', 'طلب العميل'),
      r(
        'MERCHANT_UNABLE_TO_HONOUR',
        'Merchant could not honour the voucher',
        'تعذّر على التاجر الوفاء بالقسيمة',
      ),
      r('DUPLICATE_PAYMENT', 'Duplicate payment', 'دفع مكرر'),
      r('FAILED_ISSUANCE', 'Voucher could not be issued', 'تعذّر إصدار القسيمة'),
      r('PAYMENT_REVERSAL', 'Payment reversed by the provider', 'عكس مزوّد الدفع العملية'),
      r('GOODWILL', 'Goodwill (exception)', 'حسن نية (استثناء)'),
    ],
    dispute: [
      r('NOT_HONOURED', 'Offer not honoured', 'لم يتم الوفاء بالعرض'),
      r('WRONG_AMOUNT', 'Wrong amount', 'مبلغ خاطئ'),
      r('NOT_RECEIVED', 'Not received', 'لم يتم الاستلام'),
      r('SERVICE_QUALITY', 'Service quality', 'جودة الخدمة'),
      r('DATA_ERROR', 'Data error', 'خطأ في البيانات'),
      r('OTHER', 'Other', 'أخرى'),
    ],
    adjustment: [
      r('CORRECTION', 'Correction of an error', 'تصحيح خطأ'),
      r('GOODWILL', 'Goodwill', 'حسن نية'),
      r('DISPUTE_OUTCOME', 'Outcome of a dispute', 'نتيجة نزاع'),
      r('RECONCILIATION', 'Reconciliation difference', 'فرق تسوية'),
      r('CONTRACT_TERMS', 'Contract terms', 'شروط العقد'),
    ],
    hold: [
      r('FRAUD_SUSPECTED', 'Suspected fraud under review', 'اشتباه احتيال قيد المراجعة'),
      r('POLICY_BREACH', 'Policy breach', 'مخالفة السياسة'),
      r('DISPUTE_OPEN', 'Open dispute', 'نزاع مفتوح'),
      r('COMPLIANCE_REVIEW', 'Compliance review', 'مراجعة امتثال'),
      r('PAYMENT_OVERDUE', 'Payment overdue', 'دفعة متأخرة'),
      r('TECHNICAL_ISSUE', 'Technical issue', 'مشكلة تقنية'),
    ],
    moderation: [
      r('POLICY_COMPLIANT', 'Complies with the content policy', 'متوافق مع سياسة المحتوى'),
      r('SPAM', 'Spam', 'رسائل مزعجة'),
      r('OFFENSIVE', 'Offensive content', 'محتوى مسيء'),
      r('FALSE_INFORMATION', 'False information', 'معلومات خاطئة'),
      r('PRIVACY', 'Personal data shown', 'إظهار بيانات شخصية'),
      r('OTHER', 'Other', 'أخرى'),
    ],
  },
  risk: {
    rules: {
      REPEATED_CODE_ATTEMPTS: { enabled: true, threshold: 5, windowMinutes: 60, decision: 'FLAG' },
      SUSPICIOUS_REDEMPTION: { enabled: true, threshold: 3, windowMinutes: 1440, decision: 'FLAG' },
      REPEATED_REFUND_ATTEMPTS: {
        enabled: true,
        threshold: 3,
        windowMinutes: 10_080,
        decision: 'FLAG',
      },
      SUSPICIOUS_BRANCH_ACTIVITY: {
        enabled: true,
        threshold: 10,
        windowMinutes: 1440,
        decision: 'FLAG',
      },
      LOYALTY_ABUSE: { enabled: true, threshold: 20, windowMinutes: 1440, decision: 'FLAG' },
      UNUSUAL_CUSTOMER_ACTIVITY: {
        enabled: true,
        threshold: 10,
        windowMinutes: 1440,
        decision: 'FLAG',
      },
      MERCHANT_REFUND_ANOMALY: {
        enabled: true,
        threshold: 10,
        windowMinutes: 10_080,
        decision: 'FLAG',
      },
      DUPLICATE_QUALIFIED_VIEWS: {
        enabled: true,
        threshold: 3,
        windowMinutes: 60,
        decision: 'FLAG',
      },
    },
  },
  restrictions: {
    maxDays: {
      CUSTOMER_RESTRICTION: 30,
      MERCHANT_CAMPAIGN_HOLD: 30,
      BRANCH_REDEMPTION_HOLD: 14,
      USER_SUSPENSION: 30,
      INTEGRATION_SUSPENSION: 30,
      FINANCIAL_HOLD: 90,
    },
    notifySubject: {
      CUSTOMER_RESTRICTION: true,
      MERCHANT_CAMPAIGN_HOLD: true,
      BRANCH_REDEMPTION_HOLD: true,
      USER_SUSPENSION: true,
      INTEGRATION_SUSPENSION: true,
      FINANCIAL_HOLD: true,
    },
  },
  notifications: {
    maxAttempts: 3,
    retryMinutes: [5, 30, 120],
    templates: {
      RESERVATION_CONFIRMED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      RESERVATION_EXPIRING: { version: 1, channels: ['IN_APP', 'PUSH'] },
      RESERVATION_EXPIRED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      RESERVATION_CANCELLED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      RESERVATION_PAYMENT_FAILED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      RESERVATION_REFUND_UPDATED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      RESERVATION_FORFEITED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      REDEMPTION_SUCCESS: { version: 1, channels: ['IN_APP', 'PUSH'] },
      PURCHASE_SUCCEEDED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      PAYMENT_FAILED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      VOUCHER_ISSUED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      VOUCHER_EXPIRING: { version: 1, channels: ['IN_APP', 'PUSH'] },
      REFUND_UPDATED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      VOUCHER_REDEEMED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      REWARD_EARNED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      REWARD_HELD: { version: 1, channels: ['IN_APP', 'PUSH'] },
      REWARD_RELEASED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      REWARD_REVERSED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      REWARD_EXPIRING: { version: 1, channels: ['IN_APP', 'PUSH'] },
      CAMPAIGN_COMPLETED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      ALERT: { version: 1, channels: ['IN_APP', 'EMAIL', 'PUSH', 'SMS'] },
      CASE_UPDATED: { version: 1, channels: ['IN_APP', 'PUSH'] },
      ACCOUNT_RESTRICTION: { version: 1, channels: ['IN_APP', 'PUSH'] },
    },
  },
  reviews: {
    mode: 'PUBLISH_THEN_MODERATE',
    perMerchantDays: 30,
    minTextLength: 10,
    hideAfterReports: 3,
  },
  supportQueues: [
    {
      code: 'CUSTOMER_CARE',
      en: 'Customer care',
      ar: 'رعاية العملاء',
      team: 'SUPPORT',
      caseTypes: ['CUSTOMER_COMPLAINT', 'VOUCHER_EXCEPTION', 'EXCLUSIVE_REDEMPTION_EXCEPTION'],
    },
    {
      code: 'PAYMENTS',
      en: 'Payments and refunds',
      ar: 'المدفوعات والاسترداد',
      team: 'FINANCE',
      caseTypes: ['PAYMENT_EXCEPTION', 'REFUND_EXCEPTION', 'BILLING_EXCEPTION'],
    },
    {
      code: 'SETTLEMENT',
      en: 'Settlement and reconciliation',
      ar: 'التسوية والمطابقة',
      team: 'FINANCE',
      caseTypes: ['SETTLEMENT_EXCEPTION', 'RECONCILIATION_EXCEPTION'],
    },
    {
      code: 'ENGAGEMENT',
      en: 'Watch & Earn and loyalty',
      ar: 'شاهد واكسب والولاء',
      team: 'OPERATIONS',
      caseTypes: ['WATCH_EARN_EXCEPTION', 'LOYALTY_EXCEPTION', 'LIVE_BENEFIT_EXCEPTION'],
    },
    {
      code: 'DATA',
      en: 'Merchant, partner and integration data',
      ar: 'بيانات التجار والشركاء والتكامل',
      team: 'OPERATIONS',
      caseTypes: ['MERCHANT_DATA_EXCEPTION', 'PARTNER_DATA_EXCEPTION', 'INTEGRATION_EXCEPTION'],
    },
    {
      code: 'RISK',
      en: 'Fraud review',
      ar: 'مراجعة الاحتيال',
      team: 'RISK',
      caseTypes: ['FRAUD_REVIEW'],
    },
  ],
};
