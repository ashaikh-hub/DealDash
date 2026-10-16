import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { AccountPage, HistoryPage } from './history-account';
import { ScanPage, normaliseCode } from './redeem';

const me = {
  id: '018f0000-0000-7000-8000-000000000001',
  userType: 'MERCHANT_USER',
  displayName: 'Khalid',
  locale: 'en',
  audience: 'staff',
  mfaVerified: true,
  mfaRequired: false,
  csrfToken: 'csrf',
  activeMembership: {
    organizationId: '018f0000-0000-7000-8000-0000000000aa',
    organizationType: 'MERCHANT',
    organizationName: { en: 'Harbour Grill', ar: 'هاربور جريل' },
    organizationStatus: 'ACTIVE',
    roleCode: 'MERCHANT_STAFF',
    branchId: 'br1',
  },
  memberships: [],
  permissions: [
    'merchant.branch.read',
    'merchant.redemptions.perform',
    'merchant.redemptions.read',
  ],
};

const summary = (over: Record<string, unknown> = {}) => ({
  ref: 'DD-K7QM9T',
  quantity: 1,
  dealTitle: { en: 'Free dessert with any main', ar: 'حلى مجاني مع أي طبق رئيسي' },
  offerLabel: { en: 'Free dessert', ar: 'حلى مجاني' },
  merchantName: { en: 'Harbour Grill', ar: 'هاربور جريل' },
  branchName: { en: 'Olaya', ar: 'العليا' },
  customerFirstName: 'Layla',
  expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  startsAt: null,
  redeemedAt: null,
  redeemedBranchName: null,
  validBranchName: null,
  requirement: null,
  ...over,
});

