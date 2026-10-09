'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  RequirePermission,
  errorMessage,
  historyReason,
  useApi,
  useAuth,
  CommercialPanel,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  withLocale,
  type DictionaryKey,
} from '@dealdash/localization';
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
  Tabs,
  StatusChip,
} from '@dealdash/ui';
import type { MerchantVoucherSaleRow, VoucherMonitor, VoucherView } from '@dealdash/validation';
import { useOrgId } from './deal-utils';
import { ReasonDialog, VoucherStatusChip } from './voucher-utils';

interface HistoryRow {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  reasonAr: string | null;
  fields: string[];
  actorRole: string | null;
  actorName: string | null;
  byDealDash: boolean;
  createdAt: string;
}

const bn = (x: { en: string; ar: string }, l: 'en' | 'ar') => x[l] || x.en || x.ar;

export function VoucherDetailPage({ voucherId }: { voucherId: string }) {
  return (
    <RequirePermission any={['merchant.vouchers.manage']}>
      <DetailInner voucherId={voucherId} />
    </RequirePermission>
  );
}

function DetailInner({ voucherId }: { voucherId: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const [voucher, setVoucher] = useState<VoucherView | null>(null);
  const [mon, setMon] = useState<VoucherMonitor | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [tab, setTab] = useState('monitor');
  const [dialog, setDialog] = useState<null | 'end' | 'pause' | 'stock'>(null);
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const base = `/v1/merchants/${orgId}/vouchers/${voucherId}`;
  const load = useCallback(
    async (quiet = false) => {
      if (!orgId) return;
      if (!quiet) setState('loading');
      const [d, m] = await Promise.all([
        call<VoucherView>('GET', base),
        call<VoucherMonitor>('GET', `${base}/monitor`),
      ]);
      if (d.ok && d.data) {
        setVoucher(d.data);
        if (m.ok && m.data) setMon(m.data);
        setState('ready');
      } else if (!quiet) setState(d.status === 404 ? 'missing' : 'error');
    },
    [call, orgId, base],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void load(true), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!orgId || state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'missing') return <EmptyState title={t('detail.notFound')} />;
  if (state === 'error' || !voucher || !mon)
    return (
      <Alert tone="danger">
        {t('error.generic')}{' '}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t('state.retry')}
        </Button>
      </Alert>
    );

  const can = (a: string) => voucher.allowedActions.includes(a);
  const title = bn(voucher.content.title, locale) || t('mdeal.untitled');
  const act = async (path: string, body: unknown = {}) => {
    const r = await call<VoucherView>('POST', `${base}/${path}`, { body });
    if (r.ok && r.data) {
      setVoucher(r.data);
      void load(true);
      return null;
    }
    return errorMessage(locale, r.errors);
  };

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="voucher-detail">
      <div className="dd-builder__bar">
        <div className="dd-row">
          <Link className="dd-link" href={withLocale('/vouchers', locale)}>
            ← {t('mdeal.back')}
          </Link>
          <h1 className="dd-title-xl" style={{ fontSize: 22 }}>
            {title}
          </h1>
          <VoucherStatusChip status={voucher.status} />
        </div>
        <div className="dd-row">
          {can('edit') || can('edit_minor') ? (
            <Link
              className="dd-btn dd-btn--secondary"
              href={withLocale(`/vouchers/${voucherId}/edit`, locale)}
            >
              {t('action.edit')}
            </Link>
          ) : null}
          {can('stock') ? (
            <Button
              variant="outline"
              onClick={() => setDialog('stock')}
              data-testid="open-capacity"
            >
              {t('mv.addCapacity')}
            </Button>
          ) : null}
          {can('pause') ? (
            <Button variant="outline" onClick={() => setDialog('pause')} data-testid="open-pause">
              {t('mv.pause')}
            </Button>
          ) : null}
          {can('resume') ? (
            <Button
              variant="outline"
              data-testid="do-resume"
              onClick={async () => {
                const e = await act('resume');
                if (e) setBanner({ tone: 'danger', text: e });
              }}
            >
              {t('mv.resume')}
            </Button>
          ) : null}
          {can('end') ? (
            <Button variant="danger" onClick={() => setDialog('end')} data-testid="open-end">
              {t('mv.end')}
            </Button>
          ) : null}
          {can('submit') ? (
            <Button
              data-testid="detail-submit"
              onClick={async () => {
                const e = await act('submit');
                if (e) setBanner({ tone: 'danger', text: e });
              }}
            >
              {t('mhb.submit')}
            </Button>
          ) : null}
        </div>
      </div>

      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}
      {voucher.status === 'NEEDS_CHANGES' && voucher.latestDecision ? (
        <Alert tone="warning" title={t('banner.needsChanges')}>
          {(locale === 'ar' && voucher.latestDecision.reasonAr) || voucher.latestDecision.reason}
        </Alert>
      ) : null}
      {voucher.status === 'PENDING_REVIEW' ? (
        <Alert tone="info">{t('mhb.pendingEdit')}</Alert>
      ) : null}
      {voucher.status === 'PAUSED' && voucher.pausedBy === 'DEALDASH' ? (
        <Alert tone="warning">{t('mv.pausedByDealDash')}</Alert>
      ) : null}
      {voucher.status === 'SUSPENDED' ? (
        <Alert tone="danger">
          {t('mv.suspendedNote')} {voucher.latestDecision?.reason ?? ''}
        </Alert>
      ) : null}

      <Tabs
        label={t('mv.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'monitor', label: t('mv.tabMonitor') },
          { id: 'sales', label: t('mv.tabSales') },
          { id: 'activity', label: t('mv.tabActivity') },
        ]}
      />
      {tab === 'monitor' ? (
        <Monitor voucher={voucher} mon={mon} />
      ) : tab === 'sales' ? (
        <Sales voucherId={voucherId} onChanged={() => void load(true)} />
      ) : (
        <ActivityTab base={base} />
      )}

      <ReasonDialog
        open={dialog === 'end'}
        title={t('mv.endTitle')}
        body={t('mv.endBody')}
        confirmLabel={t('mv.end')}
        danger
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const e = await act('end', { reason });
          if (!e) setDialog(null);
          return e;
        }}
      />
      <ReasonDialog
        open={dialog === 'pause'}
        title={t('mv.pause')}
        optional
        confirmLabel={t('mv.pause')}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const e = await act('pause', reason ? { reason } : {});
          if (!e) setDialog(null);
          return e;
        }}
      />
      <CapacityDialog
        open={dialog === 'stock'}
        voucher={voucher}
        onClose={() => setDialog(null)}
        onSubmit={async (body) => {
          const e = await act('stock', body);
          if (!e) {
            setDialog(null);
            setBanner({ tone: 'success', text: t('mv.capacityDone') });
          }
          return e;
        }}
      />
      {orgId ? (
        <CommercialPanel orgId={orgId} product="VOUCHER" subjectId={voucher.id} content={{}} refreshKey={voucher.version} />
      ) : null}
    </div>
  );
}

