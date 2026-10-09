import {
  Body,
  Controller,
  Get,
  Headers,
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
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import {
  WatchBudgetResponse,
  WatchCancelDto,
  WatchCreateDto,
  WatchFundDto,
  WatchHistoryResponse,
  WatchListQueryDto,
  WatchMediaIntentDto,
  WatchMediaIntentResponse,
  WatchMonitorResponse,
  WatchOptionsResponse,
  WatchPauseDto,
  WatchPreviewResponse,
  WatchResponse,
  WatchRowListResponse,
  WatchSaveDto,
  WatchSaveResponse,
  WatchSubmitResponse,
  WatchSummaryResponse,
} from './dto';
import { WatchCoreService } from './watch-core.service';
import { FilesService } from '../files/files.service';
import { MerchantWatchService } from './merchant-watch.service';

/**
 * Merchant Watch & Earn campaigns. The organisation in the URL must be the caller's own (another organisation returns 404);
 * branch-scoped memberships are refused. Campaign Managers manage campaigns (`merchant.watch.manage`); Finance can READ them and
 * fund the budget (`merchant.finance.manage`) but cannot edit content; Staff have no access. There is NO reward-amount field
 * anywhere in these requests: the customer reward is DealDash's alone. All enforced here, never by the UI.
 */
@ScopeAware()
@ApiTags('merchant-watch')
@Controller('merchants/:orgId')
@Audiences('merchant')
export class MerchantWatchController {
  constructor(
    private readonly watch: MerchantWatchService,
    private readonly files: FilesService,
    private readonly core: WatchCoreService,
  ) {}

  @Get('watch-options')
  @RequirePermissions('merchant.watch.read')
  @ApiOkResponse({ type: WatchOptionsResponse })
  options(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.watch.options(actor, orgId);
  }

  @Get('watch')
  @RequirePermissions('merchant.watch.read')
  @ApiOkResponse({ type: WatchRowListResponse })
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: WatchListQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.watch.list(actor, orgId, q);
  }

  @Get('watch/summary')
  @RequirePermissions('merchant.watch.read')
  @ApiOkResponse({ type: WatchSummaryResponse })
  summary(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.watch.summary(actor, orgId);
  }

  @Post('watch')
  @Idempotent()
  @RequirePermissions('merchant.watch.manage')
  @ApiOkResponse({ type: WatchResponse })
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: WatchCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.watch.create(actor, orgId, body.content, meta);
  }

  @Get('watch/:id')
  @RequirePermissions('merchant.watch.read')
  @ApiOkResponse({ type: WatchResponse })
  get(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.watch.get(actor, orgId, id);
  }

  @Put('watch/:id')
  @RequirePermissions('merchant.watch.manage')
  @ApiOkResponse({ type: WatchSaveResponse })
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchSaveDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.watch.update(actor, orgId, id, body.content, body.expectedVersion, meta);
  }

  @Post('watch/:id/fund')
  @HttpCode(200)
  @RequirePermissions('merchant.watch.read')
  @ApiOkResponse({ type: WatchResponse })
  fund(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchFundDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    // funding is a campaign decision or a finance act: Campaign Manager, Owner/Admin and Finance may fund; nobody else
    if (
      !actor.permissions.has('merchant.watch.manage') &&
      !actor.permissions.has('merchant.finance.manage')
    )
      throw AppError.forbidden();
    return this.watch.fund(actor, orgId, id, body.amountHalalas, key, meta);
  }

  @Post('watch/:id/submit')
  @HttpCode(200)
  @RequirePermissions('merchant.watch.manage')
  @ApiOkResponse({ type: WatchSubmitResponse })
  submit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.watch.submit(actor, orgId, id, meta);
  }

  @Post('watch/:id/pause')
  @HttpCode(200)
  @RequirePermissions('merchant.watch.manage')
  @ApiOkResponse({ type: WatchResponse })
  pause(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchPauseDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.watch.pause(actor, orgId, id, body.reason, meta);
  }

  @Post('watch/:id/resume')
  @HttpCode(200)
  @RequirePermissions('merchant.watch.manage')
  @ApiOkResponse({ type: WatchResponse })
  resume(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.watch.resume(actor, orgId, id, meta);
  }

  @Post('watch/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('merchant.watch.manage')
  @ApiOkResponse({ type: WatchResponse })
  cancel(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchCancelDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.watch.cancel(actor, orgId, id, body.reason, meta);
  }

  @Get('watch/:id/history')
  @RequirePermissions('merchant.watch.read')
  @ApiOkResponse({ type: WatchHistoryResponse })
  history(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.watch.history(actor, orgId, id);
  }

  @Get('watch/:id/preview')
  @RequirePermissions('merchant.watch.read')
  @ApiOkResponse({ type: WatchPreviewResponse })
  preview(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.watch.preview(actor, orgId, id);
  }

  @Get('watch/:id/monitor')
  @RequirePermissions('merchant.watch.read')
  @ApiOkResponse({ type: WatchMonitorResponse })
  monitor(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.watch.monitor(actor, orgId, id);
  }

  @Get('watch/:id/budget')
  @RequirePermissions('merchant.watch.read')
  @ApiOkResponse({ type: WatchBudgetResponse })
  budget(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.watch.budget(actor, orgId, id);
  }

  // ---- campaign video and cover image (development storage adapter; the same three-step upload as every file)
  @Post('watch-media/intent')
  @HttpCode(200)
  @RequirePermissions('merchant.watch.manage')
  @ApiOkResponse({ type: WatchMediaIntentResponse })
  mediaIntent(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: WatchMediaIntentDto,
    @CurrentActor() actor: Actor,
  ) {
    this.core.requireMerchantScope(actor, orgId);
    return this.files.createIntent(actor, orgId, body);
  }

  @Post('watch-media/:fileId/complete')
  @HttpCode(200)
  @RequirePermissions('merchant.watch.manage')
  mediaComplete(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, orgId);
    return this.files.complete(actor, orgId, fileId, meta);
  }
}
