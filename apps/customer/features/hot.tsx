'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Countdown,
  HotCardView,
  HotDetailView,
  Icon,
  ReservationTicket,
  errorMessage,
  useApi,
  useAuth,
  type ReserveOutcome,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  type DictionaryKey,
} from '@dealdash/localization';
import type { UnlockAction } from '@dealdash/types';
import { Alert, Button, EmptyState, LoadingState, Skeleton } from '@dealdash/ui';
import type { HotDealCard, HotDealDetail, ReservationView } from '@dealdash/validation';
import { MerchantReviews } from './care';
import { useCustomer, useImpression } from './customer-context';
import { STATUS_TONE, customerStatus, statusKey, useRating } from './cx-parts';
import { CardSkeletons, CityBar, LoadError, SectionHead, signInPath, useHref, useT } from './parts';
import { curate, presentCard, presentDetail } from './presentation';
import { useDealList } from './use-deals';

// ------------------------------------------------------------------ card with impression tracking
export function TrackedHotCard({
  deal,
  variant,
}: {
  deal: HotDealCard;
  variant: 'carousel' | 'list';
}) {
  const { uiLocale: locale } = useAuth();
  const href = useHref();
  const ref = useImpression(deal.id, deal.nearestBranch?.id, 'HOT');
  return (
    <HotCardView
      deal={presentCard(deal)}
      locale={locale}
      variant={variant}
      href={href(`/hot/${deal.id}`)}
      imageRef={ref}
    />
  );
}

