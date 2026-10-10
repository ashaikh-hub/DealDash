'use client';

import { useCallback, useState, type ReactNode } from 'react';
import {
  RequirePermission,
  errorMessage,
  fieldErrors,
  useApi,
  useAuth,
  useResource,
  type Resource,
} from '@dealdash/app-shell';
import { createTranslator, formatMoney, type DictionaryKey } from '@dealdash/localization';
import type { ApiErrorItem, PermissionCode } from '@dealdash/types';
import { Alert, Card, EmptyState, LoadingState, StatusChip, type StatusTone } from '@dealdash/ui';

export const useOrgId = () => useAuth().me?.activeMembership?.organizationId ?? null;
export const usePerms = () => useAuth().me?.permissions ?? [];
export const useT = () => createTranslator(useAuth().locale);
/** A dictionary key built from a vocabulary value (the vocabularies are covered by the localization tests). */
export const k = (prefix: string, v: string) => `${prefix}.${v}` as DictionaryKey;
export const pbase = (orgId: string) => `/v1/partners/${orgId}`;

export interface ModuleRow {
  module: string;
  offered: boolean;
  entitled: boolean;
}

/** One page: title, intro, permission gate, optional module gate (offered by the partner type AND entitled by the contract). */
export function PartnerPage({
  title,
  intro,
  any,
  module,
  testId,
  children,
}: {
  title: string;
  intro?: string;
  any: readonly PermissionCode[];
  module?: string;
  testId: string;
  children: (orgId: string) => ReactNode;
}) {
  const orgId = useOrgId();
  return (
    <div className="dd-stack" style={{ gap: 16 }} data-testid={testId}>
      <div className="dd-stack" style={{ gap: 6 }}>
        <h1 className="dd-title-xl">{title}</h1>
        {intro ? (
          <p className="dd-muted" style={{ margin: 0 }}>
            {intro}
          </p>
        ) : null}
      </div>
      <RequirePermission any={any}>
        {orgId ? (
          module ? (
            <ModuleGate orgId={orgId} module={module}>
              {children(orgId)}
            </ModuleGate>
          ) : (
            children(orgId)
          )
        ) : null}
      </RequirePermission>
    </div>
  );
}

function ModuleGate({
  orgId,
  module,
  children,
}: {
  orgId: string;
  module: string;
  children: ReactNode;
}) {
  const t = useT();
  const res = useResource<ModuleRow[]>(`${pbase(orgId)}/modules`);
  if (res.loading && !res.data) return <LoadingState label={t('pt.state.loading')} />;
  const row = res.data?.find((m) => m.module === module);
  if (row && !row.offered)
    return (
      <Card data-testid="pt-not-offered">
        <Alert tone="info">{t('pt.state.notOffered')}</Alert>
      </Card>
    );
  if (row && !row.entitled)
    return (
      <Card data-testid="pt-not-entitled">
        <Alert tone="warning">{t('pt.state.notEntitled')}</Alert>
      </Card>
    );
  return <>{children}</>;
}

/** Loading, error (including permission denied) and empty states for a resource. */
export function Loaded<T>({
  res,
  empty,
  children,
}: {
  res: Resource<T>;
  empty?: (d: T) => boolean;
  children: (d: T) => ReactNode;
}) {
  const { locale } = useAuth();
  const t = useT();
  if (res.loading && !res.data) return <LoadingState label={t('pt.state.loading')} />;
  if (!res.data) {
    const denied = res.errors.some((e) => e.code === 'FORBIDDEN' || e.code === 'SCOPE_FORBIDDEN');
    return (
      <div data-testid={denied ? 'pt-denied' : 'pt-error'}>
        <Alert tone={denied ? 'warning' : 'danger'}>
          {denied ? t('pt.state.denied') : errorMessage(locale, res.errors)}
        </Alert>
      </div>
    );
  }
  if (empty?.(res.data)) return <EmptyState title={t('pt.state.empty')} />;
  return <>{children(res.data)}</>;
}

/** A command with a banner (success or the translated server error) and per-field messages. */
export function useCmd() {
  const { call } = useApi();
  const { locale } = useAuth();
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = useCallback(
    async <T,>(
      method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      path: string,
      body: unknown,
      ok?: string,
    ): Promise<{ ok: boolean; data: T | null; errors: ApiErrorItem[] }> => {
      setBusy(true);
      setBanner(null);
      setFields({});
      const r = await call<T>(method, path, { body, idempotent: method !== 'DELETE' });
      setBusy(false);
      if (!r.ok) {
        setBanner({ tone: 'danger', text: errorMessage(locale, r.errors) });
        setFields(fieldErrors(locale, r.errors));
      } else if (ok) setBanner({ tone: 'success', text: ok });
      return { ok: r.ok, data: r.data, errors: r.errors };
    },
    [call, locale],
  );
  const node = banner ? (
    <div data-testid="pt-banner">
      <Alert tone={banner.tone}>{banner.text}</Alert>
    </div>
  ) : null;
  return { run, busy, banner: node, fields };
}

export const toneOf: Record<string, StatusTone> = {
  OK: 'success',
  READY: 'success',
  ACTIVE: 'success',
  REGISTERED_ACTIVE: 'success',
  APPROVED: 'success',
  LIVE: 'success',
  ON_SALE: 'success',
  ACCEPTED: 'success',
  FULLY_FUNDED: 'success',
  MISSING: 'danger',
  NOT_READY: 'danger',
  BLOCKED: 'danger',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
  VALIDATION_REQUIRED: 'warning',
  UNDER_REVIEW: 'warning',
  PENDING_REVIEW: 'warning',
  PROPOSED: 'warning',
  MERCHANT_APPROVED: 'warning',
  AWAITING_ACCEPTANCE: 'warning',
  AWAITING_FUNDING: 'warning',
  CHANGES_REQUESTED: 'warning',
  REFERENCED: 'info',
  REGISTERED: 'info',
  DRAFT: 'neutral',
  NOT_APPLICABLE: 'neutral',
};
export const Chip = ({ v, label, testId }: { v: string; label: string; testId?: string }) => (
  <StatusChip tone={toneOf[v] ?? 'neutral'}>
    <span data-testid={testId}>{label}</span>
  </StatusChip>
);

export const useMoney = () => {
  const { locale } = useAuth();
  return (halalas: number) => formatMoney(locale, halalas);
};

/** Simple key = value lines (used for field mapping and sample customer facts). */
export function parsePairs(text: string): Array<[string, string]> {
  return text
    .split('\n')
    .map((l) => l.split('='))
    .filter((p) => p.length >= 2 && p[0]!.trim() && p.slice(1).join('=').trim())
    .map((p) => [p[0]!.trim(), p.slice(1).join('=').trim()]);
}
export const csvList = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
