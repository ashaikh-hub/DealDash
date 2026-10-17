import { describe, expect, it } from 'vitest';
import { watchContentSchema, watchIssues } from '@dealdash/validation';
import { PRIZE_DRAW_SPACE, decidePrize, prizeOpportunity } from './watch-prize.service';

/** FDR-19 (2026-10-16): instant probabilistic allocation, decided by the server. */
describe('instant prize decision', () => {
  it('an ineligible view is never rolled and never wins', () => {
    let rolled = false;
    const d = decidePrize({
      ineligible: 'CUSTOMER_LIMIT',
      probabilityBps: 10_000,
      roll: () => {
        rolled = true;
        return 0;
      },
    });
    expect(d).toEqual({ roll: null, wins: false });
    expect(rolled).toBe(false);
  });

  it('an eligible view wins exactly when the roll is below the probability', () => {
    expect(decidePrize({ ineligible: null, probabilityBps: 2_500, roll: () => 2_499 })).toEqual({
      roll: 2_499,
      wins: true,
    });
    expect(decidePrize({ ineligible: null, probabilityBps: 2_500, roll: () => 2_500 })).toEqual({
      roll: 2_500,
      wins: false,
    });
    // 100 % wins on every roll; the smallest probability wins only on 0
    expect(
      decidePrize({ ineligible: null, probabilityBps: PRIZE_DRAW_SPACE, roll: () => 9_999 }).wins,
    ).toBe(true);
    expect(decidePrize({ ineligible: null, probabilityBps: 1, roll: () => 1 }).wins).toBe(false);
  });

  it('a roll outside the draw space is refused (never trusted)', () => {
    expect(() =>
      decidePrize({ ineligible: null, probabilityBps: 100, roll: () => 10_000 }),
    ).toThrow();
    expect(() => decidePrize({ ineligible: null, probabilityBps: 100, roll: () => -1 })).toThrow();
  });

  it('the card opportunity follows the configuration and the stock (never guaranteed below 100 %)', () => {
    const content = watchContentSchema.parse({
      prize: {
        title: { en: 'Free coffee', ar: 'قهوة مجانية' },
        inventory: 5,
        winProbabilityBps: 3_000,
        acknowledged: true,
      },
    });
    expect(prizeOpportunity({ prizeInventory: 5, prizesAwarded: 2 }, content)).toMatchObject({
      remaining: 3,
      guaranteed: false,
    });
    expect(prizeOpportunity({ prizeInventory: 5, prizesAwarded: 5 }, content)).toBeNull();
    expect(
      prizeOpportunity({ prizeInventory: 0, prizesAwarded: 0 }, watchContentSchema.parse({})),
    ).toBeNull();
  });

  it('guardrails and the commercial acknowledgement are checked before submission', () => {
    const content = watchContentSchema.parse({
      prize: { title: { en: 'X', ar: 'س' }, inventory: 5000, winProbabilityBps: 9_000 },
    });
    const codes = watchIssues(content, {
      prizeGuardrails: {
        enabled: true,
        maxWinProbabilityBps: 5_000,
        maxInventory: 1_000,
        maxPerCustomer: 3,
        maxValidityDays: 60,
        maxLiabilityMinor: 0,
      },
    })
      .filter((i) => i.field.startsWith('prize'))
      .map((i) => `${i.field}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'prize.winProbabilityBps:PRIZE_ABOVE_GUARDRAIL',
        'prize.inventory:PRIZE_ABOVE_GUARDRAIL',
        'prize.acknowledged:ACKNOWLEDGEMENT_REQUIRED',
      ]),
    );
  });
});
