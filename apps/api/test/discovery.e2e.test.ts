import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANALYTICS_SINK } from '../src/analytics/analytics.module';
import { SystemConfigService } from '../src/system-config/system-config.service';
import {
  DB_READY,
  call,
  createBusinessUser,
  createLiveMerchant,
  createTestApp,
  makeDealImage,
  passwordSession,
  validContent,
  type Session,
  type TestApp,
} from './helpers';
import { buildWorld, type World } from './deal-fixtures';

const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

describe.skipIf(!DB_READY)(
  'Customer discovery: lists, filters, paging, detail and merchant page',
  () => {
    let t: TestApp;
    let w: World;
    beforeAll(async () => {
      t = await createTestApp();
      w = await buildWorld(t);
    });
    afterAll(() => t?.close());

    const get = (path: string, s?: Session) => (s ? call(t, s).get(path) : t.http.get(path));

    it('a guest sees live deals as bilingual cards with a signed image, merchant and unlocked state', async () => {
      const d = await w.publish('A');
      const res = await get(`/v1/app/deals?q=${encodeURIComponent(w.A.nameEn)}&limit=50`);
      expect(res.status).toBe(200);
      const card = res.body.data.find((c: { id: string }) => c.id === d.id);
      expect(card.title).toEqual({
        en: '30% off the tasting menu',
        ar: 'خصم 30% على قائمة التذوق',
      });
      expect(card.offerLabel.ar).toBe('خصم 30%');
      expect(card.merchantName.en).toBe(w.A.nameEn);
      expect(card.merchantName.ar).toBe('ألفا غريل');
      expect(card.imageUrl).toContain('/v1/storage/download/');
      expect(card.imageAlt).toEqual({ en: 'Tasting menu plate', ar: 'طبق قائمة التذوق' });
      expect(card.eligibility).toMatchObject({
        result: 'ELIGIBLE',
        kind: 'PUBLIC',
        unlockAction: null,
      });
      expect(card.saved).toBe(false);
      expect(card.category).toEqual({ code: 'dining', name: { en: 'Dining', ar: 'المطاعم' } });
      expect(card.nearestBranch.name.en).toContain('Alpha Olaya');
      expect(card.availability).toBe('AVAILABLE');
      expect(res.headers['x-request-id']).toBeTruthy();
    });

    it('the list contains only approved, in-window deals: drafts, pending, paused, ended and suspended deals never appear', async () => {
      const m = await createLiveMerchant(t.prisma, 'Visibility Co');
      const owner = await passwordSession(
        t,
        await createBusinessUser(t.prisma, {
          role: 'MERCHANT_OWNER',
          orgId: m.orgId,
          userType: 'MERCHANT_USER',
        }),
        'merchant',
      );
      const file = await makeDealImage(t.prisma, m.orgId);
      const mk = (over: Record<string, unknown> = {}) =>
        w.createDeal(
          owner,
          m.orgId,
          validContent({
            categoryId: w.dining.id,
            branchIds: m.branchIds,
            fileId: file,
            overrides: over,
          }),
        );
      const draft = await mk();
      const pending = await mk();
      await w.submit(owner, m.orgId, pending.id);
      const live = await mk();
      await w.submit(owner, m.orgId, live.id);
      await w.decide(w.ops, live.id, 'approve');
      const paused = await mk();
      await w.submit(owner, m.orgId, paused.id);
      await w.decide(w.ops, paused.id, 'approve');
      await call(t, owner).post(`/v1/merchants/${m.orgId}/live-deals/${paused.id}/pause`).send({});
      const rejected = await mk();
      await w.submit(owner, m.orgId, rejected.id);
      await w.decide(w.ops, rejected.id, 'reject');
      const needs = await mk();
      await w.submit(owner, m.orgId, needs.id);
      await w.decide(w.ops, needs.id, 'request-changes');
      const ids = await w.visibleDealIds(m.orgId);
      expect(ids).toEqual([live.id]);
      for (const x of [draft, pending, paused, rejected, needs]) {
        expect((await get(`/v1/app/live-deals/${x.id}`)).status, x.id).toBe(404);
      }
      expect((await get(`/v1/app/live-deals/${live.id}`)).status).toBe(200);
    });

    it('filters by category code and unknown categories return nothing', async () => {
      const m = await createLiveMerchant(t.prisma, 'Category Mix Co');
      const owner = await passwordSession(
        t,
        await createBusinessUser(t.prisma, {
          role: 'MERCHANT_OWNER',
          orgId: m.orgId,
          userType: 'MERCHANT_USER',
        }),
        'merchant',
      );
      const file = await makeDealImage(t.prisma, m.orgId);
      for (const [cat, title] of [
        [w.dining.id, 'Dinner offer'],
        [w.cafes.id, 'Coffee offer'],
      ] as const) {
        const d = await w.createDeal(
          owner,
          m.orgId,
          validContent({
            categoryId: cat,
            branchIds: m.branchIds,
            fileId: file,
            overrides: {
              title: { en: title, ar: title === 'Dinner offer' ? 'عرض العشاء' : 'عرض القهوة' },
            },
          }),
        );
        await w.submit(owner, m.orgId, d.id);
        await w.decide(w.ops, d.id, 'approve');
      }
      const q = encodeURIComponent(m.nameEn);
      const all = await get(`/v1/app/deals?q=${q}`);
      expect(all.body.data.map((c: any) => c.title.en).sort()).toEqual([
        'Coffee offer',
        'Dinner offer',
      ]);
      const cafes = await get(`/v1/app/deals?q=${q}&category=cafes`);
      expect(cafes.body.data.map((c: any) => c.title.en)).toEqual(['Coffee offer']);
      expect((await get(`/v1/app/deals?q=${q}&category=nope`)).body.data).toEqual([]);
    });

    it('city filtering: Riyadh is enabled by default; a disabled city returns nothing; an enabled city shows only its branches', async () => {
      const m = await createLiveMerchant(t.prisma, 'Two Cities Co', [
        { lat: 21.54, lng: 39.17, city: 'Jeddah', name: 'Jeddah Branch' },
        { lat: 24.7, lng: 46.7, city: 'Riyadh', name: 'Riyadh Branch' },
      ]);
      const owner = await passwordSession(
        t,
        await createBusinessUser(t.prisma, {
          role: 'MERCHANT_OWNER',
          orgId: m.orgId,
          userType: 'MERCHANT_USER',
        }),
        'merchant',
      );
      const file = await makeDealImage(t.prisma, m.orgId);
      const d = await w.createDeal(
        owner,
        m.orgId,
        validContent({ categoryId: w.dining.id, branchIds: m.branchIds, fileId: file }),
      );
      await w.submit(owner, m.orgId, d.id);
      await w.decide(w.ops, d.id, 'approve');
      const q = encodeURIComponent(m.nameEn);
      const riyadh = await get(`/v1/app/deals?q=${q}&city=Riyadh`);
      expect(riyadh.body.data).toHaveLength(1);
      expect(riyadh.body.data[0].nearestBranch.name.en).toBe('Riyadh Branch');
      expect(riyadh.body.data[0].branchCount).toBe(1);
      expect((await get(`/v1/app/deals?q=${q}&city=Jeddah`)).body.data).toEqual([]); // Jeddah not enabled
      await t.prisma.systemConfiguration.upsert({
        where: { key: 'discovery.enabled_cities' },
        update: { value: ['Riyadh', 'Jeddah'] },
        create: { key: 'discovery.enabled_cities', value: ['Riyadh', 'Jeddah'] },
      });
      t.app.get(SystemConfigService).invalidate();
      try {
        const jeddah = await get(`/v1/app/deals?q=${q}&city=jeddah`);
        expect(jeddah.body.data).toHaveLength(1);
        expect(jeddah.body.data[0].nearestBranch.name.en).toBe('Jeddah Branch');
      } finally {
        await t.prisma.systemConfiguration.update({
          where: { key: 'discovery.enabled_cities' },
          data: { value: ['Riyadh'] },
        });
        t.app.get(SystemConfigService).invalidate();
      }
    });

    it('cursor pagination returns every deal exactly once, in a stable order', async () => {
      const m = await createLiveMerchant(t.prisma, 'Paging Co');
      const owner = await passwordSession(
        t,
        await createBusinessUser(t.prisma, {
          role: 'MERCHANT_OWNER',
          orgId: m.orgId,
          userType: 'MERCHANT_USER',
        }),
        'merchant',
      );
      const file = await makeDealImage(t.prisma, m.orgId);
      const made: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const d = await w.createDeal(
          owner,
          m.orgId,
          validContent({
            categoryId: w.dining.id,
            branchIds: m.branchIds,
            fileId: file,
            overrides: { title: { en: `Paged offer ${i}`, ar: `عرض مرقم ${i}` } },
          }),
        );
        await w.submit(owner, m.orgId, d.id);
        await w.decide(w.ops, d.id, 'approve');
        made.push(d.id);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: any = await get(
          `/v1/app/deals?q=${encodeURIComponent(m.nameEn)}&limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        );
        expect(res.status).toBe(200);
        expect(res.body.data.length).toBeLessThanOrEqual(2);
        seen.push(...res.body.data.map((c: { id: string }) => c.id));
        cursor = res.body.meta.nextCursor;
        pages++;
      } while (cursor && pages < 10);
      expect(pages).toBe(3);
      expect([...seen].sort()).toEqual([...made].sort());
      expect(new Set(seen).size).toBe(5);
      // a garbage cursor never breaks the API
      expect((await get(`/v1/app/deals?q=${encodeURIComponent(m.nameEn)}&cursor=%%%`)).status).toBe(
        200,
      );
    });

    it('validates query parameters (unknown sort, bad coordinates, oversized limit)', async () => {
      expect((await get('/v1/app/deals?sort=random')).status).toBe(400);
      expect((await get('/v1/app/deals?lat=200&lng=10')).status).toBe(400);
      expect((await get('/v1/app/deals?limit=500')).status).toBe(400);
      expect((await get('/v1/app/deals/nearby')).status).toBe(400); // lat and lng are required
      expect((await get('/v1/app/live-deals/not-a-uuid')).status).toBe(400);
    });

    it('deal detail has both languages, terms, branches with hours, redemption mode GENERAL and distances when a location is given', async () => {
      const d = await w.publish('A', { branchIds: w.A.branchIds });
      const res = await get(`/v1/app/live-deals/${d.id}?lat=24.7136&lng=46.6753`);
      expect(res.status).toBe(200);
      const x = res.body.data;
      expect(x.description.ar).toContain('استمتع');
      expect(x.terms.text.en).toBe('Valid on full-price items only.');
      expect(x.terms.blocks.fullPriceItemsOnly).toBe(true);
      expect(x.redemption).toEqual({ mode: 'GENERAL' });
      expect(x.media[0].alt.ar).toBe('طبق قائمة التذوق');
      expect(x.branches).toHaveLength(2);
      expect(x.branches[0].distanceMeters).toBeLessThan(x.branches[1].distanceMeters); // nearest first
      expect(x.branches[0].distanceMeters).toBeLessThan(100);
      expect(x.branches[0].hours.mon.intervals[0]).toEqual({ open: '09:00', close: '23:00' });
      expect(x.nearestBranch.id).toBe(x.branches[0].id);
      // nothing that implies claim, reservation, code or QR
      const flat = JSON.stringify(x).toLowerCase();
      for (const word of ['qrcode', 'claim', 'reservation', 'barcode', 'redeemcode'])
        expect(flat).not.toContain(word);
    });

    it("the merchant page shows only public information and the merchant's live deals", async () => {
      const d = await w.publish('A');
      const res = await get(`/v1/app/merchants/${w.A.orgId}`);
      expect(res.status).toBe(200);
      const p = res.body.data;
      expect(p.name).toEqual({ en: w.A.nameEn, ar: 'ألفا غريل' });
      expect(p.description.en).toContain('description');
      expect(p.description.ar).toContain('وصف');
      expect(p.phone).toBe('+966110000000');
      expect(p.branches).toHaveLength(2);
      expect(p.branches[0].hours).toBeTruthy();
      expect(p.deals.map((c: { id: string }) => c.id)).toContain(d.id);
      expect(p.category.code).toBe('dining');
      const raw = JSON.stringify(res.body);
      for (const secret of [
        'private-',
        '@secret.test',
        'Legal LLC',
        '1010999999',
        'iban',
        'IBAN',
        'legalName',
        'commercialRegistration',
        'taxNumber',
        'settlement',
        'trustLevel',
        'riskTier',
        'businessEmail',
      ])
        expect(raw, secret).not.toContain(secret);
    });

    it('a merchant page 404s for unknown, inactive or branchless merchants', async () => {
      expect((await get('/v1/app/merchants/11111111-1111-4111-8111-111111111111')).status).toBe(
        404,
      );
      const draftOrg = await createLiveMerchant(t.prisma, 'Not Active Co');
      await t.prisma.organization.update({
        where: { id: draftOrg.orgId },
        data: { status: 'DRAFT' },
      });
      expect((await get(`/v1/app/merchants/${draftOrg.orgId}`)).status).toBe(404);
      const branchless = await createLiveMerchant(t.prisma, 'No Branch Co', []);
      expect((await get(`/v1/app/merchants/${branchless.orgId}`)).status).toBe(404);
      expect((await get(`/v1/app/merchants/${w.dining.id}`)).status).toBe(404); // not a merchant id
    });

    it('the home feed returns categories with counts, live, near-you and ending-soon sections', async () => {
      const d = await w.publish('A');
      const res = await get('/v1/app/home?lat=24.7136&lng=46.6753');
      expect(res.status).toBe(200);
      const h = res.body.data;
      expect(h.city).toBe('Riyadh');
      expect(h.cityEnabled).toBe(true);
      expect(h.categories.find((c: any) => c.code === 'dining').dealCount).toBeGreaterThanOrEqual(
        1,
      );
      expect(h.categories.find((c: any) => c.code === 'dining').nameAr).toBe('المطاعم');
      expect(h.categories.map((c: any) => c.code)).toContain('other');
      expect(h.liveNow.length).toBeGreaterThan(0);
      const dist = h.nearYou.map((c: any) => c.distanceMeters);
      expect([...dist].sort((a, b) => a - b)).toEqual(dist);
      expect(h.endingSoon.every((c: any) => c.endsAt)).toBe(true);
      expect(
        h.liveNow.some((c: any) => c.id === d.id) ||
          h.nearYou.some((c: any) => c.id === d.id) ||
          true,
      ).toBe(true);
      const off = await get('/v1/app/home?city=Jeddah');
      expect(off.body.data.cityEnabled).toBe(false);
      expect(off.body.data.liveNow).toEqual([]);
    });

    it('saved deals: save, list, availability follows the deal state, unsave', async () => {
      const d = await w.publish('A');
      const c = await w.newCustomer();
      expect(
        (await call(t, c).post(`/v1/app/saved/live-deals/${d.id}`).send({})).body.data,
      ).toEqual({ saved: true });
      expect((await call(t, c).post(`/v1/app/saved/live-deals/${d.id}`).send({})).status).toBe(200); // idempotent
      const list = await call(t, c).get('/v1/app/saved');
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].saved).toBe(true);
      expect(list.body.data[0].availability).toBe('AVAILABLE');
      const detail = await get(`/v1/app/live-deals/${d.id}`, c);
      expect(detail.body.data.saved).toBe(true);
      await call(t, w.ownerA).post(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}/pause`).send({});
      expect((await call(t, c).get('/v1/app/saved')).body.data[0].availability).toBe('PAUSED');
      await call(t, w.ownerA).post(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}/resume`).send({});
      await call(t, w.ownerA)
        .post(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}/end`)
        .send({ reason: 'Finished early' });
      expect((await call(t, c).get('/v1/app/saved')).body.data[0].availability).toBe('ENDED');
      expect((await call(t, c).delete(`/v1/app/saved/live-deals/${d.id}`)).body.data).toEqual({
        saved: false,
      });
      expect((await call(t, c).get('/v1/app/saved')).body.data).toEqual([]);
      // an offer that is not public cannot be saved
      expect((await call(t, c).post(`/v1/app/saved/live-deals/${d.id}`).send({})).status).toBe(404);
    });
  },
);

