import { describe, expect, it } from 'vitest';
import {
  HOT_DEAL_STATUSES,
  HOT_DEAL_TRANSITIONS,
  RESERVATION_STATUSES,
  RESERVATION_TRANSITIONS,
  canTransitionHotDeal,
  canTransitionReservation,
} from '@dealdash/types';
import {
  emptyHotDealContent,
  hotDealContentSchema,
  hotDealIssues,
  hotMaterialChanges,
  hotTranslationStatus,
} from '@dealdash/validation';
import {
  codeHint,
  formatManualCode,
  hotStatusAfterApproval,
  hotStatusFromDates,
  newManualCode,
  newQrToken,
  newReference,
  parseCode,
} from './hot-content';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const full = (over: Record<string, unknown> = {}) =>
  hotDealContentSchema.parse({
    categoryId: uuid(1),
    mechanic: 'PERCENTAGE_OFF',
    valueNumber: 40,
    offerLabel: { en: '40% off', ar: 'خصم 40%' },
    title: { en: 'Title', ar: 'عنوان' },
    shortDescription: { en: 'Short', ar: 'قصير' },
    description: { en: 'Long text', ar: 'نص طويل' },
    media: [{ fileId: uuid(2), altEn: '', altAr: '' }],
    limitType: 'TIME_AND_QUANTITY',
    reservationsEnabled: true,
    allocations: [{ branchId: uuid(3), units: 5 }],
    startAt: '2030-01-01T10:00:00.000Z',
    endAt: '2030-01-01T16:00:00.000Z',
    terms: { textEn: 'Terms', textAr: 'الشروط' },
    ...over,
  });

describe('Exclusive Deal state machine', () => {
  it('has no way out of terminal states and every status is defined', () => {
    for (const s of ['EXPIRED', 'CANCELLED', 'REJECTED'] as const)
      expect(HOT_DEAL_TRANSITIONS[s]).toEqual([]);
    expect(Object.keys(HOT_DEAL_TRANSITIONS).sort()).toEqual([...HOT_DEAL_STATUSES].sort());
  });
  it('allows the intended paths and nothing else important', () => {
    expect(canTransitionHotDeal('DRAFT', 'PENDING_REVIEW')).toBe(true);
    expect(canTransitionHotDeal('LIVE', 'SOLD_OUT')).toBe(true);
    expect(canTransitionHotDeal('SOLD_OUT', 'LIVE')).toBe(true);
    expect(canTransitionHotDeal('SUSPENDED', 'LIVE')).toBe(true);
    expect(canTransitionHotDeal('LIVE', 'DRAFT')).toBe(false);
    expect(canTransitionHotDeal('PENDING_REVIEW', 'PAUSED')).toBe(false);
    expect(canTransitionHotDeal('REJECTED', 'LIVE')).toBe(false);
    expect(canTransitionHotDeal('EXPIRED', 'LIVE')).toBe(false);
  });
});

describe('reservation state machine', () => {
  it('only HELD moves forward; terminal states stay terminal', () => {
    expect(RESERVATION_TRANSITIONS.EXPIRED).toEqual([]);
    expect(RESERVATION_TRANSITIONS.CANCELLED).toEqual([]);
    expect(canTransitionReservation('HELD', 'REDEEMED')).toBe(true);
    expect(canTransitionReservation('HELD', 'EXPIRED')).toBe(true);
    expect(canTransitionReservation('HELD', 'CANCELLED')).toBe(true);
    expect(canTransitionReservation('EXPIRED', 'REDEEMED')).toBe(false);
    expect(canTransitionReservation('CANCELLED', 'HELD')).toBe(false);
    expect(Object.keys(RESERVATION_TRANSITIONS).sort()).toEqual([...RESERVATION_STATUSES].sort());
  });
  it('has no deposit or payment state: reservations are free', () => {
    expect(JSON.stringify(RESERVATION_STATUSES)).not.toMatch(/PAYMENT|DEPOSIT|PENDING_PAY/i);
  });
});

describe('Exclusive Deal completeness rules', () => {
  it('accepts a complete bilingual quantity+time deal', () => {
    expect(hotDealIssues(full())).toEqual([]);
  });
  it('flags each missing language separately', () => {
    const issues = hotDealIssues(
      full({ title: { en: 'Only', ar: '' }, terms: { textEn: '', textAr: 'x' } }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        { field: 'title', code: 'REQUIRED_AR' },
        { field: 'terms.textEn', code: 'REQUIRED_EN' },
      ]),
    );
    expect(hotTranslationStatus(full({ title: { en: 'Only', ar: '' } }))).toEqual({
      complete: false,
      missing: ['ar'],
    });
  });
  it('requires a quantity limit when reservations are on and forbids stock for walk-in deals', () => {
    expect(hotDealIssues(full({ limitType: 'TIME' })).map((i) => i.code)).toContain(
      'TYPE_MISMATCH',
    );
    expect(
      hotDealIssues(full({ limitType: 'QUANTITY', endAt: null })).map((i) => i.field),
    ).not.toContain('endAt');
    const walkIn = full({
      limitType: 'TIME',
      reservationsEnabled: false,
      allocations: [{ branchId: uuid(3), units: 0 }],
    });
    expect(hotDealIssues(walkIn)).toEqual([]);
    expect(
      hotDealIssues(full({ limitType: 'QUANTITY', reservationsEnabled: false })).map((i) => i.code),
    ).toContain('TYPE_MISMATCH');
  });
  it('enforces the configured maximum duration, per-customer limit, stock and hold range', () => {
    const limits = {
      maxHours: 4,
      maxPerCustomer: 2,
      maxUnitsPerBranch: 10,
      holdMinMinutes: 10,
      holdMaxMinutes: 60,
    };
    const codes = hotDealIssues(
      full({
        perCustomerLimit: 3,
        holdMinutes: 90,
        allocations: [{ branchId: uuid(3), units: 11 }],
      }),
      { limits },
    ).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'DURATION_TOO_LONG',
        'LIMIT_TOO_HIGH',
        'HOLD_OUT_OF_RANGE',
        'UNITS_TOO_HIGH',
      ]),
    );
  });
  it('rejects an end in the past or before the start; empty content lists everything missing', () => {
    expect(hotDealIssues(full({ endAt: '2029-01-01T00:00:00.000Z' })).map((i) => i.code)).toContain(
      'END_BEFORE_START',
    );
    expect(
      hotDealIssues(full(), { now: new Date('2031-01-01T00:00:00Z') }).map((i) => i.code),
    ).toContain('IN_PAST');
    expect(hotDealIssues(emptyHotDealContent()).length).toBeGreaterThan(8);
  });
  it('a non-public eligibility rule needs at least one partner or city', () => {
    expect(
      hotDealIssues(full({ eligibility: { kind: 'EMPLOYER', valueRefs: [] } })).map((i) => i.field),
    ).toContain('eligibility');
  });
});

