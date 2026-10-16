'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HoldCountdown,
  Icon,
  OrderSummary,
  VoucherCardView,
  VoucherDetailView,
  WalletRowView,
  WalletTicket,
  errorMessage,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import { formatMoney, type DictionaryKey } from '@dealdash/localization';
import { Alert, Button, Checkbox, EmptyState, LoadingState, Skeleton } from '@dealdash/ui';
import {
  CHECKOUT_TERMS_VERSION,
  type OrderView,
  type VoucherCard,
  type VoucherDetail,
  type WalletDetail,
  type WalletItem,
} from '@dealdash/validation';
import { useCustomer, useImpression } from './customer-context';
import { CardOfferPanel, LogSaving } from './cx-benefits';
import { CardSkeletons, CityBar, LoadError, SectionHead, signInPath, useHref, useT } from './parts';
import { curate, presentCard, presentDetail } from './presentation';
import { useDealList } from './use-deals';

// ------------------------------------------------------------------ card with impression tracking
export function TrackedVoucherCard({
  voucher,
  variant,
}: {
  voucher: VoucherCard;
  variant: 'carousel' | 'list';
}) {
  const { uiLocale: locale } = useAuth();
  const href = useHref();
  const ref = useImpression(voucher.id, voucher.nearestBranch?.id, 'VOUCHER');
  return (
    <VoucherCardView
      voucher={presentCard(voucher)}
      locale={locale}
      variant={variant}
      href={href(`/vouchers/${voucher.id}`)}
      imageRef={ref}
    />
  );
}