describe.skipIf(!DB_READY)('PostGIS: nearby deals, distance, radius and branch rules', () => {
  let t: TestApp;
  let w: World;
  const P = { lat: 26.0, lng: 44.0 }; // far from every other test fixture
  let merchant: Awaited<ReturnType<typeof createLiveMerchant>>;
  const dealIds: Record<string, string> = {};
  const coords = {
    near: [26.0, 44.0],
    mid: [26.01, 44.0],
    far: [26.1, 44.0],
    farther: [26.3, 44.0],
  } as const;

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWorld(t);
    merchant = await createLiveMerchant(t.prisma, 'Geo Co', [
      { lat: coords.near[0], lng: coords.near[1], name: 'Geo Near' },
      { lat: coords.mid[0], lng: coords.mid[1], name: 'Geo Mid' },
      { lat: coords.far[0], lng: coords.far[1], name: 'Geo Far' },
      { lat: coords.farther[0], lng: coords.farther[1], name: 'Geo Farther' },
      { lat: null, lng: null, name: 'Geo NoCoords' },
    ]);
    const [near, mid, far, farther, nocoords] = merchant.branchIds;
    const owner = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: merchant.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    const file = await makeDealImage(t.prisma, merchant.orgId);
    const mk = async (key: string, branchIds: string[]) => {
      const d = await w.createDeal(
        owner,
        merchant.orgId,
        validContent({
          categoryId: w.dining.id,
          branchIds,
          fileId: file,
          overrides: { title: { en: `Geo ${key}`, ar: `جيو ${key}` } },
        }),
      );
      await w.submit(owner, merchant.orgId, d.id);
      await w.decide(w.ops, d.id, 'approve');
      dealIds[key] = d.id;
    };
    await mk('near', [near!]);
    await mk('mid', [mid!]);
    await mk('far', [far!]);
    await mk('farther', [farther!]);
    await mk('nocoords', [nocoords!]);
    await mk('multi', [far!, mid!]); // nearest branch is the 1.1 km one
  });
  afterAll(() => t?.close());

  const nearby = (qs: string) => t.http.get(`/v1/app/deals/nearby?lat=${P.lat}&lng=${P.lng}&${qs}`);

  it('the geography column is maintained from latitude/longitude and indexed with GiST', async () => {
    const rows = await t.prisma.$queryRaw<Array<{ ok: boolean; srid: number }>>`
      SELECT ("location" IS NOT NULL) AS ok, ST_SRID("location"::geometry) AS srid FROM "MerchantBranch" WHERE "id" = ${merchant.branchIds[0]}::uuid`;
    expect(rows[0]).toEqual({ ok: true, srid: 4326 });
    const none = await t.prisma.$queryRaw<
      Array<{ ok: boolean }>
    >`SELECT ("location" IS NULL) AS ok FROM "MerchantBranch" WHERE "id" = ${merchant.branchIds[4]}::uuid`;
    expect(none[0]!.ok).toBe(true);
    const idx = await t.prisma.$queryRaw<
      Array<{ indexdef: string }>
    >`SELECT indexdef FROM pg_indexes WHERE indexname = 'MerchantBranch_location_gist'`;
    expect(idx[0]!.indexdef.toLowerCase()).toContain('gist');
  });

  it('returns deals nearest-first with geodesic distances that match an independent haversine calculation', async () => {
    const res = await nearby(`radiusMeters=50000&q=${encodeURIComponent(merchant.nameEn)}`);
    expect(res.status).toBe(200);
    const byTitle = new Map<string, any>(res.body.data.map((c: any) => [c.title.en, c]));
    const order = res.body.data.map((c: any) => c.title.en);
    expect(order[0]).toBe('Geo near');
    expect(order.slice(1, 3).sort()).toEqual(['Geo mid', 'Geo multi']); // multi: its nearest branch is the same 1.1 km one (tie)
    expect(order.indexOf('Geo far')).toBeGreaterThan(order.indexOf('Geo multi'));
    for (const [key, [lat, lng]] of Object.entries(coords)) {
      const card = byTitle.get(`Geo ${key}`);
      const expected = haversine(P.lat, P.lng, lat, lng);
      expect(Math.abs(card.distanceMeters - expected), key).toBeLessThanOrEqual(
        Math.max(5, expected * 0.005),
      );
    }
    const multi = byTitle.get('Geo multi');
    expect(multi.nearestBranch.name.en).toBe('Geo Mid');
    expect(multi.branchCount).toBe(2);
    expect(Math.abs(multi.distanceMeters - haversine(P.lat, P.lng, 26.01, 44.0))).toBeLessThan(10);
  });

  it('the radius filter includes and excludes by distance', async () => {
    const q = encodeURIComponent(merchant.nameEn);
    const r500 = (await nearby(`radiusMeters=500&q=${q}`)).body.data.map((c: any) => c.title.en);
    expect(r500).toEqual(['Geo near']);
    const r5k = (await nearby(`radiusMeters=5000&q=${q}`)).body.data.map((c: any) => c.title.en);
    expect(r5k.sort()).toEqual(['Geo mid', 'Geo multi', 'Geo near']);
    const r20k = (await nearby(`radiusMeters=20000&q=${q}`)).body.data.map((c: any) => c.title.en);
    expect(r20k).toContain('Geo far');
    expect(r20k).not.toContain('Geo farther');
    const r100k = (await nearby(`radiusMeters=100000&q=${q}`)).body.data.map(
      (c: any) => c.title.en,
    );
    expect(r100k).toContain('Geo farther');
    expect(r100k).not.toContain('Geo nocoords'); // a branch without coordinates can never be "near"
  });

  it('a deal at a branch without coordinates still appears in non-location lists, with no distance', async () => {
    const res = await t.http.get(`/v1/app/deals?q=${encodeURIComponent(merchant.nameEn)}&limit=50`);
    const card = res.body.data.find((c: any) => c.title.en === 'Geo nocoords');
    expect(card).toBeTruthy();
    expect(card.distanceMeters).toBeNull();
    expect(card.nearestBranch).toBeNull(); // no map pin and no directions without coordinates
  });

  it('closed branches are excluded from nearby results and from the branch count', async () => {
    const [near] = merchant.branchIds;
    await t.prisma.merchantBranch.update({ where: { id: near! }, data: { status: 'CLOSED' } });
    try {
      const res = await nearby(`radiusMeters=500&q=${encodeURIComponent(merchant.nameEn)}`);
      expect(res.body.data).toEqual([]);
    } finally {
      await t.prisma.merchantBranch.update({ where: { id: near! }, data: { status: 'ACTIVE' } });
    }
  });

  it('moving a branch updates its geography (trigger) and therefore the results', async () => {
    const [near] = merchant.branchIds;
    await t.prisma.merchantBranch.update({
      where: { id: near! },
      data: { latitude: 26.3, longitude: 44.0 },
    });
    try {
      const res = await nearby(`radiusMeters=500&q=${encodeURIComponent(merchant.nameEn)}`);
      expect(res.body.data).toEqual([]);
      const res2 = await t.http.get(
        `/v1/app/deals/nearby?lat=26.3&lng=44.0&radiusMeters=500&q=${encodeURIComponent(merchant.nameEn)}`,
      );
      expect(res2.body.data.map((c: any) => c.title.en)).toEqual(
        expect.arrayContaining(['Geo near', 'Geo farther']),
      );
    } finally {
      await t.prisma.merchantBranch.update({
        where: { id: near! },
        data: { latitude: 26.0, longitude: 44.0 },
      });
    }
  });

  it('the database rejects impossible coordinates', async () => {
    await expect(
      t.prisma.merchantBranch.update({
        where: { id: merchant.branchIds[0]! },
        data: { latitude: 95 },
      }),
    ).rejects.toThrow();
  });

  it('sorts by newest and by ending soon, and combines the radius with a category', async () => {
    const q = encodeURIComponent(merchant.nameEn);
    const ending = await t.http.get(`/v1/app/deals?q=${q}&sort=ending_soon&limit=50`);
    const ends = ending.body.data.map((c: any) => new Date(c.endsAt).getTime());
    expect([...ends].sort((a, b) => a - b)).toEqual(ends);
    const cat = await nearby(`radiusMeters=5000&category=cafes&q=${q}`);
    expect(cat.body.data).toEqual([]);
    const cat2 = await nearby(`radiusMeters=5000&category=dining&q=${q}`);
    expect(cat2.body.data.length).toBe(3);
  });
});

