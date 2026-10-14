import { describe, expect, it } from 'vitest';
import { cardImage, categoryArt, curate, presentCard, presentWatch } from './presentation';

const card = (id: string, en = `Deal ${id}`, imageUrl: string | null = null, code = 'dining') => ({
  id,
  title: { en, ar: en },
  imageUrl,
  category: { code },
});

describe('Home curation', () => {
  it('shows up to two cards: one, two, or two of many', () => {
    expect(curate([[card('a')]])).toHaveLength(1);
    expect(curate([[card('a'), card('b')]])).toHaveLength(2);
    expect(curate([[card('a'), card('b'), card('c'), card('d')]]).map((c) => c.id)).toEqual([
      'a',
      'b',
    ]);
    expect(curate([[]])).toEqual([]);
  });

  it('never repeats a card: lists are merged in order and cards already on the page are skipped', () => {
    const near = [card('a'), card('b')];
    const live = [card('a'), card('c')];
    const principal = curate([[card('a')], live]);
    expect(principal.map((c) => c.id)).toEqual(['a', 'c']);
    const ending = curate([near], 2, new Set(principal.map((c) => c.id)));
    expect(ending.map((c) => c.id)).toEqual(['b']);
  });

  it('keeps the API order outside development review (QA records are not re-ranked in tests or production)', () => {
    const qa = card('q', 'QA Brunch 37cc16');
    expect(curate([[qa, card('a')]]).map((c) => c.id)).toEqual(['q', 'a']);
  });
});

describe('Card presentation (production behaviour)', () => {
  it("always shows the merchant's own media unchanged", () => {
    const url = 'https://files.example/merchants/1/deal_image/photo.jpg';
    expect(presentCard(card('a', 'Lunch', url)).imageUrl).toBe(url);
    expect(cardImage(url, 'beauty_wellness', 'a', { en: 'x', ar: 'x' })).toBe(url);
  });

  it('a card without media gets brand-safe category art (unknown categories get the neutral art)', () => {
    expect(presentCard(card('a', 'Facial', null, 'beauty_wellness')).imageUrl).toBe(
      '/brand/art-beauty_wellness.svg',
    );
    expect(categoryArt('unknown')).toBe('/brand/art-other.svg');
    expect(categoryArt(null)).toBe('/brand/art-other.svg');
  });

  it('Watch & Earn: a real thumbnail is kept; none gets the video art', () => {
    const w = { title: { en: 'Meet the chef', ar: 'x' }, thumbnailUrl: 'https://cdn/t.jpg' };
    expect(presentWatch(w).thumbnailUrl).toBe('https://cdn/t.jpg');
    expect(presentWatch({ ...w, thumbnailUrl: null }).thumbnailUrl).toBe('/brand/art-watch.svg');
  });

  it('titles are untouched outside development review (QA traceability stays in the data)', () => {
    expect(presentCard(card('q', 'QA Brunch 37cc16')).title.en).toBe('QA Brunch 37cc16');
  });
});
