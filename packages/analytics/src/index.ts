import { z } from 'zod';

/**
 * Structured analytics event contract. Operational logic never reads these events; the operational
 * database stays the source of truth. Events are PII-free by design: user and organization are opaque ids.
 */
export const ANALYTICS_EVENT_NAMES = [
  'app.opened',
  'screen.viewed',
  'auth.otp_requested',
  'auth.signed_in',
  'auth.signed_out',
  'locale.changed',
  // product events (defined now so the contract is stable; emitted from later stages)
  'deal.impression',
  'deal.detail_viewed',
  'merchant.page_viewed',
  'deal.saved',
  'deal.directions_clicked',
  'reservation.created',
  'reservation.cancelled',
  'reservation.expired',
  'reservation.not_completed',
  'reservation.redeemed',
  'hot_deal.impression',
  'hot_deal.detail_viewed',
  'hot_deal.directions_clicked',
  'voucher.purchased',
  'payment.result',
  'voucher.redeemed',
  // Stage 5 voucher funnel
  'voucher.impression',
  'voucher.detail_viewed',
  'voucher.directions_clicked',
  'voucher.checkout_started',
  'voucher.payment_initiated',
  'voucher.payment_succeeded',
  'voucher.payment_failed',
  'voucher.issued',
  'voucher.wallet_viewed',
  'voucher.refund_requested',
  'voucher.refund_completed',
  'video.viewed',
  'video.view_qualified',
  'reward.issued',
  'campaign.state_changed',
  // Stage 6 Watch & Earn and Rewards
  'watch.impression',
  'watch.detail_viewed',
  'watch.cta_clicked',
  'watch.view_started',
  'watch.view_qualified',
  'watch.view_rejected',
  'reward.held',
  'reward.released',
  'reward.reversed',
  'reward.redeemed',
  'eligibility.unlocked',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export const analyticsEventSchema = z.object({
  name: z.enum(ANALYTICS_EVENT_NAMES),
  /** Opaque user id (never mobile or email). Null for anonymous/guest. */
  userId: z.string().max(64).nullable().optional(),
  organizationId: z.string().max(64).nullable().optional(),
  sessionId: z.string().max(64).nullable().optional(),
  timestamp: z.string().datetime(),
  context: z
    .object({
      app: z.enum(['customer', 'merchant', 'staff', 'partner', 'admin', 'api']).optional(),
      locale: z.enum(['en', 'ar']).optional(),
      path: z.string().max(300).optional(),
      userAgent: z.string().max(300).optional(),
      requestId: z.string().max(64).optional(),
    })
    .default({}),
  properties: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
});
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
export type AnalyticsEventInput = Omit<z.input<typeof analyticsEventSchema>, 'timestamp'> & {
  timestamp?: string;
};

export const analyticsBatchSchema = z.object({
  events: z.array(analyticsEventSchema).min(1).max(100),
});
export type AnalyticsBatch = z.infer<typeof analyticsBatchSchema>;

export function createAnalyticsEvent(input: AnalyticsEventInput): AnalyticsEvent {
  return analyticsEventSchema.parse({
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  });
}

/** Adapter interface: the platform emits events through this; the implementation is swappable. */
export interface AnalyticsSink {
  track(event: AnalyticsEvent): void | Promise<void>;
}

/** Development adapter: logs events and keeps a bounded in-memory buffer (useful in tests). */
export class ConsoleAnalyticsSink implements AnalyticsSink {
  readonly buffer: AnalyticsEvent[] = [];
  constructor(
    private readonly options: { log?: (line: string) => void; maxBuffer?: number } = {},
  ) {}
  track(event: AnalyticsEvent): void {
    this.buffer.push(event);
    const max = this.options.maxBuffer ?? 500;
    if (this.buffer.length > max) this.buffer.splice(0, this.buffer.length - max);
    (this.options.log ?? ((l) => console.debug(l)))(
      `[analytics] ${event.name} ${JSON.stringify(event.properties)}`,
    );
  }
}

/** Client helper: batches events and forwards them to a transport (for example the API ingestion endpoint). */
export class BatchingAnalyticsClient {
  private queue: AnalyticsEvent[] = [];
  constructor(
    private readonly transport: (batch: AnalyticsBatch) => Promise<void>,
    private readonly defaults: Partial<AnalyticsEventInput> = {},
  ) {}
  track(input: AnalyticsEventInput): void {
    this.queue.push(createAnalyticsEvent({ ...this.defaults, ...input }));
  }
  get pending(): number {
    return this.queue.length;
  }
  async flush(): Promise<void> {
    if (!this.queue.length) return;
    const events = this.queue.splice(0, 100);
    try {
      await this.transport({ events });
    } catch {
      // keep events for the next flush; bounded to avoid memory growth
      this.queue = [...events, ...this.queue].slice(-500);
    }
  }
}
