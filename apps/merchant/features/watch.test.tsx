import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { WatchBuilder } from './watch-builder';
import { WatchDetailPage } from './watch-detail';
import { WatchHub } from './watch-hub';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/watch',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const WID = '018f0000-0000-7000-8000-0000000000d9';
const MANAGER = [
  'merchant.watch.manage',
  'merchant.watch.read',
  'merchant.deals.read',
  'merchant.branch.read',
];
const FINANCE = ['merchant.watch.read', 'merchant.finance.read', 'merchant.finance.manage'];
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
  headers: Record<string, string>;
}
type R = { status?: number; body: unknown } | ((c: Call) => { status?: number; body: unknown });
function stub(routes: Record<string, R>, perms = MANAGER) {
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
        headers: (init?.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms), meta: {} });
      const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
      for (const key of keys)
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

/** A commercial case the owner has already accepted: the Submit button is enabled and the server decides the rest. */
const readyCase = (product: string, subjectId: string) => ({
  id: '018f0000-0000-7000-8000-0000000000c1',
  reference: 'CC-000001',
  product,
  subjectId,
  status: 'ACCEPTED',
  ownerOrganizationId: ORG,
  fulfilmentOrganizationId: ORG,
  developmentFixture: false,
  unusedTreatment: null,
  quotation: {
    id: '018f0000-0000-7000-8000-0000000000c2',
    reference: 'QT-000001',
    version: 1,
    status: 'ACCEPTED',
    createdAt: new Date().toISOString(),
    delta: null,
  },
  preview: {
    lines: [],
    totals: {
      currency: 'SAR',
      maxUnits: 20,
      dealdashChargesHalalas: 0,
      taxHalalas: 0,
      taxStatus: 'NOT_APPLICABLE',
      maxCashPayableToDealDashHalalas: 0,
      nettedChargesHalalas: 0,
      maxSponsorLiabilityHalalas: 0,
      sponsorLiability: [],
      merchantCashContributionHalalas: 0,
      maxMerchantBenefitCommitmentHalalas: 0,
      customerBenefitTotalHalalas: 0,
      totalEconomicCommitmentHalalas: 0,
      issues: [],
    },
    pricing: { source: 'DEFAULT', reference: null, versionKey: 'D:1', unusedTreatment: null },
    parties: [{ role: 'OWNER', organizationId: ORG, requiredChecks: ['REVIEWED_TERMS', 'ACCEPT_TERMS'] }],
    fundingRequirements: [],
    workflow: [],
  },
  acceptances: [],
  approvals: [],
  funding: [],
  blockers: [],
  submitBlockers: [],
  allowedActions: [],
  hold: { active: false, reason: null },
  updatedAt: new Date().toISOString(),
});
const budget = (over: Record<string, unknown> = {}) => ({
  paidViews: 20,
  qualifiedViews: 0,
  remainingViews: 20,
  chargePerViewHalalas: 100,
  requiredHalalas: 2000,
  fundedHalalas: 0,
  spentHalalas: 0,
  remainingHalalas: 0,
  unusedHalalas: 0,
  closedOut: false,
  unusedTreatment: 'UNDECIDED_VALIDATE_KSA',
  fundingRequired: true,
  ...over,
});
const content = (over: Record<string, unknown> = {}) => ({
  title: bi('Meet our chef', 'تعرّف على الشيف'),
  description: bi('How we grill.', 'كيف نشوي.'),
  ctaLabel: bi('See offers', 'شاهد العروض'),
  link: { type: 'MERCHANT', id: null },
  videoFileId: '018f0000-0000-7000-8000-0000000000f1',
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
  paidViews: 20,
  ...over,
});
const view = (over: Record<string, unknown> = {}) => ({
  id: WID,
  organizationId: ORG,
  status: 'DRAFT',
  version: 1,
  content: content(),
  videoUrl: null,
  thumbnailUrl: null,
  budget: budget(),
  pausedBy: null,
  submittedAt: null,
  publishedAt: null,
  endedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  translation: { complete: true, missing: [] },
  issues: [],
  guardrail: { outcome: 'MANUAL_REVIEW', reasons: ['PILOT_MANUAL_REVIEW'] },
  latestDecision: null,
  allowedActions: ['edit', 'fund', 'submit', 'cancel'],
  serverNow: new Date().toISOString(),
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  id: WID,
  status: 'LIVE',
  title: bi('Meet our chef', 'تعرّف على الشيف'),
  paidViews: 200,
  qualifiedViews: 38,
  fundedHalalas: 20_000,
  spentHalalas: 3_800,
  startAt: inDays(-1),
  endAt: inDays(9),
  thumbnailUrl: null,
  updatedAt: new Date().toISOString(),
  ...over,
});
const previewDetail = {
  id: WID,
  merchantId: ORG,
  merchantName: bi('Test Cafe', 'مقهى الاختبار'),
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
const summary = {
  counts: { LIVE: 1, DRAFT: 2 },
  total: 3,
  money: { fundedHalalas: 20_000, spentHalalas: 3_800, unusedHalalas: 500, qualifiedViews: 38 },
};
const monitor = (over: Record<string, unknown> = {}) => ({
  status: 'LIVE',
  serverNow: new Date().toISOString(),
  budget: budget({
    fundedHalalas: 2000,
    spentHalalas: 700,
    remainingHalalas: 1300,
    fundingRequired: false,
    qualifiedViews: 7,
    remainingViews: 13,
  }),
  delivery: { paidViews: 20, qualifiedViews: 7, remainingViews: 13, pct: 35, schedulePct: 20 },
  funnel: {
    impressions: 120,
    opened: 60,
    started: 14,
    completed: 10,
    qualified: 7,
    invalid: 5,
    capped: 2,
    invalidByCategory: { SKIPPED: 3, LEFT_APP: 2 },
    ctaClicks: 4,
  },
  reach: { uniqueViewers: 12, averageFrequency: 1.2 },
  completionRatePct: 71.4,
  costPerQualifiedViewHalalas: 100,
  rewards: { rewardedViews: 7, pointsIssued: 70, heldViews: 0 },
  disclaimerKey: 'views_and_verified_spend_only',
  ...over,
});

describe('merchant Watch & Earn hub', () => {
  it('lists campaigns with verified / paid views and spent / budget, plus the money summary; the status filter changes the query', async () => {
    const calls = stub({
      '/watch/summary': { body: { data: summary, meta: {} } },
      '/watch': { body: { data: [row()], meta: {} } },
    });
    mount(<WatchHub />);
    const r = await screen.findByTestId('watch-row');
    expect(r).toHaveTextContent('38 / 200');
    expect(r).toHaveTextContent('SAR 38.00 / SAR 200.00');
    expect(screen.getByTestId('sum-spent')).toHaveTextContent('SAR 38.00');
    expect(screen.getByTestId('sum-views')).toHaveTextContent('38');
    await userEvent.setup().selectOptions(screen.getByLabelText('Status'), 'PAUSED');
    await waitFor(() => expect(calls.some((c) => c.url.includes('status=PAUSED'))).toBe(true));
  });

  it('an empty hub explains the first step; a read-only user (Finance) gets no create button', async () => {
    stub(
      {
        '/watch/summary': { body: { data: { ...summary, total: 0 }, meta: {} } },
        '/watch': { body: { data: [], meta: {} } },
      },
      FINANCE,
    );
    mount(<WatchHub />);
    expect(await screen.findByText('No Watch & Earn campaigns yet')).toBeInTheDocument();
    expect(screen.queryByTestId('watch-create')).toBeNull();
  });

  it('states that DealDash sets the reward and checks every view (Arabic too)', async () => {
    stub({
      '/watch/summary': { body: { data: summary, meta: {} } },
      '/watch': { body: { data: [row()], meta: {} } },
    });
    mount(<WatchHub />, 'ar');
    expect(await screen.findByTestId('watch-row')).toBeInTheDocument();
    expect(document.body.textContent).toContain('ديل داش');
  });
});

describe('merchant Watch & Earn builder', () => {
  const routes = (v = view(), extra: Record<string, R> = {}): Record<string, R> => ({
    '/commercial/case': { body: { data: readyCase('WATCH', WID), meta: {} } },
    '/hot-deal-choices': {
      body: {
        data: { eligibility: { employers: [], banks: [], schemes: [], cities: ['Riyadh'] } },
        meta: {},
      },
    },
    '/watch-options': {
      body: {
        data: {
          limits: {
            minDurationSec: 5,
            maxDurationSec: 60,
            maxVideoBytes: 52_428_800,
            minPaidViews: 10,
            maxPaidViews: 100_000,
            maxCampaignDays: 90,
          },
          rateCard: { chargePerViewHalalas: 100, version: 1, placeholder: true },
          minRepeatWindowHours: 24,
          cities: ['Riyadh', 'Jeddah'],
          unusedBudgetTreatment: 'UNDECIDED_VALIDATE_KSA',
        },
        meta: {},
      },
    },
    [`/watch/${WID}/preview`]: { body: { data: previewDetail, meta: {} } },
    [`/watch/${WID}`]: (c) =>
      c.method === 'PUT'
        ? { body: { data: { campaign: v, outcome: 'SAVED' }, meta: {} } }
        : { body: { data: v, meta: {} } },
    ...extra,
  });
  const goTo = async (label: string) => {
    const nav = await screen.findByRole('navigation', { name: 'Steps' });
    await userEvent.setup().click(within(nav).getByRole('button', { name: new RegExp(label) }));
  };

  it("has no reward field anywhere: the customer reward is DealDash's and the page says so", async () => {
    stub(routes());
    mount(<WatchBuilder campaignId={WID} />);
    await screen.findByTestId('watch-builder');
    await goTo('Content');
    expect(await screen.findByText(/You do not set the customer reward/)).toBeInTheDocument();
    for (const label of ['Reward', 'Points per view', 'Points'])
      expect(screen.queryByLabelText(new RegExp(`^${label}`, 'i'))).toBeNull();
  });

  it('the budget step prices paid views from the DealDash rate card and funds the missing amount with an Idempotency-Key', async () => {
    const calls = stub(
      routes(view(), {
        [`/watch/${WID}/fund`]: {
          body: {
            data: view({ budget: budget({ fundedHalalas: 2000, fundingRequired: false }) }),
            meta: {},
          },
        },
      }),
    );
    mount(<WatchBuilder campaignId={WID} />);
    await screen.findByTestId('watch-builder');
    await goTo('Budget');
    expect(await screen.findByTestId('builder-required')).toHaveTextContent('SAR 20.00');
    expect(screen.getByTestId('builder-funded')).toHaveTextContent('SAR 0.00');
    expect(screen.getByText(/You pay SAR 1\.00 for each verified view/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByTestId('watch-fund'));
    await screen.findByTestId('builder-fully-funded');
    const post = calls.find((c) => c.url.endsWith(`/watch/${WID}/fund`))!;
    expect(JSON.parse(post.body!)).toEqual({ amountHalalas: 2000 });
    expect(post.headers['Idempotency-Key']).toBeTruthy();
  });

  it('review warns that the full budget is needed before sending; unused budget is explained as undecided', async () => {
    stub(routes());
    mount(<WatchBuilder campaignId={WID} />);
    await screen.findByTestId('watch-builder');
    await goTo('Review');
    expect(await screen.findByTestId('review-unfunded')).toHaveTextContent('Add the full budget');
    await goTo('Budget');
    expect(await screen.findByText(/still being decided by DealDash/)).toBeInTheDocument();
  });

  it("shows the server's funding refusal when submitting an unfunded campaign", async () => {
    stub(
      routes(view({ budget: budget({ fundedHalalas: 2000, fundingRequired: false }) }), {
        [`/watch/${WID}/submit`]: {
          status: 402,
          body: { errors: [{ code: 'FUNDING_REQUIRED', message: 'x' }], meta: {} },
        },
      }),
    );
    mount(<WatchBuilder campaignId={WID} />);
    await screen.findByTestId('watch-builder');
    await goTo('Review');
    await userEvent.setup().click(await screen.findByTestId('watch-submit'));
    expect(
      await screen.findByText('Add the full campaign budget before sending it for review.'),
    ).toBeInTheDocument();
  });

  it('an approved campaign locks the video, audience and number of views and says only wording can change', async () => {
    stub(routes(view({ status: 'LIVE', allowedActions: ['edit_minor', 'pause', 'cancel'] })));
    mount(<WatchBuilder campaignId={WID} />);
    await screen.findByTestId('watch-builder');
    expect(
      screen.getAllByText(/Approved campaigns can only change wording/).length,
    ).toBeGreaterThan(0);
    await goTo('Budget');
    expect(await screen.findByLabelText(/Verified views to buy/)).toBeDisabled();
  });

  it('both languages are required: the Arabic fields are right-to-left', async () => {
    stub(routes());
    mount(<WatchBuilder campaignId={WID} />);
    await screen.findByTestId('watch-builder');
    await goTo('Content');
    const ar = await screen.findByLabelText(/Title \(Arabic\)/);
    expect(ar).toHaveAttribute('dir', 'rtl');
    expect(ar).toHaveValue('تعرّف على الشيف');
  });
});

describe('merchant Watch & Earn detail', () => {
  const routes = (
    v = view({ status: 'LIVE', allowedActions: ['edit_minor', 'pause', 'cancel'] }),
    m = monitor(),
    extra: Record<string, R> = {},
  ): Record<string, R> => ({
    [`/watch/${WID}/monitor`]: { body: { data: m, meta: {} } },
    [`/watch/${WID}/history`]: { body: { data: [], meta: {} } },
    [`/watch/${WID}/budget`]: {
      body: {
        data: {
          budget: m.budget,
          funding: [
            {
              id: 'f1',
              amountHalalas: 2000,
              source: 'MOCK_PAYMENT',
              reference: 'WF-AAAA1111',
              createdAt: new Date().toISOString(),
              byName: 'Owner',
            },
          ],
          journals: [],
          disclaimerKey: 'legal_treatment_validate_ksa',
        },
        meta: {},
      },
    },
    [`/watch/${WID}`]: { body: { data: v, meta: {} } },
    ...extra,
  });

  it('shows verified numbers only: views, completion, cost per verified view, categories of views not counted, no customer identities', async () => {
    stub(routes());
    mount(<WatchDetailPage campaignId={WID} />);
    expect(await screen.findByTestId('kpi-qualified')).toHaveTextContent('7');
    expect(screen.getByTestId('kpi-remaining-views')).toHaveTextContent('13');
    expect(screen.getByTestId('funnel-impressions')).toHaveTextContent('120');
    expect(screen.getByTestId('funnel-qualified')).toHaveTextContent('7');
    expect(screen.getByTestId('reason-SKIPPED')).toHaveTextContent('3');
    expect(screen.getByTestId('budget-spent')).toHaveTextContent('SAR 7.00');
    expect(
      screen.getByText(/Figures count verified views and verified spend only/),
    ).toBeInTheDocument();
    const text = screen.getByTestId('watch-monitor').textContent!;
    expect(text).not.toMatch(/fraud|risk|device|automation|conversion|score/i);
  });

  it('the budget tab lists the funding and states the legal treatment is not final', async () => {
    stub(routes());
    mount(<WatchDetailPage campaignId={WID} />);
    await screen.findByTestId('kpi-qualified');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Budget' }));
    expect(await screen.findByTestId('funding-row')).toHaveTextContent('WF-AAAA1111');
    expect(screen.getByTestId('budget-disclaimer')).toHaveTextContent('not final');
  });

  it('a campaign that ended shows its unused budget as a separate balance', async () => {
    const ended = view({
      status: 'EXPIRED',
      allowedActions: [],
      budget: budget({
        fundedHalalas: 2000,
        spentHalalas: 700,
        unusedHalalas: 1300,
        closedOut: true,
        fundingRequired: false,
      }),
    });
    stub(routes(ended, monitor({ status: 'EXPIRED', budget: ended.budget })));
    mount(<WatchDetailPage campaignId={WID} />);
    expect(await screen.findByTestId('unused-banner')).toHaveTextContent('SAR 13.00');
    expect(screen.getByTestId('budget-unused')).toHaveTextContent('SAR 13.00');
    expect(screen.getByTestId('budget-unused-note')).toBeInTheDocument();
  });

  it('cancelling needs a reason and posts it', async () => {
    const calls = stub(
      routes(undefined, undefined, {
        [`/watch/${WID}/cancel`]: {
          body: { data: view({ status: 'CANCELLED', allowedActions: [] }), meta: {} },
        },
      }),
    );
    mount(<WatchDetailPage campaignId={WID} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('open-cancel'));
    const confirm = await screen.findByTestId('confirm-reason');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'Changed our plans');
    await user.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/cancel'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/cancel'))!.body!)).toEqual({
      reason: 'Changed our plans',
    });
  });

  it('a DealDash pause cannot be resumed by the merchant (no resume button) and the page explains why', async () => {
    stub(
      routes(
        view({ status: 'PAUSED', pausedBy: 'DEALDASH', allowedActions: ['edit_minor', 'cancel'] }),
      ),
    );
    mount(<WatchDetailPage campaignId={WID} />);
    expect(await screen.findByText(/DealDash paused this campaign/)).toBeInTheDocument();
    expect(screen.queryByTestId('do-resume')).toBeNull();
  });

  it("requested changes show DealDash's reason in the merchant's language", async () => {
    stub(
      routes(
        view({
          status: 'NEEDS_CHANGES',
          allowedActions: ['edit', 'submit', 'cancel'],
          latestDecision: {
            id: 'd1',
            action: 'REQUEST_CHANGES',
            reason: 'Add the opening hours.',
            reasonAr: 'أضف ساعات العمل.',
            fields: [],
            actorRole: 'DealDash',
            actorName: null,
            byDealDash: true,
            createdAt: new Date().toISOString(),
          },
        }),
      ),
    );
    mount(<WatchDetailPage campaignId={WID} />, 'ar');
    expect(await screen.findByText('أضف ساعات العمل.')).toBeInTheDocument();
  });
});
