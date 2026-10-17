'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  DealCardView,
  DealDetailView,
  Icon,
  LoginPanel,
  formatDistance,
  openStatus,
  pickText,
  shareLink,
  useApi,
  useAuth,
  whatsappHref,
} from '@dealdash/app-shell';
import { createTranslator, isolateLtr } from '@dealdash/localization';
import type { UnlockAction } from '@dealdash/types';
import { Button, Card, EmptyState, ErrorState, LoadingState, Skeleton } from '@dealdash/ui';
import type {
  DealCard,
  DealDetail,
  HotDealCard,
  MerchantPage,
  PublicBranch,
  VoucherCard,
  WatchCard,
} from '@dealdash/validation';
import { LanguageCard, SetupBanner } from './account';
import { TrackedWatchCard } from './watch';
import { MerchantReviews } from './care';
import { useCustomer } from './customer-context';
import { SocialButtons } from './cx-account';
import {
  CardOfferPanel,
  MerchantHeroGallery,
  MerchantPhotoGrid,
  PhotoViewer,
  merchantPhotos,
} from './cx-benefits';
import { RatingChip, useRating } from './cx-parts';
import { TrackedHotCard } from './hot';
import { TrackedVoucherCard } from './vouchers';
import {
  CardSkeletons,
  LoadError,
  SearchBox,
  SectionHead,
  TrackedCard,
  safeNext,
  signInPath,
  useHref,
  useT,
} from './parts';
import { presentDetail } from './presentation';

// ------------------------------------------------------------------ search
interface SearchResult {
  query: string;
  deals: DealCard[];
  merchants: Array<{
    id: string;
    name: { en: string; ar: string };
    logoUrl: string | null;
    category: { code: string; name: { en: string; ar: string } } | null;
    dealCount: number;
    distanceMeters: number | null;
  }>;
}

