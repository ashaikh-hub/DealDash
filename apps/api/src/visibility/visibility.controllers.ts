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
import type {
  AlertChannel,
  AlertCode,
  AlertFrequency,
  MetricKey,
  PermissionCode,
  ReportDimension,
  TargetMetric,
} from '@dealdash/types';
import {
  alertListQuerySchema,
  alertRuleSchema,
  notificationPreferenceSchema,
  periodQuerySchema,
  reportQuerySchema,
  targetCreateSchema,
  timelineQuerySchema,
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
import { AlertsService, type RuleInput } from './alerts.service';
import { AnalyticsProjector } from './analytics-projector.service';
import { EarlyWarningService } from './early-warning.service';
import { MetricsService } from './metrics.service';
import { OperationsCentreService } from './operations-centre.service';
import { ReportingService, VIS_PRODUCTS, type VisProduct } from './reporting.service';
import { TargetsService, type TargetInput } from './targets.service';

class PeriodDto extends createZodDto(periodQuerySchema) {}
class ReportDto extends createZodDto(reportQuerySchema) {}
class TargetDto extends createZodDto(targetCreateSchema) {}
class RuleDto extends createZodDto(alertRuleSchema) {}
class PrefDto extends createZodDto(notificationPreferenceSchema) {}
class AlertQueryDto extends createZodDto(alertListQuerySchema) {}
class TimelineDto extends createZodDto(timelineQuerySchema) {}

const period = (q: { from?: string; to?: string }) => {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
  return { from, to };
};
const productOf = (p: string): VisProduct => {
  if (!(VIS_PRODUCTS as readonly string[]).includes(p)) throw AppError.notFound();
  return p as VisProduct;
};

/** The business's own performance, targets and alerts. Every query is checked against tenant, role, scope and entitlement. */
@ApiTags('performance')
@Controller('orgs/:orgId')
@Audiences('merchant', 'partner')
export class OrgVisibilityController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly targets: TargetsService,
    private readonly alerts: AlertsService,
    private readonly ops: OperationsCentreService,
  ) {}

  private perm(actor: Actor, kind: 'targets' | 'alerts' | 'performance'): PermissionCode {
    const partner = actor.membership?.organizationType === 'PARTNER';
    const code =
      `${partner ? 'partner' : 'merchant'}.${kind === 'performance' ? 'performance.read' : `${kind}.manage`}` as PermissionCode;
    if (!actor.permissions.has(code)) throw AppError.forbidden();
    return code;
  }

  @Get('performance/overview')
  async overview(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: PeriodDto,
    @CurrentActor() actor: Actor,
  ) {
    const a = await this.reporting.resolve(actor, orgId);
    const p = period(q);
    return this.reporting.overview(a, p.from, p.to);
  }

  @Get('performance/report')
  async report(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: ReportDto,
    @CurrentActor() actor: Actor,
  ) {
    const a = await this.reporting.resolve(actor, orgId);
    const p = period(q);
    return this.reporting.report(a, {
      groupBy: q.groupBy as ReportDimension,
      metrics: q.metrics as MetricKey[],
      from: p.from,
      to: p.to,
      product: q.product,
      campaignId: q.campaignId,
      branchId: q.branchId,
      legalEntityId: q.legalEntityId,
      country: q.country,
    });
  }

  @Get('performance/campaigns/:product/:campaignId')
  async campaign(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('product') product: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query() q: PeriodDto,
    @CurrentActor() actor: Actor,
  ) {
    const a = await this.reporting.resolve(actor, orgId);
    const p = period(q);
    return this.reporting.campaignPerformance(a, productOf(product), campaignId, p.from, p.to);
  }

  @Get('targets')
  async listTargets(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    const a = await this.reporting.resolve(actor, orgId);
    return this.targets.list(a, orgId);
  }

  @Post('targets')
  @Idempotent()
  async createTarget(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: TargetDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const a = await this.reporting.resolve(actor, orgId);
    this.perm(actor, 'targets');
    const t = await this.targets.create(
      actor,
      a,
      orgId,
      b as unknown as TargetInput & { metric: TargetMetric },
      meta,
    );
    return this.targets.progress(t);
  }

  @Post('targets/:id/archive')
  @Idempotent()
  @HttpCode(200)
  async archiveTarget(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.reporting.resolve(actor, orgId);
    this.perm(actor, 'targets');
    await this.targets.archive(actor, orgId, id, meta);
    return { ok: true as const };
  }

  @Get('alerts')
  async listAlerts(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() q: AlertQueryDto,
    @CurrentActor() actor: Actor,
  ) {
    const a = await this.reporting.resolve(actor, orgId);
    const rows = await this.alerts.list({
      organizationId: orgId,
      status: q.status,
      category: q.category,
    });
    // a scoped member sees alerts about the branches / campaigns they can see, and organization-wide ones only with an org-wide grant
    const visible = a.branchAllowList
      ? rows.filter(
          (r) =>
            (r.branchId && a.branchAllowList!.has(r.branchId)) ||
            (r.campaignId && a.visibleCampaignIds?.includes(r.campaignId)),
        )
      : rows;
    return visible.map((r) => ({
      ...r,
      actionAllowed: r.actionPermission
        ? actor.permissions.has(r.actionPermission as PermissionCode)
        : false,
    }));
  }

  @Post('alerts/:id/:action')
  @Idempotent()
  @HttpCode(200)
  async actOnAlert(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.reporting.resolve(actor, orgId);
    if (action !== 'acknowledge' && action !== 'resolve') throw AppError.notFound();
    return this.alerts.setStatus(
      actor,
      id,
      orgId,
      action === 'acknowledge' ? 'ACKNOWLEDGED' : 'RESOLVED',
      meta,
    );
  }

  @Get('alert-rules')
  async rules(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.reporting.resolve(actor, orgId);
    return this.alerts.listRules(orgId);
  }

  @Post('alert-rules')
  @Idempotent()
  async createRule(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: RuleDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const a = await this.reporting.resolve(actor, orgId);
    this.perm(actor, 'alerts');
    if (a.branchAllowList)
      throw new AppError('SCOPE_FORBIDDEN', 'Alert rules need organization-wide access', 403);
    return this.alerts.createRule(actor, orgId, b as unknown as RuleInput, meta);
  }

  @Put('alert-rules/:id')
  async updateRule(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: RuleDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    const a = await this.reporting.resolve(actor, orgId);
    this.perm(actor, 'alerts');
    if (a.branchAllowList)
      throw new AppError('SCOPE_FORBIDDEN', 'Alert rules need organization-wide access', 403);
    return this.alerts.updateRule(actor, orgId, id, b as unknown as RuleInput, meta);
  }

  @Get('integration-health')
  async integrations(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.reporting.resolve(actor, orgId);
    return this.ops.integrationHealth(new Date(), orgId);
  }
}

