import { describe, expect, it } from 'vitest';
import {
  LIVE_DEAL_STATUSES,
  LIVE_DEAL_TRANSITIONS,
  canTransitionLiveDeal,
  type EligibilityKind,
} from '@dealdash/types';
import {
  diffLiveDealContent,
  emptyLiveDealContent,
  isMinorTextEdit,
  liveDealContentSchema,
  liveDealIssues,
  normalizeText,
  translationStatus,
  type LiveDealContent,
} from '@dealdash/validation';
import { imageDimensions } from '../files/image-info';
import { makeDevImagePng } from '../seed/png';
import { statusAfterApproval, statusFromDates } from './deal-content';
import { evaluateEligibility, type EligibilityContext } from './eligibility.service';
import { GuardrailsService } from './guardrails.service';
import { searchTokens } from './discovery.service';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function complete(over: Partial<LiveDealContent> = {}): LiveDealContent {
  return liveDealContentSchema.parse({
    categoryId: uuid(1),
    mechanic: 'PERCENTAGE_OFF',
    valueNumber: 30,
    offerLabel: { en: '30% off', ar: 'خصم 30%' },
    title: { en: '30% off the tasting menu', ar: 'خصم 30% على قائمة التذوق' },
    shortDescription: { en: 'Dinner for two', ar: 'عشاء لشخصين' },
    description: { en: 'Enjoy the full tasting menu.', ar: 'استمتع بقائمة التذوق الكاملة.' },
    media: [{ fileId: uuid(2), altEn: 'plate', altAr: 'طبق' }],
    branchIds: [uuid(3)],
    startAt: '2026-10-10T08:00:00.000Z',
    endAt: '2026-10-20T08:00:00.000Z',
    terms: {
      blocks: {},
      textEn: 'Valid on full-price items.',
      textAr: 'صالح على الأصناف بالسعر الكامل.',
    },
    ...over,
  });
}

