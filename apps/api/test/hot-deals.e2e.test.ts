import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

/** Stage 4 domain: Exclusive Deal authoring, bilingual rules, review, lifecycle, inventory rows, live-edit rules. */
describe.skipIf(!DB_READY)('Exclusive Deals domain', () => {
  let t: TestApp;
  let w: HotWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
  });
  afterAll(() => t?.close());

  it('creates a draft that may hold one language, but cannot be submitted until both exist', async () => {
    const c = w.hotContent('A', 5, { title: { en: 'Only English', ar: '' } });
    const deal = await w.createHot('A', c);
    expect(deal.status).toBe('DRAFT');
    expect(deal.translation).toEqual({ complete: false, missing: ['ar'] });
    const sub = await w.submitHot('A', deal.id);
    expect(sub.status).toBe(422);
    expect(
      sub.body.errors.some(
        (e: { field?: string; message?: string }) =>
          e.field === 'title' && e.message === 'REQUIRED_AR',
      ),
    ).toBe(true);
  });

  it('creates per-branch stock rows from the allocation and shows them to the merchant', async () => {
    const deal = await w.createHot('A', w.hotContent('A', 7));
    expect(deal.inventory).toHaveLength(1);
    expect(deal.inventory[0].stock).toEqual({ total: 7, available: 7, reserved: 0, redeemed: 0 });
    expect(deal.inventory[0].tracked).toBe(true);
  });

  it('explains every missing requirement: limit type, stock, dates, hold, per-customer limit', async () => {
    const bad = await w.createHot(
      'A',
      w.hotContent('A', 0, { endAt: null, perCustomerLimit: 99, holdMinutes: 5 }),
    );
    const sub = await w.submitHot('A', bad.id);
    expect(sub.status).toBe(422);
    const codes = sub.body.errors.map((e: { message: string }) => e.message);
    expect(codes).toEqual(
      expect.arrayContaining(['UNITS_REQUIRED', 'REQUIRED', 'LIMIT_TOO_HIGH', 'HOLD_OUT_OF_RANGE']),
    );
  });

  it('time-only walk-in deals need no stock and no reservations; reservations require a quantity limit', async () => {
    const walkIn = await w.createHot(
      'A',
      w.hotContent('A', 0, { limitType: 'TIME', reservationsEnabled: false }),
    );
    expect(walkIn.issues).toEqual([]);
    expect(walkIn.inventory[0].tracked).toBe(false);
    const mismatch = await w.createHot(
      'A',
      w.hotContent('A', 5, { limitType: 'TIME', reservationsEnabled: true }),
    );
    expect(mismatch.issues.map((i: { code: string }) => i.code)).toContain('TYPE_MISMATCH');
  });

  it('rejects another merchant branch, an image from another merchant and an end before the start', async () => {
    const stolenBranch = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals`)
      .set('Idempotency-Key', idem())
      .send({
        content: w.hotContent('A', 5, { allocations: [{ branchId: w.B.branchIds[0], units: 5 }] }),
      });
    expect(stolenBranch.status).toBe(400);
    const stolenImage = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals`)
      .set('Idempotency-Key', idem())
      .send({
        content: w.hotContent('A', 5, { media: [{ fileId: w.fileB, altEn: '', altAr: '' }] }),
      });
    expect(stolenImage.status).toBe(400);
    const reversed = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals`)
      .set('Idempotency-Key', idem())
      .send({
        content: w.hotContent('A', 5, {
          startAt: new Date(Date.now() + 7200_000).toISOString(),
          endAt: new Date(Date.now() + 3600_000).toISOString(),
        }),
      });
    expect(reversed.status).toBe(400);
  });

  it('goes through review: pending, changes requested, resubmitted, approved to LIVE with full history', async () => {
    const deal = await w.createHot('A', w.hotContent('A', 3));
    expect((await w.submitHot('A', deal.id)).body.data.outcome).toBe('SENT_FOR_REVIEW');
    expect(
      (
        await w
          .api(w.ownerA)
          .put(`${w.base('A')}/hot-deals/${deal.id}`)
          .send({ content: w.hotContent('A', 3) })
      ).status,
    ).toBe(409);
    expect((await w.decideHot(w.support, deal.id, 'approve')).status).toBe(403); // Support cannot approve
    const ch = await w.decideHot(w.ops, deal.id, 'request-changes', {
      reason: 'Add a clearer photo',
      fields: ['media'],
    });
    expect(ch.body.data.status).toBe('NEEDS_CHANGES');
    expect(
      (await w.api(w.ownerA).get(`${w.base('A')}/hot-deals/${deal.id}`)).body.data.latestDecision
        .reason,
    ).toBe('Add a clearer photo');
    expect((await w.submitHot('A', deal.id)).status).toBe(200);
    const ap = await w.decideHot(w.ops, deal.id, 'approve');
    expect(ap.body.data.status).toBe('LIVE');
    expect(ap.body.data.reservationRules).toMatchObject({
      holdMinutes: 30,
      perCustomerLimit: 1,
      noShowThreshold: 3,
    });
    const actions = ap.body.data.history.map((h: { action: string }) => h.action);
    expect(actions).toEqual(
      expect.arrayContaining(['CREATE', 'SUBMIT', 'REQUEST_CHANGES', 'APPROVE']),
    );
    const audit = await t.prisma.auditLog.count({
      where: { entityType: 'HotDeal', entityId: deal.id },
    });
    expect(audit).toBeGreaterThanOrEqual(4);
  });

  it('keeps drafts private from DealDash until submitted', async () => {
    const deal = await w.createHot('A', w.hotContent('A', 3));
    expect((await w.api(w.ops).get(`/v1/admin/hot-deals/${deal.id}`)).status).toBe(404);
  });

  it('schedules a deal that starts in the future and a sweep activates it at its start time', async () => {
    const { HotLifecycleService } = await import('../src/hot-deals/hot-lifecycle.service');
    const start = new Date(Date.now() + 3600_000).toISOString();
    const deal = await w.publishHot('A', 3, {
      startAt: start,
      endAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    });
    expect(deal.status).toBe('SCHEDULED');
    // not visible yet
    expect((await t.http.get(`/v1/app/hot-deals/${deal.id}`)).status).toBe(404);
    await t.app.get(HotLifecycleService).sweep(new Date(Date.now() + 3700_000));
    const row = await t.prisma.hotDeal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(row.status).toBe('LIVE');
  });

  it('expires at the end date through the sweep; terminal states stay terminal', async () => {
    const { HotLifecycleService } = await import('../src/hot-deals/hot-lifecycle.service');
    const deal = await w.publishHot('A', 3, {
      endAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await t.app.get(HotLifecycleService).sweep(new Date(Date.now() + 2 * 3600_000));
    expect((await t.prisma.hotDeal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe(
      'EXPIRED',
    );
    const resume = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${deal.id}/resume`)
      .send({});
    expect(resume.status).toBe(409);
  });

  it('pauses and resumes (merchant), and DealDash pause can only be lifted by DealDash', async () => {
    const deal = await w.publishHot('A', 3);
    const p = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${deal.id}/pause`)
      .send({ reason: 'Kitchen busy' });
    expect(p.body.data.status).toBe('PAUSED');
    expect((await t.http.get(`/v1/app/hot-deals/${deal.id}`)).status).toBe(404);
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.base('A')}/hot-deals/${deal.id}/resume`)
          .send({})
      ).body.data.status,
    ).toBe('LIVE');
    await w.decideHot(w.ops, deal.id, 'pause', { reason: 'Investigating' });
    const blocked = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${deal.id}/resume`)
      .send({});
    expect(blocked.status).toBe(409);
    const back = await w.decideHot(w.ops, deal.id, 'resume', { reason: 'Resolved' });
    expect(back.body.data.status).toBe('LIVE');
  });

  it('suspends and reinstates with a reason; a suspended deal is hidden and merchant-locked', async () => {
    const deal = await w.publishHot('A', 3);
    const s = await w.decideHot(w.ops, deal.id, 'suspend', { reason: 'Policy review' });
    expect(s.body.data.status).toBe('SUSPENDED');
    expect((await t.http.get(`/v1/app/hot-deals/${deal.id}`)).status).toBe(404);
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.base('A')}/hot-deals/${deal.id}/pause`)
          .send({})
      ).status,
    ).toBe(409);
    expect((await w.decideHot(w.ops, deal.id, 'reinstate')).body.data.status).toBe('LIVE');
  });

  describe('live editing', () => {
    it('applies wording corrections with an audit entry, refuses material changes', async () => {
      const deal = await w.publishHot('A', 4);
      const content = w.hotContent('A', 4);
      const typo = {
        ...content,
        description: {
          ...content.description,
          en: 'A flash offer on the dinner menu, limited units per branch!',
        },
      };
      const minor = await w
        .api(w.ownerA)
        .put(`${w.base('A')}/hot-deals/${deal.id}`)
        .send({ content: typo });
      expect(minor.status).toBe(200);
      expect(minor.body.data.outcome).toBe('APPLIED_MINOR');
      const material = await w
        .api(w.ownerA)
        .put(`${w.base('A')}/hot-deals/${deal.id}`)
        .send({
          content: { ...content, valueNumber: 60, offerLabel: { en: '60% off', ar: 'خصم 60%' } },
        });
      expect(material.status).toBe(409);
      expect(material.body.errors[0].code).toBe('MATERIAL_EDIT_LOCKED');
      const hist = await w.api(w.ownerA).get(`${w.base('A')}/hot-deals/${deal.id}/history`);
      expect(hist.body.data.map((h: { action: string }) => h.action)).toContain('MINOR_EDIT');
    });

    it('ignores unit changes in an edit: stock moves only through the stock endpoint', async () => {
      const deal = await w.publishHot('A', 4);
      const edited = await w
        .api(w.ownerA)
        .put(`${w.base('A')}/hot-deals/${deal.id}`)
        .send({ content: w.hotContent('A', 400) });
      expect(edited.status).toBe(200);
      expect(edited.body.data.deal.inventory[0].stock.total).toBe(4);
    });
  });

  describe('stock', () => {
    it('adds stock, removes only unreserved stock, never below committed units', async () => {
      const deal = await w.publishHot('A', 3);
      const branchId = w.A.branchIds[0]!;
      const customer = await w.newCustomer();
      expect((await w.reserve(customer, deal.id, branchId)).status).toBe(201);
      // raising live stock raises the commercial commitment: the amendment must be accepted first
      const refused = await w
        .api(w.ownerA)
        .post(`${w.base('A')}/hot-deals/${deal.id}/stock`)
        .send({ branchId, delta: 4 });
      expect(refused.status).toBe(409);
      expect(refused.body.errors[0].code).toBe('COMMERCIAL_AMENDMENT_REQUIRED');
      await w.commercialReady(deal.id);
      const add = await w
        .api(w.ownerA)
        .post(`${w.base('A')}/hot-deals/${deal.id}/stock`)
        .send({ branchId, delta: 4 });
      expect(add.body.data.inventory[0].stock).toEqual({
        total: 7,
        available: 6,
        reserved: 1,
        redeemed: 0,
      });
      const rm = await w
        .api(w.ownerA)
        .post(`${w.base('A')}/hot-deals/${deal.id}/stock`)
        .send({ branchId, delta: -6 });
      expect(rm.body.data.inventory[0].stock).toEqual({
        total: 1,
        available: 0,
        reserved: 1,
        redeemed: 0,
      });
      const below = await w
        .api(w.ownerA)
        .post(`${w.base('A')}/hot-deals/${deal.id}/stock`)
        .send({ branchId, delta: -1 });
      expect(below.status).toBe(409);
      expect(below.body.errors[0].code).toBe('INVENTORY_BELOW_COMMITTED');
      // the deal is now sold out, then reopens when stock is added
      expect((await t.prisma.hotDeal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe(
        'SOLD_OUT',
      );
      await w
        .api(w.ownerA)
        .post(`${w.base('A')}/hot-deals/${deal.id}/stock`)
        .send({ branchId, delta: 2 });
      expect((await t.prisma.hotDeal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe(
        'LIVE',
      );
    });

    it('the database itself refuses negative or unbalanced stock', async () => {
      const deal = await w.publishHot('A', 3);
      await expect(
        t.prisma
          .$executeRaw`UPDATE "HotDealInventory" SET "available" = -1 WHERE "dealId" = ${deal.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        t.prisma
          .$executeRaw`UPDATE "HotDealInventory" SET "available" = "available" + 1 WHERE "dealId" = ${deal.id}::uuid`,
      ).rejects.toThrow();
    });
  });
});
