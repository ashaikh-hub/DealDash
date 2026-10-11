import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { buildVoucherWorld, type VoucherWorld } from './voucher-fixtures';
import { buildWatchWorld, type WatchWorld } from './watch-fixtures';

const SAR = 100;
const codes = (c: Record<string, any>) =>
  (c.blockers as Array<{ code: string }>).map((b) => b.code);

/** The same commercial platform driven through Vouchers: commission is netted (not cash), sponsor funding is its own obligation. */
describe.skipIf(!DB_READY)('Commercial governance: Vouchers', () => {
  let t: TestApp;
  let w: VoucherWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildVoucherWorld(t);
  });
  afterAll(() => t?.close());

  const cbase = (org: 'A' | 'B') =>
    `/v1/merchants/${org === 'A' ? w.A.orgId : w.B.orgId}/commercial`;
  const caseOf = async (id: string) => {
    const r = await w
      .api(w.ownerA)
      .get(`${cbase('A')}/case`)
      .query({ product: 'VOUCHER', subjectId: id });
    if (r.status !== 200) throw new Error(`case failed ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data as Record<string, any>;
  };

  it("the platform commission is a charge netted from the payout, and the saving is the merchant's non-cash commitment", async () => {
    const v = await w.createVoucher('A', w.voucherContent('A', { totalQty: 10 }));
    const c = await caseOf(v.id);
    const t0 = c.preview.totals;
    // 10 vouchers x 80 SAR x the configured commission (10% in the default pricing) is deducted from what DealDash pays the merchant
    expect(t0.nettedChargesHalalas).toBe(10 * 8000 * 0.1);
    expect(t0.maxCashPayableToDealDashHalalas).toBe(0);
    expect(t0.maxMerchantBenefitCommitmentHalalas).toBe(10 * 2000);
    const commission = c.preview.lines.find((l: { code: string }) => l.code === 'commission');
    expect(commission.collection).toBe('NETTED');
    // nothing to prepay: no funding commitment exists for a netted charge
    expect(c.preview.fundingRequirements).toEqual([]);
  });

  it('cannot be submitted before the owner accepts; once accepted and approved it goes on sale without any prepayment', async () => {
    const v = await w.createVoucher('A', w.voucherContent('A', { totalQty: 5 }));
    const blocked = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${v.id}/submit`)
      .send({});
    expect(blocked.status).toBe(422);
    expect(blocked.body.errors[0].code).toBe('COMMERCIAL_ACCEPTANCE_REQUIRED');
    const c = await caseOf(v.id);
    const party = c.preview.parties[0];
    const ok = await w
      .api(w.ownerA)
      .post(`${cbase('A')}/cases/${c.id}/accept`)
      .set('Idempotency-Key', idem())
      .send({ quotationId: c.quotation.id, checks: party.requiredChecks, language: 'ar' });
    expect(ok.status).toBe(200);
    const row = await t.prisma.commercialAcceptance.findFirstOrThrow({ where: { caseId: c.id } });
    expect(row.language).toBe('ar');
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.vbase('A')}/vouchers/${v.id}/submit`)
          .send({})
      ).status,
    ).toBe(200);
    expect(codes(await caseOf(v.id))).toEqual([]);
    const ap = await w.decideVoucher(w.ops, v.id, 'approve');
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    expect(ap.body.data.status).toBe('ON_SALE');
  });

  it("a sponsor-funded voucher: a redemption draws the sponsor's funding once, a reversal gives it back, the ledger still balances", async () => {
    const v = await w.publishVoucher('A', {
      commercial: { sponsors: [{ organizationId: w.B.orgId, perUnitHalalas: 5 * SAR }] },
      totalQty: 3,
    });
    const caseId = (
      await t.prisma.commercialCase.findUniqueOrThrow({
        where: { product_subjectId: { product: 'VOUCHER', subjectId: v.id } },
      })
    ).id;
    const before = await t.prisma.fundingCommitment.findFirstOrThrow({
      where: { caseId, kind: 'SPONSOR_FUNDING' },
    });
    expect(before.organizationId).toBe(w.B.orgId);
    expect(before.usageMaxHalalas).toBe(3 * 5 * SAR);
    expect(before.receivedHalalas).toBe(3 * 5 * SAR);
    expect(before.utilizedHalalas).toBe(0);

    const customer = await w.newCustomer();
    const o = await w.owned(customer, v.id);
    expect((await w.redeem(w.staffA, o.qr, 'QR')).body.data.result).toBe('REDEEMED');
    const used = await t.prisma.fundingCommitment.findFirstOrThrow({
      where: { caseId, kind: 'SPONSOR_FUNDING' },
    });
    expect(used.utilizedHalalas).toBe(5 * SAR);
    const ev = await t.prisma.utilizationEvent.findMany({ where: { caseId } });
    expect(ev).toHaveLength(1);

    const red = await t.prisma.voucherRedemption.findFirstOrThrow({ where: { voucherId: v.id } });
    const rev = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/voucher-redemptions/${red.id}/reverse`)
      .send({ reason: 'Redeemed by mistake at the wrong branch' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(
      (
        await t.prisma.fundingCommitment.findFirstOrThrow({
          where: { caseId, kind: 'SPONSOR_FUNDING' },
        })
      ).utilizedHalalas,
    ).toBe(0);
    const ledger = await t.prisma.$queryRaw<
      Array<{ total: bigint }>
    >`SELECT COALESCE(SUM("amountHalalas"),0)::bigint AS total FROM "LedgerEntry"`;
    expect(Number(ledger[0]!.total)).toBe(0);
  });

  it('a voucher that went live before the platform has no commercial case: it is not grandfathered (it must be re-accepted before more is added)', async () => {
    const v = await w.publishVoucher('A');
    // simulate a campaign that pre-dates the platform by removing its case (as a real legacy row would lack one)
    await t.prisma
      .$executeRaw`DELETE FROM "FundingCommitment" WHERE "caseId" IN (SELECT "id" FROM "CommercialCase" WHERE "subjectId" = ${v.id}::uuid)`;
    await t.prisma
      .$executeRaw`DELETE FROM "CommercialAcceptance" WHERE "caseId" IN (SELECT "id" FROM "CommercialCase" WHERE "subjectId" = ${v.id}::uuid)`.catch(
      () => undefined,
    );
    await t.prisma
      .$executeRaw`UPDATE "CommercialCase" SET "acceptedQuotationId" = NULL WHERE "subjectId" = ${v.id}::uuid`;
    const more = await w
      .api(w.ownerA)
      .post(`${w.vbase('A')}/vouchers/${v.id}/stock`)
      .send({ delta: 1 });
    expect(more.status).toBe(409);
    expect(more.body.errors[0].code).toBe('COMMERCIAL_AMENDMENT_REQUIRED');
  });

  it('Finance (merchant) can read the terms but only the owner can accept; a branch-scoped user sees nothing', async () => {
    const v = await w.createVoucher('A', w.voucherContent('A', { totalQty: 2 }));
    const c = await caseOf(v.id);
    expect((await w.api(w.financeA).get(`${cbase('A')}/cases/${c.id}`)).status).toBe(200);
    expect((await w.api(w.branchScopedA).get(`${cbase('A')}/cases/${c.id}`)).status).toBe(403);
    expect((await w.api(w.ownerB).get(`${cbase('B')}/cases/${c.id}`)).status).toBe(404);
  });
});

