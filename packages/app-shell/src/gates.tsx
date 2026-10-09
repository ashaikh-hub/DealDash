import type { ReactNode } from 'react';
import { hasAnyPermission } from '@dealdash/auth';
import {
  createTranslator,
  dictionaries,
  type DictionaryKey,
  type Locale,
} from '@dealdash/localization';
import type { ApiErrorItem, PermissionCode } from '@dealdash/types';
import { Alert, Card, LoadingState } from '@dealdash/ui';
import { useAuth } from './auth-context';
import { LoginPanel } from './login-panel';

/** Shows the sign-in panel until the user is fully signed in (including the second factor when required). */
export function RequireAuth({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const { status, needsMfa, locale } = useAuth();
  const t = createTranslator(locale);
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status === 'anonymous' || needsMfa) {
    return (
      <div className="dd-stack">
        <LoginPanel />
        {footer}
      </div>
    );
  }
  return <>{children}</>;
}

/** UI-level permission check. The API enforces permissions regardless; this only avoids dead-end screens. */
export function RequirePermission({
  any,
  children,
}: {
  any: readonly PermissionCode[];
  children: ReactNode;
}) {
  const { me, locale } = useAuth();
  const t = createTranslator(locale);
  if (!hasAnyPermission(me?.permissions ?? [], any)) {
    return (
      <Card>
        <Alert tone="warning">{t('shell.noAccess')}</Alert>
      </Card>
    );
  }
  return <>{children}</>;
}

const hasKey = (key: string): key is DictionaryKey => key in dictionaries.en;

/** User-facing message for an API error: translated by stable code; English also shows the server detail. */
export function errorMessage(locale: Locale, errors: readonly ApiErrorItem[]): string {
  const t = createTranslator(locale);
  const first = errors[0];
  if (!first) return t('error.generic');
  const key = `error.${first.code}`;
  const base = hasKey(key) ? t(key) : t('error.generic');
  return locale === 'en' && first.message && first.code !== 'INTERNAL' && !hasKey(key)
    ? first.message
    : base;
}

/** Per-field messages: the server text in English, a generic translated message in Arabic. */
export function fieldErrors(
  locale: Locale,
  errors: readonly ApiErrorItem[],
): Record<string, string> {
  const t = createTranslator(locale);
  const out: Record<string, string> = {};
  for (const e of errors) {
    if (!e.field || out[e.field]) continue;
    out[e.field] = locale === 'en' ? e.message : t('form.invalid');
  }
  return out;
}
