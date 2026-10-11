/**
 * Name normalisation and similarity for merchant master data. Pure functions, no database, fully unit tested.
 *
 * The goal is to SUGGEST duplicates, never to merge them: "McDonald's", "McDonalds KSA" and "McDonald's Saudi Arabia" normalise to
 * the same key, while "McD Riyadh" only scores as a possible match and goes to a person.
 */

const AR_TASHKEEL = /[ً-ٰٟـ]/g;
const LATIN_MARKS = /[̀-ͯ]/g;

/** Light Arabic normalisation: one form of alef, ya and ha, no vowel marks or tatweel. */
function foldArabic(s: string): string {
  return s
    .replace(AR_TASHKEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function normalizeName(input: string, stopWords: readonly string[] = []): string {
  const stops = new Set(stopWords.map((w) => foldArabic(w.toLowerCase())));
  const base = foldArabic(
    input
      .normalize('NFKD')
      .replace(LATIN_MARKS, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      // apostrophes disappear without splitting the word: "mcdonald's" -> "mcdonalds"
      .replace(/['’`´]/g, ''),
  );
  const tokens = base
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((t) => t && !stops.has(t));
  return tokens.join(' ');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export interface Similarity {
  confidence: number;
  reasons: string[];
}

/** 0 to 100. 100 = identical after normalisation. Reasons explain the score to the reviewer. */
export function similarity(a: string, b: string): Similarity {
  if (!a || !b) return { confidence: 0, reasons: [] };
  if (a === b) return { confidence: 100, reasons: ['SAME_NORMALIZED_NAME'] };
  const reasons: string[] = [];
  const ta = new Set(a.split(' '));
  const tb = new Set(b.split(' '));
  const shared = [...ta].filter((t) => tb.has(t)).length;
  const jaccard = shared / (ta.size + tb.size - shared);
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  let score = Math.max(lev, jaccard * 0.95);
  if (lev >= 0.8) reasons.push('SIMILAR_SPELLING');
  if (jaccard >= 0.5) reasons.push('SHARED_WORDS');
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // one name is the other with extra words ("mcdonalds" / "mcdonalds riyadh"): possible, not certain
  if (short.length >= 3 && (long.startsWith(`${short} `) || long.endsWith(` ${short}`))) {
    score = Math.max(score, 0.82);
    reasons.push('ONE_CONTAINS_THE_OTHER');
  }
  // an abbreviation ("mcd") of the first word of the other name
  const firstWord = long.split(' ')[0]!;
  if (
    short.length >= 3 &&
    !short.includes(' ') &&
    firstWord.startsWith(short) &&
    firstWord !== short
  ) {
    score = Math.max(score, 0.74);
    reasons.push('POSSIBLE_ABBREVIATION');
  }
  return { confidence: Math.round(score * 100), reasons };
}

/** Key that identifies an outlet inside one merchant: name + city + coordinates rounded to about 100 m. */
export function branchKey(parts: {
  name: string;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const geo =
    parts.latitude != null && parts.longitude != null
      ? `${parts.latitude.toFixed(3)},${parts.longitude.toFixed(3)}`
      : '';
  return [normalizeName(parts.name), normalizeName(parts.city ?? ''), geo].join('|');
}
