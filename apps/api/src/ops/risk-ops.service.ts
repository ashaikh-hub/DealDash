import { Injectable } from '@nestjs/common';
import type { OpsRiskRule, RestrictionKind, RiskDomain } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { DisputeService } from '../operations/dispute.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AlertsService } from '../visibility/alerts.service';
import { opsConfig } from './ops-util';
import { RestrictionsService } from './restrictions.service';

interface Hit {
  rule: OpsRiskRule;
  domain: RiskDomain;
  subject: string;
  count: number;
  subjectUserId?: string | null;
  subjectOrganizationId?: string | null;
  branchId?: string | null;
  detail: string;
}

const FAILED_RESULTS = ['INVALID_CODE', 'EXPIRED', 'ALREADY_REDEEMED', 'WRONG_BRANCH', 'INELIGIBLE', 'NOT_ACTIVE', 'CAMPAIGN_UNAVAILABLE', 'NOT_VALID_YET', 'VOUCHER_SUSPENDED', 'REFUNDED'];

/**
 * Fraud / risk operations beyond Watch & Earn (Stage 8). The MVP is rule based: each configured rule (threshold, window, decision
 * ALLOW / FLAG / BLOCK) turns a pattern in the operational records into a flag for a person to review: repeated code attempts,
 * suspicious redemptions, repeated refund attempts, suspicious branch activity, loyalty abuse, unusual customer activity, merchant
 * refund anomalies, duplicate qualified views. Nothing here punishes anyone: confirming a flag can REQUEST a restriction, which a
 * different person approves through the governed restriction workflow. AI may summarise and prioritise flags; it never decides.
 */
