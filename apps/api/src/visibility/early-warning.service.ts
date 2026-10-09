import { Injectable, Logger } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { OPEN_RECEIVABLE_STATUSES } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AlertsService } from './alerts.service';
import { ReportingService } from './reporting.service';

const H = 3_600_000;
const D = 86_400_000;

/**
 * Early warnings: each detector reads the existing state (campaigns, inventory, funding, credit, PO, quotations, invoices,
 * settlement, integrations, payments, redemptions, risk, reconciliation) and raises a deduplicated alert. Thresholds come from the
 * business's rule, else the platform rule, else configuration. A failing detector never stops the others.
 */
@Injectable()
export class EarlyWarningService {
  private readonly logger = new Logger('EarlyWarnings');

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly reporting: ReportingService,
    private readonly config: SystemConfigService,
  ) {}

  async run(now = new Date()): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const detectors: Array<[string, () => Promise<number>]> = [
      ['budget', () => this.budget(now)],
      ['inventory', () => this.inventory(now)],
      ['voucherInventory', () => this.voucherInventory()],
      ['rewardInventory', () => this.rewardInventory()],
      ['pointsFunding', () => this.pointsFunding()],
      ['sponsorFunding', () => this.sponsorFunding()],
      ['credit', () => this.credit()],
      ['po', () => this.purchaseOrders()],
      ['campaignExpiry', () => this.campaignExpiry(now)],
      ['voucherExpiry', () => this.voucherExpiry(now)],
      ['rewardExpiry', () => this.rewardExpiry(now)],
      ['quotations', () => this.quotations(now)],
      ['invoices', () => this.invoices(now)],
      ['settlement', () => this.settlement(now)],
      ['integrations', () => this.integrations(now)],
      ['payments', () => this.payments(now)],
      ['rejections', () => this.rejections(now)],
      ['suspiciousBranches', () => this.suspiciousBranches(now)],
      ['reconciliation', () => this.reconciliation(now)],
      ['lowActivity', () => this.lowActivity(now)],
      ['funding', () => this.fundingRequired()],
      ['approvals', () => this.approvalsRequired()],
    ];
    for (const [name, fn] of detectors) {
      try {
        out[name] = await fn();
      } catch (e) {
        out[name] = -1;
        this.logger.warn(`Detector ${name} failed: ${(e as Error).message}`);
      }
    }
    return out;
  }

  private t(org: string | null, code: Parameters<AlertsService['threshold']>[1], key: string) {
    return this.alerts.threshold(org, code, key);
  }

  private async count(n: Promise<{ created: boolean } | null>) {
    return (await n)?.created ? 1 : 0;
  }

  /** Watch & Earn: remaining budget divided by the last 24 h burn rate. */
  async budget(now: Date) {
    let n = 0;
    for (const c of await this.prisma.watchCampaign.findMany({ where: { status: 'LIVE' }, select: { id: true, organizationId: true, fundedHalalas: true, spentHalalas: true, unusedHalalas: true, titleEn: true } })) {
      const remaining = Math.max(0, c.fundedHalalas - c.spentHalalas - c.unusedHalalas);
      const burn = await this.prisma.analyticsEvent.aggregate({ where: { campaignId: c.id, name: 'WATCH_QUALIFIED_VIEW', occurredAt: { gte: new Date(now.getTime() - D) } }, _sum: { amountMinor: true } });
      const perHour = (burn._sum.amountMinor ?? 0) / 24;
      if (perHour <= 0) continue;
      const hours = remaining / perHour;
      if (hours < (await this.t(c.organizationId, 'BUDGET_PROJECTED_EXHAUST', 'budgetExhaustHours')))
        n += await this.count(this.alerts.raise({ code: 'BUDGET_PROJECTED_EXHAUST', organizationId: c.organizationId, subjectType: 'WatchCampaign', subjectId: c.id, campaignId: c.id, product: 'WATCH', data: { title: c.titleEn, remainingMinor: remaining, projectedHours: Math.round(hours), estimate: true } }));
    }
    return n;
  }

  /** Exclusive Deals: units left divided by the last 24 h take-up (credentials issued). */
  async inventory(now: Date) {
    let n = 0;
    for (const d of await this.prisma.hotDeal.findMany({ where: { status: 'LIVE' }, select: { id: true, organizationId: true, titleEn: true } })) {
      const inv = await this.prisma.hotDealInventory.aggregate({ where: { dealId: d.id, tracked: true }, _sum: { available: true } });
      const left = inv._sum.available ?? 0;
      const taken = await this.prisma.analyticsEvent.aggregate({ where: { campaignId: d.id, name: 'EXCLUSIVE_CREDENTIAL_ISSUED', occurredAt: { gte: new Date(now.getTime() - D) } }, _sum: { quantity: true } });
      const perHour = (taken._sum.quantity ?? 0) / 24;
      if (perHour <= 0) continue;
      const hours = left / perHour;
      if (hours < (await this.t(d.organizationId, 'INVENTORY_PROJECTED_EXHAUST', 'inventoryExhaustHours')))
        n += await this.count(this.alerts.raise({ code: 'INVENTORY_PROJECTED_EXHAUST', organizationId: d.organizationId, subjectType: 'ExclusiveDeal', subjectId: d.id, campaignId: d.id, product: 'EXCLUSIVE', data: { title: d.titleEn, unitsLeft: left, projectedHours: Math.round(hours), estimate: true } }));
    }
    return n;
  }

  async voucherInventory() {
    let n = 0;
    for (const v of await this.prisma.voucher.findMany({ where: { status: 'ON_SALE', totalQty: { gt: 0 } }, select: { id: true, organizationId: true, titleEn: true, totalQty: true, soldQty: true, heldQty: true } })) {
      const left = Math.max(0, v.totalQty - v.soldQty - v.heldQty);
      if ((left * 10_000) / v.totalQty <= (await this.t(v.organizationId, 'VOUCHER_INVENTORY_LOW', 'voucherInventoryLowBps')))
        n += await this.count(this.alerts.raise({ code: 'VOUCHER_INVENTORY_LOW', organizationId: v.organizationId, subjectType: 'Voucher', subjectId: v.id, campaignId: v.id, product: 'VOUCHER', data: { title: v.titleEn, left, total: v.totalQty } }));
    }
    return n;
  }

  async rewardInventory() {
    let n = 0;
    for (const i of await this.prisma.rewardCatalogueItem.findMany({ where: { status: 'ACTIVE', stock: { not: null } } })) {
      if ((i.stock ?? 0) <= (await this.t(i.ownerOrganizationId, 'REWARD_INVENTORY_LOW', 'rewardInventoryLow')))
        n += await this.count(this.alerts.raise({ code: 'REWARD_INVENTORY_LOW', organizationId: i.ownerOrganizationId, subjectType: 'RewardCatalogueItem', subjectId: i.id, product: 'LOYALTY', data: { name: i.nameEn, stock: i.stock } }));
    }
    return n;
  }

  /** Loyalty rules funded by a business: what is left of the funding received. */
  async pointsFunding() {
    let n = 0;
    for (const c of await this.prisma.commercialCase.findMany({ where: { product: 'LOYALTY', status: { notIn: ['CLOSED', 'RECONCILED'] } }, include: { commitments: true } })) {
      const received = c.commitments.reduce((s, m) => s + m.receivedHalalas, 0);
      const used = c.commitments.reduce((s, m) => s + m.utilizedHalalas, 0);
      if (received <= 0) continue;
      if (((received - used) * 10_000) / received <= (await this.t(c.ownerOrganizationId, 'POINTS_FUNDING_LOW', 'pointsFundingLowBps')))
        n += await this.count(this.alerts.raise({ code: 'POINTS_FUNDING_LOW', organizationId: c.ownerOrganizationId, subjectType: 'CommercialCase', subjectId: c.id, product: 'LOYALTY', data: { caseReference: c.reference, remainingMinor: received - used } }));
    }
    return n;
  }

  async sponsorFunding() {
    let n = 0;
    for (const m of await this.prisma.fundingCommitment.findMany({ where: { kind: 'SPONSOR_FUNDING', status: 'OPEN' }, include: { case: { select: { product: true, subjectId: true, reference: true } } } })) {
      const max = m.upfrontHalalas + m.usageMaxHalalas;
      if (max <= 0) continue;
      if ((m.utilizedHalalas * 10_000) / max >= (await this.t(m.organizationId, 'SPONSOR_FUNDING_NEAR_LIMIT', 'sponsorNearLimitBps')))
        n += await this.count(this.alerts.raise({ code: 'SPONSOR_FUNDING_NEAR_LIMIT', organizationId: m.organizationId, subjectType: 'FundingCommitment', subjectId: m.id, campaignId: m.case.subjectId, product: m.case.product === 'EXCLUSIVE' ? 'EXCLUSIVE' : m.case.product, data: { caseReference: m.case.reference, utilizedMinor: m.utilizedHalalas, maxMinor: max } }));
    }
    return n;
  }

  /** Credit exposure (open credit-mode commitments plus open receivables) against the approved limit. */
  async credit() {
    let n = 0;
    for (const f of await this.prisma.creditFacility.findMany({ where: { status: 'ACTIVE' } })) {
      const ms = await this.prisma.fundingCommitment.findMany({ where: { organizationId: f.organizationId, mode: 'CREDIT' } });
      const commitments = ms.reduce((s, c) => s + (c.status === 'OPEN' ? Math.max(0, c.upfrontHalalas + c.usageMaxHalalas - c.receivedHalalas) : Math.max(0, c.utilizedHalalas + c.upfrontEarnedHalalas - c.receivedHalalas)), 0);
      const ar = await this.openReceivable(f.organizationId, f.currency);
      const exposure = commitments + ar;
      if (f.limitHalalas > 0 && (exposure * 10_000) / f.limitHalalas >= (await this.t(f.organizationId, 'CREDIT_NEAR_LIMIT', 'creditNearLimitBps'))) {
        n += await this.count(this.alerts.raise({ code: 'CREDIT_NEAR_LIMIT', organizationId: f.organizationId, subjectType: 'CreditFacility', subjectId: f.id, data: { exposureMinor: exposure, limitMinor: f.limitHalalas, currency: f.currency } }));
        await this.alerts.raise({ code: 'CREDIT_NEAR_LIMIT', organizationId: null, subjectType: 'CreditFacility', subjectId: f.id, data: { organizationId: f.organizationId, exposureMinor: exposure, limitMinor: f.limitHalalas } });
      }
    }
    return n;
  }

  private async openReceivable(organizationId: string, currency: string) {
    const docs = await this.prisma.financeDocument.findMany({ where: { organizationId, currency, type: { in: ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE'] }, status: { in: [...OPEN_RECEIVABLE_STATUSES] as never } }, select: { totalHalalas: true, paidHalalas: true } });
    return docs.reduce((s, d) => s + Math.max(0, d.totalHalalas - d.paidHalalas), 0);
  }

  async purchaseOrders() {
    let n = 0;
    for (const po of await this.prisma.financeDocument.findMany({ where: { type: 'PURCHASE_ORDER', status: { in: ['ISSUED', 'SENT'] } } })) {
      if (po.totalHalalas <= 0) continue;
      const used = await this.prisma.financeDocument.aggregate({ where: { purchaseOrderId: po.id, status: { notIn: ['CANCELLED', 'VOID', 'DRAFT'] } }, _sum: { totalHalalas: true } });
      const u = used._sum.totalHalalas ?? 0;
      if ((u * 10_000) / po.totalHalalas >= (await this.t(po.organizationId, 'PO_NEAR_LIMIT', 'poNearLimitBps')))
        n += await this.count(this.alerts.raise({ code: 'PO_NEAR_LIMIT', organizationId: po.organizationId, subjectType: 'PurchaseOrder', subjectId: po.id, data: { poNumber: po.externalReference ?? po.number, usedMinor: u, valueMinor: po.totalHalalas, currency: po.currency } }));
    }
    return n;
  }

  async campaignExpiry(now: Date) {
    let n = 0;
    const raise = async (org: string, product: string, id: string, title: string, endAt: Date | null) => {
      if (!endAt) return;
      const days = await this.t(org, 'CAMPAIGN_EXPIRY_APPROACHING', 'campaignExpiryDays');
      if (endAt.getTime() - now.getTime() <= days * D && endAt > now)
        n += await this.count(this.alerts.raise({ code: 'CAMPAIGN_EXPIRY_APPROACHING', organizationId: org, subjectType: 'Campaign', subjectId: id, campaignId: id, product, once: true, data: { title, endAt: endAt.toISOString() } }));
    };
    const sel = { id: true, organizationId: true, titleEn: true, endAt: true } as const;
    for (const c of await this.prisma.liveDeal.findMany({ where: { status: 'LIVE' }, select: sel })) await raise(c.organizationId, 'LIVE', c.id, c.titleEn, c.endAt);
    for (const c of await this.prisma.hotDeal.findMany({ where: { status: 'LIVE' }, select: sel })) await raise(c.organizationId, 'EXCLUSIVE', c.id, c.titleEn, c.endAt);
    for (const c of await this.prisma.watchCampaign.findMany({ where: { status: 'LIVE' }, select: sel })) await raise(c.organizationId, 'WATCH', c.id, c.titleEn, c.endAt);
    for (const c of await this.prisma.voucher.findMany({ where: { status: 'ON_SALE' }, select: { id: true, organizationId: true, titleEn: true, saleEndAt: true } })) await raise(c.organizationId, 'VOUCHER', c.id, c.titleEn, c.saleEndAt);
    return n;
  }

  /** Issued vouchers about to expire, per voucher campaign (customers get their own reminders). */
  async voucherExpiry(now: Date) {
    const days = await this.t(null, 'VOUCHER_EXPIRY_APPROACHING', 'voucherExpiryDays');
    const rows = await this.prisma.voucherInstance.groupBy({ by: ['voucherId', 'organizationId'], where: { status: 'ACTIVE', expiresAt: { gt: now, lte: new Date(now.getTime() + days * D) } }, _count: { _all: true } });
    let n = 0;
    for (const r of rows) n += await this.count(this.alerts.raise({ code: 'VOUCHER_EXPIRY_APPROACHING', organizationId: r.organizationId, subjectType: 'Voucher', subjectId: r.voucherId, campaignId: r.voucherId, product: 'VOUCHER', data: { count: r._count._all, withinDays: days } }));
    return n;
  }

  /** Points about to expire (a DealDash-level watch item; points carry no cash value). */
  async rewardExpiry(now: Date) {
    const days = await this.t(null, 'REWARD_EXPIRY_APPROACHING', 'rewardExpiryDays');
    const r = await this.prisma.rewardLot.aggregate({ where: { remaining: { gt: 0 }, expiresAt: { gt: now, lte: new Date(now.getTime() + days * D) } }, _sum: { remaining: true }, _count: { _all: true } });
    if (!r._count._all) return 0;
    return this.count(this.alerts.raise({ code: 'REWARD_EXPIRY_APPROACHING', organizationId: null, subjectType: 'RewardLots', subjectId: 'platform', product: 'LOYALTY', data: { points: r._sum.remaining ?? 0, lots: r._count._all, withinDays: days } }));
  }

  async quotations(now: Date) {
    let n = 0;
    const days = await this.t(null, 'QUOTATION_EXPIRING', 'quotationExpiryDays');
    for (const q of await this.prisma.quotation.findMany({ where: { status: 'PENDING_ACCEPTANCE', validUntil: { gt: now, lte: new Date(now.getTime() + days * D) } }, include: { case: { select: { ownerOrganizationId: true, product: true, subjectId: true } } } }))
      n += await this.count(this.alerts.raise({ code: 'QUOTATION_EXPIRING', organizationId: q.case.ownerOrganizationId, subjectType: 'Quotation', subjectId: q.id, campaignId: q.case.subjectId, product: q.case.product, once: true, data: { reference: q.reference, validUntil: q.validUntil?.toISOString() } }));
    return n;
  }

  async invoices(now: Date) {
    let n = 0;
    const days = await this.t(null, 'INVOICE_DUE', 'invoiceDueDays');
    const open = await this.prisma.financeDocument.findMany({ where: { type: { in: ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE'] }, status: { in: [...OPEN_RECEIVABLE_STATUSES] as never }, dueAt: { not: null, lte: new Date(now.getTime() + days * D) } } });
    for (const d of open) {
      const outstanding = d.totalHalalas - d.paidHalalas;
      if (outstanding <= 0) continue;
      const overdue = d.dueAt! < now;
      const data = { number: d.number, outstandingMinor: outstanding, currency: d.currency, dueAt: d.dueAt!.toISOString() };
      n += await this.count(this.alerts.raise({ code: overdue ? 'INVOICE_OVERDUE' : 'INVOICE_DUE', organizationId: d.organizationId, subjectType: 'FinanceDocument', subjectId: d.id, legalEntityId: d.legalEntityId, data }));
      if (overdue) await this.alerts.raise({ code: 'INVOICE_OVERDUE', organizationId: null, subjectType: 'FinanceDocument', subjectId: d.id, data: { ...data, organizationId: d.organizationId } });
    }
    return n;
  }

  /** Amounts eligible for settlement that have waited longer than the configured days. */
  async settlement(now: Date) {
    const days = await this.t(null, 'SETTLEMENT_PENDING', 'settlementPendingDays');
    const rows = await this.prisma.merchantPayableEvent.groupBy({ by: ['organizationId'], where: { type: 'ELIGIBLE', settlementId: null, createdAt: { lte: new Date(now.getTime() - days * D) } }, _sum: { amountHalalas: true }, _count: { _all: true } });
    let n = 0;
    for (const r of rows) {
      const data = { amountMinor: r._sum.amountHalalas ?? 0, items: r._count._all, olderThanDays: days };
      n += await this.count(this.alerts.raise({ code: 'SETTLEMENT_PENDING', organizationId: r.organizationId, subjectType: 'Settlement', subjectId: r.organizationId, data }));
      await this.alerts.raise({ code: 'SETTLEMENT_PENDING', organizationId: null, subjectType: 'Settlement', subjectId: r.organizationId, data: { ...data, organizationId: r.organizationId } });
    }
    return n;
  }

  async integrations(now: Date) {
    const failing = (await this.config.get<{ failingErrorCount?: number }>(CONFIG_KEYS.VISIBILITY_HEALTH))?.failingErrorCount ?? 5;
    let n = 0;
    for (const c of await this.prisma.integrationConnection.findMany({ where: { status: 'ACTIVE', revokedAt: null } })) {
      const last = c.lastSuccessfulSyncAt ?? c.createdAt;
      const stale = now.getTime() - last.getTime() > c.staleAfterMinutes * 60_000;
      const data = { name: c.name, sourceSystem: c.sourceSystem, lastSuccessfulSyncAt: c.lastSuccessfulSyncAt?.toISOString() ?? null, errorCount: c.errorCount };
      if (c.errorCount >= failing) {
        n += await this.count(this.alerts.raise({ code: 'INTEGRATION_ERROR', organizationId: c.organizationId, subjectType: 'IntegrationConnection', subjectId: c.id, data }));
        if (c.organizationId) await this.alerts.raise({ code: 'INTEGRATION_ERROR', organizationId: null, subjectType: 'IntegrationConnection', subjectId: c.id, data: { ...data, organizationId: c.organizationId } });
      } else if (stale) {
        n += await this.count(this.alerts.raise({ code: 'FEED_STALE', organizationId: c.organizationId, subjectType: 'IntegrationConnection', subjectId: c.id, data }));
        if (c.organizationId) await this.alerts.raise({ code: 'FEED_STALE', organizationId: null, subjectType: 'IntegrationConnection', subjectId: c.id, data: { ...data, organizationId: c.organizationId } });
      }
    }
    return n;
  }

  private async ratePerOrg(names: { bad: string; good: string[] }, since: Date) {
    const rows = await this.prisma.analyticsEvent.groupBy({ by: ['organizationId', 'name'], where: { occurredAt: { gte: since }, name: { in: [names.bad, ...names.good] }, organizationId: { not: null } }, _sum: { quantity: true } });
    const m = new Map<string, { bad: number; total: number }>();
    for (const r of rows) {
      const x = m.get(r.organizationId!) ?? { bad: 0, total: 0 };
      const q = r._sum.quantity ?? 0;
      x.total += q;
      if (r.name === names.bad) x.bad += q;
      m.set(r.organizationId!, x);
    }
    return m;
  }

  async payments(now: Date) {
    let n = 0;
    const m = await this.ratePerOrg({ bad: 'VOUCHER_PAYMENT_FAILED', good: ['VOUCHER_PAYMENT_SUCCEEDED'] }, new Date(now.getTime() - D));
    for (const [org, x] of m) {
      if (x.total < (await this.t(org, 'PAYMENT_FAILURES_RISING', 'paymentFailureMinAttempts'))) continue;
      if ((x.bad * 10_000) / x.total >= (await this.t(org, 'PAYMENT_FAILURES_RISING', 'paymentFailureRateBps')))
        n += await this.count(this.alerts.raise({ code: 'PAYMENT_FAILURES_RISING', organizationId: org, subjectType: 'Organization', subjectId: org, product: 'VOUCHER', data: { failed: x.bad, attempts: x.total } }));
    }
    return n;
  }

  async rejections(now: Date) {
    let n = 0;
    const since = new Date(now.getTime() - D);
    for (const [bad, good, product] of [
      ['EXCLUSIVE_REDEMPTION_REJECTED', 'EXCLUSIVE_REDEMPTION_VERIFIED', 'EXCLUSIVE'],
      ['VOUCHER_REDEMPTION_REJECTED', 'VOUCHER_REDEEMED', 'VOUCHER'],
    ] as const) {
      for (const [org, x] of await this.ratePerOrg({ bad, good: [good] }, since)) {
        if (x.total < (await this.t(org, 'REDEMPTION_REJECTIONS_RISING', 'rejectionMinAttempts'))) continue;
        if ((x.bad * 10_000) / x.total >= (await this.t(org, 'REDEMPTION_REJECTIONS_RISING', 'rejectionRateBps')))
          n += await this.count(this.alerts.raise({ code: 'REDEMPTION_REJECTIONS_RISING', organizationId: org, subjectType: 'Organization', subjectId: org, product, variant: product, data: { rejected: x.bad, attempts: x.total } }));
      }
    }
    return n;
  }

  /** Many rejected attempts at one branch in a day (code guessing, staff misuse). */
  async suspiciousBranches(now: Date) {
    let n = 0;
    const rows = await this.prisma.redemptionAttempt.groupBy({ by: ['organizationId', 'branchId'], where: { createdAt: { gte: new Date(now.getTime() - D) }, result: { in: ['INVALID_CODE', 'WRONG_BRANCH', 'ALREADY_REDEEMED', 'INELIGIBLE'] }, branchId: { not: null } }, _count: { _all: true } });
    for (const r of rows) {
      const limit = (await this.t(r.organizationId, 'SUSPICIOUS_BRANCH_ACTIVITY', 'suspiciousBranchFlags')) * 3;
      if (r._count._all < limit) continue;
      const data = { branchId: r.branchId, rejectedAttempts: r._count._all };
      n += await this.count(this.alerts.raise({ code: 'SUSPICIOUS_BRANCH_ACTIVITY', organizationId: r.organizationId, subjectType: 'Branch', subjectId: r.branchId!, branchId: r.branchId, data }));
      await this.alerts.raise({ code: 'SUSPICIOUS_BRANCH_ACTIVITY', organizationId: null, subjectType: 'Branch', subjectId: r.branchId!, branchId: r.branchId, data: { ...data, organizationId: r.organizationId } });
    }
    return n;
  }

  /** Closed cases with exceptions, and live campaigns whose performance and finance counts disagree. */
  async reconciliation(now: Date) {
    let n = 0;
    for (const r of await this.prisma.caseReconciliation.findMany({ where: { status: 'EXCEPTIONS', computedAt: { gte: new Date(now.getTime() - 30 * D) } } })) {
      const c = await this.prisma.commercialCase.findUnique({ where: { id: r.caseId }, select: { ownerOrganizationId: true, reference: true, product: true, subjectId: true } });
      if (!c) continue;
      n += await this.count(this.alerts.raise({ code: 'RECONCILIATION_DIFFERENCE', organizationId: null, subjectType: 'CaseReconciliation', subjectId: r.id, campaignId: c.subjectId, product: c.product, data: { caseReference: c.reference, organizationId: c.ownerOrganizationId } }));
    }
    const recent = await this.prisma.analyticsEvent.groupBy({ by: ['campaignId', 'product'], where: { occurredAt: { gte: new Date(now.getTime() - D) }, campaignId: { not: null }, product: { in: ['EXCLUSIVE', 'WATCH', 'VOUCHER'] }, eventClass: { in: ['VERIFIED_OUTCOME', 'FINANCIAL'] } } });
    for (const r of recent.slice(0, 200)) {
      const link = await this.reporting.financeLinkage(r.product as 'EXCLUSIVE' | 'WATCH' | 'VOUCHER', r.campaignId!);
      if (link.status !== 'DIFFERENCE') continue;
      const c = r.product === 'EXCLUSIVE' ? await this.prisma.hotDeal.findUnique({ where: { id: r.campaignId! }, select: { organizationId: true } }) : r.product === 'WATCH' ? await this.prisma.watchCampaign.findUnique({ where: { id: r.campaignId! }, select: { organizationId: true } }) : await this.prisma.voucher.findUnique({ where: { id: r.campaignId! }, select: { organizationId: true } });
      n += await this.count(this.alerts.raise({ code: 'RECONCILIATION_DIFFERENCE', organizationId: null, subjectType: 'CampaignLinkage', subjectId: r.campaignId!, campaignId: r.campaignId, product: r.product, data: { organizationId: c?.organizationId ?? null, lines: link.lines.filter((l) => !l.matches) as unknown as Prisma.InputJsonValue } }));
    }
    return n;
  }

  /** Live campaigns with no engagement at all in the configured window. */
  async lowActivity(now: Date) {
    let n = 0;
    const check = async (org: string, product: string, id: string, title: string, liveSince: Date | null) => {
      const hours = await this.t(org, 'CAMPAIGN_LOW_ACTIVITY', 'lowActivityHours');
      if (!liveSince || now.getTime() - liveSince.getTime() < hours * H) return;
      const any = await this.prisma.analyticsEvent.count({ where: { campaignId: id, occurredAt: { gte: new Date(now.getTime() - hours * H) } } });
      if (!any) n += await this.count(this.alerts.raise({ code: 'CAMPAIGN_LOW_ACTIVITY', organizationId: org, subjectType: 'Campaign', subjectId: id, campaignId: id, product, data: { title, windowHours: hours } }));
    };
    for (const c of await this.prisma.liveDeal.findMany({ where: { status: 'LIVE' }, select: { id: true, organizationId: true, titleEn: true, publishedAt: true } })) await check(c.organizationId, 'LIVE', c.id, c.titleEn, c.publishedAt);
    for (const c of await this.prisma.hotDeal.findMany({ where: { status: 'LIVE' }, select: { id: true, organizationId: true, titleEn: true, startAt: true } })) await check(c.organizationId, 'EXCLUSIVE', c.id, c.titleEn, c.startAt);
    for (const c of await this.prisma.voucher.findMany({ where: { status: 'ON_SALE' }, select: { id: true, organizationId: true, titleEn: true, publishedAt: true } })) await check(c.organizationId, 'VOUCHER', c.id, c.titleEn, c.publishedAt);
    for (const c of await this.prisma.watchCampaign.findMany({ where: { status: 'LIVE' }, select: { id: true, organizationId: true, titleEn: true, publishedAt: true } })) await check(c.organizationId, 'WATCH', c.id, c.titleEn, c.publishedAt);
    return n;
  }

  async fundingRequired() {
    let n = 0;
    for (const c of await this.prisma.commercialCase.findMany({ where: { status: { in: ['AWAITING_FUNDING', 'PARTIALLY_FUNDED'] }, developmentFixture: false } }))
      n += await this.count(this.alerts.raise({ code: 'FUNDING_REQUIRED', organizationId: c.ownerOrganizationId, subjectType: 'CommercialCase', subjectId: c.id, campaignId: c.subjectId, product: c.product, data: { caseReference: c.reference, maxCashMinor: c.maxCashHalalas } }));
    return n;
  }

  /** A business named as fulfilment merchant or sponsor that has not accepted yet. */
  async approvalsRequired() {
    let n = 0;
    for (const c of await this.prisma.commercialCase.findMany({ where: { status: 'AWAITING_ACCEPTANCE', currentQuotationId: { not: null } }, take: 200 })) {
      const q = await this.prisma.quotation.findUnique({ where: { id: c.currentQuotationId! }, include: { acceptances: true } });
      if (!q) continue;
      for (const p of (q.requiredParties as unknown as Array<{ role: string; organizationId: string }>) ?? []) {
        if (p.role === 'OWNER' || q.acceptances.some((a) => a.organizationId === p.organizationId && a.role === p.role)) continue;
        n += await this.count(this.alerts.raise({ code: 'MERCHANT_APPROVAL_REQUIRED', organizationId: p.organizationId, subjectType: 'Quotation', subjectId: q.id, campaignId: c.subjectId, product: c.product, variant: p.role, data: { reference: q.reference, role: p.role } }));
      }
    }
    return n;
  }
}
