'use client';

import { AppShell, AuthProvider, PwaRegister } from '@dealdash/app-shell';
import type { UiLocale as Locale } from '@dealdash/localization';
import type { ReactNode } from 'react';
import { AccountProvider } from '../../features/account';
import { CustomerProvider } from '../../features/customer-context';
import { HeaderCity } from '../../features/parts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <AuthProvider audience="customer" locale={locale} apiUrl={API_URL}>
      <CustomerProvider>
        <AppShell headerAccessory={<HeaderCity />}>
          {/* account state (profile set-up, account prompts, offline banner, under-age block) */}
          <AccountProvider>{children}</AccountProvider>
          {/* the install offer follows the content: it never competes with the customer's first screen */}
          <PwaRegister locale={locale} />
        </AppShell>
      </CustomerProvider>
    </AuthProvider>
  );
}
