'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CommercialPanel, useAuth, useResource } from '@dealdash/app-shell';
import { formatMoney, withLocale } from '@dealdash/localization';
import { PARTNER_BENEFIT_KINDS } from '@dealdash/types';
import { Alert, Button, Card, Checkbox, Field, Input, Select, Tabs, Textarea } from '@dealdash/ui';
import { Chip, Loaded, PartnerPage, k, pbase, useCmd, usePerms, useT } from './utils';

interface PortfolioItem {
  caseId: string;
  reference: string;
  product: string;
  subjectId: string;
  titleEn: string;
  titleAr: string;
  status: string;
  commercialStatus: string;
  role: string;
  merchantNameEn: string | null;
  merchantNameAr: string | null;
  market: string | null;
  maxCashHalalas: number;
}
interface Benefit {
  id: string;
  reference: string;
  liveDealId: string;
  merchantNameEn: string | null;
  merchantNameAr: string | null;
  kind: string;
  labelEn: string;
  labelAr: string;
  status: string;
  market: string;
  decisionReason: string | null;
}

/** Campaigns the partner creates, sponsors or funds (shared engines), and its Live Deal partner benefits. */
export function PartnerCampaignsPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.camp.title')}
      intro={t('pt.camp.intro')}
      any={['partner.campaigns.read']}
      module="CAMPAIGNS"
      testId="pt-campaigns"
    >
      {(orgId) => <CampaignsInner orgId={orgId} />}
    </PartnerPage>
  );
}

