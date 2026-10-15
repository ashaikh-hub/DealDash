/**
 * Stage 5: Vouchers, purchase, payments, QR redemption, refunds, ledger foundation.
 * A Voucher is a commerce / financial product with its own lifecycle. It shares only kernel pieces with Live Deals and
 * Exclusive Deals (eligibility, media, localisation, audit, redemption framework). All money is integer halalas (SAR minor units).
 */

// ---------------------------------------------------------------- Voucher (the product) lifecycle
export const VOUCHER_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'NEEDS_CHANGES',
  'REJECTED',
  'SCHEDULED',
  'ON_SALE',
  'PAUSED',
  'SOLD_OUT',
  'ENDED',
  'SUSPENDED',
] as const;
export type VoucherStatus = (typeof VOUCHER_STATUSES)[number];

/**
 * ENDED (the sale window closed or the merchant stopped selling) and REJECTED are terminal. Already-sold vouchers are NOT
 * affected by any of these (VC-39): they stay owned and redeemable, except while the product is SUSPENDED by DealDash.
 */
export const VOUCHER_TRANSITIONS: Record<VoucherStatus, readonly VoucherStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'SCHEDULED', 'ON_SALE'],
  PENDING_REVIEW: ['NEEDS_CHANGES', 'REJECTED', 'SCHEDULED', 'ON_SALE'],
  NEEDS_CHANGES: ['PENDING_REVIEW', 'SCHEDULED', 'ON_SALE'],
  SCHEDULED: ['ON_SALE', 'PAUSED', 'ENDED', 'SUSPENDED'],
  ON_SALE: ['PAUSED', 'SOLD_OUT', 'ENDED', 'SUSPENDED'],
  PAUSED: ['ON_SALE', 'SCHEDULED', 'SOLD_OUT', 'ENDED', 'SUSPENDED'],
  SOLD_OUT: ['ON_SALE', 'PAUSED', 'ENDED', 'SUSPENDED'],
  SUSPENDED: ['ON_SALE', 'SCHEDULED', 'PAUSED', 'SOLD_OUT', 'ENDED'],
  ENDED: [],
  REJECTED: [],
};
export const canTransitionVoucher = (from: VoucherStatus, to: VoucherStatus): boolean =>
  VOUCHER_TRANSITIONS[from].includes(to);

export const VOUCHER_ACTIONS = [
  'CREATE',
  'UPDATE',
  'SUBMIT',
  'AUTO_APPROVE',
  'REQUEST_CHANGES',
  'APPROVE',
  'REJECT',
  'ACTIVATE',
  'SOLD_OUT',
  'REOPEN',
  'END',
  'PAUSE',
  'RESUME',
  'SUSPEND',
  'REINSTATE',
  'MINOR_EDIT',
  'STOCK_CHANGED',
] as const;
export type VoucherAction = (typeof VOUCHER_ACTIONS)[number];

export const VOUCHER_VALIDITY_TYPES = ['FIXED_DATE', 'DAYS_FROM_PURCHASE'] as const;
export type VoucherValidityType = (typeof VOUCHER_VALIDITY_TYPES)[number];

/** Statuses in which customers can buy (checkout). Sold-out vouchers stay visible, clearly marked. */
export const VOUCHER_PURCHASABLE_STATUSES: readonly VoucherStatus[] = ['ON_SALE'];
export const VOUCHER_PUBLIC_STATUSES: readonly VoucherStatus[] = ['ON_SALE', 'SOLD_OUT'];

// ---------------------------------------------------------------- Voucher instance (customer ownership)
/** A voucher instance exists ONLY after a payment is confirmed as SUCCEEDED (VC-05, VC-12). */
export const VOUCHER_INSTANCE_STATUSES = [
  'ACTIVE',
  'REDEEMED',
  'EXPIRED',
  'REFUNDED',
  'VOIDED',
] as const;
export type VoucherInstanceStatus = (typeof VOUCHER_INSTANCE_STATUSES)[number];

export const VOUCHER_INSTANCE_TRANSITIONS: Record<
  VoucherInstanceStatus,
  readonly VoucherInstanceStatus[]
> = {
  ACTIVE: ['REDEEMED', 'EXPIRED', 'REFUNDED', 'VOIDED'],
  // an approved reversal restores the instrument to ACTIVE (RD-40)
  REDEEMED: ['ACTIVE'],
  EXPIRED: [],
  REFUNDED: [],
  VOIDED: [],
};
export const canTransitionInstance = (
  from: VoucherInstanceStatus,
  to: VoucherInstanceStatus,
): boolean => VOUCHER_INSTANCE_TRANSITIONS[from].includes(to);

/** Customer-facing wallet state. */
export const WALLET_STATES = [
  'ACTIVE',
  'USED',
  'EXPIRED',
  'REFUNDED',
  'REFUND_PENDING',
  'VOIDED',
] as const;
export type WalletState = (typeof WALLET_STATES)[number];

