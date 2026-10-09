import { z } from 'zod';
import { commercialInputSchema } from './commercial';
import {
  ORDER_STATUSES,
  PAYABLE_EVENT_TYPES,
  PAYMENT_EVENT_OUTCOMES,
  PAYMENT_STATUSES,
  REFUND_KINDS,
  REFUND_STATUSES,
  SUPPORT_CASE_STATUSES,
  SUPPORT_CASE_TYPES,
  VOUCHER_ACTIONS,
  VOUCHER_INSTANCE_STATUSES,
  VOUCHER_STATUSES,
  VOUCHER_VALIDITY_TYPES,
  WALLET_STATES,
} from '@dealdash/types';
import {
  dealCategoryViewSchema,
  dealEligibilitySchema,
  dealMediaItemSchema,
  dealMediaViewSchema,
  dealTermsBlocksSchema,
  eligibilityViewSchema,
  isMinorTextEdit,
  publicBranchSchema,
} from './deals';

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const bi = (max: number) =>
  z
    .object({
      en: z.string().trim().max(max).default(''),
      ar: z.string().trim().max(max).default(''),
    })
    .default({ en: '', ar: '' });
const biText = z.object({ en: z.string(), ar: z.string() });
const halalas = (max = 100_000_000) => z.number().int().min(0).max(max);

// ------------------------------------------------------------------ Voucher content (what the merchant writes and DealDash reviews)
export const voucherValiditySchema = z.object({
  type: z.enum(VOUCHER_VALIDITY_TYPES).default('DAYS_FROM_PURCHASE'),
  /** DAYS_FROM_PURCHASE: how long a bought voucher stays valid. */
  days: z.number().int().min(1).max(3650).nullable().default(null),
  /** FIXED_DATE: every voucher expires at the end of this day (Riyadh). */
  validUntil: isoDate.nullable().default(null),
});

export const voucherContentSchema = z.object({
  categoryId: uuid.nullable().default(null),
  title: bi(80),
  shortDescription: bi(140),
  description: bi(1500),
  media: z.array(dealMediaItemSchema).max(5).default([]),
  /** What the voucher is worth at the merchant (integer halalas). */
  faceValueHalalas: halalas().default(0),
  /** What the customer pays (integer halalas). Must not exceed the face value. */
  sellingPriceHalalas: halalas().default(0),
  /** Issuance limit: the most vouchers that can be sold. Unlimited is not allowed in the MVP (VC-03). */
  totalQty: z.number().int().min(0).max(1_000_000).default(0),
  perCustomerLimit: z.number().int().min(1).max(100).default(1),
  validity: voucherValiditySchema.default(() => voucherValiditySchema.parse({})),
  /** When the voucher can be bought. Null start = as soon as approved. */
  saleStartAt: isoDate.nullable().default(null),
  saleEndAt: isoDate.nullable().default(null),
  branchIds: z.array(uuid).max(50).default([]),
  eligibility: dealEligibilitySchema.default({ kind: 'PUBLIC', valueRefs: [], expression: null }),
  commercial: commercialInputSchema.default(() => commercialInputSchema.parse({})),
  redemptionRules: bi(500),
  terms: z
    .object({
      blocks: dealTermsBlocksSchema.default(() => dealTermsBlocksSchema.parse({})),
      textEn: z.string().trim().max(1500).default(''),
      textAr: z.string().trim().max(1500).default(''),
    })
    .default(() => ({ blocks: dealTermsBlocksSchema.parse({}), textEn: '', textAr: '' })),
});
export type VoucherContent = z.infer<typeof voucherContentSchema>;
export const emptyVoucherContent = (): VoucherContent => voucherContentSchema.parse({});

/** Platform limits (configuration `vouchers.limits`). MOCK values; VALIDATE-KSA for anything with legal weight. */
export interface VoucherLimits {
  minValidityDays: number;
  maxValidityDays: number;
  maxFaceValueHalalas: number;
  maxQtyPerVoucher: number;
  maxPerCustomer: number;
  /** Above this savings percentage the voucher goes to manual review with a reason (guardrail). */
  reviewAboveDiscountPercent: number;
}
export const DEFAULT_VOUCHER_LIMITS: VoucherLimits = {
  minValidityDays: 7,
  maxValidityDays: 365,
  maxFaceValueHalalas: 500_000,
  maxQtyPerVoucher: 100_000,
  maxPerCustomer: 10,
  reviewAboveDiscountPercent: 70,
};