function CapacityDialog({
  open,
  voucher,
  onClose,
  onSubmit,
}: {
  open: boolean;
  voucher: VoucherView;
  onClose: () => void;
  onSubmit: (b: { delta: number }) => Promise<string | null>;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setMode('add');
      setAmount(10);
      setError(null);
    }
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('mv.capacity')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={amount < 1}
            data-testid="capacity-confirm"
            onClick={async () => {
              setBusy(true);
              const e = await onSubmit({ delta: mode === 'add' ? amount : -amount });
              setBusy(false);
              setError(e);
            }}
          >
            {mode === 'add' ? t('mv.addCapacity') : t('mv.removeCapacity')}
          </Button>
        </>
      }
    >
      <div className="dd-stack">
        <p className="dd-help">{t('mv.capacityHelp')}</p>
        <p className="dd-caption dd-ltr">
          {t('mv.kpi.remaining')}: {voucher.stock.remaining} / {voucher.stock.total}
        </p>
        <div className="dd-segment" role="group" aria-label={t('mv.capacity')}>
          <button type="button" aria-pressed={mode === 'add'} onClick={() => setMode('add')}>
            {t('mv.addCapacity')}
          </button>
          <button type="button" aria-pressed={mode === 'remove'} onClick={() => setMode('remove')}>
            {t('mv.removeCapacity')}
          </button>
        </div>
        <Field label={t('mv.capacityAmount')} htmlFor="capacity-amount">
          <Input
            id="capacity-amount"
            type="number"
            min={1}
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            style={{ maxInlineSize: 160 }}
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

