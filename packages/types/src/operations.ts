/**
 * Stage 8: operational gap closure. Vocabulary for the shared case framework, refunds, financial adjustments, settlement,
 * reconciliation exceptions, fraud / risk operations, restrictions and holds, reviews and moderation, notification delivery, SLA /
 * escalation and data requests. Behaviour (lifecycles, thresholds, SLAs, reasons, templates) is configuration (`operations`), never
 * application logic; nothing here is a market rule (refund law, tax, retention stay VALIDATE-<market>).
 */

// ---------------------------------------------------------------- shared exception / case framework
export const CASE_TYPES = [
  'PAYMENT_EXCEPTION',
  'REFUND_EXCEPTION',
  'VOUCHER_EXCEPTION',
  'EXCLUSIVE_REDEMPTION_EXCEPTION',
  'LIVE_BENEFIT_EXCEPTION',
  'WATCH_EARN_EXCEPTION',
  'LOYALTY_EXCEPTION',
  'SETTLEMENT_EXCEPTION',
  'RECONCILIATION_EXCEPTION',
  'BILLING_EXCEPTION',
  'MERCHANT_DATA_EXCEPTION',
  'PARTNER_DATA_EXCEPTION',
  'INTEGRATION_EXCEPTION',
  'FRAUD_REVIEW',
  'CUSTOMER_COMPLAINT',
  'OTHER_OPERATIONAL_EXCEPTION',
] as const;
export type CaseType = (typeof CASE_TYPES)[number];

/** Case types from Phase 3 that stay valid (existing cases keep their type). */
export const LEGACY_CASE_TYPES = [
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
] as const;

/**
 * Case statuses. The allowed moves are configuration (`operations.caseLifecycle`). IN_REVIEW and WAITING are the Phase 3 names and
 * stay valid for existing cases.
 */
export const CASE_STATUSES = [
  'OPEN',
  'INVESTIGATING',
  'AWAITING_CUSTOMER',
  'AWAITING_MERCHANT',
  'AWAITING_PARTNER',
  'AWAITING_FINANCE',
  'AWAITING_APPROVAL',
  'RESOLVED',
  'CLOSED',
  'REJECTED',
  'IN_REVIEW',
  'WAITING',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_TERMINAL_STATUSES: readonly CaseStatus[] = ['RESOLVED', 'CLOSED', 'REJECTED'];
export const CASE_OPEN_STATUSES: readonly CaseStatus[] = CASE_STATUSES.filter(
  (s) => !CASE_TERMINAL_STATUSES.includes(s),
);
export const CASE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type CaseSeverity = (typeof CASE_SEVERITIES)[number];
export const CASE_TEAMS = [
  'SUPPORT',
  'OPERATIONS',
  'FINANCE',
  'RISK',
  'MERCHANT_MANAGEMENT',
  'PARTNER_MANAGEMENT',
] as const;
export type CaseTeam = (typeof CASE_TEAMS)[number];
export const CASE_APPROVAL_STATES = ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type CaseApprovalState = (typeof CASE_APPROVAL_STATES)[number];
/** Note kinds on a case: a note, a logged customer / business contact, an escalation, a system event. */
export const CASE_NOTE_KINDS = ['NOTE', 'CONTACT', 'ESCALATION', 'SYSTEM'] as const;
export type CaseNoteKind = (typeof CASE_NOTE_KINDS)[number];
export const CONTACT_CHANNELS = ['PHONE', 'EMAIL', 'CHAT', 'IN_APP', 'IN_PERSON'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

// ---------------------------------------------------------------- SLA / escalation
export const SLA_STATES = ['ON_TRACK', 'WARNING', 'BREACHED', 'MET'] as const;
export type SlaState = (typeof SLA_STATES)[number];
/** Work that carries an SLA (the targets are configuration, by area and priority). */
export const SLA_AREAS = [
  'CASE',
  'APPROVAL',
  'REFUND',
  'ADJUSTMENT',
  'RECONCILIATION',
  'SETTLEMENT',
  'FRAUD',
  'INTEGRATION',
  'RESTRICTION',
  'MODERATION',
  'DATA_REQUEST',
] as const;
export type SlaArea = (typeof SLA_AREAS)[number];

// ---------------------------------------------------------------- financial adjustments (append-only; maker-checker by configuration)
export const ADJUSTMENT_KINDS = [
  'INVOICE_CORRECTION',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'SETTLEMENT_ADJUSTMENT',
  'RECONCILIATION_ADJUSTMENT',
  'POINTS_ADJUSTMENT',
  'REWARD_REVERSAL',
  'FUNDING_ADJUSTMENT',
  'CAMPAIGN_UTILIZATION_CORRECTION',
  'ADMIN_ADJUSTMENT',
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];
export const ADJUSTMENT_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'APPLIED',
  'REJECTED',
  'FAILED',
] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];
export const ADJUSTMENT_DIRECTIONS = ['CREDIT', 'DEBIT'] as const;
export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

