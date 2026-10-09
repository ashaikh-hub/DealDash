'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, formatDate, withLocale } from '@dealdash/localization';
import { LIVE_DEAL_STATUSES } from '@dealdash/types';
import { Alert, Button, Card, EmptyState, Input, Select, Skeleton, StatusChip } from '@dealdash/ui';
import type { LiveDealRow } from '@dealdash/validation';
import { DealStatusChip, useOrgId } from './deal-utils';
import { DealsTypeSwitch } from './hot-utils';

export function DealsHub() {
  return (
    <RequirePermission any={['merchant.deals.read']}>
      <HubInner />
    </RequirePermission>
  );
}

function HubInner() {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const [rows, setRows] = useState<LiveDealRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [attention, setAttention] = useState(false);
  const [more, setMore] = useState(false);
  const canManage = me?.permissions.includes('merchant.deals.manage');

  const query = {
    q: q.trim() || undefined,
    status: status || undefined,
    attention: attention ? 'true' : undefined,
    limit: 25,
  };
  const key = JSON.stringify(query);

  const load = useCallback(async () => {
    if (!orgId) return;
    setState('loading');
    const res = await call<LiveDealRow[]>('GET', `/v1/merchants/${orgId}/live-deals`, {
      query: JSON.parse(key),
    });
    if (res.ok) {
      setRows(res.data ?? []);
      setNext(res.nextCursor);
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
    const res = await call<LiveDealRow[]>('GET', `/v1/merchants/${orgId}/live-deals`, {
      query: { ...JSON.parse(key), cursor: next },
    });
    setMore(false);
    if (res.ok) {
      setRows((r) => [...r, ...(res.data ?? [])]);
      setNext(res.nextCursor);
    }
  };

  const filtered = !!(q || status || attention);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="deals-hub">
      <div className="dd-topbar">
        <div>
          <h1 className="dd-title-xl">{t('mdeal.hub.title')}</h1>
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('mdeal.hub.sub')}
          </p>
        </div>
        {canManage ? (
          <Link className="dd-btn dd-btn--primary" href={withLocale('/deals/new', locale)}>
            + {t('mdeal.hub.create')}
          </Link>
        ) : null}
      </div>

      <DealsTypeSwitch current="live" />

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
          {LIVE_DEAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`dealStatus.${s}` as never)}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className={`dd-pill ${attention ? 'dd-pill--active' : ''}`}
          aria-pressed={attention}
          onClick={() => setAttention((a) => !a)}
        >
          {t('mdeal.hub.attention')}
        </button>
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
            title={t('mdeal.hub.emptyTitle')}
            description={t('mdeal.hub.emptyBody')}
            action={
              canManage ? (
                <Link className="dd-btn dd-btn--primary" href={withLocale('/deals/new', locale)}>
                  {t('mdeal.hub.create')}
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('mdeal.col.title')}</th>
                  <th scope="col">{t('mdeal.col.branches')}</th>
                  <th scope="col">{t('mdeal.col.dates')}</th>
                  <th scope="col">{t('mdeal.col.status')}</th>
                  <th scope="col" className="dd-num">
                    {t('mdeal.col.signal')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="dd-titlecell">
                        {r.imageUrl ? (
                          <img className="dd-thumb" src={r.imageUrl} alt="" />
                        ) : (
                          <span className="dd-thumb" aria-hidden="true" />
                        )}
                        <div style={{ minInlineSize: 0 }}>
                          <Link
                            className="dd-rowlink dd-clamp"
                            href={withLocale(`/deals/${r.id}`, locale)}
                          >
                            {r.title[locale] || r.title.en || r.title.ar || t('mdeal.untitled')}
                          </Link>
                          <div className="dd-caption">
                            {r.offerLabel[locale] || r.offerLabel.en}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{r.branchCount}</td>
                    <td>
                      <span className="dd-caption" style={{ display: 'block' }}>
                        {r.startAt ? formatDate(locale, r.startAt) : '-'} –{' '}
                        {r.endAt ? formatDate(locale, r.endAt) : t('mdeal.openEnded')}
                      </span>
                    </td>
                    <td>
                      <div className="dd-row" style={{ gap: 6 }}>
                        <DealStatusChip status={r.status} />
                        {r.hasPendingRevision ? (
                          <StatusChip tone="info">{t('mdeal.hasChanges')}</StatusChip>
                        ) : null}
                        {r.needsAttention ? <StatusChip tone="warning">!</StatusChip> : null}
                      </div>
                    </td>
                    <td className="dd-num">{r.directionsClicks}</td>
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
      <p className="dd-caption">{t('mdeal.signalNote')}</p>
    </div>
  );
}
