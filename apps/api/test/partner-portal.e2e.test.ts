import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_PROVIDER } from '../src/providers/interfaces';
import type { MockEmailProvider } from '../src/providers/mocks';
import {
  DB_READY,
  createBusinessUser,
  createPartnerOrg,
  createTestApp,
  idem,
  passwordSession,
  type Session,
  type TestApp,
} from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';
import { validVoucherContent } from './voucher-fixtures';
import { validWatchContent } from './watch-fixtures';
import { CommercialService } from '../src/finance/commercial.service';
import { evaluateEligibility } from '../src/live-deals/eligibility.service';

/**
 * Stage 7 — Enterprise Partner Portal on the shared platform: onboarding / readiness with a second approver, partner users and
 * delegation, multi-market scope, merchant network (manual, bulk with mapping, API) with provenance and duplicates, referenced vs
 * registered merchants, partner-created Exclusive Deals / Vouchers on the shared engines with the merchant's own acceptance,
 * Live Deal partner benefits, card-data privacy, eligibility, Watch & Earn / loyalty funding, inbox, dashboard, AI, and isolation.
 */
describe.skipIf(!DB_READY)('Stage 7 partner portal', () => {
  let t: TestApp;
  let w: HotWorld;
  let email: MockEmailProvider;
  let mgmt: Session;
  let mgmt2: Session;
  // a bank partner with a contract, two legal entities (SA, AE) and a billing account
  let bank: string;
  let bankAdmin: Session;
  let bankCampaigns: Session;
  let bankFinance: Session;
  let bankAnalyst: Session;
  const SAR = 100;

  const post = (s: Session, url: string, body: unknown = {}) =>
    w
      .api(s)
      .post(url)
      .set('Idempotency-Key', idem())
      .send(body as object);
  const put = (s: Session, url: string, body: unknown = {}) =>
    w
      .api(s)
      .put(url)
      .set('Idempotency-Key', idem())
      .send(body as object);
  const pb = (org: string) => `/v1/partners/${org}`;
  const ent = (products: string[], features: string[]) => [
    ...products.map((key) => ({ kind: 'PRODUCT', key })),
    ...features.map((key) => ({ kind: 'FEATURE', key })),
  ];
  const contract = async (org: string, kind: string, products: string[], features: string[]) => {
    const r = await post(w.superAdmin, '/v1/admin/platform/contracts', {
      organizationId: org,
      name: `${kind} test`,
      kind,
      market: 'SA',
      entitlements: ent(products, features),
    });
    if (r.status !== 201) throw new Error(`contract ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data;
  };
  const partnerUser = async (org: string, role: Parameters<typeof createBusinessUser>[1]['role']) =>
    passwordSession(
      t,
      await createBusinessUser(t.prisma, { role, orgId: org, userType: 'PARTNER_USER' }),
      'partner',
    );
  const activePartner = async (label: string, type: 'BANK' | 'SCHEME' | 'EMPLOYER') => {
    const id = await createPartnerOrg(t.prisma, label, type);
    await t.prisma.partner.update({ where: { organizationId: id }, data: { lifecycle: 'ACTIVE' } });
    await t.prisma.legalEntity.create({
      data: { organizationId: id, legalName: `${label} LE`, country: 'SA', currency: 'SAR' },
    });
    return id;
  };
  const caseFor = async (product: string, subjectId: string) =>
    (
      await t.prisma.commercialCase.findUniqueOrThrow({
        where: { product_subjectId: { product: product as never, subjectId } },
      })
    ).id;

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    email = t.app.get(EMAIL_PROVIDER) as MockEmailProvider;
    const dd = (await t.prisma.organization.findFirstOrThrow({ where: { type: 'DEALDASH' } })).id;
    const adm = async () =>
      passwordSession(
        t,
        await createBusinessUser(t.prisma, {
          role: 'DEALDASH_PARTNER_MANAGEMENT',
          orgId: dd,
          userType: 'ADMIN_USER',
          mfa: true,
        }),
        'admin',
        { completeMfa: true },
      );
    mgmt = await adm();
    mgmt2 = await adm();
    bank = await activePartner('Gulf Bank', 'BANK');
    await t.prisma.legalEntity.create({
      data: { organizationId: bank, legalName: 'Gulf Bank Dubai', country: 'AE', currency: 'AED' },
    });
    const le = await t.prisma.legalEntity.findFirstOrThrow({
      where: { organizationId: bank, country: 'SA' },
    });
    await t.prisma.businessAccount.create({
      data: { organizationId: bank, legalEntityId: le.id, currency: 'SAR', fundingMode: 'PREPAID' },
    });
    await contract(
      bank,
      'BANK_ENTERPRISE',
      ['LIVE_DEAL', 'MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY'],
      [
        'BANK_MERCHANT_NETWORK',
        'CARDHOLDER_ELIGIBILITY',
        'API_ACCESS',
        'BULK_IMPORT',
        'AI_COPILOT',
      ],
    );
    bankAdmin = await partnerUser(bank, 'PARTNER_ADMIN');
    bankCampaigns = await partnerUser(bank, 'PARTNER_CAMPAIGN_MANAGER');
    bankFinance = await partnerUser(bank, 'PARTNER_FINANCE_MANAGER');
    bankAnalyst = await partnerUser(bank, 'PARTNER_ANALYST');
  });
  afterAll(() => t?.close());

  // ================================================================ business account, onboarding, readiness
  describe('onboarding and readiness', () => {
    it('DealDash creates a partner Business Account and invites its first administrator, who joins as a partner user', async () => {
      const mail = `first-admin-${idem()}@partner.test`;
      const r = await post(mgmt, '/v1/admin/partners', {
        nameEn: 'North Scheme',
        nameAr: 'شبكة الشمال',
        partnerType: 'SCHEME',
        legalName: 'North Scheme Co.',
        country: 'SA',
        adminName: 'First Admin',
        adminEmail: mail,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data).toMatchObject({
        lifecycle: 'DRAFT',
        status: 'DRAFT',
        partnerType: 'SCHEME',
      });
      const token = /token=([A-Za-z0-9_-]+)/.exec(email.lastTo(mail)?.body ?? '')?.[1];
      expect(token).toBeTruthy();
      const acc = await t.http
        .post(`/v1/merchant-signup/invitations/${token}/accept`)
        .send({ password: 'Partner-Pass-123!' });
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      expect((await t.prisma.user.findUniqueOrThrow({ where: { email: mail } })).userType).toBe(
        'PARTNER_USER',
      );
      // nothing operates before onboarding is complete
      expect(
        await t.prisma.legalEntity.count({ where: { organizationId: r.body.data.organizationId } }),
      ).toBe(1);
    });

    it('lifecycle: the partner submits; DealDash reviews; each step needs its readiness; ACTIVE waits for a second administrator', async () => {
      const org = await createPartnerOrg(t.prisma, 'Onboard Bank', 'BANK');
      const admin = await partnerUser(org, 'PARTNER_ADMIN');
      // submitting without a profile, legal entity, contacts and signatory is refused with what is missing
      const early = await post(admin, `${pb(org)}/onboarding/submit`);
      expect(early.status).toBe(409);
      expect(early.body.errors[0].code).toBe('PARTNER_NOT_READY');
      await t.prisma.legalEntity.create({
        data: { organizationId: org, legalName: 'Onboard Bank SA', country: 'SA', currency: 'SAR' },
      });
      const prof = await put(admin, `${pb(org)}/profile`, {
        legalName: 'Onboard Bank SA',
        registrationNumber: 'CR-1010',
        requestedMarkets: ['SA'],
        contacts: { primary: { name: 'Ops Lead', email: 'ops@onboard.test' } },
        signatory: { name: 'CEO', email: 'ceo@onboard.test', title: 'Chief Executive' },
      });
      expect(prof.status, JSON.stringify(prof.body)).toBe(200);
      expect((await post(admin, `${pb(org)}/onboarding/submit`)).status).toBe(200);
      const step = (s: Session, to: string) =>
        post(s, `/v1/admin/partners/${org}/lifecycle`, { to, reason: `to ${to}` });
      expect((await step(mgmt, 'APPROVED')).status).toBe(200);
      // locked identity after review
      expect(
        (
          await put(admin, `${pb(org)}/profile`, {
            legalName: 'Another Name',
            requestedMarkets: ['SA'],
            contacts: { primary: { name: 'x', email: 'x@y.test' } },
          })
        ).status,
      ).toBe(409);
      const noContract = await step(mgmt, 'CONTRACT_ACTIVE');
      expect(noContract.status).toBe(409);
      expect(noContract.body.errors[0].code).toBe('PARTNER_NOT_READY');
      await contract(org, 'BANK_ENTERPRISE', ['EXCLUSIVE'], []);
      expect((await step(mgmt, 'CONTRACT_ACTIVE')).status).toBe(200);
      expect((await step(mgmt, 'FINANCE_READY')).status).toBe(409); // no billing account / funding
      const le = await t.prisma.legalEntity.findFirstOrThrow({ where: { organizationId: org } });
      await t.prisma.businessAccount.create({
        data: {
          organizationId: org,
          legalEntityId: le.id,
          currency: 'SAR',
          fundingMode: 'PREPAID',
        },
      });
      expect((await step(mgmt, 'FINANCE_READY')).status).toBe(200);
      expect((await step(mgmt, 'PRODUCT_ENABLED')).status).toBe(200);
      expect((await step(mgmt, 'ACTIVE')).status).toBe(200);
      const pending = await t.prisma.partner.findUniqueOrThrow({ where: { organizationId: org } });
      expect(pending).toMatchObject({ lifecycle: 'PRODUCT_ENABLED', pendingLifecycle: 'ACTIVE' });
      // the requester can never approve; a second administrator can
      const same = await post(mgmt, `/v1/admin/partners/${org}/lifecycle/approve`, {});
      expect(same.status).toBe(403);
      expect((await post(mgmt2, `/v1/admin/partners/${org}/lifecycle/approve`, {})).status).toBe(
        200,
      );
      const done = await t.prisma.partner.findUniqueOrThrow({
        where: { organizationId: org },
        include: { organization: true },
      });
      expect(done.lifecycle).toBe('ACTIVE');
      expect(done.organization.status).toBe('ACTIVE');
      const hist = await w.api(mgmt).get(`/v1/admin/partners/${org}/history`);
      expect(hist.body.data.map((h: { action: string }) => h.action)).toEqual(
        expect.arrayContaining(['partner.lifecycle.changed', 'partner.lifecycle.requested']),
      );
      // the partner's own readiness view shows the checklist (market validation items are shown, never hidden)
      const rd = await w.api(admin).get(`${pb(org)}/readiness`);
      expect(rd.body.data.items.map((i: { check: string }) => i.check)).toEqual(
        expect.arrayContaining(['CONTRACT', 'BILLING_ACCOUNT', 'FUNDING', 'MARKET_VALIDATIONS']),
      );
    });

    it('a partner that is not ACTIVE cannot create new exposure', async () => {
      const org = await createPartnerOrg(t.prisma, 'Draft Bank', 'BANK');
      await contract(org, 'BANK_ENTERPRISE', ['MEMBER_BENEFIT'], []);
      const admin = await partnerUser(org, 'PARTNER_ADMIN');
      const deal = await w.publish('A');
      const r = await post(admin, `${pb(org)}/benefits`, {
        liveDealId: deal.id,
        kind: 'EXTRA_PERCENT',
        valueNumber: 5,
        labelEn: 'Extra 5%',
        labelAr: 'خصم إضافي 5%',
        eligibility: { kind: 'PUBLIC', valueRefs: [] },
      });
      expect(r.status).toBe(409);
      expect(r.body.errors[0].code).toBe('PARTNER_NOT_ACTIVE');
    });
  });

  // ================================================================ users, delegation, scope, multi-market
  describe('users, delegation and market scope', () => {
    it('a partner admin invites within its own roles; a campaign manager cannot manage users', async () => {
      const r = await post(bankAdmin, `${pb(bank)}/users/invitations`, {
        name: 'Analyst Two',
        email: `analyst-${idem()}@bank.test`,
        roleCode: 'PARTNER_ANALYST',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(
        (
          await post(bankAdmin, `${pb(bank)}/users/invitations`, {
            name: 'X',
            email: `x-${idem()}@bank.test`,
            roleCode: 'DEALDASH_SUPER_ADMIN',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post(bankCampaigns, `${pb(bank)}/users/invitations`, {
            name: 'Y',
            email: `y-${idem()}@bank.test`,
            roleCode: 'PARTNER_ANALYST',
          })
        ).status,
      ).toBe(403);
      const list = await w.api(bankAdmin).get(`${pb(bank)}/users`);
      expect(list.status).toBe(200);
      expect(list.body.data.invitations.length).toBeGreaterThan(0);
    });

    it('a country-scoped administrator sees only its market and cannot grant organization-wide access (no escalation)', async () => {
      const u = await createBusinessUser(t.prisma, {
        role: 'PARTNER_ADMIN',
        orgId: bank,
        userType: 'PARTNER_USER',
        label: 'sa-admin',
      });
      const m = await t.prisma.organizationMembership.findFirstOrThrow({
        where: { userId: u.id, organizationId: bank },
      });
      expect(
        (await post(bankAdmin, `/v1/orgs/${bank}/members/${m.id}/scoped`, { scoped: true })).status,
      ).toBe(200);
      const asg = await post(bankAdmin, `/v1/orgs/${bank}/assignments`, {
        membershipId: m.id,
        roleCode: 'PARTNER_ADMIN',
        scope: { kind: 'COUNTRY', ref: 'SA' },
      });
      expect(asg.status, JSON.stringify(asg.body)).toBe(201);
      const s = await passwordSession(t, { id: u.id, email: u.email } as never, 'partner');
      const markets = await w.api(s).get(`${pb(bank)}/markets`);
      expect(markets.status).toBe(200);
      expect(markets.body.data.map((x: { code: string }) => x.code)).toEqual(['SA']);
      const all = await w.api(bankAdmin).get(`${pb(bank)}/markets`);
      expect(all.body.data.map((x: { code: string }) => x.code).sort()).toEqual(['AE', 'SA']);
      // organization-level user management needs an organization-wide grant: a country admin cannot hand out access
      expect(
        (
          await post(s, `${pb(bank)}/users/invitations`, {
            name: 'Z',
            email: `z-${idem()}@bank.test`,
            roleCode: 'PARTNER_ADMIN',
          })
        ).status,
      ).toBe(403);
      // a merchant added in an unauthorized market is refused for the country admin
      const r = await post(s, `${pb(bank)}/network/merchants`, {
        nameEn: 'Dubai Diner',
        country: 'AE',
      });
      expect([403, 404]).toContain(r.status);
    });
  });

  // ================================================================ merchant network
  describe('merchant network', () => {
    it('manual one-by-one: the shared ingestion pipeline records provenance; a referenced merchant gains no controlled product', async () => {
      const r = await post(bankAdmin, `${pb(bank)}/network/merchants`, {
        externalMerchantId: 'GB-M-1',
        nameEn: 'Corner Bakery Riyadh',
        brand: 'Corner Bakery',
        country: 'SA',
        branches: [{ nameEn: 'Corner Bakery Olaya', city: 'Riyadh' }],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const d = await w.api(bankAnalyst).get(`${pb(bank)}/network/merchants/${r.body.data.id}`);
      expect(d.status).toBe(200);
      expect(d.body.data.state).toBe('REFERENCED');
      expect(Object.values(d.body.data.capabilities).every((v) => v === false)).toBe(true);
      expect(d.body.data.provenance[0]).toMatchObject({
        sourceRecordId: 'GB-M-1',
        importMethod: 'MANUAL',
      });
      expect(d.body.data.branches).toHaveLength(1);
    });

    it('duplicates: a near-identical name is suggested, never merged; the partner gives its view and DealDash decides', async () => {
      await post(bankAdmin, `${pb(bank)}/network/merchants`, {
        externalMerchantId: 'GB-M-2',
        nameEn: 'Corner Bakery Riyadh LLC',
        country: 'SA',
      });
      const dups = await w.api(bankAdmin).get(`${pb(bank)}/network/duplicates`);
      expect(dups.status).toBe(200);
      expect(dups.body.data.length).toBeGreaterThan(0);
      const c = dups.body.data[0];
      expect(
        (
          await post(bankAdmin, `${pb(bank)}/network/duplicates/${c.id}`, {
            decision: 'SUGGEST_MERGE',
            note: 'same bakery',
          })
        ).status,
      ).toBe(200);
      const row = await t.prisma.matchCandidate.findUniqueOrThrow({ where: { id: c.id } });
      expect(row).toMatchObject({ status: 'PENDING', partnerSuggestion: 'SUGGEST_MERGE' });
    });

    it('bulk file with field mapping uses the shared importer; the partner bulk feature AND BULK_IMPORT are both required', async () => {
      const csv =
        'Merchant Ref,Merchant Name,country\nGB-B-1,Bulk Cafe One,SA\nGB-B-2,Bulk Cafe Two,SA\n';
      const r = await post(bankAdmin, `/v1/partners/${bank}/network/imports`, {
        kind: 'MERCHANTS',
        sourceSystem: 'gulfbank-file',
        fileName: 'network.csv',
        csv,
        mapping: { 'Merchant Ref': 'source_record_id', 'Merchant Name': 'name_en' },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data.totals).toMatchObject({ rows: 2, errors: 0 });
      expect(
        (
          await post(bankAdmin, `/v1/partners/${bank}/network/imports`, {
            kind: 'MERCHANTS',
            sourceSystem: 'x',
            csv: 'a,b\n1,2\n',
            mapping: { a: 'not_a_column' },
          })
        ).status,
      ).toBe(400);
      // a partner with BULK_IMPORT but no partner bulk-ingestion feature is refused
      const corp = await activePartner('Bulk Corp', 'EMPLOYER');
      await contract(corp, 'CORPORATE_PARTNER', ['LOYALTY'], ['BULK_IMPORT']);
      const corpAdmin = await partnerUser(corp, 'PARTNER_ADMIN');
      const refused = await post(corpAdmin, `/v1/partners/${corp}/network/imports`, {
        kind: 'MERCHANTS',
        sourceSystem: 'corp-file',
        csv: 'source_record_id,name_en,country\nC1,Corp Cafe,SA\n',
      });
      expect(refused.status).toBe(403);
      expect(refused.body.errors[0].code).toBe('ENTITLEMENT_REQUIRED');
      // the shared Phase 2 import route keeps its frozen rule (BULK_IMPORT only); the stricter partner rule is the portal's
      expect(
        (
          await post(corpAdmin, `/v1/orgs/${corp}/imports`, {
            kind: 'MERCHANTS',
            sourceSystem: 'corp-file',
            csv: 'source_record_id,name_en,country\nC1,Corp Cafe,SA\n',
          })
        ).status,
      ).toBe(201);
      const tpl = await w.api(bankAdmin).get(`${pb(bank)}/network/templates/MERCHANTS`);
      expect(tpl.text.split('\n')[0]).toContain('source_record_id');
    });

    it('API feed: API_ACCESS plus one partner API-ingestion feature; the key is shown once and never again', async () => {
      const r = await post(bankAdmin, `/v1/partners/${bank}/integrations`, {
        name: 'Bank merchant feed',
        sourceSystem: `gulfbank-api-${idem()}`,
        kind: 'API_PUSH',
        scopes: ['MERCHANT'],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data.apiKey).toBeTruthy();
      const list = await w.api(bankAdmin).get(`/v1/orgs/${bank}/integrations`);
      expect(JSON.stringify(list.body.data)).not.toContain(r.body.data.apiKey);
      const corp = await activePartner('Api Corp', 'EMPLOYER');
      await contract(corp, 'CORPORATE_PARTNER', ['LOYALTY'], ['API_ACCESS']);
      const corpAdmin = await partnerUser(corp, 'PARTNER_ADMIN');
      const no = await post(corpAdmin, `/v1/partners/${corp}/integrations`, {
        name: 'Corp feed',
        sourceSystem: `corp-api-${idem()}`,
        kind: 'API_PUSH',
        scopes: ['MERCHANT'],
      });
      expect(no.status).toBe(403);
    });

    it('a corporate without network entitlements cannot add merchants by hand (contract, not the screen, decides)', async () => {
      const corp = await activePartner('No Net Corp', 'EMPLOYER');
      await contract(corp, 'CORPORATE_PARTNER', ['LOYALTY'], ['EMPLOYEE_PROGRAMS']);
      const s = await partnerUser(corp, 'PARTNER_ADMIN');
      const r = await post(s, `${pb(corp)}/network/merchants`, {
        nameEn: 'Corp Lunch',
        country: 'SA',
      });
      expect(r.status).toBe(403);
    });
  });

  // ================================================================ eligibility and card privacy
  describe('eligibility and card / scheme privacy', () => {
    it('card programmes keep BIN / IIN prefixes only (6-8 digits); a card number is refused by the API and the database', async () => {
      const ok = await post(bankAdmin, `${pb(bank)}/card-programs`, {
        code: 'GB-PLAT',
        nameEn: 'Gulf Platinum',
        nameAr: 'بلاتينيوم الخليج',
        scheme: 'visa',
        issuerName: 'Gulf Bank',
        productCode: 'GB-PLAT',
        tier: 'platinum',
        binPrefixes: ['4123456'],
        market: 'SA',
        status: 'ACTIVE',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(
        (
          await post(bankAdmin, `${pb(bank)}/card-programs`, {
            code: 'BAD',
            nameEn: 'Bad',
            nameAr: 'سيء',
            scheme: 'visa',
            issuerName: 'Gulf Bank',
            productCode: 'BAD',
            tier: 'gold',
            binPrefixes: ['4111111111111111'],
            market: 'SA',
          })
        ).status,
      ).toBe(400);
      await expect(
        t.prisma.partnerCardProgram.update({
          where: { id: ok.body.data.id },
          data: { binPrefixes: ['4111111111111111'] },
        }),
      ).rejects.toThrow();
    });

    it('nested AND / OR rules use the shared engine; only the type profile attributes; tested against a sample profile', async () => {
      const expr = {
        op: 'OR',
        children: [
          {
            op: 'AND',
            children: [
              { op: 'ATTR', attr: 'SCHEME', values: [bank] },
              { op: 'ATTR', attr: 'CARD_TIER', values: ['platinum'] },
            ],
          },
          { op: 'ATTR', attr: 'GEOGRAPHY', values: ['Riyadh'] },
        ],
      };
      // SCHEME values must be scheme partners: a bank's own id is refused by the shared engine
      expect(
        (await post(bankAdmin, `${pb(bank)}/eligibility/rules`, { name: 'bad', expression: expr }))
          .status,
      ).toBe(400);
      const good = {
        op: 'AND',
        children: [
          { op: 'ATTR', attr: 'CARD', values: [bank] },
          { op: 'ATTR', attr: 'CARD_TIER', values: ['platinum'] },
        ],
      };
      const saved = await post(bankAdmin, `${pb(bank)}/eligibility/rules`, {
        name: 'Platinum holders',
        expression: good,
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
      const yes = await w
        .api(bankAdmin)
        .post(`${pb(bank)}/eligibility/test`)
        .send({
          expression: good,
          sample: {
            attributes: [
              { attr: 'CARD', value: bank },
              { attr: 'CARD_TIER', value: 'platinum' },
            ],
          },
        });
      expect(yes.body.data.result).toBe('ELIGIBLE');
      const no = await w
        .api(bankAdmin)
        .post(`${pb(bank)}/eligibility/test`)
        .send({ expression: good, sample: { attributes: [{ attr: 'CARD', value: bank }] } });
      expect(no.body.data.result).not.toBe('ELIGIBLE');
      // a tier that is not one of the bank's active programmes, and an attribute outside the bank profile, are refused
      expect(
        (
          await post(bankAdmin, `${pb(bank)}/eligibility/rules`, {
            name: 'x',
            expression: { op: 'ATTR', attr: 'CARD_TIER', values: ['diamond'] },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await post(bankAdmin, `${pb(bank)}/eligibility/rules`, {
            name: 'x',
            expression: { op: 'ATTR', attr: 'EMPLOYER', values: [bank] },
          })
        ).status,
      ).toBe(403);
    });

    it('employer programmes keep work-email domains (aggregate counts only); one domain belongs to one employer', async () => {
      const corp = await activePartner('Domain Corp', 'EMPLOYER');
      await contract(corp, 'CORPORATE_PARTNER', ['LOYALTY'], ['EMPLOYEE_PROGRAMS']);
      const s = await partnerUser(corp, 'PARTNER_ADMIN');
      const d = `corp-${idem().slice(2, 8)}.example`;
      const r = await post(s, `${pb(corp)}/employer-programs`, {
        code: 'STAFF',
        nameEn: 'Staff benefits',
        nameAr: 'مزايا الموظفين',
        domains: [d],
        market: 'SA',
        status: 'ACTIVE',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const list = await w.api(s).get(`${pb(corp)}/employer-programs`);
      expect(list.body.data[0]).toHaveProperty('verifiedMembers');
      expect(JSON.stringify(list.body.data)).not.toMatch(/@/);
      const other = await activePartner('Other Corp', 'EMPLOYER');
      await contract(other, 'CORPORATE_PARTNER', ['LOYALTY'], ['EMPLOYEE_PROGRAMS']);
      const os = await partnerUser(other, 'PARTNER_ADMIN');
      expect(
        (
          await post(os, `${pb(other)}/employer-programs`, {
            code: 'XX',
            nameEn: 'X',
            nameAr: 'س',
            domains: [d],
            market: 'SA',
          })
        ).status,
      ).toBe(409);
    });
  });

  // ================================================================ campaigns on the shared engines
  describe('partner-created campaigns (shared engines, merchant approval, commercial gates)', () => {
    it('only a registered, active merchant of the network can fulfil; the partner is creator and owner; the merchant accepts its own obligations', async () => {
      const content = w.hotContent('A', 3, { commercial: { maxRedemptions: 3, sponsors: [] } });
      const notMember = await post(bankCampaigns, `${pb(bank)}/campaigns`, {
        product: 'EXCLUSIVE',
        merchantOrganizationId: w.A.orgId,
        content,
      });
      expect(notMember.status).toBe(409);
      expect(notMember.body.errors[0].code).toBe('PARTNER_MERCHANT_NOT_IN_NETWORK');
      expect((await post(bankAdmin, `${pb(bank)}/network/registered/${w.A.orgId}`)).status).toBe(
        201,
      );
      const assets = await w
        .api(bankCampaigns)
        .get(`${pb(bank)}/campaigns/merchants/${w.A.orgId}/assets`);
      expect(assets.body.data.images.length).toBeGreaterThan(0);
      const created = await post(bankCampaigns, `${pb(bank)}/campaigns`, {
        product: 'EXCLUSIVE',
        merchantOrganizationId: w.A.orgId,
        content,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.id;
      const row = await t.prisma.hotDeal.findUniqueOrThrow({ where: { id } });
      expect(row.organizationId).toBe(w.A.orgId); // runs at the merchant (its branches, staff, inventory)
      expect(
        (row.content as { commercial: { creatorOrganizationId: string } }).commercial
          .creatorOrganizationId,
      ).toBe(bank);
      // the merchant cannot change who created it
      const edit = await w
        .api(w.ownerA)
        .put(`${w.base('A')}/hot-deals/${id}`)
        .send({
          content: {
            ...content,
            commercial: { ...content.commercial, creatorOrganizationId: w.B.orgId },
          },
        });
      expect(edit.status).toBe(400);
      // the commercial case names the partner OWNER and the merchant FULFILMENT_MERCHANT
      const view = await w.api(bankCampaigns).get(`${pb(bank)}/campaigns/EXCLUSIVE/${id}`);
      expect(view.status).toBe(200);
      const caseId = await caseFor('EXCLUSIVE', id);
      const cv = await w.api(bankFinance).get(`${pb(bank)}/commercial/cases/${caseId}`);
      expect(cv.status, JSON.stringify(cv.body)).toBe(200);
      const roles = cv.body.data.preview.parties
        .map(
          (p: { role: string; organizationId: string }) =>
            `${p.role}:${p.organizationId === bank ? 'bank' : p.organizationId === w.A.orgId ? 'A' : '?'}`,
        )
        .sort();
      expect(roles).toEqual(['FULFILMENT_MERCHANT:A', 'OWNER:bank']);
      // inbox: the partner sees the acceptance task
      const inbox = await w.api(bankFinance).get(`/v1/orgs/${bank}/inbox`);
      expect(inbox.body.data.map((i: { kind: string }) => i.kind)).toContain(
        'COMMERCIAL_ACCEPTANCE',
      );
      // submission needs the owner's acceptance (the partner's own); the campaign manager cannot accept (finance can)
      const sub0 = await post(bankCampaigns, `${pb(bank)}/campaigns/EXCLUSIVE/${id}/submit`);
      expect(sub0.status).toBe(422);
      const owner = cv.body.data.preview.parties.find((p: { role: string }) => p.role === 'OWNER');
      expect(
        (
          await post(bankCampaigns, `${pb(bank)}/commercial/cases/${caseId}/accept`, {
            quotationId: cv.body.data.quotation.id,
            checks: owner.requiredChecks,
            language: 'en',
          })
        ).status,
      ).toBe(403);
      const acc = await post(bankFinance, `${pb(bank)}/commercial/cases/${caseId}/accept`, {
        quotationId: cv.body.data.quotation.id,
        checks: owner.requiredChecks,
        language: 'en',
      });
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      const sub = await post(bankCampaigns, `${pb(bank)}/campaigns/EXCLUSIVE/${id}/submit`);
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
      // DealDash cannot activate it before the fulfilment merchant accepts (and the partner funds what it owes)
      expect((await w.decideHot(w.ops, id, 'approve')).status).toBe(409);
      const mv = await w.api(w.ownerA).get(`${w.base('A')}/commercial/cases/${caseId}`);
      const fm = mv.body.data.preview.parties.find(
        (p: { role: string }) => p.role === 'FULFILMENT_MERCHANT',
      );
      expect(
        (
          await post(w.ownerA, `${w.base('A')}/commercial/cases/${caseId}/accept`, {
            quotationId: mv.body.data.quotation.id,
            checks: fm.requiredChecks,
            language: 'en',
          })
        ).status,
      ).toBe(200);
      const after = await w.api(bankFinance).get(`${pb(bank)}/commercial/cases/${caseId}`);
      if (
        (after.body.data.blockers as Array<{ code: string }>).some(
          (b) => b.code === 'FUNDING_MISSING',
        )
      )
        expect(
          (await post(bankFinance, `${pb(bank)}/commercial/cases/${caseId}/pay`, {})).status,
        ).toBe(200);
      const ap = await w.decideHot(w.ops, id, 'approve');
      expect(ap.status, JSON.stringify(ap.body)).toBe(200);
      // the portfolio lists it as a campaign the partner created at merchant A
      const pf = await w.api(bankAnalyst).get(`${pb(bank)}/campaigns`);
      expect(
        pf.body.data.items.find((i: { subjectId: string }) => i.subjectId === id),
      ).toMatchObject({ role: 'CREATOR', merchantOrganizationId: w.A.orgId });
    });

    it('a partner can only commit its own funding; it cannot name another sponsor', async () => {
      const content = w.hotContent('A', 2, {
        commercial: {
          maxRedemptions: 2,
          sponsors: [{ organizationId: w.B.orgId, perUnitHalalas: 2 * SAR }],
        },
      });
      const r = await post(bankCampaigns, `${pb(bank)}/campaigns`, {
        product: 'EXCLUSIVE',
        merchantOrganizationId: w.A.orgId,
        content,
      });
      expect(r.status).toBe(400);
      const own = w.hotContent('A', 2, {
        commercial: {
          maxRedemptions: 2,
          normalPriceHalalas: 50 * SAR,
          dealPriceHalalas: 30 * SAR,
          sponsors: [{ organizationId: bank, perUnitHalalas: 2 * SAR }],
        },
      });
      const prev = await w
        .api(bankCampaigns)
        .post(`${pb(bank)}/campaigns/preview`)
        .send({ product: 'EXCLUSIVE', merchantOrganizationId: w.A.orgId, content: own });
      expect(prev.status, JSON.stringify(prev.body)).toBe(200);
      expect(prev.body.data.lines.map((l: { kind: string }) => l.kind)).toEqual(
        expect.arrayContaining(['DEALDASH_CHARGE', 'SPONSOR_FUNDING', 'MERCHANT_BENEFIT']),
      );
      expect(prev.body.data.totals.maxSponsorLiabilityHalalas).toBe(4 * SAR);
    });

    it('vouchers: the partner creates one at a network merchant; creator, sponsor and fulfilment merchant stay separate roles', async () => {
      const content: Record<string, unknown> = validVoucherContent({
        categoryId: w.dining.id,
        fileId: w.fileA,
        branchIds: [w.A.branchIds[0]!],
      });
      content.commercial = {
        ...((content.commercial as object | undefined) ?? {}),
        sponsors: [{ organizationId: bank, perUnitHalalas: 3 * SAR }],
      };
      const r = await post(bankCampaigns, `${pb(bank)}/campaigns`, {
        product: 'VOUCHER',
        merchantOrganizationId: w.A.orgId,
        content,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const v = await t.prisma.voucher.findUniqueOrThrow({ where: { id: r.body.data.id } });
      expect(v.organizationId).toBe(w.A.orgId); // the fulfilment merchant holds it (redemption, payable)
      const cv = await w.api(bankFinance).get(`${pb(bank)}/commercial/cases/${r.body.data.caseId}`);
      expect(cv.status, JSON.stringify(cv.body)).toBe(200);
      const roles = cv.body.data.preview.parties
        .map(
          (p: { role: string; organizationId: string }) =>
            `${p.role}:${p.organizationId === bank ? 'bank' : 'A'}`,
        )
        .sort();
      // creator / owner, sponsor and fulfilment merchant are separate roles (the bank is both creator and sponsor here)
      expect(roles).toEqual(expect.arrayContaining(['OWNER:bank', 'FULFILMENT_MERCHANT:A']));
      expect(cv.body.data.preview.lines.map((l: { kind: string }) => l.kind)).toContain(
        'SPONSOR_FUNDING',
      );
      // the merchant sees it in its own voucher list (it runs at its branches)
      const mine = await w.api(w.ownerA).get(`${w.base('A')}/vouchers`);
      expect(JSON.stringify(mine.body.data)).toContain(r.body.data.id);
    });
  });

  // ================================================================ Live Deal partner benefit
  describe('Live Deal partner benefit', () => {
    it('proposed by the partner, approved by the merchant, then by DealDash; the public deal stays public; showing is not a redemption', async () => {
      const deal = await w.publish('A');
      const before = await t.prisma.redemption.count();
      const r = await post(bankCampaigns, `${pb(bank)}/benefits`, {
        liveDealId: deal.id,
        kind: 'EXTRA_PERCENT',
        valueNumber: 10,
        labelEn: 'Extra 10% with Gulf Bank cards',
        labelAr: 'خصم إضافي 10% لبطاقات بنك الخليج',
        eligibility: { kind: 'BANK_CARD', valueRefs: [bank] },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const id = r.body.data.id;
      // not visible before the merchant and DealDash approve
      expect(
        (await t.http.get(`/v1/app/live-deals/${deal.id}/partner-benefits`)).body.data,
      ).toEqual([]);
      const mInbox = await w.api(w.ownerA).get(`/v1/orgs/${w.A.orgId}/inbox`);
      expect(mInbox.body.data.map((i: { kind: string }) => i.kind)).toContain(
        'PARTNER_BENEFIT_DECISION',
      );
      expect((await post(w.ops, `/v1/admin/partners/benefits/${id}/approve`, {})).status).toBe(409); // merchant first
      expect(
        (
          await post(w.ownerA, `/v1/merchants/${w.A.orgId}/partner-benefits/${id}/decision`, {
            decision: 'APPROVE',
          })
        ).status,
      ).toBe(200);
      expect((await post(w.ops, `/v1/admin/partners/benefits/${id}/approve`, {})).status).toBe(200);
      // a guest sees the benefit as unlockable; the public deal itself is unchanged
      const guest = await t.http.get(`/v1/app/live-deals/${deal.id}/partner-benefits`);
      expect(guest.body.data).toHaveLength(1);
      expect(guest.body.data[0].result).toBe('LOCKED_UNLOCKABLE');
      expect((await t.http.get(`/v1/app/live-deals/${deal.id}`)).status).toBe(200);
      expect(await t.prisma.redemption.count()).toBe(before);
      // withdrawing ends it
      expect(
        (
          await post(bankCampaigns, `${pb(bank)}/benefits/${id}/withdraw`, {
            reason: 'Programme ended',
          })
        ).status,
      ).toBe(200);
      expect(
        (await t.http.get(`/v1/app/live-deals/${deal.id}/partner-benefits`)).body.data,
      ).toEqual([]);
    });

    it('a partner benefit can only target the partner’s own customers', async () => {
      const deal = await w.publish('A');
      const other = await activePartner('Rival Bank', 'BANK');
      const r = await post(bankCampaigns, `${pb(bank)}/benefits`, {
        liveDealId: deal.id,
        kind: 'OTHER',
        labelEn: 'Rival card holders',
        labelAr: 'حاملو بطاقات المنافس',
        eligibility: { kind: 'BANK_CARD', valueRefs: [other] },
      });
      expect(r.status).toBe(400);
    });
  });

  // ================================================================ Watch & Earn, loyalty, dashboard, performance, AI
  describe('watch, loyalty, dashboard, performance and AI', () => {
    it('Watch & Earn sponsorship is a loyalty rule on a network merchant campaign only', async () => {
      const r = await post(bankCampaigns, `${pb(bank)}/watch/sponsor`, {
        name: 'Bank bonus',
        eventType: 'QUALIFIED_VIEW',
        kind: 'BONUS',
        productScope: 'WATCH',
        campaignId: '00000000-0000-4000-8000-000000000000',
        bonusPoints: 5,
        fundingSource: 'BANK',
        fundingOrganizationId: bank,
        fundingHalalasPerPoint: 10,
        maxAllocationPoints: 1000,
      });
      expect(r.status).toBe(409);
      expect((await w.api(bankAnalyst).get(`${pb(bank)}/watch`)).status).toBe(200);
    });

    it('home and performance come from the shared metrics; ROI is never invented', async () => {
      const h = await w.api(bankAnalyst).get(`${pb(bank)}/home`);
      expect(h.status, JSON.stringify(h.body)).toBe(200);
      expect(h.body.data).toMatchObject({
        partner: { organizationId: bank, lifecycle: 'ACTIVE' },
        performance: { roi: null },
      });
      expect(h.body.data.network.total).toBeGreaterThan(0);
      expect(
        h.body.data.modules.find((m: { module: string }) => m.module === 'EMPLOYER_PROGRAMS')
          .offered,
      ).toBe(false);
      const p = await w.api(bankAnalyst).get(`${pb(bank)}/performance?by=CAMPAIGN&days=30`);
      expect(p.status).toBe(200);
      expect(p.body.data.roi).toBeNull();
      expect(
        p.body.data.items.every(
          (i: { estimate: { basis: string } | null }) =>
            !i.estimate || i.estimate.basis === 'ESTIMATE',
        ),
      ).toBe(true);
    });

    it('the partner copilot answers through the shared governed AI and its RBAC', async () => {
      const r = await post(bankAnalyst, `/v1/orgs/${bank}/ai/ask`, {
        message: 'summarize my campaign performance',
      });
      expect([200, 403]).toContain(r.status); // analyst has no partner.ai.use → 403; the campaign manager may ask
      const ok = await post(bankCampaigns, `/v1/orgs/${bank}/ai/ask`, {
        message: 'summarize my campaign performance',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    });
  });

  // ================================================================ tenant and market isolation
  // ================================================================ founder decisions FD-S7-1, FD-S7-3, FD-S7-4
  describe('founder decisions', () => {
    it('FD-S7-1: a partner owns and funds a Watch & Earn budget; creator, sponsor and fulfilment merchant stay separate; DealDash reviews', async () => {
      await post(bankAdmin, `${pb(bank)}/network/registered/${w.A.orgId}`); // already in the network from the campaign tests (or now)
      const video = await t.prisma.storedFile.create({
        data: {
          organizationId: w.A.orgId,
          kind: 'WATCH_VIDEO',
          originalName: 'fd1.webm',
          mimeType: 'video/webm',
          declaredSize: 5000,
          sizeBytes: 5000,
          storageKey: `merchants/${w.A.orgId}/watch_video/fd1`,
          status: 'AVAILABLE',
          completedAt: new Date(),
        },
      });
      const content = validWatchContent({ videoFileId: video.id, thumbnailFileId: w.fileA });
      // the Watch & Earn module and the WATCH product come from the partner's contract; a non-network merchant is refused
      const outside = await post(bankCampaigns, `${pb(bank)}/watch/owned`, { merchantOrganizationId: w.B.orgId, content });
      expect(outside.status).toBe(409);
      const created = await post(bankCampaigns, `${pb(bank)}/watch/owned`, { merchantOrganizationId: w.A.orgId, content });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const id = created.body.data.campaign.id as string;
      const required = created.body.data.campaign.budget.requiredHalalas as number;
      const row = await t.prisma.watchCampaign.findUniqueOrThrow({ where: { id } });
      expect({ holder: row.organizationId, creator: row.creatorOrganizationId, sponsor: row.sponsorOrganizationId }).toEqual({
        holder: w.A.orgId,
        creator: bank,
        sponsor: bank,
      });
      // the commercial case: the partner is OWNER (it accepts the media spend), the merchant is the FULFILMENT party
      const cv = await w.api(bankFinance).get(`${pb(bank)}/commercial/cases/${await caseFor('WATCH', id)}`);
      expect(cv.status, JSON.stringify(cv.body)).toBe(200);
      expect(
        cv.body.data.preview.parties.map((p: { role: string; organizationId: string }) => `${p.role}:${p.organizationId === bank ? 'bank' : 'A'}`).sort(),
      ).toEqual(['FULFILMENT_MERCHANT:A', 'OWNER:bank']);
      // only the budget owner funds it: never the merchant, and not a partner role without commercial authority
      const byMerchant = await w.api(w.ownerA).post(`${w.base('A')}/watch/${id}/fund`).set('Idempotency-Key', idem()).send({ amountHalalas: required });
      expect(byMerchant.status).toBe(409);
      expect((await post(bankCampaigns, `${pb(bank)}/watch/owned/${id}/fund`, { amountHalalas: required })).status).toBe(403);
      const funded = await post(bankFinance, `${pb(bank)}/watch/owned/${id}/fund`, { amountHalalas: required });
      expect(funded.status, JSON.stringify(funded.body)).toBe(200);
      const f = await t.prisma.watchFunding.findFirstOrThrow({ where: { campaignId: id } });
      expect(f.organizationId).toBe(bank);
      const budgetLines = await t.prisma.ledgerEntry.findMany({
        where: { journalId: f.journalId!, account: { family: 'CAMPAIGN_BUDGET' } },
        include: { account: true },
      });
      expect(budgetLines.map((e) => e.account.organizationId)).toEqual([bank]);
      // never auto-published on the merchant's trust: DealDash reviews a partner-owned budget
      await t.app.get(CommercialService).devComplete('WATCH', id);
      const sub = await post(bankCampaigns, `${pb(bank)}/watch/owned/${id}/submit`);
      expect(sub.status, JSON.stringify(sub.body)).toBe(200);
      expect(sub.body.data.outcome).toBe('SENT_FOR_REVIEW');
      // another partner never sees it
      const other = await activePartner('Other Bank FD1', 'BANK');
      const otherAdmin = await partnerUser(other, 'PARTNER_ADMIN');
      expect((await w.api(otherAdmin).get(`${pb(other)}/watch/owned/${id}`)).status).toBe(404);
      expect((await w.api(bankAnalyst).get(`${pb(bank)}/watch/owned/${id}`)).status).toBe(200);
      const list = (await w.api(bankAnalyst).get(`${pb(bank)}/watch/owned`)).body.data as Array<{ id: string; status: string; fundedHalalas: number }>;
      expect(list.find((x) => x.id === id)).toMatchObject({ status: 'PENDING_REVIEW', fundedHalalas: required });
      expect(((await w.api(otherAdmin).get(`${pb(other)}/watch/owned`)).body.data ?? []).some((x: { id: string }) => x.id === id)).toBe(false);
      // the merchant's own video is offered to the partner for a campaign at that merchant
      const assets = await w.api(bankCampaigns).get(`${pb(bank)}/campaigns/merchants/${w.A.orgId}/assets`);
      expect(assets.body.data.videos.map((v: { fileId: string }) => v.fileId)).toContain(video.id);
    });

    it('FD-S7-3: a card attribute is VERIFIED only with trusted evidence; BIN metadata or a declaration is never shown as verified', async () => {
      const c = await createBusinessUser(t.prisma, { role: 'PARTNER_READ_ONLY', orgId: bank, userType: 'PARTNER_USER' });
      // the database refuses an ISSUER_VERIFIED card attribute without a trusted source and evidence
      await expect(
        t.prisma.eligibilityAttribute.create({
          data: { userId: c.id, attrType: 'CARD_TIER', valueRef: 'BIN-METADATA-ONLY', level: 'ISSUER_VERIFIED', status: 'VERIFIED', source: 'BIN_LOOKUP' },
        }),
      ).rejects.toThrow();
      await expect(
        t.prisma.eligibilityAttribute.create({
          data: { userId: c.id, attrType: 'CARD_PRODUCT', valueRef: 'X', level: 'ISSUER_VERIFIED', status: 'VERIFIED', verificationSource: 'BIN_TABLE', evidenceRef: 'e' },
        }),
      ).rejects.toThrow();
      const ok = await t.prisma.eligibilityAttribute.create({
        data: { userId: c.id, attrType: 'CARD_TIER', valueRef: 'PLATINUM', level: 'ISSUER_VERIFIED', status: 'VERIFIED', source: 'ISSUER', verificationSource: 'ISSUER_API', evidenceRef: 'iss-tx-1', verifiedAt: new Date() },
      });
      expect(ok.verificationSource).toBe('ISSUER_API');
      // the engine tells VERIFIED from DECLARED: a declared tier never satisfies an ISSUER_VERIFIED rule, an evidenced one does
      const rule = { op: 'ATTR', attr: 'CARD_TIER', values: ['PLATINUM'], level: 'ISSUER_VERIFIED' } as const;
      const ctx = (attrs: Array<Record<string, unknown>>) => ({ userId: c.id, city: 'Riyadh', attributes: attrs as never, now: new Date() });
      const declared = { attrType: 'CARD_TIER', valueRef: 'PLATINUM', level: 'SELF_DECLARED', status: 'VERIFIED', expiresAt: null };
      const legacy = { ...declared, level: 'ISSUER_VERIFIED' }; // claims verified, carries no evidence
      const evidenced = { ...legacy, verificationSource: 'SCHEME_API', evidenceRef: 'sch-1' };
      expect(evaluateEligibility('COMPOSITE', [], ctx([declared]), rule).result).not.toBe('ELIGIBLE');
      expect(evaluateEligibility('COMPOSITE', [], ctx([legacy]), rule).result).not.toBe('ELIGIBLE');
      expect(evaluateEligibility('COMPOSITE', [], ctx([evidenced]), rule).result).toBe('ELIGIBLE');
      expect(evaluateEligibility('COMPOSITE', [], ctx([declared]), { ...rule, level: 'SELF_DECLARED' }).result).toBe('ELIGIBLE');
    });

    it('FD-S7-4: a partner creates a Live Deal for a network merchant; it is published only after DealDash confirms the right; no capability follows', async () => {
      const m = await post(bankAdmin, `${pb(bank)}/network/merchants`, {
        externalMerchantId: 'GB-FD4-M',
        nameEn: 'Harbour Grill Jeddah',
        country: 'SA',
        branches: [{ nameEn: 'Harbour Grill Corniche', city: 'Jeddah' }],
      });
      expect(m.status, JSON.stringify(m.body)).toBe(201);
      const offer = {
        sourceRecordId: 'GB-OFFER-77',
        merchantSourceId: 'GB-FD4-M',
        publicationRef: 'GULF-BANK-DINING-PROGRAMME-2026',
        titleEn: 'Gulf Bank cardholders dine for less',
        benefitEn: '15% off the bill',
        validFrom: new Date(Date.now() - 3600_000).toISOString(),
        validUntil: new Date(Date.now() + 30 * 86400_000).toISOString(),
        eligibility: { schemes: ['VISA'], products: ['GB-PLAT'] },
      };
      // not a network merchant of this partner, or card data in the text: refused
      expect((await post(bankCampaigns, `${pb(bank)}/offers`, offer)).status).toBe(403); // needs partner.network.manage
      expect((await post(bankAdmin, `${pb(bank)}/offers`, { ...offer, merchantSourceId: 'UNKNOWN-M' })).status).toBe(409);
      const pan = await post(bankAdmin, `${pb(bank)}/offers`, { ...offer, termsEn: 'Use card 4111 1111 1111 1111' });
      expect(pan.status).toBe(422);
      expect(pan.body.errors[0].code).toBe('CARD_DATA_FORBIDDEN');
      const r = await post(bankAdmin, `${pb(bank)}/offers`, offer);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data.publication).toBe('AWAITING_CONFIRMATION');
      const id = r.body.data.id as string;
      const shown = async () =>
        ((await t.http.get('/v1/app/network-offers').query({ q: 'Gulf Bank cardholders' })).body.data as Array<{ id: string }>).some((o) => o.id === id);
      expect(await shown()).toBe(false);
      // the partner keeps every provenance field
      const mine = (await w.api(bankAnalyst).get(`${pb(bank)}/offers`)).body.data.find((o: { id: string }) => o.id === id);
      expect(mine).toMatchObject({
        sourceRecordId: 'GB-OFFER-77',
        merchantSourceId: 'GB-FD4-M',
        publicationRef: 'GULF-BANK-DINING-PROGRAMME-2026',
        importMethod: 'MANUAL',
        country: 'SA',
        eligibility: { schemes: ['VISA'], products: ['GB-PLAT'] },
        publication: 'AWAITING_CONFIRMATION',
      });
      expect(mine.lastSyncAt).toBeTruthy();
      // DealDash confirms the publication right (a partner user cannot)
      expect((await w.api(mgmt).get('/v1/admin/partners/offers')).body.data.map((o: { id: string }) => o.id)).toContain(id);
      expect([401, 403]).toContain((await post(bankAdmin, `/v1/admin/partners/offers/${id}/confirm`, {})).status);
      const ok = await post(mgmt, `/v1/admin/partners/offers/${id}/confirm`, { reason: 'Programme agreement on file' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(await shown()).toBe(true); // public, frictionless discovery (unchanged rule)
      expect((await w.api(bankAnalyst).get(`${pb(bank)}/offers`)).body.data.find((o: { id: string }) => o.id === id).publication).toBe('PUBLISHABLE');
      // a partner Live Deal gives the referenced merchant NO controlled capability
      const d = await w.api(bankAnalyst).get(`${pb(bank)}/network/merchants/${m.body.data.id}`);
      expect(d.body.data.state).toBe('REFERENCED');
      expect(Object.values(d.body.data.capabilities).every((v) => v === false)).toBe(true);
      // audited, and DealDash can withdraw the right again
      expect(await t.prisma.auditLog.count({ where: { entityId: id, action: { startsWith: 'partner.offer.' } } })).toBe(2);
      expect((await post(mgmt, `/v1/admin/partners/offers/${id}/withdraw`, { reason: 'Programme ended' })).status).toBe(200);
      expect(await shown()).toBe(false);
    });
  });

  describe('tenant isolation (partner A never sees partner B)', () => {
    it('bank vs bank, bank vs scheme, scheme vs scheme, corporate vs corporate: every portal route is 404 for another tenant', async () => {
      const bank2 = await activePartner('Second Bank', 'BANK');
      const scheme1 = await activePartner('Scheme One', 'SCHEME');
      const scheme2 = await activePartner('Scheme Two', 'SCHEME');
      const corp1 = await activePartner('Corp One', 'EMPLOYER');
      const corp2 = await activePartner('Corp Two', 'EMPLOYER');
      const pairs: Array<[string, string]> = [
        [bank2, bank],
        [scheme1, bank],
        [bank2, scheme1],
        [scheme2, scheme1],
        [corp2, corp1],
      ];
      for (const [mine, theirs] of pairs) {
        const s = await partnerUser(mine, 'PARTNER_ADMIN');
        for (const path of [
          'home',
          'profile',
          'readiness',
          'network',
          'campaigns',
          'benefits',
          'users',
          'performance',
          'card-programs',
          'commercial/cases',
        ])
          expect((await w.api(s).get(`${pb(theirs)}/${path}`)).status, `${path}`).toBe(404);
        expect((await w.api(s).get(`/v1/orgs/${theirs}/billing/documents`)).status).toBe(404);
        expect((await w.api(s).get(`/v1/orgs/${theirs}/inbox`)).status).toBe(404);
        expect(
          (await post(s, `/v1/orgs/${theirs}/ai/ask`, { message: 'show their campaigns' })).status,
        ).toBe(404);
      }
    });

    it("another partner can never read the bank's network merchant, campaign or commercial case through its own routes", async () => {
      const other = await activePartner('Peeking Bank', 'BANK');
      await contract(
        other,
        'BANK_ENTERPRISE',
        ['EXCLUSIVE', 'MEMBER_BENEFIT'],
        ['BANK_MERCHANT_NETWORK'],
      );
      const s = await partnerUser(other, 'PARTNER_ADMIN');
      const net = await w.api(bankAdmin).get(`${pb(bank)}/network`);
      const mid = net.body.data.items[0].id;
      expect((await w.api(s).get(`${pb(other)}/network/merchants/${mid}`)).status).toBe(404);
      const pf = await w.api(bankAdmin).get(`${pb(bank)}/campaigns`);
      const c = pf.body.data.items[0];
      expect((await w.api(s).get(`${pb(other)}/campaigns/EXCLUSIVE/${c.subjectId}`)).status).toBe(
        404,
      );
      expect((await w.api(s).get(`${pb(other)}/commercial/cases/${c.caseId}`)).status).toBe(404);
    });

    it('an AE-only scoped member cannot read an SA campaign (market isolation)', async () => {
      const u = await createBusinessUser(t.prisma, {
        role: 'PARTNER_ANALYST',
        orgId: bank,
        userType: 'PARTNER_USER',
        label: 'ae-analyst',
      });
      const m = await t.prisma.organizationMembership.findFirstOrThrow({
        where: { userId: u.id, organizationId: bank },
      });
      await post(bankAdmin, `/v1/orgs/${bank}/members/${m.id}/scoped`, { scoped: true });
      const a = await post(bankAdmin, `/v1/orgs/${bank}/assignments`, {
        membershipId: m.id,
        roleCode: 'PARTNER_ANALYST',
        scope: { kind: 'COUNTRY', ref: 'AE' },
      });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      const s = await passwordSession(t, { id: u.id, email: u.email } as never, 'partner');
      const pf = await w.api(s).get(`${pb(bank)}/campaigns`);
      expect(pf.status).toBe(200);
      expect(pf.body.data.items.filter((i: { market: string }) => i.market === 'SA')).toEqual([]);
      const all = await w.api(bankAdmin).get(`${pb(bank)}/campaigns`);
      const sa = all.body.data.items.find(
        (i: { market: string; product: string }) => i.market === 'SA' && i.product === 'EXCLUSIVE',
      );
      expect([403, 404]).toContain(
        (await w.api(s).get(`${pb(bank)}/campaigns/EXCLUSIVE/${sa.subjectId}`)).status,
      );
    });
  });
});
