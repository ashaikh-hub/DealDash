import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, idem, type Session, type TestApp } from './helpers';
import { subscriptionWorld, type SubWorld } from './subscription-fixtures';
import { EntitlementService } from '../src/platform/entitlement.service';
import { SubscriptionService } from '../src/subscription/subscription.service';
import { AmendmentService } from '../src/subscription/amendment.service';

const day = 864e5;

/**
 * Standard merchant plans end to end: Starter, Growth, Business, Enterprise; branch and user limits; upgrade; downgrade with excess
 * usage; add-ons; overrides; trial; renewal; cancellation. Everything is enforced by the backend and nothing is ever deleted.
 */
describe.skipIf(!DB_READY)('Subscription engine: merchant plans, limits and changes', () => {
  let t: TestApp;
  let s: SubWorld;

  beforeAll(async () => {
    t = await createTestApp();
    s = await subscriptionWorld(t);
  });
  afterAll(() => t?.close());

  const base = (orgId: string) => `/v1/orgs/${orgId}/subscription`;
  const addBranch = (owner: Session, orgId: string, n: number) =>
    s
      .api(owner)
      .post(`/v1/merchants/${orgId}/branches`)
      .set('Idempotency-Key', idem())
      .send({
        nameEn: `Extra ${n}`,
        nameAr: `إضافي ${n}`,
        addressEn: 'Karachi',
        addressAr: 'كراتشي',
        city: 'Riyadh',
        latitude: 24.7 + n / 100,
        longitude: 46.7 + n / 100,
      });
  const invite = (owner: Session, orgId: string, email: string) =>
    s
      .api(owner)
      .post(`/v1/merchants/${orgId}/team/invitations`)
      .set('Idempotency-Key', idem())
      .send({ name: 'Invited Person', email, roleCode: 'MERCHANT_FINANCE' });
  const summary = async (orgId: string) =>
    (await s.get(s.admin, `${s.AS}/organizations/${orgId}`)).body.data;
  const limitOf = async (orgId: string, key: string) =>
    (await summary(orgId)).limits.find((l: { key: string }) => l.key === key);
  const runDue = (at: Date) => t.app.get(SubscriptionService).runDue(at);
  const applyDue = (at: Date) => t.app.get(AmendmentService).applyDue(at);
  const events = async (contractId: string, type?: string) =>
    (
      await s.get(
        s.admin,
        `${s.AS}/billing-events?contractId=${contractId}${type ? `&eventType=${type}` : ''}`,
      )
    ).body.data as Array<Record<string, unknown>>;
  const signals = async (orgId: string) =>
    (
      (await s.get(s.admin, `${s.AS}/signals?organizationId=${orgId}`)).body.data as Array<{
        type: string;
      }>
    ).map((x) => x.type);

  describe('Starter is a genuine free plan', () => {
    it('is active at once with no acceptance and no charge; branch and user limits are enforced by the backend', async () => {
      const m = await s.mkMerchant('starter', 1);
      const c = await s.assign(m.orgId, 'STARTER', null);
      expect(c.status).toBe('ACTIVE');
      expect(c).toMatchObject({
        kind: 'MERCHANT_SUBSCRIPTION',
        billingCadence: 'NONE',
        currency: 'PKR',
        planCode: 'STARTER',
      });
      expect(await events(c.id as string)).toEqual([]); // free: nothing to bill
      const sum = await summary(m.orgId);
      expect(sum).toMatchObject({ source: 'CONTRACT', lifecycle: 'ACTIVE' });
      expect(sum.price).toMatchObject({ amountMinor: 0, currency: 'PKR', indicative: false });
      expect(
        sum.usage.find((u: { limitKey: string }) => u.limitKey === 'branches.max'),
      ).toMatchObject({ used: 1, limit: 1, remaining: 0, percent: 100 });
      // branch 2 is refused
      const b = await addBranch(m.owner, m.orgId, 2);
      expect(b.status).toBe(403);
      expect(b.body.errors[0].code).toBe('ENTITLEMENT_LIMIT_REACHED');
      // users: the owner is one; one invitation fits, the next does not (pending invitations count)
      expect([200, 201]).toContain(
        (await invite(m.owner, m.orgId, `starter-a-${idem()}@test.dd`)).status,
      );
      const u2 = await invite(m.owner, m.orgId, `starter-b-${idem()}@test.dd`);
      expect(u2.status).toBe(403);
      expect(u2.body.errors[0].code).toBe('ENTITLEMENT_LIMIT_REACHED');
      // nothing was deleted or changed
      expect(await t.prisma.merchantBranch.count({ where: { organizationId: m.orgId } })).toBe(1);
    });

    it('may still BUY separately priced products: the product entitlement is there, the price is a campaign matter', async () => {
      const m = await s.mkMerchant('starter-buy', 1);
      await s.assign(m.orgId, 'STARTER', null);
      const e = await t.app.get(EntitlementService).effective(m.orgId);
      expect(e.products).toEqual(
        expect.arrayContaining(['EXCLUSIVE', 'WATCH', 'FEATURED_PLACEMENT', 'VOUCHER']),
      );
      expect(e.features).toEqual([]);
    });
  });

  describe('Growth: a paid plan needs the authorised person’s acceptance', () => {
    let m: Awaited<ReturnType<SubWorld['mkMerchant']>>;
    let contractId: string;

    it('is pending until accepted; the pending plan grants nothing and charges nothing', async () => {
      m = await s.mkMerchant('growth', 3);
      const a = await s.post(s.admin, `${s.AS}/contracts/assign`, {
        organizationId: m.orgId,
        planCode: 'GROWTH',
        market: 'PK',
      });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      contractId = a.body.data.id;
      expect(a.body.data).toMatchObject({
        status: 'PENDING_ACTIVATION',
        billingCadence: 'MONTHLY',
        renewalState: 'AUTO_RENEW',
      });
      expect(await events(contractId)).toEqual([]);
      const pending = (await s.get(m.owner, `${base(m.orgId)}/pending`)).body.data;
      expect(pending.terms).toMatchObject({
        currency: 'PKR',
        basePrice: { amountMinor: 499_900, cadence: 'MONTHLY', indicative: false },
        maxExposureMinor: 499_900,
      });
      expect(pending.terms.plan.code).toBe('GROWTH');
    });

    it('only an authorised person accepts: Finance, a campaign manager and another business cannot', async () => {
      const fin = await m.mk('MERCHANT_FINANCE');
      const mgr = await m.mk('MERCHANT_CAMPAIGN_MANAGER');
      expect(
        (await s.post(fin, `${base(m.orgId)}/accept`, { language: 'en', confirm: true })).status,
      ).toBe(403);
      expect(
        (await s.post(mgr, `${base(m.orgId)}/accept`, { language: 'en', confirm: true })).status,
      ).toBe(403);
      const other = await s.mkMerchant('growth-other', 1);
      expect(
        (await s.post(other.owner, `${base(m.orgId)}/accept`, { language: 'en', confirm: true }))
          .status,
      ).toBe(404);
      expect((await s.post(m.owner, `${base(m.orgId)}/accept`, { language: 'en' })).status).toBe(
        400,
      ); // the explicit confirmation is required
    });

    it('acceptance activates it, stores an immutable acceptance record and emits the first billing event once', async () => {
      const acc = await s.post(m.owner, `${base(m.orgId)}/accept`, {
        language: 'ar',
        confirm: true,
      });
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      expect(acc.body.data.contract.status).toBe('ACTIVE');
      expect(
        (await s.post(m.owner, `${base(m.orgId)}/accept`, { language: 'en', confirm: true }))
          .status,
      ).toBe(409);
      const rows = (await s.get(s.admin, `${s.AS}/contracts/${contractId}/acceptances`)).body.data;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userRole: 'MERCHANT_OWNER',
        currency: 'PKR',
        acceptedAmountMinor: 499_900,
        maxExposureMinor: 499_900,
        billingCadence: 'MONTHLY',
        onBehalf: false,
      });
      expect(rows[0].pricingVersionKey).toMatch(/^PLV:/);
      expect(rows[0].terms.plan.code).toBe('GROWTH');
      // evidence is immutable
      await expect(
        t.prisma.contractAcceptance.update({
          where: { id: rows[0].id },
          data: { acceptedAmountMinor: 1 },
        }),
      ).rejects.toThrow();
      await expect(
        t.prisma.contractAcceptance.delete({ where: { id: rows[0].id } }),
      ).rejects.toThrow();
      const ev = await events(contractId);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({
        eventType: 'MONTHLY_SUBSCRIPTION_RENEWAL',
        billingCategory: 'SUBSCRIPTION_LICENCE',
        amountMinor: 499_900,
        currency: 'PKR',
        status: 'PENDING',
        quantity: 1,
      });
      expect(ev[0]!.pricingVersionKey).toMatch(/^PLV:/);
      expect(ev[0]!.billingLegalEntityId ?? null).toBeNull(); // no legal entity yet: never a brand or branch
    });

    it('then the limits are the plan’s: 5 branches, 10 users; Phase 4 gets the 80 % and reached signals', async () => {
      expect(await limitOf(m.orgId, 'branches.max')).toMatchObject({
        value: 5,
        mode: 'HARD',
        source: 'PLAN',
      });
      expect((await addBranch(m.owner, m.orgId, 4)).status).toBe(201); // 4 of 5
      expect(await signals(m.orgId)).toContain('BRANCH_LIMIT_80_PERCENT');
      expect((await addBranch(m.owner, m.orgId, 5)).status).toBe(201); // 5 of 5
      expect(await signals(m.orgId)).toContain('BRANCH_LIMIT_REACHED');
      const six = await addBranch(m.owner, m.orgId, 6);
      expect(six.status).toBe(403);
      expect(six.body.errors[0].code).toBe('ENTITLEMENT_LIMIT_REACHED');
      // each signal is raised once per threshold, not once per attempt
      const types = await signals(m.orgId);
      expect(types.filter((x) => x === 'BRANCH_LIMIT_REACHED')).toHaveLength(1);
    });
  });

  describe('Upgrade: preview, acceptance, a new effective version', () => {
    let m: Awaited<ReturnType<SubWorld['mkMerchant']>>;
    let contractId: string;
    let amendmentId: string;

    beforeAll(async () => {
      m = await s.mkMerchant('upgrade', 1);
      contractId = (await s.assign(m.orgId, 'STARTER', null)).id as string;
    });

    it('shows the difference, the price, the effective date and the commercial impact before anything is accepted', async () => {
      const p = await s.post(m.owner, `${base(m.orgId)}/preview`, {
        type: 'UPGRADE',
        targetPlanCode: 'GROWTH',
      });
      expect(p.status, JSON.stringify(p.body)).toBe(200);
      const i = p.body.data;
      expect(i).toMatchObject({
        type: 'UPGRADE',
        currency: 'PKR',
        effectiveMode: 'IMMEDIATE',
        needsAcceptance: true,
        blocked: false,
        priceDeltaMinor: 499_900,
      });
      expect(i.from.planCode).toBe('STARTER');
      expect(i.to).toMatchObject({ planCode: 'GROWTH', amountMinor: 499_900, cadence: 'MONTHLY' });
      expect(i.added.products).toEqual(expect.arrayContaining(['LOYALTY']));
      expect(i.added.features).toEqual(
        expect.arrayContaining(['BULK_IMPORT', 'ADVANCED_REPORTING']),
      );
      expect(i.limitChanges).toEqual(
        expect.arrayContaining([
          { key: 'branches.max', from: 1, to: 5 },
          { key: 'users.max', from: 2, to: 10 },
        ]),
      );
      // a preview saves nothing
      expect((await s.get(m.owner, `${base(m.orgId)}/amendments`)).body.data).toEqual([]);
    });

    it('the plans a business can move to are the published ones for its market and kind', async () => {
      const plans = (await s.get(m.owner, `${base(m.orgId)}/plans`)).body.data as Array<{
        code: string;
        current: boolean;
      }>;
      expect(plans.map((p) => p.code)).toEqual(
        expect.arrayContaining(['STARTER', 'GROWTH', 'BUSINESS', 'MERCHANT_ENTERPRISE']),
      );
      expect(plans.find((p) => p.current)!.code).toBe('STARTER');
      expect(plans.map((p) => p.code)).not.toContain('BANK_ENTERPRISE');
    });

    it('only an authorised member can request it; a Finance user and another business cannot', async () => {
      const fin = await m.mk('MERCHANT_FINANCE');
      expect(
        (
          await s.post(fin, `${base(m.orgId)}/amendments`, {
            type: 'UPGRADE',
            targetPlanCode: 'GROWTH',
          })
        ).status,
      ).toBe(403);
      const other = await s.mkMerchant('upgrade-other', 1);
      expect(
        (
          await s.post(other.owner, `${base(m.orgId)}/amendments`, {
            type: 'UPGRADE',
            targetPlanCode: 'GROWTH',
          })
        ).status,
      ).toBe(404);
      // an administrative change is never self-service
      expect(
        (
          await s.post(m.owner, `${base(m.orgId)}/amendments`, {
            type: 'ENTITLEMENT',
            reason: 'free branches please',
            entitlements: [{ kind: 'LIMIT', key: 'branches.max', value: 999 }],
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await s.post(m.owner, `${base(m.orgId)}/amendments`, {
            type: 'UPGRADE',
            targetPlanCode: 'GROWTH',
            forced: true,
            reason: 'forcing it',
          })
        ).status,
      ).toBe(403);
    });

    it('requesting saves a PROPOSED change that grants nothing yet; accepting applies it as version 2', async () => {
      const r = await s.post(m.owner, `${base(m.orgId)}/amendments`, {
        type: 'UPGRADE',
        targetPlanCode: 'GROWTH',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      amendmentId = r.body.data.id;
      expect(r.body.data).toMatchObject({ status: 'PROPOSED', type: 'UPGRADE', fromVersion: 1 });
      expect((await limitOf(m.orgId, 'branches.max')).value).toBe(1);
      const acc = await s.post(m.owner, `${base(m.orgId)}/amendments/${amendmentId}/accept`, {
        language: 'en',
        confirm: true,
      });
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      expect(acc.body.data).toMatchObject({ status: 'APPLIED', type: 'UPGRADE' });
      expect(acc.body.data.fromSnapshot.planCode).toBe('STARTER');
      expect(acc.body.data.toSnapshot.planCode).toBe('GROWTH');
      expect(acc.body.data.acceptanceId).toBeTruthy();
      const c = (await s.get(s.admin, `${s.AS}/contracts/${contractId}`)).body.data;
      expect(c).toMatchObject({
        planCode: 'GROWTH',
        version: 2,
        billingCadence: 'MONTHLY',
        status: 'ACTIVE',
      });
      expect(await limitOf(m.orgId, 'branches.max')).toMatchObject({ value: 5 });
      expect(await limitOf(m.orgId, 'users.max')).toMatchObject({ value: 10 });
    });

    it('keeps the previous version (end-dated rows, a snapshot, the acceptance) and emits the billing hook', async () => {
      const rows = await t.prisma.contractEntitlement.findMany({
        where: { contractId, key: 'branches.max' },
      });
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.effectiveUntil !== null)).toHaveLength(1);
      const accs = (await s.get(s.admin, `${s.AS}/contracts/${contractId}/acceptances`)).body.data;
      expect(accs).toHaveLength(1);
      expect(accs[0].amendmentId).toBe(amendmentId);
      const ev = await events(contractId);
      expect(ev.map((e) => e.eventType)).toEqual(['MONTHLY_SUBSCRIPTION_RENEWAL']); // leaving a free plan starts the first period
      expect(ev[0]!.amountMinor).toBe(499_900);
      // the plan history is visible to the business
      const sum = (await s.get(m.owner, base(m.orgId))).body.data;
      expect(sum.amendments[0]).toMatchObject({ type: 'UPGRADE', status: 'APPLIED' });
    });

    it('cannot upgrade to the plan already held', async () => {
      const again = await s.post(m.owner, `${base(m.orgId)}/preview`, {
        type: 'UPGRADE',
        targetPlanCode: 'GROWTH',
      });
      expect(again.status).toBe(409);
    });
  });

  describe('Downgrade: blocked while usage exceeds the new limits; nothing is deleted', () => {
    let m: Awaited<ReturnType<SubWorld['mkMerchant']>>;
    let contractId: string;
    let branchIds: string[];

    beforeAll(async () => {
      m = await s.mkMerchant('downgrade', 8);
      branchIds = m.branchIds;
      contractId = (await s.assign(m.orgId, 'BUSINESS', m.owner)).id as string;
    });

    it('evaluates current usage against the new plan: Business with 8 branches cannot move to Growth (5) as things stand', async () => {
      const p = (
        await s.post(m.owner, `${base(m.orgId)}/preview`, {
          type: 'DOWNGRADE',
          targetPlanCode: 'GROWTH',
        })
      ).body.data;
      expect(p.blocked).toBe(true);
      expect(p.excess).toEqual([{ key: 'branches.max', newLimit: 5, current: 8, excess: 3 }]);
      expect(p.remediation).toEqual(
        expect.arrayContaining([
          'DEACTIVATE_EXCESS',
          'SCHEDULE_FOR_LATER',
          'BUY_ADD_ON',
          'CANCEL_DOWNGRADE',
        ]),
      );
      expect(p.removed.products).toEqual(
        expect.arrayContaining(['PUSH_CAMPAIGNS', 'HOMEPAGE_PLACEMENT']),
      );
      expect(p.priceDeltaMinor).toBe(499_900 - 1_499_900);
    });

    it('accepting is refused (DOWNGRADE_BLOCKED) and every branch, user and record is untouched', async () => {
      const r = await s.post(m.owner, `${base(m.orgId)}/amendments`, {
        type: 'DOWNGRADE',
        targetPlanCode: 'GROWTH',
      });
      expect(r.status).toBe(201);
      const acc = await s.post(m.owner, `${base(m.orgId)}/amendments/${r.body.data.id}/accept`, {
        language: 'en',
        confirm: true,
      });
      expect(acc.status).toBe(409);
      expect(acc.body.errors[0].code).toBe('DOWNGRADE_BLOCKED');
      expect(
        await t.prisma.merchantBranch.count({
          where: { organizationId: m.orgId, status: 'ACTIVE' },
        }),
      ).toBe(8);
      expect((await limitOf(m.orgId, 'branches.max')).value).toBe(25);
    });

    it('after the organization deactivates the excess it goes through; branches stay as history, only the limit changes', async () => {
      for (const id of branchIds.slice(0, 3)) {
        const c = await s.post(
          m.owner,
          `/v1/merchants/${m.orgId}/branches/${id}/status`,
          { status: 'CLOSED', reason: 'Reducing to the Growth plan' },
          true,
        );
        expect(c.status, JSON.stringify(c.body)).toBe(200);
      }
      const pending = (await s.get(m.owner, `${base(m.orgId)}/amendments`)).body.data.find(
        (a: { status: string }) => a.status === 'PROPOSED',
      );
      const acc = await s.post(m.owner, `${base(m.orgId)}/amendments/${pending.id}/accept`, {
        language: 'en',
        confirm: true,
      });
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      expect(acc.body.data.status).toBe('APPLIED');
      expect(await limitOf(m.orgId, 'branches.max')).toMatchObject({ value: 5 });
      expect(await t.prisma.merchantBranch.count({ where: { organizationId: m.orgId } })).toBe(8);
      const c = (await s.get(s.admin, `${s.AS}/contracts/${contractId}`)).body.data;
      expect(c).toMatchObject({ planCode: 'GROWTH', version: 2 });
      // the price difference is handed to Finance for proration (Phase 5), not computed here
      const ev = await events(contractId, 'PLAN_CHANGE_ADJUSTMENT');
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({
        amountMinor: 1_000_000,
        billingCategory: 'SUBSCRIPTION_LICENCE',
      });
      expect(ev[0]!.metadata).toMatchObject({ direction: 'DOWNGRADE', prorationByPhase5: true });
    });

    it('a downgrade scheduled for the next billing cycle is accepted even with excess, and waits until the excess is resolved', async () => {
      const m2 = await s.mkMerchant('downgrade-later', 7);
      const c2 = await s.assign(m2.orgId, 'BUSINESS', m2.owner);
      const r = await s.post(m2.owner, `${base(m2.orgId)}/amendments`, {
        type: 'DOWNGRADE',
        targetPlanCode: 'GROWTH',
        effectiveMode: 'NEXT_BILLING_CYCLE',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data.impact.blocked).toBe(false);
      const acc = await s.post(m2.owner, `${base(m2.orgId)}/amendments/${r.body.data.id}/accept`, {
        language: 'en',
        confirm: true,
      });
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      expect(acc.body.data.status).toBe('ACCEPTED'); // waits for its date
      expect((await limitOf(m2.orgId, 'branches.max')).value).toBe(25);
      const due = new Date(Date.now() + 40 * day);
      expect(await applyDue(due)).toMatchObject({ blocked: expect.any(Number) });
      expect((await s.get(s.admin, `${s.AS}/contracts/${c2.id}`)).body.data.planCode).toBe(
        'BUSINESS',
      ); // still blocked by the excess
      for (const id of m2.branchIds.slice(0, 2))
        await s.post(m2.owner, `/v1/merchants/${m2.orgId}/branches/${id}/status`, {
          status: 'CLOSED',
          reason: 'Reducing before the change date',
        });
      expect((await applyDue(due)).applied).toBeGreaterThanOrEqual(1);
      expect((await s.get(s.admin, `${s.AS}/contracts/${c2.id}`)).body.data.planCode).toBe(
        'GROWTH',
      );
    });

    it('a change can be cancelled by the business before it is applied', async () => {
      const m3 = await s.mkMerchant('downgrade-cancel', 2);
      await s.assign(m3.orgId, 'BUSINESS', m3.owner);
      const r = await s.post(m3.owner, `${base(m3.orgId)}/amendments`, {
        type: 'DOWNGRADE',
        targetPlanCode: 'GROWTH',
      });
      const c = await s.post(m3.owner, `${base(m3.orgId)}/amendments/${r.body.data.id}/cancel`, {
        reason: 'Changed my mind',
      });
      expect(c.status).toBe(200);
      expect(c.body.data.status).toBe('CANCELLED');
      expect(
        (
          await s.post(m3.owner, `${base(m3.orgId)}/amendments/${r.body.data.id}/accept`, {
            language: 'en',
            confirm: true,
          })
        ).status,
      ).toBe(409);
    });

    it('a FORCED downgrade by DealDash needs a reason, is audited, and restricts the excess instead of deleting it', async () => {
      const m4 = await s.mkMerchant('downgrade-forced', 8);
      const c4 = await s.assign(m4.orgId, 'BUSINESS', m4.owner);
      expect(
        (
          await s.post(s.admin, `${s.AS}/contracts/${c4.id}/amendments`, {
            type: 'DOWNGRADE',
            targetPlanCode: 'GROWTH',
            forced: true,
          })
        ).status,
      ).toBe(400); // no reason
      const r = await s.post(s.admin, `${s.AS}/contracts/${c4.id}/amendments`, {
        type: 'DOWNGRADE',
        targetPlanCode: 'GROWTH',
        forced: true,
        reason: 'Contract breach: plan reduced by DealDash',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data).toMatchObject({ forced: true, requestedByOrg: false });
      const done = await s.post(s.admin, `${s.AS}/amendments/${r.body.data.id}/accept-on-behalf`, {
        language: 'en',
        confirm: true,
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(done.body.data.status).toBe('APPLIED');
      // all 8 branches remain; no further branch can be added until the business is back under the limit
      expect(
        await t.prisma.merchantBranch.count({
          where: { organizationId: m4.orgId, status: 'ACTIVE' },
        }),
      ).toBe(8);
      expect((await addBranch(m4.owner, m4.orgId, 9)).status).toBe(403);
      const audit = await t.prisma.auditLog.findFirst({
        where: { action: 'AMENDMENT_APPLIED_DOWNGRADE', entityId: r.body.data.id },
      });
      expect(audit?.reason).toContain('Contract breach');
      expect(r.body.data.impact.excess[0]).toMatchObject({ key: 'branches.max', excess: 3 });
    });
  });

  describe('Add-ons extend the contract’s entitlements (no second entitlement system)', () => {
    let m: Awaited<ReturnType<SubWorld['mkMerchant']>>;
    let contractId: string;

    beforeAll(async () => {
      m = await s.mkMerchant('addon', 5);
      contractId = (await s.assign(m.orgId, 'GROWTH', m.owner)).id as string;
    });

    it('an add-on without a price cannot be bought by the business: DealDash arranges it', async () => {
      const r = await s.post(m.owner, `${base(m.orgId)}/amendments`, {
        type: 'ADD_ON',
        addOn: { code: 'EXTRA_BRANCH', quantity: 2 },
      });
      expect(r.status).toBe(409);
      expect(r.body.errors[0].code).toBe('PRICING_NOT_AVAILABLE');
      expect(
        (
          await s.post(m.owner, `${base(m.orgId)}/amendments`, {
            type: 'ADD_ON',
            addOn: { code: 'DEDICATED_SUPPORT', quantity: 1 },
          })
        ).status,
      ).toBe(400); // not offered on Growth
    });

    it('once priced, accepting it raises the limit; the add-on keeps its dates, quantity, price and acceptance', async () => {
      expect(
        (
          await s.post(s.finance, `${s.AS}/contracts/${contractId}/rates`, {
            itemCode: 'ADDON:EXTRA_BRANCH',
            model: 'FIXED',
            amountMinor: 150_000,
            approvalRef: 'ADDON-PRICE',
          })
        ).status,
      ).toBe(201);
      const end = new Date(Date.now() + 90 * day).toISOString();
      const r = await s.post(m.owner, `${base(m.orgId)}/amendments`, {
        type: 'ADD_ON',
        addOn: { code: 'EXTRA_BRANCH', quantity: 2, endAt: end, autoRenew: true },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data.impact).toMatchObject({ needsAcceptance: true, priceDeltaMinor: 300_000 });
      const acc = await s.post(m.owner, `${base(m.orgId)}/amendments/${r.body.data.id}/accept`, {
        language: 'en',
        confirm: true,
      });
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      expect(await limitOf(m.orgId, 'branches.max')).toMatchObject({
        value: 7,
        base: 5,
        addOns: 2,
      });
      const row = await t.prisma.contractAddOn.findFirstOrThrow({
        where: { contractId, code: 'EXTRA_BRANCH' },
      });
      expect(row).toMatchObject({
        quantity: 2,
        priceMinor: 150_000,
        status: 'ACTIVE',
        autoRenew: true,
        currency: 'PKR',
      });
      expect(row.endAt).not.toBeNull();
      expect(row.acceptanceId).toBeTruthy();
      expect(row.pricingVersionKey).toMatch(/^CR:/);
      const ev = await events(contractId, 'ADD_ON_FEE');
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({
        amountMinor: 300_000,
        quantity: 2,
        unitRateMinor: 150_000,
        billingCategory: 'PREMIUM_SERVICE',
      });
      // the limit really is higher: 6th and 7th branch are accepted, the 8th is not
      expect((await addBranch(m.owner, m.orgId, 6)).status).toBe(201);
      expect((await addBranch(m.owner, m.orgId, 7)).status).toBe(201);
      expect((await addBranch(m.owner, m.orgId, 8)).status).toBe(403);
    });

    it('the add-on ends on its end date and the limit returns to the plan’s (effective dating)', async () => {
      const after = new Date(Date.now() + 100 * day);
      const e = await t.app.get(EntitlementService).effective(m.orgId, after);
      expect(e.limitDetails['branches.max']).toMatchObject({ value: 5, addOns: 0 });
    });
  });

  describe('Contract overrides: plan default + override, the global plan untouched', () => {
    let m: Awaited<ReturnType<SubWorld['mkMerchant']>>;
    let contractId: string;

    beforeAll(async () => {
      m = await s.mkMerchant('override', 5);
      contractId = (await s.assign(m.orgId, 'GROWTH', m.owner)).id as string;
    });

    it('needs two DealDash people: the requester cannot approve their own override', async () => {
      const r = await s.post(s.admin, `${s.AS}/contracts/${contractId}/amendments`, {
        type: 'ENTITLEMENT',
        reason: 'Negotiated: 7 branches',
        entitlements: [{ kind: 'LIMIT', key: 'branches.max', value: 7 }],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const id = r.body.data.id;
      expect(r.body.data.status).toBe('PROPOSED');
      expect((await limitOf(m.orgId, 'branches.max')).value).toBe(5);
      expect((await s.post(s.admin, `${s.AS}/amendments/${id}/apply`, {})).status).toBe(403);
      expect(
        (
          await s.post(s.admin, `${s.AS}/amendments/${id}/accept-on-behalf`, {
            language: 'en',
            confirm: true,
          })
        ).status,
      ).toBe(409);
      expect((await s.post(s.finance, `${s.AS}/amendments/${id}/apply`, {})).status).toBe(200);
      expect(await limitOf(m.orgId, 'branches.max')).toMatchObject({
        value: 7,
        base: 5,
        override: 7,
        source: 'OVERRIDE',
      });
    });

    it('does not modify the global plan: another business on Growth still has 5', async () => {
      const other = await s.mkMerchant('override-other', 1);
      await s.assign(other.orgId, 'GROWTH', other.owner);
      expect((await limitOf(other.orgId, 'branches.max')).value).toBe(5);
      const v = (await s.get(s.admin, `${s.AS}/plans/GROWTH`)).body.data.versions.find(
        (x: { market: string }) => x.market === 'PK',
      );
      const full = (await s.get(s.admin, `${s.AS}/plan-versions/${v.id}`)).body.data;
      expect(
        full.entitlements.limits.find((l: { key: string }) => l.key === 'branches.max').value,
      ).toBe(5);
    });

    it('an override and an add-on combine: override replaces the plan default, the add-on adds on top', async () => {
      await s.post(s.finance, `${s.AS}/contracts/${contractId}/rates`, {
        itemCode: 'ADDON:EXTRA_BRANCH',
        model: 'FIXED',
        amountMinor: 100_000,
      });
      const r = await s.post(m.owner, `${base(m.orgId)}/amendments`, {
        type: 'ADD_ON',
        addOn: { code: 'EXTRA_BRANCH', quantity: 2 },
      });
      await s.post(m.owner, `${base(m.orgId)}/amendments/${r.body.data.id}/accept`, {
        language: 'en',
        confirm: true,
      });
      expect(await limitOf(m.orgId, 'branches.max')).toMatchObject({
        value: 9,
        override: 7,
        addOns: 2,
      });
    });

    it('overrides keep effective dates: a future override is not in force yet; an expired one never is', async () => {
      const when = new Date(Date.now() + 10 * day);
      const r = await s.post(s.admin, `${s.AS}/contracts/${contractId}/amendments`, {
        type: 'ENTITLEMENT',
        reason: 'More branches from next month',
        effectiveMode: 'CUSTOM_EFFECTIVE_DATE',
        effectiveAt: when.toISOString(),
        entitlements: [{ kind: 'LIMIT', key: 'branches.max', value: 12 }],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(
        (await s.post(s.finance, `${s.AS}/amendments/${r.body.data.id}/apply`, {})).status,
      ).toBe(200);
      const ent = t.app.get(EntitlementService);
      expect((await ent.effective(m.orgId)).limitDetails['branches.max']!.override).toBe(7); // today
      expect(
        (await ent.effective(m.orgId, new Date(when.getTime() + day))).limitDetails['branches.max']!
          .override,
      ).toBe(12); // after the date
      // an expired override row never applies
      await t.prisma.contractEntitlement.create({
        data: {
          contractId,
          kind: 'FEATURE',
          key: 'WEBHOOKS',
          enabled: true,
          source: 'OVERRIDE',
          effectiveFrom: new Date(Date.now() - 20 * day),
          effectiveUntil: new Date(Date.now() - 10 * day),
        },
      });
      expect((await ent.effective(m.orgId)).features).not.toContain('WEBHOOKS');
    });

    it('an override can switch a feature on or off for one contract', async () => {
      const r = await s.post(s.admin, `${s.AS}/contracts/${contractId}/amendments`, {
        type: 'ENTITLEMENT',
        reason: 'API access for the pilot',
        entitlements: [
          { kind: 'FEATURE', key: 'API_ACCESS', enabled: true },
          { kind: 'FEATURE', key: 'BULK_IMPORT', enabled: false },
        ],
      });
      await s.post(s.finance, `${s.AS}/amendments/${r.body.data.id}/apply`, {});
      const e = await t.app.get(EntitlementService).effective(m.orgId);
      expect(e.features).toContain('API_ACCESS');
      expect(e.features).not.toContain('BULK_IMPORT'); // the plan default is switched off for THIS contract only
    });
  });

  describe('Trial is separate from Starter', () => {
    it('grants the trial plan for its period, then converts to the configured post-trial plan', async () => {
      const m = await s.mkMerchant('trial', 1);
      const c = await s.assign(m.orgId, 'GROWTH', null, {
        trial: { days: 14, postTrialPlanCode: 'STARTER' },
      });
      expect(c.status).toBe('TRIAL');
      expect(c.trial).toMatchObject({ status: 'ACTIVE', postTrialPlanCode: 'STARTER' });
      expect(await limitOf(m.orgId, 'branches.max')).toMatchObject({ value: 5 });
      expect(await events(c.id as string)).toEqual([]); // a trial is not charged
      const within = new Date(Date.now() + 10 * day);
      await runDue(within);
      expect(await signals(m.orgId)).toContain('TRIAL_EXPIRING');
      await runDue(new Date(Date.now() + 15 * day));
      const after = (await s.get(s.admin, `${s.AS}/contracts/${c.id}`)).body.data;
      expect(after).toMatchObject({ status: 'ACTIVE', planCode: 'STARTER', version: 2 });
      expect(after.trial.status).toBe('CONVERTED');
      const e = await t.app
        .get(EntitlementService)
        .effective(m.orgId, new Date(Date.now() + 16 * day));
      expect(e.limits['branches.max']).toBe(1);
    });

    it('does NOT become Starter unless configured: it expires, new exposure stops, history stays', async () => {
      const m = await s.mkMerchant('trial-end', 1);
      const c = await s.assign(m.orgId, 'GROWTH', null, { trial: { days: 7 } });
      await runDue(new Date(Date.now() + 8 * day));
      const after = (await s.get(s.admin, `${s.AS}/contracts/${c.id}`)).body.data;
      expect(after.status).toBe('EXPIRED');
      expect(after.trial.status).toBe('EXPIRED');
      const e = await t.app
        .get(EntitlementService)
        .effective(m.orgId, new Date(Date.now() + 9 * day));
      expect(e.products).toEqual([]);
      expect(e.lifecycle).toBe('EXPIRED');
      const b = await addBranch(m.owner, m.orgId, 2);
      expect(b.status).toBe(403);
      expect(b.body.errors[0].code).toBe('CONTRACT_ENDED');
      expect(
        await t.prisma.contractEntitlement.count({ where: { contractId: c.id as string } }),
      ).toBeGreaterThan(0); // nothing deleted
    });

    it('a paid post-trial plan waits for acceptance (the trial plan is not silently charged)', async () => {
      const m = await s.mkMerchant('trial-paid', 1);
      const c = await s.assign(m.orgId, 'GROWTH', null, {
        trial: { days: 7, postTrialPlanCode: 'BUSINESS' },
      });
      await runDue(new Date(Date.now() + 8 * day));
      expect((await s.get(s.admin, `${s.AS}/contracts/${c.id}`)).body.data).toMatchObject({
        status: 'PENDING_ACTIVATION',
        planCode: 'BUSINESS',
      });
      const acc = await s.post(m.owner, `${base(m.orgId)}/accept`, {
        language: 'en',
        confirm: true,
      });
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      expect(acc.body.data.contract.status).toBe('ACTIVE');
    });
  });

  describe('Renewal and cancellation', () => {
    it('renews each period once: the billing event is idempotent however often the scheduled pass runs', async () => {
      const m = await s.mkMerchant('renew', 1);
      const c = await s.assign(m.orgId, 'GROWTH', m.owner);
      const id = c.id as string;
      expect(await events(id)).toHaveLength(1);
      const later = new Date(Date.now() + 32 * day);
      await runDue(later);
      await runDue(later);
      await runDue(new Date(later.getTime() + 1000));
      const ev = await events(id, 'MONTHLY_SUBSCRIPTION_RENEWAL');
      expect(ev).toHaveLength(2);
      expect(new Set(ev.map((e) => e.idempotencyKey)).size).toBe(2);
      const after = (await s.get(s.admin, `${s.AS}/contracts/${id}`)).body.data;
      expect(new Date(after.nextRenewalAt).getTime()).toBeGreaterThan(later.getTime());
    });

    it('stopping renewal keeps the agreement to the end of the period, then it ends; history stays', async () => {
      const m = await s.mkMerchant('stop', 2);
      const c = await s.assign(m.orgId, 'GROWTH', m.owner);
      const r = await s.post(m.owner, `${base(m.orgId)}/stop-renewal`, {
        reason: 'Closing the business',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.renewalState).toBe('NON_RENEWING');
      expect((await s.get(s.admin, `${s.AS}/contracts/${c.id}`)).body.data.status).toBe('ACTIVE');
      await runDue(new Date(Date.now() + 32 * day));
      expect((await s.get(s.admin, `${s.AS}/contracts/${c.id}`)).body.data.status).toBe('EXPIRED');
      expect(await events(c.id as string, 'MONTHLY_SUBSCRIPTION_RENEWAL')).toHaveLength(1); // no renewal charge for a period it did not renew
      expect(
        await t.prisma.contractAcceptance.count({ where: { contractId: c.id as string } }),
      ).toBe(1);
    });

    it('DealDash cancels with a reason: new exposure stops; rows are end-dated, never deleted; the reason is audited', async () => {
      const m = await s.mkMerchant('cancel', 2);
      const c = await s.assign(m.orgId, 'GROWTH', m.owner);
      expect(
        (await s.post(s.ops, `${s.AS}/contracts/${c.id}/cancel`, { reason: 'Customer request' }))
          .status,
      ).toBe(403); // needs approve
      const r = await s.post(s.finance, `${s.AS}/contracts/${c.id}/cancel`, {
        reason: 'Customer request',
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.status).toBe('CANCELLED');
      expect(
        await t.prisma.contractEntitlement.count({
          where: { contractId: c.id as string, effectiveUntil: null },
        }),
      ).toBe(0);
      expect(
        await t.prisma.contractEntitlement.count({ where: { contractId: c.id as string } }),
      ).toBeGreaterThan(0);
      expect((await addBranch(m.owner, m.orgId, 5)).body.errors[0].code).toBe('CONTRACT_ENDED');
      expect(await t.prisma.merchantBranch.count({ where: { organizationId: m.orgId } })).toBe(2);
      const audit = await t.prisma.auditLog.findFirst({
        where: { action: 'SUBSCRIPTION_CANCELLED', entityId: c.id as string },
      });
      expect(audit?.reason).toBe('Customer request');
      // a cancelled agreement cannot be changed or cancelled again
      expect(
        (await s.post(s.finance, `${s.AS}/contracts/${c.id}/cancel`, { reason: 'again please' }))
          .status,
      ).toBe(409);
    });
  });

  describe('Merchant Enterprise is negotiated, not a fixed fifth tier', () => {
    it('has no list price: an indicative reference never bills; a negotiated rate does; limits are whatever the contract says', async () => {
      const m = await s.mkMerchant('enterprise', 12);
      const c = await s.assign(m.orgId, 'MERCHANT_ENTERPRISE', m.owner);
      expect(c).toMatchObject({ status: 'ACTIVE', kind: 'MERCHANT_ENTERPRISE' });
      expect(await events(c.id as string)).toEqual([]); // the indicative "from PKR 50,000" is a reference, not a charge
      const price = (await s.get(s.admin, `${s.AS}/contracts/${c.id}/price`)).body.data;
      expect(price).toMatchObject({ indicative: true });
      const e = await t.app.get(EntitlementService).effective(m.orgId);
      expect(e.limits).toEqual({}); // unlimited unless negotiated
      expect(e.features).toEqual(
        expect.arrayContaining(['API_ACCESS', 'DEDICATED_SUPPORT', 'NETWORK_INTEGRATION']),
      );
      expect((await addBranch(m.owner, m.orgId, 13)).status).toBe(201);
      // a negotiated subscription rate and an integration fee turn the references into real events on the NEXT period / fee
      expect(
        (
          await s.post(s.finance, `${s.AS}/contracts/${c.id}/rates`, {
            itemCode: 'SUBSCRIPTION',
            model: 'FIXED',
            amountMinor: 8_000_000,
            approvalRef: 'ENT-1',
          })
        ).status,
      ).toBe(201);
      expect(
        (
          await s.post(s.finance, `${s.AS}/contracts/${c.id}/rates`, {
            itemCode: 'API_FEE',
            model: 'FIXED',
            amountMinor: 30_000_000,
            approvalRef: 'ENT-1',
          })
        ).status,
      ).toBe(201);
      const sub = (await s.get(s.admin, `${s.AS}/contracts/${c.id}/price`)).body.data;
      expect(sub).toMatchObject({
        amountMinor: 8_000_000,
        indicative: false,
        source: 'CONTRACT_RATE',
      });
      await runDue(new Date(Date.now() + 32 * day));
      const renewal = await events(c.id as string, 'MONTHLY_SUBSCRIPTION_RENEWAL');
      expect(renewal).toHaveLength(1);
      expect(renewal[0]).toMatchObject({ amountMinor: 8_000_000 });
      expect(renewal[0]!.pricingVersionKey).toMatch(/^CR:/);
    });
  });
});
