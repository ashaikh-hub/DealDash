import {
  liveDealContentSchema,
  type LiveDealContent,
  type LiveDealContentInput,
} from '@dealdash/validation';
import {
  LIVE_DEAL_APPROVED_STATUSES,
  type LiveDealStatus,
  type UnlockAction,
} from '@dealdash/types';
import { AppError } from '../common/errors';

/** Parses stored or submitted content into the canonical shape (defaults filled in). */
export const parseContent = (raw: unknown): LiveDealContent =>
  liveDealContentSchema.parse((raw ?? {}) as LiveDealContentInput);

/**
 * Query columns derived from `content`. This is the ONLY place that maps content to columns, so the two can never
 * drift apart (content stays authoritative).
 */
export function denormalize(c: LiveDealContent) {
  return {
    categoryId: c.categoryId,
    mechanic: c.mechanic,
    titleEn: c.title.en,
    titleAr: c.title.ar,
    startAt: c.startAt ? new Date(c.startAt) : null,
    endAt: c.endAt ? new Date(c.endAt) : null,
    eligibilityKind: c.eligibility.kind,
    redemptionMode: c.redemptionMode,
  };
}

/** Status a deal takes when it becomes approved: scheduled for the future, live from its start time. */
export function statusAfterApproval(
  startAt: Date | null,
  endAt: Date | null,
  now: Date,
): 'SCHEDULED' | 'LIVE' {
  if (endAt && endAt.getTime() <= now.getTime())
    throw new AppError('INVALID_STATE', 'The end date has already passed', 422, 'endAt');
  return startAt && startAt.getTime() > now.getTime() ? 'SCHEDULED' : 'LIVE';
}

/** The status a paused or reinstated deal returns to, derived from its dates. */
export function statusFromDates(
  startAt: Date | null,
  endAt: Date | null,
  now: Date,
): 'SCHEDULED' | 'LIVE' | 'EXPIRED' {
  if (endAt && endAt.getTime() <= now.getTime()) return 'EXPIRED';
  return startAt && startAt.getTime() > now.getTime() ? 'SCHEDULED' : 'LIVE';
}

export const isApprovedStatus = (s: LiveDealStatus) => LIVE_DEAL_APPROVED_STATUSES.includes(s);

export interface Reason {
  en: string;
  ar: string;
}

/** Customer-facing explanation for a locked deal (bilingual; final Arabic copy needs native review). */
export const UNLOCK_COPY: Record<UnlockAction, Reason> = {
  SIGN_IN: {
    en: 'Sign in to check if you can unlock this offer',
    ar: 'سجّل الدخول لمعرفة ما إذا كان بإمكانك فتح هذا العرض',
  },
  VERIFY_EMPLOYER: { en: 'Verify your employer to unlock', ar: 'وثّق جهة عملك لفتح العرض' },
  ADD_BANK_BENEFIT: { en: 'Add your bank benefits to unlock', ar: 'أضف مزايا بنكك لفتح العرض' },
  JOIN_SCHEME: { en: 'Add your membership to unlock', ar: 'أضف عضويتك لفتح العرض' },
};
