import { Injectable } from '@nestjs/common';
import { CASE_OPEN_STATUSES, RECON_EXCEPTION_STATUSES, type OpsExceptionArea } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { D } from './ops-util';

export interface DrillFilter {
  market?: string;
  legalEntityId?: string;
  organizationId?: string;
  brandId?: string;
  city?: string;
  branchId?: string;
  product?: string;
  campaignId?: string;
}

const FAILED_RESULTS = ['INVALID_CODE', 'EXPIRED', 'ALREADY_REDEEMED', 'WRONG_BRANCH', 'INELIGIBLE', 'NOT_ACTIVE', 'CAMPAIGN_UNAVAILABLE', 'NOT_VALID_YET', 'VOUCHER_SUSPENDED', 'REFUNDED'];

/**
 * Operational exceptions and reporting (Stage 8): aggregate reads over the existing operational records and the Phase 4 alert / task
 * data (no second analytics engine). The Command Centre exception panel drills from global to market, legal entity, business
 * account, brand, city, branch, product and campaign; transaction-level detail is the item lists (cases, reconciliation items,
 * refunds) behind each number, under their own permissions.
 */
@Injectable()
export class OpsReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The organizations (and branches) a drill filter narrows to; null = no narrowing. */
  private async scope(f: DrillFilter): Promise<{ orgs: string[] | null; branches: string[] | null }> {
    let orgs: string[] | null = null;
    let branches: string[] | null = null;
    const narrow = (ids: string[]) => {
      orgs = orgs === null ? ids : orgs.filter((x) => ids.includes(x));
    };
    if (f.organizationId) narrow([f.organizationId]);
    if (f.legalEntityId) narrow((await this.prisma.legalEntity.findMany({ where: { id: f.legalEntityId }, select: { organizationId: true } })).map((l) => l.organizationId));
    if (f.brandId) narrow((await this.prisma.masterMerchant.findMany({ where: { brandId: f.brandId, organizationId: { not: null } }, select: { organizationId: true } })).map((m) => m.organizationId!));
    if (f.market) {
      const viaBranch = await this.prisma.merchantBranch.findMany({ where: { country: f.market }, distinct: ['organizationId'], select: { organizationId: true } });
      const viaLe = await this.prisma.legalEntity.findMany({ where: { country: f.market }, select: { organizationId: true } });
      narrow([...new Set([...viaBranch, ...viaLe].map((x) => x.organizationId))]);
    }
    if (f.city || f.branchId) {
      const bs = await this.prisma.merchantBranch.findMany({ where: { ...(f.city ? { city: f.city } : {}), ...(f.branchId ? { id: f.branchId } : {}) }, select: { id: true, organizationId: true } });
      branches = bs.map((b) => b.id);
      narrow([...new Set(bs.map((b) => b.organizationId))]);
    }
    return { orgs, branches };
  }

  /** The Command Centre exception panel. */
  async exceptions(f: DrillFilter = {}, now = new Date()) {
    const { orgs, branches } = await this.scope(f);
    const inOrg = <T extends string>(field: T) => (orgs ? ({ [field]: { in: orgs } } as Record<T, { in: string[] }>) : {});
    const day = new Date(now.getTime() - D);
    const week = new Date(now.getTime() - 7 * D);
    const caseWhere = (types?: string[]): Prisma.DisputeCaseWhereInput => ({
      status: { in: [...CASE_OPEN_STATUSES] },
      ...(types ? { type: { in: types } } : {}),
      ...inOrg('organizationId'),
      ...(f.market ? { OR: [{ market: f.market }, { market: null, organizationId: orgs ? { in: orgs } : undefined }] } : {}),
      ...(f.product ? { product: f.product } : {}),
      ...(f.campaignId ? { relatedId: f.campaignId } : {}),
    });
    const cases = (types?: string[]) => this.prisma.disputeCase.count({ where: caseWhere(types) });
    const branchFilter = branches ? { branchId: { in: branches } } : {};
    const values: Record<OpsExceptionArea, number> = {
      PAYMENT_ISSUES: (await this.prisma.payment.count({ where: { status: 'FAILED', updatedAt: { gte: day }, order: { ...inOrg('organizationId'), ...(f.campaignId ? { voucherId: f.campaignId } : {}) } } })) + (await cases(['PAYMENT_EXCEPTION'])),
      REDEMPTION_FAILURES: await this.prisma.redemptionAttempt.count({ where: { createdAt: { gte: day }, result: { in: FAILED_RESULTS as never }, ...inOrg('organizationId'), ...branchFilter } }),
      VOUCHER_EXCEPTIONS: (await cases(['VOUCHER_EXCEPTION', 'INVALID_VOUCHER_REDEMPTION'])) + (await this.prisma.refund.count({ where: { status: 'FAILED', ...inOrg('organizationId') } })),
      WATCH_EXCEPTIONS: (await cases(['WATCH_EARN_EXCEPTION', 'REWARD_REFUSED'])) + (await this.prisma.riskFlag.count({ where: { domain: 'WATCH', status: { in: ['OPEN', 'IN_REVIEW'] }, ...(f.campaignId ? { campaignId: f.campaignId } : {}) } })),
      LOYALTY_EXCEPTIONS: (await cases(['LOYALTY_EXCEPTION'])) + (await this.prisma.rewardAdjustment.count({ where: { status: 'PENDING' } })) + (await this.prisma.reconciliationItem.count({ where: { source: 'LOYALTY_FUNDING', status: { in: [...RECON_EXCEPTION_STATUSES] } } })),
      IMPORT_FAILURES: await this.prisma.importJob.count({ where: { status: { in: ['FAILED', 'REJECTED'] }, updatedAt: { gte: week }, ...inOrg('organizationId') } }),
      INTEGRATION_FAILURES: (await this.prisma.failedRecord.count({ where: { status: 'OPEN', connection: inOrg('organizationId') } })) + (await this.prisma.syncJob.count({ where: { status: 'FAILED', startedAt: { gte: day }, connection: inOrg('organizationId') } })) + (await cases(['INTEGRATION_EXCEPTION'])),
      SETTLEMENT_EXCEPTIONS: (await this.prisma.settlement.count({ where: { status: { in: ['HELD', 'DISPUTE_HOLD', 'FAILED'] }, ...inOrg('organizationId'), ...(f.market ? { market: f.market } : {}) } })) + (await cases(['SETTLEMENT_EXCEPTION', 'SETTLEMENT_MISMATCH'])),
      RECONCILIATION_EXCEPTIONS: await this.prisma.reconciliationItem.count({ where: { status: { in: [...RECON_EXCEPTION_STATUSES] }, ...inOrg('organizationId') } }),
      DISPUTES: await cases(),
      FRAUD_FLAGS: await this.prisma.riskFlag.count({ where: { domain: { not: 'WATCH' }, status: { in: ['OPEN', 'IN_REVIEW'] }, ...inOrg('subjectOrganizationId'), ...branchFilter } }),
      OVERDUE_TASKS: (await this.prisma.disputeCase.count({ where: { ...caseWhere(), slaDueAt: { lt: now } } })) + (await this.prisma.approvalTask.count({ where: { status: 'OPEN', dueAt: { lt: now }, ...inOrg('organizationId') } })),
      APPROVAL_BACKLOG:
        (await this.prisma.adjustmentRequest.count({ where: { status: 'PENDING_APPROVAL', ...inOrg('organizationId') } })) +
        (await this.prisma.operationalRestriction.count({ where: { status: 'PENDING_APPROVAL', ...inOrg('organizationId') } })) +
        (await this.prisma.refund.count({ where: { status: { in: ['REQUESTED', 'UNDER_REVIEW'] }, ...inOrg('organizationId') } })) +
        (await this.prisma.disputeCase.count({ where: { ...caseWhere(), status: 'AWAITING_APPROVAL' } })) +
        (orgs ? 0 : await this.prisma.dataRequest.count({ where: { status: 'PENDING_APPROVAL' } })),
      NOTIFICATION_FAILURES: (await this.prisma.notificationDelivery.count({ where: { status: 'FAILED' } })) + (await this.prisma.alertDelivery.count({ where: { status: 'FAILED', createdAt: { gte: day } } })),
      UNRESOLVED_SUPPORT: (orgs ? 0 : await this.prisma.supportCase.count({ where: { status: { not: 'RESOLVED' } } })) + (await cases(['CUSTOMER_COMPLAINT'])),
    };
    // market health: open cases and holds per market
    const byMarket = await this.prisma.disputeCase.groupBy({ by: ['market'], where: { status: { in: [...CASE_OPEN_STATUSES] } }, _count: { _all: true } });
    const breached = await this.prisma.disputeCase.groupBy({ by: ['market'], where: { status: { in: [...CASE_OPEN_STATUSES] }, slaDueAt: { lt: now } }, _count: { _all: true } });
    // the businesses with the most open exceptions (next drill level)
    const topOrgs = await this.prisma.disputeCase.groupBy({ by: ['organizationId'], where: { ...caseWhere(), organizationId: { not: null } }, _count: { _all: true }, orderBy: { _count: { organizationId: 'desc' } }, take: 10 });
    const names = new Map((await this.prisma.organization.findMany({ where: { id: { in: topOrgs.map((t) => t.organizationId!) } }, select: { id: true, nameEn: true, nameAr: true } })).map((o) => [o.id, o]));
    return {
      generatedAt: now.toISOString(),
      filter: f,
      values,
      markets: byMarket.map((m) => ({ market: m.market, openCases: m._count._all, breached: breached.find((b) => b.market === m.market)?._count._all ?? 0 })),
      businesses: topOrgs.map((t) => ({ organizationId: t.organizationId, nameEn: names.get(t.organizationId!)?.nameEn ?? null, nameAr: names.get(t.organizationId!)?.nameAr ?? null, openCases: t._count._all })),
    };
  }

  /** Operational reports for a period (aggregates only; no customer-level data). */
  async report(days = 30, now = new Date()) {
    const since = new Date(now.getTime() - days * D);
    const age = (d: Date) => (now.getTime() - d.getTime()) / D;
    const open = await this.prisma.disputeCase.findMany({ where: { status: { in: [...CASE_OPEN_STATUSES] } }, select: { type: true, status: true, createdAt: true, slaDueAt: true }, take: 5000 });
    const aging = { lt1d: 0, d1to3: 0, d3to7: 0, gt7d: 0 };
    for (const c of open) {
      const a = age(c.createdAt);
      if (a < 1) aging.lt1d++;
      else if (a < 3) aging.d1to3++;
      else if (a < 7) aging.d3to7++;
      else aging.gt7d++;
    }
    const group = <T,>(rows: T[], key: (r: T) => string) => {
      const m: Record<string, number> = {};
      for (const r of rows) m[key(r)] = (m[key(r)] ?? 0) + 1;
      return m;
    };
    const refunds = await this.prisma.refund.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { amountHalalas: true } });
    const adjustments = await this.prisma.adjustmentRequest.groupBy({ by: ['kind', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { amountMinor: true, points: true } });
    const settlements = await this.prisma.settlement.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { payableMinor: true, paidMinor: true } });
    const recon = await this.prisma.reconciliationItem.groupBy({ by: ['source', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { varianceMinor: true } });
    const fraud = await this.prisma.riskFlag.groupBy({ by: ['domain', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true } });
    const attempts = await this.prisma.redemptionAttempt.groupBy({ by: ['result'], where: { createdAt: { gte: since }, result: { in: FAILED_RESULTS as never } }, _count: { _all: true } });
    const payments = await this.prisma.payment.count({ where: { status: 'FAILED', updatedAt: { gte: since } } });
    const support = await this.prisma.supportCase.groupBy({ by: ['type', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true } });
    const watchViews = await this.prisma.watchView.groupBy({ by: ['status'], where: { startedAt: { gte: since }, status: { in: ['INVALID', 'CREDITED_BACK'] } }, _count: { _all: true } });
    const loyalty = await this.prisma.rewardAdjustment.groupBy({ by: ['status'], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { points: true } });
    const deliveries = await this.prisma.notificationDelivery.groupBy({ by: ['channel', 'status'], where: { createdAt: { gte: since } }, _count: { _all: true } });
    const integration = { failedRecords: await this.prisma.failedRecord.count({ where: { createdAt: { gte: since } } }), failedSyncs: await this.prisma.syncJob.count({ where: { status: 'FAILED', startedAt: { gte: since } } }) };
    const conflicts = { dataConflicts: await this.prisma.dataConflict.count({ where: { status: 'OPEN' } }), duplicateSuggestions: await this.prisma.matchCandidate.count({ where: { status: 'PENDING' } }) };
    return {
      days,
      generatedAt: now.toISOString(),
      cases: { open: open.length, byType: group(open, (c) => c.type), byStatus: group(open, (c) => c.status), aging, slaBreaches: open.filter((c) => c.slaDueAt < now).length },
      refunds: refunds.map((r) => ({ status: r.status, count: r._count._all, valueMinor: r._sum.amountHalalas ?? 0 })),
      adjustments: adjustments.map((a) => ({ kind: a.kind, status: a.status, count: a._count._all, amountMinor: a._sum.amountMinor ?? 0, points: a._sum.points ?? 0 })),
      settlements: settlements.map((s) => ({ status: s.status, count: s._count._all, payableMinor: s._sum.payableMinor ?? 0, paidMinor: s._sum.paidMinor ?? 0 })),
      reconciliation: recon.map((r) => ({ source: r.source, status: r.status, count: r._count._all, varianceMinor: r._sum.varianceMinor ?? 0 })),
      fraud: fraud.map((f) => ({ domain: f.domain, status: f.status, count: f._count._all })),
      redemptionFailures: attempts.map((a) => ({ result: a.result, count: a._count._all })),
      paymentFailures: payments,
      voucherIssues: support.map((s) => ({ type: s.type, status: s.status, count: s._count._all })),
      watchIssues: (watchViews as Array<{ status: string; _count: { _all: number } }>).map((v) => ({ status: v.status, count: v._count._all })),
      loyaltyAdjustments: loyalty.map((l) => ({ status: l.status, count: l._count._all, points: l._sum.points ?? 0 })),
      notificationDeliveries: deliveries.map((d) => ({ channel: d.channel, status: d.status, count: d._count._all })),
      integration,
      conflicts,
    };
  }

  /** The same report as CSV rows (section, key, count, amount). */
  async reportCsv(days = 30) {
    const r = await this.report(days);
    const rows: string[][] = [['section', 'key', 'count', 'amount_minor_or_points']];
    const add = (section: string, key: string, count: number, amount: number | string = '') => rows.push([section, key, String(count), String(amount)]);
    for (const [k, v] of Object.entries(r.cases.byType)) add('cases_open_by_type', k, v);
    for (const [k, v] of Object.entries(r.cases.aging)) add('cases_aging', k, v);
    add('cases', 'sla_breaches', r.cases.slaBreaches);
    for (const x of r.refunds) add('refunds', x.status, x.count, x.valueMinor);
    for (const x of r.adjustments) add('adjustments', `${x.kind}:${x.status}`, x.count, x.amountMinor || x.points);
    for (const x of r.settlements) add('settlements', x.status, x.count, x.payableMinor);
    for (const x of r.reconciliation) add('reconciliation', `${x.source}:${x.status}`, x.count, x.varianceMinor);
    for (const x of r.fraud) add('fraud_flags', `${x.domain}:${x.status}`, x.count);
    for (const x of r.redemptionFailures) add('redemption_failures', x.result, x.count);
    add('payment_failures', 'FAILED', r.paymentFailures);
    for (const x of r.voucherIssues) add('voucher_issues', `${x.type}:${x.status}`, x.count);
    for (const x of r.watchIssues) add('watch_issues', x.status, x.count);
    for (const x of r.loyaltyAdjustments) add('loyalty_adjustments', x.status, x.count, x.points);
    for (const x of r.notificationDeliveries) add('notification_deliveries', `${x.channel}:${x.status}`, x.count);
    add('integration', 'failed_records', r.integration.failedRecords);
    add('integration', 'failed_syncs', r.integration.failedSyncs);
    add('conflicts', 'data_conflicts', r.conflicts.dataConflicts);
    add('conflicts', 'duplicate_suggestions', r.conflicts.duplicateSuggestions);
    return rows.map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
  }
}