/** Reported savings: the difference between the merchant's stated face value and the selling price. Never a guarantee of personal savings. */
export function voucherSavings(faceValueHalalas: number, sellingPriceHalalas: number) {
  const savingsHalalas = Math.max(0, faceValueHalalas - sellingPriceHalalas);
  const percent = faceValueHalalas > 0 ? Math.round((savingsHalalas * 100) / faceValueHalalas) : 0;
  return { savingsHalalas, savingsPercent: percent };
}

export interface VoucherIssue {
  field: string;
  code:
    | 'REQUIRED'
    | 'REQUIRED_EN'
    | 'REQUIRED_AR'
    | 'VALUE_RANGE'
    | 'PRICE_ABOVE_FACE'
    | 'FACE_TOO_HIGH'
    | 'QTY_REQUIRED'
    | 'QTY_TOO_HIGH'
    | 'VALIDITY_TOO_SHORT'
    | 'VALIDITY_TOO_LONG'
    | 'END_BEFORE_START'
    | 'IN_PAST'
    | 'LIMIT_TOO_HIGH'
    | 'LIMIT_ABOVE_QTY';
}

export function voucherIssues(
  c: VoucherContent,
  opts: { now?: Date; limits?: VoucherLimits } = {},
): VoucherIssue[] {
  const limits = opts.limits ?? DEFAULT_VOUCHER_LIMITS;
  const out: VoucherIssue[] = [];
  const bilingual = (field: string, v: { en: string; ar: string }) => {
    if (!v.en.trim()) out.push({ field, code: 'REQUIRED_EN' });
    if (!v.ar.trim()) out.push({ field, code: 'REQUIRED_AR' });
  };
  if (!c.categoryId) out.push({ field: 'categoryId', code: 'REQUIRED' });
  bilingual('title', c.title);
  bilingual('shortDescription', c.shortDescription);
  bilingual('description', c.description);
  bilingual('redemptionRules', c.redemptionRules);
  if (c.media.length < 1) out.push({ field: 'media', code: 'REQUIRED' });
  if (c.branchIds.length < 1) out.push({ field: 'branchIds', code: 'REQUIRED' });

  if (c.faceValueHalalas <= 0) out.push({ field: 'faceValueHalalas', code: 'VALUE_RANGE' });
  else if (c.faceValueHalalas > limits.maxFaceValueHalalas)
    out.push({ field: 'faceValueHalalas', code: 'FACE_TOO_HIGH' });
  if (c.sellingPriceHalalas <= 0) out.push({ field: 'sellingPriceHalalas', code: 'VALUE_RANGE' });
  else if (c.sellingPriceHalalas > c.faceValueHalalas)
    out.push({ field: 'sellingPriceHalalas', code: 'PRICE_ABOVE_FACE' });

  if (c.totalQty < 1) out.push({ field: 'totalQty', code: 'QTY_REQUIRED' });
  else if (c.totalQty > limits.maxQtyPerVoucher)
    out.push({ field: 'totalQty', code: 'QTY_TOO_HIGH' });
  if (c.perCustomerLimit > limits.maxPerCustomer)
    out.push({ field: 'perCustomerLimit', code: 'LIMIT_TOO_HIGH' });
  if (c.totalQty >= 1 && c.perCustomerLimit > c.totalQty)
    out.push({ field: 'perCustomerLimit', code: 'LIMIT_ABOVE_QTY' });

  if (c.validity.type === 'DAYS_FROM_PURCHASE') {
    if (c.validity.days === null) out.push({ field: 'validity.days', code: 'REQUIRED' });
    else if (c.validity.days < limits.minValidityDays)
      out.push({ field: 'validity.days', code: 'VALIDITY_TOO_SHORT' });
    else if (c.validity.days > limits.maxValidityDays)
      out.push({ field: 'validity.days', code: 'VALIDITY_TOO_LONG' });
  } else {
    if (!c.validity.validUntil) out.push({ field: 'validity.validUntil', code: 'REQUIRED' });
    else if (opts.now) {
      const until = new Date(c.validity.validUntil).getTime();
      const now = opts.now.getTime();
      if (until <= now) out.push({ field: 'validity.validUntil', code: 'IN_PAST' });
      else if (until - now < limits.minValidityDays * 86_400_000)
        out.push({ field: 'validity.validUntil', code: 'VALIDITY_TOO_SHORT' });
    }
  }
  if (c.saleStartAt && c.saleEndAt && new Date(c.saleEndAt) <= new Date(c.saleStartAt))
    out.push({ field: 'saleEndAt', code: 'END_BEFORE_START' });
  if (c.saleEndAt && opts.now && new Date(c.saleEndAt).getTime() <= opts.now.getTime())
    out.push({ field: 'saleEndAt', code: 'IN_PAST' });
  if (
    c.validity.type === 'FIXED_DATE' &&
    c.validity.validUntil &&
    c.saleEndAt &&
    new Date(c.validity.validUntil).getTime() < new Date(c.saleEndAt).getTime()
  )
    out.push({ field: 'validity.validUntil', code: 'END_BEFORE_START' });

  if (!c.terms.textEn.trim()) out.push({ field: 'terms.textEn', code: 'REQUIRED_EN' });
  if (!c.terms.textAr.trim()) out.push({ field: 'terms.textAr', code: 'REQUIRED_AR' });
  if (c.eligibility.kind === 'COMPOSITE' ? !c.eligibility.expression : c.eligibility.kind !== 'PUBLIC' && c.eligibility.valueRefs.length < 1)
    out.push({ field: 'eligibility', code: 'REQUIRED' });
  return out;
}

