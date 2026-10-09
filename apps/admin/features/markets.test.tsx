import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { AdminMarketsPage } from './markets';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/markets',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ME = '018f0000-0000-7000-8000-000000000009';
const OTHER = '018f0000-0000-7000-8000-00000000000a';
const MANAGER = ['admin.markets.read', 'admin.markets.manage', 'admin.markets.approve'];
const me = (permissions: string[]) => ({
  id: ME,
  userType: 'ADMIN_USER',
  displayName: 'Finance',
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
    roleCode: 'DEALDASH_FINANCE',
    branchId: null,
  },
  memberships: [],
  permissions,
});
interface Call {
  url: string;
  method: string;
  body?: string;
}
type R = { status?: number; body: unknown };
function stub(routes: Record<string, R | ((c: Call) => R)>, perms: string[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
      };
      calls.push(call);
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms), meta: {} });
      const path = url.split('?')[0]!;
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length))
        if (path.endsWith(key)) {
          const r = routes[key]!;
          const res = typeof r === 'function' ? r(call) : r;
          return json(res.status ?? 200, res.body);
        }
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
const now = new Date().toISOString();
const market = (over: Record<string, unknown> = {}) => ({
  code: 'AE',
  nameEn: 'United Arab Emirates',
  nameAr: 'الإمارات العربية المتحدة',
  regionCode: 'GCC',
  isoAlpha3: 'ARE',
  status: 'TESTING',
  enabled: false,
  currency: 'AED',
  supportedCurrencies: ['AED'],
  billingCurrency: 'AED',
  settlementCurrency: 'AED',
  taxCurrency: 'AED',
  currencyDecimals: 2,
  roundingRule: 'HALF_UP',
  languages: ['ar', 'en'],
  defaultLanguage: 'ar',
  timezone: 'Asia/Dubai',
  callingCode: '+971',
  launchDate: null,
  version: 3,
  approvalStatus: 'APPROVED',
  pending: null,
  dealdashLegalEntityId: null,
  supportContact: {},
  products: { PILOT: 2, DISABLED: 12 },
  readiness: 'NOT_READY',
  ...over,
});
const readiness = ok({
  market: 'AE',
  state: 'NOT_READY',
  items: [
    {
      check: 'LEGAL_ENTITY',
      state: 'MISSING',
      detail: 'No DealDash legal entity is assigned to this market',
    },
    { check: 'VALIDATIONS', state: 'VALIDATION_REQUIRED', detail: '7 open' },
    { check: 'DEFAULT_CURRENCY', state: 'OK', detail: 'AED (AED)' },
  ],
});
const routes = (over: Record<string, R | ((c: Call) => R)> = {}) => ({
  '/v1/admin/markets': ok([
    market({
      code: 'SA',
      nameEn: 'Saudi Arabia',
      nameAr: 'المملكة العربية السعودية',
      status: 'PILOT',
      enabled: true,
      currency: 'SAR',
      timezone: 'Asia/Riyadh',
      readiness: 'NOT_READY',
    }),
    market(),
  ]),
  '/v1/admin/markets/AE': ok(market()),
  '/v1/admin/markets/AE/readiness': readiness,
  '/v1/admin/markets/AE/config/tax-rules': ok([
    {
      id: 't1',
      code: 'VAT-STD',
      version: 1,
      status: 'APPROVED',
      rateBps: 500,
      inclusive: false,
      exempt: false,
      applicability: ['*'],
      effectiveFrom: now,
      effectiveTo: now,
      createdByUserId: OTHER,
    },
    {
      id: 't2',
      code: 'VAT-STD',
      version: 2,
      status: 'DRAFT',
      rateBps: 500,
      inclusive: false,
      exempt: false,
      applicability: ['SETUP_FEE'],
      effectiveFrom: now,
      effectiveTo: null,
      createdByUserId: ME,
    },
    {
      id: 't3',
      code: 'EXEMPT',
      version: 1,
      status: 'DRAFT',
      rateBps: 0,
      inclusive: false,
      exempt: true,
      applicability: ['VOUCHER_COMMISSION'],
      effectiveFrom: now,
      effectiveTo: null,
      createdByUserId: OTHER,
    },
  ]),
  ...over,
});

