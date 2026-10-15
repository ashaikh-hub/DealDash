import { describe, expect, it } from 'vitest';
import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  DEFAULT_RESERVATION_POLICY,
  freeReservationAllowed,
  reservationPolicySchema,
  resolveReservationPolicy,
  type ReservationPolicyConfig,
} from './index';

const CAT = '00000000-0000-4000-8000-0000000000c1';
const ORG = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000a2';

const policy = (patch: Partial<ReservationPolicyConfig> = {}): ReservationPolicyConfig =>
  reservationPolicySchema.parse({ ...DEFAULT_RESERVATION_POLICY, ...patch });

/** Reservation commitment model (founder decision 2026-10-15): RC-05, RC-10..RC-12. */
describe('reservation policy', () => {
  it('is a governed configuration with a valid default (free reservation decided by the environment)', () => {
    expect(CONFIG_KEYS.RESERVATION_POLICY).toBe('reservation.policy');
    expect(reservationPolicySchema.safeParse(CONFIG_DEFAULTS['reservation.policy']).success).toBe(
      true,
    );
    expect(DEFAULT_RESERVATION_POLICY.baseline.freeAllowed).toBeNull();
    // never 100 % kept automatically on a prepayment no-show (decision 4)
    expect(DEFAULT_RESERVATION_POLICY.baseline.prepaymentRefundDefaultPercent).toBeGreaterThan(0);
  });

  it('resolves merchant override > category override > market default > baseline, field by field', () => {
    const p = policy({
      market: { PK: { depositMaxMinor: 30_000, cutoffMaxMinutes: 60, paymentWindowMinutes: 15 } },
      category: { [CAT]: { depositMaxMinor: 20_000, cutoffMaxMinutes: 45 } },
      merchant: { [ORG]: { depositMaxMinor: 10_000 } },
    });
    const r = resolveReservationPolicy(p, { market: 'pk', categoryId: CAT, organizationId: ORG });
    expect(r.fields.depositMaxMinor).toBe(10_000);
    expect(r.source.depositMaxMinor).toBe('MERCHANT');
    expect(r.fields.cutoffMaxMinutes).toBe(45);
    expect(r.source.cutoffMaxMinutes).toBe('CATEGORY');
    expect(r.fields.paymentWindowMinutes).toBe(15);
    expect(r.source.paymentWindowMinutes).toBe('MARKET');
    expect(r.fields.preauthMaxMinor).toBe(DEFAULT_RESERVATION_POLICY.baseline.preauthMaxMinor);
    expect(r.source.preauthMaxMinor).toBe('BASELINE');
    expect(r.problems).toEqual([]);

    // another business in the same category gets the category value; another market gets only the baseline
    const other = resolveReservationPolicy(p, {
      market: 'PK',
      categoryId: CAT,
      organizationId: OTHER_ORG,
    });
    expect(other.fields.depositMaxMinor).toBe(20_000);
    const sa = resolveReservationPolicy(p, { market: 'SA', organizationId: OTHER_ORG });
    expect(sa.fields.depositMaxMinor).toBe(DEFAULT_RESERVATION_POLICY.baseline.depositMaxMinor);
    expect(Object.values(sa.source).every((s) => s === 'BASELINE')).toBe(true);
  });

  it('reports a range broken only by the combination of levels', () => {
    const p = policy({ merchant: { [ORG]: { depositMinMinor: 90_000 } } });
    const r = resolveReservationPolicy(p, { market: 'SA', organizationId: ORG });
    expect(r.problems).toContain('depositMinMinor');
  });

  it('refuses invalid stored values: ranges, unknown fields, unknown methods, bad keys', () => {
    const bad = (v: unknown) => reservationPolicySchema.safeParse(v).success;
    const base = DEFAULT_RESERVATION_POLICY;
    expect(bad({ ...base, baseline: { ...base.baseline, cutoffMinMinutes: 200 } })).toBe(false);
    expect(
      bad({ ...base, baseline: { ...base.baseline, prepaymentRefundDefaultPercent: 101 } }),
    ).toBe(false);
    expect(bad({ ...base, baseline: { ...base.baseline, prepaymentRefundMaxPercent: 10 } })).toBe(
      false,
    );
    expect(bad({ ...base, market: { PK: { allowedMethods: ['CASH'] } } })).toBe(false);
    expect(bad({ ...base, market: { PK: { surprise: true } } })).toBe(false);
    expect(bad({ ...base, market: { Pakistan: {} } })).toBe(false);
    expect(bad({ ...base, merchant: { 'not-a-uuid': {} } })).toBe(false);
    expect(bad({ ...base, market: { PK: { freeAllowed: true } } })).toBe(true);
  });

  it('RC-05: free reservation only on development / test machines or in a TESTING market, never in a live market', () => {
    // environment default (null): development machines yes, staging / production no
    expect(freeReservationAllowed(null, { tier: 'local', marketStatus: 'ACTIVE' })).toBe(true);
    expect(freeReservationAllowed(null, { tier: 'test', marketStatus: null })).toBe(true);
    expect(freeReservationAllowed(null, { tier: 'staging', marketStatus: 'TESTING' })).toBe(false);
    expect(freeReservationAllowed(null, { tier: 'production', marketStatus: 'ACTIVE' })).toBe(
      false,
    );
    // explicitly enabled by admin: only for a TESTING market outside development machines
    expect(freeReservationAllowed(true, { tier: 'staging', marketStatus: 'TESTING' })).toBe(true);
    expect(freeReservationAllowed(true, { tier: 'staging', marketStatus: 'PILOT' })).toBe(false);
    expect(freeReservationAllowed(true, { tier: 'production', marketStatus: 'ACTIVE' })).toBe(
      false,
    );
    // explicitly disabled: never, even on a development machine
    expect(freeReservationAllowed(false, { tier: 'local', marketStatus: 'TESTING' })).toBe(false);
  });
});
