import { Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import type {
  EmailMessage,
  EmailProvider,
  GeocodeResult,
  MapsProvider,
  PaymentInitiation,
  PaymentInitiationResult,
  PaymentProvider,
  PaymentStatus,
  PaymentWebhookEvent,
  PushMessage,
  PushProvider,
  RefundRequest,
  SignedUpload,
  SmsMessage,
  SmsProvider,
  StorageProvider,
  VideoProvider,
} from './interfaces';

/** Mock providers: deterministic, in-memory, and safe. They log instead of calling any vendor. */
const MAX_KEPT = 200;

export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger('MockSms');
  readonly sent: Array<SmsMessage & { providerRef: string; at: Date }> = [];

  async send(message: SmsMessage) {
    const providerRef = `mock-sms-${randomUUID()}`;
    this.sent.push({ ...message, providerRef, at: new Date() });
    if (this.sent.length > MAX_KEPT) this.sent.shift();
    // Development convenience: the OTP message is visible in the API console.
    this.logger.log(`SMS to ${message.to} [${message.templateKey}]: ${message.body}`);
    return { providerRef };
  }

  lastTo(to: string) {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}

export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger('MockEmail');
  readonly sent: Array<EmailMessage & { providerRef: string; at: Date }> = [];
  async send(message: EmailMessage) {
    const providerRef = `mock-email-${randomUUID()}`;
    this.sent.push({ ...message, providerRef, at: new Date() });
    if (this.sent.length > MAX_KEPT) this.sent.shift();
    this.logger.log(
      `Email to ${message.to} [${message.templateKey}]: ${message.subject} | ${message.body}`,
    );
    return { providerRef };
  }

  lastTo(to: string, templateKey?: string) {
    return [...this.sent]
      .reverse()
      .find((m) => m.to === to && (!templateKey || m.templateKey === templateKey));
  }
}

export class MockPushProvider implements PushProvider {
  private readonly logger = new Logger('MockPush');
  readonly sent: Array<PushMessage & { providerRef: string }> = [];
  async send(message: PushMessage) {
    const providerRef = `mock-push-${randomUUID()}`;
    this.sent.push({ ...message, providerRef });
    if (this.sent.length > MAX_KEPT) this.sent.shift();
    this.logger.log(`Push to ${message.userId}: ${message.title}`);
    return { providerRef, delivered: true };
  }
}

export class MockPaymentProvider implements PaymentProvider {
  static readonly WEBHOOK_SECRET = 'mock-webhook-secret';
  readonly name = 'mock';
  /** Test and development switch: the next refund calls fail (to exercise the failed-refund path). */
  failRefunds = false;
  /** Test and development switch: refunds are accepted but complete later through a webhook (asynchronous PSP refund). */
  refundsPending = false;
  private readonly refunds = new Map<
    string,
    { refundReference: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' }
  >();
  private readonly payments = new Map<
    string,
    { status: PaymentStatus; amount: number; idempotencyKey: string }
  >();
  private readonly byKey = new Map<string, string>();

  async initiate(input: PaymentInitiation): Promise<PaymentInitiationResult> {
    // Idempotent per key: the same key always returns the same payment (no duplicate charges).
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing)
      return { providerReference: existing, status: this.payments.get(existing)!.status };
    const providerReference = `mock-pay-${randomUUID()}`;
    this.payments.set(providerReference, {
      status: 'PENDING',
      amount: input.amountHalalas,
      idempotencyKey: input.idempotencyKey,
    });
    this.byKey.set(input.idempotencyKey, providerReference);
    return {
      providerReference,
      status: 'PENDING',
      redirectUrl: `${input.returnUrl}?mock_payment=${providerReference}`,
    };
  }

  /** Test/dev helper to move a payment to a final state. */
  settle(providerReference: string, status: Exclude<PaymentStatus, 'PENDING'>) {
    const p = this.payments.get(providerReference);
    if (p) p.status = status;
  }

  async cancel(providerReference: string): Promise<{ status: PaymentStatus }> {
    const p = this.payments.get(providerReference);
    if (p && p.status === 'PENDING') p.status = 'CANCELLED';
    return { status: p?.status ?? 'CANCELLED' };
  }

