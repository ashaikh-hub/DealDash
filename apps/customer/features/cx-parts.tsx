'use client';

import { useEffect, useState } from 'react';
import { Icon, LoginPanel, useApi, useAuth } from '@dealdash/app-shell';
import type { DictionaryKey } from '@dealdash/localization';
import type { ReservationView } from '@dealdash/validation';
import { useT } from './parts';

/** A merchant's public review summary (the existing reviews endpoint), for the merchant header and the deal page. */
export function useRating(merchantId: string | null | undefined) {
  const { call } = useApi();
  const [rating, setRating] = useState<{ average: number | null; count: number } | null>(null);
  useEffect(() => {
    if (!merchantId) return;
    let alive = true;
    void call<{ summary: { count: number; average: number | null } }>(
      'GET',
      `/v1/app/merchants/${merchantId}/reviews`,
    ).then((r) => {
      const s = r.ok ? r.data?.summary : undefined;
      if (alive && s) setRating({ average: s.average ?? null, count: s.count ?? 0 });
    });
    return () => {
      alive = false;
    };
  }, [call, merchantId]);
  return rating;
}

export function RatingChip({
  rating,
}: {
  rating: { average: number | null; count: number } | null;
}) {
  const { t } = useT();
  if (!rating) return null;
  return (
    <span className="dd-mp__rating" data-testid="rating">
      <Icon name="star" size={14} filled />
      {rating.average !== null && rating.count > 0 ? (
        <>
          <span className="dd-ltr">{rating.average.toFixed(1)}</span>
          <span className="dd-caption">({t('cx.m.reviews', { n: rating.count })})</span>
        </>
      ) : (
        <span className="dd-caption">{t('cx.m.noRating')}</span>
      )}
    </span>
  );
}

export type CustomerStatus =
  'RESERVED' | 'ACTIVE' | 'USED' | 'EXPIRED' | 'CANCELLED' | 'REFUNDED' | 'PAYMENT_FAILED';

/**
 * My Deals status in the customer's words: waiting for payment = Reserved; confirmed with a live code = Active; cancelled with
 * money returned = Refunded. Derived only from what the server reports (no money logic here).
 */
export function customerStatus(r: ReservationView, now = Date.now()): CustomerStatus {
  switch (r.displayState) {
    case 'PAYMENT_PENDING':
      return 'RESERVED';
    case 'PAYMENT_FAILED':
      return 'PAYMENT_FAILED';
    case 'REDEEMED':
      return 'USED';
    case 'NOT_COMPLETED':
      return 'EXPIRED';
    case 'HELD':
      return new Date(r.expiresAt).getTime() <= now ? 'EXPIRED' : 'ACTIVE';
    default: {
      const s = r.payment?.status;
      return s === 'REFUNDED' || s === 'PARTIALLY_REFUNDED' || s === 'VOIDED'
        ? 'REFUNDED'
        : 'CANCELLED';
    }
  }
}
export const STATUS_TONE: Record<CustomerStatus, string> = {
  RESERVED: 'warning',
  ACTIVE: 'success',
  USED: 'info',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  REFUNDED: 'info',
  PAYMENT_FAILED: 'danger',
};
export const statusKey = (s: CustomerStatus) => `cx.st.${s}` as DictionaryKey;

const ENTRY_KEY = 'dd.entry.seen';
/**
 * First run (guests only): a welcome with phone sign-in and "Skip for now". Skipping keeps the customer a guest who can browse
 * everything; sign-in is asked again only for protected actions (reserve, buy, save, follow). Shown once per device.
 */
export function EntryGate() {
  const { t } = useT();
  const { status } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (status !== 'anonymous') return;
    try {
      if (!localStorage.getItem(ENTRY_KEY)) setOpen(true);
    } catch {
      /* storage blocked: never trap the customer behind the entry screen */
    }
  }, [status]);
  useEffect(() => {
    if (status === 'authenticated') setOpen(false);
  }, [status]);
  const skip = () => {
    try {
      localStorage.setItem(ENTRY_KEY, '1');
    } catch {
      /* ignore */
    }
    setOpen(false);
  };
  if (!open) return null;
  return (
    <div
      className="dd-entry"
      role="dialog"
      aria-modal="true"
      aria-label={t('cx.entry.title')}
      data-testid="entry"
    >
      <div className="dd-entry__brand">
        <strong style={{ fontSize: 30, letterSpacing: '-0.02em' }}>DealDash</strong>
        <h1>{t('cx.entry.title')}</h1>
        <p style={{ margin: 0, opacity: 0.85 }}>{t('cx.entry.body')}</p>
      </div>
      <div className="dd-entry__panel">
        <LoginPanel />
        <button
          type="button"
          className="dd-btn dd-btn--ghost dd-btn--block"
          onClick={skip}
          data-testid="entry-skip"
        >
          {t('cx.entry.skip')}
        </button>
        <p className="dd-caption" style={{ margin: 0, textAlign: 'center' }}>
          {t('cx.entry.guestNote')}
        </p>
      </div>
    </div>
  );
}
