import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { LinkedAccounts, PaymentMethodsPage, SocialCallbackPage } from './cx-account';
import { EmployeePassPage, SavingsPage } from './cx-benefits';
import { HomePage } from './home';
import { HotDealPage, MyDealsPage, ReservationPage, ReservationReturnPage } from './hot';
import { MerchantPageView, ProfilePage } from './screens';

/**
 * Customer experience part 2 (2026-10-16): Google / Apple sign-in (development provider), linked accounts, saved cards and paying with
 * one, card-linked offer activation, "Log my saving", the Employee Pass, per-deal reviews and the merchant gallery.
 */
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
  pathname: '/en',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => nav.pathname,
}));

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const DEAL = '018f0000-0000-7000-8000-0000000000e1';
const BR = '018f0000-0000-7000-8000-0000000000b1';
const RES = '018f0000-0000-7000-8000-0000000000f1';
const EMP = '018f0000-0000-7000-8000-0000000000c1';
const PROG = '018f0000-0000-7000-8000-0000000000d1';
const CARD1 = '018f0000-0000-7000-8000-0000000000a1';
const CARD2 = '018f0000-0000-7000-8000-0000000000a2';
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
  permissions: ['customer.profile.read', 'customer.profile.write', 'customer.reservations.manage'],
};

interface Call {
  url: string;
  method: string;
  body: unknown;
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
      const call = {
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
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
      return json(200, { data: [], meta: { nextCursor: null } });
    }),
  );
  return calls;
}
const ok = (data: unknown) => ({ body: { data, meta: { nextCursor: null } } });
const fail = (status: number, code: string) => ({
  status,
  body: { errors: [{ code, message: code }], meta: {} },
});
const mount = (ui: React.ReactNode, locale: 'en' | 'ar' | 'ur' = 'en') =>
  render(<Providers locale={locale}>{ui}</Providers>);
const assign = vi.fn();

beforeEach(() => {
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
  nav.pathname = '/en';
  assign.mockClear();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());
const stubLocation = (pathname = '/en') =>
  vi.stubGlobal('location', {
    origin: 'http://localhost:3001',
    assign,
    pathname,
    search: '',
    href: `http://localhost:3001${pathname}`,
  });

const card = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  brand: 'VISA',
  last4: '4242',
  expMonth: 12,
  expYear: 2029,
  expired: false,
  isDefault: false,
  addedAt: inMin(-600),
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
    name: branch.name,
    area: branch.address,
    latitude: 24.7,
    longitude: 46.7,
  },
  branchCount: 1,
  eligibility: { result: 'ELIGIBLE', kind: 'PUBLIC', message: null, unlockAction: null },
  availability: 'AVAILABLE',
  serverNow: new Date().toISOString(),
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
    method: 'FULL_PREPAYMENT',
    amountMinor: 5000,
    currency: 'SAR',
    depositRefundable: null,
    cancelCutoffMinutes: 15,
    noShowRefundPercent: 40,
    paymentWindowMinutes: 10,
    preauthOnRedemption: null,
    preauthImmediateCapture: null,
  },
  ...over,
});
const reservation = (over: Record<string, unknown> = {}) => ({
  id: RES,
  publicRef: 'DD-K7QM9T',
  status: 'REDEEMED',
  displayState: 'REDEEMED',
  quantity: 1,
  holdMinutes: 30,
  createdAt: inMin(-90),
  expiresAt: inMin(-30),
  redeemedAt: inMin(-40),
  cancelledAt: null,
  cancelledBy: null,
  serverNow: new Date().toISOString(),
  canCancel: false,
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
  code: null,
  ...over,
});
const dealReviews = (over: Record<string, unknown> = {}) =>
  ok({
    summary: { count: 2, average: 4.5, distribution: [1, 1, 0, 0, 0] },
    items: [
      {
        id: '018f0000-0000-7000-8000-00000000ee01',
        rating: 5,
        text: 'Lovely kabsa, generous portions.',
        verified: true,
        author: 'Sara',
        createdAt: inMin(-600),
      },
    ],
    mine: { canReview: true, reason: null },
    ...over,
  });