export function voucherTranslationStatus(c: VoucherContent) {
  const missing = new Set<'en' | 'ar'>();
  for (const i of voucherIssues(c)) {
    if (i.code === 'REQUIRED_EN') missing.add('en');
    if (i.code === 'REQUIRED_AR') missing.add('ar');
  }
  return { complete: missing.size === 0, missing: [...missing] };
}

/**
 * An approved voucher accepts wording and photo corrections only. Anything that changes what a customer buys or receives
 * (value, price, validity, branches, eligibility, terms, quantity) is material and refused: stock is changed through the
 * stock endpoint; everything else means end the sale and create a new voucher (stricter than VC-08, documented).
 */
export function voucherMaterialChanges(before: VoucherContent, after: VoucherContent): string[] {
  const m: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const field of ['title', 'shortDescription', 'description', 'redemptionRules'] as const)
    for (const lang of ['en', 'ar'] as const)
      if (
        before[field][lang] !== after[field][lang] &&
        !isMinorTextEdit(before[field][lang], after[field][lang]) &&
        !m.includes(field)
      )
        m.push(field);
  if (before.categoryId !== after.categoryId) m.push('categoryId');
  if (before.faceValueHalalas !== after.faceValueHalalas) m.push('faceValueHalalas');
  if (before.sellingPriceHalalas !== after.sellingPriceHalalas) m.push('sellingPriceHalalas');
  if (before.perCustomerLimit !== after.perCustomerLimit) m.push('perCustomerLimit');
  if (!same(before.validity, after.validity)) m.push('validity');
  const inst = (v: string | null) => (v ? new Date(v).getTime() : null);
  if (inst(before.saleStartAt) !== inst(after.saleStartAt)) m.push('saleStartAt');
  if (inst(before.saleEndAt) !== inst(after.saleEndAt)) m.push('saleEndAt');
  if (!same([...before.branchIds].sort(), [...after.branchIds].sort())) m.push('branches');
  if (!same(before.eligibility, after.eligibility)) m.push('eligibility');
  if (!same(before.terms.blocks, after.terms.blocks)) m.push('terms');
  for (const k of ['textEn', 'textAr'] as const)
    if (
      before.terms[k] !== after.terms[k] &&
      !isMinorTextEdit(before.terms[k], after.terms[k]) &&
      !m.includes('terms')
    )
      m.push('terms');
  return m;
}

// ------------------------------------------------------------------ requests
export const voucherCreateSchema = z.object({
  content: voucherContentSchema.default(() => voucherContentSchema.parse({})),
});
export const voucherSaveSchema = z.object({
  content: voucherContentSchema,
  expectedVersion: z.number().int().min(0).optional(),
});
export const voucherListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(VOUCHER_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});
export const voucherStockSchema = z.object({
  /** Positive adds issuance capacity; negative removes capacity that is still unsold (never below held + sold). */
  delta: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, 'delta must not be zero'),
  reason: z.string().trim().max(300).optional(),
});

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
export const voucherDiscoveryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(300).optional(),
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(41).optional(),
  city: z.string().trim().max(40).optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  radiusMeters: z.coerce.number().int().min(100).max(100_000).optional(),
  sort: z.enum(['newest', 'price_low', 'price_high', 'savings', 'nearest']).optional(),
  eligibility: z.enum(['all', 'unlocked']).default('all'),
});

