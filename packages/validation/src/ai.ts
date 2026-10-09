import { z } from 'zod';
import { AI_AGENTS } from '@dealdash/types';

/** One turn with an assistant. The locale may be any code; unsupported ones are answered in English and say so. */
export const aiAskSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  locale: z.string().trim().min(2).max(10).optional(),
  autonomy: z.number().int().min(0).max(5).optional(),
  context: z
    .object({
      city: z.string().trim().max(80).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      category: z.string().trim().max(60).optional(),
      customerUserId: z.string().uuid().optional(),
    })
    .strict()
    .optional(),
});

export const aiAdminAskSchema = aiAskSchema.extend({
  agent: z.enum(['OPERATIONS_SUPPORT', 'ADMIN_FINANCE']),
  organizationId: z.string().uuid().optional(),
});

export const aiDecisionSchema = z.object({ reason: z.string().trim().max(500).optional() });

export const aiDraftQuerySchema = z.object({
  status: z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED']).optional(),
});

export const aiInteractionQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  agent: z.enum(AI_AGENTS).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

export const aiUsageQuerySchema = z.object({
  organizationId: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});
