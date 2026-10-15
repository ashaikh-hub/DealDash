import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { HOT_DEAL_STATUSES } from '@dealdash/types';
import {
  adminHotDetailSchema,
  adminHotRowSchema,
  adminRestrictionRowSchema,
  cancelReservationSchema,
  customerCancelSchema,
  dealDecisionSchema,
  envelope,
  hotDealCardSchema,
  hotDealCreateSchema,
  hotDealDetailSchema,
  hotDealListQuerySchema,
  hotDealRowSchema,
  hotDealSaveResultSchema,
  hotDealSaveSchema,
  hotDealStockSchema,
  hotDealSubmitResultSchema,
  hotDealViewSchema,
  hotDiscoveryQuerySchema,
  hotMonitorSchema,
  liveDealEndSchema,
  liveDealPauseSchema,
  merchantReservationRowSchema,
  notificationViewSchema,
  paginationQuerySchema,
  reservationCreateSchema,
  reservationListQuerySchema,
  reservationResultSchema,
  reservationViewSchema,
  reservationsQuerySchema,
  restrictionLiftSchema,
  reverseRedemptionSchema,
  staffCodeSchema,
  staffHistoryQuerySchema,
  staffHistorySchema,
  staffMeSchema,
  staffRedeemSchema,
  staffValidationSchema,
} from '@dealdash/validation';

const uuid = z.string().uuid();
const biText = z.object({ en: z.string(), ar: z.string() });

// ---- requests
export const adminHotListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(HOT_DEAL_STATUSES).optional(),
  queue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  merchantId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
});
export const adminSearchSchema = z.object({
  q: z.string().trim().min(4).max(30),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const restrictionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(['ACTIVE', 'LIFTED', 'ENDED']).optional(),
});
export const markReadSchema = z.object({ id: uuid.optional() });
export const redemptionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  dealId: uuid.optional(),
  branchId: uuid.optional(),
});
export const staffCodeBodySchema = staffCodeSchema.extend({ branchId: uuid.optional() });

export class HotDealCreateDto extends createZodDto(hotDealCreateSchema) {}
export class HotDealSaveDto extends createZodDto(hotDealSaveSchema) {}
export class HotDealListQueryDto extends createZodDto(hotDealListQuerySchema) {}
export class HotDealStockDto extends createZodDto(hotDealStockSchema) {}
export class HotDealPauseDto extends createZodDto(liveDealPauseSchema) {}
export class HotDealCancelDto extends createZodDto(liveDealEndSchema) {}
export class ReservationsQueryDto extends createZodDto(reservationsQuerySchema) {}
export class CancelReservationDto extends createZodDto(cancelReservationSchema) {}
export class CustomerCancelDto extends createZodDto(customerCancelSchema) {}
export class HotDiscoveryQueryDto extends createZodDto(hotDiscoveryQuerySchema) {}
export class ReservationCreateDto extends createZodDto(reservationCreateSchema) {}
export class ReservationListQueryDto extends createZodDto(reservationListQuerySchema) {}
export class StaffCodeDto extends createZodDto(staffCodeBodySchema) {}
export class StaffHistoryQueryDto extends createZodDto(staffHistoryQuerySchema) {}
export class ReverseRedemptionDto extends createZodDto(reverseRedemptionSchema) {}
export class RestrictionLiftDto extends createZodDto(restrictionLiftSchema) {}
export class HotDecisionDto extends createZodDto(dealDecisionSchema) {}
export class AdminHotListQueryDto extends createZodDto(adminHotListQuerySchema) {}
export class AdminSearchDto extends createZodDto(adminSearchSchema) {}
export class RestrictionListQueryDto extends createZodDto(restrictionListQuerySchema) {}
export class MarkReadDto extends createZodDto(markReadSchema) {}
export class RedemptionListQueryDto extends createZodDto(redemptionListQuerySchema) {}
export class HotAuditPageDto extends createZodDto(paginationQuerySchema) {}

