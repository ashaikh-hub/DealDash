'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CommercialPanel,
  Countdown,
  RequirePermission,
  errorMessage,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
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
  Textarea,
} from '@dealdash/ui';
import type { HotDealView, HotMonitor } from '@dealdash/validation';
import { useOrgId, when } from './deal-utils';
import { HotStatusChip, pct } from './hot-utils';

interface Activity {
  id: string;
  at: string;
  source: 'deal' | 'reservation';
  code: string;
  note: string | null;
  actor: string | null;
  ref: string | null;
}
interface ResRow {
  id: string;
  codeLast4: string;
  customerFirstName: string | null;
  quantity: number;
  branch: { en: string; ar: string };
  status: 'HELD' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';
  cancelledBy: string | null;
  expiresAt: string;
  createdAt: string;
  redeemedAt: string | null;
  canCancel: boolean;
  canReverse: boolean;
}

export function HotDealDetail({ dealId }: { dealId: string }) {
  return (
    <RequirePermission any={['merchant.deals.read']}>
      <DetailInner dealId={dealId} />
    </RequirePermission>
  );
}

const bn = (x: { en: string; ar: string }, l: 'en' | 'ar') => x[l] || x.en || x.ar;

function DetailInner({ dealId }: { dealId: string }) {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const [deal, setDeal] = useState<HotDealView | null>(null);
  const [mon, setMon] = useState<HotMonitor | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [tab, setTab] = useState('monitor');
  const [updated, setUpdated] = useState<Date | null>(null);
  const [dialog, setDialog] = useState<null | 'cancel' | 'pause' | 'stock'>(null);
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const canManage = !!me?.permissions.includes('merchant.deals.manage');

  const base = `/v1/merchants/${orgId}/hot-deals/${dealId}`;
  const load = useCallback(
    async (quiet = false) => {
      if (!orgId) return;
      if (!quiet) setState('loading');
      const [d, m] = await Promise.all([
        call<HotDealView>('GET', base),
        call<HotMonitor>('GET', `${base}/monitor`),
      ]);
      if (d.ok && d.data) {
        setDeal(d.data);
        if (m.ok && m.data) setMon(m.data);
        setUpdated(new Date());
        setState('ready');
      } else if (!quiet) setState(d.status === 404 ? 'missing' : 'error');
    },
    [call, orgId, base],
  );
  useEffect(() => {
    void load();
  }, [load]);
  // the live monitor keeps itself fresh while the page is open
  useEffect(() => {
    const timer = setInterval(() => void load(true), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!orgId || state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'missing') return <EmptyState title={t('detail.notFound')} />;
  if (state === 'error' || !deal || !mon)
    return (
      <Alert tone="danger">
        {t('error.generic')}{' '}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t('state.retry')}
        </Button>
      </Alert>
    );

  const actions = deal.allowedActions;
  const can = (a: string) => canManage && actions.includes(a);
  const title = bn(deal.content.title, locale) || t('mdeal.untitled');
  const act = async (path: string, body: unknown = {}) => {
    const r = await call<HotDealView>('POST', `${base}/${path}`, { body });
    if (r.ok && r.data) {
      setDeal(r.data);
      void load(true);
      return null;
    }
    return errorMessage(locale, r.errors);
  };

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="hot-detail">
      <div className="dd-builder__bar">
        <div className="dd-row">
          <Link className="dd-link" href={withLocale('/deals/hot', locale)}>
            ← {t('mdeal.back')}
          </Link>
          <h1 className="dd-title-xl" style={{ fontSize: 22 }}>
            {title}
          </h1>
          <HotStatusChip status={deal.status} />
        </div>
        <div className="dd-row">
          {(can('edit') || can('edit_minor')) && (
            <Link
              className="dd-btn dd-btn--secondary"
              href={withLocale(`/deals/hot/${dealId}/edit`, locale)}
            >
              {t('action.edit')}
            </Link>
          )}
          {can('stock') ? (
            <Button variant="outline" onClick={() => setDialog('stock')} data-testid="open-stock">
              {t('mm.addStock')}
            </Button>
          ) : null}
          {can('pause') ? (
            <Button variant="outline" onClick={() => setDialog('pause')} data-testid="open-pause">
              {t('mm.pause')}
            </Button>
          ) : null}
          {can('resume') ? (
            <Button
              variant="outline"
              onClick={async () => {
                const e = await act('resume');
                if (e) setBanner({ tone: 'danger', text: e });
              }}
              data-testid="do-resume"
            >
              {t('mm.resume')}
            </Button>
          ) : null}
          {can('cancel') ? (
            <Button variant="danger" onClick={() => setDialog('cancel')} data-testid="open-cancel">
              {t('mm.cancelDeal')}
            </Button>
          ) : null}
          {can('submit') ? (
            <Button
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
      {deal.status === 'NEEDS_CHANGES' && deal.latestDecision ? (
        <Alert tone="warning" title={t('banner.needsChanges')}>
          {(locale === 'ar' && deal.latestDecision.reasonAr) || deal.latestDecision.reason}
        </Alert>
      ) : null}
      {deal.status === 'PENDING_REVIEW' ? <Alert tone="info">{t('mhb.pendingEdit')}</Alert> : null}
      {deal.status === 'PAUSED' && deal.pausedBy === 'DEALDASH' ? (
        <Alert tone="warning">{t('mm.pausedByDealDash')}</Alert>
      ) : null}
      {deal.status === 'SUSPENDED' ? (
        <Alert tone="danger">{deal.latestDecision?.reason ?? t('hotstatus.SUSPENDED')}</Alert>
      ) : null}

      <Tabs
        label={t('mm.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'monitor', label: t('mm.tabMonitor') },
          { id: 'reservations', label: t('mm.tabReservations') },
          { id: 'results', label: t('mm.tabResults') },
          { id: 'activity', label: t('mm.tabActivity') },
        ]}
      />

      {tab === 'monitor' ? (
        <Monitor deal={deal} mon={mon} updated={updated} onRefresh={() => void load(true)} />
      ) : tab === 'reservations' ? (
        <Reservations
          base={base}
          deal={deal}
          canManage={canManage}
          onChanged={() => void load(true)}
        />
      ) : tab === 'results' ? (
        <Results mon={mon} />
      ) : (
        <ActivityTab base={base} />
      )}

      <ConfirmReason
        open={dialog === 'cancel'}
        title={t('mm.cancelDealTitle')}
        body={t('mm.cancelDealBody')}
        confirmLabel={t('mm.cancelDeal')}
        danger
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const e = await act('cancel', { reason });
          if (!e) setDialog(null);
          return e;
        }}
      />
      <ConfirmReason
        open={dialog === 'pause'}
        title={t('mm.pause')}
        body=""
        optional
        confirmLabel={t('mm.pause')}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const e = await act('pause', reason ? { reason } : {});
          if (!e) setDialog(null);
          return e;
        }}
      />
      <StockDialog
        open={dialog === 'stock'}
        deal={deal}
        onClose={() => setDialog(null)}
        onSubmit={async (body) => {
          const e = await act('stock', body);
          if (!e) {
            setDialog(null);
            setBanner({ tone: 'success', text: t('mm.stockDone') });
          }
          return e;
        }}
      />
      {orgId ? (
        <CommercialPanel orgId={orgId} product="EXCLUSIVE" subjectId={deal.id} content={{}} refreshKey={deal.version} />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ dialogs
function ConfirmReason({
  open,
  title,
  body,
  confirmLabel,
  danger,
  optional,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  optional?: boolean;
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
  const ok = optional || reason.trim().length >= 3;
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
            disabled={!ok}
            loading={busy}
            data-testid="confirm-reason"
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
        <Field label={`${t('mm.reason')}${optional ? '' : ' *'}`} htmlFor="reason">
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

function StockDialog({
  open,
  deal,
  onClose,
  onSubmit,
}: {
  open: boolean;
  deal: HotDealView;
  onClose: () => void;
  onSubmit: (b: { branchId: string; delta: number }) => Promise<string | null>;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const rows = deal.inventory.filter((i) => i.tracked);
  const [branchId, setBranchId] = useState('');
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setBranchId(rows[0]?.branchId ?? '');
      setError(null);
      setMode('add');
      setAmount(5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const sel = rows.find((r) => r.branchId === branchId);
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('mm.addStock')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={!branchId || amount < 1}
            data-testid="stock-confirm"
            onClick={async () => {
              setBusy(true);
              const e = await onSubmit({ branchId, delta: mode === 'add' ? amount : -amount });
              setBusy(false);
              setError(e);
            }}
          >
            {mode === 'add' ? t('mm.addStock') : t('mm.removeStock')}
          </Button>
        </>
      }
    >
      <div className="dd-stack">
        <p className="dd-help">{t('mm.stockHelp')}</p>
        <Field label={t('mm.col.branch')} htmlFor="stock-branch">
          <Select id="stock-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {rows.map((r) => (
              <option key={r.branchId} value={r.branchId}>
                {bn(r.branchName, locale)} ({t('mm.available')}: {r.stock.available})
              </option>
            ))}
          </Select>
        </Field>
        <div className="dd-segment" role="group" aria-label={t('mm.stock')}>
          <button type="button" aria-pressed={mode === 'add'} onClick={() => setMode('add')}>
            {t('mm.addStock')}
          </button>
          <button type="button" aria-pressed={mode === 'remove'} onClick={() => setMode('remove')}>
            {t('mm.removeStock')}
          </button>
        </div>
        <Field
          label={t('mm.stockAmount')}
          htmlFor="stock-amount"
          help={
            mode === 'remove' && sel ? `${t('mm.available')}: ${sel.stock.available}` : undefined
          }
        >
          <Input
            id="stock-amount"
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

// ------------------------------------------------------------------ tabs
function Monitor({
  deal,
  mon,
  updated,
  onRefresh,
}: {
  deal: HotDealView;
  mon: HotMonitor;
  updated: Date | null;
  onRefresh: () => void;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const total = Math.max(1, mon.totals.total);
  const w = (n: number) => `${Math.round((n / total) * 1000) / 10}%`;
  const tracked = mon.totals.total > 0;
  return (
    <div className="dd-monitor" data-testid="hot-monitor">
      <div className="dd-kpis">
        <div className="dd-kpi">
          <div className="dd-kpi__n" style={{ fontSize: 20 }}>
            <HotStatusChip status={mon.status} />
          </div>
          <div className="dd-kpi__l">{t('mm.status')}</div>
        </div>
        <div className="dd-kpi">
          <div className="dd-kpi__n">
            <Countdown target={mon.endAt} serverNow={mon.serverNow} locale={locale} />
          </div>
          <div className="dd-kpi__l">{t('mm.timeLeft')}</div>
        </div>
        {tracked ? (
          <>
            <div className="dd-kpi" data-testid="kpi-available">
              <div className="dd-kpi__n">{mon.totals.available}</div>
              <div className="dd-kpi__l">{t('mm.available')}</div>
            </div>
            <div className="dd-kpi" data-testid="kpi-reserved">
              <div className="dd-kpi__n">{mon.totals.reserved}</div>
              <div className="dd-kpi__l">{t('mm.reserved')}</div>
            </div>
            <div className="dd-kpi" data-testid="kpi-redeemed">
              <div className="dd-kpi__n">{mon.totals.redeemed}</div>
              <div className="dd-kpi__l">{t('mm.redeemed')}</div>
            </div>
            <div className="dd-kpi">
              <div className="dd-kpi__n">{mon.reservations.expired}</div>
              <div className="dd-kpi__l">{t('mm.notCompleted')}</div>
            </div>
            <div className="dd-kpi">
              <div className="dd-kpi__n">{mon.reservations.expiringSoon}</div>
              <div className="dd-kpi__l">{t('mm.expiringSoon')}</div>
            </div>
          </>
        ) : null}
      </div>

      {tracked ? (
        <Card>
          <div className="dd-stack">
            <h2 className="dd-title">{t('mm.stock')}</h2>
            <div
              className="dd-stockbar"
              role="img"
              aria-label={`${t('mm.available')} ${mon.totals.available}, ${t('mm.reserved')} ${mon.totals.reserved}, ${t('mm.redeemed')} ${mon.totals.redeemed}`}
            >
              <span className="dd-stockbar__used" style={{ inlineSize: w(mon.totals.redeemed) }} />
              <span className="dd-stockbar__res" style={{ inlineSize: w(mon.totals.reserved) }} />
              <span
                className="dd-stockbar__avail"
                style={{ inlineSize: w(mon.totals.available) }}
              />
            </div>
            <div className="dd-legend">
              <span>
                <i style={{ background: 'var(--dd-purple)' }} />
                {t('mm.redeemed')}
              </span>
              <span>
                <i style={{ background: 'var(--dd-amber)' }} />
                {t('mm.reserved')}
              </span>
              <span>
                <i style={{ background: 'var(--dd-mint)' }} />
                {t('mm.available')}
              </span>
            </div>
            <h3 className="dd-title" style={{ fontSize: 15 }}>
              {t('mm.byBranch')}
            </h3>
            <div className="dd-table-wrap">
              <table className="dd-table">
                <thead>
                  <tr>
                    <th scope="col">{t('mm.col.branch')}</th>
                    <th scope="col" className="dd-num">
                      {t('mm.total')}
                    </th>
                    <th scope="col" className="dd-num">
                      {t('mm.available')}
                    </th>
                    <th scope="col" className="dd-num">
                      {t('mm.reserved')}
                    </th>
                    <th scope="col" className="dd-num">
                      {t('mm.redeemed')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mon.inventory
                    .filter((i) => i.tracked)
                    .map((i) => (
                      <tr key={i.branchId}>
                        <td>{bn(i.branchName, locale)}</td>
                        <td className="dd-num">{i.stock.total}</td>
                        <td className="dd-num">{i.stock.available}</td>
                        <td className="dd-num">{i.stock.reserved}</td>
                        <td className="dd-num">{i.stock.redeemed}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      ) : (
        <Alert tone="info">{t('mh.reservationsOff')}</Alert>
      )}
      <div className="dd-row" style={{ justifyContent: 'space-between' }}>
        <span className="dd-caption">
          {updated
            ? t('mm.lastUpdated', {
                time: updated.toLocaleTimeString(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  timeZone: 'Asia/Riyadh',
                }),
              })
            : ''}{' '}
          · {t('mm.autoRefresh')}
        </span>
        <Button size="sm" variant="outline" onClick={onRefresh}>
          {t('mm.refresh')}
        </Button>
      </div>
      <span hidden>{deal.id}</span>
    </div>
  );
}

function Results({ mon }: { mon: HotMonitor }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const f = mon.funnel;
  const max = Math.max(1, f.impressions, f.detailViews, f.reservationsCreated);
  const row = (label: string, n: number) => (
    <div className="dd-funnel__row" key={label}>
      <span>{label}</span>
      <div className="dd-funnel__bar">
        <span style={{ inlineSize: `${Math.round((n / max) * 100)}%` }} />
      </div>
      <strong className="dd-ltr">{n}</strong>
    </div>
  );
  return (
    <div className="dd-stack" data-testid="hot-results">
      <Card>
        <div className="dd-stack">
          <h2 className="dd-title">{t('mm.funnel')}</h2>
          <div className="dd-funnel">
            {row(t('mm.impressions'), f.impressions)}
            {row(t('mm.detailViews'), f.detailViews)}
            {row(t('mm.created'), f.reservationsCreated)}
            {row(t('mm.used'), f.redeemed)}
          </div>
          <div className="dd-kpis">
            <div className="dd-kpi">
              <div className="dd-kpi__n">{pct(f.viewToReservationPct, '–')}</div>
              <div className="dd-kpi__l">{t('mm.viewToRes')}</div>
            </div>
            <div className="dd-kpi">
              <div className="dd-kpi__n">{pct(f.reservationToRedeemedPct, '–')}</div>
              <div className="dd-kpi__l">{t('mm.resToUsed')}</div>
            </div>
            <div className="dd-kpi">
              <div className="dd-kpi__n">{f.notCompleted}</div>
              <div className="dd-kpi__l">{t('mm.notCompletedLabel')}</div>
            </div>
            <div className="dd-kpi">
              <div className="dd-kpi__n">{f.reservationsCancelled}</div>
              <div className="dd-kpi__l">{t('mm.cancelledLabel')}</div>
            </div>
          </div>
          <p className="dd-caption">{t('mm.funnelNote')}</p>
        </div>
      </Card>
    </div>
  );
}

function Reservations({
  base,
  deal,
  canManage,
  onChanged,
}: {
  base: string;
  deal: HotDealView;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const [rows, setRows] = useState<ResRow[]>([]);
  const [status, setStatus] = useState('');
  const [branchId, setBranchId] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    const r = await call<ResRow[]>('GET', `${base}/reservations`, {
      query: { status: status || undefined, branchId: branchId || undefined, limit: 50 },
    });
    if (mine !== seq.current) return;
    if (r.ok) {
      setRows(r.data ?? []);
      setState('ready');
    } else setState('error');
  }, [call, base, status, branchId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void load(), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="dd-stack" data-testid="hot-reservations">
      <div className="dd-inline-fields">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('mm.col.status')}
          style={{ maxInlineSize: 200 }}
        >
          <option value="">{t('mm.filterAll')}</option>
          {(['HELD', 'REDEEMED', 'EXPIRED', 'CANCELLED'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`resstatus.${s}` as DictionaryKey)}
            </option>
          ))}
        </Select>
        <Select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          aria-label={t('mm.col.branch')}
          style={{ maxInlineSize: 240 }}
        >
          <option value="">{t('mm.filterAll')}</option>
          {deal.inventory.map((i) => (
            <option key={i.branchId} value={i.branchId}>
              {bn(i.branchName, locale)}
            </option>
          ))}
        </Select>
      </div>
      {state === 'loading' ? (
        <LoadingState label={t('state.loading')} />
      ) : state === 'error' ? (
        <Alert tone="danger">{t('error.generic')}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={t('mm.noReservations')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('mm.col.code')}</th>
                  <th scope="col">{t('mm.col.customer')}</th>
                  <th scope="col">{t('mm.col.branch')}</th>
                  <th scope="col" className="dd-num">
                    {t('mm.col.qty')}
                  </th>
                  <th scope="col">{t('mm.col.status')}</th>
                  <th scope="col">{t('mm.col.time')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="res-row">
                    <td className="dd-ltr">…{r.codeLast4}</td>
                    <td>{r.customerFirstName ?? '–'}</td>
                    <td>{bn(r.branch, locale)}</td>
                    <td className="dd-num">{r.quantity}</td>
                    <td>
                      <span
                        className={`dd-chip dd-chip--${r.status === 'HELD' ? 'success' : r.status === 'REDEEMED' ? 'info' : r.status === 'EXPIRED' ? 'warning' : 'neutral'}`}
                      >
                        {t(`resstatus.${r.status}` as DictionaryKey)}
                      </span>
                    </td>
                    <td className="dd-caption">
                      {when(
                        locale,
                        r.redeemedAt ?? (r.status === 'HELD' ? r.expiresAt : r.createdAt),
                      )}
                    </td>
                    <td>
                      {r.canCancel ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setCancelId(r.id)}
                          data-testid="res-cancel"
                        >
                          {t('mm.cancelRes')}
                        </Button>
                      ) : r.canReverse && orgId ? (
                        <Link className="dd-link" href={withLocale('/redemptions', locale)}>
                          {t('mm.redemptionsTitle')}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ConfirmReason
        open={!!cancelId}
        title={t('mm.cancelRes')}
        body={t('mm.cancelResBody')}
        confirmLabel={t('mm.cancelRes')}
        danger
        onClose={() => setCancelId(null)}
        onConfirm={async (reason) => {
          if (!canManage || !orgId) return t('error.FORBIDDEN');
          const r = await call('POST', `/v1/merchants/${orgId}/reservations/${cancelId}/cancel`, {
            body: { reason },
          });
          if (r.ok) {
            setCancelId(null);
            void load();
            onChanged();
            return null;
          }
          return errorMessage(locale, r.errors);
        }}
      />
    </div>
  );
}

function ActivityTab({ base }: { base: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [items, setItems] = useState<Activity[] | null>(null);
  useEffect(() => {
    void call<Activity[]>('GET', `${base}/activity`).then((r) =>
      setItems(r.ok ? (r.data ?? []) : []),
    );
  }, [call, base]);
  if (!items) return <LoadingState label={t('state.loading')} />;
  if (!items.length) return <EmptyState title={t('mm.noActivity')} />;
  return (
    <Card>
      <ul
        className="dd-timeline"
        data-testid="hot-activity"
        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}
      >
        {items.map((a) => (
          <li key={a.id} className="dd-row" style={{ alignItems: 'flex-start' }}>
            <span className="dd-caption dd-ltr" style={{ minInlineSize: 150 }}>
              {formatDateTime(locale, a.at)}
            </span>
            <div>
              <strong>
                {t(
                  (a.source === 'deal'
                    ? `hotaction.${a.code}`
                    : `resevent.${a.code}`) as DictionaryKey,
                )}
              </strong>
              {a.ref ? <span className="dd-caption dd-ltr"> …{a.ref}</span> : null}
              {a.actor ? <span className="dd-caption"> · {a.actor}</span> : null}
              {a.note ? <div className="dd-caption">{a.note}</div> : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
