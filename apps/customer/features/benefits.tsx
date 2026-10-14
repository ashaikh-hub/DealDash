'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon, errorMessage, pickText, useApi, useAuth } from '@dealdash/app-shell';
import { formatDate, formatNumber, type DictionaryKey } from '@dealdash/localization';
import type {
  BenefitEmployerStartResult,
  BenefitHistoryItem,
  BenefitOffer,
  BenefitOptions,
  BenefitsOverview,
  BenefitUsageItem,
} from '@dealdash/validation';
import {
  BottomSheet,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
  StatusChip,
  Tabs,
} from '@dealdash/ui';
import { useCustomer } from './customer-context';
import { TrackedHotCard } from './hot';
import { TrackedCard, useHref, useT } from './parts';
import { TrackedVoucherCard } from './vouchers';

type Section = 'unlocked' | 'available' | 'active' | 'used' | 'expired' | 'history';
const SECTIONS: Section[] = ['unlocked', 'available', 'active', 'used', 'expired', 'history'];

const EMPLOYER_TONE = {
  PENDING: 'warning',
  VERIFIED: 'success',
  REVERIFICATION_DUE: 'warning',
  EXPIRED: 'danger',
  FAILED: 'danger',
  REVOKED: 'neutral',
} as const;

/**
 * Customer "My benefits" (Business Rules §5 EL, §6 EM, §7 BC): the customer's employer (work-email code) and added cards, the offers
 * they unlock (and could unlock), the benefits in use / used / expired with their redemption status, and the benefit history. Offers
 * are shown with the approved product cards; the partner behind each benefit is named. Cards are "added", never "verified".
 */
