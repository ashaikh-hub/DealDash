'use client';

import { useEffect, useState } from 'react';
import { useAuth, useResource } from '@dealdash/app-shell';
import { formatDateTime } from '@dealdash/localization';
import { Alert, Button, Card, Field, Input, Textarea } from '@dealdash/ui';
import { Chip, Loaded, PartnerPage, csvList, k, pbase, useCmd, usePerms, useT } from './utils';

interface Contact {
  name: string;
  email: string;
  phone?: string;
  title?: string;
}
interface Profile {
  organizationId: string;
  partnerType: string;
  lifecycle: string;
  legalName: string;
  registrationNumber: string | null;
  taxNumber: string | null;
  website: string | null;
  parentGroup: string | null;
  description: string | null;
  requestedMarkets: string[];
  contacts: { primary?: Contact; finance?: Contact };
  signatory: (Contact & { authorityRef?: string }) | null;
  lifecycleReason: string | null;
}
interface Readiness {
  state: string;
  lifecycle: string;
  items: Array<{ check: string; state: string; detail: string }>;
}
interface Market {
  code: string;
  nameEn: string;
  nameAr: string;
  status: string;
  open: boolean;
  currency: string;
  legalEntities: Array<{ id: string; legalName: string; currency: string }>;
}
interface History {
  id: string;
  action: string;
  at: string;
  actorRole: string | null;
  reason: string | null;
  newState: unknown;
}

/** Organization / legal entities and onboarding: the partner keeps its profile, sees the live checklist and submits for review. */
export function PartnerOrganizationPage() {
  const t = useT();
  return (
    <PartnerPage title={t('pt.org.title')} any={['partner.profile.read']} testId="pt-organization">
      {(orgId) => <OrgInner orgId={orgId} />}
    </PartnerPage>
  );
}

const blank: Contact = { name: '', email: '' };

