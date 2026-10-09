'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import {
  createTranslator,
  formatDate,
  withLocale,
  type DictionaryKey,
} from '@dealdash/localization';
import { HOT_DEAL_STATUSES } from '@dealdash/types';
import { Alert, Button, Card, EmptyState, Input, Select, Skeleton } from '@dealdash/ui';
import type { HotDealRow } from '@dealdash/validation';
import { useOrgId } from './deal-utils';
import { DealsTypeSwitch, HotStatusChip } from './hot-utils';

export function HotDealsHub() {
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
  const [rows, setRows] = useState<HotDealRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [more, setMore] = useState(false);
  const canManage = me?.permissions.includes('merchant.deals.manage');
  const key = JSON.stringify({ q: q.trim() || undefined, status: status || undefined, limit: 25 });

  const load = useCallback(async () => {
    if (!orgId) return;
    setState('loading');
    const res = await call<HotDealRow[]>('GET', `/v1/merchants/${orgId}/hot-deals`, {
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
    const res = await call<HotDealRow[]>('GET', `/v1/merchants/${orgId}/hot-deals`, {
      query: { ...JSON.parse(key), cursor: next },
    });
    setMore(false);
    if (res.ok) {
      setRows((r) => [...r, ...(res.data ?? [])]);
      setNext(res.nextCursor);
    }
  };

  const filtered = !!(q || status);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="hot-hub">
      <div className="dd-topbar">
        <div>
          <h1 className="dd-title-xl">{t('mh.title')}</h1>
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('mh.sub')}
          </p>
        </div>
        {canManage ? (
          <Link className="dd-btn dd-btn--primary" href={withLocale('/deals/hot/new', locale)}>
            + {t('mh.create')}
          </Link>
        ) : null}
      </div>
      <DealsTypeSwitch current="hot" />
      <Alert tone="info">{t('mh.freeNote')}</Alert>

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
          {HOT_DEAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`hotstatus.${s}` as DictionaryKey)}
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
            title={t('mh.empty')}
            description={t('mh.emptyBody')}
            action={
              canManage ? (
                <Link
                  className="dd-btn dd-btn--primary"
                  href={withLocale('/deals/hot/new', locale)}
                >
                  {t('mh.create')}
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
                  <th scope="col">{t('mh.colBranches')}</th>
                  <th scope="col">{t('mh.colWindow')}</th>
                  <th scope="col">{t('mh.colStock')}</th>
                  <th scope="col">{t('mdeal.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="hot-row">
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
                            href={withLocale(`/deals/hot/${r.id}`, locale)}
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
                        {r.endAt ? formatDate(locale, r.endAt) : t('mh.untilStock')}
                      </span>
                    </td>
                    <td>
                      {r.totalUnits > 0 ? (
                        <span className="dd-caption dd-ltr">
                          {r.availableUnits} / {r.totalUnits}
                        </span>
                      ) : (
                        <span className="dd-caption">{t('mh.reservationsOff')}</span>
                      )}
                    </td>
                    <td>
                      <HotStatusChip status={r.status} />
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
