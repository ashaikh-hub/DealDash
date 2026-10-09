import { randomInt, randomBytes } from 'node:crypto';
import { hotDealContentSchema, type HotDealContent } from '@dealdash/validation';
import { QR_PREFIX } from '@dealdash/types';
import { AppError } from '../common/errors';

/** Parses stored or submitted content into the canonical shape (defaults filled in). */
export const parseHotContent = (raw: unknown): HotDealContent =>
  hotDealContentSchema.parse((raw ?? {}) as Record<string, unknown>);

/**
 * Query columns derived from `content`. The ONLY place that maps content to columns, so the two can never drift apart.
 */
export function denormalizeHot(c: HotDealContent) {
  return {
    categoryId: c.categoryId,
    mechanic: c.mechanic,
    titleEn: c.title.en,
    titleAr: c.title.ar,
    limitType: c.limitType,
    reservationsEnabled: c.reservationsEnabled,
    perCustomerLimit: c.perCustomerLimit,
    holdMinutes: c.holdMinutes,
    startAt: c.startAt ? new Date(c.startAt) : null,
    endAt: c.endAt ? new Date(c.endAt) : null,
    eligibilityKind: c.eligibility.kind,
  };
}

/** Status a reviewed (or auto-approved) Exclusive Deal takes: scheduled for the future, live from its start time. */
export function hotStatusAfterApproval(
  startAt: Date | null,
  endAt: Date | null,
  now: Date,
): 'SCHEDULED' | 'LIVE' {
  if (endAt && endAt.getTime() <= now.getTime())
    throw new AppError('INVALID_STATE', 'The end date has already passed', 422, 'endAt');
  return startAt && startAt.getTime() > now.getTime() ? 'SCHEDULED' : 'LIVE';
}

/** The status a resumed or reinstated deal returns to, from its dates (stock decides SOLD_OUT separately). */
export function hotStatusFromDates(
  startAt: Date | null,
  endAt: Date | null,
  now: Date,
): 'SCHEDULED' | 'LIVE' | 'EXPIRED' {
  if (endAt && endAt.getTime() <= now.getTime()) return 'EXPIRED';
  return startAt && startAt.getTime() > now.getTime() ? 'SCHEDULED' : 'LIVE';
}

// ---------------------------------------------------------------- reservation codes
/** No 0/O, 1/I/L: a code read aloud or typed on a phone is not confused. 31 symbols, 8 characters. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Cryptographically random, unrelated to any id or counter. ~40 bits: with attempt rate-limiting it cannot be enumerated. */
export function newManualCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** 128 random bits, URL safe. The QR text is `DD1.` + token. */
export function newQrToken(): string {
  return randomBytes(16).toString('base64url');
}

export const qrText = (token: string) => `${QR_PREFIX}${token}`;
export const formatManualCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function newReference(): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `DD-${s}`;
}

/** What staff typed or scanned, reduced to a lookup. QR text is `DD1.<token>`; anything else is a manual code. */
export function parseCode(
  input: string,
): { kind: 'QR'; value: string } | { kind: 'MANUAL'; value: string } | null {
  const raw = input.trim();
  if (raw.startsWith(QR_PREFIX)) {
    const token = raw.slice(QR_PREFIX.length);
    return /^[A-Za-z0-9_-]{16,40}$/.test(token) ? { kind: 'QR', value: token } : null;
  }
  const manual = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return manual.length === 8 ? { kind: 'MANUAL', value: manual } : null;
}

/** Only the tail of a code is ever stored in the attempt log or shown in lists. */
export const codeHint = (input: string) => {
  const c = input.trim().replace(/[^A-Za-z0-9]/g, '');
  return c.length <= 4 ? '****' : `…${c.slice(-4)}`;
};
