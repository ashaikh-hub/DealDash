import { z } from 'zod';
import {
  BIN_PREFIX_PATTERN,
  CARD_PROGRAM_STATUSES,
  EMPLOYER_PROGRAM_STATUSES,
  PAN_LIKE_PATTERN,
  PARTNER_BENEFIT_KINDS,
  PARTNER_CREATABLE_PRODUCTS,
  PARTNER_LIFECYCLE,
  PARTNER_TYPES,
  PARTNER_VERIFICATION_METHODS,
  ROLE_CODES,
} from '@dealdash/types';
import { dealEligibilitySchema, eligibilityExpressionSchema } from './deals';

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).optional();
const country = z.string().trim().length(2).toUpperCase();
const reason = z.string().trim().min(3).max(500);
/** Free text a partner types must never carry a card number (PAN). */
const noPan = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !PAN_LIKE_PATTERN.test(v), { message: 'CARD_DATA_FORBIDDEN' });
const contact = z
  .object({
    name: text(120),
    email: z.string().trim().email().max(200),
    phone: opt(30),
    title: opt(80),
  })
  .strict();

/** Partner roles a partner administrator may invite (DealDash roles are never assignable from the portal). */
export const PARTNER_INVITABLE_ROLES = ROLE_CODES.filter((r) =>
  r.startsWith('PARTNER_'),
) as unknown as readonly [string, ...string[]];

// ------------------------------------------------------------------ business account and onboarding
/** DealDash creates the partner Business Account and invites its first administrator. */
export const partnerCreateSchema = z.object({
  nameEn: text(120),
  nameAr: text(120),
  partnerType: z.enum(PARTNER_TYPES),
  legalName: text(200),
  country,
  registrationNumber: opt(60),
  adminName: text(120),
  adminEmail: z.string().trim().email().max(200),
  parentGroup: opt(120),
});
/** What the partner maintains about itself during onboarding (references only; no documents are interpreted here). */
export const partnerProfileSchema = z.object({
  legalName: text(200),
  registrationNumber: opt(60),
  taxNumber: opt(60),
  website: z.string().trim().url().max(200).optional().or(z.literal('')),
  parentGroup: opt(120),
  description: noPan(1000).optional(),
  /** Markets the partner asks to operate in; DealDash authorizes them through legal entities, contracts and scope. */
  requestedMarkets: z.array(country).min(1).max(20),
  contacts: z
    .object({
      primary: contact,
      finance: contact.optional(),
      technical: contact.optional(),
      support: contact.optional(),
    })
    .strict(),
  signatory: contact
    .extend({ authorityRef: opt(160) })
    .strict()
    .optional(),
});
export const partnerTransitionSchema = z.object({ to: z.enum(PARTNER_LIFECYCLE), reason });
export const partnerDecisionSchema = z.object({ reason: z.string().trim().max(500).optional() });

// ------------------------------------------------------------------ users
export const partnerInviteSchema = z.object({
  name: text(120),
  email: z.string().trim().email().max(200),
  roleCode: z
    .string()
    .trim()
    .refine((r) => (PARTNER_INVITABLE_ROLES as readonly string[]).includes(r), {
      message: 'INVALID_ROLE',
    }),
});
export const partnerRoleChangeSchema = z.object({
  roleCode: z
    .string()
    .trim()
    .refine((r) => (PARTNER_INVITABLE_ROLES as readonly string[]).includes(r), {
      message: 'INVALID_ROLE',
    }),
});
export const partnerMemberStatusSchema = z.object({ reason });

