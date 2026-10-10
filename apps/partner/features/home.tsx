'use client';

import Link from 'next/link';
import { useAuth, useResource } from '@dealdash/app-shell';
import { formatDateTime, formatNumber, withLocale } from '@dealdash/localization';
import { Alert, Card, KeyValue } from '@dealdash/ui';
import { Chip, Loaded, PartnerPage, k, pbase, useMoney, useT, type ModuleRow } from './utils';

interface Home {
  partner: {
    organizationId: string;
    nameEn: string;
    nameAr: string;
    partnerType: string;
    lifecycle: string;
  };
  readiness: { state: string; missing: string[] };
  modules: ModuleRow[];
  markets: Array<{ code: string; nameEn: string; nameAr: string; status: string; open: boolean }>;
  network: { total: number; referenced: number; registered: number };
  campaigns: {
    total: number;
    active: number;
    created: number;
    sponsored: number;
    loyaltyRules: number;
    benefits: number;
  };
  performance: {
    windowDays: number;
    asOf: string | null;
    values: Record<string, number | null>;
    roi: null;
  };
  funding: {
    committedHalalas: number;
    receivedHalalas: number;
    utilizedHalalas: number;
    remainingHalalas: number;
  };
  invoices: { open: number; overdue: number; outstandingHalalas: number };
  purchaseOrders: { count: number; totalHalalas: number; usedHalalas: number };
  credit: {
    limitHalalas: number;
    exposureHalalas: number;
    availableHalalas: number;
    active: boolean;
  };
  alerts: {
    open: number;
    latest: Array<{ id: string; code: string; severity: string; createdAt: string }>;
  };
  integrations: Array<{
    id: string;
    name: string;
    status: string;
    stale: boolean;
    errorCount: number;
  }>;
  tasks: { open: number; latest: Array<{ kind: string; title: string; subject: string | null }> };
}

/** Executive overview: everything here comes from the shared platform services, for the markets the user may see. */
export function PartnerHome() {
  const t = useT();
  return (
    <PartnerPage title={t('pt.home.title')} any={['partner.profile.read']} testId="pt-home">
      {(orgId) => <HomeInner orgId={orgId} />}
    </PartnerPage>
  );
}

function Kpi({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <Card flat>
      <div className="dd-muted" style={{ fontSize: 13 }}>
        {label}
      </div>
      <div className="dd-title" data-testid={testId}>
        {value}
      </div>
    </Card>
  );
}

