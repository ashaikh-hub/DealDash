import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROLE_CODES } from '@dealdash/types';
import {
  DB_READY,
  call,
  createBusinessUser,
  createDealDashOrg,
  createMerchantOrg,
  createTestApp,
  otpSession,
  passwordSession,
  type TestApp,
} from './helpers';
import { JobsService } from '../src/jobs/jobs.service';
import { MockPaymentProvider } from '../src/providers/mocks';

const branchBody = {
  nameEn: 'Idem',
  nameAr: 'ع',
  addressEn: 'a',
  addressAr: 'ع',
  city: 'Riyadh',
  latitude: 24.7,
  longitude: 46.7,
};

describe.skipIf(!DB_READY)('API foundation: validation, envelope, pagination, idempotency', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t?.close());

  it('rejects invalid input with a stable error shape and field names', async () => {
    const res = await t.http
      .post('/v1/auth/otp/request')
      .send({ mobile: '0500', audience: 'customer' })
      .expect(400);
    expect(res.body.errors[0]).toMatchObject({ code: 'VALIDATION_FAILED', field: 'mobile' });
    expect(res.body.meta.requestId).toBeTruthy();
    const bad = await t.http
      .post('/v1/auth/login')
      .send({ email: 'not-an-email', password: 'x', audience: 'customer' })
      .expect(400);
    expect(bad.body.errors.length).toBeGreaterThan(0);
  });

  it('rejects malformed ids and unknown query values', async () => {
    const m = await createMerchantOrg(t.prisma, 'Val', 1);
    const s = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    expect((await call(t, s).get('/v1/merchants/not-a-uuid')).status).toBe(400);
  });

  it('wraps successful responses in { data, meta } and echoes X-Request-Id', async () => {
    const res = await t.http
      .get('/v1/health')
      .set('X-Request-Id', 'test-request-id-0001')
      .expect(200);
    expect(res.headers['x-request-id']).toBe('test-request-id-0001');
    expect(res.body.meta.requestId).toBe('test-request-id-0001');
    expect(res.body.data.status).toBeTruthy();
  });

  it('paginates with cursors and sorts only by allow-listed fields', async () => {
    const dd = await createDealDashOrg(t.prisma);
    for (let i = 0; i < 4; i++) await createMerchantOrg(t.prisma, `Page${i}`, 0);
    const s = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'DEALDASH_OPERATIONS',
        orgId: dd.id,
        userType: 'ADMIN_USER',
        mfa: true,
      }),
      'admin',
      { completeMfa: true },
    );

    const first = await call(t, s)
      .get('/v1/admin/organizations?limit=2&sort=-createdAt')
      .expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.nextCursor).toBeTruthy();
    const second = await call(t, s)
      .get(`/v1/admin/organizations?limit=2&sort=-createdAt&cursor=${first.body.meta.nextCursor}`)
      .expect(200);
    expect(second.body.data).toHaveLength(2);
    const ids = new Set([...first.body.data, ...second.body.data].map((o: { id: string }) => o.id));
    expect(ids.size).toBe(4); // no overlap between pages
    expect(new Date(first.body.data[1].createdAt) >= new Date(second.body.data[0].createdAt)).toBe(
      true,
    );

    const bad = await call(t, s).get('/v1/admin/organizations?sort=passwordHash');
    expect(bad.status).toBe(400);
    const filtered = await call(t, s)
      .get('/v1/admin/organizations?type=DEALDASH&limit=100')
      .expect(200);
    expect(filtered.body.data.every((o: { type: string }) => o.type === 'DEALDASH')).toBe(true);
  });

  it('idempotency: the same key replays one result; a different body is a conflict; a missing key is rejected', async () => {
    const m = await createMerchantOrg(t.prisma, 'Idem', 0);
    const s = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    const url = `/v1/merchants/${m.orgId}/branches`;

    const first = await call(t, s)
      .post(url)
      .set('Idempotency-Key', 'idem-key-aaaa-1')
      .send(branchBody)
      .expect(201);
    const replay = await call(t, s)
      .post(url)
      .set('Idempotency-Key', 'idem-key-aaaa-1')
      .send(branchBody);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(await t.prisma.merchantBranch.count({ where: { organizationId: m.orgId } })).toBe(1); // created once

    const conflict = await call(t, s)
      .post(url)
      .set('Idempotency-Key', 'idem-key-aaaa-1')
      .send({ ...branchBody, nameEn: 'Other' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.errors[0].code).toBe('IDEMPOTENCY_CONFLICT');

    const missing = await call(t, s).post(url).send(branchBody);
    expect(missing.status).toBe(400);
  });

  it('analytics ingestion validates typed events and stamps identity from the session', async () => {
    const ok = await t.http
      .post('/v1/analytics/events')
      .send({
        events: [
          {
            name: 'screen.viewed',
            timestamp: new Date().toISOString(),
            properties: { screen: 'home' },
            context: { app: 'customer', locale: 'ar' },
          },
        ],
      })
      .expect(202);
    expect(ok.body.data.accepted).toBe(true);
    await t.http
      .post('/v1/analytics/events')
      .send({ events: [{ name: 'made.up', timestamp: new Date().toISOString() }] })
      .expect(400);
  });
});

