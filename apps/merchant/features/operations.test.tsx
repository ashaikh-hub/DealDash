import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { MerchantLoyaltyPage } from './loyalty';
import { MerchantOperationsPage } from './operations';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/operations',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const CASE = '018f0000-0000-7000-8000-0000000000c1';
const RULE = '018f0000-0000-7000-8000-0000000000e1';
const OWNER = ['merchant.deals.read', 'merchant.deals.manage', 'merchant.disputes.manage', 'merchant.activity.read', 'merchant.loyalty.manage'];
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
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const call: Call = { url, method: init?.method ?? 'GET', body: init?.body as string | undefined };
      calls.push(call);
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms), meta: {} });
      if (url.startsWith('http://upload.test/')) return new Response('', { status: 200 });
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
const mount = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') => render(<Providers locale={locale}>{ui}</Providers>);

const caseRow = (over: Record<string, unknown> = {}) => ({
  id: CASE,
  reference: 'DC-AB12CD34',
  type: 'SETTLEMENT_MISMATCH',
  organizationId: ORG,
  title: 'Payout lower than expected',
  description: null,
  priority: 'HIGH',
  status: 'OPEN',
  slaDueAt: new Date(Date.now() + 86_400_000).toISOString(),
  overdue: false,
  resolution: null,
  resolvedAt: null,
  financialAdjustmentId: null,
  notes: [{ id: 'n1', visibility: 'SHARED', body: 'We are looking into it', fromBusiness: false, createdAt: new Date().toISOString() }],
  attachments: [],
  ...over,
});
const rule = (over: Record<string, unknown> = {}) => ({
  id: RULE,
  name: 'Coffee bonus',
  status: 'DRAFT',
  eventType: 'VOUCHER_REDEMPTION',
  kind: 'BONUS',
  productScope: null,
  organizationId: ORG,
  basePoints: 0,
  bonusPoints: 20,
  pointsPer100Halalas: 0,
  dailyCap: null,
  monthlyCap: null,
  customerCap: null,
  fundingSource: 'MERCHANT',
  fundingOrganizationId: ORG,
  fundingHalalasPerPoint: 4,
  maxAllocationPoints: 500,
  allocatedPoints: 0,
  reversedPoints: 0,
  remainingAllocation: 500,
  commercialStatus: 'AWAITING_ACCEPTANCE',
  createdAt: new Date().toISOString(),
  ...over,
});

