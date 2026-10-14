'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { DealCardView, Icon, categoryIcon, useApi, useAuth } from '@dealdash/app-shell';
import {
  createTranslator,
  stripLocale,
  withLocale,
  type UiLocale as Locale,
} from '@dealdash/localization';
import { Button, EmptyState, ErrorState, Skeleton } from '@dealdash/ui';
import type { DealCard } from '@dealdash/validation';
import { useCustomer, useImpression } from './customer-context';
import { presentCard } from './presentation';

/**
 * The customer's INTERFACE language (English, Arabic or Urdu). Screens pass it to the shared views, routes and formatters; bilingual
 * content is always picked through pickText / pickLocalized (Urdu reads the English content).
 */
export const useT = () => {
  const { uiLocale: locale } = useAuth();
  return { t: createTranslator(locale), locale };
};

export const useHref = () => {
  const { uiLocale: locale } = useAuth();
  return useCallback((path: string) => withLocale(path, locale), [locale]);
};

/** A deal card that records impressions and saves/unsaves (asking guests to sign in first). */
export function TrackedCard({
  deal,
  variant,
  onChange,
  from,
}: {
  deal: DealCard;
  variant: 'carousel' | 'list';
  onChange?: (next: DealCard) => void;
  from?: string;
}) {
  const { uiLocale: locale, status } = useAuth();
  const { call } = useApi();
  const router = useRouter();
  const href = useHref();
  const ref = useImpression(deal.id, deal.nearestBranch?.id);
  const [saved, setSaved] = useState(deal.saved);
  useEffect(() => setSaved(deal.saved), [deal.saved]);
  const toggle = async () => {
    if (status !== 'authenticated') {
      router.push(href('/profile') + '?reason=save');
      return;
    }
    const next = !saved;
    setSaved(next);
    const res = await call(next ? 'POST' : 'DELETE', `/v1/app/saved/live-deals/${deal.id}`, {
      body: next ? {} : undefined,
    });
    if (!res.ok) setSaved(!next);
    else onChange?.({ ...deal, saved: next });
  };
  void from;
  return (
    <DealCardView
      deal={{ ...presentCard(deal), saved }}
      locale={locale}
      variant={variant}
      href={href(`/deals/${deal.id}`)}
      onToggleSave={toggle}
      imageRef={ref}
    />
  );
}

