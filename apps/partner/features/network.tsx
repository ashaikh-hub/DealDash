'use client';

import { useState } from 'react';
import { useApi, useAuth, useResource } from '@dealdash/app-shell';
import { formatDate, formatDateTime } from '@dealdash/localization';
import { NETWORK_CAPABILITIES } from '@dealdash/types';
import { Alert, Button, Card, Field, Input, Select, Tabs, Textarea } from '@dealdash/ui';
import { Chip, Loaded, PartnerPage, k, parsePairs, pbase, useCmd, usePerms, useT } from './utils';

interface Row {
  id: string;
  nameEn: string;
  nameAr: string | null;
  brand: string | null;
  country: string;
  registration: string;
  state: string;
  capabilities: Record<string, boolean>;
  branches: number;
  offers: number;
  externalId: string | null;
  importMethod: string | null;
  lastSyncAt: string | null;
  openConflicts: number;
  possibleDuplicates: number;
}
interface Detail {
  id: string;
  nameEn: string;
  nameAr: string | null;
  state: string;
  country: string;
  capabilities: Record<string, boolean>;
  branches: Array<{ id: string; nameEn: string; city: string | null; registered: boolean }>;
  offers: Array<{ id: string; titleEn: string; status: string }>;
  provenance: Array<{
    entityType: string;
    sourceSystem: string;
    sourceRecordId: string;
    importMethod: string;
    syncStatus: string;
    overrideStatus: string;
    lastSyncAt: string | null;
  }>;
  conflicts: Array<{ id: string; field: string; policy: string }>;
}
interface Dup {
  id: string;
  confidence: number;
  yours: { nameEn: string; country: string } | null;
  other: { nameEn: string; country: string; registration: string } | null;
  highRisk: boolean;
  partnerSuggestion: string | null;
}
interface Job {
  id: string;
  kind: string;
  fileName: string | null;
  status: string;
  totals: Record<string, number>;
  createdAt: string;
  rejectionReason: string | null;
}

export function PartnerNetworkPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.net.title')}
      intro={t('pt.net.intro')}
      any={['partner.merchants.read']}
      module="MERCHANT_NETWORK"
      testId="pt-network"
    >
      {(orgId) => <NetworkInner orgId={orgId} />}
    </PartnerPage>
  );
}

function NetworkInner({ orgId }: { orgId: string }) {
  const t = useT();
  const perms = usePerms();
  const tabs = [
    { id: 'list', label: t('pt.net.title') },
    ...(perms.includes('partner.network.manage') ? [{ id: 'add', label: t('pt.net.add') }] : []),
    { id: 'dups', label: t('pt.net.dupTitle') },
    ...(perms.includes('partner.imports.manage')
      ? [{ id: 'bulk', label: t('pt.net.import') }]
      : []),
  ];
  const [tab, setTab] = useState('list');
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <div style={{ overflowX: 'auto' }}>
        <Tabs tabs={tabs} value={tab} onChange={setTab} label={t('pt.net.title')} />
      </div>
      {tab === 'list' ? <NetworkList orgId={orgId} /> : null}
      {tab === 'add' ? <AddMerchant orgId={orgId} /> : null}
      {tab === 'dups' ? (
        <Duplicates orgId={orgId} canManage={perms.includes('partner.network.manage')} />
      ) : null}
      {tab === 'bulk' ? <BulkImport orgId={orgId} /> : null}
    </div>
  );
}

