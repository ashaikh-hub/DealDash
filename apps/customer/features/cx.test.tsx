import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { ExplorePage } from './explore';
import { HomePage } from './home';
import { HotDealPage, MyDealsPage, ReservationPage, ReservationReturnPage } from './hot';
import { MerchantPageView, ProfilePage } from './screens';

/** Customer experience gap closure (2026-10-16): entry, browse by, merchant page, deal detail, pay summary, ticket, My Deals. */
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), params: new URLSearchParams() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/en',
}));

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const DEAL = '018f0000-0000-7000-8000-0000000000e1';
const BR = '018f0000-0000-7000-8000-0000000000b1';
const RES = '018f0000-0000-7000-8000-0000000000f1';
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const bi = (en: string, ar: string) => ({ en, ar });

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
  permissions: ['customer.profile.read', 'customer.reservations.manage', 'customer.saved.manage'],
};

interface Call {
  url: string;
  method: string;
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
      const call = { url, method: init?.method ?? 'GET' };
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
      return json(200, { data: [], meta: { nextCursor: null } });
    }),
  );
  return calls;
}
const ok = (data: unknown) => ({ body: { data, meta: { nextCursor: null } } });
const mount = (ui: React.ReactNode, locale: 'en' | 'ar' | 'ur' = 'en') =>
  render(<Providers locale={locale}>{ui}</Providers>);

beforeEach(() => {
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

const eligibility = { result: 'ELIGIBLE', kind: 'PUBLIC', message: null, unlockAction: null };
const hotCard = (over: Record<string, unknown> = {}) => ({
  id: DEAL,
  merchantId: ORG,
  merchantName: bi('Najd Kitchen', 'نجد كيتشن'),
  merchantLogoUrl: null,
  title: bi('Lunch rush: 40% off kabsa', 'ذروة الغداء'),
  offerLabel: bi('40% off', 'خصم 40%'),
  shortDescription: bi('Family platter', 'طبق عائلي'),
  category: { code: 'dining', name: bi('Dining', 'المطاعم') },
  imageUrl: null,
  imageAlt: bi('Platter', 'طبق'),
  limitType: 'TIME_AND_QUANTITY',
  reservationsEnabled: true,
  startsAt: inMin(-60),
  endsAt: inMin(120),
  remaining: 3,
  remainingTotal: 3,
  soldOut: false,
  distanceMeters: 640,
  nearestBranch: {
    id: BR,
    name: bi('Al Nakheel', 'النخيل'),
    area: bi('Riyadh', 'الرياض'),
    latitude: 24.7,
    longitude: 46.7,
  },
  branchCount: 1,
  eligibility,
  availability: 'AVAILABLE',
  serverNow: new Date().toISOString(),
  ...over,
});
const branch = {
  id: BR,
  name: bi('Al Nakheel', 'النخيل'),
  address: bi('Riyadh', 'الرياض'),
  city: 'Riyadh',
  latitude: 24.7,
  longitude: 46.7,
  phone: '+966110000001',
  hours: null,
  distanceMeters: 640,
  stock: { available: 3, total: 10 },
  canReserve: true,
  blockedReason: null,
};
const hotDetail = (over: Record<string, unknown> = {}) => ({
  ...hotCard(),
  description: bi('A family platter.', 'طبق عائلي.'),
  terms: {
    blocks: {
      fullPriceItemsOnly: false,
      notCombinable: false,
      minimumSpendHalalas: null,
      validDays: [],
      validFrom: null,
      validTo: null,
    },
    text: bi('Show your code.', 'اعرض الرمز.'),
  },
  media: [],
  branches: [branch],
  holdMinutes: 30,
  unitsTotal: 10,
  perCustomerLimit: 1,
  remainingForMe: 1,
  myReservations: [],
  restriction: null,
  commitment: {
    method: 'CARD_PREAUTH',
    amountMinor: 2500,
    currency: 'SAR',
    depositRefundable: null,
    cancelCutoffMinutes: 15,
    noShowRefundPercent: 0,
    paymentWindowMinutes: 10,
    preauthOnRedemption: 'RELEASE',
    preauthImmediateCapture: false,
  },
  ...over,
});
const reviews = (average: number | null, count: number) =>
  ok({ summary: { count, verified: count, average }, items: [] });
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
    title: bi('Lunch rush', 'ذروة'),
    offerLabel: bi('40% off', 'خصم'),
    imageUrl: null,
    merchantName: bi('Najd Kitchen', 'نجد'),
    merchantId: ORG,
  },
  branch: {
    id: BR,
    name: branch.name,
    address: branch.address,
    latitude: 24.7,
    longitude: 46.7,
    phone: '+966500000001',
  },
  code: { qr: 'DD1.AbCdEfGhIjKlMnOpQrStUv', manual: 'K7QM-9T2X' },
  ...over,
});
const payment = (over: Record<string, unknown> = {}) => ({
  method: 'DEPOSIT',
  status: 'PAID',
  amountMinor: 1000,
  currency: 'SAR',
  dueAt: null,
  redirectUrl: null,
  canRetry: false,
  authorisation: null,
  cancelCutoffAt: inMin(10),
  depositRefundable: true,
  noShowRefundPercent: null,
  keptMinor: null,
  refunds: [],
  ...over,
});

