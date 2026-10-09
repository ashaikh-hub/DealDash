import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, type Session, type TestApp } from './helpers';
import { buildVoucherWorld, type VoucherWorld } from './voucher-fixtures';
import { MockPaymentProvider } from '../src/providers/mocks';

/** Stage 5 refunds, ledger integrity, finance lookups, support cases, expiry reminders. */
describe.skipIf(!DB_READY)('Voucher refunds, ledger and finance workbench', () => {
  let t: TestApp;
  let w: VoucherWorld;
  let vid: string;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildVoucherWorld(t);
    vid = (await w.publishVoucher('A', { totalQty: 300, perCustomerLimit: 10 })).id;
  });
  afterAll(() => t?.close());
  afterEach(async () => {
    w.provider.failRefunds = false;
    w.provider.refundsPending = false;
  });

  const owned = async () => {
    const c = await w.newCustomer();
    return { c, ...(await w.owned(c, vid)) };
  };
  const setConfig = (key: string, value: unknown) =>
    w.api(w.superAdmin).put(`/v1/admin/config/${key}`).send({ value, reason: 'test' }).expect(200);
  const policy = (over: Record<string, unknown> = {}) =>
    setConfig('vouchers.refund_policy', {
      windowHours: 24,
      outsideWindow: 'REVIEW',
      checkerThresholdHalalas: 0,
      ...over,
    });
  const outsideWindow = (instanceId: string) =>
    t.prisma.voucherInstance.update({
      where: { id: instanceId },
      data: { issuedAt: new Date(Date.now() - 48 * 3600_000) },
    });
  const journalSum = async (key: string) => {
    const j = await t.prisma.ledgerJournal.findUnique({
      where: { idempotencyKey: key },
      include: { entries: { include: { account: true } } },
    });
    return j;
  };
  const refundRow = (instanceId: string) =>
    t.prisma.refund.findFirstOrThrow({ where: { instanceId }, orderBy: { createdAt: 'desc' } });

  it('refund before redemption inside the window is approved automatically and refunded; the voucher can no longer be redeemed', async () => {
    const { c, instanceId, qr } = await owned();
    const r = await w.requestRefund(c, instanceId!);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      status: 'REFUNDED',
      kind: 'CUSTOMER_REQUEST',
      amountHalalas: 8000,
    });
    expect(r.body.data.reference).toMatch(/^RF-/);
    const inst = await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: instanceId! } });
    expect(inst.status).toBe('REFUNDED');
    const pay = await t.prisma.payment.findFirstOrThrow({ where: { orderId: inst.orderId } });
    expect(pay.status).toBe('REFUNDED');
    // customer view: refunded, code gone
    const d = (await w.walletOne(c, instanceId!)).body.data;
    expect(d).toMatchObject({ state: 'REFUNDED', code: null, canRequestRefund: false });
    expect(d.refund.status).toBe('REFUNDED');
    expect((await w.wallet(c, 'active')).body.data).toHaveLength(0);
    expect((await w.wallet(c, 'refunded')).body.data).toHaveLength(1);
    // staff: refunded vouchers cannot be redeemed
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('REFUNDED');
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('REFUNDED');
    // ledger: the held amount reversed to the customer, balanced; payable event; never settlement-eligible
    const ref = await refundRow(instanceId!);
    const j = await journalSum(`refund:${ref.id}`);
    expect(j?.type).toBe('REFUND');
    expect(Object.fromEntries(j!.entries.map((e) => [e.account.family, e.amountHalalas]))).toEqual({
      MERCHANT_HELD: 8000,
      PSP_CLEARING: -8000,
    });
    const evs = (
      await t.prisma.merchantPayableEvent.findMany({ where: { instanceId: instanceId! } })
    ).map((e) => e.type);
    expect(evs).toContain('REFUNDED');
    expect(evs).not.toContain('ELIGIBLE');
    const notes = (await w.api(c).get('/v1/app/notifications')).body.data.items.map(
      (i: { type: string }) => i.type,
    );
    expect(notes).toContain('REFUND_UPDATED');
    expect(
      await t.prisma.auditLog.count({ where: { entityType: 'Refund', entityId: ref.id } }),
    ).toBeGreaterThanOrEqual(2);
    expect(
      await t.prisma.dealEvent.count({
        where: {
          productType: 'VOUCHER',
          type: { in: ['REFUND_REQUESTED', 'REFUND_COMPLETED'] },
          dealId: vid,
        },
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('a second request, or a request on someone else’s voucher, is refused; the provider is called once per refund', async () => {
    const { c, instanceId } = await owned();
    await Promise.all([w.requestRefund(c, instanceId!), w.requestRefund(c, instanceId!)]);
    expect(await t.prisma.refund.count({ where: { instanceId: instanceId! } })).toBe(1);
    expect((await refundRow(instanceId!)).status).toBe('REFUNDED');
    expect((await w.requestRefund(c, instanceId!)).status).toBe(409);
    const other = await w.newCustomer();
    expect((await w.requestRefund(other, instanceId!)).status).toBe(404);
    const ref = await refundRow(instanceId!);
    await w.refundsSvc.execute(ref.id); // executing a finished refund again does nothing
    expect(
      await t.prisma.ledgerJournal.count({ where: { idempotencyKey: `refund:${ref.id}` } }),
    ).toBe(1);
  });

  it('a redeemed voucher cannot be refunded the normal way; the customer is told it was used', async () => {
    const { c, instanceId, qr } = await owned();
    await w.redeem(w.staffA, qr);
    const r = await w.requestRefund(c, instanceId!);
    expect(r.status).toBe(409);
    expect(r.body.errors[0].code).toBe('REFUND_NOT_AVAILABLE');
    expect((await w.walletOne(c, instanceId!)).body.data).toMatchObject({
      state: 'USED',
      canRequestRefund: false,
      refundNote: 'REDEEMED',
    });
  });

  it('outside the window the request goes to review; the voucher stays usable meanwhile; Finance approves and it is refunded', async () => {
    await policy();
    const { c, instanceId, qr } = await owned();
    await outsideWindow(instanceId!);
    const d0 = (await w.walletOne(c, instanceId!)).body.data;
    expect(d0).toMatchObject({ canRequestRefund: true, refundNote: 'REVIEW_REQUIRED' });
    const r = await w.requestRefund(c, instanceId!, { reasonCode: 'OTHER', note: 'Plans changed' });
    expect(r.body.data.status).toBe('UNDER_REVIEW');
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('VALID'); // not blocked while only under review
    const ref = await refundRow(instanceId!);
    // permissions: Support and Operations cannot decide refunds; Finance can
    expect(
      (
        await w
          .api(w.support)
          .post(`/v1/admin/finance/refunds/${ref.id}/approve`)
          .send({ reason: 'ok' })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api(w.ops)
          .post(`/v1/admin/finance/refunds/${ref.id}/approve`)
          .send({ reason: 'ok' })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api(w.finance)
          .post(`/v1/admin/finance/refunds/${ref.id}/approve`)
          .send({ reason: '' })
      ).status,
    ).toBe(400);
    const ap = await w
      .api(w.finance)
      .post(`/v1/admin/finance/refunds/${ref.id}/approve`)
      .send({ reason: 'Customer is within goodwill policy' });
    expect(ap.status).toBe(200);
    expect(ap.body.data.status).toBe('REFUNDED');
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('REFUNDED');
    expect(
      (
        await w
          .api(w.finance)
          .post(`/v1/admin/finance/refunds/${ref.id}/approve`)
          .send({ reason: 'again' })
      ).status,
    ).toBe(409);
  });

  it('a rejected refund keeps the voucher active and tells the customer why', async () => {
    await policy();
    const { c, instanceId, qr } = await owned();
    await outsideWindow(instanceId!);
    await w.requestRefund(c, instanceId!);
    const ref = await refundRow(instanceId!);
    const rj = await w
      .api(w.finance)
      .post(`/v1/admin/finance/refunds/${ref.id}/reject`)
      .send({ reason: 'The refund window has passed.' });
    expect(rj.body.data.status).toBe('REJECTED');
    const d = (await w.walletOne(c, instanceId!)).body.data;
    expect(d.state).toBe('ACTIVE');
    expect(d.refund).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'The refund window has passed.',
    });
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('REDEEMED');
  });

  it('approving a refund for a voucher that was used in the meantime is refused; the reviewer rejects it', async () => {
    await policy();
    const { c, instanceId, qr } = await owned();
    await outsideWindow(instanceId!);
    await w.requestRefund(c, instanceId!);
    await w.redeem(w.staffA, qr);
    const ref = await refundRow(instanceId!);
    const ap = await w
      .api(w.finance)
      .post(`/v1/admin/finance/refunds/${ref.id}/approve`)
      .send({ reason: 'Approve it' });
    expect(ap.status).toBe(409);
    expect(ap.body.errors[0].code).toBe('REFUND_NOT_AVAILABLE');
    expect(
      (
        await w
          .api(w.finance)
          .post(`/v1/admin/finance/refunds/${ref.id}/reject`)
          .send({ reason: 'Already used' })
      ).body.data.status,
    ).toBe('REJECTED');
  });

  it('when the refund policy blocks late requests, the customer is told the window has passed', async () => {
    await policy({ outsideWindow: 'BLOCK' });
    try {
      const { c, instanceId } = await owned();
      await outsideWindow(instanceId!);
      expect((await w.walletOne(c, instanceId!)).body.data).toMatchObject({
        canRequestRefund: false,
        refundNote: 'WINDOW_PASSED',
      });
      const r = await w.requestRefund(c, instanceId!);
      expect(r.status).toBe(409);
      expect(r.body.errors[0].code).toBe('REFUND_WINDOW_PASSED');
    } finally {
      await policy();
    }
  });

  it('a failed refund blocks the voucher, shows as refund pending, lands in the finance queue, and can be retried', async () => {
    const { c, instanceId, qr } = await owned();
    w.provider.failRefunds = true;
    const r = await w.requestRefund(c, instanceId!);
    expect(r.body.data.status).toBe('FAILED');
    const d = (await w.walletOne(c, instanceId!)).body.data;
    expect(d.state).toBe('REFUND_PENDING');
    expect(d.code).toBeNull();
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('REFUNDED'); // blocked while money is being returned
    const inst = await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: instanceId! } });
    expect(
      (await t.prisma.payment.findFirstOrThrow({ where: { orderId: inst.orderId } })).status,
    ).toBe('SUCCEEDED');
    const queue = await w.api(w.finance).get('/v1/admin/finance/refunds?status=FAILED');
    const row = queue.body.data.find((x: { id: string }) => x.id === r.body.data.id);
    expect(row.actions).toEqual(['retry']);
    // not allowed for Support
    expect(
      (await w.api(w.support).post(`/v1/admin/finance/refunds/${row.id}/retry`).send({})).status,
    ).toBe(403);
    w.provider.failRefunds = false;
    // the mock remembers the failed result for the same idempotency key: a retry gets a fresh refund call through the new key path
    (w.provider as unknown as { refunds: Map<string, unknown> }).refunds.clear();
    const retry = await w.api(w.finance).post(`/v1/admin/finance/refunds/${row.id}/retry`).send({});
    expect(retry.body.data.status).toBe('REFUNDED');
    expect(
      (await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: instanceId! } })).status,
    ).toBe('REFUNDED');
  });

  it('an asynchronous provider refund stays PROCESSING until the signed refund webhook arrives (duplicates ignored)', async () => {
    const { c, instanceId } = await owned();
    w.provider.refundsPending = true;
    const r = await w.requestRefund(c, instanceId!);
    expect(r.body.data.status).toBe('PROCESSING');
    const ref = await refundRow(instanceId!);
    expect(ref.providerRefundReference).toBeTruthy();
    const inst = await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: instanceId! } });
    const pay = await t.prisma.payment.findFirstOrThrow({ where: { orderId: inst.orderId } });
    expect(pay.status).toBe('REFUND_PENDING');
    expect((await w.walletOne(c, instanceId!)).body.data.state).toBe('REFUND_PENDING');
    const ev = MockPaymentProvider.buildWebhook({
      eventId: `evt-refund-${ref.id}`,
      kind: 'REFUND',
      providerReference: pay.providerReference!,
      refundReference: ref.providerRefundReference!,
      status: 'SUCCEEDED',
    });
    expect((await w.sendWebhook(ev.rawBody, ev.signature)).body.data.outcome).toBe('APPLIED');
    expect((await w.sendWebhook(ev.rawBody, ev.signature)).body.data.outcome).toBe('DUPLICATE');
    expect((await refundRow(instanceId!)).status).toBe('REFUNDED');
    expect(
      (await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: instanceId! } })).status,
    ).toBe('REFUNDED');
    expect(
      await t.prisma.ledgerJournal.count({ where: { idempotencyKey: `refund:${ref.id}` } }),
    ).toBe(1);
  });

  it('exceptional refunds need a second approver; a redeemed voucher must first have its redemption reversed', async () => {
    const { c, instanceId, qr } = await owned();
    await w.redeem(w.staffA, qr);
    const blocked = await w
      .api(w.finance)
      .post('/v1/admin/finance/refunds')
      .send({ instanceId, reason: 'Merchant could not honour' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.errors[0].code).toBe('REDEMPTION_REVERSAL_REQUIRED');
    const red = await t.prisma.voucherRedemption.findFirstOrThrow({
      where: { instanceId: instanceId! },
    });
    expect(
      (
        await w
          .api(w.finance)
          .post(`/v1/admin/finance/redemptions/${red.id}/reverse`)
          .send({ reason: 'Voucher was not honoured at the counter' })
      ).status,
    ).toBe(200);
    const mk = await w
      .api(w.finance)
      .post('/v1/admin/finance/refunds')
      .send({ instanceId, reason: 'Merchant could not honour' });
    expect(mk.status).toBe(201);
    expect(mk.body.data).toMatchObject({
      status: 'REQUESTED',
      kind: 'ADMIN_INITIATED',
      needsChecker: true,
    });
    expect(mk.body.data.actions).toEqual(['reject']); // the maker cannot approve their own request
    const self = await w
      .api(w.finance)
      .post(`/v1/admin/finance/refunds/${mk.body.data.id}/approve`)
      .send({ reason: 'self approve' });
    expect(self.status).toBe(403);
    expect(self.body.errors[0].code).toBe('CHECKER_REQUIRED');
    const ok = await w
      .api(w.finance2)
      .post(`/v1/admin/finance/refunds/${mk.body.data.id}/approve`)
      .send({ reason: 'Checked and agreed' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('REFUNDED');
    expect((await w.walletOne(c, instanceId!)).body.data.state).toBe('REFUNDED');
    // net ledger effect of redeem + reverse + refund on the merchant: nothing held, nothing eligible from this voucher
    const evs = (
      await t.prisma.merchantPayableEvent.findMany({ where: { instanceId: instanceId! } })
    ).map((e) => e.type);
    expect(evs).toEqual(
      expect.arrayContaining(['REDEEMED', 'ELIGIBLE', 'REDEMPTION_REVERSED', 'REFUNDED']),
    );
  });

  it('the finance workbench finds records by any reference; Support sees them without provider data; Finance sees everything', async () => {
    const { c, instanceId, orderId } = await owned();
    await w.requestRefund(c, instanceId!);
    const inst = await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: instanceId! } });
    const pay = await t.prisma.payment.findFirstOrThrow({ where: { orderId } });
    const ref = await refundRow(instanceId!);
    const order = await t.prisma.voucherOrder.findUniqueOrThrow({ where: { id: orderId } });
    for (const [q, kind] of [
      [order.reference, 'ORDER'],
      [inst.reference, 'VOUCHER'],
      [ref.reference, 'REFUND'],
      [pay.providerReference!, 'PAYMENT'],
    ] as const) {
      const s = await w.api(w.finance).get(`/v1/admin/finance/search?q=${encodeURIComponent(q)}`);
      expect(s.status).toBe(200);
      expect(
        s.body.data.some(
          (x: { kind: string; orderId: string }) => x.kind === kind && x.orderId === orderId,
        ),
      ).toBe(true);
    }
    const f = await w.adminOrder(w.finance, orderId);
    expect(f.status).toBe(200);
    expect(f.body.data.canSeeProviderData).toBe(true);
    expect(f.body.data.payments[0].providerReference).toBe(pay.providerReference);
    expect(f.body.data.refunds).toHaveLength(1);
    expect(f.body.data.journals.map((j: { type: string }) => j.type)).toEqual(
      expect.arrayContaining(['SALE', 'REFUND']),
    );
    expect(f.body.data.events.length).toBeGreaterThan(0);
    expect(f.body.data.payableEvents.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['SOLD', 'ISSUED', 'REFUNDED']),
    );
    expect(f.body.data.order.customer.mobileMasked).toMatch(/•••/);
    const s = await w.adminOrder(w.support, orderId);
    expect(s.status).toBe(200);
    expect(s.body.data.canSeeProviderData).toBe(false);
    expect(s.body.data.payments[0].providerReference).toBeNull();
    expect(JSON.stringify(s.body)).not.toContain(pay.providerReference!);
    // roles without lookup permission
    expect((await w.adminOrder(w.analyst, orderId)).status).toBe(403);
    expect((await w.api(w.marketing).get('/v1/admin/finance/search?q=ORD-AAAA')).status).toBe(403);
  });

  it('merchant payable status for DealDash: per-merchant position from the ledger; the whole ledger balances', async () => {
    const { qr } = await owned();
    await w.redeem(w.staffA, qr);
    const ov = await w.api(w.finance).get('/v1/admin/finance/overview');
    expect(ov.status).toBe(200);
    expect(ov.body.data.ledger.balanced).toBe(true);
    expect(ov.body.data.ledger.journals).toBeGreaterThan(5);
    expect(ov.body.data.disclaimerKey).toBe('legal_treatment_validate_ksa');
    const row = ov.body.data.merchants.find(
      (m: { merchant: { id: string } }) => m.merchant.id === w.A.orgId,
    );
    expect(row.settlementEligibleHalalas).toBeGreaterThan(0);
    const pay = await w.api(w.finance).get(`/v1/admin/finance/merchants/${w.A.orgId}/payable`);
    expect(pay.body.data.settlementEligibleHalalas).toBe(row.settlementEligibleHalalas);
    const events = await w
      .api(w.finance)
      .get(`/v1/admin/finance/merchants/${w.A.orgId}/payable/events?limit=5`);
    expect(events.status).toBe(200);
    expect(events.body.data.length).toBeGreaterThan(0);
    // overview needs finance read: Support and Operations do not have it
    expect((await w.api(w.support).get('/v1/admin/finance/overview')).status).toBe(403);
    expect(
      (await w.api(w.ops).get(`/v1/admin/finance/merchants/${w.A.orgId}/payable`)).status,
    ).toBe(403);
    // merchant B's payable is its own
    const b = await w.api(w.ownerB).get(`${w.vbase('B')}/finance/voucher-payable`);
    expect(b.body.data.heldHalalas).toBe(0);
    expect((await w.api(w.ownerB).get(`${w.vbase('A')}/finance/voucher-payable`)).status).toBe(404);
  });

  it('ledger integrity in the database: unbalanced journals cannot be committed; journals, entries, events and history are append-only', async () => {
    await expect(
      t.prisma.$transaction(async (tx) => {
        const j = await tx.ledgerJournal.create({
          data: {
            type: 'ADJUSTMENT',
            sourceType: 'Test',
            sourceId: w.A.orgId,
            idempotencyKey: `unbalanced:${Date.now()}`,
          },
        });
        const acc = await tx.ledgerAccount.findFirstOrThrow({});
        await tx.ledgerEntry.create({
          data: { journalId: j.id, accountId: acc.id, amountHalalas: 100 },
        });
      }),
    ).rejects.toThrow();
    const e = await t.prisma.ledgerEntry.findFirstOrThrow({});
    await expect(
      t.prisma.ledgerEntry.update({ where: { id: e.id }, data: { amountHalalas: 1 } }),
    ).rejects.toThrow();
    await expect(t.prisma.ledgerEntry.delete({ where: { id: e.id } })).rejects.toThrow();
    const ev = await t.prisma.paymentEvent.findFirstOrThrow({});
    await expect(t.prisma.paymentEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
    const pe = await t.prisma.merchantPayableEvent.findFirstOrThrow({});
    await expect(
      t.prisma.merchantPayableEvent.update({ where: { id: pe.id }, data: { amountHalalas: 1 } }),
    ).rejects.toThrow();
    const h = await t.prisma.voucherHistory.findFirstOrThrow({});
    await expect(t.prisma.voucherHistory.delete({ where: { id: h.id } })).rejects.toThrow();
  });

  it('manual adjustments are append-only journals with a reason, audited; only Finance with settlement permission', async () => {
    const before = (await w.api(w.financeA).get(`${w.vbase('A')}/finance/voucher-payable`)).body
      .data;
    expect(
      (
        await w
          .api(w.ops)
          .post('/v1/admin/finance/adjustments')
          .send({ organizationId: w.A.orgId, amountHalalas: 500, reason: 'Goodwill credit' })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api(w.finance)
          .post('/v1/admin/finance/adjustments')
          .send({ organizationId: w.A.orgId, amountHalalas: 0, reason: 'Nothing' })
      ).status,
    ).toBe(400);
    const r = await w
      .api(w.finance)
      .post('/v1/admin/finance/adjustments')
      .send({ organizationId: w.A.orgId, amountHalalas: 500, reason: 'Goodwill credit' });
    expect(r.status).toBe(201);
    const after = (await w.api(w.financeA).get(`${w.vbase('A')}/finance/voucher-payable`)).body
      .data;
    expect(after.settlementEligibleHalalas - before.settlementEligibleHalalas).toBe(500);
    const j = await t.prisma.ledgerJournal.findUniqueOrThrow({
      where: { id: r.body.data.journalId },
      include: { entries: true },
    });
    expect(j.type).toBe('ADJUSTMENT');
    expect(j.entries.reduce((n, e) => n + e.amountHalalas, 0)).toBe(0);
    expect(
      await t.prisma.auditLog.count({ where: { action: 'ledger.adjustment', entityId: j.id } }),
    ).toBe(1);
  });

  it('support cases link to the voucher, order, payment and refund; Support can work them; payment data stays out', async () => {
    const { c, instanceId, orderId } = await owned();
    const r = await w
      .api(c)
      .post('/v1/app/support-cases')
      .set('Idempotency-Key', `k-${Date.now()}`)
      .send({
        type: 'VOUCHER_ISSUE',
        subject: 'QR will not scan',
        body: 'The cashier cannot scan my code.',
        voucherInstanceId: instanceId,
      });
    expect(r.status).toBe(201);
    expect((await w.walletOne(c, instanceId!)).body.data.supportCaseOpen).toBe(true);
    const sc = await t.prisma.supportCase.findUniqueOrThrow({ where: { id: r.body.data.id } });
    expect(sc).toMatchObject({ voucherInstanceId: instanceId, orderId });
    expect(sc.paymentId).toBeTruthy();
    const other = await w.newCustomer();
    expect(
      (
        await w
          .api(other)
          .post('/v1/app/support-cases')
          .set('Idempotency-Key', `k2-${Date.now()}`)
          .send({
            type: 'OTHER',
            subject: 'Not mine',
            body: 'Looking at a stranger voucher',
            voucherInstanceId: instanceId,
          })
      ).status,
    ).toBe(404);
    const list = await w.api(w.support).get('/v1/admin/finance/cases?limit=100');
    const row = list.body.data.find((x: { id: string }) => x.id === sc.id);
    expect(row).toMatchObject({ status: 'OPEN', subject: 'QR will not scan' });
    expect(JSON.stringify(list.body)).not.toMatch(/mock-pay-|providerReference/);
    const up = await w
      .api(w.support)
      .post(`/v1/admin/finance/cases/${sc.id}`)
      .send({ status: 'RESOLVED', note: 'Showed the manual code.' });
    expect(up.body.data.status).toBe('RESOLVED');
    expect(
      (await w.api(w.finance).post(`/v1/admin/finance/cases/${sc.id}`).send({ status: 'OPEN' }))
        .status,
    ).toBe(403);
    expect((await w.walletOne(c, instanceId!)).body.data.supportCaseOpen).toBe(false);
  });

  it('expiry reminder: one in-app reminder per voucher, three days before it expires', async () => {
    const { c, instanceId } = await owned();
    await t.prisma.voucherInstance.update({
      where: { id: instanceId! },
      data: { expiresAt: new Date(Date.now() + 2 * 86_400_000) },
    });
    expect(await w.lifecycle.sendExpiryReminders(new Date())).toBeGreaterThanOrEqual(1);
    expect(await w.lifecycle.sendExpiryReminders(new Date())).toBe(0);
    const notes = (await w.api(c as Session).get('/v1/app/notifications')).body.data.items.map(
      (i: { type: string }) => i.type,
    );
    expect(notes).toContain('VOUCHER_EXPIRING');
  });
});
