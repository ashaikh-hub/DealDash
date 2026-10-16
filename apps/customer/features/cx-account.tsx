'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, LoginPanel, errorMessage, useApi, useAuth } from '@dealdash/app-shell';
import { stripLocale, withLocale, type DictionaryKey } from '@dealdash/localization';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  LoadingState,
  OtpInput,
  StatusChip,
} from '@dealdash/ui';
import type {
  CardSetupResult,
  LinkedIdentities,
  SavedCard,
  SavedCardList,
  SocialCallbackResult,
  SocialCompleteResult,
  SocialProvider,
} from '@dealdash/validation';
import { safeNext, useHref, useT } from './parts';

/**
 * Customer experience (2026-10-16): Google / Apple sign-in (with the development provider screen until production credentials exist),
 * linked accounts, and saved cards (added on the payment provider's page; DealDash keeps only the provider's token and display details).
 */

const NEXT_KEY = 'dd.social.next';
const isDev = process.env.NODE_ENV !== 'production';

// ---------------------------------------------------------------- brand marks (official colours, drawn inline)
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M22.6 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"
      />
      <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9l3.7-2.8z" />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"
      />
    </svg>
  );
}
function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9s-2-.9-3.4-.9a5 5 0 0 0-4.2 2.6c-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3 0 1.8-.8 3.3-.8s2 .8 3.4.8 2.2-1.3 3-2.5c1-1.4 1.4-2.8 1.4-2.9 0 0-2.6-1-2.6-4zM13.9 5c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"
      />
    </svg>
  );
}
const PROVIDERS: SocialProvider[] = ['GOOGLE', 'APPLE'];
const providerName = (t: (k: DictionaryKey) => string, p: SocialProvider) =>
  t(`cx.so.p.${p}` as DictionaryKey);

