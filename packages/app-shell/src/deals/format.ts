import {
  createTranslator,
  dictionaries,
  displayTimeZone,
  formatDate,
  formatNumber,
  type Locale,
} from '@dealdash/localization';
import type { BilingualText } from '@dealdash/types';

/** Picks the visible language with a safe fallback (never shows an empty string when the other language exists). */
export const pickText = (text: BilingualText | null | undefined, locale: Locale): string =>
  text ? text[locale] || text.en || text.ar || '' : '';

export function formatDistance(locale: Locale, meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined) return null;
  const t = createTranslator(locale);
  if (meters < 1000)
    return t('deal.m', { n: formatNumber(locale, Math.max(10, Math.round(meters / 10) * 10)) });
  const km = Math.round(meters / 100) / 10;
  return t('deal.km', { n: formatNumber(locale, km) });
}

/** "Ends in 3 days", "Ends today", "Ongoing offer". Dates are Gregorian and shown in the market's time zone. */
export function timeLeftLabel(locale: Locale, endsAt: string | null, now = new Date()): string {
  const t = createTranslator(locale);
  if (!endsAt) return t('deal.ongoing');
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (ms <= 0) return t('deal.endsToday');
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return hours < 1 ? t('deal.endsToday') : t('deal.endsInHours', { n: hours });
  const days = Math.ceil(ms / 86_400_000);
  return days === 1
    ? t('deal.endsInOneDay')
    : t('deal.endsInDays', { n: formatNumber(locale, days) });
}

export const dateLabel = (locale: Locale, iso: string | null) =>
  iso ? formatDate(locale, iso) : '';

export const directionsUrl = (latitude: number, longitude: number) =>
  `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;

const WEEK = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Day key and minutes since midnight, in the market's business time zone (branch opening hours are local wall-clock times). */
function riyadhClock(now: Date): { day: (typeof WEEK)[number]; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: displayTimeZone(),
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = get('weekday').toLowerCase().slice(0, 3) as (typeof WEEK)[number];
  const hour = Number(get('hour')) % 24;
  return { day: WEEK.includes(day) ? day : 'mon', minutes: hour * 60 + Number(get('minute')) };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export interface OpenStatus {
  open: boolean;
  /** HH:MM of the next change (closing time when open, opening time when closed). */
  next: string | null;
}

type Hours = Record<
  string,
  { closed?: boolean; intervals?: Array<{ open: string; close: string }> }
>;

/** Whether a branch is open right now, from its weekly hours (Riyadh time). Null when no hours are known. */
export function openStatus(hours: unknown, now = new Date()): OpenStatus | null {
  if (!hours || typeof hours !== 'object') return null;
  const h = hours as Hours;
  const { day, minutes } = riyadhClock(now);
  const today = h[day];
  if (!today || today.closed || !today.intervals?.length) return { open: false, next: null };
  for (const i of today.intervals) {
    const open = toMinutes(i.open);
    const close = toMinutes(i.close);
    const spansMidnight = close <= open;
    if (minutes >= open && (spansMidnight || minutes < close)) return { open: true, next: i.close };
    if (spansMidnight && minutes < close) return { open: true, next: i.close };
  }
  const later = today.intervals
    .map((i) => toMinutes(i.open))
    .filter((o) => o > minutes)
    .sort((a, b) => a - b)[0];
  const first = today.intervals[0]!;
  return {
    open: false,
    next:
      later !== undefined
        ? (today.intervals.find((i) => toMinutes(i.open) === later)?.open ?? first.open)
        : null,
  };
}

export function visibleTermLines(
  locale: Locale,
  blocks: {
    fullPriceItemsOnly: boolean;
    notCombinable: boolean;
    minimumSpendHalalas: number | null;
    validDays: string[];
    validFrom: string | null;
    validTo: string | null;
  },
  formatAmount: (halalas: number) => string,
): string[] {
  const t = createTranslator(locale);
  const out: string[] = [];
  if (blocks.fullPriceItemsOnly) out.push(t('deal.fullPriceOnly'));
  if (blocks.notCombinable) out.push(t('deal.notCombinable'));
  if (blocks.minimumSpendHalalas)
    out.push(t('deal.minSpend', { amount: formatAmount(blocks.minimumSpendHalalas) }));
  if (blocks.validDays.length)
    out.push(
      t('deal.validDays', {
        days: blocks.validDays
          .map((d) => t(`weekday.${d}` as never))
          .join(locale === 'ar' ? '، ' : ', '),
      }),
    );
  if (blocks.validFrom && blocks.validTo)
    out.push(t('deal.validBetween', { from: blocks.validFrom, to: blocks.validTo }));
  return out;
}

const hasKey = (k: string) => k in dictionaries.en;

/** Guardrail reason codes stored on a submit entry become readable sentences; free-text reasons pass through. */
export function historyReason(locale: Locale, reason: string | null | undefined): string | null {
  if (!reason) return null;
  const t = createTranslator(locale);
  if (/^[A-Z_]+(, [A-Z_]+)*$/.test(reason))
    return reason
      .split(', ')
      .map((c) => (hasKey(`guardrail.reason.${c}`) ? t(`guardrail.reason.${c}` as never) : c))
      .join(' ');
  return reason;
}

/** Readable name of a content field in the activity log ("terms.textEn" -> "Terms (English)"). */
export function fieldLabel(locale: Locale, field: string): string {
  const t = createTranslator(locale);
  const base = field.split('.')[0]!;
  if (hasKey(`issue.field.${field}`)) return t(`issue.field.${field}` as never);
  if (hasKey(`issue.field.${base}`)) return t(`issue.field.${base}` as never);
  return field;
}
