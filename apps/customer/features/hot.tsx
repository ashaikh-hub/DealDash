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
import type { HotDealCard, HotDealDetail, OrderView, ReservationView } from '@dealdash/validation';
import { useCustomer, useImpression } from './customer-context';
import { PayWith, cardLabel, useMockCard, useSavedCards } from './cx-account';
import {
  CardOfferPanel,
  DealReviewsPanel,
  LogSaving,
  SavingsBanner,
  useDealReviews,
} from './cx-benefits';
import {
  MerchantVideo,
  STATUS_TONE,
  customerStatus,
  statusKey,
  useEligibilityNote,
  useRating,
} from './cx-parts';
import {
  CardSkeletons,
  CityBar,
  LoadError,
  RailEmpty,
  SectionHead,
  signInPath,
  useHref,
  useT,
} from './parts';
import { RAIL_SIZE, curate, presentCard, presentDetail } from './presentation';
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
  const items = list.failed ? [] : list.items;
  // the section is always there (curated Home, never truncated): with nothing to show, a short note and the way to the full list
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
      {items.length ? (
        // compact carousel (founder direction 2026-10-16): up to five offers, the next one peeking, the rest behind See all
        <div className="dd-hscroll dd-rail" data-testid="hot-rail-items">
          {curate([items], RAIL_SIZE).map((d) => (
            <TrackedHotCard key={d.id} deal={d} variant="carousel" />
          ))}
        </div>
      ) : (
        <RailEmpty
          icon="flame"
          text={t('home.empty.exclusive')}
          href={href('/hot')}
          cta={t('cust.seeAll')}
          testId="hot-rail-empty"
        />
      )}
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
  const merchantRating = useRating(detail?.merchantId);
  const eligibilityNote = useEligibilityNote(detail?.eligibility.kind, detail?.eligibility.result);
  const openTab = useSearchParams().get('tab') === 'reviews' ? 'reviews' : undefined;
  // the deal's own rating when customers reviewed it, otherwise the merchant's
  const dealReviews = useDealReviews('hot-deals', id);
  const ds = dealReviews.data?.summary;
  const rating = ds && ds.count > 0 ? { average: ds.average, count: ds.count } : merchantRating;
  // saved cards: the default card is chosen; "a new card" pays on the provider's page as before
  const saved = useSavedCards(status === 'authenticated');
  const [payCard, setPayCard] = useState<string | null | undefined>(undefined);
  const usableCards = (saved.data?.items ?? []).filter((c) => !c.expired);
  const defaultCard = usableCards.find((c) => c.isDefault)?.id ?? usableCards[0]?.id ?? null;
  const chosenCard = payCard === undefined ? defaultCard : payCard;

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
        ...(opts.acceptTerms
          ? {
              acceptTerms: true,
              returnUrl: reservationReturnUrl(href),
              ...(chosenCard ? { paymentMethodId: chosenCard } : {}),
            }
          : {}),
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
        reviews={
          <DealReviewsPanel
            product="hot-deals"
            dealId={detail.id}
            merchantId={detail.merchantId}
            merchantName={pickContent(detail.merchantName, locale)}
            reviews={dealReviews.data}
            reload={dealReviews.reload}
          />
        }
        initialTab={openTab}
        merchantMedia={<MerchantVideo merchantId={detail.merchantId} />}
        eligibilityNote={eligibilityNote}
        benefit={<CardOfferPanel product="hot" offerId={detail.id} />}
        payWith={
          status === 'authenticated' && saved.data?.canSave ? (
            <PayWith cards={saved.data.items} value={chosenCard} onChange={setPayCard} />
          ) : undefined
        }
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
    | 'ACCOUNT_WELCOME'
    // FDR-19: an instant Watch & Earn prize was won
    | 'PRIZE_WON';
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

interface PaymentLine {
  id: string;
  href: string;
  title: { en: string; ar: string };
  merchant: { en: string; ar: string };
  imageUrl: string | null;
  kind: 'RESERVATION' | 'VOUCHER';
  method: string | null;
  at: string;
  amountMinor: number;
  currency: string;
  /** Translation key of the status chip, and its tone. */
  statusKey: DictionaryKey;
  tone: string;
  /** Money that left the customer's account (a card hold that was never charged is not counted). */
  paidMinor: number;
  refundedMinor: number;
}

