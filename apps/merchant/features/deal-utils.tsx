'use client';

import { useAuth } from '@dealdash/app-shell';
import { createTranslator, formatDateTime } from '@dealdash/localization';
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

/** Riyadh wall-clock text for <input type="datetime-local"> from an ISO instant. */
export function toRiyadhInput(iso: string | null): string {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
  return parts.replace(' ', 'T');
}

/** ISO instant from a Riyadh wall-clock "YYYY-MM-DDTHH:mm" (Saudi Arabia has no daylight saving: always +03:00). */
export function fromRiyadhInput(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00+03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
