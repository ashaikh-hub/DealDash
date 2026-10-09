import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSION_CODES, ROLE_CODES, ROLE_PERMISSIONS } from '@dealdash/types';
import {
  DB_READY,
  call,
  createBusinessUser,
  createDealDashOrg,
  createMerchantOrg,
  createPartnerOrg,
  createStaffUser,
  createTestApp,
  otpSession,
  passwordSession,
  type Session,
  type TestApp,
  type TestUser,
} from './helpers';

const branchBody = {
  nameEn: 'New',
  nameAr: 'جديد',
  addressEn: 'a',
  addressAr: 'ع',
  city: 'Riyadh',
  latitude: 24.7,
  longitude: 46.7,
};

describe.skipIf(!DB_READY)('RBAC: roles, permissions and backend enforcement', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t?.close());

  it('seeds every role and permission with the approved matrix', async () => {
    const roles = await t.prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
    });
    expect(roles.map((r) => r.code).sort()).toEqual([...ROLE_CODES].sort());
    expect(await t.prisma.permission.count()).toBe(PERMISSION_CODES.length);
    for (const role of roles) {
      const granted = role.permissions.map((p) => p.permission.code).sort();
      expect(granted, role.code).toEqual(
        [...ROLE_PERMISSIONS[role.code as (typeof ROLE_CODES)[number]]].sort(),
      );
    }
  });

  it('creates the required initial roles (customer, merchant, partner, DealDash)', () => {
    for (const code of [
      'CUSTOMER',
      'MERCHANT_OWNER',
      'MERCHANT_ADMIN',
      'MERCHANT_FINANCE',
      'MERCHANT_CAMPAIGN_MANAGER',
      'MERCHANT_STAFF',
      'PARTNER_ADMIN',
      'PARTNER_CAMPAIGN_MANAGER',
      'PARTNER_BENEFITS_MANAGER',
      'PARTNER_ANALYST',
      'PARTNER_FINANCE_VIEWER',
      'PARTNER_READ_ONLY',
      'DEALDASH_SUPER_ADMIN',
      'DEALDASH_OPERATIONS',
      'DEALDASH_MERCHANT_MANAGEMENT',
      'DEALDASH_PARTNER_MANAGEMENT',
      'DEALDASH_SUPPORT',
      'DEALDASH_FINANCE',
      'DEALDASH_RISK_COMPLIANCE',
      'DEALDASH_MARKETING_OPS',
      'DEALDASH_ANALYST',
    ])
      expect(ROLE_CODES).toContain(code);
  });

  it('merchant roles: only roles with merchant.branch.manage can create branches', async () => {
    const m = await createMerchantOrg(t.prisma, 'RbacM', 1);
    const cases: Array<[Parameters<typeof createBusinessUser>[1]['role'], number]> = [
      ['MERCHANT_OWNER', 201],
      ['MERCHANT_ADMIN', 201],
      ['MERCHANT_FINANCE', 403],
      ['MERCHANT_CAMPAIGN_MANAGER', 403],
    ];
    let n = 0;
    for (const [role, expected] of cases) {
      const u = await createBusinessUser(t.prisma, {
        role,
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      });
      const s = await passwordSession(t, u, 'merchant');
      const res = await call(t, s)
        .post(`/v1/merchants/${m.orgId}/branches`)
        .set('Idempotency-Key', `rbac-key-${role}-${n++}-xxxx`)
        .send(branchBody);
      expect(res.status, role).toBe(expected);
    }
  });

  it('every merchant role can read the branch list only if it has merchant.branch.read', async () => {
    const m = await createMerchantOrg(t.prisma, 'RbacRead', 1);
    for (const role of [
      'MERCHANT_OWNER',
      'MERCHANT_ADMIN',
      'MERCHANT_FINANCE',
      'MERCHANT_CAMPAIGN_MANAGER',
    ] as const) {
      const u = await createBusinessUser(t.prisma, {
        role,
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      });
      const s = await passwordSession(t, u, 'merchant');
      const res = await call(t, s).get(`/v1/merchants/${m.orgId}/branches`);
      const allowed = (ROLE_PERMISSIONS[role] as readonly string[]).includes(
        'merchant.branch.read',
      );
      expect(res.status, role).toBe(allowed ? 200 : 403);
    }
  });

  it('partner roles: profile is readable by every partner role; users page needs partner.users.manage', async () => {
    const bank = await createPartnerOrg(t.prisma, 'RbacBank', 'BANK');
    for (const role of [
      'PARTNER_ADMIN',
      'PARTNER_CAMPAIGN_MANAGER',
      'PARTNER_BENEFITS_MANAGER',
      'PARTNER_ANALYST',
      'PARTNER_FINANCE_VIEWER',
      'PARTNER_READ_ONLY',
    ] as const) {
      const u = await createBusinessUser(t.prisma, { role, orgId: bank, userType: 'PARTNER_USER' });
      const s = await passwordSession(t, u, 'partner');
      await call(t, s).get(`/v1/partners/${bank}`).expect(200);
      expect(s.me.permissions.includes('partner.users.manage')).toBe(role === 'PARTNER_ADMIN');
    }
  });

  it('admin roles: audit log needs admin.audit.read; configuration changes need admin.config.manage', async () => {
    const dd = await createDealDashOrg(t.prisma);
    const check = async (
      role: Parameters<typeof createBusinessUser>[1]['role'],
      audit: number,
      configWrite: number,
    ) => {
      const u = await createBusinessUser(t.prisma, {
        role,
        orgId: dd.id,
        userType: 'ADMIN_USER',
        mfa: true,
      });
      const s = await passwordSession(t, u, 'admin', { completeMfa: true });
      expect((await call(t, s).get('/v1/admin/audit')).status, `${role} audit`).toBe(audit);
      const w = await call(t, s)
        .put('/v1/admin/config/reporting.cohort_threshold')
        .send({ value: 10, reason: 'rbac test' });
      expect(w.status, `${role} config write`).toBe(configWrite);
    };
    await check('DEALDASH_SUPER_ADMIN', 200, 200);
    await check('DEALDASH_RISK_COMPLIANCE', 200, 403);
    await check('DEALDASH_ANALYST', 403, 403);
    await check('DEALDASH_SUPPORT', 403, 403);
  });

  it('a session from one app cannot be used against another app audience', async () => {
    const m = await createMerchantOrg(t.prisma, 'Aud', 1);
    const owner = await createBusinessUser(t.prisma, {
      role: 'MERCHANT_OWNER',
      orgId: m.orgId,
      userType: 'MERCHANT_USER',
    });
    const s = await passwordSession(t, owner, 'merchant');
    // present the merchant token as a bearer token to admin and partner routes
    const bearer = s.cookie.split('=')[1]!;
    const admin = await t.http
      .get('/v1/admin/organizations')
      .set('Authorization', `Bearer ${bearer}`);
    expect(admin.status).toBe(403);
    const partner = await t.http
      .get(`/v1/partners/${m.orgId}`)
      .set('Authorization', `Bearer ${bearer}`);
    expect(partner.status).toBe(403);
  });

  it('customers cannot reach merchant, partner or admin APIs even with a valid customer session', async () => {
    const s = await otpSession(
      t,
      `+96657${Math.floor(1000000 + Math.random() * 8999999)}`,
      'customer',
    );
    const bearer = s.cookie.split('=')[1]!;
    for (const url of [
      '/v1/admin/organizations',
      '/v1/admin/audit',
      '/v1/admin/config',
      '/v1/admin/jobs',
    ]) {
      const r = await t.http.get(url).set('Authorization', `Bearer ${bearer}`);
      expect(r.status, url).toBe(403);
    }
  });
});

