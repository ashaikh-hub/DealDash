import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { buildVoucherWorld, type VoucherWorld } from './voucher-fixtures';

/** The full Stage 5 journey, end to end, through the public API only (the dev payment page stands in for the PSP). */
describe.skipIf(!DB_READY)(
  'Stage 5 journey: voucher from creation to settlement-eligible payable',
  () => {
    let t: TestApp;
    let w: VoucherWorld;
    beforeAll(async () => {
      t = await createTestApp();
      w = await buildVoucherWorld(t);
    });
    afterAll(() => t?.close());

    it('Merchant creates and submits → Admin approves → Customer buys → Staff redeems → payable becomes settlement-eligible, everything audited', async () => {
      // ---- Merchant (Campaign Manager)
      const created = await w
        .api(w.campaignsA)
        .post(`${w.vbase('A')}/vouchers`)
        .set('Idempotency-Key', idem())
        .send({ content: w.voucherContent('A', { totalQty: 5, perCustomerLimit: 1 }) });
      expect(created.status).toBe(201);
      const id = created.body.data.id as string;
      await w.commercialReady(id);
      const sub = await w
        .api(w.campaignsA)
        .post(`${w.vbase('A')}/vouchers/${id}/submit`)
        .send({});
      expect(sub.body.data.outcome).toBe('SENT_FOR_REVIEW');
      // ---- Admin (Operations)
      expect(
        (await w.api(w.ops).get('/v1/admin/vouchers?queue=true')).body.data.map(
          (r: { id: string }) => r.id,
        ),
      ).toContain(id);
      const ap = await w.decideVoucher(w.ops, id, 'approve');
      expect(ap.body.data.status).toBe('ON_SALE');
      // ---- Customer discovers, opens, buys
      const c = await w.newCustomer();
      const found = await w.api(c).get('/v1/app/vouchers?limit=50');
      expect(found.body.data.map((x: { id: string }) => x.id)).toContain(id);
      const detail = await w.api(c).get(`/v1/app/vouchers/${id}`);
      expect(detail.body.data).toMatchObject({ canBuy: true, reportedSavingsHalalas: 2000 });
      const co = await w.checkout(c, id);
      const order = co.body.data;
      expect(order.status).toBe('PENDING_PAYMENT');
      const p = await w.pay(c, order.id);
      const redirect = new URL(p.body.data.payment.redirectUrl);
      const providerRef = redirect.searchParams.get('mock_payment')!;
      // not owned yet
      expect((await w.wallet(c)).body.data).toHaveLength(0);
      // ---- the mock payment page succeeds (same signed webhook path as a real PSP)
      const done = await t.http
        .post(`/v1/dev/payments/${providerRef}/complete`)
        .send({ outcome: 'SUCCEEDED', duplicate: true });
      expect(done.status).toBe(200);
      expect(done.body.data.first.outcome).toBe('APPLIED');
      expect(done.body.data.second.outcome).toBe('DUPLICATE');
      const paid = (await w.getOrder(c, order.id)).body.data;
      expect(paid).toMatchObject({ status: 'PAID' });
      // ---- My Vouchers + QR
      const list = (await w.wallet(c)).body.data;
      expect(list).toHaveLength(1);
      const wallet = (await w.walletOne(c, list[0].id)).body.data;
      expect(wallet.code.qr).toMatch(/^DV1\./);
      expect(wallet).toMatchObject({ state: 'ACTIVE', canRequestRefund: true });
      // ---- Staff scans → validates → redeems
      const v = await w.validate(w.staffA, wallet.code.qr);
      expect(v.body.data.result).toBe('VALID');
      const rd = await w.redeem(w.staffA, wallet.code.qr, 'QR');
      expect(rd.body.data.result).toBe('REDEEMED');
      // ---- System: redeemed, payable eligible, analytics, audit
      expect((await w.walletOne(c, list[0].id)).body.data).toMatchObject({
        state: 'USED',
        code: null,
        canRequestRefund: false,
        refundNote: 'REDEEMED',
      });
      const payable = (await w.api(w.financeA).get(`${w.vbase('A')}/finance/voucher-payable`)).body
        .data;
      expect(payable.settlementEligibleHalalas).toBe(7200);
      expect(payable.counts).toMatchObject({ sold: 1, redeemed: 1 });
      const mon = (await w.api(w.ownerA).get(`${w.vbase('A')}/vouchers/${id}/monitor`)).body.data;
      expect(mon.sales).toMatchObject({ sold: 1, redeemed: 1, redemptionRatePct: 100 });
      expect(mon.funnel).toMatchObject({
        checkoutsStarted: 1,
        paymentsSucceeded: 1,
        paymentsFailed: 0,
      });
      expect(mon.finance).toMatchObject({
        soldGrossHalalas: 8000,
        redeemedGrossHalalas: 8000,
        settlementEligibleHalalas: 7200,
      });
      const order2 = await w.adminOrder(w.finance, order.id);
      expect(order2.body.data.journals.map((j: { type: string }) => j.type)).toEqual([
        'SALE',
        'REDEMPTION',
      ]);
      const audit = (
        await t.prisma.auditLog.findMany({
          where: {
            OR: [
              { entityType: 'Voucher', entityId: id },
              { entityType: 'VoucherOrder', entityId: order.id },
              { entityType: 'VoucherRedemption' },
              { entityType: 'VoucherInstance' },
              { entityType: 'Payment' },
            ],
          },
        })
      ).map((a) => a.action);
      expect(audit).toEqual(
        expect.arrayContaining([
          'voucher.create',
          'voucher.submit',
          'voucher.approve',
          'voucher_order.create',
          'payment.create',
          'payment.succeeded',
          'voucher_instance.issue',
          'voucher_redemption.redeem',
        ]),
      );
      const notes = (await w.api(c).get('/v1/app/notifications')).body.data.items.map(
        (i: { type: string }) => i.type,
      );
      expect(notes).toEqual(
        expect.arrayContaining(['PURCHASE_SUCCEEDED', 'VOUCHER_ISSUED', 'VOUCHER_REDEEMED']),
      );
      // the whole ledger still balances
      expect(
        (await w.api(w.finance).get('/v1/admin/finance/overview')).body.data.ledger.balanced,
      ).toBe(true);
    });

    it('failed payment: the customer is told, no voucher exists, a retry can succeed (through the dev payment page)', async () => {
      const v = await w.publishVoucher('A');
      const c = await w.newCustomer();
      const co = await w.checkout(c, v.id);
      const p1 = await w.pay(c, co.body.data.id);
      const ref1 = new URL(p1.body.data.payment.redirectUrl).searchParams.get('mock_payment')!;
      await t.http.post(`/v1/dev/payments/${ref1}/complete`).send({ outcome: 'FAILED' });
      const after = (await w.getOrder(c, co.body.data.id)).body.data;
      expect(after.payment).toMatchObject({ status: 'FAILED' });
      expect((await w.wallet(c)).body.data).toHaveLength(0);
      const p2 = await w.pay(c, co.body.data.id);
      const ref2 = new URL(p2.body.data.payment.redirectUrl).searchParams.get('mock_payment')!;
      await t.http.post(`/v1/dev/payments/${ref2}/complete`).send({ outcome: 'SUCCEEDED' });
      expect((await w.wallet(c)).body.data).toHaveLength(1);
    });

    it('refund before redemption works; a redeemed voucher blocks the normal refund; a refunded voucher blocks redemption', async () => {
      const v = await w.publishVoucher('A', { totalQty: 5, perCustomerLimit: 5 });
      const c = await w.newCustomer();
      const a = await w.owned(c, v.id);
      const b = await w.owned(c, v.id);
      // refund before redemption
      const r = await w.requestRefund(c, a.instanceId!);
      expect(r.body.data.status).toBe('REFUNDED');
      expect((await w.redeem(w.staffA, a.qr)).body.data.result).toBe('REFUNDED');
      // redeemed blocks normal refund
      expect((await w.redeem(w.staffA, b.qr)).body.data.result).toBe('REDEEMED');
      expect((await w.requestRefund(c, b.instanceId!)).status).toBe(409);
      // staff cannot refund
      expect([401, 403, 404]).toContain(
        (await w.api(w.staffA).post(`/v1/app/wallet/${b.instanceId}/refund`).send({})).status,
      );
      // totals: one refunded, one redeemed, ledger balances
      expect(
        (await w.api(w.finance).get('/v1/admin/finance/overview')).body.data.ledger.balanced,
      ).toBe(true);
    });
  },
);
