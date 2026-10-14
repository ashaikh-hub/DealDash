import type { BilingualText } from '@dealdash/types';

/**
 * Customer card presentation (visual only: no business rule, no API change).
 *
 * Production (and tests): a merchant's own uploaded media is ALWAYS shown as-is. A card with no media gets brand-safe category art
 * (original vector art in /brand/art-*.svg) instead of a flat block. Brand imagery is never presented as a merchant's product.
 *
 * Development review only (`next dev`, never a production build or a test run): development data has no real photography. Seed
 * placeholder images (storage key `.../seed-*`) and records created by automated QA runs (title `QA <name> <run id>`) are shown
 * with category-appropriate brand imagery (food photography from the approved UI package for dining / cafés, category art for
 * everything else, so a beauty or fitness offer never shows a restaurant), and the QA run id is hidden from the card title. The
 * records themselves are untouched: ids, titles and run ids stay in the data for traceability.
 */
const REVIEW = process.env.NODE_ENV === 'development';

const FOOD_PHOTOS = [
  '/brand/hero-dining.jpg',
  '/brand/ambience-1.jpg',
  '/brand/dish.jpg',
  '/brand/ambience-2.jpg',
  '/brand/ambience-3.jpg',
];
const PHOTO_CATEGORIES = new Set(['dining', 'cafes']);
const ART_CATEGORIES = new Set([
  'dining',
  'cafes',
  'shopping',
  'beauty_wellness',
  'entertainment',
  'services',
  'fitness',
]);
const QA_TITLE = /^QA\s+(.+?)\s+[0-9a-f]{6}$/i;

const hashOf = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const categoryArt = (code: string | null | undefined) =>
  `/brand/art-${code && ART_CATEGORIES.has(code) ? code : 'other'}.svg`;

/** A development record produced by an automated QA run. */
export const isQaRecord = (title: BilingualText) => QA_TITLE.test(title.en);

/** A development seed placeholder image (local development storage only; production URLs never match). */
function isSeedPlaceholder(url: string): boolean {
  const token = url.split('/v1/storage/download/')[1];
  if (!token) return false;
  try {
    const body = JSON.parse(atob(token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
      key?: string;
    };
    return /\/seed-[^/]*$/.test(body.key ?? '');
  } catch {
    return false;
  }
}

function reviewTitle(title: BilingualText): BilingualText {
  if (!REVIEW) return title;
  const clean = (s: string) => s.replace(QA_TITLE, '$1');
  return { en: clean(title.en), ar: clean(title.ar) };
}

/** The image a card shows: the merchant's media, else category art (development review: brand imagery for placeholders). */
export function cardImage(
  url: string | null,
  category: string | null | undefined,
  id: string,
  title: BilingualText,
): string {
  if (!url) return categoryArt(category);
  if (REVIEW && (isQaRecord(title) || isSeedPlaceholder(url)))
    return category && PHOTO_CATEGORIES.has(category)
      ? FOOD_PHOTOS[hashOf(id) % FOOD_PHOTOS.length]!
      : categoryArt(category);
  return url;
}

/** Live Deal, Exclusive Deal and Voucher cards share this shape. */
export function presentCard<
  T extends {
    id: string;
    title: BilingualText;
    imageUrl: string | null;
    category: { code: string } | null;
  },
>(c: T): T {
  return {
    ...c,
    title: reviewTitle(c.title),
    imageUrl: cardImage(c.imageUrl, c.category?.code, c.id, c.title),
  };
}

/** Detail pages: the same rules for the title and each gallery image (a merchant's real media is never replaced). */
export function presentDetail<
  T extends {
    id: string;
    title: BilingualText;
    media: Array<{ url: string; alt: BilingualText }>;
    category?: { code: string } | null;
  },
>(d: T): T {
  return {
    ...d,
    title: reviewTitle(d.title),
    media: d.media.map((m, i) => ({
      ...m,
      url: cardImage(m.url, d.category?.code, `${d.id}:${i}`, d.title),
    })),
  };
}

/** Watch & Earn: the video art (navy, play, sound-wave) unless the merchant uploaded a real thumbnail. */
export function presentWatch<T extends { title: BilingualText; thumbnailUrl: string | null }>(
  c: T,
): T {
  const placeholder =
    !c.thumbnailUrl || (REVIEW && (isQaRecord(c.title) || isSeedPlaceholder(c.thumbnailUrl)));
  return {
    ...c,
    title: reviewTitle(c.title),
    thumbnailUrl: placeholder ? '/brand/art-watch.svg' : c.thumbnailUrl,
  };
}

/**
 * Home curation: up to `n` cards, never one already shown elsewhere on the page. The API's order is kept; in development review
 * automated-QA records go last so demo content leads.
 */
export function curate<T extends { id: string; title: BilingualText }>(
  lists: T[][],
  n = 2,
  shown?: Set<string>,
): T[] {
  const out: T[] = [];
  const seen = new Set(shown);
  const all = lists.flat();
  const ordered = REVIEW
    ? [...all.filter((c) => !isQaRecord(c.title)), ...all.filter((c) => isQaRecord(c.title))]
    : all;
  for (const c of ordered) {
    if (out.length >= n) break;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
