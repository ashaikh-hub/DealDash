/**
 * Launch readiness: calendar arithmetic in a MARKET's business time zone (Market / Country Configuration), for any IANA zone —
 * never a fixed country offset. Built on Intl so daylight-saving changes are handled (current DealDash markets have no DST, but
 * the platform must stay correct where it applies). Timestamps stay canonical UTC instants; only day boundaries and wall-clock
 * hours are computed in the zone.
 */

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of instant `t` in `timeZone`. */
export function localParts(t: Date, timeZone: string): LocalParts {
  const p = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(t)
      .map((x) => [x.type, x.value]),
  );
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset of `timeZone` from UTC at instant `t`, in milliseconds (e.g. +5 h for Asia/Karachi). */
export function zoneOffsetMs(t: Date, timeZone: string): number {
  const p = localParts(t, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(t.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall-clock time y-m-d h:00 occurs in `timeZone` (DST-safe: re-checks the offset). */
function zonedInstant(year: number, month: number, day: number, hour: number, timeZone: string) {
  const naive = Date.UTC(year, month - 1, day, hour);
  let at = naive - zoneOffsetMs(new Date(naive), timeZone);
  at = naive - zoneOffsetMs(new Date(at), timeZone);
  return new Date(at);
}

/** Start (00:00) of the local calendar day containing `t` in `timeZone`. */
export function startOfDayIn(t: Date, timeZone: string): Date {
  const p = localParts(t, timeZone);
  return zonedInstant(p.year, p.month, p.day, 0, timeZone);
}

/** The next local midnight after `t` (days can be 23 or 25 hours long where DST applies). */
export function nextMidnightIn(t: Date, timeZone: string): Date {
  const p = localParts(t, timeZone);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  return zonedInstant(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    0,
    timeZone,
  );
}

/** End of the local calendar day containing `t` (inclusive: 23:59:59.999 local). */
export function endOfDayIn(t: Date, timeZone: string): Date {
  return new Date(nextMidnightIn(t, timeZone).getTime() - 1);
}

/** End of the local day that is `days` whole calendar days after the local day of `t` (validity "N days from purchase"). */
export function endOfDayAfter(t: Date, days: number, timeZone: string): Date {
  const p = localParts(t, timeZone);
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return endOfDayIn(
    zonedInstant(
      target.getUTCFullYear(),
      target.getUTCMonth() + 1,
      target.getUTCDate(),
      12,
      timeZone,
    ),
    timeZone,
  );
}

/** Local wall-clock hour (0-23) of `t` in `timeZone`. */
export const hourIn = (t: Date, timeZone: string): number => localParts(t, timeZone).hour;

/** Local calendar date (YYYY-MM-DD) of `t` in `timeZone`. */
export function localDateIn(t: Date, timeZone: string): string {
  const p = localParts(t, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Is this a time zone the runtime knows (validated before a market is saved)? */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}
