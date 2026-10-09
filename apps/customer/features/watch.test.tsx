import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { RewardsPage, WatchHubPage, WatchPage, WatchPlayerPage } from './watch';

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn() }),
  useSearchParams: () => nav.params,
  usePathname: () => '/en/watch',
}));

const W = '018f0000-0000-7000-8000-0000000000e9';
const VIEW = '018f0000-0000-7000-8000-0000000000f9';
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

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
  permissions: ['customer.profile.read', 'customer.rewards.manage'],
};

const card = (over: Record<string, unknown> = {}) => ({
  id: W,
  merchantId: '018f0000-0000-7000-8000-0000000000aa',
  merchantName: { en: 'Najd Kitchen', ar: 'نجد كيتشن' },
  merchantLogoUrl: null,
  title: { en: 'Meet our chef', ar: 'تعرّف على الشيف' },
  description: { en: 'How we prepare our grill.', ar: 'كيف نحضّر المشاوي.' },
  thumbnailUrl: null,
  durationSec: 12,
  rewardPoints: 10,
  availability: 'AVAILABLE',
  availableAgainAt: null,
  endsAt: inHours(72),
  distanceMeters: null,
  eligibility: { result: 'ELIGIBLE', kind: 'PUBLIC', message: null, unlockAction: null },
  serverNow: new Date().toISOString(),
  ...over,
});
const detail = (over: Record<string, unknown> = {}) => ({
  ...card(),
  ctaLabel: { en: 'See our offers', ar: 'شاهد عروضنا' },
  link: { type: 'MERCHANT', id: null, label: null },
  canStart: true,
  sponsored: true,
  ...over,
});
const hub = (campaigns: unknown[], over: Record<string, unknown> = {}) => ({
  campaigns,
  daily: { earnedViews: 2, cap: 10, resetsAt: inHours(10) },
  balance: { availableBalance: 30, heldBalance: 0 },
  serverNow: new Date().toISOString(),
  ...over,
});
const started = {
  viewId: VIEW,
  viewToken: 'tok-secret',
  playbackUrl: 'http://localhost:4000/v1/storage/download/x',
  posterUrl: null,
  durationSec: 12,
  heartbeatSec: 2,
  expiresAt: inHours(1),
  serverNow: new Date().toISOString(),
};
const outcome = (over: Record<string, unknown> = {}) => ({
  viewId: VIEW,
  outcome: 'QUALIFIED',
  state: 'QUALIFIED',
  reasonClass: null,
  reward: { points: 10, status: 'EARNED' },
  balance: { availableBalance: 40, heldBalance: 0 },
  link: { type: 'MERCHANT', id: null },
  serverNow: new Date().toISOString(),
  ...over,
});

