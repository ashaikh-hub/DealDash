# Creates the shell smoke tests for the five apps from one template (one-off helper; tests are normal source afterwards).
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-File($path, $text) { New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null; [IO.File]::WriteAllText($path, $text, $utf8) }

$apps = @(
  @{ n='customer'; brand='DealDash'; label='Customer'; roleEmail=$false },
  @{ n='merchant'; brand='DealDash for Business'; label='Merchant' },
  @{ n='staff';    brand='DealDash Staff'; label='Staff' },
  @{ n='partner';  brand='DealDash Partners'; label='Partner' },
  @{ n='admin';    brand='DealDash Admin'; label='Admin' }
)
foreach ($a in $apps) {
  $dir = Join-Path $root "apps\$($a.n)"
  Write-File "$dir\vitest.config.ts" @"
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./vitest.setup.ts'], css: false, include: ['**/*.test.tsx', '**/*.test.ts'], exclude: ['node_modules', '.next'] },
});
"@
  Write-File "$dir\vitest.setup.ts" @"
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { createElement } from 'react';

// Next.js router hooks and Link are mocked: tests render the shell without a running Next server.
vi.mock('next/navigation', () => ({ usePathname: () => globalThis.__TEST_PATH__ ?? '/en', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => createElement('a', { href, ...rest }, children),
}));

declare global {
  var __TEST_PATH__: string | undefined;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.__TEST_PATH__ = undefined;
});
"@
  Write-File "$dir\app\[locale]\shell.test.tsx" @"
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShellHome } from '@dealdash/app-shell';
import { Providers } from './providers';

function stubApi(me: unknown | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/v1/auth/me')) return me ? json(200, { data: me, meta: {} }) : json(401, { errors: [{ code: 'AUTH_REQUIRED', message: 'x' }], meta: {} });
      if (url.endsWith('/v1/health')) return json(200, { data: { status: 'ok', time: '', database: { connected: true, migrationsCurrent: true, pendingMigrations: 0 }, postgis: { available: true, enabled: true, version: '3.6' } }, meta: {} });
      return json(202, { data: { accepted: true }, meta: {} });
    }),
  );
}

describe('$($a.n) app shell', () => {
  it('runs independently, shows DealDash branding and the sign-in state (English, LTR)', async () => {
    stubApi(null);
    render(
      <Providers locale="en">
        <ShellHome />
      </Providers>,
    );
    expect(await screen.findAllByLabelText('DealDash')).not.toHaveLength(0);
    expect(screen.getAllByText('$($a.brand)').length).toBeGreaterThan(0);
    expect(await screen.findByRole('button', { name: /sign in|send code/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument()); // talks to the shared API
  });

  it('renders Arabic with a right-to-left demonstration and Western digits', async () => {
    stubApi(null);
    render(
      <Providers locale="ar">
        <ShellHome />
      </Providers>,
    );
    expect((await screen.findAllByText('اختبار الاتجاه من اليمين إلى اليسار')).length).toBeGreaterThan(0);
    const demo = screen.getByTestId('rtl-demo');
    expect(demo).toHaveTextContent('مطعم نوبو');
    expect(demo.textContent).not.toMatch(/[٠-٩]/); // Western digits only
    expect(screen.getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en');
  });

  it('shows permission-aware navigation for a signed-in user', async () => {
    stubApi({
      id: '018f0000-0000-7000-8000-000000000001',
      userType: '$(if($a.n -eq 'customer'){'CUSTOMER'}elseif($a.n -eq 'admin'){'ADMIN_USER'}elseif($a.n -eq 'partner'){'PARTNER_USER'}else{'MERCHANT_USER'})',
      displayName: 'Test User',
      locale: 'en',
      audience: '$($a.n)',
      mfaVerified: true,
      mfaRequired: false,
      csrfToken: 'csrf',
      activeMembership: null,
      memberships: [],
      permissions: ['customer.profile.read'],
    });
    render(
      <Providers locale="en">
        <ShellHome />
      </Providers>,
    );
    expect(await screen.findByText(/Signed in as Test User/)).toBeInTheDocument();
    // sign out is available; items that need permissions the user lacks are not rendered
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByText('Finance')).toBeNull();
    expect(screen.queryByText('Audit log')).toBeNull();
  });
});
"@
}
Write-Host 'App tests created.'
