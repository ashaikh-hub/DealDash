import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { AdminAiPage, AdminBillingPage, AdminCommandCentrePage } from './visibility';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/command-centre',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ME_ID = '018f0000-0000-7000-8000-000000000009';
const me = (permissions: string[]) => ({
  id: ME_ID,
  userType: 'ADMIN_USER',
  displayName: 'Ops',
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
    roleCode: 'DEALDASH_OPERATIONS',
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

const centre = ok({
  generatedAt: now,
  campaigns: ['LIVE', 'EXCLUSIVE', 'VOUCHER', 'WATCH'].map((product) => ({
    product,
    live: 3,
    pending: 1,
    paused: 0,
    expiring: 1,
    underperforming: 0,
    fundingLow: 0,
    financialHold: 0,
    inventoryExhausted: 0,
    suspended: 0,
  })),
  transactions: {
    windowHours: 24,
    payments: { succeeded: 10, failed: 2, failureRateBps: 1667 },
    voucherPurchases: { count: 10, valueMinor: 50000, currency: 'SAR' },
    redemptions: { exclusive: 4, voucher: 6, rejected: 1 },
    rewardAllocations: 0,
    pointsIssued: 120,
    loyaltyPostings: 3,
    qualifiedViews: 40,
  },
  finance: {
    funding: { receivedMinor: 100000, utilizedMinor: 40000, committedMinor: 200000 },
    invoices: [
      { currency: 'SAR', openCount: 2, openMinor: 30000, overdueCount: 1, overdueMinor: 10000 },
    ],
    receivablesLedgerMinor: 0,
    sponsorUtilizationBps: null,
    merchantPayableMinor: 9000,
    settlementPendingItems: 2,
    reconciliationExceptions: 0,
    financialHolds: 1,
    credit: { limitMinor: 500000, exposureMinor: 20000 },
    purchaseOrders: { open: 1, valueMinor: 100000, usedMinor: 30000 },
    pendingBillingEvents: 5,
  },
  integrations: [
    {
      family: 'PARTNER_FEED',
      state: 'STALE',
      adapter: 'CONNECTION',
      connections: 1,
      lastSuccessAt: now,
      detail: {},
    },
    {
      family: 'VISA',
      state: 'NOT_CONFIGURED',
      adapter: 'CONNECTION',
      connections: 0,
      lastSuccessAt: null,
      detail: {},
    },
    {
      family: 'PAYMENT_GATEWAY',
      state: 'HEALTHY',
      adapter: 'MOCK',
      connections: 1,
      lastSuccessAt: null,
      detail: {},
    },
  ],
  risk: {
    fraudAlerts: 2,
    byDecision: {},
    duplicateActivity: 0,
    suspiciousDevices: 1,
    staffMisuse: 0,
    unusualRedemptions: 1,
    rewardFarming: 0,
    reconciliationAnomalies: 0,
  },
  alerts: { open: 5, critical: 1, byCategory: {} },
  platform: {
    state: 'HEALTHY',
    database: { latencyMs: 3 },
    jobs: { queued: 0, failed24h: 0, oldestQueuedAgeSec: null },
    analytics: { asOf: now, lagSec: 60 },
    process: { uptimeSec: 100, rssMb: 200 },
  },
});

describe('Operations Command Centre', () => {
  it('shows campaign, transaction, financial, integration, risk and platform health', async () => {
    stub({ '/command-centre': centre }, ['admin.operations.read']);
    render(
      <Providers locale="en">
        <AdminCommandCentrePage />
      </Providers>,
    );
    expect(await screen.findByTestId('cc-campaigns')).toHaveTextContent('Exclusive Deals');
    expect(screen.getByTestId('cc-transactions')).toHaveTextContent('Failed payments');
    expect(screen.getByTestId('cc-finance')).toHaveTextContent('Overdue invoices (SAR)');
    const feed = within(screen.getByTestId('cc-integrations')).getByTestId(
      'integration-PARTNER_FEED',
    );
    expect(feed).toHaveTextContent('Not updated');
    expect(
      within(screen.getByTestId('cc-integrations')).getByTestId('integration-VISA'),
    ).toHaveTextContent('Not configured');
    expect(
      within(screen.getByTestId('cc-integrations')).getByTestId('integration-PAYMENT_GATEWAY'),
    ).toHaveTextContent('Mock (not live)');
    expect(screen.getByTestId('cc-risk')).toHaveTextContent('Open fraud flags');
    expect(screen.getByTestId('cc-platform')).toHaveTextContent('Healthy');
    // no customer timeline tab without the customer permission
    expect(screen.queryByRole('tab', { name: 'Customer timeline' })).toBeNull();
  });

  it('support finds a customer and sees the journey with masked mobile and references only', async () => {
    stub(
      {
        '/command-centre': centre,
        '/visibility/customers': ok([
          { id: 'u1', displayName: 'Sara', mobileMasked: '+966•••01', since: now },
        ]),
        '/customers/u1/timeline': ok({
          customer: {
            id: 'u1',
            displayName: 'Sara',
            mobileMasked: '+966•••01',
            locale: 'ar',
            status: 'ACTIVE',
            since: now,
          },
          items: [
            {
              at: now,
              kind: 'RESERVATION',
              event: 'RESERVATION_CREATED',
              reference: 'R-ABC',
              status: 'HELD',
              amountMinor: null,
              currency: null,
              points: null,
              data: {},
            },
          ],
        }),
      },
      ['admin.operations.read', 'admin.customers.read'],
    );
    render(
      <Providers locale="en">
        <AdminCommandCentrePage />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Customer timeline' }));
    await userEvent.type(screen.getByLabelText('Find a customer (mobile or name)'), '0501');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('button', { name: /Sara/ }));
    const items = await screen.findByTestId('timeline-items');
    expect(items).toHaveTextContent('Reservation made');
    expect(items).toHaveTextContent('R-ABC');
    expect(screen.getByTestId('support-timeline')).toHaveTextContent('+966•••01');
  });

  it('is hidden without the operations permission', async () => {
    stub({}, ['admin.org.read']);
    render(
      <Providers locale="en">
        <AdminCommandCentrePage />
      </Providers>,
    );
    await waitFor(() => expect(screen.queryByTestId('command-centre')).toBeNull());
  });

  it('renders in Arabic right-to-left', async () => {
    stub({ '/command-centre': centre }, ['admin.operations.read']);
    render(
      <Providers locale="ar">
        <AdminCommandCentrePage />
      </Providers>,
    );
    expect(await screen.findByText('مركز قيادة العمليات')).toBeInTheDocument();
    // the heading renders before the data arrives: wait for the section itself
    expect(await screen.findByTestId('cc-campaigns')).toHaveTextContent('العروض الحصرية');
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });
});

const draft = {
  id: 'd9',
  number: 'DRAFT-x',
  type: 'INVOICE',
  status: 'PENDING_APPROVAL',
  organizationId: 'o',
  legalEntityId: 'le',
  businessAccountId: 'acc',
  currency: 'SAR',
  subtotalMinor: 12_000_000,
  taxMinor: 0,
  totalMinor: 12_000_000,
  paidMinor: 0,
  creditedMinor: 0,
  outstandingMinor: 0,
  issuedAt: now,
  dueAt: null,
  fxRate: null,
  transactionCurrency: 'SAR',
  statutory: {},
  relatedDocumentId: null,
  purchaseOrderId: null,
};

describe('DealDash billing', () => {
  it('a large draft awaits a second finance person; only an approver can issue it', async () => {
    const routes = {
      '/billing/documents': ok([draft]),
      '/billing/accounts': ok([]),
      '/billing/receivables': ok([]),
      '/billing/documents/d9': ok({ ...draft, lines: [], payments: [], disputeCaseId: null }),
    };
    stub(routes, ['admin.finance.read', 'admin.finance.manage']);
    const { unmount } = render(
      <Providers locale="en">
        <AdminBillingPage />
      </Providers>,
    );
    await userEvent.click(
      within(await screen.findByTestId('bill-doc-DRAFT-x')).getByRole('button', { name: 'Open' }),
    );
    expect(await screen.findByTestId('bill-issue')).toBeDisabled();
    expect(screen.getByText(/needs a second finance person/)).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();
    const calls = stub(
      {
        ...routes,
        '/billing/documents/d9/issue': ok({
          ...draft,
          status: 'ISSUED',
          number: 'INV-000009',
          lines: [],
          payments: [],
          disputeCaseId: null,
        }),
      },
      ['admin.finance.read', 'admin.finance.manage', 'admin.finance.approve'],
    );
    render(
      <Providers locale="en">
        <AdminBillingPage />
      </Providers>,
    );
    await userEvent.click(
      within(await screen.findByTestId('bill-doc-DRAFT-x')).getByRole('button', { name: 'Open' }),
    );
    const issue = await screen.findByTestId('bill-issue');
    expect(issue).toBeEnabled();
    expect(issue).toHaveTextContent('Approve and issue');
    await userEvent.click(issue);
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/documents/d9/issue'))).toBe(
        true,
      ),
    );
  });

  it('exchange rates proposed by me cannot be approved by me', async () => {
    stub(
      {
        '/billing/documents': ok([]),
        '/billing/accounts': ok([]),
        '/billing/receivables': ok([]),
        '/billing/fx-rates': ok([
          {
            id: 'fx1',
            baseCurrency: 'SAR',
            quoteCurrency: 'AED',
            rate: '0.9790',
            source: 'SAMA',
            rateDate: now,
            status: 'PENDING_APPROVAL',
            createdByUserId: ME_ID,
          },
          {
            id: 'fx2',
            baseCurrency: 'SAR',
            quoteCurrency: 'PKR',
            rate: '74.1',
            source: 'SBP',
            rateDate: now,
            status: 'PENDING_APPROVAL',
            createdByUserId: 'someone-else',
          },
        ]),
      },
      ['admin.finance.read', 'admin.finance.manage', 'admin.finance.approve'],
    );
    render(
      <Providers locale="en">
        <AdminBillingPage />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Exchange rates' }));
    const rows = (await screen.findByTestId('bill-fx')).querySelectorAll('tbody tr');
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Approve' }),
    ).toBeInTheDocument();
  });
});

