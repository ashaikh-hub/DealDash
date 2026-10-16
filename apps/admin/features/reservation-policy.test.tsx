import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { ReservationPolicyPage } from './reservation-policy';
import { ReservationToolsPage } from './reservation-tools';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/reservation-policy',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const me = (permissions: string[]) => ({
  id: '018f0000-0000-7000-8000-000000000009',
  userType: 'ADMIN_USER',
  displayName: 'Admin',
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
    roleCode: 'DEALDASH_SUPER_ADMIN',
    branchId: null,
  },
  memberships: [],
  permissions,
});
type R = { status?: number; body: unknown };
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
const calls: Array<{ method: string; path: string; body: unknown }> = [];
function stub(routes: Record<string, R>, perms: string[]) {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms), meta: {} });
      const path = url.split('?')[0]!;
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length)) {
        const [m, p] = key.includes(' ') ? key.split(' ') : ['GET', key];
        if (method === m && path.endsWith(p!))
          return json(routes[key]!.status ?? 200, routes[key]!.body);
      }
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

const BASELINE = {
  freeAllowed: null,
  allowedMethods: ['FULL_PREPAYMENT', 'DEPOSIT', 'CARD_PREAUTH'],
  depositMinMinor: 100,
  depositMaxMinor: 50_000,
  nonRefundableDepositAllowed: true,
  preauthMaxMinor: 100_000,
  cutoffMinMinutes: 0,
  cutoffMaxMinutes: 120,
  paymentWindowMinutes: 10,
  prepaymentRefundMinPercent: 0,
  prepaymentRefundMaxPercent: 100,
  prepaymentRefundDefaultPercent: 50,
  commissionBps: 0,
  additionalRedemptionFee: false,
  preauthImmediateCapture: false,
  preauthPartialCaptureAllowed: false,
  preauthOnRedemption: 'RELEASE',
  captureFailureAlertThreshold: 3,
};
const policy = {
  baseline: BASELINE,
  market: { SA: { commissionBps: 500 } },
  category: {},
  merchant: {},
};
const source = Object.fromEntries(Object.keys(BASELINE).map((k) => [k, 'BASELINE']));
const effective = {
  market: 'SA',
  marketStatus: 'PILOT',
  currency: 'SAR',
  currencyDecimals: 2,
  freeAllowed: false,
  fields: { ...BASELINE, commissionBps: 500 },
  source: { ...source, commissionBps: 'MARKET' },
  problems: [],
};
const routes = (open: unknown[] = []): Record<string, R> => ({
  '/v1/admin/controls': ok({
    configs: [
      { key: 'reservation.policy', value: policy, version: 4, updatedAt: null, kind: 'OBJECT' },
      {
        key: 'reservation.noshow',
        value: { threshold: 3, windowDays: 30, blockDays: 7 },
        version: 0,
        updatedAt: null,
        kind: 'OBJECT',
      },
    ],
    open,
    recent: [],
  }),
  '/v1/admin/markets': ok([
    { code: 'SA', nameEn: 'Saudi Arabia', nameAr: 'السعودية', status: 'PILOT' },
    { code: 'PK', nameEn: 'Pakistan', nameAr: 'باكستان', status: 'TESTING' },
  ]),
  '/v1/app/categories': ok([{ id: 'c1', code: 'dining', nameEn: 'Dining', nameAr: 'المطاعم' }]),
  '/v1/admin/reservations/policy': ok(effective),
  'POST /v1/admin/controls/requests': ok({ id: 'rq1', status: 'PENDING_APPROVAL' }),
});
const ALL = ['admin.config.read', 'admin.config.manage', 'admin.reservations.manage'];
const show = (ui = <ReservationPolicyPage />, locale: 'en' | 'ar' = 'en') =>
  render(<Providers locale={locale}>{ui}</Providers>);

