import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { dirOf, isLocale } from '@dealdash/localization';
import '@dealdash/ui/fonts.css';
import '@dealdash/ui/styles.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'DealDash Admin',
  description: 'DealDash administration',
};

export const viewport: Viewport = {
  themeColor: '#5B1AFC',
  width: 'device-width',
  initialScale: 1,
};

export function generateStaticParams() {
  return [{ locale: 'en' }, { locale: 'ar' }];
}

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