interface Call {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
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
      const call: Call = {
        url,
        method: init?.method ?? 'GET',
        body: init?.body as string | undefined,
        headers: (init?.headers ?? {}) as Record<string, string>,
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
      // longest key first so '/v1/app/watch/views/<id>/complete' wins over '/v1/app/watch'
      const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
      for (const key of keys)
        if (url.includes(key)) {
          const r = routes[key]!;
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
  nav.params = new URLSearchParams();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mount = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') =>
  render(<Providers locale={locale}>{ui}</Providers>);

describe('Watch & Earn hub and detail', () => {
  it('lists campaigns with the points reward (never a currency), the daily progress and the balance', async () => {
    stub({
      '/v1/app/watch': {
        body: {
          data: hub([
            card(),
            card({
              id: 'b',
              availability: 'ALREADY_EARNED',
              availableAgainAt: inHours(20),
              title: { en: 'Second', ar: 'ثاني' },
            }),
          ]),
          meta: {},
        },
      },
    });
    mount(<WatchHubPage />);
    expect(await screen.findByText('Meet our chef')).toBeInTheDocument();
    expect(screen.getAllByTestId('watch-card')).toHaveLength(2);
    expect(screen.getAllByTestId('watch-points')[0]).toHaveTextContent('+10 points');
    expect(screen.getByTestId('watch-balance-points')).toHaveTextContent('30');
    expect(screen.getByTestId('watch-daily')).toHaveTextContent('2 of 10 videos today');
    const earned = screen.getAllByTestId('watch-card')[1]!;
    expect(earned).toHaveAttribute('data-availability', 'ALREADY_EARNED');
    expect(within(earned).getByText('Already earned')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SAR|ريال/);
  });

  it('a guest is asked to sign in; an empty list explains itself', async () => {
    stub({ '/v1/app/watch': { body: { data: hub([]), meta: {} } } }, null);
    mount(<WatchHubPage />);
    expect(await screen.findByText('No videos right now')).toBeInTheDocument();
    expect(screen.getByText(/Sign in to earn points/)).toBeInTheDocument();
    expect(screen.queryByTestId('watch-balance')).toBeNull();
  });

  it('detail: sponsored label, how it works, and Start goes to the player', async () => {
    stub({ '/v1/app/watch/campaigns/': { body: { data: detail(), meta: {} } } });
    mount(<WatchPage id={W} />);
    expect(await screen.findByTestId('watch-reward')).toHaveTextContent('+10 points');
    expect(screen.getAllByText('Sponsored by Najd Kitchen').length).toBeGreaterThan(0);
    expect(screen.getByText('How it works')).toBeInTheDocument();
    expect(screen.getByTestId('watch-points-note')).toHaveTextContent('Points are not cash');
    await userEvent.setup().click(screen.getByTestId('watch-start'));
    expect(nav.push).toHaveBeenCalledWith(`/en/watch/${W}/play`);
  });

  it('detail: already earned and locked states disable the button and say why', async () => {
    stub({
      '/v1/app/watch/campaigns/': {
        body: {
          data: detail({
            availability: 'ALREADY_EARNED',
            availableAgainAt: inHours(30),
            canStart: false,
          }),
          meta: {},
        },
      },
    });
    mount(<WatchPage id={W} />);
    const btn = await screen.findByRole('button', { name: /Available again/ });
    expect(btn).toBeDisabled();
  });

  it('a guest sees the sign-in button on the detail page', async () => {
    stub({ '/v1/app/watch/campaigns/': { body: { data: detail(), meta: {} } } }, null);
    mount(<WatchPage id={W} />);
    await userEvent.setup().click(await screen.findByTestId('watch-signin'));
    expect(nav.push).toHaveBeenCalledWith('/en/profile?reason=earn');
  });

  it('renders Arabic with the points word in Arabic and no currency', async () => {
    stub({ '/v1/app/watch': { body: { data: hub([card()]), meta: {} } } });
    mount(<WatchHubPage />, 'ar');
    expect(await screen.findByText('تعرّف على الشيف')).toBeInTheDocument();
    expect(screen.getAllByTestId('watch-points')[0]).toHaveTextContent('نقطة');
    expect(document.body.textContent).not.toMatch(/ريال|SAR/);
  });
});

describe('Watch & Earn player (the client only reports; the server decides)', () => {
  const player = (extra: Routes = {}, user: unknown | null = customer) =>
    stub(
      {
        '/v1/app/watch/campaigns/': { body: { data: detail(), meta: {} } },
        '/v1/app/watch/views/': {
          body: { data: { state: 'STARTED', prompt: null, serverNow: '' }, meta: {} },
        },
        ...extra,
      },
      user,
    );
  const POST_VIEWS = '/v1/app/watch/views';

  it('starts a session with a random device id, shows the video, and sends no thresholds or reward maths', async () => {
    const calls = player({
      [POST_VIEWS]: (c) =>
        c.method === 'POST' && c.url.endsWith('/views')
          ? { body: { data: started, meta: {} } }
          : { body: { data: { state: 'STARTED', prompt: null, serverNow: '' }, meta: {} } },
    });
    mount(<WatchPlayerPage id={W} />);
    const video = (await screen.findByTestId('player-video')) as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe(started.playbackUrl);
    expect(video.controls).toBe(false); // no seek bar
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/v1/app/watch/views'))!;
    const body = JSON.parse(post.body!);
    expect(body).toMatchObject({ campaignId: W });
    expect(body.deviceId).toMatch(/^dev-[0-9a-f]{32}$/);
    expect(Object.keys(body).sort()).toEqual(['campaignId', 'city', 'deviceId']);
  });

  it('plays, sends heartbeats with the view token, then completes at the end and shows the reward', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calls = player({
      '/v1/app/watch/views/': (c) =>
        c.url.endsWith('/complete')
          ? { body: { data: outcome(), meta: {} } }
          : { body: { data: { state: 'STARTED', prompt: null, serverNow: '' }, meta: {} } },
      [POST_VIEWS]: (c) =>
        c.method === 'POST' && c.url.endsWith('/views')
          ? { body: { data: started, meta: {} } }
          : { body: { data: { state: 'STARTED', prompt: null, serverNow: '' }, meta: {} } },
    });
    mount(<WatchPlayerPage id={W} />);
    const video = (await screen.findByTestId('player-video')) as HTMLVideoElement;
    await act(async () => {
      fireEvent.canPlay(video);
    });
    await waitFor(() =>
      expect(screen.getByTestId('watch-player')).toHaveAttribute('data-phase', 'playing'),
    );
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 2.1, writable: true });
    for (let i = 0; i < 6 && !calls.some((c) => c.url.endsWith('/events')); i++)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
    const hb = calls.find((c) => c.url.endsWith('/events'))!;
    expect(hb.headers['x-view-token']).toBe('tok-secret');
    expect(JSON.parse(hb.body!).events[0]).toMatchObject({ type: 'HEARTBEAT', positionSec: 2.1 });
    await act(async () => {
      fireEvent.ended(video);
    });
    const outcomeEl = await screen.findByTestId('player-outcome', {}, { timeout: 8000 });
    expect(outcomeEl).toHaveAttribute('data-outcome', 'QUALIFIED');
    expect(screen.getByTestId('outcome-title')).toHaveTextContent('You earned points');
    expect(screen.getByTestId('outcome-points')).toHaveTextContent('+10 points');
    expect(screen.getByTestId('outcome-balance')).toHaveTextContent('40 points');
    const done = calls.find((c) => c.url.endsWith('/complete'))!;
    expect(done.headers['x-view-token']).toBe('tok-secret');
    expect(Object.keys(JSON.parse(done.body!))).toEqual(['positionSec']);
    expect(screen.getByTestId('outcome-cta')).toHaveTextContent('See our offers');
  });

  it('shows the server-scheduled still-watching prompt and answers it with the prompt id', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let beat = 0;
    const calls = player({
      '/v1/app/watch/views/': (c) => {
        if (c.url.endsWith('/events')) {
          const ev = JSON.parse(c.body!).events[0];
          if (ev.type === 'HEARTBEAT' && ++beat === 1)
            return {
              body: {
                data: { state: 'STARTED', prompt: { id: 'p1', deadlineSec: 8 }, serverNow: '' },
                meta: {},
              },
            };
        }
        return { body: { data: { state: 'STARTED', prompt: null, serverNow: '' }, meta: {} } };
      },
      [POST_VIEWS]: (c) =>
        c.method === 'POST' && c.url.endsWith('/views')
          ? { body: { data: started, meta: {} } }
          : { body: { data: { state: 'STARTED', prompt: null, serverNow: '' }, meta: {} } },
    });
    mount(<WatchPlayerPage id={W} />);
    const video = (await screen.findByTestId('player-video')) as HTMLVideoElement;
    await act(async () => {
      fireEvent.canPlay(video);
    });
    await waitFor(() =>
      expect(screen.getByTestId('watch-player')).toHaveAttribute('data-phase', 'playing'),
    );
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 4, writable: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(await screen.findByTestId('player-prompt')).toBeInTheDocument();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId('player-prompt-confirm'));
    });
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.url.endsWith('/events') &&
            c.body?.includes('PROMPT_ANSWERED') &&
            c.body.includes('"promptId":"p1"'),
        ),
      ).toBe(true),
    );
  });

  it('a view the server does not count is explained with a plain reason, never the detection logic', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    player({
      '/v1/app/watch/views/': (c) =>
        c.url.endsWith('/complete')
          ? {
              body: {
                data: outcome({
                  outcome: 'NOT_QUALIFIED',
                  state: 'INVALID',
                  reasonClass: 'LEFT_APP',
                  reward: null,
                  link: null,
                }),
                meta: {},
              },
            }
          : { body: { data: { state: 'STARTED', prompt: null, serverNow: '' }, meta: {} } },
      [POST_VIEWS]: (c) =>
        c.method === 'POST' && c.url.endsWith('/views')
          ? { body: { data: started, meta: {} } }
          : { body: { data: { state: 'STARTED', prompt: null, serverNow: '' }, meta: {} } },
    });
    mount(<WatchPlayerPage id={W} />);
    const video = (await screen.findByTestId('player-video')) as HTMLVideoElement;
    await act(async () => {
      fireEvent.ended(video);
    });
    expect(await screen.findByTestId('outcome-title')).toHaveTextContent('This view did not count');
    expect(screen.getByTestId('outcome-reason')).toHaveTextContent(
      'You left the app before the video finished.',
    );
    expect(document.body.textContent).not.toMatch(/risk|fraud|device|score|signal/i);
  });

  it('a held reward says it is being checked', async () => {
    player({
      '/v1/app/watch/views/': (c) =>
        c.url.endsWith('/complete')
          ? {
              body: {
                data: outcome({ outcome: 'HELD', reward: { points: 10, status: 'HELD' } }),
                meta: {},
              },
            }
          : { body: { data: { state: 'STARTED', prompt: null, serverNow: '' }, meta: {} } },
      [POST_VIEWS]: (c) =>
        c.method === 'POST' && c.url.endsWith('/views')
          ? { body: { data: started, meta: {} } }
          : { body: { data: { state: 'STARTED', prompt: null, serverNow: '' }, meta: {} } },
    });
    mount(<WatchPlayerPage id={W} />);
    const video = (await screen.findByTestId('player-video')) as HTMLVideoElement;
    await act(async () => {
      fireEvent.ended(video);
    });
    expect(await screen.findByTestId('outcome-title')).toHaveTextContent(
      'We are checking your view',
    );
  });

  it('when the server refuses to start (already earned) the page says so in plain words', async () => {
    player({
      [POST_VIEWS]: (c) =>
        c.method === 'POST'
          ? {
              status: 409,
              body: {
                errors: [{ code: 'VIEW_NOT_ALLOWED', message: 'x', field: 'ALREADY_EARNED' }],
                meta: {},
              },
            }
          : { body: { data: {}, meta: {} } },
    });
    mount(<WatchPlayerPage id={W} />);
    expect(await screen.findByTestId('player-error')).toHaveTextContent(
      'You already earned from this video recently',
    );
  });

  it('a guest cannot start a session', async () => {
    const calls = player({}, null);
    mount(<WatchPlayerPage id={W} />);
    expect(await screen.findByTestId('player-error')).toHaveTextContent('Sign in');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/v1/app/watch/views'))).toBe(
      false,
    );
  });
});

