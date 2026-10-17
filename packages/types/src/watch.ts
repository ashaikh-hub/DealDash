/**
 * Stage 6: Watch & Earn (advertising / reward campaign domain) and Rewards (non-cash points ledger).
 * Watch & Earn is NOT a Live Deal, Exclusive Deal or Voucher: it has its own lifecycle, budget, qualifying-view pipeline and
 * rewards. The merchant buys paid qualifying views; DealDash alone controls the customer reward and the qualification
 * rules. Money (campaign budget) is integer halalas; reward points are integers with NO SAR value anywhere.
 */

// ---------------------------------------------------------------- campaign lifecycle
export const WATCH_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'NEEDS_CHANGES',
  'REJECTED',
  'SCHEDULED',
  'LIVE',
  'PAUSED',
  'COMPLETED', // the funded paid views were all delivered (budget exhausted)
  'EXPIRED', // the schedule ended (possibly under-delivered)
  'CANCELLED', // stopped by the merchant (or by DealDash "stop")
  'SUSPENDED', // DealDash only: policy / fraud
] as const;
export type WatchStatus = (typeof WATCH_STATUSES)[number];

export const WATCH_TRANSITIONS: Record<WatchStatus, readonly WatchStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'SCHEDULED', 'LIVE', 'CANCELLED'],
  PENDING_REVIEW: ['NEEDS_CHANGES', 'REJECTED', 'SCHEDULED', 'LIVE', 'CANCELLED'],
  NEEDS_CHANGES: ['PENDING_REVIEW', 'SCHEDULED', 'LIVE', 'CANCELLED'],
  SCHEDULED: ['LIVE', 'PAUSED', 'EXPIRED', 'CANCELLED', 'SUSPENDED'],
  LIVE: ['PAUSED', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'SUSPENDED'],
  PAUSED: ['LIVE', 'SCHEDULED', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'SUSPENDED'],
  SUSPENDED: ['LIVE', 'SCHEDULED', 'PAUSED', 'COMPLETED', 'EXPIRED', 'CANCELLED'],
  COMPLETED: [],
  EXPIRED: [],
  CANCELLED: [],
  REJECTED: [],
};
export const canTransitionWatch = (from: WatchStatus, to: WatchStatus): boolean =>
  WATCH_TRANSITIONS[from].includes(to);
/** Statuses in which the campaign is finished and its unused budget is closed out. */
export const WATCH_FINAL_STATUSES: readonly WatchStatus[] = [
  'COMPLETED',
  'EXPIRED',
  'CANCELLED',
  'REJECTED',
];

export const WATCH_ACTIONS = [
  'CREATE',
  'UPDATE',
  'SUBMIT',
  'AUTO_APPROVE',
  'REQUEST_CHANGES',
  'APPROVE',
  'REJECT',
  'ACTIVATE',
  'PAUSE',
  'RESUME',
  'SUSPEND',
  'REINSTATE',
  'STOP',
  'CANCEL',
  'COMPLETE',
  'EXPIRE',
  'FUND',
  'CLOSE_OUT',
] as const;
export type WatchAction = (typeof WATCH_ACTIONS)[number];

export const WATCH_LINK_TYPES = ['NONE', 'MERCHANT', 'LIVE_DEAL', 'HOT_DEAL', 'VOUCHER'] as const;
export type WatchLinkType = (typeof WATCH_LINK_TYPES)[number];

// ---------------------------------------------------------------- instant prizes (WE-05, WE-44, FDR-19)
/** What the merchant gives: an item free, a discount, or an experience (all fulfilled by the merchant at its branches). */
export const WATCH_PRIZE_KINDS = ['FREE_ITEM', 'DISCOUNT', 'EXPERIENCE'] as const;
export type WatchPrizeKind = (typeof WATCH_PRIZE_KINDS)[number];
/** A prize decision's state: NOT_WON (the draw ran, no prize), ISSUED (won, redeemable), REDEEMED, EXPIRED. */
export const WATCH_PRIZE_STATUSES = ['NOT_WON', 'ISSUED', 'REDEEMED', 'EXPIRED'] as const;
export type WatchPrizeStatus = (typeof WATCH_PRIZE_STATUSES)[number];
/** Why a qualified view was not eligible to win (recorded with every decision). */
export const WATCH_PRIZE_INELIGIBLE = [
  'RISK_REVIEW',
  'CUSTOMER_LIMIT',
  'OUT_OF_STOCK',
  'GUARDRAILS_DISABLED',
] as const;
export type WatchPrizeIneligible = (typeof WATCH_PRIZE_INELIGIBLE)[number];
/** The QR text of a won prize is `DDW1.` + token (vouchers and reservations have their own prefixes). */
export const PRIZE_QR_PREFIX = 'DDW1.';

// ---------------------------------------------------------------- views (qualifying-view pipeline)
export const WATCH_VIEW_STATUSES = [
  'STARTED',
  'QUALIFIED',
  'INVALID',
  'CAPPED',
  'CREDITED_BACK', // a billed view later found invalid: merchant credited, reward reversed
] as const;
export type WatchViewStatus = (typeof WATCH_VIEW_STATUSES)[number];

