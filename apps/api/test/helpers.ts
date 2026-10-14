import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CONFIG_DEFAULTS, type ApiEnv } from '@dealdash/config';
import { AUDIENCE_DEFINITIONS, type Audience, type RoleCode } from '@dealdash/types';
import { createApp } from '../src/app.factory';
import { encryptField, hashPassword } from '../src/common/crypto';
import { generateTotpSecret, totpAt } from '../src/common/totp';
import { PrismaService } from '../src/prisma/prisma.service';
import { SMS_PROVIDER } from '../src/providers/interfaces';
import { MockSmsProvider } from '../src/providers/mocks';
import { seedCatalog } from '../src/seed/catalog';
import { makeDevImagePng } from '../src/seed/png';

export const DB_READY = process.env.DD_DB_READY === '1';

export const TEST_PASSWORD = 'Test-Password-123!';
export const FIELD_KEY = 'test-field-encryption-key-0123456789abcdef';

export function testEnv(): ApiEnv {
  return {
    NODE_ENV: 'test',
    API_PORT: 0,
    API_PUBLIC_URL: 'http://localhost:4000',
    MERCHANT_APP_URL: 'http://localhost:3002',
    PARTNER_APP_URL: 'http://localhost:3004',
    DATABASE_URL: process.env.TEST_DATABASE_URL!,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    CORS_ORIGINS: ['http://localhost:3001'],
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    FIELD_ENCRYPTION_KEY: FIELD_KEY,
    SMS_PROVIDER: 'mock',
    EMAIL_PROVIDER: 'mock',
    PUSH_PROVIDER: 'mock',
    PAYMENT_PROVIDER: 'mock',
    STORAGE_PROVIDER: 'local',
    STORAGE_LOCAL_DIR: join(tmpdir(), 'dealdash-test-storage'),
    S3_REGION: 'auto',
    S3_PATH_STYLE: true,
    VIDEO_PROVIDER: 'mock',
    MAPS_PROVIDER: 'mock',
    // Stage 9
    APP_ENV: 'test',
    ALLOW_MOCK_PROVIDERS: false,
    PAYOUT_PROVIDER: 'manual',
    RATE_LIMIT_PER_MINUTE: 0,
    AUTH_RATE_LIMIT_PER_MINUTE: 0,
    TRUST_PROXY_HOPS: 0,
    LOG_FORMAT: 'pretty',
  };
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  sms: MockSmsProvider;
  http: ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestApp(overrides: Partial<ApiEnv> = {}): Promise<TestApp> {
  const app = await createApp({ ...testEnv(), ...overrides }, { logger: false });
  await app.init();
  const prisma = app.get(PrismaService);
  await seedCatalog(prisma);
  return {
    app,
    prisma,
    sms: app.get(SMS_PROVIDER) as MockSmsProvider,
    http: request(app.getHttpServer()),
    close: () => app.close(),
  };
}

const uid = () => randomBytes(4).toString('hex');

export interface Tenant {
  orgId: string;
  branchIds: string[];
}

export async function createMerchantOrg(
  prisma: PrismaService,
  label: string,
  branches = 1,
): Promise<Tenant> {
  const org = await prisma.organization.create({
    data: {
      type: 'MERCHANT',
      nameEn: `${label} ${uid()}`,
      nameAr: `${label} ع`,
      merchant: { create: { legalName: `${label} LLC` } },
    },
  });
  const branchIds: string[] = [];
  for (let i = 0; i < branches; i++) {
    const b = await prisma.merchantBranch.create({
      data: {
        organizationId: org.id,
        nameEn: `${label} Branch ${i + 1}`,
        nameAr: `${label} فرع ${i + 1}`,
        addressEn: 'Riyadh',
        addressAr: 'الرياض',
        city: 'Riyadh',
        latitude: 24.7 + i * 0.01,
        longitude: 46.7 + i * 0.01,
      },
    });
    branchIds.push(b.id);
  }
  return { orgId: org.id, branchIds };
}

export async function createPartnerOrg(
  prisma: PrismaService,
  label: string,
  partnerType: 'BANK' | 'SCHEME' | 'EMPLOYER',
) {
  const org = await prisma.organization.create({
    data: {
      type: 'PARTNER',
      nameEn: `${label} ${uid()}`,
      nameAr: `${label} ش`,
      partner: { create: { partnerType, legalName: `${label} Co.` } },
    },
  });
  return org.id;
}

export async function createDealDashOrg(prisma: PrismaService) {
  const existing = await prisma.organization.findFirst({ where: { type: 'DEALDASH' } });
  return (
    existing ??
    prisma.organization.create({
      data: { type: 'DEALDASH', nameEn: 'DealDash', nameAr: 'ديل داش' },
    })
  );
}

export interface TestUser {
  id: string;
  email?: string;
  mobile?: string;
  totpSecret?: string;
}

export async function createBusinessUser(
  prisma: PrismaService,
  args: {
    role: RoleCode;
    orgId: string;
    branchId?: string;
    userType: 'MERCHANT_USER' | 'PARTNER_USER' | 'ADMIN_USER';
    mfa?: boolean;
    label?: string;
  },
): Promise<TestUser> {
  const email = `${args.label ?? args.role.toLowerCase()}-${uid()}@test.dd`;
  const totpSecret = args.mfa ? generateTotpSecret() : undefined;
  const user = await prisma.user.create({
    data: {
      userType: args.userType,
      email,
      displayName: args.label ?? args.role,
      passwordHash: await hashPassword(TEST_PASSWORD),
      mfaEnabled: !!args.mfa,
      mfaSecretEnc: totpSecret ? encryptField(totpSecret, FIELD_KEY) : null,
    },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: args.role } });
  await prisma.organizationMembership.create({
    data: {
      userId: user.id,
      organizationId: args.orgId,
      roleId: role.id,
      branchId: args.branchId ?? null,
    },
  });
  return { id: user.id, email, totpSecret };
}

