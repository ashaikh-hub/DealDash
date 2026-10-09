# One-off scaffolding helper used to create the five thin Next.js app shells from a single template.
# (Kept in the repo for reference; apps are normal source after generation.)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-File($path, $text) {
  New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
  [IO.File]::WriteAllText($path, $text, $utf8)
}

$apps = @(
  @{ name='customer'; port=3001; title='DealDash'; pwa=$true;  desc='Discover deals near you' },
  @{ name='merchant'; port=3002; title='DealDash for Business'; pwa=$false; desc='Merchant portal' },
  @{ name='staff';    port=3003; title='DealDash Staff'; pwa=$true;  desc='Scan, validate and redeem' },
  @{ name='partner';  port=3004; title='DealDash Partners'; pwa=$false; desc='Partner portal' },
  @{ name='admin';    port=3005; title='DealDash Admin'; pwa=$false; desc='DealDash administration' }
)

foreach ($a in $apps) {
  $dir = Join-Path $root "apps\$($a.name)"
  $n = $a.name

  Write-File "$dir\package.json" @"
{
  "name": "@dealdash/$n",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p $($a.port)",
    "build": "next build",
    "start": "next start -p $($a.port)",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@dealdash/app-shell": "workspace:*",
    "@dealdash/localization": "workspace:*",
    "@dealdash/ui": "workspace:*",
    "next": "^15.5.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@dealdash/tsconfig": "workspace:*",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^22.15.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "jsdom": "^26.1.0",
    "typescript": "~5.9.3",
    "vitest": "^3.2.4"
  }
}
"@

  Write-File "$dir\tsconfig.json" @"
{
  "extends": "@dealdash/tsconfig/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] },
    "types": ["node", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
"@

  Write-File "$dir\next.config.ts" @"
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Shared workspace packages are pre-built (tsup) so no transpilation is needed here.
};

export default config;
"@

  Write-File "$dir\middleware.ts" @"
import { NextResponse, type NextRequest } from 'next/server';
import { isLocale, negotiateLocale } from '@dealdash/localization';

/** Localized routes: /en/... and /ar/... . Requests without a locale are redirected using Accept-Language. */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const first = pathname.split('/').filter(Boolean)[0];
  if (isLocale(first)) return NextResponse.next();
  const locale = negotiateLocale(request.headers.get('accept-language'));
  const url = request.nextUrl.clone();
  url.pathname = '/' + locale + (pathname === '/' ? '' : pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
"@

  $metaManifest = if ($a.pwa) { "  manifest: '/manifest.webmanifest',`n" } else { '' }
  Write-File "$dir\app\[locale]\layout.tsx" @"
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { dirOf, isLocale } from '@dealdash/localization';
import '@dealdash/ui/fonts.css';
import '@dealdash/ui/styles.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: '$($a.title)',
  description: '$($a.desc)',
$metaManifest};

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
"@

  $pwaImport = if ($a.pwa) { "import { AppShell, AuthProvider, PwaRegister } from '@dealdash/app-shell';" } else { "import { AppShell, AuthProvider } from '@dealdash/app-shell';" }
  $pwaNode = if ($a.pwa) { "        <PwaRegister locale={locale} />`n" } else { '' }
  Write-File "$dir\app\[locale]\providers.tsx" @"
'use client';

$pwaImport
import type { Locale } from '@dealdash/localization';
import type { ReactNode } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <AuthProvider audience="$n" locale={locale} apiUrl={API_URL}>
      <AppShell>
$pwaNode        {children}
      </AppShell>
    </AuthProvider>
  );
}
"@

  Write-File "$dir\app\[locale]\page.tsx" @"
'use client';

import { ShellHome } from '@dealdash/app-shell';

export default function HomePage() {
  return <ShellHome />;
}
"@

  Write-File "$dir\app\[locale]\[...slug]\page.tsx" @"
'use client';

import { PlaceholderPage } from '@dealdash/app-shell';
import { use } from 'react';

export default function SlugPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = use(params);
  return <PlaceholderPage slug={slug} />;
}
"@

  if ($a.pwa) {
    Write-File "$dir\app\manifest.ts" @"
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '$($a.title)',
    short_name: '$($a.title)',
    description: '$($a.desc)',
    start_url: '/en',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F8F9FD',
    theme_color: '#5B1AFC',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
"@
    Write-File "$dir\public\sw.js" @"
/* DealDash PWA service worker (static shell only).
 * - Caches same-origin static assets (/_next/static, fonts, icons) cache-first.
 * - Navigations are network-first with an offline fallback page.
 * - API requests (other origin) and non-GET requests are never intercepted or cached.
 * - Nothing here enables offline redemption: codes are validated online only. */
const CACHE = 'dd-static-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL, '/icon-192.png'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || /\.(?:png|svg|woff2?|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
"@
    Write-File "$dir\public\offline.html" @"
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline</title>
<style>body{font-family:system-ui,sans-serif;background:#F8F9FD;color:#0F0C42;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}
.c{padding:24px;max-width:420px}h1{font-size:20px}p{color:#5B5E80}</style></head>
<body><div class="c"><h1>You are offline</h1><p>Check your connection and try again. Reservation and voucher actions need an internet connection.</p>
<h1 dir="rtl">أنت غير متصل</h1><p dir="rtl">تحقق من اتصالك وحاول مرة أخرى. تحتاج الإجراءات إلى اتصال بالإنترنت.</p></div></body></html>
"@
  }

  Write-File "$dir\.gitignore" "node_modules`n.next`nnext-env.d.ts`n"
}
Write-Host 'Apps scaffolded.'
