import { z } from 'zod';

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
const opt = (max: number) => z.string().trim().max(max).optional();
const country = z.string().trim().length(2).toUpperCase();

// ------------------------------------------------------------------ records a source can send (API, feed or file)
export const merchantRecordSchema = z.object({
  type: z.literal('MERCHANT'),
  sourceRecordId: text(120),
  nameEn: text(160),
  nameAr: opt(160),
  brand: opt(160),
  country: country.default('SA'),
  categoryCode: opt(40),
  sourceUpdatedAt: iso.optional(),
});
export const branchRecordSchema = z.object({
  type: z.literal('BRANCH'),
  sourceRecordId: text(120),
  sourceMerchantId: text(120),
  nameEn: text(160),
  nameAr: opt(160),
  addressEn: opt(300),
  addressAr: opt(300),
  city: opt(80),
  country: country.default('SA'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  sourceUpdatedAt: iso.optional(),
});
export const offerRecordSchema = z
  .object({
    type: z.literal('OFFER'),
    sourceRecordId: text(120),
    sourceMerchantId: text(120),
    titleEn: text(160),
    titleAr: opt(160),
    benefitEn: text(300),
    benefitAr: opt(300),
    termsEn: opt(2000),
    termsAr: opt(2000),
    categoryCode: opt(40),
    channel: z.enum(['IN_STORE', 'ONLINE', 'BOTH']).default('IN_STORE'),
    validFrom: iso,
    validUntil: iso.optional(),
    branchSourceIds: z.array(text(120)).max(2000).default([]),
    eligibility: z.record(z.string(), z.unknown()).default({}),
    sourceUpdatedAt: iso.optional(),
  })
  .refine((o) => !o.validUntil || new Date(o.validUntil) > new Date(o.validFrom), {
    path: ['validUntil'],
    message: 'END_BEFORE_START',
  });
export const sourceRecordSchema = z.discriminatedUnion('type', [
  merchantRecordSchema,
  branchRecordSchema,
  offerRecordSchema,
]);
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export type MerchantRecord = z.infer<typeof merchantRecordSchema>;
export type BranchRecord = z.infer<typeof branchRecordSchema>;
export type OfferRecord = z.infer<typeof offerRecordSchema>;

/** The API / feed payload. A version is part of the contract so the format can evolve without breaking sources. */
export const ingestRequestSchema = z.object({
  apiVersion: z.literal('1'),
  records: z.array(z.unknown()).min(1).max(5000),
});
export const ingestResultSchema = z.object({
  syncJobId: uuid,
  received: z.number().int(),
  accepted: z.number().int(),
  rejected: z.number().int(),
  conflicts: z.number().int(),
  failures: z.array(z.object({ index: z.number().int(), sourceRecordId: z.string().nullable(), error: z.string() })),
  replayed: z.boolean(),
});

// ------------------------------------------------------------------ bulk import (CSV)
export const IMPORT_KINDS = ['MERCHANTS', 'BRANCHES', 'OFFERS'] as const;
export const importUploadSchema = z.object({
  kind: z.enum(IMPORT_KINDS),
  sourceSystem: text(60),
  fileName: opt(200),
  csv: z.string().min(10).max(5_000_000),
  /** Whether the uploader confirms DealDash may publish offers from this file (contract reference required). */
  publicationRef: opt(160),
  /** Stage 7: the file's own column names mapped to the template's (for example {"Merchant Name": "name_en"}). */
  mapping: z.record(z.string().trim().min(1).max(80), z.string().trim().min(1).max(40)).optional(),
});
export const importDecisionSchema = z.object({ reason: z.string().trim().min(3).max(300).optional() });
export const importJobViewSchema = z.object({
  id: uuid,
  organizationId: uuid.nullable(),
  kind: z.string(),
  sourceSystem: z.string(),
  fileName: z.string().nullable(),
  status: z.string(),
  totals: z.record(z.string(), z.number()),
  createdAt: z.string(),
  approvedAt: z.string().nullable(),
  executedAt: z.string().nullable(),
  requiresApproval: z.boolean(),
  rejectionReason: z.string().nullable(),
});
export const importRowViewSchema = z.object({
  rowNumber: z.number().int(),
  status: z.string(),
  action: z.string().nullable(),
  errors: z.array(z.string()),
  raw: z.record(z.string(), z.unknown()),
});
export type ImportJobView = z.infer<typeof importJobViewSchema>;
export type ImportRowView = z.infer<typeof importRowViewSchema>;

// ------------------------------------------------------------------ integrations
export const connectionCreateSchema = z.object({
  name: text(120),
  sourceSystem: text(60),
  kind: z.enum(['API_PUSH', 'FEED_PULL', 'WEBHOOK']).default('API_PUSH'),
  scopes: z.array(z.enum(['MERCHANT', 'BRANCH', 'OFFER'])).min(1).default(['MERCHANT', 'BRANCH', 'OFFER']),
  rateLimitPerMinute: z.number().int().min(1).max(10000).default(120),
  staleAfterMinutes: z.number().int().min(5).max(525600).default(1440),
  publicationAuthorized: z.boolean().default(false),
  publicationRef: opt(160),
  organizationId: uuid.optional(),
});
export const connectionViewSchema = z.object({
  id: uuid,
  organizationId: uuid.nullable(),
  name: z.string(),
  sourceSystem: z.string(),
  kind: z.string(),
  status: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  apiVersion: z.string(),
  rateLimitPerMinute: z.number().int(),
  publicationAuthorized: z.boolean(),
  publicationRef: z.string().nullable(),
  staleAfterMinutes: z.number().int(),
  createdAt: z.string(),
});
export const connectionCreatedSchema = connectionViewSchema.extend({ apiKey: z.string() });
export const healthViewSchema = z.object({
  connectionId: uuid,
  name: z.string(),
  sourceSystem: z.string(),
  status: z.string(),
  lastSyncAt: z.string().nullable(),
  lastSuccessfulSyncAt: z.string().nullable(),
  lastSourceUpdateAt: z.string().nullable(),
  errorCount: z.number().int(),
  openFailedRecords: z.number().int(),
  stale: z.boolean(),
  staleAfterMinutes: z.number().int(),
});
export type IntegrationHealth = z.infer<typeof healthViewSchema>;
export const failedRecordViewSchema = z.object({
  id: uuid,
  recordType: z.string().nullable(),
  sourceRecordId: z.string().nullable(),
  error: z.string(),
  attempts: z.number().int(),
  status: z.string(),
  createdAt: z.string(),
  payload: z.unknown(),
});
export const failedDecisionSchema = z.object({ action: z.enum(['RETRY', 'DISCARD']), reason: z.string().trim().max(300).optional() });
export const webhookCreateSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.string().trim().min(3).max(60)).min(1).max(20),
});