export async function createStaffUser(
  prisma: PrismaService,
  orgId: string,
  branchId: string,
): Promise<TestUser> {
  const mobile = `+96655${Math.floor(1000000 + Math.random() * 8999999)}`;
  const user = await prisma.user.create({
    data: { userType: 'MERCHANT_USER', mobile, displayName: 'Staff' },
  });
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'MERCHANT_STAFF' } });
  await prisma.organizationMembership.create({
    data: { userId: user.id, organizationId: orgId, roleId: role.id, branchId },
  });
  return { id: user.id, mobile };
}

export interface Session {
  cookie: string;
  csrf: string;
  audience: Audience;
  me: Record<string, any>;
}

const parseSetCookie = (res: request.Response, name: string) => {
  const raw = ([] as string[]).concat(
    (res.headers['set-cookie'] as unknown as string[] | string | undefined) ?? [],
  );
  const found = raw.find((c) => c.startsWith(`${name}=`));
  return found ? found.split(';')[0]! : '';
};

export async function passwordSession(
  t: TestApp,
  user: TestUser,
  audience: 'merchant' | 'partner' | 'admin',
  opts: { completeMfa?: boolean } = {},
): Promise<Session> {
  const res = await t.http
    .post('/v1/auth/login')
    .send({ email: user.email, password: TEST_PASSWORD, audience });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = parseSetCookie(res, AUDIENCE_DEFINITIONS[audience].cookieName);
  const session: Session = {
    cookie,
    csrf: res.body.data.csrfToken,
    audience,
    me: res.body.data.me,
  };
  if (opts.completeMfa && user.totpSecret) {
    const m = await call(t, session)
      .post('/v1/auth/mfa/verify')
      .send({ code: totpAt(user.totpSecret, Date.now()) });
    if (m.status !== 200) throw new Error(`mfa failed: ${m.status} ${JSON.stringify(m.body)}`);
  }
  return session;
}

