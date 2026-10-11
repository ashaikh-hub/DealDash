import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoyaltyIssuanceService } from '../src/loyalty/loyalty-issuance.service';
import { signCallback } from '../src/common/signed-callback';
import { latestCutoff } from '../src/ops/settlement.service';
import { PAYOUT_PROVIDER } from '../src/providers/interfaces';
import type { MockPayoutProvider } from '../src/providers/payout';
import { NotificationsService } from '../src/hot-deals/notifications.service';
import { ConfigGovernanceService } from '../src/ops/config-governance.service';
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

const PAYOUT_SECRET = 'payout-webhook-secret-0123456789abcdef-0123';
const NOTIFY_SECRET = 'notify-webhook-secret-0123456789abcdef-0123';

/**
 * Stage 9 — production and launch readiness: B4 proportional points reversal, B6 customer case replies, B7 governed rules and
 * controls, launch controls (pilot allow-list, emergency stops), B1 settlement rule controls (cut-off, reserve, withheld tax), B2 payout
 * instructions with signed callbacks, B3 delivery receipts and throttling, legal holds, health probes, security headers.
 */
describe.skipIf(!DB_READY)('Stage 9 production readiness', () => {
  let t: TestApp;
  let w: VoucherWorld;
  let super2: Session;
  let dd: string;
  const post = (s: Session, url: string, body: unknown = {}) =>
    w
      .api(s)
      .post(url)
      .set('Idempotency-Key', idem())
      .send(body as object);
  const get = (s: Session, url: string) => w.api(s).get(url);

  beforeAll(async () => {
    t = await createTestApp({
      PAYOUT_PROVIDER: 'mock',
      PAYOUT_WEBHOOK_SECRET: PAYOUT_SECRET,
      NOTIFY_WEBHOOK_SECRET: NOTIFY_SECRET,
    });
    w = await buildVoucherWorld(t);
    dd = (await createDealDashOrg(t.prisma)).id;
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

  // ================================================================ B4: proportional points reversal
  it('B4: a partial refund takes back the refunded share (FLOOR), replays take nothing, the last refund takes the rest, the earn is never rewritten', async () => {
    const v = await w.publishVoucher('A', { totalQty: 20, perCustomerLimit: 5 });
    const rule = await t.prisma.loyaltyRule.create({
      data: {
        name: `B4 ${v.id.slice(0, 6)}`,
        eventType: 'VOUCHER_PURCHASE',
        kind: 'BASE',
        productScope: 'VOUCHER',
        campaignId: v.id,
        basePoints: 0,
        pointsPer100Halalas: 1,
        maxAllocationPoints: 100_000,
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 3_600_000),
        createdByUserId: w.superAdmin.me.id as string,
      },
    });
    const c = await w.newCustomer();
    const b = await w.buy(c, v.id);
    const order = await t.prisma.voucherOrder.findUniqueOrThrow({ where: { id: b.orderId } });
    const earn = await t.prisma.rewardEntry.findFirstOrThrow({
      where: { ruleId: rule.id, type: 'EARN' },
    });
    expect(earn.points).toBe(80); // SAR 80 at 1 point per SAR 1
    const svc = t.app.get(LoyaltyIssuanceService);
    const reverse = (refundId: string, refundedMinor: number) =>
      t.prisma.$transaction((tx) =>
        svc.reverseProportional(tx, {
          sourceType: 'EVENT',
          sourceId: b.orderId,
          refundId,
          refundedMinor,
          baseMinor: order.totalHalalas,
          reason: 'PURCHASE_REFUNDED',
        }),
      );
    const r1 = randomUUID();
    // 33% refunded: floor(80 × 0.33) = 26
    expect(await reverse(r1, Math.round(order.totalHalalas * 0.33))).toBe(26);
    // the same refund again takes nothing (idempotent)
    expect(await reverse(r1, Math.round(order.totalHalalas * 0.33))).toBe(0);
    // cumulative 60%: owed floor(48) = 48, already 26 -> 22 more
    expect(await reverse(randomUUID(), Math.round(order.totalHalalas * 0.6))).toBe(22);
    // everything refunded: the rest (32), never more than earned
    expect(await reverse(randomUUID(), order.totalHalalas)).toBe(32);
    expect(await reverse(randomUUID(), order.totalHalalas)).toBe(0);
    const rows = await t.prisma.rewardEntry.findMany({
      where: { ruleId: rule.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => r.points)).toEqual([80, -26, -22, -32]);
    // the original earn entry is untouched (append-only ledger) and the rule got exactly the points back
    expect(await t.prisma.rewardEntry.findUniqueOrThrow({ where: { id: earn.id } })).toMatchObject({
      points: 80,
      type: 'EARN',
    });
    expect(
      (await t.prisma.loyaltyRule.findUniqueOrThrow({ where: { id: rule.id } })).reversedPoints,
    ).toBe(80);
  });

  it('B4: a full refund through the real refund flow still takes back every point exactly once', async () => {
    const v = await w.publishVoucher('A', { totalQty: 20, perCustomerLimit: 5 });
    const rule = await t.prisma.loyaltyRule.create({
      data: {
        name: `B4 full ${v.id.slice(0, 6)}`,
        eventType: 'VOUCHER_PURCHASE',
        kind: 'BASE',
        productScope: 'VOUCHER',
        campaignId: v.id,
        basePoints: 0,
        pointsPer100Halalas: 1,
        maxAllocationPoints: 100_000,
        status: 'ACTIVE',
        effectiveFrom: new Date(Date.now() - 3_600_000),
        createdByUserId: w.superAdmin.me.id as string,
      },
    });
    const c = await w.newCustomer();
    const b = await w.buy(c, v.id);
    const refund = await w.requestRefund(c, b.instanceId!);
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    const rows = await t.prisma.rewardEntry.findMany({
      where: { ruleId: rule.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.map((r) => [r.type, r.points])).toEqual([
      ['EARN', 80],
      ['REVERSE', -80],
    ]);
  });

  // ================================================================ B6: customer case replies
  describe('B6: customer case replies', () => {
    let caseId = '';
    let customer: Session;
    let other: Session;
    beforeAll(async () => {
      customer = await w.newCustomer();
      other = await w.newCustomer();
      const r = await post(w.ops, '/v1/admin/disputes', {
        type: 'REFUND_EXCEPTION',
        title: 'Refund not received',
        targetOrganizationId: w.A.orgId,
        customerUserId: customer.me.id,
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      caseId = r.body.data.id;
      await post(w.ops, `/v1/admin/disputes/${caseId}/notes`, {
        body: 'Internal: check PSP logs',
        visibility: 'INTERNAL',
      });
      await post(w.ops, `/v1/admin/disputes/${caseId}/transition`, {
        to: 'AWAITING_CUSTOMER',
        note: 'Please send the bank reference.',
      });
    });

    it('the customer sees DealDash messages (never internal notes), replies with an evidence reference, and the case returns to DealDash', async () => {
      const mine = await get(customer, `/v1/app/me/cases/${caseId}`);
      expect(mine.status, JSON.stringify(mine.body)).toBe(200);
      expect(mine.body.data).toMatchObject({ awaitingYou: true, canReply: true });
      expect(JSON.stringify(mine.body.data)).not.toContain('Internal: check PSP logs');
      // the question DealDash asked when it moved the case to the customer is visible to them
      expect(mine.body.data.messages).toEqual([
        expect.objectContaining({ fromYou: false, body: 'Please send the bank reference.' }),
      ]);
      const reply = await post(customer, `/v1/app/me/cases/${caseId}/replies`, {
        body: 'Bank reference attached',
        evidenceRef: 'BANK-REF-778',
      });
      expect(reply.status, JSON.stringify(reply.body)).toBe(201);
      expect(reply.body.data.messages.at(-1)).toMatchObject({
        fromYou: true,
        body: 'Bank reference attached',
        evidenceRef: 'BANK-REF-778',
      });
      const admin = await get(w.ops, `/v1/admin/disputes/${caseId}`);
      expect(admin.body.data.status).toBe('INVESTIGATING');
      expect(
        admin.body.data.notes.some(
          (n: { fromCustomer: boolean; evidenceRef: string }) =>
            n.fromCustomer && n.evidenceRef === 'BANK-REF-778',
        ),
      ).toBe(true);
      // the business never sees the customer's message
      const biz = await get(w.ownerA, `/v1/orgs/${w.A.orgId}/disputes/${caseId}`);
      expect(JSON.stringify(biz.body)).not.toContain('Bank reference attached');
      // audited (without the message text)
      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { entityId: caseId, action: 'CASE_CUSTOMER_REPLY' },
      });
      expect(JSON.stringify(audit.newState)).not.toContain('Bank reference attached');
      // the support timeline shows the in-app contact
      expect(
        await t.prisma.caseNote.count({
          where: {
            caseId,
            kind: 'CONTACT',
            channel: 'IN_APP',
            direction: 'INBOUND',
            authorKind: 'CUSTOMER',
          },
        }),
      ).toBe(1);
    });

    it('another customer cannot read or reply; card numbers are refused; a closed case takes no reply', async () => {
      expect((await get(other, `/v1/app/me/cases/${caseId}`)).status).toBe(404);
      expect(
        (await post(other, `/v1/app/me/cases/${caseId}/replies`, { body: 'Hello' })).status,
      ).toBe(404);
      const pan = await post(customer, `/v1/app/me/cases/${caseId}/replies`, {
        body: 'My card is 4111 1111 1111 1111',
      });
      expect(pan.body.errors[0].code).toBe('CARD_DATA_FORBIDDEN');
      // the person who raised a case never resolves it (frozen Phase 3 rule): another administrator closes it
      const closed = await post(w.superAdmin, `/v1/admin/disputes/${caseId}/resolve`, {
        outcome: 'CLOSED',
        resolution: 'Refund confirmed by the bank',
      });
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);
      const late = await post(customer, `/v1/app/me/cases/${caseId}/replies`, {
        body: 'One more thing',
      });
      expect(late.status).toBe(409);
    });
  });

  // ================================================================ B7: governed rules and controls
  describe('B7: governed rules and controls', () => {
    it('a change is validated, approved by a different person, versioned, and can be rolled back the same way', async () => {
      const ov = await get(w.superAdmin, '/v1/admin/controls');
      expect(ov.status, JSON.stringify(ov.body)).toBe(200);
      const scalar = ov.body.data.configs.find(
        (c: { key: string }) => c.key === 'reservation.max_active',
      );
      expect(scalar).toMatchObject({ kind: 'SCALAR', group: 'INVENTORY', min: 1, max: 20 });
      // out of range is refused by the server
      const bad = await post(w.superAdmin, '/v1/admin/controls/requests', {
        key: 'reservation.max_active',
        section: 'reservation.max_active',
        value: 99,
        baseVersion: scalar.version,
        reason: 'Too many',
      });
      expect(bad.status).toBe(400);
      // a raw / unknown setting cannot be edited from the controls screen
      expect(
        (
          await post(w.superAdmin, '/v1/admin/controls/requests', {
            key: 'auth.session.idle_minutes',
            section: 'x',
            value: 5,
            baseVersion: 0,
            reason: 'Not governed',
          })
        ).status,
      ).toBe(400);
      const req = await post(w.superAdmin, '/v1/admin/controls/requests', {
        key: 'reservation.max_active',
        section: 'reservation.max_active',
        value: 4,
        baseVersion: scalar.version,
        reason: 'Pilot capacity',
      });
      expect(req.status, JSON.stringify(req.body)).toBe(201);
      expect(req.body.data).toMatchObject({
        status: 'PENDING_APPROVAL',
        canDecide: false,
        canCancel: true,
      });
      // nothing changed yet; the requester cannot approve
      expect(
        (
          await post(w.superAdmin, `/v1/admin/controls/requests/${req.body.data.id}/decide`, {
            decision: 'APPROVE',
            reason: 'Self',
          })
        ).status,
      ).toBe(403);
      const ok = await post(super2, `/v1/admin/controls/requests/${req.body.data.id}/decide`, {
        decision: 'APPROVE',
        reason: 'Agreed for the pilot',
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.status).toBe('APPLIED');
      const row = await t.prisma.systemConfiguration.findUniqueOrThrow({
        where: { key: 'reservation.max_active' },
      });
      expect(row.value).toBe(4);
      // a request made against the old version is refused as stale
      const stale = await post(w.superAdmin, '/v1/admin/controls/requests', {
        key: 'reservation.max_active',
        section: 'reservation.max_active',
        value: 5,
        baseVersion: scalar.version,
        reason: 'Late',
      });
      expect(stale.body.errors[0].code).toBe('CONFIG_CHANGE_STALE');
      // history shows the version with its reason; rollback proposes the earlier value through the same approval
      const hist = await get(w.superAdmin, '/v1/admin/controls/reservation.max_active/history');
      expect(hist.body.data[0]).toMatchObject({ version: row.version, value: 4 });
      if (row.version > 1) {
        const rb = await post(super2, '/v1/admin/controls/reservation.max_active/rollback', {
          version: row.version - 1,
          reason: 'Back to the previous limit',
        });
        expect(rb.body.data, JSON.stringify(rb.body)).toMatchObject({
          status: 'PENDING_APPROVAL',
          restoresVersion: row.version - 1,
        });
      }
    });

    it('a structured operations change (a reason list) is checked against the schema; a scheduled change applies at its time', async () => {
      const ov = (await get(w.superAdmin, '/v1/admin/controls')).body.data;
      const ops = ov.configs.find((c: { key: string }) => c.key === 'operations');
      const value = JSON.parse(JSON.stringify(ops.value));
      value.reasons.refund.push({
        code: 'PILOT_GOODWILL',
        en: 'Pilot goodwill',
        ar: 'حسن نية للتجربة',
      });
      const broken = JSON.parse(JSON.stringify(ops.value));
      broken.sla.CASE.warnPct = 150;
      expect(
        (
          await post(w.superAdmin, '/v1/admin/controls/requests', {
            key: 'operations',
            section: 'sla.CASE',
            value: broken,
            baseVersion: ops.version,
            reason: 'Bad value',
          })
        ).status,
      ).toBe(400);
      const soon = new Date(Date.now() + 60_000).toISOString();
      const req = await post(w.superAdmin, '/v1/admin/controls/requests', {
        key: 'operations',
        section: 'reasons.refund',
        value,
        baseVersion: ops.version,
        reason: 'Pilot reason',
        effectiveFrom: soon,
      });
      expect(req.status, JSON.stringify(req.body)).toBe(201);
      const dec = await post(super2, `/v1/admin/controls/requests/${req.body.data.id}/decide`, {
        decision: 'APPROVE',
        reason: 'Approved for the pilot',
      });
      expect(dec.body.data?.status, JSON.stringify(dec.body)).toBe('SCHEDULED');
      const gov = t.app.get(ConfigGovernanceService);
      expect(await gov.applyDue(new Date())).toBe(0);
      expect(await gov.applyDue(new Date(Date.now() + 120_000))).toBe(1);
      const applied = await t.prisma.configChangeRequest.findUniqueOrThrow({
        where: { id: req.body.data.id },
      });
      expect(applied.status).toBe('APPLIED');
      const cfg = await t.prisma.systemConfiguration.findUniqueOrThrow({
        where: { key: 'operations' },
      });
      expect(JSON.stringify(cfg.value)).toContain('PILOT_GOODWILL');
    });

    it('ordinary operators cannot propose changes (configuration permission required)', async () => {
      expect(
        (
          await post(w.ops, '/v1/admin/controls/requests', {
            key: 'reservation.max_active',
            section: 'x',
            value: 3,
            baseVersion: 0,
            reason: 'No',
          })
        ).status,
      ).toBe(403);
    });
  });

  // ================================================================ launch controls
  describe('launch controls', () => {
    it('an emergency stop refuses NEW purchases in the market only; what a customer holds stays valid; lifting reopens', async () => {
      const v = await w.publishVoucher('A', { totalQty: 20, perCustomerLimit: 5 });
      const c = await w.newCustomer();
      const held = await w.owned(c, v.id);
      const stop = await post(w.ops, '/v1/admin/controls/launch/stops', {
        market: 'SA',
        action: 'NEW_PURCHASES',
        stopped: true,
        reason: 'PSP incident',
      });
      expect(stop.status, JSON.stringify(stop.body)).toBe(200);
      t.app.get(ConfigGovernanceService); // (cache is per process: the stop is set through the same config service)
      const co = await w.checkout(c, v.id);
      expect(co.status).toBe(409);
      expect(co.body.errors[0].code).toBe('LAUNCH_PAUSED');
      // the voucher already bought still redeems
      expect((await w.redeem(w.staffA, held.qr)).status).toBe(200);
      const audit = await t.prisma.auditLog.findFirst({
        where: { action: 'LAUNCH_STOP_PLACED' },
        orderBy: { occurredAt: 'desc' },
      });
      expect(audit?.reason).toBe('PSP incident');
      await post(w.ops, '/v1/admin/controls/launch/stops', {
        market: 'SA',
        action: 'NEW_PURCHASES',
        stopped: false,
        reason: 'PSP recovered',
      });
      expect((await w.checkout(c, v.id)).status).toBe(201);
    });

    it('a stop needs the launch-control permission and a reason', async () => {
      expect(
        (
          await post(w.finance, '/v1/admin/controls/launch/stops', {
            market: 'SA',
            action: 'NEW_PURCHASES',
            stopped: true,
            reason: 'No permission',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post(w.ops, '/v1/admin/controls/launch/stops', {
            market: 'SA',
            action: 'NEW_PURCHASES',
            stopped: true,
            reason: '',
          })
        ).status,
      ).toBe(400);
    });

    it('pilot allow-list: only listed businesses take new customers (set through the governed editor)', async () => {
      const ov = (await get(w.superAdmin, '/v1/admin/controls')).body.data;
      const lc = ov.configs.find((c: { key: string }) => c.key === 'launch.controls');
      const value = {
        ...lc.value,
        pilot: {
          mode: 'ALLOWLIST',
          merchantOrganizationIds: [w.B.orgId],
          partnerOrganizationIds: [],
        },
      };
      const req = await post(w.superAdmin, '/v1/admin/controls/requests', {
        key: 'launch.controls',
        section: 'pilot',
        value,
        baseVersion: lc.version,
        reason: 'Pilot with merchant B only',
      });
      await post(super2, `/v1/admin/controls/requests/${req.body.data.id}/decide`, {
        decision: 'APPROVE',
        reason: 'Pilot scope agreed',
      });
      const v = await t.prisma.voucher.findFirstOrThrow({
        where: { organizationId: w.A.orgId, status: 'ON_SALE' },
      });
      const c = await w.newCustomer();
      const co = await w.checkout(c, v.id);
      expect(co.body.errors?.[0]?.code).toBe('PILOT_NOT_ENABLED');
      // back to open for the rest of the suite
      const now = (await get(w.superAdmin, '/v1/admin/controls')).body.data.configs.find(
        (x: { key: string }) => x.key === 'launch.controls',
      );
      const back = await post(w.superAdmin, '/v1/admin/controls/requests', {
        key: 'launch.controls',
        section: 'pilot',
        value: {
          ...now.value,
          pilot: { mode: 'OPEN', merchantOrganizationIds: [], partnerOrganizationIds: [] },
        },
        baseVersion: now.version,
        reason: 'Pilot test over',
      });
      await post(super2, `/v1/admin/controls/requests/${back.body.data.id}/decide`, {
        decision: 'APPROVE',
        reason: 'Reopen',
      });
      expect((await w.checkout(c, v.id)).status).toBe(201);
    });
  });

  // ================================================================ B1 / B2: settlement rule controls and payout instructions
  describe('B1 / B2: settlement', () => {
    let settlementId = '';
    it('B1: the cut-off is computed in the market time zone', () => {
      // 23:00 in Riyadh (UTC+3) = 20:00 UTC
      expect(
        latestCutoff(new Date('2026-10-10T21:00:00Z'), '23:00', 'Asia/Riyadh').toISOString(),
      ).toBe('2026-10-10T20:00:00.000Z');
      // before today's cut-off: yesterday's
      expect(
        latestCutoff(new Date('2026-10-10T19:00:00Z'), '23:00', 'Asia/Riyadh').toISOString(),
      ).toBe('2026-10-09T20:00:00.000Z');
    });

    it('B1: a rolling reserve is withheld and released with a later statement; B2: the payout goes through the provider with a signed callback', async () => {
      await t.prisma.settlementRule.create({
        data: {
          market: 'SA',
          product: 'VOUCHER',
          code: 'S9_RESERVE',
          currency: 'SAR',
          frequency: 'WEEKLY',
          cycleDays: 7,
          minimumMinor: 0,
          holdDays: 0,
          reserveBps: 1000,
          reserveReleaseDays: 0,
          failedRetryMaxAttempts: 1,
          effectiveFrom: new Date(Date.now() - 86_400_000),
          status: 'APPROVED',
          createdByUserId: w.superAdmin.me.id,
        } as never,
      });
      const v = await w.publishVoucher('A');
      const c = await w.newCustomer();
      const o = await w.owned(c, v.id);
      expect((await w.redeem(w.staffA, o.qr)).status).toBe(200);
      const run = await post(w.finance, '/v1/admin/ops/settlements/run', {
        market: 'SA',
        organizationId: w.A.orgId,
      });
      expect(run.status, JSON.stringify(run.body)).toBe(200);
      settlementId = run.body.data.results[0].settlementId;
      const s = (await get(w.finance, `/v1/admin/ops/settlements/${settlementId}`)).body.data;
      expect(s.reserveMinor).toBeGreaterThan(0);
      expect(s.reserveMinor).toBe(Math.floor(((s.payableMinor + s.reserveMinor) * 1000) / 10_000));
      expect(s.payoutProvider).toBe('mock');
      // the preparer cannot send the payout; a different finance approver can
      expect(
        (await post(w.finance, `/v1/admin/controls/settlements/${settlementId}/instruct-payout`))
          .status,
      ).toBe(403);
      const ins = await post(
        w.finance2,
        `/v1/admin/controls/settlements/${settlementId}/instruct-payout`,
      );
      expect(ins.status, JSON.stringify(ins.body)).toBe(200);
      expect(ins.body.data.status).toBe('PAYOUT_PENDING');
      const providerRef = ins.body.data.payouts.find(
        (p: { status: string }) => p.status === 'INSTRUCTED',
      ).externalRef as string;
      // an unsigned or tampered callback is refused
      const body = JSON.stringify({ providerRef, status: 'PAID', bankRef: 'BANK-777' });
      expect(
        (
          await t.http
            .post('/v1/webhooks/payouts')
            .set('Content-Type', 'application/json')
            .set('x-dealdash-signature', 't=1,v1=00')
            .send(body)
        ).status,
      ).toBe(401);
      const stale = signCallback(PAYOUT_SECRET, body, Math.floor(Date.now() / 1000) - 3600);
      expect(
        (
          await t.http
            .post('/v1/webhooks/payouts')
            .set('Content-Type', 'application/json')
            .set('x-dealdash-signature', stale)
            .send(body)
        ).status,
      ).toBe(401);
      const ok = await t.http
        .post('/v1/webhooks/payouts')
        .set('Content-Type', 'application/json')
        .set('x-dealdash-signature', signCallback(PAYOUT_SECRET, body))
        .send(body);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.applied).toBe(true);
      // a duplicate callback changes nothing
      const dup = await t.http
        .post('/v1/webhooks/payouts')
        .set('Content-Type', 'application/json')
        .set('x-dealdash-signature', signCallback(PAYOUT_SECRET, body))
        .send(body);
      expect(dup.body.data.applied).toBe(false);
      const done = (await get(w.finance, `/v1/admin/ops/settlements/${settlementId}`)).body.data;
      expect(done).toMatchObject({ status: 'COMPLETED', outstandingMinor: 0 });
      expect(
        await t.prisma.ledgerJournal.count({
          where: { sourceId: settlementId, type: 'SETTLEMENT_PAYOUT' },
        }),
      ).toBe(1);
      // the next statement releases the reserve (release after 0 days)
      const c2 = await w.newCustomer();
      const o2 = await w.owned(c2, v.id);
      expect((await w.redeem(w.staffA, o2.qr)).status).toBe(200);
      const run2 = await post(w.finance, '/v1/admin/ops/settlements/run', {
        market: 'SA',
        organizationId: w.A.orgId,
      });
      const s2 = (
        await get(w.finance, `/v1/admin/ops/settlements/${run2.body.data.results[0].settlementId}`)
      ).body.data;
      expect(s2.reserveReleasedMinor).toBe(s.reserveMinor);
      expect(
        (await t.prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } }))
          .reserveReleasedIntoId,
      ).toBe(s2.id);
    });

    it('B2: a failed payout can be retried up to the rule limit, then needs a case; manual recording is unchanged', async () => {
      const v = await w.publishVoucher('A');
      const c = await w.newCustomer();
      const o = await w.owned(c, v.id);
      expect((await w.redeem(w.staffA, o.qr)).status).toBe(200);
      const run = await post(w.finance, '/v1/admin/ops/settlements/run', {
        market: 'SA',
        organizationId: w.A.orgId,
      });
      const id = run.body.data.results[0].settlementId as string;
      const mock = t.app.get(PAYOUT_PROVIDER) as MockPayoutProvider;
      mock.failNext = 2;
      const first = await post(w.finance2, `/v1/admin/controls/settlements/${id}/instruct-payout`);
      expect(first.body.data.status).toBe('FAILED');
      const second = await post(w.finance2, `/v1/admin/controls/settlements/${id}/instruct-payout`);
      expect(second.body.data.status).toBe('FAILED');
      const third = await post(w.finance2, `/v1/admin/controls/settlements/${id}/instruct-payout`);
      expect(third.status).toBe(409);
    });
  });

  // ================================================================ B3: delivery receipts and throttling
  it('B3: a signed delivery receipt marks a push DELIVERED or FAILED; unsigned receipts are refused; throttled sends are suppressed', async () => {
    const c = await w.newCustomer();
    const svc = t.app.get(NotificationsService);
    const n = await t.prisma.notification.create({
      data: { userId: c.me.id, type: 'CASE_UPDATED', dedupeKey: `s9-${randomUUID()}`, data: {} },
    });
    await svc.deliverTracked({ id: n.id, userId: c.me.id, type: 'CASE_UPDATED', data: {} });
    const push = await t.prisma.notificationDelivery.findFirstOrThrow({
      where: { notificationId: n.id, channel: 'PUSH' },
    });
    expect(push.providerMessageId).toBeTruthy();
    const body = JSON.stringify({
      providerMessageId: push.providerMessageId,
      status: 'FAILED',
      reason: 'DEVICE_UNREGISTERED',
    });
    expect(
      (
        await t.http
          .post('/v1/webhooks/notifications')
          .set('Content-Type', 'application/json')
          .send(body)
      ).status,
    ).toBe(401);
    // a mock push is DELIVERED at once; a later receipt for a final delivery changes nothing
    const r = await t.http
      .post('/v1/webhooks/notifications')
      .set('Content-Type', 'application/json')
      .set('x-dealdash-signature', signCallback(NOTIFY_SECRET, body))
      .send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.applied).toBe(push.status === 'SENT');
    // throttle: past the hourly limit per person and channel the next push is suppressed
    await t.prisma.notificationDelivery.updateMany({
      where: { userId: c.me.id },
      data: { lastAttemptAt: new Date() },
    });
    for (let i = 0; i < 20; i++)
      await t.prisma.notificationDelivery.create({
        data: {
          userId: c.me.id,
          channel: 'PUSH',
          provider: 'mock-push',
          templateCode: 'x',
          status: 'DELIVERED',
          lastAttemptAt: new Date(),
          dedupeKey: `s9-thr-${randomUUID()}`,
        },
      });
    const n2 = await t.prisma.notification.create({
      data: { userId: c.me.id, type: 'CASE_UPDATED', dedupeKey: `s9-${randomUUID()}`, data: {} },
    });
    await svc.deliverTracked({ id: n2.id, userId: c.me.id, type: 'CASE_UPDATED', data: {} });
    expect(
      (
        await t.prisma.notificationDelivery.findFirstOrThrow({
          where: { notificationId: n2.id, channel: 'PUSH' },
        })
      ).suppressedReason,
    ).toBe('THROTTLED');
    // in-app is never throttled
    expect(
      (
        await t.prisma.notificationDelivery.findFirstOrThrow({
          where: { notificationId: n2.id, channel: 'IN_APP' },
        })
      ).status,
    ).toBe('DELIVERED');
  });

  // ================================================================ privacy: legal holds
  it('a legal hold blocks deletion until a different person lifts it', async () => {
    const c = await w.newCustomer();
    const hold = await post(w.superAdmin, '/v1/admin/controls/legal-holds', {
      subjectType: 'USER',
      subjectId: c.me.id,
      reason: 'Regulator inquiry (test)',
    });
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    const dr = await post(c, '/v1/app/me/data-requests', { type: 'DELETION' });
    expect(dr.status, JSON.stringify(dr.body)).toBe(201);
    const decide = await post(super2, `/v1/admin/ops/data-requests/${dr.body.data.id}/decide`, {
      decision: 'APPROVE',
      reason: 'Customer asked',
    });
    expect(JSON.stringify(decide.body)).toContain('LEGAL_HOLD');
    expect(
      (
        await post(w.superAdmin, `/v1/admin/controls/legal-holds/${hold.body.data.id}/lift`, {
          reason: 'Closed',
        })
      ).status,
    ).toBe(403);
    const lift = await post(super2, `/v1/admin/controls/legal-holds/${hold.body.data.id}/lift`, {
      reason: 'Inquiry closed',
    });
    expect(lift.body.data.active).toBe(false);
  });

  // ================================================================ health, headers
  it('health: liveness and readiness probes; security headers on every response', async () => {
    const live = await t.http.get('/v1/health/live');
    expect(live.status).toBe(200);
    const ready = await t.http.get('/v1/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.data).toMatchObject({
      status: 'ready',
      database: { connected: true, migrationsCurrent: true },
    });
    expect(JSON.stringify(ready.body)).not.toMatch(/postgres(ql)?:\/\//);
    expect(live.headers['x-frame-options']).toBe('DENY');
    expect(live.headers['x-content-type-options']).toBe('nosniff');
    expect(live.headers['referrer-policy']).toBe('no-referrer');
    expect(live.headers['x-powered-by']).toBeUndefined();
  });
});

/** Rate limiting and production hardening run on their own app instance (the limits are off in the shared test environment). */
describe.skipIf(!DB_READY)('Stage 9 rate limiting', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ RATE_LIMIT_PER_MINUTE: 30, AUTH_RATE_LIMIT_PER_MINUTE: 3 });
  });
  afterAll(() => t?.close());

  it('sign-in attempts are limited per client per minute; health is never limited', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push(
        (
          await t.http
            .post('/v1/auth/login')
            .send({ email: 'nobody@example.test', password: 'wrong-password-1', audience: 'admin' })
        ).status,
      );
    expect(codes.slice(0, 3).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(3).every((c) => c === 429)).toBe(true);
    const limited = await t.http.post('/v1/auth/login').send({});
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body.errors[0].code).toBe('RATE_LIMITED');
    for (let i = 0; i < 40; i++) expect((await t.http.get('/v1/health/live')).status).toBe(200);
  });
});
