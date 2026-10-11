import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { AdminLoyaltyPage } from './loyalty';
import { AdminOperationsPage } from './operations';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/operations',
  useSearchParams: () => new URLSearchParams(),
}));

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const CASE = '018f0000-0000-7000-8000-0000000000c1';
const RULE = '018f0000-0000-7000-8000-0000000000e1';
const FLAG = '018f0000-0000-7000-8000-0000000000f1';
const OPS = [
  'admin.disputes.read',
  'admin.disputes.manage',
  'admin.conflicts.manage',
  'admin.campaigns.review',
  'admin.platform.read',
];
const LOYALTY = ['admin.loyalty.read', 'admin.loyalty.manage', 'admin.loyalty.approve'];
const me = (permissions: string[], locale: 'en' | 'ar' = 'en') => ({
  id: '018f0000-0000-7000-8000-000000000009',
  userType: 'ADMIN_USER',
  displayName: 'Admin',
  locale,
  audience: 'admin',
  mfaVerified: true,
  mfaRequired: true,
  csrfToken: 'csrf',
  activeMembership: {
    organizationId: 'dd',
    organizationType: 'DEALDASH',
    organizationName: { en: 'DealDash', ar: 'ديل داش' },
    organizationStatus: 'ACTIVE',
    roleCode: 'DEALDASH_SUPER_ADMIN',
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
function stub(routes: Record<string, R>, perms: string[] = OPS, locale: 'en' | 'ar' = 'en') {
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
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms, locale), meta: {} });
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
const mount = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') =>
  render(<Providers locale={locale}>{ui}</Providers>);

const task = (over: Record<string, unknown> = {}) => ({
  kind: 'CAMPAIGN_REVIEW',
  title: 'EXCLUSIVE waiting for review: Dinner',
  subject: 'Dinner for two',
  detail: 'EXCLUSIVE',
  priority: 'NORMAL',
  organizationId: ORG,
  entityType: 'EXCLUSIVE',
  entityId: '018f0000-0000-7000-8000-0000000000d1',
  dueAt: null,
  createdAt: new Date().toISOString(),
  requiredPermission: 'admin.campaigns.review',
  ...over,
});
const caseRow = (over: Record<string, unknown> = {}) => ({
  id: CASE,
  reference: 'DC-AB12CD34',
  type: 'SETTLEMENT_MISMATCH',
  product: null,
  organizationId: ORG,
  title: 'Payout lower than expected',
  description: 'The last payout is 40 SAR lower.',
  priority: 'HIGH',
  status: 'OPEN',
  slaDueAt: new Date(Date.now() + 86_400_000).toISOString(),
  overdue: false,
  resolution: null,
  resolvedAt: null,
  financialAdjustmentId: null,
  notes: [
    {
      id: 'n1',
      visibility: 'INTERNAL',
      body: 'Check the ledger',
      fromBusiness: false,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'n2',
      visibility: 'SHARED',
      body: 'We are looking into it',
      fromBusiness: false,
      createdAt: new Date().toISOString(),
    },
  ],
  attachments: [
    {
      id: 'a1',
      fileId: 'f1',
      type: 'SCREENSHOT',
      label: 'Payout screen',
      fileName: 'p.png',
      mimeType: 'image/png',
      sizeBytes: 100,
      visibility: 'SHARED',
      fromBusiness: true,
      uploadedAt: new Date().toISOString(),
    },
  ],
  ...over,
});
const rule = (over: Record<string, unknown> = {}) => ({
  id: RULE,
  name: 'Bank bonus',
  status: 'PENDING_APPROVAL',
  eventType: 'EXCLUSIVE_REDEMPTION',
  kind: 'BONUS',
  productScope: null,
  campaignId: null,
  organizationId: null,
  basePoints: 0,
  bonusPoints: 25,
  multiplierBps: 10000,
  pointsPer100Halalas: 0,
  dailyCap: null,
  monthlyCap: null,
  customerCap: null,
  eligibilityKind: null,
  fundingSource: 'BANK',
  fundingOrganizationId: ORG,
  fundingHalalasPerPoint: 5,
  expiryDays: null,
  maxAllocationPoints: 1000,
  allocatedPoints: 250,
  reversedPoints: 0,
  remainingAllocation: 750,
  effectiveFrom: new Date().toISOString(),
  effectiveUntil: null,
  commercialStatus: 'ACCEPTED',
  createdAt: new Date().toISOString(),
  ...over,
});

describe('Admin operations: inbox', () => {
  it('shows tasks as translated sentences with priority, a deadline-passed flag, and a link to the review page', async () => {
    stub({
      '/v1/admin/inbox': {
        body: {
          data: [
            task(),
            task({
              kind: 'DISPUTE',
              title: 'DC-1: x',
              subject: 'DC-AB12CD34: Payout lower',
              detail: 'SLA_MISSED',
              priority: 'CRITICAL',
              entityType: 'DisputeCase',
              entityId: CASE,
              requiredPermission: 'admin.disputes.read',
            }),
            task({
              kind: 'LOYALTY_APPROVAL',
              subject: 'Bank bonus',
              entityType: 'LoyaltyRule',
              requiredPermission: 'admin.loyalty.approve',
            }),
          ],
          meta: {},
        },
      },
    });
    mount(<AdminOperationsPage />);
    const review = await screen.findByTestId('op-task-CAMPAIGN_REVIEW');
    expect(review).toHaveTextContent('Campaign waiting for review: Dinner for two');
    expect(within(review).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('/hot-deals/018f0000'),
    );
    const late = screen.getByTestId('op-task-DISPUTE');
    expect(late).toHaveTextContent('Deadline passed');
    expect(late).toHaveTextContent('Critical');
    expect(screen.getByTestId('op-task-LOYALTY_APPROVAL')).toHaveTextContent(
      'Loyalty rule waiting for approval: Bank bonus',
    );
    expect(screen.getByTestId('op-inbox')).toHaveTextContent('cannot be hidden');
  });

  it('is calm when nothing needs attention', async () => {
    stub({ '/v1/admin/inbox': { body: { data: [], meta: {} } } });
    mount(<AdminOperationsPage />);
    expect(await screen.findByText('Nothing needs your attention.')).toBeInTheDocument();
  });

  it('renders in Arabic, right-to-left, with Arabic task text (the document direction itself is checked in the browser run)', async () => {
    stub(
      {
        '/v1/admin/inbox': {
          body: {
            data: [task({ kind: 'LOYALTY_APPROVAL', subject: 'Bank bonus', priority: 'HIGH' })],
            meta: {},
          },
        },
      },
      OPS,
      'ar',
    );
    mount(<AdminOperationsPage />, 'ar');
    const row = await screen.findByTestId('op-task-LOYALTY_APPROVAL');
    expect(row).toHaveTextContent('قاعدة ولاء بانتظار الاعتماد: Bank bonus');
    expect(row).toHaveTextContent('مرتفعة');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('العمليات');
  });

  it('shows only the tabs the person can use', async () => {
    stub({ '/v1/admin/inbox': { body: { data: [], meta: {} } } }, ['admin.campaigns.review']);
    mount(<AdminOperationsPage />);
    await screen.findByText('Nothing needs your attention.');
    expect(screen.getByRole('tab', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Cases' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Offer conflicts' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Activity' })).toBeNull();
  });
});

describe('Admin operations: cases and evidence', () => {
  it('lists cases, shows internal notes to DealDash only with a label, and attaches evidence through the file flow', async () => {
    const calls = stub({
      [`/v1/admin/disputes/${CASE}/attachments/intent`]: {
        body: {
          data: {
            fileId: '018f0000-0000-7000-8000-0000000000f2',
            uploadUrl: 'http://upload.test/put',
            headers: { 'content-type': 'image/png' },
          },
          meta: {},
        },
      },
      [`/v1/admin/disputes/${CASE}/attachments`]: {
        status: 201,
        body: { data: caseRow(), meta: {} },
      },
      [`/v1/admin/disputes/${CASE}`]: { body: { data: caseRow(), meta: {} } },
      '/v1/admin/disputes': { body: { data: [caseRow()], meta: {} } },
      '/v1/admin/inbox': { body: { data: [], meta: {} } },
    });
    mount(<AdminOperationsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Cases' }));
    const r = await screen.findByTestId('op-case-DC-AB12CD34');
    expect(r).toHaveTextContent('A payout does not match');
    await user.click(screen.getByTestId('op-case-open-DC-AB12CD34'));
    const detail = await screen.findByTestId('op-case-detail');
    const notes = within(detail).getAllByTestId('op-note');
    expect(notes).toHaveLength(2);
    expect(notes[0]).toHaveTextContent('DealDash only');
    expect(within(detail).getByTestId('op-evidence')).toHaveTextContent('Payout screen');
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'proof.png', { type: 'image/png' });
    await user.upload(document.getElementById('op-ev-file') as HTMLInputElement, file);
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith(`/disputes/${CASE}/attachments`)),
      ).toBe(true),
    );
    const attach = calls.find(
      (c) => c.method === 'POST' && c.url.endsWith(`/disputes/${CASE}/attachments`),
    )!;
    expect(JSON.parse(attach.body!)).toMatchObject({
      fileId: '018f0000-0000-7000-8000-0000000000f2',
      type: 'DOCUMENT',
      visibility: 'SHARED',
    });
    expect(calls.some((c) => c.method === 'PUT' && c.url === 'http://upload.test/put')).toBe(true);
    expect(await screen.findByText('The file was attached.')).toBeInTheDocument();
  });

  it('takes the case, adds a shared note, and closes it with a recorded resolution', async () => {
    const calls = stub({
      [`/v1/admin/disputes/${CASE}/assign`]: {
        body: { data: caseRow({ status: 'IN_REVIEW' }), meta: {} },
      },
      [`/v1/admin/disputes/${CASE}/notes`]: { status: 201, body: { data: caseRow(), meta: {} } },
      [`/v1/admin/disputes/${CASE}/resolve`]: {
        body: { data: caseRow({ status: 'RESOLVED', resolution: 'Explained' }), meta: {} },
      },
      [`/v1/admin/disputes/${CASE}`]: { body: { data: caseRow(), meta: {} } },
      '/v1/admin/disputes': { body: { data: [caseRow()], meta: {} } },
      '/v1/admin/inbox': { body: { data: [], meta: {} } },
    });
    mount(<AdminOperationsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Cases' }));
    await user.click(await screen.findByTestId('op-case-open-DC-AB12CD34'));
    await screen.findByTestId('op-case-detail');
    await user.click(screen.getByTestId('op-case-assign'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/assign'))).toBeTruthy());
    await user.type(screen.getByLabelText('Your note'), 'Sent the statement');
    await user.click(screen.getByTestId('op-note-add'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/notes'))).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/notes'))!.body!)).toEqual({
      body: 'Sent the statement',
      visibility: 'SHARED',
    });
    expect(screen.getByTestId('op-case-resolve')).toBeDisabled();
    await user.type(screen.getByLabelText('What was decided and why'), 'Fee rule explained');
    await user.click(screen.getByTestId('op-case-resolve'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/resolve'))).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/resolve'))!.body!)).toMatchObject({
      outcome: 'RESOLVED',
      resolution: 'Fee rule explained',
      financialAdjustmentId: null,
    });
  });

  it('a reader without manage rights sees the case but no controls', async () => {
    stub(
      {
        [`/v1/admin/disputes/${CASE}`]: { body: { data: caseRow(), meta: {} } },
        '/v1/admin/disputes': { body: { data: [caseRow()], meta: {} } },
        '/v1/admin/inbox': { body: { data: [], meta: {} } },
      },
      ['admin.disputes.read'],
    );
    mount(<AdminOperationsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Cases' }));
    await user.click(await screen.findByTestId('op-case-open-DC-AB12CD34'));
    await screen.findByTestId('op-case-detail');
    expect(screen.queryByTestId('op-case-new')).toBeNull();
    expect(screen.queryByTestId('op-note-add')).toBeNull();
    expect(screen.queryByTestId('op-case-resolve')).toBeNull();
    expect(document.getElementById('op-ev-file')).toBeNull();
  });
});