/**
 * Test fixture: a customer whose profile set-up is already finished (adult, details, current Terms / Privacy), so product
 * tests can reserve / buy / earn. Written directly (no welcome notification) so inbox assertions stay unchanged. The set-up flow
 * itself is tested end to end in customer-account.e2e.
 */
export async function completeCustomerOnboarding(prisma: PrismaService, userId: string) {
  const cfg = CONFIG_DEFAULTS['customer.onboarding'] as {
    termsVersion: string;
    privacyVersion: string;
  };
  await prisma.customer.update({
    where: { userId },
    data: {
      firstName: 'Test',
      email: `customer-${uid()}@test.dd`,
      dobEnc: encryptField('1990-01-15', FIELD_KEY),
      ageVerifiedAt: new Date(),
      // no profile city: the customer's city drives eligibility (GEOGRAPHY), product tests keep the browsing city
      onboardingState: 'COMPLETE',
      onboardedAt: new Date(),
    },
  });
  await prisma.customerConsent.createMany({
    data: [
      { userId, kind: 'TERMS', granted: true, version: cfg.termsVersion, source: 'ONBOARDING' },
      { userId, kind: 'PRIVACY', granted: true, version: cfg.privacyVersion, source: 'ONBOARDING' },
    ],
  });
}

export async function otpSession(
  t: TestApp,
  mobile: string,
  audience: 'customer' | 'staff',
  opts: { onboarded?: boolean } = {},
): Promise<Session> {
  const req = await t.http.post('/v1/auth/otp/request').send({ mobile, audience });
  if (req.status !== 200)
    throw new Error(`otp request failed: ${req.status} ${JSON.stringify(req.body)}`);
  const sms = t.sms.lastTo(mobile);
  const code = /\b(\d{6})\b/.exec(sms?.body ?? '')?.[1];
  if (!code) throw new Error('No OTP message captured');
  const res = await t.http.post('/v1/auth/otp/verify').send({ mobile, code, audience });
  if (res.status !== 200)
    throw new Error(`otp verify failed: ${res.status} ${JSON.stringify(res.body)}`);
  if (audience === 'customer' && opts.onboarded !== false) {
    const c = await t.prisma.customer.findUnique({ where: { userId: res.body.data.me.id } });
    if (c && c.onboardingState !== 'COMPLETE')
      await completeCustomerOnboarding(t.prisma, res.body.data.me.id);
  }
  return {
    cookie: parseSetCookie(res, AUDIENCE_DEFINITIONS[audience].cookieName),
    csrf: res.body.data.csrfToken,
    audience,
    me: res.body.data.me,
  };
}

/** Returns a tiny agent that sends the session cookie and CSRF header on every call. */
export function call(t: TestApp, s: Session) {
  const wrap = (r: request.Test) => r.set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf);
  return {
    get: (url: string) => wrap(t.http.get(url)),
    post: (url: string) => wrap(t.http.post(url)),
    put: (url: string) => wrap(t.http.put(url)),
    patch: (url: string) => wrap(t.http.patch(url)),
    delete: (url: string) => wrap(t.http.delete(url)),
  };
}

// ================================================================ Stage 3 helpers
export const RIYADH = { lat: 24.7136, lng: 46.6753 };

