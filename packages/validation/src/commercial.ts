import { z } from 'zod';
import {
  ACCEPTANCE_CHECKS,
  APPROVAL_STEPS,
  CHARGE_TRIGGERS,
  COLLECTION_METHODS,
  COMMERCIAL_PRODUCTS,
  COMMERCIAL_STATUSES,
  CREDIT_STATUSES,
  FINANCE_DOCUMENT_TYPES,
  FUNDING_MODES,
  PARTY_ROLES,
  PRICING_BASES,
  PRICING_BASE_OF,
  QUOTE_LINE_KINDS,
  UNUSED_TREATMENTS,
} from '@dealdash/types';

const uuid = z.string().uuid();
const iso = z.string();
const halalas = (max = 100_000_000_000) => z.number().int().min(0).max(max);
const biText = z.object({ en: z.string(), ar: z.string() });

// ------------------------------------------------------------------ commercial inputs a campaign carries (all products)
/**
 * The commercial part of a campaign's content: who funds what. It is part of the content so a change to it is an economics
 * change (supersedes an earlier acceptance). No rate or fee lives here: DealDash charges come from pricing agreements.
 */
export const sponsorFundingSchema = z.object({
  organizationId: uuid,
  /** What this sponsor funds per redemption / voucher. Cash obligation of the sponsor, separate from any merchant benefit. */
  perUnitHalalas: halalas(1_000_000),
  trigger: z.enum(CHARGE_TRIGGERS).default('VERIFIED_REDEMPTION'),
});
export const commercialInputSchema = z.object({
  /** Exclusive Deals: the customer's normal price and the deal price (the saving is the difference). */
  normalPriceHalalas: halalas(1_000_000_000).nullable().default(null),
  dealPriceHalalas: halalas(1_000_000_000).nullable().default(null),
  /** Exclusive Deals without prices (free item, BOGO, fee waiver): the value of the benefit per redemption, stated by the owner. */
  benefitValueHalalas: halalas(1_000_000_000).nullable().default(null),
  sponsors: z.array(sponsorFundingSchema).max(5).default([]),
  /** Cash the merchant contributes per redemption (netted from what DealDash pays the merchant). */
  merchantCashPerUnitHalalas: halalas(1_000_000).default(0),
  /** Exclusive Deals: the cap on redemptions. Required when per-redemption charges or funding exist and stock is not tracked. */
  maxRedemptions: z.number().int().min(1).max(10_000_000).nullable().default(null),
  /** A third-party fulfilment merchant. Null = the owner fulfils. Must be an onboarded merchant that approves the obligations itself. */
  fulfilmentOrganizationId: uuid.nullable().default(null),
  /**
   * Stage 7: the partner that created the campaign and owns it commercially (Campaign Creator). The campaign runs at the merchant
   * that holds it (the fulfilment merchant, whose branches and staff redeem). Null = the merchant itself. Set only by the partner
   * portal; a merchant edit can never change it.
   */
  creatorOrganizationId: uuid.nullable().default(null),
  dailyQuota: z.number().int().min(1).max(1_000_000).nullable().default(null),
});
export type CommercialInput = z.infer<typeof commercialInputSchema>;
export const emptyCommercialInput = (): CommercialInput => commercialInputSchema.parse({});

// ------------------------------------------------------------------ requests
export const commercialPreviewSchema = z.object({
  product: z.enum(COMMERCIAL_PRODUCTS),
  /** The builder's current content (unsaved is fine): the server derives the economics from it. */
  content: z.record(z.string(), z.unknown()),
});
export const commercialAcceptSchema = z.object({
  quotationId: uuid,
  checks: z.array(z.enum(ACCEPTANCE_CHECKS)).max(10),
  language: z.enum(['en', 'ar']).default('en'),
});
export const commercialApprovalDecisionSchema = z.object({
  quotationId: uuid,
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().max(500).optional(),
});
export const commercialPaySchema = z.object({
  amountHalalas: z.number().int().min(100).max(100_000_000_000).optional(),
});
export const unusedTreatmentSchema = z.object({
  treatment: z.enum(UNUSED_TREATMENTS),
  transferTargetCaseId: uuid.optional(),
});

