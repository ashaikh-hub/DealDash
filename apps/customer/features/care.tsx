'use client';

import { useState } from 'react';
import { LoginPanel, errorMessage, useApi, useAuth, useResource } from '@dealdash/app-shell';
import { dictionaries, formatDateTime, type DictionaryKey } from '@dealdash/localization';
import { REPORT_REASONS } from '@dealdash/types';
import { Alert, Button, Card, EmptyState, Field, LoadingState, Select, StatusChip, Textarea } from '@dealdash/ui';
import { useT } from './parts';

/**
 * Stage 8 customer care: reviews on a merchant page (Verified only with a tracked merchant interaction; Watch & Earn never counts),
 * the customer's own cases (status, resolution and what DealDash shared) and their privacy data requests.
 */
const k = (p: string, v: string) => `${p}.${v}` as DictionaryKey;
const has = (key: string): key is DictionaryKey => key in dictionaries.en;

interface PublicReview {
  id: string;
  rating: number;
  text: string;
  verified: boolean;
  author: string | null;
  createdAt: string;
}

export function MerchantReviews({ merchantId }: { merchantId: string }) {
  const { t, locale } = useT();
  const { status } = useAuth();
  const { call } = useApi();
  const res = useResource<{ summary: { count: number; verified: number; average: number | null }; items: PublicReview[] }>(`/v1/app/merchants/${merchantId}/reviews`);
  const [writing, setWriting] = useState(false);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [reason, setReason] = useState<string>('SPAM');
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const code = (p: string, v: string) => (has(`${p}.${v}`) ? t(k(p, v)) : v);
  const submit = async () => {
    const r = await call<{ verified: boolean; status: string }>('POST', `/v1/app/merchants/${merchantId}/reviews`, { body: { rating, text: text.trim(), locale }, idempotent: true });
    if (!r.ok) return setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
    setBanner({ tone: 'success', text: r.data?.status === 'PENDING_REVIEW' ? t('s8.rev.pending') : t('s8.rev.thanks') });
    setWriting(false);
    setText('');
    await res.reload();
  };
  const report = async (id: string) => {
    const r = await call('POST', `/v1/app/reviews/${id}/report`, { body: { reason }, idempotent: true });
    setBanner(r.ok ? { tone: 'success', text: t('s8.rev.reported') } : { tone: 'danger', text: errorMessage(locale, r.errors) });
    setReportFor(null);
  };
  return (
    <section className="dd-stack" style={{ gap: 10 }} data-testid="merchant-reviews-public">
      <h2 className="dd-title">{t('s8.rev.title')}</h2>
      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}
      {res.loading && !res.data ? (
        <LoadingState label={t('state.loading')} />
      ) : res.errors.length ? (
        <Alert tone="danger">{errorMessage(locale, res.errors)}</Alert>
      ) : (
        <>
          {res.data && res.data.summary.count ? (
            <p className="dd-caption" style={{ margin: 0 }} data-testid="rev-summary">
              {t('s8.rev.summary', { count: res.data.summary.count, verified: res.data.summary.verified, average: res.data.summary.average ?? '-' })}
            </p>
          ) : null}
          {status === 'authenticated' ? (
            writing ? (
              <Card flat>
                <div className="dd-stack" style={{ gap: 8 }} data-testid="rev-form">
                  <Field label={t('s8.rev.rating')} htmlFor="rev-rating">
                    <Select id="rev-rating" value={String(rating)} onChange={(e) => setRating(Number(e.target.value))}>
                      {[5, 4, 3, 2, 1].map((n) => (
                        <option key={n} value={n}>
                          {'★'.repeat(n)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('s8.rev.text')} htmlFor="rev-text" help={t('s8.rev.textHelp')}>
                    <Textarea id="rev-text" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
                  </Field>
                  <p className="dd-caption" style={{ margin: 0 }}>
                    {t('s8.rev.verifiedNote')}
                  </p>
                  <div className="dd-row">
                    <Button disabled={text.trim().length < 10} onClick={() => void submit()} data-testid="rev-submit">
                      {t('s8.rev.post')}
                    </Button>
                    <Button variant="ghost" onClick={() => setWriting(false)}>
                      {t('s8.cancel')}
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <div>
                <Button variant="outline" onClick={() => setWriting(true)} data-testid="rev-write">
                  {t('s8.rev.write')}
                </Button>
              </div>
            )
          ) : (
            <p className="dd-caption">{t('s8.rev.signIn')}</p>
          )}
          {!res.data?.items.length ? (
            <EmptyState title={t('s8.rev.empty')} />
          ) : (
            res.data.items.map((r) => (
              <Card flat key={r.id}>
                <div className="dd-stack" style={{ gap: 4 }} data-testid="rev-item">
                  <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <span>
                      <span aria-label={t('s8.rev.rating')}>{'★'.repeat(r.rating)}</span> {r.author ?? ''}
                    </span>
                    {r.verified ? <StatusChip tone="success">{t('s8.rev.verified')}</StatusChip> : null}
                  </div>
                  <div>{r.text}</div>
                  <div className="dd-row" style={{ justifyContent: 'space-between' }}>
                    <span className="dd-caption">{formatDateTime(locale, r.createdAt)}</span>
                    {status === 'authenticated' ? (
                      reportFor === r.id ? (
                        <span className="dd-row" style={{ gap: 6 }}>
                          <Select aria-label={t('s8.rev.reportReason')} value={reason} onChange={(e) => setReason(e.target.value)}>
                            {REPORT_REASONS.map((x) => (
                              <option key={x} value={x}>
                                {code('s8.report', x)}
                              </option>
                            ))}
                          </Select>
                          <Button size="sm" onClick={() => void report(r.id)}>
                            {t('s8.rev.send')}
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setReportFor(r.id)}>
                          {t('s8.rev.report')}
                        </Button>
                      )
                    ) : null}
                  </div>
                </div>
              </Card>
            ))
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- my cases
interface MyCase {
  id: string;
  reference: string;
  title: string;
  status: string;
  open: boolean;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  notes: Array<{ body: string; createdAt: string }>;
}

export function MyCasesPage() {
  const { t, locale } = useT();
  const { status } = useAuth();
  const res = useResource<MyCase[]>(status === 'authenticated' ? '/v1/app/me/cases' : null);
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="customer-cases">
      <h1 className="dd-title-xl">{t('s8.cust.cases')}</h1>
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('s8.cust.casesIntro')}
      </p>
      {status !== 'authenticated' ? (
        <LoginPanel />
      ) : res.loading && !res.data ? (
        <LoadingState label={t('state.loading')} />
      ) : res.errors.length ? (
        <Alert tone="danger">{errorMessage(locale, res.errors)}</Alert>
      ) : !res.data?.length ? (
        <EmptyState title={t('s8.cust.noCases')} />
      ) : (
        res.data.map((c) => (
          <Card flat key={c.id}>
            <div className="dd-stack" style={{ gap: 6 }} data-testid={`my-case-${c.reference}`}>
              <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <strong>{c.title}</strong>
                <StatusChip tone={c.open ? (c.status === 'AWAITING_CUSTOMER' ? 'warning' : 'info') : c.status === 'REJECTED' ? 'neutral' : 'success'}>
                  {c.open ? (c.status === 'AWAITING_CUSTOMER' ? t('s8.cust.needsYou') : t('s8.cust.inProgress')) : t('s8.cust.closed')}
                </StatusChip>
              </div>
              <div className="dd-caption">
                <span className="dd-ltr">{c.reference}</span> · {formatDateTime(locale, c.createdAt)}
              </div>
              {c.notes.map((n, i) => (
                <div key={i} className="dd-note">
                  <div className="dd-caption">{formatDateTime(locale, n.createdAt)}</div>
                  <div>{n.body}</div>
                </div>
              ))}
              {c.resolution ? <Alert tone="info">{c.resolution}</Alert> : null}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------- my data (privacy requests)
interface MyDataRequest {
  id: string;
  reference: string;
  type: string;
  status: string;
  decisionReason: string | null;
  completedAt: string | null;
  result: unknown;
  createdAt: string;
}

export function MyDataPage() {
  const { t, locale } = useT();
  const { status } = useAuth();
  const { call } = useApi();
  const res = useResource<MyDataRequest[]>(status === 'authenticated' ? '/v1/app/me/data-requests' : null);
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const code = (p: string, v: string) => (has(`${p}.${v}`) ? t(k(p, v)) : v);
  const ask = async (type: 'EXPORT' | 'DELETION') => {
    const r = await call('POST', '/v1/app/me/data-requests', { body: { type }, idempotent: true });
    setBanner(r.ok ? { tone: 'success', text: t('s8.cust.dataRequested') } : { tone: 'danger', text: errorMessage(locale, r.errors) });
    setConfirmDelete(false);
    if (r.ok) await res.reload();
  };
  const download = (d: MyDataRequest) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(d.result, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `dealdash-my-data-${d.reference}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  return (
    <div className="dd-stack" style={{ gap: 14 }} data-testid="customer-data">
      <h1 className="dd-title-xl">{t('s8.cust.data')}</h1>
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('s8.cust.dataIntro')}
      </p>
      {status !== 'authenticated' ? (
        <LoginPanel />
      ) : (
        <>
          {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}
          <div className="dd-row" style={{ flexWrap: 'wrap' }}>
            <Button variant="outline" onClick={() => void ask('EXPORT')} data-testid="data-export">
              {t('s8.cust.export')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(true)} data-testid="data-delete">
              {t('s8.cust.delete')}
            </Button>
          </div>
          {confirmDelete ? (
            <Alert tone="warning">
              {t('s8.cust.deleteNote')}{' '}
              <Button size="sm" onClick={() => void ask('DELETION')} data-testid="data-delete-confirm">
                {t('s8.cust.deleteConfirm')}
              </Button>
            </Alert>
          ) : null}
          {res.loading && !res.data ? (
            <LoadingState label={t('state.loading')} />
          ) : !res.data?.length ? (
            <EmptyState title={t('s8.cust.noData')} />
          ) : (
            res.data.map((d) => (
              <Card flat key={d.id}>
                <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }} data-testid={`my-dr-${d.reference}`}>
                  <span>
                    {code('s8.drType', d.type)} · <span className="dd-caption">{formatDateTime(locale, d.createdAt)}</span>
                  </span>
                  <span className="dd-row" style={{ gap: 6 }}>
                    <StatusChip tone={d.status === 'COMPLETED' ? 'success' : d.status === 'REJECTED' ? 'neutral' : 'info'}>{code('s8.drStatus', d.status)}</StatusChip>
                    {d.status === 'COMPLETED' && d.type === 'EXPORT' && d.result ? (
                      <Button size="sm" variant="outline" onClick={() => download(d)}>
                        {t('s8.cust.download')}
                      </Button>
                    ) : null}
                  </span>
                </div>
                {d.decisionReason && d.status === 'REJECTED' ? <p className="dd-caption">{d.decisionReason}</p> : null}
              </Card>
            ))
          )}
        </>
      )}
    </div>
  );
}
