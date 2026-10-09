import { describe, expect, it } from 'vitest';
import type { EligibilityExpression } from '@dealdash/types';
import {
  eligibilityExpressionSchema,
  eligibilityExpressionShape,
} from '@dealdash/validation';
import { evaluateEligibility, type EligibilityContext } from './eligibility.service';

const NOW = new Date('2026-10-09T10:00:00Z');
const attr = (attrType: string, valueRef: string, over: Record<string, unknown> = {}) => ({
  attrType: attrType as never,
  valueRef,
  level: 'SELF_DECLARED' as const,
  status: 'VERIFIED',
  expiresAt: null,
  ...over,
});
const ctx = (attributes: ReturnType<typeof attr>[], over: Partial<EligibilityContext> = {}): EligibilityContext => ({
  userId: 'u1',
  city: 'Riyadh',
  country: 'SA',
  attributes,
  now: NOW,
  ...over,
});
const A = (a: string, ...values: string[]): EligibilityExpression => ({ op: 'ATTR', attr: a as never, values });
const AND = (...children: EligibilityExpression[]): EligibilityExpression => ({ op: 'AND', children });
const OR = (...children: EligibilityExpression[]): EligibilityExpression => ({ op: 'OR', children });
const NOT = (child: EligibilityExpression): EligibilityExpression => ({ op: 'NOT', child });
const run = (e: EligibilityExpression, c: EligibilityContext) => evaluateEligibility('COMPOSITE', [], c, e);

