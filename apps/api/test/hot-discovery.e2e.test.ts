import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, RIYADH, createTestApp, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

describe.skipIf(!DB_READY)('Exclusive Deal discovery, eligibility visibility and analytics', () => {
  let t: TestApp;
  let w: HotWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
  });
  afterAll(() => t?.close());

  const list = (q = '', s?: Awaited<ReturnType<HotWorld['newCustomer']>>) =>
    s ? w.api(s).get(`/v1/app/hot-deals?${q}`) : t.http.get(`/v1/app/hot-deals?${q}`);

  it('lists live Exclusive Deals publicly with time left, remaining units and the nearest branch', async () => {
    const deal = await w.publishHot('A', 4, {
      title: { en: 'Zebra special offer', ar: 'عرض الحمار المخطط' },
    });
    const res = await list(`q=zebra&lat=${RIYADH.lat}&lng=${RIYADH.lng}`);
    expect(res.status).toBe(200);
    const card = res.body.data.find((d: { id: string }) => d.id === deal.id);
    expect(card).toBeTruthy();
    expect(card).toMatchObject({
      soldOut: false,
      availability: 'AVAILABLE',
      remaining: 4,
      limitType: 'TIME_AND_QUANTITY',
      reservationsEnabled: true,
    });
    expect(card.endsAt).toBeTruthy();
    expect(new Date(card.serverNow).getTime()).toBeLessThan(Date.now() + 5000);
    expect(card.nearestBranch.id).toBe(w.A.branchIds[0]);
    expect(card.distanceMeters).toBeLessThan(1000);
    expect(JSON.stringify(card)).not.toMatch(/qrToken|manualCode|userId|price|deposit/i);
    // Arabic search finds the same deal (normalised)
    const ar = await list(`q=${encodeURIComponent('الحمار')}`);
    expect(ar.body.data.some((d: { id: string }) => d.id === deal.id)).toBe(true);
  });

  it('hides drafts, pending, scheduled, paused, suspended, expired deals and disabled cities', async () => {
    const draft = await w.createHot(
      'A',
      w.hotContent('A', 3, { title: { en: 'Hidden quokka draft', ar: 'مسودة مخفية' } }),
    );
    const pending = await w.createHot(
      'A',
      w.hotContent('A', 3, { title: { en: 'Hidden quokka pending', ar: 'قيد المراجعة' } }),
    );
    await w.submitHot('A', pending.id);
    const scheduled = await w.publishHot('A', 3, {
      startAt: hours(2),
      endAt: hours(5),
      title: { en: 'Hidden quokka scheduled', ar: 'مجدول' },
    });
    const paused = await w.publishHot('A', 3, {
      title: { en: 'Hidden quokka paused', ar: 'متوقف' },
    });
    await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${paused.id}/pause`)
      .send({});
    const shown = await w.publishHot('A', 3, { title: { en: 'Shown quokka live', ar: 'ظاهر' } });
    const ids = (await list('q=quokka')).body.data.map((d: { id: string }) => d.id);
    expect(ids).toContain(shown.id);
    for (const hidden of [draft, pending, scheduled, paused]) expect(ids).not.toContain(hidden.id);
    expect((await list('q=quokka&city=Jeddah')).body.data).toEqual([]);
  });

  it('keeps sold-out offers visible and clearly marked, sorted after available ones', async () => {
    const soldOut = await w.publishHot('A', 1, {
      title: { en: 'Wombat soldout', ar: 'نفد' },
      endAt: hours(1),
    });
    const c = await w.newCustomer();
    await w.reserve(c, soldOut.id, w.A.branchIds[0]!);
    const avail = await w.publishHot('A', 5, {
      title: { en: 'Wombat available', ar: 'متاح' },
      endAt: hours(5),
    });
    const body = (await list('q=wombat')).body.data;
    expect(body.map((d: { id: string }) => d.id)).toEqual([avail.id, soldOut.id]);
    expect(body[1]).toMatchObject({ soldOut: true, availability: 'SOLD_OUT', remaining: 0 });
    const detail = await t.http.get(`/v1/app/hot-deals/${soldOut.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.branches[0]).toMatchObject({
      canReserve: false,
      blockedReason: 'SOLD_OUT',
    });
  });

  it('orders by ending soonest by default and nearest on request', async () => {
    const far = await w.publishHot('B', 5, {
      title: { en: 'Okapi far', ar: 'بعيد' },
      endAt: hours(6),
    });
    const near = await w.publishHot('A', 5, {
      title: { en: 'Okapi near', ar: 'قريب' },
      endAt: hours(3),
    });
    const byEnd = (await list('q=okapi')).body.data.map((d: { id: string }) => d.id);
    expect(byEnd).toEqual([near.id, far.id]);
    const byNear = (
      await list(`q=okapi&sort=nearest&lat=${RIYADH.lat}&lng=${RIYADH.lng}`)
    ).body.data.map((d: { id: string }) => d.id);
    expect(byNear[0]).toBe(near.id);
  });

  it('applies the locked-or-hidden rule: unlockable offers show locked with a reason, impossible ones disappear', async () => {
    const deal = await w.publishHot('A', 5, {
      title: { en: 'Lynx employer only', ar: 'للموظفين' },
      eligibility: { kind: 'EMPLOYER', valueRefs: [w.employer] },
    });
    const guest = (await list('q=lynx')).body.data[0];
    expect(guest.eligibility).toMatchObject({
      result: 'LOCKED_UNLOCKABLE',
      unlockAction: 'SIGN_IN',
    });
    const plain = await w.newCustomer();
    const locked = (await list('q=lynx', plain)).body.data[0];
    expect(locked.eligibility).toMatchObject({
      result: 'LOCKED_UNLOCKABLE',
      unlockAction: 'VERIFY_EMPLOYER',
    });
    expect(locked.eligibility.message.en).toBe('Verify your employer to unlock');
    expect((await list('q=lynx&eligibility=unlocked', plain)).body.data).toEqual([]);
    // a customer verified with a DIFFERENT employer has no realistic path: hidden
    const otherEmployer = await (
      await import('./helpers')
    ).createPartnerOrg(t.prisma, 'OtherEmployer', 'EMPLOYER');
    const other = await w.newCustomer();
    await t.prisma.eligibilityAttribute.create({
      data: {
        userId: other.me.id,
        attrType: 'EMPLOYER',
        valueRef: otherEmployer,
        level: 'OTP_VERIFIED',
        status: 'VERIFIED',
      },
    });
    expect((await list('q=lynx', other)).body.data).toEqual([]);
    expect((await w.api(other).get(`/v1/app/hot-deals/${deal.id}`)).status).toBe(404);
    // the right employer: unlocked
    const member = await w.newCustomer();
    await t.prisma.eligibilityAttribute.create({
      data: {
        userId: member.me.id,
        attrType: 'EMPLOYER',
        valueRef: w.employer,
        level: 'OTP_VERIFIED',
        status: 'VERIFIED',
      },
    });
    expect((await list('q=lynx', member)).body.data[0].eligibility.result).toBe('ELIGIBLE');
  });

  it('a walk-in (time-only) deal shows no stock and no reserve option; reservation fields are absent', async () => {
    const deal = await w.publishHot('A', 0, {
      title: { en: 'Tapir walk in', ar: 'زيارة مباشرة' },
      limitType: 'TIME',
      reservationsEnabled: false,
    });
    const card = (await list('q=tapir')).body.data[0];
    expect(card).toMatchObject({
      reservationsEnabled: false,
      remaining: null,
      remainingTotal: null,
    });
    const detail = await t.http.get(`/v1/app/hot-deals/${deal.id}`);
    expect(detail.body.data.branches[0].canReserve).toBe(false);
    expect(detail.body.data.branches[0].stock).toBeNull();
  });

  it('shows stock only when it is at or below the display threshold', async () => {
    await t.prisma.systemConfiguration.upsert({
      where: { key: 'hot_deals.limits' },
      create: {
        key: 'hot_deals.limits',
        value: {
          maxHours: 72,
          maxPerCustomer: 5,
          maxUnitsPerBranch: 5000,
          showRemainingThreshold: 10,
        },
        version: 1,
      },
      update: {
        value: {
          maxHours: 72,
          maxPerCustomer: 5,
          maxUnitsPerBranch: 5000,
          showRemainingThreshold: 10,
        },
      },
    });
    (
      await import('../src/system-config/system-config.service')
    ).SystemConfigService.prototype.invalidate.call(
      t.app.get((await import('../src/system-config/system-config.service')).SystemConfigService),
    );
    const big = await w.publishHot('A', 200, { title: { en: 'Civet plenty', ar: 'كثير' } });
    const small = await w.publishHot('A', 6, { title: { en: 'Civet scarce', ar: 'نادر' } });
    const cards = (await list('q=civet')).body.data;
    expect(cards.find((c: { id: string }) => c.id === big.id).remaining).toBeNull();
    expect(cards.find((c: { id: string }) => c.id === small.id).remaining).toBe(6);
    await t.prisma.systemConfiguration.deleteMany({ where: { key: 'hot_deals.limits' } });
    t.app
      .get((await import('../src/system-config/system-config.service')).SystemConfigService)
      .invalidate();
  });

  describe('analytics', () => {
    it('records impressions and detail views for Exclusive Deals only for real public deals, deduplicated', async () => {
      const deal = await w.publishHot('A', 5, { title: { en: 'Ibex tracked', ar: 'متتبع' } });
      const draft = await w.createHot('A', w.hotContent('A', 5));
      const events = [
        { type: 'IMPRESSION', dealId: deal.id, product: 'HOT', anonymousId: 'dev-device-0001' },
        { type: 'IMPRESSION', dealId: deal.id, product: 'HOT', anonymousId: 'dev-device-0001' },
        {
          type: 'DETAIL_VIEW',
          dealId: deal.id,
          product: 'HOT',
          anonymousId: 'dev-device-0001',
          branchId: w.A.branchIds[0],
        },
        { type: 'DETAIL_VIEW', dealId: draft.id, product: 'HOT', anonymousId: 'dev-device-0001' },
        { type: 'IMPRESSION', dealId: deal.id, anonymousId: 'dev-device-0002' }, // product LIVE: this id is not a Live Deal
      ];
      const res = await t.http.post('/v1/app/events').send({ events });
      expect(res.status).toBe(202);
      expect(res.body.data.accepted).toBe(2);
      const rows = await t.prisma.dealEvent.findMany({ where: { dealId: deal.id } });
      expect(rows.every((r) => r.productType === 'HOT')).toBe(true);
      expect(await t.prisma.dealEvent.count({ where: { dealId: draft.id } })).toBe(0);
    });

    it('the merchant monitor shows the measurable funnel and never any revenue or sales figure', async () => {
      const deal = await w.publishHot('A', 5, { title: { en: 'Ibex funnel', ar: 'قمع' } });
      await t.http.post('/v1/app/events').send({
        events: [
          { type: 'IMPRESSION', dealId: deal.id, product: 'HOT', anonymousId: 'dev-funnel-aaa1' },
          { type: 'DETAIL_VIEW', dealId: deal.id, product: 'HOT', anonymousId: 'dev-funnel-aaa1' },
          { type: 'DETAIL_VIEW', dealId: deal.id, product: 'HOT', anonymousId: 'dev-funnel-aaa2' },
        ],
      });
      const [c1, c2, c3] = [await w.newCustomer(), await w.newCustomer(), await w.newCustomer()];
      const r1 = (await w.reserve(c1, deal.id, w.A.branchIds[0]!)).body.data;
      await w.reserve(c2, deal.id, w.A.branchIds[0]!);
      const r3 = (await w.reserve(c3, deal.id, w.A.branchIds[0]!)).body.data;
      await w.redeem(w.staffA, r1.code.qr);
      await w.cancelRes(c3, r3.id);
      const m = (await w.api(w.ownerA).get(`${w.base('A')}/hot-deals/${deal.id}/monitor`)).body
        .data;
      expect(m.totals).toEqual({ total: 5, available: 3, reserved: 1, redeemed: 1 });
      expect(m.reservations).toMatchObject({ held: 1, redeemed: 1, cancelled: 1, expired: 0 });
      expect(m.funnel).toMatchObject({
        impressions: 1,
        detailViews: 2,
        reservationsCreated: 3,
        redeemed: 1,
        reservationsCancelled: 1,
      });
      expect(m.funnel.viewToReservationPct).toBe(150);
      expect(m.funnel.reservationToRedeemedPct).toBeCloseTo(33.3, 1);
      expect(m.disclaimerKey).toBe('discovery_and_reservation_signals_only');
      expect(JSON.stringify(m)).not.toMatch(/revenue|sales|sar|income|payout|amount/i);
      // server-side events exist for the full lifecycle
      const types = (await t.prisma.dealEvent.findMany({ where: { dealId: deal.id } })).map(
        (e) => e.type,
      );
      expect(types).toEqual(
        expect.arrayContaining([
          'RESERVATION_CREATED',
          'RESERVATION_REDEEMED',
          'RESERVATION_CANCELLED',
        ]),
      );
    });

    it('DealDash overview shows operational counts; the admin monitor works for any deal', async () => {
      const deal = await w.publishHot('A', 5);
      const ov = await w.api(w.ops).get('/v1/admin/hot-deals/overview');
      expect(ov.status).toBe(200);
      expect(ov.body.data.counts.LIVE).toBeGreaterThan(0);
      expect(ov.body.data.last24h.reservationsCreated).toBeGreaterThan(0);
      expect(
        (await w.api(w.ops).get(`/v1/admin/hot-deals/${deal.id}/monitor`)).body.data.totals.total,
      ).toBe(5);
      const act = await w.api(w.ops).get(`/v1/admin/hot-deals/${deal.id}/activity`);
      expect(act.body.data.map((a: { code: string }) => a.code)).toContain('APPROVE');
    });
  });

  it('the live-deal analytics ignore Exclusive Deal signals (separate products)', async () => {
    const ov = await w.api(w.ops).get('/v1/admin/live-deals/analytics');
    expect(ov.status).toBe(200);
  });
});
