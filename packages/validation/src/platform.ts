import { z } from 'zod';
import {
  BILLING_CADENCES,
  CONTRACT_ENTITLEMENT_KINDS,
  CONTRACT_KINDS,
  LIMIT_MODES,
  LIMIT_PERIODS,
  RENEWAL_STATES,
  SCOPE_KINDS,
  SOFT_ACTIONS,
} from '@dealdash/types';

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const biText = z.object({ en: z.string(), ar: z.string() });
const country = z.string().trim().length(2).toUpperCase();

// ------------------------------------------------------------------ legal entities
export const legalEntityCreateSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  registrationNumber: z.string().trim().max(60).optional(),
  taxNumber: z.string().trim().max(60).optional(),
  country: country.default('SA'),
  currency: z.string().trim().length(3).toUpperCase().default('SAR'),
});
export const legalEntityViewSchema = z.object({
  id: uuid,
  legalName: z.string(),
  registrationNumber: z.string().nullable(),
  taxNumber: z.string().nullable(),
  country: z.string(),
  currency: z.string(),
  status: z.string(),
});
export type LegalEntityView = z.infer<typeof legalEntityViewSchema>;

// ------------------------------------------------------------------ organization units
export const unitCreateSchema = z.object({
  kind: z.string().trim().min(2).max(40),
  code: z.string().trim().min(1).max(40),
  nameEn: z.string().trim().min(1).max(120),
  nameAr: z.string().trim().min(1).max(120),
  parentId: uuid.nullable().default(null),
  legalEntityId: uuid.nullable().default(null),
  operatorLegalEntityId: uuid.nullable().default(null),
  settlementLegalEntityId: uuid.nullable().default(null),
  country: country.nullable().default(null),
  city: z.string().trim().max(80).nullable().default(null),
  branchId: uuid.nullable().default(null),
});
export const unitUpdateSchema = z.object({
  nameEn: z.string().trim().min(1).max(120).optional(),
  nameAr: z.string().trim().min(1).max(120).optional(),
  legalEntityId: uuid.nullable().optional(),
  operatorLegalEntityId: uuid.nullable().optional(),
  settlementLegalEntityId: uuid.nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export const unitViewSchema = z.object({
  id: uuid,
  parentId: uuid.nullable(),
  kind: z.string(),
  code: z.string(),
  name: biText,
  legalEntityId: uuid.nullable(),
  effectiveLegalEntityId: uuid.nullable(),
  operatorLegalEntityId: uuid.nullable(),
  settlementLegalEntityId: uuid.nullable(),
  country: z.string().nullable(),
  effectiveCountry: z.string().nullable(),
  city: z.string().nullable(),
  branchId: uuid.nullable(),
  depth: z.number().int(),
  status: z.string(),
});
export type UnitView = z.infer<typeof unitViewSchema>;

// ------------------------------------------------------------------ scoped role assignments
export const scopeInputSchema = z
  .object({
    kind: z.enum(SCOPE_KINDS),
    ref: z.string().trim().min(1).max(80).nullable().default(null),
    product: z.string().trim().max(30).nullable().default(null),
    envelope: z
      .object({
        kind: z.enum(SCOPE_KINDS),
        ref: z.string().trim().min(1).max(80).nullable().default(null),
      })
      .nullable()
      .default(null),
  })
  .superRefine((s, ctx) => {
    if (s.kind !== 'ORGANIZATION' && !s.ref)
      ctx.addIssue({ code: 'custom', path: ['ref'], message: 'REQUIRED' });
    if (s.kind === 'CAMPAIGN' && !s.product)
      ctx.addIssue({ code: 'custom', path: ['product'], message: 'REQUIRED' });
    if (s.envelope && s.kind !== 'CAMPAIGN' && s.kind !== 'PRODUCT')
      ctx.addIssue({ code: 'custom', path: ['envelope'], message: 'ONLY_FOR_NARROWING_SCOPES' });
  });
export type ScopeInput = z.infer<typeof scopeInputSchema>;

export const assignmentCreateSchema = z.object({
  membershipId: uuid,
  roleCode: z.string().trim().min(3).max(60),
  scope: scopeInputSchema,
  validUntil: iso.nullable().default(null),
  reason: z.string().trim().max(300).optional(),
});
export const assignmentRevokeSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const scopeConvertSchema = z.object({ scoped: z.boolean() });
export const assignmentViewSchema = z.object({
  id: uuid,
  membershipId: uuid,
  userId: uuid,
  userName: z.string().nullable(),
  roleCode: z.string(),
  scope: z.object({
    kind: z.enum(SCOPE_KINDS),
    ref: z.string().nullable(),
    product: z.string().nullable(),
    envelope: z.object({ kind: z.enum(SCOPE_KINDS), ref: z.string().nullable() }).nullable(),
  }),
  scopeName: z.string().nullable(),
  status: z.string(),
  validFrom: z.string(),
  validUntil: z.string().nullable(),
  grantedByUserId: uuid,
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type AssignmentView = z.infer<typeof assignmentViewSchema>;

export const memberViewSchema = z.object({
  membershipId: uuid,
  userId: uuid,
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  roleCode: z.string(),
  branchId: uuid.nullable(),
  scoped: z.boolean(),
});
export const assignableRolesSchema = z.array(
  z.object({ roleCode: z.string(), name: z.string(), scopeKinds: z.array(z.enum(SCOPE_KINDS)) }),
);
export const accessMeSchema = z.object({
  scoped: z.boolean(),
  grants: z.array(
    z.object({
      roleCode: z.string(),
      permissions: z.array(z.string()),
      scope: z.object({
        kind: z.enum(SCOPE_KINDS),
        ref: z.string().nullable(),
        product: z.string().nullable(),
      }),
      origin: z.enum(['MEMBERSHIP', 'ASSIGNMENT']),
    }),
  ),
});

// ------------------------------------------------------------------ contracts and entitlements
export const contractCreateSchema = z.object({
  organizationId: uuid,
  legalEntityId: uuid.nullable().default(null),
  name: z.string().trim().min(2).max(120),
  reference: z.string().trim().max(80).optional(),
  planCode: z.string().trim().max(40).optional(),
  /** The commercial type (an Enterprise Licence is a Contract of an enterprise kind). */
  kind: z.enum(CONTRACT_KINDS).default('CUSTOM_ENTERPRISE'),
  market: z.string().trim().length(2).toUpperCase().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  billingCadence: z.enum(BILLING_CADENCES).default('NONE'),
  billingLegalEntityId: uuid.nullable().default(null),
  coveredLegalEntityIds: z.array(uuid).max(50).default([]),
  renewalState: z.enum(RENEWAL_STATES).default('MANUAL_RENEWAL'),
  effectiveFrom: iso.optional(),
  effectiveUntil: iso.nullable().default(null),
  entitlements: z
    .array(
      z.object({
        kind: z.enum(CONTRACT_ENTITLEMENT_KINDS),
        key: z.string().trim().min(2).max(60),
        enabled: z.boolean().default(true),
        limitValue: z.number().int().min(0).nullable().default(null),
        mode: z.enum(LIMIT_MODES).default('HARD'),
        period: z.enum(LIMIT_PERIODS).default('NONE'),
        softAction: z.enum(SOFT_ACTIONS).default('WARN'),
      }),
    )
    .max(60)
    .default([]),
});
export const contractEndSchema = z.object({
  effectiveUntil: iso.optional(),
  reason: z.string().trim().min(3).max(300),
});
export const entitlementViewSchema = z.object({
  source: z.enum(['CONTRACT', 'DEFAULT_PLAN']),
  contractId: uuid.nullable(),
  products: z.array(z.string()),
  features: z.array(z.string()),
  limits: z.record(z.string(), z.number().int()),
  /** Present when the entitlement comes from the subscription engine. */
  lifecycle: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  planCode: z.string().nullable().optional(),
});
export type EntitlementView = z.infer<typeof entitlementViewSchema>;
export const contractViewSchema = z.object({
  id: uuid,
  organizationId: uuid,
  legalEntityId: uuid.nullable(),
  name: z.string(),
  reference: z.string().nullable(),
  planCode: z.string().nullable(),
  status: z.string(),
  kind: z.string().optional(),
  market: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  billingCadence: z.string().optional(),
  renewalState: z.string().optional(),
  version: z.number().int().optional(),
  planVersionId: uuid.nullable().optional(),
  billingLegalEntityId: uuid.nullable().optional(),
  effectiveFrom: z.string(),
  effectiveUntil: z.string().nullable(),
  entitlements: z.array(
    z.object({
      kind: z.enum(CONTRACT_ENTITLEMENT_KINDS),
      key: z.string(),
      enabled: z.boolean(),
      limitValue: z.number().int().nullable(),
      source: z.string().optional(),
      mode: z.string().optional(),
      period: z.string().optional(),
    }),
  ),
});

// ------------------------------------------------------------------ markets
export const countryUpsertSchema = z.object({
  nameEn: z.string().trim().min(2).max(80),
  nameAr: z.string().trim().min(2).max(80),
  currency: z.string().trim().length(3).toUpperCase(),
  languages: z.array(z.string().trim().min(2).max(5)).min(1).max(6),
  enabled: z.boolean().default(false),
  taxProfile: z.record(z.string(), z.unknown()).default({}),
  paymentProvider: z.string().trim().max(60).nullable().default(null),
  settlement: z.record(z.string(), z.unknown()).default({}),
  legalTextVersion: z.string().trim().max(40).nullable().default(null),
  residency: z.record(z.string(), z.unknown()).default({}),
  notificationProviders: z.record(z.string(), z.unknown()).default({}),
  settings: z.record(z.string(), z.unknown()).default({}),
});
export const countryViewSchema = countryUpsertSchema.extend({ code: z.string() });
export type CountryView = z.infer<typeof countryViewSchema>;

// ------------------------------------------------------------------ "may I?" check (also the tool behind scope-aware UI and AI)
export const accessCheckSchema = z.object({
  permission: z.string().trim().min(3).max(80),
  branchId: uuid.optional(),
  unitId: uuid.optional(),
  legalEntityId: uuid.optional(),
  country: country.optional(),
  product: z.string().trim().max(30).optional(),
  campaignId: uuid.optional(),
});
export const accessCheckResultSchema = z.object({ allowed: z.boolean() });
