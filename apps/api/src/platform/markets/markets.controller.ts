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
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import type { MarketStatus } from '@dealdash/types';
import {
  configRetireSchema,
  invoiceConfigSchema,
  marketDecisionSchema,
  marketMasterSchema,
  marketPolicySchema,
  marketProductSchema,
  marketProviderSchema,
  marketRegionSchema,
  marketTransitionSchema,
  marketValidationCreateSchema,
  marketValidationQuerySchema,
  marketValidationUpdateSchema,
  settlementRuleSchema,
  taxResolveQuerySchema,
  taxRuleSchema,
} from '@dealdash/validation';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  RequirePermissions,
  ScopeAware,
} from '../../common/decorators';
import { AppError } from '../../common/errors';
import type { Actor, RequestMeta } from '../../common/request-context';
import { MarketConfigService, type ConfigTable } from './market-config.service';
import { MarketReadinessService } from './market-readiness.service';
import { MarketService } from './market.service';

class MasterDto extends createZodDto(marketMasterSchema) {}
class RegionDto extends createZodDto(marketRegionSchema) {}
class TransitionDto extends createZodDto(marketTransitionSchema) {}
class DecisionDto extends createZodDto(marketDecisionSchema) {}
class ProductDto extends createZodDto(marketProductSchema) {}
class TaxDto extends createZodDto(taxRuleSchema) {}
class InvoiceDto extends createZodDto(invoiceConfigSchema) {}
class SettlementDto extends createZodDto(settlementRuleSchema) {}
class ProviderDto extends createZodDto(marketProviderSchema) {}
class PolicyDto extends createZodDto(marketPolicySchema) {}
class ValidationCreateDto extends createZodDto(marketValidationCreateSchema) {}
class ValidationUpdateDto extends createZodDto(marketValidationUpdateSchema) {}
class ValidationQueryDto extends createZodDto(marketValidationQuerySchema) {}
class TaxResolveDto extends createZodDto(taxResolveQuerySchema) {}
class RetireDto extends createZodDto(configRetireSchema) {}

const TABLE: Record<string, ConfigTable> = {
  'tax-rules': 'taxRule',
  'invoice-configs': 'invoiceConfig',
  'settlement-rules': 'settlementRule',
  policies: 'marketPolicy',
};
const tableOf = (kind: string) => {
  const t = TABLE[kind];
  if (!t) throw AppError.notFound();
  return t;
};

/**
 * DealDash Admin -> Markets. Existing role permissions (admin.markets.read / manage / approve) plus scope: a market-scoped administrator
 * (scoped membership with COUNTRY grants) sees and changes only the markets granted. Every change is audited under COUNTRY:<code>.
 */
@ApiTags('admin-markets')
@Controller('admin/markets')
@Audiences('admin')
@ScopeAware()
export class AdminMarketsController {
  constructor(
    private readonly markets: MarketService,
    private readonly cfg: MarketConfigService,
    private readonly readiness: MarketReadinessService,
  ) {}

  private gate = (code: string) => (to: MarketStatus) => this.readiness.gate(code, to);

  @Get()
  @RequirePermissions('admin.markets.read')
  async list(@CurrentActor() actor: Actor) {
    const visible = await this.markets.visibleCodes(actor, 'admin.markets.read');
    const out = [];
    for (const r of await this.markets.listRows()) {
      if (visible && !visible.has(r.code)) continue;
      out.push({
        ...this.markets.view(r),
        products: await this.markets.productCounts(r.code),
        readiness: (await this.readiness.readiness(r.code)).state,
      });
    }
    return out;
  }

  @Get('regions')
  @RequirePermissions('admin.markets.read')
  regions() {
    return this.markets.regions();
  }

  @Post('regions')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.markets.manage')
  upsertRegion(@Body() b: RegionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    if (actor.membership?.scoped)
      throw AppError.forbidden('Regions are managed by unscoped administrators');
    return this.markets.upsertRegion(actor, b, meta);
  }

  @Get('validations')
  @RequirePermissions('admin.markets.read')
  async validations(@Query() q: ValidationQueryDto, @CurrentActor() actor: Actor) {
    if (q.market) await this.markets.assertScope(actor, 'admin.markets.read', q.market);
    return this.cfg.validations({
      market: q.market,
      status: q.status,
      visible: await this.markets.visibleCodes(actor, 'admin.markets.read'),
    });
  }

