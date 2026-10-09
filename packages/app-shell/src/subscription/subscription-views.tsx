'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { createTranslator, dictionaries, formatAmount, formatDate, formatDateTime, formatNumber, type DictionaryKey, type Locale } from '@dealdash/localization';
import { NEW_EXPOSURE_ACTIONS } from '@dealdash/types';
import { Alert, Button, Card, Checkbox, EmptyState, Field, Input, KeyValue, LoadingState, Select, StatusChip, Tabs, Textarea } from '@dealdash/ui';
import type { StatusTone } from '@dealdash/ui';
import { useApi, useResource } from '../api';
import { useAuth } from '../auth-context';
import { errorMessage } from '../gates';

// ====================================================================================== shared
const has = (key: string): key is DictionaryKey => key in dictionaries.en;
/** A vocabulary label with a safe fallback to the code (a new code configured as data still shows something readable). */
const useLabel = () => {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  return (prefix: string, value: string | null | undefined) => {
    if (!value) return '-';
    const key = `${prefix}.${value}`;
    return has(key) ? t(key) : value;
  };
};

export const LIFECYCLE_TONE: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_ACTIVATION: 'warning',
  TRIAL: 'info',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  SUSPENDED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
  SUPERSEDED: 'neutral',
};
const FIN_TONE: Record<string, StatusTone> = { GOOD_STANDING: 'success', GRACE: 'warning', PAST_DUE: 'warning', FINANCIAL_HOLD: 'danger', SUSPENDED: 'danger' };
const AMEND_TONE: Record<string, StatusTone> = { PROPOSED: 'warning', ACCEPTED: 'info', APPLIED: 'success', REJECTED: 'danger', CANCELLED: 'neutral' };
const VERSION_TONE: Record<string, StatusTone> = { DRAFT: 'neutral', PUBLISHED: 'success', RETIRED: 'neutral' };

const money = (locale: Locale, minor: number | null | undefined, currency: string | null | undefined) =>
  minor === null || minor === undefined ? '-' : formatAmount(locale, minor, currency ?? 'SAR');

/** Runs a command and reports the translated result. */
function useCommand() {
  const { call } = useApi();
  const { locale } = useAuth();
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown, ok: string | ((data: T | null) => string), after?: (data: T | null) => void | Promise<void>) => {
      setBusy(true);
      const r = await call<T>(method, path, { body, idempotent: true });
      setBusy(false);
      if (!r.ok) {
        setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
        return null;
      }
      setBanner({ tone: 'success', text: typeof ok === 'function' ? ok(r.data) : ok });
      await after?.(r.data);
      return r.data;
    },
    [call, locale],
  );
  const view = banner ? (
    <div data-testid="sb-banner">
      <Alert tone={banner.tone}>{banner.text}</Alert>
    </div>
  ) : null;
  return { run, busy, banner: view };
}

function Section({ title, children, testId, action }: { title: string; children: ReactNode; testId?: string; action?: ReactNode }) {
  return (
    <Card data-testid={testId}>
      <div className="dd-stack" style={{ gap: 12 }}>
        <div className="dd-row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <h2 className="dd-title-md" style={{ margin: 0 }}>
            {title}
          </h2>
          {action}
        </div>
        {children}
      </div>
    </Card>
  );
}

function Chips({ items, prefix }: { items: string[]; prefix: string }) {
  const label = useLabel();
  const { locale } = useAuth();
  if (!items.length) return <span className="dd-muted">{createTranslator(locale)('sb.m.none')}</span>;
  return (
    <div className="dd-row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {items.map((x) => (
        <StatusChip key={x} tone="info">
          {label(prefix, x)}
        </StatusChip>
      ))}
    </div>
  );
}

/** A usage meter: used of limit, with a bar that changes tone at the warning thresholds. */
function Meter({ line }: { line: UsageLine }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const pct = line.percent ?? 0;
  const warnAt = Math.min(...(line.warnPercents.length ? line.warnPercents : [80]));
  const tone = line.limit === null ? 'info' : pct >= 100 ? 'danger' : pct >= warnAt ? 'warning' : 'success';
  return (
    <div className="dd-stack" style={{ gap: 4 }} data-testid={`sb-meter-${line.limitKey}`}>
      <div className="dd-row" style={{ justifyContent: 'space-between', gap: 8 }}>
        <strong>{label('sb.limit', line.limitKey)}</strong>
        <span>
          {line.limit === null ? t('sb.m.unlimited') : t('sb.m.usageOf', { used: formatNumber(locale, line.used), limit: formatNumber(locale, line.limit) })}
          {line.period !== 'NONE' ? <span className="dd-muted"> · {label('sb.period', line.period)}</span> : null}
        </span>
      </div>
      {line.limit !== null ? (
        <div
          role="progressbar"
          aria-label={label('sb.limit', line.limitKey)}
          aria-valuemin={0}
          aria-valuemax={line.limit}
          aria-valuenow={line.used}
          style={{ height: 8, borderRadius: 4, background: 'var(--dd-color-surface-muted, #eee)', overflow: 'hidden' }}
        >
          <div
            className={`dd-meter--${tone}`}
            style={{
              width: `${Math.min(100, pct)}%`,
              height: '100%',
              background: tone === 'danger' ? 'var(--dd-color-danger, #c62828)' : tone === 'warning' ? 'var(--dd-color-warning, #b26a00)' : 'var(--dd-color-success, #2e7d32)',
            }}
          />
        </div>
      ) : null}
      <span className="dd-muted" style={{ fontSize: 12 }}>
        {label('sb.mode', line.mode)}
      </span>
    </div>
  );
}

// ====================================================================================== types (API views)
export interface UsageLine {
  limitKey: string;
  metricKey: string;
  kind: 'RESOURCE' | 'PERIOD';
  used: number;
  limit: number | null;
  remaining: number | null;
  percent: number | null;
  mode: string;
  period: string;
  source: string;
  warnPercents: number[];
}
interface Bilingual {
  en: string;
  ar: string;
}
export interface ContractView {
  id: string;
  organizationId: string;
  legalEntityId: string | null;
  billingLegalEntityId: string | null;
  coveredLegalEntityIds: string[];
  name: string | null;
  reference: string | null;
  kind: string;
  status: string;
  renewalState: string;
  market: string | null;
  currency: string | null;
  billingCadence: string;
  version: number;
  planCode: string | null;
  planName: Bilingual | null;
  planVersionId: string | null;
  planVersion: number | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
  pastDueSince: string | null;
  graceUntil: string | null;
  suspendedAt: string | null;
  nextBillingAt: string | null;
  nextRenewalAt: string | null;
  supportLevel: string | null;
  accountManager: string | null;
  pricingVersionKey: string | null;
  developmentFixture: boolean;
  entitlements: Array<{ id: string; kind: string; key: string; enabled: boolean; limitValue: number | null; source: string; mode: string | null; period: string | null; effectiveFrom: string; effectiveUntil: string | null }>;
  addOns: Array<{ id: string; code: string; quantity: number; priceMinor: number; currency: string; cadence: string; status: string; startAt: string; endAt: string | null; autoRenew: boolean }>;
  trial: { id: string; status: string; startAt: string; endAt: string; postTrialPlanCode: string | null } | null;
  promotions: Array<{ id: string; kind: string; itemCode: string; status: string; originalPriceMinor: number | null; promoPriceMinor: number | null; discountBps: number | null; waived: boolean; startAt: string; endAt: string; postPromotion: string }>;
  rates: Array<{ id: string; itemCode: string; version: number; model: string; amountMinor: number | null; rateBps: number | null; discountBps: number | null; waived: boolean; effectiveFrom: string; effectiveUntil: string | null }>;
}
interface Adjustment {
  kind: string;
  ref: string;
  amountMinor?: number;
  bps?: number;
}
export interface SubscriptionSummary {
  source: 'CONTRACT' | 'DEFAULT_PLAN';
  lifecycle: string | null;
  financialStatus: { status: string; reasons: string[]; graceUntil: string | null; contractId: string | null };
  contract: ContractView | null;
  price: { amountMinor: number | null; currency: string; cadence?: string; indicative: boolean; waived: boolean; pricingVersionKey: string; adjustments: Adjustment[] } | null;
  products: string[];
  features: string[];
  limits: Array<{ key: string; value: number | null; mode: string; period: string; source: string; base: number | null; override: number | null; addOns: number }>;
  usage: UsageLine[];
  amendments: Array<{ id: string; type: string; status: string; effectiveAt: string; effectiveMode: string; reason: string | null; forced: boolean; createdAt: string }>;
  previousAgreements: Array<{ id: string; planCode: string | null; status: string; kind: string; effectiveFrom: string; effectiveUntil: string | null }>;
}
interface Impact {
  type: string;
  from: { planCode: string | null; amountMinor: number | null; cadence: string };
  to: { planCode: string | null; amountMinor: number | null; cadence: string; indicative: boolean } | null;
  priceDeltaMinor: number | null;
  currency: string;
  effectiveAt: string;
  effectiveMode: string;
  added: { products: string[]; features: string[] };
  removed: { products: string[]; features: string[] };
  limitChanges: Array<{ key: string; from: number | null; to: number | null }>;
  excess: Array<{ key: string; newLimit: number; current: number; excess: number }>;
  blocked: boolean;
  needsAcceptance: boolean;
  remediation: string[];
}
export interface AmendmentView {
  id: string;
  contractId: string;
  organizationId: string;
  type: string;
  status: string;
  effectiveMode: string;
  effectiveAt: string;
  fromVersion: number;
  reason: string | null;
  forced: boolean;
  requestedByOrg: boolean;
  impact: Impact | null;
  appliedAt: string | null;
  createdAt: string;
}
interface PricePoint {
  cadence: string;
  amountMinor: number;
  indicative?: boolean;
}
export interface PlanRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  entityType: string;
  contractKind: string;
  isFree: boolean;
  negotiated: boolean;
  status: string;
  sortOrder: number;
  current?: boolean;
  versions: Array<{ id: string; market: string; currency: string; version: number; status: string; effectiveFrom: string; effectiveUntil: string | null; prices: PricePoint[]; defaultCadence: string; developmentFixture: boolean }>;
}
interface Terms {
  plan: { code: string | null; nameEn?: string; nameAr?: string; version?: number; market?: string };
  kind: string;
  currency: string;
  basePrice: { amountMinor: number | null; cadence: string; indicative: boolean; pricingVersionKey: string } | null;
  fees: Array<{ code: string; amountMinor: number | null; indicative: boolean }>;
  addOns: Array<{ code: string; quantity: number; unitPriceMinor: number; cadence: string }>;
  maxExposureMinor: number;
  termsVersion: string;
}
interface Decision {
  allowed: boolean;
  protectedAction: boolean;
  checks: Array<{ step: number; code: string; ok: boolean; reason: string | null }>;
  reasons: string[];
  remedies: string[];
}