describe('DealDash AI governance', () => {
  it('runs the evaluation pack and shows usage as not priced', async () => {
    stub(
      {
        '/admin/ai/drafts': ok([]),
        '/admin/ai/evaluations': ok({
          passed: 13,
          failed: 0,
          results: [
            {
              case: 'INVENTED_PRICE',
              passed: true,
              detail: 'A price not in the tool results is dropped',
            },
          ],
        }),
        '/admin/ai/usage': ok({
          commercialTreatment: 'INCLUDED_FEATURE',
          pricing: 'NOT_PRICED',
          rows: [
            {
              agent: 'MERCHANT_GROWTH',
              kind: 'REQUEST',
              records: 3,
              units: 3,
              estimatedCostMinor: 0,
            },
          ],
        }),
      },
      ['admin.ai.use', 'admin.ai.manage'],
    );
    render(
      <Providers locale="en">
        <AdminAiPage />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: 'Evaluations' }));
    await userEvent.click(screen.getByTestId('ai-run-evals'));
    expect(await screen.findByText('13 passed, 0 failed')).toBeInTheDocument();
    expect(screen.getByText('No invented prices')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Usage' }));
    expect(await screen.findByTestId('ai-usage')).toHaveTextContent('AI is not priced');
  });

  it('support staff use the assistant but do not see audit, usage or evaluations', async () => {
    stub({ '/admin/ai/drafts': ok([]) }, ['admin.ai.use']);
    render(
      <Providers locale="en">
        <AdminAiPage />
      </Providers>,
    );
    await screen.findByTestId('ai-panel');
    expect(screen.queryByRole('tab', { name: 'Audit' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Evaluations' })).toBeNull();
  });
});
