import { describe, expect, it } from 'vitest';
import {
  canTransitionInstance,
  canTransitionPayment,
  canTransitionRefund,
  canTransitionVoucher,
  VOUCHER_STATUSES,
} from '@dealdash/types';
import {
  emptyVoucherContent,
  voucherContentSchema,
  voucherIssues,
  voucherMaterialChanges,
  voucherSavings,
} from '@dealdash/validation';
import {
  endOfRiyadhDay,
  faceValueLabel,
  instanceExpiry,
  newRef,
  parseVoucherCode,
  voucherStatusAfterApproval,
  voucherStatusFromDates,
} from './voucher-content';
import { LedgerService } from './ledger.service';
import { VoucherCoreService } from './voucher-core.service';

const complete = () =>
  voucherContentSchema.parse({
    categoryId: '018f0000-0000-7000-8000-000000000001',
    title: { en: 'T', ar: 'ع' },
    shortDescription: { en: 'S', ar: 'ق' },
    description: { en: 'D', ar: 'و' },
    redemptionRules: { en: 'R', ar: 'ر' },
    media: [{ fileId: '018f0000-0000-7000-8000-000000000002', altEn: 'a', altAr: 'أ' }],
    faceValueHalalas: 10_000,
    sellingPriceHalalas: 8_000,
    totalQty: 10,
    perCustomerLimit: 2,
    validity: { type: 'DAYS_FROM_PURCHASE', days: 30, validUntil: null },
    branchIds: ['018f0000-0000-7000-8000-000000000003'],
    terms: { textEn: 'T', textAr: 'ش' },
  });

describe('voucher lifecycle and payment state machines', () => {
  it('only the documented voucher transitions exist; REJECTED and ENDED are terminal', () => {
    expect(canTransitionVoucher('DRAFT', 'PENDING_REVIEW')).toBe(true);
    expect(canTransitionVoucher('PENDING_REVIEW', 'ON_SALE')).toBe(true);
    expect(canTransitionVoucher('ON_SALE', 'SOLD_OUT')).toBe(true);
    expect(canTransitionVoucher('DRAFT', 'SOLD_OUT')).toBe(false);
    expect(canTransitionVoucher('REJECTED', 'ON_SALE')).toBe(false);
    for (const s of VOUCHER_STATUSES) expect(canTransitionVoucher('ENDED', s)).toBe(false);
  });
  it('a payment never goes backwards from success, except into the refund states', () => {
    expect(canTransitionPayment('PENDING', 'SUCCEEDED')).toBe(true);
    expect(canTransitionPayment('SUCCEEDED', 'FAILED')).toBe(false);
    expect(canTransitionPayment('SUCCEEDED', 'CANCELLED')).toBe(false);
    expect(canTransitionPayment('SUCCEEDED', 'REFUND_PENDING')).toBe(true);
    expect(canTransitionPayment('REFUND_PENDING', 'REFUNDED')).toBe(true);
    expect(canTransitionPayment('REFUNDED', 'SUCCEEDED')).toBe(false);
  });
  it('refunds and voucher instances follow their rules (a redeemed voucher only returns to active by reversal)', () => {
    expect(canTransitionRefund('REQUESTED', 'APPROVED')).toBe(true);
    expect(canTransitionRefund('REJECTED', 'APPROVED')).toBe(false);
    expect(canTransitionRefund('FAILED', 'PROCESSING')).toBe(true);
    expect(canTransitionInstance('ACTIVE', 'REDEEMED')).toBe(true);
    expect(canTransitionInstance('REDEEMED', 'REFUNDED')).toBe(false);
    expect(canTransitionInstance('REDEEMED', 'ACTIVE')).toBe(true);
    expect(canTransitionInstance('REFUNDED', 'ACTIVE')).toBe(false);
  });
});

describe('voucher content rules', () => {
  it('a complete voucher has no issues; reported savings are face value minus price', () => {
    expect(voucherIssues(complete())).toEqual([]);
    expect(voucherSavings(10_000, 8_000)).toEqual({ savingsHalalas: 2000, savingsPercent: 20 });
    expect(voucherSavings(0, 0)).toEqual({ savingsHalalas: 0, savingsPercent: 0 });
  });
  it('price above face value, empty content and unlimited inventory are all refused', () => {
    expect(
      voucherIssues({ ...complete(), sellingPriceHalalas: 10_001 }).map((i) => i.code),
    ).toContain('PRICE_ABOVE_FACE');
    expect(voucherIssues({ ...complete(), totalQty: 0 }).map((i) => i.code)).toContain(
      'QTY_REQUIRED',
    );
    expect(voucherIssues(emptyVoucherContent()).length).toBeGreaterThan(8);
  });
  it('a fixed expiry date in the past or too close is refused; days from purchase need the platform minimum', () => {
    const now = new Date('2026-10-08T00:00:00Z');
    const fixed = (d: string) => ({
      ...complete(),
      validity: { type: 'FIXED_DATE' as const, days: null, validUntil: d },
    });
    expect(voucherIssues(fixed('2026-10-01T00:00:00Z'), { now }).map((i) => i.code)).toContain(
      'IN_PAST',
    );
    expect(voucherIssues(fixed('2026-10-10T00:00:00Z'), { now }).map((i) => i.code)).toContain(
      'VALIDITY_TOO_SHORT',
    );
    expect(voucherIssues(fixed('2026-12-31T00:00:00Z'), { now })).toEqual([]);
  });
  it('material changes: wording tweaks are minor; price, value, validity, branches and terms are not', () => {
    const a = complete();
    expect(voucherMaterialChanges(a, { ...a, title: { en: 'T!', ar: 'ع' } })).toEqual([]);
    expect(voucherMaterialChanges(a, { ...a, sellingPriceHalalas: 7_000 })).toEqual([
      'sellingPriceHalalas',
    ]);
    expect(voucherMaterialChanges(a, { ...a, validity: { ...a.validity, days: 10 } })).toEqual([
      'validity',
    ]);
    expect(
      voucherMaterialChanges(a, {
        ...a,
        terms: { ...a.terms, blocks: { ...a.terms.blocks, notCombinable: true } },
      }),
    ).toEqual(['terms']);
  });
});

