import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  adjustmentCreateSchema,
  approvalRuleSchema,
  authorizationSchema,
  blockerSchema,
  commercialAcceptSchema,
  commercialAdminCaseListQuerySchema,
  commercialApprovalDecisionSchema,
  commercialCaseViewSchema,
  commercialDocumentViewSchema,
  commercialFinanceOverviewSchema,
  commercialPaymentViewSchema,
  commercialPaySchema,
  commercialPreviewResultSchema,
  commercialPreviewSchema,
  caseRowSchema,
  creditFacilityRequestSchema,
  creditViewSchema,
  decisionSchema,
  documentCreateSchema,
  envelope,
  holdSchema,
  onBehalfAcceptSchema,
  pricingAgreementCreateSchema,
  pricingVersionCreateSchema,
  reconciliationViewSchema,
  recordPaymentSchema,
} from '@dealdash/validation';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  RequirePermissions,
} from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { TenantService } from '../identity/tenant.service';
import { AccessScopeService } from '../platform/access-scope.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { assertDirectAdjustmentAllowed } from '../ops/ops-util';
import type { PermissionCode } from '@dealdash/types';
import { CommercialService } from './commercial.service';
import { FinanceAdminService } from './finance-admin.service';

class PreviewDto extends createZodDto(commercialPreviewSchema) {}
class PreviewResponse extends createZodDto(envelope(commercialPreviewResultSchema)) {}
class CaseResponse extends createZodDto(envelope(commercialCaseViewSchema.nullable())) {}
class AcceptDto extends createZodDto(commercialAcceptSchema) {}
class DecisionDto extends createZodDto(commercialApprovalDecisionSchema) {}
class PayDto extends createZodDto(commercialPaySchema) {}
class PaidResponse extends createZodDto(envelope(z.object({ paidHalalas: z.number().int() }))) {}
class OkResponse extends createZodDto(envelope(z.object({ ok: z.literal(true) }))) {}
class IdResponse extends createZodDto(envelope(z.object({ id: z.string() }))) {}
class BlockersResponse extends createZodDto(envelope(z.array(blockerSchema))) {}
class CaseListQueryDto extends createZodDto(commercialAdminCaseListQuerySchema) {}
class CaseListResponse extends createZodDto(envelope(z.array(caseRowSchema))) {}
class OverviewResponse extends createZodDto(envelope(commercialFinanceOverviewSchema)) {}
class ReconResponse extends createZodDto(envelope(reconciliationViewSchema)) {}
class AgreementCreateDto extends createZodDto(pricingAgreementCreateSchema) {}
class AgreementVersionDto extends createZodDto(pricingVersionCreateSchema) {}
class AnyListResponse extends createZodDto(envelope(z.array(z.record(z.string(), z.unknown())))) {}
class RuleDto extends createZodDto(approvalRuleSchema) {}
class AuthDto extends createZodDto(authorizationSchema) {}
class CreditRequestDto extends createZodDto(creditFacilityRequestSchema) {}
class CreditListResponse extends createZodDto(envelope(z.array(creditViewSchema))) {}
class ReasonDto extends createZodDto(decisionSchema) {}
class HoldDto extends createZodDto(holdSchema) {}
class PaymentDto extends createZodDto(recordPaymentSchema) {}
class PaymentListResponse extends createZodDto(envelope(z.array(commercialPaymentViewSchema))) {}
class DocumentDto extends createZodDto(documentCreateSchema) {}
class DocumentListResponse extends createZodDto(envelope(z.array(commercialDocumentViewSchema))) {}
class AdjustDto extends createZodDto(adjustmentCreateSchema) {}
class OnBehalfDto extends createZodDto(onBehalfAcceptSchema) {}
class CloseDto extends createZodDto(
  z.object({ transferTargetCaseId: z.string().uuid().optional() }),
) {}
class SubjectQueryDto extends createZodDto(
  z.object({
    product: z.enum(['VOUCHER', 'WATCH', 'EXCLUSIVE', 'LIVE_BENEFIT']),
    subjectId: z.string().uuid(),
  }),
) {}

/**
 * Business-side commercial governance, shared by every product: preview the economics, accept (explicit acknowledgements, stored
 * permanently), approve (configurable maker-checker), pay. The organisation in the URL must be the caller's own, a branch-scoped
 * membership is refused, and a SPONSOR sees only its own obligation. Enforced here, never by the UI.
 */
@ApiTags('merchant-commercial')
@Controller('merchants/:orgId/commercial')
@Audiences('merchant')
export class MerchantCommercialController {
  constructor(
    private readonly commercial: CommercialService,
    private readonly tenant: TenantService,
    private readonly access: AccessScopeService,
  ) {}