  /** An attempt the adapter does not know (for example after a development restart) is still pending. */
  async getStatus(providerReference: string): Promise<PaymentStatus> {
    return this.payments.get(providerReference)?.status ?? 'PENDING';
  }

  /** Idempotent per key: asking twice returns the same refund and never refunds twice. */
  async refund(input: RefundRequest) {
    const prior = this.refunds.get(input.idempotencyKey);
    if (prior) return prior;
    const p = this.payments.get(input.providerReference);
    const ok = !this.failRefunds && (!p || p.status === 'SUCCEEDED');
    const result = {
      refundReference: `mock-refund-${randomUUID()}`,
      status: !ok
        ? ('FAILED' as const)
        : this.refundsPending
          ? ('PENDING' as const)
          : ('SUCCEEDED' as const),
    };
    this.refunds.set(input.idempotencyKey, result);
    return result;
  }

  /** Builds the signed body and header the provider would POST to the webhook endpoint (tests and the dev payment page). */
  static buildWebhook(event: PaymentWebhookEvent): { rawBody: string; signature: string } {
    const rawBody = JSON.stringify({ occurredAt: new Date().toISOString(), ...event });
    return { rawBody, signature: MockPaymentProvider.sign(rawBody) };
  }

  static sign(rawBody: string): string {
    return createHmac('sha256', MockPaymentProvider.WEBHOOK_SECRET).update(rawBody).digest('hex');
  }

  parseWebhook(rawBody: string, signatureHeader: string | undefined): PaymentWebhookEvent | null {
    if (!signatureHeader || signatureHeader !== MockPaymentProvider.sign(rawBody)) return null;
    try {
      const e = JSON.parse(rawBody) as PaymentWebhookEvent;
      return e && typeof e.eventId === 'string' && typeof e.providerReference === 'string'
        ? e
        : null;
    } catch {
      return null;
    }
  }
}

export class MockStorageProvider implements StorageProvider {
  private readonly objects = new Map<string, Buffer>();

  /** Test helper: put an object as if the client had uploaded it. */
  putObject(key: string, data: Buffer) {
    this.objects.set(key, data);
  }
  async createUploadUrl(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<SignedUpload> {
    return {
      url: `http://localhost:4000/mock-storage/${encodeURIComponent(input.key)}`,
      method: 'PUT',
      headers: { 'Content-Type': input.contentType },
      key: input.key,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
  }
  async createReadUrl(input: { key: string; expiresInSeconds: number }) {
    return `http://localhost:4000/mock-storage/${encodeURIComponent(input.key)}?expires=${input.expiresInSeconds}`;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.length } : null;
  }
  async read(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export class MockVideoProvider implements VideoProvider {
  async createUpload(input: { title: string }) {
    const assetId = `mock-video-${randomUUID()}`;
    return {
      assetId,
      uploadUrl: `http://localhost:4000/mock-video/upload/${assetId}?title=${encodeURIComponent(input.title)}`,
    };
  }
  async getPlayback(assetId: string, opts?: { signed?: boolean }) {
    return {
      manifestUrl: `http://localhost:4000/mock-video/${assetId}/index.m3u8${opts?.signed ? '?token=mock' : ''}`,
      posterUrl: `http://localhost:4000/mock-video/${assetId}/poster.jpg`,
      expiresAt: opts?.signed ? new Date(Date.now() + 3600_000).toISOString() : undefined,
    };
  }
}

/** Deterministic geocoder for Riyadh areas (development only). */
export class MockMapsProvider implements MapsProvider {
  private static readonly KNOWN: Record<string, [number, number]> = {
    olaya: [24.6908, 46.6853],
    malqa: [24.8094, 46.6336],
    kafd: [24.7664, 46.6432],
    'riyadh park': [24.7567, 46.6288],
  };
  async geocode(address: string): Promise<GeocodeResult | null> {
    const lower = address.toLowerCase();
    for (const [name, [latitude, longitude]] of Object.entries(MockMapsProvider.KNOWN)) {
      if (lower.includes(name))
        return {
          latitude,
          longitude,
          formattedAddress: `${name}, Riyadh`,
          precision: 'approximate',
        };
    }
    return null;
  }
  async reverseGeocode(latitude: number, longitude: number) {
    return { formattedAddress: `Near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}, Riyadh` };
  }
}
