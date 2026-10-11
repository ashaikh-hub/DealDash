/**
 * Stage 3: Live Deal vocabulary shared by the API and every app.
 * Live Deals have their own lifecycle (they never share a status model with Exclusive Deals, Vouchers or Watch & Earn).
 */

export const LIVE_DEAL_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'NEEDS_CHANGES',
  'SCHEDULED',
  'LIVE',
  'PAUSED',
  'EXPIRED',
  'REJECTED',
  'SUSPENDED',
] as const;
export type LiveDealStatus = (typeof LIVE_DEAL_STATUSES)[number];

/**
 * Explicit state machine. Anything not listed here is an illegal transition and is rejected by the domain layer.
 * EXPIRED and REJECTED are terminal. SUSPENDED can only be left by DealDash (reinstate) and returns to the prior state.
 */
export const LIVE_DEAL_TRANSITIONS: Record<LiveDealStatus, readonly LiveDealStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'SCHEDULED', 'LIVE'],
  PENDING_REVIEW: ['NEEDS_CHANGES', 'REJECTED', 'SCHEDULED', 'LIVE'],
  NEEDS_CHANGES: ['PENDING_REVIEW', 'SCHEDULED', 'LIVE'],
  SCHEDULED: ['LIVE', 'PAUSED', 'EXPIRED', 'SUSPENDED'],
  LIVE: ['PAUSED', 'EXPIRED', 'SUSPENDED'],
  PAUSED: ['LIVE', 'SCHEDULED', 'EXPIRED', 'SUSPENDED'],
  SUSPENDED: ['LIVE', 'SCHEDULED', 'PAUSED', 'EXPIRED'],
  EXPIRED: [],
  REJECTED: [],
};

export const canTransitionLiveDeal = (from: LiveDealStatus, to: LiveDealStatus): boolean =>
  LIVE_DEAL_TRANSITIONS[from].includes(to);

/** Statuses in which the merchant may edit the deal freely (no review needed for the edit itself). */
export const LIVE_DEAL_FREE_EDIT: readonly LiveDealStatus[] = ['DRAFT', 'NEEDS_CHANGES'];
/** Approved statuses: edits are classified as minor (publish with audit) or material (review/versioning). */
export const LIVE_DEAL_APPROVED_STATUSES: readonly LiveDealStatus[] = [
  'SCHEDULED',
  'LIVE',
  'PAUSED',
];
/** Statuses that appear in the Admin review queue. */
export const LIVE_DEAL_IN_QUEUE: readonly LiveDealStatus[] = ['PENDING_REVIEW'];

export const LIVE_DEAL_ACTIONS = [
  'CREATE',
  'UPDATE',
  'SUBMIT',
  'AUTO_APPROVE',
  'REQUEST_CHANGES',
  'APPROVE',
  'REJECT',
  'ACTIVATE',
  'EXPIRE',
  'PAUSE',
  'RESUME',
  'SUSPEND',
  'REINSTATE',
  'END',
  'MINOR_EDIT',
  'REVISION_SAVED',
  'REVISION_SUBMIT',
  'REVISION_AUTO_APPROVE',
  'REVISION_REQUEST_CHANGES',
  'REVISION_APPROVE',
  'REVISION_REJECT',
  'REVISION_DISCARD',
] as const;
export type LiveDealAction = (typeof LIVE_DEAL_ACTIONS)[number];

export const LIVE_DEAL_REVISION_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'NEEDS_CHANGES',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type LiveDealRevisionStatus = (typeof LIVE_DEAL_REVISION_STATUSES)[number];

export const LIVE_DEAL_MECHANICS = [
  'PERCENTAGE_OFF',
  'AMOUNT_OFF',
  'BOGO',
  'BUNDLE',
  'MEAL_DEAL',
  'SERVICE_OFFER',
  'EVERYDAY_PROMOTION',
  'OTHER',
] as const;
export type LiveDealMechanic = (typeof LIVE_DEAL_MECHANICS)[number];

/** GENERAL is the default and means: discover, view, visit. No claim, no reservation, no QR, no forced redemption. */
export const REDEMPTION_MODES = ['GENERAL', 'CONTROLLED'] as const;
export type RedemptionMode = (typeof REDEMPTION_MODES)[number];

export const ELIGIBILITY_KINDS = [
  'PUBLIC',
  'GEOGRAPHY',
  'EMPLOYER',
  'BANK_CARD',
  'SCHEME',
  /** A nested AND / OR / NOT expression over attributes (see EligibilityExpression). */
  'COMPOSITE',
] as const;
export type EligibilityKind = (typeof ELIGIBILITY_KINDS)[number];

