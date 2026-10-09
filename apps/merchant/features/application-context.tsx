'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { errorMessage, useApi, useAuth, useResource, type ApiResult } from '@dealdash/app-shell';
import { createTranslator } from '@dealdash/localization';
import type { MerchantApplicationDetail } from '@dealdash/validation';
import { Alert, ErrorState, LoadingState } from '@dealdash/ui';

interface Ctx {
  orgId: string;
  app: MerchantApplicationDetail;
  /** Runs a command that returns the fresh application and stores it. */
  run: (
    method: 'PUT' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ) => Promise<ApiResult<MerchantApplicationDetail>>;
  reload: () => Promise<void>;
}

const ApplicationContext = createContext<Ctx | null>(null);

export function useApplication(): Ctx {
  const v = useContext(ApplicationContext);
  if (!v) throw new Error('useApplication must be used inside <ApplicationProvider>');
  return v;
}

/** Loads the signed-in merchant's own application (the organisation id always comes from the session). */
export function ApplicationProvider({ children }: { children: ReactNode }) {
  const { me, locale } = useAuth();
  const t = createTranslator(locale);
  const { call } = useApi();
  const orgId = me?.activeMembership?.organizationId ?? null;
  const resource = useResource<MerchantApplicationDetail>(
    orgId ? `/v1/merchants/${orgId}/application` : null,
  );

  const run = useCallback<Ctx['run']>(
    async (method, path, body) => {
      const res = await call<MerchantApplicationDetail>(
        method,
        `/v1/merchants/${orgId}/application${path}`,
        { body },
      );
      if (res.ok && res.data) resource.set(res.data);
      return res;
    },
    [call, orgId, resource],
  );

  const value = useMemo(
    () =>
      orgId && resource.data ? { orgId, app: resource.data, run, reload: resource.reload } : null,
    [orgId, resource.data, run, resource.reload],
  );

  if (!orgId) return <Alert tone="warning">{t('shell.noAccess')}</Alert>;
  if (resource.loading && !resource.data) return <LoadingState label={t('state.loading')} />;
  if (!value) {
    return (
      <ErrorState
        title={t('state.error')}
        description={errorMessage(locale, resource.errors)}
        retryLabel={t('state.retry')}
        onRetry={() => void resource.reload()}
      />
    );
  }
  return <ApplicationContext.Provider value={value}>{children}</ApplicationContext.Provider>;
}
