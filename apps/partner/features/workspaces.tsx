'use client';

import { useState } from 'react';
import {
  AiAssistantPanel,
  AiDraftsList,
  AlertRow,
  BillingWorkspace,
  IntegrationsPanel,
  LoyaltyWorkspace,
  OperationsWorkspace,
  PlanUsageWorkspace,
  PreferencesPanel,
  useApi,
  useAuth,
  useResource,
  type AlertView,
  type OpsTab,
} from '@dealdash/app-shell';
import { createTranslator, formatMoney, formatNumber } from '@dealdash/localization';
import { PARTNER_DRILL_LEVELS } from '@dealdash/types';
import { Alert, Button, Card, Field, Input, Select, Tabs } from '@dealdash/ui';
import { Chip, Loaded, PartnerPage, k, pbase, useCmd, usePerms, useT } from './utils';

// ================================================================ Watch & Earn sponsorship (shared loyalty rules)
interface WatchRow {
  id: string;
  titleEn: string;
  titleAr: string;
  merchantNameEn: string;
  merchantNameAr: string;
  status: string;
  paidViews: number;
  requiredBudgetHalalas: number;
  spentHalalas: number;
  pointsFunded: number;
  sponsorRules: Array<{ id: string; name: string; status: string }>;
}

interface OwnedRow {
  id: string;
  titleEn: string;
  titleAr: string;
  merchantNameEn: string;
  merchantNameAr: string;
  status: string;
  paidViews: number;
  qualifiedViews: number;
  requiredBudgetHalalas: number;
  fundedHalalas: number;
  spentHalalas: number;
}
const isoIn = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

/**
 * FD-S7-1: Watch & Earn budgets the partner OWNS (Sponsor / Funder) on the shared Watch engine, at a registered merchant of its
 * network using the merchant's own video. DealDash keeps the points economics, qualification, fraud and reward rules.
 */
