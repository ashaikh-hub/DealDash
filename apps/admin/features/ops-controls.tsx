'use client';

import { useState, type ReactNode } from 'react';
import { RequirePermission, useResource } from '@dealdash/app-shell';
import { formatDateTime } from '@dealdash/localization';
import { Alert, Button, Card, Field, Input, Select, StatusChip, Tabs } from '@dealdash/ui';
import {
  DecisionBar,
  OPS_TONE,
  OpsHeader,
  OpsStates,
  ReasonField,
  reasonOk,
  useOpsCommand,
  usePerms,
  useT,
} from './ops-kit';

/**
 * Stage 9 (B7): Admin -> Rules and controls. Every governed setting is edited through forms (never raw JSON), validated by the server,
 * and changed only through a change request that a DIFFERENT person approves; a change can take effect later (effective time).
 * History shows each version with its reason; rollback proposes an earlier version through the same approval.
 * Emergency market stops (launch controls) are immediate and recorded with a reason.
 */
type Json = Record<string, unknown>;
interface GovernedConfig {
  key: string;
  value: unknown;
  version: number;
  updatedAt: string | null;
  kind: 'SCALAR' | 'OBJECT';
  group: string | null;
  min: number | null;
  max: number | null;
}
interface ChangeRequest {
  id: string;
  reference: string;
  key: string;
  section: string;
  status: string;
  reason: string;
  effectiveFrom: string | null;
  restoresVersion: number | null;
  decisionReason: string | null;
  appliedVersion: number | null;
  createdAt: string;
  canDecide: boolean;
  canCancel: boolean;
}
interface Overview {
  configs: GovernedConfig[];
  open: ChangeRequest[];
  recent: ChangeRequest[];
}
type Tab =
  | 'requests'
  | 'reasons'
  | 'sla'
  | 'approvals'
  | 'risk'
  | 'notify'
  | 'reviews'
  | 'platform'
  | 'prizes'
  | 'launch'
  | 'history';

export function AdminRulesPage() {
  return (
    <RequirePermission any={['admin.config.read', 'admin.launch.control']}>
      <Controls />
    </RequirePermission>
  );
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

function Controls() {
  const { t } = useT();
  const perms = usePerms();
  const canRead = perms.includes('admin.config.read');
  const res = useResource<Overview>(canRead ? '/v1/admin/controls' : null);
  const [tab, setTab] = useState<Tab>(canRead ? 'requests' : 'launch');
  const tabs: Array<{ id: Tab; label: string }> = canRead
    ? (
        [
          'requests',
          'reasons',
          'sla',
          'approvals',
          'risk',
          'notify',
          'reviews',
          'platform',
          'prizes',
          'launch',
          'history',
        ] as const
      ).map((id) => ({ id, label: t(`s9.cfg.tab.${id}` as never) }))
    : [{ id: 'launch', label: t('s9.cfg.tab.launch') }];
  const cfg = (key: string) => res.data?.configs.find((c) => c.key === key);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-rules">
      <OpsHeader title={t('s8.cfg.title')} intro={t('s9.cfg.intro')} />
      <Alert tone="info">{t('s8.cfg.marketNote')}</Alert>
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          label={t('s8.cfg.title')}
        />
      </div>
      {tab === 'launch' && !canRead ? (
        <LaunchStops controls={null} onChanged={() => undefined} />
      ) : null}
      {canRead ? (
        <OpsStates res={res}>
          {(d) => {
            const ops = cfg('operations');
            const reload = () => void res.reload();
            if (tab === 'requests')
              return <Requests open={d.open} recent={d.recent} onChanged={reload} />;
            if (tab === 'history') return <History configs={d.configs} onChanged={reload} />;
            if (tab === 'platform') return <Platform configs={d.configs} onChanged={reload} />;
            if (tab === 'prizes') {
              const g = cfg('watch.prize_guardrails');
              return g ? <PrizeGuardrails c={g} onChanged={reload} /> : null;
            }
            if (tab === 'launch') return <Launch c={cfg('launch.controls')!} onChanged={reload} />;
            if (!ops) return null;
            if (tab === 'reasons') return <Reasons c={ops} onChanged={reload} />;
            if (tab === 'sla') return <Sla c={ops} onChanged={reload} />;
            if (tab === 'approvals') return <Approvals c={ops} onChanged={reload} />;
            if (tab === 'risk') return <Risk c={ops} onChanged={reload} />;
            if (tab === 'notify') return <Notify c={ops} onChanged={reload} />;
            return <ReviewsPolicy c={ops} onChanged={reload} />;
          }}
        </OpsStates>
      ) : null}
    </div>
  );
}