function HomeInner({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const money = useMoney();
  const res = useResource<Home>(`${pbase(orgId)}/home`);
  const n = (v: number | null | undefined) => formatNumber(locale, v ?? 0);
  return (
    <Loaded res={res}>
      {(h) => (
        <div className="dd-stack" style={{ gap: 16 }}>
          <Card>
            <div
              className="dd-row"
              style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}
            >
              <div>
                <h2 className="dd-title" style={{ margin: 0 }}>
                  {locale === 'ar' ? h.partner.nameAr : h.partner.nameEn}
                </h2>
                <span className="dd-muted">{t(k('pt.type', h.partner.partnerType))}</span>
              </div>
              <Chip
                v={h.partner.lifecycle}
                label={t(k('pt.life', h.partner.lifecycle))}
                testId="pt-home-lifecycle"
              />
            </div>
            {h.readiness.missing.length ? (
              <div style={{ marginBlockStart: 12 }} data-testid="pt-home-readiness">
                <Alert
                  tone={h.partner.lifecycle === 'ACTIVE' ? 'info' : 'warning'}
                  title={
                    h.partner.lifecycle === 'ACTIVE'
                      ? t('pt.home.attention')
                      : t('pt.home.readiness')
                  }
                >
                  {h.partner.lifecycle === 'ACTIVE' ? '' : `${t('pt.home.readinessHint')} `}
                  {h.readiness.missing.map((m) => t(k('pt.check', m))).join(' · ')}{' '}
                  <Link href={withLocale('/organization', locale)}>{t('pt.open')}</Link>
                </Alert>
              </div>
            ) : null}
          </Card>

          <div
            className="dd-grid-cards"
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            }}
          >
            <Kpi
              label={t('pt.home.markets')}
              value={
                h.markets
                  .filter((m) => m.open)
                  .map((m) => m.code)
                  .join(', ') || '—'
              }
              testId="pt-kpi-markets"
            />
            <Kpi
              label={t('pt.home.activeCampaigns')}
              value={`${n(h.campaigns.active)} / ${n(h.campaigns.total)}`}
              testId="pt-kpi-campaigns"
            />
            <Kpi label={t('pt.home.network')} value={n(h.network.total)} testId="pt-kpi-network" />
            <Kpi label={t('pt.camp.benefits')} value={n(h.campaigns.benefits)} />
          </div>
          <p className="dd-muted" style={{ margin: 0 }}>
            {t('pt.home.networkSplit', {
              referenced: n(h.network.referenced),
              registered: n(h.network.registered),
            })}
          </p>

          <Card>
            <h2 className="dd-title">{t('pt.home.performance')}</h2>
            <div
              style={{
                display: 'grid',
                gap: 12,
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              }}
              data-testid="pt-home-perf"
            >
              <Kpi
                label={t('pt.home.redemptions')}
                value={n(h.performance.values['exclusive.verified_redemptions'])}
              />
              <Kpi
                label={t('pt.home.voucherSales')}
                value={money(h.performance.values['voucher.sales_value'] ?? 0)}
              />
              <Kpi
                label={t('pt.home.qualifiedViews')}
                value={n(h.performance.values['watch.qualified_views'])}
              />
              <Kpi
                label={t('pt.home.pointsIssued')}
                value={n(h.performance.values['loyalty.points_issued'])}
              />
              <Kpi
                label={t('pt.home.benefitUses')}
                value={n(h.performance.values['live.member_benefit_redemptions'])}
              />
            </div>
            <p className="dd-muted" style={{ marginBlockEnd: 0 }}>
              {h.performance.asOf
                ? `${t('pt.asOf', { time: formatDateTime(locale, h.performance.asOf) })} · `
                : ''}
              {t('pt.home.roiNote')}
            </p>
          </Card>

          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            }}
          >
            <Card>
              <h2 className="dd-title">{t('pt.home.funding')}</h2>
              <KeyValue
                items={[
                  { label: t('pt.home.committed'), value: money(h.funding.committedHalalas) },
                  { label: t('pt.home.received'), value: money(h.funding.receivedHalalas) },
                  { label: t('pt.home.utilized'), value: money(h.funding.utilizedHalalas) },
                  { label: t('pt.home.remaining'), value: money(h.funding.remainingHalalas) },
                ]}
              />
            </Card>
            <Card>
              <h2 className="dd-title">{t('pt.home.invoices')}</h2>
              <KeyValue
                items={[
                  {
                    label: t('pt.home.invoices'),
                    value: t('pt.home.openInvoices', {
                      n: n(h.invoices.open),
                      overdue: n(h.invoices.overdue),
                    }),
                  },
                  { label: t('pt.home.outstanding'), value: money(h.invoices.outstandingHalalas) },
                  {
                    label: t('pt.home.po'),
                    value: t('pt.home.poUse', {
                      used: money(h.purchaseOrders.usedHalalas),
                      total: money(h.purchaseOrders.totalHalalas),
                    }),
                  },
                  {
                    label: t('pt.home.credit'),
                    value: h.credit.active
                      ? t('pt.home.creditUse', {
                          used: money(h.credit.exposureHalalas),
                          available: money(h.credit.availableHalalas),
                        })
                      : t('pt.home.noCredit'),
                  },
                ]}
              />
            </Card>
            <Card>
              <h2 className="dd-title">
                {t('pt.home.alerts')} · {n(h.alerts.open)}
              </h2>
              <h3 className="dd-muted" style={{ fontSize: 14 }}>
                {t('pt.home.tasks')} · {n(h.tasks.open)}
              </h3>
              <Link href={withLocale('/tasks', locale)}>{t('pt.open')}</Link>
            </Card>
            <Card>
              <h2 className="dd-title">{t('pt.home.integrations')}</h2>
              {h.integrations.length ? (
                <ul className="dd-list" style={{ margin: 0, paddingInlineStart: 18 }}>
                  {h.integrations.map((i) => (
                    <li key={i.id}>
                      {i.name} ·{' '}
                      <Chip
                        v={i.stale ? 'VALIDATION_REQUIRED' : 'OK'}
                        label={i.stale ? t('pt.home.stale') : t('pt.home.healthy')}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dd-muted">{t('pt.home.noIntegrations')}</p>
              )}
            </Card>
          </div>

          <Card>
            <h2 className="dd-title">{t('pt.home.modules')}</h2>
            <div
              className="dd-row"
              style={{ flexWrap: 'wrap', gap: 8 }}
              data-testid="pt-home-modules"
            >
              {h.modules
                .filter((m) => m.offered)
                .map((m) => (
                  <span key={m.module} title={m.entitled ? undefined : t('pt.home.moduleOff')}>
                    <Chip
                      v={m.entitled ? 'OK' : 'DRAFT'}
                      label={`${t(k('pt.module', m.module))}${m.entitled ? '' : ` · ${t('pt.home.moduleOff')}`}`}
                    />
                  </span>
                ))}
            </div>
          </Card>
        </div>
      )}
    </Loaded>
  );
}
