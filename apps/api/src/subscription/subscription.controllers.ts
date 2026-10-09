import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { PermissionCode } from '@dealdash/types';
import {
  acceptSchema,
  addOnDefinitionSchema,
  amendmentProposeSchema,
  assignPlanSchema,
  contractRateSchema,
  lifecycleActionSchema,
  planCreateSchema,
  planVersionDraftSchema,
  priceItemCreateSchema,
  priceItemVersionSchema,
  promotionSchema,
  renewalStateSchema,
  usageRecordSchema,
} from '@dealdash/validation';
import { Audiences, CurrentActor, Idempotent, Meta, RequirePermissions } from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { EntitlementService } from '../platform/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { CommercialAccessService } from './access.service';
import { AmendmentService } from './amendment.service';
import { BillingEventService } from './billing-event.service';
import { PlanService } from './plan.service';
import { PricingResolver } from './pricing.resolver';
import { SignalService } from './signal.service';
import { SubscriptionService } from './subscription.service';
import { UsageService } from './usage.service';

class PlanCreateDto extends createZodDto(planCreateSchema) {}
class PlanUpdateDto extends createZodDto(
  z.object({
    nameEn: z.string().trim().min(2).max(80).optional(),
    nameAr: z.string().trim().min(2).max(80).optional(),
    descriptionEn: z.string().trim().max(400).optional(),
    descriptionAr: z.string().trim().max(400).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    negotiated: z.boolean().optional(),
    isFree: z.boolean().optional(),
    status: z.enum(['ACTIVE', 'RETIRED']).optional(),
  }),
) {}
class DraftDto extends createZodDto(planVersionDraftSchema) {}
class ApprovalDto extends createZodDto(z.object({ approvalRef: z.string().trim().max(80).optional(), reason: z.string().trim().min(3).max(300).optional() })) {}
class ItemDto extends createZodDto(priceItemCreateSchema) {}
class ItemVersionDto extends createZodDto(priceItemVersionSchema) {}
class AddOnDto extends createZodDto(addOnDefinitionSchema) {}
class AssignDto extends createZodDto(assignPlanSchema.extend({ onBehalfAuthorizationId: z.string().uuid().optional() })) {}
class LifecycleDto extends createZodDto(lifecycleActionSchema) {}
class RenewalDto extends createZodDto(renewalStateSchema) {}
class ProposeDto extends createZodDto(amendmentProposeSchema) {}
class AcceptDto extends createZodDto(acceptSchema.extend({ onBehalfAuthorizationId: z.string().uuid().optional(), approvalRef: z.string().trim().max(80).optional() })) {}
class PromotionDto extends createZodDto(promotionSchema) {}
class RateDto extends createZodDto(contractRateSchema) {}
class UsageDto extends createZodDto(usageRecordSchema) {}
class RejectDto extends createZodDto(z.object({ reason: z.string().trim().min(3).max(300) })) {}
class ExplainDto extends createZodDto(
  z.object({
    action: z.string().trim().max(40).optional(),
    product: z.string().trim().max(40).optional(),
    feature: z.string().trim().max(60).optional(),
    limitKey: z.string().trim().max(60).optional(),
    legalEntityId: z.string().uuid().optional(),
  }),
) {}

/**
 * DealDash Admin: the commercial catalog and every agreement. No deployment is needed for a normal commercial change: plans, versions,
 * country prices, add-ons, price book, agreements, overrides, promotions, rates, lifecycle and amendments are all data. Published
 * versions are immutable; publishing, cancelling, rates and promotions need the approve permission (a different person than the author).
 */
@ApiTags('admin-subscriptions')
@Controller('admin/subscriptions')
@Audiences('admin')
export class AdminSubscriptionController {
  constructor(
    private readonly plans: PlanService,
    private readonly subs: SubscriptionService,
    private readonly amendments: AmendmentService,
    private readonly billing: BillingEventService,
    private readonly signals: SignalService,
    private readonly usage: UsageService,
    private readonly pricing: PricingResolver,
    private readonly entitlements: EntitlementService,
    private readonly access: CommercialAccessService,
    private readonly prisma: PrismaService,
  ) {}

