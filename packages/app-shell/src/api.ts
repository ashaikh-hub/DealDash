import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newIdempotencyKey } from '@dealdash/api-client';
import type { ApiErrorItem } from '@dealdash/types';
import { useAuth } from './auth-context';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  errors: ApiErrorItem[];
  nextCursor: string | null;
}

export interface CallOptions {
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  /** Sends an Idempotency-Key header (required by "create" style commands). */
  idempotent?: boolean;
  /**
   * A specific Idempotency-Key. Used when a command is retried after a bad connection: the SAME key makes the server return
   * the first result instead of running the command twice (for example a counter redemption).
   */
  idempotencyKey?: string;
  /** Extra request headers (for example the Watch & Earn viewing token). */
  headers?: Record<string, string>;
}

/** Upload route family per file kind: campaign video has its own (permission-checked) routes. */
const mediaPath = (kind: string) =>
  kind === 'DEAL_IMAGE' ? 'deal-media' : kind === 'WATCH_VIDEO' ? 'watch-media' : 'files';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface UploadedFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Small, typed-by-the-caller fetch helper for command-style screens. It adds what every state-changing request
 * needs: the session cookie (credentials), the CSRF token, the UI language, and optionally an idempotency key.
 * Response bodies are typed with the shared Zod schemas (e.g. MerchantApplicationDetail from @dealdash/validation).
 */
export function useApi() {
  const { apiUrl, locale, csrfToken } = useAuth();
  const csrfRef = useRef(csrfToken);
  csrfRef.current = csrfToken;

  const call = useCallback(
    async <T>(method: HttpMethod, path: string, opts: CallOptions = {}): Promise<ApiResult<T>> => {
      const url = new URL(apiUrl + path);
      for (const [k, v] of Object.entries(opts.query ?? {})) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
      const headers: Record<string, string> = { 'Accept-Language': locale };
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      if (method !== 'GET' && csrfRef.current) headers['X-CSRF-Token'] = csrfRef.current;
      if (opts.headers) Object.assign(headers, opts.headers);
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
      else if (opts.idempotent) headers['Idempotency-Key'] = newIdempotencyKey();
      try {
        const res = await fetch(url.toString(), {
          method,
          credentials: 'include',
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
        let json: { data?: T; errors?: ApiErrorItem[]; meta?: { nextCursor?: string | null } } = {};
        try {
          json = (await res.json()) as typeof json;
        } catch {
          /* empty body */
        }
        return {
          ok: res.ok,
          status: res.status,
          data: res.ok ? ((json.data ?? null) as T | null) : null,
          errors: res.ok ? [] : (json.errors ?? [{ code: 'INTERNAL', message: 'Request failed' }]),
          nextCursor: json.meta?.nextCursor ?? null,
        };
      } catch {
        return {
          ok: false,
          status: 0,
          data: null,
          errors: [{ code: 'NETWORK', message: 'Network error' }],
          nextCursor: null,
        };
      }
    },
    [apiUrl, locale],
  );

  /** Three-step upload through the storage adapter: intent, direct PUT of the bytes, completion check. */
  const upload = useCallback(
    async (
      organizationId: string,
      kind: 'DOCUMENT' | 'LOGO' | 'COVER' | 'GALLERY' | 'DEAL_IMAGE' | 'WATCH_VIDEO',
      file: File,
    ): Promise<{ ok: true; file: UploadedFile } | { ok: false; errors: ApiErrorItem[] }> => {
      const intent = await call<{
        fileId: string;
        uploadUrl: string;
        headers: Record<string, string>;
      }>('POST', `/v1/merchants/${organizationId}/${mediaPath(kind)}/intent`, {
        body: {
          ...(kind === 'DEAL_IMAGE' ? {} : { kind }),
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      });
      if (!intent.ok || !intent.data) return { ok: false, errors: intent.errors };
      try {
        const put = await fetch(intent.data.uploadUrl, {
          method: 'PUT',
          headers: intent.data.headers,
          body: file,
        });
        if (!put.ok)
          return { ok: false, errors: [{ code: 'FILE_INVALID', message: 'Upload failed' }] };
      } catch {
        return { ok: false, errors: [{ code: 'NETWORK', message: 'Network error' }] };
      }
      const done = await call<UploadedFile>(
        'POST',
        `/v1/merchants/${organizationId}/${mediaPath(kind)}/${intent.data.fileId}/complete`,
      );
      if (!done.ok || !done.data) return { ok: false, errors: done.errors };
      return { ok: true, file: done.data };
    },
    [call],
  );

  return useMemo(() => ({ call, upload }), [call, upload]);
}

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  errors: ApiErrorItem[];
  reload: () => Promise<void>;
  /** Replace the cached value (used when a command returns the fresh object). */
  set: (value: T) => void;
}

/** Loads a GET resource when `path` is set; reloads when the path or query changes. */
export function useResource<T>(
  path: string | null,
  query?: Record<string, string | number | undefined | null>,
): Resource<T> {
  const { call } = useApi();
  const [state, setState] = useState<{ data: T | null; loading: boolean; errors: ApiErrorItem[] }>({
    data: null,
    loading: path !== null,
    errors: [],
  });
  const queryKey = JSON.stringify(query ?? {});
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (path === null) return;
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    const res = await call<T>('GET', path, {
      query: JSON.parse(queryKey) as Record<string, string>,
    });
    if (mine !== seq.current) return;
    setState({ data: res.data, loading: false, errors: res.errors });
  }, [call, path, queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = useCallback((value: T) => setState({ data: value, loading: false, errors: [] }), []);
  return { ...state, reload: load, set };
}
