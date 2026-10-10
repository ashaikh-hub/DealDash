'use client';

import { useState } from 'react';
import { RequirePermission, useResource } from '@dealdash/app-shell';
import { formatDate, formatDateTime } from '@dealdash/localization';
import { ADJUSTMENT_DIRECTIONS, ADJUSTMENT_KINDS, ADJUSTMENT_STATUSES, RECON_SOURCES, RECON_STATUSES, SETTLEMENT_STATUSES } from '@dealdash/types';
import { Alert, Button, Card, Field, Input, KeyValue, Select, StatusChip, Textarea } from '@dealdash/ui';
import { DecisionBar, Money, OPS_TONE, OpsHeader, OpsStates, ReasonCodePicker, ReasonField, reasonOk, useOpsCommand, usePerms, useT } from './ops-kit';

const POINTS_KINDS = ['POINTS_ADJUSTMENT', 'REWARD_REVERSAL'];

// ====================================================================================== financial adjustments
interface Adjustment {
  id: string;
  reference: string;
  kind: string;
  status: string;
  direction: string;
  amountMinor: number | null;
  points: number | null;
  currency: string | null;
  market: string | null;
  organizationId: string | null;
  customerUserId: string | null;
  caseId: string | null;
  reasonCode: string;
  reason: string;
  requiresApproval: boolean;
  decisionReason: string | null;
  /** Where the correction was posted: a finance document, a journal, a payable adjustment or a reward adjustment. */
  appliedRef: { kind?: string; id?: string | null } | null;
  failureReason: string | null;
  createdAt: string;
  canDecide: boolean;
}

/** Admin -> Financial adjustments: append-only corrections (never an edit of the original), with maker-checker by configuration. */
export function AdminAdjustmentsPage() {
  return (
    <RequirePermission any={['admin.finance.read']}>
      <Adjustments />
    </RequirePermission>
  );
}

