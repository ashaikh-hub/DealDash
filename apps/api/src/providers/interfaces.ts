/**
 * Provider adapter interfaces. Business code depends on these, never on vendor SDKs.
 * No production vendor is selected yet; every interface has a development implementation.
 */

// ---- SMS / OTP
export interface SmsMessage {
  to: string;
  templateKey: string;
  body: string;
  locale?: 'en' | 'ar';
}
export interface SmsProvider {
  send(message: SmsMessage): Promise<{ providerRef: string }>;
}

// ---- Email
export interface EmailMessage {
  to: string;
  templateKey: string;
  subject: string;
  body: string;
  locale?: 'en' | 'ar';
}
export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerRef: string }>;
}

// ---- Push
export interface PushMessage {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}
export interface PushProvider {
  send(message: PushMessage): Promise<{ providerRef: string; delivered: boolean }>;
}

// ---- Payments (abstraction only; vendor, Merchant of Record and funds treatment remain open: VALIDATE-KSA)
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export interface PaymentInitiation {
  /** DealDash's own order reference: sent to the PSP as the merchant reference (PY-11). */
  orderId: string;
  /** Minor units of `currency` (the order's currency, from the voucher's market). */
  amountHalalas: number;
  /** ISO 4217 — a provider adapter refuses currencies its contract does not cover. */
  currency: string;
  idempotencyKey: string;
  returnUrl: string;
  /** Pay with a card the customer saved earlier: the provider's own token (the provider may still ask for 3-D Secure). */
  savedCardToken?: string;
}
export interface PaymentInitiationResult {
  providerReference: string;
  status: PaymentStatus;
  redirectUrl?: string;
}
export interface RefundRequest {
  providerReference: string;
  amountHalalas: number;
  idempotencyKey: string;
}
/**
 * A provider callback, already signature-verified and parsed. eventId is unique per provider event (replay and duplicate
 * safe); occurredAt lets the platform reject stale replays. Money events never carry card data.
 */
export type PaymentWebhookEvent =
  | {
      eventId: string;
      kind?: 'PAYMENT';
      providerReference: string;
      status: PaymentStatus;
      occurredAt?: string;
      failureCode?: string;
      methodType?: string;
    }
  | {
      eventId: string;
      kind: 'REFUND';
      providerReference: string;
      refundReference: string;
      status: 'SUCCEEDED' | 'FAILED';
      occurredAt?: string;
    }
  | {
      /** Card pre-authorisation (phase 3): the hold's state changed at the provider (3-D Secure done, declined, lapsed ...). */
      eventId: string;
      kind: 'AUTHORISATION';
      providerReference: string;
      status: CardHoldStatus;
      /** For CAPTURED / PARTIALLY_CAPTURED: the amount captured and the capture's own reference (refundable like a payment). */
      capturedMinor?: number;
      captureReference?: string;
      occurredAt?: string;
      failureCode?: string;
    };

// ---- Card pre-authorisation (phase 3; reservation commitment RC-90). Optional provider capability: a market can offer CARD_PREAUTH
// only when its provider implements it. Real providers must be validated per market (PK / QA / AE / SA) before go-live.
export type CardHoldStatus =
  'PENDING' | 'AUTHORISED' | 'FAILED' | 'EXPIRED' | 'RELEASED' | 'CAPTURED' | 'PARTIALLY_CAPTURED';
export interface CardHoldCapabilities {
  /** Authorise-only (a hold), captured or released later. */
  cardHolds: boolean;
  /** Capture less than the authorised amount (the rest is released by the capture). */
  partialCapture: boolean;
  /** How long an authorisation stays valid at the provider / issuer (a hold must never be relied on beyond it). */
  authValidityMinutes: number;
}
export interface CardHoldRequest {
  /** DealDash's reference sent to the provider (the reservation reference). */
  orderId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  returnUrl: string;
  savedCardToken?: string;
}
export interface CardHoldProvider {
  readonly holdCapabilities: CardHoldCapabilities;
  authorise(
    input: CardHoldRequest,
  ): Promise<{ providerReference: string; status: CardHoldStatus; redirectUrl?: string }>;
  /** Captures up to the authorised amount; returns the capture's own reference (refunds are made against it). */
  capture(input: {
    providerReference: string;
    amountMinor: number;
    idempotencyKey: string;
  }): Promise<{ captureReference: string; status: 'SUCCEEDED' | 'FAILED'; failureCode?: string }>;
  /** Voids the hold (nothing is charged). Releasing an already released / expired hold is not an error. */
  release(providerReference: string): Promise<{ status: CardHoldStatus }>;
  getHoldStatus(providerReference: string): Promise<CardHoldStatus>;
}
// ---- Saved cards (customer experience). Optional provider capability: the card is entered on the PROVIDER's hosted page and the
// provider returns a token plus display details (brand, last 4 digits, expiry). DealDash never sees or stores a card number or CVV.
export type CardBrand = 'VISA' | 'MASTERCARD' | 'MADA' | 'AMEX' | 'OTHER';
export interface SavedCardDetails {
  token: string;
  /** Same card saved twice gives the same fingerprint (no duplicates). */
  fingerprint: string;
  brand: CardBrand;
  last4: string;
  expMonth: number;
  expYear: number;
}
export type CardSetupStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
export interface CardVaultProvider {
  /** Opens the provider's hosted "add a card" page; the customer comes back to `returnUrl`. */
  startCardSetup(input: {
    setupId: string;
    returnUrl: string;
  }): Promise<{ providerSetupRef: string; redirectUrl: string }>;
  /** The outcome of a hosted card setup, read server-side after the customer returns (never trusted from the browser). */
  getCardSetup(
    providerSetupRef: string,
  ): Promise<{ status: CardSetupStatus; card?: SavedCardDetails; failureCode?: string }>;
  /** Deletes the token at the provider (a removed card can no longer be charged). */
  deleteCard(token: string): Promise<void>;
  /** Display details of a saved token (the hosted payment page shows which card is used). */
  describeCard?(token: string): Promise<Pick<SavedCardDetails, 'brand' | 'last4'> | null>;
}
export const supportsCardVault = (p: PaymentProvider): p is PaymentProvider & CardVaultProvider =>
  typeof (p as Partial<CardVaultProvider>).startCardSetup === 'function';