const homeFeed = ok({
  city: 'Riyadh',
  cityEnabled: true,
  categories: [],
  liveNow: [],
  nearYou: [],
  endingSoon: [],
});

describe('Entry: guest first, sign-in only when needed', () => {
  it('a first-time guest sees the welcome with phone sign-in and "Skip for now"; skipping leaves a browsing guest, once per device', async () => {
    stub({ '/v1/app/home': homeFeed }, null);
    const { unmount } = mount(<HomePage />);
    const entry = await screen.findByTestId('entry');
    expect(entry).toHaveTextContent('Welcome');
    expect(entry).toHaveTextContent('Discover deals. Watch. Get rewarded.');
    expect(entry).toHaveTextContent('By continuing you agree to the Terms and Privacy Policy.');
    const user = userEvent.setup();
    // "Continue with phone number" opens the phone sign-in
    await user.click(within(entry).getByTestId('entry-phone'));
    expect(within(entry).getByLabelText(/mobile/i)).toBeInTheDocument();
    await user.click(within(entry).getByTestId('entry-skip'));
    expect(screen.queryByTestId('entry')).toBeNull();
    expect(screen.getByTestId('customer-home')).toBeInTheDocument();
    unmount();
    mount(<HomePage />);
    await screen.findByTestId('customer-home');
    expect(screen.queryByTestId('entry')).toBeNull();
  });

  it('a signed-in customer never sees the entry screen', async () => {
    stub({ '/v1/app/home': homeFeed });
    mount(<HomePage />);
    await screen.findByTestId('customer-home');
    await waitFor(() => expect(screen.queryByTestId('entry')).toBeNull());
  });
});

describe('Browse offers by', () => {
  it('By card asks every offer list for card offers and shows them by type, with the way to add a card', async () => {
    nav.params = new URLSearchParams('by=card');
    const calls = stub({
      '/v1/app/hot-deals': ok([
        hotCard({ eligibility: { ...eligibility, kind: 'BANK_CARD' } }),
        hotCard({
          id: '018f0000-0000-7000-8000-0000000000e2',
          title: bi('Card-only brunch', 'فطور'),
          eligibility: {
            result: 'LOCKED_UNLOCKABLE',
            kind: 'BANK_CARD',
            message: bi('Add a Riyad Bank card to unlock', 'أضف بطاقة'),
            unlockAction: 'ADD_CARD',
          },
        }),
      ]),
    });
    mount(<ExplorePage />);
    const box = await screen.findByTestId('by-card');
    // offers the customer can use now first, then the ones another card unlocks
    expect(await within(box).findByTestId('by-card-open')).toHaveTextContent('Offers for you');
    expect(within(box).getByTestId('by-card-open')).toHaveTextContent('Lunch rush');
    expect(within(box).getByTestId('by-card-locked')).toHaveTextContent('Unlock with another card');
    expect(within(box).getByTestId('by-card-locked')).toHaveTextContent('Card-only brunch');
    expect(box).toHaveTextContent('Offers for bank cards and card schemes');
    expect(within(box).getByText('Add your card to unlock more')).toHaveAttribute(
      'href',
      '/en/benefits?add=card',
    );
    for (const path of ['/v1/app/hot-deals?', '/v1/app/deals?', '/v1/app/vouchers?'])
      expect(calls.some((c) => c.url.includes(path) && c.url.includes('source=card'))).toBe(true);
    expect(screen.getByTestId('browse-card')).toHaveAttribute('aria-pressed', 'true');
  });

  it('By brand lists merchants with their offer counts, linking to the merchant page', async () => {
    nav.params = new URLSearchParams('by=brand');
    stub({
      '/v1/app/brands': ok([
        {
          id: ORG,
          name: bi('Najd Kitchen', 'نجد كيتشن'),
          logoUrl: null,
          category: { code: 'dining', name: bi('Dining', 'المطاعم') },
          offerCount: 3,
          distanceMeters: 640,
        },
      ]),
    });
    mount(<ExplorePage />);
    const card = await screen.findByTestId('brand-card');
    expect(card).toHaveTextContent('Najd Kitchen');
    expect(card).toHaveTextContent('3 offers');
    expect(card).toHaveAttribute('href', `/en/merchants/${ORG}`);
  });
});

