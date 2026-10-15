import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { dirOf, isUiLocale } from '@dealdash/localization';
import '@dealdash/ui/fonts.css';
import '@dealdash/ui/styles.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'DealDash',
  description: 'Discover deals near you',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  themeColor: '#5B1AFC',
  width: 'device-width',
  initialScale: 1,
};

export function generateStaticParams() {
  // the customer interface also reads in Urdu (content stays English / Arabic)
  return [{ locale: 'en' }, { locale: 'ar' }, { locale: 'ur' }];
}

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  // suppressHydrationWarning: phone browsers (translate, extensions, forced dark mode) add attributes to <html> / <body>
  // before React hydrates. It covers only these two elements' own attributes; mismatches inside the app still warn.
  return (
    <html lang={locale} dir={dirOf(locale)} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
