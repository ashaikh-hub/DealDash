'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  DealCardView,
  DealDetailView,
  RequirePermission,
  fieldLabel,
  historyReason,
  errorMessage,
  useApi,
  useAuth,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDate,
  formatNumber,
  withLocale,
  type Locale,
} from '@dealdash/localization';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  Modal,
  StatusChip,
  Table,
  Tabs,
  Textarea,
  Timeline,
  type TimelineItem,
} from '@dealdash/ui';
import type { DealDetail, DealPerformance, LiveDealView } from '@dealdash/validation';
import { DealStatusChip, useOrgId, when } from './deal-utils';

type HistoryRow = {
  id: string;
  action: string;
  reason: string | null;
  reasonAr: string | null;
  fields: string[];
  actorRole: string | null;
  actorName: string | null;
  byDealDash: boolean;
  createdAt: string;
};

export function DealDetailPage({ id }: { id: string }) {
  return (
    <RequirePermission any={['merchant.deals.read']}>
      <DetailInner id={id} />
    </RequirePermission>
  );
}

function DetailInner({ id }: { id: string }) {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const [deal, setDeal] = useState<LiveDealView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<null | 'pause' | 'end'>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const canManage = me?.permissions.includes('merchant.deals.manage');

  const load = useCallback(async () => {
    if (!orgId) return;
    const r = await call<LiveDealView>('GET', `/v1/merchants/${orgId}/live-deals/${id}`);
    if (r.ok && r.data) {
      setDeal(r.data);
      setState('ready');
    } else if (r.status === 404) setState('missing');
    else {
      setError(errorMessage(locale, r.errors));
      setState('error');
    }
  }, [call, orgId, id, locale]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, body: unknown = {}) => {
    setBusy(true);
    setActionError('');
    const r = await call<LiveDealView>('POST', `/v1/merchants/${orgId}/live-deals/${id}/${path}`, {
      body,
    });
    setBusy(false);
    if (!r.ok) return setActionError(errorMessage(locale, r.errors));
    setDialog(null);
    setReason('');
    if (path === 'submit') await load();
    else if (r.data) setDeal((r.data as unknown as { deal?: LiveDealView }).deal ?? r.data);
  };

  if (state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'missing')
    return (
      <EmptyState
        title={t('detail.notFound')}
        action={
          <Link className="dd-btn dd-btn--secondary" href={withLocale('/deals', locale)}>
            {t('mdeal.back')}
          </Link>
        }
      />
    );
  if (state === 'error' || !deal)
    return (
      <Alert tone="danger">
        {error}{' '}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t('state.retry')}
        </Button>
      </Alert>
    );

  const a = new Set(deal.allowedActions);
  const title =
    deal.content.title[locale] ||
    deal.content.title.en ||
    deal.content.title.ar ||
    t('mdeal.untitled');
  const decision = deal.latestDecision;
  const decisionText = decision
    ? locale === 'ar' && decision.reasonAr
      ? decision.reasonAr
      : decision.reason
    : null;

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="deal-detail">
      <Link className="dd-link" href={withLocale('/deals', locale)}>
        ← {t('mdeal.back')}
      </Link>
      <div className="dd-topbar">
        <div className="dd-row">
          <h1 className="dd-title-xl dd-clamp">{title}</h1>
          <DealStatusChip status={deal.status} />
          {deal.revision ? (
            <StatusChip tone="info">{t(`revStatus.${deal.revision.status}` as never)}</StatusChip>
          ) : null}
        </div>
        {canManage ? (
          <div className="dd-row">
            {(a.has('edit') || a.has('submit')) && deal.status === 'NEEDS_CHANGES' ? (
              <Link
                className="dd-btn dd-btn--primary"
                href={withLocale(`/deals/${id}/edit`, locale)}
              >
                {t('action.fixResubmit')}
              </Link>
            ) : null}
            {a.has('edit') && deal.status !== 'NEEDS_CHANGES' ? (
              <Link
                className={`dd-btn ${deal.status === 'DRAFT' ? 'dd-btn--primary' : 'dd-btn--secondary'}`}
                href={withLocale(`/deals/${id}/edit`, locale)}
              >
                {t('action.edit')}
              </Link>
            ) : null}
            {a.has('submit') && deal.status === 'DRAFT' ? (
              <Button loading={busy} onClick={() => void act('submit')}>
                {t('action.submit')}
              </Button>
            ) : null}
            {a.has('submit') &&
            deal.revision &&
            deal.status !== 'DRAFT' &&
            deal.status !== 'NEEDS_CHANGES' ? (
              <Button loading={busy} onClick={() => void act('submit')}>
                {t('action.submitChanges')}
              </Button>
            ) : null}
            {a.has('pause') ? (
              <Button variant="outline" onClick={() => setDialog('pause')}>
                {t('action.pause')}
              </Button>
            ) : null}
            {a.has('resume') ? (
              <Button variant="outline" loading={busy} onClick={() => void act('resume')}>
                {t('action.resume')}
              </Button>
            ) : null}
            {a.has('end') ? (
              <Button variant="danger" onClick={() => setDialog('end')}>
                {t('action.end')}
              </Button>
            ) : null}
            {a.has('discard_revision') ? (
              <Button variant="ghost" loading={busy} onClick={() => void act('discard-revision')}>
                {deal.revision?.status === 'PENDING_REVIEW'
                  ? t('action.withdrawChanges')
                  : t('action.discardChanges')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      {deal.status === 'PENDING_REVIEW' ? <Alert tone="info">{t('banner.pending')}</Alert> : null}
      {deal.status === 'NEEDS_CHANGES' && decisionText ? (
        <Alert tone="warning" title={t('banner.needsChanges')}>
          {decisionText}
        </Alert>
      ) : null}
      {deal.status === 'REJECTED' && decisionText ? (
        <Alert tone="danger" title={t('banner.rejected')}>
          {decisionText}
        </Alert>
      ) : null}
      {deal.status === 'SUSPENDED' ? (
        <Alert tone="danger" title={t('banner.suspended')}>
          {decisionText}
        </Alert>
      ) : null}
      {deal.status === 'PAUSED' ? (
        <Alert tone="warning">
          {deal.pausedBy === 'DEALDASH' ? t('banner.pausedByDealDash') : t('banner.paused')}
        </Alert>
      ) : null}
      {deal.revision?.status === 'PENDING_REVIEW' ? (
        <Alert tone="info">{t('banner.revisionPending')}</Alert>
      ) : null}
      {deal.revision?.status === 'DRAFT' ? (
        <Alert tone="info">{t('banner.revisionDraft')}</Alert>
      ) : null}
      {deal.revision?.status === 'NEEDS_CHANGES' && decisionText ? (
        <Alert tone="warning" title={t('banner.revisionNeeds')}>
          {decisionText}
        </Alert>
      ) : null}
      {(deal.status === 'LIVE' || deal.status === 'SCHEDULED') &&
      !deal.discoverable.visible &&
      deal.discoverable.reason !== 'NOT_STARTED' ? (
        <Alert tone="warning" title={t('banner.hidden')}>
          {t(`visible.${deal.discoverable.reason}` as never)}
        </Alert>
      ) : null}

      <Tabs
        label={title}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: t('tab.overview') },
          { id: 'analytics', label: t('tab.analytics') },
          { id: 'activity', label: t('tab.activity') },
        ]}
      />
      {tab === 'overview' ? <Overview deal={deal} orgId={orgId!} /> : null}
      {tab === 'analytics' ? <Analytics deal={deal} orgId={orgId!} /> : null}
      {tab === 'activity' ? <Activity id={id} orgId={orgId!} /> : null}

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'end' ? t('modal.endTitle') : t('modal.pauseTitle')}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="outline" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={dialog === 'end' ? 'danger' : 'primary'}
              loading={busy}
              disabled={dialog === 'end' && reason.trim().length < 3}
              onClick={() =>
                void act(
                  dialog === 'end' ? 'end' : 'pause',
                  dialog === 'end' ? { reason } : reason.trim().length >= 3 ? { reason } : {},
                )
              }
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p>{dialog === 'end' ? t('modal.endBody') : t('modal.pauseBody')}</p>
        <Field
          label={dialog === 'end' ? t('modal.reason') : t('modal.reasonOptional')}
          htmlFor="reason"
          help={dialog === 'end' ? t('modal.reasonRequired') : undefined}
        >
          <Textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}

