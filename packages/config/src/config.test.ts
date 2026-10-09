import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, CONFIG_KEYS, parseApiEnv } from './index';

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

  it('has a default for every configuration key', () => {
    for (const key of Object.values(CONFIG_KEYS)) expect(CONFIG_DEFAULTS).toHaveProperty([key]);
    expect(CONFIG_DEFAULTS['reporting.cohort_threshold']).toBe(10);
    expect(CONFIG_DEFAULTS['reservation.hold_minutes']).toBe(30);
  });
});
