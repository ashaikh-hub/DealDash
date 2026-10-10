import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CONFIG_KEYS, operationsConfigSchema } from '@dealdash/config';
import {
  ADJUSTMENT_DIRECTIONS,
  ADJUSTMENT_KINDS,
  CASE_OPEN_STATUSES,
  DATA_REQUEST_TYPES,
  MODERATION_DECISIONS,
  ORDER_REFUND_REASONS,
  RECON_SOURCES,
  REPORT_REASONS,
  RESTRICTION_KINDS,
} from '@dealdash/types';
import { Audiences, CurrentActor, Idempotent, Meta, OptionalActor, Public, RequirePermissions } from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { NotificationsService } from '../hot-deals/notifications.service';
import { TenantService } from '../identity/tenant.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AdjustmentsService } from './adjustments.service';
import { DataRequestsService } from './data-requests.service';
import { OpsReportsService } from './ops-reports.service';
import { opsConfig } from './ops-util';
import { ReconciliationOpsService } from './reconciliation-ops.service';
import { RestrictionsService } from './restrictions.service';
import { ReviewsService } from './reviews.service';
import { RiskOpsService } from './risk-ops.service';
import { SettlementService } from './settlement.service';
import { SlaService } from './sla.service';
import { SupportOpsService } from './support-ops.service';

const uuid = z.string().uuid();
const reason = z.string().trim().min(3).max(1000);
const drillSchema = z.object({
  market: z.string().trim().length(2).optional(),
  legalEntityId: uuid.optional(),
  organizationId: uuid.optional(),
  brandId: uuid.optional(),
  city: z.string().trim().max(80).optional(),
  branchId: uuid.optional(),
  product: z.string().trim().max(30).optional(),
  campaignId: uuid.optional(),
});
const configSchema = z.object({ value: z.unknown(), reason });
const adjustmentSchema = z.object({
  kind: z.enum(ADJUSTMENT_KINDS),
  direction: z.enum(ADJUSTMENT_DIRECTIONS),
  amountMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  points: z.number().int().min(0).max(10_000_000).optional(),
  currency: z.string().trim().length(3).optional(),
  organizationId: uuid.nullable().optional(),
  businessAccountId: uuid.nullable().optional(),
  customerUserId: uuid.nullable().optional(),
  legalEntityId: uuid.nullable().optional(),
  contractId: uuid.nullable().optional(),
  sourceType: z.string().trim().max(60).nullable().optional(),
  sourceId: z.string().trim().max(100).nullable().optional(),
  caseId: uuid.nullable().optional(),
  reasonCode: z.string().trim().min(2).max(60),
  reason,
  idempotencyKey: z.string().trim().min(8).max(100).nullable().optional(),
});
const decisionSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason });
const reasonOnly = z.object({ reason });
const runSchema = z.object({ market: z.string().trim().length(2), organizationId: uuid.nullable().optional(), currency: z.string().trim().length(3).optional(), periodTo: z.string().datetime({ offset: true }).nullable().optional() });
const payoutSchema = z.object({ amountMinor: z.number().int().positive().max(1_000_000_000).nullable().optional(), externalRef: z.string().trim().min(3).max(100), idempotencyKey: z.string().trim().min(8).max(100).nullable().optional() });
const statementSchema = z.object({
  source: z.enum(RECON_SOURCES),
  currency: z.string().trim().length(3).optional(),
  fileName: z.string().trim().max(160).nullable().optional(),
  periodFrom: z.string().datetime({ offset: true }).nullable().optional(),
  periodTo: z.string().datetime({ offset: true }).nullable().optional(),
  lines: z.array(z.object({ reference: z.string().trim().min(1).max(120), amountMinor: z.number().int(), currency: z.string().trim().length(3).optional(), occurredAt: z.string().datetime({ offset: true }) })).max(5000),
});
const assignSchema = z.object({ ownerUserId: uuid });
const resolveSchema = z.object({ resolution: reason, adjustmentRequestId: uuid.nullable().optional() });
const riskDecideSchema = z.object({
  outcome: z.enum(['CLEAR', 'CONFIRM']),
  reason,
  restriction: z.object({ kind: z.enum(RESTRICTION_KINDS), days: z.number().int().min(1).max(365).optional(), reasonCode: z.string().trim().min(2).max(60) }).nullable().optional(),
});
const restrictionSchema = z.object({
  kind: z.enum(RESTRICTION_KINDS),
  subjectId: z.string().trim().min(1).max(100),
  scope: z.array(z.string().trim().max(40)).max(10).optional(),
  reasonCode: z.string().trim().min(2).max(60),
  reason,
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  days: z.number().int().min(1).max(365).nullable().optional(),
  caseId: uuid.nullable().optional(),
  riskFlagId: uuid.nullable().optional(),
});
const moderationSchema = z.object({ decision: z.enum(MODERATION_DECISIONS), reasonCode: z.string().trim().min(2).max(60), reason });
const escalateSchema = z.object({ priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']).optional(), targetOrganizationId: uuid.nullable().optional() });
const orderRefundSchema = z.object({ orderId: uuid, paymentId: uuid, reason: z.enum(ORDER_REFUND_REASONS), note: reason, caseId: uuid.nullable().optional() });
const linkCaseSchema = z.object({ caseId: uuid });
const dataRequestSchema = z.object({ customerUserId: uuid, type: z.enum(DATA_REQUEST_TYPES), reason: z.string().trim().max(1000).nullable().optional() });
const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), text: z.string().trim().min(1).max(2000), locale: z.enum(['en', 'ar']).optional(), subjectType: z.enum(['MERCHANT', 'LIVE_DEAL', 'EXCLUSIVE', 'VOUCHER']).optional(), subjectId: uuid.nullable().optional() });
const reportSchema = z.object({ reason: z.enum(REPORT_REASONS), note: z.string().trim().max(500).nullable().optional() });
const contentReportSchema = z.object({ subjectType: z.enum(['MERCHANT_PROFILE', 'CAMPAIGN', 'MEDIA']), subjectId: uuid, product: z.enum(['LIVE_DEAL', 'EXCLUSIVE', 'VOUCHER', 'WATCH']).nullable().optional(), reason: z.enum(REPORT_REASONS), note: z.string().trim().max(500).nullable().optional() });
const myDataRequestSchema = z.object({ type: z.enum(DATA_REQUEST_TYPES), reason: z.string().trim().max(1000).nullable().optional() });