export function SectionHead({
  icon,
  title,
  sub,
  action,
}: {
  icon?: string;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="dd-section__head">
      <div>
        <h2 className="dd-section__title">
          {icon ? (
            <span className="dd-section__icon">
              <Icon name={icon} size={18} />
            </span>
          ) : null}
          {title}
        </h2>
        {sub ? <p className="dd-section__sub">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function CardSkeletons({
  variant = 'list',
  n = 3,
}: {
  variant?: 'list' | 'carousel';
  n?: number;
}) {
  return (
    <div
      className={variant === 'list' ? 'dd-cardgrid' : 'dd-hscroll'}
      aria-hidden="true"
      data-testid="skeletons"
    >
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className="dd-dc"
          style={{ inlineSize: variant === 'carousel' ? 224 : undefined }}
        >
          <Skeleton height={variant === 'carousel' ? 140 : 110} />
          <div style={{ padding: 14, display: 'grid', gap: 8 }}>
            <Skeleton height={16} width="80%" />
            <Skeleton height={12} width="50%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LoadError({ onRetry, home }: { onRetry: () => void; home?: boolean }) {
  const { t, locale } = useT();
  const error = (
    <ErrorState title={t('cust.loadError')} retryLabel={t('cust.retry')} onRetry={onRetry} />
  );
  if (!home) return error;
  // full-screen pages have no tab bar: always offer a way back
  return (
    <div className="dd-stack">
      {error}
      <a className="dd-link dd-state__home" href={withLocale('/', locale)}>
        {t('nav.home')}
      </a>
    </div>
  );
}

export function NoDeals({ cityOff }: { cityOff?: boolean }) {
  const { t } = useT();
  return (
    <EmptyState
      title={cityOff ? t('cust.cityNotLive') : t('cust.noDealsTitle')}
      description={cityOff ? t('cust.cityNotLiveBody') : t('cust.noDealsBody')}
    />
  );
}

/** Bottom sheet that explains and requests the device location (never required). */
export function LocationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const { status, requestLocation, approximate, city, cities, setCity } = useCustomer();
  if (!open) return null;
  const message =
    status === 'finding'
      ? t('loc.finding')
      : status === 'denied'
        ? t('loc.denied')
        : status === 'unavailable'
          ? t('loc.unavailable')
          : approximate
            ? t('loc.usingCity', { city })
            : t('loc.usingMine');
  return (
    <div
      className="dd-sheet-overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dd-sheet" role="dialog" aria-modal="true" aria-label={t('loc.title')}>
        <div className="dd-sheet__head">
          <h2 className="dd-title">{t('loc.title')}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label={t('loc.close')}>
            <Icon name="x" size={18} />
          </Button>
        </div>
        {cities.length > 1 ? (
          <div className="dd-optrow" role="group" aria-label={t('cust.city')}>
            {cities.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`dd-pill ${c.name === city ? 'dd-pill--active' : ''}`}
                aria-pressed={c.name === city}
                onClick={() => setCity(c.name)}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : null}
        <p role="status">{message}</p>
        <Button onClick={requestLocation} loading={status === 'finding'} block>
          <Icon name="pin" size={18} /> {t('loc.useMine')}
        </Button>
        <p className="dd-caption">{t('loc.note')}</p>
        <Button variant="secondary" onClick={onClose} block>
          {t('loc.close')}
        </Button>
      </div>
    </div>
  );
}

export function CityBar() {
  const { t } = useT();
  const { city, approximate } = useCustomer();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="dd-citybar">
        {/* the same slim location line as the Home header */}
        <button
          type="button"
          className="dd-loc"
          onClick={() => setOpen(true)}
          aria-label={t('loc.title')}
        >
          <Icon name="pin" size={16} />
          <span className="dd-loc__city">{city}</span>
          <span className="dd-caption">{approximate ? '' : '•'}</span>
          <svg
            className="dd-loc__caret"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            aria-hidden="true"
          >
            <path
              d="M6 9l6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <LocationSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Location selector built into the customer header on Home (approved customer UI); other screens keep their own city bar. */
export function HeaderCity() {
  const { t } = useT();
  const { city } = useCustomer();
  const [open, setOpen] = useState(false);
  const path = stripLocale(usePathname() ?? '/');
  if (path !== '/') return null;
  return (
    <>
      <button
        type="button"
        className="dd-loc"
        onClick={() => setOpen(true)}
        aria-label={`${t('loc.title')}: ${city}`}
        data-testid="header-city"
      >
        <Icon name="pin" size={16} />
        <span className="dd-loc__city">{city}</span>
        <svg
          className="dd-loc__caret"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
        >
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <LocationSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function SearchBox({ initial = '', autoFocus }: { initial?: string; autoFocus?: boolean }) {
  const { t, locale } = useT();
  const router = useRouter();
  const [q, setQ] = useState(initial);
  useEffect(() => setQ(initial), [initial]);
  return (
    <form
      role="search"
      className="dd-searchbar"
      onSubmit={(e) => {
        e.preventDefault();
        const v = q.trim();
        if (v) router.push(`${withLocale('/search', locale)}?q=${encodeURIComponent(v)}`);
      }}
    >
      <Icon name="search" size={20} />
      <input
        type="text"
        inputMode="search"
        autoComplete="off"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('cust.searchPlaceholder')}
        aria-label={t('cust.searchLabel')}
        maxLength={100}
        enterKeyHint="search"
      />
      {q ? (
        <button type="button" onClick={() => setQ('')} aria-label={t('search.clear')}>
          <Icon name="x" size={16} />
        </button>
      ) : null}
    </form>
  );
}

export { categoryIcon };
export type { Locale };
