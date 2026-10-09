'use client';

import { useCallback, useState, type ReactNode } from 'react';
import {
  createTranslator,
  dictionaries,
  formatAmount,
  formatDate,
  type DictionaryKey,
} from '@dealdash/localization';
import {
  Alert,
  Button,
  Card,
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

export const DOC_TONE: Record<string, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  ISSUED: 'info',
  SENT: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'danger',
  DISPUTED: 'danger',
  CANCELLED: 'neutral',
  CREDITED: 'success',
  WRITTEN_OFF: 'neutral',
  VOID: 'neutral',
};
export const ACCOUNT_TONE: Record<string, StatusTone> = {
  ACTIVE: 'success',
  CREDIT_HOLD: 'warning',
  FINANCIAL_HOLD: 'danger',
  SUSPENDED: 'danger',
  CLOSED: 'neutral',
};

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
    <div data-testid="bill-banner">
      <Alert tone={banner.tone}>{banner.text}</Alert>
    </div>
  ) : null;
  return { run, busy, banner: view };
}

function Section({
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
    const code = res.errors[0]!.code;
    const denied = ['FORBIDDEN', 'SCOPE_FORBIDDEN', 'NOT_FOUND', 'ENTITLEMENT_REQUIRED'].includes(
      code,
    );
    return (
      <div data-testid={denied ? 'bill-denied' : 'bill-error'}>
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
export interface BillingAccount {
  id: string;
  organizationId: string;
  legalEntityId: string;
  legalEntity: { legalName: string; country: string; taxNumber: string | null };
  name: string;
  currency: string;
  country: string;
  isDefault: boolean;
  status: string;
  billingAddress: Record<string, string>;
  taxId: string | null;
  financeContact: Record<string, string>;
  invoiceContact: Record<string, string>;
  paymentTermsDays: number;
  billingFrequency: string;
  billingMethod: string;
  contractId: string | null;
  poRequired: boolean;
  credit: {
    status: string;
    limitMinor: number;
    exposureMinor: number;
    availableMinor: number;
    expiresAt: string;
  } | null;
}
export interface FinanceDoc {
  id: string;
  number: string;
  type: string;
  status: string;
  organizationId: string;
  legalEntityId: string | null;
  businessAccountId: string;
  currency: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  outstandingMinor: number;
  issuedAt: string;
  dueAt: string | null;
  fxRate: string | null;
  transactionCurrency: string | null;
  statutory: Record<string, unknown>;
  relatedDocumentId: string | null;
  purchaseOrderId: string | null;
}
interface DocDetail extends FinanceDoc {
  lines: Array<{
    lineNo: number;
    kind: string;
    description: string;
    descriptionAr: string | null;
    quantity: number;
    unitPriceMinor: number | null;
    amountMinor: number;
    taxMinor: number;
    collection: string;
  }>;
  payments: Array<{ paymentId: string; amountMinor: number; allocatedAt: string }>;
  disputeCaseId: string | null;
}
interface Receivable {
  businessAccountId: string;
  organizationId: string;
  legalName: string;
  currency: string;
  status: string;
  invoicedMinor: number;
  paidMinor: number;
  creditedMinor: number;
  outstandingMinor: number;
  overdueMinor: number;
  disputedMinor: number;
  unallocatedCreditMinor: number;
  aging: Record<string, number>;
  financialHolds: number;
}
interface PurchaseOrder {
  id: string;
  poNumber: string;
  currency: string;
  valueMinor: number;
  remainingMinor: number;
  usedMinor: number;
  expiresAt: string | null;
  status: string;
  organizationId: string;
}
interface Recon {
  by: string;
  rows: Array<{
    key: string;
    currency: string;
    billedMinor: number;
    prepaidDrawdownMinor: number;
    nettedMinor: number;
    campaignCaseMinor: number;
    pendingMinor: number;
    invoicedMinor: number;
    paidMinor: number;
    fundingReceivedMinor: number;
    fundingUtilizedMinor: number;
    merchantPayableMinor: number;
    merchantSettledMinor: number;
    status: string;
    differences: string[];
  }>;
  integrity: { invoiceDueWithoutInvoiceLine: number };
  flows: Array<{
    product: string;
    status: string;
    measures: Record<string, number>;
    checks: Array<{ check: string; ok: boolean }>;
  }>;
}
interface Statement {
  currency: string;
  legalName: string;
  openingMinor: number;
  closingMinor: number;
  lines: Array<{
    at: string;
    kind: string;
    reference: string;
    debitMinor: number;
    creditMinor: number;
    balanceMinor: number;
  }>;
}

// ====================================================================================== shared pieces
function HoldBanner({ accounts }: { accounts: BillingAccount[] }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const held = accounts.filter(
    (a) => a.status === 'FINANCIAL_HOLD' || a.status === 'SUSPENDED' || a.status === 'CREDIT_HOLD',
  );
  if (!held.length) return null;
  return (
    <div data-testid="bill-hold">
      <Alert tone="danger" title={t('bill.holdTitle')}>
        {t('bill.holdBody', { names: held.map((a) => a.name).join(', ') })}
      </Alert>
    </div>
  );
}

export function DocumentTable({
  docs,
  onOpen,
}: {
  docs: FinanceDoc[];
  onOpen: (id: string) => void;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="dd-table" data-testid="bill-docs">
        <thead>
          <tr>
            <th>{t('bill.number')}</th>
            <th>{t('bill.type')}</th>
            <th>{t('bill.status')}</th>
            <th>{t('bill.issued')}</th>
            <th>{t('bill.due')}</th>
            <th>{t('bill.total')}</th>
            <th>{t('bill.outstanding')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} data-testid={`bill-doc-${d.number}`}>
              <td>
                <code>{d.number.startsWith('DRAFT-') ? t('bill.draftNumber') : d.number}</code>
              </td>
              <td>{label('bill.docType', d.type)}</td>
              <td>
                <StatusChip tone={DOC_TONE[d.status] ?? 'neutral'}>
                  {label('bill.docStatus', d.status)}
                </StatusChip>
              </td>
              <td>{formatDate(locale, d.issuedAt)}</td>
              <td>{d.dueAt ? formatDate(locale, d.dueAt) : '-'}</td>
              <td>{formatAmount(locale, d.totalMinor, d.currency)}</td>
              <td>
                {d.outstandingMinor ? formatAmount(locale, d.outstandingMinor, d.currency) : '-'}
              </td>
              <td>
                <Button size="sm" variant="ghost" onClick={() => onOpen(d.id)}>
                  {t('bill.open')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentDetail({
  path,
  onClose,
  actions,
}: {
  path: string;
  onClose: () => void;
  actions?: (d: DocDetail, reload: () => Promise<void>) => ReactNode;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const res = useResource<DocDetail>(path);
  return (
    <Section
      title={t('bill.document')}
      testId="bill-doc-detail"
      action={
        <Button size="sm" variant="outline" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      <Loaded res={res}>
        {(d) => (
          <div className="dd-stack" style={{ gap: 12 }}>
            <KeyValue
              items={[
                {
                  label: t('bill.number'),
                  value: (
                    <code>{d.number.startsWith('DRAFT-') ? t('bill.draftNumber') : d.number}</code>
                  ),
                },
                { label: t('bill.type'), value: label('bill.docType', d.type) },
                {
                  label: t('bill.status'),
                  value: (
                    <StatusChip tone={DOC_TONE[d.status] ?? 'neutral'}>
                      {label('bill.docStatus', d.status)}
                    </StatusChip>
                  ),
                },
                {
                  label: t('bill.subtotal'),
                  value: formatAmount(locale, d.subtotalMinor, d.currency),
                },
                {
                  label: t('bill.tax'),
                  value:
                    d.statutory?.status === 'TAX_NOT_CONFIGURED_VALIDATE'
                      ? t('bill.taxNotConfigured')
                      : formatAmount(locale, d.taxMinor, d.currency),
                },
                { label: t('bill.total'), value: formatAmount(locale, d.totalMinor, d.currency) },
                { label: t('bill.paid'), value: formatAmount(locale, d.paidMinor, d.currency) },
                {
                  label: t('bill.credited'),
                  value: formatAmount(locale, d.creditedMinor, d.currency),
                },
                {
                  label: t('bill.outstanding'),
                  value: formatAmount(locale, d.outstandingMinor, d.currency),
                },
                ...(d.fxRate
                  ? [
                      {
                        label: t('bill.fx'),
                        value: t('bill.fxValue', {
                          from: d.transactionCurrency ?? '',
                          to: d.currency,
                          rate: d.fxRate,
                        }),
                      },
                    ]
                  : []),
                ...(d.dueAt ? [{ label: t('bill.due'), value: formatDate(locale, d.dueAt) }] : []),
              ]}
            />
            {d.type === 'PROFORMA_INVOICE' ? (
              <Alert tone="info">{t('bill.proformaNote')}</Alert>
            ) : null}
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table" data-testid="bill-lines">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('bill.description')}</th>
                    <th>{t('bill.qty')}</th>
                    <th>{t('bill.amount')}</th>
                    <th>{t('bill.collection')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.lines.map((l) => (
                    <tr key={l.lineNo}>
                      <td>{l.lineNo}</td>
                      <td>
                        {locale === 'ar' && l.descriptionAr ? l.descriptionAr : l.description}
                      </td>
                      <td>{l.quantity}</td>
                      <td>{formatAmount(locale, l.amountMinor, d.currency)}</td>
                      <td>{label('bill.collect', l.collection)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {actions?.(d, res.reload)}
          </div>
        )}
      </Loaded>
    </Section>
  );
}

function ReceivablesTable({ rows }: { rows: Receivable[] }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="dd-table" data-testid="bill-ar">
        <thead>
          <tr>
            <th>{t('bill.account')}</th>
            <th>{t('bill.status')}</th>
            <th>{t('bill.outstanding')}</th>
            <th>{t('bill.overdue')}</th>
            {['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'].map((b) => (
              <th key={b}>{t(`bill.aging.${b}` as DictionaryKey)}</th>
            ))}
            <th>{t('bill.unallocated')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.businessAccountId}>
              <td>
                {r.legalName} <span className="dd-muted">({r.currency})</span>
              </td>
              <td>
                <StatusChip tone={ACCOUNT_TONE[r.status] ?? 'neutral'}>
                  {label('bill.accountStatus', r.status)}
                </StatusChip>
              </td>
              <td>{formatAmount(locale, r.outstandingMinor, r.currency)}</td>
              <td>
                {r.overdueMinor ? (
                  <StatusChip tone="danger">
                    {formatAmount(locale, r.overdueMinor, r.currency)}
                  </StatusChip>
                ) : (
                  '-'
                )}
              </td>
              {['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'].map((b) => (
                <td key={b}>{formatAmount(locale, r.aging[b] ?? 0, r.currency)}</td>
              ))}
              <td>{formatAmount(locale, r.unallocatedCreditMinor, r.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReconciliationPanel({ path, admin }: { path: string; admin: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const [by, setBy] = useState('PRODUCT');
  const res = useResource<Recon>(path, { by });
  const dims = admin
    ? [
        'BUSINESS_ACCOUNT',
        'LEGAL_ENTITY',
        'PRODUCT',
        'CAMPAIGN',
        'FUNDING_PARTY',
        'MERCHANT',
        'SPONSOR',
        'CURRENCY',
      ]
    : ['LEGAL_ENTITY', 'BUSINESS_ACCOUNT', 'PRODUCT', 'CAMPAIGN', 'CURRENCY'];
  return (
    <Section
      title={t('bill.tab.reconciliation')}
      testId="bill-recon"
      note={t('bill.reconNote')}
      action={
        <Select
          aria-label={t('bill.reconBy')}
          value={by}
          onChange={(e) => setBy(e.target.value)}
          style={{ maxWidth: 220 }}
          data-testid="bill-recon-by"
        >
          {dims.map((d) => (
            <option key={d} value={d}>
              {label('bill.dim', d)}
            </option>
          ))}
        </Select>
      }
    >
      <Loaded res={res}>
        {(d) => (
          <div className="dd-stack" style={{ gap: 12 }}>
            {d.integrity.invoiceDueWithoutInvoiceLine ? (
              <Alert tone="danger">
                {t('bill.integrityIssue', { count: d.integrity.invoiceDueWithoutInvoiceLine })}
              </Alert>
            ) : null}
            {d.rows.length ? (
              <div style={{ overflowX: 'auto' }}>
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>{label('bill.dim', d.by)}</th>
                      <th>{t('bill.r.billed')}</th>
                      <th>{t('bill.r.prepaid')}</th>
                      <th>{t('bill.r.netted')}</th>
                      <th>{t('bill.r.case')}</th>
                      <th>{t('bill.r.pending')}</th>
                      <th>{t('bill.r.invoiced')}</th>
                      <th>{t('bill.r.paid')}</th>
                      <th>{t('bill.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={`${r.key}-${r.currency}`}>
                        <td>{label('vis.product', r.key)}</td>
                        {[
                          r.billedMinor,
                          r.prepaidDrawdownMinor,
                          r.nettedMinor,
                          r.campaignCaseMinor,
                          r.pendingMinor,
                          r.invoicedMinor,
                          r.paidMinor,
                        ].map((v, i) => (
                          <td key={i}>{formatAmount(locale, v, r.currency)}</td>
                        ))}
                        <td>
                          <StatusChip tone={r.status === 'MATCHED' ? 'success' : 'danger'}>
                            {label('bill.match', r.status)}
                          </StatusChip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title={t('vis.empty')} />
            )}
            {d.flows.length ? (
              <div
                className="dd-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: 12,
                }}
                data-testid="bill-flows"
              >
                {d.flows.map((f) => (
                  <Card flat key={f.product}>
                    <div className="dd-stack" style={{ gap: 6 }}>
                      <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                        <strong>{label('vis.product', f.product)}</strong>
                        <StatusChip tone={f.status === 'MATCHED' ? 'success' : 'danger'}>
                          {label('bill.match', f.status)}
                        </StatusChip>
                      </div>
                      {f.checks.map((c) => (
                        <span key={c.check} className="dd-muted">
                          {c.ok ? '✓' : '✗'} {label('bill.check', c.check)}
                        </span>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </Loaded>
    </Section>
  );
}

function StatementPanel({ accounts, base }: { accounts: BillingAccount[]; base: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [acc, setAcc] = useState(accounts[0]?.id ?? '');
  const [to] = useState(() => new Date());
  const from = new Date(to.getTime() - 90 * 86_400_000);
  const res = useResource<Statement>(acc ? `${base}/accounts/${acc}/statement` : null, {
    from: from.toISOString(),
    to: to.toISOString(),
  });
  return (
    <Section
      title={t('bill.tab.statement')}
      testId="bill-statement"
      note={t('bill.statementNote')}
      action={
        <Select
          aria-label={t('bill.account')}
          value={acc}
          onChange={(e) => setAcc(e.target.value)}
          style={{ maxWidth: 280 }}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {`${a.name} (${a.currency})`}
            </option>
          ))}
        </Select>
      }
    >
      {acc ? (
        <Loaded res={res}>
          {(s) => (
            <div className="dd-stack" style={{ gap: 8 }}>
              <KeyValue
                items={[
                  {
                    label: t('bill.opening'),
                    value: formatAmount(locale, s.openingMinor, s.currency),
                  },
                  {
                    label: t('bill.closing'),
                    value: formatAmount(locale, s.closingMinor, s.currency),
                  },
                ]}
              />
              <div style={{ overflowX: 'auto' }}>
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>{t('bill.date')}</th>
                      <th>{t('bill.reference')}</th>
                      <th>{t('bill.debit')}</th>
                      <th>{t('bill.credit')}</th>
                      <th>{t('bill.balance')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.lines.map((l, i) => (
                      <tr key={i}>
                        <td>{formatDate(locale, l.at)}</td>
                        <td>
                          <code>{l.reference}</code>
                        </td>
                        <td>
                          {l.debitMinor ? formatAmount(locale, l.debitMinor, s.currency) : '-'}
                        </td>
                        <td>
                          {l.creditMinor ? formatAmount(locale, l.creditMinor, s.currency) : '-'}
                        </td>
                        <td>{formatAmount(locale, l.balanceMinor, s.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Loaded>
      ) : (
        <EmptyState title={t('vis.empty')} />
      )}
    </Section>
  );
}

function PurchaseOrders({
  path,
  canManage,
  accounts,
  orgId,
}: {
  path: string;
  canManage: boolean;
  accounts: BillingAccount[];
  orgId?: string;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const res = useResource<PurchaseOrder[]>(path);
  const { run, busy, banner } = useCommand();
  const [f, setF] = useState({
    account: accounts[0]?.id ?? '',
    poNumber: '',
    value: '',
    expiresAt: '',
  });
  const acc = accounts.find((a) => a.id === f.account);
  return (
    <Section title={t('bill.tab.po')} testId="bill-po" note={t('bill.poNote')}>
      {banner}
      {canManage && acc ? (
        <Card flat>
          <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('bill.account')} htmlFor="po-acc">
              <Select
                id="po-acc"
                value={f.account}
                onChange={(e) => setF({ ...f, account: e.target.value })}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{`${a.name} (${a.currency})`}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('bill.poNumber')} htmlFor="po-num">
              <Input
                id="po-num"
                value={f.poNumber}
                onChange={(e) => setF({ ...f, poNumber: e.target.value })}
              />
            </Field>
            <Field label={t('bill.poValue', { currency: acc.currency })} htmlFor="po-val">
              <Input
                id="po-val"
                inputMode="decimal"
                value={f.value}
                onChange={(e) => setF({ ...f, value: e.target.value.replace(/[^\d.]/g, '') })}
              />
            </Field>
            <Field label={t('bill.poExpires')} htmlFor="po-exp">
              <Input
                id="po-exp"
                type="date"
                value={f.expiresAt}
                onChange={(e) => setF({ ...f, expiresAt: e.target.value })}
              />
            </Field>
            <Button
              loading={busy}
              disabled={!f.poNumber.trim() || !Number(f.value)}
              data-testid="bill-po-add"
              onClick={() =>
                void run(
                  'POST',
                  path,
                  {
                    organizationId: orgId ?? acc.organizationId,
                    legalEntityId: acc.legalEntityId,
                    currency: acc.currency,
                    poNumber: f.poNumber.trim(),
                    valueMinor: Math.round(Number(f.value) * 100),
                    expiresAt: f.expiresAt
                      ? new Date(`${f.expiresAt}T23:59:59Z`).toISOString()
                      : null,
                  },
                  t('bill.poAdded'),
                  () => res.reload(),
                )
              }
            >
              {t('bill.poAdd')}
            </Button>
          </div>
        </Card>
      ) : null}
      <Loaded res={res} empty={(d) => !d.length}>
        {(d) => (
          <div style={{ overflowX: 'auto' }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('bill.poNumber')}</th>
                  <th>{t('bill.status')}</th>
                  <th>{t('bill.total')}</th>
                  <th>{t('bill.poUsed')}</th>
                  <th>{t('bill.poRemaining')}</th>
                  <th>{t('bill.poExpires')}</th>
                </tr>
              </thead>
              <tbody>
                {d.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <code>{p.poNumber}</code>
                    </td>
                    <td>
                      <StatusChip tone={p.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {label('bill.poStatus', p.status)}
                      </StatusChip>
                    </td>
                    <td>{formatAmount(locale, p.valueMinor, p.currency)}</td>
                    <td>{formatAmount(locale, p.usedMinor, p.currency)}</td>
                    <td>{formatAmount(locale, p.remainingMinor, p.currency)}</td>
                    <td>{p.expiresAt ? formatDate(locale, p.expiresAt) : '-'}</td>
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

function AccountsPanel({
  accounts,
  base,
  canManage,
  reload,
  admin,
}: {
  accounts: BillingAccount[];
  base: string;
  canManage: boolean;
  reload: () => Promise<void>;
  admin: boolean;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const { run, busy, banner } = useCommand();
  const [edit, setEdit] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  return (
    <Section title={t('bill.tab.accounts')} testId="bill-accounts" note={t('bill.accountsNote')}>
      {banner}
      {accounts.length ? (
        accounts.map((a) => (
          <Card flat key={a.id} data-testid={`bill-account-${a.id}`}>
            <div className="dd-stack" style={{ gap: 8 }}>
              <div
                className="dd-row"
                style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
              >
                <strong>
                  {a.name} <span className="dd-muted">· {a.currency}</span>
                </strong>
                <div className="dd-row" style={{ gap: 6 }}>
                  {a.isDefault ? <StatusChip tone="info">{t('bill.default')}</StatusChip> : null}
                  <StatusChip tone={ACCOUNT_TONE[a.status] ?? 'neutral'}>
                    {label('bill.accountStatus', a.status)}
                  </StatusChip>
                </div>
              </div>
              <KeyValue
                items={[
                  {
                    label: t('bill.legalEntity'),
                    value: `${a.legalEntity.legalName} (${a.country})`,
                  },
                  { label: t('bill.taxId'), value: a.taxId ?? '-' },
                  {
                    label: t('bill.terms'),
                    value: t('bill.termsDays', { days: a.paymentTermsDays }),
                  },
                  { label: t('bill.frequency'), value: label('bill.freq', a.billingFrequency) },
                  { label: t('bill.method'), value: label('bill.method', a.billingMethod) },
                  {
                    label: t('bill.poRequired'),
                    value: a.poRequired ? t('common.yes') : t('common.no'),
                  },
                  { label: t('bill.invoiceContact'), value: a.invoiceContact?.email ?? '-' },
                  ...(a.credit
                    ? [
                        {
                          label: t('bill.creditAvailable'),
                          value: `${formatAmount(locale, a.credit.availableMinor, a.currency)} / ${formatAmount(locale, a.credit.limitMinor, a.currency)}`,
                        },
                      ]
                    : []),
                ]}
              />
              {canManage ? (
                edit === a.id ? (
                  <div
                    className="dd-row"
                    style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
                  >
                    <Field label={t('bill.invoiceEmail')} htmlFor={`ie-${a.id}`}>
                      <Input
                        id={`ie-${a.id}`}
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </Field>
                    <Button
                      loading={busy}
                      onClick={() =>
                        void run(
                          'PUT',
                          `${base}/accounts/${a.id}`,
                          { invoiceContact: { email } },
                          t('common.saved'),
                          async () => {
                            setEdit(null);
                            await reload();
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
                  <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEdit(a.id);
                        setEmail(a.invoiceContact?.email ?? '');
                      }}
                    >
                      {t('bill.editContact')}
                    </Button>
                    {admin ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void run(
                              'PUT',
                              `${base}/accounts/${a.id}`,
                              { poRequired: !a.poRequired },
                              t('common.saved'),
                              reload,
                            )
                          }
                        >
                          {a.poRequired ? t('bill.poNotRequired') : t('bill.poRequire')}
                        </Button>
                        {a.status === 'ACTIVE' ? (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() =>
                              void run(
                                'POST',
                                `${base}/accounts/${a.id}/status`,
                                {
                                  status: 'FINANCIAL_HOLD',
                                  reason: 'Placed from the billing workspace',
                                },
                                t('bill.holdPlaced'),
                                reload,
                              )
                            }
                          >
                            {t('bill.placeHold')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void run(
                                'POST',
                                `${base}/accounts/${a.id}/status`,
                                { status: 'ACTIVE', reason: 'Released from the billing workspace' },
                                t('bill.holdReleased'),
                                reload,
                              )
                            }
                          >
                            {t('bill.releaseHold')}
                          </Button>
                        )}
                      </>
                    ) : null}
                  </div>
                )
              ) : null}
            </div>
          </Card>
        ))
      ) : (
        <EmptyState title={t('bill.noAccounts')} />
      )}
    </Section>
  );
}

// ====================================================================================== business billing
export type BillingTab =
  'documents' | 'accounts' | 'receivables' | 'po' | 'statement' | 'reconciliation';

/** The business's billing on the shared finance platform. The backend limits what a scoped member sees to their legal entities. */
export function BillingWorkspace({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const base = `/v1/orgs/${orgId}/billing`;
  const [tab, setTab] = useState<BillingTab>('documents');
  const [open, setOpen] = useState<string | null>(null);
  const accounts = useResource<BillingAccount[]>(`${base}/accounts`);
  const docs = useResource<FinanceDoc[]>(`${base}/documents`);
  const ar = useResource<Receivable[]>(`${base}/receivables`);
  const { run, busy, banner } = useCommand();
  const [reason, setReason] = useState('');
  const tabs = (
    ['documents', 'accounts', 'receivables', 'po', 'statement', 'reconciliation'] as const
  ).map((id) => ({ id, label: t(`bill.tab.${id}` as DictionaryKey) }));
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="billing-workspace">
      <h1 className="dd-title-xl">{t('bill.title')}</h1>
      {accounts.data ? <HoldBanner accounts={accounts.data} /> : null}
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(v) => setTab(v as BillingTab)}
          label={t('bill.title')}
        />
      </div>
      {tab === 'documents' ? (
        open ? (
          <DocumentDetail
            path={`${base}/documents/${open}`}
            onClose={() => setOpen(null)}
            actions={(d, reload) =>
              canManage &&
              ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(d.status) &&
              ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE'].includes(d.type) ? (
                <div className="dd-stack" style={{ gap: 8 }}>
                  {banner}
                  <Field label={t('bill.disputeReason')} htmlFor="disp">
                    <Textarea
                      id="disp"
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                  <div>
                    <Button
                      variant="outline"
                      loading={busy}
                      disabled={reason.trim().length < 3}
                      data-testid="bill-dispute"
                      onClick={() =>
                        void run(
                          'POST',
                          `${base}/documents/${d.id}/dispute`,
                          { reason },
                          t('bill.disputed'),
                          reload,
                        )
                      }
                    >
                      {t('bill.dispute')}
                    </Button>
                  </div>
                </div>
              ) : null
            }
          />
        ) : (
          <Section
            title={t('bill.tab.documents')}
            testId="bill-documents"
            note={t('bill.documentsNote')}
          >
            <Loaded res={docs} empty={(d) => !d.length}>
              {(d) => <DocumentTable docs={d} onOpen={setOpen} />}
            </Loaded>
          </Section>
        )
      ) : null}
      {tab === 'accounts' ? (
        <Loaded res={accounts}>
          {(a) => (
            <AccountsPanel
              accounts={a}
              base={base}
              canManage={canManage}
              reload={accounts.reload}
              admin={false}
            />
          )}
        </Loaded>
      ) : null}
      {tab === 'receivables' ? (
        <Section title={t('bill.tab.receivables')} testId="bill-receivables">
          <Loaded res={ar} empty={(d) => !d.length}>
            {(d) => <ReceivablesTable rows={d} />}
          </Loaded>
        </Section>
      ) : null}
      {tab === 'po' ? (
        <Loaded res={accounts}>
          {(a) => (
            <PurchaseOrders
              path={`${base}/purchase-orders`}
              canManage={canManage}
              accounts={a}
              orgId={orgId}
            />
          )}
        </Loaded>
      ) : null}
      {tab === 'statement' ? (
        <Loaded res={accounts}>{(a) => <StatementPanel accounts={a} base={base} />}</Loaded>
      ) : null}
      {tab === 'reconciliation' ? (
        <ReconciliationPanel path={`${base}/reconciliation`} admin={false} />
      ) : null}
    </div>
  );
}

// ====================================================================================== DealDash Finance
export type AdminBillingTab =
  'documents' | 'accounts' | 'receivables' | 'payments' | 'po' | 'fx' | 'reconciliation';

interface FxRate {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  source: string;
  rateDate: string;
  status: string;
  createdByUserId: string;
}

export function AdminBillingWorkspace({
  canManage,
  canApprove,
}: {
  canManage: boolean;
  canApprove: boolean;
}) {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const label = useLabel();
  const base = '/v1/admin/billing';
  const [tab, setTab] = useState<AdminBillingTab>('documents');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const docs = useResource<FinanceDoc[]>(`${base}/documents`, { status: status || undefined });
  const accounts = useResource<BillingAccount[]>(`${base}/accounts`);
  const ar = useResource<Receivable[]>(`${base}/receivables`);
  const fx = useResource<FxRate[]>(tab === 'fx' ? `${base}/fx-rates` : null);
  const { run, busy, banner } = useCommand();
  const [note, setNote] = useState({ kind: 'CREDIT_NOTE', amount: '', reason: '' });
  const [pay, setPay] = useState({
    account: '',
    amount: '',
    method: 'BANK_TRANSFER',
    reference: '',
  });
  const [rate, setRate] = useState({ base: 'SAR', quote: 'AED', rate: '', source: '', date: '' });
  const tabs = (
    ['documents', 'accounts', 'receivables', 'payments', 'po', 'fx', 'reconciliation'] as const
  ).map((id) => ({ id, label: t(`bill.tab.${id}` as DictionaryKey) }));
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-billing">
      <h1 className="dd-title-xl">{t('bill.adminTitle')}</h1>
      {banner}
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(v) => setTab(v as AdminBillingTab)}
          label={t('bill.adminTitle')}
        />
      </div>
      {tab === 'documents' ? (
        open ? (
          <DocumentDetail
            path={`${base}/documents/${open}`}
            onClose={() => setOpen(null)}
            actions={(d, reload) => (
              <div className="dd-stack" style={{ gap: 8 }}>
                <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {canManage && (d.status === 'DRAFT' || d.status === 'PENDING_APPROVAL') ? (
                    <>
                      <Button
                        loading={busy}
                        data-testid="bill-issue"
                        disabled={d.status === 'PENDING_APPROVAL' && !canApprove}
                        onClick={() =>
                          void run(
                            'POST',
                            `${base}/documents/${d.id}/issue`,
                            {},
                            t('bill.processed'),
                            async () => {
                              await reload();
                              await docs.reload();
                            },
                          )
                        }
                      >
                        {d.status === 'PENDING_APPROVAL' ? t('bill.approveIssue') : t('bill.issue')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void run(
                            'POST',
                            `${base}/documents/${d.id}/cancel`,
                            { reason: 'Cancelled before issue' },
                            t('bill.cancelled'),
                            async () => {
                              await reload();
                              await docs.reload();
                            },
                          )
                        }
                      >
                        {t('bill.cancelDraft')}
                      </Button>
                    </>
                  ) : null}
                  {canManage &&
                  ['ISSUED', 'SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(d.status) ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void run(
                          'POST',
                          `${base}/documents/${d.id}/send`,
                          {},
                          t('bill.sent'),
                          reload,
                        )
                      }
                    >
                      {t('bill.send')}
                    </Button>
                  ) : null}
                  {canManage && d.status === 'DISPUTED' ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void run(
                          'POST',
                          `${base}/documents/${d.id}/dispute/resolve`,
                          { outcome: 'REJECTED', reason: 'Charges confirmed' },
                          t('bill.disputeResolved'),
                          reload,
                        )
                      }
                    >
                      {t('bill.resolveDispute')}
                    </Button>
                  ) : null}
                </div>
                {d.status === 'PENDING_APPROVAL' ? (
                  <Alert tone="warning">{t('bill.makerChecker')}</Alert>
                ) : null}
                {canManage &&
                ['INVOICE', 'TAX_INVOICE'].includes(d.type) &&
                !['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'].includes(d.status) ? (
                  <div
                    className="dd-row"
                    style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
                    data-testid="bill-note-form"
                  >
                    <Field label={t('bill.noteKind')} htmlFor="nk">
                      <Select
                        id="nk"
                        value={note.kind}
                        onChange={(e) => setNote({ ...note, kind: e.target.value })}
                      >
                        <option value="CREDIT_NOTE">{label('bill.docType', 'CREDIT_NOTE')}</option>
                        <option value="DEBIT_NOTE">{label('bill.docType', 'DEBIT_NOTE')}</option>
                      </Select>
                    </Field>
                    <Field label={t('bill.amountIn', { currency: d.currency })} htmlFor="na">
                      <Input
                        id="na"
                        inputMode="decimal"
                        value={note.amount}
                        onChange={(e) =>
                          setNote({ ...note, amount: e.target.value.replace(/[^\d.]/g, '') })
                        }
                      />
                    </Field>
                    <Field label={t('common.reason')} htmlFor="nr">
                      <Input
                        id="nr"
                        value={note.reason}
                        onChange={(e) => setNote({ ...note, reason: e.target.value })}
                      />
                    </Field>
                    <Button
                      variant="outline"
                      disabled={!Number(note.amount) || note.reason.trim().length < 3}
                      onClick={() =>
                        void run(
                          'POST',
                          `${base}/documents/${d.id}/notes`,
                          {
                            kind: note.kind,
                            amountMinor: Math.round(Number(note.amount) * 100),
                            reason: note.reason,
                          },
                          t('bill.noteIssued'),
                          reload,
                        )
                      }
                    >
                      {t('bill.issueNote')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          />
        ) : (
          <Section
            title={t('bill.tab.documents')}
            testId="bill-documents"
            action={
              <div className="dd-row" style={{ gap: 8 }}>
                <Select
                  aria-label={t('bill.status')}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  style={{ maxWidth: 220 }}
                >
                  <option value="">{t('common.all')}</option>
                  {[
                    'DRAFT',
                    'PENDING_APPROVAL',
                    'ISSUED',
                    'SENT',
                    'PARTIALLY_PAID',
                    'OVERDUE',
                    'DISPUTED',
                    'PAID',
                  ].map((s) => (
                    <option key={s} value={s}>
                      {label('bill.docStatus', s)}
                    </option>
                  ))}
                </Select>
                {canManage ? (
                  <Button
                    variant="outline"
                    loading={busy}
                    data-testid="bill-run"
                    onClick={() =>
                      void run<{ drafts: string[]; consumed: number }>(
                        'POST',
                        `${base}/run`,
                        { force: false },
                        t('bill.runDone'),
                        () => docs.reload(),
                      )
                    }
                  >
                    {t('bill.run')}
                  </Button>
                ) : null}
              </div>
            }
          >
            <Loaded res={docs} empty={(d) => !d.length}>
              {(d) => <DocumentTable docs={d} onOpen={setOpen} />}
            </Loaded>
          </Section>
        )
      ) : null}
      {tab === 'accounts' ? (
        <Loaded res={accounts}>
          {(a) => (
            <AccountsPanel
              accounts={a}
              base={base}
              canManage={canManage}
              reload={accounts.reload}
              admin
            />
          )}
        </Loaded>
      ) : null}
      {tab === 'receivables' ? (
        <Section title={t('bill.tab.receivables')} testId="bill-receivables">
          <Loaded res={ar} empty={(d) => !d.length}>
            {(d) => <ReceivablesTable rows={d} />}
          </Loaded>
        </Section>
      ) : null}
      {tab === 'payments' ? (
        <Section
          title={t('bill.tab.payments')}
          testId="bill-payments"
          note={t('bill.paymentsNote')}
        >
          <Loaded res={accounts}>
            {(a) => (
              <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <Field label={t('bill.account')} htmlFor="pa">
                  <Select
                    id="pa"
                    value={pay.account}
                    onChange={(e) => setPay({ ...pay, account: e.target.value })}
                  >
                    <option value="">-</option>
                    {a.map((x) => (
                      <option key={x.id} value={x.id}>{`${x.name} (${x.currency})`}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('bill.amount')} htmlFor="pm">
                  <Input
                    id="pm"
                    inputMode="decimal"
                    value={pay.amount}
                    onChange={(e) =>
                      setPay({ ...pay, amount: e.target.value.replace(/[^\d.]/g, '') })
                    }
                  />
                </Field>
                <Field label={t('bill.method')} htmlFor="pmt">
                  <Select
                    id="pmt"
                    value={pay.method}
                    onChange={(e) => setPay({ ...pay, method: e.target.value })}
                  >
                    {['BANK_TRANSFER', 'CARD', 'CHEQUE', 'CASH', 'OFFSET', 'OTHER'].map((m) => (
                      <option key={m} value={m}>
                        {label('bill.payMethod', m)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('bill.reference')} htmlFor="pr">
                  <Input
                    id="pr"
                    value={pay.reference}
                    onChange={(e) => setPay({ ...pay, reference: e.target.value })}
                  />
                </Field>
                <Button
                  disabled={!canManage || !pay.account || !Number(pay.amount)}
                  loading={busy}
                  data-testid="bill-pay"
                  onClick={() => {
                    const acc = a.find((x) => x.id === pay.account)!;
                    void run(
                      'POST',
                      `${base}/payments`,
                      {
                        businessAccountId: acc.id,
                        amountMinor: Math.round(Number(pay.amount) * 100),
                        currency: acc.currency,
                        method: pay.method,
                        externalReference: pay.reference || null,
                      },
                      t('bill.paymentRecorded'),
                      async () => {
                        await ar.reload();
                        await docs.reload();
                      },
                    );
                  }}
                >
                  {t('bill.recordPayment')}
                </Button>
              </div>
            )}
          </Loaded>
        </Section>
      ) : null}
      {tab === 'po' ? (
        <Loaded res={accounts}>
          {(a) => (
            <PurchaseOrders path={`${base}/purchase-orders`} canManage={canManage} accounts={a} />
          )}
        </Loaded>
      ) : null}
      {tab === 'fx' ? (
        <Section title={t('bill.tab.fx')} testId="bill-fx" note={t('bill.fxNote')}>
          {canManage ? (
            <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label={t('bill.fxBase')} htmlFor="fb">
                <Input
                  id="fb"
                  value={rate.base}
                  maxLength={3}
                  onChange={(e) => setRate({ ...rate, base: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t('bill.fxQuote')} htmlFor="fq">
                <Input
                  id="fq"
                  value={rate.quote}
                  maxLength={3}
                  onChange={(e) => setRate({ ...rate, quote: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t('bill.fxRate')} htmlFor="fr">
                <Input
                  id="fr"
                  inputMode="decimal"
                  value={rate.rate}
                  onChange={(e) =>
                    setRate({ ...rate, rate: e.target.value.replace(/[^\d.]/g, '') })
                  }
                />
              </Field>
              <Field label={t('bill.fxSource')} htmlFor="fs">
                <Input
                  id="fs"
                  value={rate.source}
                  onChange={(e) => setRate({ ...rate, source: e.target.value })}
                />
              </Field>
              <Field label={t('bill.fxDate')} htmlFor="fd">
                <Input
                  id="fd"
                  type="date"
                  value={rate.date}
                  onChange={(e) => setRate({ ...rate, date: e.target.value })}
                />
              </Field>
              <Button
                disabled={!rate.rate || !rate.source || !rate.date}
                onClick={() =>
                  void run(
                    'POST',
                    `${base}/fx-rates`,
                    {
                      baseCurrency: rate.base,
                      quoteCurrency: rate.quote,
                      rate: rate.rate,
                      source: rate.source,
                      rateDate: new Date(`${rate.date}T00:00:00Z`).toISOString(),
                    },
                    t('bill.fxProposed'),
                    () => fx.reload(),
                  )
                }
              >
                {t('bill.fxPropose')}
              </Button>
            </div>
          ) : null}
          <Loaded res={fx} empty={(d) => !d.length}>
            {(d) => (
              <div style={{ overflowX: 'auto' }}>
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th>{t('bill.fxPair')}</th>
                      <th>{t('bill.fxRate')}</th>
                      <th>{t('bill.fxSource')}</th>
                      <th>{t('bill.fxDate')}</th>
                      <th>{t('bill.status')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.map((r) => (
                      <tr key={r.id}>
                        <td>{`${r.baseCurrency}/${r.quoteCurrency}`}</td>
                        <td>{r.rate}</td>
                        <td>{r.source}</td>
                        <td>{formatDate(locale, r.rateDate)}</td>
                        <td>{label('bill.fxStatus', r.status)}</td>
                        <td>
                          {canApprove &&
                          r.status === 'PENDING_APPROVAL' &&
                          r.createdByUserId !== me?.id ? (
                            <div className="dd-row" style={{ gap: 6 }}>
                              <Button
                                size="sm"
                                onClick={() =>
                                  void run(
                                    'POST',
                                    `${base}/fx-rates/${r.id}/approve`,
                                    {},
                                    t('bill.fxApproved'),
                                    () => fx.reload(),
                                  )
                                }
                              >
                                {t('bill.approve')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void run(
                                    'POST',
                                    `${base}/fx-rates/${r.id}/reject`,
                                    {},
                                    t('bill.fxRejected'),
                                    () => fx.reload(),
                                  )
                                }
                              >
                                {t('bill.reject')}
                              </Button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Loaded>
        </Section>
      ) : null}
      {tab === 'reconciliation' ? (
        <ReconciliationPanel path={`${base}/reconciliation`} admin />
      ) : null}
    </div>
  );
}
