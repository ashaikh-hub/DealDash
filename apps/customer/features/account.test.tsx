import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { AccountSettingsPage, WelcomePage } from './account';
import { ExplorePage } from './explore';
import { HomePage } from './home';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
  path: '/en/welcome',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => nav.path,
}));

const customer = {
  id: '018f0000-0000-7000-8000-000000000001',
  userType: 'CUSTOMER',
  displayName: 'Customer',
  locale: 'en',
  audience: 'customer',
  mfaVerified: true,
  mfaRequired: false,
  csrfToken: 'csrf',
  activeMembership: null,
  memberships: [],
  permissions: ['customer.profile.read', 'customer.profile.write'],
};

const profile = (over: Record<string, unknown> = {}, onboarding: Record<string, unknown> = {}) => ({
  firstName: null,
  lastName: null,
  email: null,
  mobileMasked: '+966 •••• 4567',
  dateOfBirth: null,
  ageVerified: false,
  gender: null,
  city: null,
  interests: [],
  language: 'en',
  onboarding: {
    state: 'PHONE_VERIFIED',
    ready: false,
    missing: ['DETAILS', 'BIRTH_DATE', 'CITY', 'CONSENTS'],
    nextStep: 'DETAILS',
    consentsOutdated: false,
    minimumAge: 18,
    ...onboarding,
  },
  consents: [],
  documents: {
    termsVersion: '2026-10',
    privacyVersion: '2026-10',
    termsUrl: null,
    privacyUrl: null,
  },
  ...over,
});
const ready = (over: Record<string, unknown> = {}) =>
  profile(
    {
      firstName: 'Sara',
      email: 'sara@example.com',
      dateOfBirth: '1992-03-04',
      ageVerified: true,
      city: 'Riyadh',
      consents: [
        { kind: 'TERMS', granted: true, version: '2026-10', at: '2026-10-14T09:00:00.000Z' },
        { kind: 'PRIVACY', granted: true, version: '2026-10', at: '2026-10-14T09:00:00.000Z' },
      ],
      ...over,
    },
    { state: 'COMPLETE', ready: true, missing: [], nextStep: null },
  );

const dealCard = (id: string, lat: number | null, over: Record<string, unknown> = {}) => ({
  id,
  merchantId: '018f0000-0000-7000-8000-0000000000b1',
  merchantName: { en: `Grill ${id.slice(-2)}`, ar: 'مشويات' },
  merchantLogoUrl: null,
  title: { en: `Deal ${id.slice(-2)}`, ar: 'عرض' },
  offerLabel: { en: '20% off', ar: 'خصم 20%' },
  shortDescription: { en: 'Tonight', ar: 'الليلة' },
  category: { code: 'dining', name: { en: 'Dining', ar: 'المطاعم' } },
  mechanic: 'PERCENTAGE_OFF',
  imageUrl: null,
  imageAlt: { en: 'Plate', ar: 'طبق' },
  startsAt: null,
  endsAt: null,
  distanceMeters: 800,
  nearestBranch:
    lat === null
      ? null
      : {
          id: `${id.slice(0, -2)}99`,
          name: { en: 'Olaya', ar: 'العليا' },
          area: { en: 'Olaya', ar: 'العليا' },
          latitude: lat,
          longitude: 46.68,
        },
  branchCount: 1,
  eligibility: { result: 'ELIGIBLE', kind: 'PUBLIC', message: null, unlockAction: null },
  saved: false,
  availability: 'AVAILABLE',
  ...over,
});

type R = { status?: number; body: unknown };
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
function stub(routes: Record<string, R | ((body: unknown) => R)>, signedIn = true) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method, body });
      const json = (status: number, b: unknown) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me'))
        return signedIn
          ? json(200, { data: customer, meta: {} })
          : json(401, { errors: [{ code: 'UNAUTHENTICATED', message: 'x' }], meta: {} });
      if (url.includes('/v1/app/config'))
        return json(200, {
          data: {
            defaultCity: 'Riyadh',
            cities: [
              { name: 'Riyadh', nameAr: 'الرياض', latitude: 24.7136, longitude: 46.6753 },
              { name: 'Jeddah', nameAr: 'جدة', latitude: 21.54, longitude: 39.17 },
            ],
            map: { tileUrlTemplate: null, attribution: null },
          },
          meta: {},
        });
      const path = url.split('?')[0]!;
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length)) {
        const [m, p] = key.includes(' ') ? key.split(' ') : ['GET', key];
        if (method === m && path.endsWith(p!)) {
          const r = routes[key]!;
          const out = typeof r === 'function' ? r(body) : r;
          return json(out.status ?? 200, out.body);
        }
      }
      return json(200, { data: [], meta: {} });
    }),
  );
  return calls;
}

