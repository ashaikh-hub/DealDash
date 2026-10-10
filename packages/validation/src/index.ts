import { z } from 'zod';
import {
  AUDIENCES,
  JOB_STATUSES,
  LOCALES,
  ORGANIZATION_STATUSES,
  ORGANIZATION_TYPES,
  PARTNER_TYPES,
  PERMISSION_CODES,
  ROLE_CODES,
  USER_TYPES,
} from '@dealdash/types';

import { branchInputSchema } from './merchant';

// ------------------------------------------------------------------ primitives
export const localeSchema = z.enum(LOCALES);
export const audienceSchema = z.enum(AUDIENCES);
export const uuidSchema = z.string().uuid();

/** E.164 mobile number (for example +966500000001). */
export const mobileSchema = z
  .string()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    'Mobile number must be in international format, for example +966500000001',
  );

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const otpCodeSchema = z.string().regex(/^\d{6}$/, 'The code must be 6 digits');

/** Bilingual customer-facing text. Both languages are required for publication-grade content. */
export const bilingualTextSchema = z.object({
  en: z.string().trim().min(1).max(500),
  ar: z.string().trim().min(1).max(500),
});

// ------------------------------------------------------------------ request schemas
export const otpRequestSchema = z.object({
  mobile: mobileSchema,
  audience: z.enum(['customer', 'staff']),
});

export const otpVerifySchema = z.object({
  mobile: mobileSchema,
  code: otpCodeSchema,
  audience: z.enum(['customer', 'staff']),
});

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(8).max(200),
  audience: z.enum(['merchant', 'partner', 'admin']),
});

export const mfaVerifySchema = z.object({
  code: otpCodeSchema,
});

export const switchMembershipSchema = z.object({
  organizationId: uuidSchema,
  branchId: uuidSchema.optional(),
});

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

/** Sorting convention: `?sort=field` or `?sort=-field` (descending), restricted to an allow-list. */
export const sortQuerySchema = <T extends readonly [string, ...string[]]>(allowed: T) =>
  z
    .string()
    .optional()
    .refine((v) => v === undefined || allowed.includes(v.replace(/^-/, '')), {
      message: `sort must be one of: ${allowed.join(', ')} (prefix with - for descending)`,
    });

/** Branch creation (Stage 1 shape plus optional phone, opening hours and holiday hours from Stage 2). */
export const createBranchSchema = branchInputSchema;

export const nearbyBranchesQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(100).max(50000).default(5000),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const auditQuerySchema = paginationQuerySchema.extend({
  action: z.string().max(100).optional(),
  entityType: z.string().max(100).optional(),
  organizationId: uuidSchema.optional(),
});

export const organizationsQuerySchema = paginationQuerySchema.extend({
  type: z.enum(ORGANIZATION_TYPES).optional(),
  sort: sortQuerySchema(['createdAt', 'nameEn'] as const),
});

export const updateConfigSchema = z.object({
  value: z.unknown(),
  reason: z.string().trim().min(3).max(300),
});

export const enqueueDemoJobSchema = z.object({
  message: z.string().min(1).max(200),
  idempotencyKey: z.string().min(8).max(100).optional(),
  failTimes: z.number().int().min(0).max(5).default(0),
});

// ------------------------------------------------------------------ response schemas (drive OpenAPI)
export const apiMetaSchema = z.object({
  requestId: z.string().optional(),
  locale: localeSchema.optional(),
  nextCursor: z.string().nullable().optional(),
});

export const envelope = <T extends z.ZodType>(data: T) => z.object({ data, meta: apiMetaSchema });

export const apiErrorSchema = z.object({
  errors: z.array(
    z.object({ code: z.string(), message: z.string(), field: z.string().optional() }),
  ),
  meta: apiMetaSchema,
});

export const membershipViewSchema = z.object({
  organizationId: uuidSchema,
  organizationType: z.enum(ORGANIZATION_TYPES),
  organizationName: bilingualTextSchema,
  organizationStatus: z.enum(ORGANIZATION_STATUSES),
  roleCode: z.enum(ROLE_CODES),
  branchId: uuidSchema.nullable(),
});

