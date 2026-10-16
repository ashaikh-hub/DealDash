'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon, LoginPanel, errorMessage, pickText, useApi, useAuth } from '@dealdash/app-shell';
import { formatDate, formatMoney, type DictionaryKey } from '@dealdash/localization';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
  StatusChip,
  Textarea,
} from '@dealdash/ui';
import type {
  BenefitOffer,
  CardOfferState,
  DealReviews,
  EmployeePass,
  SavingState,
  SavingsSummary,
} from '@dealdash/validation';
import { MerchantReviews } from './care';
import { useCustomer } from './customer-context';
import { TrackedHotCard } from './hot';
import { TrackedCard, signInPath, useHref, useT } from './parts';
import { TrackedVoucherCard } from './vouchers';

/**
 * Customer experience (2026-10-16): card-linked offer activation, "Log my saving" and the savings total, the Employee Pass, per-deal
 * reviews and the merchant gallery.
 */

// ---------------------------------------------------------------- card-linked offer activation
export function CardOfferPanel({
  product,
  offerId,
}: {
  product: 'live' | 'hot' | 'voucher';
  offerId: string;
}) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const [s, setS] = useState<CardOfferState | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (status === 'loading') return;
    let alive = true;
    void call<CardOfferState>('GET', `/v1/app/card-offers/${product}/${offerId}`).then((r) => {
      if (alive && r.ok && r.data && typeof r.data.state === 'string') {
        setS(r.data);
        setPick(r.data.cards[0]?.programId ?? null);
      }
    });
    return () => {
      alive = false;
    };
  }, [call, product, offerId, status]);
  if (!s || s.state === 'NOT_CARD_OFFER') return null;
  const activate = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    const r = await call<CardOfferState>(
      'POST',
      `/v1/app/card-offers/${product}/${offerId}/activate`,
      {
        body: { programId: pick },
        idempotent: true,
      },
    );
    setBusy(false);
    if (r.ok && r.data) setS(r.data);
    else setError(errorMessage(locale, r.errors));
  };
  const issuers = s.issuers.map((i) => pickText(i.name, locale)).join(' · ');
  const chosen = s.cards.find((c) => c.programId === pick);
  return (
    <section
      className={`dd-cardoffer ${s.state === 'ACTIVATED' ? 'dd-cardoffer--on' : ''}`}
      data-testid="card-offer"
      data-state={s.state}
    >
      <span className="dd-cardoffer__icon" aria-hidden="true">
        <Icon name={s.state === 'ACTIVATED' ? 'check' : 'card'} size={18} />
      </span>
      <div className="dd-grow dd-stack" style={{ gap: 6, minInlineSize: 0 }}>
        <strong>{t('cx.ca.title')}</strong>
        {s.state === 'ACTIVATED' && s.activation ? (
          <>
            <span data-testid="card-offer-activated">
              {t('cx.ca.activated', { card: pickText(s.activation.cardName, locale) })}
            </span>
            <span className="dd-caption">
              {t('cx.ca.activatedOn', { date: formatDate(locale, s.activation.activatedAt) })}
            </span>
          </>
        ) : s.state === 'AVAILABLE' ? (
          <>
            <span className="dd-caption">{t('cx.ca.body')}</span>
            {s.cards.length > 1 ? (
              <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
                <legend className="dd-label">{t('cx.ca.chooseCard')}</legend>
                {s.cards.map((c) => (
                  <label
                    key={c.programId}
                    className={`dd-hot-pick ${pick === c.programId ? 'dd-hot-pick--on' : ''}`}
                  >
                    <input
                      type="radio"
                      name="activate-card"
                      checked={pick === c.programId}
                      onChange={() => setPick(c.programId)}
                    />
                    <span className="dd-grow">{pickText(c.name, locale)}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <div>
              <Button
                size="sm"
                loading={busy}
                onClick={() => void activate()}
                data-testid="card-offer-activate"
                // long card names wrap inside the button at 320 px instead of running past it
                style={{ whiteSpace: 'normal', blockSize: 'auto', maxInlineSize: '100%' }}
              >
                {chosen && s.cards.length === 1
                  ? t('cx.ca.activateOn', { card: pickText(chosen.name, locale) })
                  : t('cx.ca.activate')}
              </Button>
            </div>
          </>
        ) : s.state === 'NEEDS_CARD' ? (
          <>
            <span className="dd-caption">
              {status === 'authenticated' ? t('cx.ca.needsCard') : t('cx.ca.signIn')}
            </span>
            {issuers ? (
              <span className="dd-caption">{t('cx.ca.worksWith', { issuers })}</span>
            ) : null}
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  router.push(
                    status === 'authenticated'
                      ? `${href('/benefits')}?add=card`
                      : signInPath(href, 'unlock'),
                  )
                }
                data-testid="card-offer-add"
              >
                {status === 'authenticated' ? t('cx.ca.addCard') : t('auth.signIn')}
              </Button>
            </div>
          </>
        ) : (
          <span className="dd-caption" data-testid="card-offer-unavailable">
            {t('cx.ca.unavailable')}
          </span>
        )}
      </div>
    </section>
  );
}

/** My benefits: the card offers the customer activated, with whether each is still usable. */
export function ActivatedOffers() {
  const { t, locale } = useT();
  const { call } = useApi();
  const href = useHref();
  const [items, setItems] = useState<Array<{
    product: 'LIVE' | 'HOT' | 'VOUCHER';
    offerId: string;
    title: { en: string; ar: string };
    merchantName: { en: string; ar: string };
    cardName: { en: string; ar: string };
    activatedAt: string;
    status: 'ACTIVE' | 'ENDED' | 'CARD_REMOVED';
  }> | null>(null);
  useEffect(() => {
    void call<typeof items>('GET', '/v1/app/card-offers').then((r) =>
      setItems(r.ok && Array.isArray(r.data) ? r.data : []),
    );
  }, [call]);
  if (!items) return <LoadingState label={t('state.loading')} />;
  if (!items.length) return <EmptyState title={t('cx.ca.empty')} />;
  const path = (p: string, id: string) =>
    p === 'LIVE' ? `/deals/${id}` : p === 'HOT' ? `/hot/${id}` : `/vouchers/${id}`;
  return (
    <ul className="dd-benlist" data-testid="activated-offers">
      {items.map((a) => (
        <li key={`${a.product}:${a.offerId}`} className="dd-benlist__item">
          <Link className="dd-benlist__link" href={href(path(a.product, a.offerId))}>
            <div className="dd-grow">
              <strong className="dd-benlist__title">{pickText(a.title, locale)}</strong>
              <div className="dd-caption">
                {pickText(a.merchantName, locale)} ·{' '}
                {t('cx.ca.activated', { card: pickText(a.cardName, locale) })}
              </div>
              <div className="dd-caption">
                {t('cx.ca.activatedOn', { date: formatDate(locale, a.activatedAt) })}
              </div>
            </div>
            <StatusChip tone={a.status === 'ACTIVE' ? 'success' : 'neutral'}>
              {t(`cx.ca.st.${a.status}` as DictionaryKey)}
            </StatusChip>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- Log my saving
const toMinor = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export function LogSaving({
  sourceType,
  sourceId,
}: {
  sourceType: 'RESERVATION' | 'VOUCHER';
  sourceId: string;
}) {
  const { t, locale } = useT();
  const { call } = useApi();
  const href = useHref();
  const [s, setS] = useState<SavingState | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  useEffect(() => {
    let alive = true;
    void call<SavingState>('GET', `/v1/app/savings/${sourceType}/${sourceId}`).then((r) => {
      if (!alive || !r.ok || !r.data || typeof r.data.canLog !== 'boolean') return;
      setS(r.data);
      if (r.data.suggestedMinor) setValue((r.data.suggestedMinor / 100).toFixed(2));
    });
    return () => {
      alive = false;
    };
  }, [call, sourceType, sourceId]);
  if (!s || (!s.canLog && !s.logged)) return null;
  const currency = s.currency ?? 'SAR';
  if (s.logged)
    return (
      <section className="dd-saving dd-saving--done" data-testid="saving-logged">
        <span className="dd-saving__icon" aria-hidden="true">
          <Icon name="piggy" size={22} />
        </span>
        <div className="dd-grow">
          {thanks ? <strong style={{ display: 'block' }}>{t('cx.sv.thanks')}</strong> : null}
          <span>
            {t('cx.sv.logged', {
              amount: formatMoney(locale, s.logged.amountMinor, s.logged.currency),
            })}
          </span>
          <div className="dd-caption">
            {t('cx.sv.loggedOn', { date: formatDate(locale, s.logged.createdAt) })} ·{' '}
            <Link className="dd-link" href={href('/savings')}>
              {t('cx.sv.view')}
            </Link>
          </div>
        </div>
      </section>
    );
  const submit = async () => {
    const amountMinor = toMinor(value);
    if (!Number.isFinite(amountMinor) || amountMinor < 1) return setError(t('cx.sv.invalid'));
    setBusy(true);
    setError(null);
    const r = await call<SavingState>('POST', '/v1/app/savings', {
      body: { sourceType, sourceId, amountMinor },
      idempotent: true,
    });
    setBusy(false);
    if (r.ok && r.data) {
      setS(r.data);
      setThanks(true);
    } else setError(errorMessage(locale, r.errors));
  };
  return (
    <section className="dd-saving" data-testid="log-saving">
      <span className="dd-saving__icon" aria-hidden="true">
        <Icon name="piggy" size={22} />
      </span>
      <form
        className="dd-grow dd-stack"
        style={{ gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <strong>{t('cx.sv.title')}</strong>
        <span className="dd-caption">{t('cx.sv.body')}</span>
        <Field
          label={t('cx.sv.amount', { currency })}
          htmlFor="saving-amount"
          error={error ?? undefined}
        >
          <Input
            id="saving-amount"
            inputMode="decimal"
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
            data-testid="saving-amount"
          />
        </Field>
        {s.suggestedMinor ? (
          <span className="dd-caption">
            {t('cx.sv.suggested', { amount: formatMoney(locale, s.suggestedMinor, currency) })}
          </span>
        ) : null}
        <div>
          <Button type="submit" size="sm" loading={busy} data-testid="saving-submit">
            {t('cx.sv.log')}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** The running total (My Deals and the savings page), per currency; nothing until something is logged. */
export function SavingsBanner() {
  const { t, locale } = useT();
  const { call } = useApi();
  const href = useHref();
  const [s, setS] = useState<SavingsSummary | null>(null);
  useEffect(() => {
    void call<SavingsSummary>('GET', '/v1/app/savings').then((r) => {
      if (r.ok && r.data && Array.isArray(r.data.totals)) setS(r.data);
    });
  }, [call]);
  const top = s?.totals[0];
  if (!top) return null;
  return (
    <Link className="dd-savingsbanner" href={href('/savings')} data-testid="savings-banner">
      <Icon name="piggy" size={22} />
      <span className="dd-grow">
        <strong>
          {t('cx.sv.total', { amount: formatMoney(locale, top.amountMinor, top.currency) })}
        </strong>
        <span className="dd-caption" style={{ display: 'block' }}>
          {t('cx.sv.count', { n: top.count })}
        </span>
      </span>
      <Icon name="forward" size={18} />
    </Link>
  );
}

export function SavingsPage() {
  const { t, locale } = useT();
  const { status } = useAuth();
  const { call } = useApi();
  const [s, setS] = useState<SavingsSummary | null>(null);
  useEffect(() => {
    if (status !== 'authenticated') return;
    void call<SavingsSummary>('GET', '/v1/app/savings').then((r) =>
      setS(r.ok && r.data ? r.data : { totals: [], items: [] }),
    );
  }, [call, status]);
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated')
    return (
      <div className="dd-stack">
        <h1 className="dd-title-xl">{t('cx.sv.pageTitle')}</h1>
        <LoginPanel />
      </div>
    );
  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="savings-page">
      <h1 className="dd-title-xl">{t('cx.sv.pageTitle')}</h1>
      {!s ? (
        <LoadingState label={t('state.loading')} />
      ) : !s.items.length ? (
        <EmptyState title={t('cx.sv.empty')} description={t('cx.sv.emptyBody')} />
      ) : (
        <>
          {s.totals.map((tot) => (
            <div key={tot.currency} className="dd-paytotal" data-testid="savings-total">
              <div>
                <span>{t('cx.sv.pageTitle')}</span>
                <strong className="dd-ltr">
                  {formatMoney(locale, tot.amountMinor, tot.currency)}
                </strong>
              </div>
              <div style={{ textAlign: 'end' }}>
                <span>{t('cx.sv.count', { n: tot.count })}</span>
              </div>
            </div>
          ))}
          <ul className="dd-benlist">
            {s.items.map((i) => (
              <li key={i.id} className="dd-benlist__item" data-testid="saving-row">
                <div className="dd-grow">
                  <strong className="dd-benlist__title">
                    {pickText(i.merchantName, locale)} · {pickText(i.title, locale)}
                  </strong>
                  <div className="dd-caption">
                    {t('cx.sv.loggedOn', { date: formatDate(locale, i.createdAt) })}
                  </div>
                </div>
                <strong className="dd-ltr">{formatMoney(locale, i.amountMinor, i.currency)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Employee Pass
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function EmployeePassPage() {
  const { t, locale } = useT();
  const { status } = useAuth();
  const { call } = useApi();
  const href = useHref();
  const { city } = useCustomer();
  const now = useClock();
  const [pass, setPass] = useState<EmployeePass | null>(null);
  const [failed, setFailed] = useState(false);
  const [offers, setOffers] = useState<BenefitOffer[] | null>(null);
  const load = useCallback(async () => {
    setFailed(false);
    const r = await call<EmployeePass>('GET', '/v1/app/benefits/employee-pass');
    if (r.ok && r.data && typeof r.data.status === 'string') setPass(r.data);
    else setFailed(true);
  }, [call]);
  useEffect(() => {
    if (status === 'authenticated') void load();
  }, [load, status]);
  const employerId = pass?.employer?.id ?? null;
  const active = pass?.status === 'ACTIVE';
  useEffect(() => {
    if (!active || !employerId) return;
    void call<BenefitOffer[]>('GET', '/v1/app/benefits/offers', {
      query: { tab: 'unlocked', city },
    }).then((r) =>
      setOffers(
        r.ok && Array.isArray(r.data)
          ? r.data.filter((o) => o.partners.some((p) => p.id === employerId))
          : [],
      ),
    );
  }, [active, call, city, employerId]);

  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status !== 'authenticated')
    return (
      <div className="dd-stack" data-testid="employee-pass-signin">
        <h1 className="dd-title-xl">{t('cx.ep.title')}</h1>
        <p>{t('cx.ep.signIn')}</p>
        <LoginPanel />
      </div>
    );
  if (failed)
    return (
      <div className="dd-stack">
        <h1 className="dd-title-xl">{t('cx.ep.title')}</h1>
        <Alert tone="danger">{t('cust.loadError')}</Alert>
        <Button variant="outline" onClick={() => void load()}>
          {t('cust.retry')}
        </Button>
      </div>
    );
  if (!pass) return <LoadingState label={t('state.loading')} />;
  const time = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : `${locale}-u-nu-latn`, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="employee-pass">
      <h1 className="dd-title-xl">{t('cx.ep.title')}</h1>
      <section
        className={`dd-epass ${active ? 'dd-epass--active' : 'dd-epass--inactive'}`}
        aria-label={t('cx.ep.title')}
      >
        <div className="dd-epass__top">
          <span className="dd-epass__brand" aria-hidden="true">
            Deal<span>Dash</span>
          </span>
          <span className="dd-epass__status" data-testid="employee-pass-status">
            {active ? t('cx.ep.active') : t('cx.ep.inactive')}
          </span>
        </div>
        <div className="dd-epass__employer">
          <Icon name="badge" size={22} />
          <div>
            <span className="dd-epass__label">{t('cx.ep.employer')}</span>
            <strong data-testid="employee-pass-employer">
              {pass.employer ? pickText(pass.employer.name, locale) : '—'}
            </strong>
            {pass.programName ? (
              <span className="dd-epass__sub">{pickText(pass.programName, locale)}</span>
            ) : null}
          </div>
        </div>
        <dl className="dd-epass__grid">
          <div>
            <dt>{t('cx.ep.holder')}</dt>
            <dd>{pass.holderName ?? '—'}</dd>
          </div>
          <div>
            <dt>{t('cx.ep.number')}</dt>
            <dd className="dd-ltr" data-testid="employee-pass-number">
              {pass.passNumber ?? '—'}
            </dd>
          </div>
          {pass.maskedEmail ? (
            <div>
              <dt>{t('cx.ep.workEmail')}</dt>
              <dd className="dd-ltr">{pass.maskedEmail}</dd>
            </div>
          ) : null}
        </dl>
        {pass.validUntil ? (
          <p className="dd-epass__valid" data-testid="employee-pass-valid">
            {t('cx.ep.validUntil', { date: formatDate(locale, pass.validUntil) })}
          </p>
        ) : null}
        {active ? (
          <div className="dd-epass__live" aria-live="off" data-testid="employee-pass-live">
            <span className="dd-epass__dot" aria-hidden="true" />
            {t('cx.ep.live', { time })}
          </div>
        ) : null}
      </section>
      {active ? (
        <p className="dd-caption" style={{ margin: 0 }}>
          {t('cx.ep.show')}
        </p>
      ) : null}
      {pass.reason !== 'VERIFIED' ? (
        <div className="dd-stack" style={{ gap: 8 }} data-testid="employee-pass-reason">
          <Alert tone={active ? 'warning' : 'info'}>
            {t(`cx.ep.reason.${pass.reason}` as DictionaryKey)}
          </Alert>
          <Link
            className="dd-btn dd-btn--primary dd-btn--block"
            href={`${href('/benefits')}?add=employer`}
          >
            {pass.reason === 'NONE' || pass.reason === 'PENDING'
              ? t('cx.ep.verify')
              : t('cx.ep.renew')}
          </Link>
        </div>
      ) : null}
      {active && pass.employer ? (
        <section className="dd-stack" style={{ gap: 10 }}>
          <h2 className="dd-title">
            {t('cx.ep.offers', { employer: pickText(pass.employer.name, locale) })}
          </h2>
          {offers === null ? (
            <LoadingState label={t('state.loading')} />
          ) : !offers.length ? (
            <EmptyState title={t('cx.ep.noOffers')} />
          ) : (
            <div className="dd-cardgrid" data-testid="employee-pass-offers">
              {offers.map((o) =>
                o.product === 'LIVE' ? (
                  <TrackedCard key={`L${o.card.id}`} deal={o.card} variant="list" />
                ) : o.product === 'HOT' ? (
                  <TrackedHotCard key={`H${o.card.id}`} deal={o.card} variant="list" />
                ) : (
                  <TrackedVoucherCard key={`V${o.card.id}`} voucher={o.card} variant="list" />
                ),
              )}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- per-deal reviews
/** A deal's own reviews and rating summary (one request, shared by the header rating and the Reviews tab). */
export function useDealReviews(product: 'hot-deals' | 'vouchers', dealId: string) {
  const { call } = useApi();
  const { status } = useAuth();
  const [data, setData] = useState<DealReviews | null>(null);
  const load = useCallback(async () => {
    const r = await call<DealReviews>('GET', `/v1/app/${product}/${dealId}/reviews`);
    if (r.ok && r.data && r.data.summary && Array.isArray(r.data.items)) setData(r.data);
  }, [call, product, dealId]);
  useEffect(() => {
    if (status !== 'loading') void load();
  }, [load, status]);
  return { data, reload: load };
}

export function DealReviewsPanel({
  product,
  dealId,
  merchantId,
  merchantName,
  reviews,
  reload,
}: {
  product: 'hot-deals' | 'vouchers';
  dealId: string;
  merchantId: string;
  merchantName: string;
  reviews: DealReviews | null;
  reload: () => Promise<void>;
}) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const [writing, setWriting] = useState(false);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const submit = async () => {
    setBusy(true);
    setBanner(null);
    const r = await call<{ status?: string }>('POST', `/v1/app/${product}/${dealId}/reviews`, {
      body: { rating, text: text.trim(), locale: locale === 'ar' ? 'ar' : 'en' },
      idempotent: true,
    });
    setBusy(false);
    if (!r.ok) return setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
    setBanner({
      tone: 'success',
      text: r.data?.status === 'PENDING_REVIEW' ? t('cx.rv.pending') : t('cx.rv.thanks'),
    });
    setWriting(false);
    setText('');
    setRating(0);
    await reload();
  };
  const s = reviews?.summary;
  const mine = reviews?.mine ?? null;
  return (
    <div className="dd-stack" style={{ gap: 16 }}>
      <section className="dd-stack" style={{ gap: 10 }} data-testid="deal-reviews">
        <h2 className="dd-title">{t('cx.rv.title')}</h2>
        {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}
        {!reviews ? (
          <LoadingState label={t('state.loading')} />
        ) : (
          <>
            {s && s.count ? (
              <div className="dd-revsum" data-testid="deal-review-summary">
                <div className="dd-revsum__avg">
                  <strong className="dd-ltr">{(s.average ?? 0).toFixed(1)}</strong>
                  <span className="dd-stars" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Icon
                        key={i}
                        name="star"
                        size={14}
                        filled={i <= Math.round(s.average ?? 0)}
                      />
                    ))}
                  </span>
                  <span className="dd-caption">{t('cx.m.reviews', { n: s.count })}</span>
                </div>
                <ul className="dd-revsum__bars">
                  {s.distribution.map((n, i) => (
                    <li key={i}>
                      <span className="dd-ltr">{5 - i}</span>
                      <span className="dd-revsum__bar" aria-hidden="true">
                        <span style={{ inlineSize: `${s.count ? (n / s.count) * 100 : 0}%` }} />
                      </span>
                      <span className="dd-caption dd-ltr">{n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="dd-caption" style={{ margin: 0 }}>
                {t('cx.rv.none')}
              </p>
            )}
            {status !== 'authenticated' ? (
              <p className="dd-caption" style={{ margin: 0 }}>
                {t('cx.rv.signIn')}
              </p>
            ) : mine?.canReview ? (
              writing ? (
                <Card flat>
                  <form
                    className="dd-stack"
                    style={{ gap: 10 }}
                    data-testid="deal-review-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (rating && text.trim().length >= 10) void submit();
                    }}
                  >
                    <div role="radiogroup" aria-label={t('cx.rv.rating')} className="dd-starpick">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={rating === n}
                          aria-label={t('cx.rv.star', { n })}
                          onClick={() => setRating(n)}
                          data-testid={`star-${n}`}
                        >
                          <Icon name="star" size={28} filled={n <= rating} />
                        </button>
                      ))}
                    </div>
                    <Field
                      label={t('cx.rv.text')}
                      htmlFor="deal-review-text"
                      help={t('cx.rv.help')}
                    >
                      <Textarea
                        id="deal-review-text"
                        rows={3}
                        maxLength={2000}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                      />
                    </Field>
                    <div className="dd-row">
                      <Button
                        type="submit"
                        loading={busy}
                        disabled={!rating || text.trim().length < 10}
                        data-testid="deal-review-post"
                      >
                        {t('cx.rv.post')}
                      </Button>
                      <Button variant="ghost" onClick={() => setWriting(false)}>
                        {t('cx.rv.cancel')}
                      </Button>
                    </div>
                  </form>
                </Card>
              ) : (
                <div>
                  <Button
                    variant="outline"
                    onClick={() => setWriting(true)}
                    data-testid="deal-review-write"
                  >
                    <Icon name="star" size={16} /> {t('cx.rv.write')}
                  </Button>
                </div>
              )
            ) : mine?.reason ? (
              <p className="dd-caption" style={{ margin: 0 }} data-testid="deal-review-why">
                {mine.reason === 'NOT_REDEEMED'
                  ? t('cx.rv.notRedeemed')
                  : mine.reason === 'ALREADY_REVIEWED'
                    ? t('cx.rv.already')
                    : t('cx.rv.limit')}
              </p>
            ) : null}
            {reviews.items.map((r) => (
              <Card flat key={r.id}>
                <div className="dd-stack" style={{ gap: 4 }} data-testid="deal-review">
                  <div
                    className="dd-row"
                    style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}
                  >
                    <span className="dd-row" style={{ gap: 6 }}>
                      <span className="dd-stars" aria-label={t('cx.rv.star', { n: r.rating })}>
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Icon key={i} name="star" size={13} filled={i <= r.rating} />
                        ))}
                      </span>
                      <strong>{r.author ?? ''}</strong>
                    </span>
                    {r.verified ? (
                      <StatusChip tone="success">{t('cx.rv.verified')}</StatusChip>
                    ) : null}
                  </div>
                  <div>{r.text}</div>
                  <span className="dd-caption">{formatDate(locale, r.createdAt)}</span>
                </div>
              </Card>
            ))}
          </>
        )}
      </section>
      <section className="dd-stack" style={{ gap: 6 }}>
        <h2 className="dd-title">{t('cx.rv.merchant', { merchant: merchantName })}</h2>
        <MerchantReviews merchantId={merchantId} hideTitle />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- merchant gallery
/** The merchant's photos: its cover first, then its gallery (no duplicates). */
export const merchantPhotos = (page: { coverUrl: string | null; gallery?: string[] }) => [
  ...new Set([page.coverUrl, ...(page.gallery ?? [])].filter((u): u is string => !!u)),
];

/** Swipeable header photos with a counter; tapping opens the full-screen viewer. Empty: the brand background only. */
export function MerchantHeroGallery({
  photos,
  onOpen,
}: {
  photos: string[];
  onOpen: (i: number) => void;
}) {
  const { t } = useT();
  const [i, setI] = useState(0);
  if (!photos.length)
    return <div className="dd-mp__ph" aria-hidden="true" data-testid="merchant-gallery-empty" />;
  return (
    <>
      <div
        className="dd-mp__gallery"
        data-testid="merchant-gallery"
        onScroll={(e) => {
          const el = e.currentTarget;
          setI(Math.round(Math.abs(el.scrollLeft) / Math.max(1, el.clientWidth)));
        }}
      >
        {photos.map((p, n) => (
          <button
            key={p}
            type="button"
            onClick={() => onOpen(n)}
            aria-label={t('cx.g.open', { n: n + 1, total: photos.length })}
          >
            <img src={p} alt="" loading={n ? 'lazy' : 'eager'} />
          </button>
        ))}
      </div>
      {photos.length > 1 ? (
        <span className="dd-dd__count dd-ltr" data-testid="merchant-photo-count">
          {Math.min(i, photos.length - 1) + 1}/{photos.length}
        </span>
      ) : null}
    </>
  );
}

export function PhotoViewer({
  photos,
  start,
  onClose,
}: {
  photos: string[];
  start: number;
  onClose: () => void;
}) {
  const { t, locale } = useT();
  return (
    <div
      className="dd-photoviewer"
      role="dialog"
      aria-modal="true"
      aria-label={t('cx.g.photos')}
      data-testid="merchant-photo-viewer"
    >
      <button
        type="button"
        className="dd-photoviewer__close"
        onClick={onClose}
        aria-label={t('common.close')}
      >
        <Icon name="x" size={22} />
      </button>
      <div
        className="dd-photoviewer__strip"
        ref={(el) => {
          if (el && start > 0) el.scrollLeft = (locale === 'en' ? 1 : -1) * start * el.clientWidth;
        }}
      >
        {photos.map((p, i) => (
          <figure key={p}>
            <img src={p} alt="" />
            <figcaption className="dd-ltr">
              {i + 1}/{photos.length}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** Info tab: every photo as a grid (or a short note when the merchant has none yet). */
export function MerchantPhotoGrid({
  photos,
  onOpen,
}: {
  photos: string[];
  onOpen: (i: number) => void;
}) {
  const { t } = useT();
  return (
    <section className="dd-stack" style={{ gap: 8 }} data-testid="merchant-photos">
      <h2 className="dd-title">{t('cx.g.photos')}</h2>
      {photos.length ? (
        <div className="dd-hot-photos">
          {photos.map((p, i) => (
            <button
              key={p}
              type="button"
              onClick={() => onOpen(i)}
              aria-label={t('cx.g.open', { n: i + 1, total: photos.length })}
            >
              <img src={p} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : (
        <p className="dd-caption" style={{ margin: 0 }}>
          {t('cx.g.none')}
        </p>
      )}
    </section>
  );
}
