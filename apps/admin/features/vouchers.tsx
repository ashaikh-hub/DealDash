'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  RequirePermission,
  VoucherCardView,
  VoucherDetailView,
  errorMessage,
  historyReason,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  withLocale,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import { VOUCHER_STATUSES, type VoucherStatus } from '@dealdash/types';
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
  Timeline,
  type StatusTone,
  type TimelineItem,
} from '@dealdash/ui';
import type { AdminVoucherDetail, AdminVoucherRow } from '@dealdash/validation';

export const VOUCHER_TONE: Record<VoucherStatus, StatusTone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  NEEDS_CHANGES: 'warning',
  REJECTED: 'danger',
  SCHEDULED: 'info',
  ON_SALE: 'success',
  PAUSED: 'neutral',
  SOLD_OUT: 'warning',
  ENDED: 'neutral',
  SUSPENDED: 'danger',
};

// ================================================================ list (queue + all)
export function AdminVouchersPage() {
  return (
    <RequirePermission any={['admin.campaigns.review']}>
      <ListInner />
    </RequirePermission>
  );
}

function ListInner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [tab, setTab] = useState<'queue' | 'all'>('queue');
  const [rows, setRows] = useState<AdminVoucherRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const key = JSON.stringify({
    queue: tab === 'queue' ? 'true' : undefined,
    q: q.trim() || undefined,
    status: tab === 'all' ? status || undefined : undefined,
    limit: 25,
  });

  const load = useCallback(async () => {
    setState('loading');
    const r = await call<AdminVoucherRow[]>('GET', '/v1/admin/vouchers', {
      query: JSON.parse(key),
    });
    if (r.ok) {
      setRows(r.data ?? []);
      setNext(r.nextCursor);
      setState('ready');
    } else setState('error');
  }, [call, key]);
  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  const more = async () => {
    if (!next) return;
    const r = await call<AdminVoucherRow[]>('GET', '/v1/admin/vouchers', {
      query: { ...JSON.parse(key), cursor: next },
    });
    if (r.ok) {
      setRows((cur) => [...cur, ...(r.data ?? [])]);
      setNext(r.nextCursor);
    }
  };

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-vouchers">
      <div>
        <h1 className="dd-title-xl">{t('av.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('av.sub')}
        </p>
      </div>
      <Tabs
        label={t('av.title')}
        value={tab}
        onChange={(v) => setTab(v as 'queue' | 'all')}
        tabs={[
          { id: 'queue', label: t('av.tabQueue') },
          { id: 'all', label: t('av.tabAll') },
        ]}
      />
      <div className="dd-inline-fields">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('mdeal.hub.search')}
          aria-label={t('mdeal.hub.search')}
          style={{ maxInlineSize: 280 }}
        />
        {tab === 'all' ? (
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label={t('mdeal.col.status')}
            style={{ maxInlineSize: 200 }}
          >
            <option value="">{t('mdeal.hub.allStatuses')}</option>
            {VOUCHER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`vstatus.${s}` as DictionaryKey)}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      {state === 'loading' ? (
        <LoadingState label={t('state.loading')} />
      ) : state === 'error' ? (
        <Alert tone="danger">
          {t('error.generic')}{' '}
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('state.retry')}
          </Button>
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={tab === 'queue' ? t('av.queueEmpty') : t('mdeal.hub.noMatch')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('av.col.voucher')}</th>
                  <th scope="col">{t('av.col.merchant')}</th>
                  <th scope="col">{t('av.col.price')}</th>
                  <th scope="col">{t('av.col.qty')}</th>
                  <th scope="col">{t('av.col.submitted')}</th>
                  <th scope="col">{t('mdeal.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="admin-voucher-row">
                    <td>
                      <Link
                        className="dd-rowlink dd-clamp"
                        href={withLocale(`/vouchers/${r.id}`, locale)}
                      >
                        {r.title[locale] || r.title.en || r.title.ar}
                      </Link>
                    </td>
                    <td>{locale === 'ar' ? r.merchant.nameAr : r.merchant.nameEn}</td>
                    <td className="dd-ltr">
                      {formatMoney(locale, r.faceValueHalalas)} /{' '}
                      {formatMoney(locale, r.sellingPriceHalalas)}
                    </td>
                    <td className="dd-ltr">{r.totalQty}</td>
                    <td className="dd-caption">
                      {r.submittedAt ? formatDateTime(locale, r.submittedAt) : '–'}
                    </td>
                    <td>
                      <StatusChip tone={VOUCHER_TONE[r.status]}>
                        {t(`vstatus.${r.status}` as DictionaryKey)}
                      </StatusChip>
                    </td>
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
  );
}

// ================================================================ review workbench
type Action =
  'approve' | 'request-changes' | 'reject' | 'pause' | 'resume' | 'suspend' | 'reinstate';
const LABEL: Record<Action, DictionaryKey> = {
  approve: 'ah.approve',
  'request-changes': 'ah.requestChanges',
  reject: 'ah.reject',
  pause: 'ah.pause',
  resume: 'ah.resume',
  suspend: 'ah.suspend',
  reinstate: 'ah.reinstate',
};

export function AdminVoucherReviewPage({ id }: { id: string }) {
  return (
    <RequirePermission any={['admin.campaigns.review']}>
      <ReviewInner id={id} />
    </RequirePermission>
  );
}

function ReviewInner({ id }: { id: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [d, setD] = useState<AdminVoucherDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [reasonAr, setReasonAr] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [done, setDone] = useState(false);
  const [previewLang, setPreviewLang] = useState<Locale>(locale);
  const [previewKind, setPreviewKind] = useState<'card' | 'detail'>('card');

  const load = useCallback(async () => {
    const r = await call<AdminVoucherDetail>('GET', `/v1/admin/vouchers/${id}`);
    if (r.ok && r.data) {
      setD(r.data);
      setState('ready');
    } else if (r.status === 404) setState('missing');
    else {
      setError(errorMessage(locale, r.errors));
      setState('error');
    }
  }, [call, id, locale]);
  useEffect(() => {
    void load();
  }, [load]);

  const open = (a: Action) => {
    setAction(a);
    setReason(a === 'approve' ? 'Voucher is clear and the commercial rules are reasonable.' : '');
    setReasonAr(a === 'approve' ? 'القسيمة واضحة والشروط التجارية معقولة.' : '');
    setFormError('');
  };
  const submit = async () => {
    if (!action) return;
    if (reason.trim().length < 3) return setFormError(t('modal.reasonRequired'));
    setBusy(true);
    const r = await call<AdminVoucherDetail>('POST', `/v1/admin/vouchers/${id}/${action}`, {
      body: { reason: reason.trim(), reasonAr: reasonAr.trim() || undefined },
    });
    setBusy(false);
    if (!r.ok || !r.data) return setFormError(errorMessage(locale, r.errors));
    setD(r.data);
    setAction(null);
    setDone(true);
    void load();
  };

  if (state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'missing')
    return (
      <EmptyState
        title={t('adeal.notFound')}
        action={
          <Link className="dd-btn dd-btn--secondary" href={withLocale('/vouchers', locale)}>
            {t('av.back')}
          </Link>
        }
      />
    );
  if (state === 'error' || !d)
    return (
      <Alert tone="danger">
        {error}{' '}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t('state.retry')}
        </Button>
      </Alert>
    );

  const c = d.content;
  const k = d.commercial;
  const canAct = (a: string) =>
    d.adminActions.includes(a.replace('-', '_')) || d.adminActions.includes(a);
  const items: TimelineItem[] = d.history.map((h) => ({
    id: h.id,
    title: t(`vaction.${h.action}` as DictionaryKey),
    meta: `${formatDateTime(locale, h.createdAt)} · ${h.actorName ?? h.actorRole ?? t('adeal.actorSystem')}${h.actorRole && h.actorName ? ` (${h.actorRole})` : ''}`,
    body: [historyReason(locale, h.reason), h.reasonAr].filter(Boolean).join('\n') || undefined,
    tone: /REJECT|SUSPEND/.test(h.action)
      ? 'danger'
      : /REQUEST_CHANGES|SOLD_OUT/.test(h.action)
        ? 'warning'
        : /APPROVE|ACTIVATE|REOPEN|REINSTATE/.test(h.action)
          ? 'success'
          : 'info',
  }));
  const columns = (['en', 'ar'] as const).map((lang) => (
    <Card key={lang} flat>
      <div
        className="dd-stack"
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        lang={lang}
        data-testid={`content-${lang}`}
      >
        <span className="dd-bi__lang">
          {lang === 'en' ? t('adeal.english') : t('adeal.arabic')}
        </span>
        <div className="dd-kpi__l">{t('mv.title2')}</div>
        <strong>{c.title[lang]}</strong>
        <div className="dd-kpi__l">{t('mv.short')}</div>
        <div>{c.shortDescription[lang]}</div>
        <div className="dd-kpi__l">{t('mv.long')}</div>
        <div className="dd-pre">{c.description[lang]}</div>
        <div className="dd-kpi__l">{t('mv.rules')}</div>
        <div className="dd-pre">{c.redemptionRules[lang]}</div>
        <div className="dd-kpi__l">{t('adeal.terms')}</div>
        <div className="dd-pre">{lang === 'en' ? c.terms.textEn : c.terms.textAr}</div>
      </div>
    </Card>
  ));
  const policy = k.expiredValuePolicy;

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="voucher-review">
      <Link className="dd-link" href={withLocale('/vouchers', locale)}>
        ← {t('av.back')}
      </Link>
      <div className="dd-topbar">
        <div className="dd-row">
          <h1 className="dd-title-xl dd-clamp">{d.preview.title[locale] || d.preview.title.en}</h1>
          <StatusChip tone={VOUCHER_TONE[d.status]}>
            {t(`vstatus.${d.status}` as DictionaryKey)}
          </StatusChip>
        </div>
      </div>
      {done ? <Alert tone="success">{t('ah.done')}</Alert> : null}

      <div className="dd-review">
        <div className="dd-stack" style={{ gap: 16 }}>
          <Card>
            <h2 className="dd-title">{t('adeal.merchant')}</h2>
            <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
              <div className="dd-kv__row">
                <dt>{t('adeal.merchant')}</dt>
                <dd>{locale === 'ar' ? d.merchant.nameAr : d.merchant.nameEn}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('av.legalEntity')}</dt>
                <dd>{d.merchant.legalName ?? '–'}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('av.registration')}</dt>
                <dd className="dd-ltr">{d.merchant.commercialRegistration ?? '–'}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.merchantStatus')}</dt>
                <dd>{d.merchant.status}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.col.merchant')}</dt>
                <dd>{t(`adeal.trust.${d.merchant.trustLevel}` as DictionaryKey)}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('adeal.risk')}</dt>
                <dd>{d.merchant.riskTier}</dd>
              </div>
            </dl>
          </Card>

          <Card data-testid="voucher-commercial">
            <h2 className="dd-title">{t('av.commercial')}</h2>
            <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
              <div className="dd-kv__row">
                <dt>{t('mv.face')}</dt>
                <dd className="dd-ltr">{formatMoney(locale, c.faceValueHalalas)}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('mv.price')}</dt>
                <dd className="dd-ltr">{formatMoney(locale, c.sellingPriceHalalas)}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('av.savingsClaim')}</dt>
                <dd className="dd-ltr">
                  {formatMoney(locale, k.savings.savingsHalalas)} ({k.savings.savingsPercent}%)
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('av.stock')}</dt>
                <dd className="dd-ltr">
                  {d.stock.sold} / {d.stock.total} ({t('mv.kpi.held')}: {d.stock.held})
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('mv.summary.validity')}</dt>
                <dd>
                  {c.validity.type === 'DAYS_FROM_PURCHASE'
                    ? t('vch.validDays', { n: c.validity.days ?? 0 })
                    : t('vch.validUntil', { date: c.validity.validUntil?.slice(0, 10) ?? '–' })}
                </dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('mv.eligibility')}</dt>
                <dd>{t(`elig.${c.eligibility.kind}` as DictionaryKey)}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('mv.perCustomer')}</dt>
                <dd className="dd-ltr">{c.perCustomerLimit}</dd>
              </div>
              <div className="dd-kv__row">
                <dt>{t('mv.summary.branches')}</dt>
                <dd>{d.branches.map((b) => b.name[locale] || b.name.en).join(', ') || '–'}</dd>
              </div>
            </dl>
            <div style={{ marginBlockStart: 10 }}>
              {k.discountFlag ? (
                <div data-testid="discount-flag">
                  <Alert tone="warning">
                    {t('av.discountFlag', { pct: k.reviewAboveDiscountPercent })}
                  </Alert>
                </div>
              ) : (
                <Alert tone="success">{t('av.discountOk')}</Alert>
              )}
            </div>
          </Card>

          <Card data-testid="voucher-rules">
            <h2 className="dd-title">{t('av.refundPolicyTitle')}</h2>
            <p className="dd-muted">
              {t('av.refundPolicy', {
                hours: k.refundPolicy.windowHours,
                after: t(`av.refundAfter.${k.refundPolicy.outsideWindow}` as DictionaryKey),
              })}
            </p>
            <h2 className="dd-title">{t('av.payableRuleTitle')}</h2>
            <p className="dd-muted">
              {t('av.payableRule', {
                point: t(`mf.accrual.${k.payableRule.accrualPoint}` as DictionaryKey),
                pct: k.payableRule.feePercentBps / 100,
                fixed: formatMoney(locale, k.payableRule.feeFixedHalalas),
              })}
            </p>
            <p className="dd-caption">
              {t('av.expiredPolicy', {
                policy: t(`av.expiredPolicy.${policy}` as DictionaryKey),
              })}
            </p>
          </Card>

          <div className="dd-grid dd-grid--2">{columns}</div>

          {d.guardrail.reasons.length ? (
            <Alert tone="warning" title={t('mv.guardrail.manual')}>
              <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                {d.guardrail.reasons.map((r) => (
                  <li key={r}>{t(`guardrail.reason.${r}` as DictionaryKey)}</li>
                ))}
              </ul>
            </Alert>
          ) : null}

          <Card>
            <h2 className="dd-title">{t('av.history')}</h2>
            <Timeline items={items} label={t('av.history')} />
          </Card>
        </div>

        <aside className="dd-stack" style={{ gap: 16 }}>
          <Card data-testid="voucher-decision">
            <h2 className="dd-title">{t('av.decision')}</h2>
            <div className="dd-stack" style={{ marginBlockStart: 8 }}>
              {(
                [
                  'approve',
                  'request-changes',
                  'reject',
                  'pause',
                  'resume',
                  'suspend',
                  'reinstate',
                ] as Action[]
              )
                .filter((a) => canAct(a))
                .map((a) => (
                  <Button
                    key={a}
                    variant={
                      a === 'approve'
                        ? 'primary'
                        : a === 'reject' || a === 'suspend'
                          ? 'danger'
                          : 'outline'
                    }
                    onClick={() => open(a)}
                    data-testid={`act-${a}`}
                  >
                    {t(LABEL[a])}
                  </Button>
                ))}
              {d.adminActions.length === 0 ? (
                <p className="dd-muted">{t('ah.noPermission')}</p>
              ) : null}
            </div>
          </Card>
          <Card>
            <div className="dd-row" style={{ justifyContent: 'space-between' }}>
              <h2 className="dd-title">{t('av.preview')}</h2>
              <div className="dd-lang" role="group" aria-label={t('av.preview')}>
                {(['en', 'ar'] as const).map((l) => (
                  <a
                    key={l}
                    href="#preview"
                    aria-current={previewLang === l ? 'true' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      setPreviewLang(l);
                    }}
                  >
                    {l === 'en' ? 'EN' : 'عربي'}
                  </a>
                ))}
              </div>
            </div>
            <div className="dd-tabs" role="tablist">
              {(['card', 'detail'] as const).map((kind) => (
                <button
                  key={kind}
                  role="tab"
                  type="button"
                  className="dd-tab"
                  aria-selected={previewKind === kind}
                  onClick={() => setPreviewKind(kind)}
                >
                  {kind === 'card' ? t('review.previewCard') : t('review.previewDetail')}
                </button>
              ))}
            </div>
            <div
              dir={previewLang === 'ar' ? 'rtl' : 'ltr'}
              lang={previewLang}
              className="dd-previewframe"
            >
              {previewKind === 'card' ? (
                <VoucherCardView voucher={d.preview} locale={previewLang} variant="list" />
              ) : (
                <VoucherDetailView detail={d.preview} locale={previewLang} embedded />
              )}
            </div>
          </Card>
        </aside>
      </div>

      <Modal
        open={!!action}
        onClose={() => !busy && setAction(null)}
        title={action ? t(LABEL[action]) : ''}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="outline" onClick={() => setAction(null)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={action === 'reject' || action === 'suspend' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() => void submit()}
              data-testid="decision-confirm"
            >
              {action ? t(LABEL[action]) : ''}
            </Button>
          </>
        }
      >
        <div className="dd-stack">
          <Field label={`${t('modal.reason')} *`} htmlFor="decision-reason">
            <Textarea
              id="decision-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Field label={t('ah.reasonAr')} htmlFor="decision-reason-ar">
            <Textarea
              id="decision-reason-ar"
              rows={3}
              dir="rtl"
              lang="ar"
              value={reasonAr}
              onChange={(e) => setReasonAr(e.target.value)}
            />
          </Field>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
        </div>
      </Modal>
    </div>
  );
}
