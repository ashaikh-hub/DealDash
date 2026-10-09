import { Injectable, Logger } from '@nestjs/common';
import { NotificationsService, type NotificationInput } from '../hot-deals/notifications.service';
import { RewardsLedgerService } from './rewards-ledger.service';
import { WatchCoreService } from './watch-core.service';
import { WatchFundingService } from './watch-funding.service';

/**
 * Background housekeeping for Watch & Earn. Every step is idempotent and safe on several instances at once (conditional
 * updates and idempotency keys decide who wins). Correctness never depends on this job: the schedule and the budget are read
 * directly at start and at qualification; the sweep keeps statuses tidy, closes out budgets and releases held rewards.
 */
@Injectable()
export class WatchLifecycleService {
  private readonly logger = new Logger('WatchLifecycle');

  constructor(
    private readonly core: WatchCoreService,
    private readonly funding: WatchFundingService,
    private readonly rewards: RewardsLedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  async sweep(now = new Date()) {
    const result = {
      activated: 0,
      completed: 0,
      expired: 0,
      abandoned: 0,
      released: 0,
      rewardsExpired: 0,
      reminders: 0,
    };
    const step = async (name: string, fn: () => Promise<number>) => {
      try {
        return await fn();
      } catch (e) {
        this.logger.warn(`${name} failed: ${(e as Error).message}`);
        return 0;
      }
    };
    result.activated = await step('activate', () => this.activateScheduled(now));
    result.completed = await step('completed', () => this.completeExhausted(now));
    result.expired = await step('expire', () => this.endFinished(now));
    result.abandoned = await step('abandoned', () => this.abandonViews(now));
    result.released = await step('release', () => this.releaseHeld(now));
    result.rewardsExpired = await step('rewardExpiry', () => this.rewards.expireDue(now));
    result.reminders = await step('reminders', () => this.expiryReminders(now));
    return result;
  }

  /** SCHEDULED campaigns whose start has passed go live (dates are also read directly when a view starts). */
  async activateScheduled(now: Date) {
    const rows = await this.prisma.watchCampaign.findMany({
      where: { status: 'SCHEDULED', OR: [{ startAt: null }, { startAt: { lte: now } }] },
      take: 100,
    });
    let n = 0;
    for (const c of rows) {
      try {
        await this.prisma.$transaction((tx) =>
          this.core.transition(tx, c, 'LIVE', { action: 'ACTIVATE', actor: null }),
        );
        n++;
      } catch {
        /* another instance moved it first */
      }
    }
    return n;
  }

  /** Safety net: a live campaign with no views or no money left is completed and its unused budget closed out. */
  async completeExhausted(now: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "WatchCampaign"
      WHERE "status" = 'LIVE' AND ("qualifiedViews" >= "paidViews" OR "fundedHalalas" - "spentHalalas" < "chargePerViewHalalas")
      LIMIT 100`;
    let n = 0;
    for (const r of rows) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const c = await tx.watchCampaign.findUniqueOrThrow({ where: { id: r.id } });
          await this.core.transition(tx, c, 'COMPLETED', {
            action: 'COMPLETE',
            actor: null,
            reason: 'All paid views were delivered or the budget is used',
            data: { endedAt: now },
          });
          await this.funding.closeOut(tx, c, now);
        });
        n++;
      } catch {
        /* another instance moved it first */
      }
    }
    return n;
  }

  /** The schedule ended. Views already qualified keep their rewards; the unused budget is closed out to its own balance. */
  async endFinished(now: Date) {
    const rows = await this.prisma.watchCampaign.findMany({
      where: { status: { in: ['SCHEDULED', 'LIVE', 'PAUSED', 'SUSPENDED'] }, endAt: { lte: now } },
      take: 100,
    });
    let n = 0;
    for (const c of rows) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.core.transition(tx, c, 'EXPIRED', {
            action: 'EXPIRE',
            actor: null,
            data: { endedAt: now, pausedBy: null },
          });
          await this.funding.closeOut(tx, c, now);
        });
        n++;
      } catch {
        /* another instance moved it first */
      }
    }
    return n;
  }

  /** Sessions that were never completed are closed (the customer left, the app was killed). Nothing is charged for them. */
  async abandonViews(now: Date) {
    const res = await this.prisma.watchView.updateMany({
      where: { status: 'STARTED', expiresAt: { lt: new Date(now.getTime() - 30_000) } },
      data: { status: 'INVALID', reason: 'SESSION_EXPIRED' },
    });
    return res.count;
  }

  /**
   * Rewards held after a HOLD decision are released automatically once the review period has passed. A FLAG decision is never
   * auto-released: it waits for an Admin to decide the case.
   */
  async releaseHeld(now: Date) {
    const f = await this.core.fraud();
    const cutoff = new Date(now.getTime() - f.holdHours * 3_600_000);
    const views = await this.prisma.watchView.findMany({
      where: { rewardState: 'HELD', riskDecision: 'HOLD', qualifiedAt: { lte: cutoff } },
      take: 200,
    });
    let n = 0;
    for (const v of views) {
      try {
        const open = await this.prisma.riskFlag.count({
          where: { viewId: v.id, status: { not: 'DECIDED' } },
        });
        if (open) continue;
        const items: NotificationInput[] = [];
        const done = await this.prisma.$transaction(async (tx) => {
          const ok = await this.rewards.release(tx, v.id, 'HOLD_PERIOD_ENDED', undefined, now);
          if (ok)
            items.push({
              userId: v.userId,
              type: 'REWARD_RELEASED',
              dedupeKey: `reward-released:${v.id}`,
              data: { points: v.rewardPoints, viewId: v.id },
            });
          const created = items.length ? await this.notifications.emit(tx, items) : [];
          return { ok, created };
        });
        if (done.ok) {
          n++;
          void this.notifications.dispatch(done.created);
        }
      } catch {
        /* another instance released it first */
      }
    }
    return n;
  }

  /** Reminds customers whose points are about to expire (only when expiry is enabled by DealDash). */
  async expiryReminders(now: Date) {
    const rules = await this.core.rewardsRules();
    if (!rules.expiryDays) return 0;
    const until = new Date(now.getTime() + rules.expiryReminderDays * 86_400_000);
    const lots = await this.prisma.rewardLot.groupBy({
      by: ['accountId'],
      where: { remaining: { gt: 0 }, expiresAt: { lte: until, gt: now } },
      _sum: { remaining: true },
      _min: { expiresAt: true },
      orderBy: { accountId: 'asc' },
      take: 200,
    });
    let n = 0;
    for (const l of lots) {
      const acc = await this.prisma.rewardAccount.findUnique({ where: { id: l.accountId } });
      if (!acc || !l._min.expiresAt) continue;
      const day = l._min.expiresAt.toISOString().slice(0, 10);
      const created = await this.prisma.$transaction((tx) =>
        this.notifications.emit(tx, [
          {
            userId: acc.userId,
            type: 'REWARD_EXPIRING',
            dedupeKey: `reward-expiring:${acc.userId}:${day}`,
            data: { points: l._sum.remaining ?? 0, expiresAt: l._min.expiresAt!.toISOString() },
          },
        ]),
      );
      if (created.length) {
        n++;
        void this.notifications.dispatch(created);
      }
    }
    return n;
  }
}
