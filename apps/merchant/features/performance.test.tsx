import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { MerchantAssistantPage, MerchantBillingPage, MerchantPerformancePage } from './performance';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/performance',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const OWNER = [
  'merchant.performance.read',
  'merchant.targets.manage',
  'merchant.alerts.manage',
  'merchant.finance.read',
  'merchant.finance.manage',
  'merchant.ai.use',
  'merchant.ai.approve',
];
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

const overview = ok({
  from: now,
  to: now,
  asOf: now,
  products: [
    {
      product: 'EXCLUSIVE',
      entitled: true,
      metrics: {
        'exclusive.credentials_issued': 4,
        'exclusive.verified_redemptions': 2,
        'exclusive.redemption_rate': 5000,
      },
    },
    { product: 'LIVE', entitled: true, metrics: { 'live.directions': 7, 'live.online_clicks': 3 } },
  ],
});
const target = {
  id: 't1',
  name: 'Lunch redemptions',
  metric: 'REDEMPTIONS',
  unit: 'COUNT',
  currency: null,
  product: 'EXCLUSIVE',
  periodStart: now,
  periodEnd: now,
  target: 10,
  actual: 4,
  expectedToDate: 5,
  elapsedBps: 5000,
  achievementBps: 4000,
  status: 'ON_TRACK',
  source: 'MANUAL',
  forecast: { value: 8, label: 'FORECAST_ESTIMATE', method: 'RUN_RATE', confidence: 'MEDIUM' },
};
const alert = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  code: 'BUDGET_PROJECTED_EXHAUST',
  category: 'FUNDING',
  severity: 'WARNING',
  status: 'OPEN',
  product: 'WATCH',
  data: {},
  action: 'ADD_BUDGET',
  actionHref: '/watch/w1',
  actionPermission: 'merchant.watch.manage',
  actionAllowed: true,
  escalationLevel: 0,
  createdAt: now,
  ...over,
});

