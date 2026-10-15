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

  /**
   * RC-52: DealDash resets counted no-show strikes — of one reservation, or every counted strike of a customer — with a reason. Each reset
   * is a reservation event and an audit record; the no-show itself stays in the history. An active restriction is lifted separately.
   */
  async resetStrikes(
    actor: Actor,
    scope: { reservationId: string } | { userId: string },
    reason: string,
    meta: RequestMeta,
    now = new Date(),
  ) {
    const rows = await this.prisma.reservation.findMany({
      where: {
        status: 'EXPIRED',
        noShowCounted: true,
        ...('reservationId' in scope ? { id: scope.reservationId } : { userId: scope.userId }),
      },
      select: { id: true, userId: true, organizationId: true },
    });
    if (!rows.length) {
      if ('reservationId' in scope) {
        const exists = await this.prisma.reservation.count({ where: { id: scope.reservationId } });
        if (!exists) throw AppError.notFound();
      }
      throw new AppError('INVALID_STATE', 'There is no counted no-show to reset', 409);
    }
    const reset = await this.prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const r of rows) {
        const res = await tx.reservation.updateMany({
          where: { id: r.id, status: 'EXPIRED', noShowCounted: true },
          data: {
            noShowCounted: false,
            strikeResetAt: now,
            strikeResetByUserId: actor.userId,
            strikeResetReason: reason,
          },
        });
        if (res.count !== 1) continue; // reset by someone else meanwhile
        ids.push(r.id);
        await tx.reservationEvent.create({
          data: {
            reservationId: r.id,
            type: 'STRIKE_RESET',
            actorUserId: actor.userId,
            actorRole: actor.membership?.roleCode ?? 'DEALDASH',
            note: reason,
          },
        });
        await this.core.audit.record(
          {
            action: 'reservation.strike_reset',
            entityType: 'Reservation',
            entityId: r.id,
            reason,
            actor,
            subjectOrganizationId: r.organizationId,
            previousState: { noShowCounted: true },
            newState: { noShowCounted: false },
            meta,
          },
          tx,
        );
      }
      return ids;
    });
    return { reset: reset.length, reservationIds: reset };
  }

  /** The effective reservation policy for a market / category / business, with where each value comes from (RC-11). */
  effectivePolicy(q: { market: string; categoryId?: string; organizationId?: string }) {
    return this.core.reservationPolicy.effective(q);
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
