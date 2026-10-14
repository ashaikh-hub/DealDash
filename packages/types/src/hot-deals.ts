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
 * Free reservation (MVP): creation equals confirmation, the units are held until `expiresAt`.
 * EXPIRED means the hold elapsed unredeemed; customers and staff see the neutral wording "Reservation not completed".
 */
export const RESERVATION_STATUSES = ['HELD', 'REDEEMED', 'EXPIRED', 'CANCELLED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const RESERVATION_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  HELD: ['REDEEMED', 'EXPIRED', 'CANCELLED'],
  // a manager/DealDash reversal gives the customer a fresh hold (HELD), or cancels it when the campaign is no longer available
  REDEEMED: ['HELD', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
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
] as const;
export type ReservationEventType = (typeof RESERVATION_EVENT_TYPES)[number];

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
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const PRODUCT_TYPES = ['LIVE', 'HOT', 'VOUCHER', 'WATCH'] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
