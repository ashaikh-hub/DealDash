import { describe, expect, it } from 'vitest';
import {
  commissionOn,
  holdCaptureOnEnd,
  refundReasonOf,
  splitOnEnd,
  type PaidCommitment,
} from './reservation-money';

const prepay: PaidCommitment = {
  method: 'FULL_PREPAYMENT',
  paidMinor: 5_000,
  depositRefundable: null,
  noShowRefundPercent: 40,
};
const deposit = (refundable: boolean): PaidCommitment => ({
  method: 'DEPOSIT',
  paidMinor: 1_000,
  depositRefundable: refundable,
  noShowRefundPercent: null,
});

/** Founder decision 2026-10-15: RC-40 (in time), RC-41 (late), RC-42 (merchant / DealDash), RC-51 (no-show), RC-61 (redeemed). */
describe('reservation money rules', () => {
  it('merchant, DealDash, system cancellation and a late payment always refund everything', () => {
    for (const s of [
      'MERCHANT_CANCELLED',
      'DEALDASH_CANCELLED',
      'SYSTEM_CANCELLED',
      'LATE_PAYMENT',
    ] as const) {
      expect(splitOnEnd(prepay, s)).toEqual({ refundMinor: 5_000, keptMinor: 0 });
      expect(splitOnEnd(deposit(false), s)).toEqual({ refundMinor: 1_000, keptMinor: 0 });
    }
  });

  it('customer cancels in time: prepayment and refundable deposit back; a non-refundable deposit is kept', () => {
    expect(splitOnEnd(prepay, 'CUSTOMER_IN_TIME')).toEqual({ refundMinor: 5_000, keptMinor: 0 });
    expect(splitOnEnd(deposit(true), 'CUSTOMER_IN_TIME')).toEqual({
      refundMinor: 1_000,
      keptMinor: 0,
    });
    expect(splitOnEnd(deposit(false), 'CUSTOMER_IN_TIME')).toEqual({
      refundMinor: 0,
      keptMinor: 1_000,
    });
  });

  it('late cancellation and no-show: the prepayment refund share applies, never 100 % kept by default; deposits are kept', () => {
    for (const s of ['CUSTOMER_LATE', 'NO_SHOW'] as const) {
      expect(splitOnEnd(prepay, s)).toEqual({ refundMinor: 2_000, keptMinor: 3_000 });
      expect(splitOnEnd(deposit(true), s)).toEqual({ refundMinor: 0, keptMinor: 1_000 });
      expect(splitOnEnd(deposit(false), s)).toEqual({ refundMinor: 0, keptMinor: 1_000 });
    }
    // 0 % only when the terms say so; rounding is to the nearest minor unit and refund + kept always equals what was paid
    expect(splitOnEnd({ ...prepay, noShowRefundPercent: 0 }, 'NO_SHOW')).toEqual({
      refundMinor: 0,
      keptMinor: 5_000,
    });
    const odd = splitOnEnd({ ...prepay, paidMinor: 999, noShowRefundPercent: 33 }, 'NO_SHOW');
    expect(odd).toEqual({ refundMinor: 330, keptMinor: 669 });
  });

  it('deposit refundable on any cancellation (founder UAT 2026-10-16): a late cancellation refunds it; a no-show still keeps it', () => {
    const any = { ...deposit(true), depositLateRefund: true };
    expect(splitOnEnd(any, 'CUSTOMER_LATE')).toEqual({ refundMinor: 1_000, keptMinor: 0 });
    expect(splitOnEnd(any, 'CUSTOMER_IN_TIME')).toEqual({ refundMinor: 1_000, keptMinor: 0 });
    expect(splitOnEnd(any, 'NO_SHOW')).toEqual({ refundMinor: 0, keptMinor: 1_000 });
    // the flag never makes a non-refundable deposit refundable
    const never = { ...deposit(false), depositLateRefund: true };
    expect(splitOnEnd(never, 'CUSTOMER_LATE')).toEqual({ refundMinor: 0, keptMinor: 1_000 });
  });

  it('redeemed: everything is kept for the merchant', () => {
    expect(splitOnEnd(prepay, 'REDEEMED')).toEqual({ refundMinor: 0, keptMinor: 5_000 });
    expect(splitOnEnd(deposit(true), 'REDEEMED')).toEqual({ refundMinor: 0, keptMinor: 1_000 });
  });

  it('commission is only the agreed rate on the kept amount, rounded, never more than it (RC-71)', () => {
    expect(commissionOn(5_000, 1_000)).toBe(500);
    expect(commissionOn(5_000, 0)).toBe(0);
    expect(commissionOn(0, 1_000)).toBe(0);
    expect(commissionOn(999, 1_234)).toBe(123);
    expect(commissionOn(10, 10_000)).toBe(10);
  });

  it('card hold (phase 3): released when cancelled in time or by the business; late / no-show captures minus the released share', () => {
    for (const s of [
      'CUSTOMER_IN_TIME',
      'MERCHANT_CANCELLED',
      'DEALDASH_CANCELLED',
      'SYSTEM_CANCELLED',
      'LATE_PAYMENT',
    ] as const)
      expect(holdCaptureOnEnd(2_000, 25, s, 'RELEASE')).toBe(0);
    expect(holdCaptureOnEnd(2_000, null, 'NO_SHOW', 'RELEASE')).toBe(2_000);
    expect(holdCaptureOnEnd(2_000, 25, 'NO_SHOW', 'RELEASE')).toBe(1_500);
    expect(holdCaptureOnEnd(2_000, 25, 'CUSTOMER_LATE', 'RELEASE')).toBe(1_500);
    expect(holdCaptureOnEnd(999, 33, 'NO_SHOW', 'RELEASE')).toBe(669);
    // redeemed: released (pay at the till) unless the policy captures it as part payment
    expect(holdCaptureOnEnd(2_000, 25, 'REDEEMED', 'RELEASE')).toBe(0);
    expect(holdCaptureOnEnd(2_000, 25, 'REDEEMED', 'CAPTURE')).toBe(2_000);
  });

  it('a card hold captured up front then follows the prepayment rules (refund share on late / no-show)', () => {
    const captured: PaidCommitment = { ...prepay, method: 'CARD_PREAUTH', noShowRefundPercent: 25 };
    expect(splitOnEnd(captured, 'CUSTOMER_IN_TIME')).toEqual({ refundMinor: 5_000, keptMinor: 0 });
    expect(splitOnEnd(captured, 'NO_SHOW')).toEqual({ refundMinor: 1_250, keptMinor: 3_750 });
    expect(splitOnEnd(captured, 'REDEEMED')).toEqual({ refundMinor: 0, keptMinor: 5_000 });
  });

  it('stores readable refund reasons', () => {
    expect(refundReasonOf('CUSTOMER_IN_TIME')).toBe('CUSTOMER_CANCELLED_IN_TIME');
    expect(refundReasonOf('CUSTOMER_LATE')).toBe('CUSTOMER_CANCELLED_LATE');
    expect(refundReasonOf('NO_SHOW')).toBe('NO_SHOW');
  });
});
