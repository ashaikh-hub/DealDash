import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  aiAdminAskSchema,
  aiAskSchema,
  aiDecisionSchema,
  aiDraftQuerySchema,
  aiInteractionQuerySchema,
  aiUsageQuerySchema,
} from '@dealdash/validation';
import { Audiences, CurrentActor, Meta, RequirePermissions } from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { AiEvalService } from './ai-eval.service';
import { AiService } from './ai.service';

class AskDto extends createZodDto(aiAskSchema) {}
class AdminAskDto extends createZodDto(aiAdminAskSchema) {}
class DecisionDto extends createZodDto(aiDecisionSchema) {}
class DraftQueryDto extends createZodDto(aiDraftQuerySchema) {}
class InteractionQueryDto extends createZodDto(aiInteractionQuerySchema) {}
class UsageQueryDto extends createZodDto(aiUsageQuerySchema) {}

/** The customer's best-deal assistant. It reads only what the customer may see and never buys, reserves, pays or redeems. */
@ApiTags('ai')
@Controller('app/ai')
@Audiences('customer')
export class CustomerAiController {
  constructor(private readonly ai: AiService) {}

  @Post('ask')
  @HttpCode(200)
  ask(@Body() b: AskDto, @CurrentActor() actor: Actor) {
    return this.ai.ask(actor, 'CUSTOMER_BEST_DEAL', b);
  }
}

/** Merchant Growth / Partner Campaign copilot for the caller's own organization (the Partner UI arrives in Stage 7; the API is here). */
@ApiTags('ai')
@Controller('orgs/:orgId/ai')
@Audiences('merchant', 'partner')
export class OrgAiController {
  constructor(private readonly ai: AiService) {}

  @Post('ask')
  @HttpCode(200)
  ask(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: AskDto,
    @CurrentActor() actor: Actor,
  ) {
    const agent =
      actor.membership?.organizationType === 'PARTNER' ? 'PARTNER_CAMPAIGN' : 'MERCHANT_GROWTH';
    return this.ai.ask(actor, agent, { ...b, organizationId: orgId });
  }

  @Get('drafts')
  drafts(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: DraftQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    const perm =
      actor.membership?.organizationType === 'PARTNER' ? 'partner.ai.use' : 'merchant.ai.use';
    if (!actor.permissions.has(perm)) throw AppError.forbidden();
    return this.ai.drafts(actor, orgId, q.status);
  }

  @Post('drafts/:id/:decision')
  @HttpCode(200)
  decide(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decision') decision: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (decision !== 'approve' && decision !== 'reject') throw AppError.notFound();
    return this.ai.decide(actor, orgId, id, decision === 'approve', b.reason ?? null, meta);
  }
}

/** DealDash: Operations & Support and Admin / Finance copilots, AI audit, usage metering and the evaluation pack. */
@ApiTags('admin-ai')
@Controller('admin/ai')
@Audiences('admin')
export class AdminAiController {
  constructor(
    private readonly ai: AiService,
    private readonly evals: AiEvalService,
  ) {}

  @Post('ask')
  @HttpCode(200)
  ask(@Body() b: AdminAskDto, @CurrentActor() actor: Actor) {
    const { agent, ...rest } = b;
    return this.ai.ask(actor, agent, rest);
  }

  @Get('drafts')
  @RequirePermissions('admin.ai.use')
  drafts(@Query() q: DraftQueryDto, @CurrentActor() actor: Actor) {
    return this.ai.drafts(actor, null, q.status);
  }

  @Post('drafts/:id/:decision')
  @HttpCode(200)
  @RequirePermissions('admin.ai.manage')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('decision') decision: string,
    @Body() b: DecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (decision !== 'approve' && decision !== 'reject') throw AppError.notFound();
    return this.ai.decide(actor, null, id, decision === 'approve', b.reason ?? null, meta);
  }

  @Get('interactions')
  @RequirePermissions('admin.ai.manage')
  interactions(@Query() q: InteractionQueryDto) {
    return this.ai.interactions(q);
  }

  @Get('interactions/:id')
  @RequirePermissions('admin.ai.manage')
  interaction(@Param('id', ParseUUIDPipe) id: string) {
    return this.ai.interaction(id);
  }

  @Get('usage')
  @RequirePermissions('admin.ai.manage')
  usage(@Query() q: UsageQueryDto) {
    return this.ai.usage({
      organizationId: q.organizationId,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    });
  }

  @Get('governance')
  @RequirePermissions('admin.ai.manage')
  governance() {
    return this.ai.governance();
  }

  @Post('evaluations')
  @HttpCode(200)
  @RequirePermissions('admin.ai.manage')
  evaluate() {
    return this.evals.run();
  }
}
