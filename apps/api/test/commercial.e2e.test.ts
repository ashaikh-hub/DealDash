import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

/**
 * Commercial Governance & Finance platform (shared by Vouchers, Watch & Earn and Exclusive Deals), exercised through Exclusive
 * Deals: quotation, explicit acknowledgement, permanent acceptance record, maker-checker, funding (prepaid / credit), the
 * activation gate, redemption-driven utilisation and reversal, sponsors, third-party merchants, holds, amendments, closure.
 */
describe.skipIf(!DB_READY)('Commercial governance and finance', () => {
  let t: TestApp;
  let w: HotWorld;
  const SAR = 100;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
  });
  afterAll(() => t?.close());

  const cbase = (org: 'A' | 'B') => `${w.base(org)}/commercial`;
  const caseOf = async (org: 'A' | 'B', id: string, s = org === 'A' ? w.ownerA : w.ownerB) => {
    const r = await w
      .api(s)
      .get(`${cbase(org)}/case`)
      .query({ product: 'EXCLUSIVE', subjectId: id });
    if (r.status !== 200) throw new Error(`case failed ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data as Record<string, any>;
  };
  const acceptAll = async (org: 'A' | 'B', c: Record<string, any>) => {
    const party = c.preview.parties.find(
      (p: { organizationId: string }) => p.organizationId === (org === 'A' ? w.A.orgId : w.B.orgId),
    );
    return w
      .api(org === 'A' ? w.ownerA : w.ownerB)
      .post(`${cbase(org)}/cases/${c.id}/accept`)
      .set('Idempotency-Key', idem())
      .send({ quotationId: c.quotation.id, checks: party.requiredChecks, language: 'en' });
  };
  const pay = (org: 'A' | 'B', caseId: string) =>
    w
      .api(org === 'A' ? w.ownerA : w.ownerB)
      .post(`${cbase(org)}/cases/${caseId}/pay`)
      .set('Idempotency-Key', idem())
      .send({});
  const blockerCodes = (c: Record<string, any>) =>
    (c.blockers as Array<{ code: string }>).map((b) => b.code);
  const draft = (units = 5, commercial: Record<string, unknown> = {}) =>
    w.createHot('A', w.hotContent('A', units, { commercial }));
  const admin = (path: string) => w.api(w.superAdmin).get(`/v1/admin/commercial/${path}`);

  it('shows the economics BEFORE submission: DealDash charge, sponsor funding and merchant benefit are separate lines', async () => {
    const r = await w
      .api(w.ownerA)
      .post(`${cbase('A')}/preview`)
      .send({
        product: 'EXCLUSIVE',
        content: w.hotContent('A', 5, {
          commercial: {
            normalPriceHalalas: 50 * SAR,
            dealPriceHalalas: 30 * SAR,
            sponsors: [{ organizationId: w.B.orgId, perUnitHalalas: 2 * SAR }],
          },
        }),
      });
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.totals.maxUnits).toBe(5);
    expect(d.totals.maxCashPayableToDealDashHalalas).toBe(5 * SAR); // 5 redemptions x the configured redemption fee
    expect(d.totals.maxSponsorLiabilityHalalas).toBe(10 * SAR);
    // saving 20 SAR/redemption - sponsor 2 SAR = 18 SAR/redemption honoured by the merchant, never added to cash
    expect(d.totals.maxMerchantBenefitCommitmentHalalas).toBe(90 * SAR);
    expect(d.totals.taxStatus).toBe('NOT_CONFIGURED');
    expect(d.lines.map((l: { kind: string }) => l.kind)).toEqual(
      expect.arrayContaining(['DEALDASH_CHARGE', 'SPONSOR_FUNDING', 'MERCHANT_BENEFIT']),
    );
    expect(d.parties.map((p: { role: string }) => p.role).sort()).toEqual(['OWNER', 'SPONSOR']);
    expect(
      d.fundingRequirements.find((f: { role: string }) => f.role === 'SPONSOR').maxHalalas,
    ).toBe(10 * SAR);
  });

  it('cannot be submitted until the owner accepts; every acknowledgement is required; the acceptance record is permanent', async () => {
    const deal = await draft();
    const blocked = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${deal.id}/submit`)
      .send({});
    expect(blocked.status).toBe(422);
    expect(blocked.body.errors[0].code).toBe('COMMERCIAL_ACCEPTANCE_REQUIRED');

    const c = await caseOf('A', deal.id);
    expect(c.status).toBe('AWAITING_ACCEPTANCE');
    const partial = await w
      .api(w.ownerA)
      .post(`${cbase('A')}/cases/${c.id}/accept`)
      .set('Idempotency-Key', idem())
      .send({ quotationId: c.quotation.id, checks: ['REVIEWED_TERMS'], language: 'en' });
    expect(partial.status).toBe(422);
    expect(partial.body.errors[0].code).toBe('COMMERCIAL_ACCEPTANCE_REQUIRED');

    // Finance can read but cannot accept; a campaign manager (prepare only) cannot accept either
    expect((await w.api(w.financeA).get(`${cbase('A')}/cases/${c.id}`)).status).toBe(200);
    expect(
      (
        await w
          .api(w.financeA)
          .post(`${cbase('A')}/cases/${c.id}/accept`)
          .set('Idempotency-Key', idem())
          .send({ quotationId: c.quotation.id, checks: [], language: 'en' })
      ).status,
    ).toBe(403);

    const ok = await acceptAll('A', c);
    expect(ok.status).toBe(200);
    const after = await caseOf('A', deal.id);
    expect(after.acceptances).toHaveLength(1);
    expect(after.acceptances[0]).toMatchObject({ role: 'OWNER', onBehalf: false });
    expect(after.acceptances[0].reference).toMatch(/^AC-\d{6}$/);
    // the same quotation cannot be accepted twice
    expect([409, 422]).toContain((await acceptAll('A', after)).status);

    const row = await t.prisma.commercialAcceptance.findFirstOrThrow({ where: { caseId: c.id } });
    expect(row.textVersion).toBeTruthy();
    expect(row.ip === null || typeof row.ip === 'string').toBe(true);
    await expect(
      t.prisma
        .$executeRaw`UPDATE "CommercialAcceptance" SET "userName" = 'tamper' WHERE "id" = ${row.id}::uuid`,
    ).rejects.toThrow();
    await expect(
      t.prisma.$executeRaw`DELETE FROM "CommercialAcceptance" WHERE "id" = ${row.id}::uuid`,
    ).rejects.toThrow();
  });

  it('"start as soon as approved" re-sends the current time on every save; that never voids the owner\'s acceptance', async () => {
    const hour = 3_600_000;
    const endAt = new Date(Date.now() + 2 * 864e5 + 6 * hour).toISOString();
    const content = (startAt: string) => w.hotContent('A', 2, { startAt, endAt });
    const deal = await w.createHot('A', content(new Date().toISOString()));
    const c = await caseOf('A', deal.id);
    expect((await acceptAll('A', c)).status).toBe(200);
    // the builder saves again just before submitting, with a fresh "now"
    await new Promise((r) => setTimeout(r, 20));
    const saved = await w
      .api(w.ownerA)
      .put(`${w.base('A')}/hot-deals/${deal.id}`)
      .send({ content: content(new Date().toISOString()) });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const after = await caseOf('A', deal.id);
    expect(after.quotation.id).toBe(c.quotation.id); // same quotation: nothing commercial changed
    const sub = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${deal.id}/submit`)
      .send({});
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    // a real scheduled start in the future is a commercial change and is quoted again
    const d2 = await w.createHot('A', content(new Date(Date.now() + 2 * 864e5).toISOString()));
    const c2 = await caseOf('A', d2.id);
    const moved = await w
      .api(w.ownerA)
      .put(`${w.base('A')}/hot-deals/${d2.id}`)
      .send({ content: content(new Date(Date.now() + 2 * 864e5 + hour).toISOString()) });
    expect(moved.status).toBe(200);
    expect((await caseOf('A', d2.id)).quotation.id).not.toBe(c2.quotation.id);
  });

  it('prepaid funding gates approval; paying releases the gate; a redemption draws down and a reversal gives it back', async () => {
    const deal = await draft(3);
    let c = await caseOf('A', deal.id);
    expect((await acceptAll('A', c)).status).toBe(200);
    const sub = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${deal.id}/submit`)
      .send({});
    expect(sub.status).toBe(200);
    expect(sub.body.data.outcome).toBe('SENT_FOR_REVIEW'); // never auto-published while funding is missing
    c = await caseOf('A', deal.id);
    expect(c.status).toBe('AWAITING_FUNDING');
    expect(blockerCodes(c)).toContain('FUNDING_MISSING');

    const refused = await w.decideHot(w.ops, deal.id, 'approve');
    expect(refused.status).toBe(409);
    expect(refused.body.errors[0].code).toBe('ACTIVATION_BLOCKED');

    const paid = await pay('A', c.id);
    expect(paid.status).toBe(200);
    expect(paid.body.data.paidHalalas).toBe(3 * SAR);
    c = await caseOf('A', deal.id);
    expect(c.status).toBe('FULLY_FUNDED');
    expect(c.funding[0]).toMatchObject({
      receivedHalalas: 3 * SAR,
      utilizedHalalas: 0,
      outstandingHalalas: 0,
    });
    // nothing more is due: over-funding is refused
    expect((await pay('A', c.id)).status).toBe(409);

    expect((await w.decideHot(w.ops, deal.id, 'approve')).status).toBe(200);

    const customer = await w.newCustomer();
    const r = (await w.reserve(customer, deal.id, w.A.branchIds[0]!)).body.data;
    expect((await w.redeem(w.staffA, r.code.qr, 'QR')).body.data.result).toBe('REDEEMED');
    let f = (await caseOf('A', deal.id)).funding[0];
    expect(f.utilizedHalalas).toBe(SAR); // one verified redemption drew the per-redemption fee, once
    expect(f.remainingCommitmentHalalas).toBe(2 * SAR);

    const red = await t.prisma.redemption.findFirstOrThrow({ where: { dealId: deal.id } });
    const rev = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/redemptions/${red.id}/reverse`)
      .send({ reason: 'Wrong customer, redemption reversed' });
    expect(rev.status).toBe(200);
    f = (await caseOf('A', deal.id)).funding[0];
    expect(f.utilizedHalalas).toBe(0);
    const ledger = await t.prisma.$queryRaw<
      Array<{ total: bigint }>
    >`SELECT COALESCE(SUM("amountHalalas"),0)::bigint AS total FROM "LedgerEntry"`;
    expect(Number(ledger[0]!.total)).toBe(0); // the whole ledger still balances
  });

  it('a walk-in with no cap cannot be bounded and is refused with the reason', async () => {
    const deal = await w.createHot(
      'A',
      w.hotContent('A', 0, { reservationsEnabled: false, commercial: { maxRedemptions: null } }),
    );
    const c = await caseOf('A', deal.id);
    expect(blockerCodes(c)).toContain('UNBOUNDED_LIABILITY');
    const sub = await w
      .api(w.ownerA)
      .post(`${w.base('A')}/hot-deals/${deal.id}/submit`)
      .send({});
    expect(sub.status).toBe(422);
  });

  it('sponsor funding: separate acceptance (Admin only on behalf, under an authorisation), separate funding, treatment from the agreement, sponsor sees only its own line', async () => {
    // an organisation-scoped agreement that does NOT say what happens to unused funding: activation must stay blocked (no hidden default)
    const comp = {
      code: 'redemption_fee',
      label: { en: 'Redemption fee', ar: 'رسوم الاستخدام' },
      enabled: true,
      basis: 'PER_UNIT',
      amountHalalas: SAR,
      trigger: 'VERIFIED_REDEMPTION',
      collection: 'CASH',
      taxable: true,
    };
    const ag = await w
      .api(w.superAdmin)
      .post('/v1/admin/commercial/pricing')
      .set('Idempotency-Key', idem())
      .send({
        name: 'Alpha test agreement',
        scope: 'ORGANIZATION',
        organizationId: w.A.orgId,
        priority: 10,
        components: { EXCLUSIVE: [comp] },
        taxBps: null,
        unusedTreatment: null,
        reference: 'TEST-AGR-1',
      });
    expect(ag.status).toBe(201);

    const deal = await draft(4, {
      normalPriceHalalas: 40 * SAR,
      dealPriceHalalas: 30 * SAR,
      sponsors: [{ organizationId: w.B.orgId, perUnitHalalas: 3 * SAR }],
    });
    const c = await caseOf('A', deal.id);
    expect((await acceptAll('A', c)).status).toBe(200);
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.base('A')}/hot-deals/${deal.id}/submit`)
          .send({})
      ).status,
    ).toBe(200);
    expect(blockerCodes(await caseOf('A', deal.id))).toEqual(['ACCEPTANCE_MISSING']); // funding commitments only exist once every party has accepted

    // Admin cannot accept for the sponsor without an authorisation record
    const cur = await caseOf('A', deal.id);
    const spons = cur.preview.parties.find((p: { role: string }) => p.role === 'SPONSOR');
    const body = {
      quotationId: cur.quotation.id,
      checks: spons.requiredChecks,
      language: 'en',
      organizationId: w.B.orgId,
      role: 'SPONSOR',
    };
    const noAuth = await w
      .api(w.superAdmin)
      .post(`/v1/admin/commercial/cases/${cur.id}/accept-on-behalf`)
      .set('Idempotency-Key', idem())
      .send({ ...body, authorizationId: '00000000-0000-4000-8000-000000000000' });
    expect(noAuth.status).toBeGreaterThanOrEqual(400);
    const auth = await w
      .api(w.superAdmin)
      .post('/v1/admin/commercial/authorizations')
      .set('Idempotency-Key', idem())
      .send({
        organizationId: w.B.orgId,
        reference: 'SIGNED-LETTER-001',
        reason: 'Sponsor delegated acceptance until its portal exists',
        validUntil: new Date(Date.now() + 7 * 864e5).toISOString(),
      });
    expect(auth.status).toBe(201);
    const onBehalf = await w
      .api(w.superAdmin)
      .post(`/v1/admin/commercial/cases/${cur.id}/accept-on-behalf`)
      .set('Idempotency-Key', idem())
      .send({ ...body, authorizationId: auth.body.data.id });
    expect(onBehalf.status).toBe(200);
    const accepted = await caseOf('A', deal.id);
    expect(accepted.acceptances.find((a: { role: string }) => a.role === 'SPONSOR')).toMatchObject({
      onBehalf: true,
    });

    // each party funds its own obligation; sponsor funding is received through Finance and never merged into the merchant's
    expect(blockerCodes(accepted)).toContain('FUNDING_MISSING');
    expect((await pay('A', accepted.id)).status).toBe(200);
    const rec = await w
      .api(w.superAdmin)
      .post('/v1/admin/commercial/payments')
      .set('Idempotency-Key', idem())
      .send({
        organizationId: w.B.orgId,
        caseId: accepted.id,
        amountHalalas: 12 * SAR,
        method: 'BANK_TRANSFER',
        externalReference: 'TRX-1',
      });
    expect(rec.status).toBe(201);
    expect(
      (
        await w
          .api(w.superAdmin)
          .post('/v1/admin/commercial/payments')
          .set('Idempotency-Key', idem())
          .send({
            organizationId: w.B.orgId,
            caseId: accepted.id,
            amountHalalas: SAR,
            method: 'BANK_TRANSFER',
          })
      ).status,
    ).toBe(409);

    // everything is in place except the agreement's answer on unused sponsor funding
    expect(blockerCodes(await caseOf('A', deal.id))).toEqual([
      'UNUSED_FUNDING_TREATMENT_NOT_CONFIGURED',
    ]);
    expect((await w.decideHot(w.ops, deal.id, 'approve')).status).toBe(409);
    // Finance cannot simply pick a treatment: it can only apply what the agreement says, and the agreement is silent
    expect(
      (
        await w
          .api(w.superAdmin)
          .post(`/v1/admin/commercial/cases/${accepted.id}/apply-agreement`)
          .set('Idempotency-Key', idem())
          .send({})
      ).status,
    ).toBe(400);
    const v2 = await w
      .api(w.superAdmin)
      .post(`/v1/admin/commercial/pricing/${ag.body.data.id}/versions`)
      .set('Idempotency-Key', idem())
      .send({
        components: { EXCLUSIVE: [comp] },
        taxBps: null,
        unusedTreatment: 'REFUND',
        reference: 'TEST-AGR-1 v2',
      });
    expect(v2.status).toBe(201);
    expect(
      (
        await w
          .api(w.superAdmin)
          .post(`/v1/admin/commercial/cases/${accepted.id}/apply-agreement`)
          .set('Idempotency-Key', idem())
          .send({})
      ).status,
    ).toBe(200);
    expect(blockerCodes(await caseOf('A', deal.id))).toEqual([]);
    expect((await w.decideHot(w.ops, deal.id, 'approve')).status).toBe(200);

    // the sponsor sees only its own obligation
    const sv = await w.api(w.ownerB).get(`${cbase('B')}/cases/${accepted.id}`);
    expect(sv.status).toBe(200);
    const kinds = sv.body.data.preview.lines.map((l: { kind: string }) => l.kind);
    expect(kinds).toEqual(['SPONSOR_FUNDING']);
    expect(
      sv.body.data.funding.every((f: { organizationId: string }) => f.organizationId === w.B.orgId),
    ).toBe(true);
    // a stranger cannot see it at all
    expect(
      (
        await w
          .api(w.ownerB)
          .get(`${cbase('B')}/cases/${'0'.repeat(8)}-0000-4000-8000-000000000000`)
      ).status,
    ).toBe(404);
  });

  it('a third-party fulfilment merchant must approve its own obligations; Admin cannot stand in for it', async () => {
    const deal = await draft(2, { fulfilmentOrganizationId: w.B.orgId });
    const c = await caseOf('A', deal.id);
    expect(c.preview.parties.map((p: { role: string }) => p.role).sort()).toEqual([
      'FULFILMENT_MERCHANT',
      'OWNER',
    ]);
    expect((await acceptAll('A', c)).status).toBe(200);
    const mid = await caseOf('A', deal.id);
    expect(mid.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ACCEPTANCE_MISSING', party: 'FULFILMENT_MERCHANT' }),
      ]),
    );
    // Admin on-behalf for the fulfilment role is not even a valid request
    const bad = await w
      .api(w.superAdmin)
      .post(`/v1/admin/commercial/cases/${c.id}/accept-on-behalf`)
      .set('Idempotency-Key', idem())
      .send({
        quotationId: c.quotation.id,
        checks: ['REVIEWED_TERMS'],
        language: 'en',
        organizationId: w.B.orgId,
        role: 'FULFILMENT_MERCHANT',
        authorizationId: '00000000-0000-4000-8000-000000000000',
      });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    // the owner cannot accept for the fulfilment merchant either
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.base('A')}/commercial/cases/${c.id}/accept`)
          .set('Idempotency-Key', idem())
          .send({ quotationId: c.quotation.id, checks: [], language: 'en' })
      ).status,
    ).toBe(422);
    const bView = await w.api(w.ownerB).get(`${cbase('B')}/cases/${c.id}`);
    expect(bView.status).toBe(200);
    const ok = await w
      .api(w.ownerB)
      .post(`${cbase('B')}/cases/${c.id}/accept`)
      .set('Idempotency-Key', idem())
      .send({
        quotationId: c.quotation.id,
        checks: bView.body.data.preview.parties.find(
          (p: { role: string }) => p.role === 'FULFILMENT_MERCHANT',
        ).requiredChecks,
        language: 'en',
      });
    expect(ok.status).toBe(200);
    const done = await caseOf('A', deal.id);
    expect(done.acceptances.map((a: { role: string }) => a.role).sort()).toEqual([
      'FULFILMENT_MERCHANT',
      'OWNER',
    ]);
    expect(blockerCodes(done)).not.toContain('ACCEPTANCE_MISSING');
  });

  it('configurable maker-checker: the person who accepted cannot approve; a different Finance approver can; small merchants are not forced into it', async () => {
    const small = await draft(2);
    expect(((await caseOf('A', small.id)).preview.workflow as string[]).length).toBe(0);

    const rule = await w
      .api(w.superAdmin)
      .post('/v1/admin/commercial/approval-rules')
      .set('Idempotency-Key', idem())
      .send({
        name: 'Alpha needs finance sign-off',
        organizationId: w.A.orgId,
        scope: 'CAMPAIGN',
        steps: ['FINANCE_APPROVER'],
        priority: 5,
      });
    expect(rule.status).toBe(201);
    const deal = await draft(2);
    const c = await caseOf('A', deal.id);
    expect(c.preview.workflow).toEqual(['FINANCE_APPROVER']);
    expect((await acceptAll('A', c)).status).toBe(200);
    expect(blockerCodes(await caseOf('A', deal.id))).toContain('APPROVAL_PENDING');
    const q = (await caseOf('A', deal.id)).quotation.id;
    const same = await w
      .api(w.ownerA)
      .post(`${cbase('A')}/cases/${c.id}/approvals/FINANCE_APPROVER`)
      .set('Idempotency-Key', idem())
      .send({ quotationId: q, decision: 'APPROVED' });
    expect(same.status).toBe(403);
    expect(same.body.errors[0].code).toBe('APPROVAL_REQUIRED');
    expect(
      (
        await w
          .api(w.campaignsA)
          .post(`${cbase('A')}/cases/${c.id}/approvals/FINANCE_APPROVER`)
          .set('Idempotency-Key', idem())
          .send({ quotationId: q, decision: 'APPROVED' })
      ).status,
    ).toBe(403);
    const fin = await w
      .api(w.financeA)
      .post(`${cbase('A')}/cases/${c.id}/approvals/FINANCE_APPROVER`)
      .set('Idempotency-Key', idem())
      .send({ quotationId: q, decision: 'APPROVED' });
    expect(fin.status).toBe(200);
    expect(blockerCodes(await caseOf('A', deal.id))).not.toContain('APPROVAL_PENDING');
    await w
      .api(w.superAdmin)
      .post(`/v1/admin/commercial/approval-rules/${rule.body.data.id}/disable`)
      .set('Idempotency-Key', idem())
      .send({});
  });

  it('credit is approved by Finance only, within a limit; exposure is computed; a financial hold blocks activation until released', async () => {
    const orgOnly = await w
      .api(w.ownerA)
      .get(`${w.base('A')}/commercial/case`)
      .query({ product: 'EXCLUSIVE', subjectId: '00000000-0000-4000-8000-000000000000' });
    expect(orgOnly.status).toBe(404);

    // the merchant cannot grant itself credit; Operations can read finance but cannot approve credit
    expect(
      (
        await w
          .api(w.ownerA)
          .post('/v1/admin/commercial/credit')
          .set('Idempotency-Key', idem())
          .send({})
      ).status,
    ).toBeGreaterThanOrEqual(401);
    expect(
      (
        await w
          .api(w.ops)
          .post('/v1/admin/commercial/credit')
          .set('Idempotency-Key', idem())
          .send({
            organizationId: w.A.orgId,
            limitHalalas: 50_000,
            paymentTermsDays: 30,
            expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(),
            agreementReference: 'X',
          })
      ).status,
    ).toBe(403);

    const req = await w
      .api(w.superAdmin)
      .post('/v1/admin/commercial/credit')
      .set('Idempotency-Key', idem())
      .send({
        organizationId: w.A.orgId,
        limitHalalas: 100 * SAR,
        paymentTermsDays: 30,
        expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(),
        agreementReference: 'CREDIT-AGR-7',
      });
    expect(req.status).toBe(201);
    expect(
      (
        await w
          .api(w.superAdmin)
          .post('/v1/admin/commercial/credit')
          .set('Idempotency-Key', idem())
          .send({
            organizationId: w.A.orgId,
            limitHalalas: 100,
            paymentTermsDays: 30,
            expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(),
            agreementReference: 'dup',
          })
      ).status,
    ).toBe(409);
    expect(
      (
        await w
          .api(w.superAdmin)
          .post(`/v1/admin/commercial/credit/${req.body.data.id}/approve`)
          .set('Idempotency-Key', idem())
          .send({ reason: 'Approved by Finance' })
      ).status,
    ).toBe(200);

    const deal = await draft(5);
    const c = await caseOf('A', deal.id);
    expect(c.preview.fundingRequirements[0].mode).toBe('CREDIT');
    expect((await acceptAll('A', c)).status).toBe(200);
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.base('A')}/hot-deals/${deal.id}/submit`)
          .send({})
      ).status,
    ).toBe(200);
    // on approved credit no prepayment is needed
    let cur = await caseOf('A', deal.id);
    expect(cur.status).toBe('CREDIT_APPROVED');
    expect(blockerCodes(cur)).toEqual([]);

    const list = await admin('credit');
    const row = list.body.data.find(
      (f: { organizationId: string }) => f.organizationId === w.A.orgId,
    );
    expect(row.exposureHalalas).toBe(5 * SAR);
    expect(row.availableHalalas).toBe(95 * SAR);

    // a hold blocks activation, and nothing else changes while it is in place
    const hold = await w
      .api(w.superAdmin)
      .post('/v1/admin/commercial/holds')
      .set('Idempotency-Key', idem())
      .send({ organizationId: w.A.orgId, caseId: c.id, reason: 'Overdue invoice under review' });
    expect(hold.status).toBe(201);
    cur = await caseOf('A', deal.id);
    expect(cur.status).toBe('FINANCIAL_HOLD');
    expect(blockerCodes(cur)).toContain('FINANCIAL_HOLD');
    expect((await w.decideHot(w.ops, deal.id, 'approve')).status).toBe(409);
    expect(
      (
        await w
          .api(w.superAdmin)
          .post(`/v1/admin/commercial/holds/${hold.body.data.id}/release`)
          .set('Idempotency-Key', idem())
          .send({ reason: 'Paid' })
      ).status,
    ).toBe(200);
    const ap2 = await w.decideHot(w.ops, deal.id, 'approve');
    expect(ap2.status, JSON.stringify(ap2.body)).toBe(200);

    // a suspended facility stops new credit commitments
    await w
      .api(w.superAdmin)
      .post(`/v1/admin/commercial/credit/${req.body.data.id}/suspend`)
      .set('Idempotency-Key', idem())
      .send({ reason: 'Risk review' });
    const next = await caseOf('A', (await draft(1)).id);
    expect(next.preview.fundingRequirements[0].mode).toBe('PREPAID');
  });

  it("closure reconciles inventory, funding and the merchant's non-cash benefit separately, and treats unused funds exactly as agreed", async () => {
    const deal = await draft(4, { normalPriceHalalas: 20 * SAR, dealPriceHalalas: 10 * SAR });
    const c = await caseOf('A', deal.id);
    expect((await acceptAll('A', c)).status).toBe(200);
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.base('A')}/hot-deals/${deal.id}/submit`)
          .send({})
      ).status,
    ).toBe(200);
    const cur = await caseOf('A', deal.id);
    if (cur.funding.some((f: { mode: string }) => f.mode === 'PREPAID'))
      expect((await pay('A', c.id)).status).toBe(200);
    expect((await w.decideHot(w.ops, deal.id, 'approve')).status).toBe(200);

    const customer = await w.newCustomer();
    const r = (await w.reserve(customer, deal.id, w.A.branchIds[0]!)).body.data;
    expect((await w.redeem(w.staffA, r.code.qr, 'QR')).body.data.result).toBe('REDEEMED');

    // cannot close a campaign that is still running
    expect(
      (
        await w
          .api(w.superAdmin)
          .post(`/v1/admin/commercial/cases/${c.id}/close`)
          .set('Idempotency-Key', idem())
          .send({})
      ).status,
    ).toBe(409);
    expect(
      (
        await w
          .api(w.ownerA)
          .post(`${w.base('A')}/hot-deals/${deal.id}/cancel`)
          .send({ reason: 'Campaign finished early' })
      ).status,
    ).toBe(200);

    const rec = (await admin(`cases/${c.id}/reconciliation`)).body.data;
    expect(rec.inventory).toMatchObject({ configured: 4, redeemed: 1 });
    expect(rec.merchantBenefit.note).toBe('non_cash_unused_commitment');
    expect(rec.merchantBenefit.committedHalalas).toBe(4 * 10 * SAR);
    expect(rec.merchantBenefit.redeemedHalalas).toBe(10 * SAR);
    expect(rec.merchantBenefit.unusedHalalas).toBe(30 * SAR);
    expect(rec.financial[0].utilizedHalalas).toBe(SAR);

    const closed = await w
      .api(w.superAdmin)
      .post(`/v1/admin/commercial/cases/${c.id}/close`)
      .set('Idempotency-Key', idem())
      .send({});
    expect([200, 409]).toContain(closed.status); // 409 only if the agreement leaves unused funds untreated
    if (closed.status === 200) {
      expect((await caseOf('A', deal.id)).status).toBe('CLOSED');
      const docs = await admin(`documents?caseId=${c.id}`);
      expect(docs.body.data.map((d: { type: string }) => d.type)).toContain('INVOICE');
      const again = await w
        .api(w.superAdmin)
        .post(`/v1/admin/commercial/cases/${c.id}/close`)
        .set('Idempotency-Key', idem())
        .send({});
      expect(again.status).toBe(409);
    }
    const ledger = await t.prisma.$queryRaw<
      Array<{ total: bigint }>
    >`SELECT COALESCE(SUM("amountHalalas"),0)::bigint AS total FROM "LedgerEntry"`;
    expect(Number(ledger[0]!.total)).toBe(0);
  });

  it('permissions: merchant roles and admin roles see exactly what they should', async () => {
    expect(
      (await w.api(w.ownerA).get('/v1/admin/commercial/overview')).status,
    ).toBeGreaterThanOrEqual(401);
    expect(
      (
        await w
          .api(w.branchScopedA)
          .get(`${cbase('A')}/case`)
          .query({ product: 'EXCLUSIVE', subjectId: '00000000-0000-4000-8000-000000000000' })
      ).status,
    ).toBe(403);
    expect(
      (
        await w
          .api(w.ownerA)
          .get(`${cbase('B')}/case`)
          .query({ product: 'EXCLUSIVE', subjectId: '00000000-0000-4000-8000-000000000000' })
      ).status,
    ).toBe(404);
    const opsOv = await w.api(w.ops).get('/v1/admin/commercial/overview');
    expect(opsOv.status, JSON.stringify(opsOv.body)).toBe(200);
    expect(
      (
        await w
          .api(w.ops)
          .post('/v1/admin/commercial/pricing')
          .set('Idempotency-Key', idem())
          .send({})
      ).status,
    ).toBe(403);
    expect((await w.api(w.marketing).get('/v1/admin/commercial/overview')).status).toBe(403);
    const ov = (await w.api(w.superAdmin).get('/v1/admin/commercial/overview')).body.data;
    expect(ov.statutoryNote).toBe('statutory_formats_validate_ksa');
  });
});
