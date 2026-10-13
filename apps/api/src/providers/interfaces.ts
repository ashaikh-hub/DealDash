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
    };
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
