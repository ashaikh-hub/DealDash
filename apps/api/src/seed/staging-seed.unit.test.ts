import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stagingSeedProblems, uploadSeedFiles } from './staging-seed';

let dir = '';
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

const fakeStorage = () => ({
  createUploadUrl: async (i: { key: string; contentType: string; maxBytes: number }) => ({
    url: `https://bucket.example/${i.key}`,
    method: 'PUT' as const,
    headers: { 'Content-Type': i.contentType },
    key: i.key,
    expiresAt: new Date().toISOString(),
  }),
});

describe('staging seed (G-2)', () => {
  it('uploads every seed file under its storage key with the recorded type', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dd-seed-unit-'));
    await mkdir(join(dir, 'merchants', 'o1', 'logo'), { recursive: true });
    await writeFile(join(dir, 'merchants', 'o1', 'logo', 'seed-logo.png'), Buffer.from([1, 2, 3]));
    await writeFile(join(dir, 'seed-terms.pdf'), Buffer.from('pdf'));
    const sent: Array<{ url: string; type: string; bytes: number }> = [];
    const http = (async (url: string, init: RequestInit) => {
      sent.push({
        url,
        type: (init.headers as Record<string, string>)['Content-Type']!,
        bytes: (init.body as Buffer).length,
      });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const n = await uploadSeedFiles(
      dir,
      fakeStorage(),
      async (key) => (key.endsWith('.png') ? 'image/png' : undefined),
      http,
    );
    expect(n).toBe(2);
    expect(sent).toEqual(
      expect.arrayContaining([
        {
          url: 'https://bucket.example/merchants/o1/logo/seed-logo.png',
          type: 'image/png',
          bytes: 3,
        },
        { url: 'https://bucket.example/seed-terms.pdf', type: 'application/pdf', bytes: 3 },
      ]),
    );
  });

  it('stops on a failed upload without echoing the signed URL', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dd-seed-unit-'));
    await writeFile(join(dir, 'seed-a.png'), Buffer.from([1]));
    const http = (async () => new Response(null, { status: 403 })) as unknown as typeof fetch;
    await expect(uploadSeedFiles(dir, fakeStorage(), async () => undefined, http)).rejects.toThrow(
      /^Uploading a seed file failed \(HTTP 403\)$/,
    );
  });

  it('refuses outside staging, without the secrets, or on a database that has accounts', async () => {
    const db = (users: number, done = false) => ({
      user: { count: async () => users },
      auditLog: { findFirst: async () => (done ? { id: 'a' } : null) },
    });
    const staging = { APP_ENV: 'staging' as const, NODE_ENV: 'production' as const };
    const ok = { password: 'p'.repeat(20), mfaSecret: 'A'.repeat(32) };
    expect(await stagingSeedProblems(db(0) as never, staging, ok)).toEqual([]);
    expect(
      await stagingSeedProblems(
        db(0) as never,
        { APP_ENV: 'production', NODE_ENV: 'production' },
        ok,
      ),
    ).toEqual([expect.stringMatching(/APP_ENV must be staging/)]);
    expect(await stagingSeedProblems(db(0) as never, { NODE_ENV: 'development' }, ok)).toHaveLength(
      1,
    );
    expect(
      await stagingSeedProblems(db(0) as never, staging, {
        password: 'x',
        mfaSecret: 'not-base32!',
      }),
    ).toHaveLength(2);
    expect(await stagingSeedProblems(db(3) as never, staging, ok)).toEqual([
      expect.stringMatching(/empty database/),
    ]);
    expect(await stagingSeedProblems(db(3, true) as never, staging, ok)).toEqual([
      expect.stringMatching(/already seeded/),
    ]);
  });
});
