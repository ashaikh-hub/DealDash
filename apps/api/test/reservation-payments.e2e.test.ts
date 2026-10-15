import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RESERVATION_POLICY } from '@dealdash/config';
import { HotLifecycleService } from '../src/hot-deals/hot-lifecycle.service';
import { ReservationsService } from '../src/hot-deals/reservations.service';
import { LedgerService } from '../src/vouchers/ledger.service';
import { PAYMENT_PROVIDER } from '../src/providers/interfaces';
import { MockPaymentProvider } from '../src/providers/mocks';
import { SystemConfigService } from '../src/system-config/system-config.service';
import { DB_READY, createTestApp, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

const MIN = 60_000;
const PREPAY = {
  method: 'FULL_PREPAYMENT',
  amountMinor: 5_000,
  depositRefundable: null,
  cancelCutoffMinutes: 15,
  noShowRefundPercent: 40,
};
const DEPOSIT = (refundable: boolean) => ({
  method: 'DEPOSIT',
  amountMinor: 1_000,
  depositRefundable: refundable,
  cancelCutoffMinutes: 15,
  noShowRefundPercent: null,
});

/**
 * Reservation commitment model, build phase 2 (founder decision 2026-10-15, RC-30..RC-82): full prepayment and deposit through the
 * mock payment provider, payment states, refunds, forfeits, cancellation, no-show, automatic release, ledger, customer and merchant
 * money views, notifications and the audit trail. Commission: merchant A's agreed rate is 10 % (policy override).
 */
describe.skipIf(!DB_READY)('Reservation payments, refunds and forfeits (phase 2)', () => {
  let t: TestApp;
  let w: HotWorld;
  let provider: MockPaymentProvider;
  let seq = 0;
  const cfg = () => t.app.get(SystemConfigService);
  const reservations = () => t.app.get(ReservationsService);
  const actor = () => ({ userId: w.superAdmin.me.id, membership: null }) as never;
  const meta = { requestId: 'test', ip: '127.0.0.1', userAgent: 'vitest' } as never;

  const sendWebhook = (body: Record<string, unknown>) => {
    const { rawBody, signature } = MockPaymentProvider.buildWebhook({
      eventId: `evt-res-${Date.now()}-${++seq}`,
      ...body,
    } as never);
    return t.http
      .post('/v1/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('x-dealdash-signature', signature)
      .send(rawBody);
  };
  const latestAttempt = (reservationId: string) =>
    t.prisma.reservationPayment.findFirstOrThrow({
      where: { reservationId },
      orderBy: { attemptNo: 'desc' },
    });
  /** The customer completes (or fails) the payment at the provider; the provider then calls the webhook. */
  async function settle(reservationId: string, outcome: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED') {
    const p = await latestAttempt(reservationId);
    provider.settle(p.providerReference!, outcome);
    const res = await sendWebhook({
      kind: 'PAYMENT',
      providerReference: p.providerReference,
      status: outcome,
      ...(outcome === 'FAILED' ? { failureCode: 'CARD_DECLINED' } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  }
  async function reservePaid(commitment: Record<string, unknown>, customer?: Session) {
    const deal = await w.publishHot('A', 5, { commitment });
    const c = customer ?? (await w.newCustomer());
    const res = await w.reserve(c, deal.id, w.A.branchIds[0]!);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { deal, c, r: res.body.data as { id: string } & Record<string, unknown> };
  }
  async function confirmed(commitment: Record<string, unknown>) {
    const x = await reservePaid(commitment);
    await settle(x.r.id);
    return x;
  }
  const row = (id: string) => t.prisma.reservation.findUniqueOrThrow({ where: { id } });
  const refundsOf = (id: string) =>
    t.prisma.reservationRefund.findMany({
      where: { reservationId: id },
      orderBy: { createdAt: 'asc' },
    });
  const journals = (sourceIds: string[]) =>
    t.prisma.ledgerJournal.findMany({
      where: { sourceId: { in: sourceIds } },
      include: { entries: { include: { account: true } } },
      orderBy: { postedAt: 'asc' },
    });
  /** Signed sum of one account family across journals (for one reservation's money). */
  const familySum = (js: Awaited<ReturnType<typeof journals>>, family: string) =>
    js
      .flatMap((j) => j.entries)
      .filter((e) => e.account.family === family)
      .reduce((n, e) => n + e.amountHalalas, 0);
  async function moneyJournals(reservationId: string) {
    const pays = await t.prisma.reservationPayment.findMany({ where: { reservationId } });
    const refunds = await refundsOf(reservationId);
    const reds = await t.prisma.redemption.findMany({ where: { reservationId } });
    return journals([
      reservationId,
      ...pays.map((p) => p.id),
      ...refunds.map((f) => f.id),
      ...reds.map((x) => x.id),
    ]);
  }
  const inbox = async (c: Session) =>
    (await w.api(c).get('/v1/app/notifications')).body.data.items as Array<{
      type: string;
      data: Record<string, unknown>;
    }>;

  /** Merchant A: paid reservations only, an agreed 10 % commission (RC-71), plus any extra agreed terms. */
  const setPolicyA = (extra: Record<string, unknown> = {}) =>
    cfg().set(
      'reservation.policy',
      {
        ...DEFAULT_RESERVATION_POLICY,
        merchant: { [w.A.orgId]: { freeAllowed: false, commissionBps: 1_000, ...extra } },
      },
      'test',
      actor(),
      meta,
    );

  /** What DealDash charged per redemption through the commercial engine, and what was billed / counted (RC-73). */
  async function redemptionFeeFacts(dealId: string, redemptionId: string) {
    const c = await t.prisma.commercialCase.findUniqueOrThrow({
      where: { product_subjectId: { product: 'EXCLUSIVE', subjectId: dealId } },
      include: { commitments: true },
    });
    const chargeIds = c.commitments
      .filter((m) => m.kind === 'CHARGE' && m.perUnitHalalas > 0)
      .map((m) => m.id);
    const ev = await t.prisma.utilizationEvent.findMany({
      where: { sourceType: 'REDEMPTION', sourceId: redemptionId },
    });
    return {
      hasPerRedemptionCharge: chargeIds.length > 0,
      charged: ev
        .filter((e) => chargeIds.includes(e.commitmentId))
        .reduce((n, e) => n + e.amountHalalas, 0),
      billed: !!(await t.prisma.commercialBillingEvent.findUnique({
        where: { idempotencyKey: `bill:VERIFIED_REDEMPTION_USAGE:REDEMPTION:${redemptionId}` },
      })),
      counted: !!(await t.prisma.usageEvent.findUnique({
        where: { idempotencyKey: `usage:verified_redemptions:REDEMPTION:${redemptionId}` },
      })),
    };
  }

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    provider = t.app.get(PAYMENT_PROVIDER) as MockPaymentProvider;
    await setPolicyA();
  });
  afterAll(async () => {
    if (t)
      await cfg()
        .set('reservation.policy', DEFAULT_RESERVATION_POLICY, 'test restore', actor(), meta)
        .catch(() => undefined);
    await t?.close();
  });

  it('full prepayment: waits for payment (no code), confirms on the provider webhook, posts payment and settlement ledgers', async () => {
    const { deal, c, r } = await reservePaid(PREPAY);
    expect(r.status).toBe('PENDING_PAYMENT');
    expect(r.displayState).toBe('PAYMENT_PENDING');
    expect(r.code).toBeNull();
    expect(r.payment).toMatchObject({
      method: 'FULL_PREPAYMENT',
      status: 'PENDING',
      amountMinor: 5_000,
      currency: expect.stringMatching(/^[A-Z]{3}$/),
      redirectUrl: expect.stringContaining('mock_payment='),
    });
    // the unit is held while the customer pays
    const inv = () =>
      t.prisma.hotDealInventory.findUniqueOrThrow({
        where: { dealId_branchId: { dealId: deal.id, branchId: w.A.branchIds[0]! } },
      });
    expect((await inv()).reserved).toBe(1);

    expect(await settle(r.id)).toEqual({ outcome: 'APPLIED' });
    const mine = (await w.api(c).get(`/v1/app/reservations/${r.id}`)).body.data;
    expect(mine).toMatchObject({
      status: 'HELD',
      displayState: 'HELD',
      payment: { status: 'PAID' },
    });
    expect(mine.code.qr).toMatch(/^DD1\./);
    const db = await row(r.id);
    // RC-32: the hold timer starts at confirmation; the cut-off is 15 minutes before the end of the hold
    expect(db.expiresAt.getTime() - db.confirmedAt!.getTime()).toBe(30 * MIN);
    expect(db.expiresAt.getTime() - db.cancelCutoffAt!.getTime()).toBe(15 * MIN);
    expect((await inbox(c)).map((n) => n.type)).toContain('RESERVATION_CONFIRMED');

    // a repeated provider callback changes nothing (one payment journal)
    expect(await settle(r.id)).toEqual({ outcome: 'DUPLICATE' });
    let js = await moneyJournals(r.id);
    expect(js.filter((j) => j.type === 'RESERVATION_PAYMENT')).toHaveLength(1);
    expect(familySum(js, 'PSP_CLEARING')).toBe(5_000);
    expect(familySum(js, 'MERCHANT_HELD')).toBe(-5_000);

    // redeemed: the amount is kept for the merchant, DealDash keeps its agreed 10 %
    const red = await w.redeem(w.staffA, mine.code.qr);
    expect(red.body.data.result).toBe('REDEEMED');
    js = await moneyJournals(r.id);
    expect(familySum(js, 'MERCHANT_HELD')).toBe(0);
    expect(familySum(js, 'PLATFORM_REVENUE')).toBe(-500);
    expect(familySum(js, 'MERCHANT_SETTLEMENT_ELIGIBLE')).toBe(-4_500);
    expect(await row(r.id)).toMatchObject({
      keptMinor: 5_000,
      feeMinor: 500,
      paymentStatus: 'PAID',
    });
    const merchant = (
      await w.api(w.ownerA).get(`${w.base('A')}/hot-deals/${deal.id}/reservations`)
    ).body.data.find((x: { id: string }) => x.id === r.id);
    expect(merchant.money).toMatchObject({
      method: 'FULL_PREPAYMENT',
      amountMinor: 5_000,
      keptMinor: 5_000,
      feeMinor: 500,
      netToMerchantMinor: 4_500,
      refundedMinor: 0,
    });

    // a reversed redemption holds the money for the merchant again
    const redemption = await t.prisma.redemption.findFirstOrThrow({
      where: { reservationId: r.id },
    });
    const rev = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/redemptions/${redemption.id}/reverse`)
      .send({ reason: 'Scanned the wrong customer' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    js = await moneyJournals(r.id);
    expect(familySum(js, 'MERCHANT_HELD')).toBe(-5_000);
    expect(familySum(js, 'MERCHANT_SETTLEMENT_ELIGIBLE')).toBe(0);
    expect(familySum(js, 'PLATFORM_REVENUE')).toBe(0);
  });

  it('a failed payment can be retried inside the window; the audit trail records every step', async () => {
    const { c, r } = await reservePaid(DEPOSIT(true));
    await settle(r.id, 'FAILED');
    let mine = (await w.api(c).get(`/v1/app/reservations/${r.id}`)).body.data;
    expect(mine.status).toBe('PENDING_PAYMENT');
    expect(mine.payment).toMatchObject({ status: 'PENDING', canRetry: true, redirectUrl: null });
    expect((await inbox(c)).map((n) => n.type)).toContain('RESERVATION_PAYMENT_FAILED');
    const retry = await w.api(c).post(`/v1/app/reservations/${r.id}/pay`).send({});
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.data.payment.redirectUrl).toContain('mock_payment=');
    await settle(r.id);
    mine = (await w.api(c).get(`/v1/app/reservations/${r.id}`)).body.data;
    expect(mine).toMatchObject({ status: 'HELD', payment: { status: 'PAID', amountMinor: 1_000 } });
    const events = (
      await t.prisma.reservationEvent.findMany({
        where: { reservationId: r.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.type);
    expect(events).toEqual([
      'CREATED',
      'PAYMENT_PENDING',
      'PAYMENT_FAILED',
      'PAYMENT_PENDING',
      'PAYMENT_SUCCEEDED',
    ]);
    expect(
      await t.prisma.auditLog.count({
        where: { action: { startsWith: 'reservation.payment_' }, subjectOrganizationId: w.A.orgId },
      }),
    ).toBeGreaterThanOrEqual(4);
  });

  it('RC-33: an unpaid reservation releases its units when the window ends (no charge, no strike); a late payment is refunded', async () => {
    const { deal, c, r } = await reservePaid(PREPAY);
    const out = await reservations().sweep(new Date(Date.now() + 11 * MIN));
    expect(out.unpaid).toBeGreaterThanOrEqual(1);
    expect(await row(r.id)).toMatchObject({
      status: 'PAYMENT_FAILED',
      paymentStatus: 'FAILED',
      noShowCounted: false,
    });
    const inv = await t.prisma.hotDealInventory.findUniqueOrThrow({
      where: { dealId_branchId: { dealId: deal.id, branchId: w.A.branchIds[0]! } },
    });
    expect([inv.available, inv.reserved]).toEqual([5, 0]);
    expect((await inbox(c)).map((n) => n.type)).toContain('RESERVATION_PAYMENT_FAILED');
    // the provider confirms a payment after we closed the window: the money goes straight back
    const p = await latestAttempt(r.id);
    provider.settle(p.providerReference!, 'SUCCEEDED');
    const late = await sendWebhook({
      kind: 'PAYMENT',
      providerReference: p.providerReference,
      status: 'SUCCEEDED',
    });
    expect(late.body.data).toEqual({ outcome: 'LATE_SUCCESS' });
    const [refund] = await refundsOf(r.id);
    expect(refund).toMatchObject({
      amountMinor: 5_000,
      status: 'REFUNDED',
      reasonCode: 'LATE_PAYMENT',
    });
    expect((await row(r.id)).status).toBe('PAYMENT_FAILED');
    const js = await moneyJournals(r.id);
    expect(familySum(js, 'PSP_CLEARING')).toBe(0);
    expect(familySum(js, 'MERCHANT_HELD')).toBe(0);
  });

  it('customer cancels BEFORE the cut-off: prepayment and refundable deposit refunded in full; a non-refundable deposit is kept', async () => {
    const pre = await confirmed(PREPAY);
    const a = await w.api(pre.c).post(`/v1/app/reservations/${pre.r.id}/cancel`).send({});
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.data.payment).toMatchObject({
      status: 'REFUNDED',
      refunds: [
        { amountMinor: 5_000, status: 'REFUNDED', reasonCode: 'CUSTOMER_CANCELLED_IN_TIME' },
      ],
    });
    expect((await inbox(pre.c)).map((n) => n.type)).toContain('RESERVATION_REFUND_UPDATED');
    let js = await moneyJournals(pre.r.id);
    expect(familySum(js, 'MERCHANT_HELD')).toBe(0);
    expect(familySum(js, 'PSP_CLEARING')).toBe(0);
    expect(familySum(js, 'PLATFORM_REVENUE')).toBe(0); // nothing kept: no commission

    const dep = await confirmed(DEPOSIT(true));
    await w.api(dep.c).post(`/v1/app/reservations/${dep.r.id}/cancel`).send({});
    expect(await row(dep.r.id)).toMatchObject({ paymentStatus: 'REFUNDED', keptMinor: null });

    const nonRef = await confirmed(DEPOSIT(false));
    const k = await w.api(nonRef.c).post(`/v1/app/reservations/${nonRef.r.id}/cancel`).send({});
    expect(k.body.data.payment).toMatchObject({
      status: 'FORFEITED',
      keptMinor: 1_000,
      refunds: [],
    });
    expect(await row(nonRef.r.id)).toMatchObject({ keptMinor: 1_000, feeMinor: 100 });
    const notes = await inbox(nonRef.c);
    expect(notes.find((n) => n.type === 'RESERVATION_FORFEITED')?.data).toMatchObject({
      keptMinor: 1_000,
      refundMinor: 0,
    });
    js = await moneyJournals(nonRef.r.id);
    expect(familySum(js, 'MERCHANT_SETTLEMENT_ELIGIBLE')).toBe(-900);
    expect(familySum(js, 'PLATFORM_REVENUE')).toBe(-100);
    // a cancellation is never a no-show strike
    expect((await row(nonRef.r.id)).noShowCounted).toBe(false);
  });

  it('customer cancels AFTER the cut-off: prepayment refunds the agreed share (40 %), the rest is kept; a deposit is kept', async () => {
    const pre = await confirmed(PREPAY);
    const db = await row(pre.r.id);
    const late = new Date(db.cancelCutoffAt!.getTime() + MIN);
    await reservations().cancel(
      pre.r.id,
      'CUSTOMER',
      null,
      { userId: pre.c.me.id },
      null,
      null,
      late,
    );
    expect(await row(pre.r.id)).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'PARTIALLY_REFUNDED',
      keptMinor: 3_000,
      feeMinor: 300,
      noShowCounted: false,
    });
    expect((await refundsOf(pre.r.id)).map((f) => [f.amountMinor, f.status, f.reasonCode])).toEqual(
      [[2_000, 'REFUNDED', 'CUSTOMER_CANCELLED_LATE']],
    );
    const js = await moneyJournals(pre.r.id);
    // paid 5000 = kept 3000 (2700 merchant + 300 commission) + refunded 2000
    expect(familySum(js, 'MERCHANT_HELD')).toBe(0);
    expect(familySum(js, 'MERCHANT_SETTLEMENT_ELIGIBLE')).toBe(-2_700);
    expect(familySum(js, 'PLATFORM_REVENUE')).toBe(-300);
    expect(familySum(js, 'PSP_CLEARING')).toBe(3_000);

    const dep = await confirmed(DEPOSIT(true));
    const depRow = await row(dep.r.id);
    await reservations().cancel(
      dep.r.id,
      'CUSTOMER',
      null,
      { userId: dep.c.me.id },
      null,
      null,
      new Date(depRow.cancelCutoffAt!.getTime() + MIN),
    );
    expect(await row(dep.r.id)).toMatchObject({ paymentStatus: 'FORFEITED', keptMinor: 1_000 });
  });

  it('no-show: a strike is counted; the prepayment refunds its agreed share and a deposit is kept', async () => {
    const pre = await confirmed(PREPAY);
    const dep = await confirmed(DEPOSIT(true));
    await t.app.get(HotLifecycleService).sweep(new Date(Date.now() + 31 * MIN));
    expect(await row(pre.r.id)).toMatchObject({
      status: 'EXPIRED',
      noShowCounted: true,
      paymentStatus: 'PARTIALLY_REFUNDED',
      keptMinor: 3_000,
    });
    expect((await refundsOf(pre.r.id)).map((f) => f.reasonCode)).toEqual(['NO_SHOW']);
    expect(await row(dep.r.id)).toMatchObject({
      status: 'EXPIRED',
      noShowCounted: true,
      paymentStatus: 'FORFEITED',
      keptMinor: 1_000,
      feeMinor: 100,
    });
    expect((await inbox(dep.c)).map((n) => n.type)).toEqual(
      expect.arrayContaining(['RESERVATION_EXPIRED', 'RESERVATION_FORFEITED']),
    );
  });

  it('merchant or DealDash cancels: always a full refund and no strike, even for a non-refundable deposit', async () => {
    const m = await confirmed(DEPOSIT(false));
    const mc = await w
      .api(w.campaignsA)
      .post(`${w.base('A')}/reservations/${m.r.id}/cancel`)
      .send({ reason: 'Branch closed early' });
    expect(mc.status, JSON.stringify(mc.body)).toBe(200);
    expect(await row(m.r.id)).toMatchObject({
      paymentStatus: 'REFUNDED',
      keptMinor: null,
      noShowCounted: false,
    });
    expect((await inbox(m.c)).map((n) => n.type)).toEqual(
      expect.arrayContaining(['RESERVATION_CANCELLED', 'RESERVATION_REFUND_UPDATED']),
    );
    const d = await confirmed(PREPAY);
    const dc = await w
      .api(w.support)
      .post(`/v1/admin/reservations/${d.r.id}/cancel`)
      .send({ reason: 'Merchant suspended during review' });
    expect(dc.status, JSON.stringify(dc.body)).toBe(200);
    expect((await refundsOf(d.r.id)).map((f) => [f.amountMinor, f.reasonCode])).toEqual([
      [5_000, 'DEALDASH_CANCELLED'],
    ]);
    // a cancelled campaign refunds every paid reservation (sent to the provider by the sweep)
    const c3 = await confirmed(PREPAY);
    const end = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${c3.deal.id}/cancel`)
      .send({ reason: 'Ran out of ingredients' });
    expect(end.body.data.status).toBe('CANCELLED');
    expect((await refundsOf(c3.r.id))[0]).toMatchObject({ status: 'PROCESSING', attempts: 0 });
    expect((await reservations().sweep()).refundsSent).toBeGreaterThanOrEqual(1);
    expect((await refundsOf(c3.r.id))[0]).toMatchObject({ status: 'REFUNDED', amountMinor: 5_000 });
  });

  it('a refused refund waits in the finance queue, the customer is told, and DealDash retries it once', async () => {
    const x = await confirmed(PREPAY);
    provider.failRefunds = true;
    try {
      await w.api(x.c).post(`/v1/app/reservations/${x.r.id}/cancel`).send({});
    } finally {
      provider.failRefunds = false;
    }
    const [failed] = await refundsOf(x.r.id);
    expect(failed).toMatchObject({ status: 'FAILED', failureCode: 'PROVIDER_REFUSED' });
    expect((await row(x.r.id)).paymentStatus).toBe('PAID'); // nothing went back yet
    expect(
      (await inbox(x.c)).find((n) => n.type === 'RESERVATION_REFUND_UPDATED')?.data,
    ).toMatchObject({ status: 'DELAYED' });
    const queue = await w.api(w.support).get('/v1/admin/reservations/refunds/failed');
    expect(queue.body.data.map((f: { id: string }) => f.id)).toContain(failed!.id);
    expect((await w.api(w.analyst).get('/v1/admin/reservations/refunds/failed')).status).toBe(403);
    const retry = await w
      .api(w.support)
      .post(`/v1/admin/reservations/refunds/${failed!.id}/retry`)
      .send({});
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.data).toMatchObject({ status: 'REFUNDED', attempts: 2 });
    expect((await row(x.r.id)).paymentStatus).toBe('REFUNDED');
    expect(
      (await w.api(w.support).post(`/v1/admin/reservations/refunds/${failed!.id}/retry`).send({}))
        .status,
    ).toBe(409);
  });

  it('an asynchronous refund completes through the provider webhook, once', async () => {
    const x = await confirmed(DEPOSIT(true));
    provider.refundsPending = true;
    try {
      await w.api(x.c).post(`/v1/app/reservations/${x.r.id}/cancel`).send({});
    } finally {
      provider.refundsPending = false;
    }
    const [pending] = await refundsOf(x.r.id);
    expect(pending).toMatchObject({
      status: 'PROCESSING',
      providerRefundReference: expect.any(String),
    });
    const pay = await latestAttempt(x.r.id);
    const body = {
      kind: 'REFUND',
      providerReference: pay.providerReference,
      refundReference: pending!.providerRefundReference,
      status: 'SUCCEEDED',
    };
    expect((await sendWebhook(body)).body.data).toEqual({ outcome: 'APPLIED' });
    expect((await sendWebhook(body)).body.data).toEqual({ outcome: 'DUPLICATE' });
    expect((await refundsOf(x.r.id))[0]!.status).toBe('REFUNDED');
    const js = await moneyJournals(x.r.id);
    expect(js.filter((j) => j.type === 'RESERVATION_REFUND')).toHaveLength(1);
    expect(familySum(js, 'MERCHANT_HELD')).toBe(0);
  });

  it('a customer may cancel while paying (nothing charged); the whole ledger stays balanced', async () => {
    const { c, r, deal } = await reservePaid(PREPAY);
    const cx = await w.api(c).post(`/v1/app/reservations/${r.id}/cancel`).send({});
    expect(cx.body.data).toMatchObject({
      status: 'CANCELLED',
      payment: { status: 'FAILED', refunds: [] },
    });
    expect((await latestAttempt(r.id)).status).toBe('CANCELLED');
    const inv = await t.prisma.hotDealInventory.findUniqueOrThrow({
      where: { dealId_branchId: { dealId: deal.id, branchId: w.A.branchIds[0]! } },
    });
    expect(inv.reserved).toBe(0);
    expect((await t.app.get(LedgerService).trialBalance()).balanced).toBe(true);
  });

  it('RC-73 / RC-74: one customer transaction, one DealDash fee; an extra per-redemption fee only when explicitly agreed', async () => {
    // (1) FREE deal (business B; free allowed on this test machine): the per-redemption fee model is unchanged
    const freeDeal = await w.publishHot('B', 3);
    const fc = await w.newCustomer();
    const free = (await w.reserve(fc, freeDeal.id, w.B.branchIds[0]!)).body.data;
    expect((await w.redeem(w.staffBorg, free.code.qr)).body.data.result).toBe('REDEEMED');
    const freeRed = await t.prisma.redemption.findFirstOrThrow({
      where: { reservationId: free.id },
    });
    const freeFacts = await redemptionFeeFacts(freeDeal.id, freeRed.id);
    expect(freeFacts.hasPerRedemptionCharge).toBe(true); // the agreement has a per-redemption fee
    expect(freeFacts.charged).toBeGreaterThan(0);
    expect(freeFacts).toMatchObject({ billed: true, counted: true });
    expect((await row(free.id)).redemptionFeeMinor).toBeNull();

    // (2) PAID reservation: the reservation commission is the only DealDash fee
    const paid = await confirmed(PREPAY);
    const qr = (await w.api(paid.c).get(`/v1/app/reservations/${paid.r.id}`)).body.data.code.qr;
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('REDEEMED');
    const paidRed = await t.prisma.redemption.findFirstOrThrow({
      where: { reservationId: paid.r.id },
    });
    const paidFacts = await redemptionFeeFacts(paid.deal.id, paidRed.id);
    expect(paidFacts.hasPerRedemptionCharge).toBe(true); // the same agreement exists ...
    expect(paidFacts).toMatchObject({ charged: 0, billed: false, counted: true }); // ... but is not charged
    // the only DealDash revenue from this customer transaction is the 10 % commission
    const caseId = (
      await t.prisma.commercialCase.findUniqueOrThrow({
        where: { product_subjectId: { product: 'EXCLUSIVE', subjectId: paid.deal.id } },
      })
    ).id;
    const perRedemption = await t.prisma.ledgerJournal.findMany({
      where: { idempotencyKey: { startsWith: 'util:' }, sourceId: caseId },
      include: { entries: { include: { account: true } } },
    });
    expect(
      perRedemption.filter((j) => j.idempotencyKey.endsWith(`:REDEMPTION:${paidRed.id}`)),
    ).toEqual([]);
    expect(familySum(await moneyJournals(paid.r.id), 'PLATFORM_REVENUE')).toBe(-500);
    expect(await row(paid.r.id)).toMatchObject({
      additionalFeeAllowed: false,
      redemptionFeeMinor: 0,
      feeMinor: 500,
    });
    expect(
      await t.prisma.auditLog.count({
        where: { action: 'reservation.redemption_fee_not_charged', entityId: paid.r.id },
      }),
    ).toBe(1);

    // (3) an agreement that EXPLICITLY allows the extra fee: charged, shown to the merchant, audited
    await setPolicyA({ additionalRedemptionFee: true });
    try {
      const extra = await confirmed(PREPAY);
      expect((await row(extra.r.id)).additionalFeeAllowed).toBe(true);
      const xqr = (await w.api(extra.c).get(`/v1/app/reservations/${extra.r.id}`)).body.data.code
        .qr;
      expect((await w.redeem(w.staffA, xqr)).body.data.result).toBe('REDEEMED');
      const xRed = await t.prisma.redemption.findFirstOrThrow({
        where: { reservationId: extra.r.id },
      });
      const xFacts = await redemptionFeeFacts(extra.deal.id, xRed.id);
      expect(xFacts.charged).toBeGreaterThan(0);
      expect(xFacts.billed).toBe(true);
      const xRow = await row(extra.r.id);
      expect(xRow.redemptionFeeMinor).toBe(xFacts.charged);
      const merchant = (
        await w.api(w.ownerA).get(`${w.base('A')}/hot-deals/${extra.deal.id}/reservations`)
      ).body.data.find((x: { id: string }) => x.id === extra.r.id);
      expect(merchant.money).toMatchObject({
        additionalFeeAllowed: true,
        redemptionFeeMinor: xFacts.charged,
        feeMinor: 500,
      });
      expect(
        await t.prisma.auditLog.count({
          where: { action: 'reservation.additional_fee_applied', entityId: extra.r.id },
        }),
      ).toBe(1);
    } finally {
      await setPolicyA();
    }
  });
});
