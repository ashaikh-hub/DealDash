import { useEffect, useMemo, useState } from 'react';
import {
  createTranslator,
  formatNumber,
  type UiLocale as Locale, // the interface language (en / ar / ur)
} from '@dealdash/localization';

/**
 * Countdowns follow the SERVER clock: the API sends `serverNow` with every Exclusive Deal and reservation, and the phone's own
 * clock is only used to tick forward from that moment. A wrong phone clock therefore cannot extend or shorten a hold.
 */
export function useServerOffset(serverNow?: string | null): number {
  return useMemo(() => {
    if (!serverNow) return 0;
    const ms = new Date(serverNow).getTime();
    return Number.isFinite(ms) ? ms - Date.now() : 0;
    // the offset is fixed when the payload arrives
  }, [serverNow]);
}

/** Current server time, ticking every `intervalMs` (default one second). */
export function useServerNow(serverNow?: string | null, intervalMs = 1000): number {
  const offset = useServerOffset(serverNow);
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), intervalMs);
    return () => clearInterval(id);
  }, [offset, intervalMs]);
  return now;
}

/** "2d 4h", "1h 05m", "12m 30s", "45s". Digits stay Latin so times read the same in both languages. */
export function formatRemaining(locale: Locale, ms: number): string {
  const t = createTranslator(locale);
  const n = (v: number, pad = false) =>
    pad ? String(v).padStart(2, '0') : formatNumber(locale, v);
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d >= 1) return t('hot.time.dh', { d: n(d), h: n(h) });
  if (h >= 1) return t('hot.time.hm', { h: n(h), m: n(m, true) });
  if (m >= 1) return t('hot.time.ms', { m: n(m), s: n(s, true) });
  return t('hot.time.s', { s: n(s) });
}

export type CountdownTone = 'calm' | 'soon' | 'urgent' | 'over';

/** Visual urgency: red in the last 5 minutes, amber in the last hour. */
export const countdownTone = (ms: number): CountdownTone =>
  ms <= 0 ? 'over' : ms <= 5 * 60_000 ? 'urgent' : ms <= 3_600_000 ? 'soon' : 'calm';

export function Countdown({
  target,
  serverNow,
  locale,
  label,
  className,
  ended,
}: {
  target: string | null;
  serverNow?: string | null;
  locale: Locale;
  /** Dictionary-resolved text with a `{time}` placeholder, e.g. "Ends in {time}". */
  label?: string;
  className?: string;
  /** Text shown once the time has run out. */
  ended?: string;
}) {
  const now = useServerNow(serverNow);
  const t = createTranslator(locale);
  if (!target) return <span className={className}>{t('hot.noEnd')}</span>;
  const ms = new Date(target).getTime() - now;
  const text = ms <= 0 ? (ended ?? t('hot.ended')) : formatRemaining(locale, ms);
  const shown = ms > 0 && label ? label.replace('{time}', text) : text;
  return (
    <span
      className={['dd-ltr-digits', `dd-cd--${countdownTone(ms)}`, className]
        .filter(Boolean)
        .join(' ')}
      role="timer"
      aria-live="off"
      data-testid="countdown"
    >
      {shown}
    </span>
  );
}
