import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Audiences, CurrentActor, Meta, RequirePermissions } from '../common/decorators';
import type { Actor, RequestMeta } from '../common/request-context';
import { AdminReviewService } from './admin-review.service';
import {
  AdminAuditListResponse,
  AdminMerchantDetailResponse,
  ApplicationQueueQueryDto,
  ApproveDto,
  AuditPageQueryDto,
  BankVerifyDto,
  DocumentReviewDto,
  MerchantListQueryDto,
  MerchantRowListResponse,
  ReactivateDto,
  RejectDto,
  RequestChangesDto,
  ReviewNoteDto,
  RiskTierDto,
  SuspendDto,
  TrustLevelDto,
} from './dto';

/**
 * Admin merchant review workbench. Cross-tenant by design, therefore gated by admin permissions only
 * (review = decisions; manage = suspension, trust level and bank verification).
 */
@ApiTags('admin-merchants')
@Controller('admin/merchants')
@Audiences('admin')
export class AdminMerchantsController {
  constructor(private readonly review: AdminReviewService) {}

  @Get()
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: MerchantRowListResponse })
  list(@Query() q: MerchantListQueryDto) {
    return this.review.listMerchants(q);
  }

  @Get('queue')
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: MerchantRowListResponse })
  queue(@Query() q: ApplicationQueueQueryDto, @CurrentActor() actor: Actor) {
    return this.review.queue(actor, q);
  }

  @Get(':orgId')
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  detail(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.review.detail(orgId);
  }

  @Get(':orgId/audit')
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: AdminAuditListResponse })
  audit(@Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: AuditPageQueryDto) {
    return this.review.auditTrail(orgId, q);
  }

  @Post(':orgId/claim')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  claim(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.claim(actor, orgId, meta);
  }

  @Post(':orgId/release')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  release(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.release(actor, orgId, meta);
  }
  @Post(':orgId/documents/:documentId/review')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  reviewDocument(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() body: DocumentReviewDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reviewDocument(actor, orgId, documentId, body, meta);
  }

  @Post(':orgId/request-changes')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  requestChanges(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: RequestChangesDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.requestChanges(actor, orgId, body, meta);
  }

  @Post(':orgId/approve')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  approve(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: ApproveDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.approve(actor, orgId, body, meta);
  }

  @Post(':orgId/reject')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  reject(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: RejectDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reject(actor, orgId, body, meta);
  }

  @Post(':orgId/notes')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  note(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: ReviewNoteDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.addNote(actor, orgId, body.body, meta);
  }

  @Post(':orgId/risk-tier')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.review')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  riskTier(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: RiskTierDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.setRiskTier(actor, orgId, body, meta);
  }

  @Post(':orgId/trust-level')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.manage')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  trust(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: TrustLevelDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.setTrustLevel(actor, orgId, body, meta);
  }

  @Post(':orgId/suspend')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.manage')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  suspend(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: SuspendDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.suspend(actor, orgId, body, meta);
  }

  @Post(':orgId/reactivate')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.manage')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  reactivate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: ReactivateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.reactivate(actor, orgId, body, meta);
  }

  @Post(':orgId/bank/verify')
  @HttpCode(200)
  @RequirePermissions('admin.merchants.manage')
  @ApiOkResponse({ type: AdminMerchantDetailResponse })
  verifyBank(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: BankVerifyDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.review.verifyBank(actor, orgId, body.note, meta);
  }
}
