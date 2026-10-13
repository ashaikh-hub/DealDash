import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface ResolvedPrice {
  /** Total for `quantity` (null = no resolvable amount: negotiated or indicative only). */
  amountMinor: number | null;
  unitRateMinor: number | null;
  currency: string;
  /** The version(s) that governed the price, kept on every event: PLV:<plan version>, PIV:<price version>, CR:<contract rate>, PRM:<promotion>. */
  pricingVersionKey: string;
  source: 'CONTRACT_RATE' | 'PROMOTION' | 'PLAN_VERSION' | 'PRICE_BOOK';
  indicative: boolean;
  waived: boolean;
  adjustments: Array<{
    kind: 'DISCOUNT' | 'WAIVER' | 'PROMOTION' | 'NEGOTIATED_RATE';
    ref: string;
    amountMinor?: number;
    bps?: number;
  }>;
}

interface PriceRow {
  model: string;
  amountMinor: number | null;
  rateBps: number | null;
  tiers?: unknown;
  minAmountMinor?: number | null;
  maxAmountMinor?: number | null;
}

const inForce = (r: { effectiveFrom: Date; effectiveUntil: Date | null }, at: Date) =>
  r.effectiveFrom <= at && (r.effectiveUntil === null || r.effectiveUntil > at);

/** Applies a price model to a quantity (and, for a percentage model, to the amount it is a percentage of). */
export function applyModel(
  row: PriceRow,
  quantity: number,
  baseMinor?: number,
): { total: number | null; unit: number | null } {
  switch (row.model) {
    case 'FIXED':
      return { total: row.amountMinor, unit: row.amountMinor };
    case 'PER_UNIT':
      return row.amountMinor === null
        ? { total: null, unit: null }
        : { total: row.amountMinor * quantity, unit: row.amountMinor };
    case 'PERCENT_BPS': {
      if (row.rateBps === null || baseMinor === undefined) return { total: null, unit: null };
      let amount = Math.round((baseMinor * row.rateBps) / 10_000);
      if (row.minAmountMinor != null) amount = Math.max(amount, row.minAmountMinor);
      if (row.maxAmountMinor != null) amount = Math.min(amount, row.maxAmountMinor);
      return { total: amount, unit: amount };
    }
    case 'TIERED': {
      const tiers = (Array.isArray(row.tiers) ? row.tiers : []) as Array<{
        upTo: number | null;
        amountMinor: number;
      }>;
      const t = tiers.find((x) => x.upTo === null || quantity <= x.upTo) ?? tiers[tiers.length - 1];
      return t
        ? { total: t.amountMinor * quantity, unit: t.amountMinor }
        : { total: null, unit: null };
    }
    default:
      return { total: null, unit: null };
  }
}

/**
 * ONE place where a commercial price is resolved. Precedence: the contract's negotiated rate, then a promotion, then the plan version,
 * then the market price book. A discount or waiver on a contract rate is applied last. Nothing is overwritten: every result names the
 * version that governed it, and that key is stored on the event that used it. Campaign charges keep their own pricing (quotations).
 */
