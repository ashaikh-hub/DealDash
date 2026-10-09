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
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { CategoriesService } from './categories.service';
import { DealCoreService } from './deal-core.service';
import {
  DealHistoryResponse,
  DealMediaIntentDto,
  DealOptionsResponse,
  DealPerformanceResponse,
  DealPreviewResponse,
  DealSaveResponse,
  DealSubmitResponse,
  DealSummaryResponse,
  LiveDealCreateDto,
  LiveDealEndDto,
  LiveDealListQueryDto,
  LiveDealPauseDto,
  LiveDealResponse,
  LiveDealRowListResponse,
  LiveDealSaveDto,
  MediaIntentResponse,
  MediaViewResponse,
  PerformanceQueryDto,
} from './dto';
import { EligibilityService } from './eligibility.service';
import { MerchantDealsService } from './merchant-deals.service';

/**
 * Merchant Live Deals. The organisation in the URL must be the caller's own (another organisation returns 404),
 * the caller must hold the deals permission, and branch-scoped memberships (staff) are refused. All enforced here,
 * never by the UI.
 */
@ScopeAware()
@ApiTags('merchant-live-deals')
@Controller('merchants/:orgId')
@Audiences('merchant')
export class MerchantLiveDealsController {
  constructor(
    private readonly deals: MerchantDealsService,
    private readonly core: DealCoreService,
    private readonly categories: CategoriesService,
    private readonly eligibility: EligibilityService,
    private readonly files: FilesService,
  ) {}

  @Get('deal-options')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: DealOptionsResponse })
  async options(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.core.requireMerchantScope(actor, orgId);
    return {
      categories: await this.categories.list(),
      eligibility: {
        ...(await this.eligibility.options()),
        cities: await this.core.enabledCities(),
      },
    };
  }

  @Get('live-deals')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: LiveDealRowListResponse })
  list(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: LiveDealListQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.list(actor, orgId, q);
  }

  @Get('live-deals/summary')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: DealSummaryResponse })
  summary(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.deals.summary(actor, orgId);
  }

  @Post('live-deals')
  @Idempotent()
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: LiveDealResponse })
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: LiveDealCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.create(actor, orgId, body.content, meta);
  }

  @Get('live-deals/:id')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: LiveDealResponse })
  get(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.get(actor, orgId, id);
  }

  @Put('live-deals/:id')
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: DealSaveResponse })
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LiveDealSaveDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.update(actor, orgId, id, body.content, body.expectedVersion, meta);
  }

  @Post('live-deals/:id/submit')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: DealSubmitResponse })
  submit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.submit(actor, orgId, id, meta);
  }

  @Post('live-deals/:id/pause')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: LiveDealResponse })
  pause(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LiveDealPauseDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.pause(actor, orgId, id, body.reason, meta);
  }

  @Post('live-deals/:id/resume')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: LiveDealResponse })
  resume(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.resume(actor, orgId, id, meta);
  }

  @Post('live-deals/:id/end')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: LiveDealResponse })
  end(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: LiveDealEndDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.end(actor, orgId, id, body.reason, meta);
  }

  @Post('live-deals/:id/discard-revision')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: LiveDealResponse })
  discard(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.deals.discardRevision(actor, orgId, id, meta);
  }

  @Get('live-deals/:id/preview')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: DealPreviewResponse })
  preview(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.preview(actor, orgId, id);
  }

  @Get('live-deals/:id/history')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: DealHistoryResponse })
  history(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.history(actor, orgId, id);
  }

  @Get('live-deals/:id/performance')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: DealPerformanceResponse })
  performance(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PerformanceQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.deals.performance(actor, orgId, id, q);
  }

  // ---- deal images (development storage adapter; same three-step flow as every upload)
  @Post('deal-media/intent')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  @ApiOkResponse({ type: MediaIntentResponse })
  mediaIntent(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: DealMediaIntentDto,
    @CurrentActor() actor: Actor,
  ) {
    this.core.requireMerchantScope(actor, orgId);
    return this.files.createIntent(actor, orgId, { ...body, kind: 'DEAL_IMAGE' });
  }

  @Post('deal-media/:fileId/complete')
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  async mediaComplete(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.core.requireMerchantScope(actor, orgId);
    return this.files.complete(actor, orgId, fileId, meta);
  }

  @Get('deal-media/:fileId/url')
  @RequirePermissions('merchant.deals.read')
  @ApiOkResponse({ type: MediaViewResponse })
  async mediaUrl(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @CurrentActor() actor: Actor,
  ) {
    this.core.requireMerchantScope(actor, orgId);
    return this.files.readUrl(fileId, orgId);
  }
}

export { AppError };
