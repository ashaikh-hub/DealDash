import { Injectable } from '@nestjs/common';
import type { MetricKey, PartnerDrillLevel } from '@dealdash/types';
import type { Actor } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CommercialService } from '../finance/commercial.service';
import { InboxService } from '../operations/inbox.service';
import { MarketService } from '../platform/markets/market.service';
import { MetricsService, type GroupColumn } from '../visibility/metrics.service';
import { PartnerAccessService, type PartnerRow } from './partner-access.service';
import { PartnerNetworkService } from './partner-network.service';
import { PartnerOnboardingService } from './partner-onboarding.service';

/** The metrics a partner sees (verified outcomes only; clicks, saves and directions are engagement, never redemptions). */
const KEYS: MetricKey[] = [
  'exclusive.verified_redemptions',
  'exclusive.credentials_issued',
  'voucher.purchases',
  'voucher.sales_value',
  'voucher.redeemed',
  'watch.qualified_views',
  'watch.spend',
  'watch.cpva',
  'loyalty.points_issued',
  'loyalty.points_redeemed',
  'loyalty.points_expired',
  'loyalty.points_reversed',
  'live.member_benefit_redemptions',
];
const ACTIVE = ['LIVE', 'SCHEDULED', 'ON_SALE', 'SOLD_OUT', 'ACTIVE', 'APPROVED'];

/**
 * Partner home and performance, read from the shared Phase 4 metrics (hourly aggregates of verified events) filtered to the campaigns
 * the partner created, sponsors or funds, and from the shared finance records. Forecasts and "expected to date" are labelled ESTIMATE;
 * ROI is never shown because DealDash holds no partner revenue data to compute it from (no figure is invented).
 */
