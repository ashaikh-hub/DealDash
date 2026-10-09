import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { DEFAULT_TARGET_THRESHOLDS, FORECAST_LABEL, TARGET_METRICS, type MetricKey, type TargetMetric, type TargetStatus } from '@dealdash/types';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AlertsService } from './alerts.service';
import { MetricsService, type MetricFilter } from './metrics.service';
import type { Access, VisProduct } from './reporting.service';
import { ReportingService } from './reporting.service';

type TargetRow = Prisma.CampaignTargetGetPayload<object>;

export interface TargetInput {
  name: string;
  metric: TargetMetric;
  product?: VisProduct | null;
  campaignId?: string | null;
  branchId?: string | null;
  legalEntityId?: string | null;
  targetValue: number;
  currency?: string | null;
  periodStart: string;
  periodEnd: string;
  thresholds?: number[];
}

/** Metrics that accumulate over time (counts, sums): expected-to-date grows with time and a run-rate forecast applies. Rates do not. */
const ACCUMULATING: Record<TargetMetric, boolean> = {
  IMPRESSIONS: true,
  QUALIFIED_VIEWS: true,
  REDEMPTIONS: true,
  VOUCHER_SALES: true,
  CUSTOMER_ACQUISITION: true,
  CONVERSION: false,
  CPVA: false,
  INVENTORY_UTILIZATION: false,
  REWARD_REDEMPTION: true,
  LOYALTY_UTILIZATION: true,
  BRANCH_PERFORMANCE: true,
  SPEND: true,
  SPONSOR_FUNDING_UTILIZATION: false,
};

/**
 * Targets: TARGET vs ACTUAL vs EXPECTED TO DATE vs FORECAST. A forecast is a run-rate ESTIMATE, labelled as such with its method and
 * confidence; it is never presented as a guaranteed result. Milestones (25 / 50 / 75 / 90 / 100 % or custom) raise one alert each.
 */