class DrillDto extends createZodDto(drillSchema) {}
class ConfigDto extends createZodDto(configSchema) {}
class AdjustmentDto extends createZodDto(adjustmentSchema) {}
class DecisionDto extends createZodDto(decisionSchema) {}
class ReasonDto extends createZodDto(reasonOnly) {}
class RunDto extends createZodDto(runSchema) {}
class PayoutDto extends createZodDto(payoutSchema) {}
class StatementDto extends createZodDto(statementSchema) {}
class AssignDto extends createZodDto(assignSchema) {}
class ResolveDto extends createZodDto(resolveSchema) {}
class RiskDecideDto extends createZodDto(riskDecideSchema) {}
class RestrictionDto extends createZodDto(restrictionSchema) {}
class ModerationDto extends createZodDto(moderationSchema) {}
class EscalateDto extends createZodDto(escalateSchema) {}
class OrderRefundDto extends createZodDto(orderRefundSchema) {}
class LinkCaseDto extends createZodDto(linkCaseSchema) {}
class DataRequestDto extends createZodDto(dataRequestSchema) {}
class ReviewDto extends createZodDto(reviewSchema) {}
class ReportDto extends createZodDto(reportSchema) {}
class ContentReportDto extends createZodDto(contentReportSchema) {}
class MyDataRequestDto extends createZodDto(myDataRequestSchema) {}

const POINTS = ['POINTS_ADJUSTMENT', 'REWARD_REVERSAL'];
const any = (actor: Actor, ...codes: string[]) => {
  if (!codes.some((c) => actor.permissions.has(c as never))) throw AppError.forbidden();
};

/** DealDash operations (Stage 8). Every route checks its permission; the services enforce maker-checker and record the audit. */
@ApiTags('admin-ops')
@Controller('admin/ops')
@Audiences('admin')
export class AdminOpsController {
  constructor(
    private readonly reports: OpsReportsService,
    private readonly sla: SlaService,
    private readonly config: SystemConfigService,
    private readonly prisma: PrismaService,
    private readonly adjustments: AdjustmentsService,
    private readonly settlements: SettlementService,
    private readonly recon: ReconciliationOpsService,
    private readonly risk: RiskOpsService,
    private readonly restrictions: RestrictionsService,
    private readonly reviews: ReviewsService,
    private readonly notifications: NotificationsService,
    private readonly support: SupportOpsService,
    private readonly dataRequests: DataRequestsService,
  ) {}

