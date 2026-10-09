'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, withLocale } from '@dealdash/localization';
import { Alert, Button, Card, Field, Input, LoadingState } from '@dealdash/ui';
import { passwordPolicySchema } from '@dealdash/validation';
import { useCommand } from './forms';

interface Preview {
  name: string;
  organizationName: string;
  roleCode: string;
  signInWith: 'EMAIL' | 'MOBILE';
}

/** Public page opened from the invitation link. E-mail roles choose a password; staff sign in later with SMS codes. */
export function AcceptInvite({ token }: { token: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const cmd = useCommand();
  const [preview, setPreview] = useState<Preview | null | 'invalid'>(null);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    void call<Preview>('GET', `/v1/merchant-signup/invitations/${encodeURIComponent(token)}`).then(
      (r) => {
        if (alive) setPreview(r.ok && r.data ? r.data : 'invalid');
      },
    );
    return () => {
      alive = false;
    };
  }, [call, token]);

  if (preview === null) return <LoadingState label={t('state.loading')} />;
  if (preview === 'invalid') {
    return (
      <Card>
        <Alert tone="danger">{t('invite.invalid')}</Alert>
      </Card>
    );
  }
  if (done) {
    return (
      <Card>
        <div className="dd-stack">
          <Alert tone="success">
            {preview.signInWith === 'MOBILE' ? t('invite.doneStaff') : t('invite.done')}
          </Alert>
          <Link href={withLocale('/', locale)}>{t('auth.signIn')}</Link>
        </div>
      </Card>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const needsPassword = (preview as Preview).signInWith === 'EMAIL';
    if (needsPassword) {
      const p = passwordPolicySchema.safeParse(password);
      if (!p.success)
        return cmd.fail(t('form.fixErrors'), {
          password: locale === 'en' ? (p.error.issues[0]?.message ?? '') : t('form.invalid'),
        });
    }
    const res = await cmd.exec(() =>
      call('POST', `/v1/merchant-signup/invitations/${encodeURIComponent(token)}/accept`, {
        body: needsPassword ? { password } : {},
      }),
    );
    if (res.ok) setDone(true);
  }

  return (
    <Card>
      <form className="dd-stack" onSubmit={submit} noValidate>
        <h1 className="dd-title">{t('invite.title', { name: preview.organizationName })}</h1>
        <p className="dd-muted">{t('invite.hello', { name: preview.name })}</p>
        {cmd.error ? <Alert tone="danger">{cmd.error}</Alert> : null}
        {preview.signInWith === 'EMAIL' ? (
          <Field
            label={t('invite.choosePassword')}
            htmlFor="inv-pw"
            help={t('signup.passwordHelp')}
            error={cmd.fields.password}
          >
            <Input
              id="inv-pw"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              invalid={!!cmd.fields.password}
            />
          </Field>
        ) : (
          <p className="dd-muted">{t('invite.staffHint')}</p>
        )}
        <Button type="submit" loading={cmd.busy} block>
          {t('invite.accept')}
        </Button>
      </form>
    </Card>
  );
}
