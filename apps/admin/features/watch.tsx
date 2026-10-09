'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  BudgetMeter,
  RequirePermission,
  WatchCardView,
  WatchDetailView,
  WatchMonitorView,
  WatchStatusChip,
  errorMessage,
  historyReason,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  formatNumber,
  withLocale,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import { WATCH_STATUSES } from '@dealdash/types';
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
  Tabs,
  Textarea,
  Timeline,
  type TimelineItem,
} from '@dealdash/ui';
import type {
  AdminWatchDetail,
  AdminWatchOverview,
  AdminWatchRow,
  WatchBudgetDetail,
  WatchMonitor,
} from '@dealdash/validation';

// ================================================================ list: overview + review queue + all + live monitor
export function AdminWatchPage() {
  return (
    <RequirePermission any={['admin.watch.read']}>
      <ListInner />
    </RequirePermission>
  );
}

function ListInner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [tab, setTab] = useState<'queue' | 'all' | 'monitor'>('queue');
  const [ov, setOv] = useState<AdminWatchOverview | null>(null);
  const [rows, setRows] = useState<AdminWatchRow[]>([]);
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
    const [r, o] = await Promise.all([
      tab === 'monitor'
        ? Promise.resolve(null)
        : call<AdminWatchRow[]>('GET', '/v1/admin/watch', { query: JSON.parse(key) }),
      call<AdminWatchOverview>('GET', '/v1/admin/watch/overview'),
    ]);
    if (o.ok) setOv(o.data);
    if (r === null) return setState(o.ok ? 'ready' : 'error');
    if (r.ok) {
      setRows(r.data ?? []);
      setNext(r.nextCursor);
      setState('ready');
    } else setState('error');
  }, [call, key, tab]);
  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, q]);
  useEffect(() => {
    if (tab !== 'monitor') return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [tab, load]);

  const more = async () => {
    if (!next) return;
    const r = await call<AdminWatchRow[]>('GET', '/v1/admin/watch', {
      query: { ...JSON.parse(key), cursor: next },
    });
    if (r.ok) {
      setRows((cur) => [...cur, ...(r.data ?? [])]);
      setNext(r.nextCursor);
    }
  };
  const n = (v: number) => formatNumber(locale, v);
  const c = ov?.counts;

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-watch">
      <div>
        <h1 className="dd-title-xl">{t('aw.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('aw.sub')}
        </p>
      </div>
      {c ? (
        <div className="dd-finance-grid" data-testid="watch-counts">
          {(
            [
              ['live', c.live],
              ['pendingReview', c.pendingReview],
              ['paused', c.paused],
              ['exhausted', c.exhausted],
              ['openFlags', c.openFlags],
              ['qualified24h', c.qualified24h],
              ['invalid24h', c.invalid24h],
              ['rewardsIssued24h', c.rewardsIssued24h],
              ['rewardsHeld', c.rewardsHeld],
            ] as const
          ).map(([k, v]) => (
            <Card flat key={k}>
              <div className="dd-caption">{t(`aw.count.${k}` as DictionaryKey)}</div>
              <div
                className="dd-title-xl dd-ltr"
                style={{ fontSize: 24 }}
                data-testid={`count-${k}`}
              >
                {n(v)}
              </div>
            </Card>
          ))}
        </div>
      ) : null}
      <Tabs
        label={t('aw.title')}
        value={tab}
        onChange={(v) => setTab(v as 'queue' | 'all' | 'monitor')}
        tabs={[
          { id: 'queue', label: t('aw.tabQueue') },
          { id: 'all', label: t('aw.tabAll') },
          { id: 'monitor', label: t('aw.tabMonitor') },
        ]}
      />
      {tab !== 'monitor' ? (
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
              {WATCH_STATUSES.filter((s) => s !== 'DRAFT').map((s) => (
                <option key={s} value={s}>
                  {t(`wstatus.${s}` as DictionaryKey)}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      ) : null}

      {state === 'loading' && !ov ? (
        <LoadingState label={t('state.loading')} />
      ) : state === 'error' ? (
        <Alert tone="danger">
          {t('error.generic')}{' '}
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('state.retry')}
          </Button>
        </Alert>
      ) : tab === 'monitor' ? (
        !ov || ov.campaigns.length === 0 ? (
          <EmptyState title={t('aw.monitorEmpty')} />
        ) : (
          <Card className="dd-card--flat" style={{ padding: 0 }}>
            <div className="dd-table-wrap" style={{ border: 0 }}>
              <table className="dd-table" data-testid="watch-monitor-table">
                <thead>
                  <tr>
                    <th scope="col">{t('aw.col.campaign')}</th>
                    <th scope="col">{t('av.col.merchant')}</th>
                    <th scope="col">{t('mw.col.views')}</th>
                    <th scope="col">{t('aw.col.budgetPct')}</th>
                    <th scope="col">{t('aw.col.flags')}</th>
                    <th scope="col">{t('mdeal.col.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.campaigns.map((r) => (
                    <tr key={r.id} data-testid="watch-monitor-row">
                      <td>
                        <Link
                          className="dd-rowlink dd-clamp"
                          href={withLocale(`/watch/${r.id}`, locale)}
                        >
                          {r.title[locale] || r.title.en}
                        </Link>
                      </td>
                      <td>{r.merchantName[locale] || r.merchantName.en}</td>
                      <td className="dd-ltr">
                        {n(r.qualifiedViews)} / {n(r.paidViews)}
                      </td>
                      <td className="dd-ltr">
                        {n(r.budgetPct)}% · {formatMoney(locale, r.spentHalalas)} /{' '}
                        {formatMoney(locale, r.fundedHalalas)}
                      </td>
                      <td className="dd-ltr">{n(r.openFlags)}</td>
                      <td>
                        <WatchStatusChip status={r.status} locale={locale} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : rows.length === 0 ? (
        <EmptyState title={tab === 'queue' ? t('aw.queueEmpty') : t('mdeal.hub.noMatch')} />
      ) : (
        <Card className="dd-card--flat" style={{ padding: 0 }}>
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table">
              <thead>
                <tr>
                  <th scope="col">{t('aw.col.campaign')}</th>
                  <th scope="col">{t('av.col.merchant')}</th>
                  <th scope="col">{t('mw.col.views')}</th>
                  <th scope="col">{t('mw.col.budget')}</th>
                  <th scope="col">{t('av.col.submitted')}</th>
                  <th scope="col">{t('mdeal.col.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid="admin-watch-row">
                    <td>
                      <Link
                        className="dd-rowlink dd-clamp"
                        href={withLocale(`/watch/${r.id}`, locale)}
                      >
                        {r.title[locale] || r.title.en || r.title.ar}
                      </Link>
                    </td>
                    <td>{locale === 'ar' ? r.merchant.nameAr : r.merchant.nameEn}</td>
                    <td className="dd-ltr">
                      {n(r.qualifiedViews)} / {n(r.paidViews)}
                    </td>
                    <td className="dd-ltr">
                      {formatMoney(locale, r.spentHalalas)} / {formatMoney(locale, r.fundedHalalas)}
                    </td>
                    <td className="dd-caption">
                      {r.submittedAt ? formatDateTime(locale, r.submittedAt) : '–'}
                    </td>
                    <td>
                      <WatchStatusChip status={r.status} locale={locale} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {next && tab !== 'monitor' ? (
        <div>
          <Button variant="outline" onClick={() => void more()}>
            {t('mdeal.loadMore')}
          </Button>
        </div>
      ) : null}
      <p className="dd-caption">{t('mw.legalNote')}</p>
    </div>
  );
}

// ================================================================ review workbench
type Action =
  'approve' | 'request-changes' | 'reject' | 'pause' | 'resume' | 'suspend' | 'reinstate' | 'stop';
const LABEL: Record<Action, DictionaryKey> = {
  approve: 'ah.approve',
  'request-changes': 'ah.requestChanges',
  reject: 'ah.reject',
  pause: 'ah.pause',
  resume: 'ah.resume',
  suspend: 'ah.suspend',
  reinstate: 'ah.reinstate',
  stop: 'aw.stop',
};
const DANGER: Action[] = ['reject', 'suspend', 'stop'];

export function AdminWatchReviewPage({ id }: { id: string }) {
  return (
    <RequirePermission any={['admin.watch.read']}>
      <ReviewInner id={id} />
    </RequirePermission>
  );
}

function ReviewInner({ id }: { id: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [d, setD] = useState<AdminWatchDetail | null>(null);
  const [mon, setMon] = useState<WatchMonitor | null>(null);
  const [budget, setBudget] = useState<WatchBudgetDetail | null>(null);
  const [tab, setTab] = useState('review');
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
    const [r, m, b] = await Promise.all([
      call<AdminWatchDetail>('GET', `/v1/admin/watch/${id}`),
      call<WatchMonitor>('GET', `/v1/admin/watch/${id}/monitor`),
      call<WatchBudgetDetail>('GET', `/v1/admin/watch/${id}/budget`),
    ]);
    if (r.ok && r.data) {
      setD(r.data);
      setMon(m.data);
      setBudget(b.data);
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
    setReason(
      a === 'approve' ? 'Content and budget checked. The campaign follows the content rules.' : '',
    );
    setReasonAr(
      a === 'approve' ? 'تم التحقق من المحتوى والميزانية. الحملة تتبع قواعد المحتوى.' : '',
    );
    setFormError('');
  };
  const submit = async () => {
    if (!action) return;
    if (reason.trim().length < 3) return setFormError(t('modal.reasonRequired'));
    setBusy(true);
    const r = await call<AdminWatchDetail>('POST', `/v1/admin/watch/${id}/${action}`, {
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
          <Link className="dd-btn dd-btn--secondary" href={withLocale('/watch', locale)}>
            {t('aw.back')}
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
  const e = d.economics;
  const canAct = (a: string) =>
    d.adminActions.includes(a.replace('-', '_')) || d.adminActions.includes(a);
  const items: TimelineItem[] = d.history.map((h) => ({
    id: h.id,
    title: t(`waction.${h.action}` as DictionaryKey),
    meta: `${formatDateTime(locale, h.createdAt)} · ${h.actorName ?? h.actorRole ?? t('adeal.actorSystem')}${h.actorRole && h.actorName ? ` (${h.actorRole})` : ''}`,
    body: [historyReason(locale, h.reason), h.reasonAr].filter(Boolean).join('\n') || undefined,
    tone: /REJECT|SUSPEND|CANCEL|STOP/.test(h.action)
      ? 'danger'
      : /REQUEST_CHANGES|PAUSE/.test(h.action)
        ? 'warning'
        : /APPROVE|ACTIVATE|REINSTATE|COMPLETE/.test(h.action)
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
        <div className="dd-kpi__l">{t('mw.title2')}</div>
        <strong>{c.title[lang]}</strong>
        <div className="dd-kpi__l">{t('mw.desc')}</div>
        <div className="dd-pre">{c.description[lang]}</div>
        <div className="dd-kpi__l">{t('mw.cta')}</div>
        <div>{c.ctaLabel[lang]}</div>
      </div>
    </Card>
  ));
  const n = (v: number) => formatNumber(locale, v);

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="watch-review">
      <Link className="dd-link" href={withLocale('/watch', locale)}>
        ← {t('aw.back')}
      </Link>
      <div className="dd-topbar">
        <div className="dd-row">
          <h1 className="dd-title-xl dd-clamp">{c.title[locale] || c.title.en}</h1>
          <WatchStatusChip status={d.status} locale={locale} />
        </div>
      </div>
      {done ? <Alert tone="success">{t('ah.done')}</Alert> : null}

      <Tabs
        label={t('aw.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'review', label: t('aw.tabReview') },
          { id: 'monitor', label: t('mw.tabMonitor') },
          { id: 'budget', label: t('mw.tabBudget') },
          { id: 'activity', label: t('mw.tabActivity') },
        ]}
      />

      {tab === 'monitor' && mon ? <WatchMonitorView mon={mon} locale={locale} /> : null}
      {tab === 'budget' && budget ? (
        <div className="dd-stack" data-testid="admin-watch-budget">
          <Card flat>
            <BudgetMeter budget={budget.budget} locale={locale} />
          </Card>
          <Card flat>
            <h2 className="dd-title">{t('mw.fundingHistory')}</h2>
            {budget.funding.length === 0 ? (
              <p className="dd-muted">{t('mw.noFunding')}</p>
            ) : (
              <div className="dd-table-wrap" style={{ border: 0 }}>
                <table className="dd-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('fin.col.ref')}</th>
                      <th scope="col">{t('fin.col.amount')}</th>
                      <th scope="col">{t('fin.col.when')}</th>
                      <th scope="col">{t('fin.col.type')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budget.funding.map((f) => (
                      <tr key={f.id}>
                        <td className="dd-ltr">{f.reference}</td>
                        <td className="dd-ltr">{formatMoney(locale, f.amountHalalas)}</td>
                        <td className="dd-caption">{formatDateTime(locale, f.createdAt)}</td>
                        <td>{f.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card flat>
            <h2 className="dd-title">{t('aw.journals')}</h2>
            <div className="dd-table-wrap" style={{ border: 0 }}>
              <table className="dd-table">
                <tbody>
                  {budget.journals.map((j) => (
                    <tr key={j.id}>
                      <td>{j.type}</td>
                      <td className="dd-ltr">{formatMoney(locale, j.amountHalalas)}</td>
                      <td className="dd-caption">{formatDateTime(locale, j.postedAt)}</td>
                      <td className="dd-caption">{j.memo ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="dd-caption">{t('mw.legalNote')}</p>
        </div>
      ) : null}
      {tab === 'activity' ? (
        <Card>
          <h2 className="dd-title">{t('av.history')}</h2>
          <Timeline items={items} label={t('av.history')} />
        </Card>
      ) : null}

      {tab === 'review' ? (
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
                  <dt>{t('adeal.col.merchant')}</dt>
                  <dd>{t(`adeal.trust.${d.merchant.trustLevel}` as DictionaryKey)}</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('adeal.risk')}</dt>
                  <dd>{d.merchant.riskTier}</dd>
                </div>
              </dl>
            </Card>

            <Card data-testid="watch-video-card">
              <h2 className="dd-title">{t('aw.video')}</h2>
              {d.videoUrl ? (
                <video
                  className="dd-videopreview"
                  src={d.videoUrl}
                  controls
                  playsInline
                  preload="metadata"
                  data-testid="admin-watch-video"
                />
              ) : (
                <p className="dd-muted">{t('wmedia.empty')}</p>
              )}
              <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
                <div className="dd-kv__row">
                  <dt>{t('mw.duration')}</dt>
                  <dd className="dd-ltr">{c.durationSec ?? '–'}</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('mw.cities')}</dt>
                  <dd>{c.targeting.cities.join(', ') || '–'}</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('mv.eligibility')}</dt>
                  <dd>{t(`elig.${c.targeting.eligibility.kind}` as DictionaryKey)}</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('mw.period')}</dt>
                  <dd className="dd-ltr">
                    {c.startAt ? formatDateTime(locale, c.startAt) : '–'} →{' '}
                    {c.endAt ? formatDateTime(locale, c.endAt) : '–'}
                  </dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('mw.link')}</dt>
                  <dd>{t(`mw.linkType.${c.link.type}` as DictionaryKey)}</dd>
                </div>
              </dl>
            </Card>

            <Card data-testid="watch-economics">
              <h2 className="dd-title">{t('aw.economics')}</h2>
              <p className="dd-muted">{t('aw.economicsNote')}</p>
              <dl className="dd-kv" style={{ marginBlockStart: 8 }}>
                <div className="dd-kv__row">
                  <dt>{t('mw.paid')}</dt>
                  <dd className="dd-ltr">{n(d.budget.paidViews)}</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('wmon.charge')}</dt>
                  <dd className="dd-ltr">
                    {formatMoney(locale, e.chargePerViewHalalas)} (v{e.rateCardVersion})
                  </dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('aw.estimatedCost')}</dt>
                  <dd className="dd-ltr" data-testid="econ-cost">
                    {formatMoney(locale, e.estimatedCostHalalas)}
                  </dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('wmon.funded')}</dt>
                  <dd className="dd-ltr" data-testid="econ-funded">
                    {formatMoney(locale, d.budget.fundedHalalas)}
                  </dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('aw.rewardPoints')}</dt>
                  <dd className="dd-ltr" data-testid="econ-points">
                    {n(e.rewardPoints)} (v{e.rewardRuleVersion})
                  </dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('aw.watchPct')}</dt>
                  <dd className="dd-ltr">{n(e.qualifyingWatchPct)}%</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('aw.stillWatching')}</dt>
                  <dd>{t(`aw.sw.${e.stillWatchingMode}` as DictionaryKey)}</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('aw.repeat')}</dt>
                  <dd className="dd-ltr">{n(e.repeatWindowHours)}h</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('aw.dailyCap')}</dt>
                  <dd className="dd-ltr">{n(e.customerDailyCap)}</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('aw.deviceAccounts')}</dt>
                  <dd className="dd-ltr">{n(e.deviceMaxAccounts)}</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('aw.holdHours')}</dt>
                  <dd className="dd-ltr">{n(e.holdHours)}h</dd>
                </div>
                <div className="dd-kv__row">
                  <dt>{t('aw.unusedTreatment')}</dt>
                  <dd data-testid="econ-unused">
                    {t(`aw.unusedPolicy.${e.unusedBudgetTreatment}` as DictionaryKey)}
                  </dd>
                </div>
              </dl>
              {e.largeBudgetFlag ? (
                <div style={{ marginBlockStart: 10 }} data-testid="large-budget-flag">
                  <Alert tone="warning">
                    {t('aw.largeBudget', { n: n(e.reviewAbovePaidViews) })}
                  </Alert>
                </div>
              ) : null}
            </Card>

            <div className="dd-grid dd-grid--2">{columns}</div>

            {d.issues.length ? (
              <Alert tone="warning" title={t('aw.issues')}>
                <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                  {d.issues.map((i, k) => (
                    <li key={`${i.field}-${k}`}>
                      {t(`issue.field.${i.field}` as DictionaryKey) === `issue.field.${i.field}`
                        ? i.field
                        : t(`issue.field.${i.field}` as DictionaryKey)}
                      : {t(`issue.${i.code}` as DictionaryKey)}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            {d.guardrail.reasons.length ? (
              <Alert tone="warning" title={t('mw.guardrail.manual')}>
                <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
                  {d.guardrail.reasons.map((r) => (
                    <li key={r}>{t(`guardrail.reason.${r}` as DictionaryKey)}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
          </div>

          <aside className="dd-stack" style={{ gap: 16 }}>
            <Card data-testid="watch-decision">
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
                    'stop',
                  ] as Action[]
                )
                  .filter((a) => canAct(a))
                  .map((a) => (
                    <Button
                      key={a}
                      variant={
                        a === 'approve' ? 'primary' : DANGER.includes(a) ? 'danger' : 'outline'
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
                      onClick={(ev) => {
                        ev.preventDefault();
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
                  <WatchCardView campaign={d.preview} locale={previewLang} variant="list" />
                ) : (
                  <WatchDetailView detail={d.preview} locale={previewLang} embedded />
                )}
              </div>
            </Card>
          </aside>
        </div>
      ) : null}

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
              variant={action && DANGER.includes(action) ? 'danger' : 'primary'}
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
              onChange={(ev) => setReason(ev.target.value)}
            />
          </Field>
          <Field label={t('ah.reasonAr')} htmlFor="decision-reason-ar">
            <Textarea
              id="decision-reason-ar"
              rows={3}
              dir="rtl"
              lang="ar"
              value={reasonAr}
              onChange={(ev) => setReasonAr(ev.target.value)}
            />
          </Field>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
        </div>
      </Modal>
    </div>
  );
}
