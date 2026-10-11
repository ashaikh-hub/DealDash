import { describe, expect, it } from 'vitest';
import type { PricingComponent } from '@dealdash/types';
import { amendmentDelta, calculateQuote, economicsHash, type Economics } from './quote.calculator';

const OWNER = '11111111-1111-4111-8111-111111111111';
const FULFIL = '22222222-2222-4222-8222-222222222222';
const SPONSOR = '33333333-3333-4333-8333-333333333333';

const econ = (over: Partial<Economics> = {}): Economics => ({
  currency: 'SAR',
  maxUnits: 100,
  unitLabel: 'REDEMPTION',
  base: { SELLING_PRICE: 8000, FACE_VALUE: 10000, BENEFIT_VALUE: 2000, MEDIA_SPEND_TOTAL: 0 },
  customerBenefitPerUnit: 2000,
  sponsors: [],
  merchantCashPerUnit: 0,
  ownerOrganizationId: OWNER,
  fulfilmentOrganizationId: OWNER,
  validity: { startAt: null, endAt: null },
  inventory: { total: 100, dailyQuota: null },
  ...over,
});
const comp = (over: Partial<PricingComponent>): PricingComponent => ({
  code: 'fee',
  label: { en: 'Fee', ar: 'رسوم' },
  enabled: true,
  basis: 'PER_UNIT',
  amountHalalas: 100,
  trigger: 'VERIFIED_REDEMPTION',
  collection: 'CASH',
  taxable: true,
  ...over,
});
const pricing = (components: PricingComponent[], taxBps: number | null = null) => ({
  components,
  taxBps,
  currency: 'SAR',
});

describe('commercial quote calculator', () => {
  it('prices a per-redemption fee, a fixed fee and a percentage charge from the configured components only', () => {
    const { totals } = calculateQuote(
      econ(),
      pricing([
        comp({ code: 'per', basis: 'PER_UNIT', amountHalalas: 100 }),
        comp({ code: 'setup', basis: 'FIXED', amountHalalas: 5000, trigger: 'UPFRONT' }),
        comp({
          code: 'pct',
          basis: 'PERCENT_OF_BASE',
          bps: 1000,
          base: 'SELLING_PRICE',
          collection: 'NETTED',
          taxable: false,
        }),
      ]),
    );
    // 100 x 100 + 5000 in cash; 10% of 8000 x 100 = 80,000 netted from the merchant payout
    expect(totals.maxCashPayableToDealDashHalalas).toBe(15_000);
    expect(totals.nettedChargesHalalas).toBe(80_000);
    expect(totals.dealdashChargesHalalas).toBe(95_000);
  });

  it('applies a minimum charge and ignores disabled components', () => {
    const { totals } = calculateQuote(
      econ({ maxUnits: 2 }),
      pricing([
        comp({ amountHalalas: 100, minimumHalalas: 5000 }),
        comp({ code: 'off', enabled: false, amountHalalas: 999_999 }),
      ]),
    );
    expect(totals.maxCashPayableToDealDashHalalas).toBe(5000);
  });

  it('never invents a tax rate: unconfigured tax is reported as such and adds nothing', () => {
    const none = calculateQuote(econ(), pricing([comp({})], null));
    expect(none.totals.taxStatus).toBe('NOT_CONFIGURED');
    expect(none.totals.taxHalalas).toBe(0);
    const some = calculateQuote(econ(), pricing([comp({})], 1500));
    expect(some.totals.taxStatus).toBe('APPLIED');
    expect(some.totals.taxHalalas).toBe(1500); // 15% of 10,000 (the taxable cash base)
    expect(some.totals.maxCashPayableToDealDashHalalas).toBe(11_500);
  });

  it('keeps sponsor funding separate from DealDash revenue, per sponsor, and the merchant benefit non-cash', () => {
    const { lines, totals } = calculateQuote(
      econ({
        sponsors: [
          { organizationId: SPONSOR, perUnitHalalas: 500, trigger: 'VERIFIED_REDEMPTION' },
        ],
        merchantCashPerUnit: 300,
      }),
      pricing([comp({})]),
    );
    expect(totals.maxSponsorLiabilityHalalas).toBe(50_000);
    expect(totals.sponsorLiability).toEqual([{ organizationId: SPONSOR, amountHalalas: 50_000 }]);
    expect(totals.merchantCashContributionHalalas).toBe(30_000);
    // benefit 2000 - sponsor 500 - merchant cash 300 = 1200 per unit, honoured by the merchant, never added to cash
    expect(totals.maxMerchantBenefitCommitmentHalalas).toBe(120_000);
    expect(totals.maxCashPayableToDealDashHalalas).toBe(10_000);
    expect(lines.find((l) => l.kind === 'MERCHANT_BENEFIT')?.cash).toBe(false);
    expect(lines.find((l) => l.kind === 'SPONSOR_FUNDING')?.partyOrganizationId).toBe(SPONSOR);
  });

  it('flags unbounded liability and funding that exceeds the benefit', () => {
    const open = calculateQuote(econ({ maxUnits: 0 }), pricing([comp({})]));
    expect(open.totals.issues).toContain('UNBOUNDED_FEE');
    const over = calculateQuote(
      econ({
        sponsors: [
          { organizationId: SPONSOR, perUnitHalalas: 5000, trigger: 'VERIFIED_REDEMPTION' },
        ],
      }),
      pricing([]),
    );
    expect(over.totals.issues).toContain('FUNDING_EXCEEDS_BENEFIT');
  });

  it('assigns a third-party fulfilment merchant its own non-cash commitment', () => {
    const { lines } = calculateQuote(econ({ fulfilmentOrganizationId: FULFIL }), pricing([]));
    const b = lines.find((l) => l.kind === 'MERCHANT_BENEFIT')!;
    expect(b.partyOrganizationId).toBe(FULFIL);
    expect(b.partyRole).toBe('FULFILMENT_MERCHANT');
  });

  it('fingerprints the economics: any material change yields a different hash, a no-op does not', () => {
    const a = economicsHash(econ(), 'D:1');
    expect(economicsHash(econ(), 'D:1')).toBe(a);
    expect(economicsHash(econ({ maxUnits: 101 }), 'D:1')).not.toBe(a);
    expect(economicsHash(econ(), 'D:2')).not.toBe(a);
    expect(economicsHash(econ({ merchantCashPerUnit: 1 }), 'D:1')).not.toBe(a);
  });

  it('computes an amendment delta (original, additional, revised) and detects exposure increases', () => {
    const p = pricing([comp({})]);
    const before = calculateQuote(econ({ maxUnits: 100 }), p).totals;
    const more = calculateQuote(econ({ maxUnits: 150 }), p).totals;
    const less = calculateQuote(econ({ maxUnits: 50 }), p).totals;
    const up = amendmentDelta(before, more);
    expect(up.maxCashPayableToDealDash).toEqual({
      original: 10_000,
      additional: 5000,
      revised: 15_000,
    });
    expect(up.increasesExposure).toBe(true);
    expect(amendmentDelta(before, less).increasesExposure).toBe(false);
  });
});
