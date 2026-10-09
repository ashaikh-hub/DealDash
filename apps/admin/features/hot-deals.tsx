'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  withLocale,
  type DictionaryKey,
} from '@dealdash/localization';
import { HOT_DEAL_STATUSES, type HotDealStatus } from '@dealdash/types';
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
import type { AdminHotRow } from '@dealdash/validation';

export const HOT_TONE: Record<HotDealStatus, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  NEEDS_CHANGES: 'warning',
  SCHEDULED: 'info',
  LIVE: 'success',
  PAUSED: 'neutral',
  SOLD_OUT: 'warning',
  EXPIRED: 'neutral',
  CANCELLED: 'neutral',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
};

interface Overview {
  counts: Record<string, number>;
  last24h: {
    reservationsCreated: number;
    redeemed: number;
    notCompleted: number;
    cancelled: number;
  };
  heldNow: number;
  activeRestrictions: number;
  liveDeals: Array<
    AdminHotRow & { availableUnits: number; reservedUnits: number; redeemedUnits: number }
  >;
}

export function HotDealsAdminPage() {
  return (
    <RequirePermission any={['admin.campaigns.review']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [tab, setTab] = useState('queue');
  const [rows, setRows] = useState<AdminHotRow[]>([]);
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
    if (tab === 'monitor') return;
    setState('loading');
    const r = await call<AdminHotRow[]>('GET', '/v1/admin/hot-deals', {
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
    const r = await call<AdminHotRow[]>('GET', '/v1/admin/hot-deals', {
      query: { ...JSON.parse(key), limit: 25, cursor },
    });
    setMore(false);
    if (r.ok) {
      setRows((p) => [...p, ...(r.data ?? [])]);
      setCursor(r.nextCursor);
    }
  };

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-hot-deals">
      <div>
        <h1 className="dd-title-xl">{t('ah.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('ah.sub')}
        </p>
      </div>
      <Tabs
        label={t('ah.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'queue', label: t('ah.tabQueue') },
          { id: 'all', label: t('ah.tabAll') },
          { id: 'monitor', label: t('ah.tabMonitor') },
        ]}
      />
      {tab === 'monitor' ? (
        <MonitorPanel />
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
                {HOT_DEAL_STATUSES.filter((s) => s !== 'DRAFT').map((s) => (
                  <option key={s} value={s}>
                    {t(`hotstatus.${s}` as DictionaryKey)}
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
            <EmptyState title={tab === 'queue' ? t('ah.queueEmpty') : t('mdeal.hub.noMatch')} />
          ) : (
            <Card className="dd-card--flat" style={{ padding: 0 }}>
              <div className="dd-table-wrap" style={{ border: 0 }}>
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('ah.col.deal')}</th>
                      <th scope="col">{t('ah.col.merchant')}</th>
                      <th scope="col" className="dd-num">
                        {t('ah.col.units')}
                      </th>
                      <th scope="col">{t('ah.col.submitted')}</th>
                      <th scope="col">{t('adeal.col.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} data-testid="admin-hot-row">
                        <td>
                          <Link
                            className="dd-rowlink dd-clamp"
                            href={withLocale(`/hot-deals/${r.id}`, locale)}
                          >
                            {r.title[locale] || r.title.en}
                          </Link>
                          <div className="dd-caption">
                            {t(`hotlimit.${r.limitType}` as DictionaryKey)}
                          </div>
                        </td>
                        <td>{locale === 'ar' ? r.merchant.nameAr : r.merchant.nameEn}</td>
                        <td className="dd-num">{r.totalUnits || '–'}</td>
                        <td className="dd-caption">
                          {r.submittedAt ? formatDateTime(locale, r.submittedAt) : '–'}
                        </td>
                        <td>
                          <StatusChip tone={HOT_TONE[r.status]}>
                            {t(`hotstatus.${r.status}` as DictionaryKey)}
                          </StatusChip>
                        </td>
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

function MonitorPanel() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [o, setO] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const r = await call<Overview>('GET', '/v1/admin/hot-deals/overview');
    if (r.ok && r.data) {
      setO(r.data);
      setFailed(false);
    } else setFailed(true);
  }, [call]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);
  if (failed) return <Alert tone="danger">{t('error.generic')}</Alert>;
  if (!o) return <LoadingState label={t('state.loading')} />;
  const tile = (n: number, label: string, id: string) => (
    <div className="dd-kpi" data-testid={id}>
      <div className="dd-kpi__n">{n}</div>
      <div className="dd-kpi__l">{label}</div>
    </div>
  );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-hot-monitor">
      <div className="dd-kpis">
        {tile(o.counts.LIVE ?? 0, t('hotstatus.LIVE'), 'k-live')}
        {tile(o.counts.SOLD_OUT ?? 0, t('hotstatus.SOLD_OUT'), 'k-sold')}
        {tile(o.counts.PENDING_REVIEW ?? 0, t('hotstatus.PENDING_REVIEW'), 'k-pending')}
        {tile(o.counts.PAUSED ?? 0, t('hotstatus.PAUSED'), 'k-paused')}
        {tile(o.counts.SUSPENDED ?? 0, t('hotstatus.SUSPENDED'), 'k-susp')}
      </div>
      <h2 className="dd-title">{t('ah.overview')}</h2>
      <div className="dd-kpis">
        {tile(o.heldNow, t('ah.heldNow'), 'k-held')}
        {tile(o.last24h.reservationsCreated, t('ah.createdDay'), 'k-created')}
        {tile(o.last24h.redeemed, t('ah.usedDay'), 'k-used')}
        {tile(o.last24h.notCompleted, t('ah.notCompletedDay'), 'k-notcompleted')}
        {tile(o.last24h.cancelled, t('ah.cancelledDay'), 'k-cancelled')}
        {tile(o.activeRestrictions, t('ah.restrictions'), 'k-restrictions')}
      </div>
      <Card className="dd-card--flat" style={{ padding: 0 }}>
        <div className="dd-table-wrap" style={{ border: 0 }}>
          <table className="dd-table">
            <thead>
              <tr>
                <th scope="col">{t('ah.col.deal')}</th>
                <th scope="col">{t('ah.col.merchant')}</th>
                <th scope="col" className="dd-num">
                  {t('mm.available')}
                </th>
                <th scope="col" className="dd-num">
                  {t('mm.reserved')}
                </th>
                <th scope="col" className="dd-num">
                  {t('mm.redeemed')}
                </th>
                <th scope="col">{t('adeal.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {o.liveDeals.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      className="dd-rowlink dd-clamp"
                      href={withLocale(`/hot-deals/${r.id}`, locale)}
                    >
                      {r.title[locale] || r.title.en}
                    </Link>
                  </td>
                  <td>{locale === 'ar' ? r.merchant.nameAr : r.merchant.nameEn}</td>
                  <td className="dd-num">{r.availableUnits}</td>
                  <td className="dd-num">{r.reservedUnits}</td>
                  <td className="dd-num">{r.redeemedUnits}</td>
                  <td>
                    <StatusChip tone={HOT_TONE[r.status]}>
                      {t(`hotstatus.${r.status}` as DictionaryKey)}
                    </StatusChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="dd-caption">{t('mm.funnelNote')}</p>
    </div>
  );
}