describe('merchant performance workspace', () => {
  it('shows product metrics with the honesty note (a click is not a sale) and data freshness', async () => {
    stub({ '/performance/overview': overview });
    render(
      <Providers locale="en">
        <MerchantPerformancePage />
      </Providers>,
    );
    const exclusive = await screen.findByTestId('vis-product-EXCLUSIVE');
    expect(within(exclusive).getByText('Verified redemptions')).toBeInTheDocument();
    expect(within(exclusive).getByText('50%')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('vis-product-LIVE')).getByText('Online clicks (not sales)'),
    ).toBeInTheDocument();
    expect(screen.getByText(/A view or a click is not a sale/)).toBeInTheDocument();
    expect(screen.getByTestId('vis-asof')).toHaveTextContent('Data as of');
  });

  it('targets show actual, expected-to-date and a forecast labelled as an estimate; managers can add one', async () => {
    const calls = stub({
      '/performance/overview': overview,
      '/targets': (c) => (c.method === 'POST' ? ok({ ...target, id: 't2' }) : ok([target])),
    });
    render(
      <Providers locale="en">
        <MerchantPerformancePage />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Targets' }));
    const card = await screen.findByTestId('vis-target-t1');
    expect(within(card).getByText('Expected to date')).toBeInTheDocument();
    expect(within(card).getByTestId('vis-forecast')).toHaveTextContent('Forecast · estimate');
    expect(within(card).getByText('On track')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Target name'), 'Views');
    await userEvent.type(screen.getByLabelText('Target'), '100');
    await userEvent.click(screen.getByTestId('vis-target-create'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/targets'))).toBe(true),
    );
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toMatchObject({
      name: 'Views',
      targetValue: 100,
      metric: 'REDEMPTIONS',
    });
  });

  it('a campaign manager without target rights sees targets but no form', async () => {
    stub({ '/performance/overview': overview, '/targets': ok([target]) }, [
      'merchant.performance.read',
    ]);
    render(
      <Providers locale="en">
        <MerchantPerformancePage />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Targets' }));
    await screen.findByTestId('vis-target-t1');
    expect(screen.queryByTestId('vis-target-form')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Alert rules' })).toBeNull();
  });

  it('alerts are actionable only with permission and can be acknowledged', async () => {
    const calls = stub({
      '/performance/overview': overview,
      '/alerts': ok([
        alert(),
        alert({
          id: 'a2',
          code: 'INVOICE_OVERDUE',
          severity: 'CRITICAL',
          category: 'FINANCE',
          action: 'VIEW_INVOICE',
          actionHref: '/billing?document=d1',
          actionAllowed: false,
          escalationLevel: 1,
        }),
      ]),
      '/alerts/a1/acknowledge': ok({ id: 'a1', status: 'ACKNOWLEDGED' }),
    });
    render(
      <Providers locale="en">
        <MerchantPerformancePage />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Alerts' }));
    const a1 = await screen.findByTestId('vis-alert-a1');
    expect(within(a1).getByTestId('vis-alert-action')).toHaveAttribute('href', '/en/watch/w1');
    expect(within(a1).getByText('Add budget')).toBeInTheDocument();
    const a2 = screen.getByTestId('vis-alert-a2');
    expect(within(a2).queryByTestId('vis-alert-action')).toBeNull();
    expect(within(a2).getByTestId('vis-action-denied')).toHaveTextContent(
      'someone with the right permission',
    );
    expect(within(a2).getByText('Escalated (level 1)')).toBeInTheDocument();
    await userEvent.click(within(a1).getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith('/alerts/a1/acknowledge')),
      ).toBe(true),
    );
  });

  it('drill-down narrows the report; above-branch grouping without Advanced Reporting shows the entitlement message', async () => {
    const calls = stub({
      '/performance/overview': overview,
      '/performance/report': (c) =>
        c.url.includes('groupBy=LEGAL_ENTITY')
          ? {
              status: 403,
              body: { errors: [{ code: 'ENTITLEMENT_REQUIRED', message: 'x' }], meta: {} },
            }
          : c.url.includes('groupBy=CAMPAIGN')
            ? ok({
                groupBy: 'CAMPAIGN',
                rows: [
                  {
                    key: 'c1',
                    label: { en: 'Lunch deal', ar: 'عرض الغداء' },
                    metrics: { 'exclusive.verified_redemptions': 2 },
                  },
                ],
                totals: { 'exclusive.verified_redemptions': 2 },
              })
            : ok({
                groupBy: 'PRODUCT',
                rows: [
                  {
                    key: 'EXCLUSIVE',
                    label: null,
                    metrics: { 'exclusive.verified_redemptions': 2 },
                  },
                ],
                totals: { 'exclusive.verified_redemptions': 2 },
              }),
    });
    render(
      <Providers locale="en">
        <MerchantPerformancePage />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Drill-down report' }));
    await screen.findByTestId('vis-report-table');
    await userEvent.click(screen.getByRole('button', { name: 'Drill down' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes('groupBy=CAMPAIGN') && c.url.includes('product=EXCLUSIVE'),
        ),
      ).toBe(true),
    );
    expect(screen.getByTestId('vis-breadcrumb')).toBeInTheDocument();
    // a bilingual group name (campaign, branch, business) is shown in the reader's language, never as an object
    expect(await screen.findByText('Lunch deal')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByTestId('vis-groupby'), 'LEGAL_ENTITY');
    expect(await screen.findByTestId('vis-denied')).toBeInTheDocument();
  });

  it('without the performance permission the page is not shown', async () => {
    stub({}, ['merchant.profile.read']);
    render(
      <Providers locale="en">
        <MerchantPerformancePage />
      </Providers>,
    );
    await waitFor(() => expect(screen.queryByTestId('performance-workspace')).toBeNull());
  });

  it('renders right-to-left in Arabic with Arabic labels and Western digits', async () => {
    stub({ '/performance/overview': overview });
    const { container } = render(
      <Providers locale="ar">
        <MerchantPerformancePage />
      </Providers>,
    );
    const exclusive = await screen.findByTestId('vis-product-EXCLUSIVE');
    expect(within(exclusive).getByText('العروض الحصرية')).toBeInTheDocument();
    expect(within(exclusive).getByText('عمليات الاسترداد الموثّقة')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[٠-٩]/);
  });
});

const account = (over: Record<string, unknown> = {}) => ({
  id: 'acc1',
  organizationId: ORG,
  legalEntityId: 'le1',
  legalEntity: { legalName: 'Test Cafe LLC', country: 'SA', taxNumber: null },
  name: 'Test Cafe LLC',
  currency: 'SAR',
  country: 'SA',
  isDefault: true,
  status: 'ACTIVE',
  billingAddress: {},
  taxId: null,
  financeContact: {},
  invoiceContact: { email: 'ap@cafe.test' },
  paymentTermsDays: 30,
  billingFrequency: 'MONTHLY',
  billingMethod: 'INVOICE',
  contractId: null,
  poRequired: false,
  credit: null,
  ...over,
});
const doc = {
  id: 'd1',
  number: 'INV-000001',
  type: 'INVOICE',
  status: 'OVERDUE',
  organizationId: ORG,
  legalEntityId: 'le1',
  businessAccountId: 'acc1',
  currency: 'SAR',
  subtotalMinor: 10000,
  taxMinor: 0,
  totalMinor: 10000,
  paidMinor: 0,
  creditedMinor: 0,
  outstandingMinor: 10000,
  issuedAt: now,
  dueAt: now,
  fxRate: null,
  transactionCurrency: 'SAR',
  statutory: { status: 'TAX_NOT_CONFIGURED_VALIDATE' },
  relatedDocumentId: null,
  purchaseOrderId: null,
};

describe('merchant billing workspace', () => {
  it('lists invoices; opening one shows lines and lets Finance dispute it', async () => {
    const calls = stub({
      '/billing/accounts': ok([account()]),
      '/billing/documents': ok([doc]),
      '/billing/receivables': ok([]),
      '/billing/documents/d1': ok({
        ...doc,
        lines: [
          {
            lineNo: 1,
            kind: 'CHARGE',
            description: 'Annual licence',
            descriptionAr: 'ترخيص سنوي',
            quantity: 1,
            unitPriceMinor: null,
            amountMinor: 10000,
            taxMinor: 0,
            collection: 'INVOICE_DUE',
          },
        ],
        payments: [],
        disputeCaseId: null,
      }),
      '/billing/documents/d1/dispute': ok({ caseId: 'c1' }),
    });
    render(
      <Providers locale="en">
        <MerchantBillingPage />
      </Providers>,
    );
    const row = await screen.findByTestId('bill-doc-INV-000001');
    expect(within(row).getByText('Overdue')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('bill-docs')).getByRole('columnheader', { name: 'Issued' }),
    ).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('Tax treatment pending confirmation')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('bill-lines')).getByText('Annual licence'),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('What is wrong?'), 'Wrong period');
    await userEvent.click(screen.getByTestId('bill-dispute'));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith('/documents/d1/dispute')),
      ).toBe(true),
    );
  });

  it('a financial hold is explained without blocking customer rights', async () => {
    stub({
      '/billing/accounts': ok([account({ status: 'FINANCIAL_HOLD' })]),
      '/billing/documents': ok([]),
      '/billing/receivables': ok([]),
    });
    render(
      <Providers locale="en">
        <MerchantBillingPage />
      </Providers>,
    );
    expect(await screen.findByTestId('bill-hold')).toHaveTextContent(
      'Live customer rights, redemptions and your records are not affected',
    );
  });

  it('a read-only finance viewer cannot dispute', async () => {
    stub(
      {
        '/billing/accounts': ok([account()]),
        '/billing/documents': ok([doc]),
        '/billing/receivables': ok([]),
        '/billing/documents/d1': ok({ ...doc, lines: [], payments: [], disputeCaseId: null }),
      },
      ['merchant.finance.read'],
    );
    render(
      <Providers locale="en">
        <MerchantBillingPage />
      </Providers>,
    );
    await userEvent.click(
      within(await screen.findByTestId('bill-doc-INV-000001')).getByRole('button', {
        name: 'Open',
      }),
    );
    await screen.findByTestId('bill-lines');
    expect(screen.queryByTestId('bill-dispute')).toBeNull();
  });
});

