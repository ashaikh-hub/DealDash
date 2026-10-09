import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { FinanceOrderPage, FinanceWorkbench } from './finance';
import { AdminVoucherReviewPage, AdminVouchersPage } from './vouchers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/vouchers',
  useSearchParams: () => new URLSearchParams(),
}));

const VID = '018f0000-0000-7000-8000-0000000000d1';
const ORDER = '018f0000-0000-7000-8000-0000000000a1';
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
    roleCode: 'DEALDASH_FINANCE',
    branchId: null,
  },
  memberships: [],
  permissions,
});
const OPS = [
  'admin.campaigns.review',
  'admin.campaigns.control',
  'admin.vouchers.lookup',
  'admin.payments.read',
  'admin.refunds.manage',
];

interface Call {
  url: string;
  method: string;
  body?: string;
}
type R = { status?: number; body: unknown } | ((c: Call) => { status?: number; body: unknown });
function stub(routes: Record<string, R>, perms = OPS) {
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
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms), meta: {} });
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length))
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
const bi = (en: string, ar: string) => ({ en, ar });

const preview = {
  id: VID,
  merchantId: 'm1',
  merchantName: bi('Najd Kitchen', 'نجد كيتشن'),
  merchantLogoUrl: null,
  title: bi('SAR 100 dining voucher', 'قسيمة طعام بقيمة 100 ريال'),
  shortDescription: bi('Pay 80', 'ادفع 80'),
  category: null,
  imageUrl: null,
  imageAlt: bi('', ''),
  faceValueHalalas: 10_000,
  sellingPriceHalalas: 8_000,
  reportedSavingsHalalas: 2000,
  reportedSavingsPercent: 20,
  currency: 'SAR',
  validity: { type: 'DAYS_FROM_PURCHASE', days: 30, validUntil: null },
  saleEndsAt: null,
  remaining: 50,
  soldOut: false,
  distanceMeters: null,
  nearestBranch: null,
  branchCount: 1,
  eligibility: { result: 'ELIGIBLE', kind: 'PUBLIC', message: null, unlockAction: null },
  availability: 'AVAILABLE',
  serverNow: new Date().toISOString(),
  description: bi('Dinner for two.', 'عشاء لشخصين.'),
  redemptionRules: bi('Show the QR.', 'اعرض الرمز.'),
  terms: {
    blocks: {
      fullPriceItemsOnly: false,
      notCombinable: false,
      minimumSpendHalalas: null,
      validDays: [],
      validFrom: null,
      validTo: null,
    },
    text: bi('', ''),
  },
  media: [],
  branches: [],
  perCustomerLimit: 1,
  remainingForMe: 1,
  termsVersion: '2026-10-v1',
  canBuy: true,
  blockedReason: null,
};

const detail = (over: Record<string, unknown> = {}) => ({
  id: VID,
  organizationId: 'm1',
  status: 'PENDING_REVIEW',
  version: 2,
  content: {
    categoryId: null,
    title: bi('SAR 100 dining voucher', 'قسيمة طعام بقيمة 100 ريال'),
    shortDescription: bi('Pay 80', 'ادفع 80'),
    description: bi('Dinner for two.', 'عشاء لشخصين.'),
    redemptionRules: bi('Show the QR.', 'اعرض الرمز.'),
    media: [],
    faceValueHalalas: 10_000,
    sellingPriceHalalas: 8_000,
    totalQty: 50,
    perCustomerLimit: 1,
    validity: { type: 'DAYS_FROM_PURCHASE', days: 30, validUntil: null },
    saleStartAt: null,
    saleEndAt: null,
    branchIds: [],
    eligibility: { kind: 'PUBLIC', valueRefs: [] },
    terms: { blocks: preview.terms.blocks, textEn: 'One per visit.', textAr: 'واحدة لكل زيارة.' },
  },
  stock: { total: 50, held: 0, sold: 0, remaining: 50 },
  savings: { savingsHalalas: 2000, savingsPercent: 20 },
  guardrail: { outcome: 'MANUAL_REVIEW', reasons: ['DISCOUNT_ABOVE_RANGE'] },
  merchant: {
    id: 'm1',
    nameEn: 'Najd Kitchen',
    nameAr: 'نجد كيتشن',
    legalName: 'Najd Kitchen LLC',
    commercialRegistration: '1010000000',
    status: 'ACTIVE',
    trustLevel: 'NEW',
    riskTier: 'LOW',
  },
  branches: [{ id: 'b1', name: bi('Olaya', 'العليا'), city: 'Riyadh', status: 'ACTIVE' }],
  history: [],
  preview,
  reviewTarget: 'VOUCHER',
  adminActions: ['approve', 'request_changes', 'reject'],
  commercial: {
    savings: { savingsHalalas: 2000, savingsPercent: 20 },
    reviewAboveDiscountPercent: 70,
    discountFlag: true,
    refundPolicy: { windowHours: 24, outsideWindow: 'REVIEW', placeholder: true },
    payableRule: {
      accrualPoint: 'REDEMPTION',
      feePercentBps: 1000,
      feeFixedHalalas: 0,
      placeholder: true,
    },
    expiredValuePolicy: 'UNDECIDED_VALIDATE_KSA',
  },
  ...over,
});

