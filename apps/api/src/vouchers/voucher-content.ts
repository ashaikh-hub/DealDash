import { randomInt } from 'node:crypto';
import { endOfDayAfter, endOfDayIn } from '@dealdash/localization';
import { VOUCHER_QR_PREFIX } from '@dealdash/types';
import { voucherContentSchema, type VoucherContent } from '@dealdash/validation';
import { AppError } from '../common/errors';
import { newManualCode, newQrToken } from '../hot-deals/hot-content';

/** Parses stored or submitted content into the canonical shape (defaults filled in). */
export const parseVoucherContent = (raw: unknown): VoucherContent =>
  voucherContentSchema.parse((raw ?? {}) as Record<string, unknown>);

/** Query columns derived from `content`. The ONLY place that maps content to columns, so the two can never drift apart. */
export function denormalizeVoucher(c: VoucherContent) {
  return {
    categoryId: c.categoryId,
    titleEn: c.title.en,
    titleAr: c.title.ar,
    faceValueHalalas: c.faceValueHalalas,
    sellingPriceHalalas: c.sellingPriceHalalas,
    perCustomerLimit: c.perCustomerLimit,
    validityType: c.validity.type,
    validityDays: c.validity.days,
    validUntil: c.validity.validUntil ? new Date(c.validity.validUntil) : null,
    saleStartAt: c.saleStartAt ? new Date(c.saleStartAt) : null,
    saleEndAt: c.saleEndAt ? new Date(c.saleEndAt) : null,
    eligibilityKind: c.eligibility.kind,
  };
}

/** Status a reviewed (or auto-approved) voucher takes: scheduled for the future, on sale from its start time. */
export function voucherStatusAfterApproval(
  saleStartAt: Date | null,
  saleEndAt: Date | null,
  now: Date,
): 'SCHEDULED' | 'ON_SALE' {
  if (saleEndAt && saleEndAt.getTime() <= now.getTime())
    throw new AppError('INVALID_STATE', 'The sale end date has already passed', 422, 'saleEndAt');
  return saleStartAt && saleStartAt.getTime() > now.getTime() ? 'SCHEDULED' : 'ON_SALE';
}

/** The status a resumed or reinstated voucher returns to, from its dates (stock decides SOLD_OUT separately). */
export function voucherStatusFromDates(
  saleStartAt: Date | null,
  saleEndAt: Date | null,
  now: Date,
): 'SCHEDULED' | 'ON_SALE' | 'ENDED' {
  if (saleEndAt && saleEndAt.getTime() <= now.getTime()) return 'ENDED';
  return saleStartAt && saleStartAt.getTime() > now.getTime() ? 'SCHEDULED' : 'ON_SALE';
}

/**
 * When a voucher bought at `issuedAt` expires: N whole days from purchase, or the fixed date — always at the end of a local day in
 * the voucher's market time zone (Market / Country Configuration), never mid-day and never a fixed country's clock.
 */
export function instanceExpiry(
  v: {
    validityType: 'FIXED_DATE' | 'DAYS_FROM_PURCHASE';
    validityDays: number | null;
    validUntil: Date | null;
  },
  issuedAt: Date,
  timeZone: string,
): Date {
  if (v.validityType === 'FIXED_DATE' && v.validUntil) return endOfDayIn(v.validUntil, timeZone);
  return endOfDayAfter(issuedAt, v.validityDays ?? 30, timeZone);
}
// ---------------------------------------------------------------- references and codes
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Short customer-facing reference, random and never sequential (`VC-`, `ORD-`, `RF-`, `RV-`, `SC-`). */
export function newRef(prefix: string): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `${prefix}-${s}`;
}

export { newManualCode, newQrToken };
export const voucherQrText = (token: string) => `${VOUCHER_QR_PREFIX}${token}`;

/** What staff typed or scanned for a voucher: `DV1.<token>` is a QR; anything else is a manual code candidate. */
export function parseVoucherCode(
  input: string,
):
  | { kind: 'QR'; value: string }
  | { kind: 'QR_INVALID' }
  | { kind: 'MANUAL'; value: string }
  | null {
  const raw = input.trim();
  if (raw.startsWith(VOUCHER_QR_PREFIX)) {
    const token = raw.slice(VOUCHER_QR_PREFIX.length);
    return /^[A-Za-z0-9_-]{16,40}$/.test(token)
      ? { kind: 'QR', value: token }
      : { kind: 'QR_INVALID' };
  }
  const manual = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return manual.length === 8 ? { kind: 'MANUAL', value: manual } : null;
}

/** Whole-SAR display in the offer label staff see ("SAR 100 voucher"). */
export function faceValueLabel(halalas: number): { en: string; ar: string } {
  const sar = halalas % 100 === 0 ? String(halalas / 100) : (halalas / 100).toFixed(2);
  return { en: `SAR ${sar} voucher`, ar: `قسيمة ${sar} ر.س` };
}
