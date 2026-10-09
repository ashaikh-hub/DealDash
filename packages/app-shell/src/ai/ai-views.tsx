'use client';

import { useState } from 'react';
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
  Checkbox,
  EmptyState,
  Field,
  LoadingState,
  Select,
  StatusChip,
  Tabs,
  Textarea,
} from '@dealdash/ui';
import type { StatusTone } from '@dealdash/ui';
import { useApi, useResource } from '../api';
import { useAuth } from '../auth-context';
import { errorMessage } from '../gates';

const has = (key: string): key is DictionaryKey => key in dictionaries.en;
function useLabel() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  return (prefix: string, value: string | null | undefined) => {
    if (!value) return '-';
    const key = `${prefix}.${value}`;
    return has(key) ? t(key) : value;
  };
}

/** Every statement is labelled so a forecast or a hypothesis is never read as a fact. */
export const STATEMENT_TONE: Record<string, StatusTone> = {
  OBSERVED_FACT: 'success',
  CALCULATED_TREND: 'info',
  FORECAST: 'warning',
  HYPOTHESIS: 'neutral',
  RECOMMENDATION: 'info',
};

export interface AiAnswer {
  interactionId: string;
  agent: string;
  intent: string;
  label: string;
  locale: string;
  localeNote: { requested: string; answeredIn: string; reason: string } | null;
  autonomyLevel: number;
  statements: Array<{ kind: string; text: string; sources: string[] }>;
  items: Array<{
    product: string;
    id: string;
    title: string;
    merchant: string | null;
    why: string[];
    reportedSavings: { amount: string; percent: number } | null;
    href: string;
    action: { kind: string; requiresConfirmation: boolean };
  }>;
  drafts: Array<{
    id: string;
    kind: string;
    title: string;
    status: string;
    label: string;
    requiresApprovalBy: string;
    payload: unknown;
  }>;
  actions: Array<{ label: string; href: string; requiresConfirmation: boolean }>;
  handoff: { available: boolean } | null;
  disclaimer: string;
}