  @Put('validations/:id')
  @RequirePermissions('admin.markets.manage')
  updateValidation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ValidationUpdateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cfg.updateValidation(actor, id, b, meta);
  }

  @Post('config/:kind/:id/approve')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.markets.approve')
  approveConfig(
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cfg.approve(actor, tableOf(kind), id, meta);
  }

  @Post('config/:kind/:id/retire')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.markets.manage')
  retireConfig(
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: RetireDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cfg.retire(
      actor,
      tableOf(kind),
      id,
      b.reason,
      meta,
      b.at ? new Date(b.at) : undefined,
    );
  }

  @Get(':code')
  @RequirePermissions('admin.markets.read')
  async get(@Param('code') code: string, @CurrentActor() actor: Actor) {
    await this.markets.assertScope(actor, 'admin.markets.read', code.toUpperCase());
    return this.markets.view(await this.markets.load(code));
  }

  @Post(':code')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.markets.manage')
  upsert(
    @Param('code') code: string,
    @Body() b: MasterDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.markets.upsert(actor, code, b, meta);
  }

  @Get(':code/readiness')
  @RequirePermissions('admin.markets.read')
  async getReadiness(@Param('code') code: string, @CurrentActor() actor: Actor) {
    await this.markets.assertScope(actor, 'admin.markets.read', code.toUpperCase());
    return this.readiness.readiness(code.toUpperCase());
  }

  @Post(':code/status')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.markets.manage')
  transition(
    @Param('code') code: string,
    @Body() b: TransitionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const c = code.toUpperCase();
    return this.markets.requestTransition(actor, c, b.status, b.reason, this.gate(c), meta);
  }

  @Post(':code/status/:decision')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.markets.approve')
  decide(
    @Param('code') code: string,
    @Param('decision') decision: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (decision !== 'approve' && decision !== 'reject') throw AppError.notFound();
    const c = code.toUpperCase();
    return this.markets.decideTransition(
      actor,
      c,
      decision === 'approve',
      b.reason ?? null,
      this.gate(c),
      meta,
    );
  }

  @Get(':code/products')
  @RequirePermissions('admin.markets.read')
  async products(@Param('code') code: string, @CurrentActor() actor: Actor) {
    await this.markets.assertScope(actor, 'admin.markets.read', code.toUpperCase());
    return this.markets.products(code);
  }

  @Put(':code/products/:product')
  @RequirePermissions('admin.markets.manage')
  setProduct(
    @Param('code') code: string,
    @Param('product') product: string,
    @Body() b: ProductDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.markets.setProduct(
      actor,
      code.toUpperCase(),
      product,
      b.status,
      b.notes ?? null,
      meta,
    );
  }

  @Get(':code/config/:kind')
  @RequirePermissions('admin.markets.read')
  async listConfig(
    @Param('code') code: string,
    @Param('kind') kind: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.markets.assertScope(actor, 'admin.markets.read', code.toUpperCase());
    return this.cfg.list(tableOf(kind), code);
  }

  @Post(':code/tax-rules')
  @Idempotent()
  @RequirePermissions('admin.markets.manage')
  draftTax(
    @Param('code') code: string,
    @Body() b: TaxDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cfg.draftTax(actor, code, b, meta);
  }

  @Get(':code/tax-rules/resolve')
  @RequirePermissions('admin.markets.read')
  async resolveTax(
    @Param('code') code: string,
    @Query() q: TaxResolveDto,
    @CurrentActor() actor: Actor,
  ) {
    await this.markets.assertScope(actor, 'admin.markets.read', code.toUpperCase());
    return {
      rule: await this.cfg.resolveTax(code.toUpperCase(), q.item, {
        legalEntityId: q.legalEntityId,
        at: q.at ? new Date(q.at) : undefined,
      }),
    };
  }

  @Post(':code/invoice-configs')
  @Idempotent()
  @RequirePermissions('admin.markets.manage')
  draftInvoice(
    @Param('code') code: string,
    @Body() b: InvoiceDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cfg.draftInvoiceConfig(actor, code, b, meta);
  }

  @Post(':code/settlement-rules')
  @Idempotent()
  @RequirePermissions('admin.markets.manage')
  draftSettlement(
    @Param('code') code: string,
    @Body() b: SettlementDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cfg.draftSettlement(actor, code, b, meta);
  }

  @Post(':code/policies')
  @Idempotent()
  @RequirePermissions('admin.markets.manage')
  draftPolicy(
    @Param('code') code: string,
    @Body() b: PolicyDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cfg.draftPolicy(actor, code, b, meta);
  }

  @Get(':code/providers')
  @RequirePermissions('admin.markets.read')
  async providers(@Param('code') code: string, @CurrentActor() actor: Actor) {
    await this.markets.assertScope(actor, 'admin.markets.read', code.toUpperCase());
    return this.cfg.providers(code);
  }

  @Post(':code/providers')
  @Idempotent()
  @RequirePermissions('admin.markets.manage')
  addProvider(
    @Param('code') code: string,
    @Body() b: ProviderDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cfg.upsertProvider(actor, code, null, b, meta);
  }

  @Put(':code/providers/:id')
  @RequirePermissions('admin.markets.manage')
  updateProvider(
    @Param('code') code: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ProviderDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cfg.upsertProvider(actor, code, id, b, meta);
  }

  @Post(':code/validations')
  @Idempotent()
  @RequirePermissions('admin.markets.manage')
  createValidation(
    @Param('code') code: string,
    @Body() b: ValidationCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cfg.createValidation(actor, code, b, meta);
  }

  @Get(':code/history')
  @RequirePermissions('admin.markets.read')
  async history(@Param('code') code: string, @CurrentActor() actor: Actor) {
    await this.markets.assertScope(actor, 'admin.markets.read', code.toUpperCase());
    return (await this.markets.history(code)).map((h) => ({
      id: h.id,
      occurredAt: h.occurredAt.toISOString(),
      action: h.action,
      entityType: h.entityType,
      entityId: h.entityId,
      actorUserId: h.actorUserId,
      actorRole: h.actorRole,
      reason: h.reason,
      previousState: h.previousState,
      newState: h.newState,
      approvalRef: h.approvalRef,
    }));
  }
}

/** A business's markets and what is open in each (the view Stage 7 partner screens will consume). */
@ApiTags('markets')
@Controller('orgs/:orgId/markets')
@Audiences('merchant', 'partner')
export class OrgMarketsController {
  constructor(private readonly markets: MarketService) {}

  @Get()
  async list(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    if (actor.membership?.organizationId !== orgId) throw AppError.notFound();
    return this.markets.forOrganization(orgId);
  }
}
