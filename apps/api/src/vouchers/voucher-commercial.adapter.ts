import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { CommercialRegistry, type CommercialAdapter } from '../finance/commercial.registry';
import type { Economics } from '../finance/quote.calculator';
import { parseVoucherContent } from './voucher-content';

/**
 * Voucher adapter. The customer pays the merchant's selling price; the saving (face value minus price) is the merchant's
 * non-cash benefit commitment. DealDash's commission is a charge netted from what it pays the merchant, never a cash call.
 */
@Injectable()
export class VoucherCommercialAdapter implements CommercialAdapter, OnModuleInit {
  readonly product = 'VOUCHER' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CommercialRegistry,
  ) {}

  onModuleInit() {
    this.registry.register(this);
  }

  async load(subjectId: string) {
    const v = await this.prisma.voucher.findUnique({ where: { id: subjectId } });
    if (!v) throw AppError.notFound();
    const c = parseVoucherContent(v.content);
    return {
      id: v.id,
      organizationId: v.organizationId,
      title: c.title,
      status: v.status,
      finished: v.status === 'ENDED' || v.status === 'REJECTED',
      content: v.content,
    };
  }

  async economics(
    organizationId: string,
    content: unknown,
    subjectId: string | null,
  ): Promise<Economics> {
    const c = parseVoucherContent(content);
    const k = c.commercial;
    let units = c.totalQty;
    if (subjectId) {
      const v = await this.prisma.voucher.findUnique({
        where: { id: subjectId },
        select: { totalQty: true },
      });
      if (v) units = Math.max(units, v.totalQty);
    }
    const benefit = Math.max(0, c.faceValueHalalas - c.sellingPriceHalalas);
    return {
      currency: 'SAR',
      maxUnits: units,
      unitLabel: 'VOUCHER',
      base: {
        SELLING_PRICE: c.sellingPriceHalalas,
        FACE_VALUE: c.faceValueHalalas,
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
      validity: { startAt: c.saleStartAt, endAt: c.saleEndAt },
      inventory: { total: units, dailyQuota: k.dailyQuota },
    };
  }

  async inventory(subjectId: string) {
    const [v, groups] = await Promise.all([
      this.prisma.voucher.findUnique({ where: { id: subjectId }, select: { totalQty: true } }),
      this.prisma.voucherInstance.groupBy({
        by: ['status'],
        where: { voucherId: subjectId },
        _count: true,
      }),
    ]);
    const n = (s: string) => groups.find((g) => g.status === s)?._count ?? 0;
    return {
      configured: v?.totalQty ?? 0,
      issued: groups.reduce((a, g) => a + g._count, 0),
      redeemed: n('REDEEMED'),
      expiredOrUnused: n('EXPIRED'),
      invalidOrCancelled: n('REFUNDED') + n('VOIDED'),
    };
  }
}
