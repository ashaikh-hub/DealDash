import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DB_READY,
  call,
  createBusinessUser,
  createLiveMerchant,
  createTestApp,
  idem,
  pngBytes,
  passwordSession,
  type TestApp,
} from './helpers';
import { buildWorld, type World } from './deal-fixtures';

describe.skipIf(!DB_READY)(
  'Live Deals: permissions and tenant isolation (enforced by the backend)',
  () => {
    let t: TestApp;
    let w: World;
    let dealA: Record<string, any>;
    beforeAll(async () => {
      t = await createTestApp();
      w = await buildWorld(t);
      dealA = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
    });
    afterAll(() => t?.close());

    const base = () => `/v1/merchants/${w.A.orgId}/live-deals`;

    it('unauthenticated callers get 401 on every deal route', async () => {
      for (const [m, p] of [
        ['get', base()],
        ['get', `${base()}/${dealA.id}`],
        ['get', '/v1/admin/live-deals'],
        ['get', '/v1/app/saved'],
      ] as const) {
        const res = await (t.http as any)[m](p);
        expect(res.status, p).toBe(401);
      }
    });

    it('read access: Owner, Admin and Campaign Manager yes; Finance, branch-scoped staff, staff app, customer and DealDash no', async () => {
      const customer = await w.newCustomer();
      // A session from another app (staff, customer, DealDash) is not even recognised on a merchant route: 401 or 403, never 200.
      const expectations: Array<[string, any, number | number[]]> = [
        ['owner', w.ownerA, 200],
        ['merchant admin', w.adminA, 200],
        ['campaign manager', w.campaignsA, 200],
        ['finance', w.financeA, 403],
        ['branch-scoped admin', w.branchScopedA, 403],
        ['staff (staff app session)', w.staffA, [401, 403]],
        ['customer', customer, [401, 403]],
        ['dealdash admin', w.ops, [401, 403]],
        ['other merchant', w.ownerB, 404],
      ];
      for (const [label, s, status] of expectations) {
        const res = await call(t, s).get(base());
        if (Array.isArray(status)) expect(status, label).toContain(res.status);
        else expect(res.status, label).toBe(status);
      }
    });

    it('write access: Finance and branch-scoped users cannot create, edit, submit, pause or end campaigns', async () => {
      const mine = await w.createDeal(w.campaignsA, w.A.orgId, w.content('A')); // Campaign Manager can manage
      expect(mine.status).toBe('DRAFT');
      const denied = [w.financeA, w.branchScopedA];
      for (const s of denied) {
        const c = await call(t, s).post(base()).set('Idempotency-Key', idem()).send({});
        expect(c.status).toBe(403);
        for (const [method, path, body] of [
          ['put', `${base()}/${mine.id}`, { content: w.content('A') }],
          ['post', `${base()}/${mine.id}/submit`, {}],
          ['post', `${base()}/${mine.id}/pause`, {}],
          ['post', `${base()}/${mine.id}/end`, { reason: 'because' }],
        ] as const) {
          const res = await (call(t, s) as any)[method](path).send(body);
          expect(res.status, `${method} ${path}`).toBe(403);
        }
      }
      const unchanged = await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: mine.id } });
      expect(unchanged.status).toBe('DRAFT');
      expect(unchanged.version).toBe(mine.version);
    });

    it('Finance has no campaign rights even for performance, media or options', async () => {
      for (const p of [
        `${base()}/${dealA.id}/performance`,
        `${base()}/${dealA.id}/preview`,
        `${base()}/${dealA.id}/history`,
        `/v1/merchants/${w.A.orgId}/deal-options`,
      ])
        expect((await call(t, w.financeA).get(p)).status, p).toBe(403);
      const intent = await call(t, w.financeA)
        .post(`/v1/merchants/${w.A.orgId}/deal-media/intent`)
        .send({ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 100 });
      expect(intent.status).toBe(403);
    });

    it("Merchant B cannot view or change Merchant A's deals: every route returns 404, and B's list never contains them", async () => {
      const b = call(t, w.ownerB);
      // B uses A's organisation id in the path
      for (const [method, path, body] of [
        ['get', `${base()}/${dealA.id}`, undefined],
        ['put', `${base()}/${dealA.id}`, { content: w.content('A') }],
        ['post', `${base()}/${dealA.id}/submit`, {}],
        ['post', `${base()}/${dealA.id}/pause`, {}],
        ['post', `${base()}/${dealA.id}/resume`, {}],
        ['post', `${base()}/${dealA.id}/end`, { reason: 'because' }],
        ['get', `${base()}/${dealA.id}/preview`, undefined],
        ['get', `${base()}/${dealA.id}/history`, undefined],
        ['get', `${base()}/${dealA.id}/performance`, undefined],
        ['get', base(), undefined],
      ] as const) {
        const res = await (b as any)[method](path).send(body);
        expect(res.status, `${method} ${path}`).toBe(404);
      }
      // B uses its OWN organisation id with A's deal id
      const own = `/v1/merchants/${w.B.orgId}/live-deals`;
      for (const [method, path, body] of [
        ['get', `${own}/${dealA.id}`, undefined],
        ['put', `${own}/${dealA.id}`, { content: w.content('B') }],
        ['post', `${own}/${dealA.id}/submit`, {}],
        ['get', `${own}/${dealA.id}/performance`, undefined],
      ] as const) {
        const res = await (b as any)[method](path).send(body);
        expect(res.status, `${method} ${path}`).toBe(404);
      }
      const list = await b.get(`${own}?limit=100`);
      expect(list.status).toBe(200);
      expect(list.body.data.some((r: { id: string }) => r.id === dealA.id)).toBe(false);
      const create = await b.post(base()).set('Idempotency-Key', idem()).send({});
      expect(create.status).toBe(404);
      const still = await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: dealA.id } });
      expect(still.version).toBe(dealA.version);
    });

    it('merchant media is tenant-scoped too (another merchant cannot read or attach it)', async () => {
      const res = await call(t, w.ownerB).get(
        `/v1/merchants/${w.B.orgId}/deal-media/${w.fileA}/url`,
      );
      expect(res.status).toBe(404);
      const ok = await call(t, w.ownerA).get(
        `/v1/merchants/${w.A.orgId}/deal-media/${w.fileA}/url`,
      );
      expect(ok.status).toBe(200);
      expect(ok.body.data.url).toContain('/v1/storage/download/');
    });

    it('a merchant that is not active yet (onboarding) or suspended has no campaign permissions', async () => {
      const m = await createLiveMerchant(t.prisma, 'Onboarding Co');
      await t.prisma.organization.update({ where: { id: m.orgId }, data: { status: 'DRAFT' } });
      const owner = await passwordSession(
        t,
        await createBusinessUser(t.prisma, {
          role: 'MERCHANT_OWNER',
          orgId: m.orgId,
          userType: 'MERCHANT_USER',
        }),
        'merchant',
      );
      expect((await call(t, owner).get(`/v1/merchants/${m.orgId}/live-deals`)).status).toBe(403);
      expect(
        (
          await call(t, owner)
            .post(`/v1/merchants/${m.orgId}/live-deals`)
            .set('Idempotency-Key', idem())
            .send({})
        ).status,
      ).toBe(403);
    });

    it('DealDash review permissions: Operations, Merchant Management, Marketing and Super Admin may review; Support and Analyst may not', async () => {
      const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      await w.submit(w.ownerA, w.A.orgId, d.id);
      for (const [label, s, status] of [
        ['operations', w.ops, 200],
        ['merchant management', w.merchantMgmt, 200],
        ['marketing ops', w.marketing, 200],
        ['super admin', w.superAdmin, 200],
        ['support', w.support, 403],
        ['analyst', w.analyst, 403],
      ] as const) {
        const res = await call(t, s).get(`/v1/admin/live-deals/${d.id}`);
        expect(res.status, label).toBe(status);
        const list = await call(t, s).get('/v1/admin/live-deals?queue=true');
        expect(list.status, `${label} list`).toBe(status);
      }
    });

    it('Support users cannot approve, reject or request changes (and the denial is audited)', async () => {
      const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      await w.submit(w.ownerA, w.A.orgId, d.id);
      for (const action of ['approve', 'reject', 'request-changes']) {
        const res = await w.decide(w.support, d.id, action);
        expect(res.status, action).toBe(403);
      }
      const row = await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe('PENDING_REVIEW');
      const denied = await t.prisma.auditLog.count({
        where: { action: 'access.denied', entityId: { contains: `/v1/admin/live-deals` } },
      });
      expect(denied).toBeGreaterThanOrEqual(1);
    });

    it('merchants and customers cannot use DealDash review routes', async () => {
      const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      await w.submit(w.ownerA, w.A.orgId, d.id);
      const customer = await w.newCustomer();
      for (const s of [w.ownerA, w.financeA, customer]) {
        expect([401, 403]).toContain((await w.decide(s, d.id, 'approve')).status);
        expect([401, 403]).toContain((await call(t, s).get('/v1/admin/live-deals')).status);
      }
      expect((await t.prisma.liveDeal.findUniqueOrThrow({ where: { id: d.id } })).status).toBe(
        'PENDING_REVIEW',
      );
    });

    it('pause, suspend and reinstate need admin.campaigns.control (Marketing can review but not control)', async () => {
      const d = await w.publish('A');
      expect((await w.decide(w.marketing, d.id, 'pause')).status).toBe(403);
      expect((await w.decide(w.marketing, d.id, 'suspend')).status).toBe(403);
      expect((await w.decide(w.support, d.id, 'suspend')).status).toBe(403);
      expect((await w.decide(w.merchantMgmt, d.id, 'pause')).status).toBe(200);
    });

    it('admin actions are reflected in the detail (the UI only offers what the backend allows)', async () => {
      const d = await w.createDeal(w.ownerA, w.A.orgId, w.content('A'));
      await w.submit(w.ownerA, w.A.orgId, d.id);
      const asMarketing = await call(t, w.marketing).get(`/v1/admin/live-deals/${d.id}`);
      expect(asMarketing.body.data.adminActions).toEqual(['approve', 'request_changes', 'reject']);
      await w.decide(w.ops, d.id, 'approve');
      const live = await call(t, w.ops).get(`/v1/admin/live-deals/${d.id}`);
      expect(live.body.data.adminActions).toEqual(['pause', 'suspend']);
      const live2 = await call(t, w.marketing).get(`/v1/admin/live-deals/${d.id}`);
      expect(live2.body.data.adminActions).toEqual([]);
    });

    it('analytics for DealDash need admin.reports.read (Support has none, Analyst does)', async () => {
      expect((await call(t, w.support).get('/v1/admin/live-deals/analytics')).status).toBe(403);
      expect((await call(t, w.analyst).get('/v1/admin/live-deals/analytics')).status).toBe(200);
      expect((await call(t, w.ops).get('/v1/admin/live-deals/analytics')).status).toBe(200);
    });

    it('guests cannot save deals; customers can only manage their own saved items', async () => {
      const d = await w.publish('A');
      expect((await t.http.post(`/v1/app/saved/live-deals/${d.id}`)).status).toBe(401);
      const c1 = await w.newCustomer();
      const c2 = await w.newCustomer();
      expect((await call(t, c1).post(`/v1/app/saved/live-deals/${d.id}`).send({})).status).toBe(
        200,
      );
      const mine = await call(t, c1).get('/v1/app/saved');
      expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(d.id);
      const theirs = await call(t, c2).get('/v1/app/saved');
      expect(theirs.body.data.map((x: { id: string }) => x.id)).not.toContain(d.id);
    });
  },
);

