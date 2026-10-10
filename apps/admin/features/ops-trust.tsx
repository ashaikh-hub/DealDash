'use client';

import { useState } from 'react';
import { RequirePermission, useResource } from '@dealdash/app-shell';
import { formatDateTime } from '@dealdash/localization';
import { MODERATION_DECISIONS, MODERATION_STATUSES, MODERATION_SUBJECTS, OPS_RESTRICTION_STATUSES, RESTRICTION_KINDS, RISK_DOMAINS } from '@dealdash/types';
import { Alert, Button, Card, Field, Input, Select, StatusChip } from '@dealdash/ui';
import { DecisionBar, OPS_TONE, OpsHeader, OpsStates, ReasonCodePicker, ReasonField, reasonOk, useOpsCommand, usePerms, useT } from './ops-kit';

// ====================================================================================== fraud / risk operations
interface Flag {
  id: string;
  domain: string;
  ruleCode: string | null;
  decision: string;
  severity: string;
  status: string;
  signals: Record<string, unknown> | null;
  subjectUserId: string | null;
  subjectOrganizationId: string | null;
  branchId: string | null;
  market: string | null;
  caseId: string | null;
  outcome: string | null;
  reviewReason: string | null;
  createdAt: string;
}

/**
 * Admin -> Fraud review: operational risk flags raised by configured rules (ALLOW / FLAG / BLOCK). A flag never punishes anyone by
 * itself: a person clears or confirms it with a reason, and any restriction goes through the restrictions workflow (and its approval).
 * Watch & Earn flags keep their own Stage 6 review screen.
 */
export function AdminFraudPage() {
  return (
    <RequirePermission any={['admin.risk.manage']}>
      <Fraud />
    </RequirePermission>
  );
}