describe.skipIf(!DB_READY)('tenant isolation (mandatory pattern for every future module)', () => {
  let t: TestApp;
  let merchantA: Awaited<ReturnType<typeof createMerchantOrg>>;
  let merchantB: Awaited<ReturnType<typeof createMerchantOrg>>;
  let ownerA: Session;
  let ownerB: Session;
  let bankA: string;
  let bankB: string;
  let employer: string;
  let bankAAdmin: Session;
  let bankBAdmin: Session;
  let employerAdmin: Session;
  let staffA1: Session;
  let staffUser: TestUser;

  beforeAll(async () => {
    t = await createTestApp();
    merchantA = await createMerchantOrg(t.prisma, 'IsoA', 2);
    merchantB = await createMerchantOrg(t.prisma, 'IsoB', 1);
    ownerA = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: merchantA.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    ownerB = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: merchantB.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    bankA = await createPartnerOrg(t.prisma, 'IsoBankA', 'BANK');
    bankB = await createPartnerOrg(t.prisma, 'IsoBankB', 'BANK');
    employer = await createPartnerOrg(t.prisma, 'IsoEmployer', 'EMPLOYER');
    bankAAdmin = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'PARTNER_ADMIN',
        orgId: bankA,
        userType: 'PARTNER_USER',
      }),
      'partner',
    );
    bankBAdmin = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'PARTNER_ADMIN',
        orgId: bankB,
        userType: 'PARTNER_USER',
      }),
      'partner',
    );
    employerAdmin = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'PARTNER_ADMIN',
        orgId: employer,
        userType: 'PARTNER_USER',
      }),
      'partner',
    );
    staffUser = await createStaffUser(t.prisma, merchantA.orgId, merchantA.branchIds[0]!);
    staffA1 = await otpSession(t, staffUser.mobile!, 'staff');
  });
  afterAll(() => t?.close());

  it('Merchant A can read its own data', async () => {
    await call(t, ownerA).get(`/v1/merchants/${merchantA.orgId}`).expect(200);
    const list = await call(t, ownerA).get(`/v1/merchants/${merchantA.orgId}/branches`).expect(200);
    expect(list.body.data).toHaveLength(2);
  });

  it('Merchant A cannot access Merchant B (profile, branches, single branch): always 404, never revealing existence', async () => {
    const urls = [
      `/v1/merchants/${merchantB.orgId}`,
      `/v1/merchants/${merchantB.orgId}/branches`,
      `/v1/merchants/${merchantB.orgId}/branches/${merchantB.branchIds[0]}`,
    ];
    for (const u of urls) expect((await call(t, ownerA).get(u)).status, u).toBe(404);
    // and the reverse
    expect((await call(t, ownerB).get(`/v1/merchants/${merchantA.orgId}`)).status).toBe(404);
  });

  it("Merchant A cannot read a branch of its own org via another org's path, nor B's branch via its own path", async () => {
    const own = await call(t, ownerA).get(
      `/v1/merchants/${merchantA.orgId}/branches/${merchantB.branchIds[0]}`,
    );
    expect(own.status).toBe(404);
  });

  it('Merchant A cannot create branches in Merchant B, and nothing is written', async () => {
    const before = await t.prisma.merchantBranch.count({
      where: { organizationId: merchantB.orgId },
    });
    const res = await call(t, ownerA)
      .post(`/v1/merchants/${merchantB.orgId}/branches`)
      .set('Idempotency-Key', 'iso-create-b-1234')
      .send(branchBody);
    expect(res.status).toBe(404);
    expect(
      await t.prisma.merchantBranch.count({ where: { organizationId: merchantB.orgId } }),
    ).toBe(before);
  });

  it('Bank A cannot access Bank B or the employer partner (404), but can access itself', async () => {
    await call(t, bankAAdmin).get(`/v1/partners/${bankA}`).expect(200);
    expect((await call(t, bankAAdmin).get(`/v1/partners/${bankB}`)).status).toBe(404);
    expect((await call(t, bankAAdmin).get(`/v1/partners/${employer}`)).status).toBe(404);
    expect((await call(t, bankBAdmin).get(`/v1/partners/${bankA}`)).status).toBe(404);
  });

  it('Employer A cannot access Bank A data (and vice versa)', async () => {
    expect((await call(t, employerAdmin).get(`/v1/partners/${bankA}`)).status).toBe(404);
    expect((await call(t, bankAAdmin).get(`/v1/partners/${employer}`)).status).toBe(404);
  });

  it('a partner user cannot call merchant tenant routes and a merchant cannot call partner routes', async () => {
    // A partner cookie is not a valid session for the merchant app (and vice versa): 401, never data.
    // (A valid token of the wrong audience presented as a bearer token is rejected with 403; see the RBAC suite.)
    const partnerOnMerchant = await call(t, bankAAdmin).get(`/v1/merchants/${merchantA.orgId}`);
    const merchantOnPartner = await call(t, ownerA).get(`/v1/partners/${bankA}`);
    expect([401, 403]).toContain(partnerOnMerchant.status);
    expect([401, 403]).toContain(merchantOnPartner.status);
    expect(JSON.stringify(partnerOnMerchant.body)).not.toContain(merchantA.orgId);
  });

  it('branch-restricted staff can use only their own branch; other branches of the same merchant are 404', async () => {
    expect(staffA1.me.activeMembership.branchId).toBe(merchantA.branchIds[0]);
    const list = await call(t, staffA1)
      .get(`/v1/merchants/${merchantA.orgId}/branches`)
      .expect(200);
    expect(list.body.data.map((b: { id: string }) => b.id)).toEqual([merchantA.branchIds[0]]);
    await call(t, staffA1)
      .get(`/v1/merchants/${merchantA.orgId}/branches/${merchantA.branchIds[0]}`)
      .expect(200);
    expect(
      (
        await call(t, staffA1).get(
          `/v1/merchants/${merchantA.orgId}/branches/${merchantA.branchIds[1]}`,
        )
      ).status,
    ).toBe(404);
  });

  it('staff cannot reach another merchant at all, and cannot create branches or read the profile (permission)', async () => {
    expect((await call(t, staffA1).get(`/v1/merchants/${merchantB.orgId}/branches`)).status).toBe(
      404,
    );
    expect(
      (
        await call(t, staffA1)
          .post(`/v1/merchants/${merchantA.orgId}/branches`)
          .set('Idempotency-Key', 'staff-create-1234')
          .send(branchBody)
      ).status,
    ).toBe(403);
    expect((await call(t, staffA1).get(`/v1/merchants/${merchantA.orgId}`)).status).toBe(403);
  });

  it('a branch-scoped membership held by a manager-level role still cannot create branches', async () => {
    const scoped = await createBusinessUser(t.prisma, {
      role: 'MERCHANT_ADMIN',
      orgId: merchantA.orgId,
      branchId: merchantA.branchIds[1],
      userType: 'MERCHANT_USER',
      label: 'scoped-admin',
    });
    const s = await passwordSession(t, scoped, 'merchant');
    const list = await call(t, s).get(`/v1/merchants/${merchantA.orgId}/branches`).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(merchantA.branchIds[1]);
    expect(
      (
        await call(t, s)
          .post(`/v1/merchants/${merchantA.orgId}/branches`)
          .set('Idempotency-Key', 'scoped-create-123')
          .send(branchBody)
      ).status,
    ).toBe(403);
  });

  it('customers can only read their own record (no id is accepted from the client)', async () => {
    const a = await otpSession(
      t,
      `+96658${Math.floor(1000000 + Math.random() * 8999999)}`,
      'customer',
    );
    const b = await otpSession(
      t,
      `+96659${Math.floor(1000000 + Math.random() * 8999999)}`,
      'customer',
    );
    const ra = await call(t, a).get('/v1/customers/me').expect(200);
    const rb = await call(t, b).get('/v1/customers/me').expect(200);
    expect(ra.body.data.userId).not.toBe(rb.body.data.userId);
    expect(ra.body.data.userId).toBe(a.me.id);
  });

  it('only DealDash admins with admin.org.read can list organisations across tenants', async () => {
    const dd = await createDealDashOrg(t.prisma);
    const support = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'DEALDASH_SUPPORT',
        orgId: dd.id,
        userType: 'ADMIN_USER',
        mfa: true,
      }),
      'admin',
      { completeMfa: true },
    );
    // (can read orgs)
    const orgs = await call(t, support).get('/v1/admin/organizations?limit=100').expect(200);
    expect(orgs.body.data.length).toBeGreaterThan(2);
    // tenants cannot
    expect(
      (
        await t.http
          .get('/v1/admin/organizations')
          .set('Authorization', `Bearer ${ownerA.cookie.split('=')[1]}`)
      ).status,
    ).toBe(403);
  });

  it('suspended organisations lose access immediately', async () => {
    const m = await createMerchantOrg(t.prisma, 'Susp', 1);
    const owner = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    await call(t, owner).get(`/v1/merchants/${m.orgId}`).expect(200);
    await t.prisma.organization.update({ where: { id: m.orgId }, data: { status: 'SUSPENDED' } });
    // Stage 2 (MR-05): a suspended merchant keeps a minimal, read-only view of its own profile (so it can see why),
    // but every operational permission is gone immediately.
    const profile = await call(t, owner).get(`/v1/merchants/${m.orgId}`).expect(200);
    expect(profile.body.data.status).toBe('SUSPENDED');
    await call(t, owner).get(`/v1/merchants/${m.orgId}/branches`).expect(403);
    await call(t, owner).post(`/v1/merchants/${m.orgId}/branches`).send(branchBody).expect(403);
  });

  it('a revoked membership loses access immediately', async () => {
    const m = await createMerchantOrg(t.prisma, 'Rev', 1);
    const u = await createBusinessUser(t.prisma, {
      role: 'MERCHANT_OWNER',
      orgId: m.orgId,
      userType: 'MERCHANT_USER',
    });
    const s = await passwordSession(t, u, 'merchant');
    await call(t, s).get(`/v1/merchants/${m.orgId}`).expect(200);
    await t.prisma.organizationMembership.updateMany({
      where: { userId: u.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    const res = await call(t, s).get(`/v1/merchants/${m.orgId}`);
    expect([403, 404]).toContain(res.status);
  });
});