describe('Merchant page', () => {
  const page = (over: Record<string, unknown> = {}) => ({
    id: ORG,
    name: bi('Najd Kitchen', 'نجد كيتشن'),
    logoUrl: null,
    coverUrl: null,
    description: { en: 'Family kitchen', ar: 'مطبخ عائلي' },
    category: { code: 'dining', name: bi('Dining', 'المطاعم') },
    phone: '+966500000001',
    branches: [{ ...branch, stock: undefined, canReserve: undefined, blockedReason: undefined }],
    deals: [],
    following: false,
    followers: 12,
    ...over,
  });

  it('shows rating with stars, distance, followers, Follow in the header and four actions; every offer type sits in Offers', async () => {
    stub({
      [`/v1/app/merchants/${ORG}/reviews`]: reviews(4.6, 38),
      [`/v1/app/merchants/${ORG}`]: ok(page()),
      '/v1/app/hot-deals': ok([hotCard()]),
    });
    mount(<MerchantPageView id={ORG} />);
    const meta = await screen.findByTestId('merchant-meta');
    await waitFor(() => expect(meta).toHaveTextContent('4.6'));
    expect(meta).toHaveTextContent('38 reviews');
    expect(meta.querySelectorAll('.dd-stars svg')).toHaveLength(5);
    expect(screen.getByTestId('followers')).toHaveTextContent('12 followers');
    expect(screen.getByTestId('customer-merchant')).toHaveTextContent('640');
    expect(screen.getByTestId('merchant-follow')).toHaveTextContent('Follow');
    expect(screen.getByTestId('merchant-whatsapp')).toHaveAttribute(
      'href',
      'https://wa.me/966500000001',
    );
    expect(screen.getByTestId('merchant-share')).toBeInTheDocument();
    expect(await screen.findByTestId('merchant-offers-hot')).toHaveTextContent(
      'Lunch rush: 40% off kabsa',
    );
  });

  it('Follow: a customer follows and unfollows; a guest is sent to sign in', async () => {
    let following = false;
    const calls = stub({
      [`/v1/app/merchants/${ORG}/follow`]: (c) => {
        following = c.method === 'PUT';
        return ok({ following, followers: following ? 13 : 12 });
      },
      [`/v1/app/merchants/${ORG}/reviews`]: reviews(null, 0),
      [`/v1/app/merchants/${ORG}`]: ok(page()),
    });
    const { unmount } = mount(<MerchantPageView id={ORG} />);
    const user = userEvent.setup();
    const btn = await screen.findByTestId('merchant-follow');
    await user.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId('followers')).toHaveTextContent('13 followers');
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/follow'))).toBe(true);
    await user.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute('aria-pressed', 'false'));
    unmount();
    stub({ [`/v1/app/merchants/${ORG}`]: ok(page()) }, null);
    mount(<MerchantPageView id={ORG} />);
    await user.click(await screen.findByTestId('merchant-follow'));
    // the guest comes back to this merchant after signing in
    expect(nav.push.mock.calls[0]![0]).toMatch(/^\/en\/profile\?reason=follow&next=%2F/);
  });
});

describe('Exclusive Deal detail and Pay & Reserve', () => {
  it('scarcity bar, start and end, rating and "Open to everyone"; the sheet summarises offer, method and the amount held', async () => {
    stub({
      [`/v1/app/merchants/${ORG}/reviews`]: reviews(4.2, 9),
      '/v1/app/hot-deals/': ok(hotDetail()),
    });
    mount(<HotDealPage id={DEAL} />);
    expect(await screen.findByTestId('hot-scarcity')).toHaveTextContent('3 of 10 left');
    const when = screen.getByTestId('hot-when');
    expect(when).toHaveTextContent('Starts');
    expect(when).toHaveTextContent('Ends');
    await waitFor(() => expect(screen.getByTestId('hot-rating')).toHaveTextContent('4.2'));
    expect(screen.getByTestId('hot-elig')).toHaveTextContent('Open to everyone');
    expect(screen.getByTestId('hot-elig')).toHaveTextContent('No card or employer needed.');
    expect(screen.getAllByText('Open to everyone')).toHaveLength(1);
    expect(screen.getByTestId('hot-scarcity')).toHaveTextContent('First come, first served');
    // the sticky CTA states the money: never a generic or "free" reserve
    expect(screen.getByTestId('hot-reserve')).toHaveTextContent('Hold SAR 25.00 and reserve');
    await userEvent.setup().click(screen.getByTestId('hot-reserve'));
    const summary = await screen.findByTestId('pay-summary');
    expect(summary).toHaveTextContent('40% off');
    expect(summary).toHaveTextContent('Card, on the secure payment page');
    expect(summary).toHaveTextContent('Held on your card');
    expect(summary).toHaveTextContent('SAR 25.00');
    expect(screen.getByTestId('reserve-confirm')).toHaveTextContent('Hold SAR 25.00 and reserve');
  });
});