function Fraud() {
  const { t, locale, code } = useT();
  const perms = usePerms();
  const canRestrict = perms.includes('admin.restrictions.manage');
  const [status, setStatus] = useState('OPEN');
  const [domain, setDomain] = useState('');
  const list = useResource<Flag[]>('/v1/admin/ops/risk/flags', { status: status || undefined, domain: domain || undefined });
  const cmd = useOpsCommand();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [restrict, setRestrict] = useState({ on: false, kind: 'CUSTOMER_RESTRICTION', days: '7', reasonCode: '' });
  const decide = (f: Flag, outcome: 'CLEAR' | 'CONFIRM') =>
    void cmd.run(
      `/v1/admin/ops/risk/flags/${f.id}/decide`,
      { outcome, reason, restriction: outcome === 'CONFIRM' && restrict.on ? { kind: restrict.kind, days: Number(restrict.days) || undefined, reasonCode: restrict.reasonCode } : null },
      outcome === 'CLEAR' ? t('s8.risk.cleared') : t('s8.risk.confirmed'),
      async () => {
        setOpen(null);
        setReason('');
        await list.reload();
      },
    );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-fraud">
      <OpsHeader
        title={t('s8.risk.title')}
        intro={t('s8.risk.intro')}
        actions={
          <Button variant="outline" disabled={cmd.busy} onClick={() => void cmd.run('/v1/admin/ops/risk/scan', {}, t('s8.risk.scanned'), () => list.reload())} data-testid="risk-scan">
            {t('s8.risk.scan')}
          </Button>
        }
      />
      {cmd.banner}
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        <Select aria-label={t('s8.status')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">{t('s8.all')}</option>
          {['OPEN', 'IN_REVIEW', 'DECIDED'].map((x) => (
            <option key={x} value={x}>
              {code('s8.flagStatus', x)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('s8.risk.domain')} value={domain} onChange={(e) => setDomain(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">{t('s8.risk.allDomains')}</option>
          {RISK_DOMAINS.filter((d) => d !== 'WATCH').map((x) => (
            <option key={x} value={x}>
              {code('s8.domain', x)}
            </option>
          ))}
        </Select>
      </div>
      <OpsStates res={list} empty={(d) => d.length === 0} emptyTitle={t('s8.risk.empty')}>
        {(rows) => (
          <div className="dd-stack" style={{ gap: 10 }}>
            {rows.map((f) => (
              <Card flat key={f.id}>
                <div className="dd-stack" style={{ gap: 6 }} data-testid={`flag-${f.ruleCode ?? f.id}`}>
                  <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <strong>
                      {code('s8.rule', f.ruleCode)} · {code('s8.domain', f.domain)}
                    </strong>
                    <div className="dd-row">
                      <StatusChip tone={f.decision === 'BLOCK' ? 'danger' : 'warning'}>{code('s8.riskDecision', f.decision)}</StatusChip>
                      <StatusChip tone={OPS_TONE[f.status] ?? 'neutral'}>{code('s8.flagStatus', f.status)}</StatusChip>
                    </div>
                  </div>
                  <div className="dd-caption">
                    {formatDateTime(locale, f.createdAt)}
                    {f.market ? <> · <span className="dd-ltr">{f.market}</span></> : null}
                    {f.outcome ? <> · {code('s8.riskOutcome', f.outcome)}</> : null}
                  </div>
                  {f.signals ? (
                    <div className="dd-caption dd-ltr" style={{ wordBreak: 'break-word' }}>
                      {Object.entries(f.signals)
                        .map(([k2, v]) => `${k2}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                        .join(' · ')}
                    </div>
                  ) : null}
                  {f.reviewReason ? <div>{f.reviewReason}</div> : null}
                  {f.status !== 'DECIDED' ? (
                    <div className="dd-row" style={{ flexWrap: 'wrap' }}>
                      <Button size="sm" variant="outline" onClick={() => setOpen(open === f.id ? null : f.id)} data-testid={`flag-review-${f.ruleCode ?? f.id}`}>
                        {t('s8.risk.review')}
                      </Button>
                      {!f.caseId ? (
                        <Button size="sm" variant="ghost" disabled={cmd.busy} onClick={() => void cmd.run(`/v1/admin/ops/risk/flags/${f.id}/case`, {}, t('s8.caseOpened'), () => list.reload())}>
                          {t('s8.openCase')}
                        </Button>
                      ) : (
                        <span className="dd-caption">{t('s8.caseLinked')}</span>
                      )}
                    </div>
                  ) : null}
                  {open === f.id ? (
                    <div className="dd-stack" style={{ gap: 8 }} data-testid="flag-decide">
                      <Alert tone="info">{t('s8.risk.humanNote')}</Alert>
                      <ReasonField id="flag-reason" value={reason} onChange={setReason} />
                      {canRestrict ? (
                        <label className="dd-row" style={{ gap: 6 }}>
                          <input type="checkbox" checked={restrict.on} onChange={(e) => setRestrict({ ...restrict, on: e.target.checked })} /> {t('s8.risk.alsoRestrict')}
                        </label>
                      ) : null}
                      {restrict.on ? (
                        <div className="dd-row" style={{ flexWrap: 'wrap' }}>
                          <Field label={t('s8.rst.kind')} htmlFor="flag-rkind">
                            <Select id="flag-rkind" value={restrict.kind} onChange={(e) => setRestrict({ ...restrict, kind: e.target.value })}>
                              {RESTRICTION_KINDS.map((x) => (
                                <option key={x} value={x}>
                                  {code('s8.rstKind', x)}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label={t('s8.rst.days')} htmlFor="flag-rdays">
                            <Input id="flag-rdays" className="dd-ltr" inputMode="numeric" value={restrict.days} onChange={(e) => setRestrict({ ...restrict, days: e.target.value })} />
                          </Field>
                          <ReasonCodePicker id="flag-rcode" kind="hold" value={restrict.reasonCode} onChange={(v) => setRestrict({ ...restrict, reasonCode: v })} />
                        </div>
                      ) : null}
                      <div className="dd-row">
                        <Button size="sm" variant="outline" disabled={!reasonOk(reason) || cmd.busy} onClick={() => decide(f, 'CLEAR')} data-testid="flag-clear">
                          {t('s8.risk.clear')}
                        </Button>
                        <Button size="sm" disabled={!reasonOk(reason) || cmd.busy || (restrict.on && !restrict.reasonCode)} onClick={() => decide(f, 'CONFIRM')} data-testid="flag-confirm">
                          {t('s8.risk.confirm')}
                        </Button>
                      </div>
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

// ====================================================================================== restrictions and holds
interface Restriction {
  id: string;
  reference: string;
  kind: string;
  status: string;
  subjectType: string;
  subjectId: string;
  market: string | null;
  scope: string[];
  reasonCode: string;
  reason: string;
  startsAt: string;
  endsAt: string;
  requiresApproval: boolean;
  decisionReason: string | null;
  liftReason: string | null;
  canDecide: boolean;
}

/**
 * Admin -> Restrictions and holds: customer restrictions, merchant campaign holds, branch redemption holds, user and integration
 * suspensions and financial holds. They stop NEW actions only: vouchers, reservations and points already issued stay valid.
 */
export function AdminRestrictionsPage() {
  return (
    <RequirePermission any={['admin.restrictions.manage', 'admin.restrictions.approve']}>
      <Restrictions />
    </RequirePermission>
  );
}

const SCOPES: Record<string, string[]> = {
  CUSTOMER_RESTRICTION: ['NEW_RESERVATIONS', 'NEW_PURCHASES', 'NEW_VIEWS'],
};

function Restrictions() {
  const { t, locale, code } = useT();
  const perms = usePerms();
  const canManage = perms.includes('admin.restrictions.manage');
  const [status, setStatus] = useState('');
  const list = useResource<Restriction[]>('/v1/admin/ops/restrictions', { status: status || undefined });
  const cmd = useOpsCommand();
  const [f, setF] = useState({ kind: 'CUSTOMER_RESTRICTION', subjectId: '', scope: ['NEW_RESERVATIONS'] as string[], days: '7', reasonCode: '', reason: '' });
  const [liftFor, setLiftFor] = useState<string | null>(null);
  const [liftReason, setLiftReason] = useState('');
  const scopes = SCOPES[f.kind];
  const valid = f.subjectId.trim().length > 0 && !!f.reasonCode && reasonOk(f.reason) && Number(f.days) >= 1;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-restrictions">
      <OpsHeader title={t('s8.rst.title')} intro={t('s8.rst.intro')} />
      <Alert tone="info">{t('s8.rst.rightsNote')}</Alert>
      {cmd.banner}
      {canManage ? (
        <Card>
          <div className="dd-stack" style={{ gap: 10 }} data-testid="rst-form">
            <h2 className="dd-title">{t('s8.rst.new')}</h2>
            <div className="dd-row" style={{ flexWrap: 'wrap' }}>
              <Field label={t('s8.rst.kind')} htmlFor="rst-kind">
                <Select id="rst-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, scope: SCOPES[e.target.value]?.slice(0, 1) ?? [] })}>
                  {RESTRICTION_KINDS.map((x) => (
                    <option key={x} value={x}>
                      {code('s8.rstKind', x)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('s8.rst.subject')} htmlFor="rst-subject" help={code('s8.rstSubjectHelp', f.kind)}>
                <Input id="rst-subject" className="dd-ltr" value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })} />
              </Field>
              <Field label={t('s8.rst.days')} htmlFor="rst-days">
                <Input id="rst-days" className="dd-ltr" inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} />
              </Field>
              <ReasonCodePicker id="rst-code" kind="hold" value={f.reasonCode} onChange={(v) => setF({ ...f, reasonCode: v })} />
            </div>
            {scopes ? (
              <fieldset className="dd-row" style={{ flexWrap: 'wrap', border: 0, padding: 0, margin: 0 }}>
                <legend className="dd-caption">{t('s8.rst.scope')}</legend>
                {scopes.map((s) => (
                  <label key={s} className="dd-row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={f.scope.includes(s)}
                      onChange={(e) => setF({ ...f, scope: e.target.checked ? [...f.scope, s] : f.scope.filter((x) => x !== s) })}
                    />{' '}
                    {code('s8.rstScope', s)}
                  </label>
                ))}
              </fieldset>
            ) : null}
            <ReasonField id="rst-reason" value={f.reason} onChange={(v) => setF({ ...f, reason: v })} />
            <div>
              <Button
                disabled={!valid || cmd.busy}
                onClick={() =>
                  void cmd.run(
                    '/v1/admin/ops/restrictions',
                    { kind: f.kind, subjectId: f.subjectId.trim(), scope: scopes ? f.scope : undefined, days: Number(f.days), reasonCode: f.reasonCode, reason: f.reason.trim() },
                    t('s8.rst.requested'),
                    async () => {
                      setF({ ...f, subjectId: '', reason: '' });
                      await list.reload();
                    },
                  )
                }
                data-testid="rst-submit"
              >
                {t('s8.rst.submit')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
      <Select aria-label={t('s8.status')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 240 }}>
        <option value="">{t('s8.all')}</option>
        {OPS_RESTRICTION_STATUSES.map((x) => (
          <option key={x} value={x}>
            {code('s8.rstStatus', x)}
          </option>
        ))}
      </Select>
      <OpsStates res={list} empty={(d) => d.length === 0} emptyTitle={t('s8.rst.empty')}>
        {(rows) => (
          <div className="dd-stack" style={{ gap: 10 }}>
            {rows.map((r) => (
              <Card flat key={r.id}>
                <div className="dd-stack" style={{ gap: 6 }} data-testid={`rst-${r.reference}`}>
                  <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <strong>
                      <span className="dd-ltr">{r.reference}</span> · {code('s8.rstKind', r.kind)}
                    </strong>
                    <StatusChip tone={OPS_TONE[r.status] ?? 'neutral'}>{code('s8.rstStatus', r.status)}</StatusChip>
                  </div>
                  <div className="dd-caption">
                    {code('s8.rstSubjectType', r.subjectType)}: <span className="dd-ltr">{r.subjectId}</span> · {r.scope.map((s) => code('s8.rstScope', s)).join(', ')}
                  </div>
                  <div className="dd-caption">
                    {formatDateTime(locale, r.startsAt)} – {formatDateTime(locale, r.endsAt)} · <span className="dd-ltr">{r.reasonCode}</span>
                  </div>
                  <div>{r.reason}</div>
                  {r.kind === 'FINANCIAL_HOLD' && r.status === 'ACTIVE' ? (
                    <div data-testid="rst-financial-hold">
                      <Alert tone="warning">{t('s8.rst.financialHoldNote')}</Alert>
                    </div>
                  ) : null}
                  {r.status === 'PENDING_APPROVAL' ? (
                    <DecisionBar id={r.reference} canDecide={r.canDecide} busy={cmd.busy} onDecide={(approve, reason) => void cmd.run(`/v1/admin/ops/restrictions/${r.id}/decide`, { decision: approve ? 'APPROVE' : 'REJECT', reason }, approve ? t('s8.rst.approved') : t('s8.rst.rejected'), () => list.reload())} />
                  ) : null}
                  {r.status === 'ACTIVE' && canManage ? (
                    liftFor === r.id ? (
                      <div className="dd-stack" style={{ gap: 6 }}>
                        <ReasonField id="rst-lift" value={liftReason} onChange={setLiftReason} />
                        <div>
                          <Button size="sm" disabled={!reasonOk(liftReason) || cmd.busy} onClick={() => void cmd.run(`/v1/admin/ops/restrictions/${r.id}/lift`, { reason: liftReason }, t('s8.rst.lifted'), async () => { setLiftFor(null); setLiftReason(''); await list.reload(); })} data-testid="rst-lift-btn">
                            {t('s8.rst.lift')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <Button size="sm" variant="outline" onClick={() => setLiftFor(r.id)} data-testid={`rst-lift-${r.reference}`}>
                          {t('s8.rst.lift')}
                        </Button>
                      </div>
                    )
                  ) : null}
                  {r.liftReason ? <div className="dd-caption">{r.liftReason}</div> : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </OpsStates>
    </div>
  );
}

// ====================================================================================== moderation
interface ModerationRow {
  id: string;
  subjectType: string;
  subjectId: string;
  product: string | null;
  status: string;
  source: string;
  reasons: string[];
  reportCount: number;
  decisionReason: string | null;
  createdAt: string;
  review: { rating: number; text: string; verified: boolean; status: string } | null;
}

/** Admin -> Moderation: reviews and reported campaign, merchant profile and media content; every decision has a reason. */
export function AdminModerationPage() {
  return (
    <RequirePermission any={['admin.content.manage']}>
      <Moderation />
    </RequirePermission>
  );
}

function Moderation() {
  const { t, locale, code } = useT();
  const [status, setStatus] = useState('');
  const [subject, setSubject] = useState('');
  const list = useResource<ModerationRow[]>('/v1/admin/ops/moderation', { status: status || undefined, subjectType: subject || undefined });
  const cmd = useOpsCommand();
  const [open, setOpen] = useState<string | null>(null);
  const [d, setD] = useState({ decision: 'APPROVE', reasonCode: '', reason: '' });
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-moderation">
      <OpsHeader title={t('s8.mod.title')} intro={t('s8.mod.intro')} />
      {cmd.banner}
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        <Select aria-label={t('s8.status')} value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">{t('s8.mod.waiting')}</option>
          {MODERATION_STATUSES.map((x) => (
            <option key={x} value={x}>
              {code('s8.modStatus', x)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('s8.mod.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">{t('s8.all')}</option>
          {MODERATION_SUBJECTS.map((x) => (
            <option key={x} value={x}>
              {code('s8.modSubject', x)}
            </option>
          ))}
        </Select>
      </div>
      <OpsStates res={list} empty={(rows) => rows.length === 0} emptyTitle={t('s8.mod.empty')}>
        {(rows) => (
          <div className="dd-stack" style={{ gap: 10 }}>
            {rows.map((m) => (
              <Card flat key={m.id}>
                <div className="dd-stack" style={{ gap: 6 }} data-testid={`mod-${m.subjectType}-${m.subjectId}`}>
                  <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <strong>
                      {code('s8.modSubject', m.subjectType)}
                      {m.product ? <> · {code('s8.product', m.product)}</> : null}
                    </strong>
                    <StatusChip tone={OPS_TONE[m.status] ?? 'neutral'}>{code('s8.modStatus', m.status)}</StatusChip>
                  </div>
                  <div className="dd-caption">
                    {formatDateTime(locale, m.createdAt)} · {t('s8.mod.reports')}: {m.reportCount}
                    {m.reasons.length ? <> · {m.reasons.map((r) => code('s8.report', r)).join(', ')}</> : null}
                  </div>
                  {m.review ? (
                    <div className="dd-stack" style={{ gap: 2 }}>
                      <div>
                        <span aria-label={t('s8.rev.rating')}>{'★'.repeat(m.review.rating)}</span>{' '}
                        {m.review.verified ? <StatusChip tone="success">{t('s8.rev.verified')}</StatusChip> : null}
                      </div>
                      <div>{m.review.text}</div>
                    </div>
                  ) : null}
                  {m.decisionReason ? <div className="dd-caption">{m.decisionReason}</div> : null}
                  {open === m.id ? (
                    <div className="dd-stack" style={{ gap: 8 }} data-testid="mod-decide">
                      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
                        <Field label={t('s8.mod.decision')} htmlFor="mod-dec">
                          <Select id="mod-dec" value={d.decision} onChange={(e) => setD({ ...d, decision: e.target.value })}>
                            {MODERATION_DECISIONS.map((x) => (
                              <option key={x} value={x}>
                                {code('s8.modDecision', x)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <ReasonCodePicker id="mod-code" kind="moderation" value={d.reasonCode} onChange={(v) => setD({ ...d, reasonCode: v })} />
                      </div>
                      <ReasonField id="mod-reason" value={d.reason} onChange={(v) => setD({ ...d, reason: v })} />
                      <div>
                        <Button
                          size="sm"
                          disabled={!d.reasonCode || !reasonOk(d.reason) || cmd.busy}
                          onClick={() => void cmd.run(`/v1/admin/ops/moderation/${m.id}/decide`, d, t('s8.mod.decided'), async () => { setOpen(null); setD({ decision: 'APPROVE', reasonCode: '', reason: '' }); await list.reload(); })}
                          data-testid="mod-submit"
                        >
                          {t('s8.mod.submit')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Button size="sm" variant="outline" onClick={() => setOpen(m.id)} data-testid={`mod-open-${m.subjectId}`}>
                        {t('s8.mod.decide')}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </OpsStates>
    </div>
  );
}