function Overview({ deal, orgId }: { deal: LiveDealView; orgId: string }) {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [preview, setPreview] = useState<DealDetail | null>(null);
  const [lang, setLang] = useState<Locale>(locale);
  useEffect(() => {
    void call<DealDetail>('GET', `/v1/merchants/${orgId}/live-deals/${deal.id}/preview`).then(
      (r) => r.ok && setPreview(r.data),
    );
  }, [call, orgId, deal.id, deal.version, deal.revision?.id]);
  const c = deal.content;
  const nm = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  void me;
  return (
    <div className="dd-split">
      <Card>
        <h2 className="dd-title">{t('detail.summary')}</h2>
        <dl className="dd-kv" style={{ marginBlockStart: 12 }}>
          <div className="dd-kv__row">
            <dt>{t('detail.value')}</dt>
            <dd>
              {c.offerLabel[locale] || c.offerLabel.en}
              {c.mechanic ? ` · ${t(`mechanic.${c.mechanic}` as never)}` : ''}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('detail.dates')}</dt>
            <dd>
              {c.startAt ? formatDate(locale, c.startAt) : '-'} –{' '}
              {c.endAt ? formatDate(locale, c.endAt) : t('mdeal.openEnded')}
            </dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('detail.branches')}</dt>
            <dd>{deal.branches.map(nm).join(', ') || '-'}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('detail.eligibility')}</dt>
            <dd>{t(`elig.${c.eligibility.kind}` as never)}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('detail.redemption')}</dt>
            <dd>{t('field.redemptionGeneral')}</dd>
          </div>
          <div className="dd-kv__row">
            <dt>{t('detail.terms')}</dt>
            <dd className="dd-pre">{(locale === 'ar' ? c.terms.textAr : c.terms.textEn) || '-'}</dd>
          </div>
        </dl>
        <div className="dd-row" style={{ marginBlockStart: 12 }}>
          <StatusChip tone={deal.discoverable.visible ? 'success' : 'neutral'}>
            {deal.discoverable.visible ? t('banner.visible') : t('banner.hidden')}
          </StatusChip>
          {!deal.discoverable.visible && deal.discoverable.reason ? (
            <span className="dd-caption">{t(`visible.${deal.discoverable.reason}` as never)}</span>
          ) : null}
        </div>
      </Card>
      <Card className="dd-split__aside">
        <div className="dd-stack">
          <div className="dd-row" style={{ justifyContent: 'space-between' }}>
            <h2 className="dd-title">{t('detail.customerPreview')}</h2>
            <div className="dd-lang">
              {(['en', 'ar'] as const).map((l) => (
                <a
                  key={l}
                  href="#preview"
                  aria-current={lang === l ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    setLang(l);
                  }}
                >
                  {l === 'en' ? 'EN' : 'عربي'}
                </a>
              ))}
            </div>
          </div>
          {preview ? (
            <div
              dir={lang === 'ar' ? 'rtl' : 'ltr'}
              lang={lang}
              style={{ maxBlockSize: 560, overflow: 'auto' }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBlockEnd: 12 }}>
                <DealCardView deal={preview} locale={lang} />
              </div>
              <DealDetailView detail={preview} locale={lang} embedded />
            </div>
          ) : (
            <LoadingState label={t('review.previewLoading')} />
          )}
        </div>
      </Card>
    </div>
  );
}

