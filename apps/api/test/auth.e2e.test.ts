import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpAt } from '../src/common/totp';
import {
  DB_READY,
  TEST_PASSWORD,
  call,
  createBusinessUser,
  createDealDashOrg,
  createMerchantOrg,
  createStaffUser,
  createTestApp,
  otpSession,
  passwordSession,
  type TestApp,
} from './helpers';

describe.skipIf(!DB_READY)('authentication foundation', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t?.close());

  it('customer: mobile OTP request, verify, /me, and session cookie is httpOnly', async () => {
    const mobile = `+96651${Math.floor(1000000 + Math.random() * 8999999)}`;
    const req = await t.http
      .post('/v1/auth/otp/request')
      .send({ mobile, audience: 'customer' })
      .expect(200);
    expect(req.body.data).toMatchObject({ sent: true });
    expect(req.body.meta.requestId).toBeTruthy();
    const code = /\b(\d{6})\b/.exec(t.sms.lastTo(mobile)!.body)![1]!;

    const res = await t.http
      .post('/v1/auth/otp/verify')
      .send({ mobile, code, audience: 'customer' })
      .expect(200);
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] as unknown as string[]);
    const sessionCookie = setCookie.find((c) => c.startsWith('dd_customer='))!;
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
    expect(res.body.data.me.userType).toBe('CUSTOMER');

    const me = await t.http
      .get('/v1/auth/me')
      .set('Cookie', sessionCookie.split(';')[0]!)
      .expect(200);
    expect(me.body.data.permissions).toContain('customer.profile.read');
    expect(me.body.data.csrfToken).toBeTruthy();
  });

  it('rejects wrong, expired, reused codes and enforces cooldown', async () => {
    const mobile = `+96652${Math.floor(1000000 + Math.random() * 8999999)}`;
    await t.http.post('/v1/auth/otp/request').send({ mobile, audience: 'customer' }).expect(200);
    // cooldown: immediate second request is rate limited
    const again = await t.http
      .post('/v1/auth/otp/request')
      .send({ mobile, audience: 'customer' })
      .expect(429);
    expect(again.body.errors[0].code).toBe('OTP_RATE_LIMITED');

    const wrong = await t.http
      .post('/v1/auth/otp/verify')
      .send({ mobile, code: '000000', audience: 'customer' });
    expect([400]).toContain(wrong.status);
    expect(wrong.body.errors[0].code).toBe('OTP_INVALID');

    const code = /\b(\d{6})\b/.exec(t.sms.lastTo(mobile)!.body)![1]!;
    await t.http
      .post('/v1/auth/otp/verify')
      .send({ mobile, code, audience: 'customer' })
      .expect(200);
    // a consumed code cannot be reused
    const reuse = await t.http
      .post('/v1/auth/otp/verify')
      .send({ mobile, code, audience: 'customer' })
      .expect(400);
    expect(reuse.body.errors[0].code).toBe('OTP_INVALID');

    // expiry
    const m2 = `+96653${Math.floor(1000000 + Math.random() * 8999999)}`;
    await t.http
      .post('/v1/auth/otp/request')
      .send({ mobile: m2, audience: 'customer' })
      .expect(200);
    await t.prisma.otpChallenge.updateMany({
      where: { target: m2 },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const code2 = /\b(\d{6})\b/.exec(t.sms.lastTo(m2)!.body)![1]!;
    const expired = await t.http
      .post('/v1/auth/otp/verify')
      .send({ mobile: m2, code: code2, audience: 'customer' })
      .expect(400);
    expect(expired.body.errors[0].code).toBe('OTP_EXPIRED');
  });

  it('locks a challenge after the maximum number of wrong attempts', async () => {
    const mobile = `+96654${Math.floor(1000000 + Math.random() * 8999999)}`;
    await t.http.post('/v1/auth/otp/request').send({ mobile, audience: 'customer' }).expect(200);
    for (let i = 0; i < 5; i++)
      await t.http
        .post('/v1/auth/otp/verify')
        .send({ mobile, code: '111111', audience: 'customer' });
    const locked = await t.http
      .post('/v1/auth/otp/verify')
      .send({ mobile, code: '111111', audience: 'customer' })
      .expect(429);
    expect(locked.body.errors[0].code).toBe('OTP_LOCKED');
  });

  it('staff: OTP works only for existing staff; unknown numbers receive no SMS but the same response', async () => {
    const m = await createMerchantOrg(t.prisma, 'StaffAuth', 1);
    const staff = await createStaffUser(t.prisma, m.orgId, m.branchIds[0]!);
    const s = await otpSession(t, staff.mobile!, 'staff');
    expect(s.me.activeMembership.roleCode).toBe('MERCHANT_STAFF');
    expect(s.me.activeMembership.branchId).toBe(m.branchIds[0]);

    const stranger = '+966560000999';
    const before = t.sms.sent.length;
    await t.http
      .post('/v1/auth/otp/request')
      .send({ mobile: stranger, audience: 'staff' })
      .expect(200);
    expect(t.sms.sent.length).toBe(before); // nothing sent
    const res = await t.http
      .post('/v1/auth/otp/verify')
      .send({ mobile: stranger, code: '123456', audience: 'staff' });
    expect(res.status).toBe(400);
  });

  it('merchant: email + password login, failure, lockout, and audience restriction', async () => {
    const m = await createMerchantOrg(t.prisma, 'PwAuth', 1);
    const owner = await createBusinessUser(t.prisma, {
      role: 'MERCHANT_OWNER',
      orgId: m.orgId,
      userType: 'MERCHANT_USER',
    });
    const s = await passwordSession(t, owner, 'merchant');
    expect(s.me.activeMembership.roleCode).toBe('MERCHANT_OWNER');

    // a merchant user cannot sign in to the admin or partner app
    const asAdmin = await t.http
      .post('/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD, audience: 'admin' });
    expect(asAdmin.status).toBe(401);
    const asPartner = await t.http
      .post('/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD, audience: 'partner' });
    expect(asPartner.status).toBe(401);

    // wrong-app attempts count as failed attempts too (by design); start the lockout check from zero
    await t.prisma.user.update({ where: { id: owner.id }, data: { failedLoginCount: 0 } });

    // failures are uniform, then the account locks
    for (let i = 0; i < 5; i++) {
      const bad = await t.http
        .post('/v1/auth/login')
        .send({ email: owner.email, password: 'wrong-password', audience: 'merchant' });
      expect(bad.status).toBe(401);
      expect(bad.body.errors[0].code).toBe('AUTH_INVALID');
    }
    const locked = await t.http
      .post('/v1/auth/login')
      .send({ email: owner.email, password: TEST_PASSWORD, audience: 'merchant' });
    expect(locked.status).toBe(429);
  });

  it('admin: MFA is required before any protected admin call; the TOTP code unlocks the session', async () => {
    const dd = await createDealDashOrg(t.prisma);
    const admin = await createBusinessUser(t.prisma, {
      role: 'DEALDASH_SUPER_ADMIN',
      orgId: dd.id,
      userType: 'ADMIN_USER',
      mfa: true,
    });
    const s = await passwordSession(t, admin, 'admin');
    expect(s.me.mfaRequired).toBe(true);

    const blocked = await call(t, s).get('/v1/admin/organizations').expect(401);
    expect(blocked.body.errors[0].code).toBe('MFA_REQUIRED');
    // /auth/me is allowed before MFA so the UI can show the challenge
    await call(t, s).get('/v1/auth/me').expect(200);

    const bad = await call(t, s).post('/v1/auth/mfa/verify').send({ code: '000000' });
    expect([401]).toContain(bad.status);
    await call(t, s)
      .post('/v1/auth/mfa/verify')
      .send({ code: totpAt(admin.totpSecret!, Date.now()) })
      .expect(200);
    await call(t, s).get('/v1/admin/organizations').expect(200);
  });

  it('logout revokes the session; protected routes then require sign-in', async () => {
    const m = await createMerchantOrg(t.prisma, 'Logout', 1);
    const owner = await createBusinessUser(t.prisma, {
      role: 'MERCHANT_OWNER',
      orgId: m.orgId,
      userType: 'MERCHANT_USER',
    });
    const s = await passwordSession(t, owner, 'merchant');
    await call(t, s).get(`/v1/merchants/${m.orgId}`).expect(200);
    await call(t, s).post('/v1/auth/logout').send({}).expect(200);
    const after = await call(t, s).get(`/v1/merchants/${m.orgId}`);
    expect(after.status).toBe(401);
  });

  it('cookie sessions require the CSRF header on state-changing requests', async () => {
    const m = await createMerchantOrg(t.prisma, 'Csrf', 1);
    const owner = await createBusinessUser(t.prisma, {
      role: 'MERCHANT_OWNER',
      orgId: m.orgId,
      userType: 'MERCHANT_USER',
    });
    const s = await passwordSession(t, owner, 'merchant');
    const body = {
      nameEn: 'X',
      nameAr: 'س',
      addressEn: 'a',
      addressAr: 'ع',
      city: 'Riyadh',
      latitude: 24.7,
      longitude: 46.7,
    };
    const noCsrf = await t.http
      .post(`/v1/merchants/${m.orgId}/branches`)
      .set('Cookie', s.cookie)
      .set('Idempotency-Key', 'csrf-test-key-1')
      .send(body);
    expect(noCsrf.status).toBe(403);
    const ok = await call(t, s)
      .post(`/v1/merchants/${m.orgId}/branches`)
      .set('Idempotency-Key', 'csrf-test-key-2')
      .send(body);
    expect(ok.status).toBe(201);
  });

  it('unauthenticated calls to protected routes return 401 with the standard error shape', async () => {
    const res = await t.http.get('/v1/customers/me').expect(401);
    expect(res.body).toMatchObject({ errors: [{ code: 'AUTH_REQUIRED' }] });
    expect(res.body.meta.requestId).toBeTruthy();
  });
});
