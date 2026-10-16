import { Injectable } from '@nestjs/common';
import type { SavingItem, SavingsSummary, SavingState } from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';

type Source = 'RESERVATION' | 'VOUCHER';
type Bi = { en: string; ar: string };

/**
 * "Log my saving" (customer experience, 2026-10-16): after using a deal the customer records what they saved. Only the customer's own
 * REDEEMED reservation or voucher, once each (database unique key), in the redemption's currency. It is the customer's own record for
 * their running total; it never changes money, settlement or the merchant's reports.
 */
@Injectable()
export class SavingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
  ) {}

  /** The redeemed source with its title, merchant, currency and the saving the offer itself states (vouchers: face minus price). */
  private async source(userId: string, type: Source, id: string) {
    if (type === 'RESERVATION') {
      const r = await this.prisma.reservation.findFirst({
        where: { id, userId },
        include: {
          deal: {
            select: {
              titleEn: true,
              titleAr: true,
              organization: { select: { nameEn: true, nameAr: true } },
            },
          },
          branch: { select: { city: true } },
        },
      });
      if (!r) return null;
      const currency =
        r.currency ??
        (await this.markets.profile(await this.markets.marketOfCity(r.branch.city))).currency;
      return {
        redeemed: r.status === 'REDEEMED',
        organizationId: r.organizationId,
        title: { en: r.deal.titleEn, ar: r.deal.titleAr } as Bi,
        merchantName: { en: r.deal.organization.nameEn, ar: r.deal.organization.nameAr } as Bi,
        currency,
        suggestedMinor: null as number | null,
      };
    }
    const v = await this.prisma.voucherInstance.findFirst({
      where: { id, ownerUserId: userId },
      include: {
        voucher: {
          select: {
            titleEn: true,
            titleAr: true,
            currency: true,
            organization: { select: { nameEn: true, nameAr: true } },
          },
        },
      },
    });
    if (!v) return null;
    const saving = v.faceValueHalalas - v.purchasePriceHalalas;
    return {
      redeemed: v.status === 'REDEEMED',
      organizationId: v.organizationId,
      title: { en: v.voucher.titleEn, ar: v.voucher.titleAr } as Bi,
      merchantName: { en: v.voucher.organization.nameEn, ar: v.voucher.organization.nameAr } as Bi,
      currency: v.voucher.currency,
      suggestedMinor: saving > 0 ? saving : null,
    };
  }

  private item(
    row: {
      id: string;
      sourceType: string;
      sourceId: string;
      amountMinor: number;
      currency: string;
      createdAt: Date;
    },
    s: { title: Bi; merchantName: Bi },
  ): SavingItem {
    return {
      id: row.id,
      sourceType: row.sourceType as Source,
      sourceId: row.sourceId,
      title: s.title,
      merchantName: s.merchantName,
      amountMinor: row.amountMinor,
      currency: row.currency,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async state(userId: string, type: Source, id: string): Promise<SavingState> {
    const s = await this.source(userId, type, id);
    if (!s) throw AppError.notFound();
    const row = await this.prisma.customerSaving.findUnique({
      where: { userId_sourceType_sourceId: { userId, sourceType: type, sourceId: id } },
    });
    return {
      canLog: s.redeemed && !row,
      logged: row ? this.item(row, s) : null,
      currency: s.currency,
      suggestedMinor: s.suggestedMinor,
    };
  }

  async log(
    actor: Actor,
    input: { sourceType: Source; sourceId: string; amountMinor: number },
    meta: RequestMeta,
  ): Promise<SavingState> {
    const s = await this.source(actor.userId, input.sourceType, input.sourceId);
    if (!s) throw AppError.notFound();
    if (!s.redeemed)
      throw new AppError('SAVING_NOT_ALLOWED', 'You can log a saving after you use the deal', 422);
    try {
      const row = await this.prisma.customerSaving.create({
        data: {
          userId: actor.userId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          merchantOrganizationId: s.organizationId,
          amountMinor: input.amountMinor,
          currency: s.currency,
        },
      });
      await this.audit.record({
        action: 'customer.saving_logged',
        entityType: 'CustomerSaving',
        entityId: row.id,
        actor,
        subjectOrganizationId: s.organizationId,
        newState: {
          sourceType: input.sourceType,
          amountMinor: input.amountMinor,
          currency: s.currency,
        },
        meta,
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new AppError(
          'SAVING_ALREADY_LOGGED',
          'You already logged the saving for this deal',
          409,
        );
      throw e;
    }
    return this.state(actor.userId, input.sourceType, input.sourceId);
  }

  /** The customer's logged savings with a running total per currency (never added across currencies). */
  async summary(userId: string): Promise<SavingsSummary> {
    const rows = await this.prisma.customerSaving.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const totals = new Map<string, { currency: string; amountMinor: number; count: number }>();
    for (const r of rows) {
      const t = totals.get(r.currency) ?? { currency: r.currency, amountMinor: 0, count: 0 };
      t.amountMinor += r.amountMinor;
      t.count++;
      totals.set(r.currency, t);
    }
    const resIds = rows.filter((r) => r.sourceType === 'RESERVATION').map((r) => r.sourceId);
    const vIds = rows.filter((r) => r.sourceType === 'VOUCHER').map((r) => r.sourceId);
    const [res, vou] = await Promise.all([
      resIds.length
        ? this.prisma.reservation.findMany({
            where: { id: { in: resIds }, userId },
            select: {
              id: true,
              deal: {
                select: {
                  titleEn: true,
                  titleAr: true,
                  organization: { select: { nameEn: true, nameAr: true } },
                },
              },
            },
          })
        : [],
      vIds.length
        ? this.prisma.voucherInstance.findMany({
            where: { id: { in: vIds }, ownerUserId: userId },
            select: {
              id: true,
              voucher: {
                select: {
                  titleEn: true,
                  titleAr: true,
                  organization: { select: { nameEn: true, nameAr: true } },
                },
              },
            },
          })
        : [],
    ]);
    const names = new Map<string, { title: Bi; merchantName: Bi }>();
    for (const r of res)
      names.set(r.id, {
        title: { en: r.deal.titleEn, ar: r.deal.titleAr },
        merchantName: { en: r.deal.organization.nameEn, ar: r.deal.organization.nameAr },
      });
    for (const v of vou)
      names.set(v.id, {
        title: { en: v.voucher.titleEn, ar: v.voucher.titleAr },
        merchantName: { en: v.voucher.organization.nameEn, ar: v.voucher.organization.nameAr },
      });
    const blank = { title: { en: '', ar: '' }, merchantName: { en: '', ar: '' } };
    return {
      totals: [...totals.values()].sort((a, b) => b.amountMinor - a.amountMinor),
      items: rows.map((r) => this.item(r, names.get(r.sourceId) ?? blank)),
    };
  }
}
