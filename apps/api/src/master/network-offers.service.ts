import { Injectable } from '@nestjs/common';
import type { NetworkOfferView } from '@dealdash/validation';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Customer discovery of NETWORK (referenced) offers. An offer is shown only while every condition holds: the source is known, the
 * connection is active and authorised to publish (or the import carried a publication reference), publication rights are confirmed
 * on the record, the feed is not stale, the offer is inside its validity dates and the merchant is active. A network offer is only
 * ever a Live Deal style listing; it never carries a reservation, a voucher or a reward.
 */
@Injectable()
export class NetworkOffersService {
  constructor(private readonly prisma: PrismaService) {}

  async visible(
    q: { country?: string; city?: string; q?: string; limit?: number },
    now = new Date(),
  ): Promise<NetworkOfferView[]> {
    const offers = await this.prisma.referencedOffer.findMany({
      where: {
        status: 'ACTIVE',
        validFrom: { lte: now },
        merchant: { status: 'ACTIVE', ...(q.country ? { country: q.country } : {}) },
        AND: [
          { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
          ...(q.q
            ? [
                {
                  OR: [
                    { titleEn: { contains: q.q, mode: 'insensitive' as const } },
                    { benefitEn: { contains: q.q, mode: 'insensitive' as const } },
                  ],
                },
              ]
            : []),
        ],
      },
      include: { merchant: true },
      orderBy: { validFrom: 'desc' },
      take: Math.min(q.limit ?? 50, 100) * 3,
    });
    if (!offers.length) return [];
    const refs = await this.prisma.externalEntityReference.findMany({
      where: { entityType: 'OFFER', entityId: { in: offers.map((o) => o.id) } },
    });
    const connIds = [...new Set(refs.map((r) => r.connectionId).filter((x): x is string => !!x))];
    const conns = new Map(
      (await this.prisma.integrationConnection.findMany({ where: { id: { in: connIds } } })).map(
        (c) => [c.id, c],
      ),
    );
    const out: NetworkOfferView[] = [];
    for (const o of offers) {
      const r = refs.find((x) => x.entityId === o.id);
      if (!r || !r.publicationConfirmed || r.syncStatus === 'STALE') continue;
      if (r.connectionId) {
        const c = conns.get(r.connectionId);
        if (!c || c.status !== 'ACTIVE' || !c.publicationAuthorized) continue;
      } else if (!r.publicationRef) continue;
      const branches = o.branchIds.length
        ? await this.prisma.masterBranch.findMany({
            where: {
              id: { in: o.branchIds },
              status: 'ACTIVE',
              ...(q.city ? { city: q.city } : {}),
            },
          })
        : [];
      if (q.city && o.branchIds.length && !branches.length) continue;
      out.push({
        id: o.id,
        merchant: {
          id: o.merchantId,
          nameEn: o.merchant.nameEn,
          nameAr: o.merchant.nameAr,
          registered: o.merchant.registration === 'REGISTERED',
        },
        titleEn: o.titleEn,
        titleAr: o.titleAr,
        benefitEn: o.benefitEn,
        benefitAr: o.benefitAr,
        termsEn: o.termsEn,
        termsAr: o.termsAr,
        channel: o.channel,
        validFrom: o.validFrom.toISOString(),
        validUntil: o.validUntil?.toISOString() ?? null,
        categoryCode: o.categoryCode,
        branches: branches.map((b) => ({
          id: b.id,
          nameEn: b.nameEn,
          city: b.city,
          latitude: b.latitude ? Number(b.latitude) : null,
          longitude: b.longitude ? Number(b.longitude) : null,
        })),
      });
      if (out.length >= (q.limit ?? 50)) break;
    }
    return out;
  }
}
