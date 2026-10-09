'use client';

import { AppShell, AuthProvider, PwaRegister } from '@dealdash/app-shell';
import type { Locale } from '@dealdash/localization';
import type { ReactNode } from 'react';
import { CustomerProvider } from '../../features/customer-context';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <AuthProvider audience="customer" locale={locale} apiUrl={API_URL}>
      <CustomerProvider>
        <AppShell>
          <PwaRegister locale={locale} />
          {children}
        </AppShell>
      </CustomerProvider>
    </AuthProvider>
  );
}
