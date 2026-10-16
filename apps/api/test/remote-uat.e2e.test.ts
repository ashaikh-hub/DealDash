import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOINDEX } from '@dealdash/types';
import { DB_READY, createTestApp, type TestApp } from './helpers';

/** Remote UAT (G-6): every API answer tells search engines not to index it, success or error. */
describe.skipIf(!DB_READY)('Remote UAT: API is never indexed', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  it('sends X-Robots-Tag noindex on public, error and unknown routes', async () => {
    for (const path of ['/v1/health/live', '/v1/app/config', '/v1/auth/me', '/v1/nope']) {
      const res = await t.http.get(path);
      expect(res.headers['x-robots-tag'], path).toBe(NOINDEX);
    }
  });
});
