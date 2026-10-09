import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AI_EVAL_CASES } from '@dealdash/types';
import { DB_READY, RIYADH, createBusinessUser, createTestApp, idem, passwordSession, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';
import { EntitlementService } from '../src/platform/entitlement.service';
import { projectSince } from './visibility-helpers';

/**
 * Governed AI agents: entitlement and permission gates, tenant and scope isolation, grounded answers with labelled statements,
 * eligibility-aware recommendations, no execution without a person, human approval then execution as the approver, audit,
 * usage metering, autonomy limits, Arabic and the Urdu fallback, and the evaluation pack.
 */
describe.skipIf(!DB_READY)('Phase 5: governed AI agents', () => {
  let t: TestApp;
  let w: HotWorld;
  let customer: Session;
  let fin: Session;
  let dealId: string;
  const orgA = () => w.A.orgId;
  const post = (s: Session, path: string, body: unknown = {}) => w.api(s).post(path).set('Idempotency-Key', idem()).send(body as object);
  const ask = (s: Session, path: string, body: Record<string, unknown>) => post(s, path, body);
  const orgAsk = (s: Session, message: string, extra: Record<string, unknown> = {}) => ask(s, `/v1/orgs/${orgA()}/ai/ask`, { message, ...extra });

  beforeAll(async () => {
    const started = new Date(Date.now() - 60_000);
    t = await createTestApp();
    w = await buildHotWorld(t);
    const deal = await w.publishHot('A', 5);
    dealId = deal.id;
    customer = await w.newCustomer();
    // some verified activity so the merchant copilot has facts to work with
    const buyer = await w.newCustomer();
    const r = (await w.reserve(buyer, dealId, w.A.branchIds[0]!)).body.data;
    expect((await w.redeem(w.staffA, r.code.qr)).body.data.result).toBe('REDEEMED');
    await projectSince(t, started);
    // business AI is an entitlement (AI_COPILOT): merchant A has it through its contract, merchant B does not
    const e = await t.app.get(EntitlementService).effective(orgA());
    const ct = await post(w.superAdmin, '/v1/admin/platform/contracts', { organizationId: orgA(), name: 'Alpha with AI', entitlements: [...e.products.map((key) => ({ kind: 'PRODUCT', key })), ...[...e.features, 'AI_COPILOT'].map((key) => ({ kind: 'FEATURE', key }))] });
    expect(ct.status, JSON.stringify(ct.body)).toBe(201);
    const dd = await t.prisma.organizationMembership.findFirstOrThrow({ where: { userId: w.superAdmin.me.id } });
    fin = await passwordSession(t, await createBusinessUser(t.prisma, { role: 'DEALDASH_FINANCE', orgId: dd.organizationId, userType: 'ADMIN_USER', mfa: true }), 'admin', { completeMfa: true });
  });
  afterAll(() => t?.close());

  describe('Customer Best-Deal agent', () => {
    it('recommends only offers the customer can use now, explains why, and labels the answer', async () => {
      const r = await ask(customer, '/v1/app/ai/ask', { message: 'What are the best deals near me?', context: { lat: RIYADH.lat, lng: RIYADH.lng } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const d = r.body.data;
      expect(d).toMatchObject({ agent: 'CUSTOMER_BEST_DEAL', intent: 'BEST_DEALS', label: 'AI_SUGGESTED', autonomyLevel: 1 });
      // other suites share the database, so the fixture deal may rank below others: check the rule on every recommendation
      expect(d.items.length).toBeGreaterThan(0);
      for (const item of d.items as Array<{ id: string; product: string; why: string[]; action: { kind: string; requiresConfirmation: boolean } }>) {
        expect(item.why.length).toBeGreaterThan(0);
        if (item.product === 'EXCLUSIVE') {
          const h = await t.prisma.hotDeal.findUniqueOrThrow({ where: { id: item.id } });
          expect(h.status).toBe('LIVE');
          if (h.endAt) expect(h.endAt.getTime()).toBeGreaterThan(Date.now());
          if (item.action.kind === 'RESERVE') expect(item.action.requiresConfirmation).toBe(true);
        }
      }
      const mine = d.items.find((i: { id: string }) => i.id === dealId);
      if (mine) expect(mine).toMatchObject({ product: 'EXCLUSIVE', action: { kind: 'RESERVE', requiresConfirmation: true } });
      expect(d.statements.map((s: { kind: string }) => s.kind)).toEqual(expect.arrayContaining(['OBSERVED_FACT', 'RECOMMENDATION']));
      expect(d.grounding.dropped).toBe(0);
      const audit = await t.prisma.aiInteraction.findUniqueOrThrow({ where: { id: d.interactionId } });
      expect(audit).toMatchObject({ agent: 'CUSTOMER_BEST_DEAL', userId: customer.me.id, status: 'ANSWERED', intent: 'BEST_DEALS' });
      const tools = (await t.prisma.aiAction.findMany({ where: { interactionId: d.interactionId } })).map((a) => a.tool);
      expect(tools).toEqual(expect.arrayContaining(['deals.live', 'deals.exclusive', 'vouchers.catalog']));
      expect(await t.prisma.aiUsageRecord.count({ where: { interactionId: d.interactionId, kind: 'REQUEST' } })).toBe(1);
    });

    it('never reserves, buys or spends points itself', async () => {
      const before = await t.prisma.reservation.count({ where: { userId: customer.me.id } });
      const r = await ask(customer, '/v1/app/ai/ask', { message: 'Reserve this deal for me and pay', context: { lat: RIYADH.lat, lng: RIYADH.lng } });
      expect(r.body.data.intent).toBe('TRANSACT');
      expect(r.body.data.statements[0].text).toMatch(/can’t buy, reserve, pay/);
      expect(await t.prisma.reservation.count({ where: { userId: customer.me.id } })).toBe(before);
      expect(r.body.data.items.every((i: { action: { kind: string; requiresConfirmation: boolean } }) => i.action.kind === 'VIEW' || i.action.requiresConfirmation)).toBe(true);
    });

    it('answers from the customer’s own ledgers (points), in Arabic, and falls back from Urdu openly', async () => {
      const pts = await ask(customer, '/v1/app/ai/ask', { message: 'كم رصيد نقاطي؟', locale: 'ar' });
      expect(pts.body.data.intent).toBe('MY_POINTS');
      expect(pts.body.data.statements[0]).toMatchObject({ kind: 'OBSERVED_FACT', text: 'لديك 0 نقطة متاحة.' });
      const ur = await ask(customer, '/v1/app/ai/ask', { message: 'best deals', locale: 'ur' });
      expect(ur.body.data.localeNote).toEqual({ requested: 'ur', answeredIn: 'en', reason: 'LOCALE_NOT_SUPPORTED_YET' });
    });

    it('a customer cannot reach business or DealDash agents', async () => {
      expect([401, 403]).toContain((await orgAsk(customer, 'how are we doing')).status);
      expect([401, 403]).toContain((await ask(customer, '/v1/admin/ai/ask', { agent: 'ADMIN_FINANCE', message: 'receivables' })).status);
    });
  });

  describe('Merchant Growth copilot', () => {
    it('needs the AI_COPILOT entitlement; the refusal is recorded', async () => {
      const r = await ask(w.ownerB, `/v1/orgs/${w.B.orgId}/ai/ask`, { message: 'how are we doing' });
      expect(r.status).toBe(403);
      expect(r.body.errors[0].code).toBe('AI_NOT_ENTITLED');
      expect(await t.prisma.aiInteraction.count({ where: { userId: w.ownerB.me.id, status: 'DENIED' } })).toBe(1);
    });

    it('summarises observed performance with labelled statements, inside its own tenant only', async () => {
      const r = await orgAsk(w.ownerA, 'How are we doing this month?');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const facts = r.body.data.statements.filter((s: { kind: string }) => s.kind === 'OBSERVED_FACT').map((s: { text: string }) => s.text).join(' ');
      expect(facts).toMatch(/Exclusive Deals, last 30 days: .*verified redemptions 1/);
      expect(r.body.data.grounding.dropped).toBe(0);
      expect((await ask(w.ownerA, `/v1/orgs/${w.B.orgId}/ai/ask`, { message: 'how is Beta doing' })).status).toBe(404);
      expect([401, 403]).toContain((await orgAsk(w.staffA, 'how are we doing')).status);
    });

    it('autonomy is capped: bounded autonomy (4) is disabled and full autonomy (5) refused', async () => {
      for (const autonomy of [4, 5]) {
        const r = await orgAsk(w.ownerA, 'run my campaigns', { autonomy });
        expect(r.status).toBe(403);
        expect(r.body.errors[0].code).toBe('AI_AUTONOMY_EXCEEDED');
      }
    });

    it('drafts targets; nothing changes until a person with the right permission approves; then it executes as that person', async () => {
      const r = await orgAsk(w.campaignsA, 'Suggest targets for next month', { autonomy: 2 });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const draft = r.body.data.drafts[0];
      expect(draft).toMatchObject({ kind: 'CAMPAIGN_TARGETS', status: 'PENDING_APPROVAL', label: 'AI_DRAFTED', requiresApprovalBy: 'merchant.targets.manage' });
      expect(await t.prisma.campaignTarget.count({ where: { organizationId: orgA(), source: 'AI_DRAFT' } })).toBe(0);
      // without drafting enabled the agent only recommends
      const rec = await orgAsk(w.campaignsA, 'Suggest targets for next month');
      expect(rec.body.data.drafts).toHaveLength(0);
      const denied = await post(w.financeA, `/v1/orgs/${orgA()}/ai/drafts/${draft.id}/approve`, {});
      expect(denied.status).toBe(403);
      expect(denied.body.errors[0].code).toBe('AI_APPROVAL_REQUIRED');
      expect((await post(w.ownerB, `/v1/orgs/${w.B.orgId}/ai/drafts/${draft.id}/approve`, {})).status).toBe(404);
      const ok = await post(w.ownerA, `/v1/orgs/${orgA()}/ai/drafts/${draft.id}/approve`, { reason: 'Looks right' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data).toMatchObject({ status: 'EXECUTED', label: 'SYSTEM_EXECUTED' });
      const created = await t.prisma.campaignTarget.findMany({ where: { organizationId: orgA(), source: 'AI_DRAFT' } });
      expect(created.length).toBeGreaterThanOrEqual(1);
      expect(created[0]!.createdByUserId).toBe(w.ownerA.me.id);
      const states = (await t.prisma.aiAction.findMany({ where: { draftId: draft.id } })).map((a) => a.state);
      expect(states).toEqual(expect.arrayContaining(['HUMAN_APPROVED', 'SYSTEM_EXECUTED']));
      expect(await t.prisma.auditLog.count({ where: { entityId: draft.id, action: { in: ['AI_DRAFT_APPROVED', 'AI_DRAFT_EXECUTED'] } } })).toBe(2);
      expect((await post(w.ownerA, `/v1/orgs/${orgA()}/ai/drafts/${draft.id}/approve`, {})).status).toBe(409);
    });

    it('a campaign plan is a draft only: approving it creates, publishes and commits nothing', async () => {
      const deals = await t.prisma.hotDeal.count({ where: { organizationId: orgA() } });
      const r = await orgAsk(w.ownerA, 'I want a plan to grow redemptions by 20%', { autonomy: 2 });
      const draft = r.body.data.drafts[0];
      expect(draft).toMatchObject({ kind: 'CAMPAIGN_PLAN' });
      expect(draft.payload).toMatchObject({ objectiveIsTarget: true, guaranteed: false, publishes: false, increasesExposure: false, budget: { committedByPlan: 0 } });
      const ok = await post(w.ownerA, `/v1/orgs/${orgA()}/ai/drafts/${draft.id}/approve`, {});
      expect(ok.body.data).toMatchObject({ status: 'APPROVED', label: 'HUMAN_APPROVED' });
      expect(await t.prisma.hotDeal.count({ where: { organizationId: orgA() } })).toBe(deals);
    });
  });

  describe('DealDash copilots', () => {
    it('Operations & Support summarises a customer journey with a human handoff', async () => {
      const r = await ask(w.support, '/v1/admin/ai/ask', { agent: 'OPERATIONS_SUPPORT', message: 'customer complaint about a reservation', context: { customerUserId: customer.me.id }, autonomy: 2 });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.handoff).toEqual({ available: true, reason: null });
      const draft = r.body.data.drafts[0];
      expect(draft.kind).toBe('SUPPORT_HANDOFF');
      // support cannot approve AI drafts; a manager can, and the case is opened for a person
      expect((await post(w.support, `/v1/admin/ai/drafts/${draft.id}/approve`, {})).status).toBe(403);
      const ok = await post(w.superAdmin, `/v1/admin/ai/drafts/${draft.id}/approve`, {});
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(await t.prisma.disputeCase.count({ where: { id: ok.body.data.result.caseId, status: 'OPEN' } })).toBe(1);
    });

    it('Admin / Finance separates fact, trend, forecast, hypothesis and recommendation; others cannot use its tools', async () => {
      const r = await ask(fin, '/v1/admin/ai/ask', { agent: 'ADMIN_FINANCE', message: 'how are receivables?' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const kinds = new Set(r.body.data.statements.map((s: { kind: string }) => s.kind));
      for (const k of ['OBSERVED_FACT', 'CALCULATED_TREND', 'FORECAST']) expect(kinds.has(k)).toBe(true);
      expect(r.body.data.statements.find((s: { kind: string }) => s.kind === 'FORECAST').text).toMatch(/estimate/i);
      const denied = await ask(w.support, '/v1/admin/ai/ask', { agent: 'ADMIN_FINANCE', message: 'receivables' });
      expect(denied.status).toBe(403);
      expect(denied.body.errors[0].code).toBe('AI_TOOL_DENIED');
      expect((await ask(w.analyst, '/v1/admin/ai/ask', { agent: 'ADMIN_FINANCE', message: 'receivables' })).status).toBe(403);
    });

    it('the evaluation pack passes every case', async () => {
      const r = await post(w.superAdmin, '/v1/admin/ai/evaluations');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.results.map((x: { case: string }) => x.case).sort()).toEqual([...AI_EVAL_CASES].sort());
      expect(r.body.data.results.filter((x: { passed: boolean }) => !x.passed)).toEqual([]);
    });

    it('audit and usage are append-only and visible to DealDash; AI is not priced', async () => {
      const row = await t.prisma.aiInteraction.findFirstOrThrow({ where: { userId: customer.me.id } });
      await expect(t.prisma.aiInteraction.update({ where: { id: row.id }, data: { status: 'ERROR' } })).rejects.toThrow();
      await expect(t.prisma.aiInteraction.delete({ where: { id: row.id } })).rejects.toThrow();
      const u = await w.api(w.superAdmin).get(`/v1/admin/ai/usage?organizationId=${orgA()}`);
      expect(u.status).toBe(200);
      expect(u.body.data).toMatchObject({ commercialTreatment: 'INCLUDED_FEATURE', pricing: 'NOT_PRICED' });
      expect(u.body.data.rows.find((x: { agent: string; kind: string }) => x.agent === 'MERCHANT_GROWTH' && x.kind === 'ACTION').units).toBeGreaterThanOrEqual(1);
      const detail = await w.api(w.superAdmin).get(`/v1/admin/ai/interactions/${row.id}`);
      expect(detail.status).toBe(200);
      expect((await w.api(w.support).get('/v1/admin/ai/interactions')).status).toBe(403);
    });
  });
});
