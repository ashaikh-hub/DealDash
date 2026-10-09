import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationType } from '@dealdash/types';
import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, type PushProvider } from '../providers/interfaces';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  /** One notification per (user, dedupeKey): sweeps and retries never double-send. */
  dedupeKey: string;
  data: Record<string, unknown>;
}

/** A delivery channel behind the provider abstraction. In-app is stored by the service itself; push is a provider. */
export interface NotificationChannel {
  readonly name: string;
  deliver(n: NotificationInput & { id: string }): Promise<void>;
}

const TITLES: Record<NotificationType, { en: string; ar: string }> = {
  RESERVATION_CONFIRMED: { en: 'Your reservation is confirmed', ar: 'تم تأكيد حجزك' },
  RESERVATION_EXPIRING: { en: 'Your reservation is about to end', ar: 'حجزك على وشك الانتهاء' },
  RESERVATION_EXPIRED: { en: 'Reservation not completed', ar: 'لم يكتمل الحجز' },
  RESERVATION_CANCELLED: { en: 'Your reservation was cancelled', ar: 'تم إلغاء حجزك' },
  REDEMPTION_SUCCESS: { en: 'Offer used', ar: 'تم استخدام العرض' },
  PURCHASE_SUCCEEDED: { en: 'Payment received', ar: 'تم استلام الدفع' },
  PAYMENT_FAILED: { en: 'Payment did not go through', ar: 'لم تتم عملية الدفع' },
  VOUCHER_ISSUED: { en: 'Your voucher is ready', ar: 'قسيمتك جاهزة' },
  VOUCHER_EXPIRING: { en: 'Your voucher expires soon', ar: 'قسيمتك على وشك الانتهاء' },
  REFUND_UPDATED: { en: 'Refund update', ar: 'تحديث الاسترداد' },
  VOUCHER_REDEEMED: { en: 'Voucher used', ar: 'تم استخدام القسيمة' },
  REWARD_EARNED: { en: 'You earned points', ar: 'لقد ربحت نقاطاً' },
  REWARD_HELD: { en: 'Your reward is being checked', ar: 'يتم التحقق من مكافأتك' },
  REWARD_RELEASED: { en: 'Your reward is ready', ar: 'مكافأتك جاهزة' },
  REWARD_REVERSED: { en: 'A reward was removed', ar: 'تمت إزالة مكافأة' },
  REWARD_EXPIRING: { en: 'Some of your points expire soon', ar: 'ستنتهي صلاحية بعض نقاطك قريباً' },
  ALERT: {
    en: 'You have a new alert',
    ar: 'لديك تنبيه جديد',
  },
  CAMPAIGN_COMPLETED: {
    en: 'Your campaign delivered all its views',
    ar: 'حملتك أنجزت جميع مشاهداتها',
  },
};

/** Push channel through the existing provider abstraction (mock in development: logs, never fails the caller). */
class PushChannel implements NotificationChannel {
  readonly name = 'push';
  constructor(private readonly push: PushProvider) {}
  async deliver(n: NotificationInput & { id: string }) {
    const t = TITLES[n.type];
    await this.push.send({
      userId: n.userId,
      title: t.en,
      body: String(n.data.dealTitleEn ?? n.data.voucherTitleEn ?? ''),
      data: { type: n.type, notificationId: n.id },
    });
  }
}

/**
 * Notification foundation: events are written to the in-app inbox (the source of truth) inside the caller's
 * transaction, and delivered to other channels only AFTER the transaction commits. A delivery failure never fails the
 * business action. Real SMS/push vendors plug in by adding a channel.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');
  private readonly channels: NotificationChannel[];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) push: PushProvider,
  ) {
    this.channels = [new PushChannel(push)];
  }

  /** Writes the in-app notification. Returns the rows created (empty when it already existed) for `dispatch`. */
  async emit(tx: Prisma.TransactionClient, items: NotificationInput[]) {
    const created: Array<NotificationInput & { id: string }> = [];
    for (const n of items) {
      const res = await tx.notification.createManyAndReturn({
        data: [
          {
            userId: n.userId,
            type: n.type,
            dedupeKey: n.dedupeKey,
            data: n.data as Prisma.InputJsonValue,
          },
        ],
        skipDuplicates: true,
      });
      if (res[0]) created.push({ ...n, id: res[0].id });
    }
    return created;
  }

  /** Call after commit. */
  async dispatch(items: Array<NotificationInput & { id: string }>) {
    for (const n of items)
      for (const ch of this.channels) {
        try {
          await ch.deliver(n);
        } catch (e) {
          this.logger.warn(`Channel ${ch.name} failed for ${n.type}: ${(e as Error).message}`);
        }
      }
  }

  // ---------------------------------------------------------------- inbox
  async list(userId: string, limit = 30) {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      unread: await this.prisma.notification.count({ where: { userId, readAt: null } }),
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        data: (r.data ?? {}) as Record<string, unknown>,
        createdAt: r.createdAt.toISOString(),
        readAt: r.readAt ? r.readAt.toISOString() : null,
      })),
    };
  }

  async markRead(userId: string, id: string | null) {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(id ? { id } : {}) },
      data: { readAt: new Date() },
    });
    if (id && res.count === 0) {
      const exists = await this.prisma.notification.count({ where: { id, userId } });
      if (!exists) throw AppError.notFound();
    }
    return { updated: res.count };
  }
}
