import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Audiences, CurrentActor, Meta, RequirePermissions } from '../common/decorators';
import type { Actor, RequestMeta } from '../common/request-context';
import {
  AdminCaseListQueryDto,
  AdminCaseListResponse,
  AdminCaseResponse,
  AdjustmentDto,
  AdminOrderDetailResponse,
  AdminRefundCreateDto,
  AdminRefundListQueryDto,
  AdminRefundListResponse,
  AdminRefundResponse,
  AdminVoucherDetailResponse,
  AdminVoucherListQueryDto,
  AdminVoucherListResponse,
  CaseUpdateDto,
  FinanceOverviewResponse,
  FinanceSearchDto,
  FinanceSearchResponse,
  JournalCreatedResponse,
  PayableEventsQueryDto,
  PayableEventsResponse,
  PayableSummaryResponse,
  RefundDecisionDto,
  ReverseVoucherRedemptionDto,
  VoucherAuditPageDto,
  VoucherAuditResponse,
  VoucherDecisionDto,
  VoucherMonitorResponse,
  VoucherReversedResponse,
} from './dto';
import { FinanceAdminService } from './finance-admin.service';
import { RefundsService } from './refunds.service';
import { SupportCasesService } from './support-cases.service';
import { VoucherRedemptionService } from './voucher-redemption.service';
import { VoucherReviewService } from './voucher-review.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { assertDirectAdjustmentAllowed } from '../ops/ops-util';

/**
 * DealDash voucher review and live controls. Cross-tenant by design, so gated by admin permissions only: review decisions
 * need `admin.campaigns.review`; pause/suspend/reinstate need `admin.campaigns.control` (Support holds neither).
 */
@ApiTags('admin-vouchers')
@Controller('admin/vouchers')
@Audiences('admin')
export class AdminVouchersController {
  constructor(private readonly review: VoucherReviewService) {}

  @Get()
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminVoucherListResponse })
  list(@Query() q: AdminVoucherListQueryDto) {
    return this.review.list(q);
  }

  @Get(':id')
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminVoucherDetailResponse })
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.review.detail(actor, id);
  }

  @Get(':id/monitor')
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: VoucherMonitorResponse })
  monitor(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.monitor(id);
  }

  @Get(':id/audit')
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: VoucherAuditResponse })
  audit(@Param('id', ParseUUIDPipe) id: string, @Query() q: VoucherAuditPageDto) {
    return this.review.auditTrail(id, q);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminVoucherDetailResponse })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.approve(actor, id, body, meta);
  }

  @Post(':id/request-changes')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminVoucherDetailResponse })
  requestChanges(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.requestChanges(actor, id, body, meta);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminVoucherDetailResponse })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reject(actor, id, body, meta);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminVoucherDetailResponse })
  pause(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.pause(actor, id, body, meta);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminVoucherDetailResponse })
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.resume(actor, id, body, meta);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminVoucherDetailResponse })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.suspend(actor, id, body, meta);
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminVoucherDetailResponse })
  reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reinstate(actor, id, body, meta);
  }
}

/**
 * Minimum Stage 5 finance and refund workbench. Lookups need `admin.vouchers.lookup` (Finance, Support, Operations: Support
 * sees provider data redacted); refund decisions, redemption reversal and adjustments need the finance permissions.
 * Settlement operations are Stage 8.
 */
@ApiTags('admin-finance')
@Controller('admin/finance')
@Audiences('admin')
export class AdminFinanceController {
  constructor(
    private readonly finance: FinanceAdminService,
    private readonly refunds: RefundsService,
    private readonly redemption: VoucherRedemptionService,
    private readonly cases: SupportCasesService,
    private readonly config: SystemConfigService,
  ) {}

  @Get('overview')
  @RequirePermissions('admin.payments.read')
  @ApiOkResponse({ type: FinanceOverviewResponse })
  overview() {
    return this.finance.overview();
  }

  @Get('search')
  @RequirePermissions('admin.vouchers.lookup')
  @ApiOkResponse({ type: FinanceSearchResponse })
  search(@Query() q: FinanceSearchDto) {
    return this.finance.search(q.q, q.limit);
  }

  @Get('orders/:id')
  @RequirePermissions('admin.vouchers.lookup')
  @ApiOkResponse({ type: AdminOrderDetailResponse })
  order(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.finance.orderDetail(actor, id);
  }

  @Get('refunds')
  @RequirePermissions('admin.vouchers.lookup')
  @ApiOkResponse({ type: AdminRefundListResponse })
  refundList(@Query() q: AdminRefundListQueryDto, @CurrentActor() actor: Actor) {
    return this.refunds.listAdmin(actor, q);
  }

  @Post('refunds')
  @HttpCode(201)
  @RequirePermissions('admin.refunds.manage')
  @ApiOkResponse({ type: AdminRefundResponse })
  refundCreate(
    @Body() body: AdminRefundCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.refunds.createByAdmin(actor, body, meta);
  }

  @Post('refunds/:id/approve')
  @HttpCode(200)
  @RequirePermissions('admin.refunds.manage')
  @ApiOkResponse({ type: AdminRefundResponse })
  refundApprove(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RefundDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.refunds.approve(actor, id, body.reason, meta);
  }

  @Post('refunds/:id/reject')
  @HttpCode(200)
  @RequirePermissions('admin.refunds.manage')
  @ApiOkResponse({ type: AdminRefundResponse })
  refundReject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RefundDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.refunds.reject(actor, id, body.reason, meta);
  }

  @Post('refunds/:id/retry')
  @HttpCode(200)
  @RequirePermissions('admin.refunds.manage')
  @ApiOkResponse({ type: AdminRefundResponse })
  refundRetry(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.refunds.retry(actor, id, meta);
  }

  /** DealDash reversal of a voucher redemption (RD-40): the only way a redeemed voucher can later be refunded. */
  @Post('redemptions/:id/reverse')
  @HttpCode(200)
  @RequirePermissions('admin.refunds.manage')
  @ApiOkResponse({ type: VoucherReversedResponse })
  reverse(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReverseVoucherRedemptionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.redemption.reverse(actor, id, body.reason, { organizationId: null }, meta);
  }

  @Get('merchants/:orgId/payable')
  @RequirePermissions('admin.payments.read')
  @ApiOkResponse({ type: PayableSummaryResponse })
  payable(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.finance.merchantPayable(orgId);
  }

  @Get('merchants/:orgId/payable/events')
  @RequirePermissions('admin.payments.read')
  @ApiOkResponse({ type: PayableEventsResponse })
  payableEvents(@Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: PayableEventsQueryDto) {
    return this.finance.merchantPayableEvents(orgId, q);
  }

  @Post('adjustments')
  @HttpCode(201)
  @RequirePermissions('admin.settlements.manage')
  @ApiOkResponse({ type: JournalCreatedResponse })
  async adjust(
    @Body() body: AdjustmentDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await assertDirectAdjustmentAllowed(this.config, body.amountHalalas);
    return this.finance.adjust(actor, body, meta);
  }

  // ---- support cases linked to vouchers, orders, payments, refunds, redemptions
  @Get('cases')
  @RequirePermissions('admin.vouchers.lookup')
  @ApiOkResponse({ type: AdminCaseListResponse })
  caseList(@Query() q: AdminCaseListQueryDto) {
    return this.cases.listAdmin(q);
  }

  @Post('cases/:id')
  @HttpCode(200)
  @RequirePermissions('admin.support.manage')
  @ApiOkResponse({ type: AdminCaseResponse })
  caseUpdate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CaseUpdateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cases.update(actor, id, body, meta);
  }
}
