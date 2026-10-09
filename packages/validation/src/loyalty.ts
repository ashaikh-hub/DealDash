import { z } from 'zod';
import { dealEligibilitySchema } from './deals';

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });

export const LOYALTY_FUNDING_SOURCES = ['DEALDASH', 'MERCHANT', 'BANK', 'SCHEME', 'CORPORATE', 'CAMPAIGN', 'SPONSOR'] as const;
export const LOYALTY_RULE_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'ENDED', 'REJECTED'] as const;

/** A loyalty earning rule. Nothing here is a fixed example: every number is the rule author's, inside the caps the platform enforces. */
export const loyaltyRuleCreateSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    eventType: z.string().trim().min(3).max(40),
    kind: z.enum(['BASE', 'BONUS']).default('BASE'),
    productScope: z.enum(['LIVE_DEAL', 'EXCLUSIVE', 'VOUCHER', 'WATCH']).nullable().default(null),
    campaignId: uuid.nullable().default(null),
    /** DealDash Admin only: the business that owns the rule (null = a platform rule). Businesses always own their own. */
    organizationId: uuid.nullable().default(null),
    basePoints: z.number().int().min(0).max(1_000_000).default(0),
    bonusPoints: z.number().int().min(0).max(1_000_000).default(0),
    multiplierBps: z.number().int().min(0).max(1_000_000).default(10_000),
    pointsPer100Halalas: z.number().int().min(0).max(10_000).default(0),
    dailyCap: z.number().int().min(1).max(100_000_000).nullable().default(null),
    monthlyCap: z.number().int().min(1).max(100_000_000).nullable().default(null),
    customerCap: z.number().int().min(1).max(100_000_000).nullable().default(null),
    eligibility: dealEligibilitySchema.nullable().default(null),
    fundingSource: z.enum(LOYALTY_FUNDING_SOURCES).default('DEALDASH'),
    fundingOrganizationId: uuid.nullable().default(null),
    fundingHalalasPerPoint: z.number().int().min(0).max(1_000_000).nullable().default(null),
    expiryDays: z.number().int().min(1).max(3650).nullable().default(null),
    maxAllocationPoints: z.number().int().min(1).max(1_000_000_000),
    effectiveFrom: iso.optional(),
    effectiveUntil: iso.nullable().default(null),
  })
  .superRefine((r, ctx) => {
    if (r.basePoints + r.bonusPoints + r.pointsPer100Halalas <= 0)
      ctx.addIssue({ code: 'custom', path: ['basePoints'], message: 'REQUIRED_POINTS' });
    if (r.fundingSource !== 'DEALDASH' && (!r.fundingOrganizationId || r.fundingHalalasPerPoint === null))
      ctx.addIssue({ code: 'custom', path: ['fundingOrganizationId'], message: 'FUNDER_AND_RATE_REQUIRED' });
    if (r.fundingSource === 'DEALDASH' && r.fundingOrganizationId)
      ctx.addIssue({ code: 'custom', path: ['fundingOrganizationId'], message: 'DEALDASH_HAS_NO_FUNDER' });
    if (r.effectiveFrom && r.effectiveUntil && new Date(r.effectiveUntil) <= new Date(r.effectiveFrom))
      ctx.addIssue({ code: 'custom', path: ['effectiveUntil'], message: 'END_BEFORE_START' });
  });
export type LoyaltyRuleCreate = z.infer<typeof loyaltyRuleCreateSchema>;

export const loyaltyDecisionSchema = z.object({ reason: z.string().trim().min(3).max(300).optional() });
export const loyaltyAllocationSchema = z.object({ maxAllocationPoints: z.number().int().min(1).max(1_000_000_000) });

export const loyaltyRuleViewSchema = z.object({
  id: uuid,
  name: z.string(),
  status: z.enum(LOYALTY_RULE_STATUSES),
  eventType: z.string(),
  kind: z.string(),
  productScope: z.string().nullable(),
  campaignId: uuid.nullable(),
  organizationId: uuid.nullable(),
  basePoints: z.number().int(),
  bonusPoints: z.number().int(),
  multiplierBps: z.number().int(),
  pointsPer100Halalas: z.number().int(),
  dailyCap: z.number().int().nullable(),
  monthlyCap: z.number().int().nullable(),
  customerCap: z.number().int().nullable(),
  eligibilityKind: z.string().nullable(),
  fundingSource: z.string(),
  fundingOrganizationId: uuid.nullable(),
  fundingHalalasPerPoint: z.number().int().nullable(),
  expiryDays: z.number().int().nullable(),
  maxAllocationPoints: z.number().int().nullable(),
  allocatedPoints: z.number().int(),
  reversedPoints: z.number().int(),
  remainingAllocation: z.number().int().nullable(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().nullable(),
  commercialStatus: z.string().nullable(),
  createdAt: z.string(),
});
export type LoyaltyRuleView = z.infer<typeof loyaltyRuleViewSchema>;

export const loyaltyFinanceRowSchema = z.object({
  ruleId: uuid.nullable(),
  ruleName: z.string(),
  fundingSource: z.string(),
  fundingOrganizationId: uuid.nullable(),
  /** Allocation ceiling (points). */
  allocated: z.number().int().nullable(),
  issued: z.number().int(),
  reversed: z.number().int(),
  redeemed: z.number().int(),
  expired: z.number().int(),
  outstanding: z.number().int(),
  remainingAllocation: z.number().int().nullable(),
  /** Funding drawn and the agreed rate, when the rule is funded by a business. Money is never inferred from points. */
  fundingHalalasPerPoint: z.number().int().nullable(),
  fundingUtilizedHalalas: z.number().int().nullable(),
  fundingReceivedHalalas: z.number().int().nullable(),
  outstandingLiabilityHalalas: z.number().int().nullable(),
});
export const loyaltyFinanceSummarySchema = z.object({
  rows: z.array(loyaltyFinanceRowSchema),
  totals: z.object({
    issued: z.number().int(),
    reversed: z.number().int(),
    redeemed: z.number().int(),
    expired: z.number().int(),
    outstanding: z.number().int(),
    held: z.number().int(),
  }),
  note: z.literal('points_have_no_fixed_cash_value'),
});
export type LoyaltyFinanceSummary = z.infer<typeof loyaltyFinanceSummarySchema>;