function OwnedWatch({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const perms = usePerms();
  const cmd = useCmd();
  const res = useResource<OwnedRow[]>(`${pbase(orgId)}/watch/owned`);
  const canManage = perms.includes('partner.campaigns.manage');
  const canFund = perms.includes('partner.commercial.accept');
  const network = useResource<{
    items: Array<{
      id: string;
      nameEn: string;
      nameAr: string | null;
      organizationId: string | null;
      state: string;
    }>;
  }>(canManage ? `${pbase(orgId)}/network` : null, { registration: 'REGISTERED', limit: 200 });
  const registered = (network.data?.items ?? []).filter(
    (m) => m.organizationId && m.state === 'REGISTERED_ACTIVE',
  );
  const [f, setF] = useState({
    merchant: '',
    video: '',
    titleEn: '',
    titleAr: '',
    descEn: '',
    descAr: '',
    city: '',
    views: '100',
    secs: '15',
    start: isoIn(1),
    end: isoIn(30),
  });
  const merchant = f.merchant || registered[0]?.organizationId || '';
  const assets = useResource<{
    images: Array<{ fileId: string }>;
    videos: Array<{ fileId: string; name: string }>;
  }>(merchant ? `${pbase(orgId)}/campaigns/merchants/${merchant}/assets` : null);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [key]: e.target.value });
  const create = async () => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/watch/owned`,
      {
        merchantOrganizationId: merchant,
        content: {
          title: { en: f.titleEn, ar: f.titleAr },
          description: { en: f.descEn, ar: f.descAr },
          ctaLabel: {
            en: createTranslator('en')('pt.watch.ownCta'),
            ar: createTranslator('ar')('pt.watch.ownCta'),
          },
          link: { type: 'MERCHANT', id: null },
          videoFileId: f.video || assets.data?.videos[0]?.fileId,
          thumbnailFileId: assets.data?.images[0]?.fileId,
          durationSec: Number(f.secs),
          startAt: new Date(`${f.start}T00:00:00Z`).toISOString(),
          endAt: new Date(`${f.end}T23:59:59Z`).toISOString(),
          targeting: {
            cities: f.city ? [f.city] : [],
            eligibility: { kind: 'PUBLIC', valueRefs: [] },
            timeWindow: null,
            branchIds: [],
          },
          frequency: { repeatWindowHours: null },
          paidViews: Number(f.views),
        },
      },
      t('pt.watch.ownCreated'),
    );
    if (r.ok) await res.reload();
  };
  const act = async (id: string, path: 'fund' | 'submit', body: unknown, ok: string) => {
    const r = await cmd.run('POST', `${pbase(orgId)}/watch/owned/${id}/${path}`, body, ok);
    if (r.ok) await res.reload();
  };
  return (
    <Card>
      <h2 className="dd-title">{t('pt.watch.owned')}</h2>
      <p className="dd-muted">{t('pt.watch.ownedIntro')}</p>
      {cmd.banner}
      <Loaded res={res} empty={(d) => !d.length}>
        {(d) => (
          <div style={{ overflowX: 'auto' }}>
            <table className="dd-table" data-testid="pt-watch-owned">
              <thead>
                <tr>
                  <th>{t('pt.camp.detail')}</th>
                  <th>{t('pt.status')}</th>
                  <th>{t('pt.watch.paidViews')}</th>
                  <th>{t('pt.watch.budget')}</th>
                  <th>{t('pt.watch.funded')}</th>
                  <th>{t('pt.watch.spent')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.map((w) => {
                  const draft = w.status === 'DRAFT' || w.status === 'NEEDS_CHANGES';
                  const due = w.requiredBudgetHalalas - w.fundedHalalas;
                  return (
                    <tr key={w.id}>
                      <td>
                        {locale === 'ar' ? w.titleAr : w.titleEn}
                        <div className="dd-muted">
                          {locale === 'ar' ? w.merchantNameAr : w.merchantNameEn}
                        </div>
                      </td>
                      <td>
                        <Chip v={w.status} label={t(k('wstatus', w.status))} />
                      </td>
                      <td>{formatNumber(locale, w.paidViews)}</td>
                      <td>{formatMoney(locale, w.requiredBudgetHalalas)}</td>
                      <td>{formatMoney(locale, w.fundedHalalas)}</td>
                      <td>{formatMoney(locale, w.spentHalalas)}</td>
                      <td>
                        <span className="dd-row" style={{ gap: 4 }}>
                          {draft && canFund && due > 0 ? (
                            <Button
                              size="sm"
                              disabled={cmd.busy}
                              onClick={() =>
                                void act(
                                  w.id,
                                  'fund',
                                  { amountHalalas: due },
                                  t('pt.watch.ownFunded'),
                                )
                              }
                            >
                              {t('pt.watch.fund')}
                            </Button>
                          ) : null}
                          {draft && canManage && due <= 0 ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={cmd.busy}
                              onClick={() => void act(w.id, 'submit', {}, t('pt.watch.sent'))}
                            >
                              {t('pt.watch.submit')}
                            </Button>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
      {canManage ? (
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            marginTop: 12,
          }}
          data-testid="pt-watch-own-form"
        >
          <Field label={t('pt.merchant')} htmlFor="wo-m">
            <Select id="wo-m" value={merchant} onChange={set('merchant')}>
              {registered.map((m) => (
                <option key={m.id} value={m.organizationId!}>
                  {locale === 'ar' && m.nameAr ? m.nameAr : m.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('pt.watch.video')} htmlFor="wo-v">
            <Select id="wo-v" value={f.video} onChange={set('video')}>
              {(assets.data?.videos ?? []).map((v) => (
                <option key={v.fileId} value={v.fileId}>
                  {v.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('pt.offers.titleEn')} htmlFor="wo-ten">
            <Input id="wo-ten" value={f.titleEn} onChange={set('titleEn')} />
          </Field>
          <Field label={t('pt.offers.titleAr')} htmlFor="wo-tar">
            <Input id="wo-tar" dir="rtl" value={f.titleAr} onChange={set('titleAr')} />
          </Field>
          <Field label={t('pt.watch.descEn')} htmlFor="wo-den">
            <Input id="wo-den" value={f.descEn} onChange={set('descEn')} />
          </Field>
          <Field label={t('pt.watch.descAr')} htmlFor="wo-dar">
            <Input id="wo-dar" dir="rtl" value={f.descAr} onChange={set('descAr')} />
          </Field>
          <Field label={t('pt.city')} htmlFor="wo-city">
            <Input id="wo-city" value={f.city} onChange={set('city')} />
          </Field>
          <Field label={t('pt.watch.paidViews')} htmlFor="wo-views">
            <Input
              id="wo-views"
              dir="ltr"
              inputMode="numeric"
              value={f.views}
              onChange={set('views')}
            />
          </Field>
          <Field label={t('pt.watch.seconds')} htmlFor="wo-secs">
            <Input
              id="wo-secs"
              dir="ltr"
              inputMode="numeric"
              value={f.secs}
              onChange={set('secs')}
            />
          </Field>
          <Field label={t('pt.offers.from')} htmlFor="wo-start">
            <Input id="wo-start" type="date" value={f.start} onChange={set('start')} />
          </Field>
          <Field label={t('pt.offers.until')} htmlFor="wo-end">
            <Input id="wo-end" type="date" value={f.end} onChange={set('end')} />
          </Field>
          <div>
            <Button
              onClick={() => void create()}
              disabled={
                cmd.busy ||
                !merchant ||
                !assets.data?.videos.length ||
                !f.titleEn ||
                !f.titleAr ||
                !f.descEn ||
                !f.descAr
              }
              data-testid="pt-watch-own-create"
            >
              {t('pt.watch.ownCreate')}
            </Button>
            {merchant && assets.data && !assets.data.videos.length ? (
              <p className="dd-muted">{t('pt.watch.noVideo')}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function PartnerWatchPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.watch.title')}
      intro={t('pt.watch.intro')}
      any={['partner.campaigns.read']}
      module="WATCH_SPONSORSHIP"
      testId="pt-watch"
    >
      {(orgId) => <WatchInner orgId={orgId} />}
    </PartnerPage>
  );
}

function WatchInner({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const perms = usePerms();
  const res = useResource<WatchRow[]>(`${pbase(orgId)}/watch`);
  const cands = useResource<
    Array<{
      id: string;
      titleEn: string;
      titleAr: string;
      merchantNameEn: string;
      merchantNameAr: string;
    }>
  >(perms.includes('partner.loyalty.manage') ? `${pbase(orgId)}/watch/campaigns` : null);
  const cmd = useCmd();
  const [f, setF] = useState({ campaignId: '', bonus: '5', perPoint: '10', max: '10000' });
  const sponsor = async () => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/watch/sponsor`,
      {
        name: t('pt.watch.sponsor'),
        eventType: 'QUALIFIED_VIEW',
        kind: 'BONUS',
        productScope: 'WATCH',
        campaignId: f.campaignId || cands.data?.[0]?.id,
        bonusPoints: Number(f.bonus),
        fundingSource: 'BANK',
        fundingOrganizationId: orgId,
        fundingHalalasPerPoint: Number(f.perPoint),
        maxAllocationPoints: Number(f.max),
      },
      t('pt.watch.sent'),
    );
    if (r.ok) await res.reload();
  };
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <OwnedWatch orgId={orgId} />
      {cmd.banner}
      <Card>
        <h2 className="dd-title">{t('pt.watch.sponsored')}</h2>
        <Loaded res={res} empty={(d) => !d.length}>
          {(d) => (
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table" data-testid="pt-watch-table">
                <thead>
                  <tr>
                    <th>{t('pt.camp.detail')}</th>
                    <th>{t('pt.watch.paidViews')}</th>
                    <th>{t('pt.watch.budget')}</th>
                    <th>{t('pt.watch.spent')}</th>
                    <th>{t('pt.watch.pointsFunded')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.map((w) => (
                    <tr key={w.id}>
                      <td>
                        {locale === 'ar' ? w.titleAr : w.titleEn}
                        <div className="dd-muted">
                          {locale === 'ar' ? w.merchantNameAr : w.merchantNameEn}
                        </div>
                      </td>
                      <td>{formatNumber(locale, w.paidViews)}</td>
                      <td>{formatMoney(locale, w.requiredBudgetHalalas)}</td>
                      <td>{formatMoney(locale, w.spentHalalas)}</td>
                      <td>{formatNumber(locale, w.pointsFunded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
      </Card>
      {cands.data ? (
        <Card>
          <h2 className="dd-title">{t('pt.watch.available')}</h2>
          {cands.data.length ? (
            <div
              style={{
                display: 'grid',
                gap: 8,
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              }}
            >
              <Field label={t('pt.camp.detail')} htmlFor="w-camp">
                <Select
                  id="w-camp"
                  value={f.campaignId}
                  onChange={(e) => setF({ ...f, campaignId: e.target.value })}
                >
                  {cands.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {locale === 'ar'
                        ? `${c.titleAr} · ${c.merchantNameAr}`
                        : `${c.titleEn} · ${c.merchantNameEn}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('pt.watch.bonus')} htmlFor="w-bonus">
                <Input
                  id="w-bonus"
                  dir="ltr"
                  value={f.bonus}
                  onChange={(e) => setF({ ...f, bonus: e.target.value })}
                />
              </Field>
              <Field label={t('pt.watch.perPoint')} htmlFor="w-pp">
                <Input
                  id="w-pp"
                  dir="ltr"
                  value={f.perPoint}
                  onChange={(e) => setF({ ...f, perPoint: e.target.value })}
                />
              </Field>
              <Field label={t('pt.watch.max')} htmlFor="w-max">
                <Input
                  id="w-max"
                  dir="ltr"
                  value={f.max}
                  onChange={(e) => setF({ ...f, max: e.target.value })}
                />
              </Field>
              <div>
                <Button onClick={() => void sponsor()} loading={cmd.busy}>
                  {t('pt.watch.sponsor')}
                </Button>
              </div>
            </div>
          ) : (
            <p className="dd-muted">{t('pt.state.empty')}</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}

// ================================================================ performance drill-down
interface Perf {
  by: string;
  asOf: string | null;
  items: Array<{
    key: string;
    labelEn: string;
    labelAr: string;
    values: Record<string, number | null>;
    estimate: { expectedToDate: number; forecast: number } | null;
  }>;
}
const COLS = [
  'exclusive.verified_redemptions',
  'voucher.purchases',
  'voucher.sales_value',
  'watch.qualified_views',
  'watch.spend',
  'loyalty.points_issued',
  'live.member_benefit_redemptions',
];

export function PartnerPerformancePage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.perf.title')}
      intro={t('pt.perf.intro')}
      any={['partner.performance.read']}
      testId="pt-performance"
    >
      {(orgId) => <PerfInner orgId={orgId} />}
    </PartnerPage>
  );
}

function PerfInner({ orgId, exportOnly }: { orgId: string; exportOnly?: boolean }) {
  const { locale } = useAuth();
  const t = useT();
  const [by, setBy] = useState('CAMPAIGN');
  const [days, setDays] = useState('30');
  const res = useResource<Perf>(`${pbase(orgId)}/performance`, { by, days });
  const label = (key: string) => {
    const col = {
      'exclusive.verified_redemptions': 'pt.home.redemptions',
      'voucher.purchases': 'pt.product.VOUCHER',
      'voucher.sales_value': 'pt.home.voucherSales',
      'watch.qualified_views': 'pt.home.qualifiedViews',
      'watch.spend': 'pt.watch.spent',
      'loyalty.points_issued': 'pt.home.pointsIssued',
      'live.member_benefit_redemptions': 'pt.home.benefitUses',
    }[key]!;
    return t(col as 'pt.home.redemptions');
  };
  const fmt = (key: string, v: number | null | undefined) =>
    key.endsWith('value') || key.endsWith('spend')
      ? formatMoney(locale, v ?? 0)
      : formatNumber(locale, v ?? 0);
  const download = () => {
    if (!res.data) return;
    const header = ['group', ...COLS, 'expected_to_date_estimate', 'forecast_estimate'].join(',');
    const lines = res.data.items.map((i) =>
      [
        `"${(locale === 'ar' ? i.labelAr : i.labelEn).replace(/"/g, '""')}"`,
        ...COLS.map((c) => i.values[c] ?? 0),
        i.estimate?.expectedToDate ?? '',
        i.estimate?.forecast ?? '',
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `partner-performance-${by.toLowerCase()}.csv`;
    a.click();
  };
  return (
    <Card>
      <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label={t('pt.perf.by')} htmlFor="pf-by">
          <Select
            id="pf-by"
            value={by}
            onChange={(e) => setBy(e.target.value)}
            data-testid="pt-perf-by"
          >
            {PARTNER_DRILL_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t(k('pt.by', l))}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('pt.perf.days')} htmlFor="pf-days">
          <Select id="pf-days" value={days} onChange={(e) => setDays(e.target.value)}>
            {['7', '30', '90', '365'].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Button variant="secondary" onClick={download} data-testid="pt-perf-export">
          {t('pt.perf.export')}
        </Button>
      </div>
      {exportOnly ? null : (
        <Loaded res={res} empty={(d) => !d.items.length}>
          {(d) => (
            <div style={{ overflowX: 'auto', marginBlockStart: 12 }}>
              <table className="dd-table" data-testid="pt-perf-table">
                <thead>
                  <tr>
                    <th>{t(k('pt.by', d.by))}</th>
                    {COLS.map((c) => (
                      <th key={c}>{label(c)}</th>
                    ))}
                    <th>
                      {t('pt.perf.expected')} <span className="dd-muted">({t('pt.estimate')})</span>
                    </th>
                    <th>
                      {t('pt.perf.forecast')} <span className="dd-muted">({t('pt.estimate')})</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.key}>
                      <td>{locale === 'ar' ? i.labelAr : i.labelEn}</td>
                      {COLS.map((c) => (
                        <td key={c}>{fmt(c, i.values[c])}</td>
                      ))}
                      <td>{i.estimate ? formatNumber(locale, i.estimate.expectedToDate) : '—'}</td>
                      <td>{i.estimate ? formatNumber(locale, i.estimate.forecast) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="dd-muted">{t('pt.home.roiNote')}</p>
            </div>
          )}
        </Loaded>
      )}
    </Card>
  );
}

export function PartnerReportsPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.reports.title')}
      intro={t('pt.reports.intro')}
      any={['partner.reports.read']}
      testId="pt-reports"
    >
      {(orgId) => <PerfInner orgId={orgId} />}
    </PartnerPage>
  );
}

// ================================================================ finance (shared Phase 5 billing + shared commercial cases)
export function PartnerFinancePage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.fin.title')}
      intro={t('pt.fin.intro')}
      any={['partner.finance.read', 'partner.commercial.read']}
      testId="pt-finance"
    >
      {(orgId) => <FinanceInner orgId={orgId} />}
    </PartnerPage>
  );
}

function FinanceInner({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const perms = usePerms();
  const tabs = [
    ...(perms.includes('partner.finance.read')
      ? [{ id: 'billing', label: t('pt.fin.tab.billing') }]
      : []),
    ...(perms.includes('partner.commercial.read')
      ? [{ id: 'commercial', label: t('pt.fin.tab.commercial') }]
      : []),
  ];
  const [tab, setTab] = useState(tabs[0]?.id ?? 'billing');
  const cases = useResource<
    Array<{
      id: string;
      reference: string;
      product: string;
      status: string;
      title: { en: string; ar: string } | null;
      maxCashHalalas?: number;
    }>
  >(tab === 'commercial' ? `${pbase(orgId)}/commercial/cases` : null);
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <Tabs tabs={tabs} value={tab} onChange={setTab} label={t('pt.fin.title')} />
      {tab === 'billing' ? (
        <BillingWorkspace orgId={orgId} canManage={perms.includes('partner.finance.manage')} />
      ) : null}
      {tab === 'commercial' ? (
        <Card>
          <Loaded res={cases} empty={(d) => !d.length}>
            {(d) => (
              <table className="dd-table" data-testid="pt-fin-cases">
                <tbody>
                  {d.map((c) => (
                    <tr key={c.id}>
                      <td className="dd-ltr">{c.reference}</td>
                      <td>{t(k('pt.product', c.product))}</td>
                      <td>{c.title ? (locale === 'ar' ? c.title.ar : c.title.en) : ''}</td>
                      <td>
                        <Chip v={c.status} label={t(k('cm.status', c.status))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Loaded>
        </Card>
      ) : null}
    </div>
  );
}

// ================================================================ integrations (shared integration framework)
interface Conn {
  id: string;
  name: string;
  sourceSystem: string;
  kind: string;
  status: string;
  keyPrefix?: string;
}

export function PartnerIntegrationsPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.int.title')}
      intro={t('pt.int.intro')}
      any={['partner.integrations.manage', 'partner.imports.manage']}
      testId="pt-integrations"
    >
      {(orgId) => <IntegrationsInner orgId={orgId} />}
    </PartnerPage>
  );
}

function IntegrationsInner({ orgId }: { orgId: string }) {
  const t = useT();
  const perms = usePerms();
  const canManage = perms.includes('partner.integrations.manage');
  const conns = useResource<Conn[]>(canManage ? `/v1/orgs/${orgId}/integrations` : null);
  const cmd = useCmd();
  const [f, setF] = useState({ name: '', sourceSystem: '', kind: 'API_PUSH' });
  const [key, setKey] = useState<string | null>(null);
  const create = async () => {
    setKey(null);
    const r = await cmd.run<{ apiKey: string }>('POST', `${pbase(orgId)}/integrations`, {
      ...f,
      scopes: ['MERCHANT', 'BRANCH', 'OFFER'],
    });
    if (r.ok && r.data) {
      setKey(r.data.apiKey);
      await conns.reload();
    }
  };
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      {cmd.banner}
      {key ? (
        <div data-testid="pt-int-key">
          <Alert tone="warning">
            {t('pt.int.keyOnce')} <code className="dd-ltr">{key}</code>
          </Alert>
        </div>
      ) : null}
      {canManage ? (
        <Card>
          <h2 className="dd-title">{t('pt.int.new')}</h2>
          <div
            style={{
              display: 'grid',
              gap: 8,
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            }}
          >
            <Field label={t('pt.int.name')} htmlFor="i-name">
              <Input
                id="i-name"
                value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })}
              />
            </Field>
            <Field label={t('pt.int.sourceSystem')} htmlFor="i-src">
              <Input
                id="i-src"
                dir="ltr"
                value={f.sourceSystem}
                onChange={(e) => setF({ ...f, sourceSystem: e.target.value })}
              />
            </Field>
            <Field label={t('pt.int.kind')} htmlFor="i-kind">
              <Select
                id="i-kind"
                value={f.kind}
                onChange={(e) => setF({ ...f, kind: e.target.value })}
              >
                <option value="API_PUSH">API</option>
                <option value="FEED_PULL">Feed</option>
                <option value="WEBHOOK">Webhook</option>
              </Select>
            </Field>
          </div>
          <Button
            onClick={() => void create()}
            loading={cmd.busy}
            disabled={!f.name || !f.sourceSystem}
            style={{ marginBlockStart: 8 }}
            data-testid="pt-int-create"
          >
            {t('pt.int.create')}
          </Button>
        </Card>
      ) : null}
      {canManage ? (
        <Card>
          <h2 className="dd-title">{t('pt.int.connections')}</h2>
          <Loaded res={conns} empty={(d) => !d.length}>
            {(d) => (
              <table className="dd-table" data-testid="pt-int-table">
                <tbody>
                  {d.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td className="dd-ltr">{c.sourceSystem}</td>
                      <td className="dd-ltr">{c.kind}</td>
                      <td>
                        <Chip v={c.status} label={c.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Loaded>
        </Card>
      ) : null}
      <IntegrationsPanel path={`/v1/orgs/${orgId}/integration-health`} />
    </div>
  );
}

// ================================================================ alerts, tasks, copilot, loyalty, settings (shared workspaces)
export function PartnerAlertsPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.alerts.title')}
      intro={t('pt.alerts.intro')}
      any={['partner.performance.read', 'partner.alerts.manage']}
      testId="pt-alerts"
    >
      {(orgId) => <AlertsInner orgId={orgId} />}
    </PartnerPage>
  );
}

function AlertsInner({ orgId }: { orgId: string }) {
  const { call } = useApi();
  const res = useResource<AlertView[]>(`/v1/orgs/${orgId}/alerts`);
  const act = async (a: AlertView, s: 'acknowledge' | 'resolve') => {
    await call('POST', `/v1/orgs/${orgId}/alerts/${a.id}/${s}`, { body: {}, idempotent: true });
    await res.reload();
  };
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <Card>
        <Loaded res={res} empty={(d) => !d.length}>
          {(d) => (
            <div className="dd-stack" style={{ gap: 8 }} data-testid="pt-alert-list">
              {d.map((a) => (
                <AlertRow key={a.id} a={a} onAction={act} />
              ))}
            </div>
          )}
        </Loaded>
      </Card>
      <PreferencesPanel />
    </div>
  );
}

export function PartnerTasksPage() {
  const t = useT();
  const perms = usePerms();
  const tabs: OpsTab[] = ['inbox'];
  if (perms.includes('partner.disputes.manage')) tabs.push('cases');
  if (perms.includes('partner.activity.read')) tabs.push('activity');
  return (
    <PartnerPage
      title={t('pt.tasks.title')}
      any={['partner.campaigns.read', 'partner.disputes.manage', 'partner.commercial.read']}
      testId="pt-tasks"
    >
      {(orgId) => (
        <OperationsWorkspace
          scope={{ audience: 'org', orgId }}
          tabs={tabs}
          canManageCases={perms.includes('partner.disputes.manage')}
        />
      )}
    </PartnerPage>
  );
}

export function PartnerAssistantPage() {
  const t = useT();
  const perms = usePerms();
  const canApprove = perms.includes('partner.ai.approve');
  return (
    <PartnerPage
      title={t('pt.ai.title')}
      intro={t('pt.ai.intro')}
      any={['partner.ai.use']}
      module="AI_COPILOT"
      testId="pt-assistant"
    >
      {(orgId) => (
        <div className="dd-stack" style={{ gap: 16 }}>
          <AiAssistantPanel
            askPath={`/v1/orgs/${orgId}/ai/ask`}
            draftsBase={`/v1/orgs/${orgId}/ai/drafts`}
            canApprove={canApprove}
            examples={['ai.ex.performance', 'ai.ex.targets', 'ai.ex.plan']}
          />
          <AiDraftsList path={`/v1/orgs/${orgId}/ai/drafts`} canApprove={canApprove} />
        </div>
      )}
    </PartnerPage>
  );
}

export function PartnerLoyaltyPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('nav.loyalty')}
      any={['partner.loyalty.manage']}
      module="LOYALTY"
      testId="pt-loyalty"
    >
      {(orgId) => (
        <LoyaltyWorkspace
          scope={{ audience: 'org', orgId }}
          canManage
          canApprove={false}
          fundingOptions={['BANK', 'SCHEME', 'CORPORATE', 'SPONSOR', 'CAMPAIGN']}
        />
      )}
    </PartnerPage>
  );
}

export function PartnerSettingsPage() {
  const t = useT();
  const perms = usePerms();
  return (
    <PartnerPage title={t('pt.settings.title')} any={['partner.profile.read']} testId="pt-settings">
      {(orgId) => (
        <div className="dd-stack" style={{ gap: 16 }}>
          {perms.includes('partner.subscription.read') ? (
            <Card>
              <h2 className="dd-title">{t('pt.settings.plan')}</h2>
              <PlanUsageWorkspace
                orgId={orgId}
                canManage={perms.includes('partner.subscription.manage')}
                canAccept={perms.includes('partner.commercial.accept')}
              />
            </Card>
          ) : null}
          <PreferencesPanel />
        </div>
      )}
    </PartnerPage>
  );
}
