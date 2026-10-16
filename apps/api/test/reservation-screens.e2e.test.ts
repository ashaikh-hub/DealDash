import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RESERVATION_POLICY, type ApiEnv } from '@dealdash/config';
import { APP_ENV } from '../src/common/env';
import { SystemConfigService } from '../src/system-config/system-config.service';
import { DB_READY, createTestApp, idem, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

const PREPAY = {
  method: 'FULL_PREPAYMENT',
  amountMinor: 5_000,
  depositRefundable: null,
  cancelCutoffMinutes: 15,
  noShowRefundPercent: 40,
};
const DEPOSIT = {
  method: 'DEPOSIT',
  amountMinor: 1_000,
  depositRefundable: false,
  cancelCutoffMinutes: 20,
  noShowRefundPercent: null,
};
const HOLD = {
  method: 'CARD_PREAUTH',
  amountMinor: 2_000,
  depositRefundable: null,
  cancelCutoffMinutes: 15,
  noShowRefundPercent: 25,
};

/**
 * Reservation screens (phase 4): the API contract the customer, merchant, staff and admin screens rely on. The terms a customer
 * sees before paying, terms acceptance, the payment page's return address (no open redirect), the development mock payment page for
 * reservation payments and card holds, the staff payment summary, and the governed not-completed limits.
 */
describe.skipIf(!DB_READY)('Reservation screens: API contract (phase 4)', () => {
  let t: TestApp;
  let w: HotWorld;
  let env: ApiEnv;
  const cfg = () => t.app.get(SystemConfigService);
  const actor = () => ({ userId: w.superAdmin.me.id, membership: null }) as never;
  const meta = { requestId: 'test', ip: '127.0.0.1', userAgent: 'vitest' } as never;
  const reserveRaw = (c: Session, dealId: string, body: Record<string, unknown>) =>
    w
      .api(c)
      .post(`/v1/app/hot-deals/${dealId}/reservations`)
      .set('Idempotency-Key', idem())
      .send({ branchId: w.A.branchIds[0], quantity: 1, ...body });

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    env = t.app.get(APP_ENV);
    // merchant A: paid reservations only, an agreed 10 % commission; B keeps the environment default (free on test machines)
    await cfg().set(
      'reservation.policy',
      {
        ...DEFAULT_RESERVATION_POLICY,
        // a hold that releases only part on a late cancellation needs partial capture allowed (RC-92)
        merchant: {
          [w.A.orgId]: {
            freeAllowed: false,
            commissionBps: 1_000,
            preauthPartialCaptureAllowed: true,
          },
        },
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

  it('RC-81: the deal detail carries the terms shown before paying (prepayment, deposit, card hold, free, walk-in)', async () => {
    const c = await w.newCustomer();
    const detail = async (id: string) =>
      (await w.api(c).get(`/v1/app/hot-deals/${id}`)).body.data.commitment;
    const prepay = await w.publishHot('A', 5, { commitment: PREPAY });
    expect(await detail(prepay.id)).toEqual({
      method: 'FULL_PREPAYMENT',
      amountMinor: 5_000,
      currency: expect.stringMatching(/^[A-Z]{3}$/),
      depositRefundable: null,
      cancelCutoffMinutes: 15,
      noShowRefundPercent: 40,
      paymentWindowMinutes: DEFAULT_RESERVATION_POLICY.baseline.paymentWindowMinutes,
      preauthOnRedemption: null,
      preauthImmediateCapture: null,
    });
    const deposit = await w.publishHot('A', 5, { commitment: DEPOSIT });
    expect(await detail(deposit.id)).toMatchObject({
      method: 'DEPOSIT',
      amountMinor: 1_000,
      depositRefundable: false,
      noShowRefundPercent: null,
    });
    const hold = await w.publishHot('A', 5, { commitment: HOLD });
    expect(await detail(hold.id)).toMatchObject({
      method: 'CARD_PREAUTH',
      noShowRefundPercent: 25,
      preauthOnRedemption: 'RELEASE',
      preauthImmediateCapture: false,
    });
    // an unset prepayment share shows the policy default
    const dflt = await w.publishHot('A', 5, {
      commitment: { ...PREPAY, noShowRefundPercent: null },
    });
    expect((await detail(dflt.id)).noShowRefundPercent).toBe(
      DEFAULT_RESERVATION_POLICY.baseline.prepaymentRefundDefaultPercent,
    );
    const free = await w.publishHot('B', 3);
    // free deals carry no payment terms (the Stage 4 free promise stays intact)
    expect(await detail(free.id)).toBeNull();
    const walkIn = await w.publishHot('B', 3, {
      limitType: 'TIME',
      reservationsEnabled: false,
      // a walk-in deal still names its branches (no tracked units)
      allocations: [{ branchId: w.B.branchIds[0], units: 0 }],
    });
    expect(await detail(walkIn.id)).toBeNull();
  });

  it('RC-81: a paid reservation needs the terms accepted; nothing is reserved or held without it', async () => {
    const deal = await w.publishHot('A', 5, { commitment: PREPAY });
    const c = await w.newCustomer();
    const res = await reserveRaw(c, deal.id, {});
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({
      code: 'RESERVATION_TERMS_REQUIRED',
      field: 'acceptTerms',
    });
    expect(await t.prisma.reservation.count({ where: { dealId: deal.id } })).toBe(0);
    const inv = await t.prisma.hotDealInventory.findUniqueOrThrow({
      where: { dealId_branchId: { dealId: deal.id, branchId: w.A.branchIds[0]! } },
    });
    expect(inv.reserved).toBe(0);
    // accepted: created, and the acceptance is kept in the terms snapshot
    const ok = await reserveRaw(c, deal.id, { acceptTerms: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const row = await t.prisma.reservation.findUniqueOrThrow({ where: { id: ok.body.data.id } });
    expect(JSON.stringify(row)).toContain('termsAcceptedAt');
    // free reservations need no acceptance (unchanged)
    const free = await w.publishHot('B', 3);
    const fr = await w
      .api(await w.newCustomer())
      .post(`/v1/app/hot-deals/${free.id}/reservations`)
      .set('Idempotency-Key', idem())
      .send({ branchId: w.B.branchIds[0], quantity: 1 });
    expect(fr.status).toBe(201);
  });

  it('the payment page returns to the app address it was given only when it is a DealDash app origin (no open redirect)', async () => {
    const deal = await w.publishHot('A', 5, { commitment: PREPAY });
    const app = env.CORS_ORIGINS[0]!;
    const own = await reserveRaw(await w.newCustomer(), deal.id, {
      acceptTerms: true,
      returnUrl: `${app}/en/reservations/return`,
    });
    expect(own.body.data.payment.redirectUrl).toBe(
      `${app}/en/reservations/return?mock_payment=${own.body.data.payment.redirectUrl.split('mock_payment=')[1]}`,
    );
    const foreign = await reserveRaw(await w.newCustomer(), deal.id, {
      acceptTerms: true,
      returnUrl: 'https://evil.example/steal',
    });
    expect(foreign.status).toBe(201);
    expect(foreign.body.data.payment.redirectUrl).not.toContain('evil.example');
    expect(foreign.body.data.payment.redirectUrl).toContain(
      `${app}/en/reservations/${foreign.body.data.id}`,
    );
  });

  it('development payment page: finds the reservation, approves a payment, declines a card hold (same webhook path)', async () => {
    const c = await w.newCustomer();
    const deal = await w.publishHot('A', 5, { commitment: PREPAY });
    const r = (await reserveRaw(c, deal.id, { acceptTerms: true })).body.data;
    const ref = String(r.payment.redirectUrl).split('mock_payment=')[1]!;
    const found = await t.http.get(`/v1/dev/reservations/${ref}`);
    expect(found.body.data).toEqual({ reservationId: r.id, kind: 'PAYMENT' });
    const done = await t.http
      .post(`/v1/dev/reservations/${ref}/complete`)
      .send({ outcome: 'SUCCEEDED' });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.data).toEqual({ reservationId: r.id, outcome: 'APPLIED' });
    const mine = (await w.api(c).get(`/v1/app/reservations/${r.id}`)).body.data;
    expect(mine).toMatchObject({ displayState: 'HELD', payment: { status: 'PAID' } });
    expect(mine.code.qr).toMatch(/^DD1\./);

    const holdDeal = await w.publishHot('A', 5, { commitment: HOLD });
    const h = (await reserveRaw(c, holdDeal.id, { acceptTerms: true })).body.data;
    const href = String(h.payment.redirectUrl).split('mock_hold=')[1]!;
    expect((await t.http.get(`/v1/dev/reservations/${href}`)).body.data.kind).toBe('HOLD');
    const declined = await t.http
      .post(`/v1/dev/reservations/${href}/complete`)
      .send({ outcome: 'FAILED' });
    expect(declined.status).toBe(200);
    const after = (await w.api(c).get(`/v1/app/reservations/${h.id}`)).body.data;
    expect(after.code).toBeNull();
    expect(after.payment.authorisation.status).toBe('FAILED');
    // unknown references are not found
    expect((await t.http.get('/v1/dev/reservations/nope')).status).toBe(404);
  });

  it('RC-60: staff see what was paid or held (read-only); free reservations carry no payment block', async () => {
    const c = await w.newCustomer();
    const deal = await w.publishHot('A', 5, { commitment: DEPOSIT });
    const r = (await reserveRaw(c, deal.id, { acceptTerms: true })).body.data;
    const ref = String(r.payment.redirectUrl).split('mock_payment=')[1]!;
    await t.http.post(`/v1/dev/reservations/${ref}/complete`).send({ outcome: 'SUCCEEDED' });
    const code = (await w.api(c).get(`/v1/app/reservations/${r.id}`)).body.data.code.qr;
    const v = await w.validate(w.staffA, code);
    expect(v.body.data.result).toBe('VALID');
    expect(v.body.data.reservation.money).toEqual({
      method: 'DEPOSIT',
      paymentStatus: 'PAID',
      amountMinor: 1_000,
      currency: expect.stringMatching(/^[A-Z]{3}$/),
      depositRefundable: false,
      holdStatus: null,
      refundedMinor: 0,
      keptMinor: null,
    });
    const free = await w.publishHot('B', 3);
    const fr = (await w.reserve(await w.newCustomer(), free.id, w.B.branchIds[0]!)).body.data;
    const fv = await w.validate(w.staffBorg, fr.code.qr);
    expect(fv.body.data.reservation.money ?? null).toBeNull();
  });

  it('merchant policy view carries the market currency; not-completed limits are governed (validated, maker-checker)', async () => {
    const p = await w
      .api(w.ownerA)
      .get(`/v1/merchants/${w.A.orgId}/hot-deal-reservation-policy`)
      .query({ branchId: w.A.branchIds[0] });
    expect(p.status).toBe(200);
    expect(p.body.data).toMatchObject({
      currency: expect.stringMatching(/^[A-Z]{3}$/),
      currencyDecimals: expect.any(Number),
      freeAllowed: false,
      fields: { commissionBps: 1_000 },
    });
    const ov = (await w.api(w.superAdmin).get('/v1/admin/controls')).body.data;
    const ns = ov.configs.find((x: { key: string }) => x.key === 'reservation.noshow');
    expect(ns.value).toEqual({ threshold: 3, windowDays: 30, blockDays: 7 });
    const post = (body: object) =>
      w
        .api(w.superAdmin)
        .post('/v1/admin/controls/requests')
        .set('Idempotency-Key', idem())
        .send(body);
    expect(
      (
        await post({
          key: 'reservation.noshow',
          section: 'noshow',
          value: { threshold: 0, windowDays: 30, blockDays: 7 },
          baseVersion: ns.version,
          reason: 'Out of range',
        })
      ).status,
    ).toBe(400);
    const ok = await post({
      key: 'reservation.noshow',
      section: 'noshow',
      value: { threshold: 4, windowDays: 30, blockDays: 7 },
      baseVersion: ns.version,
      reason: 'Pilot: four before a block',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.data.status).toBe('PENDING_APPROVAL');
    // nothing changed until a different person approves
    expect(
      (await w.api(w.superAdmin).get('/v1/admin/controls')).body.data.configs.find(
        (x: { key: string }) => x.key === 'reservation.noshow',
      ).value.threshold,
    ).toBe(3);
    await w
      .api(w.superAdmin)
      .post(`/v1/admin/controls/requests/${ok.body.data.id}/cancel`)
      .set('Idempotency-Key', idem())
      .send({});
  });
});
