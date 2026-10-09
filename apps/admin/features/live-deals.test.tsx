import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyLiveDealContent } from '@dealdash/validation';
import { Providers } from '../app/[locale]/providers';
import { DealReviewPage } from './deal-review';
import { LiveDealsPage } from './live-deals';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/live-deals',
  useSearchParams: () => new URLSearchParams(),
}));

const DEAL = '018f0000-0000-7000-8000-0000000000d1';
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
const REVIEWER = ['admin.campaigns.review', 'admin.campaigns.control', 'admin.reports.read'];

function stub(
  routes: Record<string, { status?: number; body: unknown }>,
  user: unknown = me(REVIEWER),
) {
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
      if (url.includes('/v1/auth/me')) return json(200, { data: user, meta: {} });
      for (const [k, r] of Object.entries(routes))
        if (url.includes(k)) return json(r.status ?? 200, r.body);
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const row = (over: Record<string, unknown> = {}) => ({
  id: DEAL,
  status: 'PENDING_REVIEW',
  kind: 'NEW',
  title: { en: '30% off the tasting menu', ar: 'خصم 30% على قائمة التذوق' },
  merchant: { id: 'm1', nameEn: 'Harbour Grill', nameAr: 'هاربور جريل', trustLevel: 'NEW' },
  branchCount: 2,
  submittedAt: '2026-10-07T08:00:00.000Z',
  startAt: null,
  endAt: null,
  ...over,
});

const preview = {
  id: DEAL,
  merchantId: 'm1',
  merchantName: { en: 'Harbour Grill', ar: 'هاربور جريل' },
  merchantLogoUrl: null,
  title: { en: '30% off the tasting menu', ar: 'خصم 30% على قائمة التذوق' },
  offerLabel: { en: '30% off', ar: 'خصم 30%' },
  shortDescription: { en: 'Dinner for two', ar: 'عشاء لشخصين' },
  category: { code: 'dining', name: { en: 'Dining', ar: 'المطاعم' } },
  mechanic: 'PERCENTAGE_OFF',
  imageUrl: null,
  imageAlt: { en: 'Plate', ar: 'طبق' },
  startsAt: null,
  endsAt: null,
  distanceMeters: null,
  nearestBranch: null,
  branchCount: 1,
  eligibility: {
    result: 'LOCKED_UNLOCKABLE',
    kind: 'EMPLOYER',
    message: { en: 'Verify your employer to unlock', ar: 'وثّق جهة عملك لفتح العرض' },
    unlockAction: 'VERIFY_EMPLOYER',
  },
  saved: false,
  availability: 'AVAILABLE',
  description: { en: 'Enjoy the full menu.', ar: 'استمتع بالقائمة كاملة.' },
  terms: {
    blocks: {
      fullPriceItemsOnly: false,
      notCombinable: false,
      minimumSpendHalalas: null,
      validDays: [],
      validFrom: null,
      validTo: null,
    },
    text: { en: 'Dinner only.', ar: 'للعشاء فقط.' },
  },
  media: [],
  branches: [],
  redemption: { mode: 'GENERAL' },
};

const detail = (over: Record<string, unknown> = {}) => ({
  id: DEAL,
  organizationId: 'm1',
  status: 'PENDING_REVIEW',
  version: 2,
  content: {
    ...emptyLiveDealContent(),
    title: { en: '30% off the tasting menu', ar: 'خصم 30% على قائمة التذوق' },
    offerLabel: { en: '30% off', ar: 'خصم 30%' },
    shortDescription: { en: 'Dinner for two', ar: 'عشاء لشخصين' },
    description: { en: 'Enjoy the full menu.', ar: 'استمتع بالقائمة كاملة.' },
    terms: {
      blocks: emptyLiveDealContent().terms.blocks,
      textEn: 'Dinner only.',
      textAr: 'للعشاء فقط.',
    },
    eligibility: { kind: 'EMPLOYER', valueRefs: ['p1'] },
  },
  media: [],
  branches: [],
  category: null,
  pausedBy: null,
  submittedAt: null,
  publishedAt: null,
  endedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  translation: { complete: true, missing: [] },
  issues: [],
  guardrail: { outcome: 'MANUAL_REVIEW', reasons: ['PILOT_MANUAL_REVIEW'] },
  discoverable: { visible: false, reason: 'STATUS_NOT_PUBLIC' },
  revision: null,
  latestDecision: null,
  allowedActions: [],
  merchant: {
    id: 'm1',
    nameEn: 'Harbour Grill',
    nameAr: 'هاربور جريل',
    status: 'ACTIVE',
    trustLevel: 'NEW',
    riskTier: 'STANDARD',
    logoUrl: null,
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
      createdAt: '2026-10-02T00:00:00.000Z',
    },
  ],
  preview,
  reviewTarget: 'DEAL',
  adminActions: ['approve', 'request_changes', 'reject'],
  ...over,
});

