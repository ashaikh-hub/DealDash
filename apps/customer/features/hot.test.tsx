import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { HotDealPage, HotListPage, HotRail, MyDealsPage, ReservationPage } from './hot';

const nav = vi.hoisted(() => ({ push: vi.fn(), params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/en/hot/x',
}));

const DEAL = '018f0000-0000-7000-8000-0000000000e1';
const BR1 = '018f0000-0000-7000-8000-0000000000b1';
const BR2 = '018f0000-0000-7000-8000-0000000000b2';
const RES = '018f0000-0000-7000-8000-0000000000f1';
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const customer = {
  id: '018f0000-0000-7000-8000-000000000001',
  userType: 'CUSTOMER',
  displayName: 'Layla',
  locale: 'en',
  audience: 'customer',
  mfaVerified: true,
  mfaRequired: false,
  csrfToken: 'csrf',
  activeMembership: null,
  memberships: [],
  permissions: ['customer.profile.read', 'customer.reservations.manage'],
};

const card = (over: Record<string, unknown> = {}) => ({
  id: DEAL,
  merchantId: '018f0000-0000-7000-8000-0000000000aa',
  merchantName: { en: 'Najd Kitchen', ar: 'نجد كيتشن' },
  merchantLogoUrl: null,
  title: { en: 'Lunch rush: 40% off kabsa', ar: 'ذروة الغداء: خصم 40% على الكبسة' },
  offerLabel: { en: '40% off', ar: 'خصم 40%' },
  shortDescription: { en: 'Family platter today', ar: 'طبق عائلي اليوم' },
  category: { code: 'dining', name: { en: 'Dining', ar: 'المطاعم' } },
  imageUrl: null,
  imageAlt: { en: 'Platter', ar: 'طبق' },
  limitType: 'TIME_AND_QUANTITY',
  reservationsEnabled: true,
  startsAt: inMin(-60),
  endsAt: inMin(135),
  remaining: 3,
  remainingTotal: 5,
  soldOut: false,
  distanceMeters: 640,
  nearestBranch: {
    id: BR1,
    name: { en: 'Al Nakheel', ar: 'النخيل' },
    area: { en: 'Riyadh', ar: 'الرياض' },
    latitude: 24.7,
    longitude: 46.7,
  },
  branchCount: 2,
  eligibility: { result: 'ELIGIBLE', kind: 'PUBLIC', message: null, unlockAction: null },
  availability: 'AVAILABLE',
  serverNow: new Date().toISOString(),
  ...over,
});

const branch = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name: { en: name, ar: name },
  address: { en: 'Riyadh', ar: 'الرياض' },
  city: 'Riyadh',
  latitude: 24.7,
  longitude: 46.7,
  phone: '+966110000001',
  hours: null,
  distanceMeters: 640,
  stock: { available: 3, total: 12 },
  canReserve: true,
  blockedReason: null,
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  ...card(),
  description: { en: 'A family kabsa platter at 40% off.', ar: 'طبق كبسة عائلي بخصم 40%.' },
  terms: {
    blocks: {
      fullPriceItemsOnly: false,
      notCombinable: false,
      minimumSpendHalalas: null,
      validDays: [],
      validFrom: null,
      validTo: null,
    },
    text: { en: 'Show your code at the counter.', ar: 'اعرض الرمز عند الكاشير.' },
  },
  media: [],
  branches: [
    branch(BR1, 'Al Nakheel'),
    branch(BR2, 'Hittin', { distanceMeters: 4100, stock: { available: 2, total: 8 } }),
  ],
  holdMinutes: 30,
  perCustomerLimit: 1,
  remainingForMe: 1,
  myReservations: [],
  restriction: null,
  ...over,
});

