import createClient, { type Middleware } from 'openapi-fetch';
import type { Locale } from '@dealdash/types';
import type { paths } from './schema';

export type { paths, components, operations } from './schema';

export interface ApiClientOptions {
  baseUrl: string;
  /** Sent as Accept-Language. */
  locale?: Locale;
  /** Optional bearer token (native clients). Web apps use secure cookies instead. */
  getToken?: () => string | null | undefined;
  /** Custom fetch (tests, server components). */
  fetch?: typeof fetch;
}

/** Cookie-based sessions: browsers must send credentials cross-origin (API origin is allow-listed). */
export function createApiClient(options: ApiClientOptions) {
  const client = createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: 'include',
    fetch: options.fetch,
    headers: options.locale ? { 'Accept-Language': options.locale } : undefined,
  });

  const middleware: Middleware = {
    onRequest({ request }) {
      const token = options.getToken?.();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      if (
        typeof crypto !== 'undefined' &&
        'randomUUID' in crypto &&
        !request.headers.has('X-Request-Id')
      ) {
        request.headers.set('X-Request-Id', crypto.randomUUID());
      }
      return request;
    },
  };
  client.use(middleware);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Generates a client-side idempotency key for command requests. */
export const newIdempotencyKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
