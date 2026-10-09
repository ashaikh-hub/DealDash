import { z } from 'zod';
import {
  AMENDMENT_TYPES,
  BILLING_CADENCES,
  BILLING_CATEGORIES,
  CONTRACT_KINDS,
  EFFECTIVE_MODES,
  ENTITY_TYPES_FOR_PLANS,
  LIMIT_MODES,
  LIMIT_PERIODS,
  MAX_MINOR_AMOUNT,
  POST_PROMOTION,
  PROMOTION_KINDS,
  RENEWAL_STATES,
  SOFT_ACTIONS,
} from '@dealdash/types';

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const country = z.string().trim().length(2).toUpperCase();
const currency = z.string().trim().length(3).toUpperCase();
const code = z.string().trim().min(2).max(60).regex(/^[A-Z][A-Z0-9_]*$/, 'UPPER_SNAKE_CASE');
/** Money is an integer in the minor unit of an explicit currency. Larger custom amounts are split into billing events. */
export const minor = z.number().int().min(0).max(MAX_MINOR_AMOUNT);

export const limitSpecSchema = z.object({
  key: z.string().trim().min(2).max(60),
  /** null = unlimited by this plan / contract */
  value: z.number().int().min(0).nullable(),
  mode: z.enum(LIMIT_MODES).default('HARD'),
  period: z.enum(LIMIT_PERIODS).default('NONE'),
  warnPercents: z.array(z.number().int().min(1).max(100)).max(5).default([80, 100]),
  softAction: z.enum(SOFT_ACTIONS).default('WARN'),
  overageRateMinor: minor.nullable().default(null),
});
export type LimitSpec = z.infer<typeof limitSpecSchema>;

export const planEntitlementsSchema = z.object({
  products: z.array(z.string().trim().min(2).max(40)).max(40).default([]),
  features: z.array(z.string().trim().min(2).max(40)).max(80).default([]),
  limits: z.array(limitSpecSchema).max(40).default([]),
});
export type PlanEntitlements = z.infer<typeof planEntitlementsSchema>;

export const pricePointSchema = z.object({
  cadence: z.enum(BILLING_CADENCES),
  amountMinor: minor,
  /** A reference ("indicative from") figure, not a mandatory list price. */
  indicative: z.boolean().default(false),
});
export const feeSchema = z.object({ code, amountMinor: minor, indicative: z.boolean().default(false), note: z.string().trim().max(200).optional() });

export const planCreateSchema = z.object({
  code,
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  descriptionEn: z.string().trim().max(400).optional(),
  descriptionAr: z.string().trim().max(400).optional(),
  entityType: z.enum(ENTITY_TYPES_FOR_PLANS),
  contractKind: z.enum(CONTRACT_KINDS),
  isFree: z.boolean().default(false),
  negotiated: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(100),
});

export const planVersionDraftSchema = z.object({
  market: country,
  currency,
  defaultCadence: z.enum(BILLING_CADENCES).default('MONTHLY'),
  prices: z.array(pricePointSchema).max(6).default([]),
  fees: z.array(feeSchema).max(20).default([]),
  addOnPrices: z.record(z.string(), z.object({ amountMinor: minor, cadence: z.enum(BILLING_CADENCES).default('MONTHLY'), indicative: z.boolean().default(false) })).default({}),
  entitlements: planEntitlementsSchema.default({ products: [], features: [], limits: [] }),
  addOnCodes: z.array(z.string().trim().max(60)).max(30).default([]),
  supportLevel: z.string().trim().max(40).nullable().default(null),
  trialDays: z.number().int().min(0).max(365).nullable().default(null),
  graceDays: z.number().int().min(0).max(365).nullable().default(null),
  enforcement: z.record(z.string(), z.unknown()).nullable().default(null),
  rules: z.record(z.string(), z.unknown()).default({}),
  referencePricing: z.record(z.string(), z.unknown()).default({}),
  effectiveFrom: iso.optional(),
});
export type PlanVersionDraft = z.infer<typeof planVersionDraftSchema>;

