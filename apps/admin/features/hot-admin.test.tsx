import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyHotDealContent } from '@dealdash/validation';
import { Providers } from '../app/[locale]/providers';
import { HotDealsAdminPage } from './hot-deals';
import { HotReviewPage } from './hot-review';
import { ReservationToolsPage } from './reservation-tools';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/hot-deals',
  useSearchParams: () => new URLSearchParams(),
}));

const DEAL = '018f0000-0000-7000-8000-0000000000d1';
const B1 = '018f0000-0000-7000-8000-0000000000b1';
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
const OPS = [
  'admin.campaigns.review',
  'admin.campaigns.control',
  'admin.reservations.manage',
  'admin.reports.read',
];

interface Call {
  url: string;
  method: string;
  body?: string;
}
type R = { status?: number; body: unknown } | ((c: Call) => { status?: number; body: unknown });
function stub(routes: Record<string, R>, user: unknown = me(OPS)) {
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
      if (url.includes('/v1/auth/me')) return json(200, { data: user, meta: {} });
      for (const [k, r] of Object.entries(routes))
        if (url.includes(k)) {
          const res = typeof r === 'function' ? r(call) : r;
          return json(res.status ?? 200, res.body);
        }
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const row = (over: Record<string, unknown> = {}) => ({
  id: DEAL,
  status: 'PENDING_REVIEW',
  title: { en: 'Flash dinner', ar: 'عشاء سريع' },
  limitType: 'TIME_AND_QUANTITY',
  merchant: { id: 'm1', nameEn: 'Harbour Grill', nameAr: 'هاربور جريل', trustLevel: 'NEW' },
  branchCount: 2,
  totalUnits: 8,
  submittedAt: '2026-10-08T08:00:00.000Z',
  startAt: null,
  endAt: null,
  ...over,
});

const cardShape = {
  id: DEAL,
  merchantId: 'm1',
  merchantName: { en: 'Harbour Grill', ar: 'هاربور جريل' },
  merchantLogoUrl: null,
  title: { en: 'Flash dinner', ar: 'عشاء سريع' },
  offerLabel: { en: '40% off', ar: 'خصم 40%' },
  shortDescription: { en: 'Tonight only', ar: 'الليلة فقط' },
  category: null,
  imageUrl: null,
  imageAlt: { en: '', ar: '' },
  limitType: 'TIME_AND_QUANTITY',
  reservationsEnabled: true,
  startsAt: null,
  endsAt: new Date(Date.now() + 3_600_000).toISOString(),
  remaining: 4,
  remainingTotal: 8,
  soldOut: false,
  distanceMeters: null,
  nearestBranch: null,
  branchCount: 2,
  eligibility: {
    result: 'LOCKED_UNLOCKABLE',
    kind: 'EMPLOYER',
    message: { en: 'Verify your employer to unlock', ar: 'وثّق جهة عملك لفتح العرض' },
    unlockAction: 'VERIFY_EMPLOYER',
  },
  availability: 'AVAILABLE',
  serverNow: new Date().toISOString(),
  description: { en: 'Details', ar: 'تفاصيل' },
  terms: { blocks: emptyHotDealContent().terms.blocks, text: { en: 'Terms', ar: 'الشروط' } },
  media: [],
  branches: [],
  holdMinutes: 30,
  perCustomerLimit: 1,
  remainingForMe: 1,
  myReservations: [],
  restriction: null,
};

const detail = (over: Record<string, unknown> = {}) => ({
  id: DEAL,
  organizationId: 'm1',
  status: 'PENDING_REVIEW',
  version: 2,
  content: {
    ...emptyHotDealContent(),
    title: { en: 'Flash dinner', ar: 'عشاء سريع' },
    offerLabel: { en: '40% off', ar: 'خصم 40%' },
    shortDescription: { en: 'Tonight only', ar: 'الليلة فقط' },
    description: { en: 'A flash offer.', ar: 'عرض سريع.' },
    limitType: 'TIME_AND_QUANTITY',
    startAt: '2026-10-08T10:00:00.000Z',
    endAt: '2026-10-08T16:00:00.000Z',
    eligibility: { kind: 'EMPLOYER', valueRefs: ['p1'] },
    terms: {
      blocks: emptyHotDealContent().terms.blocks,
      textEn: 'Show code',
      textAr: 'اعرض الرمز',
    },
  },
  media: [],
  inventory: [
    {
      branchId: B1,
      branchName: { en: 'Olaya', ar: 'العليا' },
      branchStatus: 'ACTIVE',
      tracked: true,
      stock: { total: 5, available: 5, reserved: 0, redeemed: 0 },
      released: 0,
    },
    {
      branchId: 'b2',
      branchName: { en: 'Malqa', ar: 'الملقا' },
      branchStatus: 'ACTIVE',
      tracked: true,
      stock: { total: 3, available: 3, reserved: 0, redeemed: 0 },
      released: 0,
    },
  ],
  category: null,
  pausedBy: null,
  submittedAt: '2026-10-08T08:00:00.000Z',
  publishedAt: null,
  endedAt: null,
  createdAt: '2026-10-08T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
  translation: { complete: true, missing: [] },
  issues: [],
  guardrail: { outcome: 'MANUAL_REVIEW', reasons: ['PILOT_MANUAL_REVIEW'] },
  discoverable: { visible: false, reason: 'STATUS_NOT_PUBLIC' },
  latestDecision: null,
  allowedActions: [],
  serverNow: new Date().toISOString(),
  merchant: {
    id: 'm1',
    nameEn: 'Harbour Grill',
    nameAr: 'هاربور جريل',
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
      reason: 'PILOT_MANUAL_REVIEW',
      reasonAr: null,
      fields: [],
      actorRole: 'MERCHANT_OWNER',
      actorName: 'Owner',
      byDealDash: false,
      createdAt: '2026-10-08T08:00:00.000Z',
    },
  ],
  preview: cardShape,
  reviewTarget: 'DEAL',
  adminActions: ['approve', 'request_changes', 'reject', 'pause', 'suspend'],
  reservationRules: {
    reservationsEnabled: true,
    perCustomerLimit: 1,
    holdMinutes: 30,
    maxActivePerCustomer: 3,
    noShowThreshold: 3,
    noShowBlockDays: 7,
  },
  ...over,
});

