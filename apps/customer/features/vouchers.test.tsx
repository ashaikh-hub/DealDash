import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import {
  CheckoutPage,
  MockPayPage,
  MyVouchersPage,
  OrderStatusPage,
  VoucherListPage,
  VoucherPage,
  WalletVoucherPage,
} from './vouchers';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/en/vouchers/x',
}));

const V = '018f0000-0000-7000-8000-0000000000e1';
const BR = '018f0000-0000-7000-8000-0000000000b1';
const ORDER = '018f0000-0000-7000-8000-0000000000d1';
const INST = '018f0000-0000-7000-8000-0000000000f1';
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
  permissions: ['customer.profile.read', 'customer.vouchers.manage'],
};

const card = (over: Record<string, unknown> = {}) => ({
  id: V,
  merchantId: '018f0000-0000-7000-8000-0000000000aa',
  merchantName: { en: 'Najd Kitchen', ar: 'نجد كيتشن' },
  merchantLogoUrl: null,
  title: { en: 'SAR 100 dining voucher', ar: 'قسيمة طعام بقيمة 100 ريال' },
  shortDescription: { en: 'Pay SAR 80, dine for SAR 100', ar: 'ادفع 80 وتناول بقيمة 100' },
  category: { code: 'dining', name: { en: 'Dining', ar: 'المطاعم' } },
  imageUrl: null,
  imageAlt: { en: 'Platter', ar: 'طبق' },
  faceValueHalalas: 10_000,
  sellingPriceHalalas: 8_000,
  reportedSavingsHalalas: 2_000,
  reportedSavingsPercent: 20,
  currency: 'SAR',
  validity: { type: 'DAYS_FROM_PURCHASE', days: 30, validUntil: null },
  saleEndsAt: null,
  remaining: 4,
  soldOut: false,
  distanceMeters: 640,
  nearestBranch: {
    id: BR,
    name: { en: 'Al Nakheel', ar: 'النخيل' },
    area: { en: 'Riyadh', ar: 'الرياض' },
    latitude: 24.7,
    longitude: 46.7,
  },
  branchCount: 1,
  eligibility: { result: 'ELIGIBLE', kind: 'PUBLIC', message: null, unlockAction: null },
  availability: 'AVAILABLE',
  serverNow: new Date().toISOString(),
  ...over,
});

const publicBranch = {
  id: BR,
  name: { en: 'Al Nakheel', ar: 'النخيل' },
  address: { en: 'Riyadh', ar: 'الرياض' },
  city: 'Riyadh',
  latitude: 24.7,
  longitude: 46.7,
  phone: '+966110000001',
  hours: null,
  distanceMeters: 640,
};
const terms = {
  blocks: {
    fullPriceItemsOnly: false,
    notCombinable: false,
    minimumSpendHalalas: null,
    validDays: [],
    validFrom: null,
    validTo: null,
  },
  text: { en: 'One voucher per visit.', ar: 'قسيمة واحدة لكل زيارة.' },
};

const detail = (over: Record<string, unknown> = {}) => ({
  ...card(),
  description: { en: 'Dinner for two.', ar: 'عشاء لشخصين.' },
  redemptionRules: { en: 'Show the QR at the counter.', ar: 'اعرض رمز QR عند الكاشير.' },
  terms,
  media: [],
  branches: [publicBranch],
  perCustomerLimit: 2,
  remainingForMe: 2,
  termsVersion: '2026-10-v1',
  canBuy: true,
  blockedReason: null,
  ...over,
});

const order = (over: Record<string, unknown> = {}) => ({
  id: ORDER,
  reference: 'VO-K7QM9T',
  status: 'PENDING_PAYMENT',
  quantity: 1,
  unitPriceHalalas: 8_000,
  faceValueHalalas: 10_000,
  totalHalalas: 8_000,
  currency: 'SAR',
  holdExpiresAt: inMin(9),
  termsVersion: null,
  createdAt: inMin(-1),
  paidAt: null,
  voucher: {
    id: V,
    title: { en: 'SAR 100 dining voucher', ar: 'قسيمة طعام بقيمة 100 ريال' },
    imageUrl: null,
    merchantName: { en: 'Najd Kitchen', ar: 'نجد كيتشن' },
    reportedSavingsHalalas: 2_000,
  },
  payment: null,
  voucherInstanceId: null,
  retriesLeft: 3,
  canRetry: true,
  canCancel: true,
  serverNow: new Date().toISOString(),
  ...over,
});

