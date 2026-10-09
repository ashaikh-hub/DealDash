import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  RequirePermissions,
  ScopeAware,
} from '../common/decorators';
import type { Actor, RequestMeta } from '../common/request-context';
import {
  MerchantVoucherSalesQueryDto,
  PayableEventsQueryDto,
  PayableSummaryResponse,
  PayableEventsResponse,
  ReverseVoucherRedemptionDto,
  VoucherCreateDto,
  VoucherEndDto,
  VoucherHistoryResponse,
  VoucherListQueryDto,
  VoucherMonitorResponse,
  VoucherOptionsResponse,
  VoucherPauseDto,
  VoucherPreviewResponse,
  VoucherResponse,
  VoucherReversedResponse,
  VoucherRowListResponse,
  VoucherSaveDto,
  VoucherSaveResponse,
  VoucherSalesResponse,
  VoucherStockDto,
  VoucherSubmitResponse,
  VoucherSummaryResponse,
} from './dto';
import { MerchantVouchersService } from './merchant-vouchers.service';
import { VoucherCoreService } from './voucher-core.service';

/**
 * Merchant vouchers, sales, redemptions reversal and the merchant payable foundation. The organisation in the URL must be the
 * caller's own (another organisation returns 404); branch-scoped memberships are refused. Campaign Managers manage voucher
 * campaigns (`merchant.vouchers.manage`); Finance holds no campaign permission but may read the payable view
 * (`merchant.finance.read`); only Owner/Admin can reverse a redemption. All enforced here, never by the UI.
 * Categories and eligibility choices come from the shared `hot-deal-choices` endpoint (one framework).
 */
@ScopeAware()
@ApiTags('merchant-vouchers')
@Controller('merchants/:orgId')
@Audiences('merchant')
export class MerchantVouchersController {
  constructor(
    private readonly vouchers: MerchantVouchersService,
    private readonly core: VoucherCoreService,
  ) {}

  @Get('voucher-options')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: VoucherOptionsResponse })
  async options(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.core.requireMerchantScope(actor, orgId);
    const policy = await this.core.refundPolicy();
    return {
      limits: await this.core.limits(),
      checkoutHoldMinutes: await this.core.checkoutHoldMinutes(),
      refundPolicy: {
        windowHours: policy.windowHours,
        outsideWindow: policy.outsideWindow,
        placeholder: true as const,
      },
      payableRule: { accrualPoint: await this.core.accrualPoint(), placeholder: true as const },
    };
  }

  @Get('vouchers')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: VoucherRowListResponse })
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: VoucherListQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.vouchers.list(actor, orgId, q);
  }

  @Get('vouchers/summary')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: VoucherSummaryResponse })
  summary(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.vouchers.summary(actor, orgId);
  }

  @Post('vouchers')
  @Idempotent()
  @RequirePermissions('merchant.vouchers.manage')
  @ApiOkResponse({ type: VoucherResponse })
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: VoucherCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.vouchers.create(actor, orgId, body.content, meta);
  }

  @Get('vouchers/sales')
  @RequirePermissions('merchant.redemptions.read')
  @ApiOkResponse({ type: VoucherSalesResponse })
  sales(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: MerchantVoucherSalesQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.vouchers.sales(actor, orgId, q);
  }

  @Get('vouchers/:id')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: VoucherResponse })
  get(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.vouchers.get(actor, orgId, id);
  }

  @Put('vouchers/:id')
  @RequirePermissions('merchant.vouchers.manage')
  @ApiOkResponse({ type: VoucherSaveResponse })
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherSaveDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.vouchers.update(actor, orgId, id, body.content, body.expectedVersion, meta);
  }

  @Post('vouchers/:id/submit')
  @HttpCode(200)
  @RequirePermissions('merchant.vouchers.manage')
  @ApiOkResponse({ type: VoucherSubmitResponse })
  submit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.vouchers.submit(actor, orgId, id, meta);
  }

  @Post('vouchers/:id/pause')
  @HttpCode(200)
  @RequirePermissions('merchant.vouchers.manage')
  @ApiOkResponse({ type: VoucherResponse })
  pause(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherPauseDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.vouchers.pause(actor, orgId, id, body.reason, meta);
  }

  @Post('vouchers/:id/resume')
  @HttpCode(200)
  @RequirePermissions('merchant.vouchers.manage')
  @ApiOkResponse({ type: VoucherResponse })
  resume(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.vouchers.resume(actor, orgId, id, meta);
  }

  @Post('vouchers/:id/end')
  @HttpCode(200)
  @RequirePermissions('merchant.vouchers.manage')
  @ApiOkResponse({ type: VoucherResponse })
  end(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherEndDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.vouchers.end(actor, orgId, id, body.reason, meta);
  }

  @Post('vouchers/:id/stock')
  @HttpCode(200)
  @RequirePermissions('merchant.vouchers.manage')
  @ApiOkResponse({ type: VoucherResponse })
  stock(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: VoucherStockDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.vouchers.stock(actor, orgId, id, body, meta);
  }

  @Get('vouchers/:id/preview')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: VoucherPreviewResponse })
  preview(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.vouchers.preview(actor, orgId, id);
  }

  @Get('vouchers/:id/monitor')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: VoucherMonitorResponse })
  monitor(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.vouchers.monitor(actor, orgId, id);
  }

  @Get('vouchers/:id/history')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: VoucherHistoryResponse })
  history(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.vouchers.history(actor, orgId, id);
  }

  @Post('voucher-redemptions/:redemptionId/reverse')
  @HttpCode(200)
  @RequirePermissions('merchant.redemptions.reverse')
  @ApiOkResponse({ type: VoucherReversedResponse })
  reverse(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('redemptionId', ParseUUIDPipe) redemptionId: string,
    @Body() body: ReverseVoucherRedemptionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.vouchers.reverseRedemption(actor, orgId, redemptionId, body.reason, meta);
  }

  // ---- merchant payable foundation (Finance and Owner)
  @Get('finance/voucher-payable')
  @RequirePermissions('merchant.finance.read')
  @ApiOkResponse({ type: PayableSummaryResponse })
  payable(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.vouchers.payable(actor, orgId);
  }

  @Get('finance/voucher-payable/events')
  @RequirePermissions('merchant.finance.read')
  @ApiOkResponse({ type: PayableEventsResponse })
  payableEvents(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: PayableEventsQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.vouchers.payableEvents(actor, orgId, q);
  }
}