const planName = (locale: Locale, p: { nameEn: string; nameAr: string } | Bilingual | null | undefined, fallback?: string | null) => {
  if (!p) return fallback ?? '-';
  if ('en' in p) return locale === 'ar' ? p.ar : p.en;
  return locale === 'ar' ? p.nameAr : p.nameEn;
};

/** "PKR 4,999.00 / Monthly", "Free", or "Agreed with DealDash" (an indicative reference is never shown as a charge). */
function priceString(locale: Locale, amountMinor: number | null, currency: string, cadence?: string | null, indicative?: boolean, free?: boolean) {
  const t = createTranslator(locale);
  if (free || amountMinor === 0) return t('sb.m.free');
  // an unpriced, non-billed agreement (no cadence) costs nothing; a priceless billed one is negotiated
  if (amountMinor === null && !indicative && cadence === 'NONE') return t('sb.cadence.NONE');
  if (amountMinor === null || indicative) return t('sb.m.negotiated');
  const amount = money(locale, amountMinor, currency);
  if (!cadence || cadence === 'NONE') return amount;
  const key = `sb.cadence.${cadence}`;
  return t('sb.m.perCadence', { amount, cadence: has(key) ? t(key) : cadence });
}

function PriceText({ amountMinor, currency, cadence, indicative, free }: { amountMinor: number | null; currency: string; cadence?: string | null; indicative?: boolean; free?: boolean }) {
  const { locale } = useAuth();
  return <>{priceString(locale, amountMinor, currency, cadence, indicative, free)}</>;
}