// ---------------------------------------------------------------- refunds (Stage 5 engine; order-level exceptional refunds)
export const ORDER_REFUND_REASONS = ['DUPLICATE_PAYMENT', 'FAILED_ISSUANCE', 'PAYMENT_REVERSAL'] as const;
export type OrderRefundReason = (typeof ORDER_REFUND_REASONS)[number];

// ---------------------------------------------------------------- settlement
export const SETTLEMENT_STATUSES = [
  'PENDING',
  'ELIGIBLE',
  'HELD',
  'DISPUTE_HOLD',
  'PARTIALLY_PAID',
  'COMPLETED',
  'FAILED',
  'REVERSED',
] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const SETTLEMENT_RECON_STATES = ['UNRECONCILED', 'MATCHED', 'EXCEPTION'] as const;
export type SettlementReconState = (typeof SETTLEMENT_RECON_STATES)[number];

// ---------------------------------------------------------------- reconciliation exceptions
export const RECON_SOURCES = [
  'PAYMENT_GATEWAY',
  'VOUCHER_PURCHASE',
  'VOUCHER_REDEMPTION',
  'MERCHANT_PAYABLE',
  'SPONSOR_FUNDING',
  'INVOICE',
  'RECEIPT',
  'SETTLEMENT',
  'REFUND',
  'WATCH_FUNDING',
  'LOYALTY_FUNDING',
] as const;
export type ReconSource = (typeof RECON_SOURCES)[number];
export const RECON_STATUSES = [
  'MATCHED',
  'PARTIAL_MATCH',
  'MISSING_INTERNAL',
  'MISSING_EXTERNAL',
  'AMOUNT_MISMATCH',
  'DUPLICATE',
  'TIMING_DIFFERENCE',
  'MANUAL_REVIEW',
  'RESOLVED',
] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];
export const RECON_EXCEPTION_STATUSES: readonly ReconStatus[] = [
  'PARTIAL_MATCH',
  'MISSING_INTERNAL',
  'MISSING_EXTERNAL',
  'AMOUNT_MISMATCH',
  'DUPLICATE',
  'TIMING_DIFFERENCE',
  'MANUAL_REVIEW',
];

// ---------------------------------------------------------------- fraud / risk operations (rule based: ALLOW / BLOCK / FLAG)
export const RISK_DOMAINS = [
  'WATCH',
  'REDEMPTION',
  'REFUND',
  'LOYALTY',
  'BRANCH',
  'CUSTOMER',
  'MERCHANT',
  'PARTNER',
] as const;
export type RiskDomain = (typeof RISK_DOMAINS)[number];
/** Operational detection rules (thresholds are configuration). Watch & Earn keeps its own Stage 6 rules. */
export const OPS_RISK_RULES = [
  'REPEATED_CODE_ATTEMPTS',
  'SUSPICIOUS_REDEMPTION',
  'REPEATED_REFUND_ATTEMPTS',
  'SUSPICIOUS_BRANCH_ACTIVITY',
  'LOYALTY_ABUSE',
  'UNUSUAL_CUSTOMER_ACTIVITY',
  'MERCHANT_REFUND_ANOMALY',
  'DUPLICATE_QUALIFIED_VIEWS',
] as const;
export type OpsRiskRule = (typeof OPS_RISK_RULES)[number];
export const OPS_RISK_DECISIONS = ['ALLOW', 'FLAG', 'BLOCK'] as const;
export type OpsRiskDecision = (typeof OPS_RISK_DECISIONS)[number];

