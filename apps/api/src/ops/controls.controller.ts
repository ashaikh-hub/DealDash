import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { LAUNCH_ACTIONS, type ApiEnv } from '@dealdash/config';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  Public,
  RequirePermissions,
} from '../common/decorators';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, AppRequest, RequestMeta } from '../common/request-context';
import { verifyCallback } from '../common/signed-callback';
import { NotificationsService } from '../hot-deals/notifications.service';
import { ConfigGovernanceService } from './config-governance.service';
import { DataRequestsService } from './data-requests.service';
import { SettlementService } from './settlement.service';

const reason = z.string().trim().min(3).max(1000);
const changeSchema = z.object({
  key: z.string().trim().min(3).max(80),
  section: z.string().trim().min(1).max(80),
  value: z.unknown(),
  baseVersion: z.number().int().min(0),
  reason,
  effectiveFrom: z.string().datetime({ offset: true }).nullable().optional(),
});
const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason });
const rollbackSchema = z.object({ version: z.number().int().min(1), reason });
const stopSchema = z.object({
  market: z.string().trim().length(2),
  action: z.enum(LAUNCH_ACTIONS),
  stopped: z.boolean(),
  reason,
});
class ChangeDto extends createZodDto(changeSchema) {}
class ControlDecisionDto extends createZodDto(decisionSchema) {}
class RollbackDto extends createZodDto(rollbackSchema) {}
class StopDto extends createZodDto(stopSchema) {}
const legalHoldSchema = z.object({
  subjectType: z.enum(['USER', 'ORGANIZATION']),
  subjectId: z.string().uuid(),
  reason,
  caseId: z.string().uuid().nullable().optional(),
});
class LegalHoldDto extends createZodDto(legalHoldSchema) {}
class ReasonOnlyDto extends createZodDto(z.object({ reason })) {}

/** Stage 9 (B7): Admin -> Rules and controls (structured, governed) and the emergency launch stops. */
@ApiTags('admin-controls')
@Controller('admin/controls')
@Audiences('admin')
export class AdminControlsController {
  constructor(
    private readonly governance: ConfigGovernanceService,
    private readonly settlements: SettlementService,
    private readonly dataRequests: DataRequestsService,
  ) {}

  @Get()
  @RequirePermissions('admin.config.read')
  overview(@CurrentActor() actor: Actor) {
    return this.governance.overview(actor);
  }

  @Get(':key/history')
  @RequirePermissions('admin.config.read')
  history(@Param('key') key: string) {
    return this.governance.history(key);
  }

  @Post('requests')
  @Idempotent()
  @RequirePermissions('admin.config.manage')
  request(@Body() b: ChangeDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.governance.request(actor, b, meta);
  }

  @Post('requests/:id/decide')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.config.manage')
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ControlDecisionDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.governance.decide(actor, id, b.decision === 'APPROVE', b.reason, meta);
  }

  @Post('requests/:id/cancel')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.config.manage')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.governance.cancel(actor, id, meta);
  }

  @Post(':key/rollback')
  @Idempotent()
  @RequirePermissions('admin.config.manage')
  rollback(
    @Param('key') key: string,
    @Body() b: RollbackDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.governance.rollback(actor, key, b.version, b.reason, meta);
  }

  /** Emergency market stop (immediate; refuses NEW actions only; issued customer rights stay valid). */
  @Post('launch/stops')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.launch.control')
  stop(@Body() b: StopDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.governance.setStop(actor, b, meta);
  }

  /** B2: sends a settlement's outstanding amount through the payout provider (finance approver, not the preparer). */
  @Post('settlements/:id/instruct-payout')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.settlements.manage')
  instruct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.settlements.instructPayout(actor, id, meta);
  }

  // ---------------------------------------------------------------- legal holds (privacy operations)
  @Get('legal-holds')
  @RequirePermissions('admin.privacy.manage')
  holds() {
    return this.dataRequests.legalHolds();
  }

  @Post('legal-holds')
  @Idempotent()
  @RequirePermissions('admin.privacy.manage')
  placeHold(@Body() b: LegalHoldDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.dataRequests.placeHold(actor, b, meta);
  }

  @Post('legal-holds/:id/lift')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.privacy.approve')
  liftHold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ReasonOnlyDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.dataRequests.liftHold(actor, id, b.reason, meta);
  }

  /** B2: asks the payout provider about pending instructions now (the job also does it). */
  @Post('settlements/poll-payouts')
  @HttpCode(200)
  @RequirePermissions('admin.settlements.manage')
  async poll() {
    return { applied: await this.settlements.pollPendingPayouts() };
  }
}

const payoutCallback = z.object({
  providerRef: z.string().min(3).max(120),
  status: z.enum(['PAID', 'FAILED', 'PENDING']),
  failureReason: z.string().max(300).nullable().optional(),
  bankRef: z.string().max(120).nullable().optional(),
});
const receiptCallback = z.object({
  providerMessageId: z.string().min(3).max(200),
  status: z.enum(['DELIVERED', 'FAILED']),
  reason: z.string().max(300).nullable().optional(),
});

/**
 * Stage 9 (B2 / B3): provider callbacks. Public (a provider is not a user) and accepted only with a valid, fresh signature over the
 * exact body (see common/signed-callback). Without the shared secret configured every callback is refused.
 */
@ApiTags('webhooks')
@Controller('webhooks')
export class ProviderCallbacksController {
  constructor(
    @Inject(APP_ENV) private readonly env: ApiEnv,
    private readonly settlements: SettlementService,
    private readonly notifications: NotificationsService,
  ) {}

  private body<T>(
    req: AppRequest & { rawBody?: Buffer },
    signature: string | undefined,
    secret: string | undefined,
    schema: z.ZodType<T>,
  ): T {
    const raw = req.rawBody?.toString('utf8');
    if (!verifyCallback(secret, raw, signature))
      throw new AppError('AUTH_REQUIRED', 'Invalid or expired signature', 401);
    let json: unknown;
    try {
      json = JSON.parse(raw!);
    } catch {
      throw AppError.validation('Unrecognised callback', 'body');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw AppError.validation('Unrecognised callback', 'body');
    return parsed.data;
  }

  @Post('payouts')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async payout(
    @Req() req: AppRequest & { rawBody?: Buffer },
    @Headers('x-dealdash-signature') signature?: string,
  ) {
    const b = this.body(req, signature, this.env.PAYOUT_WEBHOOK_SECRET, payoutCallback);
    return this.settlements.payoutResult(
      b.providerRef,
      b.status,
      b.failureReason ?? null,
      b.bankRef ?? null,
    );
  }

  @Post('notifications')
  @Public()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async receipt(
    @Req() req: AppRequest & { rawBody?: Buffer },
    @Headers('x-dealdash-signature') signature?: string,
  ) {
    const b = this.body(req, signature, this.env.NOTIFY_WEBHOOK_SECRET, receiptCallback);
    return this.notifications.applyDeliveryReceipt(b.providerMessageId, b.status, b.reason ?? null);
  }
}