/** The commercial impact of a change, shown before anything is accepted. */
function ImpactView({ impact }: { impact: Impact }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const limitName = (k: string) => label('sb.limit', k);
  const val = (n: number | null) => (n === null ? t('sb.m.unlimited') : formatNumber(locale, n));
  return (
    <div className="dd-stack" style={{ gap: 8 }} data-testid="sb-impact">
      <strong>{t('sb.m.impact')}</strong>
      {impact.to ? <span data-testid="sb-impact-price">{t('sb.m.newPrice', { amount: priceString(locale, impact.to.amountMinor, impact.currency, impact.to.cadence, impact.to.indicative) })}</span> : null}
      {impact.priceDeltaMinor !== null && impact.priceDeltaMinor !== 0 ? (
        <span data-testid="sb-impact-delta">{t('sb.m.priceChange', { amount: `${impact.priceDeltaMinor > 0 ? '+' : '−'}${money(locale, Math.abs(impact.priceDeltaMinor), impact.currency)}` })}</span>
      ) : null}
      <span>
        {t('sb.m.when')}: {label('sb.when', impact.effectiveMode)} · {formatDate(locale, impact.effectiveAt)}
      </span>
      {impact.added.products.length + impact.added.features.length > 0 ? (
        <div className="dd-stack" style={{ gap: 4 }}>
          <span>{t('sb.m.added')}</span>
          <ul style={{ margin: 0 }}>
            {impact.added.products.map((p) => (
              <li key={p}>{label('sb.product', p)}</li>
            ))}
            {impact.added.features.map((f) => (
              <li key={f}>{label('sb.feature', f)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {impact.removed.products.length + impact.removed.features.length > 0 ? (
        <div className="dd-stack" style={{ gap: 4 }}>
          <span>{t('sb.m.removed')}</span>
          <ul style={{ margin: 0 }}>
            {impact.removed.products.map((p) => (
              <li key={p}>{label('sb.product', p)}</li>
            ))}
            {impact.removed.features.map((f) => (
              <li key={f}>{label('sb.feature', f)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {impact.limitChanges.length ? (
        <ul style={{ margin: 0 }}>
          {impact.limitChanges.map((c) => (
            <li key={c.key}>{t('sb.m.limitChange', { name: limitName(c.key), from: val(c.from), to: val(c.to) })}</li>
          ))}
        </ul>
      ) : null}
      {impact.blocked ? (
        <Alert tone="warning">
          <span data-testid="sb-impact-blocked">{t('sb.m.blocked')}</span>
          <ul style={{ margin: '4px 0 0' }}>
            {impact.excess.map((x) => (
              <li key={x.key}>{t('sb.m.excess', { name: limitName(x.key), current: formatNumber(locale, x.current), limit: formatNumber(locale, x.newLimit) })}</li>
            ))}
            {impact.remediation.map((r) => (
              <li key={r}>{label('sb.remedy', r)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}

/** "Why is this unavailable?": the twelve-step decision from the real agreement, usage and financial state. */
function ExplainPanel({ path }: { path: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const { call } = useApi();
  const [action, setAction] = useState<string>('ADD_BRANCH');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = async () => {
    const r = await call<Decision>('GET', `${path}?action=${encodeURIComponent(action)}`);
    if (!r.ok) {
      setError(errorMessage(locale, r.errors));
      return;
    }
    setError(null);
    setDecision(r.data);
  };
  return (
    <div className="dd-stack" style={{ gap: 8 }} data-testid="sb-explain">
      <div className="dd-row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label={t('sb.m.whyAction')} htmlFor="sb-explain-action">
          <Select id="sb-explain-action" value={action} onChange={(e) => setAction(e.target.value)}>
            {NEW_EXPOSURE_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {label('sb.action', a)}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="outline" onClick={() => void check()}>
          {t('sb.m.check')}
        </Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {decision ? (
        <div className="dd-stack" style={{ gap: 6 }}>
          <StatusChip tone={decision.allowed ? 'success' : 'danger'}>{decision.allowed ? t('sb.m.allowed') : t('sb.m.notAllowed')}</StatusChip>
          <ul style={{ margin: 0 }} data-testid="sb-explain-checks">
            {decision.checks.map((c) => (
              <li key={`${c.step}-${c.code}`}>
                <span aria-hidden>{c.ok ? '✓' : '✕'}</span> {label('sb.check', c.code)}
                {c.reason && has(`error.${c.reason}`) ? <span className="dd-muted"> — {t(`error.${c.reason}` as DictionaryKey)}</span> : null}
              </li>
            ))}
          </ul>
          {decision.remedies.length ? (
            <div>
              <strong>{t('sb.m.whatHelps')}</strong>
              <ul style={{ margin: 0 }}>
                {decision.remedies.map((r) => (
                  <li key={r}>{label('sb.remedy', r)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ====================================================================================== merchant: plan and usage
/**
 * The business's own plan: status, price, renewal, usage against the limits, what is included, add-ons, promotions, changes waiting for
 * acceptance, upgrade / downgrade with the impact shown first, plan history, and why something is unavailable. No invoice screens here:
 * invoices, payments and statements belong to Finance (Phase 5).
 */
export function PlanUsageWorkspace({ orgId, canManage, canAccept }: { orgId: string; canManage: boolean; canAccept: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const base = `/v1/orgs/${orgId}/subscription`;
  const summary = useResource<SubscriptionSummary>(base);
  const pending = useResource<{ contract: ContractView; terms: Terms } | null>(`${base}/pending`);
  const amendments = useResource<AmendmentView[]>(`${base}/amendments`);
  const cmd = useCommand();
  const reloadAll = async () => {
    await Promise.all([summary.reload(), pending.reload(), amendments.reload()]);
  };

  if (summary.loading && !summary.data) return <LoadingState label={t('state.loading')} />;
  const s = summary.data;
  if (!s) return <Alert tone="danger">{errorMessage(locale, summary.errors)}</Alert>;
  const c = s.contract;
  const currency = s.price?.currency ?? c?.currency ?? 'SAR';
  const ended = !c && (s.lifecycle === 'CANCELLED' || s.lifecycle === 'EXPIRED');
  const waiting = (amendments.data ?? []).filter((a) => a.status === 'PROPOSED' || a.status === 'ACCEPTED');

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="plan-usage">
      <div>
        <h1 className="dd-title-xl">{t('sb.m.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('sb.m.sub')}
        </p>
      </div>
      {cmd.banner}
      {pending.data ? <PendingAgreement base={base} data={pending.data} canAccept={canAccept} run={cmd.run} busy={cmd.busy} onDone={reloadAll} /> : null}
      {s.source === 'DEFAULT_PLAN' && !ended ? <Alert tone="info">{t('sb.m.defaultPlan')}</Alert> : null}
      {ended ? <Alert tone="warning">{t('sb.m.ended')}</Alert> : null}

      {c ? (
        <Section title={t('sb.m.current')} testId="sb-current">
          <KeyValue
            items={[
              { label: t('sb.a.col.plan'), value: <strong data-testid="sb-plan-name">{planName(locale, c.planName, c.planCode)}</strong> },
              {
                label: t('sb.m.status'),
                value: (
                  <span data-testid="sb-status">
                    <StatusChip tone={LIFECYCLE_TONE[c.status] ?? 'neutral'}>{label('sb.status', c.status)}</StatusChip>
                  </span>
                ),
              },
              {
                label: t('sb.m.price'),
                value: (
                  <span data-testid="sb-price">
                    {c.billingCadence === 'NONE' && (s.price?.amountMinor ?? null) === null ? (
                      label('sb.cadence', 'NONE')
                    ) : s.price ? (
                      <PriceText amountMinor={s.price.amountMinor} currency={currency} cadence={c.billingCadence} indicative={s.price.indicative} />
                    ) : (
                      t('sb.m.negotiated')
                    )}
                    {c.developmentFixture ? (
                      <>
                        {' '}
                        <StatusChip tone="neutral">{t('sb.a.fixture')}</StatusChip>
                      </>
                    ) : null}
                  </span>
                ),
              },
              { label: t('sb.m.renewal'), value: label('sb.renewal', c.renewalState) },
              ...(c.nextRenewalAt ? [{ label: t('sb.m.nextRenewal'), value: formatDate(locale, c.nextRenewalAt) }] : []),
              { label: t('sb.m.since'), value: formatDate(locale, c.effectiveFrom) },
              ...(c.effectiveUntil ? [{ label: t('sb.m.until'), value: formatDate(locale, c.effectiveUntil) }] : []),
              {
                label: t('sb.m.financial'),
                value: (
                  <span data-testid="sb-financial">
                    <StatusChip tone={FIN_TONE[s.financialStatus.status] ?? 'neutral'}>{label('sb.fin', s.financialStatus.status)}</StatusChip>
                  </span>
                ),
              },
            ]}
          />
          {c.trial && c.trial.status === 'ACTIVE' ? (
            <Alert tone="info">
              {t('sb.m.trialUntil', { date: formatDate(locale, c.trial.endAt) })}
              {c.trial.postTrialPlanCode ? ` · ${t('sb.m.trialThen', { plan: c.trial.postTrialPlanCode })}` : ''}
            </Alert>
          ) : null}
          {s.financialStatus.status === 'GRACE' ? (
            <Alert tone="warning">
              {t('sb.m.graceNote')} {s.financialStatus.graceUntil ? t('sb.m.graceUntil', { date: formatDate(locale, s.financialStatus.graceUntil) }) : ''}
            </Alert>
          ) : null}
          {s.financialStatus.status === 'SUSPENDED' || s.financialStatus.status === 'PAST_DUE' ? <Alert tone="danger">{t('sb.m.suspendedNote')}</Alert> : null}
          {s.financialStatus.status === 'FINANCIAL_HOLD' ? <Alert tone="danger">{t('sb.m.holdNote')}</Alert> : null}
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('sb.m.invoicesInFinance')}
          </p>
        </Section>
      ) : null}

      <Section title={t('sb.m.usage')} testId="sb-usage">
        {s.usage.length === 0 ? <EmptyState title={t('sb.m.usageEmpty')} /> : s.usage.map((u) => <Meter key={u.limitKey} line={u} />)}
      </Section>

      <Section title={t('sb.m.included')} testId="sb-included">
        <div className="dd-stack" style={{ gap: 8 }}>
          <strong>{t('sb.m.products')}</strong>
          <Chips items={s.products} prefix="sb.product" />
          <strong>{t('sb.m.features')}</strong>
          <Chips items={s.features} prefix="sb.feature" />
          {s.limits.length ? (
            <>
              <strong>{t('sb.m.limits')}</strong>
              <ul style={{ margin: 0 }} data-testid="sb-limits">
                {s.limits.map((l) => (
                  <li key={l.key}>
                    {label('sb.limit', l.key)}: {l.value === null ? t('sb.m.unlimited') : formatNumber(locale, l.value)}{' '}
                    <span className="dd-muted">
                      ({label('sb.source', l.source)}
                      {l.addOns ? ` · ${t('sb.m.limitDetail', { base: formatNumber(locale, l.override ?? l.base ?? 0), addOns: formatNumber(locale, l.addOns) })}` : ''})
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </Section>

      <div className="dd-grid" style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <Section title={t('sb.m.addOns')} testId="sb-addons">
          {c && c.addOns.filter((a) => a.status === 'ACTIVE').length ? (
            <ul style={{ margin: 0 }}>
              {c.addOns
                .filter((a) => a.status === 'ACTIVE')
                .map((a) => (
                  <li key={a.id}>
                    {t('sb.m.addOnRow', { name: a.code, quantity: formatNumber(locale, a.quantity) })}
                    {a.priceMinor ? ` · ${money(locale, a.priceMinor, a.currency)}` : ''}
                    {a.endAt ? ` · ${t('sb.m.until')} ${formatDate(locale, a.endAt)}` : ''}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="dd-muted" style={{ margin: 0 }}>
              {t('sb.m.addOnsEmpty')}
            </p>
          )}
        </Section>
        <Section title={t('sb.m.promotions')} testId="sb-promotions">
          {s.price?.adjustments.length ? (
            <ul style={{ margin: 0 }}>
              {s.price.adjustments.map((a) => (
                <li key={`${a.kind}-${a.ref}`}>
                  {label('sb.adj', a.kind)}
                  {a.amountMinor !== undefined ? ` · ${money(locale, a.amountMinor, currency)}` : ''}
                  {a.bps !== undefined ? ` · ${formatNumber(locale, a.bps / 100)} %` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="dd-muted" style={{ margin: 0 }}>
              {t('sb.m.promotionsEmpty')}
            </p>
          )}
        </Section>
      </div>

      {waiting.length ? (
        <Section title={t('sb.m.changes')} testId="sb-waiting">
          {waiting.map((a) => (
            <Card key={a.id} flat data-testid={`sb-change-${a.id}`}>
              <div className="dd-stack" style={{ gap: 8 }}>
                <div className="dd-row" style={{ gap: 8 }}>
                  <strong>{label('sb.amend', a.type)}</strong>
                  <StatusChip tone={AMEND_TONE[a.status] ?? 'neutral'}>{label('sb.astatus', a.status)}</StatusChip>
                </div>
                {a.impact ? <ImpactView impact={a.impact} /> : null}
                {a.status === 'PROPOSED' ? (
                  <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    {canAccept ? (
                      <Button
                        disabled={cmd.busy || (!!a.impact?.blocked && a.effectiveMode === 'IMMEDIATE')}
                        onClick={() =>
                          void cmd.run<AmendmentView>(
                            'POST',
                            `${base}/amendments/${a.id}/accept`,
                            { language: locale, confirm: true },
                            (d) => (d?.status === 'APPLIED' ? t('sb.m.changeApplied') : t('sb.m.changeScheduled', { date: formatDate(locale, d?.effectiveAt ?? a.effectiveAt) })),
                            reloadAll,
                          )
                        }
                      >
                        {t('sb.m.acceptChange')}
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button variant="outline" disabled={cmd.busy} onClick={() => void cmd.run('POST', `${base}/amendments/${a.id}/cancel`, { reason: 'Cancelled by the business' }, t('sb.m.changeCancelled'), reloadAll)}>
                        {t('sb.m.cancelChange')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </Section>
      ) : null}

      {c && ['ACTIVE', 'TRIAL', 'PAST_DUE'].includes(c.status) ? <ChangePlan base={base} current={c} canManage={canManage} run={cmd.run} busy={cmd.busy} onDone={reloadAll} /> : null}

      <Section title={t('sb.m.why')} testId="sb-why">
        <ExplainPanel path={`${base}/explain`} />
      </Section>

      <Section title={t('sb.m.history')} testId="sb-history">
        {s.amendments.length === 0 && s.previousAgreements.length === 0 ? (
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('sb.m.historyEmpty')}
          </p>
        ) : (
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('sb.a.col.type')}</th>
                  <th>{t('sb.a.col.status')}</th>
                  <th>{t('sb.a.col.when')}</th>
                </tr>
              </thead>
              <tbody>
                {s.amendments.map((a) => (
                  <tr key={a.id}>
                    <td>{label('sb.amend', a.type)}</td>
                    <td>
                      <StatusChip tone={AMEND_TONE[a.status] ?? 'neutral'}>{label('sb.astatus', a.status)}</StatusChip>
                    </td>
                    <td>{formatDate(locale, a.effectiveAt)}</td>
                  </tr>
                ))}
                {s.previousAgreements.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {t('sb.m.previous')}: {p.planCode ?? label('sb.kind', p.kind)}
                    </td>
                    <td>
                      <StatusChip tone={LIFECYCLE_TONE[p.status] ?? 'neutral'}>{label('sb.status', p.status)}</StatusChip>
                    </td>
                    <td>
                      {formatDate(locale, p.effectiveFrom)}
                      {p.effectiveUntil ? ` – ${formatDate(locale, p.effectiveUntil)}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {c && canManage && c.renewalState !== 'NON_RENEWING' && ['ACTIVE', 'PAST_DUE'].includes(c.status) && c.billingCadence !== 'NONE' ? (
        <StopRenewal base={base} run={cmd.run} busy={cmd.busy} onDone={reloadAll} />
      ) : null}
    </div>
  );
}

type Run = ReturnType<typeof useCommand>['run'];

function PendingAgreement({ base, data, canAccept, run, busy, onDone }: { base: string; data: { contract: ContractView; terms: Terms }; canAccept: boolean; run: Run; busy: boolean; onDone: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const [confirm, setConfirm] = useState(false);
  const { terms } = data;
  return (
    <Card data-testid="sb-pending">
      <div className="dd-stack" style={{ gap: 10 }}>
        <h2 className="dd-title-md" style={{ margin: 0 }}>
          {t('sb.m.pending')}
        </h2>
        <p style={{ margin: 0 }}>{t('sb.m.pendingBody')}</p>
        <KeyValue
          items={[
            { label: t('sb.a.col.plan'), value: planName(locale, terms.plan.nameEn ? { nameEn: terms.plan.nameEn, nameAr: terms.plan.nameAr ?? terms.plan.nameEn } : null, terms.plan.code) },
            { label: t('sb.a.col.kind'), value: label('sb.kind', terms.kind) },
            {
              label: t('sb.m.price'),
              value: terms.basePrice ? <PriceText amountMinor={terms.basePrice.amountMinor} currency={terms.currency} cadence={terms.basePrice.cadence} indicative={terms.basePrice.indicative} /> : t('sb.m.negotiated'),
            },
            ...terms.fees.map((f) => ({ label: label('sb.event', f.code), value: f.indicative || f.amountMinor === null ? t('sb.m.negotiated') : money(locale, f.amountMinor, terms.currency) })),
          ]}
        />
        <strong data-testid="sb-max-exposure">{t('sb.m.maxExposure', { amount: money(locale, terms.maxExposureMinor, terms.currency) })}</strong>
        {canAccept ? (
          <>
            <Checkbox checked={confirm} onChange={(e) => setConfirm(e.target.checked)} label={t('sb.m.confirm')} />
            <div>
              <Button disabled={!confirm || busy} onClick={() => void run('POST', `${base}/accept`, { language: locale, confirm: true }, t('sb.m.accepted'), onDone)}>
                {t('sb.m.accept')}
              </Button>
            </div>
          </>
        ) : (
          <Alert tone="info">{t('sb.m.cannotAccept')}</Alert>
        )}
      </div>
    </Card>
  );
}

function ChangePlan({ base, current, canManage, run, busy, onDone }: { base: string; current: ContractView; canManage: boolean; run: Run; busy: boolean; onDone: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const plans = useResource<PlanRow[]>(`${base}/plans`);
  const [target, setTarget] = useState<string | null>(null);
  const [mode, setMode] = useState<'IMMEDIATE' | 'NEXT_BILLING_CYCLE'>('IMMEDIATE');
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = (plans.data ?? []).filter((p) => p.versions.length > 0);
  const currentOrder = (plans.data ?? []).find((p) => p.current)?.sortOrder ?? 0;
  const typeFor = (p: PlanRow) => (p.sortOrder > currentOrder ? 'UPGRADE' : 'DOWNGRADE');
  const preview = async (p: PlanRow, m = mode) => {
    setTarget(p.code);
    const r = await call<Impact>('POST', `${base}/preview`, { body: { type: typeFor(p), targetPlanCode: p.code, effectiveMode: m } });
    if (!r.ok) {
      setImpact(null);
      setError(errorMessage(locale, r.errors));
      return;
    }
    setError(null);
    setImpact(r.data);
  };
  const chosen = rows.find((p) => p.code === target) ?? null;
  return (
    <Section title={t('sb.m.change')} testId="sb-change">
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('sb.m.changeNote')}
      </p>
      {plans.loading && !plans.data ? <LoadingState label={t('state.loading')} /> : null}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} data-testid="sb-plans">
        {rows.map((p) => {
          const v = p.versions[0]!;
          const pp = v.prices.find((x) => x.cadence === v.defaultCadence) ?? v.prices[0];
          return (
            <Card key={p.code} flat data-testid={`sb-plan-${p.code}`}>
              <div className="dd-stack" style={{ gap: 6 }}>
                <strong>{planName(locale, p)}</strong>
                <span>{pp ? <PriceText amountMinor={pp.amountMinor} currency={v.currency} cadence={pp.cadence} indicative={pp.indicative} /> : p.isFree ? t('sb.m.free') : t('sb.m.negotiated')}</span>
                {p.current || p.code === current.planCode ? (
                  <StatusChip tone="success">{t('sb.m.yourPlan')}</StatusChip>
                ) : p.negotiated ? (
                  <span className="dd-muted">{t('sb.remedy.CONTACT_DEALDASH')}</span>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => void preview(p)}>
                    {t('sb.m.preview')}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {chosen && impact ? (
        <Card flat>
          <div className="dd-stack" style={{ gap: 10 }}>
            <strong>
              {t(impact.type === 'UPGRADE' ? 'sb.m.upgrade' : 'sb.m.downgrade')}: {planName(locale, chosen)}
            </strong>
            <Field label={t('sb.m.when')} htmlFor="sb-mode">
              <Select
                id="sb-mode"
                value={mode}
                onChange={(e) => {
                  const m = e.target.value as typeof mode;
                  setMode(m);
                  void preview(chosen, m);
                }}
              >
                <option value="IMMEDIATE">{t('sb.when.IMMEDIATE')}</option>
                <option value="NEXT_BILLING_CYCLE">{t('sb.when.NEXT_BILLING_CYCLE')}</option>
              </Select>
            </Field>
            <ImpactView impact={impact} />
            {canManage ? (
              <div>
                <Button
                  disabled={busy || (impact.blocked && mode === 'IMMEDIATE')}
                  onClick={() =>
                    void run('POST', `${base}/amendments`, { type: impact.type, targetPlanCode: chosen.code, effectiveMode: mode }, t('sb.m.requested'), async () => {
                      setImpact(null);
                      setTarget(null);
                      await onDone();
                    })
                  }
                >
                  {t('sb.m.request')}
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </Section>
  );
}

function StopRenewal({ base, run, busy, onDone }: { base: string; run: Run; busy: boolean; onDone: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <Section title={t('sb.m.stopRenewal')} testId="sb-stop">
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('sb.m.stopRenewalNote')}
      </p>
      {open ? (
        <div className="dd-stack" style={{ gap: 8 }}>
          <Field label={t('sb.m.reason')} htmlFor="sb-stop-reason">
            <Textarea id="sb-stop-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </Field>
          <div>
            <Button variant="outline" disabled={busy || reason.trim().length < 3} onClick={() => void run('POST', `${base}/stop-renewal`, { reason }, t('sb.m.stopped'), onDone)}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            {t('sb.m.stopRenewal')}
          </Button>
        </div>
      )}
    </Section>
  );
}

// ====================================================================================== admin workspace
export type SubscriptionAdminTab = 'agreements' | 'catalog' | 'priceBook' | 'addOns' | 'amendments' | 'billing' | 'signals' | 'readiness';
const AS = '/v1/admin/subscriptions';

/**
 * DealDash Admin: plans, versions and country prices, the price book, add-ons, every agreement (enterprise ones included), lifecycle,
 * amendments, promotions and negotiated rates, the billing hooks handed to Finance, the signals waiting for Phase 4, and readiness.
 * Every change is data (no release). Publishing, cancelling, rates and promotions need the approve permission and a second person.
 */
export function SubscriptionAdminWorkspace({ canManage, canApprove }: { canManage: boolean; canApprove: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [tab, setTab] = useState<SubscriptionAdminTab>('agreements');
  const tabs: SubscriptionAdminTab[] = ['agreements', 'catalog', 'priceBook', 'addOns', 'amendments', 'billing', 'signals', 'readiness'];
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="subscriptions-admin">
      <div>
        <h1 className="dd-title-xl">{t('sb.a.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('sb.a.sub')}
        </p>
      </div>
      <Tabs label={t('sb.a.title')} value={tab} onChange={(id) => setTab(id as SubscriptionAdminTab)} tabs={tabs.map((id) => ({ id, label: t(`sb.a.tab.${id}` as DictionaryKey) }))} />
      {tab === 'agreements' ? <AgreementsPanel canManage={canManage} canApprove={canApprove} /> : null}
      {tab === 'catalog' ? <CatalogPanel canManage={canManage} canApprove={canApprove} /> : null}
      {tab === 'priceBook' ? <PriceBookPanel canManage={canManage} canApprove={canApprove} /> : null}
      {tab === 'addOns' ? <AddOnsPanel /> : null}
      {tab === 'amendments' ? <AmendmentsPanel canManage={canManage} canApprove={canApprove} /> : null}
      {tab === 'billing' ? <BillingEventsPanel /> : null}
      {tab === 'signals' ? <SignalsPanel /> : null}
      {tab === 'readiness' ? <ReadinessPanel canManage={canManage} /> : null}
    </div>
  );
}

interface ContractRow {
  id: string;
  organizationId: string;
  organization: Bilingual | null;
  name: string | null;
  kind: string;
  status: string;
  planCode: string | null;
  market: string | null;
  currency: string | null;
  billingCadence: string;
  renewalState: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  nextRenewalAt: string | null;
  developmentFixture: boolean;
}

function AgreementsPanel({ canManage, canApprove }: { canManage: boolean; canApprove: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const list = useResource<ContractRow[]>(`${AS}/contracts`, { kind: kind || undefined, status: status || undefined });
  if (open) return <AgreementDetail id={open} canManage={canManage} canApprove={canApprove} onBack={() => setOpen(null)} />;
  const rows = list.data ?? [];
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sb-agreements">
      <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Select aria-label={t('sb.a.col.kind')} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t('sb.a.all')}</option>
          {['MERCHANT_SUBSCRIPTION', 'MERCHANT_ENTERPRISE', 'BANK_ENTERPRISE', 'SCHEME_NETWORK_LICENCE', 'CORPORATE_PARTNER', 'CUSTOM_ENTERPRISE'].map((k) => (
            <option key={k} value={k}>
              {label('sb.kind', k)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('sb.a.col.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('sb.a.all')}</option>
          {['PENDING_ACTIVATION', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED'].map((k) => (
            <option key={k} value={k}>
              {label('sb.status', k)}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={() => void list.reload()}>
          {t('sb.a.refresh')}
        </Button>
      </div>
      {canManage ? <AssignForm onDone={list.reload} /> : null}
      {list.loading && !list.data ? (
        <LoadingState label={t('state.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('sb.a.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('sb.a.col.org')}</th>
                <th>{t('sb.a.col.kind')}</th>
                <th>{t('sb.a.col.plan')}</th>
                <th>{t('sb.a.col.status')}</th>
                <th>{t('sb.a.col.cadence')}</th>
                <th>{t('sb.a.col.renewal')}</th>
                <th>{t('sb.a.col.from')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`sb-row-${r.id}`}>
                  <td>
                    <button type="button" className="dd-link" onClick={() => setOpen(r.id)}>
                      {r.organization ? (locale === 'ar' ? r.organization.ar : r.organization.en) : r.organizationId}
                    </button>
                    {r.developmentFixture ? (
                      <>
                        {' '}
                        <StatusChip tone="neutral">{t('sb.a.fixture')}</StatusChip>
                      </>
                    ) : null}
                  </td>
                  <td>{label('sb.kind', r.kind)}</td>
                  <td>{r.planCode ?? '-'}</td>
                  <td>
                    <StatusChip tone={LIFECYCLE_TONE[r.status] ?? 'neutral'}>{label('sb.status', r.status)}</StatusChip>
                  </td>
                  <td>{label('sb.cadence', r.billingCadence)}</td>
                  <td>{label('sb.renewal', r.renewalState)}</td>
                  <td>{formatDate(locale, r.effectiveFrom)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AssignForm({ onDone }: { onDone: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const plans = useResource<PlanRow[]>(`${AS}/plans`);
  const cmd = useCommand();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ organizationId: '', planCode: '', market: 'PK', trialDays: '', postTrial: '' });
  if (!open)
    return (
      <div>
        <Button variant="outline" onClick={() => setOpen(true)}>
          {t('sb.a.assign')}
        </Button>
      </div>
    );
  const submit = () =>
    void cmd.run(
      'POST',
      `${AS}/contracts/assign`,
      {
        organizationId: f.organizationId.trim(),
        planCode: f.planCode,
        market: f.market.trim() || undefined,
        trial: f.trialDays ? { days: Number(f.trialDays), postTrialPlanCode: f.postTrial || null } : null,
      },
      t('sb.a.assigned'),
      onDone,
    );
  return (
    <Card flat data-testid="sb-assign">
      <div className="dd-stack" style={{ gap: 8 }}>
        {cmd.banner}
        <Field label={t('sb.a.orgId')} htmlFor="sb-assign-org">
          <Input id="sb-assign-org" value={f.organizationId} onChange={(e) => setF({ ...f, organizationId: e.target.value })} />
        </Field>
        <Field label={t('sb.a.planCode')} htmlFor="sb-assign-plan">
          <Select id="sb-assign-plan" value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })}>
            <option value="">-</option>
            {(plans.data ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {planName(locale, p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('sb.a.marketCode')} htmlFor="sb-assign-market">
          <Input id="sb-assign-market" value={f.market} maxLength={2} onChange={(e) => setF({ ...f, market: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t('sb.a.trialDays')} htmlFor="sb-assign-trial">
          <Input id="sb-assign-trial" inputMode="numeric" value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value.replace(/\D/g, '') })} />
        </Field>
        {f.trialDays ? (
          <Field label={t('sb.a.postTrial')} htmlFor="sb-assign-post">
            <Select id="sb-assign-post" value={f.postTrial} onChange={(e) => setF({ ...f, postTrial: e.target.value })}>
              <option value="">-</option>
              {(plans.data ?? []).map((p) => (
                <option key={p.code} value={p.code}>
                  {planName(locale, p)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <div className="dd-row" style={{ gap: 8 }}>
          <Button disabled={cmd.busy || !f.organizationId || !f.planCode} onClick={submit}>
            {t('sb.a.assign')}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

interface AcceptanceRow {
  id: string;
  reference: string;
  userRole: string;
  userName: string | null;
  onBehalf: boolean;
  pricingVersionKey: string | null;
  currency: string;
  acceptedAmountMinor: number | null;
  maxExposureMinor: number | null;
  billingCadence: string;
  createdAt: string;
}

function AgreementDetail({ id, canManage, canApprove, onBack }: { id: string; canManage: boolean; canApprove: boolean; onBack: () => void }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const c = useResource<ContractView>(`${AS}/contracts/${id}`);
  const terms = useResource<Terms>(`${AS}/contracts/${id}/terms`);
  const accs = useResource<AcceptanceRow[]>(`${AS}/contracts/${id}/acceptances`);
  const org = useResource<SubscriptionSummary>(c.data ? `${AS}/organizations/${c.data.organizationId}` : null);
  const cmd = useCommand();
  const [reason, setReason] = useState('');
  const reload = async () => {
    await Promise.all([c.reload(), terms.reload(), accs.reload(), org.reload()]);
  };
  if (!c.data) return <LoadingState label={t('state.loading')} />;
  const k = c.data;
  const currency = k.currency ?? 'SAR';
  const enterprise = k.kind !== 'MERCHANT_SUBSCRIPTION';
  const life = (action: 'past-due' | 'suspend' | 'reinstate' | 'cancel', text: string, tone: 'primary' | 'outline' = 'outline', need: boolean = canManage) =>
    need ? (
      <Button variant={tone === 'primary' ? undefined : 'outline'} size="sm" disabled={cmd.busy || reason.trim().length < 3} onClick={() => void cmd.run('POST', `${AS}/contracts/${id}/${action}`, { reason }, t('sb.a.done'), reload)} data-testid={`sb-life-${action}`}>
        {text}
      </Button>
    ) : null;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="sb-agreement">
      <div>
        <Button variant="outline" size="sm" onClick={onBack}>
          {t('sb.a.back')}
        </Button>
      </div>
      {cmd.banner}
      <Section title={enterprise ? t('sb.a.enterprise') : t('sb.a.agreement')} testId="sb-agreement-head">
        <KeyValue
          items={[
            { label: t('sb.a.col.kind'), value: label('sb.kind', k.kind) },
            { label: t('sb.a.col.plan'), value: `${planName(locale, k.planName, k.planCode)}${k.planVersion ? ` · v${k.planVersion}` : ''}` },
            { label: t('sb.a.col.status'), value: <StatusChip tone={LIFECYCLE_TONE[k.status] ?? 'neutral'}>{label('sb.status', k.status)}</StatusChip> },
            { label: t('sb.a.version'), value: formatNumber(locale, k.version) },
            { label: t('sb.a.col.market'), value: `${k.market ?? '-'} · ${currency}` },
            { label: t('sb.a.col.cadence'), value: label('sb.cadence', k.billingCadence) },
            { label: t('sb.a.col.renewal'), value: label('sb.renewal', k.renewalState) },
            { label: t('sb.a.col.from'), value: formatDate(locale, k.effectiveFrom) },
            ...(k.effectiveUntil ? [{ label: t('sb.a.col.until'), value: formatDate(locale, k.effectiveUntil) }] : []),
            { label: t('sb.a.businessAccount'), value: k.organizationId },
            { label: t('sb.a.billingParty'), value: k.billingLegalEntityId ?? k.legalEntityId ?? '-' },
            ...(k.coveredLegalEntityIds.length ? [{ label: t('sb.a.covered'), value: k.coveredLegalEntityIds.join(', ') }] : []),
            ...(k.accountManager ? [{ label: t('sb.a.accountManager'), value: k.accountManager }] : []),
            ...(k.supportLevel ? [{ label: t('sb.a.support'), value: k.supportLevel }] : []),
            ...(org.data ? [{ label: t('sb.m.financial'), value: <StatusChip tone={FIN_TONE[org.data.financialStatus.status] ?? 'neutral'}>{label('sb.fin', org.data.financialStatus.status)}</StatusChip> }] : []),
          ]}
        />
      </Section>

      {terms.data ? (
        <Section title={t('sb.a.terms')} testId="sb-terms">
          <KeyValue
            items={[
              { label: t('sb.m.price'), value: terms.data.basePrice ? <PriceText amountMinor={terms.data.basePrice.amountMinor} currency={terms.data.currency} cadence={terms.data.basePrice.cadence} indicative={terms.data.basePrice.indicative} /> : '-' },
              ...(terms.data.basePrice ? [{ label: t('sb.a.col.key'), value: <code>{terms.data.basePrice.pricingVersionKey}</code> }] : []),
              ...terms.data.fees.map((f) => ({ label: label('sb.event', f.code), value: f.indicative || f.amountMinor === null ? t('sb.a.indicative') : money(locale, f.amountMinor, terms.data!.currency) })),
            ]}
          />
        </Section>
      ) : null}

      {org.data ? (
        <Section title={t('sb.m.usage')} testId="sb-admin-usage">
          {org.data.usage.length ? org.data.usage.map((u) => <Meter key={u.limitKey} line={u} />) : <p className="dd-muted">{t('sb.m.usageEmpty')}</p>}
        </Section>
      ) : null}

      <Section title={t('sb.a.lifecycle')} testId="sb-lifecycle">
        <Alert tone="info">{t('sb.a.suspendNote')}</Alert>
        <Field label={t('sb.a.reason')} htmlFor="sb-life-reason">
          <Input id="sb-life-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {k.status === 'ACTIVE' ? life('past-due', t('sb.a.pastDue')) : null}
          {['ACTIVE', 'PAST_DUE', 'TRIAL'].includes(k.status) ? life('suspend', t('sb.a.suspend')) : null}
          {['PAST_DUE', 'SUSPENDED'].includes(k.status) ? life('reinstate', t('sb.a.reinstate')) : null}
          {!['CANCELLED', 'EXPIRED', 'SUPERSEDED'].includes(k.status) ? life('cancel', t('sb.a.cancel'), 'outline', canApprove) : null}
          {canManage && k.status === 'PENDING_ACTIVATION' ? (
            <Button size="sm" disabled={cmd.busy} onClick={() => void cmd.run('POST', `${AS}/contracts/${id}/accept-on-behalf`, { language: locale, confirm: true, approvalRef: reason || undefined }, t('sb.a.done'), reload)}>
              {t('sb.a.acceptOnBehalf')}
            </Button>
          ) : null}
          {canManage && ['ACTIVE', 'PAST_DUE'].includes(k.status) && k.billingCadence !== 'NONE' ? (
            <Button variant="outline" size="sm" disabled={cmd.busy} onClick={() => void cmd.run('POST', `${AS}/contracts/${id}/renew`, {}, t('sb.a.done'), reload)}>
              {t('sb.a.renew')}
            </Button>
          ) : null}
        </div>
        {canManage ? (
          <Field label={t('sb.a.setRenewal')} htmlFor="sb-renewal">
            <Select id="sb-renewal" value={k.renewalState} onChange={(e) => void cmd.run('POST', `${AS}/contracts/${id}/renewal-state`, { renewalState: e.target.value, reason: reason || undefined }, t('sb.a.done'), reload)}>
              {['AUTO_RENEW', 'MANUAL_RENEWAL', 'NON_RENEWING', 'RENEWAL_PENDING'].map((r) => (
                <option key={r} value={r}>
                  {label('sb.renewal', r)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </Section>

      <Section title={t('sb.a.entitlements')} testId="sb-entitlements">
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('sb.a.col.type')}</th>
                <th>{t('sb.a.col.code')}</th>
                <th>{t('sb.a.col.amount')}</th>
                <th>{t('sb.a.col.from')}</th>
                <th>{t('sb.a.col.until')}</th>
              </tr>
            </thead>
            <tbody>
              {k.entitlements.map((e) => (
                <tr key={e.id} style={e.effectiveUntil ? { opacity: 0.6 } : undefined}>
                  <td>{label('sb.source', e.source)}</td>
                  <td>{e.kind === 'LIMIT' ? label('sb.limit', e.key) : e.kind === 'FEATURE' ? label('sb.feature', e.key) : label('sb.product', e.key)}</td>
                  <td>{e.kind === 'LIMIT' ? (e.limitValue === null ? t('sb.m.unlimited') : formatNumber(locale, e.limitValue)) : e.enabled ? '✓' : '✕'}</td>
                  <td>{formatDate(locale, e.effectiveFrom)}</td>
                  <td>{e.effectiveUntil ? formatDate(locale, e.effectiveUntil) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t('sb.a.rates')} testId="sb-rates">
        {k.rates.length ? (
          <ul style={{ margin: 0 }}>
            {k.rates.map((r) => (
              <li key={r.id}>
                <code>{r.itemCode}</code> v{r.version} · {r.amountMinor !== null ? money(locale, r.amountMinor, currency) : r.rateBps !== null ? `${formatNumber(locale, r.rateBps / 100)} %` : '-'}
                {r.discountBps ? ` · ${label('sb.adj', 'DISCOUNT')} ${formatNumber(locale, r.discountBps / 100)} %` : ''}
                {r.waived ? ` · ${t('sb.a.waived')}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('sb.a.empty')}
          </p>
        )}
        {canApprove ? <RateForm contractId={id} onDone={reload} /> : null}
      </Section>

      <Section title={t('sb.a.promotions')} testId="sb-promos">
        {k.promotions.length ? (
          <ul style={{ margin: 0 }}>
            {k.promotions.map((p) => (
              <li key={p.id}>
                {label('sb.pkind', p.kind)} · <code>{p.itemCode}</code> · {formatDate(locale, p.startAt)} – {formatDate(locale, p.endAt)} · {label('sb.post', p.postPromotion)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('sb.a.empty')}
          </p>
        )}
        {canApprove ? <PromotionForm contractId={id} onDone={reload} /> : null}
      </Section>

      <ContractAmendments contractId={id} canManage={canManage} canApprove={canApprove} onChanged={reload} />

      <Section title={t('sb.a.acceptances')} testId="sb-acceptances">
        {(accs.data ?? []).length ? (
          <ul style={{ margin: 0 }}>
            {(accs.data ?? []).map((a) => (
              <li key={a.id}>
                <code>{a.reference}</code> · {t('sb.a.acceptedBy', { name: a.userName ?? '-', role: a.userRole })}
                {a.onBehalf ? ` · ${t('sb.a.onBehalf')}` : ''} · {money(locale, a.acceptedAmountMinor, a.currency)} · {formatDateTime(locale, a.createdAt)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('sb.a.empty')}
          </p>
        )}
      </Section>

      <Section title={t('sb.a.explain')}>
        <ExplainPanel path={`${AS}/organizations/${k.organizationId}/explain`} />
      </Section>
    </div>
  );
}

function RateForm({ contractId, onDone }: { contractId: string; onDone: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const cmd = useCommand();
  const [f, setF] = useState({ itemCode: 'SUBSCRIPTION', amountMinor: '', discountBps: '', waived: false, approvalRef: '' });
  return (
    <Card flat data-testid="sb-rate-form">
      <div className="dd-stack" style={{ gap: 8 }}>
        <strong>{t('sb.a.addRate')}</strong>
        {cmd.banner}
        <Field label={t('sb.a.itemCode')} htmlFor="sb-rate-item">
          <Input id="sb-rate-item" value={f.itemCode} onChange={(e) => setF({ ...f, itemCode: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t('sb.a.amountMinor')} htmlFor="sb-rate-amount">
          <Input id="sb-rate-amount" inputMode="numeric" value={f.amountMinor} onChange={(e) => setF({ ...f, amountMinor: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label={t('sb.a.discountBps')} htmlFor="sb-rate-disc">
          <Input id="sb-rate-disc" inputMode="numeric" value={f.discountBps} onChange={(e) => setF({ ...f, discountBps: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Checkbox checked={f.waived} onChange={(e) => setF({ ...f, waived: e.target.checked })} label={t('sb.a.waived')} />
        <Field label={t('sb.a.approvalRef')} htmlFor="sb-rate-ref">
          <Input id="sb-rate-ref" value={f.approvalRef} onChange={(e) => setF({ ...f, approvalRef: e.target.value })} />
        </Field>
        <div>
          <Button
            disabled={cmd.busy || !f.itemCode}
            onClick={() =>
              void cmd.run(
                'POST',
                `${AS}/contracts/${contractId}/rates`,
                { itemCode: f.itemCode, model: 'FIXED', amountMinor: f.amountMinor ? Number(f.amountMinor) : null, discountBps: f.discountBps ? Number(f.discountBps) : null, waived: f.waived, approvalRef: f.approvalRef || undefined },
                t('sb.a.done'),
                onDone,
              )
            }
          >
            {t('sb.a.addRate')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PromotionForm({ contractId, onDone }: { contractId: string; onDone: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const cmd = useCommand();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ kind: 'PROMOTIONAL_PRICE', itemCode: 'SUBSCRIPTION', promoPriceMinor: '', startAt: today, endAt: '', postPromotion: 'REVERT_TO_STANDARD', approvalRef: '' });
  return (
    <Card flat data-testid="sb-promo-form">
      <div className="dd-stack" style={{ gap: 8 }}>
        <strong>{t('sb.a.addPromotion')}</strong>
        {cmd.banner}
        <Field label={t('sb.a.promoKind')} htmlFor="sb-promo-kind">
          <Select id="sb-promo-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {['FREE_ONBOARDING', 'PROMOTIONAL_PRICE', 'SETUP_WAIVER', 'CAMPAIGN_CREDIT', 'TEMPORARY_UPGRADE', 'ENTERPRISE_TRIAL'].map((x) => (
              <option key={x} value={x}>
                {label('sb.pkind', x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('sb.a.itemCode')} htmlFor="sb-promo-item">
          <Input id="sb-promo-item" value={f.itemCode} onChange={(e) => setF({ ...f, itemCode: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t('sb.a.promoPrice')} htmlFor="sb-promo-price">
          <Input id="sb-promo-price" inputMode="numeric" value={f.promoPriceMinor} onChange={(e) => setF({ ...f, promoPriceMinor: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label={t('sb.a.startAt')} htmlFor="sb-promo-start">
          <Input id="sb-promo-start" type="date" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} />
        </Field>
        <Field label={t('sb.a.endAt')} htmlFor="sb-promo-end">
          <Input id="sb-promo-end" type="date" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} />
        </Field>
        <Field label={t('sb.a.after')} htmlFor="sb-promo-post">
          <Select id="sb-promo-post" value={f.postPromotion} onChange={(e) => setF({ ...f, postPromotion: e.target.value })}>
            {['REVERT_TO_STANDARD', 'CONVERT_TO_PLAN', 'END'].map((x) => (
              <option key={x} value={x}>
                {label('sb.post', x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('sb.a.approvalRef')} htmlFor="sb-promo-ref">
          <Input id="sb-promo-ref" value={f.approvalRef} onChange={(e) => setF({ ...f, approvalRef: e.target.value })} />
        </Field>
        <div>
          <Button
            disabled={cmd.busy || !f.endAt || !f.startAt}
            onClick={() =>
              void cmd.run(
                'POST',
                `${AS}/contracts/${contractId}/promotions`,
                {
                  kind: f.kind,
                  itemCode: f.itemCode,
                  promoPriceMinor: f.promoPriceMinor ? Number(f.promoPriceMinor) : null,
                  startAt: new Date(`${f.startAt}T00:00:00Z`).toISOString(),
                  endAt: new Date(`${f.endAt}T00:00:00Z`).toISOString(),
                  postPromotion: f.postPromotion,
                  approvalRef: f.approvalRef || undefined,
                },
                t('sb.a.done'),
                onDone,
              )
            }
          >
            {t('sb.a.addPromotion')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AmendmentRow({ a, canManage, canApprove, onChanged }: { a: AmendmentView; canManage: boolean; canApprove: boolean; onChanged: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const cmd = useCommand();
  const [reason, setReason] = useState('');
  const dealDashOnly = ['ENTITLEMENT', 'PRICING', 'MARKET_ADDITION', 'EXTENSION'].includes(a.type);
  return (
    <Card flat data-testid={`sb-amendment-${a.id}`}>
      <div className="dd-stack" style={{ gap: 8 }}>
        <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <strong>{label('sb.amend', a.type)}</strong>
          <StatusChip tone={AMEND_TONE[a.status] ?? 'neutral'}>{label('sb.astatus', a.status)}</StatusChip>
          <span className="dd-muted">{a.requestedByOrg ? t('sb.a.byOrg') : t('sb.a.byDealDash')}</span>
          {a.forced ? <StatusChip tone="danger">{t('sb.a.forced')}</StatusChip> : null}
          <span className="dd-muted">{formatDateTime(locale, a.createdAt)}</span>
        </div>
        {a.reason ? <span>{a.reason}</span> : null}
        {a.impact ? <ImpactView impact={a.impact} /> : null}
        {cmd.banner}
        {a.status === 'PROPOSED' ? (
          <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {dealDashOnly && canApprove ? (
              <Button size="sm" disabled={cmd.busy} onClick={() => void cmd.run('POST', `${AS}/amendments/${a.id}/apply`, {}, t('sb.a.done'), onChanged)}>
                {t('sb.a.apply')}
              </Button>
            ) : null}
            {!dealDashOnly && canManage ? (
              <Button size="sm" disabled={cmd.busy} onClick={() => void cmd.run('POST', `${AS}/amendments/${a.id}/accept-on-behalf`, { language: locale, confirm: true }, t('sb.a.done'), onChanged)}>
                {t('sb.a.acceptOnBehalf')}
              </Button>
            ) : null}
            {canManage ? (
              <>
                <Input aria-label={t('sb.a.reason')} placeholder={t('sb.a.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
                <Button variant="outline" size="sm" disabled={cmd.busy || reason.trim().length < 3} onClick={() => void cmd.run('POST', `${AS}/amendments/${a.id}/reject`, { reason }, t('sb.a.done'), onChanged)}>
                  {t('sb.a.reject')}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function ContractAmendments({ contractId, canManage, canApprove, onChanged }: { contractId: string; canManage: boolean; canApprove: boolean; onChanged: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const { call } = useApi();
  const list = useResource<AmendmentView[]>(`${AS}/amendments`, { contractId });
  const plans = useResource<PlanRow[]>(canManage ? `${AS}/plans` : null);
  const cmd = useCommand();
  const [f, setF] = useState({ type: 'UPGRADE', targetPlanCode: '', forced: false, reason: '', key: 'branches.max', value: '' });
  const [impact, setImpact] = useState<Impact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = () => {
    if (f.type === 'ENTITLEMENT') {
      const limit = f.key.includes('.');
      return { type: 'ENTITLEMENT', reason: f.reason, entitlements: [limit ? { kind: 'LIMIT', key: f.key, value: f.value === '' ? null : Number(f.value) } : { kind: f.key === f.key.toUpperCase() && f.key.includes('_') ? 'FEATURE' : 'PRODUCT', key: f.key, enabled: f.value !== '0' }] };
    }
    return { type: f.type, targetPlanCode: f.targetPlanCode, forced: f.forced, reason: f.reason || undefined };
  };
  const reload = async () => {
    await Promise.all([list.reload(), onChanged()]);
  };
  const previewIt = async () => {
    const r = await call<Impact>('POST', `${AS}/contracts/${contractId}/amendments/preview`, { body: body() });
    if (!r.ok) {
      setError(errorMessage(locale, r.errors));
      setImpact(null);
      return;
    }
    setError(null);
    setImpact(r.data);
  };
  return (
    <Section title={t('sb.a.amendments')} testId="sb-contract-amendments">
      {(list.data ?? []).map((a) => (
        <AmendmentRow key={a.id} a={a} canManage={canManage} canApprove={canApprove} onChanged={reload} />
      ))}
      {canManage ? (
        <Card flat data-testid="sb-propose">
          <div className="dd-stack" style={{ gap: 8 }}>
            <strong>{t('sb.a.newAmendment')}</strong>
            {cmd.banner}
            <Field label={t('sb.a.col.type')} htmlFor="sb-am-type">
              <Select id="sb-am-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {['UPGRADE', 'DOWNGRADE', 'ENTITLEMENT'].map((x) => (
                  <option key={x} value={x}>
                    {label('sb.amend', x)}
                  </option>
                ))}
              </Select>
            </Field>
            {f.type === 'ENTITLEMENT' ? (
              <>
                <Field label={t('sb.a.overrideKey')} htmlFor="sb-am-key">
                  <Input id="sb-am-key" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
                </Field>
                <Field label={t('sb.a.overrideValue')} htmlFor="sb-am-value">
                  <Input id="sb-am-value" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
                </Field>
              </>
            ) : (
              <>
                <Field label={t('sb.a.targetPlan')} htmlFor="sb-am-plan">
                  <Select id="sb-am-plan" value={f.targetPlanCode} onChange={(e) => setF({ ...f, targetPlanCode: e.target.value })}>
                    <option value="">-</option>
                    {(plans.data ?? []).map((p) => (
                      <option key={p.code} value={p.code}>
                        {planName(locale, p)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {f.type === 'DOWNGRADE' ? <Checkbox checked={f.forced} onChange={(e) => setF({ ...f, forced: e.target.checked })} label={t('sb.a.forced')} /> : null}
              </>
            )}
            <Field label={t('sb.a.reason')} htmlFor="sb-am-reason">
              <Input id="sb-am-reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
            </Field>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {impact ? <ImpactView impact={impact} /> : null}
            <div className="dd-row" style={{ gap: 8 }}>
              <Button variant="outline" onClick={() => void previewIt()}>
                {t('sb.a.preview')}
              </Button>
              <Button disabled={cmd.busy} onClick={() => void cmd.run('POST', `${AS}/contracts/${contractId}/amendments`, body(), t('sb.a.done'), reload)}>
                {t('sb.a.propose')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </Section>
  );
}

function AmendmentsPanel({ canManage, canApprove }: { canManage: boolean; canApprove: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const [status, setStatus] = useState('PROPOSED');
  const list = useResource<AmendmentView[]>(`${AS}/amendments`, { status: status || undefined });
  const rows = list.data ?? [];
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sb-amendments">
      <div className="dd-row" style={{ gap: 8 }}>
        <Select aria-label={t('sb.a.col.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('sb.a.all')}</option>
          {['PROPOSED', 'ACCEPTED', 'APPLIED', 'REJECTED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {label('sb.astatus', s)}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={() => void list.reload()}>
          {t('sb.a.refresh')}
        </Button>
      </div>
      {list.loading && !list.data ? <LoadingState label={t('state.loading')} /> : rows.length === 0 ? <EmptyState title={t('sb.a.empty')} /> : rows.map((a) => <AmendmentRow key={a.id} a={a} canManage={canManage} canApprove={canApprove} onChanged={list.reload} />)}
    </div>
  );
}

function CatalogPanel({ canManage, canApprove }: { canManage: boolean; canApprove: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const plans = useResource<PlanRow[]>(`${AS}/plans`, { includeRetired: 'true' });
  const cmd = useCommand();
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const rows = plans.data ?? [];
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sb-catalog">
      {cmd.banner}
      {canManage ? (
        showNew ? (
          <NewPlanForm
            onDone={async () => {
              setShowNew(false);
              await plans.reload();
            }}
          />
        ) : (
          <div>
            <Button variant="outline" onClick={() => setShowNew(true)}>
              {t('sb.a.plan.new')}
            </Button>
          </div>
        )
      ) : null}
      {plans.loading && !plans.data ? <LoadingState label={t('state.loading')} /> : null}
      {rows.map((p) => (
        <Card key={p.code} data-testid={`sb-catalog-${p.code}`}>
          <div className="dd-stack" style={{ gap: 8 }}>
            <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <strong>{planName(locale, p)}</strong>
              <code>{p.code}</code>
              <StatusChip tone="info">{label('sb.kind', p.contractKind)}</StatusChip>
              {p.isFree ? <StatusChip tone="success">{t('sb.a.plan.free')}</StatusChip> : null}
              {p.negotiated ? <StatusChip tone="neutral">{t('sb.a.plan.negotiated')}</StatusChip> : null}
            </div>
            <div className="dd-table-wrap">
              <table className="dd-table">
                <thead>
                  <tr>
                    <th>{t('sb.a.col.market')}</th>
                    <th>{t('sb.a.col.version')}</th>
                    <th>{t('sb.a.col.status')}</th>
                    <th>{t('sb.a.col.price')}</th>
                    <th>{t('sb.a.col.from')}</th>
                    <th>{t('sb.a.col.until')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.versions.map((v) => (
                    <tr key={v.id}>
                      <td>{v.market}</td>
                      <td>v{v.version}</td>
                      <td>
                        <StatusChip tone={VERSION_TONE[v.status] ?? 'neutral'}>{label('sb.vstatus', v.status)}</StatusChip>
                        {v.developmentFixture ? <> <StatusChip tone="neutral">{t('sb.a.fixture')}</StatusChip></> : null}
                      </td>
                      <td>
                        {v.prices.length
                          ? v.prices.map((pp) => (
                              <div key={pp.cadence}>
                                {pp.indicative ? `${t('sb.a.indicative')}: ` : ''}
                                {money(locale, pp.amountMinor, v.currency)} · {label('sb.cadence', pp.cadence)}
                              </div>
                            ))
                          : p.isFree
                            ? t('sb.m.free')
                            : t('sb.a.noPrice')}
                      </td>
                      <td>{formatDate(locale, v.effectiveFrom)}</td>
                      <td>{v.effectiveUntil ? formatDate(locale, v.effectiveUntil) : '-'}</td>
                      <td>
                        {canApprove && v.status === 'DRAFT' ? (
                          <Button size="sm" disabled={cmd.busy} onClick={() => void cmd.run('POST', `${AS}/plan-versions/${v.id}/publish`, {}, t('sb.a.done'), plans.reload)}>
                            {t('sb.a.plan.publish')}
                          </Button>
                        ) : null}
                        {canApprove && v.status === 'PUBLISHED' ? (
                          <Button variant="outline" size="sm" disabled={cmd.busy} onClick={() => void cmd.run('POST', `${AS}/plan-versions/${v.id}/retire`, { reason: 'Retired from the catalog' }, t('sb.a.done'), plans.reload)}>
                            {t('sb.a.plan.retire')}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canManage ? (
              draftFor === p.code ? (
                <DraftVersionForm
                  plan={p}
                  onDone={async () => {
                    setDraftFor(null);
                    await plans.reload();
                  }}
                />
              ) : (
                <div>
                  <Button variant="outline" size="sm" onClick={() => setDraftFor(p.code)}>
                    {t('sb.a.plan.newVersion')}
                  </Button>
                </div>
              )
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

const csv = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

function NewPlanForm({ onDone }: { onDone: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const cmd = useCommand();
  const [f, setF] = useState({ code: '', nameEn: '', nameAr: '', entityType: 'MERCHANT', contractKind: 'MERCHANT_SUBSCRIPTION', isFree: false, negotiated: false });
  return (
    <Card flat data-testid="sb-new-plan">
      <div className="dd-stack" style={{ gap: 8 }}>
        {cmd.banner}
        <Field label={t('sb.a.col.code')} htmlFor="sb-np-code">
          <Input id="sb-np-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
        </Field>
        <Field label={`${t('sb.a.col.name')} (EN)`} htmlFor="sb-np-en">
          <Input id="sb-np-en" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
        </Field>
        <Field label={`${t('sb.a.col.name')} (AR)`} htmlFor="sb-np-ar">
          <Input id="sb-np-ar" dir="rtl" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} />
        </Field>
        <Field label={t('sb.a.plan.entity')} htmlFor="sb-np-entity">
          <Select id="sb-np-entity" value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })}>
            {['MERCHANT', 'BANK', 'SCHEME', 'CORPORATE', 'PARTNER'].map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('sb.a.col.kind')} htmlFor="sb-np-kind">
          <Select id="sb-np-kind" value={f.contractKind} onChange={(e) => setF({ ...f, contractKind: e.target.value })}>
            {['MERCHANT_SUBSCRIPTION', 'MERCHANT_ENTERPRISE', 'BANK_ENTERPRISE', 'SCHEME_NETWORK_LICENCE', 'CORPORATE_PARTNER', 'CUSTOM_ENTERPRISE'].map((x) => (
              <option key={x} value={x}>
                {label('sb.kind', x)}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox checked={f.isFree} onChange={(e) => setF({ ...f, isFree: e.target.checked })} label={t('sb.a.plan.free')} />
        <Checkbox checked={f.negotiated} onChange={(e) => setF({ ...f, negotiated: e.target.checked })} label={t('sb.a.plan.negotiated')} />
        <div>
          <Button disabled={cmd.busy || f.code.length < 2 || f.nameEn.length < 2 || f.nameAr.length < 2} onClick={() => void cmd.run('POST', `${AS}/plans`, f, t('sb.a.done'), onDone)}>
            {t('sb.a.plan.new')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function DraftVersionForm({ plan, onDone }: { plan: PlanRow; onDone: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const cmd = useCommand();
  const [f, setF] = useState({ market: 'PK', currency: 'PKR', monthly: '', annual: '', products: '', features: '', branches: '', users: '' });
  const submit = () => {
    const prices = [
      ...(f.monthly ? [{ cadence: 'MONTHLY', amountMinor: Number(f.monthly) }] : []),
      ...(f.annual ? [{ cadence: 'ANNUAL', amountMinor: Number(f.annual) }] : []),
    ];
    const limits = [
      ...(f.branches ? [{ key: 'branches.max', value: Number(f.branches) }] : []),
      ...(f.users ? [{ key: 'users.max', value: Number(f.users) }] : []),
    ];
    void cmd.run(
      'POST',
      `${AS}/plans/${plan.code}/versions`,
      { market: f.market, currency: f.currency, defaultCadence: prices[0]?.cadence ?? (plan.isFree ? 'NONE' : 'MONTHLY'), prices, entitlements: { products: csv(f.products), features: csv(f.features), limits } },
      t('sb.a.done'),
      onDone,
    );
  };
  const num = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value.replace(/\D/g, '') });
  return (
    <Card flat data-testid="sb-draft-form">
      <div className="dd-stack" style={{ gap: 8 }}>
        {cmd.banner}
        <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Field label={t('sb.a.marketCode')} htmlFor="sb-dv-market">
            <Input id="sb-dv-market" value={f.market} maxLength={2} onChange={(e) => setF({ ...f, market: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={t('sb.a.plan.currency')} htmlFor="sb-dv-cur">
            <Input id="sb-dv-cur" value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
          </Field>
        </div>
        <Field label={t('sb.a.plan.monthly')} htmlFor="sb-dv-m">
          <Input id="sb-dv-m" inputMode="numeric" value={f.monthly} onChange={num('monthly')} />
        </Field>
        <Field label={t('sb.a.plan.annual')} htmlFor="sb-dv-a">
          <Input id="sb-dv-a" inputMode="numeric" value={f.annual} onChange={num('annual')} />
        </Field>
        <Field label={t('sb.a.plan.products')} htmlFor="sb-dv-p">
          <Input id="sb-dv-p" value={f.products} onChange={(e) => setF({ ...f, products: e.target.value })} />
        </Field>
        <Field label={t('sb.a.plan.features')} htmlFor="sb-dv-f">
          <Input id="sb-dv-f" value={f.features} onChange={(e) => setF({ ...f, features: e.target.value })} />
        </Field>
        <Field label={t('sb.a.plan.branches')} htmlFor="sb-dv-b">
          <Input id="sb-dv-b" inputMode="numeric" value={f.branches} onChange={num('branches')} />
        </Field>
        <Field label={t('sb.a.plan.users')} htmlFor="sb-dv-u">
          <Input id="sb-dv-u" inputMode="numeric" value={f.users} onChange={num('users')} />
        </Field>
        <div>
          <Button disabled={cmd.busy} onClick={submit}>
            {t('sb.a.plan.newVersion')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

interface PriceItemRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  category: string;
  unit: string;
  product: string | null;
  status: string;
  versions: Array<{ id: string; market: string; currency: string; version: number; status: string; model: string; amountMinor: number | null; rateBps: number | null; indicative: boolean; rangeMin: number | null; rangeMax: number | null; effectiveFrom: string; effectiveUntil: string | null; reference: string | null }>;
}

function PriceBookPanel({ canManage, canApprove }: { canManage: boolean; canApprove: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const items = useResource<PriceItemRow[]>(`${AS}/price-items`);
  const cmd = useCommand();
  const [versionFor, setVersionFor] = useState<string | null>(null);
  const priceOf = (v: PriceItemRow['versions'][number]) => {
    if (v.model === 'PERCENT_BPS') {
      if (v.rateBps !== null) return t('sb.a.item.rate', { rate: formatNumber(locale, v.rateBps / 100) });
      if (v.rangeMin !== null && v.rangeMax !== null) return t('sb.a.item.range', { min: `${formatNumber(locale, v.rangeMin / 100)} %`, max: `${formatNumber(locale, v.rangeMax / 100)} %` });
    }
    if (v.amountMinor !== null) return money(locale, v.amountMinor, v.currency);
    if (v.rangeMin !== null && v.rangeMax !== null) return t('sb.a.item.range', { min: money(locale, v.rangeMin, v.currency), max: money(locale, v.rangeMax, v.currency) });
    return t('sb.a.noPrice');
  };
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sb-pricebook">
      {cmd.banner}
      {items.loading && !items.data ? <LoadingState label={t('state.loading')} /> : null}
      <div className="dd-table-wrap">
        <table className="dd-table">
          <thead>
            <tr>
              <th>{t('sb.a.col.name')}</th>
              <th>{t('sb.a.col.category')}</th>
              <th>{t('sb.a.col.market')}</th>
              <th>{t('sb.a.col.version')}</th>
              <th>{t('sb.a.col.price')}</th>
              <th>{t('sb.a.col.reference')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(items.data ?? []).flatMap((i) =>
              (i.versions.length ? i.versions : [null]).map((v, idx) => (
                <tr key={`${i.code}-${v?.id ?? 'none'}`} data-testid={idx === 0 ? `sb-item-${i.code}` : undefined}>
                  <td>
                    {idx === 0 ? (
                      <>
                        {locale === 'ar' ? i.nameAr : i.nameEn} {i.status !== 'ACTIVE' ? <StatusChip tone="neutral">{t('sb.a.item.inactive')}</StatusChip> : null}
                      </>
                    ) : null}
                  </td>
                  <td>{idx === 0 ? label('sb.category', i.category) : null}</td>
                  <td>{v?.market ?? '-'}</td>
                  <td>{v ? <StatusChip tone={VERSION_TONE[v.status] ?? 'neutral'}>{`v${v.version} · ${label('sb.vstatus', v.status)}`}</StatusChip> : '-'}</td>
                  <td>
                    {v ? (
                      <>
                        {v.indicative ? `${t('sb.a.indicative')}: ` : ''}
                        {priceOf(v)}
                      </>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="dd-muted">{v?.reference ?? ''}</td>
                  <td>
                    {v && canApprove && v.status === 'DRAFT' ? (
                      <Button size="sm" disabled={cmd.busy} onClick={() => void cmd.run('POST', `${AS}/price-item-versions/${v.id}/publish`, {}, t('sb.a.done'), items.reload)}>
                        {t('sb.a.plan.publish')}
                      </Button>
                    ) : null}
                    {idx === 0 && canManage ? (
                      <Button variant="outline" size="sm" onClick={() => setVersionFor(i.code)}>
                        {t('sb.a.item.newVersion')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      {versionFor ? (
        <ItemVersionForm
          code={versionFor}
          onDone={async () => {
            setVersionFor(null);
            await items.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ItemVersionForm({ code, onDone }: { code: string; onDone: () => Promise<void> }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const cmd = useCommand();
  const [f, setF] = useState({ market: 'PK', currency: 'PKR', model: 'FIXED', amount: '', rateBps: '', indicative: false, reference: '' });
  return (
    <Card flat data-testid="sb-item-form">
      <div className="dd-stack" style={{ gap: 8 }}>
        <strong>
          {t('sb.a.item.newVersion')}: <code>{code}</code>
        </strong>
        {cmd.banner}
        <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Field label={t('sb.a.marketCode')} htmlFor="sb-iv-market">
            <Input id="sb-iv-market" value={f.market} maxLength={2} onChange={(e) => setF({ ...f, market: e.target.value.toUpperCase() })} />
          </Field>
          <Field label={t('sb.a.plan.currency')} htmlFor="sb-iv-cur">
            <Input id="sb-iv-cur" value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
          </Field>
        </div>
        <Field label={t('sb.a.col.model')} htmlFor="sb-iv-model">
          <Select id="sb-iv-model" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}>
            {['FIXED', 'PER_UNIT', 'PERCENT_BPS'].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        {f.model === 'PERCENT_BPS' ? (
          <Field label={t('sb.a.discountBps')} htmlFor="sb-iv-bps">
            <Input id="sb-iv-bps" inputMode="numeric" value={f.rateBps} onChange={(e) => setF({ ...f, rateBps: e.target.value.replace(/\D/g, '') })} />
          </Field>
        ) : (
          <Field label={t('sb.a.amountMinor')} htmlFor="sb-iv-amount">
            <Input id="sb-iv-amount" inputMode="numeric" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, '') })} />
          </Field>
        )}
        <Checkbox checked={f.indicative} onChange={(e) => setF({ ...f, indicative: e.target.checked })} label={t('sb.a.indicative')} />
        <Field label={t('sb.a.col.reference')} htmlFor="sb-iv-ref">
          <Input id="sb-iv-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
        </Field>
        <div>
          <Button
            disabled={cmd.busy}
            onClick={() =>
              void cmd.run(
                'POST',
                `${AS}/price-items/${code}/versions`,
                { market: f.market, currency: f.currency, model: f.model, amountMinor: f.amount ? Number(f.amount) : null, rateBps: f.rateBps ? Number(f.rateBps) : null, indicative: f.indicative, reference: f.reference || null },
                t('sb.a.done'),
                onDone,
              )
            }
          >
            {t('sb.a.item.newVersion')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

interface AddOnRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  effect: Array<{ kind: string; key: string; perUnit: number }>;
  priceItemCode: string | null;
  eligiblePlanCodes: string[];
  status: string;
}

function AddOnsPanel() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const list = useResource<AddOnRow[]>(`${AS}/add-ons`);
  if (list.loading && !list.data) return <LoadingState label={t('state.loading')} />;
  return (
    <div className="dd-table-wrap" data-testid="sb-addons-admin">
      <table className="dd-table">
        <thead>
          <tr>
            <th>{t('sb.a.col.name')}</th>
            <th>{t('sb.a.col.effect')}</th>
            <th>{t('sb.a.col.eligible')}</th>
            <th>{t('sb.a.col.price')}</th>
          </tr>
        </thead>
        <tbody>
          {(list.data ?? []).map((a) => (
            <tr key={a.code} data-testid={`sb-addon-${a.code}`}>
              <td>
                {locale === 'ar' ? a.nameAr : a.nameEn} <code>{a.code}</code>
              </td>
              <td>
                {a.effect.map((e) => (
                  <div key={`${e.kind}-${e.key}`}>{e.kind === 'LIMIT' ? t('sb.a.addon.effect', { key: label('sb.limit', e.key), n: formatNumber(locale, e.perUnit) }) : e.kind === 'FEATURE' ? label('sb.feature', e.key) : label('sb.product', e.key)}</div>
                ))}
              </td>
              <td>{a.eligiblePlanCodes.join(', ') || '-'}</td>
              <td>{a.priceItemCode ? <code>{a.priceItemCode}</code> : t('sb.a.noPrice')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface BillingEventRow {
  id: string;
  idempotencyKey: string;
  organizationId: string;
  contractId: string | null;
  billingLegalEntityId: string | null;
  eventType: string;
  billingCategory: string;
  amountMinor: number;
  currency: string;
  quantity: number;
  pricingVersionKey: string | null;
  status: string;
  occurredAt: string;
}

function BillingEventsPanel() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const [status, setStatus] = useState('');
  const list = useResource<BillingEventRow[]>(`${AS}/billing-events`, { status: status || undefined });
  const rows = list.data ?? [];
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sb-billing">
      <Alert tone="info">{t('sb.a.billingNote')}</Alert>
      <div className="dd-row" style={{ gap: 8 }}>
        <Select aria-label={t('sb.a.col.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('sb.a.all')}</option>
          {['PENDING', 'CONSUMED', 'VOID'].map((s) => (
            <option key={s} value={s}>
              {label('sb.estatus', s)}
            </option>
          ))}
        </Select>
        <Button variant="outline" size="sm" onClick={() => void list.reload()}>
          {t('sb.a.refresh')}
        </Button>
      </div>
      {list.loading && !list.data ? (
        <LoadingState label={t('state.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('sb.a.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('sb.a.col.type')}</th>
                <th>{t('sb.a.col.category')}</th>
                <th>{t('sb.a.col.amount')}</th>
                <th>{t('sb.a.col.status')}</th>
                <th>{t('sb.a.col.key')}</th>
                <th>{t('sb.a.col.when')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{label('sb.event', e.eventType)}</td>
                  <td>{label('sb.category', e.billingCategory)}</td>
                  <td>{money(locale, e.amountMinor, e.currency)}</td>
                  <td>
                    <StatusChip tone={e.status === 'PENDING' ? 'warning' : e.status === 'VOID' ? 'neutral' : 'success'}>{label('sb.estatus', e.status)}</StatusChip>
                  </td>
                  <td>
                    <code>{e.pricingVersionKey ?? '-'}</code>
                  </td>
                  <td>{formatDateTime(locale, e.occurredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface SignalRow {
  id: string;
  type: string;
  organizationId: string;
  metricKey: string | null;
  consumedAt: string | null;
  createdAt: string;
}

function SignalsPanel() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const list = useResource<SignalRow[]>(`${AS}/signals`);
  const rows = list.data ?? [];
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sb-signals">
      <Alert tone="info">{t('sb.a.signalsNote')}</Alert>
      {list.loading && !list.data ? (
        <LoadingState label={t('state.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('sb.a.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('sb.a.col.type')}</th>
                <th>{t('sb.a.col.org')}</th>
                <th>{t('sb.a.col.status')}</th>
                <th>{t('sb.a.col.when')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>{label('sb.signal', s.type)}</td>
                  <td>
                    <code>{s.organizationId}</code>
                  </td>
                  <td>
                    <StatusChip tone={s.consumedAt ? 'success' : 'warning'}>{s.consumedAt ? t('sb.a.consumed') : t('sb.a.waiting')}</StatusChip>
                  </td>
                  <td>{formatDateTime(locale, s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReadinessPanel({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const list = useResource<Array<{ organizationId: string; name: Bilingual; type: string; partnerType: string | null }>>(`${AS}/readiness/unassigned`);
  const cmd = useCommand();
  const rows = list.data ?? [];
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sb-readiness">
      <Alert tone="info">{t('sb.a.readinessNote')}</Alert>
      {cmd.banner}
      {canManage ? (
        <div>
          <Button variant="outline" disabled={cmd.busy} onClick={() => void cmd.run('POST', `${AS}/run-due`, {}, t('sb.a.ranDue'), list.reload)}>
            {t('sb.a.runDue')}
          </Button>
        </div>
      ) : null}
      {list.loading && !list.data ? (
        <LoadingState label={t('state.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('sb.a.readinessEmpty')} />
      ) : (
        <ul style={{ margin: 0 }}>
          {rows.map((r) => (
            <li key={r.organizationId} data-testid={`sb-unassigned-${r.organizationId}`}>
              {locale === 'ar' ? r.name.ar : r.name.en} · {r.partnerType ?? r.type} · <code>{r.organizationId}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