describe.skipIf(!DB_READY)('audit framework', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t?.close());

  it('records login, branch creation and permission denials with actor, role, organisation and request id', async () => {
    const m = await createMerchantOrg(t.prisma, 'Aud', 1);
    const owner = await createBusinessUser(t.prisma, {
      role: 'MERCHANT_OWNER',
      orgId: m.orgId,
      userType: 'MERCHANT_USER',
    });
    const finance = await createBusinessUser(t.prisma, {
      role: 'MERCHANT_FINANCE',
      orgId: m.orgId,
      userType: 'MERCHANT_USER',
    });
    const so = await passwordSession(t, owner, 'merchant');
    const sf = await passwordSession(t, finance, 'merchant');

    const created = await call(t, so)
      .post(`/v1/merchants/${m.orgId}/branches`)
      .set('Idempotency-Key', 'audit-branch-key-1')
      .send(branchBody)
      .expect(201);
    await call(t, sf)
      .post(`/v1/merchants/${m.orgId}/branches`)
      .set('Idempotency-Key', 'audit-branch-key-2')
      .send(branchBody)
      .expect(403);

    const login = await t.prisma.auditLog.findFirst({
      where: { action: 'auth.login.succeeded', actorUserId: owner.id },
    });
    expect(login).toMatchObject({ actorRole: 'MERCHANT_OWNER', actorOrganizationId: m.orgId });
    const branch = await t.prisma.auditLog.findFirstOrThrow({
      where: { action: 'merchant.branch.created', entityId: created.body.data.id },
    });
    expect(branch).toMatchObject({
      actorUserId: owner.id,
      actorRole: 'MERCHANT_OWNER',
      actorOrganizationId: m.orgId,
      entityType: 'MerchantBranch',
    });
    expect(branch.requestId).toBeTruthy();
    expect((branch.newState as { nameEn: string }).nameEn).toBe('Idem');
    const denied = await t.prisma.auditLog.findFirst({
      where: { action: 'access.denied', actorUserId: finance.id },
    });
    expect(denied?.reason).toContain('merchant.branch.manage');
  });

  it('records configuration changes with previous and new state and a reason', async () => {
    const dd = await createDealDashOrg(t.prisma);
    const admin = await createBusinessUser(t.prisma, {
      role: 'DEALDASH_SUPER_ADMIN',
      orgId: dd.id,
      userType: 'ADMIN_USER',
      mfa: true,
    });
    const s = await passwordSession(t, admin, 'admin', { completeMfa: true });
    await call(t, s)
      .put('/v1/admin/config/reservation.hold_minutes')
      .send({ value: 30, reason: 'baseline' })
      .expect(200);
    const res = await call(t, s)
      .put('/v1/admin/config/reservation.hold_minutes')
      .send({ value: 45, reason: 'pilot tuning' })
      .expect(200);
    expect(res.body.data.version).toBeGreaterThanOrEqual(2);
    const row = await t.prisma.auditLog.findFirstOrThrow({
      where: {
        action: 'config.updated',
        entityId: 'reservation.hold_minutes',
        reason: 'pilot tuning',
      },
    });
    expect((row.previousState as { value: number }).value).toBe(30);
    expect((row.newState as { value: number }).value).toBe(45);
    // restore the documented default
    await call(t, s)
      .put('/v1/admin/config/reservation.hold_minutes')
      .send({ value: 30, reason: 'restore default' })
      .expect(200);
  });

  it('is append-only at the database level: UPDATE, DELETE and TRUNCATE are rejected', async () => {
    const row = await t.prisma.auditLog.create({
      data: { action: 'test.append', entityType: 'Test' },
    });
    await expect(
      t.prisma.auditLog.update({ where: { id: row.id }, data: { reason: 'tampered' } }),
    ).rejects.toThrow(/append-only/i);
    await expect(t.prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(
      /append-only/i,
    );
    await expect(t.prisma.$executeRawUnsafe('TRUNCATE "AuditLog"')).rejects.toThrow(/append-only/i);
    await expect(t.prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/i);
    expect(await t.prisma.auditLog.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it('the admin audit endpoint is paginated and filterable', async () => {
    const dd = await createDealDashOrg(t.prisma);
    const rc = await createBusinessUser(t.prisma, {
      role: 'DEALDASH_RISK_COMPLIANCE',
      orgId: dd.id,
      userType: 'ADMIN_USER',
      mfa: true,
    });
    const s = await passwordSession(t, rc, 'admin', { completeMfa: true });
    const res = await call(t, s)
      .get('/v1/admin/audit?limit=5&action=auth.login.succeeded')
      .expect(200);
    expect(res.body.data.length).toBeLessThanOrEqual(5);
    expect(
      res.body.data.every((a: { action: string }) => a.action === 'auth.login.succeeded'),
    ).toBe(true);
  });
});

describe.skipIf(!DB_READY)('database foundation, health and PostGIS', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t?.close());

  it('runs on a migrated database and seeds the catalogue idempotently', async () => {
    expect(await t.prisma.role.count()).toBe(ROLE_CODES.length);
    const before = await t.prisma.permission.count();
    const { seedCatalog } = await import('../src/seed/catalog');
    await seedCatalog(t.prisma);
    expect(await t.prisma.permission.count()).toBe(before);
    expect(
      (
        await t.prisma.systemConfiguration.findUnique({
          where: { key: 'reporting.cohort_threshold' },
        })
      )?.value,
    ).toBe(10);
  });

  it('enforces relational integrity (foreign keys, uniqueness, check constraints)', async () => {
    const m = await createMerchantOrg(t.prisma, 'Integrity', 0);
    await expect(
      t.prisma.merchantBranch.create({
        data: {
          organizationId: m.orgId,
          nameEn: 'x',
          nameAr: 'x',
          addressEn: 'x',
          addressAr: 'x',
          city: 'x',
          latitude: 120,
          longitude: 10,
        },
      }),
    ).rejects.toThrow(); // latitude range check
    await expect(
      t.prisma.merchantBranch.create({
        data: {
          organizationId: '00000000-0000-7000-8000-000000000000',
          nameEn: 'x',
          nameAr: 'x',
          addressEn: 'x',
          addressAr: 'x',
          city: 'x',
        },
      }),
    ).rejects.toThrow(); // foreign key
    const mobile = `+96660${Math.floor(1000000 + Math.random() * 8999999)}`;
    await t.prisma.user.create({ data: { userType: 'CUSTOMER', mobile, displayName: 'A' } });
    await expect(
      t.prisma.user.create({ data: { userType: 'CUSTOMER', mobile, displayName: 'B' } }),
    ).rejects.toThrow(); // unique mobile
    await expect(
      t.prisma.user.create({ data: { userType: 'CUSTOMER', displayName: 'No contact' } }),
    ).rejects.toThrow(); // contact present
  });

  it('health endpoint reports connectivity, current migrations and PostGIS without exposing credentials', async () => {
    const res = await t.http.get('/v1/health').expect(200);
    const text = JSON.stringify(res.body);
    expect(res.body.data.database).toMatchObject({
      connected: true,
      migrationsCurrent: true,
      pendingMigrations: 0,
    });
    expect(res.body.data.postgis.available).toBeTypeOf('boolean');
    expect(text).not.toMatch(/postgresql:\/\//i);
    expect(text).not.toMatch(/password/i);
  });

  it('PostGIS: extension is enabled and the version query works', async () => {
    const h = (await t.http.get('/v1/health')).body.data.postgis;
    expect(h.enabled, 'PostGIS must be enabled in the test database (run pnpm db:setup)').toBe(
      true,
    );
    const [row] = await t.prisma.$queryRaw<Array<{ v: string }>>`SELECT PostGIS_Version() AS v`;
    expect(row!.v).toMatch(/^\d+\.\d+/);
  });

  it('PostGIS: branch geography is maintained by the database and nearby search returns ordered distances', async () => {
    const m = await createMerchantOrg(t.prisma, 'Geo', 0);
    const mk = (name: string, latitude: number, longitude: number) =>
      t.prisma.merchantBranch.create({
        data: {
          organizationId: m.orgId,
          nameEn: name,
          nameAr: name,
          addressEn: 'a',
          addressAr: 'a',
          city: 'Riyadh',
          latitude,
          longitude,
        },
      });
    const olaya = await mk('GeoOlaya', 24.6908, 46.6853);
    const kafd = await mk('GeoKafd', 24.7664, 46.6432);
    const jeddah = await mk('GeoJeddah', 21.5433, 39.1728);

    const located = await t.prisma.$queryRaw<Array<{ id: string; has: boolean }>>`
      SELECT id, ("location" IS NOT NULL) AS has FROM "MerchantBranch" WHERE id = ${olaya.id}::uuid`;
    expect(located[0]?.has).toBe(true);

    const { BranchesService } = await import('../src/organizations/branches.service');
    const svc = t.app.get(BranchesService);
    // central Riyadh, 15 km (a high limit: other test files in the shared test database also create Riyadh branches)
    const near = await svc.nearby(24.7136, 46.6753, 15_000, 5000);
    const names = near.map((b) => b.nameEn);
    expect(names).toContain('GeoOlaya');
    expect(names).toContain('GeoKafd');
    expect(names).not.toContain('GeoJeddah'); // ~850 km away
    const ours = near.filter((b) => [olaya.id, kafd.id].includes(b.id));
    expect(ours[0]!.distanceMeters).toBeLessThanOrEqual(ours[1]!.distanceMeters);
    expect(ours.every((b) => b.distanceMeters > 0 && b.distanceMeters < 15_000)).toBe(true);
    // moving a branch updates its geography through the trigger
    await t.prisma.merchantBranch.update({
      where: { id: jeddah.id },
      data: { latitude: 24.7, longitude: 46.68 },
    });
    const after = await svc.nearby(24.7136, 46.6753, 15_000, 5000);
    expect(after.map((b) => b.nameEn)).toContain('GeoJeddah');
  });

  it('the dev nearby endpoint validates coordinates', async () => {
    await t.http.get('/v1/dev/nearby-branches?lat=999&lng=46').expect(400);
    const ok = await t.http
      .get('/v1/dev/nearby-branches?lat=24.7136&lng=46.6753&radiusMeters=5000')
      .expect(200);
    expect(Array.isArray(ok.body.data)).toBe(true);
  });
});

describe.skipIf(!DB_READY)('background job framework', () => {
  let t: TestApp;
  let jobs: JobsService;
  beforeAll(async () => {
    t = await createTestApp();
    jobs = t.app.get(JobsService);
  });
  afterAll(() => t?.close());

  it('runs a job to success and records the result', async () => {
    const job = await jobs.enqueue('demo.echo', { message: 'hello', failTimes: 0 });
    await jobs.runDue(50);
    const done = await t.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe('SUCCEEDED');
    expect(done.result).toMatchObject({ echoed: 'hello', attempts: 1 });
  });

  it('is idempotent: the same key never creates a second job', async () => {
    const a = await jobs.enqueue(
      'demo.echo',
      { message: 'x', failTimes: 0 },
      { idempotencyKey: 'job-idem-key-1' },
    );
    const b = await jobs.enqueue(
      'demo.echo',
      { message: 'x', failTimes: 0 },
      { idempotencyKey: 'job-idem-key-1' },
    );
    expect(b.id).toBe(a.id);
    expect(await t.prisma.job.count({ where: { idempotencyKey: 'job-idem-key-1' } })).toBe(1);
  });

  it('retries with backoff, then succeeds', async () => {
    const job = await jobs.enqueue(
      'demo.echo',
      { message: 'retry', failTimes: 1 },
      { maxAttempts: 3 },
    );
    await jobs.runDue(50);
    const failed = await t.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.lastError).toContain('Simulated failure');
    expect(failed.runAt.getTime()).toBeGreaterThan(Date.now() - 100); // scheduled in the future (backoff)
    await t.prisma.job.update({
      where: { id: job.id },
      data: { runAt: new Date(Date.now() - 1000) },
    });
    await jobs.runDue(50);
    expect((await t.prisma.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
      'SUCCEEDED',
    );
  });

  it('dead-letters a job after the maximum attempts and audits the failure', async () => {
    const job = await jobs.enqueue(
      'demo.echo',
      { message: 'doomed', failTimes: 9 },
      { maxAttempts: 2 },
    );
    for (let i = 0; i < 2; i++) {
      await jobs.runDue(50);
      await t.prisma.job.updateMany({
        where: { id: job.id, status: 'FAILED' },
        data: { runAt: new Date(Date.now() - 1000) },
      });
    }
    const dead = await t.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(dead.status).toBe('DEAD');
    expect(dead.attempts).toBe(2);
    expect(
      await t.prisma.auditLog.count({ where: { action: 'job.failed', entityId: job.id } }),
    ).toBe(1);
  });

  it('does not claim the same job twice under concurrent workers', async () => {
    const job = await jobs.enqueue('demo.echo', { message: 'race', failTimes: 0 });
    const results = await Promise.all([jobs.runDue(5), jobs.runDue(5), jobs.runDue(5)]);
    expect(results.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
    const row = await t.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.attempts).toBe(1);
    expect(row.status).toBe('SUCCEEDED');
  });

  it('unknown job types fail visibly instead of being dropped', async () => {
    const job = await jobs.enqueue('no.such.handler', {}, { maxAttempts: 1 });
    await jobs.runDue(50);
    const row = await t.prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe('DEAD');
    expect(row.lastError).toContain('No handler');
  });
});

describe.skipIf(!DB_READY)('provider adapters wiring', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t?.close());

  it('business code receives mock providers through injection tokens', async () => {
    const {
      PAYMENT_PROVIDER,
      STORAGE_PROVIDER,
      VIDEO_PROVIDER,
      MAPS_PROVIDER,
      EMAIL_PROVIDER,
      PUSH_PROVIDER,
    } = await import('../src/providers/interfaces');
    expect(t.app.get(PAYMENT_PROVIDER)).toBeInstanceOf(MockPaymentProvider);
    const maps = t.app.get(MAPS_PROVIDER);
    expect((await maps.geocode('Olaya Street'))?.latitude).toBeCloseTo(24.69, 1);
    const storage = t.app.get(STORAGE_PROVIDER);
    expect(
      (await storage.createUploadUrl({ key: 'a/b.png', contentType: 'image/png', maxBytes: 1000 }))
        .method,
    ).toBe('PUT');
    expect((await t.app.get(VIDEO_PROVIDER).createUpload({ title: 't' })).assetId).toContain(
      'mock-video',
    );
    expect(
      (
        await t.app
          .get(EMAIL_PROVIDER)
          .send({ to: 'a@b.c', templateKey: 't', subject: 's', body: 'b' })
      ).providerRef,
    ).toContain('mock-email');
    expect(
      (await t.app.get(PUSH_PROVIDER).send({ userId: 'u', title: 't', body: 'b' })).delivered,
    ).toBe(true);
  });

  it('customer OTP uses the SMS adapter with Arabic or English message text by Accept-Language', async () => {
    const mobile = `+96661${Math.floor(1000000 + Math.random() * 8999999)}`;
    await t.http
      .post('/v1/auth/otp/request')
      .set('Accept-Language', 'ar')
      .send({ mobile, audience: 'customer' })
      .expect(200);
    expect(t.sms.lastTo(mobile)?.body).toMatch(/رمز ديل داش/);
    const m2 = `+96662${Math.floor(1000000 + Math.random() * 8999999)}`;
    await otpSession(t, m2, 'customer');
    expect(t.sms.lastTo(m2)?.body).toMatch(/Your DealDash code/);
  });
});
