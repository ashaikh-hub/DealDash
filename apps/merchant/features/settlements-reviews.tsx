'use client';

import { useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth, useResource } from '@dealdash/app-shell';
import { createTranslator, dictionaries, formatAmount, formatDate, formatDateTime, type DictionaryKey } from '@dealdash/localization';
import { REPORT_REASONS } from '@dealdash/types';
import { Alert, Button, Card, EmptyState, Field, KeyValue, LoadingState, Select, StatusChip, Textarea, type StatusTone } from '@dealdash/ui';
import { useOrgId } from './deal-utils';

/**
 * Stage 8 merchant views: settlement statements (what DealDash owes the business for each period, holds and payouts) and the
 * reviews customers wrote about the business, which the business can report but never edit or remove.
 */
const k = (p: string, v: string) => `${p}.${v}` as DictionaryKey;
const has = (key: string): key is DictionaryKey => key in dictionaries.en;
const TONE: Record<string, StatusTone> = { PENDING: 'neutral', ELIGIBLE: 'info', HELD: 'warning', DISPUTE_HOLD: 'warning', PARTIALLY_PAID: 'info', COMPLETED: 'success', FAILED: 'danger', REVERSED: 'danger', PUBLISHED: 'success', REPORTED: 'warning', HIDDEN: 'neutral' };

interface Statement {
  id: string;
  reference: string;
  currency: string;
  status: string;
  periodFrom: string;
  periodTo: string;
  grossMinor: number;
  feesMinor: number;
  taxMinor: number;
  adjustmentsMinor: number;
  carriedForwardMinor: number;
  payableMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  settlementDate: string | null;
  holdReason: string | null;
  payouts: Array<{ id: string; status: string; amountMinor: number; externalRef: string | null; createdAt: string }>;
}