describe('Ticket and My Deals', () => {
  it('the ticket shows validity, the four redemption steps (deposit wording) and WhatsApp / Share / View terms', async () => {
    stub({ [`/v1/app/reservations/${RES}`]: ok(reservation({ payment: payment() })) });
    mount(<ReservationPage id={RES} />);
    expect(await screen.findByTestId('ticket-validity')).toBeInTheDocument();
    const steps = screen.getByTestId('ticket-steps');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(4);
    expect(steps).toHaveTextContent('Show the QR or code to staff before you order.');
    expect(steps).toHaveTextContent(
      'Your deposit is taken off the bill; pay the rest at the till.',
    );
    expect(screen.getByTestId('ticket-whatsapp')).toHaveAttribute(
      'href',
      'https://wa.me/966500000001',
    );
    expect(screen.getByTestId('ticket-share')).toBeInTheDocument();
    expect(screen.getByTestId('ticket-terms')).toHaveAttribute('href', `/en/hot/${DEAL}`);
  });

  it('My Deals reads Reserved / Payment failed / Refunded / Used / Expired, with method and amount', async () => {
    nav.params = new URLSearchParams('tab=past');
    stub({
      '/v1/app/reservations': ok([
        reservation({
          id: 'r1',
          status: 'PENDING_PAYMENT',
          displayState: 'PAYMENT_PENDING',
          code: null,
          payment: payment({ status: 'PENDING' }),
        }),
        reservation({
          id: 'r2',
          status: 'PAYMENT_FAILED',
          displayState: 'PAYMENT_FAILED',
          code: null,
          payment: payment({ status: 'FAILED' }),
        }),
        reservation({
          id: 'r3',
          status: 'CANCELLED',
          displayState: 'CANCELLED_BY_YOU',
          code: null,
          payment: payment({ status: 'REFUNDED' }),
        }),
        reservation({ id: 'r4', status: 'REDEEMED', displayState: 'REDEEMED', code: null }),
        reservation({ id: 'r5', status: 'EXPIRED', displayState: 'NOT_COMPLETED', code: null }),
      ]),
    });
    mount(<MyDealsPage />);
    await screen.findAllByTestId('reservation-row');
    const statuses = screen.getAllByTestId('row-status').map((e) => e.textContent);
    expect(statuses).toEqual(['Reserved', 'Payment failed', 'Refunded', 'Used', 'Expired']);
    expect(screen.getAllByTestId('row-money')[0]).toHaveTextContent(
      'Reservation · Deposit · Paid SAR 10.00',
    );
  });

  it('Arabic and Urdu: the new statuses and steps are translated, Western digits', async () => {
    stub({ [`/v1/app/reservations/${RES}`]: ok(reservation({ payment: payment() })) });
    const { unmount } = mount(<ReservationPage id={RES} />, 'ar');
    expect(await screen.findByTestId('ticket-steps')).toHaveTextContent('طريقة الاستخدام');
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
    unmount();
    mount(<ReservationPage id={RES} />, 'ur');
    expect(await screen.findByTestId('ticket-steps')).toHaveTextContent('استعمال کا طریقہ');
  });
});