export const pricingComponentSchema = z.object({
  code: z.string().trim().min(2).max(40),
  label: biText,
  enabled: z.boolean(),
  basis: z.enum(PRICING_BASES),
  amountHalalas: halalas(1_000_000_000).optional(),
  bps: z.number().int().min(0).max(100_000).optional(),
  base: z.enum(PRICING_BASE_OF).optional(),
  trigger: z.enum(CHARGE_TRIGGERS),
  collection: z.enum(COLLECTION_METHODS),
  taxable: z.boolean(),
  minimumHalalas: halalas(1_000_000_000).optional(),
});
export const pricingAgreementCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  scope: z.enum(['GLOBAL', 'ENTITY_TYPE', 'ORGANIZATION']),
  organizationId: uuid.optional(),
  entityType: z.string().trim().max(40).optional(),
  market: z.string().trim().max(10).optional(),
  product: z.enum(COMMERCIAL_PRODUCTS).optional(),
  priority: z.number().int().min(1).max(1000).default(100),
  components: z.record(z.string(), z.array(pricingComponentSchema)),
  taxBps: z.number().int().min(0).max(100_000).nullable().default(null),
  unusedTreatment: z.enum(UNUSED_TREATMENTS).nullable().default(null),
  reference: z.string().trim().max(120).optional(),
});
export const pricingVersionCreateSchema = pricingAgreementCreateSchema.pick({
  components: true,
  taxBps: true,
  unusedTreatment: true,
  reference: true,
});
export const approvalRuleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  active: z.boolean().default(true),
  priority: z.number().int().min(1).max(1000).default(100),
  scope: z.enum(['CAMPAIGN', 'CREDIT']).default('CAMPAIGN'),
  product: z.enum(COMMERCIAL_PRODUCTS).optional(),
  entityType: z.string().trim().max(40).optional(),
  organizationId: uuid.optional(),
  riskTier: z.string().trim().max(20).optional(),
  minLiabilityHalalas: z.number().int().min(0).optional(),
  steps: z.array(z.enum(APPROVAL_STEPS)).max(3),
});
export const recordPaymentSchema = z.object({
  organizationId: uuid,
  caseId: uuid.optional(),
  amountHalalas: z.number().int().min(100).max(100_000_000_000),
  method: z.enum(['BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER']),
  externalReference: z.string().trim().max(120).optional(),
});
export const documentCreateSchema = z.object({
  type: z.enum(FINANCE_DOCUMENT_TYPES),
  organizationId: uuid,
  caseId: uuid.optional(),
  relatedDocumentId: uuid.optional(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(200),
        amountHalalas: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(50),
  taxHalalas: z.number().int().min(0).default(0),
  dueInDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().trim().max(500).optional(),
  statutory: z.record(z.string(), z.unknown()).optional(),
});
export const adjustmentCreateSchema = z.object({
  caseId: uuid.optional(),
  organizationId: uuid,
  kind: z.enum(['CREDIT', 'DEBIT']),
  amountHalalas: z.number().int().min(1).max(100_000_000_000),
  reason: z.string().trim().min(3).max(500),
});
export const creditFacilityRequestSchema = z.object({
  organizationId: uuid,
  limitHalalas: z.number().int().min(100),
  paymentTermsDays: z.number().int().min(0).max(365),
  expiresAt: iso,
  agreementReference: z.string().trim().min(2).max(120),
});
export const decisionSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const holdSchema = z.object({
  organizationId: uuid,
  caseId: uuid.optional(),
  reason: z.string().trim().min(3).max(500),
});
export const authorizationSchema = z.object({
  organizationId: uuid,
  reference: z.string().trim().min(2).max(120),
  reason: z.string().trim().min(3).max(500),
  validUntil: iso,
});
export const onBehalfAcceptSchema = commercialAcceptSchema.extend({
  organizationId: uuid,
  authorizationId: uuid,
  role: z.enum(['OWNER', 'SPONSOR']),
});
export const commercialAdminCaseListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(COMMERCIAL_STATUSES).optional(),
  product: z.enum(COMMERCIAL_PRODUCTS).optional(),
  organizationId: uuid.optional(),
});
export const accountSetupSchema = z.object({
  organizationId: uuid,
  fundingMode: z.enum(FUNDING_MODES).optional(),
  legalName: z.string().trim().max(200).optional(),
});