/** An ACTIVE merchant with public display data and branches at the given coordinates (null = no coordinates). */
export async function createLiveMerchant(
  prisma: PrismaService,
  label: string,
  branches: Array<{ lat: number | null; lng: number | null; city?: string; name?: string }> = [
    { lat: 24.7136, lng: 46.6753 },
  ],
  extra: { nameAr?: string; trustLevel?: 'NEW' | 'STANDARD' | 'TRUSTED' } = {},
): Promise<Tenant & { nameEn: string }> {
  const nameEn = `${label} ${uid()}`;
  const org = await prisma.organization.create({
    data: {
      type: 'MERCHANT',
      status: 'ACTIVE',
      nameEn,
      nameAr: extra.nameAr ?? `${label} ع`,
      merchant: {
        create: {
          legalName: `${label} Legal LLC`,
          businessEmail: `private-${uid()}@secret.test`,
          commercialRegistrationNumber: '1010999999',
          businessPhone: '+966110000000',
          descriptionEn: `${label} description`,
          descriptionAr: `وصف ${label}`,
          trustLevel: extra.trustLevel ?? 'NEW',
        },
      },
    },
  });
  const branchIds: string[] = [];
  let i = 0;
  for (const b of branches) {
    i++;
    const row = await prisma.merchantBranch.create({
      data: {
        organizationId: org.id,
        nameEn: b.name ?? `${label} Branch ${i}`,
        nameAr: `${label} فرع ${i}`,
        addressEn: 'Riyadh',
        addressAr: 'الرياض',
        city: b.city ?? 'Riyadh',
        latitude: b.lat,
        longitude: b.lng,
        phone: '+966110000001',
        hours: { mon: { closed: false, intervals: [{ open: '09:00', close: '23:00' }] } },
      },
    });
    branchIds.push(row.id);
  }
  return { orgId: org.id, branchIds, nameEn };
}

/** A real AVAILABLE deal image record (kind DEAL_IMAGE). The bytes are not needed unless the test fetches them. */
export async function makeDealImage(prisma: PrismaService, orgId: string) {
  const id = randomBytes(8).toString('hex');
  const f = await prisma.storedFile.create({
    data: {
      organizationId: orgId,
      kind: 'DEAL_IMAGE',
      originalName: `${id}.png`,
      mimeType: 'image/png',
      declaredSize: 1000,
      sizeBytes: 1000,
      storageKey: `merchants/${orgId}/deal_image/${id}`,
      status: 'AVAILABLE',
      completedAt: new Date(),
    },
  });
  return f.id;
}

export const pngBytes = (w = 640, h = 400) => makeDevImagePng(w, h, [91, 26, 252], [15, 12, 66], 3);

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
/** Fixed per test file so repeated content() calls describe the SAME schedule (an edit must not accidentally move dates). */
const DEFAULT_START = hoursFromNow(-1);
const DEFAULT_END = hoursFromNow(24 * 7);

/** Complete, valid Live Deal content (bilingual). Starts an hour ago so approval makes it LIVE immediately. */
export function validContent(args: {
  categoryId: string;
  branchIds: string[];
  fileId: string;
  overrides?: Record<string, unknown>;
}) {
  return {
    categoryId: args.categoryId,
    mechanic: 'PERCENTAGE_OFF',
    valueNumber: 30,
    offerLabel: { en: '30% off', ar: 'خصم 30%' },
    title: { en: '30% off the tasting menu', ar: 'خصم 30% على قائمة التذوق' },
    shortDescription: { en: 'Dinner for two, tasting menu', ar: 'عشاء لشخصين، قائمة التذوق' },
    description: {
      en: 'Enjoy 30% off the full tasting menu every evening.',
      ar: 'استمتع بخصم 30% على قائمة التذوق الكاملة كل مساء.',
    },
    media: [{ fileId: args.fileId, altEn: 'Tasting menu plate', altAr: 'طبق قائمة التذوق' }],
    branchIds: args.branchIds,
    startAt: DEFAULT_START,
    endAt: DEFAULT_END,
    eligibility: { kind: 'PUBLIC', valueRefs: [] },
    terms: {
      blocks: {
        fullPriceItemsOnly: true,
        notCombinable: true,
        validDays: [],
        minimumSpendHalalas: null,
        validFrom: null,
        validTo: null,
      },
      textEn: 'Valid on full-price items only.',
      textAr: 'صالح على الأصناف بالسعر الكامل فقط.',
    },
    redemptionMode: 'GENERAL',
    ...(args.overrides ?? {}),
  };
}

export const idem = () => `k-${randomBytes(8).toString('hex')}`;
