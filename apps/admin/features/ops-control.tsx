'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CasesPanel, RequirePermission, useApi, useResource } from '@dealdash/app-shell';
import { formatDateTime, formatNumber, withLocale } from '@dealdash/localization';
import { OPS_EXCEPTION_AREAS, type OpsExceptionArea } from '@dealdash/types';
import { Alert, Button, Card, Field, Input, KeyValue, Select, StatusChip, Textarea } from '@dealdash/ui';
import { OPS_TONE, OpsHeader, OpsStates, ReasonField, reasonOk, useOpsCommand, usePerms, useT } from './ops-kit';

// ====================================================================================== cases (shared exception framework)
/** Admin -> Cases: the shared exception / case framework (16 types, configurable lifecycle, SLA, maker-checker resolution). */
export function AdminCasesPage() {
  return (
    <RequirePermission any={['admin.disputes.read']}>
      <Cases />
    </RequirePermission>
  );
}
function Cases() {
  const { t } = useT();
  const perms = usePerms();
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-cases">
      <OpsHeader title={t('s8.cases.title')} intro={t('s8.cases.intro')} />
      <CasesPanel scope={{ audience: 'admin' }} canManage={perms.includes('admin.disputes.manage')} />
    </div>
  );
}

// ====================================================================================== command centre: exceptions with drill-down
interface Exceptions {
  generatedAt: string;
  values: Record<OpsExceptionArea, number>;
  markets: Array<{ market: string | null; openCases: number; breached: number }>;
  businesses: Array<{ organizationId: string | null; nameEn: string | null; nameAr: string | null; openCases: number }>;
}

/** Where each exception area is worked (the screen that resolves it). */
const AREA_ROUTE: Partial<Record<OpsExceptionArea, string>> = {
  PAYMENT_ISSUES: '/cases',
  REDEMPTION_FAILURES: '/fraud',
  VOUCHER_EXCEPTIONS: '/cases',
  WATCH_EXCEPTIONS: '/risk',
  LOYALTY_EXCEPTIONS: '/rewards',
  IMPORT_FAILURES: '/merchants',
  INTEGRATION_FAILURES: '/command-centre',
  SETTLEMENT_EXCEPTIONS: '/settlements',
  RECONCILIATION_EXCEPTIONS: '/reconciliation',
  DISPUTES: '/cases',
  FRAUD_FLAGS: '/fraud',
  OVERDUE_TASKS: '/sla',
  APPROVAL_BACKLOG: '/operations',
  NOTIFICATION_FAILURES: '/notifications',
  UNRESOLVED_SUPPORT: '/support',
};

const DRILL = [
  { key: 'market', label: 's8.drill.MARKET', ltr: true },
  { key: 'legalEntityId', label: 's8.drill.LEGAL_ENTITY', ltr: true },
  { key: 'organizationId', label: 's8.drill.BUSINESS_ACCOUNT', ltr: true },
  { key: 'brandId', label: 's8.drill.BRAND', ltr: true },
  { key: 'city', label: 's8.drill.CITY', ltr: false },
  { key: 'branchId', label: 's8.drill.BRANCH', ltr: true },
  { key: 'product', label: 's8.drill.PRODUCT', ltr: true },
  { key: 'campaignId', label: 's8.drill.CAMPAIGN', ltr: true },
] as const;

/**
 * The exception board: counts per area at the chosen level (Global -> Market -> Legal Entity -> Business Account -> Brand -> City ->
 * Branch -> Product -> Campaign; a transaction is found from the case / reconciliation item it belongs to). Each area links to the
 * screen that resolves it.
 */
