import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { buildWatchWorld, type WatchWorld } from './watch-fixtures';

/** Stage 6 pipeline: qualifying views, duplicate / cap / budget safety, the reward ledger, fraud screening, redemption. */
describe.skipIf(!DB_READY)('Watch & Earn views and rewards', () => {
  let t: TestApp;
  let w: WatchWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWatchWorld(t);
  });
  afterAll(() => t?.close());

  const entries = async (userId: string) =>
    t.prisma.rewardEntry.findMany({
      where: { account: { userId } },
      orderBy: { createdAt: 'asc' },
    });
  const campaignRow = (id: string) => t.prisma.watchCampaign.findUniqueOrThrow({ where: { id } });
  const reconcile = async () => {
    const r = await t.app
      .get((await import('../src/watch/rewards-admin.service')).RewardsAdminService)
      .reconcile();
    expect(r.mismatches).toBe(0);
  };
  const trial = async () => {
    const r = await t.prisma.$queryRaw<Array<{ bad: bigint }>>`SELECT count(*)::bigint AS bad FROM (
      SELECT j."id" FROM "LedgerJournal" j JOIN "LedgerEntry" e ON e."journalId" = j."id" GROUP BY j."id" HAVING sum(e."amountHalalas") <> 0) q`;
    expect(Number(r[0]!.bad)).toBe(0);
  };

  // ------------------------------------------------------------------ the happy path
  it('a completed view qualifies: the budget is charged once, the reward is earned once, the customer is notified', async () => {
    const live = await w.publishWatch('A');
    const c = await w.newCustomer();
    const { outcome, started } = await w.playView(c, live.id);
    expect(outcome).toMatchObject({
      outcome: 'QUALIFIED',
      state: 'QUALIFIED',
      reward: { points: 10, status: 'EARNED' },
      balance: { availableBalance: 10, heldBalance: 0 },
      link: { type: 'MERCHANT', id: null },
    });
    const camp = await campaignRow(live.id);
    expect(camp).toMatchObject({ qualifiedViews: 1, spentHalalas: 100, fundedHalalas: 1000 });
    const es = await entries(w.userIdOf(c));
    expect(es.map((e) => [e.type, e.bucket, e.points])).toEqual([['EARN', 'AVAILABLE', 10]]);
    expect(es[0]).toMatchObject({
      sourceType: 'VIEW',
      sourceId: started.viewId,
      availableAfter: 10,
      heldAfter: 0,
    });
    // the merchant charge is a balanced ledger journal
    const j = await t.prisma.ledgerJournal.findFirst({
      where: { sourceType: 'WatchView', sourceId: started.viewId, type: 'CAMPAIGN_CONSUMPTION' },
      include: { entries: { include: { account: true } } },
    });
    expect(j?.entries.reduce((n, e) => n + e.amountHalalas, 0)).toBe(0);
    expect(j?.entries.map((e) => e.account.family).sort()).toEqual([
      'CAMPAIGN_BUDGET',
      'PLATFORM_REVENUE',
    ]);
    // a notification (reward earned) with the dedupe key
    const n = await t.prisma.notification.findMany({
      where: { userId: w.userIdOf(c), type: 'REWARD_EARNED' },
    });
    expect(n).toHaveLength(1);
    await reconcile();
    await trial();
  });

  it('a simple START never earns anything; neither does a view abandoned halfway', async () => {
    const live = await w.publishWatch('A');
    const c = await w.newCustomer();
    const s = await w.qual.start(w.userIdOf(c), { campaignId: live.id, deviceId: w.newDevice() });
    expect(s.playbackUrl).toContain('/v1/storage/download/');
    expect((await campaignRow(live.id)).spentHalalas).toBe(0);
    expect(await entries(w.userIdOf(c))).toHaveLength(0);
    // the sweep closes the abandoned session; still nothing is charged or paid
    await w.lifecycle.abandonViews(new Date(Date.now() + 3600_000));
    const view = await t.prisma.watchView.findUniqueOrThrow({ where: { id: s.viewId } });
    expect(view).toMatchObject({ status: 'INVALID', reason: 'SESSION_EXPIRED' });
    expect((await campaignRow(live.id)).qualifiedViews).toBe(0);
  });

  it('skipping or seeking forward does not qualify (no charge, no reward) and tells the customer only the reason class', async () => {
    const live = await w.publishWatch('A');
    const c = await w.newCustomer();
    const { outcome } = await w.playView(c, live.id, { skip: true });
    expect(outcome).toMatchObject({
      outcome: 'NOT_QUALIFIED',
      reasonClass: 'SKIPPED',
      reward: null,
    });
    expect((await campaignRow(live.id)).spentHalalas).toBe(0);
    expect(await entries(w.userIdOf(c))).toHaveLength(0);
  });

  it('leaving the app for longer than the grace period invalidates the view', async () => {
    const live = await w.publishWatch('A');
    const c = await w.newCustomer();
    const { outcome } = await w.playView(c, live.id, { background: true });
    expect(outcome).toMatchObject({ outcome: 'NOT_QUALIFIED', reasonClass: 'LEFT_APP' });
    expect((await campaignRow(live.id)).qualifiedViews).toBe(0);
  });

  it('an expired viewing session cannot qualify', async () => {
    const live = await w.publishWatch('A');
    const c = await w.newCustomer();
    const t0 = new Date();
    const s = await w.qual.start(
      w.userIdOf(c),
      { campaignId: live.id, deviceId: w.newDevice() },
      t0,
    );
    const out = await w.qual.complete(
      w.userIdOf(c),
      s.viewId,
      s.viewToken,
      8,
      new Date(t0.getTime() + 10 * 60_000),
    );
    expect(out).toMatchObject({ outcome: 'NOT_QUALIFIED', state: 'INVALID' });
  });

  // ------------------------------------------------------------------ still-watching check
  describe('still-watching check (configurable, off by default for short videos)', () => {
    it('is not shown on a short video by default', async () => {
      const live = await w.publishWatch('A');
      const { promptSeen, outcome } = await w.playView(await w.newCustomer(), live.id);
      expect(promptSeen).toBeNull();
      expect(outcome.outcome).toBe('QUALIFIED');
    });

    it('when required: answering in time qualifies; ignoring it or answering late does not', async () => {
      const restore = await w.setConfig('watch.qualifying_policy', {
        stillWatching: {
          mode: 'ALWAYS',
          probability: 1,
          minDurationSec: 1,
          timeoutSec: 8,
          graceSec: 3,
        },
      });
      try {
        const live = await w.publishWatch('A');
        const ok = await w.playView(await w.newCustomer(), live.id);
        expect(ok.promptSeen).not.toBeNull();
        expect(ok.outcome.outcome).toBe('QUALIFIED');
        const ignored = await w.playView(await w.newCustomer(), live.id, { prompt: 'never' });
        expect(ignored.outcome).toMatchObject({
          outcome: 'NOT_QUALIFIED',
          reasonClass: 'NO_RESPONSE',
        });
        const late = await w.playView(await w.newCustomer(), live.id, { prompt: 'late' });
        expect(late.outcome).toMatchObject({
          outcome: 'NOT_QUALIFIED',
          reasonClass: 'NO_RESPONSE',
        });
        expect((await campaignRow(live.id)).qualifiedViews).toBe(1);
      } finally {
        await restore();
      }
    });

    it('the thresholds are never sent to the client', async () => {
      const live = await w.publishWatch('A');
      const s = await w.qual.start(w.userIdOf(await w.newCustomer()), {
        campaignId: live.id,
        deviceId: w.newDevice(),
      });
      expect(Object.keys(s).sort()).toEqual([
        'durationSec',
        'expiresAt',
        'heartbeatSec',
        'playbackUrl',
        'posterUrl',
        'serverNow',
        'viewId',
        'viewToken',
      ]);
    });
  });

  // ------------------------------------------------------------------ duplicates and caps
  describe('duplicate, repeat and cap rules', () => {
    it('a view cannot be completed twice: the second completion returns the same outcome and nothing more is charged or paid', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      const { started, outcome } = await w.playView(c, live.id);
      expect(outcome.outcome).toBe('QUALIFIED');
      const again = await w.qual.complete(
        w.userIdOf(c),
        started.viewId,
        started.viewToken,
        8,
        new Date(),
      );
      expect(again).toMatchObject({ outcome: 'QUALIFIED', reward: { points: 10 } });
      const [camp, es] = [await campaignRow(live.id), await entries(w.userIdOf(c))];
      expect(camp).toMatchObject({ qualifiedViews: 1, spentHalalas: 100 });
      expect(es).toHaveLength(1);
    });

    it('the SAME completion sent concurrently charges and rewards exactly once', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      const userId = w.userIdOf(c);
      const t0 = new Date();
      const s = await w.qual.start(userId, { campaignId: live.id, deviceId: w.newDevice() }, t0);
      for (let tick = 2; tick <= 8; tick += 2)
        await w.qual.events(
          userId,
          s.viewId,
          s.viewToken,
          [{ type: 'HEARTBEAT', positionSec: tick }],
          new Date(t0.getTime() + tick * 1000),
        );
      const done = new Date(t0.getTime() + 8200);
      const results = await Promise.all(
        Array.from({ length: 6 }, () => w.qual.complete(userId, s.viewId, s.viewToken, 8, done)),
      );
      expect(new Set(results.map((r) => r.outcome))).toEqual(new Set(['QUALIFIED']));
      expect(await entries(userId)).toHaveLength(1);
      expect(await campaignRow(live.id)).toMatchObject({ qualifiedViews: 1, spentHalalas: 100 });
      await reconcile();
    });

    it('the database refuses a second reward for one view even if code tried (partial unique index)', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      const { started } = await w.playView(c, live.id);
      const acc = await t.prisma.rewardAccount.findUniqueOrThrow({
        where: { userId: w.userIdOf(c) },
      });
      await expect(
        t.prisma.rewardEntry.create({
          data: {
            accountId: acc.id,
            type: 'EARN',
            bucket: 'AVAILABLE',
            points: 10,
            availableAfter: 20,
            heldAfter: 0,
            sourceType: 'VIEW',
            sourceId: started.viewId,
            idempotencyKey: `dup-${Math.random()}`,
          },
        }),
      ).rejects.toThrow();
    });

    it('the same customer cannot earn from the same campaign again inside the repeat window; the card says when', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      await w.playView(c, live.id);
      await expect(
        w.qual.start(w.userIdOf(c), { campaignId: live.id, deviceId: w.newDevice() }),
      ).rejects.toMatchObject({ code: 'VIEW_NOT_ALLOWED', field: 'ALREADY_EARNED' });
      const hub = await w.api(c).get('/v1/app/watch');
      const card = hub.body.data.campaigns.find((x: { id: string }) => x.id === live.id);
      expect(card).toMatchObject({ availability: 'ALREADY_EARNED' });
      expect(new Date(card.availableAgainAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
      // after the window it is available again
      const later = new Date(Date.now() + 25 * 3600_000);
      const s = await w.qual.start(
        w.userIdOf(c),
        { campaignId: live.id, deviceId: w.newDevice() },
        later,
      );
      expect(s.viewId).toBeTruthy();
    });

    it('a customer has ONE open session: starting another video closes the first', async () => {
      const a = await w.publishWatch('A');
      const b = await w.publishWatch('A');
      const c = await w.newCustomer();
      const device = w.newDevice();
      const s1 = await w.qual.start(w.userIdOf(c), { campaignId: a.id, deviceId: device });
      await w.qual.start(w.userIdOf(c), { campaignId: b.id, deviceId: device });
      expect(
        (await t.prisma.watchView.findUniqueOrThrow({ where: { id: s1.viewId } })).status,
      ).toBe('INVALID');
    });

    it('the daily cap stops earning for the day; the card says the cap was reached', async () => {
      const restore = await w.setConfig('watch.frequency', { customerDailyCap: 2 });
      try {
        const [a, b, c3] = [
          await w.publishWatch('A'),
          await w.publishWatch('A'),
          await w.publishWatch('A'),
        ];
        const c = await w.newCustomer();
        const device = w.newDevice();
        expect((await w.playView(c, a.id, { device })).outcome.outcome).toBe('QUALIFIED');
        expect((await w.playView(c, b.id, { device })).outcome.outcome).toBe('QUALIFIED');
        await expect(
          w.qual.start(w.userIdOf(c), { campaignId: c3.id, deviceId: device }),
        ).rejects.toMatchObject({ code: 'VIEW_NOT_ALLOWED', field: 'DAILY_CAP' });
        const hub = await w.api(c).get('/v1/app/watch');
        expect(hub.body.data.daily).toMatchObject({ earnedViews: 2, cap: 2 });
        expect(
          hub.body.data.campaigns.find((x: { id: string }) => x.id === c3.id)?.availability,
        ).toBe('DAILY_CAP');
      } finally {
        await restore();
      }
    });

    it('a device can serve only a limited number of accounts', async () => {
      const live = await w.publishWatch('A');
      const device = w.newDevice();
      for (let i = 0; i < 2; i++)
        await w.qual.start(w.userIdOf(await w.newCustomer()), {
          campaignId: live.id,
          deviceId: device,
        });
      await expect(
        w.qual.start(w.userIdOf(await w.newCustomer()), { campaignId: live.id, deviceId: device }),
      ).rejects.toMatchObject({ code: 'VIEW_NOT_ALLOWED' });
    });

    it('an account can use only a limited number of devices', async () => {
      const a = await w.publishWatch('A');
      const c = await w.newCustomer();
      for (let i = 0; i < 3; i++)
        await w.qual.start(w.userIdOf(c), { campaignId: a.id, deviceId: w.newDevice() });
      await expect(
        w.qual.start(w.userIdOf(c), { campaignId: a.id, deviceId: w.newDevice() }),
      ).rejects.toMatchObject({ code: 'VIEW_NOT_ALLOWED' });
    });

    it('a stricter merchant repeat window is honoured; the platform minimum cannot be loosened', async () => {
      const live = await w.publishWatch('A', { frequency: { repeatWindowHours: 72 } });
      expect(
        (await t.prisma.watchCampaign.findUniqueOrThrow({ where: { id: live.id } }))
          .repeatWindowHours,
      ).toBe(72);
      const c = await w.newCustomer();
      await w.playView(c, live.id);
      await expect(
        w.qual.start(
          w.userIdOf(c),
          { campaignId: live.id, deviceId: w.newDevice() },
          new Date(Date.now() + 48 * 3600_000),
        ),
      ).rejects.toMatchObject({ field: 'ALREADY_EARNED' });
    });
  });

  // ------------------------------------------------------------------ budget safety
  describe('budget safety', () => {
    it('concurrent completions never overspend: exactly the paid views qualify, the rest are CAPPED, the campaign completes and closes out', async () => {
      const live = await w.publishWatch('A'); // 10 paid views, budget 1000
      const customers = await Promise.all(Array.from({ length: 14 }, () => w.newCustomer()));
      const t0 = new Date();
      const started = await Promise.all(
        customers.map(async (c) => {
          const userId = w.userIdOf(c);
          const s = await w.qual.start(
            userId,
            { campaignId: live.id, deviceId: w.newDevice() },
            t0,
          );
          for (let tick = 2; tick <= 8; tick += 2)
            await w.qual.events(
              userId,
              s.viewId,
              s.viewToken,
              [{ type: 'HEARTBEAT', positionSec: tick }],
              new Date(t0.getTime() + tick * 1000),
            );
          return { userId, s };
        }),
      );
      const done = new Date(t0.getTime() + 8200);
      const res = await Promise.all(
        started.map(({ userId, s }) => w.qual.complete(userId, s.viewId, s.viewToken, 8, done)),
      );
      expect(res.filter((r) => r.outcome === 'QUALIFIED')).toHaveLength(10);
      const capped = res.filter((r) => r.outcome === 'CAPPED');
      expect(capped).toHaveLength(4);
      expect(capped.every((r) => r.reasonClass === 'BUDGET_EXHAUSTED' && r.reward === null)).toBe(
        true,
      );
      const camp = await campaignRow(live.id);
      expect(camp).toMatchObject({
        status: 'COMPLETED',
        qualifiedViews: 10,
        spentHalalas: 1000,
        fundedHalalas: 1000,
        unusedHalalas: 0,
      });
      expect(camp.spentHalalas).toBeLessThanOrEqual(camp.fundedHalalas);
      // rewards were written only for the 10 qualified views
      const rewarded = await t.prisma.rewardEntry.count({
        where: { sourceType: 'VIEW', sourceId: { in: started.map((x) => x.s.viewId) } },
      });
      expect(rewarded).toBe(10);
      await reconcile();
      await trial();
      // a new start on an exhausted campaign is refused with a clear reason
      await expect(
        w.qual.start(w.userIdOf(await w.newCustomer()), {
          campaignId: live.id,
          deviceId: w.newDevice(),
        }),
      ).rejects.toMatchObject({ code: 'VIEW_NOT_ALLOWED' });
    });

    it('the unused budget of an expired or stopped campaign is closed out to its own balance, once', async () => {
      const live = await w.publishWatch('A');
      await w.playView(await w.newCustomer(), live.id);
      const stop = await w
        .api(w.ownerA)
        .post(`${w.wbase('A')}/watch/${live.id}/cancel`)
        .send({ reason: 'No longer needed.' });
      expect(stop.body.data.budget).toMatchObject({
        spentHalalas: 100,
        unusedHalalas: 900,
        remainingHalalas: 0,
        closedOut: true,
      });
      // a second close-out (sweep) changes nothing
      const again = await w.lifecycle.sweep(new Date(Date.now() + 40 * 86_400_000));
      expect(again).toBeTruthy();
      expect((await campaignRow(live.id)).unusedHalalas).toBe(900);
      const journals = await t.prisma.ledgerJournal.count({
        where: { sourceId: live.id, type: 'CAMPAIGN_RELEASE' },
      });
      expect(journals).toBe(1);
      await trial();
    });

    it('a view in flight when the campaign is paused is not charged', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      const userId = w.userIdOf(c);
      const t0 = new Date();
      const s = await w.qual.start(userId, { campaignId: live.id, deviceId: w.newDevice() }, t0);
      for (let tick = 2; tick <= 8; tick += 2)
        await w.qual.events(
          userId,
          s.viewId,
          s.viewToken,
          [{ type: 'HEARTBEAT', positionSec: tick }],
          new Date(t0.getTime() + tick * 1000),
        );
      await w.decideWatch(w.ops, live.id, 'pause', { reason: 'Review' });
      const out = await w.qual.complete(
        userId,
        s.viewId,
        s.viewToken,
        8,
        new Date(t0.getTime() + 8200),
      );
      expect(out).toMatchObject({ outcome: 'NOT_QUALIFIED', reasonClass: 'UNAVAILABLE' });
      expect((await campaignRow(live.id)).spentHalalas).toBe(0);
    });
  });

  it('a browser may send the viewing token: CORS preflight allows the x-view-token header', async () => {
    const res = await t.http
      .options('/v1/app/watch/views/00000000-0000-4000-8000-000000000000/events')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'x-view-token,content-type');
    expect(res.status).toBeLessThan(300);
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain(
      'x-view-token',
    );
  });

  // ------------------------------------------------------------------ session security
  describe('viewing session security (the client never decides)', () => {
    it('events and completion need the viewing token and the same customer', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      const other = await w.newCustomer();
      const s = await w.qual.start(w.userIdOf(c), { campaignId: live.id, deviceId: w.newDevice() });
      const url = `/v1/app/watch/views/${s.viewId}`;
      const ev = (sess: typeof c, token?: string) =>
        w
          .api(sess)
          .post(`${url}/events`)
          .set('x-view-token', token ?? '')
          .send({ events: [{ type: 'HEARTBEAT', positionSec: 1 }] });
      expect((await ev(c, s.viewToken)).status).toBe(200);
      expect((await ev(c, 'wrong-token')).status).toBe(403);
      expect((await ev(c)).status).toBe(403);
      expect((await ev(other, s.viewToken)).status).toBe(404);
      expect((await w.api(other).get(url)).status).toBe(404);
    });

    it('a client claiming a position far ahead of real time earns nothing for the jump', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      const userId = w.userIdOf(c);
      const t0 = new Date();
      const s = await w.qual.start(userId, { campaignId: live.id, deviceId: w.newDevice() }, t0);
      await w.qual.events(
        userId,
        s.viewId,
        s.viewToken,
        [{ type: 'HEARTBEAT', positionSec: 8 }],
        new Date(t0.getTime() + 1000),
      );
      const v = await t.prisma.watchView.findUniqueOrThrow({ where: { id: s.viewId } });
      expect(v.watchedSeconds).toBe(0);
      const out = await w.qual.complete(
        userId,
        s.viewId,
        s.viewToken,
        8,
        new Date(t0.getTime() + 1500),
      );
      expect(out.outcome).toBe('NOT_QUALIFIED');
    });

    it('missing heartbeats earn no credit for the gap (a client cannot claim time it did not report)', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      const userId = w.userIdOf(c);
      const t0 = new Date();
      const s = await w.qual.start(userId, { campaignId: live.id, deviceId: w.newDevice() }, t0);
      const out = await w.qual.complete(
        userId,
        s.viewId,
        s.viewToken,
        8,
        new Date(t0.getTime() + 8200),
      );
      expect(out.outcome).toBe('NOT_QUALIFIED');
    });
  });

  // ------------------------------------------------------------------ HTTP end to end (real clock, tuned policy)
  it('works over HTTP: start, heartbeat, complete, then the wallet, activity and the notification', async () => {
    const restore = await w.setConfig('watch.qualifying_policy', { watchPct: 20, heartbeatSec: 2 });
    try {
      const live = await w.publishWatch('A', { durationSec: 5 });
      const c = await w.newCustomer();
      const started = await w
        .api(c)
        .post('/v1/app/watch/views')
        .send({ campaignId: live.id, deviceId: w.newDevice() });
      expect(started.status).toBe(200);
      const { viewId, viewToken } = started.body.data;
      await new Promise((r) => setTimeout(r, 1300));
      const hb = await w
        .api(c)
        .post(`/v1/app/watch/views/${viewId}/events`)
        .set('x-view-token', viewToken)
        .send({ events: [{ type: 'HEARTBEAT', positionSec: 1.3 }] });
      expect(hb.body.data).toMatchObject({ state: 'STARTED', prompt: null });
      const done = await w
        .api(c)
        .post(`/v1/app/watch/views/${viewId}/complete`)
        .set('x-view-token', viewToken)
        .send({ positionSec: 1.4 });
      expect(done.status).toBe(200);
      expect(done.body.data).toMatchObject({
        outcome: 'QUALIFIED',
        reward: { points: 10, status: 'EARNED' },
      });
      const summary = await w.api(c).get('/v1/app/rewards');
      expect(summary.body.data).toMatchObject({
        availableBalance: 10,
        heldBalance: 0,
        cashValueShown: false,
      });
      const act = await w.api(c).get('/v1/app/rewards/activity');
      expect(act.body.data[0]).toMatchObject({
        type: 'EARN',
        points: 10,
        bucket: 'AVAILABLE',
        balanceAfter: 10,
      });
      expect(act.body.data[0].title.en).toBe('Meet our chef');
      expect(JSON.stringify(summary.body)).not.toMatch(/SAR|riyal|halala/i);
      expect(summary.body.data.cashValueShown).toBe(false);
    } finally {
      await restore();
    }
  });

  // ------------------------------------------------------------------ discovery
  describe('discovery', () => {
    it('shows only live campaigns of active merchants, bilingual, with the points (never a SAR value)', async () => {
      const live = await w.publishWatch('A');
      const draft = await w.createWatch('A', w.watchContent('A'));
      const hub = await t.http.get('/v1/app/watch?city=Riyadh');
      const ids = hub.body.data.campaigns.map((x: { id: string }) => x.id);
      expect(ids).toContain(live.id);
      expect(ids).not.toContain(draft.id);
      const card = hub.body.data.campaigns.find((x: { id: string }) => x.id === live.id);
      expect(card.title).toEqual({ en: 'Meet our chef', ar: 'تعرّف على الشيف' });
      expect(card.rewardPoints).toBe(10);
      expect(card.merchantName.ar).toBeTruthy();
      expect(JSON.stringify(card)).not.toMatch(/halala|sar/i);
      const detail = await t.http.get(`/v1/app/watch/campaigns/${live.id}?city=Riyadh`);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({ sponsored: true, canStart: true });
      expect((await t.http.get(`/v1/app/watch/campaigns/${draft.id}`)).status).toBe(404);
    });

    it('employer-only campaigns are shown locked (with an unlock path) and cannot be started by others', async () => {
      const live = await w.publishWatch('A', {
        targeting: {
          cities: ['Riyadh'],
          eligibility: { kind: 'EMPLOYER', valueRefs: [w.employer] },
          timeWindow: null,
          branchIds: [],
        },
      });
      const c = await w.newCustomer();
      const card = (await w.api(c).get('/v1/app/watch')).body.data.campaigns.find(
        (x: { id: string }) => x.id === live.id,
      );
      expect(card).toMatchObject({ availability: 'NOT_ELIGIBLE' });
      expect(card.eligibility.result).toBe('LOCKED_UNLOCKABLE');
      await expect(
        w.qual.start(w.userIdOf(c), { campaignId: live.id, deviceId: w.newDevice() }),
      ).rejects.toMatchObject({ code: 'VIEW_NOT_ALLOWED' });
    });

    it('a campaign for another city is not shown', async () => {
      const live = await w.publishWatch('A');
      const hub = await t.http.get('/v1/app/watch?city=Jeddah');
      expect(hub.body.data.campaigns.map((x: { id: string }) => x.id)).not.toContain(live.id);
    });

    it('discovery signals are recorded and shown on the merchant monitor as impressions, opens and button clicks', async () => {
      const live = await w.publishWatch('A');
      const anon = 'anon-' + idem();
      for (const type of ['IMPRESSION', 'DETAIL_VIEW', 'CTA_CLICK'])
        await t.http
          .post('/v1/app/events')
          .send({ events: [{ type, dealId: live.id, product: 'WATCH', anonymousId: anon }] });
      const m = (await w.api(w.ownerA).get(`${w.wbase('A')}/watch/${live.id}/monitor`)).body.data;
      expect(m.funnel).toMatchObject({ impressions: 1, opened: 1, ctaClicks: 1 });
    });
  });

  // ------------------------------------------------------------------ fraud screening
  describe('rule-based fraud screening', () => {
    it('a blocked account or device cannot start; a block placed mid-view stops qualification without a charge', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      const userId = w.userIdOf(c);
      const t0 = new Date();
      const s = await w.qual.start(userId, { campaignId: live.id, deviceId: w.newDevice() }, t0);
      for (let tick = 2; tick <= 8; tick += 2)
        await w.qual.events(
          userId,
          s.viewId,
          s.viewToken,
          [{ type: 'HEARTBEAT', positionSec: tick }],
          new Date(t0.getTime() + tick * 1000),
        );
      await t.prisma.riskBlock.create({
        data: { kind: 'ACCOUNT', subjectId: userId, reason: 'test' },
      });
      const out = await w.qual.complete(
        userId,
        s.viewId,
        s.viewToken,
        8,
        new Date(t0.getTime() + 8200),
      );
      expect(out).toMatchObject({ outcome: 'NOT_QUALIFIED', reasonClass: 'OTHER', reward: null });
      expect((await campaignRow(live.id)).spentHalalas).toBe(0);
      const flag = await t.prisma.riskFlag.findFirst({ where: { viewId: s.viewId } });
      expect(flag).toMatchObject({ decision: 'BLOCK', status: 'OPEN' });
      await expect(
        w.qual.start(
          userId,
          { campaignId: live.id, deviceId: w.newDevice() },
          new Date(t0.getTime() + 60_000),
        ),
      ).rejects.toMatchObject({ code: 'VIEW_NOT_ALLOWED' });
    });

    it('a suspicious but plausible view is HELD: the merchant is charged, the reward waits, and an automatic release follows the review period', async () => {
      const restore = await w.setConfig('watch.qualifying_policy', {
        stillWatching: {
          mode: 'ALWAYS',
          probability: 1,
          minDurationSec: 1,
          timeoutSec: 8,
          graceSec: 3,
        },
      });
      try {
        const live = await w.publishWatch('A');
        const c = await w.newCustomer();
        const r = await w.playView(c, live.id, { prompt: 'instant' }); // answered in 0 ms: not human
        expect(r.outcome).toMatchObject({
          outcome: 'HELD',
          reward: { points: 10, status: 'HELD' },
          balance: { availableBalance: 0, heldBalance: 10 },
        });
        expect((await campaignRow(live.id)).spentHalalas).toBe(100);
        expect(await w.balanceOf(c)).toEqual({ available: 0, held: 10 });
        const es = await entries(w.userIdOf(c));
        expect(es.map((e) => [e.type, e.bucket])).toEqual([['HOLD', 'HELD']]);
        // too early: nothing is released
        await w.lifecycle.releaseHeld(new Date(Date.now() + 3600_000));
        expect(await w.balanceOf(c)).toEqual({ available: 0, held: 10 });
        // after the review period it is released (two ledger legs; no silent overwrite)
        const released = await w.lifecycle.releaseHeld(new Date(Date.now() + 25 * 3600_000));
        expect(released).toBeGreaterThanOrEqual(1);
        expect(await w.balanceOf(c)).toEqual({ available: 10, held: 0 });
        const after = await entries(w.userIdOf(c));
        expect(after.map((e) => `${e.type}:${e.bucket}:${e.points}`)).toEqual([
          'HOLD:HELD:10',
          'RELEASE:HELD:-10',
          'RELEASE:AVAILABLE:10',
        ]);
        // the customer sees ONE "ready" line, not two
        const act = await w.api(c).get('/v1/app/rewards/activity');
        expect(act.body.data.map((e: { type: string }) => e.type)).toEqual(['RELEASE', 'HOLD']);
        const n = await t.prisma.notification.findMany({
          where: { userId: w.userIdOf(c) },
          orderBy: { createdAt: 'asc' },
        });
        expect(n.map((x) => x.type)).toEqual(['REWARD_HELD', 'REWARD_RELEASED']);
        await reconcile();
      } finally {
        await restore();
      }
    });

    it('a FLAGGED view opens a case for Risk; reversing it removes the reward and credits the merchant back; the ledger stays balanced', async () => {
      const restoreA = await w.setConfig('watch.qualifying_policy', {
        stillWatching: {
          mode: 'ALWAYS',
          probability: 1,
          minDurationSec: 1,
          timeoutSec: 8,
          graceSec: 3,
        },
      });
      const restoreB = await w.setConfig('watch.fraud', {
        thresholds: { hold: 10, flag: 20, block: 90 },
      });
      try {
        const live = await w.publishWatch('A');
        const c = await w.newCustomer();
        const r = await w.playView(c, live.id, { prompt: 'instant' });
        expect(r.outcome.outcome).toBe('HELD');
        const flag = await t.prisma.riskFlag.findFirstOrThrow({
          where: { viewId: r.started.viewId },
        });
        expect(flag).toMatchObject({ decision: 'FLAG', status: 'OPEN' });
        // not auto-released while the case is open
        await w.lifecycle.releaseHeld(new Date(Date.now() + 48 * 3600_000));
        expect((await w.balanceOf(c)).held).toBe(10);

        // permissions: only Risk may see and decide
        expect((await w.api(w.support).get('/v1/admin/risk/flags')).status).toBe(403);
        expect((await w.api(w.finance).get('/v1/admin/risk/flags')).status).toBe(403);
        expect((await w.api(w.ops).get(`/v1/admin/risk/flags/${flag.id}`)).status).toBe(403);
        const list = await w.api(w.risk).get('/v1/admin/risk/flags?status=OPEN');
        expect(list.status).toBe(200);
        expect(list.body.data.some((x: { id: string }) => x.id === flag.id)).toBe(true);
        const detail = await w.api(w.risk).get(`/v1/admin/risk/flags/${flag.id}`);
        expect(detail.body.data.signalDetails.map((s: { code: string }) => s.code)).toContain(
          'PROMPT_TOO_FAST',
        );
        expect(detail.body.data.timeline.length).toBeGreaterThan(2);
        expect(
          (
            await w
              .api(w.risk)
              .post(`/v1/admin/risk/flags/${flag.id}/decide`)
              .send({ outcome: 'REVERSE_REWARDS', reason: 'x' })
          ).status,
        ).toBe(400);

        const dec = await w
          .api(w.risk)
          .post(`/v1/admin/risk/flags/${flag.id}/decide`)
          .send({ outcome: 'REVERSE_REWARDS', reason: 'Automation suspected.' });
        expect(dec.status).toBe(200);
        expect(dec.body.data).toMatchObject({ status: 'DECIDED', outcome: 'REVERSE_REWARDS' });
        expect(await w.balanceOf(c)).toEqual({ available: 0, held: 0 });
        const camp = await campaignRow(live.id);
        expect(camp).toMatchObject({ spentHalalas: 0, qualifiedViews: 0 });
        expect(
          (await t.prisma.watchView.findUniqueOrThrow({ where: { id: r.started.viewId } })).status,
        ).toBe('CREDITED_BACK');
        // deciding twice is refused; the decision is audited
        expect(
          (
            await w
              .api(w.risk)
              .post(`/v1/admin/risk/flags/${flag.id}/decide`)
              .send({ outcome: 'CLEAR', reason: 'again please' })
          ).status,
        ).toBe(409);
        expect(
          await t.prisma.auditLog.count({
            where: { action: 'risk.case_decided', entityId: flag.id },
          }),
        ).toBe(1);
        const types = (await entries(w.userIdOf(c))).map((e) => e.type);
        expect(types).toEqual(['HOLD', 'REVERSE']);
        await reconcile();
        await trial();
      } finally {
        await restoreB();
        await restoreA();
      }
    });

    it('clearing a case releases the held reward; blocking a device refuses its next start', async () => {
      const restoreA = await w.setConfig('watch.qualifying_policy', {
        stillWatching: {
          mode: 'ALWAYS',
          probability: 1,
          minDurationSec: 1,
          timeoutSec: 8,
          graceSec: 3,
        },
      });
      const restoreB = await w.setConfig('watch.fraud', {
        thresholds: { hold: 10, flag: 20, block: 90 },
      });
      try {
        const live = await w.publishWatch('A');
        const c1 = await w.newCustomer();
        const r1 = await w.playView(c1, live.id, { prompt: 'instant' });
        const f1 = await t.prisma.riskFlag.findFirstOrThrow({
          where: { viewId: r1.started.viewId },
        });
        await w
          .api(w.risk)
          .post(`/v1/admin/risk/flags/${f1.id}/decide`)
          .send({ outcome: 'CLEAR', reason: 'Looks like a fast reader.' });
        expect(await w.balanceOf(c1)).toEqual({ available: 10, held: 0 });

        const c2 = await w.newCustomer();
        const device = w.newDevice();
        const r2 = await w.playView(c2, live.id, { prompt: 'instant', device });
        const f2 = await t.prisma.riskFlag.findFirstOrThrow({
          where: { viewId: r2.started.viewId },
        });
        await w
          .api(w.risk2)
          .post(`/v1/admin/risk/flags/${f2.id}/decide`)
          .send({ outcome: 'BLOCK_DEVICE', reason: 'Device farm.' });
        expect(await w.balanceOf(c2)).toEqual({ available: 0, held: 0 });
        const c3 = await w.newCustomer();
        await expect(
          w.qual.start(w.userIdOf(c3), { campaignId: live.id, deviceId: device }),
        ).rejects.toMatchObject({ code: 'VIEW_NOT_ALLOWED' });
        await reconcile();
        await trial();
      } finally {
        await restoreB();
        await restoreA();
      }
    });
  });

  // ------------------------------------------------------------------ the reward ledger, wallet and redemption
  describe('reward ledger and redemption', () => {
    const item = async (over: Record<string, unknown> = {}) =>
      (
        await t.prisma.rewardCatalogueItem.create({
          data: {
            nameEn: 'Test reward',
            nameAr: 'مكافأة',
            pointsCost: 10,
            stock: null,
            isSample: true,
            ...over,
          },
        })
      ).id;

    it('the ledger is append-only and the cached balances always equal the entries', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      await w.playView(c, live.id);
      const e = (await entries(w.userIdOf(c)))[0]!;
      await expect(
        t.prisma.$executeRaw`UPDATE "RewardEntry" SET "points" = 999 WHERE "id" = ${e.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        t.prisma.$executeRaw`DELETE FROM "RewardEntry" WHERE "id" = ${e.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        t.prisma.$executeRaw`UPDATE "WatchViewEvent" SET "positionSec" = 1`,
      ).rejects.toThrow();
      await reconcile();
    });

    it('redeem: points are spent once, an idempotent retry returns the same code, and balance / stock limits hold', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      await w.playView(c, live.id); // 10 points
      const cheap = await item({ pointsCost: 10, stock: 1 });
      const dear = await item({ pointsCost: 500 });
      const key = idem();
      const a = await w
        .api(c)
        .post('/v1/app/rewards/redeem')
        .set('Idempotency-Key', key)
        .send({ itemId: cheap });
      expect(a.status).toBe(200);
      expect(a.body.data).toMatchObject({ pointsCost: 10, availableBalance: 0 });
      expect(a.body.data.code).toMatch(/^RW-/);
      const again = await w
        .api(c)
        .post('/v1/app/rewards/redeem')
        .set('Idempotency-Key', key)
        .send({ itemId: cheap });
      expect(again.body.data.code).toBe(a.body.data.code);
      expect((await w.balanceOf(c)).available).toBe(0);
      const poor = await w
        .api(c)
        .post('/v1/app/rewards/redeem')
        .set('Idempotency-Key', idem())
        .send({ itemId: dear });
      expect(poor.status).toBe(409);
      expect(poor.body.errors[0].code).toBe('REWARD_INSUFFICIENT');
      // out of stock for the next person
      const c2 = await w.newCustomer();
      await w.playView(c2, live.id);
      const gone = await w
        .api(c2)
        .post('/v1/app/rewards/redeem')
        .set('Idempotency-Key', idem())
        .send({ itemId: cheap });
      expect(gone.status).toBe(409);
      expect(gone.body.errors[0].code).toBe('REWARD_OUT_OF_STOCK');
      expect((await w.balanceOf(c2)).available).toBe(10); // a failed redemption spends nothing (stock rolled back too)
      const cat = await w.api(c2).get('/v1/app/rewards/catalogue');
      expect(cat.body.data.find((i: { id: string }) => i.id === cheap)).toMatchObject({
        stockLeft: 0,
        canRedeem: false,
        isSample: true,
      });
      await reconcile();
    });

    it('two simultaneous redemptions can never spend the same points', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      await w.playView(c, live.id); // 10 points
      const it1 = await item({ pointsCost: 10 });
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          w
            .api(c)
            .post('/v1/app/rewards/redeem')
            .set('Idempotency-Key', idem())
            .send({ itemId: it1 }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect((await w.balanceOf(c)).available).toBe(0);
      await reconcile();
    });

    it('manual adjustments: Support requests, a manager approves; above the threshold a DIFFERENT administrator must approve; nobody can remove points that are not there', async () => {
      const c = await w.newCustomer();
      const userId = w.userIdOf(c);
      const req = (s: typeof w.support, points: number) =>
        w.api(s).post('/v1/admin/rewards/adjustments').send({
          userId,
          points,
          reasonCode: 'GOODWILL',
          ticketRef: 'T-1',
          reason: 'Support goodwill',
        });
      expect((await w.api(w.analyst).get('/v1/admin/rewards/overview')).status).toBe(403);
      const small = await req(w.support, 50);
      expect(small.status).toBe(200);
      expect(small.body.data).toMatchObject({
        status: 'PENDING',
        needsChecker: false,
        actions: [],
      });
      // Support cannot approve
      expect(
        (
          await w
            .api(w.support)
            .post(`/v1/admin/rewards/adjustments/${small.body.data.id}/approve`)
            .send({ reason: 'self' })
        ).status,
      ).toBe(403);
      const ok = await w
        .api(w.risk)
        .post(`/v1/admin/rewards/adjustments/${small.body.data.id}/approve`)
        .send({ reason: 'Approved on ticket T-1' });
      expect(ok.status).toBe(200);
      expect(await w.balanceOf(c)).toEqual({ available: 50, held: 0 });

      // above the threshold (100): the requester cannot approve their own
      const big = await w.api(w.risk).post('/v1/admin/rewards/adjustments').send({
        userId,
        points: 150,
        reasonCode: 'CORRECTION',
        ticketRef: 'T-2',
        reason: 'Correction',
      });
      expect(big.body.data.needsChecker).toBe(true);
      expect(
        (
          await w
            .api(w.risk)
            .post(`/v1/admin/rewards/adjustments/${big.body.data.id}/approve`)
            .send({ reason: 'self' })
        ).body.errors?.[0]?.code,
      ).toBe('CHECKER_REQUIRED');
      expect(
        (
          await w
            .api(w.risk2)
            .post(`/v1/admin/rewards/adjustments/${big.body.data.id}/approve`)
            .send({ reason: 'checked' })
        ).status,
      ).toBe(200);
      expect(await w.balanceOf(c)).toEqual({ available: 200, held: 0 });

      // removing more than the balance is refused
      const over = await w
        .api(w.risk)
        .post('/v1/admin/rewards/adjustments')
        .send({
          userId,
          points: -500,
          reasonCode: 'CLAWBACK',
          ticketRef: 'T-3',
          reason: 'x'.repeat(5),
        });
      const refused = await w
        .api(w.risk2)
        .post(`/v1/admin/rewards/adjustments/${over.body.data.id}/approve`)
        .send({ reason: 'check' });
      expect(refused.status).toBe(409);
      expect(await w.balanceOf(c)).toEqual({ available: 200, held: 0 });
      // a rejection changes nothing
      const rej = await req(w.support, -20);
      expect(
        (
          await w
            .api(w.risk)
            .post(`/v1/admin/rewards/adjustments/${rej.body.data.id}/reject`)
            .send({ reason: 'not needed' })
        ).body.data.status,
      ).toBe('REJECTED');
      expect(await w.balanceOf(c)).toEqual({ available: 200, held: 0 });
      const es = await entries(userId);
      expect(es.map((e) => e.type)).toEqual(['ADMIN_ADJUSTMENT', 'ADMIN_ADJUSTMENT']);
      expect(es[0]).toMatchObject({ reasonCode: 'GOODWILL', actorType: 'ADMIN' });
      const audit = await t.prisma.auditLog.findMany({ where: { entityType: 'RewardAdjustment' } });
      expect(audit.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'reward.adjustment_requested',
          'reward.adjustment_approved',
          'reward.adjustment_rejected',
        ]),
      );
      await reconcile();
    });

    it('expiry is OFF until configured; when enabled, expired lots leave the ledger as EXPIRE entries and the customer is reminded first', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      await w.playView(c, live.id);
      expect(await w.rewards.expireDue(new Date(Date.now() + 365 * 86_400_000))).toBe(0); // expiryDays is null
      const restore = await w.setConfig('rewards.rules', { expiryDays: 30, expiryReminderDays: 7 });
      try {
        const c2 = await w.newCustomer();
        await w.playView(c2, live.id);
        const lot = await t.prisma.rewardLot.findFirstOrThrow({
          where: { account: { userId: w.userIdOf(c2) } },
        });
        expect(lot.expiresAt).not.toBeNull();
        const summary = await w.api(c2).get('/v1/app/rewards');
        expect(summary.body.data.expiringSoon).toBeNull();
        const near = new Date(lot.expiresAt!.getTime() - 3 * 86_400_000);
        expect((await w.lifecycle.expiryReminders(near)) >= 1).toBe(true);
        expect(
          await t.prisma.notification.count({
            where: { userId: w.userIdOf(c2), type: 'REWARD_EXPIRING' },
          }),
        ).toBe(1);
        expect((await w.rewards.expireDue(new Date(lot.expiresAt!.getTime() + 1000))) >= 1).toBe(
          true,
        );
        expect(await w.balanceOf(c2)).toEqual({ available: 0, held: 0 });
        expect((await entries(w.userIdOf(c2))).map((e) => e.type)).toEqual(['EARN', 'EXPIRE']);
        // running it again expires nothing twice
        expect(await w.rewards.expireDue(new Date(lot.expiresAt!.getTime() + 2000))).toBe(0);
        await reconcile();
      } finally {
        await restore();
      }
    });

    it('admin finance view: liability, ledger and account search (masked); Finance and Risk read, nobody edits balances directly', async () => {
      const live = await w.publishWatch('A');
      const c = await w.newCustomer();
      await w.playView(c, live.id);
      const ov = await w.api(w.finance).get('/v1/admin/rewards/overview');
      expect(ov.status).toBe(200);
      expect(ov.body.data.rules).toMatchObject({
        pointValueShown: false,
        negativeBalancePolicy: 'ALLOW_NEGATIVE',
      });
      expect(ov.body.data.liability.availableBalance).toBeGreaterThanOrEqual(10);
      const led = await w.api(w.finance).get(`/v1/admin/rewards/ledger?userId=${w.userIdOf(c)}`);
      expect(led.body.data[0]).toMatchObject({ type: 'EARN', points: 10, userId: w.userIdOf(c) });
      expect(led.body.data[0].accountLabel).toMatch(/••••/);
      expect(
        (await w.api(w.risk).get('/v1/admin/rewards/accounts?q=' + w.userIdOf(c))).status,
      ).toBe(200);
      expect((await w.api(w.finance).get('/v1/admin/rewards/reconcile')).body.data.mismatches).toBe(
        0,
      );
      // the catalogue is edited only with the manage permission, and items are flagged as samples
      const body = {
        name: { en: 'Coffee', ar: 'قهوة' },
        description: { en: '', ar: '' },
        pointsCost: 100,
        stock: 5,
        status: 'ACTIVE',
        validityDays: 30,
        isSample: true,
      };
      expect((await w.api(w.finance).post('/v1/admin/rewards/items').send(body)).status).toBe(403);
      expect((await w.api(w.risk).post('/v1/admin/rewards/items').send(body)).status).toBe(200);
    });
  });

  // ------------------------------------------------------------------ Arabic basics
  it('every customer-facing string exists in Arabic: campaign text, merchant name, notification titles and reward activity', async () => {
    const live = await w.publishWatch('A');
    const c = await w.newCustomer();
    await w.playView(c, live.id);
    const detail = (await t.http.get(`/v1/app/watch/campaigns/${live.id}?city=Riyadh`)).body.data;
    expect(detail.title.ar).toBeTruthy();
    expect(detail.ctaLabel.ar).toBeTruthy();
    expect(detail.merchantName.ar).toBeTruthy();
    const act = (await w.api(c).get('/v1/app/rewards/activity')).body.data[0];
    expect(act.title.ar).toBe('تعرّف على الشيف');
    expect(act.merchantName.ar).toBeTruthy();
    const note = await w.api(c).get('/v1/app/notifications');
    if (note.status === 200) expect(JSON.stringify(note.body)).toMatch(/[؀-ۿ]/);
  });
});