/** A person's own notification preferences (any business or DealDash user). */
@ApiTags('notification-preferences')
@Controller('me/notification-preferences')
@Audiences('merchant', 'partner', 'admin')
export class NotificationPreferenceController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.alerts.preferences(actor.userId);
  }

  @Put()
  set(@Body() b: PrefDto, @CurrentActor() actor: Actor) {
    return this.alerts.setPreference(
      actor.userId,
      b as {
        category: string;
        channels: AlertChannel[];
        frequency: AlertFrequency;
        muted: boolean;
      },
    );
  }
}

/** DealDash: performance across businesses, platform alert rules, the Command Centre, integration / platform health, support timeline. */
@ApiTags('admin-visibility')
@Controller('admin/visibility')
@Audiences('admin')
export class AdminVisibilityController {
  constructor(
    private readonly reporting: ReportingService,
    private readonly metrics: MetricsService,
    private readonly projector: AnalyticsProjector,
    private readonly targets: TargetsService,
    private readonly alerts: AlertsService,
    private readonly warnings: EarlyWarningService,
    private readonly ops: OperationsCentreService,
  ) {}

  @Get('overview')
  @RequirePermissions('admin.analytics.read')
  async overview(
    @Query() q: PeriodDto & { organizationId?: string },
    @CurrentActor() actor: Actor,
  ) {
    const a = await this.reporting.resolve(actor, q.organizationId ?? null);
    const p = period(q);
    return this.reporting.overview(a, p.from, p.to);
  }