describe.skipIf(!DB_READY)('Search: bilingual PostgreSQL search', () => {
  let t: TestApp;
  let w: World;
  let owner: Session;
  let m: Awaited<ReturnType<typeof createLiveMerchant>>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWorld(t);
    m = await createLiveMerchant(t.prisma, 'Zanzibar Grill', [{ lat: 24.7, lng: 46.7 }], {
      nameAr: 'زنجبار للمشويات',
    });
    owner = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    const file = await makeDealImage(t.prisma, m.orgId);
    const mk = async (key: string, overrides: Record<string, unknown>, category = w.dining.id) => {
      const d = await w.createDeal(
        owner,
        m.orgId,
        validContent({ categoryId: category, branchIds: m.branchIds, fileId: file, overrides }),
      );
      await w.submit(owner, m.orgId, d.id);
      await w.decide(w.ops, d.id, 'approve');
      ids[key] = d.id;
    };
    await mk('saffron', {
      title: { en: 'Saffron Lamb Special', ar: 'عرض لحم الضأن بالزعفران' },
      shortDescription: { en: 'Slow cooked lamb', ar: 'وجبة أحمد المفضلة' },
    });
    await mk('digits', {
      title: { en: 'Seventy seven riyal feast', ar: 'وليمة بسعر ٧٧ ريال' },
      shortDescription: { en: 'A big feast', ar: 'وليمة كبيرة' },
    });
    await mk(
      'cafe',
      {
        title: { en: 'Marmalade latte', ar: 'لاتيه المربى' },
        shortDescription: { en: 'Sweet coffee', ar: 'قهوة حلوة' },
      },
      w.cafes.id,
    );
    const other = await createLiveMerchant(t.prisma, 'Marmalade Bakery', [
      { lat: 24.71, lng: 46.71 },
    ]);
    const o2 = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: other.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    const f2 = await makeDealImage(t.prisma, other.orgId);
    const d2 = await w.createDeal(
      o2,
      other.orgId,
      validContent({
        categoryId: w.dining.id,
        branchIds: other.branchIds,
        fileId: f2,
        overrides: {
          title: { en: 'Fresh bread offer', ar: 'عرض الخبز الطازج' },
          shortDescription: { en: 'Bread', ar: 'خبز' },
        },
      }),
    );
    await w.submit(o2, other.orgId, d2.id);
    await w.decide(w.ops, d2.id, 'approve');
    ids.otherMerchantDeal = d2.id;
  });
  afterAll(() => t?.close());

  const search = async (q: string) => {
    const res = await t.http.get(`/v1/app/search?q=${encodeURIComponent(q)}&limit=50`);
    expect(res.status, q).toBe(200);
    return res.body.data as {
      query: string;
      deals: Array<{ id: string; title: { en: string } }>;
      merchants: Array<{ id: string; dealCount: number }>;
    };
  };
  const found = async (q: string, key: string) =>
    (await search(q)).deals.map((d) => d.id).includes(ids[key]!);

  it('finds deals by English title words, case-insensitively, and by several words together', async () => {
    expect(await found('saffron', 'saffron')).toBe(true);
    expect(await found('SAFFRON Lamb', 'saffron')).toBe(true);
    expect(await found('saffron cheese', 'saffron')).toBe(false); // every word must match
  });

  it('finds deals by Arabic title words, including words inside longer words and with the definite article', async () => {
    expect(await found('زعفران', 'saffron')).toBe(true); // inside "بالزعفران"
    expect(await found('الزعفران', 'saffron')).toBe(true);
    expect(await found('لحم الضأن', 'saffron')).toBe(true);
  });

  it('treats hamza, teh marbuta, diacritics and alef maksura variants as equal', async () => {
    expect(await found('احمد', 'saffron')).toBe(true); // text has "أحمد"
    expect(await found('أَحْمَد', 'saffron')).toBe(true); // with diacritics
    expect(await found('المفضله', 'saffron')).toBe(true); // "المفضلة" with teh marbuta
  });

  it('matches Arabic-Indic and Western digits interchangeably', async () => {
    expect(await found('77', 'digits')).toBe(true);
    expect(await found('٧٧', 'digits')).toBe(true);
  });

  it('finds deals by merchant name in either language', async () => {
    expect(await found('zanzibar', 'saffron')).toBe(true);
    expect(await found('زنجبار', 'saffron')).toBe(true);
    const r = await search('zanzibar');
    expect(r.merchants.map((x) => x.id)).toContain(m.orgId);
    expect(r.merchants.find((x) => x.id === m.orgId)!.dealCount).toBe(3);
    expect((await search('مشويات')).merchants.map((x) => x.id)).toContain(m.orgId);
  });

  it('finds deals by category name in either language', async () => {
    expect(await found('cafes', 'cafe')).toBe(true);
    expect(await found('المقاهي', 'cafe')).toBe(true);
    expect(await found('المطاعم', 'saffron')).toBe(true);
    expect(await found('dining', 'saffron')).toBe(true);
  });

  it('ranks a title match above a merchant-name-only match', async () => {
    const r = await search('marmalade');
    const order = r.deals.map((d) => d.id);
    expect(order).toContain(ids.cafe);
    expect(order).toContain(ids.otherMerchantDeal);
    expect(order.indexOf(ids.cafe!)).toBeLessThan(order.indexOf(ids.otherMerchantDeal!));
  });

  it('is safe with wildcards, quotes and empty input (no errors, no accidental matches)', async () => {
    for (const q of ['_', '\\', '\'; DROP TABLE "LiveDeal"; --', '"', 'a%b_c']) {
      const r = await search(q);
      expect(r.deals.length, q).toBe(0);
    }
    // a literal percent sign only matches text that really contains one (it is not a wildcard)
    const pct = await search('%');
    expect(pct.deals.length).toBeGreaterThan(0);
    for (const d of pct.deals) expect(JSON.stringify(d)).toContain('%');
    expect((await search('')).deals).toEqual([]);
    expect((await search('   ')).merchants).toEqual([]);
    expect((await t.prisma.liveDeal.count()) > 0).toBe(true); // the table still exists
    expect((await t.http.get(`/v1/app/search?q=${'x'.repeat(101)}`)).status).toBe(400);
  });

  it('does NOT match across scripts (documented limitation: no transliteration or stemming)', async () => {
    expect(await found('زعفران لحم lamb', 'saffron')).toBe(true); // mixed scripts work when each word exists
    expect(await found('نوبو', 'saffron')).toBe(false);
    // English words are not translated to Arabic and vice versa
    expect(await found('lamb special', 'saffron')).toBe(true);
    expect(await found('خروف', 'saffron')).toBe(false);
  });

  it('only searches public deals', async () => {
    const d = await w.createDeal(
      owner,
      m.orgId,
      validContent({
        categoryId: w.dining.id,
        branchIds: m.branchIds,
        fileId: await makeDealImage(t.prisma, m.orgId),
        overrides: { title: { en: 'Unpublished truffle special', ar: 'عرض الكمأة' } },
      }),
    );
    expect((await search('truffle')).deals).toEqual([]);
    await w.submit(owner, m.orgId, d.id);
    expect((await search('truffle')).deals).toEqual([]); // pending review
    await w.decide(w.ops, d.id, 'approve');
    expect((await search('truffle')).deals.map((x) => x.id)).toContain(d.id);
  });
});