/** Why a view did not qualify. Stored for Admin; customers only ever see the REASON CLASS. */
export const WATCH_REASONS = [
  'NOT_COMPLETED',
  'SKIPPED',
  'BACKGROUND_TIMEOUT',
  'STILL_WATCHING_FAILED',
  'TIMELINE_MISMATCH',
  'SESSION_EXPIRED',
  'CAMPAIGN_UNAVAILABLE',
  'NOT_TARGETED',
  'RISK_BLOCKED',
  'ALREADY_EARNED',
  'DAILY_CAP',
  'DEVICE_LIMIT',
  'ACCOUNT_LIMIT',
  'BUDGET_EXHAUSTED',
  'FRAUD_REVERSED',
] as const;
export type WatchReason = (typeof WATCH_REASONS)[number];

/** Customer-facing reason classes (never reveal detection logic). */
export const WATCH_REASON_CLASSES = [
  'LEFT_APP',
  'SKIPPED',
  'NO_RESPONSE',
  'ALREADY_EARNED',
  'DAILY_CAP',
  'BUDGET_EXHAUSTED',
  'UNAVAILABLE',
  'OTHER',
] as const;
export type WatchReasonClass = (typeof WATCH_REASON_CLASSES)[number];
export const reasonClassOf = (r: WatchReason | null | undefined): WatchReasonClass => {
  switch (r) {
    case 'BACKGROUND_TIMEOUT':
      return 'LEFT_APP';
    case 'SKIPPED':
    case 'NOT_COMPLETED':
      return 'SKIPPED';
    case 'STILL_WATCHING_FAILED':
      return 'NO_RESPONSE';
    case 'ALREADY_EARNED':
      return 'ALREADY_EARNED';
    case 'DAILY_CAP':
    case 'DEVICE_LIMIT':
    case 'ACCOUNT_LIMIT':
      return 'DAILY_CAP';
    case 'BUDGET_EXHAUSTED':
      return 'BUDGET_EXHAUSTED';
    case 'CAMPAIGN_UNAVAILABLE':
    case 'NOT_TARGETED':
      return 'UNAVAILABLE';
    default:
      return 'OTHER';
  }
};

export const WATCH_EVENT_TYPES = [
  'HEARTBEAT',
  'BACKGROUND',
  'FOREGROUND',
  'PROMPT_SHOWN',
  'PROMPT_ANSWERED',
  'ENDED',
] as const;
export type WatchEventType = (typeof WATCH_EVENT_TYPES)[number];

/** What the customer sees after completing a view. */
export const WATCH_OUTCOMES = ['QUALIFIED', 'NOT_QUALIFIED', 'CAPPED', 'HELD'] as const;
export type WatchOutcome = (typeof WATCH_OUTCOMES)[number];

// ---------------------------------------------------------------- fraud / risk
export const RISK_DECISIONS = ['ALLOW', 'HOLD', 'FLAG', 'BLOCK'] as const;
export type RiskDecision = (typeof RISK_DECISIONS)[number];

export const RISK_SIGNALS = [
  'DEVICE_BLOCKLISTED',
  'ACCOUNT_BLOCKLISTED',
  'DEVICE_SHARED_ACCOUNTS',
  'NEW_ACCOUNT_BURST',
  'IMPOSSIBLE_TIMELINE',
  'AUTOMATION_PATTERN',
  'PROMPT_TOO_FAST',
  'VIEW_VELOCITY',
  'DAILY_CAP_STREAK',
  'REPEAT_CAMPAIGN',
] as const;
export type RiskSignal = (typeof RISK_SIGNALS)[number];

export const RISK_FLAG_STATUSES = ['OPEN', 'IN_REVIEW', 'DECIDED'] as const;
export type RiskFlagStatus = (typeof RISK_FLAG_STATUSES)[number];
export const RISK_REVIEW_OUTCOMES = [
  'CLEAR',
  'HOLD_REWARDS',
  'REVERSE_REWARDS',
  'BLOCK_DEVICE',
  'BLOCK_ACCOUNT',
  'PAUSE_CAMPAIGN',
] as const;
export type RiskReviewOutcome = (typeof RISK_REVIEW_OUTCOMES)[number];

// ---------------------------------------------------------------- reward ledger (append-only, non-cash points)
export const REWARD_ENTRY_TYPES = [
  'EARN',
  'BONUS',
  'HOLD',
  'RELEASE',
  'REVERSE',
  'REDEEM',
  'EXPIRE',
  'ADMIN_ADJUSTMENT',
] as const;
export type RewardEntryType = (typeof REWARD_ENTRY_TYPES)[number];
export const REWARD_BUCKETS = ['AVAILABLE', 'HELD'] as const;
export type RewardBucket = (typeof REWARD_BUCKETS)[number];
export const REWARD_SOURCES = ['VIEW', 'REDEMPTION', 'ADJUSTMENT', 'EXPIRY'] as const;
export type RewardSource = (typeof REWARD_SOURCES)[number];

export const REWARD_ADJUSTMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type RewardAdjustmentStatus = (typeof REWARD_ADJUSTMENT_STATUSES)[number];

export const REWARD_ITEM_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type RewardItemStatus = (typeof REWARD_ITEM_STATUSES)[number];

// ---------------------------------------------------------------- campaign budget (ledger journals)
export const WATCH_FUNDING_SOURCES = ['MOCK_PAYMENT', 'ADMIN_CREDIT'] as const;
export type WatchFundingSource = (typeof WATCH_FUNDING_SOURCES)[number];

export const WATCH_NOTIFICATION_TYPES = [
  'REWARD_EARNED',
  'REWARD_HELD',
  'REWARD_RELEASED',
  'REWARD_REVERSED',
  'REWARD_EXPIRING',
  'CAMPAIGN_COMPLETED',
] as const;
export type WatchNotificationType = (typeof WATCH_NOTIFICATION_TYPES)[number];