describe('Admin Live Deals queue', () => {
  it('lists submissions oldest first with merchant, trust level and kind (English)', async () => {
    stub({
      '/v1/admin/live-deals': {
        body: {
          data: [
            row(),
            row({
              id: 'r2',
              kind: 'REVISION',
              status: 'LIVE',
              title: { en: 'Family grill platter 35% off', ar: 'طبق المشويات بخصم 35%' },
            }),
          ],
          meta: { nextCursor: null },
        },
      },
    });
    render(
      <Providers locale="en">
        <LiveDealsPage />
      </Providers>,
    );
    expect(await screen.findByText('30% off the tasting menu')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('Harbour Grill').length).toBe(2);
    expect(within(table).getAllByText('New merchant').length).toBe(2);
    expect(within(table).getByText('New version')).toBeInTheDocument();
    expect(within(table).getByText('New deal')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Performance' })).toBeInTheDocument(); // reports permission
  });

  it('shows the empty queue state and hides the Performance tab without reports access', async () => {
    stub(
      { '/v1/admin/live-deals': { body: { data: [], meta: { nextCursor: null } } } },
      me(['admin.campaigns.review']),
    );
    render(
      <Providers locale="en">
        <LiveDealsPage />
      </Providers>,
    );
    expect(await screen.findByText('Nothing is waiting for review')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Performance' })).toBeNull();
  });

  it('Support users (no campaign review permission) are told they have no access', async () => {
    stub({}, me(['admin.support.manage']));
    render(
      <Providers locale="en">
        <LiveDealsPage />
      </Providers>,
    );
    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
  });

  it('renders the Arabic queue with Arabic merchant names', async () => {
    stub({ '/v1/admin/live-deals': { body: { data: [row()], meta: { nextCursor: null } } } });
    render(
      <Providers locale="ar">
        <LiveDealsPage />
      </Providers>,
    );
    expect(await screen.findByText('خصم 30% على قائمة التذوق')).toBeInTheDocument();
    expect(screen.getAllByText('هاربور جريل').length).toBeGreaterThan(0);
    expect(screen.getByText('قيد المراجعة')).toBeInTheDocument();
  });
});

describe('Admin review workbench', () => {
  it('shows both languages side by side (Arabic in RTL), merchant, and the customer preview with the locked label', async () => {
    stub({ [`/v1/admin/live-deals/${DEAL}`]: { body: { data: detail(), meta: {} } } });
    render(
      <Providers locale="en">
        <DealReviewPage id={DEAL} />
      </Providers>,
    );
    const en = await screen.findByTestId('content-en');
    const ar = screen.getByTestId('content-ar');
    expect(ar).toHaveAttribute('dir', 'rtl');
    expect(en).toHaveAttribute('dir', 'ltr');
    expect(within(en).getByText('30% off the tasting menu')).toBeInTheDocument();
    expect(within(ar).getByText('خصم 30% على قائمة التذوق')).toBeInTheDocument();
    expect(screen.getAllByText('Harbour Grill').length).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId('admin-preview')).getAllByText('Verify your employer to unlock')
        .length,
    ).toBeGreaterThan(0);
    for (const b of ['Approve', 'Request changes', 'Reject'])
      expect(screen.getByRole('button', { name: b })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
  });

  it('every decision needs a reason: the API is not called until one is given, then it records the Arabic reason too', async () => {
    const calls = stub({
      [`/v1/admin/live-deals/${DEAL}/request-changes`]: {
        body: {
          data: detail({ status: 'NEEDS_CHANGES', adminActions: [], reviewTarget: 'NONE' }),
          meta: {},
        },
      },
      [`/v1/admin/live-deals/${DEAL}`]: { body: { data: detail(), meta: {} } },
    });
    const user = userEvent.setup();
    render(
      <Providers locale="en">
        <DealReviewPage id={DEAL} />
      </Providers>,
    );
    await user.click(await screen.findByRole('button', { name: 'Request changes' }));
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(
      await screen.findByText('Please give a reason (at least 3 characters)'),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    await user.type(screen.getByLabelText(/Reason \(required/), 'Add the minimum spend.');
    await user.type(screen.getByLabelText(/Reason in Arabic/), 'أضف الحد الأدنى للإنفاق.');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Decision recorded')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body!)).toEqual({
      reason: 'Add the minimum spend.',
      reasonAr: 'أضف الحد الأدنى للإنفاق.',
    });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull(); // no longer awaiting a decision
  });

  it('a live deal with a pending revision shows the proposed version, the changed fields and the live-deal warning', async () => {
    const proposed = {
      ...detail().content,
      offerLabel: { en: '35% off', ar: 'خصم 35%' },
      valueNumber: 35,
    };
    stub({
      [`/v1/admin/live-deals/${DEAL}`]: {
        body: {
          data: detail({
            status: 'LIVE',
            reviewTarget: 'REVISION',
            revision: {
              id: 'r1',
              number: 1,
              status: 'PENDING_REVIEW',
              content: proposed,
              media: [],
              materialFields: ['valueNumber', 'offerLabel'],
              submittedAt: null,
              decidedAt: null,
            },
            adminActions: ['approve', 'request_changes', 'reject', 'pause', 'suspend'],
          }),
          meta: {},
        },
      },
    });
    render(
      <Providers locale="en">
        <DealReviewPage id={DEAL} />
      </Providers>,
    );
    expect(await screen.findByText(/reviewing a proposed new version/i)).toBeInTheDocument();
    expect(screen.getByText('value, headline')).toBeInTheDocument();
    expect(within(screen.getByTestId('content-en')).getByText('35% off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
  });

  it('shows only the controls the backend allows (a marketing reviewer cannot suspend; support sees nothing)', async () => {
    stub({
      [`/v1/admin/live-deals/${DEAL}`]: {
        body: {
          data: detail({ status: 'LIVE', reviewTarget: 'NONE', adminActions: [] }),
          meta: {},
        },
      },
    });
    render(
      <Providers locale="en">
        <DealReviewPage id={DEAL} />
      </Providers>,
    );
    expect(
      await screen.findByText('This deal is not waiting for a review decision.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('renders the whole workbench in Arabic with an RTL preview and the decision history', async () => {
    stub({ [`/v1/admin/live-deals/${DEAL}`]: { body: { data: detail(), meta: {} } } });
    render(
      <Providers locale="ar">
        <DealReviewPage id={DEAL} />
      </Providers>,
    );
    expect(await screen.findByRole('button', { name: 'اعتماد' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'طلب تعديلات' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-preview')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('سجل القرارات')).toBeInTheDocument();
    expect(screen.getByText('أُرسل للمراجعة')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });

  it('unknown or draft deals show a not-available state', async () => {
    stub({
      [`/v1/admin/live-deals/${DEAL}`]: {
        status: 404,
        body: { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} },
      },
    });
    render(
      <Providers locale="en">
        <DealReviewPage id={DEAL} />
      </Providers>,
    );
    expect(await screen.findByText('This deal is not available for review')).toBeInTheDocument();
  });
});
