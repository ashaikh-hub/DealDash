import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShellHome } from '@dealdash/app-shell';
import { Providers } from './providers';

function stubApi(me: unknown | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/v1/auth/me'))
        return me
          ? json(200, { data: me, meta: {} })
          : json(401, { errors: [{ code: 'AUTH_REQUIRED', message: 'x' }], meta: {} });
      if (url.endsWith('/v1/health'))
        return json(200, {
          data: {
            status: 'ok',
            time: '',
            database: { connected: true, migrationsCurrent: true, pendingMigrations: 0 },
            postgis: { available: true, enabled: true, version: '3.6' },
          },
          meta: {},
        });
      return json(202, { data: { accepted: true }, meta: {} });
    }),
  );
}

describe('partner app shell', () => {
  it('runs independently, shows DealDash branding and the sign-in state (English, LTR)', async () => {
    stubApi(null);
    render(
      <Providers locale="en">
        <ShellHome />
      </Providers>,
    );
    expect(await screen.findAllByLabelText('DealDash')).not.toHaveLength(0);
    expect(screen.getAllByText('DealDash Partners').length).toBeGreaterThan(0);
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
    expect(
      (await screen.findAllByText('اختبار الاتجاه من اليمين إلى اليسار')).length,
    ).toBeGreaterThan(0);
    const demo = screen.getByTestId('rtl-demo');
    expect(demo).toHaveTextContent('مطعم نوبو');
    expect(demo.textContent).not.toMatch(/[٠-٩]/); // Western digits only
    expect(screen.getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en');
  });

  it('shows permission-aware navigation for a signed-in user', async () => {
    stubApi({
      id: '018f0000-0000-7000-8000-000000000001',
      userType: 'PARTNER_USER',
      displayName: 'Test User',
      locale: 'en',
      audience: 'partner',
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
