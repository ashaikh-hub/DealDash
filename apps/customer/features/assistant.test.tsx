import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { CustomerAssistantPage } from './assistant';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/assistant',
}));

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
  permissions: ['customer.profile.read', 'customer.ai.use'],
};
const answer = (locale: 'en' | 'ar') => ({
  interactionId: 'i1',
  agent: 'CUSTOMER_BEST_DEAL',
  intent: 'BEST_DEALS',
  label: 'AI_SUGGESTED',
  locale,
  localeNote: null,
  autonomyLevel: 1,
  statements: [{ kind: 'OBSERVED_FACT', text: locale === 'ar' ? '2 عروض يمكنك استخدامها الآن.' : '2 offers you can use now.', sources: [] }],
  items: [
    { product: 'EXCLUSIVE', id: 'h1', title: '40% off tonight', merchant: 'Najd Kitchen', why: ['Open to everyone, available now'], reportedSavings: null, endsAt: null, distanceMeters: 800, href: '/hot/h1', action: { kind: 'RESERVE', requiresConfirmation: true } },
    { product: 'VOUCHER', id: 'v1', title: 'SAR 100 dining voucher', merchant: 'Najd Kitchen', why: ['Open to everyone, available now'], reportedSavings: { amount: 'SAR 20.00', percent: 20, basis: 'MERCHANT_REPORTED' }, endsAt: null, distanceMeters: null, href: '/vouchers/v1', action: { kind: 'BUY', requiresConfirmation: true } },
  ],
  drafts: [],
  actions: [],
  handoff: null,
  disclaimer: 'AI suggestions can be incomplete.',
});
function stub(locale: 'en' | 'ar' = 'en') {
  const calls: Array<{ url: string; body?: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, body: init?.body as string | undefined });
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.includes('/v1/auth/me')) return json(200, { data: customer, meta: {} });
      if (url.includes('/v1/app/ai/ask')) return json(200, { data: answer(locale), meta: {} });
      return json(200, { data: { unread: 0 }, meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('customer best-deal assistant', () => {
  it('explains each recommendation; buying or reserving always opens the normal screen to confirm', async () => {
    const calls = stub();
    render(<Providers locale="en"><CustomerAssistantPage /></Providers>);
    await userEvent.click(await screen.findByRole('button', { name: 'Best deals near me' }));
    const item = await screen.findByTestId('ai-item-v1');
    expect(within(item).getByText('Saving stated by the merchant: SAR 20.00 (20%)')).toBeInTheDocument();
    expect(within(item).getByRole('link', { name: 'Open to review and confirm' })).toHaveAttribute('href', '/en/vouchers/v1');
    expect(within(screen.getByTestId('ai-item-h1')).getByText('Open to everyone, available now')).toBeInTheDocument();
    // the customer assistant never drafts or approves anything
    expect(screen.queryByLabelText('Let it prepare drafts for my approval')).toBeNull();
    expect(screen.queryByTestId('ai-approve')).toBeNull();
    expect(JSON.parse(calls.find((c) => c.url.includes('/ai/ask'))!.body!)).not.toHaveProperty('autonomy');
  });

  it('works in Arabic, right-to-left', async () => {
    stub('ar');
    render(<Providers locale="ar"><CustomerAssistantPage /></Providers>);
    await userEvent.click(await screen.findByRole('button', { name: 'أفضل العروض بالقرب مني' }));
    expect(await screen.findByTestId('ai-statement-OBSERVED_FACT')).toHaveTextContent('حقيقة');
    expect(screen.getByText('اقتراح الذكاء الاصطناعي')).toBeInTheDocument();
  });
});
