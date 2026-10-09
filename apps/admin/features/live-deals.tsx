'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, formatDateTime, formatNumber, withLocale } from '@dealdash/localization';
import { LIVE_DEAL_STATUSES, type LiveDealStatus } from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingState,
  Select,
  StatusChip,
  Tabs,
  type StatusTone,
} from '@dealdash/ui';
import type { AdminDealRow } from '@dealdash/validation';

export const DEAL_TONE: Record<LiveDealStatus, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  NEEDS_CHANGES: 'warning',
  SCHEDULED: 'info',
  LIVE: 'success',
  PAUSED: 'neutral',
  EXPIRED: 'neutral',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
};

interface Overview {
  counts: Record<
    'live' | 'scheduled' | 'pendingReview' | 'needsChanges' | 'paused' | 'suspended',
    number
  >;
  last7Days: Record<
    'impressions' | 'detailViews' | 'merchantPageViews' | 'saves' | 'directionsClicks',
    number
  >;
  topDeals: Array<{
    id: string;
    title: { en: string; ar: string };
    merchantName: { en: string; ar: string };
    detailViews: number;
    directionsClicks: number;
  }>;
}

export function LiveDealsPage() {
  return (
    <RequirePermission any={['admin.campaigns.review']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [tab, setTab] = useState('queue');
  const [rows, setRows] = useState<AdminDealRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [more, setMore] = useState(false);

  const query =
    tab === 'queue'
      ? { queue: 'true', q: q.trim() || undefined }
      : { q: q.trim() || undefined, status: status || undefined };
  const key = JSON.stringify(query);

  const load = useCallback(async () => {
    if (tab === 'analytics') return;
    setState('loading');
    const r = await call<AdminDealRow[]>('GET', '/v1/admin/live-deals', {
      query: { ...JSON.parse(key), limit: 25 },
    });
    if (r.ok) {
      setRows(r.data ?? []);
      setCursor(r.nextCursor);
      setState('ready');
    } else {
      setError(errorMessage(locale, r.errors));
      setState('error');
    }
  }, [call, key, tab, locale]);
  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  const loadMore = async () => {
    setMore(true);
    const r = await call<AdminDealRow[]>('GET', '/v1/admin/live-deals', {
      query: { ...JSON.parse(key), limit: 25, cursor },
    });
    setMore(false);
    if (r.ok) {
      setRows((p) => [...p, ...(r.data ?? [])]);
      setCursor(r.nextCursor);
    }
  };

  const canAnalytics = me?.permissions.includes('admin.reports.read');
  const tabs = [
    { id: 'queue', label: t('adeal.queueTab') },
    { id: 'all', label: t('adeal.allTab') },
    ...(canAnalytics ? [{ id: 'analytics', label: t('adeal.analyticsTab') }] : []),
  ];

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-live-deals">
      <div>
        <h1 className="dd-title-xl">{t('adeal.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('adeal.sub')}
        </p>
      </div>
      <Tabs label={t('adeal.title')} tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'analytics' ? (
        <AnalyticsPanel />
      ) : (
        <>
          <div className="dd-inline-fields">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('adeal.search')}
              aria-label={t('adeal.search')}
              style={{ maxInlineSize: 300 }}
            />
            {tab === 'all' ? (
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label={t('adeal.col.status')}
                style={{ maxInlineSize: 220 }}
              >
                <option value="">{t('adeal.allStatuses')}</option>
                {LIVE_DEAL_STATUSES.filter((s) => s !== 'DRAFT').map((s) => (
                  <option key={s} value={s}>
                    {t(`dealStatus.${s}` as never)}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          {state === 'loading' ? (
            <LoadingState label={t('state.loading')} />
          ) : state === 'error' ? (
            <Alert tone="danger">
              {error}{' '}
              <Button size="sm" variant="outline" onClick={() => void load()}>
                {t('state.retry')}
              </Button>
            </Alert>
          ) : rows.length === 0 ? (
            <EmptyState
              title={tab === 'queue' ? t('adeal.queueEmpty') : t('state.empty')}
              description={tab === 'queue' ? t('adeal.queueEmptyBody') : undefined}
            />
          ) : (
            <Card style={{ padding: 0 }}>
              <div className="dd-table-wrap" style={{ border: 0 }}>
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('adeal.col.deal')}</th>
                      <th scope="col">{t('adeal.col.merchant')}</th>
                      <th scope="col">{t('adeal.col.kind')}</th>
                      <th scope="col">{t('adeal.col.submitted')}</th>
                      <th scope="col">{t('adeal.col.status')}</th>
                      <th scope="col" className="dd-num">
                        {t('adeal.col.branches')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.id}-${r.kind}`}>
                        <td>
                          <Link
                            className="dd-rowlink dd-clamp"
                            href={withLocale(`/live-deals/${r.id}`, locale)}
                          >
                            {r.title[locale] || r.title.en || r.title.ar}
                          </Link>
                        </td>
                        <td>
                          <div className="dd-clamp">
                            {locale === 'ar' ? r.merchant.nameAr : r.merchant.nameEn}
                          </div>
                          <div className="dd-caption">
                            {t(`adeal.trust.${r.merchant.trustLevel}` as never)}
                          </div>
                        </td>
                        <td>
                          <StatusChip tone={r.kind === 'REVISION' ? 'info' : 'neutral'}>
                            {t(`adeal.kind.${r.kind}` as never)}
                          </StatusChip>
                        </td>
                        <td>{r.submittedAt ? formatDateTime(locale, r.submittedAt) : '-'}</td>
                        <td>
                          <StatusChip tone={DEAL_TONE[r.status]}>
                            {t(`dealStatus.${r.status}` as never)}
                          </StatusChip>
                        </td>
                        <td className="dd-num">{r.branchCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {cursor ? (
            <div>
              <Button variant="outline" loading={more} onClick={() => void loadMore()}>
                {t('mdeal.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function AnalyticsPanel() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    void call<Overview>('GET', '/v1/admin/live-deals/analytics').then((r) => {
      if (r.ok && r.data) {
        setData(r.data);
        setState('ready');
      } else setState('error');
    });
  }, [call]);
  if (state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'error' || !data) return <Alert tone="danger">{t('error.generic')}</Alert>;
  const n = (v: number) => formatNumber(locale, v);
  const counts: Array<[string, number]> = [
    ['adeal.countLive', data.counts.live],
    ['adeal.countScheduled', data.counts.scheduled],
    ['adeal.countPending', data.counts.pendingReview],
    ['adeal.countNeeds', data.counts.needsChanges],
    ['adeal.countPaused', data.counts.paused],
    ['adeal.countSuspended', data.counts.suspended],
  ];
  const sig: Array<[string, number]> = [
    ['perf.impressions', data.last7Days.impressions],
    ['perf.detailViews', data.last7Days.detailViews],
    ['perf.merchantPageViews', data.last7Days.merchantPageViews],
    ['perf.saves', data.last7Days.saves],
    ['perf.directions', data.last7Days.directionsClicks],
  ];
  return (
    <div className="dd-stack" style={{ gap: 16 }}>
      <Alert tone="info">{t('perf.disclaimer')}</Alert>
      <div className="dd-kpis">
        {counts.map(([k, v]) => (
          <div key={k} className="dd-kpi">
            <div className="dd-kpi__n">{n(v)}</div>
            <div className="dd-kpi__l">{t(k as never)}</div>
          </div>
        ))}
      </div>
      <h2 className="dd-title">{t('adeal.last7')}</h2>
      <div className="dd-kpis">
        {sig.map(([k, v]) => (
          <div key={k} className="dd-kpi">
            <div className="dd-kpi__n">{n(v)}</div>
            <div className="dd-kpi__l">{t(k as never)}</div>
          </div>
        ))}
      </div>
      <h2 className="dd-title">{t('adeal.topDeals')}</h2>
      {data.topDeals.length === 0 ? (
        <EmptyState title={t('adeal.noTop')} />
      ) : (
        <Card style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('adeal.col.deal')}</th>
                  <th scope="col">{t('adeal.col.merchant')}</th>
                  <th scope="col" className="dd-num">
                    {t('perf.detailViews')}
                  </th>
                  <th scope="col" className="dd-num">
                    {t('perf.directions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.topDeals.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link className="dd-rowlink" href={withLocale(`/live-deals/${d.id}`, locale)}>
                        {d.title[locale] || d.title.en}
                      </Link>
                    </td>
                    <td>{d.merchantName[locale] || d.merchantName.en}</td>
                    <td className="dd-num">{n(d.detailViews)}</td>
                    <td className="dd-num">{n(d.directionsClicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="dd-caption">{t('perf.noSales')}</p>
    </div>
  );
}