export const meViewSchema = z.object({
  id: uuidSchema,
  userType: z.enum(USER_TYPES),
  displayName: z.string(),
  locale: localeSchema,
  audience: audienceSchema,
  mfaVerified: z.boolean(),
  mfaRequired: z.boolean(),
  activeMembership: membershipViewSchema.nullable(),
  memberships: z.array(membershipViewSchema),
  permissions: z.array(z.enum(PERMISSION_CODES)),
});

export const otpRequestResultSchema = z.object({
  sent: z.boolean(),
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
});

/** /auth/me returns the identity plus the CSRF token to send as X-CSRF-Token on state-changing calls. */
export const meResponseSchema = meViewSchema.extend({ csrfToken: z.string() });

export const loginResultSchema = z.object({
  authenticated: z.boolean(),
  mfaRequired: z.boolean(),
  csrfToken: z.string(),
  me: meViewSchema,
});

export const branchViewSchema = z.object({
  id: uuidSchema,
  organizationId: uuidSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  addressEn: z.string(),
  addressAr: z.string(),
  city: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  status: z.string(),
  phone: z.string().nullable().optional(),
  hours: z.unknown().nullable().optional(),
  holidayHours: z.unknown().nullable().optional(),
});

export const nearbyBranchViewSchema = branchViewSchema.extend({
  distanceMeters: z.number(),
});

export const merchantViewSchema = z.object({
  organizationId: uuidSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  legalName: z.string(),
  status: z.enum(ORGANIZATION_STATUSES),
});

export const partnerViewSchema = z.object({
  organizationId: uuidSchema,
  nameEn: z.string(),
  nameAr: z.string(),
  partnerType: z.enum(PARTNER_TYPES),
  status: z.enum(ORGANIZATION_STATUSES),
});

export const organizationViewSchema = z.object({
  id: uuidSchema,
  type: z.enum(ORGANIZATION_TYPES),
  status: z.enum(ORGANIZATION_STATUSES),
  nameEn: z.string(),
  nameAr: z.string(),
  createdAt: z.string(),
});

export const customerViewSchema = z.object({
  userId: uuidSchema,
  displayName: z.string(),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
  city: z.string().nullable(),
  onboardingState: z.string(),
});

export const auditLogViewSchema = z.object({
  id: uuidSchema,
  occurredAt: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actorUserId: uuidSchema.nullable(),
  actorRole: z.string().nullable(),
  actorOrganizationId: uuidSchema.nullable(),
  subjectOrganizationId: uuidSchema.nullable().optional(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
});

export const configViewSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  description: z.string().nullable(),
  version: z.number().int(),
  updatedAt: z.string(),
});

export const jobViewSchema = z.object({
  id: uuidSchema,
  type: z.string(),
  status: z.enum(JOB_STATUSES),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
});

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  time: z.string(),
  database: z.object({
    connected: z.boolean(),
    migrationsCurrent: z.boolean(),
    pendingMigrations: z.number().int(),
  }),
  postgis: z.object({
    available: z.boolean(),
    enabled: z.boolean(),
    version: z.string().nullable(),
  }),
});

export const acceptedSchema = z.object({ accepted: z.boolean() });

// ------------------------------------------------------------------ inferred types
export type OtpRequest = z.infer<typeof otpRequestSchema>;
export type OtpVerify = z.infer<typeof otpVerifySchema>;
export type PasswordLogin = z.infer<typeof passwordLoginSchema>;
export type CreateBranch = z.infer<typeof createBranchSchema>;
export type BranchView = z.infer<typeof branchViewSchema>;
export type MeViewDto = z.infer<typeof meViewSchema>;
export type HealthView = z.infer<typeof healthSchema>;

export * from './merchant';
export * from './deals';
export * from './hot-deals';
export * from './vouchers';
export * from './watch';
export * from './commercial';
export * from './platform';
export * from './master';
export * from './loyalty';
export * from './subscription';
export * from './visibility';
export * from './billing';
export * from './ai';
export * from './markets';
export * from './partners';
