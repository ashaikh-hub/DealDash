import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BatchingAnalyticsClient } from '@dealdash/analytics';
import { createApiClient, type ApiClient } from '@dealdash/api-client';
import type { Audience, Locale, MeView } from '@dealdash/types';

export interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated';
  me: MeView | null;
  csrfToken: string | null;
  /** True while a signed-in password session still needs its second factor. */
  needsMfa: boolean;
}

export interface AuthContextValue extends AuthState {
  audience: Audience;
  locale: Locale;
  apiUrl: string;
  client: ApiClient;
  refresh: () => Promise<void>;
  setSession: (me: MeView, csrfToken: string, needsMfa: boolean) => void;
  signOut: () => Promise<void>;
  track: (
    name: Parameters<BatchingAnalyticsClient['track']>[0]['name'],
    properties?: Record<string, string | number | boolean | null>,
  ) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Pulls a stable error code out of the API's standard error envelope. */
export function errorCodeOf(error: unknown): string {
  const e = error as { errors?: Array<{ code?: string }> } | undefined;
  return e?.errors?.[0]?.code ?? 'GENERIC';
}

export function AuthProvider({
  audience,
  locale,
  apiUrl,
  children,
}: {
  audience: Audience;
  locale: Locale;
  apiUrl: string;
  children: ReactNode;
}) {
  const client = useMemo(() => createApiClient({ baseUrl: apiUrl, locale }), [apiUrl, locale]);
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    me: null,
    csrfToken: null,
    needsMfa: false,
  });
  const csrfRef = useRef<string | null>(null);

  const analytics = useMemo(
    () =>
      new BatchingAnalyticsClient(
        async (batch) => {
          await client.POST('/v1/analytics/events', { body: batch as never });
        },
        { context: { app: audience, locale } },
      ),
    [client, audience, locale],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await client.GET('/v1/auth/me');
      const body = res.data as { data?: MeView & { csrfToken?: string } } | undefined;
      if (res.response.status === 200 && body?.data) {
        const { csrfToken, ...me } = body.data;
        csrfRef.current = csrfToken ?? null;
        setState({
          status: 'authenticated',
          me: me as MeView,
          csrfToken: csrfToken ?? null,
          needsMfa: me.mfaRequired && !me.mfaVerified,
        });
        return;
      }
      const code = errorCodeOf(res.error);
      if (res.response.status === 401 && code === 'MFA_REQUIRED') return; // keep current state
      csrfRef.current = null;
      setState({ status: 'anonymous', me: null, csrfToken: null, needsMfa: false });
    } catch {
      setState({ status: 'anonymous', me: null, csrfToken: null, needsMfa: false });
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setSession = useCallback((me: MeView, csrfToken: string, needsMfa: boolean) => {
    csrfRef.current = csrfToken;
    setState({ status: 'authenticated', me, csrfToken, needsMfa });
  }, []);

  const signOut = useCallback(async () => {
    await client.POST('/v1/auth/logout', {
      headers: { 'X-CSRF-Token': csrfRef.current ?? '' },
    } as never);
    csrfRef.current = null;
    setState({ status: 'anonymous', me: null, csrfToken: null, needsMfa: false });
  }, [client]);

  const track = useCallback<AuthContextValue['track']>(
    (name, properties = {}) => {
      analytics.track({ name, properties });
      void analytics.flush();
    },
    [analytics],
  );

  const value: AuthContextValue = {
    ...state,
    audience,
    locale,
    apiUrl,
    client,
    refresh,
    setSession,
    signOut,
    track,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
