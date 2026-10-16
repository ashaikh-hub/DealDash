import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyHotDealContent } from '@dealdash/validation';
import { Providers } from '../app/[locale]/providers';
import { HotDealBuilder } from './hot-builder';
import { HotDealDetail } from './hot-detail';
import { HotDealsHub } from './hot-hub';
import { RedemptionsPage } from './redemptions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/deals/hot',
  useSearchParams: () => new URLSearchParams(),
}));

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const DEAL = '018f0000-0000-7000-8000-0000000000d1';
const B1 = '018f0000-0000-7000-8000-0000000000b1';
const B2 = '018f0000-0000-7000-8000-0000000000b2';
const CAT = '018f0000-0000-7000-8000-0000000000c1';

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
const ALL = [
  'merchant.deals.read',
  'merchant.deals.manage',
  'merchant.branch.read',
  'merchant.redemptions.read',
  'merchant.redemptions.reverse',
];

interface Call {
  url: string;
  method: string;
  body?: string;
}
type R = { status?: number; body: unknown } | ((c: Call) => { status?: number; body: unknown });
function stub(routes: Record<string, R>, user: unknown = me(ALL)) {
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
      for (const [key, r] of Object.entries(routes))
        if (url.includes(key)) {
          const res = typeof r === 'function' ? r(call) : r;
          return json(res.status ?? 200, res.body);
        }
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const choices = {
  data: {
    categories: [{ id: CAT, code: 'dining', nameEn: 'Dining', nameAr: 'المطاعم' }],
    eligibility: { employers: [], banks: [], schemes: [], cities: ['Riyadh'] },
  },
  meta: {},
};
const options = {
  data: {
    limits: {
      maxHours: 72,
      maxPerCustomer: 5,
      maxUnitsPerBranch: 5000,
      holdMinMinutes: 10,
      holdMaxMinutes: 120,
    },
    defaultHoldMinutes: 30,
    maxActiveReservations: 3,
  },
  meta: {},
};
const branches = {
  data: [
    { id: B1, nameEn: 'Olaya', nameAr: 'العليا', status: 'ACTIVE', city: 'Riyadh' },
    { id: B2, nameEn: 'Malqa', nameAr: 'الملقا', status: 'ACTIVE', city: 'Riyadh' },
  ],
  meta: {},
};

const inv = (branchId: string, name: string, stock: Record<string, number>) => ({
  branchId,
  branchName: { en: name, ar: name },
  branchStatus: 'ACTIVE',
  tracked: true,
  stock,
  released: 0,
});

const view = (over: Record<string, unknown> = {}) => ({
  id: DEAL,
  organizationId: ORG,
  status: 'DRAFT',
  version: 2,
  content: {
    ...emptyHotDealContent(),
    categoryId: CAT,
    mechanic: 'PERCENTAGE_OFF',
    valueNumber: 40,
    offerLabel: { en: '40% off', ar: 'خصم 40%' },
    title: { en: 'Flash dinner', ar: 'عشاء سريع' },
    shortDescription: { en: 'Tonight only', ar: 'الليلة فقط' },
    description: { en: 'A flash offer.', ar: 'عرض سريع.' },
    limitType: 'TIME_AND_QUANTITY',
    allocations: [
      { branchId: B1, units: 5 },
      { branchId: B2, units: 3 },
    ],
    startAt: '2026-10-08T10:00:00.000Z',
    endAt: '2026-10-08T16:00:00.000Z',
    terms: {
      blocks: emptyHotDealContent().terms.blocks,
      textEn: 'Show your code.',
      textAr: 'اعرض الرمز.',
    },
  },
  media: [],
  inventory: [
    inv(B1, 'Olaya', { total: 5, available: 5, reserved: 0, redeemed: 0 }),
    inv(B2, 'Malqa', { total: 3, available: 3, reserved: 0, redeemed: 0 }),
  ],
  category: null,
  pausedBy: null,
  submittedAt: null,
  publishedAt: null,
  endedAt: null,
  createdAt: '2026-10-08T00:00:00.000Z',
  updatedAt: '2026-10-08T00:00:00.000Z',
  translation: { complete: true, missing: [] },
  issues: [],
  guardrail: { outcome: 'MANUAL_REVIEW', reasons: ['PILOT_MANUAL_REVIEW'] },
  discoverable: { visible: false, reason: 'STATUS_NOT_PUBLIC' },
  latestDecision: null,
  allowedActions: ['edit', 'submit'],
  serverNow: new Date().toISOString(),
  ...over,
});

const monitor = (over: Record<string, unknown> = {}) => ({
  status: 'LIVE',
  startAt: new Date(Date.now() - 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
  serverNow: new Date().toISOString(),
  totals: { total: 8, available: 4, reserved: 2, redeemed: 2 },
  inventory: [
    inv(B1, 'Olaya', { total: 5, available: 2, reserved: 2, redeemed: 1 }),
    inv(B2, 'Malqa', { total: 3, available: 2, reserved: 0, redeemed: 1 }),
  ],
  reservations: { held: 2, redeemed: 2, expired: 1, cancelled: 1, expiringSoon: 1 },
  funnel: {
    impressions: 120,
    detailViews: 40,
    reservationsCreated: 6,
    reservationsCancelled: 1,
    reservationsExpired: 1,
    redeemed: 2,
    notCompleted: 1,
    viewToReservationPct: 15,
    reservationToRedeemedPct: 33.3,
  },
  disclaimerKey: 'discovery_and_reservation_signals_only',
  ...over,
});

describe('Exclusive Deals hub', () => {
  it('lists Exclusive Deals next to Live Deals, with stock and status, and states that reservations are free', async () => {
    stub({
      '/hot-deals': {
        body: {
          data: [
            {
              id: DEAL,
              status: 'LIVE',
              title: { en: 'Flash dinner', ar: 'عشاء سريع' },
              offerLabel: { en: '40% off', ar: 'خصم 40%' },
              limitType: 'TIME_AND_QUANTITY',
              branchCount: 2,
              startAt: null,
              endAt: null,
              imageUrl: null,
              availableUnits: 4,
              totalUnits: 8,
              reservedUnits: 2,
              redeemedUnits: 2,
              updatedAt: '2026-10-08T00:00:00.000Z',
            },
            {
              id: 'w2',
              status: 'LIVE',
              title: { en: 'Walk in pass', ar: 'تذكرة زيارة' },
              offerLabel: { en: 'Free', ar: 'مجاني' },
              limitType: 'TIME',
              branchCount: 1,
              startAt: null,
              endAt: null,
              imageUrl: null,
              availableUnits: 0,
              totalUnits: 0,
              reservedUnits: 0,
              redeemedUnits: 0,
              updatedAt: '2026-10-08T00:00:00.000Z',
            },
          ],
          meta: { nextCursor: null },
        },
      },
    });
    render(
      <Providers locale="en">
        <HotDealsHub />
      </Providers>,
    );
    const rows = await screen.findAllByTestId('hot-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('4 / 8')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Walk-in (no reservations)')).toBeInTheDocument();
    expect(screen.getByText(/Reservations are free/)).toBeInTheDocument();
    const sw = screen.getByTestId('deals-type-switch');
    expect(within(sw).getByRole('link', { name: 'Exclusive Deals' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sw).getByRole('link', { name: 'Live Deals' })).toHaveAttribute(
      'href',
      '/en/deals',
    );
  });

  it('a user without the manage permission sees no create button', async () => {
    stub(
      { '/hot-deals': { body: { data: [], meta: { nextCursor: null } } } },
      me(['merchant.deals.read']),
    );
    render(
      <Providers locale="en">
        <HotDealsHub />
      </Providers>,
    );
    expect(await screen.findByText('No Exclusive Deals yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /New Exclusive Deal/ })).toBeNull();
  });
});

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
    parties: [
      { role: 'OWNER', organizationId: ORG, requiredChecks: ['REVIEWED_TERMS', 'ACCEPT_TERMS'] },
    ],
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
describe('Exclusive Deal builder', () => {
  const routes = (v: unknown): Record<string, R> => ({
    '/commercial/case': { body: { data: readyCase('EXCLUSIVE', DEAL), meta: {} } },
    '/hot-deal-choices': { body: choices },
    '/hot-deal-options': { body: options },
    '/branches': { body: branches },
    '/preview': { status: 404, body: { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} } },
    [`/hot-deals/${DEAL}`]: { body: { data: v, meta: {} } },
  });

  it('walks the six steps of an existing draft and shows each part of the free-reservation model', async () => {
    stub(routes(view()));
    render(
      <Providers locale="en">
        <HotDealBuilder dealId={DEAL} />
      </Providers>,
    );
    const user = userEvent.setup();
    await screen.findByTestId('hot-builder');
    const stepper = screen.getByRole('navigation', { name: 'Steps' });
    for (const label of [
      'Offer',
      'Content',
      'Time & limits',
      'Branches & stock',
      'Eligibility & terms',
      'Review',
    ])
      expect(within(stepper).getByText(label)).toBeInTheDocument();
    // step 3: limit types
    await user.click(within(stepper).getByText('Time & limits'));
    expect(screen.getByText('Time only')).toBeInTheDocument();
    expect(screen.getByText('Quantity only')).toBeInTheDocument();
    expect(screen.getByLabelText('Customers reserve for free')).toBeChecked();
    expect(screen.getByLabelText(/Per customer limit/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Hold time/)).toHaveAttribute('placeholder', '30');
    // choosing "Time only" makes it a walk-in offer: no reservation fields
    await user.click(screen.getByRole('button', { name: /Time only/ }));
    expect(screen.getByLabelText('Customers reserve for free')).not.toBeChecked();
    expect(screen.queryByLabelText(/Per customer limit/)).toBeNull();
    // step 4: per-branch units
    await user.click(within(stepper).getByText('Branches & stock'));
    expect(screen.getAllByTestId('stock-row')).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/deposit|SAR 15|payment/i);
  });

  it('the review step lists what is missing in each language and links back to the step to fix it', async () => {
    stub(
      routes(
        view({
          content: { ...view().content, title: { en: 'Flash dinner', ar: '' }, allocations: [] },
        }),
      ),
    );
    render(
      <Providers locale="en">
        <HotDealBuilder dealId={DEAL} />
      </Providers>,
    );
    const user = userEvent.setup();
    await screen.findByTestId('hot-builder');
    await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByText('Review'));
    expect(screen.getByText(/Fix the items below before submitting/)).toBeInTheDocument();
    expect(screen.getAllByText(/Arabic/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Branches and units/i).length).toBeGreaterThan(0);
    // submit is refused client side while incomplete
    await user.click(screen.getByTestId('hot-submit'));
    expect(screen.getByText(/Fix the items below before submitting/)).toBeInTheDocument();
  });

  it('a LIVE Exclusive Deal locks everything that changes what customers get and says so', async () => {
    stub(
      routes(view({ status: 'LIVE', allowedActions: ['edit_minor', 'pause', 'cancel', 'stock'] })),
    );
    render(
      <Providers locale="en">
        <HotDealBuilder dealId={DEAL} />
      </Providers>,
    );
    await screen.findByTestId('hot-builder');
    expect(screen.getAllByText(/This Exclusive Deal is live/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Category/)).toBeDisabled();
    // wording is still editable
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole('navigation', { name: 'Steps' })).getByText('Content'),
    );
    expect(screen.getByLabelText(/^Title \(English\)/)).toBeEnabled();
    expect(screen.getByLabelText(/Offer label.*\(English\)/)).toBeDisabled();
  });

  it('saves a new draft through the API and reports the Arabic/English requirement', async () => {
    const calls = stub({
      '/hot-deal-choices': { body: choices },
      '/hot-deal-options': { body: options },
      '/branches': { body: branches },
      '/preview': {
        status: 404,
        body: { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} },
      },
      '/hot-deals': (c) =>
        c.method === 'POST'
          ? { status: 201, body: { data: view(), meta: {} } }
          : { body: { data: [], meta: {} } },
    });
    render(
      <Providers locale="en">
        <HotDealBuilder />
      </Providers>,
    );
    const user = userEvent.setup();
    await screen.findByTestId('hot-builder');
    await user.selectOptions(screen.getByLabelText(/Category/), CAT);
    await user.selectOptions(screen.getByLabelText(/Offer type/), 'PERCENTAGE_OFF');
    await user.type(await screen.findByLabelText(/Percent off/), '40');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/hot-deals'))).toBe(true),
    );
    const post = calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body!).content).toMatchObject({
      categoryId: CAT,
      mechanic: 'PERCENTAGE_OFF',
      valueNumber: 40,
      // phase 4: a new Exclusive Deal starts with reservations OFF (walk-in) until the merchant chooses a commitment method
      reservationsEnabled: false,
      limitType: 'TIME',
    });
  });
});

