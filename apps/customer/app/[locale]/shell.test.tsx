import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from '../../features/home';
import { DealPage } from '../../features/screens';
import { Providers } from './providers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

const card = (over: Record<string, unknown> = {}) => ({
  id: '018f0000-0000-7000-8000-0000000000a1',
  merchantId: '018f0000-0000-7000-8000-0000000000b1',
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
  endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  distanceMeters: 820,
  nearestBranch: {
    id: 'br1',
    name: { en: 'Olaya', ar: 'العليا' },
    area: { en: 'Olaya, Riyadh', ar: 'العليا، الرياض' },
    latitude: 24.69,
    longitude: 46.68,
  },
  branchCount: 2,
  eligibility: { result: 'ELIGIBLE', kind: 'PUBLIC', message: null, unlockAction: null },
  saved: false,
  availability: 'AVAILABLE',
  ...over,
});

const locked = card({
  id: '018f0000-0000-7000-8000-0000000000a2',
  title: { en: 'Team lunch 25% off', ar: 'غداء الفريق بخصم 25%' },
  eligibility: {
    result: 'LOCKED_UNLOCKABLE',
    kind: 'EMPLOYER',
    message: { en: 'Verify your employer to unlock', ar: 'وثّق جهة عملك لفتح العرض' },
    unlockAction: 'VERIFY_EMPLOYER',
  },
});

function stubApi(routes: Record<string, { status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me'))
        return json(401, { errors: [{ code: 'AUTH_REQUIRED', message: 'x' }], meta: {} });
      for (const [key, r] of Object.entries(routes))
        if (url.includes(key)) return json(r.status ?? 200, r.body);
      return json(202, { data: { accepted: 1 }, meta: {} });
    }),
  );
}

const home = {
  data: {
    city: 'Riyadh',
    cityEnabled: true,
    categories: [
      {
        id: 'c1',
        code: 'dining',
        nameEn: 'Dining',
        nameAr: 'المطاعم',
        icon: 'dining',
        sortOrder: 10,
        active: true,
        dealCount: 2,
      },
    ],
    liveNow: [card(), locked],
    nearYou: [card()],
    endingSoon: [],
  },
  meta: {},
};

afterEach(() => vi.unstubAllGlobals());

