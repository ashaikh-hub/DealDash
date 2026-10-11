'use client';

import { useCallback, useState, type ReactNode } from 'react';
import {
  createTranslator,
  dictionaries,
  formatDateTime,
  formatNumber,
  type DictionaryKey,
} from '@dealdash/localization';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  FileField,
  Input,
  LoadingState,
  Select,
  StatusChip,
  Tabs,
  Textarea,
} from '@dealdash/ui';
import type { StatusTone } from '@dealdash/ui';
import {
  CASE_SEVERITIES,
  CASE_STATUSES,
  CASE_TEAMS,
  CASE_TERMINAL_STATUSES,
  CASE_TYPES as STAGE8_CASE_TYPES,
  CONTACT_CHANNELS,
  LEGACY_CASE_TYPES,
  SLA_STATES,
} from '@dealdash/types';
import { useApi, useResource } from '../api';
import { useAuth } from '../auth-context';
import { errorMessage } from '../gates';

/** Where the data comes from: DealDash Admin (everything) or one business (its own records only). */
export type OpsScope = { audience: 'admin' } | { audience: 'org'; orgId: string };
const baseOf = (s: OpsScope) => (s.audience === 'admin' ? '/v1/admin' : `/v1/orgs/${s.orgId}`);
const k = (p: string, v: string) => `${p}.${v}` as DictionaryKey;
const has = (key: string): key is DictionaryKey => key in dictionaries.en;

const PRIORITY_TONE: Record<string, StatusTone> = {
  LOW: 'neutral',
  NORMAL: 'info',
  HIGH: 'warning',
  CRITICAL: 'danger',
};
const CASE_TONE: Record<string, StatusTone> = {
  OPEN: 'info',
  IN_REVIEW: 'warning',
  WAITING: 'warning',
  INVESTIGATING: 'warning',
  AWAITING_CUSTOMER: 'warning',
  AWAITING_MERCHANT: 'warning',
  AWAITING_PARTNER: 'warning',
  AWAITING_FINANCE: 'warning',
  AWAITING_APPROVAL: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
  REJECTED: 'danger',
};
const RULE_TONE: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  ACTIVE: 'success',
  PAUSED: 'neutral',
  ENDED: 'neutral',
  REJECTED: 'danger',
};

/** Runs a command and reports the translated result. */
function useCommand() {
  const { call } = useApi();
  const { locale } = useAuth();
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(
      method: 'POST' | 'PUT',
      path: string,
      body: unknown,
      ok: string | ((data: T | null) => string),
      after?: (data: T | null) => void | Promise<void>,
    ) => {
      setBusy(true);
      const r = await call<T>(method, path, { body, idempotent: true });
      setBusy(false);
      if (!r.ok) {
        setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
        return false;
      }
      setBanner({ tone: 'success', text: typeof ok === 'function' ? ok(r.data) : ok });
      await after?.(r.data);
      return true;
    },
    [call, locale],
  );
  const view = banner ? (
    <div data-testid="op-banner">
      <Alert tone={banner.tone}>{banner.text}</Alert>
    </div>
  ) : null;
  return { run, busy, banner: view, clear: () => setBanner(null) };
}

// ====================================================================================== workspace
export type OpsTab = 'inbox' | 'cases' | 'conflicts' | 'activity';