  // ------------------------------------------------------------ catalog
  @Get('plans')
  @RequirePermissions('admin.subscriptions.read')
  listPlans(@Query('entityType') entityType?: string, @Query('market') market?: string, @Query('includeRetired') includeRetired?: string) {
    return this.plans.listPlans({ entityType, market, includeRetired: includeRetired === 'true' });
  }

  @Get('plans/:code')
  @RequirePermissions('admin.subscriptions.read')
  getPlan(@Param('code') code: string) {
    return this.plans.getPlan(code);
  }

  @Get('plan-versions/:id')
  @RequirePermissions('admin.subscriptions.read')
  async getVersion(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.versionView(await this.plans.getVersion(id));
  }

  @Post('plans')
  @Idempotent()
  @RequirePermissions('admin.subscriptions.manage')
  createPlan(@Body() b: PlanCreateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.plans.createPlan(actor, b, meta);
  }

  @Patch('plans/:code')
  @RequirePermissions('admin.subscriptions.manage')
  updatePlan(@Param('code') code: string, @Body() b: PlanUpdateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.plans.updatePlan(actor, code, b, meta);
  }

  @Post('plans/:code/versions')
  @Idempotent()
  @RequirePermissions('admin.subscriptions.manage')
  createDraft(@Param('code') code: string, @Body() b: DraftDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.plans.createDraft(actor, code, b, meta);
  }

  @Put('plan-versions/:id')
  @RequirePermissions('admin.subscriptions.manage')
  updateDraft(@Param('id', ParseUUIDPipe) id: string, @Body() b: DraftDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.plans.updateDraft(actor, id, b, meta);
  }

  @Post('plan-versions/:id/publish')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.approve')
  publish(@Param('id', ParseUUIDPipe) id: string, @Body() b: ApprovalDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.plans.publish(actor, id, meta, b.approvalRef);
  }

  @Post('plan-versions/:id/retire')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.approve')
  retire(@Param('id', ParseUUIDPipe) id: string, @Body() b: ApprovalDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.plans.retire(actor, id, b.reason ?? 'Retired', meta);
  }

  @Get('price-items')
  @RequirePermissions('admin.subscriptions.read')
  listItems(@Query('market') market?: string) {
    return this.plans.listItems(market);
  }

  @Post('price-items')
  @Idempotent()
  @RequirePermissions('admin.subscriptions.manage')
  createItem(@Body() b: ItemDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.plans.createItem(actor, b, meta);
  }

  @Post('price-items/:code/versions')
  @Idempotent()
  @RequirePermissions('admin.subscriptions.manage')
  createItemVersion(@Param('code') code: string, @Body() b: ItemVersionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.plans.createItemVersion(actor, code, b, meta);
  }

  @Post('price-item-versions/:id/publish')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.approve')
  publishItem(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.plans.publishItemVersion(actor, id, meta);
  }

  @Get('add-ons')
  @RequirePermissions('admin.subscriptions.read')
  listAddOns() {
    return this.plans.listAddOns();
  }

  @Post('add-ons')
  @Idempotent()
  @RequirePermissions('admin.subscriptions.manage')
  createAddOn(@Body() b: AddOnDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.plans.createAddOn(actor, b, meta);
  }

  // ------------------------------------------------------------ agreements
  @Get('contracts')
  @RequirePermissions('admin.subscriptions.read')
  listContracts(@Query('organizationId') organizationId?: string, @Query('kind') kind?: string, @Query('status') status?: string) {
    return this.subs.list({ organizationId, kind, status });
  }

  @Get('contracts/:id')
  @RequirePermissions('admin.subscriptions.read')
  getContract(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.contractView(id);
  }

  @Get('contracts/:id/terms')
  @RequirePermissions('admin.subscriptions.read')
  terms(@Param('id', ParseUUIDPipe) id: string) {
    return this.subs.terms(id);
  }

  @Get('contracts/:id/price')
  @RequirePermissions('admin.subscriptions.read')
  price(@Param('id', ParseUUIDPipe) id: string) {
    return this.pricing.subscription(id);
  }