const reservation = (over: Record<string, unknown> = {}) => ({
  id: RES,
  publicRef: 'DD-K7QM9T',
  status: 'HELD',
  displayState: 'HELD',
  quantity: 1,
  holdMinutes: 30,
  createdAt: inMin(-2),
  expiresAt: inMin(28),
  redeemedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  serverNow: new Date().toISOString(),
  canCancel: true,
  deal: {
    id: DEAL,
    title: { en: 'Lunch rush: 40% off kabsa', ar: 'ذروة الغداء: خصم 40% على الكبسة' },
    offerLabel: { en: '40% off', ar: 'خصم 40%' },
    imageUrl: null,
    merchantName: { en: 'Najd Kitchen', ar: 'نجد كيتشن' },
    merchantId: 'm1',
  },
  branch: {
    id: BR1,
    name: { en: 'Al Nakheel', ar: 'النخيل' },
    address: { en: 'Al Nakheel, Riyadh', ar: 'النخيل، الرياض' },
    latitude: 24.7,
    longitude: 46.7,
    phone: '+966110000001',
  },
  code: { qr: 'DD1.AbCdEfGhIjKlMnOpQrStUv', manual: 'K7QM-9T2X' },
  ...over,
});

interface Call {
  url: string;
  method: string;
  body?: string;
  key?: string | null;
}
type Routes = Record<
  string,
  { status?: number; body: unknown } | ((c: Call) => { status?: number; body: unknown })
>;
function stub(routes: Routes, user: unknown | null = customer) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
        key: headers['Idempotency-Key'] ?? null,
      };
      calls.push(call);
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me'))
        return user
          ? json(200, { data: user, meta: {} })
          : json(401, { errors: [{ code: 'AUTH_REQUIRED', message: 'x' }], meta: {} });
      for (const [key, r] of Object.entries(routes))
        if (url.includes(key)) {
          const res = typeof r === 'function' ? r(call) : r;
          return json(res.status ?? 200, res.body);
        }
      if (url.includes('/v1/app/notifications'))
        return json(200, { data: { unread: 0, items: [] }, meta: {} });
      return json(202, { data: { accepted: 1 }, meta: {} });
    }),
  );
  return calls;
}

beforeEach(() => {
  nav.push.mockClear();
  nav.params = new URLSearchParams();
});
afterEach(() => vi.unstubAllGlobals());

const mount = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') =>
  render(<Providers locale={locale}>{ui}</Providers>);

