'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Icon, categoryIcon, pickText, useApi, useAuth } from '@dealdash/app-shell';
import { formatNumber, type DictionaryKey } from '@dealdash/localization';
import { Skeleton } from '@dealdash/ui';
import type { DealCard, RewardSummary } from '@dealdash/validation';
import { SetupBanner } from './account';
import { EntryGate } from './cx-parts';
import { useCustomer } from './customer-context';
import { RAIL_SIZE, curate, presentCard, shownOn } from './presentation';
import { HotRail } from './hot';
import { VoucherRail } from './vouchers';
import { WatchRail } from './watch';
import {
  CardSkeletons,
  LoadError,
  NoDeals,
  RailEmpty,
  SearchBox,
  SectionHead,
  TrackedCard,
  useHref,
  useT,
} from './parts';

/**
 * Approved customer imagery (brand-free images from the approved UI package, apps/customer/public/brand). Category tiles without a
 * photograph use the category's accent colour and icon. Deal cards always show the MERCHANT's own media: brand imagery is never
 * presented as a merchant's product.
 */
const CATEGORY_ART: Record<string, { img?: string; accent: string }> = {
  dining: { img: '/brand/cat-dining.jpg', accent: '#FFE9DC' },
  cafes: { img: '/brand/cat-cafes.jpg', accent: '#F3E9DF' },
  shopping: { img: '/brand/cat-shopping.jpg', accent: '#FCE7F0' },
  groceries: { img: '/brand/cat-groceries.jpg', accent: '#E7F6EC' },
  electronics: { img: '/brand/cat-electronics.jpg', accent: '#ECEEF5' },
  fashion: { img: '/brand/cat-fashion.jpg', accent: '#EEF0F4' },
  beauty_wellness: { accent: '#FDE6F1' },
  entertainment: { accent: '#FFF1D6' },
  services: { accent: '#E2F4F7' },
  fitness: { accent: '#E2F7EF' },
};

/**
 * Browse Offers By (approved Home, founder direction 2026-10-16): the existing Explore views — all offers, offers for the customer's
 * cards, for their verified employer, or by brand — plus quick links into Explore's existing sorts. Eligibility is decided by the
 * existing Explore screens and the API; nothing is filtered here.
 */
const BROWSE_BY: Array<{ key: 'all' | 'card' | 'employer' | 'brand'; label: DictionaryKey }> = [
  { key: 'all', label: 'cx.browse.all' },
  { key: 'card', label: 'cx.browse.card' },
  { key: 'employer', label: 'cx.browse.employer' },
  { key: 'brand', label: 'cx.browse.brand' },
];
const QUICK: Array<{ key: string; label: DictionaryKey; query: string }> = [
  { key: 'all', label: 'home.browse.allOffers', query: '' },
  { key: 'new', label: 'home.browse.new', query: '?sort=newest' },
  { key: 'ending', label: 'home.browse.ending', query: '?sort=ending_soon' },
];