@Injectable()
export class TargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly reporting: ReportingService,
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
  ) {}

  async create(actor: Actor, a: Access, organizationId: string, b: TargetInput, meta: RequestMeta, source: 'MANUAL' | 'AI_DRAFT' = 'MANUAL') {
    const def = TARGET_METRICS[b.metric];
    if (!def) throw new AppError('TARGET_INVALID', 'Unknown target metric', 422);
    const start = new Date(b.periodStart);
    const end = new Date(b.periodEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) throw new AppError('TARGET_INVALID', 'The period must end after it starts', 422);
    if (!Number.isInteger(b.targetValue) || b.targetValue <= 0) throw new AppError('TARGET_INVALID', 'A target is a positive whole number', 422);
    if (b.metric === 'BRANCH_PERFORMANCE' && !b.branchId) throw new AppError('TARGET_INVALID', 'A branch target needs a branch', 422);
    if (b.campaignId) {
      if (!b.product) throw new AppError('TARGET_INVALID', 'A campaign target needs its product', 422);
      await this.reporting.assertCampaign(a, b.product, b.campaignId);
    }
    if (b.branchId) {
      const br = await this.prisma.merchantBranch.findFirst({ where: { id: b.branchId, organizationId } });
      if (!br) throw AppError.notFound();
      if (a.branchAllowList && !a.branchAllowList.has(b.branchId)) throw AppError.notFound();
    }
    if (b.legalEntityId && !(await this.prisma.legalEntity.count({ where: { id: b.legalEntityId, organizationId } }))) throw AppError.notFound();
    // scoped members can only target what they can see
    if (a.branchAllowList && !b.branchId && !b.campaignId) throw new AppError('SCOPE_FORBIDDEN', 'A business-wide target needs organization-wide access', 403);
    const thresholds = [...new Set((b.thresholds?.length ? b.thresholds : [...DEFAULT_TARGET_THRESHOLDS]).filter((t) => t >= 1 && t <= 1000))].sort((x, y) => x - y);
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.campaignTarget.create({
        data: {
          organizationId,
          name: b.name,
          metric: b.metric,
          product: b.product ?? null,
          campaignId: b.campaignId ?? null,
          branchId: b.branchId ?? null,
          legalEntityId: b.legalEntityId ?? null,
          targetValue: b.targetValue,
          unit: def.unit,
          currency: def.unit === 'MINOR' ? (b.currency ?? 'SAR') : null,
          direction: def.direction,
          periodStart: start,
          periodEnd: end,
          thresholds,
          source,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record({ action: 'TARGET_CREATED', entityType: 'CampaignTarget', entityId: t.id, actor, subjectOrganizationId: organizationId, newState: { metric: t.metric, target: t.targetValue, from: b.periodStart, to: b.periodEnd, source }, meta }, tx);
      return t;
    });
  }

  async archive(actor: Actor, organizationId: string, id: string, meta: RequestMeta) {
    const t = await this.prisma.campaignTarget.findUnique({ where: { id } });
    if (!t || t.organizationId !== organizationId) throw AppError.notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.campaignTarget.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await this.audit.record({ action: 'TARGET_ARCHIVED', entityType: 'CampaignTarget', entityId: id, actor, subjectOrganizationId: organizationId, meta }, tx);
    });
  }

  async list(a: Access, organizationId: string | null, now = new Date()) {
    const rows = await this.prisma.campaignTarget.findMany({ where: { ...(organizationId ? { organizationId } : {}), status: 'ACTIVE' }, orderBy: { periodEnd: 'asc' }, take: 200 });
    const visible = rows.filter((t) => (!a.branchAllowList || (t.branchId && a.branchAllowList.has(t.branchId)) || (t.campaignId && a.visibleCampaignIds?.includes(t.campaignId))));
    return Promise.all(visible.map((t) => this.progress(t, now)));
  }

  /** The actual value of a target's metric over [start, until). */
  async actual(t: TargetRow, until: Date): Promise<number | null> {
    const f: MetricFilter = {
      organizationIds: [t.organizationId],
      campaignIds: t.campaignId ? [t.campaignId] : null,
      branchIds: t.branchId ? [t.branchId] : null,
      legalEntityIds: t.legalEntityId ? [t.legalEntityId] : null,
      products: t.product ? [t.product] : null,
      from: t.periodStart,
      to: until,
    };
    const m = t.metric as TargetMetric;
    const sum = async (keys: MetricKey[]) => {
      const v = this.metrics.compute(keys, await this.metrics.raw(f, this.metrics.namesFor(keys)));
      return keys.reduce((n, k) => n + (v[k] ?? 0), 0);
    };
    const productKeys = (live: MetricKey, exclusive: MetricKey): MetricKey[] => (t.product === 'LIVE' ? [live] : t.product === 'EXCLUSIVE' ? [exclusive] : [live, exclusive]);
    switch (m) {
      case 'IMPRESSIONS': {
        const names = t.product === 'EXCLUSIVE' ? ['EXCLUSIVE_IMPRESSION'] : t.product === 'LIVE' ? ['LIVE_IMPRESSION'] : ['LIVE_IMPRESSION', 'EXCLUSIVE_IMPRESSION'];
        return (await this.metrics.raw(f, names)).reduce((n, r) => n + r.count, 0);
      }
      case 'QUALIFIED_VIEWS':
        return sum(['watch.qualified_views']);
      case 'REDEMPTIONS':
      case 'BRANCH_PERFORMANCE':
        return sum(t.product === 'VOUCHER' ? ['voucher.redeemed'] : t.product === 'EXCLUSIVE' ? ['exclusive.verified_redemptions'] : ['exclusive.verified_redemptions', 'voucher.redeemed']);
      case 'VOUCHER_SALES':
        return sum(['voucher.sales_value']);
      case 'CUSTOMER_ACQUISITION':
        return this.metrics.uniqueUsers(f, ['EXCLUSIVE_REDEMPTION_VERIFIED', 'VOUCHER_PAYMENT_SUCCEEDED', 'WATCH_QUALIFIED_VIEW']);
      case 'CONVERSION': {
        const outcomes = await sum(['exclusive.verified_redemptions', 'voucher.purchases']);
        const views = await sum([...productKeys('live.detail_views', 'exclusive.views'), 'voucher.views']);
        return views ? Math.round((outcomes * 10_000) / views) : null;
      }
      case 'CPVA': {
        const v = this.metrics.compute(['watch.cpva'], await this.metrics.raw(f, this.metrics.namesFor(['watch.cpva'])));
        return v['watch.cpva'] ?? null;
      }
      case 'INVENTORY_UTILIZATION': {
        const g = await this.metrics.gauges(['exclusive.merchant_benefit_utilization'], { organizationIds: [t.organizationId], campaignIds: t.campaignId ? [t.campaignId] : null });
        return g['exclusive.merchant_benefit_utilization'] ?? null;
      }
      case 'REWARD_REDEMPTION':
        return sum(['loyalty.rewards_allocated']);
      case 'LOYALTY_UTILIZATION':
        return sum(['loyalty.points_redeemed']);
      case 'SPEND':
        return sum(['watch.spend']);
      case 'SPONSOR_FUNDING_UTILIZATION': {
        const g = await this.metrics.gauges(['exclusive.sponsor_utilization'], { organizationIds: [t.organizationId], campaignIds: t.campaignId ? [t.campaignId] : null });
        return g['exclusive.sponsor_utilization'] ?? null;
      }
    }
    return null;
  }

  /** Target / actual / expected-to-date / forecast and status. */
  async progress(t: TargetRow, now = new Date()) {
    const metric = t.metric as TargetMetric;
    const total = t.periodEnd.getTime() - t.periodStart.getTime();
    const elapsed = Math.min(Math.max(0, now.getTime() - t.periodStart.getTime()), total);
    const elapsedBps = Math.round((elapsed * 10_000) / total);
    const until = now < t.periodEnd ? now : t.periodEnd;
    const actual = now <= t.periodStart ? 0 : await this.actual(t, until);
    const accumulating = ACCUMULATING[metric];
    const down = t.direction === 'DOWN';
    const expected = accumulating ? Math.round((t.targetValue * elapsedBps) / 10_000) : t.targetValue;
    const cfg = await this.config.get<{ forecastMinElapsedBps?: number }>(CONFIG_KEYS.VISIBILITY_ANALYTICS);
    const minElapsed = cfg?.forecastMinElapsedBps ?? 1000;
    let forecast: number | null = null;
    if (actual !== null && elapsedBps >= minElapsed) forecast = accumulating ? (elapsed > 0 ? Math.round((actual * total) / elapsed) : null) : actual;
    const confidence = elapsedBps < 2500 ? 'LOW' : elapsedBps < 6000 ? 'MEDIUM' : 'HIGH';
    const achievementBps = actual === null ? null : down ? (actual > 0 ? Math.round((t.targetValue * 10_000) / actual) : null) : Math.round((actual * 10_000) / t.targetValue);
    let status: TargetStatus;
    if (now < t.periodStart) status = 'NOT_STARTED';
    else if (actual === null) status = 'ON_TRACK';
    else if (down) status = actual <= t.targetValue ? 'ON_TRACK' : 'BEHIND';
    else if (actual >= t.targetValue) status = 'ACHIEVED';
    else if (now >= t.periodEnd) status = 'MISSED';
    else {
      const ratio = expected > 0 ? actual / expected : 1;
      status = ratio >= 1.1 ? 'AHEAD' : ratio >= 0.9 ? 'ON_TRACK' : ratio >= 0.7 ? 'AT_RISK' : 'BEHIND';
    }
    return {
      id: t.id,
      name: t.name,
      metric,
      unit: t.unit,
      currency: t.currency,
      direction: t.direction,
      product: t.product,
      campaignId: t.campaignId,
      branchId: t.branchId,
      legalEntityId: t.legalEntityId,
      periodStart: t.periodStart.toISOString(),
      periodEnd: t.periodEnd.toISOString(),
      thresholds: t.thresholds,
      source: t.source,
      target: t.targetValue,
      actual,
      expectedToDate: expected,
      elapsedBps,
      achievementBps,
      status,
      // a projection, never a promise
      forecast: { value: forecast, label: FORECAST_LABEL, method: accumulating ? 'RUN_RATE' : 'CURRENT_VALUE', confidence: forecast === null ? null : confidence },
    };
  }

  /** Milestone and behind-target alerts for every active target (one alert per milestone, once). */
  async evaluate(now = new Date()): Promise<number> {
    const rows = await this.prisma.campaignTarget.findMany({ where: { status: 'ACTIVE', periodStart: { lte: now }, periodEnd: { gt: new Date(now.getTime() - 86_400_000) } }, take: 500 });
    const behindBps = await this.alerts.threshold(null, 'CAMPAIGN_BEHIND_TARGET', 'behindTargetBps');
    let raised = 0;
    for (const t of rows) {
      const p = await this.progress(t, now);
      if (p.achievementBps !== null && t.direction !== 'DOWN') {
        const pct = Math.floor(p.achievementBps / 100);
        const crossed = t.thresholds.filter((x) => x > t.lastMilestone && x <= pct);
        if (crossed.length) {
          const top = Math.max(...crossed);
          const r = await this.alerts.raise({ code: 'TARGET_MILESTONE', organizationId: t.organizationId, subjectType: 'CampaignTarget', subjectId: t.id, campaignId: t.campaignId, branchId: t.branchId, product: t.product, legalEntityId: t.legalEntityId, variant: String(top), once: true, data: { targetName: t.name, metric: t.metric, milestone: top, actual: p.actual, target: t.targetValue } });
          await this.prisma.campaignTarget.updateMany({ where: { id: t.id, lastMilestone: { lt: top } }, data: { lastMilestone: top } });
          if (r?.created) raised++;
        }
      }
      // materially behind: actual below the configured share of what was expected by now (after a quarter of the period)
      if (p.elapsedBps >= 2500 && now < t.periodEnd && p.actual !== null && p.expectedToDate > 0 && t.direction !== 'DOWN' && (p.actual * 10_000) / p.expectedToDate < behindBps) {
        const r = await this.alerts.raise({ code: 'CAMPAIGN_BEHIND_TARGET', organizationId: t.organizationId, subjectType: 'CampaignTarget', subjectId: t.id, campaignId: t.campaignId, branchId: t.branchId, product: t.product, data: { targetName: t.name, metric: t.metric, actual: p.actual, expectedToDate: p.expectedToDate, forecast: p.forecast.value, forecastLabel: FORECAST_LABEL } });
        if (r?.created) raised++;
      }
    }
    return raised;
  }
}
