import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  PARTNER_CREATABLE_PRODUCTS,
  PARTNER_LIFECYCLE,
  PARTNER_TYPES,
  type PartnerCreatableProduct,
} from '@dealdash/types';
import {
  benefitDecisionSchema,
  benefitStatusSchema,
  cardProgramSchema,
  commercialAcceptSchema,
  commercialApprovalDecisionSchema,
  commercialPaySchema,
  connectionCreateSchema,
  importUploadSchema,
  eligibilityTestSchema,
  employerProgramSchema,
  liveDealBenefitSchema,
  loyaltyRuleCreateSchema,
  networkDuplicateDecisionSchema,
  networkMerchantCreateSchema,
  networkQuerySchema,
  partnerCampaignCreateSchema,
  partnerCampaignUpdateSchema,
  partnerCreateSchema,
  partnerDecisionSchema,
  partnerEligibilityRuleSchema,
  partnerInviteSchema,
  partnerMemberStatusSchema,
  partnerOfferCreateSchema,
  partnerPerformanceQuerySchema,
  partnerProfileSchema,
  partnerRoleChangeSchema,
  partnerTransitionSchema,
} from '@dealdash/validation';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  OptionalActor,
  Public,
  RequirePermissions,
  ScopeAware,
} from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { CommercialService } from '../finance/commercial.service';
import { LoyaltyRulesService } from '../loyalty/loyalty-rules.service';
import { ImportService } from '../master/import.service';
import { IntegrationService } from '../master/integration.service';
import { MarketService } from '../platform/markets/market.service';
import { PartnerAccessService } from './partner-access.service';
import { PartnerBenefitsService } from './partner-benefits.service';
import { PartnerCampaignsService } from './partner-campaigns.service';
import { PartnerDashboardService } from './partner-dashboard.service';
import { PartnerNetworkService } from './partner-network.service';
import { PartnerOnboardingService } from './partner-onboarding.service';
import { PartnerProgramsService } from './partner-programs.service';
import { PartnerTeamService } from './partner-team.service';

class OwnedWatchDto extends createZodDto(
  z.object({ merchantOrganizationId: z.string().uuid(), content: z.record(z.string(), z.unknown()) }),
) {}
class OwnedWatchFundDto extends createZodDto(
  z.object({ amountHalalas: z.number().int().positive().max(1_000_000_000) }),
) {}
class OfferCreateDto extends createZodDto(partnerOfferCreateSchema) {}
class ProfileDto extends createZodDto(partnerProfileSchema) {}
class InviteDto extends createZodDto(partnerInviteSchema) {}
class RoleDto extends createZodDto(partnerRoleChangeSchema) {}
class MemberStatusDto extends createZodDto(partnerMemberStatusSchema) {}
class NetworkCreateDto extends createZodDto(networkMerchantCreateSchema) {}
class NetworkQueryDto extends createZodDto(networkQuerySchema) {}
class DuplicateDto extends createZodDto(networkDuplicateDecisionSchema) {}
class CardProgramDto extends createZodDto(cardProgramSchema) {}
class EmployerProgramDto extends createZodDto(employerProgramSchema) {}
class RuleDto extends createZodDto(partnerEligibilityRuleSchema) {}
class RuleTestDto extends createZodDto(eligibilityTestSchema) {}
class CampaignCreateDto extends createZodDto(partnerCampaignCreateSchema) {}
class CampaignUpdateDto extends createZodDto(partnerCampaignUpdateSchema) {}
class AcceptDto extends createZodDto(commercialAcceptSchema) {}
class ApprovalDto extends createZodDto(commercialApprovalDecisionSchema) {}
class PayDto extends createZodDto(commercialPaySchema) {}
class BenefitDto extends createZodDto(liveDealBenefitSchema) {}
class BenefitStatusDto extends createZodDto(benefitStatusSchema) {}
class BenefitDecisionDto extends createZodDto(benefitDecisionSchema) {}
class PerformanceQueryDto extends createZodDto(partnerPerformanceQuerySchema) {}
class SponsorDto extends createZodDto(loyaltyRuleCreateSchema) {}
class CreateDto extends createZodDto(partnerCreateSchema) {}
class TransitionDto extends createZodDto(partnerTransitionSchema) {}
class DecisionDto extends createZodDto(partnerDecisionSchema) {}
class PreviewDto extends createZodDto(
  z.object({
    product: z.enum(PARTNER_CREATABLE_PRODUCTS),
    merchantOrganizationId: z.string().uuid(),
    content: z.record(z.string(), z.unknown()),
  }),
) {}
class UploadDto extends createZodDto(importUploadSchema) {}
class ConnectionDto extends createZodDto(connectionCreateSchema) {}
class CaseQueryDto extends createZodDto(
  z.object({
    product: z.enum(['EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY']),
    subjectId: z.string().uuid(),
  }),
) {}
class AdminListDto extends createZodDto(
  z.object({
    lifecycle: z.enum(PARTNER_LIFECYCLE).optional(),
    partnerType: z.enum(PARTNER_TYPES).optional(),
  }),
) {}

