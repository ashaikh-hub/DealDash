import { Injectable, type OnModuleInit } from '@nestjs/common';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { CommercialRegistry, type CommercialAdapter } from '../finance/commercial.registry';
import type { Economics } from '../finance/quote.calculator';
import { parseHotContent } from './hot-content';

/** Exclusive Deals adapter (legacy internal name: hot-*) for the shared Commercial Governance & Finance platform. */
@Injectable()
export class HotCommercialAdapter implements CommercialAdapter, OnModuleInit {
  readonly product = 'EXCLUSIVE' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CommercialRegistry,
    private readonly markets: MarketService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async load(subjectId: string) {
    const d = await this.prisma.hotDeal.findUnique({ where: { id: subjectId } });
    if (!d) throw AppError.notFound();
    const c = parseHotContent(d.content);
    return {
      id: d.id,
      organizationId: d.organizationId,
      title: c.title,
      status: d.status,
      finished: ['EXPIRED', 'CANCELLED', 'REJECTED'].includes(d.status),
      content: d.content,
    };
  }

  async economics(
    organizationId: string,
    content: unknown,
    subjectId: string | null,
  ): Promise<Economics> {
    const c = parseHotContent(content);
    const k = c.commercial;
    let units = c.allocations.reduce((n, a) => n + a.units, 0);
    if (subjectId) {
      // an approved deal's stock may have been raised after approval: the live inventory is the truth
      const inv = await this.prisma.hotDealInventory.findMany({
        where: { dealId: subjectId, tracked: true },
      });
      const live = inv.reduce((n, i) => n + i.total, 0);
      if (live > 0) units = Math.max(units, live);
    }
    if (units === 0 && k.maxRedemptions) units = k.maxRedemptions;
    const hasPrices = k.normalPriceHalalas !== null && k.dealPriceHalalas !== null;
    const benefit = hasPrices
      ? Math.max(0, (k.normalPriceHalalas ?? 0) - (k.dealPriceHalalas ?? 0))
      : (k.benefitValueHalalas ?? 0);
    return {
      // the campaign's market decides the currency (Market / Country Configuration), never a fixed country
      currency: (await this.markets.profileOfCampaign(organizationId, content)).currency,
      maxUnits: units,
      unitLabel: 'REDEMPTION',
      base: {
        SELLING_PRICE: k.dealPriceHalalas ?? 0,
        FACE_VALUE: k.normalPriceHalalas ?? 0,
        BENEFIT_VALUE: benefit,
        MEDIA_SPEND_TOTAL: 0,
      },
      customerBenefitPerUnit: benefit,
      sponsors: k.sponsors.map((s) => ({
        organizationId: s.organizationId,
        perUnitHalalas: s.perUnitHalalas,
        trigger: s.trigger,
      })),
      merchantCashPerUnit: k.merchantCashPerUnitHalalas,
      // Stage 7: a partner-created campaign is owned commercially by the partner (Campaign Creator); the merchant that holds it fulfils
      ownerOrganizationId: k.creatorOrganizationId ?? organizationId,
      fulfilmentOrganizationId: k.fulfilmentOrganizationId ?? organizationId,
      // "Start as soon as approved" sends the current time with every save: a start that is not in the future means "immediately" and
      // must not change the quotation (otherwise each save would void the owner's acceptance). A scheduled start still re-quotes.
      validity: {
        startAt: c.startAt && new Date(c.startAt).getTime() > Date.now() ? c.startAt : null,
        endAt: c.endAt,
      },
      inventory: { total: units || null, dailyQuota: k.dailyQuota },
    };
  }

  async inventory(subjectId: string) {
    const [inv, res, redeemed] = await Promise.all([
      this.prisma.hotDealInventory.findMany({ where: { dealId: subjectId } }),
      this.prisma.reservation.groupBy({
        by: ['status'],
        where: { dealId: subjectId },
        _sum: { quantity: true },
      }),
      this.prisma.redemption.count({ where: { dealId: subjectId, status: 'REDEEMED' } }),
    ]);
    const sum = (s: string) => res.find((r) => r.status === s)?._sum.quantity ?? 0;
    return {
      configured: inv.reduce((n, i) => n + i.total, 0),
      issued: res.reduce((n, r) => n + (r._sum.quantity ?? 0), 0),
      redeemed,
      expiredOrUnused: sum('EXPIRED'),
      invalidOrCancelled: sum('CANCELLED'),
    };
  }
}