@Injectable()
export class PartnerDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PartnerAccessService,
    private readonly onboarding: PartnerOnboardingService,
    private readonly network: PartnerNetworkService,
    private readonly metrics: MetricsService,
    private readonly commercial: CommercialService,
    private readonly inbox: InboxService,
    private readonly markets: MarketService,
  ) {}

  /** Campaign ids the partner may see metrics for (created, sponsored, loyalty-funded, benefit-carrying), within its markets. */
  async campaignIndex(p: PartnerRow, markets: string[]) {
    const sponsored = await this.prisma.fundingCommitment.findMany({
      where: { organizationId: p.organizationId },
      select: { caseId: true },
    });
    const cases = await this.prisma.commercialCase.findMany({
      where: {
        OR: [
          { ownerOrganizationId: p.organizationId },
          { id: { in: sponsored.map((s) => s.caseId) } },
        ],
        AND: [{ OR: [{ market: null }, { market: { in: markets } }] }],
      },
      select: {
        id: true,
        product: true,
        subjectId: true,
        fulfilmentOrganizationId: true,
        market: true,
        ownerOrganizationId: true,
        currentQuotationId: true,
        status: true,
      },
    });
    const rules = await this.prisma.loyaltyRule.findMany({
      where: { fundingOrganizationId: p.organizationId },
      select: { id: true, campaignId: true, organizationId: true },
    });
    const benefits = await this.prisma.liveDealPartnerBenefit.findMany({
      where: { partnerOrganizationId: p.organizationId, market: { in: markets } },
      select: { liveDealId: true, merchantOrganizationId: true, market: true },
    });
    return {
      cases,
      rules,
      benefits,
      ids: [
        ...new Set([
          ...cases.map((c) => c.subjectId),
          ...rules.map((r) => r.id),
          ...rules.flatMap((r) => (r.campaignId ? [r.campaignId] : [])),
          ...benefits.map((b) => b.liveDealId),
        ]),
      ],
    };
  }

  async home(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    const markets = await this.access.authorizedMarkets(actor, p);
    const [readiness, modules, network, idx] = await Promise.all([
      this.onboarding.readiness(organizationId),
      this.access.modules(p),
      this.network.summary(p),
      this.campaignIndex(p, markets),
    ]);
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    const rows = idx.ids.length
      ? await this.metrics.raw(
          { organizationIds: null, campaignIds: idx.ids, countries: markets, from, to },
          this.metrics.namesFor(KEYS),
        )
      : [];
    const perf = this.metrics.compute(KEYS, rows);
    const statuses = await Promise.all(
      idx.cases.map(async (c) => ({ c, status: await this.subjectStatus(c.product, c.subjectId) })),
    );
    const activeCampaigns = statuses.filter((s) => ACTIVE.includes(s.status)).length;
    const commitments = await this.prisma.fundingCommitment.findMany({
      where: { organizationId, status: 'OPEN' },
    });
    const committed = commitments.reduce((n, m) => n + m.upfrontHalalas + m.usageMaxHalalas, 0);
    const received = commitments.reduce((n, m) => n + m.receivedHalalas, 0);
    const utilized = commitments.reduce(
      (n, m) => n + m.utilizedHalalas + m.upfrontEarnedHalalas,
      0,
    );
    const docs = await this.prisma.financeDocument.findMany({
      where: {
        organizationId,
        type: { in: ['INVOICE', 'TAX_INVOICE'] },
        status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE', 'DISPUTED'] },
      },
      select: { totalHalalas: true, paidHalalas: true, dueAt: true, currency: true, status: true },
    });
    const pos = await this.prisma.financeDocument.findMany({
      where: { organizationId, type: 'PURCHASE_ORDER', status: { notIn: ['CANCELLED', 'VOID'] } },
      select: { id: true, totalHalalas: true },
    });
    const poUsed = pos.length
      ? await this.prisma.financeDocument.aggregate({
          where: {
            purchaseOrderId: { in: pos.map((x) => x.id) },
            status: { notIn: ['CANCELLED', 'VOID', 'DRAFT'] },
          },
          _sum: { totalHalalas: true },
        })
      : null;
    const credit = await this.commercial.creditPosition(organizationId);
    const alerts = await this.prisma.alertEvent.findMany({
      where: { organizationId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, code: true, severity: true, createdAt: true },
    });
    const alertCount = await this.prisma.alertEvent.count({
      where: { organizationId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    });
    const conns = await this.prisma.integrationConnection.findMany({
      where: { organizationId, status: { not: 'REVOKED' } },
      select: {
        id: true,
        name: true,
        status: true,
        lastSuccessfulSyncAt: true,
        staleAfterMinutes: true,
        errorCount: true,
      },
    });
    const tasks = await this.inbox.forOrganization(organizationId).catch(() => []);
    const marketView = (await this.markets.forOrganization(organizationId)).filter((m) =>
      markets.includes(m.code),
    );
    return {
      partner: {
        organizationId,
        nameEn: p.nameEn,
        nameAr: p.nameAr,
        partnerType: p.partnerType,
        lifecycle: p.lifecycle,
      },
      readiness: {
        state: readiness.state,
        missing: readiness.items.filter((i) => i.state === 'MISSING').map((i) => i.check),
      },
      modules,
      markets: marketView.map((m) => ({
        code: m.code,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        status: m.status,
        open: m.open,
      })),
      network,
      campaigns: {
        total: idx.cases.length,
        active: activeCampaigns,
        created: idx.cases.filter((c) => c.ownerOrganizationId === organizationId).length,
        sponsored: idx.cases.filter((c) => c.ownerOrganizationId !== organizationId).length,
        loyaltyRules: idx.rules.length,
        benefits: idx.benefits.length,
      },
      performance: {
        windowDays: 30,
        asOf: await this.metrics.asOf(),
        values: perf,
        roi: null,
        roiNote: 'NO_REVENUE_SOURCE',
      },
      funding: {
        committedHalalas: committed,
        receivedHalalas: received,
        utilizedHalalas: utilized,
        remainingHalalas: Math.max(0, received - utilized),
        currency: 'SAR',
      },
      invoices: {
        open: docs.length,
        overdue: docs.filter((d) => d.status === 'OVERDUE' || (d.dueAt && d.dueAt < to)).length,
        outstandingHalalas: docs.reduce((n, d) => n + d.totalHalalas - d.paidHalalas, 0),
      },
      purchaseOrders: {
        count: pos.length,
        totalHalalas: pos.reduce((n, x) => n + x.totalHalalas, 0),
        usedHalalas: poUsed?._sum.totalHalalas ?? 0,
      },
      credit: {
        limitHalalas: credit.facility?.limitHalalas ?? 0,
        exposureHalalas: credit.exposureHalalas,
        availableHalalas: credit.availableHalalas,
        active: !!credit.facility,
      },
      alerts: {
        open: alertCount,
        latest: alerts.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      },
      integrations: conns.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        stale:
          !c.lastSuccessfulSyncAt ||
          c.lastSuccessfulSyncAt.getTime() < to.getTime() - c.staleAfterMinutes * 60_000,
        errorCount: c.errorCount,
        lastSuccessfulSyncAt: c.lastSuccessfulSyncAt?.toISOString() ?? null,
      })),
      tasks: { open: tasks.length, latest: tasks.slice(0, 5) },
    };
  }

  private async subjectStatus(product: string, id: string): Promise<string> {
    const pick = async () =>
      product === 'EXCLUSIVE'
        ? this.prisma.hotDeal.findUnique({ where: { id }, select: { status: true } })
        : product === 'VOUCHER'
          ? this.prisma.voucher.findUnique({ where: { id }, select: { status: true } })
          : product === 'WATCH'
            ? this.prisma.watchCampaign.findUnique({ where: { id }, select: { status: true } })
            : product === 'LOYALTY'
              ? this.prisma.loyaltyRule.findUnique({ where: { id }, select: { status: true } })
              : null;
    return ((await pick()) as { status: string } | null)?.status ?? 'UNKNOWN';
  }

  /** Drill-down: market, legal entity, merchant, city, branch or campaign, with target / expected / forecast labelled as estimates. */
  async performance(
    actor: Actor,
    organizationId: string,
    q: { by: PartnerDrillLevel; market?: string; merchantOrganizationId?: string; days: number },
  ) {
    const p = await this.access.requirePartner(actor, organizationId);
    let markets = await this.access.authorizedMarkets(actor, p, 'partner.performance.read');
    if (q.market) markets = markets.filter((m) => m === q.market);
    const idx = await this.campaignIndex(p, markets);
    let ids = idx.ids;
    if (q.merchantOrganizationId) {
      const keep = new Set([
        ...idx.cases
          .filter((c) => c.fulfilmentOrganizationId === q.merchantOrganizationId)
          .map((c) => c.subjectId),
        ...idx.benefits
          .filter((b) => b.merchantOrganizationId === q.merchantOrganizationId)
          .map((b) => b.liveDealId),
      ]);
      ids = ids.filter((i) => keep.has(i));
    }
    const to = new Date();
    const from = new Date(to.getTime() - q.days * 86_400_000);
    const group: GroupColumn =
      q.by === 'MARKET'
        ? 'country'
        : q.by === 'MERCHANT'
          ? 'organizationId'
          : q.by === 'BRANCH' || q.by === 'CITY'
            ? 'branchId'
            : 'campaignId';
    const rows = ids.length
      ? await this.metrics.raw(
          { organizationIds: null, campaignIds: ids, countries: markets, from, to },
          this.metrics.namesFor(KEYS),
          group,
        )
      : [];
    const groups = new Map<string, typeof rows>();
    const keyOf = async (g: string): Promise<string> => g;
    for (const r of rows) {
      const k = await keyOf(r.group);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    // labels for each group
    const labels = new Map<string, { en: string; ar: string; extra?: Record<string, unknown> }>();
    if (q.by === 'MERCHANT') {
      const orgs = await this.prisma.organization.findMany({
        where: { id: { in: [...groups.keys()].filter(Boolean) } },
        select: { id: true, nameEn: true, nameAr: true },
      });
      orgs.forEach((o) => labels.set(o.id, { en: o.nameEn, ar: o.nameAr }));
    } else if (q.by === 'BRANCH' || q.by === 'CITY') {
      const bs = await this.prisma.merchantBranch.findMany({
        where: { id: { in: [...groups.keys()].filter(Boolean) } },
        select: { id: true, nameEn: true, nameAr: true, city: true },
      });
      if (q.by === 'CITY') {
        const byCity = new Map<string, typeof rows>();
        for (const [k, v] of groups) {
          const city = bs.find((b) => b.id === k)?.city ?? '';
          byCity.set(city, [...(byCity.get(city) ?? []), ...v]);
        }
        groups.clear();
        for (const [k, v] of byCity) groups.set(k, v);
        for (const k of groups.keys()) labels.set(k, { en: k || '—', ar: k || '—' });
      } else
        bs.forEach((b) =>
          labels.set(b.id, { en: b.nameEn, ar: b.nameAr, extra: { city: b.city } }),
        );
    } else if (q.by === 'LEGAL_ENTITY') {
      // the partner's contracting legal entity of each campaign (its own acceptance), never the merchant's
      const acc = await this.prisma.commercialAcceptance.findMany({
        where: { organizationId, caseId: { in: idx.cases.map((c) => c.id) } },
        select: { caseId: true, legalEntityId: true },
      });
      const leOf = new Map(
        idx.cases.map((c) => [
          c.subjectId,
          acc.find((a) => a.caseId === c.id)?.legalEntityId ?? '',
        ]),
      );
      const byLe = new Map<string, typeof rows>();
      for (const [k, v] of groups) {
        const le = leOf.get(k) ?? '';
        byLe.set(le, [...(byLe.get(le) ?? []), ...v]);
      }
      groups.clear();
      for (const [k, v] of byLe) groups.set(k, v);
      const les = await this.prisma.legalEntity.findMany({
        where: { id: { in: [...groups.keys()].filter(Boolean) }, organizationId },
        select: { id: true, legalName: true, country: true },
      });
      les.forEach((l) =>
        labels.set(l.id, {
          en: `${l.legalName} (${l.country})`,
          ar: `${l.legalName} (${l.country})`,
        }),
      );
    } else if (q.by === 'CAMPAIGN') {
      for (const c of idx.cases) {
        const t = await this.titleOf(c.product, c.subjectId);
        const totals = c.currentQuotationId
          ? ((
              await this.prisma.quotation.findUnique({
                where: { id: c.currentQuotationId },
                select: { totals: true },
              })
            )?.totals as { maxUnits?: number; maxSponsorLiabilityHalalas?: number } | null)
          : null;
        labels.set(c.subjectId, {
          en: t.en,
          ar: t.ar,
          extra: {
            product: c.product,
            market: c.market,
            plannedUnits: totals?.maxUnits ?? null,
            window: t.window,
          },
        });
      }
    }
    const items = [...groups.entries()].map(([k, v]) => {
      const values = this.metrics.compute(KEYS, v);
      const l = labels.get(k);
      const extra = (l?.extra ?? {}) as {
        plannedUnits?: number | null;
        window?: { startAt: string | null; endAt: string | null };
      };
      let estimate: { expectedToDate: number; forecast: number; basis: 'ESTIMATE' } | null = null;
      if (
        q.by === 'CAMPAIGN' &&
        extra.plannedUnits &&
        extra.window?.startAt &&
        extra.window.endAt
      ) {
        const s = new Date(extra.window.startAt).getTime();
        const e = new Date(extra.window.endAt).getTime();
        const frac = Math.min(1, Math.max(0, (to.getTime() - s) / Math.max(1, e - s)));
        const actual =
          (values['exclusive.verified_redemptions'] ?? 0) + (values['voucher.purchases'] ?? 0);
        estimate = {
          expectedToDate: Math.round(extra.plannedUnits * frac),
          forecast: frac > 0 ? Math.round(actual / frac) : 0,
          basis: 'ESTIMATE',
        };
      }
      return {
        key: k,
        labelEn: l?.en ?? (k || '—'),
        labelAr: l?.ar ?? (k || '—'),
        extra: l?.extra ?? null,
        values,
        estimate,
      };
    });
    return {
      by: q.by,
      from: from.toISOString(),
      to: to.toISOString(),
      asOf: await this.metrics.asOf(),
      markets,
      items,
      roi: null,
      roiNote: 'NO_REVENUE_SOURCE',
    };
  }

  private async titleOf(product: string, id: string) {
    if (product === 'EXCLUSIVE') {
      const r = await this.prisma.hotDeal.findUnique({
        where: { id },
        select: { titleEn: true, titleAr: true, startAt: true, endAt: true },
      });
      return {
        en: r?.titleEn ?? '',
        ar: r?.titleAr ?? '',
        window: {
          startAt: r?.startAt?.toISOString() ?? null,
          endAt: r?.endAt?.toISOString() ?? null,
        },
      };
    }
    if (product === 'VOUCHER') {
      const r = await this.prisma.voucher.findUnique({
        where: { id },
        select: { titleEn: true, titleAr: true },
      });
      return { en: r?.titleEn ?? '', ar: r?.titleAr ?? '', window: null };
    }
    if (product === 'LOYALTY') {
      const r = await this.prisma.loyaltyRule.findUnique({ where: { id }, select: { name: true } });
      return { en: r?.name ?? '', ar: r?.name ?? '', window: null };
    }
    const r = await this.prisma.watchCampaign.findUnique({
      where: { id },
      select: { titleEn: true, titleAr: true },
    });
    return { en: r?.titleEn ?? '', ar: r?.titleAr ?? '', window: null };
  }
}
