import { describe, expect, it } from 'vitest';
import {
  canTransitionWatch,
  reasonClassOf,
  WATCH_FINAL_STATUSES,
  WATCH_STATUSES,
  WATCH_TRANSITIONS,
} from '@dealdash/types';
import {
  DEFAULT_WATCH_LIMITS,
  emptyWatchContent,
  watchContentSchema,
  watchIssues,
  watchMaterialChanges,
  watchTranslationStatus,
} from '@dealdash/validation';
import {
  hashDevice,
  hashToken,
  inTimeWindow,
  mp4DurationSec,
  newViewToken,
  nextRiyadhMidnight,
  startOfRiyadhDay,
  watchStatusAfterApproval,
  watchStatusFromDates,
} from './watch-content';
import { WatchCoreService } from './watch-core.service';

const core = Object.create(WatchCoreService.prototype) as WatchCoreService;
const valid = () =>
  watchContentSchema.parse({
    title: { en: 'T', ar: 'ع' },
    description: { en: 'D', ar: 'و' },
    ctaLabel: { en: 'Go', ar: 'اذهب' },
    videoFileId: '00000000-0000-4000-8000-000000000001',
    durationSec: 12,
    startAt: '2030-01-01T00:00:00.000Z',
    endAt: '2030-02-01T00:00:00.000Z',
    targeting: { cities: ['Riyadh'] },
    paidViews: 20,
  });

describe('Watch & Earn state machine', () => {
  it('has no way out of a final state, and every status has an entry', () => {
    for (const s of WATCH_STATUSES) expect(WATCH_TRANSITIONS[s]).toBeDefined();
    for (const s of WATCH_FINAL_STATUSES) expect(WATCH_TRANSITIONS[s]).toEqual([]);
  });
  it('allows the intended paths and refuses the rest', () => {
    expect(canTransitionWatch('DRAFT', 'PENDING_REVIEW')).toBe(true);
    expect(canTransitionWatch('PENDING_REVIEW', 'NEEDS_CHANGES')).toBe(true);
    expect(canTransitionWatch('NEEDS_CHANGES', 'PENDING_REVIEW')).toBe(true);
    expect(canTransitionWatch('LIVE', 'PAUSED')).toBe(true);
    expect(canTransitionWatch('SUSPENDED', 'LIVE')).toBe(true);
    expect(canTransitionWatch('DRAFT', 'LIVE')).toBe(true); // guardrail auto-approval path
    expect(canTransitionWatch('REJECTED', 'PENDING_REVIEW')).toBe(false);
    expect(canTransitionWatch('COMPLETED', 'LIVE')).toBe(false);
    expect(canTransitionWatch('CANCELLED', 'PAUSED')).toBe(false);
    expect(canTransitionWatch('PENDING_REVIEW', 'PAUSED')).toBe(false);
  });
});

describe('customer reason classes never reveal detection logic', () => {
  it('maps every internal reason to a plain class', () => {
    expect(reasonClassOf('BACKGROUND_TIMEOUT')).toBe('LEFT_APP');
    expect(reasonClassOf('NOT_COMPLETED')).toBe('SKIPPED');
    expect(reasonClassOf('STILL_WATCHING_FAILED')).toBe('NO_RESPONSE');
    expect(reasonClassOf('DEVICE_LIMIT')).toBe('DAILY_CAP');
    expect(reasonClassOf('RISK_BLOCKED')).toBe('OTHER');
    expect(reasonClassOf('FRAUD_REVERSED')).toBe('OTHER');
    expect(reasonClassOf('TIMELINE_MISMATCH')).toBe('OTHER');
    expect(reasonClassOf(null)).toBe('OTHER');
  });
});

