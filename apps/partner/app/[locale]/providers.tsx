'use client';

import { AppShell, AuthProvider, useAuth, useResource } from '@dealdash/app-shell';
import type { Locale } from '@dealdash/localization';
import type { ReactNode } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Navigation item -> portal module: an item is hidden when the partner type does not offer the module or the contract excludes it. */
const NAV_MODULE: Record<string, string> = {
  merchants: 'MERCHANT_NETWORK',
  offers: 'OFFERS',
  loyalty: 'LOYALTY',
  watch: 'WATCH_SPONSORSHIP',
  integrations: 'INTEGRATIONS',
  assistant: 'AI_COPILOT',
};

function PartnerShell({ children }: { children: ReactNode }) {
  const { me, status } = useAuth();
  const orgId =
    status === 'authenticated' && me?.activeMembership?.organizationType === 'PARTNER'
      ? me.activeMembership.organizationId
      : null;
  const modules = useResource<Array<{ module: string; offered: boolean; entitled: boolean }>>(
    orgId ? `/v1/partners/${orgId}/modules` : null,
  );
  const hidden = Object.entries(NAV_MODULE)
    .filter(([, m]) => {
      const row = modules.data?.find((x) => x.module === m);
      return row ? !row.offered || !row.entitled : false;
    })
    .map(([key]) => key);
  return <AppShell hiddenKeys={hidden}>{children}</AppShell>;
}

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <AuthProvider audience="partner" locale={locale} apiUrl={API_URL}>
      <PartnerShell>{children}</PartnerShell>
    </AuthProvider>
  );
}
