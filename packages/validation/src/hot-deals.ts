import { z } from 'zod';
import { commercialInputSchema } from './commercial';
import {
  CANCELLED_BY,
  COMMITMENT_METHODS,
  type CommitmentMethod,
  ELIGIBILITY_KINDS,
  HOT_DEAL_ACTIONS,
  HOT_DEAL_LIMIT_TYPES,
  HOT_DEAL_STATUSES,
  LIVE_DEAL_MECHANICS,
  NOTIFICATION_TYPES,
  PAID_COMMITMENT_METHODS,
  REDEMPTION_RESULTS,
  REFUND_STATUSES,
  RESERVATION_AUTH_STATUSES,
  RESERVATION_PAYMENT_STATUSES,
  RESERVATION_STATUSES,
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

// ------------------------------------------------------------------ Exclusive Deal content
export const hotDealAllocationSchema = z.object({
  branchId: uuid,
  /** Units for this branch (inventory is per branch in the MVP). 0 means "no stock tracked" (walk-in deals). */
  units: z.number().int().min(0).max(1_000_000).default(0),
});

/**
 * How a customer commits to a reservation (founder decision 2026-10-15). `method` null = not declared: content saved before the
 * commitment model, treated as FREE, which only the effective reservation policy can allow (RC-05, RC-21, RC-22).
 */
export const hotDealCommitmentSchema = z.object({
  method: z.enum(COMMITMENT_METHODS).nullable().default(null),
  /** Per unit, in minor units of the market currency: the price (FULL_PREPAYMENT), the deposit (DEPOSIT) or the card hold (CARD_PREAUTH). */
  amountMinor: z.number().int().min(0).max(100_000_000).nullable().default(null),
  /** DEPOSIT only: false = kept even when the customer cancels before the cut-off (only where the policy allows it). */
  depositRefundable: z.boolean().nullable().default(null),
  /** Minutes before the hold ends after which a cancellation no longer returns refundable amounts. */
  cancelCutoffMinutes: z.number().int().min(0).max(1440).nullable().default(null),
  /** FULL_PREPAYMENT only: share refunded on a late cancellation or no-show; null = the policy default. */
  noShowRefundPercent: z.number().int().min(0).max(100).nullable().default(null),
});
export type HotDealCommitment = z.infer<typeof hotDealCommitmentSchema>;

/** The method a deal's reservations use: null when reservations are off; an undeclared method is FREE (legacy content). */
export const commitmentMethodOf = (
  c: Pick<HotDealContent, 'reservationsEnabled' | 'commitment'>,
): CommitmentMethod | null => (c.reservationsEnabled ? (c.commitment.method ?? 'FREE') : null);

export const hotDealContentSchema = z.object({
  categoryId: uuid.nullable().default(null),
  mechanic: z.enum(LIVE_DEAL_MECHANICS).nullable().default(null),
  valueNumber: z.number().min(0).max(1_000_000).nullable().default(null),
  offerLabel: bi(40),
  title: bi(80),
  shortDescription: bi(140),
  description: bi(1500),
  media: z.array(dealMediaItemSchema).max(5).default([]),
  limitType: z.enum(HOT_DEAL_LIMIT_TYPES).default('QUANTITY'),
  /** Off = a time-limited walk-in deal: view, visit, no reservation, no code (HD-14). */
  reservationsEnabled: z.boolean().default(true),
  allocations: z.array(hotDealAllocationSchema).max(50).default([]),
  perCustomerLimit: z.number().int().min(1).max(100).default(1),
  /** Minutes a reservation is held; null uses the platform default (configuration, initial value 30). */
  holdMinutes: z.number().int().min(1).max(1440).nullable().default(null),
  /** Reservation commitment (2026-10-15, RC-04 / RC-20). Ignored when reservations are off. */
  commitment: hotDealCommitmentSchema.default(() => hotDealCommitmentSchema.parse({})),
  startAt: isoDate.nullable().default(null),
  endAt: isoDate.nullable().default(null),
  eligibility: dealEligibilitySchema.default({ kind: 'PUBLIC', valueRefs: [], expression: null }),
  /** Who funds what (commercial governance). Charges come from pricing agreements, never from here. */
  commercial: commercialInputSchema.default(() => commercialInputSchema.parse({})),
  terms: z
    .object({
      blocks: dealTermsBlocksSchema.default(() => dealTermsBlocksSchema.parse({})),
      textEn: z.string().trim().max(1500).default(''),
      textAr: z.string().trim().max(1500).default(''),
    })
    .default(() => ({ blocks: dealTermsBlocksSchema.parse({}), textEn: '', textAr: '' })),
});
export type HotDealContent = z.infer<typeof hotDealContentSchema>;
export const emptyHotDealContent = (): HotDealContent => hotDealContentSchema.parse({});

/** Platform limits (configuration `hot_deals.limits` and `reservation.hold_limits`). */
export interface HotDealLimits {
  maxHours: number;
  maxPerCustomer: number;
  maxUnitsPerBranch: number;
  holdMinMinutes: number;
  holdMaxMinutes: number;
}
export const DEFAULT_HOT_LIMITS: HotDealLimits = {
  maxHours: 72,
  maxPerCustomer: 5,
  maxUnitsPerBranch: 5000,
  holdMinMinutes: 10,
  holdMaxMinutes: 120,
};

export interface HotDealIssue {
  field: string;
  code:
    | 'REQUIRED'
    | 'REQUIRED_EN'
    | 'REQUIRED_AR'
    | 'END_BEFORE_START'
    | 'IN_PAST'
    | 'VALUE_RANGE'
    | 'DURATION_TOO_LONG'
    | 'LIMIT_TOO_HIGH'
    | 'UNITS_REQUIRED'
    | 'UNITS_TOO_HIGH'
    | 'HOLD_OUT_OF_RANGE'
    | 'TYPE_MISMATCH'
    | 'LIMIT_REQUIRED'
    | 'METHOD_REQUIRED'
    | 'METHOD_NOT_ALLOWED'
    | 'AMOUNT_OUT_OF_RANGE'
    | 'CUTOFF_OUT_OF_RANGE'
    | 'REFUND_PERCENT_OUT_OF_RANGE'
    | 'NOT_ALLOWED';
}

/** The effective reservation policy as the commitment check needs it (resolved by the API, RC-10 / RC-11). */
export interface CommitmentPolicy {
  /** Already decided for this environment and market (RC-05). */
  freeAllowed: boolean;
  allowedMethods: readonly string[];
  depositMinMinor: number;
  depositMaxMinor: number;
  nonRefundableDepositAllowed: boolean;
  preauthMaxMinor: number;
  cutoffMinMinutes: number;
  cutoffMaxMinutes: number;
  prepaymentRefundMinPercent: number;
  prepaymentRefundMaxPercent: number;
  /** Phase 3: a card hold may be captured in part (the deal's release share on a late cancellation / no-show). */
  preauthPartialCaptureAllowed?: boolean;
}

/**
 * RC-04 / RC-05 / RC-20 / RC-21: a deal with reservations must state a commitment method the policy allows, with values inside the
 * policy's ranges. Walk-in deals (reservations off) have nothing to check.
 */
export function commitmentIssues(c: HotDealContent, policy: CommitmentPolicy): HotDealIssue[] {
  const method = commitmentMethodOf(c);
  if (!method) return [];
  const out: HotDealIssue[] = [];
  const m = c.commitment;
  if (method === 'FREE') {
    if (!policy.freeAllowed)
      out.push({
        field: 'commitment.method',
        code: m.method ? 'METHOD_NOT_ALLOWED' : 'METHOD_REQUIRED',
      });
    return out;
  }
  if (!policy.allowedMethods.includes(method))
    out.push({ field: 'commitment.method', code: 'METHOD_NOT_ALLOWED' });
  if (m.amountMinor === null || m.amountMinor < 1)
    out.push({ field: 'commitment.amountMinor', code: 'REQUIRED' });
  else if (
    (method === 'DEPOSIT' &&
      (m.amountMinor < policy.depositMinMinor || m.amountMinor > policy.depositMaxMinor)) ||
    (method === 'CARD_PREAUTH' && m.amountMinor > policy.preauthMaxMinor)
  )
    out.push({ field: 'commitment.amountMinor', code: 'AMOUNT_OUT_OF_RANGE' });
  if (method === 'DEPOSIT') {
    if (m.depositRefundable === null)
      out.push({ field: 'commitment.depositRefundable', code: 'REQUIRED' });
    else if (!m.depositRefundable && !policy.nonRefundableDepositAllowed)
      out.push({ field: 'commitment.depositRefundable', code: 'NOT_ALLOWED' });
  }
  if (m.cancelCutoffMinutes === null)
    out.push({ field: 'commitment.cancelCutoffMinutes', code: 'REQUIRED' });
  else if (
    m.cancelCutoffMinutes < policy.cutoffMinMinutes ||
    m.cancelCutoffMinutes > policy.cutoffMaxMinutes ||
    (c.holdMinutes !== null && m.cancelCutoffMinutes > c.holdMinutes)
  )
    out.push({ field: 'commitment.cancelCutoffMinutes', code: 'CUTOFF_OUT_OF_RANGE' });
  if (
    method === 'FULL_PREPAYMENT' &&
    m.noShowRefundPercent !== null &&
    (m.noShowRefundPercent < policy.prepaymentRefundMinPercent ||
      m.noShowRefundPercent > policy.prepaymentRefundMaxPercent)
  )
    out.push({ field: 'commitment.noShowRefundPercent', code: 'REFUND_PERCENT_OUT_OF_RANGE' });
  // CARD_PREAUTH: releasing part of the hold on a late cancellation / no-show means a PARTIAL capture (policy must allow it)
  if (
    method === 'CARD_PREAUTH' &&
    m.noShowRefundPercent !== null &&
    m.noShowRefundPercent > 0 &&
    !policy.preauthPartialCaptureAllowed
  )
    out.push({ field: 'commitment.noShowRefundPercent', code: 'NOT_ALLOWED' });
  return out;
}

/** Whether the deal needs stock (quantity limit and/or reservations). */
export const needsInventory = (c: Pick<HotDealContent, 'limitType' | 'reservationsEnabled'>) =>
  c.reservationsEnabled || c.limitType !== 'TIME';
export const needsEnd = (c: Pick<HotDealContent, 'limitType'>) => c.limitType !== 'QUANTITY';

export function hotDealIssues(
  c: HotDealContent,
  opts: { now?: Date; limits?: HotDealLimits } = {},
): HotDealIssue[] {
  const limits = opts.limits ?? DEFAULT_HOT_LIMITS;
  const out: HotDealIssue[] = [];
  const bilingual = (field: string, v: { en: string; ar: string }) => {
    if (!v.en.trim()) out.push({ field, code: 'REQUIRED_EN' });
    if (!v.ar.trim()) out.push({ field, code: 'REQUIRED_AR' });
  };
  if (!c.categoryId) out.push({ field: 'categoryId', code: 'REQUIRED' });
  if (!c.mechanic) out.push({ field: 'mechanic', code: 'REQUIRED' });
  if (c.mechanic === 'PERCENTAGE_OFF') {
    if (c.valueNumber === null) out.push({ field: 'valueNumber', code: 'REQUIRED' });
    else if (c.valueNumber < 1 || c.valueNumber > 100)
      out.push({ field: 'valueNumber', code: 'VALUE_RANGE' });
  }
  if (c.mechanic === 'AMOUNT_OFF') {
    if (c.valueNumber === null) out.push({ field: 'valueNumber', code: 'REQUIRED' });
    else if (c.valueNumber <= 0) out.push({ field: 'valueNumber', code: 'VALUE_RANGE' });
  }
  bilingual('offerLabel', c.offerLabel);
  bilingual('title', c.title);
  bilingual('shortDescription', c.shortDescription);
  bilingual('description', c.description);
  if (c.media.length < 1) out.push({ field: 'media', code: 'REQUIRED' });
  if (c.allocations.length < 1) out.push({ field: 'allocations', code: 'REQUIRED' });
  if (!c.startAt) out.push({ field: 'startAt', code: 'REQUIRED' });

  // HD-01: at least one limit. Reservations need stock to hold, so they need a quantity limit (HD-10, HD-11).
  if (c.reservationsEnabled && c.limitType === 'TIME')
    out.push({ field: 'limitType', code: 'TYPE_MISMATCH' });
  if (!c.reservationsEnabled && c.limitType !== 'TIME')
    out.push({ field: 'limitType', code: 'TYPE_MISMATCH' }); // walk-in deals are time-limited only (HD-14)

  if (needsInventory(c)) {
    if (!c.allocations.some((a) => a.units >= 1))
      out.push({ field: 'allocations', code: 'UNITS_REQUIRED' });
    if (c.allocations.some((a) => a.units > limits.maxUnitsPerBranch))
      out.push({ field: 'allocations', code: 'UNITS_TOO_HIGH' });
  }
  if (needsEnd(c)) {
    if (!c.endAt) out.push({ field: 'endAt', code: 'REQUIRED' });
  }
  if (c.startAt && c.endAt) {
    const start = new Date(c.startAt).getTime();
    const end = new Date(c.endAt).getTime();
    if (end <= start) out.push({ field: 'endAt', code: 'END_BEFORE_START' });
    else if (end - start > limits.maxHours * 3_600_000)
      out.push({ field: 'endAt', code: 'DURATION_TOO_LONG' });
  }
  if (c.endAt && opts.now && new Date(c.endAt).getTime() <= opts.now.getTime())
    out.push({ field: 'endAt', code: 'IN_PAST' });
  if (c.reservationsEnabled) {
    if (c.perCustomerLimit > limits.maxPerCustomer)
      out.push({ field: 'perCustomerLimit', code: 'LIMIT_TOO_HIGH' });
    if (
      c.holdMinutes !== null &&
      (c.holdMinutes < limits.holdMinMinutes || c.holdMinutes > limits.holdMaxMinutes)
    )
      out.push({ field: 'holdMinutes', code: 'HOLD_OUT_OF_RANGE' });
  }
  if (!c.terms.textEn.trim()) out.push({ field: 'terms.textEn', code: 'REQUIRED_EN' });
  if (!c.terms.textAr.trim()) out.push({ field: 'terms.textAr', code: 'REQUIRED_AR' });
  if (
    c.eligibility.kind === 'COMPOSITE'
      ? !c.eligibility.expression
      : c.eligibility.kind !== 'PUBLIC' && c.eligibility.valueRefs.length < 1
  )
    out.push({ field: 'eligibility', code: 'REQUIRED' });
  return out;
}

export function hotTranslationStatus(c: HotDealContent) {
  const missing = new Set<'en' | 'ar'>();
  for (const i of hotDealIssues(c)) {
    if (i.code === 'REQUIRED_EN') missing.add('en');
    if (i.code === 'REQUIRED_AR') missing.add('ar');
  }
  return { complete: missing.size === 0, missing: [...missing] };
}

/**
 * A live Exclusive Deal can only receive MINOR edits (wording corrections, photos and alt text). Anything that changes what the
 * customer receives is material and is refused (cancel and relaunch, or ask DealDash): see docs/STAGE4.md. Stock is changed
 * through the dedicated stock endpoint, so allocation units are ignored here.
 */
export function hotMaterialChanges(before: HotDealContent, after: HotDealContent): string[] {
  const m: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const t = (field: 'offerLabel' | 'title' | 'shortDescription' | 'description') => {
    for (const lang of ['en', 'ar'] as const)
      if (before[field][lang] !== after[field][lang]) {
        const minor =
          field === 'offerLabel'
            ? before[field][lang].trim().toLowerCase() === after[field][lang].trim().toLowerCase()
            : isMinorTextEdit(before[field][lang], after[field][lang]);
        if (!minor && !m.includes(field)) m.push(field);
      }
  };
  t('offerLabel');
  t('title');
  t('shortDescription');
  t('description');
  if (before.categoryId !== after.categoryId) m.push('categoryId');
  if (before.mechanic !== after.mechanic) m.push('mechanic');
  if (before.valueNumber !== after.valueNumber) m.push('valueNumber');
  if (before.limitType !== after.limitType) m.push('limitType');
  if (before.reservationsEnabled !== after.reservationsEnabled) m.push('reservationsEnabled');
  if (
    !same(
      [...before.allocations.map((a) => a.branchId)].sort(),
      [...after.allocations.map((a) => a.branchId)].sort(),
    )
  )
    m.push('branches');
  if (before.perCustomerLimit !== after.perCustomerLimit) m.push('perCustomerLimit');
  if (before.holdMinutes !== after.holdMinutes) m.push('holdMinutes');
  // what a customer pays, may get back or forfeits is material (RC-20)
  if (
    commitmentMethodOf(before) !== commitmentMethodOf(after) ||
    !same(before.commitment, after.commitment)
  )
    m.push('commitment');
  const inst = (v: string | null) => (v ? new Date(v).getTime() : null);
  if (inst(before.startAt) !== inst(after.startAt)) m.push('startAt');
  if (inst(before.endAt) !== inst(after.endAt)) m.push('endAt');
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
export const hotDealCreateSchema = z.object({
  content: hotDealContentSchema.default(() => hotDealContentSchema.parse({})),
});
export const hotDealSaveSchema = z.object({
  content: hotDealContentSchema,
  expectedVersion: z.number().int().min(0).optional(),
});
export const hotDealListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(HOT_DEAL_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});
export const hotDealStockSchema = z.object({
  branchId: uuid,
  /** Positive adds stock; negative removes stock that is still available (never below reserved + redeemed). */
  delta: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, 'delta must not be zero'),
  reason: z.string().trim().max(300).optional(),
});
export const reservationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
  branchId: uuid.optional(),
  q: z.string().trim().max(20).optional(),
});
export const cancelReservationSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});
export const customerCancelSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);
export const hotDiscoveryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(300).optional(),
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(41).optional(),
  city: z.string().trim().max(40).optional(),
  lat: lat.optional(),
  lng: lng.optional(),
  radiusMeters: z.coerce.number().int().min(100).max(100_000).optional(),
  sort: z.enum(['ending_soon', 'nearest', 'newest']).optional(),
  eligibility: z.enum(['all', 'unlocked']).default('all'),
});
export const reservationCreateSchema = z.object({
  branchId: uuid,
  quantity: z.number().int().min(1).max(100).default(1),
});
export const reservationListQuerySchema = z.object({
  tab: z.enum(['active', 'past']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const staffCodeSchema = z.object({
  /** QR text (DD1.<token>) or the manual code typed by staff. */
  code: z.string().trim().min(4).max(80),
  source: z.enum(['QR', 'MANUAL']).default('MANUAL'),
});
export const staffHistoryQuerySchema = z.object({
  filter: z.enum(['all', 'redeemed', 'rejected']).default('all'),
  day: z.enum(['today', 'yesterday']).default('today'),
  q: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const reverseRedemptionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export const restrictionLiftSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

// ------------------------------------------------------------------ responses
export const stockViewSchema = z.object({
  total: z.number().int(),
  available: z.number().int(),
  reserved: z.number().int(),
  redeemed: z.number().int(),
});

export const hotDealCardSchema = z.object({
  id: uuid,
  merchantId: uuid,
  merchantName: biText,
  merchantLogoUrl: z.string().nullable(),
  title: biText,
  offerLabel: biText,
  shortDescription: biText,
  category: z.object({ code: z.string(), name: biText }).nullable(),
  imageUrl: z.string().nullable(),
  imageAlt: biText,
  limitType: z.enum(HOT_DEAL_LIMIT_TYPES),
  reservationsEnabled: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  /** Units left at the nearest branch (null when stock is not shown: walk-in deals or above the display threshold). */
  remaining: z.number().int().nullable(),
  remainingTotal: z.number().int().nullable(),
  soldOut: z.boolean(),
  distanceMeters: z.number().nullable(),
  nearestBranch: z
    .object({ id: uuid, name: biText, area: biText, latitude: z.number(), longitude: z.number() })
    .nullable(),
  branchCount: z.number().int(),
  eligibility: eligibilityViewSchema,
  availability: z.enum(['AVAILABLE', 'SOLD_OUT', 'ENDED', 'PAUSED', 'UNAVAILABLE', 'SCHEDULED']),
  /** Server clock so countdowns are right even when the phone clock is wrong. */
  serverNow: z.string(),
});
export type HotDealCard = z.infer<typeof hotDealCardSchema>;

export const hotBranchViewSchema = publicBranchSchema.extend({
  stock: z.object({ available: z.number().int(), total: z.number().int() }).nullable(),
  canReserve: z.boolean(),
  /** Why the branch cannot be reserved (neutral wording keys): SOLD_OUT, BRANCH_CLOSED. */
  blockedReason: z.enum(['SOLD_OUT', 'BRANCH_CLOSED']).nullable(),
});

export const myReservationBriefSchema = z.object({
  id: uuid,
  status: z.enum(RESERVATION_STATUSES),
  quantity: z.number().int(),
  branchId: uuid,
  expiresAt: z.string(),
});

export type MyReservationBrief = z.infer<typeof myReservationBriefSchema>;

export const hotDealDetailSchema = hotDealCardSchema.extend({
  description: biText,
  terms: z.object({ blocks: dealTermsBlocksSchema, text: biText }),
  media: z.array(z.object({ url: z.string(), alt: biText })),
  branches: z.array(hotBranchViewSchema),
  holdMinutes: z.number().int(),
  perCustomerLimit: z.number().int(),
  /** Units this customer may still reserve (limit minus held and redeemed). */
  remainingForMe: z.number().int().nullable(),
  myReservations: z.array(myReservationBriefSchema),
  restriction: z.object({ endsAt: z.string() }).nullable(),
});
export type HotDealDetail = z.infer<typeof hotDealDetailSchema>;

/** Card hold of a CARD_PREAUTH reservation (phase 3): nothing is charged unless something is captured. */
export const reservationHoldViewSchema = z.object({
  status: z.enum(RESERVATION_AUTH_STATUSES),
  amountMinor: z.number().int(),
  capturedMinor: z.number().int(),
  releasedMinor: z.number().int(),
  authorisedAt: z.string().nullable(),
  /** When the provider's authorisation lapses. */
  expiresAt: z.string().nullable(),
  capturedAt: z.string().nullable(),
  releasedAt: z.string().nullable(),
});

export const reservationPaymentViewSchema = z.object({
  method: z.enum(PAID_COMMITMENT_METHODS),
  status: z.enum(RESERVATION_PAYMENT_STATUSES),
  /** All units, minor units of `currency`. */
  amountMinor: z.number().int(),
  currency: z.string(),
  /** While waiting for payment: when the units are released if it is not completed. */
  dueAt: z.string().nullable(),
  /** The provider's payment page for the open attempt. */
  redirectUrl: z.string().nullable(),
  canRetry: z.boolean(),
  /** CARD_PREAUTH only: the hold on the customer's card (null for prepayment / deposit). */
  authorisation: reservationHoldViewSchema.nullable(),
  /** After this moment a customer cancellation no longer returns the refundable amounts (RC-40 / RC-41). */
  cancelCutoffAt: z.string().nullable(),
  depositRefundable: z.boolean().nullable(),
  noShowRefundPercent: z.number().int().nullable(),
  /** Amount kept for the merchant under the terms (redeemed, forfeited or the kept part). */
  keptMinor: z.number().int().nullable(),
  refunds: z.array(
    z.object({
      reference: z.string(),
      amountMinor: z.number().int(),
      status: z.enum(REFUND_STATUSES),
      reasonCode: z.string(),
      refundedAt: z.string().nullable(),
    }),
  ),
});

export const reservationViewSchema = z.object({
  id: uuid,
  publicRef: z.string(),
  status: z.enum(RESERVATION_STATUSES),
  /**
   * Customer-facing state with neutral wording: HELD, REDEEMED, NOT_COMPLETED, CANCELLED_BY_YOU, CANCELLED_BY_MERCHANT; paid
   * reservations add PAYMENT_PENDING (waiting for the payment, no code yet) and PAYMENT_FAILED (not paid in time; nothing charged).
   */
  displayState: z.enum([
    'HELD',
    'REDEEMED',
    'NOT_COMPLETED',
    'CANCELLED_BY_YOU',
    'CANCELLED_BY_MERCHANT',
    'PAYMENT_PENDING',
    'PAYMENT_FAILED',
  ]),
  /** Paid reservations only (RC-81): what was paid, the terms that apply, and refunds. Absent for FREE reservations. */
  payment: reservationPaymentViewSchema.optional(),
  quantity: z.number().int(),
  holdMinutes: z.number().int(),
  createdAt: z.string(),
  expiresAt: z.string(),
  redeemedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledBy: z.enum(CANCELLED_BY).nullable(),
  serverNow: z.string(),
  canCancel: z.boolean(),
  deal: z.object({
    id: uuid,
    title: biText,
    offerLabel: biText,
    imageUrl: z.string().nullable(),
    merchantName: biText,
    merchantId: uuid,
  }),
  branch: z.object({
    id: uuid,
    name: biText,
    address: biText,
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    phone: z.string().nullable(),
  }),
  /** Present only while the reservation can be redeemed. The QR text is an opaque token, never a database id. */
  code: z.object({ qr: z.string(), manual: z.string() }).nullable(),
});
export type ReservationView = z.infer<typeof reservationViewSchema>;

export const reservationResultSchema = z.object({ reservation: reservationViewSchema });

export const restrictionViewSchema = z.object({
  id: uuid,
  status: z.enum(['ACTIVE', 'LIFTED', 'ENDED']),
  startsAt: z.string(),
  endsAt: z.string(),
  reason: z.string(),
});

export const notificationViewSchema = z.object({
  id: uuid,
  type: z.enum(NOTIFICATION_TYPES),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  readAt: z.string().nullable(),
});

// ---- merchant / admin views
export const hotDealInventoryRowSchema = z.object({
  branchId: uuid,
  branchName: biText,
  branchStatus: z.string(),
  tracked: z.boolean(),
  stock: stockViewSchema,
  released: z.number().int(),
});

export const hotDealViewSchema = z.object({
  id: uuid,
  organizationId: uuid,
  status: z.enum(HOT_DEAL_STATUSES),
  version: z.number().int(),
  content: hotDealContentSchema,
  media: z.array(dealMediaViewSchema),
  inventory: z.array(hotDealInventoryRowSchema),
  category: dealCategoryViewSchema.nullable(),
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
      action: z.enum(HOT_DEAL_ACTIONS),
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
export type HotDealView = z.infer<typeof hotDealViewSchema>;

export const hotDealRowSchema = z.object({
  id: uuid,
  status: z.enum(HOT_DEAL_STATUSES),
  title: biText,
  offerLabel: biText,
  limitType: z.enum(HOT_DEAL_LIMIT_TYPES),
  branchCount: z.number().int(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  imageUrl: z.string().nullable(),
  availableUnits: z.number().int(),
  totalUnits: z.number().int(),
  reservedUnits: z.number().int(),
  redeemedUnits: z.number().int(),
  updatedAt: z.string(),
});

export const hotDealSaveResultSchema = z.object({
  deal: hotDealViewSchema,
  outcome: z.enum(['SAVED', 'APPLIED_MINOR']),
});
export const hotDealSubmitResultSchema = z.object({
  deal: hotDealViewSchema,
  outcome: z.enum(['SENT_FOR_REVIEW', 'PUBLISHED', 'SCHEDULED']),
});

export const merchantReservationRowSchema = z.object({
  id: uuid,
  codeLast4: z.string(),
  customerFirstName: z.string().nullable(),
  quantity: z.number().int(),
  branch: biText,
  status: z.enum(RESERVATION_STATUSES),
  cancelledBy: z.enum(CANCELLED_BY).nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  redeemedAt: z.string().nullable(),
  canCancel: z.boolean(),
  canReverse: z.boolean(),
  /** RC-80: the merchant's financial view of a paid reservation (absent for FREE reservations). */
  money: z
    .object({
      method: z.enum(COMMITMENT_METHODS),
      paymentStatus: z.enum(RESERVATION_PAYMENT_STATUSES),
      amountMinor: z.number().int(),
      currency: z.string(),
      refundedMinor: z.number().int(),
      refundPendingMinor: z.number().int(),
      keptMinor: z.number().int().nullable(),
      feeMinor: z.number().int().nullable(),
      netToMerchantMinor: z.number().int().nullable(),
      /** RC-74: the merchant's agreement explicitly allows the per-redemption fee in addition to the reservation commission. */
      additionalFeeAllowed: z.boolean(),
      /** The per-redemption fee charged at redemption (0 = not charged: the reservation commission was the only fee; null = not redeemed). */
      redemptionFeeMinor: z.number().int().nullable(),
      /** Phase 3: the card hold of a CARD_PREAUTH reservation (null otherwise). */
      authorisation: reservationHoldViewSchema.nullable(),
    })
    .optional(),
});

export const hotMonitorSchema = z.object({
  status: z.enum(HOT_DEAL_STATUSES),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  serverNow: z.string(),
  totals: stockViewSchema,
  inventory: z.array(hotDealInventoryRowSchema),
  reservations: z.object({
    held: z.number().int(),
    redeemed: z.number().int(),
    expired: z.number().int(),
    cancelled: z.number().int(),
    expiringSoon: z.number().int(),
  }),
  /** Measurable steps only: no sales, no revenue. */
  funnel: z.object({
    impressions: z.number().int(),
    detailViews: z.number().int(),
    reservationsCreated: z.number().int(),
    reservationsCancelled: z.number().int(),
    reservationsExpired: z.number().int(),
    redeemed: z.number().int(),
    notCompleted: z.number().int(),
    viewToReservationPct: z.number().nullable(),
    reservationToRedeemedPct: z.number().nullable(),
  }),
  disclaimerKey: z.literal('discovery_and_reservation_signals_only'),
});
export type HotMonitor = z.infer<typeof hotMonitorSchema>;

export const adminHotRowSchema = z.object({
  id: uuid,
  status: z.enum(HOT_DEAL_STATUSES),
  title: biText,
  limitType: z.enum(HOT_DEAL_LIMIT_TYPES),
  merchant: z.object({ id: uuid, nameEn: z.string(), nameAr: z.string(), trustLevel: z.string() }),
  branchCount: z.number().int(),
  totalUnits: z.number().int(),
  submittedAt: z.string().nullable(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
});

export const adminHotDetailSchema = hotDealViewSchema.extend({
  merchant: z.object({
    id: uuid,
    nameEn: z.string(),
    nameAr: z.string(),
    status: z.string(),
    trustLevel: z.string(),
    riskTier: z.string(),
  }),
  history: z.array(
    z.object({
      id: uuid,
      action: z.enum(HOT_DEAL_ACTIONS),
      fromStatus: z.enum(HOT_DEAL_STATUSES).nullable(),
      toStatus: z.enum(HOT_DEAL_STATUSES).nullable(),
      reason: z.string().nullable(),
      reasonAr: z.string().nullable(),
      fields: z.array(z.string()),
      actorRole: z.string().nullable(),
      actorName: z.string().nullable(),
      byDealDash: z.boolean(),
      createdAt: z.string(),
    }),
  ),
  preview: hotDealDetailSchema,
  reviewTarget: z.enum(['NONE', 'DEAL']),
  adminActions: z.array(z.string()),
  reservationRules: z.object({
    reservationsEnabled: z.boolean(),
    perCustomerLimit: z.number().int(),
    holdMinutes: z.number().int(),
    maxActivePerCustomer: z.number().int(),
    noShowThreshold: z.number().int(),
    noShowBlockDays: z.number().int(),
  }),
});
export type AdminHotDetail = z.infer<typeof adminHotDetailSchema>;

export const adminRestrictionRowSchema = restrictionViewSchema.extend({
  customer: z.object({
    userId: uuid,
    displayName: z.string(),
    mobileMasked: z.string().nullable(),
  }),
  strikes: z.number().int(),
  liftedReason: z.string().nullable(),
});

// ---- Staff
export const staffReservationSummarySchema = z.object({
  /** What is being redeemed: a free Exclusive Deal reservation or a purchased voucher (Stage 5). */
  kind: z.enum(['RESERVATION', 'VOUCHER']).default('RESERVATION'),
  /** Vouchers only: the value staff honour at the counter (integer halalas). */
  faceValueHalalas: z.number().int().nullable().default(null),
  ref: z.string(),
  quantity: z.number().int(),
  dealTitle: biText,
  offerLabel: biText,
  merchantName: biText,
  branchName: biText,
  customerFirstName: z.string().nullable(),
  expiresAt: z.string().nullable(),
  startsAt: z.string().nullable(),
  redeemedAt: z.string().nullable(),
  redeemedBranchName: biText.nullable(),
  /** For WRONG_BRANCH: where the reservation works (own merchant only). */
  validBranchName: biText.nullable(),
  /** For INELIGIBLE: what is needed, without any personal data. */
  requirement: biText.nullable(),
});

export const staffValidationSchema = z.object({
  result: z.enum(REDEMPTION_RESULTS),
  reservation: staffReservationSummarySchema.nullable(),
  serverNow: z.string(),
});
export const staffRedeemSchema = z.object({
  result: z.enum(REDEMPTION_RESULTS),
  reference: z.string().nullable(),
  redeemedAt: z.string().nullable(),
  reservation: staffReservationSummarySchema.nullable(),
  serverNow: z.string(),
});
export const staffMeSchema = z.object({
  displayName: z.string(),
  merchantName: biText,
  branch: biText.nullable(),
  branches: z.array(z.object({ membershipId: uuid, branchId: uuid.nullable(), name: biText })),
  canRedeem: z.boolean(),
  historyDays: z.number().int(),
});
export const staffHistoryRowSchema = z.object({
  id: uuid,
  result: z.enum(REDEMPTION_RESULTS),
  at: z.string(),
  reference: z.string().nullable(),
  dealTitle: biText.nullable(),
  quantity: z.number().int().nullable(),
  customerFirstName: z.string().nullable(),
  source: z.enum(['QR', 'MANUAL']),
  kind: z.enum(['RESERVATION', 'VOUCHER']).default('RESERVATION'),
});
export const staffHistorySchema = z.object({
  counts: z.object({ redeemed: z.number().int(), rejected: z.number().int() }),
  items: z.array(staffHistoryRowSchema),
});

export const hotDealMonitorKeepAlive = ELIGIBILITY_KINDS;

export type StaffReservationSummary = z.infer<typeof staffReservationSummarySchema>;
export type StaffValidation = z.infer<typeof staffValidationSchema>;
export type StaffRedeem = z.infer<typeof staffRedeemSchema>;
export type HotDealRow = z.infer<typeof hotDealRowSchema>;
export type AdminHotRow = z.infer<typeof adminHotRowSchema>;
export type HotDealCardList = z.infer<typeof hotDealCardSchema>[];
export type StaffMe = z.infer<typeof staffMeSchema>;