describe('Exclusive Deal live monitor', () => {
  const routes = (
    status = 'LIVE',
    actions = ['edit_minor', 'pause', 'cancel', 'stock'],
  ): Record<string, R> => ({
    '/monitor': { body: { data: monitor({ status }), meta: {} } },
    '/activity': {
      body: {
        data: [
          {
            id: 'a1',
            at: new Date().toISOString(),
            source: 'reservation',
            code: 'REDEEMED',
            note: 'QR',
            actor: null,
            ref: 'T2X7',
          },
          {
            id: 'a2',
            at: new Date().toISOString(),
            source: 'deal',
            code: 'APPROVE',
            note: null,
            actor: 'DealDash',
            ref: null,
          },
        ],
        meta: {},
      },
    },
    '/reservations': {
      body: {
        data: [
          {
            id: 'r1',
            codeLast4: 'T2X7',
            customerFirstName: 'Layla',
            quantity: 1,
            branch: { en: 'Olaya', ar: 'العليا' },
            status: 'HELD',
            cancelledBy: null,
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            createdAt: new Date().toISOString(),
            redeemedAt: null,
            canCancel: true,
            canReverse: false,
          },
          {
            id: 'r2',
            codeLast4: 'AB12',
            customerFirstName: 'Omar',
            quantity: 1,
            branch: { en: 'Malqa', ar: 'الملقا' },
            status: 'EXPIRED',
            cancelledBy: null,
            expiresAt: new Date(Date.now() - 600_000).toISOString(),
            createdAt: new Date().toISOString(),
            redeemedAt: null,
            canCancel: false,
            canReverse: false,
          },
        ],
        meta: { nextCursor: null },
      },
    },
    [`/hot-deals/${DEAL}`]: {
      body: {
        data: view({ status, allowedActions: actions, inventory: monitor().inventory }),
        meta: {},
      },
    },
  });

  it('shows status, countdown, available/reserved/used, per-branch stock and no revenue', async () => {
    stub(routes());
    render(
      <Providers locale="en">
        <HotDealDetail dealId={DEAL} />
      </Providers>,
    );
    const m = await screen.findByTestId('hot-monitor');
    expect(within(m).getByTestId('kpi-available')).toHaveTextContent('4');
    expect(within(m).getByTestId('kpi-reserved')).toHaveTextContent('2');
    expect(within(m).getByTestId('kpi-redeemed')).toHaveTextContent('2');
    expect(within(m).getByTestId('countdown')).toBeInTheDocument();
    expect(
      within(m).getByRole('img', { name: /Available 4, Reserved 2, Used 2/ }),
    ).toBeInTheDocument();
    expect(within(m).getAllByText('Olaya').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/revenue|sales|SAR|income/i);
  });

  it('reservations tab: first name and last four characters only; merchant can cancel a held one with a reason', async () => {
    const calls = stub({
      ...routes(),
      '/reservations/r1/cancel': { body: { data: {}, meta: {} } },
    });
    render(
      <Providers locale="en">
        <HotDealDetail dealId={DEAL} />
      </Providers>,
    );
    const user = userEvent.setup();
    await screen.findByTestId('hot-monitor');
    await user.click(screen.getByRole('tab', { name: 'Reservations' }));
    const rows = await screen.findAllByTestId('res-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('…T2X7')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Layla')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Not completed')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/DD1\.|\+966|@/);
    await user.click(within(rows[0]!).getByTestId('res-cancel'));
    const confirm = screen.getByTestId('confirm-reason');
    expect(confirm).toBeDisabled(); // a reason is required
    await user.type(screen.getByLabelText(/Reason/), 'Kitchen closed early');
    await user.click(confirm);
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith('/reservations/r1/cancel')),
      ).toBe(true),
    );
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/reservations/r1/cancel'))!.body!)).toEqual(
      { reason: 'Kitchen closed early' },
    );
  });

  it('results tab: measurable steps only, with the discovery/reservation caveat', async () => {
    stub(routes());
    render(
      <Providers locale="en">
        <HotDealDetail dealId={DEAL} />
      </Providers>,
    );
    const user = userEvent.setup();
    await screen.findByTestId('hot-monitor');
    await user.click(screen.getByRole('tab', { name: 'Results' }));
    const r = await screen.findByTestId('hot-results');
    expect(within(r).getByText('Seen in lists')).toBeInTheDocument();
    expect(within(r).getByText('15%')).toBeInTheDocument();
    expect(within(r).getByText(/does not measure sales or revenue/i)).toBeInTheDocument();
  });

  it('activity tab merges the campaign history and reservation events', async () => {
    stub(routes());
    render(
      <Providers locale="en">
        <HotDealDetail dealId={DEAL} />
      </Providers>,
    );
    const user = userEvent.setup();
    await screen.findByTestId('hot-monitor');
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    const a = await screen.findByTestId('hot-activity');
    expect(within(a).getByText('Used at the branch')).toBeInTheDocument();
    expect(within(a).getByText('Approved')).toBeInTheDocument();
  });

  it('add stock: only the manage permission sees the action, and removal explains the committed-units rule', async () => {
    const calls = stub({
      ...routes(),
      '/stock': { body: { data: view({ status: 'LIVE', allowedActions: [] }), meta: {} } },
    });
    render(
      <Providers locale="en">
        <HotDealDetail dealId={DEAL} />
      </Providers>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('open-stock'));
    expect(screen.getByText(/remove only units that are still available/i)).toBeInTheDocument();
    await user.click(screen.getByTestId('stock-confirm'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/stock'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/stock'))!.body!)).toMatchObject({
      branchId: B1,
      delta: 5,
    });
  });

  it('a read-only role (no manage permission) sees the monitor but none of the controls', async () => {
    stub(routes(), me(['merchant.deals.read']));
    render(
      <Providers locale="en">
        <HotDealDetail dealId={DEAL} />
      </Providers>,
    );
    await screen.findByTestId('hot-monitor');
    for (const id of ['open-stock', 'open-pause', 'open-cancel'])
      expect(screen.queryByTestId(id)).toBeNull();
  });

  it('DealDash pause is explained and cannot be resumed by the merchant', async () => {
    stub({
      ...routes('PAUSED', ['edit_minor', 'cancel', 'stock']),
      [`/hot-deals/${DEAL}`]: {
        body: {
          data: view({
            status: 'PAUSED',
            pausedBy: 'DEALDASH',
            allowedActions: ['edit_minor', 'cancel'],
          }),
          meta: {},
        },
      },
    });
    render(
      <Providers locale="en">
        <HotDealDetail dealId={DEAL} />
      </Providers>,
    );
    expect(await screen.findByText(/DealDash paused this Exclusive Deal/)).toBeInTheDocument();
    expect(screen.queryByTestId('do-resume')).toBeNull();
  });
});