describe('shared eligibility engine: nested rules', () => {
  it('AND needs every part, OR needs one, NOT excludes', () => {
    const visaGold = AND(A('SCHEME', 'visa'), A('CARD_TIER', 'gold'));
    expect(run(visaGold, ctx([attr('SCHEME', 'visa'), attr('CARD_TIER', 'gold')])).result).toBe('ELIGIBLE');
    expect(run(visaGold, ctx([attr('SCHEME', 'visa')])).result).toBe('LOCKED_UNLOCKABLE');
    const either = OR(A('SCHEME', 'visa'), A('SCHEME', 'mastercard'));
    expect(run(either, ctx([attr('SCHEME', 'mastercard')])).result).toBe('ELIGIBLE');
    const notVip = AND(A('SCHEME', 'visa'), NOT(A('SEGMENT', 'blocked')));
    expect(run(notVip, ctx([attr('SCHEME', 'visa')])).result).toBe('ELIGIBLE');
    expect(run(notVip, ctx([attr('SCHEME', 'visa'), attr('SEGMENT', 'blocked')])).result).toBe('HIDDEN');
  });

  it('nests: (Visa AND Riyadh) OR (employer X AND tier gold)', () => {
    const rule = OR(AND(A('SCHEME', 'visa'), A('GEOGRAPHY', 'Riyadh')), AND(A('EMPLOYER', 'x'), A('CARD_TIER', 'gold')));
    expect(run(rule, ctx([attr('SCHEME', 'visa')])).result).toBe('ELIGIBLE');
    expect(run(rule, ctx([attr('EMPLOYER', 'x'), attr('CARD_TIER', 'gold')], { city: 'Jeddah' })).result).toBe('ELIGIBLE');
    // wrong city for branch one, nothing for branch two, but branch two can still be unlocked
    expect(run(rule, ctx([attr('SCHEME', 'visa')], { city: 'Jeddah' })).result).toBe('LOCKED_UNLOCKABLE');
  });

  it('separates what a customer can unlock from what they never can (hidden)', () => {
    const o = run(A('CARD', 'bank-1'), ctx([]));
    expect(o).toMatchObject({ result: 'LOCKED_UNLOCKABLE', unlockAction: 'ADD_BANK_BENEFIT' });
    expect(run(A('EMPLOYER', 'e1'), ctx([])).unlockAction).toBe('VERIFY_EMPLOYER');
    expect(run(A('SCHEME', 's'), ctx([])).unlockAction).toBe('JOIN_SCHEME');
    // facts a customer cannot change are never "unlockable"
    expect(run(A('GEOGRAPHY', 'Jeddah'), ctx([])).result).toBe('HIDDEN');
    expect(run(A('COUNTRY', 'AE'), ctx([])).result).toBe('HIDDEN');
    expect(run(A('SEGMENT', 'vip'), ctx([])).result).toBe('HIDDEN');
    expect(run(A('PRODUCT_OWNERSHIP', 'VOUCHER:v1'), ctx([])).result).toBe('HIDDEN');
    // a verified DIFFERENT employer closes the employer path
    expect(run(A('EMPLOYER', 'e1'), ctx([attr('EMPLOYER', 'e2')])).result).toBe('HIDDEN');
    // an OR keeps the unlockable branch alive, an AND dies with its impossible part
    expect(run(OR(A('SEGMENT', 'vip'), A('CARD', 'b')), ctx([])).result).toBe('LOCKED_UNLOCKABLE');
    expect(run(AND(A('SEGMENT', 'vip'), A('CARD', 'b')), ctx([])).result).toBe('HIDDEN');
  });

  it('respects verification level, expiry and status; guests are asked to sign in', () => {
    const rule: EligibilityExpression = { op: 'ATTR', attr: 'EMPLOYER', values: ['e1'], level: 'OTP_VERIFIED' };
    expect(run(rule, ctx([attr('EMPLOYER', 'e1')])).result).toBe('LOCKED_UNLOCKABLE'); // only self-declared
    expect(run(rule, ctx([attr('EMPLOYER', 'e1', { level: 'OTP_VERIFIED' })])).result).toBe('ELIGIBLE');
    expect(run(rule, ctx([attr('EMPLOYER', 'e1', { level: 'OTP_VERIFIED', expiresAt: new Date('2026-10-01') })])).result).toBe('LOCKED_UNLOCKABLE');
    expect(run(rule, ctx([attr('EMPLOYER', 'e1', { level: 'OTP_VERIFIED', status: 'REVOKED' })])).result).toBe('LOCKED_UNLOCKABLE');
    expect(run(A('CARD', 'b'), ctx([], { userId: null }))).toMatchObject({ result: 'LOCKED_UNLOCKABLE', unlockAction: 'SIGN_IN' });
  });

  it('fails closed: a composite rule with no expression is never satisfied', () => {
    expect(evaluateEligibility('COMPOSITE', [], ctx([]), null).result).toBe('HIDDEN');
    expect(evaluateEligibility('COMPOSITE', [], ctx([])).result).toBe('HIDDEN');
  });

  it('the flat kinds behave exactly as before (the expression is ignored)', () => {
    expect(evaluateEligibility('PUBLIC', [], ctx([]), A('SEGMENT', 'x')).result).toBe('ELIGIBLE');
    expect(
      evaluateEligibility('BANK_CARD', [{ attrType: 'CARD', valueRef: 'b1', requiredLevel: 'SELF_DECLARED' }], ctx([attr('CARD', 'b1')])).result,
    ).toBe('ELIGIBLE');
  });
});

describe('expression schema', () => {
  it('accepts valid rules and rejects malformed ones', () => {
    expect(eligibilityExpressionSchema.safeParse(AND(A('SCHEME', 'visa'), NOT(A('SEGMENT', 'x')))).success).toBe(true);
    expect(eligibilityExpressionSchema.safeParse({ op: 'AND', children: [] }).success).toBe(false);
    expect(eligibilityExpressionSchema.safeParse({ op: 'ATTR', attr: 'SHOE_SIZE', values: ['9'] }).success).toBe(false);
    expect(eligibilityExpressionSchema.safeParse({ op: 'ATTR', attr: 'CARD', values: [] }).success).toBe(false);
  });

  it('measures depth and size so rules stay readable', () => {
    const deep = AND(OR(AND(OR(AND(A('CARD', 'x'))))));
    expect(eligibilityExpressionShape(deep)).toEqual({ depth: 6, nodes: 6 });
    expect(eligibilityExpressionShape(A('CARD', 'x'))).toEqual({ depth: 1, nodes: 1 });
  });
});