export function OpsExceptionsPanel() {
  const { t, locale, code } = useT();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Record<string, string>>({});
  const res = useResource<Exceptions>('/v1/admin/ops/exceptions', filter);
  const level = DRILL.filter((d) => filter[d.key]).map((d) => t(d.label as never));
  return (
    <section className="dd-stack" style={{ gap: 12 }} data-testid="ops-exceptions">
      <h2 className="dd-title">{t('s8.exc.title')}</h2>
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('s8.exc.intro')}
      </p>
      <form
        className="dd-row"
        style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          setFilter(Object.fromEntries(Object.entries(draft).filter(([, v]) => v.trim())));
        }}
      >
        {DRILL.map((d) => (
          <Field key={d.key} label={t(d.label as never)} htmlFor={`exc-${d.key}`}>
            <Input id={`exc-${d.key}`} className={d.ltr ? 'dd-ltr' : undefined} value={draft[d.key] ?? ''} onChange={(e) => setDraft({ ...draft, [d.key]: d.key === 'market' || d.key === 'product' ? e.target.value.toUpperCase() : e.target.value })} style={{ maxWidth: 180 }} />
          </Field>
        ))}
        <Button type="submit" data-testid="exc-apply">
          {t('s8.exc.apply')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setDraft({});
            setFilter({});
          }}
        >
          {t('s8.exc.global')}
        </Button>
      </form>
      <div className="dd-caption" data-testid="exc-level">
        {t('s8.exc.level')}: {level.length ? level.join(' → ') : t('s8.drill.GLOBAL')}
      </div>
      <OpsStates res={res}>
        {(d) => (
          <div className="dd-stack" style={{ gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
              {OPS_EXCEPTION_AREAS.map((a) => {
                const n = d.values[a] ?? 0;
                const href = AREA_ROUTE[a];
                return (
                  <Card flat key={a} data-testid={`exc-${a}`}>
                    <div className="dd-stack" style={{ gap: 4 }}>
                      <span className="dd-muted" style={{ fontSize: 13 }}>
                        {code('s8.exc.area', a)}
                      </span>
                      <strong style={{ fontSize: 20 }}>
                        <StatusChip tone={n === 0 ? 'success' : a === 'FRAUD_FLAGS' || a === 'OVERDUE_TASKS' || a === 'NOTIFICATION_FAILURES' ? 'danger' : 'warning'}>{formatNumber(locale, n)}</StatusChip>
                      </strong>
                      {href && n > 0 ? (
                        <Link href={withLocale(href, locale)} className="dd-caption">
                          {t('s8.exc.work')}
                        </Link>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
            {d.markets.length ? (
              <div className="dd-stack" style={{ gap: 4 }}>
                <h3 className="dd-title-sm">{t('s8.exc.byMarket')}</h3>
                <div className="dd-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  {d.markets.map((m) => (
                    <Button
                      key={m.market ?? 'none'}
                      size="sm"
                      variant="outline"
                      disabled={!m.market}
                      onClick={() => {
                        if (!m.market) return;
                        setDraft({ market: m.market });
                        setFilter({ market: m.market });
                      }}
                      data-testid={`exc-market-${m.market ?? 'none'}`}
                    >
                      <span className="dd-ltr">{m.market ?? '—'}</span> · {m.openCases}
                      {m.breached ? ` · ${t('s8.exc.breached')} ${m.breached}` : ''}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            {d.businesses.length ? (
              <div className="dd-stack" style={{ gap: 4 }}>
                <h3 className="dd-title-sm">{t('s8.exc.byBusiness')}</h3>
                <div className="dd-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  {d.businesses.map((b) => (
                    <Button
                      key={b.organizationId ?? 'none'}
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (!b.organizationId) return;
                        setDraft({ ...filter, organizationId: b.organizationId });
                        setFilter({ ...filter, organizationId: b.organizationId });
                      }}
                    >
                      {(locale === 'ar' ? b.nameAr : b.nameEn) ?? b.organizationId} · {b.openCases}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <p className="dd-caption">
              {t('s8.exc.generated')} {formatDateTime(locale, d.generatedAt)}
            </p>
          </div>
        )}
      </OpsStates>
    </section>
  );
}

// ====================================================================================== SLA / escalation
interface SlaOverview {
  generatedAt: string;
  byArea: Array<{ area: string; open: number; warning: number; breached: number }>;
  items: Array<{ id: string; area: string; subjectType: string; reference: string; state: string; dueAt: string; priority?: string; escalationLevel?: number }>;
}

export function AdminSlaPage() {
  return (
    <RequirePermission any={['admin.operations.read']}>
      <Sla />
    </RequirePermission>
  );
}

function Sla() {
  const { t, locale, code } = useT();
  const res = useResource<SlaOverview>('/v1/admin/ops/sla');
  const cmd = useOpsCommand();
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-sla">
      <OpsHeader
        title={t('s8.sla.title')}
        intro={t('s8.sla.intro')}
        actions={
          <Button variant="outline" disabled={cmd.busy} onClick={() => void cmd.run<{ changes: number }>('/v1/admin/ops/sla/sweep', {}, t('s8.sla.swept'), () => res.reload())} data-testid="sla-sweep">
            {t('s8.sla.sweep')}
          </Button>
        }
      />
      {cmd.banner}
      <OpsStates res={res}>
        {(d) => (
          <div className="dd-stack" style={{ gap: 12 }}>
            {d.byArea.length ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
                {d.byArea.map((a) => (
                  <Card flat key={a.area} data-testid={`sla-area-${a.area}`}>
                    <div className="dd-stack" style={{ gap: 4 }}>
                      <strong>{code('s8.slaArea', a.area)}</strong>
                      <span className="dd-caption">
                        {t('s8.sla.open')}: {a.open}
                      </span>
                      <div className="dd-row" style={{ gap: 6 }}>
                        <StatusChip tone={a.warning ? 'warning' : 'neutral'}>
                          {code('op.sla', 'WARNING')}: {a.warning}
                        </StatusChip>
                        <StatusChip tone={a.breached ? 'danger' : 'neutral'}>
                          {code('op.sla', 'BREACHED')}: {a.breached}
                        </StatusChip>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ) : null}
            {d.items.length === 0 ? (
              <div data-testid="ops-empty">
                <Alert tone="success">{t('s8.sla.allOnTrack')}</Alert>
              </div>
            ) : (
              <div className="dd-table-wrap">
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>{t('s8.reference')}</th>
                      <th>{t('s8.sla.area')}</th>
                      <th>{t('s8.sla.state')}</th>
                      <th>{t('s8.sla.due')}</th>
                      <th>{t('s8.sla.level')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((i) => (
                      <tr key={`${i.subjectType}-${i.id}`} data-testid={`sla-${i.reference}`}>
                        <td className="dd-ltr">{i.reference}</td>
                        <td>{code('s8.slaArea', i.area)}</td>
                        <td>
                          <StatusChip tone={OPS_TONE[i.state] ?? 'neutral'}>{code('op.sla', i.state)}</StatusChip>
                        </td>
                        <td>{formatDateTime(locale, i.dueAt)}</td>
                        <td>{i.escalationLevel ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </OpsStates>
    </div>
  );
}

// ====================================================================================== operational reports
interface Report {
  days: number;
  generatedAt: string;
  cases: { open: number; byType: Record<string, number>; byStatus: Record<string, number>; aging: Record<string, number>; slaBreaches: number };
  refunds: Array<{ status: string; count: number; valueMinor: number }>;
  adjustments: Array<{ kind: string; status: string; count: number; amountMinor: number; points: number }>;
  settlements: Array<{ status: string; count: number; payableMinor: number; paidMinor: number }>;
  reconciliation: Array<{ source: string; status: string; count: number; varianceMinor: number }>;
  fraud: Array<{ domain: string; status: string; count: number }>;
  redemptionFailures: Array<{ result: string; count: number }>;
  paymentFailures: number;
  notificationDeliveries: Array<{ channel: string; status: string; count: number }>;
  integration: { failedRecords: number; failedSyncs: number };
  conflicts: { dataConflicts: number; duplicateSuggestions: number };
}

export function AdminOpsReportsPage() {
  return (
    <RequirePermission any={['admin.operations.read']}>
      <Reports />
    </RequirePermission>
  );
}

function Reports() {
  const { t, locale, code } = useT();
  const { call } = useApi();
  const [days, setDays] = useState('30');
  const res = useResource<Report>('/v1/admin/ops/reports', { days });
  const [csvError, setCsvError] = useState(false);
  const download = async () => {
    setCsvError(false);
    const r = await call<string>('GET', '/v1/admin/ops/reports.csv', { query: { days } });
    if (!r.ok || typeof r.data !== 'string') return setCsvError(true);
    const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `dealdash-operations-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const rows = (items: Array<[string, number | string]>) => items.map(([label, value]) => ({ label, value: typeof value === 'number' ? formatNumber(locale, value) : value }));
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-reports">
      <OpsHeader
        title={t('s8.rep.title')}
        intro={t('s8.rep.intro')}
        actions={
          <>
            <Select aria-label={t('s8.rep.period')} value={days} onChange={(e) => setDays(e.target.value)}>
              {['7', '30', '90', '365'].map((d) => (
                <option key={d} value={d}>
                  {t('s8.rep.days').replace('{n}', d)}
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={() => void download()} data-testid="rep-csv">
              {t('s8.rep.csv')}
            </Button>
          </>
        }
      />
      {csvError ? <Alert tone="danger">{t('s8.state.error')}</Alert> : null}
      <OpsStates res={res}>
        {(r) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
            <Card flat data-testid="rep-cases">
              <h2 className="dd-title-sm">{t('s8.rep.cases')}</h2>
              <KeyValue
                items={rows([
                  [t('s8.rep.open'), r.cases.open],
                  [t('s8.rep.breaches'), r.cases.slaBreaches],
                  [t('s8.rep.aging.lt1d'), r.cases.aging.lt1d ?? 0],
                  [t('s8.rep.aging.d1to3'), r.cases.aging.d1to3 ?? 0],
                  [t('s8.rep.aging.d3to7'), r.cases.aging.d3to7 ?? 0],
                  [t('s8.rep.aging.gt7d'), r.cases.aging.gt7d ?? 0],
                  ...Object.entries(r.cases.byType).map(([k2, v]) => [code('op.dtype', k2), v] as [string, number]),
                ])}
              />
            </Card>
            <Card flat data-testid="rep-money">
              <h2 className="dd-title-sm">{t('s8.rep.money')}</h2>
              <KeyValue
                items={rows([
                  ...r.refunds.map((x) => [`${t('s8.rep.refunds')} · ${code('s8.refStatus', x.status)}`, x.count] as [string, number]),
                  ...r.adjustments.map((x) => [`${code('s8.adjKind', x.kind)} · ${code('s8.adjStatus', x.status)}`, x.count] as [string, number]),
                  ...r.settlements.map((x) => [`${t('s8.rep.settlements')} · ${code('s8.setStatus', x.status)}`, x.count] as [string, number]),
                  [t('s8.rep.paymentFailures'), r.paymentFailures],
                ])}
              />
            </Card>
            <Card flat data-testid="rep-recon">
              <h2 className="dd-title-sm">{t('s8.rep.recon')}</h2>
              <KeyValue items={rows(r.reconciliation.map((x) => [`${code('s8.recSource', x.source)} · ${code('s8.recStatus', x.status)}`, x.count]))} />
            </Card>
            <Card flat data-testid="rep-risk">
              <h2 className="dd-title-sm">{t('s8.rep.risk')}</h2>
              <KeyValue
                items={rows([
                  ...r.fraud.map((x) => [`${code('s8.domain', x.domain)} · ${code('s8.flagStatus', x.status)}`, x.count] as [string, number]),
                  ...r.redemptionFailures.map((x) => [`${t('s8.rep.redemptionFailures')} · ${x.result}`, x.count] as [string, number]),
                ])}
              />
            </Card>
            <Card flat data-testid="rep-delivery">
              <h2 className="dd-title-sm">{t('s8.rep.delivery')}</h2>
              <KeyValue
                items={rows([
                  ...r.notificationDeliveries.map((x) => [`${code('s8.channel', x.channel)} · ${code('s8.dlvStatus', x.status)}`, x.count] as [string, number]),
                  [t('s8.rep.failedRecords'), r.integration.failedRecords],
                  [t('s8.rep.failedSyncs'), r.integration.failedSyncs],
                  [t('s8.rep.dataConflicts'), r.conflicts.dataConflicts],
                  [t('s8.rep.duplicates'), r.conflicts.duplicateSuggestions],
                ])}
              />
            </Card>
          </div>
        )}
      </OpsStates>
      <p className="dd-caption">{t('s8.rep.privacyNote')}</p>
    </div>
  );
}

// ====================================================================================== rules and controls (versioned configuration)
/**
 * Admin -> Rules and controls: the operations configuration (case lifecycle and routing, SLAs and escalation, maker-checker thresholds,
 * reasons, risk rules, restriction limits, notification retries and templates, review policy). Every save is validated, versioned and
 * audited with a reason; history shows who changed what and why. Market law (refunds, tax, retention) is never set here.
 */
export function AdminRulesPage() {
  return (
    <RequirePermission any={['admin.config.read']}>
      <Rules />
    </RequirePermission>
  );
}

function Rules() {
  const { t, locale } = useT();
  const perms = usePerms();
  const canManage = perms.includes('admin.config.manage');
  const res = useResource<{ value: unknown; version: number; updatedAt: string | null }>('/v1/admin/ops/config');
  const history = useResource<Array<{ at: string; actorRole: string | null; reason: string | null; version: number | null }>>('/v1/admin/ops/config/history');
  const cmd = useOpsCommand();
  const [text, setText] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  let parseError: string | null = null;
  if (text !== null) {
    try {
      JSON.parse(text);
    } catch (e) {
      parseError = (e as Error).message;
    }
  }
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-rules">
      <OpsHeader title={t('s8.cfg.title')} intro={t('s8.cfg.intro')} />
      <Alert tone="info">{t('s8.cfg.marketNote')}</Alert>
      {cmd.banner}
      <OpsStates res={res}>
        {(c) => (
          <Card>
            <div className="dd-stack" style={{ gap: 8 }}>
              <div className="dd-caption" data-testid="cfg-version">
                {t('s8.cfg.version')} {c.version} {c.updatedAt ? `· ${formatDateTime(locale, c.updatedAt)}` : ''}
              </div>
              <Field label={t('s8.cfg.value')} htmlFor="cfg-json" help={t('s8.cfg.valueHelp')}>
                <Textarea id="cfg-json" className="dd-ltr" rows={18} readOnly={!canManage} value={text ?? JSON.stringify(c.value, null, 2)} onChange={(e) => setText(e.target.value)} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
              </Field>
              {parseError ? <Alert tone="danger">{parseError}</Alert> : null}
              {canManage ? (
                <>
                  <ReasonField id="cfg-reason" value={reason} onChange={setReason} />
                  <div className="dd-row">
                    <Button
                      disabled={text === null || !!parseError || !reasonOk(reason) || cmd.busy}
                      onClick={() =>
                        void cmd.run('/v1/admin/ops/config', { value: JSON.parse(text ?? '{}'), reason }, t('s8.cfg.saved'), async () => { setText(null); setReason(''); await res.reload(); await history.reload(); }, 'PUT')
                      }
                      data-testid="cfg-save"
                    >
                      {t('s8.cfg.save')}
                    </Button>
                    <Button variant="ghost" disabled={text === null} onClick={() => setText(null)}>
                      {t('s8.cfg.discard')}
                    </Button>
                  </div>
                </>
              ) : (
                <p className="dd-caption">{t('s8.cfg.readOnly')}</p>
              )}
            </div>
          </Card>
        )}
      </OpsStates>
      <OpsStates res={history} empty={(d) => d.length === 0} emptyTitle={t('s8.cfg.noHistory')}>
        {(rows) => (
          <section className="dd-stack" style={{ gap: 4 }} data-testid="cfg-history">
            <h2 className="dd-title-sm">{t('s8.cfg.history')}</h2>
            {rows.map((h, i) => (
              <div key={i} className="dd-caption">
                {formatDateTime(locale, h.at)} · {h.actorRole ?? '-'} {h.version !== null ? `· v${h.version}` : ''} · {h.reason ?? ''}
              </div>
            ))}
          </section>
        )}
      </OpsStates>
    </div>
  );
}