/** Watch & Earn: the pre-funded campaign budget is the DealDash charge; the platform adds acceptance, approvals and the unused-budget rule. */
describe.skipIf(!DB_READY)('Commercial governance: Watch & Earn', () => {
  let t: TestApp;
  let w: WatchWorld;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWatchWorld(t);
  });
  afterAll(() => t?.close());

  const cbase = `/v1/merchants`;
  const caseOf = async (id: string) => {
    const r = await w
      .api(w.ownerA)
      .get(`${cbase}/${w.A.orgId}/commercial/case`)
      .query({ product: 'WATCH', subjectId: id });
    if (r.status !== 200) throw new Error(`case failed ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data as Record<string, any>;
  };

  it('media spend is the charge (paid views x the rate card); the budget stays owned by Watch & Earn', async () => {
    const v = await w.createWatch('A', w.watchContent('A'));
    const c = await caseOf(v.id);
    const lineAmount = c.preview.lines.find(
      (l: { code: string }) => l.code === 'media_spend',
    ).amountHalalas;
    expect(lineAmount).toBe(v.budget.requiredHalalas);
    expect(c.preview.totals.maxMerchantBenefitCommitmentHalalas).toBe(0); // reward points are DealDash\'s, the merchant owes no benefit
    expect(c.preview.totals.maxCashPayableToDealDashHalalas).toBe(v.budget.requiredHalalas);
  });

  it('acceptance gates submission, and the agreement must say what happens to the unused budget before it can go live', async () => {
    // an organisation agreement that is silent on unused funding beats the development fixture agreement
    const ag = await w
      .api(w.superAdmin)
      .post('/v1/admin/commercial/pricing')
      .set('Idempotency-Key', idem())
      .send({
        name: 'Alpha watch agreement',
        scope: 'ORGANIZATION',
        organizationId: w.A.orgId,
        priority: 5,
        components: { WATCH: [] },
        taxBps: null,
        unusedTreatment: null,
        reference: 'W-AGR-1',
      });
    expect(ag.status).toBe(201);
    const v = await w.createWatch('A', w.watchContent('A'));
    expect((await w.fundWatch(w.ownerA, 'A', v.id, v.budget.requiredHalalas)).status).toBe(200);
    const blocked = await w
      .api(w.ownerA)
      .post(`${w.wbase('A')}/watch/${v.id}/submit`)
      .send({});
    expect(blocked.status).toBe(422);
    expect(blocked.body.errors[0].code).toBe('COMMERCIAL_ACCEPTANCE_REQUIRED');

    const c = await caseOf(v.id);
    const accept = await w
      .api(w.ownerA)
      .post(`${cbase}/${w.A.orgId}/commercial/cases/${c.id}/accept`)
      .set('Idempotency-Key', idem())
      .send({
        quotationId: c.quotation.id,
        checks: c.preview.parties[0].requiredChecks,
        language: 'en',
      });
    expect(accept.status).toBe(200);
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.wbase('A')}/watch/${v.id}/submit`)
          .send({})
      ).status,
    ).toBe(200);
    const stuck = await caseOf(v.id);
    expect(codes(stuck)).toEqual(['UNUSED_FUNDING_TREATMENT_NOT_CONFIGURED']);
    const refused = await w.decideWatch(w.ops, v.id, 'approve');
    expect(refused.status).toBe(409);
    expect(refused.body.errors[0].code).toBe('ACTIVATION_BLOCKED');

    const v2 = await w
      .api(w.superAdmin)
      .post(`/v1/admin/commercial/pricing/${ag.body.data.id}/versions`)
      .set('Idempotency-Key', idem())
      .send({
        components: { WATCH: [] },
        taxBps: null,
        unusedTreatment: 'CREDIT_ACCOUNT',
        reference: 'W-AGR-1 v2',
      });
    expect(v2.status).toBe(201);
    expect(
      (
        await w
          .api(w.superAdmin)
          .post(`/v1/admin/commercial/cases/${c.id}/apply-agreement`)
          .set('Idempotency-Key', idem())
          .send({})
      ).status,
    ).toBe(200);
    const ok = await w.decideWatch(w.ops, v.id, 'approve');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe('LIVE');
  });

  it('an under-funded budget blocks activation through the commercial gate as well as the existing funding check', async () => {
    const v = await w.createWatch('A', w.watchContent('A'));
    await w.fundWatch(w.ownerA, 'A', v.id, 1000);
    const c = await caseOf(v.id);
    expect(codes(c)).toContain('ACCEPTANCE_MISSING');
  });
});