// ------------------------------------------------------------------ responses
export const quoteLineSchema = z.object({
  kind: z.enum(QUOTE_LINE_KINDS),
  code: z.string(),
  label: biText,
  partyOrganizationId: uuid.nullable(),
  partyRole: z.enum(PARTY_ROLES).nullable(),
  basis: z.string(),
  units: z.number().int(),
  unitHalalas: z.number().int(),
  amountHalalas: z.number().int(),
  cash: z.boolean(),
  collection: z.enum(COLLECTION_METHODS).nullable(),
  trigger: z.enum(CHARGE_TRIGGERS).nullable(),
  taxable: z.boolean(),
  note: z.string().optional(),
});
export const quoteTotalsSchema = z.object({
  currency: z.string(),
  maxUnits: z.number().int(),
  dealdashChargesHalalas: z.number().int(),
  taxHalalas: z.number().int(),
  taxStatus: z.enum(['NOT_CONFIGURED', 'APPLIED', 'NOT_APPLICABLE']),
  maxCashPayableToDealDashHalalas: z.number().int(),
  nettedChargesHalalas: z.number().int(),
  maxSponsorLiabilityHalalas: z.number().int(),
  sponsorLiability: z.array(z.object({ organizationId: uuid, amountHalalas: z.number().int() })),
  merchantCashContributionHalalas: z.number().int(),
  maxMerchantBenefitCommitmentHalalas: z.number().int(),
  customerBenefitTotalHalalas: z.number().int(),
  totalEconomicCommitmentHalalas: z.number().int(),
  issues: z.array(z.string()),
});
export type QuoteTotalsView = z.infer<typeof quoteTotalsSchema>;
export type QuoteLineView = z.infer<typeof quoteLineSchema>;

export const commercialPreviewResultSchema = z.object({
  lines: z.array(quoteLineSchema),
  totals: quoteTotalsSchema,
  pricing: z.object({
    source: z.enum(['AGREEMENT', 'DEFAULT']),
    reference: z.string().nullable(),
    versionKey: z.string(),
    unusedTreatment: z.enum(UNUSED_TREATMENTS).nullable(),
  }),
  /** Who has to accept, and with which checks. */
  parties: z.array(
    z.object({
      role: z.enum(PARTY_ROLES),
      organizationId: uuid,
      requiredChecks: z.array(z.enum(ACCEPTANCE_CHECKS)),
    }),
  ),
  fundingRequirements: z.array(
    z.object({
      organizationId: uuid,
      role: z.enum(PARTY_ROLES),
      mode: z.enum(FUNDING_MODES),
      upfrontHalalas: z.number().int(),
      usageMaxHalalas: z.number().int(),
      maxHalalas: z.number().int(),
    }),
  ),
  workflow: z.array(z.enum(APPROVAL_STEPS)),
});
export type CommercialPreview = z.infer<typeof commercialPreviewResultSchema>;

export const blockerSchema = z.object({
  code: z.string(),
  party: z.string().nullable(),
  detail: z.string().nullable(),
});
export type ActivationBlocker = z.infer<typeof blockerSchema>;

