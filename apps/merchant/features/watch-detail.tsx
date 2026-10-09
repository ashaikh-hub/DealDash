'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  BudgetMeter,
  RequirePermission,
  WatchMonitorView,
  WatchStatusChip,
  errorMessage,
  historyReason,
  useApi,
  useAuth,
  CommercialPanel,
} from '@dealdash/app-shell';
import {
  createTranslator,
  formatDateTime,
  formatMoney,
  withLocale,
  type DictionaryKey,
} from '@dealdash/localization';
import { Alert, Button, Card, EmptyState, LoadingState, Tabs } from '@dealdash/ui';
import type { WatchBudgetDetail, WatchCampaignView, WatchMonitor } from '@dealdash/validation';
import { useOrgId } from './deal-utils';
import { ReasonDialog } from './voucher-utils';

interface HistoryRow {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  reasonAr: string | null;
  fields: string[];
  actorRole: string | null;
  actorName: string | null;
  byDealDash: boolean;
  createdAt: string;
}

const bn = (x: { en: string; ar: string }, l: 'en' | 'ar') => x[l] || x.en || x.ar;

export function WatchDetailPage({ campaignId }: { campaignId: string }) {
  return (
    <RequirePermission any={['merchant.watch.read']}>
      <DetailInner campaignId={campaignId} />
    </RequirePermission>
  );
}