/** "Continue with Google / Apple" (welcome and sign-in screens). The phone number remains the account key (see the callback). */
export function SocialButtons({ next }: { next?: string | null }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { uiLocale } = useAuth();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const start = async (provider: SocialProvider) => {
    setBusy(provider);
    setError(null);
    try {
      const here = stripLocale(`${window.location.pathname}${window.location.search}`);
      sessionStorage.setItem(NEXT_KEY, safeNext(next ?? null) ?? safeNext(here) ?? '/');
    } catch {
      /* storage blocked: the callback falls back to Home */
    }
    const r = await call<{ authorizeUrl: string }>('POST', '/v1/auth/social/start', {
      body: {
        provider,
        intent: 'SIGN_IN',
        callbackUrl: `${window.location.origin}${withLocale('/auth/social/callback', uiLocale)}`,
      },
    });
    if (r.ok && r.data) {
      window.location.assign(r.data.authorizeUrl);
      return;
    }
    setBusy(null);
    setError(
      r.errors[0]?.code === 'SOCIAL_SIGN_IN_UNAVAILABLE'
        ? t('cx.so.unavailable', { provider: providerName(t, provider) })
        : errorMessage(locale, r.errors),
    );
  };
  return (
    <div className="dd-stack dd-social" style={{ gap: 10 }} data-testid="social-buttons">
      {PROVIDERS.map((p) => (
        <button
          key={p}
          type="button"
          className={`dd-btn dd-btn--block dd-social__btn dd-social__btn--${p.toLowerCase()}`}
          onClick={() => void start(p)}
          disabled={busy !== null}
          aria-busy={busy === p}
          data-testid={`social-${p.toLowerCase()}`}
        >
          {p === 'GOOGLE' ? <GoogleMark /> : <AppleMark />}
          <span>
            {busy === p
              ? t('cx.so.working')
              : t('cx.so.continue', { provider: providerName(t, p) })}
          </span>
        </button>
      ))}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

// ---------------------------------------------------------------- callback (and the development provider screen)
export function SocialCallbackPage() {
  const params = useSearchParams();
  const mock = params.get('mock_social') as SocialProvider | null;
  const state = params.get('state');
  if (mock && state && PROVIDERS.includes(mock))
    return <MockProviderScreen provider={mock} state={state} />;
  return <SocialFinish state={state} code={params.get('code')} error={params.get('error')} />;
}

const TEST_ACCOUNTS: Record<
  SocialProvider,
  Array<{ subject: string; name: string; email: string }>
> = {
  GOOGLE: [
    { subject: 'sara', name: 'Sara Ahmed', email: 'sara.demo@gmail.com' },
    { subject: 'omar', name: 'Omar Khan', email: 'omar.demo@gmail.com' },
  ],
  APPLE: [{ subject: 'sara', name: 'Sara Ahmed', email: 'sara.demo@privaterelay.appleid.com' }],
};

/**
 * Development stand-in for the Google / Apple consent screen: approve with a test account (or another one), cancel, or fail. It returns
 * to the callback exactly as the provider would (state + code, or an error), so the real flow after it is unchanged.
 */
function MockProviderScreen({ provider, state }: { provider: SocialProvider; state: string }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [other, setOther] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = (q: string) => router.replace(`${pathname}?state=${encodeURIComponent(state)}&${q}`);
  const approve = async (a: { subject: string; name: string | null; email: string | null }) => {
    setBusy(true);
    setError(null);
    const r = await call<{ code: string }>('POST', '/v1/dev/social/approve', {
      body: { state, provider, ...a },
    });
    if (r.ok && r.data) back(`code=${encodeURIComponent(r.data.code)}`);
    else {
      setBusy(false);
      setError(errorMessage(locale, r.errors));
    }
  };
  const label = providerName(t, provider);
  return (
    <div className="dd-stack dd-mockauth" style={{ gap: 14 }} data-testid="mock-provider">
      <div className={`dd-mockauth__head dd-mockauth__head--${provider.toLowerCase()}`}>
        {provider === 'GOOGLE' ? <GoogleMark /> : <AppleMark />}
        <h1 className="dd-title" style={{ margin: 0 }}>
          {t('cx.so.mockTitle', { provider: label })}
        </h1>
      </div>
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('cx.so.mockBody', { provider: label })}
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <ul className="dd-mockauth__list">
        {TEST_ACCOUNTS[provider].map((a) => (
          <li key={a.subject}>
            <button
              type="button"
              className="dd-mockauth__account"
              disabled={busy}
              onClick={() => void approve(a)}
              data-testid={`mock-account-${a.subject}`}
            >
              <span className="dd-mockauth__avatar" aria-hidden="true">
                {a.name.slice(0, 1)}
              </span>
              <span className="dd-grow">
                <strong>{a.name}</strong>
                <span className="dd-caption dd-ltr" style={{ display: 'block' }}>
                  {a.email}
                </span>
              </span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="dd-mockauth__account"
            onClick={() => setOther((o) => !o)}
            disabled={busy}
          >
            <span className="dd-mockauth__avatar" aria-hidden="true">
              <Icon name="user" size={16} />
            </span>
            <span className="dd-grow">{t('cx.so.mockOther')}</span>
          </button>
        </li>
      </ul>
      {other ? (
        <form
          className="dd-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void approve({
              subject: email.trim().toLowerCase(),
              name: name.trim() || null,
              email: email.trim() || null,
            });
          }}
        >
          <Field label={t('cx.so.mockName')} htmlFor="mock-name">
            <Input
              id="mock-name"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label={t('cx.so.mockEmail')} htmlFor="mock-email">
            <Input
              id="mock-email"
              type="email"
              dir="ltr"
              required
              value={email}
              maxLength={254}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={busy}>
            {t('cx.so.next')}
          </Button>
        </form>
      ) : null}
      <div className="dd-row" style={{ flexWrap: 'wrap' }}>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => back('error=access_denied')}
          data-testid="mock-cancel"
        >
          {t('cx.so.mockCancel')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => back('error=server_error')}
          data-testid="mock-fail"
        >
          {t('cx.so.mockFail')}
        </Button>
      </div>
    </div>
  );
}

type Outcome =
  | { kind: 'working' }
  | { kind: 'result'; r: SocialCallbackResult }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

