import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { INTEGRATION_FAMILIES, OPEN_RECEIVABLE_STATUSES, type HealthState, type IntegrationFamily, type TimelineKind } from '@dealdash/types';
import { AppError } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { LedgerService } from '../vouchers/ledger.service';

const D = 86_400_000;

export interface IntegrationHealth {
  family: IntegrationFamily;
  state: HealthState;
  /** MOCK = a development adapter (no vendor is integrated yet); CONNECTION = configured connections. */
  adapter: 'MOCK' | 'CONNECTION' | 'INTERNAL';
  connections: number;
  lastSuccessAt: string | null;
  detail: Record<string, number | string | null>;
}

const familyOf = (sourceSystem: string, partnerType: string | null): IntegrationFamily => {
  const s = sourceSystem.toUpperCase();
  if (s.includes('VISA')) return 'VISA';
  if (s.includes('MASTERCARD') || s.includes('MASTER_CARD')) return 'MASTERCARD';
  if (partnerType === 'BANK' || s.includes('BANK')) return 'BANK_FEED';
  return 'PARTNER_FEED';
};

/**
 * The DealDash Operations Command Centre: one read model over campaigns, transactions, finance, integrations, platform and risk,
 * built from the existing tables (nothing here writes). Plus the customer support timeline (admin only, minimised fields).
 */