describe('Redemptions page', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'rd1',
    reference: 'RD-ABC234',
    status: 'REDEEMED',
    source: 'QR',
    redeemedAt: new Date().toISOString(),
    reversedAt: null,
    reverseReason: null,
    dealId: DEAL,
    dealTitle: { en: 'Flash dinner', ar: 'عشاء سريع' },
    branch: { en: 'Olaya', ar: 'العليا' },
    quantity: 1,
    staffName: 'Khalid',
    canReverse: true,
    ...over,
  });

  it('lists redemptions; reversal needs a reason and is only offered when allowed', async () => {
    const calls = stub({
      '/redemptions/rd1/reverse': { body: { data: { id: 'rd1', status: 'REVERSED' }, meta: {} } },
      '/redemptions': {
        body: {
          data: [row(), row({ id: 'rd2', reference: 'RD-OLD999', canReverse: false })],
          meta: { nextCursor: null },
        },
      },
    });
    render(
      <Providers locale="en">
        <RedemptionsPage />
      </Providers>,
    );
    const rows = await screen.findAllByTestId('redemption-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByTestId('reverse-open')).toBeInTheDocument();
    expect(within(rows[1]!).queryByTestId('reverse-open')).toBeNull();
    const user = userEvent.setup();
    await user.click(within(rows[0]!).getByTestId('reverse-open'));
    expect(screen.getByTestId('reverse-confirm')).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'Scanned the wrong customer');
    await user.click(screen.getByTestId('reverse-confirm'));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'POST' && c.url.endsWith('/redemptions/rd1/reverse')),
      ).toBe(true),
    );
    expect(await screen.findByText('Use reversed')).toBeInTheDocument();
  });

  it('Arabic renders the same page right-to-left with Western digits', async () => {
    stub({ '/redemptions': { body: { data: [row()], meta: { nextCursor: null } } } });
    render(
      <Providers locale="ar">
        <RedemptionsPage />
      </Providers>,
    );
    expect(await screen.findByText('عمليات الاسترداد')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });
});

