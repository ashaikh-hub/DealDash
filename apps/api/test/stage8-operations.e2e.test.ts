import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PUSH_PROVIDER } from '../src/providers/interfaces';
import type { MockPushProvider } from '../src/providers/mocks';
import { NotificationsService } from '../src/hot-deals/notifications.service';
import { RestrictionsService } from '../src/ops/restrictions.service';
import { SlaService } from '../src/ops/sla.service';
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
import { buildVoucherWorld, type VoucherWorld } from './voucher-fixtures';

/**
 * Stage 8 — operational gap closure: the shared case framework (lifecycle, routing, approval, escalation to businesses, contact log,
 * customer notification), customer support, refund operations, governed financial adjustments, settlement, reconciliation
 * exceptions, fraud / risk operations, restrictions and holds, reviews and moderation, notification delivery, SLA escalation, rules
 * and controls, privacy data requests, audit completeness, market / tenant isolation and the operations copilot.
 */
describe.skipIf(!DB_READY)('Stage 8 operations', () => {
  let t: TestApp;
  let w: VoucherWorld;
  let risk: Session;
  let risk2: Session;
  let dd: string;
  const post = (s: Session, url: string, body: unknown = {}) =>
    w
      .api(s)
      .post(url)
      .set('Idempotency-Key', idem())
      .send(body as object);
  const get = (s: Session, url: string) => w.api(s).get(url);
  const ops = (p: string) => `/v1/admin/ops${p}`;

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildVoucherWorld(t);
    dd = (await createDealDashOrg(t.prisma)).id;
    const adm = async (role: Parameters<typeof createBusinessUser>[1]['role']) =>
      passwordSession(
        t,
        await createBusinessUser(t.prisma, { role, orgId: dd, userType: 'ADMIN_USER', mfa: true }),
        'admin',
        { completeMfa: true },
      );
    risk = await adm('DEALDASH_RISK_COMPLIANCE');
    risk2 = await adm('DEALDASH_RISK_COMPLIANCE');
    await t.prisma.merchantSettlementAccount.upsert({
      where: { organizationId: w.A.orgId },
      update: { verificationStatus: 'VERIFIED', payoutHold: false },
      create: {
        organizationId: w.A.orgId,
        bankName: 'Test Bank',
        ibanEnc: 'x',
        ibanMasked: 'SA•••1234',
        accountHolderName: 'Alpha Grill',
        verificationStatus: 'VERIFIED',
      },
    });
  });
  afterAll(() => t?.close());

  // ================================================================ shared exception / case framework
  describe('case framework', () => {
    let caseId = '';
    it('a case carries routing, market, severity and SLA; the lifecycle is configuration; a business answers a request', async () => {
      const r = await post(w.ops, '/v1/admin/disputes', {
        type: 'VOUCHER_EXCEPTION',
        title: 'Voucher not honoured at the counter',
        targetOrganizationId: w.A.orgId,
        transactionRef: 'ORD-TEST-1',
        financialImpactMinor: 5000,
        currency: 'SAR',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      caseId = r.body.data.id;
      expect(r.body.data).toMatchObject({
        severity: 'MEDIUM',
        assignedTeam: 'SUPPORT',
        queue: 'CUSTOMER_CARE',
        market: 'SA',
        slaState: 'ON_TRACK',
        approvalState: 'NOT_REQUIRED',
      });
      // a move the lifecycle does not allow
      const bad = await post(w.ops, `/v1/admin/disputes/${caseId}/transition`, {
        to: 'AWAITING_APPROVAL',
      });
      expect(bad.status).toBe(409);
      expect(bad.body.errors[0].code).toBe('CASE_TRANSITION_INVALID');
      expect(
        (await post(w.ops, `/v1/admin/disputes/${caseId}/transition`, { to: 'AWAITING_CUSTOMER' }))
          .status,
      ).toBe(409); // not about a customer
      // ask the merchant: a SHARED note it can answer; its inbox shows a response is required
      const ask = await post(w.ops, `/v1/admin/disputes/${caseId}/transition`, {
        to: 'AWAITING_MERCHANT',
        note: 'Please share the counter receipt for this order.',
      });
      expect(ask.status, JSON.stringify(ask.body)).toBe(200);
      expect(ask.body.data.status).toBe('AWAITING_MERCHANT');
      const inbox = (await get(w.ownerA, `/v1/orgs/${w.A.orgId}/inbox`)).body.data as Array<{
        kind: string;
        entityId: string;
      }>;
      expect(inbox.find((i) => i.entityId === caseId)?.kind).toBe('CASE_RESPONSE_REQUIRED');
      const mine = (await get(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${caseId}`)).body.data;
      expect(mine.notes.map((n: { body: string }) => n.body)).toContain(
        'Please share the counter receipt for this order.',
      );
      expect(mine.assignedTeam).toBeNull(); // routing stays with DealDash
      const reply = await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${caseId}/notes`, {
        body: 'Receipt attached on our side; the staff member was new.',
      });
      expect(reply.status).toBe(201);
      expect((await get(w.ops, `/v1/admin/disputes/${caseId}`)).body.data.status).toBe(
        'INVESTIGATING',
      );
      // another merchant never sees it
      expect((await get(w.ownerB, `/v1/orgs/${w.B.orgId}/disputes/${caseId}`)).status).toBe(404);
      // a logged contact is internal
      expect(
        (
          await post(w.ops, `/v1/admin/disputes/${caseId}/contacts`, {
            channel: 'PHONE',
            direction: 'OUTBOUND',
            body: 'Called the branch manager.',
          })
        ).status,
      ).toBe(201);
      expect(
        (await get(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${caseId}`)).body.data.notes.some(
          (n: { body: string }) => n.body === 'Called the branch manager.',
        ),
      ).toBe(false);
    });

    it('a resolution with a financial impact needs a second (finance) person; the maker cannot approve it', async () => {
      const direct = await post(w.ops, `/v1/admin/disputes/${caseId}/resolve`, {
        outcome: 'RESOLVED',
        resolution: 'Goodwill credit agreed',
      });
      expect(direct.body.errors[0].code).toBe('APPROVAL_REQUIRED');
      const req = await post(w.ops, `/v1/admin/disputes/${caseId}/approval`, {
        proposedResolution: 'Credit SAR 50 to the merchant payable as goodwill',
        financialImpactMinor: 5000,
      });
      expect(req.status, JSON.stringify(req.body)).toBe(200);
      expect(req.body.data).toMatchObject({
        status: 'AWAITING_APPROVAL',
        approvalState: 'PENDING',
      });
      const self = await post(w.ops, `/v1/admin/disputes/${caseId}/approval/decide`, {
        decision: 'APPROVE',
        reason: 'Looks fine',
      });
      expect(self.status).toBe(403);
      const ok = await post(w.finance, `/v1/admin/disputes/${caseId}/approval/decide`, {
        decision: 'APPROVE',
        reason: 'Goodwill within policy',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data).toMatchObject({
        status: 'RESOLVED',
        approvalState: 'APPROVED',
        resolution: 'Credit SAR 50 to the merchant payable as goodwill',
      });
      // audit completeness: market, approval reference and previous / new state
      const a = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: caseId, action: 'CASE_APPROVAL_GRANTED' },
      });
      expect(a).toMatchObject({ market: 'SA', approvalRef: w.ops.me.id });
      expect(a.previousState).toEqual({ status: 'AWAITING_APPROVAL' });
      const listed = await get(w.superAdmin, `/v1/admin/audit?entityId=${caseId}`);
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      expect(
        listed.body.data.find((x: { action: string }) => x.action === 'CASE_APPROVAL_GRANTED'),
      ).toMatchObject({ market: 'SA', approvalRef: w.ops.me.id });
    });

    it('a market-scoped DealDash user sees only its market’s cases', async () => {
      const u = await createBusinessUser(t.prisma, {
        role: 'DEALDASH_OPERATIONS',
        orgId: dd,
        userType: 'ADMIN_USER',
        mfa: true,
        label: 'ae-ops',
      });
      const m = await t.prisma.organizationMembership.findFirstOrThrow({
        where: { userId: u.id, organizationId: dd },
      });
      await t.prisma.organizationMembership.update({ where: { id: m.id }, data: { scoped: true } });
      await t.prisma.roleAssignment.create({
        data: {
          organizationId: dd,
          membershipId: m.id,
          userId: u.id,
          roleId: m.roleId,
          scopeKind: 'COUNTRY',
          scopeRef: 'AE',
          grantedByUserId: w.superAdmin.me.id,
          reason: 'UAE operations',
        },
      });
      const ae = await passwordSession(t, u, 'admin', { completeMfa: true });
      const list = (await get(ae, '/v1/admin/disputes')).body.data as Array<{
        market: string | null;
        id: string;
      }>;
      expect(list.every((c) => c.market === 'AE')).toBe(true);
      expect((await get(ae, `/v1/admin/disputes/${caseId}`)).status).toBe(404);
    });
  });

  // ================================================================ customer support, refunds, cross-portal
  describe('customer support and refunds', () => {
    it('support escalates a customer request into a case; the merchant answers; the customer is told the outcome', async () => {
      const v = await w.publishVoucher('A');
      const c = await w.newCustomer();
      const { instanceId, orderId } = await w.owned(c, v.id);
      const sc = await w.api(c).post('/v1/app/support-cases').set('Idempotency-Key', idem()).send({
        type: 'VOUCHER_ISSUE',
        subject: 'Voucher refused',
        body: 'The branch said my voucher was not valid.',
        voucherInstanceId: instanceId,
      });
      expect(sc.status, JSON.stringify(sc.body)).toBe(201);
      const esc = await post(w.support, ops(`/support-requests/${sc.body.data.id}/escalate`), {});
      expect(esc.status, JSON.stringify(esc.body)).toBe(200);
      expect(esc.body.data).toMatchObject({
        type: 'VOUCHER_EXCEPTION',
        organizationId: w.A.orgId,
        customerUserId: c.me.id,
      });
      const caseId = esc.body.data.id;
      expect(
        (await post(w.support, ops(`/support-requests/${sc.body.data.id}/escalate`), {})).body.data
          .id,
      ).toBe(caseId); // idempotent
      expect(
        (
          await post(w.support, `/v1/admin/disputes/${caseId}/transition`, {
            to: 'AWAITING_MERCHANT',
            note: 'Please check with the Olaya branch.',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${caseId}/notes`, {
            body: 'Staff training issue; the voucher is valid.',
          })
        ).status,
      ).toBe(201);
      const done = await post(w.ops, `/v1/admin/disputes/${caseId}/resolve`, {
        outcome: 'RESOLVED',
        resolution: 'The branch confirmed the voucher is valid; the customer can use it.',
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      const n = await t.prisma.notification.findFirst({
        where: { userId: c.me.id, type: 'CASE_UPDATED' },
      });
      expect(n?.data).toMatchObject({ event: 'RESOLVED' });
      const mine = (await get(c, '/v1/app/me/cases')).body.data as Array<{
        id: string;
        resolution: string;
        open: boolean;
      }>;
      expect(mine.find((x) => x.id === caseId)).toMatchObject({
        open: false,
        resolution: 'The branch confirmed the voucher is valid; the customer can use it.',
      });
      // the support workspace: summary and the consolidated timeline (minimised)
      const s = await get(w.support, ops(`/customers/${c.me.id}/summary`));
      expect(s.status).toBe(200);
      expect(s.body.data.activeVouchers).toBe(1);
      expect(s.body.data.mobileMasked).toMatch(/•••/);
      const tl = await get(w.support, `/v1/admin/visibility/customers/${c.me.id}/timeline`);
      expect(tl.status, JSON.stringify(tl.body)).toBe(200);
      expect(tl.body.data.items.map((i: { kind: string }) => i.kind)).toEqual(
        expect.arrayContaining(['ORDER', 'VOUCHER', 'DISPUTE']),
      );
      // refund eligibility shows the policy and stops nothing silently
      const el = await get(w.support, ops(`/refunds/eligibility?instanceId=${instanceId}`));
      expect(el.status, JSON.stringify(el.body)).toBe(200);
      expect(el.body.data).toMatchObject({
        eligible: true,
        market: 'SA',
        orderLevel: { duplicatePayment: false, failedIssuance: false },
      });
      // support cannot start an order-level refund (finance can), nor alter financial history directly
      expect(
        (
          await post(w.support, ops('/refunds/order'), {
            orderId,
            paymentId: orderId,
            reason: 'DUPLICATE_PAYMENT',
            note: 'test',
          })
        ).status,
      ).toBe(403);
    });

    it('an order-level duplicate-payment refund is idempotent and needs a second person', async () => {
      const v = await w.publishVoucher('A');
      const c = await w.newCustomer();
      const { orderId } = await w.buy(c, v.id);
      const first = await t.prisma.payment.findFirstOrThrow({
        where: { orderId, status: 'SUCCEEDED' },
      });
      const fi = await post(w.finance, ops('/refunds/order'), {
        orderId,
        paymentId: first.id,
        reason: 'FAILED_ISSUANCE',
        note: 'Not applicable: vouchers were issued',
      });
      expect(fi.status).toBe(409);
      expect(
        (
          await post(w.finance, ops('/refunds/order'), {
            orderId,
            paymentId: first.id,
            reason: 'DUPLICATE_PAYMENT',
            note: 'Only one payment',
          })
        ).status,
      ).toBe(409);
      // the provider captured the same order twice
      const dup = await t.prisma.payment.create({
        data: {
          orderId,
          provider: 'mock',
          currency: 'SAR', // KSA fixture order
          providerReference: `dup-${idem()}`,
          status: 'SUCCEEDED',
          amountHalalas: first.amountHalalas,
          attemptNo: 2,
          idempotencyKey: `dup-${idem()}`,
          completedAt: new Date(),
        },
      });
      const r1 = await post(w.finance, ops('/refunds/order'), {
        orderId,
        paymentId: dup.id,
        reason: 'DUPLICATE_PAYMENT',
        note: 'Captured twice by the provider',
      });
      expect(r1.status, JSON.stringify(r1.body)).toBe(201);
      expect(r1.body.data.status).toBe('REQUESTED');
      const r2 = await post(w.finance, ops('/refunds/order'), {
        orderId,
        paymentId: dup.id,
        reason: 'DUPLICATE_PAYMENT',
        note: 'Again',
      });
      expect(r2.body.data.id).toBe(r1.body.data.id); // idempotent: one refund per payment
      const self = await post(w.finance, `/v1/admin/finance/refunds/${r1.body.data.id}/approve`, {
        reason: 'Looks fine',
      });
      expect(self.status).toBe(403);
      const ok = await post(w.finance2, `/v1/admin/finance/refunds/${r1.body.data.id}/approve`, {
        reason: 'Duplicate confirmed with the provider',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(
        (await t.prisma.refund.findUniqueOrThrow({ where: { id: r1.body.data.id } })).status,
      ).toBe('REFUNDED');
      // the customer's voucher from the first payment is untouched
      expect(await t.prisma.voucherInstance.count({ where: { orderId, status: 'ACTIVE' } })).toBe(
        1,
      );
    });
  });

  // ================================================================ governed financial adjustments
  describe('financial adjustments', () => {
    it('below its threshold an adjustment applies at once; above it a different finance person approves; nothing original is edited', async () => {
      const small = await post(w.finance, ops('/adjustments'), {
        kind: 'SETTLEMENT_ADJUSTMENT',
        direction: 'CREDIT',
        amountMinor: 5000,
        organizationId: w.B.orgId,
        reasonCode: 'GOODWILL',
        reason: 'Goodwill credit',
      });
      expect(small.status, JSON.stringify(small.body)).toBe(201);
      expect(small.body.data).toMatchObject({
        status: 'APPLIED',
        requiresApproval: false,
        market: 'SA',
      });
      const big = await post(w.finance, ops('/adjustments'), {
        kind: 'SETTLEMENT_ADJUSTMENT',
        direction: 'DEBIT',
        amountMinor: 150_000,
        organizationId: w.B.orgId,
        reasonCode: 'CORRECTION',
        reason: 'Double-counted redemption',
      });
      expect(big.body.data).toMatchObject({ status: 'PENDING_APPROVAL', requiresApproval: true });
      expect(
        (
          await post(w.finance, ops(`/adjustments/${big.body.data.id}/decide`), {
            decision: 'APPROVE',
            reason: 'Looks fine',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(w.ops, ops(`/adjustments/${big.body.data.id}/decide`), {
            decision: 'APPROVE',
            reason: 'Looks fine',
          })
        ).status,
      ).toBe(403);
      const ok = await post(w.finance2, ops(`/adjustments/${big.body.data.id}/decide`), {
        decision: 'APPROVE',
        reason: 'Checked against the ledger',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.status).toBe('APPLIED');
      const j = await t.prisma.ledgerJournal.findUniqueOrThrow({
        where: { id: ok.body.data.appliedRef.id },
        include: { entries: true },
      });
      expect(j.entries.reduce((n, e) => n + e.amountHalalas, 0)).toBe(0);
      // the legacy direct endpoint refuses large amounts (governed workflow instead); small corrections still work
      const direct = await w.api(w.finance).post('/v1/admin/finance/adjustments').send({
        organizationId: w.A.orgId,
        amountHalalas: 200_000,
        reason: 'Too big for one person',
      });
      expect(direct.status).toBe(409);
      expect(direct.body.errors[0].code).toBe('APPROVAL_REQUIRED');
      // the inbox shows pending approvals to finance approvers
      const pending = await post(w.finance, ops('/adjustments'), {
        kind: 'ADMIN_ADJUSTMENT',
        direction: 'CREDIT',
        amountMinor: 100,
        organizationId: w.B.orgId,
        reasonCode: 'GOODWILL',
        reason: 'Always approved by a second person',
      });
      expect(pending.body.data.status).toBe('PENDING_APPROVAL');
      const inbox = (await get(w.finance2, '/v1/admin/inbox')).body.data as Array<{
        kind: string;
        entityId: string;
      }>;
      expect(
        inbox.some((i) => i.kind === 'ADJUSTMENT_APPROVAL' && i.entityId === pending.body.data.id),
      ).toBe(true);
    });

    it('points adjustments go through the rewards ledger; support can request, a second person approves large ones', async () => {
      const c = await w.newCustomer();
      const small = await post(w.support, ops('/adjustments'), {
        kind: 'POINTS_ADJUSTMENT',
        direction: 'CREDIT',
        points: 50,
        customerUserId: c.me.id,
        reasonCode: 'GOODWILL',
        reason: 'Late voucher delivery',
      });
      expect(small.status, JSON.stringify(small.body)).toBe(201);
      expect(small.body.data.status).toBe('APPLIED');
      expect(
        (await t.prisma.rewardAccount.findUniqueOrThrow({ where: { userId: c.me.id } }))
          .availableBalance,
      ).toBe(50);
      const big = await post(w.support, ops('/adjustments'), {
        kind: 'POINTS_ADJUSTMENT',
        direction: 'CREDIT',
        points: 500,
        customerUserId: c.me.id,
        reasonCode: 'GOODWILL',
        reason: 'Big goodwill',
      });
      expect(big.body.data.status).toBe('PENDING_APPROVAL');
      expect(
        (
          await post(w.support, ops(`/adjustments/${big.body.data.id}/decide`), {
            decision: 'APPROVE',
            reason: 'Looks fine',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(risk, ops(`/adjustments/${big.body.data.id}/decide`), {
            decision: 'REJECT',
            reason: 'Not justified',
          })
        ).body.data.status,
      ).toBe('REJECTED');
      expect(
        (await t.prisma.rewardAccount.findUniqueOrThrow({ where: { userId: c.me.id } }))
          .availableBalance,
      ).toBe(50);
    });
  });

  // ================================================================ settlement and reconciliation
  describe('settlement and reconciliation', () => {
    let settlementId = '';
    it('no approved market settlement rule: the run refuses (no cycle is invented)', async () => {
      const r = await post(w.finance, ops('/settlements/run'), {
        market: 'SA',
        organizationId: w.A.orgId,
      });
      expect(r.status).toBe(409);
      expect(r.body.errors[0].code).toBe('SETTLEMENT_RULE_MISSING');
    });

    it('a run settles eligible payable once; disputes hold it; release needs a different person; payouts post the ledger', async () => {
      await t.prisma.settlementRule.create({
        data: {
          market: 'SA',
          product: 'VOUCHER',
          code: 'TEST_WEEKLY',
          currency: 'SAR',
          frequency: 'WEEKLY',
          cycleDays: 7,
          minimumMinor: 0,
          holdDays: 0,
          effectiveFrom: new Date(Date.now() - 86_400_000),
          status: 'APPROVED',
          createdByUserId: w.superAdmin.me.id,
        } as never,
      });
      const v = await w.publishVoucher('A');
      const c = await w.newCustomer();
      const o = await w.owned(c, v.id);
      expect((await w.redeem(w.staffA, o.qr)).status).toBe(200);
      // an open case with a financial impact on the merchant holds its settlement
      const dispute = await post(w.ops, '/v1/admin/disputes', {
        type: 'SETTLEMENT_EXCEPTION',
        title: 'Payable disputed',
        targetOrganizationId: w.A.orgId,
        financialImpactMinor: 1000,
      });
      const run = await post(w.finance, ops('/settlements/run'), {
        market: 'SA',
        organizationId: w.A.orgId,
      });
      expect(run.status, JSON.stringify(run.body)).toBe(200);
      const res = run.body.data.results[0];
      expect(res.outcome).toBe('DISPUTE_HOLD');
      settlementId = res.settlementId;
      const s = (await get(w.finance, ops(`/settlements/${settlementId}`))).body.data;
      expect(s.payableMinor).toBeGreaterThan(0);
      expect(s.grossMinor - s.feesMinor + s.adjustmentsMinor).toBe(s.payableMinor);
      // the same events never settle twice
      expect(
        (
          await post(w.finance, ops('/settlements/run'), {
            market: 'SA',
            organizationId: w.A.orgId,
          })
        ).body.data.results[0].outcome,
      ).toBe('NOTHING_TO_SETTLE');
      expect(
        (await post(w.finance2, ops(`/settlements/${settlementId}/release`), { reason: 'Try' }))
          .body.errors[0].code,
      ).toBe('SETTLEMENT_ON_HOLD');
      await post(w.ops, `/v1/admin/disputes/${dispute.body.data.id}/approval`, {
        proposedResolution: 'Payable confirmed correct',
      });
      await post(w.finance2, `/v1/admin/disputes/${dispute.body.data.id}/approval/decide`, {
        decision: 'APPROVE',
        reason: 'Confirmed',
      });
      expect(
        (
          await post(w.finance, ops(`/settlements/${settlementId}/release`), {
            reason: 'Dispute closed',
          })
        ).status,
      ).toBe(403); // created it
      const rel = await post(w.finance2, ops(`/settlements/${settlementId}/release`), {
        reason: 'Dispute closed',
      });
      expect(rel.status, JSON.stringify(rel.body)).toBe(200);
      expect(rel.body.data.status).toBe('ELIGIBLE');
      const before = await t.prisma.ledgerEntry.aggregate({
        where: { account: { family: 'MERCHANT_SETTLEMENT_ELIGIBLE', organizationId: w.A.orgId } },
        _sum: { amountHalalas: true },
      });
      const part = await post(w.finance, ops(`/settlements/${settlementId}/payout`), {
        amountMinor: 100,
        externalRef: 'BANK-TRX-1',
      });
      expect(part.body.data).toMatchObject({ status: 'PARTIALLY_PAID', paidMinor: 100 });
      const full = await post(w.finance, ops(`/settlements/${settlementId}/payout`), {
        externalRef: 'BANK-TRX-2',
      });
      expect(full.body.data.status).toBe('COMPLETED');
      expect(full.body.data.outstandingMinor).toBe(0);
      const after = await t.prisma.ledgerEntry.aggregate({
        where: { account: { family: 'MERCHANT_SETTLEMENT_ELIGIBLE', organizationId: w.A.orgId } },
        _sum: { amountHalalas: true },
      });
      expect((after._sum.amountHalalas ?? 0) - (before._sum.amountHalalas ?? 0)).toBe(
        s.payableMinor,
      );
      // the merchant's finance user sees its own statement; another merchant does not
      expect(
        (await get(w.financeA, `/v1/merchants/${w.A.orgId}/settlements/${settlementId}`)).status,
      ).toBe(200);
      expect(
        (await get(w.ownerB, `/v1/merchants/${w.B.orgId}/settlements/${settlementId}`)).status,
      ).toBe(404);
    });

    it('reconciliation: a statement is matched line by line; exceptions are worked to resolution; internal ledgers are consistent', async () => {
      const pay = await t.prisma.payment.findFirstOrThrow({
        where: { status: 'SUCCEEDED', providerReference: { not: null } },
        orderBy: { completedAt: 'desc' },
      });
      const other = await t.prisma.payment.findFirstOrThrow({
        where: { status: 'SUCCEEDED', providerReference: { not: null }, id: { not: pay.id } },
        orderBy: { completedAt: 'desc' },
      });
      const at = (pay.completedAt ?? new Date()).toISOString();
      const st = await post(w.finance, ops('/reconciliation/statements'), {
        source: 'PAYMENT_GATEWAY',
        periodFrom: new Date(Date.now() - 86_400_000).toISOString(),
        periodTo: new Date(Date.now() + 60_000).toISOString(),
        lines: [
          { reference: pay.providerReference, amountMinor: pay.amountHalalas, occurredAt: at },
          { reference: pay.providerReference, amountMinor: pay.amountHalalas, occurredAt: at },
          {
            reference: other.providerReference,
            amountMinor: other.amountHalalas + 1,
            occurredAt: at,
          },
          { reference: 'UNKNOWN-REF', amountMinor: 999, occurredAt: at },
        ],
      });
      expect(st.status, JSON.stringify(st.body)).toBe(201);
      expect(st.body.data.totals).toMatchObject({
        MATCHED: 1,
        DUPLICATE: 1,
        AMOUNT_MISMATCH: 1,
        MISSING_INTERNAL: 1,
      });
      expect(st.body.data.totals.MISSING_EXTERNAL ?? 0).toBeGreaterThan(0);
      const items = (await get(w.finance, ops(`/reconciliation/items?runId=${st.body.data.runId}`)))
        .body.data as Array<{ id: string; status: string }>;
      const mism = items.find((i) => i.status === 'AMOUNT_MISMATCH')!;
      expect(
        (await post(w.ops, ops(`/reconciliation/items/${mism.id}/resolve`), { resolution: 'x' }))
          .status,
      ).toBe(403);
      const adj = await post(w.finance, ops('/adjustments'), {
        kind: 'RECONCILIATION_ADJUSTMENT',
        direction: 'DEBIT',
        amountMinor: 1,
        sourceType: 'ReconciliationItem',
        sourceId: mism.id,
        reasonCode: 'RECONCILIATION',
        reason: 'Provider fee rounding',
      });
      expect(adj.body.data.status).toBe('APPLIED');
      const done = await post(w.finance, ops(`/reconciliation/items/${mism.id}/resolve`), {
        resolution: 'Provider rounding written off',
        adjustmentRequestId: adj.body.data.id,
      });
      expect(done.body.data).toMatchObject({ status: 'RESOLVED', matchStatus: 'AMOUNT_MISMATCH' });
      // internal consistency: the merchant payable ledger agrees with payable events and payouts
      const cons = await post(w.finance, ops('/reconciliation/consistency'));
      expect(cons.status, JSON.stringify(cons.body)).toBe(200);
      const payable = await t.prisma.reconciliationItem.findFirst({
        where: { source: 'MERCHANT_PAYABLE', internalId: w.A.orgId },
      });
      expect(payable, JSON.stringify(payable)).toBeNull();
    });

    it('a settlement can be reversed by a finance approver; its events then settle again', async () => {
      const rev = await post(w.finance2, ops(`/settlements/${settlementId}/reverse`), {
        reason: 'Payout returned by the bank',
      });
      expect(rev.status, JSON.stringify(rev.body)).toBe(200);
      expect(rev.body.data.status).toBe('REVERSED');
      const again = await post(w.finance, ops('/settlements/run'), {
        market: 'SA',
        organizationId: w.A.orgId,
      });
      expect(again.body.data.results[0].outcome).toBe('ELIGIBLE');
    });
  });

  // ================================================================ fraud / risk, restrictions and holds
  describe('fraud, restrictions and holds', () => {
    it('rule-based flags are reviewed by a person; confirming only REQUESTS a hold that a second person approves; the customer keeps the voucher', async () => {
      const v = await w.publishVoucher('A');
      const c = await w.newCustomer();
      const o = await w.owned(c, v.id);
      // the attempts are another staff member's, so the real staff member's own rate limit is not used up
      const staff = await t.prisma.user.findFirstOrThrow({ where: { id: w.staffA2.me.id } });
      await t.prisma.redemptionAttempt.createMany({
        data: Array.from({ length: 10 }, () => ({
          staffUserId: staff.id,
          organizationId: w.A.orgId,
          branchId: w.A.branchIds[0]!,
          codeHint: 'XX',
          source: 'MANUAL' as const,
          kind: 'VALIDATE',
          result: 'INVALID_CODE' as const,
        })),
      });
      expect((await post(w.ops, ops('/risk/scan'))).status).toBe(403);
      const scan = await post(risk, ops('/risk/scan'));
      expect(scan.status, JSON.stringify(scan.body)).toBe(200);
      expect((await post(risk, ops('/risk/scan'))).body.data.created).toBe(0); // never duplicated
      const flags = (await get(risk, ops('/risk/flags?status=OPEN'))).body.data as Array<{
        id: string;
        ruleCode: string;
      }>;
      const branchFlag = flags.find((f) => f.ruleCode === 'SUSPICIOUS_BRANCH_ACTIVITY')!;
      expect(branchFlag).toBeTruthy();
      expect(flags.some((f) => f.ruleCode === 'REPEATED_CODE_ATTEMPTS')).toBe(true);
      // the Watch & Earn queue keeps its own flags only
      expect(
        ((await get(risk, '/v1/admin/risk/flags')).body.data as Array<{ id: string }>).some(
          (f) => f.id === branchFlag.id,
        ),
      ).toBe(false);
      const dec = await post(risk, ops(`/risk/flags/${branchFlag.id}/decide`), {
        outcome: 'CONFIRM',
        reason: 'Code guessing at the counter',
        restriction: { kind: 'BRANCH_REDEMPTION_HOLD', days: 3, reasonCode: 'FRAUD_SUSPECTED' },
      });
      expect(dec.status, JSON.stringify(dec.body)).toBe(200);
      expect(dec.body.data.restriction.status).toBe('PENDING_APPROVAL');
      // nothing is enforced yet
      const holdId = dec.body.data.restriction.id;
      expect(
        (
          await post(risk, ops(`/restrictions/${holdId}/decide`), {
            decision: 'APPROVE',
            reason: 'Looks fine',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(risk2, ops(`/restrictions/${holdId}/decide`), {
            decision: 'APPROVE',
            reason: 'Investigation open',
          })
        ).body.data.status,
      ).toBe('ACTIVE');
      const blocked = await w.redeem(w.staffA, o.qr);
      expect(blocked.status).toBe(409);
      expect(blocked.body.errors[0].code).toBe('BRANCH_REDEMPTION_HELD');
      expect(
        (await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: o.instanceId! } })).status,
      ).toBe('ACTIVE');
      expect(
        (await post(risk, ops(`/restrictions/${holdId}/lift`), { reason: 'Staff retrained' })).body
          .data.status,
      ).toBe('LIFTED');
      expect((await w.redeem(w.staffA, o.qr)).status).toBe(200);
    });

    it('a customer restriction stops new purchases only, is told to the customer, and expires', async () => {
      const v = await w.publishVoucher('A');
      const c = await w.newCustomer();
      const o = await w.owned(c, v.id);
      const r = await post(w.ops, ops('/restrictions'), {
        kind: 'CUSTOMER_RESTRICTION',
        subjectId: c.me.id,
        scope: ['NEW_PURCHASES'],
        reasonCode: 'POLICY_BREACH',
        reason: 'Repeated chargebacks',
        days: 2,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data.status, JSON.stringify(r.body)).toBe('PENDING_APPROVAL');
      expect(
        (
          await post(w.ops, ops(`/restrictions/${r.body.data.id}/decide`), {
            decision: 'APPROVE',
            reason: 'Looks fine',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(risk, ops(`/restrictions/${r.body.data.id}/decide`), {
            decision: 'APPROVE',
            reason: 'Policy breach confirmed',
          })
        ).status,
      ).toBe(200);
      const co = await w.checkout(c, v.id);
      expect(co.status).toBe(403);
      expect(co.body.errors[0].code).toBe('RESTRICTION_ACTIVE');
      // issued rights stay: the voucher is still in the wallet and usable
      expect(
        (await t.prisma.voucherInstance.findUniqueOrThrow({ where: { id: o.instanceId! } })).status,
      ).toBe('ACTIVE');
      expect((await w.walletOne(c, o.instanceId!)).status).toBe(200);
      expect(
        await t.prisma.notification.count({
          where: { userId: c.me.id, type: 'ACCOUNT_RESTRICTION' },
        }),
      ).toBe(1);
      await t.prisma.operationalRestriction.update({
        where: { id: r.body.data.id },
        data: {
          startsAt: new Date(Date.now() - 3 * 86_400_000),
          endsAt: new Date(Date.now() - 1000),
        },
      });
      expect(await t.app.get(RestrictionsService).expire()).toBeGreaterThan(0);
      expect((await w.checkout(c, v.id)).status).toBe(201);
    });

    it('a merchant campaign hold stops new exposure at that merchant', async () => {
      const v = await w.publishVoucher('B');
      const r = await post(w.ops, ops('/restrictions'), {
        kind: 'MERCHANT_CAMPAIGN_HOLD',
        subjectId: w.B.orgId,
        reasonCode: 'COMPLIANCE_REVIEW',
        reason: 'Licence check',
        days: 5,
      });
      await post(risk, ops(`/restrictions/${r.body.data.id}/decide`), {
        decision: 'APPROVE',
        reason: 'Licence expired',
      });
      const c = await w.newCustomer();
      const co = await w.checkout(c, v.id);
      expect(co.status).toBe(409);
      expect(co.body.errors[0].code).toBe('RESTRICTION_ACTIVE');
      await post(w.ops, ops(`/restrictions/${r.body.data.id}/lift`), { reason: 'Licence renewed' });
      expect((await w.checkout(c, v.id)).status).toBe(201);
    });
  });

  // ================================================================ reviews and moderation
  describe('reviews and moderation', () => {
    it('Verified only with a tracked merchant interaction; reports hide; moderators decide with a reason', async () => {
      const v = await w.publishVoucher('A');
      const verified = await w.newCustomer();
      const o = await w.owned(verified, v.id);
      expect((await w.redeem(w.staffA, o.qr)).status).toBe(200);
      const rv = await post(verified, `/v1/app/merchants/${w.A.orgId}/reviews`, {
        rating: 5,
        text: 'Great food and quick service.',
      });
      expect(rv.status, JSON.stringify(rv.body)).toBe(201);
      expect(rv.body.data.verified).toBe(true);
      const row = await t.prisma.review.findUniqueOrThrow({ where: { id: rv.body.data.id } });
      expect(row.verifiedInteractionType).toBe('VOUCHER_REDEMPTION');
      expect(
        (
          await post(verified, `/v1/app/merchants/${w.A.orgId}/reviews`, {
            rating: 4,
            text: 'Second review too soon.',
          })
        ).status,
      ).toBe(409);
      const community = await w.newCustomer();
      const cr = await post(community, `/v1/app/merchants/${w.A.orgId}/reviews`, {
        rating: 2,
        text: 'I only watched their video.',
      });
      expect(cr.body.data.verified).toBe(false);
      // the database refuses a "Verified" review without evidence (Watch & Earn is never evidence)
      await expect(
        t.prisma.review.update({
          where: { id: cr.body.data.id },
          data: {
            verified: true,
            verifiedInteractionType: 'WATCH_VIEW',
            verifiedInteractionId: cr.body.data.id,
          },
        }),
      ).rejects.toThrow();
      // three reports hide it until a moderator decides
      for (let i = 0; i < 3; i++) {
        const rep = await w.newCustomer();
        expect(
          (
            await post(rep, `/v1/app/reviews/${cr.body.data.id}/report`, {
              reason: 'FALSE_INFORMATION',
            })
          ).status,
        ).toBe(200);
      }
      expect(
        (await t.prisma.review.findUniqueOrThrow({ where: { id: cr.body.data.id } })).status,
      ).toBe('HIDDEN');
      const pub = (await w.api(community).get(`/v1/app/merchants/${w.A.orgId}/reviews`)).body.data;
      expect(pub.items.some((x: { id: string }) => x.id === cr.body.data.id)).toBe(false);
      // the merchant can report reviews about itself only
      expect(
        (
          await post(w.ownerA, `/v1/merchants/${w.A.orgId}/reviews/${rv.body.data.id}/report`, {
            reason: 'OTHER',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await post(w.ownerB, `/v1/merchants/${w.B.orgId}/reviews/${rv.body.data.id}/report`, {
            reason: 'OTHER',
          })
        ).status,
      ).toBe(404);
      const q = (await get(w.marketing, ops('/moderation'))).body.data as Array<{
        id: string;
        subjectId: string;
      }>;
      const item = q.find((x) => x.subjectId === cr.body.data.id)!;
      expect(
        (
          await post(w.ops, ops(`/moderation/${item.id}/decide`), {
            decision: 'RESTORE',
            reasonCode: 'POLICY_COMPLIANT',
            reason: 'Looks fine',
          })
        ).status,
      ).toBe(403);
      const dec = await post(w.marketing, ops(`/moderation/${item.id}/decide`), {
        decision: 'RESTORE',
        reasonCode: 'POLICY_COMPLIANT',
        reason: 'Opinion, not false information',
      });
      expect(dec.status, JSON.stringify(dec.body)).toBe(200);
      expect(
        (await t.prisma.review.findUniqueOrThrow({ where: { id: cr.body.data.id } })).status,
      ).toBe('PUBLISHED');
      expect(
        await t.prisma.auditLog.count({
          where: { action: 'MODERATION_DECIDED', entityId: cr.body.data.id },
        }),
      ).toBe(1);
    });
  });

  // ================================================================ notifications, SLA, rules and controls
  describe('notifications, SLA and configuration', () => {
    it('deliveries are tracked per channel, retried on schedule, fail visibly and can be retried by operations', async () => {
      const push = t.app.get(PUSH_PROVIDER) as MockPushProvider;
      const notifications = t.app.get(NotificationsService);
      const c = await w.newCustomer();
      push.failSends = true;
      try {
        const n = await t.prisma.notification.create({
          data: { userId: c.me.id, type: 'CASE_UPDATED', dedupeKey: `t:${idem()}`, data: {} },
        });
        expect(await notifications.sweepUntracked()).toBeGreaterThan(0);
        const d = await t.prisma.notificationDelivery.findFirstOrThrow({
          where: { notificationId: n.id, channel: 'PUSH' },
        });
        expect(d).toMatchObject({
          status: 'RETRYING',
          attempts: 1,
          templateCode: 'notification.CASE_UPDATED',
          consentChecked: true,
        });
        expect(
          await t.prisma.notificationDelivery.count({
            where: { notificationId: n.id, channel: 'IN_APP', status: 'DELIVERED' },
          }),
        ).toBe(1);
        for (let i = 0; i < 2; i++) {
          await t.prisma.notificationDelivery.update({
            where: { id: d.id },
            data: { nextRetryAt: new Date(Date.now() - 1000) },
          });
          await notifications.retryDue();
        }
        expect(
          (await t.prisma.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } })).status,
        ).toBe('FAILED');
        const list = (await get(w.ops, ops('/notifications?status=FAILED'))).body.data;
        expect(list.items.some((x: { id: string }) => x.id === d.id)).toBe(true);
        push.failSends = false;
        const retried = await post(w.ops, ops(`/notifications/${d.id}/retry`));
        expect(retried.body.data.status).toBe('DELIVERED');
      } finally {
        push.failSends = false;
      }
      expect((await get(w.analyst, ops('/notifications'))).status).toBe(403);
    });

    it('SLA: warning, breach and level-by-level escalation on the existing alert and task engine', async () => {
      const r = await post(w.ops, '/v1/admin/disputes', {
        type: 'INTEGRATION_EXCEPTION',
        title: 'Feed stopped',
        priority: 'HIGH',
      });
      const id = r.body.data.id;
      await t.prisma.disputeCase.update({
        where: { id },
        data: { slaDueAt: new Date(Date.now() - 60_000) },
      });
      const sla = t.app.get(SlaService);
      await sla.sweep();
      let c = await t.prisma.disputeCase.findUniqueOrThrow({ where: { id } });
      expect(c).toMatchObject({ slaState: 'BREACHED', escalationLevel: 1 });
      expect(
        await t.prisma.alertEvent.count({ where: { code: 'SLA_BREACHED', subjectId: id } }),
      ).toBe(1);
      await t.prisma.disputeCase.update({
        where: { id },
        data: { slaDueAt: new Date(Date.now() - 5 * 3_600_000) },
      });
      await sla.sweep();
      await sla.sweep(); // idempotent
      c = await t.prisma.disputeCase.findUniqueOrThrow({ where: { id } });
      expect(c.escalationLevel).toBe(2);
      expect(
        await t.prisma.approvalTask.count({ where: { kind: 'SLA_ESCALATION', entityId: id } }),
      ).toBe(2);
      expect(await t.prisma.caseNote.count({ where: { caseId: id, kind: 'ESCALATION' } })).toBe(2);
      const o = await get(w.ops, ops('/sla'));
      expect(
        o.body.data.items.some(
          (i: { id: string; state: string }) => i.id === id && i.state === 'BREACHED',
        ),
      ).toBe(true);
    });

    it('rules and controls are validated, versioned and audited; only configuration managers change them', async () => {
      const cur = (await get(w.superAdmin, ops('/config'))).body.data;
      expect(
        (
          await w
            .api(w.ops)
            .put(ops('/config'))
            .set('Idempotency-Key', idem())
            .send({ value: cur.value, reason: 'try' })
        ).status,
      ).toBe(403);
      const bad = await w
        .api(w.superAdmin)
        .put(ops('/config'))
        .set('Idempotency-Key', idem())
        .send({
          value: { ...cur.value, notifications: { ...cur.value.notifications, maxAttempts: 0 } },
          reason: 'invalid',
        });
      expect(bad.status).toBe(400);
      const ok = await w
        .api(w.superAdmin)
        .put(ops('/config'))
        .set('Idempotency-Key', idem())
        .send({
          value: { ...cur.value, reviews: { ...cur.value.reviews, hideAfterReports: 3 } },
          reason: 'Confirm the report threshold',
        });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.version).toBe(cur.version + 1);
      const h = (await get(w.superAdmin, ops('/config/history'))).body.data;
      expect(h[0]).toMatchObject({ reason: 'Confirm the report threshold' });
    });
  });

  // ================================================================ privacy, reporting, copilot
  describe('privacy, reporting and the operations copilot', () => {
    it('data requests: approved by a second person; a deletion keeps financial records and is refused while rights remain', async () => {
      const v = await w.publishVoucher('A');
      const holder = await w.newCustomer();
      await w.owned(holder, v.id);
      const del = await post(holder, '/v1/app/me/data-requests', { type: 'DELETION' });
      expect(del.status, JSON.stringify(del.body)).toBe(201);
      expect(del.body.data.status).toBe('PENDING_APPROVAL');
      const refused = await post(risk, ops(`/data-requests/${del.body.data.id}/decide`), {
        decision: 'APPROVE',
        reason: 'Requested by the customer',
      });
      expect(refused.status).toBe(409);
      expect(refused.body.errors[0].message).toMatch(/ACTIVE_VOUCHERS/);
      const fresh = await w.newCustomer();
      const ex = await post(w.support, ops('/data-requests'), {
        customerUserId: fresh.me.id,
        type: 'EXPORT',
      });
      expect(
        (
          await post(w.support, ops(`/data-requests/${ex.body.data.id}/decide`), {
            decision: 'APPROVE',
            reason: 'Looks fine',
          })
        ).status,
      ).toBe(403);
      const exDone = await post(risk, ops(`/data-requests/${ex.body.data.id}/decide`), {
        decision: 'APPROVE',
        reason: 'Identity confirmed',
      });
      expect(exDone.body.data).toMatchObject({ status: 'COMPLETED' });
      expect(exDone.body.data.result.format).toBe('JSON');
      const d2 = await post(w.support, ops('/data-requests'), {
        customerUserId: fresh.me.id,
        type: 'DELETION',
      });
      const d2Done = await post(risk, ops(`/data-requests/${d2.body.data.id}/decide`), {
        decision: 'APPROVE',
        reason: 'Identity confirmed',
      });
      expect(d2Done.status, JSON.stringify(d2Done.body)).toBe(200);
      const u = await t.prisma.user.findUniqueOrThrow({ where: { id: fresh.me.id } });
      expect(u).toMatchObject({ status: 'CLOSED', mobile: null, displayName: 'Deleted customer' });
    });

    it('the Command Centre exceptions and operational reports aggregate; drill-down narrows; analysts and merchants are refused', async () => {
      const all = await get(w.ops, ops('/exceptions'));
      expect(all.status, JSON.stringify(all.body)).toBe(200);
      expect(Object.keys(all.body.data.values)).toEqual(
        expect.arrayContaining([
          'SETTLEMENT_EXCEPTIONS',
          'RECONCILIATION_EXCEPTIONS',
          'FRAUD_FLAGS',
          'NOTIFICATION_FAILURES',
          'APPROVAL_BACKLOG',
        ]),
      );
      const b = await get(w.ops, ops(`/exceptions?organizationId=${w.B.orgId}`));
      expect(b.body.data.values.DISPUTES).toBeLessThanOrEqual(all.body.data.values.DISPUTES);
      const rep = await get(w.ops, ops('/reports?days=30'));
      expect(rep.body.data.cases.open).toBeGreaterThanOrEqual(0);
      expect(rep.body.data.refunds.some((r: { status: string }) => r.status === 'REFUNDED')).toBe(
        true,
      );
      const csv = await get(w.ops, ops('/reports.csv?days=30'));
      expect((JSON.parse(csv.text) as { data: string }).data.split('\n')[0]).toBe(
        'section,key,count,amount_minor_or_points',
      );
      expect((await get(w.analyst, ops('/exceptions'))).status).toBe(403);
      expect([401, 403]).toContain((await get(w.ownerA, ops('/exceptions'))).status);
    });

    it('the operations copilot summarises a case and drafts replies; nothing is sent until a person approves', async () => {
      const r = await post(w.ops, '/v1/admin/disputes', {
        type: 'CUSTOMER_COMPLAINT',
        title: 'Rude staff',
        customerUserId: w.ownerA.me.id === '' ? null : (await w.newCustomer()).me.id,
        targetOrganizationId: w.A.orgId,
      });
      const id = r.body.data.id;
      const ask = await w
        .api(w.superAdmin)
        .post('/v1/admin/ai/ask')
        .send({
          agent: 'OPERATIONS_SUPPORT',
          message: 'summarise this case',
          context: { caseId: id },
          autonomy: 2,
        });
      expect(ask.status, JSON.stringify(ask.body)).toBe(200);
      expect(ask.body.data.statements.some((s: { kind: string }) => s.kind === 'HYPOTHESIS')).toBe(
        true,
      );
      const kinds = ask.body.data.drafts.map((d: { kind: string }) => d.kind).sort();
      expect(kinds).toEqual(['CUSTOMER_RESPONSE', 'MERCHANT_REQUEST']);
      expect((await get(w.ops, `/v1/admin/disputes/${id}`)).body.data.status).toBe('OPEN'); // nothing executed
      const mr = ask.body.data.drafts.find((d: { kind: string }) => d.kind === 'MERCHANT_REQUEST');
      const ok = await post(w.superAdmin, `/v1/admin/ai/drafts/${mr.id}/approve`, {});
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect((await get(w.ops, `/v1/admin/disputes/${id}`)).body.data.status).toBe(
        'AWAITING_MERCHANT',
      );
    });
  });
});
