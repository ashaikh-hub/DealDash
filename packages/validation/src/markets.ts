import { z } from 'zod';
import {
  INVOICE_CONFIG_KINDS,
  MARKET_POLICY_CATEGORIES,
  MARKET_PRODUCT_STATUSES,
  MARKET_STATUSES,
  MARKET_VALIDATION_STATUSES,
  PAYMENT_METHODS,
  PROVIDER_CAPABILITIES,
  PROVIDER_ENVIRONMENTS,
  PROVIDER_STATUSES,
  RECONCILIATION_METHODS,
  ROUNDING_RULES,
  SETTLEMENT_FREQUENCIES,
  TAX_TYPES,
  VALIDATION_STATES,
} from '@dealdash/types';

const iso = z.string().datetime({ offset: true });
const ccy = z.string().trim().length(3).toUpperCase();
const uuid = z.string().uuid();
const reason = z.string().trim().min(3).max(500);

export const marketMasterSchema = z.object({
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  regionCode: z.string().trim().max(31).nullable().optional(),
  isoAlpha3: z.string().trim().length(3).toUpperCase().nullable().optional(),
  currency: ccy,
  supportedCurrencies: z.array(ccy).max(10).optional(),
  billingCurrency: ccy.nullable().optional(),
  settlementCurrency: ccy.nullable().optional(),
  taxCurrency: ccy.nullable().optional(),
  currencyDecimals: z.number().int().min(0).max(4).optional(),
  roundingRule: z.enum(ROUNDING_RULES).optional(),
  languages: z.array(z.string().trim().min(2).max(5)).min(1).max(6),
  defaultLanguage: z.string().trim().min(2).max(5).optional(),
  timezone: z.string().trim().min(2).max(60).optional(),
  callingCode: z
    .string()
    .trim()
    .regex(/^\+\d{1,4}$/)
    .nullable()
    .optional(),
  formatting: z.record(z.string(), z.unknown()).optional(),
  launchDate: iso.nullable().optional(),
  dealdashLegalEntityId: uuid.nullable().optional(),
  supportContact: z
    .object({
      email: z.string().trim().email().optional(),
      phone: z.string().trim().max(30).optional(),
      hours: z.string().trim().max(120).optional(),
    })
    .strict()
    .optional(),
});