const monitor = {
  status: 'PENDING_REVIEW',
  startAt: null,
  endAt: null,
  serverNow: new Date().toISOString(),
  totals: { total: 8, available: 8, reserved: 0, redeemed: 0 },
  inventory: [],
  reservations: { held: 0, redeemed: 0, expired: 0, cancelled: 0, expiringSoon: 0 },
  funnel: {
    impressions: 0,
    detailViews: 0,
    reservationsCreated: 0,
    reservationsCancelled: 0,
    reservationsExpired: 0,
    redeemed: 0,
    notCompleted: 0,
    viewToReservationPct: null,
    reservationToRedeemedPct: null,
  },
  disclaimerKey: 'discovery_and_reservation_signals_only',
};

describe('Admin Exclusive Deal queue and monitor', () => {
  it('lists the review queue with merchant and units', async () => {
    stub({ '/v1/admin/hot-deals': { body: { data: [row()], meta: { nextCursor: null } } } });
    render(
      <Providers locale="en">
        <HotDealsAdminPage />
      </Providers>,
    );
    const r = await screen.findByTestId('admin-hot-row');
    expect(within(r).getByText('Flash dinner')).toHaveAttribute('href', `/en/hot-deals/${DEAL}`);
    expect(within(r).getByText('Harbour Grill')).toBeInTheDocument();
    expect(within(r).getByText('8')).toBeInTheDocument();
  });

  it('live monitor shows status counts, 24h reservation activity, restrictions and no revenue', async () => {
    stub({
      '/overview': {
        body: {
          data: {
            counts: { LIVE: 3, SOLD_OUT: 1, PENDING_REVIEW: 2, PAUSED: 0, SUSPENDED: 1 },
            last24h: { reservationsCreated: 12, redeemed: 7, notCompleted: 3, cancelled: 2 },
            heldNow: 4,
            activeRestrictions: 1,
            liveDeals: [
              { ...row({ status: 'LIVE' }), availableUnits: 2, reservedUnits: 1, redeemedUnits: 5 },
            ],
          },
          meta: {},
        },
      },
      '/v1/admin/hot-deals': { body: { data: [], meta: { nextCursor: null } } },
    });
    render(
      <Providers locale="en">
        <HotDealsAdminPage />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Live monitor' }));
    const m = await screen.findByTestId('admin-hot-monitor');
    expect(within(m).getByTestId('k-live')).toHaveTextContent('3');
    expect(within(m).getByTestId('k-created')).toHaveTextContent('12');
    expect(within(m).getByTestId('k-notcompleted')).toHaveTextContent('3');
    expect(within(m).getByTestId('k-restrictions')).toHaveTextContent('1');
    expect(
      (m.textContent ?? '').replace('DealDash does not measure sales or revenue.', ''),
    ).not.toMatch(/revenue|sales|SAR/i);
  });
});

describe('Admin Exclusive Deal review', () => {
  const routes = (d: unknown): Record<string, R> => {
    let decided = false; // after a decision the server returns the new state on every read
    return {
      '/monitor': { body: { data: monitor, meta: {} } },
      '/activity': {
        body: {
          data: [
            {
              id: 'a1',
              at: '2026-10-08T10:42:00.000Z',
              source: 'reservation',
              code: 'REDEEMED',
              note: null,
              actor: null,
              ref: 'T2X7',
            },
            {
              id: 'a2',
              at: '2026-10-08T09:55:00.000Z',
              source: 'deal',
              code: 'APPROVE',
              note: null,
              actor: 'Operations',
              ref: null,
            },
          ],
          meta: {},
        },
      },
      [`/v1/admin/hot-deals/${DEAL}`]: (c) => {
        if (c.method === 'POST') decided = true;
        return {
          body: {
            data: decided ? detail({ status: 'LIVE', adminActions: ['pause', 'suspend'] }) : d,
            meta: {},
          },
        };
      },
    };
  };

  it('shows what the reviewer must inspect: inventory per branch, reservation rules, dates, eligibility, both languages, and the customer preview', async () => {
    stub(routes(detail()));
    render(
      <Providers locale="en">
        <HotReviewPage id={DEAL} />
      </Providers>,
    );
    const page = await screen.findByTestId('hot-review');
    const rules = within(page).getByTestId('hot-rules');
    expect(within(rules).getByText('30 min')).toBeInTheDocument();
    expect(within(rules).getByText(/3 reservations not completed, 7 days/)).toBeInTheDocument();
    const inv = within(page).getByTestId('admin-inventory');
    expect(within(inv).getByText('Olaya')).toBeInTheDocument();
    expect(within(inv).getByText('Malqa')).toBeInTheDocument();
    expect(within(page).getByTestId('content-en')).toHaveTextContent('Flash dinner');
    expect(within(page).getByTestId('content-ar')).toHaveTextContent('عشاء سريع');
    expect(within(page).getByTestId('admin-preview')).toHaveTextContent(
      'Verify your employer to unlock',
    );
    expect(within(page).getByText('Submitted for review')).toBeInTheDocument();
  });

  it('shows a per-Hot-Deal activity feed of reservation events and decisions', async () => {
    stub(routes(detail()));
    render(
      <Providers locale="en">
        <HotReviewPage id={DEAL} />
      </Providers>,
    );
    const feed = await screen.findByTestId('hot-activity-feed');
    expect(await within(feed).findByText('…T2X7')).toBeInTheDocument();
    expect(within(feed).getAllByRole('listitem')).toHaveLength(2);
  });

  it('approving needs a reason, calls the API, and offers pause/suspend afterwards', async () => {
    const calls = stub(routes(detail()));
    render(
      <Providers locale="en">
        <HotReviewPage id={DEAL} />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('act-approve'));
    const reason = screen.getAllByLabelText(/Reason/)[0]!;
    await user.clear(reason);
    await user.type(reason, 'Looks right');
    await user.click(screen.getByTestId('decision-confirm'));
    await screen.findByText('Done');
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toContain(`/v1/admin/hot-deals/${DEAL}/approve`);
    expect(JSON.parse(post.body!).reason).toBe('Looks right');
    await waitFor(() => expect(screen.queryByTestId('act-approve')).toBeNull());
    expect(screen.getByTestId('act-suspend')).toBeInTheDocument();
  });

  it('Support (no review permission) cannot even open the page; a reviewer without control sees only decisions', async () => {
    stub(routes(detail()), me(['admin.reservations.manage']));
    const { unmount } = render(
      <Providers locale="en">
        <HotReviewPage id={DEAL} />
      </Providers>,
    );
    expect(await screen.findByText(/do not have access/i)).toBeInTheDocument();
    unmount();
    stub(
      routes(detail({ adminActions: ['approve', 'request_changes', 'reject'] })),
      me(['admin.campaigns.review']),
    );
    render(
      <Providers locale="en">
        <HotReviewPage id={DEAL} />
      </Providers>,
    );
    await screen.findByTestId('act-approve');
    expect(screen.queryByTestId('act-suspend')).toBeNull();
    expect(screen.queryByTestId('act-cancel')).toBeNull();
  });
});

describe('Admin reservation tools', () => {
  it('lists customer restrictions (temporary, masked number) and lifts one with a reason', async () => {
    const calls = stub({
      '/restrictions/rs1/lift': { body: { data: { id: 'rs1', status: 'LIFTED' }, meta: {} } },
      '/v1/admin/reservations/restrictions': {
        body: {
          data: [
            {
              id: 'rs1',
              status: 'ACTIVE',
              startsAt: '2026-10-07T00:00:00.000Z',
              endsAt: '2026-10-14T00:00:00.000Z',
              reason: '3 reservations not completed',
              strikes: 3,
              liftedReason: null,
              customer: { userId: 'u1', displayName: 'Layla', mobileMasked: '+966•••001' },
            },
          ],
          meta: { nextCursor: null },
        },
      },
    });
    render(
      <Providers locale="en">
        <ReservationToolsPage />
      </Providers>,
    );
    const table = await screen.findByTestId('restrictions-table');
    expect(within(table).getByText('+966•••001')).toBeInTheDocument();
    expect(table.textContent).not.toMatch(/ban|penalt/i);
    const user = userEvent.setup();
    await user.click(within(table).getByTestId('lift-open'));
    expect(screen.getByTestId('reason-confirm')).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'Customer contacted support');
    await user.click(screen.getByTestId('reason-confirm'));
    expect(await screen.findByText('Restriction lifted')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/restrictions/rs1/lift'))).toBe(
      true,
    );
  });

  it('looks up a reservation by reference; a held one can be cancelled, a used one reversed, both with a reason', async () => {
    const calls = stub({
      '/v1/admin/reservations/search': {
        body: {
          data: [
            {
              id: 'rv1',
              reference: 'DD-K7QM9T',
              status: 'HELD',
              quantity: 1,
              dealId: DEAL,
              dealTitle: { en: 'Flash dinner', ar: 'عشاء سريع' },
              organizationId: 'm1',
              branch: { en: 'Olaya', ar: 'العليا' },
              expiresAt: '2026-10-08T12:00:00.000Z',
              createdAt: '2026-10-08T11:30:00.000Z',
              redeemedAt: null,
            },
            {
              id: 'rv2',
              reference: 'DD-ZZZZZZ',
              status: 'REDEEMED',
              quantity: 1,
              dealId: DEAL,
              dealTitle: { en: 'Flash dinner', ar: 'عشاء سريع' },
              organizationId: 'm1',
              branch: { en: 'Olaya', ar: 'العليا' },
              expiresAt: '2026-10-08T12:00:00.000Z',
              createdAt: '2026-10-08T11:30:00.000Z',
              redeemedAt: '2026-10-08T11:40:00.000Z',
            },
          ],
          meta: {},
        },
      },
      '/v1/admin/reservations/rv2/redemptions': {
        body: {
          data: [
            {
              id: 'rd9',
              reference: 'RD-ABC234',
              status: 'REDEEMED',
              source: 'QR',
              redeemedAt: '2026-10-08T11:40:00.000Z',
              reversedAt: null,
              reverseReason: null,
            },
          ],
          meta: {},
        },
      },
      '/v1/admin/reservations/rv1/cancel': { body: { data: {}, meta: {} } },
      '/redemptions/rd9/reverse': { body: { data: { id: 'rd9', status: 'REVERSED' }, meta: {} } },
      '/v1/admin/reservations/restrictions': { body: { data: [], meta: { nextCursor: null } } },
    });
    render(
      <Providers locale="en">
        <ReservationToolsPage />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Find a reservation' }));
    await user.type(screen.getByLabelText('Find a reservation'), 'DD-K7QM9T');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    const found = await screen.findAllByTestId('found-reservation');
    expect(found).toHaveLength(2);
    await user.click(within(found[0]!).getByTestId('found-cancel'));
    await user.type(screen.getByLabelText(/Reason/), 'Asked by the customer');
    await user.click(screen.getByTestId('reason-confirm'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/rv1/cancel'))).toBe(true));
    await user.click(await screen.findByTestId('found-reverse'));
    await user.type(screen.getByLabelText(/Reason/), 'Scanned in error');
    await user.click(screen.getByTestId('reason-confirm'));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/redemptions/rd9/reverse'))).toBe(true),
    );
  });
});
