import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseApiEnv } from '@dealdash/config';
import { decryptField } from '../common/crypto';
import { MockEmailProvider, MockSmsProvider } from '../providers/mocks';
import { testInboxRecorder } from './test-inbox';

const KEY = 'k'.repeat(40);
const env = (over: Record<string, string> = {}) =>
  parseApiEnv({
    DATABASE_URL: 'postgresql://u:p@localhost/dealdash_staging',
    SESSION_SECRET: 's'.repeat(40),
    FIELD_ENCRYPTION_KEY: KEY,
    APP_ENV: 'staging',
    ALLOW_MOCK_PROVIDERS: 'true',
    STAGING_TEST_PHONE_PREFIXES: '+92000000',
    STAGING_TEST_EMAIL_DOMAINS: 'test',
    ...over,
  });

function fakePrisma() {
  const rows: Array<Record<string, unknown>> = [];
  const deleted: unknown[] = [];
  return {
    rows,
    deleted,
    stagingTestMessage: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        rows.push(data);
        return data;
      }),
      deleteMany: vi.fn(async (args: unknown) => {
        deleted.push(args);
        return { count: 0 };
      }),
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('staging test inbox (G-1) — recorder and development adapters', () => {
  it('keeps only synthetic recipients, encrypts the body and prunes old rows', async () => {
    const db = fakePrisma();
    const rec = testInboxRecorder(env(), db as never)!;
    await rec({
      channel: 'SMS',
      to: '+920000001234',
      templateKey: 'auth.otp',
      body: 'Code 123456',
    });
    await rec({
      channel: 'SMS',
      to: '+923001234567',
      templateKey: 'auth.otp',
      body: 'Code 654321',
    });
    await rec({
      channel: 'EMAIL',
      to: 'Owner@Shop.TEST',
      templateKey: 'invite',
      subject: 'Hi',
      body: 'https://x.example/i',
    });
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0]).toMatchObject({ channel: 'SMS', recipient: '+920000001234', subject: null });
    expect(String(db.rows[0]!.bodyEnc)).not.toContain('123456');
    expect(decryptField(String(db.rows[0]!.bodyEnc), KEY)).toBe('Code 123456');
    expect(db.rows[1]).toMatchObject({ recipient: 'owner@shop.test', subject: 'Hi' });
    expect(db.deleted).toHaveLength(2);
  });

  it('has no recorder outside staging or without development adapters', () => {
    expect(
      testInboxRecorder(env({ APP_ENV: 'production' }), fakePrisma() as never),
    ).toBeUndefined();
    expect(
      testInboxRecorder(env({ APP_ENV: 'development' }), fakePrisma() as never),
    ).toBeUndefined();
    expect(
      testInboxRecorder(env({ ALLOW_MOCK_PROVIDERS: 'false' }), fakePrisma() as never),
    ).toBeUndefined();
  });

  it('staging logs never contain the code or the full number; a failing inbox never fails the send', async () => {
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => {
      lines.push(String(m));
    });
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const sms = new MockSmsProvider({
      redactLogs: true,
      observer: async () => {
        throw new Error('database down');
      },
    });
    await expect(
      sms.send({ to: '+920000009876', templateKey: 'auth.otp', body: 'Your code is 112233' }),
    ).resolves.toHaveProperty('providerRef');
    const email = new MockEmailProvider({ redactLogs: true });
    await email.send({
      to: 'a@b.test',
      templateKey: 't',
      subject: 'S',
      body: 'https://secret.link/x',
    });
    expect(lines.join('\n')).not.toMatch(/112233|\+920000009876|secret\.link/);
    expect(lines[0]).toContain('***9876');
    // development keeps the convenient console line
    lines.length = 0;
    await new MockSmsProvider().send({
      to: '+966500000001',
      templateKey: 'auth.otp',
      body: 'Code 445566',
    });
    expect(lines[0]).toContain('445566');
  });
});
