import { describe, expect, it } from 'vitest';
import { branchKey, levenshtein, normalizeName, similarity } from './normalize';

const STOP = ['the', 'ksa', 'saudi', 'arabia', 'llc', 'co', 'company', 'شركة', 'السعودية'];

describe('merchant name normalisation', () => {
  it('collapses spelling, punctuation, accents and country words to one key', () => {
    const keys = [
      "McDonald's",
      'McDonalds KSA',
      "McDonald's Saudi Arabia",
      'MCDONALDS, LLC',
      'McDónalds',
    ].map((n) => normalizeName(n, STOP));
    expect(new Set(keys)).toEqual(new Set(['mcdonalds']));
  });

  it('folds Arabic letter forms, vowel marks and company words', () => {
    expect(normalizeName('شركة مطعم الأَصالة', STOP)).toBe(normalizeName('مطعم الاصاله', STOP));
    expect(normalizeName('كافيه ٢٤', STOP)).toBe('كافيه 24');
  });

  it('keeps different businesses apart', () => {
    expect(normalizeName('Alpha Grill', STOP)).not.toBe(normalizeName('Alpha Cafe', STOP));
  });
});

describe('similarity', () => {
  it('is 100 only for the same normalised name', () => {
    expect(similarity('mcdonalds', 'mcdonalds').confidence).toBe(100);
    expect(similarity('mcdonalds', 'mcdonaldz').confidence).toBeLessThan(100);
  });

  it('suggests, but does not certify, a name with extra words or an abbreviation', () => {
    const extra = similarity('mcdonalds', 'mcdonalds riyadh');
    expect(extra.reasons).toContain('ONE_CONTAINS_THE_OTHER');
    expect(extra.confidence).toBeGreaterThanOrEqual(80);
    expect(extra.confidence).toBeLessThan(100);
    const abbr = similarity('mcd', 'mcdonalds');
    expect(abbr.reasons).toContain('POSSIBLE_ABBREVIATION');
    expect(abbr.confidence).toBeLessThan(80);
  });

  it('scores unrelated names low', () => {
    expect(similarity('alpha grill', 'beta cafe').confidence).toBeLessThan(50);
    expect(similarity('', 'x').confidence).toBe(0);
  });

  it('levenshtein is the edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('branch key', () => {
  it('treats the same outlet written two ways as one, and different coordinates as different', () => {
    const a = branchKey({
      name: 'Olaya Branch',
      city: 'Riyadh',
      latitude: 24.71361,
      longitude: 46.67531,
    });
    const b = branchKey({
      name: 'olaya  branch',
      city: 'RIYADH',
      latitude: 24.7136,
      longitude: 46.6753,
    });
    expect(a).toBe(b);
    expect(a).not.toBe(
      branchKey({ name: 'Olaya Branch', city: 'Riyadh', latitude: 24.8, longitude: 46.7 }),
    );
  });
});
