import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  adjustmentSchema,
  adminCaseListQuerySchema,
  adminCaseRowSchema,
  adminMerchantPayableRowSchema,
  adminOrderDetailSchema,
  adminRefundCreateSchema,
  adminRefundListQuerySchema,
  adminRefundRowSchema,
  adminVoucherDetailSchema,
  adminVoucherListQuerySchema,
  adminVoucherRowSchema,
  caseUpdateSchema,
  checkoutCreateSchema,
  envelope,
  financeOverviewSchema,
  financeSearchRowSchema,
  financeSearchSchema,
  liveDealEndSchema,
  liveDealPauseSchema,
  merchantVoucherSalesQuerySchema,
  merchantVoucherSaleRowSchema,
  orderListQuerySchema,
  orderViewSchema,
  paginationQuerySchema,
  payableEventRowSchema,
  payableEventsQuerySchema,
  payableSummarySchema,
  payOrderSchema,
  refundDecisionSchema,
  refundRequestSchema,
  refundViewSchema,
  reverseRedemptionSchema,
  supportCaseCreateSchema,
  supportCaseViewSchema,
  voucherCardSchema,
  voucherCreateSchema,
  voucherDecisionSchema,
  voucherDetailSchema,
  voucherDiscoveryQuerySchema,
  voucherListQuerySchema,
  voucherMonitorSchema,
  voucherRowSchema,
  voucherSaveResultSchema,
  voucherSaveSchema,
  voucherStockSchema,
  voucherSubmitResultSchema,
  voucherViewSchema,
  walletDetailSchema,
  walletItemSchema,
  walletQuerySchema,
} from '@dealdash/validation';

const uuid = z.string().uuid();

// ---- requests
export class VoucherCreateDto extends createZodDto(voucherCreateSchema) {}
export class VoucherSaveDto extends createZodDto(voucherSaveSchema) {}
export class VoucherListQueryDto extends createZodDto(voucherListQuerySchema) {}
export class VoucherStockDto extends createZodDto(voucherStockSchema) {}
export class VoucherPauseDto extends createZodDto(liveDealPauseSchema) {}
export class VoucherEndDto extends createZodDto(liveDealEndSchema) {}
export class VoucherDiscoveryQueryDto extends createZodDto(voucherDiscoveryQuerySchema) {}
export class CheckoutCreateDto extends createZodDto(checkoutCreateSchema) {}
export class PayOrderDto extends createZodDto(payOrderSchema) {}
export class RefundRequestDto extends createZodDto(refundRequestSchema) {}
export class OrderListQueryDto extends createZodDto(orderListQuerySchema) {}
export class WalletQueryDto extends createZodDto(walletQuerySchema) {}
export class SupportCaseCreateDto extends createZodDto(supportCaseCreateSchema) {}
export class VoucherDecisionDto extends createZodDto(voucherDecisionSchema) {}
export class RefundDecisionDto extends createZodDto(refundDecisionSchema) {}
export class AdminRefundCreateDto extends createZodDto(adminRefundCreateSchema) {}
export class AdminRefundListQueryDto extends createZodDto(adminRefundListQuerySchema) {}
export class AdminCaseListQueryDto extends createZodDto(adminCaseListQuerySchema) {}
export class CaseUpdateDto extends createZodDto(caseUpdateSchema) {}
export class AdjustmentDto extends createZodDto(adjustmentSchema) {}
export class AdminVoucherListQueryDto extends createZodDto(adminVoucherListQuerySchema) {}
export class FinanceSearchDto extends createZodDto(financeSearchSchema) {}
export class MerchantVoucherSalesQueryDto extends createZodDto(merchantVoucherSalesQuerySchema) {}
export class PayableEventsQueryDto extends createZodDto(payableEventsQuerySchema) {}
export class ReverseVoucherRedemptionDto extends createZodDto(reverseRedemptionSchema) {}
export class VoucherAuditPageDto extends createZodDto(paginationQuerySchema) {}

