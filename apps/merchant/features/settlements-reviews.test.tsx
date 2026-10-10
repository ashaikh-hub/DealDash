import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { MerchantOperationsPage } from './operations';
import { MerchantReviewsPage, MerchantSettlements } from './settlements-reviews';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/reviews',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const me = (permissions: string[]) => ({
  id: '018f0000-0000-7000-8000-000000000001',
  userType: 'MERCHANT_USER',
  displayName: 'Owner',
  locale: 'en',
  audience: 'merchant',
  mfaVerified: true,
  mfaRequired: false,
  csrfToken: 'csrf',
  activeMembership: { organizationId: ORG, organizationType: 'MERCHANT', organizationName: { en: 'Test Cafe', ar: 'مقهى الاختبار' }, organizationStatus: 'ACTIVE', roleCode: 'MERCHANT_OWNER', branchId: null },
  memberships: [],
  permissions,
});
type R = { status?: number; body: unknown };
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
function stub(routes: Record<string, R>, perms: string[]) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms), meta: {} });
      const path = url.split('?')[0]!;
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length)) {
        const [m, p] = key.includes(' ') ? key.split(' ') : ['GET', key];
        if (method === m && path.endsWith(p!)) return json(routes[key]!.status ?? 200, routes[key]!.body);
      }
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const mount = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') => render(<Providers locale={locale}>{ui}</Providers>);

describe('Stage 8 merchant views', () => {
  it('settlement statements: period, payable, paid, a hold with its reason and the breakdown', async () => {
    stub(
      {
        [`/v1/merchants/${ORG}/settlements`]: ok([
          { id: 's1', reference: 'STL-1', currency: 'SAR', status: 'HELD', periodFrom: '2026-09-01T00:00:00.000Z', periodTo: '2026-09-30T00:00:00.000Z', grossMinor: 100000, feesMinor: 10000, taxMinor: 1500, adjustmentsMinor: 0, carriedForwardMinor: 0, payableMinor: 90000, paidMinor: 0, outstandingMinor: 90000, settlementDate: null, holdReason: 'Bank details being verified', payouts: [] },
        ]),
      },
      ['merchant.finance.read'],
    );
    mount(<MerchantSettlements />);
    const card = await screen.findByTestId('mset-STL-1');
    expect(card).toHaveTextContent('On hold');
    expect(card).toHaveTextContent('Bank details being verified');
    expect(card).toHaveTextContent('SAR');
    await userEvent.click(within(card).getByRole('button', { name: 'View' }));
    expect(card).toHaveTextContent('DealDash fees');
    expect(card).toHaveTextContent('Outstanding');
  });

  it('settlement statements: empty state', async () => {
    stub({ [`/v1/merchants/${ORG}/settlements`]: ok([]) }, ['merchant.finance.read']);
    mount(<MerchantSettlements />);
    expect(await screen.findByText('No settlement statements yet.')).toBeInTheDocument();
  });

  it('reviews: summary, verified badge, and the business can report (never edit or remove)', async () => {
    const calls = stub(
      {
        [`/v1/merchants/${ORG}/reviews`]: ok({ summary: { count: 2, verified: 1, average: 3.5 }, items: [{ id: 'r1', rating: 2, text: 'Staff refused my voucher', verified: true, author: 'Sara', createdAt: new Date().toISOString(), status: 'PUBLISHED', reportCount: 0 }] }),
        [`POST /v1/merchants/${ORG}/reviews/r1/report`]: ok({ reported: true }),
      },
      ['merchant.insights.read'],
    );
    mount(<MerchantReviewsPage />);
    expect(await screen.findByTestId('mrev-summary')).toHaveTextContent('2 reviews · 1 verified · average 3.5');
    const item = screen.getByTestId('mrev-item');
    expect(item).toHaveTextContent('Verified visit');
    expect(within(item).queryByRole('button', { name: /edit|remove|delete/i })).toBeNull();
    await userEvent.click(within(item).getByTestId('mrev-report'));
    await userEvent.click(screen.getByTestId('mrev-report-send'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ reason: 'FALSE_INFORMATION', note: null });
    expect(await screen.findByText('Thank you. DealDash will review it.')).toBeInTheDocument();
  });

  it('reviews: hidden without the insights permission', async () => {
    stub({}, ['merchant.finance.read']);
    mount(<MerchantReviewsPage />);
    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
  });

  it('cases: a case waiting for the business is marked "Waiting for you" in English and Arabic', async () => {
    const c = { id: 'c1', reference: 'CASE-3', type: 'VOUCHER_EXCEPTION', organizationId: ORG, title: 'Voucher refused', description: null, priority: 'NORMAL', status: 'AWAITING_MERCHANT', slaDueAt: new Date(Date.now() + 3600000).toISOString(), overdue: false, resolution: null, resolvedAt: null, financialAdjustmentId: null, notes: [], attachments: [], severity: 'MEDIUM', awaitingYou: true, assignedTeam: null, approvalRequestedByUserId: null };
    const routes = { [`/v1/orgs/${ORG}/inbox`]: ok([]), [`/v1/orgs/${ORG}/disputes`]: ok([c]), [`/v1/orgs/${ORG}/disputes/c1`]: ok(c) };
    stub(routes, ['merchant.deals.read', 'merchant.disputes.manage']);
    const v = mount(<MerchantOperationsPage />);
    await userEvent.click(await screen.findByRole('tab', { name: 'Cases' }));
    const row = await screen.findByTestId('op-case-CASE-3');
    expect(row).toHaveTextContent('Waiting for the merchant');
    expect(row).toHaveTextContent('Waiting for you');
    await userEvent.click(screen.getByTestId('op-case-open-CASE-3'));
    expect(await screen.findByText('DealDash is waiting for your reply on this case. Add a note below.')).toBeInTheDocument();
    // a business never sees DealDash's internal routing or approval actions
    expect(screen.queryByTestId('op-case-work')).toBeNull();
    v.unmount();
    vi.unstubAllGlobals();
    stub(routes, ['merchant.deals.read', 'merchant.disputes.manage']);
    mount(<MerchantOperationsPage />, 'ar');
    await userEvent.click(await screen.findByRole('tab', { name: 'القضايا' }));
    expect(await screen.findByTestId('op-case-CASE-3')).toHaveTextContent('بانتظارك');
  });
});
