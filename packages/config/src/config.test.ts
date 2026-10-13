import { describe, expect, it } from 'vitest';
import {
  CONFIG_DEFAULTS,
  CONFIG_KEYS,
  appEnvOf,
  launchControlsSchema,
  parseApiEnv,
  productionSafetyProblems,
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