  // ---------------------------------------------------------------- command centre exceptions, reports, SLA
  @Get('exceptions')
  @RequirePermissions('admin.operations.read')
  exceptions(@Query() q: DrillDto) {
    return this.reports.exceptions(q);
  }

  @Get('reports')
  @RequirePermissions('admin.operations.read')
  report(@Query('days') days?: string) {
    return this.reports.report(Math.min(365, Math.max(1, Number(days) || 30)));
  }

  @Get('reports.csv')
  @RequirePermissions('admin.operations.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async reportCsv(@Query('days') days?: string) {
    return this.reports.reportCsv(Math.min(365, Math.max(1, Number(days) || 30)));
  }

  @Get('sla')
  @RequirePermissions('admin.operations.read')
  slaOverview() {
    return this.sla.overview();
  }

  /** Runs the SLA check now (the job does it every few minutes; idempotent). */
  @Post('sla/sweep')
  @HttpCode(200)
  @RequirePermissions('admin.operations.read')
  async slaSweep() {
    return { changes: await this.sla.sweep() };
  }

  // ---------------------------------------------------------------- rules and controls (versioned configuration)
  @Get('config')
  @RequirePermissions('admin.config.read')
  async getConfig() {
    const row = await this.prisma.systemConfiguration.findUnique({ where: { key: CONFIG_KEYS.OPERATIONS } });
    return { value: await opsConfig(this.config), version: row?.version ?? 0, updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  @Put('config')
  @Idempotent()
  @RequirePermissions('admin.config.manage')
  async putConfig(@Body() b: ConfigDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    const parsed = operationsConfigSchema.safeParse(b.value);
    if (!parsed.success) {
      const i = parsed.error.issues[0]!;
      throw AppError.validation(`${i.path.join('.')}: ${i.message}`, i.path.join('.'));
    }
    const row = await this.config.set(CONFIG_KEYS.OPERATIONS, parsed.data, b.reason, actor, meta);
    return { version: row.version, updatedAt: row.updatedAt.toISOString() };
  }

  /** The configured reason lists (English / Arabic labels) for the pickers on every operations screen. Not sensitive. */
  @Get('reasons')
  async reasons() {
    return (await opsConfig(this.config)).reasons;
  }

  @Get('config/history')
  @RequirePermissions('admin.config.read')
  async configHistory() {
    const rows = await this.prisma.auditLog.findMany({ where: { entityType: 'SystemConfiguration', entityId: CONFIG_KEYS.OPERATIONS }, orderBy: { occurredAt: 'desc' }, take: 50 });
    return rows.map((r) => ({ at: r.occurredAt.toISOString(), actorUserId: r.actorUserId, actorRole: r.actorRole, reason: r.reason, version: (r.newState as { version?: number } | null)?.version ?? null }));
  }

  // ---------------------------------------------------------------- financial adjustments
  @Get('adjustments')
  @RequirePermissions('admin.finance.read')
  listAdjustments(@CurrentActor() actor: Actor, @Query('status') status?: string, @Query('kind') kind?: string, @Query('caseId') caseId?: string) {
    return this.adjustments.list({ status, kind, caseId }, actor);
  }

  @Get('adjustments/:id')
  @RequirePermissions('admin.finance.read')
  getAdjustment(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.adjustments.get(id, actor);
  }

  @Post('adjustments')
  @Idempotent()
  requestAdjustment(@Body() b: AdjustmentDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    if (POINTS.includes(b.kind)) any(actor, 'admin.finance.manage', 'admin.rewards.request', 'admin.rewards.manage');
    else any(actor, 'admin.finance.manage', 'admin.settlements.manage');
    return this.adjustments.request(actor, b, meta);
  }

  @Post('adjustments/:id/decide')
  @Idempotent()
  @HttpCode(200)
  decideAdjustment(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecisionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.adjustments.decide(actor, id, b.decision === 'APPROVE', b.reason, meta);
  }

  @Post('adjustments/:id/retry')
  @Idempotent()
  @HttpCode(200)
  retryAdjustment(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.adjustments.retry(actor, id, meta);
  }

  // ---------------------------------------------------------------- settlement
  @Get('settlements')
  @RequirePermissions('admin.finance.read')
  listSettlements(@Query('status') status?: string, @Query('organizationId') organizationId?: string, @Query('market') market?: string, @Query('exceptions') exceptions?: string) {
    return this.settlements.list({ status, organizationId, market, exceptions: exceptions === 'true' });
  }

  @Get('settlements/:id')
  @RequirePermissions('admin.finance.read')
  getSettlement(@Param('id', ParseUUIDPipe) id: string) {
    return this.settlements.get(id);
  }

  @Post('settlements/run')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.settlements.manage')
  run(@Body() b: RunDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.settlements.run(actor, b, meta);
  }

  @Post('settlements/:id/hold')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.settlements.manage')
  hold(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.settlements.hold(actor, id, b.reason, meta);
  }

  @Post('settlements/:id/release')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.settlements.manage')
  release(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.settlements.release(actor, id, b.reason, meta);
  }

  @Post('settlements/:id/payout')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.settlements.manage')
  payout(@Param('id', ParseUUIDPipe) id: string, @Body() b: PayoutDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.settlements.payout(actor, id, b, meta);
  }

  @Post('settlements/:id/fail')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.settlements.manage')
  fail(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.settlements.fail(actor, id, b.reason, meta);
  }

  @Post('settlements/:id/reverse')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.settlements.manage')
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.settlements.reverse(actor, id, b.reason, meta);
  }

  // ---------------------------------------------------------------- reconciliation exceptions
  @Get('reconciliation/items')
  @RequirePermissions('admin.finance.read')
  reconItems(@Query('status') status?: string, @Query('source') source?: string, @Query('exceptions') exceptions?: string, @Query('runId') runId?: string) {
    return this.recon.list({ status, source, exceptions: exceptions === 'true', runId });
  }

  @Get('reconciliation/runs')
  @RequirePermissions('admin.finance.read')
  reconRuns() {
    return this.recon.runs();
  }

  @Post('reconciliation/statements')
  @Idempotent()
  @RequirePermissions('admin.reconciliation.manage')
  importStatement(@Body() b: StatementDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.recon.importStatement(actor, b, meta);
  }

  @Post('reconciliation/consistency')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.reconciliation.manage')
  consistency(@CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.recon.consistency(actor, meta);
  }

  @Post('reconciliation/items/:id/assign')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.reconciliation.manage')
  reconAssign(@Param('id', ParseUUIDPipe) id: string, @Body() b: AssignDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.recon.assign(actor, id, b.ownerUserId, meta);
  }

  @Post('reconciliation/items/:id/review')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.reconciliation.manage')
  reconReview(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.recon.review(actor, id, b.reason, meta);
  }

  @Post('reconciliation/items/:id/resolve')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.reconciliation.manage')
  reconResolve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ResolveDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.recon.resolve(actor, id, b, meta);
  }

