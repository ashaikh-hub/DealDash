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
    // My Deals is reachable from the header
    expect(screen.getByTestId('my-deals-link')).toHaveAttribute('href', '/en/reservations');
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
    expect(await screen.findByText('No deals here yet')).toBeInTheDocument();
    unmount();
    stubApi({ '/v1/app/home': { body: { data: { ...home.data, cityEnabled: false }, meta: {} } } });
    render(
      <Providers locale="en">
        <HomePage />
      </Providers>,
    );
    expect(await screen.findByText(/not live in this city/i)).toBeInTheDocument();
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