describe('Reservation policy screen', () => {
  it('shows the effective policy with each value’s level, and the free-reservation rule for live markets', async () => {
    stub(routes(), ALL);
    show();
    const eff = await screen.findByTestId('apol-effective');
    const row = within(eff).getByTestId('apol-eff-commissionBps');
    expect(row).toHaveTextContent('DealDash commission (basis points)');
    expect(row).toHaveTextContent('500');
    expect(row).toHaveTextContent('market');
    expect(eff).toHaveTextContent('SAR 1,000.00'); // largest card hold, in the market currency
    expect(screen.getByTestId('apol-free-now')).toHaveTextContent(
      'Free reservation here: not allowed',
    );
    expect(screen.getByText(/Live markets never offer it/)).toBeInTheDocument();
  });

  it('a market override: fields inherit until overridden; proposing sends the whole policy for approval with a reason', async () => {
    stub(routes(), ALL);
    show();
    const user = userEvent.setup();
    await screen.findByTestId('apol-effective');
    await user.click(screen.getByRole('tab', { name: 'Market default' }));
    // the time to pay inherits the platform default until it is overridden
    const field = screen.getByTestId('apol-f-paymentWindowMinutes');
    expect(field).toHaveTextContent('Inherit');
    await user.click(within(field).getByTestId('apol-f-paymentWindowMinutes-override'));
    const input = within(field).getByLabelText('Time to pay (min)');
    await user.clear(input);
    await user.type(input, '15');
    // the capture alert threshold is part of the same policy
    const alert = screen.getByTestId('apol-f-captureFailureAlertThreshold');
    await user.click(within(alert).getByTestId('apol-f-captureFailureAlertThreshold-override'));
    const th = within(alert).getByLabelText('Refused charges before a finance alert');
    await user.clear(th);
    await user.type(th, '5');
    // the extra redemption fee is only offered as a merchant override
    expect(screen.queryByTestId('apol-f-additionalRedemptionFee')).toBeNull();
    const bar = screen.getByTestId('apol-propose-reservation.market');
    await user.type(within(bar).getByRole('textbox'), 'Pakistan pilot: longer time to pay');
    await user.click(within(bar).getByTestId('apol-submit-reservation.market'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/controls/requests'))).toBe(
        true,
      ),
    );
    const req = calls.find((c) => c.path.endsWith('/controls/requests'))!.body as {
      key: string;
      section: string;
      baseVersion: number;
      value: { market: Record<string, Record<string, unknown>>; baseline: unknown };
    };
    expect(req.key).toBe('reservation.policy');
    expect(req.section).toBe('reservation.market');
    expect(req.baseVersion).toBe(4);
    expect(req.value.market.SA).toEqual({
      commissionBps: 500,
      paymentWindowMinutes: 15,
      captureFailureAlertThreshold: 5,
    });
    expect(req.value.baseline).toEqual(BASELINE);
  });

  it('merchant scope offers the contracted extra redemption fee, with the warning', async () => {
    stub(
      {
        ...routes(),
        '/v1/admin/merchants': ok([
          { organizationId: 'o1', tradeNameEn: 'Najd Kitchen', tradeNameAr: 'نجد كيتشن' },
        ]),
      },
      ALL,
    );
    show();
    const user = userEvent.setup();
    await screen.findByTestId('apol-effective');
    await user.click(screen.getByRole('tab', { name: 'Merchant override' }));
    expect(screen.queryByTestId('apol-f-additionalRedemptionFee')).toBeNull(); // no merchant chosen yet
    await user.type(screen.getByLabelText('Search merchants'), 'Najd');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await user.selectOptions(await screen.findByLabelText('Merchant'), 'o1');
    expect(screen.getByTestId('apol-no-override')).toBeInTheDocument();
    const fee = screen.getByTestId('apol-f-additionalRedemptionFee');
    expect(fee).toHaveTextContent('Also charge the per-redemption fee on paid reservations');
    expect(
      screen.getByText(/signed agreement that explicitly adds the per-redemption fee/),
    ).toBeInTheDocument();
    // the preview now resolves for that merchant
    await waitFor(() =>
      expect(
        calls.some((c) => c.path.endsWith('/v1/admin/reservations/policy') && c.method === 'GET'),
      ).toBe(true),
    );
  });

  it('not-completed limits are proposed through the same approval; a read-only role cannot propose', async () => {
    stub(routes([{ id: 'x', key: 'reservation.noshow', status: 'PENDING_APPROVAL' }]), ALL);
    const { unmount } = show();
    const user = userEvent.setup();
    const box = await screen.findByTestId('apol-noshow');
    expect(screen.getByTestId('apol-pending')).toBeInTheDocument();
    const th = within(box).getByLabelText('Not completed before blocking');
    await user.clear(th);
    await user.type(th, '4');
    const bar = within(box).getByTestId('apol-propose-noshow');
    await user.type(within(bar).getByRole('textbox'), 'Fewer blocks during the pilot');
    await user.click(within(bar).getByTestId('apol-submit-noshow'));
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith('/controls/requests'))).toBe(true),
    );
    expect(calls.find((c) => c.path.endsWith('/controls/requests'))!.body).toMatchObject({
      key: 'reservation.noshow',
      value: { threshold: 4, windowDays: 30, blockDays: 7 },
      baseVersion: 0,
    });
    unmount();
    stub(routes(), ['admin.config.read']);
    show();
    await screen.findByTestId('apol-noshow');
    expect(screen.queryByTestId('apol-submit-noshow')).toBeNull();
    expect(screen.getAllByText('You can read these rules but not change them.').length).toBe(2);
  });

  it('Arabic: right-to-left labels with Western digits', async () => {
    stub(routes(), ALL);
    show(<ReservationPolicyPage />, 'ar');
    expect(await screen.findByText('السياسة المطبقة')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });
});

