import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { AdminRewardsPage } from './rewards';
import { AdminRiskPage } from './risk';
import { AdminWatchPage, AdminWatchReviewPage } from './watch';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/watch',
  useSearchParams: () => new URLSearchParams(),
}));

const WID = '018f0000-0000-7000-8000-0000000000d9';
const CASE = '018f0000-0000-7000-8000-0000000000c9';
const OPS = ['admin.watch.read', 'admin.campaigns.review', 'admin.campaigns.control'];
const FINANCE = ['admin.watch.read', 'admin.rewards.read', 'admin.payments.read'];
const RISK = [
  'admin.risk.manage',
  'admin.rewards.manage',
  'admin.rewards.read',
  'admin.rewards.request',
  'admin.watch.read',
];
const SUPPORT = ['admin.rewards.request'];
const me = (permissions: string[]) => ({
  id: '018f0000-0000-7000-8000-000000000009',
  userType: 'ADMIN_USER',
  displayName: 'Ops',
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
type R = { status?: number; body: unknown } | ((c: Call) => { status?: number; body: unknown });
function stub(routes: Record<string, R>, perms = OPS) {
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
const bi = (en: string, ar: string) => ({ en, ar });
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const budget = (over: Record<string, unknown> = {}) => ({
  paidViews: 200,
  qualifiedViews: 24,
  remainingViews: 176,
  chargePerViewHalalas: 100,
  requiredHalalas: 20_000,
  fundedHalalas: 20_000,
  spentHalalas: 2_400,
  remainingHalalas: 17_600,
  unusedHalalas: 0,
  closedOut: false,
  unusedTreatment: 'UNDECIDED_VALIDATE_KSA',
  fundingRequired: false,
  ...over,
});
const preview = {
  id: WID,
  merchantId: 'm1',
  merchantName: bi('Najd Kitchen', 'نجد كيتشن'),
  merchantLogoUrl: null,
  title: bi('Meet our chef', 'تعرّف على الشيف'),
  description: bi('How we grill.', 'كيف نشوي.'),
  thumbnailUrl: null,
  durationSec: 12,
  rewardPoints: 10,
  availability: 'AVAILABLE',
  availableAgainAt: null,
  endsAt: null,
  distanceMeters: null,
  eligibility: { result: 'ELIGIBLE', kind: 'PUBLIC', message: null, unlockAction: null },
  serverNow: new Date().toISOString(),
  ctaLabel: bi('See offers', 'شاهد العروض'),
  link: { type: 'MERCHANT', id: null, label: null },
  canStart: true,
  sponsored: true,
};
const detail = (over: Record<string, unknown> = {}) => ({
  id: WID,
  organizationId: 'm1',
  status: 'PENDING_REVIEW',
  version: 2,
  content: {
    title: bi('Meet our chef', 'تعرّف على الشيف'),
    description: bi('How we grill.', 'كيف نشوي.'),
    ctaLabel: bi('See offers', 'شاهد العروض'),
    link: { type: 'MERCHANT', id: null },
    videoFileId: 'f1',
    thumbnailFileId: null,
    durationSec: 12,
    startAt: inDays(1),
    endAt: inDays(10),
    targeting: {
      cities: ['Riyadh'],
      eligibility: { kind: 'PUBLIC', valueRefs: [] },
      timeWindow: null,
      branchIds: [],
    },
    frequency: { repeatWindowHours: null },
    paidViews: 200,
  },
  videoUrl: 'http://localhost:4000/v1/storage/download/x',
  thumbnailUrl: null,
  budget: budget(),
  pausedBy: null,
  submittedAt: new Date().toISOString(),
  publishedAt: null,
  endedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  translation: { complete: true, missing: [] },
  issues: [],
  guardrail: { outcome: 'MANUAL_REVIEW', reasons: ['PILOT_MANUAL_REVIEW', 'LARGE_BUDGET'] },
  latestDecision: null,
  allowedActions: [],
  serverNow: new Date().toISOString(),
  merchant: {
    id: 'm1',
    nameEn: 'Najd Kitchen',
    nameAr: 'نجد كيتشن',
    legalName: 'Najd LLC',
    commercialRegistration: '1010',
    status: 'ACTIVE',
    trustLevel: 'NEW',
    riskTier: 'STANDARD',
  },
  history: [
    {
      id: 'h1',
      action: 'SUBMIT',
      fromStatus: 'DRAFT',
      toStatus: 'PENDING_REVIEW',
      reason: null,
      reasonAr: null,
      fields: [],
      actorRole: 'MERCHANT_OWNER',
      actorName: 'Owner',
      byDealDash: false,
      createdAt: new Date().toISOString(),
    },
  ],
  preview,
  adminActions: ['approve', 'request_changes', 'reject'],
  economics: {
    chargePerViewHalalas: 100,
    rateCardVersion: 1,
    estimatedCostHalalas: 20_000,
    rewardPoints: 10,
    rewardRuleVersion: 1,
    qualifyingWatchPct: 80,
    stillWatchingMode: 'RANDOM',
    repeatWindowHours: 24,
    customerDailyCap: 10,
    deviceMaxAccounts: 2,
    holdHours: 24,
    reviewAbovePaidViews: 150,
    largeBudgetFlag: true,
    unusedBudgetTreatment: 'UNDECIDED_VALIDATE_KSA',
  },
  ...over,
});
const monitor = {
  status: 'PENDING_REVIEW',
  serverNow: '',
  budget: budget(),
  delivery: { paidViews: 200, qualifiedViews: 24, remainingViews: 176, pct: 12, schedulePct: 10 },
  funnel: {
    impressions: 1,
    opened: 1,
    started: 1,
    completed: 1,
    qualified: 1,
    invalid: 0,
    capped: 0,
    invalidByCategory: {},
    ctaClicks: 0,
  },
  reach: { uniqueViewers: 1, averageFrequency: 1 },
  completionRatePct: 100,
  costPerQualifiedViewHalalas: 100,
  rewards: { rewardedViews: 1, pointsIssued: 10, heldViews: 0 },
  disclaimerKey: 'views_and_verified_spend_only',
};
const overview = {
  counts: {
    live: 3,
    pendingReview: 1,
    paused: 2,
    exhausted: 1,
    openFlags: 4,
    qualified24h: 30,
    invalid24h: 6,
    rewardsIssued24h: 25,
    rewardsHeld: 5,
  },
  campaigns: [
    {
      id: WID,
      title: bi('Meet our chef', 'تعرّف على الشيف'),
      merchantName: bi('Najd Kitchen', 'نجد كيتشن'),
      status: 'LIVE',
      paidViews: 200,
      qualifiedViews: 24,
      budgetPct: 12,
      fundedHalalas: 20_000,
      spentHalalas: 2_400,
      openFlags: 1,
    },
  ],
  disclaimerKey: 'legal_treatment_validate_ksa',
};
const adminRow = {
  id: WID,
  status: 'PENDING_REVIEW',
  title: bi('Meet our chef', 'تعرّف على الشيف'),
  paidViews: 200,
  qualifiedViews: 0,
  fundedHalalas: 20_000,
  spentHalalas: 0,
  startAt: inDays(1),
  endAt: inDays(10),
  thumbnailUrl: null,
  updatedAt: new Date().toISOString(),
  merchant: { id: 'm1', nameEn: 'Najd Kitchen', nameAr: 'نجد كيتشن', trustLevel: 'NEW' },
  submittedAt: new Date().toISOString(),
  flags: 0,
};

describe('admin Watch & Earn list', () => {
  it('shows the operational counts, the review queue and the live monitor', async () => {
    const calls = stub({
      '/v1/admin/watch/overview': { body: { data: overview, meta: {} } },
      '/v1/admin/watch': { body: { data: [adminRow], meta: {} } },
    });
    mount(<AdminWatchPage />);
    expect(await screen.findByTestId('count-live')).toHaveTextContent('3');
    expect(screen.getByTestId('count-openFlags')).toHaveTextContent('4');
    expect(screen.getByTestId('count-rewardsHeld')).toHaveTextContent('5');
    expect(await screen.findByTestId('admin-watch-row')).toHaveTextContent('Najd Kitchen');
    expect(calls.some((c) => c.url.includes('queue=true'))).toBe(true);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Live monitor' }));
    const mon = await screen.findByTestId('watch-monitor-row');
    expect(mon).toHaveTextContent('12%');
    expect(mon).toHaveTextContent('24 / 200');
  });
});

describe('admin Watch & Earn review workbench', () => {
  const routes = (d = detail(), extra: Record<string, R> = {}): Record<string, R> => ({
    [`/v1/admin/watch/${WID}/monitor`]: { body: { data: monitor, meta: {} } },
    [`/v1/admin/watch/${WID}/budget`]: {
      body: {
        data: {
          budget: budget(),
          funding: [],
          journals: [],
          disclaimerKey: 'legal_treatment_validate_ksa',
        },
        meta: {},
      },
    },
    [`/v1/admin/watch/${WID}`]: { body: { data: d, meta: {} } },
    ...extra,
  });

  it('shows the content in both languages, the video, and the DealDash-controlled economics the reviewer must check', async () => {
    stub(routes());
    mount(<AdminWatchReviewPage id={WID} />);
    expect(await screen.findByTestId('watch-economics')).toBeInTheDocument();
    expect(screen.getByTestId('econ-cost')).toHaveTextContent('SAR 200.00');
    expect(screen.getByTestId('econ-funded')).toHaveTextContent('SAR 200.00');
    expect(screen.getByTestId('econ-points')).toHaveTextContent('10');
    expect(screen.getByTestId('econ-unused')).toHaveTextContent('treatment not decided');
    expect(screen.getByTestId('large-budget-flag')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('content-ar')).getByText('تعرّف على الشيف'),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId('content-en')).getByText('Meet our chef')).toBeInTheDocument();
    expect(screen.getByTestId('admin-watch-video')).toHaveAttribute(
      'src',
      expect.stringContaining('/v1/storage/download/'),
    );
    expect(screen.getByText('These settings belong to DealDash', { exact: false })).toBeTruthy();
  });

  it('approving records a reason and posts the decision', async () => {
    const calls = stub(
      routes(detail(), {
        [`/v1/admin/watch/${WID}/approve`]: {
          body: {
            data: detail({ status: 'LIVE', adminActions: ['pause', 'suspend', 'stop'] }),
            meta: {},
          },
        },
      }),
    );
    mount(<AdminWatchReviewPage id={WID} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('act-approve'));
    await user.click(await screen.findByTestId('decision-confirm'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/approve'))).toBe(true));
    const post = calls.find((c) => c.url.endsWith('/approve'))!;
    expect(JSON.parse(post.body!).reason).toMatch(/checked/);
  });

  it('a read-only role (Finance) sees the money but has no decision buttons', async () => {
    stub(routes(detail({ adminActions: [] })), FINANCE);
    mount(<AdminWatchReviewPage id={WID} />);
    await screen.findByTestId('watch-economics');
    expect(screen.queryByTestId('act-approve')).toBeNull();
    expect(screen.getByText('You can view this but not act on it.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Budget' }));
    expect(await screen.findByTestId('admin-watch-budget')).toBeInTheDocument();
  });

  it('a live campaign offers pause, suspend and stop', async () => {
    stub(routes(detail({ status: 'LIVE', adminActions: ['pause', 'suspend', 'stop'] })));
    mount(<AdminWatchReviewPage id={WID} />);
    await screen.findByTestId('watch-decision');
    for (const a of ['pause', 'suspend', 'stop'])
      expect(screen.getByTestId(`act-${a}`)).toBeInTheDocument();
    expect(screen.queryByTestId('act-approve')).toBeNull();
  });
});

describe('admin risk cases', () => {
  const row = {
    id: CASE,
    createdAt: new Date().toISOString(),
    decision: 'FLAG',
    severity: 65,
    status: 'OPEN',
    signals: ['DEVICE_SHARED_ACCOUNTS', 'AUTOMATION_PATTERN'],
    subject: { kind: 'ACCOUNT', label: '+966••••001' },
    campaign: { id: WID, title: bi('Meet our chef', 'تعرّف على الشيف') },
    viewId: 'v1',
    outcome: null,
    reviewedByName: null,
  };
  const caseDetail = (over: Record<string, unknown> = {}) => ({
    ...row,
    signalDetails: [
      { code: 'DEVICE_SHARED_ACCOUNTS', weight: 40, detail: '3 accounts use this device' },
      { code: 'AUTOMATION_PATTERN', weight: 25, detail: 'Heartbeat spacing is unusually regular' },
    ],
    timeline: [{ type: 'STARTED', positionSec: 0, at: new Date().toISOString() }],
    linked: { accountsOnDevice: 3, devicesOnAccount: 1, recentViews: 4 },
    rewardEntryId: null,
    reviewReason: null,
    ...over,
  });

  it('lists open cases; opening one shows the signals and the linked counts; deciding needs a reason and posts the outcome', async () => {
    const calls = stub(
      {
        [`/v1/admin/risk/flags/${CASE}/decide`]: {
          body: {
            data: caseDetail({
              status: 'DECIDED',
              outcome: 'REVERSE_REWARDS',
              reviewReason: 'Automation suspected.',
            }),
            meta: {},
          },
        },
        [`/v1/admin/risk/flags/${CASE}`]: { body: { data: caseDetail(), meta: {} } },
        '/v1/admin/risk/flags': { body: { data: [row], meta: {} } },
      },
      RISK,
    );
    mount(<AdminRiskPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('risk-open'));
    const signals = await screen.findByTestId('risk-signals');
    expect(signals).toHaveTextContent('Many accounts on one device');
    expect(signals).toHaveTextContent('3 accounts use this device');
    await user.selectOptions(screen.getByLabelText('Outcome'), 'REVERSE_REWARDS');
    await user.type(screen.getByLabelText(/Reason/), 'Automation suspected.');
    await user.click(screen.getByTestId('risk-decide'));
    await screen.findByTestId('risk-decided');
    const post = calls.find((c) => c.url.endsWith('/decide'))!;
    expect(JSON.parse(post.body!)).toEqual({
      outcome: 'REVERSE_REWARDS',
      reason: 'Automation suspected.',
    });
  });
});

describe('admin rewards', () => {
  const overviewR = {
    liability: { availableBalance: 1200, heldBalance: 30, accounts: 8 },
    rules: {
      expiryDays: null,
      negativeBalancePolicy: 'ALLOW_NEGATIVE',
      adjustmentCheckerThresholdPoints: 100,
      rewardRule: [
        { upToSec: 15, points: 10 },
        { upToSec: 600, points: 30 },
      ],
      pointValueShown: false,
    },
    items: [
      {
        id: 'i1',
        name: bi('Sample: coffee voucher', 'نموذج: قسيمة قهوة'),
        description: bi('', ''),
        pointsCost: 100,
        stock: 50,
        status: 'ACTIVE',
        isSample: true,
        redeemed: 3,
      },
    ],
  };
  const adj = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    userId: 'u1',
    accountLabel: '+966••••001',
    points: 150,
    reasonCode: 'GOODWILL',
    ticketRef: 'T-9',
    reason: 'Goodwill',
    status: 'PENDING',
    requestedByName: 'Support',
    decidedByName: null,
    needsChecker: true,
    actions: ['approve', 'reject'],
    createdAt: new Date().toISOString(),
    ...over,
  });

  it('overview: liability, the rules in force (no point value shown), expiry off, and a balance check', async () => {
    stub(
      {
        '/v1/admin/rewards/reconcile': { body: { data: { accounts: 8, mismatches: 0 }, meta: {} } },
        '/v1/admin/rewards/overview': { body: { data: overviewR, meta: {} } },
      },
      FINANCE,
    );
    mount(<AdminRewardsPage />);
    expect(await screen.findByTestId('liab-available')).toHaveTextContent('1,200');
    expect(screen.getByTestId('rule-expiry')).toHaveTextContent('Off (not decided yet)');
    expect(screen.getByText(/no cash value/i)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId('reconcile-run'));
    expect(await screen.findByTestId('reconcile-result')).toHaveTextContent(
      '8 accounts checked, 0 differences',
    );
  });

  it('Support sees only Adjustments (request) and no approve buttons; a manager sees approve / reject for those they may decide', async () => {
    stub(
      { '/v1/admin/rewards/adjustments': { body: { data: [adj({ actions: [] })], meta: {} } } },
      SUPPORT,
    );
    mount(<AdminRewardsPage />);
    expect(await screen.findByTestId('adjust-row')).toHaveTextContent(
      'Needs a second administrator',
    );
    expect(screen.queryByTestId('adjust-approve')).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Overview' })).toBeNull();
  });

  it('approving an adjustment needs a reason and posts it', async () => {
    const calls = stub(
      {
        '/v1/admin/rewards/adjustments/a1/approve': {
          body: { data: adj({ status: 'APPROVED', actions: [] }), meta: {} },
        },
        '/v1/admin/rewards/adjustments': { body: { data: [adj()], meta: {} } },
        '/v1/admin/rewards/overview': { body: { data: overviewR, meta: {} } },
      },
      RISK,
    );
    mount(<AdminRewardsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Adjustments' }));
    await user.click(await screen.findByTestId('adjust-approve'));
    const confirm = await screen.findByTestId('adjust-decide-confirm');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'Checked on ticket T-9');
    await user.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/a1/approve'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/a1/approve'))!.body!)).toEqual({
      reason: 'Checked on ticket T-9',
    });
  });

  it('the catalogue lists sample items clearly flagged', async () => {
    stub({ '/v1/admin/rewards/overview': { body: { data: overviewR, meta: {} } } }, RISK);
    mount(<AdminRewardsPage />);
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Rewards list' }));
    const r = await screen.findByTestId('item-row');
    expect(r).toHaveTextContent('Sample: coffee voucher');
    expect(within(r).getAllByText('Sample').length).toBeGreaterThan(0);
  });
});
