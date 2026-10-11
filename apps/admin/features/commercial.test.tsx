import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { AdminCommercialPage } from './commercial';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/commercial',
  useSearchParams: () => new URLSearchParams(),
}));

const CASE = '018f0000-0000-7000-8000-0000000000c1';
const ORG = '018f0000-0000-7000-8000-0000000000aa';
const SPONSOR = '018f0000-0000-7000-8000-0000000000bb';
const QUOTE = '018f0000-0000-7000-8000-0000000000c2';
const READER = ['admin.finance.read'];
const FINANCE = [
  'admin.finance.read',
  'admin.finance.manage',
  'admin.finance.pricing.manage',
  'admin.finance.credit.manage',
  'admin.finance.credit.approve',
];
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
    organizationId: 'dd',
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
type R = { status?: number; body: unknown } | ((c: Call) => { status?: number; body: unknown });
function stub(routes: Record<string, R>, perms = READER) {
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
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length))
        if (url.includes(key)) {
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
const mount = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') =>
  render(<Providers locale={locale}>{ui}</Providers>);

const totals = {
  currency: 'SAR',
  maxUnits: 5,
  dealdashChargesHalalas: 500,
  taxHalalas: 0,
  taxStatus: 'NOT_CONFIGURED',
  maxCashPayableToDealDashHalalas: 500,
  nettedChargesHalalas: 0,
  maxSponsorLiabilityHalalas: 0,
  sponsorLiability: [],
  merchantCashContributionHalalas: 0,
  maxMerchantBenefitCommitmentHalalas: 9000,
  customerBenefitTotalHalalas: 10000,
  totalEconomicCommitmentHalalas: 9500,
  issues: [],
};
const caseView = (over: Record<string, unknown> = {}) => ({
  id: CASE,
  reference: 'CC-000001',
  product: 'EXCLUSIVE',
  subjectId: '018f0000-0000-7000-8000-0000000000d1',
  status: 'AWAITING_FUNDING',
  ownerOrganizationId: ORG,
  fulfilmentOrganizationId: ORG,
  developmentFixture: true,
  unusedTreatment: null,
  quotation: {
    id: QUOTE,
    reference: 'QT-000001',
    version: 1,
    status: 'ACCEPTED',
    createdAt: new Date().toISOString(),
    delta: null,
  },
  preview: {
    lines: [],
    totals,
    pricing: { source: 'DEFAULT', reference: null, versionKey: 'D:1', unusedTreatment: null },
    parties: [
      { role: 'OWNER', organizationId: ORG, requiredChecks: ['REVIEWED_TERMS', 'ACCEPT_TERMS'] },
      {
        role: 'SPONSOR',
        organizationId: SPONSOR,
        requiredChecks: ['REVIEWED_TERMS', 'CONFIRM_FUNDING', 'ACCEPT_TERMS'],
      },
    ],
    fundingRequirements: [],
    workflow: [],
  },
  acceptances: [],
  approvals: [],
  funding: [],
  blockers: [
    { code: 'ACCEPTANCE_MISSING', party: 'SPONSOR', detail: SPONSOR },
    { code: 'UNUSED_FUNDING_TREATMENT_NOT_CONFIGURED', party: null, detail: null },
  ],
  submitBlockers: [],
  allowedActions: [],
  hold: { active: false, reason: null },
  updatedAt: new Date().toISOString(),
  ...over,
});
const row = {
  id: CASE,
  reference: 'CC-000001',
  product: 'EXCLUSIVE',
  subjectId: '018f0000-0000-7000-8000-0000000000d1',
  title: null,
  status: 'AWAITING_FUNDING',
  ownerOrganizationId: ORG,
  ownerName: { en: 'Alpha Grill', ar: 'ألفا غريل' },
  maxCashHalalas: 500,
  benefitCommitmentHalalas: 9000,
  developmentFixture: true,
  updatedAt: new Date().toISOString(),
};
const recon = {
  id: null,
  caseId: CASE,
  status: 'NOT_RUN',
  computedAt: new Date().toISOString(),
  inventory: {
    configured: 5,
    issued: 2,
    redeemed: 1,
    expiredOrUnused: 0,
    invalidOrCancelled: 0,
    remaining: 4,
  },
  financial: [],
  merchantBenefit: {
    committedHalalas: 9000,
    redeemedHalalas: 1800,
    unusedHalalas: 7200,
    note: 'non_cash_unused_commitment',
  },
  exceptions: [],
  treatment: null,
};
const credit = (over: Record<string, unknown> = {}) => ({
  id: 'cr1',
  organizationId: ORG,
  currency: 'SAR',
  limitHalalas: 1_000_000,
  exposureHalalas: 250_000,
  availableHalalas: 750_000,
  paymentTermsDays: 30,
  expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(),
  agreementReference: 'CREDIT-AGR-7',
  status: 'PENDING_APPROVAL',
  requestedByName: 'Maker',
  decidedByName: null,
  decisionReason: null,
  needsChecker: true,
  ...over,
});

describe('Admin commercial finance', () => {
  it('shows the finance position and states that statutory formats and tax are still to be confirmed', async () => {
    stub({
      '/commercial/overview': {
        body: {
          data: {
            cases: { AWAITING_FUNDING: 2, CLOSED: 1 },
            receivablesHalalas: 250_000,
            fundsHeldHalalas: 120_000,
            fundingUtilizedHalalas: 30_000,
            openHolds: 1,
            pendingCredit: 2,
            exceptions: 0,
            statutoryNote: 'statutory_formats_validate_ksa',
          },
          meta: {},
        },
      },
    });
    mount(<AdminCommercialPage />);
    expect(await screen.findByTestId('ov-receivables')).toHaveTextContent('2,500.00');
    expect(screen.getByTestId('ov-held')).toHaveTextContent('1,200.00');
    expect(screen.getByTestId('ac-overview')).toHaveTextContent(
      'must be confirmed with qualified advisers',
    );
  });

  it('lists cases, marks development fixtures and opens one with its blockers, funding and the non-cash benefit shown apart', async () => {
    stub({
      [`/commercial/cases/${CASE}/reconciliation`]: { body: { data: recon, meta: {} } },
      [`/commercial/cases/${CASE}`]: { body: { data: caseView(), meta: {} } },
      '/commercial/authorizations': { body: { data: [], meta: {} } },
      '/commercial/cases': { body: { data: [row], meta: {} } },
    });
    mount(<AdminCommercialPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Cases' }));
    const r = await screen.findByTestId('ac-case-CC-000001');
    expect(r).toHaveTextContent('Development fixture');
    expect(r).toHaveTextContent('Alpha Grill');
    await user.click(screen.getByTestId('ac-open-CC-000001'));
    expect(await screen.findByTestId('ac-case-detail')).toBeInTheDocument();
    expect(screen.getByTestId('ac-blocker-ACCEPTANCE_MISSING')).toBeInTheDocument();
    expect(
      screen.getByTestId('ac-blocker-UNUSED_FUNDING_TREATMENT_NOT_CONFIGURED'),
    ).toHaveTextContent('does not say what happens to unused funding');
    const rc = await screen.findByTestId('ac-recon');
    expect(rc).toHaveTextContent('non-cash');
    expect(rc).toHaveTextContent('18.00');
    // a read-only user cannot act on the case
    expect(screen.queryByTestId('ac-close')).toBeNull();
    expect(screen.queryByTestId('ac-apply-agreement')).toBeNull();
  });

  it("a Finance manager can apply the agreement's treatment, but cannot choose one", async () => {
    const calls = stub(
      {
        [`/commercial/cases/${CASE}/apply-agreement`]: { body: { data: { ok: true }, meta: {} } },
        [`/commercial/cases/${CASE}/reconciliation`]: { body: { data: recon, meta: {} } },
        [`/commercial/cases/${CASE}`]: { body: { data: caseView(), meta: {} } },
        '/commercial/authorizations': { body: { data: [], meta: {} } },
        '/commercial/cases': { body: { data: [row], meta: {} } },
      },
      FINANCE,
    );
    mount(<AdminCommercialPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Cases' }));
    await user.click(await screen.findByTestId('ac-open-CC-000001'));
    await user.click(await screen.findByTestId('ac-apply-agreement'));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/apply-agreement') && c.method === 'POST')).toBe(
        true,
      ),
    );
    // the request carries no treatment: it is always the agreement's
    expect(JSON.parse(calls.find((c) => c.url.includes('/apply-agreement'))!.body!)).toEqual({});
    expect(await screen.findByTestId('ac-banner')).toHaveTextContent('treatment was applied');
  });

  it('credit approval is a separate permission: the maker sees no approve button, the approver does', async () => {
    const routes = { '/commercial/credit': { body: { data: [credit()], meta: {} } } };
    stub(routes, ['admin.finance.read', 'admin.finance.credit.manage']);
    const first = mount(<AdminCommercialPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Credit' }));
    const row1 = await screen.findByTestId('ac-credit-CREDIT-AGR-7');
    expect(row1).toHaveTextContent('2,500.00');
    expect(row1).toHaveTextContent('7,500.00');
    expect(screen.queryByTestId('ac-credit-approve')).toBeNull();
    expect(screen.getByTestId('ac-credit-request')).toBeInTheDocument();
    first.unmount();
    vi.unstubAllGlobals();
    const calls = stub(
      { ...routes, '/commercial/credit/cr1/approve': { body: { data: { ok: true }, meta: {} } } },
      ['admin.finance.read', 'admin.finance.credit.approve'],
    );
    mount(<AdminCommercialPage />);
    await user.click(await screen.findByRole('tab', { name: 'Credit' }));
    await user.click(await screen.findByTestId('ac-credit-approve'));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/credit/cr1/approve') && c.method === 'POST')).toBe(
        true,
      ),
    );
    expect(screen.queryByTestId('ac-credit-request')).toBeNull();
  });

  it('pricing: agreements are listed with the unused-funding treatment; creating one needs the pricing permission', async () => {
    const agreements = {
      '/commercial/pricing': {
        body: {
          data: [
            {
              id: 'a1',
              name: 'Alpha agreement',
              scope: 'ORGANIZATION',
              organizationId: ORG,
              entityType: null,
              product: 'EXCLUSIVE',
              priority: 10,
              version: 2,
              reference: 'AGR-1',
              unusedTreatment: 'REFUND',
              taxBps: null,
              components: {},
            },
          ],
          meta: {},
        },
      },
    };
    stub(agreements);
    const view = mount(<AdminCommercialPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Pricing agreements' }));
    const table = await screen.findByTestId('ac-pricing');
    expect(within(table).getByText('Alpha agreement')).toBeInTheDocument();
    expect(table).toHaveTextContent('Refund');
    expect(table).toHaveTextContent('Not configured');
    expect(screen.queryByTestId('ac-pricing-create')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();
    stub(agreements, FINANCE);
    mount(<AdminCommercialPage />);
    await user.click(await screen.findByRole('tab', { name: 'Pricing agreements' }));
    expect(await screen.findByTestId('ac-pricing-create')).toBeInTheDocument();
  });

  it('renders in Arabic', async () => {
    stub({
      '/commercial/overview': {
        body: {
          data: {
            cases: {},
            receivablesHalalas: 0,
            fundsHeldHalalas: 0,
            fundingUtilizedHalalas: 0,
            openHolds: 0,
            pendingCredit: 0,
            exceptions: 0,
            statutoryNote: 'statutory_formats_validate_ksa',
          },
          meta: {},
        },
      },
    });
    mount(<AdminCommercialPage />, 'ar');
    expect(await screen.findByText('المالية التجارية')).toBeInTheDocument();
  });
});
