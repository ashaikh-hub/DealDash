'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, formatDateTime, type DictionaryKey } from '@dealdash/localization';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  StatusChip,
  Tabs,
  Textarea,
} from '@dealdash/ui';
import type { StatusTone } from '@dealdash/ui';

interface Restriction {
  id: string;
  status: 'ACTIVE' | 'LIFTED' | 'ENDED';
  startsAt: string;
  endsAt: string;
  reason: string;
  strikes: number;
  liftedReason: string | null;
  customer: { userId: string; displayName: string; mobileMasked: string | null };
}
interface Found {
  id: string;
  reference: string;
  status: 'HELD' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';
  quantity: number;
  dealId: string;
  dealTitle: { en: string; ar: string };
  branch: { en: string; ar: string };
  expiresAt: string;
  createdAt: string;
  redeemedAt: string | null;
}
interface Redemption {
  id: string;
  reference: string;
  status: 'REDEEMED' | 'REVERSED';
  source: 'QR' | 'MANUAL';
  redeemedAt: string;
  reversedAt: string | null;
}

const TONE: Record<string, StatusTone> = { ACTIVE: 'warning', LIFTED: 'neutral', ENDED: 'neutral' };

export function ReservationToolsPage() {
  return (
    <RequirePermission any={['admin.reservations.manage']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [tab, setTab] = useState('restrictions');
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="reservation-tools">
      <div>
        <h1 className="dd-title-xl">{t('nav.reservations')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('ah.restrictionsSub')}
        </p>
      </div>
      <Tabs
        label={t('nav.reservations')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'restrictions', label: t('ah.restrictionsTitle') },
          { id: 'lookup', label: t('ah.lookup') },
        ]}
      />
      {tab === 'restrictions' ? <Restrictions /> : <Lookup />}
    </div>
  );
}

