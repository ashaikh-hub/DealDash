import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { parseHotContent } from './hot-content';
import { HotCoreService } from './hot-core.service';
import { RedemptionService } from './redemption.service';
import { ReservationsService } from './reservations.service';

const maskMobile = (m: string | null) => (m ? `${m.slice(0, 4)}•••${m.slice(-3)}` : null);

/**
 * DealDash Operations / Support tools for reservations: customer restrictions (review and lift), lookup and cancellation
 * of a reservation, and redemption reversal. All gated by `admin.reservations.manage` and audited.
 */
@Injectable()
export class AdminReservationsService {
  constructor(
    private readonly core: HotCoreService,
    private readonly reservations: ReservationsService,
    private readonly redemptions: RedemptionService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  // ---------------------------------------------------------------- restrictions
  async listRestrictions(q: {
    limit: number;
    cursor?: string;
    status?: 'ACTIVE' | 'LIFTED' | 'ENDED';
  }) {
    const page = await keysetPage({
      findMany: (query) => this.prisma.customerRestriction.findMany(query),
      baseWhere: { ...(q.status ? { status: q.status } : {}) },
      sort: { field: 'createdAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: page.items.map((r) => r.userId) } },
      select: { id: true, displayName: true, mobile: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return new Page(
      page.items.map((r) => ({
        id: r.id,
        status: r.status,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        reason: r.reason,
        strikes: r.strikes,
        liftedReason: r.liftedReason,
        customer: {
          userId: r.userId,
          displayName: byId.get(r.userId)?.displayName ?? '',
          mobileMasked: maskMobile(byId.get(r.userId)?.mobile ?? null),
        },
      })),
      page.nextCursor,
    );
  }

  async lift(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    const r = await this.prisma.customerRestriction.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    if (r.status !== 'ACTIVE')
      throw new AppError('INVALID_STATE', 'This restriction is no longer active', 409);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.customerRestriction.updateMany({
        where: { id, status: 'ACTIVE' },
        data: {
          status: 'LIFTED',
          liftedAt: new Date(),
          liftedByUserId: actor.userId,
          liftedReason: reason,
        },
      });
      if (res.count !== 1)
        throw new AppError('INVALID_STATE', 'This restriction is no longer active', 409);
      await this.core.audit.record(
        {
          action: 'customer.restriction_lifted',
          entityType: 'CustomerRestriction',
          entityId: id,
          reason,
          actor,
          meta,
        },
        tx,
      );
    });
    return { id, status: 'LIFTED' as const };
  }

  // ---------------------------------------------------------------- reservations
  /** Find by the customer's reference (DD-XXXXXX) or the last characters of the manual code. */
  async search(q: { q: string; limit: number }) {
    const term = q.q
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '');
    if (term.length < 4) return [];
    const where: Prisma.ReservationWhereInput = term.startsWith('DD-')
      ? { reference: term }
      : { manualCode: { endsWith: term.replace(/-/g, '') } };
    const rows = await this.prisma.reservation.findMany({
      where,
      include: { deal: true, branch: true },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      quantity: r.quantity,
      dealId: r.dealId,
      dealTitle: parseHotContent(r.deal.content).title,
      organizationId: r.organizationId,
      branch: { en: r.branch.nameEn, ar: r.branch.nameAr },
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
      redeemedAt: r.redeemedAt ? r.redeemedAt.toISOString() : null,
    }));
  }

  async cancelReservation(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    return this.reservations.cancel(id, 'DEALDASH', actor, {}, reason, meta);
  }

  async redemptionsFor(reservationId: string) {
    const rows = await this.prisma.redemption.findMany({
      where: { reservationId },
      orderBy: { redeemedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      source: r.source,
      redeemedAt: r.redeemedAt.toISOString(),
      reversedAt: r.reversedAt ? r.reversedAt.toISOString() : null,
      reverseReason: r.reverseReason,
    }));
  }

  reverse(actor: Actor, redemptionId: string, reason: string, meta: RequestMeta) {
    return this.redemptions.reverse(actor, redemptionId, reason, { byDealDash: true }, meta);
  }
}