// ---------------------------------------------------------------- phase 4: reservation commitment (RC-20, RC-73/74, RC-80)
const resPolicy = (over: Record<string, unknown> = {}) => ({
  data: {
    market: 'SA',
    marketStatus: 'PILOT',
    currency: 'SAR',
    currencyDecimals: 2,
    freeAllowed: false,
    fields: {
      freeAllowed: null,
      allowedMethods: ['FULL_PREPAYMENT', 'DEPOSIT'],
      depositMinMinor: 500,
      depositMaxMinor: 5000,
      nonRefundableDepositAllowed: true,
      preauthMaxMinor: 10000,
      cutoffMinMinutes: 15,
      cutoffMaxMinutes: 60,
      paymentWindowMinutes: 10,
      prepaymentRefundMinPercent: 0,
      prepaymentRefundMaxPercent: 100,
      prepaymentRefundDefaultPercent: 50,
      commissionBps: 1000,
      additionalRedemptionFee: false,
      preauthImmediateCapture: false,
      preauthPartialCaptureAllowed: false,
      preauthOnRedemption: 'RELEASE',
      captureFailureAlertThreshold: 3,
    },
    source: {},
    problems: [],
    ...over,
  },
  meta: {},
});

describe('Exclusive Deal builder: reservation payment', () => {
  const routes = (policy = resPolicy()): Record<string, R> => ({
    '/commercial/case': { body: { data: readyCase('EXCLUSIVE', DEAL), meta: {} } },
    '/hot-deal-reservation-policy': { body: policy },
    '/hot-deal-choices': { body: choices },
    '/hot-deal-options': { body: options },
    '/branches': { body: branches },
    '/preview': { status: 404, body: { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} } },
    [`/hot-deals/${DEAL}`]: (c) =>
      c.method === 'PUT'
        ? { body: { data: { deal: view(), outcome: 'SAVED' }, meta: {} } }
        : { body: { data: view(), meta: {} } },
  });
  const open = async () => {
    render(
      <Providers locale="en">
        <HotDealBuilder dealId={DEAL} />
      </Providers>,
    );
    const user = userEvent.setup();
    await screen.findByTestId('hot-builder');
    await user.click(
      within(screen.getByRole('navigation', { name: 'Steps' })).getByText('Time & limits'),
    );
    return user;
  };

  it('offers only the methods the policy allows (no free method in a live market) and saves a fixed deposit', async () => {
    const calls = stub(routes());
    const user = await open();
    const editor = await screen.findByTestId('commitment-editor');
    expect(within(editor).getByTestId('commitment-FULL_PREPAYMENT')).toBeInTheDocument();
    expect(within(editor).getByTestId('commitment-DEPOSIT')).toBeInTheDocument();
    expect(within(editor).queryByTestId('commitment-FREE')).toBeNull();
    expect(within(editor).queryByTestId('commitment-CARD_PREAUTH')).toBeNull();
    await user.click(within(editor).getByTestId('commitment-DEPOSIT'));
    expect(within(editor).getByText(/Allowed: SAR\s?5\.00 to SAR\s?50\.00/)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Deposit per unit/), '15');
    // deposit treatment: three refund modes (non-refundable only where the policy permits it) and credited vs booking fee
    expect(within(editor).getByTestId('deposit-refund-BEFORE_CUTOFF')).toBeChecked();
    await user.click(within(editor).getByTestId('deposit-refund-NEVER'));
    expect(screen.getByText(/non-refundable deposit is shown to the customer/)).toBeInTheDocument();
    expect(within(editor).getByTestId('deposit-credited')).toBeChecked();
    await user.click(within(editor).getByTestId('deposit-credited'));
    await user.clear(screen.getByLabelText(/Free cancellation cut-off/));
    await user.type(screen.getByLabelText(/Free cancellation cut-off/), '30');
    expect(editor).toHaveTextContent('DealDash commission on reservation money kept for you: 10%');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = JSON.parse(calls.find((c) => c.method === 'PUT')!.body!);
    expect(body.content.commitment).toEqual({
      method: 'DEPOSIT',
      amountMinor: 1500,
      depositRefundable: false,
      depositLateRefund: false,
      depositCredited: false,
      cancelCutoffMinutes: 30,
      noShowRefundPercent: null,
    });
  });

  it('a deposit refundable on any cancellation saves both refund flags', async () => {
    const calls = stub(routes());
    const user = await open();
    const editor = await screen.findByTestId('commitment-editor');
    await user.click(within(editor).getByTestId('commitment-DEPOSIT'));
    await user.type(screen.getByLabelText(/Deposit per unit/), '15');
    await user.click(within(editor).getByTestId('deposit-refund-ANY'));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = JSON.parse(calls.find((c) => c.method === 'PUT')!.body!);
    expect(body.content.commitment).toMatchObject({
      method: 'DEPOSIT',
      depositRefundable: true,
      depositLateRefund: true,
      depositCredited: true,
    });
  });

  it('a deposit can be set as a share of the price; turning reservations off hides the payment set-up', async () => {
    stub(routes());
    const user = await open();
    const editor = await screen.findByTestId('commitment-editor');
    await user.click(within(editor).getByTestId('commitment-DEPOSIT'));
    await user.click(screen.getByLabelText('A share of the price'));
    await user.type(screen.getByLabelText(/Full price per unit/), '50');
    await user.type(screen.getByLabelText(/Deposit share/), '20');
    expect(editor).toHaveTextContent(/Deposit per unit: SAR\s?10\.00/);
    await user.click(screen.getByLabelText('Customers reserve for free'));
    expect(screen.queryByTestId('commitment-editor')).toBeNull();
    expect(screen.getByTestId('reservations-off-note')).toBeInTheDocument();
  });

  it('a reservable deal without a method is listed as incomplete on the review step (RC-21)', async () => {
    stub(routes());
    const user = await open();
    await screen.findByTestId('commitment-editor');
    await user.click(within(screen.getByRole('navigation', { name: 'Steps' })).getByText('Review'));
    expect(
      await screen.findByText(/Choose how customers commit to a reservation/),
    ).toBeInTheDocument();
  });
});

