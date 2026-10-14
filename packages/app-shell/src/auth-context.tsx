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
import { setDisplayMarket } from '@dealdash/localization';
import {
  contentLocaleOf,
  type Audience,
  type Locale,
  type MeView,
  type UiLocale,
} from '@dealdash/types';

/** The market the screens show money and time in when a value carries no currency / zone of its own (from the API). */
export interface DisplayMarketView {
  market: string;
  currency: string;
  timeZone: string;
}

export interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated';
  me: MeView | null;
  csrfToken: string | null;
  /** True while a signed-in password session still needs its second factor. */
  needsMfa: boolean;
}

export interface AuthContextValue extends AuthState {
  audience: Audience;
  /** The CONTENT language (English or Arabic): which column of bilingual records to show. */
  locale: Locale;
  /** The INTERFACE language: equals `locale` in the business portals; the customer app adds Urdu (content then reads English). */
  uiLocale: UiLocale;
  apiUrl: string;
  client: ApiClient;
  refresh: () => Promise<void>;
  setSession: (me: MeView, csrfToken: string, needsMfa: boolean) => void;
  signOut: () => Promise<void>;
  /** The session's market (Market / Country Configuration): the business's market, else the customer's city's, else the default. */
  market: DisplayMarketView | null;
  /** Customer app: the chosen city decides the display market. */
  setMarketCity: (city: string | null) => void;
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
  locale: uiLocale,
  apiUrl,
  children,
}: {
  audience: Audience;
  /** The route's language (business portals: en / ar; customer app: en / ar / ur). */
  locale: UiLocale;
  apiUrl: string;
  children: ReactNode;
}) {
  const locale = contentLocaleOf(uiLocale);
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

  // ---- display market: whose currency and time zone values without their own are shown in (never a fixed country)
  const [market, setMarket] = useState<DisplayMarketView | null>(null);
  const [marketCity, setMarketCity] = useState<string | null>(null);
  const orgId = state.me?.activeMembership?.organizationId ?? null;
  useEffect(() => {
    if (state.status === 'loading') return;
    let cancelled = false;
    const q = marketCity ? `?city=${encodeURIComponent(marketCity)}` : '';
    fetch(`${apiUrl}/v1/market-context${q}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data?: DisplayMarketView } | null) => {
        if (cancelled || !b?.data?.currency) return;
        setDisplayMarket({ currency: b.data.currency, timeZone: b.data.timeZone });
        setMarket(b.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [apiUrl, state.status, orgId, marketCity]);

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
    uiLocale,
    apiUrl,
    client,
    refresh,
    setSession,
    signOut,
    market,
    setMarketCity,
    track,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
