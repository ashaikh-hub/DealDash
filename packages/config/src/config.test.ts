import { describe, expect, it } from 'vitest';
import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  appEnvOf,
  isAllowedBrowserOrigin,
  isStagingTestRecipient,
  launchControlsSchema,
  parseApiEnv,
  productionSafetyProblems,
  stagingTestInboxEnabled,
  stagingTestRecipientProblems,
} from './index';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/dealdash_dev',
  SESSION_SECRET: 'x'.repeat(24),
  FIELD_ENCRYPTION_KEY: 'y'.repeat(32),
};

describe('config', () => {
  it('parses a valid environment with defaults', () => {
    const env = parseApiEnv(base);
    expect(env.API_PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toHaveLength(5);
    expect(env.SMS_PROVIDER).toBe('mock');
  });

  it('browser origins: CORS_ORIGINS, plus private-network app ports on a local development machine only', () => {
    const dev = parseApiEnv({ ...base, NODE_ENV: 'development' });
    expect(isAllowedBrowserOrigin(dev, 'http://localhost:3001')).toBe(true);
    // a phone on the same Wi-Fi, on a configured app port
    expect(isAllowedBrowserOrigin(dev, 'http://192.168.70.107:3001')).toBe(true);
    expect(isAllowedBrowserOrigin(dev, 'http://10.0.0.5:3005')).toBe(true);
    expect(isAllowedBrowserOrigin(dev, 'http://172.20.1.2:3002')).toBe(true);
    // not a configured app port, not private, not http
    expect(isAllowedBrowserOrigin(dev, 'http://192.168.70.107:8080')).toBe(false);
    expect(isAllowedBrowserOrigin(dev, 'http://8.8.8.8:3001')).toBe(false);
    expect(isAllowedBrowserOrigin(dev, 'http://172.32.0.1:3001')).toBe(false);
    expect(isAllowedBrowserOrigin(dev, 'https://192.168.70.107:3001')).toBe(false);
    expect(isAllowedBrowserOrigin(dev, 'http://evil.example:3001')).toBe(false);
    expect(isAllowedBrowserOrigin(dev, 'not a url')).toBe(false);
    // test, staging and production accept CORS_ORIGINS only
    const lan = 'http://192.168.70.107:3001';
    expect(isAllowedBrowserOrigin(parseApiEnv({ ...base, NODE_ENV: 'test' }), lan)).toBe(false);
    expect(
      isAllowedBrowserOrigin(
        parseApiEnv({ ...base, NODE_ENV: 'production', APP_ENV: 'staging' }),
        lan,
      ),
    ).toBe(false);
    expect(isAllowedBrowserOrigin(parseApiEnv({ ...base, NODE_ENV: 'production' }), lan)).toBe(
      false,
    );
    expect(
      isAllowedBrowserOrigin(
        parseApiEnv({ ...base, NODE_ENV: 'production', CORS_ORIGINS: 'https://app.example' }),
        'https://app.example',
      ),
    ).toBe(true);
  });

  it('fails clearly when required values are missing or weak', () => {
    expect(() => parseApiEnv({})).toThrow(/DATABASE_URL/);
    expect(() => parseApiEnv({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('Stage 9: a production process refuses development adapters, dev / test databases, plain HTTP and weak secrets', () => {
    const prod = parseApiEnv({ ...base, NODE_ENV: 'production', APP_ENV: 'production' });
    const p = productionSafetyProblems(prod);
    expect(p).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/SMS_PROVIDER/),
        expect.stringMatching(/development \/ test database/),
        expect.stringMatching(/TLS/),
        expect.stringMatching(/https/),
        expect.stringMatching(/RATE_LIMIT/),
        expect.stringMatching(/LOG_FORMAT/),
      ]),
    );
    // never echoes a secret or the connection string
    expect(p.join(' ')).not.toContain('postgresql://');
    expect(p.join(' ')).not.toContain('x'.repeat(24));
    // staging may stand in development adapters for UAT, production may not
    const staging = parseApiEnv({
      ...base,
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      ALLOW_MOCK_PROVIDERS: 'true',
    });
    expect(productionSafetyProblems(staging).some((x) => /SMS_PROVIDER/.test(x))).toBe(false);
    expect(
      productionSafetyProblems(
        parseApiEnv({
          ...base,
          NODE_ENV: 'production',
          APP_ENV: 'production',
          ALLOW_MOCK_PROVIDERS: 'true',
        }),
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/ALLOW_MOCK_PROVIDERS/)]));
    // development is unaffected
    expect(productionSafetyProblems(parseApiEnv(base))).toEqual([]);
    expect(appEnvOf(parseApiEnv(base))).toBe('local');
  });

  it('launch readiness: staging on Google Cloud — Cloud SQL connector socket and S3-compatible storage', () => {
    const staging = {
      ...base,
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      ALLOW_MOCK_PROVIDERS: 'true',
      DATABASE_URL:
        'postgresql://dealdash_app:pw@localhost/dealdash_staging?host=/cloudsql/dd-staging:me-central1:dd-pg',
      SESSION_SECRET: 'z'.repeat(40),
      API_PUBLIC_URL: 'https://api.staging.example',
      MERCHANT_APP_URL: 'https://merchant.staging.example',
      PARTNER_APP_URL: 'https://partner.staging.example',
      CORS_ORIGINS: 'https://app.staging.example',
      RATE_LIMIT_PER_MINUTE: '600',
      AUTH_RATE_LIMIT_PER_MINUTE: '20',
      LOG_FORMAT: 'json',
      STORAGE_PROVIDER: 's3',
      S3_ENDPOINT: 'https://storage.googleapis.com',
      S3_BUCKET: 'dd-staging-files',
      S3_ACCESS_KEY_ID: 'GOOG1EXAMPLE',
      S3_SECRET_ACCESS_KEY: 'x'.repeat(40),
    };
    expect(productionSafetyProblems(parseApiEnv(staging))).toEqual([]);
    // a plain TCP connection without TLS is still refused
    expect(
      productionSafetyProblems(
        parseApiEnv({
          ...staging,
          DATABASE_URL: 'postgresql://dealdash_app:pw@10.0.0.5/dealdash_staging',
        }),
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/TLS/)]));
    // incomplete storage settings are named, never echoed
    const p = productionSafetyProblems(
      parseApiEnv({ ...staging, S3_SECRET_ACCESS_KEY: undefined }),
    );
    expect(p).toEqual(expect.arrayContaining([expect.stringMatching(/S3_SECRET_ACCESS_KEY/)]));
    expect(p.join(' ')).not.toContain('GOOG1EXAMPLE');
    // G-3: invitation links never point at localhost (the default) in staging / production
    const { MERCHANT_APP_URL: _m, PARTNER_APP_URL: _p, ...noPortals } = staging;
    expect(productionSafetyProblems(parseApiEnv(noPortals))).toEqual([
      expect.stringMatching(/^MERCHANT_APP_URL/),
      expect.stringMatching(/^PARTNER_APP_URL/),
    ]);
  });

  it('staging test inbox (G-1): staging only, development adapters only, synthetic recipients only', () => {
    const staging = {
      ...base,
      APP_ENV: 'staging',
      ALLOW_MOCK_PROVIDERS: 'true',
      STAGING_TEST_PHONE_PREFIXES: '+966500000, +92000000',
      STAGING_TEST_EMAIL_DOMAINS: '@test,qa.invalid',
    };
    const env = parseApiEnv(staging);
    expect(stagingTestInboxEnabled(env)).toBe(true);
    expect(isStagingTestRecipient(env, '+966500000102')).toBe(true);
    expect(isStagingTestRecipient(env, '+920000000017')).toBe(true);
    expect(isStagingTestRecipient(env, '+923001234567')).toBe(false);
    expect(isStagingTestRecipient(env, 'Owner@NajdKitchen.TEST')).toBe(true);
    expect(isStagingTestRecipient(env, 'someone@qa.invalid')).toBe(true);
    expect(isStagingTestRecipient(env, 'someone@gmail.com')).toBe(false);
    expect(isStagingTestRecipient(env, 'someone@test.com')).toBe(false);
    // never outside staging, never without development adapters, never with an empty list
    for (const off of [
      { ...staging, APP_ENV: 'production' },
      { ...staging, APP_ENV: 'development' },
      { ...staging, APP_ENV: undefined },
      { ...staging, ALLOW_MOCK_PROVIDERS: 'false' },
      { ...staging, STAGING_TEST_PHONE_PREFIXES: '', STAGING_TEST_EMAIL_DOMAINS: '' },
    ]) {
      const e = parseApiEnv(off);
      expect(stagingTestInboxEnabled(e)).toBe(false);
      expect(isStagingTestRecipient(e, '+966500000102')).toBe(false);
    }
    // a country-wide prefix or a real domain switches the inbox off and is named at boot
    const wide = parseApiEnv({ ...staging, STAGING_TEST_PHONE_PREFIXES: '+92' });
    expect(stagingTestInboxEnabled(wide)).toBe(false);
    expect(stagingTestRecipientProblems(wide)).toEqual([
      expect.stringMatching(/STAGING_TEST_PHONE_PREFIXES/),
    ]);
    const real = parseApiEnv({ ...staging, STAGING_TEST_EMAIL_DOMAINS: 'gmail.com' });
    expect(stagingTestInboxEnabled(real)).toBe(false);
    expect(
      productionSafetyProblems(
        parseApiEnv({
          ...staging,
          NODE_ENV: 'production',
          STAGING_TEST_EMAIL_DOMAINS: 'gmail.com',
        }),
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/reserved test TLD/)]));
    // production refuses the setting outright
    expect(
      productionSafetyProblems(
        parseApiEnv({
          ...staging,
          NODE_ENV: 'production',
          APP_ENV: 'production',
          ALLOW_MOCK_PROVIDERS: 'false',
        }),
      ),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/must not be set in production/)]));
  });

  it('Stage 9: launch controls default to open with no stop', () => {
    expect(launchControlsSchema.parse(CONFIG_DEFAULTS['launch.controls'])).toEqual({
      pilot: { mode: 'OPEN', merchantOrganizationIds: [], partnerOrganizationIds: [] },
      stops: {},
    });
    expect(() =>
      launchControlsSchema.parse({
        pilot: { mode: 'SOMETIMES', merchantOrganizationIds: [], partnerOrganizationIds: [] },
        stops: {},
      }),
    ).toThrow();
  });

  it('has a default for every configuration key', () => {
    for (const key of Object.values(CONFIG_KEYS)) expect(CONFIG_DEFAULTS).toHaveProperty([key]);
    expect(CONFIG_DEFAULTS['reporting.cohort_threshold']).toBe(10);
    expect(CONFIG_DEFAULTS['reservation.hold_minutes']).toBe(30);
  });
});