const product = (p: string): PartnerCreatableProduct => {
  if (!(PARTNER_CREATABLE_PRODUCTS as readonly string[]).includes(p)) throw AppError.notFound();
  return p as PartnerCreatableProduct;
};
const kind = (k: string) => {
  if (k !== 'MERCHANTS' && k !== 'BRANCHES' && k !== 'OFFERS') throw AppError.notFound();
  return k;
};

/**
 * The Enterprise Partner Portal API (banks, financial institutions, card schemes, corporates / employers, strategic partners). Every
 * route works only on the caller's own partner organization (404 otherwise); scoped members see only their authorized markets; routes
 * not marked scope-aware need an organization-wide grant. Everything delegates to the shared platform services.
 */
@ApiTags('partner-portal')
@Controller('partners/:orgId')
@Audiences('partner')
export class PartnerPortalController {
  constructor(
    private readonly access: PartnerAccessService,
    private readonly onboarding: PartnerOnboardingService,
    private readonly team: PartnerTeamService,
    private readonly network: PartnerNetworkService,
    private readonly programs: PartnerProgramsService,
    private readonly campaigns: PartnerCampaignsService,
    private readonly benefits: PartnerBenefitsService,
    private readonly dashboard: PartnerDashboardService,
    private readonly commercial: CommercialService,
    private readonly loyalty: LoyaltyRulesService,
    private readonly markets: MarketService,
    private readonly imports: ImportService,
    private readonly integrations: IntegrationService,
  ) {}

  // ---------------------------------------------------------------- home, business account, onboarding
  @Get('home')
  @ScopeAware()
  @RequirePermissions('partner.profile.read')
  home(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.dashboard.home(actor, orgId);
  }

  @Get('modules')
  @ScopeAware()
  @RequirePermissions('partner.profile.read')
  async modules(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.access.modules(await this.access.requirePartner(actor, orgId));
  }

  @Get('profile')
  @ScopeAware()
  @RequirePermissions('partner.profile.read')
  async profile(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.access.requirePartner(actor, orgId);
    return this.onboarding.profile(orgId);
  }

  @Put('profile')
  @Idempotent()
  @RequirePermissions('partner.profile.write')
  updateProfile(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: ProfileDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.onboarding.updateProfile(actor, orgId, b, meta);
  }

  @Get('readiness')
  @ScopeAware()
  @RequirePermissions('partner.profile.read')
  async readiness(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.access.requirePartner(actor, orgId);
    return this.onboarding.readiness(orgId);
  }