describe('Live Deal state machine', () => {
  it('has exactly the nine approved statuses', () => {
    expect([...LIVE_DEAL_STATUSES]).toEqual([
      'DRAFT',
      'PENDING_REVIEW',
      'NEEDS_CHANGES',
      'SCHEDULED',
      'LIVE',
      'PAUSED',
      'EXPIRED',
      'REJECTED',
      'SUSPENDED',
    ]);
  });

  it('allows exactly the listed transitions and nothing else (full matrix)', () => {
    for (const from of LIVE_DEAL_STATUSES)
      for (const to of LIVE_DEAL_STATUSES)
        expect(canTransitionLiveDeal(from, to), `${from} -> ${to}`).toBe(
          LIVE_DEAL_TRANSITIONS[from].includes(to),
        );
  });

  it('EXPIRED and REJECTED are terminal', () => {
    expect(LIVE_DEAL_TRANSITIONS.EXPIRED).toEqual([]);
    expect(LIVE_DEAL_TRANSITIONS.REJECTED).toEqual([]);
  });

  it('review loop: pending review can ask for changes, changes can be resubmitted', () => {
    expect(canTransitionLiveDeal('DRAFT', 'PENDING_REVIEW')).toBe(true);
    expect(canTransitionLiveDeal('PENDING_REVIEW', 'NEEDS_CHANGES')).toBe(true);
    expect(canTransitionLiveDeal('NEEDS_CHANGES', 'PENDING_REVIEW')).toBe(true);
    expect(canTransitionLiveDeal('PENDING_REVIEW', 'REJECTED')).toBe(true);
  });

  it('a deal can never skip review into LIVE from DRAFT without the auto-publish path, and never go back to DRAFT', () => {
    for (const s of LIVE_DEAL_STATUSES) expect(canTransitionLiveDeal(s, 'DRAFT')).toBe(false);
    expect(canTransitionLiveDeal('LIVE', 'PENDING_REVIEW')).toBe(false);
    expect(canTransitionLiveDeal('PAUSED', 'PENDING_REVIEW')).toBe(false);
  });

  it('approval and resume pick SCHEDULED or LIVE from the dates', () => {
    const now = new Date('2026-10-10T10:00:00Z');
    expect(statusAfterApproval(new Date('2026-10-11T00:00:00Z'), null, now)).toBe('SCHEDULED');
    expect(statusAfterApproval(new Date('2026-10-09T00:00:00Z'), null, now)).toBe('LIVE');
    expect(() =>
      statusAfterApproval(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-05T00:00:00Z'), now),
    ).toThrow();
    expect(
      statusFromDates(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-05T00:00:00Z'), now),
    ).toBe('EXPIRED');
    expect(statusFromDates(new Date('2026-10-11T00:00:00Z'), null, now)).toBe('SCHEDULED');
  });
});

describe('Live Deal content: completeness and bilingual policy', () => {
  it('an empty draft is valid input but not publishable', () => {
    const issues = liveDealIssues(emptyLiveDealContent());
    const fields = issues.map((i) => i.field);
    for (const f of [
      'categoryId',
      'mechanic',
      'title',
      'description',
      'media',
      'branchIds',
      'startAt',
    ])
      expect(fields).toContain(f);
  });

  it('a complete deal has no issues', () => {
    expect(liveDealIssues(complete())).toEqual([]);
    expect(translationStatus(complete())).toEqual({ complete: true, missing: [] });
  });

  it('requires both languages and reports which one is missing', () => {
    const c = complete({ title: { en: 'Only English', ar: '' } });
    expect(liveDealIssues(c)).toContainEqual({ field: 'title', code: 'REQUIRED_AR' });
    expect(translationStatus(c)).toEqual({ complete: false, missing: ['ar'] });
    const d = complete({ description: { en: '', ar: 'وصف فقط' } });
    expect(translationStatus(d).missing).toEqual(['en']);
  });

  it('validates percent range, amount, dates and eligibility references', () => {
    expect(liveDealIssues(complete({ valueNumber: 150 }))).toContainEqual({
      field: 'valueNumber',
      code: 'VALUE_RANGE',
    });
    expect(liveDealIssues(complete({ mechanic: 'AMOUNT_OFF', valueNumber: 0 }))).toContainEqual({
      field: 'valueNumber',
      code: 'VALUE_RANGE',
    });
    expect(liveDealIssues(complete({ endAt: '2026-10-01T00:00:00.000Z' }))).toContainEqual({
      field: 'endAt',
      code: 'END_BEFORE_START',
    });
    expect(
      liveDealIssues(complete({ endAt: '2026-10-11T00:00:00.000Z' }), {
        now: new Date('2026-12-01T00:00:00Z'),
      }),
    ).toContainEqual({ field: 'endAt', code: 'IN_PAST' });
    expect(
      liveDealIssues(complete({ eligibility: { kind: 'EMPLOYER', valueRefs: [] } })),
    ).toContainEqual({ field: 'eligibility', code: 'REQUIRED' });
  });

  it('keeps Arabic and English text exactly as written (no placeholder substitution)', () => {
    const c = complete();
    expect(c.title.ar).toBe('خصم 30% على قائمة التذوق');
    expect(c.title.en).toBe('30% off the tasting menu');
  });

  it('defaults to the general (frictionless) redemption mode', () => {
    expect(emptyLiveDealContent().redemptionMode).toBe('GENERAL');
  });
});

describe('Live editing: minor edits publish, material edits need review (LD-41)', () => {
  const base = complete();
  const material = (next: LiveDealContent) => diffLiveDealContent(base, next).material;

  it('typo, formatting and translation touch-ups are minor', () => {
    expect(
      material(
        complete({ description: { en: 'Enjoy the full  tasting menu', ar: base.description.ar } }),
      ),
    ).toEqual([]);
    expect(
      material(complete({ title: { en: '30% off the tasting menue', ar: base.title.ar } })),
    ).toEqual([]);
    expect(
      material(
        complete({ shortDescription: { en: 'Dinner for 2', ar: base.shortDescription.ar } }),
      ),
    ).toEqual(['shortDescription']); // number changed
    expect(
      material(
        complete({ description: { en: base.description.en, ar: 'استمتع بقائمه التذوق الكاملة.' } }),
      ),
    ).toEqual([]);
  });

  it('photos and alt text are minor', () => {
    expect(
      material(complete({ media: [{ fileId: uuid(9), altEn: 'new', altAr: 'جديد' }] })),
    ).toEqual([]);
    const d = diffLiveDealContent(
      base,
      complete({ media: [{ fileId: uuid(2), altEn: 'Better alt', altAr: 'طبق' }] }),
    );
    expect(d.changed).toContain('media');
    expect(d.material).toEqual([]);
  });

  it('discount value, mechanic and headline offer are material', () => {
    expect(material(complete({ valueNumber: 50 }))).toContain('valueNumber');
    expect(material(complete({ mechanic: 'AMOUNT_OFF' }))).toContain('mechanic');
    expect(material(complete({ offerLabel: { en: '50% off', ar: base.offerLabel.ar } }))).toContain(
      'offerLabel',
    );
  });

  it('a changed number inside a title or description is material (the proposition changed)', () => {
    expect(
      material(complete({ title: { en: '50% off the tasting menu', ar: base.title.ar } })),
    ).toContain('title');
    expect(
      material(complete({ description: { en: 'Enjoy 50% off', ar: base.description.ar } })),
    ).toContain('description');
  });

  it('participating branches, dates, eligibility and category are material', () => {
    expect(material(complete({ branchIds: [uuid(3), uuid(4)] }))).toContain('branchIds');
    expect(material(complete({ startAt: '2026-10-11T08:00:00.000Z' }))).toContain('startAt');
    expect(material(complete({ endAt: '2026-10-25T08:00:00.000Z' }))).toContain('endAt');
    expect(
      material(complete({ eligibility: { kind: 'EMPLOYER', valueRefs: [uuid(7)] } })),
    ).toContain('eligibility');
    expect(material(complete({ categoryId: uuid(8) }))).toContain('categoryId');
  });

  it('important terms are material, a typo in the terms text is not', () => {
    expect(
      material(
        complete({
          terms: { ...base.terms, blocks: { ...base.terms.blocks, minimumSpendHalalas: 20000 } },
        }),
      ),
    ).toContain('terms');
    expect(
      material(complete({ terms: { ...base.terms, textEn: 'Valid on full price items.' } })),
    ).toEqual([]);
    expect(
      material(
        complete({
          terms: { ...base.terms, textEn: 'Not valid on weekends or public holidays at all.' },
        }),
      ),
    ).toContain('terms');
  });

  it('branch order and Arabic-Indic digits do not create false material changes', () => {
    const two = complete({ branchIds: [uuid(3), uuid(4)] });
    expect(diffLiveDealContent(two, complete({ branchIds: [uuid(4), uuid(3)] })).changed).toEqual(
      [],
    );
    expect(isMinorTextEdit('خصم 30% اليوم', 'خصم ٣٠% اليوم')).toBe(true);
  });

  it('the material list is configurable', () => {
    const d = diffLiveDealContent(base, complete({ valueNumber: 50 }), ['branchIds']);
    expect(d.changed).toContain('valueNumber');
    expect(d.material).toEqual([]);
  });

  it('normalises Arabic for comparison', () => {
    expect(normalizeText('أحمد')).toBe(normalizeText('احمد'));
    expect(normalizeText('مدرسة')).toBe(normalizeText('مدرسه'));
    expect(normalizeText('٣٠')).toBe('30');
  });
});

describe('Eligibility visibility (shared engine)', () => {
  const now = new Date('2026-10-10T10:00:00Z');
  const ctx = (over: Partial<EligibilityContext> = {}): EligibilityContext => ({
    userId: 'u1',
    city: 'Riyadh',
    attributes: [],
    now,
    ...over,
  });
  const attr = (attrType: 'EMPLOYER' | 'CARD' | 'SCHEME', valueRef: string, over = {}) => ({
    attrType,
    valueRef,
    level: 'OTP_VERIFIED' as const,
    status: 'VERIFIED',
    expiresAt: null,
    ...over,
  });
  const cond = (kind: Exclude<EligibilityKind, 'PUBLIC'>, valueRef: string) => [
    {
      attrType:
        kind === 'BANK_CARD' ? ('CARD' as const) : (kind as 'EMPLOYER' | 'SCHEME' | 'GEOGRAPHY'),
      valueRef,
      requiredLevel: kind === 'EMPLOYER' ? ('OTP_VERIFIED' as const) : ('SELF_DECLARED' as const),
    },
  ];

  it('public deals are eligible for everyone, including guests', () => {
    expect(evaluateEligibility('PUBLIC', [], ctx({ userId: null })).result).toBe('ELIGIBLE');
  });

  it('employer: verified employee unlocks, unverified is LOCKED with the explanation and action', () => {
    expect(
      evaluateEligibility(
        'EMPLOYER',
        cond('EMPLOYER', 'emp-1'),
        ctx({ attributes: [attr('EMPLOYER', 'emp-1')] }),
      ).result,
    ).toBe('ELIGIBLE');
    const locked = evaluateEligibility('EMPLOYER', cond('EMPLOYER', 'emp-1'), ctx());
    expect(locked.result).toBe('LOCKED_UNLOCKABLE');
    expect(locked.unlockAction).toBe('VERIFY_EMPLOYER');
    expect(locked.message).toEqual({
      en: 'Verify your employer to unlock',
      ar: 'وثّق جهة عملك لفتح العرض',
    });
  });

  it('employer: a self-declared (unverified) employer does not unlock', () => {
    const r = evaluateEligibility(
      'EMPLOYER',
      cond('EMPLOYER', 'emp-1'),
      ctx({ attributes: [attr('EMPLOYER', 'emp-1', { level: 'SELF_DECLARED' })] }),
    );
    expect(r.result).toBe('LOCKED_UNLOCKABLE');
  });

  it('employer: a customer verified at a DIFFERENT employer has no realistic path, so the deal is hidden', () => {
    const r = evaluateEligibility(
      'EMPLOYER',
      cond('EMPLOYER', 'emp-1'),
      ctx({ attributes: [attr('EMPLOYER', 'emp-2')] }),
    );
    expect(r.result).toBe('HIDDEN');
  });

  it('expired or revoked attributes do not count', () => {
    const expired = attr('EMPLOYER', 'emp-1', { expiresAt: new Date('2026-10-01T00:00:00Z') });
    expect(
      evaluateEligibility('EMPLOYER', cond('EMPLOYER', 'emp-1'), ctx({ attributes: [expired] }))
        .result,
    ).toBe('LOCKED_UNLOCKABLE');
    const revoked = attr('EMPLOYER', 'emp-1', { status: 'REVOKED' });
    expect(
      evaluateEligibility('EMPLOYER', cond('EMPLOYER', 'emp-1'), ctx({ attributes: [revoked] }))
        .result,
    ).toBe('LOCKED_UNLOCKABLE');
  });

  it('bank card: self-declared issuer unlocks; otherwise locked with the bank-benefit action; never hidden', () => {
    expect(
      evaluateEligibility(
        'BANK_CARD',
        cond('BANK_CARD', 'bank-1'),
        ctx({ attributes: [attr('CARD', 'bank-1', { level: 'SELF_DECLARED' })] }),
      ).result,
    ).toBe('ELIGIBLE');
    const r = evaluateEligibility(
      'BANK_CARD',
      cond('BANK_CARD', 'bank-1'),
      ctx({ attributes: [attr('CARD', 'bank-2')] }),
    );
    expect(r.result).toBe('LOCKED_UNLOCKABLE');
    expect(r.unlockAction).toBe('ADD_BANK_BENEFIT');
    expect(r.message?.en).toBe('Add your bank benefits to unlock');
  });

  it('scheme: locked until the membership is added', () => {
    expect(evaluateEligibility('SCHEME', cond('SCHEME', 's1'), ctx()).unlockAction).toBe(
      'JOIN_SCHEME',
    );
    expect(
      evaluateEligibility(
        'SCHEME',
        cond('SCHEME', 's1'),
        ctx({ attributes: [attr('SCHEME', 's1', { level: 'SELF_DECLARED' })] }),
      ).result,
    ).toBe('ELIGIBLE');
  });

  it('geography: inside the area is eligible, outside is hidden (no unlock path)', () => {
    expect(evaluateEligibility('GEOGRAPHY', cond('GEOGRAPHY', 'Riyadh'), ctx()).result).toBe(
      'ELIGIBLE',
    );
    expect(
      evaluateEligibility('GEOGRAPHY', cond('GEOGRAPHY', 'Riyadh'), ctx({ city: 'jeddah' })).result,
    ).toBe('HIDDEN');
    expect(
      evaluateEligibility('GEOGRAPHY', cond('GEOGRAPHY', 'Riyadh'), ctx({ city: 'RIYADH' })).result,
    ).toBe('ELIGIBLE');
  });

  it('guests see locked offers with a sign-in action instead of a verification action', () => {
    const r = evaluateEligibility('EMPLOYER', cond('EMPLOYER', 'emp-1'), ctx({ userId: null }));
    expect(r.result).toBe('LOCKED_UNLOCKABLE');
    expect(r.unlockAction).toBe('SIGN_IN');
  });

  it('any one of several listed partners satisfies the rule', () => {
    const conds = [...cond('EMPLOYER', 'a'), ...cond('EMPLOYER', 'b')];
    expect(
      evaluateEligibility('EMPLOYER', conds, ctx({ attributes: [attr('EMPLOYER', 'b')] })).result,
    ).toBe('ELIGIBLE');
  });
});

describe('Search tokens (bilingual PostgreSQL search)', () => {
  it('normalises hamza, teh marbuta, diacritics and digits the same way as the SQL function', () => {
    expect(searchTokens('أحمد')).toEqual(searchTokens('احمد'));
    expect(searchTokens('مقهى')).toEqual(searchTokens('مقهي'));
    expect(searchTokens('خصم ٣٠')).toEqual(['خصم', '30']);
  });
  it('removes the Arabic definite article so "الرياض" finds "رياض"', () => {
    expect(searchTokens('الرياض')).toEqual(['رياض']);
    expect(searchTokens('ال')).toEqual(['ال']);
  });
  it('lower-cases English, splits words and caps the token count', () => {
    expect(searchTokens('  Nobu   RIYADH ')).toEqual(['nobu', 'riyadh']);
    expect(searchTokens('a b c d e f g h')).toHaveLength(6);
    expect(searchTokens(undefined)).toEqual([]);
  });
});

describe('Image header validation', () => {
  it('reads PNG dimensions from the header', () => {
    const png = makeDevImagePng(640, 400, [10, 10, 10], [200, 100, 50], 1);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(imageDimensions(png)).toEqual({ width: 640, height: 400 });
  });
  it('reads JPEG dimensions from a Start-Of-Frame marker', () => {
    const jpeg = Buffer.from(
      'ffd8ffe000104a46494600010100000100010000ffc00011080190028003012200021101031101ffd9',
      'hex',
    );
    expect(imageDimensions(jpeg)).toEqual({ width: 640, height: 400 });
  });
  it('returns null for anything else', () => {
    expect(imageDimensions(Buffer.from('%PDF-1.4 hello'))).toBeNull();
    expect(imageDimensions(Buffer.alloc(3))).toBeNull();
  });
});

describe('Guardrails (pilot posture: manual review)', () => {
  const stub = (auto: unknown, rules: unknown) =>
    new GuardrailsService({
      get: async (key: string) => (key === 'live_deals.auto_publish' ? auto : rules),
    } as never);
  const rules = { maxPercentOff: 70, reviewMechanics: ['OTHER'], prohibitedTerms: ['guaranteed'] };

  it('always routes to manual review while auto-publish is off', async () => {
    const r = await stub({ enabled: false, minTrustLevel: 'TRUSTED' }, rules).evaluate(
      complete(),
      'TRUSTED',
    );
    expect(r.outcome).toBe('MANUAL_REVIEW');
    expect(r.reasons).toContain('PILOT_MANUAL_REVIEW');
  });
  it('auto-publishes only for trusted merchants with clean content when enabled', async () => {
    const g = stub({ enabled: true, minTrustLevel: 'TRUSTED' }, rules);
    expect((await g.evaluate(complete(), 'TRUSTED')).outcome).toBe('AUTO_PUBLISH');
    expect((await g.evaluate(complete(), 'NEW')).reasons).toContain('TRUST_LEVEL_TOO_LOW');
    expect((await g.evaluate(complete({ valueNumber: 90 }), 'TRUSTED')).reasons).toContain(
      'DISCOUNT_ABOVE_RANGE',
    );
    expect((await g.evaluate(complete({ mechanic: 'OTHER' }), 'TRUSTED')).reasons).toContain(
      'MECHANIC_REQUIRES_REVIEW',
    );
    expect(
      (
        await g.evaluate(
          complete({ description: { en: 'Guaranteed best price', ar: 'وصف' } }),
          'TRUSTED',
        )
      ).reasons,
    ).toContain('PROHIBITED_TERM');
  });
});