@Injectable()
export class RiskOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly alerts: AlertsService,
    private readonly disputes: DisputeService,
    private readonly restrictions: RestrictionsService,
  ) {}

  view(f: Prisma.RiskFlagGetPayload<object>) {
    return {
      id: f.id,
      domain: f.domain,
      ruleCode: f.ruleCode,
      decision: f.decision,
      severity: f.severity,
      status: f.status,
      signals: f.signals,
      subjectUserId: f.subjectUserId,
      subjectOrganizationId: f.subjectOrganizationId,
      branchId: f.branchId,
      market: f.market,
      caseId: f.caseId,
      outcome: f.outcome,
      reviewedByUserId: f.reviewedByUserId,
      reviewedAt: f.reviewedAt?.toISOString() ?? null,
      reviewReason: f.reviewReason,
      createdAt: f.createdAt.toISOString(),
    };
  }

  async list(f: { status?: string; domain?: string }) {
    const rows = await this.prisma.riskFlag.findMany({
      where: { domain: f.domain ? f.domain : { not: 'WATCH' }, ...(f.status ? { status: f.status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });
    return rows.map((r) => this.view(r));
  }

  async get(id: string) {
    const f = await this.prisma.riskFlag.findUnique({ where: { id } });
    if (!f || f.domain === 'WATCH') throw AppError.notFound();
    return this.view(f);
  }

  /** Runs every enabled rule over its window. Re-running never duplicates a flag (one per rule, subject and window). */
  async scan(now = new Date()) {
    const cfg = await opsConfig(this.config);
    const hits: Hit[] = [];
    const rule = (r: OpsRiskRule) => cfg.risk.rules[r];
    const since = (r: OpsRiskRule) => new Date(now.getTime() - (rule(r)?.windowMinutes ?? 60) * 60_000);
    const on = (r: OpsRiskRule) => !!rule(r)?.enabled;

    if (on('REPEATED_CODE_ATTEMPTS'))
      for (const g of await this.prisma.redemptionAttempt.groupBy({ by: ['staffUserId', 'organizationId'], where: { createdAt: { gte: since('REPEATED_CODE_ATTEMPTS') }, result: { in: FAILED_RESULTS as never } }, _count: { _all: true } }))
        if (g._count._all >= rule('REPEATED_CODE_ATTEMPTS')!.threshold)
          hits.push({ rule: 'REPEATED_CODE_ATTEMPTS', domain: 'REDEMPTION', subject: g.staffUserId, count: g._count._all, subjectUserId: g.staffUserId, subjectOrganizationId: g.organizationId, detail: `${g._count._all} refused code attempts by one staff member` });
    if (on('SUSPICIOUS_BRANCH_ACTIVITY'))
      for (const g of await this.prisma.redemptionAttempt.groupBy({ by: ['branchId', 'organizationId'], where: { createdAt: { gte: since('SUSPICIOUS_BRANCH_ACTIVITY') }, result: { in: FAILED_RESULTS as never }, branchId: { not: null } }, _count: { _all: true } }))
        if (g._count._all >= rule('SUSPICIOUS_BRANCH_ACTIVITY')!.threshold)
          hits.push({ rule: 'SUSPICIOUS_BRANCH_ACTIVITY', domain: 'BRANCH', subject: g.branchId!, count: g._count._all, subjectOrganizationId: g.organizationId, branchId: g.branchId, detail: `${g._count._all} refused attempts at one branch` });
    if (on('SUSPICIOUS_REDEMPTION')) {
      const w = since('SUSPICIOUS_REDEMPTION');
      const rev = [
        ...(await this.prisma.redemption.groupBy({ by: ['branchId', 'organizationId'], where: { status: 'REVERSED', reversedAt: { gte: w } }, _count: { _all: true } })),
        ...(await this.prisma.voucherRedemption.groupBy({ by: ['branchId', 'organizationId'], where: { status: 'REVERSED', reversedAt: { gte: w } }, _count: { _all: true } })),
      ];
      const byBranch = new Map<string, { org: string; n: number }>();
      for (const r of rev) byBranch.set(r.branchId, { org: r.organizationId, n: (byBranch.get(r.branchId)?.n ?? 0) + r._count._all });
      for (const [branchId, v] of byBranch)
        if (v.n >= rule('SUSPICIOUS_REDEMPTION')!.threshold)
          hits.push({ rule: 'SUSPICIOUS_REDEMPTION', domain: 'REDEMPTION', subject: branchId, count: v.n, subjectOrganizationId: v.org, branchId, detail: `${v.n} redemptions reversed at one branch` });
    }
    if (on('REPEATED_REFUND_ATTEMPTS')) {
      const rows = await this.prisma.refund.findMany({ where: { createdAt: { gte: since('REPEATED_REFUND_ATTEMPTS') }, kind: 'CUSTOMER_REQUEST' }, select: { order: { select: { userId: true } } }, take: 5000 });
      const by = new Map<string, number>();
      for (const r of rows) by.set(r.order.userId, (by.get(r.order.userId) ?? 0) + 1);
      for (const [userId, n] of by)
        if (n >= rule('REPEATED_REFUND_ATTEMPTS')!.threshold) hits.push({ rule: 'REPEATED_REFUND_ATTEMPTS', domain: 'REFUND', subject: userId, count: n, subjectUserId: userId, detail: `${n} refund requests` });
    }
    if (on('MERCHANT_REFUND_ANOMALY'))
      for (const g of await this.prisma.refund.groupBy({ by: ['organizationId'], where: { createdAt: { gte: since('MERCHANT_REFUND_ANOMALY') } }, _count: { _all: true } }))
        if (g._count._all >= rule('MERCHANT_REFUND_ANOMALY')!.threshold)
          hits.push({ rule: 'MERCHANT_REFUND_ANOMALY', domain: 'MERCHANT', subject: g.organizationId, count: g._count._all, subjectOrganizationId: g.organizationId, detail: `${g._count._all} refunds for one merchant` });
    if (on('LOYALTY_ABUSE'))
      for (const g of await this.prisma.rewardEntry.groupBy({ by: ['accountId'], where: { createdAt: { gte: since('LOYALTY_ABUSE') }, ruleId: { not: null }, type: { in: ['EARN', 'BONUS'] } }, _count: { _all: true } }))
        if (g._count._all >= rule('LOYALTY_ABUSE')!.threshold) {
          const acc = await this.prisma.rewardAccount.findUnique({ where: { id: g.accountId }, select: { userId: true } });
          if (acc) hits.push({ rule: 'LOYALTY_ABUSE', domain: 'LOYALTY', subject: acc.userId, count: g._count._all, subjectUserId: acc.userId, detail: `${g._count._all} loyalty awards` });
        }
    if (on('UNUSUAL_CUSTOMER_ACTIVITY'))
      for (const g of await this.prisma.reservation.groupBy({ by: ['userId'], where: { createdAt: { gte: since('UNUSUAL_CUSTOMER_ACTIVITY') }, status: { in: ['CANCELLED', 'EXPIRED'] } }, _count: { _all: true } }))
        if (g._count._all >= rule('UNUSUAL_CUSTOMER_ACTIVITY')!.threshold)
          hits.push({ rule: 'UNUSUAL_CUSTOMER_ACTIVITY', domain: 'CUSTOMER', subject: g.userId, count: g._count._all, subjectUserId: g.userId, detail: `${g._count._all} reservations cancelled or not used` });
    if (on('DUPLICATE_QUALIFIED_VIEWS'))
      for (const g of await this.prisma.watchView.groupBy({ by: ['userId', 'campaignId'], where: { status: 'QUALIFIED', qualifiedAt: { gte: since('DUPLICATE_QUALIFIED_VIEWS') } }, _count: { _all: true } }))
        if (g._count._all >= rule('DUPLICATE_QUALIFIED_VIEWS')!.threshold)
          hits.push({ rule: 'DUPLICATE_QUALIFIED_VIEWS', domain: 'CUSTOMER', subject: `${g.userId}:${g.campaignId}`, count: g._count._all, subjectUserId: g.userId, detail: `${g._count._all} qualified views of one campaign` });

    let created = 0;
    for (const h of hits) {
      const r = rule(h.rule)!;
      if (r.decision === 'ALLOW') continue;
      const bucket = Math.floor(now.getTime() / (r.windowMinutes * 60_000));
      const dedupeKey = `ops:${h.rule}:${h.subject}:${bucket}`;
      const market = h.branchId ? ((await this.prisma.merchantBranch.findUnique({ where: { id: h.branchId }, select: { country: true } }))?.country ?? null) : null;
      try {
        const f = await this.prisma.riskFlag.create({
          data: { domain: h.domain, ruleCode: h.rule, decision: r.decision, severity: Math.min(100, Math.round((h.count / r.threshold) * 50)), signals: [{ code: h.rule, weight: h.count, detail: h.detail }] as Prisma.InputJsonValue, subjectUserId: h.subjectUserId ?? null, subjectOrganizationId: h.subjectOrganizationId ?? null, branchId: h.branchId ?? null, market, dedupeKey },
        });
        created++;
        await this.audit.record({ action: 'RISK_FLAG_RAISED', entityType: 'RiskFlag', entityId: f.id, actorRole: 'SYSTEM', subjectOrganizationId: f.subjectOrganizationId, newState: { rule: h.rule, decision: r.decision, count: h.count }, market });
        await this.alerts.raise({ code: 'FRAUD_FLAG_RAISED', organizationId: null, subjectType: 'RiskFlag', subjectId: f.id, branchId: h.branchId ?? null, country: market, once: true, data: { rule: h.rule, count: h.count } }).catch(() => null);
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    return { hits: hits.length, created };
  }

  /**
   * A person decides a flag: CLEAR (no issue) or CONFIRM. Confirming may REQUEST a restriction; it only takes effect when a different
   * person approves it in the restriction workflow (no silent punishment).
   */
  async decide(actor: Actor, id: string, b: { outcome: 'CLEAR' | 'CONFIRM'; reason: string; restriction?: { kind: RestrictionKind; days?: number; reasonCode: string } | null }, meta: RequestMeta) {
    const f = await this.prisma.riskFlag.findUnique({ where: { id } });
    if (!f || f.domain === 'WATCH') throw AppError.notFound();
    if (f.status === 'DECIDED') throw new AppError('INVALID_STATE', 'This flag has already been decided', 409);
    const claim = await this.prisma.riskFlag.updateMany({ where: { id, status: { not: 'DECIDED' } }, data: { status: 'DECIDED', outcome: b.outcome, reviewedByUserId: actor.userId, reviewedAt: new Date(), reviewReason: b.reason } });
    if (claim.count !== 1) throw new AppError('VERSION_CONFLICT', 'The flag was decided already', 409);
    await this.audit.record({ action: 'RISK_FLAG_DECIDED', entityType: 'RiskFlag', entityId: id, actor, subjectOrganizationId: f.subjectOrganizationId, reason: b.reason, previousState: { status: f.status }, newState: { outcome: b.outcome }, market: f.market, meta });
    let restriction = null;
    if (b.outcome === 'CONFIRM' && b.restriction) {
      const subjectId = b.restriction.kind === 'BRANCH_REDEMPTION_HOLD' ? f.branchId : b.restriction.kind === 'MERCHANT_CAMPAIGN_HOLD' || b.restriction.kind === 'FINANCIAL_HOLD' ? f.subjectOrganizationId : f.subjectUserId;
      if (!subjectId) throw AppError.validation('This flag has no subject for that restriction', 'restriction');
      restriction = await this.restrictions.request(actor, { kind: b.restriction.kind, subjectId, reasonCode: b.restriction.reasonCode, reason: b.reason, days: b.restriction.days ?? null, riskFlagId: id, caseId: f.caseId }, meta);
    }
    return { flag: await this.get(id), restriction };
  }

  /** Opens a FRAUD_REVIEW case for a flag that needs an investigation with other teams. */
  async openCase(actor: Actor, id: string, meta: RequestMeta) {
    const f = await this.prisma.riskFlag.findUnique({ where: { id } });
    if (!f || f.domain === 'WATCH') throw AppError.notFound();
    if (f.caseId) return this.disputes.get(f.caseId);
    const c = await this.disputes.open(actor, null, { type: 'FRAUD_REVIEW', title: `Risk flag ${f.ruleCode ?? f.domain}`, priority: f.decision === 'BLOCK' ? 'HIGH' : 'NORMAL', targetOrganizationId: f.subjectOrganizationId, customerUserId: f.subjectUserId, relatedType: 'RiskFlag', relatedId: f.id, sourceEvent: 'RISK_FLAG', sourceEventId: f.id, market: f.market }, meta);
    await this.prisma.riskFlag.update({ where: { id }, data: { caseId: c.id, status: f.status === 'OPEN' ? 'IN_REVIEW' : f.status } });
    return c;
  }
}
