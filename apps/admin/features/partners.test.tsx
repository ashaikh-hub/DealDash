import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { AdminPartnersPage } from './partners';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/partners',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ME = '018f0000-0000-7000-8000-000000000009';
const ORG = '018f0000-0000-7000-8000-0000000000b1';
const me = (permissions: string[]) => ({
  id: ME,
  userType: 'ADMIN_USER',
  displayName: 'Partner management',
  locale: 'en',
  audience: 'admin',
  mfaVerified: true,
  mfaRequired: true,
  csrfToken: 'csrf',
  activeMembership: {
    organizationId: '018f0000-0000-7000-8000-0000000000dd',
    organizationType: 'DEALDASH',
    organizationName: { en: 'DealDash', ar: 'ديل داش' },
    organizationStatus: 'ACTIVE',
    roleCode: 'DEALDASH_PARTNER_MANAGEMENT',
    branchId: null,
  },
  memberships: [],
  permissions,
});
type R = { status?: number; body: unknown };
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
function stub(routes: Record<string, R>, perms: string[]) {
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
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms), meta: {} });
      const path = url.split('?')[0]!;
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length))
        if (path.endsWith(key)) return json(routes[key]!.status ?? 200, routes[key]!.body);
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());
const ALL = ['admin.partners.review', 'admin.partners.manage', 'admin.partners.approve'];
const routes = (pendingBy: string) => ({
  '/v1/admin/partners': ok([
    {
      organizationId: ORG,
      nameEn: 'Gulf Bank',
      nameAr: 'بنك الخليج',
      partnerType: 'BANK',
      lifecycle: 'PRODUCT_ENABLED',
      requestedMarkets: ['SA'],
      pending: 'ACTIVE',
      readiness: 'VALIDATION_REQUIRED',
    },
  ]),
  [`/v1/admin/partners/${ORG}`]: ok({
    organizationId: ORG,
    nameEn: 'Gulf Bank',
    lifecycle: 'PRODUCT_ENABLED',
    pending: { lifecycle: 'ACTIVE', reason: 'Ready', requestedByUserId: pendingBy },
  }),
  [`/v1/admin/partners/${ORG}/readiness`]: ok({
    lifecycle: 'PRODUCT_ENABLED',
    state: 'VALIDATION_REQUIRED',
    items: [{ check: 'MARKET_VALIDATIONS', state: 'VALIDATION_REQUIRED', detail: '31 open' }],
    nextSteps: ['ACTIVE'],
  }),
  [`/v1/admin/partners/${ORG}/history`]: ok([]),
  '/v1/admin/partners/benefits': ok([]),
});

describe('Admin partners (Stage 7)', () => {
  it('lists partners with type, lifecycle, the pending activation and readiness', async () => {
    stub(routes('someone-else'), ALL);
    render(
      <Providers locale="en">
        <AdminPartnersPage />
      </Providers>,
    );
    const row = await screen.findByTestId(`ap-row-${ORG}`);
    expect(row).toHaveTextContent('Bank');
    expect(row).toHaveTextContent('Products enabled');
    expect(row).toHaveTextContent('Waiting for a second administrator: Active');
    expect(row).toHaveTextContent('Validation required');
    expect(screen.getByTestId('ap-new')).toBeInTheDocument();
  });

  it('the administrator who requested the activation cannot approve it', async () => {
    stub(routes(ME), ALL);
    render(
      <Providers locale="en">
        <AdminPartnersPage />
      </Providers>,
    );
    await userEvent.click(
      within(await screen.findByTestId(`ap-row-${ORG}`)).getByRole('button', { name: 'Open' }),
    );
    expect(await screen.findByTestId('ap-approve')).toBeDisabled();
    expect(screen.getByTestId('ap-pending')).toHaveTextContent(
      'A different administrator must approve.',
    );
  });

  it('FD-S7-4: partner Live Deals wait for DealDash to confirm the publication right; only an approver can confirm', async () => {
    const offers = ok([
      {
        id: 'o1',
        partner: 'Gulf Bank',
        merchant: 'Corner Bakery',
        country: 'SA',
        titleEn: 'Card holders save',
        benefitEn: '10% off',
        validFrom: new Date().toISOString(),
        validUntil: null,
        publicationRef: 'GB-PROG-1',
        sourceRecordId: 'OFF-1',
        importMethod: 'MANUAL',
      },
    ]);
    stub({ ...routes(ME), '/v1/admin/partners/offers': offers }, ALL);
    const { unmount } = render(
      <Providers locale="en">
        <AdminPartnersPage />
      </Providers>,
    );
    await userEvent.click(
      await screen.findByRole('tab', { name: 'Partner Live Deals to confirm' }),
    );
    const table = await screen.findByTestId('ap-offers');
    expect(table).toHaveTextContent('GB-PROG-1');
    expect(screen.getByTestId('ap-offer-confirm-o1')).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    stub({ ...routes(ME), '/v1/admin/partners/offers': offers }, ['admin.partners.review']);
    render(
      <Providers locale="en">
        <AdminPartnersPage />
      </Providers>,
    );
    await userEvent.click(
      await screen.findByRole('tab', { name: 'Partner Live Deals to confirm' }),
    );
    await screen.findByTestId('ap-offers');
    expect(screen.queryByTestId('ap-offer-confirm-o1')).toBeNull();
  });

  it('is hidden without the partner review permission', async () => {
    stub(routes(ME), ['admin.org.read']);
    render(
      <Providers locale="en">
        <AdminPartnersPage />
      </Providers>,
    );
    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-partners')).toBeNull();
  });
});
