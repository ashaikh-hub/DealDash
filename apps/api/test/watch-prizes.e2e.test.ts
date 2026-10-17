import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRIZE_QR_PREFIX } from '@dealdash/types';
import { NotificationsService } from '../src/hot-deals/notifications.service';
import { WatchPrizeService } from '../src/watch/watch-prize.service';
import { DB_READY, createStaffUser, createTestApp, otpSession, type TestApp } from './helpers';
import { buildWatchWorld, type WatchWorld } from './watch-fixtures';

/**
 * Watch & Earn INSTANT PRIZES (FDR-19 decided 2026-10-16: instant probabilistic allocation) through the real qualification pipeline:
 * points always, then a server-side draw (probability, per-customer limit, stock, risk), atomic inventory, one decision per view,
 * audit, the customer's card / outcome / prizes, staff redemption of prize codes, merchant monitor; and Watch & Earn favourites.
 */
describe.skipIf(!DB_READY)('Watch & Earn instant prizes', () => {
  let t: TestApp;
  let w: WatchWorld;
  let prizes: WatchPrizeService;
  const restores: Array<() => Promise<void>> = [];
  const startedAt = new Date();
  const realRandom = () => prizes.random;

  const prize = (over: Record<string, unknown> = {}) => ({
    title: { en: 'Free dessert', ar: 'حلى مجاني' },
    kind: 'FREE_ITEM',
    inventory: 2,
    winProbabilityBps: 10_000,
    perCustomerLimit: 1,
    validityDays: 7,
    branchIds: [],
    unitValueMinor: 1_500,
    acknowledged: true,
    ...over,
  });
  const draws = (campaignId: string) =>
    t.prisma.watchPrizeDraw.findMany({ where: { campaignId }, orderBy: { createdAt: 'asc' } });
  const campaign = (id: string) => t.prisma.watchCampaign.findUniqueOrThrow({ where: { id } });
  const hubCard = async (s: Parameters<WatchWorld['api']>[0], id: string) =>
    (
      (await w.api(s).get('/v1/app/watch').query({ city: 'Riyadh' })).body.data.campaigns as Array<{
        id: string;
        instantPrize?: unknown;
        saved?: boolean;
        rewardPoints: number;
      }>
    ).find((c) => c.id === id);

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWatchWorld(t);
    prizes = t.app.get(WatchPrizeService);
    // DealDash guardrails for these tests: guaranteed prizes allowed (development mock defaults cap at 50 %)
    restores.push(
      await w.setConfig('watch.prize_guardrails', {
        enabled: true,
        maxWinProbabilityBps: 10_000,
        maxInventory: 1_000,
        maxPerCustomer: 3,
        maxValidityDays: 60,
        maxLiabilityMinor: 10_000_000,
      }),
    );
  });
  afterAll(async () => {
    for (const r of restores.reverse()) await r().catch(() => undefined);
    // the campaigns this file published leave customer discovery (other files share the test database and its hub)
    if (t)
      await t.prisma.watchCampaign
        .updateMany({
          where: { titleEn: { not: '' }, createdAt: { gte: startedAt } },
          data: { status: 'EXPIRED', endedAt: new Date() },
        })
        .catch(() => undefined);
    await t?.close();
  });

  it('the card shows the opportunity from the configuration; a winner gets one prize with a code, stock is taken atomically, points are unchanged', async () => {
    const live = await w.publishWatch('A', { prize: prize() });
    const a = await w.newCustomer();
    // the card: "guaranteed" only because every qualified view wins (10000 bps), with the real stock left
    expect((await hubCard(a, live.id))?.instantPrize).toEqual({
      title: { en: 'Free dessert', ar: 'حلى مجاني' },
      kind: 'FREE_ITEM',
      remaining: 2,
      guaranteed: true,
    });
    const { outcome, started } = await w.playView(a, live.id);
    expect(outcome).toMatchObject({
      outcome: 'QUALIFIED',
      reward: { points: 10, status: 'EARNED' },
      prize: { won: true, prize: { status: 'ISSUED', title: { en: 'Free dessert' } } },
    });
    expect(outcome.prize!.prize!.code!.qr.startsWith(PRIZE_QR_PREFIX)).toBe(true);
    expect(outcome.prize!.prize!.code!.manual).toMatch(/^[A-Z0-9]{8}$/);
    expect((await campaign(live.id)).prizesAwarded).toBe(1);
    const [d] = await draws(live.id);
    expect(d).toMatchObject({
      viewId: started.viewId,
      eligible: true,
      won: true,
      probabilityBps: 10_000,
      inventoryBefore: 2,
      inventoryAfter: 1,
      status: 'ISSUED',
    });
    expect(d!.roll).toBeGreaterThanOrEqual(0);
    // every decision is audited with the inventory before / after
    const audit = await t.prisma.auditLog.findFirst({
      where: { entityType: 'WatchPrizeDraw', entityId: d!.id, action: 'watch.prize_awarded' },
    });
    expect(audit?.newState).toMatchObject({ inventoryBefore: 2, inventoryAfter: 1, won: true });
    // the customer's prizes list keeps it with its code
    const mine = (await w.api(a).get('/v1/app/watch/prizes')).body.data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: 'ISSUED', reference: d!.reference });
    expect((await hubCard(a, live.id))?.instantPrize).toMatchObject({ remaining: 1 });
  });

  it('never oversold: once the stock is gone no prize is awarded, the viewer still earns the points, and the card stops offering it', async () => {
    const live = await w.publishWatch('A', { prize: prize({ inventory: 1 }) });
    const first = await w.newCustomer();
    expect((await w.playView(first, live.id)).outcome.prize).toMatchObject({ won: true });
    const second = await w.newCustomer();
    const { outcome } = await w.playView(second, live.id);
    expect(outcome).toMatchObject({
      outcome: 'QUALIFIED',
      reward: { points: 10, status: 'EARNED' },
      prize: { won: false, prize: null },
    });
    const ds = await draws(live.id);
    expect(ds.map((x) => [x.won, x.ineligibleReason, x.inventoryBefore, x.inventoryAfter])).toEqual(
      [
        [true, null, 1, 0],
        [false, 'OUT_OF_STOCK', 0, 0],
      ],
    );
    expect((await campaign(live.id)).prizesAwarded).toBe(1);
    expect((await hubCard(second, live.id))?.instantPrize ?? null).toBeNull();
  });

  it('probability decides: a losing roll gives no prize (eligible, recorded), a winning roll gives one; never above the guardrail', async () => {
    const live = await w.publishWatch('A', {
      prize: prize({ winProbabilityBps: 2_500, inventory: 5 }),
    });
    const original = realRandom();
    try {
      prizes.random = () => 2_500; // not below 2500: loses
      const loser = await w.newCustomer();
      expect((await w.playView(loser, live.id)).outcome.prize).toEqual({ won: false, prize: null });
      prizes.random = () => 2_499; // below 2500: wins
      const winner = await w.newCustomer();
      expect((await w.playView(winner, live.id)).outcome.prize).toMatchObject({ won: true });
    } finally {
      prizes.random = original;
    }
    const ds = await draws(live.id);
    expect(ds.map((x) => [x.eligible, x.roll, x.won, x.probabilityBps])).toEqual([
      [true, 2_500, false, 2_500],
      [true, 2_499, true, 2_500],
    ]);
    // the card never implies a guaranteed prize below 100 %
    expect((await hubCard(await w.newCustomer(), live.id))?.instantPrize).toMatchObject({
      guaranteed: false,
      remaining: 4,
    });
  });

  it('a repeated completion (duplicate callback) never creates a second decision or prize', async () => {
    const live = await w.publishWatch('A', { prize: prize() });
    const c = await w.newCustomer();
    const { started } = await w.playView(c, live.id);
    const again = await w.qual.complete(
      w.userIdOf(c),
      started.viewId,
      started.viewToken,
      8,
      new Date(Date.now() + 60_000),
    );
    expect(again.prize).toMatchObject({ won: true });
    expect(await draws(live.id)).toHaveLength(1);
    expect((await campaign(live.id)).prizesAwarded).toBe(1);
  });

  it('the winner gets ONE in-app notification (shared engine) linking to the prize; a non-winner gets none; nothing internal is exposed', async () => {
    const live = await w.publishWatch('A', {
      prize: prize({ winProbabilityBps: 5_000, inventory: 5 }),
    });
    const original = realRandom();
    let winner!: Parameters<WatchWorld['api']>[0];
    let loser!: Parameters<WatchWorld['api']>[0];
    let started!: { viewId: string; viewToken: string };
    try {
      prizes.random = () => 9_999; // loses
      loser = await w.newCustomer();
      expect((await w.playView(loser, live.id)).outcome.prize).toEqual({ won: false, prize: null });
      prizes.random = () => 0; // wins
      winner = await w.newCustomer();
      const played = await w.playView(winner, live.id);
      started = played.started;
      expect(played.outcome.prize).toMatchObject({ won: true });
    } finally {
      prizes.random = original;
    }
    const prizeWon = (s: Parameters<WatchWorld['api']>[0]) =>
      t.prisma.notification.findMany({ where: { userId: w.userIdOf(s), type: 'PRIZE_WON' } });
    // the non-winner: points notification only, never a prize notification
    expect(await prizeWon(loser)).toHaveLength(0);
    const [n] = await prizeWon(winner);
    const [d] = (await draws(live.id)).filter((x) => x.won);
    expect(n!.dedupeKey).toBe(`prize-won:${d!.id}`);
    expect(n!.data).toMatchObject({
      prizeId: d!.id,
      campaignId: live.id,
      dealTitleEn: 'Free dessert',
      dealTitleAr: 'حلى مجاني',
      expiresAt: d!.expiresAt!.toISOString(),
    });
    expect(String((n!.data as Record<string, unknown>).merchantNameEn).length).toBeGreaterThan(0);
    // no allocation internals and no redemption credential in the notification
    const raw = JSON.stringify(n!.data);
    for (const secret of ['probability', 'roll', 'inventory', 'Bps', d!.manualCode!, d!.qrToken!])
      expect(raw).not.toContain(secret);
    // a repeated completion (duplicate callback) does not create a second notification
    await w.qual.complete(
      w.userIdOf(winner),
      started.viewId,
      started.viewToken,
      8,
      new Date(Date.now() + 60_000),
    );
    expect(await prizeWon(winner)).toHaveLength(1);
    // re-emitting the same decision through the shared engine is a no-op (unique per user + dedupe key)
    const again = await t.prisma.$transaction(async (tx) => {
      const notice = await prizes.winnerNotice(tx, d!, { titleEn: 'x', titleAr: 'x' });
      return t.app.get(NotificationsService).emit(tx, [notice!]);
    });
    expect(again).toHaveLength(0);
    expect(await prizeWon(winner)).toHaveLength(1);
    // the customer's inbox returns it, and it opens the prize (with its code) under Rewards
    const inbox = (await w.api(winner).get('/v1/app/notifications')).body.data;
    expect(inbox.items.find((i: { type: string }) => i.type === 'PRIZE_WON')).toMatchObject({
      data: { prizeId: d!.id },
    });
    const one = (await w.api(winner).get(`/v1/app/watch/prizes/${d!.id}`)).body.data;
    expect(one).toMatchObject({ id: d!.id, status: 'ISSUED', reference: d!.reference });
    expect(one.code.manual).toBe(d!.manualCode);
    // another customer cannot open it
    expect((await w.api(loser).get(`/v1/app/watch/prizes/${d!.id}`)).status).toBe(404);
    // push stays behind the provider abstraction (development mock; no real provider): the same event is tracked per channel
    let channels: string[] = [];
    for (let i = 0; i < 20 && channels.length < 2; i++) {
      channels = (
        await t.prisma.notificationDelivery.findMany({ where: { notificationId: n!.id } })
      ).map((x) => `${x.channel}:${x.provider}`);
      if (channels.length < 2) await new Promise((r) => setTimeout(r, 100));
    }
    expect(channels.sort()).toEqual(['IN_APP:in-app', 'PUSH:mock-push']);
  });

  it('per-customer limit, risk review and disabled guardrails make a view ineligible (recorded, no roll, points unaffected)', async () => {
    // a second qualified view by the same customer (the platform allows two in the window for this test)
    restores.push(await w.setConfig('watch.frequency', { maxQualifiedPerCustomerPerCampaign: 2 }));
    const live = await w.publishWatch('A', {
      prize: prize({ inventory: 10, perCustomerLimit: 1 }),
    });
    const c = await w.newCustomer();
    expect((await w.playView(c, live.id)).outcome.prize).toMatchObject({ won: true });
    const second = await w.playView(c, live.id);
    expect(second.outcome).toMatchObject({ outcome: 'QUALIFIED', prize: { won: false } });
    const ds = await draws(live.id);
    expect(ds[1]).toMatchObject({
      eligible: false,
      ineligibleReason: 'CUSTOMER_LIMIT',
      roll: null,
    });

    // risk review and guardrails, decided directly for fresh views (the same code the pipeline calls)
    const content = (await t.prisma.watchCampaign.findUniqueOrThrow({ where: { id: live.id } }))
      .content as never;
    const other = await w.newCustomer();
    const v1 = await w.qual.start(w.userIdOf(other), {
      campaignId: live.id,
      deviceId: w.newDevice(),
    });
    const v2 = await w.qual
      .start(w.userIdOf(other), { campaignId: live.id, deviceId: w.newDevice() })
      .catch(() => null);
    const row = await campaign(live.id);
    const held = await t.prisma.$transaction((tx) =>
      prizes.draw(tx, {
        campaign: row,
        content: { ...(content as object), prize: prize({ inventory: 10 }) } as never,
        viewId: v1.viewId,
        userId: w.userIdOf(other),
        held: true,
        guardrails: {
          enabled: true,
          maxWinProbabilityBps: 10_000,
          maxInventory: 1_000,
          maxPerCustomer: 3,
          maxValidityDays: 60,
          maxLiabilityMinor: 10_000_000,
        },
        now: new Date(),
      }),
    );
    expect(held).toMatchObject({
      eligible: false,
      ineligibleReason: 'RISK_REVIEW',
      won: false,
      roll: null,
    });
    if (v2) {
      const off = await t.prisma.$transaction((tx) =>
        prizes.draw(tx, {
          campaign: row,
          content: { ...(content as object), prize: prize({ inventory: 10 }) } as never,
          viewId: v2.viewId,
          userId: w.userIdOf(other),
          held: false,
          guardrails: {
            enabled: false,
            maxWinProbabilityBps: 10_000,
            maxInventory: 1_000,
            maxPerCustomer: 3,
            maxValidityDays: 60,
            maxLiabilityMinor: 10_000_000,
          },
          now: new Date(),
        }),
      );
      expect(off).toMatchObject({ eligible: false, ineligibleReason: 'GUARDRAILS_DISABLED' });
    }
    expect((await campaign(live.id)).prizesAwarded).toBe(1);
  });

  it('staff redeem a prize once, at the right branch, before it expires (same staff flow as reservations and vouchers)', async () => {
    const live = await w.publishWatch('A', { prize: prize({ branchIds: [w.A.branchIds[0]] }) });
    const c = await w.newCustomer();
    const won = (await w.playView(c, live.id)).outcome.prize!.prize!;
    const qr = won.code!.qr;
    // a staff member of the merchant's other branch is told where it is valid
    const otherStaffUser = await createStaffUser(t.prisma, w.A.orgId, w.A.branchIds[1]!);
    const otherStaff = await otpSession(t, otherStaffUser.mobile!, 'staff');
    expect(
      (
        await w
          .api(otherStaff)
          .post('/v1/staff/redemptions/validate')
          .send({ code: qr, source: 'QR' })
      ).body.data.result,
    ).toBe('WRONG_BRANCH');
    // the right branch: VALID (kind PRIZE), then REDEEMED once, then ALREADY_REDEEMED
    const v = await w
      .api(w.staffA)
      .post('/v1/staff/redemptions/validate')
      .send({ code: qr, source: 'QR' });
    expect(v.body.data).toMatchObject({
      result: 'VALID',
      reservation: { kind: 'PRIZE', dealTitle: { en: 'Free dessert' }, quantity: 1 },
    });
    const r1 = await w
      .api(w.staffA)
      .post('/v1/staff/redemptions')
      .set('Idempotency-Key', `prize-${Date.now()}`)
      .send({ code: won.code!.manual, source: 'MANUAL' });
    expect(r1.body.data.result).toBe('REDEEMED');
    const r2 = await w
      .api(w.staffA)
      .post('/v1/staff/redemptions')
      .set('Idempotency-Key', `prize-${Date.now()}-2`)
      .send({ code: qr, source: 'QR' });
    expect(r2.body.data.result).toBe('ALREADY_REDEEMED');
    const mine = (await w.api(c).get('/v1/app/watch/prizes')).body.data;
    expect(mine[0]).toMatchObject({ status: 'REDEEMED', code: null });
    // an expired prize cannot be redeemed
    const live2 = await w.publishWatch('A', { prize: prize() });
    const c2 = await w.newCustomer();
    const won2 = (await w.playView(c2, live2.id)).outcome.prize!.prize!;
    await t.prisma.watchPrizeDraw.update({
      where: { id: won2.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (
        await w
          .api(w.staffA)
          .post('/v1/staff/redemptions/validate')
          .send({ code: won2.code!.qr, source: 'QR' })
      ).body.data.result,
    ).toBe('EXPIRED');
    // the merchant monitor counts every outcome
    const mon = (await w.api(w.ownerA).get(`${w.wbase('A')}/watch/${live.id}/monitor`)).body.data;
    expect(mon.prizes).toMatchObject({
      inventory: 2,
      awarded: 1,
      remaining: 1,
      redeemed: 1,
      issued: 0,
    });
  });

  it('the merchant cannot exceed DealDash guardrails or submit without the commercial acknowledgement', async () => {
    const restore = await w.setConfig('watch.prize_guardrails', { maxWinProbabilityBps: 2_000 });
    try {
      const v = await w.createWatch(
        'A',
        w.watchContent('A', { prize: prize({ acknowledged: false }) }),
      );
      const view = (await w.api(w.ownerA).get(`${w.wbase('A')}/watch/${v.id}`)).body.data;
      const codes = (view.issues as Array<{ field: string; code: string }>).map(
        (i) => `${i.field}:${i.code}`,
      );
      expect(codes).toEqual(
        expect.arrayContaining([
          'prize.winProbabilityBps:PRIZE_ABOVE_GUARDRAIL',
          'prize.acknowledged:ACKNOWLEDGEMENT_REQUIRED',
        ]),
      );
    } finally {
      await restore();
    }
  });

  it('favourites: a customer saves a Watch & Earn campaign, sees it saved and in the saved list, and can remove it', async () => {
    const live = await w.publishWatch('A');
    const c = await w.newCustomer();
    expect((await hubCard(c, live.id))?.saved).toBe(false);
    expect((await w.api(c).post(`/v1/app/saved/watch/${live.id}`).send({})).body.data).toEqual({
      saved: true,
    });
    expect((await hubCard(c, live.id))?.saved).toBe(true);
    const saved = (await w.api(c).get('/v1/app/saved/watch').query({ city: 'Riyadh' })).body.data;
    expect(saved.map((s: { id: string }) => s.id)).toContain(live.id);
    expect((await w.api(c).delete(`/v1/app/saved/watch/${live.id}`)).body.data).toEqual({
      saved: false,
    });
    expect((await hubCard(c, live.id))?.saved).toBe(false);
  });
});
