'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  Icon,
  RequirePermission,
  errorMessage,
  pickText,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  withLocale,
  type DictionaryKey,
} from '@dealdash/localization';
import type { RedemptionResult } from '@dealdash/types';
import {
  Alert,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
} from '@dealdash/ui';
import type { StaffMe } from '@dealdash/validation';

interface Row {
  id: string;
  result: RedemptionResult;
  at: string;
  reference: string | null;
  dealTitle: { en: string; ar: string } | null;
  quantity: number | null;
  customerFirstName: string | null;
  source: 'QR' | 'MANUAL';
  kind?: 'RESERVATION' | 'VOUCHER' | 'PRIZE';
}
interface History {
  counts: { redeemed: number; rejected: number };
  items: Row[];
}

// same semantics as the scan result: green success, amber recoverable, red hard failure
const tone = (r: RedemptionResult) =>
  r === 'REDEEMED' || r === 'VALID'
    ? 'success'
    : r === 'EXPIRED' || r === 'NOT_VALID_YET' || r === 'WRONG_BRANCH'
      ? 'warning'
      : 'danger';

export function HistoryPage() {
  return (
    <RequirePermission any={['merchant.redemptions.read']}>
      <HistoryInner />
    </RequirePermission>
  );
}

function HistoryInner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [day, setDay] = useState<'today' | 'yesterday'>('today');
  const [filter, setFilter] = useState<'all' | 'redeemed' | 'rejected'>('all');
  const [data, setData] = useState<History | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Row | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.replace(/[^A-Za-z0-9]/g, '')), 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setState('loading');
    const r = await call<History>('GET', '/v1/staff/history', {
      query: { day, filter, limit: 100, ...(query.length >= 2 ? { q: query } : {}) },
    });
    if (r.ok && r.data) {
      setData(r.data);
      setState('ready');
    } else {
      setError(
        r.status === 0
          ? createTranslator(locale)('st.offlineBody')
          : errorMessage(locale, r.errors),
      );
      setState('error');
    }
  }, [call, day, filter, query, locale]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="dd-staff" data-testid="staff-history">
      <h1 className="dd-title-xl">{t('st.historyTitle')}</h1>
      <div className="dd-segment" role="group" aria-label={t('st.historyTitle')}>
        {(['today', 'yesterday'] as const).map((d) => (
          <button key={d} type="button" aria-pressed={day === d} onClick={() => setDay(d)}>
            {t(d === 'today' ? 'st.today' : 'st.yesterday')}
          </button>
        ))}
      </div>
      {data ? (
        <div className="dd-kpis">
          <div className="dd-kpi">
            <div className="dd-kpi__n" data-testid="count-redeemed">
              {data.counts.redeemed}
            </div>
            <div className="dd-kpi__l">{t('st.filterRedeemed')}</div>
          </div>
          <div className="dd-kpi">
            <div className="dd-kpi__n" data-testid="count-rejected">
              {data.counts.rejected}
            </div>
            <div className="dd-kpi__l">{t('st.filterRejected')}</div>
          </div>
        </div>
      ) : null}
      <div className="dd-optrow" role="group" aria-label={t('st.historyTitle')}>
        {(['all', 'redeemed', 'rejected'] as const).map((f) => (
          <button
            key={f}
            type="button"
            className={`dd-pill ${filter === f ? 'dd-pill--active' : ''}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {t(
              f === 'all'
                ? 'st.filterAll'
                : f === 'redeemed'
                  ? 'st.filterRedeemed'
                  : 'st.filterRejected',
            )}
          </button>
        ))}
      </div>
      <Field label={t('st.searchLabel')} htmlFor="history-search">
        <Input
          id="history-search"
          type="search"
          dir="ltr"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('st.searchPlaceholder')}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </Field>
      {state === 'loading' ? (
        <LoadingState label={t('state.loading')} />
      ) : state === 'error' ? (
        <Alert tone="danger">
          {error}{' '}
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('st.retry')}
          </Button>
        </Alert>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title={query.length >= 2 ? t('st.noMatches') : t('st.historyEmpty')}
          description={query.length >= 2 ? undefined : t('st.historyEmptyBody')}
        />
      ) : (
        <div className="dd-stack" style={{ gap: 8 }}>
          {data.items.map((r) => (
            <button
              key={r.id}
              type="button"
              className="dd-staffrow"
              data-testid="history-row"
              data-result={r.result}
              onClick={() => setDetail(r)}
            >
              <span className={`dd-chip dd-chip--${tone(r.result)}`}>
                {t(`st.result.${r.result}` as DictionaryKey)}
              </span>
              <div className="dd-grow" style={{ minInlineSize: 0 }}>
                <strong className="dd-clamp">
                  {r.dealTitle ? pickText(r.dealTitle, locale) : '–'}
                </strong>
                <div className="dd-caption">
                  {formatDateTime(locale, r.at)}
                  {r.customerFirstName ? ` · ${r.customerFirstName}` : ''}
                  {r.kind === 'VOUCHER'
                    ? ` · ${t('st.kind.VOUCHER')}`
                    : r.quantity
                      ? ` · ×${r.quantity}`
                      : ''}{' '}
                  · {t(`st.source.${r.source}` as DictionaryKey)}
                </div>
                {r.reference ? <div className="dd-caption dd-ltr">{r.reference}</div> : null}
              </div>
            </button>
          ))}
        </div>
      )}
      <BottomSheet
        open={!!detail}
        onClose={() => setDetail(null)}
        title={t('st.detail.title')}
        closeLabel={t('st.close')}
        testId="history-detail"
        footer={
          <Button className="dd-bigbtn" variant="outline" onClick={() => setDetail(null)}>
            {t('st.close')}
          </Button>
        }
      >
        {detail ? (
          <dl className="dd-result__facts dd-result__facts--sheet">
            <div>
              <dt>{t('st.detail.result')}</dt>
              <dd>
                <span className={`dd-chip dd-chip--${tone(detail.result)}`}>
                  {t(`st.result.${detail.result}` as DictionaryKey)}
                </span>
              </dd>
            </div>
            {detail.dealTitle ? (
              <div>
                <dt>{detail.kind === 'VOUCHER' ? t('st.voucher') : t('st.offer')}</dt>
                <dd>{pickText(detail.dealTitle, locale)}</dd>
              </div>
            ) : null}
            {detail.customerFirstName ? (
              <div>
                <dt>{t('st.customer')}</dt>
                <dd>{detail.customerFirstName}</dd>
              </div>
            ) : null}
            {detail.quantity && detail.kind !== 'VOUCHER' ? (
              <div>
                <dt>{t('st.quantity')}</dt>
                <dd className="dd-ltr">{detail.quantity}</dd>
              </div>
            ) : null}
            <div>
              <dt>{t('st.detail.time')}</dt>
              <dd>{formatDateTime(locale, detail.at)}</dd>
            </div>
            <div>
              <dt>{t('st.detail.how')}</dt>
              <dd>{t(`st.source.${detail.source}` as DictionaryKey)}</dd>
            </div>
            {detail.reference ? (
              <div>
                <dt>{t('res.reference')}</dt>
                <dd className="dd-ltr">{detail.reference}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </BottomSheet>
    </div>
  );
}

export function AccountPage() {
  return <AccountInner />;
}

function AccountInner() {
  const { locale, me, signOut, status } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [info, setInfo] = useState<StaffMe | null>(null);
  useEffect(() => {
    if (status !== 'authenticated') return;
    void call<StaffMe>('GET', '/v1/staff/me').then((r) => r.ok && setInfo(r.data));
  }, [call, status]);
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  return (
    <div className="dd-staff" data-testid="staff-account">
      <h1 className="dd-title-xl">{t('st.accountTitle')}</h1>
      {status === 'authenticated' ? (
        <Card>
          <div className="dd-stack">
            <strong>{t('st.signedInAs', { name: me?.displayName ?? '' })}</strong>
            {info ? (
              <>
                <div>
                  <span className="dd-caption">{t('st.workingAt')}</span>
                  <div>
                    <strong>{pickText(info.merchantName, locale)}</strong>
                    {' · '}
                    {info.branch ? pickText(info.branch, locale) : t('st.allBranches')}
                  </div>
                </div>
                {!info.canRedeem ? <Alert tone="warning">{t('st.noAccess')}</Alert> : null}
              </>
            ) : null}
            <p className="dd-caption">{t('st.privacy')}</p>
            <Button variant="outline" block onClick={() => void signOut()}>
              {t('auth.signOut')}
            </Button>
          </div>
        </Card>
      ) : (
        <Link className="dd-btn dd-btn--primary" href={withLocale('/', locale)}>
          {t('auth.signIn')}
        </Link>
      )}
      <Card flat>
        <strong>{t('profile.language')}</strong>
        <div className="dd-row" style={{ marginBlockStart: 8 }}>
          <Link className="dd-pill" href={withLocale('/account', 'en')} hrefLang="en">
            English
          </Link>
          <Link className="dd-pill" href={withLocale('/account', 'ar')} hrefLang="ar">
            العربية
          </Link>
        </div>
      </Card>
      <span hidden>
        <Icon name="user" />
      </span>
    </div>
  );
}
