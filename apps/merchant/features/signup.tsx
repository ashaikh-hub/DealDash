'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, withLocale } from '@dealdash/localization';
import type { MeView } from '@dealdash/types';
import { Alert, Button, Card, Field, Input, OtpInput } from '@dealdash/ui';
import { merchantRegisterSchema } from '@dealdash/validation';
import { useCommand, validateWith } from './forms';

/** Public merchant sign-up: account details, then the e-mail verification code. Verified users land in onboarding. */
export function SignupFlow() {
  const { locale, apiUrl, setSession } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const router = useRouter();
  const cmd = useCommand();
  const isDev = process.env.NODE_ENV !== 'production';

  const [step, setStep] = useState<'details' | 'verify'>('details');
  const [form, setForm] = useState({ tradeNameEn: '', tradeNameAr: '', email: '', password: '' });
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function showDevCode(email: string) {
    if (!isDev) return;
    try {
      const r = await fetch(
        `${apiUrl}/v1/dev/last-email?to=${encodeURIComponent(email)}&template=merchant.email_verify`,
      );
      const json = (await r.json()) as { data?: { code?: string | null } | null };
      setDevCode(json.data?.code ?? null);
    } catch {
      setDevCode(null);
    }
  }

  async function register(e: FormEvent) {
    e.preventDefault();
    const v = validateWith(
      merchantRegisterSchema,
      { ...form, tradeNameAr: form.tradeNameAr || undefined },
      locale,
    );
    if (!v.ok) return cmd.fail(t('form.fixErrors'), v.fields);
    const res = await cmd.exec(() =>
      call('POST', '/v1/merchant-signup/register', { body: v.data }),
    );
    if (res.ok) {
      setStep('verify');
      await showDevCode(v.data.email);
    }
  }

  async function verify(value: string) {
    const res = await cmd.exec(() =>
      call<{
        organizationId: string | null;
        login: { csrfToken: string; mfaRequired: boolean; me: MeView };
      }>('POST', '/v1/merchant-signup/verify-email', {
        body: { email: form.email.trim().toLowerCase(), code: value },
      }),
    );
    if (res.ok && res.data) {
      setSession(res.data.login.me, res.data.login.csrfToken, false);
      router.push(withLocale('/onboarding', locale));
    }
  }

  async function resend() {
    const res = await cmd.exec(() =>
      call('POST', '/v1/merchant-signup/resend-code', {
        body: { email: form.email.trim().toLowerCase() },
      }),
    );
    if (res.ok) await showDevCode(form.email.trim().toLowerCase());
  }

  if (step === 'verify') {
    return (
      <Card aria-label={t('signup.verifyTitle')}>
        <div className="dd-stack">
          <h1 className="dd-title">{t('signup.verifyTitle')}</h1>
          <p className="dd-muted">{t('signup.verifyHint', { email: form.email })}</p>
          {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
          <OtpInput
            value={code}
            onChange={setCode}
            onComplete={(v) => void verify(v)}
            disabled={cmd.busy}
            aria-label={t('auth.code')}
            invalid={!!cmd.error}
          />
          {isDev && devCode ? (
            <Alert tone="info" title={t('shell.devCode')}>
              <span className="dd-ltr">{devCode}</span>
            </Alert>
          ) : null}
          <div className="dd-row">
            <Button variant="secondary" onClick={() => void resend()} disabled={cmd.busy}>
              {t('auth.resend')}
            </Button>
            <Button variant="ghost" onClick={() => setStep('details')}>
              {t('common.back')}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card aria-label={t('signup.title')}>
      <form className="dd-stack" onSubmit={register} noValidate>
        <h1 className="dd-title">{t('signup.title')}</h1>
        <p className="dd-muted">{t('signup.intro')}</p>
        {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
        <div className="dd-grid dd-grid--2">
          <Field label={t('signup.tradeNameEn')} htmlFor="s-tn-en" error={cmd.fields.tradeNameEn}>
            <Input
              id="s-tn-en"
              value={form.tradeNameEn}
              onChange={set('tradeNameEn')}
              invalid={!!cmd.fields.tradeNameEn}
              autoComplete="organization"
            />
          </Field>
          <Field label={t('signup.tradeNameAr')} htmlFor="s-tn-ar" error={cmd.fields.tradeNameAr}>
            <Input
              id="s-tn-ar"
              dir="rtl"
              value={form.tradeNameAr}
              onChange={set('tradeNameAr')}
              invalid={!!cmd.fields.tradeNameAr}
            />
          </Field>
        </div>
        <Field label={t('auth.email')} htmlFor="s-email" error={cmd.fields.email}>
          <Input
            id="s-email"
            type="email"
            dir="ltr"
            autoComplete="username"
            value={form.email}
            onChange={set('email')}
            invalid={!!cmd.fields.email}
          />
        </Field>
        <Field
          label={t('auth.password')}
          htmlFor="s-pw"
          help={t('signup.passwordHelp')}
          error={cmd.fields.password}
        >
          <Input
            id="s-pw"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            invalid={!!cmd.fields.password}
          />
        </Field>
        <Button type="submit" loading={cmd.busy} block>
          {t('signup.submit')}
        </Button>
        <p className="dd-caption">
          {t('signup.haveAccount')} <Link href={withLocale('/', locale)}>{t('auth.signIn')}</Link>
        </p>
      </form>
    </Card>
  );
}