function readNext() {
  try {
    return safeNext(sessionStorage.getItem(NEXT_KEY)) ?? '/';
  } catch {
    return '/';
  }
}

function SocialFinish({
  state,
  code,
  error,
}: {
  state: string | null;
  code: string | null;
  error: string | null;
}) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { refresh } = useAuth();
  const router = useRouter();
  const href = useHref();
  const [out, setOut] = useState<Outcome>({ kind: 'working' });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!state) {
      setOut({ kind: 'expired' });
      return;
    }
    void call<SocialCallbackResult>('POST', '/v1/auth/social/callback', {
      body: { state, ...(code ? { code } : {}), ...(error ? { error } : {}) },
    }).then(async (r) => {
      if (!r.ok || !r.data) {
        setOut(
          r.errors[0]?.code === 'SOCIAL_SIGN_IN_EXPIRED'
            ? { kind: 'expired' }
            : { kind: 'error', message: errorMessage(locale, r.errors) },
        );
        return;
      }
      if (r.data.status === 'SIGNED_IN') {
        await refresh();
        router.replace(withLocale(readNext(), locale));
        return;
      }
      setOut({ kind: 'result', r: r.data });
    });
  }, [call, code, error, locale, refresh, router, state]);

  const backToSignIn = (
    <Link className="dd-btn dd-btn--primary dd-btn--block" href={href('/profile')}>
      {t('cx.so.back')}
    </Link>
  );
  if (out.kind === 'working')
    return (
      <div data-testid="social-working">
        <LoadingState label={t('cx.so.working')} />
      </div>
    );
  if (out.kind === 'expired' || out.kind === 'error')
    return (
      <div className="dd-stack" data-testid="social-outcome">
        <Alert tone="danger">{out.kind === 'expired' ? t('cx.so.expired') : out.message}</Alert>
        {backToSignIn}
      </div>
    );
  const r = out.r;
  const name = providerName(t, r.provider);
  if (r.status === 'NEEDS_PHONE' && r.linkToken)
    return <PhoneStep linkToken={r.linkToken} provider={r.provider} profile={r.profile} />;
  if (r.status === 'LINKED')
    return (
      <div className="dd-stack" data-testid="social-outcome">
        <Alert tone="success">{t('cx.so.linked', { provider: name })}</Alert>
        <Link className="dd-btn dd-btn--primary dd-btn--block" href={href('/account')}>
          {t('cx.so.next')}
        </Link>
      </div>
    );
  return (
    <div className="dd-stack" data-testid="social-outcome">
      <Alert tone={r.status === 'CANCELLED' ? 'info' : 'danger'}>
        {r.status === 'CANCELLED'
          ? t('cx.so.cancelled')
          : r.status === 'CONFLICT'
            ? t('cx.so.conflict', { provider: name })
            : t('cx.so.failed', { provider: name })}
      </Alert>
      {r.intent === 'LINK' ? (
        <Link className="dd-btn dd-btn--primary dd-btn--block" href={href('/account')}>
          {t('cx.so.next')}
        </Link>
      ) : (
        backToSignIn
      )}
    </div>
  );
}

