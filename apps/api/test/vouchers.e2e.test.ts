import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { buildVoucherWorld, type VoucherWorld } from './voucher-fixtures';

/** Stage 5 domain: Voucher authoring, commercial rules, review, lifecycle, live-edit rules, permissions, tenant isolation. */
describe.skipIf(!DB_READY)('Vouchers domain', () => {
  let t: TestApp;
  let w: VoucherWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildVoucherWorld(t);
  });
  afterAll(() => t?.close());

  it('creates a draft that may hold one language, but cannot be submitted until both exist', async () => {
    const v = await w.createVoucher(
      'A',
      w.voucherContent('A', { title: { en: 'Only English', ar: '' } }),
    );
    expect(v.status).toBe('DRAFT');
    expect(v.translation).toEqual({ complete: false, missing: ['ar'] });
    const sub = await w.submitVoucher('A', v.id);
    expect(sub.status).toBe(422);
    expect(
      sub.body.errors.some(
        (e: { field?: string; message?: string }) =>
          e.field === 'title' && e.message === 'REQUIRED_AR',
      ),
    ).toBe(true);
  });

  it('shows the customer the REPORTED savings (face value minus price), never a promise of personal savings', async () => {
    const v = await w.createVoucher('A', w.voucherContent('A'));
    expect(v.savings).toEqual({ savingsHalalas: 2000, savingsPercent: 20 });
    expect(v.stock).toEqual({ total: 10, held: 0, sold: 0, remaining: 10 });
  });

  it('explains every commercial problem: price above face value, no quantity, short validity, per-customer limit', async () => {
    const bad = await w.createVoucher(
      'A',
      w.voucherContent('A', {
        sellingPriceHalalas: 12_000,
        totalQty: 0,
        perCustomerLimit: 50,
        validity: { type: 'DAYS_FROM_PURCHASE', days: 2, validUntil: null },
      }),
    );
    const sub = await w.submitVoucher('A', bad.id);
    expect(sub.status).toBe(422);
    const codes = sub.body.errors.map((e: { message: string }) => e.message);
    expect(codes).toEqual(
      expect.arrayContaining([
        'PRICE_ABOVE_FACE',
        'QTY_REQUIRED',
        'LIMIT_TOO_HIGH',
        'VALIDITY_TOO_SHORT',
      ]),
    );
  });

  it('the database itself refuses a price above the face value once submitted, and negative inventory', async () => {
    const v = await w.createVoucher('A', w.voucherContent('A'));
    await expect(
      t.prisma
        .$executeRaw`UPDATE "Voucher" SET "status" = 'ON_SALE', "sellingPriceHalalas" = 20000 WHERE "id" = ${v.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      t.prisma.$executeRaw`UPDATE "Voucher" SET "soldQty" = 11 WHERE "id" = ${v.id}::uuid`,
    ).rejects.toThrow();
  });

  it('rejects another merchant branch, an image from another merchant and a sale end before the start', async () => {
    const stolenBranch = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers`)
      .set('Idempotency-Key', idem())
      .send({ content: w.voucherContent('A', { branchIds: [w.B.branchIds[0]] }) });
    expect(stolenBranch.status).toBe(400);
    const stolenImage = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers`)
      .set('Idempotency-Key', idem())
      .send({
        content: w.voucherContent('A', { media: [{ fileId: w.fileB, altEn: 'x', altAr: 'س' }] }),
      });
    expect(stolenImage.status).toBe(400);
    const badWindow = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers`)
      .set('Idempotency-Key', idem())
      .send({
        content: w.voucherContent('A', {
          saleStartAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
          saleEndAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      });
    expect(badWindow.status).toBe(400);
  });

  it('review: submit goes to PENDING_REVIEW; request changes shows the reason; edit and resubmit; approve puts it on sale', async () => {
    const v = await w.createVoucher('A', w.voucherContent('A'));
    const sub = await w.submitVoucher('A', v.id);
    expect(sub.status).toBe(200);
    expect(sub.body.data.outcome).toBe('SENT_FOR_REVIEW');
    expect(sub.body.data.voucher.status).toBe('PENDING_REVIEW');
    // editing is locked while in review
    const locked = await w
      .api(w.ownerA)
      .put(`${w.vbase('A')}/vouchers/${v.id}`)
      .send({ content: w.voucherContent('A', { title: { en: 'New', ar: 'جديد' } }) });
    expect(locked.status).toBe(409);
    expect(locked.body.errors[0].code).toBe('EDIT_LOCKED');

    const ask = await w.decideVoucher(w.ops, v.id, 'request-changes', {
      reason: 'Please explain what the voucher can be used on.',
      reasonAr: 'يرجى توضيح ما يمكن استخدام القسيمة عليه.',
    });
    expect(ask.status).toBe(200);
    expect(ask.body.data.status).toBe('NEEDS_CHANGES');
    const mine = await w.api(w.ownerA).get(`${w.vbase('A')}/vouchers/${v.id}`);
    expect(mine.body.data.latestDecision).toMatchObject({
      action: 'REQUEST_CHANGES',
      reason: 'Please explain what the voucher can be used on.',
      actorRole: 'DEALDASH',
      actorName: null, // merchants never see which employee decided
    });
    const edit = await w
      .api(w.ownerA)
      .put(`${w.vbase('A')}/vouchers/${v.id}`)
      .send({
        content: w.voucherContent('A', {
          description: {
            en: 'Use it on anything on the menu.',
            ar: 'استخدمها على أي صنف في القائمة.',
          },
        }),
      });
    expect(edit.status).toBe(200);
    expect((await w.submitVoucher('A', v.id)).status).toBe(200);
    const ap = await w.decideVoucher(w.ops, v.id, 'approve');
    expect(ap.status).toBe(200);
    expect(ap.body.data.status).toBe('ON_SALE');
    expect(ap.body.data.history.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining(['CREATE', 'SUBMIT', 'REQUEST_CHANGES', 'UPDATE', 'APPROVE']),
    );
    // every decision is audited
    const audit = await t.prisma.auditLog.findMany({
      where: { entityType: 'Voucher', entityId: v.id },
    });
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'voucher.create',
        'voucher.submit',
        'voucher.request_changes',
        'voucher.approve',
      ]),
    );
  });

  it('a rejected voucher is terminal; a decision needs a reason', async () => {
    const v = await w.createVoucher('A', w.voucherContent('A'));
    await w.submitVoucher('A', v.id);
    expect((await w.decideVoucher(w.ops, v.id, 'reject', { reason: 'x' })).status).toBe(400);
    const rj = await w.decideVoucher(w.ops, v.id, 'reject', {
      reason: 'Price claim is not supported.',
    });
    expect(rj.body.data.status).toBe('REJECTED');
    expect((await w.submitVoucher('A', v.id)).status).toBe(409);
    expect((await w.decideVoucher(w.ops, v.id, 'approve')).status).toBe(409);
  });

  it('a scheduled voucher (future sale start) becomes on sale from its start', async () => {
    const v = await w.publishVoucher('A', {
      saleStartAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(v.status).toBe('SCHEDULED');
    await t.prisma.voucher.update({
      where: { id: v.id },
      data: { saleStartAt: new Date(Date.now() - 1000) },
    });
    await w.lifecycle.activateScheduled(new Date());
    expect((await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).status).toBe(
      'ON_SALE',
    );
  });

  it('live edits: wording and photos only; anything the customer buys is locked; capacity changes via stock', async () => {
    const v = await w.publishVoucher('A');
    const minor = await w
      .api(w.ownerA)
      .put(`${w.vbase('A')}/vouchers/${v.id}`)
      .send({
        content: w.voucherContent('A', {
          description: {
            en: 'A SAR 100 voucher you can use on anything on the menu, at the listed branch.',
            ar: v.content.description.ar,
          },
        }),
      });
    expect(minor.status).toBe(200);
    expect(minor.body.data.outcome).toBe('APPLIED_MINOR');
    for (const change of [
      { sellingPriceHalalas: 7_000 },
      { faceValueHalalas: 20_000 },
      { validity: { type: 'DAYS_FROM_PURCHASE', days: 10, validUntil: null } },
      { branchIds: [w.A.branchIds[0], w.A.branchIds[1]] },
      { perCustomerLimit: 5 },
    ]) {
      const r = await w
        .api(w.ownerA)
        .put(`${w.vbase('A')}/vouchers/${v.id}`)
        .send({ content: w.voucherContent('A', change) });
      expect(r.status).toBe(409);
      expect(r.body.errors[0].code).toBe('MATERIAL_EDIT_LOCKED');
    }
    // raising live capacity raises the commercial commitment: the amendment must be accepted first
    const refused = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${v.id}/stock`)
      .send({ delta: 5 });
    expect(refused.status).toBe(409);
    expect(refused.body.errors[0].code).toBe('COMMERCIAL_AMENDMENT_REQUIRED');
    await w.commercialReady(v.id);
    const add = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${v.id}/stock`)
      .send({ delta: 5 });
    expect(add.status).toBe(200);
    expect(add.body.data.stock).toMatchObject({ total: 15, remaining: 15 });
    const tooLow = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${v.id}/stock`)
      .send({ delta: -100 });
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.errors[0].code).toBe('INVENTORY_BELOW_COMMITTED');
  });

  it('pause / resume / end by the merchant; DealDash pause cannot be undone by the merchant; suspend and reinstate', async () => {
    const v = await w.publishVoucher('A');
    const p = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${v.id}/pause`)
      .send({});
    expect(p.body.data.status).toBe('PAUSED');
    const r = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${v.id}/resume`)
      .send({});
    expect(r.body.data.status).toBe('ON_SALE');
    // DealDash pauses
    const dp = await w.decideVoucher(w.ops, v.id, 'pause');
    expect(dp.body.data.status).toBe('PAUSED');
    const blocked = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${v.id}/resume`)
      .send({});
    expect(blocked.status).toBe(409);
    expect((await w.decideVoucher(w.ops, v.id, 'resume')).body.data.status).toBe('ON_SALE');
    const sp = await w.decideVoucher(w.ops, v.id, 'suspend', {
      reason: 'Investigating a complaint',
    });
    expect(sp.body.data.status).toBe('SUSPENDED');
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.vbase('A')}/vouchers/${v.id}/pause`)
          .send({})
      ).status,
    ).toBe(409);
    expect((await w.decideVoucher(w.ops, v.id, 'reinstate')).body.data.status).toBe('ON_SALE');
    const end = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${v.id}/end`)
      .send({ reason: 'Sale finished' });
    expect(end.body.data.status).toBe('ENDED');
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.vbase('A')}/vouchers/${v.id}/resume`)
          .send({})
      ).status,
    ).toBe(409);
  });

  it('merchant A cannot see or touch merchant B vouchers (404), and branch-scoped managers are refused', async () => {
    const vb = await w.createVoucher('B', w.voucherContent('B'));
    expect((await w.api(w.ownerA).get(`${w.vbase('B')}/vouchers/${vb.id}`)).status).toBe(404);
    expect((await w.api(w.ownerA).get(`/v1/merchants/${w.B.orgId}/vouchers`)).status).toBe(404);
    // another org's id under my own org path is simply not found
    expect((await w.api(w.ownerA).get(`${w.vbase('A')}/vouchers/${vb.id}`)).status).toBe(404);
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.vbase('A')}/vouchers/${vb.id}/submit`)
          .send({})
      ).status,
    ).toBe(404);
    expect((await w.api(w.branchScopedA).get(`${w.vbase('A')}/vouchers`)).status).toBe(403);
    const list = await w.api(w.ownerA).get(`${w.vbase('A')}/vouchers`);
    expect(JSON.stringify(list.body)).not.toContain(vb.id);
  });

  it('permissions: Campaign Manager manages vouchers; Finance cannot see or change campaigns; Staff cannot reach anything', async () => {
    const asCm = await w
      .api(w.campaignsA)
      .post(`${w.vbase('A')}/vouchers`)
      .set('Idempotency-Key', idem())
      .send({ content: w.voucherContent('A') });
    expect(asCm.status).toBe(201);
    // Finance: no campaign permission, but may read the payable view
    expect((await w.api(w.financeA).get(`${w.vbase('A')}/vouchers`)).status).toBe(403);
    expect(
      (
        await w
          .api(w.financeA)
          .post(`${w.vbase('A')}/vouchers`)
          .set('Idempotency-Key', idem())
          .send({ content: w.voucherContent('A') })
      ).status,
    ).toBe(403);
    expect((await w.api(w.financeA).get(`${w.vbase('A')}/finance/voucher-payable`)).status).toBe(
      200,
    );
    // Campaign Manager has no finance read
    expect((await w.api(w.campaignsA).get(`${w.vbase('A')}/finance/voucher-payable`)).status).toBe(
      403,
    );
    // Staff
    expect([401, 403]).toContain((await w.api(w.staffA).get(`${w.vbase('A')}/vouchers`)).status);
    // a staff session is not even recognised by the admin API
    expect([401, 403]).toContain((await w.api(w.staffA).get('/v1/admin/vouchers')).status);
  });

  it('admin: Operations review and control; Support cannot approve or pause; drafts stay private', async () => {
    const draft = await w.createVoucher('A', w.voucherContent('A'));
    expect((await w.api(w.ops).get(`/v1/admin/vouchers/${draft.id}`)).status).toBe(404);
    expect((await w.api(w.support).get('/v1/admin/vouchers')).status).toBe(403);
    const live = await w.publishVoucher('A');
    expect((await w.decideVoucher(w.support, live.id, 'pause')).status).toBe(403);
    expect((await w.decideVoucher(w.finance, live.id, 'approve')).status).toBe(403);
    const detail = await w.api(w.ops).get(`/v1/admin/vouchers/${live.id}`);
    expect(detail.status).toBe(200);
    // the reviewer sees the commercial rules and the customer preview
    expect(detail.body.data.commercial).toMatchObject({
      savings: { savingsPercent: 20 },
      refundPolicy: { placeholder: true },
      payableRule: { accrualPoint: 'REDEMPTION', placeholder: true },
    });
    expect(detail.body.data.preview.sellingPriceHalalas).toBe(8000);
    expect(detail.body.data.merchant.legalName).toContain('Alpha Grill');
    expect(detail.body.data.branches[0].name.en).toBeTruthy();
    const queue = await w.api(w.ops).get('/v1/admin/vouchers?queue=true');
    expect(queue.status).toBe(200);
  });

  it('discovery: customers see only vouchers on sale, with reported savings and no merchant secrets', async () => {
    const c = await w.newCustomer();
    const v = await w.publishVoucher('A');
    const hidden = await w.createVoucher('A', w.voucherContent('A'));
    const list = await t.http.get('/v1/app/vouchers?limit=50');
    expect(list.status).toBe(200);
    const ids = list.body.data.map((x: { id: string }) => x.id);
    expect(ids).toContain(v.id);
    expect(ids).not.toContain(hidden.id);
    const card = list.body.data.find((x: { id: string }) => x.id === v.id);
    expect(card).toMatchObject({
      faceValueHalalas: 10_000,
      sellingPriceHalalas: 8_000,
      reportedSavingsHalalas: 2_000,
      reportedSavingsPercent: 20,
      currency: 'SAR',
      availability: 'AVAILABLE',
    });
    expect(JSON.stringify(list.body)).not.toMatch(/private-|secret\.test|1010999999/);
    const detail = await t.http.get(`/v1/app/vouchers/${v.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.terms.text.en).toContain('One voucher per visit');
    expect(detail.body.data.branches).toHaveLength(1);
    expect(detail.body.data.canBuy).toBe(true);
    expect((await t.http.get(`/v1/app/vouchers/${hidden.id}`)).status).toBe(404);
    const search = await t.http.get(`/v1/app/vouchers?q=${encodeURIComponent('قسيمة')}`);
    expect(search.body.data.map((x: { id: string }) => x.id)).toContain(v.id);
    expect(c.cookie).toBeTruthy();
  });

  it('eligibility: a restricted voucher is locked for a customer without the benefit and cannot be bought', async () => {
    const v = await w.publishVoucher('A', {
      eligibility: { kind: 'EMPLOYER', valueRefs: [w.employer] },
    });
    const c = await w.newCustomer();
    const detail = await w.api(c).get(`/v1/app/vouchers/${v.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.eligibility.result).toBe('LOCKED_UNLOCKABLE');
    expect(detail.body.data.canBuy).toBe(false);
    expect(detail.body.data.blockedReason).toBe('LOCKED');
    const co = await w.checkout(c, v.id);
    expect(co.status).toBe(403);
    expect(co.body.errors[0].code).toBe('NOT_ELIGIBLE');
  });
});
