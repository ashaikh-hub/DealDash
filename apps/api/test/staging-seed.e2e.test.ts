import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { CONFIG_KEYS, parseApiEnv } from '@dealdash/config';
import { AUDIENCE_DEFINITIONS } from '@dealdash/types';
import { decryptField, verifyPassword } from '../src/common/crypto';
import { totpAt } from '../src/common/totp';
import { PrismaClient } from '../src/generated/prisma/client';
import { STAGING_SEED_DONE, runStagingSeed, stagingSeedProblems } from '../src/seed/staging-seed';
import { DB_READY, FIELD_KEY, createTestApp, type TestApp } from './helpers';

const PASSWORD = 'Staging-Seed-Rehearsal-2026';
const TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/**
 * Launch readiness G-2 — rehearsal of the one-off staging seed on an EMPTY database (the test database right after the run's reset).
 * The seed refuses any database that already has accounts, so this file runs on its own:
 *   DD_STAGING_SEED_REHEARSAL=1 pnpm --filter @dealdash/api exec vitest run test/staging-seed.e2e.test.ts
 * (skipped in the full suite, where other files have already written accounts).
 */
describe.skipIf(!DB_READY || process.env.DD_STAGING_SEED_REHEARSAL !== '1')(
  'Staging seed rehearsal (G-2)',
  () => {
    let prisma: PrismaClient;
    let t: TestApp | undefined;
    const uploads = new Map<string, { type: string; bytes: number }>();
    const env = () =>
      parseApiEnv({
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        SESSION_SECRET: 'test-session-secret-0123456789abcdef',
        FIELD_ENCRYPTION_KEY: FIELD_KEY,
        APP_ENV: 'staging',
        ALLOW_MOCK_PROVIDERS: 'true',
      });
    const storage = {
      createUploadUrl: async (i: { key: string; contentType: string }) => ({
        url: `memory://${i.key}`,
        method: 'PUT' as const,
        headers: { 'Content-Type': i.contentType },
        key: i.key,
        expiresAt: new Date().toISOString(),
      }),
    };
    const http = (async (url: string, init: RequestInit) => {
      uploads.set(url.slice('memory://'.length), {
        type: (init.headers as Record<string, string>)['Content-Type']!,
        bytes: (init.body as Buffer).length,
      });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    beforeAll(() => {
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: process.env.TEST_DATABASE_URL! }),
      });
    });
    afterAll(async () => {
      await t?.close();
      await prisma?.$disconnect();
    });

    it('refuses outside staging and without the Secret Manager values', async () => {
      const dev = parseApiEnv({
        ...process.env,
        DATABASE_URL: 'postgresql://x@localhost/d',
        SESSION_SECRET: 's'.repeat(32),
        FIELD_ENCRYPTION_KEY: FIELD_KEY,
        APP_ENV: 'development',
      });
      expect(
        await stagingSeedProblems(prisma, dev, { password: PASSWORD, mfaSecret: TOTP }),
      ).toEqual([expect.stringMatching(/APP_ENV must be staging/)]);
      expect(
        await stagingSeedProblems(prisma, env(), { password: 'short', mfaSecret: 'abc' }),
      ).toEqual([
        expect.stringMatching(/SEED_USER_PASSWORD/),
        expect.stringMatching(/SEED_ADMIN_TOTP_SECRET/),
      ]);
    });

    it('seeds synthetic data on an empty database, uploads the sample files and keeps Pakistan in TESTING', async () => {
      expect(await prisma.user.count()).toBe(0);
      const s = await runStagingSeed(
        prisma,
        env(),
        { password: PASSWORD, mfaSecret: TOTP },
        storage,
        http,
      );
      expect(s.accounts).toBeGreaterThan(10);
      expect(s.organizations).toBeGreaterThan(3);
      expect(s.filesUploaded).toBeGreaterThan(0);
      expect(uploads.size).toBe(s.filesUploaded);
      // every recorded seed file was uploaded under its storage key, with its recorded type
      const files = await prisma.storedFile.findMany({
        where: { storageKey: { contains: 'seed-' } },
      });
      for (const f of files) expect(uploads.get(f.storageKey)?.type).toBe(f.mimeType);

      const pk = await prisma.countryConfiguration.findUniqueOrThrow({ where: { code: 'PK' } });
      expect(pk).toMatchObject({ status: 'TESTING', currency: 'PKR', timezone: 'Asia/Karachi' });
      const markets = await prisma.systemConfiguration.findUnique({
        where: { key: CONFIG_KEYS.MARKETS },
      });
      expect(
        (markets?.value as Record<string, unknown> | undefined)?.developmentUatTestingOpen,
      ).not.toBe(true);

      // shared seed password + shared authenticator key from Secret Manager
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: 'super@dealdash.test' },
      });
      expect(await verifyPassword(PASSWORD, admin.passwordHash)).toBe(true);
      expect(decryptField(admin.mfaSecretEnc!, FIELD_KEY)).toBe(TOTP);
      expect(
        await prisma.auditLog.findFirst({ where: { action: STAGING_SEED_DONE } }),
      ).not.toBeNull();
    });

    it('runs only once', async () => {
      await expect(
        runStagingSeed(prisma, env(), { password: PASSWORD, mfaSecret: TOTP }, storage, http),
      ).rejects.toThrow(/already seeded/);
    });

    it('the seeded super admin signs in to staging with the shared password and authenticator key; seeded staff get codes in the test inbox', async () => {
      t = await createTestApp({
        APP_ENV: 'staging',
        ALLOW_MOCK_PROVIDERS: true,
        STAGING_TEST_PHONE_PREFIXES: ['+966500000'],
        STAGING_TEST_EMAIL_DOMAINS: ['test'],
      });
      const login = await t.http
        .post('/v1/auth/login')
        .send({ email: 'super@dealdash.test', password: PASSWORD, audience: 'admin' });
      expect(login.status).toBe(200);
      expect(login.body.data.mfaRequired).toBe(true);
      const cookie = ([] as string[])
        .concat(login.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith(`${AUDIENCE_DEFINITIONS.admin.cookieName}=`))!
        .split(';')[0]!;
      const mfa = await t.http
        .post('/v1/auth/mfa/verify')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', login.body.data.csrfToken)
        .send({ code: totpAt(TOTP, Date.now()) });
      expect(mfa.status).toBe(200);

      expect(
        (
          await t.http
            .post('/v1/auth/otp/request')
            .send({ mobile: '+966500000100', audience: 'staff' })
        ).status,
      ).toBe(200);
      const inbox = await t.http
        .get('/v1/admin/staging/test-inbox?recipient=%2B966500000100')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', login.body.data.csrfToken);
      expect(inbox.status).toBe(200);
      expect(inbox.body.data.items[0].code).toMatch(/^\d{6}$/);
    });
  },
);