  /** Own business only; branch staff never; a scoped member needs an organization-wide grant of the permission (finance is not branch-level data). */
  private async scope(
    actor: Actor,
    orgId: string,
    permission: PermissionCode = 'merchant.commercial.read',
  ) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
    await this.access.org(actor, permission);
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermissions('merchant.commercial.read')
  @ApiOkResponse({ type: PreviewResponse })
  async preview(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: PreviewDto,
    @CurrentActor() actor: Actor,
  ) {
    await this.scope(actor, orgId);
    const { hash, economics, pricingRaw, ...view } = await this.commercial.preview(
      b.product,
      orgId,
      b.content,
      null,
    );
    void hash;
    void economics;
    void pricingRaw;
    return view;
  }

  /** The commercial case of one campaign (created / refreshed from the saved content). */
  @Get('case')
  @RequirePermissions('merchant.commercial.read')
  @ApiOkResponse({ type: CaseResponse })
  async forSubject(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: SubjectQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    await this.scope(actor, orgId);
    // owner, fulfilment merchant or a named sponsor may open it; others get 404
    if ((await this.commercial.subjectOrganization(q.product, q.subjectId)) === orgId) {
      const { caseId } = await this.commercial.syncQuotation(q.product, q.subjectId, actor);
      return this.commercial.view(caseId, actor, orgId);
    }
    const id = await this.commercial.caseIdOf(q.product, q.subjectId);
    if (!id) throw AppError.notFound();
    return this.commercial.view(id, actor, orgId);
  }

  @Get('cases')
  @RequirePermissions('merchant.commercial.read')
  @ApiOkResponse({ type: CaseListResponse })
  async list(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.scope(actor, orgId);
    return this.commercial.listForOrganization(orgId);
  }

  @Get('cases/:caseId')
  @RequirePermissions('merchant.commercial.read')
  @ApiOkResponse({ type: CaseResponse })
  async get(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.scope(actor, orgId);
    return this.commercial.view(caseId, actor, orgId);
  }

  @Post('cases/:caseId/accept')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('merchant.commercial.accept')
  @ApiOkResponse({ type: OkResponse })
  async accept(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() b: AcceptDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.scope(actor, orgId, 'merchant.commercial.accept');
    await this.commercial.accept(actor, caseId, b.quotationId, b.checks, b.language, meta);
    return { ok: true as const };
  }

  @Post('cases/:caseId/approvals/:step')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('merchant.commercial.read')
  @ApiOkResponse({ type: OkResponse })
  async decide(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('step') step: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.scope(actor, orgId);
    if (step !== 'INTERNAL_APPROVER' && step !== 'FINANCE_APPROVER') throw AppError.notFound();
    await this.commercial.decideApproval(
      actor,
      caseId,
      b.quotationId,
      step,
      b.decision,
      b.reason,
      meta,
    );
    return { ok: true as const };
  }

  @Post('cases/:caseId/pay')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('merchant.commercial.read')
  @ApiOkResponse({ type: PaidResponse })
  async pay(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() b: PayDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.scope(actor, orgId);
    return this.commercial.pay(actor, caseId, b.amountHalalas, meta);
  }

  @Get('cases/:caseId/blockers')
  @RequirePermissions('merchant.commercial.read')
  @ApiOkResponse({ type: BlockersResponse })
  async blockers(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.scope(actor, orgId);
    return (await this.commercial.view(caseId, actor, orgId)).blockers;
  }
}

/** DealDash Finance (Admin). Reading and managing are separate permissions; credit approval is its own permission. */
@ApiTags('admin-commercial')
@Controller('admin/commercial')
@Audiences('admin')
export class AdminFinanceController {
  constructor(
    private readonly commercial: CommercialService,
    private readonly finance: FinanceAdminService,
    private readonly config: SystemConfigService,
  ) {}