describe('customer discovery (guest)', () => {
  it('shows branding, categories, live offers and a locked offer with its explanation (English, LTR)', async () => {
    stubApi({ '/v1/app/home': { body: home } });
    render(
      <Providers locale="en">
        <HomePage />
      </Providers>,
    );
    expect(await screen.findAllByText('30% off the tasting menu')).not.toHaveLength(0);
    expect(screen.getAllByLabelText('DealDash').length).toBeGreaterThan(0);
    expect(screen.getByText('Shop by Category')).toBeInTheDocument();
    expect(screen.getAllByText('Dining').length).toBeGreaterThan(0);
    // locked offer: lock label + explanation, never hidden for a guest
    expect(screen.getAllByText('Verify your employer to unlock').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Locked').length).toBeGreaterThan(0);
    // tab bar: the approved five tabs, with Watch & Earn in the centre (Play & Win is Phase 2 and never shown)
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const tabs = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(tabs).toEqual(['Home', 'Explore', 'Watch & Earn', 'Rewards', 'Profile']);
    expect(within(nav).queryByText('Play & Win')).toBeNull();
    // approved header: tagline, notifications bell, My Deals; a guest gets a sign-in chip beside the location
    expect(screen.getByTestId('my-deals-link')).toHaveAttribute('href', '/en/reservations');
    expect(screen.getByText('Discover Deals. Watch. Get Rewarded.')).toBeInTheDocument();
    expect(screen.getByTestId('notifications-bell')).toHaveAttribute(
      'href',
      '/en/reservations?tab=updates',
    );
    expect(screen.getByTestId('header-signin')).toHaveAttribute('href', '/en/profile');
    expect(document.documentElement.dir || 'ltr').toBe('ltr');
  });

  it('renders Arabic content with Western digits and a distance that stays left-to-right', async () => {
    stubApi({ '/v1/app/home': { body: home } });
    render(
      <Providers locale="ar">
        <HomePage />
      </Providers>,
    );
    expect((await screen.findAllByText('خصم 30% على قائمة التذوق')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('وثّق جهة عملك لفتح العرض').length).toBeGreaterThan(0);
    expect(screen.getByText('تسوق حسب الفئة')).toBeInTheDocument();
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/[٠-٩]/); // Western digits only
    const dist = document.querySelector('.dd-dc__meta .dd-ltr');
    expect(dist?.textContent).toMatch(/^\d+ م$/);
    expect(screen.getByRole('link', { name: 'EN' })).toBeInTheDocument();
  });

  it('shows a clear retry state when the API is down', async () => {
    stubApi({
      '/v1/app/home': {
        status: 500,
        body: { errors: [{ code: 'INTERNAL', message: 'x' }], meta: {} },
      },
    });
    render(
      <Providers locale="en">
        <HomePage />
      </Providers>,
    );
    expect(await screen.findByText(/could not load deals/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows the empty state when there are no deals and a not-live message for a disabled city', async () => {
    stubApi({
      '/v1/app/home': {
        body: { data: { ...home.data, liveNow: [], nearYou: [], endingSoon: [] }, meta: {} },
      },
    });
    const { unmount } = render(
      <Providers locale="en">
        <HomePage />
      </Providers>,
    );
    // curated Home: the Live Deals section stays, with a short note and See all (never a blank page)
    expect(await screen.findByTestId('home-live-empty')).toHaveTextContent(
      'No Live Deals near you right now.',
    );
    expect(screen.getByText('Live Deals Near You')).toBeInTheDocument();
    unmount();
    stubApi({ '/v1/app/home': { body: { data: { ...home.data, cityEnabled: false }, meta: {} } } });
    render(
      <Providers locale="en">
        <HomePage />
      </Providers>,
    );
    expect(await screen.findByText(/not live in this city/i)).toBeInTheDocument();
  });

  // founder UAT 2026-10-16: Home is curated, not truncated
  const order = () =>
    [
      ...document.querySelectorAll(
        '[data-testid="home-browse-by"],.dd-hero,[data-testid="home-live-deals"],[data-testid="hot-rail"],[data-testid="watch-rail"],[data-testid="home-rewards"],[data-testid="voucher-rail"],[data-testid="home-ending-soon"]',
      ),
    ].map((e) => e.getAttribute('data-testid') ?? 'hero');

  it('every product section is present in the approved order, each with See all, even when they have nothing right now', async () => {
    stubApi({
      '/v1/app/home': { body: home },
      '/v1/app/hot-deals': { body: { data: [], meta: { nextCursor: null } } },
      '/v1/app/vouchers': { body: { data: [], meta: { nextCursor: null } } },
      '/v1/app/watch': {
        body: {
          data: { campaigns: [], balance: null, categories: [], rewardsEnabled: true },
          meta: {},
        },
      },
    });
    render(
      <Providers locale="en">
        <HomePage />
      </Providers>,
    );
    await screen.findByTestId('voucher-rail');
    await screen.findByTestId('watch-rail');
    await screen.findByTestId('home-rewards');
    await screen.findByTestId('hot-rail');
    // approved order: categories, Browse Offers By, hero, Live Deals, Exclusive Deals, Watch & Earn, Vouchers, Rewards
    expect(order()).toEqual([
      'home-browse-by',
      'hero',
      'home-live-deals',
      'hot-rail',
      'watch-rail',
      'voucher-rail',
      'home-rewards',
    ]);
    const browse = screen.getByTestId('home-browse-by');
    expect(within(browse).getByText('Browse Offers By')).toBeInTheDocument();
    expect(within(browse).getByTestId('browse-by-card')).toHaveAttribute(
      'href',
      '/en/explore?by=card',
    );
    expect(within(browse).getByTestId('browse-by-employer')).toHaveAttribute(
      'href',
      '/en/explore?by=employer',
    );
    expect(within(browse).getByTestId('browse-by-brand')).toHaveAttribute(
      'href',
      '/en/explore?by=brand',
    );
    expect(within(browse).getByTestId('browse-quick-ending')).toHaveAttribute(
      'href',
      '/en/explore?sort=ending_soon',
    );
    // locked terms; the stale "Live Offers" wording is gone
    for (const title of [
      'Shop by Category',
      'Live Deals Near You',
      'Exclusive Deals',
      'Watch & Earn',
      'Vouchers',
    ])
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/live offers/i);
    // empty product rails: a note and the way to the full list
    expect(screen.getByTestId('hot-rail-empty')).toHaveTextContent('No Exclusive Deals near you');
    expect(screen.getByTestId('watch-rail-empty')).toHaveTextContent('No videos to watch');
    expect(screen.getByTestId('voucher-rail-empty')).toHaveTextContent('No Vouchers on sale');
    for (const id of ['home-live-deals', 'hot-rail', 'watch-rail', 'voucher-rail'])
      expect(within(screen.getByTestId(id)).getAllByText('See all').length).toBeGreaterThan(0);
  });

  it('Live Deals appear once: a deal in both feeds shows one card, and Ending Soon never repeats it', async () => {
    stubApi({
      '/v1/app/home': {
        body: { data: { ...home.data, endingSoon: [card()] }, meta: {} },
      },
      '/v1/app/hot-deals': { body: { data: [], meta: { nextCursor: null } } },
      '/v1/app/vouchers': { body: { data: [], meta: { nextCursor: null } } },
    });
    render(
      <Providers locale="en">
        <HomePage />
      </Providers>,
    );
    const live = await screen.findByTestId('home-live-deals');
    expect(within(live).getAllByText('30% off the tasting menu')).toHaveLength(1);
    expect(within(live).getAllByText('Team lunch 25% off')).toHaveLength(1);
    // the only ending-soon card is already shown above, so there is no Ending Soon section
    expect(screen.queryByTestId('home-ending-soon')).toBeNull();
    expect(screen.getAllByText('30% off the tasting menu')).toHaveLength(1);
  });

  it('Ending Soon shows only cards not already on the page', async () => {
    const other = card({
      id: '018f0000-0000-7000-8000-0000000000a9',
      title: { en: 'Last call brunch', ar: 'برنش أخير' },
    });
    stubApi({
      '/v1/app/home': {
        body: { data: { ...home.data, endingSoon: [card(), other] }, meta: {} },
      },
      '/v1/app/hot-deals': { body: { data: [], meta: { nextCursor: null } } },
      '/v1/app/vouchers': { body: { data: [], meta: { nextCursor: null } } },
    });
    render(
      <Providers locale="en">
        <HomePage />
      </Providers>,
    );
    const ending = await screen.findByTestId('home-ending-soon');
    expect(within(ending).getByText('Last call brunch')).toBeInTheDocument();
    expect(within(ending).queryByText('30% off the tasting menu')).toBeNull();
  });

  it('compact carousels: up to five Live Deals, and two records of the same offer show once', async () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      card({
        id: `018f0000-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`,
        title: { en: `Offer number ${i}`, ar: `عرض ${i}` },
      }),
    );
    // a second record of offer 0 (same merchant, same title): the customer sees it once
    const copy = card({
      id: '018f0000-0000-7000-8000-0000000001ff',
      title: { en: 'Offer number 0', ar: 'عرض 0' },
    });
    stubApi({
      '/v1/app/home': {
        body: {
          data: { ...home.data, nearYou: [], liveNow: [many[0]!, copy, ...many.slice(1)] },
          meta: {},
        },
      },
      '/v1/app/hot-deals': { body: { data: [], meta: { nextCursor: null } } },
      '/v1/app/vouchers': { body: { data: [], meta: { nextCursor: null } } },
    });
    render(
      <Providers locale="en">
        <HomePage />
      </Providers>,
    );
    const rail = await screen.findByTestId('home-live-items');
    expect(rail).toHaveClass('dd-rail');
    expect(rail.children).toHaveLength(5);
    expect(within(rail).getAllByText('Offer number 0')).toHaveLength(1);
  });

  it('Exclusive Deals show how the customer reserves: Pay & Reserve for a paid reservation, free otherwise', async () => {
    const hot = (id: string, title: string, reservationMethod: string | null) => ({
      ...card({ id, title: { en: title, ar: title } }),
      limitType: 'TIME_AND_QUANTITY',
      reservationsEnabled: reservationMethod !== null,
      reservationMethod,
      remaining: 3,
      remainingTotal: 3,
      soldOut: false,
    });
    stubApi({
      '/v1/app/home': { body: home },
      '/v1/app/hot-deals': {
        body: {
          data: [
            hot('018f0000-0000-7000-8000-0000000002a1', 'Grill for two', 'DEPOSIT'),
            hot('018f0000-0000-7000-8000-0000000002a2', 'Free dessert', 'FREE'),
          ],
          meta: { nextCursor: null },
        },
      },
      '/v1/app/vouchers': { body: { data: [], meta: { nextCursor: null } } },
    });
    render(
      <Providers locale="en">
        <HomePage />
      </Providers>,
    );
    const rail = await screen.findByTestId('hot-rail-items');
    expect(within(rail).getByTestId('hot-paid')).toHaveTextContent('Pay & Reserve');
    expect(within(rail).getByTestId('hot-free')).toHaveTextContent('Free reservation');
    expect(screen.getByText('Exclusive Deals')).toBeInTheDocument();
  });
});

