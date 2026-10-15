import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Audiences, CurrentActor, Meta, RequirePermissions } from '../common/decorators';
import type { Actor, RequestMeta } from '../common/request-context';
import { AdminDealAuditResponse } from '../live-deals/dto';
import { AdminReservationsService } from './admin-reservations.service';
import {
  AdminHotDetailResponse,
  AdminHotListQueryDto,
  AdminHotListResponse,
  AdminHotOverviewResponse,
  AdminReservationSearchResponse,
  AdminRedemptionsResponse,
  AdminRestrictionListResponse,
  AdminSearchDto,
  CancelReservationDto,
  HotAuditPageDto,
  HotDealActivityResponse,
  HotDealMonitorResponse,
  HotDecisionDto,
  ReservationResponse,
  RestrictionLiftDto,
  RestrictionListQueryDto,
  ReverseRedemptionDto,
  SubStatusResponse,
  EffectivePolicyQueryDto,
  ReservationPolicyResponse,
  StrikeResetResponse,
} from './dto';
import { HotReviewService } from './hot-review.service';

/**
 * DealDash Exclusive Deal review and live monitoring. Cross-tenant by design, so gated by admin permissions only:
 * review decisions need `admin.campaigns.review`; pause/suspend/reinstate/cancel need `admin.campaigns.control`;
 * Support users hold neither (they cannot approve). Reservation tools need `admin.reservations.manage`.
 */
@ApiTags('admin-hot-deals')
@Controller('admin/hot-deals')
@Audiences('admin')
export class AdminHotDealsController {
  constructor(private readonly review: HotReviewService) {}

  @Get()
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminHotListResponse })
  list(@Query() q: AdminHotListQueryDto) {
    return this.review.list(q);
  }

  @Get('overview')
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminHotOverviewResponse })
  overview() {
    return this.review.overview();
  }

  @Get(':id')
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminHotDetailResponse })
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.review.detail(actor, id);
  }

  @Get(':id/monitor')
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: HotDealMonitorResponse })
  monitor(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.monitor(id);
  }

  @Get(':id/activity')
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: HotDealActivityResponse })
  activity(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.activity(id);
  }

  @Get(':id/audit')
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminDealAuditResponse })
  audit(@Param('id', ParseUUIDPipe) id: string, @Query() q: HotAuditPageDto) {
    return this.review.auditTrail(id, q);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminHotDetailResponse })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.approve(actor, id, body, meta);
  }

  @Post(':id/request-changes')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminHotDetailResponse })
  requestChanges(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.requestChanges(actor, id, body, meta);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminHotDetailResponse })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reject(actor, id, body, meta);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminHotDetailResponse })
  pause(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.pause(actor, id, body, meta);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminHotDetailResponse })
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.resume(actor, id, body, meta);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminHotDetailResponse })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.suspend(actor, id, body, meta);
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminHotDetailResponse })
  reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reinstate(actor, id, body, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminHotDetailResponse })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: HotDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.cancel(actor, id, body, meta);
  }
}

/** Reservation tools for DealDash Operations and Support (restrictions, lookup, cancel, reverse a redemption). */
@ApiTags('admin-reservations')
@Controller('admin/reservations')
@Audiences('admin')
export class AdminReservationsController {
  constructor(private readonly tools: AdminReservationsService) {}

  @Get('restrictions')
  @RequirePermissions('admin.reservations.manage')
  @ApiOkResponse({ type: AdminRestrictionListResponse })
  restrictions(@Query() q: RestrictionListQueryDto) {
    return this.tools.listRestrictions(q);
  }

  @Post('restrictions/:id/lift')
  @HttpCode(200)
  @RequirePermissions('admin.reservations.manage')
  @ApiOkResponse({ type: SubStatusResponse })
  lift(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RestrictionLiftDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.tools.lift(actor, id, body.reason, meta);
  }

  /** RC-52: reset every counted no-show strike of a customer (reason required, audited). */
  @Post('customers/:userId/strike-reset')
  @HttpCode(200)
  @RequirePermissions('admin.reservations.manage')
  @ApiOkResponse({ type: StrikeResetResponse })
  resetCustomerStrikes(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: RestrictionLiftDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.tools.resetStrikes(actor, { userId }, body.reason, meta);
  }

  /** RC-10 / RC-11: the effective reservation policy for a market (and optionally a category and a business), with sources. */
  @Get('policy')
  @RequirePermissions('admin.reservations.manage')
  @ApiOkResponse({ type: ReservationPolicyResponse })
  policy(@Query() q: EffectivePolicyQueryDto) {
    return this.tools.effectivePolicy(q);
  }

  @Get('search')
  @RequirePermissions('admin.reservations.manage')
  @ApiOkResponse({ type: AdminReservationSearchResponse })
  search(@Query() q: AdminSearchDto) {
    return this.tools.search(q);
  }

  @Get(':id/redemptions')
  @RequirePermissions('admin.reservations.manage')
  @ApiOkResponse({ type: AdminRedemptionsResponse })
  redemptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.tools.redemptionsFor(id);
  }

  /** RC-52: reset the counted no-show strike of one reservation (reason required, audited). */
  @Post(':id/strike-reset')
  @HttpCode(200)
  @RequirePermissions('admin.reservations.manage')
  @ApiOkResponse({ type: StrikeResetResponse })
  resetStrike(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RestrictionLiftDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.tools.resetStrikes(actor, { reservationId: id }, body.reason, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('admin.reservations.manage')
  @ApiOkResponse({ type: ReservationResponse })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelReservationDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.tools.cancelReservation(actor, id, body.reason, meta);
  }

  @Post('redemptions/:redemptionId/reverse')
  @HttpCode(200)
  @RequirePermissions('admin.reservations.manage')
  @ApiOkResponse({ type: SubStatusResponse })
  reverse(
    @Param('redemptionId', ParseUUIDPipe) redemptionId: string,
    @Body() body: ReverseRedemptionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.tools.reverse(actor, redemptionId, body.reason, meta);
  }
}
