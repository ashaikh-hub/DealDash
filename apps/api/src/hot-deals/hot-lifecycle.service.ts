import { Injectable, Logger } from '@nestjs/common';
import { HotCoreService } from './hot-core.service';
import { ReservationsService } from './reservations.service';

/**
 * Date-driven Exclusive Deal lifecycle plus the reservation sweep. Discovery computes visibility from the dates directly,
 * so customers never see a stale deal even if a sweep is late; the sweep brings the stored status (and history) in line
 * and expires holds, releases their units, sends notices and applies the no-show rules.
 */
@Injectable()
export class HotLifecycleService {
  private readonly logger = new Logger('HotDealLifecycle');

  constructor(
    private readonly core: HotCoreService,
    private readonly reservations: ReservationsService,
  ) {}

  async sweep(now = new Date()) {
    const prisma = this.core.prisma;
    let activated = 0;
    let expired = 0;

    const toExpire = await prisma.hotDeal.findMany({
      where: { status: { in: ['SCHEDULED', 'LIVE', 'PAUSED', 'SOLD_OUT'] }, endAt: { lte: now } },
      select: { id: true, organizationId: true, status: true },
      take: 500,
    });
    for (const d of toExpire) {
      try {
        await prisma.$transaction((tx) =>
          this.core.transition(tx, d, 'EXPIRED', {
            action: 'EXPIRE',
            actor: null,
            reason: 'End date reached',
            data: { endedAt: now },
          }),
        );
        expired++;
      } catch (e) {
        this.logger.warn(`Could not expire Exclusive Deal ${d.id}: ${(e as Error).message}`);
      }
    }

    const toActivate = await prisma.hotDeal.findMany({
      where: {
        status: 'SCHEDULED',
        startAt: { lte: now },
        OR: [{ endAt: null }, { endAt: { gt: now } }],
      },
      select: { id: true, organizationId: true, status: true },
      take: 500,
    });
    for (const d of toActivate) {
      try {
        await prisma.$transaction((tx) =>
          this.core.transition(tx, d, 'LIVE', {
            action: 'ACTIVATE',
            actor: null,
            reason: 'Start time reached',
          }),
        );
        activated++;
      } catch (e) {
        this.logger.warn(`Could not activate Exclusive Deal ${d.id}: ${(e as Error).message}`);
      }
    }
    const res = await this.reservations.sweep(now);
    return { activated, dealsExpired: expired, ...res };
  }
}
