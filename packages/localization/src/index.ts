import {
  DEFAULT_LOCALE,
  LOCALES,
  RTL_LOCALES,
  type BilingualText,
  type Locale,
} from '@dealdash/types';
import { dictionaries, type DictionaryKey } from './dictionaries';

export {
  dictionaries,
  en,
  ar,
  arReviewStatus,
  type DictionaryKey,
  type Dictionary,
} from './dictionaries';
export { LOCALES, DEFAULT_LOCALE };
export {
  endOfDayAfter,
  endOfDayIn,
  hourIn,
  isValidTimeZone,
  localDateIn,
  localParts,
  nextMidnightIn,
  startOfDayIn,
  zoneOffsetMs,
} from './timezone';
export type { Locale, BilingualText };

// ------------------------------------------------------------------ direction
export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

export const isRtl = (locale: Locale): boolean => RTL_LOCALES.includes(locale);
export const dirOf = (locale: Locale): 'rtl' | 'ltr' => (isRtl(locale) ? 'rtl' : 'ltr');

// ------------------------------------------------------------------ translation
export type TranslateVars = Record<string, string | number>;

export function translate(locale: Locale, key: DictionaryKey, vars?: TranslateVars): string {
  const raw = dictionaries[locale][key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
}

export const createTranslator =
  (locale: Locale) =>
  (key: DictionaryKey, vars?: TranslateVars): string =>
    translate(locale, key, vars);

/** One row, two languages: pick the requested language with a safe fallback. */
export function pickLocalized(text: BilingualText, locale: Locale): string {
  return text[locale] || text[DEFAULT_LOCALE] || text.ar || '';
}

// ------------------------------------------------------------------ routing
export function localeFromPath(pathname: string): Locale | null {
  const first = pathname.split('/').filter(Boolean)[0];
  return isLocale(first) ? first : null;
}

export function stripLocale(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length && isLocale(parts[0])) parts.shift();
  return '/' + parts.join('/');
}

export function withLocale(pathname: string, locale: Locale): string {
  const rest = stripLocale(pathname);
  return rest === '/' ? `/${locale}` : `/${locale}${rest}`;
}

/** Choose the best supported locale from an Accept-Language header. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', q] = part.trim().split(';q=');
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

// ------------------------------------------------------------------ display context: the session's market (never a fixed country)
/**
 * The market whose currency and business time zone the screens use when a value does not carry its own: set by the app shell from
 * the signed-in business's (or the customer's city's) market, from Market / Country Configuration via the API. A value that states
 * its own currency or zone (an order, a campaign, a statement) always passes it explicitly and wins.
 */
interface DisplayMarket {
  currency: string | null;
  timeZone: string | null;
}
const display: DisplayMarket = { currency: null, timeZone: null };

export function setDisplayMarket(m: { currency?: string | null; timeZone?: string | null }) {
  if (m.currency !== undefined) display.currency = m.currency;
  if (m.timeZone !== undefined) display.timeZone = m.timeZone;
}
export const getDisplayMarket = (): Readonly<DisplayMarket> => ({ ...display });

/**
 * The zone dates are shown in: explicit > the session's market > the viewer's own device zone. Never the server's zone and never a
 * fixed country.
 */
export function displayTimeZone(explicit?: string | null): string {
  return (
    explicit ??
    display.timeZone ??
    (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC')
  );
}

// ------------------------------------------------------------------ formatting (Western digits, Gregorian)
const intlTag = (locale: Locale) => (locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB');

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(intlTag(locale), { numberingSystem: 'latn' }).format(value);
}

/** Western-digit amount with two decimals (money is stored in integer minor units). */
function amountText(locale: Locale, minor: number) {
  return new Intl.NumberFormat(intlTag(locale), {
    numberingSystem: 'latn',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/**
 * Money in any configured currency (integer minor units, two decimals). Western digits in both languages; SAR keeps its usual Arabic
 * symbol, every other currency shows its ISO code.
 */
export function formatAmount(locale: Locale, minor: number, currency: string): string {
  const n = amountText(locale, minor);
  if (currency === 'SAR') return locale === 'ar' ? `${n} ر.س` : `SAR ${n}`;
  return locale === 'ar' ? `${n} ${currency}` : `${currency} ${n}`;
}

/**
 * Money in its own currency when given (an order, a voucher, a statement), else the session market's currency. With neither known,
 * the bare amount is shown rather than a guessed currency.
 */
export function formatMoney(locale: Locale, minor: number, currency?: string | null): string {
  const c = currency ?? display.currency;
  return c ? formatAmount(locale, minor, c) : amountText(locale, minor);
}

export function formatDate(
  locale: Locale,
  date: Date | string | number,
  timeZone?: string | null,
): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    dateStyle: 'medium',
    timeZone: displayTimeZone(timeZone),
    numberingSystem: 'latn',
    calendar: 'gregory',
  } as Intl.DateTimeFormatOptions).format(new Date(date));
}

export function formatDateTime(
  locale: Locale,
  date: Date | string | number,
  timeZone?: string | null,
): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: displayTimeZone(timeZone),
    numberingSystem: 'latn',
    calendar: 'gregory',
  } as Intl.DateTimeFormatOptions).format(new Date(date));
}

// ------------------------------------------------------------------ bidi helpers
const LRI = '⁦';
const PDI = '⁩';

/** Isolate identifiers, codes, phone numbers and brand names so they keep left-to-right order inside RTL text. */
export const isolateLtr = (text: string): string => `${LRI}${text}${PDI}`;

export const containsArabic = (text: string): boolean => /[؀-ۿݐ-ݿ]/.test(text);

/** Basic Arabic normalisation for search (unify alef forms, remove diacritics and tatweel). */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[آأإ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}
