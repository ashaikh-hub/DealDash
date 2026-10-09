'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import {
  createTranslator,
  formatDate,
  formatMoney,
  withLocale,
  type DictionaryKey,
} from '@dealdash/localization';
import { VOUCHER_STATUSES } from '@dealdash/types';
import { Alert, Button, Card, EmptyState, Input, Select, Skeleton } from '@dealdash/ui';
import type { VoucherRow } from '@dealdash/validation';
import { useOrgId } from './deal-utils';
import { CampaignTypeSwitch, VoucherStatusChip } from './voucher-utils';

export function VouchersHub() {
  return (
    <RequirePermission any={['merchant.vouchers.manage']}>
      <HubInner />
    </RequirePermission>
  );
}

function HubInner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const [rows, setRows] = useState<VoucherRow[]>([]);
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
    const res = await call<VoucherRow[]>('GET', `/v1/merchants/${orgId}/vouchers`, {
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
    const res = await call<VoucherRow[]>('GET', `/v1/merchants/${orgId}/vouchers`, {
      query: { ...JSON.parse(key), cursor: next },
    });
    setMore(false);
    if (res.ok) {
      setRows((r) => [...r, ...(res.data ?? [])]);
      setNext(res.nextCursor);
    }
  };

  const filtered = !!(q || status);
  const create = (
    <Link className="dd-btn dd-btn--primary" href={withLocale('/vouchers/new', locale)}>
      + {t('mv.create')}
    </Link>
  );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="voucher-hub">
      <div className="dd-topbar">
        <div>
          <h1 className="dd-title-xl">{t('mv.title')}</h1>
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('mv.sub')}
          </p>
        </div>
        {create}
      </div>
      <CampaignTypeSwitch current="voucher" />
      <Alert tone="info">{t('mv.note')}</Alert>

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
          {VOUCHER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`vstatus.${s}` as DictionaryKey)}
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
          <EmptyState title={t('mv.empty')} description={t('mv.emptyBody')} action={create} />
        )
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('mdeal.col.title')}</th>
                  <th scope="col">{t('mv.colValue')}</th>
                  <th scope="col">{t('mv.colSale')}</th>
                  <th scope="col">{t('mv.colSold')}</th>
                  <th scope="col">{t('mv.colUsed')}</th>
                  <th scope="col">{t('mdeal.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="voucher-row">
                    <td>
                      <div className="dd-titlecell">
                        {r.imageUrl ? (
                          <img className="dd-thumb" src={r.imageUrl} alt="" />
                        ) : (
                          <span className="dd-thumb" aria-hidden="true" />
                        )}
                        <Link
                          className="dd-rowlink dd-clamp"
                          href={withLocale(`/vouchers/${r.id}`, locale)}
                        >
                          {r.title[locale] || r.title.en || r.title.ar || t('mdeal.untitled')}
                        </Link>
                      </div>
                    </td>
                    <td>
                      <span className="dd-ltr">
                        {formatMoney(locale, r.faceValueHalalas)} /{' '}
                        {formatMoney(locale, r.sellingPriceHalalas)}
                      </span>
                    </td>
                    <td>
                      <span className="dd-caption" style={{ display: 'block' }}>
                        {r.saleStartAt ? formatDate(locale, r.saleStartAt) : '-'} –{' '}
                        {r.saleEndAt ? formatDate(locale, r.saleEndAt) : t('mv.untilEnd')}
                      </span>
                    </td>
                    <td>
                      <span className="dd-ltr">
                        {r.soldQty} / {r.totalQty}
                      </span>
                    </td>
                    <td>
                      <span className="dd-ltr">{r.redeemedQty}</span>
                    </td>
                    <td>
                      <VoucherStatusChip status={r.status} />
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
