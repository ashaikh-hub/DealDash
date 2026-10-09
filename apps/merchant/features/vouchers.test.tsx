import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { VoucherBuilder } from './voucher-builder';
import { VoucherDetailPage } from './voucher-detail';
import { MerchantFinancePage } from './voucher-finance';
import { VouchersHub } from './voucher-hub';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/vouchers',
  useSearchParams: () => new URLSearchParams(),
}));

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const VID = '018f0000-0000-7000-8000-0000000000d1';
const RED = '018f0000-0000-7000-8000-0000000000e1';
const PERMS = [
  'merchant.vouchers.manage',
  'merchant.deals.read',
  'merchant.finance.read',
  'merchant.redemptions.reverse',
  'merchant.branch.read',
];
const me = (permissions = PERMS) => ({
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

interface Call {
  url: string;
  method: string;
  body?: string;
}
type R = { status?: number; body: unknown } | ((c: Call) => { status?: number; body: unknown });
function stub(routes: Record<string, R>) {
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
      if (url.includes('/v1/auth/me')) return json(200, { data: me(), meta: {} });
      // longest key first so '/vouchers/sales' wins over '/vouchers'
      const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
      for (const key of keys)
        if (url.includes(key)) {
          const r = routes[key]!;
          const res = typeof r === 'function' ? r(call) : r;
          return json(res.status ?? 200, res.body);
        }
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const mount = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') =>
  render(<Providers locale={locale}>{ui}</Providers>);

const row = (over: Record<string, unknown> = {}) => ({
  id: VID,
  status: 'ON_SALE',
  title: { en: 'SAR 100 dining voucher', ar: 'قسيمة طعام بقيمة 100 ريال' },
  faceValueHalalas: 10_000,
  sellingPriceHalalas: 8_000,
  branchCount: 2,
  saleStartAt: null,
  saleEndAt: null,
  imageUrl: null,
  totalQty: 50,
  soldQty: 12,
  heldQty: 0,
  redeemedQty: 5,
  updatedAt: new Date().toISOString(),
  ...over,
});

describe('merchant voucher hub', () => {
  it('lists vouchers with value, price, sold and used; the status filter changes the query; the type switch has Vouchers', async () => {
    const calls = stub({ '/vouchers': { body: { data: [row()], meta: {} } } });
    mount(<VouchersHub />);
    const r = await screen.findByTestId('voucher-row');
    expect(r).toHaveTextContent('SAR 100.00 / SAR 80.00');
    expect(r).toHaveTextContent('12 / 50');
    expect(within(screen.getByTestId('deals-type-switch')).getByText('Vouchers')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await userEvent.setup().selectOptions(screen.getByLabelText('Status'), 'PAUSED');
    await waitFor(() => expect(calls.some((c) => c.url.includes('status=PAUSED'))).toBe(true));
  });

  it('an empty hub explains the first step', async () => {
    stub({ '/vouchers': { body: { data: [], meta: {} } } });
    mount(<VouchersHub />);
    expect(await screen.findByText('No vouchers yet')).toBeInTheDocument();
  });
});

describe('voucher builder', () => {
  const options = {
    '/hot-deal-choices': {
      body: {
        data: {
          categories: [
            {
              id: '018f0000-0000-7000-8000-0000000000c1',
              code: 'dining',
              nameEn: 'Dining',
              nameAr: 'المطاعم',
            },
          ],
          eligibility: { employers: [], banks: [], schemes: [], cities: ['Riyadh'] },
        },
        meta: {},
      },
    },
    '/voucher-options': {
      body: {
        data: {
          limits: {
            minValidityDays: 7,
            maxValidityDays: 365,
            maxFaceValueHalalas: 500_000,
            maxQtyPerVoucher: 100_000,
            maxPerCustomer: 10,
            reviewAboveDiscountPercent: 70,
          },
          checkoutHoldMinutes: 10,
          refundPolicy: { windowHours: 24, outsideWindow: 'REVIEW', placeholder: true },
          payableRule: { accrualPoint: 'REDEMPTION', placeholder: true },
        },
        meta: {},
      },
    },
    '/branches': { body: { data: [], meta: {} } },
  };

  it('shows the reported savings live, and refuses a price above the value before anything is saved', async () => {
    const calls = stub(options);
    mount(<VoucherBuilder />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Voucher value \(SAR\)/), '100');
    await user.type(screen.getByLabelText(/Selling price \(SAR\)/), '120');
    expect(screen.queryByTestId('builder-savings')).toBeNull();
    await user.click(screen.getByTestId('builder-next'));
    expect(await screen.findByText('The price cannot be more than the value')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false); // nothing saved while the step is invalid
    await user.clear(screen.getByLabelText(/Selling price \(SAR\)/));
    await user.type(screen.getByLabelText(/Selling price \(SAR\)/), '80');
    expect(screen.getByTestId('builder-savings')).toHaveTextContent('SAR 20.00 (20%)');
    expect(document.body.textContent!.toLowerCase()).not.toContain('guarantee');
  });

  it('the builder is bilingual: both language fields exist on the content step and Arabic is right-to-left', async () => {
    stub(options);
    mount(<VoucherBuilder />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Voucher value \(SAR\)/), '100');
    await user.type(screen.getByLabelText(/Selling price \(SAR\)/), '80');
    await user.type(screen.getByLabelText(/Number of vouchers/), '20');
    await user.selectOptions(screen.getByLabelText(/Category/), 'Dining');
    stub({
      ...options,
      [`/vouchers/${VID}/preview`]: {
        status: 404,
        body: { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} },
      },
      '/vouchers': {
        status: 201,
        body: {
          data: {
            id: VID,
            version: 1,
            status: 'DRAFT',
            content: {},
            media: [],
            guardrail: { outcome: 'MANUAL_REVIEW', reasons: [] },
            issues: [],
            allowedActions: ['edit', 'submit'],
            savings: { savingsHalalas: 0, savingsPercent: 0 },
            updatedAt: new Date().toISOString(),
          },
          meta: {},
        },
      },
    });
    await user.click(screen.getByTestId('builder-next'));
    const ar = await screen.findByLabelText(/Voucher title \(Arabic\)/);
    expect(ar).toHaveAttribute('dir', 'rtl');
    expect(screen.getByLabelText(/Voucher title \(English\)/)).toHaveAttribute('dir', 'ltr');
  });
});

describe('voucher detail and finance', () => {
  const view = {
    id: VID,
    organizationId: ORG,
    status: 'ON_SALE',
    version: 3,
    content: {
      title: { en: 'SAR 100 dining voucher', ar: 'قسيمة طعام' },
      faceValueHalalas: 10_000,
      sellingPriceHalalas: 8_000,
    },
    media: [],
    stock: { total: 50, held: 1, sold: 12, remaining: 37 },
    savings: { savingsHalalas: 2000, savingsPercent: 20 },
    pausedBy: null,
    latestDecision: null,
    allowedActions: ['edit_minor', 'pause', 'end', 'stock'],
  };
  const monitor = {
    status: 'ON_SALE',
    stock: view.stock,
    sales: { sold: 12, active: 6, redeemed: 5, expired: 0, refunded: 1, redemptionRatePct: 42 },
    funnel: {
      impressions: 300,
      detailViews: 80,
      checkoutsStarted: 20,
      paymentsSucceeded: 12,
      paymentsFailed: 3,
    },
    finance: {
      soldGrossHalalas: 96_000,
      redeemedGrossHalalas: 40_000,
      settlementEligibleHalalas: 36_000,
      refundedHalalas: 8_000,
    },
  };
  const sale = (over: Record<string, unknown> = {}) => ({
    id: '018f0000-0000-7000-8000-0000000000f1',
    reference: 'VC-K7QM9T',
    voucherId: VID,
    title: view.content.title,
    customerFirstName: 'Layla',
    status: 'REDEEMED',
    pricePaidHalalas: 8000,
    faceValueHalalas: 10_000,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date().toISOString(),
    redeemedAt: new Date().toISOString(),
    redeemedBranch: { en: 'Olaya', ar: 'العليا' },
    redemptionId: RED,
    redemptionReference: 'RD-1',
    canReverse: true,
    ...over,
  });

  it('monitor shows sales, the measurable funnel and verified money only', async () => {
    stub({
      [`/vouchers/${VID}/monitor`]: { body: { data: monitor, meta: {} } },
      [`/vouchers/${VID}`]: { body: { data: view, meta: {} } },
    });
    mount(<VoucherDetailPage voucherId={VID} />);
    expect(await screen.findByTestId('kpi-sold')).toHaveTextContent('12');
    expect(screen.getByTestId('kpi-used')).toHaveTextContent('5');
    expect(screen.getByTestId('money-eligible')).toHaveTextContent('SAR 360.00');
    expect(screen.getByTestId('open-pause')).toBeInTheDocument();
    expect(screen.getByTestId('open-capacity')).toBeInTheDocument();
  });

  it('sales show first names only; reversing a redemption needs a reason and posts once', async () => {
    const calls = stub({
      [`/vouchers/${VID}/monitor`]: { body: { data: monitor, meta: {} } },
      '/vouchers/sales': { body: { data: [sale()], meta: {} } },
      '/reverse': { body: { data: { id: RED, status: 'REVERSED' }, meta: {} } },
      [`/vouchers/${VID}`]: { body: { data: view, meta: {} } },
    });
    mount(<VoucherDetailPage voucherId={VID} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Sales' }));
    const r = await screen.findByTestId('sale-row');
    expect(r).toHaveTextContent('Layla');
    expect(r.textContent).not.toMatch(/\+966|@/);
    await user.click(screen.getByTestId('sale-reverse'));
    expect(screen.getByTestId('confirm-reason')).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'Staff scanned the wrong voucher');
    await user.click(screen.getByTestId('confirm-reason'));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/reverse') && c.method === 'POST')).toHaveLength(
        1,
      ),
    );
    expect(JSON.parse(calls.find((c) => c.url.endsWith('/reverse'))!.body!)).toEqual({
      reason: 'Staff scanned the wrong voucher',
    });
  });

  it('finance shows held versus settlement-eligible, the rule, and the placeholder legal note', async () => {
    stub({
      '/voucher-payable/events': {
        body: {
          data: [
            {
              id: 'e1',
              type: 'ELIGIBLE',
              amountHalalas: 7200,
              feeHalalas: 800,
              instanceReference: 'VC-K7QM9T',
              voucherTitle: view.content.title,
              createdAt: new Date().toISOString(),
              note: null,
            },
          ],
          meta: {},
        },
      },
      '/voucher-payable': {
        body: {
          data: {
            currency: 'SAR',
            heldHalalas: 40_000,
            settlementEligibleHalalas: 7200,
            platformFeeHalalas: 800,
            refundedHalalas: 0,
            expiredValueHalalas: 0,
            accrualPoint: 'REDEMPTION',
            counts: { sold: 6, redeemed: 1, refunded: 0, expired: 0 },
            disclaimerKey: 'legal_treatment_validate_ksa',
          },
          meta: {},
        },
      },
    });
    mount(<MerchantFinancePage />);
    expect(await screen.findByTestId('fin-held')).toHaveTextContent('SAR 400.00');
    expect(screen.getByTestId('fin-eligible')).toHaveTextContent('SAR 72.00');
    expect(screen.getByText(/after the voucher is used/)).toBeInTheDocument();
    expect(screen.getByText(/still being confirmed/)).toBeInTheDocument();
    expect(await screen.findByTestId('payable-event')).toHaveTextContent('Settlement-eligible');
  });
});
