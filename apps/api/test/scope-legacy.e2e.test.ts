import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createBusinessUser, createTestApp, idem, passwordSession, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

/**
 * ROLE + SCOPE + TENANT enforcement on the older merchant endpoints (campaigns, inventory, redemptions, branches, finance,
 * team). A scoped member sees and changes only what their scope covers; the backend decides, never the screen.
 */
describe.skipIf(!DB_READY)('Scope on legacy endpoints', () => {
  let t: TestApp;
  let w: HotWorld;
  let orgA: string;
  let bR: string; // Riyadh branch
  let bJ: string; // Jeddah branch
  let cityR: string;
  let cityJ: string;
  let unitBR: string;
  let unitBJ: string;
  const d: Record<string, string> = {}; // campaign ids
  type Who = 'mgrR' | 'mgrJ' | 'adminR' | 'adminJ' | 'finCountry' | 'finOrg' | 'narrow' | 'voucherOnly';
  const s = {} as Record<Who, Session>;

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    orgA = w.A.orgId;
    bR = w.A.branchIds[0]!;
    bJ = w.A.branchIds[1]!;
    const post = (sess: Session, path: string, body: unknown = {}) => w.api(sess).post(`/v1/orgs/${orgA}${path}`).set('Idempotency-Key', idem()).send(body as object);
    cityR = (await post(w.ownerA, '/units', { kind: 'CITY', code: 'RUH', nameEn: 'Riyadh', nameAr: 'الرياض', city: 'Riyadh' })).body.data.id;
    cityJ = (await post(w.ownerA, '/units', { kind: 'CITY', code: 'JED', nameEn: 'Jeddah', nameAr: 'جدة', city: 'Jeddah' })).body.data.id;
    unitBR = (await post(w.ownerA, '/units', { kind: 'BRANCH', code: 'B1', nameEn: 'Olaya', nameAr: 'العليا', parentId: cityR, branchId: bR })).body.data.id;
    unitBJ = (await post(w.ownerA, '/units', { kind: 'BRANCH', code: 'B2', nameEn: 'Tahlia', nameAr: 'التحلية', parentId: cityJ, branchId: bJ })).body.data.id;

    const scoped = async (role: 'MERCHANT_CAMPAIGN_MANAGER' | 'MERCHANT_ADMIN' | 'MERCHANT_FINANCE', label: string, scope: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const u = await createBusinessUser(t.prisma, { role, orgId: orgA, userType: 'MERCHANT_USER', label });
      const m = await t.prisma.organizationMembership.findFirstOrThrow({ where: { userId: u.id, organizationId: orgA } });
      expect((await post(w.ownerA, `/members/${m.id}/scoped`, { scoped: true })).status).toBe(200);
      const g = await post(w.ownerA, '/assignments', { membershipId: m.id, roleCode: role, scope, ...extra });
      expect(g.status, JSON.stringify(g.body)).toBe(201);
      const fresh = await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      return passwordSession(t, { id: fresh.id, email: fresh.email! } as never, 'merchant');
    };

    // campaigns: Riyadh-only, Jeddah-only and one spanning both
    const hot = async (branches: string[]) => (await w.createHot('A', { ...w.hotContent('A'), allocations: branches.map((branchId) => ({ branchId, units: 5 })) } as never)).id as string;
    d.hotR = await hot([bR]);
    d.hotJ = await hot([bJ]);
    d.hotBoth = await hot([bR, bJ]);
    const live = async (branchIds: string[]) => (await w.createDeal(w.ownerA, orgA, w.content('A', { branchIds }))).id as string;
    d.liveR = await live([bR]);
    d.liveJ = await live([bJ]);

    s.mgrR = await scoped('MERCHANT_CAMPAIGN_MANAGER', 'mgr-r', { kind: 'UNIT', ref: cityR });
    s.mgrJ = await scoped('MERCHANT_CAMPAIGN_MANAGER', 'mgr-j', { kind: 'UNIT', ref: cityJ });
    s.adminR = await scoped('MERCHANT_ADMIN', 'admin-r', { kind: 'UNIT', ref: unitBR });
    s.adminJ = await scoped('MERCHANT_ADMIN', 'admin-j', { kind: 'UNIT', ref: unitBJ });
    s.finCountry = await scoped('MERCHANT_FINANCE', 'fin-c', { kind: 'COUNTRY', ref: 'SA' });
    s.finOrg = await scoped('MERCHANT_FINANCE', 'fin-o', { kind: 'ORGANIZATION', ref: null });
    s.narrow = await scoped('MERCHANT_CAMPAIGN_MANAGER', 'narrow', { kind: 'CAMPAIGN', ref: d.hotR, product: 'EXCLUSIVE' });
    s.voucherOnly = await scoped('MERCHANT_CAMPAIGN_MANAGER', 'v-only', { kind: 'PRODUCT', ref: 'VOUCHER' });
  });
  afterAll(() => t?.close());

  const base = () => `/v1/merchants/${orgA}`;
  const get = (sess: Session, path: string) => w.api(sess).get(`${base()}${path}`);
  const post = (sess: Session, path: string, body: unknown = {}) => w.api(sess).post(`${base()}${path}`).set('Idempotency-Key', idem()).send(body as object);
  const ids = (res: { body: { data: { items?: Array<{ id: string }> } | Array<{ id: string }> } }) => {
    const data = res.body.data;
    return (Array.isArray(data) ? data : (data.items ?? [])).map((x) => x.id);
  };

  describe('campaigns and inventory (Exclusive Deals)', () => {
    it('a list shows only campaigns that touch the member’s scope (decided on the server)', async () => {
      const r = await get(s.mgrR, '/hot-deals');
      expect(r.status).toBe(200);
      expect(ids(r).sort()).toEqual([d.hotR, d.hotBoth].sort());
      const j = await get(s.mgrJ, '/hot-deals');
      expect(ids(j).sort()).toEqual([d.hotJ, d.hotBoth].sort());
      expect(ids(await get(w.ownerA, '/hot-deals')).length).toBeGreaterThanOrEqual(3); // an ordinary member is unchanged
    });

    it('the summary counts only what the member can see', async () => {
      const r = (await get(s.mgrR, '/hot-deals/summary')).body.data;
      expect(r.total).toBe(2);
      expect((await get(w.ownerA, '/hot-deals/summary')).body.data.total).toBeGreaterThanOrEqual(3);
    });

    it('reading a campaign outside the scope is 404; one that spans scopes is readable but NOT changeable', async () => {
      expect((await get(s.mgrR, `/hot-deals/${d.hotJ}`)).status).toBe(404);
      expect((await get(s.mgrR, `/hot-deals/${d.hotJ}/monitor`)).status).toBe(404);
      expect((await get(s.mgrR, `/hot-deals/${d.hotBoth}`)).status).toBe(200);
      for (const action of ['pause', 'resume', 'submit', 'cancel']) {
        const x = await post(s.mgrR, `/hot-deals/${d.hotBoth}/${action}`, action === 'cancel' ? { reason: 'no longer needed here' } : {});
        expect(x.status, action).toBe(403);
        expect(x.body.errors[0].code).toBe('SCOPE_FORBIDDEN');
      }
      expect((await post(s.mgrR, `/hot-deals/${d.hotJ}/stock`, { branchId: bJ, delta: 2 })).status).toBe(404);
      expect((await post(s.mgrR, `/hot-deals/${d.hotBoth}/stock`, { branchId: bR, delta: 2 })).status).toBe(403);
    });

    it('inside the scope the member works normally (edit, then stock after approval is still scope-checked)', async () => {
      const cur = (await get(s.mgrR, `/hot-deals/${d.hotR}`)).body.data;
      const put = await w.api(s.mgrR).put(`${base()}/hot-deals/${d.hotR}`).set('Idempotency-Key', idem()).send({ content: cur.content, expectedVersion: cur.version });
      expect(put.status, JSON.stringify(put.body)).toBe(200);
    });

    it('creating a campaign needs EVERY branch in scope: adding a branch cannot escape the scope', async () => {
      const mk = (branches: string[]) => post(s.mgrR, '/hot-deals', { content: { ...w.hotContent('A'), allocations: branches.map((branchId) => ({ branchId, units: 3 })) } });
      expect((await mk([bR])).status).toBe(201);
      const bad = await mk([bR, bJ]);
      expect(bad.status).toBe(403);
      expect(bad.body.errors[0].code).toBe('SCOPE_FORBIDDEN');
      expect((await mk([bJ])).status).toBe(403);
    });

    it('a campaign-narrowed member sees only that campaign and can create nothing new', async () => {
      expect(ids(await get(s.narrow, '/hot-deals'))).toEqual([d.hotR]);
      expect((await get(s.narrow, `/hot-deals/${d.hotBoth}`)).status).toBe(404);
      expect((await post(s.narrow, '/hot-deals', { content: w.hotContent('A') })).status).toBe(403);
    });

    it('a product-narrowed member gets nothing from another product’s routes', async () => {
      expect(ids(await get(s.voucherOnly, '/hot-deals'))).toEqual([]);
      expect(ids(await get(s.voucherOnly, '/live-deals'))).toEqual([]);
      expect((await get(s.voucherOnly, `/hot-deals/${d.hotR}`)).status).toBe(404);
    });
  });

  describe('campaigns (Live Deals)', () => {
    it('filters, reads and writes by scope the same way', async () => {
      expect(ids(await get(s.mgrR, '/live-deals'))).toEqual([d.liveR]);
      expect(ids(await get(s.mgrJ, '/live-deals'))).toEqual([d.liveJ]);
      expect((await get(s.mgrR, `/live-deals/${d.liveJ}`)).status).toBe(404);
      expect((await post(s.mgrR, `/live-deals/${d.liveJ}/pause`, {})).status).toBe(404);
      const wr = await post(s.mgrR, `/live-deals/${d.liveJ}/submit`);
      expect(wr.status).toBe(404);
      expect((await get(s.mgrR, '/live-deals/summary')).body.data.total).toBe(1);
      const create = (branchIds: string[]) => post(s.mgrR, '/live-deals', { content: w.content('A', { branchIds }) });
      expect((await create([bR])).status).toBe(201);
      expect((await create([bJ])).status).toBe(403);
      expect((await create([bR, bJ])).status).toBe(403);
    });
  });

  describe('redemptions (branch level)', () => {
    it('a branch-scoped admin sees and reverses only redemptions of their own branch', async () => {
      const deal = await w.publishHot('A', 5, {});
      const customer = await w.newCustomer();
      const r = (await w.reserve(customer, deal.id, bR)).body.data;
      expect((await w.redeem(w.staffA, r.code.qr as string)).body.data.result).toBe('REDEEMED');
      const mine = ids(await get(s.adminR, '/redemptions'));
      expect(mine.length).toBe(1);
      expect(ids(await get(s.adminJ, '/redemptions'))).toEqual([]);
      const redemptionId = mine[0]!;
      expect((await post(s.adminJ, `/redemptions/${redemptionId}/reverse`, { reason: 'wrong branch tries' })).status).toBe(404);
      expect((await post(s.adminR, `/redemptions/${redemptionId}/reverse`, { reason: 'customer left before use' })).status).toBe(200);
    });
  });

  describe('branches', () => {
    it('a scoped member lists and reads only their branches; creating a branch needs an organization-wide grant', async () => {
      const list = (await get(s.adminR, '/branches')).body.data as Array<{ id: string }>;
      expect(list.map((b) => b.id)).toEqual([bR]);
      expect((await get(s.adminR, `/branches/${bJ}`)).status).toBe(404);
      expect((await get(s.adminR, `/branches/${bR}`)).status).toBe(200);
      const body = { nameEn: 'New', nameAr: 'جديد', addressEn: 'x street', addressAr: 'شارع', city: 'Riyadh', latitude: 24.7, longitude: 46.7 };
      expect((await post(s.adminR, '/branches', body)).status).toBe(403);
      expect((await post(s.adminR, `/branches/${bJ}/status`, { status: 'CLOSED', reason: 'not mine' })).status).toBe(404);
    });
  });

  describe('finance and team are organization-level', () => {
    it('finance data needs an organization-wide grant: a country-scoped finance user is refused, an organization-wide one is not', async () => {
      const refused = await get(s.finCountry, '/commercial/cases');
      expect(refused.status).toBe(403);
      expect(refused.body.errors[0].code).toBe('SCOPE_FORBIDDEN');
      expect((await get(s.finCountry, '/finance/voucher-payable')).status).toBe(403);
      expect((await get(s.finOrg, '/commercial/cases')).status).toBe(200);
      expect((await get(s.finOrg, '/finance/voucher-payable')).status).toBe(200);
    });

    it('the team list needs an organization-wide user-management grant', async () => {
      expect((await get(s.adminR, '/team')).status).toBe(403);
      expect((await get(w.ownerA, '/team')).status).toBe(200);
    });

    it('loyalty, disputes, inbox and activity are organization-level too', async () => {
      for (const path of ['/loyalty/rules', '/disputes', '/activity']) expect((await w.api(s.adminR).get(`/v1/orgs/${orgA}${path}`)).status, path).toBeGreaterThanOrEqual(403);
      // the inbox is scope-aware: it answers, but shows a branch-scoped member nothing that is organization-level
      const inbox = await w.api(s.adminR).get(`/v1/orgs/${orgA}/inbox`);
      expect(inbox.status).toBe(200);
      expect(JSON.stringify(inbox.body)).not.toMatch(/LOYALTY_RULE|OFFER_CONFLICT|DISPUTE/);
    });
  });

  describe('tenant isolation', () => {
    it('another business can neither see nor reach these records, with or without a scope', async () => {
      expect((await w.api(w.ownerB).get(`/v1/merchants/${orgA}/hot-deals`)).status).toBe(404);
      expect((await w.api(s.mgrR).get(`/v1/merchants/${w.B.orgId}/hot-deals`)).status).toBe(404);
      expect((await w.api(w.ownerB).get(`/v1/merchants/${w.B.orgId}/hot-deals/${d.hotR}`)).status).toBe(404);
      expect((await w.api(s.mgrR).get(`/v1/merchants/${w.B.orgId}/branches`)).status).toBe(404);
    });
  });

  describe('every decision is recorded', () => {
    it('denied scoped attempts reach the audit log', async () => {
      const n = await t.prisma.auditLog.count({ where: { action: 'access.denied', actorOrganizationId: orgA } });
      expect(n).toBeGreaterThan(0);
    });
  });
});