describe('Admin operations: offer conflicts', () => {
  const flag = (over: Record<string, unknown> = {}) => ({
    id: FLAG,
    organizationId: ORG,
    type: 'OVERLAP_WEAKER_EXCLUSIVE',
    status: 'OPEN',
    details: {
      exclusive: { mechanic: 'PERCENTAGE_OFF', value: 20 },
      publicOffer: { mechanic: 'PERCENTAGE_OFF', value: 50 },
    },
    decisionNote: null,
    createdAt: new Date().toISOString(),
    ...over,
  });

  it('a person decides with a reason; deciding is disabled until the reason is written', async () => {
    const calls = stub({
      [`/v1/admin/conflicts/${FLAG}/decide`]: {
        body: { data: flag({ status: 'REQUIRES_CHANGE' }), meta: {} },
      },
      '/v1/admin/conflicts': { body: { data: [flag()], meta: {} } },
      '/v1/admin/inbox': { body: { data: [], meta: {} } },
    });
    mount(<AdminOperationsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Offer conflicts' }));
    const card = await screen.findByTestId('op-conflict-OVERLAP_WEAKER_EXCLUSIVE');
    expect(card).toHaveTextContent('An Exclusive Deal is weaker than the public deal');
    expect(card).toHaveTextContent('Exclusive: PERCENTAGE_OFF 20');
    expect(screen.getByTestId('op-conf-REQUIRES_CHANGE')).toBeDisabled();
    await user.type(
      screen.getByLabelText('Reason for your decision'),
      'Exclusive must beat the public offer',
    );
    await user.click(screen.getByTestId('op-conf-REQUIRES_CHANGE'));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/decide'))).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/decide'))!.body!)).toEqual({
      decision: 'REQUIRES_CHANGE',
      note: 'Exclusive must beat the public offer',
    });
  });
  it('the scan reports what it checked and how many new flags it raised', async () => {
    const calls = stub({
      '/v1/admin/conflicts/scan': { body: { data: { checked: 3, flagged: 1 }, meta: {} } },
      '/v1/admin/conflicts': { body: { data: [], meta: {} } },
      '/v1/admin/inbox': { body: { data: [], meta: {} } },
    });
    mount(<AdminOperationsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Offer conflicts' }));
    await user.click(await screen.findByTestId('op-conf-scan'));
    expect(await screen.findByText('Checked 3 offers; 1 new flags.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/conflicts/scan'))).toBe(true);
  });
});