  @Get('overview')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: OverviewResponse })
  overview(@Query('currency') currency?: string) {
    return this.finance.overview(currency?.toUpperCase());
  }

  @Get('cases')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: CaseListResponse })
  cases(@Query() q: CaseListQueryDto) {
    return this.finance.listCases(q);
  }

  @Get('cases/:id')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: CaseResponse })
  async caseDetail(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.commercial.view(id, actor, null);
  }

  @Get('cases/:id/reconciliation')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: ReconResponse })
  reconciliation(@Param('id', ParseUUIDPipe) id: string) {
    return this.finance.reconcile(id);
  }

  @Post('cases/:id/close')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  @ApiOkResponse({ type: ReconResponse })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: CloseDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.finance.closeCase(actor, id, b.transferTargetCaseId ?? null, meta);
  }

  @Post('cases/:id/apply-agreement')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  @ApiOkResponse({ type: OkResponse })
  async applyAgreement(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.finance.applyAgreementTreatment(actor, id, meta);
    return { ok: true as const };
  }

  @Post('cases/:id/accept-on-behalf')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  @ApiOkResponse({ type: OkResponse })
  async acceptOnBehalf(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: OnBehalfDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.commercial.accept(actor, id, b.quotationId, b.checks, b.language, meta, {
      organizationId: b.organizationId,
      authorizationId: b.authorizationId,
      role: b.role,
    });
    return { ok: true as const };
  }

  // ---- pricing agreements and approval rules
  @Get('pricing')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: AnyListResponse })
  pricing() {
    return this.finance.listAgreements();
  }

  @Post('pricing')
  @Idempotent()
  @RequirePermissions('admin.finance.pricing.manage')
  @ApiOkResponse({ type: IdResponse })
  createPricing(
    @Body() b: AgreementCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.finance.createAgreement(actor, b as never, meta);
  }

  @Post('pricing/:id/versions')
  @Idempotent()
  @RequirePermissions('admin.finance.pricing.manage')
  @ApiOkResponse({ type: IdResponse })
  async version(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: AgreementVersionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const r = await this.finance.addVersion(actor, id, b as never, meta);
    return { id: String(r.version) };
  }

  @Get('approval-rules')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: AnyListResponse })
  rules() {
    return this.finance.listRules();
  }

  @Post('approval-rules')
  @Idempotent()
  @RequirePermissions('admin.finance.pricing.manage')
  @ApiOkResponse({ type: IdResponse })
  createRule(@Body() b: RuleDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.finance.createRule(actor, b as never, meta);
  }

  @Post('approval-rules/:id/:state')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.pricing.manage')
  @ApiOkResponse({ type: OkResponse })
  async toggleRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('state') state: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (state !== 'enable' && state !== 'disable') throw AppError.notFound();
    await this.finance.setRuleActive(actor, id, state === 'enable', meta);
    return { ok: true as const };
  }

  // ---- authorisations to act on behalf
  @Get('authorizations')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: AnyListResponse })
  authorizations(@Query('organizationId') organizationId?: string) {
    return this.finance.listAuthorizations(organizationId);
  }

  @Post('authorizations')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  @ApiOkResponse({ type: IdResponse })
  createAuth(@Body() b: AuthDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.finance.createAuthorization(actor, b, meta);
  }

  @Post('authorizations/:id/revoke')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  @ApiOkResponse({ type: OkResponse })
  async revokeAuth(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.finance.revokeAuthorization(actor, id, meta);
    return { ok: true as const };
  }

  // ---- credit
  @Get('credit')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: CreditListResponse })
  credit() {
    return this.finance.listCredit();
  }

  @Post('credit')
  @Idempotent()
  @RequirePermissions('admin.finance.credit.manage')
  @ApiOkResponse({ type: IdResponse })
  requestCredit(
    @Body() b: CreditRequestDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.finance.requestCredit(actor, b, meta);
  }

  @Post('credit/:id/:decision')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.credit.approve')
  @ApiOkResponse({ type: OkResponse })
  async decideCredit(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decision') decision: string,
    @Body() b: ReasonDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (decision === 'approve')
      await this.finance.decideCredit(actor, id, 'ACTIVE', b.reason, meta);
    else if (decision === 'reject')
      await this.finance.decideCredit(actor, id, 'REJECTED', b.reason, meta);
    else if (decision === 'suspend')
      await this.finance.setCreditStatus(actor, id, 'SUSPENDED', b.reason, meta);
    else if (decision === 'reinstate')
      await this.finance.setCreditStatus(actor, id, 'ACTIVE', b.reason, meta);
    else throw AppError.notFound();
    return { ok: true as const };
  }

  // ---- holds
  @Get('holds')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: AnyListResponse })
  holds() {
    return this.finance.listHolds();
  }

  @Post('holds')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  @ApiOkResponse({ type: IdResponse })
  hold(@Body() b: HoldDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.finance.placeHold(actor, b, meta);
  }

  @Post('holds/:id/release')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.finance.manage')
  @ApiOkResponse({ type: OkResponse })
  async release(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ReasonDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.finance.releaseHold(actor, id, b.reason, meta);
    return { ok: true as const };
  }

  // ---- payments, documents, adjustments
  @Get('payments')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: PaymentListResponse })
  payments(@Query('organizationId') organizationId?: string) {
    return this.finance.listPayments(organizationId);
  }

  @Post('payments')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  @ApiOkResponse({ type: z.object({}).passthrough() as never })
  recordPayment(@Body() b: PaymentDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.finance.recordPayment(actor, b, meta);
  }

  @Get('documents')
  @RequirePermissions('admin.finance.read')
  @ApiOkResponse({ type: DocumentListResponse })
  documents(@Query('organizationId') organizationId?: string, @Query('caseId') caseId?: string) {
    return this.finance.listDocuments(organizationId, caseId);
  }

  @Post('documents')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  @ApiOkResponse({ type: IdResponse })
  async createDocument(
    @Body() b: DocumentDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const r = await this.finance.createDocument(actor, b, meta);
    return { id: r.id };
  }

  @Post('adjustments')
  @Idempotent()
  @RequirePermissions('admin.finance.manage')
  @ApiOkResponse({ type: IdResponse })
  async adjust(@Body() b: AdjustDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    await assertDirectAdjustmentAllowed(this.config, b.amountHalalas);
    return this.finance.adjust(actor, b, meta);
  }
}