function DetailInner({ campaignId }: { campaignId: string }) {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = useOrgId();
  const canFund = !!me?.permissions.some(
    (p) => p === 'merchant.watch.manage' || p === 'merchant.finance.manage',
  );
  const [campaign, setCampaign] = useState<WatchCampaignView | null>(null);
  const [mon, setMon] = useState<WatchMonitor | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [tab, setTab] = useState('monitor');
  const [dialog, setDialog] = useState<null | 'cancel' | 'pause'>(null);
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const base = `/v1/merchants/${orgId}/watch/${campaignId}`;
  const load = useCallback(
    async (quiet = false) => {
      if (!orgId) return;
      if (!quiet) setState('loading');
      const [d, m] = await Promise.all([
        call<WatchCampaignView>('GET', base),
        call<WatchMonitor>('GET', `${base}/monitor`),
      ]);
      if (d.ok && d.data) {
        setCampaign(d.data);
        if (m.ok && m.data) setMon(m.data);
        setState('ready');
      } else if (!quiet) setState(d.status === 404 ? 'missing' : 'error');
    },
    [call, orgId, base],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void load(true), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!orgId || state === 'loading') return <LoadingState label={t('state.loading')} />;
  if (state === 'missing') return <EmptyState title={t('detail.notFound')} />;
  if (state === 'error' || !campaign || !mon)
    return (
      <Alert tone="danger">
        {t('error.generic')}{' '}
        <Button size="sm" variant="outline" onClick={() => void load()}>
          {t('state.retry')}
        </Button>
      </Alert>
    );

  const can = (a: string) => campaign.allowedActions.includes(a);
  const title = bn(campaign.content.title, locale) || t('mdeal.untitled');
  const act = async (path: string, body: unknown = {}) => {
    const r = await call<WatchCampaignView | { campaign: WatchCampaignView }>(
      'POST',
      `${base}/${path}`,
      { body },
    );
    if (r.ok && r.data) {
      const v = 'campaign' in r.data ? r.data.campaign : r.data;
      setCampaign(v);
      void load(true);
      return null;
    }
    return errorMessage(locale, r.errors);
  };
  const remaining = Math.max(0, campaign.budget.requiredHalalas - campaign.budget.fundedHalalas);
  const fundNow = async () => {
    setBusy(true);
    const r = await call<WatchCampaignView>('POST', `${base}/fund`, {
      body: { amountHalalas: remaining },
      idempotent: true,
    });
    setBusy(false);
    if (r.ok && r.data) {
      setCampaign(r.data);
      setBanner({ tone: 'success', text: t('mw.funded') });
      void load(true);
    } else setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
  };

  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="watch-detail">
      <div className="dd-builder__bar">
        <div className="dd-row">
          <Link className="dd-link" href={withLocale('/watch', locale)}>
            ← {t('mdeal.back')}
          </Link>
          <h1 className="dd-title-xl" style={{ fontSize: 22 }}>
            {title}
          </h1>
          <WatchStatusChip status={campaign.status} locale={locale} />
        </div>
        <div className="dd-row">
          {can('edit') || can('edit_minor') ? (
            <Link
              className="dd-btn dd-btn--secondary"
              href={withLocale(`/watch/${campaignId}/edit`, locale)}
            >
              {t('action.edit')}
            </Link>
          ) : null}
          {can('fund') && canFund && remaining > 0 ? (
            <Button
              variant="outline"
              loading={busy}
              onClick={() => void fundNow()}
              data-testid="detail-fund"
            >
              {t('mw.fundNow', { amount: formatMoney(locale, remaining) })}
            </Button>
          ) : null}
          {can('pause') ? (
            <Button variant="outline" onClick={() => setDialog('pause')} data-testid="open-pause">
              {t('mv.pause')}
            </Button>
          ) : null}
          {can('resume') ? (
            <Button
              variant="outline"
              data-testid="do-resume"
              onClick={async () => {
                const e = await act('resume');
                if (e) setBanner({ tone: 'danger', text: e });
              }}
            >
              {t('mv.resume')}
            </Button>
          ) : null}
          {can('submit') ? (
            <Button
              data-testid="detail-submit"
              onClick={async () => {
                const e = await act('submit');
                if (e) setBanner({ tone: 'danger', text: e });
              }}
            >
              {t('mhb.submit')}
            </Button>
          ) : null}
          {can('cancel') ? (
            <Button variant="danger" onClick={() => setDialog('cancel')} data-testid="open-cancel">
              {t('mw.cancel')}
            </Button>
          ) : null}
        </div>
      </div>

      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}
      {campaign.status === 'NEEDS_CHANGES' && campaign.latestDecision ? (
        <Alert tone="warning" title={t('banner.needsChanges')}>
          {(locale === 'ar' && campaign.latestDecision.reasonAr) || campaign.latestDecision.reason}
        </Alert>
      ) : null}
      {campaign.status === 'PENDING_REVIEW' ? (
        <Alert tone="info">{t('mhb.pendingEdit')}</Alert>
      ) : null}
      {campaign.status === 'PAUSED' && campaign.pausedBy === 'DEALDASH' ? (
        <Alert tone="warning">{t('mw.pausedByDealDash')}</Alert>
      ) : null}
      {campaign.status === 'SUSPENDED' ? (
        <Alert tone="danger">
          {t('mw.suspendedNote')} {campaign.latestDecision?.reason ?? ''}
        </Alert>
      ) : null}
      {campaign.status === 'REJECTED' && campaign.latestDecision ? (
        <Alert tone="danger" title={t('mw.rejectedTitle')}>
          {(locale === 'ar' && campaign.latestDecision.reasonAr) || campaign.latestDecision.reason}
        </Alert>
      ) : null}
      {['COMPLETED', 'EXPIRED', 'CANCELLED', 'REJECTED'].includes(campaign.status) &&
      campaign.budget.unusedHalalas > 0 ? (
        <Alert tone="info">
          <span data-testid="unused-banner">
            {t('mw.unusedBanner', { amount: formatMoney(locale, campaign.budget.unusedHalalas) })}
          </span>
        </Alert>
      ) : null}
      {campaign.status === 'DRAFT' && campaign.budget.fundingRequired ? (
        <Alert tone="warning">{t('mw.fundBeforeSubmit')}</Alert>
      ) : null}

      <Tabs
        label={t('mw.title')}
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'monitor', label: t('mw.tabMonitor') },
          { id: 'budget', label: t('mw.tabBudget') },
          { id: 'activity', label: t('mw.tabActivity') },
        ]}
      />
      {tab === 'monitor' ? (
        <WatchMonitorView mon={mon} locale={locale} />
      ) : tab === 'budget' ? (
        <BudgetTab base={base} campaign={campaign} />
      ) : (
        <ActivityTab base={base} />
      )}

      <ReasonDialog
        open={dialog === 'cancel'}
        title={t('mw.cancelTitle')}
        body={t('mw.cancelBody')}
        confirmLabel={t('mw.cancel')}
        danger
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const e = await act('cancel', { reason });
          if (!e) setDialog(null);
          return e;
        }}
      />
      <ReasonDialog
        open={dialog === 'pause'}
        title={t('mv.pause')}
        optional
        confirmLabel={t('mv.pause')}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          const e = await act('pause', reason ? { reason } : {});
          if (!e) setDialog(null);
          return e;
        }}
      />
      {orgId ? (
        <CommercialPanel orgId={orgId} product="WATCH" subjectId={campaign.id} content={{}} refreshKey={campaign.version} />
      ) : null}
    </div>
  );
}

