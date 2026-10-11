'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CommercialSummary,
  RequirePermission,
  commercialTone,
  errorMessage,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  formatNumber,
  type DictionaryKey,
} from '@dealdash/localization';
import {
  COMMERCIAL_PRODUCTS,
  COMMERCIAL_STATUSES,
  UNUSED_TREATMENTS,
  type CommercialProduct,
  type PricingComponent,
} from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Select,
  StatusChip,
  Tabs,
  Textarea,
} from '@dealdash/ui';
import type { CommercialCaseView, ReconciliationView } from '@dealdash/validation';

const k = (p: string, v: string) => `${p}.${v}` as DictionaryKey;
const toHalalas = (v: string) => Math.round((Number(v.replace(',', '.')) || 0) * 100);
const isoPlus = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

interface Overview {
  cases: Record<string, number>;
  receivablesHalalas: number;
  fundsHeldHalalas: number;
  fundingUtilizedHalalas: number;
  openHolds: number;
  pendingCredit: number;
  exceptions: number;
}
interface CaseRow {
  id: string;
  reference: string;
  product: CommercialProduct;
  status: string;
  ownerName: { en: string; ar: string };
  ownerOrganizationId: string;
  maxCashHalalas: number;
  benefitCommitmentHalalas: number;
  developmentFixture: boolean;
}
interface Agreement {
  id: string;
  name: string;
  scope: string;
  organizationId: string | null;
  entityType: string | null;
  product: string | null;
  priority: number;
  version: number;
  reference: string | null;
  unusedTreatment: string | null;
  taxBps: number | null;
}
interface Rule {
  id: string;
  name: string;
  active: boolean;
  scope: string;
  product: string | null;
  organizationId: string | null;
  minLiabilityHalalas: number | null;
  steps: string[];
}
interface Credit {
  id: string;
  organizationId: string;
  limitHalalas: number;
  exposureHalalas: number;
  availableHalalas: number;
  paymentTermsDays: number;
  expiresAt: string;
  agreementReference: string;
  status: string;
  requestedByName: string | null;
  decidedByName: string | null;
  needsChecker: boolean;
}
interface Hold {
  id: string;
  organizationId: string;
  caseId: string | null;
  reason: string;
  status: string;
  placedAt: string;
}
interface Payment {
  id: string;
  reference: string;
  organizationId: string;
  caseId: string | null;
  amountHalalas: number;
  method: string;
  receivedAt: string;
}
interface Doc {
  id: string;
  number: string;
  type: string;
  status: string;
  organizationId: string;
  totalHalalas: number;
  issuedAt: string;
}
interface Auth {
  id: string;
  organizationId: string;
  reference: string;
  reason: string;
  validUntil: string;
  revoked: boolean;
}

export function AdminCommercialPage() {
  return (
    <RequirePermission any={['admin.finance.read']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const perms = me?.permissions ?? [];
  const [tab, setTab] = useState('overview');
  const tabs = [
    { id: 'overview', label: t('ac.tab.overview') },
    { id: 'cases', label: t('ac.tab.cases') },
    { id: 'pricing', label: t('ac.tab.pricing') },
    { id: 'rules', label: t('ac.tab.rules') },
    { id: 'credit', label: t('ac.tab.credit') },
    { id: 'holds', label: t('ac.tab.holds') },
    { id: 'money', label: t('ac.tab.money') },
    { id: 'auth', label: t('ac.tab.auth') },
  ];
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-commercial">
      <div>
        <h1 className="dd-title-xl">{t('ac.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('ac.sub')}
        </p>
      </div>
      <Tabs label={t('ac.title')} value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'overview' ? <OverviewTab /> : null}
      {tab === 'cases' ? <CasesTab canManage={perms.includes('admin.finance.manage')} /> : null}
      {tab === 'pricing' ? (
        <PricingTab canManage={perms.includes('admin.finance.pricing.manage')} />
      ) : null}
      {tab === 'rules' ? (
        <RulesTab canManage={perms.includes('admin.finance.pricing.manage')} />
      ) : null}
      {tab === 'credit' ? (
        <CreditTab
          canRequest={perms.includes('admin.finance.credit.manage')}
          canApprove={perms.includes('admin.finance.credit.approve')}
        />
      ) : null}
      {tab === 'holds' ? <HoldsTab canManage={perms.includes('admin.finance.manage')} /> : null}
      {tab === 'money' ? <MoneyTab canManage={perms.includes('admin.finance.manage')} /> : null}
      {tab === 'auth' ? <AuthTab canManage={perms.includes('admin.finance.manage')} /> : null}
    </div>
  );
}

/** GET a list once and on demand. */
function useGet<T>(path: string, query?: Record<string, string | undefined>) {
  const { call } = useApi();
  const [data, setData] = useState<T | null>(null);
  const q = JSON.stringify(query ?? {});
  const load = useCallback(async () => {
    const r = await call<T>('GET', path, { query: JSON.parse(q) as Record<string, string> });
    setData(r.ok ? r.data : null);
  }, [call, path, q]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, reload: load };
}

/** Runs a command, reports success or the translated error. */
function useCommand() {
  const { call } = useApi();
  const { locale } = useAuth();
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (
    path: string,
    body: unknown,
    ok: string,
    after?: () => void | Promise<void>,
  ) => {
    setBusy(true);
    const r = await call('POST', path, { body, idempotent: true });
    setBusy(false);
    if (!r.ok) {
      setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
      return false;
    }
    setBanner({ tone: 'success', text: ok });
    await after?.();
    return true;
  };
  const view = banner ? (
    <div data-testid="ac-banner">
      <Alert tone={banner.tone}>{banner.text}</Alert>
    </div>
  ) : null;
  return { run, busy, banner: view };
}

function OverviewTab() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { data } = useGet<Overview>('/v1/admin/commercial/overview');
  if (!data) return <LoadingState label={t('state.loading')} />;
  const money = (v: number) => formatMoney(locale, v);
  const stat = (label: DictionaryKey, value: string, id: string) => (
    <Card flat key={id}>
      <div className="dd-caption">{t(label)}</div>
      <div className="dd-title-xl dd-ltr" style={{ fontSize: 24 }} data-testid={id}>
        {value}
      </div>
    </Card>
  );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ac-overview">
      <div className="dd-finance-grid">
        {stat('ac.ov.receivables', money(data.receivablesHalalas), 'ov-receivables')}
        {stat('ac.ov.held', money(data.fundsHeldHalalas), 'ov-held')}
        {stat('ac.ov.utilized', money(data.fundingUtilizedHalalas), 'ov-utilized')}
        {stat('ac.ov.holds', formatNumber(locale, data.openHolds), 'ov-holds')}
        {stat('ac.ov.credit', formatNumber(locale, data.pendingCredit), 'ov-credit')}
      </div>
      <Card flat>
        <h2 className="dd-title">{t('ac.ov.cases')}</h2>
        <div className="dd-row" style={{ flexWrap: 'wrap', marginBlockStart: 8 }}>
          {COMMERCIAL_STATUSES.map((s) => (
            <StatusChip key={s} tone={commercialTone(s)}>
              {t(k('cm.status', s))}: {formatNumber(locale, data.cases[s] ?? 0)}
            </StatusChip>
          ))}
        </div>
      </Card>
      <Alert tone="info">{t('ac.validateKsa')}</Alert>
    </div>
  );
}

