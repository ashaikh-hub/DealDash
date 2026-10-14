'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, SupportTimeline, useApi, useResource } from '@dealdash/app-shell';
import { formatDateTime, withLocale } from '@dealdash/localization';
import { DATA_REQUEST_STATUSES, DELIVERY_CHANNELS, DELIVERY_STATUSES } from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  KeyValue,
  Select,
  StatusChip,
  Tabs,
} from '@dealdash/ui';
import {
  DecisionBar,
  Money,
  OPS_TONE,
  OpsHeader,
  OpsStates,
  ReasonField,
  reasonOk,
  useOpsCommand,
  usePerms,
  useT,
} from './ops-kit';

// ====================================================================================== support workspace
type SupportTab = 'requests' | 'customer' | 'timeline' | 'refunds' | 'privacy';

/**
 * Admin -> Customer support: support requests (escalated into the shared case framework), the customer summary and timeline,
 * refund operations and privacy data requests. Each tab appears only for people who can use it; corrections are never edits of the
 * original record (refunds, reversals and adjustments are new, linked entries).
 */
export function AdminSupportPage() {
  return (
    <RequirePermission
      any={[
        'admin.support.manage',
        'admin.customers.read',
        'admin.refunds.manage',
        'admin.privacy.manage',
        'admin.privacy.approve',
      ]}
    >
      <Support />
    </RequirePermission>
  );
}

function Support() {
  const { t } = useT();
  const perms = usePerms();
  const tabs: Array<{ id: SupportTab; label: string }> = [];
  if (perms.includes('admin.support.manage'))
    tabs.push({ id: 'requests', label: t('s8.sup.tab.requests') });
  if (perms.includes('admin.customers.read'))
    tabs.push(
      { id: 'customer', label: t('s8.sup.tab.customer') },
      { id: 'timeline', label: t('s8.sup.tab.timeline') },
    );
  if (
    perms.includes('admin.refunds.manage') ||
    perms.includes('admin.vouchers.lookup') ||
    perms.includes('admin.payments.read')
  )
    tabs.push({ id: 'refunds', label: t('s8.sup.tab.refunds') });
  if (perms.includes('admin.privacy.manage') || perms.includes('admin.privacy.approve'))
    tabs.push({ id: 'privacy', label: t('s8.sup.tab.privacy') });
  const [tab, setTab] = useState<SupportTab>(tabs[0]?.id ?? 'requests');
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-support">
      <OpsHeader title={t('s8.sup.title')} intro={t('s8.sup.intro')} />
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(v) => setTab(v as SupportTab)}
          label={t('s8.sup.title')}
        />
      </div>
      {tab === 'requests' ? (
        <SupportRequests canEscalate={perms.includes('admin.disputes.manage')} />
      ) : null}
      {tab === 'customer' ? <CustomerPanel /> : null}
      {tab === 'timeline' ? <SupportTimeline /> : null}
      {tab === 'refunds' ? <RefundOps canManage={perms.includes('admin.refunds.manage')} /> : null}
      {tab === 'privacy' ? (
        <PrivacyRequests canManage={perms.includes('admin.privacy.manage')} />
      ) : null}
    </div>
  );
}

interface SupportRequest {
  id: string;
  reference: string;
  type: string;
  status: string;
  subject: string;
  body: string;
  userId: string;
  createdAt: string;
  escalatedCase: { id: string; reference: string; status: string } | null;
}