@Injectable()
export class PricingResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly markets: MarketService,
  ) {}

  private async contractRate(
    contractId: string | null | undefined,
    itemCode: string,
    at: Date,
    db: Db = this.prisma,
  ) {
    if (!contractId) return null;
    const rows = await db.contractRate.findMany({
      where: { contractId, itemCode, effectiveFrom: { lte: at } },
      orderBy: { version: 'desc' },
    });
    return rows.find((r) => inForce(r, at)) ?? null;
  }

  private async promotion(
    contractId: string | null | undefined,
    itemCode: string,
    at: Date,
    db: Db = this.prisma,
  ) {
    if (!contractId) return null;
    return db.contractPromotion.findFirst({
      where: { contractId, itemCode, status: 'ACTIVE', startAt: { lte: at }, endAt: { gt: at } },
      orderBy: { startAt: 'desc' },
    });
  }

  /** The base subscription / licence price of a contract for its cadence. */
  async subscription(
    contractId: string,
    at = new Date(),
    cadence?: string,
    db: Db = this.prisma,
  ): Promise<ResolvedPrice> {
    const c = await db.contract.findUnique({
      where: { id: contractId },
      include: { planVersion: { include: { plan: true } } },
    });
    if (!c) throw AppError.notFound();
    // the contract's currency, else its plan's, else its market's (never a fixed country)
    const currency =
      c.currency ??
      c.planVersion?.currency ??
      (await this.markets.currencyFor(c.organizationId, c.market ?? c.planVersion?.market, db));
    const cad =
      cadence ??
      (c.billingCadence !== 'NONE'
        ? c.billingCadence
        : (c.planVersion?.defaultCadence ?? 'MONTHLY'));
    const adjustments: ResolvedPrice['adjustments'] = [];
    let key = c.planVersionId ? `PLV:${c.planVersionId}` : (c.pricingVersionKey ?? 'NONE');
    let source: ResolvedPrice['source'] = 'PLAN_VERSION';
    let amount: number | null = null;
    let indicative = false;
    const points = (Array.isArray(c.planVersion?.prices) ? c.planVersion!.prices : []) as Array<{
      cadence: string;
      amountMinor: number;
      indicative?: boolean;
    }>;
    const point = points.find((p) => p.cadence === cad);
    if (point) {
      amount = point.amountMinor;
      indicative = !!point.indicative;
    } else if (c.planVersion?.plan.isFree) amount = 0; // a free plan costs nothing (a negotiated plan without a price has no amount yet)
    const rate = await this.contractRate(contractId, 'SUBSCRIPTION', at, db);
    if (rate) {
      source = 'CONTRACT_RATE';
      key = `CR:${rate.id}`;
      amount = applyModel(rate, 1).total;
      indicative = false;
      adjustments.push({ kind: 'NEGOTIATED_RATE', ref: rate.id, amountMinor: amount ?? undefined });
    }
    const promo = await this.promotion(contractId, 'SUBSCRIPTION', at, db);
    let waived = false;
    if (promo) {
      key = `${key}+PRM:${promo.id}`;
      source = 'PROMOTION';
      if (promo.waived) {
        waived = true;
        amount = 0;
        adjustments.push({ kind: 'WAIVER', ref: promo.id });
      } else if (promo.promoPriceMinor != null) {
        amount = promo.promoPriceMinor;
        adjustments.push({ kind: 'PROMOTION', ref: promo.id, amountMinor: promo.promoPriceMinor });
      } else if (promo.discountBps != null && amount != null) {
        amount = Math.round((amount * (10_000 - promo.discountBps)) / 10_000);
        adjustments.push({ kind: 'DISCOUNT', ref: promo.id, bps: promo.discountBps });
      }
    }
    if (rate?.waived) {
      waived = true;
      amount = 0;
      adjustments.push({ kind: 'WAIVER', ref: rate.id });
    } else if (rate?.discountBps != null && amount != null) {
      amount = Math.round((amount * (10_000 - rate.discountBps)) / 10_000);
      adjustments.push({ kind: 'DISCOUNT', ref: rate.id, bps: rate.discountBps });
    }
    return {
      amountMinor: amount,
      unitRateMinor: amount,
      currency,
      pricingVersionKey: key,
      source,
      indicative,
      waived,
      adjustments,
    };
  }

  /** A one-off fee of the contract's plan (setup, integration, API ...), after negotiated rates, waivers and promotions. */
  async fee(
    contractId: string,
    feeCode: string,
    at = new Date(),
    db: Db = this.prisma,
  ): Promise<ResolvedPrice> {
    const c = await db.contract.findUnique({
      where: { id: contractId },
      include: { planVersion: true },
    });
    if (!c) throw AppError.notFound();
    // the contract's currency, else its plan's, else its market's (never a fixed country)
    const currency =
      c.currency ??
      c.planVersion?.currency ??
      (await this.markets.currencyFor(c.organizationId, c.market ?? c.planVersion?.market, db));
    const fees = (Array.isArray(c.planVersion?.fees) ? c.planVersion!.fees : []) as Array<{
      code: string;
      amountMinor: number;
      indicative?: boolean;
    }>;
    const fee = fees.find((f) => f.code === feeCode);
    return this.afterAdjustments(
      contractId,
      feeCode,
      at,
      currency,
      db,
      fee
        ? {
            amount: fee.amountMinor,
            key: c.planVersionId ? `PLV:${c.planVersionId}` : 'NONE',
            indicative: !!fee.indicative,
            source: 'PLAN_VERSION',
          }
        : null,
    );
  }

  /** The price of an add-on unit: the plan version's add-on price, else the add-on's price-book item. */
  async addOn(
    contractId: string,
    code: string,
    at = new Date(),
    db: Db = this.prisma,
  ): Promise<ResolvedPrice> {
    const c = await db.contract.findUnique({
      where: { id: contractId },
      include: { planVersion: true },
    });
    if (!c) throw AppError.notFound();
    // the contract's currency, else its plan's, else its market's (never a fixed country)
    const currency =
      c.currency ??
      c.planVersion?.currency ??
      (await this.markets.currencyFor(c.organizationId, c.market ?? c.planVersion?.market, db));
    const prices = (c.planVersion?.addOnPrices ?? {}) as Record<
      string,
      { amountMinor: number; indicative?: boolean }
    >;
    const own = prices[code];
    const def = await db.addOnDefinition.findUnique({ where: { code } });
    let base: {
      amount: number;
      key: string;
      indicative: boolean;
      source: ResolvedPrice['source'];
    } | null = own
      ? {
          amount: own.amountMinor,
          key: `PLV:${c.planVersionId}`,
          indicative: !!own.indicative,
          source: 'PLAN_VERSION',
        }
      : null;
    if (!base && def?.priceItemCode && c.market) {
      const pb = await this.priceBook(def.priceItemCode, c.market, at, db);
      if (pb?.amount != null)
        base = { amount: pb.amount, key: pb.key, indicative: pb.indicative, source: 'PRICE_BOOK' };
    }
    return this.afterAdjustments(contractId, `ADDON:${code}`, at, currency, db, base);
  }

  private async afterAdjustments(
    contractId: string | null,
    itemCode: string,
    at: Date,
    currency: string,
    db: Db,
    base: {
      amount: number;
      key: string;
      indicative: boolean;
      source: ResolvedPrice['source'];
    } | null,
  ): Promise<ResolvedPrice> {
    const adjustments: ResolvedPrice['adjustments'] = [];
    let amount = base?.amount ?? null;
    let key = base?.key ?? 'NONE';
    let source: ResolvedPrice['source'] = base?.source ?? 'PLAN_VERSION';
    let indicative = base?.indicative ?? false;
    let waived = false;
    const rate = await this.contractRate(contractId, itemCode, at, db);
    if (rate) {
      source = 'CONTRACT_RATE';
      key = `CR:${rate.id}`;
      amount = applyModel(rate, 1).total;
      indicative = false;
      adjustments.push({ kind: 'NEGOTIATED_RATE', ref: rate.id, amountMinor: amount ?? undefined });
    }
    const promo = await this.promotion(contractId, itemCode, at, db);
    if (promo) {
      key = `${key}+PRM:${promo.id}`;
      source = 'PROMOTION';
      if (promo.waived || promo.kind === 'SETUP_WAIVER' || promo.kind === 'FREE_ONBOARDING') {
        waived = true;
        amount = 0;
        adjustments.push({ kind: 'WAIVER', ref: promo.id });
      } else if (promo.promoPriceMinor != null) {
        amount = promo.promoPriceMinor;
        adjustments.push({ kind: 'PROMOTION', ref: promo.id, amountMinor: promo.promoPriceMinor });
      } else if (promo.discountBps != null && amount != null) {
        amount = Math.round((amount * (10_000 - promo.discountBps)) / 10_000);
        adjustments.push({ kind: 'DISCOUNT', ref: promo.id, bps: promo.discountBps });
      }
    }
    if (rate?.waived) {
      waived = true;
      amount = 0;
      adjustments.push({ kind: 'WAIVER', ref: rate.id });
    } else if (rate?.discountBps != null && amount != null) {
      amount = Math.round((amount * (10_000 - rate.discountBps)) / 10_000);
      adjustments.push({ kind: 'DISCOUNT', ref: rate.id, bps: rate.discountBps });
    }
    return {
      amountMinor: amount,
      unitRateMinor: amount,
      currency,
      pricingVersionKey: key,
      source,
      indicative,
      waived,
      adjustments,
    };
  }

  /** The published price-book row of an item for a market at a moment. */
  async priceBook(itemCode: string, market: string, at = new Date(), db: Db = this.prisma) {
    const item = await db.priceItem.findUnique({ where: { code: itemCode } });
    if (!item || item.status !== 'ACTIVE') return null;
    const v = await db.priceItemVersion.findFirst({
      where: {
        itemId: item.id,
        market,
        status: 'PUBLISHED',
        effectiveFrom: { lte: at },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
      },
      orderBy: { version: 'desc' },
    });
    if (!v) return null;
    return {
      amount: v.amountMinor,
      row: v,
      key: `PIV:${v.id}`,
      indicative: v.indicative,
      currency: v.currency,
      item,
    };
  }

  /**
   * Price of a product / usage item (a placement, a view, a commission) for an organization. Resolves contract rate, promotion,
   * then the market price book, and applies the quantity (and the base amount for a percentage item).
   */
  async item(input: {
    itemCode: string;
    market: string;
    contractId?: string | null;
    quantity?: number;
    baseMinor?: number;
    at?: Date;
  }): Promise<ResolvedPrice> {
    const at = input.at ?? new Date();
    const qty = input.quantity ?? 1;
    const pb = await this.priceBook(input.itemCode, input.market, at);
    const rate = await this.contractRate(input.contractId, input.itemCode, at);
    const promo = await this.promotion(input.contractId, input.itemCode, at);
    if (!pb && !rate)
      throw new AppError(
        'PRICING_NOT_AVAILABLE',
        `No price is configured for ${input.itemCode} in ${input.market}`,
        404,
      );
    const currency =
      pb?.currency ??
      (
        await this.prisma.contract.findUnique({
          where: { id: input.contractId ?? '' },
          select: { currency: true },
        })
      )?.currency ??
      (await this.markets.profile(input.market)).currency;
    const adjustments: ResolvedPrice['adjustments'] = [];
    let key = pb?.key ?? 'NONE';
    let source: ResolvedPrice['source'] = 'PRICE_BOOK';
    let row: PriceRow | null = pb?.row ?? null;
    let indicative = pb?.indicative ?? false;
    if (rate) {
      row = rate;
      key = `CR:${rate.id}`;
      source = 'CONTRACT_RATE';
      indicative = false;
      adjustments.push({ kind: 'NEGOTIATED_RATE', ref: rate.id });
    }
    let { total, unit } = row ? applyModel(row, qty, input.baseMinor) : { total: null, unit: null };
    // an indicative reference value is never a price to charge
    if (indicative && !rate) {
      total = null;
      unit = null;
    }
    let waived = false;
    if (promo) {
      key = `${key}+PRM:${promo.id}`;
      source = 'PROMOTION';
      if (promo.waived) {
        waived = true;
        total = 0;
        unit = 0;
        adjustments.push({ kind: 'WAIVER', ref: promo.id });
      } else if (promo.promoPriceMinor != null) {
        unit = promo.promoPriceMinor;
        total = promo.promoPriceMinor * (row?.model === 'FIXED' ? 1 : qty);
        adjustments.push({ kind: 'PROMOTION', ref: promo.id, amountMinor: promo.promoPriceMinor });
      } else if (promo.discountBps != null && total != null) {
        total = Math.round((total * (10_000 - promo.discountBps)) / 10_000);
        unit = unit != null ? Math.round((unit * (10_000 - promo.discountBps)) / 10_000) : unit;
        adjustments.push({ kind: 'DISCOUNT', ref: promo.id, bps: promo.discountBps });
      }
    }
    if (rate?.waived) {
      waived = true;
      total = 0;
      unit = 0;
      adjustments.push({ kind: 'WAIVER', ref: rate.id });
    } else if (rate?.discountBps != null && total != null) {
      total = Math.round((total * (10_000 - rate.discountBps)) / 10_000);
      unit = unit != null ? Math.round((unit * (10_000 - rate.discountBps)) / 10_000) : unit;
      adjustments.push({ kind: 'DISCOUNT', ref: rate.id, bps: rate.discountBps });
    }
    return {
      amountMinor: total,
      unitRateMinor: unit,
      currency,
      pricingVersionKey: key,
      source,
      indicative,
      waived,
      adjustments,
    };
  }
}
