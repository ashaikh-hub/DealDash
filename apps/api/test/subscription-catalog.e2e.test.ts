import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, type TestApp } from './helpers';
import { subscriptionWorld, type SubWorld } from './subscription-fixtures';
import { PricingResolver } from '../src/subscription/pricing.resolver';

/**
 * Plan catalog, plan versions, the Pakistan configuration (data, not code), the price book and pricing resolution.
 * A plan is a template; a version is a per-market snapshot; published versions are immutable; contracts copy a version.
 */
describe.skipIf(!DB_READY)('Subscription engine: plans, versions, pricing', () => {
  let t: TestApp;
  let s: SubWorld;

  beforeAll(async () => {
    t = await createTestApp();
    s = await subscriptionWorld(t);
  });
  afterAll(() => t?.close());

  const pk = async (code: string) => {
    const plan = (await s.get(s.admin, `${s.AS}/plans/${code}`)).body.data;
    const v = plan.versions.find(
      (x: { market: string; status: string }) => x.market === 'PK' && x.status === 'PUBLISHED',
    );
    return (await s.get(s.admin, `${s.AS}/plan-versions/${v.id}`)).body.data;
  };

  describe('the approved Pakistan configuration is data', () => {
    it('Starter is a genuine free plan: PKR 0, 1 branch, 2 users', async () => {
      const v = await pk('STARTER');
      expect(v.prices).toEqual([]);
      expect(v.currency).toBe('PKR');
      const limits = Object.fromEntries(
        v.entitlements.limits.map((l: { key: string; value: number }) => [l.key, l.value]),
      );
      expect(limits).toMatchObject({ 'branches.max': 1, 'users.max': 2 });
      const plan = (await s.get(s.admin, `${s.AS}/plans/STARTER`)).body.data;
      expect(plan.isFree).toBe(true);
      // a free plan can still BUY paid products where the entitlement allows it
      expect(v.entitlements.products).toEqual(
        expect.arrayContaining(['EXCLUSIVE', 'WATCH', 'FEATURED_PLACEMENT']),
      );
    });

    it('Growth PKR 4,999 / month (5 branches, 10 users) and Business PKR 14,999 / month (25 branches, 50 users), in minor units', async () => {
      const g = await pk('GROWTH');
      expect(g.prices).toEqual([{ cadence: 'MONTHLY', amountMinor: 499_900 }]);
      expect(
        Object.fromEntries(
          g.entitlements.limits.map((l: { key: string; value: number }) => [l.key, l.value]),
        ),
      ).toMatchObject({ 'branches.max': 5, 'users.max': 10 });
      const b = await pk('BUSINESS');
      expect(b.prices).toEqual([{ cadence: 'MONTHLY', amountMinor: 1_499_900 }]);
      expect(
        Object.fromEntries(
          b.entitlements.limits.map((l: { key: string; value: number }) => [l.key, l.value]),
        ),
      ).toMatchObject({ 'branches.max': 25, 'users.max': 50 });
    });

    it('Merchant Enterprise is custom / negotiated (not a fixed fifth tier); the reference figures are indicative, never a list price', async () => {
      const plan = (await s.get(s.admin, `${s.AS}/plans/MERCHANT_ENTERPRISE`)).body.data;
      expect(plan.negotiated).toBe(true);
      const v = await pk('MERCHANT_ENTERPRISE');
      expect(v.prices).toEqual([{ cadence: 'MONTHLY', amountMinor: 5_000_000, indicative: true }]);
      expect(v.fees).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'SETUP_FEE', amountMinor: 10_000_000, indicative: true }),
          expect.objectContaining({ code: 'API_FEE', amountMinor: 25_000_000, indicative: true }),
        ]),
      );
      expect(v.entitlements.limits).toEqual([]); // unlimited unless a contract says otherwise
    });

    it('Bank, Scheme and Corporate references: monthly / annual prices, "from" figures marked indicative', async () => {
      const bank = await pk('BANK_ENTERPRISE');
      expect(bank.prices).toEqual([
        { cadence: 'MONTHLY', amountMinor: 25_000_000 },
        { cadence: 'ANNUAL', amountMinor: 250_000_000 },
      ]);
      expect(bank.fees.find((f: { code: string }) => f.code === 'SETUP_FEE')).toMatchObject({
        amountMinor: 50_000_000,
        indicative: true,
      });
      expect(bank.addOnPrices.PREMIUM_ANALYTICS).toMatchObject({
        amountMinor: 10_000_000,
        indicative: true,
      });
      const country = await pk('SCHEME_COUNTRY_NETWORK');
      expect(country.prices).toEqual([
        { cadence: 'ANNUAL', amountMinor: 500_000_000, indicative: true },
      ]);
      const regional = await pk('SCHEME_REGIONAL');
      expect(regional.prices).toEqual([
        { cadence: 'ANNUAL', amountMinor: 1_000_000_000, indicative: true },
      ]);
      expect(
        (await s.get(s.admin, `${s.AS}/plans/SCHEME_INTERNATIONAL`)).body.data.negotiated,
      ).toBe(true);
      expect((await s.get(s.admin, `${s.AS}/plans/SCHEME_MULTI_MARKET`)).body.data.negotiated).toBe(
        true,
      );
      const corp = await pk('CORPORATE_PARTNER');
      expect(corp.prices).toEqual([
        { cadence: 'MONTHLY', amountMinor: 10_000_000 },
        { cadence: 'ANNUAL', amountMinor: 100_000_000 },
      ]);
      expect(corp.fees.find((f: { code: string }) => f.code === 'API_FEE')).toMatchObject({
        amountMinor: 25_000_000,
        indicative: true,
      });
    });

    it('the price book carries the product references as indicative values / ranges; Play & Win is inactive (Phase 2)', async () => {
      const items = (await s.get(s.admin, `${s.AS}/price-items?market=PK`)).body.data as Array<{
        code: string;
        status: string;
        versions: Array<Record<string, unknown>>;
      }>;
      const by = (c: string) => items.find((i) => i.code === c)!;
      expect(by('FEATURED_LIVE_DEAL').versions[0]).toMatchObject({
        amountMinor: 500_000,
        indicative: true,
      });
      expect(by('VOUCHER_COMMISSION').versions[0]).toMatchObject({
        rangeMin: 800,
        rangeMax: 1200,
        indicative: true,
      });
      expect(by('WATCH_QUALIFIED_VIEW').versions[0]).toMatchObject({
        rangeMin: 300,
        rangeMax: 700,
      });
      expect(by('PUSH_CAMPAIGN').versions[0]).toMatchObject({ amountMinor: 1_000_000 });
      expect(by('HOMEPAGE_PLACEMENT').versions[0]).toMatchObject({ amountMinor: 2_500_000 });
      expect(by('PLAY_AND_WIN').status).toBe('INACTIVE');
    });

    it('an indicative reference is never resolved as a price to charge', async () => {
      const r = await t.app
        .get(PricingResolver)
        .item({ itemCode: 'FEATURED_LIVE_DEAL', market: 'PK' });
      expect(r).toMatchObject({ amountMinor: null, indicative: true, source: 'PRICE_BOOK' });
      expect(r.pricingVersionKey).toMatch(/^PIV:/);
    });
  });

  describe('versions: a change is a new version, published by a different person', () => {
    const draft = (price: number) => ({
      market: 'PK',
      currency: 'PKR',
      defaultCadence: 'MONTHLY',
      prices: [{ cadence: 'MONTHLY', amountMinor: price }],
      entitlements: {
        products: ['LIVE_DEAL', 'EXCLUSIVE'],
        features: ['BULK_IMPORT'],
        limits: [
          { key: 'branches.max', value: 5 },
          { key: 'users.max', value: 10 },
        ],
      },
    });
    let newVersion: string;

    it('validates the vocabulary: an unknown product, feature or limit cannot become an unenforceable promise', async () => {
      const bad = (e: Record<string, unknown>) =>
        s.post(s.admin, `${s.AS}/plans/GROWTH/versions`, {
          ...draft(500_000),
          entitlements: { products: [], features: [], limits: [], ...e },
        });
      expect((await bad({ products: ['TELEPORT'] })).status).toBe(400);
      expect((await bad({ features: ['MIND_READING'] })).status).toBe(400);
      expect((await bad({ limits: [{ key: 'wings.max', value: 2 }] })).status).toBe(400);
      expect(
        (
          await bad({
            limits: [
              { key: 'branches.max', value: 2 },
              { key: 'branches.max', value: 3 },
            ],
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await bad({
            limits: [{ key: 'api.requests', value: 5, mode: 'SOFT', softAction: 'OVERAGE_CHARGE' }],
          })
        ).status,
      ).toBe(400);
    });

    // a throwaway plan: the seeded Pakistan plans are never edited by tests (other suites rely on them)
    let firstVersion: string;
    let existingContract: string;

    it('drafts a plan version; the author cannot publish it; a different person can; a later price is a NEW version', async () => {
      expect(
        (
          await s.post(s.admin, `${s.AS}/plans`, {
            code: 'PRICE_TEST',
            nameEn: 'Price test',
            nameAr: 'اختبار السعر',
            entityType: 'MERCHANT',
            contractKind: 'MERCHANT_SUBSCRIPTION',
          })
        ).status,
      ).toBe(201);
      const v1 = await s.post(s.admin, `${s.AS}/plans/PRICE_TEST/versions`, draft(499_900));
      expect(v1.status, JSON.stringify(v1.body)).toBe(201);
      firstVersion = v1.body.data.id;
      expect(v1.body.data).toMatchObject({ status: 'DRAFT', version: 1, market: 'PK' });
      expect(
        (await s.post(s.admin, `${s.AS}/plan-versions/${firstVersion}/publish`, {})).status,
      ).toBe(403);
      expect(
        (await s.post(s.finance, `${s.AS}/plan-versions/${firstVersion}/publish`, {})).status,
      ).toBe(200);
      // an agreement entered under version 1
      const m0 = await s.mkMerchant('Catalog-old');
      existingContract = (await s.assign(m0.orgId, 'PRICE_TEST', m0.owner)).id as string;
      // a new price is a new version
      const d = await s.post(s.admin, `${s.AS}/plans/PRICE_TEST/versions`, draft(599_900));
      expect(d.status, JSON.stringify(d.body)).toBe(201);
      newVersion = d.body.data.id;
      expect(d.body.data).toMatchObject({ status: 'DRAFT', version: 2 });
      const own = await s.post(s.finance, `${s.AS}/plan-versions/${newVersion}/publish`, {});
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      expect(own.body.data.status).toBe('PUBLISHED');
    });

    it('the previous version is retired by date, never deleted; a new agreement gets the new price; an existing one keeps its own', async () => {
      const plan = (await s.get(s.admin, `${s.AS}/plans/PRICE_TEST`)).body.data;
      const pkv = plan.versions.filter((v: { market: string }) => v.market === 'PK');
      expect(pkv.map((v: { version: number }) => v.version).sort()).toEqual([1, 2]);
      expect(pkv.find((v: { version: number }) => v.version === 1).effectiveUntil).not.toBeNull();
      const m1 = await s.mkMerchant('Catalog-new');
      const c = await s.assign(m1.orgId, 'PRICE_TEST', m1.owner);
      expect(c.planVersion).toBe(2);
      const price = (await s.get(s.admin, `${s.AS}/contracts/${c.id}/price`)).body.data;
      expect(price).toMatchObject({
        amountMinor: 599_900,
        currency: 'PKR',
        source: 'PLAN_VERSION',
      });
      expect(price.pricingVersionKey).toBe(`PLV:${newVersion}`);
      // the agreement made under version 1 still resolves version 1 (a contract holds a snapshot of the plan version it entered)
      const old = (await s.get(s.admin, `${s.AS}/contracts/${existingContract}/price`)).body.data;
      expect(old).toMatchObject({ amountMinor: 499_900 });
      expect(old.pricingVersionKey).toBe(`PLV:${firstVersion}`);
    });

    it('a published version is immutable: through the API and in the database', async () => {
      const upd = await s.api(s.admin).put(`${s.AS}/plan-versions/${newVersion}`).send(draft(1));
      expect(upd.status).toBe(409);
      await expect(
        t.prisma.commercialPlanVersion.update({ where: { id: newVersion }, data: { prices: [] } }),
      ).rejects.toThrow();
      await expect(
        t.prisma.commercialPlanVersion.delete({ where: { id: newVersion } }),
      ).rejects.toThrow();
    });

    it('only retiring is allowed on a published version', async () => {
      expect(
        (
          await s.post(s.admin, `${s.AS}/plans`, {
            code: 'RETIRE_ME',
            nameEn: 'Retire me',
            nameAr: 'للإيقاف',
            entityType: 'MERCHANT',
            contractKind: 'MERCHANT_SUBSCRIPTION',
          })
        ).status,
      ).toBe(201);
      const draftV = await s.post(s.admin, `${s.AS}/plans/RETIRE_ME/versions`, {
        ...draft(1_599_900),
        entitlements: {
          products: ['LIVE_DEAL'],
          features: [],
          limits: [{ key: 'branches.max', value: 25 }],
        },
      });
      const pub = await s.post(
        s.finance,
        `${s.AS}/plan-versions/${draftV.body.data.id}/publish`,
        {},
      );
      expect(pub.status).toBe(200);
      const ret = await s.post(s.finance, `${s.AS}/plan-versions/${draftV.body.data.id}/retire`, {
        reason: 'Superseded by a new price',
      });
      expect(ret.status, JSON.stringify(ret.body)).toBe(200);
      expect(ret.body.data.status).toBe('RETIRED');
      await expect(
        t.prisma.commercialPlanVersion.update({
          where: { id: draftV.body.data.id },
          data: { status: 'PUBLISHED' },
        }),
      ).rejects.toThrow();
    });

    it('an unpublished or unknown plan / market is not available', async () => {
      const m = await s.mkMerchant('Catalog-none');
      const r = await s.post(s.admin, `${s.AS}/contracts/assign`, {
        organizationId: m.orgId,
        planCode: 'GROWTH',
        market: 'QA',
      });
      expect(r.status).toBe(404);
      expect(r.body.errors[0].code).toBe('PLAN_NOT_AVAILABLE');
      const wrongKind = await s.post(s.admin, `${s.AS}/contracts/assign`, {
        organizationId: m.orgId,
        planCode: 'BANK_ENTERPRISE',
        market: 'PK',
      });
      expect(wrongKind.status).toBe(400);
    });
  });

  describe('pricing resolution: negotiated rate, promotion, discount, waiver, version retention', () => {
    let contractId: string;

    beforeAll(async () => {
      const m = await s.mkMerchant('Pricing');
      contractId = (await s.assign(m.orgId, 'BUSINESS', m.owner)).id as string;
    });

    it('the base price comes from the plan version and the version key is retained', async () => {
      const p = (await s.get(s.admin, `${s.AS}/contracts/${contractId}/price`)).body.data;
      expect(p).toMatchObject({ amountMinor: 1_499_900, source: 'PLAN_VERSION', waived: false });
      expect(p.pricingVersionKey).toMatch(/^PLV:/);
    });

    it('a negotiated rate replaces the plan price for that contract only, as a NEW version (history kept)', async () => {
      const r1 = await s.post(s.finance, `${s.AS}/contracts/${contractId}/rates`, {
        itemCode: 'SUBSCRIPTION',
        model: 'FIXED',
        amountMinor: 1_200_000,
        approvalRef: 'NEG-1',
      });
      expect(r1.status, JSON.stringify(r1.body)).toBe(201);
      const p1 = (await s.get(s.admin, `${s.AS}/contracts/${contractId}/price`)).body.data;
      expect(p1).toMatchObject({ amountMinor: 1_200_000, source: 'CONTRACT_RATE' });
      expect(p1.pricingVersionKey).toMatch(/^CR:/);
      await s.post(s.finance, `${s.AS}/contracts/${contractId}/rates`, {
        itemCode: 'SUBSCRIPTION',
        model: 'FIXED',
        amountMinor: 1_100_000,
        approvalRef: 'NEG-2',
      });
      const rates = (await s.get(s.admin, `${s.AS}/contracts/${contractId}`)).body.data
        .rates as Array<{ version: number; effectiveUntil: string | null }>;
      expect(rates.map((r) => r.version).sort()).toEqual([1, 2]);
      expect(rates.find((r) => r.version === 1)!.effectiveUntil).not.toBeNull();
      expect(
        (await s.get(s.admin, `${s.AS}/contracts/${contractId}/price`)).body.data.amountMinor,
      ).toBe(1_100_000);
      // other customers are untouched: the global plan did not change
      expect((await pk('BUSINESS')).prices[0].amountMinor).toBe(1_499_900);
    });

    it('a discount and a waiver are applied last and shown as adjustments', async () => {
      await s.post(s.finance, `${s.AS}/contracts/${contractId}/rates`, {
        itemCode: 'SUBSCRIPTION',
        model: 'FIXED',
        amountMinor: 1_000_000,
        discountBps: 1000,
        approvalRef: 'NEG-3',
      });
      const d = (await s.get(s.admin, `${s.AS}/contracts/${contractId}/price`)).body.data;
      expect(d.amountMinor).toBe(900_000);
      expect(d.adjustments.map((a: { kind: string }) => a.kind)).toEqual(
        expect.arrayContaining(['NEGOTIATED_RATE', 'DISCOUNT']),
      );
      await s.post(s.finance, `${s.AS}/contracts/${contractId}/rates`, {
        itemCode: 'SUBSCRIPTION',
        model: 'FIXED',
        amountMinor: 1_000_000,
        waived: true,
        approvalRef: 'NEG-4',
      });
      const w = (await s.get(s.admin, `${s.AS}/contracts/${contractId}/price`)).body.data;
      expect(w).toMatchObject({ amountMinor: 0, waived: true });
    });

    it('a promotion has a window and a post-promotion treatment; after it ends the standard price returns', async () => {
      const m = await s.mkMerchant('Promo');
      const c = await s.assign(m.orgId, 'GROWTH', m.owner);
      const now = Date.now();
      const p = await s.post(s.finance, `${s.AS}/contracts/${c.id}/promotions`, {
        kind: 'PROMOTIONAL_PRICE',
        itemCode: 'SUBSCRIPTION',
        originalPriceMinor: 499_900,
        promoPriceMinor: 99_900,
        startAt: new Date(now - 3600_000).toISOString(),
        endAt: new Date(now + 30 * 864e5).toISOString(),
        postPromotion: 'REVERT_TO_STANDARD',
        approvalRef: 'PROMO-1',
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
      const promo = (await s.get(s.admin, `${s.AS}/contracts/${c.id}/price`)).body.data;
      expect(promo).toMatchObject({ amountMinor: 99_900, source: 'PROMOTION' });
      expect(promo.pricingVersionKey).toMatch(/\+PRM:/);
      expect(
        (
          await s.post(s.finance, `${s.AS}/contracts/${c.id}/promotions`, {
            kind: 'PROMOTIONAL_PRICE',
            itemCode: 'SUBSCRIPTION',
            promoPriceMinor: 1,
            startAt: new Date(now).toISOString(),
            endAt: new Date(now - 1000).toISOString(),
          })
        ).status,
      ).toBe(400);
      // the scheduled pass ends it and the standard price returns
      const later = new Date(now + 40 * 864e5);
      const subs = (await import('../src/subscription/subscription.service')).SubscriptionService;
      await t.app.get(subs).runDue(later);
      const back = (await s.get(s.admin, `${s.AS}/contracts/${c.id}/price`)).body.data;
      expect(back.source).toBe('PLAN_VERSION');
      expect(back.amountMinor).toBe(499_900);
    });

    it('a promotion or rate needs the approve permission', async () => {
      expect(
        (
          await s.post(s.ops, `${s.AS}/contracts/${contractId}/rates`, {
            itemCode: 'SUBSCRIPTION',
            amountMinor: 1,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await s.post(s.merchantMgmt, `${s.AS}/contracts/${contractId}/promotions`, {
            kind: 'SETUP_WAIVER',
            itemCode: 'SETUP_FEE',
            waived: true,
            startAt: new Date().toISOString(),
            endAt: new Date(Date.now() + 1e8).toISOString(),
          })
        ).status,
      ).toBe(403);
    });

    it('a price-book item: contract rate, then the book; a published book version needs a different publisher', async () => {
      const it1 = await s.post(s.admin, `${s.AS}/price-items`, {
        code: 'TEST_BOOST',
        nameEn: 'Test boost',
        nameAr: 'تعزيز اختبار',
        category: 'CAMPAIGN_ADVERTISING',
        unit: 'PER_CAMPAIGN',
      });
      expect(it1.status).toBe(201);
      const v1 = await s.post(s.admin, `${s.AS}/price-items/TEST_BOOST/versions`, {
        market: 'PK',
        currency: 'PKR',
        model: 'FIXED',
        amountMinor: 700_000,
      });
      expect(
        (await s.post(s.admin, `${s.AS}/price-item-versions/${v1.body.data.id}/publish`, {}))
          .status,
      ).toBe(403);
      expect(
        (await s.post(s.finance, `${s.AS}/price-item-versions/${v1.body.data.id}/publish`, {}))
          .status,
      ).toBe(200);
      const resolver = t.app.get(PricingResolver);
      expect(await resolver.item({ itemCode: 'TEST_BOOST', market: 'PK' })).toMatchObject({
        amountMinor: 700_000,
        source: 'PRICE_BOOK',
      });
      expect(
        await resolver.item({ itemCode: 'TEST_BOOST', market: 'PK', quantity: 3, contractId }),
      ).toMatchObject({ amountMinor: 700_000, source: 'PRICE_BOOK' });
      await s.post(s.finance, `${s.AS}/contracts/${contractId}/rates`, {
        itemCode: 'TEST_BOOST',
        model: 'FIXED',
        amountMinor: 500_000,
      });
      expect(
        await resolver.item({ itemCode: 'TEST_BOOST', market: 'PK', contractId }),
      ).toMatchObject({ amountMinor: 500_000, source: 'CONTRACT_RATE' });
      await expect(resolver.item({ itemCode: 'TEST_BOOST', market: 'AE' })).rejects.toMatchObject({
        code: 'PRICING_NOT_AVAILABLE',
      });
      // percentage and tiered models
      const pc = await s.post(s.admin, `${s.AS}/price-items`, {
        code: 'TEST_COMMISSION',
        nameEn: 'Test commission',
        nameAr: 'عمولة اختبار',
        category: 'TRANSACTION_COMMISSION',
        unit: 'PERCENT',
      });
      expect(pc.status).toBe(201);
      const pv = await s.post(s.admin, `${s.AS}/price-items/TEST_COMMISSION/versions`, {
        market: 'PK',
        currency: 'PKR',
        model: 'PERCENT_BPS',
        rateBps: 1000,
        minAmountMinor: 100,
      });
      await s.post(s.finance, `${s.AS}/price-item-versions/${pv.body.data.id}/publish`, {});
      expect(
        await resolver.item({ itemCode: 'TEST_COMMISSION', market: 'PK', baseMinor: 5_000_00 }),
      ).toMatchObject({ amountMinor: 50_000 });
      expect(
        await resolver.item({ itemCode: 'TEST_COMMISSION', market: 'PK', baseMinor: 500 }),
      ).toMatchObject({ amountMinor: 100 });
    });
  });
});
