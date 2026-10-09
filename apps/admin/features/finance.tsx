'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  withLocale,
  type DictionaryKey,
} from '@dealdash/localization';
import { REFUND_STATUSES, SUPPORT_CASE_STATUSES } from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  Select,
  StatusChip,
  Tabs,
  Textarea,
  type StatusTone,
} from '@dealdash/ui';
import type { AdminOrderDetail, AdminRefundRow, FinanceOverview } from '@dealdash/validation';

const bn = (x: { en: string; ar: string } | null | undefined, l: 'en' | 'ar') =>
  x ? x[l] || x.en || x.ar : '';
const REFUND_TONE: Record<string, StatusTone> = {
  REQUESTED: 'warning',
  UNDER_REVIEW: 'warning',
  APPROVED: 'info',
  PROCESSING: 'info',
  REFUNDED: 'success',
  REJECTED: 'neutral',
  FAILED: 'danger',
};

/** Reason dialog shared by approve / reject / create / reverse. */
function ReasonModal({
  open,
  title,
  body,
  confirmLabel,
  danger,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body?: string;
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
            disabled={reason.trim().length < 3}
            loading={busy}
            data-testid="finance-confirm"
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
        {body ? <p>{body}</p> : null}
        <Field label={`${t('fin.refund.reason')} *`} htmlFor="finance-reason">
          <Textarea
            id="finance-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

// ================================================================ workbench
export function FinanceWorkbench() {
  return (
    <RequirePermission any={['admin.vouchers.lookup']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  // the overview (ledger health, merchant balances) needs payment rights; Support starts at the lookup
  const canOverview = !!me?.permissions.includes('admin.payments.read');
  const [chosen, setTab] = useState<string | null>(null);
  const tab = chosen ?? (canOverview ? 'overview' : 'lookup');
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="finance-workbench">
      <div>
        <h1 className="dd-title-xl">{t('fin.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('fin.sub')}
        </p>
      </div>
      <Tabs
        label={t('fin.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          ...(canOverview ? [{ id: 'overview', label: t('fin.tabOverview') }] : []),
          { id: 'lookup', label: t('fin.tabLookup') },
          { id: 'refunds', label: t('fin.tabRefunds') },
          { id: 'cases', label: t('fin.tabCases') },
        ]}
      />
      {tab === 'overview' ? (
        <Overview />
      ) : tab === 'lookup' ? (
        <Lookup />
      ) : tab === 'refunds' ? (
        <Refunds />
      ) : (
        <Cases />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  id,
}: {
  label: string;
  value: string | number;
  tone?: 'danger';
  id?: string;
}) {
  return (
    <Card flat>
      <div className="dd-caption">{label}</div>
      <div
        className="dd-title-xl dd-ltr"
        style={{ fontSize: 24, color: tone === 'danger' ? 'var(--dd-danger)' : undefined }}
        data-testid={id}
      >
        {value}
      </div>
    </Card>
  );
}

function Overview() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [o, setO] = useState<FinanceOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    const r = await call<FinanceOverview>('GET', '/v1/admin/finance/overview');
    if (r.ok && r.data) setO(r.data);
    else setFailed(true);
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);
  if (failed) return <Alert tone="danger">{t('error.generic')}</Alert>;
  if (!o) return <LoadingState label={t('state.loading')} />;
  const m = (h: number) => formatMoney(locale, h);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="finance-overview">
      <div className="dd-finance-grid">
        <Stat label={t('fin.overview.pending')} value={o.counts.ordersPendingPayment} />
        <Stat
          label={t('fin.overview.refundsOpen')}
          value={o.counts.refundsOpen}
          id="ov-refunds-open"
        />
        <Stat
          label={t('fin.overview.refundsFailed')}
          value={o.counts.refundsFailed}
          tone={o.counts.refundsFailed ? 'danger' : undefined}
        />
        <Stat label={t('fin.overview.payments24')} value={o.counts.paymentsLast24h} />
        <Stat label={t('fin.overview.failed24')} value={o.counts.failedLast24h} />
        <Stat label={t('fin.overview.refunds24')} value={o.counts.refundsLast24h} />
      </div>
      <Card>
        <h2 className="dd-title">{t('fin.ledger')}</h2>
        <div style={{ marginBlock: 8 }}>
          <StatusChip tone={o.ledger.balanced ? 'success' : 'danger'}>
            <span data-testid="ledger-balanced">
              {o.ledger.balanced ? t('fin.ledger.balanced') : t('fin.ledger.unbalanced')}
            </span>
          </StatusChip>{' '}
          <span className="dd-caption dd-ltr">
            {t('fin.ledger.journals', { n: o.ledger.journals })}
          </span>
        </div>
        <dl className="dd-kv">
          <div className="dd-kv__row">
            <dt>{t('fin.ledger.held')}</dt>
            <dd className="dd-ltr">{m(o.ledger.heldHalalas)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('fin.ledger.eligible')}</dt>
            <dd className="dd-ltr">{m(o.ledger.settlementEligibleHalalas)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('fin.ledger.revenue')}</dt>
            <dd className="dd-ltr">{m(o.ledger.platformRevenueHalalas)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('fin.ledger.psp')}</dt>
            <dd className="dd-ltr">{m(o.ledger.pspClearingHalalas)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('fin.ledger.expired')}</dt>
            <dd className="dd-ltr">{m(o.ledger.expiredValueHalalas)}</dd>
          </div>
        </dl>
      </Card>
      <Card flat>
        <h2 className="dd-title">{t('fin.merchants')}</h2>
        {o.merchants.length === 0 ? (
          <EmptyState title={t('fin.noResults')} />
        ) : (
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('fin.col.merchant')}</th>
                  <th scope="col">{t('fin.col.held')}</th>
                  <th scope="col">{t('fin.col.eligible')}</th>
                  <th scope="col">{t('fin.col.fee')}</th>
                  <th scope="col">{t('fin.col.refunded')}</th>
                  <th scope="col">{t('fin.col.expired')}</th>
                </tr>
              </thead>
              <tbody>
                {o.merchants.map((r) => (
                  <tr key={r.merchant.id} data-testid="payable-row">
                    <td>{locale === 'ar' ? r.merchant.nameAr : r.merchant.nameEn}</td>
                    <td className="dd-ltr">{m(r.heldHalalas)}</td>
                    <td className="dd-ltr">{m(r.settlementEligibleHalalas)}</td>
                    <td className="dd-ltr">{m(r.platformFeeHalalas)}</td>
                    <td className="dd-ltr">{m(r.refundedHalalas)}</td>
                    <td className="dd-ltr">{m(r.expiredValueHalalas)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="dd-caption">{t('fin.legal')}</p>
      </Card>
    </div>
  );
}

interface SearchRow {
  kind: 'ORDER' | 'PAYMENT' | 'VOUCHER' | 'REFUND' | 'REDEMPTION';
  orderId: string;
  reference: string;
  status: string;
  amountHalalas: number;
  merchant: { en: string; ar: string };
  createdAt: string;
}

function Lookup() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<SearchRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (q.trim().length < 4) return;
    setBusy(true);
    setError('');
    const r = await call<SearchRow[]>('GET', '/v1/admin/finance/search', {
      query: { q: q.trim() },
    });
    setBusy(false);
    if (r.ok) setRows(r.data ?? []);
    else setError(errorMessage(locale, r.errors));
  };
  return (
    <div className="dd-stack" data-testid="finance-lookup">
      <form
        className="dd-inline-fields"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('fin.search')}
          aria-label={t('fin.search')}
          style={{ maxInlineSize: 480 }}
          data-testid="finance-search"
        />
        <Button type="submit" loading={busy} disabled={q.trim().length < 4}>
          {t('fin.searchGo')}
        </Button>
      </form>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {rows === null ? null : rows.length === 0 ? (
        <EmptyState title={t('fin.noResults')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('fin.col.type')}</th>
                  <th scope="col">{t('fin.col.ref')}</th>
                  <th scope="col">{t('fin.col.status')}</th>
                  <th scope="col">{t('fin.col.amount')}</th>
                  <th scope="col">{t('fin.col.merchant')}</th>
                  <th scope="col">{t('fin.col.when')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.reference}`} data-testid="finance-result">
                    <td>{t(`fin.kind.${r.kind}` as DictionaryKey)}</td>
                    <td>
                      <Link
                        className="dd-rowlink dd-ltr"
                        href={withLocale(`/finance/orders/${r.orderId}`, locale)}
                      >
                        {r.reference}
                      </Link>
                    </td>
                    <td>{r.status}</td>
                    <td className="dd-ltr">{formatMoney(locale, r.amountHalalas)}</td>
                    <td>{bn(r.merchant, locale)}</td>
                    <td className="dd-caption">{formatDateTime(locale, r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ================================================================ refunds
function RefundActions({ r, onDone }: { r: AdminRefundRow; onDone: () => void }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [mode, setMode] = useState<null | 'approve' | 'reject'>(null);
  const [msg, setMsg] = useState('');
  return (
    <div className="dd-row" style={{ gap: 6 }}>
      {r.actions.includes('approve') ? (
        <Button size="sm" onClick={() => setMode('approve')} data-testid="refund-approve">
          {t('fin.refund.approve')}
        </Button>
      ) : null}
      {r.actions.includes('reject') ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setMode('reject')}
          data-testid="refund-reject"
        >
          {t('fin.refund.reject')}
        </Button>
      ) : null}
      {r.actions.includes('retry') ? (
        <Button
          size="sm"
          variant="outline"
          data-testid="refund-retry"
          onClick={async () => {
            const x = await call('POST', `/v1/admin/finance/refunds/${r.id}/retry`, { body: {} });
            setMsg(x.ok ? t('fin.refund.done') : errorMessage(locale, x.errors));
            if (x.ok) onDone();
          }}
        >
          {t('fin.refund.retry')}
        </Button>
      ) : null}
      {r.needsChecker && r.actions.length === 0 ? (
        <span className="dd-caption" data-testid="needs-checker">
          {t('fin.refund.checker')}
        </span>
      ) : null}
      {msg ? <span className="dd-caption">{msg}</span> : null}
      <ReasonModal
        open={!!mode}
        title={mode === 'approve' ? t('fin.refund.approve') : t('fin.refund.reject')}
        body={mode === 'reject' ? t('fin.refund.rejectNote') : undefined}
        confirmLabel={mode === 'approve' ? t('fin.refund.approve') : t('fin.refund.reject')}
        danger={mode === 'reject'}
        onClose={() => setMode(null)}
        onConfirm={async (reason) => {
          const x = await call('POST', `/v1/admin/finance/refunds/${r.id}/${mode}`, {
            body: { reason },
          });
          if (!x.ok) return errorMessage(locale, x.errors);
          setMode(null);
          onDone();
          return null;
        }}
      />
    </div>
  );
}

function Refunds() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<AdminRefundRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await call<AdminRefundRow[]>('GET', '/v1/admin/finance/refunds', {
      query: { status: status || undefined, limit: 25 },
    });
    if (r.ok) {
      setRows(r.data ?? []);
      setNext(r.nextCursor);
    } else setRows([]);
  }, [call, status]);
  useEffect(() => {
    void load();
  }, [load]);
  const more = async () => {
    if (!next) return;
    const r = await call<AdminRefundRow[]>('GET', '/v1/admin/finance/refunds', {
      query: { status: status || undefined, limit: 25, cursor: next },
    });
    if (r.ok) {
      setRows((cur) => [...(cur ?? []), ...(r.data ?? [])]);
      setNext(r.nextCursor);
    }
  };
  return (
    <div className="dd-stack" data-testid="finance-refunds">
      <div className="dd-inline-fields">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('fin.col.status')}
          style={{ maxInlineSize: 220 }}
        >
          <option value="">{t('mdeal.hub.allStatuses')}</option>
          {REFUND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`vrefund.${s}` as DictionaryKey)}
            </option>
          ))}
        </Select>
      </div>
      {!rows ? (
        <LoadingState label={t('state.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('fin.refund.empty')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('fin.col.ref')}</th>
                  <th scope="col">{t('fin.col.merchant')}</th>
                  <th scope="col">{t('fin.col.amount')}</th>
                  <th scope="col">{t('fin.col.status')}</th>
                  <th scope="col">{t('fin.col.when')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="refund-row" data-status={r.status}>
                    <td>
                      <span className="dd-ltr">{r.reference}</span>
                      <div className="dd-caption dd-ltr">{r.orderReference}</div>
                      <div className="dd-caption">
                        {t(`vreason.${r.reasonCode}` as DictionaryKey)}
                        {r.customerFirstName ? ` · ${r.customerFirstName}` : ''}
                      </div>
                    </td>
                    <td>{bn(r.merchant, locale)}</td>
                    <td className="dd-ltr">{formatMoney(locale, r.amountHalalas)}</td>
                    <td>
                      <StatusChip tone={REFUND_TONE[r.status] ?? 'neutral'}>
                        {t(`vrefund.${r.status}` as DictionaryKey)}
                      </StatusChip>
                    </td>
                    <td className="dd-caption">{formatDateTime(locale, r.createdAt)}</td>
                    <td>
                      <RefundActions r={r} onDone={() => void load()} />
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
    </div>
  );
}

// ================================================================ support cases
interface CaseRow {
  id: string;
  reference: string;
  type: string;
  status: string;
  subject: string;
  body: string;
  customerFirstName: string | null;
  orderReference: string | null;
  voucherReference: string | null;
  note: string | null;
  createdAt: string;
}

function Cases() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [status, setStatus] = useState('');
  const load = useCallback(async () => {
    const r = await call<CaseRow[]>('GET', '/v1/admin/finance/cases', {
      query: { status: status || undefined, limit: 50 },
    });
    setRows(r.ok ? (r.data ?? []) : []);
  }, [call, status]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="dd-stack" data-testid="finance-cases">
      <div className="dd-inline-fields">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('fin.col.status')}
          style={{ maxInlineSize: 220 }}
        >
          <option value="">{t('mdeal.hub.allStatuses')}</option>
          {SUPPORT_CASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`vcase.status.${s}` as DictionaryKey)}
            </option>
          ))}
        </Select>
      </div>
      {!rows ? (
        <LoadingState label={t('state.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('fin.noCases')} />
      ) : (
        <div className="dd-stack">
          {rows.map((c) => (
            <CaseCard key={c.id} c={c} onSaved={() => void load()} />
          ))}
        </div>
      )}
    </div>
  );
}

function CaseCard({ c, onSaved }: { c: CaseRow; onSaved: () => void }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [status, setStatus] = useState(c.status);
  const [note, setNote] = useState(c.note ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <Card flat data-testid="case-card">
      <div className="dd-row" style={{ justifyContent: 'space-between' }}>
        <strong>{c.subject}</strong>
        <span className="dd-caption dd-ltr">{c.reference}</span>
      </div>
      <div className="dd-caption">
        {t('fin.case.from', {
          name: c.customerFirstName ?? '–',
          type: t(`vcase.type.${c.type}` as DictionaryKey),
        })}
        {c.orderReference ? ` · ${c.orderReference}` : ''}
        {c.voucherReference ? ` · ${c.voucherReference}` : ''}
      </div>
      <p className="dd-pre">{c.body}</p>
      <div className="dd-inline-fields">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('fin.case.mark')}
          style={{ maxInlineSize: 200 }}
        >
          {SUPPORT_CASE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`vcase.status.${s}` as DictionaryKey)}
            </option>
          ))}
        </Select>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('fin.case.note')}
          aria-label={t('fin.case.note')}
          maxLength={500}
        />
        <Button
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const r = await call('POST', `/v1/admin/finance/cases/${c.id}`, {
              body: { status, note: note.trim() || undefined },
            });
            setBusy(false);
            setMsg(r.ok ? t('fin.refund.done') : errorMessage(locale, r.errors));
            if (r.ok) onSaved();
          }}
        >
          {t('fin.case.save')}
        </Button>
        {msg ? <span className="dd-caption">{msg}</span> : null}
      </div>
    </Card>
  );
}

// ================================================================ order detail
export function FinanceOrderPage({ id }: { id: string }) {
  return (
    <RequirePermission any={['admin.vouchers.lookup']}>
      <OrderInner id={id} />
    </RequirePermission>
  );
}

function OrderInner({ id }: { id: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [d, setD] = useState<AdminOrderDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [dialog, setDialog] = useState<null | 'reverse' | 'refund'>(null);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const r = await call<AdminOrderDetail>('GET', `/v1/admin/finance/orders/${id}`);
    if (r.ok && r.data) {
      setD(r.data);
      setState('ready');
    } else setState(r.status === 404 ? 'missing' : 'error');
  }, [call, id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'missing') return <EmptyState title={t('fin.noResults')} />;
  if (state === 'error' || !d) return <Alert tone="danger">{t('error.generic')}</Alert>;
  const m = (h: number) => formatMoney(locale, h);
  const o = d.order;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="finance-order">
      <Link className="dd-link" href={withLocale('/finance', locale)}>
        ← {t('fin.back')}
      </Link>
      <div className="dd-topbar">
        <div className="dd-row">
          <h1 className="dd-title-xl dd-ltr">{t('fin.order', { ref: o.reference })}</h1>
          <StatusChip tone={o.status === 'PAID' ? 'success' : 'neutral'}>
            {t(`vorder.${o.status}` as DictionaryKey)}
          </StatusChip>
        </div>
        <div className="dd-row">
          {d.canReverseRedemption && d.instance?.redemption?.status === 'REDEEMED' ? (
            <Button
              variant="outline"
              onClick={() => setDialog('reverse')}
              data-testid="fin-reverse"
            >
              {t('fin.reverse')}
            </Button>
          ) : null}
          {d.canCreateRefund && d.instance && ['ACTIVE'].includes(d.instance.status) ? (
            <Button
              variant="outline"
              onClick={() => setDialog('refund')}
              data-testid="fin-create-refund"
            >
              {t('fin.refund.create')}
            </Button>
          ) : null}
        </div>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <dl className="dd-kv">
          <div className="dd-kv__row">
            <dt>{t('fin.customer')}</dt>
            <dd>
              {o.customer.displayName}{' '}
              <span className="dd-caption dd-ltr">{o.customer.mobileMasked ?? ''}</span>
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('fin.voucher')}</dt>
            <dd>
              {bn(o.voucher.title, locale)} · {bn(o.voucher.merchant, locale)}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('fin.col.amount')}</dt>
            <dd className="dd-ltr">{m(o.totalHalalas)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('fin.terms')}</dt>
            <dd className="dd-ltr">
              {o.termsVersion ?? '–'}{' '}
              {o.termsAcceptedAt ? `· ${formatDateTime(locale, o.termsAcceptedAt)}` : ''}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2 className="dd-title">{t('fin.payments')}</h2>
        <div className="dd-table-wrap" style={{ border: 0 }}>
          <table className="dd-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{t('fin.col.status')}</th>
                <th scope="col">{t('fin.col.amount')}</th>
                <th scope="col">{t('fin.providerRef')}</th>
                <th scope="col">{t('fin.col.when')}</th>
              </tr>
            </thead>
            <tbody>
              {d.payments.map((p) => (
                <tr key={p.id} data-testid="payment-row">
                  <td className="dd-ltr">{p.attemptNo}</td>
                  <td>{t(`vpay.${p.status}` as DictionaryKey)}</td>
                  <td className="dd-ltr">{m(p.amountHalalas)}</td>
                  <td className="dd-ltr">
                    {d.canSeeProviderData ? (p.providerReference ?? '–') : t('fin.hidden')}
                  </td>
                  <td className="dd-caption">{formatDateTime(locale, p.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.canSeeProviderData && d.events.length ? (
          <>
            <h3 className="dd-title" style={{ marginBlockStart: 12 }}>
              {t('fin.events')}
            </h3>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {d.events.map((e) => (
                <li key={e.id} className="dd-caption">
                  {formatDateTime(locale, e.receivedAt)} · {e.kind} {e.status} ·{' '}
                  {t(`vevent.${e.outcome}` as DictionaryKey)}
                  {e.signatureVerified ? ` · ${t('fin.signature')}` : ''}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      {d.instance ? (
        <Card>
          <h2 className="dd-title">{t('fin.instance')}</h2>
          <dl className="dd-kv">
            <div className="dd-kv__row">
              <dt>{t('fin.col.ref')}</dt>
              <dd className="dd-ltr">{d.instance.reference}</dd>
            </div>
            <div className="dd-kv__row">
              <dt>{t('fin.col.status')}</dt>
              <dd>{t(`vinst.${d.instance.status}` as DictionaryKey)}</dd>
            </div>
            {d.instance.redemption ? (
              <div className="dd-kv__row">
                <dt>{t('fin.redemption')}</dt>
                <dd>
                  <span className="dd-ltr">{d.instance.redemption.reference}</span> ·{' '}
                  {bn(d.instance.redemption.branch, locale)} ·{' '}
                  {formatDateTime(locale, d.instance.redemption.redeemedAt)}
                  {d.instance.redemption.status === 'REVERSED'
                    ? ` · ${d.instance.redemption.reverseReason ?? ''}`
                    : ''}
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>
      ) : null}

      <Card>
        <h2 className="dd-title">{t('fin.refunds')}</h2>
        {d.refunds.length === 0 ? (
          <p className="dd-muted">{t('fin.refund.empty')}</p>
        ) : (
          <div className="dd-stack">
            {d.refunds.map((r) => (
              <div
                key={r.id}
                className="dd-row"
                style={{ justifyContent: 'space-between' }}
                data-testid="order-refund"
              >
                <div>
                  <span className="dd-ltr">{r.reference}</span>{' '}
                  <StatusChip tone={REFUND_TONE[r.status] ?? 'neutral'}>
                    {t(`vrefund.${r.status}` as DictionaryKey)}
                  </StatusChip>
                  <div className="dd-caption">
                    {m(r.amountHalalas)} · {t(`vreason.${r.reasonCode}` as DictionaryKey)}
                  </div>
                </div>
                <RefundActions r={r} onDone={() => void load()} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="dd-title">{t('fin.journals')}</h2>
        <div className="dd-stack">
          {d.journals.map((j) => (
            <div key={j.id} data-testid="journal">
              <strong>{t(`vjournal.${j.type}` as DictionaryKey)}</strong>{' '}
              <span className="dd-caption">{formatDateTime(locale, j.postedAt)}</span>
              <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                {j.entries.map((e, i) => (
                  <li key={i} className="dd-caption">
                    {t(`vledger.${e.account}` as DictionaryKey)}:{' '}
                    <span className="dd-ltr">{m(e.amountHalalas)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="dd-title">{t('fin.payable')}</h2>
        {d.payableEvents.length === 0 ? (
          <p className="dd-muted">{t('mf.eventsEmpty')}</p>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {d.payableEvents.map((e) => (
              <li key={e.id} className="dd-caption">
                {t(`vpayable.${e.type}` as DictionaryKey)} ·{' '}
                <span className="dd-ltr">{m(e.amountHalalas)}</span> ·{' '}
                {formatDateTime(locale, e.createdAt)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="dd-title">{t('fin.cases')}</h2>
        {d.cases.length === 0 ? (
          <p className="dd-muted">{t('fin.noCases')}</p>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {d.cases.map((c) => (
              <li key={c.id}>
                <span className="dd-ltr">{c.reference}</span> · {c.subject} ·{' '}
                {t(`vcase.status.${c.status}` as DictionaryKey)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ReasonModal
        open={dialog === 'reverse'}
        title={t('fin.reverse')}
        body={t('fin.reverseBody')}
        confirmLabel={t('fin.reverse')}
        danger
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const r = await call(
            'POST',
            `/v1/admin/finance/redemptions/${d.instance!.redemption!.id}/reverse`,
            {
              body: { reason },
            },
          );
          if (!r.ok) return errorMessage(locale, r.errors);
          setDialog(null);
          setNotice(t('mv.reverseDone'));
          void load();
          return null;
        }}
      />
      <ReasonModal
        open={dialog === 'refund'}
        title={t('fin.refund.create')}
        body={t('fin.refund.createBody')}
        confirmLabel={t('fin.refund.create')}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const r = await call('POST', '/v1/admin/finance/refunds', {
            body: { instanceId: d.instance!.id, reason },
            idempotent: true,
          });
          if (!r.ok) return errorMessage(locale, r.errors);
          setDialog(null);
          setNotice(t('fin.refund.checker'));
          void load();
          return null;
        }}
      />
    </div>
  );
}
