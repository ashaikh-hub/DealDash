'use client';

import Link from 'next/link';
import { useState } from 'react';
import { RequireAuth, RequirePermission, useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, formatDate, withLocale } from '@dealdash/localization';
import { Alert, Button, Card, Field, Input, KeyValue, StatusChip, Textarea } from '@dealdash/ui';
import { ApplicationProvider, useApplication } from './application-context';
import { useCommand } from './forms';

// ------------------------------------------------------------------ dashboard
export function MerchantHome() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  return (
    <RequireAuth
      footer={
        <Card>
          <div className="dd-stack">
            <h2 className="dd-title">{t('home.newHere')}</h2>
            <p className="dd-muted">{t('home.newHereBody')}</p>
            <Link
              className="dd-btn dd-btn--secondary"
              href={withLocale('/signup', locale)}
              style={{ alignSelf: 'flex-start' }}
            >
              {t('home.createAccount')}
            </Link>
          </div>
        </Card>
      }
    >
      <Dashboard />
    </RequireAuth>
  );
}

function Dashboard() {
  const { me, locale } = useAuth();
  const t = createTranslator(locale);
  const m = me?.activeMembership;
  if (!m) return <Alert tone="warning">{t('shell.noAccess')}</Alert>;
  const status = m.organizationStatus;
  const tile = (href: string, title: string, body: string) => (
    <Link href={withLocale(href, locale)} style={{ textDecoration: 'none', color: 'inherit' }}>
      <Card>
        <div className="dd-stack">
          <h3 className="dd-title">{title}</h3>
          <p className="dd-muted">{body}</p>
        </div>
      </Card>
    </Link>
  );
  return (
    <div className="dd-stack">
      <h1 className="dd-title-xl">{t('home.welcome', { name: m.organizationName[locale] })}</h1>
      <div className="dd-row">
        <StatusChip
          tone={status === 'ACTIVE' ? 'success' : status === 'SUSPENDED' ? 'danger' : 'warning'}
        >
          {status === 'ACTIVE'
            ? t('status.active')
            : status === 'SUSPENDED'
              ? t('status.suspended')
              : t('home.onboarding')}
        </StatusChip>
        <StatusChip tone="info">{t(`role.${m.roleCode}` as never)}</StatusChip>
      </div>
      {status === 'DRAFT' ? (
        <Alert tone="info" title={t('home.finishTitle')}>
          {t('home.finishBody')}
        </Alert>
      ) : null}
      {status === 'SUSPENDED' ? <Alert tone="danger">{t('status.suspendedBanner')}</Alert> : null}
      <div className="dd-grid dd-grid--2">
        {me?.permissions.includes('merchant.application.manage')
          ? tile('/onboarding', t('nav.application'), t('home.applicationBody'))
          : null}
        {status === 'ACTIVE' && me?.permissions.includes('merchant.branch.read')
          ? tile('/branches', t('nav.branches'), t('home.branchesBody'))
          : null}
        {status === 'ACTIVE' && me?.permissions.includes('merchant.users.manage')
          ? tile('/team', t('nav.team'), t('home.teamBody'))
          : null}
        {tile('/profile', t('nav.profile'), t('home.profileBody'))}
      </div>
      <Card>
        <p className="dd-muted">{t('home.laterStages')}</p>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ profile
function ProfileBody() {
  const { app, orgId } = useApplication();
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const cmd = useCommand();
  const b = app.business;
  const canWrite =
    me?.permissions.includes('merchant.profile.write') && app.organizationStatus === 'ACTIVE';
  const [saved, setSaved] = useState(false);
  const [f, setF] = useState({
    tradeNameEn: b.tradeNameEn ?? '',
    tradeNameAr: b.tradeNameAr ?? '',
    descriptionEn: b.descriptionEn ?? '',
    descriptionAr: b.descriptionAr ?? '',
    businessPhone: b.businessPhone ?? '',
    businessEmail: b.businessEmail ?? '',
  });

  async function save() {
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim() !== ''));
    const res = await cmd.exec(() => call('PATCH', `/v1/merchants/${orgId}/profile`, { body }));
    setSaved(res.ok);
  }

  return (
    <div className="dd-stack">
      <Card>
        <div className="dd-stack">
          <h2 className="dd-title">{t('profile.legal')}</h2>
          <p className="dd-caption">{t('profile.legalNote')}</p>
          <KeyValue
            items={[
              { label: t('biz.legalNameEn'), value: b.legalNameEn },
              { label: t('biz.legalNameAr'), value: b.legalNameAr },
              {
                label: t('biz.crNumber'),
                value: <span className="dd-ltr">{b.commercialRegistrationNumber}</span>,
              },
              { label: t('biz.taxNumber'), value: <span className="dd-ltr">{b.taxNumber}</span> },
              { label: t('biz.registeredAddress'), value: b.registeredAddress },
              {
                label: t('settle.iban'),
                value: <span className="dd-ltr">{app.settlement?.ibanMasked}</span>,
              },
              {
                label: t('profile.agreement'),
                value: app.agreement.acceptance
                  ? t('agreement.version', { version: app.agreement.acceptance.agreementVersion }) +
                    ' · ' +
                    formatDate(locale, app.agreement.acceptance.acceptedAt)
                  : '-',
              },
            ]}
          />
        </div>
      </Card>
      <Card>
        <div className="dd-stack">
          <h2 className="dd-title">{t('profile.public')}</h2>
          {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
          {saved ? <Alert tone="success">{t('common.saved')}</Alert> : null}
          <div className="dd-grid dd-grid--2">
            <Field label={t('biz.tradeNameEn')} htmlFor="pf-en">
              <Input
                id="pf-en"
                value={f.tradeNameEn}
                onChange={(e) => setF({ ...f, tradeNameEn: e.target.value })}
                disabled={!canWrite}
              />
            </Field>
            <Field label={t('biz.tradeNameAr')} htmlFor="pf-ar">
              <Input
                id="pf-ar"
                dir="rtl"
                value={f.tradeNameAr}
                onChange={(e) => setF({ ...f, tradeNameAr: e.target.value })}
                disabled={!canWrite}
              />
            </Field>
            <Field label={t('category.descriptionEn')} htmlFor="pf-den">
              <Textarea
                id="pf-den"
                value={f.descriptionEn}
                onChange={(e) => setF({ ...f, descriptionEn: e.target.value })}
                disabled={!canWrite}
              />
            </Field>
            <Field label={t('category.descriptionAr')} htmlFor="pf-dar">
              <Textarea
                id="pf-dar"
                dir="rtl"
                value={f.descriptionAr}
                onChange={(e) => setF({ ...f, descriptionAr: e.target.value })}
                disabled={!canWrite}
              />
            </Field>
            <Field label={t('biz.phone')} htmlFor="pf-ph">
              <Input
                id="pf-ph"
                dir="ltr"
                value={f.businessPhone}
                onChange={(e) => setF({ ...f, businessPhone: e.target.value })}
                disabled={!canWrite}
              />
            </Field>
            <Field label={t('biz.email')} htmlFor="pf-em">
              <Input
                id="pf-em"
                dir="ltr"
                value={f.businessEmail}
                onChange={(e) => setF({ ...f, businessEmail: e.target.value })}
                disabled={!canWrite}
              />
            </Field>
          </div>
          {canWrite ? (
            <div>
              <Button loading={cmd.busy} onClick={() => void save()}>
                {t('common.save')}
              </Button>
            </div>
          ) : (
            <p className="dd-caption">{t('profile.readOnly')}</p>
          )}
        </div>
      </Card>
    </div>
  );
}

export function ProfilePage() {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const m = me?.activeMembership;
  return (
    <RequirePermission any={['merchant.profile.read']}>
      <div className="dd-stack">
        <h1 className="dd-title-xl">{t('nav.profile')}</h1>
        {m ? (
          <Card>
            <KeyValue
              items={[
                { label: t('profile.name'), value: m.organizationName[locale] },
                { label: t('team.role'), value: t(`role.${m.roleCode}` as never) },
                {
                  label: t('team.status'),
                  value: (
                    <StatusChip
                      tone={
                        m.organizationStatus === 'ACTIVE'
                          ? 'success'
                          : m.organizationStatus === 'SUSPENDED'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {m.organizationStatus === 'ACTIVE'
                        ? t('status.active')
                        : m.organizationStatus === 'SUSPENDED'
                          ? t('status.suspended')
                          : t('home.onboarding')}
                    </StatusChip>
                  ),
                },
              ]}
            />
          </Card>
        ) : null}
        {me?.permissions.includes('merchant.application.manage') ? (
          <ApplicationProvider>
            <ProfileBody />
          </ApplicationProvider>
        ) : null}
      </div>
    </RequirePermission>
  );
}
