import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AppError } from '../common/errors';
import { CommercialRegistry, type CommercialAdapter } from '../finance/commercial.registry';
import type { Economics } from '../finance/quote.calculator';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Loyalty adapter for the shared commercial platform. A rule paid by a business is a SPONSOR FUNDING obligation of that business:
 * the maximum points it may issue x the agreed rate is the amount it prepays, and each issued point draws that funding down.
 */
@Injectable()
export class LoyaltyCommercialAdapter implements CommercialAdapter, OnModuleInit {
  readonly product = 'LOYALTY' as const;
  readonly fundingKind = 'SPONSOR_FUNDING' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CommercialRegistry,
    private readonly markets: MarketService,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async load(subjectId: string) {
    const r = await this.prisma.loyaltyRule.findUnique({ where: { id: subjectId } });
    if (!r) throw AppError.notFound();
    return {
      id: r.id,
      organizationId: r.fundingOrganizationId ?? r.organizationId ?? '',
      title: { en: r.name, ar: r.name },
      status: r.status,
      finished: r.status === 'ENDED' || r.status === 'REJECTED',
      content: {
        maxAllocationPoints: r.maxAllocationPoints ?? 0,
        fundingHalalasPerPoint: r.fundingHalalasPerPoint ?? 0,
        fundingOrganizationId: r.fundingOrganizationId,
      },
    };
  }

  async economics(
    organizationId: string,
    content: unknown,
    subjectId: string | null,
  ): Promise<Economics> {
    const c = content as { maxAllocationPoints?: number; fundingHalalasPerPoint?: number };
    let units = c.maxAllocationPoints ?? 0;
    let rate = c.fundingHalalasPerPoint ?? 0;
    if (subjectId) {
      const r = await this.prisma.loyaltyRule.findUnique({ where: { id: subjectId } });
      if (r) {
        units = Math.max(units, r.maxAllocationPoints ?? 0);
        rate = r.fundingHalalasPerPoint ?? rate;
      }
    }
    return {
      // the campaign's market decides the currency (Market / Country Configuration), never a fixed country
      currency: (await this.markets.profileOfCampaign(organizationId, content)).currency,
      maxUnits: units,
      unitLabel: 'VIEW',
      base: { SELLING_PRICE: 0, FACE_VALUE: 0, BENEFIT_VALUE: 0, MEDIA_SPEND_TOTAL: units * rate },
      customerBenefitPerUnit: 0,
      sponsors: [],
      merchantCashPerUnit: 0,
      ownerOrganizationId: organizationId,
      fulfilmentOrganizationId: organizationId,
      mediaSpend: { totalHalalas: units * rate, perUnitHalalas: rate },
      validity: { startAt: null, endAt: null },
      inventory: { total: units, dailyQuota: null },
    };
  }

  async inventory(subjectId: string) {
    const r = await this.prisma.loyaltyRule.findUnique({ where: { id: subjectId } });
    if (!r) throw AppError.notFound();
    return {
      configured: r.maxAllocationPoints ?? 0,
      issued: r.allocatedPoints,
      redeemed: Math.max(0, r.allocatedPoints - r.reversedPoints),
      expiredOrUnused: Math.max(0, (r.maxAllocationPoints ?? 0) - r.allocatedPoints),
      invalidOrCancelled: r.reversedPoints,
    };
  }
}