// ------------------------------------------------------------------ partner-created Live Deal (network offer, FD-S7-4)
const isoDate = z.string().datetime({ offset: true });
export const partnerOfferCreateSchema = z
  .object({
    /** The partner's own offer id (external offer id); generated when blank. */
    sourceRecordId: opt(120),
    /** The merchant's id in the partner's source (a merchant of its network). */
    merchantSourceId: text(120),
    /** The contract / programme reference that gives the partner the right to publish this merchant's offer. */
    publicationRef: text(200),
    titleEn: text(160),
    titleAr: opt(160),
    benefitEn: text(300),
    benefitAr: opt(300),
    termsEn: opt(2000),
    termsAr: opt(2000),
    categoryCode: opt(40),
    channel: z.enum(['IN_STORE', 'ONLINE', 'BOTH']).default('IN_STORE'),
    validFrom: isoDate,
    validUntil: isoDate.optional(),
    branchSourceIds: z.array(text(120)).max(500).default([]),
    /** Card schemes / products / tiers / employer the offer is for, as supplied (never card numbers). */
    eligibility: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((o) => !o.validUntil || new Date(o.validUntil) > new Date(o.validFrom), {
    path: ['validUntil'],
    message: 'END_BEFORE_START',
  });

// ------------------------------------------------------------------ merchant network (manual one-by-one)
const branchInput = z.object({
  externalId: opt(120),
  nameEn: text(160),
  nameAr: opt(160),
  addressEn: opt(300),
  addressAr: opt(300),
  city: opt(80),
  country: country.optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
export const networkMerchantCreateSchema = z.object({
  /** The partner's own id for the merchant (kept as the source record id; generated when empty). */
  externalMerchantId: opt(120),
  nameEn: text(160),
  nameAr: opt(160),
  brand: opt(160),
  country,
  categoryCode: opt(40),
  branches: z.array(branchInput).max(50).default([]),
});
export const networkQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  registration: z.enum(['REFERENCED', 'REGISTERED']).optional(),
  country: country.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export const networkDuplicateDecisionSchema = z.object({
  decision: z.enum(['NOT_DUPLICATE', 'SUGGEST_MERGE']),
  note: z.string().trim().max(300).optional(),
});

// ------------------------------------------------------------------ card programmes and employer programmes
export const cardProgramSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/),
  nameEn: text(120),
  nameAr: text(120),
  /** Scheme value the eligibility rules match (for example "visa"); never a card number. */
  scheme: z.string().trim().min(2).max(40).toLowerCase(),
  issuerName: text(120),
  productCode: z.string().trim().min(2).max(40),
  tier: z.string().trim().min(2).max(40).toLowerCase(),
  binPrefixes: z
    .array(z.string().trim().regex(BIN_PREFIX_PATTERN, { message: 'BIN_PREFIX_6_TO_8_DIGITS' }))
    .max(50)
    .default([]),
  market: country,
  verificationMethod: z.enum(PARTNER_VERIFICATION_METHODS).default('SELF_DECLARED'),
  status: z.enum(CARD_PROGRAM_STATUSES).default('DRAFT'),
});
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/, { message: 'INVALID_DOMAIN' });
export const employerProgramSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/),
  nameEn: text(120),
  nameAr: text(120),
  /** Work-email domains used as the verification reference (an employee proves a mailbox by one-time code). */
  domains: z.array(domain).min(1).max(20),
  market: country,
  status: z.enum(EMPLOYER_PROGRAM_STATUSES).default('DRAFT'),
});

// ------------------------------------------------------------------ eligibility (the shared engine; the portal only builds the tree)
export const partnerEligibilityRuleSchema = z.object({
  name: text(120),
  expression: eligibilityExpressionSchema,
});
export const eligibilityTestSchema = z.object({
  expression: eligibilityExpressionSchema,
  sample: z
    .object({
      attributes: z
        .array(
          z.object({
            attr: z.string().trim().max(40),
            value: z.string().trim().max(100),
            level: z.string().trim().max(30).optional(),
          }),
        )
        .max(30)
        .default([]),
      city: opt(80),
      country: country.optional(),
    })
    .default({ attributes: [] }),
});

// ------------------------------------------------------------------ campaigns created by a partner (shared engines)
export const partnerCampaignCreateSchema = z.object({
  product: z.enum(PARTNER_CREATABLE_PRODUCTS),
  /** The registered, active merchant of the partner's network that runs the campaign at its branches (fulfilment merchant). */
  merchantOrganizationId: uuid,
  content: z.record(z.string(), z.unknown()),
});
export const partnerCampaignUpdateSchema = z.object({
  content: z.record(z.string(), z.unknown()),
  expectedVersion: z.number().int().min(1).optional(),
});

// ------------------------------------------------------------------ Live Deal partner benefit
export const liveDealBenefitSchema = z.object({
  liveDealId: uuid,
  kind: z.enum(PARTNER_BENEFIT_KINDS),
  /** Percent for EXTRA_PERCENT, amount in minor units for EXTRA_AMOUNT; empty otherwise. */
  valueNumber: z.number().min(0).max(1_000_000).nullable().default(null),
  labelEn: noPan(80).pipe(z.string().min(2)),
  labelAr: noPan(80).pipe(z.string().min(2)),
  termsEn: noPan(800).default(''),
  termsAr: noPan(800).default(''),
  eligibility: dealEligibilitySchema,
  startAt: iso.nullable().default(null),
  endAt: iso.nullable().default(null),
});
export const benefitDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(500).optional(),
});
export const benefitStatusSchema = z.object({ reason });

// ------------------------------------------------------------------ performance drill-down
export const partnerPerformanceQuerySchema = z.object({
  by: z
    .enum(['MARKET', 'LEGAL_ENTITY', 'MERCHANT', 'CITY', 'BRANCH', 'CAMPAIGN'])
    .default('CAMPAIGN'),
  market: country.optional(),
  merchantOrganizationId: uuid.optional(),
  days: z.coerce.number().int().min(1).max(366).default(30),
});