describe('Exclusive Deal detail', () => {
  it('shows urgency (countdown, units left), the free promise, and never anything about payment', async () => {
    stub({ '/v1/app/hot-deals/': { body: { data: detail(), meta: {} } } }, null);
    mount(<HotDealPage id={DEAL} />);
    expect(await screen.findByText('Lunch rush: 40% off kabsa')).toBeInTheDocument();
    expect(screen.getByTestId('hot-timer')).toBeInTheDocument();
    expect(screen.getByTestId('countdown')).toHaveTextContent(/\d+h \d+m/);
    expect(screen.getByTestId('hot-remaining-total')).toHaveTextContent('5');
    expect(screen.getAllByText('Free to reserve').length).toBeGreaterThan(0);
    expect(screen.getByText(/Hold for 30 minutes/)).toBeInTheDocument();
    const text = document.body.textContent!.toLowerCase();
    for (const w of ['deposit', 'sar 15', 'pay now', 'checkout', 'card number'])
      expect(text).not.toContain(w);
    // guests are asked to sign in; nothing is reserved yet
    expect(screen.getByTestId('hot-signin')).toBeInTheDocument();
  });

  it('shows per-branch stock when it is low and the sold-out branch as unavailable', async () => {
    stub({
      '/v1/app/hot-deals/': {
        body: {
          data: detail({
            branches: [
              branch(BR1, 'Al Nakheel', {
                canReserve: false,
                blockedReason: 'SOLD_OUT',
                stock: null,
              }),
              branch(BR2, 'Hittin'),
            ],
          }),
          meta: {},
        },
      },
    });
    mount(<HotDealPage id={DEAL} />);
    await screen.findByText('Lunch rush: 40% off kabsa');
    const rows = screen.getAllByTestId('hot-branch');
    expect(within(rows[0]!).getByText('Sold out here')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('3 left here')).toBeInTheDocument();
  });

  it('reserves for free: choose a branch, confirm, one POST with an Idempotency-Key, then the ticket page', async () => {
    const calls = stub({
      '/v1/app/hot-deals/': (c) =>
        c.method === 'POST'
          ? { status: 201, body: { data: reservation({ branch: reservation().branch }), meta: {} } }
          : { body: { data: detail(), meta: {} } },
    });
    mount(<HotDealPage id={DEAL} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('hot-reserve'));
    const sheet = await screen.findByTestId('reserve-sheet');
    expect(within(sheet).getByText(/It is free/)).toBeInTheDocument();
    await user.click(within(sheet).getByLabelText(/Hittin/));
    await user.click(within(sheet).getByTestId('reserve-confirm'));
    await waitFor(() => expect(nav.push).toHaveBeenCalled(), { timeout: 5000 });
    expect(nav.push.mock.calls[0]![0]).toBe(`/en/reservations/${RES}?new=1`);
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/hot-deals/'))!;
    expect(post.url).toContain(`/v1/app/hot-deals/${DEAL}/reservations`);
    expect(JSON.parse(post.body!)).toEqual({ branchId: BR2, quantity: 1 });
    expect(post.key).toMatch(/.{8,}/);
  });

  it('a lost race shows a calm message inside the sheet and refreshes the numbers behind it', async () => {
    const calls = stub({
      '/v1/app/hot-deals/': (c) =>
        c.method === 'POST'
          ? { status: 409, body: { errors: [{ code: 'OUT_OF_STOCK', message: 'x' }], meta: {} } }
          : { body: { data: detail(), meta: {} } },
    });
    mount(<HotDealPage id={DEAL} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('hot-reserve'));
    await user.click(
      within(await screen.findByTestId('reserve-sheet')).getByTestId('reserve-confirm'),
    );
    expect(await screen.findByText('Sorry, this offer just sold out here.')).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
    expect(
      calls.filter((c) => c.method === 'GET' && c.url.includes('/hot-deals/')).length,
    ).toBeGreaterThan(1);
  });

  it('a lost connection says so (no false success)', async () => {
    stub({
      '/v1/app/hot-deals/': (c) => {
        if (c.method === 'POST') throw new TypeError('offline');
        return { body: { data: detail(), meta: {} } };
      },
    });
    mount(<HotDealPage id={DEAL} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('hot-reserve'));
    await user.click(
      within(await screen.findByTestId('reserve-sheet')).getByTestId('reserve-confirm'),
    );
    expect(await screen.findByText(/No connection/)).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('sold out: the action is disabled and explains why; the deal stays visible', async () => {
    stub({
      '/v1/app/hot-deals/': {
        body: {
          data: detail({
            soldOut: true,
            availability: 'SOLD_OUT',
            remaining: 0,
            remainingTotal: 0,
            branches: [
              branch(BR1, 'Al Nakheel', {
                canReserve: false,
                blockedReason: 'SOLD_OUT',
                stock: null,
              }),
            ],
          }),
          meta: {},
        },
      },
    });
    mount(<HotDealPage id={DEAL} />);
    await screen.findByText('Lunch rush: 40% off kabsa');
    expect(screen.getByRole('button', { name: 'Sold out' })).toBeDisabled();
    expect(screen.getByText(/All units are reserved or used/)).toBeInTheDocument();
  });

  it('locked offers explain how to unlock; hidden-for-good offers return a not-available page', async () => {
    stub({
      '/v1/app/hot-deals/': {
        body: {
          data: detail({
            eligibility: {
              result: 'LOCKED_UNLOCKABLE',
              kind: 'EMPLOYER',
              message: { en: 'Verify your employer to unlock', ar: 'وثّق جهة عملك لفتح العرض' },
              unlockAction: 'VERIFY_EMPLOYER',
            },
          }),
          meta: {},
        },
      },
    });
    const { unmount } = mount(<HotDealPage id={DEAL} />);
    expect(await screen.findAllByText('Verify your employer to unlock')).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Unlock to reserve' })).toBeInTheDocument();
    unmount();
    stub({
      '/v1/app/hot-deals/': {
        status: 404,
        body: { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} },
      },
    });
    mount(<HotDealPage id={DEAL} />);
    expect(await screen.findByText('This Exclusive Deal is not available any more')).toBeInTheDocument();
  });

  it('a temporarily restricted customer sees a neutral explanation and a disabled button', async () => {
    stub({
      '/v1/app/hot-deals/': {
        body: { data: detail({ restriction: { endsAt: inMin(60 * 24 * 3) } }), meta: {} },
      },
    });
    mount(<HotDealPage id={DEAL} />);
    expect(
      await screen.findByText(/New reservations are paused for your account until/),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bban(ned)?\b|penalt|blacklist|no-show/i);
    expect(screen.getByRole('button', { name: 'Reserve for free' })).toBeDisabled();
  });

  it('an existing reservation turns the action into "View my reservation"', async () => {
    stub({
      '/v1/app/hot-deals/': {
        body: {
          data: detail({
            myReservations: [
              { id: RES, status: 'HELD', quantity: 1, branchId: BR1, expiresAt: inMin(20) },
            ],
            remainingForMe: 0,
          }),
          meta: {},
        },
      },
    });
    mount(<HotDealPage id={DEAL} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('hot-view-mine'));
    expect(nav.push).toHaveBeenCalledWith(`/en/reservations/${RES}`);
  });

  it('walk-in offers have no reserve button, no code and no stock', async () => {
    stub({
      '/v1/app/hot-deals/': {
        body: {
          data: detail({
            reservationsEnabled: false,
            limitType: 'TIME',
            remaining: null,
            remainingTotal: null,
            branches: [branch(BR1, 'Al Nakheel', { canReserve: false, stock: null })],
          }),
          meta: {},
        },
      },
    });
    mount(<HotDealPage id={DEAL} />);
    await screen.findByText('Lunch rush: 40% off kabsa');
    expect(screen.queryByTestId('hot-reserve')).toBeNull();
    expect(screen.getAllByText('Walk in, no reservation').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Get directions' })).toBeInTheDocument();
  });

  it('Arabic: right-to-left strings, Western digits, and the same urgency', async () => {
    stub({ '/v1/app/hot-deals/': { body: { data: detail(), meta: {} } } });
    mount(<HotDealPage id={DEAL} />, 'ar');
    expect(await screen.findByText('ذروة الغداء: خصم 40% على الكبسة')).toBeInTheDocument();
    expect(screen.getAllByText('الحجز مجاني').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });
});

describe('Exclusive Deals lists', () => {
  it('home rail: card with countdown and "Only N left"; the rail is absent when nothing is hot', async () => {
    stub({
      '/v1/app/hot-deals': { body: { data: [card({ remaining: 3 })], meta: { nextCursor: null } } },
    });
    const { unmount } = mount(<HotRail />);
    const rail = await screen.findByTestId('hot-rail');
    expect(within(rail).getByText('Only 3 left')).toBeInTheDocument();
    expect(within(rail).getByTestId('countdown')).toBeInTheDocument();
    expect(within(rail).getByRole('link', { name: 'Lunch rush: 40% off kabsa' })).toHaveAttribute(
      'href',
      `/en/hot/${DEAL}`,
    );
    unmount();
    stub({ '/v1/app/hot-deals': { body: { data: [], meta: { nextCursor: null } } } });
    mount(<HotRail />);
    await waitFor(() => expect(screen.queryByTestId('hot-rail')).toBeNull());
  });

  it('list page: sold-out cards are marked, sort chips reload the list', async () => {
    const calls = stub({
      '/v1/app/hot-deals': {
        body: {
          data: [
            card(),
            card({
              id: 'x2',
              title: { en: 'Gone', ar: 'نفد' },
              soldOut: true,
              availability: 'SOLD_OUT',
              remaining: null,
            }),
          ],
          meta: { nextCursor: null },
        },
      },
    });
    mount(<HotListPage />);
    expect(await screen.findByText('Gone')).toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Newest' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('sort=newest'))).toBe(true));
  });
});

describe('Reservation ticket and My Deals', () => {
  it('the ticket shows a QR, the manual code and a server-based timer; confirmation message on a new reservation', async () => {
    nav.params = new URLSearchParams('new=1');
    stub({ '/v1/app/reservations/': { body: { data: reservation(), meta: {} } } });
    mount(<ReservationPage id={RES} />);
    const ticket = await screen.findByTestId('reservation-ticket');
    expect(
      within(ticket).getByRole('img', { name: 'QR code for your reservation' }),
    ).toBeInTheDocument();
    expect(within(ticket).getByTestId('manual-code')).toHaveTextContent('K7QM-9T2X');
    expect(within(ticket).getByTestId('ticket-timer')).toHaveTextContent(/\d+m \d+s/);
    expect(screen.getByText('Reservation confirmed')).toBeInTheDocument();
    expect(within(ticket).getByText('DD-K7QM9T')).toBeInTheDocument();
    expect(document.body.textContent!.toLowerCase()).not.toMatch(/deposit|payment|sar/);
  });

  it('cancelling asks first, calls the API, and then shows the cancelled state without a code', async () => {
    const calls = stub({
      '/cancel': () => ({
        body: {
          data: reservation({
            status: 'CANCELLED',
            displayState: 'CANCELLED_BY_YOU',
            canCancel: false,
            code: null,
            cancelledBy: 'CUSTOMER',
            cancelledAt: new Date().toISOString(),
          }),
          meta: {},
        },
      }),
      '/v1/app/reservations/': { body: { data: reservation(), meta: {} } },
    });
    mount(<ReservationPage id={RES} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('ticket-cancel'));
    expect(screen.getByText('Cancel this reservation?')).toBeInTheDocument();
    await user.click(screen.getByTestId('ticket-cancel-yes'));
    expect(await screen.findByText('Cancelled by you')).toBeInTheDocument();
    expect(screen.queryByTestId('manual-code')).toBeNull();
    expect(
      calls.some(
        (c) => c.method === 'POST' && c.url.endsWith(`/v1/app/reservations/${RES}/cancel`),
      ),
    ).toBe(true);
  });

  it('an unused reservation reads "Reservation not completed" (neutral wording) and offers to reserve again', async () => {
    stub({
      '/v1/app/reservations/': {
        body: {
          data: reservation({
            status: 'EXPIRED',
            displayState: 'NOT_COMPLETED',
            canCancel: false,
            code: null,
            expiresAt: inMin(-5),
          }),
          meta: {},
        },
      },
    });
    mount(<ReservationPage id={RES} />);
    const ticket = await screen.findByTestId('reservation-ticket');
    expect(within(ticket).getAllByText('Reservation not completed').length).toBeGreaterThan(0);
    expect(within(ticket).getByRole('link', { name: 'Reserve again' })).toHaveAttribute(
      'href',
      `/en/hot/${DEAL}`,
    );
    expect(ticket.textContent).not.toMatch(/no-show|penalt|ban/i);
  });

  it('when staff redeem it while the customer watches, the ticket turns into "Used"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let used = false;
    stub({
      '/v1/app/reservations/': () => ({
        body: {
          data: used
            ? reservation({
                status: 'REDEEMED',
                displayState: 'REDEEMED',
                canCancel: false,
                code: null,
                redeemedAt: new Date().toISOString(),
              })
            : reservation(),
          meta: {},
        },
      }),
    });
    mount(<ReservationPage id={RES} />);
    await screen.findByTestId('manual-code');
    used = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(await screen.findByText(/Used on/)).toBeInTheDocument();
    expect(screen.queryByTestId('manual-code')).toBeNull();
    vi.useRealTimers();
  });

  it('My Deals: active and past tabs, with sign-in for guests', async () => {
    nav.params = new URLSearchParams('tab=active');
    stub({ '/v1/app/reservations': { body: { data: [reservation()], meta: {} } } });
    const { unmount } = mount(<MyDealsPage />);
    const row = await screen.findByTestId('reservation-row');
    expect(within(row).getByText('Reserved')).toBeInTheDocument();
    expect(row).toHaveAttribute('href', `/en/reservations/${RES}`);
    unmount();
    stub({}, null);
    mount(<MyDealsPage />);
    expect(await screen.findByText('Sign in to see your reservations')).toBeInTheDocument();
  });

  it('Updates tab lists in-app notifications in the customer’s language', async () => {
    nav.params = new URLSearchParams('tab=updates');
    stub({
      '/v1/app/notifications': {
        body: {
          data: {
            unread: 1,
            items: [
              {
                id: 'n1',
                type: 'REDEMPTION_SUCCESS',
                data: {
                  reservationId: RES,
                  dealTitleEn: 'Lunch rush',
                  dealTitleAr: 'ذروة الغداء',
                  merchantNameEn: 'Najd Kitchen',
                  merchantNameAr: 'نجد كيتشن',
                },
                createdAt: new Date().toISOString(),
                readAt: null,
              },
            ],
          },
          meta: {},
        },
      },
    });
    mount(<MyDealsPage />, 'ar');
    expect(await screen.findByText('تم الاستخدام لدى نجد كيتشن: ذروة الغداء')).toBeInTheDocument();
  });
});
