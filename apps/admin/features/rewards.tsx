'use client';

import { useCallback, useEffect, useState } from 'react';
import { Points, RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import {
  createTranslator,
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
  Input,
  LoadingState,
  Modal,
  Select,
  StatusChip,
  Tabs,
  Textarea,
} from '@dealdash/ui';
import type {
  RewardAccountRow,
  RewardAdjustmentView,
  RewardAdminOverview,
  RewardLedgerRow,
} from '@dealdash/validation';

export function AdminRewardsPage() {
  return (
    <RequirePermission any={['admin.rewards.read', 'admin.rewards.request']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const perms = me?.permissions ?? [];
  const canRead = perms.includes('admin.rewards.read');
  const canRequest = perms.includes('admin.rewards.request');
  const canManage = perms.includes('admin.rewards.manage');
  const tabs = [
    ...(canRead ? [{ id: 'overview', label: t('arw.tabOverview') }] : []),
    ...(canRead ? [{ id: 'ledger', label: t('arw.tabLedger') }] : []),
    ...(canRequest ? [{ id: 'adjustments', label: t('arw.tabAdjustments') }] : []),
    ...(canRead ? [{ id: 'catalogue', label: t('arw.tabCatalogue') }] : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.id ?? 'overview');
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-rewards">
      <div>
        <h1 className="dd-title-xl">{t('arw.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('arw.sub')}
        </p>
      </div>
      <Tabs label={t('arw.title')} value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'overview' ? <Overview /> : null}
      {tab === 'ledger' ? <Ledger /> : null}
      {tab === 'adjustments' ? <Adjustments canManage={canManage} /> : null}
      {tab === 'catalogue' ? <Catalogue canManage={canManage} /> : null}
    </div>
  );
}

function useOverview() {
  const { call } = useApi();
  const [data, setData] = useState<RewardAdminOverview | null>(null);
  const load = useCallback(async () => {
    const r = await call<RewardAdminOverview>('GET', '/v1/admin/rewards/overview');
    setData(r.data);
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, reload: load };
}

function Overview() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const { data } = useOverview();
  const [check, setCheck] = useState<{ accounts: number; mismatches: number } | null>(null);
  if (!data) return <LoadingState label={t('state.loading')} />;
  const n = (v: number) => formatNumber(locale, v);
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="rewards-overview">
      <div className="dd-finance-grid">
        <Card flat>
          <div className="dd-caption">{t('arw.liability.available')}</div>
          <div className="dd-title-xl dd-ltr" style={{ fontSize: 24 }} data-testid="liab-available">
            {n(data.liability.availableBalance)}
          </div>
        </Card>
        <Card flat>
          <div className="dd-caption">{t('arw.liability.held')}</div>
          <div className="dd-title-xl dd-ltr" style={{ fontSize: 24 }} data-testid="liab-held">
            {n(data.liability.heldBalance)}
          </div>
        </Card>
        <Card flat>
          <div className="dd-caption">{t('arw.liability.accounts')}</div>
          <div className="dd-title-xl dd-ltr" style={{ fontSize: 24 }}>
            {n(data.liability.accounts)}
          </div>
        </Card>
      </div>
      <Alert tone="info">{t('arw.noValue')}</Alert>
      <Card flat>
        <h2 className="dd-title">{t('arw.rules')}</h2>
        <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
          {data.rules.rewardRule.map((r) => (
            <div className="dd-kv__row" key={r.upToSec}>
              <dt>{t('arw.upTo', { n: r.upToSec })}</dt>
              <dd>
                <Points n={r.points} locale={locale} />
              </dd>
            </div>
          ))}
          <div className="dd-kv__row">
            <dt>{t('arw.expiry')}</dt>
            <dd data-testid="rule-expiry">
              {data.rules.expiryDays
                ? t('arw.expiryDays', { n: data.rules.expiryDays })
                : t('arw.expiryOff')}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('arw.negative')}</dt>
            <dd>{t(`arw.neg.${data.rules.negativeBalancePolicy}` as DictionaryKey)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('arw.checker')}</dt>
            <dd className="dd-ltr">{n(data.rules.adjustmentCheckerThresholdPoints)}</dd>
          </div>
        </dl>
        <p className="dd-caption">{t('arw.rulesNote')}</p>
      </Card>
      <Card flat>
        <h2 className="dd-title">{t('arw.reconcile')}</h2>
        <p className="dd-muted">{t('arw.reconcileBody')}</p>
        <Button
          variant="outline"
          onClick={async () =>
            setCheck(
              (
                await call<{ accounts: number; mismatches: number }>(
                  'GET',
                  '/v1/admin/rewards/reconcile',
                )
              ).data,
            )
          }
          data-testid="reconcile-run"
        >
          {t('arw.reconcileRun')}
        </Button>
        {check ? (
          <div style={{ marginBlockStart: 8 }}>
            <Alert tone={check.mismatches === 0 ? 'success' : 'danger'}>
              <span data-testid="reconcile-result">
                {t('arw.reconcileResult', { accounts: check.accounts, bad: check.mismatches })}
              </span>
            </Alert>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Ledger() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [q, setQ] = useState('');
  const [accounts, setAccounts] = useState<RewardAccountRow[]>([]);
  const [sel, setSel] = useState<RewardAccountRow | null>(null);
  const [rows, setRows] = useState<RewardLedgerRow[] | null>(null);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (q.trim().length < 3) return;
    const r = await call<RewardAccountRow[]>('GET', '/v1/admin/rewards/accounts', {
      query: { q: q.trim(), limit: 20 },
    });
    setAccounts(r.data ?? []);
    setSearched(true);
  };
  useEffect(() => {
    if (!sel) return;
    setRows(null);
    void call<RewardLedgerRow[]>('GET', '/v1/admin/rewards/ledger', {
      query: { userId: sel.userId, limit: 50 },
    }).then((r) => setRows(r.data ?? []));
  }, [call, sel]);
  useEffect(() => {
    if (sel) return;
    void call<RewardLedgerRow[]>('GET', '/v1/admin/rewards/ledger', { query: { limit: 30 } }).then(
      (r) => setRows(r.data ?? []),
    );
  }, [call, sel]);

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="rewards-ledger">
      <div className="dd-inline-fields">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          placeholder={t('arw.searchPlaceholder')}
          aria-label={t('arw.searchPlaceholder')}
          style={{ maxInlineSize: 320 }}
          data-testid="rewards-search"
        />
        <Button variant="outline" onClick={() => void search()}>
          {t('mdeal.hub.search')}
        </Button>
        {sel ? (
          <Button variant="ghost" onClick={() => setSel(null)}>
            {t('arw.allAccounts')}
          </Button>
        ) : null}
      </div>
      {searched && !sel ? (
        accounts.length === 0 ? (
          <EmptyState title={t('arw.noAccounts')} />
        ) : (
          <Card className="dd-card--flat" style={{ padding: 0 }}>
            <div className="dd-table-wrap" style={{ border: 0 }}>
              <table className="dd-table" data-testid="accounts-table">
                <thead>
                  <tr>
                    <th scope="col">{t('rsk.col.subject')}</th>
                    <th scope="col">{t('rew.available')}</th>
                    <th scope="col">{t('rew.held')}</th>
                    <th scope="col">{t('rew.earnedTotal')}</th>
                    <th scope="col">{t('rew.redeemedTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.userId} data-testid="account-row">
                      <td>
                        <button type="button" className="dd-rowlink" onClick={() => setSel(a)}>
                          <span className="dd-ltr">{a.label}</span>
                        </button>
                      </td>
                      <td className="dd-ltr">{formatNumber(locale, a.availableBalance)}</td>
                      <td className="dd-ltr">{formatNumber(locale, a.heldBalance)}</td>
                      <td className="dd-ltr">{formatNumber(locale, a.lifetimeEarned)}</td>
                      <td className="dd-ltr">{formatNumber(locale, a.lifetimeRedeemed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : null}
      {sel ? (
        <Alert tone="info">
          <span className="dd-ltr">{sel.label}</span> · {t('rew.available')}:{' '}
          <strong className="dd-ltr">{formatNumber(locale, sel.availableBalance)}</strong> ·{' '}
          {t('rew.held')}:{' '}
          <strong className="dd-ltr">{formatNumber(locale, sel.heldBalance)}</strong>
        </Alert>
      ) : null}
      {rows === null ? (
        <LoadingState label={t('state.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('arw.noEntries')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table" data-testid="ledger-table">
              <thead>
                <tr>
                  <th scope="col">{t('fin.col.when')}</th>
                  <th scope="col">{t('rsk.col.subject')}</th>
                  <th scope="col">{t('fin.col.type')}</th>
                  <th scope="col">{t('arw.col.points')}</th>
                  <th scope="col">{t('arw.col.bucket')}</th>
                  <th scope="col">{t('arw.col.source')}</th>
                  <th scope="col">{t('arw.col.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} data-testid="ledger-row" data-type={e.type}>
                    <td className="dd-caption">{formatDateTime(locale, e.createdAt)}</td>
                    <td className="dd-ltr">{e.accountLabel}</td>
                    <td>{t(`rew.type.${e.type}` as DictionaryKey)}</td>
                    <td>
                      <Points n={e.points} locale={locale} signed />
                    </td>
                    <td>{t(`arw.bucket.${e.bucket}` as DictionaryKey)}</td>
                    <td className="dd-caption">
                      {e.sourceType}
                      {e.title ? ` · ${e.title[locale] || e.title.en}` : ''}
                    </td>
                    <td className="dd-caption">
                      {[e.reasonCode, e.actorRole].filter(Boolean).join(' · ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Adjustments({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [rows, setRows] = useState<RewardAdjustmentView[] | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [decide, setDecide] = useState<{ row: RewardAdjustmentView; approve: boolean } | null>(
    null,
  );

  const load = useCallback(async () => {
    const r = await call<RewardAdjustmentView[]>('GET', '/v1/admin/rewards/adjustments', {
      query: { limit: 50 },
    });
    setRows(r.data ?? []);
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="rewards-adjustments">
      <div className="dd-row" style={{ justifyContent: 'space-between' }}>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('arw.adjustBody')}
        </p>
        <Button onClick={() => setOpen(true)} data-testid="adjust-new">
          + {t('arw.adjustNew')}
        </Button>
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {rows === null ? (
        <LoadingState label={t('state.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('arw.adjustEmpty')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('fin.col.when')}</th>
                  <th scope="col">{t('rsk.col.subject')}</th>
                  <th scope="col">{t('arw.col.points')}</th>
                  <th scope="col">{t('arw.col.reason')}</th>
                  <th scope="col">{t('arw.col.ticket')}</th>
                  <th scope="col">{t('mdeal.col.status')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} data-testid="adjust-row" data-status={a.status}>
                    <td className="dd-caption">{formatDateTime(locale, a.createdAt)}</td>
                    <td className="dd-ltr">{a.accountLabel}</td>
                    <td>
                      <Points n={a.points} locale={locale} signed />
                      {a.needsChecker ? (
                        <div className="dd-caption">{t('arw.needsChecker')}</div>
                      ) : null}
                    </td>
                    <td className="dd-caption">
                      {a.reasonCode}: {a.reason}
                    </td>
                    <td className="dd-ltr">{a.ticketRef}</td>
                    <td>
                      <StatusChip
                        tone={
                          a.status === 'APPROVED'
                            ? 'success'
                            : a.status === 'REJECTED'
                              ? 'neutral'
                              : 'warning'
                        }
                      >
                        {t(`arw.adjust.${a.status}` as DictionaryKey)}
                      </StatusChip>
                    </td>
                    <td>
                      {canManage && a.actions.includes('approve') ? (
                        <div className="dd-row">
                          <Button
                            size="sm"
                            onClick={() => setDecide({ row: a, approve: true })}
                            data-testid="adjust-approve"
                          >
                            {t('ah.approve')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDecide({ row: a, approve: false })}
                            data-testid="adjust-reject"
                          >
                            {t('ah.reject')}
                          </Button>
                        </div>
                      ) : a.status === 'PENDING' && canManage && a.needsChecker ? (
                        <span className="dd-caption">{t('arw.otherAdmin')}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <AdjustForm
        open={open}
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false);
          setNotice(t('arw.adjustRequested'));
          void load();
        }}
      />
      <DecideDialog
        target={decide}
        onClose={() => setDecide(null)}
        onDone={() => {
          setDecide(null);
          setNotice(t('ah.done'));
          void load();
        }}
      />
    </div>
  );
}

function AdjustForm({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [userId, setUserId] = useState('');
  const [points, setPoints] = useState('');
  const [reasonCode, setReasonCode] = useState('GOODWILL');
  const [ticketRef, setTicketRef] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setUserId('');
      setPoints('');
      setTicketRef('');
      setReason('');
      setError('');
    }
  }, [open]);
  const submit = async () => {
    setBusy(true);
    const r = await call('POST', '/v1/admin/rewards/adjustments', {
      body: {
        userId: userId.trim(),
        points: Number(points),
        reasonCode,
        ticketRef: ticketRef.trim(),
        reason: reason.trim(),
      },
    });
    setBusy(false);
    if (!r.ok) return setError(errorMessage(locale, r.errors));
    onDone();
  };
  const ok =
    /^[0-9a-f-]{36}$/i.test(userId.trim()) &&
    Number(points) !== 0 &&
    Number.isInteger(Number(points)) &&
    ticketRef.trim().length >= 2 &&
    reason.trim().length >= 3;
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={t('arw.adjustNew')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void submit()}
            loading={busy}
            disabled={!ok}
            data-testid="adjust-submit"
          >
            {t('arw.adjustSubmit')}
          </Button>
        </>
      }
    >
      <div className="dd-stack">
        <Field label={`${t('arw.customerId')} *`} htmlFor="adj-user" help={t('arw.customerIdHelp')}>
          <Input
            id="adj-user"
            dir="ltr"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
        </Field>
        <Field
          label={`${t('arw.pointsSigned')} *`}
          htmlFor="adj-points"
          help={t('arw.pointsSignedHelp')}
        >
          <Input
            id="adj-points"
            type="number"
            dir="ltr"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
          />
        </Field>
        <Field label={`${t('arw.col.reason')} *`} htmlFor="adj-code">
          <Select id="adj-code" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
            {['GOODWILL', 'CORRECTION', 'CLAWBACK', 'SUPPORT'].map((c) => (
              <option key={c} value={c}>
                {t(`arw.code.${c}` as DictionaryKey)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`${t('arw.col.ticket')} *`} htmlFor="adj-ticket">
          <Input
            id="adj-ticket"
            dir="ltr"
            value={ticketRef}
            onChange={(e) => setTicketRef(e.target.value)}
          />
        </Field>
        <Field label={`${t('modal.reason')} *`} htmlFor="adj-reason">
          <Textarea
            id="adj-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

function DecideDialog({
  target,
  onClose,
  onDone,
}: {
  target: { row: RewardAdjustmentView; approve: boolean } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setReason('');
    setError('');
  }, [target]);
  return (
    <Modal
      open={!!target}
      onClose={() => !busy && onClose()}
      title={target?.approve ? t('ah.approve') : t('ah.reject')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={target?.approve ? 'primary' : 'danger'}
            loading={busy}
            disabled={reason.trim().length < 3}
            data-testid="adjust-decide-confirm"
            onClick={async () => {
              if (!target) return;
              setBusy(true);
              const r = await call(
                'POST',
                `/v1/admin/rewards/adjustments/${target.row.id}/${target.approve ? 'approve' : 'reject'}`,
                {
                  body: { reason: reason.trim() },
                },
              );
              setBusy(false);
              if (!r.ok) return setError(errorMessage(locale, r.errors));
              onDone();
            }}
          >
            {target?.approve ? t('ah.approve') : t('ah.reject')}
          </Button>
        </>
      }
    >
      <div className="dd-stack">
        {target ? (
          <p>
            <Points n={target.row.points} locale={locale} signed /> ·{' '}
            <span className="dd-ltr">{target.row.accountLabel}</span>
          </p>
        ) : null}
        <Field label={`${t('modal.reason')} *`} htmlFor="adj-decide-reason">
          <Textarea
            id="adj-decide-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}

function Catalogue({ canManage }: { canManage: boolean }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const { data, reload } = useOverview();
  const [edit, setEdit] = useState<null | {
    id: string | null;
    init: RewardAdminOverview['items'][number] | null;
  }>(null);
  if (!data) return <LoadingState label={t('state.loading')} />;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="rewards-catalogue">
      <div className="dd-row" style={{ justifyContent: 'space-between' }}>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('arw.catalogueBody')}
        </p>
        {canManage ? (
          <Button onClick={() => setEdit({ id: null, init: null })} data-testid="item-new">
            + {t('arw.itemNew')}
          </Button>
        ) : null}
      </div>
      {data.items.length === 0 ? (
        <EmptyState title={t('rew.noItems')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('arw.col.item')}</th>
                  <th scope="col">{t('arw.col.points')}</th>
                  <th scope="col">{t('arw.col.stock')}</th>
                  <th scope="col">{t('arw.col.redeemed')}</th>
                  <th scope="col">{t('mdeal.col.status')}</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id} data-testid="item-row">
                    <td>
                      {i.name[locale] || i.name.en}{' '}
                      {i.isSample ? (
                        <StatusChip tone="neutral">{t('rew.sample')}</StatusChip>
                      ) : null}
                    </td>
                    <td>
                      <Points n={i.pointsCost} locale={locale} />
                    </td>
                    <td className="dd-ltr">
                      {i.stock === null ? '∞' : formatNumber(locale, i.stock)}
                    </td>
                    <td className="dd-ltr">{formatNumber(locale, i.redeemed)}</td>
                    <td>
                      <StatusChip tone={i.status === 'ACTIVE' ? 'success' : 'neutral'}>
                        {t(`arw.item.${i.status}` as DictionaryKey)}
                      </StatusChip>
                    </td>
                    <td>
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEdit({ id: i.id, init: i })}
                        >
                          {t('action.edit')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ItemForm
        target={edit}
        onClose={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          void reload();
        }}
        call={call}
      />
    </div>
  );
}

function ItemForm({
  target,
  onClose,
  onSaved,
  call,
}: {
  target: null | { id: string | null; init: RewardAdminOverview['items'][number] | null };
  onClose: () => void;
  onSaved: () => void;
  call: ReturnType<typeof useApi>['call'];
}) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [f, setF] = useState({
    en: '',
    ar: '',
    cost: '',
    stock: '',
    status: 'ACTIVE',
    sample: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const i = target?.init;
    setF({
      en: i?.name.en ?? '',
      ar: i?.name.ar ?? '',
      cost: i ? String(i.pointsCost) : '',
      stock: i?.stock === null || i === null || i === undefined ? '' : String(i.stock),
      status: i?.status ?? 'ACTIVE',
      sample: i?.isSample ?? true,
    });
    setError('');
  }, [target]);
  const ok = f.en.trim() && f.ar.trim() && Number(f.cost) >= 1;
  return (
    <Modal
      open={!!target}
      onClose={() => !busy && onClose()}
      title={target?.id ? t('arw.itemEdit') : t('arw.itemNew')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={!ok}
            data-testid="item-save"
            onClick={async () => {
              setBusy(true);
              const body = {
                name: { en: f.en.trim(), ar: f.ar.trim() },
                description: { en: target?.init ? '' : '', ar: '' },
                pointsCost: Number(f.cost),
                stock: f.stock === '' ? null : Number(f.stock),
                status: f.status,
                validityDays: 30,
                isSample: f.sample,
              };
              const r = target?.id
                ? await call('PUT', `/v1/admin/rewards/items/${target.id}`, { body })
                : await call('POST', '/v1/admin/rewards/items', { body });
              setBusy(false);
              if (!r.ok) return setError(errorMessage(locale, r.errors));
              onSaved();
            }}
          >
            {t('mhb.save')}
          </Button>
        </>
      }
    >
      <div className="dd-stack">
        <div className="dd-bi">
          <Field label={`${t('arw.col.item')} (${t('builder.langEn')}) *`} htmlFor="item-en">
            <Input
              id="item-en"
              lang="en"
              value={f.en}
              onChange={(e) => setF({ ...f, en: e.target.value })}
            />
          </Field>
          <Field label={`${t('arw.col.item')} (${t('builder.langAr')}) *`} htmlFor="item-ar">
            <Input
              id="item-ar"
              lang="ar"
              dir="rtl"
              value={f.ar}
              onChange={(e) => setF({ ...f, ar: e.target.value })}
            />
          </Field>
        </div>
        <div className="dd-grid dd-grid--2">
          <Field label={`${t('arw.col.points')} *`} htmlFor="item-cost">
            <Input
              id="item-cost"
              type="number"
              min={1}
              dir="ltr"
              value={f.cost}
              onChange={(e) => setF({ ...f, cost: e.target.value })}
            />
          </Field>
          <Field label={t('arw.col.stock')} htmlFor="item-stock" help={t('arw.stockHelp')}>
            <Input
              id="item-stock"
              type="number"
              min={0}
              dir="ltr"
              value={f.stock}
              onChange={(e) => setF({ ...f, stock: e.target.value })}
            />
          </Field>
        </div>
        <Field label={t('mdeal.col.status')} htmlFor="item-status">
          <Select
            id="item-status"
            value={f.status}
            onChange={(e) => setF({ ...f, status: e.target.value })}
          >
            {['ACTIVE', 'INACTIVE'].map((s) => (
              <option key={s} value={s}>
                {t(`arw.item.${s}` as DictionaryKey)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="dd-checkbox">
          <input
            type="checkbox"
            checked={f.sample}
            onChange={(e) => setF({ ...f, sample: e.target.checked })}
          />
          <span>{t('arw.sampleFlag')}</span>
        </label>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
