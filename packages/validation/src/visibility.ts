import { z } from 'zod';
import { ALERT_CATEGORIES, ALERT_CHANNELS, ALERT_CODE_KEYS, ALERT_FREQUENCIES, ALERT_SEVERITIES, METRIC_KEYS, REPORT_DIMENSIONS, TARGET_METRIC_KEYS, TIMELINE_KINDS } from '@dealdash/types';

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const product = z.enum(['LIVE', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY']);
const csv = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .trim()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values as unknown as [T, ...T[]])).min(1).max(60));

/** A reporting period (defaults: the last 30 days). */
export const periodQuerySchema = z.object({ from: iso.optional(), to: iso.optional() });

export const reportQuerySchema = periodQuerySchema.extend({
  groupBy: z.enum(REPORT_DIMENSIONS),
  metrics: csv(METRIC_KEYS),
  product: product.optional(),
  campaignId: uuid.optional(),
  branchId: uuid.optional(),
  legalEntityId: uuid.optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  organizationId: uuid.optional(),
});

export const targetCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  metric: z.enum(TARGET_METRIC_KEYS as unknown as [string, ...string[]]),
  product: product.nullable().default(null),
  campaignId: uuid.nullable().default(null),
  branchId: uuid.nullable().default(null),
  legalEntityId: uuid.nullable().default(null),
  targetValue: z.number().int().min(1).max(2_000_000_000),
  currency: z.string().trim().length(3).toUpperCase().nullable().default(null),
  periodStart: iso,
  periodEnd: iso,
  thresholds: z.array(z.number().int().min(1).max(1000)).max(12).default([]),
});

const escalationStep = z.object({ afterMinutes: z.number().int().min(5).max(10_080), toRoles: z.array(z.string().trim().max(60)).min(1).max(10), channels: z.array(z.enum(ALERT_CHANNELS)).max(5).optional() });

export const alertRuleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.enum(ALERT_CODE_KEYS as unknown as [string, ...string[]]),
  enabled: z.boolean().default(true),
  threshold: z.number().int().min(0).max(1_000_000_000).nullable().default(null),
  thresholds: z.array(z.number().int().min(1).max(1000)).max(12).default([]),
  frequency: z.enum(ALERT_FREQUENCIES).default('IMMEDIATE'),
  severity: z.enum(ALERT_SEVERITIES).nullable().default(null),
  channels: z.array(z.enum(ALERT_CHANNELS)).min(1).max(5).default(['IN_APP']),
  recipientRoles: z.array(z.string().trim().max(60)).max(15).default([]),
  recipientUserIds: z.array(uuid).max(50).default([]),
  legalEntityId: uuid.nullable().default(null),
  country: z.string().trim().length(2).toUpperCase().nullable().default(null),
  branchId: uuid.nullable().default(null),
  product: product.nullable().default(null),
  campaignId: uuid.nullable().default(null),
  escalation: z.array(escalationStep).max(4).default([]),
});

export const notificationPreferenceSchema = z.object({
  category: z.enum([...ALERT_CATEGORIES, 'ALL'] as [string, ...string[]]),
  channels: z.array(z.enum(ALERT_CHANNELS)).max(5).default(['IN_APP']),
  frequency: z.enum(ALERT_FREQUENCIES).default('IMMEDIATE'),
  muted: z.boolean().default(false),
});

export const alertListQuerySchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED']).optional(),
  category: z.enum(ALERT_CATEGORIES).optional(),
  organizationId: uuid.optional(),
  platform: z.enum(['true', 'false']).optional(),
});

export const timelineQuerySchema = z.object({
  kinds: z
    .string()
    .trim()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(TIMELINE_KINDS)).max(14))
    .optional(),
  before: iso.optional(),
  take: z.coerce.number().int().min(1).max(300).optional(),
});