describe('material edits of a live Exclusive Deal', () => {
  const base = full();
  it('treats wording, punctuation and photos as minor', () => {
    const next = full({
      description: { en: 'Long text.', ar: 'نص طويل' },
      media: [{ fileId: uuid(2), altEn: 'alt', altAr: '' }],
    });
    expect(hotMaterialChanges(base, next)).toEqual([]);
  });
  it('flags discount, branches, dates, eligibility, limits, hold and terms as material', () => {
    expect(hotMaterialChanges(base, full({ valueNumber: 50 }))).toContain('valueNumber');
    expect(
      hotMaterialChanges(base, full({ allocations: [{ branchId: uuid(9), units: 5 }] })),
    ).toContain('branches');
    expect(hotMaterialChanges(base, full({ endAt: '2030-01-01T18:00:00.000Z' }))).toContain(
      'endAt',
    );
    expect(hotMaterialChanges(base, full({ perCustomerLimit: 2 }))).toContain('perCustomerLimit');
    expect(hotMaterialChanges(base, full({ holdMinutes: 45 }))).toContain('holdMinutes');
    expect(
      hotMaterialChanges(base, full({ eligibility: { kind: 'EMPLOYER', valueRefs: [uuid(7)] } })),
    ).toContain('eligibility');
    expect(
      hotMaterialChanges(
        base,
        full({ terms: { textEn: 'Completely different terms apply now', textAr: 'الشروط' } }),
      ),
    ).toContain('terms');
  });
  it('ignores unit changes (stock moves only through the stock endpoint)', () => {
    expect(
      hotMaterialChanges(base, full({ allocations: [{ branchId: uuid(3), units: 500 }] })),
    ).toEqual([]);
  });
});

describe('dates', () => {
  const now = new Date('2030-01-01T12:00:00Z');
  it('approval and resume derive the status from the dates', () => {
    expect(
      hotStatusAfterApproval(
        new Date('2030-01-01T10:00:00Z'),
        new Date('2030-01-01T16:00:00Z'),
        now,
      ),
    ).toBe('LIVE');
    expect(hotStatusAfterApproval(new Date('2030-01-01T13:00:00Z'), null, now)).toBe('SCHEDULED');
    expect(() => hotStatusAfterApproval(null, new Date('2030-01-01T11:00:00Z'), now)).toThrow();
    expect(hotStatusFromDates(null, new Date('2030-01-01T11:00:00Z'), now)).toBe('EXPIRED');
  });
});

describe('reservation codes', () => {
  it('QR tokens are 128-bit random, unique, URL safe', () => {
    const set = new Set(Array.from({ length: 500 }, newQrToken));
    expect(set.size).toBe(500);
    for (const t of set) expect(t).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
  it('manual codes use an unambiguous alphabet and are not sequential', () => {
    const codes = Array.from({ length: 500 }, newManualCode);
    expect(new Set(codes).size).toBe(500);
    for (const c of codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
    expect(codes.join('')).not.toMatch(/[01OIL]/);
    expect(formatManualCode('ABCDEFGH')).toBe('ABCD-EFGH');
    expect(newReference()).toMatch(/^DD-[A-HJKMNP-Z2-9]{6}$/);
  });
  it('parses QR text, manual codes in any case/spacing, and rejects junk', () => {
    expect(parseCode('DD1.AbCdEfGhIjKlMnOpQrStUv')).toEqual({
      kind: 'QR',
      value: 'AbCdEfGhIjKlMnOpQrStUv',
    });
    expect(parseCode(' abcd-efgh ')).toEqual({ kind: 'MANUAL', value: 'ABCDEFGH' });
    expect(parseCode('ABCD EFGH')).toEqual({ kind: 'MANUAL', value: 'ABCDEFGH' });
    expect(parseCode('DD1.short')).toBeNull();
    expect(parseCode('1234567')).toBeNull();
    expect(parseCode("'; DROP TABLE x;--")).toBeNull();
  });
  it('the attempt log keeps only the tail of a code', () => {
    expect(codeHint('DD1.AbCdEfGhIjKlMnOpQrStUv')).toBe('…StUv');
    expect(codeHint('abcd')).toBe('****');
  });
});
