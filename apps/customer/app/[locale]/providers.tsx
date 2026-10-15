'use client';

import { AppShell, AuthProvider, PwaRegister } from '@dealdash/app-shell';
import type { UiLocale as Locale } from '@dealdash/localization';
import type { ReactNode } from 'react';
import { AccountProvider } from '../../features/account';
import { CustomerProvider } from '../../features/customer-context';
import { HeaderCity } from '../../features/parts';

/**
 * Local network testing: a loopback API address (the development default) follows the host the page was opened from, so a
 * phone on the same Wi-Fi reaching http://<laptop-ip>:3001 calls http://<laptop-ip>:4000. Real environment URLs are used as
 * configured. The value is used for requests only (never rendered), so the browser-only branch cannot affect hydration.
 */
export function resolveApiUrl(configured: string, pageHost: string | undefined): string {
  const url = new URL(configured);
  const loopback = (h: string) => h === 'localhost' || h === '127.0.0.1';
  if (!pageHost || !loopback(url.hostname) || loopback(pageHost)) return configured;
  url.hostname = pageHost;
  return url.href.replace(/\/$/, '');
}

const API_URL = resolveApiUrl(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  typeof window === 'undefined' ? undefined : window.location.hostname,
);

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
