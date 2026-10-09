'use client';

import { useCallback, useState, type ReactNode } from 'react';
import {
  createTranslator,
  dictionaries,
  formatAmount,
  formatDateTime,
  formatNumber,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import {
  ALERT_CHANNELS,
  ALERT_CODE_KEYS,
  ALERT_FREQUENCIES,
  METRICS,
  TARGET_METRIC_KEYS,
  TIMELINE_KINDS,
  type MetricKey,
} from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  KeyValue,
  LoadingState,
  Select,
  StatusChip,
  Tabs,
} from '@dealdash/ui';
import type { StatusTone } from '@dealdash/ui';
import { useApi, useResource } from '../api';
import { useAuth } from '../auth-context';
import { errorMessage } from '../gates';

// ====================================================================================== shared
const has = (key: string): key is DictionaryKey => key in dictionaries.en;
/** Translated vocabulary with a readable fallback to the code (a code added later as data still shows). */
export function useVisLabel() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  return (prefix: string, value: string | null | undefined) => {
    if (!value) return '-';
    const key = `${prefix}.${value}`;
    return has(key) ? t(key) : value;
  };
}

export const SEVERITY_TONE: Record<string, StatusTone> = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'danger',
};
export const HEALTH_TONE: Record<string, StatusTone> = {
  HEALTHY: 'success',
  DEGRADED: 'warning',
  STALE: 'warning',
  FAILING: 'danger',
  NOT_CONFIGURED: 'neutral',
};
export const TARGET_TONE: Record<string, StatusTone> = {
  NOT_STARTED: 'neutral',
  ON_TRACK: 'success',
  AHEAD: 'success',
  ACHIEVED: 'success',
  AT_RISK: 'warning',
  BEHIND: 'danger',
  MISSED: 'danger',
  ENDED: 'neutral',
};
const STATUS_TONE: Record<string, StatusTone> = {
  OPEN: 'warning',
  ACKNOWLEDGED: 'info',
  RESOLVED: 'success',
  EXPIRED: 'neutral',
};

const PRODUCTS = ['LIVE', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY'] as const;
const BUSINESS_DIMENSIONS = [
  'PRODUCT',
  'CAMPAIGN',
  'BRANCH',
  'DAY',
  'COUNTRY',
  'LEGAL_ENTITY',
  'BRAND',
  'REGION',
  'CITY',
] as const;
const ADMIN_DIMENSIONS = ['ORGANIZATION', ...BUSINESS_DIMENSIONS] as const;
const DEFAULT_REPORT_METRICS: MetricKey[] = [
  'exclusive.verified_redemptions',
  'voucher.redeemed',
  'watch.qualified_views',
  'live.impressions',
];

/** A metric value in its unit (counts, money, basis points, points). */
export function metricValue(locale: Locale, key: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  const unit = (METRICS as Record<string, { unit?: string }>)[key]?.unit;
  if (unit === 'MINOR') return formatAmount(locale, v, 'SAR');
  if (unit === 'BPS') return `${formatNumber(locale, Math.round(v / 10) / 10)}%`;
  return formatNumber(locale, v);
}

function unitValue(
  locale: Locale,
  unit: string,
  v: number | null | undefined,
  currency?: string | null,
) {
  if (v === null || v === undefined) return '-';
  if (unit === 'MINOR') return formatAmount(locale, v, currency ?? 'SAR');
  if (unit === 'BPS') return `${formatNumber(locale, Math.round(v / 10) / 10)}%`;
  return formatNumber(locale, v);
}

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
      ok: string,
      after?: (data: T | null) => void | Promise<void>,
    ) => {
      setBusy(true);
      const r = await call<T>(method, path, { body, idempotent: true });
      setBusy(false);
      if (!r.ok) {
        setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
        return null;
      }
      setBanner({ tone: 'success', text: ok });
      await after?.(r.data);
      return r.data;
    },
    [call, locale],
  );
  const view = banner ? (
    <div data-testid="vis-banner">
      <Alert tone={banner.tone}>{banner.text}</Alert>
    </div>
  ) : null;
  return { run, busy, banner: view };
}

export function VisSection({
  title,
  children,
  testId,
  action,
  note,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
  action?: ReactNode;
  note?: string;
}) {
  return (
    <Card data-testid={testId}>
      <div className="dd-stack" style={{ gap: 12 }}>
        <div
          className="dd-row"
          style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
        >
          <h2 className="dd-title-md" style={{ margin: 0 }}>
            {title}
          </h2>
          {action}
        </div>
        {note ? (
          <p className="dd-muted" style={{ margin: 0 }}>
            {note}
          </p>
        ) : null}
        {children}
      </div>
    </Card>
  );
}