// ------------------------------------------------------------------ home rail
export function VoucherRail() {
  const { t } = useT();
  const href = useHref();
  const { city, coords, approximate } = useCustomer();
  const list = useDealList<VoucherCard>('/v1/app/vouchers', {
    city,
    limit: 10,
    lat: approximate ? undefined : coords.lat,
    lng: approximate ? undefined : coords.lng,
  });
  if (list.loading) return <CardSkeletons variant="carousel" n={2} />;
  if (list.failed || list.items.length === 0) return null;
  return (
    <section className="dd-section" aria-label={t('vch.rail')} data-testid="voucher-rail">
      <SectionHead
        icon="tag"
        title={t('vch.rail')}
        sub={t('vch.railSub')}
        action={
          <Link className="dd-link" href={href('/vouchers')}>
            {t('cust.seeAll')}
          </Link>
        }
      />
      {/* curated: two strong cards (one card fills the row), the rest behind See all */}
      <div className="dd-duo">
        {curate([list.items]).map((v) => (
          <TrackedVoucherCard key={v.id} voucher={presentCard(v)} variant="carousel" />
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ list page: search + sort + filter
const SORTS = ['newest', 'price_low', 'price_high', 'savings', 'nearest'] as const;

export function VoucherListPage() {
  const { t } = useT();
  const { city, coords, approximate } = useCustomer();
  const [sort, setSort] = useState<(typeof SORTS)[number]>('newest');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [unlockedOnly, setUnlockedOnly] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);
  const list = useDealList<VoucherCard>('/v1/app/vouchers', {
    city,
    q: debounced || undefined,
    sort: sort === 'nearest' && approximate ? 'newest' : sort,
    eligibility: unlockedOnly ? 'unlocked' : 'all',
    limit: 12,
    lat: approximate ? undefined : coords.lat,
    lng: approximate ? undefined : coords.lng,
  });
  const filtered = !!debounced || unlockedOnly;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="voucher-list">
      <CityBar />
      <div>
        <h1 className="dd-title-xl">{t('vch.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('vch.sub')}
        </p>
      </div>
      {/* Chrome on iOS tags server-rendered form fields before hydration (see SearchBox) */}
      <input
        suppressHydrationWarning
        className="dd-input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('vch.searchPlaceholder')}
        aria-label={t('vch.searchPlaceholder')}
        data-testid="voucher-search"
      />
      <div className="dd-optrow" role="group" aria-label={t('vch.title')}>
        {SORTS.map((s) => (
          <button
            key={s}
            type="button"
            className={`dd-pill ${sort === s ? 'dd-pill--active' : ''}`}
            aria-pressed={sort === s}
            onClick={() => setSort(s)}
          >
            {t(`vch.sort.${s}` as DictionaryKey)}
          </button>
        ))}
        <button
          type="button"
          className={`dd-pill ${unlockedOnly ? 'dd-pill--active' : ''}`}
          aria-pressed={unlockedOnly}
          onClick={() => setUnlockedOnly((v) => !v)}
        >
          {t('vch.filter.unlocked')}
        </button>
      </div>
      {list.loading ? (
        <CardSkeletons />
      ) : list.failed ? (
        <LoadError onRetry={list.reload} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title={filtered ? t('vch.noMatch') : t('vch.empty')}
          description={filtered ? undefined : t('vch.emptyBody')}
        />
      ) : (
        <>
          <div className="dd-cardgrid">
            {list.items.map((v) => (
              <TrackedVoucherCard key={v.id} voucher={v} variant="list" />
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

// ------------------------------------------------------------------ detail page + start checkout
export function VoucherPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const { city, coords, approximate, track } = useCustomer();
  const [detail, setDetail] = useState<VoucherDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState('loading');
      const r = await call<VoucherDetail>('GET', `/v1/app/vouchers/${id}`, {
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
  useEffect(() => {
    const timer = setInterval(() => void load(true), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const viewed = detail?.id;
  useEffect(() => {
    if (viewed)
      track({
        type: 'DETAIL_VIEW',
        dealId: viewed,
        branchId: detail?.nearestBranch?.id,
        product: 'VOUCHER',
      });
    // one detail view per opened voucher
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewed]);

  const back = () => (window.history.length > 1 ? router.back() : router.push(href('/vouchers')));
  const buy = async (): Promise<{ error: string | null }> => {
    const r = await call<OrderView>('POST', '/v1/app/checkout', {
      body: { voucherId: id, quantity: 1 },
      idempotent: true,
    });
    if (r.ok && r.data) {
      router.push(href(`/checkout/${r.data.id}`));
      return { error: null };
    }
    void load(true);
    return { error: r.status === 0 ? t('hot.connError') : errorMessage(locale, r.errors) };
  };

  if (state === 'loading')
    return (
      <div className="dd-stack" style={{ margin: -16 }} aria-busy="true">
        <Skeleton height={280} />
        <div style={{ padding: 16, display: 'grid', gap: 10 }}>
          <Skeleton height={32} width="50%" />
          <Skeleton height={16} />
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
          title={t('vch.unavailable')}
          description={t('vch.unavailableBody')}
          action={
            <Link className="dd-link" href={href('/vouchers')}>
              {t('vch.seeAll')}
            </Link>
          }
        />
      </div>
    );
  return (
    <div data-testid="customer-voucher">
      <VoucherDetailView
        detail={presentDetail(detail)}
        locale={locale}
        signedIn={status === 'authenticated'}
        onBack={back}
        onBuy={buy}
        onSignIn={() => router.push(signInPath(href, 'buy'))}
        onUnlock={(a) =>
          router.push(href('/benefits') + (a === 'VERIFY_EMPLOYER' ? '?add=employer' : '?add=card'))
        }
        onDirections={(branchId) =>
          track({ type: 'DIRECTIONS_CLICK', dealId: id, branchId, product: 'VOUCHER' })
        }
        merchantHref={href(`/merchants/${detail.merchantId}`)}
        benefit={<CardOfferPanel product="voucher" offerId={detail.id} />}
      />
    </div>
  );
}

// ------------------------------------------------------------------ shared order loading
function useOrder(id: string, poll: (o: OrderView | null) => number | null) {
  const { call } = useApi();
  const { status } = useAuth();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const orderRef = useRef<OrderView | null>(null);
  orderRef.current = order;

  const load = useCallback(
    async (quiet = false) => {
      if (status !== 'authenticated') return;
      if (!quiet) setState('loading');
      const r = await call<OrderView>('GET', `/v1/app/orders/${id}`);
      if (r.ok && r.data) {
        setOrder(r.data);
        setState('ready');
      } else if (!quiet) setState(r.status === 404 ? 'missing' : 'error');
    },
    [call, id, status],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const ms = pollRef.current(orderRef.current);
      if (ms !== null) void load(true);
      timer = setTimeout(tick, ms ?? 3000);
    };
    timer = setTimeout(tick, 2000);
    return () => clearTimeout(timer);
  }, [load]);
  return { order, state, reload: load, setOrder };
}

function SignInGate() {
  const { t } = useT();
  const href = useHref();
  return (
    <EmptyState
      title={t('wal.signIn')}
      action={
        <Link className="dd-btn dd-btn--primary" href={href('/profile')}>
          {t('auth.signIn')}
        </Link>
      }
    />
  );
}

// ------------------------------------------------------------------ checkout
export function CheckoutPage({ orderId }: { orderId: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const { track } = useCustomer();
  const { order, state, reload } = useOrder(orderId, (o) =>
    o && o.status === 'PENDING_PAYMENT' ? 5000 : null,
  );
  const [accepted, setAccepted] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);

  // anything but an open order belongs on the status page
  useEffect(() => {
    if (order && order.status !== 'PENDING_PAYMENT') router.replace(href(`/orders/${order.id}`));
  }, [order, router, href]);

  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated') return <SignInGate />;
  if (state === 'loading') return <CardSkeletons n={2} />;
  if (state === 'error') return <LoadError onRetry={() => void reload()} />;
  if (state === 'missing' || !order)
    return <EmptyState title={t('wal.notFound')} description={t('ord.title')} />;

  const expired = new Date(order.holdExpiresAt).getTime() <= Date.now();
  const lastFailed = order.payment?.status === 'FAILED';

  const pay = async () => {
    setTouched(true);
    if (!accepted) return;
    setBusy(true);
    setError('');
    const r = await call<OrderView>('POST', `/v1/app/orders/${order.id}/pay`, {
      body: {
        acceptTerms: true,
        termsVersion: CHECKOUT_TERMS_VERSION,
        returnUrl: `${window.location.origin}${href(`/pay/${order.id}`)}`,
      },
      idempotent: true,
    });
    if (r.ok && r.data?.payment?.redirectUrl) {
      track({ type: 'DETAIL_VIEW', dealId: order.voucher.id, product: 'VOUCHER' });
      window.location.assign(r.data.payment.redirectUrl);
      return;
    }
    setBusy(false);
    if (r.ok) router.push(href(`/orders/${order.id}`));
    else {
      setError(errorMessage(locale, r.errors));
      void reload(true);
    }
  };

  const cancel = async () => {
    setLeaving(true);
    await call('POST', `/v1/app/orders/${order.id}/cancel`, { body: {} });
    router.push(href(`/vouchers/${order.voucher.id}`));
  };

  if (expired)
    return (
      <div className="dd-stack" data-testid="checkout-expired">
        <div className="dd-statusbox dd-statusbox--warning">
          <span className="dd-statusbox__icon">
            <Icon name="clock" size={26} />
          </span>
          <h1 className="dd-title">{t('ck.expired')}</h1>
          <p className="dd-muted">{t('ck.expiredBody')}</p>
          <Link className="dd-btn dd-btn--primary" href={href(`/vouchers/${order.voucher.id}`)}>
            {t('ck.again')}
          </Link>
        </div>
      </div>
    );

  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="checkout">
      <Button
        variant="ghost"
        onClick={() => router.push(href(`/vouchers/${order.voucher.id}`))}
        style={{ alignSelf: 'flex-start' }}
      >
        <Icon name="back" size={18} /> {t('ck.again')}
      </Button>
      <h1 className="dd-title-xl">{t('ck.title')}</h1>
      {lastFailed ? (
        <div data-testid="checkout-failed-note">
          <Alert tone="warning">
            {t('ord.failed')} {t('ord.failedBody')}
          </Alert>
        </div>
      ) : null}
      <OrderSummary order={order} locale={locale} />
      <HoldCountdown order={order} locale={locale} />

      <div className="dd-card" style={{ padding: 16 }}>
        <strong>{t('ck.method')}</strong>
        <div className="dd-row" style={{ gap: 8, marginBlockStart: 8 }}>
          <Icon name="lock" size={16} />
          <span>{t('ck.methodTest')}</span>
        </div>
        <p className="dd-caption">{t('ck.methodNote')}</p>
      </div>

      <div>
        <Checkbox
          label={t('ck.terms')}
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          data-testid="checkout-terms"
        />
        <Link className="dd-link" href={href(`/vouchers/${order.voucher.id}`)} target="_blank">
          {t('vch.termsTitle')}
        </Link>
        {touched && !accepted ? (
          <div className="dd-error" role="alert">
            {t('ck.termsRequired')}
          </div>
        ) : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {order.canRetry || !lastFailed ? (
        <Button block loading={busy} onClick={() => void pay()} data-testid="checkout-pay">
          {busy ? t('ck.paying') : t('ck.pay', { amount: formatMoney(locale, order.totalHalalas) })}
        </Button>
      ) : (
        <Alert tone="danger">{t('ord.noRetries')}</Alert>
      )}
      <Button variant="ghost" block loading={leaving} onClick={() => void cancel()}>
        {t('ck.cancel')}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ the test payment page (stands in for the provider)
export function MockPayPage({ orderId }: { orderId: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const ref = useSearchParams().get('mock_payment');
  const { order, state } = useOrder(orderId, () => null);
  const [busy, setBusy] = useState<'' | 'ok' | 'no'>('');
  const [error, setError] = useState('');

  const finish = async (outcome: 'SUCCEEDED' | 'FAILED') => {
    if (!ref) return;
    setBusy(outcome === 'SUCCEEDED' ? 'ok' : 'no');
    setError('');
    const r = await call('POST', `/v1/dev/payments/${encodeURIComponent(ref)}/complete`, {
      body: { outcome },
    });
    if (r.ok) router.replace(href(`/orders/${orderId}`));
    else {
      setBusy('');
      setError(errorMessage(locale, r.errors));
    }
  };

  if (status === 'loading' || state === 'loading')
    return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated') return <SignInGate />;
  if (!ref || !order) return <EmptyState title={t('wal.notFound')} />;
  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="mock-pay">
      <Alert tone="info" title={t('pay.mock.title')}>
        {t('pay.mock.body')}
      </Alert>
      <OrderSummary order={order} locale={locale} />
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
      <Link className="dd-btn dd-btn--ghost dd-btn--block" href={href(`/orders/${orderId}`)}>
        {t('pay.mock.back')}
      </Link>
    </div>
  );
}

// ------------------------------------------------------------------ order status: processing, success, failure
const FAILURE_CODES = [
  'CARD_DECLINED',
  'CANCELLED',
  'PROVIDER_ERROR',
  'DECLINED',
  'INITIATION_TIMEOUT',
];

export function OrderStatusPage({ orderId }: { orderId: string }) {
  const { t, locale } = useT();
  const { status } = useAuth();
  const href = useHref();
  const startedAt = useRef(Date.now());
  const { order, state, reload } = useOrder(orderId, (o) => {
    if (!o) return 2000;
    const paying = o.status === 'PENDING_PAYMENT' && o.payment && o.payment.status === 'PENDING';
    return paying ? 2000 : null;
  });

  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated') return <SignInGate />;
  if (state === 'loading') return <CardSkeletons n={1} />;
  if (state === 'error') return <LoadError onRetry={() => void reload()} />;
  if (state === 'missing' || !order) return <EmptyState title={t('wal.notFound')} />;

  const p = order.payment;
  const slow = Date.now() - startedAt.current > 30_000;
  let box: React.ReactNode;
  if (order.status === 'PAID')
    box = (
      <div className="dd-statusbox dd-statusbox--success" data-testid="order-success">
        <span className="dd-statusbox__icon">
          <Icon name="check" size={28} />
        </span>
        <h1 className="dd-title">{t('ord.success')}</h1>
        <p className="dd-muted">{t('ord.successBody')}</p>
        <Link
          className="dd-btn dd-btn--primary"
          href={href(
            order.voucherInstanceId
              ? `/my-vouchers/${order.voucherInstanceId}?new=1`
              : '/my-vouchers',
          )}
          data-testid="order-view-voucher"
        >
          {t('ord.viewVoucher')}
        </Link>
      </div>
    );
  else if (order.status === 'CANCELLED' || order.status === 'EXPIRED')
    box = (
      <div className="dd-statusbox dd-statusbox--warning" data-testid="order-closed">
        <span className="dd-statusbox__icon">
          <Icon name="clock" size={26} />
        </span>
        <h1 className="dd-title">
          {order.status === 'CANCELLED' ? t('ord.cancelled') : t('ord.expired')}
        </h1>
        <p className="dd-muted">{t('ck.expiredBody')}</p>
        <Link className="dd-btn dd-btn--primary" href={href(`/vouchers/${order.voucher.id}`)}>
          {t('ck.again')}
        </Link>
      </div>
    );
  else if (p && p.status === 'FAILED')
    box = (
      <div className="dd-statusbox dd-statusbox--danger" data-testid="order-failed">
        <span className="dd-statusbox__icon">
          <Icon name="alert" size={26} />
        </span>
        <h1 className="dd-title">{t('ord.failed')}</h1>
        <p className="dd-muted">{t('ord.failedBody')}</p>
        {p.failureCode && FAILURE_CODES.includes(p.failureCode) ? (
          <p className="dd-caption" data-testid="order-failure-reason">
            {t(`ord.failure.${p.failureCode}` as DictionaryKey)}
          </p>
        ) : null}
        {order.canRetry ? (
          <Link
            className="dd-btn dd-btn--primary"
            href={href(`/checkout/${order.id}`)}
            data-testid="order-retry"
          >
            {t('ord.retry', { n: order.retriesLeft })}
          </Link>
        ) : (
          <p className="dd-caption">{t('ord.noRetries')}</p>
        )}
        <Link className="dd-link" href={href(`/vouchers/${order.voucher.id}`)}>
          {t('ck.again')}
        </Link>
      </div>
    );
  else if (p && p.status === 'PENDING')
    box = (
      <div className="dd-statusbox" data-testid="order-processing">
        <span className="dd-spinner" aria-hidden="true" />
        <h1 className="dd-title">{t('ord.processing')}</h1>
        <p className="dd-muted">{slow ? t('ord.pendingSlow') : t('ord.processingBody')}</p>
        {p.redirectUrl ? (
          <a className="dd-btn dd-btn--outline" href={p.redirectUrl}>
            {t('ord.openPayment')}
          </a>
        ) : null}
      </div>
    );
  else
    box = (
      <div className="dd-statusbox" data-testid="order-awaiting">
        <span className="dd-statusbox__icon">
          <Icon name="clock" size={26} />
        </span>
        <h1 className="dd-title">{t('ord.awaiting')}</h1>
        <p className="dd-muted">{t('ord.awaitingBody')}</p>
        <Link className="dd-btn dd-btn--primary" href={href(`/checkout/${order.id}`)}>
          {t('ord.openPayment')}
        </Link>
      </div>
    );

  return (
    <div
      className="dd-stack"
      style={{ gap: 14 }}
      data-testid="order-status"
      data-status={order.status}
    >
      {box}
      <OrderSummary order={order} locale={locale} />
      <p className="dd-caption">
        {t('ord.reference')}: <span className="dd-ltr">{order.reference}</span>
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ My Vouchers
const WALLET_TABS = ['active', 'used', 'expired', 'refunded'] as const;

export function MyVouchersPage() {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const href = useHref();
  const router = useRouter();
  const params = useSearchParams();
  const tab = (WALLET_TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as (typeof WALLET_TABS)[number])
    : 'active';
  const [items, setItems] = useState<WalletItem[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(
    async (quiet = false) => {
      if (status !== 'authenticated') return;
      if (!quiet) setState('loading');
      const r = await call<WalletItem[]>('GET', '/v1/app/wallet', { query: { tab, limit: 50 } });
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
  useEffect(() => {
    if (tab !== 'active') return;
    const timer = setInterval(() => void load(true), 15_000);
    return () => clearInterval(timer);
  }, [load, tab]);

  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated')
    return (
      <div className="dd-stack">
        <h1 className="dd-title-xl">{t('wal.title')}</h1>
        <SignInGate />
      </div>
    );
  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="my-vouchers">
      <h1 className="dd-title-xl">{t('wal.title')}</h1>
      <div className="dd-segment" role="tablist" aria-label={t('wal.title')}>
        {WALLET_TABS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => router.replace(`${href('/my-vouchers')}?tab=${k}`)}
            data-testid={`wallet-tab-${k}`}
          >
            {t(`wal.tab${k[0]!.toUpperCase()}${k.slice(1)}` as DictionaryKey)}
          </button>
        ))}
      </div>
      {state === 'loading' ? (
        <CardSkeletons />
      ) : state === 'error' ? (
        <LoadError onRetry={() => void load()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={tab === 'active' ? t('wal.emptyActive') : t('wal.emptyOther')}
          description={tab === 'active' ? t('wal.emptyActiveBody') : undefined}
          action={
            tab === 'active' ? (
              <Link className="dd-btn dd-btn--primary" href={href('/vouchers')}>
                {t('vch.title')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="dd-stack">
          {items.map((it) => (
            <WalletRowView
              key={it.id}
              item={it}
              locale={locale}
              href={href(`/my-vouchers/${it.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function WalletVoucherPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const { track } = useCustomer();
  const isNew = useSearchParams().get('new') === '1';
  const [v, setV] = useState<WalletDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const current = useRef<WalletDetail | null>(null);
  current.current = v;

  const load = useCallback(
    async (quiet = false) => {
      if (status !== 'authenticated') return;
      if (!quiet) setState('loading');
      const r = await call<WalletDetail>('GET', `/v1/app/wallet/${id}`);
      if (r.ok && r.data) {
        setV(r.data);
        setState('ready');
      } else if (!quiet) setState(r.status === 404 ? 'missing' : 'error');
    },
    [call, id, status],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // staff may redeem it, or a refund may move on, while the customer looks at the QR
  useEffect(() => {
    const timer = setInterval(() => {
      const s = current.current;
      if (s && (s.state === 'ACTIVE' || s.state === 'REFUND_PENDING')) void load(true);
    }, 6_000);
    return () => clearInterval(timer);
  }, [load]);

  const refund = async (reasonCode: string, note: string): Promise<string | null> => {
    const r = await call('POST', `/v1/app/wallet/${id}/refund`, {
      body: { reasonCode, note: note || undefined },
      idempotent: true,
    });
    void load(true);
    return r.ok ? null : errorMessage(locale, r.errors);
  };
  const support = async (subject: string, body: string): Promise<string | null> => {
    const r = await call('POST', '/v1/app/support-cases', {
      body: { type: 'VOUCHER_ISSUE', subject, body, voucherInstanceId: id },
    });
    void load(true);
    return r.ok ? null : errorMessage(locale, r.errors);
  };

  const back = () => router.push(href('/my-vouchers'));
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated') return <SignInGate />;
  if (state === 'loading') return <CardSkeletons n={1} />;
  if (state === 'error') return <LoadError onRetry={() => void load()} />;
  if (state === 'missing' || !v)
    return (
      <div className="dd-stack">
        <Button variant="ghost" onClick={back}>
          <Icon name="back" size={18} /> {t('wal.title')}
        </Button>
        <EmptyState title={t('wal.notFound')} />
      </div>
    );
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="customer-wallet-voucher">
      <Button variant="ghost" onClick={back} style={{ alignSelf: 'flex-start' }}>
        <Icon name="back" size={18} /> {t('wal.title')}
      </Button>
      <WalletTicket
        voucher={v}
        locale={locale}
        justIssued={isNew}
        onRefund={refund}
        onSupport={support}
        onDirections={(branchId) =>
          track({ type: 'DIRECTIONS_CLICK', dealId: v.voucherId, branchId, product: 'VOUCHER' })
        }
        offerHref={href(`/vouchers/${v.voucherId}`)}
      />
      {/* "Log my saving": once the voucher has been used */}
      {v.state === 'USED' ? <LogSaving sourceType="VOUCHER" sourceId={v.id} /> : null}
    </div>
  );
}