  @Post('onboarding/submit')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('partner.profile.write')
  submit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.onboarding.submit(actor, orgId, meta);
  }

  @Get('history')
  @RequirePermissions('partner.activity.read')
  async history(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.access.requirePartner(actor, orgId);
    return this.onboarding.history(orgId);
  }

  /** The partner's markets (shared market configuration), only those the member is authorized for. */
  @Get('markets')
  @ScopeAware()
  @RequirePermissions('partner.profile.read')
  async marketList(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    const p = await this.access.requirePartner(actor, orgId);
    const allowed = await this.access.authorizedMarkets(actor, p);
    return (await this.markets.forOrganization(orgId)).filter((m) => allowed.includes(m.code));
  }

  // ---------------------------------------------------------------- users (delegated administration)
  @Get('users')
  @RequirePermissions('partner.users.manage')
  users(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.team.list(actor, orgId);
  }

  @Post('users/invitations')
  @Idempotent()
  @RequirePermissions('partner.users.manage')
  invite(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: InviteDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.team.invite(actor, orgId, b, meta);
  }

  @Delete('users/invitations/:id')
  @RequirePermissions('partner.users.manage')
  revoke(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.team.revokeInvitation(actor, orgId, id, meta);
  }

  @Patch('users/:membershipId/role')
  @Idempotent()
  @RequirePermissions('partner.users.manage')
  role(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) id: string,
    @Body() b: RoleDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.team.changeRole(actor, orgId, id, b.roleCode, meta);
  }

  @Post('users/:membershipId/:action')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('partner.users.manage')
  status(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body() b: MemberStatusDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (action !== 'deactivate' && action !== 'reactivate') throw AppError.notFound();
    return this.team.setActive(actor, orgId, id, action === 'reactivate', b.reason, meta);
  }

  // ---------------------------------------------------------------- merchant network
  @Get('network')
  @ScopeAware()
  @RequirePermissions('partner.merchants.read')
  networkList(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: NetworkQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.network.list(actor, orgId, q);
  }

  @Get('network/merchants/:id')
  @ScopeAware()
  @RequirePermissions('partner.merchants.read')
  networkDetail(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.network.detail(actor, orgId, id);
  }

  @Post('network/merchants')
  @Idempotent()
  @ScopeAware()
  @RequirePermissions('partner.network.manage')
  networkCreate(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: NetworkCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.network.createManual(actor, orgId, b, meta);
  }

  @Get('network/registered')
  @ScopeAware()
  @RequirePermissions('partner.network.manage')
  registered(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('q') q: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.network.searchRegistered(actor, orgId, q ?? '');
  }

  @Post('network/registered/:merchantOrgId')
  @Idempotent()
  @ScopeAware()
  @RequirePermissions('partner.network.manage')
  linkRegistered(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('merchantOrgId', ParseUUIDPipe) m: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.network.linkRegistered(actor, orgId, m, meta);
  }

  @Get('network/duplicates')
  @RequirePermissions('partner.merchants.read')
  duplicates(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.network.duplicates(actor, orgId);
  }

  @Post('network/duplicates/:id')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('partner.network.manage')
  suggest(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DuplicateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.network.suggest(actor, orgId, id, b.decision, b.note, meta);
  }

  /**
   * A merchant-network file through the SHARED importer (validate, normalise, duplicates, preview, error report, DealDash approval).
   * The portal applies the Stage 7 rule: one partner bulk-ingestion feature AND the shared BULK_IMPORT capability.
   */
  @Post('network/imports')
  @Idempotent()
  @RequirePermissions('partner.imports.manage')
  async upload(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: UploadDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const p = await this.access.requirePartner(actor, orgId);
    await this.access.requireIngestion(p, 'BULK');
    return this.imports.upload(actor, orgId, b, meta);
  }

  /** An API / feed connection through the SHARED integration framework: one partner API-ingestion feature AND API_ACCESS. */
  @Post('integrations')
  @Idempotent()
  @RequirePermissions('partner.integrations.manage')
  async connect(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: ConnectionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const p = await this.access.requirePartner(actor, orgId);
    await this.access.requireIngestion(p, 'API');
    // a partner never authorises publication by itself: DealDash confirms publication rights after the contract
    const { row, apiKey } = await this.integrations.create(
      actor,
      orgId,
      { ...b, publicationAuthorized: false, publicationRef: undefined },
      meta,
    );
    return {
      id: row.id,
      name: row.name,
      sourceSystem: row.sourceSystem,
      kind: row.kind,
      status: row.status,
      keyPrefix: row.keyPrefix,
      scopes: row.scopes,
      apiKey,
    };
  }

  @Get('network/templates/:kind')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @RequirePermissions('partner.imports.manage')
  async template(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('kind') k: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.access.requirePartner(actor, orgId);
    return this.network.template(kind(k));
  }

  @Get('offers')
  @ScopeAware()
  @RequirePermissions('partner.merchants.read')
  offers(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.network.offers(actor, orgId);
  }

  /** FD-S7-4: a partner-created Live Deal (network offer); shown to customers only after DealDash confirms the publication right. */
  @Post('offers')
  @Idempotent()
  @ScopeAware()
  @RequirePermissions('partner.network.manage')
  createOffer(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: OfferCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.network.createOffer(actor, orgId, b, meta);
  }

  // ---------------------------------------------------------------- card / employer programmes and eligibility (shared engine)
  @Get('card-programs')
  @ScopeAware()
  @RequirePermissions('partner.eligibility.read')
  cardPrograms(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.programs.cardPrograms(actor, orgId);
  }

  @Post('card-programs')
  @Idempotent()
  @ScopeAware()
  @RequirePermissions('partner.eligibility.manage')
  saveCardProgram(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: CardProgramDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.programs.saveCardProgram(actor, orgId, b, meta);
  }

  @Get('employer-programs')
  @ScopeAware()
  @RequirePermissions('partner.eligibility.read')
  employerPrograms(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.programs.employerPrograms(actor, orgId);
  }

  @Post('employer-programs')
  @Idempotent()
  @ScopeAware()
  @RequirePermissions('partner.eligibility.manage')
  saveEmployerProgram(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: EmployerProgramDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.programs.saveEmployerProgram(actor, orgId, b, meta);
  }

  @Get('eligibility/options')
  @ScopeAware()
  @RequirePermissions('partner.eligibility.read')
  eligibilityOptions(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.programs.builderOptions(actor, orgId);
  }

  @Get('eligibility/rules')
  @RequirePermissions('partner.eligibility.read')
  rules(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.programs.rules(actor, orgId);
  }

  @Post('eligibility/rules')
  @Idempotent()
  @RequirePermissions('partner.eligibility.manage')
  saveRule(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: RuleDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.programs.saveRule(actor, orgId, b, meta);
  }

  @Post('eligibility/test')
  @HttpCode(200)
  @ScopeAware()
  @RequirePermissions('partner.eligibility.read')
  testRule(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: RuleTestDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.programs.test(actor, orgId, b);
  }

  // ---------------------------------------------------------------- campaigns (shared engines)
  @Get('campaigns')
  @ScopeAware()
  @RequirePermissions('partner.campaigns.read')
  portfolio(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.campaigns.portfolio(actor, orgId);
  }

  @Post('campaigns/preview')
  @HttpCode(200)
  @ScopeAware()
  @RequirePermissions('partner.campaigns.manage')
  async preview(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: PreviewDto,
    @CurrentActor() actor: Actor,
  ) {
    await this.access.requirePartner(actor, orgId);
    const content = {
      ...b.content,
      commercial: { ...((b.content.commercial as object) ?? {}), creatorOrganizationId: orgId },
    };
    const { hash, economics, pricingRaw, ...view } = await this.commercial.preview(
      b.product,
      b.merchantOrganizationId,
      content,
      null,
    );
    void hash;
    void economics;
    void pricingRaw;
    return view;
  }

  @Post('campaigns')
  @Idempotent()
  @ScopeAware()
  @RequirePermissions('partner.campaigns.manage')
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: CampaignCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.campaigns.create(actor, orgId, b, meta);
  }

  @Get('campaigns/merchants/:merchantOrgId/assets')
  @ScopeAware()
  @RequirePermissions('partner.campaigns.manage')
  assets(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('merchantOrgId', ParseUUIDPipe) m: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.campaigns.merchantAssets(actor, orgId, m);
  }

  @Get('campaigns/:product/:id')
  @ScopeAware()
  @RequirePermissions('partner.campaigns.read')
  campaign(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('product') p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.campaigns.get(actor, orgId, product(p), id);
  }

  @Put('campaigns/:product/:id')
  @Idempotent()
  @ScopeAware()
  @RequirePermissions('partner.campaigns.manage')
  update(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('product') p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: CampaignUpdateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.campaigns.update(actor, orgId, product(p), id, b.content, b.expectedVersion, meta);
  }

  @Post('campaigns/:product/:id/submit')
  @Idempotent()
  @HttpCode(200)
  @ScopeAware()
  @RequirePermissions('partner.campaigns.manage')
  submitCampaign(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('product') p: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.campaigns.submit(actor, orgId, product(p), id, meta);
  }

  // ---------------------------------------------------------------- commercial acceptance and funding (shared commercial case)
  @Get('commercial/cases')
  @RequirePermissions('partner.commercial.read')
  cases(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.campaigns.cases(actor, orgId);
  }

  /** The commercial case of one campaign the partner created or sponsors (the same shape the shared commercial panel reads). */
  @Get('commercial/case')
  @ScopeAware()
  @RequirePermissions('partner.commercial.read')
  async caseOf(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: CaseQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.campaigns.caseFor(actor, orgId, q.product, q.subjectId);
  }

  @Post('commercial/preview')
  @HttpCode(200)
  @ScopeAware()
  @RequirePermissions('partner.campaigns.manage')
  async commercialPreview(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: PreviewDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.preview(orgId, b, actor);
  }

  @Get('commercial/cases/:caseId')
  @ScopeAware()
  @RequirePermissions('partner.commercial.read')
  caseView(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.campaigns.caseView(actor, orgId, caseId);
  }

  @Post('commercial/cases/:caseId/accept')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('partner.commercial.accept')
  async accept(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() b: AcceptDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.access.requirePartner(actor, orgId);
    return this.commercial.accept(actor, caseId, b.quotationId, b.checks, b.language, meta);
  }

  @Post('commercial/cases/:caseId/approvals/:step')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('partner.commercial.read')
  async approve(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Param('step') step: string,
    @Body() b: ApprovalDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.access.requirePartner(actor, orgId);
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

  @Post('commercial/cases/:caseId/pay')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('partner.commercial.read')
  async pay(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('caseId', ParseUUIDPipe) caseId: string,
    @Body() b: PayDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.access.requirePartner(actor, orgId);
    return this.commercial.pay(actor, caseId, b.amountHalalas, meta);
  }

  // ---------------------------------------------------------------- Live Deal partner benefits
  @Get('benefits')
  @ScopeAware()
  @RequirePermissions('partner.campaigns.read')
  benefitList(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.benefits.listForPartner(actor, orgId);
  }

  @Get('benefits/live-deals')
  @ScopeAware()
  @RequirePermissions('partner.campaigns.manage')
  benefitCandidates(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.benefits.candidates(actor, orgId);
  }

  @Post('benefits')
  @Idempotent()
  @ScopeAware()
  @RequirePermissions('partner.campaigns.manage')
  propose(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: BenefitDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.benefits.propose(actor, orgId, b, meta);
  }

  @Post('benefits/:id/withdraw')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('partner.campaigns.manage')
  withdraw(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: BenefitStatusDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.benefits.withdraw(actor, orgId, id, b.reason, meta);
  }

  // ---------------------------------------------------------------- Watch & Earn (partner-funded points on network campaigns)
  @Get('watch')
  @ScopeAware()
  @RequirePermissions('partner.campaigns.read')
  watch(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.campaigns.watch(actor, orgId);
  }

  @Get('watch/campaigns')
  @ScopeAware()
  @RequirePermissions('partner.loyalty.manage')
  watchCandidates(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.campaigns.watchCandidates(actor, orgId);
  }

  /** A points-funding rule on a network merchant's Watch & Earn campaign: the shared loyalty rule (DealDash approves it). */
  @Post('watch/sponsor')
  @Idempotent()
  @RequirePermissions('partner.loyalty.manage')
  async sponsorWatch(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: SponsorDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const p = await this.access.requirePartner(actor, orgId);
    this.access.requireOperating(p);
    await this.access.requireModule(p, 'WATCH_SPONSORSHIP');
    if (b.productScope !== 'WATCH' || !b.campaignId)
      throw AppError.validation('Choose a Watch & Earn campaign', 'campaignId');
    await this.campaigns.requireWatchSponsorable(orgId, b.campaignId);
    return this.loyalty.create(actor, orgId, { ...b, fundingOrganizationId: orgId }, meta);
  }

  // ---------------------------------------------------------------- partner-owned Watch & Earn budgets (FD-S7-1)
  @Get('watch/owned')
  @ScopeAware()
  @RequirePermissions('partner.campaigns.read')
  ownedWatchList(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.campaigns.ownedWatch(actor, orgId);
  }

  @Post('watch/owned')
  @Idempotent()
  @ScopeAware()
  @RequirePermissions('partner.campaigns.manage')
  createOwnedWatch(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: OwnedWatchDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.campaigns.createWatch(actor, orgId, b, meta);
  }

  @Get('watch/owned/:id')
  @ScopeAware()
  @RequirePermissions('partner.campaigns.read')
  ownedWatch(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
  ) {
    return this.campaigns.getWatch(actor, orgId, id);
  }

  @Post('watch/owned/:id/fund')
  @Idempotent()
  @HttpCode(200)
  @ScopeAware()
  @RequirePermissions('partner.commercial.accept')
  fundOwnedWatch(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: OwnedWatchFundDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.campaigns.fundWatch(actor, orgId, id, b.amountHalalas, key, meta);
  }

  @Post('watch/owned/:id/submit')
  @Idempotent()
  @HttpCode(200)
  @ScopeAware()
  @RequirePermissions('partner.campaigns.manage')
  submitOwnedWatch(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.campaigns.submitWatch(actor, orgId, id, meta);
  }

  // ---------------------------------------------------------------- performance
  @Get('performance')
  @ScopeAware()
  @RequirePermissions('partner.performance.read')
  performance(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: PerformanceQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.dashboard.performance(actor, orgId, q);
  }
}

