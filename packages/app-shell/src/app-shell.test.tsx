import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell, AuthProvider, LoginPanel, PlaceholderPage, useAuth } from './index';

vi.mock('next/navigation', () => ({ usePathname: () => '/en' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement('a', { href, ...rest }, children),
}));

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown } | undefined;

function stubApi(handler: Handler) {
  const calls: Array<{ url: string; method: string; body: unknown; csrf: string | null }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input as string, init);
      const url = req.url;
      const text = req.method === 'GET' ? '' : await req.clone().text();
      calls.push({
        url,
        method: req.method,
        body: text ? JSON.parse(text) : null,
        csrf: req.headers.get('x-csrf-token'),
      });
      const r = handler(url, init) ?? {
        status: 404,
        body: { errors: [{ code: 'NOT_FOUND', message: '' }], meta: {} },
      };
      return new Response(JSON.stringify(r.body), {
        status: r.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}

const me = (over: Record<string, unknown> = {}) => ({
  id: '018f0000-0000-7000-8000-000000000001',
  userType: 'MERCHANT_USER',
  displayName: 'Owner',
  locale: 'en',
  audience: 'merchant',
  mfaVerified: true,
  mfaRequired: false,
  activeMembership: {
    organizationId: '018f0000-0000-7000-8000-000000000002',
    organizationType: 'MERCHANT',
    organizationName: { en: 'Harbour Grill', ar: 'هاربور جريل' },
    roleCode: 'MERCHANT_ADMIN',
    branchId: null,
  },
  memberships: [],
  permissions: ['merchant.profile.read', 'merchant.branch.read', 'merchant.staff.read'],
  ...over,
});

const unauthenticated = (url: string) =>
  url.endsWith('/v1/auth/me')
    ? { status: 401, body: { errors: [{ code: 'AUTH_REQUIRED', message: '' }], meta: {} } }
    : undefined;

function Probe() {
  const { status, me: m } = useAuth();
  return (
    <div data-testid="probe">
      {status}:{m?.displayName ?? '-'}
    </div>
  );
}

describe('app shell: permission-aware navigation', () => {
  it('shows only navigation the role may use (finance hidden for a merchant admin)', async () => {
    stubApi((url) =>
      url.endsWith('/v1/auth/me')
        ? { status: 200, body: { data: { ...me(), csrfToken: 'c' }, meta: {} } }
        : undefined,
    );
    render(
      <AuthProvider audience="merchant" locale="en" apiUrl="http://api.test">
        <AppShell>
          <div />
        </AppShell>
      </AuthProvider>,
    );
    await screen.findByText('Branches');
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.queryByText('Finance')).toBeNull();
    expect(screen.queryByText('Vouchers')).toBeNull();
  });

  it('localises navigation labels and mirrors the language switcher in Arabic', async () => {
    stubApi((url) =>
      url.endsWith('/v1/auth/me')
        ? { status: 200, body: { data: { ...me(), csrfToken: 'c' }, meta: {} } }
        : undefined,
    );
    render(
      <AuthProvider audience="merchant" locale="ar" apiUrl="http://api.test">
        <AppShell>
          <div />
        </AppShell>
      </AuthProvider>,
    );
    expect(await screen.findByText('الفروع')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en');
    expect(screen.getByRole('link', { name: 'عربي' })).toHaveAttribute('aria-current', 'true');
  });

  it('placeholder pages show a no-access state when the permission is missing', async () => {
    stubApi((url) =>
      url.endsWith('/v1/auth/me')
        ? { status: 200, body: { data: { ...me(), csrfToken: 'c' }, meta: {} } }
        : undefined,
    );
    render(
      <AuthProvider audience="merchant" locale="en" apiUrl="http://api.test">
        <PlaceholderPage slug={['finance']} />
      </AuthProvider>,
    );
    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
  });
});

describe('sign-in flows', () => {
  it('customer: mobile number, SMS code, then authenticated', async () => {
    const calls = stubApi((url) => {
      if (url.endsWith('/v1/auth/otp/request'))
        return {
          status: 200,
          body: { data: { sent: true, expiresInSeconds: 300, resendAfterSeconds: 30 }, meta: {} },
        };
      if (url.endsWith('/v1/auth/otp/verify'))
        return {
          status: 200,
          body: {
            data: {
              authenticated: true,
              mfaRequired: false,
              csrfToken: 'csrf-1',
              me: me({ userType: 'CUSTOMER', audience: 'customer', displayName: 'Sara' }),
            },
            meta: {},
          },
        };
      if (url.includes('/v1/dev/last-sms'))
        return { status: 200, body: { data: { code: '123456' } } };
      return unauthenticated(url);
    });
    render(
      <AuthProvider audience="customer" locale="en" apiUrl="http://api.test">
        <LoginPanel />
        <Probe />
      </AuthProvider>,
    );
    await userEvent.type(await screen.findByLabelText('Mobile number'), '+966500000001');
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }));
    // one accessible input (six drawn boxes): typing the digits completes and submits
    await userEvent.type(await screen.findByLabelText('Verification code'), '123456');
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('authenticated:Sara'),
    );
    expect(calls.find((c) => c.url.endsWith('/otp/request'))?.body).toEqual({
      mobile: '+966500000001',
      audience: 'customer',
    });
    expect(calls.find((c) => c.url.endsWith('/otp/verify'))?.body).toEqual({
      mobile: '+966500000001',
      code: '123456',
      audience: 'customer',
    });
  });

  it('shows a localised error for a wrong code (Arabic)', async () => {
    stubApi((url) => {
      if (url.endsWith('/v1/auth/otp/request'))
        return {
          status: 200,
          body: { data: { sent: true, expiresInSeconds: 300, resendAfterSeconds: 30 }, meta: {} },
        };
      if (url.endsWith('/v1/auth/otp/verify'))
        return { status: 400, body: { errors: [{ code: 'OTP_INVALID', message: 'x' }], meta: {} } };
      return unauthenticated(url);
    });
    render(
      <AuthProvider audience="customer" locale="ar" apiUrl="http://api.test">
        <LoginPanel />
      </AuthProvider>,
    );
    await userEvent.type(await screen.findByLabelText('رقم الجوال'), '+966500000001');
    await userEvent.click(screen.getByRole('button', { name: 'إرسال الرمز' }));
    await userEvent.type(await screen.findByLabelText('رمز التحقق'), '123456');
    expect(await screen.findByText('الرمز غير صحيح.')).toBeInTheDocument();
  });

  it('admin: password then mandatory two-step code; the CSRF token is sent on the MFA call', async () => {
    const calls = stubApi((url) => {
      if (url.endsWith('/v1/auth/login'))
        return {
          status: 200,
          body: {
            data: {
              authenticated: true,
              mfaRequired: true,
              csrfToken: 'csrf-admin',
              me: me({
                userType: 'ADMIN_USER',
                audience: 'admin',
                displayName: 'Root',
                mfaRequired: true,
                mfaVerified: false,
              }),
            },
            meta: {},
          },
        };
      if (url.endsWith('/v1/auth/mfa/verify'))
        return { status: 200, body: { data: { accepted: true }, meta: {} } };
      if (url.includes('/v1/dev/totp')) return { status: 200, body: { data: { code: '654321' } } };
      if (url.endsWith('/v1/auth/me') && calls.some((c) => c.url.endsWith('/mfa/verify'))) {
        return {
          status: 200,
          body: {
            data: {
              ...me({
                userType: 'ADMIN_USER',
                audience: 'admin',
                displayName: 'Root',
                mfaRequired: true,
                mfaVerified: true,
              }),
              csrfToken: 'csrf-admin',
            },
            meta: {},
          },
        };
      }
      return unauthenticated(url);
    });
    render(
      <AuthProvider audience="admin" locale="en" apiUrl="http://api.test">
        <LoginPanel />
        <Probe />
      </AuthProvider>,
    );
    await userEvent.type(await screen.findByLabelText('Work email'), 'super@dealdash.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Two-step verification')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Verification code'), '654321');
    await waitFor(() =>
      expect(screen.getByTestId('probe')).toHaveTextContent('authenticated:Root'),
    );
    expect(calls.find((c) => c.url.endsWith('/mfa/verify'))?.csrf).toBe('csrf-admin');
  });
});
