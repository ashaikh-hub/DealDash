import { Injectable } from '@nestjs/common';
import type { PartnerCreatableProduct, PartnerModule } from '@dealdash/types';
import {
  hotDealContentSchema,
  voucherContentSchema,
  watchContentSchema,
} from '@dealdash/validation';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CommercialService } from '../finance/commercial.service';
import { FilesService } from '../files/files.service';
import { MerchantHotDealsService } from '../hot-deals/merchant-hot-deals.service';
import { MerchantVouchersService } from '../vouchers/merchant-vouchers.service';
import { MarketService } from '../platform/markets/market.service';
import { EntitlementService } from '../platform/entitlement.service';
import { MerchantWatchService } from '../watch/merchant-watch.service';
import { WatchFundingService } from '../watch/watch-funding.service';
import { PartnerAccessService, type PartnerRow } from './partner-access.service';
import { PartnerNetworkService } from './partner-network.service';

/**
 * Campaigns a partner creates, sponsors or funds — always on the SHARED engines (no second campaign engine):
 *
 *  - Exclusive Deals and Vouchers the partner CREATES run on the existing engines at a registered, active merchant of its network
 *    (the fulfilment merchant, whose branches, staff, inventory and redemption are used). The partner is the Campaign Creator and the
 *    commercial OWNER (it accepts DealDash charges); any customer-benefit funding it gives is its SPONSOR line; the merchant approves
 *    its own fulfilment obligations through the shared commercial acceptance (DealDash can never stand in for it). Then the normal
 *    DealDash review, commercial and financial activation gates apply.
 *  - Sponsorship of merchant campaigns, partner-funded loyalty and Watch & Earn points funding use the shared commercial case and
 *    loyalty rules; Live Deal partner benefits have their own service.
 *
 * The engines are called with an in-process `partnerContext` that is set only here, after every partner check.
 */