function Adjustments() {
  const { t, locale, code } = useT();
  const perms = usePerms();
  const canRequest = perms.includes('admin.finance.manage') || perms.includes('admin.settlements.manage') || perms.includes('admin.rewards.request') || perms.includes('admin.rewards.manage');
  const [status, setStatus] = useState('PENDING_APPROVAL');
  const list = useResource<Adjustment[]>('/v1/admin/ops/adjustments', { status: status || undefined });
  const cmd = useOpsCommand();
  const [f, setF] = useState({ kind: 'SETTLEMENT_ADJUSTMENT', direction: 'CREDIT', amount: '', points: '', organizationId: '', customerUserId: '', caseId: '', reasonCode: '', reason: '' });
  const points = POINTS_KINDS.includes(f.kind);
  const amountMinor = f.amount.trim() ? Math.round(Number(f.amount) * 100) : NaN;
  const valid = reasonOk(f.reason) && f.reasonCode.trim().length >= 2 && (points ? Number(f.points) > 0 && !!f.customerUserId.trim() : amountMinor > 0);
  const submit = () =>
    void cmd.run(
      '/v1/admin/ops/adjustments',
      {
        kind: f.kind,
        direction: f.direction,
        ...(points ? { points: Number(f.points) } : { amountMinor }),
        organizationId: f.organizationId.trim() || null,
        customerUserId: f.customerUserId.trim() || null,
        caseId: f.caseId.trim() || null,
        reasonCode: f.reasonCode.trim(),
        reason: f.reason.trim(),
      },
      t('s8.adj.requested'),
      async () => {
        setF({ ...f, amount: '', points: '', reason: '' });
        await list.reload();
      },
    );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-adjustments">
      <OpsHeader title={t('s8.adj.title')} intro={t('s8.adj.intro')} />
      {cmd.banner}
      {canRequest ? (
        <Card>
          <div className="dd-stack" style={{ gap: 10 }} data-testid="adj-form">
            <h2 className="dd-title">{t('s8.adj.new')}</h2>
            <div className="dd-row" style={{ flexWrap: 'wrap' }}>
              <Field label={t('s8.adj.kind')} htmlFor="adj-kind">
                <Select id="adj-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                  {ADJUSTMENT_KINDS.map((x) => (
                    <option key={x} value={x}>
                      {code('s8.adjKind', x)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('s8.adj.direction')} htmlFor="adj-dir">
                <Select id="adj-dir" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
                  {ADJUSTMENT_DIRECTIONS.map((x) => (
                    <option key={x} value={x}>
                      {code('s8.dir', x)}
                    </option>
                  ))}
                </Select>
              </Field>
              {points ? (
                <Field label={t('s8.adj.points')} htmlFor="adj-points">
                  <Input id="adj-points" className="dd-ltr" inputMode="numeric" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} />
                </Field>
              ) : (
                <Field label={t('s8.adj.amount')} htmlFor="adj-amount">
                  <Input id="adj-amount" className="dd-ltr" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
                </Field>
              )}
            </div>
            <div className="dd-row" style={{ flexWrap: 'wrap' }}>
              <Field label={t('s8.adj.business')} htmlFor="adj-org">
                <Input id="adj-org" className="dd-ltr" value={f.organizationId} onChange={(e) => setF({ ...f, organizationId: e.target.value })} />
              </Field>
              <Field label={t('s8.adj.customer')} htmlFor="adj-cust">
                <Input id="adj-cust" className="dd-ltr" value={f.customerUserId} onChange={(e) => setF({ ...f, customerUserId: e.target.value })} />
              </Field>
              <Field label={t('s8.adj.case')} htmlFor="adj-case">
                <Input id="adj-case" className="dd-ltr" value={f.caseId} onChange={(e) => setF({ ...f, caseId: e.target.value })} />
              </Field>
              <ReasonCodePicker id="adj-rc" kind="adjustment" value={f.reasonCode} onChange={(v) => setF({ ...f, reasonCode: v })} />
            </div>
            <ReasonField id="adj-reason" value={f.reason} onChange={(v) => setF({ ...f, reason: v })} />
            <p className="dd-caption">{t('s8.adj.note')}</p>
            <div>
              <Button disabled={!valid || cmd.busy} loading={cmd.busy} onClick={submit} data-testid="adj-submit">
                {t('s8.adj.submit')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
      <Select aria-label={t('s8.status')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 260 }} data-testid="adj-filter">
        <option value="">{t('s8.all')}</option>
        {ADJUSTMENT_STATUSES.map((x) => (
          <option key={x} value={x}>
            {code('s8.adjStatus', x)}
          </option>
        ))}
      </Select>
      <OpsStates res={list} empty={(d) => d.length === 0} emptyTitle={t('s8.adj.empty')}>
        {(rows) => (
          <div className="dd-stack" style={{ gap: 10 }}>
            {rows.map((a) => (
              <Card flat key={a.id}>
                <div className="dd-stack" style={{ gap: 6 }} data-testid={`adj-${a.reference}`}>
                  <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <strong>
                      <span className="dd-ltr">{a.reference}</span> · {code('s8.adjKind', a.kind)}
                    </strong>
                    <StatusChip tone={OPS_TONE[a.status] ?? 'neutral'}>{code('s8.adjStatus', a.status)}</StatusChip>
                  </div>
                  <div className="dd-caption">
                    {code('s8.dir', a.direction)} · {a.points ? <span className="dd-ltr">{a.points} pts</span> : <Money minor={a.amountMinor} currency={a.currency} />} · <span className="dd-ltr">{a.reasonCode}</span> · {formatDateTime(locale, a.createdAt)}
                  </div>
                  <div>{a.reason}</div>
                  {a.failureReason ? <Alert tone="danger">{a.failureReason}</Alert> : null}
                  {a.appliedRef ? (
                    <div className="dd-caption">
                      {t('s8.adj.appliedAs')} <span className="dd-ltr">{[a.appliedRef.kind, a.appliedRef.id].filter(Boolean).join(' ')}</span>
                    </div>
                  ) : null}
                  {a.status === 'PENDING_APPROVAL' ? (
                    <DecisionBar id={a.reference} canDecide={a.canDecide} busy={cmd.busy} onDecide={(approve, reason) => void cmd.run(`/v1/admin/ops/adjustments/${a.id}/decide`, { decision: approve ? 'APPROVE' : 'REJECT', reason }, approve ? t('s8.adj.approved') : t('s8.adj.rejected'), () => list.reload())} />
                  ) : null}
                  {a.status === 'FAILED' && canRequest ? (
                    <div>
                      <Button size="sm" variant="outline" disabled={cmd.busy} onClick={() => void cmd.run(`/v1/admin/ops/adjustments/${a.id}/retry`, {}, t('s8.adj.retried'), () => list.reload())}>
                        {t('s8.retry')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </OpsStates>
    </div>
  );
}

// ====================================================================================== settlements
interface Settlement {
  id: string;
  reference: string;
  organizationId: string;
  merchantNameEn: string | null;
  merchantNameAr: string | null;
  market: string;
  currency: string;
  status: string;
  periodFrom: string;
  periodTo: string;
  grossMinor: number;
  feesMinor: number;
  taxMinor: number;
  adjustmentsMinor: number;
  carriedForwardMinor: number;
  payableMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  settlementDate: string | null;
  reconciliationStatus: string;
  holdReason: string | null;
  failureReason: string | null;
  items: Record<string, number>;
  payouts: Array<{ id: string; status: string; amountMinor: number; externalRef: string | null; reason: string | null; createdAt: string }>;
}

/** Admin -> Settlements: statements per merchant from the APPROVED market settlement rule; holds, payouts and reversals. */
export function AdminSettlementsPage() {
  return (
    <RequirePermission any={['admin.finance.read']}>
      <Settlements />
    </RequirePermission>
  );
}

function Settlements() {
  const { t, locale, code } = useT();
  const perms = usePerms();
  const canManage = perms.includes('admin.settlements.manage');
  const [status, setStatus] = useState('');
  const [exceptions, setExceptions] = useState(false);
  const list = useResource<Settlement[]>('/v1/admin/ops/settlements', { status: status || undefined, exceptions: exceptions ? 'true' : undefined });
  const cmd = useOpsCommand();
  const [run, setRun] = useState({ market: 'SA', organizationId: '' });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-settlements">
      <OpsHeader title={t('s8.set.title')} intro={t('s8.set.intro')} />
      {cmd.banner}
      {canManage ? (
        <Card flat>
          <div className="dd-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} data-testid="set-run">
            <Field label={t('s8.market')} htmlFor="set-market">
              <Input id="set-market" className="dd-ltr" maxLength={2} value={run.market} onChange={(e) => setRun({ ...run, market: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t('s8.set.merchantOptional')} htmlFor="set-org">
              <Input id="set-org" className="dd-ltr" value={run.organizationId} onChange={(e) => setRun({ ...run, organizationId: e.target.value })} />
            </Field>
            <Button
              disabled={run.market.length !== 2 || cmd.busy}
              loading={cmd.busy}
              onClick={() => void cmd.run('/v1/admin/ops/settlements/run', { market: run.market, organizationId: run.organizationId.trim() || null }, t('s8.set.ran'), () => list.reload())}
              data-testid="set-run-btn"
            >
              {t('s8.set.run')}
            </Button>
          </div>
          <p className="dd-caption" style={{ marginBottom: 0 }}>
            {t('s8.set.ruleNote')}
          </p>
        </Card>
      ) : null}
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        <Select aria-label={t('s8.status')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">{t('s8.all')}</option>
          {SETTLEMENT_STATUSES.map((x) => (
            <option key={x} value={x}>
              {code('s8.setStatus', x)}
            </option>
          ))}
        </Select>
        <label className="dd-row" style={{ gap: 6 }}>
          <input type="checkbox" checked={exceptions} onChange={(e) => setExceptions(e.target.checked)} data-testid="set-exceptions" /> {t('s8.set.exceptionsOnly')}
        </label>
      </div>
      <OpsStates res={list} empty={(d) => d.length === 0} emptyTitle={t('s8.set.empty')}>
        {(rows) => (
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('s8.reference')}</th>
                  <th>{t('s8.set.merchant')}</th>
                  <th>{t('s8.set.period')}</th>
                  <th>{t('s8.set.payable')}</th>
                  <th>{t('s8.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} data-testid={`set-${s.reference}`}>
                    <td className="dd-ltr">{s.reference}</td>
                    <td>{locale === 'ar' ? s.merchantNameAr ?? s.merchantNameEn : s.merchantNameEn}</td>
                    <td>
                      {formatDate(locale, s.periodFrom)} – {formatDate(locale, s.periodTo)}
                    </td>
                    <td>
                      <Money minor={s.payableMinor} currency={s.currency} />
                    </td>
                    <td>
                      <StatusChip tone={OPS_TONE[s.status] ?? 'neutral'}>{code('s8.setStatus', s.status)}</StatusChip>
                    </td>
                    <td>
                      <Button size="sm" variant="outline" onClick={() => setOpen(open === s.id ? null : s.id)} data-testid={`set-open-${s.reference}`}>
                        {t('s8.view')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </OpsStates>
      {open ? <SettlementDetail id={open} canManage={canManage} canApprove={perms.includes('admin.finance.approve')} onChanged={() => void list.reload()} /> : null}
    </div>
  );
}

function SettlementDetail({ id, canManage, canApprove, onChanged }: { id: string; canManage: boolean; canApprove: boolean; onChanged: () => void }) {
  const { t, locale, code } = useT();
  const res = useResource<Settlement>(`/v1/admin/ops/settlements/${id}`);
  const cmd = useOpsCommand();
  const [reason, setReason] = useState('');
  const [payout, setPayout] = useState({ amount: '', ref: '' });
  const after = async () => {
    setReason('');
    await res.reload();
    onChanged();
  };
  return (
    <OpsStates res={res}>
      {(s) => {
        const held = s.status === 'HELD' || s.status === 'DISPUTE_HOLD';
        const payable = s.status === 'ELIGIBLE' || s.status === 'PARTIALLY_PAID';
        return (
          <Card data-testid="set-detail">
            <div className="dd-stack" style={{ gap: 12 }}>
              <h2 className="dd-title">
                <span className="dd-ltr">{s.reference}</span> · <StatusChip tone={OPS_TONE[s.status] ?? 'neutral'}>{code('s8.setStatus', s.status)}</StatusChip>
              </h2>
              {held ? (
                <div data-testid="set-hold-state">
                  <Alert tone="warning">
                    {t('s8.set.heldNote')} {s.holdReason}
                  </Alert>
                </div>
              ) : null}
              {s.failureReason ? <Alert tone="danger">{s.failureReason}</Alert> : null}
              <KeyValue
                items={[
                  { label: t('s8.set.gross'), value: <Money minor={s.grossMinor} currency={s.currency} /> },
                  { label: t('s8.set.fees'), value: <Money minor={-s.feesMinor} currency={s.currency} /> },
                  { label: t('s8.set.tax'), value: <Money minor={s.taxMinor} currency={s.currency} /> },
                  { label: t('s8.set.adjustments'), value: <Money minor={s.adjustmentsMinor} currency={s.currency} /> },
                  { label: t('s8.set.carried'), value: <Money minor={s.carriedForwardMinor} currency={s.currency} /> },
                  { label: t('s8.set.payable'), value: <Money minor={s.payableMinor} currency={s.currency} /> },
                  { label: t('s8.set.paid'), value: <Money minor={s.paidMinor} currency={s.currency} /> },
                  { label: t('s8.set.outstanding'), value: <Money minor={s.outstandingMinor} currency={s.currency} /> },
                  { label: t('s8.set.recon'), value: code('s8.setRecon', s.reconciliationStatus) },
                  { label: t('s8.set.items'), value: Object.entries(s.items).map(([k2, v]) => `${code('s8.setItem', k2)}: ${v}`).join(' · ') || '-' },
                ]}
              />
              <p className="dd-caption">{t('s8.set.taxNote')}</p>
              {s.payouts.length ? (
                <div className="dd-stack" style={{ gap: 4 }}>
                  <h3 className="dd-title-sm">{t('s8.set.payouts')}</h3>
                  {s.payouts.map((p) => (
                    <div key={p.id} className="dd-caption">
                      {formatDateTime(locale, p.createdAt)} · {code('s8.payout', p.status)} · <Money minor={p.amountMinor} currency={s.currency} /> {p.externalRef ? <span className="dd-ltr">· {p.externalRef}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              {cmd.banner}
              {canManage ? (
                <div className="dd-stack" style={{ gap: 8 }}>
                  {payable ? (
                    <div className="dd-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <Field label={t('s8.set.payoutRef')} htmlFor="set-pref">
                        <Input id="set-pref" className="dd-ltr" value={payout.ref} onChange={(e) => setPayout({ ...payout, ref: e.target.value })} />
                      </Field>
                      <Field label={t('s8.set.partialAmount')} htmlFor="set-pamt" help={canApprove ? undefined : t('s8.set.partialNeedsApprover')}>
                        <Input id="set-pamt" className="dd-ltr" inputMode="decimal" value={payout.amount} onChange={(e) => setPayout({ ...payout, amount: e.target.value })} />
                      </Field>
                      <Button
                        disabled={payout.ref.trim().length < 3 || cmd.busy}
                        onClick={() => void cmd.run(`/v1/admin/ops/settlements/${s.id}/payout`, { externalRef: payout.ref.trim(), amountMinor: payout.amount.trim() ? Math.round(Number(payout.amount) * 100) : null }, t('s8.set.paidOk'), async () => { setPayout({ amount: '', ref: '' }); await after(); })}
                        data-testid="set-payout"
                      >
                        {t('s8.set.recordPayout')}
                      </Button>
                    </div>
                  ) : null}
                  <ReasonField id="set-reason" value={reason} onChange={setReason} />
                  <div className="dd-row" style={{ flexWrap: 'wrap' }}>
                    {!held && s.status !== 'COMPLETED' && s.status !== 'REVERSED' ? (
                      <Button variant="outline" disabled={!reasonOk(reason) || cmd.busy} onClick={() => void cmd.run(`/v1/admin/ops/settlements/${s.id}/hold`, { reason }, t('s8.set.heldOk'), after)} data-testid="set-hold">
                        {t('s8.set.hold')}
                      </Button>
                    ) : null}
                    {held ? (
                      <Button variant="outline" disabled={!reasonOk(reason) || cmd.busy} onClick={() => void cmd.run(`/v1/admin/ops/settlements/${s.id}/release`, { reason }, t('s8.set.releasedOk'), after)} data-testid="set-release">
                        {t('s8.set.release')}
                      </Button>
                    ) : null}
                    {payable ? (
                      <Button variant="outline" disabled={!reasonOk(reason) || cmd.busy} onClick={() => void cmd.run(`/v1/admin/ops/settlements/${s.id}/fail`, { reason }, t('s8.set.failedOk'), after)}>
                        {t('s8.set.fail')}
                      </Button>
                    ) : null}
                    {canApprove && (s.status === 'COMPLETED' || s.status === 'PARTIALLY_PAID' || s.status === 'FAILED') ? (
                      <Button variant="outline" disabled={!reasonOk(reason) || cmd.busy} onClick={() => void cmd.run(`/v1/admin/ops/settlements/${s.id}/reverse`, { reason }, t('s8.set.reversedOk'), after)} data-testid="set-reverse">
                        {t('s8.set.reverse')}
                      </Button>
                    ) : null}
                  </div>
                  <p className="dd-caption">{t('s8.set.releaseNote')}</p>
                </div>
              ) : null}
            </div>
          </Card>
        );
      }}
    </OpsStates>
  );
}

// ====================================================================================== reconciliation
interface ReconItem {
  id: string;
  reference: string;
  source: string;
  status: string;
  externalReference: string | null;
  externalAmountMinor: number | null;
  internalType: string | null;
  internalReference: string | null;
  internalAmountMinor: number | null;
  varianceMinor: number | null;
  currency: string | null;
  ownerUserId: string | null;
  resolution: string | null;
  caseId: string | null;
  createdAt: string;
}
interface ReconRun {
  id: string;
  reference: string;
  source: string;
  kind: string;
  fileName: string | null;
  totals: Record<string, number> | null;
  createdAt: string;
}

/** Admin -> Reconciliation: imported statements and internal consistency checks, classified MATCHED ... RESOLVED. */
export function AdminReconciliationPage() {
  return (
    <RequirePermission any={['admin.finance.read']}>
      <Reconciliation />
    </RequirePermission>
  );
}

const parseLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [reference, amount, occurredAt] = l.split(',').map((x) => x.trim());
      return { reference: reference ?? '', amountMinor: Math.round(Number(amount) * 100), occurredAt: new Date(occurredAt ?? '').toISOString() };
    });

function Reconciliation() {
  const { t, locale, code } = useT();
  const perms = usePerms();
  const canManage = perms.includes('admin.reconciliation.manage');
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const items = useResource<ReconItem[]>('/v1/admin/ops/reconciliation/items', { status: status || undefined, source: source || undefined, exceptions: status ? undefined : 'true' });
  const runs = useResource<ReconRun[]>('/v1/admin/ops/reconciliation/runs');
  const cmd = useOpsCommand();
  const [imp, setImp] = useState({ source: 'PAYMENT_GATEWAY', currency: 'SAR', lines: '' });
  const [resolveFor, setResolveFor] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  let parsed: ReturnType<typeof parseLines> = [];
  let parseError = false;
  try {
    parsed = parseLines(imp.lines);
    parseError = parsed.some((l) => !l.reference || !Number.isFinite(l.amountMinor));
  } catch {
    parseError = true;
  }
  const reload = async () => {
    await items.reload();
    await runs.reload();
  };
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-reconciliation">
      <OpsHeader
        title={t('s8.rec.title')}
        intro={t('s8.rec.intro')}
        actions={
          canManage ? (
            <Button variant="outline" disabled={cmd.busy} onClick={() => void cmd.run('/v1/admin/ops/reconciliation/consistency', {}, t('s8.rec.checked'), reload)} data-testid="rec-consistency">
              {t('s8.rec.runChecks')}
            </Button>
          ) : null
        }
      />
      {cmd.banner}
      {canManage ? (
        <Card flat>
          <div className="dd-stack" style={{ gap: 8 }} data-testid="rec-import">
            <h2 className="dd-title-sm">{t('s8.rec.import')}</h2>
            <div className="dd-row" style={{ flexWrap: 'wrap' }}>
              <Field label={t('s8.rec.source')} htmlFor="rec-src">
                <Select id="rec-src" value={imp.source} onChange={(e) => setImp({ ...imp, source: e.target.value })}>
                  {['PAYMENT_GATEWAY', 'REFUND', 'SETTLEMENT', 'RECEIPT'].map((x) => (
                    <option key={x} value={x}>
                      {code('s8.recSource', x)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('s8.currency')} htmlFor="rec-cur">
                <Input id="rec-cur" className="dd-ltr" maxLength={3} value={imp.currency} onChange={(e) => setImp({ ...imp, currency: e.target.value.toUpperCase() })} />
              </Field>
            </div>
            <Field label={t('s8.rec.lines')} htmlFor="rec-lines" help={t('s8.rec.linesHelp')}>
              <Textarea id="rec-lines" className="dd-ltr" rows={4} value={imp.lines} onChange={(e) => setImp({ ...imp, lines: e.target.value })} />
            </Field>
            {imp.lines.trim() && parseError ? <Alert tone="danger">{t('s8.rec.linesInvalid')}</Alert> : null}
            <div>
              <Button
                disabled={!parsed.length || parseError || cmd.busy}
                onClick={() => void cmd.run('/v1/admin/ops/reconciliation/statements', { source: imp.source, currency: imp.currency, lines: parsed }, t('s8.rec.imported'), async () => { setImp({ ...imp, lines: '' }); await reload(); })}
                data-testid="rec-import-btn"
              >
                {t('s8.rec.importBtn')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        <Select aria-label={t('s8.status')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 240 }} data-testid="rec-filter">
          <option value="">{t('s8.rec.allExceptions')}</option>
          {RECON_STATUSES.map((x) => (
            <option key={x} value={x}>
              {code('s8.recStatus', x)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('s8.rec.source')} value={source} onChange={(e) => setSource(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">{t('s8.all')}</option>
          {RECON_SOURCES.map((x) => (
            <option key={x} value={x}>
              {code('s8.recSource', x)}
            </option>
          ))}
        </Select>
      </div>
      <OpsStates res={items} empty={(d) => d.length === 0} emptyTitle={t('s8.rec.empty')}>
        {(rows) => (
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('s8.reference')}</th>
                  <th>{t('s8.rec.source')}</th>
                  <th>{t('s8.rec.external')}</th>
                  <th>{t('s8.rec.internal')}</th>
                  <th>{t('s8.rec.variance')}</th>
                  <th>{t('s8.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} data-testid={`rec-${i.reference}`}>
                    <td className="dd-ltr">{i.reference}</td>
                    <td>{code('s8.recSource', i.source)}</td>
                    <td>
                      <span className="dd-ltr">{i.externalReference ?? '-'}</span>
                      <div className="dd-caption">
                        <Money minor={i.externalAmountMinor} currency={i.currency} />
                      </div>
                    </td>
                    <td>
                      <span className="dd-ltr">{i.internalReference ?? '-'}</span>
                      <div className="dd-caption">
                        <Money minor={i.internalAmountMinor} currency={i.currency} />
                      </div>
                    </td>
                    <td>
                      <Money minor={i.varianceMinor} currency={i.currency} />
                    </td>
                    <td>
                      <StatusChip tone={OPS_TONE[i.status] ?? 'neutral'}>{code('s8.recStatus', i.status)}</StatusChip>
                      {i.resolution ? <div className="dd-caption">{i.resolution}</div> : null}
                    </td>
                    <td>
                      {canManage && i.status !== 'RESOLVED' && i.status !== 'MATCHED' ? (
                        <div className="dd-stack" style={{ gap: 4 }}>
                          <Button size="sm" variant="outline" onClick={() => setResolveFor(resolveFor === i.id ? null : i.id)} data-testid={`rec-resolve-open-${i.reference}`}>
                            {t('s8.rec.resolve')}
                          </Button>
                          {!i.caseId ? (
                            <Button size="sm" variant="ghost" disabled={cmd.busy} onClick={() => void cmd.run(`/v1/admin/ops/reconciliation/items/${i.id}/case`, {}, t('s8.caseOpened'), reload)}>
                              {t('s8.openCase')}
                            </Button>
                          ) : (
                            <span className="dd-caption">{t('s8.caseLinked')}</span>
                          )}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </OpsStates>
      {resolveFor ? (
        <Card flat>
          <div className="dd-stack" style={{ gap: 8 }} data-testid="rec-resolve">
            <ReasonField id="rec-resolution" label={t('s8.rec.resolution')} value={resolution} onChange={setResolution} />
            <p className="dd-caption">{t('s8.rec.resolveNote')}</p>
            <div>
              <Button
                disabled={!reasonOk(resolution) || cmd.busy}
                onClick={() => void cmd.run(`/v1/admin/ops/reconciliation/items/${resolveFor}/resolve`, { resolution }, t('s8.rec.resolved'), async () => { setResolveFor(null); setResolution(''); await reload(); })}
                data-testid="rec-resolve-btn"
              >
                {t('s8.rec.resolve')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
      <OpsStates res={runs} empty={(d) => d.length === 0} emptyTitle={t('s8.rec.noRuns')}>
        {(rows) => (
          <section className="dd-stack" style={{ gap: 4 }}>
            <h2 className="dd-title-sm">{t('s8.rec.runs')}</h2>
            {rows.slice(0, 10).map((r) => (
              <div key={r.id} className="dd-caption">
                <span className="dd-ltr">{r.reference}</span> · {code('s8.recSource', r.source)} · {formatDateTime(locale, r.createdAt)}
                {r.totals ? <> · {Object.entries(r.totals).map(([k2, v]) => `${code('s8.recStatus', k2)}: ${v}`).join(', ')}</> : null}
              </div>
            ))}
          </section>
        )}
      </OpsStates>
    </div>
  );
}