export function SearchPage() {
  const { t, locale } = useT();
  const { call } = useApi();
  const href = useHref();
  const { city, coords, approximate } = useCustomer();
  const q = (useSearchParams().get('q') ?? '').trim();
  const [res, setRes] = useState<SearchResult | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const load = useCallback(async () => {
    if (!q) return setState('idle');
    setState('loading');
    const r = await call<SearchResult>('GET', '/v1/app/search', {
      query: {
        q,
        city,
        limit: 20,
        lat: approximate ? undefined : coords.lat,
        lng: approximate ? undefined : coords.lng,
      },
    });
    if (r.ok && r.data) {
      setRes(r.data);
      setState('ready');
    } else setState('error');
  }, [call, q, city, coords.lat, coords.lng, approximate]);
  useEffect(() => {
    void load();
  }, [load]);

  const empty = state === 'ready' && res && !res.deals.length && !res.merchants.length;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="customer-search">
      <SearchBox initial={q} autoFocus={!q} />
      {state === 'idle' ? <p className="dd-muted">{t('search.hint')}</p> : null}
      {state === 'loading' ? <CardSkeletons /> : null}
      {state === 'error' ? <LoadError onRetry={load} /> : null}
      {empty ? (
        <EmptyState title={t('search.noResults', { q })} description={t('search.noResultsBody')} />
      ) : null}
      {state === 'ready' && res && !empty ? (
        <>
          <h1 className="dd-title">{t('search.results', { q })}</h1>
          {res.merchants.length ? (
            <section className="dd-section">
              <SectionHead title={t('search.merchants')} />
              <div className="dd-stack">
                {res.merchants.map((m) => (
                  <Link
                    key={m.id}
                    href={href(`/merchants/${m.id}`)}
                    className="dd-dd__branch"
                    style={{ textDecoration: 'none', color: 'inherit' }}
                  >
                    {m.logoUrl ? (
                      <img className="dd-logo" src={m.logoUrl} alt="" />
                    ) : (
                      <span className="dd-dd__branchicon">
                        <Icon name="shopping" />
                      </span>
                    )}
                    <div className="dd-grow">
                      <strong>{pickText(m.name, locale)}</strong>
                      <div className="dd-caption">
                        {m.category ? pickText(m.category.name, locale) : ''}
                        {m.distanceMeters !== null
                          ? ` · ${formatDistance(locale, m.distanceMeters)}`
                          : ''}
                      </div>
                    </div>
                    <span className="dd-chip dd-chip--info">
                      {t('cust.dealsCount', { count: m.dealCount })}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          {res.deals.length ? (
            <section className="dd-section">
              <SectionHead title={t('search.deals')} />
              <div className="dd-cardgrid">
                {res.deals.map((d) => (
                  <TrackedCard
                    key={d.id}
                    deal={d}
                    variant="list"
                    onChange={(n) =>
                      setRes((r) =>
                        r ? { ...r, deals: r.deals.map((x) => (x.id === n.id ? n : x)) } : r,
                      )
                    }
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ deal detail
export function DealPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const { city, coords, approximate, track } = useCustomer();
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    const r = await call<DealDetail>('GET', `/v1/app/live-deals/${id}`, {
      query: {
        city,
        lat: approximate ? undefined : coords.lat,
        lng: approximate ? undefined : coords.lng,
      },
    });
    if (r.ok && r.data) {
      setDetail(r.data);
      setState('ready');
    } else setState(r.status === 404 ? 'missing' : 'error');
  }, [call, id, city, coords.lat, coords.lng, approximate]);
  useEffect(() => {
    void load();
  }, [load]);

  const viewed = detail?.id;
  useEffect(() => {
    if (viewed) track({ type: 'DETAIL_VIEW', dealId: viewed, branchId: detail?.nearestBranch?.id });
    // one detail view per opened deal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewed]);

  const back = () => (window.history.length > 1 ? router.back() : router.push(href('/explore')));
  const toggleSave = async () => {
    if (!detail) return;
    if (status !== 'authenticated') return router.push(signInPath(href, 'save'));
    const next = !detail.saved;
    setDetail({ ...detail, saved: next });
    const r = await call(next ? 'POST' : 'DELETE', `/v1/app/saved/live-deals/${detail.id}`, {
      body: next ? {} : undefined,
    });
    if (!r.ok) setDetail({ ...detail, saved: !next });
  };
  const directions = (b: PublicBranch) =>
    track({ type: 'DIRECTIONS_CLICK', dealId: id, branchId: b.id });
  const unlock = (a: UnlockAction) => {
    if (a === 'SIGN_IN') router.push(signInPath(href, 'unlock'));
    // My benefits: verify the employer (work-email code) or add the card / membership the offer needs
    else router.push(href('/benefits') + (a === 'VERIFY_EMPLOYER' ? '?add=employer' : '?add=card'));
  };

  if (state === 'loading')
    return (
      <div className="dd-stack" style={{ margin: -16 }} aria-busy="true">
        <Skeleton height={280} />
        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          <Skeleton height={32} width="50%" />
          <Skeleton height={16} />
          <Skeleton height={16} width="70%" />
        </div>
      </div>
    );
  if (state === 'error') return <LoadError onRetry={load} home />;
  if (state === 'missing' || !detail)
    return (
      <div className="dd-stack">
        <Button variant="ghost" onClick={back}>
          <Icon name="back" size={18} /> {t('cust.back')}
        </Button>
        <EmptyState
          title={t('deal.notFound')}
          description={t('deal.notFoundBody')}
          action={
            <Link className="dd-link" href={href('/explore')}>
              {t('cust.explore.title')}
            </Link>
          }
        />
      </div>
    );
  return (
    <div data-testid="customer-deal">
      <DealDetailView
        detail={presentDetail(detail)}
        locale={locale}
        signedIn={status === 'authenticated'}
        onBack={back}
        onToggleSave={toggleSave}
        onDirections={directions}
        onUnlock={unlock}
        merchantHref={`${href(`/merchants/${detail.merchantId}`)}?from=${detail.id}`}
        benefit={<CardOfferPanel product="live" offerId={detail.id} />}
      />
      <PartnerBenefits dealId={detail.id} city={city} />
    </div>
  );
}

interface PartnerBenefit {
  reference: string;
  partnerNameEn: string;
  partnerNameAr: string;
  labelEn: string;
  labelAr: string;
  termsEn: string;
  termsAr: string;
  result: 'ELIGIBLE' | 'LOCKED_UNLOCKABLE';
}

/** Stage 7: partner extras on a public Live Deal (eligibility from the shared engine). Seeing one is not a redemption. */
function PartnerBenefits({ dealId, city }: { dealId: string; city: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const [rows, setRows] = useState<PartnerBenefit[]>([]);
  useEffect(() => {
    let alive = true;
    void call<PartnerBenefit[]>('GET', `/v1/app/live-deals/${dealId}/partner-benefits`, {
      query: { city },
    }).then((r) => {
      if (alive) setRows(r.ok && Array.isArray(r.data) ? r.data : []);
    });
    return () => {
      alive = false;
    };
  }, [call, dealId, city]);
  if (!rows.length) return null;
  return (
    <section className="dd-card" style={{ margin: '16px 0' }} data-testid="deal-partner-benefits">
      <h2 className="dd-title">{t('pt.ben.customerTitle')}</h2>
      <ul className="dd-list" style={{ margin: 0, paddingInlineStart: 18 }}>
        {rows.map((b) => (
          <li key={b.reference} data-testid={`deal-partner-benefit-${b.result}`}>
            <strong>{locale === 'ar' ? b.labelAr : b.labelEn}</strong> ·{' '}
            {locale === 'ar' ? b.partnerNameAr : b.partnerNameEn}
            <div className="dd-muted">
              {b.result === 'ELIGIBLE' ? t('pt.ben.youQualify') : t('pt.ben.unlock')}
            </div>
            {(locale === 'ar' ? b.termsAr : b.termsEn) ? (
              <div className="dd-muted">{locale === 'ar' ? b.termsAr : b.termsEn}</div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ------------------------------------------------------------------ merchant page
export function MerchantPageView({ id }: { id: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const router = useRouter();
  const href = useHref();
  const from = useSearchParams().get('from') ?? undefined;
  const { city, coords, approximate, track } = useCustomer();
  const [page, setPage] = useState<MerchantPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [tab, setTab] = useState<'offers' | 'info' | 'reviews'>('offers');
  const [viewer, setViewer] = useState<number | null>(null);
  const { status } = useAuth();
  const rating = useRating(page?.id);
  const [hot, setHot] = useState<HotDealCard[]>([]);
  const [vouchers, setVouchers] = useState<VoucherCard[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [following, setFollowing] = useState<{ following: boolean; followers: number } | null>(
    null,
  );
  // every offer type of this merchant together: Exclusive Deals and Vouchers come from their own lists
  useEffect(() => {
    let alive = true;
    const query = {
      city,
      merchantId: id,
      lat: approximate ? undefined : coords.lat,
      lng: approximate ? undefined : coords.lng,
      limit: 20,
    };
    void Promise.all([
      call<HotDealCard[]>('GET', '/v1/app/hot-deals', { query }),
      call<VoucherCard[]>('GET', '/v1/app/vouchers', { query }),
    ]).then(([h, v]) => {
      if (!alive) return;
      setHot(h.ok ? (h.data ?? []) : []);
      setVouchers(v.ok ? (v.data ?? []) : []);
    });
    return () => {
      alive = false;
    };
  }, [call, id, city, coords.lat, coords.lng, approximate]);
  const toggleFollow = async () => {
    if (status !== 'authenticated') {
      router.push(signInPath(href, 'follow'));
      return;
    }
    const now = following?.following ?? page?.following ?? false;
    const r = await call<{ following: boolean; followers: number }>(
      now ? 'DELETE' : 'PUT',
      `/v1/app/merchants/${id}/follow`,
    );
    if (r.ok && r.data) setFollowing(r.data);
  };
  const share = async () => {
    if (!page) return;
    const res = await shareLink({
      title: t('cx.m.shareText', { merchant: pickText(page.name, locale) }),
      url: window.location.href,
    });
    if (res === 'copied') setNote(t('cx.m.copied'));
  };

  const load = useCallback(async () => {
    setState('loading');
    const r = await call<MerchantPage>('GET', `/v1/app/merchants/${id}`, {
      query: {
        city,
        lat: approximate ? undefined : coords.lat,
        lng: approximate ? undefined : coords.lng,
      },
    });
    if (r.ok && r.data) {
      setPage(r.data);
      setState('ready');
    } else setState(r.status === 404 ? 'missing' : 'error');
  }, [call, id, city, coords.lat, coords.lng, approximate]);
  useEffect(() => {
    void load();
  }, [load]);
  const pid = page?.id;
  useEffect(() => {
    if (pid) track({ type: 'MERCHANT_PAGE_VIEW', merchantId: pid, sourceDealId: from });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  const back = () => (window.history.length > 1 ? router.back() : router.push(href('/')));
  if (state === 'loading') return <CardSkeletons />;
  if (state === 'error') return <LoadError onRetry={load} />;
  if (state === 'missing' || !page)
    return (
      <div className="dd-stack">
        <Button variant="ghost" onClick={back}>
          <Icon name="back" size={18} /> {t('cust.back')}
        </Button>
        <EmptyState title={t('merch.notFound')} />
      </div>
    );
  const nearest = page.branches[0] ?? null;
  const st = nearest ? openStatus(nearest.hours) : null;
  const gmaps =
    nearest?.latitude != null && nearest.longitude != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${nearest.latitude},${nearest.longitude}`
      : null;
  const phone = nearest?.phone ?? page.phone;
  // WhatsApp: the business number first (branch numbers are often landlines)
  const wa = whatsappHref(page.phone) ?? whatsappHref(nearest?.phone);
  const follow = following ?? { following: page.following, followers: page.followers };
  const dist = formatDistance(locale, nearest?.distanceMeters ?? null);
  const offerCount = page.deals.length + hot.length + vouchers.length;
  const photos = merchantPhotos(page);
  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="customer-merchant">
      <div className="dd-mp__head">
        {/* reference "Merchant page": the merchant's own photos, swipeable, with a counter */}
        <MerchantHeroGallery photos={photos} onOpen={setViewer} />
        <div className="dd-mp__shade" />
        <button type="button" className="dd-dd__back" onClick={back} aria-label={t('cust.back')}>
          <Icon name="back" size={20} />
        </button>
        <div className="dd-mp__title">
          <h1>{pickText(page.name, locale)}</h1>
          <p style={{ margin: 0, opacity: 0.9 }}>
            {page.category ? pickText(page.category.name, locale) : ''}
            {nearest ? ` · ${pickText(nearest.address, locale)}` : ''}
          </p>
        </div>
      </div>
      <div className="dd-mp__card">
        {/* reference "Merchant page": rating and opening state on the left, Follow on the right, then four actions */}
        <div
          className="dd-row"
          style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}
        >
          <div className="dd-stack" style={{ gap: 4, minInlineSize: 0 }}>
            <div className="dd-mp__meta" data-testid="merchant-meta">
              <RatingChip rating={rating} />
            </div>
            {st ? (
              <span className={st.open ? 'dd-open' : 'dd-closed'}>
                {st.open ? t('merch.openNow') : t('merch.closedNow')}
                {st.next
                  ? ` · ${st.open ? t('merch.closesAt', { time: st.next }) : t('merch.opensAt', { time: st.next })}`
                  : ''}
              </span>
            ) : (
              <span className="dd-muted">{t('deal.hoursUnknown')}</span>
            )}
            <div className="dd-mp__meta">
              {dist ? (
                <span className="dd-ltr">
                  <Icon name="pin" size={13} /> {dist}
                </span>
              ) : null}
              <span data-testid="followers">{t('cx.m.followers', { n: follow.followers })}</span>
            </div>
          </div>
          <button
            type="button"
            className={`dd-btn dd-btn--sm ${follow.following ? 'dd-btn--outline' : 'dd-btn--primary'}`}
            aria-pressed={follow.following}
            onClick={() => void toggleFollow()}
            data-testid="merchant-follow"
            style={{ flex: 'none' }}
          >
            {follow.following ? t('cx.m.following') : t('cx.m.follow')}
          </button>
        </div>
        <div className="dd-mp__actions dd-mp__actions--four">
          <a
            className="dd-mp__action"
            href={phone ? `tel:${phone}` : undefined}
            aria-disabled={!phone}
          >
            <Icon name="phone" /> {t('merch.call')}
          </a>
          <a
            className="dd-mp__action"
            href={wa ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!wa}
            data-testid="merchant-whatsapp"
          >
            <Icon name="chat" /> {t('cx.m.whatsapp')}
          </a>
          <a
            className="dd-mp__action"
            href={gmaps ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!gmaps}
            onClick={() =>
              nearest &&
              track({ type: 'DIRECTIONS_CLICK', dealId: page.deals[0]?.id, branchId: nearest.id })
            }
          >
            <Icon name="pin" /> {t('merch.directions')}
          </a>
          <button
            type="button"
            className="dd-mp__action"
            onClick={() => void share()}
            data-testid="merchant-share"
          >
            <Icon name="share" /> {t('cx.m.share')}
          </button>
        </div>
        {note ? (
          <p className="dd-caption" role="status" style={{ margin: 0 }}>
            {note}
          </p>
        ) : null}
      </div>
      <div className="dd-dd__tabs" role="tablist" style={{ marginInline: 0 }}>
        {(['offers', 'info', 'reviews'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            className="dd-dd__tab"
            onClick={() => setTab(k)}
          >
            {k === 'offers'
              ? t('merch.offers', { n: offerCount })
              : k === 'info'
                ? t('merch.info')
                : t('s8.rev.title')}
          </button>
        ))}
      </div>
      {tab === 'reviews' ? (
        <MerchantReviews merchantId={page.id} />
      ) : tab === 'offers' ? (
        offerCount ? (
          // reference "Merchant page - Offers": one list of every offer type, each card marked with its own type
          <div className="dd-cardgrid" data-testid="merchant-offers">
            {hot.map((d) => (
              <TrackedHotCard key={d.id} deal={d} variant="list" />
            ))}
            {page.deals.map((d) => (
              <TrackedCard
                key={d.id}
                deal={d}
                variant="list"
                onChange={(n) =>
                  setPage((p) =>
                    p ? { ...p, deals: p.deals.map((x) => (x.id === n.id ? n : x)) } : p,
                  )
                }
              />
            ))}
            {vouchers.map((v) => (
              <TrackedVoucherCard key={v.id} voucher={v} variant="list" />
            ))}
          </div>
        ) : (
          <EmptyState title={t('merch.noOffers')} description={t('merch.noOffersBody')} />
        )
      ) : (
        <div className="dd-stack">
          {pickText(page.description as { en: string; ar: string }, locale) ? (
            <Card>
              <h2 className="dd-title">{t('merch.about')}</h2>
              <p>{pickText(page.description as { en: string; ar: string }, locale)}</p>
            </Card>
          ) : null}
          <MerchantPhotoGrid photos={photos} onOpen={setViewer} />
          <h2 className="dd-title">{t('merch.branches')}</h2>
          {page.branches.map((b) => (
            <BranchCard key={b.id} b={b} />
          ))}
          {page.phone ? (
            <Card>
              <strong>{t('merch.contact')}</strong>
              <div className="dd-ltr">{isolateLtr(page.phone)}</div>
            </Card>
          ) : null}
        </div>
      )}
      {viewer !== null && photos.length ? (
        <PhotoViewer photos={photos} start={viewer} onClose={() => setViewer(null)} />
      ) : null}
    </div>
  );
}

function BranchCard({ b }: { b: PublicBranch }) {
  const { uiLocale: locale } = useAuth();
  const t = createTranslator(locale);
  const st = openStatus(b.hours);
  const d = formatDistance(locale, b.distanceMeters);
  return (
    <div className="dd-dd__branch dd-dd__branch--card">
      <div className="dd-grow">
        <strong>{pickText(b.name, locale)}</strong>
        <div className="dd-caption">{pickText(b.address, locale)}</div>
        <div className="dd-caption">
          {st ? (
            <span className={st.open ? 'dd-open' : 'dd-closed'}>
              {st.open ? t('merch.openNow') : t('merch.closedNow')}
            </span>
          ) : (
            t('deal.hoursUnknown')
          )}
          {d ? <span className="dd-ltr"> · {d}</span> : null}
        </div>
      </div>
      {b.latitude != null && b.longitude != null ? (
        <a
          className="dd-btn dd-btn--outline dd-btn--sm"
          target="_blank"
          rel="noopener noreferrer"
          href={`https://www.google.com/maps/dir/?api=1&destination=${b.latitude},${b.longitude}`}
        >
          {t('merch.directions')}
        </a>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ saved
export function SavedPage() {
  const { t } = useT();
  const { status } = useAuth();
  const { call } = useApi();
  const href = useHref();
  const [items, setItems] = useState<DealCard[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async () => {
    if (status !== 'authenticated') return;
    setState('loading');
    const r = await call<DealCard[]>('GET', '/v1/app/saved');
    if (r.ok) {
      setItems(r.data ?? []);
      setState('ready');
    } else setState('error');
  }, [call, status]);
  useEffect(() => {
    void load();
  }, [load]);
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated')
    return (
      <div className="dd-stack">
        <h1 className="dd-title-xl">{t('saved.title')}</h1>
        <EmptyState
          title={t('saved.signIn')}
          action={
            <Link className="dd-btn dd-btn--primary" href={href('/profile')}>
              {t('auth.signIn')}
            </Link>
          }
        />
      </div>
    );
  return (
    <div className="dd-stack" data-testid="customer-saved">
      <h1 className="dd-title-xl">{t('saved.title')}</h1>
      {state === 'loading' ? (
        <CardSkeletons />
      ) : state === 'error' ? (
        <LoadError onRetry={load} />
      ) : items.length === 0 ? (
        <EmptyState title={t('saved.empty')} description={t('saved.emptyBody')} />
      ) : (
        <div className="dd-cardgrid">
          {items.map((d) => (
            <TrackedCard
              key={d.id}
              deal={d}
              variant="list"
              onChange={(n) => !n.saved && setItems((c) => c.filter((x) => x.id !== n.id))}
            />
          ))}
        </div>
      )}
      {/* Watch & Earn favourites (2026-10-17) */}
      <SavedWatch />
    </div>
  );
}

function SavedWatch() {
  const { t } = useT();
  const { call } = useApi();
  const { city } = useCustomer();
  const [items, setItems] = useState<WatchCard[]>([]);
  useEffect(() => {
    let alive = true;
    void call<WatchCard[]>('GET', '/v1/app/saved/watch', { query: { city } }).then((r) => {
      if (alive) setItems(r.ok && Array.isArray(r.data) ? r.data : []);
    });
    return () => {
      alive = false;
    };
  }, [call, city]);
  if (!items.length) return null;
  return (
    <section className="dd-section" data-testid="saved-watch">
      <SectionHead icon="play" title={t('wsave.section')} />
      <div className="dd-wgrid">
        {items.map((c) => (
          <TrackedWatchCard key={c.id} campaign={c} variant="immersive" />
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ profile
export function ProfilePage() {
  const { t, locale } = useT();
  const { status, me, signOut } = useAuth();
  const href = useHref();
  const router = useRouter();
  const params = useSearchParams();
  const reason = params.get('reason');
  const next = safeNext(params.get('next'));
  // guest-to-customer: once signed in, straight back to the deal / merchant the guest was on
  useEffect(() => {
    if (status === 'authenticated' && next) router.replace(next);
  }, [status, next, router]);
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="customer-profile">
      <h1 className="dd-title-xl">{t('profile.title')}</h1>
      {status !== 'authenticated' ? (
        <>
          <p>
            {reason === 'save'
              ? t('deal.saveSignIn')
              : reason === 'earn'
                ? t('wat.signInPrompt')
                : reason === 'reserve'
                  ? t('cx.signin.reserve')
                  : reason === 'follow'
                    ? t('cx.signin.follow')
                    : t('profile.signInPrompt')}
          </p>
          <SocialButtons next={next} />
          <span className="dd-entry__or" aria-hidden="true">
            {t('cx.so.or')}
          </span>
          <LoginPanel />
        </>
      ) : (
        <Card>
          <div className="dd-stack">
            <strong>{me?.displayName}</strong>
            <SetupBanner />
            <Link className="dd-link" href={href('/account')} data-testid="account-link">
              {t('profile.account')}
            </Link>
            <Link className="dd-link" href={href('/my-vouchers')} data-testid="my-vouchers-link">
              {t('wal.title')}
            </Link>
            <Link className="dd-link" href={href('/benefits')} data-testid="my-benefits-link">
              {t('profile.benefits')}
            </Link>
            <Link
              className="dd-link"
              href={href('/employee-pass')}
              data-testid="employee-pass-link"
            >
              {t('cx.menu.pass')}
            </Link>
            <Link
              className="dd-link"
              href={href('/payment-methods')}
              data-testid="payment-methods-link"
            >
              {t('cx.menu.payments')}
            </Link>
            <Link className="dd-link" href={href('/savings')} data-testid="savings-link">
              {t('cx.menu.savings')}
            </Link>
            <Link
              className="dd-link"
              href={`${href('/account')}#notifications`}
              data-testid="notifications-link"
            >
              {t('profile.notifications')}
            </Link>
            <Link className="dd-link" href={`${href('/account')}#privacy`}>
              {t('profile.privacy')}
            </Link>
            <Link className="dd-link" href={href('/saved')}>
              {t('profile.savedDeals')}
            </Link>
            <Link className="dd-link" href={href('/cases')} data-testid="my-cases-link">
              {t('s8.cust.cases')}
            </Link>
            <Link className="dd-link" href={href('/my-data')} data-testid="my-data-link">
              {t('s8.cust.data')}
            </Link>
            <Link className="dd-link" href={href('/assistant')} data-testid="assistant-link">
              {t('ai.agentName.CUSTOMER_BEST_DEAL')}
            </Link>
            <Button variant="outline" onClick={() => void signOut()}>
              {t('auth.signOut')}
            </Button>
          </div>
        </Card>
      )}
      <LanguageCard current={locale} />
      <p className="dd-caption">{t('profile.laterStages')}</p>
      <span hidden>{locale}</span>
    </div>
  );
}

export { ErrorState, DealCardView };