/** Inbox, cases, offer conflicts (DealDash) and activity in one place. */
export function OperationsWorkspace({
  scope,
  tabs,
  canManageCases,
  canManageConflicts,
  hrefFor,
}: {
  scope: OpsScope;
  tabs: readonly OpsTab[];
  canManageCases: boolean;
  canManageConflicts?: boolean;
  hrefFor?: (item: InboxItem) => string | null;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [tab, setTab] = useState<OpsTab>(tabs[0] ?? 'inbox');
  const [openCase, setOpenCase] = useState<string | null>(null);
  const items = tabs.map((id) => ({ id, label: t(k('op.tab', id)) }));
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="operations">
      <div>
        <h1 className="dd-title-xl">{t('op.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('op.sub')}
        </p>
      </div>
      <Tabs
        label={t('op.title')}
        value={tab}
        onChange={(id) => setTab(id as OpsTab)}
        tabs={items}
      />
      {tab === 'inbox' ? (
        <InboxPanel
          scope={scope}
          hrefFor={hrefFor}
          onOpenCase={(id) => {
            setOpenCase(id);
            setTab('cases');
          }}
        />
      ) : null}
      {tab === 'cases' ? (
        <CasesPanel scope={scope} canManage={canManageCases} openId={openCase} />
      ) : null}
      {tab === 'conflicts' ? <ConflictsPanel canManage={!!canManageConflicts} /> : null}
      {tab === 'activity' ? <ActivityPanel scope={scope} /> : null}
    </div>
  );
}

// ====================================================================================== inbox
export interface InboxItem {
  kind: string;
  title: string;
  subject: string | null;
  detail: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  organizationId: string | null;
  entityType: string;
  entityId: string;
  dueAt: string | null;
  createdAt: string;
  requiredPermission: string;
}

export function InboxPanel({
  scope,
  hrefFor,
  onOpenCase,
}: {
  scope: OpsScope;
  hrefFor?: (item: InboxItem) => string | null;
  onOpenCase?: (id: string) => void;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const res = useResource<InboxItem[]>(`${baseOf(scope)}/inbox`);
  const title = (i: InboxItem) => {
    if (i.kind === 'DISPUTE') return i.subject ?? i.title;
    const key = `op.task.${i.kind}`;
    return has(key) ? t(key, { name: i.subject ?? '' }) : (i.subject ?? i.title);
  };
  if (res.loading && !res.data) return <LoadingState label={t('state.loading')} />;
  const rows = res.data ?? [];
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="op-inbox">
      <div className="dd-row" style={{ justifyContent: 'space-between' }}>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('op.inbox.note')}
        </p>
        <Button variant="outline" size="sm" onClick={() => void res.reload()}>
          {t('op.refresh')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t('op.inbox.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('op.col.task')}</th>
                <th>{t('op.col.kind')}</th>
                <th>{t('op.col.priority')}</th>
                <th>{t('op.col.due')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => {
                const href = hrefFor?.(i) ?? null;
                const text = title(i);
                return (
                  <tr key={`${i.kind}-${i.entityId}`} data-testid={`op-task-${i.kind}`}>
                    <td>
                      {i.kind === 'DISPUTE' && onOpenCase ? (
                        <button
                          type="button"
                          className="dd-link"
                          onClick={() => onOpenCase(i.entityId)}
                        >
                          {text}
                        </button>
                      ) : href ? (
                        <a href={href}>{text}</a>
                      ) : (
                        text
                      )}
                      {i.detail === 'SLA_MISSED' ? (
                        <>
                          {' '}
                          <StatusChip tone="danger">{t('op.detail.SLA_MISSED')}</StatusChip>
                        </>
                      ) : null}
                    </td>
                    <td>{has(k('op.kind', i.kind)) ? t(k('op.kind', i.kind)) : i.kind}</td>
                    <td>
                      <StatusChip tone={PRIORITY_TONE[i.priority] ?? 'neutral'}>
                        {t(k('op.priority', i.priority))}
                      </StatusChip>
                    </td>
                    <td>{i.dueAt ? formatDateTime(locale, i.dueAt) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ====================================================================================== cases
// Stage 8: the shared exception types first, then the Phase 3 types that existing cases keep
const CASE_TYPES = [...STAGE8_CASE_TYPES, ...LEGACY_CASE_TYPES] as const;
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
const EVIDENCE_TYPES = ['DOCUMENT', 'SCREENSHOT', 'CONTRACT', 'RECEIPT', 'OTHER'] as const;
const TERMINAL: readonly string[] = CASE_TERMINAL_STATUSES;
/** Statuses a person moves a case to by hand (closing uses resolve; AWAITING_APPROVAL uses the approval request). */
const MOVABLE = CASE_STATUSES.filter(
  (s) =>
    !TERMINAL.includes(s) &&
    s !== 'AWAITING_APPROVAL' &&
    s !== 'IN_REVIEW' &&
    s !== 'WAITING' &&
    s !== 'OPEN',
);
const SEVERITY_TONE: Record<string, StatusTone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'danger',
};
const SLA_TONE: Record<string, StatusTone> = {
  ON_TRACK: 'success',
  WARNING: 'warning',
  BREACHED: 'danger',
  MET: 'neutral',
};

interface CaseNote {
  id: string;
  visibility: 'INTERNAL' | 'SHARED';
  body: string;
  kind?: string;
  channel?: string | null;
  direction?: string | null;
  fromBusiness: boolean;
  fromCustomer?: boolean;
  evidenceRef?: string | null;
  createdAt: string;
}
interface CaseAttachment {
  id: string;
  type: string;
  label: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  visibility: 'INTERNAL' | 'SHARED';
  fromBusiness: boolean;
  uploadedAt: string;
}
interface CaseView {
  id: string;
  reference: string;
  type: string;
  organizationId: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  slaDueAt: string;
  overdue: boolean;
  resolution: string | null;
  resolvedAt: string | null;
  financialAdjustmentId: string | null;
  notes: CaseNote[];
  attachments: CaseAttachment[];
  // ---- Stage 8 (business views receive nulls for internal routing and approval details)
  severity?: string;
  market?: string | null;
  assignedTeam?: string | null;
  queue?: string | null;
  transactionRef?: string | null;
  financialImpactMinor?: number | null;
  currency?: string | null;
  proposedResolution?: string | null;
  approvalState?: string | null;
  approvalRequestedByUserId?: string | null;
  slaState?: string;
  escalationLevel?: number;
  awaitingYou?: boolean;
}

export function CasesPanel({
  scope,
  canManage,
  openId,
}: {
  scope: OpsScope;
  canManage: boolean;
  openId?: string | null;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [status, setStatus] = useState('');
  const [team, setTeam] = useState('');
  const [severity, setSeverity] = useState('');
  const [sla, setSla] = useState('');
  const adminScope = scope.audience === 'admin';
  const list = useResource<CaseView[]>(
    `${baseOf(scope)}/disputes`,
    adminScope
      ? {
          status: status || undefined,
          team: team || undefined,
          severity: severity || undefined,
          slaState: sla || undefined,
        }
      : { status: status || undefined },
  );
  const cmd = useCommand();
  const [selected, setSelected] = useState<string | null>(openId ?? null);
  const [form, setForm] = useState({
    type: 'OTHER',
    title: '',
    description: '',
    priority: 'NORMAL',
    organizationId: '',
  });
  const [showNew, setShowNew] = useState(false);
  const create = async () => {
    const body = {
      type: form.type,
      title: form.title,
      description: form.description || null,
      priority: form.priority,
      ...(scope.audience === 'admin' && form.organizationId
        ? { targetOrganizationId: form.organizationId }
        : {}),
    };
    const ok = await cmd.run<CaseView>(
      'POST',
      `${baseOf(scope)}/disputes`,
      body,
      t('op.case.created'),
      async (d) => {
        await list.reload();
        if (d) setSelected(d.id);
      },
    );
    if (ok) {
      setForm({ ...form, title: '', description: '' });
      setShowNew(false);
    }
  };
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="op-cases">
      <div className="dd-row" style={{ justifyContent: 'space-between' }}>
        <h2 className="dd-title">{t('op.case.title')}</h2>
        <div className="dd-row">
          <Select
            aria-label={t('op.col.status')}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            data-testid="op-case-filter-status"
          >
            <option value="">{t('op.act.all')}</option>
            {CASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(k('op.dstatus', s))}
              </option>
            ))}
          </Select>
          {adminScope ? (
            <>
              <Select
                aria-label={t('op.case.team')}
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                data-testid="op-case-filter-team"
              >
                <option value="">{t('op.case.allTeams')}</option>
                {CASE_TEAMS.map((x) => (
                  <option key={x} value={x}>
                    {t(k('op.team', x))}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('op.case.severity')}
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                <option value="">{t('op.case.allSeverities')}</option>
                {CASE_SEVERITIES.map((x) => (
                  <option key={x} value={x}>
                    {t(k('op.sev', x))}
                  </option>
                ))}
              </Select>
              <Select
                aria-label={t('op.case.slaState')}
                value={sla}
                onChange={(e) => setSla(e.target.value)}
                data-testid="op-case-filter-sla"
              >
                <option value="">{t('op.case.allSla')}</option>
                {SLA_STATES.map((x) => (
                  <option key={x} value={x}>
                    {t(k('op.sla', x))}
                  </option>
                ))}
              </Select>
            </>
          ) : null}
          {canManage ? (
            <Button onClick={() => setShowNew((v) => !v)} data-testid="op-case-new">
              {t('op.case.new')}
            </Button>
          ) : null}
        </div>
      </div>
      {cmd.banner}
      {showNew ? (
        <Card flat>
          <div className="dd-stack" style={{ gap: 10 }} data-testid="op-case-form">
            <Field label={t('op.case.type')} htmlFor="op-case-type">
              <Select
                id="op-case-type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {CASE_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(k('op.dtype', x))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('op.case.subject')} htmlFor="op-case-subject">
              <Input
                id="op-case-subject"
                value={form.title}
                maxLength={160}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label={t('op.case.description')} htmlFor="op-case-desc">
              <Textarea
                id="op-case-desc"
                value={form.description}
                maxLength={2000}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </Field>
            <Field label={t('op.case.priority')} htmlFor="op-case-prio">
              <Select
                id="op-case-prio"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                {PRIORITIES.map((x) => (
                  <option key={x} value={x}>
                    {t(k('op.priority', x))}
                  </option>
                ))}
              </Select>
            </Field>
            {scope.audience === 'admin' ? (
              <Field label={t('op.case.business')} htmlFor="op-case-org">
                <Input
                  id="op-case-org"
                  className="dd-ltr"
                  value={form.organizationId}
                  onChange={(e) => setForm({ ...form, organizationId: e.target.value })}
                />
              </Field>
            ) : null}
            <div>
              <Button
                onClick={() => void create()}
                disabled={form.title.trim().length < 3 || cmd.busy}
                loading={cmd.busy}
                data-testid="op-case-submit"
              >
                {t('op.case.open')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
      {list.loading && !list.data ? (
        <LoadingState label={t('state.loading')} />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState title={t('op.case.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('op.case.reference')}</th>
                <th>{t('op.case.type')}</th>
                <th>{t('op.col.priority')}</th>
                <th>{t('op.col.status')}</th>
                <th>{t('op.case.sla')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((c) => (
                <tr key={c.id} data-testid={`op-case-${c.reference}`}>
                  <td className="dd-ltr">{c.reference}</td>
                  <td>
                    {t(k('op.dtype', c.type))}
                    <div className="dd-caption">{c.title}</div>
                  </td>
                  <td>
                    <StatusChip tone={PRIORITY_TONE[c.priority] ?? 'neutral'}>
                      {t(k('op.priority', c.priority))}
                    </StatusChip>
                    {c.severity ? (
                      <div style={{ marginTop: 4 }}>
                        <StatusChip tone={SEVERITY_TONE[c.severity] ?? 'neutral'}>
                          {t(k('op.sev', c.severity))}
                        </StatusChip>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <StatusChip tone={CASE_TONE[c.status] ?? 'neutral'}>
                      {t(k('op.dstatus', c.status))}
                    </StatusChip>
                    {c.awaitingYou && !adminScope ? (
                      <>
                        {' '}
                        <StatusChip tone="warning">{t('op.case.awaitingYou')}</StatusChip>
                      </>
                    ) : null}
                    {c.overdue ? (
                      <>
                        {' '}
                        <StatusChip tone="danger">{t('op.case.overdue')}</StatusChip>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {formatDateTime(locale, c.slaDueAt)}
                    {adminScope && c.slaState && !c.overdue ? (
                      <div style={{ marginTop: 4 }}>
                        <StatusChip tone={SLA_TONE[c.slaState] ?? 'neutral'}>
                          {t(k('op.sla', c.slaState))}
                        </StatusChip>
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelected(selected === c.id ? null : c.id)}
                      data-testid={`op-case-open-${c.reference}`}
                    >
                      {t('op.case.view')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected ? (
        <CaseDetail
          scope={scope}
          id={selected}
          canManage={canManage}
          onChanged={() => void list.reload()}
        />
      ) : null}
    </div>
  );
}

function CaseDetail({
  scope,
  id,
  canManage,
  onChanged,
}: {
  scope: OpsScope;
  id: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { locale, me } = useAuth();
  const { call } = useApi();
  const t = createTranslator(locale);
  const path = `${baseOf(scope)}/disputes/${id}`;
  const res = useResource<CaseView>(path);
  const cmd = useCommand();
  const [note, setNote] = useState('');
  const [vis, setVis] = useState<'INTERNAL' | 'SHARED'>('SHARED');
  const [resolution, setResolution] = useState('');
  const [outcome, setOutcome] = useState<'RESOLVED' | 'CLOSED' | 'REJECTED'>('RESOLVED');
  const [finance, setFinance] = useState('');
  const c = res.data;
  const after = async () => {
    await res.reload();
    onChanged();
  };
  if (!c) return <LoadingState label={t('state.loading')} />;
  const closed = TERMINAL.includes(c.status);
  const admin = scope.audience === 'admin';
  const awaitingApproval = c.status === 'AWAITING_APPROVAL';
  return (
    <Card data-testid="op-case-detail">
      <div className="dd-stack" style={{ gap: 14 }}>
        <div>
          <h3 className="dd-title">
            <span className="dd-ltr">{c.reference}</span> · {t(k('op.dtype', c.type))}
          </h3>
          <p style={{ margin: 0 }}>{c.title}</p>
          {c.description ? <p className="dd-muted">{c.description}</p> : null}
          <div className="dd-row" style={{ flexWrap: 'wrap' }}>
            <StatusChip tone={CASE_TONE[c.status] ?? 'neutral'}>
              {t(k('op.dstatus', c.status))}
            </StatusChip>
            {c.severity ? (
              <StatusChip tone={SEVERITY_TONE[c.severity] ?? 'neutral'}>
                {t(k('op.sev', c.severity))}
              </StatusChip>
            ) : null}
            {admin && c.slaState ? (
              <span data-testid="op-case-sla-state">
                <StatusChip tone={SLA_TONE[c.slaState] ?? 'neutral'}>
                  {t(k('op.sla', c.slaState))}
                </StatusChip>
              </span>
            ) : null}
            <span className="dd-caption">
              {t('op.case.sla')}: <span>{formatDateTime(locale, c.slaDueAt)}</span>
            </span>
          </div>
          {admin ? (
            <dl
              className="dd-caption dd-row"
              style={{ flexWrap: 'wrap', gap: 12, margin: '8px 0 0' }}
              data-testid="op-case-facts"
            >
              {c.assignedTeam ? (
                <span>
                  {t('op.case.team')}: {t(k('op.team', c.assignedTeam))}
                </span>
              ) : null}
              {c.market ? (
                <span>
                  {t('op.case.market')}: <span className="dd-ltr">{c.market}</span>
                </span>
              ) : null}
              {c.transactionRef ? (
                <span>
                  {t('op.case.transaction')}: <span className="dd-ltr">{c.transactionRef}</span>
                </span>
              ) : null}
              {c.financialImpactMinor ? (
                <span>
                  {t('op.case.impact')}:{' '}
                  <span className="dd-ltr">
                    {formatNumber(locale, c.financialImpactMinor / 100)} {c.currency ?? ''}
                  </span>
                </span>
              ) : null}
              {c.escalationLevel ? (
                <span>
                  {t('op.case.escalation')}: {c.escalationLevel}
                </span>
              ) : null}
            </dl>
          ) : null}
        </div>
        {cmd.banner}
        {c.awaitingYou && !admin ? (
          <Alert tone="warning">{t('op.case.awaitingYouNote')}</Alert>
        ) : null}
        {awaitingApproval && admin ? (
          <div data-testid="op-case-awaiting-approval">
            <Alert tone="warning">
              {t('op.case.awaitingApprovalNote')} {c.proposedResolution}
            </Alert>
          </div>
        ) : null}
        {admin && canManage && !closed ? (
          <CaseWorkActions
            path={path}
            c={c}
            meId={me?.id ?? null}
            run={cmd.run}
            busy={cmd.busy}
            after={after}
          />
        ) : null}

        <section aria-label={t('op.case.notes')} className="dd-stack" style={{ gap: 8 }}>
          <h4 className="dd-title-sm">{t('op.case.notes')}</h4>
          {c.notes.length === 0 ? <p className="dd-muted">{t('op.case.noNotes')}</p> : null}
          {c.notes.map((n) => (
            <div key={n.id} className="dd-note" data-testid="op-note">
              <div className="dd-caption">
                {n.fromCustomer
                  ? t('s9.case.fromCustomer')
                  : n.fromBusiness
                    ? t('op.case.fromBusiness')
                    : t('op.case.fromDealdash')}{' '}
                · <span>{formatDateTime(locale, n.createdAt)}</span>
                {n.evidenceRef ? (
                  <>
                    {' '}
                    · {t('s9.case.evidence')}: <span className="dd-ltr">{n.evidenceRef}</span>
                  </>
                ) : null}
                {n.kind && n.kind !== 'NOTE' ? <> · {t(k('op.noteKind', n.kind))}</> : null}
                {n.channel ? <> · {t(k('op.channel', n.channel))}</> : null}
                {admin && n.visibility === 'INTERNAL' ? (
                  <>
                    {' '}
                    <StatusChip tone="neutral">{t('op.case.vis.INTERNAL')}</StatusChip>
                  </>
                ) : null}
              </div>
              <div>{n.body}</div>
            </div>
          ))}
          {!closed && canManage ? (
            <div className="dd-stack" style={{ gap: 8 }}>
              <Field label={t('op.case.noteBody')} htmlFor="op-note-body">
                <Textarea
                  id="op-note-body"
                  value={note}
                  maxLength={2000}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
              {admin ? (
                <Field label={t('op.case.noteVisibility')} htmlFor="op-note-vis">
                  <Select
                    id="op-note-vis"
                    value={vis}
                    onChange={(e) => setVis(e.target.value as 'INTERNAL' | 'SHARED')}
                  >
                    <option value="SHARED">{t('op.case.vis.SHARED')}</option>
                    <option value="INTERNAL">{t('op.case.vis.INTERNAL')}</option>
                  </Select>
                </Field>
              ) : null}
              <div>
                <Button
                  variant="secondary"
                  disabled={!note.trim() || cmd.busy}
                  onClick={() =>
                    void cmd.run(
                      'POST',
                      `${path}/notes`,
                      admin ? { body: note, visibility: vis } : { body: note },
                      t('op.case.noteAdded'),
                      async () => {
                        setNote('');
                        await after();
                      },
                    )
                  }
                  data-testid="op-note-add"
                >
                  {t('op.case.addNote')}
                </Button>
              </div>
            </div>
          ) : null}
        </section>

        <EvidenceSection
          scope={scope}
          c={c}
          canManage={canManage && !closed}
          onChanged={after}
          call={call}
        />

        {admin && canManage && !closed && !awaitingApproval ? (
          <section className="dd-stack" style={{ gap: 8 }} aria-label={t('op.case.resolveTitle')}>
            <h4 className="dd-title-sm">{t('op.case.resolveTitle')}</h4>
            <Field label={t('op.case.outcome')} htmlFor="op-case-outcome">
              <Select
                id="op-case-outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as 'RESOLVED' | 'CLOSED' | 'REJECTED')}
              >
                <option value="RESOLVED">{t('op.case.outcome.RESOLVED')}</option>
                <option value="CLOSED">{t('op.case.outcome.CLOSED')}</option>
                <option value="REJECTED">{t('op.case.outcome.REJECTED')}</option>
              </Select>
            </Field>
            <Field label={t('op.case.resolution')} htmlFor="op-case-resolution">
              <Textarea
                id="op-case-resolution"
                value={resolution}
                maxLength={1000}
                onChange={(e) => setResolution(e.target.value)}
              />
            </Field>
            <Field
              label={t('op.case.finance')}
              htmlFor="op-case-finance"
              help={t('op.case.moneyNote')}
            >
              <Input
                id="op-case-finance"
                className="dd-ltr"
                value={finance}
                onChange={(e) => setFinance(e.target.value)}
              />
            </Field>
            <div>
              <Button
                disabled={resolution.trim().length < 3 || cmd.busy}
                onClick={() =>
                  void cmd.run(
                    'POST',
                    `${path}/resolve`,
                    { outcome, resolution, financialAdjustmentId: finance.trim() || null },
                    t('op.case.resolved'),
                    after,
                  )
                }
                data-testid="op-case-resolve"
              >
                {t('op.case.resolve')}
              </Button>
            </div>
          </section>
        ) : null}
        {closed ? (
          <Alert tone="info">
            {t('op.case.closedNote')} {c.resolution}
          </Alert>
        ) : null}
      </div>
    </Card>
  );
}

type RunCommand = ReturnType<typeof useCommand>['run'];

/**
 * Stage 8 case work for DealDash staff: assignment, severity and team, moving the case through the configured lifecycle, logging a
 * customer / business contact, and the maker-checker approval of a proposed resolution. The server enforces every rule (lifecycle,
 * second person, finance approver); this panel only offers the actions.
 */
function CaseWorkActions({
  path,
  c,
  meId,
  run,
  busy,
  after,
}: {
  path: string;
  c: CaseView;
  meId: string | null;
  run: RunCommand;
  busy: boolean;
  after: () => Promise<void>;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [team, setTeam] = useState(c.assignedTeam ?? '');
  const [severity, setSeverity] = useState(c.severity ?? 'MEDIUM');
  const [to, setTo] = useState<string>(MOVABLE[0] ?? 'INVESTIGATING');
  const [moveNote, setMoveNote] = useState('');
  const [channel, setChannel] = useState<string>(CONTACT_CHANNELS[0] ?? 'PHONE');
  const [direction, setDirection] = useState<'INBOUND' | 'OUTBOUND'>('OUTBOUND');
  const [contact, setContact] = useState('');
  const [proposal, setProposal] = useState('');
  const [impact, setImpact] = useState('');
  const [reason, setReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const awaitingApproval = c.status === 'AWAITING_APPROVAL';
  const iRequested = !!meId && c.approvalRequestedByUserId === meId;
  const impactMinor = impact.trim() ? Math.round(Number(impact) * 100) : null;
  return (
    <section
      className="dd-stack"
      style={{ gap: 12 }}
      aria-label={t('op.case.work')}
      data-testid="op-case-work"
    >
      <h4 className="dd-title-sm">{t('op.case.work')}</h4>
      <div className="dd-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={t('op.case.team')} htmlFor="op-case-team">
          <Select id="op-case-team" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">{t('op.case.noTeam')}</option>
            {CASE_TEAMS.map((x) => (
              <option key={x} value={x}>
                {t(k('op.team', x))}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="outline"
          disabled={busy || !meId}
          onClick={() =>
            meId &&
            void run(
              'POST',
              `${path}/assign`,
              { ownerUserId: meId, team: team || null },
              t('op.case.assigned'),
              after,
            )
          }
          data-testid="op-case-assign"
        >
          {t('op.case.assignMe')}
        </Button>
        <Field label={t('op.case.severity')} htmlFor="op-case-sev">
          <Select id="op-case-sev" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {CASE_SEVERITIES.map((x) => (
              <option key={x} value={x}>
                {t(k('op.sev', x))}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(
              'POST',
              `${path}/update`,
              { severity, assignedTeam: team || null },
              t('op.case.updated'),
              after,
            )
          }
          data-testid="op-case-update"
        >
          {t('op.case.saveRouting')}
        </Button>
      </div>

      {!awaitingApproval ? (
        <div className="dd-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={t('op.case.moveTo')} htmlFor="op-case-to">
            <Select
              id="op-case-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="op-case-to"
            >
              {MOVABLE.map((s) => (
                <option key={s} value={s}>
                  {t(k('op.dstatus', s))}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('op.case.moveNote')}
            htmlFor="op-case-move-note"
            // a note sent with a request to a party is shared with that case's parties (Stage 9, B6)
            help={
              to === 'AWAITING_CUSTOMER'
                ? t('s9.case.moveNoteCustomer')
                : to === 'AWAITING_MERCHANT' || to === 'AWAITING_PARTNER'
                  ? t('s9.case.moveNoteBusiness')
                  : undefined
            }
          >
            <Input
              id="op-case-move-note"
              value={moveNote}
              maxLength={2000}
              onChange={(e) => setMoveNote(e.target.value)}
            />
          </Field>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(
                'POST',
                `${path}/transition`,
                { to, note: moveNote.trim() || null },
                t('op.case.moved'),
                async () => {
                  setMoveNote('');
                  await after();
                },
              )
            }
            data-testid="op-case-move"
          >
            {t('op.case.move')}
          </Button>
        </div>
      ) : null}

      <div className="dd-stack" style={{ gap: 8 }}>
        <div className="dd-row" style={{ flexWrap: 'wrap' }}>
          <Field label={t('op.case.channel')} htmlFor="op-contact-channel">
            <Select
              id="op-contact-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              {CONTACT_CHANNELS.map((x) => (
                <option key={x} value={x}>
                  {t(k('op.channel', x))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('op.case.direction')} htmlFor="op-contact-dir">
            <Select
              id="op-contact-dir"
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'INBOUND' | 'OUTBOUND')}
            >
              <option value="OUTBOUND">{t('op.case.dir.OUTBOUND')}</option>
              <option value="INBOUND">{t('op.case.dir.INBOUND')}</option>
            </Select>
          </Field>
        </div>
        <Field label={t('op.case.contactBody')} htmlFor="op-contact-body">
          <Textarea
            id="op-contact-body"
            value={contact}
            maxLength={2000}
            onChange={(e) => setContact(e.target.value)}
          />
        </Field>
        <div>
          <Button
            variant="outline"
            disabled={contact.trim().length < 3 || busy}
            onClick={() =>
              void run(
                'POST',
                `${path}/contacts`,
                { channel, direction, body: contact },
                t('op.case.contactLogged'),
                async () => {
                  setContact('');
                  await after();
                },
              )
            }
            data-testid="op-contact-log"
          >
            {t('op.case.logContact')}
          </Button>
        </div>
      </div>

      {awaitingApproval ? (
        iRequested ? (
          <p className="dd-muted" data-testid="op-case-own-request">
            {t('op.case.ownRequest')}
          </p>
        ) : (
          <div className="dd-stack" style={{ gap: 8 }} data-testid="op-case-approval">
            <Field label={t('op.case.decisionReason')} htmlFor="op-case-decision-reason">
              <Textarea
                id="op-case-decision-reason"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            <div className="dd-row">
              <Button
                disabled={reason.trim().length < 3 || busy}
                onClick={() =>
                  void run(
                    'POST',
                    `${path}/approval/decide`,
                    { decision: 'APPROVE', reason },
                    t('op.case.approved'),
                    after,
                  )
                }
                data-testid="op-case-approve"
              >
                {t('op.case.approve')}
              </Button>
              <Button
                variant="outline"
                disabled={reason.trim().length < 3 || busy}
                onClick={() =>
                  void run(
                    'POST',
                    `${path}/approval/decide`,
                    { decision: 'REJECT', reason },
                    t('op.case.sentBack'),
                    after,
                  )
                }
                data-testid="op-case-reject"
              >
                {t('op.case.sendBack')}
              </Button>
            </div>
          </div>
        )
      ) : (
        <div className="dd-stack" style={{ gap: 8 }}>
          <Field
            label={t('op.case.proposal')}
            htmlFor="op-case-proposal"
            help={t('op.case.proposalHelp')}
          >
            <Textarea
              id="op-case-proposal"
              value={proposal}
              maxLength={1000}
              onChange={(e) => setProposal(e.target.value)}
            />
          </Field>
          <Field label={t('op.case.impactInput')} htmlFor="op-case-impact">
            <Input
              id="op-case-impact"
              className="dd-ltr"
              inputMode="decimal"
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
            />
          </Field>
          <div>
            <Button
              variant="secondary"
              disabled={
                proposal.trim().length < 3 || busy || (impactMinor !== null && !(impactMinor >= 0))
              }
              onClick={() =>
                void run(
                  'POST',
                  `${path}/approval`,
                  { proposedResolution: proposal, financialImpactMinor: impactMinor },
                  t('op.case.approvalRequested'),
                  after,
                )
              }
              data-testid="op-case-request-approval"
            >
              {t('op.case.requestApproval')}
            </Button>
          </div>
        </div>
      )}

      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowHistory((v) => !v)}
          data-testid="op-case-history-toggle"
        >
          {t('op.case.history')}
        </Button>
      </div>
      {showHistory ? <CaseHistory path={path} /> : null}
    </section>
  );
}

function CaseHistory({ path }: { path: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const res = useResource<
    { at: string; action: string; actorRole: string | null; reason: string | null }[]
  >(`${path}/history`);
  if (res.loading && !res.data) return <LoadingState label={t('state.loading')} />;
  if (res.errors.length) return <Alert tone="danger">{errorMessage(locale, res.errors)}</Alert>;
  return (
    <ol
      className="dd-stack"
      style={{ gap: 4, margin: 0, paddingInlineStart: 18 }}
      data-testid="op-case-history"
    >
      {(res.data ?? []).map((h, i) => (
        <li key={i} className="dd-caption">
          <span>{formatDateTime(locale, h.at)}</span> · <span className="dd-ltr">{h.action}</span>
          {h.actorRole ? <> · {h.actorRole}</> : null}
          {h.reason ? <> · {h.reason}</> : null}
        </li>
      ))}
    </ol>
  );
}

function EvidenceSection({
  scope,
  c,
  canManage,
  onChanged,
  call,
}: {
  scope: OpsScope;
  c: CaseView;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
  call: ReturnType<typeof useApi>['call'];
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const path = `${baseOf(scope)}/disputes/${c.id}`;
  const [type, setType] = useState<string>('DOCUMENT');
  const [label, setLabel] = useState('');
  const [visibility, setVisibility] = useState<'INTERNAL' | 'SHARED'>('SHARED');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const admin = scope.audience === 'admin';

  const upload = async (file: File) => {
    setBusy(true);
    setMsg(null);
    const intent = await call<{
      fileId: string;
      uploadUrl: string;
      headers: Record<string, string>;
    }>('POST', `${path}/attachments/intent`, {
      body: { fileName: file.name, mimeType: file.type, sizeBytes: file.size },
    });
    if (!intent.ok || !intent.data) {
      setBusy(false);
      setMsg({ tone: 'danger', text: errorMessage(locale, intent.errors) });
      return;
    }
    try {
      const put = await fetch(intent.data.uploadUrl, {
        method: 'PUT',
        headers: intent.data.headers,
        body: file,
      });
      if (!put.ok) throw new Error('upload');
    } catch {
      setBusy(false);
      setMsg({
        tone: 'danger',
        text: errorMessage(locale, [{ code: 'FILE_INVALID', message: 'Upload failed' }]),
      });
      return;
    }
    const done = await call('POST', `${path}/attachments`, {
      body: {
        fileId: intent.data.fileId,
        type,
        label: label || null,
        ...(admin ? { visibility } : {}),
      },
      idempotent: true,
    });
    setBusy(false);
    if (!done.ok) {
      setMsg({ tone: 'danger', text: errorMessage(locale, done.errors) });
      return;
    }
    setLabel('');
    setMsg({ tone: 'success', text: t('op.ev.added') });
    await onChanged();
  };

  const open = async (a: CaseAttachment) => {
    const r = await call<{ url: string }>('GET', `${path}/attachments/${a.id}/url`);
    if (r.ok && r.data) window.open(r.data.url, '_blank', 'noopener,noreferrer');
    else setMsg({ tone: 'danger', text: errorMessage(locale, r.errors) });
  };

  return (
    <section
      className="dd-stack"
      style={{ gap: 8 }}
      aria-label={t('op.ev.title')}
      data-testid="op-evidence"
    >
      <h4 className="dd-title-sm">{t('op.ev.title')}</h4>
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      {c.attachments.length === 0 ? <p className="dd-muted">{t('op.ev.empty')}</p> : null}
      {c.attachments.map((a) => (
        <div
          key={a.id}
          className="dd-row"
          style={{ justifyContent: 'space-between' }}
          data-testid="op-evidence-item"
        >
          <div>
            <strong>{a.label || a.fileName}</strong>
            <div className="dd-caption">
              {t(k('op.ev.type', a.type))} ·{' '}
              {a.fromBusiness ? t('op.case.fromBusiness') : t('op.case.fromDealdash')} ·{' '}
              <span>{formatDateTime(locale, a.uploadedAt)}</span>
              {a.visibility === 'INTERNAL' ? (
                <>
                  {' '}
                  <StatusChip tone="neutral">{t('op.ev.internal')}</StatusChip>
                </>
              ) : null}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void open(a)}>
            {t('op.ev.openFile')}
          </Button>
        </div>
      ))}
      {canManage ? (
        <div className="dd-stack" style={{ gap: 8 }}>
          <div className="dd-row" style={{ flexWrap: 'wrap' }}>
            <Field label={t('op.ev.type')} htmlFor="op-ev-type">
              <Select id="op-ev-type" value={type} onChange={(e) => setType(e.target.value)}>
                {EVIDENCE_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(k('op.ev.type', x))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('op.ev.label')} htmlFor="op-ev-label">
              <Input
                id="op-ev-label"
                value={label}
                maxLength={120}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>
            {admin ? (
              <Field label={t('op.ev.visibility')} htmlFor="op-ev-vis">
                <Select
                  id="op-ev-vis"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as 'INTERNAL' | 'SHARED')}
                >
                  <option value="SHARED">{t('op.case.vis.SHARED')}</option>
                  <option value="INTERNAL">{t('op.case.vis.INTERNAL')}</option>
                </Select>
              </Field>
            ) : null}
          </div>
          <FileField
            id="op-ev-file"
            label={busy ? t('op.ev.uploading') : t('op.ev.file')}
            accept="application/pdf,image/png,image/jpeg"
            busy={busy}
            onFile={(f) => void upload(f)}
          />
          <p className="dd-caption">{t('op.ev.note')}</p>
        </div>
      ) : null}
    </section>
  );
}

// ====================================================================================== offer conflicts (DealDash)
interface ConflictFlag {
  id: string;
  organizationId: string | null;
  type: string;
  status: string;
  details: {
    exclusive?: { mechanic?: string | null; value?: number | null };
    publicOffer?: { mechanic?: string | null; value?: number | null };
    title?: string;
  };
  decisionNote: string | null;
  createdAt: string;
}

export function ConflictsPanel({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [status, setStatus] = useState('OPEN');
  const res = useResource<ConflictFlag[]>('/v1/admin/conflicts', { status: status || undefined });
  const cmd = useCommand();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const fmt = (o?: { mechanic?: string | null; value?: number | null }) =>
    o ? `${o.mechanic ?? ''} ${o.value ?? ''}`.trim() : '-';
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="op-conflicts">
      <div>
        <h2 className="dd-title">{t('op.conf.title')}</h2>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('op.conf.sub')}
        </p>
      </div>
      <div className="dd-row">
        <Select
          aria-label={t('op.col.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('op.act.all')}</option>
          {(['OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'REQUIRES_CHANGE'] as const).map((s) => (
            <option key={s} value={s}>
              {t(k('op.conf.status', s))}
            </option>
          ))}
        </Select>
        {canManage ? (
          <Button
            variant="outline"
            disabled={cmd.busy}
            data-testid="op-conf-scan"
            onClick={async () => {
              await cmd.run<{ checked: number; flagged: number }>(
                'POST',
                '/v1/admin/conflicts/scan',
                {},
                (d) => t('op.conf.scanned', { checked: d?.checked ?? 0, flagged: d?.flagged ?? 0 }),
                () => res.reload(),
              );
            }}
          >
            {t('op.conf.scan')}
          </Button>
        ) : null}
      </div>
      {cmd.banner}
      {res.loading && !res.data ? (
        <LoadingState label={t('state.loading')} />
      ) : (res.data ?? []).length === 0 ? (
        <EmptyState title={t('op.conf.empty')} />
      ) : (
        <div className="dd-stack" style={{ gap: 10 }}>
          {(res.data ?? []).map((f) => (
            <Card flat key={f.id} data-testid={`op-conflict-${f.type}`}>
              <div className="dd-stack" style={{ gap: 8 }}>
                <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                  <strong>
                    {has(k('op.conf.type', f.type)) ? t(k('op.conf.type', f.type)) : f.type}
                  </strong>
                  <StatusChip
                    tone={
                      f.status === 'OPEN'
                        ? 'warning'
                        : f.status === 'REQUIRES_CHANGE'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {t(k('op.conf.status', f.status))}
                  </StatusChip>
                </div>
                {f.details.exclusive || f.details.publicOffer ? (
                  <div className="dd-caption dd-ltr">
                    {t('op.conf.exclusive', { value: fmt(f.details.exclusive) })} ·{' '}
                    {t('op.conf.public', { value: fmt(f.details.publicOffer) })}
                  </div>
                ) : null}
                {f.decisionNote ? <div className="dd-caption">{f.decisionNote}</div> : null}
                {canManage && f.status === 'OPEN' ? (
                  <div className="dd-stack" style={{ gap: 8 }}>
                    <Field label={t('op.conf.note')} htmlFor={`op-conf-note-${f.id}`}>
                      <Input
                        id={`op-conf-note-${f.id}`}
                        value={notes[f.id] ?? ''}
                        maxLength={500}
                        onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })}
                      />
                    </Field>
                    <div className="dd-row">
                      {(['ACKNOWLEDGED', 'REQUIRES_CHANGE'] as const).map((d) => (
                        <Button
                          key={d}
                          variant={d === 'ACKNOWLEDGED' ? 'secondary' : 'outline'}
                          disabled={(notes[f.id] ?? '').trim().length < 3 || cmd.busy}
                          data-testid={`op-conf-${d}`}
                          onClick={() =>
                            void cmd.run(
                              'POST',
                              `/v1/admin/conflicts/${f.id}/decide`,
                              { decision: d, note: notes[f.id] },
                              t('op.conf.decided'),
                              () => res.reload(),
                            )
                          }
                        >
                          {d === 'ACKNOWLEDGED'
                            ? t('op.conf.acknowledge')
                            : t('op.conf.requireChange')}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ====================================================================================== activity
interface ActivityRow {
  id: string;
  at: string;
  summary: string;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  actor: {
    by?: 'DEALDASH' | 'YOUR_TEAM' | 'SYSTEM';
    role?: string | null;
    userId?: string | null;
    organizationId?: string | null;
  };
}
interface ActivityPage {
  items: ActivityRow[];
  next: string | null;
}

export function ActivityPanel({ scope }: { scope: OpsScope }) {
  const { locale } = useAuth();
  const { call } = useApi();
  const t = createTranslator(locale);
  const [entityType, setEntityType] = useState('');
  const [org, setOrg] = useState('');
  const query = {
    limit: 25,
    entityType: entityType || undefined,
    organizationId: scope.audience === 'admin' && org ? org : undefined,
  };
  const first = useResource<ActivityPage>(`${baseOf(scope)}/activity`, query);
  const [more, setMore] = useState<ActivityRow[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const items = [...(first.data?.items ?? []), ...more];
  const cursor = next === undefined ? (first.data?.next ?? null) : next;
  const loadMore = async () => {
    if (!cursor) return;
    const r = await call<ActivityPage>('GET', `${baseOf(scope)}/activity`, {
      query: { ...query, before: cursor },
    });
    if (r.ok && r.data) {
      setMore([...more, ...r.data.items]);
      setNext(r.data.next);
    }
  };
  const label = (r: ActivityRow) =>
    has(k('op.action', r.action)) ? t(k('op.action', r.action)) : r.summary;
  const who = (r: ActivityRow): ReactNode =>
    r.actor.by
      ? t(k('op.act.by', r.actor.by))
      : (r.actor.role ?? (r.actor.userId ? r.actor.userId.slice(0, 8) : t('op.act.by.SYSTEM')));
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="op-activity">
      <div>
        <h2 className="dd-title">{t('op.act.title')}</h2>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('op.act.sub')}
        </p>
      </div>
      <div className="dd-row">
        <Select
          aria-label={t('op.act.filter')}
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value);
            setMore([]);
            setNext(undefined);
          }}
        >
          <option value="">{t('op.act.all')}</option>
          {['DisputeCase', 'LoyaltyRule', 'OfferConflictFlag', 'MerchantBranch', 'Route'].map(
            (x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ),
          )}
        </Select>
        {scope.audience === 'admin' ? (
          <Input
            aria-label={t('op.col.business')}
            placeholder={t('op.col.business')}
            className="dd-ltr"
            value={org}
            onChange={(e) => {
              setOrg(e.target.value.trim());
              setMore([]);
              setNext(undefined);
            }}
          />
        ) : null}
      </div>
      {first.loading && !first.data ? (
        <LoadingState label={t('state.loading')} />
      ) : items.length === 0 ? (
        <EmptyState title={t('op.act.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('op.col.when')}</th>
                <th>{t('op.col.what')}</th>
                <th>{t('op.col.by')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} data-testid="op-activity-row">
                  <td>{formatDateTime(locale, r.at)}</td>
                  <td>
                    {label(r)}
                    {r.reason ? (
                      <div className="dd-caption">{t('op.act.reason', { reason: r.reason })}</div>
                    ) : null}
                  </td>
                  <td>{who(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor ? (
        <div>
          <Button variant="outline" onClick={() => void loadMore()} data-testid="op-activity-more">
            {t('op.act.more')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ====================================================================================== loyalty
interface RuleView {
  id: string;
  name: string;
  status: string;
  eventType: string;
  kind: string;
  productScope: string | null;
  organizationId: string | null;
  basePoints: number;
  bonusPoints: number;
  pointsPer100Halalas: number;
  dailyCap: number | null;
  monthlyCap: number | null;
  customerCap: number | null;
  fundingSource: string;
  fundingOrganizationId: string | null;
  fundingHalalasPerPoint: number | null;
  maxAllocationPoints: number | null;
  allocatedPoints: number;
  reversedPoints: number;
  remainingAllocation: number | null;
  commercialStatus: string | null;
  createdAt: string;
}
interface FinanceRow {
  ruleId: string | null;
  ruleName: string;
  fundingSource: string;
  allocated: number | null;
  issued: number;
  reversed: number;
  redeemed: number;
  expired: number;
  outstanding: number;
  remainingAllocation: number | null;
  fundingHalalasPerPoint: number | null;
  fundingUtilizedHalalas: number | null;
  fundingReceivedHalalas: number | null;
  outstandingLiabilityHalalas: number | null;
}
interface FinanceView {
  rows: FinanceRow[];
  totals: {
    issued: number;
    reversed: number;
    redeemed: number;
    expired: number;
    outstanding: number;
    held: number;
  };
}

const EVENTS = [
  'QUALIFIED_VIEW',
  'EXCLUSIVE_REDEMPTION',
  'VOUCHER_PURCHASE',
  'VOUCHER_REDEMPTION',
] as const;
const PRODUCTS = ['LIVE_DEAL', 'EXCLUSIVE', 'VOUCHER', 'WATCH'] as const;
const money = (locale: 'en' | 'ar', halalas: number | null) =>
  halalas === null ? '-' : `SAR ${formatNumber(locale, Math.round(halalas) / 100)}`;
const toInt = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.floor(Number(v) || 0)));

/** Loyalty rules and their finance view. `fundingOptions` is what the caller may name as the payer. */
export function LoyaltyWorkspace({
  scope,
  canManage,
  canApprove,
  fundingOptions,
}: {
  scope: OpsScope;
  canManage: boolean;
  canApprove: boolean;
  fundingOptions: readonly string[];
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [tab, setTab] = useState('rules');
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="loyalty">
      <div>
        <h1 className="dd-title-xl">{t('lo.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('lo.sub')}
        </p>
      </div>
      <Alert tone="info">{t('lo.noCash')}</Alert>
      <Tabs
        label={t('lo.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'rules', label: t('lo.tab.rules') },
          { id: 'finance', label: t('lo.tab.finance') },
        ]}
      />
      {tab === 'rules' ? (
        <RulesPanel
          scope={scope}
          canManage={canManage}
          canApprove={canApprove}
          fundingOptions={fundingOptions}
        />
      ) : (
        <FinancePanel scope={scope} />
      )}
    </div>
  );
}

function RulesPanel({
  scope,
  canManage,
  canApprove,
  fundingOptions,
}: {
  scope: OpsScope;
  canManage: boolean;
  canApprove: boolean;
  fundingOptions: readonly string[];
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const base = `${baseOf(scope)}/loyalty/rules`;
  const res = useResource<RuleView[]>(base);
  const cmd = useCommand();
  const [show, setShow] = useState(false);
  const [f, setF] = useState({
    name: '',
    eventType: 'QUALIFIED_VIEW',
    kind: 'BASE',
    product: '',
    base: '10',
    bonus: '0',
    per100: '0',
    daily: '',
    monthly: '',
    customer: '',
    alloc: '1000',
    funding: fundingOptions[0] ?? 'DEALDASH',
    funder: '',
    rate: '',
    expiry: '',
  });
  const [reason, setReason] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState<Record<string, string>>({});
  const funded = f.funding !== 'DEALDASH';
  const orgId = scope.audience === 'org' ? scope.orgId : null;
  const create = async () => {
    const body = {
      name: f.name,
      eventType: f.eventType,
      kind: f.kind,
      productScope: f.product || null,
      basePoints: toInt(f.base) ?? 0,
      bonusPoints: toInt(f.bonus) ?? 0,
      pointsPer100Halalas: toInt(f.per100) ?? 0,
      dailyCap: toInt(f.daily),
      monthlyCap: toInt(f.monthly),
      customerCap: toInt(f.customer),
      maxAllocationPoints: toInt(f.alloc) ?? 1,
      fundingSource: f.funding,
      fundingOrganizationId: funded ? (orgId ?? (f.funder.trim() || null)) : null,
      fundingHalalasPerPoint: funded
        ? Math.round((Number(f.rate.replace(',', '.')) || 0) * 100)
        : null,
      expiryDays: toInt(f.expiry),
    };
    const ok = await cmd.run('POST', base, body, t('lo.created'), () => res.reload());
    if (ok) {
      setShow(false);
      setF({ ...f, name: '' });
    }
  };
  const act = (id: string, action: string) =>
    cmd.run(
      'POST',
      `${base}/${id}/${action}`,
      reason[id] ? { reason: reason[id] } : {},
      t('lo.act.done'),
      () => res.reload(),
    );
  const num = (key: keyof typeof f, label: DictionaryKey, help?: DictionaryKey) => (
    <Field label={t(label)} htmlFor={`lo-${key}`} help={help ? t(help) : undefined}>
      <Input
        id={`lo-${key}`}
        inputMode="numeric"
        className="dd-ltr"
        value={f[key]}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="lo-rules">
      <div className="dd-row" style={{ justifyContent: 'flex-end' }}>
        {canManage ? (
          <Button onClick={() => setShow((v) => !v)} data-testid="lo-new">
            {t('lo.new')}
          </Button>
        ) : null}
      </div>
      {cmd.banner}
      {show ? (
        <Card flat>
          <div className="dd-stack" style={{ gap: 10 }} data-testid="lo-form">
            <Field label={t('lo.f.name')} htmlFor="lo-name">
              <Input
                id="lo-name"
                value={f.name}
                maxLength={120}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </Field>
            <Field label={t('lo.f.event')} htmlFor="lo-event">
              <Select
                id="lo-event"
                value={f.eventType}
                onChange={(e) => setF({ ...f, eventType: e.target.value })}
              >
                {EVENTS.map((x) => (
                  <option key={x} value={x}>
                    {t(k('lo.event', x))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('lo.f.kind')} htmlFor="lo-kind">
              <Select
                id="lo-kind"
                value={f.kind}
                onChange={(e) => setF({ ...f, kind: e.target.value })}
              >
                <option value="BASE">{t('lo.kind.BASE')}</option>
                <option value="BONUS">{t('lo.kind.BONUS')}</option>
              </Select>
            </Field>
            <Field label={t('lo.f.product')} htmlFor="lo-product">
              <Select
                id="lo-product"
                value={f.product}
                onChange={(e) => setF({ ...f, product: e.target.value })}
              >
                <option value="">{t('lo.product.ALL')}</option>
                {PRODUCTS.map((x) => (
                  <option key={x} value={x}>
                    {t(k('lo.product', x))}
                  </option>
                ))}
              </Select>
            </Field>
            {num('base', 'lo.f.base')}
            {num('bonus', 'lo.f.bonus')}
            {num('per100', 'lo.f.per100')}
            {num('daily', 'lo.f.dailyCap')}
            {num('monthly', 'lo.f.monthlyCap')}
            {num('customer', 'lo.f.customerCap')}
            {num('alloc', 'lo.f.alloc', 'lo.f.help.alloc')}
            {num('expiry', 'lo.f.expiry')}
            <Field label={t('lo.f.funding')} htmlFor="lo-funding" help={t('lo.f.help.funding')}>
              <Select
                id="lo-funding"
                value={f.funding}
                onChange={(e) => setF({ ...f, funding: e.target.value })}
              >
                {fundingOptions.map((x) => (
                  <option key={x} value={x}>
                    {t(k('lo.fund', x))}
                  </option>
                ))}
              </Select>
            </Field>
            {funded && scope.audience === 'admin' ? (
              <Field label={t('lo.f.funder')} htmlFor="lo-funder">
                <Input
                  id="lo-funder"
                  className="dd-ltr"
                  value={f.funder}
                  onChange={(e) => setF({ ...f, funder: e.target.value })}
                />
              </Field>
            ) : null}
            {funded ? (
              <Field label={t('lo.f.rate')} htmlFor="lo-rate">
                <Input
                  id="lo-rate"
                  inputMode="decimal"
                  className="dd-ltr"
                  value={f.rate}
                  onChange={(e) => setF({ ...f, rate: e.target.value })}
                />
              </Field>
            ) : null}
            <div>
              <Button
                onClick={() => void create()}
                disabled={f.name.trim().length < 3 || cmd.busy}
                loading={cmd.busy}
                data-testid="lo-create"
              >
                {t('lo.create')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
      {res.loading && !res.data ? (
        <LoadingState label={t('state.loading')} />
      ) : (res.data ?? []).length === 0 ? (
        <EmptyState title={t('lo.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('lo.col.name')}</th>
                <th>{t('lo.col.event')}</th>
                <th>{t('lo.col.points')}</th>
                <th>{t('lo.col.funding')}</th>
                <th>{t('lo.col.status')}</th>
                <th>{t('lo.col.given')}</th>
                <th>{t('lo.col.left')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(res.data ?? []).map((r) => (
                <tr key={r.id} data-testid={`lo-rule-${r.name}`}>
                  <td>{r.name}</td>
                  <td>
                    {has(k('lo.event', r.eventType)) ? t(k('lo.event', r.eventType)) : r.eventType}
                  </td>
                  <td className="dd-ltr">{formatNumber(locale, r.basePoints + r.bonusPoints)}</td>
                  <td>
                    {t(k('lo.fund', r.fundingSource))}
                    {r.commercialStatus ? (
                      <div className="dd-caption">{t(k('cm.status', r.commercialStatus))}</div>
                    ) : null}
                  </td>
                  <td>
                    <StatusChip tone={RULE_TONE[r.status] ?? 'neutral'}>
                      {t(k('lo.status', r.status))}
                    </StatusChip>
                  </td>
                  <td className="dd-ltr">{formatNumber(locale, r.allocatedPoints)}</td>
                  <td className="dd-ltr">
                    {r.remainingAllocation === null
                      ? '-'
                      : formatNumber(locale, r.remainingAllocation)}
                  </td>
                  <td>
                    <div className="dd-stack" style={{ gap: 6 }}>
                      {canManage || canApprove ? (
                        <Input
                          aria-label={t('lo.act.reason')}
                          placeholder={t('lo.act.reason')}
                          value={reason[r.id] ?? ''}
                          onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })}
                        />
                      ) : null}
                      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
                        {canManage && r.status === 'DRAFT' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={cmd.busy}
                            onClick={() => void act(r.id, 'submit')}
                            data-testid={`lo-submit-${r.name}`}
                          >
                            {t('lo.act.submit')}
                          </Button>
                        ) : null}
                        {canApprove && r.status === 'PENDING_APPROVAL' ? (
                          <>
                            <Button
                              size="sm"
                              disabled={cmd.busy}
                              onClick={() => void act(r.id, 'approve')}
                              data-testid={`lo-approve-${r.name}`}
                            >
                              {t('lo.act.approve')}
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={cmd.busy || (reason[r.id] ?? '').trim().length < 3}
                              onClick={() => void act(r.id, 'reject')}
                            >
                              {t('lo.act.reject')}
                            </Button>
                          </>
                        ) : null}
                        {canManage && r.status === 'ACTIVE' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={cmd.busy}
                            onClick={() => void act(r.id, 'pause')}
                            data-testid={`lo-pause-${r.name}`}
                          >
                            {t('lo.act.pause')}
                          </Button>
                        ) : null}
                        {canManage && r.status === 'PAUSED' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={cmd.busy}
                            onClick={() => void act(r.id, 'resume')}
                          >
                            {t('lo.act.resume')}
                          </Button>
                        ) : null}
                        {canManage && ['DRAFT', 'ACTIVE', 'PAUSED'].includes(r.status) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={cmd.busy}
                            onClick={() => void act(r.id, 'end')}
                          >
                            {t('lo.act.end')}
                          </Button>
                        ) : null}
                      </div>
                      {(canManage || canApprove) &&
                      ['DRAFT', 'ACTIVE', 'PAUSED'].includes(r.status) ? (
                        <div className="dd-row">
                          <Input
                            aria-label={t('lo.act.newLimit')}
                            placeholder={t('lo.act.newLimit')}
                            inputMode="numeric"
                            className="dd-ltr"
                            value={limit[r.id] ?? ''}
                            onChange={(e) => setLimit({ ...limit, [r.id]: e.target.value })}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={cmd.busy || !toInt(limit[r.id] ?? '')}
                            onClick={() =>
                              void cmd.run(
                                'POST',
                                `${base}/${r.id}/allocation`,
                                { maxAllocationPoints: toInt(limit[r.id] ?? '') },
                                t('lo.act.done'),
                                () => res.reload(),
                              )
                            }
                          >
                            {t('lo.act.raise')}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canApprove ? <p className="dd-caption">{t('lo.act.approveNote')}</p> : null}
    </div>
  );
}

function FinancePanel({ scope }: { scope: OpsScope }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const res = useResource<FinanceView>(`${baseOf(scope)}/loyalty/finance`);
  if (res.loading && !res.data) return <LoadingState label={t('state.loading')} />;
  const d = res.data;
  if (!d || d.rows.length === 0) return <EmptyState title={t('lo.fin.empty')} />;
  const stat = (label: DictionaryKey, value: number, id: string) => (
    <Card flat key={id}>
      <div className="dd-caption">{t(label)}</div>
      <div className="dd-title-xl dd-ltr" style={{ fontSize: 24 }} data-testid={id}>
        {formatNumber(locale, value)}
      </div>
    </Card>
  );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="lo-finance">
      <div className="dd-finance-grid">
        {stat('lo.fin.issued', d.totals.issued, 'lo-fin-issued')}
        {stat('lo.fin.reversed', d.totals.reversed, 'lo-fin-reversed')}
        {stat('lo.fin.outstanding', d.totals.outstanding, 'lo-fin-outstanding')}
        {stat('lo.fin.held', d.totals.held, 'lo-fin-held')}
      </div>
      <div className="dd-table-wrap">
        <table className="dd-table">
          <thead>
            <tr>
              <th>{t('lo.col.name')}</th>
              <th>{t('lo.col.funding')}</th>
              <th>{t('lo.fin.issued')}</th>
              <th>{t('lo.fin.reversed')}</th>
              <th>{t('lo.fin.redeemed')}</th>
              <th>{t('lo.fin.expired')}</th>
              <th>{t('lo.fin.outstanding')}</th>
              <th>{t('lo.fin.drawn')}</th>
              <th>{t('lo.fin.received')}</th>
              <th>{t('lo.fin.liability')}</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.ruleId ?? r.ruleName} data-testid={`lo-fin-${r.ruleName}`}>
                <td>{r.ruleName}</td>
                <td>{t(k('lo.fund', r.fundingSource))}</td>
                <td className="dd-ltr">{formatNumber(locale, r.issued)}</td>
                <td className="dd-ltr">{formatNumber(locale, r.reversed)}</td>
                <td className="dd-ltr">{formatNumber(locale, r.redeemed)}</td>
                <td className="dd-ltr">{formatNumber(locale, r.expired)}</td>
                <td className="dd-ltr">{formatNumber(locale, r.outstanding)}</td>
                <td className="dd-ltr">
                  {r.fundingHalalasPerPoint === null
                    ? t('lo.fin.noFunder')
                    : money(locale, r.fundingUtilizedHalalas)}
                </td>
                <td className="dd-ltr">
                  {r.fundingHalalasPerPoint === null
                    ? '-'
                    : money(locale, r.fundingReceivedHalalas)}
                </td>
                <td className="dd-ltr">
                  {r.fundingHalalasPerPoint === null
                    ? '-'
                    : money(locale, r.outstandingLiabilityHalalas)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