function NetworkList({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const res = useResource<{ items: Row[]; total: number }>(`${pbase(orgId)}/network`, {
    q: q || undefined,
    limit: 100,
  });
  if (open) return <MerchantDetail orgId={orgId} id={open} onBack={() => setOpen(null)} />;
  return (
    <Card>
      <Field label={t('pt.net.search')} htmlFor="net-q">
        <Input id="net-q" value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <Loaded res={res} empty={(d) => !d.items.length}>
        {(d) => (
          <div style={{ overflowX: 'auto' }}>
            <p className="dd-muted">{t('pt.net.total', { n: String(d.total) })}</p>
            <table className="dd-table" data-testid="pt-network-table">
              <thead>
                <tr>
                  <th>{t('pt.merchant')}</th>
                  <th>{t('pt.country')}</th>
                  <th>{t('pt.net.state')}</th>
                  <th>{t('pt.net.branches')}</th>
                  <th>{t('pt.net.source')}</th>
                  <th>{t('pt.net.lastSync')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.items.map((m) => (
                  <tr key={m.id} data-testid={`pt-net-${m.id}`}>
                    <td>
                      {locale === 'ar' && m.nameAr ? m.nameAr : m.nameEn}
                      {m.brand ? <div className="dd-muted">{m.brand}</div> : null}
                      {m.possibleDuplicates ? (
                        <div className="dd-muted">
                          {t('pt.net.duplicates')}: {m.possibleDuplicates}
                        </div>
                      ) : null}
                    </td>
                    <td className="dd-ltr">{m.country}</td>
                    <td>
                      <Chip v={m.state} label={t(k('pt.nstate', m.state))} />
                    </td>
                    <td>{m.branches}</td>
                    <td>
                      {m.importMethod ? t(k('pt.method', m.importMethod)) : '—'}
                      {m.externalId ? <div className="dd-muted dd-ltr">{m.externalId}</div> : null}
                    </td>
                    <td className="dd-muted">
                      {m.lastSyncAt ? formatDateTime(locale, m.lastSyncAt) : '—'}
                    </td>
                    <td>
                      <Button size="sm" variant="ghost" onClick={() => setOpen(m.id)}>
                        {t('pt.open')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
    </Card>
  );
}

function MerchantDetail({ orgId, id, onBack }: { orgId: string; id: string; onBack: () => void }) {
  const { locale } = useAuth();
  const t = useT();
  const res = useResource<Detail>(`${pbase(orgId)}/network/merchants/${id}`);
  return (
    <Card>
      <Button variant="ghost" size="sm" onClick={onBack}>
        {t('pt.back')}
      </Button>
      <Loaded res={res}>
        {(m) => (
          <div className="dd-stack" style={{ gap: 12 }} data-testid="pt-net-detail">
            <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <h2 className="dd-title" style={{ margin: 0 }}>
                {locale === 'ar' && m.nameAr ? m.nameAr : m.nameEn}
              </h2>
              <Chip v={m.state} label={t(k('pt.nstate', m.state))} testId="pt-net-state" />
            </div>
            <div>
              <strong>{t('pt.net.capabilities')}</strong>
              <div
                className="dd-row"
                style={{ flexWrap: 'wrap', gap: 6, marginBlockStart: 6 }}
                data-testid="pt-net-caps"
              >
                {NETWORK_CAPABILITIES.map((c) => (
                  <Chip
                    key={c}
                    v={m.capabilities[c] ? 'OK' : 'DRAFT'}
                    label={`${t(k('pt.cap', c))}${m.capabilities[c] ? '' : ' ✕'}`}
                  />
                ))}
              </div>
            </div>
            <div>
              <strong>{t('pt.net.branches')}</strong>
              <ul className="dd-list" style={{ margin: 0, paddingInlineStart: 18 }}>
                {m.branches.map((b) => (
                  <li key={b.id}>
                    {b.nameEn}
                    {b.city ? ` · ${b.city}` : ''}
                  </li>
                ))}
              </ul>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <strong>{t('pt.net.provenance')}</strong>
              <table className="dd-table" data-testid="pt-net-provenance">
                <thead>
                  <tr>
                    <th>{t('pt.net.source')}</th>
                    <th>{t('pt.net.externalId')}</th>
                    <th>{t('pt.net.sync')}</th>
                    <th>{t('pt.net.override')}</th>
                    <th>{t('pt.net.lastSync')}</th>
                  </tr>
                </thead>
                <tbody>
                  {m.provenance.map((p) => (
                    <tr key={`${p.entityType}-${p.sourceRecordId}`}>
                      <td>
                        {t(k('pt.method', p.importMethod))}{' '}
                        <span className="dd-muted dd-ltr">{p.sourceSystem}</span>
                      </td>
                      <td className="dd-ltr">{p.sourceRecordId}</td>
                      <td className="dd-ltr">{p.syncStatus}</td>
                      <td className="dd-ltr">{p.overrideStatus}</td>
                      <td className="dd-muted">
                        {p.lastSyncAt ? formatDateTime(locale, p.lastSyncAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {m.conflicts.length ? (
              <Alert tone="warning" title={t('pt.net.conflicts')}>
                {m.conflicts.map((c) => c.field).join(', ')}
              </Alert>
            ) : null}
          </div>
        )}
      </Loaded>
    </Card>
  );
}

function AddMerchant({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const cmd = useCmd();
  const { call } = useApi();
  const markets = useResource<Array<{ code: string; nameEn: string; nameAr: string }>>(
    `${pbase(orgId)}/markets`,
  );
  const [f, setF] = useState({
    nameEn: '',
    nameAr: '',
    brand: '',
    country: '',
    categoryCode: '',
    externalMerchantId: '',
    branch: '',
    city: '',
  });
  const [warn, setWarn] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<
    Array<{ organizationId: string; nameEn: string; nameAr: string; country: string | null }>
  >([]);
  // B8 (Stage 8 closure): the country comes from the partner's market list; nothing is submitted until that list has loaded
  const country = f.country || markets.data?.[0]?.code || '';
  const marketsReady = !markets.loading && !!markets.data?.length && /^[A-Z]{2}$/.test(country);
  const add = async () => {
    if (!marketsReady) return;
    setWarn(false);
    const r = await cmd.run<{ warnings: string[] }>(
      'POST',
      `${pbase(orgId)}/network/merchants`,
      {
        nameEn: f.nameEn,
        nameAr: f.nameAr || undefined,
        brand: f.brand || undefined,
        country,
        categoryCode: f.categoryCode || undefined,
        externalMerchantId: f.externalMerchantId || undefined,
        branches: f.branch ? [{ nameEn: f.branch, city: f.city || undefined }] : [],
      },
      t('pt.net.added'),
    );
    if (r.ok) {
      setWarn((r.data?.warnings ?? []).includes('POSSIBLE_DUPLICATE'));
      setF({ ...f, nameEn: '', nameAr: '', brand: '', externalMerchantId: '', branch: '' });
    }
  };
  const search = async () => {
    const r = await call<typeof found>('GET', `${pbase(orgId)}/network/registered`, {
      query: { q },
    });
    setFound(r.ok && r.data ? r.data : []);
  };
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      {cmd.banner}
      {warn ? <Alert tone="warning">{t('pt.net.duplicateWarn')}</Alert> : null}
      <Card>
        <h2 className="dd-title">{t('pt.net.add')}</h2>
        <p className="dd-muted">{t('pt.net.addIntro')}</p>
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
          data-testid="pt-net-add"
        >
          <Field label={t('pt.nameEn')} htmlFor="nm-en" error={cmd.fields.nameEn}>
            <Input
              id="nm-en"
              value={f.nameEn}
              onChange={(e) => setF({ ...f, nameEn: e.target.value })}
            />
          </Field>
          <Field label={t('pt.nameAr')} htmlFor="nm-ar">
            <Input
              id="nm-ar"
              dir="rtl"
              value={f.nameAr}
              onChange={(e) => setF({ ...f, nameAr: e.target.value })}
            />
          </Field>
          <Field label={t('pt.net.brand')} htmlFor="nm-brand">
            <Input
              id="nm-brand"
              value={f.brand}
              onChange={(e) => setF({ ...f, brand: e.target.value })}
            />
          </Field>
          <Field label={t('pt.country')} htmlFor="nm-country">
            <Select
              id="nm-country"
              value={f.country}
              onChange={(e) => setF({ ...f, country: e.target.value })}
            >
              {(markets.data ?? []).map((m) => (
                <option key={m.code} value={m.code}>
                  {locale === 'ar' ? m.nameAr : m.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('pt.net.externalId')} htmlFor="nm-ext">
            <Input
              id="nm-ext"
              dir="ltr"
              value={f.externalMerchantId}
              onChange={(e) => setF({ ...f, externalMerchantId: e.target.value })}
            />
          </Field>
          <Field label={t('pt.net.category')} htmlFor="nm-cat">
            <Input
              id="nm-cat"
              dir="ltr"
              value={f.categoryCode}
              onChange={(e) => setF({ ...f, categoryCode: e.target.value })}
            />
          </Field>
          <Field label={t('pt.net.branchName')} htmlFor="nm-branch">
            <Input
              id="nm-branch"
              value={f.branch}
              onChange={(e) => setF({ ...f, branch: e.target.value })}
            />
          </Field>
          <Field label={t('pt.city')} htmlFor="nm-city">
            <Input
              id="nm-city"
              value={f.city}
              onChange={(e) => setF({ ...f, city: e.target.value })}
            />
          </Field>
        </div>
        {!marketsReady ? (
          <p className="dd-caption" role="status" data-testid="pt-net-markets-state" style={{ marginBlockStart: 8 }}>
            {markets.loading || !markets.data ? t('pt.net.marketsLoading') : t('pt.net.noMarket')}
          </p>
        ) : null}
        <Button
          onClick={() => void add()}
          loading={cmd.busy}
          disabled={!f.nameEn || !marketsReady}
          style={{ marginBlockStart: 8 }}
          data-testid="pt-net-add-submit"
        >
          {t('pt.add')}
        </Button>
      </Card>
      <Card>
        <h2 className="dd-title">{t('pt.net.linkTitle')}</h2>
        <p className="dd-muted">{t('pt.net.linkHelp')}</p>
        <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Input
            aria-label={t('pt.net.search')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="pt-net-reg-q"
          />
          <Button variant="secondary" onClick={() => void search()} data-testid="pt-net-reg-search">
            {t('pt.net.search')}
          </Button>
        </div>
        <ul className="dd-list" style={{ margin: '8px 0 0', paddingInlineStart: 18 }}>
          {found.map((m) => (
            <li key={m.organizationId}>
              {locale === 'ar' ? m.nameAr : m.nameEn}{' '}
              {m.country ? <span className="dd-muted dd-ltr">{m.country}</span> : null}{' '}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void cmd.run(
                    'POST',
                    `${pbase(orgId)}/network/registered/${m.organizationId}`,
                    {},
                    t('pt.net.linked'),
                  )
                }
                data-testid={`pt-net-link-${m.organizationId}`}
              >
                {t('pt.net.link')}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Duplicates({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const t = useT();
  const res = useResource<Dup[]>(`${pbase(orgId)}/network/duplicates`);
  const cmd = useCmd();
  const decide = async (id: string, decision: 'NOT_DUPLICATE' | 'SUGGEST_MERGE') => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/network/duplicates/${id}`,
      { decision },
      t('pt.saved'),
    );
    if (r.ok) await res.reload();
  };
  return (
    <Card>
      <p className="dd-muted">{t('pt.net.dupIntro')}</p>
      {cmd.banner}
      <Loaded res={res} empty={(d) => !d.length}>
        {(d) => (
          <div style={{ overflowX: 'auto' }}>
            <table className="dd-table" data-testid="pt-dups">
              <thead>
                <tr>
                  <th>{t('pt.net.yours')}</th>
                  <th>{t('pt.net.other')}</th>
                  <th>{t('pt.net.confidence')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.map((c) => (
                  <tr key={c.id}>
                    <td>{c.yours?.nameEn}</td>
                    <td>
                      {c.other?.nameEn}{' '}
                      {c.other ? (
                        <Chip
                          v={c.other.registration}
                          label={t(k('pt.nstate', c.other.registration))}
                        />
                      ) : null}
                    </td>
                    <td>
                      {c.confidence}
                      {c.highRisk ? (
                        <>
                          {' '}
                          <Chip v="VALIDATION_REQUIRED" label={t('pt.net.highRisk')} />
                        </>
                      ) : null}
                    </td>
                    <td>
                      {c.partnerSuggestion ? (
                        <span className="dd-muted">
                          {t('pt.net.suggested', {
                            v:
                              c.partnerSuggestion === 'SUGGEST_MERGE'
                                ? t('pt.net.suggestMerge')
                                : t('pt.net.notDuplicate'),
                          })}
                        </span>
                      ) : canManage ? (
                        <span className="dd-row" style={{ gap: 4 }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void decide(c.id, 'NOT_DUPLICATE')}
                          >
                            {t('pt.net.notDuplicate')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void decide(c.id, 'SUGGEST_MERGE')}
                          >
                            {t('pt.net.suggestMerge')}
                          </Button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loaded>
    </Card>
  );
}

function BulkImport({ orgId }: { orgId: string }) {
  const { locale, apiUrl } = useAuth();
  const t = useT();
  const cmd = useCmd();
  const jobs = useResource<Job[]>(`/v1/orgs/${orgId}/imports`);
  const [kind, setKind] = useState<'MERCHANTS' | 'BRANCHES' | 'OFFERS'>('MERCHANTS');
  const [sourceSystem, setSourceSystem] = useState('partner-file');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState('');
  const [last, setLast] = useState<Job | null>(null);
  const upload = async () => {
    const r = await cmd.run<Job>('POST', `${pbase(orgId)}/network/imports`, {
      kind,
      sourceSystem,
      fileName: fileName || undefined,
      csv,
      mapping: Object.fromEntries(parsePairs(mapping)),
    });
    if (r.ok && r.data) {
      setLast(r.data);
      await jobs.reload();
    }
  };
  const submit = async (id: string) => {
    const r = await cmd.run('POST', `/v1/orgs/${orgId}/imports/${id}/submit`, {}, t('pt.saved'));
    if (r.ok) await jobs.reload();
  };
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      {cmd.banner}
      <Card>
        <h2 className="dd-title">{t('pt.net.import')}</h2>
        <p className="dd-muted">{t('pt.net.importIntro')}</p>
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
          data-testid="pt-bulk-form"
        >
          <Field label={t('pt.net.kind')} htmlFor="bk-kind">
            <Select
              id="bk-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              {(['MERCHANTS', 'BRANCHES', 'OFFERS'] as const).map((x) => (
                <option key={x} value={x}>
                  {t(k('pt.net.kind', x))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('pt.net.sourceSystem')} htmlFor="bk-source">
            <Input
              id="bk-source"
              dir="ltr"
              value={sourceSystem}
              onChange={(e) => setSourceSystem(e.target.value)}
            />
          </Field>
          <Field label={t('pt.net.file')} htmlFor="bk-file">
            <input
              id="bk-file"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setCsv(await file.text());
              }}
            />
          </Field>
        </div>
        <a
          href={`${apiUrl}${pbase(orgId)}/network/templates/${kind}`}
          target="_blank"
          rel="noreferrer"
        >
          {t('pt.net.template')}
        </a>
        <Field label={t('pt.net.mapping')} htmlFor="bk-map">
          <Textarea
            id="bk-map"
            dir="ltr"
            rows={3}
            value={mapping}
            onChange={(e) => setMapping(e.target.value)}
            placeholder="Merchant Ref = source_record_id"
          />
        </Field>
        <Field label="CSV" htmlFor="bk-csv">
          <Textarea
            id="bk-csv"
            dir="ltr"
            rows={4}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
        </Field>
        <Button
          onClick={() => void upload()}
          loading={cmd.busy}
          disabled={csv.trim().length < 10}
          data-testid="pt-bulk-upload"
        >
          {t('pt.net.upload')}
        </Button>
        {last ? (
          <div style={{ marginBlockStart: 8 }} data-testid="pt-bulk-preview">
            <Alert tone={last.totals.errors ? 'warning' : 'success'}>
              {t('pt.net.preview', {
                rows: String(last.totals.rows ?? 0),
                valid: String(last.totals.valid ?? 0),
                warnings: String(last.totals.warnings ?? 0),
                errors: String(last.totals.errors ?? 0),
                duplicates: String(last.totals.duplicates ?? 0),
              })}
            </Alert>
          </div>
        ) : null}
      </Card>
      <Card>
        <h2 className="dd-title">{t('pt.net.jobs')}</h2>
        <Loaded res={jobs} empty={(d) => !d.length}>
          {(d) => (
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table" data-testid="pt-bulk-jobs">
                <tbody>
                  {d.map((j) => (
                    <tr key={j.id}>
                      <td>{j.fileName ?? t(k('pt.net.kind', j.kind))}</td>
                      <td className="dd-muted">{formatDate(locale, j.createdAt)}</td>
                      <td>
                        <Chip v={j.status} label={t(k('pt.net.job', j.status))} />
                        {j.rejectionReason ? (
                          <div className="dd-muted">{j.rejectionReason}</div>
                        ) : null}
                      </td>
                      <td>
                        <a
                          href={`${apiUrl}/v1/orgs/${orgId}/imports/${j.id}/errors.csv`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('pt.net.errorReport')}
                        </a>
                      </td>
                      <td>
                        {j.status === 'VALIDATED' ? (
                          <Button size="sm" onClick={() => void submit(j.id)}>
                            {t('pt.net.sendApproval')}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
      </Card>
    </div>
  );
}

interface Offer {
  id: string;
  merchant: string;
  merchantAr: string | null;
  country: string;
  titleEn: string;
  titleAr: string | null;
  benefitEn: string;
  status: string;
  validFrom: string;
  validUntil: string | null;
  publicationConfirmed: boolean;
  publication: 'PUBLISHABLE' | 'AWAITING_CONFIRMATION' | 'STALE';
  publicationRef: string | null;
  sourceRecordId: string;
  merchantSourceId: string | null;
  importMethod: string;
  lastSyncAt: string | null;
}

export function PartnerOffersPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.offers.title')}
      intro={t('pt.offers.intro')}
      any={['partner.merchants.read']}
      module="OFFERS"
      testId="pt-offers"
    >
      {(orgId) => <OffersInner orgId={orgId} />}
    </PartnerPage>
  );
}

function OffersInner({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const perms = usePerms();
  const res = useResource<Offer[]>(`${pbase(orgId)}/offers`);
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      {perms.includes('partner.network.manage') ? (
        <CreateOffer orgId={orgId} onDone={res.reload} />
      ) : null}
      <Card>
        <Loaded res={res} empty={(d) => !d.length}>
          {(d) => (
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table" data-testid="pt-offer-table">
                <thead>
                  <tr>
                    <th>{t('pt.merchant')}</th>
                    <th>{t('nav.offers')}</th>
                    <th>{t('pt.offers.valid')}</th>
                    <th>{t('pt.offers.source')}</th>
                    <th>{t('pt.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.map((o) => (
                    <tr key={o.id}>
                      <td>{locale === 'ar' && o.merchantAr ? o.merchantAr : o.merchant}</td>
                      <td>
                        {locale === 'ar' && o.titleAr ? o.titleAr : o.titleEn}
                        <div className="dd-muted">{o.benefitEn}</div>
                      </td>
                      <td className="dd-muted">
                        {formatDate(locale, o.validFrom)}
                        {o.validUntil ? ` – ${formatDate(locale, o.validUntil)}` : ''}
                      </td>
                      <td className="dd-muted" dir="ltr" style={{ textAlign: 'start' }}>
                        {o.sourceRecordId}
                        {o.publicationRef ? <div>{o.publicationRef}</div> : null}
                        <div>{t(k('pt.method', o.importMethod))}</div>
                      </td>
                      <td>
                        <Chip
                          v={o.publication === 'PUBLISHABLE' ? 'OK' : o.publication === 'STALE' ? 'MISSING' : 'PENDING_REVIEW'}
                          label={t(k('pt.offers.pub', o.publication))}
                          testId={`pt-offer-pub-${o.sourceRecordId}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
      </Card>
    </div>
  );
}

/** FD-S7-4: one Live Deal for a merchant of the network, with the partner's publication authority. DealDash confirms the right. */
function CreateOffer({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const { locale } = useAuth();
  const t = useT();
  const cmd = useCmd();
  const merchants = useResource<{ items: Row[] }>(`${pbase(orgId)}/network`, { limit: 200 });
  const today = new Date().toISOString().slice(0, 10);
  const blank = {
    merchantSourceId: '',
    sourceRecordId: '',
    publicationRef: '',
    titleEn: '',
    titleAr: '',
    benefitEn: '',
    benefitAr: '',
    validFrom: today,
    validUntil: '',
  };
  const [f, setF] = useState(blank);
  const set = (key: keyof typeof blank) => (e: { target: { value: string } }) =>
    setF({ ...f, [key]: e.target.value });
  const withId = (merchants.data?.items ?? []).filter((m) => m.externalId);
  const submit = async () => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/offers`,
      {
        merchantSourceId: f.merchantSourceId || withId[0]?.externalId,
        sourceRecordId: f.sourceRecordId || undefined,
        publicationRef: f.publicationRef,
        titleEn: f.titleEn,
        titleAr: f.titleAr || undefined,
        benefitEn: f.benefitEn,
        benefitAr: f.benefitAr || undefined,
        validFrom: new Date(`${f.validFrom}T00:00:00Z`).toISOString(),
        validUntil: f.validUntil ? new Date(`${f.validUntil}T23:59:59Z`).toISOString() : undefined,
      },
      t('pt.offers.created'),
    );
    if (r.ok) {
      setF(blank);
      onDone();
    }
  };
  return (
    <Card>
      <h2 className="dd-title">{t('pt.offers.create')}</h2>
      <p className="dd-muted">{t('pt.offers.createIntro')}</p>
      {cmd.banner}
      <div
        style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
        data-testid="pt-offer-create"
      >
        <Field label={t('pt.merchant')} htmlFor="of-m" error={cmd.fields.merchantSourceId}>
          <Select id="of-m" value={f.merchantSourceId} onChange={set('merchantSourceId')}>
            {withId.map((m) => (
              <option key={m.id} value={m.externalId!}>
                {locale === 'ar' && m.nameAr ? m.nameAr : m.nameEn}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('pt.offers.publicationRef')} htmlFor="of-ref" error={cmd.fields.publicationRef}>
          <Input id="of-ref" dir="ltr" value={f.publicationRef} onChange={set('publicationRef')} />
        </Field>
        <Field label={t('pt.offers.externalId')} htmlFor="of-ext">
          <Input id="of-ext" dir="ltr" value={f.sourceRecordId} onChange={set('sourceRecordId')} />
        </Field>
        <Field label={t('pt.offers.titleEn')} htmlFor="of-ten" error={cmd.fields.titleEn}>
          <Input id="of-ten" value={f.titleEn} onChange={set('titleEn')} />
        </Field>
        <Field label={t('pt.offers.titleAr')} htmlFor="of-tar">
          <Input id="of-tar" dir="rtl" value={f.titleAr} onChange={set('titleAr')} />
        </Field>
        <Field label={t('pt.offers.benefitEn')} htmlFor="of-ben" error={cmd.fields.benefitEn}>
          <Input id="of-ben" value={f.benefitEn} onChange={set('benefitEn')} />
        </Field>
        <Field label={t('pt.offers.benefitAr')} htmlFor="of-bar">
          <Input id="of-bar" dir="rtl" value={f.benefitAr} onChange={set('benefitAr')} />
        </Field>
        <Field label={t('pt.offers.from')} htmlFor="of-from" error={cmd.fields.validFrom}>
          <Input id="of-from" type="date" value={f.validFrom} onChange={set('validFrom')} />
        </Field>
        <Field label={t('pt.offers.until')} htmlFor="of-until" error={cmd.fields.validUntil}>
          <Input id="of-until" type="date" value={f.validUntil} onChange={set('validUntil')} />
        </Field>
      </div>
      <div style={{ marginTop: 12 }}>
        <Button
          onClick={() => void submit()}
          disabled={cmd.busy || !withId.length || !f.publicationRef || !f.titleEn || !f.benefitEn}
          data-testid="pt-offer-submit"
        >
          {t('pt.offers.submit')}
        </Button>
      </div>
    </Card>
  );
}
