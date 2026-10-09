import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HotLifecycleService } from '../src/hot-deals/hot-lifecycle.service';
import { ReservationsService } from '../src/hot-deals/reservations.service';
import { DB_READY, createTestApp, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

const stock = async (t: TestApp, dealId: string, branchId: string) =>
  t.prisma.hotDealInventory.findUniqueOrThrow({ where: { dealId_branchId: { dealId, branchId } } });

/** Free reservations, per-branch inventory, expiry, no-show strikes and the real concurrency proof. */
describe.skipIf(!DB_READY)('Reservations and inventory', () => {
  let t: TestApp;
  let w: HotWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
  });
  afterAll(() => t?.close());

  it('reserves for free: confirmed immediately, 30 minute default hold, opaque code and QR, no payment fields', async () => {
    const deal = await w.publishHot('A', 5);
    const c = await w.newCustomer();
    const res = await w.reserve(c, deal.id, w.A.branchIds[0]!);
    expect(res.status).toBe(201);
    const r = res.body.data;
    expect(r.status).toBe('HELD');
    expect(r.displayState).toBe('HELD');
    expect(r.holdMinutes).toBe(30);
    expect(new Date(r.expiresAt).getTime() - new Date(r.createdAt).getTime()).toBe(30 * 60_000);
    expect(r.code.qr).toMatch(/^DD1\.[A-Za-z0-9_-]{22}$/);
    expect(r.code.manual).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(r.publicRef).toMatch(/^DD-[A-Z2-9]{6}$/);
    expect(JSON.stringify(r)).not.toMatch(/deposit|payment|price|SAR/i);
    // codes are not derived from the reservation id
    expect(r.code.qr).not.toContain(r.id);
    expect(r.code.manual.replace('-', '')).not.toBe(r.id.slice(0, 8).toUpperCase());
    const inv = await stock(t, deal.id, w.A.branchIds[0]!);
    expect([inv.total, inv.available, inv.reserved, inv.redeemed]).toEqual([5, 4, 1, 0]);
    const events = await t.prisma.reservationEvent.findMany({ where: { reservationId: r.id } });
    expect(events.map((e) => e.type)).toEqual(['CREATED']);
    const inbox = await w.api(c).get('/v1/app/notifications');
    expect(inbox.body.data.items[0].type).toBe('RESERVATION_CONFIRMED');
  });

  it('uses the deal-specific hold when set and the configured default otherwise', async () => {
    const deal = await w.publishHot('A', 5, { holdMinutes: 45 });
    const c = await w.newCustomer();
    expect((await w.reserve(c, deal.id, w.A.branchIds[0]!)).body.data.holdMinutes).toBe(45);
  });

  it('requires a signed-in customer; guests and other audiences cannot reserve', async () => {
    const deal = await w.publishHot('A', 5);
    const guest = await t.http
      .post(`/v1/app/hot-deals/${deal.id}/reservations`)
      .set('Idempotency-Key', 'guest-key-0001')
      .send({ branchId: w.A.branchIds[0], quantity: 1 });
    expect(guest.status).toBe(401);
    expect([401, 403]).toContain((await w.reserve(w.ownerA, deal.id, w.A.branchIds[0]!)).status); // a merchant session is not a customer
  });

  it('enforces the per-customer limit and counts used units', async () => {
    const deal = await w.publishHot('A', 5, { perCustomerLimit: 2 });
    const c = await w.newCustomer();
    expect((await w.reserve(c, deal.id, w.A.branchIds[0]!)).status).toBe(201);
    expect((await w.reserve(c, deal.id, w.A.branchIds[0]!)).status).toBe(201);
    const third = await w.reserve(c, deal.id, w.A.branchIds[0]!);
    expect(third.status).toBe(409);
    expect(third.body.errors[0].code).toBe('LIMIT_REACHED');
    const one = await w.publishHot('A', 5);
    const d = await w.newCustomer();
    expect((await w.reserve(d, one.id, w.A.branchIds[0]!)).status).toBe(201);
    expect((await w.reserve(d, one.id, w.A.branchIds[0]!)).body.errors[0].code).toBe(
      'LIMIT_REACHED',
    );
  });

  it('limits how many reservations one customer holds at once (configurable, default 3)', async () => {
    const c = await w.newCustomer();
    for (let i = 0; i < 3; i++) {
      const deal = await w.publishHot('A', 5);
      expect((await w.reserve(c, deal.id, w.A.branchIds[0]!)).status).toBe(201);
    }
    const extra = await w.publishHot('A', 5);
    const res = await w.reserve(c, extra.id, w.A.branchIds[0]!);
    expect(res.status).toBe(409);
    expect(res.body.errors[0].code).toBe('TOO_MANY_ACTIVE');
  });

  it('is idempotent: a retried request with the same key returns the same reservation', async () => {
    const deal = await w.publishHot('A', 5);
    const c = await w.newCustomer();
    const send = () =>
      w
        .api(c)
        .post(`/v1/app/hot-deals/${deal.id}/reservations`)
        .set('Idempotency-Key', 'retry-key-123456')
        .send({ branchId: w.A.branchIds[0], quantity: 1 });
    const a = await send();
    const b = await send();
    expect(b.body.data.id).toBe(a.body.data.id);
    expect((await stock(t, deal.id, w.A.branchIds[0]!)).reserved).toBe(1);
  });

  it('refuses branches that are not part of the deal, closed branches and walk-in deals', async () => {
    const deal = await w.publishHot('A', 5);
    const c = await w.newCustomer();
    expect((await w.reserve(c, deal.id, w.A.branchIds[1]!)).status).toBe(404);
    expect((await w.reserve(c, deal.id, w.B.branchIds[0]!)).status).toBe(404);
    const walkIn = await w.publishHot('A', 0, { limitType: 'TIME', reservationsEnabled: false });
    const r = await w.reserve(c, walkIn.id, w.A.branchIds[0]!);
    expect(r.status).toBe(409);
    expect(r.body.errors[0].code).toBe('OFFER_UNAVAILABLE');
    await t.prisma.merchantBranch.update({
      where: { id: w.A.branchIds[0]! },
      data: { status: 'CLOSED' },
    });
    try {
      const closed = await w.reserve(await w.newCustomer(), deal.id, w.A.branchIds[0]!);
      expect(closed.status).toBe(409);
      expect(closed.body.errors[0].code).toBe('BRANCH_CLOSED');
    } finally {
      await t.prisma.merchantBranch.update({
        where: { id: w.A.branchIds[0]! },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('applies eligibility at the moment of reserving, not only when the card was shown', async () => {
    const deal = await w.publishHot('A', 5, {
      eligibility: { kind: 'EMPLOYER', valueRefs: [w.employer] },
    });
    const c = await w.newCustomer();
    const res = await w.reserve(c, deal.id, w.A.branchIds[0]!);
    expect(res.status).toBe(403);
    expect(res.body.errors[0].code).toBe('NOT_ELIGIBLE');
    await t.prisma.eligibilityAttribute.create({
      data: {
        userId: c.me.id,
        attrType: 'EMPLOYER',
        valueRef: w.employer,
        level: 'OTP_VERIFIED',
        status: 'VERIFIED',
      },
    });
    expect((await w.reserve(c, deal.id, w.A.branchIds[0]!)).status).toBe(201);
  });

  describe('cancel and release', () => {
    it('returns the unit, lets the customer reserve again, and does not count as a no-show', async () => {
      const deal = await w.publishHot('A', 1);
      const c = await w.newCustomer();
      const r = (await w.reserve(c, deal.id, w.A.branchIds[0]!)).body.data;
      expect((await t.prisma.hotDeal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe(
        'SOLD_OUT',
      );
      const cancelled = await w.cancelRes(c, r.id);
      expect(cancelled.body.data.status).toBe('CANCELLED');
      expect(cancelled.body.data.displayState).toBe('CANCELLED_BY_YOU');
      expect(cancelled.body.data.code).toBeNull();
      const inv = await stock(t, deal.id, w.A.branchIds[0]!);
      expect([inv.available, inv.reserved, inv.released]).toEqual([1, 0, 1]);
      expect((await t.prisma.hotDeal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe(
        'LIVE',
      );
      expect(
        (await t.prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).noShowCounted,
      ).toBe(false);
      expect((await w.reserve(c, deal.id, w.A.branchIds[0]!)).status).toBe(201);
    });

    it('cancelling twice or cancelling someone else’s reservation fails safely', async () => {
      const deal = await w.publishHot('A', 3);
      const c = await w.newCustomer();
      const other = await w.newCustomer();
      const r = (await w.reserve(c, deal.id, w.A.branchIds[0]!)).body.data;
      expect((await w.cancelRes(other, r.id)).status).toBe(404);
      expect((await w.api(other).get(`/v1/app/reservations/${r.id}`)).status).toBe(404);
      expect((await w.cancelRes(c, r.id)).status).toBe(200);
      const again = await w.cancelRes(c, r.id);
      expect(again.status).toBe(409);
      expect(again.body.errors[0].code).toBe('RESERVATION_NOT_CANCELLABLE');
      expect((await stock(t, deal.id, w.A.branchIds[0]!)).available).toBe(3);
    });

    it('the merchant can cancel a reservation (customer notified); campaign cancel releases everything', async () => {
      const deal = await w.publishHot('A', 4);
      const a = await w.newCustomer();
      const b = await w.newCustomer();
      const ra = (await w.reserve(a, deal.id, w.A.branchIds[0]!)).body.data;
      await w.reserve(b, deal.id, w.A.branchIds[0]!);
      const mc = await w
        .api(w.campaignsA)
        .post(`${w.base('A')}/reservations/${ra.id}/cancel`)
        .send({ reason: 'Branch closed early' });
      expect(mc.body.data.displayState).toBe('CANCELLED_BY_MERCHANT');
      expect(
        (await w.api(a).get('/v1/app/notifications')).body.data.items.map(
          (i: { type: string }) => i.type,
        ),
      ).toContain('RESERVATION_CANCELLED');
      // finance cannot
      expect(
        (
          await w
            .api(w.financeA)
            .post(`${w.base('A')}/reservations/${ra.id}/cancel`)
            .send({ reason: 'x y z' })
        ).status,
      ).toBe(403);
      const end = await w
        .api(w.ownerA)
        .post(`${w.base('A')}/hot-deals/${deal.id}/cancel`)
        .send({ reason: 'Ran out of ingredients' });
      expect(end.body.data.status).toBe('CANCELLED');
      expect(await t.prisma.reservation.count({ where: { dealId: deal.id, status: 'HELD' } })).toBe(
        0,
      );
      const inv = await stock(t, deal.id, w.A.branchIds[0]!);
      expect([inv.available, inv.reserved]).toEqual([4, 0]);
    });
  });

  describe('expiry and the no-show foundation', () => {
    it('expires an elapsed hold: units return, state is "not completed", neutral notice, strike recorded', async () => {
      const deal = await w.publishHot('A', 2);
      const c = await w.newCustomer();
      const r = (await w.reserve(c, deal.id, w.A.branchIds[0]!)).body.data;
      const later = new Date(Date.now() + 31 * 60_000);
      const out = await t.app.get(HotLifecycleService).sweep(later);
      expect(out.expired).toBeGreaterThanOrEqual(1);
      const row = await t.prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
      expect(row.status).toBe('EXPIRED');
      expect(row.noShowCounted).toBe(true);
      const mine = await w.api(c).get(`/v1/app/reservations/${r.id}`);
      expect(mine.body.data.displayState).toBe('NOT_COMPLETED');
      expect(mine.body.data.code).toBeNull();
      const inv = await stock(t, deal.id, w.A.branchIds[0]!);
      expect([inv.available, inv.reserved, inv.released]).toEqual([2, 0, 1]);
      const types = (await w.api(c).get('/v1/app/notifications')).body.data.items.map(
        (i: { type: string }) => i.type,
      );
      expect(types).toContain('RESERVATION_EXPIRED');
      const events = (
        await t.prisma.reservationEvent.findMany({ where: { reservationId: r.id } })
      ).map((e) => e.type);
      expect(events).toEqual(expect.arrayContaining(['CREATED', 'EXPIRED', 'NO_SHOW_COUNTED']));
      // sweeping again changes nothing (idempotent)
      await t.app.get(HotLifecycleService).sweep(later);
      expect((await stock(t, deal.id, w.A.branchIds[0]!)).available).toBe(2);
    });

    it('sends one "expiring soon" notice, only once', async () => {
      const deal = await w.publishHot('A', 2);
      const c = await w.newCustomer();
      await w.reserve(c, deal.id, w.A.branchIds[0]!);
      const soon = new Date(Date.now() + 22 * 60_000); // 8 minutes left of 30
      await t.app.get(HotLifecycleService).sweep(soon);
      await t.app.get(HotLifecycleService).sweep(new Date(soon.getTime() + 60_000));
      const items = (await w.api(c).get('/v1/app/notifications')).body.data.items.filter(
        (i: { type: string }) => i.type === 'RESERVATION_EXPIRING',
      );
      expect(items).toHaveLength(1);
    });

    it('frees an overdue hold on demand so the next customer is not blocked by a late sweep', async () => {
      const deal = await w.publishHot('A', 1);
      const a = await w.newCustomer();
      const r = (await w.reserve(a, deal.id, w.A.branchIds[0]!)).body.data;
      await t.prisma.reservation.update({
        where: { id: r.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const b = await w.newCustomer();
      expect((await w.reserve(b, deal.id, w.A.branchIds[0]!)).status).toBe(201);
      expect((await t.prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
        'EXPIRED',
      );
    });

    it('applies a TEMPORARY restriction after 3 confirmed no-shows, never a ban; Operations can review and lift it', async () => {
      const c = await w.newCustomer();
      const userId = c.me.id as string;
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const deal = await w.publishHot('A', 2);
        ids.push((await w.reserve(c, deal.id, w.A.branchIds[0]!)).body.data.id);
        await t.app.get(HotLifecycleService).sweep(new Date(Date.now() + 31 * 60_000));
        // push the previous holds out of the way so the next reservation is allowed
      }
      const restriction = await t.prisma.customerRestriction.findFirst({
        where: { userId, status: 'ACTIVE' },
      });
      expect(restriction).not.toBeNull();
      expect(restriction!.strikes).toBe(3);
      const days = (restriction!.endsAt.getTime() - restriction!.startsAt.getTime()) / 86_400_000;
      expect(days).toBeLessThanOrEqual(30); // temporary
      const deal = await w.publishHot('A', 2);
      const blocked = await w.reserve(c, deal.id, w.A.branchIds[0]!);
      expect(blocked.status).toBe(403);
      expect(blocked.body.errors[0].code).toBe('RESERVATIONS_PAUSED');
      expect(JSON.stringify(blocked.body)).not.toMatch(/ban|penalt|blacklist/i);
      // the customer still sees offers, with the restriction explained on the detail
      const detail = await w.api(c).get(`/v1/app/hot-deals/${deal.id}`);
      expect(detail.body.data.restriction.endsAt).toBeTruthy();
      // admin review
      expect((await w.api(w.analyst).get('/v1/admin/reservations/restrictions')).status).toBe(403);
      const list = await w.api(w.support).get('/v1/admin/reservations/restrictions?status=ACTIVE');
      expect(
        list.body.data.some(
          (x: { id: string; strikes: number }) => x.id === restriction!.id && x.strikes === 3,
        ),
      ).toBe(true);
      expect(
        (
          await w
            .api(w.support)
            .post(`/v1/admin/reservations/restrictions/${restriction!.id}/lift`)
            .send({ reason: 'Customer called support' })
        ).status,
      ).toBe(200);
      expect((await w.reserve(c, deal.id, w.A.branchIds[0]!)).status).toBe(201);
      void ids;
    });

    it('cancelling does not build strikes', async () => {
      const c = await w.newCustomer();
      for (let i = 0; i < 4; i++) {
        const deal = await w.publishHot('A', 2);
        const r = (await w.reserve(c, deal.id, w.A.branchIds[0]!)).body.data;
        await w.cancelRes(c, r.id);
      }
      await t.app.get(ReservationsService).applyStrikes(c.me.id);
      expect(await t.prisma.customerRestriction.count({ where: { userId: c.me.id } })).toBe(0);
    });
  });

  describe('concurrency (real parallel requests against PostgreSQL)', () => {
    it('inventory = 1, two customers at the same instant: exactly one succeeds and stock never goes negative', async () => {
      const deal = await w.publishHot('A', 1);
      const [a, b] = [await w.newCustomer(), await w.newCustomer()];
      const [ra, rb] = await Promise.all([
        w.reserve(a, deal.id, w.A.branchIds[0]!),
        w.reserve(b, deal.id, w.A.branchIds[0]!),
      ]);
      const statuses = [ra.status, rb.status].sort();
      expect(statuses).toEqual([201, 409]);
      const loser = ra.status === 409 ? ra : rb;
      expect(loser.body.errors[0].code).toBe('OUT_OF_STOCK');
      const inv = await stock(t, deal.id, w.A.branchIds[0]!);
      expect([inv.total, inv.available, inv.reserved, inv.redeemed]).toEqual([1, 0, 1, 0]);
      expect(await t.prisma.reservation.count({ where: { dealId: deal.id, status: 'HELD' } })).toBe(
        1,
      );
      expect((await t.prisma.hotDeal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe(
        'SOLD_OUT',
      );
    });

    it('20 customers race for 5 units: exactly 5 reservations, 15 refusals, balanced stock', async () => {
      const deal = await w.publishHot('A', 5);
      const customers = await Promise.all(Array.from({ length: 20 }, () => w.newCustomer()));
      const results = await Promise.all(
        customers.map((c) => w.reserve(c, deal.id, w.A.branchIds[0]!)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(results.filter((r) => r.status === 409)).toHaveLength(15);
      const inv = await stock(t, deal.id, w.A.branchIds[0]!);
      expect([inv.available, inv.reserved]).toEqual([0, 5]);
      expect(await t.prisma.reservation.count({ where: { dealId: deal.id } })).toBe(5);
    });

    it('the same customer double-tapping with different keys still gets only one reservation', async () => {
      const deal = await w.publishHot('A', 5);
      const c = await w.newCustomer();
      const results = await Promise.all(
        [1, 2, 3].map(() => w.reserve(c, deal.id, w.A.branchIds[0]!)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(
        await t.prisma.reservation.count({ where: { dealId: deal.id, userId: c.me.id } }),
      ).toBe(1);
      expect((await stock(t, deal.id, w.A.branchIds[0]!)).reserved).toBe(1);
    });

    it('cancel racing with expiry releases the unit exactly once', async () => {
      const deal = await w.publishHot('A', 2);
      const c = await w.newCustomer();
      const r = (await w.reserve(c, deal.id, w.A.branchIds[0]!)).body.data;
      await t.prisma.reservation.update({
        where: { id: r.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await Promise.allSettled([
        t.app.get(HotLifecycleService).sweep(new Date()),
        t.app.get(ReservationsService).cancel(r.id, 'MERCHANT', null, {}, 'race', null),
      ]);
      const inv = await stock(t, deal.id, w.A.branchIds[0]!);
      expect([inv.available, inv.reserved]).toEqual([2, 0]);
      expect(inv.released).toBe(1);
    });

    it('removing stock cannot dip below committed units even when racing with reservations', async () => {
      const deal = await w.publishHot('A', 4);
      const customers = await Promise.all(Array.from({ length: 4 }, () => w.newCustomer()));
      await Promise.all([
        ...customers.map((c) => w.reserve(c, deal.id, w.A.branchIds[0]!)),
        w
          .api(w.ownerA)
          .post(`${w.base('A')}/hot-deals/${deal.id}/stock`)
          .send({ branchId: w.A.branchIds[0], delta: -4 }),
      ]);
      const inv = await stock(t, deal.id, w.A.branchIds[0]!);
      expect(inv.total).toBe(inv.available + inv.reserved + inv.redeemed);
      expect(inv.available).toBeGreaterThanOrEqual(0);
      expect(inv.reserved).toBe(
        await t.prisma.reservation.count({ where: { dealId: deal.id, status: 'HELD' } }),
      );
    });
  });

  describe('privacy and visibility', () => {
    it('hides other customers’ details from the public detail and merchant lists show first names only', async () => {
      const deal = await w.publishHot('A', 3);
      const c = await w.newCustomer();
      await w.reserve(c, deal.id, w.A.branchIds[0]!);
      const pub = await t.http.get(`/v1/app/hot-deals/${deal.id}`);
      expect(pub.status).toBe(200);
      expect(JSON.stringify(pub.body)).not.toMatch(/qrToken|manualCode|userId|"mobile"/);
      expect(pub.body.data.remainingForMe).toBeNull();
      const list = await w
        .api(w.campaignsA)
        .get(`${w.base('A')}/hot-deals/${deal.id}/reservations`);
      expect(list.status).toBe(200);
      const row = list.body.data[0];
      expect(Object.keys(row)).not.toContain('qrToken');
      expect(row.codeLast4).toHaveLength(4);
      expect(JSON.stringify(list.body)).not.toMatch(/"mobile"|"email"|DD1\./);
    });
  });
});