describe.skipIf(!DB_READY)('Live Deals: images (development storage adapter)', () => {
  let t: TestApp;
  let w: World;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWorld(t);
  });
  afterAll(() => t?.close());

  const intent = (body: Record<string, unknown>) =>
    call(t, w.ownerA).post(`/v1/merchants/${w.A.orgId}/deal-media/intent`).send(body);

  async function upload(bytes: Buffer, mime: string, name = 'photo.png') {
    const i = await intent({ fileName: name, mimeType: mime, sizeBytes: bytes.length });
    expect(i.status).toBe(200);
    const path = new URL(i.body.data.uploadUrl).pathname;
    const put = await t.http.put(path).set('Content-Type', mime).send(bytes);
    expect(put.status).toBe(200);
    return {
      fileId: i.body.data.fileId as string,
      complete: await call(t, w.ownerA)
        .post(`/v1/merchants/${w.A.orgId}/deal-media/${i.body.data.fileId}/complete`)
        .send({}),
    };
  }

  it('uploads a valid image end to end, previews it and attaches it with alt text in both languages', async () => {
    const { fileId, complete } = await upload(pngBytes(640, 400), 'image/png');
    expect(complete.status).toBe(200);
    const url = await call(t, w.ownerA).get(`/v1/merchants/${w.A.orgId}/deal-media/${fileId}/url`);
    const img = await t.http.get(new URL(url.body.data.url).pathname);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    const d = await w.createDeal(
      w.ownerA,
      w.A.orgId,
      w.content('A', { media: [{ fileId, altEn: 'A plated dish', altAr: 'طبق مقدم' }] }),
    );
    expect(d.media[0].altAr).toBe('طبق مقدم');
    expect(d.media[0].url).toContain('/v1/storage/download/');
    // replacement and removal
    const { fileId: second } = await upload(pngBytes(800, 500), 'image/png', 'second.png');
    const replaced = await call(t, w.ownerA)
      .put(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`)
      .send({
        content: { ...d.content, media: [{ fileId: second, altEn: 'Second', altAr: 'الثانية' }] },
      });
    expect(replaced.body.data.deal.media[0].fileId).toBe(second);
    const removed = await call(t, w.ownerA)
      .put(`/v1/merchants/${w.A.orgId}/live-deals/${d.id}`)
      .send({ content: { ...replaced.body.data.deal.content, media: [] } });
    expect(removed.body.data.deal.media).toEqual([]);
    expect(removed.body.data.deal.issues.some((i: { field: string }) => i.field === 'media')).toBe(
      true,
    );
  });

  it('rejects wrong types, oversized files and tiny images', async () => {
    const pdf = await intent({ fileName: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 500 });
    expect(pdf.status).toBe(400);
    expect(pdf.body.errors[0].code).toBe('FILE_INVALID');
    const gif = await intent({ fileName: 'a.gif', mimeType: 'image/gif', sizeBytes: 500 });
    expect(gif.status).toBe(400);
    const huge = await intent({
      fileName: 'big.png',
      mimeType: 'image/png',
      sizeBytes: 6 * 1024 * 1024,
    });
    expect(huge.status).toBe(400);
    expect(huge.body.errors[0].field).toBe('sizeBytes');
    const { complete } = await upload(pngBytes(100, 60), 'image/png', 'tiny.png');
    expect(complete.status).toBe(400);
    expect(complete.body.errors[0].message).toContain('too small');
  });

  it('rejects a file whose content does not match its declared type', async () => {
    const { complete } = await upload(
      Buffer.from('%PDF-1.4\n% not an image\n'),
      'image/png',
      'fake.png',
    );
    expect(complete.status).toBe(400);
    expect(complete.body.errors[0].code).toBe('FILE_INVALID');
  });

  it('an unavailable (never completed) image cannot be attached', async () => {
    const i = await intent({ fileName: 'pending.png', mimeType: 'image/png', sizeBytes: 1000 });
    const d = await w
      .api(w.ownerA)
      .post(`/v1/merchants/${w.A.orgId}/live-deals`)
      .set('Idempotency-Key', idem())
      .send({
        content: w.content('A', { media: [{ fileId: i.body.data.fileId, altEn: '', altAr: '' }] }),
      });
    expect(d.status).toBe(400);
    expect(d.body.errors[0].field).toBe('media');
  });
});

describe.skipIf(!DB_READY)('Configurable categories (bilingual)', () => {
  let t: TestApp;
  let w: World;
  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWorld(t);
  });
  afterAll(() => t?.close());

  it('seeds the development categories with Arabic and English labels', async () => {
    const res = await t.http.get('/v1/app/categories');
    expect(res.status).toBe(200);
    const codes = res.body.data.map((c: { code: string }) => c.code);
    for (const c of [
      'dining',
      'cafes',
      'shopping',
      'beauty_wellness',
      'entertainment',
      'services',
      'fitness',
      'other',
    ])
      expect(codes).toContain(c);
    for (const c of res.body.data) {
      expect(c.nameEn).toBeTruthy();
      expect(c.nameAr).toMatch(/[؀-ۿ]/);
    }
    expect(res.body.data.find((c: { code: string }) => c.code === 'dining').nameAr).toBe('المطاعم');
  });

  it('operations can read but only users with config.manage can add, rename or hide categories (audited)', async () => {
    expect((await call(t, w.ops).get('/v1/admin/categories')).status).toBe(403); // ops has no config.read
    const body = {
      code: `pets_${Date.now()}`,
      nameEn: 'Pets',
      nameAr: 'الحيوانات الأليفة',
      sortOrder: 80,
    };
    expect((await call(t, w.ops).post('/v1/admin/categories').send(body)).status).toBe(403);
    const created = await call(t, w.superAdmin).post('/v1/admin/categories').send(body);
    expect(created.status).toBe(200);
    const id = created.body.data.id;
    expect(
      (await t.http.get('/v1/app/categories')).body.data.some((c: { id: string }) => c.id === id),
    ).toBe(true);
    const dup = await call(t, w.superAdmin).post('/v1/admin/categories').send(body);
    expect(dup.status).toBe(409);
    const renamed = await call(t, w.superAdmin)
      .patch(`/v1/admin/categories/${id}`)
      .send({ nameEn: 'Pets & Care' });
    expect(renamed.body.data.nameEn).toBe('Pets & Care');
    const hidden = await call(t, w.superAdmin)
      .patch(`/v1/admin/categories/${id}`)
      .send({ active: false });
    expect(hidden.body.data.active).toBe(false);
    expect(
      (await t.http.get('/v1/app/categories')).body.data.some((c: { id: string }) => c.id === id),
    ).toBe(false);
    const audit = await t.prisma.auditLog.findMany({
      where: { entityType: 'Category', entityId: id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'category.created',
      'category.updated',
      'category.updated',
    ]);
    const bad = await call(t, w.superAdmin)
      .post('/v1/admin/categories')
      .send({ code: 'Bad Code', nameEn: 'x', nameAr: 'y' });
    expect(bad.status).toBe(400);
  });

  it('merchants choose from the active categories and the options endpoint lists them with partners and cities', async () => {
    const res = await call(t, w.ownerA).get(`/v1/merchants/${w.A.orgId}/deal-options`);
    expect(res.status).toBe(200);
    expect(res.body.data.categories.length).toBeGreaterThanOrEqual(8);
    expect(res.body.data.eligibility.cities).toContain('Riyadh');
    expect(
      res.body.data.eligibility.employers.some((e: { id: string }) => e.id === w.employer),
    ).toBe(true);
    expect(res.body.data.eligibility.banks.some((e: { id: string }) => e.id === w.bank)).toBe(true);
    expect(res.body.data.eligibility.schemes.some((e: { id: string }) => e.id === w.scheme)).toBe(
      true,
    );
  });
});
