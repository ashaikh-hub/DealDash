import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_READY, createTestApp, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

/**
 * Customer experience gap closure (2026-10-16): "Browse offers by" (card / employer / brand), one merchant's offers of every type,
 * following a merchant, and the units total behind the Exclusive Deal scarcity bar. Same visibility and eligibility as before.
 */
describe.skipIf(!DB_READY)('Customer browse, brands and follow', () => {
  let t: TestApp;
  let w: HotWorld;
  let publicDeal: Awaited<ReturnType<HotWorld['publishHot']>>;
  let employerDeal: Awaited<ReturnType<HotWorld['publishHot']>>;
  let otherMerchantDeal: Awaited<ReturnType<HotWorld['publishHot']>>;

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    publicDeal = await w.publishHot('A', 5);
    employerDeal = await w.publishHot('A', 5, {
      eligibility: { kind: 'EMPLOYER', valueRefs: [w.employer] },
    });
    otherMerchantDeal = await w.publishHot('B', 3);
  });
  afterAll(async () => {
    await t?.close();
  });

  const ids = (res: { body: { data: Array<{ id: string }> } }) => res.body.data.map((d) => d.id);

  it('source=employer keeps only offers whose rule names an employer; source=card none of these; guests see locked ones', async () => {
    const guest = await t.http.get('/v1/app/hot-deals?source=employer&limit=50');
    expect(guest.status).toBe(200);
    expect(ids(guest)).toContain(employerDeal.id);
    expect(ids(guest)).not.toContain(publicDeal.id);
    const locked = guest.body.data.find((d: { id: string }) => d.id === employerDeal.id);
    expect(locked.eligibility.result).toBe('LOCKED_UNLOCKABLE');
    const card = await t.http.get('/v1/app/hot-deals?source=card&limit=50');
    expect(ids(card)).not.toContain(employerDeal.id);
    expect(ids(card)).not.toContain(publicDeal.id);
    // the same filter is accepted by Live Deals and Vouchers
    expect((await t.http.get('/v1/app/deals?source=card')).status).toBe(200);
    expect((await t.http.get('/v1/app/vouchers?source=employer')).status).toBe(200);
    expect((await t.http.get('/v1/app/hot-deals?source=bank')).status).toBe(400);
  });

  it('merchantId keeps one merchant’s offers (Exclusive Deals, Live Deals and Vouchers lists)', async () => {
    const a = await t.http.get(`/v1/app/hot-deals?merchantId=${w.A.orgId}&limit=50`);
    expect(ids(a)).toEqual(expect.arrayContaining([publicDeal.id, employerDeal.id]));
    expect(ids(a)).not.toContain(otherMerchantDeal.id);
    const b = await t.http.get(`/v1/app/hot-deals?merchantId=${w.B.orgId}&limit=50`);
    expect(ids(b)).toContain(otherMerchantDeal.id);
    expect(ids(b)).not.toContain(publicDeal.id);
    expect((await t.http.get(`/v1/app/deals?merchantId=${w.B.orgId}`)).status).toBe(200);
    expect((await t.http.get(`/v1/app/vouchers?merchantId=${w.B.orgId}`)).status).toBe(200);
  });

  it('brands: merchants with visible offers and their counts, most offers first', async () => {
    const res = await t.http.get('/v1/app/brands');
    expect(res.status).toBe(200);
    const a = res.body.data.find((b: { id: string }) => b.id === w.A.orgId);
    const b = res.body.data.find((x: { id: string }) => x.id === w.B.orgId);
    expect(a).toMatchObject({ name: { en: expect.any(String) }, offerCount: expect.any(Number) });
    expect(a.offerCount).toBeGreaterThanOrEqual(2);
    expect(b.offerCount).toBeGreaterThanOrEqual(1);
    const order = res.body.data.map((x: { offerCount: number }) => x.offerCount);
    expect([...order].sort((x, y) => y - x)).toEqual(order);
  });

  it('follow: a customer follows and unfollows; the merchant page shows it; guests cannot; unknown merchants are not found', async () => {
    const c = await w.newCustomer();
    const put = await w.api(c).put(`/v1/app/merchants/${w.A.orgId}/follow`).send({});
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.data).toEqual({ following: true, followers: 1 });
    // following twice changes nothing
    expect(
      (await w.api(c).put(`/v1/app/merchants/${w.A.orgId}/follow`).send({})).body.data,
    ).toEqual({
      following: true,
      followers: 1,
    });
    const page = await w.api(c).get(`/v1/app/merchants/${w.A.orgId}`);
    expect(page.body.data).toMatchObject({ following: true, followers: 1 });
    const guestPage = await t.http.get(`/v1/app/merchants/${w.A.orgId}`);
    expect(guestPage.body.data).toMatchObject({ following: false, followers: 1 });
    // a follow is not a saved deal
    expect((await w.api(c).get('/v1/app/saved')).body.data.items ?? []).toHaveLength(0);
    const del = await w.api(c).delete(`/v1/app/merchants/${w.A.orgId}/follow`);
    expect(del.body.data).toEqual({ following: false, followers: 0 });
    expect((await t.http.put(`/v1/app/merchants/${w.A.orgId}/follow`).send({})).status).toBe(401);
    expect(
      (await w.api(c).put('/v1/app/merchants/018f0000-0000-7000-8000-00000000dead/follow').send({}))
        .status,
    ).toBe(404);
  });

  it('the Exclusive Deal detail carries the units it started with (scarcity bar)', async () => {
    const d = await t.http.get(`/v1/app/hot-deals/${publicDeal.id}`);
    expect(d.body.data.unitsTotal).toBe(5);
  });
});
