import { Injectable, type OnModuleInit } from '@nestjs/common';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { CommercialRegistry, type CommercialAdapter } from '../finance/commercial.registry';
import type { Economics } from '../finance/quote.calculator';
import { SystemConfigService } from '../system-config/system-config.service';
import { CONFIG_KEYS } from '@dealdash/config';
import { parseWatchContent } from './watch-content';

/**
 * Watch & Earn adapter. The advertiser's media spend (paid views x rate card) is the DealDash charge. The campaign budget is
 * pre-funded and owned by the Watch domain (hard-capped by conditional SQL), so the commitment is adapter-managed: the gate
 * reads required and funded from the campaign rather than from a separate payment.
 */
@Injectable()
export class WatchCommercialAdapter implements CommercialAdapter, OnModuleInit {
  readonly product = 'WATCH' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CommercialRegistry,
    private readonly config: SystemConfigService,
    private readonly markets: MarketService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async load(subjectId: string) {
    const w = await this.prisma.watchCampaign.findUnique({ where: { id: subjectId } });
    if (!w) throw AppError.notFound();
    const c = parseWatchContent(w.content);
    return {
      id: w.id,
      organizationId: w.organizationId,
      title: c.title,
      status: w.status,
      finished: ['COMPLETED', 'EXPIRED', 'CANCELLED', 'REJECTED'].includes(w.status),
      content: w.content,
    };
  }

  async economics(
    organizationId: string,
    content: unknown,
    subjectId: string | null,
  ): Promise<Economics> {
    const c = parseWatchContent(content);
    const market = await this.markets.profileOfCampaign(organizationId, content);
    let perView: number;
    let units = c.paidViews;
    // FD-S7-1: a partner may own the campaign budget (Sponsor / Funder); the merchant that holds the campaign stays its fulfilment party
    let budgetOwner: string | null = null;
    if (subjectId) {
      const w = await this.prisma.watchCampaign.findUnique({ where: { id: subjectId } });
      budgetOwner = w?.sponsorOrganizationId ?? null;
      // once the campaign is priced, the stored rate (not today's rate card) is what was quoted
      perView = w && w.chargePerViewHalalas > 0 ? w.chargePerViewHalalas : await this.rate(market);
      if (w && w.paidViews > units) units = w.paidViews;
    } else perView = await this.rate(market);
    return {
      // the campaign's market decides the currency (Market / Country Configuration), never a fixed country
      currency: market.currency,
      maxUnits: units,
      unitLabel: 'VIEW',
      base: {
        SELLING_PRICE: 0,
        FACE_VALUE: 0,
        BENEFIT_VALUE: 0,
        MEDIA_SPEND_TOTAL: units * perView,
      },
      customerBenefitPerUnit: 0,
      sponsors: [],
      merchantCashPerUnit: 0,
      ownerOrganizationId: budgetOwner ?? organizationId,
      fulfilmentOrganizationId: organizationId,
      mediaSpend: { totalHalalas: units * perView, perUnitHalalas: perView },
      validity: { startAt: c.startAt, endAt: c.endAt },
      inventory: { total: units, dailyQuota: null },
    };
  }

  /** The rate card in the campaign market's currency (same rule as WatchCoreService.rateCardFor; never converted). */
  private async rate(market: { code: string; currency: string }) {
    const r = await this.config.get<{
      chargePerViewHalalas: number;
      currency?: string;
      markets?: Record<string, { chargePerViewHalalas: number }>;
    }>(CONFIG_KEYS.WATCH_RATE_CARD);
    const own = r.markets?.[market.code];
    if (own) return own.chargePerViewHalalas;
    if ((r.currency ?? 'SAR') === market.currency) return r.chargePerViewHalalas;
    throw new AppError(
      'PRICING_NOT_AVAILABLE',
      `No Watch & Earn rate card is configured for ${market.code} (${market.currency})`,
      409,
    );
  }

  async managedFunding(subjectId: string) {
    const w = await this.prisma.watchCampaign.findUnique({ where: { id: subjectId } });
    if (!w) throw AppError.notFound();
    return {
      requiredHalalas: w.requiredBudgetHalalas,
      fundedHalalas: w.fundedHalalas,
      spentHalalas: w.spentHalalas,
    };
  }

  async inventory(subjectId: string) {
    const w = await this.prisma.watchCampaign.findUnique({ where: { id: subjectId } });
    if (!w) throw AppError.notFound();
    return {
      configured: w.paidViews,
      issued: w.qualifiedViews,
      redeemed: w.qualifiedViews,
      expiredOrUnused: Math.max(0, w.paidViews - w.qualifiedViews),
      invalidOrCancelled: 0,
    };
  }
}
