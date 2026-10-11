import { describe, expect, it } from 'vitest';
import { looksLikeCardNumber } from '@dealdash/types';
import { requiresSecondPerson } from './ops-util';

describe('Stage 8 unit rules', () => {
  it('a UUID is never mistaken for a card number; a real card number always is', () => {
    // digit groups of a UUID joined by hyphens used to match the PAN pattern at random (Stage 7 defect, fixed in Stage 8)
    expect(looksLikeCardNumber('01934567-8901-7234-8567-890123456789')).toBe(false);
    expect(looksLikeCardNumber('Scheme 01934567-8901-7234-8567-890123456789 and tier gold')).toBe(
      false,
    );
    expect(looksLikeCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(looksLikeCardNumber('4111-1111-1111-1111')).toBe(true);
    expect(looksLikeCardNumber('Use card 4111111111111111 at the till')).toBe(true);
    expect(looksLikeCardNumber('BIN 412345')).toBe(false);
  });

  it('maker-checker: ALWAYS / NEVER / strictly above the threshold; an unconfigured action always needs a second person', () => {
    expect(requiresSecondPerson({ mode: 'ALWAYS' }, 1)).toBe(true);
    expect(requiresSecondPerson({ mode: 'NEVER' }, 1_000_000)).toBe(false);
    expect(requiresSecondPerson({ mode: 'ABOVE_THRESHOLD', thresholdMinor: 100 }, 100)).toBe(false);
    expect(requiresSecondPerson({ mode: 'ABOVE_THRESHOLD', thresholdMinor: 100 }, 101)).toBe(true);
    expect(requiresSecondPerson({ mode: 'ABOVE_THRESHOLD', thresholdMinor: 100 }, -101)).toBe(true);
    expect(requiresSecondPerson(undefined, 1)).toBe(true);
  });
});
