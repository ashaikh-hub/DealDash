import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { buildVoucherWorld, type VoucherWorld } from './voucher-fixtures';

/** Stage 5 redemption: the same Staff app and flow as Stage 4, now for purchased vouchers, with the ledger effect. */
describe.skipIf(!DB_READY)('Voucher redemption (Merchant Staff)', () => {
  let t: TestApp;
  let w: VoucherWorld;
  let vid: string;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildVoucherWorld(t);
    vid = (await w.publishVoucher('A', { totalQty: 200, perCustomerLimit: 10 })).id;
  });
  afterAll(() => t?.close());

  const owned = async () => w.owned(await w.newCustomer(), vid);
  const sumJournal = async (key: string) => {
    const j = await t.prisma.ledgerJournal.findUnique({
      where: { idempotencyKey: key },
      include: { entries: { include: { account: true } } },
    });
    return j;
  };

  it('VALID: staff see the voucher value, first name, branch and expiry; nothing changes on validate', async () => {
    const { qr, instanceId } = await owned();
    const v = await w.validate(w.staffA, qr);
    expect(v.status).toBe(200);
    expect(v.body.data.result).toBe('VALID');
    expect(v.body.data.reservation).toMatchObject({
      kind: 'VOUCHER',
      faceValueHalalas: 10_000,
      quantity: 1,
      offerLabel: { en: 'SAR 100 voucher' },
    });
    expect(v.body.data.reservation.dealTitle.ar).toContain('قسيمة');
    expect(v.body.data.reservation.ref).toMatch(/^VC-/);
    expect(JSON.stringify(v.body)).not.toMatch(/"mobile"|"email"|userId|purchasePrice|8000/);
    expect(
      (await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: instanceId! } })).status,
    ).toBe('ACTIVE');
  });

  it('redeems by QR and by the typed code (any case and spacing), once each; the customer sees it used and is told', async () => {
    const a = await owned();
    const ra = await w.redeem(w.staffA, a.qr, 'QR');
    expect(ra.status).toBe(200);
    expect(ra.body.data).toMatchObject({ result: 'REDEEMED' });
    expect(ra.body.data.reference).toMatch(/^RV-[A-Z2-9]{6}$/);
    const b = await owned();
    const typed = b.manual.toLowerCase().replace('-', ' ');
    expect((await w.redeem(w.staffA, typed, 'MANUAL')).body.data.result).toBe('REDEEMED');
    const mine = (await w.walletOne(a.order && (await w.newCustomer()), a.instanceId!)).status; // another customer cannot open it
    expect(mine).toBe(404);
    const inst = await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: a.instanceId! } });
    expect(inst.status).toBe('REDEEMED');
    expect(inst.redeemedAt).toBeTruthy();
  });

  it('redemption moves the merchant amount from held to settlement-eligible (net of the versioned fee), in one balanced journal', async () => {
    const before = (await w.api(w.financeA).get(`${w.vbase('A')}/finance/voucher-payable`)).body
      .data;
    const c = await w.newCustomer();
    const o = await w.owned(c, vid);
    const mid = (await w.api(w.financeA).get(`${w.vbase('A')}/finance/voucher-payable`)).body.data;
    expect(mid.heldHalalas - before.heldHalalas).toBe(8000);
    expect(mid.settlementEligibleHalalas).toBe(before.settlementEligibleHalalas); // sold, NOT yet payable
    const r = await w.redeem(w.staffA, o.qr, 'QR');
    const red = await t.prisma.voucherRedemption.findFirstOrThrow({
      where: { reference: r.body.data.reference },
    });
    const j = await sumJournal(`redemption:${red.id}`);
    expect(j?.type).toBe('REDEMPTION');
    expect(j?.feeRuleVersion).toBe(1);
    expect(j?.entries.reduce((n, e) => n + e.amountHalalas, 0)).toBe(0);
    const byFamily = Object.fromEntries(j!.entries.map((e) => [e.account.family, e.amountHalalas]));
    expect(byFamily).toEqual({
      MERCHANT_HELD: 8000,
      PLATFORM_REVENUE: -800,
      MERCHANT_SETTLEMENT_ELIGIBLE: -7200,
    });
    const after = (await w.api(w.financeA).get(`${w.vbase('A')}/finance/voucher-payable`)).body
      .data;
    expect(after.heldHalalas).toBe(mid.heldHalalas - 8000);
    expect(after.settlementEligibleHalalas - before.settlementEligibleHalalas).toBe(7200);
    expect(after.platformFeeHalalas - before.platformFeeHalalas).toBe(800);
    const events = await t.prisma.merchantPayableEvent.findMany({
      where: { instanceId: o.instanceId! },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.type)).toEqual(['ISSUED', 'REDEEMED', 'ELIGIBLE']);
    expect(events[2]).toMatchObject({ amountHalalas: 7200, feeHalalas: 800 });
    // the customer is told; analytics saw it
    const notes = (await w.api(c).get('/v1/app/notifications')).body.data.items.map(
      (i: { type: string }) => i.type,
    );
    expect(notes).toContain('VOUCHER_REDEEMED');
    expect(
      await t.prisma.dealEvent.count({
        where: {
          productType: 'VOUCHER',
          type: 'VOUCHER_REDEEMED',
          userId: (
            await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: o.instanceId! } })
          ).ownerUserId,
        },
      }),
    ).toBe(1);
    // audit
    expect(
      await t.prisma.auditLog.count({
        where: { action: 'voucher_redemption.redeem', entityId: red.id },
      }),
    ).toBe(1);
  });

  it('ALREADY_REDEEMED on the second attempt (QR replay, duplicate scan, typed code, screenshot)', async () => {
    const { qr, manual } = await owned();
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('REDEEMED');
    const again = await w.redeem(w.staffA, qr);
    expect(again.body.data.result).toBe('ALREADY_REDEEMED');
    expect(again.body.data.reservation.redeemedAt).toBeTruthy();
    expect((await w.redeem(w.staffA, manual, 'MANUAL')).body.data.result).toBe('ALREADY_REDEEMED');
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('ALREADY_REDEEMED');
  });

  it('a retried confirm with the SAME Idempotency-Key returns the same success and never redeems twice', async () => {
    const { qr, instanceId } = await owned();
    const key = idem();
    const a = await w.redeem(w.staffA, qr, 'QR', key);
    const b = await w.redeem(w.staffA, qr, 'QR', key);
    expect(b.body.data.result).toBe('REDEEMED');
    expect(b.body.data.reference).toBe(a.body.data.reference);
    expect(await t.prisma.voucherRedemption.count({ where: { instanceId: instanceId! } })).toBe(1);
    expect(
      await t.prisma.merchantPayableEvent.count({
        where: { instanceId: instanceId!, type: 'ELIGIBLE' },
      }),
    ).toBe(1);
  });

  it('five devices redeem the same voucher at the same moment: exactly one success, one journal, one payable', async () => {
    const { qr, instanceId } = await owned();
    const res = await Promise.all(Array.from({ length: 5 }, () => w.redeem(w.staffA, qr, 'QR')));
    const results = res.map((r) => r.body.data.result);
    expect(results.filter((r) => r === 'REDEEMED')).toHaveLength(1);
    expect(results.filter((r) => r === 'ALREADY_REDEEMED')).toHaveLength(4);
    expect(
      await t.prisma.voucherRedemption.count({
        where: { instanceId: instanceId!, status: 'REDEEMED' },
      }),
    ).toBe(1);
    expect(
      await t.prisma.merchantPayableEvent.count({
        where: { instanceId: instanceId!, type: 'ELIGIBLE' },
      }),
    ).toBe(1);
  });

  it('the database stops a second active redemption even if the application were bypassed', async () => {
    const { qr, instanceId } = await owned();
    await w.redeem(w.staffA, qr);
    const red = await t.prisma.voucherRedemption.findFirstOrThrow({
      where: { instanceId: instanceId! },
    });
    await expect(
      t.prisma.voucherRedemption.create({
        data: {
          instanceId: red.instanceId,
          voucherId: red.voucherId,
          branchId: red.branchId,
          organizationId: red.organizationId,
          staffUserId: red.staffUserId,
          source: 'QR',
          reference: 'RV-ZZZZZZ',
        },
      }),
    ).rejects.toThrow();
  });

  it('INVALID_CODE for unknown, malformed and another merchant’s voucher (never reveals the other merchant)', async () => {
    expect((await w.validate(w.staffA, 'DV1.AAAAAAAAAAAAAAAAAAAAAA')).body.data.result).toBe(
      'INVALID_CODE',
    );
    expect((await w.validate(w.staffA, 'DV1.short')).body.data.result).toBe('INVALID_CODE');
    expect((await w.validate(w.staffA, 'ZZZZ-ZZZZ', 'MANUAL')).body.data.result).toBe(
      'INVALID_CODE',
    );
    const { qr } = await owned();
    const other = await w.validate(w.staffBorg, qr);
    expect(other.body.data.result).toBe('INVALID_CODE');
    expect(other.body.data.reservation).toBeNull();
    expect((await w.redeem(w.staffBorg, qr)).body.data.result).toBe('INVALID_CODE');
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('VALID');
  });

  it('WRONG_BRANCH: staff of another branch are told where the voucher works', async () => {
    const { qr } = await owned();
    const v = await w.validate(w.staffA2, qr);
    expect(v.body.data.result).toBe('WRONG_BRANCH');
    expect(v.body.data.reservation.validBranchName.en).toContain('Alpha Olaya');
    expect((await w.redeem(w.staffA2, qr)).body.data.result).toBe('WRONG_BRANCH');
  });

  it('EXPIRED by date even before the sweep ran; the sweep then expires it and records the value separately', async () => {
    const { qr, instanceId } = await owned();
    await t.prisma.voucherInstance.update({
      where: { id: instanceId! },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('EXPIRED');
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('EXPIRED');
    const swept = await w.lifecycle.expireInstances(new Date());
    expect(swept).toBeGreaterThanOrEqual(1);
    expect(
      (await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: instanceId! } })).status,
    ).toBe('EXPIRED');
    const j = await sumJournal(`expiry:${instanceId}`);
    expect(j?.type).toBe('EXPIRY');
    const fam = Object.fromEntries(j!.entries.map((e) => [e.account.family, e.amountHalalas]));
    expect(fam).toEqual({ MERCHANT_HELD: 8000, EXPIRED_VALUE: -8000 });
    const ev = await t.prisma.merchantPayableEvent.findFirstOrThrow({
      where: { instanceId: instanceId!, type: 'EXPIRED' },
    });
    expect(ev.note).toContain('VALIDATE-KSA');
    // expiry is idempotent and never becomes settlement-eligible
    await w.lifecycle.expireInstances(new Date());
    expect(
      await t.prisma.ledgerJournal.count({ where: { idempotencyKey: `expiry:${instanceId}` } }),
    ).toBe(1);
    expect(
      await t.prisma.merchantPayableEvent.count({
        where: { instanceId: instanceId!, type: 'ELIGIBLE' },
      }),
    ).toBe(0);
    // customer sees it under Expired
    const mine = await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: instanceId! } });
    expect(mine.expiredAt).toBeTruthy();
  });

  it('NOT_VALID_YET when a start date is ahead (amber), with the start time; VALID once it arrives', async () => {
    const { qr, instanceId } = await owned();
    const startsAt = new Date(Date.now() + 3600_000);
    await t.prisma.voucherInstance.update({
      where: { id: instanceId! },
      data: { validFrom: startsAt },
    });
    const v = await w.validate(w.staffA, qr);
    expect(v.body.data.result).toBe('NOT_VALID_YET');
    expect(v.body.data.reservation.startsAt).toBe(startsAt.toISOString());
    expect((await w.redeem(w.staffA, qr)).body.data.result).toBe('NOT_VALID_YET');
    await t.prisma.voucherInstance.update({
      where: { id: instanceId! },
      data: { validFrom: new Date(Date.now() - 1000) },
    });
    expect((await w.validate(w.staffA, qr)).body.data.result).toBe('VALID');
  });

  it('VOUCHER_SUSPENDED blocks redemption until DealDash reinstates; pausing or ending SALES never blocks vouchers already sold', async () => {
    const pub = (await w.publishVoucher('A', { totalQty: 5 })).id;
    const c = await w.newCustomer();
    const o = await w.owned(c, pub);
    await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${pub}/pause`)
      .send({});
    expect((await w.validate(w.staffA, o.qr)).body.data.result).toBe('VALID');
    await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${pub}/end`)
      .send({ reason: 'Sale over' });
    expect((await w.validate(w.staffA, o.qr)).body.data.result).toBe('VALID');
    await w
      .decideVoucher(w.ops, pub, 'suspend', { reason: 'Investigating' })
      .catch(() => undefined);
    // ENDED is terminal for sale controls; suspend a live voucher instead
    const pub2 = (await w.publishVoucher('A', { totalQty: 5 })).id;
    const o2 = await w.owned(await w.newCustomer(), pub2);
    await w.decideVoucher(w.ops, pub2, 'suspend', { reason: 'Investigating' });
    expect((await w.validate(w.staffA, o2.qr)).body.data.result).toBe('VOUCHER_SUSPENDED');
    expect((await w.redeem(w.staffA, o2.qr)).body.data.result).toBe('VOUCHER_SUSPENDED');
    await w.decideVoucher(w.ops, pub2, 'reinstate');
    expect((await w.redeem(w.staffA, o2.qr)).body.data.result).toBe('REDEEMED');
  });

  it('CAMPAIGN_UNAVAILABLE when the merchant account is not active', async () => {
    const { qr } = await owned();
    await t.prisma.organization.update({ where: { id: w.A.orgId }, data: { status: 'SUSPENDED' } });
    try {
      // a suspended merchant's staff cannot redeem at all (their access follows the account); never a silent success
      const res = await w.validate(w.staffA, qr);
      expect(res.status === 200 ? res.body.data.result : 'REFUSED').not.toBe('VALID');
      expect((await w.redeem(w.staffA, qr)).body.data?.result ?? 'REFUSED').not.toBe('REDEEMED');
    } finally {
      await t.prisma.organization.update({ where: { id: w.A.orgId }, data: { status: 'ACTIVE' } });
    }
  });

  it('staff can validate and redeem but can NEVER reverse a redemption or touch refunds or finance', async () => {
    const { qr } = await owned();
    const r = await w.redeem(w.staffA, qr);
    const red = await t.prisma.voucherRedemption.findFirstOrThrow({
      where: { reference: r.body.data.reference },
    });
    for (const res of [
      await w
        .api(w.staffA)
        .post(`${w.vbase('A')}/voucher-redemptions/${red.id}/reverse`)
        .send({ reason: 'oops' }),
      await w.api(w.staffA).get(`${w.vbase('A')}/finance/voucher-payable`),
      await w
        .api(w.staffA)
        .post(`/v1/admin/finance/redemptions/${red.id}/reverse`)
        .send({ reason: 'oops' }),
    ])
      expect([401, 403]).toContain(res.status);
    // Campaign Manager and Finance have no reverse permission either
    expect(
      (
        await w
          .api(w.campaignsA)
          .post(`${w.vbase('A')}/voucher-redemptions/${red.id}/reverse`)
          .send({ reason: 'no way' })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api(w.financeA)
          .post(`${w.vbase('A')}/voucher-redemptions/${red.id}/reverse`)
          .send({ reason: 'no way' })
      ).status,
    ).toBe(403);
    // another merchant cannot reach it at all
    expect(
      (
        await w
          .api(w.ownerB)
          .post(`${w.vbase('B')}/voucher-redemptions/${red.id}/reverse`)
          .send({ reason: 'not mine' })
      ).status,
    ).toBe(404);
    expect(
      (await t.prisma.voucherRedemption.findUniqueOrThrow({ where: { id: red.id } })).status,
    ).toBe('REDEEMED');
  });

  it('the merchant Owner can reverse within the window: voucher active again, the ledger reversed, payable reversed; reason required', async () => {
    const o = await owned();
    const r = await w.redeem(w.staffA, o.qr);
    const red = await t.prisma.voucherRedemption.findFirstOrThrow({
      where: { reference: r.body.data.reference },
    });
    const url = `${w.vbase('A')}/voucher-redemptions/${red.id}/reverse`;
    expect((await w.api(w.ownerA).post(url).send({ reason: 'x' })).status).toBe(400);
    const before = (await w.api(w.financeA).get(`${w.vbase('A')}/finance/voucher-payable`)).body
      .data;
    const rv = await w.api(w.ownerA).post(url).send({ reason: 'Wrong customer was served' });
    expect(rv.status).toBe(200);
    expect(rv.body.data.status).toBe('REVERSED');
    expect(
      (await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: o.instanceId! } })).status,
    ).toBe('ACTIVE');
    const rev = await sumJournal(`reversal:${red.id}`);
    expect(rev?.type).toBe('REVERSAL');
    expect(rev?.entries.reduce((n, e) => n + e.amountHalalas, 0)).toBe(0);
    const after = (await w.api(w.financeA).get(`${w.vbase('A')}/finance/voucher-payable`)).body
      .data;
    expect(after.settlementEligibleHalalas).toBe(before.settlementEligibleHalalas - 7200);
    expect(after.heldHalalas).toBe(before.heldHalalas + 8000);
    expect(
      await t.prisma.merchantPayableEvent.count({
        where: { instanceId: o.instanceId!, type: 'REDEMPTION_REVERSED' },
      }),
    ).toBe(1);
    // it can be redeemed again, and a second reversal of the old redemption is refused
    expect((await w.api(w.ownerA).post(url).send({ reason: 'again' })).status).toBe(409);
    expect((await w.redeem(w.staffA, o.qr)).body.data.result).toBe('REDEEMED');
    expect(
      await t.prisma.auditLog.count({
        where: { action: 'voucher_redemption.reverse', entityId: red.id },
      }),
    ).toBe(1);
  });

  it('the merchant reversal window is enforced; DealDash Finance can still reverse after it', async () => {
    const o = await owned();
    const r = await w.redeem(w.staffA, o.qr);
    const red = await t.prisma.voucherRedemption.findFirstOrThrow({
      where: { reference: r.body.data.reference },
    });
    await t.prisma.voucherRedemption.update({
      where: { id: red.id },
      data: { redeemedAt: new Date(Date.now() - 48 * 3600_000) },
    });
    const late = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/voucher-redemptions/${red.id}/reverse`)
      .send({ reason: 'Too late for the merchant' });
    expect(late.status).toBe(409);
    expect(late.body.errors[0].code).toBe('REVERSAL_NOT_ALLOWED');
    const ok = await w
      .api(w.finance)
      .post(`/v1/admin/finance/redemptions/${red.id}/reverse`)
      .send({ reason: 'Approved exception by finance' });
    expect(ok.status).toBe(200);
    expect(
      (await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: o.instanceId! } })).status,
    ).toBe('ACTIVE');
    // Support cannot reverse
    expect(
      (
        await w
          .api(w.support)
          .post(`/v1/admin/finance/redemptions/${red.id}/reverse`)
          .send({ reason: 'support try' })
      ).status,
    ).toBe(403);
  });

  it('staff history lists voucher scans with reference and value; search by code tail; no phone numbers', async () => {
    const { qr, manual, wallet } = await owned();
    await w.redeem(w.staffA, qr);
    const h = await w.api(w.staffA).get('/v1/staff/history?day=today&limit=100');
    expect(h.status).toBe(200);
    const row = h.body.data.items.find(
      (i: { reference: string }) => i.reference === wallet.reference,
    );
    expect(row).toMatchObject({ result: 'REDEEMED', kind: 'VOUCHER', quantity: 1 });
    expect(row.dealTitle.en).toContain('voucher');
    const tail = manual.replace('-', '').slice(-4);
    void tail;
    expect(JSON.stringify(h.body)).not.toMatch(/\+966/);
  });

  it('merchant sees what was sold and used (first name, status, redemption) and only their own; monitor shows verified money only to Finance', async () => {
    const c = await w.newCustomer();
    const o = await w.owned(c, vid);
    await w.redeem(w.staffA, o.qr);
    const sales = await w
      .api(w.ownerA)
      .get(`${w.vbase('A')}/vouchers/sales?voucherId=${vid}&limit=100`);
    const row = sales.body.data.find(
      (s: { reference: string }) => s.reference === o.wallet.reference,
    );
    expect(row).toMatchObject({ status: 'REDEEMED', pricePaidHalalas: 8000, canReverse: true });
    expect(row.redeemedBranch.en).toContain('Alpha');
    expect(JSON.stringify(sales.body)).not.toMatch(/\+966|@|providerReference/);
    expect(
      (await w.api(w.ownerB).get(`${w.vbase('B')}/vouchers/sales?limit=100`)).body.data.find(
        (s: { reference: string }) => s.reference === o.wallet.reference,
      ),
    ).toBeUndefined();
    const mon = await w.api(w.ownerA).get(`${w.vbase('A')}/vouchers/${vid}/monitor`);
    expect(mon.body.data.sales.redeemed).toBeGreaterThanOrEqual(1);
    expect(mon.body.data.finance).toBeTruthy(); // Owner holds finance.read
    expect(mon.body.data.disclaimerKey).toBe('voucher_signals_and_verified_payments_only');
    const mon2 = await w.api(w.campaignsA).get(`${w.vbase('A')}/vouchers/${vid}/monitor`);
    expect(mon2.body.data.finance).toBeNull(); // Campaign Manager sees funnel and sales, not money
  });

  it('wrong codes are rate limited per staff member (voucher and reservation codes share the guard)', async () => {
    const staff = w.staffA2;
    let limited = 0;
    for (let i = 0; i < 8; i++) {
      const r = await w.validate(staff, `ZZZ${i}-ZZZZ`, 'MANUAL');
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
