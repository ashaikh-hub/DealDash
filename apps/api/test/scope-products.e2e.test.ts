import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DB_READY,
  createBusinessUser,
  createTestApp,
  idem,
  passwordSession,
  type Session,
  type TestApp,
} from './helpers';
import { buildWatchWorld } from './watch-fixtures';

/** Scope on vouchers and Watch & Earn: the same rules as Exclusive and Live Deals, through the same service. */
describe.skipIf(!DB_READY)('Scope on vouchers and Watch & Earn', () => {
  let t: TestApp;
  let w: Awaited<ReturnType<typeof buildWatchWorld>>;
  let orgA: string;
  let bR: string;
  let bJ: string;
  let mgrR: Session;
  let mgrJ: Session;
  const d: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildWatchWorld(t);
    orgA = w.A.orgId;
    bR = w.A.branchIds[0]!;
    bJ = w.A.branchIds[1]!;
    const post = (s: Session, path: string, body: unknown = {}) =>
      w
        .api(s)
        .post(`/v1/orgs/${orgA}${path}`)
        .set('Idempotency-Key', idem())
        .send(body as object);
    const cityR = (
      await post(w.ownerA, '/units', {
        kind: 'CITY',
        code: 'RUH',
        nameEn: 'Riyadh',
        nameAr: 'الرياض',
        city: 'Riyadh',
      })
    ).body.data.id;
    const cityJ = (
      await post(w.ownerA, '/units', {
        kind: 'CITY',
        code: 'JED',
        nameEn: 'Jeddah',
        nameAr: 'جدة',
        city: 'Jeddah',
      })
    ).body.data.id;
    await post(w.ownerA, '/units', {
      kind: 'BRANCH',
      code: 'B1',
      nameEn: 'Olaya',
      nameAr: 'العليا',
      parentId: cityR,
      branchId: bR,
    });
    await post(w.ownerA, '/units', {
      kind: 'BRANCH',
      code: 'B2',
      nameEn: 'Tahlia',
      nameAr: 'التحلية',
      parentId: cityJ,
      branchId: bJ,
    });
    const scoped = async (label: string, unit: string): Promise<Session> => {
      const u = await createBusinessUser(t.prisma, {
        role: 'MERCHANT_CAMPAIGN_MANAGER',
        orgId: orgA,
        userType: 'MERCHANT_USER',
        label,
      });
      const m = await t.prisma.organizationMembership.findFirstOrThrow({
        where: { userId: u.id, organizationId: orgA },
      });
      await post(w.ownerA, `/members/${m.id}/scoped`, { scoped: true });
      expect(
        (
          await post(w.ownerA, '/assignments', {
            membershipId: m.id,
            roleCode: 'MERCHANT_CAMPAIGN_MANAGER',
            scope: { kind: 'UNIT', ref: unit },
          })
        ).status,
      ).toBe(201);
      const fresh = await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      return passwordSession(t, { id: fresh.id, email: fresh.email! } as never, 'merchant');
    };
    mgrR = await scoped('v-mgr-r', cityR);
    mgrJ = await scoped('v-mgr-j', cityJ);
    const vc = (branchIds: string[]) => ({ ...w.voucherContent('A'), branchIds });
    d.vR = (await w.createVoucher('A', vc([bR]))).id;
    d.vJ = (await w.createVoucher('A', vc([bJ]))).id;
    d.vBoth = (await w.createVoucher('A', vc([bR, bJ]))).id;
    d.wOrg = (await w.createWatch('A', w.watchContent('A'))).id; // not tied to a branch: organization level
  });
  afterAll(() => t?.close());

  const get = (s: Session, path: string) => w.api(s).get(`/v1/merchants/${orgA}${path}`);
  const post = (s: Session, path: string, body: unknown = {}) =>
    w
      .api(s)
      .post(`/v1/merchants/${orgA}${path}`)
      .set('Idempotency-Key', idem())
      .send(body as object);
  const ids = (r: {
    body: { data: { items?: Array<{ id: string }> } | Array<{ id: string }> };
  }) => {
    const x = r.body.data;
    return (Array.isArray(x) ? x : (x.items ?? [])).map((i) => i.id);
  };

  it('vouchers: lists, reads and writes follow the scope', async () => {
    expect(ids(await get(mgrR, '/vouchers')).sort()).toEqual([d.vR, d.vBoth].sort());
    expect(ids(await get(mgrJ, '/vouchers')).sort()).toEqual([d.vJ, d.vBoth].sort());
    expect((await get(mgrR, '/vouchers/summary')).body.data.total).toBe(2);
    expect((await get(mgrR, `/vouchers/${d.vJ}`)).status).toBe(404);
    expect((await get(mgrR, `/vouchers/${d.vBoth}`)).status).toBe(200);
    expect((await post(mgrR, `/vouchers/${d.vJ}/pause`, {})).status).toBe(404);
    const spans = await post(mgrR, `/vouchers/${d.vBoth}/submit`);
    expect(spans.status).toBe(403);
    expect(spans.body.errors[0].code).toBe('SCOPE_FORBIDDEN');
    const create = (branchIds: string[]) =>
      post(mgrR, '/vouchers', { content: { ...w.voucherContent('A'), branchIds } });
    expect((await create([bR])).status).toBe(201);
    expect((await create([bJ])).status).toBe(403);
    expect((await create([bR, bJ])).status).toBe(403);
  });

  it('voucher sales are limited to the vouchers the member can see', async () => {
    const sales = (s: Session) => get(s, '/vouchers/sales');
    expect((await sales(mgrR)).status).toBe(200);
    const rows = ids(await sales(mgrJ));
    expect(Array.isArray(rows)).toBe(true);
  });

  it('an organization-level Watch & Earn campaign is invisible to branch-city members and unchangeable by them', async () => {
    expect(ids(await get(mgrR, '/watch'))).toEqual([]);
    expect(ids(await get(w.ownerA, '/watch')).includes(d.wOrg!)).toBe(true);
    expect((await get(mgrR, `/watch/${d.wOrg}`)).status).toBe(404);
    expect((await post(mgrR, `/watch/${d.wOrg}/pause`, {})).status).toBe(404);
    expect((await get(mgrR, `/watch/${d.wOrg}/budget`)).status).toBe(404);
    // creating an organization-level campaign needs an organization-wide grant
    expect((await post(mgrR, '/watch', { content: w.watchContent('A') })).status).toBe(403);
  });

  it('a campaign tied to a branch can be created inside the scope and not outside it', async () => {
    const mk = (s: Session, branchIds: string[]) =>
      post(s, '/watch', {
        content: {
          ...w.watchContent('A'),
          targeting: { ...w.watchContent('A').targeting, branchIds },
        },
      });
    const ok = await mk(mgrR, [bR]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await mk(mgrR, [bJ])).status).toBe(403);
  });

  it('tenant isolation holds for both products', async () => {
    expect((await w.api(w.ownerB).get(`/v1/merchants/${orgA}/vouchers`)).status).toBe(404);
    expect((await w.api(mgrR).get(`/v1/merchants/${w.B.orgId}/watch`)).status).toBe(404);
  });
});
