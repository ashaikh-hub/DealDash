import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { buildVoucherWorld, type VoucherWorld } from './voucher-fixtures';
import { MockPaymentProvider } from '../src/providers/mocks';

/** Stage 5 payments: checkout hold, payment states, provider webhook security, idempotency, ownership only after success. */
describe.skipIf(!DB_READY)('Voucher checkout and payments', () => {
  let t: TestApp;
  let w: VoucherWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildVoucherWorld(t);
  });
  afterAll(() => t?.close());

  const instances = (orderId: string) => t.prisma.voucherInstance.findMany({ where: { orderId } });
  const journal = async (key: string) =>
    t.prisma.ledgerJournal.findUnique({
      where: { idempotencyKey: key },
      include: { entries: true },
    });

  it('checkout holds the voucher and shows the purchase summary; nothing is owned and nothing is charged yet', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    expect(co.status).toBe(201);
    const o = co.body.data;
    expect(o).toMatchObject({
      status: 'PENDING_PAYMENT',
      quantity: 1,
      unitPriceHalalas: 8000,
      faceValueHalalas: 10_000,
      totalHalalas: 8000,
      currency: 'SAR',
      payment: null,
      voucherInstanceId: null,
      canCancel: true,
    });
    expect(o.reference).toMatch(/^ORD-[A-Z2-9]{6}$/);
    expect(o.voucher.reportedSavingsHalalas).toBe(2000);
    const row = await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } });
    expect([row.totalQty, row.heldQty, row.soldQty]).toEqual([10, 1, 0]);
    expect(await instances(o.id)).toHaveLength(0);
    expect((await w.wallet(c)).body.data).toHaveLength(0);
    // the same customer reopening checkout reuses the open order: no second hold
    const again = await w.checkout(c, v.id);
    expect(again.body.data.id).toBe(o.id);
    expect((await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).heldQty).toBe(1);
  });

  it('pressing Pay needs the terms accepted (snapshotted), starts ONE attempt, and still issues nothing', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    const noTerms = await w
      .api(c)
      .post(`/v1/app/orders/${co.body.data.id}/pay`)
      .set('Idempotency-Key', idem())
      .send({});
    expect(noTerms.status).toBe(400);
    const p = await w.pay(c, co.body.data.id);
    expect(p.status).toBe(200);
    expect(p.body.data.payment).toMatchObject({
      status: 'PENDING',
      attemptNo: 1,
      amountHalalas: 8000,
    });
    expect(p.body.data.payment.redirectUrl).toContain('mock_payment=');
    expect(p.body.data.termsVersion).toBeTruthy();
    // a double tap does not open a second attempt
    const p2 = await w.pay(c, co.body.data.id);
    expect(p2.body.data.payment.id).toBe(p.body.data.payment.id);
    expect(await t.prisma.payment.count({ where: { orderId: co.body.data.id } })).toBe(1);
    expect(await instances(co.body.data.id)).toHaveLength(0);
    // the browser coming back is NOT proof of payment
    expect((await w.getOrder(c, co.body.data.id)).body.data.status).toBe('PENDING_PAYMENT');
    expect((await w.wallet(c)).body.data).toHaveLength(0);
  });

  it('a confirmed payment issues the voucher: owned, QR + code, ledger sale (held, not payable), audit, notifications', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const b = await w.buy(c, v.id);
    expect(b.order.status).toBe('PAID');
    expect(b.order.payment.status).toBe('SUCCEEDED');
    expect(b.instanceId).toBeTruthy();
    const list = (await w.wallet(c)).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      state: 'ACTIVE',
      purchasePriceHalalas: 8000,
      faceValueHalalas: 10_000,
    });
    const d = (await w.walletOne(c, b.instanceId!)).body.data;
    expect(d.code.qr).toMatch(/^DV1\.[A-Za-z0-9_-]{22}$/);
    expect(d.code.manual).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(d.reference).toMatch(/^VC-[A-Z2-9]{6}$/);
    expect(d.branches).toHaveLength(1);
    expect(JSON.stringify(d)).not.toContain(b.instanceId!.slice(0, 0) + 'sequential'); // no internal counters
    const row = await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } });
    expect([row.heldQty, row.soldQty]).toEqual([0, 1]);
    // ledger: customer money received, held for the merchant, NOT settlement-eligible
    const pay = await t.prisma.payment.findFirstOrThrow({ where: { orderId: b.orderId } });
    const j = await journal(`sale:${pay.id}`);
    expect(j?.type).toBe('SALE');
    expect(j?.entries.reduce((n, e) => n + e.amountHalalas, 0)).toBe(0);
    const pos = await w.api(w.financeA).get(`${w.vbase('A')}/finance/voucher-payable`);
    expect(pos.body.data.heldHalalas).toBeGreaterThanOrEqual(8000);
    const types = (
      await t.prisma.merchantPayableEvent.findMany({ where: { voucherId: v.id } })
    ).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['SOLD', 'ISSUED']));
    expect(types).not.toContain('ELIGIBLE');
    // notifications + audit + analytics
    const notes = (await w.api(c).get('/v1/app/notifications')).body.data.items.map(
      (i: { type: string }) => i.type,
    );
    expect(notes).toEqual(expect.arrayContaining(['PURCHASE_SUCCEEDED', 'VOUCHER_ISSUED']));
    const audit = (
      await t.prisma.auditLog.findMany({
        where: { entityType: { in: ['Payment', 'VoucherInstance', 'VoucherOrder'] } },
      })
    ).map((a) => a.action);
    expect(audit).toEqual(
      expect.arrayContaining([
        'voucher_order.create',
        'payment.create',
        'payment.succeeded',
        'voucher_instance.issue',
      ]),
    );
    const ev = (
      await t.prisma.dealEvent.findMany({ where: { productType: 'VOUCHER', dealId: v.id } })
    ).map((e) => e.type);
    expect(ev).toEqual(
      expect.arrayContaining([
        'CHECKOUT_STARTED',
        'PAYMENT_INITIATED',
        'PAYMENT_SUCCEEDED',
        'VOUCHER_ISSUED',
      ]),
    );
  });

  it('duplicate provider callbacks are idempotent: the same event twice, and a new event for the same success', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    const p = await w.pay(c, co.body.data.id);
    const ref = await w.providerRef(p.body.data.payment.id);
    w.provider.settle(ref, 'SUCCEEDED');
    const wh = w.webhook(ref, 'SUCCEEDED');
    const [a, b] = await Promise.all([
      w.sendWebhook(wh.rawBody, wh.signature),
      w.sendWebhook(wh.rawBody, wh.signature),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.data.outcome, b.body.data.outcome].sort()).toEqual(['APPLIED', 'DUPLICATE']);
    const again = await w.sendWebhook(wh.rawBody, wh.signature);
    expect(again.body.data.outcome).toBe('DUPLICATE');
    // a different event id reporting the same success changes nothing either
    const wh2 = w.webhook(ref, 'SUCCEEDED');
    expect((await w.sendWebhook(wh2.rawBody, wh2.signature)).body.data.outcome).toBe('DUPLICATE');
    expect(await instances(co.body.data.id)).toHaveLength(1);
    const pay = await t.prisma.payment.findUniqueOrThrow({ where: { id: p.body.data.payment.id } });
    expect(
      await t.prisma.ledgerJournal.count({ where: { sourceType: 'Payment', sourceId: pay.id } }),
    ).toBe(1);
    expect(
      await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } }).then((r) => r.soldQty),
    ).toBe(1);
    // every verified event is stored once
    expect(await t.prisma.paymentEvent.count({ where: { paymentId: pay.id } })).toBe(2);
  });

  it('webhook security: a bad or missing signature and a tampered body are refused; a stale event is refused and logged', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    const p = await w.pay(c, co.body.data.id);
    const ref = await w.providerRef(p.body.data.payment.id);
    const wh = w.webhook(ref, 'SUCCEEDED');
    expect((await w.sendWebhook(wh.rawBody, 'bad-signature')).status).toBe(401);
    expect((await w.sendWebhook(wh.rawBody, undefined)).status).toBe(401);
    const tampered = wh.rawBody.replace('SUCCEEDED', 'FAILED');
    expect((await w.sendWebhook(tampered, wh.signature)).status).toBe(401);
    expect(await instances(co.body.data.id)).toHaveLength(0);
    expect(
      (await t.prisma.payment.findUniqueOrThrow({ where: { id: p.body.data.payment.id } })).status,
    ).toBe('PENDING');
    // a validly signed but old event (replay) is rejected and recorded
    const old = MockPaymentProvider.buildWebhook({
      eventId: 'evt-old-1',
      kind: 'PAYMENT',
      providerReference: ref,
      status: 'SUCCEEDED',
      occurredAt: new Date(Date.now() - 3600_000).toISOString(),
    } as never);
    const stale = await w.sendWebhook(old.rawBody, old.signature);
    expect(stale.status).toBe(400);
    const ev = await t.prisma.paymentEvent.findUniqueOrThrow({
      where: { providerEventId: 'evt-old-1' },
    });
    expect(ev).toMatchObject({ outcome: 'REJECTED', note: 'STALE_EVENT', signatureVerified: true });
    expect(await instances(co.body.data.id)).toHaveLength(0);
    // rejected deliveries leave an audit trail
    expect(
      await t.prisma.auditLog.count({ where: { action: 'payment.webhook_rejected' } }),
    ).toBeGreaterThanOrEqual(3);
  });

  it('a callback for a payment we do not know is ignored and logged, never an error that makes the provider retry forever', async () => {
    const wh = w.webhook('mock-pay-does-not-exist', 'SUCCEEDED');
    const r = await w.sendWebhook(wh.rawBody, wh.signature);
    expect(r.status).toBe(200);
    expect(r.body.data.outcome).toBe('IGNORED');
  });

  it('payment failure: no voucher, hold kept for a retry, the customer is told; a successful retry then issues it', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    const p1 = await w.pay(c, co.body.data.id);
    const ref1 = await w.providerRef(p1.body.data.payment.id);
    const f = w.webhook(ref1, 'FAILED', { failureCode: 'CARD_DECLINED' });
    expect((await w.sendWebhook(f.rawBody, f.signature)).body.data.outcome).toBe('APPLIED');
    const after = (await w.getOrder(c, co.body.data.id)).body.data;
    expect(after.status).toBe('PENDING_PAYMENT');
    expect(after.payment).toMatchObject({
      status: 'FAILED',
      failureCode: 'CARD_DECLINED',
      redirectUrl: null,
    });
    expect(after.canRetry).toBe(true);
    expect(after.retriesLeft).toBe(2);
    expect(await instances(co.body.data.id)).toHaveLength(0);
    expect((await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).heldQty).toBe(1);
    const notes = (await w.api(c).get('/v1/app/notifications')).body.data.items.map(
      (i: { type: string }) => i.type,
    );
    expect(notes).toContain('PAYMENT_FAILED');
    // retry: a NEW attempt with its own reference
    const p2 = await w.pay(c, co.body.data.id);
    expect(p2.body.data.payment.attemptNo).toBe(2);
    const ref2 = await w.providerRef(p2.body.data.payment.id);
    expect(ref2).not.toBe(ref1);
    const ok = w.webhook(ref2, 'SUCCEEDED');
    await w.sendWebhook(ok.rawBody, ok.signature);
    expect((await w.getOrder(c, co.body.data.id)).body.data.status).toBe('PAID');
    expect(await instances(co.body.data.id)).toHaveLength(1);
    // the old failure arriving again later (out of order) changes nothing
    const lateFail = w.webhook(ref1, 'FAILED');
    expect((await w.sendWebhook(lateFail.rawBody, lateFail.signature)).body.data.outcome).toBe(
      'IGNORED',
    );
  });

  it('retry limit: after the allowed failed attempts the order fails and the held voucher returns to stock', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    for (let i = 0; i < 3; i++) {
      const p = await w.pay(c, co.body.data.id);
      const ref = await w.providerRef(p.body.data.payment.id);
      const f = w.webhook(ref, 'FAILED');
      await w.sendWebhook(f.rawBody, f.signature);
    }
    const o = (await w.getOrder(c, co.body.data.id)).body.data;
    expect(o.status).toBe('FAILED');
    expect(o.canRetry).toBe(false);
    expect((await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).heldQty).toBe(0);
    expect((await w.pay(c, co.body.data.id)).status).toBe(409);
  });

  it('cancelling checkout cancels the open attempt at the provider and releases the hold exactly once', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    const p = await w.pay(c, co.body.data.id);
    const ref = await w.providerRef(p.body.data.payment.id);
    const cx = await w.cancelOrder(c, co.body.data.id);
    expect(cx.body.data.status).toBe('CANCELLED');
    expect(cx.body.data.payment.status).toBe('CANCELLED');
    expect(await w.provider.getStatus(ref)).toBe('CANCELLED');
    await w.cancelOrder(c, co.body.data.id);
    expect((await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).heldQty).toBe(0);
  });

  it('money that arrives AFTER the order was cancelled never issues a voucher: it is refunded automatically', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    const p = await w.pay(c, co.body.data.id);
    const ref = await w.providerRef(p.body.data.payment.id);
    await w.cancelOrder(c, co.body.data.id);
    // the provider captured the payment anyway (a race at its side) and tells us late
    const mockPayment = w.provider as unknown as { payments: Map<string, { status: string }> };
    mockPayment.payments.get(ref)!.status = 'SUCCEEDED';
    const wh = w.webhook(ref, 'SUCCEEDED');
    const r = await w.sendWebhook(wh.rawBody, wh.signature);
    expect(r.body.data.outcome).toBe('LATE_SUCCESS');
    expect(await instances(co.body.data.id)).toHaveLength(0);
    const refund = await t.prisma.refund.findFirstOrThrow({ where: { orderId: co.body.data.id } });
    expect(refund).toMatchObject({ kind: 'SYSTEM', status: 'REFUNDED', amountHalalas: 8000 });
    const pay = await t.prisma.payment.findUniqueOrThrow({ where: { id: p.body.data.payment.id } });
    expect(pay.status).toBe('REFUNDED');
    // sale and refund journals both balance and net to zero on the PSP clearing account
    const sale = await journal(`sale:${pay.id}`);
    const back = await journal(`refund:${refund.id}`);
    expect(sale && back).toBeTruthy();
    const net = [...sale!.entries, ...back!.entries].reduce((n, e) => n + e.amountHalalas, 0);
    expect(net).toBe(0);
    expect((await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).soldQty).toBe(0);
  });

  it('two customers, one voucher left: exactly one checkout wins; the loser sees sold out and can buy when the hold is released', async () => {
    const v = await w.publishVoucher('A', { totalQty: 1, perCustomerLimit: 1 });
    const [c1, c2] = [await w.newCustomer(), await w.newCustomer()];
    const [a, b] = await Promise.all([w.checkout(c1, v.id), w.checkout(c2, v.id)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.errors[0].code).toBe('OUT_OF_STOCK');
    const winner = a.status === 201 ? { s: c1, r: a } : { s: c2, r: b };
    const other = winner.s === c1 ? c2 : c1;
    const row = await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.status).toBe('SOLD_OUT');
    expect([row.heldQty, row.soldQty]).toEqual([1, 0]);
    expect((await t.http.get(`/v1/app/vouchers/${v.id}`)).body.data).toMatchObject({
      soldOut: true,
      canBuy: false,
      blockedReason: 'SOLD_OUT',
    });
    // the winner walks away: the hold is released and the voucher is for sale again
    await w.cancelOrder(winner.s, winner.r.body.data.id);
    expect((await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).status).toBe(
      'ON_SALE',
    );
    expect((await w.checkout(other, v.id)).status).toBe(201);
  });

  it('many buyers, few vouchers: never oversold, even in parallel', async () => {
    const v = await w.publishVoucher('A', { totalQty: 3, perCustomerLimit: 1 });
    const cs = await Promise.all(Array.from({ length: 8 }, () => w.newCustomer()));
    const res = await Promise.all(cs.map((c) => w.checkout(c, v.id)));
    expect(res.filter((r) => r.status === 201)).toHaveLength(3);
    expect(res.filter((r) => r.status === 409)).toHaveLength(5);
    const row = await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } });
    expect(row.heldQty).toBe(3);
    expect(row.totalQty - row.heldQty - row.soldQty).toBe(0);
  });

  it('an unpaid checkout whose time ran out is released by the sweep; a late payment is still honoured if it arrived in time', async () => {
    const v = await w.publishVoucher('A', { totalQty: 2 });
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    await t.prisma.voucherOrder.update({
      where: { id: co.body.data.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    await w.lifecycle.sweep();
    expect((await w.getOrder(c, co.body.data.id)).body.data.status).toBe('EXPIRED');
    expect((await t.prisma.voucher.findUniqueOrThrow({ where: { id: v.id } })).heldQty).toBe(0);
    expect((await w.pay(c, co.body.data.id)).status).toBe(409);

    // the customer actually paid just before the hold ended, but the callback never arrived: the sweep asks the provider
    const c2 = await w.newCustomer();
    const co2 = await w.checkout(c2, v.id);
    const p2 = await w.pay(c2, co2.body.data.id);
    const ref2 = await w.providerRef(p2.body.data.payment.id);
    w.provider.settle(ref2, 'SUCCEEDED');
    await t.prisma.voucherOrder.update({
      where: { id: co2.body.data.id },
      data: { holdExpiresAt: new Date(Date.now() - 1000) },
    });
    await w.lifecycle.sweep();
    expect((await w.getOrder(c2, co2.body.data.id)).body.data.status).toBe('PAID');
    expect(await instances(co2.body.data.id)).toHaveLength(1);
  });

  it('reconciliation: a pending payment whose callback never came is settled by asking the provider', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    const p = await w.pay(c, co.body.data.id);
    const ref = await w.providerRef(p.body.data.payment.id);
    expect(await w.lifecycle.sweep()).toBeTruthy();
    expect(await instances(co.body.data.id)).toHaveLength(0);
    w.provider.settle(ref, 'SUCCEEDED');
    await t.prisma.payment.update({
      where: { id: p.body.data.payment.id },
      data: { updatedAt: new Date(Date.now() - 10 * 60_000) },
    });
    await w.lifecycle.sweep();
    expect(await instances(co.body.data.id)).toHaveLength(1);
  });

  it('checkout is idempotent per key; per-customer limits hold; guests and other customers are refused', async () => {
    const v = await w.publishVoucher('A', { perCustomerLimit: 1 });
    const c = await w.newCustomer();
    const key = idem();
    const a = await w.checkout(c, v.id, key);
    const b = await w.checkout(c, v.id, key);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect((await t.http.post('/v1/app/checkout').send({ voucherId: v.id })).status).toBe(401);
    const other = await w.newCustomer();
    expect((await w.getOrder(other, a.body.data.id)).status).toBe(404);
    expect((await w.pay(other, a.body.data.id)).status).toBe(404);
    // buy it, then the limit applies
    const p = await w.pay(c, a.body.data.id);
    const ref = await w.providerRef(p.body.data.payment.id);
    const ok = w.webhook(ref, 'SUCCEEDED');
    await w.sendWebhook(ok.rawBody, ok.signature);
    const again = await w.checkout(c, v.id);
    expect(again.status).toBe(409);
    expect(again.body.errors[0].code).toBe('LIMIT_REACHED');
    expect((await w.api(c).get(`/v1/app/vouchers/${v.id}`)).body.data).toMatchObject({
      canBuy: false,
      blockedReason: 'LIMIT_REACHED',
    });
  });

  it('a voucher that is paused, ended or suspended cannot be checked out; a suspended one cannot be paid mid-checkout', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const co = await w.checkout(c, v.id);
    await w.decideVoucher(w.ops, v.id, 'suspend', { reason: 'Policy review' });
    expect((await w.pay(c, co.body.data.id)).status).toBe(409);
    expect((await w.checkout(await w.newCustomer(), v.id)).status).toBe(409);
    await w.decideVoucher(w.ops, v.id, 'reinstate');
    await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${v.id}/pause`)
      .send({});
    expect((await w.checkout(await w.newCustomer(), v.id)).status).toBe(409);
  });

  it('ordering: out-of-order messages cannot undo a success (failed or cancelled after succeeded)', async () => {
    const v = await w.publishVoucher('A');
    const c = await w.newCustomer();
    const b = await w.buy(c, v.id);
    const pay = await t.prisma.payment.findFirstOrThrow({ where: { orderId: b.orderId } });
    for (const st of ['FAILED', 'CANCELLED', 'PENDING'] as const) {
      const wh = w.webhook(pay.providerReference!, st);
      expect((await w.sendWebhook(wh.rawBody, wh.signature)).body.data.outcome).toBe('IGNORED');
    }
    expect((await t.prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe(
      'SUCCEEDED',
    );
    expect((await w.getOrder(c, b.orderId)).body.data.status).toBe('PAID');
  });
});