/** The proposal bar every editor ends with: reason, optional effective time, Propose. */
function Propose({
  cfgKey,
  section,
  value,
  baseVersion,
  onChanged,
  invalid,
}: {
  cfgKey: string;
  section: string;
  value: unknown;
  baseVersion: number;
  onChanged: () => void;
  invalid?: boolean;
}) {
  const { t } = useT();
  const perms = usePerms();
  const cmd = useOpsCommand();
  const [reason, setReason] = useState('');
  const [when, setWhen] = useState('');
  if (!perms.includes('admin.config.manage'))
    return <p className="dd-caption">{t('s8.cfg.readOnly')}</p>;
  return (
    <div className="dd-stack" style={{ gap: 8 }} data-testid={`cfg-propose-${section}`}>
      {cmd.banner}
      <ReasonField id={`cfg-reason-${section}`} value={reason} onChange={setReason} />
      <Field
        label={t('s9.cfg.effective')}
        htmlFor={`cfg-when-${section}`}
        help={t('s9.cfg.effectiveHelp')}
      >
        <Input
          id={`cfg-when-${section}`}
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </Field>
      <div>
        <Button
          disabled={invalid || !reasonOk(reason) || cmd.busy}
          onClick={() =>
            void cmd.run(
              '/v1/admin/controls/requests',
              {
                key: cfgKey,
                section,
                value,
                baseVersion,
                reason,
                effectiveFrom: when ? new Date(when).toISOString() : null,
              },
              t('s9.cfg.proposed'),
              () => {
                setReason('');
                onChanged();
              },
            )
          }
          data-testid={`cfg-submit-${section}`}
        >
          {t('s9.cfg.propose')}
        </Button>
      </div>
      <p className="dd-caption">{t('s9.cfg.approvalNote')}</p>
    </div>
  );
}

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <Card>
      <div className="dd-stack" style={{ gap: 12 }} data-testid={testId}>
        <h2 className="dd-title-sm">{title}</h2>
        {children}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- requests (maker-checker)
