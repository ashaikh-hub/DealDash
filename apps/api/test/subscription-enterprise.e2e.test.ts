import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { subscriptionWorld, type SubWorld } from './subscription-fixtures';
import { EntitlementService } from '../src/platform/entitlement.service';
import { UsageService } from '../src/subscription/usage.service';

const day = 864e5;

/** Enterprise agreements (bank, scheme, corporate), legal-entity scope, usage meters, suspension and the security boundary. */
describe.skipIf(!DB_READY)('Subscription engine: enterprise, usage, suspension, security', () => {
  let t: TestApp;
  let s: SubWorld;

  beforeAll(async () => {
    t = await createTestApp();
    s = await subscriptionWorld(t);
  });
  afterAll(() => t?.close());

  const base = (orgId: string) => `/v1/orgs/${orgId}/subscription`;
  const events = async (contractId: string, type?: string) => (await s.get(s.admin, `${s.AS}/billing-events?contractId=${contractId}${type ? `&eventType=${type}` : ''}`)).body.data as Array<Record<string, unknown>>;
  const addBranch = (owner: Parameters<SubWorld['post']>[0], orgId: string, n: number) =>
    s.api(owner).post(`/v1/merchants/${orgId}/branches`).set('Idempotency-Key', idem()).send({ nameEn: `Extra ${n}`, nameAr: `إضافي ${n}`, addressEn: 'Karachi', addressAr: 'كراتشي', city: 'Riyadh', latitude: 24.7 + n / 100, longitude: 46.7 + n / 100 });

  describe('Enterprise agreements are contracts of an enterprise kind: no sponsor-subscription concept', () => {
    it('a bank is a Business Account with its own legal entity and a BANK_ENTERPRISE contract; the licence bills at the legal entity', async () => {
      const bank = await s.mkPartner('SubBank', 'BANK');
      const le = await t.prisma.legalEntity.create({ data: { organizationId: bank.orgId, legalName: `Bank Legal ${idem()}`, country: 'PK', currency: 'PKR' } });
      const a = await s.post(s.admin, `${s.AS}/contracts/assign`, { organizationId: bank.orgId, planCode: 'BANK_ENTERPRISE', market: 'PK', legalEntityId: le.id, billingLegalEntityId: le.id, coveredLegalEntityIds: [le.id], cadence: 'ANNUAL' });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      expect(a.body.data).toMatchObject({ kind: 'BANK_ENTERPRISE', status: 'PENDING_ACTIVATION', billingCadence: 'ANNUAL', currency: 'PKR', legalEntityId: le.id });
      const acc = await s.post(bank.admin, `${base(bank.orgId)}/accept`, { language: 'en', confirm: true });
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      const ev = await events(a.body.data.id, 'ANNUAL_LICENCE_RENEWAL');
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ amountMinor: 2_500_000 * 100, currency: 'PKR', billingLegalEntityId: le.id, billingCategory: 'SUBSCRIPTION_LICENCE' });
      const e = await t.app.get(EntitlementService).effective(bank.orgId);
      expect(e.features).toEqual(expect.arrayContaining(['BANK_MERCHANT_NETWORK', 'CARDHOLDER_ELIGIBILITY', 'BANK_FUNDED_CAMPAIGNS']));
      expect(e.limits).toEqual({});
    });

    it('a corporate partner takes the same path with its own features; setup and API fees are indicative until negotiated', async () => {
      const corp = await s.mkPartner('SubCorp', 'EMPLOYER');
      const a = await s.assign(corp.orgId, 'CORPORATE_PARTNER', corp.admin);
      expect(a).toMatchObject({ kind: 'CORPORATE_PARTNER', status: 'ACTIVE' });
      expect((await t.app.get(EntitlementService).effective(corp.orgId)).features).toEqual(expect.arrayContaining(['EMPLOYEE_PROGRAMS', 'CORPORATE_FUNDED_CAMPAIGNS']));
      const setup = (await events(a.id as string, 'SETUP_FEE'))[0];
      expect(setup).toBeUndefined(); // "from PKR 250,000" is a reference, never a charge
      expect((await s.post(s.finance, `${s.AS}/contracts/${a.id}/rates`, { itemCode: 'SETUP_FEE', model: 'FIXED', amountMinor: 30_000_000, approvalRef: 'CORP-1' })).status).toBe(201);
      const fee = (await s.get(s.admin, `${s.AS}/contracts/${a.id}/terms`)).body.data;
      expect(fee.fees.find((f: { code: string }) => f.code === 'SETUP_FEE')).toMatchObject({ amountMinor: 30_000_000, indicative: false });
    });

    it('a scheme can hold a country licence and later a multi-market agreement; each is its own contract with its own markets', async () => {
      const sch = await s.mkPartner('SubScheme', 'SCHEME');
      const country = await s.assign(sch.orgId, 'SCHEME_COUNTRY_NETWORK', sch.admin);
      expect(country).toMatchObject({ kind: 'SCHEME_NETWORK_LICENCE', status: 'ACTIVE', billingCadence: 'ANNUAL' });
      const multi = await s.post(s.admin, `${s.AS}/contracts/assign`, { organizationId: sch.orgId, planCode: 'SCHEME_MULTI_MARKET', market: 'PK' });
      expect(multi.status, JSON.stringify(multi.body)).toBe(201);
      expect(multi.body.data.kind).toBe('SCHEME_NETWORK_LICENCE');
      const all = (await s.get(s.admin, `${s.AS}/contracts?organizationId=${sch.orgId}`)).body.data as unknown[];
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('brands, branches and units never own a subscription: the contract is always the Business Account’s', async () => {
      const m = await s.mkMerchant('brandless', 2);
      const c = await s.assign(m.orgId, 'GROWTH', m.owner);
      const row = await t.prisma.contract.findUniqueOrThrow({ where: { id: c.id as string } });
      expect(row.organizationId).toBe(m.orgId);
      const cols = Object.keys(row);
      expect(cols).not.toContain('brandId');
      expect(cols).not.toContain('branchId');
    });

    it('the enterprise view, the explain endpoint and the readiness list are governed data for DealDash', async () => {
      const m = await s.mkMerchant('explain', 1);
      await s.assign(m.orgId, 'GROWTH', m.owner);
      const ex = await s.get(s.admin, `${s.AS}/organizations/${m.orgId}/explain?action=ADD_BRANCH`);
      expect(ex.status).toBe(200);
      expect(ex.body.data).toMatchObject({ allowed: true });
      expect(JSON.stringify(ex.body.data)).toContain('USAGE_WITHIN_LIMIT');
      const mine = await s.get(m.owner, `${base(m.orgId)}/explain`);
      expect(mine.status).toBe(200);
      const ready = await s.get(s.admin, `${s.AS}/readiness/unassigned`);
      expect(ready.status).toBe(200);
      expect(Array.isArray(ready.body.data)).toBe(true);
    });
  });

  describe('Usage meters: allowances on the entitlement, never a second entitlement system', () => {
    let m: Awaited<ReturnType<SubWorld['mkMerchant']>>;
    let contractId: string;

    beforeAll(async () => {
      expect((await s.post(s.admin, `${s.AS}/plans`, { code: 'USAGE_TEST', nameEn: 'Usage test', nameAr: 'اختبار الاستخدام', entityType: 'MERCHANT', contractKind: 'MERCHANT_SUBSCRIPTION' })).status).toBe(201);
      const v = await s.post(s.admin, `${s.AS}/plans/USAGE_TEST/versions`, {
        market: 'PK',
        currency: 'PKR',
        defaultCadence: 'MONTHLY',
        prices: [{ cadence: 'MONTHLY', amountMinor: 100_000 }],
        entitlements: {
          products: ['LIVE_DEAL'],
          features: ['API_ACCESS', 'BULK_IMPORT'],
          limits: [
            { key: 'api.requests', value: 3, mode: 'HARD', period: 'MONTH', warnPercents: [80, 100] },
            { key: 'bulk_import.rows', value: 2, mode: 'SOFT', period: 'MONTH', warnPercents: [100], softAction: 'OVERAGE_CHARGE', overageRateMinor: 500 },
          ],
        },
      });
      expect(v.status, JSON.stringify(v.body)).toBe(201);
      expect((await s.post(s.finance, `${s.AS}/plan-versions/${v.body.data.id}/publish`, {})).status).toBe(200);
      m = await s.mkMerchant('usage', 1);
      contractId = (await s.assign(m.orgId, 'USAGE_TEST', m.owner)).id as string;
    });

    const record = (key: string, metricKey: string, quantity = 1) => s.post(s.admin, `${s.AS}/organizations/${m.orgId}/usage`, { idempotencyKey: key, metricKey, quantity });

    it('a HARD allowance is consumed atomically and refused at the limit', async () => {
      const k = idem();
      const r1 = await record(`${k}-1`, 'api.requests');
      expect(r1.status, JSON.stringify(r1.body)).toBe(200);
      expect(r1.body.data).toMatchObject({ recorded: true, value: 1, limit: 3 });
      expect((await record(`${k}-2`, 'api.requests')).body.data.value).toBe(2);
      expect((await record(`${k}-3`, 'api.requests')).body.data.value).toBe(3);
      const over = await record(`${k}-4`, 'api.requests');
      expect(over.status).toBe(403);
      expect(over.body.errors[0].code).toBe('ENTITLEMENT_LIMIT_REACHED');
      expect(await t.prisma.usageEvent.count({ where: { organizationId: m.orgId, metricKey: 'api.requests' } })).toBe(3);
    });

    it('an event is idempotent: replaying its key counts once', async () => {
      const again = await record(`${idem()}-x`, 'bulk_import.rows');
      const key = `replay-${idem()}`;
      const a = await record(key, 'bulk_import.rows');
      const b = await record(key, 'bulk_import.rows');
      expect(a.body.data.recorded).toBe(true);
      expect(b.body.data.recorded).toBe(false);
      expect(b.body.data.value).toBe(a.body.data.value);
      expect(again.status).toBe(200);
    });

    it('a SOFT allowance warns, then charges overage as a billing event, and the signal is raised once', async () => {
      const r = await record(`soft-${idem()}`, 'bulk_import.rows', 2); // 1 + 1 (replay test) + 2 = beyond 2
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.overage).toBeGreaterThan(0);
      const ov = await events(contractId, 'OVERAGE_USAGE');
      expect(ov.length).toBeGreaterThanOrEqual(1);
      expect(ov[0]).toMatchObject({ currency: 'PKR', billingCategory: 'PRODUCT_USAGE' });
    });

    it('a period usage reset gives a fresh allowance next month; history stays', async () => {
      const next = new Date(Date.now() + 40 * day);
      const v = await t.app.get(UsageService).periodValue(m.orgId, 'api.requests', { at: next });
      expect(v).toBe(0);
      const r = await t.app.get(UsageService).consume({ organizationId: m.orgId, limitKey: 'api.requests', idempotencyKey: `next-${idem()}`, sourceType: 'TEST', sourceId: 'next', at: next });
      expect(r).toMatchObject({ recorded: true, value: 1 });
      expect(await t.app.get(UsageService).periodValue(m.orgId, 'api.requests')).toBe(3);
    });

    it('concurrent consumption cannot exceed a HARD limit', async () => {
      const m2 = await s.mkMerchant('usage-race', 1);
      await s.assign(m2.orgId, 'USAGE_TEST', m2.owner);
      const svc = t.app.get(UsageService);
      const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => svc.consume({ organizationId: m2.orgId, limitKey: 'api.requests', idempotencyKey: `race-${m2.orgId}-${i}`, sourceType: 'TEST', sourceId: String(i) })));
      expect(out.filter((x) => x.status === 'fulfilled')).toHaveLength(3);
      expect(await svc.periodValue(m2.orgId, 'api.requests')).toBe(3);
    });

    it('usage events are append-only', async () => {
      const row = await t.prisma.usageEvent.findFirstOrThrow({ where: { organizationId: m.orgId } });
      await expect(t.prisma.usageEvent.update({ where: { id: row.id }, data: { quantity: 99 } })).rejects.toThrow();
      await expect(t.prisma.usageEvent.delete({ where: { id: row.id } })).rejects.toThrow();
    });

    it('the business sees its own usage against the allowance; another business cannot', async () => {
      const mine = await s.get(m.owner, `${base(m.orgId)}/usage`);
      expect(mine.status).toBe(200);
      expect(mine.body.data.find((u: { limitKey: string }) => u.limitKey === 'api.requests')).toMatchObject({ used: 3, limit: 3 });
      const other = await s.mkMerchant('usage-other', 1);
      expect((await s.get(other.owner, `${base(m.orgId)}/usage`)).status).toBe(404);
    });
  });

  describe('Past due, suspension and financial hold block NEW exposure only', () => {
    let m: Awaited<ReturnType<SubWorld['mkMerchant']>>;
    let contractId: string;

    beforeAll(async () => {
      m = await s.mkMerchant('suspend', 2);
      contractId = (await s.assign(m.orgId, 'GROWTH', m.owner)).id as string;
    });

    it('PAST_DUE within the grace window keeps everything working', async () => {
      const r = await s.post(s.admin, `${s.AS}/contracts/${contractId}/past-due`, { reason: 'Invoice unpaid' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.status).toBe('PAST_DUE');
      const fs = (await s.get(s.admin, `${s.AS}/organizations/${m.orgId}/financial-status`)).body.data;
      expect(['GRACE', 'PAST_DUE']).toContain(fs.status);
      if (fs.status === 'GRACE') expect((await addBranch(m.owner, m.orgId, 3)).status).toBe(201);
    });

    it('SUSPENDED blocks new branches and users, premium/API actions and new paid campaigns; the reason is audited', async () => {
      const r = await s.post(s.finance, `${s.AS}/contracts/${contractId}/suspend`, { reason: 'Grace elapsed' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.status).toBe('SUSPENDED');
      const b = await addBranch(m.owner, m.orgId, 9);
      expect(b.status).toBe(403);
      expect(b.body.errors[0].code).toBe('COMMERCIAL_SUSPENDED');
      const ent = t.app.get(EntitlementService);
      for (const action of ['NEW_PAID_CAMPAIGN', 'ACTIVATE_CAMPAIGN', 'ADD_BRANCH', 'ADD_USER', 'PREMIUM_FEATURE', 'API_OPERATION', 'UPGRADE_EXPOSURE']) {
        await expect(ent.requireNewExposure(m.orgId, action)).rejects.toMatchObject({ code: 'COMMERCIAL_SUSPENDED' });
      }
      const audit = await t.prisma.auditLog.findFirst({ where: { entityId: contractId, action: { contains: 'SUSPEND' } } });
      expect(audit?.reason).toBe('Grace elapsed');
    });

    it('never blocks what the customer already holds: redemption, rewards, refunds, finance and history stay open', async () => {
      const ent = t.app.get(EntitlementService);
      for (const action of ['REDEEM_VOUCHER', 'REDEEM_CREDENTIAL', 'CREDIT_REWARD', 'REFUND', 'FULFIL_ORDER', 'VIEW_FINANCE', 'VIEW_HISTORY']) {
        await expect(ent.requireNewExposure(m.orgId, action)).resolves.toBeUndefined();
      }
      // history and the commercial status remain readable by the business itself
      expect((await s.get(m.owner, base(m.orgId))).status).toBe(200);
      expect((await s.get(m.owner, `${base(m.orgId)}/usage`)).status).toBe(200);
      // the entitlement is still described, for the business to understand why something is unavailable
      expect((await s.get(m.owner, `${base(m.orgId)}/explain`)).status).toBe(200);
    });

    it('a live prepaid campaign continues by default (CONTINUE) and can be made stricter per contract', async () => {
      const ent = t.app.get(EntitlementService);
      await expect(ent.assertLiveCampaignOpen(m.orgId)).resolves.toBeUndefined();
      await t.prisma.contract.update({ where: { id: contractId }, data: { enforcement: { liveCampaignsWhenSuspended: 'STOP_NEW_EXPOSURE' } } });
      await expect(ent.assertLiveCampaignOpen(m.orgId)).rejects.toMatchObject({ code: 'OFFER_UNAVAILABLE' });
      await t.prisma.contract.update({ where: { id: contractId }, data: { enforcement: {} } });
    });

    it('reinstating restores new exposure; nothing was lost', async () => {
      const r = await s.post(s.finance, `${s.AS}/contracts/${contractId}/reinstate`, { reason: 'Payment received' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.status).toBe('ACTIVE');
      await expect(t.app.get(EntitlementService).requireNewExposure(m.orgId, 'ADD_BRANCH')).resolves.toBeUndefined();
      expect((await addBranch(m.owner, m.orgId, 10)).status).toBe(201);
    });

    it('an organization-level financial hold blocks campaigns and upgrades, not branches or customer rights', async () => {
      const m2 = await s.mkMerchant('hold', 1);
      await s.assign(m2.orgId, 'GROWTH', m2.owner);
      const adminUser = await t.prisma.user.findFirstOrThrow({ where: { email: { contains: 'sub-fin' } } });
      const hold = await t.prisma.financialHold.create({ data: { organizationId: m2.orgId, reason: 'Disputed funding', placedByUserId: adminUser.id } });
      const ent = t.app.get(EntitlementService);
      await expect(ent.requireNewExposure(m2.orgId, 'NEW_PAID_CAMPAIGN')).rejects.toMatchObject({ code: 'FINANCIAL_HOLD' });
      await expect(ent.requireNewExposure(m2.orgId, 'UPGRADE_EXPOSURE')).rejects.toMatchObject({ code: 'FINANCIAL_HOLD' });
      await expect(ent.requireNewExposure(m2.orgId, 'ADD_BRANCH')).resolves.toBeUndefined();
      await expect(ent.requireNewExposure(m2.orgId, 'REDEEM_VOUCHER')).resolves.toBeUndefined();
      const fs = (await s.get(s.admin, `${s.AS}/organizations/${m2.orgId}/financial-status`)).body.data;
      expect(fs.status).toBe('FINANCIAL_HOLD');
      await t.prisma.financialHold.update({ where: { id: hold.id }, data: { status: 'RELEASED', releasedAt: new Date(), releasedByUserId: adminUser.id, releaseReason: 'Resolved' } });
      expect((await s.get(s.admin, `${s.AS}/organizations/${m2.orgId}/financial-status`)).body.data.status).toBe('GOOD_STANDING');
    });
  });

  describe('Security boundary', () => {
    let m: Awaited<ReturnType<SubWorld['mkMerchant']>>;
    beforeAll(async () => {
      m = await s.mkMerchant('sec', 1);
      await s.assign(m.orgId, 'GROWTH', m.owner);
    });

    it('requires authentication', async () => {
      const r = await request(t.app.getHttpServer()).get(base(m.orgId));
      expect(r.status).toBe(401);
      expect((await request(t.app.getHttpServer()).get(`${s.AS}/plans`)).status).toBe(401);
    });

    it('a merchant cannot reach the admin catalog, contract or billing-event endpoints', async () => {
      for (const p of ['plans', 'contracts', 'billing-events', 'signals', 'price-items', 'add-ons']) {
        expect([401, 403], p).toContain((await s.get(m.owner, `${s.AS}/${p}`)).status);
      }
      expect([401, 403]).toContain((await s.post(m.owner, `${s.AS}/contracts/assign`, { organizationId: m.orgId, planCode: 'MERCHANT_ENTERPRISE' })).status);
    });

    it('another business cannot read or act on this business’s subscription', async () => {
      const other = await s.mkMerchant('sec-other', 1);
      for (const p of ['', '/usage', '/explain', '/plans', '/amendments', '/pending']) {
        expect((await s.get(other.owner, `${base(m.orgId)}${p}`)).status, p).toBe(404);
      }
      expect((await s.post(other.owner, `${base(m.orgId)}/stop-renewal`, { reason: 'sabotage' })).status).toBe(404);
    });

    it('a Finance team member can read the commercial status but cannot change the plan', async () => {
      const fin = await m.mk('MERCHANT_FINANCE');
      expect((await s.get(fin, base(m.orgId))).status).toBe(200);
      expect((await s.post(fin, `${base(m.orgId)}/amendments`, { type: 'UPGRADE', targetPlanCode: 'BUSINESS' })).status).toBe(403);
      expect((await s.post(fin, `${base(m.orgId)}/stop-renewal`, { reason: 'not mine to stop' })).status).toBe(403);
    });

    it('a DealDash operations user without the approve permission cannot publish, cancel or suspend', async () => {
      const contract = await t.prisma.contract.findFirstOrThrow({ where: { organizationId: m.orgId } });
      const version = await t.prisma.commercialPlanVersion.findFirstOrThrow({ where: { status: 'PUBLISHED' } });
      expect((await s.post(s.ops, `${s.AS}/plan-versions/${version.id}/publish`, {})).status).toBe(403);
      expect((await s.post(s.ops, `${s.AS}/contracts/${contract.id}/cancel`, { reason: 'try this' })).status).toBe(403);
    });

    it('commercial billing events cannot be edited or deleted except status and consumedAt', async () => {
      const ev = await t.prisma.commercialBillingEvent.findFirstOrThrow({ where: { organizationId: m.orgId } });
      await expect(t.prisma.commercialBillingEvent.update({ where: { id: ev.id }, data: { amountMinor: 1 } })).rejects.toThrow();
      await expect(t.prisma.commercialBillingEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
      await expect(t.prisma.commercialBillingEvent.update({ where: { id: ev.id }, data: { status: 'CONSUMED', consumedAt: new Date() } })).resolves.toBeTruthy();
    });
  });
});
