'use client';

import { AppShell, AuthProvider, PwaRegister } from '@dealdash/app-shell';
import type { Locale } from '@dealdash/localization';
import type { ReactNode } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <AuthProvider audience="staff" locale={locale} apiUrl={API_URL}>
      <AppShell>
        <PwaRegister locale={locale} />
        {children}
      </AppShell>
    </AuthProvider>
  );
}
