import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '@dealdash/types';
import { Providers } from '../app/[locale]/providers';
import { PartnerHome } from './home';
import { PartnerNetworkPage, PartnerOffersPage } from './network';
import { PartnerOrganizationPage } from './organization';
import { PartnerUsersPage } from './users';
import { PartnerCampaignsPage } from './campaigns';
import { PartnerEligibilityPage } from './eligibility';
import { PartnerWatchPage } from './workspaces';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ORG = '018f0000-0000-7000-8000-0000000000b1';
const me = (role: keyof typeof ROLE_PERMISSIONS) => ({
  id: '018f0000-0000-7000-8000-000000000101',
  userType: 'PARTNER_USER',
  displayName: 'Bank user',
  locale: 'en',
  audience: 'partner',
  mfaVerified: true,
  mfaRequired: false,
  csrfToken: 'csrf',
  activeMembership: {
    organizationId: ORG,
    organizationType: 'PARTNER',
    organizationName: { en: 'Gulf Bank', ar: 'بنك الخليج' },
    organizationStatus: 'ACTIVE',
    roleCode: role,
    branchId: null,
  },
  memberships: [],
  permissions: [...ROLE_PERMISSIONS[role]],
});
type R = { status?: number; body: unknown };
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
function stub(routes: Record<string, R>, role: keyof typeof ROLE_PERMISSIONS = 'PARTNER_ADMIN') {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me')) return json(200, { data: me(role), meta: {} });
      const path = url.split('?')[0]!;
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length))
        if (path.endsWith(key)) {
          const r = routes[key]!;
          return json(r.status ?? 200, r.body);
        }
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const modules = (off: string[] = []) =>
  ok(
    [
      'CAMPAIGNS',
      'MERCHANT_NETWORK',
      'OFFERS',
      'ELIGIBILITY',
      'CARD_PROGRAMS',
      'EMPLOYER_PROGRAMS',
      'LIVE_DEAL_BENEFITS',
      'WATCH_SPONSORSHIP',
      'LOYALTY',
      'AI_COPILOT',
    ].map((m) => ({ module: m, offered: m !== 'EMPLOYER_PROGRAMS', entitled: !off.includes(m) })),
  );
const home = ok({
  partner: {
    organizationId: ORG,
    nameEn: 'Gulf Bank',
    nameAr: 'بنك الخليج',
    partnerType: 'BANK',
    lifecycle: 'ACTIVE',
  },
  readiness: { state: 'VALIDATION_REQUIRED', missing: [] },
  modules: [
    { module: 'CAMPAIGNS', offered: true, entitled: true },
    { module: 'AI_COPILOT', offered: true, entitled: false },
  ],
  markets: [
    { code: 'SA', nameEn: 'Saudi Arabia', nameAr: 'السعودية', status: 'PILOT', open: true },
  ],
  network: { total: 12, referenced: 9, registered: 3 },
  campaigns: { total: 4, active: 2, created: 3, sponsored: 1, loyaltyRules: 1, benefits: 2 },
  performance: {
    windowDays: 30,
    asOf: new Date().toISOString(),
    values: {
      'exclusive.verified_redemptions': 42,
      'voucher.sales_value': 150000,
      'watch.qualified_views': 900,
      'loyalty.points_issued': 3000,
      'live.member_benefit_redemptions': 7,
    },
    roi: null,
  },
  funding: {
    committedHalalas: 100000,
    receivedHalalas: 60000,
    utilizedHalalas: 20000,
    remainingHalalas: 40000,
  },
  invoices: { open: 2, overdue: 1, outstandingHalalas: 50000 },
  purchaseOrders: { count: 1, totalHalalas: 500000, usedHalalas: 100000 },
  credit: { limitHalalas: 0, exposureHalalas: 0, availableHalalas: 0, active: false },
  alerts: { open: 3, latest: [] },
  integrations: [
    { id: 'i1', name: 'Bank merchant feed', status: 'ACTIVE', stale: true, errorCount: 0 },
  ],
  tasks: { open: 5, latest: [] },
});