describe('admin voucher review', () => {
  it('the queue lists vouchers waiting for review', async () => {
    const calls = stub({
      '/v1/admin/vouchers': {
        body: {
          data: [
            {
              id: VID,
              status: 'PENDING_REVIEW',
              title: bi('SAR 100 dining voucher', 'x'),
              faceValueHalalas: 10_000,
              sellingPriceHalalas: 8_000,
              merchant: { id: 'm1', nameEn: 'Najd Kitchen', nameAr: 'نجد', trustLevel: 'NEW' },
              branchCount: 1,
              totalQty: 50,
              submittedAt: new Date().toISOString(),
              saleStartAt: null,
              saleEndAt: null,
            },
          ],
          meta: {},
        },
      },
    });
    mount(<AdminVouchersPage />);
    expect(await screen.findByTestId('admin-voucher-row')).toHaveTextContent('Najd Kitchen');
    expect(calls.some((c) => c.url.includes('queue=true'))).toBe(true);
  });

  it('the workbench shows merchant, commercial checks, the placeholder refund and payable rules and both languages', async () => {
    stub({ [`/v1/admin/vouchers/${VID}`]: { body: { data: detail(), meta: {} } } });
    mount(<AdminVoucherReviewPage id={VID} />);
    const commercial = await screen.findByTestId('voucher-commercial');
    expect(commercial).toHaveTextContent('SAR 100.00');
    expect(commercial).toHaveTextContent('SAR 20.00 (20%)');
    expect(screen.getByTestId('discount-flag')).toBeInTheDocument();
    const rules = screen.getByTestId('voucher-rules');
    expect(rules).toHaveTextContent('To be confirmed');
    expect(rules).toHaveTextContent('10%');
    expect(screen.getByTestId('content-ar')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('Najd Kitchen LLC')).toBeInTheDocument();
  });

  it('approving needs a reason and posts it once; the audit trail shows the decision', async () => {
    const calls = stub({
      [`/v1/admin/vouchers/${VID}/approve`]: {
        body: { data: detail({ status: 'ON_SALE', adminActions: ['pause', 'suspend'] }), meta: {} },
      },
      [`/v1/admin/vouchers/${VID}`]: { body: { data: detail(), meta: {} } },
    });
    mount(<AdminVoucherReviewPage id={VID} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('act-approve'));
    await user.click(screen.getByTestId('decision-confirm'));
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/approve') && c.method === 'POST')).toHaveLength(
        1,
      ),
    );
    expect(
      JSON.parse(calls.find((c) => c.url.endsWith('/approve'))!.body!).reason.length,
    ).toBeGreaterThan(2);
    expect(await screen.findByText('Done')).toBeInTheDocument();
  });

  it('a reviewer without control rights sees no pause or suspend; control actions are offered only when allowed', async () => {
    stub(
      {
        [`/v1/admin/vouchers/${VID}`]: {
          body: { data: detail({ status: 'ON_SALE', adminActions: [] }), meta: {} },
        },
      },
      ['admin.campaigns.review'],
    );
    mount(<AdminVoucherReviewPage id={VID} />);
    await screen.findByTestId('voucher-review');
    expect(screen.queryByTestId('act-suspend')).toBeNull();
    expect(screen.queryByTestId('act-approve')).toBeNull();
  });
});

const refund = (over: Record<string, unknown> = {}) => ({
  id: '018f0000-0000-7000-8000-0000000000r1'.replace('r', 'a'),
  reference: 'RF-K7QM9T',
  status: 'UNDER_REVIEW',
  kind: 'CUSTOMER_REQUEST',
  amountHalalas: 8_000,
  reasonCode: 'CHANGED_MIND',
  createdAt: new Date().toISOString(),
  decidedAt: null,
  refundedAt: null,
  decisionNote: null,
  orderReference: 'VO-K7QM9T',
  voucherReference: 'VC-K7QM9T',
  merchant: bi('Najd Kitchen', 'نجد كيتشن'),
  customerFirstName: 'Layla',
  requestedByRole: null,
  needsChecker: false,
  actions: ['approve', 'reject'],
  note: null,
  ...over,
});

