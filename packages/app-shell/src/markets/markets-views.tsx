'use client';

import { useCallback, useState, type ReactNode } from 'react';
import {
  createTranslator,
  dictionaries,
  formatDate,
  formatDateTime,
  formatNumber,
  type DictionaryKey,
} from '@dealdash/localization';
import {
  INVOICE_CONFIG_KINDS,
  MARKET_POLICY_CATEGORIES,
  MARKET_POLICY_KEYS,
  MARKET_PRODUCT_STATUSES,
  MARKET_TRANSITIONS,
  MARKET_VALIDATION_STATUSES,
  PROVIDER_CAPABILITIES,
  PROVIDER_ENVIRONMENTS,
  PROVIDER_STATUSES,
  SETTLEMENT_FREQUENCIES,
  TAXABLE_ITEMS,
  TAX_TYPES,
  type MarketPolicyCategory,
  type MarketStatus,
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
  Textarea,
} from '@dealdash/ui';
import type { StatusTone } from '@dealdash/ui';
import { useApi, useResource } from '../api';
import { useAuth } from '../auth-context';
import { errorMessage } from '../gates';

// ====================================================================================== shared
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
export const MARKET_TONE: Record<string, StatusTone> = {
  PLANNED: 'neutral',
  CONFIGURING: 'info',
  TESTING: 'info',
  PILOT: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  CLOSED: 'neutral',
};
export const READINESS_TONE: Record<string, StatusTone> = {
  READY: 'success',
  NOT_READY: 'danger',
  BLOCKED: 'danger',
  VALIDATION_REQUIRED: 'warning',
  OK: 'success',
  MISSING: 'danger',
};
const CONFIG_TONE: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'success',
  RETIRED: 'neutral',
};
const PRODUCT_TONE: Record<string, StatusTone> = {
  DISABLED: 'neutral',
  CONFIGURING: 'info',
  TESTING: 'info',
  PILOT: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
};
const VALIDATION_TONE: Record<string, StatusTone> = {
  OPEN: 'danger',
  IN_REVIEW: 'warning',
  RESOLVED: 'success',
  ACCEPTED_RISK: 'info',
  NOT_APPLICABLE: 'neutral',
};
const isoDay = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : undefined);

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
  return {
    run,
    busy,
    banner: banner ? (
      <div data-testid="mkt-banner">
        <Alert tone={banner.tone}>{banner.text}</Alert>
      </div>
    ) : null,
  };
}

