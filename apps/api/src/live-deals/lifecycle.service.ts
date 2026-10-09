import { Injectable, Logger } from '@nestjs/common';
import { DealCoreService } from './deal-core.service';

/**
 * Date-driven lifecycle: scheduled deals go live at their start time and deals expire at their end time.
 * Discovery visibility is computed from the dates directly, so customers never see a stale deal even if this sweep
 * is late; the sweep only brings the stored status (and the history) in line with reality.
 */
@Injectable()
export class DealLifecycleService {
  private readonly logger = new Logger('LiveDealLifecycle');

  constructor(private readonly core: DealCoreService) {}

  async sweep(now = new Date()): Promise<{ activated: number; expired: number }> {
    const prisma = this.core.prisma;
    let activated = 0;
    let expired = 0;

    const toExpire = await prisma.liveDeal.findMany({
      where: { status: { in: ['SCHEDULED', 'LIVE', 'PAUSED'] }, endAt: { lte: now } },
      select: { id: true, organizationId: true, status: true },
      take: 500,
    });
    for (const d of toExpire) {
      try {
        await prisma.$transaction(async (tx) => {
          await this.core.transition(tx, d, 'EXPIRED', {
            action: 'EXPIRE',
            actor: null,
            reason: 'End date reached',
            data: { endedAt: now },
          });
          await tx.liveDealRevision.updateMany({
            where: { dealId: d.id, status: { in: ['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES'] } },
            data: { status: 'WITHDRAWN' },
          });
        });
        expired++;
      } catch (e) {
        this.logger.warn(`Could not expire deal ${d.id}: ${(e as Error).message}`);
      }
    }

    const toActivate = await prisma.liveDeal.findMany({
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
        this.logger.warn(`Could not activate deal ${d.id}: ${(e as Error).message}`);
      }
    }
    if (activated || expired) this.logger.log(`Sweep: ${activated} activated, ${expired} expired`);
    return { activated, expired };
  }
}