function Analytics({ deal, orgId }: { deal: LiveDealView; orgId: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [perf, setPerf] = useState<DealPerformance | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const load = useCallback(async () => {
    setState('loading');
    const r = await call<DealPerformance>(
      'GET',
      `/v1/merchants/${orgId}/live-deals/${deal.id}/performance`,
    );
    if (r.ok && r.data) {
      setPerf(r.data);
      setState('ready');
    } else setState('error');
  }, [call, orgId, deal.id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'error' || !perf)
    return (
      <Alert tone="danger">
        {t('error.generic')}{' '}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t('state.retry')}
        </Button>
      </Alert>
    );
  const n = (v: number) => formatNumber(locale, v);
  const total = Object.values(perf.totals).reduce((a, b) => a + b, 0);
  const kpis: Array<[string, number]> = [
    ['perf.impressions', perf.totals.impressions],
    ['perf.detailViews', perf.totals.detailViews],
    ['perf.saves', perf.totals.saves],
    ['perf.directions', perf.totals.directionsClicks],
    ['perf.merchantPageViews', perf.totals.merchantPageViews],
  ];
  const max = Math.max(1, ...perf.byDay.map((d) => d.impressions + d.detailViews));
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="deal-analytics">
      <Alert tone="info">{t('perf.disclaimer')}</Alert>
      {total === 0 ? <EmptyState title={t('perf.empty')} /> : null}
      <div className="dd-kpis">
        {kpis.map(([k, v]) => (
          <div key={k} className="dd-kpi">
            <div className="dd-kpi__n">{n(v)}</div>
            <div className="dd-kpi__l">{t(k as never)}</div>
          </div>
        ))}
      </div>
      {perf.byDay.length ? (
        <Card>
          <h2 className="dd-title">
            {t('perf.byDay')} · {t('perf.last30')}
          </h2>
          <div className="dd-bars" role="img" aria-label={t('perf.byDay')}>
            {perf.byDay.map((d) => (
              <div
                key={d.date}
                className="dd-barwrap"
                title={`${d.date}: ${d.impressions} / ${d.detailViews}`}
              >
                <div
                  className="dd-bar"
                  style={{
                    blockSize: `${Math.max(4, ((d.impressions + d.detailViews) / max) * 100)}%`,
                  }}
                />
                <span>{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {perf.byBranch.length ? (
        <Table
          caption={t('perf.byBranch')}
          rowKey={(r) => r.branchId}
          columns={[
            {
              key: 'name',
              header: t('detail.branches'),
              render: (r) => r.name[locale] || r.name.en,
            },
            {
              key: 'detailViews',
              header: t('perf.detailViews'),
              numeric: true,
              render: (r) => n(r.detailViews),
            },
            {
              key: 'directionsClicks',
              header: t('perf.directions'),
              numeric: true,
              render: (r) => n(r.directionsClicks),
            },
          ]}
          rows={
            perf.byBranch as unknown as Array<
              Record<string, unknown> & (typeof perf.byBranch)[number]
            >
          }
        />
      ) : null}
      <p className="dd-caption">{t('perf.noSales')}</p>
    </div>
  );
}

function Activity({ id, orgId }: { id: string; orgId: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    void call<HistoryRow[]>('GET', `/v1/merchants/${orgId}/live-deals/${id}/history`).then((r) =>
      setRows(r.ok ? (r.data ?? []) : []),
    );
  }, [call, orgId, id]);
  if (!rows) return <LoadingState label={t('state.loading')} />;
  if (!rows.length) return <EmptyState title={t('history.empty')} />;
  const items: TimelineItem[] = rows.map((h) => ({
    id: h.id,
    title: t(`history.${h.action}` as never),
    meta: `${when(locale, h.createdAt)} · ${h.byDealDash ? (h.actorRole === 'SYSTEM' ? t('history.bySystem') : t('history.byDealDash')) : t('history.you')}`,
    body:
      [
        (locale === 'ar' && h.reasonAr) || historyReason(locale, h.reason),
        h.fields.length
          ? t('history.fields', {
              fields: [...new Set(h.fields.map((f) => fieldLabel(locale, f)))].join(', '),
            })
          : null,
      ]
        .filter(Boolean)
        .join('\n') || undefined,
    tone: /REJECT|SUSPEND/.test(h.action)
      ? 'danger'
      : /REQUEST_CHANGES/.test(h.action)
        ? 'warning'
        : /APPROVE|ACTIVATE/.test(h.action)
          ? 'success'
          : 'info',
  }));
  return <Timeline items={items} label={t('tab.activity')} />;
}
