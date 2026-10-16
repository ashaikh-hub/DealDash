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
import { curate, presentCard } from './presentation';
import { HotRail } from './hot';
import { VoucherRail } from './vouchers';
import { WatchRail } from './watch';
import {
  CardSkeletons,
  LoadError,
  NoDeals,
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

/** The DealDash ecosystem at a glance: every product line, one tap away (existing screens only). */
const ECOSYSTEM: Array<{ key: string; href: string; icon: string; tone: string }> = [
  { key: 'live', href: '/explore', icon: 'tag', tone: 'live' },
  { key: 'exclusive', href: '/hot', icon: 'flame', tone: 'hot' },
  { key: 'vouchers', href: '/vouchers', icon: 'ticket', tone: 'voucher' },
  { key: 'watch', href: '/watch', icon: 'play', tone: 'watch' },
  { key: 'rewards', href: '/rewards', icon: 'gift', tone: 'rewards' },
];

function Ecosystem() {
  const { t } = useT();
  const href = useHref();
  return (
    <nav className="dd-eco" aria-label={t('home.ecosystem')} data-testid="home-ecosystem">
      {ECOSYSTEM.map((e) => (
        <Link key={e.key} href={href(e.href)} className={`dd-eco__item dd-eco__item--${e.tone}`}>
          <span className="dd-eco__icon" aria-hidden="true">
            <Icon name={e.icon} size={20} filled={e.icon === 'play' || e.icon === 'flame'} />
          </span>
          <span className="dd-eco__label">{t(`home.eco.${e.key}` as DictionaryKey)}</span>
          <span className="dd-eco__sub">{t(`home.eco.${e.key}Sub` as DictionaryKey)}</span>
        </Link>
      ))}
    </nav>
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
      if (alive && r.ok && r.data) setSummary(r.data);
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
  // curated Home: ONE Live Deals section (near you first, then the city's other live deals), then Ending Soon only for cards
  // not already shown — never the same card twice on the page
  const principal = feed ? curate([feed.nearYou, feed.liveNow]) : [];
  const ending = feed ? curate([feed.endingSoon], 2, new Set(principal.map((d) => d.id))) : [];

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

          <Ecosystem />

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

          {principal.length ? (
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
              <div className="dd-duo">
                {principal.map((d) => (
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

          <HotRail />
          <WatchRail />
          <RewardsCard />
          <VoucherRail />

          {principal.length === 0 ? <NoDeals /> : null}

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
              <div className="dd-duo">
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