  @Get('contracts/:id/acceptances')
  @RequirePermissions('admin.subscriptions.read')
  async acceptances(@Param('id', ParseUUIDPipe) id: string) {
    const rows = await this.prisma.contractAcceptance.findMany({ where: { contractId: id }, orderBy: { createdAt: 'desc' } });
    return rows.map((a) => ({ id: a.id, reference: a.reference, amendmentId: a.amendmentId, userRole: a.userRole, userName: a.userName, onBehalf: !!a.onBehalfAuthorizationId, planVersionId: a.planVersionId, pricingVersionKey: a.pricingVersionKey, termsVersion: a.termsVersion, currency: a.currency, acceptedAmountMinor: a.acceptedAmountMinor, maxExposureMinor: a.maxExposureMinor, effectiveFrom: a.effectiveFrom.toISOString(), billingCadence: a.billingCadence, approvalRef: a.approvalRef, createdAt: a.createdAt.toISOString(), terms: a.terms }));
  }

  @Post('contracts/assign')
  @Idempotent()
  @RequirePermissions('admin.subscriptions.manage')
  assign(@Body() b: AssignDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.subs.assign(actor, b, meta);
  }

  @Post('contracts/:id/accept-on-behalf')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.manage')
  acceptOnBehalf(@Param('id', ParseUUIDPipe) id: string, @Body() b: AcceptDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.subs.acceptContract(actor, id, b.language, meta, { onBehalfAuthorizationId: b.onBehalfAuthorizationId, approvalRef: b.approvalRef });
  }

  @Post('contracts/:id/past-due')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.manage')
  pastDue(@Param('id', ParseUUIDPipe) id: string, @Body() b: LifecycleDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.subs.markPastDue(actor, id, b.reason, meta);
  }