/** Status of a reservation payment in the customer's words (reference "My Deals - payments"). */
function reservationPaymentStatus(r: ReservationView): { key: DictionaryKey; tone: string } {
  const p = r.payment!;
  if (p.status === 'PAID' && r.displayState === 'REDEEMED')
    return p.method === 'DEPOSIT'
      ? { key: 'cx.pay.st.CREDITED', tone: 'success' }
      : { key: 'cx.pay.st.USED', tone: 'info' };
  if (p.status === 'PAID' && r.displayState === 'HELD')
    return { key: 'cx.pay.st.HELD', tone: 'info' };
  const tone: Record<string, string> = {
    PENDING: 'warning',
    FAILED: 'danger',
    REFUNDED: 'danger',
    PARTIALLY_REFUNDED: 'warning',
    FORFEITED: 'neutral',
    AUTHORISED: 'info',
    CAPTURED: 'success',
    VOIDED: 'neutral',
    PAID: 'success',
  };
  return { key: `rsv.status.${p.status}` as DictionaryKey, tone: tone[p.status] ?? 'neutral' };
}

/**
 * My Deals - Payments: every reservation payment / card hold and every voucher purchase, newest first, with the total paid and the
 * total refunded. Built from the customer's own reservation and order lists (no money logic here).
 */
