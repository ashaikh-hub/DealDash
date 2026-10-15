import { z } from 'zod';

/**
 * Reservation commitment policy (founder decision 2026-10-15, RC-10..RC-12). One governed configuration (`reservation.policy`) holds the
 * platform baseline and three override maps. The effective policy for a deal is resolved FIELD BY FIELD:
 * merchant override > category override > market default > platform baseline. Amounts are minor units of the market currency.
 * Hold length bounds and no-show strike values keep their own governed keys (`reservation.hold_limits`, `reservation.noshow`).
 * Every value below is a MOCK default for development; real values are set per market by DealDash Admin (VK-02 / VALIDATE-PAKISTAN).
 */
export const POLICY_PAID_METHODS = ['FULL_PREPAYMENT', 'DEPOSIT', 'CARD_PREAUTH'] as const;
export type PolicyPaidMethod = (typeof POLICY_PAID_METHODS)[number];

const minor = z.number().int().min(0).max(100_000_000);
const percent = z.number().int().min(0).max(100);
const minutes = z.number().int().min(0).max(1440);

const policyFieldShape = {
  /**
   * Whether FREE reservations are allowed. null = the environment default (allowed on local / development / test machines only).
   * Honoured only on those machines or in a market whose status is TESTING (RC-05): a live market never offers free reservations.
   */
  freeAllowed: z.boolean().nullable(),
  /** Paid methods merchants may choose. A market without a card-hold provider must not list CARD_PREAUTH (RC-90). */
  allowedMethods: z.array(z.enum(POLICY_PAID_METHODS)).max(3),
  depositMinMinor: minor,
  depositMaxMinor: minor,
  /** Whether a merchant may make the deposit non-refundable (it is then kept even when the customer cancels in time, RC-40). */
  nonRefundableDepositAllowed: z.boolean(),
  /** Largest card hold per unit (CARD_PREAUTH). */
  preauthMaxMinor: minor,
  /** Range for the merchant's cancellation cut-off, in minutes before the hold ends (RC-20). */
  cutoffMinMinutes: minutes,
  cutoffMaxMinutes: minutes,
  /** Minutes a customer has to complete payment before the units are released (RC-31). */
  paymentWindowMinutes: z.number().int().min(1).max(120),
  /** FULL_PREPAYMENT: share refunded on a late cancellation or no-show — range the merchant may choose from, and the default (RC-41/51). */
  prepaymentRefundMinPercent: percent,
  prepaymentRefundMaxPercent: percent,
  prepaymentRefundDefaultPercent: percent,
  /**
   * RC-71: DealDash's agreed commission on reservation money kept for the merchant (redeemed, forfeited, kept part), in basis points.
   * A merchant override is that merchant's agreed rate. Default 0: DealDash keeps nothing unless a rate is agreed.
   */
  commissionBps: z.number().int().min(0).max(10_000),
};

export const reservationPolicyFieldsSchema = z.object(policyFieldShape).strict();
export type ReservationPolicyFields = z.infer<typeof reservationPolicyFieldsSchema>;
/** An override names only the fields it changes; the rest are inherited. */
export const reservationPolicyOverrideSchema = z.object(policyFieldShape).partial().strict();
export type ReservationPolicyOverride = z.infer<typeof reservationPolicyOverrideSchema>;

/** Range checks that apply to a complete (resolved) policy. Returns the offending field names. */
export function reservationPolicyProblems(p: ReservationPolicyFields): string[] {
  const out: string[] = [];
  if (p.depositMinMinor > p.depositMaxMinor) out.push('depositMinMinor');
  if (p.cutoffMinMinutes > p.cutoffMaxMinutes) out.push('cutoffMinMinutes');
  if (p.prepaymentRefundMinPercent > p.prepaymentRefundMaxPercent)
    out.push('prepaymentRefundMinPercent');
  if (
    p.prepaymentRefundDefaultPercent < p.prepaymentRefundMinPercent ||
    p.prepaymentRefundDefaultPercent > p.prepaymentRefundMaxPercent
  )
    out.push('prepaymentRefundDefaultPercent');
  if (new Set(p.allowedMethods).size !== p.allowedMethods.length) out.push('allowedMethods');
  return out;
}