interface Call {
  url: string;
  method: string;
  body?: string;
  key?: string | null;
}
type Handler = (call: Call, n: number) => { status?: number; body: unknown } | 'network';
function stub(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const counts: Record<string, number> = {};
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
      if (url.includes('/v1/auth/me')) return json(200, { data: me, meta: {} });
      if (url.includes('/v1/health')) return json(200, { data: { status: 'ok' }, meta: {} });
      for (const [key, h] of Object.entries(handlers))
        if (url.includes(key)) {
          counts[key] = (counts[key] ?? 0) + 1;
          const r = h(call, counts[key]!);
          if (r === 'network') throw new TypeError('network down');
          return json(r.status ?? 200, r.body);
        }
      if (url.includes('/v1/staff/history'))
        return json(200, { data: { counts: { redeemed: 3, rejected: 1 }, items: [] }, meta: {} });
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const mount = (locale: 'en' | 'ar' = 'en') =>
  render(
    <Providers locale={locale}>
      <ScanPage />
    </Providers>,
  );
const validate = (result: string, reservation: unknown = summary()) => ({
  body: { data: { result, reservation, serverNow: new Date().toISOString() }, meta: {} },
});

async function enterManual(code = 'K7QM-9T2X') {
  const user = userEvent.setup();
  // jsdom has no camera: the scanner falls back to manual entry and says why
  const input = await screen.findByLabelText('Reservation or voucher code');
  expect(screen.getByText(/No camera is available/i)).toBeInTheDocument();
  await user.type(input, code);
  await user.click(screen.getByTestId('check-code'));
  return user;
}

describe('code normalisation', () => {
  it('accepts any case or spacing for typed codes and leaves QR text alone', () => {
    expect(normaliseCode(' k7qm 9t2x ')).toBe('K7QM9T2X');
    expect(normaliseCode('K7QM-9T2X')).toBe('K7QM9T2X');
    expect(normaliseCode('DD1.AbCdEfGhIjKlMnOpQrStUv')).toBe('DD1.AbCdEfGhIjKlMnOpQrStUv');
  });
});

describe('staff redemption flow', () => {
  it('manual fallback: check the code, see the valid reservation, confirm, and get a clear success', async () => {
    const calls = stub({
      '/redemptions/validate': () => validate('VALID'),
      '/v1/staff/redemptions': (c) =>
        c.url.endsWith('/validate')
          ? validate('VALID')
          : {
              body: {
                data: {
                  result: 'REDEEMED',
                  reference: 'RD-ABC234',
                  redeemedAt: new Date().toISOString(),
                  reservation: summary({ redeemedAt: new Date().toISOString() }),
                  serverNow: new Date().toISOString(),
                },
                meta: {},
              },
            },
    });
    mount();
    const user = await enterManual();
    const result = await screen.findByTestId('staff-result');
    expect(result).toHaveAttribute('data-result', 'VALID');
    expect(within(result).getByText('Valid reservation')).toBeInTheDocument();
    expect(within(result).getByText('Free dessert with any main')).toBeInTheDocument();
    expect(within(result).getByText('Layla')).toBeInTheDocument(); // first name only
    expect(document.body.textContent).not.toMatch(/\+966|@|finance|campaign/i);
    await user.click(screen.getByTestId('redeem-open'));
    await user.click(
      within(await screen.findByTestId('redeem-sheet')).getByTestId('confirm-redeem'),
    );
    const done = await screen.findByText('Redeemed', { selector: 'h1' });
    expect(done).toBeInTheDocument();
    expect(screen.getByText('RD-ABC234')).toBeInTheDocument();
    const redeem = calls.find(
      (c) => c.method === 'POST' && c.url.endsWith('/v1/staff/redemptions'),
    )!;
    expect(redeem.key).toMatch(/.{8,}/); // an Idempotency-Key was sent
    expect(JSON.parse(redeem.body!)).toEqual({ code: 'K7QM9T2X', source: 'MANUAL' });
    await user.click(screen.getByTestId('scan-next'));
    expect(await screen.findByRole('heading', { name: 'Enter code instead' })).toBeInTheDocument();
  });

  const MATRIX: Array<[string, string, string, Record<string, unknown>?]> = [
    ['INVALID_CODE', 'Code not recognised', 'stop'],
    ['EXPIRED', 'Reservation not completed', 'warn'],
    [
      'ALREADY_REDEEMED',
      'Already used',
      'stop',
      { redeemedAt: '2026-10-08T10:00:00.000Z', redeemedBranchName: { en: 'Olaya', ar: 'العليا' } },
    ],
    ['WRONG_BRANCH', 'Wrong branch', 'warn', { validBranchName: { en: 'Al Malqa', ar: 'الملقا' } }],
    ['NOT_VALID_YET', 'Not valid yet', 'warn', { startsAt: '2026-10-08T18:00:00.000Z' }],
    [
      'INELIGIBLE',
      'Not eligible for this offer',
      'stop',
      {
        requirement: {
          en: 'Offer for verified employees of a partner company',
          ar: 'عرض لموظفي شركة شريكة بعد التحقق',
        },
      },
    ],
    ['NOT_ACTIVE', 'Reservation cancelled', 'stop'],
    ['CAMPAIGN_UNAVAILABLE', 'Offer not available right now', 'stop'],
  ];
  for (const [code, title, tone, extra] of MATRIX)
    it(`one adaptive result: ${code} never offers a confirm button`, async () => {
      stub({
        '/redemptions/validate': () =>
          validate(code, code === 'INVALID_CODE' ? null : summary(extra)),
      });
      mount();
      await enterManual();
      const result = await screen.findByTestId('staff-result');
      expect(result).toHaveAttribute('data-result', code);
      expect(result.className).toContain(`dd-result--${tone}`);
      expect(within(result).getByText(title)).toBeInTheDocument();
      expect(screen.queryByTestId('confirm-redeem')).toBeNull();
      expect(screen.getByTestId('scan-next')).toBeInTheDocument();
      if (code === 'WRONG_BRANCH')
        expect(within(result).getByText(/valid at Al Malqa/)).toBeInTheDocument();
      if (code === 'NOT_VALID_YET') expect(within(result).getByText('Starts')).toBeInTheDocument();
      if (code === 'INELIGIBLE')
        expect(within(result).getByText(/verified employees/)).toBeInTheDocument();
      // neutral wording: never accusatory
      expect(result.textContent).not.toMatch(/no-show|fraud|penalt|ban/i);
    });

  it('the confirmation bottom sheet shows what is being redeemed, warns it is irreversible, and only then redeems', async () => {
    const calls = stub({
      '/v1/staff/redemptions': (c) =>
        c.url.endsWith('/validate')
          ? validate('VALID')
          : {
              body: {
                data: {
                  result: 'REDEEMED',
                  reference: 'RD-SHEET2',
                  redeemedAt: new Date().toISOString(),
                  reservation: summary(),
                  serverNow: new Date().toISOString(),
                },
                meta: {},
              },
            },
    });
    mount();
    const user = await enterManual();
    await screen.findByTestId('staff-result');
    // the CTA only opens the sheet: nothing is redeemed yet
    await user.click(screen.getByTestId('redeem-open'));
    const sheet = await screen.findByRole('dialog', { name: 'Redeem this reservation?' });
    expect(within(sheet).getByText('Free dessert with any main')).toBeInTheDocument();
    expect(within(sheet).getByText('Layla')).toBeInTheDocument();
    expect(within(sheet).getByText(/This cannot be undone/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/v1/staff/redemptions'))).toBe(
      false,
    );
    // cancelling closes the sheet and still sends nothing
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/v1/staff/redemptions'))).toBe(
      false,
    );
    // a rapid double tap on Confirm sends exactly one redemption
    await user.click(screen.getByTestId('redeem-open'));
    const confirmBtn = await screen.findByTestId('confirm-redeem');
    await user.dblClick(confirmBtn);
    expect(await screen.findByText('RD-SHEET2')).toBeInTheDocument();
    expect(
      calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v1/staff/redemptions')),
    ).toHaveLength(1);
  });

  it('a bad connection while confirming offers a retry that reuses the SAME Idempotency-Key (cannot redeem twice)', async () => {
    let attempt = 0;
    const calls = stub({
      '/v1/staff/redemptions': (c) => {
        if (c.url.endsWith('/validate')) return validate('VALID');
        attempt++;
        if (attempt === 1) return 'network';
        return {
          body: {
            data: {
              result: 'REDEEMED',
              reference: 'RD-RETRY2',
              redeemedAt: new Date().toISOString(),
              reservation: summary(),
              serverNow: new Date().toISOString(),
            },
            meta: {},
          },
        };
      },
    });
    mount();
    const user = await enterManual();
    await user.click(await screen.findByTestId('redeem-open'));
    await user.click(await screen.findByTestId('confirm-redeem'));
    expect(await screen.findByTestId('staff-offline')).toBeInTheDocument();
    expect(screen.getByText(/needs an internet connection/i)).toBeInTheDocument();
    await user.click(screen.getByTestId('retry'));
    expect(await screen.findByText('RD-RETRY2')).toBeInTheDocument();
    const posts = calls.filter(
      (c) => c.method === 'POST' && c.url.endsWith('/v1/staff/redemptions'),
    );
    expect(posts).toHaveLength(2);
    expect(posts[0]!.key).toBeTruthy();
    expect(posts[1]!.key).toBe(posts[0]!.key);
  });

  it('too many wrong codes shows a calm rate-limit message', async () => {
    stub({
      '/redemptions/validate': () => ({
        status: 429,
        body: { errors: [{ code: 'RATE_LIMITED', message: 'x' }], meta: {} },
      }),
    });
    mount();
    await enterManual();
    expect(await screen.findByTestId('staff-error')).toHaveTextContent(
      /Too many codes did not match/,
    );
  });

  it('a race lost to another device is reported as already used, not as an error', async () => {
    stub({
      '/v1/staff/redemptions': (c) =>
        c.url.endsWith('/validate')
          ? validate('VALID')
          : {
              body: {
                data: {
                  result: 'ALREADY_REDEEMED',
                  reference: null,
                  redeemedAt: null,
                  reservation: summary({ redeemedAt: '2026-10-08T10:00:00.000Z' }),
                  serverNow: new Date().toISOString(),
                },
                meta: {},
              },
            },
    });
    mount();
    const user = await enterManual();
    await user.click(await screen.findByTestId('redeem-open'));
    await user.click(await screen.findByTestId('confirm-redeem'));
    const r = await screen.findByTestId('staff-result');
    expect(r).toHaveAttribute('data-result', 'ALREADY_REDEEMED');
  });

  it('shows today’s counts and an offline banner when the device is offline', async () => {
    stub({});
    mount();
    expect(await screen.findByTestId('today-counts')).toHaveTextContent(
      /3 redeemed · 1 not accepted/,
    );
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    expect(await screen.findByTestId('offline-banner')).toBeInTheDocument();
    expect(screen.getByTestId('check-code')).toBeDisabled();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(screen.queryByTestId('offline-banner')).toBeNull());
  });

  it('Arabic: right-to-left labels, Western digits, and a result in Arabic', async () => {
    stub({
      '/redemptions/validate': () =>
        validate('ALREADY_REDEEMED', summary({ redeemedAt: '2026-10-08T10:00:00.000Z' })),
    });
    mount('ar');
    const user = userEvent.setup();
    const input = await screen.findByLabelText('رمز الحجز أو القسيمة');
    await user.type(input, 'K7QM9T2X');
    await user.click(screen.getByTestId('check-code'));
    const result = await screen.findByTestId('staff-result');
    expect(within(result).getByText('سبق استخدامه')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });
});

describe('paid reservations at the counter (RC-60, read-only)', () => {
  const money = (over: Record<string, unknown> = {}) => ({
    method: 'DEPOSIT',
    paymentStatus: 'PAID',
    amountMinor: 1500,
    currency: 'SAR',
    depositRefundable: true,
    holdStatus: null,
    refundedMinor: 0,
    keptMinor: null,
    ...over,
  });

  it('a deposit tells staff to credit it to the bill; nothing about the payment can be changed', async () => {
    stub({ '/redemptions/validate': () => validate('VALID', summary({ money: money() })) });
    mount();
    await enterManual();
    const box = await screen.findByTestId('staff-money');
    expect(box).toHaveAttribute('data-method', 'DEPOSIT');
    expect(box).toHaveTextContent('Deposit SAR 15.00, credit it to the bill');
    expect(within(box).getByTestId('staff-money-status')).toHaveTextContent('Paid');
    expect(box).toHaveTextContent('Payment terms are fixed. Staff cannot change them.');
    expect(within(box).queryByRole('textbox')).toBeNull();
    expect(within(box).queryByRole('button')).toBeNull();
  });

  it('full payment and an active card hold read clearly; a free reservation shows no payment block', async () => {
    stub({
      '/redemptions/validate': (_c, n) =>
        validate(
          'VALID',
          n === 1
            ? summary({ money: money({ method: 'FULL_PREPAYMENT', amountMinor: 4500 }) })
            : summary({
                money: money({
                  method: 'CARD_PREAUTH',
                  paymentStatus: 'AUTHORISED',
                  amountMinor: 2000,
                  holdStatus: 'AUTHORISED',
                }),
              }),
        ),
    });
    const { unmount } = mount();
    await enterManual();
    let box = await screen.findByTestId('staff-money');
    expect(box).toHaveTextContent('Paid in full');
    expect(box).toHaveTextContent('Amount paid: SAR 45.00');
    unmount();
    mount();
    await enterManual();
    box = await screen.findByTestId('staff-money');
    expect(box).toHaveTextContent('Card hold SAR 20.00');
    expect(within(box).getByTestId('staff-money-status')).toHaveTextContent('Hold active');
    expect(box).toHaveTextContent('the customer pays at the till');
  });

  it('free reservations are unchanged (no payment block); Arabic deposit wording', async () => {
    stub({ '/redemptions/validate': () => validate('VALID') });
    const { unmount } = mount();
    await enterManual();
    await screen.findByTestId('staff-result');
    expect(screen.queryByTestId('staff-money')).toBeNull();
    unmount();
    stub({ '/redemptions/validate': () => validate('VALID', summary({ money: money() })) });
    mount('ar');
    const input = await screen.findByLabelText('رمز الحجز أو القسيمة');
    const user = userEvent.setup();
    await user.type(input, 'K7QM-9T2X');
    await user.click(screen.getByTestId('check-code'));
    const box = await screen.findByTestId('staff-money');
    expect(box).toHaveTextContent('عربون 15.00 ر.س، اخصمه من الفاتورة');
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
  });
});

describe('staff history and account', () => {
  it('lists the day with counts, filters, and never shows a customer phone number', async () => {
    const calls = stub({
      '/v1/staff/history': () => ({
        body: {
          data: {
            counts: { redeemed: 1, rejected: 1 },
            items: [
              {
                id: 'h1',
                result: 'REDEEMED',
                at: '2026-10-08T10:00:00.000Z',
                reference: 'RD-AAAAAA',
                dealTitle: { en: 'Free dessert', ar: 'حلى مجاني' },
                quantity: 1,
                customerFirstName: 'Layla',
                source: 'QR',
              },
              {
                id: 'h2',
                result: 'ALREADY_REDEEMED',
                at: '2026-10-08T10:05:00.000Z',
                reference: 'DD-K7QM9T',
                dealTitle: { en: 'Free dessert', ar: 'حلى مجاني' },
                quantity: 1,
                customerFirstName: 'Layla',
                source: 'MANUAL',
              },
            ],
          },
          meta: {},
        },
      }),
    });
    const user = userEvent.setup();
    render(
      <Providers locale="en">
        <HistoryPage />
      </Providers>,
    );
    const rows = await screen.findAllByTestId('history-row');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveAttribute('data-result', 'ALREADY_REDEEMED');
    expect(screen.getByTestId('count-redeemed')).toHaveTextContent('1');
    await user.click(screen.getByRole('button', { name: 'Not accepted', pressed: false }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('filter=rejected'))).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Yesterday' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('day=yesterday'))).toBe(true));
    expect(document.body.textContent).not.toMatch(/\+966/);
    // search by the last letters of a code (debounced, punctuation ignored)
    await user.type(screen.getByLabelText('Search by code'), 'k7-qm');
    await waitFor(() => expect(calls.some((c) => c.url.includes('q=k7qm'))).toBe(true));
    // tapping a row opens the detail sheet with the scan facts
    await user.click((await screen.findAllByTestId('history-row'))[0]!);
    const sheet = await screen.findByTestId('history-detail');
    expect(within(sheet).getByText('Scan details')).toBeInTheDocument();
    expect(within(sheet).getByText('RD-AAAAAA')).toBeInTheDocument();
    expect(within(sheet).getByText('Layla')).toBeInTheDocument();
    expect(sheet.textContent).not.toMatch(/\+966|@/);
    await user.click(within(sheet).getAllByRole('button', { name: 'Close' })[0]!);
    expect(screen.queryByTestId('history-detail')).toBeNull();
  });

  it('account shows the merchant and branch scope and signs out', async () => {
    stub({
      '/v1/staff/me': () => ({
        body: {
          data: {
            displayName: 'Khalid',
            merchantName: { en: 'Harbour Grill', ar: 'هاربور جريل' },
            branch: { en: 'Olaya', ar: 'العليا' },
            branches: [],
            canRedeem: true,
            historyDays: 2,
          },
          meta: {},
        },
      }),
    });
    render(
      <Providers locale="en">
        <AccountPage />
      </Providers>,
    );
    expect(await screen.findByText('Harbour Grill')).toBeInTheDocument();
    expect(screen.getByText(/Olaya/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign out' }).length).toBeGreaterThan(0);
  });
});
