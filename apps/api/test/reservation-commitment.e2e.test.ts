import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RESERVATION_POLICY } from '@dealdash/config';
import { HotLifecycleService } from '../src/hot-deals/hot-lifecycle.service';
import { ReservationsService } from '../src/hot-deals/reservations.service';
import { SystemConfigService } from '../src/system-config/system-config.service';
import {
  DB_READY,
  createBusinessUser,
  createDealDashOrg,
  createTestApp,
  idem,
  passwordSession,
  type Session,
  type TestApp,
} from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

const DEPOSIT = {
  method: 'DEPOSIT',
  amountMinor: 1_500,
  depositRefundable: true,
  cancelCutoffMinutes: 15,
  noShowRefundPercent: null,
};

/**
 * Reservation commitment model, build phase 1 (founder decision 2026-10-15, RC-01..RC-90): policy hierarchy through governed
 * configuration, merchant-side commitment validation, the reservation snapshot and backfill shape, the FREE gate, admin strike reset.
 * Paid methods take payment since phase 2 (reservation-payments.e2e.test.ts); card holds since phase 3 (reservation-preauth.e2e.test.ts).
 */
describe.skipIf(!DB_READY)('Reservation commitment model (phase 1)', () => {
  let t: TestApp;
  let w: HotWorld;
  let super2: Session;
  const cfg = () => t.app.get(SystemConfigService);
  const actor = () => ({ userId: w.superAdmin.me.id, membership: null }) as never;
  const meta = { requestId: 'test', ip: '127.0.0.1', userAgent: 'vitest' } as never;
  /** Merchant A's own override (merchant > category > market > baseline). */
  const setMerchantOverride = (override: Record<string, unknown> | null) =>
    cfg().set(
      'reservation.policy',
      {
        ...DEFAULT_RESERVATION_POLICY,
        merchant: override ? { [w.A.orgId]: override } : {},
      },
      'test',
      actor(),
      meta,
    );

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    const dd = (await createDealDashOrg(t.prisma)).id;
    super2 = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'DEALDASH_SUPER_ADMIN',
        orgId: dd,
        userType: 'ADMIN_USER',
        mfa: true,
      }),
      'admin',
      { completeMfa: true },
    );
  });
  afterAll(async () => {
    if (t) await setMerchantOverride(null).catch(() => undefined);
    await t?.close();
  });

  it('development / test machines keep FREE reservations: the reservation stores the commitment snapshot', async () => {
    const deal = await w.publishHot('A', 5);
    const row = await t.prisma.hotDeal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(row.commitmentMethod).toBe('FREE');
    // RC-12: the policy in force when the deal went live is kept on it
    expect(row.reservationPolicy).toMatchObject({ freeAllowed: true, market: expect.any(String) });
    const c = await w.newCustomer();
    const res = await w.reserve(c, deal.id, w.A.branchIds[0]!);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const r = await t.prisma.reservation.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(r).toMatchObject({
      commitmentMethod: 'FREE',
      paymentStatus: 'NOT_REQUIRED',
      amountMinor: null,
      currency: null,
    });
    expect(r.confirmedAt?.getTime()).toBe(r.createdAt.getTime());
    expect(r.termsSnapshot).toMatchObject({ method: 'FREE', policy: { freeAllowed: true } });
  });

  it('RC-05 / RC-22: once the policy refuses FREE, a legacy free deal takes no new reservations; existing ones stay valid', async () => {
    const deal = await w.publishHot('A', 5);
    const c = await w.newCustomer();
    const held = await w.reserve(c, deal.id, w.A.branchIds[0]!);
    expect(held.status).toBe(201);
    await setMerchantOverride({ freeAllowed: false });
    try {
      const d = await w.newCustomer();
      const refused = await w.reserve(d, deal.id, w.A.branchIds[0]!);
      expect(refused.status).toBe(409);
      expect(refused.body.errors[0].code).toBe('RESERVATION_METHOD_REQUIRED');
      // the units were not taken
      const inv = await t.prisma.hotDealInventory.findUniqueOrThrow({
        where: { dealId_branchId: { dealId: deal.id, branchId: w.A.branchIds[0]! } },
      });
      expect([inv.available, inv.reserved]).toEqual([4, 1]);
      // the reservation made before the change is untouched and still active for the customer
      const mine = await w.myRes(c, 'active');
      expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(held.body.data.id);
      // business B is not affected by A's override
      const dealB = await w.publishHot('B', 3);
      expect((await w.reserve(d, dealB.id, w.B.branchIds[0]!)).status).toBe(201);
    } finally {
      await setMerchantOverride(null);
    }
  });

  it('RC-21: a new deal with reservations needs a method the policy allows, inside its ranges', async () => {
    await setMerchantOverride({
      freeAllowed: false,
      allowedMethods: ['DEPOSIT', 'FULL_PREPAYMENT'],
    });
    try {
      // no method declared: shown on the draft and refused on submit
      const draft = await w.createHot('A', w.hotContent('A', 5));
      expect(draft.issues).toEqual(
        expect.arrayContaining([{ field: 'commitment.method', code: 'METHOD_REQUIRED' }]),
      );
      const sub = await w.submitHot('A', draft.id);
      expect(sub.status).toBe(422);
      expect(sub.body.errors.map((e: { field?: string }) => e.field)).toContain(
        'commitment.method',
      );
      // a method the policy does not allow, and a deposit outside the range
      const preauth = await w.createHot(
        'A',
        w.hotContent('A', 5, {
          commitment: { method: 'CARD_PREAUTH', amountMinor: 1_000, cancelCutoffMinutes: 15 },
        }),
      );
      expect((await w.submitHot('A', preauth.id)).body.errors[0].field).toBe('commitment.method');
      const tooBig = await w.createHot(
        'A',
        w.hotContent('A', 5, { commitment: { ...DEPOSIT, amountMinor: 999_999 } }),
      );
      const big = await w.submitHot('A', tooBig.id);
      expect(big.status).toBe(422);
      expect(big.body.errors.map((e: { field?: string }) => e.field)).toContain(
        'commitment.amountMinor',
      );
    } finally {
      await setMerchantOverride(null);
    }
  });

  it('a valid deposit deal publishes with its policy snapshot; reserving it (or a card-hold deal) waits for payment', async () => {
    await setMerchantOverride({ freeAllowed: false, depositMaxMinor: 2_000 });
    try {
      const deal = await w.publishHot('A', 4, { commitment: DEPOSIT });
      const row = await t.prisma.hotDeal.findUniqueOrThrow({ where: { id: deal.id } });
      expect(row).toMatchObject({
        commitmentMethod: 'DEPOSIT',
        commitmentAmountMinor: 1_500,
        depositRefundable: true,
        cancelCutoffMinutes: 15,
        noShowRefundPercent: null,
      });
      expect(row.reservationPolicy).toMatchObject({
        freeAllowed: false,
        fields: { depositMaxMinor: 2_000 },
        source: {
          depositMaxMinor: 'MERCHANT',
          freeAllowed: 'MERCHANT',
          cutoffMaxMinutes: 'BASELINE',
        },
      });
      // phase 2: a deposit reservation waits for its payment (units held, no code yet)
      const c = await w.newCustomer();
      const res = await w.reserve(c, deal.id, w.A.branchIds[0]!);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'PENDING_PAYMENT', code: null });
      const inv = await t.prisma.hotDealInventory.findUniqueOrThrow({
        where: { dealId_branchId: { dealId: deal.id, branchId: w.A.branchIds[0]! } },
      });
      expect(inv.reserved).toBe(1);
      // card pre-authorisation (phase 3): the reservation waits for the card hold (reservation-preauth.e2e.test.ts)
      const preauth = await w.publishHot('A', 4, {
        commitment: { method: 'CARD_PREAUTH', amountMinor: 1_000, cancelCutoffMinutes: 15 },
      });
      const pa = await w.reserve(await w.newCustomer(), preauth.id, w.A.branchIds[0]!);
      expect(pa.status, JSON.stringify(pa.body)).toBe(201);
      expect(pa.body.data).toMatchObject({ status: 'PENDING_PAYMENT', code: null });
      // the commitment is material: it cannot change on a live deal
      const edit = await w
        .api(w.ownerA)
        .put(`${w.base('A')}/hot-deals/${deal.id}`)
        .send({
          content: w.hotContent('A', 4, { commitment: { ...DEPOSIT, amountMinor: 1_800 } }),
        });
      expect(edit.status).toBe(409);
      expect(edit.body.errors[0].code).toBe('MATERIAL_EDIT_LOCKED');
    } finally {
      await setMerchantOverride(null);
    }
  });

  it('merchants read their effective policy; DealDash reads any scope with the source of each value', async () => {
    await setMerchantOverride({ cutoffMaxMinutes: 30 });
    try {
      const mine = await w
        .api(w.ownerA)
        .get(`${w.base('A')}/hot-deal-reservation-policy?branchId=${w.A.branchIds[0]}`);
      expect(mine.status, JSON.stringify(mine.body)).toBe(200);
      expect(mine.body.data).toMatchObject({
        freeAllowed: true, // a test machine
        fields: { cutoffMaxMinutes: 30 },
        source: { cutoffMaxMinutes: 'MERCHANT' },
      });
      expect((await w.api(w.ownerB).get(`${w.base('A')}/hot-deal-reservation-policy`)).status).toBe(
        404,
      );
      const admin = await w
        .api(w.support)
        .get(
          `/v1/admin/reservations/policy?market=${mine.body.data.market}&organizationId=${w.A.orgId}`,
        );
      expect(admin.status, JSON.stringify(admin.body)).toBe(200);
      expect(admin.body.data.source.cutoffMaxMinutes).toBe('MERCHANT');
      expect(admin.body.data.source.depositMaxMinor).toBe('BASELINE');
      expect((await w.api(w.analyst).get(`/v1/admin/reservations/policy?market=SA`)).status).toBe(
        403,
      );
    } finally {
      await setMerchantOverride(null);
    }
  });

  it('RC-12: policy changes go through governed configuration (validated, second approver, versioned)', async () => {
    const ov = (await w.api(w.superAdmin).get('/v1/admin/controls')).body.data;
    const cur = ov.configs.find((c: { key: string }) => c.key === 'reservation.policy');
    expect(cur).toBeDefined();
    const post = (s: Session, url: string, body: object) =>
      w.api(s).post(url).set('Idempotency-Key', idem()).send(body);
    const broken = {
      ...cur.value,
      baseline: { ...cur.value.baseline, cutoffMinMinutes: 100, cutoffMaxMinutes: 50 },
    };
    expect(
      (
        await post(w.superAdmin, '/v1/admin/controls/requests', {
          key: 'reservation.policy',
          section: 'baseline',
          value: broken,
          baseVersion: cur.version,
          reason: 'Bad range',
        })
      ).status,
    ).toBe(400);
    const value = {
      ...cur.value,
      market: { ...cur.value.market, PK: { paymentWindowMinutes: 15 } },
    };
    const req = await post(w.superAdmin, '/v1/admin/controls/requests', {
      key: 'reservation.policy',
      section: 'market.PK',
      value,
      baseVersion: cur.version,
      reason: 'Pakistan payment window',
    });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    // the requester cannot approve their own change
    const self = await post(
      w.superAdmin,
      `/v1/admin/controls/requests/${req.body.data.id}/decide`,
      {
        decision: 'APPROVE',
        reason: 'Self',
      },
    );
    expect(self.status).toBe(403);
    const ok = await post(super2, `/v1/admin/controls/requests/${req.body.data.id}/decide`, {
      decision: 'APPROVE',
      reason: 'Agreed',
    });
    expect(ok.body.data?.status, JSON.stringify(ok.body)).toBe('APPLIED');
    const pk = await w.api(w.support).get('/v1/admin/reservations/policy?market=PK');
    expect(pk.body.data.fields.paymentWindowMinutes).toBe(15);
    expect(pk.body.data.source.paymentWindowMinutes).toBe('MARKET');
  });

  it('RC-52: DealDash resets counted no-show strikes with a reason (per reservation or per customer), audited', async () => {
    const c = await w.newCustomer();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const deal = await w.publishHot('A', 2);
      ids.push((await w.reserve(c, deal.id, w.A.branchIds[0]!)).body.data.id);
    }
    await t.app.get(HotLifecycleService).sweep(new Date(Date.now() + 31 * 60_000));
    const counted = () =>
      t.prisma.reservation.count({ where: { id: { in: ids }, noShowCounted: true } });
    expect(await counted()).toBe(2);

    const post = (s: Session, url: string, body: object) => w.api(s).post(url).send(body);
    // permission and reason are required
    expect(
      (
        await post(w.analyst, `/v1/admin/reservations/${ids[0]}/strike-reset`, {
          reason: 'x'.repeat(5),
        })
      ).status,
    ).toBe(403);
    expect(
      (await post(w.support, `/v1/admin/reservations/${ids[0]}/strike-reset`, {})).status,
    ).toBe(400);

    const one = await post(w.support, `/v1/admin/reservations/${ids[0]}/strike-reset`, {
      reason: 'Branch was closed when the customer arrived',
    });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body.data).toEqual({ reset: 1, reservationIds: [ids[0]] });
    const r0 = await t.prisma.reservation.findUniqueOrThrow({ where: { id: ids[0]! } });
    expect(r0).toMatchObject({
      status: 'EXPIRED', // the no-show stays in the history
      noShowCounted: false,
      strikeResetReason: 'Branch was closed when the customer arrived',
    });
    const ev = await t.prisma.reservationEvent.findMany({
      where: { reservationId: ids[0], type: 'STRIKE_RESET' },
    });
    expect(ev).toHaveLength(1);
    expect(
      await t.prisma.auditLog.count({
        where: { action: 'reservation.strike_reset', entityId: ids[0] },
      }),
    ).toBe(1);
    // nothing left to reset on that reservation
    const again = await post(w.support, `/v1/admin/reservations/${ids[0]}/strike-reset`, {
      reason: 'Twice',
    });
    expect(again.status).toBe(409);

    const all = await post(w.support, `/v1/admin/reservations/customers/${c.me.id}/strike-reset`, {
      reason: 'Goodwill after a support case',
    });
    expect(all.body.data).toEqual({ reset: 1, reservationIds: [ids[1]] });
    expect(await counted()).toBe(0);
    // reset strikes no longer count toward a restriction
    expect(await t.app.get(ReservationsService).applyStrikes(c.me.id)).toBe(false);
  });
});