describe('Admin operations: activity', () => {
  it('shows plain-language history, translating known actions and falling back to the server wording', async () => {
    stub({
      '/v1/admin/activity': {
        body: {
          data: {
            items: [
              {
                id: 'a1',
                at: new Date().toISOString(),
                summary: 'Dispute opened',
                action: 'DISPUTE_OPENED',
                entityType: 'DisputeCase',
                entityId: CASE,
                reason: null,
                actor: { userId: 'u1', role: 'DEALDASH_FINANCE', organizationId: 'dd' },
              },
              {
                id: 'a2',
                at: new Date().toISOString(),
                summary: 'Something unusual happened',
                action: 'unknown.thing',
                entityType: 'X',
                entityId: null,
                reason: 'Because',
                actor: { userId: null, role: null, organizationId: null },
              },
            ],
            next: null,
          },
          meta: {},
        },
      },
      '/v1/admin/inbox': { body: { data: [], meta: {} } },
    });
    mount(<AdminOperationsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Activity' }));
    const rows = await screen.findAllByTestId('op-activity-row');
    expect(rows[0]).toHaveTextContent('A case was opened');
    expect(rows[0]).toHaveTextContent('DEALDASH_FINANCE');
    expect(rows[1]).toHaveTextContent('Something unusual happened');
    expect(rows[1]).toHaveTextContent('Reason: Because');
  });
});

describe('Admin loyalty', () => {
  it('lists rules with funder and agreement status; a different person approves; the author is told why', async () => {
    const calls = stub(
      {
        [`/v1/admin/loyalty/rules/${RULE}/approve`]: {
          body: { data: rule({ status: 'ACTIVE' }), meta: {} },
        },
        '/v1/admin/loyalty/rules': { body: { data: [rule()], meta: {} } },
      },
      LOYALTY,
    );
    mount(<AdminLoyaltyPage />);
    const user = userEvent.setup();
    const row = await screen.findByTestId('lo-rule-Bank bonus');
    expect(row).toHaveTextContent('A bank');
    expect(row).toHaveTextContent('Waiting for approval');
    expect(row).toHaveTextContent('An Exclusive Deal redemption');
    expect(screen.getByTestId('loyalty')).toHaveTextContent('no fixed cash value');
    await user.click(screen.getByTestId('lo-approve-Bank bonus'));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith(`/rules/${RULE}/approve`))).toBeTruthy(),
    );
  });

  it('creates a rule: a funded rule shows the funder fields, the rate is sent in halalas, caps are optional', async () => {
    const calls = stub(
      {
        '/v1/admin/loyalty/rules': (c) =>
          c.method === 'POST'
            ? { status: 201, body: { data: rule({ status: 'DRAFT' }), meta: {} } }
            : { body: { data: [], meta: {} } },
      },
      LOYALTY,
    );
    mount(<AdminLoyaltyPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('lo-new'));
    const form = await screen.findByTestId('lo-form');
    expect(within(form).queryByLabelText('The funder pays per point (SAR)')).toBeNull();
    await user.type(within(form).getByLabelText('Rule name'), 'Spring bonus');
    await user.selectOptions(within(form).getByLabelText('Who pays for the points'), 'BANK');
    await user.type(within(form).getByLabelText('Funder (business id)'), ORG);
    await user.type(within(form).getByLabelText('The funder pays per point (SAR)'), '0.05');
    await user.click(screen.getByTestId('lo-create'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toMatchObject({
      name: 'Spring bonus',
      fundingSource: 'BANK',
      fundingOrganizationId: ORG,
      fundingHalalasPerPoint: 5,
      dailyCap: null,
      maxAllocationPoints: 1000,
    });
  });

  it('shows the finance view: points given, taken back, still held, and what the funder has been charged', async () => {
    stub(
      {
        '/v1/admin/loyalty/finance': {
          body: {
            data: {
              rows: [
                {
                  ruleId: RULE,
                  ruleName: 'Bank bonus',
                  fundingSource: 'BANK',
                  allocated: 1000,
                  issued: 250,
                  reversed: 10,
                  redeemed: 40,
                  expired: 0,
                  outstanding: 200,
                  remainingAllocation: 750,
                  fundingHalalasPerPoint: 5,
                  fundingUtilizedHalalas: 1250,
                  fundingReceivedHalalas: 5000,
                  outstandingLiabilityHalalas: 1000,
                },
                {
                  ruleId: null,
                  ruleName: 'DealDash welcome',
                  fundingSource: 'DEALDASH',
                  allocated: 500,
                  issued: 20,
                  reversed: 0,
                  redeemed: 0,
                  expired: 0,
                  outstanding: 20,
                  remainingAllocation: 480,
                  fundingHalalasPerPoint: null,
                  fundingUtilizedHalalas: null,
                  fundingReceivedHalalas: null,
                  outstandingLiabilityHalalas: null,
                },
              ],
              totals: {
                issued: 270,
                reversed: 10,
                redeemed: 40,
                expired: 0,
                outstanding: 220,
                held: 5,
              },
              note: 'points_have_no_fixed_cash_value',
            },
            meta: {},
          },
        },
        '/v1/admin/loyalty/rules': { body: { data: [], meta: {} } },
      },
      LOYALTY,
    );
    mount(<AdminLoyaltyPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Points and funding' }));
    expect(await screen.findByTestId('lo-fin-issued')).toHaveTextContent('270');
    expect(screen.getByTestId('lo-fin-outstanding')).toHaveTextContent('220');
    const funded = screen.getByTestId('lo-fin-Bank bonus');
    expect(funded).toHaveTextContent('SAR 12.5');
    expect(funded).toHaveTextContent('SAR 50');
    expect(screen.getByTestId('lo-fin-DealDash welcome')).toHaveTextContent(
      'Not funded by a business',
    );
  });

  it('renders the loyalty workspace in Arabic', async () => {
    stub({ '/v1/admin/loyalty/rules': { body: { data: [rule()], meta: {} } } }, LOYALTY, 'ar');
    mount(<AdminLoyaltyPage />, 'ar');
    const row = await screen.findByTestId('lo-rule-Bank bonus');
    expect(row).toHaveTextContent('بنك');
    expect(row).toHaveTextContent('بانتظار الاعتماد');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('الولاء');
  });
});