describe('Rewards', () => {
  const summary = {
    availableBalance: 120,
    heldBalance: 10,
    lifetimeEarned: 200,
    lifetimeRedeemed: 70,
    expiringSoon: null,
    cashValueShown: false,
    catalogueCount: 2,
  };
  const entry = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    type: 'EARN',
    points: 10,
    bucket: 'AVAILABLE',
    balanceAfter: 120,
    sourceType: 'VIEW',
    title: { en: 'Meet our chef', ar: 'تعرّف على الشيف' },
    merchantName: { en: 'Najd Kitchen', ar: 'نجد كيتشن' },
    reasonClass: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    ...over,
  });
  const item = (over: Record<string, unknown> = {}) => ({
    id: 'i1',
    name: { en: 'Sample: coffee voucher', ar: 'نموذج: قسيمة قهوة' },
    description: { en: '', ar: '' },
    pointsCost: 100,
    stockLeft: 5,
    isSample: true,
    canRedeem: true,
    ...over,
  });
  const routes = (extra: Routes = {}): Routes => ({
    '/v1/app/rewards/activity': {
      body: {
        data: [
          entry(),
          entry({ id: 'e2', type: 'REDEEM', points: -70, title: null, merchantName: null }),
        ],
        meta: {},
      },
    },
    '/v1/app/rewards/catalogue': {
      body: {
        data: [item(), item({ id: 'i2', canRedeem: false, pointsCost: 600, stockLeft: 0 })],
        meta: {},
      },
    },
    '/v1/app/rewards': { body: { data: summary, meta: {} } },
    ...extra,
  });

  it('shows the balance, held points, a not-cash note, the activity and the catalogue', async () => {
    stub(routes());
    mount(<RewardsPage />);
    expect(await screen.findByTestId('reward-available')).toHaveTextContent('120');
    expect(screen.getByTestId('reward-held')).toHaveTextContent('10');
    expect(screen.getByTestId('reward-note')).toHaveTextContent('Points are not cash');
    const rows = await screen.findAllByTestId('reward-row');
    expect(rows[0]).toHaveTextContent('+10 points');
    expect(rows[1]).toHaveTextContent('−70 points');
    expect(screen.getAllByTestId('reward-item')).toHaveLength(2);
    expect(screen.getByText('Out of stock', { selector: '.dd-chip' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SAR/);
  });

  it('redeeming asks for confirmation, sends an Idempotency-Key and shows the code', async () => {
    const calls = stub(
      routes({
        '/v1/app/rewards/redeem': {
          body: {
            data: {
              redemptionId: 'r1',
              itemName: { en: 'Sample: coffee voucher', ar: 'x' },
              pointsCost: 100,
              code: 'RW-ABC123',
              availableBalance: 20,
            },
            meta: {},
          },
        },
      }),
    );
    mount(<RewardsPage />);
    const user = userEvent.setup();
    const buttons = await screen.findAllByTestId('reward-redeem');
    await user.click(buttons[0]!);
    await user.click(await screen.findByTestId('reward-confirm'));
    expect(await screen.findByTestId('redeemed-code')).toHaveTextContent('RW-ABC123');
    const post = calls.find((c) => c.url.endsWith('/v1/app/rewards/redeem'))!;
    expect(JSON.parse(post.body!)).toEqual({ itemId: 'i1' });
    expect(post.headers['Idempotency-Key']).toBeTruthy();
  });

  it('a guest is asked to sign in', async () => {
    stub(routes(), null);
    mount(<RewardsPage />);
    expect(await screen.findByTestId('rewards-signin')).toBeInTheDocument();
  });

  it('Arabic: right-to-left strings, Western digits, no currency', async () => {
    stub(routes());
    mount(<RewardsPage />, 'ar');
    expect(await screen.findByText('المكافآت', { selector: 'h1' })).toBeInTheDocument();
    expect((await screen.findByTestId('reward-note')).textContent).toContain('النقاط ليست نقداً');
    expect(screen.getByTestId('reward-available')).toHaveTextContent('120');
    expect(document.body.textContent).not.toMatch(/ريال|SAR/);
  });
});