export const marketRegionSchema = z.object({
  code: z.string().trim().min(2).max(31),
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export const marketTransitionSchema = z.object({ status: z.enum(MARKET_STATUSES), reason });
export const marketDecisionSchema = z.object({ reason: z.string().trim().max(500).optional() });
export const marketProductSchema = z.object({
  status: z.enum(MARKET_PRODUCT_STATUSES),
  notes: z.string().trim().max(300).nullable().optional(),
});

export const taxRuleSchema = z.object({
  code: z.string().trim().min(2).max(40),
  legalEntityId: uuid.nullable().optional(),
  taxType: z.enum(TAX_TYPES),
  rateBps: z.number().int().min(0).max(10_000),
  inclusive: z.boolean().optional(),
  applicability: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  exempt: z.boolean().optional(),
  exemptionReason: z.string().trim().max(300).nullable().optional(),
  registrationRef: z.string().trim().max(80).nullable().optional(),
  roundingRule: z.enum(ROUNDING_RULES).optional(),
  taxCurrency: ccy.nullable().optional(),
  effectiveFrom: iso,
  effectiveTo: iso.nullable().optional(),
  validationCode: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const invoiceConfigSchema = z.object({
  documentKind: z.enum(INVOICE_CONFIG_KINDS),
  legalEntityId: uuid.nullable().optional(),
  prefix: z.string().trim().min(1).max(16).toUpperCase(),
  sequenceKey: z.string().trim().min(3).max(80).optional(),
  languages: z.array(z.string().trim().min(2).max(5)).min(1).max(4),
  requiredFields: z.array(z.string().trim().max(40)).max(10).optional(),
  qrRequired: z.boolean().optional(),
  eInvoiceProvider: z.string().trim().max(60).nullable().optional(),
  validationStatus: z.enum(VALIDATION_STATES).optional(),
  validationCode: z.string().trim().max(60).nullable().optional(),
  effectiveFrom: iso,
  effectiveTo: iso.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const settlementRuleSchema = z.object({
  code: z.string().trim().min(2).max(40),
  legalEntityId: uuid.nullable().optional(),
  product: z.string().trim().max(40).nullable().optional(),
  organizationId: uuid.nullable().optional(),
  contractId: uuid.nullable().optional(),
  currency: ccy,
  frequency: z.enum(SETTLEMENT_FREQUENCIES),
  cycleDays: z.number().int().min(0).max(365).optional(),
  minimumMinor: z.number().int().min(0).optional(),
  destinationRef: z.string().trim().max(120).nullable().optional(),
  payableTreatment: z.string().trim().max(40).optional(),
  sponsorTreatment: z.string().trim().max(40).optional(),
  feeBps: z.number().int().min(0).max(10_000).nullable().optional(),
  reconciliationMethod: z.enum(RECONCILIATION_METHODS).optional(),
  holdDays: z.number().int().min(0).max(365).optional(),
  disputeTreatment: z.string().trim().max(40).optional(),
  effectiveFrom: iso,
  effectiveTo: iso.nullable().optional(),
  validationCode: z.string().trim().max(60).nullable().optional(),
});

export const marketProviderSchema = z.object({
  capability: z.enum(PROVIDER_CAPABILITIES),
  providerCode: z.string().trim().min(2).max(60),
  method: z.enum(PAYMENT_METHODS).nullable().optional(),
  currency: ccy.nullable().optional(),
  merchantAccountRef: z.string().trim().max(120).nullable().optional(),
  refundSupported: z.boolean().nullable().optional(),
  credentialRef: z.string().trim().max(130).nullable().optional(),
  webhookRef: z.string().trim().max(130).nullable().optional(),
  environment: z.enum(PROVIDER_ENVIRONMENTS).optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  isFallback: z.boolean().optional(),
  status: z.enum(PROVIDER_STATUSES).optional(),
  effectiveFrom: iso.nullable().optional(),
  effectiveTo: iso.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const marketPolicySchema = z.object({
  category: z.enum(MARKET_POLICY_CATEGORIES),
  key: z.string().trim().min(2).max(40),
  product: z.string().trim().max(40).nullable().optional(),
  value: z.record(z.string(), z.unknown()),
  required: z.boolean().optional(),
  validationCode: z.string().trim().max(60).nullable().optional(),
  effectiveFrom: iso.nullable().optional(),
  effectiveTo: iso.nullable().optional(),
});

export const marketValidationCreateSchema = z.object({
  code: z.string().trim().min(3).max(60),
  topic: z.string().trim().min(2).max(120),
  description: z.string().trim().min(3).max(2000),
  product: z.string().trim().max(40).nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  ownerTeam: z.string().trim().max(80).nullable().optional(),
  blocksActivation: z.boolean().optional(),
  reviewDate: iso.nullable().optional(),
  sourceRef: z.string().trim().max(200).nullable().optional(),
});

export const marketValidationUpdateSchema = z.object({
  status: z.enum(MARKET_VALIDATION_STATUSES).optional(),
  decision: z.string().trim().max(2000).nullable().optional(),
  evidenceRef: z.string().trim().max(300).nullable().optional(),
  ownerUserId: uuid.nullable().optional(),
  ownerTeam: z.string().trim().max(80).nullable().optional(),
  effectiveDate: iso.nullable().optional(),
  reviewDate: iso.nullable().optional(),
  blocksActivation: z.boolean().optional(),
});

export const marketValidationQuerySchema = z.object({
  market: z.string().trim().length(2).toUpperCase().optional(),
  status: z.enum(MARKET_VALIDATION_STATUSES).optional(),
});
export const taxResolveQuerySchema = z.object({
  item: z.string().trim().min(1).max(40),
  legalEntityId: uuid.optional(),
  at: iso.optional(),
});
export const configRetireSchema = z.object({ reason, at: iso.optional() });
