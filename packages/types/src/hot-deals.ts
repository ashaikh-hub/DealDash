/**
 * Stage 4: Exclusive Deals, free reservations, redemption. Exclusive Deals are their own product domain with their own lifecycle:
 * they share only kernel pieces (eligibility, media, localisation, audit) with Live Deals.
 */

// ---------------------------------------------------------------- Exclusive Deal lifecycle
export const HOT_DEAL_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'NEEDS_CHANGES',
  'SCHEDULED',
  'LIVE',
  'PAUSED',
  'SOLD_OUT',
  'EXPIRED',
  'CANCELLED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type HotDealStatus = (typeof HOT_DEAL_STATUSES)[number];

/**
 * Explicit state machine (Business Rules section 22: Draft, review, Live, Paused, Sold Out, Expired, Cancelled, Suspended).
 * SOLD_OUT is entered and left by the inventory logic (stock reaches zero / stock comes back). EXPIRED, CANCELLED and
 * REJECTED are terminal.
 */
export const HOT_DEAL_TRANSITIONS: Record<HotDealStatus, readonly HotDealStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'SCHEDULED', 'LIVE'],
  PENDING_REVIEW: ['NEEDS_CHANGES', 'REJECTED', 'SCHEDULED', 'LIVE'],
  NEEDS_CHANGES: ['PENDING_REVIEW', 'SCHEDULED', 'LIVE'],
  SCHEDULED: ['LIVE', 'PAUSED', 'EXPIRED', 'CANCELLED', 'SUSPENDED'],
  LIVE: ['PAUSED', 'SOLD_OUT', 'EXPIRED', 'CANCELLED', 'SUSPENDED'],
  PAUSED: ['LIVE', 'SCHEDULED', 'SOLD_OUT', 'EXPIRED', 'CANCELLED', 'SUSPENDED'],
  SOLD_OUT: ['LIVE', 'PAUSED', 'EXPIRED', 'CANCELLED', 'SUSPENDED'],
  SUSPENDED: ['LIVE', 'SCHEDULED', 'PAUSED', 'SOLD_OUT', 'EXPIRED', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
  REJECTED: [],
};
export const canTransitionHotDeal = (from: HotDealStatus, to: HotDealStatus): boolean =>
  HOT_DEAL_TRANSITIONS[from].includes(to);

export const HOT_DEAL_ACTIONS = [
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
  'EXPIRE',
  'PAUSE',
  'RESUME',
  'SUSPEND',
  'REINSTATE',
  'CANCEL',
  'MINOR_EDIT',
  'STOCK_CHANGED',
] as const;
export type HotDealAction = (typeof HOT_DEAL_ACTIONS)[number];

export const HOT_DEAL_LIMIT_TYPES = ['TIME', 'QUANTITY', 'TIME_AND_QUANTITY'] as const;
export type HotDealLimitType = (typeof HOT_DEAL_LIMIT_TYPES)[number];

/** Statuses a customer can see in discovery (sold-out deals stay visible, clearly marked). */
export const HOT_DEAL_PUBLIC_STATUSES: readonly HotDealStatus[] = ['LIVE', 'SOLD_OUT'];

// ---------------------------------------------------------------- reservations
/**
 * FREE reservations (policy-allowed only, RC-05): creation equals confirmation (HELD), the units are held until `expiresAt`.
 * Paid commitments (RC-30): PENDING_PAYMENT holds the units for the payment window (no code yet), then HELD once the provider confirms
 * the payment, or PAYMENT_FAILED (units released, no charge, no strike).
 * EXPIRED means the hold elapsed unredeemed; customers and staff see the neutral wording "Reservation not completed".
 */