/** DealDash side of partner onboarding: create the Business Account, review, readiness, activation with a second approver. */
@ApiTags('admin-partners')
@Controller('admin/partners')
@Audiences('admin')
export class AdminPartnersController {
  constructor(
    private readonly onboarding: PartnerOnboardingService,
    private readonly benefits: PartnerBenefitsService,
    private readonly network: PartnerNetworkService,
  ) {}

  @Get()
  @RequirePermissions('admin.partners.review')
  list(@Query() q: AdminListDto) {
    return this.onboarding.list(q);
  }

  @Post()
  @Idempotent()
  @RequirePermissions('admin.partners.manage')
  create(@Body() b: CreateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.onboarding.create(actor, b, meta);
  }

  @Get('benefits')
  @RequirePermissions('admin.partners.review')
  benefitList(@Query('status') status?: string) {
    return this.benefits.listForAdmin(status);
  }

  @Post('benefits/:id/:action')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.partners.review')
  benefitDecide(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (!['approve', 'reject', 'suspend', 'reinstate'].includes(action)) throw AppError.notFound();
    return this.benefits.adminDecide(actor, id, action as 'approve', b.reason, meta);
  }

  /** FD-S7-4: partner Live Deals (network offers) waiting for DealDash to confirm the partner's publication right. */
  @Get('offers')
  @RequirePermissions('admin.partners.review')
  pendingOffers() {
    return this.network.pendingPublication();
  }