function Kpi({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <Card flat>
      <div className="dd-caption">{label}</div>
      <div className="dd-title-xl dd-ltr" style={{ fontSize: 24 }} data-testid={testId}>
        {value}
      </div>
    </Card>
  );
}

function Monitor({ voucher, mon }: { voucher: VoucherView; mon: VoucherMonitor }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const f = mon.finance;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="voucher-monitor">
      <div className="dd-finance-grid">
        <Kpi label={t('mv.kpi.sold')} value={mon.sales.sold} testId="kpi-sold" />
        <Kpi label={t('mv.kpi.active')} value={mon.sales.active} />
        <Kpi label={t('mv.kpi.used')} value={mon.sales.redeemed} testId="kpi-used" />
        <Kpi label={t('mv.kpi.expired')} value={mon.sales.expired} />
        <Kpi label={t('mv.kpi.refunded')} value={mon.sales.refunded} />
        <Kpi
          label={t('mv.kpi.rate')}
          value={mon.sales.redemptionRatePct === null ? '–' : `${mon.sales.redemptionRatePct}%`}
        />
        <Kpi label={t('mv.kpi.remaining')} value={`${mon.stock.remaining} / ${mon.stock.total}`} />
        <Kpi label={t('mv.kpi.held')} value={mon.stock.held} />
      </div>
      <Card flat>
        <h2 className="dd-title">{t('mv.funnel')}</h2>
        <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
          <div className="dd-kv__row">
            <dt>{t('mv.funnel.impressions')}</dt>
            <dd className="dd-ltr">{mon.funnel.impressions}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mv.funnel.views')}</dt>
            <dd className="dd-ltr">{mon.funnel.detailViews}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mv.funnel.checkouts')}</dt>
            <dd className="dd-ltr">{mon.funnel.checkoutsStarted}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mv.funnel.paid')}</dt>
            <dd className="dd-ltr">{mon.funnel.paymentsSucceeded}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('mv.funnel.failed')}</dt>
            <dd className="dd-ltr">{mon.funnel.paymentsFailed}</dd>
          </div>
        </dl>
      </Card>
      {f ? (
        <Card flat>
          <h2 className="dd-title">{t('mv.money')}</h2>
          <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
            <div className="dd-kv__row">
              <dt>{t('mv.money.sold')}</dt>
              <dd className="dd-ltr">{formatMoney(locale, f.soldGrossHalalas)}</dd>
            </div>
            <div className="dd-kv__row">
              <dt>{t('mv.money.redeemed')}</dt>
              <dd className="dd-ltr">{formatMoney(locale, f.redeemedGrossHalalas)}</dd>
            </div>
            <div className="dd-kv__row">
              <dt>{t('mv.money.eligible')}</dt>
              <dd className="dd-ltr" data-testid="money-eligible">
                {formatMoney(locale, f.settlementEligibleHalalas)}
              </dd>
            </div>
            <div className="dd-kv__row">
              <dt>{t('mv.money.refunded')}</dt>
              <dd className="dd-ltr">{formatMoney(locale, f.refundedHalalas)}</dd>
            </div>
          </dl>
          <p className="dd-caption">{t('mv.moneyNote')}</p>
        </Card>
      ) : null}
      <p className="dd-caption">
        {formatMoney(locale, voucher.content.faceValueHalalas)} /{' '}
        {formatMoney(locale, voucher.content.sellingPriceHalalas)} ·{' '}
        {t('vch.savingsAmount', {
          amount: formatMoney(locale, voucher.savings.savingsHalalas),
          pct: voucher.savings.savingsPercent,
        })}
      </p>
    </div>
  );
}

