import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMAIL_PROVIDER, type EmailProvider } from '../src/providers/interfaces';
import {
  DB_READY,
  call,
  createBusinessUser,
  createDealDashOrg,
  createTestApp,
  passwordSession,
  type Session,
  type TestApp,
} from './helpers';

const testNumber = () => `+92000000${String(Math.floor(1000 + Math.random() * 8999))}`;

/**
 * Launch readiness G-1 — the staging test inbox. Staging runs a production build with development SMS / e-mail adapters, so the
 * development inbox does not exist; messages to configured synthetic recipients are kept (encrypted, 24 h) for administrators who run
 * notification operations. Nothing else is kept, and no other tier routes or records anything.
 */
describe.skipIf(!DB_READY)('Staging test inbox (G-1)', () => {
  let staging: TestApp;
  let plain: TestApp;
  let ops: Session;
  let noPerm: Session;

  beforeAll(async () => {
    staging = await createTestApp({
      APP_ENV: 'staging',
      ALLOW_MOCK_PROVIDERS: true,
      STAGING_TEST_PHONE_PREFIXES: ['+92000000'],
      STAGING_TEST_EMAIL_DOMAINS: ['test'],
    });
    plain = await createTestApp();
    const dd = (await createDealDashOrg(staging.prisma)).id;
    ops = await passwordSession(
      staging,
      await createBusinessUser(staging.prisma, {
        role: 'DEALDASH_OPERATIONS',
        orgId: dd,
        userType: 'ADMIN_USER',
        mfa: true,
      }),
      'admin',
      { completeMfa: true },
    );
    noPerm = await passwordSession(
      staging,
      await createBusinessUser(staging.prisma, {
        role: 'DEALDASH_MERCHANT_MANAGEMENT',
        orgId: dd,
        userType: 'ADMIN_USER',
        mfa: true,
      }),
      'admin',
      { completeMfa: true },
    );
  });

  afterAll(async () => {
    await staging?.close();
    await plain?.close();
  });

  it('a tester signs in with a synthetic number: the code is kept encrypted and an administrator reads it', async () => {
    const mobile = testNumber();
    const req = await staging.http
      .post('/v1/auth/otp/request')
      .send({ mobile, audience: 'customer' });
    expect(req.status).toBe(200);

    const row = await staging.prisma.stagingTestMessage.findFirstOrThrow({
      where: { recipient: mobile },
    });
    expect(row.channel).toBe('SMS');
    expect(row.templateKey).toBe('auth.otp');
    const sent = /\b(\d{6})\b/.exec(staging.sms.lastTo(mobile)!.body)![1]!;
    expect(row.bodyEnc).not.toContain(sent); // encrypted at rest

    const inbox = await call(staging, ops).get(
      `/v1/admin/staging/test-inbox?recipient=${encodeURIComponent(mobile)}`,
    );
    expect(inbox.status).toBe(200);
    expect(inbox.body.data.retentionHours).toBe(24);
    expect(inbox.body.data.items).toHaveLength(1);
    const item = inbox.body.data.items[0];
    expect(item).toMatchObject({ channel: 'SMS', recipient: mobile, code: sent });

    // the code from the inbox signs the tester in
    const verify = await staging.http
      .post('/v1/auth/otp/verify')
      .send({ mobile, code: item.code, audience: 'customer' });
    expect(verify.status).toBe(200);

    // reading codes is audited
    const audit = await staging.prisma.auditLog.findFirst({
      where: { action: 'staging.test_inbox.read', actorUserId: ops.me.id },
    });
    expect(audit).not.toBeNull();
  });

  it('keeps nothing for a real-looking number or address; e-mail to a reserved test domain is kept', async () => {
    const real = `+92300${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
    expect(
      (await staging.http.post('/v1/auth/otp/request').send({ mobile: real, audience: 'customer' }))
        .status,
    ).toBe(200);
    expect(await staging.prisma.stagingTestMessage.count({ where: { recipient: real } })).toBe(0);

    const email = staging.app.get<EmailProvider>(EMAIL_PROVIDER);
    await email.send({
      to: 'Owner@NajdKitchen.test',
      templateKey: 'merchant.invite',
      subject: 'Invitation',
      body: 'Join: https://merchant.staging.example/invite/abc',
      locale: 'en',
    });
    await email.send({
      to: 'someone@gmail.com',
      templateKey: 'merchant.invite',
      subject: 'Invitation',
      body: 'Join: https://merchant.staging.example/invite/def',
      locale: 'en',
    });
    const inbox = await call(staging, ops).get(
      '/v1/admin/staging/test-inbox?recipient=najdkitchen',
    );
    expect(inbox.body.data.items[0]).toMatchObject({
      channel: 'EMAIL',
      recipient: 'owner@najdkitchen.test',
      subject: 'Invitation',
      link: 'https://merchant.staging.example/invite/abc',
    });
    expect(
      await staging.prisma.stagingTestMessage.count({ where: { recipient: 'someone@gmail.com' } }),
    ).toBe(0);
  });

  it('removes messages older than 24 hours', async () => {
    const old = await staging.prisma.stagingTestMessage.create({
      data: {
        channel: 'SMS',
        recipient: testNumber(),
        templateKey: 'auth.otp',
        bodyEnc: 'x',
        createdAt: new Date(Date.now() - 25 * 3600 * 1000),
      },
    });
    await staging.http
      .post('/v1/auth/otp/request')
      .send({ mobile: testNumber(), audience: 'customer' });
    expect(
      await staging.prisma.stagingTestMessage.findUnique({ where: { id: old.id } }),
    ).toBeNull();
  });

  it('only administrators who run notification operations can read it', async () => {
    expect((await call(staging, noPerm).get('/v1/admin/staging/test-inbox')).status).toBe(403);
    expect((await staging.http.get('/v1/admin/staging/test-inbox')).status).toBe(401);
  });

  it('outside staging nothing is routed and nothing is kept', async () => {
    const dd = (await createDealDashOrg(plain.prisma)).id;
    const admin = await passwordSession(
      plain,
      await createBusinessUser(plain.prisma, {
        role: 'DEALDASH_OPERATIONS',
        orgId: dd,
        userType: 'ADMIN_USER',
        mfa: true,
      }),
      'admin',
      { completeMfa: true },
    );
    expect((await call(plain, admin).get('/v1/admin/staging/test-inbox')).status).toBe(404);
    const mobile = testNumber();
    await plain.http.post('/v1/auth/otp/request').send({ mobile, audience: 'customer' });
    expect(await plain.prisma.stagingTestMessage.count({ where: { recipient: mobile } })).toBe(0);
  });
});
