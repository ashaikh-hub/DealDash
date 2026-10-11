import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { AdminSubscriptionsPage } from './subscriptions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/subscriptions',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const BANK = '018f0000-0000-7000-8000-0000000000bb';
const CONTRACT = '018f0000-0000-7000-8000-0000000000c1';
const VERSION = '018f0000-0000-7000-8000-0000000000f1';
const AMEND = '018f0000-0000-7000-8000-0000000000d1';
const FINANCE = [
  'admin.subscriptions.read',
  'admin.subscriptions.manage',
  'admin.subscriptions.approve',
];
const READER = ['admin.subscriptions.read'];
const me = (permissions: string[]) => ({
  id: '018f0000-0000-7000-8000-000000000009',
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
function stub(routes: Record<string, R | ((c: Call) => R)>, perms = FINANCE) {
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
const mount = (locale: 'en' | 'ar' = 'en') =>
  render(<Providers locale={locale}>{<AdminSubscriptionsPage />}</Providers>);
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
const now = new Date().toISOString();

const rows = [
  {
    id: CONTRACT,
    organizationId: ORG,
    organization: { en: 'Test Cafe', ar: 'مقهى الاختبار' },
    name: null,
    kind: 'MERCHANT_SUBSCRIPTION',
    status: 'ACTIVE',
    planCode: 'GROWTH',
    market: 'PK',
    currency: 'PKR',
    billingCadence: 'MONTHLY',
    renewalState: 'AUTO_RENEW',
    effectiveFrom: now,
    effectiveUntil: null,
    nextRenewalAt: null,
    developmentFixture: false,
  },
  {
    id: 'c2',
    organizationId: BANK,
    organization: { en: 'Test Bank', ar: 'بنك الاختبار' },
    name: null,
    kind: 'BANK_ENTERPRISE',
    status: 'PENDING_ACTIVATION',
    planCode: 'BANK_ENTERPRISE',
    market: 'PK',
    currency: 'PKR',
    billingCadence: 'ANNUAL',
    renewalState: 'AUTO_RENEW',
    effectiveFrom: now,
    effectiveUntil: null,
    nextRenewalAt: null,
    developmentFixture: true,
  },
];
const contract = {
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
  version: 2,
  planCode: 'GROWTH',
  planName: { en: 'Merchant Growth', ar: 'تاجر - باقة النمو' },
  planVersionId: VERSION,
  planVersion: 1,
  effectiveFrom: now,
  effectiveUntil: null,
  pastDueSince: null,
  graceUntil: null,
  suspendedAt: null,
  nextBillingAt: null,
  nextRenewalAt: null,
  supportLevel: 'STANDARD',
  accountManager: null,
  pricingVersionKey: `PLV:${VERSION}`,
  developmentFixture: false,
  entitlements: [
    {
      id: 'e1',
      kind: 'LIMIT',
      key: 'branches.max',
      enabled: true,
      limitValue: 5,
      source: 'PLAN',
      mode: 'HARD',
      period: 'NONE',
      effectiveFrom: now,
      effectiveUntil: null,
    },
    {
      id: 'e2',
      kind: 'LIMIT',
      key: 'branches.max',
      enabled: true,
      limitValue: 1,
      source: 'PLAN',
      mode: 'HARD',
      period: 'NONE',
      effectiveFrom: now,
      effectiveUntil: now,
    },
  ],
  addOns: [],
  trial: null,
  promotions: [],
  rates: [
    {
      id: 'r1',
      itemCode: 'SUBSCRIPTION',
      version: 1,
      model: 'FIXED',
      amountMinor: 400_000,
      rateBps: null,
      discountBps: null,
      waived: false,
      effectiveFrom: now,
      effectiveUntil: null,
    },
  ],
};
const routes = (over: Record<string, R | ((c: Call) => R)> = {}) => ({
  '/v1/admin/subscriptions/contracts': ok(rows),
  [`/v1/admin/subscriptions/contracts/${CONTRACT}`]: ok(contract),
  [`/v1/admin/subscriptions/contracts/${CONTRACT}/terms`]: ok({
    plan: { code: 'GROWTH' },
    kind: 'MERCHANT_SUBSCRIPTION',
    currency: 'PKR',
    basePrice: {
      amountMinor: 400_000,
      cadence: 'MONTHLY',
      indicative: false,
      pricingVersionKey: 'CR:r1',
    },
    fees: [],
    addOns: [],
    maxExposureMinor: 400_000,
    termsVersion: 'v1',
  }),
  [`/v1/admin/subscriptions/contracts/${CONTRACT}/acceptances`]: ok([
    {
      id: 'acc1',
      reference: 'CA-1',
      userRole: 'MERCHANT_OWNER',
      userName: 'Owner',
      onBehalf: false,
      pricingVersionKey: `PLV:${VERSION}`,
      currency: 'PKR',
      acceptedAmountMinor: 499_900,
      maxExposureMinor: 499_900,
      billingCadence: 'MONTHLY',
      createdAt: now,
    },
  ]),
  [`/v1/admin/subscriptions/organizations/${ORG}`]: ok({
    source: 'CONTRACT',
    lifecycle: 'ACTIVE',
    financialStatus: {
      status: 'GOOD_STANDING',
      reasons: [],
      graceUntil: null,
      contractId: CONTRACT,
    },
    contract,
    price: null,
    products: [],
    features: [],
    limits: [],
    usage: [],
    amendments: [],
    previousAgreements: [],
  }),
  '/v1/admin/subscriptions/amendments': ok([]),
  '/v1/admin/subscriptions/plans': ok([
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
      versions: [
        {
          id: VERSION,
          market: 'PK',
          currency: 'PKR',
          version: 2,
          status: 'DRAFT',
          effectiveFrom: now,
          effectiveUntil: null,
          prices: [{ cadence: 'MONTHLY', amountMinor: 599_900 }],
          defaultCadence: 'MONTHLY',
          developmentFixture: false,
        },
        {
          id: 'v1',
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
  ]),
  ...over,
});

describe('Admin subscriptions workspace', () => {
  it('lists every agreement, enterprise ones included, with kind, plan, lifecycle and fixtures marked', async () => {
    stub(routes());
    mount();
    expect(await screen.findByText('Test Cafe')).toBeInTheDocument();
    const bank = screen.getByTestId('sb-row-c2');
    expect(bank).toHaveTextContent('Bank enterprise agreement');
    expect(bank).toHaveTextContent('Waiting for acceptance');
    expect(bank).toHaveTextContent('Test fixture');
  });

  it('opens an agreement: terms with the pricing version, effective-dated entitlements, rates and immutable acceptances', async () => {
    stub(routes());
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Test Cafe' }));
    const terms = await screen.findByTestId('sb-terms');
    expect(terms).toHaveTextContent('PKR 4,000.00 / Monthly');
    expect(terms).toHaveTextContent('CR:r1');
    expect(screen.getByTestId('sb-entitlements')).toHaveTextContent('Branches');
    expect(screen.getByTestId('sb-rates')).toHaveTextContent('SUBSCRIPTION');
    expect(screen.getByTestId('sb-acceptances')).toHaveTextContent('CA-1');
    expect(screen.getByText(/Suspension stops NEW exposure only/)).toBeInTheDocument();
  });

  it('a lifecycle action needs a reason and posts it', async () => {
    const calls = stub(
      routes({
        [`/v1/admin/subscriptions/contracts/${CONTRACT}/suspend`]: ok({
          ...contract,
          status: 'SUSPENDED',
        }),
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Test Cafe' }));
    const suspend = await screen.findByTestId('sb-life-suspend');
    expect(suspend).toBeDisabled();
    await userEvent.type(
      within(screen.getByTestId('sb-lifecycle')).getByLabelText('Reason'),
      'Grace elapsed',
    );
    await userEvent.click(suspend);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/suspend'))).toBe(true),
    );
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/suspend'))!.body!)).toEqual({
      reason: 'Grace elapsed',
    });
  });

  it('a reader sees agreements but no lifecycle, rate, promotion or proposal controls', async () => {
    stub(routes(), READER);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Test Cafe' }));
    await screen.findByTestId('sb-terms');
    expect(screen.queryByTestId('sb-life-suspend')).toBeNull();
    expect(screen.queryByTestId('sb-life-cancel')).toBeNull();
    expect(screen.queryByTestId('sb-rate-form')).toBeNull();
    expect(screen.queryByTestId('sb-promo-form')).toBeNull();
    expect(screen.queryByTestId('sb-propose')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign a plan' })).toBeNull();
  });

  it('catalog: versions by market with prices; a draft can be published by an approver', async () => {
    const calls = stub(
      routes({
        [`/v1/admin/subscriptions/plan-versions/${VERSION}/publish`]: ok({
          id: VERSION,
          status: 'PUBLISHED',
        }),
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: 'Plan catalog' }));
    const card = await screen.findByTestId('sb-catalog-GROWTH');
    expect(card).toHaveTextContent('PKR 5,999.00');
    expect(card).toHaveTextContent('Draft');
    expect(card).toHaveTextContent('Published');
    await userEvent.click(within(card).getByRole('button', { name: 'Publish (second person)' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'POST' && c.url.endsWith(`/plan-versions/${VERSION}/publish`),
        ),
      ).toBe(true),
    );
  });

  it('a pending DealDash-only change is applied by a second person; the server refuses the author', async () => {
    const am = {
      id: AMEND,
      contractId: CONTRACT,
      organizationId: ORG,
      type: 'ENTITLEMENT',
      status: 'PROPOSED',
      effectiveMode: 'IMMEDIATE',
      effectiveAt: now,
      fromVersion: 1,
      reason: 'Negotiated 7 branches',
      forced: false,
      requestedByOrg: false,
      impact: null,
      appliedAt: null,
      createdAt: now,
    };
    stub(
      routes({
        '/v1/admin/subscriptions/amendments': ok([am]),
        [`/v1/admin/subscriptions/amendments/${AMEND}/apply`]: {
          status: 403,
          body: { errors: [{ code: 'APPROVAL_REQUIRED', message: 'x' }], meta: {} },
        },
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: 'Changes' }));
    const row = await screen.findByTestId(`sb-amendment-${AMEND}`);
    expect(row).toHaveTextContent('Entitlement change');
    expect(row).toHaveTextContent('Proposed by DealDash');
    await userEvent.click(within(row).getByRole('button', { name: 'Apply (second person)' }));
    expect(await within(row).findByTestId('sb-banner')).toBeInTheDocument();
  });

  it('billing events: revenue categories and pricing versions, with the note that funding is never revenue', async () => {
    stub(
      routes({
        '/v1/admin/subscriptions/billing-events': ok([
          {
            id: 'b1',
            idempotencyKey: 'k',
            organizationId: ORG,
            contractId: CONTRACT,
            billingLegalEntityId: null,
            eventType: 'MONTHLY_SUBSCRIPTION_RENEWAL',
            billingCategory: 'SUBSCRIPTION_LICENCE',
            amountMinor: 499_900,
            currency: 'PKR',
            quantity: 1,
            pricingVersionKey: `PLV:${VERSION}`,
            status: 'PENDING',
            occurredAt: now,
          },
        ]),
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: 'Billing events' }));
    const panel = await screen.findByTestId('sb-billing');
    expect(await within(panel).findByText('Monthly subscription')).toBeInTheDocument();
    expect(panel).toHaveTextContent('Subscription / licence');
    expect(panel).toHaveTextContent('PKR 4,999.00');
    expect(panel).toHaveTextContent('Waiting for Finance');
    expect(panel).toHaveTextContent('never DealDash revenue');
  });

  it('signals and readiness', async () => {
    stub(
      routes({
        '/v1/admin/subscriptions/signals': ok([
          {
            id: 's1',
            type: 'BRANCH_LIMIT_80_PERCENT',
            organizationId: ORG,
            metricKey: 'branch.count',
            consumedAt: null,
            createdAt: now,
          },
        ]),
        '/v1/admin/subscriptions/readiness/unassigned': ok([
          {
            organizationId: BANK,
            name: { en: 'Unassigned Bank', ar: 'بنك' },
            type: 'PARTNER',
            partnerType: 'BANK',
          },
        ]),
      }),
    );
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: 'Signals' }));
    expect(await screen.findByText('Branches at 80 % of the limit')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Readiness' }));
    expect(await screen.findByTestId(`sb-unassigned-${BANK}`)).toHaveTextContent('Unassigned Bank');
  });

  it('renders in Arabic', async () => {
    stub(routes());
    mount('ar');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'الاشتراكات والتراخيص',
    );
    expect(await screen.findByText('مقهى الاختبار')).toBeInTheDocument();
    expect(screen.getByTestId('sb-row-c2')).toHaveTextContent('اتفاقية مؤسسات للبنك');
  });
});