function Requests({
  open,
  recent,
  onChanged,
}: {
  open: ChangeRequest[];
  recent: ChangeRequest[];
  onChanged: () => void;
}) {
  const { t, locale, code } = useT();
  const cmd = useOpsCommand();
  const row = (r: ChangeRequest, decide: boolean) => (
    <Card flat key={r.id}>
      <div className="dd-stack" style={{ gap: 4 }} data-testid={`cfg-req-${r.reference}`}>
        <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <strong>
            <span className="dd-ltr">{r.key}</span> · {r.section}
          </strong>
          <StatusChip
            tone={
              OPS_TONE[r.status] ??
              (r.status === 'SCHEDULED'
                ? 'info'
                : r.status === 'SUPERSEDED' || r.status === 'CANCELLED'
                  ? 'neutral'
                  : 'warning')
            }
          >
            {code('s9.cfg.status', r.status)}
          </StatusChip>
        </div>
        <div className="dd-caption">
          <span className="dd-ltr">{r.reference}</span> · {formatDateTime(locale, r.createdAt)}
          {r.effectiveFrom ? (
            <>
              {' '}
              · {t('s9.cfg.effective')}: {formatDateTime(locale, r.effectiveFrom)}
            </>
          ) : null}
          {r.restoresVersion ? (
            <>
              {' '}
              · {t('s9.cfg.restores')} v{r.restoresVersion}
            </>
          ) : null}
          {r.appliedVersion ? <> · v{r.appliedVersion}</> : null}
        </div>
        <div>{r.reason}</div>
        {r.decisionReason ? <div className="dd-caption">{r.decisionReason}</div> : null}
        {decide && r.status === 'PENDING_APPROVAL' ? (
          <DecisionBar
            id={r.reference}
            canDecide={r.canDecide}
            busy={cmd.busy}
            onDecide={(approve, reason) =>
              void cmd.run(
                `/v1/admin/controls/requests/${r.id}/decide`,
                { decision: approve ? 'APPROVE' : 'REJECT', reason },
                approve ? t('s9.cfg.approved') : t('s9.cfg.rejected'),
                onChanged,
              )
            }
          />
        ) : null}
        {decide && r.canCancel ? (
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void cmd.run(
                  `/v1/admin/controls/requests/${r.id}/cancel`,
                  {},
                  t('s9.cfg.withdrawn'),
                  onChanged,
                )
              }
            >
              {t('s9.cfg.withdraw')}
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
  return (
    <div className="dd-stack" style={{ gap: 10 }} data-testid="cfg-requests">
      {cmd.banner}
      <h2 className="dd-title-sm">{t('s9.cfg.open')}</h2>
      {open.length ? (
        open.map((r) => row(r, true))
      ) : (
        <p className="dd-muted">{t('s9.cfg.noOpen')}</p>
      )}
      <h2 className="dd-title-sm">{t('s9.cfg.recent')}</h2>
      {recent.length ? (
        recent.map((r) => row(r, false))
      ) : (
        <p className="dd-muted">{t('s8.cfg.noHistory')}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- reasons
const REASON_LISTS = ['refund', 'dispute', 'adjustment', 'hold', 'moderation'] as const;
function Reasons({ c, onChanged }: { c: GovernedConfig; onChanged: () => void }) {
  const { t } = useT();
  const value = c.value as Json & {
    reasons: Record<string, Array<{ code: string; en: string; ar: string }>>;
  };
  const [list, setList] = useState<(typeof REASON_LISTS)[number]>('refund');
  const [rows, setRows] = useState(clone(value.reasons[list] ?? []));
  const pick = (l: (typeof REASON_LISTS)[number]) => {
    setList(l);
    setRows(clone(value.reasons[l] ?? []));
  };
  const invalid =
    rows.some((r) => !/^[A-Z][A-Z0-9_]{1,59}$/.test(r.code) || !r.en.trim() || !r.ar.trim()) ||
    new Set(rows.map((r) => r.code)).size !== rows.length ||
    rows.length === 0;
  return (
    <Section title={t('s9.cfg.tab.reasons')} testId="cfg-reasons">
      <Field label={t('s9.cfg.list')} htmlFor="cfg-reason-list">
        <Select
          id="cfg-reason-list"
          value={list}
          onChange={(e) => pick(e.target.value as (typeof REASON_LISTS)[number])}
        >
          {REASON_LISTS.map((l) => (
            <option key={l} value={l}>
              {t(`s9.cfg.reasons.${l}` as never)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="dd-table-wrap">
        <table className="dd-table">
          <thead>
            <tr>
              <th>{t('s8.reasonCode')}</th>
              <th>{t('s9.cfg.labelEn')}</th>
              <th>{t('s9.cfg.labelAr')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <Input
                    aria-label={t('s8.reasonCode')}
                    className="dd-ltr"
                    value={r.code}
                    onChange={(e) =>
                      setRows(
                        rows.map((x, j) =>
                          j === i ? { ...x, code: e.target.value.toUpperCase() } : x,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <Input
                    aria-label={t('s9.cfg.labelEn')}
                    value={r.en}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)))
                    }
                  />
                </td>
                <td>
                  <Input
                    aria-label={t('s9.cfg.labelAr')}
                    dir="rtl"
                    value={r.ar}
                    onChange={(e) =>
                      setRows(rows.map((x, j) => (j === i ? { ...x, ar: e.target.value } : x)))
                    }
                  />
                </td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  >
                    {t('s9.cfg.remove')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setRows([...rows, { code: '', en: '', ar: '' }])}
          data-testid="cfg-reason-add"
        >
          {t('s9.cfg.addReason')}
        </Button>
      </div>
      {invalid ? <p className="dd-caption">{t('s9.cfg.reasonRules')}</p> : null}
      <Propose
        cfgKey="operations"
        section={`reasons.${list}`}
        value={{ ...value, reasons: { ...value.reasons, [list]: rows } }}
        baseVersion={c.version}
        onChanged={onChanged}
        invalid={invalid}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- SLA
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const;
function Sla({ c, onChanged }: { c: GovernedConfig; onChanged: () => void }) {
  const { t, code } = useT();
  const value = c.value as Json & {
    sla: Record<
      string,
      { targetHours: Record<string, number>; warnPct: number; escalation: unknown[] }
    >;
  };
  const areas = Object.keys(value.sla);
  const [area, setArea] = useState(areas[0] ?? 'CASE');
  const [draft, setDraft] = useState(
    () =>
      Object.fromEntries(
        Object.entries(value.sla).map(([a, r]) => [
          a,
          {
            ...Object.fromEntries(PRIORITIES.map((p) => [p, String(r.targetHours[p] ?? '')])),
            warn: String(r.warnPct),
          },
        ]),
      ) as Record<string, Record<string, string>>,
  );
  const d = draft[area] ?? {};
  const invalid =
    PRIORITIES.some((p) => !(num(d[p] ?? '') > 0)) ||
    !(num(d.warn ?? '') >= 1 && num(d.warn ?? '') <= 99);
  const next = {
    ...value,
    sla: {
      ...value.sla,
      [area]: {
        ...value.sla[area]!,
        targetHours: Object.fromEntries(PRIORITIES.map((p) => [p, num(d[p] ?? '')])),
        warnPct: num(d.warn ?? ''),
      },
    },
  };
  return (
    <Section title={t('s9.cfg.tab.sla')} testId="cfg-sla">
      <Field label={t('s8.sla.area')} htmlFor="cfg-sla-area">
        <Select id="cfg-sla-area" value={area} onChange={(e) => setArea(e.target.value)}>
          {areas.map((a) => (
            <option key={a} value={a}>
              {code('s8.slaArea', a)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        {PRIORITIES.map((p) => (
          <Field
            key={p}
            label={`${code('op.priority', p)} (${t('s9.cfg.hours')})`}
            htmlFor={`cfg-sla-${p}`}
          >
            <Input
              id={`cfg-sla-${p}`}
              className="dd-ltr"
              inputMode="decimal"
              value={d[p] ?? ''}
              onChange={(e) => setDraft({ ...draft, [area]: { ...d, [p]: e.target.value } })}
            />
          </Field>
        ))}
        <Field label={t('s9.cfg.warnPct')} htmlFor="cfg-sla-warn">
          <Input
            id="cfg-sla-warn"
            className="dd-ltr"
            inputMode="numeric"
            value={d.warn ?? ''}
            onChange={(e) => setDraft({ ...draft, [area]: { ...d, warn: e.target.value } })}
          />
        </Field>
      </div>
      <Propose
        cfgKey="operations"
        section={`sla.${area}`}
        value={next}
        baseVersion={c.version}
        onChanged={onChanged}
        invalid={invalid}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- approvals and thresholds
function Approvals({ c, onChanged }: { c: GovernedConfig; onChanged: () => void }) {
  const { t, code } = useT();
  type Rule = { mode: string; thresholdMinor: number };
  const value = c.value as Json & {
    caseApprovalAboveMinor: number | null;
    approvals: {
      adjustments: Record<string, Rule>;
      directAdjustmentMaxMinor: number;
      orderRefund: Rule;
      restrictions: Record<string, string>;
    } & Json;
  };
  const [adj, setAdj] = useState(() =>
    Object.fromEntries(
      Object.entries(value.approvals.adjustments).map(([k, r]) => [
        k,
        { mode: r.mode, threshold: String(r.thresholdMinor / 100) },
      ]),
    ),
  );
  const [direct, setDirect] = useState(String(value.approvals.directAdjustmentMaxMinor / 100));
  const [caseAbove, setCaseAbove] = useState(
    value.caseApprovalAboveMinor === null ? '' : String(value.caseApprovalAboveMinor / 100),
  );
  const [restr, setRestr] = useState({ ...value.approvals.restrictions });
  const invalid =
    Object.values(adj).some((r) => r.mode === 'ABOVE_THRESHOLD' && !(num(r.threshold) >= 0)) ||
    !(num(direct) >= 0) ||
    (caseAbove !== '' && !(num(caseAbove) >= 0));
  const next = {
    ...value,
    caseApprovalAboveMinor: caseAbove === '' ? null : Math.round(num(caseAbove) * 100),
    approvals: {
      ...value.approvals,
      adjustments: Object.fromEntries(
        Object.entries(adj).map(([k, r]) => [
          k,
          { mode: r.mode, thresholdMinor: Math.round((num(r.threshold) || 0) * 100) },
        ]),
      ),
      directAdjustmentMaxMinor: Math.round(num(direct) * 100),
      restrictions: restr,
    },
  };
  return (
    <Section title={t('s9.cfg.tab.approvals')} testId="cfg-approvals">
      <div className="dd-table-wrap">
        <table className="dd-table">
          <thead>
            <tr>
              <th>{t('s8.adj.kind')}</th>
              <th>{t('s9.cfg.mode')}</th>
              <th>{t('s9.cfg.threshold')}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(adj).map(([k, r]) => (
              <tr key={k}>
                <td>{code('s8.adjKind', k)}</td>
                <td>
                  <Select
                    aria-label={`${t('s9.cfg.mode')} ${k}`}
                    value={r.mode}
                    onChange={(e) => setAdj({ ...adj, [k]: { ...r, mode: e.target.value } })}
                  >
                    {['ALWAYS', 'ABOVE_THRESHOLD', 'NEVER'].map((m) => (
                      <option key={m} value={m}>
                        {code('s9.cfg.modes', m)}
                      </option>
                    ))}
                  </Select>
                </td>
                <td>
                  <Input
                    aria-label={`${t('s9.cfg.threshold')} ${k}`}
                    className="dd-ltr"
                    inputMode="decimal"
                    disabled={r.mode !== 'ABOVE_THRESHOLD'}
                    value={r.threshold}
                    onChange={(e) => setAdj({ ...adj, [k]: { ...r, threshold: e.target.value } })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        <Field label={t('s9.cfg.directMax')} htmlFor="cfg-direct">
          <Input
            id="cfg-direct"
            className="dd-ltr"
            inputMode="decimal"
            value={direct}
            onChange={(e) => setDirect(e.target.value)}
          />
        </Field>
        <Field
          label={t('s9.cfg.caseAbove')}
          htmlFor="cfg-case-above"
          help={t('s9.cfg.caseAboveHelp')}
        >
          <Input
            id="cfg-case-above"
            className="dd-ltr"
            inputMode="decimal"
            value={caseAbove}
            onChange={(e) => setCaseAbove(e.target.value)}
          />
        </Field>
      </div>
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        {Object.entries(restr).map(([k, m]) => (
          <Field key={k} label={code('s8.rstKind', k)} htmlFor={`cfg-rst-${k}`}>
            <Select
              id={`cfg-rst-${k}`}
              value={m}
              onChange={(e) => setRestr({ ...restr, [k]: e.target.value })}
            >
              {['ALWAYS', 'ABOVE_THRESHOLD', 'NEVER'].map((x) => (
                <option key={x} value={x}>
                  {code('s9.cfg.modes', x)}
                </option>
              ))}
            </Select>
          </Field>
        ))}
      </div>
      <Propose
        cfgKey="operations"
        section="approvals"
        value={next}
        baseVersion={c.version}
        onChanged={onChanged}
        invalid={invalid}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- fraud / risk rules
function Risk({ c, onChanged }: { c: GovernedConfig; onChanged: () => void }) {
  const { t, code } = useT();
  type Rule = { enabled: boolean; threshold: number; windowMinutes: number; decision: string };
  const value = c.value as Json & { risk: { rules: Record<string, Rule> } };
  const [rules, setRules] = useState(() =>
    Object.fromEntries(
      Object.entries(value.risk.rules).map(([k, r]) => [
        k,
        { ...r, threshold: String(r.threshold), windowMinutes: String(r.windowMinutes) },
      ]),
    ),
  );
  const invalid = Object.values(rules).some(
    (r) => !(num(r.threshold) >= 1) || !(num(r.windowMinutes) >= 1),
  );
  const next = {
    ...value,
    risk: {
      rules: Object.fromEntries(
        Object.entries(rules).map(([k, r]) => [
          k,
          {
            enabled: r.enabled,
            decision: r.decision,
            threshold: num(r.threshold),
            windowMinutes: num(r.windowMinutes),
          },
        ]),
      ),
    },
  };
  return (
    <Section title={t('s9.cfg.tab.risk')} testId="cfg-risk">
      <div className="dd-table-wrap">
        <table className="dd-table">
          <thead>
            <tr>
              <th>{t('s9.cfg.rule')}</th>
              <th>{t('s9.cfg.enabled')}</th>
              <th>{t('s9.cfg.threshold')}</th>
              <th>{t('s9.cfg.window')}</th>
              <th>{t('s9.cfg.decision')}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(rules).map(([k, r]) => (
              <tr key={k} data-testid={`cfg-risk-${k}`}>
                <td>{code('s8.rule', k)}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${t('s9.cfg.enabled')} ${k}`}
                    checked={r.enabled}
                    onChange={(e) =>
                      setRules({ ...rules, [k]: { ...r, enabled: e.target.checked } })
                    }
                  />
                </td>
                <td>
                  <Input
                    aria-label={`${t('s9.cfg.threshold')} ${k}`}
                    className="dd-ltr"
                    inputMode="numeric"
                    value={r.threshold}
                    onChange={(e) =>
                      setRules({ ...rules, [k]: { ...r, threshold: e.target.value } })
                    }
                  />
                </td>
                <td>
                  <Input
                    aria-label={`${t('s9.cfg.window')} ${k}`}
                    className="dd-ltr"
                    inputMode="numeric"
                    value={r.windowMinutes}
                    onChange={(e) =>
                      setRules({ ...rules, [k]: { ...r, windowMinutes: e.target.value } })
                    }
                  />
                </td>
                <td>
                  <Select
                    aria-label={`${t('s9.cfg.decision')} ${k}`}
                    value={r.decision}
                    onChange={(e) =>
                      setRules({ ...rules, [k]: { ...r, decision: e.target.value } })
                    }
                  >
                    {['ALLOW', 'FLAG', 'BLOCK'].map((x) => (
                      <option key={x} value={x}>
                        {code('s8.riskDecision', x)}
                      </option>
                    ))}
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Propose
        cfgKey="operations"
        section="risk.rules"
        value={next}
        baseVersion={c.version}
        onChanged={onChanged}
        invalid={invalid}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- notifications and restriction limits
function Notify({ c, onChanged }: { c: GovernedConfig; onChanged: () => void }) {
  const { t, code } = useT();
  const value = c.value as Json & {
    notifications: {
      maxAttempts: number;
      retryMinutes: number[];
      throttlePerUserPerHour?: number;
    } & Json;
    restrictions: { maxDays: Record<string, number> } & Json;
  };
  const [attempts, setAttempts] = useState(String(value.notifications.maxAttempts));
  const [retry, setRetry] = useState(value.notifications.retryMinutes.join(', '));
  const [throttle, setThrottle] = useState(
    String(value.notifications.throttlePerUserPerHour ?? 20),
  );
  const [maxDays, setMaxDays] = useState(() =>
    Object.fromEntries(Object.entries(value.restrictions.maxDays).map(([k, v]) => [k, String(v)])),
  );
  const retryList = retry.split(',').map((x) => num(x));
  const invalid =
    !(num(attempts) >= 1 && num(attempts) <= 10) ||
    retryList.some((x) => !(x >= 1)) ||
    !(num(throttle) >= 1 && num(throttle) <= 500) ||
    Object.values(maxDays).some((v) => !(num(v) >= 1));
  const next = {
    ...value,
    notifications: {
      ...value.notifications,
      maxAttempts: num(attempts),
      retryMinutes: retryList,
      throttlePerUserPerHour: num(throttle),
    },
    restrictions: {
      ...value.restrictions,
      maxDays: Object.fromEntries(Object.entries(maxDays).map(([k, v]) => [k, num(v)])),
    },
  };
  return (
    <Section title={t('s9.cfg.tab.notify')} testId="cfg-notify">
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        <Field label={t('s9.cfg.maxAttempts')} htmlFor="cfg-attempts">
          <Input
            id="cfg-attempts"
            className="dd-ltr"
            inputMode="numeric"
            value={attempts}
            onChange={(e) => setAttempts(e.target.value)}
          />
        </Field>
        <Field label={t('s9.cfg.retryMinutes')} htmlFor="cfg-retry" help={t('s9.cfg.retryHelp')}>
          <Input
            id="cfg-retry"
            className="dd-ltr"
            value={retry}
            onChange={(e) => setRetry(e.target.value)}
          />
        </Field>
        <Field label={t('s9.cfg.throttle')} htmlFor="cfg-throttle">
          <Input
            id="cfg-throttle"
            className="dd-ltr"
            inputMode="numeric"
            value={throttle}
            onChange={(e) => setThrottle(e.target.value)}
          />
        </Field>
      </div>
      <h3 className="dd-title-sm">{t('s9.cfg.maxDays')}</h3>
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        {Object.entries(maxDays).map(([k, v]) => (
          <Field key={k} label={code('s8.rstKind', k)} htmlFor={`cfg-days-${k}`}>
            <Input
              id={`cfg-days-${k}`}
              className="dd-ltr"
              inputMode="numeric"
              value={v}
              onChange={(e) => setMaxDays({ ...maxDays, [k]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <Propose
        cfgKey="operations"
        section="notifications"
        value={next}
        baseVersion={c.version}
        onChanged={onChanged}
        invalid={invalid}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- reviews policy
function ReviewsPolicy({ c, onChanged }: { c: GovernedConfig; onChanged: () => void }) {
  const { t, code } = useT();
  const value = c.value as Json & {
    reviews: {
      mode: string;
      perMerchantDays: number;
      minTextLength: number;
      hideAfterReports: number;
    };
  };
  const [r, setR] = useState({
    mode: value.reviews.mode,
    perMerchantDays: String(value.reviews.perMerchantDays),
    minTextLength: String(value.reviews.minTextLength),
    hideAfterReports: String(value.reviews.hideAfterReports),
  });
  const invalid =
    !(num(r.perMerchantDays) >= 1) ||
    !(num(r.minTextLength) >= 0) ||
    !(num(r.hideAfterReports) >= 1);
  const next = {
    ...value,
    reviews: {
      mode: r.mode,
      perMerchantDays: num(r.perMerchantDays),
      minTextLength: num(r.minTextLength),
      hideAfterReports: num(r.hideAfterReports),
    },
  };
  return (
    <Section title={t('s9.cfg.tab.reviews')} testId="cfg-reviews">
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        <Field label={t('s9.cfg.reviewMode')} htmlFor="cfg-rev-mode">
          <Select
            id="cfg-rev-mode"
            value={r.mode}
            onChange={(e) => setR({ ...r, mode: e.target.value })}
          >
            {['PUBLISH_THEN_MODERATE', 'PRE_MODERATION'].map((m) => (
              <option key={m} value={m}>
                {code('s9.cfg.reviewModes', m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('s9.cfg.perMerchantDays')} htmlFor="cfg-rev-days">
          <Input
            id="cfg-rev-days"
            className="dd-ltr"
            inputMode="numeric"
            value={r.perMerchantDays}
            onChange={(e) => setR({ ...r, perMerchantDays: e.target.value })}
          />
        </Field>
        <Field label={t('s9.cfg.minText')} htmlFor="cfg-rev-min">
          <Input
            id="cfg-rev-min"
            className="dd-ltr"
            inputMode="numeric"
            value={r.minTextLength}
            onChange={(e) => setR({ ...r, minTextLength: e.target.value })}
          />
        </Field>
        <Field label={t('s9.cfg.hideAfter')} htmlFor="cfg-rev-hide">
          <Input
            id="cfg-rev-hide"
            className="dd-ltr"
            inputMode="numeric"
            value={r.hideAfterReports}
            onChange={(e) => setR({ ...r, hideAfterReports: e.target.value })}
          />
        </Field>
      </div>
      <Propose
        cfgKey="operations"
        section="reviews"
        value={next}
        baseVersion={c.version}
        onChanged={onChanged}
        invalid={invalid}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- Watch & Earn instant prizes (FDR-19 guardrails)
function PrizeGuardrails({ c, onChanged }: { c: GovernedConfig; onChanged: () => void }) {
  const { t } = useT();
  const v = c.value as {
    enabled: boolean;
    maxWinProbabilityBps: number;
    maxInventory: number;
    maxPerCustomer: number;
    maxValidityDays: number;
    maxLiabilityMinor: number;
  };
  const [g, setG] = useState({
    enabled: v.enabled,
    pct: String(v.maxWinProbabilityBps / 100),
    inventory: String(v.maxInventory),
    perCustomer: String(v.maxPerCustomer),
    validity: String(v.maxValidityDays),
    liability: String(v.maxLiabilityMinor / 100),
  });
  const next = {
    enabled: g.enabled,
    maxWinProbabilityBps: Math.round(num(g.pct) * 100),
    maxInventory: num(g.inventory),
    maxPerCustomer: num(g.perCustomer),
    maxValidityDays: num(g.validity),
    maxLiabilityMinor: Math.round(num(g.liability) * 100),
  };
  const invalid =
    !(next.maxWinProbabilityBps >= 1 && next.maxWinProbabilityBps <= 10_000) ||
    !(next.maxInventory >= 1) ||
    !(next.maxPerCustomer >= 1 && next.maxPerCustomer <= 10) ||
    !(next.maxValidityDays >= 1 && next.maxValidityDays <= 365) ||
    !(next.maxLiabilityMinor >= 0);
  const field = (key: keyof typeof g, label: string) => (
    <Field label={label} htmlFor={`cfg-prize-${key}`}>
      <Input
        id={`cfg-prize-${key}`}
        className="dd-ltr"
        inputMode="decimal"
        value={String(g[key])}
        onChange={(e) => setG({ ...g, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <Section title={t('s9.cfg.tab.prizes')} testId="cfg-prizes">
      <p className="dd-caption">{t('aprize.intro')}</p>
      <label className="dd-row" style={{ gap: 8 }}>
        <input
          type="checkbox"
          checked={g.enabled}
          onChange={(e) => setG({ ...g, enabled: e.target.checked })}
          data-testid="cfg-prize-enabled"
        />
        <span>{t('aprize.enabled')}</span>
      </label>
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        {field('pct', t('aprize.maxPct'))}
        {field('inventory', t('aprize.maxInventory'))}
        {field('perCustomer', t('aprize.maxPerCustomer'))}
        {field('validity', t('aprize.maxValidity'))}
        {field('liability', t('aprize.maxLiability'))}
      </div>
      <Propose
        cfgKey="watch.prize_guardrails"
        section="prizes"
        value={next}
        baseVersion={c.version}
        onChanged={onChanged}
        invalid={invalid}
      />
    </Section>
  );
}

// ---------------------------------------------------------------- platform controls (redemption, inventory, security, points)
function Platform({ configs, onChanged }: { configs: GovernedConfig[]; onChanged: () => void }) {
  const { t, code } = useT();
  const scalars = configs.filter((c) => c.kind === 'SCALAR');
  const [key, setKey] = useState(scalars[0]?.key ?? '');
  const sel = scalars.find((c) => c.key === key);
  const [v, setV] = useState(String(sel?.value ?? ''));
  const rewards = configs.find((c) => c.key === 'rewards.rules');
  const rv = (rewards?.value ?? {}) as Json & {
    refundReversalRounding?: string;
    negativeBalancePolicy?: string;
  };
  const [rounding, setRounding] = useState(rv.refundReversalRounding ?? 'FLOOR');
  const n = num(v);
  const invalid = !sel || !Number.isInteger(n) || n < (sel.min ?? 0) || n > (sel.max ?? Infinity);
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <Section title={t('s9.cfg.tab.platform')} testId="cfg-platform">
        <Field label={t('s9.cfg.control')} htmlFor="cfg-scalar">
          <Select
            id="cfg-scalar"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setV(String(scalars.find((c) => c.key === e.target.value)?.value ?? ''));
            }}
          >
            {scalars.map((c) => (
              <option key={c.key} value={c.key}>
                {code('s9.cfg.group', c.group ?? '')} · {code('s9.cfg.scalar', c.key)}
              </option>
            ))}
          </Select>
        </Field>
        {sel ? (
          <Field
            label={`${code('s9.cfg.scalar', sel.key)} (${sel.min}–${sel.max})`}
            htmlFor="cfg-scalar-value"
          >
            <Input
              id="cfg-scalar-value"
              className="dd-ltr"
              inputMode="numeric"
              value={v}
              onChange={(e) => setV(e.target.value)}
            />
          </Field>
        ) : null}
        {sel ? (
          <Propose
            cfgKey={sel.key}
            section={sel.key}
            value={n}
            baseVersion={sel.version}
            onChanged={onChanged}
            invalid={invalid}
          />
        ) : null}
      </Section>
      {rewards ? (
        <Section title={t('s9.cfg.pointsRounding')} testId="cfg-points">
          <Field
            label={t('s9.cfg.pointsRounding')}
            htmlFor="cfg-rounding"
            help={t('s9.cfg.pointsRoundingHelp')}
          >
            <Select
              id="cfg-rounding"
              value={rounding}
              onChange={(e) => setRounding(e.target.value)}
            >
              {['FLOOR', 'NEAREST', 'CEIL'].map((x) => (
                <option key={x} value={x}>
                  {code('s9.cfg.rounding', x)}
                </option>
              ))}
            </Select>
          </Field>
          <Propose
            cfgKey="rewards.rules"
            section="refundReversalRounding"
            value={{ ...rv, refundReversalRounding: rounding }}
            baseVersion={rewards.version}
            onChanged={onChanged}
          />
        </Section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- launch controls
interface LaunchValue {
  pilot: {
    mode: 'OPEN' | 'ALLOWLIST';
    merchantOrganizationIds: string[];
    partnerOrganizationIds: string[];
  };
  stops: Record<string, Record<string, boolean>>;
}
function Launch({ c, onChanged }: { c: GovernedConfig; onChanged: () => void }) {
  const { t } = useT();
  const value = c.value as LaunchValue;
  const [mode, setMode] = useState(value.pilot.mode);
  const [merchants, setMerchants] = useState(value.pilot.merchantOrganizationIds.join('\n'));
  const [partners, setPartners] = useState(value.pilot.partnerOrganizationIds.join('\n'));
  const ids = (s: string) =>
    s
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalid = [...ids(merchants), ...ids(partners)].some((x) => !uuid.test(x));
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <Section title={t('s9.launch.pilot')} testId="cfg-pilot">
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('s9.launch.pilotIntro')}
        </p>
        <Field label={t('s9.launch.mode')} htmlFor="cfg-pilot-mode">
          <Select
            id="cfg-pilot-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'OPEN' | 'ALLOWLIST')}
          >
            <option value="OPEN">{t('s9.launch.open')}</option>
            <option value="ALLOWLIST">{t('s9.launch.allowlist')}</option>
          </Select>
        </Field>
        <Field
          label={t('s9.launch.merchants')}
          htmlFor="cfg-pilot-merchants"
          help={t('s9.launch.idsHelp')}
        >
          <textarea
            id="cfg-pilot-merchants"
            className="dd-input dd-textarea dd-ltr"
            rows={3}
            value={merchants}
            onChange={(e) => setMerchants(e.target.value)}
          />
        </Field>
        <Field
          label={t('s9.launch.partners')}
          htmlFor="cfg-pilot-partners"
          help={t('s9.launch.idsHelp')}
        >
          <textarea
            id="cfg-pilot-partners"
            className="dd-input dd-textarea dd-ltr"
            rows={2}
            value={partners}
            onChange={(e) => setPartners(e.target.value)}
          />
        </Field>
        <Propose
          cfgKey="launch.controls"
          section="pilot"
          value={{
            ...value,
            pilot: {
              mode,
              merchantOrganizationIds: ids(merchants),
              partnerOrganizationIds: ids(partners),
            },
          }}
          baseVersion={c.version}
          onChanged={onChanged}
          invalid={invalid}
        />
      </Section>
      <LaunchStops controls={value} onChanged={onChanged} />
    </div>
  );
}

const STOP_ACTIONS = ['NEW_PURCHASES', 'NEW_RESERVATIONS', 'NEW_VIEWS', 'NEW_CAMPAIGNS'] as const;
function LaunchStops({
  controls,
  onChanged,
}: {
  controls: LaunchValue | null;
  onChanged: () => void;
}) {
  const { t, code } = useT();
  const perms = usePerms();
  const cmd = useOpsCommand();
  const [market, setMarket] = useState('SA');
  const [reason, setReason] = useState('');
  const [stops, setStops] = useState(controls?.stops ?? {});
  const can = perms.includes('admin.launch.control');
  const current = stops[market] ?? {};
  const toggle = (action: string, stopped: boolean) =>
    void cmd.run<LaunchValue>(
      '/v1/admin/controls/launch/stops',
      { market, action, stopped, reason },
      stopped ? t('s9.launch.stopped') : t('s9.launch.lifted'),
      (d) => {
        if (d) setStops(d.stops);
        setReason('');
        onChanged();
      },
    );
  return (
    <Section title={t('s9.launch.stops')} testId="cfg-stops">
      <Alert tone="warning">{t('s9.launch.stopsIntro')}</Alert>
      {cmd.banner}
      <Field label={t('s8.market')} htmlFor="cfg-stop-market">
        <Input
          id="cfg-stop-market"
          className="dd-ltr"
          maxLength={2}
          value={market}
          onChange={(e) => setMarket(e.target.value.toUpperCase())}
          style={{ maxWidth: 120 }}
        />
      </Field>
      <div className="dd-row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {STOP_ACTIONS.map((a) => (
          <StatusChip key={a} tone={current[a] ? 'danger' : 'success'}>
            {code('s9.launch.action', a)}:{' '}
            {current[a] ? t('s9.launch.isStopped') : t('s9.launch.isOpen')}
          </StatusChip>
        ))}
      </div>
      {can ? (
        <>
          <ReasonField id="cfg-stop-reason" value={reason} onChange={setReason} />
          <div className="dd-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            {STOP_ACTIONS.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={current[a] ? 'outline' : 'secondary'}
                disabled={!reasonOk(reason) || market.length !== 2 || cmd.busy}
                onClick={() => toggle(a, !current[a])}
                data-testid={`cfg-stop-${a}`}
              >
                {current[a] ? t('s9.launch.lift') : t('s9.launch.stop')} ·{' '}
                {code('s9.launch.action', a)}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <p className="dd-caption">{t('s8.cfg.readOnly')}</p>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- history and rollback
function History({ configs, onChanged }: { configs: GovernedConfig[]; onChanged: () => void }) {
  const { t, locale } = useT();
  const perms = usePerms();
  const [key, setKey] = useState(configs[0]?.key ?? 'operations');
  const res = useResource<
    Array<{ at: string; version: number | null; actorRole: string | null; reason: string | null }>
  >(`/v1/admin/controls/${encodeURIComponent(key)}/history`);
  const cmd = useOpsCommand();
  const [reason, setReason] = useState('');
  const current = configs.find((c) => c.key === key)?.version ?? 0;
  return (
    <Section title={t('s9.cfg.tab.history')} testId="cfg-history-tab">
      <Field label={t('s9.cfg.setting')} htmlFor="cfg-hist-key">
        <Select id="cfg-hist-key" value={key} onChange={(e) => setKey(e.target.value)}>
          {configs.map((c) => (
            <option key={c.key} value={c.key}>
              {c.key} · v{c.version}
            </option>
          ))}
        </Select>
      </Field>
      {cmd.banner}
      {perms.includes('admin.config.manage') ? (
        <ReasonField id="cfg-rollback-reason" value={reason} onChange={setReason} />
      ) : null}
      <OpsStates res={res} empty={(d) => d.length === 0} emptyTitle={t('s8.cfg.noHistory')}>
        {(rows) => (
          <div className="dd-stack" style={{ gap: 6 }}>
            {rows.map((h, i) => (
              <div
                key={i}
                className="dd-row"
                style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}
                data-testid={`cfg-version-${h.version}`}
              >
                <span className="dd-caption">
                  v{h.version} · {formatDateTime(locale, h.at)} · {h.actorRole ?? '-'} ·{' '}
                  {h.reason ?? ''}
                </span>
                {perms.includes('admin.config.manage') &&
                h.version !== null &&
                h.version !== current ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!reasonOk(reason) || cmd.busy}
                    onClick={() =>
                      void cmd.run(
                        `/v1/admin/controls/${encodeURIComponent(key)}/rollback`,
                        { version: h.version, reason },
                        t('s9.cfg.proposed'),
                        onChanged,
                      )
                    }
                  >
                    {t('s9.cfg.rollback')}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </OpsStates>
    </Section>
  );
}