  @Post('contracts/:id/suspend')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.manage')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() b: LifecycleDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.subs.suspend(actor, id, b.reason, meta);
  }

  @Post('contracts/:id/reinstate')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.manage')
  reinstate(@Param('id', ParseUUIDPipe) id: string, @Body() b: LifecycleDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.subs.reinstate(actor, id, b.reason, meta);
  }

  @Post('contracts/:id/cancel')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.approve')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() b: LifecycleDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.subs.cancel(actor, id, b.reason, meta, b.effectiveAt ? new Date(b.effectiveAt) : new Date());
  }

  @Post('contracts/:id/renewal-state')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.manage')
  renewalState(@Param('id', ParseUUIDPipe) id: string, @Body() b: RenewalDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.subs.setRenewalState(actor, id, b.renewalState, b.reason, meta);
  }

  @Post('contracts/:id/renew')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.manage')
  renew(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.subs.renew(actor, id, meta);
  }

  @Post('contracts/:id/promotions')
  @Idempotent()
  @RequirePermissions('admin.subscriptions.approve')
  promotion(@Param('id', ParseUUIDPipe) id: string, @Body() b: PromotionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.amendments.addPromotion(actor, id, b, meta);
  }

  @Post('contracts/:id/rates')
  @Idempotent()
  @RequirePermissions('admin.subscriptions.approve')
  rate(@Param('id', ParseUUIDPipe) id: string, @Body() b: RateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.amendments.addRate(actor, id, b, meta);
  }

  // ------------------------------------------------------------ amendments (upgrade, downgrade, add-on, override ...)
  @Post('contracts/:id/amendments/preview')
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.read')
  preview(@Param('id', ParseUUIDPipe) id: string, @Body() b: ProposeDto) {
    return this.amendments.preview(id, b);
  }

  @Post('contracts/:id/amendments')
  @Idempotent()
  @RequirePermissions('admin.subscriptions.manage')
  propose(@Param('id', ParseUUIDPipe) id: string, @Body() b: ProposeDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.amendments.propose(actor, id, b, meta, false);
  }

  @Get('amendments')
  @RequirePermissions('admin.subscriptions.read')
  listAmendments(@Query('contractId') contractId?: string, @Query('organizationId') organizationId?: string, @Query('status') status?: string) {
    return this.amendments.list({ contractId, organizationId, status });
  }

  @Get('amendments/:id')
  @RequirePermissions('admin.subscriptions.read')
  getAmendment(@Param('id', ParseUUIDPipe) id: string) {
    return this.amendments.view(id);
  }

  @Post('amendments/:id/accept-on-behalf')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.manage')
  acceptAmendment(@Param('id', ParseUUIDPipe) id: string, @Body() b: AcceptDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.amendments.accept(actor, id, b.language, meta, { onBehalfAuthorizationId: b.onBehalfAuthorizationId, approvalRef: b.approvalRef });
  }

  @Post('amendments/:id/apply')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.approve')
  apply(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.amendments.apply(actor, id, meta);
  }

  @Post('amendments/:id/reject')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.manage')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: RejectDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.amendments.reject(actor, id, b.reason, meta);
  }

  // ------------------------------------------------------------ the picture, the hooks, readiness
  @Get('organizations/:orgId')
  @RequirePermissions('admin.subscriptions.read')
  summary(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.subs.summaryFor(orgId);
  }

  @Get('organizations/:orgId/explain')
  @RequirePermissions('admin.subscriptions.read')
  explain(@Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: ExplainDto) {
    return this.access.evaluate({ organizationId: orgId, ...q });
  }

  @Get('organizations/:orgId/financial-status')
  @RequirePermissions('admin.subscriptions.read')
  financial(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.entitlements.financialStatus(orgId);
  }

  @Post('organizations/:orgId/usage')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.manage')
  async recordUsage(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() b: UsageDto) {
    const limitKey = Object.entries({ 'api.requests': 'api.requests', 'bulk_import.rows': 'bulk_import.rows' }).find(([k]) => k === b.metricKey)?.[0];
    if (!limitKey) throw AppError.validation('Only period metrics can be recorded here', 'metricKey');
    return this.usage.consume({ organizationId: orgId, limitKey, quantity: b.quantity, idempotencyKey: b.idempotencyKey, legalEntityId: b.legalEntityId, sourceType: 'ADMIN', sourceId: b.idempotencyKey, at: b.occurredAt ? new Date(b.occurredAt) : undefined });
  }

  @Get('billing-events')
  @RequirePermissions('admin.subscriptions.read')
  billingEvents(@Query('organizationId') organizationId?: string, @Query('eventType') eventType?: string, @Query('status') status?: string, @Query('contractId') contractId?: string) {
    return this.billing.list({ organizationId, eventType, status, contractId });
  }

  @Get('signals')
  @RequirePermissions('admin.subscriptions.read')
  listSignals(@Query('organizationId') organizationId?: string, @Query('type') type?: string, @Query('unconsumed') unconsumed?: string) {
    return this.signals.list({ organizationId, type, unconsumed: unconsumed === 'true' });
  }

  /** Launch readiness: organizations still on the default plan with no agreement of their own. */
  @Get('readiness/unassigned')
  @RequirePermissions('admin.subscriptions.read')
  unassigned() {
    return this.subs.unassigned();
  }

  /** Runs the scheduled pass now (trials, grace, renewals, due amendments). The same pass runs hourly in the background. */
  @Post('run-due')
  @HttpCode(200)
  @RequirePermissions('admin.subscriptions.manage')
  async runDue() {
    return { lifecycle: await this.subs.runDue(), amendments: await this.amendments.applyDue() };
  }
}

// =================================================================================================================================
// A business: its own plan, usage, entitlements, upgrade / downgrade and why-unavailable
// =================================================================================================================================

/** Reads and changes the business's own subscription. A scoped member needs an organization-wide grant (commercial data is not branch data). */
@ApiTags('organization-subscription')
@Controller('orgs/:orgId/subscription')
@Audiences('merchant', 'partner')
export class OrgSubscriptionController {
  constructor(
    private readonly subs: SubscriptionService,
    private readonly amendments: AmendmentService,
    private readonly plans: PlanService,
    private readonly access: CommercialAccessService,
    private readonly usage: UsageService,
    private readonly prisma: PrismaService,
  ) {}

  private need(actor: Actor, orgId: string, level: 'read' | 'manage' | 'accept') {
    const m = actor.membership;
    if (!m || m.organizationId !== orgId || (m.organizationType !== 'MERCHANT' && m.organizationType !== 'PARTNER')) throw AppError.notFound();
    const prefix = m.organizationType === 'PARTNER' ? 'partner' : 'merchant';
    const code = (level === 'accept' ? (prefix === 'merchant' ? 'merchant.commercial.accept' : 'partner.subscription.manage') : `${prefix}.subscription.${level}`) as PermissionCode;
    if (!actor.permissions.has(code) || m.scoped) throw new AppError('SCOPE_FORBIDDEN', 'You do not have permission to do this', 403);
  }