function BrowseOffersBy() {
  const { t } = useT();
  const href = useHref();
  return (
    <section className="dd-section dd-browseby" data-testid="home-browse-by">
      <SectionHead icon="sliders" title={t('home.browse.title')} sub={t('home.browse.sub')} />
      <nav className="dd-browseby__tabs" aria-label={t('home.browse.title')}>
        {BROWSE_BY.map((b) => (
          <Link
            key={b.key}
            href={href(b.key === 'all' ? '/explore' : `/explore?by=${b.key}`)}
            className={`dd-browseby__tab ${b.key === 'all' ? 'dd-browseby__tab--on' : ''}`}
            aria-current={b.key === 'all' ? 'true' : undefined}
            data-testid={`browse-by-${b.key}`}
          >
            {t(b.label)}
          </Link>
        ))}
      </nav>
      <div className="dd-hscroll dd-browseby__quick">
        {QUICK.map((q) => (
          <Link
            key={q.key}
            href={`${href('/explore')}${q.query}`}
            className={`dd-pill ${q.key === 'all' ? 'dd-pill--active' : ''}`}
            data-testid={`browse-quick-${q.key}`}
          >
            {t(q.label)}
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Points status for signed-in customers (existing rewards summary); an invitation to start earning for guests. */
function RewardsCard() {
  const { t, locale } = useT();
  const href = useHref();
  const { call } = useApi();
  const { status } = useAuth();
  const [summary, setSummary] = useState<RewardSummary | null>(null);
  useEffect(() => {
    if (status !== 'authenticated') return;
    let alive = true;
    void call<RewardSummary>('GET', '/v1/app/rewards').then((r) => {
      // only a real balance is shown (never "NaN points" from an unexpected answer)
      if (alive && r.ok && typeof r.data?.availableBalance === 'number') setSummary(r.data);
    });
    return () => {
      alive = false;
    };
  }, [call, status]);
  if (status === 'loading') return null;
  const signedIn = status === 'authenticated';
  return (
    <section className="dd-rewardcard" data-testid="home-rewards">
      <div className="dd-rewardcard__body">
        <span className="dd-rewardcard__kicker">
          <Icon name="gift" size={16} /> {t('home.rewardsTitle')}
        </span>
        <h2 className="dd-rewardcard__title">
          {signedIn && summary
            ? t('home.rewardsPoints', { points: formatNumber(locale, summary.availableBalance) })
            : t('home.rewardsGuestTitle')}
        </h2>
        {signedIn ? null : <p className="dd-rewardcard__text">{t('home.rewardsGuestBody')}</p>}
      </div>
      <Link className="dd-rewardcard__cta" href={href(signedIn ? '/rewards' : '/watch')}>
        {signedIn ? t('home.rewardsCta') : t('home.rewardsGuestCta')}
      </Link>
    </section>
  );
}

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
  const { city, coords, approximate, cityLabel } = useCustomer();
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

  // a card's state (saved) changes everywhere it appears; the stored record keeps its own title and media
  const patch = (d: DealCard) =>
    setFeed((f) => {
      if (!f) return f;
      const upd = (xs: DealCard[]) =>
        xs.map((x) => (x.id === d.id ? { ...d, title: x.title, imageUrl: x.imageUrl } : x));
      return {
        ...f,
        liveNow: upd(f.liveNow),
        nearYou: upd(f.nearYou),
        endingSoon: upd(f.endingSoon),
      };
    });
  const total = feed
    ? new Set([...feed.liveNow, ...feed.nearYou, ...feed.endingSoon].map((d) => d.id)).size
    : 0;
  // curated Home: ONE Live Deals carousel (near you first, then the city's other live deals), then Ending Soon only for offers
  // not already shown — never the same offer twice on the page (by id, and by merchant + title for duplicated records)
  const principal = feed ? curate([feed.nearYou, feed.liveNow], RAIL_SIZE) : [];
  const ending = feed ? curate([feed.endingSoon], RAIL_SIZE, shownOn(principal)) : [];
  // the merchants' categories (from their offers on this page) give Watch & Earn videos without a thumbnail a matching picture
  const merchantCategories = new Map<string, string>(
    feed
      ? [...feed.liveNow, ...feed.nearYou, ...feed.endingSoon].flatMap((d) =>
          d.category ? [[d.merchantId, d.category.code] as [string, string]] : [],
        )
      : [],
  );

  return (
    <div className="dd-stack dd-home" data-testid="customer-home">
      <EntryGate />
      <SearchBox />
      {/* only for a signed-in customer whose profile set-up is unfinished ("Continue setting up") */}
      <SetupBanner />

      {state === 'loading' ? (
        <>
          {/* the loading shape follows the approved Home: the photo hero, then cards (inside the page gutter) */}
          <div className="dd-hero-skeleton" aria-hidden="true">
            <Skeleton height={196} />
          </div>
          <CardSkeletons n={2} />
        </>
      ) : state === 'error' || !feed ? (
        <LoadError onRetry={load} />
      ) : !feed.cityEnabled ? (
        <NoDeals cityOff />
      ) : (
        <>
          {/* approved Home order (founder direction 2026-10-16): search, categories, Browse Offers By, hero, then the products */}
          <section className="dd-section" aria-label={t('cust.shopByCategory')}>
            <SectionHead icon="other" title={t('cust.shopByCategory')} />
            <div className="dd-hscroll dd-cats">
              {feed.categories.map((c) => {
                const art = CATEGORY_ART[c.code];
                return (
                  <Link
                    key={c.id}
                    href={href(`/explore?category=${c.code}`)}
                    className="dd-cat dd-cat--art"
                  >
                    <span
                      className="dd-cat__art"
                      style={{ background: art?.accent ?? 'var(--dd-lilac)' }}
                    >
                      {art?.img ? (
                        <img src={art.img} alt="" />
                      ) : (
                        <Icon name={categoryIcon(c.code)} size={28} />
                      )}
                      {c.dealCount ? (
                        <span
                          className="dd-cat__count"
                          aria-label={t('cust.dealsCount', { count: c.dealCount })}
                        >
                          {formatNumber(locale, c.dealCount)}
                        </span>
                      ) : null}
                    </span>
                    <span className="dd-cat__name">
                      {pickText({ en: c.nameEn, ar: c.nameAr }, locale)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <BrowseOffersBy />

          <div className="dd-hero dd-hero--photo">
            <img className="dd-hero__img" src="/brand/hero-dining.jpg" alt="" />
            <div className="dd-hero__top">
              <span className="dd-hero__place">
                <Icon name="pin" size={14} />{' '}
                {t('home.heroKicker', { city: cityLabel(feed.city, locale) })}
              </span>
              {total ? (
                <span className="dd-hero__live">
                  <span className="dd-hero__pulse" aria-hidden="true" />
                  {t('home.heroLive')} · {formatNumber(locale, total)}
                </span>
              ) : null}
            </div>
            {/* the page's main heading (one h1 per page: Stage 9 accessibility) */}
            <h1>{t('home.heroTitle')}</h1>
            <p>{t('home.heroBody')}</p>
            <Link className="dd-hero__cta" href={href('/explore')}>
              {t('home.heroCta')} <Icon name="forward" size={16} />
            </Link>
          </div>

          {/* the products in the approved order: Live Deals, Exclusive Deals, Watch & Earn, Vouchers, Rewards, then Ending Soon.
              Every product section is always presented; one with nothing right now shows a short note and See all. */}
          <section className="dd-section" data-testid="home-live-deals">
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
            {principal.length ? (
              // compact carousel: up to five offers, the next one peeking, the rest behind See all
              <div className="dd-hscroll dd-rail" data-testid="home-live-items">
                {principal.map((d) => (
                  <TrackedCard
                    key={d.id}
                    deal={presentCard(d)}
                    variant="carousel"
                    onChange={patch}
                  />
                ))}
              </div>
            ) : (
              <RailEmpty
                icon="tag"
                text={t('home.empty.live')}
                href={href('/explore')}
                cta={t('cust.seeAll')}
                testId="home-live-empty"
              />
            )}
          </section>

          <HotRail />
          <WatchRail categories={merchantCategories} />
          <VoucherRail />
          <RewardsCard />

          {ending.length ? (
            <section className="dd-section" data-testid="home-ending-soon">
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
              <div className="dd-hscroll dd-rail">
                {ending.map((d) => (
                  <TrackedCard
                    key={d.id}
                    deal={presentCard(d)}
                    variant="carousel"
                    onChange={patch}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