describe('merchant growth assistant', () => {
  it('labels every statement, shows drafts for approval and approves through the API', async () => {
    const calls = stub({
      '/ai/drafts': ok([]),
      '/ai/ask': ok({
        interactionId: 'i1',
        agent: 'MERCHANT_GROWTH',
        intent: 'DRAFT_TARGETS',
        label: 'AI_SUGGESTED',
        locale: 'en',
        localeNote: null,
        autonomyLevel: 2,
        statements: [
          {
            kind: 'OBSERVED_FACT',
            text: 'Exclusive Deals, last 30 days: verified redemptions 2.',
            sources: [],
          },
          {
            kind: 'RECOMMENDATION',
            text: 'Exclusive Deals: target 3 for the next 30 days. A target, not a guaranteed result.',
            sources: [],
          },
        ],
        items: [],
        drafts: [
          {
            id: 'dr1',
            kind: 'CAMPAIGN_TARGETS',
            title: 'Targets for the next 30 days',
            status: 'PENDING_APPROVAL',
            label: 'AI_DRAFTED',
            requiresApprovalBy: 'merchant.targets.manage',
            payload: {},
          },
        ],
        actions: [],
        handoff: null,
        disclaimer: 'AI suggestions can be incomplete.',
      }),
      '/ai/drafts/dr1/approve': ok({ id: 'dr1', status: 'EXECUTED' }),
    });
    render(
      <Providers locale="en">
        <MerchantAssistantPage />
      </Providers>,
    );
    await userEvent.type(await screen.findByLabelText('Ask a question'), 'Suggest targets');
    await userEvent.click(screen.getByLabelText('Let it prepare drafts for my approval'));
    await userEvent.click(screen.getByTestId('ai-send'));
    expect(await screen.findByTestId('ai-statement-OBSERVED_FACT')).toHaveTextContent('Fact');
    expect(screen.getByTestId('ai-statement-RECOMMENDATION')).toHaveTextContent('Suggestion');
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/ai/ask'))!.body!)).toMatchObject({
      autonomy: 2,
      locale: 'en',
    });
    const draft = screen.getByTestId('ai-draft-CAMPAIGN_TARGETS');
    expect(within(draft).getByText('AI drafted')).toBeInTheDocument();
    await userEvent.click(within(draft).getByTestId('ai-approve'));
    expect(
      await screen.findByText('Approved and carried out under your name.'),
    ).toBeInTheDocument();
  });

  it('shows the entitlement refusal when the plan has no assistant', async () => {
    stub({
      '/ai/drafts': ok([]),
      '/ai/ask': {
        status: 403,
        body: { errors: [{ code: 'AI_NOT_ENTITLED', message: 'x' }], meta: {} },
      },
    });
    render(
      <Providers locale="en">
        <MerchantAssistantPage />
      </Providers>,
    );
    await userEvent.type(await screen.findByLabelText('Ask a question'), 'How are we doing?');
    await userEvent.click(screen.getByTestId('ai-send'));
    expect(await screen.findByTestId('ai-error')).toHaveTextContent(
      'The assistant is not included in your plan.',
    );
  });
});