function SupportRequests({ canEscalate }: { canEscalate: boolean }) {
  const { t, locale, code } = useT();
  const [status, setStatus] = useState('');
  const list = useResource<SupportRequest[]>('/v1/admin/ops/support-requests', {
    status: status || undefined,
  });
  const cmd = useOpsCommand();
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sup-requests">
      {cmd.banner}
      <Select
        aria-label={t('s8.status')}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        style={{ maxWidth: 220 }}
      >
        <option value="">{t('s8.all')}</option>
        {['OPEN', 'IN_PROGRESS', 'RESOLVED'].map((x) => (
          <option key={x} value={x}>
            {code('s8.supStatus', x)}
          </option>
        ))}
      </Select>
      <OpsStates res={list} empty={(d) => d.length === 0} emptyTitle={t('s8.sup.empty')}>
        {(rows) => (
          <div className="dd-stack" style={{ gap: 10 }}>
            {rows.map((r) => (
              <Card flat key={r.id}>
                <div className="dd-stack" style={{ gap: 4 }} data-testid={`sup-${r.reference}`}>
                  <div
                    className="dd-row"
                    style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}
                  >
                    <strong>
                      <span className="dd-ltr">{r.reference}</span> · {r.subject}
                    </strong>
                    <StatusChip tone={r.status === 'RESOLVED' ? 'success' : 'warning'}>
                      {code('s8.supStatus', r.status)}
                    </StatusChip>
                  </div>
                  <div className="dd-caption">
                    {code('s8.supType', r.type)} · {formatDateTime(locale, r.createdAt)}
                  </div>
                  <div>{r.body}</div>
                  {r.escalatedCase ? (
                    <div className="dd-caption">
                      {t('s8.sup.escalatedTo')}{' '}
                      <Link href={withLocale('/cases', locale)} className="dd-ltr">
                        {r.escalatedCase.reference}
                      </Link>
                    </div>
                  ) : canEscalate && r.status !== 'RESOLVED' ? (
                    <div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cmd.busy}
                        onClick={() =>
                          void cmd.run(
                            `/v1/admin/ops/support-requests/${r.id}/escalate`,
                            {},
                            t('s8.sup.escalated'),
                            () => list.reload(),
                          )
                        }
                        data-testid={`sup-escalate-${r.reference}`}
                      >
                        {t('s8.sup.escalate')}
                      </Button>
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

interface CustomerSummary {
  id: string;
  firstName: string | null;
  mobileMasked: string | null;
  city: string | null;
  locale: string;
  status: string;
  since: string;
  openCases: number;
  openSupportRequests: number;
  restrictions: Array<{
    id: string;
    reference: string;
    kind: string;
    status: string;
    endsAt: string;
  }>;
  points: { available: number; held: number };
  activeVouchers: number;
  openRefunds: number;
}

function CustomerPanel() {
  const { t, locale, code } = useT();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [id, setId] = useState<string | null>(null);
  const found = useResource<
    Array<{ id: string; displayName: string; mobileMasked: string | null }>
  >(search ? '/v1/admin/visibility/customers' : null, { q: search });
  const summary = useResource<CustomerSummary>(id ? `/v1/admin/ops/customers/${id}/summary` : null);
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sup-customer">
      <form
        className="dd-row"
        style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
        }}
      >
        <Field label={t('s8.sup.find')} htmlFor="sup-q">
          <Input id="sup-q" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Button type="submit" disabled={q.trim().length < 3} data-testid="sup-search">
          {t('s8.search')}
        </Button>
      </form>
      {search ? (
        <OpsStates res={found} empty={(d) => d.length === 0} emptyTitle={t('s8.sup.noCustomer')}>
          {(d) => (
            <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {d.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={id === c.id ? 'primary' : 'outline'}
                  onClick={() => setId(c.id)}
                >
                  {c.displayName} {c.mobileMasked ? `· ${c.mobileMasked}` : ''}
                </Button>
              ))}
            </div>
          )}
        </OpsStates>
      ) : null}
      {id ? (
        <OpsStates res={summary}>
          {(s) => (
            <Card data-testid="sup-summary">
              <div className="dd-stack" style={{ gap: 10 }}>
                <KeyValue
                  items={[
                    { label: t('s8.sup.name'), value: s.firstName ?? '-' },
                    {
                      label: t('s8.sup.mobile'),
                      value: <span className="dd-ltr">{s.mobileMasked ?? '-'}</span>,
                    },
                    { label: t('s8.sup.city'), value: s.city ?? '-' },
                    { label: t('s8.sup.status'), value: code('s8.userStatus', s.status) },
                    { label: t('s8.sup.since'), value: formatDateTime(locale, s.since) },
                    { label: t('s8.sup.openCases'), value: s.openCases },
                    { label: t('s8.sup.openRequests'), value: s.openSupportRequests },
                    { label: t('s8.sup.activeVouchers'), value: s.activeVouchers },
                    { label: t('s8.sup.openRefunds'), value: s.openRefunds },
                    {
                      label: t('s8.sup.points'),
                      value: `${s.points.available} / ${s.points.held}`,
                    },
                  ]}
                />
                {s.restrictions.length ? (
                  <div data-testid="sup-restricted">
                    <Alert tone="warning">
                      {t('s8.sup.restricted')}{' '}
                      {s.restrictions
                        .map(
                          (r) =>
                            `${r.reference} (${code('s8.rstKind', r.kind)}, ${code('s8.rstStatus', r.status)})`,
                        )
                        .join(' · ')}
                    </Alert>
                  </div>
                ) : null}
                <p className="dd-caption">{t('s8.sup.correctionsNote')}</p>
              </div>
            </Card>
          )}
        </OpsStates>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- refunds
interface RefundRow {
  id: string;
  reference: string;
  status: string;
  kind: string;
  reasonCode: string | null;
  amountMinor: number;
  currency: string;
  orderId: string;
  orderReference: string;
  caseId: string | null;
  failureCode: string | null;
  createdAt: string;
}
interface Eligibility {
  orderId: string;
  orderReference: string;
  currency: string;
  amountMinor: number;
  eligible: boolean;
  blockers: string[];
  withinWindow: boolean | null;
  policy: { windowHours: number; outsideWindow: string };
  orderLevel: { duplicatePayment: boolean; failedIssuance: boolean };
  payments: Array<{ id: string; status: string; amountMinor: number; createdAt: string }>;
  market: string | null;
  marketPolicy: { version: number; validationCode: string | null } | null;
  validations: Array<{ code: string; topic: string; status: string }>;
}

function RefundOps({ canManage }: { canManage: boolean }) {
  const { t, locale, code } = useT();
  const [status, setStatus] = useState('');
  const queue = useResource<RefundRow[]>('/v1/admin/ops/refunds', { status: status || undefined });
  const [lookup, setLookup] = useState({ kind: 'orderId', id: '' });
  const [query, setQuery] = useState<Record<string, string> | null>(null);
  const elig = useResource<Eligibility>(
    query ? '/v1/admin/ops/refunds/eligibility' : null,
    query ?? undefined,
  );
  const cmd = useOpsCommand();
  const [form, setForm] = useState({
    paymentId: '',
    reason: 'DUPLICATE_PAYMENT',
    note: '',
    caseId: '',
  });
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sup-refunds">
      {cmd.banner}
      <Card flat>
        <form
          className="dd-row"
          style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            setQuery({ [lookup.kind]: lookup.id.trim() });
          }}
        >
          <Field label={t('s8.ref.lookupBy')} htmlFor="ref-kind">
            <Select
              id="ref-kind"
              value={lookup.kind}
              onChange={(e) => setLookup({ ...lookup, kind: e.target.value })}
            >
              <option value="orderId">{t('s8.ref.order')}</option>
              <option value="instanceId">{t('s8.ref.voucher')}</option>
            </Select>
          </Field>
          <Field label={t('s8.ref.id')} htmlFor="ref-id">
            <Input
              id="ref-id"
              className="dd-ltr"
              value={lookup.id}
              onChange={(e) => setLookup({ ...lookup, id: e.target.value })}
            />
          </Field>
          <Button type="submit" disabled={lookup.id.trim().length < 10} data-testid="ref-check">
            {t('s8.ref.check')}
          </Button>
        </form>
      </Card>
      {query ? (
        <OpsStates res={elig}>
          {(e) => (
            <Card data-testid="ref-eligibility">
              <div className="dd-stack" style={{ gap: 8 }}>
                <div
                  className="dd-row"
                  style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}
                >
                  <strong className="dd-ltr">{e.orderReference}</strong>
                  <StatusChip tone={e.eligible ? 'success' : 'warning'}>
                    {e.eligible ? t('s8.ref.eligible') : t('s8.ref.notEligible')}
                  </StatusChip>
                </div>
                <KeyValue
                  items={[
                    {
                      label: t('s8.ref.amount'),
                      value: <Money minor={e.amountMinor} currency={e.currency} />,
                    },
                    {
                      label: t('s8.ref.window'),
                      value: `${e.policy.windowHours} h · ${e.withinWindow === null ? '-' : e.withinWindow ? t('s8.ref.inside') : t('s8.ref.outside')}`,
                    },
                    { label: t('s8.market'), value: e.market ?? '-' },
                    {
                      label: t('s8.ref.marketPolicy'),
                      value: e.marketPolicy
                        ? `v${e.marketPolicy.version}${e.marketPolicy.validationCode ? ` · ${e.marketPolicy.validationCode}` : ''}`
                        : t('s8.ref.noMarketPolicy'),
                    },
                  ]}
                />
                {e.blockers.length ? (
                  <Alert tone="warning">
                    {e.blockers.map((b) => code('s8.refBlocker', b)).join(' · ')}
                  </Alert>
                ) : null}
                {e.validations.length ? (
                  <div data-testid="ref-validations">
                    <Alert tone="info">
                      {t('s8.ref.validationNote')} {e.validations.map((v) => v.code).join(', ')}
                    </Alert>
                  </div>
                ) : null}
                <p className="dd-caption">{t('s8.ref.decisionNote')}</p>
                <div>
                  <Link href={withLocale(`/finance/orders/${e.orderId}`, locale)}>
                    {t('s8.ref.openOrder')}
                  </Link>
                </div>
                {canManage && (e.orderLevel.duplicatePayment || e.orderLevel.failedIssuance) ? (
                  <div className="dd-stack" style={{ gap: 8 }} data-testid="ref-order-level">
                    <h3 className="dd-title-sm">{t('s8.ref.orderLevel')}</h3>
                    <div className="dd-row" style={{ flexWrap: 'wrap' }}>
                      <Field label={t('s8.ref.reason')} htmlFor="ref-reason">
                        <Select
                          id="ref-reason"
                          value={form.reason}
                          onChange={(ev) => setForm({ ...form, reason: ev.target.value })}
                        >
                          {e.orderLevel.duplicatePayment ? (
                            <option value="DUPLICATE_PAYMENT">
                              {code('s8.orderRefund', 'DUPLICATE_PAYMENT')}
                            </option>
                          ) : null}
                          {e.orderLevel.failedIssuance ? (
                            <option value="FAILED_ISSUANCE">
                              {code('s8.orderRefund', 'FAILED_ISSUANCE')}
                            </option>
                          ) : null}
                        </Select>
                      </Field>
                      <Field label={t('s8.ref.payment')} htmlFor="ref-pay">
                        <Select
                          id="ref-pay"
                          value={form.paymentId}
                          onChange={(ev) => setForm({ ...form, paymentId: ev.target.value })}
                        >
                          <option value="">{t('s8.choose')}</option>
                          {e.payments
                            .filter((p) => p.status === 'SUCCEEDED')
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {formatDateTime(locale, p.createdAt)} ·{' '}
                                {(p.amountMinor / 100).toFixed(2)}
                              </option>
                            ))}
                        </Select>
                      </Field>
                      <Field label={t('s8.adj.case')} htmlFor="ref-case">
                        <Input
                          id="ref-case"
                          className="dd-ltr"
                          value={form.caseId}
                          onChange={(ev) => setForm({ ...form, caseId: ev.target.value })}
                        />
                      </Field>
                    </div>
                    <ReasonField
                      id="ref-note"
                      value={form.note}
                      onChange={(v) => setForm({ ...form, note: v })}
                    />
                    <div>
                      <Button
                        disabled={!form.paymentId || !reasonOk(form.note) || cmd.busy}
                        onClick={() =>
                          void cmd.run(
                            '/v1/admin/ops/refunds/order',
                            {
                              orderId: e.orderId,
                              paymentId: form.paymentId,
                              reason: form.reason,
                              note: form.note,
                              caseId: form.caseId.trim() || null,
                            },
                            t('s8.ref.requested'),
                            async () => {
                              await elig.reload();
                              await queue.reload();
                            },
                          )
                        }
                        data-testid="ref-order-submit"
                      >
                        {t('s8.ref.requestOrder')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            </Card>
          )}
        </OpsStates>
      ) : null}
      <h3 className="dd-title-sm">{t('s8.ref.queue')}</h3>
      <Select
        aria-label={t('s8.status')}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        style={{ maxWidth: 220 }}
      >
        <option value="">{t('s8.ref.unfinished')}</option>
        {[
          'REQUESTED',
          'UNDER_REVIEW',
          'APPROVED',
          'PROCESSING',
          'SUCCEEDED',
          'FAILED',
          'REJECTED',
        ].map((x) => (
          <option key={x} value={x}>
            {code('s8.refStatus', x)}
          </option>
        ))}
      </Select>
      <OpsStates res={queue} empty={(d) => d.length === 0} emptyTitle={t('s8.ref.empty')}>
        {(rows) => (
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('s8.reference')}</th>
                  <th>{t('s8.ref.order')}</th>
                  <th>{t('s8.ref.amount')}</th>
                  <th>{t('s8.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`ref-${r.reference}`}>
                    <td className="dd-ltr">{r.reference}</td>
                    <td className="dd-ltr">{r.orderReference}</td>
                    <td>
                      <Money minor={r.amountMinor} currency={r.currency} />
                    </td>
                    <td>
                      <StatusChip
                        tone={
                          r.status === 'FAILED' || r.status === 'REJECTED'
                            ? 'danger'
                            : r.status === 'SUCCEEDED'
                              ? 'success'
                              : 'warning'
                        }
                      >
                        {code('s8.refStatus', r.status)}
                      </StatusChip>
                      {r.failureCode ? (
                        <div className="dd-caption dd-ltr">{r.failureCode}</div>
                      ) : null}
                    </td>
                    <td>
                      <Link href={withLocale(`/finance/orders/${r.orderId}`, locale)}>
                        {t('s8.ref.openOrder')}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </OpsStates>
    </div>
  );
}

// ---------------------------------------------------------------- privacy data requests
interface DataRequest {
  id: string;
  reference: string;
  type: string;
  status: string;
  customerUserId: string;
  requestedVia: string;
  reason: string | null;
  decisionReason: string | null;
  completedAt: string | null;
  createdAt: string;
}

function PrivacyRequests({ canManage }: { canManage: boolean }) {
  const { t, locale, code } = useT();
  const perms = usePerms();
  const [status, setStatus] = useState('');
  const list = useResource<DataRequest[]>('/v1/admin/ops/data-requests', {
    status: status || undefined,
  });
  const cmd = useOpsCommand();
  const [f, setF] = useState({ customerUserId: '', type: 'EXPORT', reason: '' });
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="sup-privacy">
      <Alert tone="info">{t('s8.dr.retentionNote')}</Alert>
      {cmd.banner}
      {canManage ? (
        <Card flat>
          <div className="dd-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Field label={t('s8.adj.customer')} htmlFor="dr-cust">
              <Input
                id="dr-cust"
                className="dd-ltr"
                value={f.customerUserId}
                onChange={(e) => setF({ ...f, customerUserId: e.target.value })}
              />
            </Field>
            <Field label={t('s8.dr.type')} htmlFor="dr-type">
              <Select
                id="dr-type"
                value={f.type}
                onChange={(e) => setF({ ...f, type: e.target.value })}
              >
                <option value="EXPORT">{code('s8.drType', 'EXPORT')}</option>
                <option value="DELETION">{code('s8.drType', 'DELETION')}</option>
              </Select>
            </Field>
            <Field label={t('s8.reason')} htmlFor="dr-reason">
              <Input
                id="dr-reason"
                value={f.reason}
                onChange={(e) => setF({ ...f, reason: e.target.value })}
              />
            </Field>
            <Button
              disabled={f.customerUserId.trim().length < 30 || cmd.busy}
              onClick={() =>
                void cmd.run(
                  '/v1/admin/ops/data-requests',
                  {
                    customerUserId: f.customerUserId.trim(),
                    type: f.type,
                    reason: f.reason.trim() || null,
                  },
                  t('s8.dr.created'),
                  async () => {
                    setF({ ...f, customerUserId: '', reason: '' });
                    await list.reload();
                  },
                )
              }
              data-testid="dr-submit"
            >
              {t('s8.dr.create')}
            </Button>
          </div>
        </Card>
      ) : null}
      <Select
        aria-label={t('s8.status')}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        style={{ maxWidth: 220 }}
      >
        <option value="">{t('s8.all')}</option>
        {DATA_REQUEST_STATUSES.map((x) => (
          <option key={x} value={x}>
            {code('s8.drStatus', x)}
          </option>
        ))}
      </Select>
      <OpsStates res={list} empty={(d) => d.length === 0} emptyTitle={t('s8.dr.empty')}>
        {(rows) => (
          <div className="dd-stack" style={{ gap: 10 }}>
            {rows.map((r) => (
              <Card flat key={r.id}>
                <div className="dd-stack" style={{ gap: 4 }} data-testid={`dr-${r.reference}`}>
                  <div
                    className="dd-row"
                    style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}
                  >
                    <strong>
                      <span className="dd-ltr">{r.reference}</span> · {code('s8.drType', r.type)}
                    </strong>
                    <StatusChip tone={OPS_TONE[r.status] ?? 'neutral'}>
                      {code('s8.drStatus', r.status)}
                    </StatusChip>
                  </div>
                  <div className="dd-caption">
                    <span className="dd-ltr">{r.customerUserId}</span> ·{' '}
                    {code('s8.drVia', r.requestedVia)} · {formatDateTime(locale, r.createdAt)}
                  </div>
                  {r.reason ? <div>{r.reason}</div> : null}
                  {r.decisionReason ? <div className="dd-caption">{r.decisionReason}</div> : null}
                  {r.status === 'PENDING_APPROVAL' || r.status === 'REQUESTED' ? (
                    <DecisionBar
                      id={r.reference}
                      canDecide={perms.includes('admin.privacy.approve')}
                      busy={cmd.busy}
                      onDecide={(approve, reason) =>
                        void cmd.run(
                          `/v1/admin/ops/data-requests/${r.id}/decide`,
                          { decision: approve ? 'APPROVE' : 'REJECT', reason },
                          approve ? t('s8.dr.approved') : t('s8.dr.rejected'),
                          () => list.reload(),
                        )
                      }
                    />
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

// ====================================================================================== notification operations
interface Delivery {
  id: string;
  notificationId: string;
  channel: string;
  provider: string | null;
  templateCode: string;
  templateVersion: number;
  market: string | null;
  locale: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  failureReason: string | null;
  suppressedReason: string | null;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
}

/** Admin -> Notification operations: per-channel delivery, retries, failures and suppressions (consent / preference). */
export function AdminNotificationsPage() {
  return (
    <RequirePermission any={['admin.notifications.manage']}>
      <div className="dd-stack" style={{ gap: 16 }}>
        <Notifications />
        <StagingTestInbox />
      </div>
    </RequirePermission>
  );
}

function Notifications() {
  const { t, locale, code } = useT();
  const [status, setStatus] = useState('FAILED');
  const [channel, setChannel] = useState('');
  const list = useResource<{ counts: Record<string, number>; items: Delivery[] }>(
    '/v1/admin/ops/notifications',
    { status: status || undefined, channel: channel || undefined },
  );
  const cmd = useOpsCommand();
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="ops-notifications">
      <OpsHeader
        title={t('s8.ntf.title')}
        intro={t('s8.ntf.intro')}
        actions={
          <Button
            variant="outline"
            disabled={cmd.busy}
            onClick={() =>
              void cmd.run('/v1/admin/ops/notifications/sweep', {}, t('s8.ntf.swept'), () =>
                list.reload(),
              )
            }
            data-testid="ntf-sweep"
          >
            {t('s8.ntf.sweep')}
          </Button>
        }
      />
      {cmd.banner}
      {list.data ? (
        <div className="dd-row" style={{ flexWrap: 'wrap', gap: 8 }} data-testid="ntf-counts">
          {DELIVERY_STATUSES.map((s) => (
            <StatusChip key={s} tone={OPS_TONE[s] ?? 'neutral'}>
              {code('s8.dlvStatus', s)}: {list.data?.counts[s] ?? 0}
            </StatusChip>
          ))}
        </div>
      ) : null}
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        <Select
          aria-label={t('s8.status')}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          style={{ maxWidth: 200 }}
          data-testid="ntf-filter"
        >
          <option value="">{t('s8.all')}</option>
          {DELIVERY_STATUSES.map((x) => (
            <option key={x} value={x}>
              {code('s8.dlvStatus', x)}
            </option>
          ))}
        </Select>
        <Select
          aria-label={t('s8.ntf.channel')}
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          style={{ maxWidth: 200 }}
        >
          <option value="">{t('s8.all')}</option>
          {DELIVERY_CHANNELS.map((x) => (
            <option key={x} value={x}>
              {code('s8.channel', x)}
            </option>
          ))}
        </Select>
      </div>
      <OpsStates res={list} empty={(d) => d.items.length === 0} emptyTitle={t('s8.ntf.empty')}>
        {(d) => (
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('s8.ntf.template')}</th>
                  <th>{t('s8.ntf.channel')}</th>
                  <th>{t('s8.status')}</th>
                  <th>{t('s8.ntf.attempts')}</th>
                  <th>{t('s8.ntf.when')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.items.map((x) => (
                  <tr key={x.id} data-testid={`ntf-${x.id}`}>
                    <td>
                      <span className="dd-ltr">
                        {x.templateCode} v{x.templateVersion}
                      </span>
                      <div className="dd-caption">
                        {x.locale.toUpperCase()} {x.market ? `· ${x.market}` : ''}
                      </div>
                    </td>
                    <td>{code('s8.channel', x.channel)}</td>
                    <td>
                      <StatusChip tone={OPS_TONE[x.status] ?? 'neutral'}>
                        {code('s8.dlvStatus', x.status)}
                      </StatusChip>
                      {x.failureReason ? <div className="dd-caption">{x.failureReason}</div> : null}
                      {x.suppressedReason ? (
                        <div className="dd-caption">
                          {code('s8.suppressed', x.suppressedReason)}
                        </div>
                      ) : null}
                    </td>
                    <td className="dd-ltr">
                      {x.attempts} / {x.maxAttempts}
                      {x.nextRetryAt ? (
                        <div className="dd-caption">{formatDateTime(locale, x.nextRetryAt)}</div>
                      ) : null}
                    </td>
                    <td>{formatDateTime(locale, x.lastAttemptAt ?? x.createdAt)}</td>
                    <td>
                      {x.status === 'FAILED' || x.status === 'RETRYING' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cmd.busy}
                          onClick={() =>
                            void cmd.run(
                              `/v1/admin/ops/notifications/${x.id}/retry`,
                              {},
                              t('s8.ntf.retried'),
                              () => list.reload(),
                            )
                          }
                          data-testid={`ntf-retry-${x.id}`}
                        >
                          {t('s8.retry')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </OpsStates>
    </div>
  );
}

interface TestMessage {
  id: string;
  channel: 'SMS' | 'EMAIL';
  recipient: string;
  templateKey: string;
  subject: string | null;
  code: string | null;
  link: string | null;
  createdAt: string;
}

/**
 * Launch readiness G-1 — STAGING ONLY. Sign-in codes and invitation links that the development SMS / e-mail adapters "sent" to
 * synthetic test recipients. The API answers 404 in every other environment, and then nothing is shown.
 */
function StagingTestInbox() {
  const { t, locale, code } = useT();
  const { call } = useApi();
  const [recipient, setRecipient] = useState('');
  const [state, setState] = useState<'loading' | 'off' | 'error' | 'ready'>('loading');
  const [items, setItems] = useState<TestMessage[]>([]);
  const load = useCallback(
    async (filter: string) => {
      setState('loading');
      const r = await call<{ items: TestMessage[] }>('GET', '/v1/admin/staging/test-inbox', {
        query: { recipient: filter.trim() || undefined },
      });
      if (r.status === 404) return setState('off');
      if (!r.ok || !r.data) return setState('error');
      setItems(r.data.items);
      setState('ready');
    },
    [call],
  );
  useEffect(() => {
    void load('');
  }, [load]);
  if (state === 'off') return null;
  return (
    <Card>
      <div className="dd-stack" style={{ gap: 12 }} data-testid="staging-inbox">
        <div>
          <h2 className="dd-title">{t('stg.inbox.title')}</h2>
          <p className="dd-muted">{t('stg.inbox.intro')}</p>
        </div>
        <form
          className="dd-row"
          style={{ flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            void load(recipient);
          }}
        >
          <Input
            aria-label={t('stg.inbox.recipient')}
            placeholder={t('stg.inbox.recipient')}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            style={{ maxWidth: 280 }}
            data-testid="staging-inbox-filter"
          />
          <Button type="submit" variant="outline" disabled={state === 'loading'}>
            {t('stg.inbox.refresh')}
          </Button>
        </form>
        {state === 'error' ? (
          <Alert tone="danger">{t('stg.inbox.error')}</Alert>
        ) : state === 'ready' && items.length === 0 ? (
          <p className="dd-muted">{t('stg.inbox.empty')}</p>
        ) : state === 'ready' ? (
          <div className="dd-table-wrap">
            <table className="dd-table">
              <thead>
                <tr>
                  <th>{t('stg.inbox.recipient')}</th>
                  <th>{t('s8.ntf.channel')}</th>
                  <th>{t('stg.inbox.codeOrLink')}</th>
                  <th>{t('stg.inbox.when')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} data-testid={`staging-msg-${m.id}`}>
                    <td>
                      <span className="dd-ltr">{m.recipient}</span>
                      <div className="dd-caption dd-ltr">{m.subject ?? m.templateKey}</div>
                    </td>
                    <td>{code('s8.channel', m.channel)}</td>
                    <td className="dd-ltr">
                      {m.code ? <strong>{m.code}</strong> : null}
                      {m.link ? (
                        <div>
                          <a href={m.link} target="_blank" rel="noreferrer">
                            {m.link}
                          </a>
                        </div>
                      ) : null}
                    </td>
                    <td>{formatDateTime(locale, m.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