function CampaignsInner({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const perms = usePerms();
  const [tab, setTab] = useState('campaigns');
  const res = useResource<{ items: PortfolioItem[] }>(`${pbase(orgId)}/campaigns`);
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <div className="dd-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Tabs
          tabs={[
            { id: 'campaigns', label: t('pt.camp.title') },
            { id: 'benefits', label: t('pt.camp.benefits') },
          ]}
          value={tab}
          onChange={setTab}
          label={t('pt.camp.title')}
        />
        {perms.includes('partner.campaigns.manage') && tab === 'campaigns' ? (
          <Link
            className="dd-btn dd-btn--primary"
            href={withLocale('/campaigns/new', locale)}
            data-testid="pt-camp-new"
          >
            {t('pt.camp.new')}
          </Link>
        ) : null}
      </div>
      {tab === 'campaigns' ? (
        <Card>
          <Loaded res={res} empty={(d) => !d.items.length}>
            {(d) => (
              <div style={{ overflowX: 'auto' }}>
                <table className="dd-table" data-testid="pt-camp-table">
                  <thead>
                    <tr>
                      <th>{t('pt.camp.detail')}</th>
                      <th>{t('pt.product')}</th>
                      <th>{t('pt.merchant')}</th>
                      <th>{t('pt.role')}</th>
                      <th>{t('pt.status')}</th>
                      <th>{t('pt.camp.commercial')}</th>
                      <th>{t('pt.camp.maxCash')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((c) => (
                      <tr key={c.caseId} data-testid={`pt-camp-${c.subjectId}`}>
                        <td>
                          {c.product === 'EXCLUSIVE' || c.product === 'VOUCHER' ? (
                            <Link
                              href={withLocale(`/campaigns/${c.product}/${c.subjectId}`, locale)}
                            >
                              {(locale === 'ar' ? c.titleAr : c.titleEn) || c.reference}
                            </Link>
                          ) : (
                            (locale === 'ar' ? c.titleAr : c.titleEn) || c.reference
                          )}
                          <div className="dd-muted dd-ltr" style={{ fontSize: 12 }}>
                            {c.reference} {c.market ? `· ${c.market}` : ''}
                          </div>
                        </td>
                        <td>{t(k('pt.product', c.product))}</td>
                        <td>{locale === 'ar' ? c.merchantNameAr : c.merchantNameEn}</td>
                        <td>{t(k('pt.role', c.role))}</td>
                        <td>
                          <Chip v={c.status} label={c.status} />
                        </td>
                        <td>
                          <Chip
                            v={c.commercialStatus}
                            label={t(k('cm.status', c.commercialStatus))}
                          />
                        </td>
                        <td>{formatMoney(locale, c.maxCashHalalas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Loaded>
        </Card>
      ) : (
        <Benefits orgId={orgId} />
      )}
    </div>
  );
}

// ================================================================ Live Deal partner benefits
function Benefits({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const perms = usePerms();
  const res = useResource<Benefit[]>(`${pbase(orgId)}/benefits`);
  const deals = useResource<
    Array<{
      id: string;
      titleEn: string;
      titleAr: string;
      merchantNameEn: string;
      merchantNameAr: string;
    }>
  >(perms.includes('partner.campaigns.manage') ? `${pbase(orgId)}/benefits/live-deals` : null);
  const cmd = useCmd();
  const [f, setF] = useState({
    liveDealId: '',
    kind: 'EXTRA_PERCENT',
    valueNumber: '',
    labelEn: '',
    labelAr: '',
    termsEn: '',
    termsAr: '',
    mine: true,
  });
  const propose = async () => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/benefits`,
      {
        liveDealId: f.liveDealId || deals.data?.[0]?.id,
        kind: f.kind,
        valueNumber: f.valueNumber ? Number(f.valueNumber) : null,
        labelEn: f.labelEn,
        labelAr: f.labelAr,
        termsEn: f.termsEn,
        termsAr: f.termsAr,
        eligibility: f.mine
          ? { kind: 'BANK_CARD', valueRefs: [orgId] }
          : { kind: 'PUBLIC', valueRefs: [] },
      },
      t('pt.ben.proposed'),
    );
    if (r.ok) await res.reload();
  };
  const withdraw = async (id: string) => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/benefits/${id}/withdraw`,
      { reason: t('pt.ben.withdraw') },
      t('pt.saved'),
    );
    if (r.ok) await res.reload();
  };
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      <Alert tone="info">{t('pt.ben.intro')}</Alert>
      {cmd.banner}
      {deals.data ? (
        <Card>
          <h2 className="dd-title">{t('pt.ben.new')}</h2>
          {deals.data.length ? (
            <div
              style={{
                display: 'grid',
                gap: 8,
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              }}
              data-testid="pt-ben-form"
            >
              <Field label={t('pt.ben.deal')} htmlFor="b-deal">
                <Select
                  id="b-deal"
                  value={f.liveDealId}
                  onChange={(e) => setF({ ...f, liveDealId: e.target.value })}
                >
                  {deals.data.map((d) => (
                    <option key={d.id} value={d.id}>
                      {locale === 'ar'
                        ? `${d.titleAr} · ${d.merchantNameAr}`
                        : `${d.titleEn} · ${d.merchantNameEn}`}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('pt.ben.kind')} htmlFor="b-kind">
                <Select
                  id="b-kind"
                  value={f.kind}
                  onChange={(e) => setF({ ...f, kind: e.target.value })}
                >
                  {PARTNER_BENEFIT_KINDS.map((x) => (
                    <option key={x} value={x}>
                      {t(k('pt.bkind', x))}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('pt.ben.value')} htmlFor="b-value">
                <Input
                  id="b-value"
                  dir="ltr"
                  inputMode="decimal"
                  value={f.valueNumber}
                  onChange={(e) => setF({ ...f, valueNumber: e.target.value })}
                />
              </Field>
              <Field label={t('pt.ben.labelEn')} htmlFor="b-len" error={cmd.fields.labelEn}>
                <Input
                  id="b-len"
                  value={f.labelEn}
                  onChange={(e) => setF({ ...f, labelEn: e.target.value })}
                />
              </Field>
              <Field label={t('pt.ben.labelAr')} htmlFor="b-lar" error={cmd.fields.labelAr}>
                <Input
                  id="b-lar"
                  dir="rtl"
                  value={f.labelAr}
                  onChange={(e) => setF({ ...f, labelAr: e.target.value })}
                />
              </Field>
              <Field label={t('pt.ben.termsEn')} htmlFor="b-ten">
                <Textarea
                  id="b-ten"
                  rows={2}
                  value={f.termsEn}
                  onChange={(e) => setF({ ...f, termsEn: e.target.value })}
                />
              </Field>
              <Field label={t('pt.ben.termsAr')} htmlFor="b-tar">
                <Textarea
                  id="b-tar"
                  dir="rtl"
                  rows={2}
                  value={f.termsAr}
                  onChange={(e) => setF({ ...f, termsAr: e.target.value })}
                />
              </Field>
              <Checkbox
                checked={f.mine}
                onChange={(e) => setF({ ...f, mine: e.target.checked })}
                label={t('pt.camp.eligibilityMine')}
              />
              <div>
                <Button
                  onClick={() => void propose()}
                  loading={cmd.busy}
                  data-testid="pt-ben-propose"
                >
                  {t('pt.ben.propose')}
                </Button>
              </div>
            </div>
          ) : (
            <Alert tone="info">{t('pt.ben.noDeals')}</Alert>
          )}
        </Card>
      ) : null}
      <Card>
        <Loaded res={res} empty={(d) => !d.length}>
          {(d) => (
            <div style={{ overflowX: 'auto' }}>
              <table className="dd-table" data-testid="pt-ben-table">
                <tbody>
                  {d.map((b) => (
                    <tr key={b.id}>
                      <td>
                        {locale === 'ar' ? b.labelAr : b.labelEn}
                        <div className="dd-muted dd-ltr">{b.reference}</div>
                      </td>
                      <td>{locale === 'ar' ? b.merchantNameAr : b.merchantNameEn}</td>
                      <td>{t(k('pt.bkind', b.kind))}</td>
                      <td>
                        <Chip v={b.status} label={t(k('pt.bstate', b.status))} />
                        {b.decisionReason ? (
                          <div className="dd-muted">{b.decisionReason}</div>
                        ) : null}
                      </td>
                      <td>
                        {perms.includes('partner.campaigns.manage') &&
                        ['PROPOSED', 'MERCHANT_APPROVED', 'ACTIVE', 'SUSPENDED'].includes(
                          b.status,
                        ) ? (
                          <Button size="sm" variant="ghost" onClick={() => void withdraw(b.id)}>
                            {t('pt.ben.withdraw')}
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

// ================================================================ builder (Exclusive Deal / Voucher at a registered network merchant)
interface NetRow {
  id: string;
  nameEn: string;
  nameAr: string | null;
  organizationId: string | null;
  registration: string;
  state: string;
}
interface Assets {
  images: Array<{ fileId: string; url: string | null }>;
  branches: Array<{
    id: string;
    nameEn: string;
    nameAr: string;
    city: string | null;
    country: string;
  }>;
}
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 16);

export function PartnerCampaignBuilderPage() {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.camp.builder')}
      intro={t('pt.camp.partyRoles')}
      any={['partner.campaigns.manage']}
      module="CAMPAIGNS"
      testId="pt-camp-builder"
    >
      {(orgId) => <Builder orgId={orgId} />}
    </PartnerPage>
  );
}

function Builder({ orgId }: { orgId: string }) {
  const { locale } = useAuth();
  const t = useT();
  const router = useRouter();
  const cmd = useCmd();
  const network = useResource<{ items: NetRow[] }>(`${pbase(orgId)}/network`, {
    registration: 'REGISTERED',
    limit: 200,
  });
  const categories =
    useResource<Array<{ id: string; nameEn: string; nameAr: string }>>('/v1/app/categories');
  const [product, setProduct] = useState<'EXCLUSIVE' | 'VOUCHER'>('EXCLUSIVE');
  const [merchant, setMerchant] = useState('');
  const assets = useResource<Assets>(
    merchant ? `${pbase(orgId)}/campaigns/merchants/${merchant}/assets` : null,
  );
  const [branches, setBranches] = useState<string[]>([]);
  const [f, setF] = useState({
    categoryId: '',
    fileId: '',
    titleEn: '',
    titleAr: '',
    offerEn: '',
    offerAr: '',
    descEn: '',
    descAr: '',
    normal: '',
    deal: '',
    units: '10',
    start: inDays(1),
    end: inDays(14),
    sponsor: '',
    mine: false,
  });
  const registered = (network.data?.items ?? []).filter(
    (m) => m.organizationId && m.state === 'REGISTERED_ACTIVE',
  );
  const sar = (s: string) => Math.round(Number(s || '0') * 100);
  const content = () => {
    const eligibility = f.mine
      ? { kind: 'BANK_CARD', valueRefs: [orgId] }
      : { kind: 'PUBLIC', valueRefs: [] };
    const media =
      f.fileId || assets.data?.images[0]?.fileId
        ? [
            {
              fileId: f.fileId || assets.data!.images[0]!.fileId,
              altEn: f.titleEn || 'Offer',
              altAr: f.titleAr || 'عرض',
            },
          ]
        : [];
    const sponsors = f.sponsor ? [{ organizationId: orgId, perUnitHalalas: sar(f.sponsor) }] : [];
    const categoryId = f.categoryId || categories.data?.[0]?.id || null;
    if (product === 'EXCLUSIVE')
      return {
        categoryId,
        mechanic: 'AMOUNT_OFF',
        valueNumber: Math.max(1, Math.round((sar(f.normal) - sar(f.deal)) / 100)),
        offerLabel: { en: f.offerEn, ar: f.offerAr },
        title: { en: f.titleEn, ar: f.titleAr },
        shortDescription: { en: f.offerEn, ar: f.offerAr },
        description: { en: f.descEn, ar: f.descAr },
        media,
        limitType: 'TIME_AND_QUANTITY',
        reservationsEnabled: true,
        allocations: branches.map((branchId) => ({ branchId, units: Number(f.units) || 1 })),
        commercial: {
          normalPriceHalalas: sar(f.normal) || null,
          dealPriceHalalas: sar(f.deal) || null,
          maxRedemptions: (Number(f.units) || 1) * Math.max(1, branches.length),
          sponsors,
        },
        perCustomerLimit: 1,
        holdMinutes: null,
        startAt: new Date(f.start).toISOString(),
        endAt: new Date(f.end).toISOString(),
        eligibility,
        terms: {
          blocks: {
            fullPriceItemsOnly: false,
            notCombinable: true,
            validDays: [],
            minimumSpendHalalas: null,
            validFrom: null,
            validTo: null,
          },
          textEn: f.descEn,
          textAr: f.descAr,
        },
      };
    return {
      categoryId,
      title: { en: f.titleEn, ar: f.titleAr },
      shortDescription: { en: f.offerEn, ar: f.offerAr },
      description: { en: f.descEn, ar: f.descAr },
      media,
      faceValueHalalas: sar(f.normal),
      sellingPriceHalalas: sar(f.deal),
      totalQty: Number(f.units) || 1,
      perCustomerLimit: 1,
      validity: { type: 'DAYS_FROM_PURCHASE', days: 30, validUntil: null },
      saleStartAt: new Date(f.start).toISOString(),
      saleEndAt: new Date(f.end).toISOString(),
      branchIds: branches,
      eligibility,
      redemptionRules: { en: f.descEn, ar: f.descAr },
      terms: {
        blocks: {
          fullPriceItemsOnly: false,
          notCombinable: true,
          validDays: [],
          minimumSpendHalalas: null,
          validFrom: null,
          validTo: null,
        },
        textEn: f.descEn,
        textAr: f.descAr,
      },
      commercial: { sponsors },
    };
  };
  const create = async () => {
    const r = await cmd.run<{ id: string }>(
      'POST',
      `${pbase(orgId)}/campaigns`,
      { product, merchantOrganizationId: merchant, content: content() },
      t('pt.camp.created'),
    );
    if (r.ok && r.data) router.push(withLocale(`/campaigns/${product}/${r.data.id}`, locale));
  };
  const input = (key: keyof typeof f, label: string, dir?: 'ltr' | 'rtl', type = 'text') => (
    <Field label={label} htmlFor={`cb-${key}`}>
      <Input
        id={`cb-${key}`}
        type={type}
        dir={dir}
        value={String(f[key])}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </Field>
  );
  return (
    <div className="dd-stack" style={{ gap: 12 }}>
      {cmd.banner}
      <Card>
        <h2 className="dd-title">{t('pt.camp.step.product')}</h2>
        <Select
          aria-label={t('pt.product')}
          value={product}
          onChange={(e) => setProduct(e.target.value as typeof product)}
          data-testid="pt-cb-product"
        >
          <option value="EXCLUSIVE">{t('pt.product.EXCLUSIVE')}</option>
          <option value="VOUCHER">{t('pt.product.VOUCHER')}</option>
        </Select>
      </Card>
      <Card>
        <h2 className="dd-title">{t('pt.camp.step.merchant')}</h2>
        <Loaded res={network}>
          {() =>
            registered.length ? (
              <div className="dd-stack" style={{ gap: 8 }}>
                <Select
                  aria-label={t('pt.camp.chooseMerchant')}
                  value={merchant}
                  onChange={(e) => {
                    setMerchant(e.target.value);
                    setBranches([]);
                  }}
                  data-testid="pt-cb-merchant"
                >
                  <option value="">{t('pt.camp.chooseMerchant')}</option>
                  {registered.map((m) => (
                    <option key={m.id} value={m.organizationId!}>
                      {locale === 'ar' && m.nameAr ? m.nameAr : m.nameEn}
                    </option>
                  ))}
                </Select>
                {assets.data ? (
                  <>
                    <strong>{t('pt.camp.branches')}</strong>
                    {assets.data.branches.map((b) => (
                      <Checkbox
                        key={b.id}
                        checked={branches.includes(b.id)}
                        onChange={(e) =>
                          setBranches(
                            e.target.checked
                              ? [...branches, b.id]
                              : branches.filter((x) => x !== b.id),
                          )
                        }
                        label={`${locale === 'ar' ? b.nameAr : b.nameEn}${b.city ? ` · ${b.city}` : ''}`}
                        data-testid={`pt-cb-branch-${b.id}`}
                      />
                    ))}
                    <strong>{t('pt.camp.image')}</strong>
                    {assets.data.images.length ? (
                      <div className="dd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        {assets.data.images.map((i) => (
                          <label key={i.fileId} className="dd-row" style={{ gap: 4 }}>
                            <input
                              type="radio"
                              name="cb-image"
                              checked={(f.fileId || assets.data!.images[0]!.fileId) === i.fileId}
                              onChange={() => setF({ ...f, fileId: i.fileId })}
                            />
                            {i.url ? (
                              <img
                                src={i.url}
                                alt=""
                                width={72}
                                height={48}
                                style={{ objectFit: 'cover', borderRadius: 8 }}
                              />
                            ) : null}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="dd-muted">{t('pt.camp.noImages')}</p>
                    )}
                  </>
                ) : null}
              </div>
            ) : (
              <Alert tone="info">{t('pt.camp.noMerchants')}</Alert>
            )
          }
        </Loaded>
      </Card>
      <Card>
        <h2 className="dd-title">{t('pt.camp.step.offer')}</h2>
        <div
          style={{
            display: 'grid',
            gap: 8,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
          data-testid="pt-cb-offer"
        >
          <Field label={t('nav.campaigns')} htmlFor="cb-cat">
            <Select
              id="cb-cat"
              value={f.categoryId}
              onChange={(e) => setF({ ...f, categoryId: e.target.value })}
            >
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {locale === 'ar' ? c.nameAr : c.nameEn}
                </option>
              ))}
            </Select>
          </Field>
          {input('titleEn', t('pt.camp.titleEn'))}
          {input('titleAr', t('pt.camp.titleAr'), 'rtl')}
          {input('offerEn', t('pt.camp.offerEn'))}
          {input('offerAr', t('pt.camp.offerAr'), 'rtl')}
          {input('descEn', t('pt.camp.descEn'))}
          {input('descAr', t('pt.camp.descAr'), 'rtl')}
          {input('normal', t('pt.camp.normalPrice'), 'ltr')}
          {input('deal', t('pt.camp.dealPrice'), 'ltr')}
          {input('units', t('pt.camp.units'), 'ltr')}
          {input('start', t('pt.camp.start'), 'ltr', 'datetime-local')}
          {input('end', t('pt.camp.end'), 'ltr', 'datetime-local')}
        </div>
      </Card>
      <Card>
        <h2 className="dd-title">{t('pt.camp.step.funding')}</h2>
        {input('sponsor', t('pt.camp.sponsor'), 'ltr')}
        <p className="dd-muted">{t('pt.camp.sponsorHelp')}</p>
        <h2 className="dd-title">{t('pt.camp.step.eligibility')}</h2>
        <Checkbox
          checked={f.mine}
          onChange={(e) => setF({ ...f, mine: e.target.checked })}
          label={t('pt.camp.eligibilityMine')}
        />
      </Card>
      <div>
        <Button
          onClick={() => void create()}
          loading={cmd.busy}
          disabled={!merchant || !branches.length || !f.titleEn}
          data-testid="pt-cb-create"
        >
          {t('pt.camp.create')}
        </Button>
      </div>
    </div>
  );
}

// ================================================================ detail (shared engine view + shared commercial panel)
export function PartnerCampaignDetailPage({ product, id }: { product: string; id: string }) {
  const t = useT();
  return (
    <PartnerPage
      title={t('pt.camp.detail')}
      any={['partner.campaigns.read']}
      testId="pt-camp-detail"
    >
      {(orgId) => <Detail orgId={orgId} product={product} id={id} />}
    </PartnerPage>
  );
}

function Detail({ orgId, product, id }: { orgId: string; product: string; id: string }) {
  const { locale } = useAuth();
  const t = useT();
  const perms = usePerms();
  const cmd = useCmd();
  const [refresh, setRefresh] = useState(0);
  const res = useResource<{
    campaign: { status: string; content: { title: { en: string; ar: string } }; version: number };
    merchantOrganizationId: string;
    caseId: string;
  }>(`${pbase(orgId)}/campaigns/${product}/${id}`, { r: refresh });
  const submit = async () => {
    const r = await cmd.run(
      'POST',
      `${pbase(orgId)}/campaigns/${product}/${id}/submit`,
      {},
      t('pt.camp.submitted'),
    );
    if (r.ok) setRefresh((x) => x + 1);
  };
  return (
    <Loaded res={res}>
      {(d) => (
        <div className="dd-stack" style={{ gap: 12 }}>
          {cmd.banner}
          <Card>
            <div
              className="dd-row"
              style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}
            >
              <h2 className="dd-title" style={{ margin: 0 }} data-testid="pt-camp-title">
                {locale === 'ar' ? d.campaign.content.title.ar : d.campaign.content.title.en}
              </h2>
              <Chip
                v={d.campaign.status}
                label={`${t(k('pt.product', product))} · ${d.campaign.status}`}
                testId="pt-camp-status"
              />
            </div>
            <p className="dd-muted">{t('pt.camp.partyRoles')}</p>
            {perms.includes('partner.campaigns.manage') &&
            ['DRAFT', 'NEEDS_CHANGES'].includes(d.campaign.status) ? (
              <Button onClick={() => void submit()} loading={cmd.busy} data-testid="pt-camp-submit">
                {t('pt.camp.submit')}
              </Button>
            ) : null}
          </Card>
          <CommercialPanel
            orgId={orgId}
            product={product as 'EXCLUSIVE'}
            subjectId={id}
            content={d.campaign.content}
            base={`${pbase(orgId)}/commercial`}
            previewExtra={{ merchantOrganizationId: d.merchantOrganizationId }}
            refreshKey={refresh}
          />
        </div>
      )}
    </Loaded>
  );
}