export const priceItemCreateSchema = z.object({
  code,
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  category: z.enum(BILLING_CATEGORIES),
  unit: z.enum(['EACH', 'PER_VIEW', 'PER_REDEMPTION', 'PERCENT', 'PER_CAMPAIGN', 'PER_MONTH', 'PER_YEAR', 'PER_REQUEST']).default('EACH'),
  product: z.string().trim().max(40).nullable().default(null),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});
export const priceItemVersionSchema = z
  .object({
    market: country,
    currency,
    model: z.enum(['FIXED', 'PER_UNIT', 'PERCENT_BPS', 'TIERED']),
    amountMinor: minor.nullable().default(null),
    rateBps: z.number().int().min(0).max(10000).nullable().default(null),
    tiers: z.array(z.object({ upTo: z.number().int().min(1).nullable(), amountMinor: minor })).max(12).nullable().default(null),
    minAmountMinor: minor.nullable().default(null),
    maxAmountMinor: minor.nullable().default(null),
    indicative: z.boolean().default(false),
    rangeMin: z.number().int().min(0).nullable().default(null),
    rangeMax: z.number().int().min(0).nullable().default(null),
    effectiveFrom: iso.optional(),
    reference: z.string().trim().max(120).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.model === 'FIXED' || v.model === 'PER_UNIT') if (v.amountMinor === null && !v.indicative) ctx.addIssue({ code: 'custom', path: ['amountMinor'], message: 'AMOUNT_REQUIRED' });
    if (v.model === 'PERCENT_BPS' && v.rateBps === null && !v.indicative) ctx.addIssue({ code: 'custom', path: ['rateBps'], message: 'RATE_REQUIRED' });
    if (v.model === 'TIERED' && !v.tiers?.length) ctx.addIssue({ code: 'custom', path: ['tiers'], message: 'TIERS_REQUIRED' });
  });

export const addOnDefinitionSchema = z.object({
  code,
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  effect: z.array(z.object({ kind: z.enum(['PRODUCT', 'FEATURE', 'LIMIT']), key: z.string().trim().min(2).max(60), perUnit: z.number().int().min(0).max(1_000_000).default(1) })).min(1).max(10),
  priceItemCode: z.string().trim().max(60).nullable().default(null),
  eligiblePlanCodes: z.array(z.string().trim().max(60)).max(30).default([]),
});

export const assignPlanSchema = z.object({
  organizationId: uuid,
  legalEntityId: uuid.nullable().default(null),
  billingLegalEntityId: uuid.nullable().default(null),
  coveredLegalEntityIds: z.array(uuid).max(50).default([]),
  planCode: z.string().trim().min(2).max(60),
  market: country.optional(),
  name: z.string().trim().min(2).max(120).optional(),
  reference: z.string().trim().max(80).optional(),
  effectiveFrom: iso.optional(),
  effectiveUntil: iso.nullable().default(null),
  cadence: z.enum(BILLING_CADENCES).optional(),
  renewalState: z.enum(RENEWAL_STATES).default('AUTO_RENEW'),
  accountManager: z.string().trim().max(120).optional(),
  /** Start as a TRIAL of this plan for N days; the post-trial plan is applied when the trial ends. */
  trial: z.object({ days: z.number().int().min(1).max(365).optional(), postTrialPlanCode: z.string().trim().max(60).nullable().default(null), approvalRef: z.string().trim().max(80).optional() }).nullable().default(null),
  /** Record DealDash's approval reference when assigning a plan on the customer's behalf. */
  approvalRef: z.string().trim().max(80).optional(),
  /** Activate immediately (the plan needs no acceptance, for example a free plan) or wait for the customer's acceptance. */
  activate: z.boolean().default(false),
  developmentFixture: z.boolean().default(false),
});