export function AnswerView({
  a,
  onDecide,
  canApprove,
}: {
  a: AiAnswer;
  onDecide?: (draftId: string, approve: boolean) => void;
  canApprove?: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  return (
    <div className="dd-stack" style={{ gap: 10 }} data-testid="ai-answer">
      <div className="dd-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <StatusChip tone="info">{label('ai.label', a.label)}</StatusChip>
        <StatusChip tone="neutral">{t('ai.autonomy', { level: a.autonomyLevel })}</StatusChip>
      </div>
      {a.localeNote ? (
        <Alert tone="info">{t('ai.localeNote', { requested: a.localeNote.requested })}</Alert>
      ) : null}
      {a.statements.map((s, i) => (
        <div
          key={i}
          className="dd-row"
          style={{ gap: 8, alignItems: 'flex-start' }}
          data-testid={`ai-statement-${s.kind}`}
        >
          <StatusChip tone={STATEMENT_TONE[s.kind] ?? 'neutral'}>
            {label('ai.kind', s.kind)}
          </StatusChip>
          <span>{s.text}</span>
        </div>
      ))}
      {a.items.length ? (
        <div className="dd-stack" style={{ gap: 8 }}>
          {a.items.map((it) => (
            <Card flat key={`${it.product}-${it.id}`} data-testid={`ai-item-${it.id}`}>
              <div className="dd-stack" style={{ gap: 4 }}>
                <div
                  className="dd-row"
                  style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
                >
                  <strong>{it.title}</strong>
                  <StatusChip tone="info">{label('vis.product', it.product)}</StatusChip>
                </div>
                {it.merchant ? <span className="dd-muted">{it.merchant}</span> : null}
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {it.why.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                {it.reportedSavings ? (
                  <span>
                    {t('ai.reportedSavings', {
                      amount: it.reportedSavings.amount,
                      percent: it.reportedSavings.percent,
                    })}
                  </span>
                ) : null}
                <div>
                  <a className="dd-btn dd-btn--outline dd-btn--sm" href={`/${locale}${it.href}`}>
                    {it.action.requiresConfirmation ? t('ai.openToConfirm') : t('ai.open')}
                  </a>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
      {a.drafts.map((d) => (
        <Card flat key={d.id} data-testid={`ai-draft-${d.kind}`}>
          <div className="dd-stack" style={{ gap: 6 }}>
            <div
              className="dd-row"
              style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
            >
              <strong>{d.title}</strong>
              <StatusChip tone="warning">{label('ai.label', d.label)}</StatusChip>
            </div>
            <span className="dd-muted">{t('ai.needsApproval')}</span>
            {onDecide && canApprove ? (
              <div className="dd-row" style={{ gap: 8 }}>
                <Button size="sm" onClick={() => onDecide(d.id, true)} data-testid="ai-approve">
                  {t('ai.approve')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDecide(d.id, false)}>
                  {t('ai.reject')}
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ))}
      {a.actions.length ? (
        <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {a.actions.map((x) => (
            <a
              key={x.href + x.label}
              className="dd-btn dd-btn--ghost dd-btn--sm"
              href={`/${locale}${x.href}`}
            >
              {x.label}
              {x.requiresConfirmation ? ` · ${t('ai.youConfirm')}` : ''}
            </a>
          ))}
        </div>
      ) : null}
      {a.handoff?.available ? <span className="dd-muted">{t('ai.handoff')}</span> : null}
      <p className="dd-muted" style={{ margin: 0, fontSize: 12 }}>
        {a.disclaimer}
      </p>
    </div>
  );
}

/**
 * One conversation turn with a governed assistant. `askPath` decides the agent (customer, business or DealDash). Drafting is opt-in
 * (autonomy 2); nothing executes until a person approves it here or in the drafts list.
 */
export function AiAssistantPanel({
  askPath,
  draftsBase,
  canApprove,
  adminAgents,
  allowDrafting = true,
  examples,
}: {
  askPath: string;
  draftsBase?: string;
  canApprove?: boolean;
  adminAgents?: string[];
  allowDrafting?: boolean;
  examples?: DictionaryKey[];
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const { call } = useApi();
  const [message, setMessage] = useState('');
  const [agent, setAgent] = useState(adminAgents?.[0] ?? '');
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<AiAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ask = async (text = message) => {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const body: Record<string, unknown> = {
      message: text.trim(),
      locale,
      ...(drafting ? { autonomy: 2 } : {}),
    };
    if (adminAgents) body.agent = agent;
    const r = await call<AiAnswer>('POST', askPath, { body, idempotent: true });
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(errorMessage(locale, r.errors));
      return;
    }
    setAnswer(r.data);
  };
  const decide = async (draftId: string, approve: boolean) => {
    if (!draftsBase) return;
    const r = await call<{ status: string }>(
      'POST',
      `${draftsBase}/${draftId}/${approve ? 'approve' : 'reject'}`,
      { body: {}, idempotent: true },
    );
    if (!r.ok) setError(errorMessage(locale, r.errors));
    else {
      setNotice(t(`ai.decided.${r.data?.status ?? 'APPROVED'}` as DictionaryKey));
      setAnswer((a) => (a ? { ...a, drafts: a.drafts.filter((d) => d.id !== draftId) } : a));
    }
  };
  return (
    <Card data-testid="ai-panel">
      <div className="dd-stack" style={{ gap: 12 }}>
        <h2 className="dd-title-md" style={{ margin: 0 }}>
          {t('ai.title')}
        </h2>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('ai.intro')}
        </p>
        {adminAgents ? (
          <Field label={t('ai.agent')} htmlFor="ai-agent">
            <Select id="ai-agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
              {adminAgents.map((x) => (
                <option key={x} value={x}>
                  {label('ai.agentName', x)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <form
          className="dd-stack"
          style={{ gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <Field label={t('ai.ask')} htmlFor="ai-msg">
            <Textarea
              id="ai-msg"
              rows={2}
              value={message}
              maxLength={2000}
              onChange={(e) => setMessage(e.target.value)}
            />
          </Field>
          {examples?.length ? (
            <div className="dd-row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {examples.map((k) => (
                <Button
                  key={k}
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setMessage(t(k));
                    void ask(t(k));
                  }}
                >
                  {t(k)}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="dd-row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button type="submit" loading={busy} disabled={!message.trim()} data-testid="ai-send">
              {t('ai.send')}
            </Button>
            {allowDrafting ? (
              <Checkbox
                label={t('ai.allowDrafts')}
                checked={drafting}
                onChange={() => setDrafting((d) => !d)}
              />
            ) : null}
          </div>
        </form>
        {busy ? <LoadingState label={t('ai.thinking')} /> : null}
        {error ? (
          <div data-testid="ai-error">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
        {notice ? <Alert tone="success">{notice}</Alert> : null}
        {answer ? (
          <AnswerView
            a={answer}
            onDecide={(id, ok) => void decide(id, ok)}
            canApprove={canApprove}
          />
        ) : null}
      </div>
    </Card>
  );
}

interface DraftRow {
  id: string;
  kind: string;
  agent: string;
  title: string;
  status: string;
  label: string;
  createdAt: string;
}

export function AiDraftsList({ path, canApprove }: { path: string; canApprove: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const { call } = useApi();
  const res = useResource<DraftRow[]>(path);
  const [error, setError] = useState<string | null>(null);
  const decide = async (id: string, approve: boolean) => {
    const r = await call('POST', `${path}/${id}/${approve ? 'approve' : 'reject'}`, {
      body: {},
      idempotent: true,
    });
    if (!r.ok) setError(errorMessage(locale, r.errors));
    await res.reload();
  };
  if (res.loading && !res.data) return <LoadingState label={t('state.loading')} />;
  return (
    <Card data-testid="ai-drafts">
      <div className="dd-stack" style={{ gap: 8 }}>
        <h2 className="dd-title-md" style={{ margin: 0 }}>
          {t('ai.drafts')}
        </h2>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {res.errors.length ? (
          <Alert tone="warning">{errorMessage(locale, res.errors)}</Alert>
        ) : null}
        {res.data && !res.data.length ? <EmptyState title={t('ai.noDrafts')} /> : null}
        {res.data?.map((d) => (
          <Card flat key={d.id}>
            <div
              className="dd-row"
              style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
            >
              <div className="dd-stack" style={{ gap: 2 }}>
                <strong>{d.title}</strong>
                <span className="dd-muted">
                  {label('ai.agentName', d.agent)} · {formatDateTime(locale, d.createdAt)}
                </span>
              </div>
              <div className="dd-row" style={{ gap: 6 }}>
                <StatusChip
                  tone={
                    d.status === 'PENDING_APPROVAL'
                      ? 'warning'
                      : d.status === 'REJECTED'
                        ? 'neutral'
                        : 'success'
                  }
                >
                  {label('ai.label', d.label)}
                </StatusChip>
                {canApprove && d.status === 'PENDING_APPROVAL' ? (
                  <>
                    <Button size="sm" onClick={() => void decide(d.id, true)}>
                      {t('ai.approve')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void decide(d.id, false)}>
                      {t('ai.reject')}
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </Card>
  );
}

// ====================================================================================== DealDash AI governance
interface Interaction {
  id: string;
  agent: string;
  intent: string | null;
  status: string;
  autonomyLevel: number;
  toolCalls: number;
  locale: string;
  createdAt: string;
}
interface Usage {
  commercialTreatment: string;
  pricing: string;
  rows: Array<{
    agent: string;
    kind: string;
    records: number;
    units: number;
    estimatedCostMinor: number;
  }>;
}
interface EvalRun {
  passed: number;
  failed: number;
  results: Array<{ case: string; passed: boolean; detail: string }>;
}

export function AdminAiWorkspace({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const { call } = useApi();
  const [tab, setTab] = useState('assistant');
  const interactions = useResource<Interaction[]>(
    canManage && tab === 'audit' ? '/v1/admin/ai/interactions' : null,
  );
  const usage = useResource<Usage>(canManage && tab === 'usage' ? '/v1/admin/ai/usage' : null);
  const [evals, setEvals] = useState<EvalRun | null>(null);
  const tabs = [
    { id: 'assistant', label: t('ai.title') },
    { id: 'drafts', label: t('ai.drafts') },
    ...(canManage
      ? [
          { id: 'audit', label: t('ai.audit') },
          { id: 'usage', label: t('ai.usage') },
          { id: 'evals', label: t('ai.evals') },
        ]
      : []),
  ];
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-ai">
      <h1 className="dd-title-xl">{t('ai.adminTitle')}</h1>
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} label={t('ai.adminTitle')} />
      </div>
      {tab === 'assistant' ? (
        <AiAssistantPanel
          askPath="/v1/admin/ai/ask"
          adminAgents={['ADMIN_FINANCE', 'OPERATIONS_SUPPORT']}
          draftsBase="/v1/admin/ai/drafts"
          canApprove={canManage}
          examples={['ai.ex.finance', 'ai.ex.ops']}
        />
      ) : null}
      {tab === 'drafts' ? <AiDraftsList path="/v1/admin/ai/drafts" canApprove={canManage} /> : null}
      {tab === 'audit' ? (
        <Card data-testid="ai-audit">
          {interactions.data ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table">
                <thead>
                  <tr>
                    <th>{t('ai.when')}</th>
                    <th>{t('ai.agent')}</th>
                    <th>{t('ai.intent')}</th>
                    <th>{t('ai.status')}</th>
                    <th>{t('ai.autonomyCol')}</th>
                    <th>{t('ai.tools')}</th>
                  </tr>
                </thead>
                <tbody>
                  {interactions.data.map((i) => (
                    <tr key={i.id}>
                      <td>{formatDateTime(locale, i.createdAt)}</td>
                      <td>{label('ai.agentName', i.agent)}</td>
                      <td>{i.intent ?? '-'}</td>
                      <td>
                        <StatusChip
                          tone={
                            i.status === 'ANSWERED'
                              ? 'success'
                              : i.status === 'DENIED'
                                ? 'warning'
                                : 'danger'
                          }
                        >
                          {label('ai.status', i.status)}
                        </StatusChip>
                      </td>
                      <td>{i.autonomyLevel}</td>
                      <td>{formatNumber(locale, i.toolCalls)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <LoadingState label={t('state.loading')} />
          )}
        </Card>
      ) : null}
      {tab === 'usage' ? (
        <Card data-testid="ai-usage">
          {usage.data ? (
            <div className="dd-stack" style={{ gap: 8 }}>
              <Alert tone="info">
                {t('ai.notPriced', {
                  treatment: label('ai.treatment', usage.data.commercialTreatment),
                })}
              </Alert>
              <table className="dd-table">
                <thead>
                  <tr>
                    <th>{t('ai.agent')}</th>
                    <th>{t('ai.usageKind')}</th>
                    <th>{t('ai.units')}</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.data.rows.map((r) => (
                    <tr key={`${r.agent}-${r.kind}`}>
                      <td>{label('ai.agentName', r.agent)}</td>
                      <td>{label('ai.usageKindName', r.kind)}</td>
                      <td>{formatNumber(locale, r.units)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <LoadingState label={t('state.loading')} />
          )}
        </Card>
      ) : null}
      {tab === 'evals' ? (
        <Card data-testid="ai-evals">
          <div className="dd-stack" style={{ gap: 8 }}>
            <div>
              <Button
                onClick={() =>
                  void call<EvalRun>('POST', '/v1/admin/ai/evaluations', {
                    body: {},
                    idempotent: true,
                  }).then((r) => {
                    if (r.ok) setEvals(r.data);
                  })
                }
                data-testid="ai-run-evals"
              >
                {t('ai.runEvals')}
              </Button>
            </div>
            {evals ? (
              <>
                <StatusChip tone={evals.failed ? 'danger' : 'success'}>
                  {t('ai.evalSummary', { passed: evals.passed, failed: evals.failed })}
                </StatusChip>
                {evals.results.map((r) => (
                  <div key={r.case} className="dd-row" style={{ gap: 8 }}>
                    <StatusChip tone={r.passed ? 'success' : 'danger'}>
                      {r.passed ? t('ai.pass') : t('ai.fail')}
                    </StatusChip>
                    <strong>{label('ai.eval', r.case)}</strong>
                    <span className="dd-muted">{r.detail}</span>
                  </div>
                ))}
              </>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