describe('Reservation tools: strikes and failed refunds', () => {
  const tools = (): Record<string, R> => ({
    '/v1/admin/reservations/restrictions': ok([
      {
        id: 'rs1',
        status: 'ACTIVE',
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        reason: 'NO_SHOWS',
        strikes: 3,
        liftedReason: null,
        customer: { userId: 'u1', displayName: 'Layla', mobileMasked: '+966•••01' },
      },
    ]),
    'POST /v1/admin/reservations/customers/u1/strike-reset': ok({ reset: 3, reservationIds: [] }),
    '/v1/admin/reservations/refunds/failed': ok([
      {
        id: 'f1',
        reference: 'RRF-9',
        reservationId: 'r1',
        organizationId: 'o1',
        amountMinor: 4500,
        currency: 'SAR',
        status: 'FAILED',
        reasonCode: 'CUSTOMER_CANCELLED_IN_TIME',
        failureCode: 'PROVIDER_ERROR',
        attempts: 2,
        createdAt: new Date().toISOString(),
        refundedAt: null,
      },
    ]),
    'POST /v1/admin/reservations/refunds/f1/retry': ok({ id: 'f1', status: 'PROCESSING' }),
  });

  it('resets a customer’s strikes with a reason', async () => {
    stub(tools(), ['admin.reservations.manage']);
    show(<ReservationToolsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('strikes-reset-open'));
    await user.type(screen.getByLabelText(/Reason/), 'Verified illness, strikes waived');
    await user.click(screen.getByTestId('reason-confirm'));
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith('/customers/u1/strike-reset'))).toBe(true),
    );
    expect(calls.find((c) => c.path.endsWith('/strike-reset'))!.body).toEqual({
      reason: 'Verified illness, strikes waived',
    });
    expect(await screen.findByText('Strikes reset: 3')).toBeInTheDocument();
  });

  it('lists failed reservation refunds and retries one', async () => {
    stub(tools(), ['admin.reservations.manage']);
    show(<ReservationToolsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Failed refunds' }));
    const row = await screen.findByTestId('failed-refund');
    expect(row).toHaveTextContent('RRF-9');
    expect(row).toHaveTextContent('SAR 45.00');
    expect(row).toHaveTextContent('Attempts: 2');
    await user.click(within(row).getByTestId('refund-retry'));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/refunds/f1/retry'))).toBe(true));
    expect(await screen.findByText('Refund sent again')).toBeInTheDocument();
  });
});