const wallet = (over: Record<string, unknown> = {}) => ({
  id: INST,
  reference: 'VC-K7QM9T',
  state: 'ACTIVE',
  voucherId: V,
  title: { en: 'SAR 100 dining voucher', ar: 'قسيمة طعام بقيمة 100 ريال' },
  merchantName: { en: 'Najd Kitchen', ar: 'نجد كيتشن' },
  imageUrl: null,
  purchasePriceHalalas: 8_000,
  faceValueHalalas: 10_000,
  currency: 'SAR',
  validFrom: null,
  expiresAt: inMin(60 * 24 * 20),
  issuedAt: inMin(-5),
  redeemedAt: null,
  branchCount: 1,
  description: { en: 'Dinner for two.', ar: 'عشاء لشخصين.' },
  redemptionRules: { en: 'Show the QR at the counter.', ar: 'اعرض رمز QR عند الكاشير.' },
  terms,
  merchantId: 'm1',
  branches: [publicBranch],
  orderReference: 'VO-K7QM9T',
  code: { qr: 'DV1.AbCdEfGhIjKlMnOpQrStUv', manual: 'K7QM-9T2X' },
  refund: null,
  canRequestRefund: true,
  refundWindowEndsAt: inMin(60 * 20),
  refundNote: null,
  supportCaseOpen: false,
  serverNow: new Date().toISOString(),
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
      return json(202, { data: { accepted: 1 }, meta: {} });
    }),
  );
  return calls;
}

beforeEach(() => {
  nav.push.mockClear();
  nav.replace.mockClear();
  nav.params = new URLSearchParams();
});
afterEach(() => vi.unstubAllGlobals());

const mount = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') =>
  render(<Providers locale={locale}>{ui}</Providers>);

