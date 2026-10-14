import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { BenefitsPage } from './benefits';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/en/benefits',
}));

const EMPLOYER_PROGRAM = '018f0000-0000-7000-8000-0000000000e1';
const EMPLOYER = '018f0000-0000-7000-8000-0000000000e2';
const CARD_PROGRAM = '018f0000-0000-7000-8000-0000000000c1';
const BANK = '018f0000-0000-7000-8000-0000000000c2';

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
  permissions: ['customer.profile.read', 'customer.profile.write'],
};

const dealCard = (over: Record<string, unknown> = {}) => ({
  id: '018f0000-0000-7000-8000-0000000000a1',
  merchantId: '018f0000-0000-7000-8000-0000000000b1',
  merchantName: { en: 'Harbour Grill', ar: 'هاربور جريل' },
  merchantLogoUrl: null,
  title: { en: 'Staff lunch 25% off', ar: 'غداء الموظفين بخصم 25%' },
  offerLabel: { en: '25% off', ar: 'خصم 25%' },
  shortDescription: { en: 'Weekdays', ar: 'أيام الأسبوع' },
  category: { code: 'dining', name: { en: 'Dining', ar: 'المطاعم' } },
  mechanic: 'PERCENTAGE_OFF',
  imageUrl: null,
  imageAlt: { en: 'Plate', ar: 'طبق' },
  startsAt: null,
  endsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  distanceMeters: 820,
  nearestBranch: null,
  branchCount: 1,
  eligibility: { result: 'ELIGIBLE', kind: 'EMPLOYER', message: null, unlockAction: null },
  saved: false,
  availability: 'AVAILABLE',
  ...over,
});

const overview = (over: Record<string, unknown> = {}) => ({
  employer: {
    programId: EMPLOYER_PROGRAM,
    programName: { en: 'Lynx staff', ar: 'موظفو لينكس' },
    partner: { id: EMPLOYER, name: { en: 'Lynx Co', ar: 'لينكس' } },
    maskedEmail: 's***@lynx.example',
    status: 'VERIFIED',
    verifiedAt: '2026-10-01T09:00:00.000Z',
    expiresAt: '2027-03-30T09:00:00.000Z',
    renewFrom: '2027-03-16T09:00:00.000Z',
  },
  cards: [
    {
      programId: CARD_PROGRAM,
      name: { en: 'Falcon Platinum', ar: 'فالكون بلاتينيوم' },
      issuer: { id: BANK, name: { en: 'Falcon Bank', ar: 'بنك فالكون' } },
      scheme: 'visa',
      tier: 'platinum',
      addedAt: '2026-10-02T09:00:00.000Z',
    },
  ],
  maxCards: 5,
  counts: { unlocked: 1, available: 0, active: 1, used: 0, expired: 0 },
  ...over,
});

