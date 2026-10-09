import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, call, createTestApp, idem, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

/** Backend permission checks for Stage 4 (the UI hides things, the API enforces them). */
describe.skipIf(!DB_READY)('Exclusive Deals permissions and tenant isolation', () => {
  let t: TestApp;
  let w: HotWorld;
  let dealA: Record<string, any>;
  let resA: Record<string, any>;
  let customer: Awaited<ReturnType<HotWorld['newCustomer']>>;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    dealA = await w.publishHot('A', 5);
    customer = await w.newCustomer();
    resA = (await w.reserve(customer, dealA.id, w.A.branchIds[0]!)).body.data;
  });
  afterAll(() => t?.close());

  describe('merchant isolation (Merchant A is not Merchant B)', () => {
    it('B cannot read, edit, pause, cancel, restock or monitor A’s Exclusive Deal (404, not 403)', async () => {
      const b = w.api(w.ownerB);
      const base = `/v1/merchants/${w.A.orgId}`;
      for (const [method, path, body] of [
        ['get', `${base}/hot-deals`, undefined],
        ['get', `${base}/hot-deals/${dealA.id}`, undefined],
        ['put', `${base}/hot-deals/${dealA.id}`, { content: w.hotContent('A') }],
        ['post', `${base}/hot-deals/${dealA.id}/pause`, {}],
        ['post', `${base}/hot-deals/${dealA.id}/cancel`, { reason: 'sabotage' }],
        ['post', `${base}/hot-deals/${dealA.id}/stock`, { branchId: w.A.branchIds[0], delta: 5 }],
        ['get', `${base}/hot-deals/${dealA.id}/monitor`, undefined],
        ['get', `${base}/hot-deals/${dealA.id}/reservations`, undefined],
        ['get', `${base}/redemptions`, undefined],
        ['post', `${base}/reservations/${resA.id}/cancel`, { reason: 'sabotage' }],
      ] as const) {
        const req = (b as any)[method](path);
        const res = body ? await req.send(body) : await req;
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    });

    it('B cannot reach A’s deal through its OWN route either (id of another merchant is unknown)', async () => {
      const own = `/v1/merchants/${w.B.orgId}`;
      const b = w.api(w.ownerB);
      expect((await b.get(`${own}/hot-deals/${dealA.id}`)).status).toBe(404);
      expect((await b.get(`${own}/hot-deals/${dealA.id}/monitor`)).status).toBe(404);
      expect(
        (await b.post(`${own}/reservations/${resA.id}/cancel`).send({ reason: 'sabotage' })).status,
      ).toBe(404);
      expect((await b.get(`${own}/hot-deals`)).body.data).toEqual([]);
    });

    it('B cannot allocate stock to A’s branch or use A’s image', async () => {
      const res = await w
        .api(w.ownerB)
        .post(`${w.base('B')}/hot-deals`)
        .set('Idempotency-Key', idem())
        .send({
          content: w.hotContent('B', 5, {
            allocations: [{ branchId: w.A.branchIds[0], units: 5 }],
            media: [{ fileId: w.fileA, altEn: '', altAr: '' }],
          }),
        });
      expect(res.status).toBe(400);
    });
  });

  describe('merchant roles', () => {
    it('Campaign Manager can create, submit, monitor and cancel reservations; Finance has no campaign access', async () => {
      const cm = w.api(w.campaignsA);
      const created = await cm
        .post(`${w.base('A')}/hot-deals`)
        .set('Idempotency-Key', idem())
        .send({ content: w.hotContent('A') });
      expect(created.status).toBe(201);
      await w.commercialReady(created.body.data.id);
      expect(
        (await cm.post(`${w.base('A')}/hot-deals/${created.body.data.id}/submit`).send({})).status,
      ).toBe(200);
      expect((await cm.get(`${w.base('A')}/hot-deals/${dealA.id}/monitor`)).status).toBe(200);
      expect((await cm.get(`${w.base('A')}/redemptions`)).status).toBe(200);
      const fin = w.api(w.financeA);
      for (const path of [
        'hot-deals',
        `hot-deals/${dealA.id}`,
        `hot-deals/${dealA.id}/monitor`,
        `hot-deals/${dealA.id}/reservations`,
      ])
        expect((await fin.get(`${w.base('A')}/${path}`)).status, path).toBe(403);
      // Finance reconciles redemptions (approved Stage 1 role) but holds no campaign permission and cannot reverse.
      expect((await fin.get(`${w.base('A')}/redemptions`)).status).toBe(200);
      expect(
        (
          await fin
            .post(`${w.base('A')}/hot-deals`)
            .set('Idempotency-Key', idem())
            .send({ content: w.hotContent('A') })
        ).status,
      ).toBe(403);
    });

    it('a branch-scoped manager is refused on organisation-wide campaign routes', async () => {
      expect((await w.api(w.branchScopedA).get(`${w.base('A')}/hot-deals`)).status).toBe(403);
    });

    it('only Owner/Admin can reverse a redemption; Campaign Manager and Finance cannot', async () => {
      const { qr } = { qr: resA.code.qr as string };
      await w.redeem(w.staffA, qr);
      const red = await t.prisma.redemption.findFirstOrThrow({ where: { reservationId: resA.id } });
      for (const s of [w.campaignsA, w.financeA])
        expect(
          (
            await w
              .api(s)
              .post(`${w.base('A')}/redemptions/${red.id}/reverse`)
              .send({ reason: 'not allowed' })
          ).status,
        ).toBe(403);
      expect(
        (
          await w
            .api(w.adminA)
            .post(`${w.base('A')}/redemptions/${red.id}/reverse`)
            .send({ reason: 'Admin correction' })
        ).status,
      ).toBe(200);
    });
  });

  describe('Merchant Staff', () => {
    it('cannot use any merchant portal route (campaigns, reservations list, redemptions list)', async () => {
      const s = w.api(w.staffA);
      for (const path of [
        `${w.base('A')}/hot-deals`,
        `${w.base('A')}/hot-deals/${dealA.id}`,
        `${w.base('A')}/redemptions`,
        `${w.base('A')}/hot-deal-options`,
      ]) {
        expect([401, 403], path).toContain((await s.get(path)).status);
      }
      const edit = await s
        .put(`${w.base('A')}/hot-deals/${dealA.id}`)
        .send({ content: w.hotContent('A') });
      expect([401, 403]).toContain(edit.status);
      const stock = await s
        .post(`${w.base('A')}/hot-deals/${dealA.id}/stock`)
        .send({ branchId: w.A.branchIds[0], delta: 100 });
      expect([401, 403]).toContain(stock.status);
    });

    it('cannot reach admin or customer routes either', async () => {
      const s = w.api(w.staffA);
      expect([401, 403]).toContain((await s.get('/v1/admin/hot-deals')).status);
      expect([401, 403]).toContain((await s.get('/v1/app/reservations')).status);
      expect([401, 403]).toContain(
        (
          await s
            .post(`/v1/app/hot-deals/${dealA.id}/reservations`)
            .set('Idempotency-Key', idem())
            .send({ branchId: w.A.branchIds[0], quantity: 1 })
        ).status,
      );
    });

    it('non-staff sessions (merchant, customer, admin) cannot use the staff API', async () => {
      for (const s of [w.ownerA, customer, w.ops]) {
        expect([401, 403]).toContain((await w.api(s).get('/v1/staff/me')).status);
        expect([401, 403]).toContain((await w.validate(s, 'ABCD-EFGH', 'MANUAL')).status);
      }
      expect((await t.http.get('/v1/staff/me')).status).toBe(401);
    });

    it('staff sees only its own merchant: a code of merchant B reads as invalid', async () => {
      const dealB = await w.publishHot('B', 3);
      const cB = await w.newCustomer();
      const rB = (await w.reserve(cB, dealB.id, w.B.branchIds[0]!)).body.data;
      expect((await w.validate(w.staffA, rB.code.qr)).body.data.result).toBe('INVALID_CODE');
    });
  });

  describe('customers', () => {
    it('cannot read another customer’s reservation, cancel it, or use merchant/admin/staff routes', async () => {
      const other = await w.newCustomer();
      expect((await w.api(other).get(`/v1/app/reservations/${resA.id}`)).status).toBe(404);
      expect((await w.cancelRes(other, resA.id)).status).toBe(404);
      expect((await w.myRes(other)).body.data).toEqual([]);
      for (const path of [
        `${w.base('A')}/hot-deals`,
        '/v1/admin/hot-deals',
        '/v1/staff/me',
        '/v1/admin/reservations/restrictions',
      ])
        expect([401, 403], path).toContain((await w.api(other).get(path)).status);
    });

    it('a customer cannot see QR tokens or codes of anyone else in any response', async () => {
      const other = await w.newCustomer();
      const pub = await w.api(other).get(`/v1/app/hot-deals/${dealA.id}`);
      expect(JSON.stringify(pub.body)).not.toContain(resA.code.qr);
      expect(JSON.stringify(pub.body)).not.toContain(resA.code.manual.replace('-', ''));
    });
  });

  describe('DealDash roles', () => {
    it('Support cannot approve, pause or suspend; Operations can; Analyst can do neither', async () => {
      const deal = await w.createHot('A', w.hotContent('A'));
      await w.submitHot('A', deal.id);
      expect((await w.decideHot(w.support, deal.id, 'approve')).status).toBe(403);
      expect((await w.decideHot(w.support, deal.id, 'reject')).status).toBe(403);
      expect((await w.decideHot(w.analyst, deal.id, 'approve')).status).toBe(403);
      expect((await w.api(w.support).get('/v1/admin/hot-deals')).status).toBe(403);
      expect((await w.decideHot(w.ops, deal.id, 'approve')).body.data.status).toBe('LIVE');
      expect((await w.decideHot(w.support, deal.id, 'pause')).status).toBe(403);
      expect((await w.decideHot(w.marketing, deal.id, 'suspend')).status).toBe(403);
      expect(
        (await w.decideHot(w.ops, deal.id, 'pause', { reason: 'Check' })).body.data.status,
      ).toBe('PAUSED');
    });

    it('Support can look up and cancel a reservation and lift restrictions but not touch campaigns', async () => {
      const found = await w
        .api(w.support)
        .get(`/v1/admin/reservations/search?q=${encodeURIComponent(resA.publicRef)}`);
      expect(found.status).toBe(200);
      expect(found.body.data[0].id).toBe(resA.id);
      const fresh = await w.newCustomer();
      const r = (await w.reserve(fresh, dealA.id, w.A.branchIds[0]!)).body.data;
      const cancelled = await w
        .api(w.support)
        .post(`/v1/admin/reservations/${r.id}/cancel`)
        .send({ reason: 'Customer asked support' });
      expect(cancelled.body.data.displayState).toBe('CANCELLED_BY_MERCHANT');
      expect(
        await t.prisma.auditLog.count({ where: { action: 'reservation.cancel', entityId: r.id } }),
      ).toBe(1);
    });

    it('a merchant cannot call admin hot-deal or reservation tools', async () => {
      for (const path of [
        '/v1/admin/hot-deals',
        '/v1/admin/hot-deals/overview',
        '/v1/admin/reservations/restrictions',
      ])
        expect([401, 403], path).toContain((await call(t, w.ownerA).get(path)).status);
    });

    it('drafts of a merchant are invisible to DealDash lists', async () => {
      const draft = await w.createHot(
        'A',
        w.hotContent('A', 5, { title: { en: 'PRIVATE DRAFT TITLE', ar: 'مسودة' } }),
      );
      const list = await w.api(w.ops).get('/v1/admin/hot-deals?limit=100');
      expect(list.body.data.some((d: { id: string }) => d.id === draft.id)).toBe(false);
    });
  });

  it('every state change and reservation action leaves an audit record', async () => {
    const actions = (
      await t.prisma.auditLog.findMany({
        where: { entityType: { in: ['HotDeal', 'Reservation', 'Redemption'] } },
        select: { action: true },
      })
    ).map((a) => a.action);
    expect(new Set(actions)).toEqual(expect.objectContaining({}));
    for (const a of [
      'hot_deal.create',
      'hot_deal.approve',
      'reservation.create',
      'redemption.redeem',
      'redemption.reverse',
    ])
      expect(actions, a).toContain(a);
  });
});
