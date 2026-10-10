import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS } from '@dealdash/types';
import { Providers } from '../app/[locale]/providers';
import { PartnerNetworkPage } from './network';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/network',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ORG = '018f0000-0000-7000-8000-0000000000b1';
const me = {
  id: '018f0000-0000-7000-8000-000000000101',
  userType: 'PARTNER_USER',
  displayName: 'Bank admin',
  locale: 'en',
  audience: 'partner',
  mfaVerified: true,
  mfaRequired: false,
  csrfToken: 'csrf',
  activeMembership: { organizationId: ORG, organizationType: 'PARTNER', organizationName: { en: 'Gulf Bank', ar: 'بنك الخليج' }, organizationStatus: 'ACTIVE', roleCode: 'PARTNER_ADMIN', branchId: null },
  memberships: [],
  permissions: [...ROLE_PERMISSIONS.PARTNER_ADMIN],
};
const ok = (data: unknown) => ({ data, meta: {} });
const MODULES = ok(['MERCHANT_NETWORK', 'OFFERS'].map((m) => ({ module: m, offered: true, entitled: true })));
const MARKETS = ok([{ code: 'SA', nameEn: 'Saudi Arabia', nameAr: 'المملكة العربية السعودية' }]);

/**
 * B8 (Stage 8 closure, founder-approved Stage 7 compatibility fix): the partner's market list loads asynchronously. The test holds
 * that response back (the slow-API condition seen in the browser runs) and proves nothing is submitted until it arrives.
 */
function stub(marketsBody: unknown = MARKETS) {
  let release: () => void = () => undefined;
  const marketsGate = new Promise<void>((r) => (release = r));
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      const path = url.split('?')[0]!;
      if (url.includes('/v1/auth/me')) return json(200, ok(me));
      if (path.endsWith(`/partners/${ORG}/modules`)) return json(200, MODULES);
      if (path.endsWith(`/partners/${ORG}/markets`)) {
        await marketsGate;
        return json(200, marketsBody);
      }
      if (path.endsWith(`/partners/${ORG}/network/merchants`) && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        return body.country ? json(201, ok({ id: 'm9', action: 'CREATE', warnings: [] })) : json(400, { errors: [{ code: 'VALIDATION_FAILED', message: 'country' }], meta: {} });
      }
      if (path.endsWith(`/partners/${ORG}/network`)) return json(200, ok({ total: 0, markets: ['SA'], items: [] }));
      return json(200, ok([]));
    }),
  );
  return { posts, release: () => release() };
}
afterEach(() => vi.unstubAllGlobals());

async function openAddTab(name: string) {
  await userEvent.click(await screen.findByRole('tab', { name }));
}

describe('Partner "Add a merchant" waits for the market list (B8)', () => {
  it('cannot be submitted while the markets are loading; once loaded it sends the market', async () => {
    const s = stub();
    render(
      <Providers locale="en">
        <PartnerNetworkPage />
      </Providers>,
    );
    await openAddTab('Add a merchant');
    await userEvent.type(screen.getByLabelText('Name (English)'), 'QA Juice Bar');
    await userEvent.type(screen.getByLabelText('First outlet name'), 'QA Juice Bar Olaya');
    const add = screen.getByTestId('pt-net-add-submit');
    // the race seen in the browser: the name is typed and Add pressed before the markets arrive
    expect(screen.getByTestId('pt-net-markets-state')).toHaveTextContent('Loading your markets…');
    expect(add).toBeDisabled();
    await userEvent.click(add);
    expect(s.posts).toHaveLength(0);
    s.release();
    await waitFor(() => expect(add).toBeEnabled());
    expect(screen.queryByTestId('pt-net-markets-state')).toBeNull();
    await userEvent.click(add);
    expect(await screen.findByText('Merchant added to your network.')).toBeInTheDocument();
    expect(s.posts).toEqual([{ nameEn: 'QA Juice Bar', country: 'SA', branches: [{ nameEn: 'QA Juice Bar Olaya' }] }]);
  });

  it('with no market available it explains why and never submits', async () => {
    const s = stub(ok([]));
    render(
      <Providers locale="en">
        <PartnerNetworkPage />
      </Providers>,
    );
    s.release();
    await openAddTab('Add a merchant');
    await userEvent.type(screen.getByLabelText('Name (English)'), 'QA Juice Bar');
    expect(await screen.findByText('No market is available to you yet, so a merchant cannot be added.')).toBeInTheDocument();
    expect(screen.getByTestId('pt-net-add-submit')).toBeDisabled();
    expect(s.posts).toHaveLength(0);
  });

  it('Arabic: the loading state is shown in Arabic and the form stays disabled', async () => {
    const s = stub();
    render(
      <Providers locale="ar">
        <PartnerNetworkPage />
      </Providers>,
    );
    await openAddTab('إضافة تاجر');
    expect(screen.getByTestId('pt-net-markets-state')).toHaveTextContent('جارٍ تحميل أسواقك…');
    expect(screen.getByTestId('pt-net-add-submit')).toBeDisabled();
    s.release();
    await waitFor(() => expect(screen.queryByTestId('pt-net-markets-state')).toBeNull());
  });
});