describe('admin finance workbench', () => {
  it('overview reports ledger health and the merchants payable split', async () => {
    stub({
      '/v1/admin/finance/overview': {
        body: {
          data: {
            counts: {
              ordersPendingPayment: 2,
              refundsOpen: 1,
              refundsFailed: 0,
              paymentsLast24h: 9,
              failedLast24h: 1,
              refundsLast24h: 0,
            },
            ledger: {
              balanced: true,
              journals: 14,
              heldHalalas: 40_000,
              settlementEligibleHalalas: 7200,
              platformRevenueHalalas: 800,
              pspClearingHalalas: 48_000,
              expiredValueHalalas: 0,
            },
            merchants: [
              {
                merchant: { id: 'm1', nameEn: 'Najd Kitchen', nameAr: 'نجد' },
                heldHalalas: 40_000,
                settlementEligibleHalalas: 7200,
                platformFeeHalalas: 800,
                refundedHalalas: 0,
                expiredValueHalalas: 0,
              },
            ],
            disclaimerKey: 'legal_treatment_validate_ksa',
          },
          meta: {},
        },
      },
    });
    mount(<FinanceWorkbench />);
    expect(await screen.findByTestId('ledger-balanced')).toHaveTextContent('Balanced');
    expect(screen.getByTestId('payable-row')).toHaveTextContent('SAR 72.00');
    expect(screen.getByText(/VALIDATE-KSA|Placeholder figures/)).toBeInTheDocument();
  });

  it('Support (no payment rights) starts at the lookup and sees no Overview tab, so no forbidden request is made', async () => {
    const calls = stub({}, ['admin.vouchers.lookup']);
    mount(<FinanceWorkbench />);
    expect(await screen.findByTestId('finance-lookup')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Overview' })).toBeNull();
    expect(calls.some((c) => c.url.includes('/finance/overview'))).toBe(false);
  });

  it('refunds: an approvable request needs a reason; one waiting for a second approver offers no approve button', async () => {
    const calls = stub({
      '/v1/admin/finance/refunds/': { body: { data: refund({ status: 'APPROVED' }), meta: {} } },
      '/v1/admin/finance/refunds': {
        body: {
          data: [
            refund(),
            refund({
              id: '018f0000-0000-7000-8000-0000000000a2',
              reference: 'RF-ADMIN1',
              kind: 'ADMIN_EXCEPTION',
              needsChecker: true,
              actions: [],
            }),
          ],
          meta: {},
        },
      },
    });
    mount(<FinanceWorkbench />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Refunds' }));
    const rows = await screen.findAllByTestId('refund-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]!).queryByTestId('refund-approve')).toBeNull();
    expect(within(rows[1]!).getByTestId('needs-checker')).toBeInTheDocument();
    await user.click(within(rows[0]!).getByTestId('refund-approve'));
    expect(screen.getByTestId('finance-confirm')).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason/), 'Within policy window');
    await user.click(screen.getByTestId('finance-confirm'));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/approve'))).toHaveLength(
        1,
      ),
    );
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toEqual({
      reason: 'Within policy window',
    });
  });

  it('order detail hides provider data from roles that may not see it and shows the journals', async () => {
    stub({
      [`/v1/admin/finance/orders/${ORDER}`]: {
        body: {
          data: {
            order: {
              id: ORDER,
              reference: 'VO-K7QM9T',
              status: 'PAID',
              totalHalalas: 8_000,
              quantity: 1,
              createdAt: new Date().toISOString(),
              paidAt: new Date().toISOString(),
              termsVersion: '2026-10-v1',
              termsAcceptedAt: new Date().toISOString(),
              customer: { userId: 'u1', displayName: 'Layla', mobileMasked: '+966•••••1234' },
              voucher: {
                id: VID,
                title: bi('SAR 100 dining voucher', 'x'),
                merchant: bi('Najd Kitchen', 'نجد'),
                merchantId: 'm1',
              },
            },
            payments: [
              {
                id: 'p1',
                status: 'SUCCEEDED',
                amountHalalas: 8_000,
                attemptNo: 1,
                providerReference: null,
                failureCode: null,
                createdAt: new Date().toISOString(),
                completedAt: null,
              },
            ],
            events: [],
            instance: null,
            refunds: [],
            journals: [
              {
                id: 'j1',
                type: 'SALE',
                postedAt: new Date().toISOString(),
                memo: null,
                entries: [
                  { account: 'PSP_CLEARING', amountHalalas: 8_000, memo: null },
                  { account: 'MERCHANT_HELD', amountHalalas: -8_000, memo: null },
                ],
              },
            ],
            payableEvents: [],
            cases: [],
            canSeeProviderData: false,
            canReverseRedemption: false,
            canCreateRefund: false,
          },
          meta: {},
        },
      },
    });
    mount(<FinanceOrderPage id={ORDER} />);
    const pay = await screen.findByTestId('payment-row');
    expect(pay).toHaveTextContent('hidden for your role');
    expect(screen.getByTestId('journal')).toHaveTextContent('Payment provider clearing');
    expect(screen.queryByTestId('fin-reverse')).toBeNull();
    expect(screen.queryByTestId('fin-create-refund')).toBeNull();
  });
});
