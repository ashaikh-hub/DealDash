import { NAV_BY_AUDIENCE, hasAnyPermission } from '@dealdash/auth';
import { createTranslator, type DictionaryKey } from '@dealdash/localization';
import { Alert, Card, EmptyState, LoadingState } from '@dealdash/ui';
import { useAuth } from './auth-context';
import { LoginPanel } from './login-panel';

/** Placeholder for pages that arrive in later stages. Demonstrates permission-aware access at the UI level. */
export function PlaceholderPage({ slug }: { slug: string[] }) {
  const { audience, locale, me, status } = useAuth();
  const t = createTranslator(locale);
  if (status === 'loading') return <LoadingState label={t('state.loading')} />;
  if (status === 'anonymous') return <LoginPanel />;

  const path = '/' + slug.join('/');
  const item = NAV_BY_AUDIENCE[audience].find(
    (i) => i.href === path || path.startsWith(i.href + '/'),
  );
  const allowed = !item?.requiresAny || hasAnyPermission(me?.permissions ?? [], item.requiresAny);
  if (!allowed) {
    return (
      <Card>
        <Alert tone="warning">{t('shell.noAccess')}</Alert>
      </Card>
    );
  }
  return (
    <Card>
      <EmptyState
        title={item ? t(item.labelKey as DictionaryKey) : path}
        description={t('shell.placeholder')}
      />
    </Card>
  );
}