describe('Merchant operations', () => {
  it('shows only this business’s tasks, as sentences: changes requested, a rule, a case with a deadline', async () => {
    stub({
      [`/v1/orgs/${ORG}/inbox`]: {
        body: {
          data: [
            { kind: 'CHANGES_REQUESTED', title: 'x', subject: 'Dinner for two', detail: 'EXCLUSIVE', priority: 'HIGH', organizationId: ORG, entityType: 'EXCLUSIVE', entityId: '018f0000-0000-7000-8000-0000000000d1', dueAt: null, createdAt: new Date().toISOString(), requiredPermission: 'merchant.deals.manage' },
            { kind: 'DISPUTE', title: 'x', subject: 'DC-AB12CD34: Payout lower', detail: 'SLA_MISSED', priority: 'HIGH', organizationId: ORG, entityType: 'DisputeCase', entityId: CASE, dueAt: new Date().toISOString(), createdAt: new Date().toISOString(), requiredPermission: 'merchant.disputes.manage' },
          ],
          meta: {},
        },
      },
    });
    mount(<MerchantOperationsPage />);
    const changes = await screen.findByTestId('op-task-CHANGES_REQUESTED');
    expect(changes).toHaveTextContent('DealDash asked for changes: Dinner for two');
    expect(within(changes).getByRole('link')).toHaveAttribute('href', expect.stringContaining('/deals/hot/018f0000'));
    expect(screen.getByTestId('op-task-DISPUTE')).toHaveTextContent('Deadline passed');
    expect(screen.queryByRole('tab', { name: 'Offer conflicts' })).toBeNull();
  });

  it('a member without case or activity rights sees the inbox only', async () => {
    stub({ [`/v1/orgs/${ORG}/inbox`]: { body: { data: [], meta: {} } } }, ['merchant.deals.read']);
    mount(<MerchantOperationsPage />);
    await screen.findByText('Nothing needs your attention.');
    expect(screen.queryByRole('tab', { name: 'Cases' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull();
  });

  it('opens a case, writes only shared notes, and attaches evidence to its own case', async () => {
    const calls = stub({
      [`/v1/orgs/${ORG}/disputes/${CASE}/attachments/intent`]: { body: { data: { fileId: '018f0000-0000-7000-8000-0000000000f2', uploadUrl: 'http://upload.test/put', headers: {} }, meta: {} } },
      [`/v1/orgs/${ORG}/disputes/${CASE}/attachments`]: { status: 201, body: { data: caseRow(), meta: {} } },
      [`/v1/orgs/${ORG}/disputes/${CASE}/notes`]: { status: 201, body: { data: caseRow(), meta: {} } },
      [`/v1/orgs/${ORG}/disputes/${CASE}`]: { body: { data: caseRow(), meta: {} } },
      [`/v1/orgs/${ORG}/disputes`]: (c) => (c.method === 'POST' ? { status: 201, body: { data: caseRow(), meta: {} } } : { body: { data: [caseRow()], meta: {} } }),
      [`/v1/orgs/${ORG}/inbox`]: { body: { data: [], meta: {} } },
    });
    mount(<MerchantOperationsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Cases' }));
    await user.click(await screen.findByTestId('op-case-new'));
    await user.type(screen.getByLabelText('Short title'), 'Payout lower than expected');
    await user.click(screen.getByTestId('op-case-submit'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith(`/orgs/${ORG}/disputes`))).toBe(true));
    const created = JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith(`/orgs/${ORG}/disputes`))!.body!);
    expect(created).toMatchObject({ type: 'OTHER', title: 'Payout lower than expected', priority: 'NORMAL' });
    expect(created).not.toHaveProperty('targetOrganizationId');
    const detail = await screen.findByTestId('op-case-detail');
    // a business never sees the internal / shared choice and never the DealDash owner
    expect(within(detail).queryByLabelText('Who can read it')).toBeNull();
    expect(within(detail).queryByTestId('op-case-assign')).toBeNull();
    expect(within(detail).queryByTestId('op-case-resolve')).toBeNull();
    await user.type(within(detail).getByLabelText('Your note'), 'Thanks');
    await user.click(within(detail).getByTestId('op-note-add'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/notes'))).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/notes'))!.body!)).toEqual({ body: 'Thanks' });
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'proof.png', { type: 'image/png' });
    await user.upload(document.getElementById('op-ev-file') as HTMLInputElement, file);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith(`/disputes/${CASE}/attachments`))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith(`/disputes/${CASE}/attachments`))!.body!)).not.toHaveProperty('visibility');
  });

  it('a closed case offers no more notes or files', async () => {
    stub({
      [`/v1/orgs/${ORG}/disputes/${CASE}`]: { body: { data: caseRow({ status: 'RESOLVED', resolution: 'Explained' }), meta: {} } },
      [`/v1/orgs/${ORG}/disputes`]: { body: { data: [caseRow({ status: 'RESOLVED', resolution: 'Explained' })], meta: {} } },
      [`/v1/orgs/${ORG}/inbox`]: { body: { data: [], meta: {} } },
    });
    mount(<MerchantOperationsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Cases' }));
    await user.click(await screen.findByTestId('op-case-open-DC-AB12CD34'));
    const detail = await screen.findByTestId('op-case-detail');
    expect(detail).toHaveTextContent('This case is closed.');
    expect(within(detail).queryByTestId('op-note-add')).toBeNull();
    expect(document.getElementById('op-ev-file')).toBeNull();
  });

  it('shows the business’s own activity without DealDash staff identities', async () => {
    stub({
      [`/v1/orgs/${ORG}/activity`]: {
        body: {
          data: { items: [{ id: 'a1', at: new Date().toISOString(), summary: 'Dispute opened', action: 'DISPUTE_OPENED', entityType: 'DisputeCase', entityId: CASE, reason: null, actor: { by: 'DEALDASH' } }], next: null },
          meta: {},
        },
      },
      [`/v1/orgs/${ORG}/inbox`]: { body: { data: [], meta: {} } },
    });
    mount(<MerchantOperationsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Activity' }));
    const row = await screen.findByTestId('op-activity-row');
    expect(row).toHaveTextContent('A case was opened');
    expect(row).toHaveTextContent('DealDash');
  });

  it('renders in Arabic', async () => {
    stub({ [`/v1/orgs/${ORG}/inbox`]: { body: { data: [{ kind: 'LOYALTY_RULE', title: 'x', subject: 'Coffee bonus', detail: 'DRAFT', priority: 'LOW', organizationId: ORG, entityType: 'LoyaltyRule', entityId: RULE, dueAt: null, createdAt: new Date().toISOString(), requiredPermission: 'merchant.loyalty.manage' }], meta: {} } } });
    mount(<MerchantOperationsPage />, 'ar');
    const row = await screen.findByTestId('op-task-LOYALTY_RULE');
    expect(row).toHaveTextContent('قاعدة ولاء: Coffee bonus');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('العمليات');
  });
});

