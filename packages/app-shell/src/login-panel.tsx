import { useState, type FormEvent } from 'react';
import { createTranslator, type DictionaryKey } from '@dealdash/localization';
import { AUDIENCE_DEFINITIONS, type MeView } from '@dealdash/types';
import { Alert, Button, Card, Field, Input, OtpInput } from '@dealdash/ui';
import { errorCodeOf, useAuth } from './auth-context';

type Step = 'credentials' | 'code' | 'mfa';

/**
 * Sign-in for every app. Method comes from the audience definition:
 *  - otp           (customer, staff): mobile number then SMS code
 *  - password      (merchant, partner): work email + password (MFA step if the account has it)
 *  - password_mfa  (admin): password then mandatory two-step code
 * In development a hint shows the code captured by the mock SMS provider / TOTP helper.
 */
export function LoginPanel() {
  const { audience, locale, apiUrl, client, setSession, track } = useAuth();
  const t = createTranslator(locale);
  const method = AUDIENCE_DEFINITIONS[audience].loginMethod;
  const isDev = process.env.NODE_ENV !== 'production';

  const [step, setStep] = useState<Step>('credentials');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [csrf, setCsrf] = useState('');

  const fail = (res: unknown) => {
    const c = errorCodeOf(res);
    const key = `error.${c}` as DictionaryKey;
    setError(t((c !== 'GENERIC' ? key : 'error.generic') as DictionaryKey));
  };

  async function fetchDevCode(path: string) {
    if (!isDev) return;
    try {
      const r = await fetch(`${apiUrl}${path}`);
      const json = (await r.json()) as { data?: { code?: string | null } | null };
      setDevCode(json.data?.code ?? null);
    } catch {
      setDevCode(null);
    }
  }

  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (method === 'otp') {
        const res = await client.POST('/v1/auth/otp/request', {
          body: { mobile, audience: audience as 'customer' | 'staff' },
        });
        if (res.response.status !== 200) return fail(res.error);
        track('auth.otp_requested');
        setStep('code');
        await fetchDevCode(`/v1/dev/last-sms?to=${encodeURIComponent(mobile)}`);
      } else {
        const res = await client.POST('/v1/auth/login', {
          body: { email, password, audience: audience as 'merchant' | 'partner' | 'admin' },
        });
        if (res.response.status !== 200) return fail(res.error);
        const d = (res.data as { data: { mfaRequired: boolean; csrfToken: string; me: MeView } })
          .data;
        setCsrf(d.csrfToken);
        if (d.mfaRequired) {
          setStep('mfa');
          await fetchDevCode(`/v1/dev/totp?email=${encodeURIComponent(email)}`);
        } else {
          setSession(d.me, d.csrfToken, false);
          track('auth.signed_in');
        }
      }
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    setCode('');
    try {
      const res = await client.POST('/v1/auth/otp/request', {
        body: { mobile, audience: audience as 'customer' | 'staff' },
      });
      if (res.response.status !== 200) return fail(res.error);
      track('auth.otp_requested');
      setNotice(t('auth.codeSent'));
      await fetchDevCode(`/v1/dev/last-sms?to=${encodeURIComponent(mobile)}`);
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(value: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (step === 'code') {
        const res = await client.POST('/v1/auth/otp/verify', {
          body: { mobile, code: value, audience: audience as 'customer' | 'staff' },
        });
        if (res.response.status !== 200) {
          setCode(''); // wrong or expired: start the boxes again (the message never says how many tries remain)
          return fail(res.error);
        }
        const d = (res.data as { data: { csrfToken: string; me: MeView } }).data;
        setSession(d.me, d.csrfToken, false);
        track('auth.signed_in');
      } else {
        const res = await client.POST('/v1/auth/mfa/verify', {
          body: { code: value },
          headers: { 'X-CSRF-Token': csrf },
        } as never);
        if ((res as { response: Response }).response.status !== 200)
          return fail((res as { error: unknown }).error);
        const me = await client.GET('/v1/auth/me');
        const d = (me.data as { data: MeView & { csrfToken: string } }).data;
        const { csrfToken, ...rest } = d;
        setSession(rest as MeView, csrfToken, false);
        track('auth.signed_in');
      }
    } catch {
      setError(t('error.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card aria-label={t('auth.signIn')}>
      <div className="dd-stack">
        <h2 className="dd-title">{step === 'mfa' ? t('auth.mfaTitle') : t('auth.signIn')}</h2>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {notice && !error ? <Alert tone="success">{notice}</Alert> : null}

        {step === 'credentials' ? (
          <form className="dd-stack" onSubmit={submitCredentials}>
            {method === 'otp' ? (
              <Field label={t('auth.mobile')} htmlFor="mobile">
                <Input
                  id="mobile"
                  name="mobile"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  dir="ltr"
                  placeholder="+966500000001"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.trim())}
                  required
                />
              </Field>
            ) : (
              <>
                <Field label={t('auth.email')} htmlFor="email">
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </Field>
                <Field label={t('auth.password')} htmlFor="password">
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </Field>
              </>
            )}
            <Button type="submit" loading={busy} block>
              {method === 'otp' ? t('auth.sendCode') : t('auth.signIn')}
            </Button>
          </form>
        ) : (
          <div className="dd-stack">
            <p className="dd-muted">{step === 'mfa' ? t('auth.mfaHint') : mobile}</p>
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={submitCode}
              disabled={busy}
              aria-label={t('auth.code')}
              invalid={!!error}
            />
            {isDev && devCode ? (
              <Alert tone="info" title={t('shell.devCode')}>
                <span className="dd-ltr">{devCode}</span>
              </Alert>
            ) : null}
            {isDev && step === 'code' ? <p className="dd-caption">{t('auth.devHint')}</p> : null}
            {step === 'code' ? (
              <Button variant="outline" onClick={() => void resend()} disabled={busy}>
                {t('auth.resend')}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => {
                setStep('credentials');
                setCode('');
                setError(null);
                setNotice(null);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
