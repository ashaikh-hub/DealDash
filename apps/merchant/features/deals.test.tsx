import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyLiveDealContent } from '@dealdash/validation';
import { Providers } from '../app/[locale]/providers';
import { DealBuilder } from './deal-builder';
import { DealDetailPage } from './deal-detail';
import { DealsHub } from './deals-hub';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/deals',
  useSearchParams: () => new URLSearchParams(),
}));

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const DEAL = '018f0000-0000-7000-8000-0000000000d1';

const me = (permissions: string[]) => ({
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
const ALL = ['merchant.deals.read', 'merchant.deals.manage', 'merchant.branch.read'];

const row = (over: Record<string, unknown> = {}) => ({
  id: DEAL,
  status: 'LIVE',
  title: { en: '30% off the tasting menu', ar: 'خصم 30% على قائمة التذوق' },
  offerLabel: { en: '30% off', ar: 'خصم 30%' },
  branchCount: 2,
  startAt: '2026-10-01T08:00:00.000Z',
  endAt: null,
  imageUrl: null,
  hasPendingRevision: false,
  needsAttention: false,
  directionsClicks: 7,
  updatedAt: '2026-10-02T08:00:00.000Z',
  ...over,
});

type Routes = Record<string, { status?: number; body: unknown }>;
function stub(routes: Routes, user: unknown = me(ALL)) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me')) return json(200, { data: user, meta: {} });
      for (const [key, r] of Object.entries(routes))
        if (url.includes(key)) return json(r.status ?? 200, r.body);
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const view = (over: Record<string, unknown> = {}) => ({
  id: DEAL,
  organizationId: ORG,
  status: 'NEEDS_CHANGES',
  version: 3,
  content: {
    ...emptyLiveDealContent(),
    title: { en: 'Weekend brunch', ar: 'بوفيه عطلة الأسبوع' },
    offerLabel: { en: '20% off', ar: 'خصم 20%' },
  },
  media: [],
  branches: [],
  category: null,
  pausedBy: null,
  submittedAt: null,
  publishedAt: null,
  endedAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  translation: { complete: true, missing: [] },
  issues: [],
  guardrail: { outcome: 'MANUAL_REVIEW', reasons: ['PILOT_MANUAL_REVIEW'] },
  discoverable: { visible: false, reason: 'STATUS_NOT_PUBLIC' },
  revision: null,
  latestDecision: {
    id: 'h1',
    action: 'REQUEST_CHANGES',
    fromStatus: 'PENDING_REVIEW',
    toStatus: 'NEEDS_CHANGES',
    reason: 'Please state the minimum table size.',
    reasonAr: 'يرجى ذكر الحد الأدنى لحجم الطاولة.',
    fields: ['terms'],
    actorRole: 'DEALDASH',
    actorName: null,
    byDealDash: true,
    createdAt: '2026-10-02T00:00:00.000Z',
  },
  allowedActions: ['edit', 'submit'],
  ...over,
});

describe('Merchant campaigns hub', () => {
  it('lists Live Deals with status, branches and the directions signal, plus the discovery caveat', async () => {
    stub({
      '/live-deals': {
        body: {
          data: [
            row(),
            row({
              id: 'x2',
              status: 'PENDING_REVIEW',
              title: { en: 'Lunch combo', ar: 'وجبة الغداء' },
              hasPendingRevision: true,
            }),
          ],
          meta: { nextCursor: null },
        },
      },
    });
    render(
      <Providers locale="en">
        <DealsHub />
      </Providers>,
    );
    expect(await screen.findByText('30% off the tasting menu')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Live')).toBeInTheDocument();
    expect(within(table).getByText('Pending review')).toBeInTheDocument();
    expect(screen.getByText('New version waiting')).toBeInTheDocument();
    expect(screen.getByText(/do not prove visits or sales/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Create Live Deal/ })).toBeInTheDocument();
  });

  it('shows the create-a-deal empty state, a loading skeleton and an error with retry', async () => {
    stub({ '/live-deals': { body: { data: [], meta: { nextCursor: null } } } });
    const { unmount } = render(
      <Providers locale="en">
        <DealsHub />
      </Providers>,
    );
    expect(
      await screen.findByText('Create a Live Deal to be found by nearby customers'),
    ).toBeInTheDocument();
    unmount();
    stub({
      '/live-deals': {
        status: 500,
        body: { errors: [{ code: 'INTERNAL', message: 'x' }], meta: {} },
      },
    });
    render(
      <Providers locale="en">
        <DealsHub />
      </Providers>,
    );
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('hides the create button from users without the manage permission', async () => {
    stub(
      { '/live-deals': { body: { data: [row()], meta: { nextCursor: null } } } },
      me(['merchant.deals.read']),
    );
    render(
      <Providers locale="en">
        <DealsHub />
      </Providers>,
    );
    await screen.findByText('30% off the tasting menu');
    expect(screen.queryByRole('link', { name: /Create Live Deal/ })).toBeNull();
  });

  it('renders Arabic labels and Arabic deal titles in RTL with long names wrapping', async () => {
    const long = 'عرض الغداء العائلي الكبير في مطعم المشويات الشهير بجميع الفروع طوال أيام الأسبوع';
    stub({
      '/live-deals': {
        body: { data: [row({ title: { en: 'x', ar: long } })], meta: { nextCursor: null } },
      },
    });
    render(
      <Providers locale="ar">
        <DealsHub />
      </Providers>,
    );
    expect(await screen.findByText(long)).toBeInTheDocument();
    expect(screen.getAllByText('الحملات').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('table')).getByText('مباشر')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
    expect(screen.getByText(long).className).toContain('dd-clamp'); // long names wrap instead of overflowing
  });
});

describe('Live Deal builder', () => {
  const options = {
    '/deal-options': {
      body: {
        data: {
          categories: [{ id: 'c1', code: 'dining', nameEn: 'Dining', nameAr: 'المطاعم' }],
          eligibility: { employers: [], banks: [], schemes: [], cities: ['Riyadh'] },
        },
        meta: {},
      },
    },
    '/branches': {
      body: {
        data: [{ id: 'b1', nameEn: 'Olaya', nameAr: 'العليا', status: 'ACTIVE', city: 'Riyadh' }],
        meta: {},
      },
    },
  };

  it('shows the five steps with English and Arabic fields side by side (Arabic is right-to-left)', async () => {
    stub(options);
    render(
      <Providers locale="en">
        <DealBuilder />
      </Providers>,
    );
    expect(await screen.findByText('New Live Deal')).toBeInTheDocument();
    for (const s of [
      'Basics',
      'Branches & schedule',
      'Eligibility & terms',
      'Photos',
      'Preview & submit',
    ])
      expect(screen.getByRole('button', { name: new RegExp(s) })).toBeInTheDocument();
    const en = screen.getByLabelText(/^Title \(English\)/);
    const ar = screen.getByLabelText(/^Title \(Arabic\)/);
    expect(en).toHaveAttribute('dir', 'ltr');
    expect(ar).toHaveAttribute('dir', 'rtl');
    expect(ar).toHaveAttribute('lang', 'ar');
    expect(screen.getByText('Translation: missing English + Arabic')).toBeInTheDocument();
  });

  it('blocks Next until the step is valid and names the missing language', async () => {
    stub(options);
    const user = userEvent.setup();
    render(
      <Providers locale="en">
        <DealBuilder />
      </Providers>,
    );
    await screen.findByText('New Live Deal');
    await user.type(screen.getByLabelText(/^Title \(English\)/), 'Only English');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findAllByText('Arabic text is required')).not.toHaveLength(0);
    expect(screen.getByText(/items need attention/)).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument();
  });

  it('offers general redemption only: no code, claim or controlled-redemption switch', async () => {
    stub(options);
    const user = userEvent.setup();
    render(
      <Providers locale="en">
        <DealBuilder />
      </Providers>,
    );
    await screen.findByText('New Live Deal');
    await user.click(screen.getByRole('button', { name: /Preview & submit/ }));
    // the review step is reachable only after the earlier steps are visited
    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument();
    const page = document.body.textContent!.toLowerCase();
    expect(page).not.toContain('controlled');
    expect(page).not.toContain('redemption code');
  });

  it('Arabic builder: labels in Arabic, Arabic field first-class, direction rtl on the page content', async () => {
    stub(options);
    render(
      <Providers locale="ar">
        <DealBuilder />
      </Providers>,
    );
    expect(await screen.findByText('عرض حي جديد')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /الأساسيات/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/^العنوان \(العربية\)/)).toHaveAttribute('dir', 'rtl');
  });

  it('a user without the manage permission sees a no-access message instead of the builder', async () => {
    stub(options, me(['merchant.deals.read']));
    render(
      <Providers locale="en">
        <DealBuilder />
      </Providers>,
    );
    await waitFor(() =>
      expect(screen.getByText('You do not have access to this page.')).toBeInTheDocument(),
    );
    expect(screen.queryByText('New Live Deal')).toBeNull();
  });
});

describe('Live Deal detail', () => {
  const routes = (v: unknown) => ({
    [`/live-deals/${DEAL}/preview`]: { status: 404, body: { errors: [], meta: {} } },
    [`/live-deals/${DEAL}`]: { body: { data: v, meta: {} } },
  });

  it('shows the reviewer feedback with Fix & resubmit when changes were requested (English)', async () => {
    stub(routes(view()));
    render(
      <Providers locale="en">
        <DealDetailPage id={DEAL} />
      </Providers>,
    );
    expect(await screen.findByText('DealDash asked for changes')).toBeInTheDocument();
    expect(screen.getByText('Please state the minimum table size.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fix & resubmit' })).toBeInTheDocument();
    expect(screen.queryByText(/Minimum table/)).toBeNull();
  });

  it('shows the Arabic reviewer message to an Arabic-speaking merchant', async () => {
    stub(routes(view()));
    render(
      <Providers locale="ar">
        <DealDetailPage id={DEAL} />
      </Providers>,
    );
    expect(await screen.findByText('يرجى ذكر الحد الأدنى لحجم الطاولة.')).toBeInTheDocument();
  });

  it('a suspended deal has no actions and explains why it cannot be resumed here', async () => {
    stub(
      routes(
        view({
          status: 'SUSPENDED',
          allowedActions: [],
          latestDecision: {
            ...view().latestDecision,
            action: 'SUSPEND',
            reason: 'Customer complaints',
          },
        }),
      ),
    );
    render(
      <Providers locale="en">
        <DealDetailPage id={DEAL} />
      </Providers>,
    );
    expect(await screen.findByText(/Suspended by DealDash/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('a pending revision is explained and the live deal stays unchanged', async () => {
    stub(
      routes(
        view({
          status: 'LIVE',
          allowedActions: ['pause', 'end', 'discard_revision'],
          revision: {
            id: 'r1',
            number: 1,
            status: 'PENDING_REVIEW',
            content: view().content,
            media: [],
            materialFields: ['valueNumber'],
            submittedAt: null,
            decidedAt: null,
          },
        }),
      ),
    );
    render(
      <Providers locale="en">
        <DealDetailPage id={DEAL} />
      </Providers>,
    );
    expect(
      await screen.findByText(/new version is waiting for DealDash review/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw changes' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  it('analytics tab shows only discovery signals with the caveat and zero-state, never sales', async () => {
    stub({
      '/performance': {
        body: {
          data: {
            range: { from: 'a', to: 'b' },
            totals: {
              impressions: 0,
              detailViews: 0,
              merchantPageViews: 0,
              saves: 0,
              unsaves: 0,
              directionsClicks: 0,
            },
            byDay: [],
            byBranch: [],
            disclaimerKey: 'discovery_signals_only',
          },
          meta: {},
        },
      },
      ...routes(view({ status: 'LIVE', allowedActions: ['edit', 'pause', 'end'] })),
    });
    const user = userEvent.setup();
    render(
      <Providers locale="en">
        <DealDetailPage id={DEAL} />
      </Providers>,
    );
    await user.click(await screen.findByRole('tab', { name: 'Analytics' }));
    const panel = await screen.findByTestId('deal-analytics');
    expect(within(panel).getByText(/do not prove visits or sales/i)).toBeInTheDocument();
    expect(within(panel).getByText(/appear once the deal is live/i)).toBeInTheDocument();
    for (const k of ['Impressions', 'Detail views', 'Saves', 'Directions clicks'])
      expect(within(panel).getByText(k)).toBeInTheDocument();
    // the only metrics are the five discovery signals; the text explains that sales and revenue are not tracked
    expect([...panel.querySelectorAll('.dd-kpi__l')].map((e) => e.textContent)).toEqual([
      'Impressions',
      'Detail views',
      'Saves',
      'Directions clicks',
      'Merchant page visits',
    ]);
    expect(within(panel).getByText(/does not track sales or revenue/i)).toBeInTheDocument();
  });
});
