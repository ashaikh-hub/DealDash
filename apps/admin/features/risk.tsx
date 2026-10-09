'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  formatNumber,
  withLocale,
  type DictionaryKey,
} from '@dealdash/localization';
import { RISK_DECISIONS, RISK_FLAG_STATUSES, RISK_REVIEW_OUTCOMES } from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  Select,
  StatusChip,
  Textarea,
  type StatusTone,
} from '@dealdash/ui';
import type { RiskFlagDetail, RiskFlagRow } from '@dealdash/validation';

const DECISION_TONE: Record<string, StatusTone> = {
  ALLOW: 'success',
  HOLD: 'warning',
  FLAG: 'warning',
  BLOCK: 'danger',
};

export function AdminRiskPage() {
  return (
    <RequirePermission any={['admin.risk.manage']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [rows, setRows] = useState<RiskFlagRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [status, setStatus] = useState('OPEN');
  const [decision, setDecision] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const key = JSON.stringify({
    status: status || undefined,
    decision: decision || undefined,
    limit: 25,
  });

  const load = useCallback(async () => {
    setState('loading');
    const r = await call<RiskFlagRow[]>('GET', '/v1/admin/risk/flags', { query: JSON.parse(key) });
    if (r.ok) {
      setRows(r.data ?? []);
      setNext(r.nextCursor);
      setState('ready');
    } else setState('error');
  }, [call, key]);
  useEffect(() => {
    void load();
  }, [load]);

  const more = async () => {
    if (!next) return;
    const r = await call<RiskFlagRow[]>('GET', '/v1/admin/risk/flags', {
      query: { ...JSON.parse(key), cursor: next },
    });
    if (r.ok) {
      setRows((cur) => [...cur, ...(r.data ?? [])]);
      setNext(r.nextCursor);
    }
  };

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-risk">
      <div>
        <h1 className="dd-title-xl">{t('rsk.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('rsk.sub')}
        </p>
      </div>
      <Alert tone="info">{t('rsk.note')}</Alert>
      <div className="dd-inline-fields">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('mdeal.col.status')}
          style={{ maxInlineSize: 200 }}
        >
          <option value="">{t('mdeal.hub.allStatuses')}</option>
          {RISK_FLAG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`rsk.status.${s}` as DictionaryKey)}
            </option>
          ))}
        </Select>
        <Select
          value={decision}
          onChange={(e) => setDecision(e.target.value)}
          aria-label={t('rsk.col.decision')}
          style={{ maxInlineSize: 200 }}
        >
          <option value="">{t('rsk.allDecisions')}</option>
          {RISK_DECISIONS.map((s) => (
            <option key={s} value={s}>
              {t(`rsk.decision.${s}` as DictionaryKey)}
            </option>
          ))}
        </Select>
      </div>
      <div className="dd-review">
        <div className="dd-stack">
          {state === 'loading' ? (
            <LoadingState label={t('state.loading')} />
          ) : state === 'error' ? (
            <Alert tone="danger">{t('error.generic')}</Alert>
          ) : rows.length === 0 ? (
            <EmptyState title={t('rsk.empty')} />
          ) : (
            <Card className="dd-card--flat" style={{ padding: 0 }}>
              <div className="dd-table-wrap" style={{ border: 0 }}>
                <table className="dd-table" data-testid="risk-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('fin.col.when')}</th>
                      <th scope="col">{t('rsk.col.subject')}</th>
                      <th scope="col">{t('aw.col.campaign')}</th>
                      <th scope="col">{t('rsk.col.decision')}</th>
                      <th scope="col">{t('rsk.col.severity')}</th>
                      <th scope="col">{t('mdeal.col.status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} data-testid="risk-row" aria-selected={sel === r.id}>
                        <td className="dd-caption">
                          <button
                            type="button"
                            className="dd-rowlink"
                            onClick={() => setSel(r.id)}
                            data-testid="risk-open"
                          >
                            {formatDateTime(locale, r.createdAt)}
                          </button>
                        </td>
                        <td>
                          {t(`rsk.kind.${r.subject.kind}` as DictionaryKey)}:{' '}
                          <span className="dd-ltr">{r.subject.label}</span>
                        </td>
                        <td>
                          {r.campaign ? r.campaign.title[locale] || r.campaign.title.en : '–'}
                        </td>
                        <td>
                          <StatusChip tone={DECISION_TONE[r.decision] ?? 'neutral'}>
                            {t(`rsk.decision.${r.decision}` as DictionaryKey)}
                          </StatusChip>
                        </td>
                        <td className="dd-ltr">{formatNumber(locale, r.severity)}</td>
                        <td>{t(`rsk.status.${r.status}` as DictionaryKey)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
          {next ? (
            <div>
              <Button variant="outline" onClick={() => void more()}>
                {t('mdeal.loadMore')}
              </Button>
            </div>
          ) : null}
        </div>
        <aside>
          {sel ? (
            <CaseDetail id={sel} onChanged={() => void load()} />
          ) : (
            <Card>
              <p className="dd-muted">{t('rsk.pick')}</p>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

function CaseDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [d, setD] = useState<RiskFlagDetail | null>(null);
  const [outcome, setOutcome] = useState<string>('CLEAR');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    const r = await call<RiskFlagDetail>('GET', `/v1/admin/risk/flags/${id}`);
    if (r.ok) setD(r.data);
  }, [call, id]);
  useEffect(() => {
    setD(null);
    setDone(false);
    setError('');
    void load();
  }, [load]);

  if (!d) return <LoadingState label={t('state.loading')} />;
  const decide = async () => {
    if (reason.trim().length < 3) return setError(t('modal.reasonRequired'));
    setBusy(true);
    const r = await call<RiskFlagDetail>('POST', `/v1/admin/risk/flags/${id}/decide`, {
      body: { outcome, reason: reason.trim() },
    });
    setBusy(false);
    if (!r.ok || !r.data) return setError(errorMessage(locale, r.errors));
    setD(r.data);
    setDone(true);
    setError('');
    onChanged();
  };
  return (
    <Card data-testid="risk-detail">
      <div className="dd-stack">
        <div className="dd-row" style={{ justifyContent: 'space-between' }}>
          <h2 className="dd-title">{t('rsk.case')}</h2>
          <StatusChip tone={DECISION_TONE[d.decision] ?? 'neutral'}>
            {t(`rsk.decision.${d.decision}` as DictionaryKey)}
          </StatusChip>
        </div>
        <dl className="dd-kv">
          <div className="dd-kv__row">
            <dt>{t('rsk.col.subject')}</dt>
            <dd className="dd-ltr">{d.subject.label}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('rsk.col.severity')}</dt>
            <dd className="dd-ltr">{formatNumber(locale, d.severity)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('rsk.linked.accounts')}</dt>
            <dd className="dd-ltr">{d.linked.accountsOnDevice}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('rsk.linked.devices')}</dt>
            <dd className="dd-ltr">{d.linked.devicesOnAccount}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('rsk.linked.recent')}</dt>
            <dd className="dd-ltr">{d.linked.recentViews}</dd>
          </div>
          {d.campaign ? (
            <div className="dd-kv__row">
              <dt>{t('aw.col.campaign')}</dt>
              <dd>
                <Link className="dd-link" href={withLocale(`/watch/${d.campaign.id}`, locale)}>
                  {d.campaign.title[locale] || d.campaign.title.en}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
        <h3 className="dd-caption">{t('rsk.signals')}</h3>
        <ul style={{ margin: 0, paddingInlineStart: 18 }} data-testid="risk-signals">
          {d.signalDetails.map((s) => (
            <li key={s.code}>
              <strong>{t(`rsk.signal.${s.code}` as DictionaryKey)}</strong>{' '}
              <span className="dd-ltr">(+{s.weight})</span>
              <div className="dd-caption">{s.detail}</div>
            </li>
          ))}
        </ul>
        {d.timeline.length ? (
          <>
            <h3 className="dd-caption">{t('rsk.timeline')}</h3>
            <div
              className="dd-pre dd-ltr"
              style={{ maxBlockSize: 140, overflow: 'auto', fontSize: 12 }}
            >
              {d.timeline
                .map(
                  (e) =>
                    `${new Date(e.at).toISOString().slice(11, 23)}  ${e.type}  ${e.positionSec.toFixed(1)}s`,
                )
                .join('\n')}
            </div>
          </>
        ) : null}
        {d.status === 'DECIDED' ? (
          <Alert tone="success">
            <span data-testid="risk-decided">
              {t(`rsk.outcome.${d.outcome ?? 'CLEAR'}` as DictionaryKey)}
              {d.reviewReason ? ` — ${d.reviewReason}` : ''}
            </span>
          </Alert>
        ) : (
          <div className="dd-stack">
            <Field label={t('rsk.outcome')} htmlFor="risk-outcome">
              <Select
                id="risk-outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                {RISK_REVIEW_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {t(`rsk.outcome.${o}` as DictionaryKey)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`${t('modal.reason')} *`} htmlFor="risk-reason">
              <Textarea
                id="risk-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {done ? <Alert tone="success">{t('ah.done')}</Alert> : null}
            <Button onClick={() => void decide()} loading={busy} data-testid="risk-decide">
              {t('rsk.decide')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
