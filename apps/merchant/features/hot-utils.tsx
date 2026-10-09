'use client';

import { useAuth } from '@dealdash/app-shell';
import { createTranslator, type DictionaryKey } from '@dealdash/localization';
import type { HotDealStatus } from '@dealdash/types';
import { StatusChip, type StatusTone } from '@dealdash/ui';
import { CampaignTypeSwitch } from './voucher-utils';

export const HOT_TONE: Record<HotDealStatus, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  NEEDS_CHANGES: 'warning',
  SCHEDULED: 'info',
  LIVE: 'success',
  PAUSED: 'neutral',
  SOLD_OUT: 'warning',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
};

export function HotStatusChip({ status }: { status: HotDealStatus }) {
  const { locale } = useAuth();
  return (
    <StatusChip tone={HOT_TONE[status]}>
      {createTranslator(locale)(`hotstatus.${status}` as DictionaryKey)}
    </StatusChip>
  );
}

/** Live Deals and Exclusive Deals share the Campaigns area: this switch moves between the two lists. */
export function DealsTypeSwitch({ current }: { current: 'live' | 'hot' }) {
  return <CampaignTypeSwitch current={current} />;
}

/** Which Exclusive Deal builder step a content field belongs to (for "Fix" links). */
export function stepOfHotField(field: string): number {
  if (['categoryId', 'mechanic', 'valueNumber'].includes(field)) return 0;
  if (['offerLabel', 'title', 'shortDescription', 'description', 'media'].includes(field)) return 1;
  if (
    [
      'limitType',
      'reservationsEnabled',
      'startAt',
      'endAt',
      'perCustomerLimit',
      'holdMinutes',
    ].includes(field)
  )
    return 2;
  if (field === 'allocations') return 3;
  if (field === 'eligibility' || field.startsWith('terms')) return 4;
  return 0;
}

/** "SAR" never appears: Exclusive Deals have no prices of their own in the MVP; units are counts. */
export const pct = (v: number | null, none: string) => (v === null ? none : `${v}%`);
