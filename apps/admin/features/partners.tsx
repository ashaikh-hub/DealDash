'use client';

import { useState } from 'react';
import { RequirePermission, errorMessage, useApi, useAuth, useResource } from '@dealdash/app-shell';
import {
  createTranslator,
  formatDate,
  formatDateTime,
  type DictionaryKey,
} from '@dealdash/localization';
import { PARTNER_TRANSITIONS, PARTNER_TYPES, type PartnerLifecycle } from '@dealdash/types';
import {
  Alert,
  Button,
  Card,
  Field,
  Input,
  LoadingState,
  Select,
  StatusChip,
  Tabs,
  type StatusTone,
} from '@dealdash/ui';

const k = (p: string, v: string) => `${p}.${v}` as DictionaryKey;
const TONE: Record<string, StatusTone> = {
  OK: 'success',
  ACTIVE: 'success',
  READY: 'success',
  MISSING: 'danger',
  NOT_READY: 'danger',
  BLOCKED: 'danger',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
  VALIDATION_REQUIRED: 'warning',
  UNDER_REVIEW: 'warning',
  MERCHANT_APPROVED: 'warning',
  PROPOSED: 'warning',
  CHANGES_REQUESTED: 'warning',
};

interface PartnerRow {
  organizationId: string;
  nameEn: string;
  nameAr: string;
  partnerType: string;
  lifecycle: string;
  requestedMarkets: string[];
  pending: string | null;
  readiness: string;
}
interface Readiness {
  lifecycle: string;
  state: string;
  items: Array<{ check: string; state: string; detail: string }>;
  nextSteps: string[];
}
interface Profile {
  organizationId: string;
  nameEn: string;
  lifecycle: string;
  pending: { lifecycle: string; reason: string | null; requestedByUserId: string | null } | null;
}
interface Benefit {
  id: string;
  reference: string;
  partnerNameEn: string | null;
  partnerNameAr: string | null;
  merchantNameEn: string | null;
  merchantNameAr: string | null;
  labelEn: string;
  labelAr: string;
  status: string;
  market: string;
}

/** Admin -> Partners: Business Accounts of banks, schemes, corporates and strategic partners; review, readiness, activation (4 eyes). */
export function AdminPartnersPage() {
  return (
    <RequirePermission any={['admin.partners.review']}>
      <Inner />
    </RequirePermission>
  );
}

function Inner() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [tab, setTab] = useState('partners');
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="admin-partners">
      <h1 className="dd-title-xl">{t('pt.admin.title')}</h1>
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('pt.admin.intro')}
      </p>
      <Tabs
        tabs={[
          { id: 'partners', label: t('pt.admin.title') },
          { id: 'benefits', label: t('pt.admin.benefits') },
          { id: 'offers', label: t('pt.admin.offers') },
        ]}
        value={tab}
        onChange={setTab}
        label={t('pt.admin.title')}
      />
      {tab === 'partners' ? <PartnersTab /> : tab === 'benefits' ? <BenefitsTab /> : <OffersTab />}
    </div>
  );
}

function useCall() {
  const { call } = useApi();
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    const r = await call('POST', path, { body, idempotent: true });
    setBusy(false);
    setBanner(
      r.ok
        ? { tone: 'success', text: ok }
        : { tone: 'danger', text: errorMessage(locale, r.errors) },
    );
    return r.ok;
  };
  const node = banner ? (
    <div data-testid="ap-banner">
      <Alert tone={banner.tone}>{banner.text}</Alert>
    </div>
  ) : null;
  void t;
  return { run, banner: node, busy };
}

