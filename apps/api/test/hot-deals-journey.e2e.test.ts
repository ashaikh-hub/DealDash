import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HotLifecycleService } from '../src/hot-deals/hot-lifecycle.service';
import { DB_READY, RIYADH, createTestApp, idem, pngBytes, type TestApp } from './helpers';
import { buildHotWorld, validHotContent, type HotWorld } from './hot-fixtures';

/**
 * The complete Stage 4 journey through the public API only:
 *   Merchant: create an Exclusive Deal (EN + AR, image, 2 branches, stock), submit
 *   DealDash: review, request changes
 *   Merchant: fix, resubmit
 *   DealDash: approve  -> LIVE
 *   Customer: discover, open, reserve free (no payment), see it in My Deals with QR + code
 *   Staff: validate and redeem at the right branch (and see the refusals for wrong branch / replay)
 *   Customer: sees "used"; a second customer lets the hold lapse -> "not completed", stock returns
 *   Merchant: live monitor, reservations list, redemptions list; DealDash: monitor + audit
 */
describe.skipIf(!DB_READY)('Stage 4 end-to-end journey', () => {
  let t: TestApp;
  let w: HotWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
  });
  afterAll(() => t?.close());

  it('runs the whole journey and leaves a complete audit trail', async () => {
    const owner = w.api(w.ownerA);
    const base = w.base('A');

    // ---------------------------------------------------------------- merchant
    const options = (await owner.get(`${base}/hot-deal-options`)).body.data;
    expect(options.defaultHoldMinutes).toBe(30);
    const draft = await owner.post(`${base}/hot-deals`).set('Idempotency-Key', idem()).send({});
    expect(draft.status).toBe(201);
    const id = draft.body.data.id as string;

    const bytes = pngBytes(900, 560);
    const intent = await owner
      .post(`${base}/deal-media/intent`)
      .send({ fileName: 'flash.png', mimeType: 'image/png', sizeBytes: bytes.length });
    expect(
      (
        await t.http
          .put(new URL(intent.body.data.uploadUrl).pathname)
          .set('Content-Type', 'image/png')
          .send(bytes)
      ).status,
    ).toBe(200);
    expect(
      (await owner.post(`${base}/deal-media/${intent.body.data.fileId}/complete`).send({})).status,
    ).toBe(200);

    const content = validHotContent({
      categoryId: w.dining.id,
      fileId: intent.body.data.fileId,
      allocations: [
        { branchId: w.A.branchIds[0]!, units: 1 },
        { branchId: w.A.branchIds[1]!, units: 3 },
      ],
      overrides: { title: { en: 'Flash dinner 40% off', ar: 'عشاء سريع بخصم 40%' } },
    });
    // an English-only draft is allowed to be saved
    const partial = await owner
      .put(`${base}/hot-deals/${id}`)
      .send({ content: { ...content, title: { en: 'Flash dinner 40% off', ar: '' } } });
    expect(partial.status).toBe(200);
    expect(partial.body.data.deal.translation.missing).toEqual(['ar']);
    expect((await owner.post(`${base}/hot-deals/${id}/submit`).send({})).status).toBe(422);
    const saved = await owner.put(`${base}/hot-deals/${id}`).send({ content });
    expect(saved.body.data.deal.issues).toEqual([]);
    expect(
      saved.body.data.deal.inventory.map((i: { stock: { total: number } }) => i.stock.total).sort(),
    ).toEqual([1, 3]);
    expect((await owner.get(`${base}/hot-deals/${id}/preview`)).body.data.branches).toHaveLength(2);
    await w.commercialReady(id);
    expect((await owner.post(`${base}/hot-deals/${id}/submit`).send({})).body.data.outcome).toBe(
      'SENT_FOR_REVIEW',
    );

    // ---------------------------------------------------------------- DealDash review
    const queue = await w.api(w.ops).get('/v1/admin/hot-deals?queue=true');
    expect(queue.body.data.map((d: { id: string }) => d.id)).toContain(id);
    const detail = (await w.api(w.ops).get(`/v1/admin/hot-deals/${id}`)).body.data;
    expect(detail.inventory).toHaveLength(2);
    expect(detail.reservationRules).toMatchObject({ holdMinutes: 30, perCustomerLimit: 1 });
    expect(detail.adminActions).toEqual(['approve', 'request_changes', 'reject']);
    await w.decideHot(w.ops, id, 'request-changes', {
      reason: 'Please add the allergen note to the terms',
      fields: ['terms'],
    });

    // ---------------------------------------------------------------- merchant fixes, resubmits
    const fixed = {
      ...content,
      terms: {
        ...content.terms,
        textEn: 'Show your reservation code. Allergen info is at the counter.',
      },
    };
    expect((await owner.put(`${base}/hot-deals/${id}`).send({ content: fixed })).status).toBe(200);
    await w.commercialReady(id);
    expect((await owner.post(`${base}/hot-deals/${id}/submit`).send({})).status).toBe(200);
    const approved = await w.decideHot(w.ops, id, 'approve');
    expect(approved.body.data.status).toBe('LIVE');

    // ---------------------------------------------------------------- customer discovers and reserves
    const ann = await w.newCustomer();
    const bob = await w.newCustomer();
    // the shared test database holds many other Exclusive Deals: search for this one, nearest first
    const found = await w
      .api(ann)
      .get(`/v1/app/hot-deals?q=flash%20dinner&limit=50&lat=${RIYADH.lat}&lng=${RIYADH.lng}`);
    const card = found.body.data.find((d: { id: string }) => d.id === id);
    expect(card.title.ar).toBe('عشاء سريع بخصم 40%');
    const open = (await w.api(ann).get(`/v1/app/hot-deals/${id}`)).body.data;
    expect(open.holdMinutes).toBe(30);
    expect(open.remainingForMe).toBe(1);
    expect(open.branches).toHaveLength(2);
    expect(JSON.stringify(open)).not.toMatch(/deposit|payment|SAR 15/i);

    const annRes = await w.reserve(ann, id, w.A.branchIds[0]!);
    expect(annRes.status).toBe(201);
    const r1 = annRes.body.data;
    const bobRes = await w.reserve(bob, id, w.A.branchIds[1]!);
    expect(bobRes.status).toBe(201);
    const r2 = bobRes.body.data;
    // branch 0 had a single unit: it is now sold out there but still available at branch 1
    const after = (await w.api(ann).get(`/v1/app/hot-deals/${id}`)).body.data;
    expect(after.branches.find((b: { id: string }) => b.id === w.A.branchIds[0]).canReserve).toBe(
      false,
    );
    expect(after.branches.find((b: { id: string }) => b.id === w.A.branchIds[1]).canReserve).toBe(
      true,
    );
    expect(after.myReservations).toHaveLength(1);

    const mine = (await w.myRes(ann)).body.data;
    expect(mine).toHaveLength(1);
    expect(mine[0].code.qr).toBe(r1.code.qr);
    // an already-reserved customer cannot reserve again
    expect((await w.reserve(ann, id, w.A.branchIds[1]!)).body.errors[0].code).toBe('LIMIT_REACHED');

    // ---------------------------------------------------------------- staff at the counter
    expect((await w.validate(w.staffA2, r1.code.qr)).body.data.result).toBe('WRONG_BRANCH'); // Ann's reservation is at branch 0
    expect((await w.validate(w.staffA, r1.code.qr)).body.data.result).toBe('VALID');
    const red = await w.redeem(w.staffA, r1.code.qr);
    expect(red.body.data.result).toBe('REDEEMED');
    expect((await w.redeem(w.staffA, r1.code.qr)).body.data.result).toBe('ALREADY_REDEEMED');

    // ---------------------------------------------------------------- customer sees "used"; Bob lets the hold lapse
    expect((await w.api(ann).get(`/v1/app/reservations/${r1.id}`)).body.data.displayState).toBe(
      'REDEEMED',
    );
    expect((await w.myRes(ann, 'past')).body.data[0].id).toBe(r1.id);
    await t.app.get(HotLifecycleService).sweep(new Date(Date.now() + 31 * 60_000));
    const bobNow = (await w.api(bob).get(`/v1/app/reservations/${r2.id}`)).body.data;
    expect(bobNow.displayState).toBe('NOT_COMPLETED');
    expect(bobNow.code).toBeNull();
    expect((await w.validate(w.staffA2, r2.code.qr)).body.data.result).toBe('EXPIRED');
    const bobTypes = (await w.api(bob).get('/v1/app/notifications')).body.data.items.map(
      (i: { type: string }) => i.type,
    );
    expect(bobTypes).toEqual(
      expect.arrayContaining(['RESERVATION_CONFIRMED', 'RESERVATION_EXPIRED']),
    );

    // ---------------------------------------------------------------- merchant monitor, reservations, redemptions
    const monitor = (await owner.get(`${base}/hot-deals/${id}/monitor`)).body.data;
    expect(monitor.totals).toEqual({ total: 4, available: 3, reserved: 0, redeemed: 1 });
    expect(monitor.reservations).toMatchObject({ redeemed: 1, expired: 1, held: 0 });
    expect(monitor.funnel.reservationsCreated).toBe(2);
    const resList = (await owner.get(`${base}/hot-deals/${id}/reservations`)).body.data;
    expect(resList).toHaveLength(2);
    expect(resList.find((r: { status: string }) => r.status === 'REDEEMED').canReverse).toBe(true);
    const reds = (await owner.get(`${base}/redemptions`)).body.data;
    expect(reds[0]).toMatchObject({ status: 'REDEEMED', reference: red.body.data.reference });
    expect(w.staffA.me.displayName).toBeTruthy();

    // ---------------------------------------------------------------- audit
    const audit = (await w.api(w.ops).get(`/v1/admin/hot-deals/${id}/audit`)).body.data.map(
      (a: { action: string }) => a.action,
    );
    expect(audit).toEqual(
      expect.arrayContaining([
        'hot_deal.create',
        'hot_deal.submit',
        'hot_deal.request_changes',
        'hot_deal.approve',
      ]),
    );
    const history = (await w.api(w.ops).get(`/v1/admin/hot-deals/${id}`)).body.data.history.map(
      (h: { action: string }) => h.action,
    );
    expect(history).toEqual(
      expect.arrayContaining(['CREATE', 'UPDATE', 'SUBMIT', 'REQUEST_CHANGES', 'APPROVE']),
    );
    expect(
      await t.prisma.auditLog.count({
        where: {
          action: { in: ['reservation.create', 'redemption.redeem'] },
          subjectOrganizationId: w.A.orgId,
        },
      }),
    ).toBeGreaterThanOrEqual(3);
  });
});