function BudgetTab({ base, campaign }: { base: string; campaign: WatchCampaignView }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [data, setData] = useState<WatchBudgetDetail | null>(null);
  useEffect(() => {
    void call<WatchBudgetDetail>('GET', `${base}/budget`).then((r) => setData(r.data));
  }, [
    call,
    base,
    campaign.budget.fundedHalalas,
    campaign.budget.spentHalalas,
    campaign.budget.unusedHalalas,
  ]);
  if (!data) return <LoadingState label={t('state.loading')} />;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="watch-budget">
      <Card flat>
        <BudgetMeter budget={data.budget} locale={locale} />
      </Card>
      <Card flat>
        <h2 className="dd-title">{t('mw.fundingHistory')}</h2>
        {data.funding.length === 0 ? (
          <p className="dd-muted">{t('mw.noFunding')}</p>
        ) : (
          <div className="dd-table-wrap" style={{ border: 0 }}>
            <table className="dd-table" data-testid="funding-table">
              <thead>
                <tr>
                  <th scope="col">{t('fin.col.ref')}</th>
                  <th scope="col">{t('fin.col.amount')}</th>
                  <th scope="col">{t('fin.col.when')}</th>
                  <th scope="col">{t('mw.fundedBy')}</th>
                </tr>
              </thead>
              <tbody>
                {data.funding.map((f) => (
                  <tr key={f.id} data-testid="funding-row">
                    <td className="dd-ltr">{f.reference}</td>
                    <td className="dd-ltr">{formatMoney(locale, f.amountHalalas)}</td>
                    <td className="dd-caption">{formatDateTime(locale, f.createdAt)}</td>
                    <td>{f.byName ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="dd-caption" data-testid="budget-disclaimer">
        {t('mw.legalNote')}
      </p>
    </div>
  );
}

function ActivityTab({ base }: { base: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    void call<HistoryRow[]>('GET', `${base}/history`).then((r) =>
      setRows(r.ok ? (r.data ?? []) : []),
    );
  }, [call, base]);
  if (!rows) return <LoadingState label={t('state.loading')} />;
  return (
    <ol className="dd-stack" data-testid="watch-activity" style={{ listStyle: 'none', padding: 0 }}>
      {rows.map((h) => (
        <li key={h.id}>
          <Card flat>
            <div className="dd-row" style={{ justifyContent: 'space-between' }}>
              <strong>{t(`waction.${h.action}` as DictionaryKey)}</strong>
              <span className="dd-caption">{formatDateTime(locale, h.createdAt)}</span>
            </div>
            <div className="dd-caption">
              {h.byDealDash ? 'DealDash' : (h.actorName ?? h.actorRole ?? '')}
            </div>
            {(locale === 'ar' && h.reasonAr) || h.reason ? (
              <p style={{ margin: '6px 0 0' }}>
                {(locale === 'ar' && h.reasonAr) || historyReason(locale, h.reason)}
              </p>
            ) : null}
          </Card>
        </li>
      ))}
    </ol>
  );
}
