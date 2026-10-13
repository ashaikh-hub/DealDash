'use client';

import { useAuth } from '@dealdash/app-shell';
import {
  createTranslator,
  displayTimeZone,
  formatDateTime,
  localParts,
  zoneOffsetMs,
} from '@dealdash/localization';
import type { LiveDealStatus } from '@dealdash/types';
import { StatusChip, type StatusTone } from '@dealdash/ui';

export const useOrgId = () => useAuth().me?.activeMembership?.organizationId ?? null;

export const STATUS_TONE: Record<LiveDealStatus, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  NEEDS_CHANGES: 'warning',
  SCHEDULED: 'info',
  LIVE: 'success',
  PAUSED: 'neutral',
  EXPIRED: 'neutral',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
};

export function DealStatusChip({ status }: { status: LiveDealStatus }) {
  const { locale } = useAuth();
  return (
    <StatusChip tone={STATUS_TONE[status]}>
      {createTranslator(locale)(`dealStatus.${status}` as never)}
    </StatusChip>
  );
}

/**
 * Wall-clock text for <input type="datetime-local"> from an ISO instant, in the business's market time zone (Market / Country
 * Configuration via the session's display market) — a Pakistani merchant edits Karachi time, a Saudi merchant Riyadh time.
 */
export function toMarketInput(iso: string | null, timeZone?: string | null): string {
  if (!iso) return '';
  const p = localParts(new Date(iso), displayTimeZone(timeZone));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** ISO instant from a market wall-clock "YYYY-MM-DDTHH:mm" (DST-safe: the zone's offset at that moment, checked twice). */
export function fromMarketInput(local: string, timeZone?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const tz = displayTimeZone(timeZone);
  const naive = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  if (Number.isNaN(naive)) return null;
  let at = naive - zoneOffsetMs(new Date(naive), tz);
  at = naive - zoneOffsetMs(new Date(at), tz);
  return new Date(at).toISOString();
}

export const when = (locale: 'en' | 'ar', iso: string | null) =>
  iso ? formatDateTime(locale, iso) : '';

/** Which builder step a content field belongs to (for "Fix" links). */
export function stepOfField(field: string): number {
  if (
    [
      'categoryId',
      'mechanic',
      'valueNumber',
      'offerLabel',
      'title',
      'shortDescription',
      'description',
    ].includes(field)
  )
    return 0;
  if (['branchIds', 'startAt', 'endAt'].includes(field)) return 1;
  if (field === 'eligibility' || field.startsWith('terms')) return 2;
  if (field === 'media') return 3;
  return 0;
}
