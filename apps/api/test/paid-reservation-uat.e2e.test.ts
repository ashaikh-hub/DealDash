import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RESERVATION_POLICY } from '@dealdash/config';
import { HotLifecycleService } from '../src/hot-deals/hot-lifecycle.service';
import { ReservationsService } from '../src/hot-deals/reservations.service';
import { PAYMENT_PROVIDER } from '../src/providers/interfaces';
import { MockPaymentProvider } from '../src/providers/mocks';
import { SystemConfigService } from '../src/system-config/system-config.service';
import { DB_READY, createTestApp, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

const MIN = 60_000;
const DEPOSIT = (extra: Record<string, unknown> = {}) => ({
  method: 'DEPOSIT',
  amountMinor: 1_000,
  depositRefundable: true,
  cancelCutoffMinutes: 15,
  noShowRefundPercent: null,
  ...extra,
});

/**
 * Founder UAT finding 2026-10-16 (paid limited-stock reservation), checks 3 to 10 end to end through the one shared reservation
 * engine: free still works, a paid reservation takes exactly one unit while it is paid for, a failed / lapsed payment releases the
 * unit, a repeated provider callback changes nothing, an expired reservation cannot be redeemed, cancel and refund update stock and
 * the ledger, staff validation (wrong branch, expired, already redeemed), every amount carries the market currency. Plus the deposit
 * treatment options (refundable on any cancellation; booking fee not credited to the bill) and the merchant monitor counts.
 */
describe.skipIf(!DB_READY)('Paid limited-stock reservation (founder UAT checks)', () => {
  let t: TestApp;
  let w: HotWorld;
  let provider: MockPaymentProvider;
  let seq = 0;
  const cfg = () => t.app.get(SystemConfigService);
  const actor = () => ({ userId: w.superAdmin.me.id, membership: null }) as never;
  const meta = { requestId: 'test', ip: '127.0.0.1', userAgent: 'vitest' } as never;

  const webhook = (body: Record<string, unknown>, eventId = `evt-uat-${Date.now()}-${++seq}`) => {
    const { rawBody, signature } = MockPaymentProvider.buildWebhook({ eventId, ...body } as never);
    return t.http
      .post('/v1/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('x-dealdash-signature', signature)
      .send(rawBody);
  };
  const attempt = (reservationId: string) =>
    t.prisma.reservationPayment.findFirstOrThrow({
      where: { reservationId },
      orderBy: { attemptNo: 'desc' },
    });
  async function pay(reservationId: string, outcome: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED') {
    const p = await attempt(reservationId);
    provider.settle(p.providerReference!, outcome);
    const res = await webhook({
      kind: 'PAYMENT',
      providerReference: p.providerReference,
      status: outcome,
      ...(outcome === 'FAILED' ? { failureCode: 'CARD_DECLINED' } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  }
  const stock = async (dealId: string) => {
    const i = await t.prisma.hotDealInventory.findUniqueOrThrow({
      where: { dealId_branchId: { dealId, branchId: w.A.branchIds[0]! } },
    });
    return { available: i.available, reserved: i.reserved, redeemed: i.redeemed };
  };
  async function reserve(dealId: string, c?: Session) {
    const customer = c ?? (await w.newCustomer());
    const res = await w.reserve(customer, dealId, w.A.branchIds[0]!);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { c: customer, r: res.body.data as Record<string, any> };
  }
  const mine = async (c: Session, id: string) =>
    (await w.api(c).get(`/v1/app/reservations/${id}`)).body.data;
  const row = (id: string) => t.prisma.reservation.findUniqueOrThrow({ where: { id } });
  const journalsOf = async (reservationId: string) => {
    const pays = await t.prisma.reservationPayment.findMany({ where: { reservationId } });
    const refunds = await t.prisma.reservationRefund.findMany({ where: { reservationId } });
    return t.prisma.ledgerJournal.findMany({
      where: {
        sourceId: { in: [reservationId, ...pays.map((p) => p.id), ...refunds.map((f) => f.id)] },
      },
      include: { entries: { include: { account: true } } },
    });
  };
  const family = (js: Awaited<ReturnType<typeof journalsOf>>, f: string) =>
    js
      .flatMap((j) => j.entries)
      .filter((e) => e.account.family === f)
      .reduce((n, e) => n + e.amountHalalas, 0);

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    provider = t.app.get(PAYMENT_PROVIDER) as MockPaymentProvider;
    await cfg().set(
      'reservation.policy',
      {
        ...DEFAULT_RESERVATION_POLICY,
        merchant: { [w.A.orgId]: { freeAllowed: false, commissionBps: 1_000 } },
      },
      'test',
      actor(),
      meta,
    );
  });
  afterAll(async () => {
    if (t)
      await cfg()
        .set('reservation.policy', DEFAULT_RESERVATION_POLICY, 'test restore', actor(), meta)
        .catch(() => undefined);
    await t?.close();
  });

  it('check 3: a free reservation still works where the policy allows it (no payment step, code at once)', async () => {
    const deal = await w.publishHot('B', 3);
    const c = await w.newCustomer();
    const res = await w.reserve(c, deal.id, w.B.branchIds[0]!);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'HELD' });
    expect(res.body.data.payment ?? null).toBeNull();
    expect(res.body.data.code.qr).toMatch(/^DD1\./);
  });

  it('checks 4, 6, 10: a paid reservation takes exactly one unit; a duplicate callback changes nothing; one currency throughout', async () => {
    const deal = await w.publishHot('A', 3, { commitment: DEPOSIT() });
    expect(await stock(deal.id)).toEqual({ available: 3, reserved: 0, redeemed: 0 });
    const { c, r } = await reserve(deal.id);
    // the unit is held for the payment window only (temporary payment hold), no code yet
    expect(r).toMatchObject({ status: 'PENDING_PAYMENT', code: null });
    expect(await stock(deal.id)).toEqual({ available: 2, reserved: 1, redeemed: 0 });

    const p = await attempt(r.id);
    provider.settle(p.providerReference!, 'SUCCEEDED');
    const body = { kind: 'PAYMENT', providerReference: p.providerReference, status: 'SUCCEEDED' };
    // the same provider event delivered twice, then a different event for the same payment
    const first = await webhook(body, 'evt-uat-dup-1');
    const again = await webhook(body, 'evt-uat-dup-1');
    const other = await webhook(body);
    expect(first.body.data).toEqual({ outcome: 'APPLIED' });
    expect([200, 201]).toContain(again.status);
    expect(other.body.data).toEqual({ outcome: 'DUPLICATE' });
    expect(await stock(deal.id)).toEqual({ available: 2, reserved: 1, redeemed: 0 });
    expect(await t.prisma.reservation.count({ where: { dealId: deal.id } })).toBe(1);
    const js = await journalsOf(r.id);
    expect(js.filter((j) => j.type === 'RESERVATION_PAYMENT')).toHaveLength(1);

    // check 10: the market currency on the policy view, the customer view, the payment, and every journal
    const policy = (
      await w
        .api(w.ownerA)
        .get(`/v1/merchants/${w.A.orgId}/hot-deal-reservation-policy`)
        .query({ branchId: w.A.branchIds[0] })
    ).body.data;
    const view = await mine(c, r.id);
    expect(view).toMatchObject({ status: 'HELD', payment: { status: 'PAID', amountMinor: 1_000 } });
    expect(view.payment.currency).toBe(policy.currency);
    expect((await attempt(r.id)).currency).toBe(policy.currency);
    expect(new Set(js.map((j) => j.currency))).toEqual(new Set([policy.currency]));
  });

  it('check 5: a declined payment keeps the unit only inside the window; when the window lapses the unit is released', async () => {
    const deal = await w.publishHot('A', 2, { commitment: DEPOSIT() });
    const { r } = await reserve(deal.id);
    await pay(r.id, 'FAILED');
    expect(await stock(deal.id)).toEqual({ available: 1, reserved: 1, redeemed: 0 });
    await t.app.get(ReservationsService).sweep(new Date(Date.now() + 11 * MIN));
    expect(await row(r.id)).toMatchObject({ status: 'PAYMENT_FAILED', paymentStatus: 'FAILED' });
    expect(await stock(deal.id)).toEqual({ available: 2, reserved: 0, redeemed: 0 });
    // nothing was charged: no money journal
    const js = await journalsOf(r.id);
    expect(family(js, 'PSP_CLEARING')).toBe(0);
  });

  it('check 7 and 9: expired cannot redeem; wrong branch is refused; a redeemed code cannot be used again', async () => {
    const deal = await w.publishHot('A', 3, { commitment: DEPOSIT() });
    const a = await reserve(deal.id);
    await pay(a.r.id);
    const qrA = (await mine(a.c, a.r.id)).code.qr;
    // wrong branch (staff of merchant A's other branch)
    expect((await w.validate(w.staffA2, qrA)).body.data.result).toBe('WRONG_BRANCH');
    expect((await w.redeem(w.staffA2, qrA)).body.data.result).toBe('WRONG_BRANCH');
    // redeemed once, then refused
    expect((await w.redeem(w.staffA, qrA)).body.data.result).toBe('REDEEMED');
    expect((await w.redeem(w.staffA, qrA)).body.data.result).toBe('ALREADY_REDEEMED');
    expect(await stock(deal.id)).toMatchObject({ redeemed: 1 });

    const b = await reserve(deal.id);
    await pay(b.r.id);
    const qrB = (await mine(b.c, b.r.id)).code.qr;
    await t.prisma.reservation.update({
      where: { id: b.r.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await w.validate(w.staffA, qrB)).body.data.result).toBe('EXPIRED');
    expect((await w.redeem(w.staffA, qrB)).body.data.result).toBe('EXPIRED');
    await t.app.get(HotLifecycleService).sweep();
    expect((await w.redeem(w.staffA, qrB)).body.data.result).toBe('EXPIRED');
    expect((await row(b.r.id)).status).toBe('EXPIRED');
  });

  it('check 8: cancel and refund return the unit and balance the ledger', async () => {
    const deal = await w.publishHot('A', 2, { commitment: DEPOSIT() });
    const { c, r } = await reserve(deal.id);
    await pay(r.id);
    expect(await stock(deal.id)).toEqual({ available: 1, reserved: 1, redeemed: 0 });
    const res = await w.api(c).post(`/v1/app/reservations/${r.id}/cancel`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.payment).toMatchObject({
      status: 'REFUNDED',
      refunds: [{ amountMinor: 1_000, status: 'REFUNDED' }],
    });
    expect(await stock(deal.id)).toEqual({ available: 2, reserved: 0, redeemed: 0 });
    const js = await journalsOf(r.id);
    expect(family(js, 'PSP_CLEARING')).toBe(0);
    expect(family(js, 'MERCHANT_HELD')).toBe(0);
    expect(family(js, 'PLATFORM_REVENUE')).toBe(0);
  });

  it('deposit refundable on any cancellation: a late customer cancellation is still refunded in full; a no-show is kept', async () => {
    const deal = await w.publishHot('A', 3, { commitment: DEPOSIT({ depositLateRefund: true }) });
    const c = await w.newCustomer();
    const terms = (await w.api(c).get(`/v1/app/hot-deals/${deal.id}`)).body.data.commitment;
    expect(terms).toMatchObject({
      method: 'DEPOSIT',
      depositRefundable: true,
      depositLateRefund: true,
      depositCredited: true,
    });
    const { r } = await reserve(deal.id, c);
    await pay(r.id);
    const db = await row(r.id);
    expect(db).toMatchObject({ depositLateRefund: true, depositCredited: true });
    await t.app
      .get(ReservationsService)
      .cancel(
        r.id,
        'CUSTOMER',
        null,
        { userId: c.me.id },
        null,
        null,
        new Date(db.cancelCutoffAt!.getTime() + MIN),
      );
    expect(await row(r.id)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED' });

    const noShow = await reserve(deal.id);
    await pay(noShow.r.id);
    await t.app.get(HotLifecycleService).sweep(new Date(Date.now() + 31 * MIN));
    expect(await row(noShow.r.id)).toMatchObject({
      status: 'EXPIRED',
      paymentStatus: 'FORFEITED',
      keptMinor: 1_000,
    });
  });

  it('booking fee (not credited to the bill): the customer and staff are told, the money flow is unchanged', async () => {
    const deal = await w.publishHot('A', 3, { commitment: DEPOSIT({ depositCredited: false }) });
    const c = await w.newCustomer();
    expect((await w.api(c).get(`/v1/app/hot-deals/${deal.id}`)).body.data.commitment).toMatchObject(
      { depositCredited: false, depositLateRefund: false },
    );
    const { r } = await reserve(deal.id, c);
    await pay(r.id);
    const view = await mine(c, r.id);
    expect(view.payment).toMatchObject({ method: 'DEPOSIT', depositCredited: false });
    const v = await w.validate(w.staffA, view.code.qr);
    expect(v.body.data.reservation.money).toMatchObject({
      method: 'DEPOSIT',
      paymentStatus: 'PAID',
      depositCredited: false,
    });
  });

  it('merchant and DealDash monitors count temporary payment holds and every payment outcome', async () => {
    const deal = await w.publishHot('A', 6, { commitment: DEPOSIT() });
    const waiting = await reserve(deal.id); // awaiting payment
    void waiting;
    const paid = await reserve(deal.id);
    await pay(paid.r.id);
    const refunded = await reserve(deal.id);
    await pay(refunded.r.id);
    await w.api(refunded.c).post(`/v1/app/reservations/${refunded.r.id}/cancel`).send({});
    const failed = await reserve(deal.id);
    await pay(failed.r.id, 'FAILED');
    await t.prisma.reservation.update({
      where: { id: failed.r.id },
      data: { paymentDueAt: new Date(Date.now() - 1000) },
    });
    await t.app.get(ReservationsService).sweep();

    const merchant = (await w.api(w.ownerA).get(`${w.base('A')}/hot-deals/${deal.id}/monitor`)).body
      .data;
    expect(merchant.payments).toEqual({
      awaitingPayment: 1,
      paid: 1,
      cardHolds: 0,
      failed: 1,
      refunded: 1,
      kept: 0,
    });
    const admin = (await w.api(w.ops).get(`/v1/admin/hot-deals/${deal.id}/monitor`)).body.data;
    expect(admin.payments).toEqual(merchant.payments);
    // a free deal has no paid block at all
    const free = await w.publishHot('B', 2);
    const fm = (await w.api(w.ownerB).get(`${w.base('B')}/hot-deals/${free.id}/monitor`)).body.data;
    expect(fm.payments).toBeUndefined();
  });
});