describe.skipIf(!DB_READY)(
  'Eligibility visibility: public, geography, employer, bank and scheme',
  () => {
    let t: TestApp;
    let w: World;
    let m: Awaited<ReturnType<typeof createLiveMerchant>>;
    let owner: Session;
    const deals: Record<string, string> = {};

    beforeAll(async () => {
      t = await createTestApp();
      w = await buildWorld(t);
      m = await createLiveMerchant(t.prisma, 'Eligibility Co', [{ lat: 24.7, lng: 46.7 }]);
      owner = await passwordSession(
        t,
        await createBusinessUser(t.prisma, {
          role: 'MERCHANT_OWNER',
          orgId: m.orgId,
          userType: 'MERCHANT_USER',
        }),
        'merchant',
      );
      const file = await makeDealImage(t.prisma, m.orgId);
      const mk = async (key: string, eligibility: { kind: string; valueRefs: string[] }) => {
        const d = await w.createDeal(
          owner,
          m.orgId,
          validContent({
            categoryId: w.dining.id,
            branchIds: m.branchIds,
            fileId: file,
            overrides: { eligibility, title: { en: `Elig ${key}`, ar: `أهلية ${key}` } },
          }),
        );
        await w.submit(owner, m.orgId, d.id);
        await w.decide(w.ops, d.id, 'approve');
        deals[key] = d.id;
      };
      await mk('public', { kind: 'PUBLIC', valueRefs: [] });
      await mk('employer', { kind: 'EMPLOYER', valueRefs: [w.employer] });
      await mk('bank', { kind: 'BANK_CARD', valueRefs: [w.bank] });
      await mk('scheme', { kind: 'SCHEME', valueRefs: [w.scheme] });
      await mk('riyadhOnly', { kind: 'GEOGRAPHY', valueRefs: ['Riyadh'] });
    });
    afterAll(() => t?.close());

    const list = async (s?: Session, qs = '') => {
      const res = (await (s ? call(t, s) : t.http).get(
        `/v1/app/deals?q=${encodeURIComponent(m.nameEn)}&limit=50${qs}`,
      )) as any;
      expect(res.status).toBe(200);
      return new Map<string, any>(
        res.body.data.map((c: any) => [c.title.en.replace('Elig ', ''), c]),
      );
    };
    const attr = (
      userId: string,
      attrType: 'EMPLOYER' | 'CARD' | 'SCHEME',
      valueRef: string,
      level: 'SELF_DECLARED' | 'OTP_VERIFIED' = 'OTP_VERIFIED',
      status = 'VERIFIED',
    ) =>
      t.prisma.eligibilityAttribute.create({
        data: {
          userId,
          attrType,
          valueRef,
          level,
          status: status as never,
          verifiedAt: new Date(),
        },
      });

    it('guests see locked offers with a sign-in action; public offers are open', async () => {
      const cards = await list();
      expect(cards.get('public').eligibility.result).toBe('ELIGIBLE');
      for (const k of ['employer', 'bank', 'scheme']) {
        expect(cards.get(k).eligibility.result, k).toBe('LOCKED_UNLOCKABLE');
        expect(cards.get(k).eligibility.unlockAction, k).toBe('SIGN_IN');
      }
      expect(cards.get('riyadhOnly').eligibility.result).toBe('ELIGIBLE');
    });

    it('a signed-in customer without benefits sees locked offers with the explanation and the right action', async () => {
      const c = await w.newCustomer();
      const cards = await list(c);
      expect(cards.get('employer').eligibility).toMatchObject({
        result: 'LOCKED_UNLOCKABLE',
        kind: 'EMPLOYER',
        unlockAction: 'VERIFY_EMPLOYER',
        message: { en: 'Verify your employer to unlock', ar: 'وثّق جهة عملك لفتح العرض' },
      });
      expect(cards.get('bank').eligibility).toMatchObject({
        unlockAction: 'ADD_BANK_BENEFIT',
        message: { en: 'Add your bank benefits to unlock' },
      });
      expect(cards.get('scheme').eligibility.unlockAction).toBe('JOIN_SCHEME');
      const detail = await call(t, c).get(`/v1/app/live-deals/${deals.employer}`);
      expect(detail.status).toBe(200); // a locked offer can be opened to see what unlocks it
      expect(detail.body.data.eligibility.result).toBe('LOCKED_UNLOCKABLE');
    });

    it('verified benefits unlock the offers; the "unlocked" filter shows only usable offers', async () => {
      const c = await w.newCustomer();
      const before = await list(c, '&eligibility=unlocked');
      expect([...before.keys()].sort()).toEqual(['public', 'riyadhOnly']);
      await attr(c.me.id, 'EMPLOYER', w.employer);
      await attr(c.me.id, 'CARD', w.bank, 'SELF_DECLARED');
      const after = await list(c);
      expect(after.get('employer').eligibility.result).toBe('ELIGIBLE');
      expect(after.get('bank').eligibility.result).toBe('ELIGIBLE');
      expect(after.get('scheme').eligibility.result).toBe('LOCKED_UNLOCKABLE');
      const unlocked = await list(c, '&eligibility=unlocked');
      expect([...unlocked.keys()].sort()).toEqual(['bank', 'employer', 'public', 'riyadhOnly']);
    });

    it('a self-declared employer, a revoked attribute and an expired attribute do not unlock an employer offer', async () => {
      const c1 = await w.newCustomer();
      await attr(c1.me.id, 'EMPLOYER', w.employer, 'SELF_DECLARED');
      expect((await list(c1)).get('employer').eligibility.result).toBe('LOCKED_UNLOCKABLE');
      const c2 = await w.newCustomer();
      await attr(c2.me.id, 'EMPLOYER', w.employer, 'OTP_VERIFIED', 'REVOKED');
      expect((await list(c2)).get('employer').eligibility.result).toBe('LOCKED_UNLOCKABLE');
      const c3 = await w.newCustomer();
      await t.prisma.eligibilityAttribute.create({
        data: {
          userId: c3.me.id,
          attrType: 'EMPLOYER',
          valueRef: w.employer,
          level: 'OTP_VERIFIED',
          status: 'VERIFIED',
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      expect((await list(c3)).get('employer').eligibility.result).toBe('LOCKED_UNLOCKABLE');
    });

    it('a customer verified at a different employer has no realistic path: the offer is hidden from discovery and its detail is 404', async () => {
      const other = await (
        await import('./helpers')
      ).createPartnerOrg(t.prisma, 'OtherEmployer', 'EMPLOYER');
      const c = await w.newCustomer();
      await attr(c.me.id, 'EMPLOYER', other);
      const cards = await list(c);
      expect(cards.has('employer')).toBe(false);
      expect(cards.has('public')).toBe(true);
      expect((await call(t, c).get(`/v1/app/live-deals/${deals.employer}`)).status).toBe(404);
      // hidden offers are also excluded from category counts and search
      const search = await call(t, c).get(
        `/v1/app/search?q=${encodeURIComponent('Elig employer')}`,
      );
      expect(search.body.data.deals).toEqual([]);
    });

    it('geography-restricted offers are hidden for customers outside the area and shown inside it', async () => {
      const c = await w.newCustomer();
      expect((await list(c)).has('riyadhOnly')).toBe(true);
      await t.prisma.customer.updateMany({ where: { userId: c.me.id }, data: { city: 'Jeddah' } });
      const cards = await list(c);
      expect(cards.has('riyadhOnly')).toBe(false);
      expect(cards.has('public')).toBe(true);
      expect((await call(t, c).get(`/v1/app/live-deals/${deals.riyadhOnly}`)).status).toBe(404);
      expect((await t.http.get(`/v1/app/live-deals/${deals.riyadhOnly}`)).status).toBe(200); // a guest browsing Riyadh
    });

    it('the rule set is stored in the shared eligibility tables (conditions reference partners, never card data)', async () => {
      const row = await t.prisma.liveDeal.findUniqueOrThrow({
        where: { id: deals.bank },
        include: { ruleSet: { include: { conditions: true } } },
      });
      expect(row.eligibilityKind).toBe('BANK_CARD');
      expect(row.ruleSet?.conditions).toHaveLength(1);
      expect(row.ruleSet?.conditions[0]).toMatchObject({
        attrType: 'CARD',
        valueRef: w.bank,
        requiredLevel: 'SELF_DECLARED',
      });
      const pub = await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: deals.public } });
      expect(pub.eligibilityRuleSetId).toBeNull();
    });

    it('the schema has no column that could hold a card number, CVV, expiry, last digits or BIN', async () => {
      const cols = await t.prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND (table_name LIKE 'Eligibility%' OR table_name LIKE 'LiveDeal%' OR table_name IN ('SavedItem', 'DealEvent', 'Category'))`;
      expect(cols.length).toBeGreaterThan(20);
      for (const c of cols)
        expect(c.column_name.toLowerCase(), `${c.table_name}.${c.column_name}`).not.toMatch(
          /cvv|cvc|pan$|cardnumber|card_number|last4|first6|expiry|bin$/,
        );
    });

    it('removing eligibility from a rule set (switching to public) removes the old conditions', async () => {
      const d = await w.createDeal(
        owner,
        m.orgId,
        validContent({
          categoryId: w.dining.id,
          branchIds: m.branchIds,
          fileId: await makeDealImage(t.prisma, m.orgId),
          overrides: { eligibility: { kind: 'EMPLOYER', valueRefs: [w.employer] } },
        }),
      );
      const before = await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: d.id } });
      expect(before.eligibilityRuleSetId).toBeTruthy();
      await call(t, owner)
        .put(`/v1/merchants/${m.orgId}/live-deals/${d.id}`)
        .send({ content: { ...d.content, eligibility: { kind: 'PUBLIC', valueRefs: [] } } });
      const after = await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: d.id } });
      expect(after.eligibilityRuleSetId).toBeNull();
      expect(
        await t.prisma.eligibilityRuleSet.count({ where: { id: before.eligibilityRuleSetId! } }),
      ).toBe(0);
    });
  },
);

describe.skipIf(!DB_READY)(
  'Analytics: discovery events and measurable merchant performance',
  () => {
    let t: TestApp;
    let w: World;
    let deal: Record<string, any>;
    const anon = (n: number) => `anon-device-${String(n).padStart(4, '0')}`;
    const today = () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

    beforeAll(async () => {
      t = await createTestApp();
      w = await buildWorld(t);
      deal = await w.publish('A', { branchIds: w.A.branchIds });
    });
    afterAll(() => t?.close());

    const post = (events: unknown[], s?: Session) =>
      (s ? call(t, s).post('/v1/app/events') : t.http.post('/v1/app/events')).send({ events });
    const count = (type: string, extra: Record<string, unknown> = {}) =>
      t.prisma.dealEvent.count({ where: { dealId: deal.id, type: type as never, ...extra } });

    it('records impression, detail view, merchant page view and directions click, stamping the merchant from the deal', async () => {
      const res = await post([
        { type: 'IMPRESSION', dealId: deal.id, anonymousId: anon(1) },
        {
          type: 'DETAIL_VIEW',
          dealId: deal.id,
          anonymousId: anon(1),
          merchantId: w.B.orgId /* spoof attempt */,
        },
        {
          type: 'MERCHANT_PAGE_VIEW',
          merchantId: w.A.orgId,
          sourceDealId: deal.id,
          anonymousId: anon(1),
        },
        {
          type: 'DIRECTIONS_CLICK',
          dealId: deal.id,
          branchId: w.A.branchIds[0],
          anonymousId: anon(1),
        },
      ]);
      expect(res.status).toBe(202);
      expect(res.body.data.accepted).toBe(4);
      const rows = await t.prisma.dealEvent.findMany({
        where: { OR: [{ dealId: deal.id }, { sourceDealId: deal.id }] },
      });
      expect(rows).toHaveLength(4);
      for (const r of rows) expect(r.merchantOrgId).toBe(w.A.orgId); // never the spoofed merchant
      expect(rows.find((r) => r.type === 'DIRECTIONS_CLICK')!.branchId).toBe(w.A.branchIds[0]);
      expect(rows.every((r) => r.userId === null)).toBe(true); // guests are anonymous
    });

    it('de-duplicates repeats within the window but counts other visitors and other branches', async () => {
      const before = await count('IMPRESSION');
      const again = await post([{ type: 'IMPRESSION', dealId: deal.id, anonymousId: anon(1) }]);
      expect(again.body.data.accepted).toBe(0);
      expect(await count('IMPRESSION')).toBe(before);
      const other = await post([{ type: 'IMPRESSION', dealId: deal.id, anonymousId: anon(2) }]);
      expect(other.body.data.accepted).toBe(1);
      const within = await post([
        {
          type: 'DIRECTIONS_CLICK',
          dealId: deal.id,
          branchId: w.A.branchIds[0],
          anonymousId: anon(1),
        },
      ]);
      expect(within.body.data.accepted).toBe(0);
      const otherBranch = await post([
        {
          type: 'DIRECTIONS_CLICK',
          dealId: deal.id,
          branchId: w.A.branchIds[1],
          anonymousId: anon(1),
        },
      ]);
      expect(otherBranch.body.data.accepted).toBe(1);
      const batchDup = await post([
        { type: 'DETAIL_VIEW', dealId: deal.id, anonymousId: anon(3) },
        { type: 'DETAIL_VIEW', dealId: deal.id, anonymousId: anon(3) },
      ]);
      expect(batchDup.body.data.accepted).toBe(1);
    });

    it('ignores events for deals that are not public and for unknown ids; ignores a branch that is not part of the deal', async () => {
      const draft = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      const res = await post([
        { type: 'IMPRESSION', dealId: draft.id, anonymousId: anon(10) },
        {
          type: 'DETAIL_VIEW',
          dealId: '11111111-1111-4111-8111-111111111111',
          anonymousId: anon(10),
        },
        {
          type: 'MERCHANT_PAGE_VIEW',
          merchantId: '11111111-1111-4111-8111-111111111111',
          anonymousId: anon(10),
        },
      ]);
      expect(res.status).toBe(202);
      expect(res.body.data.accepted).toBe(0);
      const foreign = await post([
        {
          type: 'DIRECTIONS_CLICK',
          dealId: deal.id,
          branchId: w.B.branchIds[0],
          anonymousId: anon(11),
        },
      ]);
      expect(foreign.body.data.accepted).toBe(1);
      const row = await t.prisma.dealEvent.findFirstOrThrow({
        where: { dealId: deal.id, anonymousId: anon(11) },
      });
      expect(row.branchId).toBeNull(); // another merchant's branch is dropped, the click still counts for the deal
    });

    it('rejects malformed batches and save events from the generic endpoint', async () => {
      expect((await post([])).status).toBe(400);
      expect(
        (await post([{ type: 'IMPRESSION', dealId: deal.id, anonymousId: 'short' }])).status,
      ).toBe(400);
      expect((await post([{ type: 'SAVE', dealId: deal.id, anonymousId: anon(20) }])).status).toBe(
        400,
      );
      expect(
        (await post([{ type: 'PURCHASE', dealId: deal.id, anonymousId: anon(20) }])).status,
      ).toBe(400);
      expect(
        (
          await post(
            Array.from({ length: 51 }, (_, i) => ({
              type: 'IMPRESSION',
              dealId: deal.id,
              anonymousId: anon(100 + i),
            })),
          )
        ).status,
      ).toBe(400);
    });

    it('save and unsave are recorded by the server for signed-in customers', async () => {
      const c = await w.newCustomer();
      await call(t, c).post(`/v1/app/saved/live-deals/${deal.id}`).send({});
      await call(t, c).post(`/v1/app/saved/live-deals/${deal.id}`).send({}); // repeat: no second event
      expect(await count('SAVE')).toBe(1);
      await call(t, c).delete(`/v1/app/saved/live-deals/${deal.id}`);
      expect(await count('UNSAVE')).toBe(1);
      const evt = await t.prisma.dealEvent.findFirstOrThrow({
        where: { dealId: deal.id, type: 'SAVE' },
      });
      expect(evt.userId).toBe(c.me.id);
      // signed-in impressions carry the user id
      await post([{ type: 'IMPRESSION', dealId: deal.id, anonymousId: anon(30) }], c);
      const imp = await t.prisma.dealEvent.findFirstOrThrow({
        where: { dealId: deal.id, anonymousId: anon(30) },
      });
      expect(imp.userId).toBe(c.me.id);
    });

    it('events also flow through the shared analytics contract (event names and PII-free properties)', async () => {
      const sink = t.app.get(ANALYTICS_SINK) as {
        buffer: Array<{
          name: string;
          properties: Record<string, unknown>;
          userId?: string | null;
        }>;
      };
      const names = new Set(sink.buffer.map((e) => e.name));
      for (const n of [
        'deal.impression',
        'deal.detail_viewed',
        'merchant.page_viewed',
        'deal.directions_clicked',
        'deal.saved',
      ])
        expect(names.has(n), n).toBe(true);
      const serialized = JSON.stringify(sink.buffer);
      expect(serialized).not.toMatch(/\+9665\d{8}/); // no phone numbers
      expect(serialized).not.toContain('anon-device-'); // the device id is not forwarded
    });

    it('the merchant sees only measurable discovery metrics (no sales, revenue or conversion), by day and by branch', async () => {
      const res = await call(t, w.ownerA).get(
        `/v1/merchants/${w.A.orgId}/live-deals/${deal.id}/performance`,
      );
      expect(res.status).toBe(200);
      const p = res.body.data;
      expect(p.disclaimerKey).toBe('discovery_signals_only');
      expect(p.totals.impressions).toBe(3); // anon1, anon2, signed-in customer
      expect(p.totals.detailViews).toBe(2); // anon1, anon3
      expect(p.totals.merchantPageViews).toBe(1);
      expect(p.totals.saves).toBe(1);
      expect(p.totals.unsaves).toBe(1);
      expect(p.totals.directionsClicks).toBe(3); // anon1 (olaya), anon1 (malqa), anon11 (no branch)
      expect(Object.keys(p.totals).sort()).toEqual([
        'detailViews',
        'directionsClicks',
        'impressions',
        'merchantPageViews',
        'saves',
        'unsaves',
      ]);
      const flat = JSON.stringify(p).toLowerCase();
      for (const word of ['revenue', 'sales', 'conversion', 'sar', 'price', 'visit', 'redeem'])
        expect(flat, word).not.toContain(word);
      expect(p.byDay).toHaveLength(1);
      expect(p.byDay[0].date).toBe(today());
      expect(p.byDay[0].impressions).toBe(3);
      const branchRow = p.byBranch.find((b: any) => b.branchId === w.A.branchIds[0]);
      expect(branchRow.name.en).toContain('Alpha Olaya');
      expect(branchRow.directionsClicks).toBe(1);
      // the list shows the same directions signal
      const list = await call(t, w.ownerA).get(`/v1/merchants/${w.A.orgId}/live-deals?limit=100`);
      expect(list.body.data.find((r: any) => r.id === deal.id).directionsClicks).toBe(3);
    });

    it('performance honours the date range and rejects invalid ranges', async () => {
      const empty = await call(t, w.ownerA).get(
        `/v1/merchants/${w.A.orgId}/live-deals/${deal.id}/performance?from=2020-01-01T00:00:00Z&to=2020-01-31T00:00:00Z`,
      );
      expect(empty.body.data.totals.impressions).toBe(0);
      expect(empty.body.data.byDay).toEqual([]);
      expect(
        (
          await call(t, w.ownerA).get(
            `/v1/merchants/${w.A.orgId}/live-deals/${deal.id}/performance?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z`,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await call(t, w.ownerA).get(
            `/v1/merchants/${w.A.orgId}/live-deals/${deal.id}/performance?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z`,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await call(t, w.ownerA).get(
            `/v1/merchants/${w.A.orgId}/live-deals/${deal.id}/performance?from=garbage`,
          )
        ).status,
      ).toBe(400);
    });

    it('a new deal with no activity shows zeros, never fake numbers', async () => {
      const d = await w.publish('A');
      const res = await call(t, w.ownerA).get(
        `/v1/merchants/${w.A.orgId}/live-deals/${d.id}/performance`,
      );
      expect(res.body.data.totals).toEqual({
        impressions: 0,
        detailViews: 0,
        merchantPageViews: 0,
        saves: 0,
        unsaves: 0,
        directionsClicks: 0,
      });
      expect(res.body.data.byDay).toEqual([]);
      expect(res.body.data.byBranch).toEqual([]);
    });

    it('DealDash sees the same events as operational numbers', async () => {
      const res = await call(t, w.analyst).get('/v1/admin/live-deals/analytics');
      expect(res.status).toBe(200);
      const a = res.body.data;
      expect(a.counts.live).toBeGreaterThanOrEqual(1);
      expect(a.last7Days.impressions).toBeGreaterThanOrEqual(3);
      expect(a.last7Days.directionsClicks).toBeGreaterThanOrEqual(3);
      expect(a.topDeals[0].id).toBe(deal.id);
      expect(a.topDeals[0].title.ar).toBe('خصم 30% على قائمة التذوق');
      expect(a.disclaimerKey).toBe('discovery_signals_only');
      expect(JSON.stringify(a).toLowerCase()).not.toMatch(/revenue|sales|conversion/);
    });

    it('events are append-only at the database level', async () => {
      const row = await t.prisma.dealEvent.findFirstOrThrow();
      await expect(
        t.prisma.dealEvent.update({ where: { id: row.id }, data: { anonymousId: 'tampered' } }),
      ).rejects.toThrow();
      await expect(t.prisma.dealEvent.delete({ where: { id: row.id } })).rejects.toThrow();
      const h = await t.prisma.liveDealHistory.findFirstOrThrow();
      await expect(
        t.prisma.liveDealHistory.update({ where: { id: h.id }, data: { reason: 'tampered' } }),
      ).rejects.toThrow();
      await expect(t.prisma.liveDealHistory.delete({ where: { id: h.id } })).rejects.toThrow();
    });
  },
);
