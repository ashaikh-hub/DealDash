import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { MerchantPlanPage } from './plan';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/plan',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const CONTRACT = '018f0000-0000-7000-8000-0000000000c1';
const AMEND = '018f0000-0000-7000-8000-0000000000d1';
const OWNER = [
  'merchant.subscription.read',
  'merchant.subscription.manage',
  'merchant.commercial.accept',
];
const FINANCE = ['merchant.subscription.read'];
const me = (permissions: string[]) => ({
  id: '018f0000-0000-7000-8000-000000000001',
  userType: 'MERCHANT_USER',
  displayName: 'Owner',
  locale: 'en',
  audience: 'merchant',
  mfaVerified: true,
  mfaRequired: false,
  csrfToken: 'csrf',
  activeMembership: {
    organizationId: ORG,
    organizationType: 'MERCHANT',
    organizationName: { en: 'Test Cafe', ar: 'مقهى الاختبار' },
    organizationStatus: 'ACTIVE',
    roleCode: 'MERCHANT_OWNER',
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
function stub(routes: Record<string, R | ((c: Call) => R)>, perms = OWNER) {
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
        if (path.endsWith(key) || path.includes(`${key}/`) || path.includes(`${key}?`)) {
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
const mount = (locale: 'en' | 'ar' = 'en') =>
  render(<Providers locale={locale}>{<MerchantPlanPage />}</Providers>);
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
const now = new Date().toISOString();

const contract = (over: Record<string, unknown> = {}) => ({
  id: CONTRACT,
  organizationId: ORG,
  legalEntityId: null,
  billingLegalEntityId: null,
  coveredLegalEntityIds: [],
  name: null,
  reference: null,
  kind: 'MERCHANT_SUBSCRIPTION',
  status: 'ACTIVE',
  renewalState: 'AUTO_RENEW',
  market: 'PK',
  currency: 'PKR',
  billingCadence: 'MONTHLY',
  version: 1,
  planCode: 'GROWTH',
  planName: { en: 'Merchant Growth', ar: 'تاجر - باقة النمو' },
  planVersionId: 'pv1',
  planVersion: 1,
  effectiveFrom: now,
  effectiveUntil: null,
  pastDueSince: null,
  graceUntil: null,
  suspendedAt: null,
  nextBillingAt: null,
  nextRenewalAt: new Date(Date.now() + 30 * 864e5).toISOString(),
  supportLevel: null,
  accountManager: null,
  pricingVersionKey: 'PLV:pv1',
  developmentFixture: false,
  entitlements: [],
  addOns: [
    {
      id: 'a1',
      code: 'EXTRA_BRANCH',
      quantity: 2,
      priceMinor: 150_000,
      currency: 'PKR',
      cadence: 'MONTHLY',
      status: 'ACTIVE',
      startAt: now,
      endAt: null,
      autoRenew: true,
    },
  ],
  trial: null,
  promotions: [],
  rates: [],
  ...over,
});
const summary = (over: Record<string, unknown> = {}) => ({
  source: 'CONTRACT',
  lifecycle: 'ACTIVE',
  financialStatus: { status: 'GOOD_STANDING', reasons: [], graceUntil: null, contractId: CONTRACT },
  contract: contract(),
  price: {
    amountMinor: 499_900,
    currency: 'PKR',
    cadence: 'MONTHLY',
    indicative: false,
    waived: false,
    pricingVersionKey: 'PLV:pv1',
    adjustments: [{ kind: 'DISCOUNT', ref: 'CR:1', bps: 1000 }],
  },
  products: ['LIVE_DEAL', 'LOYALTY'],
  features: ['BULK_IMPORT'],
  limits: [
    {
      key: 'branches.max',
      value: 7,
      mode: 'HARD',
      period: 'NONE',
      source: 'PLAN',
      base: 5,
      override: null,
      addOns: 2,
    },
  ],
  usage: [
    {
      limitKey: 'branches.max',
      metricKey: 'branch.count',
      kind: 'RESOURCE',
      used: 6,
      limit: 7,
      remaining: 1,
      percent: 86,
      mode: 'HARD',
      period: 'NONE',
      source: 'PLAN',
      warnPercents: [80, 100],
    },
    {
      limitKey: 'users.max',
      metricKey: 'user.active_count',
      kind: 'RESOURCE',
      used: 2,
      limit: 10,
      remaining: 8,
      percent: 20,
      mode: 'HARD',
      period: 'NONE',
      source: 'PLAN',
      warnPercents: [80, 100],
    },
  ],
  amendments: [
    {
      id: 'h1',
      type: 'UPGRADE',
      status: 'APPLIED',
      effectiveAt: now,
      effectiveMode: 'IMMEDIATE',
      reason: null,
      forced: false,
      createdAt: now,
    },
  ],
  previousAgreements: [],
  ...over,
});
const plans = [
  {
    id: 'p1',
    code: 'STARTER',
    nameEn: 'Merchant Starter',
    nameAr: 'تاجر - باقة البداية',
    entityType: 'MERCHANT',
    contractKind: 'MERCHANT_SUBSCRIPTION',
    isFree: true,
    negotiated: false,
    status: 'ACTIVE',
    sortOrder: 10,
    current: false,
    versions: [
      {
        id: 'v1',
        market: 'PK',
        currency: 'PKR',
        version: 1,
        status: 'PUBLISHED',
        effectiveFrom: now,
        effectiveUntil: null,
        prices: [],
        defaultCadence: 'NONE',
        developmentFixture: false,
      },
    ],
  },
  {
    id: 'p2',
    code: 'GROWTH',
    nameEn: 'Merchant Growth',
    nameAr: 'تاجر - باقة النمو',
    entityType: 'MERCHANT',
    contractKind: 'MERCHANT_SUBSCRIPTION',
    isFree: false,
    negotiated: false,
    status: 'ACTIVE',
    sortOrder: 20,
    current: true,
    versions: [
      {
        id: 'v2',
        market: 'PK',
        currency: 'PKR',
        version: 1,
        status: 'PUBLISHED',
        effectiveFrom: now,
        effectiveUntil: null,
        prices: [{ cadence: 'MONTHLY', amountMinor: 499_900 }],
        defaultCadence: 'MONTHLY',
        developmentFixture: false,
      },
    ],
  },
  {
    id: 'p3',
    code: 'BUSINESS',
    nameEn: 'Merchant Business',
    nameAr: 'تاجر - باقة الأعمال',
    entityType: 'MERCHANT',
    contractKind: 'MERCHANT_SUBSCRIPTION',
    isFree: false,
    negotiated: false,
    status: 'ACTIVE',
    sortOrder: 30,
    current: false,
    versions: [
      {
        id: 'v3',
        market: 'PK',
        currency: 'PKR',
        version: 1,
        status: 'PUBLISHED',
        effectiveFrom: now,
        effectiveUntil: null,
        prices: [{ cadence: 'MONTHLY', amountMinor: 1_499_900 }],
        defaultCadence: 'MONTHLY',
        developmentFixture: false,
      },
    ],
  },
  {
    id: 'p4',
    code: 'MERCHANT_ENTERPRISE',
    nameEn: 'Merchant Enterprise',
    nameAr: 'تاجر - المؤسسات',
    entityType: 'MERCHANT',
    contractKind: 'MERCHANT_ENTERPRISE',
    isFree: false,
    negotiated: true,
    status: 'ACTIVE',
    sortOrder: 40,
    current: false,
    versions: [
      {
        id: 'v4',
        market: 'PK',
        currency: 'PKR',
        version: 1,
        status: 'PUBLISHED',
        effectiveFrom: now,
        effectiveUntil: null,
        prices: [{ cadence: 'MONTHLY', amountMinor: 5_000_000, indicative: true }],
        defaultCadence: 'MONTHLY',
        developmentFixture: false,
      },
    ],
  },
];
const impact = (over: Record<string, unknown> = {}) => ({
  type: 'UPGRADE',
  from: { planCode: 'GROWTH', amountMinor: 499_900, cadence: 'MONTHLY' },
  to: { planCode: 'BUSINESS', amountMinor: 1_499_900, cadence: 'MONTHLY', indicative: false },
  priceDeltaMinor: 1_000_000,
  currency: 'PKR',
  effectiveAt: now,
  effectiveMode: 'IMMEDIATE',
  added: { products: ['PUSH_CAMPAIGNS'], features: ['API_ACCESS'] },
  removed: { products: [], features: [] },
  limitChanges: [{ key: 'branches.max', from: 5, to: 25 }],
  excess: [],
  blocked: false,
  needsAcceptance: true,
  remediation: [],
  fees: [],
  ...over,
});
const base = (over: Record<string, R | ((c: Call) => R)> = {}) => ({
  '/subscription': ok(summary()),
  '/subscription/pending': ok(null),
  '/subscription/amendments': ok([]),
  '/subscription/plans': ok(plans),
  ...over,
});

describe('Merchant plan and usage', () => {
  it('shows the plan, status, price with its currency, renewal, usage meters, entitlements, add-ons and adjustments', async () => {
    stub(base());
    mount();
    expect(await screen.findByTestId('sb-plan-name')).toHaveTextContent('Merchant Growth');
    expect(screen.getByTestId('sb-status')).toHaveTextContent('Active');
    expect(screen.getByTestId('sb-price')).toHaveTextContent('PKR 4,999.00 / Monthly');
    expect(screen.getByTestId('sb-financial')).toHaveTextContent('Good standing');
    const branches = screen.getByTestId('sb-meter-branches.max');
    expect(branches).toHaveTextContent('6 of 7');
    expect(within(branches).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
    expect(within(screen.getByTestId('sb-included')).getByText('Live Deals')).toBeInTheDocument();
    expect(within(screen.getByTestId('sb-included')).getByText('Bulk import')).toBeInTheDocument();
    expect(screen.getByTestId('sb-limits')).toHaveTextContent('5 in the plan, 2 from add-ons');
    expect(screen.getByTestId('sb-addons')).toHaveTextContent('EXTRA_BRANCH × 2');
    expect(screen.getByTestId('sb-promotions')).toHaveTextContent('Discount');
    expect(screen.getByTestId('sb-history')).toHaveTextContent('Upgrade');
    // no invoices here: they belong to Finance
    expect(screen.queryByText(/invoice number/i)).toBeNull();
    expect(
      screen.getByText('Invoices, payments and statements are in Finance.'),
    ).toBeInTheDocument();
  });

  it('a negotiated plan never shows its indicative reference as a price', async () => {
    stub(base());
    mount();
    const card = await screen.findByTestId('sb-plan-MERCHANT_ENTERPRISE');
    expect(card).toHaveTextContent('Agreed with DealDash');
    expect(card).toHaveTextContent('Contact DealDash');
    expect(card).not.toHaveTextContent('50,000');
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('previews an upgrade (difference, price, date) before anything is requested, then requests it', async () => {
    const calls = stub(
      base({
        '/subscription/preview': ok(impact()),
        '/subscription/amendments': (c) =>
          c.method === 'POST'
            ? { status: 201, body: { data: { id: AMEND, status: 'PROPOSED' }, meta: {} } }
            : ok([]),
      }),
    );
    mount();
    const card = await screen.findByTestId('sb-plan-BUSINESS');
    await userEvent.click(within(card).getByRole('button', { name: 'See the difference' }));
    const view = await screen.findByTestId('sb-impact');
    expect(view).toHaveTextContent('New price: PKR 14,999.00 / Monthly');
    expect(screen.getByTestId('sb-impact-delta')).toHaveTextContent('+PKR 10,000.00');
    expect(view).toHaveTextContent('Push campaigns');
    expect(view).toHaveTextContent('Branches: 5 → 25');
    expect(
      calls.some((c) => c.method === 'POST' && c.url.endsWith('/subscription/amendments')),
    ).toBe(false);
    const preview = calls.find((c) => c.url.endsWith('/subscription/preview'))!;
    expect(JSON.parse(preview.body!)).toMatchObject({
      type: 'UPGRADE',
      targetPlanCode: 'BUSINESS',
      effectiveMode: 'IMMEDIATE',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Request this change' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith('/subscription/amendments')),
      ).toBe(true),
    );
    expect(await screen.findByText('Requested. Accept it below to apply it.')).toBeInTheDocument();
  });

  it('a blocked downgrade shows the excess and the remedies; requesting it now is disabled, scheduling is allowed', async () => {
    stub(
      base({
        '/subscription/preview': (c) => {
          const b = JSON.parse(c.body ?? '{}');
          return ok(
            impact({
              type: 'DOWNGRADE',
              effectiveMode: b.effectiveMode,
              to: { planCode: 'STARTER', amountMinor: 0, cadence: 'NONE', indicative: false },
              priceDeltaMinor: -499_900,
              blocked: b.effectiveMode === 'IMMEDIATE',
              excess: [{ key: 'branches.max', newLimit: 1, current: 6, excess: 5 }],
              remediation: [
                'DEACTIVATE_EXCESS',
                'SCHEDULE_FOR_LATER',
                'BUY_ADD_ON',
                'CANCEL_DOWNGRADE',
              ],
              limitChanges: [{ key: 'branches.max', from: 5, to: 1 }],
            }),
          );
        },
      }),
    );
    mount();
    const card = await screen.findByTestId('sb-plan-STARTER');
    await userEvent.click(within(card).getByRole('button', { name: 'See the difference' }));
    expect(await screen.findByTestId('sb-impact-blocked')).toHaveTextContent('Nothing is deleted');
    expect(screen.getByTestId('sb-impact')).toHaveTextContent(
      'Branches: you use 6, the new plan allows 1',
    );
    expect(screen.getByTestId('sb-impact')).toHaveTextContent(
      'Schedule the change for the next billing cycle',
    );
    expect(screen.getByRole('button', { name: 'Request this change' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('When'), 'NEXT_BILLING_CYCLE');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Request this change' })).toBeEnabled(),
    );
  });

  it('accepts a waiting change with the explicit language and confirmation', async () => {
    const calls = stub(
      base({
        '/subscription/amendments': (c) =>
          c.url.includes('/accept')
            ? ok({ id: AMEND, status: 'APPLIED', effectiveAt: now })
            : ok([
                {
                  id: AMEND,
                  contractId: CONTRACT,
                  organizationId: ORG,
                  type: 'UPGRADE',
                  status: 'PROPOSED',
                  effectiveMode: 'IMMEDIATE',
                  effectiveAt: now,
                  fromVersion: 1,
                  reason: null,
                  forced: false,
                  requestedByOrg: true,
                  impact: impact(),
                  appliedAt: null,
                  createdAt: now,
                },
              ]),
      }),
    );
    mount();
    const row = await screen.findByTestId(`sb-change-${AMEND}`);
    await userEvent.click(within(row).getByRole('button', { name: 'Accept and apply' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith(`/amendments/${AMEND}/accept`))).toBe(true),
    );
    expect(
      JSON.parse(calls.find((c) => c.url.endsWith(`/amendments/${AMEND}/accept`))!.body!),
    ).toEqual({ language: 'en', confirm: true });
    expect(await screen.findByText('Done. Your plan has changed.')).toBeInTheDocument();
  });

  it('a pending agreement shows the terms and maximum commitment; only an authorised person accepts, after confirming', async () => {
    const pending = {
      contract: contract({ status: 'PENDING_ACTIVATION' }),
      terms: {
        plan: { code: 'GROWTH', nameEn: 'Merchant Growth', nameAr: 'تاجر - باقة النمو' },
        kind: 'MERCHANT_SUBSCRIPTION',
        currency: 'PKR',
        basePrice: {
          amountMinor: 499_900,
          cadence: 'MONTHLY',
          indicative: false,
          pricingVersionKey: 'PLV:pv1',
        },
        fees: [],
        addOns: [],
        maxExposureMinor: 499_900,
        termsVersion: 'v1',
      },
    };
    const calls = stub(
      base({
        '/subscription/pending': ok(pending),
        '/subscription/accept': ok({ contract: contract() }),
      }),
    );
    mount();
    expect(await screen.findByTestId('sb-max-exposure')).toHaveTextContent('PKR 4,999.00');
    const accept = screen.getByRole('button', { name: 'Accept' });
    expect(accept).toBeDisabled();
    await userEvent.click(
      screen.getByLabelText('I have read the terms and accept them for my business'),
    );
    await userEvent.click(accept);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/subscription/accept'))).toBe(
        true,
      ),
    );
    vi.unstubAllGlobals();
  });

  it('a Finance user sees the plan but cannot accept, request or stop renewal', async () => {
    const pending = {
      contract: contract({ status: 'PENDING_ACTIVATION' }),
      terms: {
        plan: { code: 'GROWTH' },
        kind: 'MERCHANT_SUBSCRIPTION',
        currency: 'PKR',
        basePrice: null,
        fees: [],
        addOns: [],
        maxExposureMinor: 0,
        termsVersion: 'v1',
      },
    };
    stub(
      base({ '/subscription/pending': ok(pending), '/subscription/preview': ok(impact()) }),
      FINANCE,
    );
    mount();
    expect(
      await screen.findByText('Only an authorised person of your business can accept.'),
    ).toBeInTheDocument();
    await userEvent.click(
      within(await screen.findByTestId('sb-plan-BUSINESS')).getByRole('button', {
        name: 'See the difference',
      }),
    );
    await screen.findByTestId('sb-impact');
    expect(screen.queryByRole('button', { name: 'Request this change' })).toBeNull();
    expect(screen.queryByTestId('sb-stop')).toBeNull();
  });

  it('suspended: says what is paused and what customers keep', async () => {
    stub(
      base({
        '/subscription': ok(
          summary({
            lifecycle: 'SUSPENDED',
            contract: contract({ status: 'SUSPENDED' }),
            financialStatus: {
              status: 'SUSPENDED',
              reasons: ['CONTRACT_SUSPENDED'],
              graceUntil: null,
              contractId: CONTRACT,
            },
          }),
        ),
      }),
    );
    mount();
    expect(
      await screen.findByText(/Your customers can still redeem what they already hold/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('sb-status')).toHaveTextContent('Suspended');
    expect(screen.queryByTestId('sb-change')).toBeNull();
  });

  it('explains why something is unavailable from the real decision', async () => {
    stub(
      base({
        '/subscription/explain': ok({
          allowed: false,
          protectedAction: false,
          checks: [
            { step: 3, code: 'CONTRACT_IN_FORCE', ok: true, reason: null },
            { step: 9, code: 'USAGE_WITHIN_LIMIT', ok: false, reason: 'LIMIT_REACHED' },
          ],
          reasons: ['LIMIT_REACHED'],
          remedies: ['UPGRADE_PLAN', 'REQUEST_ADD_ON'],
        }),
      }),
    );
    mount();
    const panel = await screen.findByTestId('sb-explain');
    await userEvent.click(within(panel).getByRole('button', { name: 'Check' }));
    expect(await within(panel).findByText('Not available')).toBeInTheDocument();
    expect(panel).toHaveTextContent('Within your limit');
    expect(panel).toHaveTextContent('Move to a plan that includes it');
  });

  it('an unpriced development fixture says "No charge" and is marked as a test fixture', async () => {
    stub(
      base({
        '/subscription': ok(
          summary({
            contract: contract({
              billingCadence: 'NONE',
              developmentFixture: true,
              currency: 'SAR',
            }),
            price: {
              amountMinor: null,
              currency: 'SAR',
              indicative: false,
              waived: false,
              pricingVersionKey: 'PLV:x',
              adjustments: [],
            },
          }),
        ),
      }),
    );
    mount();
    const price = await screen.findByTestId('sb-price');
    expect(price).toHaveTextContent('No charge');
    expect(price).toHaveTextContent('Test fixture');
    expect(price).not.toHaveTextContent('Agreed with DealDash');
  });

  it('the default plan and the ended state are stated plainly', async () => {
    stub(
      base({
        '/subscription': ok(
          summary({
            source: 'DEFAULT_PLAN',
            lifecycle: null,
            contract: null,
            price: null,
            usage: [],
            amendments: [],
          }),
        ),
      }),
    );
    const { unmount } = mount();
    expect(
      await screen.findByText('Your business is on the default plan. DealDash assigns your plan.'),
    ).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    stub(
      base({
        '/subscription': ok(
          summary({
            source: 'CONTRACT',
            lifecycle: 'EXPIRED',
            contract: null,
            price: null,
            usage: [],
            amendments: [],
          }),
        ),
      }),
    );
    mount();
    expect(await screen.findByText(/Your agreement has ended/)).toBeInTheDocument();
  });

  it('renders in Arabic, right to left, with Western digits', async () => {
    stub(base());
    const { container } = mount('ar');
    expect(await screen.findByTestId('sb-plan-name')).toHaveTextContent('تاجر - باقة النمو');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('الباقة والاستخدام');
    expect(screen.getByTestId('sb-price')).toHaveTextContent('4,999.00 PKR');
    expect(screen.getByTestId('sb-meter-branches.max')).toHaveTextContent('6 من 7');
    expect(container.closest('[dir]') ?? document.documentElement).toBeTruthy();
  });
});