/** Loading / error / permission-denied states shared by every view (a stable top-level component: safe for Fast Refresh). */
function States<T>({
  res,
  children,
  empty,
}: {
  res: { data: T | null; loading: boolean; errors: { code: string; message: string }[] };
  children: (d: T) => ReactNode;
  empty?: (d: T) => boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  if (res.loading && !res.data) return <LoadingState label={t('state.loading')} />;
  if (res.errors.length) {
    const code = res.errors[0]!.code;
    const denied =
      code === 'FORBIDDEN' ||
      code === 'SCOPE_FORBIDDEN' ||
      code === 'ENTITLEMENT_REQUIRED' ||
      code === 'NOT_FOUND';
    return (
      <div data-testid={denied ? 'vis-denied' : 'vis-error'}>
        <Alert
          tone={denied ? 'warning' : 'danger'}
          title={denied ? t('vis.denied') : t('state.error')}
        >
          {errorMessage(locale, res.errors)}
        </Alert>
      </div>
    );
  }
  if (!res.data) return null;
  if (empty?.(res.data)) return <EmptyState title={t('vis.empty')} />;
  return <>{children(res.data)}</>;
}

const iso = (d: Date) => d.toISOString();
const PERIODS = [7, 30, 90] as const;

// ====================================================================================== types
interface Overview {
  from: string;
  to: string;
  asOf: string | null;
  products: Array<{ product: string; entitled: boolean; metrics: Record<string, number | null> }>;
}
interface ReportRow {
  key: string | null;
  /** Bilingual name of the group (branch, business, legal entity ...); null for codes such as a product. */
  label?: { en: string; ar: string } | null;
  metrics: Record<string, number | null>;
}
interface Report {
  groupBy: string;
  rows: ReportRow[];
  totals: Record<string, number | null>;
  asOf?: string | null;
}
export interface TargetView {
  id: string;
  name: string;
  metric: string;
  unit: string;
  currency: string | null;
  product: string | null;
  periodStart: string;
  periodEnd: string;
  target: number;
  actual: number | null;
  expectedToDate: number;
  elapsedBps: number;
  achievementBps: number | null;
  status: string;
  source: string;
  forecast: { value: number | null; label: string; method: string; confidence: string | null };
}
export interface AlertView {
  id: string;
  code: string;
  category: string;
  severity: string;
  status: string;
  product: string | null;
  data: Record<string, unknown>;
  action: string | null;
  actionHref: string | null;
  actionPermission: string | null;
  actionAllowed?: boolean;
  escalationLevel: number;
  createdAt: string;
}
interface RuleView {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
  frequency: string;
  channels: string[];
  recipientRoles: string[];
  threshold: number | null;
  escalation: Array<{ afterMinutes: number; toRoles: string[] }>;
}
interface Preference {
  category: string;
  frequency: string;
  channels: string[];
  muted: boolean;
}

// ====================================================================================== performance (business + DealDash)
export type PerformanceTab = 'overview' | 'report' | 'targets' | 'alerts' | 'rules' | 'preferences';

/**
 * Performance and alerts for one business (merchant or partner) or, with no orgId, DealDash-wide analytics. Every number is read
 * from the governed analytics (backend enforces tenant, role, scope and entitlement); forecasts are always labelled as estimates.
 */
export function PerformanceWorkspace({
  orgId,
  canTargets,
  canAlerts,
  admin,
  initialTab = 'overview',
}: {
  orgId: string | null;
  canTargets: boolean;
  canAlerts: boolean;
  admin?: boolean;
  initialTab?: PerformanceTab;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [tab, setTab] = useState<PerformanceTab>(initialTab);
  const base = orgId ? `/v1/orgs/${orgId}` : '/v1/admin/visibility';
  const tabs: Array<{ id: PerformanceTab; label: string }> = [
    { id: 'overview', label: t('vis.tab.overview') },
    { id: 'report', label: t('vis.tab.report') },
    { id: 'targets', label: t('vis.tab.targets') },
    { id: 'alerts', label: t('vis.tab.alerts') },
    ...(canAlerts ? [{ id: 'rules' as const, label: t('vis.tab.rules') }] : []),
    ...(orgId || admin ? [{ id: 'preferences' as const, label: t('vis.tab.preferences') }] : []),
  ];
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="performance-workspace">
      <h1 className="dd-title-xl">{admin ? t('vis.adminTitle') : t('vis.title')}</h1>
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(v) => setTab(v as PerformanceTab)}
          label={t('vis.title')}
        />
      </div>
      {tab === 'overview' ? <OverviewPanel base={base} admin={!!admin} /> : null}
      {tab === 'report' ? <ReportPanel base={base} admin={!!admin} /> : null}
      {tab === 'targets' ? <TargetsPanel base={base} canManage={canTargets && !!orgId} /> : null}
      {tab === 'alerts' ? <AlertsPanel base={base} /> : null}
      {tab === 'rules' ? <RulesPanel base={base} admin={!!admin} /> : null}
      {tab === 'preferences' ? <PreferencesPanel /> : null}
    </div>
  );
}

function PeriodPicker({ days, onChange }: { days: number; onChange: (d: number) => void }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  return (
    <Select
      aria-label={t('vis.period')}
      value={String(days)}
      onChange={(e) => onChange(Number(e.target.value))}
      data-testid="vis-period"
      style={{ maxWidth: 200 }}
    >
      {PERIODS.map((d) => (
        <option key={d} value={d}>
          {t('vis.lastDays', { days: d })}
        </option>
      ))}
    </Select>
  );
}