// ------------------------------------------------------------------ home rail
export function HotRail() {
  const { t } = useT();
  const href = useHref();
  const { city, coords, approximate } = useCustomer();
  const list = useDealList<HotDealCard>('/v1/app/hot-deals', {
    city,
    limit: 10,
    lat: approximate ? undefined : coords.lat,
    lng: approximate ? undefined : coords.lng,
  });
  if (list.loading) return <CardSkeletons variant="carousel" n={2} />;
  if (list.failed || list.items.length === 0) return null; // the rail simply is not there when there is nothing hot
  return (
    <section className="dd-section" aria-label={t('hot.nearYou')} data-testid="hot-rail">
      <SectionHead
        icon="flame"
        title={t('hot.nearYou')}
        sub={t('hot.nearYouSub')}
        action={
          <Link className="dd-link" href={href('/hot')}>
            {t('cust.seeAll')}
          </Link>
        }
      />
      {/* curated: two strong cards (one card fills the row), the rest behind See all */}
      <div className="dd-duo">
        {curate([list.items]).map((d) => (
          <TrackedHotCard key={d.id} deal={presentCard(d)} variant="carousel" />
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ list page
const SORTS = ['ending_soon', 'nearest', 'newest'] as const;

export function HotListPage() {
  const { t } = useT();
  const { city, coords, approximate } = useCustomer();
  const [sort, setSort] = useState<(typeof SORTS)[number]>('ending_soon');
  const list = useDealList<HotDealCard>('/v1/app/hot-deals', {
    city,
    sort: sort === 'nearest' && approximate ? 'ending_soon' : sort,
    limit: 12,
    lat: approximate ? undefined : coords.lat,
    lng: approximate ? undefined : coords.lng,
  });
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="hot-list">
      <CityBar />
      <div>
        <h1 className="dd-title-xl">{t('hot.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('hot.sub')}
        </p>
      </div>
      <div className="dd-optrow" role="group" aria-label={t('hot.title')}>
        {SORTS.map((s) => (
          <button
            key={s}
            type="button"
            className={`dd-pill ${sort === s ? 'dd-pill--active' : ''}`}
            aria-pressed={sort === s}
            onClick={() => setSort(s)}
          >
            {t(`hot.sort.${s}` as DictionaryKey)}
          </button>
        ))}
      </div>
      {list.loading ? (
        <CardSkeletons />
      ) : list.failed ? (
        <LoadError onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        <EmptyState title={t('hot.empty')} description={t('hot.emptyBody')} />
      ) : (
        <>
          <div className="dd-cardgrid">
            {list.items.map((d) => (
              <TrackedHotCard key={d.id} deal={d} variant="list" />
            ))}
          </div>
          {list.hasMore ? (
            <Button
              variant="outline"
              block
              onClick={() => void list.more()}
              loading={list.loadingMore}
            >
              {t('cust.moreDeals')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ detail page + the free reservation
export function HotDealPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const { city, coords, approximate, track } = useCustomer();
  const [detail, setDetail] = useState<HotDealDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const rating = useRating(detail?.merchantId);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState('loading');
      const r = await call<HotDealDetail>('GET', `/v1/app/hot-deals/${id}`, {
        query: {
          city,
          lat: approximate ? undefined : coords.lat,
          lng: approximate ? undefined : coords.lng,
        },
      });
      if (r.ok && r.data) {
        setDetail(r.data);
        setState('ready');
      } else if (!quiet) setState(r.status === 404 ? 'missing' : 'error');
    },
    [call, id, city, coords.lat, coords.lng, approximate],
  );
  useEffect(() => {
    void load();
  }, [load, status]);

  // stock and time change while the page is open: refresh quietly
  useEffect(() => {
    const timer = setInterval(() => void load(true), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  const viewed = detail?.id;
  useEffect(() => {
    if (viewed)
      track({
        type: 'DETAIL_VIEW',
        dealId: viewed,
        branchId: detail?.nearestBranch?.id,
        product: 'HOT',
      });
    // one detail view per opened deal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewed]);

  const back = () => (window.history.length > 1 ? router.back() : router.push(href('/hot')));
  const reserve = async (
    branchId: string,
    opts: { acceptTerms: boolean; quantity: number },
  ): Promise<ReserveOutcome> => {
    const r = await call<ReservationView>('POST', `/v1/app/hot-deals/${id}/reservations`, {
      body: {
        branchId,
        quantity: opts.quantity,
        ...(opts.acceptTerms ? { acceptTerms: true, returnUrl: reservationReturnUrl(href) } : {}),
      },
      idempotent: true,
    });
    if (r.ok && r.data) {
      // paid: continue on the provider's payment page; it returns to /reservations/return
      if (r.data.displayState === 'PAYMENT_PENDING' && r.data.payment?.redirectUrl) {
        rememberPaying(r.data.id);
        window.location.assign(r.data.payment.redirectUrl);
        return { error: null };
      }
      router.push(`${href(`/reservations/${r.data.id}`)}?new=1`);
      return { error: null };
    }
    if (r.status === 0) return { error: t('hot.connError') };
    // the numbers on screen are out of date: refresh them behind the message
    void load(true);
    return { error: errorMessage(locale, r.errors) };
  };
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
  if (state === 'error') return <LoadError onRetry={() => void load()} />;
  if (state === 'missing' || !detail)
    return (
      <div className="dd-stack">
        <Button variant="ghost" onClick={back}>
          <Icon name="back" size={18} /> {t('cust.back')}
        </Button>
        <EmptyState
          title={t('hot.unavailable')}
          description={t('hot.unavailableBody')}
          action={
            <Link className="dd-link" href={href('/hot')}>
              {t('hot.seeAll')}
            </Link>
          }
        />
      </div>
    );
  return (
    <div data-testid="customer-hot-deal">
      <HotDetailView
        detail={presentDetail(detail)}
        locale={locale}
        signedIn={status === 'authenticated'}
        onBack={back}
        onReserve={reserve}
        onSignIn={() => router.push(signInPath(href, 'reserve'))}
        onViewReservation={(rid) => router.push(href(`/reservations/${rid}`))}
        onDirections={(branchId) =>
          track({ type: 'DIRECTIONS_CLICK', dealId: id, branchId, product: 'HOT' })
        }
        onUnlock={unlock}
        merchantHref={`${href(`/merchants/${detail.merchantId}`)}`}
        rating={rating}
        reviews={<MerchantReviews merchantId={detail.merchantId} />}
      />
    </div>
  );
}

// ------------------------------------------------------------------ My Deals
interface NotificationItem {
  id: string;
  type:
    | 'RESERVATION_CONFIRMED'
    | 'RESERVATION_EXPIRING'
    | 'RESERVATION_EXPIRED'
    | 'RESERVATION_CANCELLED'
    // reservation commitment (payments, refunds, card holds)
    | 'RESERVATION_PAYMENT_FAILED'
    | 'RESERVATION_REFUND_UPDATED'
    | 'RESERVATION_FORFEITED'
    | 'RESERVATION_HOLD_RELEASED'
    | 'RESERVATION_HOLD_CAPTURED'
    | 'REDEMPTION_SUCCESS'
    | 'PURCHASE_SUCCEEDED'
    | 'PAYMENT_FAILED'
    | 'VOUCHER_ISSUED'
    | 'VOUCHER_EXPIRING'
    | 'REFUND_UPDATED'
    | 'VOUCHER_REDEEMED'
    // Watch & Earn and Stage 8 types the same list can return
    | 'REWARD_EARNED'
    | 'REWARD_HELD'
    | 'REWARD_RELEASED'
    | 'REWARD_REVERSED'
    | 'REWARD_EXPIRING'
    | 'CAMPAIGN_COMPLETED'
    | 'ALERT'
    | 'CASE_UPDATED'
    | 'ACCOUNT_RESTRICTION'
    | 'BENEFIT_UPDATED'
    | 'ACCOUNT_WELCOME';
  data: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

/**
 * One reservation in My Deals: merchant, deal, status in the customer's words, method and amount paid or held, expiry, and the
 * manual code while it can be used (the QR is one tap away on the ticket).
 */
function ReservationRow({ r }: { r: ReservationView }) {
  const { t, locale } = useT();
  const href = useHref();
  const { pick } = usePick();
  const st = customerStatus(r);
  const p = r.payment;
  return (
    <Link
      href={href(`/reservations/${r.id}`)}
      className="dd-staffrow"
      style={{ textDecoration: 'none', color: 'inherit', alignItems: 'flex-start' }}
      data-testid="reservation-row"
      data-status={st}
    >
      {r.deal.imageUrl ? (
        <img className="dd-logo" src={r.deal.imageUrl} alt="" />
      ) : (
        <span className="dd-notif__icon">
          <Icon name="ticket" />
        </span>
      )}
      <div className="dd-grow" style={{ minInlineSize: 0 }}>
        <strong>{pick(r.deal.title)}</strong>
        <div className="dd-caption">
          {pick(r.deal.merchantName)} · {pick(r.branch.name)}
        </div>
        <div className="dd-row" style={{ gap: 6, flexWrap: 'wrap', marginBlockStart: 6 }}>
          <span className={`dd-chip dd-chip--${STATUS_TONE[st]}`} data-testid="row-status">
            {t(statusKey(st))}
          </span>
          <span className="dd-caption" data-testid="row-money">
            {t('cx.row.reservation')}
            {p ? (
              <>
                {' · '}
                {t(`rsv.methodName.${p.method}` as DictionaryKey)} ·{' '}
                {t(p.method === 'CARD_PREAUTH' ? 'cx.row.held' : 'cx.row.paid', {
                  amount: formatMoney(locale, p.amountMinor, p.currency),
                })}
              </>
            ) : null}
          </span>
        </div>
        {st === 'ACTIVE' ? (
          <div style={{ marginBlockStart: 4 }}>
            <div className="dd-row-valid" data-testid="row-valid">
              {t('cx.row.validFor')}{' '}
              <strong>
                <Countdown target={r.expiresAt} serverNow={r.serverNow} locale={locale} />
              </strong>
            </div>
            <div className="dd-caption">
              {t('cx.row.expires', { time: formatDateTime(locale, r.expiresAt) })}
              {r.code ? (
                <>
                  {' · '}
                  <strong className="dd-ltr" data-testid="row-code">
                    {r.code.manual}
                  </strong>
                </>
              ) : null}
            </div>
          </div>
        ) : st === 'RESERVED' ? (
          <div className="dd-caption" style={{ marginBlockStart: 4 }}>
            {t('cx.row.pay')}
          </div>
        ) : null}
      </div>
      <Icon name="forward" size={18} />
    </Link>
  );
}

function usePick() {
  const { locale } = useAuth(); // the content language (Urdu reads English content)
  return { pick: (x: { en: string; ar: string }) => x[locale] || x.en || x.ar };
}

export function MyDealsPage() {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const href = useHref();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get('tab') as 'active' | 'past' | 'updates' | null) ?? 'active';
  const [items, setItems] = useState<ReservationView[]>([]);
  const [notes, setNotes] = useState<{ unread: number; items: NotificationItem[] } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(
    async (quiet = false) => {
      if (status !== 'authenticated') return;
      if (!quiet) setState('loading');
      if (tab === 'updates') {
        const r = await call<{ unread: number; items: NotificationItem[] }>(
          'GET',
          '/v1/app/notifications',
        );
        if (r.ok && r.data) {
          setNotes(r.data);
          setState('ready');
          if (r.data.unread) void call('POST', '/v1/app/notifications/read', { body: {} });
        } else if (!quiet) setState('error');
        return;
      }
      const r = await call<ReservationView[]>('GET', '/v1/app/reservations', {
        query: { tab, limit: 50 },
      });
      if (r.ok) {
        setItems(r.data ?? []);
        setState('ready');
      } else if (!quiet) setState('error');
    },
    [call, status, tab],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // an active reservation can be used or can lapse while this page is open
  useEffect(() => {
    if (tab !== 'active') return;
    const timer = setInterval(() => void load(true), 15_000);
    return () => clearInterval(timer);
  }, [load, tab]);

  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated')
    return (
      <div className="dd-stack">
        <h1 className="dd-title-xl">{t('res.title')}</h1>
        <EmptyState
          title={t('res.signIn')}
          action={
            <Link className="dd-btn dd-btn--primary" href={href('/profile')}>
              {t('auth.signIn')}
            </Link>
          }
        />
      </div>
    );
  const setTab = (next: string) => router.replace(`${href('/reservations')}?tab=${next}`);
  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="my-deals">
      <h1 className="dd-title-xl">{t('res.title')}</h1>
      <div className="dd-segment" role="tablist" aria-label={t('res.title')}>
        {(['active', 'past', 'updates'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
          >
            {t(`res.tab${k[0]!.toUpperCase()}${k.slice(1)}` as DictionaryKey)}
          </button>
        ))}
      </div>
      {state === 'loading' ? (
        <CardSkeletons />
      ) : state === 'error' ? (
        <LoadError onRetry={() => void load()} />
      ) : tab === 'updates' ? (
        !notes || notes.items.length === 0 ? (
          <EmptyState title={t('notif.empty')} />
        ) : (
          <div className="dd-stack" data-testid="notifications">
            {notes.items.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <EmptyState
          title={tab === 'active' ? t('res.emptyActive') : t('res.emptyPast')}
          description={tab === 'active' ? t('res.emptyActiveBody') : t('res.emptyPastBody')}
          action={
            tab === 'active' ? (
              <Link className="dd-btn dd-btn--primary" href={href('/hot')}>
                {t('hot.title')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="dd-stack">
          {items.map((r) => (
            <ReservationRow key={r.id} r={r} />
          ))}
        </div>
      )}
      <span hidden>{locale}</span>
    </div>
  );
}

function NotificationRow({ n }: { n: NotificationItem }) {
  // interface text in the UI language; merchant / deal names in the content language
  const { locale, uiLocale } = useAuth();
  const t = createTranslator(uiLocale);
  const href = useHref();
  const d = n.data as Record<string, string>;
  const merchant = locale === 'ar' ? d.merchantNameAr : d.merchantNameEn;
  const deal =
    (locale === 'ar' ? d.dealTitleAr || d.voucherTitleAr : d.dealTitleEn || d.voucherTitleEn) ?? '';
  // Stage 8: case updates open "My requests", account changes the profile, Watch & Earn rewards the rewards page
  const target = d.caseId
    ? href('/cases')
    : n.type === 'ACCOUNT_RESTRICTION'
      ? href('/profile')
      : n.type === 'BENEFIT_UPDATED' || n.type === 'ACCOUNT_WELCOME'
        ? href('/benefits')
        : n.type.startsWith('REWARD_')
          ? href('/rewards')
          : d.instanceId
            ? href(`/my-vouchers/${d.instanceId}`)
            : d.orderId
              ? href(`/orders/${d.orderId}`)
              : d.reservationId
                ? href(`/reservations/${d.reservationId}`)
                : href('/');
  return (
    <Link
      href={target}
      className={`dd-notif ${n.readAt ? '' : 'dd-notif--unread'}`}
      data-testid="notification"
    >
      <span className="dd-notif__icon">
        <Icon
          name={
            n.type === 'REDEMPTION_SUCCESS' ||
            n.type === 'PURCHASE_SUCCEEDED' ||
            n.type === 'VOUCHER_REDEEMED'
              ? 'check'
              : n.type === 'RESERVATION_EXPIRING' || n.type === 'VOUCHER_EXPIRING'
                ? 'clock'
                : 'ticket'
          }
          size={18}
        />
      </span>
      <div className="dd-grow">
        <strong>
          {n.type === 'BENEFIT_UPDATED' && typeof n.data.event === 'string'
            ? t(`ben.ev.${n.data.event}` as DictionaryKey, {
                name:
                  (n.data.name as { en?: string; ar?: string } | undefined)?.[locale] ??
                  (n.data.name as { en?: string } | undefined)?.en ??
                  '',
              })
            : t(`notif.${n.type}` as DictionaryKey, {
                merchant: merchant ?? '',
                deal: deal ?? '',
                firstName: d.firstName ?? '',
              })}
        </strong>
        <div className="dd-caption">{formatDateTime(uiLocale, n.createdAt)}</div>
      </div>
    </Link>
  );
}

// ------------------------------------------------------------------ one reservation (confirmation + ticket)
export function ReservationPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const isNew = useSearchParams().get('new') === '1';
  const [r, setR] = useState<ReservationView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const current = useRef<ReservationView | null>(null);
  current.current = r;

  const load = useCallback(
    async (quiet = false) => {
      if (status !== 'authenticated') return;
      if (!quiet) setState('loading');
      const res = await call<ReservationView>('GET', `/v1/app/reservations/${id}`);
      if (res.ok && res.data) {
        setR(res.data);
        setState('ready');
      } else if (!quiet) setState(res.status === 404 ? 'missing' : 'error');
    },
    [call, id, status],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // staff may redeem it, or the hold may lapse, while the customer is looking at the QR; a payment may confirm meanwhile
  useEffect(() => {
    const timer = setInterval(() => {
      const s = current.current?.displayState;
      if (s === 'HELD' || s === 'PAYMENT_PENDING') void load(true);
    }, 8_000);
    return () => clearInterval(timer);
  }, [load]);

  const retryPayment = async (): Promise<string | null> => {
    const res = await call<ReservationView>('POST', `/v1/app/reservations/${id}/pay`, {
      body: { returnUrl: reservationReturnUrl(href) },
      idempotent: true,
    });
    if (res.ok && res.data?.payment?.redirectUrl) {
      rememberPaying(id);
      window.location.assign(res.data.payment.redirectUrl);
      return null;
    }
    void load(true);
    return res.ok ? null : errorMessage(locale, res.errors);
  };

  const cancel = async (): Promise<string | null> => {
    const res = await call<ReservationView>('POST', `/v1/app/reservations/${id}/cancel`, {
      body: {},
    });
    if (res.ok && res.data) {
      setR(res.data);
      return null;
    }
    void load(true);
    return errorMessage(locale, res.errors);
  };

  const back = () => router.push(href('/reservations'));
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated')
    return (
      <EmptyState
        title={t('res.signIn')}
        action={
          <Link className="dd-btn dd-btn--primary" href={href('/profile')}>
            {t('auth.signIn')}
          </Link>
        }
      />
    );
  if (state === 'loading') return <CardSkeletons n={1} />;
  if (state === 'error') return <LoadError onRetry={() => void load()} />;
  if (state === 'missing' || !r)
    return (
      <div className="dd-stack">
        <Button variant="ghost" onClick={back}>
          <Icon name="back" size={18} /> {t('res.title')}
        </Button>
        <EmptyState title={t('res.notFound')} />
      </div>
    );
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="customer-reservation">
      <Button variant="ghost" onClick={back} style={{ alignSelf: 'flex-start' }}>
        <Icon name="back" size={18} /> {t('res.title')}
      </Button>
      <ReservationTicket
        reservation={r}
        locale={locale}
        justConfirmed={isNew}
        onCancel={cancel}
        onRetryPayment={retryPayment}
        offerHref={href(`/hot/${r.deal.id}`)}
        doneHref={href('/reservations')}
      />
    </div>
  );
}

/** Where the payment page returns to: one route for every reservation (the id is not known before the reservation exists). */
function reservationReturnUrl(href: (p: string) => string) {
  return `${window.location.origin}${href('/reservations/return')}`;
}

/** The reservation being paid, so the return from the payment page opens that reservation (this tab only). */
const PAYING_KEY = 'dd.paying';
function rememberPaying(id: string) {
  try {
    sessionStorage.setItem(PAYING_KEY, id);
  } catch {
    /* storage blocked: the return falls back to My Deals */
  }
}
function takePaying(): string | null {
  try {
    const id = sessionStorage.getItem(PAYING_KEY);
    sessionStorage.removeItem(PAYING_KEY);
    return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ return from the payment page (+ the development mock page)
/**
 * The provider's payment page returns here. In development the mock provider sends `?mock_payment=` (prepayment / deposit) or
 * `?mock_hold=` (card hold): this page then stands in for the provider (approve or decline, so the flow can be tested on a phone)
 * and settles it through the same signed webhook path. A real provider's return simply goes to My Deals, where the reservation
 * shows its payment state (confirmation always comes from the provider's verified result, never from this page).
 */
export function ReservationReturnPage() {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const params = useSearchParams();
  const ref = params.get('mock_payment') ?? params.get('mock_hold');
  const isHold = !!params.get('mock_hold');
  const [r, setR] = useState<ReservationView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [busy, setBusy] = useState<'' | 'ok' | 'no'>('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!ref) {
      // a real provider's return: open the reservation that was being paid (its state comes from the verified result)
      const paying = takePaying();
      router.replace(paying ? `${href(`/reservations/${paying}`)}?new=1` : href('/reservations'));
      return;
    }
    let alive = true;
    void (async () => {
      const found = await call<{ reservationId: string }>(
        'GET',
        `/v1/dev/reservations/${encodeURIComponent(ref)}`,
      );
      const res =
        found.ok && found.data
          ? await call<ReservationView>('GET', `/v1/app/reservations/${found.data.reservationId}`)
          : null;
      if (!alive) return;
      if (res?.ok && res.data) {
        setR(res.data);
        setState('ready');
      } else setState('missing');
    })();
    return () => {
      alive = false;
    };
  }, [call, ref, status, router, href]);

  const finish = async (outcome: 'SUCCEEDED' | 'FAILED') => {
    if (!ref || !r) return;
    setBusy(outcome === 'SUCCEEDED' ? 'ok' : 'no');
    setError('');
    const res = await call('POST', `/v1/dev/reservations/${encodeURIComponent(ref)}/complete`, {
      body: { outcome },
    });
    if (res.ok) {
      takePaying();
      router.replace(`${href(`/reservations/${r.id}`)}?new=1`);
    } else {
      setBusy('');
      setError(errorMessage(locale, res.errors));
    }
  };

  if (status === 'loading' || (status === 'authenticated' && state === 'loading'))
    return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated')
    return (
      <EmptyState
        title={t('res.signIn')}
        action={
          <Link className="dd-btn dd-btn--primary" href={href('/profile')}>
            {t('auth.signIn')}
          </Link>
        }
      />
    );
  if (!r || !r.payment) return <EmptyState title={t('res.notFound')} />;
  const p = r.payment;
  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="mock-reservation-pay">
      <Alert tone="info" title={t('pay.mock.title')}>
        {t('pay.mock.body')}
      </Alert>
      <div className="dd-rsv-terms">
        <div className="dd-rsv-terms__head">
          <div className="dd-grow">
            <strong>{pickContent(r.deal.title, locale)}</strong>
            <div className="dd-caption">
              {pickContent(r.deal.merchantName, locale)} · {pickContent(r.branch.name, locale)}
            </div>
            <div className="dd-caption">
              {t(`rsv.methodName.${p.method}` as DictionaryKey)} ·{' '}
              {isHold ? t('rsv.holdNow') : t('rsv.payNow')}
            </div>
          </div>
          <strong className="dd-rsv-terms__amount dd-ltr" data-testid="mock-amount">
            {formatMoney(locale, p.amountMinor, p.currency)}
          </strong>
        </div>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button
        block
        loading={busy === 'ok'}
        disabled={busy === 'no'}
        onClick={() => void finish('SUCCEEDED')}
        data-testid="mock-approve"
      >
        {t('pay.mock.approve')}
      </Button>
      <Button
        block
        variant="danger"
        loading={busy === 'no'}
        disabled={busy === 'ok'}
        onClick={() => void finish('FAILED')}
        data-testid="mock-decline"
      >
        {t('pay.mock.decline')}
      </Button>
      <Link className="dd-btn dd-btn--ghost dd-btn--block" href={href(`/reservations/${r.id}`)}>
        {t('pay.mock.back')}
      </Link>
    </div>
  );
}

const pickContent = (x: { en: string; ar: string }, locale: string) =>
  (locale === 'ar' ? x.ar : x.en) || x.en || x.ar;