// ------------------------------------------------------------------ master data (admin)
export const masterMerchantViewSchema = z.object({
  id: uuid,
  registration: z.enum(['REFERENCED', 'REGISTERED']),
  organizationId: uuid.nullable(),
  brand: z.string().nullable(),
  nameEn: z.string(),
  nameAr: z.string().nullable(),
  country: z.string(),
  categoryCode: z.string().nullable(),
  status: z.string(),
  branchCount: z.number().int(),
  offerCount: z.number().int(),
  sources: z.array(
    z.object({
      sourceSystem: z.string(),
      sourceRecordId: z.string(),
      importMethod: z.string(),
      editableBy: z.string(),
      syncStatus: z.string(),
      overrideStatus: z.string(),
      publicationConfirmed: z.boolean(),
      lastSyncAt: z.string().nullable(),
      lastSuccessfulSyncAt: z.string().nullable(),
      lastSourceUpdateAt: z.string().nullable(),
    }),
  ),
  aliases: z.array(z.string()),
});
export type MasterMerchantView = z.infer<typeof masterMerchantViewSchema>;
export const masterListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  registration: z.enum(['REFERENCED', 'REGISTERED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});
export const matchCandidateViewSchema = z.object({
  id: uuid,
  entityType: z.string(),
  confidence: z.number().int(),
  reasons: z.array(z.string()),
  status: z.string(),
  a: z.object({ id: uuid, nameEn: z.string(), country: z.string(), registration: z.string().nullable(), sourceSystems: z.array(z.string()) }),
  b: z.object({ id: uuid, nameEn: z.string(), country: z.string(), registration: z.string().nullable(), sourceSystems: z.array(z.string()) }),
  createdAt: z.string(),
});
export const matchDecisionSchema = z.object({
  decision: z.enum(['MERGE', 'REJECT', 'ALIAS']),
  /** MERGE: the record that survives (defaults to the registered one, else the older one). */
  keepId: uuid.optional(),
  note: z.string().trim().max(300).optional(),
});
export const linkRegisteredSchema = z.object({ organizationId: uuid });
export const overrideCreateSchema = z.object({
  entityType: z.enum(['MERCHANT', 'BRANCH', 'OFFER']),
  entityId: uuid,
  field: z.string().trim().min(2).max(40),
  value: z.unknown(),
  kind: z.enum(['LOCAL', 'TEMPORARY', 'PERMANENT']),
  validUntil: iso.optional(),
  reason: z.string().trim().min(3).max(300),
});
export const conflictViewSchema = z.object({
  id: uuid,
  entityType: z.string(),
  entityId: uuid,
  field: z.string(),
  sourceSystem: z.string(),
  sourceValue: z.unknown(),
  localValue: z.unknown(),
  policy: z.string(),
  status: z.string(),
  resolution: z.string().nullable(),
  createdAt: z.string(),
});
export const conflictDecisionSchema = z.object({
  resolution: z.enum(['SOURCE_WINS', 'DEALDASH_WINS', 'MERCHANT_WINS']),
  note: z.string().trim().max(300).optional(),
});
export const networkOfferViewSchema = z.object({
  id: uuid,
  merchant: z.object({ id: uuid, nameEn: z.string(), nameAr: z.string().nullable(), registered: z.boolean() }),
  titleEn: z.string(),
  titleAr: z.string().nullable(),
  benefitEn: z.string(),
  benefitAr: z.string().nullable(),
  termsEn: z.string().nullable(),
  termsAr: z.string().nullable(),
  channel: z.string(),
  validFrom: z.string(),
  validUntil: z.string().nullable(),
  categoryCode: z.string().nullable(),
  branches: z.array(z.object({ id: uuid, nameEn: z.string(), city: z.string().nullable(), latitude: z.number().nullable(), longitude: z.number().nullable() })),
});
export type NetworkOfferView = z.infer<typeof networkOfferViewSchema>;