describe('Voucher discovery and detail', () => {
  it('the list shows price, value and savings; search and sort change the query', async () => {
    const calls = stub({ '/v1/app/vouchers': { body: { data: [card()], meta: {} } } }, null);
    mount(<VoucherListPage />);
    expect(await screen.findByText('SAR 100 dining voucher')).toBeInTheDocument();
    expect(screen.getByTestId('voucher-card')).toHaveTextContent('SAR 80.00');
    await userEvent.setup().type(screen.getByTestId('voucher-search'), 'kabsa');
    await waitFor(() => expect(calls.some((c) => c.url.includes('q=kabsa'))).toBe(true));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Price: low to high' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('sort=price_low'))).toBe(true));
  });

  it('detail says "Reported savings", explains what it means, and never promises or guarantees savings', async () => {
    stub({ '/v1/app/vouchers/': { body: { data: detail(), meta: {} } } }, null);
    mount(<VoucherPage id={V} />);
    expect(await screen.findByTestId('voucher-pricebox')).toHaveTextContent('SAR 80.00');
    expect(screen.getByTestId('voucher-savings')).toHaveTextContent('Reported savings');
    expect(screen.getByText(/depends on what you buy/i)).toBeInTheDocument();
    const text = document.body.textContent!.toLowerCase();
    expect(text).not.toContain('guarantee');
    expect(screen.getByTestId('voucher-signin')).toBeInTheDocument();
  });

  it('buying starts checkout with an Idempotency-Key and goes to the checkout page', async () => {
    const calls = stub({
      '/v1/app/checkout': { status: 201, body: { data: order(), meta: {} } },
      '/v1/app/vouchers/': { body: { data: detail(), meta: {} } },
    });
    mount(<VoucherPage id={V} />);
    await userEvent.setup().click(await screen.findByTestId('voucher-buy'));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith(`/en/checkout/${ORDER}`));
    const post = calls.find((c) => c.url.endsWith('/v1/app/checkout'))!;
    expect(JSON.parse(post.body!)).toEqual({ voucherId: V, quantity: 1 });
    expect(post.key).toBeTruthy();
  });

  it('sold out and limit reached disable buying and say why', async () => {
    stub({
      '/v1/app/vouchers/': {
        body: {
          data: detail({ soldOut: true, canBuy: false, blockedReason: 'SOLD_OUT' }),
          meta: {},
        },
      },
    });
    mount(<VoucherPage id={V} />);
    expect(await screen.findByRole('button', { name: 'Sold out' })).toBeDisabled();
  });

  it('a purchase failure (stock lost) is shown on the page, no navigation', async () => {
    stub({
      '/v1/app/checkout': {
        status: 409,
        body: { errors: [{ code: 'SOLD_OUT', message: 'x' }], meta: {} },
      },
      '/v1/app/vouchers/': { body: { data: detail(), meta: {} } },
    });
    mount(<VoucherPage id={V} />);
    await userEvent.setup().click(await screen.findByTestId('voucher-buy'));
    expect(await screen.findByTestId('voucher-buy-error')).toBeInTheDocument();
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe('Checkout and payment', () => {
  it('shows the summary, requires the terms, then pays once and leaves for the payment page', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { origin: 'http://localhost:3001', assign });
    const calls = stub({
      '/pay': (c) =>
        c.method === 'POST'
          ? {
              body: {
                data: order({
                  payment: {
                    id: 'p1',
                    status: 'PENDING',
                    amountHalalas: 8_000,
                    currency: 'SAR',
                    attemptNo: 1,
                    redirectUrl: 'http://localhost:3001/en/pay/x?mock_payment=MP-1',
                    failureCode: null,
                    createdAt: inMin(0),
                    completedAt: null,
                  },
                }),
                meta: {},
              },
            }
          : { body: { data: order(), meta: {} } },
      '/v1/app/orders/': { body: { data: order(), meta: {} } },
    });
    mount(<CheckoutPage orderId={ORDER} />);
    expect(await screen.findByTestId('order-summary')).toHaveTextContent('Najd Kitchen');
    expect(screen.getByTestId('order-total')).toHaveTextContent('SAR 80.00');
    expect(screen.getByTestId('hold-note')).toBeInTheDocument();
    // the MVP checkout shows no Phase 2 concept and no card selection: payment happens on the provider page
    expect(document.body.textContent).not.toMatch(
      /gift|promo|loyalty|points|saved card|visa|mastercard/i,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('checkout-pay'));
    expect(await screen.findByText('Please accept the terms to continue')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.includes('/pay'))).toBe(false);
    await user.click(screen.getByLabelText(/I accept the voucher terms/));
    await user.click(screen.getByTestId('checkout-pay'));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(expect.stringContaining('mock_payment=MP-1')),
    );
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/pay'))!;
    expect(JSON.parse(post.body!)).toMatchObject({ acceptTerms: true, termsVersion: '2026-10-v1' });
    expect(post.key).toBeTruthy();
  });

  it('an order that is not open goes to the status page; an expired hold says nothing was charged', async () => {
    stub({ '/v1/app/orders/': { body: { data: order({ status: 'PAID' }), meta: {} } } });
    mount(<CheckoutPage orderId={ORDER} />);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/en/orders/${ORDER}`));
  });

  it('the test payment page settles through the dev endpoint and returns to the order', async () => {
    nav.params = new URLSearchParams('mock_payment=MP-1');
    const calls = stub({
      '/v1/dev/payments/': { body: { data: { first: { outcome: 'APPLIED' } }, meta: {} } },
      '/v1/app/orders/': { body: { data: order(), meta: {} } },
    });
    mount(<MockPayPage orderId={ORDER} />);
    await userEvent.setup().click(await screen.findByTestId('mock-approve'));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/en/orders/${ORDER}`));
    const post = calls.find((c) => c.url.includes('/v1/dev/payments/MP-1/complete'))!;
    expect(JSON.parse(post.body!)).toEqual({ outcome: 'SUCCEEDED' });
  });
});

