import { Logger } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import type {
  CardBrand,
  CardHoldCapabilities,
  CardHoldProvider,
  CardHoldRequest,
  CardHoldStatus,
  CardSetupStatus,
  CardVaultProvider,
  SavedCardDetails,
  SocialAuthProvider,
  SocialProfile,
  SocialProviderId,
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

/**
 * Options for the SMS / e-mail adapters when they stand in for a provider outside development (staging, ALLOW_MOCK_PROVIDERS):
 * `redactLogs` keeps message bodies (sign-in codes, links) and full recipients out of the logs; `observer` receives each message
 * (the staging test inbox). A failing observer never fails the send.
 */
export interface MockMessagingOptions {
  redactLogs?: boolean;
  observer?: (m: {
    channel: 'SMS' | 'EMAIL';
    to: string;
    templateKey: string;
    subject?: string;
    body: string;
  }) => Promise<void>;
}

const maskRecipient = (to: string) =>
  to.includes('@') ? `***${to.slice(to.lastIndexOf('@'))}` : `***${to.slice(-4)}`;

export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger('MockSms');
  readonly sent: Array<SmsMessage & { providerRef: string; at: Date }> = [];

  constructor(private readonly opts: MockMessagingOptions = {}) {}

  async send(message: SmsMessage) {
    const providerRef = `mock-sms-${randomUUID()}`;
    this.sent.push({ ...message, providerRef, at: new Date() });
    if (this.sent.length > MAX_KEPT) this.sent.shift();
    if (this.opts.redactLogs)
      this.logger.log(
        `SMS to ${maskRecipient(message.to)} [${message.templateKey}] (body withheld)`,
      );
    // Development convenience: the OTP message is visible in the API console.
    else this.logger.log(`SMS to ${message.to} [${message.templateKey}]: ${message.body}`);
    await this.opts
      .observer?.({
        channel: 'SMS',
        to: message.to,
        templateKey: message.templateKey,
        body: message.body,
      })
      .catch(() => this.logger.warn('Staging test inbox: message not kept'));
    return { providerRef };
  }

  lastTo(to: string) {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
}

export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger('MockEmail');
  readonly sent: Array<EmailMessage & { providerRef: string; at: Date }> = [];

  constructor(private readonly opts: MockMessagingOptions = {}) {}

  async send(message: EmailMessage) {
    const providerRef = `mock-email-${randomUUID()}`;
    this.sent.push({ ...message, providerRef, at: new Date() });
    if (this.sent.length > MAX_KEPT) this.sent.shift();
    if (this.opts.redactLogs)
      this.logger.log(
        `Email to ${maskRecipient(message.to)} [${message.templateKey}] (body withheld)`,
      );
    else
      this.logger.log(
        `Email to ${message.to} [${message.templateKey}]: ${message.subject} | ${message.body}`,
      );
    await this.opts
      .observer?.({
        channel: 'EMAIL',
        to: message.to,
        templateKey: message.templateKey,
        subject: message.subject,
        body: message.body,
      })
      .catch(() => this.logger.warn('Staging test inbox: message not kept'));
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
  /** Test and development switch (Stage 8): push sends fail, to exercise delivery retries and failure escalation. */
  failSends = false;
  async send(message: PushMessage) {
    if (this.failSends) throw new Error('MOCK_PUSH_UNAVAILABLE');
    const providerRef = `mock-push-${randomUUID()}`;
    this.sent.push({ ...message, providerRef });
    if (this.sent.length > MAX_KEPT) this.sent.shift();
    this.logger.log(`Push to ${message.userId}: ${message.title}`);
    return { providerRef, delivered: true };
  }
}

/**
 * Development test cards for the mock "add a card" page. Chosen from a list: no card number is ever typed, sent or kept (a real
 * provider's hosted page collects it). DECLINED exercises the failure path.
 */
export const MOCK_TEST_CARDS = {
  VISA_4242: { brand: 'VISA', last4: '4242' },
  MASTERCARD_5454: { brand: 'MASTERCARD', last4: '5454' },
  MADA_1234: { brand: 'MADA', last4: '1234' },
  DECLINED: null,
} as const satisfies Record<string, { brand: CardBrand; last4: string } | null>;
export type MockTestCard = keyof typeof MOCK_TEST_CARDS;

export class MockPaymentProvider implements PaymentProvider, CardHoldProvider, CardVaultProvider {
  static readonly WEBHOOK_SECRET = 'mock-webhook-secret';
  readonly name = 'mock';

  // ---- saved cards (customer experience)
  private readonly setups = new Map<
    string,
    { status: CardSetupStatus; card?: SavedCardDetails; failureCode?: string }
  >();
  private readonly vault = new Map<string, SavedCardDetails>();

  async startCardSetup(input: { setupId: string; returnUrl: string }) {
    const providerSetupRef = `mock-setup-${randomUUID()}`;
    this.setups.set(providerSetupRef, { status: 'PENDING' });
    const url = new URL(input.returnUrl);
    url.searchParams.set('mock_setup', providerSetupRef);
    return { providerSetupRef, redirectUrl: url.toString() };
  }

  /** Test / dev helper: the customer finished (or left) the hosted card page. Nothing here sees a card number. */
  completeCardSetup(providerSetupRef: string, outcome: 'SAVED' | 'CANCELLED', card: MockTestCard) {
    const s = this.setups.get(providerSetupRef);
    if (!s || s.status !== 'PENDING') return false;
    if (outcome === 'CANCELLED') {
      s.status = 'CANCELLED';
      return true;
    }
    const test = MOCK_TEST_CARDS[card];
    if (!test) {
      s.status = 'FAILED';
      s.failureCode = 'CARD_DECLINED';
      return true;
    }
    const token = `mock_tok_${randomUUID()}`;
    const details: SavedCardDetails = {
      token,
      fingerprint: `mock_fp_${card}`,
      brand: test.brand,
      last4: test.last4,
      expMonth: 12,
      expYear: new Date().getUTCFullYear() + 3,
    };
    this.vault.set(token, details);
    s.status = 'SUCCEEDED';
    s.card = details;
    return true;
  }

  async getCardSetup(providerSetupRef: string) {
    return this.setups.get(providerSetupRef) ?? { status: 'PENDING' as const };
  }

  async deleteCard(token: string) {
    this.vault.delete(token);
  }

  async describeCard(token: string) {
    const c = this.vault.get(token);
    return c ? { brand: c.brand, last4: c.last4 } : null;
  }
  /** Phase 3 card holds. Test / development switches: validity, partial capture support, failing captures. */
  holdCapabilities: CardHoldCapabilities = {
    cardHolds: true,
    partialCapture: true,
    authValidityMinutes: 7 * 24 * 60,
  };
  failCaptures = false;
  private readonly holds = new Map<
    string,
    { status: CardHoldStatus; amount: number; captured: number; key: string }
  >();
  private readonly holdByKey = new Map<string, string>();
  private readonly captures = new Map<
    string,
    { captureReference: string; status: 'SUCCEEDED' | 'FAILED'; failureCode?: string }
  >();

  async authorise(input: CardHoldRequest) {
    const existing = this.holdByKey.get(input.idempotencyKey);
    if (existing) return { providerReference: existing, status: this.holds.get(existing)!.status };
    const providerReference = `mock-auth-${randomUUID()}`;
    this.holds.set(providerReference, {
      status: 'PENDING',
      amount: input.amountMinor,
      captured: 0,
      key: input.idempotencyKey,
    });
    this.holdByKey.set(input.idempotencyKey, providerReference);
    return {
      providerReference,
      status: 'PENDING' as const,
      redirectUrl: `${input.returnUrl}?mock_hold=${providerReference}${input.savedCardToken ? `&mock_card=${encodeURIComponent(input.savedCardToken)}` : ''}`,
    };
  }

  /** Test / dev helper: the customer completed (or failed) 3-D Secure, or the issuer let the hold lapse. */
  settleHold(providerReference: string, status: 'AUTHORISED' | 'FAILED' | 'EXPIRED') {
    const h = this.holds.get(providerReference);
    if (h) h.status = status;
  }

  async capture(input: { providerReference: string; amountMinor: number; idempotencyKey: string }) {
    const prior = this.captures.get(input.idempotencyKey);
    if (prior) return prior;
    const h = this.holds.get(input.providerReference);
    const ok =
      !this.failCaptures &&
      !!h &&
      h.status === 'AUTHORISED' &&
      input.amountMinor > 0 &&
      input.amountMinor <= h.amount &&
      (input.amountMinor === h.amount || this.holdCapabilities.partialCapture);
    const result = ok
      ? { captureReference: `mock-capture-${randomUUID()}`, status: 'SUCCEEDED' as const }
      : {
          captureReference: '',
          status: 'FAILED' as const,
          failureCode: h?.status === 'EXPIRED' ? 'AUTHORISATION_EXPIRED' : 'CAPTURE_REFUSED',
        };
    if (ok) {
      h!.captured = input.amountMinor;
      h!.status = input.amountMinor === h!.amount ? 'CAPTURED' : 'PARTIALLY_CAPTURED';
      // a capture is refundable like a payment
      this.payments.set(result.captureReference, {
        status: 'SUCCEEDED',
        amount: input.amountMinor,
        idempotencyKey: input.idempotencyKey,
      });
    }
    this.captures.set(input.idempotencyKey, result);
    return result;
  }

  async release(providerReference: string) {
    const h = this.holds.get(providerReference);
    if (h && (h.status === 'PENDING' || h.status === 'AUTHORISED')) h.status = 'RELEASED';
    return { status: h?.status ?? ('RELEASED' as const) };
  }

  async getHoldStatus(providerReference: string): Promise<CardHoldStatus> {
    return this.holds.get(providerReference)?.status ?? 'PENDING';
  }
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
      redirectUrl: `${input.returnUrl}?mock_payment=${providerReference}${input.savedCardToken ? `&mock_card=${encodeURIComponent(input.savedCardToken)}` : ''}`,
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

/**
 * Development stand-in for Google / Apple sign-in. `authorizeUrl` points at the app's own callback page with `mock_social`, where a
 * development chooser plays the provider's consent screen (approve, cancel or fail). Codes are single use and short lived.
 */
export class MockSocialAuthProvider implements SocialAuthProvider {
  readonly name = 'mock';
  private readonly codes = new Map<
    string,
    { provider: SocialProviderId; profile: SocialProfile; expiresAt: number }
  >();

  available() {
    return true;
  }

  authorizeUrl(input: { provider: SocialProviderId; state: string; callbackUrl: string }) {
    const url = new URL(input.callbackUrl);
    url.searchParams.set('mock_social', input.provider);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  /** Dev helper: the customer approved on the (mock) provider screen; returns the authorization code. */
  approve(provider: SocialProviderId, profile: SocialProfile) {
    const code = `mock_code_${randomUUID()}`;
    this.codes.set(code, { provider, profile, expiresAt: Date.now() + 5 * 60_000 });
    return code;
  }

  async exchange(input: { provider: SocialProviderId; code: string }) {
    const c = this.codes.get(input.code);
    this.codes.delete(input.code);
    if (!c || c.provider !== input.provider || c.expiresAt < Date.now()) return null;
    return c.profile;
  }
}

/** Production without Google / Apple credentials (an external dependency): sign-in with them is simply not offered. */
export class UnconfiguredSocialAuthProvider implements SocialAuthProvider {
  readonly name = 'none';
  available() {
    return false;
  }
  authorizeUrl(): string {
    throw new Error('social sign-in is not configured');
  }
  async exchange() {
    return null;
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
