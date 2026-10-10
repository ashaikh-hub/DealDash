'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, useApi, useAuth } from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  type DictionaryKey,
} from '@dealdash/localization';
import { Alert, Button, Card, EmptyState, LoadingState } from '@dealdash/ui';
import type { PayableEventRow, PayableSummary } from '@dealdash/validation';
import { useOrgId } from './deal-utils';
import { MerchantSettlements } from './settlements-reviews';

export function MerchantFinancePage() {
  return (
    <RequirePermission any={['merchant.finance.read']}>
      <FinanceInner />
    </RequirePermission>
  );
}

function FinanceInner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const [sum, setSum] = useState<PayableSummary | null>(null);
  const [events, setEvents] = useState<PayableEventRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    if (!orgId) return;
    const [s, e] = await Promise.all([
      call<PayableSummary>('GET', `/v1/merchants/${orgId}/finance/voucher-payable`),
      call<PayableEventRow[]>('GET', `/v1/merchants/${orgId}/finance/voucher-payable/events`, {
        query: { limit: 25 },
      }),
    ]);
    if (s.ok && s.data) {
      setSum(s.data);
      setEvents(e.data ?? []);
      setNext(e.nextCursor);
      setState('ready');
    } else setState('error');
  }, [call, orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  const more = async () => {
    if (!next) return;
    const e = await call<PayableEventRow[]>(
      'GET',
      `/v1/merchants/${orgId}/finance/voucher-payable/events`,
      { query: { limit: 25, cursor: next } },
    );
    if (e.ok) {
      setEvents((cur) => [...cur, ...(e.data ?? [])]);
      setNext(e.nextCursor);
    }
  };

  if (!orgId || state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'error' || !sum)
    return (
      <Alert tone="danger">
        {t('error.generic')}{' '}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t('state.retry')}
        </Button>
      </Alert>
    );
  const money = (label: string, h: number, id: string) => (
    <Card flat>
      <div className="dd-caption">{label}</div>
      <div className="dd-title-xl dd-ltr" style={{ fontSize: 24 }} data-testid={id}>
        {formatMoney(locale, h)}
      </div>
    </Card>
  );
  const point = t(`mf.accrual.${sum.accrualPoint}` as DictionaryKey);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="merchant-finance">
      <div>
        <h1 className="dd-title-xl">{t('mf.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('mf.sub')}
        </p>
      </div>
      <div className="dd-finance-grid">
        {money(t('mf.held'), sum.heldHalalas, 'fin-held')}
        {money(t('mf.eligible'), sum.settlementEligibleHalalas, 'fin-eligible')}
        {money(t('mf.fee'), sum.platformFeeHalalas, 'fin-fee')}
        {money(t('mf.refunded'), sum.refundedHalalas, 'fin-refunded')}
        {money(t('mf.expired'), sum.expiredValueHalalas, 'fin-expired')}
      </div>
      <p className="dd-caption dd-ltr">
        {t('mf.counts', {
          sold: sum.counts.sold,
          redeemed: sum.counts.redeemed,
          refunded: sum.counts.refunded,
          expired: sum.counts.expired,
        })}
      </p>
      <p className="dd-caption">{t('mf.accrual', { point })}</p>
      <Alert tone="info">{t('mf.legal')}</Alert>

      <h2 className="dd-title">{t('mf.events')}</h2>
      {events.length === 0 ? (
        <EmptyState title={t('mf.eventsEmpty')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('mf.col.event')}</th>
                  <th scope="col">{t('mf.col.voucher')}</th>
                  <th scope="col">{t('mf.col.amount')}</th>
                  <th scope="col">{t('mf.col.fee')}</th>
                  <th scope="col">{t('mf.col.when')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} data-testid="payable-event">
                    <td>{t(`vpayable.${e.type}` as DictionaryKey)}</td>
                    <td>
                      {e.voucherTitle ? e.voucherTitle[locale] || e.voucherTitle.en : '–'}
                      {e.instanceReference ? (
                        <span className="dd-caption dd-ltr"> · {e.instanceReference}</span>
                      ) : null}
                    </td>
                    <td className="dd-ltr">{formatMoney(locale, e.amountHalalas)}</td>
                    <td className="dd-ltr">{formatMoney(locale, e.feeHalalas)}</td>
                    <td className="dd-caption">{formatDateTime(locale, e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {next ? (
        <div>
          <Button variant="outline" onClick={() => void more()}>
            {t('mdeal.loadMore')}
          </Button>
        </div>
      ) : null}
      <MerchantSettlements />
    </div>
  );
}