function PartnersTab() {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const perms = me?.permissions ?? [];
  const list = useResource<PartnerRow[]>('/v1/admin/partners');
  const [open, setOpen] = useState<string | null>(null);
  const cmd = useCall();
  const [f, setF] = useState({
    nameEn: '',
    nameAr: '',
    partnerType: 'BANK',
    legalName: '',
    country: 'SA',
    adminName: '',
    adminEmail: '',
  });
  if (open)
    return (
      <PartnerDetail
        orgId={open}
        onBack={() => {
          setOpen(null);
          void list.reload();
        }}
      />
    );
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      {cmd.banner}
      <Card>
        {list.loading && !list.data ? (
          <LoadingState label={t('state.loading')} />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="dd-table" data-testid="ap-list">
              <thead>
                <tr>
                  <th>{t('pt.name')}</th>
                  <th>{t('pt.admin.type')}</th>
                  <th>{t('pt.markets')}</th>
                  <th>{t('pt.status')}</th>
                  <th>{t('pt.org.readiness')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(list.data ?? []).map((p) => (
                  <tr key={p.organizationId} data-testid={`ap-row-${p.organizationId}`}>
                    <td>{locale === 'ar' ? p.nameAr : p.nameEn}</td>
                    <td>{t(k('pt.type', p.partnerType))}</td>
                    <td className="dd-ltr">{p.requestedMarkets.join(', ')}</td>
                    <td>
                      <StatusChip tone={TONE[p.lifecycle] ?? 'neutral'}>
                        {t(k('pt.life', p.lifecycle))}
                      </StatusChip>
                      {p.pending ? (
                        <div className="dd-muted">
                          {t('pt.admin.pending', { to: t(k('pt.life', p.pending)) })}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <StatusChip tone={TONE[p.readiness] ?? 'neutral'}>
                        {t(k('pt.ready', p.readiness))}
                      </StatusChip>
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => setOpen(p.organizationId)}>
                        {t('pt.open')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {perms.includes('admin.partners.manage') ? (
        <Card>
          <h2 className="dd-title">{t('pt.admin.new')}</h2>
          <div
            style={{
              display: 'grid',
              gap: 8,
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            }}
            data-testid="ap-new"
          >
            <Field label={t('pt.nameEn')} htmlFor="ap-en">
              <Input
                id="ap-en"
                value={f.nameEn}
                onChange={(e) => setF({ ...f, nameEn: e.target.value })}
              />
            </Field>
            <Field label={t('pt.nameAr')} htmlFor="ap-ar">
              <Input
                id="ap-ar"
                dir="rtl"
                value={f.nameAr}
                onChange={(e) => setF({ ...f, nameAr: e.target.value })}
              />
            </Field>
            <Field label={t('pt.admin.type')} htmlFor="ap-type">
              <Select
                id="ap-type"
                value={f.partnerType}
                onChange={(e) => setF({ ...f, partnerType: e.target.value })}
              >
                {PARTNER_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(k('pt.type', x))}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('pt.org.legalName')} htmlFor="ap-legal">
              <Input
                id="ap-legal"
                value={f.legalName}
                onChange={(e) => setF({ ...f, legalName: e.target.value })}
              />
            </Field>
            <Field label={t('pt.country')} htmlFor="ap-country">
              <Input
                id="ap-country"
                dir="ltr"
                value={f.country}
                onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })}
              />
            </Field>
            <Field label={t('pt.admin.adminName')} htmlFor="ap-admin">
              <Input
                id="ap-admin"
                value={f.adminName}
                onChange={(e) => setF({ ...f, adminName: e.target.value })}
              />
            </Field>
            <Field label={t('pt.admin.adminEmail')} htmlFor="ap-email">
              <Input
                id="ap-email"
                dir="ltr"
                value={f.adminEmail}
                onChange={(e) => setF({ ...f, adminEmail: e.target.value })}
              />
            </Field>
          </div>
          <Button
            style={{ marginBlockStart: 8 }}
            loading={cmd.busy}
            onClick={async () => {
              if (await cmd.run('/v1/admin/partners', f, t('pt.admin.created')))
                await list.reload();
            }}
            data-testid="ap-create"
          >
            {t('pt.admin.create')}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function PartnerDetail({ orgId, onBack }: { orgId: string; onBack: () => void }) {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const perms = me?.permissions ?? [];
  const profile = useResource<Profile>(`/v1/admin/partners/${orgId}`);
  const readiness = useResource<Readiness>(`/v1/admin/partners/${orgId}/readiness`);
  const history = useResource<
    Array<{
      id: string;
      action: string;
      at: string;
      reason: string | null;
      actorRole: string | null;
    }>
  >(`/v1/admin/partners/${orgId}/history`);
  const cmd = useCall();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const reload = async () => {
    await Promise.all([profile.reload(), readiness.reload(), history.reload()]);
  };
  const p = profile.data;
  const next = p
    ? [...PARTNER_TRANSITIONS[p.lifecycle as PartnerLifecycle]].filter((x) => x !== 'UNDER_REVIEW')
    : [];
  const mine = p?.pending?.requestedByUserId === me?.id;
  return (
    <div className="dd-stack" style={{ gap: 12 }} data-testid="ap-detail">
      <div>
        <Button size="sm" variant="ghost" onClick={onBack}>
          {t('pt.back')}
        </Button>
      </div>
      {cmd.banner}
      {p ? (
        <Card>
          <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <h2 className="dd-title" style={{ margin: 0 }}>
              {p.nameEn}
            </h2>
            <StatusChip tone={TONE[p.lifecycle] ?? 'neutral'}>
              <span data-testid="ap-lifecycle">{t(k('pt.life', p.lifecycle))}</span>
            </StatusChip>
          </div>
          {p.pending ? (
            <div
              className="dd-stack"
              style={{ gap: 8, marginBlockStart: 12 }}
              data-testid="ap-pending"
            >
              <Alert tone="warning">
                {t('pt.admin.pending', { to: t(k('pt.life', p.pending.lifecycle)) })}{' '}
                {p.pending.reason ? `· ${p.pending.reason}` : ''}
              </Alert>
              {perms.includes('admin.partners.approve') ? (
                <div className="dd-row" style={{ gap: 8 }}>
                  <Button
                    disabled={mine}
                    loading={cmd.busy}
                    onClick={async () =>
                      (await cmd.run(
                        `/v1/admin/partners/${orgId}/lifecycle/approve`,
                        {},
                        t('pt.saved'),
                      )) && reload()
                    }
                    data-testid="ap-approve"
                  >
                    {t('pt.admin.approve')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={mine}
                    onClick={async () =>
                      (await cmd.run(
                        `/v1/admin/partners/${orgId}/lifecycle/reject`,
                        { reason: reason || t('pt.admin.reject') },
                        t('pt.saved'),
                      )) && reload()
                    }
                  >
                    {t('pt.admin.reject')}
                  </Button>
                  {mine ? <span className="dd-muted">{t('pt.admin.otherApprover')}</span> : null}
                </div>
              ) : null}
            </div>
          ) : perms.includes('admin.partners.manage') && next.length ? (
            <div
              className="dd-row"
              style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBlockStart: 12 }}
              data-testid="ap-transition"
            >
              <Field label={t('pt.admin.moveTo')} htmlFor="ap-to">
                <Select id="ap-to" value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">—</option>
                  {next.map((x) => (
                    <option key={x} value={x}>
                      {t(k('pt.life', x))}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('pt.reason')} htmlFor="ap-reason">
                <Input id="ap-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <Button
                disabled={!to || reason.trim().length < 3}
                loading={cmd.busy}
                onClick={async () =>
                  (await cmd.run(
                    `/v1/admin/partners/${orgId}/lifecycle`,
                    { to, reason },
                    t('pt.saved'),
                  )) && reload()
                }
                data-testid="ap-apply"
              >
                {t('pt.admin.request')}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : (
        <LoadingState label={t('state.loading')} />
      )}
      {readiness.data ? (
        <Card>
          <h2 className="dd-title">
            {t('pt.org.readiness')} ·{' '}
            <StatusChip tone={TONE[readiness.data.state] ?? 'neutral'}>
              {t(k('pt.ready', readiness.data.state))}
            </StatusChip>
          </h2>
          <table className="dd-table" data-testid="ap-readiness">
            <tbody>
              {readiness.data.items.map((i) => (
                <tr key={i.check}>
                  <td>{t(k('pt.check', i.check))}</td>
                  <td>
                    <StatusChip tone={TONE[i.state] ?? 'neutral'}>
                      {t(k('pt.cstate', i.state))}
                    </StatusChip>
                  </td>
                  <td className="dd-muted">{i.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
      {history.data ? (
        <Card>
          <h2 className="dd-title">{t('pt.org.history')}</h2>
          <ul className="dd-list" style={{ margin: 0, paddingInlineStart: 18 }}>
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

interface PendingOffer {
  id: string;
  partner: string | null;
  merchant: string;
  country: string;
  titleEn: string;
  benefitEn: string;
  validFrom: string;
  validUntil: string | null;
  publicationRef: string | null;
  sourceRecordId: string;
  importMethod: string;
}

/** FD-S7-4: partner Live Deals waiting for DealDash to confirm the partner's right to publish the merchant's offer. */
function OffersTab() {
  const { locale, me } = useAuth();
  const t = createTranslator(locale);
  const res = useResource<PendingOffer[]>('/v1/admin/partners/offers');
  const cmd = useCall();
  const canApprove = (me?.permissions ?? []).includes('admin.partners.approve');
  const confirm = async (id: string) => {
    if (await cmd.run(`/v1/admin/partners/offers/${id}/confirm`, {}, t('pt.saved')))
      await res.reload();
  };
  return (
    <Card>
      <p className="dd-muted">{t('pt.admin.offersIntro')}</p>
      {cmd.banner}
      {res.loading && !res.data ? (
        <LoadingState label={t('state.loading')} />
      ) : !res.data?.length ? (
        <p className="dd-muted" data-testid="ap-offers-empty">
          {t('pt.state.empty')}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="dd-table" data-testid="ap-offers">
            <tbody>
              {res.data.map((o) => (
                <tr key={o.id}>
                  <td>
                    {o.titleEn}
                    <div className="dd-muted">{o.benefitEn}</div>
                  </td>
                  <td>
                    {o.partner}
                    <div className="dd-muted">
                      {o.merchant} · {o.country}
                    </div>
                  </td>
                  <td className="dd-muted dd-ltr">
                    {o.publicationRef}
                    <div>{o.sourceRecordId}</div>
                  </td>
                  <td className="dd-muted">
                    {formatDate(locale, o.validFrom)}
                    {o.validUntil ? ` – ${formatDate(locale, o.validUntil)}` : ''}
                  </td>
                  <td>
                    {canApprove ? (
                      <Button
                        size="sm"
                        disabled={cmd.busy}
                        onClick={() => void confirm(o.id)}
                        data-testid={`ap-offer-confirm-${o.id}`}
                      >
                        {t('pt.admin.confirmPublication')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function BenefitsTab() {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const res = useResource<Benefit[]>('/v1/admin/partners/benefits');
  const cmd = useCall();
  const act = async (id: string, action: string) => {
    if (
      await cmd.run(
        `/v1/admin/partners/benefits/${id}/${action}`,
        { reason: action === 'approve' ? undefined : t(k('pt.ben', action)) },
        t('pt.saved'),
      )
    )
      await res.reload();
  };
  return (
    <Card>
      {cmd.banner}
      {res.loading && !res.data ? (
        <LoadingState label={t('state.loading')} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="dd-table" data-testid="ap-benefits">
            <tbody>
              {(res.data ?? []).map((b) => (
                <tr key={b.id}>
                  <td>
                    {locale === 'ar' ? b.labelAr : b.labelEn}
                    <div className="dd-muted dd-ltr">{b.reference}</div>
                  </td>
                  <td>{locale === 'ar' ? b.partnerNameAr : b.partnerNameEn}</td>
                  <td>{locale === 'ar' ? b.merchantNameAr : b.merchantNameEn}</td>
                  <td>
                    <StatusChip tone={TONE[b.status] ?? 'neutral'}>
                      {t(k('pt.bstate', b.status))}
                    </StatusChip>
                  </td>
                  <td>
                    {b.status === 'MERCHANT_APPROVED' ? (
                      <span className="dd-row" style={{ gap: 4 }}>
                        <Button
                          size="sm"
                          onClick={() => void act(b.id, 'approve')}
                          data-testid={`ap-ben-approve-${b.id}`}
                        >
                          {t('pt.ben.approve')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void act(b.id, 'reject')}
                        >
                          {t('pt.ben.reject')}
                        </Button>
                      </span>
                    ) : b.status === 'ACTIVE' ? (
                      <Button size="sm" variant="outline" onClick={() => void act(b.id, 'suspend')}>
                        {t('pt.ben.suspend')}
                      </Button>
                    ) : b.status === 'SUSPENDED' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void act(b.id, 'reinstate')}
                      >
                        {t('pt.ben.reinstate')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