function ReasonModal({
  open,
  title,
  confirmLabel,
  onClose,
  onConfirm,
  danger,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            disabled={reason.trim().length < 3}
            data-testid="reason-confirm"
            onClick={async () => {
              setBusy(true);
              const e = await onConfirm(reason.trim());
              setBusy(false);
              setError(e);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="dd-stack">
        <Field label={`${t('mm.reason')} *`} htmlFor="rt-reason" error={error ?? undefined}>
          <Textarea
            id="rt-reason"
            rows={3}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}

function Restrictions() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [rows, setRows] = useState<Restriction[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [liftId, setLiftId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await call<Restriction[]>('GET', '/v1/admin/reservations/restrictions', {
      query: { limit: 50 },
    });
    if (r.ok) setRows(r.data ?? []);
    else setFailed(true);
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);
  if (failed) return <Alert tone="danger">{t('error.generic')}</Alert>;
  if (!rows) return <LoadingState label={t('state.loading')} />;
  return (
    <div className="dd-stack">
      {note ? <Alert tone="success">{note}</Alert> : null}
      {rows.length === 0 ? (
        <EmptyState title={t('ah.restrictionsEmpty')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table" data-testid="restrictions-table">
              <thead>
                <tr>
                  <th scope="col">{t('ah.col.customer')}</th>
                  <th scope="col" className="dd-num">
                    {t('ah.col.strikes')}
                  </th>
                  <th scope="col">{t('ah.col.until')}</th>
                  <th scope="col">{t('ah.col.status')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.customer.displayName}
                      <div className="dd-caption dd-ltr">{r.customer.mobileMasked}</div>
                    </td>
                    <td className="dd-num">{r.strikes}</td>
                    <td className="dd-caption">{formatDateTime(locale, r.endsAt)}</td>
                    <td>
                      <StatusChip tone={TONE[r.status]}>
                        {t(`ah.restrictionStatus.${r.status}` as DictionaryKey)}
                      </StatusChip>
                      {r.liftedReason ? <div className="dd-caption">{r.liftedReason}</div> : null}
                    </td>
                    <td>
                      {r.status === 'ACTIVE' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setLiftId(r.id)}
                          data-testid="lift-open"
                        >
                          {t('ah.lift')}
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
      <ReasonModal
        open={!!liftId}
        title={t('ah.liftTitle')}
        confirmLabel={t('ah.lift')}
        onClose={() => setLiftId(null)}
        onConfirm={async (reason) => {
          const r = await call('POST', `/v1/admin/reservations/restrictions/${liftId}/lift`, {
            body: { reason },
          });
          if (r.ok) {
            setLiftId(null);
            setNote(t('ah.lifted'));
            void load();
            return null;
          }
          return errorMessage(locale, r.errors);
        }}
      />
    </div>
  );
}

function Lookup() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Found[] | null>(null);
  const [reds, setReds] = useState<Record<string, Redemption[]>>({});
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (q.trim().length < 4) return;
    setBusy(true);
    const r = await call<Found[]>('GET', '/v1/admin/reservations/search', {
      query: { q: q.trim() },
    });
    setBusy(false);
    const list = r.ok ? (r.data ?? []) : [];
    setRows(list);
    const map: Record<string, Redemption[]> = {};
    for (const f of list.filter((x) => x.status === 'REDEEMED')) {
      const rr = await call<Redemption[]>('GET', `/v1/admin/reservations/${f.id}/redemptions`);
      if (rr.ok) map[f.id] = rr.data ?? [];
    }
    setReds(map);
  }, [call, q]);

  return (
    <div className="dd-stack" data-testid="reservation-lookup">
      <form
        className="dd-inline-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Field label={t('ah.lookup')} htmlFor="lk-q" help={t('ah.lookupHint')}>
          <Input
            id="lk-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            dir="ltr"
            style={{ maxInlineSize: 280 }}
          />
        </Field>
        <Button type="submit" loading={busy} disabled={q.trim().length < 4}>
          {t('ah.search')}
        </Button>
      </form>
      {note ? <Alert tone="success">{note}</Alert> : null}
      {rows && rows.length === 0 ? <EmptyState title={t('ah.noResults')} /> : null}
      {rows?.map((r) => (
        <Card key={r.id} data-testid="found-reservation">
          <div className="dd-stack">
            <div className="dd-row" style={{ justifyContent: 'space-between' }}>
              <strong className="dd-ltr">{r.reference}</strong>
              <StatusChip
                tone={
                  r.status === 'HELD'
                    ? 'success'
                    : r.status === 'REDEEMED'
                      ? 'info'
                      : r.status === 'EXPIRED'
                        ? 'warning'
                        : 'neutral'
                }
              >
                {t(`resstatus.${r.status}` as DictionaryKey)}
              </StatusChip>
            </div>
            <div>
              {r.dealTitle[locale] || r.dealTitle.en} · {r.branch[locale] || r.branch.en} · ×
              {r.quantity}
            </div>
            <div className="dd-caption">
              {formatDateTime(locale, r.createdAt)} → {formatDateTime(locale, r.expiresAt)}
            </div>
            <div className="dd-row">
              {r.status === 'HELD' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCancelId(r.id)}
                  data-testid="found-cancel"
                >
                  {t('ah.cancelRes')}
                </Button>
              ) : null}
              {(reds[r.id] ?? [])
                .filter((x) => x.status === 'REDEEMED')
                .map((x) => (
                  <Button
                    key={x.id}
                    size="sm"
                    variant="outline"
                    onClick={() => setReverseId(x.id)}
                    data-testid="found-reverse"
                  >
                    {t('mm.reverse')} ({x.reference})
                  </Button>
                ))}
            </div>
          </div>
        </Card>
      ))}
      <ReasonModal
        open={!!cancelId}
        danger
        title={t('ah.cancelRes')}
        confirmLabel={t('ah.cancelRes')}
        onClose={() => setCancelId(null)}
        onConfirm={async (reason) => {
          const r = await call('POST', `/v1/admin/reservations/${cancelId}/cancel`, {
            body: { reason },
          });
          if (r.ok) {
            setCancelId(null);
            setNote(t('res.cancelled'));
            void search();
            return null;
          }
          return errorMessage(locale, r.errors);
        }}
      />
      <ReasonModal
        open={!!reverseId}
        danger
        title={t('mm.reverseTitle')}
        confirmLabel={t('mm.reverse')}
        onClose={() => setReverseId(null)}
        onConfirm={async (reason) => {
          const r = await call('POST', `/v1/admin/reservations/redemptions/${reverseId}/reverse`, {
            body: { reason },
          });
          if (r.ok) {
            setReverseId(null);
            setNote(t('mm.reversed'));
            void search();
            return null;
          }
          return errorMessage(locale, r.errors);
        }}
      />
    </div>
  );
}