function PaymentsPanel() {
  const { t, locale } = useT();
  const { call } = useApi();
  const href = useHref();
  const { pick } = usePick();
  const [lines, setLines] = useState<PaymentLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    void Promise.all([
      call<ReservationView[]>('GET', '/v1/app/reservations', {
        query: { tab: 'active', limit: 50 },
      }),
      call<ReservationView[]>('GET', '/v1/app/reservations', { query: { tab: 'past', limit: 50 } }),
      call<OrderView[]>('GET', '/v1/app/orders', { query: { limit: 50 } }),
    ]).then(([a, p, o]) => {
      if (!alive) return;
      if (!a.ok || !p.ok) {
        setFailed(true);
        return;
      }
      const out: PaymentLine[] = [];
      // a reservation can move from active to past between the two requests: list it once
      const seen = new Set<string>();
      for (const r of [...(a.data ?? []), ...(p.data ?? [])]) {
        if (!r.payment || seen.has(r.id)) continue;
        seen.add(r.id);
        const pay = r.payment;
        const st = reservationPaymentStatus(r);
        const captured = pay.authorisation?.capturedMinor ?? 0;
        const charged =
          pay.method === 'CARD_PREAUTH'
            ? captured
            : pay.status === 'PENDING' || pay.status === 'FAILED'
              ? 0
              : pay.amountMinor;
        out.push({
          id: r.id,
          href: href(`/reservations/${r.id}`),
          title: r.deal.title,
          merchant: r.deal.merchantName,
          imageUrl: r.deal.imageUrl,
          kind: 'RESERVATION',
          method: pay.method,
          at: r.createdAt,
          amountMinor: pay.amountMinor,
          currency: pay.currency,
          statusKey: st.key,
          tone: st.tone,
          paidMinor: charged,
          refundedMinor: pay.refunds
            .filter((f) => f.status === 'REFUNDED')
            .reduce((n, f) => n + f.amountMinor, 0),
        });
      }
      // voucher purchases (customers without the voucher permission simply have none)
      for (const ord of o.ok ? (o.data ?? []) : []) {
        if (ord.status === 'PENDING_PAYMENT' && !ord.payment) continue;
        out.push({
          id: ord.id,
          href: href(`/orders/${ord.id}`),
          title: ord.voucher.title,
          merchant: ord.voucher.merchantName,
          imageUrl: ord.voucher.imageUrl,
          kind: 'VOUCHER',
          method: null,
          at: ord.paidAt ?? ord.createdAt,
          amountMinor: ord.totalHalalas,
          currency: ord.currency,
          statusKey: `cx.pay.ord.${ord.status}` as DictionaryKey,
          tone:
            ord.status === 'PAID'
              ? 'success'
              : ord.status === 'FAILED'
                ? 'danger'
                : ord.status === 'PENDING_PAYMENT'
                  ? 'warning'
                  : 'neutral',
          paidMinor: ord.status === 'PAID' ? ord.totalHalalas : 0,
          refundedMinor: 0,
        });
      }
      out.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
      setLines(out);
    });
    return () => {
      alive = false;
    };
  }, [call, href, attempt]);

  if (failed) return <LoadError onRetry={() => setAttempt((n) => n + 1)} />;
  if (!lines) return <CardSkeletons />;
  if (!lines.length) return <EmptyState title={t('cx.pay.empty')} />;
  const ccy = lines[0]!.currency;
  const same = lines.filter((l) => l.currency === ccy);
  const paid = same.reduce((n, l) => n + l.paidMinor, 0);
  const refunded = same.reduce((n, l) => n + l.refundedMinor, 0);
  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="payments">
      <div className="dd-paytotal" data-testid="payments-total">
        <div>
          <span>{t('cx.pay.totalPaid')}</span>
          <strong className="dd-ltr">{formatMoney(locale, paid, ccy)}</strong>
        </div>
        <div style={{ textAlign: 'end' }}>
          <span>{t('cx.pay.refundedTotal')}</span>
          <strong className="dd-ltr dd-paytotal__small">
            {formatMoney(locale, refunded, ccy)}
          </strong>
        </div>
      </div>
      <p className="dd-caption" style={{ margin: 0 }}>
        {t('cx.pay.note')}
      </p>
      <h2 className="dd-title">{t('cx.pay.all')}</h2>
      <div className="dd-stack">
        {lines.map((l) => (
          <Link
            key={`${l.kind}-${l.id}`}
            href={l.href}
            className="dd-staffrow"
            style={{ textDecoration: 'none', color: 'inherit', alignItems: 'center' }}
            data-testid="payment-row"
          >
            {l.imageUrl ? (
              <img className="dd-logo" src={l.imageUrl} alt="" />
            ) : (
              <span className="dd-notif__icon">
                <Icon name={l.kind === 'VOUCHER' ? 'gift' : 'ticket'} />
              </span>
            )}
            <div className="dd-grow" style={{ minInlineSize: 0 }}>
              <strong>
                {pick(l.merchant)} · {pick(l.title)}
              </strong>
              <div className="dd-caption">
                {l.kind === 'VOUCHER'
                  ? t('cx.pay.kindVoucher')
                  : `${t('cx.pay.kindReservation')} · ${t(`rsv.methodName.${l.method}` as DictionaryKey)}`}{' '}
                · {formatDateTime(locale, l.at)}
              </div>
              <span
                className={`dd-chip dd-chip--${l.tone}`}
                style={{ marginBlockStart: 4, display: 'inline-flex' }}
                data-testid="payment-status"
              >
                {t(l.statusKey)}
              </span>
            </div>
            <strong className="dd-ltr" style={{ flex: 'none' }} data-testid="payment-amount">
              {formatMoney(locale, l.amountMinor, l.currency)}
            </strong>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function MyDealsPage() {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const href = useHref();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (params.get('tab') as 'active' | 'past' | 'payments' | 'updates' | null) ?? 'active';
  const [items, setItems] = useState<ReservationView[]>([]);
  const [notes, setNotes] = useState<{ unread: number; items: NotificationItem[] } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(
    async (quiet = false) => {
      // the payments tab loads its own lists
      if (status !== 'authenticated' || tab === 'payments') return;
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
        {(['active', 'past', 'payments', 'updates'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            data-testid={`mydeals-tab-${k}`}
          >
            {k === 'payments'
              ? t('cx.pay.tab')
              : t(`res.tab${k[0]!.toUpperCase()}${k.slice(1)}` as DictionaryKey)}
          </button>
        ))}
      </div>
      {tab === 'active' || tab === 'past' ? <SavingsBanner /> : null}
      {tab === 'payments' ? (
        <PaymentsPanel />
      ) : state === 'loading' ? (
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
  // Stage 8: case updates open "My requests", account changes the profile, Watch & Earn rewards the rewards page;
  // a won prize opens that prize (with its code) under Rewards
  const prize = n.type === 'PRIZE_WON' && d.prizeId ? d.prizeId : null;
  const target = prize
    ? href(`/rewards/prizes/${prize}`)
    : d.caseId
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
      data-type={n.type}
    >
      <span className="dd-notif__icon">
        <Icon
          name={
            prize
              ? 'gift'
              : n.type === 'REDEMPTION_SUCCESS' ||
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
        {prize && d.expiresAt ? (
          <div className="dd-caption" data-testid="notification-prize-cta">
            {t('notif.prizeValid', { date: formatDateTime(uiLocale, d.expiresAt) })}
          </div>
        ) : null}
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
      {/* after the visit: log what was saved, and rate the deal (reference post-reservation actions) */}
      {r.displayState === 'REDEEMED' ? (
        <>
          <LogSaving sourceType="RESERVATION" sourceId={r.id} />
          <Link
            className="dd-btn dd-btn--outline dd-btn--block"
            href={`${href(`/hot/${r.deal.id}`)}?tab=reviews`}
            data-testid="rate-deal"
          >
            <Icon name="star" size={18} /> {t('cx.rv.rate')}
          </Link>
        </>
      ) : null}
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
  // a saved card: the provider charges its token (the mock page shows which card)
  const savedCard = useMockCard(params.get('mock_card'));
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
            {savedCard ? (
              <div className="dd-caption" data-testid="mock-paying-card">
                {t('cx.pm.paying', { card: cardLabel(t, savedCard) })}
              </div>
            ) : null}
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