const marketCode = z.string().regex(/^[A-Z]{2}$/, 'a two-letter market code');
const uuid = z.string().uuid();

export const reservationPolicySchema = z
  .object({
    // a baseline stored before the commission field existed reads as 0 (overrides never get a default: they inherit)
    baseline: reservationPolicyFieldsSchema.extend({
      commissionBps: z.number().int().min(0).max(10_000).default(0),
    }),
    market: z.record(marketCode, reservationPolicyOverrideSchema).default({}),
    category: z.record(uuid, reservationPolicyOverrideSchema).default({}),
    merchant: z.record(uuid, reservationPolicyOverrideSchema).default({}),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const f of reservationPolicyProblems(v.baseline))
      ctx.addIssue({ code: 'custom', path: ['baseline', f], message: 'out of range' });
  });
export type ReservationPolicyConfig = z.infer<typeof reservationPolicySchema>;

export const DEFAULT_RESERVATION_POLICY: ReservationPolicyConfig = {
  baseline: {
    freeAllowed: null,
    allowedMethods: ['FULL_PREPAYMENT', 'DEPOSIT', 'CARD_PREAUTH'],
    depositMinMinor: 100,
    depositMaxMinor: 50_000,
    nonRefundableDepositAllowed: true,
    preauthMaxMinor: 100_000,
    cutoffMinMinutes: 0,
    cutoffMaxMinutes: 120,
    paymentWindowMinutes: 10,
    prepaymentRefundMinPercent: 0,
    prepaymentRefundMaxPercent: 100,
    prepaymentRefundDefaultPercent: 50,
    commissionBps: 0,
  },
  market: {},
  category: {},
  merchant: {},
};

export type PolicyLevel = 'MERCHANT' | 'CATEGORY' | 'MARKET' | 'BASELINE';

export interface ResolvedReservationPolicy {
  fields: ReservationPolicyFields;
  /** Which level each field came from (shown to DealDash Admin and kept in the snapshot). */
  source: Record<keyof ReservationPolicyFields, PolicyLevel>;
  /** Range problems of the resolved combination (an override can break a range that each level kept on its own). */
  problems: string[];
}

/** RC-11: merchant override > category override > market default > baseline, field by field. */
export function resolveReservationPolicy(
  config: ReservationPolicyConfig,
  scope: { market: string; categoryId?: string | null; organizationId?: string | null },
): ResolvedReservationPolicy {
  const layers: Array<[PolicyLevel, ReservationPolicyOverride | undefined]> = [
    ['MERCHANT', scope.organizationId ? config.merchant[scope.organizationId] : undefined],
    ['CATEGORY', scope.categoryId ? config.category[scope.categoryId] : undefined],
    ['MARKET', config.market[scope.market.toUpperCase()]],
  ];
  const fields = { ...config.baseline } as Record<string, unknown>;
  const source = {} as Record<string, PolicyLevel>;
  for (const key of Object.keys(policyFieldShape) as Array<keyof ReservationPolicyFields>) {
    source[key] = 'BASELINE';
    for (const [level, layer] of layers)
      if (layer && layer[key] !== undefined) {
        fields[key] = layer[key];
        source[key] = level;
        break;
      }
  }
  const resolved = fields as unknown as ReservationPolicyFields;
  return {
    fields: resolved,
    source: source as ResolvedReservationPolicy['source'],
    problems: reservationPolicyProblems(resolved),
  };
}

/**
 * RC-05: is a FREE reservation allowed? Only when the policy allows it (null = allowed on local / development / test machines) AND the
 * machine is local / development / test or the market is in TESTING status. Staging and production never allow it for a live market.
 */
export function freeReservationAllowed(
  freeAllowed: boolean | null,
  ctx: { tier: string; marketStatus: string | null },
): boolean {
  const devTier = ctx.tier === 'local' || ctx.tier === 'development' || ctx.tier === 'test';
  const allowed = freeAllowed ?? devTier;
  return allowed && (devTier || ctx.marketStatus === 'TESTING');
}
