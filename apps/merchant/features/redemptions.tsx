'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, type DictionaryKey } from '@dealdash/localization';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  StatusChip,
  Textarea,
} from '@dealdash/ui';
import { useOrgId, when } from './deal-utils';

interface Row {
  id: string;
  reference: string;
  status: 'REDEEMED' | 'REVERSED';
  source: 'QR' | 'MANUAL';
  redeemedAt: string;
  reversedAt: string | null;
  reverseReason: string | null;
  dealId: string;
  dealTitle: { en: string; ar: string };
  branch: { en: string; ar: string };
  quantity: number;
  staffName: string;
  canReverse: boolean;
}

export function RedemptionsPage() {
  return (
    <RequirePermission any={['merchant.redemptions.read']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const r = await call<Row[]>('GET', `/v1/merchants/${orgId}/redemptions`, {
      query: { limit: 25 },
    });
    if (r.ok) {
      setRows(r.data ?? []);
      setNext(r.nextCursor);
      setState('ready');
    } else setState('error');
  }, [call, orgId]);
  useEffect(() => {
    void load();
  }, [load]);

  const more = async () => {
    if (!orgId || !next) return;
    const r = await call<Row[]>('GET', `/v1/merchants/${orgId}/redemptions`, {
      query: { limit: 25, cursor: next },
    });
    if (r.ok) {
      setRows((cur) => [...cur, ...(r.data ?? [])]);
      setNext(r.nextCursor);
    }
  };

  const reverse = async () => {
    if (!orgId || !reverseId) return;
    setBusy(true);
    const r = await call('POST', `/v1/merchants/${orgId}/redemptions/${reverseId}/reverse`, {
      body: { reason: reason.trim() },
    });
    setBusy(false);
    if (r.ok) {
      setReverseId(null);
      setReason('');
      setNote(t('mm.reversed'));
      void load();
    } else setError(errorMessage(locale, r.errors));
  };

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="redemptions">
      <div>
        <h1 className="dd-title-xl">{t('mm.redemptionsTitle')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('mm.redemptionsSub')}
        </p>
      </div>
      {note ? <Alert tone="success">{note}</Alert> : null}
      {state === 'loading' ? (
        <LoadingState label={t('state.loading')} />
      ) : state === 'error' ? (
        <Alert tone="danger">{t('error.generic')}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={t('mm.noRedemptions')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('mm.col.ref')}</th>
                  <th scope="col">{t('mm.col.deal')}</th>
                  <th scope="col">{t('mm.col.branch')}</th>
                  <th scope="col">{t('mm.col.staff')}</th>
                  <th scope="col">{t('mm.col.source')}</th>
                  <th scope="col">{t('mm.col.time')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="redemption-row">
                    <td className="dd-ltr">{r.reference}</td>
                    <td>{r.dealTitle[locale] || r.dealTitle.en}</td>
                    <td>{r.branch[locale] || r.branch.en}</td>
                    <td>{r.staffName}</td>
                    <td>{t(`mm.source.${r.source}` as DictionaryKey)}</td>
                    <td className="dd-caption">{when(locale, r.redeemedAt)}</td>
                    <td>
                      {r.status === 'REVERSED' ? (
                        <StatusChip tone="warning">{t('mm.reversedBadge')}</StatusChip>
                      ) : r.canReverse ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setReverseId(r.id);
                            setError(null);
                            setReason('');
                          }}
                          data-testid="reverse-open"
                        >
                          {t('mm.reverse')}
                        </Button>
                      ) : null}
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
          <Button variant="outline" onClick={() => void more()}>
            {t('mdeal.loadMore')}
          </Button>
        </div>
      ) : null}
      <Modal
        open={!!reverseId}
        onClose={() => !busy && setReverseId(null)}
        title={t('mm.reverseTitle')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="outline" onClick={() => setReverseId(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => void reverse()}
              data-testid="reverse-confirm"
            >
              {t('mm.reverse')}
            </Button>
          </>
        }
      >
        <div className="dd-stack">
          <p>{t('mm.reverseBody')}</p>
          <Field label={`${t('mm.reason')} *`} htmlFor="rv-reason">
            <Textarea
              id="rv-reason"
              rows={3}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
      </Modal>
    </div>
  );
}