function Sales({ voucherId, onChanged }: { voucherId: string; onChanged: () => void }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const [rows, setRows] = useState<MerchantVoucherSaleRow[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [status, setStatus] = useState('');
  const [reverse, setReverse] = useState<MerchantVoucherSaleRow | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    const r = await call<MerchantVoucherSaleRow[]>('GET', `/v1/merchants/${orgId}/vouchers/sales`, {
      query: { voucherId, status: status || undefined, limit: 50 },
    });
    if (r.ok) {
      setRows(r.data ?? []);
      setState('ready');
    } else setState('error');
  }, [call, orgId, voucherId, status]);
  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') return <LoadingState label={t('state.loading')} />;
  return (
    <div className="dd-stack" data-testid="voucher-sales">
      <div className="dd-inline-fields">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('mv.col.status')}
          style={{ maxInlineSize: 200 }}
        >
          <option value="">{t('mdeal.hub.allStatuses')}</option>
          {['ACTIVE', 'REDEEMED', 'EXPIRED', 'REFUNDED', 'VOIDED'].map((s) => (
            <option key={s} value={s}>
              {t(`vinst.${s}` as DictionaryKey)}
            </option>
          ))}
        </Select>
      </div>
      <p className="dd-caption">{t('mv.salesPrivacy')}</p>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {state === 'error' ? (
        <Alert tone="danger">{t('error.generic')}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={t('mv.salesEmpty')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('mv.col.ref')}</th>
                  <th scope="col">{t('mv.col.customer')}</th>
                  <th scope="col">{t('mv.col.paid')}</th>
                  <th scope="col">{t('mv.col.status')}</th>
                  <th scope="col">{t('mv.col.when')}</th>
                  <th scope="col">{t('mv.col.branch')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="sale-row">
                    <td className="dd-ltr">{r.reference}</td>
                    <td>{r.customerFirstName ?? '–'}</td>
                    <td className="dd-ltr">{formatMoney(locale, r.pricePaidHalalas)}</td>
                    <td>
                      <StatusChip
                        tone={
                          r.status === 'ACTIVE'
                            ? 'success'
                            : r.status === 'REDEEMED'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {t(`vinst.${r.status}` as DictionaryKey)}
                      </StatusChip>
                    </td>
                    <td className="dd-caption">
                      {formatDateTime(locale, r.redeemedAt ?? r.issuedAt)}
                    </td>
                    <td>{r.redeemedBranch ? bn(r.redeemedBranch, locale) : '–'}</td>
                    <td>
                      {r.canReverse && r.redemptionId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="sale-reverse"
                          onClick={() => setReverse(r)}
                        >
                          {t('mv.reverse')}
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
      <ReasonDialog
        open={!!reverse}
        title={t('mv.reverseTitle')}
        body={t('mv.reverseBody')}
        confirmLabel={t('mv.reverse')}
        danger
        onClose={() => setReverse(null)}
        onConfirm={async (reason) => {
          const r = await call(
            'POST',
            `/v1/merchants/${orgId}/voucher-redemptions/${reverse!.redemptionId}/reverse`,
            {
              body: { reason },
            },
          );
          if (!r.ok) return errorMessage(locale, r.errors);
          setReverse(null);
          setNotice(t('mv.reverseDone'));
          void load();
          onChanged();
          return null;
        }}
      />
    </div>
  );
}

function ActivityTab({ base }: { base: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    void call<HistoryRow[]>('GET', `${base}/history`).then((r) =>
      setRows(r.ok ? (r.data ?? []) : []),
    );
  }, [call, base]);
  if (!rows) return <LoadingState label={t('state.loading')} />;
  return (
    <ol
      className="dd-stack"
      data-testid="voucher-activity"
      style={{ listStyle: 'none', padding: 0 }}
    >
      {rows.map((h) => (
        <li key={h.id}>
          <Card flat>
            <div className="dd-row" style={{ justifyContent: 'space-between' }}>
              <strong>{t(`vaction.${h.action}` as DictionaryKey)}</strong>
              <span className="dd-caption">{formatDateTime(locale, h.createdAt)}</span>
            </div>
            <div className="dd-caption">
              {h.byDealDash ? 'DealDash' : (h.actorName ?? h.actorRole ?? '')}
            </div>
            {(locale === 'ar' && h.reasonAr) || h.reason ? (
              <p style={{ margin: '6px 0 0' }}>
                {(locale === 'ar' && h.reasonAr) || historyReason(locale, h.reason)}
              </p>
            ) : null}
          </Card>
        </li>
      ))}
    </ol>
  );
}