function OrgInner({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const perms = usePerms();
  const canEdit = perms.includes('partner.profile.write');
  const profile = useResource<Profile>(`${pbase(orgId)}/profile`);
  const readiness = useResource<Readiness>(`${pbase(orgId)}/readiness`);
  const markets = useResource<Market[]>(`${pbase(orgId)}/markets`);
  const history = useResource<History[]>(
    perms.includes('partner.activity.read') ? `${pbase(orgId)}/history` : null,
  );
  const cmd = useCmd();
  const [form, setForm] = useState({
    legalName: '',
    registrationNumber: '',
    taxNumber: '',
    website: '',
    parentGroup: '',
    description: '',
    markets: '',
    primary: blank,
    finance: blank,
    signatory: { ...blank, authorityRef: '' },
  });
  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    setForm({
      legalName: p.legalName,
      registrationNumber: p.registrationNumber ?? '',
      taxNumber: p.taxNumber ?? '',
      website: p.website ?? '',
      parentGroup: p.parentGroup ?? '',
      description: p.description ?? '',
      markets: p.requestedMarkets.join(', '),
      primary: { ...blank, ...(p.contacts.primary ?? {}) },
      finance: { ...blank, ...(p.contacts.finance ?? {}) },
      signatory: { ...blank, authorityRef: '', ...(p.signatory ?? {}) },
    });
  }, [profile.data]);
  const locked = profile.data
    ? !['DRAFT', 'CHANGES_REQUESTED'].includes(profile.data.lifecycle)
    : false;
  const contact = (c: Contact) =>
    c.name && c.email
      ? {
          name: c.name,
          email: c.email,
          ...(c.phone ? { phone: c.phone } : {}),
          ...(c.title ? { title: c.title } : {}),
        }
      : undefined;
  const save = async () => {
    const r = await cmd.run(
      'PUT',
      `${pbase(orgId)}/profile`,
      {
        legalName: form.legalName,
        registrationNumber: form.registrationNumber || undefined,
        taxNumber: form.taxNumber || undefined,
        website: form.website || undefined,
        parentGroup: form.parentGroup || undefined,
        description: form.description || undefined,
        requestedMarkets: csvList(form.markets).map((m) => m.toUpperCase()),
        contacts: {
          primary: contact(form.primary) ?? { name: form.primary.name, email: form.primary.email },
          ...(contact(form.finance) ? { finance: contact(form.finance) } : {}),
        },
        ...(contact(form.signatory)
          ? {
              signatory: {
                ...contact(form.signatory),
                ...(form.signatory.authorityRef
                  ? { authorityRef: form.signatory.authorityRef }
                  : {}),
              },
            }
          : {}),
      },
      t('pt.saved'),
    );
    if (r.ok) await Promise.all([profile.reload(), readiness.reload()]);
  };
  const submit = async () => {
    const r = await cmd.run('POST', `${pbase(orgId)}/onboarding/submit`, {}, t('pt.org.submitted'));
    if (r.ok) await Promise.all([profile.reload(), readiness.reload()]);
  };
  const contactFields = (key: 'primary' | 'finance' | 'signatory', label: string) => (
    <fieldset className="dd-stack" style={{ gap: 8, border: 0, padding: 0 }}>
      <legend className="dd-muted">{label}</legend>
      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <Field label={t('pt.name')} htmlFor={`${key}-name`}>
          <Input
            id={`${key}-name`}
            value={form[key].name}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, [key]: { ...form[key], name: e.target.value } })}
          />
        </Field>
        <Field label={t('pt.email')} htmlFor={`${key}-email`}>
          <Input
            id={`${key}-email`}
            dir="ltr"
            value={form[key].email}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, [key]: { ...form[key], email: e.target.value } })}
          />
        </Field>
        <Field label={t('pt.titleField')} htmlFor={`${key}-title`}>
          <Input
            id={`${key}-title`}
            value={form[key].title ?? ''}
            disabled={!canEdit}
            onChange={(e) => setForm({ ...form, [key]: { ...form[key], title: e.target.value } })}
          />
        </Field>
      </div>
    </fieldset>
  );
  return (
    <div className="dd-stack" style={{ gap: 16 }}>
      {cmd.banner}
      <Card>
        <Loaded res={readiness}>
          {(r) => (
            <div className="dd-stack" style={{ gap: 10 }} data-testid="pt-readiness">
              <div
                className="dd-row"
                style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}
              >
                <h2 className="dd-title" style={{ margin: 0 }}>
                  {t('pt.org.readiness')}
                </h2>
                <span className="dd-row" style={{ gap: 6 }}>
                  <Chip
                    v={r.lifecycle}
                    label={`${t('pt.org.lifecycle')}: ${t(k('pt.life', r.lifecycle))}`}
                    testId="pt-lifecycle"
                  />
                  <Chip v={r.state} label={t(k('pt.ready', r.state))} testId="pt-readiness-state" />
                </span>
              </div>
              <p className="dd-muted" style={{ margin: 0 }}>
                {t('pt.org.readinessIntro')}
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table className="dd-table">
                  <tbody>
                    {r.items.map((i) => (
                      <tr key={i.check} data-testid={`pt-check-${i.check}`}>
                        <td>{t(k('pt.check', i.check))}</td>
                        <td>
                          <Chip v={i.state} label={t(k('pt.cstate', i.state))} />
                        </td>
                        <td className="dd-muted">{i.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit && ['DRAFT', 'CHANGES_REQUESTED'].includes(r.lifecycle) ? (
                <div>
                  <Button
                    onClick={() => void submit()}
                    loading={cmd.busy}
                    data-testid="pt-submit-onboarding"
                  >
                    {t('pt.org.submit')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Loaded>
      </Card>

      <Card>
        <h2 className="dd-title">{t('pt.org.profile')}</h2>
        {locked ? <Alert tone="info">{t('pt.org.locked')}</Alert> : null}
        <Loaded res={profile}>
          {() => (
            <div className="dd-stack" style={{ gap: 10 }} data-testid="pt-profile-form">
              <div
                style={{
                  display: 'grid',
                  gap: 8,
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                }}
              >
                <Field label={t('pt.org.legalName')} htmlFor="p-legal" error={cmd.fields.legalName}>
                  <Input
                    id="p-legal"
                    value={form.legalName}
                    disabled={!canEdit || locked}
                    onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                  />
                </Field>
                <Field label={t('pt.org.registration')} htmlFor="p-reg">
                  <Input
                    id="p-reg"
                    dir="ltr"
                    value={form.registrationNumber}
                    disabled={!canEdit || locked}
                    onChange={(e) => setForm({ ...form, registrationNumber: e.target.value })}
                  />
                </Field>
                <Field label={t('pt.org.taxNumber')} htmlFor="p-tax">
                  <Input
                    id="p-tax"
                    dir="ltr"
                    value={form.taxNumber}
                    disabled={!canEdit || locked}
                    onChange={(e) => setForm({ ...form, taxNumber: e.target.value })}
                  />
                </Field>
                <Field label={t('pt.org.website')} htmlFor="p-web">
                  <Input
                    id="p-web"
                    dir="ltr"
                    value={form.website}
                    disabled={!canEdit}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                  />
                </Field>
                <Field label={t('pt.org.parentGroup')} htmlFor="p-group">
                  <Input
                    id="p-group"
                    value={form.parentGroup}
                    disabled={!canEdit}
                    onChange={(e) => setForm({ ...form, parentGroup: e.target.value })}
                  />
                </Field>
                <Field
                  label={t('pt.org.requestedMarkets')}
                  htmlFor="p-markets"
                  help={t('pt.org.requestedMarketsHelp')}
                  error={cmd.fields.requestedMarkets}
                >
                  <Input
                    id="p-markets"
                    dir="ltr"
                    value={form.markets}
                    disabled={!canEdit}
                    onChange={(e) => setForm({ ...form, markets: e.target.value })}
                  />
                </Field>
              </div>
              <Field
                label={t('pt.org.description')}
                htmlFor="p-desc"
                error={cmd.fields.description}
              >
                <Textarea
                  id="p-desc"
                  value={form.description}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={2}
                />
              </Field>
              {contactFields('primary', t('pt.org.primaryContact'))}
              {contactFields('finance', t('pt.org.financeContact'))}
              {contactFields('signatory', t('pt.org.signatory'))}
              {canEdit ? (
                <div>
                  <Button
                    onClick={() => void save()}
                    loading={cmd.busy}
                    data-testid="pt-profile-save"
                  >
                    {t('pt.save')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Loaded>
      </Card>

      <Card>
        <h2 className="dd-title">{t('pt.org.marketsTitle')}</h2>
        <Loaded res={markets} empty={(d) => !d.length}>
          {(ms) => (
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table" data-testid="pt-markets">
                <thead>
                  <tr>
                    <th>{t('pt.market')}</th>
                    <th>{t('pt.status')}</th>
                    <th>{t('pt.org.currency')}</th>
                    <th>{t('pt.org.legalEntities')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ms.map((m) => (
                    <tr key={m.code} data-testid={`pt-market-${m.code}`}>
                      <td>
                        {locale === 'ar' ? m.nameAr : m.nameEn}{' '}
                        <span className="dd-muted dd-ltr">{m.code}</span>
                      </td>
                      <td>
                        <Chip
                          v={m.open ? 'OK' : 'DRAFT'}
                          label={m.open ? t('pt.org.marketOpen') : t('pt.org.marketClosed')}
                        />
                      </td>
                      <td className="dd-ltr">{m.currency}</td>
                      <td>
                        {m.legalEntities.map((l) => `${l.legalName} (${l.currency})`).join(', ') ||
                          '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
      </Card>

      {history.data ? (
        <Card>
          <h2 className="dd-title">{t('pt.org.history')}</h2>
          <ul
            className="dd-list"
            style={{ margin: 0, paddingInlineStart: 18 }}
            data-testid="pt-history"
          >
            {history.data.slice(0, 30).map((h) => (
              <li key={h.id}>
                <span className="dd-muted">{formatDateTime(locale, h.at)}</span> ·{' '}
                <span className="dd-ltr">{h.action}</span>
                {h.reason ? ` · ${h.reason}` : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
