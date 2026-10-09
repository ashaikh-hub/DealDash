import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HotLifecycleService } from '../src/hot-deals/hot-lifecycle.service';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

/** Merchant staff validation and redemption: the result matrix, replay safety, concurrency, scope and audit. */
describe.skipIf(!DB_READY)('Staff redemption', () => {
  let t: TestApp;
  let w: HotWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
  });
  afterAll(() => t?.close());

  const held = async (opts: { units?: number; overrides?: Record<string, unknown> } = {}) => {
    const deal = await w.publishHot('A', opts.units ?? 5, opts.overrides ?? {});
    const customer = await w.newCustomer();
    const r = (await w.reserve(customer, deal.id, w.A.branchIds[0]!)).body.data;
    return { deal, customer, r, qr: r.code.qr as string, manual: r.code.manual as string };
  };

  it('staff context: merchant and branch scope, no finance or campaign data', async () => {
    const me = await w.api(w.staffA).get('/v1/staff/me');
    expect(me.status).toBe(200);
    expect(me.body.data.merchantName.en).toContain('Alpha Grill');
    expect(me.body.data.branch.en).toBe('Alpha Olaya');
    expect(me.body.data.canRedeem).toBe(true);
    expect(JSON.stringify(me.body)).not.toMatch(/finance|settlement|invoice|campaign|revenue/i);
  });

  it('VALID: a held reservation shows its summary (first name only) and nothing changes', async () => {
    const { qr, r, deal } = await held();
    const v = await w.validate(w.staffA, qr);
    expect(v.status).toBe(200);
    expect(v.body.data.result).toBe('VALID');
    expect(v.body.data.reservation).toMatchObject({ ref: r.publicRef, quantity: 1 });
    expect(v.body.data.reservation.dealTitle.ar).toBe('خصم 40% لليوم فقط');
    expect(JSON.stringify(v.body)).not.toMatch(/"mobile"|"email"|userId/);
    expect((await t.prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe(
      'HELD',
    );
    void deal;
  });

  it('redeems by QR and by the manual fallback (any spacing and case), once each', async () => {
    const a = await held();
    const ra = await w.redeem(w.staffA, a.qr, 'QR');
    expect(ra.status).toBe(200);
    expect(ra.body.data).toMatchObject({ result: 'REDEEMED' });
    expect(ra.body.data.reference).toMatch(/^RD-[A-Z2-9]{6}$/);
    const b = await held();
    const typed = b.manual.toLowerCase().replace('-', ' ');
    expect((await w.redeem(w.staffA, typed, 'MANUAL')).body.data.result).toBe('REDEEMED');
    // inventory moved reserved -> redeemed, reservation is REDEEMED, the customer is told
    const inv = await t.prisma.hotDealInventory.findUniqueOrThrow({
      where: { dealId_branchId: { dealId: a.deal.id, branchId: w.A.branchIds[0]! } },
    });
    expect([inv.available, inv.reserved, inv.redeemed]).toEqual([4, 0, 1]);
    const mine = await w.api(a.customer).get(`/v1/app/reservations/${a.r.id}`);
    expect(mine.body.data.displayState).toBe('REDEEMED');
    expect(mine.body.data.code).toBeNull();
    expect(
      (await w.api(a.customer).get('/v1/app/notifications')).body.data.items.map(
        (i: { type: string }) => i.type,
      ),
    ).toContain('REDEMPTION_SUCCESS');
  });

  it('ALREADY_REDEEMED on the second attempt (QR replay, duplicate scan, screenshot)', async () => {
    const { qr, manual } = await held();
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('REDEEMED');
    const again = await w.redeem(w.staffA, qr);
    expect(again.body.data.result).toBe('ALREADY_REDEEMED');
    expect(again.body.data.reservation.redeemedAt).toBeTruthy();
    expect((await w.redeem(w.staffA, manual, 'MANUAL')).body.data.result).toBe('ALREADY_REDEEMED');
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('ALREADY_REDEEMED');
  });

  it('INVALID_CODE for unknown, malformed and another merchant’s code (never reveals the other merchant)', async () => {
    expect((await w.validate(w.staffA, 'DD1.AAAAAAAAAAAAAAAAAAAAAA')).body.data.result).toBe(
      'INVALID_CODE',
    );
    expect((await w.validate(w.staffA, 'ZZZZ-ZZZZ', 'MANUAL')).body.data.result).toBe(
      'INVALID_CODE',
    );
    expect((await w.validate(w.staffA, 'abcd', 'MANUAL')).body.data.result).toBe('INVALID_CODE');
    expect((await w.validate(w.staffA, 'abc', 'MANUAL')).status).toBe(400); // too short to be a code at all
    const { qr } = await held();
    const other = await w.validate(w.staffBorg, qr);
    expect(other.body.data.result).toBe('INVALID_CODE');
    expect(other.body.data.reservation).toBeNull();
    expect((await w.redeem(w.staffBorg, qr)).body.data.result).toBe('INVALID_CODE');
    expect(
      (await t.prisma.reservation.findFirstOrThrow({ where: { qrToken: qr.slice(4) } })).status,
    ).toBe('HELD');
  });

  it('WRONG_BRANCH: a staff member of another branch of the same merchant is told where it is valid', async () => {
    const { qr } = await held();
    const v = await w.validate(w.staffA2, qr);
    expect(v.body.data.result).toBe('WRONG_BRANCH');
    expect(v.body.data.reservation.validBranchName.en).toBe('Alpha Olaya');
    expect((await w.redeem(w.staffA2, qr)).body.data.result).toBe('WRONG_BRANCH');
  });

  it('EXPIRED: a hold that has run out cannot be redeemed, even before the sweep ran', async () => {
    const { qr, r } = await held();
    await t.prisma.reservation.update({
      where: { id: r.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('EXPIRED');
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('EXPIRED');
    await t.app.get(HotLifecycleService).sweep();
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('EXPIRED');
  });

  it('NOT_ACTIVE: a cancelled reservation', async () => {
    const { qr, customer, r } = await held();
    await w.cancelRes(customer, r.id);
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('NOT_ACTIVE');
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('NOT_ACTIVE');
  });

  it('NOT_VALID_YET: a campaign whose start is still ahead is amber/recoverable, with its start time', async () => {
    const { qr, deal } = await held();
    const startAt = new Date(Date.now() + 3_600_000);
    await t.prisma.hotDeal.update({ where: { id: deal.id }, data: { startAt } });
    const v = await w.validate(w.staffA, qr);
    expect(v.body.data.result).toBe('NOT_VALID_YET');
    expect(v.body.data.reservation.startsAt).toBe(startAt.toISOString());
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('NOT_VALID_YET');
    await t.prisma.hotDeal.update({
      where: { id: deal.id },
      data: { startAt: new Date(Date.now() - 60_000) },
    });
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('VALID');
  });

  it('CAMPAIGN_UNAVAILABLE while paused or suspended, valid again after it is resumed', async () => {
    const { qr, deal } = await held();
    await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${deal.id}/pause`)
      .send({});
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('CAMPAIGN_UNAVAILABLE');
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('CAMPAIGN_UNAVAILABLE');
    await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${deal.id}/resume`)
      .send({});
    await w.decideHot(w.ops, deal.id, 'suspend', { reason: 'Review' });
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('CAMPAIGN_UNAVAILABLE');
    await w.decideHot(w.ops, deal.id, 'reinstate');
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('REDEEMED');
  });

  it('a campaign that merely reached its end still honours reservations whose hold is valid', async () => {
    const { qr, deal } = await held({
      overrides: { endAt: new Date(Date.now() + 3600_000).toISOString() },
    });
    await t.prisma.hotDeal.update({
      where: { id: deal.id },
      data: { status: 'EXPIRED', endAt: new Date(Date.now() - 60_000) },
    });
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('REDEEMED');
  });

  it('INELIGIBLE when the customer no longer meets the rule at redemption (no personal data shown)', async () => {
    const deal = await w.publishHot('A', 5, {
      eligibility: { kind: 'EMPLOYER', valueRefs: [w.employer] },
    });
    const c = await w.newCustomer();
    const attr = await t.prisma.eligibilityAttribute.create({
      data: {
        userId: c.me.id,
        attrType: 'EMPLOYER',
        valueRef: w.employer,
        level: 'OTP_VERIFIED',
        status: 'VERIFIED',
      },
    });
    const r = (await w.reserve(c, deal.id, w.A.branchIds[0]!)).body.data;
    await t.prisma.eligibilityAttribute.update({
      where: { id: attr.id },
      data: { status: 'REVOKED' },
    });
    const v = await w.validate(w.staffA, r.code.qr);
    expect(v.body.data.result).toBe('INELIGIBLE');
    expect(v.body.data.reservation.requirement.en).toMatch(/employees/i);
    expect(v.body.data.reservation.requirement.ar).toBeTruthy();
    expect((await w.redeem(w.staffA, r.code.qr)).body.data.result).toBe('INELIGIBLE');
  });

  describe('replay and concurrency safety', () => {
    it('a retried request with the same Idempotency-Key returns the same redemption', async () => {
      const { qr } = await held();
      const key = idem();
      const a = await w.redeem(w.staffA, qr, 'QR', key);
      const b = await w.redeem(w.staffA, qr, 'QR', key);
      expect(a.body.data.reference).toBe(b.body.data.reference);
      expect(b.headers['idempotent-replay']).toBe('true');
      expect(
        await t.prisma.redemption.count({ where: { reservation: { qrToken: qr.slice(4) } } }),
      ).toBe(1);
    });

    it('a fresh key after the first success (double tap with a new request) is ALREADY_REDEEMED, never a second success', async () => {
      const { qr } = await held();
      expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('REDEEMED');
      expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('ALREADY_REDEEMED');
    });

    it('two staff devices scanning the same QR at the same instant: exactly one REDEEMED', async () => {
      const { qr, deal } = await held();
      const second = await (
        await import('./helpers')
      ).otpSession(
        t,
        (await (await import('./helpers')).createStaffUser(t.prisma, w.A.orgId, w.A.branchIds[0]!))
          .mobile!,
        'staff',
      );
      const results = await Promise.all([
        w.redeem(w.staffA, qr),
        w.redeem(second, qr),
        w.redeem(w.staffA, qr),
        w.redeem(second, qr),
      ]);
      const outcomes = results.map((r) => r.body.data.result).sort();
      expect(outcomes.filter((o) => o === 'REDEEMED')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'ALREADY_REDEEMED')).toHaveLength(3);
      expect(
        await t.prisma.redemption.count({ where: { dealId: deal.id, status: 'REDEEMED' } }),
      ).toBe(1);
      const inv = await t.prisma.hotDealInventory.findUniqueOrThrow({
        where: { dealId_branchId: { dealId: deal.id, branchId: w.A.branchIds[0]! } },
      });
      expect([inv.reserved, inv.redeemed]).toEqual([0, 1]);
    });

    it('redeeming racing with the customer’s cancellation: one wins, stock stays balanced', async () => {
      const { qr, customer, r, deal } = await held();
      const [red, can] = await Promise.all([w.redeem(w.staffA, qr), w.cancelRes(customer, r.id)]);
      const row = await t.prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
      expect(['REDEEMED', 'CANCELLED']).toContain(row.status);
      if (row.status === 'REDEEMED') expect(can.status).toBe(409);
      else expect(red.body.data.result).toBe('NOT_ACTIVE');
      const inv = await t.prisma.hotDealInventory.findUniqueOrThrow({
        where: { dealId_branchId: { dealId: deal.id, branchId: w.A.branchIds[0]! } },
      });
      expect(inv.total).toBe(inv.available + inv.reserved + inv.redeemed);
    });

    it('the database allows only one active redemption per reservation even if the application is bypassed', async () => {
      const { qr, r, deal } = await held();
      await w.redeem(w.staffA, qr);
      await expect(
        t.prisma.redemption.create({
          data: {
            reservationId: r.id,
            dealId: deal.id,
            branchId: w.A.branchIds[0]!,
            organizationId: w.A.orgId,
            staffUserId: w.staffA.me.id,
            source: 'QR',
            reference: 'RD-FORCED',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('abuse protection', () => {
    it('rate limits repeated wrong codes per staff member', async () => {
      const staff = await (
        await import('./helpers')
      ).otpSession(
        t,
        (await (await import('./helpers')).createStaffUser(t.prisma, w.A.orgId, w.A.branchIds[0]!))
          .mobile!,
        'staff',
      );
      let limited = 0;
      for (let i = 0; i < 9; i++) {
        const res = await w.validate(staff, `QQQQ-QQQ${i}`, 'MANUAL');
        if (res.status === 429) limited++;
      }
      expect(limited).toBeGreaterThanOrEqual(3);
    });

    it('logs every attempt (append-only) with only the tail of the code', async () => {
      const { qr, manual } = await held();
      await w.validate(w.staffA, qr);
      await w.redeem(w.staffA, qr);
      await w.redeem(w.staffA, qr);
      const attempts = await t.prisma.redemptionAttempt.findMany({
        where: { staffUserId: w.staffA.me.id },
        orderBy: { createdAt: 'desc' },
        take: 3,
      });
      expect(attempts.map((a) => a.result).sort()).toEqual([
        'ALREADY_REDEEMED',
        'REDEEMED',
        'VALID',
      ]);
      expect(
        attempts.every((a) => a.codeHint.length <= 5 && !a.codeHint.includes(qr.slice(4, 14))),
      ).toBe(true);
      expect(attempts.some((a) => a.codeHint.includes(manual.slice(0, 4)))).toBe(false);
      await expect(
        t.prisma.redemptionAttempt.update({
          where: { id: attempts[0]!.id },
          data: { result: 'VALID' },
        }),
      ).rejects.toThrow();
      await expect(
        t.prisma.redemptionAttempt.delete({ where: { id: attempts[0]!.id } }),
      ).rejects.toThrow();
    });
  });

  describe('history', () => {
    it('lists today’s redemptions and rejections with counts, filterable', async () => {
      const { qr } = await held();
      await w.redeem(w.staffA, qr);
      await w.redeem(w.staffA, qr);
      const all = await w.api(w.staffA).get('/v1/staff/history');
      expect(all.status).toBe(200);
      expect(all.body.data.counts.redeemed).toBeGreaterThanOrEqual(1);
      expect(all.body.data.counts.rejected).toBeGreaterThanOrEqual(1);
      const red = await w.api(w.staffA).get('/v1/staff/history?filter=redeemed');
      expect(red.body.data.items.every((i: { result: string }) => i.result === 'REDEEMED')).toBe(
        true,
      );
      const rej = await w.api(w.staffA).get('/v1/staff/history?filter=rejected');
      expect(rej.body.data.items.every((i: { result: string }) => i.result !== 'REDEEMED')).toBe(
        true,
      );
      expect(JSON.stringify(all.body)).not.toMatch(/"mobile"|"email"|DD1\./);
      // another staff member sees none of it
      const theirs = (await w.api(w.staffBorg).get('/v1/staff/history')).body.data;
      expect(theirs.counts.redeemed).toBe(0);
      expect(theirs.items.every((i: { reference: string | null }) => i.reference === null)).toBe(
        true,
      );
    });
  });

  describe('reversal is not a staff action', () => {
    it('staff cannot reverse; Owner and DealDash can, with a reason, and the customer gets a fresh hold', async () => {
      const { qr, r, deal } = await held();
      const red = await w.redeem(w.staffA, qr);
      expect(red.body.data.result).toBe('REDEEMED');
      const row = await t.prisma.redemption.findFirstOrThrow({ where: { reservationId: r.id } });
      expect(
        (
          await w
            .api(w.staffA)
            .post(`${w.base('A')}/redemptions/${row.id}/reverse`)
            .send({ reason: 'oops' })
        ).status,
      ).toBeGreaterThanOrEqual(401);
      expect(
        (
          await w
            .api(w.campaignsA)
            .post(`${w.base('A')}/redemptions/${row.id}/reverse`)
            .send({ reason: 'mistake at till' })
        ).status,
      ).toBe(403);
      expect(
        (
          await w
            .api(w.ownerB)
            .post(`${w.base('A')}/redemptions/${row.id}/reverse`)
            .send({ reason: 'mistake at till' })
        ).status,
      ).toBe(404);
      const ok = await w
        .api(w.ownerA)
        .post(`${w.base('A')}/redemptions/${row.id}/reverse`)
        .send({ reason: 'Scanned the wrong customer' });
      expect(ok.status).toBe(200);
      expect(
        (
          await w
            .api(w.ownerA)
            .post(`${w.base('A')}/redemptions/${row.id}/reverse`)
            .send({ reason: 'again again' })
        ).status,
      ).toBe(409);
      const res = await t.prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
      expect(res.status).toBe('HELD');
      expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
      const inv = await t.prisma.hotDealInventory.findUniqueOrThrow({
        where: { dealId_branchId: { dealId: deal.id, branchId: w.A.branchIds[0]! } },
      });
      expect([inv.available, inv.reserved, inv.redeemed]).toEqual([4, 1, 0]);
      // and it can be redeemed again, correctly
      expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('REDEEMED');
      // audited
      expect(
        await t.prisma.auditLog.count({
          where: { action: 'redemption.reverse', entityId: row.id },
        }),
      ).toBe(1);
    });

    it('a reversal outside the window needs DealDash', async () => {
      const { qr, r } = await held();
      await w.redeem(w.staffA, qr);
      const row = await t.prisma.redemption.findFirstOrThrow({ where: { reservationId: r.id } });
      await t.prisma.redemption.update({
        where: { id: row.id },
        data: { redeemedAt: new Date(Date.now() - 30 * 3600_000) },
      });
      const late = await w
        .api(w.ownerA)
        .post(`${w.base('A')}/redemptions/${row.id}/reverse`)
        .send({ reason: 'Customer disputes it' });
      expect(late.status).toBe(409);
      expect(late.body.errors[0].code).toBe('REVERSAL_NOT_ALLOWED');
      expect(
        (
          await w
            .api(w.ops)
            .post(`/v1/admin/reservations/redemptions/${row.id}/reverse`)
            .send({ reason: 'Support approved' })
        ).status,
      ).toBe(200);
    });
  });
});