describe('Exclusive Deal reservations: payments (RC-80)', () => {
  const paidRow = (over: Record<string, unknown>, money: Record<string, unknown>) => ({
    id: 'p1',
    codeLast4: 'PY11',
    customerFirstName: 'Sara',
    quantity: 1,
    branch: { en: 'Olaya', ar: 'العليا' },
    status: 'REDEEMED',
    cancelledBy: null,
    expiresAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    redeemedAt: new Date().toISOString(),
    canCancel: false,
    canReverse: false,
    ...over,
    money: {
      method: 'FULL_PREPAYMENT',
      paymentStatus: 'PAID',
      amountMinor: 5000,
      currency: 'SAR',
      refundedMinor: 0,
      refundPendingMinor: 0,
      keptMinor: 5000,
      feeMinor: 500,
      netToMerchantMinor: 4500,
      additionalFeeAllowed: false,
      redemptionFeeMinor: 0,
      authorisation: null,
      ...money,
    },
  });

  it('totals collected, refunded, kept, commission and net; a row opens its payment details', async () => {
    stub({
      '/monitor': { body: { data: monitor(), meta: {} } },
      '/activity': { body: { data: [], meta: {} } },
      '/reservations': {
        body: {
          data: [
            paidRow({}, {}),
            paidRow(
              { id: 'p2', codeLast4: 'PY22', status: 'CANCELLED', redeemedAt: null },
              {
                method: 'DEPOSIT',
                paymentStatus: 'REFUNDED',
                amountMinor: 1000,
                refundedMinor: 1000,
                keptMinor: 0,
                feeMinor: 0,
                netToMerchantMinor: 0,
                redemptionFeeMinor: null,
              },
            ),
            paidRow(
              { id: 'p3', codeLast4: 'PY33', status: 'HELD', redeemedAt: null },
              {
                method: 'CARD_PREAUTH',
                paymentStatus: 'AUTHORISED',
                amountMinor: 2000,
                keptMinor: null,
                feeMinor: null,
                netToMerchantMinor: null,
                redemptionFeeMinor: null,
                authorisation: {
                  status: 'AUTHORISED',
                  amountMinor: 2000,
                  capturedMinor: 0,
                  releasedMinor: 0,
                  authorisedAt: new Date().toISOString(),
                  expiresAt: null,
                  capturedAt: null,
                  releasedAt: null,
                },
              },
            ),
          ],
          meta: { nextCursor: null },
        },
      },
      [`/hot-deals/${DEAL}`]: {
        body: { data: view({ status: 'LIVE', inventory: monitor().inventory }), meta: {} },
      },
    });
    render(
      <Providers locale="en">
        <HotDealDetail dealId={DEAL} />
      </Providers>,
    );
    const user = userEvent.setup();
    await screen.findByTestId('hot-monitor');
    await user.click(screen.getByRole('tab', { name: 'Reservations' }));
    const sum = await screen.findByTestId('res-money-summary');
    // collected: the paid 50 and the refunded deposit 10 (a card hold is not collected money)
    expect(within(sum).getByTestId('fin-collected')).toHaveTextContent(/60\.00/);
    expect(within(sum).getByTestId('fin-refunded')).toHaveTextContent(/10\.00/);
    expect(within(sum).getByTestId('fin-kept')).toHaveTextContent(/50\.00/);
    expect(within(sum).getByTestId('fin-fee')).toHaveTextContent(/5\.00/);
    expect(within(sum).getByTestId('fin-net')).toHaveTextContent(/45\.00/);
    expect(within(sum).getByTestId('fin-holds')).toHaveTextContent(/20\.00/);
    const rows = screen.getAllByTestId('res-row');
    expect(within(rows[2]!).getByTestId('res-money')).toHaveTextContent('Card hold active');
    expect(within(rows[1]!).getByText('Cancelled')).toBeInTheDocument();
    await user.click(within(rows[0]!).getByRole('button', { name: /SAR/ }));
    const details = screen.getByTestId('res-money-details');
    expect(within(details).getByTestId('detail-net')).toHaveTextContent(/45\.00/);
    // one fee per transaction: the paid reservation's commission is the only DealDash fee
    expect(within(details).getByTestId('detail-redemption-fee')).toHaveTextContent(
      'Not charged: the reservation commission is the only fee',
    );
  });
});