// ---- Social sign-in (customer experience: Google / Apple). Production client ids, secrets and Apple keys are EXTERNAL configuration;
// until they exist the development adapter stands in (never in production unless mock providers are explicitly allowed).
export type SocialProviderId = 'GOOGLE' | 'APPLE';
export interface SocialProfile {
  /** The provider's stable user id ("sub"). */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}
export interface SocialAuthProvider {
  readonly name: string;
  /** Whether the provider can be offered at all (credentials configured, or the development adapter). */
  available(provider: SocialProviderId): boolean;
  authorizeUrl(input: { provider: SocialProviderId; state: string; callbackUrl: string }): string;
  /** Exchanges the authorization code for the verified profile; null when the code is not valid. */
  exchange(input: {
    provider: SocialProviderId;
    code: string;
    callbackUrl: string;
  }): Promise<SocialProfile | null>;
}
export const SOCIAL_AUTH_PROVIDER = Symbol('SOCIAL_AUTH_PROVIDER');

export const supportsCardHolds = (p: PaymentProvider): p is PaymentProvider & CardHoldProvider =>
  typeof (p as Partial<CardHoldProvider>).authorise === 'function' &&
  !!(p as Partial<CardHoldProvider>).holdCapabilities?.cardHolds;
export interface PaymentProvider {
  /** Stable adapter name stored on each payment ("mock" today). */
  readonly name: string;
  initiate(input: PaymentInitiation): Promise<PaymentInitiationResult>;
  /** Cancels an attempt that has not completed. A completed payment returns its final status unchanged. */
  cancel(providerReference: string): Promise<{ status: PaymentStatus }>;
  getStatus(providerReference: string): Promise<PaymentStatus>;
  refund(
    input: RefundRequest,
  ): Promise<{ refundReference: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED' }>;
  /** Verifies the webhook signature and returns the parsed event, or null when invalid. */
  parseWebhook(rawBody: string, signatureHeader: string | undefined): PaymentWebhookEvent | null;
}

// ---- Object / file storage
export interface SignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  key: string;
  expiresAt: string;
}
export interface StoredObjectInfo {
  sizeBytes: number;
}
/**
 * Storage adapter. Real vendors (S3-compatible, cloud storage) implement the same contract with their own
 * pre-signed URLs; the API flow (intent, direct upload, completion check, signed read URL) does not change.
 */
export interface StorageProvider {
  createUploadUrl(input: {
    key: string;
    contentType: string;
    maxBytes: number;
  }): Promise<SignedUpload>;
  createReadUrl(input: {
    key: string;
    expiresInSeconds: number;
    fileName?: string;
  }): Promise<string>;
  /** Returns object metadata, or null when nothing was uploaded yet. */
  head(key: string): Promise<StoredObjectInfo | null>;
  /** Reads the object (used by the completion check for content sniffing and hashing). */
  read(key: string, maxBytes: number): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

/** Malware/content scanning hook. The development scanner is NOT a real malware engine. */
export interface FileScanner {
  scan(input: { data: Buffer; declaredMime: string }): Promise<{ clean: boolean; reason?: string }>;
}

// ---- Video delivery
export interface VideoProvider {
  createUpload(input: { title: string }): Promise<{ assetId: string; uploadUrl: string }>;
  getPlayback(
    assetId: string,
    opts?: { signed?: boolean },
  ): Promise<{ manifestUrl: string; posterUrl: string; expiresAt?: string }>;
}

// ---- Maps / geocoding
export interface GeocodeResult {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  precision: 'exact' | 'approximate';
}
export interface MapsProvider {
  geocode(address: string): Promise<GeocodeResult | null>;
  reverseGeocode(latitude: number, longitude: number): Promise<{ formattedAddress: string } | null>;
}

// ---- Settlement payouts (Stage 9, B2). Vendor / bank file format is not selected (EXTERNAL DEPENDENCY); never account numbers here.
export type PayoutStatus = 'PENDING' | 'PAID' | 'FAILED';
export interface PayoutInstruction {
  /** DealDash's own settlement reference (the bank / provider reference back to DealDash). */
  settlementReference: string;
  amountMinor: number;
  currency: string;
  /** Reference to the verified destination in the secure store (masked / tokenised), never an IBAN. */
  destinationRef: string | null;
  idempotencyKey: string;
}
export interface PayoutProvider {
  readonly name: string;
  /** False for the manual adapter: finance records the bank reference instead (no instruction is sent). */
  readonly sendsInstructions: boolean;
  instruct(
    input: PayoutInstruction,
  ): Promise<{ providerRef: string; status: PayoutStatus; failureReason?: string }>;
  getStatus(
    providerRef: string,
  ): Promise<{ status: PayoutStatus; failureReason?: string; bankRef?: string }>;
}

// ---- injection tokens
export const PAYOUT_PROVIDER = Symbol('PAYOUT_PROVIDER');
export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
export const FILE_SCANNER = Symbol('FILE_SCANNER');
export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');
export const MAPS_PROVIDER = Symbol('MAPS_PROVIDER');
