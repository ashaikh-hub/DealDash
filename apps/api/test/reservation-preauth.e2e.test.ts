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
const HOLD = (releasePercent: number | null = null) => ({
  method: 'CARD_PREAUTH',
  amountMinor: 2_000,
  depositRefundable: null,
  cancelCutoffMinutes: 15,
  noShowRefundPercent: releasePercent,
});

/**
 * Reservation commitment model, build phase 3 (founder decision 2026-10-15, RC-90..RC-95): card pre-authorisation through the
 * mock provider. The reservation is confirmed only when the hold is AUTHORISED; nothing is posted to the ledger and no DealDash
 * revenue is recognised until a capture is confirmed; one DealDash fee per customer transaction (RC-73). Merchant A's agreed
 * commission is 10 %.
 */
describe.skipIf(!DB_READY)('Reservation card pre-authorisation (phase 3)', () => {
  let t: TestApp;
  let w: HotWorld;
  let provider: MockPaymentProvider;
  let seq = 0;
  const cfg = () => t.app.get(SystemConfigService);
  const reservations = () => t.app.get(ReservationsService);
  const actor = () => ({ userId: w.superAdmin.me.id, membership: null }) as never;
  const meta = { requestId: 'test', ip: '127.0.0.1', userAgent: 'vitest' } as never;
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

  const sendWebhook = (body: Record<string, unknown>) => {
    const { rawBody, signature } = MockPaymentProvider.buildWebhook({
      eventId: `evt-hold-${Date.now()}-${++seq}`,
      ...body,
    } as never);
    return t.http
      .post('/v1/webhooks/payments')
      .set('Content-Type', 'application/json')
      .set('x-dealdash-signature', signature)
      .send(rawBody);
  };
  const latestHold = (reservationId: string) =>
    t.prisma.reservationAuthorisation.findFirstOrThrow({
      where: { reservationId },
      orderBy: { attemptNo: 'desc' },
    });
  /** The customer completes (or fails) the card hold at the provider; the provider then calls the webhook. */
  async function settleHold(
    reservationId: string,
    outcome: 'AUTHORISED' | 'FAILED' = 'AUTHORISED',
  ) {
    const h = await latestHold(reservationId);
    provider.settleHold(h.providerReference!, outcome);
    const res = await sendWebhook({
      kind: 'AUTHORISATION',
      providerReference: h.providerReference,
      status: outcome,
      ...(outcome === 'FAILED' ? { failureCode: 'CARD_DECLINED' } : {}),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body.data;
  }
  async function reserveHold(commitment = HOLD(), customer?: Session) {
    const deal = await w.publishHot('A', 5, { commitment });
    const c = customer ?? (await w.newCustomer());
    const res = await w.reserve(c, deal.id, w.A.branchIds[0]!);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { deal, c, r: res.body.data as { id: string } & Record<string, unknown> };
  }
  async function held(commitment = HOLD()) {
    const x = await reserveHold(commitment);
    await settleHold(x.r.id);
    return x;
  }
  const row = (id: string) => t.prisma.reservation.findUniqueOrThrow({ where: { id } });
  const inv = (dealId: string) =>
    t.prisma.hotDealInventory.findUniqueOrThrow({
      where: { dealId_branchId: { dealId, branchId: w.A.branchIds[0]! } },
    });
  async function moneyJournals(reservationId: string) {
    const pays = await t.prisma.reservationPayment.findMany({ where: { reservationId } });
    const reds = await t.prisma.redemption.findMany({ where: { reservationId } });
    const refunds = await t.prisma.reservationRefund.findMany({ where: { reservationId } });
    return t.prisma.ledgerJournal.findMany({
      where: {
        sourceId: {
          in: [
            reservationId,
            ...pays.map((p) => p.id),
            ...reds.map((x) => x.id),
            ...refunds.map((f) => f.id),
          ],
        },
      },
      include: { entries: { include: { account: true } } },
    });
  }
  const familySum = (js: Awaited<ReturnType<typeof moneyJournals>>, family: string) =>
    js
      .flatMap((j) => j.entries)
      .filter((e) => e.account.family === family)
      .reduce((n, e) => n + e.amountHalalas, 0);
  const inboxTypes = async (c: Session) =>
    ((await w.api(c).get('/v1/app/notifications')).body.data.items as Array<{ type: string }>).map(
      (n) => n.type,
    );
  const events = async (id: string) =>
    (
      await t.prisma.reservationEvent.findMany({
        where: { reservationId: id },
        orderBy: { createdAt: 'asc' },
      })
    ).map((e) => e.type);
  const qrOf = async (c: Session, id: string) =>
    (await w.api(c).get(`/v1/app/reservations/${id}`)).body.data.code.qr as string;

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

  it('a card hold confirms the reservation only once AUTHORISED; nothing is charged or posted at authorisation', async () => {
    const { deal, c, r } = await reserveHold();
    expect(r).toMatchObject({
      status: 'PENDING_PAYMENT',
      displayState: 'PAYMENT_PENDING',
      code: null,
    });
    expect(r.payment).toMatchObject({
      method: 'CARD_PREAUTH',
      status: 'PENDING',
      amountMinor: 2_000,
      redirectUrl: expect.stringContaining('mock_hold='),
      authorisation: { status: 'REQUESTED', amountMinor: 2_000, capturedMinor: 0 },
    });
    expect((await inv(deal.id)).reserved).toBe(1); // units held while the customer completes the hold

    expect(await settleHold(r.id)).toEqual({ outcome: 'APPLIED' });
    const mine = (await w.api(c).get(`/v1/app/reservations/${r.id}`)).body.data;
    expect(mine).toMatchObject({
      status: 'HELD',
      payment: {
        status: 'AUTHORISED',
        authorisation: { status: 'AUTHORISED', expiresAt: expect.any(String) },
      },
    });
    expect(mine.code.qr).toMatch(/^DD1\./);
    expect(await inboxTypes(c)).toContain('RESERVATION_CONFIRMED');
    expect(await settleHold(r.id)).toEqual({ outcome: 'DUPLICATE' });
    // no money moved: no journal, no revenue
    expect(await moneyJournals(r.id)).toEqual([]);
    expect(await events(r.id)).toEqual(['CREATED', 'AUTHORISATION_REQUESTED', 'AUTHORISED']);
    expect(
      await t.prisma.auditLog.count({
        where: { action: 'reservation.authorisation_authorised', subjectOrganizationId: w.A.orgId },
      }),
    ).toBeGreaterThanOrEqual(1);
    // the merchant sees the hold
    const merchant = (
      await w.api(w.ownerA).get(`${w.base('A')}/hot-deals/${deal.id}/reservations`)
    ).body.data.find((x: { id: string }) => x.id === r.id);
    expect(merchant.money).toMatchObject({
      method: 'CARD_PREAUTH',
      paymentStatus: 'AUTHORISED',
      authorisation: { status: 'AUTHORISED', amountMinor: 2_000 },
    });
  });

  it('cancelled before the cut-off (or by the business): the hold is released, nothing charged, no strike', async () => {
    const a = await held();
    await w.api(a.c).post(`/v1/app/reservations/${a.r.id}/cancel`).send({});
    expect(await latestHold(a.r.id)).toMatchObject({ status: 'RELEASED', capturedMinor: 0 });
    expect(await row(a.r.id)).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'VOIDED',
      noShowCounted: false,
    });
    expect(await inboxTypes(a.c)).toContain('RESERVATION_HOLD_RELEASED');
    expect(await moneyJournals(a.r.id)).toEqual([]);
    expect(await events(a.r.id)).toContain('HOLD_RELEASED');

    const m = await held();
    const mc = await w
      .api(w.campaignsA)
      .post(`${w.base('A')}/reservations/${m.r.id}/cancel`)
      .send({ reason: 'Branch closed early' });
    expect(mc.status, JSON.stringify(mc.body)).toBe(200);
    expect(await latestHold(m.r.id)).toMatchObject({ status: 'RELEASED' });
    expect((await row(m.r.id)).paymentStatus).toBe('VOIDED');
  });

  it('no-show: a strike; the hold is captured in full and settled (merchant net of the 10 % commission, nothing more)', async () => {
    const x = await held();
    await t.app.get(HotLifecycleService).sweep(new Date(Date.now() + 31 * MIN));
    expect(await latestHold(x.r.id)).toMatchObject({ status: 'CAPTURED', capturedMinor: 2_000 });
    expect(await row(x.r.id)).toMatchObject({
      status: 'EXPIRED',
      noShowCounted: true,
      paymentStatus: 'CAPTURED',
      keptMinor: 2_000,
      feeMinor: 200,
    });
    const js = await moneyJournals(x.r.id);
    expect(familySum(js, 'PSP_CLEARING')).toBe(2_000);
    expect(familySum(js, 'MERCHANT_HELD')).toBe(0);
    expect(familySum(js, 'PLATFORM_REVENUE')).toBe(-200);
    expect(familySum(js, 'MERCHANT_SETTLEMENT_ELIGIBLE')).toBe(-1_800);
    expect(await inboxTypes(x.c)).toEqual(
      expect.arrayContaining(['RESERVATION_EXPIRED', 'RESERVATION_HOLD_CAPTURED']),
    );
  });

  it('partial capture only when policy and provider allow it: a late cancellation captures the hold minus the released share', async () => {
    // not allowed by policy: the deal cannot be published with a release share
    const draft = await w.createHot('A', w.hotContent('A', 5, { commitment: HOLD(25) }));
    const refused = await w.submitHot('A', draft.id);
    expect(refused.status).toBe(422);
    expect(refused.body.errors.map((e: { field?: string }) => e.field)).toContain(
      'commitment.noShowRefundPercent',
    );

    await setPolicyA({ preauthPartialCaptureAllowed: true });
    try {
      const x = await held(HOLD(25));
      const late = new Date((await row(x.r.id)).cancelCutoffAt!.getTime() + MIN);
      await reservations().cancel(
        x.r.id,
        'CUSTOMER',
        null,
        { userId: x.c.me.id },
        null,
        null,
        late,
      );
      const hold = await latestHold(x.r.id);
      expect(hold).toMatchObject({ status: 'PARTIALLY_CAPTURED', capturedMinor: 1_500 });
      expect(await row(x.r.id)).toMatchObject({
        keptMinor: 1_500,
        feeMinor: 150,
        noShowCounted: false,
      });
      const view = (await w.api(x.c).get(`/v1/app/reservations/${x.r.id}`)).body.data.payment;
      expect(view.authorisation).toMatchObject({ capturedMinor: 1_500, releasedMinor: 500 });

      // a provider without partial capture cannot take such a reservation
      provider.holdCapabilities.partialCapture = false;
      try {
        const deal = await w.publishHot('A', 5, { commitment: HOLD(25) });
        const res = await w.reserve(await w.newCustomer(), deal.id, w.A.branchIds[0]!);
        expect(res.status).toBe(409);
        expect(res.body.errors[0].code).toBe('RESERVATION_PAYMENT_UNAVAILABLE');
      } finally {
        provider.holdCapabilities.partialCapture = true;
      }
    } finally {
      await setPolicyA();
    }
  });

  it('redemption releases the hold by default (the per-redemption fee is then the one DealDash fee); policy CAPTURE charges it', async () => {
    const feeFacts = async (dealId: string, redemptionId: string) => {
      const c = await t.prisma.commercialCase.findUniqueOrThrow({
        where: { product_subjectId: { product: 'EXCLUSIVE', subjectId: dealId } },
        include: { commitments: true },
      });
      const chargeIds = c.commitments.filter((m) => m.kind === 'CHARGE').map((m) => m.id);
      const ev = await t.prisma.utilizationEvent.findMany({
        where: { sourceType: 'REDEMPTION', sourceId: redemptionId },
      });
      return {
        charged: ev
          .filter((e) => chargeIds.includes(e.commitmentId))
          .reduce((n, e) => n + e.amountHalalas, 0),
        billed: !!(await t.prisma.commercialBillingEvent.findUnique({
          where: { idempotencyKey: `bill:VERIFIED_REDEMPTION_USAGE:REDEMPTION:${redemptionId}` },
        })),
      };
    };
    const rel = await held();
    expect((await w.redeem(w.staffA, await qrOf(rel.c, rel.r.id))).body.data.result).toBe(
      'REDEEMED',
    );
    expect(await latestHold(rel.r.id)).toMatchObject({ status: 'RELEASED' });
    const relRow = await row(rel.r.id);
    expect(relRow).toMatchObject({ paymentStatus: 'VOIDED', keptMinor: null, feeMinor: null });
    const relRed = await t.prisma.redemption.findFirstOrThrow({
      where: { reservationId: rel.r.id },
    });
    const relFacts = await feeFacts(rel.deal.id, relRed.id);
    expect(relFacts.charged).toBeGreaterThan(0); // no commission earned: the per-redemption fee applies (one fee)
    expect(relFacts.billed).toBe(true);
    expect(await moneyJournals(rel.r.id)).toEqual([]);

    await setPolicyA({ preauthOnRedemption: 'CAPTURE' });
    try {
      const cap = await held();
      expect((await w.redeem(w.staffA, await qrOf(cap.c, cap.r.id))).body.data.result).toBe(
        'REDEEMED',
      );
      expect(await latestHold(cap.r.id)).toMatchObject({
        status: 'CAPTURED',
        capturedMinor: 2_000,
      });
      expect(await row(cap.r.id)).toMatchObject({
        paymentStatus: 'PAID',
        keptMinor: 2_000,
        feeMinor: 200,
        redemptionFeeMinor: 0,
      });
      const capRed = await t.prisma.redemption.findFirstOrThrow({
        where: { reservationId: cap.r.id },
      });
      expect(await feeFacts(cap.deal.id, capRed.id)).toEqual({ charged: 0, billed: false }); // commission only
      expect(familySum(await moneyJournals(cap.r.id), 'PLATFORM_REVENUE')).toBe(-200);
    } finally {
      await setPolicyA();
    }
  });

  it('a declined hold can be retried; a hold never completed in the window releases the units (no charge, no strike)', async () => {
    const a = await reserveHold();
    await settleHold(a.r.id, 'FAILED');
    expect(await inboxTypes(a.c)).toContain('RESERVATION_PAYMENT_FAILED');
    let mine = (await w.api(a.c).get(`/v1/app/reservations/${a.r.id}`)).body.data;
    expect(mine.payment).toMatchObject({ canRetry: true, authorisation: { status: 'FAILED' } });
    const retry = await w.api(a.c).post(`/v1/app/reservations/${a.r.id}/pay`).send({});
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.data.payment.redirectUrl).toContain('mock_hold=');
    await settleHold(a.r.id);
    mine = (await w.api(a.c).get(`/v1/app/reservations/${a.r.id}`)).body.data;
    expect(mine).toMatchObject({ status: 'HELD', payment: { status: 'AUTHORISED' } });

    const b = await reserveHold();
    const out = await reservations().sweep(new Date(Date.now() + 11 * MIN));
    expect(out.unpaid).toBeGreaterThanOrEqual(1);
    expect(await row(b.r.id)).toMatchObject({
      status: 'PAYMENT_FAILED',
      paymentStatus: 'FAILED',
      noShowCounted: false,
    });
    expect(await latestHold(b.r.id)).toMatchObject({ status: 'CANCELLED' });
    expect((await inv(b.deal.id)).reserved).toBe(0);
    // the provider authorises after the window closed: voided straight away
    const h = await latestHold(b.r.id);
    provider.settleHold(h.providerReference!, 'AUTHORISED');
    const late = await sendWebhook({
      kind: 'AUTHORISATION',
      providerReference: h.providerReference,
      status: 'AUTHORISED',
    });
    // the request was already cancelled: the late hold is voided at the provider, the reservation stays released
    expect(late.body.data.outcome).toBe('LATE_SUCCESS');
    expect(await provider.getHoldStatus(h.providerReference!)).toBe('RELEASED');
    expect((await row(b.r.id)).status).toBe('PAYMENT_FAILED');
  });

  it('a hold that lapses cancels its reservation (units released, nothing charged, not a strike); too long a hold is refused up front', async () => {
    const x = await held();
    const h = await latestHold(x.r.id);
    provider.settleHold(h.providerReference!, 'EXPIRED');
    await sendWebhook({
      kind: 'AUTHORISATION',
      providerReference: h.providerReference,
      status: 'EXPIRED',
    });
    const out = await reservations().sweep(new Date(Date.now() + MIN));
    expect(out.holdsExpired).toBeGreaterThanOrEqual(1);
    expect(await latestHold(x.r.id)).toMatchObject({ status: 'EXPIRED', capturedMinor: 0 });
    expect(await row(x.r.id)).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: 'SYSTEM',
      paymentStatus: 'VOIDED',
      noShowCounted: false,
    });
    expect((await inv(x.deal.id)).reserved).toBe(0);
    expect(await inboxTypes(x.c)).toContain('RESERVATION_CANCELLED');
    expect(await events(x.r.id)).toContain('AUTHORISATION_EXPIRED');
    expect(await moneyJournals(x.r.id)).toEqual([]);

    const before = provider.holdCapabilities.authValidityMinutes;
    provider.holdCapabilities.authValidityMinutes = 20; // shorter than payment window + hold
    try {
      const deal = await w.publishHot('A', 5, { commitment: HOLD() });
      const res = await w.reserve(await w.newCustomer(), deal.id, w.A.branchIds[0]!);
      expect(res.status).toBe(409);
      expect(res.body.errors[0].code).toBe('RESERVATION_PAYMENT_UNAVAILABLE');
    } finally {
      provider.holdCapabilities.authValidityMinutes = before;
    }
  });

  it('immediate capture (policy): captured at authorisation, held for the merchant, then refunded in full when cancelled in time', async () => {
    await setPolicyA({ preauthImmediateCapture: true });
    try {
      const x = await held();
      expect(await latestHold(x.r.id)).toMatchObject({ status: 'CAPTURED', capturedMinor: 2_000 });
      expect((await row(x.r.id)).paymentStatus).toBe('PAID');
      let js = await moneyJournals(x.r.id);
      expect(familySum(js, 'PSP_CLEARING')).toBe(2_000);
      expect(familySum(js, 'MERCHANT_HELD')).toBe(-2_000);
      expect(familySum(js, 'PLATFORM_REVENUE')).toBe(0); // no revenue until the money is kept
      await w.api(x.c).post(`/v1/app/reservations/${x.r.id}/cancel`).send({});
      expect(await row(x.r.id)).toMatchObject({ paymentStatus: 'REFUNDED' });
      js = await moneyJournals(x.r.id);
      expect(familySum(js, 'PSP_CLEARING')).toBe(0);
      expect(familySum(js, 'MERCHANT_HELD')).toBe(0);
    } finally {
      await setPolicyA();
    }
  });

  it('a refused capture is retried by the sweep; the ledger moves only when the capture succeeds', async () => {
    const x = await held();
    provider.failCaptures = true;
    try {
      await t.app.get(HotLifecycleService).sweep(new Date(Date.now() + 31 * MIN));
    } finally {
      provider.failCaptures = false;
    }
    expect(await latestHold(x.r.id)).toMatchObject({
      status: 'AUTHORISED',
      pendingCaptureMinor: 2_000,
      failureCode: 'CAPTURE_REFUSED',
    });
    expect(await moneyJournals(x.r.id)).toEqual([]);
    expect(
      (await reservations().sweep(new Date(Date.now() + 32 * MIN))).holdActions,
    ).toBeGreaterThanOrEqual(1);
    expect(await latestHold(x.r.id)).toMatchObject({ status: 'CAPTURED', capturedMinor: 2_000 });
    expect(familySum(await moneyJournals(x.r.id), 'MERCHANT_SETTLEMENT_ELIGIBLE')).toBe(-1_800);
    // an unknown hold event is recorded and ignored; the whole ledger still balances
    expect(
      (
        await sendWebhook({
          kind: 'AUTHORISATION',
          providerReference: 'mock-auth-unknown',
          status: 'AUTHORISED',
        })
      ).body.data,
    ).toEqual({ outcome: 'IGNORED' });
    expect((await t.app.get(LedgerService).trialBalance()).balanced).toBe(true);
  });
});