// ---------------------------------------------------------------- Google / Apple sign-in
describe('Google / Apple sign-in', () => {
  it('the welcome offers Google, Apple and the phone; Google starts at the provider and remembers where the guest was', async () => {
    stubLocation('/en/hot/x');
    const calls = stub(
      {
        '/v1/app/home': ok({
          city: 'Riyadh',
          cityEnabled: true,
          categories: [],
          liveNow: [],
          nearYou: [],
          endingSoon: [],
        }),
        '/v1/auth/social/start': ok({
          authorizeUrl: 'http://localhost:3001/en/auth/social/callback?mock_social=GOOGLE&state=s1',
        }),
      },
      null,
    );
    mount(<HomePage />);
    const entry = await screen.findByTestId('entry');
    expect(within(entry).getByTestId('social-google')).toHaveTextContent('Continue with Google');
    expect(within(entry).getByTestId('social-apple')).toHaveTextContent('Continue with Apple');
    expect(within(entry).getByTestId('entry-phone')).toBeInTheDocument();
    await userEvent.setup().click(within(entry).getByTestId('social-google'));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledWith(
      'http://localhost:3001/en/auth/social/callback?mock_social=GOOGLE&state=s1',
    );
    const start = calls.find((c) => c.url.includes('/v1/auth/social/start'))!;
    expect(start.body).toEqual({
      provider: 'GOOGLE',
      intent: 'SIGN_IN',
      callbackUrl: 'http://localhost:3001/en/auth/social/callback',
    });
    expect(sessionStorage.getItem('dd.social.next')).toBe('/hot/x');
  });

  it('when the provider is not configured, the customer is told to use the phone', async () => {
    stubLocation();
    stub({ '/v1/auth/social/start': fail(503, 'SOCIAL_SIGN_IN_UNAVAILABLE') }, null);
    mount(<ProfilePage />);
    await userEvent.setup().click(await screen.findByTestId('social-apple'));
    expect(
      await screen.findByText('Sign-in with Apple is not available yet. Use your phone number.'),
    ).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('development provider screen: choose an account (code back to the callback) or cancel', async () => {
    nav.params = new URLSearchParams('mock_social=GOOGLE&state=state-123456789012');
    nav.pathname = '/en/auth/social/callback';
    const calls = stub({ '/v1/dev/social/approve': ok({ code: 'mock_code_1' }) }, null);
    mount(<SocialCallbackPage />);
    const screenEl = await screen.findByTestId('mock-provider');
    expect(screenEl).toHaveTextContent('Google sign-in (development)');
    const user = userEvent.setup();
    await user.click(within(screenEl).getByTestId('mock-cancel'));
    expect(nav.replace).toHaveBeenLastCalledWith(
      '/en/auth/social/callback?state=state-123456789012&error=access_denied',
    );
    await user.click(within(screenEl).getByTestId('mock-account-sara'));
    await waitFor(() =>
      expect(nav.replace).toHaveBeenLastCalledWith(
        '/en/auth/social/callback?state=state-123456789012&code=mock_code_1',
      ),
    );
    expect(calls.find((c) => c.url.includes('/dev/social/approve'))!.body).toMatchObject({
      provider: 'GOOGLE',
      subject: 'sara',
      email: 'sara.demo@gmail.com',
    });
    // while it goes back to the app, nothing else can be pressed
    expect(within(screenEl).getByTestId('mock-cancel')).toBeDisabled();
  });

  it('first sign-in with Google: confirm the phone by code, then the account is ready and the customer goes back', async () => {
    nav.params = new URLSearchParams('state=state-123456789012&code=mock_code_1');
    sessionStorage.setItem('dd.social.next', '/hot/abc');
    const calls = stub(
      {
        '/v1/auth/social/callback': ok({
          status: 'NEEDS_PHONE',
          provider: 'GOOGLE',
          intent: 'SIGN_IN',
          linkToken: 'link-token-0123456789',
          profile: { name: 'Sara Ahmed', email: 'sara@example.com' },
          csrfToken: null,
        }),
        '/v1/auth/otp/request': ok({ sent: true, expiresInSeconds: 300, resendAfterSeconds: 30 }),
        '/v1/auth/social/complete': ok({ account: 'NEW', provider: 'GOOGLE', csrfToken: 'c2' }),
      },
      null,
    );
    mount(<SocialCallbackPage />);
    const step = await screen.findByTestId('social-phone');
    expect(step).toHaveTextContent('Signed in with Google as Sara Ahmed');
    const user = userEvent.setup();
    await user.type(within(step).getByLabelText('Mobile number'), '+966500000099');
    await user.click(within(step).getByTestId('social-send'));
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    const outcome = await screen.findByTestId('social-outcome');
    expect(outcome).toHaveTextContent('Your DealDash account is ready and linked to Google.');
    expect(calls.find((c) => c.url.includes('/social/complete'))!.body).toEqual({
      linkToken: 'link-token-0123456789',
      mobile: '+966500000099',
      code: '123456',
    });
    await user.click(within(outcome).getByRole('button', { name: 'Continue' }));
    expect(nav.replace).toHaveBeenCalledWith('/en/hot/abc');
    // the callback ran once (a state is single use)
    expect(calls.filter((c) => c.url.includes('/social/callback'))).toHaveLength(1);
  });

  it('a returning Google customer is signed in and taken back; cancelled and expired sign-ins explain what happened', async () => {
    nav.params = new URLSearchParams('state=state-123456789012&code=c');
    sessionStorage.setItem('dd.social.next', '/merchants/x');
    stub(
      {
        '/v1/auth/social/callback': ok({
          status: 'SIGNED_IN',
          provider: 'GOOGLE',
          intent: 'SIGN_IN',
          linkToken: null,
          profile: null,
          csrfToken: 'c',
        }),
      },
      null,
    );
    const first = mount(<SocialCallbackPage />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/en/merchants/x'));
    first.unmount();

    nav.params = new URLSearchParams('state=state-123456789012&error=access_denied');
    stub(
      {
        '/v1/auth/social/callback': ok({
          status: 'CANCELLED',
          provider: 'APPLE',
          intent: 'SIGN_IN',
          linkToken: null,
          profile: null,
          csrfToken: null,
        }),
      },
      null,
    );
    const second = mount(<SocialCallbackPage />);
    expect(await screen.findByTestId('social-outcome')).toHaveTextContent(
      'Sign-in was cancelled. Try again or use your phone number.',
    );
    second.unmount();

    stub({ '/v1/auth/social/callback': fail(400, 'SOCIAL_SIGN_IN_EXPIRED') }, null);
    mount(<SocialCallbackPage />);
    expect(await screen.findByTestId('social-outcome')).toHaveTextContent(
      'This sign-in has expired. Please start again.',
    );
  });

  it('linked accounts in Account settings: Google linked (unlink), Apple can be linked', async () => {
    stubLocation('/en/account');
    const calls = stub({
      '/v1/app/me/identities/GOOGLE': ok({ items: [], available: ['GOOGLE', 'APPLE'] }),
      '/v1/app/me/identities': ok({
        items: [{ provider: 'GOOGLE', email: 'sara@gmail.com', linkedAt: inMin(-600) }],
        available: ['GOOGLE', 'APPLE'],
      }),
      '/v1/auth/social/start': ok({
        authorizeUrl: 'http://localhost:3001/x?mock_social=APPLE&state=s',
      }),
    });
    mount(<LinkedAccounts />);
    const google = await screen.findByTestId('linked-google');
    expect(google).toHaveTextContent('sara@gmail.com');
    expect(google).toHaveTextContent('Linked');
    const user = userEvent.setup();
    await user.click(within(screen.getByTestId('linked-apple')).getByTestId('link-apple'));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(calls.find((c) => c.url.includes('/social/start'))!.body).toMatchObject({
      provider: 'APPLE',
      intent: 'LINK',
    });
    await user.click(within(google).getByTestId('unlink-google'));
    expect(await screen.findByText('Google was unlinked.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/identities/GOOGLE'))).toBe(
      true,
    );
  });

  it('Urdu and Arabic: the provider buttons and the linked accounts read in the customer’s language', async () => {
    stub({}, null);
    const ur = mount(<ProfilePage />, 'ur');
    expect(await screen.findByTestId('social-google')).toHaveTextContent('گوگل کے ساتھ جاری رکھیں');
    expect(screen.getByTestId('social-apple')).toHaveTextContent('ایپل کے ساتھ جاری رکھیں');
    ur.unmount();
    stub({ '/v1/app/me/identities': ok({ items: [], available: ['GOOGLE', 'APPLE'] }) });
    mount(<LinkedAccounts />, 'ar');
    const box = await screen.findByTestId('linked-accounts');
    expect(box).toHaveTextContent('الحسابات المرتبطة');
    expect(await within(box).findByTestId('linked-google')).toHaveTextContent('جوجل');
  });
});

// ---------------------------------------------------------------- saved cards
describe('Saved cards', () => {
  const list = (items: unknown[]) => ok({ items, canSave: true });

  it('lists cards with the default first; make default, remove after confirming, add on the provider page', async () => {
    stubLocation('/en/payment-methods');
    const calls = stub({
      [`/v1/app/payment-methods/${CARD2}/default`]: list([
        card(CARD2, { brand: 'MASTERCARD', last4: '5454', isDefault: true }),
        card(CARD1),
      ]),
      [`/v1/app/payment-methods/${CARD1}`]: list([
        card(CARD2, { brand: 'MASTERCARD', last4: '5454', isDefault: true }),
      ]),
      '/v1/app/payment-methods/setups': ok({
        setupId: '018f0000-0000-7000-8000-0000000000ab',
        redirectUrl: 'http://localhost:3001/en/payment-methods?setup=x&mock_setup=ref1',
      }),
      '/v1/app/payment-methods': list([
        card(CARD1, { isDefault: true }),
        card(CARD2, { brand: 'MASTERCARD', last4: '5454' }),
      ]),
    });
    mount(<PaymentMethodsPage />);
    const rows = await screen.findAllByTestId('saved-card');
    expect(rows[0]).toHaveTextContent('Visa ending 4242');
    expect(rows[0]).toHaveTextContent('Default');
    expect(rows[1]).toHaveTextContent('Mastercard ending 5454');
    expect(rows[1]).toHaveTextContent('Expires 12/29');
    const user = userEvent.setup();
    await user.click(within(rows[1]!).getByTestId('card-make-default'));
    expect(await screen.findByText('Default card updated.')).toBeInTheDocument();
    const now = screen.getAllByTestId('saved-card');
    await user.click(within(now[1]!).getByTestId('card-remove'));
    expect(now[1]).toHaveTextContent('Remove this card? You can add it again at any time.');
    await user.click(within(now[1]!).getByTestId('card-remove-confirm'));
    expect(await screen.findByText('Card removed.')).toBeInTheDocument();
    expect(
      calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/payment-methods/${CARD1}`)),
    ).toBe(true);
    await user.click(screen.getByTestId('card-add-new'));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        'http://localhost:3001/en/payment-methods?setup=x&mock_setup=ref1',
      ),
    );
    expect(calls.find((c) => c.url.endsWith('/payment-methods/setups'))!.body).toEqual({
      returnUrl: 'http://localhost:3001/en/payment-methods',
      makeDefault: false,
    });
  });

  it('back from the provider page: the outcome is read from the API (saved / declined)', async () => {
    nav.params = new URLSearchParams('setup=018f0000-0000-7000-8000-0000000000ab');
    nav.pathname = '/en/payment-methods';
    stub({
      '/finish': ok({
        status: 'COMPLETED',
        failureCode: null,
        duplicate: false,
        card: card(CARD1),
      }),
      '/v1/app/payment-methods': list([card(CARD1, { isDefault: true })]),
    });
    const a = mount(<PaymentMethodsPage />);
    expect(await screen.findByText('Card saved.')).toBeInTheDocument();
    expect(nav.replace).toHaveBeenCalledWith('/en/payment-methods');
    a.unmount();
    stub({
      '/finish': ok({
        status: 'FAILED',
        failureCode: 'CARD_DECLINED',
        duplicate: false,
        card: null,
      }),
      '/v1/app/payment-methods': list([]),
    });
    mount(<PaymentMethodsPage />);
    expect(
      await screen.findByText('The card could not be added. Try another card.'),
    ).toBeInTheDocument();
  });

  it('development card page: a test card is picked (no card number anywhere), then back to finish', async () => {
    nav.params = new URLSearchParams('setup=SETUP1&mock_setup=mock-setup-1');
    nav.pathname = '/en/payment-methods';
    const calls = stub({ '/v1/dev/payment-methods/mock-setup-1/complete': ok({ done: true }) });
    mount(<PaymentMethodsPage />);
    const page = await screen.findByTestId('mock-card-page');
    expect(page.querySelectorAll('input[type="text"], input[inputmode="numeric"]')).toHaveLength(0);
    const user = userEvent.setup();
    await user.click(within(page).getByTestId('mock-card-MASTERCARD_5454'));
    await user.click(within(page).getByTestId('mock-card-save'));
    await waitFor(() =>
      expect(nav.replace).toHaveBeenCalledWith('/en/payment-methods?setup=SETUP1'),
    );
    expect(calls.find((c) => c.url.includes('/complete'))!.body).toEqual({
      outcome: 'SAVED',
      card: 'MASTERCARD_5454',
    });
  });

  it('the reserve sheet pays with the default saved card (or a new card on the payment page)', async () => {
    stubLocation('/en/hot/x');
    const calls = stub({
      '/v1/app/payment-methods': list([
        card(CARD1, { isDefault: true }),
        card(CARD2, { brand: 'MADA', last4: '1234' }),
      ]),
      [`/v1/app/hot-deals/${DEAL}/reservations`]: ok({
        ...reservation({ status: 'PENDING_PAYMENT', displayState: 'PAYMENT_PENDING' }),
        payment: { redirectUrl: 'http://localhost:3001/en/reservations/return?mock_payment=p1' },
      }),
      [`/v1/app/hot-deals/${DEAL}`]: ok(hotDetail()),
    });
    mount(<HotDealPage id={DEAL} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('hot-reserve'));
    const payWith = await screen.findByTestId('pay-with');
    expect(within(payWith).getByTestId('pay-with-value')).toHaveTextContent('Visa ending 4242');
    // the generic "card on the payment page" line gives way to the chosen card
    expect(screen.getByTestId('pay-summary')).not.toHaveTextContent(
      'Card, on the secure payment page',
    );
    await user.click(within(payWith).getByTestId('pay-with-change'));
    await user.click(within(payWith).getByTestId(`pay-with-${CARD2}`));
    expect(within(payWith).getByTestId('pay-with-value')).toHaveTextContent('mada ending 1234');
    await user.click(screen.getByTestId('reserve-accept'));
    await user.click(screen.getByTestId('reserve-confirm'));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/reservations'))!;
    expect(post.body).toMatchObject({ acceptTerms: true, paymentMethodId: CARD2 });
  });

  it('the development payment page names the saved card being charged', async () => {
    nav.params = new URLSearchParams('mock_payment=p1&mock_card=mock_tok_1');
    stub({
      '/v1/dev/payment-methods/cards/mock_tok_1': ok({ brand: 'VISA', last4: '4242' }),
      '/v1/dev/reservations/p1': ok({ reservationId: RES, kind: 'PAYMENT' }),
      [`/v1/app/reservations/${RES}`]: ok(
        reservation({
          status: 'PENDING_PAYMENT',
          displayState: 'PAYMENT_PENDING',
          payment: {
            method: 'FULL_PREPAYMENT',
            status: 'PENDING',
            amountMinor: 5000,
            currency: 'SAR',
            dueAt: inMin(9),
            redirectUrl: null,
            canRetry: false,
            authorisation: null,
            cancelCutoffAt: null,
            depositRefundable: null,
            noShowRefundPercent: 40,
            keptMinor: null,
            refunds: [],
          },
        }),
      ),
    });
    mount(<ReservationReturnPage />);
    expect(await screen.findByTestId('mock-paying-card')).toHaveTextContent(
      'Paying with Visa ending 4242',
    );
  });
});

// ---------------------------------------------------------------- card offer, savings, reviews, pass, gallery
describe('Card offers, savings, reviews, Employee Pass, gallery', () => {
  it('card-linked offer: activate on the added card; a customer without the card is sent to add it', async () => {
    const calls = stub({
      [`/v1/app/card-offers/hot/${DEAL}/activate`]: ok({
        state: 'ACTIVATED',
        cards: [{ programId: PROG, name: bi('BankCo Signature', 'سيجنتشر') }],
        issuers: [],
        activation: {
          programId: PROG,
          cardName: bi('BankCo Signature', 'سيجنتشر'),
          activatedAt: inMin(0),
        },
      }),
      [`/v1/app/card-offers/hot/${DEAL}`]: ok({
        state: 'AVAILABLE',
        cards: [{ programId: PROG, name: bi('BankCo Signature', 'سيجنتشر') }],
        issuers: [{ id: EMP, name: bi('BankCo', 'بنك كو') }],
        activation: null,
      }),
      [`/v1/app/hot-deals/${DEAL}`]: ok(hotDetail()),
    });
    const a = mount(<HotDealPage id={DEAL} />);
    const panel = await screen.findByTestId('card-offer');
    await userEvent.setup().click(within(panel).getByTestId('card-offer-activate'));
    expect(await screen.findByTestId('card-offer-activated')).toHaveTextContent(
      'Activated on BankCo Signature',
    );
    expect(calls.find((c) => c.url.endsWith('/activate'))!.body).toEqual({ programId: PROG });
    a.unmount();
    stub({
      [`/v1/app/card-offers/hot/${DEAL}`]: ok({
        state: 'NEEDS_CARD',
        cards: [],
        issuers: [{ id: EMP, name: bi('BankCo', 'بنك كو') }],
        activation: null,
      }),
      [`/v1/app/hot-deals/${DEAL}`]: ok(hotDetail()),
    });
    mount(<HotDealPage id={DEAL} />);
    const needs = await screen.findByTestId('card-offer');
    expect(needs).toHaveTextContent('Add an eligible card to activate this offer.');
    expect(needs).toHaveTextContent('Works with cards from BankCo');
    await userEvent.setup().click(within(needs).getByTestId('card-offer-add'));
    expect(nav.push).toHaveBeenCalledWith('/en/benefits?add=card');
  });

  it('a used reservation: log the saving once, and rate the deal', async () => {
    const calls = stub({
      '/v1/app/savings/RESERVATION/': ok({
        canLog: true,
        logged: null,
        currency: 'SAR',
        suggestedMinor: null,
      }),
      '/v1/app/savings': ok({
        canLog: false,
        currency: 'SAR',
        suggestedMinor: null,
        logged: {
          id: '018f0000-0000-7000-8000-00000000ab01',
          sourceType: 'RESERVATION',
          sourceId: RES,
          title: bi('Lunch rush', 'ذروة'),
          merchantName: bi('Najd Kitchen', 'نجد'),
          amountMinor: 1250,
          currency: 'SAR',
          createdAt: inMin(0),
        },
      }),
      [`/v1/app/reservations/${RES}`]: ok(reservation()),
    });
    mount(<ReservationPage id={RES} />);
    const form = await screen.findByTestId('log-saving');
    const user = userEvent.setup();
    await user.click(within(form).getByTestId('saving-submit'));
    expect(await within(form).findByText('Enter an amount greater than zero.')).toBeInTheDocument();
    await user.type(within(form).getByTestId('saving-amount'), '12.50');
    await user.click(within(form).getByTestId('saving-submit'));
    const done = await screen.findByTestId('saving-logged');
    expect(done).toHaveTextContent('Saving logged. Nice one!');
    expect(done).toHaveTextContent('You saved SAR 12.50 with this deal');
    expect(
      calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/app/savings'))!.body,
    ).toEqual({
      sourceType: 'RESERVATION',
      sourceId: RES,
      amountMinor: 1250,
    });
    expect(screen.getByTestId('rate-deal')).toHaveAttribute('href', `/en/hot/${DEAL}?tab=reviews`);
  });

  it('My Deals shows the savings total; the savings page lists each logged saving', async () => {
    const summary = ok({
      totals: [{ currency: 'SAR', amountMinor: 4550, count: 3 }],
      items: [
        {
          id: '018f0000-0000-7000-8000-00000000ab01',
          sourceType: 'VOUCHER',
          sourceId: RES,
          title: bi('Pay 80, get 100', 'ادفع 80'),
          merchantName: bi('Najd Kitchen', 'نجد'),
          amountMinor: 2000,
          currency: 'SAR',
          createdAt: inMin(-60),
        },
      ],
    });
    stub({ '/v1/app/savings': summary });
    const a = mount(<MyDealsPage />);
    expect(await screen.findByTestId('savings-banner')).toHaveTextContent(
      'You have saved SAR 45.50 with DealDash',
    );
    a.unmount();
    stub({ '/v1/app/savings': summary });
    mount(<SavingsPage />);
    expect(await screen.findByTestId('savings-total')).toHaveTextContent('SAR 45.50');
    expect(screen.getByTestId('saving-row')).toHaveTextContent('Najd Kitchen · Pay 80, get 100');
  });

  it('deal reviews: the deal’s own rating in the header, the star breakdown, and a review written after using the deal', async () => {
    nav.params = new URLSearchParams('tab=reviews');
    const calls = stub({
      [`/v1/app/merchants/${ORG}/reviews`]: ok({
        summary: { count: 9, verified: 9, average: 3.1 },
        items: [],
      }),
      [`/v1/app/hot-deals/${DEAL}/reviews`]: (c) =>
        c.method === 'POST'
          ? { status: 201, body: { data: { status: 'PUBLISHED' }, meta: {} } }
          : dealReviews(),
      [`/v1/app/hot-deals/${DEAL}`]: ok(hotDetail()),
    });
    mount(<HotDealPage id={DEAL} />);
    // the deal's rating (4.5 from 2 reviews), not the merchant's 3.1
    const rating = await screen.findByTestId('hot-rating');
    await waitFor(() => expect(rating).toHaveTextContent('4.5'));
    expect(rating).toHaveTextContent('2 reviews');
    // opened on the Reviews tab ("Rate your visit" link)
    expect(screen.getByTestId('hot-tab-reviews')).toHaveAttribute('aria-selected', 'true');
    const panel = await screen.findByTestId('deal-reviews');
    expect(within(panel).getByTestId('deal-review-summary')).toHaveTextContent('4.5');
    expect(within(panel).getByTestId('deal-review')).toHaveTextContent('Lovely kabsa');
    expect(within(panel).getByTestId('deal-review')).toHaveTextContent('Verified visit');
    const user = userEvent.setup();
    await user.click(within(panel).getByTestId('deal-review-write'));
    expect(within(panel).getByTestId('deal-review-post')).toBeDisabled();
    await user.click(within(panel).getByTestId('star-4'));
    await user.type(
      within(panel).getByLabelText('Tell others about this deal'),
      'Great value for the family.',
    );
    await user.click(within(panel).getByTestId('deal-review-post'));
    expect(await within(panel).findByText('Thanks! Your review is published.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url.includes('/reviews'))!.body).toEqual({
      rating: 4,
      text: 'Great value for the family.',
      locale: 'en',
    });
  });

  it('deal reviews: a customer who has not used the deal is told when they can review', async () => {
    nav.params = new URLSearchParams('tab=reviews');
    stub({
      [`/v1/app/merchants/${ORG}/reviews`]: ok({
        summary: { count: 0, verified: 0, average: null },
        items: [],
      }),
      [`/v1/app/hot-deals/${DEAL}/reviews`]: dealReviews({
        summary: { count: 0, average: null, distribution: [0, 0, 0, 0, 0] },
        items: [],
        mine: { canReview: false, reason: 'NOT_REDEEMED' },
      }),
      [`/v1/app/hot-deals/${DEAL}`]: ok(hotDetail()),
    });
    mount(<HotDealPage id={DEAL} />);
    expect(await screen.findByTestId('deal-review-why')).toHaveTextContent(
      'You can review this deal after you use it.',
    );
    expect(screen.queryByTestId('deal-review-write')).toBeNull();
    expect(screen.getByTestId('deal-reviews')).toHaveTextContent('No reviews of this deal yet');
  });

  it('Employee Pass: active pass with employer, number and live clock, plus that employer’s offers; inactive explains why', async () => {
    const pass = {
      status: 'ACTIVE',
      reason: 'VERIFIED',
      employer: { id: EMP, name: bi('Saudi Aramco', 'أرامكو السعودية') },
      programName: bi('Aramco staff', 'موظفو أرامكو'),
      holderName: 'Layla Hassan',
      maskedEmail: 'l***@aramco.com',
      verifiedAt: inMin(-6000),
      validUntil: inMin(60 * 24 * 90),
      passNumber: 'EP-1A2B-3C4D',
      serverNow: new Date().toISOString(),
    };
    stub({
      '/v1/app/benefits/employee-pass': ok(pass),
      '/v1/app/benefits/offers': ok([
        {
          product: 'HOT',
          partners: [{ id: EMP, name: bi('Saudi Aramco', 'أرامكو') }],
          card: { ...hotDetail(), title: bi('Aramco lunch', 'غداء أرامكو') },
        },
        {
          product: 'HOT',
          partners: [{ id: PROG, name: bi('Other', 'أخرى') }],
          card: { ...hotDetail({ id: RES }), title: bi('Not for Aramco', 'ليس لأرامكو') },
        },
      ]),
    });
    const a = mount(<EmployeePassPage />);
    expect(await screen.findByTestId('employee-pass-status')).toHaveTextContent('Active');
    expect(screen.getByTestId('employee-pass-employer')).toHaveTextContent('Saudi Aramco');
    expect(screen.getByTestId('employee-pass-number')).toHaveTextContent('EP-1A2B-3C4D');
    expect(screen.getByTestId('employee-pass-live')).toHaveTextContent(
      /Live pass · \d{2}:\d{2}:\d{2}/,
    );
    const offers = await screen.findByTestId('employee-pass-offers');
    expect(offers).toHaveTextContent('Aramco lunch');
    expect(offers).not.toHaveTextContent('Not for Aramco');
    a.unmount();
    stub({
      '/v1/app/benefits/employee-pass': ok({ ...pass, status: 'INACTIVE', reason: 'EXPIRED' }),
    });
    mount(<EmployeePassPage />, 'ar');
    expect(await screen.findByTestId('employee-pass-status')).toHaveTextContent('غير فعّالة');
    expect(screen.getByTestId('employee-pass-reason')).toHaveTextContent(
      'انتهت صلاحية التحقق من جهة عملك',
    );
    expect(screen.queryByTestId('employee-pass-live')).toBeNull();
  });

  it('merchant gallery: swipeable photos with a counter, a viewer, the Info photos grid; the brand background when there are none', async () => {
    const page = (gallery: string[], coverUrl: string | null) =>
      ok({
        id: ORG,
        name: bi('Najd Kitchen', 'نجد كيتشن'),
        logoUrl: null,
        coverUrl,
        gallery,
        description: bi('Home-style Najdi food.', 'أكل نجدي'),
        category: null,
        phone: '+966500000001',
        branches: [branch],
        deals: [],
        following: false,
        followers: 0,
      });
    stub({ [`/v1/app/merchants/${ORG}`]: page(['/g1.jpg', '/g2.jpg'], '/cover.jpg') });
    const a = mount(<MerchantPageView id={ORG} />);
    const gallery = await screen.findByTestId('merchant-gallery');
    expect(gallery.querySelectorAll('img')).toHaveLength(3);
    expect(screen.getByTestId('merchant-photo-count')).toHaveTextContent('1/3');
    const user = userEvent.setup();
    await user.click(within(gallery).getByRole('button', { name: 'Open photo 2 of 3' }));
    expect(screen.getByTestId('merchant-photo-viewer')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('tab', { name: 'Info' }));
    expect(screen.getByTestId('merchant-photos').querySelectorAll('img')).toHaveLength(3);
    a.unmount();
    stub({ [`/v1/app/merchants/${ORG}`]: page([], null) });
    mount(<MerchantPageView id={ORG} />);
    expect(await screen.findByTestId('merchant-gallery-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('merchant-photo-count')).toBeNull();
  });
});