/** After a first Google / Apple sign-in: confirm the phone number (links to that account, or creates the account). */
function PhoneStep({
  linkToken,
  provider,
  profile,
}: {
  linkToken: string;
  provider: SocialProvider;
  profile: { name: string | null; email: string | null } | null;
}) {
  const { t, locale } = useT();
  const { call } = useApi();
  const { apiUrl, refresh } = useAuth();
  const router = useRouter();
  const [mobile, setMobile] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [done, setDone] = useState<SocialCompleteResult['account'] | null>(null);
  const name = providerName(t, provider);
  const send = async () => {
    setBusy(true);
    setError(null);
    const r = await call('POST', '/v1/auth/otp/request', {
      body: { mobile: mobile.trim(), audience: 'customer' },
    });
    setBusy(false);
    if (!r.ok) return setError(errorMessage(locale, r.errors));
    setSent(true);
    if (isDev)
      try {
        const res = await fetch(
          `${apiUrl}/v1/dev/last-sms?to=${encodeURIComponent(mobile.trim())}`,
        );
        const json = (await res.json()) as { data?: { code?: string | null } | null };
        setDevCode(json.data?.code ?? null);
      } catch {
        setDevCode(null);
      }
  };
  const finish = async (value = code) => {
    setBusy(true);
    setError(null);
    const r = await call<SocialCompleteResult>('POST', '/v1/auth/social/complete', {
      body: { linkToken, mobile: mobile.trim(), code: value },
    });
    setBusy(false);
    if (!r.ok || !r.data) {
      setCode('');
      return setError(errorMessage(locale, r.errors));
    }
    await refresh();
    setDone(r.data.account);
  };
  if (done)
    return (
      <div className="dd-stack" data-testid="social-outcome">
        <Alert tone={done === 'NOT_LINKED' ? 'info' : 'success'}>
          {done === 'EXISTING'
            ? t('cx.so.linkedExisting', { provider: name })
            : done === 'NEW'
              ? t('cx.so.linkedNew', { provider: name })
              : t('cx.so.notLinked', { provider: name })}
        </Alert>
        <Button block onClick={() => router.replace(withLocale(readNext(), locale))}>
          {t('cx.so.next')}
        </Button>
      </div>
    );
  return (
    <Card>
      <div className="dd-stack" data-testid="social-phone">
        <h1 className="dd-title" style={{ margin: 0 }}>
          {t('cx.so.phoneTitle')}
        </h1>
        {profile?.name || profile?.email ? (
          <p className="dd-caption" style={{ margin: 0 }}>
            {t('cx.so.as', { provider: name, name: profile.name ?? profile.email ?? '' })}
          </p>
        ) : null}
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('cx.so.phoneBody', { provider: name })}
        </p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!sent ? (
          <form
            className="dd-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <Field label={t('cx.so.mobile')} htmlFor="social-mobile">
              <Input
                id="social-mobile"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                placeholder="+966500000001"
                required
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            </Field>
            <Button type="submit" loading={busy} block data-testid="social-send">
              {t('cx.so.sendCode')}
            </Button>
          </form>
        ) : (
          <div className="dd-stack">
            <p style={{ margin: 0 }}>{t('cx.so.codeSent', { mobile: mobile.trim() })}</p>
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={(v) => void finish(v)}
              disabled={busy}
              aria-label={t('cx.so.code')}
              invalid={!!error}
            />
            {isDev && devCode ? (
              <Alert tone="info" title={t('shell.devCode')}>
                <span className="dd-ltr">{devCode}</span>
              </Alert>
            ) : null}
            <Button
              loading={busy}
              disabled={code.length !== 6}
              onClick={() => void finish()}
              data-testid="social-confirm"
            >
              {t('cx.so.confirm')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- linked accounts (Account settings)
export function LinkedAccounts() {
  const { t, locale } = useT();
  const { call } = useApi();
  const { uiLocale } = useAuth();
  const [data, setData] = useState<LinkedIdentities | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  const load = useCallback(async () => {
    const r = await call<LinkedIdentities>('GET', '/v1/app/me/identities');
    // an unexpected answer never breaks Account settings: the card simply offers linking
    setData(
      r.ok && r.data && Array.isArray(r.data.items) && Array.isArray(r.data.available)
        ? r.data
        : { items: [], available: [] },
    );
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);
  const link = async (provider: SocialProvider) => {
    setBusy(provider);
    setMsg(null);
    try {
      sessionStorage.setItem(NEXT_KEY, '/account');
    } catch {
      /* ignore */
    }
    const r = await call<{ authorizeUrl: string }>('POST', '/v1/auth/social/start', {
      body: {
        provider,
        intent: 'LINK',
        callbackUrl: `${window.location.origin}${withLocale('/auth/social/callback', uiLocale)}`,
      },
    });
    if (r.ok && r.data) return window.location.assign(r.data.authorizeUrl);
    setBusy(null);
    setMsg({ tone: 'danger', text: errorMessage(locale, r.errors) });
  };
  const unlink = async (provider: SocialProvider) => {
    setBusy(provider);
    const r = await call<LinkedIdentities>('DELETE', `/v1/app/me/identities/${provider}`);
    setBusy(null);
    if (r.ok && r.data && Array.isArray(r.data.items)) {
      setData(r.data);
      setMsg({
        tone: 'success',
        text: t('cx.so.unlinked', { provider: providerName(t, provider) }),
      });
    } else setMsg({ tone: 'danger', text: errorMessage(locale, r.errors) });
  };
  return (
    <Card id="linked-accounts">
      <div className="dd-stack" data-testid="linked-accounts">
        <h2 className="dd-title">{t('cx.so.title')}</h2>
        <p className="dd-help" style={{ margin: 0 }}>
          {t('cx.so.help')}
        </p>
        {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
        {!data ? (
          <LoadingState label={t('state.loading')} />
        ) : (
          <ul className="dd-benlist">
            {PROVIDERS.map((p) => {
              const linked = data.items.find((i) => i.provider === p);
              const can = data.available.includes(p);
              return (
                <li key={p} className="dd-benlist__item" data-testid={`linked-${p.toLowerCase()}`}>
                  <span className="dd-social__mark" aria-hidden="true">
                    {p === 'GOOGLE' ? <GoogleMark /> : <AppleMark />}
                  </span>
                  <div className="dd-grow" style={{ minInlineSize: 0 }}>
                    <strong>{providerName(t, p)}</strong>
                    <div className="dd-caption dd-ltr" style={{ overflowWrap: 'anywhere' }}>
                      {linked ? (linked.email ?? '') : ''}
                    </div>
                  </div>
                  {linked ? (
                    <>
                      <StatusChip tone="success">{t('cx.so.isLinked')}</StatusChip>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === p}
                        onClick={() => void unlink(p)}
                        data-testid={`unlink-${p.toLowerCase()}`}
                      >
                        {t('cx.so.unlink')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!can}
                      loading={busy === p}
                      onClick={() => void link(p)}
                      data-testid={`link-${p.toLowerCase()}`}
                    >
                      {t('cx.so.link')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- saved cards
export const BRAND_LABEL: Record<SavedCard['brand'], string> = {
  VISA: 'Visa',
  MASTERCARD: 'Mastercard',
  MADA: 'mada',
  AMEX: 'American Express',
  OTHER: '••••',
};
export function cardLabel(t: ReturnType<typeof useT>['t'], c: Pick<SavedCard, 'brand' | 'last4'>) {
  return t('cx.pm.ending', { brand: BRAND_LABEL[c.brand], last4: c.last4 });
}
function BrandChip({ brand }: { brand: SavedCard['brand'] }) {
  return (
    <span className={`dd-cardbrand dd-cardbrand--${brand.toLowerCase()}`} aria-hidden="true">
      {brand === 'OTHER' ? <Icon name="card" size={18} /> : BRAND_LABEL[brand]}
    </span>
  );
}

/** The customer's saved cards (for the payment methods page and the reserve sheet). */
export function useSavedCards(enabled: boolean) {
  const { call } = useApi();
  const [data, setData] = useState<SavedCardList | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!enabled) return;
    setFailed(false);
    const r = await call<SavedCardList>('GET', '/v1/app/payment-methods');
    if (r.ok && r.data && Array.isArray(r.data.items)) setData(r.data);
    else setFailed(true);
  }, [call, enabled]);
  useEffect(() => {
    void load();
  }, [load]);
  return { data, failed, reload: load, set: setData };
}

const SETUP_MESSAGES: Record<string, DictionaryKey> = {
  COMPLETED: 'cx.pm.saved',
  CANCELLED: 'cx.pm.cancelled',
  FAILED: 'cx.pm.failed',
};

export function PaymentMethodsPage() {
  const { t, locale } = useT();
  const { status, uiLocale } = useAuth();
  const { call } = useApi();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const mockRef = params.get('mock_setup');
  const setupId = params.get('setup');
  const signedIn = status === 'authenticated';
  const cards = useSavedCards(signedIn && !mockRef);
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(
    null,
  );
  const finishing = useRef<string | null>(null);

  // back from the provider's card page: ask the API (which asks the provider) what happened
  useEffect(() => {
    if (!signedIn || !setupId || mockRef || finishing.current === setupId) return;
    finishing.current = setupId;
    setMsg({ tone: 'info', text: t('cx.pm.checking') });
    void (async () => {
      let r = await call<CardSetupResult>(
        'POST',
        `/v1/app/payment-methods/setups/${setupId}/finish`,
      );
      for (let i = 0; i < 3 && r.ok && r.data?.status === 'PENDING'; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        r = await call<CardSetupResult>('POST', `/v1/app/payment-methods/setups/${setupId}/finish`);
      }
      if (!r.ok || !r.data) setMsg({ tone: 'danger', text: errorMessage(locale, r.errors) });
      else if (r.data.status === 'COMPLETED')
        setMsg({
          tone: 'success',
          text: r.data.duplicate ? t('cx.pm.duplicate') : t('cx.pm.saved'),
        });
      else
        setMsg({
          tone: r.data.status === 'CANCELLED' ? 'info' : 'danger',
          text: t(SETUP_MESSAGES[r.data.status] ?? 'cx.pm.failed'),
        });
      router.replace(pathname);
      await cards.reload();
    })();
  }, [signedIn, setupId, mockRef, call, locale, t, router, pathname, cards]);

  if (mockRef) return <MockCardPage setupRef={mockRef} setupId={setupId} />;
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (!signedIn)
    return (
      <div className="dd-stack" data-testid="payment-methods">
        <h1 className="dd-title-xl">{t('cx.pm.title')}</h1>
        <LoginPanel />
      </div>
    );

  const add = async () => {
    setBusy('add');
    setMsg(null);
    const r = await call<{ setupId: string; redirectUrl: string }>(
      'POST',
      '/v1/app/payment-methods/setups',
      {
        body: {
          returnUrl: `${window.location.origin}${withLocale('/payment-methods', uiLocale)}`,
          makeDefault,
        },
      },
    );
    if (r.ok && r.data) return window.location.assign(r.data.redirectUrl);
    setBusy(null);
    setMsg({ tone: 'danger', text: errorMessage(locale, r.errors) });
  };
  const setDefault = async (id: string) => {
    setBusy(id);
    const r = await call<SavedCardList>('PUT', `/v1/app/payment-methods/${id}/default`);
    setBusy(null);
    if (r.ok && r.data) {
      cards.set(r.data);
      setMsg({ tone: 'success', text: t('cx.pm.defaultSet') });
    } else setMsg({ tone: 'danger', text: errorMessage(locale, r.errors) });
  };
  const remove = async (id: string) => {
    setBusy(id);
    const r = await call<SavedCardList>('DELETE', `/v1/app/payment-methods/${id}`);
    setBusy(null);
    setConfirm(null);
    if (r.ok && r.data) {
      cards.set(r.data);
      setMsg({ tone: 'success', text: t('cx.pm.removed') });
    } else setMsg({ tone: 'danger', text: errorMessage(locale, r.errors) });
  };

  const list = cards.data;
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid="payment-methods">
      <div>
        <h1 className="dd-title-xl">{t('cx.pm.title')}</h1>
        <p className="dd-muted" style={{ margin: 0 }}>
          {t('cx.pm.sub')}
        </p>
      </div>
      {msg ? (
        <div data-testid="pm-message">
          <Alert tone={msg.tone}>{msg.text}</Alert>
        </div>
      ) : null}
      {cards.failed && !list ? (
        <Alert tone="danger">{t('cust.loadError')}</Alert>
      ) : !list ? (
        <LoadingState label={t('state.loading')} />
      ) : (
        <>
          {list.items.length ? (
            <ul className="dd-pmlist" data-testid="saved-cards">
              {list.items.map((c) => (
                <li key={c.id} className="dd-pmcard" data-testid="saved-card">
                  <div className="dd-pmcard__row">
                    <BrandChip brand={c.brand} />
                    <div className="dd-grow" style={{ minInlineSize: 0 }}>
                      <strong>{cardLabel(t, c)}</strong>
                      <div className="dd-caption">
                        {c.expired ? (
                          <span className="dd-closed">{t('cx.pm.expired')}</span>
                        ) : (
                          t('cx.pm.expires', {
                            date: `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}`,
                          })
                        )}
                      </div>
                    </div>
                    {c.isDefault ? (
                      <StatusChip tone="success">{t('cx.pm.default')}</StatusChip>
                    ) : null}
                  </div>
                  {confirm === c.id ? (
                    <div className="dd-bencard__confirm" role="alert">
                      <p style={{ margin: 0 }}>{t('cx.pm.removeConfirm')}</p>
                      <div className="dd-row">
                        <Button
                          size="sm"
                          variant="danger"
                          loading={busy === c.id}
                          onClick={() => void remove(c.id)}
                          data-testid="card-remove-confirm"
                        >
                          {t('cx.pm.remove')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                          {t('cx.pm.keep')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="dd-row" style={{ flexWrap: 'wrap' }}>
                      {!c.isDefault && !c.expired ? (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={busy === c.id}
                          onClick={() => void setDefault(c.id)}
                          data-testid="card-make-default"
                        >
                          {t('cx.pm.makeDefault')}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirm(c.id)}
                        data-testid="card-remove"
                      >
                        {t('cx.pm.remove')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t('cx.pm.empty')} description={t('cx.pm.emptyBody')} />
          )}
          {list.canSave ? (
            <Card flat>
              <div className="dd-stack">
                {list.items.length ? (
                  <Checkbox
                    label={t('cx.pm.asDefault')}
                    checked={makeDefault}
                    onChange={(e) => setMakeDefault(e.target.checked)}
                  />
                ) : null}
                <Button
                  onClick={() => void add()}
                  loading={busy === 'add'}
                  block
                  data-testid="card-add-new"
                >
                  <Icon name="plus" size={18} /> {t('cx.pm.add')}
                </Button>
                <p className="dd-caption" style={{ margin: 0 }}>
                  <Icon name="lock" size={13} /> {t('cx.pm.secure')}
                </p>
              </div>
            </Card>
          ) : (
            <Alert tone="info">{t('cx.pm.unavailable')}</Alert>
          )}
        </>
      )}
    </div>
  );
}

const MOCK_CARDS: Array<{ id: string; brand: SavedCard['brand']; last4: string } | null> = [
  { id: 'VISA_4242', brand: 'VISA', last4: '4242' },
  { id: 'MASTERCARD_5454', brand: 'MASTERCARD', last4: '5454' },
  { id: 'MADA_1234', brand: 'MADA', last4: '1234' },
  null,
];

/**
 * Development stand-in for the payment provider's hosted "add a card" page. The tester picks a TEST card: no card number is typed,
 * sent or stored anywhere. Then it returns to the app, which asks the API to finish the setup (the API reads the provider's outcome).
 */
function MockCardPage({ setupRef, setupId }: { setupRef: string; setupId: string | null }) {
  const { t, locale } = useT();
  const { call } = useApi();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [card, setCard] = useState('VISA_4242');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finish = async (outcome: 'SAVED' | 'CANCELLED') => {
    setBusy(true);
    setError(null);
    const r = await call(
      'POST',
      `/v1/dev/payment-methods/${encodeURIComponent(setupRef)}/complete`,
      {
        body: { outcome, card: card === 'DECLINED' ? 'DECLINED' : card },
      },
    );
    if (!r.ok) {
      setBusy(false);
      return setError(errorMessage(locale, r.errors));
    }
    router.replace(setupId ? `${pathname}?setup=${encodeURIComponent(setupId)}` : pathname);
  };
  return (
    <div className="dd-stack dd-mockpay" style={{ gap: 14 }} data-testid="mock-card-page">
      <h1 className="dd-title" style={{ margin: 0 }}>
        {t('cx.pm.mockTitle')}
      </h1>
      <p className="dd-muted" style={{ margin: 0 }}>
        {t('cx.pm.mockBody')}
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0 }}>
        {MOCK_CARDS.map((c) => {
          const id = c?.id ?? 'DECLINED';
          return (
            <label key={id} className={`dd-hot-pick ${card === id ? 'dd-hot-pick--on' : ''}`}>
              <input
                type="radio"
                name="mock-card"
                value={id}
                checked={card === id}
                onChange={() => setCard(id)}
                data-testid={`mock-card-${id}`}
              />
              {c ? <BrandChip brand={c.brand} /> : <BrandChip brand="OTHER" />}
              <span className="dd-grow">
                {c
                  ? t('cx.pm.mockCard', { brand: BRAND_LABEL[c.brand], last4: c.last4 })
                  : t('cx.pm.mockDeclined')}
              </span>
            </label>
          );
        })}
      </fieldset>
      <Button
        onClick={() => void finish('SAVED')}
        loading={busy}
        block
        data-testid="mock-card-save"
      >
        {t('cx.pm.mockSave')}
      </Button>
      <Button
        variant="secondary"
        onClick={() => void finish('CANCELLED')}
        disabled={busy}
        block
        data-testid="mock-card-cancel"
      >
        {t('cx.pm.mockCancel')}
      </Button>
    </div>
  );
}

/**
 * "Pay with" in the reserve sheet: the customer's default card is chosen; they can switch to another saved card or to a new card on
 * the payment page. Only the chosen card's id is sent; the provider charges its own token (no card details in DealDash).
 */
export function PayWith({
  cards,
  value,
  onChange,
}: {
  cards: SavedCard[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const { t } = useT();
  const href = useHref();
  const [open, setOpen] = useState(false);
  const usable = cards.filter((c) => !c.expired);
  const chosen = usable.find((c) => c.id === value) ?? null;
  return (
    <div className="dd-paywith" data-testid="pay-with">
      <div className="dd-paywith__row">
        <span className="dd-caption">{t('cx.pm.payWith')}</span>
        <div className="dd-paywith__choice">
          {chosen ? <BrandChip brand={chosen.brand} /> : <Icon name="card" size={18} />}
          <strong data-testid="pay-with-value">
            {chosen ? cardLabel(t, chosen) : t('cx.pm.newCard')}
          </strong>
        </div>
        {usable.length ? (
          <button
            type="button"
            className="dd-link"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            data-testid="pay-with-change"
          >
            {t('cx.pm.change')}
          </button>
        ) : null}
      </div>
      {open ? (
        <fieldset className="dd-stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }}>
          <legend className="dd-label">{t('cx.pm.choose')}</legend>
          {[...usable.map((c) => c.id), null].map((id) => {
            const c = usable.find((x) => x.id === id);
            return (
              <label
                key={id ?? 'new'}
                className={`dd-hot-pick ${value === id ? 'dd-hot-pick--on' : ''}`}
              >
                <input
                  type="radio"
                  name="pay-with"
                  checked={value === id}
                  onChange={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                  data-testid={`pay-with-${id ?? 'new'}`}
                />
                {c ? <BrandChip brand={c.brand} /> : <Icon name="card" size={18} />}
                <span className="dd-grow">
                  {c ? cardLabel(t, c) : t('cx.pm.newCard')}
                  {c?.isDefault ? (
                    <span className="dd-caption"> · {t('cx.pm.default')}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
          <Link className="dd-link" href={href('/payment-methods')}>
            {t('cx.pm.manage')}
          </Link>
        </fieldset>
      ) : null}
    </div>
  );
}

/** The card a mock payment page is charging (development payment page only). */
export function useMockCard(token: string | null) {
  const { call } = useApi();
  const [card, setCard] = useState<{ brand: SavedCard['brand']; last4: string } | null>(null);
  useEffect(() => {
    if (!token) return;
    void call<{ brand: SavedCard['brand']; last4: string } | null>(
      'GET',
      `/v1/dev/payment-methods/cards/${encodeURIComponent(token)}`,
    ).then((r) => setCard(r.ok && r.data && r.data.last4 ? r.data : null));
  }, [call, token]);
  return card;
}