export const overrideSchema = z.object({
  reason: z.string().trim().min(5).max(300),
  effectiveFrom: iso.optional(),
  effectiveUntil: iso.nullable().default(null),
  entitlements: z
    .array(
      z.object({
        kind: z.enum(['PRODUCT', 'FEATURE', 'LIMIT']),
        key: z.string().trim().min(2).max(60),
        enabled: z.boolean().default(true),
        value: z.number().int().min(0).nullable().default(null),
        mode: z.enum(LIMIT_MODES).optional(),
        period: z.enum(LIMIT_PERIODS).optional(),
        softAction: z.enum(SOFT_ACTIONS).optional(),
        overageRateMinor: minor.nullable().optional(),
      }),
    )
    .min(1)
    .max(30),
});

export const amendmentProposeSchema = z.object({
  type: z.enum(AMENDMENT_TYPES),
  targetPlanCode: z.string().trim().max(60).optional(),
  effectiveMode: z.enum(EFFECTIVE_MODES).default('IMMEDIATE'),
  effectiveAt: iso.optional(),
  addOn: z.object({ code: z.string().trim().max(60), quantity: z.number().int().min(1).max(10000).default(1), endAt: iso.nullable().default(null), autoRenew: z.boolean().default(false) }).optional(),
  market: country.optional(),
  newEndAt: iso.optional(),
  pricing: z.object({ itemCode: z.string().trim().max(60), amountMinor: minor.nullable().default(null), rateBps: z.number().int().min(0).max(10000).nullable().default(null), discountBps: z.number().int().min(0).max(10000).nullable().default(null), waived: z.boolean().default(false) }).optional(),
  entitlements: overrideSchema.shape.entitlements.optional(),
  reason: z.string().trim().max(300).optional(),
  /** DealDash only: apply a downgrade although usage exceeds the new limits (the excess is restricted, never deleted). */
  forced: z.boolean().default(false),
});

export const acceptSchema = z.object({ language: z.enum(['en', 'ar']).default('en'), confirm: z.literal(true) });

export const promotionSchema = z.object({
  kind: z.enum(PROMOTION_KINDS),
  itemCode: z.string().trim().min(2).max(60),
  originalPriceMinor: minor.nullable().default(null),
  promoPriceMinor: minor.nullable().default(null),
  discountBps: z.number().int().min(0).max(10000).nullable().default(null),
  waived: z.boolean().default(false),
  creditMinor: minor.nullable().default(null),
  startAt: iso,
  endAt: iso,
  postPromotion: z.enum(POST_PROMOTION).default('REVERT_TO_STANDARD'),
  postPlanCode: z.string().trim().max(60).nullable().default(null),
  approvalRef: z.string().trim().max(80).optional(),
});

export const contractRateSchema = z.object({
  itemCode: z.string().trim().min(2).max(60),
  model: z.enum(['FIXED', 'PER_UNIT', 'PERCENT_BPS', 'TIERED']).default('FIXED'),
  amountMinor: minor.nullable().default(null),
  rateBps: z.number().int().min(0).max(10000).nullable().default(null),
  discountBps: z.number().int().min(0).max(10000).nullable().default(null),
  waived: z.boolean().default(false),
  effectiveFrom: iso.optional(),
  effectiveUntil: iso.nullable().default(null),
  approvalRef: z.string().trim().max(80).optional(),
});

export const lifecycleActionSchema = z.object({ reason: z.string().trim().min(3).max(300), effectiveAt: iso.optional() });
export const renewalStateSchema = z.object({ renewalState: z.enum(RENEWAL_STATES), reason: z.string().trim().max(300).optional() });

export const usageRecordSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(160),
  metricKey: z.string().trim().min(2).max(60),
  quantity: z.number().int().min(0).max(1_000_000_000).default(1),
  legalEntityId: uuid.nullable().default(null),
  occurredAt: iso.optional(),
});
