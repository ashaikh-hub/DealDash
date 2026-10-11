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

// ------------------------------------------------------------------ formatting (Western digits, Gregorian, Riyadh)
const intlTag = (locale: Locale) => (locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB');

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(intlTag(locale), { numberingSystem: 'latn' }).format(value);
}

/** Money is stored as integer halalas; display as SAR with 2 decimals. */
export function formatMoney(locale: Locale, halalas: number): string {
  const riyals = halalas / 100;
  const n = new Intl.NumberFormat(intlTag(locale), {
    numberingSystem: 'latn',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(riyals);
  return locale === 'ar' ? `${n} ر.س` : `SAR ${n}`;
}

/**
 * Money in any configured currency (integer minor units, two decimals), for commercial plans and agreements in other markets.
 * Western digits in both languages; SAR keeps its usual symbol, other currencies show their ISO code.
 */
export function formatAmount(locale: Locale, minor: number, currency: string): string {
  if (currency === 'SAR') return formatMoney(locale, minor);
  const n = new Intl.NumberFormat(intlTag(locale), {
    numberingSystem: 'latn',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
  return locale === 'ar' ? `${n} ${currency}` : `${currency} ${n}`;
}

export function formatDate(locale: Locale, date: Date | string | number): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    dateStyle: 'medium',
    timeZone: 'Asia/Riyadh',
    numberingSystem: 'latn',
    calendar: 'gregory',
  } as Intl.DateTimeFormatOptions).format(new Date(date));
}

export function formatDateTime(locale: Locale, date: Date | string | number): string {
  return new Intl.DateTimeFormat(intlTag(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
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