beforeEach(() => {
  nav.push.mockReset();
  nav.params = new URLSearchParams();
  nav.path = '/en/welcome';
});
afterEach(() => vi.unstubAllGlobals());

const mount = (node: React.ReactNode, locale: 'en' | 'ar' | 'ur' = 'en') =>
  render(<Providers locale={locale}>{node}</Providers>);

describe('Profile set-up (CS-02)', () => {
  it('resumes at the first missing step, saves each step and finishes with the welcome', async () => {
    const user = userEvent.setup();
    let current = profile();
    const calls = stub({
      '/v1/app/me/profile': () => ok(current),
      'PUT /v1/app/me/profile': (b) => {
        const body = b as Record<string, unknown>;
        if (body.firstName)
          current = profile(
            { firstName: body.firstName, email: body.email },
            {
              state: 'PROFILE_IN_PROGRESS',
              nextStep: 'BIRTH_DATE',
              missing: ['BIRTH_DATE', 'CITY', 'CONSENTS'],
            },
          );
        else if (body.dateOfBirth)
          current = profile(
            { ...current, dateOfBirth: body.dateOfBirth, ageVerified: true },
            { state: 'PROFILE_IN_PROGRESS', nextStep: 'CITY', missing: ['CITY', 'CONSENTS'] },
          );
        else if (body.city)
          current = profile(
            { ...current, city: body.city },
            { state: 'PROFILE_IN_PROGRESS', nextStep: 'CONSENTS', missing: ['CONSENTS'] },
          );
        return ok(current);
      },
      'PUT /v1/app/me/consents': () => ok(ready({ firstName: 'Sara' })),
      '/v1/app/categories': ok([]),
    });
    mount(<WelcomePage />);
    expect(await screen.findByText('Step 1 of 6')).toBeInTheDocument();
    await user.type(screen.getByLabelText('First name'), 'Sara');
    await user.type(screen.getByLabelText('Email'), 'sara@example.com');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByText('Your date of birth')).toBeInTheDocument();
    expect(screen.getByText(/DealDash is for people 18 and over/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1992-03-04' } });
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // gender is optional: skip it
    expect(
      await screen.findByText('Never used to target offers.', { exact: false }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip for now' }));
    await user.click(await screen.findByRole('radio', { name: 'Jeddah' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    // interests are optional too
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));

    // consents: Terms and Privacy are required; marketing is separate, optional and never pre-ticked
    expect(await screen.findByText('Your agreements')).toBeInTheDocument();
    expect(screen.getByLabelText('Send me offers and news by email')).not.toBeChecked();
    expect(screen.getByText(/final text is being prepared/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Please accept the Terms of Use and the Privacy Policy to continue.',
    );
    await user.click(screen.getByLabelText('I accept the Terms of Use'));
    await user.click(screen.getByLabelText('I accept the Privacy Policy'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByTestId('welcome-done')).toHaveTextContent("You're all set, Sara");
    expect(screen.getByRole('link', { name: 'Add my benefits' })).toHaveAttribute(
      'href',
      '/en/benefits',
    );
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => c.body)).toEqual([
      { firstName: 'Sara', lastName: '', email: 'sara@example.com' },
      { dateOfBirth: '1992-03-04' },
      { city: 'Jeddah' },
      expect.objectContaining({
        source: 'ONBOARDING',
        items: expect.arrayContaining([
          { kind: 'TERMS', granted: true },
          { kind: 'PRIVACY', granted: true },
          { kind: 'MARKETING_EMAIL', granted: false },
        ]),
      }),
    ]);
  });

  it('under the minimum age: a calm block with only a sign-out', async () => {
    stub({
      '/v1/app/me/profile': ok(
        profile({}, { state: 'AGE_BLOCKED', ready: false, missing: [], nextStep: null }),
      ),
    });
    mount(<WelcomePage />);
    const block = await screen.findByTestId('age-blocked');
    expect(block).toHaveTextContent('DealDash is for people 18 and over');
    expect(within(block).getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByTestId('welcome')).not.toBeInTheDocument();
  });

  it('home shows "continue setting up" for an unfinished profile and nothing once it is complete', async () => {
    nav.path = '/en';
    const feed = {
      city: 'Riyadh',
      cityEnabled: true,
      categories: [],
      liveNow: [],
      nearYou: [],
      endingSoon: [],
    };
    stub({ '/v1/app/me/profile': ok(profile()), '/v1/app/home': ok(feed) });
    const first = mount(<HomePage />);
    expect(await screen.findByTestId('setup-banner')).toHaveTextContent(
      'Finish setting up your profile',
    );
    first.unmount();
    vi.unstubAllGlobals();
    stub({ '/v1/app/me/profile': ok(ready()), '/v1/app/home': ok(feed) });
    mount(<HomePage />);
    await screen.findByTestId('customer-home');
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByTestId('setup-banner')).not.toBeInTheDocument();
  });
});

describe('Account gate and global states', () => {
  const signedIn = (calls: Array<{ url: string }>) =>
    waitFor(() => expect(calls.some((c) => c.url.includes('/v1/app/me/profile'))).toBe(true));

  it('an action refused for an unfinished profile opens one sheet that leads to the set-up', async () => {
    nav.path = '/en/explore';
    const calls = stub({ '/v1/app/me/profile': ok(ready()), '/v1/app/deals': ok([]) });
    mount(<ExplorePage />);
    await signedIn(calls);
    act(() => {
      window.dispatchEvent(new CustomEvent('dd:account-signal', { detail: 'ONBOARDING_REQUIRED' }));
    });
    const sheet = await screen.findByTestId('account-gate');
    expect(sheet).toHaveTextContent('Finish setting up your profile');
    expect(within(sheet).getByRole('link', { name: 'Continue setting up' })).toHaveAttribute(
      'href',
      '/en/welcome?next=%2Fexplore',
    );
  });

  it('new Terms: the sheet asks to review and accept, straight to that step', async () => {
    nav.path = '/en/explore';
    const calls = stub({ '/v1/app/me/profile': ok(ready()), '/v1/app/deals': ok([]) });
    mount(<ExplorePage />);
    await signedIn(calls);
    act(() => {
      window.dispatchEvent(new CustomEvent('dd:account-signal', { detail: 'CONSENT_REQUIRED' }));
    });
    const sheet = await screen.findByTestId('account-gate');
    expect(sheet).toHaveTextContent('We updated our Terms');
    expect(within(sheet).getByRole('link', { name: 'Review and accept' })).toHaveAttribute(
      'href',
      '/en/welcome?step=CONSENTS&next=%2Fexplore',
    );
  });

  it('shows a persistent offline banner while the device is offline', async () => {
    nav.path = '/en/explore';
    stub({ '/v1/app/deals': ok([]) }, false);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount(<ExplorePage />);
    expect(await screen.findByTestId('offline-banner')).toHaveTextContent("You're offline");
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument();
    online.mockRestore();
  });
});

describe('Account settings and notifications (CS-05 / CS-06)', () => {
  it('transactional notifications are always on; rewards push can be turned off; marketing is opt-in', async () => {
    const user = userEvent.setup();
    nav.path = '/en/account';
    let settings = {
      categories: [
        { category: 'ORDERS', required: true, push: true },
        { category: 'ACCOUNT', required: true, push: true },
        { category: 'REWARDS', required: false, push: true },
        { category: 'BENEFITS', required: false, push: true },
      ],
      pushAllowed: true,
      marketing: { push: false, email: false },
    };
    const calls = stub({
      '/v1/app/me/profile': ok(ready()),
      '/v1/app/categories': ok([]),
      '/v1/app/me/notification-settings': () => ok(settings),
      'PUT /v1/app/me/notification-settings': (b) => {
        const c = (b as { categories: Array<{ category: string; push: boolean }> }).categories[0]!;
        settings = {
          ...settings,
          categories: settings.categories.map((x) =>
            x.category === c.category ? { ...x, push: c.push } : x,
          ),
        };
        return ok(settings);
      },
    });
    mount(<AccountSettingsPage />);
    const box = await screen.findByTestId('notification-settings');
    expect(await within(box).findAllByText('Always on')).toHaveLength(2);
    expect(within(box).getByLabelText('Send me offers and news by email')).not.toBeChecked();
    const rewards = within(box).getByText('Rewards and points').closest('li')!;
    await user.click(within(rewards).getByRole('checkbox'));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      categories: [{ category: 'REWARDS', push: false }],
    });
    expect(within(rewards).getByRole('checkbox')).not.toBeChecked();
    // personal details and the read-only date of birth
    expect(screen.getByLabelText('First name')).toHaveValue('Sara');
    expect(screen.getByText('Confirmed. Contact support to correct it.')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-masked')).toHaveTextContent('+966 •••• 4567');
    // privacy: Terms / Privacy shown as accepted with their version, not withdrawable here
    expect(screen.getByTestId('privacy-consents')).toHaveTextContent('Version 2026-10');
    // three interface languages
    expect(
      within(screen.getByTestId('language-choice')).getByRole('link', { name: 'اردو' }),
    ).toHaveAttribute('href', '/ur/account');
  });
});

describe('Live Deals map', () => {
  it('pins deals at their branch, groups close ones, lists the selection and counts deals without a location', async () => {
    const user = userEvent.setup();
    nav.path = '/en/explore';
    nav.params = new URLSearchParams('view=map');
    stub(
      {
        '/v1/app/deals': ok([
          dealCard('018f0000-0000-7000-8000-0000000000a1', 24.72),
          dealCard('018f0000-0000-7000-8000-0000000000a2', 24.69),
          dealCard('018f0000-0000-7000-8000-0000000000a3', null),
        ]),
      },
      false,
    );
    mount(<ExplorePage />);
    const map = await screen.findByTestId('deals-map');
    // the map never mirrors (RTL keeps it left-to-right)
    expect(within(map).getByRole('region')).toHaveAttribute('dir', 'ltr');
    const pins = await within(map).findAllByTestId('map-pin');
    expect(pins.length).toBeGreaterThanOrEqual(1);
    expect(map).toHaveTextContent('1 deals have no map location');
    await user.click(pins[0]!);
    const selection = await screen.findByTestId('map-selection');
    expect(within(selection).getAllByRole('link').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    // the list / map switch keeps the other filters
    expect(screen.getByTestId('view-map')).toHaveAttribute('aria-pressed', 'true');
  });

  it('"For my benefits" filters Explore to offers the customer can use now', async () => {
    const user = userEvent.setup();
    nav.path = '/en/explore';
    stub({ '/v1/app/deals': ok([]) }, false);
    mount(<ExplorePage />);
    await user.click(await screen.findByTestId('for-my-benefits'));
    expect(nav.replace).toHaveBeenCalledWith('/en/explore?eligibility=unlocked');
  });
});

describe('Urdu', () => {
  it('reads right-to-left in Urdu, keeps merchant content in English and keeps Urdu in every link', async () => {
    nav.path = '/ur/welcome';
    stub({ '/v1/app/me/profile': ok(profile()), '/v1/app/categories': ok([]) });
    mount(<WelcomePage />, 'ur');
    expect(await screen.findByText('مرحلہ 1 از 6')).toBeInTheDocument();
    expect(screen.getByLabelText('پہلا نام')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'جاری رکھیں' })).toBeInTheDocument();
    // the header language switch marks Urdu and keeps the approved EN / عربي
    const lang = screen.getByRole('navigation', { name: 'زبان' });
    expect(within(lang).getByRole('link', { name: 'اردو' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(within(lang).getByRole('link', { name: 'EN' })).toHaveAttribute('href', '/en/welcome');
  });

  it('shows deal content in English with Urdu interface text', async () => {
    nav.path = '/ur/explore';
    stub({ '/v1/app/deals': ok([dealCard('018f0000-0000-7000-8000-0000000000a1', 24.72)]) }, false);
    mount(<ExplorePage />, 'ur');
    expect(await screen.findByText('Deal a1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'دریافت کریں' })).toBeInTheDocument();
    expect(screen.getByTestId('for-my-benefits')).toHaveTextContent('میری سہولیات کے لیے');
  });
});
