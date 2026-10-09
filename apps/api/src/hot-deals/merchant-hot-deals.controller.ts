import { AppError } from '../common/errors';
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
import { CategoriesService } from '../live-deals/categories.service';
import { DealOptionsResponse, DealHistoryResponse } from '../live-deals/dto';
import { EligibilityService } from '../live-deals/eligibility.service';
import {
  CancelReservationDto,
  HotDealActivityResponse,
  HotDealCancelDto,
  HotDealCreateDto,
  HotDealListQueryDto,
  HotDealMonitorResponse,
  HotDealOptionsResponse,
  HotDealPauseDto,
  HotDealPreviewResponse,
  HotDealResponse,
  HotDealRowListResponse,
  HotDealSaveDto,
  HotDealSaveResponse,
  HotDealStockDto,
  HotDealSubmitResponse,
  HotDealSummaryResponse,
  MerchantRedemptionListResponse,
  MerchantReservationListResponse,
  RedemptionListQueryDto,
  ReservationResponse,
  ReservationsQueryDto,
  ReverseRedemptionDto,
  SubStatusResponse,
} from './dto';
import { HotCoreService } from './hot-core.service';
import { MerchantHotDealsService } from './merchant-hot-deals.service';
import { RedemptionService } from './redemption.service';

/**
 * Merchant Exclusive Deals, live monitor, reservations and redemptions. The organisation in the URL must be the caller's own
 * (another organisation returns 404), the caller must hold the right permission, and branch-scoped memberships are
 * refused. Campaign Managers manage campaigns; Finance holds no campaign permission; only Owner/Admin can reverse a
 * redemption. All enforced here, never by the UI.
 */
@ScopeAware()
@ApiTags('merchant-hot-deals')
@Controller('merchants/:orgId')
@Audiences('merchant')
export class MerchantHotDealsController {
  constructor(
    private readonly deals: MerchantHotDealsService,
    private readonly core: HotCoreService,
    private readonly categories: CategoriesService,
    private readonly eligibility: EligibilityService,
    private readonly redemptions: RedemptionService,
  ) {}

  @Get('hot-deal-options')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: HotDealOptionsResponse })
  async options(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.core.requireMerchantScope(actor, orgId);
    return {
      limits: await this.core.limits(),
      defaultHoldMinutes: await this.core.holdMinutes({ holdMinutes: null }),
      maxActiveReservations: await this.core.maxActiveReservations(),
    };
  }

  /** Same categories and eligibility choices as Live Deals (one framework). */
  @Get('hot-deal-choices')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: DealOptionsResponse })
  async choices(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.core.requireMerchantScope(actor, orgId);
    return {
      categories: await this.categories.list(),
      eligibility: {
        ...(await this.eligibility.options()),
        cities: await this.core.enabledCities(),
      },
    };
  }

  @Get('hot-deals')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: HotDealRowListResponse })
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: HotDealListQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.list(actor, orgId, q);
  }

  @Get('hot-deals/summary')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: HotDealSummaryResponse })
  summary(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.deals.summary(actor, orgId);
  }

  @Post('hot-deals')
  @Idempotent()
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: HotDealResponse })
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: HotDealCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.create(actor, orgId, body.content, meta);
  }

  @Get('hot-deals/:id')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: HotDealResponse })
  get(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.get(actor, orgId, id);
  }

  @Put('hot-deals/:id')
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: HotDealSaveResponse })
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDealSaveDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.update(actor, orgId, id, body.content, body.expectedVersion, meta);
  }

  @Post('hot-deals/:id/submit')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: HotDealSubmitResponse })
  submit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.submit(actor, orgId, id, meta);
  }

  @Post('hot-deals/:id/pause')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: HotDealResponse })
  pause(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDealPauseDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.pause(actor, orgId, id, body.reason, meta);
  }

  @Post('hot-deals/:id/resume')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: HotDealResponse })
  resume(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.resume(actor, orgId, id, meta);
  }

  @Post('hot-deals/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: HotDealResponse })
  cancel(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDealCancelDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.cancel(actor, orgId, id, body.reason, meta);
  }

  @Post('hot-deals/:id/stock')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: HotDealResponse })
  stock(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDealStockDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.addStock(actor, orgId, id, body, meta);
  }

  @Get('hot-deals/:id/preview')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: HotDealPreviewResponse })
  preview(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.preview(actor, orgId, id);
  }

  @Get('hot-deals/:id/history')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: DealHistoryResponse })
  history(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.history(actor, orgId, id);
  }

  @Get('hot-deals/:id/monitor')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: HotDealMonitorResponse })
  monitor(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.monitor(actor, orgId, id);
  }

  @Get('hot-deals/:id/activity')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: HotDealActivityResponse })
  activity(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.activity(actor, orgId, id);
  }

  @Get('hot-deals/:id/reservations')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: MerchantReservationListResponse })
  reservations(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ReservationsQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.reservationsFor(actor, orgId, id, q);
  }

  @Post('reservations/:reservationId/cancel')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: ReservationResponse })
  cancelReservation(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() body: CancelReservationDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.cancelReservation(actor, orgId, reservationId, body.reason, meta);
  }

  // ---- redemptions (read for Campaign Manager / Admin; reversal only for Owner / Admin)
  @Get('redemptions')
  @RequirePermissions('merchant.redemptions.read')
  @ApiOkResponse({ type: MerchantRedemptionListResponse })
  async redemptionList(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: RedemptionListQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    this.core.requireMerchantScope(actor, orgId);
    const branches = await this.core.access.visibleBranches(actor, 'merchant.redemptions.read');
    return this.redemptions.listForOrganization(
      orgId,
      q,
      actor.permissions.has('merchant.redemptions.reverse'),
      new Date(),
      branches ? [...branches] : null,
    );
  }

  @Post('redemptions/:redemptionId/reverse')
  @HttpCode(200)
  @RequirePermissions('merchant.redemptions.reverse')
  @ApiOkResponse({ type: SubStatusResponse })
  async reverse(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('redemptionId', ParseUUIDPipe) redemptionId: string,
    @Body() body: ReverseRedemptionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, orgId);
    if (this.core.access.isScoped(actor)) {
      const r = await this.core.prisma.redemption.findFirst({ where: { id: redemptionId, organizationId: orgId }, select: { branchId: true, dealId: true } });
      if (!r) throw AppError.notFound();
      await this.core.access.branch(actor, 'merchant.redemptions.reverse', r.branchId, { product: 'EXCLUSIVE', campaignId: r.dealId });
    }
    return this.redemptions.reverse(
      actor,
      redemptionId,
      body.reason,
      { organizationId: orgId, byDealDash: false },
      meta,
    );
  }
}