describe('Admin markets workspace', () => {
  it('lists markets with region, lifecycle, currency, language, time zone and readiness', async () => {
    stub(routes(), MANAGER);
    render(
      <Providers locale="en">
        <AdminMarketsPage />
      </Providers>,
    );
    const row = await screen.findByTestId('mkt-row-AE');
    expect(row).toHaveTextContent('United Arab Emirates');
    expect(row).toHaveTextContent('Gulf Cooperation Council');
    expect(row).toHaveTextContent('Testing');
    expect(row).toHaveTextContent('Asia/Dubai');
    expect(row).toHaveTextContent('Not ready');
    expect(screen.getByTestId('mkt-row-SA')).toHaveTextContent('Pilot');
    expect(screen.getByTestId('mkt-new')).toBeInTheDocument();
  });

  it('readiness shows missing configuration and open validations; the gate is explained', async () => {
    stub(routes(), MANAGER);
    render(
      <Providers locale="en">
        <AdminMarketsPage />
      </Providers>,
    );
    await userEvent.click(
      within(await screen.findByTestId('mkt-row-AE')).getByRole('button', { name: 'Open' }),
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Readiness' }));
    expect(await screen.findByTestId('mkt-check-LEGAL_ENTITY')).toHaveTextContent('Missing');
    expect(screen.getByTestId('mkt-check-VALIDATIONS')).toHaveTextContent('Validation required');
    expect(screen.getByTestId('mkt-readiness')).toHaveTextContent(
      'Mandatory launch configuration is missing.',
    );
  });

  it('tax versions: a draft I created cannot be approved by me; approved versions can be retired', async () => {
    const calls = stub({ ...routes(), '/config/tax-rules/t3/approve': ok({ id: 't3' }) }, MANAGER);
    render(
      <Providers locale="en">
        <AdminMarketsPage />
      </Providers>,
    );
    await userEvent.click(
      within(await screen.findByTestId('mkt-row-AE')).getByRole('button', { name: 'Open' }),
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Tax' }));
    const table = await screen.findByTestId('mkt-versions-tax-rules');
    const rows = table.querySelectorAll('tbody tr');
    expect(
      within(rows[0] as HTMLElement).getByRole('button', { name: 'Retire' }),
    ).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(rows[1]).toHaveTextContent('A different administrator must approve.');
    await userEvent.click(within(rows[2] as HTMLElement).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith('/config/tax-rules/t3/approve')),
      ).toBe(true),
    );
    expect(rows[2]).toHaveTextContent('Exempt');
  });

  it('a pending status change waits for a different approver', async () => {
    stub(
      routes({
        '/v1/admin/markets/AE': ok(
          market({
            approvalStatus: 'PENDING',
            pending: {
              status: 'PILOT',
              reason: 'Ready to pilot',
              requestedByUserId: ME,
              requestedAt: now,
            },
          }),
        ),
      }),
      MANAGER,
    );
    render(
      <Providers locale="en">
        <AdminMarketsPage />
      </Providers>,
    );
    await userEvent.click(
      within(await screen.findByTestId('mkt-row-AE')).getByRole('button', { name: 'Open' }),
    );
    const life = await screen.findByTestId('mkt-lifecycle');
    expect(life).toHaveTextContent('Requested: Pilot. Reason: Ready to pilot');
    expect(within(life).getByTestId('mkt-approve-status')).toBeDisabled();
  });

  it('read-only administrators see configuration without forms or actions', async () => {
    stub(routes(), ['admin.markets.read']);
    render(
      <Providers locale="en">
        <AdminMarketsPage />
      </Providers>,
    );
    await screen.findByTestId('mkt-row-AE');
    expect(screen.queryByTestId('mkt-new')).toBeNull();
    await userEvent.click(
      within(screen.getByTestId('mkt-row-AE')).getByRole('button', { name: 'Open' }),
    );
    await screen.findByTestId('mkt-overview');
    expect(screen.queryByTestId('mkt-master-form')).toBeNull();
    expect(screen.queryByTestId('mkt-request-status')).toBeNull();
  });

  it('is hidden without the markets permission', async () => {
    stub(routes(), ['admin.org.read']);
    render(
      <Providers locale="en">
        <AdminMarketsPage />
      </Providers>,
    );
    await waitFor(() => expect(screen.queryByTestId('markets-workspace')).toBeNull());
  });

  it('renders right-to-left in Arabic', async () => {
    stub(routes(), MANAGER);
    render(
      <Providers locale="ar">
        <AdminMarketsPage />
      </Providers>,
    );
    const row = await screen.findByTestId('mkt-row-AE');
    expect(row).toHaveTextContent('الإمارات العربية المتحدة');
    expect(row).toHaveTextContent('قيد الاختبار');
    expect(screen.getByText('الأسواق', { selector: 'h1' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });
});