/** Settlement statements, shown under the voucher payable on the Finance page. */
export function MerchantSettlements() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const orgId = useOrgId();
  const res = useResource<Statement[]>(orgId ? `/v1/merchants/${orgId}/settlements` : null);
  const [open, setOpen] = useState<string | null>(null);
  const code = (p: string, v: string) => (has(`${p}.${v}`) ? t(k(p, v)) : v);
  const money = (minor: number, cur: string) => <span className="dd-ltr">{formatAmount(locale, minor, cur)}</span>;
  return (
    <section className="dd-stack" style={{ gap: 12 }} data-testid="merchant-settlements">
      <h2 className="dd-title">{t('s8.mset.title')}</h2>
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('s8.mset.intro')}
      </p>
      {res.loading && !res.data ? (
        <LoadingState label={t('state.loading')} />
      ) : res.errors.length ? (
        <Alert tone="danger">{errorMessage(locale, res.errors)}</Alert>
      ) : !res.data?.length ? (
        <EmptyState title={t('s8.mset.empty')} />
      ) : (
        <div className="dd-stack" style={{ gap: 10 }}>
          {res.data.map((s) => (
            <Card flat key={s.id}>
              <div className="dd-stack" style={{ gap: 6 }} data-testid={`mset-${s.reference}`}>
                <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <strong>
                    {formatDate(locale, s.periodFrom)} – {formatDate(locale, s.periodTo)}
                  </strong>
                  <StatusChip tone={TONE[s.status] ?? 'neutral'}>{code('s8.setStatus', s.status)}</StatusChip>
                </div>
                <div className="dd-caption">
                  <span className="dd-ltr">{s.reference}</span> · {t('s8.set.payable')}: {money(s.payableMinor, s.currency)} · {t('s8.set.paid')}: {money(s.paidMinor, s.currency)}
                </div>
                {s.status === 'HELD' || s.status === 'DISPUTE_HOLD' ? (
                  <Alert tone="warning">
                    {t('s8.mset.held')} {s.holdReason}
                  </Alert>
                ) : null}
                <div>
                  <Button size="sm" variant="outline" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    {open === s.id ? t('s8.hide') : t('s8.view')}
                  </Button>
                </div>
                {open === s.id ? (
                  <div className="dd-stack" style={{ gap: 6 }}>
                    <KeyValue
                      items={[
                        { label: t('s8.set.gross'), value: money(s.grossMinor, s.currency) },
                        { label: t('s8.set.fees'), value: money(-s.feesMinor, s.currency) },
                        { label: t('s8.set.tax'), value: money(s.taxMinor, s.currency) },
                        { label: t('s8.set.adjustments'), value: money(s.adjustmentsMinor, s.currency) },
                        { label: t('s8.set.carried'), value: money(s.carriedForwardMinor, s.currency) },
                        { label: t('s8.set.payable'), value: money(s.payableMinor, s.currency) },
                        { label: t('s8.set.outstanding'), value: money(s.outstandingMinor, s.currency) },
                      ]}
                    />
                    {s.payouts.map((p) => (
                      <div key={p.id} className="dd-caption">
                        {formatDateTime(locale, p.createdAt)} · {code('s8.payout', p.status)} · {money(p.amountMinor, s.currency)}
                      </div>
                    ))}
                    <p className="dd-caption">{t('s8.set.taxNote')}</p>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

interface ReviewList {
  summary: { count: number; verified: number; average: number | null };
  items: Array<{ id: string; rating: number; text: string; verified: boolean; author: string | null; createdAt: string; status: string; reportCount: number }>;
}

/** Merchant -> Reviews: what customers said; the business may report a review to DealDash moderation with a reason. */
export function MerchantReviewsPage() {
  return (
    <RequirePermission any={['merchant.insights.read']}>
      <Reviews />
    </RequirePermission>
  );
}

function Reviews() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const res = useResource<ReviewList>(orgId ? `/v1/merchants/${orgId}/reviews` : null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState<string>('FALSE_INFORMATION');
  const [note, setNote] = useState('');
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const code = (p: string, v: string) => (has(`${p}.${v}`) ? t(k(p, v)) : v);
  const report = async (id: string) => {
    const r = await call('POST', `/v1/merchants/${orgId}/reviews/${id}/report`, { body: { reason, note: note.trim() || null }, idempotent: true });
    setBanner(r.ok ? { tone: 'success', text: t('s8.rev.reported') } : { tone: 'danger', text: errorMessage(locale, r.errors) });
    if (r.ok) {
      setReporting(null);
      setNote('');
      await res.reload();
    }
  };
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="merchant-reviews">
      <div>
        <h1 className="dd-title-xl">{t('s8.mrev.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('s8.mrev.intro')}
        </p>
      </div>
      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}
      {res.loading && !res.data ? (
        <LoadingState label={t('state.loading')} />
      ) : res.errors.length ? (
        <Alert tone="danger">{errorMessage(locale, res.errors)}</Alert>
      ) : !res.data?.items.length ? (
        <EmptyState title={t('s8.rev.empty')} />
      ) : (
        <>
          <div className="dd-caption" data-testid="mrev-summary">
            {t('s8.rev.summary', { count: res.data.summary.count, verified: res.data.summary.verified, average: res.data.summary.average ?? '-' })}
          </div>
          {res.data.items.map((r) => (
            <Card flat key={r.id}>
              <div className="dd-stack" style={{ gap: 4 }} data-testid="mrev-item">
                <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span>
                    <span aria-label={t('s8.rev.rating')}>{'★'.repeat(r.rating)}</span> {r.author ?? ''}{' '}
                    {r.verified ? <StatusChip tone="success">{t('s8.rev.verified')}</StatusChip> : null}
                  </span>
                  <StatusChip tone={TONE[r.status] ?? 'neutral'}>{code('s8.revStatus', r.status)}</StatusChip>
                </div>
                <div>{r.text}</div>
                <div className="dd-caption">{formatDateTime(locale, r.createdAt)}</div>
                {reporting === r.id ? (
                  <div className="dd-stack" style={{ gap: 6 }}>
                    <Field label={t('s8.rev.reportReason')} htmlFor="mrev-reason">
                      <Select id="mrev-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                        {REPORT_REASONS.map((x) => (
                          <option key={x} value={x}>
                            {code('s8.report', x)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t('s8.rev.reportNote')} htmlFor="mrev-note">
                      <Textarea id="mrev-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                    <div className="dd-row">
                      <Button size="sm" onClick={() => void report(r.id)} data-testid="mrev-report-send">
                        {t('s8.rev.send')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setReporting(null)}>
                        {t('s8.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : r.status === 'PUBLISHED' || r.status === 'REPORTED' ? (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => setReporting(r.id)} data-testid="mrev-report">
                      {t('s8.rev.report')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
          <p className="dd-caption">{t('s8.mrev.note')}</p>
        </>
      )}
    </div>
  );
}