describe('Partner portal (Stage 7)', () => {
  it('home: lifecycle, markets, network, verified performance, funding, invoices and integration health; ROI is never shown', async () => {
    stub({ [`/partners/${ORG}/home`]: home, [`/partners/${ORG}/modules`]: modules() });
    render(
      <Providers locale="en">
        <PartnerHome />
      </Providers>,
    );
    expect(await screen.findByTestId('pt-home-lifecycle')).toHaveTextContent('Active');
    expect(screen.getByTestId('pt-kpi-markets')).toHaveTextContent('SA');
    expect(screen.getByTestId('pt-kpi-network')).toHaveTextContent('12');
    expect(screen.getByTestId('pt-home-perf')).toHaveTextContent('42');
    expect(screen.getByText(/does not hold your revenue data/)).toBeInTheDocument();
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByTestId('pt-home-modules')).toHaveTextContent('Not in your contract');
  });

  it('merchant network: referenced vs registered states and provenance; analysts cannot add merchants', async () => {
    stub(
      {
        [`/partners/${ORG}/modules`]: modules(),
        [`/partners/${ORG}/network`]: ok({
          total: 2,
          markets: ['SA'],
          items: [
            {
              id: 'm1',
              nameEn: 'Corner Bakery',
              nameAr: null,
              brand: null,
              country: 'SA',
              registration: 'REFERENCED',
              state: 'REFERENCED',
              capabilities: {},
              branches: 1,
              offers: 0,
              externalId: 'GB-1',
              importMethod: 'MANUAL',
              lastSyncAt: null,
              openConflicts: 0,
              possibleDuplicates: 1,
            },
            {
              id: 'm2',
              nameEn: 'Alpha Grill',
              nameAr: null,
              brand: null,
              country: 'SA',
              registration: 'REGISTERED',
              state: 'REGISTERED_ACTIVE',
              capabilities: {},
              branches: 2,
              offers: 0,
              externalId: 'REG-1',
              importMethod: 'MANUAL',
              lastSyncAt: null,
              openConflicts: 0,
              possibleDuplicates: 0,
            },
          ],
        }),
      },
      'PARTNER_ANALYST',
    );
    render(
      <Providers locale="en">
        <PartnerNetworkPage />
      </Providers>,
    );
    const row = await screen.findByTestId('pt-net-m1');
    expect(row).toHaveTextContent('Referenced (network)');
    expect(screen.getByTestId('pt-net-m2')).toHaveTextContent('Registered and active');
    expect(screen.queryByRole('tab', { name: 'Add a merchant' })).toBeNull();
  });

  it('a module the contract does not include shows the "not in your contract" state', async () => {
    stub({ [`/partners/${ORG}/modules`]: modules(['WATCH_SPONSORSHIP']) });
    render(
      <Providers locale="en">
        <PartnerWatchPage />
      </Providers>,
    );
    expect(await screen.findByTestId('pt-not-entitled')).toHaveTextContent(
      'not included in your contract',
    );
  });

  it('organization: the live checklist and submission for review', async () => {
    const calls = stub({
      [`/partners/${ORG}/modules`]: modules(),
      [`/partners/${ORG}/profile`]: ok({
        organizationId: ORG,
        partnerType: 'BANK',
        lifecycle: 'DRAFT',
        legalName: 'Gulf Bank',
        registrationNumber: null,
        taxNumber: null,
        website: null,
        parentGroup: null,
        description: null,
        requestedMarkets: ['SA'],
        contacts: {},
        signatory: null,
        lifecycleReason: null,
      }),
      [`/partners/${ORG}/readiness`]: ok({
        lifecycle: 'DRAFT',
        state: 'NOT_READY',
        items: [
          { check: 'SIGNATORY', state: 'MISSING', detail: 'Authorised signatory' },
          { check: 'MARKET_VALIDATIONS', state: 'VALIDATION_REQUIRED', detail: '3 open' },
        ],
        nextSteps: ['UNDER_REVIEW'],
      }),
      [`/partners/${ORG}/markets`]: ok([]),
      [`/partners/${ORG}/history`]: ok([]),
      [`/partners/${ORG}/onboarding/submit`]: {
        status: 409,
        body: {
          errors: [{ code: 'PARTNER_NOT_READY', message: 'Not ready: SIGNATORY' }],
          meta: {},
        },
      },
    });
    render(
      <Providers locale="en">
        <PartnerOrganizationPage />
      </Providers>,
    );
    expect(await screen.findByTestId('pt-check-SIGNATORY')).toHaveTextContent('Missing');
    expect(screen.getByTestId('pt-check-MARKET_VALIDATIONS')).toHaveTextContent(
      'Validation required',
    );
    await userEvent.click(screen.getByTestId('pt-submit-onboarding'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/onboarding/submit'))).toBe(
        true,
      ),
    );
    expect(await screen.findByTestId('pt-banner')).toHaveTextContent('Onboarding is not complete');
  });

  it('users: partner roles only; the delegation refusal is shown', async () => {
    stub({
      [`/partners/${ORG}/modules`]: modules(),
      [`/partners/${ORG}/users`]: ok({ users: [], invitations: [] }),
      [`/partners/${ORG}/markets`]: ok([
        { code: 'SA', nameEn: 'Saudi Arabia', nameAr: 'السعودية' },
      ]),
      [`/partners/${ORG}/users/invitations`]: {
        status: 403,
        body: { errors: [{ code: 'DELEGATION_EXCEEDED', message: 'x' }], meta: {} },
      },
    });
    render(
      <Providers locale="en">
        <PartnerUsersPage />
      </Providers>,
    );
    const form = await screen.findByTestId('pt-invite-form');
    const role = within(form).getByLabelText('Role') as HTMLSelectElement;
    expect([...role.options].every((o) => !o.textContent?.includes('DealDash'))).toBe(true);
    expect([...role.options].map((o) => o.value)).toContain('PARTNER_INTEGRATION_MANAGER');
    await userEvent.type(within(form).getByLabelText('Name'), 'Ana');
    await userEvent.type(within(form).getByLabelText('E-mail'), 'ana@bank.test');
    await userEvent.click(screen.getByTestId('pt-invite-send'));
    expect(await screen.findByTestId('pt-banner')).toHaveTextContent('cannot grant more access');
  });

  it('users page is not available without user management (permission denied)', async () => {
    stub({ [`/partners/${ORG}/modules`]: modules() }, 'PARTNER_ANALYST');
    render(
      <Providers locale="en">
        <PartnerUsersPage />
      </Providers>,
    );
    await waitFor(() => expect(screen.queryByTestId('pt-invite-form')).toBeNull());
  });

  it('campaigns: the portfolio shows the partner role; benefits are listed separately', async () => {
    stub({
      [`/partners/${ORG}/modules`]: modules(),
      [`/partners/${ORG}/campaigns`]: ok({
        items: [
          {
            caseId: 'c1',
            reference: 'CC-1',
            product: 'EXCLUSIVE',
            subjectId: 'h1',
            titleEn: 'Bank night',
            titleAr: 'ليلة البنك',
            status: 'PENDING_REVIEW',
            commercialStatus: 'AWAITING_ACCEPTANCE',
            role: 'CREATOR',
            merchantNameEn: 'Alpha Grill',
            merchantNameAr: 'ألفا',
            market: 'SA',
            maxCashHalalas: 5000,
          },
        ],
        benefits: 0,
        markets: ['SA'],
      }),
    });
    render(
      <Providers locale="en">
        <PartnerCampaignsPage />
      </Providers>,
    );
    const row = await screen.findByTestId('pt-camp-h1');
    expect(row).toHaveTextContent('Created by you');
    expect(row).toHaveTextContent('Alpha Grill');
    expect(screen.getByTestId('pt-camp-new')).toBeInTheDocument();
  });

  it('eligibility: the rule tree is tested by the shared engine (the screen never decides)', async () => {
    const calls = stub({
      [`/partners/${ORG}/modules`]: modules(),
      [`/partners/${ORG}/eligibility/options`]: ok({
        attributes: ['CARD', 'CARD_TIER', 'GEOGRAPHY'],
        self: { id: ORG, nameEn: 'Gulf Bank', partnerType: 'BANK' },
        cardPrograms: [
          { code: 'P', nameEn: 'Platinum', productCode: 'P', tier: 'platinum', scheme: 'visa' },
        ],
        employerPrograms: [],
        cities: ['Riyadh'],
        markets: ['SA'],
      }),
      [`/partners/${ORG}/eligibility/rules`]: ok([]),
      [`/partners/${ORG}/eligibility/test`]: ok({
        result: 'LOCKED_UNLOCKABLE',
        unlockAction: 'ADD_BANK_BENEFIT',
      }),
    });
    render(
      <Providers locale="en">
        <PartnerEligibilityPage />
      </Providers>,
    );
    await screen.findByTestId('pt-rule-builder');
    await userEvent.click(screen.getByTestId('pt-rule-test'));
    expect(await screen.findByTestId('pt-rule-result')).toHaveTextContent('Could qualify');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/eligibility/test'))).toBe(
      true,
    );
  });

  it('FD-S7-4 offers: a Live Deal is created with its publication authority and waits for DealDash confirmation', async () => {
    const calls = stub({
      [`/partners/${ORG}/modules`]: modules(),
      [`/partners/${ORG}/network`]: ok({
        items: [{ id: 'm1', nameEn: 'Corner Bakery', nameAr: null, externalId: 'GB-M-1', state: 'REFERENCED', capabilities: {} }],
        page: 1,
        total: 1,
      }),
      [`/partners/${ORG}/offers`]: ok([
        {
          id: 'o1',
          merchant: 'Corner Bakery',
          merchantAr: null,
          country: 'SA',
          titleEn: 'Card holders save',
          titleAr: null,
          benefitEn: '10% off',
          status: 'ACTIVE',
          validFrom: new Date().toISOString(),
          validUntil: null,
          publicationConfirmed: false,
          publication: 'AWAITING_CONFIRMATION',
          publicationRef: 'GB-PROG-1',
          sourceRecordId: 'OFF-1',
          merchantSourceId: 'GB-M-1',
          importMethod: 'MANUAL',
          lastSyncAt: null,
        },
      ]),
    });
    render(
      <Providers locale="en">
        <PartnerOffersPage />
      </Providers>,
    );
    expect(await screen.findByTestId('pt-offer-pub-OFF-1')).toHaveTextContent('Awaiting DealDash confirmation');
    expect(screen.getByTestId('pt-offer-table')).toHaveTextContent('GB-PROG-1');
    const form = await screen.findByTestId('pt-offer-create');
    await waitFor(() => expect(within(form).getByLabelText('Merchant')).toHaveValue('GB-M-1'));
    await userEvent.type(within(form).getByLabelText('Publication authority (agreement reference)'), 'GB-PROG-2');
    await userEvent.type(within(form).getByLabelText('Title (English)'), 'Dine for less');
    await userEvent.type(within(form).getByLabelText('Benefit (English)'), '15% off');
    await userEvent.click(screen.getByTestId('pt-offer-submit'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/offers'))).toBe(true));
    const sent = JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith('/offers'))!.body!);
    expect(sent).toMatchObject({ merchantSourceId: 'GB-M-1', publicationRef: 'GB-PROG-2', titleEn: 'Dine for less' });
  });

  it('FD-S7-4 offers: an analyst sees the list but cannot add a Live Deal', async () => {
    const row = {
      id: 'o2',
      merchant: 'Corner Bakery',
      merchantAr: null,
      country: 'SA',
      titleEn: 'Published deal',
      titleAr: null,
      benefitEn: '5% off',
      status: 'ACTIVE',
      validFrom: new Date().toISOString(),
      validUntil: null,
      publicationConfirmed: true,
      publication: 'PUBLISHABLE',
      publicationRef: 'GB-PROG-1',
      sourceRecordId: 'OFF-2',
      merchantSourceId: 'GB-M-1',
      importMethod: 'BULK',
      lastSyncAt: null,
    };
    stub({ [`/partners/${ORG}/modules`]: modules(), [`/partners/${ORG}/offers`]: ok([row]) }, 'PARTNER_ANALYST');
    render(
      <Providers locale="en">
        <PartnerOffersPage />
      </Providers>,
    );
    expect(await screen.findByTestId('pt-offer-pub-OFF-2')).toHaveTextContent('Published');
    expect(screen.queryByTestId('pt-offer-create')).toBeNull();
  });

  it('FD-S7-1 Watch & Earn: budgets the partner owns, with fund and send-for-review actions by permission', async () => {
    const owned = (status: string, funded: number) => ({
      id: `w-${status}-${funded}`,
      titleEn: `Owned ${status} ${funded}`,
      titleAr: 'حملة',
      merchantNameEn: 'Alpha Grill',
      merchantNameAr: 'ألفا',
      status,
      paidViews: 100,
      qualifiedViews: 0,
      requiredBudgetHalalas: 10000,
      fundedHalalas: funded,
      spentHalalas: 0,
    });
    const calls = stub(
      {
        [`/partners/${ORG}/modules`]: modules(),
        [`/partners/${ORG}/watch`]: ok([]),
        [`/partners/${ORG}/watch/owned`]: ok([owned('DRAFT', 0)]),
        [`/partners/${ORG}/watch/owned/w-DRAFT-0/fund`]: ok({}),
      },
      'PARTNER_FINANCE_MANAGER',
    );
    render(
      <Providers locale="en">
        <PartnerWatchPage />
      </Providers>,
    );
    const table = await screen.findByTestId('pt-watch-owned');
    expect(table).toHaveTextContent('Owned DRAFT 0');
    expect(screen.queryByTestId('pt-watch-own-form')).toBeNull(); // finance funds, it does not create campaigns
    await userEvent.click(within(table).getByRole('button', { name: 'Fund budget' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/watch/owned/w-DRAFT-0/fund'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/fund'))!.body!)).toEqual({ amountHalalas: 10000 });
  });

  it('renders right-to-left in Arabic with Western digits', async () => {
    stub({ [`/partners/${ORG}/home`]: home, [`/partners/${ORG}/modules`]: modules() });
    render(
      <Providers locale="ar">
        <PartnerHome />
      </Providers>,
    );
    expect(await screen.findByTestId('pt-home-lifecycle')).toHaveTextContent('نشط');
    expect(screen.getByText('نظرة عامة على الشريك', { selector: 'h1' })).toBeInTheDocument();
    expect(
      within(screen.getByTestId('pt-home')).getByTestId('pt-kpi-network').textContent,
    ).not.toMatch(/[٠-٩]/);
  });
});