describe('customer deal detail', () => {
  const detail = {
    ...card(),
    description: { en: 'Enjoy the full tasting menu.', ar: 'استمتع بقائمة التذوق الكاملة.' },
    terms: {
      blocks: {
        fullPriceItemsOnly: true,
        notCombinable: false,
        minimumSpendHalalas: null,
        validDays: [],
        validFrom: null,
        validTo: null,
      },
      text: { en: 'Dinner only.', ar: 'للعشاء فقط.' },
    },
    media: [],
    branches: [
      {
        id: 'br1',
        name: { en: 'Olaya', ar: 'العليا' },
        address: { en: 'Olaya, Riyadh', ar: 'العليا، الرياض' },
        city: 'Riyadh',
        latitude: 24.69,
        longitude: 46.68,
        phone: '+966110000001',
        hours: null,
        distanceMeters: 820,
      },
    ],
    redemption: { mode: 'GENERAL' },
  };

  it('General Live Deal: no claim, code or QR; the action is Get directions', async () => {
    stubApi({ '/v1/app/live-deals/': { body: { data: detail, meta: {} } } });
    render(
      <Providers locale="en">
        <DealPage id={detail.id} />
      </Providers>,
    );
    expect((await screen.findAllByText('Just see and go')).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Get directions' })).toBeEnabled();
    const text = document.body.textContent!.toLowerCase();
    for (const w of ['claim', 'qr', 'barcode', 'reserve']) expect(text).not.toContain(w);
  });

  it('shows a locked deal with the unlock action and the no-card-data promise', async () => {
    const d = { ...detail, ...locked };
    stubApi({
      '/v1/app/live-deals/': {
        body: { data: { ...detail, eligibility: locked.eligibility }, meta: {} },
      },
    });
    render(
      <Providers locale="en">
        <DealPage id={d.id} />
      </Providers>,
    );
    expect(await screen.findByText('Verify your employer to unlock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify employer' })).toBeInTheDocument();
    expect(screen.getByText(/never asks for your card number or CVV/i)).toBeInTheDocument();
  });

  it('shows a friendly not-available state for hidden or ended deals', async () => {
    stubApi({
      '/v1/app/live-deals/': {
        status: 404,
        body: { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} },
      },
    });
    render(
      <Providers locale="ar">
        <DealPage id={detail.id} />
      </Providers>,
    );
    expect(await screen.findByText('هذا العرض غير متاح')).toBeInTheDocument();
  });
});
