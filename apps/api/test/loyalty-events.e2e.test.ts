import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, type TestApp } from './helpers';
import { LoyaltyIssuanceService } from '../src/loyalty/loyalty-issuance.service';
import { buildWatchWorld } from './watch-fixtures';

/**
 * Loyalty points follow VERIFIED product events end to end, through the real flows: a qualified Watch & Earn view, an Exclusive
 * Deal redemption, a settled voucher purchase and a voucher redemption; and they come back when the event is reversed
 * (redemption reversal, voucher refund).
 */
describe.skipIf(!DB_READY)('Loyalty events through the real product flows', () => {
  let t: TestApp;
  let w: Awaited<ReturnType<typeof buildWatchWorld>>;

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWatchWorld(t);
  });
  afterAll(() => t?.close());

  const rule = (eventType: string, productScope: string, campaignId: string, extra: Record<string, unknown> = {}) =>
    t.prisma.loyaltyRule.create({
      data: {
        name: `${eventType} test ${campaignId.slice(0, 6)}`,
        eventType,
        kind: 'BASE',
        productScope,
        campaignId,
        basePoints: 0,
        maxAllocationPoints: 100_000,
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 3_600_000),
        createdByUserId: w.superAdmin.me.id as string,
        ...extra,
      },
    });
  const entries = (ruleId: string, userId: string) =>
    t.prisma.rewardEntry.findMany({ where: { ruleId, account: { userId } }, orderBy: { createdAt: 'asc' } });
  const balance = async (userId: string) => (await t.prisma.rewardAccount.findUnique({ where: { userId } }))?.availableBalance ?? 0;

  it('Exclusive Deal: a verified redemption earns points; reversing the redemption takes them back', async () => {
    const deal = await w.publishHot('A', 5, {});
    const r = await rule('EXCLUSIVE_REDEMPTION', 'EXCLUSIVE', deal.id, { basePoints: 7 });
    const c = await w.newCustomer();
    const uid = w.userIdOf(c);
    const held = (await w.reserve(c, deal.id, w.A.branchIds[0]!)).body.data;
    expect(await entries(r.id, uid)).toHaveLength(0); // a reservation is not an event that earns
    expect((await w.redeem(w.staffA, held.code.qr as string)).body.data.result).toBe('REDEEMED');
    const earned = await entries(r.id, uid);
    expect(earned).toHaveLength(1);
    expect(earned[0]).toMatchObject({ type: 'EARN', points: 7, sourceProduct: 'EXCLUSIVE', sourceCampaignId: deal.id, fundingSource: 'DEALDASH', sourceType: 'REDEMPTION' });
    expect(await balance(uid)).toBe(7);
    const red = await t.prisma.redemption.findFirstOrThrow({ where: { dealId: deal.id } });
    const rev = await w.api(w.ownerA).post(`/v1/merchants/${w.A.orgId}/redemptions/${red.id}/reverse`).send({ reason: 'Customer left before use' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    const after = await entries(r.id, uid);
    expect(after.map((e) => [e.type, e.points])).toEqual([['EARN', 7], ['REVERSE', -7]]);
    expect(await balance(uid)).toBe(0);
    expect((await t.prisma.loyaltyRule.findUniqueOrThrow({ where: { id: r.id } })).reversedPoints).toBe(7);
  });

  it('Voucher: a settled purchase earns on the amount paid; a refund takes the points back exactly once', async () => {
    const v = await w.publishVoucher('A', { totalQty: 20, perCustomerLimit: 5 });
    const r = await rule('VOUCHER_PURCHASE', 'VOUCHER', v.id, { pointsPer100Halalas: 1 });
    const c = await w.newCustomer();
    const uid = w.userIdOf(c);
    // a FAILED payment is not a purchase
    await w.buy(c, v.id, 'FAILED');
    expect(await entries(r.id, uid)).toHaveLength(0);
    const b = await w.buy(c, v.id);
    const earned = await entries(r.id, uid);
    expect(earned).toHaveLength(1);
    expect(earned[0]).toMatchObject({ type: 'EARN', points: 80, sourceProduct: 'VOUCHER', sourceType: 'EVENT' }); // SAR 80 = 8000 halalas, 1 point per SAR 1
    expect(await balance(uid)).toBe(80);
    const refund = await w.requestRefund(c, b.instanceId!);
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    const after = await entries(r.id, uid);
    expect(after.map((e) => [e.type, e.points])).toEqual([['EARN', 80], ['REVERSE', -80]]);
    expect(after[1]).toMatchObject({ reasonCode: 'PURCHASE_REFUNDED' });
    expect(await balance(uid)).toBe(0);
  });

  it('Voucher: a verified redemption earns points', async () => {
    const v = await w.publishVoucher('A', { totalQty: 20, perCustomerLimit: 5 });
    const r = await rule('VOUCHER_REDEMPTION', 'VOUCHER', v.id, { basePoints: 5 });
    const c = await w.newCustomer();
    const uid = w.userIdOf(c);
    const o = await w.owned(c, v.id);
    expect(await entries(r.id, uid)).toHaveLength(0); // owning is not using
    expect((await w.redeem(w.staffA, o.qr)).body.data.result).toBe('REDEEMED');
    const earned = await entries(r.id, uid);
    expect(earned).toHaveLength(1);
    expect(earned[0]).toMatchObject({ points: 5, sourceProduct: 'VOUCHER', sourceCampaignId: v.id });
    expect(await balance(uid)).toBe(5);
    // the same redemption never pays twice
    expect((await w.redeem(w.staffA, o.qr)).body.data.result).not.toBe('REDEEMED');
    expect(await entries(r.id, uid)).toHaveLength(1);
  });

  it('Watch & Earn: a QUALIFIED view earns loyalty points next to the view reward; an abandoned view earns none', async () => {
    const live = await w.publishWatch('A');
    const r = await rule('QUALIFIED_VIEW', 'WATCH', live.id, { basePoints: 3 });
    const c = await w.newCustomer();
    const uid = w.userIdOf(c);
    const { outcome } = await w.playView(c, live.id);
    expect(outcome.outcome).toBe('QUALIFIED');
    const earned = await entries(r.id, uid);
    expect(earned).toHaveLength(1);
    expect(earned[0]).toMatchObject({ type: 'EARN', points: 3, sourceProduct: 'WATCH', sourceCampaignId: live.id, sourceType: 'EVENT' });
    const view = await t.prisma.watchView.findFirstOrThrow({ where: { userId: uid, campaignId: live.id } });
    // not recorded as the view's own reward source: the Watch & Earn credit keeps that, one per view\n    expect(earned[0]!.sourceId).toBe(`view:${view.id}`);\n    expect(await t.prisma.rewardEntry.count({ where: { sourceType: 'VIEW', sourceId: view.id, type: 'EARN' } })).toBeLessThanOrEqual(1);
    // the view reward itself is untouched and separate
    expect(await t.prisma.rewardEntry.count({ where: { account: { userId: uid }, ruleId: null } })).toBeGreaterThan(0);
    // a fraud verdict on the view takes the loyalty points back with the view reward (same key the risk review uses)
    const back = await t.prisma.$transaction((tx) => t.app.get(LoyaltyIssuanceService).reverseForSource(tx, { sourceType: 'EVENT', sourceId: `view:${view.id}`, reason: 'FRAUD_REVIEW' }));
    expect(back).toBeGreaterThanOrEqual(3); // other test files may have active platform-wide rules on the same shared database
    expect((await entries(r.id, uid)).map((e) => e.type)).toEqual(['EARN', 'REVERSE']);
    // ledger consistency: cached balance equals the sum of available entries
    const sum = await t.prisma.rewardEntry.aggregate({ _sum: { points: true }, where: { account: { userId: uid }, bucket: 'AVAILABLE' } });
    expect(await balance(uid)).toBe(sum._sum.points ?? 0);
  });

  it('a campaign-scoped rule never pays for another campaign, and a paused rule pays nothing', async () => {
    const dealA = await w.publishHot('A', 5, {});
    const dealB = await w.publishHot('A', 5, {});
    const rA = await rule('EXCLUSIVE_REDEMPTION', 'EXCLUSIVE', dealA.id, { basePoints: 4 });
    const c = await w.newCustomer();
    const uid = w.userIdOf(c);
    const heldB = (await w.reserve(c, dealB.id, w.A.branchIds[0]!)).body.data;
    await w.redeem(w.staffA, heldB.code.qr as string);
    expect(await entries(rA.id, uid)).toHaveLength(0);
    await t.prisma.loyaltyRule.update({ where: { id: rA.id }, data: { status: 'PAUSED' } });
    const heldA = (await w.reserve(c, dealA.id, w.A.branchIds[0]!)).body.data;
    await w.redeem(w.staffA, heldA.code.qr as string);
    expect(await entries(rA.id, uid)).toHaveLength(0);
  });
});