// ---------------------------------------------------------------- reference-screen audit fixes
describe('Reference audit: deal page, sheet, ticket, rows, return and sign-in', () => {
  const media = [
    { url: '/brand/dish.jpg', alt: bi('Dish', 'طبق') },
    { url: '/brand/ambience-1.jpg', alt: bi('Room', 'المكان') },
    { url: '/brand/ambience-2.jpg', alt: bi('Bar', 'المكان') },
  ];

  it('photo counter and full-screen viewer; the rating opens a Reviews tab', async () => {
    stub({
      [`/v1/app/merchants/${ORG}/reviews`]: reviews(4.2, 9),
      '/v1/app/hot-deals/': ok(hotDetail({ media })),
    });
    mount(<HotDealPage id={DEAL} />);
    expect(await screen.findByTestId('photo-count')).toHaveTextContent('1/3');
    const user = userEvent.setup();
    await user.click(screen.getByAltText('Room'));
    const viewer = screen.getByTestId('photo-viewer');
    expect(within(viewer).getAllByRole('img')).toHaveLength(3);
    expect(viewer).toHaveTextContent('Photo 2 of 3');
    await user.click(within(viewer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('photo-viewer')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('hot-rating')).toHaveTextContent('4.2'));
    await user.click(screen.getByTestId('hot-rating'));
    expect(screen.getByTestId('hot-tab-reviews')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('hot-reviews')).toBeInTheDocument();
  });

  it('quantity stepper: up to the per-customer limit, and every amount follows the quantity', async () => {
    const calls = stub({
      [`/v1/app/merchants/${ORG}/reviews`]: reviews(null, 0),
      '/v1/app/hot-deals/': (c) =>
        c.method === 'POST'
          ? { body: { data: reservation(), meta: {} } }
          : ok(hotDetail({ perCustomerLimit: 2, remainingForMe: 2 })),
    });
    vi.stubGlobal('location', {
      origin: 'http://localhost:3001',
      assign: vi.fn(),
      pathname: '/en/hot/x',
      search: '',
    });
    mount(<HotDealPage id={DEAL} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('hot-reserve'));
    expect(screen.getByTestId('reserve-qty')).toHaveTextContent('Up to 2 per customer');
    expect(screen.getByTestId('qty-less')).toBeDisabled();
    await user.click(screen.getByTestId('qty-more'));
    expect(screen.getByTestId('qty-value')).toHaveTextContent('2');
    expect(screen.getByTestId('qty-more')).toBeDisabled();
    expect(screen.getByTestId('pay-total')).toHaveTextContent('SAR 50.00');
    expect(screen.getByTestId('reserve-confirm')).toHaveTextContent('Hold SAR 50.00 and reserve');
    await user.click(screen.getByTestId('reserve-accept'));
    await user.click(screen.getByTestId('reserve-confirm'));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.url.includes('/reservations'))).toBe(true),
    );
  });

  it('live ticket: dark header with the validity countdown, code with the paid line, and the Directions / Done bar', async () => {
    stub({ [`/v1/app/reservations/${RES}`]: ok(reservation({ payment: payment() })) });
    mount(<ReservationPage id={RES} />);
    const timer = await screen.findByTestId('ticket-timer');
    expect(timer).toHaveTextContent('Reservation valid for');
    expect(screen.getByTestId('manual-code')).toHaveTextContent('K7QM-9T2X');
    expect(screen.getByTestId('ticket-paid-line')).toHaveTextContent(
      'Deposit paid: SAR 10.00, credited to your bill.',
    );
    const bar = screen.getByTestId('ticket-bar');
    expect(within(bar).getByTestId('ticket-directions')).toHaveTextContent('Get directions');
    expect(within(bar).getByTestId('ticket-done')).toHaveAttribute('href', '/en/reservations');
  });

  it('an active My Deals row counts down live', async () => {
    nav.params = new URLSearchParams('tab=active');
    stub({ '/v1/app/reservations': ok([reservation({ payment: payment() })]) });
    mount(<MyDealsPage />);
    const row = await screen.findByTestId('reservation-row');
    expect(within(row).getByTestId('row-valid')).toHaveTextContent('Reservation valid for');
    expect(within(row).getByTestId('row-valid')).toHaveTextContent(/\d+m/);
  });

  it('return from a real provider opens the reservation that was being paid', async () => {
    sessionStorage.setItem('dd.paying', RES);
    nav.params = new URLSearchParams();
    stub({});
    mount(<ReservationReturnPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/en/reservations/${RES}?new=1`));
    expect(sessionStorage.getItem('dd.paying')).toBeNull();
  });

  it('after signing in, the guest goes straight back to where they were (same-site paths only)', async () => {
    nav.params = new URLSearchParams(
      `reason=reserve&next=${encodeURIComponent(`/en/hot/${DEAL}`)}`,
    );
    stub({});
    const { unmount } = mount(<ProfilePage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/en/hot/${DEAL}`));
    unmount();
    nav.replace.mockClear();
    nav.params = new URLSearchParams('reason=reserve&next=%2F%2Fevil.example');
    mount(<ProfilePage />);
    await screen.findByTestId('customer-profile');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('a guest asked to sign in for a reservation sees why', async () => {
    nav.params = new URLSearchParams('reason=reserve');
    stub({}, null);
    mount(<ProfilePage />);
    expect(await screen.findByText('Sign in to reserve this offer.')).toBeInTheDocument();
  });
});