describe('dates, codes and references', () => {
  it('validity is counted in whole Riyadh days and ends at the end of the day, never mid-day', () => {
    const issued = new Date('2026-10-08T21:30:00Z'); // 00:30 on 9 October in Riyadh
    const end = endOfRiyadhDay(issued);
    expect(end.toISOString()).toBe('2026-10-09T20:59:59.999Z'); // 23:59:59.999 Riyadh on 9 October
    const exp = instanceExpiry(
      { validityType: 'DAYS_FROM_PURCHASE', validityDays: 30, validUntil: null },
      issued,
    );
    expect(exp.toISOString()).toBe('2026-11-08T20:59:59.999Z');
    expect(
      instanceExpiry(
        {
          validityType: 'FIXED_DATE',
          validityDays: null,
          validUntil: new Date('2026-12-31T00:00:00Z'),
        },
        issued,
      ).toISOString(),
    ).toBe('2026-12-31T20:59:59.999Z');
  });
  it('voucher QR text and typed codes parse; malformed QR text is recognised as invalid, not as a manual code', () => {
    expect(parseVoucherCode('DV1.' + 'A'.repeat(22))).toEqual({
      kind: 'QR',
      value: 'A'.repeat(22),
    });
    expect(parseVoucherCode('DV1.short')).toEqual({ kind: 'QR_INVALID' });
    expect(parseVoucherCode(' k7qm-9t2x ')).toEqual({ kind: 'MANUAL', value: 'K7QM9T2X' });
    expect(parseVoucherCode('DD1.' + 'A'.repeat(22))).toBeNull(); // a reservation QR is not ours
    expect(parseVoucherCode('abc')).toBeNull();
  });
  it('references are random, prefixed and unambiguous; face value reads naturally in both languages', () => {
    const refs = new Set(Array.from({ length: 50 }, () => newRef('VC')));
    expect(refs.size).toBe(50);
    for (const r of refs) expect(r).toMatch(/^VC-[A-HJKMNP-Z2-9]{6}$/);
    expect(faceValueLabel(10_000)).toEqual({ en: 'SAR 100 voucher', ar: 'قسيمة 100 ر.س' });
    expect(faceValueLabel(12_550).en).toBe('SAR 125.50 voucher');
  });
  it('approval status follows the sale window', () => {
    const now = new Date('2026-10-08T10:00:00Z');
    expect(voucherStatusAfterApproval(null, null, now)).toBe('ON_SALE');
    expect(voucherStatusAfterApproval(new Date('2026-10-09T00:00:00Z'), null, now)).toBe(
      'SCHEDULED',
    );
    expect(() => voucherStatusAfterApproval(null, new Date('2026-10-01T00:00:00Z'), now)).toThrow();
    expect(voucherStatusFromDates(null, new Date('2026-10-01T00:00:00Z'), now)).toBe('ENDED');
  });
});

describe('platform fee and the ledger guard', () => {
  const core = Object.create(VoucherCoreService.prototype) as VoucherCoreService;
  it('the fee is a percentage plus a fixed part, never more than the price, rounded half up', () => {
    expect(core.computeFee(8000, { percentBps: 1000, fixedHalalas: 0, version: 1 })).toBe(800);
    expect(core.computeFee(8005, { percentBps: 1000, fixedHalalas: 0, version: 1 })).toBe(801);
    expect(core.computeFee(8000, { percentBps: 500, fixedHalalas: 100, version: 2 })).toBe(500);
    expect(core.computeFee(100, { percentBps: 5000, fixedHalalas: 500, version: 3 })).toBe(100);
    expect(core.computeFee(0, { percentBps: 1000, fixedHalalas: 0, version: 1 })).toBe(0);
  });
  it('a journal that does not sum to zero, or uses fractions, is refused before anything is written', async () => {
    const ledger = new LedgerService({} as never);
    const base = { type: 'SALE' as const, sourceType: 'T', sourceId: 'x', idempotencyKey: 'k' };
    await expect(
      ledger.post({} as never, {
        ...base,
        lines: [
          { family: 'PSP_CLEARING', amountHalalas: 100 },
          { family: 'MERCHANT_HELD', amountHalalas: -99 },
        ],
      }),
    ).rejects.toThrow(/balance/);
    await expect(
      ledger.post({} as never, {
        ...base,
        lines: [
          { family: 'PSP_CLEARING', amountHalalas: 0.5 },
          { family: 'MERCHANT_HELD', amountHalalas: -0.5 },
        ],
      }),
    ).rejects.toThrow(/integer/);
  });
});
