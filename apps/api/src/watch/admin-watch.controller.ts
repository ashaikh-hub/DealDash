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
import { Audiences, CurrentActor, Meta, RequirePermissions } from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import {
  AdminWatchDetailResponse,
  AdminWatchListQueryDto,
  AdminWatchListResponse,
  AdminWatchOverviewResponse,
  RewardAccountListResponse,
  RewardAccountSearchDto,
  RewardAdjustmentCreateDto,
  RewardAdjustmentDecisionDto,
  RewardAdjustmentListQueryDto,
  RewardAdjustmentListResponse,
  RewardAdjustmentResponse,
  RewardAdminOverviewResponse,
  RewardItemSaveDto,
  RewardItemSavedResponse,
  RewardLedgerQueryDto,
  RewardLedgerResponse,
  RewardReconcileResponse,
  RiskDecisionDto,
  RiskFlagDetailResponse,
  RiskFlagListQueryDto,
  RiskFlagListResponse,
  WatchAuditPageDto,
  WatchAuditResponse,
  WatchBudgetResponse,
  WatchDecisionDto,
  WatchMonitorResponse,
} from './dto';
import { RewardsAdminService } from './rewards-admin.service';
import { RiskService } from './risk.service';
import { WatchReviewService } from './watch-review.service';

/**
 * DealDash review and live controls for Watch & Earn. Cross-tenant by design, so gated by admin permissions only: reading
 * needs `admin.watch.read` (Campaign Ops, Finance, Risk, Marketing); review decisions need `admin.campaigns.review`;
 * pause / suspend / reinstate / stop need `admin.campaigns.control` (Support holds neither).
 */
@ApiTags('admin-watch')
@Controller('admin/watch')
@Audiences('admin')
export class AdminWatchController {
  constructor(private readonly review: WatchReviewService) {}

  @Get('overview')
  @RequirePermissions('admin.watch.read')
  @ApiOkResponse({ type: AdminWatchOverviewResponse })
  overview() {
    return this.review.overview();
  }

  @Get()
  @RequirePermissions('admin.watch.read')
  @ApiOkResponse({ type: AdminWatchListResponse })
  list(@Query() q: AdminWatchListQueryDto) {
    return this.review.list(q);
  }

  @Get(':id')
  @RequirePermissions('admin.watch.read')
  @ApiOkResponse({ type: AdminWatchDetailResponse })
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.review.detail(actor, id);
  }

  @Get(':id/monitor')
  @RequirePermissions('admin.watch.read')
  @ApiOkResponse({ type: WatchMonitorResponse })
  monitor(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.monitor(id);
  }

  @Get(':id/budget')
  @RequirePermissions('admin.watch.read')
  @ApiOkResponse({ type: WatchBudgetResponse })
  budget(@Param('id', ParseUUIDPipe) id: string) {
    return this.review.budget(id);
  }

  @Get(':id/audit')
  @RequirePermissions('admin.watch.read')
  @ApiOkResponse({ type: WatchAuditResponse })
  audit(@Param('id', ParseUUIDPipe) id: string, @Query() q: WatchAuditPageDto) {
    return this.review.auditTrail(id, q);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminWatchDetailResponse })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.approve(actor, id, body, meta);
  }

  @Post(':id/request-changes')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminWatchDetailResponse })
  requestChanges(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.requestChanges(actor, id, body, meta);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminWatchDetailResponse })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reject(actor, id, body, meta);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminWatchDetailResponse })
  pause(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.pause(actor, id, body, meta);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminWatchDetailResponse })
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.resume(actor, id, body, meta);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminWatchDetailResponse })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.suspend(actor, id, body, meta);
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminWatchDetailResponse })
  reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reinstate(actor, id, body, meta);
  }

  @Post(':id/stop')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminWatchDetailResponse })
  stop(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.stop(actor, id, body, meta);
  }
}

/** Risk and fraud cases. Inspecting and deciding needs `admin.risk.manage` (Risk & Compliance). */
@ApiTags('admin-risk')
@Controller('admin/risk')
@Audiences('admin')
export class AdminRiskController {
  constructor(private readonly risk: RiskService) {}