@Injectable()
export class OperationsCentreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly ledger: LedgerService,
  ) {}

  async commandCentre(now = new Date()) {
    const [campaigns, transactions, finance, integrations, risk, alerts, platform] = await Promise.all([
      this.campaignHealth(now),
      this.transactionHealth(now),
      this.financialHealth(now),
      this.integrationHealth(now),
      this.riskHealth(now),
      this.alertSummary(),
      this.platformHealth(now),
    ]);
    return { generatedAt: now.toISOString(), campaigns, transactions, finance, integrations, risk, alerts, platform };
  }

  // ---------------------------------------------------------------- campaigns
  async campaignHealth(now: Date) {
    const soon = new Date(now.getTime() + 3 * D);
    const p = this.prisma;
    const openAlerts = async (codes: string[], product: string) => p.alertEvent.count({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, code: { in: codes }, product } });
    const holds = async (product: 'EXCLUSIVE' | 'VOUCHER' | 'WATCH' | 'LIVE_BENEFIT') => p.commercialCase.count({ where: { product, status: 'FINANCIAL_HOLD' } });
    const live = {
      product: 'LIVE',
      live: await p.liveDeal.count({ where: { status: 'LIVE' } }),
      pending: await p.liveDeal.count({ where: { status: 'PENDING_REVIEW' } }),
      paused: await p.liveDeal.count({ where: { status: 'PAUSED' } }),
      expiring: await p.liveDeal.count({ where: { status: 'LIVE', endAt: { gt: now, lte: soon } } }),
      underperforming: await openAlerts(['CAMPAIGN_BEHIND_TARGET', 'CAMPAIGN_LOW_ACTIVITY'], 'LIVE'),
      financialHold: await holds('LIVE_BENEFIT'),
      fundingLow: 0,
      inventoryExhausted: 0,
      suspended: await p.liveDeal.count({ where: { status: 'SUSPENDED' } }),
    };
    const exclusive = {
      product: 'EXCLUSIVE',
      live: await p.hotDeal.count({ where: { status: 'LIVE' } }),
      pending: await p.hotDeal.count({ where: { status: 'PENDING_REVIEW' } }),
      paused: await p.hotDeal.count({ where: { status: 'PAUSED' } }),
      expiring: await p.hotDeal.count({ where: { status: 'LIVE', endAt: { gt: now, lte: soon } } }),
      underperforming: await openAlerts(['CAMPAIGN_BEHIND_TARGET', 'CAMPAIGN_LOW_ACTIVITY'], 'EXCLUSIVE'),
      financialHold: await holds('EXCLUSIVE'),
      fundingLow: await openAlerts(['FUNDING_REQUIRED', 'SPONSOR_FUNDING_NEAR_LIMIT'], 'EXCLUSIVE'),
      inventoryExhausted: await p.hotDeal.count({ where: { status: 'SOLD_OUT' } }),
      suspended: await p.hotDeal.count({ where: { status: 'SUSPENDED' } }),
    };
    const vouchers = {
      product: 'VOUCHER',
      live: await p.voucher.count({ where: { status: 'ON_SALE' } }),
      pending: await p.voucher.count({ where: { status: 'PENDING_REVIEW' } }),
      paused: await p.voucher.count({ where: { status: 'PAUSED' } }),
      expiring: await p.voucher.count({ where: { status: 'ON_SALE', saleEndAt: { gt: now, lte: soon } } }),
      underperforming: await openAlerts(['CAMPAIGN_BEHIND_TARGET', 'CAMPAIGN_LOW_ACTIVITY'], 'VOUCHER'),
      financialHold: await holds('VOUCHER'),
      fundingLow: await openAlerts(['FUNDING_REQUIRED'], 'VOUCHER'),
      inventoryExhausted: await p.voucher.count({ where: { status: 'SOLD_OUT' } }),
      suspended: await p.voucher.count({ where: { status: 'SUSPENDED' } }),
    };
    const watch = {
      product: 'WATCH',
      live: await p.watchCampaign.count({ where: { status: 'LIVE' } }),
      pending: await p.watchCampaign.count({ where: { status: 'PENDING_REVIEW' } }),
      paused: await p.watchCampaign.count({ where: { status: 'PAUSED' } }),
      expiring: await p.watchCampaign.count({ where: { status: 'LIVE', endAt: { gt: now, lte: soon } } }),
      underperforming: await openAlerts(['CAMPAIGN_BEHIND_TARGET', 'CAMPAIGN_LOW_ACTIVITY'], 'WATCH'),
      financialHold: await holds('WATCH'),
      fundingLow: await openAlerts(['BUDGET_PROJECTED_EXHAUST', 'FUNDING_REQUIRED'], 'WATCH'),
      inventoryExhausted: await p.watchCampaign.count({ where: { status: 'COMPLETED' } }),
      suspended: await p.watchCampaign.count({ where: { status: 'SUSPENDED' } }),
    };
    return [live, exclusive, vouchers, watch];
  }

  // ---------------------------------------------------------------- transactions (last 24 hours, from the governed events)
  async transactionHealth(now: Date) {
    const since = new Date(now.getTime() - D);
    const rows = await this.prisma.analyticsEvent.groupBy({ by: ['name'], where: { occurredAt: { gte: since } }, _sum: { quantity: true, amountMinor: true, points: true } });
    const q = (n: string) => rows.find((r) => r.name === n)?._sum.quantity ?? 0;
    const amt = (n: string) => rows.find((r) => r.name === n)?._sum.amountMinor ?? 0;
    const pts = (n: string) => rows.find((r) => r.name === n)?._sum.points ?? 0;
    const ok = q('VOUCHER_PAYMENT_SUCCEEDED');
    const failed = q('VOUCHER_PAYMENT_FAILED');
    const loyalty = await this.prisma.rewardEntry.count({ where: { createdAt: { gte: since }, ruleId: { not: null } } });
    return {
      windowHours: 24,
      payments: { succeeded: ok, failed, failureRateBps: ok + failed ? Math.round((failed * 10_000) / (ok + failed)) : null },
      voucherPurchases: { count: ok, valueMinor: amt('VOUCHER_PAYMENT_SUCCEEDED'), currency: 'SAR' },
      redemptions: { exclusive: q('EXCLUSIVE_REDEMPTION_VERIFIED'), voucher: q('VOUCHER_REDEEMED'), rejected: q('EXCLUSIVE_REDEMPTION_REJECTED') + q('VOUCHER_REDEMPTION_REJECTED') },
      rewardAllocations: q('REWARD_ALLOCATED'),
      pointsIssued: pts('POINTS_ISSUED'),
      loyaltyPostings: loyalty,
      qualifiedViews: q('WATCH_QUALIFIED_VIEW'),
    };
  }

  // ---------------------------------------------------------------- finance
  async financialHealth(now: Date) {
    const p = this.prisma;
    const commitments = await p.fundingCommitment.aggregate({ where: { status: 'OPEN' }, _sum: { receivedHalalas: true, utilizedHalalas: true, upfrontHalalas: true, usageMaxHalalas: true } });
    const sponsor = await p.fundingCommitment.aggregate({ where: { status: 'OPEN', kind: 'SPONSOR_FUNDING' }, _sum: { utilizedHalalas: true, usageMaxHalalas: true, upfrontHalalas: true } });
    const open = await p.financeDocument.findMany({ where: { type: { in: ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE'] }, status: { in: [...OPEN_RECEIVABLE_STATUSES] as never } }, select: { totalHalalas: true, paidHalalas: true, dueAt: true, currency: true } });
    const byCurrency = new Map<string, { open: number; overdue: number; count: number; overdueCount: number }>();
    for (const d of open) {
      const x = byCurrency.get(d.currency) ?? { open: 0, overdue: 0, count: 0, overdueCount: 0 };
      const o = Math.max(0, d.totalHalalas - d.paidHalalas);
      x.open += o;
      x.count++;
      if (d.dueAt && d.dueAt < now) {
        x.overdue += o;
        x.overdueCount++;
      }
      byCurrency.set(d.currency, x);
    }
    const sum = async (family: 'MERCHANT_HELD' | 'MERCHANT_SETTLEMENT_ELIGIBLE' | 'RECEIVABLE') => [...(await this.ledger.balancesByOrganization(family)).values()].reduce((s, v) => s + v, 0);
    const credit = await p.creditFacility.aggregate({ where: { status: 'ACTIVE' }, _sum: { limitHalalas: true } });
    const creditMs = await p.fundingCommitment.findMany({ where: { mode: 'CREDIT' }, select: { status: true, upfrontHalalas: true, usageMaxHalalas: true, receivedHalalas: true, utilizedHalalas: true, upfrontEarnedHalalas: true } });
    const creditExposure = creditMs.reduce((s, c) => s + (c.status === 'OPEN' ? Math.max(0, c.upfrontHalalas + c.usageMaxHalalas - c.receivedHalalas) : Math.max(0, c.utilizedHalalas + c.upfrontEarnedHalalas - c.receivedHalalas)), 0);
    const pos = await p.financeDocument.findMany({ where: { type: 'PURCHASE_ORDER', status: { in: ['ISSUED', 'SENT'] } }, select: { id: true, totalHalalas: true } });
    let poUsed = 0;
    for (const po of pos) poUsed += (await p.financeDocument.aggregate({ where: { purchaseOrderId: po.id, status: { notIn: ['CANCELLED', 'VOID', 'DRAFT'] } }, _sum: { totalHalalas: true } }))._sum.totalHalalas ?? 0;
    return {
      funding: { receivedMinor: commitments._sum.receivedHalalas ?? 0, utilizedMinor: commitments._sum.utilizedHalalas ?? 0, committedMinor: (commitments._sum.upfrontHalalas ?? 0) + (commitments._sum.usageMaxHalalas ?? 0) },
      invoices: [...byCurrency.entries()].map(([currency, x]) => ({ currency, openCount: x.count, openMinor: x.open, overdueCount: x.overdueCount, overdueMinor: x.overdue })),
      receivablesLedgerMinor: await sum('RECEIVABLE'),
      sponsorUtilizationBps: (sponsor._sum.usageMaxHalalas ?? 0) + (sponsor._sum.upfrontHalalas ?? 0) > 0 ? Math.round(((sponsor._sum.utilizedHalalas ?? 0) * 10_000) / ((sponsor._sum.usageMaxHalalas ?? 0) + (sponsor._sum.upfrontHalalas ?? 0))) : null,
      merchantPayableMinor: -((await sum('MERCHANT_HELD')) + (await sum('MERCHANT_SETTLEMENT_ELIGIBLE'))),
      settlementPendingItems: await p.merchantPayableEvent.count({ where: { type: 'ELIGIBLE', settlementId: null } }),
      reconciliationExceptions: await p.caseReconciliation.count({ where: { status: 'EXCEPTIONS' } }),
      financialHolds: await p.financialHold.count({ where: { status: 'ACTIVE' } }),
      credit: { limitMinor: credit._sum.limitHalalas ?? 0, exposureMinor: creditExposure },
      purchaseOrders: { open: pos.length, valueMinor: pos.reduce((s, x) => s + x.totalHalalas, 0), usedMinor: poUsed },
      pendingBillingEvents: await p.commercialBillingEvent.count({ where: { status: 'PENDING' } }),
    };
  }

  // ---------------------------------------------------------------- integrations
  async integrationHealth(now: Date, organizationId?: string): Promise<IntegrationHealth[]> {
    const p = this.prisma;
    const failing = (await this.config.get<{ failingErrorCount?: number; webhookFailureRateBps?: number; jobBacklogWarning?: number }>(CONFIG_KEYS.VISIBILITY_HEALTH)) ?? {};
    const conns = await p.integrationConnection.findMany({ where: { status: 'ACTIVE', revokedAt: null, ...(organizationId ? { organizationId } : {}) } });
    const partners = new Map((await p.partner.findMany({ where: { organizationId: { in: conns.map((c) => c.organizationId).filter((x): x is string => !!x) } }, select: { organizationId: true, partnerType: true } })).map((x) => [x.organizationId, x.partnerType]));
    const since = new Date(now.getTime() - D);
    const out: IntegrationHealth[] = [];
    for (const family of INTEGRATION_FAMILIES) {
      if (['VISA', 'MASTERCARD', 'BANK_FEED', 'PARTNER_FEED'].includes(family)) {
        const mine = conns.filter((c) => familyOf(c.sourceSystem, c.organizationId ? (partners.get(c.organizationId) ?? null) : null) === family);
        if (!mine.length) {
          out.push({ family, state: 'NOT_CONFIGURED', adapter: 'CONNECTION', connections: 0, lastSuccessAt: null, detail: {} });
          continue;
        }
        const states = mine.map((c) => {
          const last = c.lastSuccessfulSyncAt ?? c.createdAt;
          if (c.errorCount >= (failing.failingErrorCount ?? 5)) return 'FAILING';
          if (now.getTime() - last.getTime() > c.staleAfterMinutes * 60_000) return 'STALE';
          return c.errorCount > 0 ? 'DEGRADED' : 'HEALTHY';
        });
        const worst = (['FAILING', 'STALE', 'DEGRADED', 'HEALTHY'] as const).find((s) => states.includes(s)) ?? 'HEALTHY';
        const lastOk = mine.map((c) => c.lastSuccessfulSyncAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
        out.push({ family, state: worst, adapter: 'CONNECTION', connections: mine.length, lastSuccessAt: lastOk ? new Date(lastOk).toISOString() : null, detail: { stale: states.filter((s) => s === 'STALE').length, failing: states.filter((s) => s === 'FAILING').length, errors: mine.reduce((n, c) => n + c.errorCount, 0) } });
        continue;
      }
      if (organizationId && family !== 'BULK_IMPORT' && family !== 'SYNC_JOBS' && family !== 'WEBHOOKS') continue;
      if (family === 'BULK_IMPORT') {
        const jobs = await p.importJob.groupBy({ by: ['status'], where: { createdAt: { gte: since }, ...(organizationId ? { organizationId } : {}) }, _count: { _all: true } });
        const c = (s: string) => jobs.find((j) => j.status === s)?._count._all ?? 0;
        const total = jobs.reduce((n, j) => n + j._count._all, 0);
        out.push({ family, state: total === 0 ? 'HEALTHY' : c('FAILED') > 0 ? 'DEGRADED' : 'HEALTHY', adapter: 'INTERNAL', connections: total, lastSuccessAt: null, detail: { jobs24h: total, failed: c('FAILED'), pendingApproval: c('PENDING_APPROVAL') } });
      } else if (family === 'PAYMENT_GATEWAY') {
        const r = await p.payment.groupBy({ by: ['status'], where: { updatedAt: { gte: since } }, _count: { _all: true } });
        const ok = r.find((x) => x.status === 'SUCCEEDED')?._count._all ?? 0;
        const bad = r.find((x) => x.status === 'FAILED')?._count._all ?? 0;
        const rate = ok + bad ? Math.round((bad * 10_000) / (ok + bad)) : 0;
        out.push({ family, state: rate >= 5000 ? 'FAILING' : rate >= 2000 ? 'DEGRADED' : 'HEALTHY', adapter: 'MOCK', connections: 1, lastSuccessAt: null, detail: { succeeded24h: ok, failed24h: bad, failureRateBps: rate } });
      } else if (family === 'EMAIL' || family === 'PUSH' || family === 'SMS_OTP') {
        const ch = family === 'SMS_OTP' ? 'SMS' : family;
        const r = await p.alertDelivery.groupBy({ by: ['status'], where: { channel: ch, createdAt: { gte: since } }, _count: { _all: true } });
        const failed = r.find((x) => x.status === 'FAILED')?._count._all ?? 0;
        const sent = r.find((x) => x.status === 'SENT')?._count._all ?? 0;
        out.push({ family, state: failed > 0 && failed >= sent ? 'FAILING' : failed > 0 ? 'DEGRADED' : 'HEALTHY', adapter: 'MOCK', connections: 1, lastSuccessAt: null, detail: { sent24h: sent, failed24h: failed } });
      } else if (family === 'VIDEO' || family === 'MAPS') {
        out.push({ family, state: 'HEALTHY', adapter: 'MOCK', connections: 1, lastSuccessAt: null, detail: {} });
      } else if (family === 'WEBHOOKS') {
        const r = await p.webhookDelivery.groupBy({ by: ['status'], where: { createdAt: { gte: since }, ...(organizationId ? { endpoint: { connection: { organizationId } } } : {}) }, _count: { _all: true } });
        const total = r.reduce((n, x) => n + x._count._all, 0);
        const failed = r.filter((x) => x.status === 'FAILED' || x.status === 'DEAD').reduce((n, x) => n + x._count._all, 0);
        const rate = total ? Math.round((failed * 10_000) / total) : 0;
        out.push({ family, state: total === 0 ? 'HEALTHY' : rate >= (failing.webhookFailureRateBps ?? 2000) ? 'DEGRADED' : 'HEALTHY', adapter: 'INTERNAL', connections: total, lastSuccessAt: null, detail: { deliveries24h: total, failed24h: failed, failureRateBps: rate } });
      } else if (family === 'SYNC_JOBS') {
        const sj = await p.syncJob.groupBy({ by: ['status'], where: { startedAt: { gte: since }, ...(organizationId ? { connection: { organizationId } } : {}) }, _count: { _all: true } });
        const failed = sj.filter((x) => x.status === 'FAILED').reduce((n, x) => n + x._count._all, 0);
        const total = sj.reduce((n, x) => n + x._count._all, 0);
        out.push({ family, state: failed > 0 ? 'DEGRADED' : 'HEALTHY', adapter: 'INTERNAL', connections: total, lastSuccessAt: null, detail: { runs24h: total, failed24h: failed } });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- platform / technical health
  async platformHealth(now: Date) {
    const p = this.prisma;
    const t0 = Date.now();
    await p.$queryRaw(Prisma.sql`SELECT 1`);
    const dbLatencyMs = Date.now() - t0;
    const jobs = await p.job.groupBy({ by: ['status'], _count: { _all: true }, where: { updatedAt: { gte: new Date(now.getTime() - D) } } });
    const queued = await p.job.count({ where: { status: 'QUEUED' } });
    const oldest = await p.job.findFirst({ where: { status: 'QUEUED' }, orderBy: { runAt: 'asc' }, select: { runAt: true } });
    const agg = await p.analyticsWatermark.findUnique({ where: { source: 'aggregate' } });
    const cfg = (await this.config.get<{ jobBacklogWarning?: number }>(CONFIG_KEYS.VISIBILITY_HEALTH)) ?? {};
    const failed = jobs.filter((j) => j.status === 'FAILED' || j.status === 'DEAD').reduce((n, j) => n + j._count._all, 0);
    const analyticsLagSec = agg ? Math.round((now.getTime() - agg.cursorAt.getTime()) / 1000) : null;
    const state: HealthState = failed > 10 || queued > (cfg.jobBacklogWarning ?? 200) * 2 ? 'FAILING' : failed > 0 || queued > (cfg.jobBacklogWarning ?? 200) || (analyticsLagSec !== null && analyticsLagSec > 900) ? 'DEGRADED' : 'HEALTHY';
    return {
      state,
      database: { latencyMs: dbLatencyMs },
      jobs: { queued, failed24h: failed, oldestQueuedAgeSec: oldest ? Math.max(0, Math.round((now.getTime() - oldest.runAt.getTime()) / 1000)) : null },
      analytics: { asOf: agg?.cursorAt.toISOString() ?? null, lagSec: analyticsLagSec },
      process: { uptimeSec: Math.round(process.uptime()), rssMb: Math.round(process.memoryUsage().rss / 1_048_576) },
    };
  }

  // ---------------------------------------------------------------- risk
  async riskHealth(now: Date) {
    const p = this.prisma;
    const since = new Date(now.getTime() - 7 * D);
    const flags = await p.riskFlag.groupBy({ by: ['decision'], where: { status: { in: ['OPEN', 'IN_REVIEW'] } }, _count: { _all: true } });
    const devices = await p.riskFlag.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] }, subjectDeviceHash: { not: null } } });
    const rejected = await p.redemptionAttempt.count({ where: { createdAt: { gte: new Date(now.getTime() - D) }, result: { notIn: ['VALID', 'REDEEMED'] } } });
    return {
      fraudAlerts: flags.reduce((n, f) => n + f._count._all, 0),
      byDecision: Object.fromEntries(flags.map((f) => [f.decision, f._count._all])),
      duplicateActivity: (await p.matchCandidate.count({ where: { status: 'PENDING' } })) + (await p.dataConflict.count({ where: { status: 'OPEN' } })),
      suspiciousDevices: devices,
      staffMisuse: await p.alertEvent.count({ where: { code: 'SUSPICIOUS_BRANCH_ACTIVITY', status: { in: ['OPEN', 'ACKNOWLEDGED'] } } }),
      unusualRedemptions: rejected,
      rewardFarming: await p.riskFlag.count({ where: { createdAt: { gte: since }, decision: { in: ['HOLD', 'BLOCK'] } } }),
      reconciliationAnomalies: await p.caseReconciliation.count({ where: { status: 'EXCEPTIONS' } }),
    };
  }

  async alertSummary() {
    const rows = await this.prisma.alertEvent.groupBy({ by: ['severity', 'category'], where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } }, _count: { _all: true } });
    return { open: rows.reduce((n, r) => n + r._count._all, 0), critical: rows.filter((r) => r.severity === 'CRITICAL').reduce((n, r) => n + r._count._all, 0), byCategory: Object.fromEntries([...new Set(rows.map((r) => r.category))].map((c) => [c, rows.filter((r) => r.category === c).reduce((n, r) => n + r._count._all, 0)])) };
  }

  // ---------------------------------------------------------------- customer support timeline
  /**
   * Everything that happened to one customer, newest first, in one list: account, reservations, redemptions, orders, payments,
   * refunds, vouchers, Watch & Earn views, points, rewards, support cases, disputes, risk and notifications. Codes and tokens are
   * never included (references only).
   */
  async customerTimeline(userId: string, opts: { kinds?: TimelineKind[]; before?: Date; take?: number } = {}) {
    const p = this.prisma;
    const user = await p.user.findUnique({ where: { id: userId }, select: { id: true, userType: true, displayName: true, mobile: true, locale: true, status: true, createdAt: true, lastLoginAt: true } });
    if (!user || user.userType !== 'CUSTOMER') throw AppError.notFound();
    const before = opts.before ?? new Date(Date.now() + 60_000);
    const take = Math.min(opts.take ?? 100, 300);
    const want = (k: TimelineKind) => !opts.kinds?.length || opts.kinds.includes(k);
    type Item = { at: string; kind: TimelineKind; event: string; reference: string | null; status: string | null; amountMinor: number | null; currency: string | null; points: number | null; data: Record<string, unknown> };
    const items: Item[] = [];
    const push = (i: Omit<Item, 'amountMinor' | 'currency' | 'points' | 'data'> & Partial<Item>) => items.push({ amountMinor: null, currency: null, points: null, data: {}, ...i });
    const w = { lt: before };
    if (want('ACCOUNT')) {
      push({ at: user.createdAt.toISOString(), kind: 'ACCOUNT', event: 'ACCOUNT_CREATED', reference: null, status: user.status });
      if (user.lastLoginAt) push({ at: user.lastLoginAt.toISOString(), kind: 'ACCOUNT', event: 'LAST_SIGN_IN', reference: null, status: null });
    }
    if (want('RESERVATION'))
      for (const r of await p.reservation.findMany({ where: { userId, createdAt: w }, orderBy: { createdAt: 'desc' }, take }))
        push({ at: r.createdAt.toISOString(), kind: 'RESERVATION', event: 'RESERVATION_CREATED', reference: r.reference, status: r.status, data: { dealId: r.dealId, branchId: r.branchId, quantity: r.quantity, expiresAt: r.expiresAt.toISOString() } });
    if (want('REDEMPTION')) {
      const resIds = (await p.reservation.findMany({ where: { userId }, select: { id: true }, take: 500 })).map((r) => r.id);
      for (const r of await p.redemption.findMany({ where: { reservationId: { in: resIds }, redeemedAt: w }, orderBy: { redeemedAt: 'desc' }, take }))
        push({ at: r.redeemedAt.toISOString(), kind: 'REDEMPTION', event: r.status === 'REVERSED' ? 'REDEMPTION_REVERSED' : 'REDEMPTION_VERIFIED', reference: r.reference, status: r.status, data: { dealId: r.dealId, branchId: r.branchId } });
    }
    const orders = want('ORDER') || want('PAYMENT') || want('REFUND') ? await p.voucherOrder.findMany({ where: { userId, createdAt: w }, orderBy: { createdAt: 'desc' }, take }) : [];
    if (want('ORDER')) for (const o of orders) push({ at: o.createdAt.toISOString(), kind: 'ORDER', event: 'ORDER_CREATED', reference: o.reference, status: o.status, amountMinor: o.totalHalalas, currency: o.currency, data: { voucherId: o.voucherId, quantity: o.quantity } });
    if (want('PAYMENT'))
      for (const pay of await p.payment.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, orderBy: { createdAt: 'desc' } }))
        push({ at: (pay.completedAt ?? pay.createdAt).toISOString(), kind: 'PAYMENT', event: `PAYMENT_${pay.status}`, reference: null, status: pay.status, amountMinor: pay.amountHalalas, currency: pay.currency, data: { attempt: pay.attemptNo, failureCode: pay.failureCode } });
    if (want('REFUND'))
      for (const r of await p.refund.findMany({ where: { orderId: { in: orders.map((o) => o.id) } }, orderBy: { createdAt: 'desc' } }))
        push({ at: (r.refundedAt ?? r.createdAt).toISOString(), kind: 'REFUND', event: `REFUND_${r.status}`, reference: r.reference, status: r.status, amountMinor: r.amountHalalas, currency: 'SAR', data: { kind: r.kind, reasonCode: r.reasonCode } });
    if (want('VOUCHER'))
      for (const v of await p.voucherInstance.findMany({ where: { ownerUserId: userId, issuedAt: w }, orderBy: { issuedAt: 'desc' }, take }))
        push({ at: v.issuedAt.toISOString(), kind: 'VOUCHER', event: 'VOUCHER_ISSUED', reference: v.reference, status: v.status, amountMinor: v.purchasePriceHalalas, currency: 'SAR', data: { voucherId: v.voucherId, expiresAt: v.expiresAt.toISOString(), redeemedAt: v.redeemedAt?.toISOString() ?? null } });
    if (want('WATCH_VIEW'))
      for (const v of await p.watchView.findMany({ where: { userId, startedAt: w }, orderBy: { startedAt: 'desc' }, take }))
        push({ at: v.startedAt.toISOString(), kind: 'WATCH_VIEW', event: 'VIEW', reference: null, status: v.status, points: v.rewardPoints, data: { campaignId: v.campaignId, qualifiedAt: v.qualifiedAt?.toISOString() ?? null, riskDecision: v.riskDecision } });
    const account = await p.rewardAccount.findFirst({ where: { userId }, select: { id: true } });
    if (account && want('POINTS'))
      for (const e of await p.rewardEntry.findMany({ where: { accountId: account.id, createdAt: w }, orderBy: { createdAt: 'desc' }, take }))
        push({ at: e.createdAt.toISOString(), kind: 'POINTS', event: `POINTS_${e.type}`, reference: null, status: e.bucket, points: e.points, data: { sourceType: e.sourceType, reasonCode: e.reasonCode, fundingSource: e.fundingSource } });
    if (account && want('REWARD'))
      for (const r of await p.rewardRedemption.findMany({ where: { accountId: account.id, createdAt: w }, orderBy: { createdAt: 'desc' }, take }))
        push({ at: r.createdAt.toISOString(), kind: 'REWARD', event: 'REWARD_REDEEMED', reference: null, status: r.status, points: r.pointsCost, data: { itemId: r.itemId } });
    if (want('SUPPORT_CASE'))
      for (const c of await p.supportCase.findMany({ where: { userId, createdAt: w }, orderBy: { createdAt: 'desc' }, take }))
        push({ at: c.createdAt.toISOString(), kind: 'SUPPORT_CASE', event: `SUPPORT_${c.type}`, reference: c.reference, status: c.status, data: { subject: c.subject } });
    if (want('DISPUTE'))
      for (const d of await p.disputeCase.findMany({ where: { customerUserId: userId, createdAt: w }, orderBy: { createdAt: 'desc' }, take }))
        push({ at: d.createdAt.toISOString(), kind: 'DISPUTE', event: `DISPUTE_${d.type}`, reference: d.reference, status: d.status, data: { title: d.title } });
    if (want('RISK'))
      for (const f of await p.riskFlag.findMany({ where: { subjectUserId: userId, createdAt: w }, orderBy: { createdAt: 'desc' }, take }))
        push({ at: f.createdAt.toISOString(), kind: 'RISK', event: `RISK_${f.decision}`, reference: null, status: f.status, data: { outcome: f.outcome, campaignId: f.campaignId } });
    if (want('NOTIFICATION'))
      for (const n of await p.notification.findMany({ where: { userId, createdAt: w }, orderBy: { createdAt: 'desc' }, take }))
        push({ at: n.createdAt.toISOString(), kind: 'NOTIFICATION', event: n.type, reference: null, status: n.readAt ? 'READ' : 'UNREAD' });
    items.sort((a, b) => b.at.localeCompare(a.at));
    const page = items.slice(0, take);
    return {
      customer: { id: user.id, displayName: user.displayName, mobileMasked: user.mobile ? `${user.mobile.slice(0, 4)}•••${user.mobile.slice(-2)}` : null, locale: user.locale, status: user.status, since: user.createdAt.toISOString() },
      items: page,
      nextBefore: items.length > take ? page[page.length - 1]!.at : null,
    };
  }

  /** Find customers by mobile / name (for the support desk). */
  async findCustomers(q: string) {
    const term = q.trim();
    if (term.length < 3) throw AppError.validation('Type at least 3 characters', 'q');
    const rows = await this.prisma.user.findMany({ where: { userType: 'CUSTOMER', OR: [{ mobile: { contains: term } }, { displayName: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }] }, select: { id: true, displayName: true, mobile: true, createdAt: true }, take: 20 });
    return rows.map((u) => ({ id: u.id, displayName: u.displayName, mobileMasked: u.mobile ? `${u.mobile.slice(0, 4)}•••${u.mobile.slice(-2)}` : null, since: u.createdAt.toISOString() }));
  }
}