type R = { status?: number; body: unknown };
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
function stub(routes: Record<string, R>, signedIn = true) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me'))
        return signedIn
          ? json(200, { data: customer, meta: {} })
          : json(401, { errors: [{ code: 'UNAUTHENTICATED', message: 'x' }], meta: {} });
      const path = url.split('?')[0]!;
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length)) {
        const [m, p] = key.includes(' ') ? key.split(' ') : ['GET', key];
        if (method === m && path.endsWith(p!))
          return json(routes[key]!.status ?? 200, routes[key]!.body);
      }
      return json(200, { data: [], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const mount = (locale: 'en' | 'ar' = 'en') =>
  render(
    <Providers locale={locale}>
      <BenefitsPage />
    </Providers>,
  );

describe('Customer My benefits', () => {
  it('asks a guest to sign in', async () => {
    stub({}, false);
    mount();
    expect(await screen.findByTestId('benefits-signin')).toHaveTextContent(
      'Sign in to see your benefits',
    );
  });

  it('shows the verified employer (masked email), added cards (never "verified"), and unlocked offers with their partner', async () => {
    stub({
      '/v1/app/benefits': ok(overview()),
      '/v1/app/benefits/offers': ok([
        {
          product: 'LIVE',
          partners: [{ id: EMPLOYER, name: { en: 'Lynx Co', ar: 'لينكس' } }],
          card: dealCard(),
        },
      ]),
    });
    mount();
    const employer = await screen.findByTestId('benefit-employer');
    expect(employer).toHaveTextContent('Verified employee');
    expect(employer).toHaveTextContent('Lynx Co');
    expect(employer).toHaveTextContent('s***@lynx.example');
    const card = screen.getByTestId('benefit-card');
    expect(card).toHaveTextContent('Falcon Platinum');
    expect(card).toHaveTextContent('Added');
    expect(screen.getByTestId('benefit-cards')).not.toHaveTextContent(/verified/i);
    // BC-10: an offer that needs a card is honoured by showing the card at the merchant (no verification is implied)
    expect(screen.getByTestId('benefit-cards')).toHaveTextContent('show it at the merchant');
    const offers = await screen.findByTestId('benefit-offers-unlocked');
    expect(within(offers).getByText('Benefit from Lynx Co')).toBeInTheDocument();
    expect(within(offers).getByText('Staff lunch 25% off')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Unlocked · 1/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('adds an employer: choose the employer, send a code to the work email, confirm the code', async () => {
    const calls = stub({
      '/v1/app/benefits': ok(
        overview({
          employer: null,
          cards: [],
          counts: { unlocked: 0, available: 1, active: 0, used: 0, expired: 0 },
        }),
      ),
      '/v1/app/benefits/options': ok({
        employers: [
          {
            programId: EMPLOYER_PROGRAM,
            name: { en: 'Lynx staff', ar: 'موظفو لينكس' },
            partner: { id: EMPLOYER, name: { en: 'Lynx Co', ar: 'لينكس' } },
            domains: ['lynx.example'],
          },
        ],
        cards: [],
      }),
      'POST /v1/app/benefits/employer/code': ok({
        maskedEmail: 's***@lynx.example',
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
      }),
      'POST /v1/app/benefits/employer/verify': ok(overview()),
    });
    mount();
    expect(await screen.findByText('No unlocked benefits yet')).toBeInTheDocument();
    await userEvent.click(await screen.findByTestId('employer-add'));
    const sheet = await screen.findByTestId('employer-sheet');
    await userEvent.type(within(sheet).getByLabelText('Work email'), 'sara@lynx.example');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send code' }));
    expect(
      await within(sheet).findByText('We sent a 6-digit code to s***@lynx.example'),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/employer/code'))?.body).toEqual({
      programId: EMPLOYER_PROGRAM,
      email: 'sara@lynx.example',
    });
    await userEvent.type(within(sheet).getByLabelText('Code'), '123456');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Verified employee')).toBeInTheDocument();
    expect(calls.find((c) => c.url.includes('/employer/verify'))?.body).toEqual({
      programId: EMPLOYER_PROGRAM,
      email: 'sara@lynx.example',
      code: '123456',
    });
  });

  it('explains a refused work email in plain words', async () => {
    stub({
      '/v1/app/benefits': ok(overview({ employer: null })),
      '/v1/app/benefits/options': ok({
        employers: [
          {
            programId: EMPLOYER_PROGRAM,
            name: { en: 'Lynx staff', ar: 'موظفو لينكس' },
            partner: { id: EMPLOYER, name: { en: 'Lynx Co', ar: 'لينكس' } },
            domains: ['lynx.example'],
          },
        ],
        cards: [],
      }),
      'POST /v1/app/benefits/employer/code': {
        status: 422,
        body: {
          errors: [{ code: 'BENEFIT_EMAIL_NOT_ALLOWED', message: 'x', field: 'email' }],
          meta: {},
        },
      },
    });
    mount();
    await userEvent.click(await screen.findByTestId('employer-add'));
    const sheet = await screen.findByTestId('employer-sheet');
    await userEvent.type(within(sheet).getByLabelText('Work email'), 'me@gmail.com');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Send code' }));
    expect(
      await within(sheet).findByText('Use your own work email, not a shared or personal address.'),
    ).toBeInTheDocument();
  });

  it('shows usage with its redemption status and the benefit history', async () => {
    stub({
      '/v1/app/benefits': ok(overview()),
      '/v1/app/benefits/usage': ok([
        {
          kind: 'RESERVATION',
          id: '018f0000-0000-7000-8000-0000000000d1',
          reference: 'R-7KQ2',
          title: { en: 'Card holders tasting', ar: 'تذوق لحاملي البطاقات' },
          merchantName: { en: 'Harbour Grill', ar: 'هاربور جريل' },
          partners: [{ id: BANK, name: { en: 'Falcon Bank', ar: 'بنك فالكون' } }],
          status: 'HELD',
          validUntil: new Date(Date.now() + 3600_000).toISOString(),
          redeemedAt: null,
          createdAt: new Date().toISOString(),
        },
      ]),
      '/v1/app/benefits/history': ok([
        {
          event: 'CARD_ADDED',
          name: { en: 'Falcon Platinum', ar: 'فالكون بلاتينيوم' },
          at: '2026-10-02T09:00:00.000Z',
        },
      ]),
    });
    mount();
    await userEvent.click(await screen.findByRole('tab', { name: /In use/ }));
    const usage = await screen.findByTestId('benefit-usage-active');
    expect(usage).toHaveTextContent('Card holders tasting');
    expect(usage).toHaveTextContent('Reserved');
    expect(usage).toHaveTextContent('Benefit from Falcon Bank');
    await userEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByTestId('benefit-history')).toHaveTextContent('Falcon Platinum added');
  });

  it('Arabic: right-to-left strings and Western digits', async () => {
    stub({ '/v1/app/benefits': ok(overview()), '/v1/app/benefits/offers': ok([]) });
    mount('ar');
    expect(await screen.findByText('موظف موثّق')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('مزاياي');
    expect(document.body.textContent ?? '').not.toMatch(/[٠-٩]/);
  });
});