/** Customer-side attribute types of the shared eligibility engine (card attributes are issuer/product/tier only; never PAN/CVV). */
export const ELIGIBILITY_ATTRIBUTE_TYPES = [
  'GEOGRAPHY',
  'EMPLOYER',
  'CARD',
  'SCHEME',
  // shared platform: the card and programme criteria partners need, plus DealDash-assigned facts
  'COUNTRY',
  'CARD_PRODUCT',
  'CARD_TIER',
  'SEGMENT',
  'MEMBERSHIP',
  'PRODUCT_OWNERSHIP',
  // legally sensitive: only usable when the market enables them (VALIDATE-KSA); DealDash does not collect them today
  'AGE_BAND',
  'GENDER',
] as const;
export type EligibilityAttributeType = (typeof ELIGIBILITY_ATTRIBUTE_TYPES)[number];

/** Attributes a customer can obtain themselves (so a locked offer can show a way to unlock it). */
export const UNLOCKABLE_ATTRIBUTE_TYPES: readonly EligibilityAttributeType[] = [
  'EMPLOYER',
  'CARD',
  'SCHEME',
  'CARD_PRODUCT',
  'CARD_TIER',
  'MEMBERSHIP',
];
/** Attributes the market must explicitly enable before a rule may use them. */
export const SENSITIVE_ATTRIBUTE_TYPES: readonly EligibilityAttributeType[] = [
  'AGE_BAND',
  'GENDER',
];

/**
 * One shared rule language for every product: nested AND / OR / NOT over attribute tests. A rule set stores either the legacy flat
 * form (a kind plus alternative conditions) or one expression; both are evaluated by the same engine.
 */
export type EligibilityExpression =
  | { op: 'AND' | 'OR'; children: EligibilityExpression[] }
  | { op: 'NOT'; child: EligibilityExpression }
  | { op: 'ATTR'; attr: EligibilityAttributeType; values: string[]; level?: EligibilityLevel };

export const ELIGIBILITY_LEVELS = ['SELF_DECLARED', 'OTP_VERIFIED', 'ISSUER_VERIFIED'] as const;
export type EligibilityLevel = (typeof ELIGIBILITY_LEVELS)[number];

export const ELIGIBILITY_ATTRIBUTE_STATUSES = [
  'PENDING',
  'VERIFIED',
  'REVERIFICATION_DUE',
  'EXPIRED',
  'FAILED',
  'REVOKED',
] as const;
export type EligibilityAttributeStatus = (typeof ELIGIBILITY_ATTRIBUTE_STATUSES)[number];

/** What the customer sees for a deal after the eligibility check (hidden deals are never returned). */
export const ELIGIBILITY_RESULTS = ['ELIGIBLE', 'LOCKED_UNLOCKABLE', 'HIDDEN'] as const;
export type EligibilityResult = (typeof ELIGIBILITY_RESULTS)[number];

export const UNLOCK_ACTIONS = [
  'SIGN_IN',
  'VERIFY_EMPLOYER',
  'ADD_BANK_BENEFIT',
  'JOIN_SCHEME',
] as const;
export type UnlockAction = (typeof UNLOCK_ACTIONS)[number];

/** Discovery signals recorded for general Live Deals (never sales or revenue). */
export const DEAL_EVENT_TYPES = [
  'IMPRESSION',
  'DETAIL_VIEW',
  'MERCHANT_PAGE_VIEW',
  'SAVE',
  'UNSAVE',
  'DIRECTIONS_CLICK',
  // Stage 6: the call-to-action after a Watch & Earn video
  'CTA_CLICK',
] as const;
export type DealEventType = (typeof DEAL_EVENT_TYPES)[number];

/** Material fields of a live deal (LD-41). Configurable (`live_deals.material_fields`); this is the default. */
export const LIVE_DEAL_MATERIAL_FIELDS = [
  'mechanic',
  'valueNumber',
  'offerLabel',
  'categoryId',
  'branchIds',
  'startAt',
  'endAt',
  'eligibility',
  'terms',
] as const;
export type LiveDealMaterialField = (typeof LIVE_DEAL_MATERIAL_FIELDS)[number];

export const DEAL_OBJECT_TYPE_LIVE = 'LIVE_DEAL' as const;

/** The development launch city. Cities are configuration (`discovery.enabled_cities`). */
export const DEFAULT_CITY = 'Riyadh';
/** Riyadh city centre, used when the customer has not shared a location. */
export const RIYADH_CENTER = { latitude: 24.7136, longitude: 46.6753 } as const;
