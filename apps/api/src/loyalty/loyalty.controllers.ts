import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { PermissionCode } from '@dealdash/types';
import {
  envelope,
  loyaltyAllocationSchema,
  loyaltyDecisionSchema,
  loyaltyFinanceSummarySchema,
  loyaltyRuleCreateSchema,
  loyaltyRuleViewSchema,
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
import { LoyaltyFinanceService } from './loyalty-finance.service';
import { LoyaltyRulesService } from './loyalty-rules.service';

class RuleCreateDto extends createZodDto(loyaltyRuleCreateSchema) {}
class DecisionDto extends createZodDto(loyaltyDecisionSchema) {}
class AllocationDto extends createZodDto(loyaltyAllocationSchema) {}
class RuleResponse extends createZodDto(envelope(loyaltyRuleViewSchema)) {}
class RuleListResponse extends createZodDto(envelope(z.array(loyaltyRuleViewSchema))) {}
class FinanceResponse extends createZodDto(envelope(loyaltyFinanceSummarySchema)) {}

/** DealDash Admin: every rule, approval (a different person than the author), and the loyalty finance view. */
@ApiTags('admin-loyalty')
@Controller('admin/loyalty')
@Audiences('admin')
export class AdminLoyaltyController {
  constructor(
    private readonly rules: LoyaltyRulesService,
    private readonly finance: LoyaltyFinanceService,
  ) {}

  @Get('rules')
  @RequirePermissions('admin.loyalty.read')
  @ApiOkResponse({ type: RuleListResponse })
  list() {
    return this.rules.list({});
  }

  @Get('rules/:id')
  @RequirePermissions('admin.loyalty.read')
  @ApiOkResponse({ type: RuleResponse })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.rules.view(await this.rules.load(id));
  }

  @Post('rules')
  @Idempotent()
  @RequirePermissions('admin.loyalty.manage')
  @ApiOkResponse({ type: RuleResponse })
  create(@Body() b: RuleCreateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.rules.create(actor, null, b, meta);
  }

  @Post('rules/:id/submit')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.loyalty.manage')
  @ApiOkResponse({ type: RuleResponse })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.rules.submit(actor, id, undefined, meta);
  }

  @Post('rules/:id/approve')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.loyalty.approve')
  @ApiOkResponse({ type: RuleResponse })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.rules.approve(actor, id, meta, b.reason);
  }

  @Post('rules/:id/reject')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.loyalty.approve')
  @ApiOkResponse({ type: RuleResponse })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (!b.reason) throw AppError.validation('A reason is required', 'reason');
    return this.rules.reject(actor, id, b.reason, meta);
  }

  @Post('rules/:id/pause')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.loyalty.manage')
  @ApiOkResponse({ type: RuleResponse })
  pause(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.rules.pause(actor, id, undefined, b.reason, meta);
  }

  @Post('rules/:id/resume')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.loyalty.manage')
  @ApiOkResponse({ type: RuleResponse })
  resume(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.rules.resume(actor, id, undefined, meta);
  }

  @Post('rules/:id/end')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.loyalty.manage')
  @ApiOkResponse({ type: RuleResponse })
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.rules.end(actor, id, undefined, b.reason, meta);
  }

  @Post('rules/:id/allocation')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.loyalty.approve')
  @ApiOkResponse({ type: RuleResponse })
  allocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: AllocationDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.rules.increaseAllocation(actor, id, undefined, b.maxAllocationPoints, meta);
  }

  @Get('finance')
  @RequirePermissions('admin.loyalty.read')
  @ApiOkResponse({ type: FinanceResponse })
  summary() {
    return this.finance.summary(undefined);
  }
}

/** A business's own funded loyalty rules (a bank, a scheme or a merchant paying for points). DealDash approves before they issue. */
@ApiTags('organization-loyalty')
@Controller('orgs/:orgId/loyalty')
@Audiences('merchant', 'partner')
export class OrgLoyaltyController {
  constructor(
    private readonly rules: LoyaltyRulesService,
    private readonly finance: LoyaltyFinanceService,
  ) {}

  private need(actor: Actor, orgId: string) {
    const m = actor.membership;
    if (
      !m ||
      m.organizationId !== orgId ||
      (m.organizationType !== 'MERCHANT' && m.organizationType !== 'PARTNER')
    )
      throw AppError.notFound();
    const code =
      `${m.organizationType === 'PARTNER' ? 'partner' : 'merchant'}.loyalty.manage` as PermissionCode;
    if (!actor.permissions.has(code) || m.scoped)
      throw new AppError('SCOPE_FORBIDDEN', 'You do not have permission to do this', 403);
  }

  @Get('rules')
  @ApiOkResponse({ type: RuleListResponse })
  list(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId);
    return this.rules.list({ OR: [{ organizationId: orgId }, { fundingOrganizationId: orgId }] });
  }

  @Post('rules')
  @Idempotent()
  @ApiOkResponse({ type: RuleResponse })
  create(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: RuleCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.need(actor, orgId);
    return this.rules.create(actor, orgId, b, meta);
  }

  @Post('rules/:id/submit')
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: RuleResponse })
  submit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.need(actor, orgId);
    return this.rules.submit(actor, id, orgId, meta);
  }

  @Post('rules/:id/pause')
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: RuleResponse })
  pause(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.need(actor, orgId);
    return this.rules.pause(actor, id, orgId, b.reason, meta);
  }

  @Post('rules/:id/resume')
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: RuleResponse })
  resume(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.need(actor, orgId);
    return this.rules.resume(actor, id, orgId, meta);
  }

  @Post('rules/:id/end')
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: RuleResponse })
  end(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.need(actor, orgId);
    return this.rules.end(actor, id, orgId, b.reason, meta);
  }

  /** Raising the ceiling is an amendment: the funder re-accepts and funds the difference first. */
  @Post('rules/:id/allocation')
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: RuleResponse })
  allocation(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: AllocationDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.need(actor, orgId);
    return this.rules.increaseAllocation(actor, id, orgId, b.maxAllocationPoints, meta);
  }

  @Get('finance')
  @ApiOkResponse({ type: FinanceResponse })
  summary(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId);
    return this.finance.summary(orgId);
  }
}