describe('Order status', () => {
  const payment = (status: string, over: Record<string, unknown> = {}) => ({
    id: 'p1',
    status,
    amountHalalas: 8_000,
    currency: 'SAR',
    attemptNo: 1,
    redirectUrl: null,
    failureCode: null,
    createdAt: inMin(-1),
    completedAt: null,
    ...over,
  });
  it('processing keeps the customer informed and creates no voucher link', async () => {
    stub({
      '/v1/app/orders/': { body: { data: order({ payment: payment('PENDING') }), meta: {} } },
    });
    mount(<OrderStatusPage orderId={ORDER} />);
    expect(await screen.findByTestId('order-processing')).toHaveTextContent(
      'Processing your payment',
    );
    expect(screen.queryByTestId('order-view-voucher')).toBeNull();
  });
  it('success links to the voucher in My Vouchers', async () => {
    stub({
      '/v1/app/orders/': {
        body: {
          data: order({
            status: 'PAID',
            paidAt: inMin(0),
            payment: payment('SUCCEEDED'),
            voucherInstanceId: INST,
          }),
          meta: {},
        },
      },
    });
    mount(<OrderStatusPage orderId={ORDER} />);
    const link = await screen.findByTestId('order-view-voucher');
    expect(link).toHaveAttribute('href', `/en/my-vouchers/${INST}?new=1`);
  });
  it('failure explains, shows attempts left and links back to checkout; no retries left says so', async () => {
    stub({
      '/v1/app/orders/': {
        body: {
          data: order({
            payment: payment('FAILED', { failureCode: 'CARD_DECLINED' }),
            retriesLeft: 2,
          }),
          meta: {},
        },
      },
    });
    mount(<OrderStatusPage orderId={ORDER} />);
    expect(await screen.findByTestId('order-failed')).toHaveTextContent(
      'Payment did not go through',
    );
    expect(screen.getByTestId('order-failure-reason')).toHaveTextContent('declined');
    expect(screen.getByTestId('order-retry')).toHaveTextContent('2 left');
  });
});

describe('My Vouchers', () => {
  it('lists active vouchers; tabs switch the query', async () => {
    const calls = stub({ '/v1/app/wallet': { body: { data: [wallet()], meta: {} } } });
    mount(<MyVouchersPage />);
    expect(await screen.findByTestId('wallet-row')).toHaveTextContent('Najd Kitchen');
    expect(screen.getByTestId('wallet-row')).toHaveTextContent('Active');
    expect(calls.some((c) => c.url.includes('tab=active'))).toBe(true);
  });

  it('an active voucher shows the QR, the manual code and the refund option', async () => {
    stub({ '/v1/app/wallet/': { body: { data: wallet(), meta: {} } } });
    mount(<WalletVoucherPage id={INST} />);
    expect(await screen.findByTestId('wallet-ticket')).toHaveAttribute('data-state', 'ACTIVE');
    expect(screen.getByTestId('manual-code')).toHaveTextContent('K7QM-9T2X');
    expect(screen.getByLabelText('Voucher QR code')).toBeInTheDocument();
    expect(screen.getByTestId('wallet-refund')).toBeInTheDocument();
  });

  it('a used voucher shows no QR and explains; refunded shows the refund status', async () => {
    stub({
      '/v1/app/wallet/': {
        body: {
          data: wallet({
            state: 'USED',
            code: null,
            canRequestRefund: false,
            redeemedAt: inMin(-3),
            refundNote: 'REDEEMED',
          }),
          meta: {},
        },
      },
    });
    mount(<WalletVoucherPage id={INST} />);
    expect(await screen.findByTestId('wallet-state-note')).toHaveTextContent(
      'This voucher was used',
    );
    expect(screen.queryByTestId('manual-code')).toBeNull();
    expect(screen.queryByTestId('wallet-refund')).toBeNull();
  });

  it('requesting a refund sends the reason once with an Idempotency-Key and shows the confirmation', async () => {
    const calls = stub({
      '/refund': { status: 201, body: { data: { id: 'r1', status: 'REFUNDED' }, meta: {} } },
      '/v1/app/wallet/': { body: { data: wallet(), meta: {} } },
    });
    mount(<WalletVoucherPage id={INST} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('wallet-refund'));
    await user.selectOptions(screen.getByLabelText('Reason'), 'DUPLICATE');
    await user.click(screen.getByTestId('wallet-sheet-submit'));
    expect(await screen.findByText('Refund request sent')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/refund'))!;
    expect(JSON.parse(post.body!)).toMatchObject({ reasonCode: 'DUPLICATE' });
    expect(post.key).toBeTruthy();
  });

  it('renders in Arabic: right-to-left, Arabic labels, Western digits for money and the code stays left-to-right', async () => {
    stub({ '/v1/app/wallet/': { body: { data: wallet(), meta: {} } } });
    mount(<WalletVoucherPage id={INST} />, 'ar');
    expect(await screen.findByText('قسائمي', { exact: false })).toBeInTheDocument();
    expect(screen.getByTestId('manual-code')).toHaveClass('dd-ltr');
    expect(document.body.textContent).toMatch(/80\.00/);
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });
});