export function BenefitsPage() {
  const { t, locale } = useT();
  const { call } = useApi();
  const { status } = useAuth();
  const router = useRouter();
  const href = useHref();
  const params = useSearchParams();
  const { city } = useCustomer();
  const signedIn = status === 'authenticated';
  const [overview, setOverview] = useState<BenefitsOverview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [section, setSection] = useState<Section>('unlocked');
  const [sheet, setSheet] = useState<'employer' | 'card' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    const r = await call<BenefitsOverview>('GET', '/v1/app/benefits', { query: { city } });
    if (r.ok && r.data) {
      setOverview(r.data);
      setState('ready');
    } else setState('error');
  }, [call, city]);

  useEffect(() => {
    if (status === 'loading') return;
    if (signedIn) void load();
  }, [load, signedIn, status]);

  // deep links from a locked offer ("Verify your employer" / "Add your card")
  useEffect(() => {
    const add = params.get('add');
    if (signedIn && (add === 'employer' || add === 'card')) setSheet(add);
  }, [params, signedIn]);

  if (status !== 'loading' && !signedIn)
    return (
      <div className="dd-stack" data-testid="benefits-signin">
        <h1 className="dd-title-xl">{t('ben.title')}</h1>
        <section className="dd-rewardcard dd-rewardcard--stack">
          <div className="dd-rewardcard__body">
            <span className="dd-rewardcard__kicker">
              <Icon name="tag" size={16} /> {t('ben.title')}
            </span>
            <h2 className="dd-rewardcard__title">{t('ben.signInTitle')}</h2>
            <p className="dd-rewardcard__text">{t('ben.signInBody')}</p>
          </div>
          <button
            type="button"
            className="dd-rewardcard__cta"
            onClick={() => router.push(href('/profile') + '?reason=unlock')}
          >
            {t('auth.signIn')}
          </button>
        </section>
      </div>
    );

  const changed = (o: BenefitsOverview, message?: string) => {
    setOverview(o);
    setSheet(null);
    if (message) setNotice(message);
  };

  const removeEmployer = async () => {
    const r = await call<BenefitsOverview>('DELETE', '/v1/app/benefits/employer');
    setConfirmRemove(false);
    if (r.ok && r.data) changed(r.data);
    else setNotice(errorMessage(locale, r.errors));
  };
  const removeCard = async (programId: string) => {
    const r = await call<BenefitsOverview>('DELETE', `/v1/app/benefits/cards/${programId}`);
    if (r.ok && r.data) changed(r.data);
    else setNotice(errorMessage(locale, r.errors));
  };

  const employer = overview?.employer ?? null;
  // EM-20: renewal date (then the grace period runs to expiresAt); older verifications have no separate renewal date
  const renewDue = employer ? (employer.renewDueAt ?? employer.expiresAt) : null;
  const renewSoon =
    employer?.status === 'VERIFIED' &&
    !!employer.renewFrom &&
    new Date(employer.renewFrom).getTime() <= Date.now();
  const counts = overview?.counts;
  const tabLabel = (s: Section) => {
    const n = counts && s !== 'history' ? counts[s] : null;
    return n
      ? `${t(`ben.tab.${s}` as DictionaryKey)} · ${formatNumber(locale, n)}`
      : t(`ben.tab.${s}` as DictionaryKey);
  };

  return (
    <div className="dd-stack dd-benefits" style={{ gap: 18 }} data-testid="benefits">
      <div>
        <h1 className="dd-title-xl">{t('ben.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('ben.sub')}
        </p>
      </div>

      {notice ? (
        <div className="dd-install" role="status">
          <span className="dd-install__text">{notice}</span>
          <button
            type="button"
            className="dd-install__close"
            aria-label={t('shell.installDismiss')}
            onClick={() => setNotice('')}
          >
            ×
          </button>
        </div>
      ) : null}

      {state === 'loading' && !overview ? (
        <div className="dd-stack" aria-busy="true">
          <Skeleton height={120} />
          <Skeleton height={120} />
        </div>
      ) : state === 'error' && !overview ? (
        <ErrorState title={t('ben.loadError')} retryLabel={t('cust.retry')} onRetry={load} />
      ) : overview ? (
        <>
          {/* employer */}
          <section className="dd-bencard" data-testid="benefit-employer">
            <div className="dd-bencard__head">
              <span className="dd-bencard__icon dd-bencard__icon--employer" aria-hidden="true">
                <Icon name="user" size={20} />
              </span>
              <h2 className="dd-bencard__title">{t('ben.employer.title')}</h2>
              {employer ? (
                <StatusChip tone={EMPLOYER_TONE[employer.status]}>
                  {t(`ben.status.${employer.status}` as DictionaryKey)}
                </StatusChip>
              ) : null}
            </div>
            {employer ? (
              <div className="dd-stack" style={{ gap: 6 }}>
                <strong>{pickText(employer.partner.name, locale)}</strong>
                {employer.maskedEmail ? (
                  <span className="dd-caption dd-ltr">{employer.maskedEmail}</span>
                ) : null}
                {employer.verifiedAt && employer.status !== 'PENDING' ? (
                  <span className="dd-caption">
                    {t('ben.employer.verifiedOn', {
                      date: formatDate(locale, employer.verifiedAt),
                    })}
                  </span>
                ) : null}
                {renewDue && employer.status === 'VERIFIED' ? (
                  <span className="dd-caption">
                    {t('ben.employer.renewBy', { date: formatDate(locale, renewDue) })}
                  </span>
                ) : null}
                {renewSoon && renewDue ? (
                  <span className="dd-help" data-testid="employer-renew-soon">
                    {t('ben.employer.renewFrom', { date: formatDate(locale, renewDue) })}
                  </span>
                ) : null}
                {/* EM-20 grace period: renewal is due but the offers keep working until the end date */}
                {employer.status === 'REVERIFICATION_DUE' && employer.expiresAt ? (
                  <span className="dd-help" data-testid="employer-grace">
                    {t('ben.employer.grace', { date: formatDate(locale, employer.expiresAt) })}
                  </span>
                ) : null}
                {employer.status === 'EXPIRED' ? (
                  <span className="dd-help">{t('ben.employer.expiredHelp')}</span>
                ) : null}
                <div className="dd-row" style={{ marginBlockStart: 6 }}>
                  {employer.status === 'VERIFIED' && !renewSoon ? null : (
                    <Button size="sm" onClick={() => setSheet('employer')}>
                      {employer.status === 'PENDING' || employer.status === 'FAILED'
                        ? t('ben.sheet.verify')
                        : t('ben.employer.renew')}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setSheet('employer')}>
                    {t('ben.employer.change')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmRemove(true)}
                    data-testid="employer-remove"
                  >
                    {t('ben.employer.remove')}
                  </Button>
                </div>
                {confirmRemove ? (
                  <div className="dd-bencard__confirm" role="alert">
                    <p style={{ margin: 0 }}>{t('ben.employer.removeConfirm')}</p>
                    <div className="dd-row">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void removeEmployer()}
                        data-testid="employer-remove-confirm"
                      >
                        {t('ben.employer.remove')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>
                        {t('shell.installDismiss')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="dd-stack" style={{ gap: 10 }}>
                <p className="dd-muted" style={{ margin: 0 }}>
                  {t('ben.employer.none')}
                </p>
                <div>
                  <Button size="sm" onClick={() => setSheet('employer')} data-testid="employer-add">
                    {t('ben.employer.add')}
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* cards */}
          <section className="dd-bencard" data-testid="benefit-cards">
            <div className="dd-bencard__head">
              <span className="dd-bencard__icon dd-bencard__icon--card" aria-hidden="true">
                <Icon name="ticket" size={20} />
              </span>
              <h2 className="dd-bencard__title">{t('ben.cards.title')}</h2>
            </div>
            {overview.cards.length ? (
              <ul className="dd-benlist">
                {overview.cards.map((c) => (
                  <li key={c.programId} className="dd-benlist__item" data-testid="benefit-card">
                    <div className="dd-grow">
                      <strong>{pickText(c.name, locale)}</strong>
                      <div className="dd-caption">
                        {pickText(c.issuer.name, locale)} ·{' '}
                        <span className="dd-ltr">{c.scheme.toUpperCase()}</span> · {c.tier}
                      </div>
                    </div>
                    <StatusChip tone="info">{t('ben.cards.added')}</StatusChip>
                    <Button size="sm" variant="ghost" onClick={() => void removeCard(c.programId)}>
                      {t('ben.cards.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dd-muted" style={{ margin: 0 }}>
                {t('ben.cards.none')}
              </p>
            )}
            {overview.cards.length >= overview.maxCards ? (
              <p className="dd-help">
                {t('ben.cards.limit', { n: formatNumber(locale, overview.maxCards) })}
              </p>
            ) : (
              <div>
                <Button
                  size="sm"
                  variant={overview.cards.length ? 'outline' : 'primary'}
                  onClick={() => setSheet('card')}
                  data-testid="card-add"
                >
                  {t('ben.cards.add')}
                </Button>
              </div>
            )}
            <p className="dd-caption" style={{ margin: 0 }}>
              {t('ben.cards.note')}
            </p>
          </section>

          <div className="dd-bentabs">
            <Tabs
              label={t('ben.tabs')}
              value={section}
              onChange={(id) => setSection(id as Section)}
              tabs={SECTIONS.map((s) => ({ id: s, label: tabLabel(s) }))}
            />
          </div>
          {section === 'unlocked' || section === 'available' ? (
            <OffersSection
              tab={section}
              key={`${section}:${overview.cards.length}:${employer?.status ?? ''}`}
            />
          ) : section === 'history' ? (
            <HistorySection />
          ) : (
            <UsageSection tab={section} />
          )}
        </>
      ) : null}

      <EmployerSheet
        open={sheet === 'employer'}
        onClose={() => setSheet(null)}
        onDone={(o) => changed(o)}
      />
      <CardSheet
        open={sheet === 'card'}
        onClose={() => setSheet(null)}
        onDone={(o) => changed(o)}
        mine={overview?.cards.map((c) => c.programId) ?? []}
      />
    </div>
  );
}

// ---------------------------------------------------------------- sections
function SectionState({ title, body }: { title: string; body?: string }) {
  return <EmptyState title={title} description={body} />;
}

function OffersSection({ tab }: { tab: 'unlocked' | 'available' }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { city, coords, approximate } = useCustomer();
  const [items, setItems] = useState<BenefitOffer[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    setItems(null);
    const r = await call<BenefitOffer[]>('GET', '/v1/app/benefits/offers', {
      query: {
        tab,
        city,
        lat: approximate ? undefined : coords.lat,
        lng: approximate ? undefined : coords.lng,
      },
    });
    if (r.ok && r.data) setItems(r.data);
    else setFailed(true);
  }, [call, tab, city, coords.lat, coords.lng, approximate]);
  useEffect(() => {
    void load();
  }, [load]);
  if (failed)
    return <ErrorState title={t('ben.loadError')} retryLabel={t('cust.retry')} onRetry={load} />;
  if (!items) return <Skeleton height={160} />;
  if (!items.length)
    return tab === 'unlocked' ? (
      <SectionState title={t('ben.empty.unlocked')} body={t('ben.empty.unlockedBody')} />
    ) : (
      <SectionState title={t('ben.empty.available')} body={t('ben.empty.availableBody')} />
    );
  return (
    <div className="dd-cardgrid" data-testid={`benefit-offers-${tab}`}>
      {items.map((o) => (
        <div key={`${o.product}:${o.card.id}`} className="dd-stack" style={{ gap: 6 }}>
          {o.partners.length ? (
            <span className="dd-benvia">
              <Icon name="tag" size={13} />{' '}
              {t('ben.via', {
                partner: o.partners.map((p) => pickText(p.name, locale)).join(' · '),
              })}
            </span>
          ) : null}
          {o.product === 'LIVE' ? (
            <TrackedCard deal={o.card} variant="list" />
          ) : o.product === 'HOT' ? (
            <TrackedHotCard deal={o.card} variant="list" />
          ) : (
            <TrackedVoucherCard voucher={o.card} variant="list" />
          )}
        </div>
      ))}
    </div>
  );
}

function UsageSection({ tab }: { tab: 'active' | 'used' | 'expired' }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const href = useHref();
  const [items, setItems] = useState<BenefitUsageItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    setItems(null);
    const r = await call<BenefitUsageItem[]>('GET', '/v1/app/benefits/usage', { query: { tab } });
    if (r.ok && r.data) setItems(r.data);
    else setFailed(true);
  }, [call, tab]);
  useEffect(() => {
    void load();
  }, [load]);
  if (failed)
    return <ErrorState title={t('ben.loadError')} retryLabel={t('cust.retry')} onRetry={load} />;
  if (!items) return <Skeleton height={120} />;
  if (!items.length) return <SectionState title={t(`ben.empty.${tab}` as DictionaryKey)} />;
  const tone = (s: string) =>
    s === 'HELD' || s === 'ACTIVE' ? 'success' : s === 'REDEEMED' ? 'info' : 'neutral';
  return (
    <ul className="dd-benlist" data-testid={`benefit-usage-${tab}`}>
      {items.map((u) => (
        <li key={u.id} className="dd-benlist__item">
          <Link
            className="dd-benlist__link"
            href={href(u.kind === 'RESERVATION' ? `/reservations/${u.id}` : `/my-vouchers/${u.id}`)}
          >
            <div className="dd-grow">
              <span className="dd-caption">
                {t(`ben.use.${u.kind}` as DictionaryKey)} ·{' '}
                <span className="dd-ltr">{u.reference}</span>
              </span>
              <strong className="dd-benlist__title">{pickText(u.title, locale)}</strong>
              <div className="dd-caption">
                {pickText(u.merchantName, locale)}
                {u.partners.length
                  ? ` · ${t('ben.via', { partner: u.partners.map((p) => pickText(p.name, locale)).join(' · ') })}`
                  : ''}
              </div>
              <div className="dd-caption">
                {u.redeemedAt
                  ? t('ben.use.on', { date: formatDate(locale, u.redeemedAt) })
                  : u.validUntil && tab === 'active'
                    ? t('ben.use.until', { date: formatDate(locale, u.validUntil) })
                    : null}
              </div>
            </div>
            <StatusChip tone={tone(u.status)}>
              {t(`ben.use.${u.status}` as DictionaryKey)}
            </StatusChip>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function HistorySection() {
  const { t, locale } = useT();
  const { call } = useApi();
  const [items, setItems] = useState<BenefitHistoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    const r = await call<BenefitHistoryItem[]>('GET', '/v1/app/benefits/history');
    if (r.ok && r.data) setItems(r.data);
    else setFailed(true);
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);
  if (failed)
    return <ErrorState title={t('ben.loadError')} retryLabel={t('cust.retry')} onRetry={load} />;
  if (!items) return <Skeleton height={120} />;
  if (!items.length) return <SectionState title={t('ben.empty.history')} />;
  return (
    <ol className="dd-benlist dd-benhistory" data-testid="benefit-history">
      {items.map((h, i) => (
        <li key={`${h.at}:${i}`} className="dd-benlist__item">
          <div className="dd-grow">
            <strong className="dd-benlist__title">
              {t(`ben.ev.${h.event}` as DictionaryKey, { name: pickText(h.name, locale) })}
            </strong>
            <div className="dd-caption">{formatDate(locale, h.at)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- add sheets
function EmployerSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (o: BenefitsOverview) => void;
}) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { city } = useCustomer();
  const [options, setOptions] = useState<BenefitOptions['employers'] | null>(null);
  const [programId, setProgramId] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<BenefitEmployerStartResult | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSent(null);
    setCode('');
    setError('');
    void call<BenefitOptions>('GET', '/v1/app/benefits/options', { query: { city } }).then((r) => {
      setOptions(r.ok && r.data ? r.data.employers : []);
      if (r.ok && r.data?.employers.length === 1) setProgramId(r.data.employers[0]!.programId);
    });
  }, [open, call, city]);

  const send = async () => {
    setBusy(true);
    setError('');
    const r = await call<BenefitEmployerStartResult>('POST', '/v1/app/benefits/employer/code', {
      body: { programId, email },
    });
    setBusy(false);
    if (r.ok && r.data) setSent(r.data);
    else setError(errorMessage(locale, r.errors));
  };
  const verify = async () => {
    setBusy(true);
    setError('');
    const r = await call<BenefitsOverview>('POST', '/v1/app/benefits/employer/verify', {
      body: { programId, email, code },
    });
    setBusy(false);
    if (r.ok && r.data) onDone(r.data);
    else setError(errorMessage(locale, r.errors));
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('ben.sheet.employerTitle')}
      closeLabel={t('shell.installDismiss')}
      testId="employer-sheet"
    >
      {options === null ? (
        <Skeleton height={80} />
      ) : !options.length ? (
        <p className="dd-muted">{t('ben.sheet.noEmployers')}</p>
      ) : !sent ? (
        <form
          className="dd-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (programId && email) void send();
          }}
        >
          <Field
            label={t('ben.sheet.chooseEmployer')}
            htmlFor="ben-employer"
            help={t('ben.sheet.notListed')}
          >
            <select
              id="ben-employer"
              className="dd-input"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              required
            >
              <option value="" disabled>
                {t('ben.sheet.chooseEmployer')}
              </option>
              {options.map((o) => (
                <option key={o.programId} value={o.programId}>
                  {pickText(o.partner.name, locale)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t('ben.sheet.email')}
            htmlFor="ben-email"
            help={t('ben.sheet.emailHelp')}
            error={error || undefined}
          >
            <Input
              id="ben-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
            />
          </Field>
          <Button type="submit" loading={busy} disabled={!programId || !email}>
            {t('ben.sheet.sendCode')}
          </Button>
        </form>
      ) : (
        <form
          className="dd-stack"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(code)) void verify();
          }}
        >
          <p style={{ margin: 0 }}>{t('ben.sheet.codeSent', { email: sent.maskedEmail })}</p>
          <Field label={t('ben.sheet.code')} htmlFor="ben-code" error={error || undefined}>
            <Input
              id="ben-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
            />
          </Field>
          <Button type="submit" loading={busy} disabled={code.length !== 6}>
            {t('ben.sheet.verify')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSent(null);
              setCode('');
              setError('');
            }}
          >
            {t('ben.sheet.resend')}
          </Button>
        </form>
      )}
    </BottomSheet>
  );
}

function CardSheet({
  open,
  onClose,
  onDone,
  mine,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (o: BenefitsOverview) => void;
  mine: string[];
}) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { city } = useCustomer();
  const [options, setOptions] = useState<BenefitOptions['cards'] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setError('');
    void call<BenefitOptions>('GET', '/v1/app/benefits/options', { query: { city } }).then((r) =>
      setOptions(r.ok && r.data ? r.data.cards : []),
    );
  }, [open, call, city]);
  const add = async (programId: string) => {
    setBusy(programId);
    setError('');
    const r = await call<BenefitsOverview>('POST', '/v1/app/benefits/cards', {
      body: { programId },
      idempotent: true,
    });
    setBusy(null);
    if (r.ok && r.data) onDone(r.data);
    else setError(errorMessage(locale, r.errors));
  };
  const available = (options ?? []).filter((o) => !mine.includes(o.programId));
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t('ben.sheet.cardTitle')}
      closeLabel={t('shell.installDismiss')}
      testId="card-sheet"
    >
      <p className="dd-caption" style={{ marginBlockStart: 0 }}>
        {t('ben.sheet.cardNote')}
      </p>
      {error ? (
        <p className="dd-error" role="alert">
          {error}
        </p>
      ) : null}
      {options === null ? (
        <Skeleton height={80} />
      ) : !available.length ? (
        <p className="dd-muted">{t('ben.sheet.noCards')}</p>
      ) : (
        <ul className="dd-benlist" aria-label={t('ben.sheet.chooseCard')}>
          {available.map((o) => (
            <li key={o.programId} className="dd-benlist__item">
              <div className="dd-grow">
                <strong>{pickText(o.name, locale)}</strong>
                <div className="dd-caption">
                  {pickText(o.issuer.name, locale)} ·{' '}
                  <span className="dd-ltr">{o.scheme.toUpperCase()}</span> · {o.tier}
                </div>
              </div>
              <Button
                size="sm"
                loading={busy === o.programId}
                onClick={() => void add(o.programId)}
              >
                {t('ben.cards.add')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}