  private async contractOf(orgId: string): Promise<string> {
    const e = await this.prisma.contract.findFirst({ where: { organizationId: orgId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'PENDING_ACTIVATION'] }, effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: 'desc' }, select: { id: true } });
    if (!e) throw new AppError('INVALID_STATE', 'Your business is on the default plan: DealDash assigns your plan', 409);
    return e.id;
  }

  @Get()
  async summary(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'read');
    return this.subs.summaryFor(orgId);
  }

  @Get('usage')
  usageView(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'read');
    return this.usage.usageView(orgId);
  }

  /** The plans this business can move to (published for its market and kind of business), with the price of each. */
  @Get('plans')
  async available(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'read');
    const c = await this.prisma.contract.findFirst({ where: { organizationId: orgId, status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'] } }, orderBy: { effectiveFrom: 'desc' } });
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId }, include: { partner: true } });
    const entity = org.type === 'MERCHANT' ? 'MERCHANT' : org.partner?.partnerType === 'BANK' ? 'BANK' : org.partner?.partnerType === 'SCHEME' ? 'SCHEME' : 'CORPORATE';
    const all = await this.plans.listPlans({ entityType: entity, market: c?.market ?? undefined });
    return all.map((p) => ({ ...p, versions: p.versions.filter((v) => v.status === 'PUBLISHED' && !v.developmentFixture === !c?.developmentFixture), current: p.code === c?.planCode }));
  }

  /** Why is this unavailable / what is allowed? Answered from the real contract, entitlements, usage and financial state. */
  @Get('explain')
  async explain(@Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: ExplainDto, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'read');
    return this.access.evaluate({ organizationId: orgId, ...q });
  }

  @Post('preview')
  @HttpCode(200)
  async preview(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() b: ProposeDto, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'read');
    return this.amendments.preview(await this.contractOf(orgId), b);
  }

  @Post('amendments')
  @Idempotent()
  async propose(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() b: ProposeDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'manage');
    return this.amendments.propose(actor, await this.contractOf(orgId), b, meta, true);
  }

  @Get('amendments')
  async list(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'read');
    return this.amendments.list({ organizationId: orgId });
  }

  @Post('amendments/:id/accept')
  @Idempotent()
  @HttpCode(200)
  async accept(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: AcceptDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'accept');
    const a = await this.amendments.view(id);
    if (a.organizationId !== orgId) throw AppError.notFound();
    return this.amendments.accept(actor, id, b.language, meta);
  }

  @Post('amendments/:id/cancel')
  @Idempotent()
  @HttpCode(200)
  async cancelAmendment(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: RejectDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'manage');
    const a = await this.amendments.view(id);
    if (a.organizationId !== orgId) throw AppError.notFound();
    return this.amendments.reject(actor, id, b.reason, meta);
  }

  /** The authorised person accepts a plan DealDash assigned (the agreement then becomes active). */
  @Post('accept')
  @Idempotent()
  @HttpCode(200)
  async acceptAgreement(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() b: AcceptDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'accept');
    const pending = await this.prisma.contract.findFirst({ where: { organizationId: orgId, status: 'PENDING_ACTIVATION' }, orderBy: { createdAt: 'desc' } });
    if (!pending) throw new AppError('INVALID_STATE', 'There is no agreement waiting for your acceptance', 409);
    return this.subs.acceptContract(actor, pending.id, b.language, meta);
  }

  @Get('pending')
  async pending(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'read');
    const c = await this.prisma.contract.findFirst({ where: { organizationId: orgId, status: 'PENDING_ACTIVATION' }, orderBy: { createdAt: 'desc' } });
    return c ? { contract: await this.subs.contractView(c.id), terms: await this.subs.terms(c.id) } : null;
  }

  /** Ask not to renew: the agreement stays in force to the end of its period, then ends (nothing is deleted). */
  @Post('stop-renewal')
  @Idempotent()
  @HttpCode(200)
  async stopRenewal(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() b: RejectDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'manage');
    return this.subs.setRenewalState(actor, await this.contractOf(orgId), 'NON_RENEWING', b.reason, meta);
  }
}
