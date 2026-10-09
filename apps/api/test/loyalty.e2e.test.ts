import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createBusinessUser, createDealDashOrg, createTestApp, idem, passwordSession, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';
import { LoyaltyIssuanceService } from '../src/loyalty/loyalty-issuance.service';

/**
 * Shared platform, Phase 3: loyalty rules (effective-dated, capped, funded, approved by a different person), issuance from
 * verified events through the one points ledger, reversal, allocation ceilings and the finance view.
 */
describe.skipIf(!DB_READY)('Loyalty engine (Phase 3)', () => {
  let t: TestApp;
  let w: HotWorld;
  let author: Session;
  let approver: Session;
  let customerId: string;
  const st: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    const dd = await createDealDashOrg(t.prisma);
    author = w.superAdmin;
    approver = await passwordSession(t, await createBusinessUser(t.prisma, { role: 'DEALDASH_FINANCE', orgId: dd.id, userType: 'ADMIN_USER', mfa: true }), 'admin', { completeMfa: true });
    const cust = await w.newCustomer();
    customerId = (cust.me as { id: string }).id;
  });
  afterAll(() => t?.close());

  const post = (s: Session, path: string, body: unknown = {}) => w.api(s).post(path).set('Idempotency-Key', idem()).send(body as object);
  const rule = (extra: Record<string, unknown> = {}) => ({
    name: 'Qualified view bonus',
    eventType: 'QUALIFIED_VIEW',
    basePoints: 10,
    maxAllocationPoints: 100,
    ...extra,
  });
  const issue = (id: string, eventType = 'QUALIFIED_VIEW', amount?: number) =>
    t.prisma.$transaction((tx) =>
      t.app.get(LoyaltyIssuanceService).issueForEvent(tx, { eventType, userId: customerId, product: 'WATCH', sourceType: 'VIEW', sourceId: id, amountHalalas: amount }),
    );
  const balance = async () => (await t.prisma.rewardAccount.findUnique({ where: { userId: customerId } }))?.availableBalance ?? 0;

  it('validates a rule: points required, funder required for business funding, unknown events refused', async () => {
    expect((await post(author, '/v1/admin/loyalty/rules', rule({ basePoints: 0 }))).status).toBe(400);
    expect((await post(author, '/v1/admin/loyalty/rules', rule({ fundingSource: 'BANK' }))).status).toBe(400);
    const bad = await post(author, '/v1/admin/loyalty/rules', rule({ eventType: 'WHATEVER_EVENT' }));
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].code).toBe('LOYALTY_RULE_INVALID');
  });

  it('a DRAFT or pending rule issues nothing; the author cannot approve their own rule', async () => {
    const c = await post(author, '/v1/admin/loyalty/rules', rule({ dailyCap: 15, customerCap: 25 }));
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    st.rule = c.body.data.id;
    expect((await issue('v-draft')).length).toBe(0);
    expect((await post(author, `/v1/admin/loyalty/rules/${st.rule}/submit`)).status).toBe(200);
    expect((await issue('v-pending')).length).toBe(0);
    const self = await post(author, `/v1/admin/loyalty/rules/${st.rule}/approve`);
    expect(self.status).toBe(403);
    const ok = await post(approver, `/v1/admin/loyalty/rules/${st.rule}/approve`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe('ACTIVE');
    // approval stamped the first campaign version
    expect(await t.prisma.campaignVersion.count({ where: { product: 'LOYALTY', subjectId: st.rule } })).toBe(1);
  });

  it('issues once per event (idempotent), respects the daily and customer caps, writes who/why/funder on the ledger entry', async () => {
    const a = await issue('v1');
    expect(a[0]?.points).toBe(10);
    expect((await issue('v1')).length).toBe(0); // same event: nothing more
    const b = await issue('v2'); // daily cap 15: only 5 left
    expect(b[0]?.points).toBe(5);
    expect((await issue('v3')).length).toBe(0);
    expect(await balance()).toBe(15);
    const e = await t.prisma.rewardEntry.findFirstOrThrow({ where: { ruleId: st.rule }, orderBy: { createdAt: 'asc' } });
    expect(e).toMatchObject({ fundingSource: 'DEALDASH', sourceProduct: 'WATCH', reasonCode: 'QUALIFIED_VIEW', type: 'EARN' });
    const rule = await t.prisma.loyaltyRule.findUniqueOrThrow({ where: { id: st.rule } });
    expect(rule.allocatedPoints).toBe(15);
  });

  it('a reversed event takes the points back exactly once and the ledger still adds up', async () => {
    const back = () =>
      t.prisma.$transaction((tx) => t.app.get(LoyaltyIssuanceService).reverseForSource(tx, { sourceType: 'EVENT', sourceId: 'view:v1', reason: 'VIEW_INVALID' }));
    expect(await back()).toBe(10);
    expect(await back()).toBe(0);
    expect(await balance()).toBe(5);
    const sum = await t.prisma.rewardEntry.aggregate({ _sum: { points: true }, where: { account: { userId: customerId }, bucket: 'AVAILABLE' } });
    expect(sum._sum.points).toBe(5);
    expect((await t.prisma.loyaltyRule.findUniqueOrThrow({ where: { id: st.rule } })).reversedPoints).toBe(10);
  });

  it('the allocation ceiling is a hard stop; raising it by the author alone is refused, by another person works', async () => {
    const c = await post(author, '/v1/admin/loyalty/rules', rule({ name: 'Spend bonus', eventType: 'VOUCHER_PURCHASE', basePoints: 0, pointsPer100Halalas: 1, maxAllocationPoints: 30 }));
    st.spend = c.body.data.id;
    await post(author, `/v1/admin/loyalty/rules/${st.spend}/submit`);
    await post(approver, `/v1/admin/loyalty/rules/${st.spend}/approve`);
    const first = await issue('o1', 'VOUCHER_PURCHASE', 2_000); // 20 points
    expect(first[0]?.points).toBe(20);
    const second = await issue('o2', 'VOUCHER_PURCHASE', 5_000); // wants 50, only 10 left
    expect(second[0]?.points).toBe(10);
    expect((await issue('o3', 'VOUCHER_PURCHASE', 5_000)).length).toBe(0);
    expect((await post(author, `/v1/admin/loyalty/rules/${st.spend}/allocation`, { maxAllocationPoints: 60 })).status).toBe(403);
    const up = await post(approver, `/v1/admin/loyalty/rules/${st.spend}/allocation`, { maxAllocationPoints: 60 });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.data.remainingAllocation).toBe(30);
    expect((await post(approver, `/v1/admin/loyalty/rules/${st.spend}/allocation`, { maxAllocationPoints: 10 })).status).toBe(422);
  });

  it('pausing stops issuance immediately; concurrent issuance can never exceed the ceiling', async () => {
    expect((await post(author, `/v1/admin/loyalty/rules/${st.spend}/pause`, { reason: 'review' })).status).toBe(200);
    expect((await issue('o4', 'VOUCHER_PURCHASE', 1_000)).length).toBe(0);
    expect((await post(author, `/v1/admin/loyalty/rules/${st.spend}/resume`)).status).toBe(200);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => issue(`race-${i}`, 'VOUCHER_PURCHASE', 1_000).catch(() => [])));
    const got = results.flat().reduce((n, r) => n + r.points, 0);
    const r = await t.prisma.loyaltyRule.findUniqueOrThrow({ where: { id: st.spend } });
    expect(r.allocatedPoints).toBeLessThanOrEqual(r.maxAllocationPoints!);
    expect(got).toBeLessThanOrEqual(30);
  });

  it('a business-funded rule needs an entitlement, the commercial agreement and cannot be approved without it', async () => {
    const orgA = w.A.orgId;
    const create = (s: Session, extra: Record<string, unknown> = {}) =>
      post(s, `/v1/orgs/${orgA}/loyalty/rules`, rule({ name: 'Merchant bonus', fundingSource: 'MERCHANT', fundingOrganizationId: orgA, fundingHalalasPerPoint: 5, ...extra }));
    const c = await create(w.ownerA);
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    st.funded = c.body.data.id;
    // a business cannot name DealDash as funder, nor another business
    expect((await create(w.ownerA, { fundingSource: 'DEALDASH', fundingOrganizationId: null, fundingHalalasPerPoint: null })).status).toBe(422);
    expect((await create(w.ownerA, { fundingOrganizationId: w.B.orgId })).status).toBe(422);
    // the other tenant cannot see or touch it
    expect((await post(w.ownerB, `/v1/orgs/${orgA}/loyalty/rules/${st.funded}/pause`)).status).toBe(404);
    expect((await w.api(w.ownerB).get(`/v1/orgs/${w.B.orgId}/loyalty/rules`)).body.data.length).toBe(0);
    // finance/staff roles without the permission are refused
    expect((await w.api(w.financeA).get(`/v1/orgs/${orgA}/loyalty/rules`)).status).toBe(403);
    // funded and unaccepted: it cannot be submitted
    const sub = await post(w.ownerA, `/v1/orgs/${orgA}/loyalty/rules/${st.funded}/submit`);
    expect(sub.status, JSON.stringify(sub.body)).toBe(422);
    expect(sub.body.errors[0].code).toBe('COMMERCIAL_ACCEPTANCE_REQUIRED');
  });

  it('the finance view reconciles issued, reversed and outstanding points per rule and states points have no cash value', async () => {
    const f = (await w.api(author).get('/v1/admin/loyalty/finance')).body.data;
    expect(f.note).toBe('points_have_no_fixed_cash_value');
    const row = f.rows.find((r: { ruleId: string }) => r.ruleId === st.rule);
    expect(row).toMatchObject({ issued: 15, reversed: 10, fundingSource: 'DEALDASH', fundingHalalasPerPoint: null, fundingUtilizedHalalas: null });
    expect(f.totals.issued).toBeGreaterThanOrEqual(15);
  });

  it('the shared ledger kept every entry; Watch & Earn and loyalty share one account and entries are append-only', async () => {
    const n = await t.prisma.rewardEntry.count({ where: { account: { userId: customerId } } });
    expect(n).toBeGreaterThan(3);
    await expect(t.prisma.rewardEntry.updateMany({ where: { account: { userId: customerId } }, data: { points: 999 } })).rejects.toThrow();
  });
});
