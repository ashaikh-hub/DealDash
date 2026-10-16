'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon, LoginPanel, pickText, useApi, useAuth } from '@dealdash/app-shell';
import type { DictionaryKey } from '@dealdash/localization';
import type { BenefitsOverview, ReservationView, WatchCard, WatchHub } from '@dealdash/validation';
import { SocialButtons } from './cx-account';
import { useCustomer } from './customer-context';
import { useHref, useT } from './parts';

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
  const has = rating.average !== null && rating.count > 0;
  return (
    <span className="dd-mp__rating" data-testid="rating">
      {has ? (
        <>
          <strong className="dd-ltr">{rating.average!.toFixed(1)}</strong>
          <Stars value={rating.average!} />
          <span className="dd-caption">({t('cx.m.reviews', { n: rating.count })})</span>
        </>
      ) : (
        <>
          <Icon name="star" size={14} />
          <span className="dd-caption">{t('cx.m.noRating')}</span>
        </>
      )}
    </span>
  );
}

/** Five stars for an average rating (rounded to the nearest whole star; the number beside it is exact). */
export function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span className="dd-stars" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={14} filled={i <= full} />
      ))}
    </span>
  );
}

/**
 * "From <merchant>" (reference deal pages): the merchant's Watch & Earn video, read from the existing Watch & Earn list (no change to
 * Watch & Earn itself). Nothing is shown when the merchant has no video.
 */
export function MerchantVideo({ merchantId }: { merchantId: string }) {
  const { t } = useT();
  const { uiLocale } = useAuth();
  const { call } = useApi();
  const href = useHref();
  const { city } = useCustomer();
  const [video, setVideo] = useState<WatchCard | null>(null);
  useEffect(() => {
    let alive = true;
    void call<WatchHub>('GET', '/v1/app/watch', { query: { city, limit: 50 } }).then((r) => {
      const campaigns = r.ok && Array.isArray(r.data?.campaigns) ? r.data.campaigns : [];
      if (!alive) return;
      setVideo(
        campaigns.find(
          (c) =>
            c.merchantId === merchantId &&
            (c.availability === 'AVAILABLE' || c.availability === 'ALREADY_EARNED'),
        ) ?? null,
      );
    });
    return () => {
      alive = false;
    };
  }, [call, city, merchantId]);
  if (!video) return null;
  const mins = Math.floor(video.durationSec / 60);
  const secs = String(video.durationSec % 60).padStart(2, '0');
  return (
    <Link className="dd-mvideo" href={href(`/watch/${video.id}`)} data-testid="merchant-video">
      {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" loading="lazy" /> : null}
      <span className="dd-mvideo__badge">{t('cx.hot.video')}</span>
      <span className="dd-mvideo__time dd-ltr">
        {mins}:{secs}
      </span>
      <span className="dd-mvideo__play" aria-hidden="true">
        <Icon name="play" size={24} />
      </span>
      <strong>{pickText(video.title, uiLocale)}</strong>
      <span className="dd-caption" style={{ color: 'rgba(255,255,255,0.85)' }}>
        {t('cx.hot.earn', { n: video.rewardPoints })}
      </span>
    </Link>
  );
}

/**
 * For an offer the signed-in customer already qualifies for: which of their own benefits opens it (reference "Verified: Saudi Aramco
 * employee"). Read from My benefits; nothing for guests, public offers or locked offers.
 */
export function useEligibilityNote(
  kind: string | undefined,
  result: string | undefined,
): { title: string; body: string } | null {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const [overview, setOverview] = useState<BenefitsOverview | null>(null);
  const relevant =
    status === 'authenticated' &&
    result === 'ELIGIBLE' &&
    (kind === 'EMPLOYER' || kind === 'BANK_CARD' || kind === 'SCHEME');
  useEffect(() => {
    if (!relevant) return;
    let alive = true;
    void call<BenefitsOverview>('GET', '/v1/app/benefits').then((r) => {
      if (alive && r.ok && r.data) setOverview(r.data);
    });
    return () => {
      alive = false;
    };
  }, [call, relevant]);
  if (!relevant || !overview) return null;
  if (kind === 'EMPLOYER' && overview.employer)
    return {
      title: t('cx.hot.verified', { name: pickText(overview.employer.partner.name, locale) }),
      body: t('cx.hot.verifiedEmployer'),
    };
  if ((kind === 'BANK_CARD' || kind === 'SCHEME') && overview.cards.length === 1)
    return {
      title: t('cx.hot.verified', { name: pickText(overview.cards[0]!.name, locale) }),
      body: t('cx.hot.verifiedCard'),
    };
  return null;
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
  const [phone, setPhone] = useState(false);
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
  // approved welcome (reference "01 Sign in"): photo hero with the wordmark, then the sign-in choices on a sheet
  return (
    <div
      className="dd-entry"
      role="dialog"
      aria-modal="true"
      aria-label={t('cx.entry.welcome')}
      data-testid="entry"
    >
      <div className="dd-entry__brand">
        <span className="dd-entry__wordmark" aria-hidden="true">
          Deal<span>Dash</span>
        </span>
        <p className="dd-entry__tagline">{t('cx.entry.tagline')}</p>
      </div>
      <div className="dd-entry__panel">
        <h1 className="dd-title-xl" style={{ margin: 0 }}>
          {t('cx.entry.welcome')}
        </h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('cx.entry.sub')}
        </p>
        {phone ? (
          <LoginPanel />
        ) : (
          <>
            {/* reference "01 Sign in": Google, Apple, then the phone number */}
            <SocialButtons />
            <span className="dd-entry__or" aria-hidden="true">
              {t('cx.so.or')}
            </span>
            <button
              type="button"
              className="dd-btn dd-btn--outline dd-btn--block dd-entry__choice"
              onClick={() => setPhone(true)}
              data-testid="entry-phone"
            >
              <Icon name="phone" size={18} /> {t('cx.entry.phone')}
            </button>
          </>
        )}
        <button
          type="button"
          className="dd-btn dd-btn--ghost dd-btn--block"
          onClick={skip}
          data-testid="entry-skip"
        >
          {t('cx.entry.skip')}
        </button>
        <p className="dd-caption" style={{ margin: 0 }}>
          {t('cx.entry.guestNote')} {t('cx.entry.terms')}
        </p>
      </div>
    </div>
  );
}