// ---- responses
const sub = z.object({ id: uuid, status: z.string() });
const activityItem = z.object({
  id: uuid,
  at: z.string(),
  source: z.enum(['deal', 'reservation']),
  code: z.string(),
  note: z.string().nullable(),
  actor: z.string().nullable(),
  ref: z.string().nullable(),
});
const redemptionRow = z.object({
  id: uuid,
  reference: z.string(),
  status: z.enum(['REDEEMED', 'REVERSED']),
  source: z.enum(['QR', 'MANUAL']),
  redeemedAt: z.string(),
  reversedAt: z.string().nullable(),
  reverseReason: z.string().nullable(),
  dealId: uuid,
  dealTitle: biText,
  branch: biText,
  quantity: z.number().int(),
  staffName: z.string(),
  canReverse: z.boolean(),
});
const overview = z.object({
  counts: z.record(z.string(), z.number()),
  last24h: z.object({
    reservationsCreated: z.number(),
    redeemed: z.number(),
    notCompleted: z.number(),
    cancelled: z.number(),
  }),
  heldNow: z.number(),
  activeRestrictions: z.number(),
  liveDeals: z.array(
    adminHotRowSchema.extend({
      availableUnits: z.number(),
      reservedUnits: z.number(),
      redeemedUnits: z.number(),
    }),
  ),
});
const adminSearchRow = z.object({
  id: uuid,
  reference: z.string(),
  status: z.string(),
  quantity: z.number(),
  dealId: uuid,
  dealTitle: biText,
  organizationId: uuid,
  branch: biText,
  expiresAt: z.string(),
  createdAt: z.string(),
  redeemedAt: z.string().nullable(),
});
const hotOptions = z.object({
  limits: z.object({
    maxHours: z.number(),
    maxPerCustomer: z.number(),
    maxUnitsPerBranch: z.number(),
    holdMinMinutes: z.number(),
    holdMaxMinutes: z.number(),
  }),
  defaultHoldMinutes: z.number(),
  maxActiveReservations: z.number(),
});

export class HotDealResponse extends createZodDto(envelope(hotDealViewSchema)) {}
export class HotDealRowListResponse extends createZodDto(envelope(z.array(hotDealRowSchema))) {}
export class HotDealSaveResponse extends createZodDto(envelope(hotDealSaveResultSchema)) {}
export class HotDealSubmitResponse extends createZodDto(envelope(hotDealSubmitResultSchema)) {}
export class HotDealPreviewResponse extends createZodDto(envelope(hotDealDetailSchema)) {}
export class HotDealMonitorResponse extends createZodDto(envelope(hotMonitorSchema)) {}
export class HotDealActivityResponse extends createZodDto(envelope(z.array(activityItem))) {}
export class HotDealOptionsResponse extends createZodDto(envelope(hotOptions)) {}
export class HotDealSummaryResponse extends createZodDto(
  envelope(z.object({ counts: z.record(z.string(), z.number()), total: z.number() })),
) {}
export class MerchantReservationListResponse extends createZodDto(
  envelope(z.array(merchantReservationRowSchema)),
) {}
export class MerchantRedemptionListResponse extends createZodDto(
  envelope(z.array(redemptionRow)),
) {}
export class SubStatusResponse extends createZodDto(envelope(sub)) {}

