import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Audiences, CurrentActor, Meta, RequirePermissions } from '../common/decorators';
import type { Actor, RequestMeta } from '../common/request-context';
import { CategoriesService } from './categories.service';
import { DealReviewService } from './deal-review.service';
import {
  AdminDealAnalyticsResponse,
  AdminDealAuditResponse,
  AdminDealDetailResponse,
  AdminDealListQueryDto,
  AdminDealListResponse,
  AuditPageDto,
  CategoryCreateDto,
  CategoryListResponse,
  CategoryResponse,
  CategoryUpdateDto,
  DealDecisionDto,
} from './dto';

/**
 * DealDash campaign review for Live Deals (same workbench pattern as merchant review). Cross-tenant by design, so it is
 * gated by admin permissions only: review decisions need `admin.campaigns.review`, pause/suspend/reinstate need
 * `admin.campaigns.control`, analytics need `admin.reports.read`. Support users hold none of these.
 */
@ApiTags('admin-live-deals')
@Controller('admin/live-deals')
@Audiences('admin')
export class AdminLiveDealsController {
  constructor(private readonly review: DealReviewService) {}

  @Get()
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminDealListResponse })
  list(@Query() q: AdminDealListQueryDto) {
    return this.review.list(q);
  }

  @Get('analytics')
  @RequirePermissions('admin.reports.read')
  @ApiOkResponse({ type: AdminDealAnalyticsResponse })
  analytics() {
    return this.review.analytics();
  }

  @Get(':id')
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminDealDetailResponse })
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.review.detail(actor, id);
  }

  @Get(':id/audit')
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminDealAuditResponse })
  audit(@Param('id', ParseUUIDPipe) id: string, @Query() q: AuditPageDto) {
    return this.review.auditTrail(id, q);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminDealDetailResponse })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DealDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.approve(actor, id, body, meta);
  }

  @Post(':id/request-changes')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminDealDetailResponse })
  requestChanges(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DealDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.requestChanges(actor, id, body, meta);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.review')
  @ApiOkResponse({ type: AdminDealDetailResponse })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DealDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reject(actor, id, body, meta);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminDealDetailResponse })
  pause(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DealDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.pause(actor, id, body, meta);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminDealDetailResponse })
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DealDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.resume(actor, id, body, meta);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminDealDetailResponse })
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DealDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.suspend(actor, id, body, meta);
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @RequirePermissions('admin.campaigns.control')
  @ApiOkResponse({ type: AdminDealDetailResponse })
  reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: DealDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reinstate(actor, id, body, meta);
  }
}

/** Configurable discovery categories (bilingual). Reading needs config.read, changing needs config.manage. */
@ApiTags('admin-categories')
@Controller('admin/categories')
@Audiences('admin')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermissions('admin.config.read')
  @ApiOkResponse({ type: CategoryListResponse })
  list() {
    return this.categories.list({ includeInactive: true });
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('admin.config.manage')
  @ApiOkResponse({ type: CategoryResponse })
  create(@Body() body: CategoryCreateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.categories.create(actor, body, meta);
  }

  @Patch(':id')
  @RequirePermissions('admin.config.manage')
  @ApiOkResponse({ type: CategoryResponse })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CategoryUpdateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.categories.update(actor, id, body, meta);
  }
}
