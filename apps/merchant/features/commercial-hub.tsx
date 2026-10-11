'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CommercialPanel,
  RequirePermission,
  commercialTone,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import { createTranslator, formatMoney, type DictionaryKey } from '@dealdash/localization';
import { Button, Card, EmptyState, LoadingState, StatusChip } from '@dealdash/ui';
import { useOrgId } from './deal-utils';

interface Row {
  id: string;
  reference: string;
  product: 'VOUCHER' | 'WATCH' | 'EXCLUSIVE' | 'LIVE_BENEFIT';
  subjectId: string;
  title: { en: string; ar: string } | null;
  status: string;
  ownerOrganizationId: string;
  ownerName: { en: string; ar: string };
  maxCashHalalas: number;
  benefitCommitmentHalalas: number;
  developmentFixture: boolean;
  myRole: 'OWNER' | 'SPONSOR' | 'FULFILMENT_MERCHANT' | null;
}

const k = (p: string, v: string) => `${p}.${v}` as DictionaryKey;

/**
 * Every commercial agreement the business is a party to, in whichever role: owner, sponsor or third-party fulfilment merchant.
 * A sponsor or fulfilment merchant reviews and accepts its OWN obligations here; DealDash cannot accept for a fulfilment merchant.
 */
export function CommercialHub() {
  return (
    <RequirePermission any={['merchant.commercial.read']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const load = useCallback(async () => {
    if (!orgId) return;
    const r = await call<Row[]>('GET', `/v1/merchants/${orgId}/commercial/cases`);
    setRows(r.ok && r.data ? r.data : []);
  }, [call, orgId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!orgId || !rows) return <LoadingState label={t('state.loading')} />;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="commercial-hub">
      <div>
        <h1 className="dd-title-xl">{t('cmh.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('cmh.sub')}
        </p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t('cmh.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('cmh.col.ref')}</th>
                <th>{t('cmh.col.campaign')}</th>
                <th>{t('cmh.col.product')}</th>
                <th>{t('cmh.col.role')}</th>
                <th>{t('cmh.col.status')}</th>
                <th>{t('cmh.col.cash')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`cmh-row-${r.reference}`}>
                  <td className="dd-ltr">{r.reference}</td>
                  <td>{r.title ? r.title[locale] || r.title.en : '-'}</td>
                  <td>{t(k('ac.product', r.product))}</td>
                  <td>{r.myRole ? t(k('cm.role', r.myRole)) : '-'}</td>
                  <td>
                    <StatusChip tone={commercialTone(r.status)}>
                      {t(k('cm.status', r.status))}
                    </StatusChip>
                  </td>
                  <td className="dd-ltr">{formatMoney(locale, r.maxCashHalalas)}</td>
                  <td>
                    <Button
                      variant="outline"
                      onClick={() => setOpen(open?.id === r.id ? null : r)}
                      data-testid={`cmh-open-${r.reference}`}
                    >
                      {t('cmh.open')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? (
        <Card>
          <CommercialPanel
            key={open.id}
            orgId={orgId}
            product={open.product}
            subjectId={open.subjectId}
            content={{}}
            onReady={() => void 0}
            refreshKey={open.id}
          />
          <div style={{ marginBlockStart: 12 }}>
            <Button variant="outline" onClick={() => void load()}>
              {t('cmh.refresh')}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