describe('Merchant loyalty', () => {
  it('a merchant can name itself or the campaign as the payer, never DealDash or a bank, and pays its own rule', async () => {
    const calls = stub({
      [`/v1/orgs/${ORG}/loyalty/rules`]: (c) => (c.method === 'POST' ? { status: 201, body: { data: rule(), meta: {} } } : { body: { data: [], meta: {} } }),
    });
    mount(<MerchantLoyaltyPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('lo-new'));
    const form = await screen.findByTestId('lo-form');
    const funding = within(form).getByLabelText('Who pays for the points') as HTMLSelectElement;
    expect([...funding.options].map((o) => o.value)).toEqual(['MERCHANT', 'CAMPAIGN']);
    // the funder is the business itself: there is no funder field to fill in
    expect(within(form).queryByLabelText('Funder (business id)')).toBeNull();
    await user.type(within(form).getByLabelText('Rule name'), 'Coffee bonus');
    await user.type(within(form).getByLabelText('The funder pays per point (SAR)'), '0.04');
    await user.click(screen.getByTestId('lo-create'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toMatchObject({ fundingSource: 'MERCHANT', fundingOrganizationId: ORG, fundingHalalasPerPoint: 4 });
  });

  it('a draft can be sent for approval but a business cannot approve its own rule', async () => {
    const calls = stub({
      [`/v1/orgs/${ORG}/loyalty/rules/${RULE}/submit`]: { body: { data: rule({ status: 'PENDING_APPROVAL' }), meta: {} } },
      [`/v1/orgs/${ORG}/loyalty/rules`]: { body: { data: [rule({ status: 'PENDING_APPROVAL' }), rule({ id: 'r2', name: 'Draft rule', status: 'DRAFT' })], meta: {} } },
    });
    mount(<MerchantLoyaltyPage />);
    const user = userEvent.setup();
    await screen.findByTestId('lo-rule-Draft rule');
    expect(screen.queryByTestId('lo-approve-Coffee bonus')).toBeNull();
    await user.click(screen.getByTestId('lo-submit-Draft rule'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/r2/submit'))).toBeTruthy());
    expect(screen.getByTestId('lo-rule-Coffee bonus')).toHaveTextContent('Waiting for approval');
  });

  it('shows a refusal in plain language when the agreement does not allow loyalty yet', async () => {
    stub({
      [`/v1/orgs/${ORG}/loyalty/rules`]: (c) =>
        c.method === 'POST' ? { status: 403, body: { errors: [{ code: 'ENTITLEMENT_REQUIRED', message: 'x' }], meta: {} } } : { body: { data: [], meta: {} } },
    });
    mount(<MerchantLoyaltyPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('lo-new'));
    await user.type(await screen.findByLabelText('Rule name'), 'Coffee bonus');
    await user.type(screen.getByLabelText('The funder pays per point (SAR)'), '0.04');
    await user.click(screen.getByTestId('lo-create'));
    expect(await screen.findByText('Your agreement with DealDash does not include this product yet.')).toBeInTheDocument();
  });
});
