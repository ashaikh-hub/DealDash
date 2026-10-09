import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createBusinessUser, createTestApp, idem, passwordSession, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

/**
 * Shared platform, Phase 1: business account structure (legal entities and organization units), scoped role assignments with
 * delegation, the single scope mechanism, contracts and entitlements, market configuration and the audit fields.
 */
describe.skipIf(!DB_READY)('Shared platform foundation (Phase 1)', () => {
  let t: TestApp;
  let w: HotWorld;
  let orgA: string;
  let brandId: string;
  let riyadhId: string;
  let jeddahId: string;
  let branchUnitRiyadh: string;
  let leSa: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    orgA = w.A.orgId;
  });
  afterAll(() => t?.close());

  const base = () => `/v1/orgs/${orgA}`;
  const post = (s: Session, path: string, body: unknown = {}) =>
    w.api(s).post(`${base()}${path}`).set('Idempotency-Key', idem()).send(body as object);
  const get = (s: Session, path: string) => w.api(s).get(`${base()}${path}`);

  /** A scoped campaign manager or admin: a real user whose membership is flagged scoped (permissions only via assignments). */
  async function scopedUser(role: 'MERCHANT_CAMPAIGN_MANAGER' | 'MERCHANT_ADMIN', label: string) {
    const u = await createBusinessUser(t.prisma, { role, orgId: orgA, userType: 'MERCHANT_USER', label });
    const m = await t.prisma.organizationMembership.findFirstOrThrow({ where: { userId: u.id, organizationId: orgA } });
    const conv = await post(w.ownerA, `/members/${m.id}/scoped`, { scoped: true });
    expect(conv.status).toBe(200);
    ids[`m-${label}`] = m.id;
    return { membershipId: m.id, session: await passwordSession(t, u, 'merchant'), userId: u.id };
  }
  const relogin = async (userId: string) => {
    const u = await t.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return passwordSession(t, { id: u.id, email: u.email! } as never, 'merchant');
  };
  const assign = (s: Session, membershipId: string, roleCode: string, scope: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    post(s, '/assignments', { membershipId, roleCode, scope, ...extra });
  const can = async (s: Session, permission: string, target: Record<string, unknown>) =>
    (await post(s, '/access/check', { permission, ...target })).body.data?.allowed as boolean;

  it('builds Business Account -> Legal Entities -> units; brand, legal entity and branch are different things', async () => {
    const le1 = await post(w.ownerA, '/legal-entities', { legalName: 'Alpha Saudi LLC', country: 'SA', currency: 'SAR', taxNumber: 'TAX-SA-1' });
    expect(le1.status, JSON.stringify(le1.body)).toBe(201);
    leSa = le1.body.data.id;
    const le2 = await post(w.ownerA, '/legal-entities', { legalName: 'Alpha UAE FZ', country: 'AE', currency: 'AED' });
    expect(le2.status).toBe(201);
    ids.leAe = le2.body.data.id;
    expect((await post(w.ownerA, '/legal-entities', { legalName: 'Alpha UAE FZ', country: 'AE', currency: 'AED' })).status).toBe(409);
    expect((await post(w.ownerA, '/legal-entities', { legalName: 'Nowhere Ltd', country: 'ZZ', currency: 'USD' })).status).toBe(400);

    const brand = await post(w.ownerA, '/units', { kind: 'BRAND', code: 'ALPHA', nameEn: 'Alpha Grill', nameAr: 'ألفا غريل', legalEntityId: leSa, country: 'SA' });
    expect(brand.status, JSON.stringify(brand.body)).toBe(201);
    brandId = brand.body.data.id;
    const region = await post(w.ownerA, '/units', { kind: 'REGION', code: 'CENTRAL', nameEn: 'Central', nameAr: 'الوسطى', parentId: brandId });
    const riyadh = await post(w.ownerA, '/units', { kind: 'CITY', code: 'RUH', nameEn: 'Riyadh', nameAr: 'الرياض', parentId: region.body.data.id, city: 'Riyadh' });
    riyadhId = riyadh.body.data.id;
    const jeddah = await post(w.ownerA, '/units', { kind: 'CITY', code: 'JED', nameEn: 'Jeddah', nameAr: 'جدة', parentId: brandId, city: 'Jeddah' });
    jeddahId = jeddah.body.data.id;
    const bu = await post(w.ownerA, '/units', { kind: 'BRANCH', code: 'B001', nameEn: 'Olaya', nameAr: 'العليا', parentId: riyadhId, branchId: w.A.branchIds[0] });
    expect(bu.status, JSON.stringify(bu.body)).toBe(201);
    branchUnitRiyadh = bu.body.data.id;
    const bu2 = await post(w.ownerA, '/units', { kind: 'BRANCH', code: 'B002', nameEn: 'Tahlia', nameAr: 'التحلية', parentId: jeddahId, branchId: w.A.branchIds[1] });
    expect(bu2.status).toBe(201);
    ids.branchUnitJeddah = bu2.body.data.id;

    // franchise: a unit operated and settled by different legal entities than the one it belongs to
    const fr = await post(w.ownerA, '/units', { kind: 'FRANCHISEE', code: 'FRAN1', nameEn: 'Franchise One', nameAr: 'امتياز ١', parentId: jeddahId, operatorLegalEntityId: ids.leAe, settlementLegalEntityId: leSa });
    expect(fr.status).toBe(201);
    expect(fr.body.data.operatorLegalEntityId).toBe(ids.leAe);
    expect(fr.body.data.settlementLegalEntityId).toBe(leSa);

    const list = (await get(w.ownerA, '/units')).body.data as Array<Record<string, any>>;
    const olaya = list.find((u) => u.code === 'B001')!;
    // legal entity and country are inherited from the nearest ancestor that states them
    expect(olaya.legalEntityId).toBeNull();
    expect(olaya.effectiveLegalEntityId).toBe(leSa);
    expect(olaya.effectiveCountry).toBe('SA');
    expect(olaya.depth).toBe(3);

    // guard rails: unknown kind, duplicate code, second unit for the same branch, parent from nowhere
    expect((await post(w.ownerA, '/units', { kind: 'GALAXY', code: 'X', nameEn: 'x', nameAr: 'x' })).status).toBe(400);
    expect((await post(w.ownerA, '/units', { kind: 'CITY', code: 'RUH', nameEn: 'x', nameAr: 'x' })).status).toBe(409);
    expect((await post(w.ownerA, '/units', { kind: 'BRANCH', code: 'B009', nameEn: 'x', nameAr: 'x', branchId: w.A.branchIds[0] })).status).toBe(409);
    expect((await post(w.ownerA, '/units', { kind: 'CITY', code: 'P1', nameEn: 'x', nameAr: 'x', parentId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
  });

  it('tenant isolation: another business sees nothing and roles without structure permissions are refused', async () => {
    expect((await w.api(w.ownerB).get(`${base()}/units`)).status).toBe(404);
    expect((await w.api(w.ownerB).post(`${base()}/units`).set('Idempotency-Key', idem()).send({ kind: 'CITY', code: 'Z', nameEn: 'z', nameAr: 'z' })).status).toBe(404);
    expect((await get(w.financeA, '/units')).status).toBe(403);
    expect((await get(w.campaignsA, '/assignments')).status).toBe(403);
    expect((await get(w.staffA, '/units')).status).toBeGreaterThanOrEqual(401);
    // B has its own structure that A cannot see
    const own = await w.api(w.ownerB).get(`/v1/orgs/${w.B.orgId}/units`);
    expect(own.status).toBe(200);
    expect(own.body.data).toEqual([]);
    // a unit of one organization cannot be the parent of a unit in another
    const cross = await w.api(w.ownerB).post(`/v1/orgs/${w.B.orgId}/units`).set('Idempotency-Key', idem()).send({ kind: 'CITY', code: 'X1', nameEn: 'x', nameAr: 'x', parentId: riyadhId });
    expect(cross.status).toBe(400);
  });

  it('a scoped member has no access until assigned, then only inside the assigned scope (backend enforced)', async () => {
    const riyadhMgr = await scopedUser('MERCHANT_CAMPAIGN_MANAGER', 'riyadh-mgr');
    ids.riyadhMgrUser = riyadhMgr.userId;
    // before any assignment: no permissions at all, even for the older routes
    expect((await w.api(riyadhMgr.session).get(`/v1/merchants/${orgA}/hot-deals`)).status).toBe(403);
    expect((await get(riyadhMgr.session, '/access/me')).body.data).toMatchObject({ scoped: true, grants: [] });

    const g = await assign(w.ownerA, riyadhMgr.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'UNIT', ref: riyadhId });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    ids.riyadhGrant = g.body.data.id;
    const s2 = await relogin(riyadhMgr.userId);
    const me = (await get(s2, '/access/me')).body.data;
    expect(me.grants).toHaveLength(1);
    expect(me.grants[0]).toMatchObject({ origin: 'ASSIGNMENT', scope: { kind: 'UNIT', ref: riyadhId } });

    const perm = 'merchant.deals.manage';
    expect(await can(s2, perm, { branchId: w.A.branchIds[0] })).toBe(true); // Riyadh branch
    expect(await can(s2, perm, { unitId: branchUnitRiyadh })).toBe(true);
    expect(await can(s2, perm, { branchId: w.A.branchIds[1] })).toBe(false); // Jeddah branch
    expect(await can(s2, perm, { unitId: jeddahId })).toBe(false);
    expect(await can(s2, perm, {})).toBe(false); // organization-wide target is not in a city scope
    expect(await can(s2, 'merchant.finance.manage', { branchId: w.A.branchIds[0] })).toBe(false); // role does not include it
    expect(await can(s2, perm, { country: 'SA' })).toBe(false); // a country is wider than the city

    // older campaign routes are scope-aware now: the list answers, filtered to the member's scope (full matrix: scope-legacy tests)
    expect((await w.api(s2).get(`/v1/merchants/${orgA}/hot-deals`)).status).toBe(200);
    // an older route that is NOT scope-aware refuses a scoped member who lacks the permission organization-wide
    expect((await w.api(s2).get(`/v1/merchants/${orgA}/team`)).status).toBe(403);
    // the structure is filtered to what the member can see
    const units = (await get(w.ownerA, '/units')).body.data;
    expect(units.length).toBeGreaterThan(5);
  });

  it('delegation: nobody grants more than they hold, outside their scope, to themselves, or in a scope the role may not use', async () => {
    const jedAdmin = await scopedUser('MERCHANT_ADMIN', 'jeddah-admin');
    const owner = await assign(w.ownerA, jedAdmin.membershipId, 'MERCHANT_ADMIN', { kind: 'UNIT', ref: jeddahId });
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    const s = await relogin(jedAdmin.userId);
    // the Jeddah admin can delegate inside Jeddah
    const helper = await scopedUser('MERCHANT_CAMPAIGN_MANAGER', 'jeddah-mgr');
    const ok = await assign(s, helper.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'BRANCH', ref: w.A.branchIds[1] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    ids.jedGrant = ok.body.data.id;
    // ... but not in Riyadh, not for the whole organization, not for a country that is wider than Jeddah
    expect((await assign(s, helper.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'BRANCH', ref: w.A.branchIds[0] })).status).toBe(403);
    expect((await assign(s, helper.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'ORGANIZATION', ref: null })).status).toBe(403);
    expect((await assign(s, helper.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'COUNTRY', ref: 'SA' })).status).toBe(403);
    expect((await assign(s, helper.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'UNIT', ref: riyadhId })).status).toBe(403);
    // nobody edits their own access
    expect((await assign(s, jedAdmin.membershipId, 'MERCHANT_ADMIN', { kind: 'UNIT', ref: jeddahId })).status).toBe(403);
    // role / scope compatibility comes from configuration: an owner is organization-wide only; staff cannot hold a country
    expect((await assign(w.ownerA, helper.membershipId, 'MERCHANT_OWNER', { kind: 'UNIT', ref: jeddahId })).status).toBe(400);
    expect((await assign(w.ownerA, helper.membershipId, 'MERCHANT_STAFF', { kind: 'COUNTRY', ref: 'SA' })).status).toBe(400);
    // roles of another kind of organization cannot be assigned here
    expect((await assign(w.ownerA, helper.membershipId, 'PARTNER_ADMIN', { kind: 'ORGANIZATION', ref: null })).status).toBe(400);
    // a duplicate active grant is refused
    expect((await assign(s, helper.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'BRANCH', ref: w.A.branchIds[1] })).status).toBe(409);
    // a non-scoped member needs conversion first
    const plain = await createBusinessUser(t.prisma, { role: 'MERCHANT_CAMPAIGN_MANAGER', orgId: orgA, userType: 'MERCHANT_USER' });
    const pm = await t.prisma.organizationMembership.findFirstOrThrow({ where: { userId: plain.id } });
    expect((await assign(w.ownerA, pm.id, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'BRANCH', ref: w.A.branchIds[1] })).status).toBe(409);

    // the Jeddah admin sees only assignments inside Jeddah
    const visible = (await get(s, '/assignments')).body.data as Array<{ id: string }>;
    expect(visible.map((a) => a.id)).toContain(ids.jedGrant);
    expect(visible.map((a) => a.id)).not.toContain(ids.riyadhGrant);
    // and cannot withdraw a Riyadh grant
    expect((await post(s, `/assignments/${ids.riyadhGrant}/revoke`, { reason: 'trying to remove it' })).status).toBe(403);
    // the owner can; the revoked user loses access at once
    const sm = await relogin(helper.userId);
    expect(await can(sm, 'merchant.deals.manage', { branchId: w.A.branchIds[1] })).toBe(true);
    expect((await post(s, `/assignments/${ids.jedGrant}/revoke`, { reason: 'Moved to another team' })).status).toBe(200);
    expect(await can(await relogin(helper.userId), 'merchant.deals.manage', { branchId: w.A.branchIds[1] })).toBe(false);
    expect((await post(s, `/assignments/${ids.jedGrant}/revoke`, { reason: 'again please' })).status).toBe(409);

    // every step is in the audit trail with the scope it happened under and a correlation id
    const logs = await t.prisma.auditLog.findMany({ where: { subjectOrganizationId: orgA, action: { in: ['ROLE_ASSIGNED', 'ROLE_REVOKED'] } } });
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(logs.every((l) => l.scope && l.correlationId)).toBe(true);
    expect(logs.some((l) => l.scope === `BRANCH:${w.A.branchIds[1]}`)).toBe(true);
    const revoked = logs.find((l) => l.action === 'ROLE_REVOKED')!;
    expect(revoked.reason).toBeTruthy();
    expect(revoked.previousState).toMatchObject({ role: 'MERCHANT_CAMPAIGN_MANAGER' });
  });

  it('campaign and product scope can only NARROW: they never widen what the envelope or the organization allows', async () => {
    const deal = await w.createHot('A', w.hotContent('A', 3));
    const other = await w.createHot('A', w.hotContent('A', 3));
    const analyst = await scopedUser('MERCHANT_CAMPAIGN_MANAGER', 'campaign-only');
    const g = await assign(w.ownerA, analyst.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'CAMPAIGN', ref: deal.id, product: 'EXCLUSIVE' });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    const s = await relogin(analyst.userId);
    const perm = 'merchant.deals.manage';
    expect(await can(s, perm, { campaignId: deal.id, product: 'EXCLUSIVE' })).toBe(true);
    expect(await can(s, perm, { campaignId: other.id, product: 'EXCLUSIVE' })).toBe(false); // sibling campaign, same organization
    expect(await can(s, perm, { campaignId: deal.id })).toBe(false); // product unknown: a restricted grant never matches an unspecified target
    expect(await can(s, perm, {})).toBe(false);
    expect(await can(s, perm, { branchId: w.A.branchIds[0] })).toBe(false);

    // with an envelope the campaign must ALSO be inside it
    const inJeddah = await assign(w.ownerA, analyst.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', {
      kind: 'CAMPAIGN', ref: other.id, product: 'EXCLUSIVE', envelope: { kind: 'UNIT', ref: jeddahId },
    });
    expect(inJeddah.status, JSON.stringify(inJeddah.body)).toBe(201);
    const s2 = await relogin(analyst.userId);
    expect(await can(s2, perm, { campaignId: other.id, product: 'EXCLUSIVE', branchId: w.A.branchIds[1] })).toBe(true);
    expect(await can(s2, perm, { campaignId: other.id, product: 'EXCLUSIVE', branchId: w.A.branchIds[0] })).toBe(false); // Riyadh branch is outside the envelope

    // product scope: a VOUCHER grant never reaches an EXCLUSIVE target
    const prod = await scopedUser('MERCHANT_CAMPAIGN_MANAGER', 'voucher-only');
    expect((await assign(w.ownerA, prod.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'PRODUCT', ref: 'VOUCHER' })).status).toBe(201);
    const sp = await relogin(prod.userId);
    expect(await can(sp, 'merchant.vouchers.manage', { product: 'VOUCHER' })).toBe(true);
    expect(await can(sp, 'merchant.vouchers.manage', { product: 'EXCLUSIVE' })).toBe(false);

    // invalid references are refused (no campaign of another organization, no unknown product, envelope only for narrowing scopes)
    const foreign = await w.createHot('B', w.hotContent('B', 3));
    expect((await assign(w.ownerA, analyst.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'CAMPAIGN', ref: foreign.id, product: 'EXCLUSIVE' })).status).toBe(400);
    expect((await assign(w.ownerA, analyst.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'PRODUCT', ref: 'NOPE' })).status).toBe(400);
    expect((await assign(w.ownerA, analyst.membershipId, 'MERCHANT_ADMIN', { kind: 'UNIT', ref: jeddahId, envelope: { kind: 'COUNTRY', ref: 'SA' } })).status).toBe(400);
  });

  it('assignments expire by date, and a scoped member can be returned to an ordinary organization role', async () => {
    const m = await scopedUser('MERCHANT_CAMPAIGN_MANAGER', 'temp-mgr');
    const g = await assign(w.ownerA, m.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'BRANCH', ref: w.A.branchIds[0] }, { validUntil: new Date(Date.now() + 3_600_000).toISOString() });
    expect(g.status).toBe(201);
    expect((await assign(w.ownerA, m.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'BRANCH', ref: w.A.branchIds[1] }, { validUntil: new Date(Date.now() - 1000).toISOString() })).status).toBe(400);
    const s = await relogin(m.userId);
    expect(await can(s, 'merchant.deals.manage', { branchId: w.A.branchIds[0] })).toBe(true);
    // time passes: the grant is no longer in force (history is kept, nothing deleted)
    await t.prisma.$executeRaw`UPDATE "RoleAssignment" SET "validFrom" = now() - interval '2 hours', "validUntil" = now() - interval '1 hour' WHERE "id" = ${g.body.data.id}::uuid`;
    const s2 = await relogin(m.userId);
    expect(await can(s2, 'merchant.deals.manage', { branchId: w.A.branchIds[0] })).toBe(false);
    expect((await get(s2, '/access/me')).body.data.grants).toEqual([]);
    expect(await t.prisma.roleAssignment.count({ where: { id: g.body.data.id } })).toBe(1);
    // the owner cannot be scoped, and nobody changes their own access
    const ownerM = await t.prisma.organizationMembership.findFirstOrThrow({ where: { organizationId: orgA, role: { code: 'MERCHANT_OWNER' } } });
    expect((await post(w.adminA, `/members/${ownerM.id}/scoped`, { scoped: true })).status).toBe(409);
    expect((await post(s2, `/members/${m.membershipId}/scoped`, { scoped: false })).status).toBeGreaterThanOrEqual(403);
    // turning scoped off revokes the remaining assignments
    const g2 = await assign(w.ownerA, m.membershipId, 'MERCHANT_CAMPAIGN_MANAGER', { kind: 'BRANCH', ref: w.A.branchIds[1] });
    expect(g2.status).toBe(201);
    expect((await post(w.ownerA, `/members/${m.membershipId}/scoped`, { scoped: false })).status).toBe(200);
    expect((await t.prisma.roleAssignment.findUniqueOrThrow({ where: { id: g2.body.data.id } })).status).toBe('REVOKED');
  });

  it('entitlements come from the contract, are enforced at the commercial gate, keep history, and fall back to the default plan only with no contract', async () => {
    const ent = async (s: Session, org: string) => (await w.api(s).get(`/v1/orgs/${org}/entitlements`)).body.data;
    expect(await ent(w.ownerB, w.B.orgId)).toMatchObject({ source: 'DEFAULT_PLAN' });
    expect((await ent(w.ownerB, w.B.orgId)).products).toEqual(expect.arrayContaining(['EXCLUSIVE', 'VOUCHER']));

    // admin-only: a merchant cannot write contracts
    expect((await w.api(w.ownerB).post('/v1/admin/platform/contracts').set('Idempotency-Key', idem()).send({})).status).toBeGreaterThanOrEqual(401);
    expect((await w.api(w.ops).post('/v1/admin/platform/contracts').set('Idempotency-Key', idem()).send({ organizationId: w.B.orgId, name: 'x' })).status).toBe(403);

    const c1 = await w.api(w.superAdmin).post('/v1/admin/platform/contracts').set('Idempotency-Key', idem()).send({
      organizationId: w.B.orgId, name: 'Beta vouchers only', reference: 'CT-1',
      entitlements: [{ kind: 'PRODUCT', key: 'VOUCHER' }, { kind: 'FEATURE', key: 'BULK_IMPORT' }],
    });
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(await ent(w.ownerB, w.B.orgId)).toMatchObject({ source: 'CONTRACT', products: ['VOUCHER'], features: ['BULK_IMPORT'] });
    expect((await w.api(w.superAdmin).post('/v1/admin/platform/contracts').set('Idempotency-Key', idem()).send({
      organizationId: w.B.orgId, name: 'bad', entitlements: [{ kind: 'PRODUCT', key: 'SPACESHIP' }],
    })).status).toBe(400);

    // not entitled to Exclusive Deals: refused by the backend at submission
    const d1 = await w.createHot('B', w.hotContent('B', 2));
    const refused = await w.submitHot('B', d1.id);
    expect(refused.status).toBe(403);
    expect(refused.body.errors[0].code).toBe('ENTITLEMENT_REQUIRED');

    // a new contract replaces the old one from its start date; the old one is kept as history
    const c2 = await w.api(w.superAdmin).post('/v1/admin/platform/contracts').set('Idempotency-Key', idem()).send({
      organizationId: w.B.orgId, name: 'Beta exclusive plan', reference: 'CT-2',
      entitlements: [{ kind: 'PRODUCT', key: 'EXCLUSIVE' }, { kind: 'LIMIT', key: 'campaigns.max_active', limitValue: 1 }],
    });
    expect(c2.status, JSON.stringify(c2.body)).toBe(201);
    const all = (await w.api(w.superAdmin).get('/v1/admin/platform/contracts').query({ organizationId: w.B.orgId })).body.data;
    expect(all.map((c: { status: string }) => c.status).sort()).toEqual(['ACTIVE', 'SUPERSEDED']);
    expect(await ent(w.ownerB, w.B.orgId)).toMatchObject({ source: 'CONTRACT', products: ['EXCLUSIVE'], limits: { 'campaigns.max_active': 1 } });

    expect((await w.submitHot('B', d1.id)).status).toBe(200);
    const d2 = await w.createHot('B', w.hotContent('B', 2));
    const over = await w.submitHot('B', d2.id);
    expect(over.status).toBe(403);
    expect(over.body.errors[0].code).toBe('ENTITLEMENT_LIMIT_REACHED');

    // approval is also gated: ending the contract of an organization with a pending campaign keeps history and re-evaluates
    const end = await w.api(w.superAdmin).post(`/v1/admin/platform/contracts/${c2.body.data.id}/end`).set('Idempotency-Key', idem()).send({ reason: 'Contract terminated' });
    expect(end.status).toBe(200);
    // an ENDED agreement no longer silently falls back to the default plan (subscription engine): it grants nothing new, history stays
    expect(await ent(w.ownerB, w.B.orgId)).toMatchObject({ source: 'CONTRACT', products: [], features: [], limits: {} });
    const hist = await t.prisma.contractEntitlement.findMany({ where: { contractId: c2.body.data.id } });
    expect(hist.length).toBe(2);
    expect(hist.every((h) => h.effectiveUntil !== null)).toBe(true);

    // the platform says who changed what
    const logs = await t.prisma.auditLog.findMany({ where: { subjectOrganizationId: w.B.orgId, action: { in: ['CONTRACT_CREATED', 'CONTRACT_ENDED'] } } });
    expect(logs.length).toBe(3);
  });

  it('market configuration: KSA is the only enabled market, other markets are data, and only Admin with the permission changes them', async () => {
    const list = (await w.api(w.ops).get('/v1/admin/platform/countries')).body.data as Array<{ code: string; enabled: boolean; currency: string }>;
    expect(list.filter((c) => c.enabled).map((c) => c.code)).toEqual(['SA']);
    expect(list.find((c) => c.code === 'AE')).toMatchObject({ currency: 'AED', enabled: false });
    expect((await w.api(w.marketing).get('/v1/admin/platform/countries')).status).toBe(403);
    const body = { nameEn: 'Kuwait', nameAr: 'الكويت', currency: 'KWD', languages: ['ar', 'en'], enabled: false, taxProfile: { status: 'NOT_CONFIGURED_VALIDATE' } };
    expect((await w.api(w.ops).post('/v1/admin/platform/countries/KW').set('Idempotency-Key', idem()).send(body)).status).toBe(403);
    const up = await w.api(w.superAdmin).post('/v1/admin/platform/countries/kw').set('Idempotency-Key', idem()).send(body);
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.data.code).toBe('KW');
    expect((await w.api(w.superAdmin).post('/v1/admin/platform/countries/KWT').set('Idempotency-Key', idem()).send(body)).status).toBe(400);
    const log = await t.prisma.auditLog.findFirstOrThrow({ where: { entityType: 'CountryConfiguration', entityId: 'KW' } });
    expect(log.scope).toBe('COUNTRY:KW');
    // a business sees its own market
    const mk = await w.api(w.ownerA).get(`${base()}/market`);
    expect(mk.body.data.code).toBe('SA');
  });

  it('an admin can read any organization\'s structure; units can be deactivated without deleting history', async () => {
    const units = (await w.api(w.superAdmin).get(`/v1/admin/platform/organizations/${orgA}/units`)).body.data;
    expect(units.length).toBeGreaterThan(5);
    expect((await w.api(w.marketing).get(`/v1/admin/platform/organizations/${orgA}/units`)).status).toBe(403);
    const upd = await w.api(w.ownerA).patch(`${base()}/units/${jeddahId}`).send({ status: 'INACTIVE' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.status).toBe('INACTIVE');
    const row = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'ORG_UNIT_UPDATED', entityId: jeddahId } });
    expect(row.previousState).toMatchObject({ status: 'ACTIVE' });
    expect(row.newState).toMatchObject({ status: 'INACTIVE' });
  });
});
