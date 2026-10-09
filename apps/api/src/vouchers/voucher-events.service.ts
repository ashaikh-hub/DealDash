import { Inject, Injectable } from '@nestjs/common';
import type { AnalyticsEventName, AnalyticsSink } from '@dealdash/analytics';
import type { Prisma } from '../generated/prisma/client';
import { ANALYTICS_SINK } from '../analytics/analytics.module';
import { PrismaService } from '../prisma/prisma.service';

export type VoucherDealEventType =
  | 'IMPRESSION'
  | 'DETAIL_VIEW'
  | 'DIRECTIONS_CLICK'
  | 'CHECKOUT_STARTED'
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_SUCCEEDED'
  | 'PAYMENT_FAILED'
  | 'VOUCHER_ISSUED'
  | 'WALLET_VIEWED'
  | 'VOUCHER_REDEEMED'
  | 'REFUND_REQUESTED'
  | 'REFUND_COMPLETED';

/**
 * Voucher analytics: funnel events are stored in the same append-only DealEvent table (productType VOUCHER) and also sent to
 * the analytics sink. Both are measurable steps only: nothing here is a revenue figure (money comes from the ledger).
 */
@Injectable()
export class VoucherEventsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ANALYTICS_SINK) private readonly sink: AnalyticsSink,
  ) {}

  /** Stores the event (inside the caller's transaction when given) and returns a function to call after commit. */
  async record(
    tx: Prisma.TransactionClient | null,
    type: VoucherDealEventType,
    v: { voucherId: string; organizationId: string; branchId?: string | null },
    userId: string | null,
    contract?: AnalyticsEventName,
    props: Record<string, string | number | boolean | null> = {},
  ): Promise<() => void> {
    await (tx ?? this.prisma).dealEvent.create({
      data: {
        type: type as never,
        productType: 'VOUCHER',
        dealId: v.voucherId,
        merchantOrgId: v.organizationId,
        branchId: v.branchId ?? null,
        userId,
        anonymousId: userId ? `user:${userId}`.slice(0, 64) : 'system',
      },
    });
    return () => {
      if (contract)
        this.track(contract, userId, v.organizationId, { voucherId: v.voucherId, ...props });
    };
  }

  track(
    name: AnalyticsEventName,
    userId: string | null,
    organizationId: string | null,
    properties: Record<string, string | number | boolean | null> = {},
  ) {
    try {
      void this.sink.track({
        name,
        userId,
        organizationId,
        timestamp: new Date().toISOString(),
        context: { app: 'api' },
        properties,
      });
    } catch {
      /* analytics never fails a business action */
    }
  }
}
