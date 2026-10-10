'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useApi, useAuth } from '@dealdash/app-shell';
import { createTranslator, withLocale } from '@dealdash/localization';
import { Alert, Button, Card, Field, Input, LoadingState } from '@dealdash/ui';
import { passwordPolicySchema } from '@dealdash/validation';
import { useCmd } from './utils';

interface Preview {
  name: string;
  organizationName: string;
  roleCode: string;
}

/** Public page opened from a partner invitation: the shared invitation record; the new account is a partner user. */
export function PartnerAcceptInvite({ token }: { token: string }) {
  const { locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const cmd = useCmd();
  const [preview, setPreview] = useState<Preview | null | 'invalid'>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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
  if (preview === 'invalid')
    return (
      <Card>
        <Alert tone="danger">{t('invite.invalid')}</Alert>
      </Card>
    );
  if (done)
    return (
      <Card>
        <div className="dd-stack" data-testid="pt-invite-done">
          <Alert tone="success">{t('invite.done')}</Alert>
          <Link href={withLocale('/', locale)}>{t('auth.signIn')}</Link>
        </div>
      </Card>
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const p = passwordPolicySchema.safeParse(password);
    if (!p.success)
      return setError(locale === 'en' ? (p.error.issues[0]?.message ?? '') : t('form.invalid'));
    setError('');
    const r = await cmd.run(
      'POST',
      `/v1/merchant-signup/invitations/${encodeURIComponent(token)}/accept`,
      { password },
    );
    if (r.ok) setDone(true);
  }

  return (
    <Card>
      <form className="dd-stack" onSubmit={submit} noValidate>
        <h1 className="dd-title">{t('invite.title', { name: preview.organizationName })}</h1>
        <p className="dd-muted">{t('invite.hello', { name: preview.name })}</p>
        {cmd.banner}
        <Field
          label={t('invite.choosePassword')}
          htmlFor="inv-pw"
          help={t('signup.passwordHelp')}
          error={error}
        >
          <Input
            id="inv-pw"
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            invalid={!!error}
          />
        </Field>
        <Button type="submit" loading={cmd.busy} block>
          {t('invite.accept')}
        </Button>
      </form>
    </Card>
  );
}