// ---------------------------------------------------------------- orders and payments
export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
  // reserved for Phase 2 (partial refunds); never produced or exposed in the MVP
  'PARTIALLY_REFUNDED',
  'REVERSED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  CREATED: ['PENDING', 'FAILED', 'CANCELLED'],
  PENDING: ['SUCCEEDED', 'FAILED', 'CANCELLED'],
  SUCCEEDED: ['REFUND_PENDING', 'REVERSED'],
  REFUND_PENDING: ['REFUNDED', 'SUCCEEDED'],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ['REFUND_PENDING', 'REFUNDED'],
  REVERSED: [],
  // money can be captured by the PSP after we already closed the attempt (late success): it is then refunded, never issued
  FAILED: ['SUCCEEDED'],
  CANCELLED: ['SUCCEEDED'],
};
export const canTransitionPayment = (from: PaymentStatus, to: PaymentStatus): boolean =>
  PAYMENT_TRANSITIONS[from].includes(to);

export const PAYMENT_EVENT_OUTCOMES = [
  'APPLIED',
  'DUPLICATE',
  'IGNORED',
  'REJECTED',
  'LATE_SUCCESS',
] as const;
export type PaymentEventOutcome = (typeof PAYMENT_EVENT_OUTCOMES)[number];

// ---------------------------------------------------------------- refunds
export const REFUND_STATUSES = [
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'PROCESSING',
  'REFUNDED',
  'FAILED',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_TRANSITIONS: Record<RefundStatus, readonly RefundStatus[]> = {
  REQUESTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['PROCESSING'],
  PROCESSING: ['REFUNDED', 'FAILED'],
  FAILED: ['PROCESSING'],
  REJECTED: [],
  REFUNDED: [],
};
export const canTransitionRefund = (from: RefundStatus, to: RefundStatus): boolean =>
  REFUND_TRANSITIONS[from].includes(to);

export const REFUND_KINDS = ['CUSTOMER_REQUEST', 'ADMIN_INITIATED', 'SYSTEM'] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];

// ---------------------------------------------------------------- ledger foundation
export const LEDGER_ACCOUNT_FAMILIES = [
  'PSP_CLEARING',
  'MERCHANT_HELD',
  'MERCHANT_SETTLEMENT_ELIGIBLE',
  'PLATFORM_REVENUE',
  'EXPIRED_VALUE',
  'ADJUSTMENTS',
  // Stage 6: campaign budget money and its separately identified unused balance
  'CAMPAIGN_BUDGET',
  'CAMPAIGN_UNUSED',
  // Commercial finance: prepaid funds held per business, receivables, funding utilised for sponsors / merchant reimbursement
  'CAMPAIGN_FUNDS_HELD',
  'RECEIVABLE',
  'FUNDING_UTILIZED',
] as const;
export type LedgerAccountFamily = (typeof LEDGER_ACCOUNT_FAMILIES)[number];

export const LEDGER_JOURNAL_TYPES = [
  'SALE',
  'REDEMPTION',
  'REFUND',
  'REVERSAL',
  'EXPIRY',
  'ADJUSTMENT',
  'CAMPAIGN_FUNDING',
  'CAMPAIGN_CONSUMPTION',
  'CAMPAIGN_CREDIT_BACK',
  'CAMPAIGN_RELEASE',
  'FUNDING_RECEIVED',
  'FUNDING_UTILIZED',
  'FUNDING_RELEASED',
  'DOCUMENT_ADJUSTMENT',
  // Stage 8: recorded merchant settlement payouts and their reversal
  'SETTLEMENT_PAYOUT',
  'SETTLEMENT_REVERSAL',
  // Reservation commitment (2026-10-15): money received, amount kept for the merchant net of fee, refund
  'RESERVATION_PAYMENT',
  'RESERVATION_SETTLEMENT',
  'RESERVATION_REFUND',
] as const;
export type LedgerJournalType = (typeof LEDGER_JOURNAL_TYPES)[number];

export const PAYABLE_EVENT_TYPES = [
  'SOLD',
  'ISSUED',
  'REDEEMED',
  'ELIGIBLE',
  'REFUNDED',
  'REDEMPTION_REVERSED',
  'EXPIRED',
  'ADJUSTMENT',
] as const;
export type PayableEventType = (typeof PAYABLE_EVENT_TYPES)[number];

// ---------------------------------------------------------------- support cases (minimal, linked to commerce objects)
export const SUPPORT_CASE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;
export type SupportCaseStatus = (typeof SUPPORT_CASE_STATUSES)[number];
export const SUPPORT_CASE_TYPES = [
  'VOUCHER_ISSUE',
  'PAYMENT_ISSUE',
  'REFUND_QUESTION',
  'REDEMPTION_ISSUE',
  'OTHER',
] as const;
export type SupportCaseType = (typeof SUPPORT_CASE_TYPES)[number];

// ---------------------------------------------------------------- codes and notifications
/** QR text prefix for vouchers (reservations use `DD1.`). The payload is an opaque random token, never a database id. */
export const VOUCHER_QR_PREFIX = 'DV1.';

export const VOUCHER_NOTIFICATION_TYPES = [
  'PURCHASE_SUCCEEDED',
  'PAYMENT_FAILED',
  'VOUCHER_ISSUED',
  'VOUCHER_EXPIRING',
  'REFUND_UPDATED',
  'VOUCHER_REDEEMED',
] as const;
export type VoucherNotificationType = (typeof VOUCHER_NOTIFICATION_TYPES)[number];