export const commercialCaseViewSchema = z.object({
  id: uuid,
  reference: z.string(),
  product: z.enum(COMMERCIAL_PRODUCTS),
  subjectId: uuid,
  status: z.enum(COMMERCIAL_STATUSES),
  ownerOrganizationId: uuid,
  fulfilmentOrganizationId: uuid,
  developmentFixture: z.boolean(),
  unusedTreatment: z.enum(UNUSED_TREATMENTS).nullable(),
  quotation: z
    .object({
      id: uuid,
      reference: z.string(),
      version: z.number().int(),
      status: z.enum([
        'DRAFT',
        'PENDING_ACCEPTANCE',
        'ACCEPTED',
        'SUPERSEDED',
        'REJECTED',
        'MODIFICATION_REQUESTED',
        'EXPIRED',
      ]),
      createdAt: z.string(),
      delta: z.unknown().nullable(),
    })
    .nullable(),
  preview: commercialPreviewResultSchema.nullable(),
  acceptances: z.array(
    z.object({
      reference: z.string(),
      role: z.enum(PARTY_ROLES),
      organizationId: uuid,
      userName: z.string().nullable(),
      userRole: z.string().nullable(),
      onBehalf: z.boolean(),
      createdAt: z.string(),
      quotationId: uuid,
    }),
  ),
  approvals: z.array(
    z.object({
      step: z.enum(APPROVAL_STEPS),
      status: z.enum(['PENDING', 'APPROVED', 'REJECTED']),
      decidedByName: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  funding: z.array(
    z.object({
      id: uuid,
      organizationId: uuid,
      role: z.enum(PARTY_ROLES),
      kind: z.enum(['CHARGE', 'SPONSOR_FUNDING']),
      mode: z.enum(FUNDING_MODES),
      upfrontHalalas: z.number().int(),
      usageMaxHalalas: z.number().int(),
      maxHalalas: z.number().int(),
      receivedHalalas: z.number().int(),
      utilizedHalalas: z.number().int(),
      earnedHalalas: z.number().int(),
      remainingCommitmentHalalas: z.number().int(),
      outstandingHalalas: z.number().int(),
      status: z.string(),
    }),
  ),
  blockers: z.array(blockerSchema),
  submitBlockers: z.array(blockerSchema),
  /** What the viewing organisation may do now. */
  allowedActions: z.array(z.string()),
  hold: z.object({ active: z.boolean(), reason: z.string().nullable() }),
  updatedAt: z.string(),
});
export type CommercialCaseView = z.infer<typeof commercialCaseViewSchema>;

export const caseRowSchema = z.object({
  id: uuid,
  reference: z.string(),
  product: z.enum(COMMERCIAL_PRODUCTS),
  subjectId: uuid,
  title: biText.nullable(),
  status: z.enum(COMMERCIAL_STATUSES),
  ownerOrganizationId: uuid,
  ownerName: biText,
  maxCashHalalas: z.number().int(),
  benefitCommitmentHalalas: z.number().int(),
  developmentFixture: z.boolean(),
  updatedAt: z.string(),
  /** The viewing business's role on the case (null for DealDash). */
  myRole: z.enum(PARTY_ROLES).nullable().optional(),
});
export const commercialDocumentViewSchema = z.object({
  id: uuid,
  number: z.string(),
  type: z.enum(FINANCE_DOCUMENT_TYPES),
  status: z.enum(['DRAFT', 'ISSUED', 'PAID', 'VOID']),
  organizationId: uuid,
  caseId: uuid.nullable(),
  currency: z.string(),
  subtotalHalalas: z.number().int(),
  taxHalalas: z.number().int(),
  totalHalalas: z.number().int(),
  paidHalalas: z.number().int(),
  issuedAt: z.string(),
  dueAt: z.string().nullable(),
  lines: z.array(z.object({ description: z.string(), amountHalalas: z.number() })),
  statutory: z.record(z.string(), z.unknown()),
});
export const commercialPaymentViewSchema = z.object({
  id: uuid,
  reference: z.string(),
  organizationId: uuid,
  caseId: uuid.nullable(),
  amountHalalas: z.number().int(),
  method: z.string(),
  externalReference: z.string().nullable(),
  receivedAt: z.string(),
});
export const creditViewSchema = z.object({
  id: uuid,
  organizationId: uuid,
  currency: z.string(),
  limitHalalas: z.number().int(),
  exposureHalalas: z.number().int(),
  availableHalalas: z.number().int(),
  paymentTermsDays: z.number().int(),
  expiresAt: z.string(),
  agreementReference: z.string(),
  status: z.enum(CREDIT_STATUSES),
  requestedByName: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decisionReason: z.string().nullable(),
  needsChecker: z.boolean(),
});
export const reconciliationViewSchema = z.object({
  id: uuid.nullable(),
  caseId: uuid,
  status: z.string(),
  computedAt: z.string(),
  inventory: z.object({
    configured: z.number().int(),
    issued: z.number().int(),
    redeemed: z.number().int(),
    expiredOrUnused: z.number().int(),
    invalidOrCancelled: z.number().int(),
    remaining: z.number().int(),
  }),
  financial: z.array(
    z.object({
      organizationId: uuid,
      kind: z.string(),
      committedHalalas: z.number().int(),
      receivedHalalas: z.number().int(),
      utilizedHalalas: z.number().int(),
      outstandingHalalas: z.number().int(),
      unusedHalalas: z.number().int(),
      releasedHalalas: z.number().int(),
    }),
  ),
  merchantBenefit: z.object({
    committedHalalas: z.number().int(),
    redeemedHalalas: z.number().int(),
    unusedHalalas: z.number().int(),
    note: z.literal('non_cash_unused_commitment'),
  }),
  exceptions: z.array(z.string()),
  treatment: z.enum(UNUSED_TREATMENTS).nullable(),
});
export type ReconciliationView = z.infer<typeof reconciliationViewSchema>;

export const commercialFinanceOverviewSchema = z.object({
  cases: z.record(z.string(), z.number().int()),
  receivablesHalalas: z.number().int(),
  fundsHeldHalalas: z.number().int(),
  fundingUtilizedHalalas: z.number().int(),
  openHolds: z.number().int(),
  pendingCredit: z.number().int(),
  exceptions: z.number().int(),
  statutoryNote: z.literal('statutory_formats_validate_ksa'),
});