@Injectable()
export class PartnerCampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PartnerAccessService,
    private readonly network: PartnerNetworkService,
    private readonly commercial: CommercialService,
    private readonly markets: MarketService,
    private readonly files: FilesService,
    private readonly hot: MerchantHotDealsService,
    private readonly vouchers: MerchantVouchersService,
    private readonly watchEngine: MerchantWatchService,
    private readonly watchFunding: WatchFundingService,
    private readonly entitlements: EntitlementService,
  ) {}

  private as(actor: Actor, partnerOrganizationId: string, merchantOrganizationId: string): Actor {
    return { ...actor, partnerContext: { partnerOrganizationId, merchantOrganizationId } };
  }

  /** Content parsed by the engine's own schema; the creator is the partner; only the partner itself may be named as a sponsor. */
  private parse(product: PartnerCreatableProduct, raw: Record<string, unknown>, partnerId: string) {
    const parsed =
      product === 'EXCLUSIVE'
        ? hotDealContentSchema.safeParse(raw)
        : voucherContentSchema.safeParse(raw);
    if (!parsed.success) {
      const i = parsed.error.issues[0]!;
      throw AppError.validation(`${i.path.join('.')}: ${i.message}`, i.path.join('.'));
    }
    const c = parsed.data;
    if (c.commercial.sponsors.some((s) => s.organizationId !== partnerId))
      throw AppError.validation('A partner can only commit its own funding', 'commercial.sponsors');
    if (c.commercial.fulfilmentOrganizationId)
      throw AppError.validation(
        'The merchant that holds the campaign fulfils it',
        'commercial.fulfilmentOrganizationId',
      );
    c.commercial.creatorOrganizationId = partnerId;
    return c;
  }

  /** Every check that comes before an engine write: partner, permission scope, active state, entitlement, network, market. */
  private async preflight(
    actor: Actor,
    organizationId: string,
    product: PartnerModule,
    merchantOrganizationId: string,
    content: unknown,
  ) {
    const p = await this.access.requirePartner(actor, organizationId);
    this.access.requireOperating(p);
    await this.access.requireModule(p, product);
    if (!(await this.network.isRegisteredMember(organizationId, merchantOrganizationId)))
      throw new AppError(
        'PARTNER_MERCHANT_NOT_IN_NETWORK',
        'Choose a registered merchant of your network',
        409,
      );
    const m = await this.prisma.organization.findFirst({
      where: { id: merchantOrganizationId, type: 'MERCHANT', status: 'ACTIVE' },
      include: { merchant: true },
    });
    if (!m?.merchant)
      throw new AppError(
        'PARTNER_MERCHANT_NOT_REGISTERED',
        'This merchant is not an active DealDash merchant',
        409,
      );
    const market = await this.markets.marketOfCampaign(merchantOrganizationId, content);
    await this.access.requireMarket(actor, p, market, 'partner.campaigns.manage');
    return { p, market };
  }

  // ---------------------------------------------------------------- portfolio
  /** Every campaign the partner is part of, by role, in the markets the member may see. */
  async portfolio(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    const markets = await this.access.authorizedMarkets(actor, p, 'partner.campaigns.read');
    const sponsored = await this.prisma.fundingCommitment.findMany({
      where: { organizationId, kind: 'SPONSOR_FUNDING' },
      select: { caseId: true },
    });
    const cases = await this.prisma.commercialCase.findMany({
      where: {
        OR: [
          { ownerOrganizationId: organizationId },
          { id: { in: sponsored.map((s) => s.caseId) } },
        ],
        AND: [{ OR: [{ market: null }, { market: { in: markets } }] }],
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const orgIds = [...new Set(cases.map((c) => c.fulfilmentOrganizationId))];
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const title = async (product: string, id: string) => {
      const r =
        product === 'EXCLUSIVE'
          ? await this.prisma.hotDeal.findUnique({
              where: { id },
              select: { titleEn: true, titleAr: true, status: true },
            })
          : product === 'VOUCHER'
            ? await this.prisma.voucher.findUnique({
                where: { id },
                select: { titleEn: true, titleAr: true, status: true },
              })
            : product === 'WATCH'
              ? await this.prisma.watchCampaign.findUnique({
                  where: { id },
                  select: { titleEn: true, titleAr: true, status: true },
                })
              : product === 'LOYALTY'
                ? await this.prisma.loyaltyRule
                    .findUnique({ where: { id }, select: { name: true, status: true } })
                    .then((x) =>
                      x ? { titleEn: x.name, titleAr: x.name, status: x.status } : null,
                    )
                : null;
      return r ?? { titleEn: '', titleAr: '', status: 'UNKNOWN' };
    };
    const items = [];
    for (const c of cases) {
      const t = await title(c.product, c.subjectId);
      const m = orgs.find((o) => o.id === c.fulfilmentOrganizationId);
      items.push({
        caseId: c.id,
        reference: c.reference,
        product: c.product,
        subjectId: c.subjectId,
        titleEn: t.titleEn,
        titleAr: t.titleAr,
        status: t.status,
        commercialStatus: c.status,
        role: c.ownerOrganizationId === organizationId ? 'CREATOR' : 'SPONSOR',
        merchantOrganizationId: c.fulfilmentOrganizationId,
        merchantNameEn: m?.nameEn ?? null,
        merchantNameAr: m?.nameAr ?? null,
        market: c.market,
        maxCashHalalas: c.maxCashHalalas,
        createdAt: c.createdAt.toISOString(),
      });
    }
    const benefits = await this.prisma.liveDealPartnerBenefit.count({
      where: { partnerOrganizationId: organizationId, market: { in: markets } },
    });
    return { items, benefits, markets };
  }

  // ---------------------------------------------------------------- partner-created Exclusive Deals / Vouchers (shared engines)
  async create(
    actor: Actor,
    organizationId: string,
    b: {
      product: PartnerCreatableProduct;
      merchantOrganizationId: string;
      content: Record<string, unknown>;
    },
    meta: RequestMeta,
  ) {
    const content = this.parse(b.product, b.content, organizationId);
    await this.preflight(actor, organizationId, b.product, b.merchantOrganizationId, content);
    const as = this.as(actor, organizationId, b.merchantOrganizationId);
    const created: { id: string } =
      b.product === 'EXCLUSIVE'
        ? await this.hot.create(as, b.merchantOrganizationId, content as never, meta)
        : await this.vouchers.create(as, b.merchantOrganizationId, content as never, meta);
    // the commercial case (quotation for the partner as owner and the merchant as fulfilment) exists from the start
    const { caseId } = await this.commercial.syncQuotation(b.product, created.id, as);
    return { ...created, caseId };
  }

  /** The engine row of a partner-created campaign (404 for anything the partner did not create). */
  private async own(organizationId: string, product: PartnerCreatableProduct, id: string) {
    const row =
      product === 'EXCLUSIVE'
        ? await this.prisma.hotDeal.findUnique({
            where: { id },
            select: { id: true, organizationId: true, content: true },
          })
        : await this.prisma.voucher.findUnique({
            where: { id },
            select: { id: true, organizationId: true, content: true },
          });
    const creator = (
      row?.content as { commercial?: { creatorOrganizationId?: string | null } } | null
    )?.commercial?.creatorOrganizationId;
    if (!row || creator !== organizationId) throw AppError.notFound();
    return row;
  }

  async get(actor: Actor, organizationId: string, product: PartnerCreatableProduct, id: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    const row = await this.own(organizationId, product, id);
    await this.access.requireMarket(
      actor,
      p,
      await this.markets.marketOfCampaign(row.organizationId, row.content),
      'partner.campaigns.read',
    );
    const as = this.as(actor, organizationId, row.organizationId);
    const view =
      product === 'EXCLUSIVE'
        ? await this.hot.get(as, row.organizationId, id)
        : await this.vouchers.get(as, row.organizationId, id);
    const { caseId } = await this.commercial.syncQuotation(product, id, as);
    // Exclusive Deals: the same stock and paid-reservation monitor the merchant sees (founder UAT 2026-10-16), read-only
    const monitor =
      product === 'EXCLUSIVE' ? await this.hot.monitor(as, row.organizationId, id) : null;
    return { product, merchantOrganizationId: row.organizationId, campaign: view, caseId, monitor };
  }

  async update(
    actor: Actor,
    organizationId: string,
    product: PartnerCreatableProduct,
    id: string,
    raw: Record<string, unknown>,
    expectedVersion: number | undefined,
    meta: RequestMeta,
  ) {
    const row = await this.own(organizationId, product, id);
    const content = this.parse(product, raw, organizationId);
    await this.preflight(actor, organizationId, product, row.organizationId, content);
    const as = this.as(actor, organizationId, row.organizationId);
    return product === 'EXCLUSIVE'
      ? this.hot.update(as, row.organizationId, id, content as never, expectedVersion, meta)
      : this.vouchers.update(as, row.organizationId, id, content as never, expectedVersion, meta);
  }

  /** Submission still needs every party's acceptance (the merchant's included) and the shared DealDash review. */
  async submit(
    actor: Actor,
    organizationId: string,
    product: PartnerCreatableProduct,
    id: string,
    meta: RequestMeta,
  ) {
    const row = await this.own(organizationId, product, id);
    await this.preflight(actor, organizationId, product, row.organizationId, row.content);
    const as = this.as(actor, organizationId, row.organizationId);
    return product === 'EXCLUSIVE'
      ? this.hot.submit(as, row.organizationId, id, meta)
      : this.vouchers.submit(as, row.organizationId, id, meta);
  }

  /** The fulfilment merchant's own approved deal images (the campaign runs at the merchant, under its brand). */
  async merchantAssets(actor: Actor, organizationId: string, merchantOrganizationId: string) {
    await this.access.requirePartner(actor, organizationId);
    if (!(await this.network.isRegisteredMember(organizationId, merchantOrganizationId)))
      throw AppError.notFound();
    const files = await this.prisma.storedFile.findMany({
      where: { organizationId: merchantOrganizationId, kind: 'DEAL_IMAGE', status: 'AVAILABLE' },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: { id: true },
    });
    const urls = await this.files.signedUrls(files.map((f) => f.id));
    const branches = await this.prisma.merchantBranch.findMany({
      where: { organizationId: merchantOrganizationId, status: 'ACTIVE' },
      select: { id: true, nameEn: true, nameAr: true, city: true, country: true },
    });
    // the merchant's own Watch & Earn videos (a partner-owned budget runs the merchant's approved video, under its brand)
    const videos = await this.prisma.storedFile.findMany({
      where: { organizationId: merchantOrganizationId, kind: 'WATCH_VIDEO', status: 'AVAILABLE' },
      orderBy: { createdAt: 'desc' },
      take: 24,
      select: { id: true, originalName: true },
    });
    return {
      images: files.map((f) => ({ fileId: f.id, url: urls.get(f.id) ?? null })),
      branches,
      videos: videos.map((v) => ({ fileId: v.id, name: v.originalName })),
    };
  }

  // ---------------------------------------------------------------- commercial / funding (the shared commercial case)
  async cases(actor: Actor, organizationId: string) {
    await this.access.requirePartner(actor, organizationId);
    return this.commercial.listForOrganization(organizationId);
  }

  /** The case of a campaign the partner created (re-quoted from its saved content) or is a party to (404 otherwise). */
  async caseFor(
    actor: Actor,
    organizationId: string,
    product: 'EXCLUSIVE' | 'VOUCHER' | 'WATCH' | 'LOYALTY',
    subjectId: string,
  ) {
    let caseId: string | null = null;
    if (product === 'EXCLUSIVE' || product === 'VOUCHER') {
      const row = await this.own(organizationId, product, subjectId).catch(() => null);
      if (row)
        caseId = (
          await this.commercial.syncQuotation(
            product,
            subjectId,
            this.as(actor, organizationId, row.organizationId),
          )
        ).caseId;
    }
    caseId ??= await this.commercial.caseIdOf(product, subjectId);
    if (!caseId) throw AppError.notFound();
    return this.caseView(actor, organizationId, caseId);
  }

  async caseView(actor: Actor, organizationId: string, caseId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    const v = await this.commercial.view(caseId, actor, organizationId);
    const c = await this.prisma.commercialCase.findUnique({
      where: { id: caseId },
      select: { market: true },
    });
    if (
      c?.market &&
      !(await this.access.authorizedMarkets(actor, p, 'partner.commercial.read')).includes(c.market)
    )
      throw AppError.notFound();
    return v;
  }

  // ---------------------------------------------------------------- Watch & Earn (partner visibility of sponsored campaigns)
  /** Watch & Earn campaigns the partner funds points on (through its loyalty rules): budget, views, spend and points, aggregate only. */
  async watch(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireModule(p, 'WATCH_SPONSORSHIP');
    const rules = await this.prisma.loyaltyRule.findMany({
      where: {
        fundingOrganizationId: organizationId,
        productScope: 'WATCH',
        campaignId: { not: null },
      },
      orderBy: { createdAt: 'desc' },
    });
    const ids = [...new Set(rules.map((r) => r.campaignId!))];
    const camps = await this.prisma.watchCampaign.findMany({
      where: { id: { in: ids } },
      include: { organization: { select: { nameEn: true, nameAr: true } } },
    });
    return camps.map((c) => {
      const mine = rules.filter((r) => r.campaignId === c.id);
      return {
        id: c.id,
        titleEn: c.titleEn,
        titleAr: c.titleAr,
        merchantNameEn: c.organization.nameEn,
        merchantNameAr: c.organization.nameAr,
        status: c.status,
        paidViews: c.paidViews,
        requiredBudgetHalalas: c.requiredBudgetHalalas,
        fundedHalalas: c.fundedHalalas,
        spentHalalas: c.spentHalalas,
        sponsorRules: mine.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          allocatedPoints: r.allocatedPoints,
          reversedPoints: r.reversedPoints,
          maxAllocationPoints: r.maxAllocationPoints,
        })),
        pointsFunded: mine.reduce((n, r) => n + r.allocatedPoints - r.reversedPoints, 0),
      };
    });
  }

  /** Active Watch & Earn campaigns of the partner's registered network merchants it may sponsor points on. */
  async watchCandidates(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireModule(p, 'WATCH_SPONSORSHIP');
    const ids = await this.network.networkIds(organizationId);
    const orgs = (
      await this.prisma.masterMerchant.findMany({
        where: { id: { in: ids }, registration: 'REGISTERED', organizationId: { not: null } },
        select: { organizationId: true },
      })
    ).map((m) => m.organizationId!);
    const camps = await this.prisma.watchCampaign.findMany({
      where: { organizationId: { in: orgs }, status: { in: ['LIVE', 'SCHEDULED'] } },
      include: { organization: { select: { nameEn: true, nameAr: true } } },
      take: 100,
    });
    return camps.map((c) => ({
      id: c.id,
      titleEn: c.titleEn,
      titleAr: c.titleAr,
      merchantNameEn: c.organization.nameEn,
      merchantNameAr: c.organization.nameAr,
      status: c.status,
    }));
  }

  // ---------------------------------------------------------------- partner-OWNED Watch & Earn budgets (FD-S7-1)
  /**
   * A Watch & Earn campaign whose budget the partner owns (Sponsor / Funder), on the shared Watch engine at a registered merchant of its
   * network (the merchant holds the campaign and its video, and is the fulfilment / reward-provider party). Needs an operating partner,
   * the Watch & Earn module, the WATCH product in the partner's contract in the campaign's market, and then the shared commercial
   * acceptance (the merchant accepts its own part), funding gate and DealDash review. DealDash keeps the points economics,
   * qualification rules, fraud controls and reward rules: the content has no points field and the partner cannot set customer points.
   */
  async createWatch(
    actor: Actor,
    organizationId: string,
    b: { merchantOrganizationId: string; content: Record<string, unknown> },
    meta: RequestMeta,
  ) {
    const parsed = watchContentSchema.safeParse(b.content);
    if (!parsed.success) {
      const i = parsed.error.issues[0]!;
      throw AppError.validation(`${i.path.join('.')}: ${i.message}`, i.path.join('.'));
    }
    const { market } = await this.preflight(
      actor,
      organizationId,
      'WATCH_SPONSORSHIP',
      b.merchantOrganizationId,
      parsed.data,
    );
    await this.entitlements.requireProduct(organizationId, 'WATCH', { market });
    const as = this.as(actor, organizationId, b.merchantOrganizationId);
    const created = await this.watchEngine.create(as, b.merchantOrganizationId, parsed.data, meta);
    const { caseId } = await this.commercial.syncQuotation('WATCH', created.id, as);
    return { campaign: created, caseId };
  }

  /** The Watch & Earn budgets this partner owns, in the markets the member may see. */
  async ownedWatch(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireModule(p, 'WATCH_SPONSORSHIP');
    const markets = await this.access.authorizedMarkets(actor, p, 'partner.campaigns.read');
    const rows = await this.prisma.watchCampaign.findMany({
      where: { sponsorOrganizationId: organizationId },
      include: { organization: { select: { nameEn: true, nameAr: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const out = [];
    for (const c of rows) {
      const market = await this.markets.marketOfCampaign(c.organizationId, c.content);
      if (market && !markets.includes(market)) continue;
      out.push({
        id: c.id,
        titleEn: c.titleEn,
        titleAr: c.titleAr,
        merchantOrganizationId: c.organizationId,
        merchantNameEn: c.organization.nameEn,
        merchantNameAr: c.organization.nameAr,
        status: c.status,
        paidViews: c.paidViews,
        qualifiedViews: c.qualifiedViews,
        requiredBudgetHalalas: c.requiredBudgetHalalas,
        fundedHalalas: c.fundedHalalas,
        spentHalalas: c.spentHalalas,
        market,
      });
    }
    return out;
  }

  /** A Watch & Earn campaign whose budget this partner owns (404 for anything else). */
  private async ownWatch(organizationId: string, id: string) {
    const row = await this.prisma.watchCampaign.findUnique({
      where: { id },
      select: { id: true, organizationId: true, content: true, sponsorOrganizationId: true },
    });
    if (!row || row.sponsorOrganizationId !== organizationId) throw AppError.notFound();
    return row;
  }

  async getWatch(actor: Actor, organizationId: string, id: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    const row = await this.ownWatch(organizationId, id);
    await this.access.requireMarket(
      actor,
      p,
      await this.markets.marketOfCampaign(row.organizationId, row.content),
      'partner.campaigns.read',
    );
    const as = this.as(actor, organizationId, row.organizationId);
    const { caseId } = await this.commercial.syncQuotation('WATCH', id, as);
    return {
      merchantOrganizationId: row.organizationId,
      campaign: await this.watchEngine.get(as, row.organizationId, id),
      caseId,
    };
  }

  /** The partner funds the budget it owns (the shared Watch funding journal, posted to the partner's campaign budget account). */
  async fundWatch(
    actor: Actor,
    organizationId: string,
    id: string,
    amountHalalas: number,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ) {
    const row = await this.ownWatch(organizationId, id);
    await this.preflight(
      actor,
      organizationId,
      'WATCH_SPONSORSHIP',
      row.organizationId,
      row.content,
    );
    const as = this.as(actor, organizationId, row.organizationId);
    await this.watchFunding.fund(as, row.organizationId, id, amountHalalas, {
      source: 'MOCK_PAYMENT',
      idempotencyKey,
      meta,
    });
    return this.watchEngine.get(as, row.organizationId, id);
  }

  async submitWatch(actor: Actor, organizationId: string, id: string, meta: RequestMeta) {
    const row = await this.ownWatch(organizationId, id);
    await this.preflight(
      actor,
      organizationId,
      'WATCH_SPONSORSHIP',
      row.organizationId,
      row.content,
    );
    return this.watchEngine.submit(
      this.as(actor, organizationId, row.organizationId),
      row.organizationId,
      id,
      meta,
    );
  }

  async requireWatchSponsorable(organizationId: string, campaignId: string) {
    const c = await this.prisma.watchCampaign.findUnique({
      where: { id: campaignId },
      select: { organizationId: true },
    });
    if (!c || !(await this.network.isRegisteredMember(organizationId, c.organizationId)))
      throw new AppError(
        'PARTNER_MERCHANT_NOT_IN_NETWORK',
        'Choose a campaign of a registered merchant of your network',
        409,
      );
  }

  summaryOf(p: PartnerRow) {
    return this.prisma.commercialCase.groupBy({
      by: ['status'],
      where: { ownerOrganizationId: p.organizationId },
      _count: true,
    });
  }
}
