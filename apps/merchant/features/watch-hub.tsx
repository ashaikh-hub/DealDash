'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  RequirePermission,
  WatchStatusChip,
  errorMessage,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDate,
  formatMoney,
  formatNumber,
  withLocale,
  type DictionaryKey,
} from '@dealdash/localization';
import { WATCH_STATUSES } from '@dealdash/types';
import { Alert, Button, Card, EmptyState, Input, Select, Skeleton } from '@dealdash/ui';
import type { WatchRow } from '@dealdash/validation';
import { useOrgId } from './deal-utils';

interface Summary {
  counts: Record<string, number>;
  total: number;
  money: {
    fundedHalalas: number;
    spentHalalas: number;
    unusedHalalas: number;
    qualifiedViews: number;
  };
}

export function WatchHub() {
  return (
    <RequirePermission any={['merchant.watch.read']}>
      <HubInner />
    </RequirePermission>
  );
}

function HubInner() {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const canManage = !!me?.permissions.includes('merchant.watch.manage');
  const [rows, setRows] = useState<WatchRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [more, setMore] = useState(false);
  const key = JSON.stringify({ q: q.trim() || undefined, status: status || undefined, limit: 25 });

  const load = useCallback(async () => {
    if (!orgId) return;
    setState('loading');
    const [res, sum] = await Promise.all([
      call<WatchRow[]>('GET', `/v1/merchants/${orgId}/watch`, { query: JSON.parse(key) }),
      call<Summary>('GET', `/v1/merchants/${orgId}/watch/summary`),
    ]);
    if (res.ok) {
      setRows(res.data ?? []);
      setNext(res.nextCursor);
      setSummary(sum.data);
      setState('ready');
    } else {
      setError(errorMessage(locale, res.errors));
      setState('error');
    }
  }, [call, orgId, key, locale]);

  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  const loadMore = async () => {
    if (!orgId || !next) return;
    setMore(true);
    const res = await call<WatchRow[]>('GET', `/v1/merchants/${orgId}/watch`, {
      query: { ...JSON.parse(key), cursor: next },
    });
    setMore(false);
    if (res.ok) {
      setRows((r) => [...r, ...(res.data ?? [])]);
      setNext(res.nextCursor);
    }
  };

  const filtered = !!(q || status);
  const create = canManage ? (
    <Link
      className="dd-btn dd-btn--primary"
      href={withLocale('/watch/new', locale)}
      data-testid="watch-create"
    >
      + {t('mw.create')}
    </Link>
  ) : null;
  const n = (v: number) => formatNumber(locale, v);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="watch-hub">
      <div className="dd-topbar">
        <div>
          <h1 className="dd-title-xl">{t('mw.title')}</h1>
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('mw.sub')}
          </p>
        </div>
        {create}
      </div>
      <Alert tone="info">{t('mw.note')}</Alert>

      {summary ? (
        <div className="dd-finance-grid" data-testid="watch-summary">
          <Card flat>
            <div className="dd-caption">{t('mw.sum.funded')}</div>
            <div className="dd-title-xl dd-ltr" style={{ fontSize: 22 }}>
              {formatMoney(locale, summary.money.fundedHalalas)}
            </div>
          </Card>
          <Card flat>
            <div className="dd-caption">{t('mw.sum.spent')}</div>
            <div className="dd-title-xl dd-ltr" style={{ fontSize: 22 }} data-testid="sum-spent">
              {formatMoney(locale, summary.money.spentHalalas)}
            </div>
          </Card>
          <Card flat>
            <div className="dd-caption">{t('mw.sum.unused')}</div>
            <div className="dd-title-xl dd-ltr" style={{ fontSize: 22 }}>
              {formatMoney(locale, summary.money.unusedHalalas)}
            </div>
          </Card>
          <Card flat>
            <div className="dd-caption">{t('mw.sum.views')}</div>
            <div className="dd-title-xl dd-ltr" style={{ fontSize: 22 }} data-testid="sum-views">
              {n(summary.money.qualifiedViews)}
            </div>
          </Card>
        </div>
      ) : null}

      <div className="dd-inline-fields">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('mdeal.hub.search')}
          aria-label={t('mdeal.hub.search')}
          style={{ maxInlineSize: 280 }}
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('mdeal.col.status')}
          style={{ maxInlineSize: 200 }}
        >
          <option value="">{t('mdeal.hub.allStatuses')}</option>
          {WATCH_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`wstatus.${s}` as DictionaryKey)}
            </option>
          ))}
        </Select>
      </div>

      {state === 'loading' ? (
        <div className="dd-stack" aria-busy="true" data-testid="hub-loading">
          <Skeleton height={56} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      ) : state === 'error' ? (
        <Alert tone="danger">
          {error}{' '}
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('state.retry')}
          </Button>
        </Alert>
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState title={t('mdeal.hub.noMatch')} />
        ) : (
          <EmptyState
            title={t('mw.empty')}
            description={t('mw.emptyBody')}
            action={create ?? undefined}
          />
        )
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('mdeal.col.title')}</th>
                  <th scope="col">{t('mw.col.period')}</th>
                  <th scope="col">{t('mw.col.views')}</th>
                  <th scope="col">{t('mw.col.budget')}</th>
                  <th scope="col">{t('mdeal.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="watch-row">
                    <td>
                      <div className="dd-titlecell">
                        {r.thumbnailUrl ? (
                          <img className="dd-thumb" src={r.thumbnailUrl} alt="" />
                        ) : (
                          <span className="dd-thumb" aria-hidden="true" />
                        )}
                        <Link
                          className="dd-rowlink dd-clamp"
                          href={withLocale(`/watch/${r.id}`, locale)}
                        >
                          {r.title[locale] || r.title.en || r.title.ar || t('mdeal.untitled')}
                        </Link>
                      </div>
                    </td>
                    <td>
                      <span className="dd-caption" style={{ display: 'block' }}>
                        {r.startAt ? formatDate(locale, r.startAt) : '-'} –{' '}
                        {r.endAt ? formatDate(locale, r.endAt) : '-'}
                      </span>
                    </td>
                    <td>
                      <span className="dd-ltr">
                        {n(r.qualifiedViews)} / {n(r.paidViews)}
                      </span>
                    </td>
                    <td>
                      <span className="dd-ltr">
                        {formatMoney(locale, r.spentHalalas)} /{' '}
                        {formatMoney(locale, r.fundedHalalas)}
                      </span>
                    </td>
                    <td>
                      <WatchStatusChip status={r.status} locale={locale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {next ? (
        <div>
          <Button variant="outline" loading={more} onClick={() => void loadMore()}>
            {t('mdeal.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