  @Get('flags')
  @RequirePermissions('admin.risk.manage')
  @ApiOkResponse({ type: RiskFlagListResponse })
  list(@Query() q: RiskFlagListQueryDto) {
    return this.risk.list(q);
  }

  @Get('flags/:id')
  @RequirePermissions('admin.risk.manage')
  @ApiOkResponse({ type: RiskFlagDetailResponse })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.risk.detail(id);
  }

  @Post('flags/:id/decide')
  @HttpCode(200)
  @RequirePermissions('admin.risk.manage')
  @ApiOkResponse({ type: RiskFlagDetailResponse })
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RiskDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.risk.decide(actor, id, body, meta);
  }
}

/**
 * Rewards administration. Reading the liability, accounts and ledger needs `admin.rewards.read` (Finance, Risk); manual
 * adjustments can be REQUESTED by Support (`admin.rewards.request`) and are approved by `admin.rewards.manage`; above the
 * configured threshold a DIFFERENT administrator must approve. The catalogue is edited with `admin.rewards.manage`.
 */
@ApiTags('admin-rewards')
@Controller('admin/rewards')
@Audiences('admin')
export class AdminRewardsController {
  constructor(private readonly rewards: RewardsAdminService) {}

  @Get('overview')
  @RequirePermissions('admin.rewards.read')
  @ApiOkResponse({ type: RewardAdminOverviewResponse })
  overview() {
    return this.rewards.overview();
  }

  @Get('accounts')
  @RequirePermissions('admin.rewards.read')
  @ApiOkResponse({ type: RewardAccountListResponse })
  accounts(@Query() q: RewardAccountSearchDto) {
    return this.rewards.accounts(q);
  }

  @Get('ledger')
  @RequirePermissions('admin.rewards.read')
  @ApiOkResponse({ type: RewardLedgerResponse })
  ledger(@Query() q: RewardLedgerQueryDto) {
    return this.rewards.ledgerList(q);
  }

  @Get('reconcile')
  @RequirePermissions('admin.rewards.read')
  @ApiOkResponse({ type: RewardReconcileResponse })
  reconcile() {
    return this.rewards.reconcile();
  }

  @Get('adjustments')
  @RequirePermissions('admin.rewards.request')
  @ApiOkResponse({ type: RewardAdjustmentListResponse })
  adjustments(@Query() q: RewardAdjustmentListQueryDto, @CurrentActor() actor: Actor) {
    return this.rewards.adjustments(actor, q);
  }

  @Post('adjustments')
  @HttpCode(200)
  @RequirePermissions('admin.rewards.request')
  @ApiOkResponse({ type: RewardAdjustmentResponse })
  request(
    @Body() body: RewardAdjustmentCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.rewards.requestAdjustment(actor, body, meta);
  }

  @Post('adjustments/:id/approve')
  @HttpCode(200)
  @RequirePermissions('admin.rewards.manage')
  @ApiOkResponse({ type: RewardAdjustmentResponse })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RewardAdjustmentDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.rewards.decideAdjustment(actor, id, true, body.reason, meta);
  }

  @Post('adjustments/:id/reject')
  @HttpCode(200)
  @RequirePermissions('admin.rewards.manage')
  @ApiOkResponse({ type: RewardAdjustmentResponse })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RewardAdjustmentDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.rewards.decideAdjustment(actor, id, false, body.reason, meta);
  }

  @Post('items')
  @HttpCode(200)
  @RequirePermissions('admin.rewards.manage')
  @ApiOkResponse({ type: RewardItemSavedResponse })
  async createItem(
    @Body() body: RewardItemSaveDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return { id: await this.rewards.saveItem(actor, null, body, meta) };
  }

  @Put('items/:id')
  @RequirePermissions('admin.rewards.manage')
  @ApiOkResponse({ type: RewardItemSavedResponse })
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RewardItemSaveDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (!actor.permissions.has('admin.rewards.manage')) throw AppError.forbidden();
    return { id: await this.rewards.saveItem(actor, id, body, meta) };
  }
}
