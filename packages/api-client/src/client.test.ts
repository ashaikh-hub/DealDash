import { describe, expect, it, vi } from 'vitest';
import { createApiClient, newIdempotencyKey } from './index';

describe('api client', () => {
  it('sends credentials, the locale and a request id; bearer token only when provided', async () => {
    const seen: Request[] = [];
    const fetchMock = vi.fn(async (req: Request) => {
      seen.push(req);
      return new Response(JSON.stringify({ data: { status: 'ok' }, meta: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const client = createApiClient({
      baseUrl: 'http://api.test',
      locale: 'ar',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await (client as unknown as { GET: (p: string) => Promise<unknown> }).GET('/v1/health');
    const req = seen[0]!;
    expect(req.url).toBe('http://api.test/v1/health');
    expect(req.credentials).toBe('include');
    expect(req.headers.get('accept-language')).toBe('ar');
    expect(req.headers.get('x-request-id')).toBeTruthy();
    expect(req.headers.get('authorization')).toBeNull();

    const bearer = createApiClient({
      baseUrl: 'http://api.test',
      getToken: () => 'tok',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await (bearer as unknown as { GET: (p: string) => Promise<unknown> }).GET('/v1/health');
    expect(seen[1]!.headers.get('authorization')).toBe('Bearer tok');
  });

  it('generates unique idempotency keys', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
    expect(newIdempotencyKey().length).toBeGreaterThanOrEqual(8);
  });
});
