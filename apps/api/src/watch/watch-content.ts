import { createHash, randomBytes } from 'node:crypto';
import { watchContentSchema, type WatchContent } from '@dealdash/validation';
import { AppError } from '../common/errors';

const RIYADH_OFFSET_MS = 3 * 3_600_000; // Saudi Arabia has no daylight saving time.

/** Parses stored or submitted content into the canonical shape (defaults filled in). */
export const parseWatchContent = (raw: unknown): WatchContent =>
  watchContentSchema.parse((raw ?? {}) as Record<string, unknown>);

/** Query columns derived from `content`. The ONLY place that maps content to columns, so the two can never drift apart. */
export function denormalizeWatch(c: WatchContent) {
  return {
    titleEn: c.title.en,
    titleAr: c.title.ar,
    videoFileId: c.videoFileId,
    thumbnailFileId: c.thumbnailFileId,
    durationSec: c.durationSec,
    startAt: c.startAt ? new Date(c.startAt) : null,
    endAt: c.endAt ? new Date(c.endAt) : null,
    cities: c.targeting.cities,
    eligibilityKind: c.targeting.eligibility.kind,
    paidViews: c.paidViews,
  };
}

/** Status an approved campaign takes: scheduled for the future, live from its start time. */
export function watchStatusAfterApproval(
  startAt: Date | null,
  endAt: Date | null,
  now: Date,
): 'SCHEDULED' | 'LIVE' {
  if (endAt && endAt.getTime() <= now.getTime())
    throw new AppError('INVALID_STATE', 'The campaign end date has already passed', 422, 'endAt');
  return startAt && startAt.getTime() > now.getTime() ? 'SCHEDULED' : 'LIVE';
}

/** The status a resumed or reinstated campaign returns to, from its dates. */
export function watchStatusFromDates(
  startAt: Date | null,
  endAt: Date | null,
  now: Date,
): 'SCHEDULED' | 'LIVE' | 'EXPIRED' {
  if (endAt && endAt.getTime() <= now.getTime()) return 'EXPIRED';
  return startAt && startAt.getTime() > now.getTime() ? 'SCHEDULED' : 'LIVE';
}

/** Start of the Riyadh calendar day containing `t`. */
export function startOfRiyadhDay(t: Date): Date {
  const local = t.getTime() + RIYADH_OFFSET_MS;
  return new Date(Math.floor(local / 86_400_000) * 86_400_000 - RIYADH_OFFSET_MS);
}
export const nextRiyadhMidnight = (t: Date): Date =>
  new Date(startOfRiyadhDay(t).getTime() + 86_400_000);

/** Riyadh wall-clock hour (0-23) of `t`. */
export const riyadhHour = (t: Date): number =>
  new Date(t.getTime() + RIYADH_OFFSET_MS).getUTCHours();

/** Is `t` inside the campaign's daily serving window (null = all day)? Windows may not wrap midnight in the MVP. */
export function inTimeWindow(w: { startHour: number; endHour: number } | null, t: Date): boolean {
  if (!w) return true;
  const h = riyadhHour(t);
  return h >= w.startHour && h < w.endHour;
}

// ---------------------------------------------------------------- view tokens (random, stored only as a hash)
export const newViewToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
/** The device id is app-generated and random (no fingerprinting); only its hash is stored. */
export const hashDevice = (deviceId: string): string =>
  createHash('sha256').update(`dd-device:${deviceId}`).digest('hex');
export const newPromptId = (): string => randomBytes(6).toString('hex');

export const newFundingReference = (): string =>
  `WF-${randomBytes(4).toString('hex').toUpperCase()}`;

/**
 * Duration (seconds) from an MP4 `mvhd` box, or null when it cannot be read. Used to cross-check the duration a browser
 * declared at upload (the server's reading wins). WebM keeps the declared value: its duration is optional in the header.
 */
export function mp4DurationSec(data: Buffer): number | null {
  const find = (buf: Buffer, from: number, to: number, type: string): [number, number] | null => {
    let p = from;
    while (p + 8 <= to) {
      let size = buf.readUInt32BE(p);
      const t = buf.subarray(p + 4, p + 8).toString('latin1');
      let header = 8;
      if (size === 1) {
        if (p + 16 > to) return null;
        size = Number(buf.readBigUInt64BE(p + 8));
        header = 16;
      } else if (size === 0) size = to - p;
      if (size < header || p + size > to) return null;
      if (t === type) return [p + header, p + size];
      p += size;
    }
    return null;
  };
  try {
    const moov = find(data, 0, data.length, 'moov');
    if (!moov) return null;
    const mvhd = find(data, moov[0], moov[1], 'mvhd');
    if (!mvhd) return null;
    const v = data[mvhd[0]];
    let timescale: number;
    let duration: number;
    if (v === 1) {
      timescale = data.readUInt32BE(mvhd[0] + 20);
      duration = Number(data.readBigUInt64BE(mvhd[0] + 24));
    } else {
      timescale = data.readUInt32BE(mvhd[0] + 12);
      duration = data.readUInt32BE(mvhd[0] + 16);
    }
    if (!timescale || !duration) return null;
    return Math.round(duration / timescale);
  } catch {
    return null;
  }
}