  @Post('offers/:id/:decision')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.partners.approve')
  decideOffer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decision') d: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (d !== 'confirm' && d !== 'withdraw') throw AppError.notFound();
    return this.network.decidePublication(actor, id, d === 'confirm', b.reason, meta);
  }

  @Get(':orgId')
  @RequirePermissions('admin.partners.review')
  profile(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.onboarding.profile(orgId);
  }

  @Get(':orgId/readiness')
  @RequirePermissions('admin.partners.review')
  readiness(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.onboarding.readiness(orgId);
  }

  @Get(':orgId/history')
  @RequirePermissions('admin.partners.review')
  history(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.onboarding.history(orgId);
  }

  @Post(':orgId/lifecycle')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.partners.manage')
  transition(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: TransitionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.onboarding.transition(actor, orgId, b.to, b.reason, meta);
  }

  @Post(':orgId/lifecycle/:decision')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.partners.approve')
  decide(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('decision') d: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (d !== 'approve' && d !== 'reject') throw AppError.notFound();
    return this.onboarding.decide(actor, orgId, d, b.reason, meta);
  }
}

/** The merchant that owns a Live Deal decides on partner benefits proposed for it (DealDash can never decide in its place). */
@ApiTags('merchant-partner-benefits')
@Controller('merchants/:orgId/partner-benefits')
@Audiences('merchant')
export class MerchantPartnerBenefitsController {
  constructor(private readonly benefits: PartnerBenefitsService) {}

  @Get()
  @RequirePermissions('merchant.deals.read')
  list(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    return this.benefits.listForMerchant(actor, orgId);
  }

  @Post(':id/decision')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('merchant.deals.manage')
  decide(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: BenefitDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.benefits.merchantDecide(actor, orgId, id, b.decision, b.reason, meta);
  }
}

const customerId = (actor?: Actor) => (actor?.userType === 'CUSTOMER' ? actor.userId : null);

/** Customer: the partner benefits on a public Live Deal for this customer (public read; eligibility from the shared engine). */
@ApiTags('customer-partner-benefits')
@Controller('app/live-deals/:id/partner-benefits')
@Audiences('customer')
export class CustomerPartnerBenefitsController {
  constructor(private readonly benefits: PartnerBenefitsService) {}

  @Get()
  @Public()
  list(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('city') city: string | undefined,
    @OptionalActor() actor?: Actor,
  ) {
    return this.benefits.forCustomer(id, customerId(actor), city);
  }
}