  @Post('reconciliation/items/:id/case')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.reconciliation.manage')
  reconCase(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.recon.openCase(actor, id, meta);
  }

  // ---------------------------------------------------------------- fraud / risk operations
  @Get('risk/flags')
  @RequirePermissions('admin.risk.manage')
  riskFlags(@Query('status') status?: string, @Query('domain') domain?: string) {
    return this.risk.list({ status, domain });
  }

  @Get('risk/flags/:id')
  @RequirePermissions('admin.risk.manage')
  riskFlag(@Param('id', ParseUUIDPipe) id: string) {
    return this.risk.get(id);
  }

  @Post('risk/scan')
  @HttpCode(200)
  @RequirePermissions('admin.risk.manage')
  riskScan() {
    return this.risk.scan();
  }

  @Post('risk/flags/:id/decide')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.risk.manage')
  riskDecide(@Param('id', ParseUUIDPipe) id: string, @Body() b: RiskDecideDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    if (b.restriction) any(actor, 'admin.restrictions.manage');
    return this.risk.decide(actor, id, b, meta);
  }

  @Post('risk/flags/:id/case')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.risk.manage')
  riskCase(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.risk.openCase(actor, id, meta);
  }

  // ---------------------------------------------------------------- restrictions and holds
  @Get('restrictions')
  listRestrictions(@CurrentActor() actor: Actor, @Query('status') status?: string, @Query('kind') kind?: string, @Query('subjectId') subjectId?: string) {
    any(actor, 'admin.restrictions.manage', 'admin.restrictions.approve');
    return this.restrictions.list({ status, kind, subjectId }, actor);
  }

