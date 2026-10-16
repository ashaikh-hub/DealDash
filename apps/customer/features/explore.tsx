'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Icon, categoryIcon, formatDistance, pickText, useApi, useAuth } from '@dealdash/app-shell';
import { withLocale } from '@dealdash/localization';
import { Button, EmptyState } from '@dealdash/ui';
import type { BrandCard, DealCard, HotDealCard, VoucherCard } from '@dealdash/validation';
import { useCustomer } from './customer-context';
import { TrackedHotCard } from './hot';
import { DealsMap } from './map';
import {
  CardSkeletons,
  CityBar,
  LoadError,
  NoDeals,
  SearchBox,
  TrackedCard,
  useHref,
  useT,
} from './parts';
import { useDealList } from './use-deals';
import { TrackedVoucherCard } from './vouchers';

interface Cat {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
}
const SORTS = ['nearest', 'newest', 'ending_soon'] as const;
const RADII = [1, 3, 5, 10, 20];

export function ExplorePage() {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const { city, coords, approximate } = useCustomer();
  const params = useSearchParams();
  const router = useRouter();
  const [cats, setCats] = useState<Cat[]>([]);
  const [filters, setFilters] = useState(false);

  const category = params.get('category') ?? '';
  const sort =
    (params.get('sort') as (typeof SORTS)[number] | null) ?? (approximate ? 'newest' : 'nearest');
  const radiusKm = params.get('radius') ?? '';
  const elig = params.get('eligibility') === 'unlocked' ? 'unlocked' : 'all';
  const view = params.get('view') === 'map' ? 'map' : 'list';
  const { mapConfig } = useCustomer();

  useEffect(() => {
    void call<Cat[]>('GET', '/v1/app/categories').then((r) => r.ok && setCats(r.data ?? []));
  }, [call]);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${withLocale('/explore', locale)}${next.toString() ? `?${next}` : ''}`);
  };

  const list = useDealList('/v1/app/deals', {
    city,
    category: category || undefined,
    sort,
    eligibility: elig,
    lat: approximate ? undefined : coords.lat,
    lng: approximate ? undefined : coords.lng,
    radiusMeters: radiusKm && !approximate ? Number(radiusKm) * 1000 : undefined,
    // the map shows a fuller set at once; the list pages
    limit: view === 'map' ? 50 : 12,
  });
  void status;
  const activeFilters =
    (radiusKm ? 1 : 0) +
    (elig === 'unlocked' ? 1 : 0) +
    (sort !== 'nearest' && sort !== 'newest' ? 1 : 0);

  const by = (['card', 'employer', 'brand'] as const).find((b) => b === params.get('by')) ?? 'all';
  const browse = (
    <div>
      <h2 className="dd-label" style={{ marginBlockEnd: 6 }}>
        {t('cx.browse.title')}
      </h2>
      <div
        className="dd-browse"
        role="group"
        aria-label={t('cx.browse.title')}
        data-testid="browse-by"
      >
        {(['all', 'card', 'employer', 'brand'] as const).map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={by === b}
            onClick={() => set({ by: b === 'all' ? null : b })}
            data-testid={`browse-${b}`}
          >
            {t(`cx.browse.${b}` as never)}
          </button>
        ))}
      </div>
    </div>
  );
  if (by !== 'all')
    return (
      <div className="dd-stack" style={{ gap: 14 }} data-testid="customer-explore">
        <CityBar />
        <h1 className="dd-title-xl">{t('cust.explore.title')}</h1>
        {browse}
        {by === 'brand' ? <BrandGrid /> : <BySource source={by} />}
      </div>
    );

  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="customer-explore">
      <CityBar />
      <h1 className="dd-title-xl">{t('cust.explore.title')}</h1>
      <SearchBox />
      {browse}
      <div className="dd-hscroll" role="tablist" aria-label={t('filter.category')}>
        <Link
          href={`${withLocale('/explore', locale)}${params.get('sort') ? `?sort=${params.get('sort')}` : ''}`}
          className="dd-pill"
          aria-current={!category}
          style={!category ? { background: 'var(--dd-purple)', color: '#fff' } : undefined}
        >
          {t('cust.allDeals')}
        </Link>
        {cats.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`dd-pill ${category === c.code ? 'dd-pill--active' : ''}`}
            aria-pressed={category === c.code}
            onClick={() => set({ category: category === c.code ? null : c.code })}
          >
            <Icon name={categoryIcon(c.code)} size={15} />{' '}
            {pickText({ en: c.nameEn, ar: c.nameAr }, locale)}
          </button>
        ))}
      </div>
      <div className="dd-row" style={{ justifyContent: 'space-between' }}>
        <div className="dd-row" style={{ gap: 8 }}>
          <button type="button" className="dd-pill" onClick={() => setFilters(true)}>
            <Icon name="sliders" size={16} /> {t('filter.open')}
            {activeFilters ? ` (${activeFilters})` : ''}
          </button>
          {/* Customer MVP §16: the "For my benefits" chip (offers the customer's benefits open now) */}
          <button
            type="button"
            className={`dd-pill ${elig === 'unlocked' ? 'dd-pill--active' : ''}`}
            aria-pressed={elig === 'unlocked'}
            onClick={() => set({ eligibility: elig === 'unlocked' ? null : 'unlocked' })}
            data-testid="for-my-benefits"
          >
            {t('explore.forMyBenefits')}
          </button>
        </div>
        <div className="dd-segment" role="group" aria-label={t('map.title')}>
          <button
            type="button"
            aria-pressed={view === 'list'}
            aria-label={t('map.list')}
            onClick={() => set({ view: null })}
          >
            <Icon name="list" size={16} />
          </button>
          <button
            type="button"
            aria-pressed={view === 'map'}
            aria-label={t('map.map')}
            onClick={() => set({ view: 'map' })}
            data-testid="view-map"
          >
            <Icon name="map" size={16} />
          </button>
        </div>
      </div>
      <div className="dd-row" style={{ justifyContent: 'flex-end' }}>
        <label className="dd-caption dd-row" style={{ gap: 6 }}>
          {t('filter.sort')}
          {/* Chrome on iOS tags server-rendered form fields before hydration (see SearchBox) */}
          <select
            suppressHydrationWarning
            className="dd-select"
            style={{ minBlockSize: 36, inlineSize: 'auto' }}
            value={sort}
            onChange={(e) => set({ sort: e.target.value })}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort.${s}` as never)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {list.loading ? (
        <CardSkeletons />
      ) : list.failed ? (
        <LoadError onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        <NoDeals />
      ) : view === 'map' ? (
        <DealsMap
          deals={list.items}
          centre={coords}
          centreIsDevice={!approximate}
          config={mapConfig}
        />
      ) : (
        <div className="dd-cardgrid" aria-live="polite">
          {list.items.map((d: DealCard) => (
            <TrackedCard key={d.id} deal={d} variant="list" onChange={list.patch} />
          ))}
          {list.hasMore ? (
            <Button variant="secondary" loading={list.loadingMore} onClick={list.more} block>
              {t('cust.moreDeals')}
            </Button>
          ) : null}
        </div>
      )}

      {filters ? (
        <div
          className="dd-sheet-overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setFilters(false)}
        >
          <div className="dd-sheet" role="dialog" aria-modal="true" aria-label={t('filter.title')}>
            <div className="dd-sheet__head">
              <h2 className="dd-title">{t('filter.title')}</h2>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('loc.close')}
                onClick={() => setFilters(false)}
              >
                <Icon name="x" size={18} />
              </Button>
            </div>
            <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="dd-label">{t('filter.distance')}</legend>
              <div className="dd-optrow">
                <button
                  type="button"
                  className={`dd-pill ${!radiusKm ? 'dd-pill--active' : ''}`}
                  onClick={() => set({ radius: null })}
                >
                  {t('filter.anyDistance')}
                </button>
                {RADII.map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={approximate}
                    className={`dd-pill ${radiusKm === String(r) ? 'dd-pill--active' : ''}`}
                    onClick={() => set({ radius: String(r) })}
                  >
                    {t('filter.within', { km: r })}
                  </button>
                ))}
              </div>
              {approximate ? <span className="dd-caption">{t('loc.note')}</span> : null}
            </fieldset>
            <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="dd-label">{t('filter.eligibility')}</legend>
              {(['all', 'unlocked'] as const).map((v) => (
                <label key={v} className="dd-checkbox">
                  <input
                    type="radio"
                    name="elig"
                    checked={elig === v}
                    onChange={() => set({ eligibility: v === 'all' ? null : v })}
                  />
                  <span>{t(`filter.eligibility.${v}` as never)}</span>
                </label>
              ))}
            </fieldset>
            <div className="dd-row">
              <Button
                variant="outline"
                onClick={() => set({ radius: null, eligibility: null, category: null, sort: null })}
              >
                {t('filter.reset')}
              </Button>
              <Button onClick={() => setFilters(false)}>{t('filter.apply')}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Offers tied to a card / scheme or to an employer, across the three offer types (the products' own lists, filtered). */
function BySource({ source }: { source: 'card' | 'employer' }) {
  const { t } = useT();
  const href = useHref();
  const { city, coords, approximate } = useCustomer();
  const where = {
    city,
    source,
    lat: approximate ? undefined : coords.lat,
    lng: approximate ? undefined : coords.lng,
  };
  const hot = useDealList<HotDealCard>('/v1/app/hot-deals', { ...where, limit: 10 });
  const live = useDealList('/v1/app/deals', { ...where, limit: 12 });
  const vouchers = useDealList<VoucherCard>('/v1/app/vouchers', { ...where, limit: 10 });
  const loading = hot.loading || live.loading || vouchers.loading;
  const empty = !hot.items.length && !live.items.length && !vouchers.items.length;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid={`by-${source}`}>
      <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
        <span className="dd-caption">
          {source === 'card' ? t('cx.browse.cardHint') : t('cx.browse.employerHint')}
        </span>
        <Link
          className="dd-link"
          href={href(source === 'card' ? '/benefits?add=card' : '/benefits?add=employer')}
        >
          {source === 'card' ? t('cx.browse.addCard') : t('cx.browse.addEmployer')}
        </Link>
      </div>
      {loading ? (
        <CardSkeletons />
      ) : hot.failed || live.failed || vouchers.failed ? (
        <LoadError
          onRetry={() => {
            void hot.reload();
            void live.reload();
            void vouchers.reload();
          }}
        />
      ) : empty ? (
        <EmptyState title={t('cx.browse.none')} />
      ) : (
        <>
          {hot.items.length ? (
            <section className="dd-stack">
              <h2 className="dd-title">{t('cx.browse.hot')}</h2>
              <div className="dd-cardgrid">
                {hot.items.map((d) => (
                  <TrackedHotCard key={d.id} deal={d} variant="list" />
                ))}
              </div>
            </section>
          ) : null}
          {live.items.length ? (
            <section className="dd-stack">
              <h2 className="dd-title">{t('cx.browse.live')}</h2>
              <div className="dd-cardgrid">
                {live.items.map((d: DealCard) => (
                  <TrackedCard key={d.id} deal={d} variant="list" onChange={live.patch} />
                ))}
              </div>
            </section>
          ) : null}
          {vouchers.items.length ? (
            <section className="dd-stack">
              <h2 className="dd-title">{t('cx.browse.vouchers')}</h2>
              <div className="dd-cardgrid">
                {vouchers.items.map((v) => (
                  <TrackedVoucherCard key={v.id} voucher={v} variant="list" />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Merchants with offers the customer can see here, most offers first. */
function BrandGrid() {
  const { t, locale } = useT();
  const { call } = useApi();
  const href = useHref();
  const { city, coords, approximate } = useCustomer();
  const [brands, setBrands] = useState<BrandCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setBrands(null);
    setFailed(false);
    void call<BrandCard[]>('GET', '/v1/app/brands', {
      query: {
        city,
        lat: approximate ? undefined : coords.lat,
        lng: approximate ? undefined : coords.lng,
      },
    }).then((r) => {
      if (!alive) return;
      if (r.ok) setBrands(r.data ?? []);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [call, city, coords.lat, coords.lng, approximate, attempt]);
  if (failed) return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;
  if (!brands) return <CardSkeletons />;
  if (!brands.length) return <EmptyState title={t('cx.browse.none')} />;
  return (
    <div className="dd-brandgrid" data-testid="brand-grid">
      {brands.map((b) => (
        <Link
          key={b.id}
          className="dd-brand"
          href={href(`/merchants/${b.id}`)}
          data-testid="brand-card"
        >
          {b.logoUrl ? (
            <img src={b.logoUrl} alt="" />
          ) : (
            <span className="dd-brand__ph" aria-hidden="true" />
          )}
          <strong>{pickText(b.name, locale)}</strong>
          <span className="dd-caption">{b.category ? pickText(b.category.name, locale) : ''}</span>
          <span className="dd-caption">
            {t('cx.brand.offers', { n: b.offerCount })}
            {b.distanceMeters !== null ? (
              <span className="dd-ltr"> · {formatDistance(locale, b.distanceMeters)}</span>
            ) : null}
          </span>
        </Link>
      ))}
    </div>
  );
}