describe('campaign content rules', () => {
  it("has no reward field at all (the reward is DealDash's alone)", () => {
    expect(Object.keys(emptyWatchContent())).not.toEqual(expect.arrayContaining(['rewardPoints']));
    const parsed = watchContentSchema.parse({ ...valid(), rewardPoints: 999 } as never);
    expect('rewardPoints' in parsed).toBe(false);
  });
  it('a complete bilingual campaign has no issues; each gap is named', () => {
    const now = new Date('2029-12-01T00:00:00Z');
    expect(watchIssues(valid(), { now })).toEqual([]);
    const bad = {
      ...valid(),
      title: { en: 'T', ar: '' },
      paidViews: 3,
      durationSec: 300,
      videoFileId: null,
    };
    const codes = watchIssues(bad, { now }).map((i) => `${i.field}:${i.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        'title:REQUIRED_AR',
        'paidViews:VIEWS_RANGE',
        'durationSec:DURATION_RANGE',
        'videoFileId:REQUIRED',
      ]),
    );
  });
  it('a campaign longer than the platform maximum is refused, and an end in the past is flagged', () => {
    const long = { ...valid(), endAt: '2031-01-01T00:00:00.000Z' };
    expect(watchIssues(long).map((i) => i.code)).toContain('PERIOD_TOO_LONG');
    expect(watchIssues(valid(), { now: new Date('2031-01-01') }).map((i) => i.code)).toContain(
      'IN_PAST',
    );
  });
  it('the merchant may be stricter than the platform repeat window but never looser', () => {
    const opts = { minRepeatWindowHours: 24 };
    expect(
      watchIssues({ ...valid(), frequency: { repeatWindowHours: 12 } }, opts).map((i) => i.code),
    ).toContain('FREQUENCY_LOOSER');
    expect(
      watchIssues({ ...valid(), frequency: { repeatWindowHours: 48 } }, opts).map((i) => i.code),
    ).not.toContain('FREQUENCY_LOOSER');
    expect(DEFAULT_WATCH_LIMITS.minPaidViews).toBeGreaterThan(0);
  });
  it('translation status names the missing language', () => {
    expect(watchTranslationStatus(valid())).toEqual({ complete: true, missing: [] });
    expect(watchTranslationStatus({ ...valid(), ctaLabel: { en: 'Go', ar: '' } }).missing).toEqual([
      'ar',
    ]);
  });
  it('material changes are the ones that change what customers see or the merchant pays; wording is minor', () => {
    const a = valid();
    expect(watchMaterialChanges(a, { ...a, title: { en: 'New', ar: 'جديد' } })).toEqual([]);
    expect(watchMaterialChanges(a, { ...a, paidViews: 30 })).toEqual(['paidViews']);
    expect(watchMaterialChanges(a, { ...a, endAt: '2030-03-01T00:00:00.000Z' })).toEqual(['endAt']);
    expect(
      watchMaterialChanges(a, { ...a, targeting: { ...a.targeting, cities: ['Jeddah'] } }),
    ).toEqual(['targeting']);
  });
});

describe('dates and windows (Riyadh has no daylight saving)', () => {
  it('approval is scheduled for the future and live from the start; an ended campaign cannot be approved', () => {
    const now = new Date('2030-01-10T00:00:00Z');
    expect(
      watchStatusAfterApproval(
        new Date('2030-01-20T00:00:00Z'),
        new Date('2030-02-01T00:00:00Z'),
        now,
      ),
    ).toBe('SCHEDULED');
    expect(
      watchStatusAfterApproval(
        new Date('2030-01-01T00:00:00Z'),
        new Date('2030-02-01T00:00:00Z'),
        now,
      ),
    ).toBe('LIVE');
    expect(() => watchStatusAfterApproval(null, new Date('2030-01-05T00:00:00Z'), now)).toThrow();
    expect(watchStatusFromDates(null, new Date('2030-01-05T00:00:00Z'), now)).toBe('EXPIRED');
  });
  it('the Riyadh day boundary is UTC+3', () => {
    const t = new Date('2030-01-10T22:30:00Z'); // 01:30 on the 11th in Riyadh
    expect(startOfRiyadhDay(t).toISOString()).toBe('2030-01-10T21:00:00.000Z');
    expect(nextRiyadhMidnight(t).toISOString()).toBe('2030-01-11T21:00:00.000Z');
  });
  it('a daily serving window uses Riyadh wall-clock hours', () => {
    const w = { startHour: 9, endHour: 17 };
    expect(inTimeWindow(w, new Date('2030-01-10T07:00:00Z'))).toBe(true); // 10:00
    expect(inTimeWindow(w, new Date('2030-01-10T14:00:00Z'))).toBe(false); // 17:00
    expect(inTimeWindow(null, new Date())).toBe(true);
  });
});

describe('reward and qualification rules come from configuration', () => {
  const rule = {
    version: 1,
    tiers: [
      { upToSec: 15, points: 10 },
      { upToSec: 30, points: 20 },
      { upToSec: 600, points: 30 },
    ],
  };
  it('points depend on the video length tier, never on the merchant', () => {
    expect(core.pointsFor(rule, 8)).toBe(10);
    expect(core.pointsFor(rule, 15)).toBe(10);
    expect(core.pointsFor(rule, 16)).toBe(20);
    expect(core.pointsFor(rule, 90)).toBe(30);
    expect(core.pointsFor({ version: 2, tiers: [{ upToSec: 600, points: 7 }] }, 20)).toBe(7);
  });
  it('the required watch time is a configurable percentage (or fixed seconds), never the whole video by hardcode', () => {
    const base = {
      watchPct: 80,
      watchSeconds: null,
      resumeGraceSec: 10,
      heartbeatSec: 2,
      maxSessionFactor: 3,
      stillWatching: {} as never,
    };
    expect(core.requiredSeconds(base, 10)).toBe(8);
    expect(core.requiredSeconds({ ...base, watchPct: 50 }, 11)).toBe(6);
    expect(core.requiredSeconds({ ...base, watchSeconds: 5 }, 30)).toBe(5);
    expect(core.requiredSeconds({ ...base, watchSeconds: 50 }, 30)).toBe(30);
  });
});

describe('tokens and device ids', () => {
  it('view tokens are random and only their hash is stored; the device id is hashed', () => {
    const a = newViewToken();
    expect(a).not.toBe(newViewToken());
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
    expect(hashDevice('device-1')).not.toBe(hashDevice('device-2'));
  });
});

describe('MP4 duration reader', () => {
  const box = (type: string, payload: Buffer) => {
    const b = Buffer.alloc(8 + payload.length);
    b.writeUInt32BE(8 + payload.length, 0);
    b.write(type, 4, 'latin1');
    payload.copy(b, 8);
    return b;
  };
  it('reads seconds from mvhd (version 0)', () => {
    const mvhd = Buffer.alloc(100);
    mvhd.writeUInt32BE(1000, 12); // timescale
    mvhd.writeUInt32BE(12_000, 16); // duration
    const mp4 = Buffer.concat([
      box('ftyp', Buffer.from('isom0000')),
      box('moov', box('mvhd', mvhd)),
    ]);
    expect(mp4DurationSec(mp4)).toBe(12);
  });
  it('returns null for anything else', () => {
    expect(mp4DurationSec(Buffer.from('not a video'))).toBeNull();
    expect(mp4DurationSec(Buffer.alloc(0))).toBeNull();
  });
});
