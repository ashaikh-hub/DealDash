import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { NotificationsService, type NotificationInput } from '../hot-deals/notifications.service';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import { LedgerService } from './ledger.service';
import { parseVoucherContent } from './voucher-content';
import { VoucherCoreService } from './voucher-core.service';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';

/**
 * Background housekeeping for the voucher domain. Every action is idempotent and safe to run on several instances at once:
 * conditional updates and idempotency keys decide who wins. Correctness never depends on this job (dates are read directly
 * at purchase and redemption); it keeps the data tidy and sends reminders.
 */
@Injectable()
export class VoucherLifecycleService {
  private readonly logger = new Logger('VoucherLifecycle');

  constructor(
    private readonly core: VoucherCoreService,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  async sweep(now = new Date()) {
    const result = {
      ordersSettled: 0,
      stalePayments: 0,
      reconciled: 0,
      onSale: 0,
      ended: 0,
      expired: 0,
      reminders: 0,
      refundsRetried: 0,
    };
    const step = async (name: string, fn: () => Promise<number>) => {
      try {
        return await fn();
      } catch (e) {
        this.logger.warn(`${name} failed: ${(e as Error).message}`);
        return 0;
      }
    };
    result.ordersSettled = await step('orders', () => this.payments.expireStaleOrders(now));
    result.stalePayments = await step('stale', () => this.payments.failStaleCreated(now));
    result.reconciled = await step('reconcile', () => this.payments.reconcilePending(now));
    result.onSale = await step('onSale', () => this.activateScheduled(now));
    result.ended = await step('ended', () => this.endFinished(now));
    result.expired = await step('expire', () => this.expireInstances(now));
    result.reminders = await step('reminders', () => this.sendExpiryReminders(now));
    result.refundsRetried = await step('refunds', () => this.retryStuckRefunds(now));
    return result;
  }

  /** SCHEDULED vouchers whose sale start has passed go on sale (dates are also read directly at purchase). */
  async activateScheduled(now: Date) {
    const rows = await this.prisma.voucher.findMany({
      where: { status: 'SCHEDULED', OR: [{ saleStartAt: null }, { saleStartAt: { lte: now } }] },
      take: 100,
    });
    let n = 0;
    for (const v of rows) {
      try {
        await this.prisma.$transaction((tx) =>
          this.core.transition(tx, v, 'ON_SALE', { action: 'ACTIVATE', actor: null }),
        );
        n++;
      } catch {
        /* another instance moved it first */
      }
    }
    return n;
  }

  /** The sale window closed. Vouchers already sold stay valid. */
  async endFinished(now: Date) {
    const rows = await this.prisma.voucher.findMany({
      where: { status: { in: ['ON_SALE', 'SOLD_OUT', 'SCHEDULED'] }, saleEndAt: { lte: now } },
      take: 100,
    });
    let n = 0;
    for (const v of rows) {
      try {
        await this.prisma.$transaction((tx) =>
          this.core.transition(tx, v, 'ENDED', {
            action: 'END',
            actor: null,
            data: { endedAt: now },
          }),
        );
        n++;
      } catch {
        /* another instance moved it first */
      }
    }
    return n;
  }

  /**
   * Vouchers past their validity become EXPIRED. The ledger records expiry as its OWN event and keeps the value separately
   * identifiable (VC-33): the merchant's held amount moves to an EXPIRED_VALUE account. What happens to that value
   * (retain, refund, extend, credit) is configuration and VALIDATE-KSA; nothing here decides it.
   */
  async expireInstances(now: Date) {
    const rows = await this.prisma.voucherInstance.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      take: 200,
    });
    let n = 0;
    for (const i of rows) {
      // a voucher with a refund in review is left to that decision
      const openRefund = await this.prisma.refund.count({
        where: { instanceId: i.id, status: { in: ['UNDER_REVIEW', 'REQUESTED'] } },
      });
      if (openRefund) continue;
      try {
        await this.prisma.$transaction(async (tx) => {
          const flipped = await tx.voucherInstance.updateMany({
            where: { id: i.id, status: 'ACTIVE', expiresAt: { lte: now } },
            data: { status: 'EXPIRED', expiredAt: now, version: { increment: 1 } },
          });
          if (flipped.count !== 1) return;
          const j = await this.ledger.post(tx, {
            type: 'EXPIRY',
            sourceType: 'VoucherInstance',
            sourceId: i.id,
            idempotencyKey: `expiry:${i.id}`,
            currency: await this.core.orderCurrency(tx, i.orderId),
            memo: `Voucher ${i.reference} expired unredeemed`,
            reasonCode: 'EXPIRED_UNREDEEMED',
            lines: [
              {
                family: 'MERCHANT_HELD',
                organizationId: i.organizationId,
                amountHalalas: i.purchasePriceHalalas,
              },
              {
                family: 'EXPIRED_VALUE',
                organizationId: i.organizationId,
                amountHalalas: -i.purchasePriceHalalas,
              },
            ],
          });
          await tx.merchantPayableEvent.create({
            data: {
              organizationId: i.organizationId,
              voucherId: i.voucherId,
              instanceId: i.id,
              type: 'EXPIRED',
              amountHalalas: i.purchasePriceHalalas,
              currency: await this.core.orderCurrency(tx, i.orderId),
              journalId: j.journalId,
              note: 'expired unredeemed (treatment of expired value: VALIDATE-KSA)',
              createdAt: now,
            },
          });
          await this.core.audit.record(
            {
              action: 'voucher_instance.expire',
              entityType: 'VoucherInstance',
              entityId: i.id,
              actorRole: 'SYSTEM',
              subjectOrganizationId: i.organizationId,
              newState: { status: 'EXPIRED' },
            },
            tx,
          );
        });
        n++;
      } catch (e) {
        this.logger.warn(`expire ${i.reference} failed: ${(e as Error).message}`);
      }
    }
    return n;
  }

  /** One in-app reminder per voucher, `vouchers.expiry_reminder_days` before expiry. */
  async sendExpiryReminders(now: Date) {
    const days = await this.core.expiryReminderDays();
    const rows = await this.prisma.voucherInstance.findMany({
      where: {
        status: 'ACTIVE',
        expiringNoticeSentAt: null,
        expiresAt: { gt: now, lte: new Date(now.getTime() + days * 86_400_000) },
      },
      include: { voucher: { include: { organization: { include: { merchant: true } } } } },
      take: 200,
    });
    let n = 0;
    for (const i of rows) {
      const sent: Array<NotificationInput & { id: string }> = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const claimed = await tx.voucherInstance.updateMany({
            where: { id: i.id, expiringNoticeSentAt: null },
            data: { expiringNoticeSentAt: now },
          });
          if (claimed.count !== 1) return [];
          const c = parseVoucherContent(i.voucher.content);
          const m = merchantDisplayName(i.voucher.organization);
          return this.notifications.emit(tx, [
            {
              userId: i.ownerUserId,
              type: 'VOUCHER_EXPIRING',
              dedupeKey: `instance:${i.id}:expiring`,
              data: {
                instanceId: i.id,
                voucherTitleEn: c.title.en,
                voucherTitleAr: c.title.ar,
                merchantNameEn: m.en,
                merchantNameAr: m.ar,
                expiresAt: i.expiresAt.toISOString(),
              },
            },
          ]);
        },
      );
      if (sent.length) {
        await this.notifications.dispatch(sent);
        n++;
      }
    }
    return n;
  }

  /** Re-runs refunds stuck in PROCESSING with no provider reference for a while (a crash between claim and call). */
  async retryStuckRefunds(now: Date) {
    const rows = await this.prisma.refund.findMany({
      where: { status: 'APPROVED', decidedAt: { lt: new Date(now.getTime() - 60_000) } },
      take: 20,
    });
    for (const r of rows) await this.refunds.execute(r.id).catch(() => undefined);
    return rows.length;
  }
}