  @Post('restrictions')
  @Idempotent()
  @RequirePermissions('admin.restrictions.manage')
  requestRestriction(@Body() b: RestrictionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.restrictions.request(actor, b, meta);
  }

  @Post('restrictions/:id/decide')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.restrictions.approve')
  decideRestriction(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecisionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.restrictions.decide(actor, id, b.decision === 'APPROVE', b.reason, meta);
  }

  @Post('restrictions/:id/lift')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.restrictions.manage')
  liftRestriction(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.restrictions.lift(actor, id, b.reason, meta);
  }

  // ---------------------------------------------------------------- review and content moderation
  @Get('moderation')
  @RequirePermissions('admin.content.manage')
  moderation(@Query('status') status?: string, @Query('subjectType') subjectType?: string) {
    return this.reviews.queue({ status, subjectType });
  }

  @Post('moderation/:id/decide')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.content.manage')
  moderate(@Param('id', ParseUUIDPipe) id: string, @Body() b: ModerationDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.reviews.decide(actor, id, b, meta);
  }

  @Post('reviews/:id/remove')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.content.manage')
  removeReview(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReasonDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.reviews.removeReview(actor, id, b.reason, meta);
  }

  // ---------------------------------------------------------------- notification operations
  @Get('notifications')
  @RequirePermissions('admin.notifications.manage')
  async deliveries(@Query('status') status?: string, @Query('channel') channel?: string) {
    const rows = await this.prisma.notificationDelivery.findMany({ where: { ...(status ? { status } : {}), ...(channel ? { channel } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
    const counts = await this.prisma.notificationDelivery.groupBy({ by: ['status'], _count: { _all: true } });
    return {
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      items: rows.map((d) => ({ id: d.id, notificationId: d.notificationId, userId: d.userId, channel: d.channel, provider: d.provider, templateCode: d.templateCode, templateVersion: d.templateVersion, market: d.market, locale: d.locale, status: d.status, attempts: d.attempts, maxAttempts: d.maxAttempts, failureReason: d.failureReason, suppressedReason: d.suppressedReason, consentChecked: d.consentChecked, nextRetryAt: d.nextRetryAt?.toISOString() ?? null, lastAttemptAt: d.lastAttemptAt?.toISOString() ?? null, createdAt: d.createdAt.toISOString() })),
    };
  }

  @Post('notifications/:id/retry')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.notifications.manage')
  async retryDelivery(@Param('id', ParseUUIDPipe) id: string) {
    const d = await this.notifications.retryNow(id);
    return { id: d.id, status: d.status, attempts: d.attempts, failureReason: d.failureReason };
  }

  @Post('notifications/sweep')
  @HttpCode(200)
  @RequirePermissions('admin.notifications.manage')
  async sweepDeliveries() {
    return { tracked: await this.notifications.sweepUntracked(), retried: await this.notifications.retryDue() };
  }

  // ---------------------------------------------------------------- customer support and refunds
  @Get('customers/:id/summary')
  @RequirePermissions('admin.customers.read')
  customerSummary(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.summary(id);
  }

  @Get('support-requests')
  @RequirePermissions('admin.support.manage')
  supportRequests(@Query('status') status?: string, @Query('userId') userId?: string) {
    return this.support.supportRequests({ status, userId });
  }

  @Post('support-requests/:id/escalate')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.disputes.manage')
  escalate(@Param('id', ParseUUIDPipe) id: string, @Body() b: EscalateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.support.escalate(actor, id, b, meta);
  }

  @Get('refunds')
  refundQueue(@CurrentActor() actor: Actor, @Query('status') status?: string) {
    any(actor, 'admin.refunds.manage', 'admin.payments.read', 'admin.vouchers.lookup');
    return this.support.refundQueue({ status });
  }

  @Get('refunds/eligibility')
  refundEligibility(@CurrentActor() actor: Actor, @Query('instanceId') instanceId?: string, @Query('orderId') orderId?: string) {
    any(actor, 'admin.refunds.manage', 'admin.vouchers.lookup');
    return this.support.eligibility({ instanceId, orderId });
  }

  @Post('refunds/order')
  @Idempotent()
  @RequirePermissions('admin.refunds.manage')
  orderRefund(@Body() b: OrderRefundDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.support.orderRefund(actor, b, meta);
  }

  @Post('refunds/:id/case')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.refunds.manage')
  linkRefund(@Param('id', ParseUUIDPipe) id: string, @Body() b: LinkCaseDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.support.linkRefund(actor, id, b.caseId, meta);
  }

  // ---------------------------------------------------------------- privacy data requests
  @Get('data-requests')
  dataRequestList(@CurrentActor() actor: Actor, @Query('status') status?: string, @Query('customerUserId') customerUserId?: string) {
    any(actor, 'admin.privacy.manage', 'admin.privacy.approve');
    return this.dataRequests.list({ status, customerUserId });
  }

  @Post('data-requests')
  @Idempotent()
  @RequirePermissions('admin.privacy.manage')
  createDataRequest(@Body() b: DataRequestDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.dataRequests.create(actor, b, 'SUPPORT', meta);
  }

  @Post('data-requests/:id/decide')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.privacy.approve')
  decideDataRequest(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecisionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.dataRequests.decide(actor, id, b.decision === 'APPROVE', b.reason, meta);
  }
}

/** Merchant side: settlement statements (finance users) and the merchant's reviews (with reporting to DealDash). */
@ApiTags('merchant-ops')
@Controller('merchants/:orgId')
@Audiences('merchant')
export class MerchantOpsController {
  constructor(
    private readonly tenant: TenantService,
    private readonly settlements: SettlementService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get('settlements')
  @RequirePermissions('merchant.finance.read')
  list(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    return this.settlements.forMerchant(orgId);
  }

  @Get('settlements/:id')
  @RequirePermissions('merchant.finance.read')
  get(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    return this.settlements.get(id, orgId);
  }

  @Get('reviews')
  @RequirePermissions('merchant.insights.read')
  reviewsList(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    return this.reviews.listForMerchant(orgId, { all: true });
  }

  @Post('reviews/:id/report')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('merchant.insights.read')
  report(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: ReportDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    return this.reviews.report(actor, id, b, { type: 'MERCHANT', organizationId: orgId }, meta);
  }
}

/** Customer side: reviews (public reading, signed-in writing and reporting), content reports, own cases and data requests. */
@ApiTags('customer-ops')
@Controller('app')
@Audiences('customer')
export class CustomerOpsController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly dataRequests: DataRequestsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('merchants/:orgId/reviews')
  @Public()
  merchantReviews(@Param('orgId', ParseUUIDPipe) orgId: string, @OptionalActor() _actor?: Actor) {
    return this.reviews.listForMerchant(orgId);
  }

  @Post('merchants/:orgId/reviews')
  @Idempotent()
  @RequirePermissions('customer.reviews.manage')
  write(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() b: ReviewDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.reviews.create(actor, orgId, b, meta);
  }

  @Post('reviews/:id/report')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('customer.reviews.manage')
  report(@Param('id', ParseUUIDPipe) id: string, @Body() b: ReportDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.reviews.report(actor, id, b, { type: 'CUSTOMER' }, meta);
  }

  @Post('reports')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('customer.reviews.manage')
  reportContent(@Body() b: ContentReportDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.reviews.reportContent(actor, b, meta);
  }

  /** The customer's own cases: status, resolution and the notes DealDash shared (never internal notes or routing). */
  @Get('me/cases')
  @RequirePermissions('customer.profile.read')
  async myCases(@CurrentActor() actor: Actor) {
    const rows = await this.prisma.disputeCase.findMany({ where: { customerUserId: actor.userId, type: { not: 'FRAUD_REVIEW' } }, include: { notes: { where: { visibility: 'SHARED' }, orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((c) => ({ id: c.id, reference: c.reference, title: c.title, status: c.status, open: (CASE_OPEN_STATUSES as readonly string[]).includes(c.status), resolution: c.resolution, createdAt: c.createdAt.toISOString(), resolvedAt: c.resolvedAt?.toISOString() ?? null, notes: c.notes.filter((n) => n.authorOrganizationId === null).map((n) => ({ body: n.body, createdAt: n.createdAt.toISOString() })) }));
  }

  @Get('me/data-requests')
  @RequirePermissions('customer.profile.read')
  myDataRequests(@CurrentActor() actor: Actor) {
    return this.dataRequests.mine(actor.userId);
  }

  @Post('me/data-requests')
  @Idempotent()
  @RequirePermissions('customer.profile.write')
  requestData(@Body() b: MyDataRequestDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.dataRequests.create(actor, { customerUserId: actor.userId, type: b.type, reason: b.reason ?? null }, 'CUSTOMER', meta);
  }
}