// ---------------------------------------------------------------- restrictions and holds
export const RESTRICTION_KINDS = [
  'CUSTOMER_RESTRICTION',
  'MERCHANT_CAMPAIGN_HOLD',
  'BRANCH_REDEMPTION_HOLD',
  'USER_SUSPENSION',
  'INTEGRATION_SUSPENSION',
  'FINANCIAL_HOLD',
] as const;
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];
export const OPS_RESTRICTION_STATUSES = [
  'PENDING_APPROVAL',
  'ACTIVE',
  'LIFTED',
  'EXPIRED',
  'REJECTED',
] as const;
export type OpsRestrictionStatus = (typeof OPS_RESTRICTION_STATUSES)[number];

// ---------------------------------------------------------------- reviews and moderation (MR-52 / FDC-05)
export const REVIEW_STATUSES = ['PENDING_REVIEW', 'PUBLISHED', 'REPORTED', 'HIDDEN', 'REMOVED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
/** Interactions that make a review "Verified". Watch & Earn viewing never qualifies. */
export const VERIFIED_INTERACTIONS = [
  'VOUCHER_REDEMPTION',
  'EXCLUSIVE_REDEMPTION',
  'CONTROLLED_OFFER_REDEMPTION',
] as const;
export type VerifiedInteraction = (typeof VERIFIED_INTERACTIONS)[number];
export const REPORT_REASONS = [
  'SPAM',
  'OFFENSIVE',
  'FALSE_INFORMATION',
  'CONFLICT_OF_INTEREST',
  'PRIVACY',
  'ILLEGAL',
  'OTHER',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const MODERATION_SUBJECTS = ['REVIEW', 'MERCHANT_PROFILE', 'CAMPAIGN', 'MEDIA'] as const;
export type ModerationSubject = (typeof MODERATION_SUBJECTS)[number];
export const MODERATION_STATUSES = [
  'PENDING_REVIEW',
  'REPORTED',
  'APPROVED',
  'REJECTED',
  'HIDDEN',
  'RESTORED',
] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];
export const MODERATION_DECISIONS = ['APPROVE', 'REJECT', 'HIDE', 'RESTORE'] as const;
export type ModerationDecision = (typeof MODERATION_DECISIONS)[number];

// ---------------------------------------------------------------- notification operations
export const DELIVERY_CHANNELS = ['IN_APP', 'EMAIL', 'PUSH', 'SMS'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export const DELIVERY_STATUSES = [
  'QUEUED',
  'SENT',
  'DELIVERED',
  'FAILED',
  'RETRYING',
  'SUPPRESSED',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

// ---------------------------------------------------------------- data requests (privacy; retention is VALIDATE-<market>)
export const DATA_REQUEST_TYPES = ['EXPORT', 'DELETION'] as const;
export type DataRequestType = (typeof DATA_REQUEST_TYPES)[number];
export const DATA_REQUEST_STATUSES = [
  'REQUESTED',
  'PENDING_APPROVAL',
  'COMPLETED',
  'REJECTED',
] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

// ---------------------------------------------------------------- operations command centre: exception areas and drill levels
export const OPS_EXCEPTION_AREAS = [
  'PAYMENT_ISSUES',
  'REDEMPTION_FAILURES',
  'VOUCHER_EXCEPTIONS',
  'WATCH_EXCEPTIONS',
  'LOYALTY_EXCEPTIONS',
  'IMPORT_FAILURES',
  'INTEGRATION_FAILURES',
  'SETTLEMENT_EXCEPTIONS',
  'RECONCILIATION_EXCEPTIONS',
  'DISPUTES',
  'FRAUD_FLAGS',
  'OVERDUE_TASKS',
  'APPROVAL_BACKLOG',
  'NOTIFICATION_FAILURES',
  'UNRESOLVED_SUPPORT',
] as const;
export type OpsExceptionArea = (typeof OPS_EXCEPTION_AREAS)[number];
export const OPS_DRILL_LEVELS = [
  'GLOBAL',
  'MARKET',
  'LEGAL_ENTITY',
  'BUSINESS_ACCOUNT',
  'BRAND',
  'CITY',
  'BRANCH',
  'PRODUCT',
  'CAMPAIGN',
  'TRANSACTION',
] as const;
export type OpsDrillLevel = (typeof OPS_DRILL_LEVELS)[number];