function Section({
  title,
  children,
  testId,
  note,
  action,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
  note?: string;
  action?: ReactNode;
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

function Loaded<T>({
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
    const denied = ['FORBIDDEN', 'SCOPE_FORBIDDEN', 'NOT_FOUND'].includes(res.errors[0]!.code);
    return (
      <div data-testid={denied ? 'mkt-denied' : 'mkt-error'}>
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

// ====================================================================================== types
export interface MarketView {
  code: string;
  nameEn: string;
  nameAr: string;
  regionCode: string | null;
  isoAlpha3: string | null;
  status: MarketStatus;
  enabled: boolean;
  currency: string;
  supportedCurrencies: string[];
  billingCurrency: string;
  settlementCurrency: string;
  taxCurrency: string;
  currencyDecimals: number;
  roundingRule: string;
  languages: string[];
  defaultLanguage: string;
  timezone: string;
  callingCode: string | null;
  launchDate: string | null;
  version: number;
  approvalStatus: string;
  pending: {
    status: string;
    reason: string | null;
    requestedByUserId: string | null;
    requestedAt: string | null;
  } | null;
  dealdashLegalEntityId: string | null;
  supportContact: { email?: string; phone?: string };
  products?: Record<string, number>;
  readiness?: string;
}
interface Readiness {
  market: string;
  state: string;
  items: Array<{ check: string; state: string; detail: string }>;
}
interface Versioned {
  id: string;
  version: number;
  status: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdByUserId: string;
  [k: string]: unknown;
}

// ====================================================================================== list
/** Admin -> Markets: every market with its region, lifecycle, currency, language, time zone and launch readiness. */
export function MarketsWorkspace({
  canManage,
  canApprove,
}: {
  canManage: boolean;
  canApprove: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const [open, setOpen] = useState<string | null>(null);
  const res = useResource<MarketView[]>(open ? null : '/v1/admin/markets');
  const { run, busy, banner } = useCommand();
  const [f, setF] = useState({
    code: '',
    nameEn: '',
    nameAr: '',
    currency: '',
    languages: 'ar,en',
  });
  if (open)
    return (
      <MarketDetail
        code={open}
        canManage={canManage}
        canApprove={canApprove}
        onBack={() => setOpen(null)}
      />
    );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="markets-workspace">
      <h1 className="dd-title-xl">{t('mkt.title')}</h1>
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('mkt.intro')}
      </p>
      {banner}
      <Section title={t('mkt.list')} testId="mkt-list">
        <Loaded res={res} empty={(d) => !d.length}>
          {(d) => (
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table">
                <thead>
                  <tr>
                    <th>{t('mkt.country')}</th>
                    <th>{t('mkt.region')}</th>
                    <th>{t('mkt.status')}</th>
                    <th>{t('mkt.currency')}</th>
                    <th>{t('mkt.language')}</th>
                    <th>{t('mkt.timezone')}</th>
                    <th>{t('mkt.productsOpen')}</th>
                    <th>{t('mkt.readiness')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.map((m) => (
                    <tr key={m.code} data-testid={`mkt-row-${m.code}`}>
                      <td>
                        <strong>{locale === 'ar' ? m.nameAr : m.nameEn}</strong>{' '}
                        <span className="dd-muted">{m.code}</span>
                      </td>
                      <td>{label('mkt.regionName', m.regionCode)}</td>
                      <td>
                        <StatusChip tone={MARKET_TONE[m.status] ?? 'neutral'}>
                          {label('mkt.state', m.status)}
                        </StatusChip>
                        {m.pending ? (
                          <span className="dd-muted">
                            {' '}
                            · {t('mkt.pendingTo', { status: label('mkt.state', m.pending.status) })}
                          </span>
                        ) : null}
                      </td>
                      <td>{m.currency}</td>
                      <td>{m.defaultLanguage}</td>
                      <td>{m.timezone}</td>
                      <td>
                        {formatNumber(locale, (m.products?.PILOT ?? 0) + (m.products?.ACTIVE ?? 0))}
                      </td>
                      <td>
                        <StatusChip tone={READINESS_TONE[m.readiness ?? ''] ?? 'neutral'}>
                          {label('mkt.ready', m.readiness)}
                        </StatusChip>
                      </td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setOpen(m.code)}>
                          {t('bill.open')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
      </Section>
      {canManage ? (
        <Section title={t('mkt.newMarket')} testId="mkt-new" note={t('mkt.newNote')}>
          <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('mkt.isoCode')} htmlFor="nm-code">
              <Input
                id="nm-code"
                maxLength={2}
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={t('mkt.nameEn')} htmlFor="nm-en">
              <Input
                id="nm-en"
                value={f.nameEn}
                onChange={(e) => setF({ ...f, nameEn: e.target.value })}
              />
            </Field>
            <Field label={t('mkt.nameAr')} htmlFor="nm-ar">
              <Input
                id="nm-ar"
                dir="rtl"
                value={f.nameAr}
                onChange={(e) => setF({ ...f, nameAr: e.target.value })}
              />
            </Field>
            <Field label={t('mkt.currency')} htmlFor="nm-ccy">
              <Input
                id="nm-ccy"
                maxLength={3}
                value={f.currency}
                onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={t('mkt.languages')} htmlFor="nm-lang" help={t('mkt.languagesHelp')}>
              <Input
                id="nm-lang"
                value={f.languages}
                onChange={(e) => setF({ ...f, languages: e.target.value })}
              />
            </Field>
            <Button
              loading={busy}
              disabled={
                f.code.length !== 2 ||
                f.nameEn.length < 2 ||
                f.nameAr.length < 2 ||
                f.currency.length !== 3
              }
              data-testid="mkt-create"
              onClick={() =>
                void run(
                  'POST',
                  `/v1/admin/markets/${f.code}`,
                  {
                    nameEn: f.nameEn,
                    nameAr: f.nameAr,
                    currency: f.currency,
                    languages: f.languages
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean),
                  },
                  t('mkt.created'),
                  () => res.reload(),
                )
              }
            >
              {t('mkt.create')}
            </Button>
          </div>
        </Section>
      ) : null}
    </div>
  );
}

// ====================================================================================== detail
export type MarketTab =
  | 'overview'
  | 'products'
  | 'tax'
  | 'currency'
  | 'invoice'
  | 'payments'
  | 'settlement'
  | 'providers'
  | 'compliance'
  | 'validations'
  | 'readiness'
  | 'history';

export function MarketDetail({
  code,
  canManage,
  canApprove,
  onBack,
}: {
  code: string;
  canManage: boolean;
  canApprove: boolean;
  onBack: () => void;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const [tab, setTab] = useState<MarketTab>('overview');
  const market = useResource<MarketView>(`/v1/admin/markets/${code}`);
  const tabs = (
    [
      'overview',
      'products',
      'tax',
      'currency',
      'invoice',
      'payments',
      'settlement',
      'providers',
      'compliance',
      'validations',
      'readiness',
      'history',
    ] as const
  ).map((id) => ({ id, label: t(`mkt.tab.${id}` as DictionaryKey) }));
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="market-detail">
      <div className="dd-row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h1 className="dd-title-xl">
          {market.data ? (locale === 'ar' ? market.data.nameAr : market.data.nameEn) : code}{' '}
          <span className="dd-muted">{code}</span>
        </h1>
        <div className="dd-row" style={{ gap: 8 }}>
          {market.data ? (
            <StatusChip tone={MARKET_TONE[market.data.status] ?? 'neutral'}>
              {label('mkt.state', market.data.status)}
            </StatusChip>
          ) : null}
          <Button size="sm" variant="outline" onClick={onBack}>
            {t('mkt.allMarkets')}
          </Button>
        </div>
      </div>
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(v) => setTab(v as MarketTab)}
          label={t('mkt.title')}
        />
      </div>
      <Loaded res={market}>
        {(m) => (
          <>
            {tab === 'overview' ? (
              <Overview
                m={m}
                canManage={canManage}
                canApprove={canApprove}
                reload={market.reload}
              />
            ) : null}
            {tab === 'products' ? <Products m={m} canManage={canManage} /> : null}
            {tab === 'tax' ? <TaxTab m={m} canManage={canManage} canApprove={canApprove} /> : null}
            {tab === 'currency' ? <CurrencyTab m={m} /> : null}
            {tab === 'invoice' ? (
              <InvoiceTab m={m} canManage={canManage} canApprove={canApprove} />
            ) : null}
            {tab === 'payments' ? <ProvidersTab m={m} canManage={canManage} payments /> : null}
            {tab === 'settlement' ? (
              <SettlementTab m={m} canManage={canManage} canApprove={canApprove} />
            ) : null}
            {tab === 'providers' ? (
              <ProvidersTab m={m} canManage={canManage} payments={false} />
            ) : null}
            {tab === 'compliance' ? (
              <ComplianceTab m={m} canManage={canManage} canApprove={canApprove} />
            ) : null}
            {tab === 'validations' ? (
              <ValidationsTab m={m} canManage={canManage} canApprove={canApprove} />
            ) : null}
            {tab === 'readiness' ? <ReadinessTab m={m} /> : null}
            {tab === 'history' ? <HistoryTab m={m} /> : null}
          </>
        )}
      </Loaded>
    </div>
  );
}

// ---------------------------------------------------------------------------------- overview + lifecycle gate
function Overview({
  m,
  canManage,
  canApprove,
  reload,
}: {
  m: MarketView;
  canManage: boolean;
  canApprove: boolean;
  reload: () => Promise<void>;
}) {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const { run, busy, banner } = useCommand();
  const [to, setTo] = useState<string>(MARKET_TRANSITIONS[m.status][0] ?? '');
  const [reason, setReason] = useState('');
  const [f, setF] = useState({
    timezone: m.timezone,
    callingCode: m.callingCode ?? '',
    regionCode: m.regionCode ?? '',
    le: m.dealdashLegalEntityId ?? '',
    email: m.supportContact?.email ?? '',
    phone: m.supportContact?.phone ?? '',
    launchDate: m.launchDate?.slice(0, 10) ?? '',
  });
  const save = () =>
    run(
      'POST',
      `/v1/admin/markets/${m.code}`,
      {
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        regionCode: f.regionCode || null,
        isoAlpha3: m.isoAlpha3,
        currency: m.currency,
        supportedCurrencies: m.supportedCurrencies,
        currencyDecimals: m.currencyDecimals,
        roundingRule: m.roundingRule,
        languages: m.languages,
        defaultLanguage: m.defaultLanguage,
        timezone: f.timezone,
        callingCode: f.callingCode || null,
        launchDate: f.launchDate ? isoDay(f.launchDate) : null,
        dealdashLegalEntityId: f.le || null,
        supportContact: {
          ...(f.email ? { email: f.email } : {}),
          ...(f.phone ? { phone: f.phone } : {}),
        },
      },
      t('common.saved'),
      reload,
    );
  return (
    <div className="dd-stack" style={{ gap: 16 }}>
      {banner}
      <Section title={t('mkt.tab.overview')} testId="mkt-overview">
        <KeyValue
          items={[
            {
              label: t('mkt.country'),
              value: `${m.nameEn} / ${m.nameAr} (${m.code}${m.isoAlpha3 ? ` · ${m.isoAlpha3}` : ''})`,
            },
            { label: t('mkt.region'), value: label('mkt.regionName', m.regionCode) },
            {
              label: t('mkt.status'),
              value: (
                <StatusChip tone={MARKET_TONE[m.status] ?? 'neutral'}>
                  {label('mkt.state', m.status)}
                </StatusChip>
              ),
            },
            {
              label: t('mkt.launchDate'),
              value: m.launchDate ? formatDate(locale, m.launchDate) : '-',
            },
            { label: t('mkt.currency'), value: m.currency },
            { label: t('mkt.language'), value: `${m.defaultLanguage} (${m.languages.join(', ')})` },
            { label: t('mkt.timezone'), value: m.timezone },
            { label: t('mkt.callingCode'), value: m.callingCode ?? '-' },
            { label: t('mkt.legalEntity'), value: m.dealdashLegalEntityId ?? t('mkt.notSet') },
            {
              label: t('mkt.support'),
              value: m.supportContact?.email ?? m.supportContact?.phone ?? t('mkt.notSet'),
            },
            { label: t('mkt.version'), value: `v${m.version}` },
          ]}
        />
        {canManage ? (
          <div
            className="dd-row"
            style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
            data-testid="mkt-master-form"
          >
            <Field label={t('mkt.region')} htmlFor="mm-region">
              <Input
                id="mm-region"
                value={f.regionCode}
                onChange={(e) => setF({ ...f, regionCode: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={t('mkt.timezone')} htmlFor="mm-tz">
              <Input
                id="mm-tz"
                value={f.timezone}
                onChange={(e) => setF({ ...f, timezone: e.target.value })}
              />
            </Field>
            <Field label={t('mkt.callingCode')} htmlFor="mm-cc">
              <Input
                id="mm-cc"
                value={f.callingCode}
                onChange={(e) => setF({ ...f, callingCode: e.target.value })}
              />
            </Field>
            <Field label={t('mkt.launchDate')} htmlFor="mm-ld">
              <Input
                id="mm-ld"
                type="date"
                value={f.launchDate}
                onChange={(e) => setF({ ...f, launchDate: e.target.value })}
              />
            </Field>
            <Field label={t('mkt.legalEntityId')} htmlFor="mm-le">
              <Input
                id="mm-le"
                value={f.le}
                onChange={(e) => setF({ ...f, le: e.target.value.trim() })}
              />
            </Field>
            <Field label={t('mkt.supportEmail')} htmlFor="mm-se">
              <Input
                id="mm-se"
                type="email"
                value={f.email}
                onChange={(e) => setF({ ...f, email: e.target.value })}
              />
            </Field>
            <Button loading={busy} onClick={() => void save()} data-testid="mkt-save">
              {t('common.save')}
            </Button>
          </div>
        ) : null}
      </Section>
      <Section title={t('mkt.lifecycle')} testId="mkt-lifecycle" note={t('mkt.lifecycleNote')}>
        {m.pending ? (
          <Alert tone="warning" title={t('mkt.pendingTitle')}>
            {t('mkt.pendingBody', {
              status: label('mkt.state', m.pending.status),
              reason: m.pending.reason ?? '',
            })}
          </Alert>
        ) : null}
        {m.pending && canApprove ? (
          <div className="dd-row" style={{ gap: 8 }}>
            <Button
              disabled={m.pending.requestedByUserId === me?.id}
              loading={busy}
              data-testid="mkt-approve-status"
              onClick={() =>
                void run(
                  'POST',
                  `/v1/admin/markets/${m.code}/status/approve`,
                  {},
                  t('mkt.statusChanged'),
                  reload,
                )
              }
            >
              {t('mkt.approveChange')}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void run(
                  'POST',
                  `/v1/admin/markets/${m.code}/status/reject`,
                  {},
                  t('mkt.changeRejected'),
                  reload,
                )
              }
            >
              {t('bill.reject')}
            </Button>
            {m.pending.requestedByUserId === me?.id ? (
              <span className="dd-muted">{t('mkt.otherApprover')}</span>
            ) : null}
          </div>
        ) : null}
        {!m.pending && canManage && MARKET_TRANSITIONS[m.status].length ? (
          <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('mkt.moveTo')} htmlFor="mt-to">
              <Select
                id="mt-to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                data-testid="mkt-move-to"
              >
                {MARKET_TRANSITIONS[m.status].map((s) => (
                  <option key={s} value={s}>
                    {label('mkt.state', s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.reason')} htmlFor="mt-reason">
              <Input id="mt-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <Button
              loading={busy}
              disabled={reason.trim().length < 3}
              data-testid="mkt-request-status"
              onClick={() =>
                void run(
                  'POST',
                  `/v1/admin/markets/${m.code}/status`,
                  { status: to, reason },
                  t('mkt.statusRequested'),
                  reload,
                )
              }
            >
              {t('mkt.requestChange')}
            </Button>
          </div>
        ) : null}
        {m.status === 'CLOSED' ? <Alert tone="info">{t('mkt.closedNote')}</Alert> : null}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------- products
function Products({ m, canManage }: { m: MarketView; canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const res = useResource<
    Array<{ product: string; status: string; notes: string | null; effectiveFrom: string }>
  >(`/v1/admin/markets/${m.code}/products`);
  const { run, banner } = useCommand();
  return (
    <Section title={t('mkt.tab.products')} testId="mkt-products" note={t('mkt.productsNote')}>
      {banner}
      <Loaded res={res}>
        {(d) => (
          <div style={{ overflowX: 'auto' }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('vis.productLabel')}</th>
                  <th>{t('mkt.status')}</th>
                  <th>{t('mkt.since')}</th>
                </tr>
              </thead>
              <tbody>
                {d.map((p) => (
                  <tr key={p.product} data-testid={`mkt-product-${p.product}`}>
                    <td>{label('mkt.product', p.product)}</td>
                    <td>
                      {canManage ? (
                        <Select
                          aria-label={label('mkt.product', p.product)}
                          value={p.status}
                          onChange={(e) =>
                            void run(
                              'PUT',
                              `/v1/admin/markets/${m.code}/products/${p.product}`,
                              { status: e.target.value },
                              t('common.saved'),
                              () => res.reload(),
                            )
                          }
                          style={{ maxWidth: 200 }}
                        >
                          {MARKET_PRODUCT_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {label('mkt.pstate', s)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <StatusChip tone={PRODUCT_TONE[p.status] ?? 'neutral'}>
                          {label('mkt.pstate', p.status)}
                        </StatusChip>
                      )}
                    </td>
                    <td>{formatDate(locale, p.effectiveFrom)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
    </Section>
  );
}

// ---------------------------------------------------------------------------------- effective-dated, versioned configuration
function VersionTable({
  rows,
  kind,
  summary,
  canManage,
  canApprove,
  reload,
}: {
  rows: Versioned[];
  kind: string;
  summary: (r: Versioned) => ReactNode;
  canManage: boolean;
  canApprove: boolean;
  reload: () => Promise<void>;
}) {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const { run, banner } = useCommand();
  if (!rows.length) return <EmptyState title={t('vis.empty')} />;
  return (
    <div className="dd-stack" style={{ gap: 8 }}>
      {banner}
      <div style={{ overflowX: 'auto' }}>
        <table className="dd-table" data-testid={`mkt-versions-${kind}`}>
          <thead>
            <tr>
              <th>{t('mkt.rule')}</th>
              <th>{t('mkt.version')}</th>
              <th>{t('mkt.status')}</th>
              <th>{t('mkt.effectiveFrom')}</th>
              <th>{t('mkt.effectiveTo')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{summary(r)}</td>
                <td>v{r.version}</td>
                <td>
                  <StatusChip tone={CONFIG_TONE[r.status] ?? 'neutral'}>
                    {label('mkt.cstate', r.status)}
                  </StatusChip>
                </td>
                <td>{formatDate(locale, r.effectiveFrom)}</td>
                <td>{r.effectiveTo ? formatDate(locale, r.effectiveTo) : t('mkt.open')}</td>
                <td>
                  <div className="dd-row" style={{ gap: 6 }}>
                    {canApprove && r.status === 'DRAFT' && r.createdByUserId !== me?.id ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          void run(
                            'POST',
                            `/v1/admin/markets/config/${kind}/${r.id}/approve`,
                            {},
                            t('mkt.approved'),
                            reload,
                          )
                        }
                      >
                        {t('bill.approve')}
                      </Button>
                    ) : null}
                    {canApprove && r.status === 'DRAFT' && r.createdByUserId === me?.id ? (
                      <span className="dd-muted">{t('mkt.otherApprover')}</span>
                    ) : null}
                    {canManage && r.status === 'APPROVED' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void run(
                            'POST',
                            `/v1/admin/markets/config/${kind}/${r.id}/retire`,
                            { reason: 'Retired from the market workspace' },
                            t('mkt.retired'),
                            reload,
                          )
                        }
                      >
                        {t('mkt.retire')}
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TaxTab({
  m,
  canManage,
  canApprove,
}: {
  m: MarketView;
  canManage: boolean;
  canApprove: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const res = useResource<Versioned[]>(`/v1/admin/markets/${m.code}/config/tax-rules`);
  const { run, busy, banner } = useCommand();
  const [f, setF] = useState({
    code: 'VAT-STD',
    taxType: 'VAT',
    rate: '',
    inclusive: false,
    exempt: false,
    items: ['*'] as string[],
    from: '',
    registrationRef: '',
    validationCode: '',
  });
  const toggle = (x: string) =>
    setF((s) => ({
      ...s,
      items: s.items.includes(x)
        ? s.items.filter((y) => y !== x)
        : [...s.items.filter((y) => y !== '*'), x],
    }));
  return (
    <Section title={t('mkt.tab.tax')} testId="mkt-tax" note={t('mkt.taxNote')}>
      {banner}
      {canManage ? (
        <Card flat data-testid="mkt-tax-form">
          <div className="dd-stack" style={{ gap: 8 }}>
            <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label={t('mkt.ruleCode')} htmlFor="tx-code">
                <Input
                  id="tx-code"
                  value={f.code}
                  onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t('mkt.taxType')} htmlFor="tx-type">
                <Select
                  id="tx-type"
                  value={f.taxType}
                  onChange={(e) => setF({ ...f, taxType: e.target.value })}
                >
                  {TAX_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {label('mkt.taxTypeName', x)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('mkt.ratePercent')} htmlFor="tx-rate">
                <Input
                  id="tx-rate"
                  inputMode="decimal"
                  value={f.rate}
                  disabled={f.exempt}
                  onChange={(e) => setF({ ...f, rate: e.target.value.replace(/[^\d.]/g, '') })}
                />
              </Field>
              <Field label={t('mkt.effectiveFrom')} htmlFor="tx-from">
                <Input
                  id="tx-from"
                  type="date"
                  value={f.from}
                  onChange={(e) => setF({ ...f, from: e.target.value })}
                />
              </Field>
              <Field label={t('mkt.registrationRef')} htmlFor="tx-reg">
                <Input
                  id="tx-reg"
                  value={f.registrationRef}
                  onChange={(e) => setF({ ...f, registrationRef: e.target.value })}
                />
              </Field>
              <Field label={t('mkt.validationCode')} htmlFor="tx-val">
                <Input
                  id="tx-val"
                  value={f.validationCode}
                  onChange={(e) => setF({ ...f, validationCode: e.target.value.toUpperCase() })}
                />
              </Field>
            </div>
            <div className="dd-row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <Checkbox
                label={t('mkt.inclusive')}
                checked={f.inclusive}
                onChange={() => setF({ ...f, inclusive: !f.inclusive })}
              />
              <Checkbox
                label={t('mkt.exempt')}
                checked={f.exempt}
                onChange={() => setF({ ...f, exempt: !f.exempt, rate: !f.exempt ? '0' : f.rate })}
              />
            </div>
            <div
              className="dd-row"
              style={{ gap: 10, flexWrap: 'wrap' }}
              role="group"
              aria-label={t('mkt.appliesTo')}
            >
              <Checkbox
                label={t('mkt.allItems')}
                checked={f.items.includes('*')}
                onChange={() => setF({ ...f, items: ['*'] })}
              />
              {TAXABLE_ITEMS.map((x) => (
                <Checkbox
                  key={x}
                  label={label('mkt.item', x)}
                  checked={f.items.includes(x)}
                  onChange={() => toggle(x)}
                />
              ))}
            </div>
            <div>
              <Button
                loading={busy}
                disabled={!f.from || (!f.exempt && !f.rate) || !f.items.length}
                data-testid="mkt-tax-draft"
                onClick={() =>
                  void run(
                    'POST',
                    `/v1/admin/markets/${m.code}/tax-rules`,
                    {
                      code: f.code,
                      taxType: f.taxType,
                      rateBps: f.exempt ? 0 : Math.round(Number(f.rate) * 100),
                      inclusive: f.inclusive,
                      exempt: f.exempt,
                      applicability: f.items,
                      effectiveFrom: isoDay(f.from),
                      registrationRef: f.registrationRef || null,
                      validationCode: f.validationCode || null,
                    },
                    t('mkt.drafted'),
                    () => res.reload(),
                  )
                }
              >
                {t('mkt.draftVersion')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
      <Loaded res={res}>
        {(d) => (
          <VersionTable
            rows={d}
            kind="tax-rules"
            canManage={canManage}
            canApprove={canApprove}
            reload={res.reload}
            summary={(r) =>
              `${String(r.code)} · ${r.exempt ? t('mkt.exempt') : `${formatNumber(locale, Number(r.rateBps) / 100)}%`}${r.inclusive ? ` · ${t('mkt.inclusive')}` : ''} · ${(r.applicability as string[]).map((x) => (x === '*' ? t('mkt.allItems') : label('mkt.item', x))).join(', ')}`
            }
          />
        )}
      </Loaded>
    </Section>
  );
}

function CurrencyTab({ m }: { m: MarketView }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  return (
    <Section title={t('mkt.tab.currency')} testId="mkt-currency" note={t('mkt.currencyNote')}>
      <KeyValue
        items={[
          { label: t('mkt.defaultCurrency'), value: m.currency },
          { label: t('mkt.supportedCurrencies'), value: m.supportedCurrencies.join(', ') },
          { label: t('mkt.billingCurrency'), value: m.billingCurrency },
          { label: t('mkt.settlementCurrency'), value: m.settlementCurrency },
          { label: t('mkt.taxCurrency'), value: m.taxCurrency },
          { label: t('mkt.decimals'), value: formatNumber(locale, m.currencyDecimals) },
          { label: t('mkt.rounding'), value: m.roundingRule },
        ]}
      />
      <Alert tone="info">{t('mkt.fxNote')}</Alert>
    </Section>
  );
}

function InvoiceTab({
  m,
  canManage,
  canApprove,
}: {
  m: MarketView;
  canManage: boolean;
  canApprove: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const res = useResource<Versioned[]>(`/v1/admin/markets/${m.code}/config/invoice-configs`);
  const { run, busy, banner } = useCommand();
  const [f, setF] = useState({
    documentKind: 'TAX_INVOICE',
    prefix: '',
    from: '',
    qr: false,
    required: ['legalName', 'taxId'] as string[],
    validationStatus: 'VALIDATION_REQUIRED',
    provider: '',
    validationCode: '',
  });
  return (
    <Section title={t('mkt.tab.invoice')} testId="mkt-invoice" note={t('mkt.invoiceNote')}>
      {banner}
      {canManage ? (
        <Card flat>
          <div className="dd-stack" style={{ gap: 8 }}>
            <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label={t('mkt.documentKind')} htmlFor="ic-kind">
                <Select
                  id="ic-kind"
                  value={f.documentKind}
                  onChange={(e) => setF({ ...f, documentKind: e.target.value })}
                >
                  {INVOICE_CONFIG_KINDS.map((x) => (
                    <option key={x} value={x}>
                      {label('mkt.docKind', x)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('mkt.prefix')} htmlFor="ic-prefix">
                <Input
                  id="ic-prefix"
                  value={f.prefix}
                  onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t('mkt.effectiveFrom')} htmlFor="ic-from">
                <Input
                  id="ic-from"
                  type="date"
                  value={f.from}
                  onChange={(e) => setF({ ...f, from: e.target.value })}
                />
              </Field>
              <Field label={t('mkt.eInvoiceProvider')} htmlFor="ic-prov">
                <Input
                  id="ic-prov"
                  value={f.provider}
                  onChange={(e) => setF({ ...f, provider: e.target.value })}
                />
              </Field>
              <Field label={t('mkt.validationState')} htmlFor="ic-val">
                <Select
                  id="ic-val"
                  value={f.validationStatus}
                  onChange={(e) => setF({ ...f, validationStatus: e.target.value })}
                >
                  {['VALIDATION_REQUIRED', 'CONFIGURED', 'VALIDATED'].map((x) => (
                    <option key={x} value={x}>
                      {label('mkt.vstate', x)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('mkt.validationCode')} htmlFor="ic-vcode">
                <Input
                  id="ic-vcode"
                  value={f.validationCode}
                  onChange={(e) => setF({ ...f, validationCode: e.target.value.toUpperCase() })}
                />
              </Field>
            </div>
            <div className="dd-row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <Checkbox
                label={t('mkt.qrRequired')}
                checked={f.qr}
                onChange={() => setF({ ...f, qr: !f.qr })}
              />
              {[
                'legalName',
                'registeredAddress',
                'taxId',
                'invoiceContactEmail',
                'purchaseOrder',
              ].map((x) => (
                <Checkbox
                  key={x}
                  label={label('mkt.field', x)}
                  checked={f.required.includes(x)}
                  onChange={() =>
                    setF({
                      ...f,
                      required: f.required.includes(x)
                        ? f.required.filter((y) => y !== x)
                        : [...f.required, x],
                    })
                  }
                />
              ))}
            </div>
            <div>
              <Button
                loading={busy}
                disabled={!f.prefix || !f.from}
                onClick={() =>
                  void run(
                    'POST',
                    `/v1/admin/markets/${m.code}/invoice-configs`,
                    {
                      documentKind: f.documentKind,
                      prefix: f.prefix,
                      languages: m.languages,
                      requiredFields: f.required,
                      qrRequired: f.qr,
                      eInvoiceProvider: f.provider || null,
                      validationStatus: f.validationStatus,
                      validationCode: f.validationCode || null,
                      effectiveFrom: isoDay(f.from),
                    },
                    t('mkt.drafted'),
                    () => res.reload(),
                  )
                }
              >
                {t('mkt.draftVersion')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
      <Loaded res={res}>
        {(d) => (
          <VersionTable
            rows={d}
            kind="invoice-configs"
            canManage={canManage}
            canApprove={canApprove}
            reload={res.reload}
            summary={(r) => (
              <span>
                {label('mkt.docKind', String(r.documentKind))} · <code>{String(r.prefix)}</code> ·{' '}
                <StatusChip
                  tone={
                    r.validationStatus === 'VALIDATED'
                      ? 'success'
                      : r.validationStatus === 'CONFIGURED'
                        ? 'info'
                        : 'warning'
                  }
                >
                  {label('mkt.vstate', String(r.validationStatus))}
                </StatusChip>
              </span>
            )}
          />
        )}
      </Loaded>
    </Section>
  );
}

function SettlementTab({
  m,
  canManage,
  canApprove,
}: {
  m: MarketView;
  canManage: boolean;
  canApprove: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const res = useResource<Versioned[]>(`/v1/admin/markets/${m.code}/config/settlement-rules`);
  const { run, busy, banner } = useCommand();
  const [f, setF] = useState({
    code: 'MARKET-DEFAULT',
    currency: m.settlementCurrency,
    frequency: 'WEEKLY',
    cycleDays: '7',
    minimum: '',
    holdDays: '0',
    from: '',
  });
  return (
    <Section title={t('mkt.tab.settlement')} testId="mkt-settlement" note={t('mkt.settlementNote')}>
      {banner}
      {canManage ? (
        <Card flat>
          <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('mkt.ruleCode')} htmlFor="st-code">
              <Input
                id="st-code"
                value={f.code}
                onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={t('mkt.currency')} htmlFor="st-ccy">
              <Select
                id="st-ccy"
                value={f.currency}
                onChange={(e) => setF({ ...f, currency: e.target.value })}
              >
                {m.supportedCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('mkt.frequency')} htmlFor="st-freq">
              <Select
                id="st-freq"
                value={f.frequency}
                onChange={(e) => setF({ ...f, frequency: e.target.value })}
              >
                {SETTLEMENT_FREQUENCIES.map((x) => (
                  <option key={x} value={x}>
                    {label('mkt.freq', x)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('mkt.cycleDays')} htmlFor="st-cycle">
              <Input
                id="st-cycle"
                inputMode="numeric"
                value={f.cycleDays}
                onChange={(e) => setF({ ...f, cycleDays: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label={t('mkt.minimum')} htmlFor="st-min">
              <Input
                id="st-min"
                inputMode="decimal"
                value={f.minimum}
                onChange={(e) => setF({ ...f, minimum: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </Field>
            <Field label={t('mkt.holdDays')} htmlFor="st-hold">
              <Input
                id="st-hold"
                inputMode="numeric"
                value={f.holdDays}
                onChange={(e) => setF({ ...f, holdDays: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label={t('mkt.effectiveFrom')} htmlFor="st-from">
              <Input
                id="st-from"
                type="date"
                value={f.from}
                onChange={(e) => setF({ ...f, from: e.target.value })}
              />
            </Field>
            <Button
              loading={busy}
              disabled={!f.from}
              onClick={() =>
                void run(
                  'POST',
                  `/v1/admin/markets/${m.code}/settlement-rules`,
                  {
                    code: f.code,
                    currency: f.currency,
                    frequency: f.frequency,
                    cycleDays: Number(f.cycleDays || 0),
                    minimumMinor: Math.round(Number(f.minimum || 0) * 10 ** m.currencyDecimals),
                    holdDays: Number(f.holdDays || 0),
                    effectiveFrom: isoDay(f.from),
                  },
                  t('mkt.drafted'),
                  () => res.reload(),
                )
              }
            >
              {t('mkt.draftVersion')}
            </Button>
          </div>
        </Card>
      ) : null}
      <Loaded res={res}>
        {(d) => (
          <VersionTable
            rows={d}
            kind="settlement-rules"
            canManage={canManage}
            canApprove={canApprove}
            reload={res.reload}
            summary={(r) =>
              `${String(r.code)} · ${String(r.currency)} · ${label('mkt.freq', String(r.frequency))}${r.legalEntityId ? ` · ${t('mkt.legalEntitySpecific')}` : ''}${r.organizationId ? ` · ${t('mkt.businessSpecific')}` : ''}`
            }
          />
        )}
      </Loaded>
    </Section>
  );
}

interface Provider {
  id: string;
  capability: string;
  providerCode: string;
  method: string | null;
  currency: string | null;
  environment: string;
  priority: number;
  isFallback: boolean;
  status: string;
  credentialRef: string | null;
  refundSupported: boolean | null;
  version: number;
}

function ProvidersTab({
  m,
  canManage,
  payments,
}: {
  m: MarketView;
  canManage: boolean;
  payments: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const res = useResource<Provider[]>(`/v1/admin/markets/${m.code}/providers`);
  const { run, busy, banner } = useCommand();
  const caps = payments
    ? (['PAYMENT'] as const)
    : PROVIDER_CAPABILITIES.filter((c) => c !== 'PAYMENT');
  const [f, setF] = useState({
    capability: caps[0] as string,
    providerCode: '',
    method: 'CARD',
    currency: m.currency,
    environment: 'SANDBOX',
    priority: '100',
    fallback: false,
    refund: true,
    credentialRef: '',
    status: 'CONFIGURING',
  });
  return (
    <Section
      title={payments ? t('mkt.tab.payments') : t('mkt.tab.providers')}
      testId={payments ? 'mkt-payments' : 'mkt-providers'}
      note={t('mkt.providersNote')}
    >
      {banner}
      {canManage ? (
        <Card flat>
          <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {!payments ? (
              <Field label={t('mkt.capability')} htmlFor="pv-cap">
                <Select
                  id="pv-cap"
                  value={f.capability}
                  onChange={(e) => setF({ ...f, capability: e.target.value })}
                >
                  {caps.map((c) => (
                    <option key={c} value={c}>
                      {label('mkt.cap', c)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label={t('mkt.providerCode')} htmlFor="pv-code">
              <Input
                id="pv-code"
                value={f.providerCode}
                onChange={(e) => setF({ ...f, providerCode: e.target.value.toUpperCase() })}
              />
            </Field>
            {payments ? (
              <Field label={t('mkt.method')} htmlFor="pv-method">
                <Select
                  id="pv-method"
                  value={f.method}
                  onChange={(e) => setF({ ...f, method: e.target.value })}
                >
                  {['CARD', 'WALLET', 'BANK_TRANSFER', 'LOCAL_METHOD'].map((x) => (
                    <option key={x} value={x}>
                      {label('mkt.pmethod', x)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Field label={t('mkt.environment')} htmlFor="pv-env">
              <Select
                id="pv-env"
                value={f.environment}
                onChange={(e) => setF({ ...f, environment: e.target.value })}
              >
                {PROVIDER_ENVIRONMENTS.map((x) => (
                  <option key={x} value={x}>
                    {label('mkt.env', x)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('mkt.credentialRef')} htmlFor="pv-cred" help={t('mkt.credentialHelp')}>
              <Input
                id="pv-cred"
                value={f.credentialRef}
                placeholder="env:NAME"
                onChange={(e) => setF({ ...f, credentialRef: e.target.value })}
              />
            </Field>
            <Field label={t('mkt.priority')} htmlFor="pv-prio">
              <Input
                id="pv-prio"
                inputMode="numeric"
                value={f.priority}
                onChange={(e) => setF({ ...f, priority: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <Field label={t('mkt.status')} htmlFor="pv-status">
              <Select
                id="pv-status"
                value={f.status}
                onChange={(e) => setF({ ...f, status: e.target.value })}
              >
                {PROVIDER_STATUSES.map((x) => (
                  <option key={x} value={x}>
                    {label('mkt.pvstate', x)}
                  </option>
                ))}
              </Select>
            </Field>
            {payments ? (
              <Checkbox
                label={t('mkt.fallback')}
                checked={f.fallback}
                onChange={() => setF({ ...f, fallback: !f.fallback })}
              />
            ) : null}
            <Button
              loading={busy}
              disabled={f.providerCode.length < 2}
              onClick={() =>
                void run(
                  'POST',
                  `/v1/admin/markets/${m.code}/providers`,
                  {
                    capability: payments ? 'PAYMENT' : f.capability,
                    providerCode: f.providerCode,
                    ...(payments
                      ? {
                          method: f.method,
                          currency: f.currency,
                          refundSupported: f.refund,
                          isFallback: f.fallback,
                        }
                      : {}),
                    environment: f.environment,
                    priority: Number(f.priority || 100),
                    status: f.status,
                    credentialRef: f.credentialRef || null,
                  },
                  t('common.saved'),
                  () => res.reload(),
                )
              }
            >
              {t('mkt.addProvider')}
            </Button>
          </div>
        </Card>
      ) : null}
      <Loaded res={res}>
        {(d) => {
          const rows = d.filter((p) =>
            payments ? p.capability === 'PAYMENT' : p.capability !== 'PAYMENT',
          );
          if (!rows.length) return <EmptyState title={t('mkt.noProvider')} />;
          return (
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table">
                <thead>
                  <tr>
                    <th>{t('mkt.capability')}</th>
                    <th>{t('mkt.providerCode')}</th>
                    {payments ? <th>{t('mkt.method')}</th> : null}
                    <th>{t('mkt.environment')}</th>
                    <th>{t('mkt.priority')}</th>
                    <th>{t('mkt.status')}</th>
                    <th>{t('mkt.credentialRef')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>{label('mkt.cap', p.capability)}</td>
                      <td>
                        <code>{p.providerCode}</code>
                        {p.isFallback ? (
                          <span className="dd-muted"> · {t('mkt.fallback')}</span>
                        ) : null}
                      </td>
                      {payments ? <td>{label('mkt.pmethod', p.method)}</td> : null}
                      <td>
                        <StatusChip
                          tone={
                            p.environment === 'PRODUCTION'
                              ? 'success'
                              : p.environment === 'MOCK'
                                ? 'neutral'
                                : 'info'
                          }
                        >
                          {label('mkt.env', p.environment)}
                        </StatusChip>
                      </td>
                      <td>{p.priority}</td>
                      <td>
                        <StatusChip
                          tone={
                            p.status === 'ACTIVE'
                              ? 'success'
                              : p.status === 'SUSPENDED'
                                ? 'danger'
                                : 'neutral'
                          }
                        >
                          {label('mkt.pvstate', p.status)}
                        </StatusChip>
                      </td>
                      <td>{p.credentialRef ? <code>{p.credentialRef}</code> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </Loaded>
    </Section>
  );
}

function ComplianceTab({
  m,
  canManage,
  canApprove,
}: {
  m: MarketView;
  canManage: boolean;
  canApprove: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const res = useResource<Versioned[]>(`/v1/admin/markets/${m.code}/config/policies`);
  const { run, busy, banner } = useCommand();
  const [f, setF] = useState<{
    category: MarketPolicyCategory;
    key: string;
    value: string;
    required: boolean;
    validationCode: string;
  }>({
    category: 'LEGAL_TERMS',
    key: 'CUSTOMER_TERMS',
    value: '',
    required: true,
    validationCode: '',
  });
  return (
    <Section title={t('mkt.tab.compliance')} testId="mkt-compliance" note={t('mkt.complianceNote')}>
      {banner}
      {canManage ? (
        <Card flat>
          <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('mkt.category')} htmlFor="po-cat">
              <Select
                id="po-cat"
                value={f.category}
                onChange={(e) => {
                  const c = e.target.value as MarketPolicyCategory;
                  setF({ ...f, category: c, key: MARKET_POLICY_KEYS[c][0]! });
                }}
              >
                {MARKET_POLICY_CATEGORIES.map((x) => (
                  <option key={x} value={x}>
                    {label('mkt.pcat', x)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('mkt.policy')} htmlFor="po-key">
              <Select
                id="po-key"
                value={f.key}
                onChange={(e) => setF({ ...f, key: e.target.value })}
              >
                {MARKET_POLICY_KEYS[f.category].map((x) => (
                  <option key={x} value={x}>
                    {label('mkt.pkey', x)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('mkt.policyValue')} htmlFor="po-val" help={t('mkt.policyValueHelp')}>
              <Input
                id="po-val"
                value={f.value}
                onChange={(e) => setF({ ...f, value: e.target.value })}
              />
            </Field>
            <Field label={t('mkt.validationCode')} htmlFor="po-vc">
              <Input
                id="po-vc"
                value={f.validationCode}
                onChange={(e) => setF({ ...f, validationCode: e.target.value.toUpperCase() })}
              />
            </Field>
            <Checkbox
              label={t('mkt.requiredForLaunch')}
              checked={f.required}
              onChange={() => setF({ ...f, required: !f.required })}
            />
            <Button
              loading={busy}
              disabled={!f.value.trim()}
              onClick={() =>
                void run(
                  'POST',
                  `/v1/admin/markets/${m.code}/policies`,
                  {
                    category: f.category,
                    key: f.key,
                    value: { reference: f.value },
                    required: f.required,
                    validationCode: f.validationCode || null,
                  },
                  t('mkt.drafted'),
                  () => res.reload(),
                )
              }
            >
              {t('mkt.draftVersion')}
            </Button>
          </div>
        </Card>
      ) : null}
      <Loaded res={res}>
        {(d) => (
          <VersionTable
            rows={d}
            kind="policies"
            canManage={canManage}
            canApprove={canApprove}
            reload={res.reload}
            summary={(r) =>
              `${label('mkt.pcat', String(r.category))} · ${label('mkt.pkey', String(r.key))}${(r.value as { reference?: string; version?: string })?.reference ? ` · ${(r.value as { reference?: string }).reference}` : (r.value as { version?: string })?.version ? ` · ${(r.value as { version?: string }).version}` : ''}${r.validationCode ? ` · ${String(r.validationCode)}` : ''}`
            }
          />
        )}
      </Loaded>
    </Section>
  );
}

interface ValidationItem {
  id: string;
  market: string;
  code: string;
  topic: string;
  description: string;
  status: string;
  blocksActivation: boolean;
  decision: string | null;
  evidenceRef: string | null;
  ownerTeam: string | null;
  reviewDate: string | null;
  sourceRef: string | null;
}

export function ValidationsTab({
  m,
  canManage,
  canApprove,
}: {
  m: MarketView | null;
  canManage: boolean;
  canApprove: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const [status, setStatus] = useState('');
  const res = useResource<ValidationItem[]>('/v1/admin/markets/validations', {
    market: m?.code,
    status: status || undefined,
  });
  const { run, busy, banner } = useCommand();
  const [edit, setEdit] = useState<{
    id: string;
    status: string;
    decision: string;
    evidenceRef: string;
  } | null>(null);
  const [n, setN] = useState({ code: '', topic: '', description: '' });
  return (
    <Section
      title={t('mkt.tab.validations')}
      testId="mkt-validations"
      note={t('mkt.validationsNote')}
      action={
        <Select
          aria-label={t('mkt.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ maxWidth: 220 }}
        >
          <option value="">{t('common.all')}</option>
          {MARKET_VALIDATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label('mkt.valstate', s)}
            </option>
          ))}
        </Select>
      }
    >
      {banner}
      {canManage && m ? (
        <Card flat>
          <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('mkt.validationCode')} htmlFor="vn-code">
              <Input
                id="vn-code"
                value={n.code}
                placeholder={m.code === 'SA' ? 'VALIDATE-KSA-…' : `VALIDATE-${m.code}-…`}
                onChange={(e) => setN({ ...n, code: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={t('mkt.topic')} htmlFor="vn-topic">
              <Input
                id="vn-topic"
                value={n.topic}
                onChange={(e) => setN({ ...n, topic: e.target.value })}
              />
            </Field>
            <Field label={t('bill.description')} htmlFor="vn-desc">
              <Input
                id="vn-desc"
                value={n.description}
                onChange={(e) => setN({ ...n, description: e.target.value })}
              />
            </Field>
            <Button
              loading={busy}
              disabled={n.code.length < 3 || n.topic.length < 2 || n.description.length < 3}
              onClick={() =>
                void run(
                  'POST',
                  `/v1/admin/markets/${m.code}/validations`,
                  { ...n, blocksActivation: true },
                  t('mkt.validationAdded'),
                  () => res.reload(),
                )
              }
            >
              {t('mkt.addValidation')}
            </Button>
          </div>
        </Card>
      ) : null}
      <Loaded res={res} empty={(d) => !d.length}>
        {(d) => (
          <div className="dd-stack" style={{ gap: 8 }}>
            {d.map((v) => (
              <Card flat key={v.id} data-testid={`mkt-validation-${v.code}`}>
                <div className="dd-stack" style={{ gap: 6 }}>
                  <div
                    className="dd-row"
                    style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
                  >
                    <strong>
                      <code>{v.code}</code> · {v.topic}
                    </strong>
                    <div className="dd-row" style={{ gap: 6 }}>
                      {v.blocksActivation ? (
                        <StatusChip tone="warning">{t('mkt.blocksActivation')}</StatusChip>
                      ) : null}
                      <StatusChip tone={VALIDATION_TONE[v.status] ?? 'neutral'}>
                        {label('mkt.valstate', v.status)}
                      </StatusChip>
                    </div>
                  </div>
                  <span>{v.description}</span>
                  {v.decision ? (
                    <span className="dd-muted">
                      {t('mkt.decision')}: {v.decision}
                    </span>
                  ) : null}
                  {v.sourceRef ? (
                    <span className="dd-muted">
                      {t('mkt.source')}: {v.sourceRef}
                    </span>
                  ) : null}
                  {canManage ? (
                    edit?.id === v.id ? (
                      <div
                        className="dd-row"
                        style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
                      >
                        <Field label={t('mkt.status')} htmlFor={`ve-s-${v.id}`}>
                          <Select
                            id={`ve-s-${v.id}`}
                            value={edit.status}
                            onChange={(e) => setEdit({ ...edit, status: e.target.value })}
                          >
                            {MARKET_VALIDATION_STATUSES.filter(
                              (s) => canApprove || ['OPEN', 'IN_REVIEW'].includes(s),
                            ).map((s) => (
                              <option key={s} value={s}>
                                {label('mkt.valstate', s)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label={t('mkt.decision')} htmlFor={`ve-d-${v.id}`}>
                          <Textarea
                            id={`ve-d-${v.id}`}
                            rows={2}
                            value={edit.decision}
                            onChange={(e) => setEdit({ ...edit, decision: e.target.value })}
                          />
                        </Field>
                        <Field label={t('mkt.evidence')} htmlFor={`ve-e-${v.id}`}>
                          <Input
                            id={`ve-e-${v.id}`}
                            value={edit.evidenceRef}
                            onChange={(e) => setEdit({ ...edit, evidenceRef: e.target.value })}
                          />
                        </Field>
                        <Button
                          loading={busy}
                          onClick={() =>
                            void run(
                              'PUT',
                              `/v1/admin/markets/validations/${v.id}`,
                              {
                                status: edit.status,
                                decision: edit.decision || null,
                                evidenceRef: edit.evidenceRef || null,
                              },
                              t('common.saved'),
                              async () => {
                                setEdit(null);
                                await res.reload();
                              },
                            )
                          }
                        >
                          {t('common.save')}
                        </Button>
                        <Button variant="ghost" onClick={() => setEdit(null)}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    ) : (
                      <div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setEdit({
                              id: v.id,
                              status: v.status,
                              decision: v.decision ?? '',
                              evidenceRef: v.evidenceRef ?? '',
                            })
                          }
                        >
                          {t('mkt.update')}
                        </Button>
                      </div>
                    )
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Loaded>
    </Section>
  );
}

function ReadinessTab({ m }: { m: MarketView }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const res = useResource<Readiness>(`/v1/admin/markets/${m.code}/readiness`);
  return (
    <Section title={t('mkt.tab.readiness')} testId="mkt-readiness" note={t('mkt.readinessNote')}>
      <Loaded res={res}>
        {(r) => (
          <div className="dd-stack" style={{ gap: 10 }}>
            <div className="dd-row" style={{ gap: 8, alignItems: 'center' }}>
              <strong>{t('mkt.overall')}</strong>
              <StatusChip tone={READINESS_TONE[r.state] ?? 'neutral'}>
                {label('mkt.ready', r.state)}
              </StatusChip>
            </div>
            {r.state === 'BLOCKED' ? <Alert tone="danger">{t('mkt.blockedNote')}</Alert> : null}
            {r.state === 'VALIDATION_REQUIRED' ? (
              <Alert tone="warning">{t('mkt.validationRequiredNote')}</Alert>
            ) : null}
            {r.state === 'NOT_READY' ? <Alert tone="danger">{t('mkt.notReadyNote')}</Alert> : null}
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table" data-testid="mkt-readiness-table">
                <thead>
                  <tr>
                    <th>{t('mkt.check')}</th>
                    <th>{t('mkt.status')}</th>
                    <th>{t('mkt.detail')}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.items.map((i) => (
                    <tr key={i.check} data-testid={`mkt-check-${i.check}`}>
                      <td>{label('mkt.checkName', i.check)}</td>
                      <td>
                        <StatusChip tone={READINESS_TONE[i.state] ?? 'neutral'}>
                          {label('mkt.cstateCheck', i.state)}
                        </StatusChip>
                      </td>
                      <td className="dd-muted">{i.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Loaded>
    </Section>
  );
}

function HistoryTab({ m }: { m: MarketView }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const res = useResource<
    Array<{
      id: string;
      occurredAt: string;
      action: string;
      entityType: string;
      actorRole: string | null;
      reason: string | null;
      approvalRef: string | null;
    }>
  >(`/v1/admin/markets/${m.code}/history`);
  return (
    <Section title={t('mkt.tab.history')} testId="mkt-history" note={t('mkt.historyNote')}>
      <Loaded res={res} empty={(d) => !d.length}>
        {(d) => (
          <div style={{ overflowX: 'auto' }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('ai.when')}</th>
                  <th>{t('mkt.change')}</th>
                  <th>{t('mkt.by')}</th>
                  <th>{t('common.reason')}</th>
                  <th>{t('mkt.approval')}</th>
                </tr>
              </thead>
              <tbody>
                {d.map((h) => (
                  <tr key={h.id}>
                    <td>{formatDateTime(locale, h.occurredAt)}</td>
                    <td>{label('mkt.action', h.action)}</td>
                    <td>{h.actorRole ?? '-'}</td>
                    <td>{h.reason ?? '-'}</td>
                    <td>{h.approvalRef ? t('mkt.secondApprover') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
    </Section>
  );
}