export const RESERVATION_STATUSES = [
  'HELD',
  'REDEEMED',
  'EXPIRED',
  'CANCELLED',
  'PENDING_PAYMENT',
  'PAYMENT_FAILED',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  PENDING_PAYMENT: ['HELD', 'PAYMENT_FAILED', 'CANCELLED'],
  HELD: ['REDEEMED', 'EXPIRED', 'CANCELLED'],
  // a manager/DealDash reversal gives the customer a fresh hold (HELD), or cancels it when the campaign is no longer available
  REDEEMED: ['HELD', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
  PAYMENT_FAILED: [],
};
export const canTransitionReservation = (from: ReservationStatus, to: ReservationStatus): boolean =>
  RESERVATION_TRANSITIONS[from].includes(to);

export const CANCELLED_BY = ['CUSTOMER', 'MERCHANT', 'DEALDASH', 'SYSTEM'] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

export const RESERVATION_EVENT_TYPES = [
  'CREATED',
  'EXPIRING_NOTICE',
  'CANCELLED',
  'EXPIRED',
  'NO_SHOW_COUNTED',
  'REDEEMED',
  'REDEMPTION_REVERSED',
  /** RC-52: DealDash reset a counted no-show strike (reason in the note). */
  'STRIKE_RESET',
  // phase 2 money events (RC-82)
  'PAYMENT_PENDING',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
  'REFUND_REQUESTED',
  'REFUNDED',
  'REFUND_FAILED',
  'FORFEITED',
  'SETTLED_TO_MERCHANT',
  // phase 3 card pre-authorisation (RC-90..RC-95)
  'AUTHORISATION_REQUESTED',
  'AUTHORISED',
  'AUTHORISATION_FAILED',
  'AUTHORISATION_EXPIRED',
  'HOLD_RELEASED',
  'HOLD_CAPTURED',
] as const;

/**
 * Card pre-authorisation states (phase 3): REQUESTED -> AUTHORISED | FAILED | CANCELLED; AUTHORISED -> RELEASED | CAPTURED |
 * PARTIALLY_CAPTURED (remainder released) | EXPIRED (the provider's hold lapsed).
 */
export const RESERVATION_AUTH_STATUSES = [
  'REQUESTED',
  'AUTHORISED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'RELEASED',
  'CAPTURED',
  'PARTIALLY_CAPTURED',
] as const;
export type ReservationAuthStatus = (typeof RESERVATION_AUTH_STATUSES)[number];
export const RESERVATION_AUTH_TRANSITIONS: Record<
  ReservationAuthStatus,
  readonly ReservationAuthStatus[]
> = {
  REQUESTED: ['AUTHORISED', 'FAILED', 'CANCELLED'],
  AUTHORISED: ['RELEASED', 'CAPTURED', 'PARTIALLY_CAPTURED', 'EXPIRED'],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  RELEASED: [],
  CAPTURED: [],
  PARTIALLY_CAPTURED: [],
};
export type ReservationEventType = (typeof RESERVATION_EVENT_TYPES)[number];

/**
 * Reservation commitment model (founder decision 2026-10-15, RC-03..RC-05): a reservation is not a free hold by default. The merchant
 * picks one paid method; FREE exists only where the effective reservation policy allows it (development / testing).
 */
export const COMMITMENT_METHODS = ['FREE', 'FULL_PREPAYMENT', 'DEPOSIT', 'CARD_PREAUTH'] as const;
export type CommitmentMethod = (typeof COMMITMENT_METHODS)[number];
export const PAID_COMMITMENT_METHODS = ['FULL_PREPAYMENT', 'DEPOSIT', 'CARD_PREAUTH'] as const;
export type PaidCommitmentMethod = (typeof PAID_COMMITMENT_METHODS)[number];

/** Money state of a reservation's commitment (RC-30, RC-43, RC-51). FREE reservations are NOT_REQUIRED. */
export const RESERVATION_PAYMENT_STATUSES = [
  'NOT_REQUIRED',
  'PENDING',
  'PAID',
  'AUTHORISED',
  'CAPTURED',
  'VOIDED',
  'FAILED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'FORFEITED',
] as const;
export type ReservationPaymentStatus = (typeof RESERVATION_PAYMENT_STATUSES)[number];

export const RESTRICTION_STATUSES = ['ACTIVE', 'LIFTED', 'ENDED'] as const;
export type RestrictionStatus = (typeof RESTRICTION_STATUSES)[number];

// ---------------------------------------------------------------- redemption (Staff)
/** One adaptive validation/redemption result for frontline staff (Staff design section 5). */
export const REDEMPTION_RESULTS = [
  'VALID',
  'REDEEMED',
  'INVALID_CODE',
  'EXPIRED',
  'ALREADY_REDEEMED',
  'WRONG_BRANCH',
  'INELIGIBLE',
  'NOT_ACTIVE',
  'CAMPAIGN_UNAVAILABLE',
  'NOT_VALID_YET',
  // Stage 5 (vouchers)
  'VOUCHER_SUSPENDED',
  'REFUNDED',
] as const;
export type RedemptionResult = (typeof REDEMPTION_RESULTS)[number];

export const REDEMPTION_STATUSES = ['REDEEMED', 'REVERSED'] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

/** QR text prefix. The payload is an opaque random token, never a database id. */
export const QR_PREFIX = 'DD1.';

// ---------------------------------------------------------------- notifications (in-app foundation)
export const NOTIFICATION_TYPES = [
  'RESERVATION_CONFIRMED',
  'RESERVATION_EXPIRING',
  'RESERVATION_EXPIRED',
  'RESERVATION_CANCELLED',
  'REDEMPTION_SUCCESS',
  // Stage 5 (vouchers)
  'PURCHASE_SUCCEEDED',
  'PAYMENT_FAILED',
  'VOUCHER_ISSUED',
  'VOUCHER_EXPIRING',
  'REFUND_UPDATED',
  'VOUCHER_REDEEMED',
  // Stage 6 (Watch & Earn and Rewards)
  'REWARD_EARNED',
  'REWARD_HELD',
  'REWARD_RELEASED',
  'REWARD_REVERSED',
  'REWARD_EXPIRING',
  'CAMPAIGN_COMPLETED',
  /** Phase 4: an operational alert for business and DealDash users. */
  'ALERT',
  /** Stage 8: a support / exception case about the customer changed (resolution, request for information). */
  'CASE_UPDATED',
  /** Stage 8: a temporary restriction was placed on or lifted from the customer's account (issued rights are never removed). */
  'ACCOUNT_RESTRICTION',
  /** My benefits: an employer verification was confirmed, is due for renewal, expired or was removed; a card was added / removed. */
  'BENEFIT_UPDATED',
  /** NT-02: the customer finished setting up their profile (welcome). */
  'ACCOUNT_WELCOME',
  /** Reservation commitment (2026-10-15): a payment did not go through; a refund was made / failed; an amount was kept per the terms. */
  'RESERVATION_PAYMENT_FAILED',
  'RESERVATION_REFUND_UPDATED',
  'RESERVATION_FORFEITED',
  /** Phase 3: a card hold was released (nothing charged) / captured (charged under the accepted terms). */
  'RESERVATION_HOLD_RELEASED',
  'RESERVATION_HOLD_CAPTURED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Customer notification categories (CS-06). Transactional categories cannot be turned off (NT-40): they always reach the inbox and
 * push. Optional categories let the customer turn push off; the inbox keeps everything. Marketing is a separate opt-in consent.
 */
export const CUSTOMER_NOTIFICATION_CATEGORIES = {
  ORDERS: { required: true },
  ACCOUNT: { required: true },
  REWARDS: { required: false },
  BENEFITS: { required: false },
} as const;
export type CustomerNotificationCategory = keyof typeof CUSTOMER_NOTIFICATION_CATEGORIES;

export const NOTIFICATION_CATEGORY_OF: Partial<
  Record<NotificationType, CustomerNotificationCategory>
> = {
  RESERVATION_CONFIRMED: 'ORDERS',
  RESERVATION_EXPIRING: 'ORDERS',
  RESERVATION_EXPIRED: 'ORDERS',
  RESERVATION_CANCELLED: 'ORDERS',
  RESERVATION_PAYMENT_FAILED: 'ORDERS',
  RESERVATION_REFUND_UPDATED: 'ORDERS',
  RESERVATION_FORFEITED: 'ORDERS',
  RESERVATION_HOLD_RELEASED: 'ORDERS',
  RESERVATION_HOLD_CAPTURED: 'ORDERS',
  REDEMPTION_SUCCESS: 'ORDERS',
  PURCHASE_SUCCEEDED: 'ORDERS',
  PAYMENT_FAILED: 'ORDERS',
  VOUCHER_ISSUED: 'ORDERS',
  VOUCHER_EXPIRING: 'ORDERS',
  REFUND_UPDATED: 'ORDERS',
  VOUCHER_REDEEMED: 'ORDERS',
  CASE_UPDATED: 'ACCOUNT',
  ACCOUNT_RESTRICTION: 'ACCOUNT',
  ACCOUNT_WELCOME: 'ACCOUNT',
  REWARD_EARNED: 'REWARDS',
  REWARD_HELD: 'REWARDS',
  REWARD_RELEASED: 'REWARDS',
  REWARD_REVERSED: 'REWARDS',
  REWARD_EXPIRING: 'REWARDS',
  BENEFIT_UPDATED: 'BENEFITS',
};

export const PRODUCT_TYPES = ['LIVE', 'HOT', 'VOUCHER', 'WATCH'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
