'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon, categoryIcon, pickText, useApi } from '@dealdash/app-shell';
import { formatNumber } from '@dealdash/localization';
import type { DealCard } from '@dealdash/validation';
import { useCustomer } from './customer-context';
import { HotRail } from './hot';
import { VoucherRail } from './vouchers';
import { WatchRail } from './watch';
import {
  CardSkeletons,
  CityBar,
  LoadError,
  NoDeals,
  SearchBox,
  SectionHead,
  TrackedCard,
  useHref,
  useT,
} from './parts';

interface Category {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  dealCount: number;
}
interface HomeFeed {
  city: string;
  cityEnabled: boolean;
  categories: Category[];
  liveNow: DealCard[];
  nearYou: DealCard[];
  endingSoon: DealCard[];
}

export function HomePage() {
  const { t, locale } = useT();
  const { call } = useApi();
  const href = useHref();
  const { city, coords, approximate } = useCustomer();
  const [feed, setFeed] = useState<HomeFeed | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    const res = await call<HomeFeed>('GET', '/v1/app/home', {
      query: {
        city,
        lat: approximate ? undefined : coords.lat,
        lng: approximate ? undefined : coords.lng,
      },
    });
    if (res.ok && res.data) {
      setFeed(res.data);
      setState('ready');
    } else setState('error');
  }, [call, city, coords.lat, coords.lng, approximate]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (key: 'liveNow' | 'nearYou' | 'endingSoon') => (d: DealCard) =>
    setFeed((f) => (f ? { ...f, [key]: f[key].map((x) => (x.id === d.id ? d : x)) } : f));
  const total = feed
    ? new Set([...feed.liveNow, ...feed.nearYou, ...feed.endingSoon].map((d) => d.id)).size
    : 0;

  return (
    <div className="dd-stack" style={{ gap: 20 }} data-testid="customer-home">
      <CityBar />
      <SearchBox />

      {state === 'loading' ? (
        <>
          <CardSkeletons variant="carousel" />
          <CardSkeletons />
        </>
      ) : state === 'error' || !feed ? (
        <LoadError onRetry={load} />
      ) : !feed.cityEnabled ? (
        <NoDeals cityOff />
      ) : (
        <>
          <div className="dd-hero">
            <span className="dd-hero__chip">
              <span className="dd-dc__dot" aria-hidden="true" /> {t('cust.liveBadge')}
            </span>
            <h2>{t('cust.explore.sub', { city: feed.city })}</h2>
            <p>
              {total
                ? t('cust.dealsCount', { count: formatNumber(locale, total) })
                : t('cust.tagline')}
            </p>
          </div>

          <section className="dd-section" aria-label={t('cust.shopByCategory')}>
            <SectionHead icon="other" title={t('cust.shopByCategory')} />
            <div className="dd-hscroll">
              {feed.categories.map((c) => (
                <Link key={c.id} href={href(`/explore?category=${c.code}`)} className="dd-cat">
                  <span className="dd-cat__icon">
                    <Icon name={categoryIcon(c.code)} size={22} />
                  </span>
                  <span>{pickText({ en: c.nameEn, ar: c.nameAr }, locale)}</span>
                  {c.dealCount ? (
                    <span
                      className="dd-cat__count"
                      aria-label={t('cust.dealsCount', { count: c.dealCount })}
                    >
                      {formatNumber(locale, c.dealCount)}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>

          <HotRail />
          <VoucherRail />
          <WatchRail />

          {feed.liveNow.length === 0 && feed.nearYou.length === 0 ? (
            <NoDeals />
          ) : (
            <>
              {feed.liveNow.length ? (
                <section className="dd-section">
                  <SectionHead
                    icon="tag"
                    title={t('cust.liveOffers')}
                    sub={t('cust.happeningNow')}
                    action={
                      <Link className="dd-link" href={href('/explore?sort=newest')}>
                        {t('cust.seeAll')}
                      </Link>
                    }
                  />
                  <div className="dd-hscroll">
                    {feed.liveNow.map((d) => (
                      <TrackedCard
                        key={d.id}
                        deal={d}
                        variant="carousel"
                        onChange={patch('liveNow')}
                      />
                    ))}
                  </div>
                </section>
              ) : null}

              {feed.nearYou.length ? (
                <section className="dd-section">
                  <SectionHead
                    icon="pin"
                    title={t('cust.nearYou')}
                    sub={t('cust.nearYouSub')}
                    action={
                      <Link className="dd-link" href={href('/explore?sort=nearest')}>
                        {t('cust.seeAll')}
                      </Link>
                    }
                  />
                  <div className="dd-cardgrid">
                    {feed.nearYou.slice(0, 5).map((d) => (
                      <TrackedCard key={d.id} deal={d} variant="list" onChange={patch('nearYou')} />
                    ))}
                  </div>
                </section>
              ) : null}

              {feed.endingSoon.length ? (
                <section className="dd-section">
                  <SectionHead
                    icon="clock"
                    title={t('cust.endingSoon')}
                    sub={t('cust.endingSoonSub')}
                    action={
                      <Link className="dd-link" href={href('/explore?sort=ending_soon')}>
                        {t('cust.seeAll')}
                      </Link>
                    }
                  />
                  <div className="dd-hscroll">
                    {feed.endingSoon.map((d) => (
                      <TrackedCard
                        key={d.id}
                        deal={d}
                        variant="carousel"
                        onChange={patch('endingSoon')}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