// ---- reservation commitment model (founder decision 2026-10-15): effective policy and strike reset
const level = z.enum(['MERCHANT', 'CATEGORY', 'MARKET', 'BASELINE']);
const policyFields = z.object({
  freeAllowed: z.boolean().nullable(),
  allowedMethods: z.array(z.string()),
  depositMinMinor: z.number().int(),
  depositMaxMinor: z.number().int(),
  nonRefundableDepositAllowed: z.boolean(),
  preauthMaxMinor: z.number().int(),
  cutoffMinMinutes: z.number().int(),
  cutoffMaxMinutes: z.number().int(),
  paymentWindowMinutes: z.number().int(),
  prepaymentRefundMinPercent: z.number().int(),
  prepaymentRefundMaxPercent: z.number().int(),
  prepaymentRefundDefaultPercent: z.number().int(),
  commissionBps: z.number().int(),
  additionalRedemptionFee: z.boolean(),
});
const effectivePolicy = z.object({
  market: z.string(),
  marketStatus: z.string().nullable(),
  /** RC-05, decided for this environment and market. */
  freeAllowed: z.boolean(),
  fields: policyFields,
  source: z.record(z.string(), level),
  problems: z.array(z.string()),
});
export class EffectivePolicyQueryDto extends createZodDto(
  z.object({
    market: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .transform((v) => v.toUpperCase()),
    categoryId: uuid.optional(),
    organizationId: uuid.optional(),
  }),
) {}
export class MerchantPolicyQueryDto extends createZodDto(
  z.object({ categoryId: uuid.optional(), branchId: uuid.optional() }),
) {}
export class ReservationPolicyResponse extends createZodDto(envelope(effectivePolicy)) {}
const reservationRefundRow = z.object({
  id: uuid,
  reference: z.string(),
  reservationId: uuid,
  organizationId: uuid,
  amountMinor: z.number().int(),
  currency: z.string(),
  status: z.string(),
  reasonCode: z.string(),
  failureCode: z.string().nullable(),
  attempts: z.number().int(),
  createdAt: z.string(),
  refundedAt: z.string().nullable(),
});
export class ReservationRefundResponse extends createZodDto(envelope(reservationRefundRow)) {}
export class ReservationRefundListResponse extends createZodDto(
  envelope(z.array(reservationRefundRow)),
) {}
export class StrikeResetResponse extends createZodDto(
  envelope(z.object({ reset: z.number().int(), reservationIds: z.array(uuid) })),
) {}
export class AdminHotListResponse extends createZodDto(envelope(z.array(adminHotRowSchema))) {}
export class AdminHotDetailResponse extends createZodDto(envelope(adminHotDetailSchema)) {}
export class AdminHotOverviewResponse extends createZodDto(envelope(overview)) {}
export class AdminRestrictionListResponse extends createZodDto(
  envelope(z.array(adminRestrictionRowSchema)),
) {}
export class AdminReservationSearchResponse extends createZodDto(
  envelope(z.array(adminSearchRow)),
) {}
export class AdminRedemptionsResponse extends createZodDto(
  envelope(
    z.array(
      redemptionRow.pick({
        id: true,
        reference: true,
        status: true,
        source: true,
        redeemedAt: true,
        reversedAt: true,
        reverseReason: true,
      }),
    ),
  ),
) {}
export class HotCardListResponse extends createZodDto(envelope(z.array(hotDealCardSchema))) {}
export class HotDetailResponse extends createZodDto(envelope(hotDealDetailSchema)) {}
export class ReservationResponse extends createZodDto(envelope(reservationViewSchema)) {}
export class ReservationListResponse extends createZodDto(
  envelope(z.array(reservationViewSchema)),
) {}
export class ReservationResultResponse extends createZodDto(envelope(reservationResultSchema)) {}
export class NotificationListResponse extends createZodDto(
  envelope(z.object({ unread: z.number(), items: z.array(notificationViewSchema) })),
) {}
export class UpdatedResponse extends createZodDto(envelope(z.object({ updated: z.number() }))) {}
export class StaffMeResponse extends createZodDto(envelope(staffMeSchema)) {}
export class StaffValidationResponse extends createZodDto(envelope(staffValidationSchema)) {}
export class StaffRedeemResponse extends createZodDto(envelope(staffRedeemSchema)) {}
export class StaffHistoryResponse extends createZodDto(envelope(staffHistorySchema)) {}