  @Get('report')
  @RequirePermissions('admin.analytics.read')
  async report(@Query() q: ReportDto, @CurrentActor() actor: Actor) {
    const a = await this.reporting.resolve(actor, q.organizationId ?? null);
    const p = period(q);
    return this.reporting.report(a, {
      groupBy: q.groupBy as ReportDimension,
      metrics: q.metrics as MetricKey[],
      from: p.from,
      to: p.to,
      product: q.product,
      campaignId: q.campaignId,
      branchId: q.branchId,
      legalEntityId: q.legalEntityId,
      country: q.country,
    });
  }

  @Get('campaigns/:product/:campaignId')
  @RequirePermissions('admin.analytics.read')
  async campaign(
    @Param('product') product: string,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query() q: PeriodDto,
    @CurrentActor() actor: Actor,
  ) {
    const a = await this.reporting.resolve(actor, null);
    const p = period(q);
    return this.reporting.campaignPerformance(a, productOf(product), campaignId, p.from, p.to);
  }

  /** Brings the analytics up to date now (the same pass runs every minute in the background). */
  @Post('refresh')
  @HttpCode(200)
  @RequirePermissions('admin.analytics.read')
  async refresh() {
    const events = await this.projector.project();
    const buckets = await this.metrics.aggregate();
    return { events, buckets, asOf: await this.metrics.asOf() };
  }

  @Get('targets')
  @RequirePermissions('admin.analytics.read')
  async targetsList(
    @Query('organizationId') organizationId: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    const a = await this.reporting.resolve(actor, organizationId ?? null);
    return this.targets.list(a, organizationId ?? null);
  }

  @Get('alerts')
  @RequirePermissions('admin.operations.read')
  alertsList(@Query() q: AlertQueryDto) {
    return this.alerts.list({
      organizationId: q.organizationId ?? null,
      platform: q.platform !== 'false',
      status: q.status,
      category: q.category,
    });
  }

  @Post('alerts/evaluate')
  @HttpCode(200)
  @RequirePermissions('admin.alerts.manage')
  async evaluate() {
    const signals = await this.alerts.consumeSignals();
    const targets = await this.targets.evaluate();
    const warnings = await this.warnings.run();
    const escalated = await this.alerts.escalate();
    return { signals, targets, warnings, escalated };
  }

  @Post('alerts/:id/:action')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.alerts.manage')
  actOnAlert(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('action') action: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    if (action !== 'acknowledge' && action !== 'resolve') throw AppError.notFound();
    return this.alerts.setStatus(
      actor,
      id,
      null,
      action === 'acknowledge' ? 'ACKNOWLEDGED' : 'RESOLVED',
      meta,
    );
  }

  @Get('alert-rules')
  @RequirePermissions('admin.operations.read')
  rules() {
    return this.alerts.listRules(null);
  }

  @Post('alert-rules')
  @Idempotent()
  @RequirePermissions('admin.alerts.manage')
  createRule(@Body() b: RuleDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.alerts.createRule(
      actor,
      null,
      b as unknown as RuleInput & { code: AlertCode },
      meta,
    );
  }

  @Put('alert-rules/:id')
  @RequirePermissions('admin.alerts.manage')
  updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: RuleDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.alerts.updateRule(actor, null, id, b as unknown as RuleInput, meta);
  }

  @Get('command-centre')
  @RequirePermissions('admin.operations.read')
  commandCentre() {
    return this.ops.commandCentre();
  }

  @Get('integrations')
  @RequirePermissions('admin.operations.read')
  integrations() {
    return this.ops.integrationHealth(new Date());
  }

  @Get('platform-health')
  @RequirePermissions('admin.operations.read')
  platform() {
    return this.ops.platformHealth(new Date());
  }

  @Get('customers')
  @RequirePermissions('admin.customers.read')
  customers(@Query('q') q: string) {
    return this.ops.findCustomers(q ?? '');
  }

  @Get('customers/:userId/timeline')
  @RequirePermissions('admin.customers.read')
  timeline(@Param('userId', ParseUUIDPipe) userId: string, @Query() q: TimelineDto) {
    return this.ops.customerTimeline(userId, {
      kinds: q.kinds,
      before: q.before ? new Date(q.before) : undefined,
      take: q.take,
    });
  }
}
