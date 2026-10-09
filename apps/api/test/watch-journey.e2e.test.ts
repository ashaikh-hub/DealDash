import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, type TestApp } from './helpers';
import { buildWatchWorld, type WatchWorld } from './watch-fixtures';

/**
 * The whole Stage 6 journey, in one test: merchant builds and funds a campaign, DealDash approves it, customers watch and
 * qualify, the budget reduces safely, rewards reach the wallet, the merchant sees analytics and DealDash sees the activity.
 */
describe.skipIf(!DB_READY)('Stage 6 journey: Watch & Earn from campaign to reward', () => {
  let t: TestApp;
  let w: WatchWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWatchWorld(t);
  });
  afterAll(() => t?.close());

  it('merchant → fund → submit → admin approve → customer watch/qualify → budget reduced → reward → wallet → merchant analytics → admin activity', async () => {
    // 1. merchant creates the campaign (no reward field) and funds it
    const draft = await w.createWatch('A', w.watchContent('A', { paidViews: 12 }));
    expect(draft.budget).toMatchObject({ requiredHalalas: 1200, fundedHalalas: 0 });
    expect(
      (await w.fundWatch(w.financeA, 'A', draft.id, 1200)).body.data.budget.fundingRequired,
    ).toBe(false);

    // 2. submit → admin queue → approve
    expect((await w.submitWatch('A', draft.id)).body.data.outcome).toBe('SENT_FOR_REVIEW');
    const queue = await w.api(w.ops).get('/v1/admin/watch?queue=true');
    expect(queue.body.data.map((r: { id: string }) => r.id)).toContain(draft.id);
    const detail = await w.api(w.ops).get(`/v1/admin/watch/${draft.id}`);
    expect(detail.body.data.economics).toMatchObject({
      estimatedCostHalalas: 1200,
      rewardPoints: 10,
      stillWatchingMode: 'RANDOM',
      customerDailyCap: 10,
    });
    expect(detail.body.data.adminActions).toEqual(['approve', 'request_changes', 'reject']);
    const approved = await w.decideWatch(w.ops, draft.id, 'approve');
    expect(approved.body.data.status).toBe('LIVE');

    // 3. customers discover and watch
    const ana = await w.newCustomer();
    const omar = await w.newCustomer();
    const hub = await w.api(ana).get('/v1/app/watch');
    expect(hub.body.data.campaigns.find((c: { id: string }) => c.id === draft.id)).toMatchObject({
      availability: 'AVAILABLE',
      rewardPoints: 10,
    });
    expect((await w.playView(ana, draft.id)).outcome.outcome).toBe('QUALIFIED');
    expect((await w.playView(omar, draft.id)).outcome.outcome).toBe('QUALIFIED');
    expect(
      (await w.playView(await w.newCustomer(), draft.id, { skip: true })).outcome.outcome,
    ).toBe('NOT_QUALIFIED');

    // 4. budget reduced safely; a repeat is refused; an exhausted campaign is not offered
    const camp = await t.prisma.watchCampaign.findUniqueOrThrow({ where: { id: draft.id } });
    expect(camp).toMatchObject({ qualifiedViews: 2, spentHalalas: 200, fundedHalalas: 1200 });

    // 5. rewards reach the wallet
    expect(await w.balanceOf(ana)).toEqual({ available: 10, held: 0 });
    const wallet = await w.api(ana).get('/v1/app/rewards');
    expect(wallet.body.data).toMatchObject({
      availableBalance: 10,
      lifetimeEarned: 10,
      cashValueShown: false,
    });

    // 6. merchant analytics (verified numbers only)
    const mon = await w.api(w.ownerA).get(`${w.wbase('A')}/watch/${draft.id}/monitor`);
    expect(mon.body.data).toMatchObject({
      delivery: { qualifiedViews: 2, remainingViews: 10 },
      budget: { spentHalalas: 200, remainingHalalas: 1000 },
      rewards: { rewardedViews: 2, pointsIssued: 20, heldViews: 0 },
    });
    expect(mon.body.data.reach.uniqueViewers).toBe(3);
    const summary = await w.api(w.ownerA).get(`${w.wbase('A')}/watch/summary`);
    expect(summary.body.data.money).toMatchObject({ spentHalalas: 200, qualifiedViews: 2 });

    // 7. DealDash sees the activity and the money
    const ov = await w.api(w.finance).get('/v1/admin/watch/overview');
    expect(ov.body.data.counts.live).toBeGreaterThanOrEqual(1);
    expect(ov.body.data.counts.qualified24h).toBeGreaterThanOrEqual(2);
    expect(ov.body.data.campaigns.find((c: { id: string }) => c.id === draft.id)).toMatchObject({
      qualifiedViews: 2,
      budgetPct: 16.7,
    });
    const budget = await w.api(w.finance).get(`/v1/admin/watch/${draft.id}/budget`);
    expect(budget.body.data.budget).toMatchObject({ spentHalalas: 200, remainingHalalas: 1000 });
    const trail = await w.api(w.ops).get(`/v1/admin/watch/${draft.id}/audit`);
    expect(trail.body.data.map((a: { action: string }) => a.action)).toEqual(
      expect.arrayContaining(['watch.create', 'watch.fund', 'watch.submit', 'watch.approve']),
    );
  });
});
