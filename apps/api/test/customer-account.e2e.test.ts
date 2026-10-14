import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotificationsService } from '../src/hot-deals/notifications.service';
import { SystemConfigService } from '../src/system-config/system-config.service';
import { DB_READY, createTestApp, otpSession, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';

/**
 * Customer account end to end (Blueprint §5; CS-02 profile set-up, CS-05 account, CS-06 notifications; AU-31 minimum age; NT-40
 * transactional vs optional; consents versioned and append-only): the set-up wizard, the readiness gate on reserve / buy / earn,
 * the under-age block, consent changes, notification choices honoured by push delivery, and the mobile-number change.
 */
describe.skipIf(!DB_READY)('Customer account: profile set-up, consents, notifications', () => {
  let t: TestApp;
  let w: HotWorld;
  let hot: Awaited<ReturnType<HotWorld['publishHot']>>;
  const mobile = () => `+96656${Math.floor(1000000 + Math.random() * 8999999)}`;
  const fresh = async () => otpSession(t, mobile(), 'customer', { onboarded: false });
  const me = (s: Session) => w.api(s);
  const adultDob = '1992-03-04';
  const childDob = () => {
    const d = new Date();
    return `${d.getUTCFullYear() - 16}-01-01`;
  };
  const city = async () => (await t.http.get('/v1/app/config')).body.data.defaultCity as string;

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    hot = await w.publishHot('A', 20);
  });
  afterAll(async () => {
    await t?.prisma.systemConfiguration.deleteMany({ where: { key: 'customer.onboarding' } });
    await t?.close();
  });

  async function onboard(s: Session) {
    // (build a request only after awaiting any other: supertest starts the server per request)
    const home = await city();
    await me(s).put('/v1/app/me/profile').send({ firstName: 'Sara', email: 'sara@example.com' });
    await me(s).put('/v1/app/me/profile').send({ dateOfBirth: adultDob });
    await me(s).put('/v1/app/me/profile').send({ city: home });
    return me(s)
      .put('/v1/app/me/consents')
      .send({
        source: 'ONBOARDING',
        items: [
          { kind: 'TERMS', granted: true },
          { kind: 'PRIVACY', granted: true },
        ],
      });
  }

  it('needs a signed-in customer', async () => {
    expect((await t.http.get('/v1/app/me/profile')).status).toBe(401);
  });

  it('set-up wizard: resumes at the first missing step, gates reserving until complete, welcomes once', async () => {
    const c = await fresh();
    const start = await me(c).get('/v1/app/me/profile');
    expect(start.status).toBe(200);
    expect(start.body.data.onboarding).toMatchObject({
      state: 'PHONE_VERIFIED',
      ready: false,
      nextStep: 'DETAILS',
      missing: ['DETAILS', 'BIRTH_DATE', 'CITY', 'CONSENTS'],
      minimumAge: 18,
    });
    expect(start.body.data.mobileMasked).toMatch(/•••• \d{4}$/);

    // browsing and My benefits never need the profile; reserving does
    expect((await me(c).get('/v1/app/benefits')).status).toBe(200);
    const blocked = await w.reserve(c, hot.id, w.A.branchIds[0]!);
    expect(blocked.status).toBe(403);
    expect(blocked.body.errors[0].code).toBe('ONBOARDING_REQUIRED');

    const details = await me(c)
      .put('/v1/app/me/profile')
      .send({ firstName: 'Sara', lastName: 'K', email: 'Sara@Example.com' });
    expect(details.body.data).toMatchObject({ firstName: 'Sara', email: 'sara@example.com' });
    expect(details.body.data.onboarding).toMatchObject({
      state: 'PROFILE_IN_PROGRESS',
      nextStep: 'BIRTH_DATE',
    });

    const badDate = await me(c).put('/v1/app/me/profile').send({ dateOfBirth: '2001-02-30' });
    expect(badDate.status).toBe(400);
    const future = await me(c).put('/v1/app/me/profile').send({ dateOfBirth: '2999-01-01' });
    expect(future.status).toBe(400);
    const dob = await me(c).put('/v1/app/me/profile').send({ dateOfBirth: adultDob });
    expect(dob.body.data).toMatchObject({ ageVerified: true, dateOfBirth: adultDob });
    // read-only after the age check (support corrects it)
    const again = await me(c).put('/v1/app/me/profile').send({ dateOfBirth: '1980-01-01' });
    expect(again.status).toBe(409);
    expect(again.body.errors[0].code).toBe('PROFILE_DOB_LOCKED');
    // stored encrypted; the audit names fields, never values
    const row = await t.prisma.customer.findUniqueOrThrow({ where: { userId: c.me.id } });
    expect(row.dobEnc).toMatch(/^v1:/);
    expect(row.dobEnc).not.toContain('1992');
    const audits = await t.prisma.auditLog.findMany({
      where: { entityType: 'Customer', entityId: c.me.id },
    });
    expect(JSON.stringify(audits)).not.toContain(adultDob);

    // optional steps: gender (prefer not to say), interests (unknown codes dropped)
    const opt = await me(c)
      .put('/v1/app/me/profile')
      .send({ gender: 'PREFER_NOT_TO_SAY', interests: [w.dining.code, 'NOT_A_CATEGORY'] });
    expect(opt.body.data).toMatchObject({
      gender: 'PREFER_NOT_TO_SAY',
      interests: [w.dining.code],
    });
    const badCity = await me(c).put('/v1/app/me/profile').send({ city: 'Atlantis' });
    expect(badCity.status).toBe(400);
    const home = await city();
    const withCity = await me(c).put('/v1/app/me/profile').send({ city: home });
    expect(withCity.body.data.onboarding.nextStep).toBe('CONSENTS');

    // Terms and Privacy are required to finish; marketing is separate and optional
    const consent = await me(c)
      .put('/v1/app/me/consents')
      .send({
        source: 'ONBOARDING',
        items: [
          { kind: 'TERMS', granted: true },
          { kind: 'PRIVACY', granted: true },
          { kind: 'MARKETING_PUSH', granted: false },
        ],
      });
    expect(consent.body.data.onboarding).toMatchObject({
      state: 'COMPLETE',
      ready: true,
      missing: [],
      nextStep: null,
    });
    expect(consent.body.data.consents.map((x: { kind: string }) => x.kind).sort()).toEqual([
      'MARKETING_PUSH',
      'PRIVACY',
      'TERMS',
    ]);

    const ok = await w.reserve(c, hot.id, w.A.branchIds[0]!);
    expect(ok.status).toBe(201);

    // NT-02 welcome, once, even when the consents are sent again
    await me(c)
      .put('/v1/app/me/consents')
      .send({ items: [{ kind: 'TERMS', granted: true }] });
    expect(
      await t.prisma.notification.count({ where: { userId: c.me.id, type: 'ACCOUNT_WELCOME' } }),
    ).toBe(1);
    const user = await t.prisma.user.findUniqueOrThrow({ where: { id: c.me.id } });
    expect(user.displayName).toBe('Sara K');
  });

  it('new Terms version: asks the customer to accept again before reserving', async () => {
    const c = await fresh();
    expect((await onboard(c)).body.data.onboarding.ready).toBe(true);
    await t.prisma.systemConfiguration.upsert({
      where: { key: 'customer.onboarding' },
      update: { value: { termsVersion: '2099-01' } },
      create: { key: 'customer.onboarding', value: { termsVersion: '2099-01' } },
    });
    t.app.get(SystemConfigService).invalidate();
    try {
      const p = await me(c).get('/v1/app/me/profile');
      expect(p.body.data.onboarding).toMatchObject({ ready: false, consentsOutdated: true });
      const r = await w.reserve(c, hot.id, w.A.branchIds[0]!);
      expect(r.status).toBe(403);
      expect(r.body.errors[0].code).toBe('CONSENT_REQUIRED');
      const accepted = await me(c)
        .put('/v1/app/me/consents')
        .send({ items: [{ kind: 'TERMS', granted: true }] });
      expect(accepted.body.data.onboarding).toMatchObject({
        ready: true,
        consentsOutdated: false,
      });
      expect(accepted.body.data.documents.termsVersion).toBe('2099-01');
    } finally {
      await t.prisma.systemConfiguration.deleteMany({ where: { key: 'customer.onboarding' } });
      t.app.get(SystemConfigService).invalidate();
    }
  });

  it('under the minimum age: blocked, nothing kept, every action refused (AU-31)', async () => {
    const c = await fresh();
    await me(c).put('/v1/app/me/profile').send({ firstName: 'Young', email: 'young@example.com' });
    const res = await me(c).put('/v1/app/me/profile').send({ dateOfBirth: childDob() });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      firstName: null,
      email: null,
      dateOfBirth: null,
      ageVerified: false,
      onboarding: { state: 'AGE_BLOCKED', ready: false, nextStep: null },
    });
    const row = await t.prisma.customer.findUniqueOrThrow({ where: { userId: c.me.id } });
    expect(row).toMatchObject({ dobEnc: null, firstName: null, email: null });

    const again = await me(c).put('/v1/app/me/profile').send({ dateOfBirth: adultDob });
    expect(again.status).toBe(403);
    expect(again.body.errors[0].code).toBe('AGE_RESTRICTED');
    const reserve = await w.reserve(c, hot.id, w.A.branchIds[0]!);
    expect(reserve.body.errors[0].code).toBe('AGE_RESTRICTED');
    const card = await me(c)
      .post('/v1/app/benefits/employer/code')
      .send({ programId: hot.id, email: 'x@company.example' });
    expect(card.status).toBe(403);
  });

  it('consents: Terms / Privacy cannot be withdrawn; marketing changes are kept as history', async () => {
    const c = await fresh();
    await onboard(c);
    const withdraw = await me(c)
      .put('/v1/app/me/consents')
      .send({ items: [{ kind: 'TERMS', granted: false }] });
    expect(withdraw.status).toBe(400);
    await me(c)
      .put('/v1/app/me/consents')
      .send({ items: [{ kind: 'MARKETING_EMAIL', granted: true }] });
    const off = await me(c)
      .put('/v1/app/me/consents')
      .send({ items: [{ kind: 'MARKETING_EMAIL', granted: false }] });
    expect(
      off.body.data.consents.find((x: { kind: string }) => x.kind === 'MARKETING_EMAIL').granted,
    ).toBe(false);
    expect(
      await t.prisma.customerConsent.count({
        where: { userId: c.me.id, kind: 'MARKETING_EMAIL' },
      }),
    ).toBe(2);
  });

  it('notification choices: optional categories and the notifications consent are honoured by push; transactional stays on', async () => {
    const c = await fresh();
    await onboard(c);
    const initial = await me(c).get('/v1/app/me/notification-settings');
    expect(initial.body.data).toMatchObject({
      pushAllowed: true,
      marketing: { push: false, email: false },
    });
    expect(initial.body.data.categories).toEqual(
      expect.arrayContaining([
        { category: 'ORDERS', required: true, push: true },
        { category: 'REWARDS', required: false, push: true },
      ]),
    );
    const cantMute = await me(c)
      .put('/v1/app/me/notification-settings')
      .send({ categories: [{ category: 'ORDERS', push: false }] });
    expect(cantMute.status).toBe(400);
    const muted = await me(c)
      .put('/v1/app/me/notification-settings')
      .send({ categories: [{ category: 'REWARDS', push: false }] });
    expect(muted.status, JSON.stringify(muted.body)).toBe(200);
    expect(
      muted.body.data.categories.find((x: { category: string }) => x.category === 'REWARDS').push,
    ).toBe(false);

    const svc = t.app.get(NotificationsService);
    const deliver = async (type: 'REWARD_EARNED' | 'RESERVATION_CONFIRMED') => {
      const n = await t.prisma.notification.create({
        data: { userId: c.me.id, type, dedupeKey: `test:${type}:${Date.now()}:${Math.random()}` },
      });
      await svc.deliverTracked({ id: n.id, userId: c.me.id, type, data: {} });
      return t.prisma.notificationDelivery.findFirstOrThrow({
        where: { notificationId: n.id, channel: 'PUSH' },
      });
    };
    expect(await deliver('REWARD_EARNED')).toMatchObject({
      status: 'SUPPRESSED',
      suppressedReason: 'PREFERENCE',
    });
    expect((await deliver('RESERVATION_CONFIRMED')).status).not.toBe('SUPPRESSED');

    await me(c)
      .put('/v1/app/me/consents')
      .send({ items: [{ kind: 'NOTIFICATIONS', granted: false }] });
    expect(await deliver('RESERVATION_CONFIRMED')).toMatchObject({
      status: 'SUPPRESSED',
      suppressedReason: 'CONSENT_WITHDRAWN',
    });
    expect((await me(c).get('/v1/app/me/notification-settings')).body.data.pushAllowed).toBe(false);
  });

  it('mobile number change by code to the new number; a number of another account is refused', async () => {
    const c = await fresh();
    await onboard(c);
    const next = mobile();
    const start = await me(c).post('/v1/app/me/mobile/code').send({ mobile: next });
    expect(start.status).toBe(200);
    const code = /\b(\d{6})\b/.exec(t.sms.lastTo(next)?.body ?? '')?.[1] ?? '';
    const wrong = await me(c)
      .post('/v1/app/me/mobile/verify')
      .send({ mobile: next, code: code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    const ok = await me(c).post('/v1/app/me/mobile/verify').send({ mobile: next, code });
    expect(ok.status).toBe(200);
    expect(ok.body.data.mobileMasked.endsWith(next.slice(-4))).toBe(true);

    const other = await fresh();
    const taken = await t.prisma.user.findUniqueOrThrow({ where: { id: other.me.id } });
    // wait out the resend cool-down from the first request
    await t.prisma.otpChallenge.updateMany({
      where: { purpose: 'MOBILE_CHANGE', target: { startsWith: `mobile-change:${c.me.id}:` } },
      data: { createdAt: new Date(Date.now() - 3_600_000) },
    });
    await me(c).post('/v1/app/me/mobile/code').send({ mobile: taken.mobile });
    const code2 = /\b(\d{6})\b/.exec(t.sms.lastTo(taken.mobile!)?.body ?? '')?.[1] ?? '';
    const dup = await me(c)
      .post('/v1/app/me/mobile/verify')
      .send({ mobile: taken.mobile, code: code2 });
    expect(dup.status).toBe(409);
    expect(dup.body.errors[0].code).toBe('MOBILE_IN_USE');
  });
});
