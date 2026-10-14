import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import type { NotificationType } from '@dealdash/types';
import type { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_PROVIDER, type PushProvider } from '../providers/interfaces';
import { SystemConfigService } from '../system-config/system-config.service';

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
  CASE_UPDATED: { en: 'Update on your support request', ar: 'تحديث على طلب الدعم الخاص بك' },
  ACCOUNT_RESTRICTION: { en: 'Your account status changed', ar: 'تغيّرت حالة حسابك' },
  BENEFIT_UPDATED: { en: 'Your benefits were updated', ar: 'تم تحديث مزاياك' },
};

interface NotificationOpsConfig {
  maxAttempts: number;
  retryMinutes: number[];
  templates: Record<string, { version: number; channels: string[] }>;
  throttlePerUserPerHour?: number;
  fallback?: Partial<Record<'PUSH' | 'SMS' | 'EMAIL', 'PUSH' | 'SMS' | 'EMAIL'>>;
}
const DEFAULT_OPS: NotificationOpsConfig = {
  maxAttempts: 3,
  retryMinutes: [5, 30, 120],
  templates: {},
  throttlePerUserPerHour: 20,
};

/**
 * Notification foundation: events are written to the in-app inbox (the source of truth) inside the caller's
 * transaction, and delivered to other channels only AFTER the transaction commits. A delivery failure never fails the
 * business action. Real SMS/push vendors plug in behind the provider interfaces.
 *
 * Stage 8: every delivery is TRACKED per channel (NotificationDelivery: provider, template and version, consent / preference
 * outcome, attempts, failure reason) with retries on the configured schedule and a FAILED state that operations can retry; a
 * notification created outside this service (alerts, cases, restrictions) is picked up by the delivery sweep.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    @Optional() private readonly config?: SystemConfigService,
  ) {}

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

  /** Call after commit. Never throws: a delivery problem is recorded and retried, it does not fail the business action. */
  async dispatch(items: Array<NotificationInput & { id: string }>) {
    for (const n of items)
      await this.deliverTracked(n).catch((e) =>
        this.logger.warn(`Delivery tracking failed for ${n.type}: ${(e as Error).message}`),
      );
  }

  private async ops(): Promise<NotificationOpsConfig> {
    const c =
      (await this.config
        ?.get<{ notifications?: NotificationOpsConfig }>(CONFIG_KEYS.OPERATIONS)
        .catch(() => null)) ?? null;
    return { ...DEFAULT_OPS, ...(c?.notifications ?? {}) };
  }

  /** In-app is delivered by storing it; the other configured channels are attempted through their providers. */
  async deliverTracked(n: {
    id: string;
    userId: string;
    type: NotificationType;
    data: Record<string, unknown>;
  }) {
    const cfg = await this.ops();
    const tpl = cfg.templates[n.type] ?? { version: 1, channels: ['IN_APP', 'PUSH'] };
    const body = String(n.data.dealTitleEn ?? n.data.voucherTitleEn ?? '');
    const base = {
      notificationId: n.id,
      userId: n.userId,
      templateCode: `notification.${n.type}`,
      templateVersion: tpl.version,
      maxAttempts: cfg.maxAttempts,
      payload: { type: n.type, body } as Prisma.InputJsonValue,
    };
    await this.prisma.notificationDelivery.createMany({
      data: [
        {
          ...base,
          channel: 'IN_APP',
          provider: 'in-app',
          status: 'DELIVERED',
          attempts: 1,
          consentChecked: true,
          lastAttemptAt: new Date(),
          dedupeKey: `${n.id}:IN_APP`,
        },
      ],
      skipDuplicates: true,
    });
    // an ALERT's other channels belong to the alert engine (rules, preferences, escalation): only its in-app copy is tracked here
    if (n.type === 'ALERT') return;
    for (const channel of tpl.channels.filter((c) => c !== 'IN_APP')) {
      const dedupeKey = `${n.id}:${channel}`;
      if (
        await this.prisma.notificationDelivery.findUnique({
          where: { dedupeKey },
          select: { id: true },
        })
      )
        continue;
      if (channel !== 'PUSH') {
        // email / SMS for customer notifications are not configured until a provider and consent rules are set (Stage 9)
        await this.prisma.notificationDelivery.create({
          data: {
            ...base,
            channel,
            provider: 'none',
            status: 'SUPPRESSED',
            suppressedReason: 'CHANNEL_NOT_CONFIGURED',
            consentChecked: true,
            dedupeKey,
          },
        });
        continue;
      }
      const d = await this.prisma.notificationDelivery.create({
        data: { ...base, channel, provider: 'mock-push', status: 'QUEUED', dedupeKey },
      });
      await this.attempt(d.id, cfg);
    }
  }

  /** One attempt of a tracked delivery: consent / preference first, then the provider, then retry or fail. */
  private async attempt(deliveryId: string, cfg: NotificationOpsConfig) {
    const d = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    const user = d.userId
      ? await this.prisma.user.findUnique({
          where: { id: d.userId },
          select: { status: true, locale: true },
        })
      : null;
    const pref = d.userId
      ? await this.prisma.notificationPreference.findFirst({
          where: { userId: d.userId, category: 'ALL' },
        })
      : null;
    const now = new Date();
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      pref?.muted ||
      (pref && !pref.channels.includes(d.channel))
    ) {
      await this.prisma.notificationDelivery.update({
        where: { id: d.id },
        data: {
          status: 'SUPPRESSED',
          suppressedReason: !user || user.status !== 'ACTIVE' ? 'ACCOUNT_NOT_ACTIVE' : 'PREFERENCE',
          consentChecked: true,
          lastAttemptAt: now,
          nextRetryAt: null,
        },
      });
      return;
    }
    // Stage 9 (B3): a person never receives more than the configured number of messages per channel per hour
    const cap = cfg.throttlePerUserPerHour ?? DEFAULT_OPS.throttlePerUserPerHour!;
    if (d.userId && d.status !== 'RETRYING') {
      const recent = await this.prisma.notificationDelivery.count({
        where: {
          userId: d.userId,
          channel: d.channel,
          status: { in: ['SENT', 'DELIVERED'] },
          lastAttemptAt: { gte: new Date(now.getTime() - 3_600_000) },
        },
      });
      if (recent >= cap) {
        await this.prisma.notificationDelivery.update({
          where: { id: d.id },
          data: {
            status: 'SUPPRESSED',
            suppressedReason: 'THROTTLED',
            consentChecked: true,
            lastAttemptAt: now,
            nextRetryAt: null,
          },
        });
        return;
      }
    }
    const payload = d.payload as { type?: NotificationType; body?: string };
    const type = payload.type ?? 'ALERT';
    const t = TITLES[type] ?? TITLES.ALERT;
    try {
      const res = await this.push.send({
        userId: d.userId!,
        title: t.en,
        body: payload.body ?? '',
        data: { type, notificationId: d.notificationId ?? '' },
      });
      await this.prisma.notificationDelivery.update({
        where: { id: d.id },
        data: {
          status: res.delivered ? 'DELIVERED' : 'SENT',
          providerMessageId: res.providerRef,
          attempts: { increment: 1 },
          consentChecked: true,
          lastAttemptAt: now,
          nextRetryAt: null,
          failureReason: null,
          locale: user.locale,
        },
      });
    } catch (e) {
      const attempts = d.attempts + 1;
      const failed = attempts >= d.maxAttempts;
      const wait = cfg.retryMinutes[Math.min(attempts - 1, cfg.retryMinutes.length - 1)] ?? 30;
      await this.prisma.notificationDelivery.update({
        where: { id: d.id },
        data: {
          status: failed ? 'FAILED' : 'RETRYING',
          attempts,
          consentChecked: true,
          lastAttemptAt: now,
          failureReason: (e as Error).message.slice(0, 300),
          nextRetryAt: failed ? null : new Date(now.getTime() + wait * 60_000),
          locale: user.locale,
        },
      });
      this.logger.warn(
        `Push delivery ${d.id} ${failed ? 'failed' : 'will be retried'}: ${(e as Error).message}`,
      );
      if (failed) await this.fallback(d.id, cfg);
    }
  }

  /** Stage 9 (B3): when a channel finally fails, the approved fallback channel is tried once (none by default). */
  private async fallback(deliveryId: string, cfg: NotificationOpsConfig) {
    const d = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    const to = cfg.fallback?.[d.channel as 'PUSH' | 'SMS' | 'EMAIL'];
    if (!to || !d.notificationId) return;
    const dedupeKey = `${d.notificationId}:${to}:fallback`;
    if (
      await this.prisma.notificationDelivery.findUnique({
        where: { dedupeKey },
        select: { id: true },
      })
    )
      return;
    const base = {
      notificationId: d.notificationId,
      userId: d.userId,
      templateCode: d.templateCode,
      templateVersion: d.templateVersion,
      maxAttempts: cfg.maxAttempts,
      payload: d.payload as Prisma.InputJsonValue,
      dedupeKey,
    };
    if (to !== 'PUSH') {
      await this.prisma.notificationDelivery.create({
        data: {
          ...base,
          channel: to,
          provider: 'none',
          status: 'SUPPRESSED',
          suppressedReason: 'CHANNEL_NOT_CONFIGURED',
          consentChecked: true,
        },
      });
      return;
    }
    const f = await this.prisma.notificationDelivery.create({
      data: { ...base, channel: to, provider: 'mock-push', status: 'QUEUED' },
    });
    await this.attempt(f.id, cfg);
  }

  /**
   * Stage 9 (B3): the provider's delivery receipt (signed callback). Moves a SENT delivery to DELIVERED, or to FAILED (then the
   * fallback, if approved). Idempotent: an unknown or already-final message changes nothing.
   */
  async applyDeliveryReceipt(
    providerMessageId: string,
    status: 'DELIVERED' | 'FAILED',
    reason: string | null,
  ) {
    const d = await this.prisma.notificationDelivery.findFirst({ where: { providerMessageId } });
    if (!d || !['SENT', 'QUEUED', 'RETRYING'].includes(d.status)) return { applied: false };
    const upd = await this.prisma.notificationDelivery.updateMany({
      where: { id: d.id, status: d.status },
      data: {
        status,
        failureReason:
          status === 'FAILED' ? (reason ?? 'PROVIDER_REPORTED_FAILURE').slice(0, 300) : null,
        nextRetryAt: null,
      },
    });
    if (upd.count === 1 && status === 'FAILED') await this.fallback(d.id, await this.ops());
    return { applied: upd.count === 1 };
  }

  /** Retries due deliveries (job). Returns how many were attempted. */
  async retryDue(now = new Date()) {
    const cfg = await this.ops();
    const due = await this.prisma.notificationDelivery.findMany({
      where: { status: 'RETRYING', nextRetryAt: { lte: now } },
      take: 200,
    });
    for (const d of due) await this.attempt(d.id, cfg);
    return due.length;
  }

  /** Operations retries a FAILED delivery now (one more attempt, counted). */
  async retryNow(deliveryId: string) {
    const d = await this.prisma.notificationDelivery.findUnique({ where: { id: deliveryId } });
    if (!d) throw AppError.notFound();
    if (d.status !== 'FAILED')
      throw new AppError('INVALID_STATE', 'Only a failed delivery can be retried', 409);
    await this.prisma.notificationDelivery.update({
      where: { id: d.id },
      data: { status: 'RETRYING', maxAttempts: d.attempts + 1, nextRetryAt: new Date() },
    });
    await this.attempt(d.id, await this.ops());
    return this.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
  }

  /** Notifications written outside this service (alerts, cases, restrictions) get their delivery tracked (job). */
  async sweepUntracked(now = new Date()) {
    const since = new Date(now.getTime() - 86_400_000);
    const rows = await this.prisma.notification.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take: 500,
      select: { id: true, userId: true, type: true, data: true },
    });
    if (!rows.length) return 0;
    const tracked = new Set(
      (
        await this.prisma.notificationDelivery.findMany({
          where: { notificationId: { in: rows.map((r) => r.id) }, channel: 'IN_APP' },
          select: { notificationId: true },
        })
      ).map((r) => r.notificationId),
    );
    let n = 0;
    for (const r of rows)
      if (!tracked.has(r.id)) {
        await this.deliverTracked({
          id: r.id,
          userId: r.userId,
          type: r.type,
          data: (r.data ?? {}) as Record<string, unknown>,
        });
        n++;
      }
    return n;
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
