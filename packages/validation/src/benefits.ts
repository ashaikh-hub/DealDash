import { z } from 'zod';
import { dealCardSchema } from './deals';
import { hotDealCardSchema } from './hot-deals';
import { voucherCardSchema } from './vouchers';

/**
 * Customer "My benefits" (Business Rules §5 EL, §6 EM, §7 BC). A customer links an employer (work-email code, OTP-verified) and adds
 * cards (issuer / product / tier chosen from partner card programmes: never a card number, never "verified"). Offers that need those
 * benefits unlock through the one eligibility engine.
 */
const uuid = z.string().uuid();
const biText = z.object({ en: z.string(), ar: z.string() });

// ---------------------------------------------------------------- requests
export const benefitEmployerStartSchema = z.object({
  programId: uuid,
  /** The official work email (EM-02). Stored only hashed + encrypted; the customer sees it masked (EM-05). */
  email: z.string().trim().toLowerCase().email().max(254),
});
export type BenefitEmployerStartInput = z.infer<typeof benefitEmployerStartSchema>;

/**
 * The app sends the same work email again with the code: the code is bound to (customer, programme, email) so nothing about an
 * unconfirmed address is stored server-side.
 */
export const benefitEmployerVerifySchema = z.object({
  programId: uuid,
  email: z.string().trim().toLowerCase().email().max(254),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type BenefitEmployerVerifyInput = z.infer<typeof benefitEmployerVerifySchema>;

export const benefitCardAddSchema = z.object({ programId: uuid });
export type BenefitCardAddInput = z.infer<typeof benefitCardAddSchema>;

export const benefitOffersQuerySchema = z.object({
  /** unlocked = offers the customer's benefits open now; available = benefit offers the customer could still unlock. */
  tab: z.enum(['unlocked', 'available']).default('unlocked'),
  city: z.string().trim().max(40).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
export type BenefitOffersQuery = z.infer<typeof benefitOffersQuerySchema>;

export const benefitUsageQuerySchema = z.object({
  /** active = reserved / owned and still usable; used = redeemed; expired = expired, cancelled or refunded. */
  tab: z.enum(['active', 'used', 'expired']).default('active'),
});
export type BenefitUsageQuery = z.infer<typeof benefitUsageQuerySchema>;

export const benefitOptionsQuerySchema = z.object({ city: z.string().trim().max(40).optional() });

// ---------------------------------------------------------------- responses
export const BENEFIT_EMPLOYER_STATUSES = [
  'PENDING',
  'VERIFIED',
  'REVERIFICATION_DUE',
  'EXPIRED',
  'FAILED',
  'REVOKED',
] as const;

export const benefitPartnerRefSchema = z.object({ id: uuid, name: biText });

export const benefitEmployerViewSchema = z.object({
  programId: uuid,
  programName: biText,
  partner: benefitPartnerRefSchema,
  /** Masked work email, for example "a***@company.com". Never the full address. */
  maskedEmail: z.string().nullable(),
  status: z.enum(BENEFIT_EMPLOYER_STATUSES),
  verifiedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  /** From this moment the customer may (and is reminded to) confirm the work email again. */
  renewFrom: z.string().nullable(),
});
export type BenefitEmployerView = z.infer<typeof benefitEmployerViewSchema>;

export const benefitCardViewSchema = z.object({
  programId: uuid,
  name: biText,
  issuer: benefitPartnerRefSchema,
  scheme: z.string(),
  tier: z.string(),
  addedAt: z.string(),
});
export type BenefitCardView = z.infer<typeof benefitCardViewSchema>;

export const benefitsOverviewSchema = z.object({
  employer: benefitEmployerViewSchema.nullable(),
  cards: z.array(benefitCardViewSchema),
  maxCards: z.number().int(),
  counts: z.object({
    unlocked: z.number().int(),
    available: z.number().int(),
    active: z.number().int(),
    used: z.number().int(),
    expired: z.number().int(),
  }),
});
export type BenefitsOverview = z.infer<typeof benefitsOverviewSchema>;

export const benefitOptionsSchema = z.object({
  employers: z.array(
    z.object({
      programId: uuid,
      name: biText,
      partner: benefitPartnerRefSchema,
      domains: z.array(z.string()),
    }),
  ),
  cards: z.array(
    z.object({
      programId: uuid,
      name: biText,
      issuer: benefitPartnerRefSchema,
      scheme: z.string(),
      tier: z.string(),
    }),
  ),
});
export type BenefitOptions = z.infer<typeof benefitOptionsSchema>;

export const benefitEmployerStartResultSchema = z.object({
  maskedEmail: z.string(),
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
});
export type BenefitEmployerStartResult = z.infer<typeof benefitEmployerStartResultSchema>;

/** One benefit offer: the product's own card (rendered by the approved card views) plus the partner(s) behind it. */
export const benefitOfferSchema = z.discriminatedUnion('product', [
  z.object({
    product: z.literal('LIVE'),
    partners: z.array(benefitPartnerRefSchema),
    card: dealCardSchema,
  }),
  z.object({
    product: z.literal('HOT'),
    partners: z.array(benefitPartnerRefSchema),
    card: hotDealCardSchema,
  }),
  z.object({
    product: z.literal('VOUCHER'),
    partners: z.array(benefitPartnerRefSchema),
    card: voucherCardSchema,
  }),
]);
export type BenefitOffer = z.infer<typeof benefitOfferSchema>;

export const benefitUsageItemSchema = z.object({
  kind: z.enum(['RESERVATION', 'VOUCHER']),
  id: uuid,
  reference: z.string(),
  title: biText,
  merchantName: biText,
  partners: z.array(benefitPartnerRefSchema),
  /** The product's own status (reservation: HELD / REDEEMED / EXPIRED / CANCELLED; voucher: ACTIVE / REDEEMED / EXPIRED / REFUNDED ...). */
  status: z.string(),
  validUntil: z.string().nullable(),
  redeemedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type BenefitUsageItem = z.infer<typeof benefitUsageItemSchema>;

export const BENEFIT_HISTORY_EVENTS = [
  'EMPLOYER_CODE_SENT',
  'EMPLOYER_VERIFIED',
  'EMPLOYER_RENEWAL_DUE',
  'EMPLOYER_EXPIRED',
  'EMPLOYER_REMOVED',
  'CARD_ADDED',
  'CARD_REMOVED',
] as const;
export type BenefitHistoryEvent = (typeof BENEFIT_HISTORY_EVENTS)[number];

export const benefitHistoryItemSchema = z.object({
  event: z.enum(BENEFIT_HISTORY_EVENTS),
  name: biText,
  at: z.string(),
});
export type BenefitHistoryItem = z.infer<typeof benefitHistoryItemSchema>;