/** Terms version the customer accepted at checkout (snapshotted on the order). */
export const CHECKOUT_TERMS_VERSION = '2026-10-v1';
/** Starting checkout holds the voucher for a short time. MVP: one voucher per order (the column exists for a founder decision on quantity). */
export const checkoutCreateSchema = z.object({
  voucherId: uuid,
  quantity: z.number().int().min(1).max(10).default(1),
});
/** Pressing Pay: the customer accepts the terms (snapshotted on the order) and a payment attempt starts. */
export const payOrderSchema = z.object({
  acceptTerms: z.literal(true, { message: 'Terms must be accepted' }),
  termsVersion: z.string().trim().max(40).default(CHECKOUT_TERMS_VERSION),
  /** Where the (mock or real) payment page returns the customer. */
  returnUrl: z.string().url().max(500).optional(),
});
export const refundRequestSchema = z.object({
  reasonCode: z
    .enum(['CHANGED_MIND', 'DUPLICATE', 'MERCHANT_CANNOT_HONOUR', 'OTHER'])
    .default('CHANGED_MIND'),
  note: z.string().trim().max(500).optional(),
});
export const orderListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const walletQuerySchema = z.object({
  tab: z.enum(['active', 'used', 'expired', 'refunded']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const supportCaseCreateSchema = z.object({
  type: z.enum(SUPPORT_CASE_TYPES).default('OTHER'),
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(1000),
  voucherInstanceId: uuid.optional(),
  orderId: uuid.optional(),
});

export const voucherDecisionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  reasonAr: z.string().trim().max(500).optional(),
  fields: z.array(z.string().max(80)).max(30).optional(),
});
export const refundDecisionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export const adminRefundCreateSchema = z.object({
  instanceId: uuid,
  reason: z.string().trim().min(3).max(500),
});
export const caseUpdateSchema = z.object({
  status: z.enum(SUPPORT_CASE_STATUSES),
  note: z.string().trim().max(500).optional(),
});
export const adjustmentSchema = z.object({
  organizationId: uuid,
  /** Positive credits the merchant's settlement-eligible balance, negative debits it. Integer halalas. */
  amountHalalas: z
    .number()
    .int()
    .min(-100_000_000)
    .max(100_000_000)
    .refine((n) => n !== 0, 'amount must not be zero'),
  reason: z.string().trim().min(3).max(500),
});
export const adminRefundListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(REFUND_STATUSES).optional(),
});
export const adminCaseListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(SUPPORT_CASE_STATUSES).optional(),
});
export const adminVoucherListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(VOUCHER_STATUSES).optional(),
  queue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  merchantId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
});
export const financeSearchSchema = z.object({
  q: z.string().trim().min(4).max(60),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const merchantVoucherSalesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  voucherId: uuid.optional(),
  status: z.enum(VOUCHER_INSTANCE_STATUSES).optional(),
});
export const payableEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

// ------------------------------------------------------------------ responses (customer)
export const voucherCardSchema = z.object({
  id: uuid,
  merchantId: uuid,
  merchantName: biText,
  merchantLogoUrl: z.string().nullable(),
  title: biText,
  shortDescription: biText,
  category: z.object({ code: z.string(), name: biText }).nullable(),
  imageUrl: z.string().nullable(),
  imageAlt: biText,
  faceValueHalalas: z.number().int(),
  sellingPriceHalalas: z.number().int(),
  /** Reported savings = merchant face value minus selling price. Never a guarantee of total personal savings. */
  reportedSavingsHalalas: z.number().int(),
  reportedSavingsPercent: z.number().int(),
  currency: z.literal('SAR'),
  validity: voucherValiditySchema,
  saleEndsAt: z.string().nullable(),
  /** Vouchers left (null above the display threshold). */
  remaining: z.number().int().nullable(),
  soldOut: z.boolean(),
  distanceMeters: z.number().nullable(),
  nearestBranch: z
    .object({ id: uuid, name: biText, area: biText, latitude: z.number(), longitude: z.number() })
    .nullable(),
  branchCount: z.number().int(),
  eligibility: eligibilityViewSchema,
  availability: z.enum(['AVAILABLE', 'SOLD_OUT', 'ENDED', 'PAUSED', 'UNAVAILABLE', 'SCHEDULED']),
  serverNow: z.string(),
});
export type VoucherCard = z.infer<typeof voucherCardSchema>;