// ---- responses
const voucherOptions = z.object({
  limits: z.object({
    minValidityDays: z.number(),
    maxValidityDays: z.number(),
    maxFaceValueHalalas: z.number(),
    maxQtyPerVoucher: z.number(),
    maxPerCustomer: z.number(),
    reviewAboveDiscountPercent: z.number(),
  }),
  checkoutHoldMinutes: z.number(),
  refundPolicy: z.object({
    windowHours: z.number(),
    outsideWindow: z.enum(['REVIEW', 'BLOCK']),
    placeholder: z.literal(true),
  }),
  payableRule: z.object({ accrualPoint: z.string(), placeholder: z.literal(true) }),
});
const summary = z.object({ counts: z.record(z.string(), z.number()), total: z.number() });
const stub = z.object({ id: uuid, status: z.string() });
const reversed = z.object({ id: uuid, status: z.literal('REVERSED') });
const journalCreated = z.object({ journalId: uuid, reference: z.string() });
const activityItem = z.object({
  id: uuid,
  at: z.string(),
  code: z.string(),
  note: z.string().nullable(),
  actor: z.string().nullable(),
});
const voucherNotice = z.object({ updated: z.number() });
const historyRow = z.object({
  id: uuid,
  action: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  reason: z.string().nullable(),
  reasonAr: z.string().nullable(),
  fields: z.array(z.string()),
  actorRole: z.string().nullable(),
  actorName: z.string().nullable(),
  byDealDash: z.boolean(),
  createdAt: z.string(),
});
const auditRow = z.object({
  id: uuid,
  occurredAt: z.string(),
  action: z.string(),
  actorRole: z.string().nullable(),
  actorUserId: z.string().nullable(),
  reason: z.string().nullable(),
  entityType: z.string(),
});

export class VoucherOptionsResponse extends createZodDto(envelope(voucherOptions)) {}
export class VoucherResponse extends createZodDto(envelope(voucherViewSchema)) {}
export class VoucherRowListResponse extends createZodDto(envelope(z.array(voucherRowSchema))) {}
export class VoucherSaveResponse extends createZodDto(envelope(voucherSaveResultSchema)) {}
export class VoucherSubmitResponse extends createZodDto(envelope(voucherSubmitResultSchema)) {}
export class VoucherPreviewResponse extends createZodDto(envelope(voucherDetailSchema)) {}
export class VoucherMonitorResponse extends createZodDto(envelope(voucherMonitorSchema)) {}
export class VoucherSummaryResponse extends createZodDto(envelope(summary)) {}
export class VoucherSalesResponse extends createZodDto(
  envelope(z.array(merchantVoucherSaleRowSchema)),
) {}
export class VoucherReversedResponse extends createZodDto(envelope(reversed)) {}
export class PayableSummaryResponse extends createZodDto(envelope(payableSummarySchema)) {}
export class PayableEventsResponse extends createZodDto(envelope(z.array(payableEventRowSchema))) {}
export class VoucherActivityResponse extends createZodDto(envelope(z.array(activityItem))) {}
export class VoucherHistoryResponse extends createZodDto(envelope(z.array(historyRow))) {}
export class VoucherAuditResponse extends createZodDto(envelope(z.array(auditRow))) {}

export class AdminVoucherListResponse extends createZodDto(
  envelope(z.array(adminVoucherRowSchema)),
) {}
export class AdminVoucherDetailResponse extends createZodDto(envelope(adminVoucherDetailSchema)) {}
export class AdminRefundListResponse extends createZodDto(
  envelope(z.array(adminRefundRowSchema)),
) {}
export class AdminRefundResponse extends createZodDto(envelope(adminRefundRowSchema)) {}
export class AdminOrderDetailResponse extends createZodDto(envelope(adminOrderDetailSchema)) {}
export class FinanceSearchResponse extends createZodDto(
  envelope(z.array(financeSearchRowSchema)),
) {}
export class FinanceOverviewResponse extends createZodDto(envelope(financeOverviewSchema)) {}
export class MerchantPayableRowResponse extends createZodDto(
  envelope(adminMerchantPayableRowSchema),
) {}
export class AdminCaseListResponse extends createZodDto(envelope(z.array(adminCaseRowSchema))) {}
export class AdminCaseResponse extends createZodDto(envelope(adminCaseRowSchema)) {}
export class JournalCreatedResponse extends createZodDto(envelope(journalCreated)) {}
export class StubResponse extends createZodDto(envelope(stub)) {}

export class VoucherCardListResponse extends createZodDto(envelope(z.array(voucherCardSchema))) {}
export class VoucherDetailResponse extends createZodDto(envelope(voucherDetailSchema)) {}
export class OrderResponse extends createZodDto(envelope(orderViewSchema)) {}
export class OrderListResponse extends createZodDto(envelope(z.array(orderViewSchema))) {}
export class WalletListResponse extends createZodDto(envelope(z.array(walletItemSchema))) {}
export class WalletDetailResponse extends createZodDto(envelope(walletDetailSchema)) {}
export class RefundResponse extends createZodDto(envelope(refundViewSchema)) {}
export class SupportCaseResponse extends createZodDto(envelope(supportCaseViewSchema)) {}
export class VoucherNoticeResponse extends createZodDto(envelope(voucherNotice)) {}
