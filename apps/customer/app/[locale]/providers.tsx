'use client';

import { AppShell, AuthProvider, PwaRegister } from '@dealdash/app-shell';
import type { Locale } from '@dealdash/localization';
import type { ReactNode } from 'react';
import { CustomerProvider } from '../../features/customer-context';
import { HeaderCity } from '../../features/parts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <AuthProvider audience="customer" locale={locale} apiUrl={API_URL}>
      <CustomerProvider>
        <AppShell headerAccessory={<HeaderCity />}>
          {children}
          {/* the install offer follows the content: it never competes with the customer's first screen */}
          <PwaRegister locale={locale} />
        </AppShell>
      </CustomerProvider>
    </AuthProvider>
  );
}
