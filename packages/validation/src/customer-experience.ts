import { z } from 'zod';

/**
 * Customer experience gap closure (2026-10-16): Google / Apple sign-in (development provider until the production credentials exist),
 * saved cards (provider tokens only), card-linked offer activation, "Log my saving", the Employee Pass and per-deal reviews.
 */
const uuid = z.string().uuid();
const biText = z.object({ en: z.string(), ar: z.string() });

// ---------------------------------------------------------------- Google / Apple sign-in
export const SOCIAL_PROVIDERS = ['GOOGLE', 'APPLE'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const socialStartSchema = z.object({
  provider: z.enum(SOCIAL_PROVIDERS),
  /** SIGN_IN from the welcome / sign-in screens; LINK from Account settings (signed in). */
  intent: z.enum(['SIGN_IN', 'LINK']).default('SIGN_IN'),
  /** The app's own callback page (must be one of DealDash's app addresses). */
  callbackUrl: z.string().url().max(500),
});
export type SocialStartInput = z.infer<typeof socialStartSchema>;
export const socialStartResultSchema = z.object({ authorizeUrl: z.string() });

export const socialCallbackSchema = z.object({
  state: z.string().min(16).max(200),
  code: z.string().min(1).max(2000).optional(),
  /** What the provider reported instead of a code (access_denied = the customer cancelled). */
  error: z.string().max(100).optional(),
});
export const SOCIAL_OUTCOMES = [
  'SIGNED_IN',
  'NEEDS_PHONE',
  'LINKED',
  'CANCELLED',
  'FAILED',
  'CONFLICT',
] as const;
export const socialCallbackResultSchema = z.object({
  status: z.enum(SOCIAL_OUTCOMES),
  provider: z.enum(SOCIAL_PROVIDERS),
  intent: z.enum(['SIGN_IN', 'LINK']),
  /** NEEDS_PHONE: finish with a phone number (links to the existing account with that number, or creates one). */
  linkToken: z.string().nullable(),
  profile: z.object({ name: z.string().nullable(), email: z.string().nullable() }).nullable(),
  /** SIGNED_IN: the session's CSRF token (the session cookie is set by the response). */
  csrfToken: z.string().nullable(),
});
export type SocialCallbackResult = z.infer<typeof socialCallbackResultSchema>;

export const socialCompleteSchema = z.object({
  linkToken: z.string().min(16).max(200),
  mobile: z.string().trim().min(8).max(20),
  code: z.string().regex(/^\d{6}$/),
});
export const socialCompleteResultSchema = z.object({
  csrfToken: z.string(),
  /** EXISTING = linked to the account that already had this number; NEW = a new account; NOT_LINKED = that account already has
   * another account of this provider (signed in with the phone, nothing linked). */
  account: z.enum(['EXISTING', 'NEW', 'NOT_LINKED']),
  provider: z.enum(SOCIAL_PROVIDERS),
});
export type SocialCompleteResult = z.infer<typeof socialCompleteResultSchema>;

export const linkedIdentitySchema = z.object({
  provider: z.enum(SOCIAL_PROVIDERS),
  email: z.string().nullable(),
  linkedAt: z.string(),
});
export const linkedIdentitiesSchema = z.object({
  items: z.array(linkedIdentitySchema),
  /** Which providers can be used right now (production credentials are an external dependency). */
  available: z.array(z.enum(SOCIAL_PROVIDERS)),
});
export type LinkedIdentities = z.infer<typeof linkedIdentitiesSchema>;

// ---------------------------------------------------------------- saved cards
export const CARD_BRANDS = ['VISA', 'MASTERCARD', 'MADA', 'AMEX', 'OTHER'] as const;
export const savedCardSchema = z.object({
  id: uuid,
  brand: z.enum(CARD_BRANDS),
  last4: z.string(),
  expMonth: z.number().int(),
  expYear: z.number().int(),
  expired: z.boolean(),
  isDefault: z.boolean(),
  addedAt: z.string(),
});
export type SavedCard = z.infer<typeof savedCardSchema>;
export const savedCardListSchema = z.object({
  items: z.array(savedCardSchema),
  /** False when the payment provider cannot store cards (then the card is entered on the payment page each time). */
  canSave: z.boolean(),
});
export type SavedCardList = z.infer<typeof savedCardListSchema>;
export const cardSetupStartSchema = z.object({
  returnUrl: z.string().url().max(500),
  makeDefault: z.boolean().default(false),
});
export const cardSetupStartResultSchema = z.object({ setupId: uuid, redirectUrl: z.string() });
export const cardSetupResultSchema = z.object({
  status: z.enum(['PENDING', 'COMPLETED', 'CANCELLED', 'FAILED']),
  failureCode: z.string().nullable(),
  card: savedCardSchema.nullable(),
  /** The same card was already saved (nothing new was added). */
  duplicate: z.boolean(),
});
export type CardSetupResult = z.infer<typeof cardSetupResultSchema>;

// ---------------------------------------------------------------- card-linked offer activation
export const OFFER_PRODUCTS = ['LIVE', 'HOT', 'VOUCHER'] as const;
export type OfferProduct = (typeof OFFER_PRODUCTS)[number];
export const cardOfferStateSchema = z.object({
  /** NOT_CARD_OFFER: nothing to activate; NEEDS_CARD: add an eligible card first; AVAILABLE: activate on one of `cards`;
   * ACTIVATED; UNAVAILABLE: the offer ended or is not open to this account. */
  state: z.enum(['NOT_CARD_OFFER', 'NEEDS_CARD', 'AVAILABLE', 'ACTIVATED', 'UNAVAILABLE']),
  /** The customer's added cards this offer works with. */
  cards: z.array(z.object({ programId: uuid, name: biText })),
  /** The issuers whose cards open this offer (for "Add your … card"). */
  issuers: z.array(z.object({ id: uuid, name: biText })),
  activation: z.object({ programId: uuid, cardName: biText, activatedAt: z.string() }).nullable(),
});
export type CardOfferState = z.infer<typeof cardOfferStateSchema>;
export const cardOfferActivateSchema = z.object({ programId: uuid });
export const cardOfferActivationItemSchema = z.object({
  product: z.enum(OFFER_PRODUCTS),
  offerId: uuid,
  title: biText,
  merchantName: biText,
  cardName: biText,
  activatedAt: z.string(),
  /** ACTIVE; ENDED = the offer is over; CARD_REMOVED = the card was removed from My benefits. */
  status: z.enum(['ACTIVE', 'ENDED', 'CARD_REMOVED']),
});
export type CardOfferActivationItem = z.infer<typeof cardOfferActivationItemSchema>;

// ---------------------------------------------------------------- Log my saving
export const SAVING_SOURCES = ['RESERVATION', 'VOUCHER'] as const;
export const savingLogSchema = z.object({
  sourceType: z.enum(SAVING_SOURCES),
  sourceId: uuid,
  /** Minor units of the redemption's currency. */
  amountMinor: z.number().int().min(1).max(100_000_00),
});
export const savingItemSchema = z.object({
  id: uuid,
  sourceType: z.enum(SAVING_SOURCES),
  sourceId: uuid,
  title: biText,
  merchantName: biText,
  amountMinor: z.number().int(),
  currency: z.string(),
  createdAt: z.string(),
});
export type SavingItem = z.infer<typeof savingItemSchema>;
export const savingsSummarySchema = z.object({
  totals: z.array(
    z.object({ currency: z.string(), amountMinor: z.number().int(), count: z.number().int() }),
  ),
  items: z.array(savingItemSchema),
});
export type SavingsSummary = z.infer<typeof savingsSummarySchema>;
export const savingStateSchema = z.object({
  /** Only a redeemed reservation / voucher can be logged, once. */
  canLog: z.boolean(),
  logged: savingItemSchema.nullable(),
  currency: z.string().nullable(),
  /** What the offer itself says the customer saves, when it says so (a starting value the customer can change). */
  suggestedMinor: z.number().int().nullable(),
});
export type SavingState = z.infer<typeof savingStateSchema>;

// ---------------------------------------------------------------- Employee Pass
export const employeePassSchema = z.object({
  /** ACTIVE = verified employer (also during the renewal grace period); INACTIVE = expired / not finished / none. */
  status: z.enum(['ACTIVE', 'INACTIVE']),
  /** The employer verification's own state, for the reason shown on an inactive pass. */
  reason: z.enum(['VERIFIED', 'RENEWAL_DUE', 'EXPIRED', 'PENDING', 'NONE']),
  employer: z.object({ id: uuid, name: biText }).nullable(),
  programName: biText.nullable(),
  holderName: z.string().nullable(),
  maskedEmail: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  validUntil: z.string().nullable(),
  /** A stable pass number for this customer and employer (not a secret; staff read it with the customer's name). */
  passNumber: z.string().nullable(),
  serverNow: z.string(),
});
export type EmployeePass = z.infer<typeof employeePassSchema>;

// ---------------------------------------------------------------- per-deal reviews
export const dealReviewSchema = z.object({
  id: uuid,
  rating: z.number().int(),
  text: z.string(),
  verified: z.boolean(),
  author: z.string().nullable(),
  createdAt: z.string(),
});
export const dealReviewsSchema = z.object({
  summary: z.object({
    count: z.number().int(),
    average: z.number().nullable(),
    /** How many reviews gave 5, 4, 3, 2, 1 stars (index 0 = 5 stars). */
    distribution: z.array(z.number().int()),
  }),
  items: z.array(dealReviewSchema),
  /** For the signed-in customer: can they review this deal now, and if not, why. */
  mine: z
    .object({
      canReview: z.boolean(),
      reason: z.enum(['NOT_REDEEMED', 'ALREADY_REVIEWED', 'LIMIT']).nullable(),
    })
    .nullable(),
});
export type DealReviews = z.infer<typeof dealReviewsSchema>;
export const dealReviewCreateSchema = z.object({
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().min(1).max(2000),
  locale: z.enum(['en', 'ar']).optional(),
});
