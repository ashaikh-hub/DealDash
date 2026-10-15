/**
 * Reservation money rules (founder decision 2026-10-15, RC-40..RC-71), as pure functions so every amount is testable on its own.
 *
 * Who ended the reservation, and when, decides how much of the paid amount goes back to the customer; the rest is kept FOR THE
 * MERCHANT, from which DealDash takes only its agreed commission (policy `commissionBps`, default 0).
 *
 *  - merchant / DealDash / system cancellation, or a payment that arrived after the reservation had ended: 100 % refunded (RC-42)
 *  - customer cancels BEFORE the cut-off: prepayment 100 % refunded; refundable deposit 100 % refunded; non-refundable deposit kept
 *    (the customer accepted that term before paying, RC-40)
 *  - customer cancels AFTER the cut-off, or does not come (no-show): prepayment -> the deal's refund share (or the policy default),
 *    the rest kept, never 100 % kept unless the terms say 0 %; deposit kept (RC-41, RC-51)
 *  - redeemed: the whole amount is used / credited to the bill and kept for the merchant (RC-61)
 */
export type EndSituation =
  | 'CUSTOMER_IN_TIME'
  | 'CUSTOMER_LATE'
  | 'NO_SHOW'
  | 'MERCHANT_CANCELLED'
  | 'DEALDASH_CANCELLED'
  | 'SYSTEM_CANCELLED'
  | 'LATE_PAYMENT'
  | 'REDEEMED';

export interface PaidCommitment {
  method: 'FULL_PREPAYMENT' | 'DEPOSIT' | 'CARD_PREAUTH';
  /** The whole amount the customer paid (all units), minor units. */
  paidMinor: number;
  depositRefundable: boolean | null;
  /** FULL_PREPAYMENT: share refunded on a late cancellation or no-show (resolved when the reservation was made). */
  noShowRefundPercent: number | null;
}

export interface MoneySplit {
  refundMinor: number;
  keptMinor: number;
}

/** How much goes back and how much is kept. refund + kept always equals the amount paid. */
export function splitOnEnd(c: PaidCommitment, situation: EndSituation): MoneySplit {
  const all = c.paidMinor;
  const refund = (() => {
    switch (situation) {
      case 'MERCHANT_CANCELLED':
      case 'DEALDASH_CANCELLED':
      case 'SYSTEM_CANCELLED':
      case 'LATE_PAYMENT':
        return all;
      case 'REDEEMED':
        return 0;
      case 'CUSTOMER_IN_TIME':
        if (c.method === 'DEPOSIT') return c.depositRefundable ? all : 0;
        return all;
      case 'CUSTOMER_LATE':
      case 'NO_SHOW':
        if (c.method === 'FULL_PREPAYMENT')
          return Math.round((all * Math.min(100, Math.max(0, c.noShowRefundPercent ?? 0))) / 100);
        return 0;
    }
  })();
  return { refundMinor: refund, keptMinor: all - refund };
}

/** DealDash's commission on an amount kept for the merchant: basis points, rounded, never more than the amount (RC-71). */
export function commissionOn(keptMinor: number, commissionBps: number): number {
  if (keptMinor <= 0 || commissionBps <= 0) return 0;
  return Math.min(keptMinor, Math.round((keptMinor * commissionBps) / 10_000));
}

/** The reason code stored on a refund (customers and finance see why the money went back). */
export const refundReasonOf = (s: EndSituation): string =>
  s === 'CUSTOMER_IN_TIME'
    ? 'CUSTOMER_CANCELLED_IN_TIME'
    : s === 'CUSTOMER_LATE'
      ? 'CUSTOMER_CANCELLED_LATE'
      : s;