export const voucherDetailSchema = voucherCardSchema.extend({
  description: biText,
  redemptionRules: biText,
  terms: z.object({ blocks: dealTermsBlocksSchema, text: biText }),
  media: z.array(z.object({ url: z.string(), alt: biText })),
  branches: z.array(publicBranchSchema),
  perCustomerLimit: z.number().int(),
  /** Vouchers this customer may still buy (limit minus already paid or in checkout). */
  remainingForMe: z.number().int().nullable(),
  termsVersion: z.string(),
  canBuy: z.boolean(),
  blockedReason: z.enum(['SOLD_OUT', 'NOT_ON_SALE', 'LIMIT_REACHED', 'LOCKED', 'ENDED']).nullable(),
});
export type VoucherDetail = z.infer<typeof voucherDetailSchema>;

export const paymentViewSchema = z.object({
  id: uuid,
  status: z.enum(PAYMENT_STATUSES),
  amountHalalas: z.number().int(),
  currency: z.literal('SAR'),
  attemptNo: z.number().int(),
  /** Where the customer completes payment (mock page in development). Null once the attempt is final. */
  redirectUrl: z.string().nullable(),
  failureCode: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type PaymentView = z.infer<typeof paymentViewSchema>;

export const orderViewSchema = z.object({
  id: uuid,
  reference: z.string(),
  status: z.enum(ORDER_STATUSES),
  quantity: z.number().int(),
  unitPriceHalalas: z.number().int(),
  faceValueHalalas: z.number().int(),
  totalHalalas: z.number().int(),
  currency: z.literal('SAR'),
  holdExpiresAt: z.string(),
  termsVersion: z.string().nullable(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  voucher: z.object({
    id: uuid,
    title: biText,
    imageUrl: z.string().nullable(),
    merchantName: biText,
    reportedSavingsHalalas: z.number().int(),
  }),
  payment: paymentViewSchema.nullable(),
  /** Set only after the payment is confirmed and the voucher is issued. */
  voucherInstanceId: uuid.nullable(),
  retriesLeft: z.number().int(),
  canRetry: z.boolean(),
  canCancel: z.boolean(),
  serverNow: z.string(),
});
export type OrderView = z.infer<typeof orderViewSchema>;

export const refundViewSchema = z.object({
  id: uuid,
  reference: z.string(),
  status: z.enum(REFUND_STATUSES),
  kind: z.enum(REFUND_KINDS),
  amountHalalas: z.number().int(),
  reasonCode: z.string(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  refundedAt: z.string().nullable(),
  /** Customer-safe explanation of the outcome, when there is one. */
  decisionNote: z.string().nullable(),
});
export type RefundView = z.infer<typeof refundViewSchema>;

export const walletItemSchema = z.object({
  id: uuid,
  reference: z.string(),
  state: z.enum(WALLET_STATES),
  voucherId: uuid,
  title: biText,
  merchantName: biText,
  imageUrl: z.string().nullable(),
  purchasePriceHalalas: z.number().int(),
  faceValueHalalas: z.number().int(),
  currency: z.literal('SAR'),
  validFrom: z.string().nullable(),
  expiresAt: z.string(),
  issuedAt: z.string(),
  redeemedAt: z.string().nullable(),
  branchCount: z.number().int(),
});
export type WalletItem = z.infer<typeof walletItemSchema>;

export const walletDetailSchema = walletItemSchema.extend({
  description: biText,
  redemptionRules: biText,
  terms: z.object({ blocks: dealTermsBlocksSchema, text: biText }),
  merchantId: uuid,
  branches: z.array(publicBranchSchema),
  orderReference: z.string(),
  /** Present only while the voucher can be redeemed. The QR text is an opaque token, never a database id. */
  code: z.object({ qr: z.string(), manual: z.string() }).nullable(),
  refund: refundViewSchema.nullable(),
  /** Whether "Request a refund" is offered (policy window, ACTIVE, not redeemed). */
  canRequestRefund: z.boolean(),
  refundWindowEndsAt: z.string().nullable(),
  refundNote: z.enum(['REVIEW_REQUIRED', 'WINDOW_PASSED', 'REDEEMED', 'NOT_AVAILABLE']).nullable(),
  supportCaseOpen: z.boolean(),
  serverNow: z.string(),
});
export type WalletDetail = z.infer<typeof walletDetailSchema>;

export const supportCaseViewSchema = z.object({
  id: uuid,
  reference: z.string(),
  type: z.enum(SUPPORT_CASE_TYPES),
  status: z.enum(SUPPORT_CASE_STATUSES),
  subject: z.string(),
  createdAt: z.string(),
});

// ------------------------------------------------------------------ responses (merchant / admin)
export const voucherStockViewSchema = z.object({
  total: z.number().int(),
  held: z.number().int(),
  sold: z.number().int(),
  remaining: z.number().int(),
});

export const voucherViewSchema = z.object({
  id: uuid,
  organizationId: uuid,
  status: z.enum(VOUCHER_STATUSES),
  version: z.number().int(),
  content: voucherContentSchema,
  media: z.array(dealMediaViewSchema),
  stock: voucherStockViewSchema,
  category: dealCategoryViewSchema.nullable(),
  savings: z.object({ savingsHalalas: z.number().int(), savingsPercent: z.number().int() }),
  pausedBy: z.enum(['MERCHANT', 'DEALDASH']).nullable(),
  submittedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  translation: z.object({ complete: z.boolean(), missing: z.array(z.enum(['en', 'ar'])) }),
  issues: z.array(z.object({ field: z.string(), code: z.string() })),
  guardrail: z.object({
    outcome: z.enum(['AUTO_PUBLISH', 'MANUAL_REVIEW']),
    reasons: z.array(z.string()),
  }),
  discoverable: z.object({ visible: z.boolean(), reason: z.string().nullable() }),
  latestDecision: z
    .object({
      id: uuid,
      action: z.enum(VOUCHER_ACTIONS),
      reason: z.string().nullable(),
      reasonAr: z.string().nullable(),
      fields: z.array(z.string()),
      actorRole: z.string().nullable(),
      actorName: z.string().nullable(),
      byDealDash: z.boolean(),
      createdAt: z.string(),
    })
    .nullable(),
  allowedActions: z.array(z.string()),
  serverNow: z.string(),
});
export type VoucherView = z.infer<typeof voucherViewSchema>;

export const voucherRowSchema = z.object({
  id: uuid,
  status: z.enum(VOUCHER_STATUSES),
  title: biText,
  faceValueHalalas: z.number().int(),
  sellingPriceHalalas: z.number().int(),
  branchCount: z.number().int(),
  saleStartAt: z.string().nullable(),
  saleEndAt: z.string().nullable(),
  imageUrl: z.string().nullable(),
  totalQty: z.number().int(),
  soldQty: z.number().int(),
  heldQty: z.number().int(),
  redeemedQty: z.number().int(),
  updatedAt: z.string(),
});

export const voucherSaveResultSchema = z.object({
  voucher: voucherViewSchema,
  outcome: z.enum(['SAVED', 'APPLIED_MINOR']),
});
export const voucherSubmitResultSchema = z.object({
  voucher: voucherViewSchema,
  outcome: z.enum(['SENT_FOR_REVIEW', 'PUBLISHED', 'SCHEDULED']),
});

/** Merchant view of a sold voucher: first name only. Never contact data, never payment data. */
export const merchantVoucherSaleRowSchema = z.object({
  id: uuid,
  reference: z.string(),
  voucherId: uuid,
  title: biText,
  customerFirstName: z.string().nullable(),
  status: z.enum(VOUCHER_INSTANCE_STATUSES),
  pricePaidHalalas: z.number().int(),
  faceValueHalalas: z.number().int(),
  issuedAt: z.string(),
  expiresAt: z.string(),
  redeemedAt: z.string().nullable(),
  redeemedBranch: biText.nullable(),
  redemptionId: uuid.nullable(),
  redemptionReference: z.string().nullable(),
  canReverse: z.boolean(),
});

export const voucherMonitorSchema = z.object({
  status: z.enum(VOUCHER_STATUSES),
  serverNow: z.string(),
  stock: voucherStockViewSchema,
  sales: z.object({
    sold: z.number().int(),
    active: z.number().int(),
    redeemed: z.number().int(),
    expired: z.number().int(),
    refunded: z.number().int(),
    redemptionRatePct: z.number().nullable(),
  }),
  /** Measurable steps only. Revenue claims appear only from verified payments and redemptions (finance block). */
  funnel: z.object({
    impressions: z.number().int(),
    detailViews: z.number().int(),
    checkoutsStarted: z.number().int(),
    paymentsSucceeded: z.number().int(),
    paymentsFailed: z.number().int(),
  }),
  /** Verified money for this voucher (only when the viewer may see finance). */
  finance: z
    .object({
      soldGrossHalalas: z.number().int(),
      redeemedGrossHalalas: z.number().int(),
      settlementEligibleHalalas: z.number().int(),
      refundedHalalas: z.number().int(),
    })
    .nullable(),
  disclaimerKey: z.literal('voucher_signals_and_verified_payments_only'),
});
export type VoucherMonitor = z.infer<typeof voucherMonitorSchema>;

export const payableSummarySchema = z.object({
  currency: z.literal('SAR'),
  /** Customer money held for the merchant, not yet settlement-eligible (sold, not redeemed). */
  heldHalalas: z.number().int(),
  /** Net of platform fee, after successful redemption. Settlement itself is Stage 8. */
  settlementEligibleHalalas: z.number().int(),
  platformFeeHalalas: z.number().int(),
  refundedHalalas: z.number().int(),
  expiredValueHalalas: z.number().int(),
  accrualPoint: z.string(),
  counts: z.object({
    sold: z.number().int(),
    redeemed: z.number().int(),
    refunded: z.number().int(),
    expired: z.number().int(),
  }),
  disclaimerKey: z.literal('legal_treatment_validate_ksa'),
});
export type PayableSummary = z.infer<typeof payableSummarySchema>;

export const payableEventRowSchema = z.object({
  id: uuid,
  type: z.enum(PAYABLE_EVENT_TYPES),
  amountHalalas: z.number().int(),
  feeHalalas: z.number().int(),
  instanceReference: z.string().nullable(),
  voucherTitle: biText.nullable(),
  createdAt: z.string(),
  note: z.string().nullable(),
});

export const adminVoucherRowSchema = z.object({
  id: uuid,
  status: z.enum(VOUCHER_STATUSES),
  title: biText,
  faceValueHalalas: z.number().int(),
  sellingPriceHalalas: z.number().int(),
  merchant: z.object({ id: uuid, nameEn: z.string(), nameAr: z.string(), trustLevel: z.string() }),
  branchCount: z.number().int(),
  totalQty: z.number().int(),
  submittedAt: z.string().nullable(),
  saleStartAt: z.string().nullable(),
  saleEndAt: z.string().nullable(),
});

export const adminVoucherDetailSchema = voucherViewSchema.extend({
  merchant: z.object({
    id: uuid,
    nameEn: z.string(),
    nameAr: z.string(),
    legalName: z.string().nullable(),
    commercialRegistration: z.string().nullable(),
    status: z.string(),
    trustLevel: z.string(),
    riskTier: z.string(),
  }),
  branches: z.array(z.object({ id: uuid, name: biText, city: z.string(), status: z.string() })),
  history: z.array(
    z.object({
      id: uuid,
      action: z.enum(VOUCHER_ACTIONS),
      fromStatus: z.enum(VOUCHER_STATUSES).nullable(),
      toStatus: z.enum(VOUCHER_STATUSES).nullable(),
      reason: z.string().nullable(),
      reasonAr: z.string().nullable(),
      fields: z.array(z.string()),
      actorRole: z.string().nullable(),
      actorName: z.string().nullable(),
      byDealDash: z.boolean(),
      createdAt: z.string(),
    }),
  ),
  preview: voucherDetailSchema,
  reviewTarget: z.enum(['NONE', 'VOUCHER']),
  adminActions: z.array(z.string()),
  /** What the reviewer must check beyond the content: the commercial rules that apply to this voucher. */
  commercial: z.object({
    savings: z.object({ savingsHalalas: z.number().int(), savingsPercent: z.number().int() }),
    reviewAboveDiscountPercent: z.number().int(),
    discountFlag: z.boolean(),
    refundPolicy: z.object({
      windowHours: z.number().int(),
      outsideWindow: z.enum(['REVIEW', 'BLOCK']),
      placeholder: z.literal(true),
    }),
    payableRule: z.object({
      accrualPoint: z.string(),
      feePercentBps: z.number().int(),
      feeFixedHalalas: z.number().int(),
      placeholder: z.literal(true),
    }),
    expiredValuePolicy: z.string(),
  }),
});
export type AdminVoucherDetail = z.infer<typeof adminVoucherDetailSchema>;

// ---- admin finance / refund workbench
export const adminPaymentRowSchema = z.object({
  id: uuid,
  status: z.enum(PAYMENT_STATUSES),
  amountHalalas: z.number().int(),
  attemptNo: z.number().int(),
  /** Hidden from Support. */
  providerReference: z.string().nullable(),
  failureCode: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export const adminRefundRowSchema = refundViewSchema.extend({
  orderReference: z.string(),
  voucherReference: z.string().nullable(),
  merchant: biText,
  customerFirstName: z.string().nullable(),
  requestedByRole: z.string().nullable(),
  needsChecker: z.boolean(),
  /** Admin actions allowed for the caller right now. */
  actions: z.array(z.enum(['approve', 'reject', 'retry'])),
  note: z.string().nullable(),
});
export const adminOrderDetailSchema = z.object({
  order: z.object({
    id: uuid,
    reference: z.string(),
    status: z.enum(ORDER_STATUSES),
    totalHalalas: z.number().int(),
    quantity: z.number().int(),
    createdAt: z.string(),
    paidAt: z.string().nullable(),
    termsVersion: z.string().nullable(),
    termsAcceptedAt: z.string().nullable(),
    customer: z.object({
      userId: uuid,
      displayName: z.string(),
      mobileMasked: z.string().nullable(),
    }),
    voucher: z.object({ id: uuid, title: biText, merchant: biText, merchantId: uuid }),
  }),
  payments: z.array(adminPaymentRowSchema),
  events: z.array(
    z.object({
      id: uuid,
      kind: z.string(),
      status: z.string(),
      outcome: z.enum(PAYMENT_EVENT_OUTCOMES),
      signatureVerified: z.boolean(),
      receivedAt: z.string(),
      note: z.string().nullable(),
    }),
  ),
  instance: z
    .object({
      id: uuid,
      reference: z.string(),
      status: z.enum(VOUCHER_INSTANCE_STATUSES),
      expiresAt: z.string(),
      redeemedAt: z.string().nullable(),
      redemption: z
        .object({
          id: uuid,
          reference: z.string(),
          status: z.enum(['REDEEMED', 'REVERSED']),
          redeemedAt: z.string(),
          branch: biText,
          reversedAt: z.string().nullable(),
          reverseReason: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
  refunds: z.array(adminRefundRowSchema),
  journals: z.array(
    z.object({
      id: uuid,
      type: z.string(),
      postedAt: z.string(),
      memo: z.string().nullable(),
      entries: z.array(
        z.object({
          account: z.string(),
          amountHalalas: z.number().int(),
          memo: z.string().nullable(),
        }),
      ),
    }),
  ),
  payableEvents: z.array(payableEventRowSchema),
  cases: z.array(supportCaseViewSchema),
  canSeeProviderData: z.boolean(),
  canReverseRedemption: z.boolean(),
  canCreateRefund: z.boolean(),
});
export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;

export const financeSearchRowSchema = z.object({
  kind: z.enum(['ORDER', 'PAYMENT', 'VOUCHER', 'REFUND', 'REDEMPTION']),
  orderId: uuid,
  reference: z.string(),
  status: z.string(),
  amountHalalas: z.number().int(),
  merchant: biText,
  createdAt: z.string(),
});

export const adminMerchantPayableRowSchema = z.object({
  merchant: z.object({ id: uuid, nameEn: z.string(), nameAr: z.string() }),
  heldHalalas: z.number().int(),
  settlementEligibleHalalas: z.number().int(),
  platformFeeHalalas: z.number().int(),
  refundedHalalas: z.number().int(),
  expiredValueHalalas: z.number().int(),
});

export const financeOverviewSchema = z.object({
  counts: z.object({
    ordersPendingPayment: z.number().int(),
    refundsOpen: z.number().int(),
    refundsFailed: z.number().int(),
    paymentsLast24h: z.number().int(),
    failedLast24h: z.number().int(),
    refundsLast24h: z.number().int(),
  }),
  ledger: z.object({
    balanced: z.boolean(),
    journals: z.number().int(),
    heldHalalas: z.number().int(),
    settlementEligibleHalalas: z.number().int(),
    platformRevenueHalalas: z.number().int(),
    pspClearingHalalas: z.number().int(),
    expiredValueHalalas: z.number().int(),
  }),
  merchants: z.array(adminMerchantPayableRowSchema),
  disclaimerKey: z.literal('legal_treatment_validate_ksa'),
});

export const adminCaseRowSchema = supportCaseViewSchema.extend({
  customerFirstName: z.string().nullable(),
  body: z.string(),
  orderReference: z.string().nullable(),
  voucherReference: z.string().nullable(),
  note: z.string().nullable(),
});

export type VoucherRow = z.infer<typeof voucherRowSchema>;
export type AdminVoucherRow = z.infer<typeof adminVoucherRowSchema>;
export type AdminRefundRow = z.infer<typeof adminRefundRowSchema>;
export type MerchantVoucherSaleRow = z.infer<typeof merchantVoucherSaleRowSchema>;
export type PayableEventRow = z.infer<typeof payableEventRowSchema>;
export type FinanceOverview = z.infer<typeof financeOverviewSchema>;