function OverviewPanel({ base, admin }: { base: string; admin: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useVisLabel();
  const [days, setDays] = useState(30);
  const [to] = useState(() => new Date());
  const res = useResource<Overview>(admin ? `${base}/overview` : `${base}/performance/overview`, {
    from: iso(new Date(to.getTime() - days * 86_400_000)),
    to: iso(to),
  });
  return (
    <VisSection
      title={t('vis.tab.overview')}
      testId="vis-overview"
      action={<PeriodPicker days={days} onChange={setDays} />}
      note={t('vis.honest')}
    >
      <States res={res} empty={(d) => !d.products.length}>
        {(d) => (
          <div className="dd-stack" style={{ gap: 12 }}>
            <span className="dd-muted" data-testid="vis-asof">
              {t('vis.asOf', { time: d.asOf ? formatDateTime(locale, d.asOf) : '-' })}
            </span>
            <div
              className="dd-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: 12,
              }}
            >
              {d.products.map((p) => (
                <Card key={p.product} flat data-testid={`vis-product-${p.product}`}>
                  <div className="dd-stack" style={{ gap: 8 }}>
                    <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                      <strong>{label('vis.product', p.product)}</strong>
                      {!p.entitled ? (
                        <StatusChip tone="neutral">{t('vis.notEntitled')}</StatusChip>
                      ) : null}
                    </div>
                    <KeyValue
                      items={Object.entries(p.metrics).map(([k, v]) => ({
                        label: label('vis.metric', k),
                        value: metricValue(locale, k, v),
                      }))}
                    />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </States>
    </VisSection>
  );
}

/** Hierarchical drill-down: group by business, country, legal entity, brand, region, city, branch, campaign or day. */
function ReportPanel({ base, admin }: { base: string; admin: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useVisLabel();
  const [groupBy, setGroupBy] = useState<string>(admin ? 'ORGANIZATION' : 'PRODUCT');
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<Record<string, string>>({});
  const [to] = useState(() => new Date());
  const res = useResource<Report>(admin ? `${base}/report` : `${base}/performance/report`, {
    groupBy,
    metrics: DEFAULT_REPORT_METRICS.join(','),
    from: iso(new Date(to.getTime() - days * 86_400_000)),
    to: iso(to),
    ...filter,
  });
  // drilling into a row narrows the next level (business -> legal entity -> branch -> campaign)
  const next: Record<string, { by: string; param: string }> = {
    ORGANIZATION: { by: 'LEGAL_ENTITY', param: 'organizationId' },
    LEGAL_ENTITY: { by: 'BRANCH', param: 'legalEntityId' },
    COUNTRY: { by: 'LEGAL_ENTITY', param: 'country' },
    BRANCH: { by: 'CAMPAIGN', param: 'branchId' },
    PRODUCT: { by: 'CAMPAIGN', param: 'product' },
  };
  const dims = admin ? ADMIN_DIMENSIONS : BUSINESS_DIMENSIONS;
  return (
    <VisSection
      title={t('vis.tab.report')}
      testId="vis-report"
      note={t('vis.reportNote')}
      action={
        <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Select
            aria-label={t('vis.groupBy')}
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            data-testid="vis-groupby"
            style={{ maxWidth: 220 }}
          >
            {dims.map((d) => (
              <option key={d} value={d}>
                {label('vis.dim', d)}
              </option>
            ))}
          </Select>
          <PeriodPicker days={days} onChange={setDays} />
          {Object.keys(filter).length ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFilter({})}
              data-testid="vis-drill-reset"
            >
              {t('vis.clearDrill')}
            </Button>
          ) : null}
        </div>
      }
    >
      {Object.keys(filter).length ? (
        <div className="dd-row" style={{ gap: 6, flexWrap: 'wrap' }} data-testid="vis-breadcrumb">
          {Object.entries(filter).map(([k, v]) => (
            <StatusChip
              key={k}
              tone="info"
            >{`${label('vis.filter', k)}: ${v.length > 12 ? `${v.slice(0, 8)}…` : v}`}</StatusChip>
          ))}
        </div>
      ) : null}
      <States res={res} empty={(d) => !d.rows.length}>
        {(d) => (
          <div style={{ overflowX: 'auto' }}>
            <table className="dd-table" data-testid="vis-report-table">
              <thead>
                <tr>
                  <th>{label('vis.dim', d.groupBy)}</th>
                  {DEFAULT_REPORT_METRICS.map((m) => (
                    <th key={m}>{label('vis.metric', m)}</th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.key ?? 'unassigned'}>
                    <td>
                      {r.label
                        ? locale === 'ar'
                          ? r.label.ar
                          : r.label.en
                        : r.key
                          ? label('vis.product', r.key)
                          : t('vis.unassigned')}
                    </td>
                    {DEFAULT_REPORT_METRICS.map((m) => (
                      <td key={m}>{metricValue(locale, m, r.metrics[m])}</td>
                    ))}
                    <td>
                      {next[d.groupBy] && r.key ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setFilter((f) => ({ ...f, [next[d.groupBy]!.param]: r.key ?? '' }));
                            setGroupBy(next[d.groupBy]!.by);
                          }}
                        >
                          {t('vis.drill')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>{t('vis.total')}</th>
                  {DEFAULT_REPORT_METRICS.map((m) => (
                    <th key={m}>{metricValue(locale, m, d.totals[m])}</th>
                  ))}
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </States>
    </VisSection>
  );
}

// ---------------------------------------------------------------------------------- targets
export function TargetCard({ x }: { x: TargetView }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useVisLabel();
  const pct = Math.min(100, Math.round((x.achievementBps ?? 0) / 100));
  const expectedPct = Math.min(100, Math.round((x.expectedToDate * 100) / Math.max(1, x.target)));
  return (
    <Card flat data-testid={`vis-target-${x.id}`}>
      <div className="dd-stack" style={{ gap: 8 }}>
        <div
          className="dd-row"
          style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
        >
          <strong>{x.name}</strong>
          <div className="dd-row" style={{ gap: 6 }}>
            {x.source === 'AI_DRAFT' ? (
              <StatusChip tone="info">{t('ai.label.HUMAN_APPROVED')}</StatusChip>
            ) : null}
            <StatusChip tone={TARGET_TONE[x.status] ?? 'neutral'}>
              {label('vis.targetStatus', x.status)}
            </StatusChip>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label={x.name}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          style={{
            position: 'relative',
            height: 10,
            borderRadius: 5,
            background: 'var(--dd-color-surface-muted, #eee)',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 5,
              background: 'var(--dd-color-primary, #5B1AFC)',
            }}
          />
          {/* expected-to-date marker */}
          <div
            title={t('vis.expectedToDate')}
            style={{
              position: 'absolute',
              insetInlineStart: `${expectedPct}%`,
              top: -3,
              width: 2,
              height: 16,
              background: 'var(--dd-color-text, #222)',
            }}
          />
        </div>
        <KeyValue
          items={[
            { label: t('vis.metricLabel'), value: label('vis.targetMetric', x.metric) },
            { label: t('vis.target'), value: unitValue(locale, x.unit, x.target, x.currency) },
            { label: t('vis.actual'), value: unitValue(locale, x.unit, x.actual, x.currency) },
            {
              label: t('vis.expectedToDate'),
              value: unitValue(locale, x.unit, x.expectedToDate, x.currency),
            },
            {
              label: t('vis.achievement'),
              value:
                x.achievementBps === null
                  ? '-'
                  : `${formatNumber(locale, Math.round(x.achievementBps / 100))}%`,
            },
            {
              label: t('vis.forecast'),
              value: (
                <span data-testid="vis-forecast">
                  {unitValue(locale, x.unit, x.forecast.value, x.currency)}{' '}
                  <StatusChip tone="warning">{t('vis.forecastLabel')}</StatusChip>
                  {x.forecast.confidence ? (
                    <span className="dd-muted">
                      {' '}
                      · {label('vis.confidence', x.forecast.confidence)}
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              label: t('vis.periodLabel'),
              value: `${formatDateTime(locale, x.periodStart)} – ${formatDateTime(locale, x.periodEnd)}`,
            },
          ]}
        />
      </div>
    </Card>
  );
}

function TargetsPanel({ base, canManage }: { base: string; canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useVisLabel();
  const res = useResource<TargetView[]>(`${base}/targets`);
  const { run, busy, banner } = useCommand();
  const [form, setForm] = useState({
    name: '',
    metric: 'REDEMPTIONS',
    product: '',
    targetValue: '',
    days: '30',
  });
  const create = async () => {
    const start = new Date();
    await run(
      'POST',
      `${base}/targets`,
      {
        name: form.name,
        metric: form.metric,
        product: form.product || undefined,
        targetValue: Number(form.targetValue),
        periodStart: iso(start),
        periodEnd: iso(new Date(start.getTime() + Number(form.days) * 86_400_000)),
      },
      t('vis.targetCreated'),
      () => res.reload(),
    );
  };
  return (
    <VisSection title={t('vis.tab.targets')} testId="vis-targets" note={t('vis.targetsNote')}>
      {banner}
      {canManage ? (
        <Card flat data-testid="vis-target-form">
          <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('vis.targetName')} htmlFor="vt-name">
              <Input
                id="vt-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label={t('vis.metricLabel')} htmlFor="vt-metric">
              <Select
                id="vt-metric"
                value={form.metric}
                onChange={(e) => setForm({ ...form, metric: e.target.value })}
              >
                {TARGET_METRIC_KEYS.map((m) => (
                  <option key={m} value={m}>
                    {label('vis.targetMetric', m)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('vis.productLabel')} htmlFor="vt-product">
              <Select
                id="vt-product"
                value={form.product}
                onChange={(e) => setForm({ ...form, product: e.target.value })}
              >
                <option value="">{t('common.all')}</option>
                {PRODUCTS.map((p) => (
                  <option key={p} value={p}>
                    {label('vis.product', p)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('vis.target')} htmlFor="vt-value">
              <Input
                id="vt-value"
                inputMode="numeric"
                value={form.targetValue}
                onChange={(e) =>
                  setForm({ ...form, targetValue: e.target.value.replace(/\D/g, '') })
                }
              />
            </Field>
            <Field label={t('vis.periodLabel')} htmlFor="vt-days">
              <Select
                id="vt-days"
                value={form.days}
                onChange={(e) => setForm({ ...form, days: e.target.value })}
              >
                {PERIODS.map((d) => (
                  <option key={d} value={d}>
                    {t('vis.nextDays', { days: d })}
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              onClick={() => void create()}
              loading={busy}
              disabled={!form.name.trim() || !form.targetValue}
              data-testid="vis-target-create"
            >
              {t('vis.addTarget')}
            </Button>
          </div>
        </Card>
      ) : null}
      <States res={res} empty={(d) => !d.length}>
        {(d) => (
          <div className="dd-stack" style={{ gap: 8 }}>
            {d.map((x) => (
              <TargetCard key={x.id} x={x} />
            ))}
          </div>
        )}
      </States>
    </VisSection>
  );
}

// ---------------------------------------------------------------------------------- alerts
export function AlertRow({
  a,
  onAction,
}: {
  a: AlertView;
  onAction?: (a: AlertView, s: 'acknowledge' | 'resolve') => void;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useVisLabel();
  const vars = Object.fromEntries(
    Object.entries(a.data ?? {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number'),
  ) as Record<string, string | number>;
  const bodyKey = `vis.alertBody.${a.code}`;
  return (
    <Card flat data-testid={`vis-alert-${a.id}`}>
      <div className="dd-stack" style={{ gap: 6 }}>
        <div
          className="dd-row"
          style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
        >
          <strong>{label('vis.alert', a.code)}</strong>
          <div className="dd-row" style={{ gap: 6 }}>
            <StatusChip tone={SEVERITY_TONE[a.severity] ?? 'neutral'}>
              {label('vis.severity', a.severity)}
            </StatusChip>
            <StatusChip tone={STATUS_TONE[a.status] ?? 'neutral'}>
              {label('vis.alertStatus', a.status)}
            </StatusChip>
            {a.escalationLevel > 0 ? (
              <StatusChip tone="danger">
                {t('vis.escalated', { level: a.escalationLevel })}
              </StatusChip>
            ) : null}
          </div>
        </div>
        {has(bodyKey) ? <span>{createTranslator(locale)(bodyKey, vars)}</span> : null}
        <span className="dd-muted">
          {label('vis.category', a.category)} · {formatDateTime(locale, a.createdAt)}
        </span>
        <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {a.action && a.actionHref ? (
            a.actionAllowed === false ? (
              <span className="dd-muted" data-testid="vis-action-denied">
                {t('vis.actionNeedsPermission', { action: label('vis.action', a.action) })}
              </span>
            ) : (
              <a
                className="dd-btn dd-btn--primary dd-btn--sm"
                href={`/${locale}${a.actionHref}`}
                data-testid="vis-alert-action"
              >
                {label('vis.action', a.action)}
              </a>
            )
          ) : null}
          {onAction && a.status === 'OPEN' ? (
            <Button size="sm" variant="outline" onClick={() => onAction(a, 'acknowledge')}>
              {t('vis.acknowledge')}
            </Button>
          ) : null}
          {onAction && a.status !== 'RESOLVED' && a.status !== 'EXPIRED' ? (
            <Button size="sm" variant="ghost" onClick={() => onAction(a, 'resolve')}>
              {t('vis.resolve')}
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function AlertsPanel({ base }: { base: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [status, setStatus] = useState('OPEN');
  const res = useResource<AlertView[]>(`${base}/alerts`, { status: status || undefined });
  const { run, banner } = useCommand();
  return (
    <VisSection
      title={t('vis.tab.alerts')}
      testId="vis-alerts"
      note={t('vis.alertsNote')}
      action={
        <Select
          aria-label={t('vis.statusLabel')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          <option value="OPEN">{t('vis.alertStatus.OPEN')}</option>
          <option value="ACKNOWLEDGED">{t('vis.alertStatus.ACKNOWLEDGED')}</option>
          <option value="RESOLVED">{t('vis.alertStatus.RESOLVED')}</option>
          <option value="">{t('common.all')}</option>
        </Select>
      }
    >
      {banner}
      <States res={res} empty={(d) => !d.length}>
        {(d) => (
          <div className="dd-stack" style={{ gap: 8 }}>
            {d.map((a) => (
              <AlertRow
                key={a.id}
                a={a}
                onAction={(x, s) =>
                  void run(
                    'POST',
                    `${base}/alerts/${x.id}/${s}`,
                    {},
                    s === 'acknowledge' ? t('vis.acknowledged') : t('vis.resolved'),
                    () => res.reload(),
                  )
                }
              />
            ))}
          </div>
        )}
      </States>
    </VisSection>
  );
}

function RulesPanel({ base, admin }: { base: string; admin: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useVisLabel();
  const res = useResource<RuleView[]>(`${base}/alert-rules`);
  const { run, busy, banner } = useCommand();
  const [form, setForm] = useState<{
    name: string;
    code: string;
    frequency: string;
    channels: string[];
    threshold: string;
    escalateAfter: string;
  }>({
    name: '',
    code: 'BUDGET_PROJECTED_EXHAUST',
    frequency: 'IMMEDIATE',
    channels: ['IN_APP'],
    threshold: '',
    escalateAfter: '',
  });
  const toggle = (c: string) =>
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c],
    }));
  const create = () =>
    run(
      'POST',
      `${base}/alert-rules`,
      {
        name: form.name,
        code: form.code,
        frequency: form.frequency,
        channels: form.channels,
        ...(form.threshold ? { threshold: Number(form.threshold) } : {}),
        ...(form.escalateAfter
          ? {
              escalation: [
                {
                  afterMinutes: Number(form.escalateAfter),
                  toRoles: [admin ? 'DEALDASH_SUPER_ADMIN' : 'MERCHANT_OWNER'],
                },
              ],
            }
          : {}),
      },
      t('vis.ruleCreated'),
      () => res.reload(),
    );
  return (
    <VisSection title={t('vis.tab.rules')} testId="vis-rules" note={t('vis.rulesNote')}>
      {banner}
      <Card flat data-testid="vis-rule-form">
        <div className="dd-stack" style={{ gap: 8 }}>
          <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('vis.ruleName')} htmlFor="vr-name">
              <Input
                id="vr-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label={t('vis.alertType')} htmlFor="vr-code">
              <Select
                id="vr-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              >
                {ALERT_CODE_KEYS.map((c) => (
                  <option key={c} value={c}>
                    {label('vis.alert', c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('vis.frequency')} htmlFor="vr-freq">
              <Select
                id="vr-freq"
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              >
                {ALERT_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {label('vis.freq', f)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('vis.threshold')} htmlFor="vr-th" help={t('vis.thresholdHelp')}>
              <Input
                id="vr-th"
                inputMode="numeric"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label={t('vis.escalateAfter')} htmlFor="vr-esc">
              <Input
                id="vr-esc"
                inputMode="numeric"
                value={form.escalateAfter}
                onChange={(e) =>
                  setForm({ ...form, escalateAfter: e.target.value.replace(/\D/g, '') })
                }
              />
            </Field>
          </div>
          <div
            className="dd-row"
            style={{ gap: 12, flexWrap: 'wrap' }}
            role="group"
            aria-label={t('vis.channels')}
          >
            {ALERT_CHANNELS.map((c) => (
              <Checkbox
                key={c}
                label={label('vis.channel', c)}
                checked={form.channels.includes(c)}
                onChange={() => toggle(c)}
              />
            ))}
          </div>
          <div>
            <Button
              onClick={() => void create()}
              loading={busy}
              disabled={!form.name.trim() || !form.channels.length}
              data-testid="vis-rule-create"
            >
              {t('vis.addRule')}
            </Button>
          </div>
        </div>
      </Card>
      <States res={res} empty={(d) => !d.length}>
        {(d) => (
          <div className="dd-stack" style={{ gap: 8 }}>
            {d.map((r) => (
              <Card flat key={r.id} data-testid={`vis-rule-${r.id}`}>
                <div
                  className="dd-row"
                  style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
                >
                  <div className="dd-stack" style={{ gap: 4 }}>
                    <strong>{r.name}</strong>
                    <span className="dd-muted">
                      {label('vis.alert', r.code)} · {label('vis.freq', r.frequency)} ·{' '}
                      {r.channels.map((c) => label('vis.channel', c)).join(', ')}
                      {r.escalation.length
                        ? ` · ${t('vis.escalatesAfter', { minutes: r.escalation[0]!.afterMinutes })}`
                        : ''}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void run(
                        'PUT',
                        `${base}/alert-rules/${r.id}`,
                        { name: r.name, code: r.code, enabled: !r.enabled },
                        t('common.saved'),
                        () => res.reload(),
                      )
                    }
                  >
                    {r.enabled ? t('vis.disable') : t('vis.enable')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </States>
    </VisSection>
  );
}

const PREF_CATEGORIES = [
  'PERFORMANCE',
  'INVENTORY',
  'FUNDING',
  'FINANCE',
  'COMMERCIAL',
  'INTEGRATION',
  'RISK',
  'SUBSCRIPTION',
  'OPERATIONS',
] as const;

/** How the signed-in person wants each kind of alert: immediately, as a digest, critical only, or muted (avoids alert fatigue). */
export function PreferencesPanel() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useVisLabel();
  const res = useResource<Preference[]>('/v1/me/notification-preferences');
  const { run, banner } = useCommand();
  const save = (p: Preference) =>
    run('PUT', '/v1/me/notification-preferences', p, t('common.saved'), () => res.reload());
  return (
    <VisSection title={t('vis.tab.preferences')} testId="vis-preferences" note={t('vis.prefsNote')}>
      {banner}
      <States res={res}>
        {(d) => (
          <div className="dd-stack" style={{ gap: 8 }}>
            {PREF_CATEGORIES.map((c) => {
              const p = d.find((x) => x.category === c) ?? {
                category: c,
                frequency: 'IMMEDIATE',
                channels: ['IN_APP'],
                muted: false,
              };
              return (
                <Card flat key={c} data-testid={`vis-pref-${c}`}>
                  <div
                    className="dd-row"
                    style={{
                      justifyContent: 'space-between',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <strong>{label('vis.category', c)}</strong>
                    <div
                      className="dd-row"
                      style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
                    >
                      <Select
                        aria-label={t('vis.frequency')}
                        value={p.frequency}
                        onChange={(e) => void save({ ...p, frequency: e.target.value })}
                        style={{ maxWidth: 200 }}
                      >
                        {ALERT_FREQUENCIES.map((f) => (
                          <option key={f} value={f}>
                            {label('vis.freq', f)}
                          </option>
                        ))}
                      </Select>
                      {ALERT_CHANNELS.filter((ch) => ch !== 'TASK_INBOX').map((ch) => (
                        <Checkbox
                          key={ch}
                          label={label('vis.channel', ch)}
                          checked={p.channels.includes(ch)}
                          onChange={() =>
                            void save({
                              ...p,
                              channels: p.channels.includes(ch)
                                ? p.channels.filter((x) => x !== ch)
                                : [...p.channels, ch],
                            })
                          }
                        />
                      ))}
                      <Checkbox
                        label={t('vis.mute')}
                        checked={p.muted}
                        onChange={() => void save({ ...p, muted: !p.muted })}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </States>
    </VisSection>
  );
}

// ====================================================================================== Operations Command Centre (DealDash)
interface Integration {
  family: string;
  state: string;
  adapter: string;
  connections: number;
  lastSuccessAt: string | null;
  detail: Record<string, number>;
}
interface CommandCentre {
  generatedAt: string;
  campaigns: Array<Record<string, number | string>>;
  transactions: {
    windowHours: number;
    payments: { succeeded: number; failed: number; failureRateBps: number | null };
    voucherPurchases: { count: number; valueMinor: number; currency: string };
    redemptions: { exclusive: number; voucher: number; rejected: number };
    rewardAllocations: number;
    pointsIssued: number;
    qualifiedViews: number;
  };
  finance: {
    funding: { receivedMinor: number; utilizedMinor: number; committedMinor: number };
    invoices: Array<{
      currency: string;
      openCount: number;
      openMinor: number;
      overdueCount: number;
      overdueMinor: number;
    }>;
    merchantPayableMinor: number;
    settlementPendingItems: number;
    reconciliationExceptions: number;
    financialHolds: number;
    credit: { limitMinor: number; exposureMinor: number };
    purchaseOrders: { open: number; valueMinor: number; usedMinor: number };
    pendingBillingEvents: number;
  };
  integrations: Integration[];
  risk: Record<string, number | Record<string, number>>;
  alerts: { open: number; critical: number; byCategory: Record<string, number> };
  platform: {
    state: string;
    database: { latencyMs: number };
    jobs: { queued: number; failed24h: number; oldestQueuedAgeSec: number | null };
    analytics: { asOf: string | null; lagSec: number | null };
    process: { uptimeSec: number; rssMb: number };
  };
}

export type CommandCentreTab = 'overview' | 'integrations' | 'alerts' | 'timeline';

export function CommandCentreWorkspace({
  canTimeline,
  canAlerts,
}: {
  canTimeline: boolean;
  canAlerts: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [tab, setTab] = useState<CommandCentreTab>('overview');
  const tabs = [
    { id: 'overview', label: t('cc.tab.overview') },
    { id: 'integrations', label: t('cc.tab.integrations') },
    { id: 'alerts', label: t('vis.tab.alerts') },
    ...(canTimeline ? [{ id: 'timeline', label: t('cc.tab.timeline') }] : []),
  ];
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="command-centre">
      <h1 className="dd-title-xl">{t('cc.title')}</h1>
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(v) => setTab(v as CommandCentreTab)}
          label={t('cc.title')}
        />
      </div>
      {tab === 'overview' ? <CommandOverview /> : null}
      {tab === 'integrations' ? (
        <IntegrationsPanel path="/v1/admin/visibility/integrations" />
      ) : null}
      {tab === 'alerts' ? <AdminAlerts canEvaluate={canAlerts} /> : null}
      {tab === 'timeline' ? <SupportTimeline /> : null}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  testId,
}: {
  label: string;
  value: ReactNode;
  tone?: StatusTone;
  testId?: string;
}) {
  return (
    <Card flat data-testid={testId}>
      <div className="dd-stack" style={{ gap: 4 }}>
        <span className="dd-muted" style={{ fontSize: 13 }}>
          {label}
        </span>
        <strong style={{ fontSize: 20 }}>
          {tone ? <StatusChip tone={tone}>{value}</StatusChip> : value}
        </strong>
      </div>
    </Card>
  );
}

const grid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
} as const;

function CommandOverview() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useVisLabel();
  const res = useResource<CommandCentre>('/v1/admin/visibility/command-centre');
  const money = (m: number, c = 'SAR') => formatAmount(locale, m, c);
  return (
    <States res={res}>
      {(d) => (
        <div className="dd-stack" style={{ gap: 16 }}>
          <div className="dd-row" style={{ justifyContent: 'space-between' }}>
            <span className="dd-muted">
              {t('vis.asOf', { time: formatDateTime(locale, d.generatedAt) })}
            </span>
            <Button size="sm" variant="outline" onClick={() => void res.reload()}>
              {t('cc.refresh')}
            </Button>
          </div>
          <VisSection title={t('cc.campaignHealth')} testId="cc-campaigns">
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table">
                <thead>
                  <tr>
                    <th>{t('vis.productLabel')}</th>
                    {[
                      'live',
                      'pending',
                      'paused',
                      'expiring',
                      'underperforming',
                      'fundingLow',
                      'financialHold',
                      'inventoryExhausted',
                      'suspended',
                    ].map((k) => (
                      <th key={k}>{t(`cc.c.${k}` as DictionaryKey)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.campaigns.map((c) => (
                    <tr key={String(c.product)}>
                      <td>{label('vis.product', String(c.product))}</td>
                      {[
                        'live',
                        'pending',
                        'paused',
                        'expiring',
                        'underperforming',
                        'fundingLow',
                        'financialHold',
                        'inventoryExhausted',
                        'suspended',
                      ].map((k) => (
                        <td key={k}>{formatNumber(locale, Number(c[k] ?? 0))}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </VisSection>
          <VisSection
            title={t('cc.transactionHealth', { hours: d.transactions.windowHours })}
            testId="cc-transactions"
          >
            <div style={grid}>
              <Metric
                label={t('cc.t.paymentsOk')}
                value={formatNumber(locale, d.transactions.payments.succeeded)}
              />
              <Metric
                label={t('cc.t.paymentsFailed')}
                value={formatNumber(locale, d.transactions.payments.failed)}
                tone={d.transactions.payments.failed ? 'warning' : undefined}
              />
              <Metric
                label={t('cc.t.voucherSales')}
                value={money(
                  d.transactions.voucherPurchases.valueMinor,
                  d.transactions.voucherPurchases.currency,
                )}
              />
              <Metric
                label={t('cc.t.exclusiveRedemptions')}
                value={formatNumber(locale, d.transactions.redemptions.exclusive)}
              />
              <Metric
                label={t('cc.t.voucherRedemptions')}
                value={formatNumber(locale, d.transactions.redemptions.voucher)}
              />
              <Metric
                label={t('cc.t.rejected')}
                value={formatNumber(locale, d.transactions.redemptions.rejected)}
              />
              <Metric
                label={t('cc.t.qualifiedViews')}
                value={formatNumber(locale, d.transactions.qualifiedViews)}
              />
              <Metric
                label={t('cc.t.pointsIssued')}
                value={formatNumber(locale, d.transactions.pointsIssued)}
              />
            </div>
          </VisSection>
          <VisSection title={t('cc.financialHealth')} testId="cc-finance">
            <div style={grid}>
              <Metric
                label={t('cc.f.fundingReceived')}
                value={money(d.finance.funding.receivedMinor)}
              />
              <Metric
                label={t('cc.f.fundingUtilized')}
                value={money(d.finance.funding.utilizedMinor)}
              />
              {d.finance.invoices.map((i) => (
                <Metric
                  key={i.currency}
                  label={t('cc.f.overdue', { currency: i.currency })}
                  value={money(i.overdueMinor, i.currency)}
                  tone={i.overdueMinor ? 'danger' : undefined}
                />
              ))}
              <Metric
                label={t('cc.f.merchantPayable')}
                value={money(d.finance.merchantPayableMinor)}
              />
              <Metric
                label={t('cc.f.settlementPending')}
                value={formatNumber(locale, d.finance.settlementPendingItems)}
              />
              <Metric
                label={t('cc.f.reconciliation')}
                value={formatNumber(locale, d.finance.reconciliationExceptions)}
                tone={d.finance.reconciliationExceptions ? 'danger' : undefined}
              />
              <Metric
                label={t('cc.f.holds')}
                value={formatNumber(locale, d.finance.financialHolds)}
              />
              <Metric
                label={t('cc.f.credit')}
                value={`${money(d.finance.credit.exposureMinor)} / ${money(d.finance.credit.limitMinor)}`}
              />
              <Metric
                label={t('cc.f.po')}
                value={`${money(d.finance.purchaseOrders.usedMinor)} / ${money(d.finance.purchaseOrders.valueMinor)}`}
              />
              <Metric
                label={t('cc.f.pendingBilling')}
                value={formatNumber(locale, d.finance.pendingBillingEvents)}
              />
            </div>
          </VisSection>
          <VisSection title={t('cc.integrationHealth')} testId="cc-integrations">
            <IntegrationTable rows={d.integrations} />
          </VisSection>
          <VisSection title={t('cc.riskHealth')} testId="cc-risk">
            <div style={grid}>
              {Object.entries(d.risk)
                .filter(([, v]) => typeof v === 'number')
                .map(([k, v]) => (
                  <Metric
                    key={k}
                    label={label('cc.r', k)}
                    value={formatNumber(locale, v as number)}
                  />
                ))}
            </div>
          </VisSection>
          <VisSection title={t('cc.platformHealth')} testId="cc-platform">
            <div style={grid}>
              <Metric
                label={t('cc.p.state')}
                value={label('vis.health', d.platform.state)}
                tone={HEALTH_TONE[d.platform.state]}
              />
              <Metric
                label={t('cc.p.db')}
                value={t('cc.p.ms', { ms: d.platform.database.latencyMs })}
              />
              <Metric
                label={t('cc.p.jobsQueued')}
                value={formatNumber(locale, d.platform.jobs.queued)}
              />
              <Metric
                label={t('cc.p.jobsFailed')}
                value={formatNumber(locale, d.platform.jobs.failed24h)}
                tone={d.platform.jobs.failed24h ? 'warning' : undefined}
              />
              <Metric
                label={t('cc.p.analyticsLag')}
                value={
                  d.platform.analytics.lagSec === null
                    ? '-'
                    : t('cc.p.sec', { sec: d.platform.analytics.lagSec })
                }
              />
              <Metric
                label={t('cc.alertsOpen')}
                value={`${formatNumber(locale, d.alerts.open)} (${formatNumber(locale, d.alerts.critical)} ${t('vis.severity.CRITICAL')})`}
                tone={d.alerts.critical ? 'danger' : undefined}
              />
            </div>
          </VisSection>
        </div>
      )}
    </States>
  );
}

export function IntegrationTable({ rows }: { rows: Integration[] }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useVisLabel();
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="dd-table" data-testid="integration-table">
        <thead>
          <tr>
            <th>{t('cc.i.family')}</th>
            <th>{t('cc.i.state')}</th>
            <th>{t('cc.i.adapter')}</th>
            <th>{t('cc.i.connections')}</th>
            <th>{t('cc.i.lastSuccess')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.family} data-testid={`integration-${r.family}`}>
              <td>{label('cc.family', r.family)}</td>
              <td>
                <StatusChip tone={HEALTH_TONE[r.state] ?? 'neutral'}>
                  {label('vis.health', r.state)}
                </StatusChip>
              </td>
              <td>{label('cc.adapter', r.adapter)}</td>
              <td>{formatNumber(locale, r.connections)}</td>
              <td>{r.lastSuccessAt ? formatDateTime(locale, r.lastSuccessAt) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Integration monitoring (feed staleness, adapters). Business view uses its own connections only. */
export function IntegrationsPanel({ path }: { path: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const res = useResource<Integration[]>(path);
  return (
    <VisSection
      title={t('cc.integrationHealth')}
      testId="vis-integrations"
      note={t('cc.integrationNote')}
    >
      <States res={res} empty={(d) => !d.length}>
        {(d) => <IntegrationTable rows={d} />}
      </States>
    </VisSection>
  );
}

function AdminAlerts({ canEvaluate }: { canEvaluate: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { run, busy, banner } = useCommand();
  const [key, setKey] = useState(0);
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      {banner}
      {canEvaluate ? (
        <div>
          <Button
            variant="outline"
            loading={busy}
            onClick={() =>
              void run('POST', '/v1/admin/visibility/alerts/evaluate', {}, t('cc.evaluated'), () =>
                setKey((k) => k + 1),
              )
            }
            data-testid="cc-evaluate"
          >
            {t('cc.evaluate')}
          </Button>
        </div>
      ) : null}
      <AlertsPanel key={key} base="/v1/admin/visibility" />
    </div>
  );
}

// ---------------------------------------------------------------------------------- support timeline
interface TimelineItem {
  at: string;
  kind: string;
  event: string;
  reference: string | null;
  status: string | null;
  amountMinor: number | null;
  currency: string | null;
  points: number | null;
}
interface Timeline {
  customer: {
    id: string;
    displayName: string;
    mobileMasked: string | null;
    locale: string;
    status: string;
    since: string;
    lastLoginAt: string | null;
  };
  items: TimelineItem[];
}

/** One customer's journey in one list (support only). Codes and tokens are never shown: references only. */
export function SupportTimeline() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useVisLabel();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [kind, setKind] = useState('');
  const found = useResource<
    Array<{ id: string; displayName: string; mobileMasked: string | null; since: string }>
  >(search ? '/v1/admin/visibility/customers' : null, { q: search });
  const tl = useResource<Timeline>(
    userId ? `/v1/admin/visibility/customers/${userId}/timeline` : null,
    { kinds: kind || undefined },
  );
  return (
    <VisSection title={t('cc.tab.timeline')} testId="support-timeline" note={t('cc.timelineNote')}>
      <form
        className="dd-row"
        style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <Field label={t('cc.findCustomer')} htmlFor="st-q">
          <Input
            id="st-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('cc.findPlaceholder')}
          />
        </Field>
        <Button type="submit" disabled={q.trim().length < 3}>
          {t('cc.search')}
        </Button>
      </form>
      {search ? (
        <States res={found} empty={(d) => !d.length}>
          {(d) => (
            <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {d.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={userId === c.id ? 'primary' : 'outline'}
                  onClick={() => setUserId(c.id)}
                >
                  {c.displayName} {c.mobileMasked ? `· ${c.mobileMasked}` : ''}
                </Button>
              ))}
            </div>
          )}
        </States>
      ) : null}
      {userId ? (
        <States res={tl}>
          {(d) => (
            <div className="dd-stack" style={{ gap: 8 }}>
              <KeyValue
                items={[
                  { label: t('cc.customer'), value: d.customer.displayName },
                  { label: t('cc.mobile'), value: d.customer.mobileMasked ?? '-' },
                  { label: t('cc.since'), value: formatDateTime(locale, d.customer.since) },
                ]}
              />
              <Select
                aria-label={t('cc.kind')}
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                style={{ maxWidth: 240 }}
              >
                <option value="">{t('common.all')}</option>
                {TIMELINE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {label('cc.kind', k)}
                  </option>
                ))}
              </Select>
              {d.items.length ? (
                <ol
                  className="dd-stack"
                  style={{ gap: 6, listStyle: 'none', padding: 0, margin: 0 }}
                  data-testid="timeline-items"
                >
                  {d.items.map((i, n) => (
                    <li
                      key={`${i.at}-${n}`}
                      className="dd-row"
                      style={{ gap: 8, flexWrap: 'wrap' }}
                    >
                      <span className="dd-muted" style={{ minWidth: 150 }}>
                        {formatDateTime(locale, i.at)}
                      </span>
                      <StatusChip tone="info">{label('cc.kind', i.kind)}</StatusChip>
                      <span>{label('cc.event', i.event)}</span>
                      {i.reference ? <code>{i.reference}</code> : null}
                      {i.status ? <span className="dd-muted">{i.status}</span> : null}
                      {i.amountMinor !== null ? (
                        <span>{formatAmount(locale, i.amountMinor, i.currency ?? 'SAR')}</span>
                      ) : null}
                      {i.points !== null ? (
                        <span>{t('cc.points', { points: formatNumber(locale, i.points) })}</span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState title={t('vis.empty')} />
              )}
            </div>
          )}
        </States>
      ) : null}
    </VisSection>
  );
}