function CasesTab({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [status, setStatus] = useState('');
  const [product, setProduct] = useState('');
  const { data, reload } = useGet<CaseRow[]>('/v1/admin/commercial/cases', {
    status: status || undefined,
    product: product || undefined,
  });
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ac-cases">
      <div className="dd-row">
        <Select
          aria-label={t('ac.filter.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('ac.filter.allStatus')}</option>
          {COMMERCIAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(k('cm.status', s))}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('ac.filter.product')}
          value={product}
          onChange={(e) => setProduct(e.target.value)}
        >
          <option value="">{t('ac.filter.allProduct')}</option>
          {COMMERCIAL_PRODUCTS.map((p) => (
            <option key={p} value={p}>
              {t(k('ac.product', p))}
            </option>
          ))}
        </Select>
      </div>
      {!data ? (
        <LoadingState label={t('state.loading')} />
      ) : data.length === 0 ? (
        <EmptyState title={t('ac.cases.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('ac.col.ref')}</th>
                <th>{t('ac.col.product')}</th>
                <th>{t('ac.col.business')}</th>
                <th>{t('ac.col.status')}</th>
                <th>{t('ac.col.cash')}</th>
                <th>{t('ac.col.benefit')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} data-testid={`ac-case-${c.reference}`}>
                  <td className="dd-ltr">
                    {c.reference}
                    {c.developmentFixture ? (
                      <StatusChip tone="neutral">{t('ac.fixture')}</StatusChip>
                    ) : null}
                  </td>
                  <td>{t(k('ac.product', c.product))}</td>
                  <td>{c.ownerName[locale]}</td>
                  <td>
                    <StatusChip tone={commercialTone(c.status)}>
                      {t(k('cm.status', c.status))}
                    </StatusChip>
                  </td>
                  <td className="dd-ltr">{formatMoney(locale, c.maxCashHalalas)}</td>
                  <td className="dd-ltr">{formatMoney(locale, c.benefitCommitmentHalalas)}</td>
                  <td>
                    <Button
                      variant="outline"
                      onClick={() => setOpen(open === c.id ? null : c.id)}
                      data-testid={`ac-open-${c.reference}`}
                    >
                      {t('ac.open')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? <CaseDetail id={open} canManage={canManage} onChanged={reload} /> : null}
    </div>
  );
}

function CaseDetail({
  id,
  canManage,
  onChanged,
}: {
  id: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { data, reload } = useGet<CommercialCaseView>(`/v1/admin/commercial/cases/${id}`);
  const rec = useGet<ReconciliationView>(`/v1/admin/commercial/cases/${id}/reconciliation`);
  const auths = useGet<Auth[]>('/v1/admin/commercial/authorizations');
  const cmd = useCommand();
  const [authId, setAuthId] = useState('');
  const [holdReason, setHoldReason] = useState('');
  if (!data) return <LoadingState label={t('state.loading')} />;
  const refresh = async () => {
    await reload();
    await rec.reload();
    onChanged();
  };
  const base = `/v1/admin/commercial/cases/${id}`;
  const pendingParties =
    data.preview?.parties.filter(
      (p) =>
        p.role !== 'FULFILMENT_MERCHANT' &&
        !data.acceptances.some(
          (a) =>
            a.organizationId === p.organizationId &&
            a.role === p.role &&
            a.quotationId === data.quotation?.id,
        ),
    ) ?? [];
  return (
    <Card>
      <div className="dd-stack" style={{ gap: 14 }} data-testid="ac-case-detail">
        <div className="dd-row" style={{ justifyContent: 'space-between' }}>
          <h2 className="dd-title dd-ltr">{data.reference}</h2>
          <StatusChip tone={commercialTone(data.status)}>
            {t(k('cm.status', data.status))}
          </StatusChip>
        </div>
        {cmd.banner}
        {data.hold.active ? (
          <Alert tone="danger">{t('ac.holdActive', { reason: data.hold.reason ?? '' })}</Alert>
        ) : null}
        {data.preview ? <CommercialSummary preview={data.preview} locale={locale} /> : null}
        {data.blockers.length ? (
          <div data-testid="ac-blockers">
            <strong>{t('cm.blockers.title')}</strong>
            <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
              {data.blockers.map((b, i) => (
                <li key={i} data-testid={`ac-blocker-${b.code}`}>
                  {t(k('cm.blocker', b.code))}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Alert tone="success">{t('cm.clear')}</Alert>
        )}
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('cm.funding.party')}</th>
                <th>{t('cm.funding.mode')}</th>
                <th>{t('cm.funding.max')}</th>
                <th>{t('cm.funding.received')}</th>
                <th>{t('cm.funding.used')}</th>
                <th>{t('cm.funding.outstanding')}</th>
              </tr>
            </thead>
            <tbody>
              {data.funding.map((f) => (
                <tr key={f.id}>
                  <td>{t(k('cm.role', f.role))}</td>
                  <td>{t(k('cm.mode', f.mode))}</td>
                  <td className="dd-ltr">{formatMoney(locale, f.maxHalalas)}</td>
                  <td className="dd-ltr">{formatMoney(locale, f.receivedHalalas)}</td>
                  <td className="dd-ltr">{formatMoney(locale, f.earnedHalalas)}</td>
                  <td className="dd-ltr">{formatMoney(locale, f.outstandingHalalas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rec.data ? (
          <div data-testid="ac-recon">
            <strong>{t('ac.recon.title')}</strong>
            <dl className="dd-kv" style={{ marginBlockStart: 4 }}>
              <div className="dd-kv__row">
                <dt>{t('ac.recon.inventory')}</dt>
                <dd>
                  {t('ac.recon.inv', {
                    configured: rec.data.inventory.configured,
                    issued: rec.data.inventory.issued,
                    redeemed: rec.data.inventory.redeemed,
                    unused: rec.data.inventory.expiredOrUnused,
                  })}
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('ac.recon.benefit')}</dt>
                <dd className="dd-ltr">
                  {formatMoney(locale, rec.data.merchantBenefit.redeemedHalalas)} /{' '}
                  {formatMoney(locale, rec.data.merchantBenefit.committedHalalas)}{' '}
                  <span className="dd-muted">({t('ac.recon.nonCash')})</span>
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('ac.recon.treatment')}</dt>
                <dd>
                  {rec.data.treatment
                    ? t(k('ac.treatment', rec.data.treatment))
                    : t('ac.treatment.NONE')}
                </dd>
              </div>
              {rec.data.exceptions.length ? (
                <div className="dd-kv__row">
                  <dt>{t('ac.recon.exceptions')}</dt>
                  <dd>{rec.data.exceptions.join(', ')}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
        {canManage && data.status !== 'CLOSED' ? (
          <div className="dd-stack" style={{ gap: 10 }}>
            <div className="dd-row" style={{ flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                loading={cmd.busy}
                onClick={() =>
                  void cmd.run(`${base}/apply-agreement`, {}, t('ac.applied'), refresh)
                }
                data-testid="ac-apply-agreement"
              >
                {t('ac.applyAgreement')}
              </Button>
              <Button
                variant="secondary"
                loading={cmd.busy}
                onClick={() => void cmd.run(`${base}/close`, {}, t('ac.closed'), refresh)}
                data-testid="ac-close"
              >
                {t('ac.close')}
              </Button>
            </div>
            {pendingParties.length ? (
              <div className="dd-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <Field label={t('ac.onBehalf.auth')} htmlFor="ac-auth">
                  <Select id="ac-auth" value={authId} onChange={(e) => setAuthId(e.target.value)}>
                    <option value="">{t('ac.onBehalf.pick')}</option>
                    {(auths.data ?? [])
                      .filter(
                        (a) =>
                          !a.revoked &&
                          pendingParties.some((p) => p.organizationId === a.organizationId),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.reference}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Button
                  disabled={!authId}
                  loading={cmd.busy}
                  data-testid="ac-accept-on-behalf"
                  onClick={() => {
                    const a = auths.data?.find((x) => x.id === authId);
                    const p = pendingParties.find((x) => x.organizationId === a?.organizationId);
                    if (!a || !p || !data.quotation) return;
                    void cmd.run(
                      `${base}/accept-on-behalf`,
                      {
                        quotationId: data.quotation.id,
                        checks: p.requiredChecks,
                        language: locale,
                        organizationId: p.organizationId,
                        role: p.role,
                        authorizationId: a.id,
                      },
                      t('ac.onBehalf.done'),
                      refresh,
                    );
                  }}
                >
                  {t('ac.onBehalf.accept')}
                </Button>
              </div>
            ) : null}
            <div className="dd-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field label={t('ac.hold.reason')} htmlFor="ac-hold-reason">
                <Input
                  id="ac-hold-reason"
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                />
              </Field>
              <Button
                variant="outline"
                disabled={holdReason.trim().length < 3}
                loading={cmd.busy}
                onClick={() =>
                  void cmd.run(
                    '/v1/admin/commercial/holds',
                    { organizationId: data.ownerOrganizationId, caseId: id, reason: holdReason },
                    t('ac.hold.placed'),
                    refresh,
                  )
                }
              >
                {t('ac.hold.place')}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

const EMPTY_COMPONENT: PricingComponent = {
  code: 'redemption_fee',
  label: { en: 'Redemption fee', ar: 'رسوم الاستخدام' },
  enabled: true,
  basis: 'PER_UNIT',
  amountHalalas: 100,
  trigger: 'VERIFIED_REDEMPTION',
  collection: 'CASH',
  taxable: true,
};

function PricingTab({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { data, reload } = useGet<Agreement[]>('/v1/admin/commercial/pricing');
  const cmd = useCommand();
  const [f, setF] = useState({
    name: '',
    scope: 'GLOBAL',
    organizationId: '',
    product: 'EXCLUSIVE',
    priority: '100',
    treatment: '',
    tax: '',
    reference: '',
  });
  const [comp, setComp] = useState<PricingComponent>(EMPTY_COMPONENT);
  const [amount, setAmount] = useState('1');
  const [bps, setBps] = useState('0');
  const submit = () => {
    const c: PricingComponent = {
      ...comp,
      ...(comp.basis === 'PERCENT_OF_BASE'
        ? { bps: Number(bps) || 0, base: comp.base ?? 'SELLING_PRICE', amountHalalas: undefined }
        : { amountHalalas: toHalalas(amount), bps: undefined, base: undefined }),
    };
    void cmd.run(
      '/v1/admin/commercial/pricing',
      {
        name: f.name,
        scope: f.scope,
        ...(f.scope === 'ORGANIZATION' ? { organizationId: f.organizationId } : {}),
        product: f.product,
        priority: Number(f.priority) || 100,
        components: { [f.product]: [c] },
        taxBps: f.tax === '' ? null : Number(f.tax),
        unusedTreatment: f.treatment === '' ? null : f.treatment,
        reference: f.reference || undefined,
      },
      t('ac.pricing.created'),
      reload,
    );
  };
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ac-pricing">
      <Alert tone="info">{t('ac.pricing.note')}</Alert>
      {!data ? (
        <LoadingState label={t('state.loading')} />
      ) : data.length === 0 ? (
        <EmptyState title={t('ac.pricing.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('ac.col.name')}</th>
                <th>{t('ac.col.scope')}</th>
                <th>{t('ac.col.product')}</th>
                <th>{t('ac.col.version')}</th>
                <th>{t('ac.col.treatment')}</th>
                <th>{t('ac.col.tax')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td>
                  <td>{t(k('ac.scope', a.scope))}</td>
                  <td>{a.product ? t(k('ac.product', a.product)) : t('ac.allProducts')}</td>
                  <td>v{a.version}</td>
                  <td>
                    {a.unusedTreatment
                      ? t(k('ac.treatment', a.unusedTreatment))
                      : t('ac.treatment.NONE')}
                  </td>
                  <td>
                    {a.taxBps === null
                      ? t('cm.taxNotConfiguredShort')
                      : `${(a.taxBps ?? 0) / 100}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <Card flat>
          <div className="dd-stack" style={{ gap: 10 }}>
            <h2 className="dd-title">{t('ac.pricing.new')}</h2>
            {cmd.banner}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
              }}
            >
              <Field label={t('ac.col.name')} htmlFor="pr-name">
                <Input
                  id="pr-name"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                />
              </Field>
              <Field label={t('ac.col.scope')} htmlFor="pr-scope">
                <Select
                  id="pr-scope"
                  value={f.scope}
                  onChange={(e) => setF({ ...f, scope: e.target.value })}
                >
                  {['GLOBAL', 'ORGANIZATION'].map((s) => (
                    <option key={s} value={s}>
                      {t(k('ac.scope', s))}
                    </option>
                  ))}
                </Select>
              </Field>
              {f.scope === 'ORGANIZATION' ? (
                <Field label={t('ac.col.orgId')} htmlFor="pr-org">
                  <Input
                    id="pr-org"
                    dir="ltr"
                    value={f.organizationId}
                    onChange={(e) => setF({ ...f, organizationId: e.target.value.trim() })}
                  />
                </Field>
              ) : null}
              <Field label={t('ac.col.product')} htmlFor="pr-product">
                <Select
                  id="pr-product"
                  value={f.product}
                  onChange={(e) => setF({ ...f, product: e.target.value })}
                >
                  {COMMERCIAL_PRODUCTS.map((p) => (
                    <option key={p} value={p}>
                      {t(k('ac.product', p))}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('ac.pricing.component')} htmlFor="pr-code">
                <Input
                  id="pr-code"
                  value={comp.code}
                  onChange={(e) => setComp({ ...comp, code: e.target.value })}
                />
              </Field>
              <Field label={t('ac.pricing.labelEn')} htmlFor="pr-len">
                <Input
                  id="pr-len"
                  value={comp.label.en}
                  onChange={(e) =>
                    setComp({ ...comp, label: { ...comp.label, en: e.target.value } })
                  }
                />
              </Field>
              <Field label={t('ac.pricing.labelAr')} htmlFor="pr-lar">
                <Input
                  id="pr-lar"
                  value={comp.label.ar}
                  onChange={(e) =>
                    setComp({ ...comp, label: { ...comp.label, ar: e.target.value } })
                  }
                />
              </Field>
              <Field label={t('ac.pricing.basis')} htmlFor="pr-basis">
                <Select
                  id="pr-basis"
                  value={comp.basis}
                  onChange={(e) =>
                    setComp({ ...comp, basis: e.target.value as PricingComponent['basis'] })
                  }
                >
                  {['FIXED', 'PER_UNIT', 'PERCENT_OF_BASE'].map((b) => (
                    <option key={b} value={b}>
                      {t(k('ac.basis', b))}
                    </option>
                  ))}
                </Select>
              </Field>
              {comp.basis === 'PERCENT_OF_BASE' ? (
                <>
                  <Field label={t('ac.pricing.bps')} htmlFor="pr-bps">
                    <Input
                      id="pr-bps"
                      inputMode="numeric"
                      value={bps}
                      onChange={(e) => setBps(e.target.value)}
                    />
                  </Field>
                  <Field label={t('ac.pricing.base')} htmlFor="pr-base">
                    <Select
                      id="pr-base"
                      value={comp.base ?? 'SELLING_PRICE'}
                      onChange={(e) =>
                        setComp({ ...comp, base: e.target.value as PricingComponent['base'] })
                      }
                    >
                      {['SELLING_PRICE', 'FACE_VALUE', 'MEDIA_SPEND', 'BENEFIT_VALUE'].map((b) => (
                        <option key={b} value={b}>
                          {t(k('ac.base', b))}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              ) : (
                <Field label={t('ac.pricing.amount')} htmlFor="pr-amt">
                  <Input
                    id="pr-amt"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
              )}
              <Field label={t('ac.pricing.trigger')} htmlFor="pr-trig">
                <Select
                  id="pr-trig"
                  value={comp.trigger}
                  onChange={(e) =>
                    setComp({ ...comp, trigger: e.target.value as PricingComponent['trigger'] })
                  }
                >
                  {['UPFRONT', 'VERIFIED_REDEMPTION', 'SALE'].map((b) => (
                    <option key={b} value={b}>
                      {t(k('cm.trigger', b))}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('ac.pricing.collection')} htmlFor="pr-coll">
                <Select
                  id="pr-coll"
                  value={comp.collection}
                  onChange={(e) =>
                    setComp({
                      ...comp,
                      collection: e.target.value as PricingComponent['collection'],
                    })
                  }
                >
                  {['CASH', 'NETTED'].map((b) => (
                    <option key={b} value={b}>
                      {t(k('ac.collection', b))}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('ac.col.treatment')} htmlFor="pr-treat">
                <Select
                  id="pr-treat"
                  value={f.treatment}
                  onChange={(e) => setF({ ...f, treatment: e.target.value })}
                >
                  <option value="">{t('ac.treatment.NONE')}</option>
                  {UNUSED_TREATMENTS.map((x) => (
                    <option key={x} value={x}>
                      {t(k('ac.treatment', x))}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('ac.pricing.taxBps')} htmlFor="pr-tax" help={t('ac.pricing.taxHelp')}>
                <Input
                  id="pr-tax"
                  inputMode="numeric"
                  value={f.tax}
                  onChange={(e) => setF({ ...f, tax: e.target.value })}
                />
              </Field>
              <Field label={t('ac.pricing.reference')} htmlFor="pr-ref">
                <Input
                  id="pr-ref"
                  value={f.reference}
                  onChange={(e) => setF({ ...f, reference: e.target.value })}
                />
              </Field>
            </div>
            <div>
              <Button
                disabled={f.name.trim().length < 2}
                loading={cmd.busy}
                onClick={submit}
                data-testid="ac-pricing-create"
              >
                {t('ac.pricing.create')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function RulesTab({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { data, reload } = useGet<Rule[]>('/v1/admin/commercial/approval-rules');
  const cmd = useCommand();
  const [f, setF] = useState({
    name: '',
    scope: 'CAMPAIGN',
    product: '',
    organizationId: '',
    min: '',
    internal: false,
    finance: true,
  });
  const create = () =>
    void cmd.run(
      '/v1/admin/commercial/approval-rules',
      {
        name: f.name,
        scope: f.scope,
        ...(f.product ? { product: f.product } : {}),
        ...(f.organizationId ? { organizationId: f.organizationId } : {}),
        ...(f.min ? { minLiabilityHalalas: toHalalas(f.min) } : {}),
        steps: [
          ...(f.internal ? ['INTERNAL_APPROVER'] : []),
          ...(f.finance ? ['FINANCE_APPROVER'] : []),
        ],
      },
      t('ac.rules.created'),
      reload,
    );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ac-rules">
      <Alert tone="info">{t('ac.rules.note')}</Alert>
      {!data ? (
        <LoadingState label={t('state.loading')} />
      ) : data.length === 0 ? (
        <EmptyState title={t('ac.rules.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('ac.col.name')}</th>
                <th>{t('ac.col.scope')}</th>
                <th>{t('ac.rules.min')}</th>
                <th>{t('ac.rules.steps')}</th>
                <th>{t('ac.col.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{t(k('ac.ruleScope', r.scope))}</td>
                  <td className="dd-ltr">
                    {r.minLiabilityHalalas === null
                      ? '-'
                      : formatMoney(locale, r.minLiabilityHalalas)}
                  </td>
                  <td>{r.steps.map((s) => t(k('cm.step', s))).join(' + ') || '-'}</td>
                  <td>
                    <StatusChip tone={r.active ? 'success' : 'neutral'}>
                      {r.active ? t('ac.rules.active') : t('ac.rules.off')}
                    </StatusChip>
                  </td>
                  <td>
                    {canManage ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void cmd.run(
                            `/v1/admin/commercial/approval-rules/${r.id}/${r.active ? 'disable' : 'enable'}`,
                            {},
                            t('ac.rules.updated'),
                            reload,
                          )
                        }
                      >
                        {r.active ? t('ac.rules.disable') : t('ac.rules.enable')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <Card flat>
          <div className="dd-stack" style={{ gap: 10 }}>
            <h2 className="dd-title">{t('ac.rules.new')}</h2>
            {cmd.banner}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
              }}
            >
              <Field label={t('ac.col.name')} htmlFor="ru-name">
                <Input
                  id="ru-name"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                />
              </Field>
              <Field label={t('ac.col.scope')} htmlFor="ru-scope">
                <Select
                  id="ru-scope"
                  value={f.scope}
                  onChange={(e) => setF({ ...f, scope: e.target.value })}
                >
                  {['CAMPAIGN', 'CREDIT'].map((s) => (
                    <option key={s} value={s}>
                      {t(k('ac.ruleScope', s))}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('ac.col.orgId')} htmlFor="ru-org" help={t('ac.rules.orgHelp')}>
                <Input
                  id="ru-org"
                  dir="ltr"
                  value={f.organizationId}
                  onChange={(e) => setF({ ...f, organizationId: e.target.value.trim() })}
                />
              </Field>
              <Field label={t('ac.rules.min')} htmlFor="ru-min">
                <Input
                  id="ru-min"
                  inputMode="decimal"
                  value={f.min}
                  onChange={(e) => setF({ ...f, min: e.target.value })}
                />
              </Field>
            </div>
            <label className="dd-checkbox">
              <input
                type="checkbox"
                checked={f.internal}
                onChange={(e) => setF({ ...f, internal: e.target.checked })}
              />
              <span>{t(k('cm.step', 'INTERNAL_APPROVER'))}</span>
            </label>
            <label className="dd-checkbox">
              <input
                type="checkbox"
                checked={f.finance}
                onChange={(e) => setF({ ...f, finance: e.target.checked })}
              />
              <span>{t(k('cm.step', 'FINANCE_APPROVER'))}</span>
            </label>
            <div>
              <Button
                disabled={f.name.trim().length < 2 || (!f.internal && !f.finance)}
                loading={cmd.busy}
                onClick={create}
                data-testid="ac-rule-create"
              >
                {t('ac.rules.create')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function CreditTab({ canRequest, canApprove }: { canRequest: boolean; canApprove: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { data, reload } = useGet<Credit[]>('/v1/admin/commercial/credit');
  const cmd = useCommand();
  const [f, setF] = useState({ organizationId: '', limit: '', days: '30', months: '12', ref: '' });
  const [reason, setReason] = useState('');
  const decide = (id: string, what: string) =>
    void cmd.run(
      `/v1/admin/commercial/credit/${id}/${what}`,
      { reason: reason || t('ac.credit.defaultReason') },
      t('ac.credit.updated'),
      reload,
    );
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ac-credit">
      <Alert tone="info">{t('ac.credit.note')}</Alert>
      {cmd.banner}
      {!data ? (
        <LoadingState label={t('state.loading')} />
      ) : data.length === 0 ? (
        <EmptyState title={t('ac.credit.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('ac.col.orgId')}</th>
                <th>{t('ac.credit.limit')}</th>
                <th>{t('ac.credit.exposure')}</th>
                <th>{t('ac.credit.available')}</th>
                <th>{t('ac.credit.terms')}</th>
                <th>{t('ac.credit.expires')}</th>
                <th>{t('ac.col.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} data-testid={`ac-credit-${c.agreementReference}`}>
                  <td className="dd-ltr">{c.organizationId.slice(0, 8)}</td>
                  <td className="dd-ltr">{formatMoney(locale, c.limitHalalas)}</td>
                  <td className="dd-ltr">{formatMoney(locale, c.exposureHalalas)}</td>
                  <td className="dd-ltr">{formatMoney(locale, c.availableHalalas)}</td>
                  <td>{t('ac.credit.days', { n: c.paymentTermsDays })}</td>
                  <td>{formatDateTime(locale, c.expiresAt)}</td>
                  <td>
                    <StatusChip
                      tone={
                        c.status === 'ACTIVE'
                          ? 'success'
                          : c.status === 'PENDING_APPROVAL'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {t(k('ac.creditStatus', c.status))}
                    </StatusChip>
                  </td>
                  <td>
                    {canApprove && c.status === 'PENDING_APPROVAL' ? (
                      <span className="dd-row">
                        <Button
                          variant="secondary"
                          onClick={() => decide(c.id, 'approve')}
                          data-testid="ac-credit-approve"
                        >
                          {t('ac.credit.approve')}
                        </Button>
                        <Button variant="outline" onClick={() => decide(c.id, 'reject')}>
                          {t('ac.credit.reject')}
                        </Button>
                      </span>
                    ) : null}
                    {canApprove && c.status === 'ACTIVE' ? (
                      <Button variant="outline" onClick={() => decide(c.id, 'suspend')}>
                        {t('ac.credit.suspend')}
                      </Button>
                    ) : null}
                    {canApprove && c.status === 'SUSPENDED' ? (
                      <Button variant="outline" onClick={() => decide(c.id, 'reinstate')}>
                        {t('ac.credit.reinstate')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canApprove ? (
        <Field label={t('ac.credit.reason')} htmlFor="cr-reason">
          <Input id="cr-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      ) : null}
      {canRequest ? (
        <Card flat>
          <div className="dd-stack" style={{ gap: 10 }}>
            <h2 className="dd-title">{t('ac.credit.new')}</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 12,
              }}
            >
              <Field label={t('ac.col.orgId')} htmlFor="cr-org">
                <Input
                  id="cr-org"
                  dir="ltr"
                  value={f.organizationId}
                  onChange={(e) => setF({ ...f, organizationId: e.target.value.trim() })}
                />
              </Field>
              <Field label={t('ac.credit.limit')} htmlFor="cr-limit">
                <Input
                  id="cr-limit"
                  inputMode="decimal"
                  value={f.limit}
                  onChange={(e) => setF({ ...f, limit: e.target.value })}
                />
              </Field>
              <Field label={t('ac.credit.termsDays')} htmlFor="cr-days">
                <Input
                  id="cr-days"
                  inputMode="numeric"
                  value={f.days}
                  onChange={(e) => setF({ ...f, days: e.target.value })}
                />
              </Field>
              <Field label={t('ac.credit.validMonths')} htmlFor="cr-months">
                <Input
                  id="cr-months"
                  inputMode="numeric"
                  value={f.months}
                  onChange={(e) => setF({ ...f, months: e.target.value })}
                />
              </Field>
              <Field label={t('ac.credit.agreementRef')} htmlFor="cr-ref">
                <Input
                  id="cr-ref"
                  value={f.ref}
                  onChange={(e) => setF({ ...f, ref: e.target.value })}
                />
              </Field>
            </div>
            <div>
              <Button
                disabled={!f.organizationId || !f.limit || f.ref.trim().length < 2}
                loading={cmd.busy}
                data-testid="ac-credit-request"
                onClick={() =>
                  void cmd.run(
                    '/v1/admin/commercial/credit',
                    {
                      organizationId: f.organizationId,
                      limitHalalas: toHalalas(f.limit),
                      paymentTermsDays: Number(f.days) || 0,
                      expiresAt: isoPlus((Number(f.months) || 12) * 30),
                      agreementReference: f.ref,
                    },
                    t('ac.credit.requested'),
                    reload,
                  )
                }
              >
                {t('ac.credit.request')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function HoldsTab({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { data, reload } = useGet<Hold[]>('/v1/admin/commercial/holds');
  const cmd = useCommand();
  const [f, setF] = useState({ organizationId: '', reason: '' });
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ac-holds">
      {cmd.banner}
      {!data ? (
        <LoadingState label={t('state.loading')} />
      ) : data.length === 0 ? (
        <EmptyState title={t('ac.holds.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('ac.col.orgId')}</th>
                <th>{t('ac.holds.scope')}</th>
                <th>{t('ac.hold.reason')}</th>
                <th>{t('ac.col.status')}</th>
                <th>{t('ac.holds.placed')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((h) => (
                <tr key={h.id}>
                  <td className="dd-ltr">{h.organizationId.slice(0, 8)}</td>
                  <td>{h.caseId ? t('ac.holds.case') : t('ac.holds.org')}</td>
                  <td>{h.reason}</td>
                  <td>
                    <StatusChip tone={h.status === 'ACTIVE' ? 'danger' : 'neutral'}>
                      {h.status === 'ACTIVE' ? t('ac.holds.active') : t('ac.holds.released')}
                    </StatusChip>
                  </td>
                  <td>{formatDateTime(locale, h.placedAt)}</td>
                  <td>
                    {canManage && h.status === 'ACTIVE' ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void cmd.run(
                            `/v1/admin/commercial/holds/${h.id}/release`,
                            { reason: t('ac.holds.releaseReason') },
                            t('ac.holds.releasedMsg'),
                            reload,
                          )
                        }
                        data-testid="ac-hold-release"
                      >
                        {t('ac.holds.release')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <Card flat>
          <div className="dd-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={t('ac.col.orgId')} htmlFor="ho-org">
              <Input
                id="ho-org"
                dir="ltr"
                value={f.organizationId}
                onChange={(e) => setF({ ...f, organizationId: e.target.value.trim() })}
              />
            </Field>
            <Field label={t('ac.hold.reason')} htmlFor="ho-reason">
              <Input
                id="ho-reason"
                value={f.reason}
                onChange={(e) => setF({ ...f, reason: e.target.value })}
              />
            </Field>
            <Button
              disabled={!f.organizationId || f.reason.trim().length < 3}
              loading={cmd.busy}
              onClick={() =>
                void cmd.run('/v1/admin/commercial/holds', f, t('ac.hold.placed'), reload)
              }
            >
              {t('ac.hold.place')}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function MoneyTab({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const pay = useGet<Payment[]>('/v1/admin/commercial/payments');
  const docs = useGet<Doc[]>('/v1/admin/commercial/documents');
  const cmd = useCommand();
  const [p, setP] = useState({
    organizationId: '',
    caseId: '',
    amount: '',
    method: 'BANK_TRANSFER',
    ref: '',
  });
  const [d, setD] = useState({
    type: 'INVOICE',
    organizationId: '',
    description: '',
    amount: '',
    related: '',
  });
  const [a, setA] = useState({ organizationId: '', kind: 'CREDIT', amount: '', reason: '' });
  const reloadAll = async () => {
    await pay.reload();
    await docs.reload();
  };
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ac-money">
      <Alert tone="info">{t('ac.validateKsa')}</Alert>
      {cmd.banner}
      <Card flat>
        <h2 className="dd-title">{t('ac.pay.title')}</h2>
        {pay.data && pay.data.length ? (
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('ac.col.ref')}</th>
                  <th>{t('ac.col.orgId')}</th>
                  <th>{t('ac.pay.amount')}</th>
                  <th>{t('ac.pay.method')}</th>
                  <th>{t('ac.pay.received')}</th>
                </tr>
              </thead>
              <tbody>
                {pay.data.map((x) => (
                  <tr key={x.id}>
                    <td className="dd-ltr">{x.reference}</td>
                    <td className="dd-ltr">{x.organizationId.slice(0, 8)}</td>
                    <td className="dd-ltr">{formatMoney(locale, x.amountHalalas)}</td>
                    <td>{x.method}</td>
                    <td>{formatDateTime(locale, x.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="dd-muted">{t('ac.pay.empty')}</p>
        )}
        {canManage ? (
          <div
            className="dd-row"
            style={{ alignItems: 'flex-end', flexWrap: 'wrap', marginBlockStart: 12 }}
          >
            <Field label={t('ac.col.orgId')} htmlFor="pm-org">
              <Input
                id="pm-org"
                dir="ltr"
                value={p.organizationId}
                onChange={(e) => setP({ ...p, organizationId: e.target.value.trim() })}
              />
            </Field>
            <Field label={t('ac.pay.caseId')} htmlFor="pm-case">
              <Input
                id="pm-case"
                dir="ltr"
                value={p.caseId}
                onChange={(e) => setP({ ...p, caseId: e.target.value.trim() })}
              />
            </Field>
            <Field label={t('ac.pay.amount')} htmlFor="pm-amt">
              <Input
                id="pm-amt"
                inputMode="decimal"
                value={p.amount}
                onChange={(e) => setP({ ...p, amount: e.target.value })}
              />
            </Field>
            <Field label={t('ac.pay.method')} htmlFor="pm-method">
              <Select
                id="pm-method"
                value={p.method}
                onChange={(e) => setP({ ...p, method: e.target.value })}
              >
                {['BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('ac.pay.external')} htmlFor="pm-ext">
              <Input
                id="pm-ext"
                value={p.ref}
                onChange={(e) => setP({ ...p, ref: e.target.value })}
              />
            </Field>
            <Button
              disabled={!p.organizationId || !p.amount}
              loading={cmd.busy}
              data-testid="ac-record-payment"
              onClick={() =>
                void cmd.run(
                  '/v1/admin/commercial/payments',
                  {
                    organizationId: p.organizationId,
                    ...(p.caseId ? { caseId: p.caseId } : {}),
                    amountHalalas: toHalalas(p.amount),
                    method: p.method,
                    externalReference: p.ref || undefined,
                  },
                  t('ac.pay.recorded'),
                  reloadAll,
                )
              }
            >
              {t('ac.pay.record')}
            </Button>
          </div>
        ) : null}
      </Card>
      <Card flat>
        <h2 className="dd-title">{t('ac.docs.title')}</h2>
        {docs.data && docs.data.length ? (
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('ac.docs.number')}</th>
                  <th>{t('ac.docs.type')}</th>
                  <th>{t('ac.col.orgId')}</th>
                  <th>{t('ac.docs.total')}</th>
                  <th>{t('ac.docs.issued')}</th>
                </tr>
              </thead>
              <tbody>
                {docs.data.map((x) => (
                  <tr key={x.id}>
                    <td className="dd-ltr">{x.number}</td>
                    <td>{t(k('ac.doc', x.type))}</td>
                    <td className="dd-ltr">{x.organizationId.slice(0, 8)}</td>
                    <td className="dd-ltr">{formatMoney(locale, x.totalHalalas)}</td>
                    <td>{formatDateTime(locale, x.issuedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="dd-muted">{t('ac.docs.empty')}</p>
        )}
        {canManage ? (
          <div
            className="dd-row"
            style={{ alignItems: 'flex-end', flexWrap: 'wrap', marginBlockStart: 12 }}
          >
            <Field label={t('ac.docs.type')} htmlFor="dc-type">
              <Select
                id="dc-type"
                value={d.type}
                onChange={(e) => setD({ ...d, type: e.target.value })}
              >
                {['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'RECEIPT', 'PURCHASE_ORDER'].map((x) => (
                  <option key={x} value={x}>
                    {t(k('ac.doc', x))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('ac.col.orgId')} htmlFor="dc-org">
              <Input
                id="dc-org"
                dir="ltr"
                value={d.organizationId}
                onChange={(e) => setD({ ...d, organizationId: e.target.value.trim() })}
              />
            </Field>
            <Field label={t('ac.docs.description')} htmlFor="dc-desc">
              <Input
                id="dc-desc"
                value={d.description}
                onChange={(e) => setD({ ...d, description: e.target.value })}
              />
            </Field>
            <Field label={t('ac.pay.amount')} htmlFor="dc-amt">
              <Input
                id="dc-amt"
                inputMode="decimal"
                value={d.amount}
                onChange={(e) => setD({ ...d, amount: e.target.value })}
              />
            </Field>
            {d.type === 'CREDIT_NOTE' || d.type === 'DEBIT_NOTE' ? (
              <Field label={t('ac.docs.related')} htmlFor="dc-rel">
                <Input
                  id="dc-rel"
                  dir="ltr"
                  value={d.related}
                  onChange={(e) => setD({ ...d, related: e.target.value.trim() })}
                />
              </Field>
            ) : null}
            <Button
              disabled={!d.organizationId || !d.description || !d.amount}
              loading={cmd.busy}
              onClick={() =>
                void cmd.run(
                  '/v1/admin/commercial/documents',
                  {
                    type: d.type,
                    organizationId: d.organizationId,
                    ...(d.related ? { relatedDocumentId: d.related } : {}),
                    lines: [{ description: d.description, amountHalalas: toHalalas(d.amount) }],
                    taxHalalas: 0,
                  },
                  t('ac.docs.issuedMsg'),
                  reloadAll,
                )
              }
            >
              {t('ac.docs.issue')}
            </Button>
          </div>
        ) : null}
      </Card>
      {canManage ? (
        <Card flat>
          <h2 className="dd-title">{t('ac.adj.title')}</h2>
          <div
            className="dd-row"
            style={{ alignItems: 'flex-end', flexWrap: 'wrap', marginBlockStart: 8 }}
          >
            <Field label={t('ac.col.orgId')} htmlFor="aj-org">
              <Input
                id="aj-org"
                dir="ltr"
                value={a.organizationId}
                onChange={(e) => setA({ ...a, organizationId: e.target.value.trim() })}
              />
            </Field>
            <Field label={t('ac.adj.kind')} htmlFor="aj-kind">
              <Select
                id="aj-kind"
                value={a.kind}
                onChange={(e) => setA({ ...a, kind: e.target.value })}
              >
                {['CREDIT', 'DEBIT'].map((x) => (
                  <option key={x} value={x}>
                    {t(k('ac.adj', x))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('ac.pay.amount')} htmlFor="aj-amt">
              <Input
                id="aj-amt"
                inputMode="decimal"
                value={a.amount}
                onChange={(e) => setA({ ...a, amount: e.target.value })}
              />
            </Field>
            <Field label={t('ac.hold.reason')} htmlFor="aj-reason">
              <Textarea
                id="aj-reason"
                rows={1}
                value={a.reason}
                onChange={(e) => setA({ ...a, reason: e.target.value })}
              />
            </Field>
            <Button
              disabled={!a.organizationId || !a.amount || a.reason.trim().length < 3}
              loading={cmd.busy}
              onClick={() =>
                void cmd.run(
                  '/v1/admin/commercial/adjustments',
                  {
                    organizationId: a.organizationId,
                    kind: a.kind,
                    amountHalalas: toHalalas(a.amount),
                    reason: a.reason,
                  },
                  t('ac.adj.done'),
                )
              }
            >
              {t('ac.adj.post')}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function AuthTab({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { data, reload } = useGet<Auth[]>('/v1/admin/commercial/authorizations');
  const cmd = useCommand();
  const [f, setF] = useState({ organizationId: '', reference: '', reason: '', days: '30' });
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ac-auth">
      <Alert tone="info">{t('ac.auth.note')}</Alert>
      {cmd.banner}
      {!data ? (
        <LoadingState label={t('state.loading')} />
      ) : data.length === 0 ? (
        <EmptyState title={t('ac.auth.empty')} />
      ) : (
        <div className="dd-table-wrap">
          <table className="dd-table">
            <thead>
              <tr>
                <th>{t('ac.col.orgId')}</th>
                <th>{t('ac.auth.reference')}</th>
                <th>{t('ac.hold.reason')}</th>
                <th>{t('ac.auth.until')}</th>
                <th>{t('ac.col.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id}>
                  <td className="dd-ltr">{a.organizationId.slice(0, 8)}</td>
                  <td>{a.reference}</td>
                  <td>{a.reason}</td>
                  <td>{formatDateTime(locale, a.validUntil)}</td>
                  <td>
                    <StatusChip tone={a.revoked ? 'neutral' : 'success'}>
                      {a.revoked ? t('ac.auth.revoked') : t('ac.auth.valid')}
                    </StatusChip>
                  </td>
                  <td>
                    {canManage && !a.revoked ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void cmd.run(
                            `/v1/admin/commercial/authorizations/${a.id}/revoke`,
                            {},
                            t('ac.auth.revokedMsg'),
                            reload,
                          )
                        }
                      >
                        {t('ac.auth.revoke')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <Card flat>
          <div className="dd-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={t('ac.col.orgId')} htmlFor="au-org">
              <Input
                id="au-org"
                dir="ltr"
                value={f.organizationId}
                onChange={(e) => setF({ ...f, organizationId: e.target.value.trim() })}
              />
            </Field>
            <Field label={t('ac.auth.reference')} htmlFor="au-ref">
              <Input
                id="au-ref"
                value={f.reference}
                onChange={(e) => setF({ ...f, reference: e.target.value })}
              />
            </Field>
            <Field label={t('ac.hold.reason')} htmlFor="au-reason">
              <Input
                id="au-reason"
                value={f.reason}
                onChange={(e) => setF({ ...f, reason: e.target.value })}
              />
            </Field>
            <Field label={t('ac.auth.days')} htmlFor="au-days">
              <Input
                id="au-days"
                inputMode="numeric"
                value={f.days}
                onChange={(e) => setF({ ...f, days: e.target.value })}
              />
            </Field>
            <Button
              disabled={
                !f.organizationId || f.reference.trim().length < 2 || f.reason.trim().length < 3
              }
              loading={cmd.busy}
              data-testid="ac-auth-create"
              onClick={() =>
                void cmd.run(
                  '/v1/admin/commercial/authorizations',
                  {
                    organizationId: f.organizationId,
                    reference: f.reference,
                    reason: f.reason,
                    validUntil: isoPlus(Number(f.days) || 30),
                  },
                  t('ac.auth.created'),
                  reload,
                )
              }
            >
              {t('ac.auth.create')}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
