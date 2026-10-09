import { Injectable } from '@nestjs/common';
import { ADVANCED_DIMENSIONS, METRICS, METRIC_KEYS, type MetricKey, type PermissionCode, type ReportDimension } from '@dealdash/types';
import { AppError } from '../common/errors';
import type { Actor } from '../common/request-context';
import { EntitlementService } from '../platform/entitlement.service';
import { AccessScopeService, type CampaignProduct } from '../platform/access-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService, type GroupColumn, type MetricFilter, type RawRow } from './metrics.service';

export type VisProduct = 'LIVE' | 'EXCLUSIVE' | 'VOUCHER' | 'WATCH' | 'LOYALTY';
export const VIS_PRODUCTS: readonly VisProduct[] = ['LIVE', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY'];
const ENTITLEMENT_OF: Record<VisProduct, string> = { LIVE: 'LIVE_DEAL', EXCLUSIVE: 'EXCLUSIVE', VOUCHER: 'VOUCHER', WATCH: 'WATCH', LOYALTY: 'LOYALTY' };
const SCOPE_PRODUCT: Partial<Record<VisProduct, CampaignProduct>> = { LIVE: 'LIVE_DEAL', EXCLUSIVE: 'EXCLUSIVE', VOUCHER: 'VOUCHER', WATCH: 'WATCH' };

/** Who is asking and what they may see (resolved once per request, enforced in every query). */
export interface Access {
  admin: boolean;
  organizationId: string | null;
  organizationIds: string[] | null;
  branchAllowList: Set<string> | null;
  visibleCampaignIds: string[] | null;
  advanced: boolean;
  /** Products currently entitled (business) - history of other products is still shown, flagged. */
  entitled: Set<VisProduct> | null;
}

export interface ReportRequest {
  groupBy: ReportDimension;
  metrics: MetricKey[];
  from: Date;
  to: Date;
  product?: VisProduct;
  campaignId?: string;
  branchId?: string;
  legalEntityId?: string;
  country?: string;
}

const COLUMN: Partial<Record<ReportDimension, GroupColumn>> = {
  ORGANIZATION: 'organizationId',
  COUNTRY: 'country',
  LEGAL_ENTITY: 'legalEntityId',
  BRANCH: 'branchId',
  CAMPAIGN: 'campaignId',
  PRODUCT: 'product',
  DAY: 'day',
};
const UNIT_KIND: Partial<Record<ReportDimension, string>> = { BRAND: 'BRAND', REGION: 'REGION', CITY: 'CITY' };

/**
 * Performance monitoring and hierarchical reporting. Backend enforcement on every call: tenant, role permission, scope (branch /
 * unit / campaign for scoped members), legal entity and product entitlement; drill-downs above branch / campaign need the
 * ADVANCED_REPORTING feature for a business. A click is never shown as a sale: metrics come from the governed taxonomy.
 */
@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly access: AccessScopeService,
    private readonly entitlements: EntitlementService,
  ) {}

  // ---------------------------------------------------------------- access
  async resolve(actor: Actor, orgId: string | null): Promise<Access> {
    if (actor.audience === 'admin') {
      if (!actor.permissions.has('admin.analytics.read')) throw AppError.forbidden();
      return { admin: true, organizationId: orgId, organizationIds: orgId ? [orgId] : null, branchAllowList: null, visibleCampaignIds: null, advanced: true, entitled: null };
    }
    const m = actor.membership;
    if (!m || !orgId || m.organizationId !== orgId || (m.organizationType !== 'MERCHANT' && m.organizationType !== 'PARTNER')) throw AppError.notFound();
    const perm: PermissionCode = m.organizationType === 'PARTNER' ? 'partner.performance.read' : 'merchant.performance.read';
    if (!actor.permissions.has(perm)) throw AppError.forbidden();
    let branchAllowList: Set<string> | null = null;
    let visibleCampaignIds: string[] | null = null;
    if (this.access.isScoped(actor) || m.branchId) {
      branchAllowList = (await this.access.visibleBranches(actor, perm)) ?? new Set(m.branchId ? [m.branchId] : []);
      visibleCampaignIds = [];
      for (const p of Object.values(SCOPE_PRODUCT)) visibleCampaignIds.push(...((await this.access.visibleCampaignIds(actor, p!, orgId)) ?? []));
    }
    const e = await this.entitlements.effective(orgId);
    const entitled = new Set(VIS_PRODUCTS.filter((p) => e.products.includes(ENTITLEMENT_OF[p])));
    return { admin: false, organizationId: orgId, organizationIds: [orgId], branchAllowList, visibleCampaignIds, advanced: e.features.includes('ADVANCED_REPORTING'), entitled };
  }

  private filter(a: Access, r: { from: Date; to: Date; product?: VisProduct; campaignId?: string; branchId?: string; legalEntityId?: string; country?: string }): MetricFilter {
    if (r.to <= r.from) throw AppError.validation('The end must be after the start', 'to');
    if (r.to.getTime() - r.from.getTime() > 400 * 86_400_000) throw AppError.validation('A report covers at most 400 days', 'from');
    return {
      organizationIds: a.organizationIds,
      campaignIds: r.campaignId ? [r.campaignId] : null,
      branchIds: r.branchId ? [r.branchId] : null,
      legalEntityIds: r.legalEntityId ? [r.legalEntityId] : null,
      countries: r.country ? [r.country] : null,
      products: r.product ? [r.product] : null,
      branchAllowList: a.branchAllowList,
      visibleCampaignIds: a.visibleCampaignIds,
      from: r.from,
      to: r.to,
    };
  }

  /** Does this campaign belong to the business (and is it in a scoped member's reach)? 404 otherwise. */
  async assertCampaign(a: Access, product: VisProduct, campaignId: string): Promise<{ organizationId: string; title: { en: string; ar: string } }> {
    const c = await this.campaign(product, campaignId);
    if (!c) throw AppError.notFound();
    if (a.organizationIds && !a.organizationIds.includes(c.organizationId)) throw AppError.notFound();
    if (a.visibleCampaignIds && !a.visibleCampaignIds.includes(campaignId)) throw AppError.notFound();
    return c;
  }

  private async campaign(product: VisProduct, id: string) {
    const sel = { organizationId: true, titleEn: true, titleAr: true } as const;
    const r =
      product === 'LIVE'
        ? await this.prisma.liveDeal.findUnique({ where: { id }, select: sel })
        : product === 'EXCLUSIVE'
          ? await this.prisma.hotDeal.findUnique({ where: { id }, select: sel })
          : product === 'VOUCHER'
            ? await this.prisma.voucher.findUnique({ where: { id }, select: sel })
            : product === 'WATCH'
              ? await this.prisma.watchCampaign.findUnique({ where: { id }, select: sel })
              : null;
    return r ? { organizationId: r.organizationId, title: { en: r.titleEn, ar: r.titleAr } } : null;
  }

  // ---------------------------------------------------------------- product dashboards
  /** Near-real-time product overview: every metric of every product the business has (gauges read live). */
  async overview(a: Access, from: Date, to: Date) {
    const f = this.filter(a, { from, to });
    const keys = METRIC_KEYS;
    const raw = await this.metrics.raw(f, this.metrics.namesFor(keys), 'product');
    const all = this.metrics.compute(keys, raw);
    const gauges = await this.metrics.gauges(keys, { organizationIds: a.organizationIds, campaignIds: a.visibleCampaignIds });
    const withData = new Set(raw.filter((r) => r.count || r.amountMinor || r.points).map((r) => r.group));
    const products = VIS_PRODUCTS.filter((p) => a.admin || a.entitled!.has(p) || withData.has(p)).map((p) => {
      const metrics: Record<string, number | null> = {};
      for (const k of keys) if (METRICS[k].product === p) metrics[k] = METRICS[k].kind === 'GAUGE' ? (gauges[k] ?? null) : (all[k] ?? null);
      return { product: p, entitled: a.admin ? true : a.entitled!.has(p), metrics };
    });
    return { from: from.toISOString(), to: to.toISOString(), asOf: await this.metrics.asOf(), products };
  }

  // ---------------------------------------------------------------- hierarchical reporting
  async report(a: Access, r: ReportRequest) {
    if (!a.advanced && ADVANCED_DIMENSIONS.includes(r.groupBy))
      throw new AppError('ENTITLEMENT_REQUIRED', 'Your contract does not include ADVANCED_REPORTING', 403);
    if (r.groupBy === 'ORGANIZATION' && !a.admin) throw AppError.forbidden();
    const keys = r.metrics.filter((k) => METRICS[k] && METRICS[k].kind !== 'GAUGE' && METRICS[k].kind !== 'UNIQUE');
    if (!keys.length) throw AppError.validation('Choose at least one metric', 'metrics');
    const f = this.filter(a, r);
    const col = COLUMN[r.groupBy] ?? 'branchId';
    const raw = await this.metrics.raw(f, this.metrics.namesFor(keys), col);
    let grouped = new Map<string, RawRow[]>();
    for (const x of raw) grouped.set(x.group, [...(grouped.get(x.group) ?? []), x]);
    if (UNIT_KIND[r.groupBy]) grouped = await this.regroupByUnit(grouped, UNIT_KIND[r.groupBy]!);
    const labels = await this.labels(r.groupBy, [...grouped.keys()]);
    const rows = [...grouped.entries()]
      .map(([key, rows]) => ({ key: key || null, label: labels.get(key) ?? null, metrics: this.metrics.compute(keys, rows) }))
      .sort((x, y) => (x.label?.en ?? x.key ?? '').localeCompare(y.label?.en ?? y.key ?? ''));
    const totals = this.metrics.compute(keys, raw);
    return { groupBy: r.groupBy, metrics: keys, from: r.from.toISOString(), to: r.to.toISOString(), asOf: await this.metrics.asOf(), rows, totals };
  }

  /** Branch groups -> the nearest ancestor unit of a kind (brand / region / city); branches outside the tree are "unassigned". */
  private async regroupByUnit(byBranch: Map<string, RawRow[]>, kind: string) {
    const branchIds = [...byBranch.keys()].filter(Boolean);
    const units = await this.prisma.organizationUnit.findMany({ where: { OR: [{ branchId: { in: branchIds } }, { kind }] }, select: { id: true, path: true, kind: true, branchId: true, city: true } });
    const byId = new Map(units.map((u) => [u.id, u]));
    const out = new Map<string, RawRow[]>();
    for (const [branch, rows] of byBranch) {
      let key = '';
      const u = units.find((x) => x.branchId === branch);
      if (u) {
        for (const id of u.path.split('/').filter(Boolean).reverse()) {
          const x = byId.get(id);
          if (x?.kind === kind) {
            key = x.id;
            break;
          }
        }
        if (!key && kind === 'CITY' && u.city) key = `city:${u.city}`;
      }
      if (!key && kind === 'CITY' && branch) {
        const b = await this.prisma.merchantBranch.findUnique({ where: { id: branch }, select: { city: true } });
        if (b?.city) key = `city:${b.city}`;
      }
      out.set(key, [...(out.get(key) ?? []), ...rows]);
    }
    return out;
  }

  private async labels(dim: ReportDimension, keys: string[]): Promise<Map<string, { en: string; ar: string }>> {
    const ids = keys.filter((k) => /^[0-9a-f-]{36}$/i.test(k));
    const m = new Map<string, { en: string; ar: string }>();
    const p = this.prisma;
    if (dim === 'BRANCH') for (const b of await p.merchantBranch.findMany({ where: { id: { in: ids } }, select: { id: true, nameEn: true, nameAr: true } })) m.set(b.id, { en: b.nameEn, ar: b.nameAr });
    if (dim === 'ORGANIZATION') for (const o of await p.organization.findMany({ where: { id: { in: ids } }, select: { id: true, nameEn: true, nameAr: true } })) m.set(o.id, { en: o.nameEn, ar: o.nameAr });
    if (dim === 'LEGAL_ENTITY') for (const l of await p.legalEntity.findMany({ where: { id: { in: ids } }, select: { id: true, legalName: true } })) m.set(l.id, { en: l.legalName, ar: l.legalName });
    if (dim === 'BRAND' || dim === 'REGION' || dim === 'CITY') for (const u of await p.organizationUnit.findMany({ where: { id: { in: ids } }, select: { id: true, nameEn: true, nameAr: true } })) m.set(u.id, { en: u.nameEn, ar: u.nameAr });
    if (dim === 'CAMPAIGN') {
      const sel = { id: true, titleEn: true, titleAr: true } as const;
      for (const rows of await Promise.all([p.liveDeal.findMany({ where: { id: { in: ids } }, select: sel }), p.hotDeal.findMany({ where: { id: { in: ids } }, select: sel }), p.voucher.findMany({ where: { id: { in: ids } }, select: sel }), p.watchCampaign.findMany({ where: { id: { in: ids } }, select: sel })]))
        for (const r of rows) m.set(r.id, { en: r.titleEn, ar: r.titleAr });
    }
    for (const k of keys) if (k.startsWith('city:')) m.set(k, { en: k.slice(5), ar: k.slice(5) });
    return m;
  }

  // ---------------------------------------------------------------- campaign performance and performance-to-finance linkage
  async campaignPerformance(a: Access, product: VisProduct, campaignId: string, from: Date, to: Date) {
    const c = await this.assertCampaign(a, product, campaignId);
    const keys = METRIC_KEYS.filter((k) => METRICS[k].product === product || (product === 'WATCH' && k === 'watch.points_issued'));
    const f = this.filter({ ...a, branchAllowList: null, visibleCampaignIds: null }, { from, to, campaignId });
    const raw = await this.metrics.raw(f, this.metrics.namesFor(keys));
    const values = this.metrics.compute(keys, raw);
    const gauges = await this.metrics.gauges(keys, { organizationIds: [c.organizationId], campaignIds: [campaignId] });
    for (const k of keys) if (METRICS[k].kind === 'GAUGE') values[k] = gauges[k] ?? null;
    const daily = await this.metrics.raw(f, this.metrics.namesFor(keys), 'day');
    const days = [...new Set(daily.map((d) => d.group))].sort();
    const history = days.map((d) => ({ day: d, metrics: this.metrics.compute(keys, daily.filter((x) => x.group === d)) }));
    return { product, campaignId, title: c.title, organizationId: c.organizationId, from: from.toISOString(), to: to.toISOString(), asOf: await this.metrics.asOf(), metrics: values, history, finance: await this.financeLinkage(product, campaignId) };
  }

  /**
   * Performance counts next to finance counts for the same campaign. A difference is reported (and raised as an alert by the
   * detectors), never silently reconciled.
   */
  async financeLinkage(product: VisProduct, campaignId: string) {
    const p = this.prisma;
    const ev = async (name: string, field: 'quantity' | 'amountMinor' = 'quantity') => {
      const r = await p.analyticsEvent.aggregate({ where: { campaignId, name }, _sum: { quantity: true, amountMinor: true } });
      return field === 'quantity' ? (r._sum.quantity ?? 0) : (r._sum.amountMinor ?? 0);
    };
    const billed = (eventType: string) => p.commercialBillingEvent.count({ where: { campaignId, eventType, status: { not: 'VOID' } } });
    const lines: Array<{ measure: string; performance: number; finance: number; financeSource: string; matches: boolean }> = [];
    const add = (measure: string, performance: number, finance: number, financeSource: string) => lines.push({ measure, performance, finance, financeSource, matches: performance === finance });
    if (product === 'EXCLUSIVE') {
      const redeemed = (await ev('EXCLUSIVE_REDEMPTION_VERIFIED')) - (await ev('EXCLUSIVE_REDEMPTION_REVERSED'));
      const c = await p.commercialCase.findUnique({ where: { product_subjectId: { product: 'EXCLUSIVE', subjectId: campaignId } }, select: { id: true } });
      const util = c ? await p.utilizationEvent.aggregate({ where: { caseId: c.id, reversedAt: null, sourceType: 'REDEMPTION' }, _sum: { units: true } }) : null;
      const inv = await p.hotDealInventory.aggregate({ where: { dealId: campaignId }, _sum: { redeemed: true } });
      add('VERIFIED_REDEMPTIONS', redeemed, inv._sum.redeemed ?? 0, 'INVENTORY');
      if (c) add('UTILIZED_UNITS', redeemed, util?._sum.units ?? 0, 'UTILIZATION');
    } else if (product === 'WATCH') {
      const q = await ev('WATCH_QUALIFIED_VIEW');
      const camp = await p.watchCampaign.findUnique({ where: { id: campaignId }, select: { qualifiedViews: true, spentHalalas: true } });
      add('QUALIFIED_VIEWS', q, camp?.qualifiedViews ?? 0, 'CAMPAIGN_COUNTER');
      add('QUALIFIED_VIEWS_BILLED', q, await billed('QUALIFIED_VIEW_USAGE'), 'BILLING_EVENTS');
      add('SPEND', await ev('WATCH_QUALIFIED_VIEW', 'amountMinor'), camp?.spentHalalas ?? 0, 'CAMPAIGN_BUDGET');
    } else if (product === 'VOUCHER') {
      const paid = (await ev('VOUCHER_PAYMENT_SUCCEEDED', 'amountMinor'));
      const orders = await p.payment.aggregate({ where: { status: { in: ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING'] }, orderId: { in: (await p.voucherOrder.findMany({ where: { voucherId: campaignId }, select: { id: true } })).map((o) => o.id) } }, _sum: { amountHalalas: true } });
      add('CUSTOMER_PAYMENTS', paid, orders._sum.amountHalalas ?? 0, 'PAYMENTS');
      const redeemed = (await ev('VOUCHER_REDEEMED')) - (await ev('VOUCHER_REDEMPTION_REVERSED'));
      add('REDEMPTIONS_BILLED', redeemed, await billed('VOUCHER_TRANSACTION_COMMISSION'), 'BILLING_EVENTS');
    }
    return { status: lines.length === 0 ? 'NOT_APPLICABLE' : lines.every((l) => l.matches) ? 'MATCHED' : 'DIFFERENCE', lines };
  }
}
