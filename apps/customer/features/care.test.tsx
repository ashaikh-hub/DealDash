import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { MerchantReviews, MyCasesPage, MyDataPage } from './care';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/cases',
}));

const MERCHANT = '018f0000-0000-7000-8000-0000000000aa';
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
  permissions: ['customer.profile.read', 'customer.profile.write', 'customer.reviews.manage'],
};
type R = { status?: number; body: unknown };
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
function stub(routes: Record<string, R>, signedIn = true) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.includes('/v1/auth/me')) return signedIn ? json(200, { data: customer, meta: {} }) : json(401, { errors: [{ code: 'UNAUTHENTICATED', message: 'x' }], meta: {} });
      const path = url.split('?')[0]!;
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length)) {
        const [m, p] = key.includes(' ') ? key.split(' ') : ['GET', key];
        if (method === m && path.endsWith(p!)) return json(routes[key]!.status ?? 200, routes[key]!.body);
      }
      return json(200, { data: { unread: 0 }, meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const mount = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') => render(<Providers locale={locale}>{ui}</Providers>);
const reviews = ok({
  summary: { count: 1, verified: 1, average: 5 },
  items: [{ id: 'r1', rating: 5, text: 'Lovely coffee and quick service', verified: true, author: 'Sara', createdAt: new Date().toISOString() }],
});

describe('Stage 8 customer care', () => {
  it('reviews: verified badge, the Verified rule is explained, and posting needs 10 characters', async () => {
    const calls = stub({ [`/v1/app/merchants/${MERCHANT}/reviews`]: reviews, [`POST /v1/app/merchants/${MERCHANT}/reviews`]: ok({ id: 'r2', status: 'PUBLISHED', verified: false }) });
    mount(<MerchantReviews merchantId={MERCHANT} />);
    const item = await screen.findByTestId('rev-item');
    expect(within(item).getByText('Verified visit')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('rev-write'));
    expect(screen.getByTestId('rev-form')).toHaveTextContent('Watching videos does not count.');
    const post = screen.getByTestId('rev-submit');
    await userEvent.type(screen.getByLabelText('Your review'), 'Too short');
    expect(post).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Your review'), ' but now long enough');
    await userEvent.click(post);
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ rating: 5, text: 'Too short but now long enough', locale: 'en' });
    expect(await screen.findByText('Thank you. Your review is published.')).toBeInTheDocument();
  });

  it('reviews: a signed-out visitor can read but is asked to sign in to write', async () => {
    stub({ [`/v1/app/merchants/${MERCHANT}/reviews`]: reviews }, false);
    mount(<MerchantReviews merchantId={MERCHANT} />);
    expect(await screen.findByTestId('rev-item')).toHaveTextContent('Lovely coffee');
    expect(screen.getByText('Sign in to write a review.')).toBeInTheDocument();
    expect(screen.queryByTestId('rev-write')).toBeNull();
  });

  it('my requests: status in plain words, what DealDash shared and the resolution', async () => {
    stub({
      '/v1/app/me/cases': ok([
        { id: 'c1', reference: 'CASE-1', title: 'Refund not received', status: 'AWAITING_CUSTOMER', open: true, resolution: null, createdAt: new Date().toISOString(), resolvedAt: null, notes: [{ body: 'Please send the bank reference.', createdAt: new Date().toISOString() }] },
        { id: 'c2', reference: 'CASE-2', title: 'Voucher not accepted', status: 'RESOLVED', open: false, resolution: 'The merchant honoured the voucher.', createdAt: new Date().toISOString(), resolvedAt: new Date().toISOString(), notes: [] },
      ]),
    });
    mount(<MyCasesPage />);
    const open = await screen.findByTestId('my-case-CASE-1');
    expect(open).toHaveTextContent('We need your reply');
    expect(open).toHaveTextContent('Please send the bank reference.');
    expect(screen.getByTestId('my-case-CASE-2')).toHaveTextContent('The merchant honoured the voucher.');
  });

  it('my data: export and deletion are requests a person reviews; deletion explains what is kept', async () => {
    const calls = stub({ '/v1/app/me/data-requests': ok([]), 'POST /v1/app/me/data-requests': ok({ id: 'd1', reference: 'DR-1', type: 'DELETION', status: 'PENDING_APPROVAL' }) });
    mount(<MyDataPage />);
    expect(await screen.findByText('No requests yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('data-delete'));
    expect(screen.getByText(/Records the law requires us to keep/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('data-delete-confirm'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ type: 'DELETION' });
    expect(await screen.findByText('Request received. We will let you know.')).toBeInTheDocument();
  });

  it('works in Arabic', async () => {
    stub({ '/v1/app/me/cases': ok([]) });
    mount(<MyCasesPage />, 'ar');
    expect(await screen.findByText('ليس لديك طلبات.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'طلباتي' })).toBeInTheDocument();
  });
});
