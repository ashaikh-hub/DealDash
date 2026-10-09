import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
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

const voucher = (over: Record<string, unknown> = {}) => ({
  kind: 'VOUCHER',
  faceValueHalalas: 10_000,
  ref: 'VC-K7QM9T',
  quantity: 1,
  dealTitle: { en: 'SAR 100 dining voucher', ar: 'قسيمة طعام بقيمة 100 ريال' },
  offerLabel: { en: 'SAR 100 voucher', ar: 'قسيمة 100 ر.س' },
  merchantName: { en: 'Harbour Grill', ar: 'هاربور جريل' },
  branchName: { en: 'Olaya', ar: 'العليا' },
  customerFirstName: 'Layla',
  expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
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
function stub(handlers: Record<string, (c: Call) => { status?: number; body: unknown }>) {
  const calls: Call[] = [];
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
      for (const [key, h] of Object.entries(handlers))
        if (url.includes(key)) {
          const r = h(call);
          return json(r.status ?? 200, r.body);
        }
      if (url.includes('/v1/staff/history'))
        return json(200, { data: { counts: { redeemed: 0, rejected: 0 }, items: [] }, meta: {} });
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const validate = (result: string, reservation: unknown = voucher()) => ({
  body: { data: { result, reservation, serverNow: new Date().toISOString() }, meta: {} },
});
const mount = (locale: 'en' | 'ar' = 'en') =>
  render(
    <Providers locale={locale}>
      <ScanPage />
    </Providers>,
  );
async function enter(code = 'K7QM-9T2X') {
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText(/Reservation or voucher code|رمز الحجز أو القسيمة/),
    code,
  );
  await user.click(screen.getByTestId('check-code'));
  return user;
}

describe('staff voucher redemption', () => {
  it('voucher QR text passes through untouched, like reservation QR text', () => {
    expect(normaliseCode('DV1.AbCdEfGhIjKlMnOpQrStUv')).toBe('DV1.AbCdEfGhIjKlMnOpQrStUv');
  });

  it('a valid voucher shows the value to honour, the voucher wording and a voucher-specific confirmation', async () => {
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
                  reservation: voucher({ redeemedAt: new Date().toISOString() }),
                  serverNow: new Date().toISOString(),
                },
                meta: {},
              },
            },
    });
    mount();
    const user = await enter();
    const result = await screen.findByTestId('staff-result');
    expect(result).toHaveAttribute('data-result', 'VALID');
    expect(result).toHaveClass('dd-result--ok');
    expect(within(result).getByTestId('staff-voucher-value')).toHaveTextContent('SAR 100.00');
    expect(within(result).getByText(/redeem the full voucher value/i)).toBeInTheDocument();
    expect(within(result).getByText('Layla')).toBeInTheDocument();
    await user.click(screen.getByTestId('redeem-open'));
    expect(await screen.findByText('Redeem this voucher?')).toBeInTheDocument();
    expect(screen.getByText(/full voucher value is used now/i)).toBeInTheDocument();
    await user.click(screen.getByTestId('confirm-redeem'));
    const done = await screen.findByTestId('staff-result');
    await waitFor(() => expect(done).toHaveAttribute('data-result', 'REDEEMED'));
    expect(done).toHaveTextContent('This voucher is now used.');
    const post = calls.find((c) => c.method === 'POST' && !c.url.endsWith('/validate'))!;
    expect(post.key).toBeTruthy();
  });

  it.each([
    ['EXPIRED', 'warn'],
    ['NOT_VALID_YET', 'warn'],
    ['WRONG_BRANCH', 'warn'],
    ['VOUCHER_SUSPENDED', 'stop'],
    ['REFUNDED', 'stop'],
    ['ALREADY_REDEEMED', 'stop'],
    ['INVALID', 'stop'],
  ])('%s uses the %s colour of the Stage 4 model and never offers redeem', async (result, tone) => {
    stub({
      '/redemptions/validate': () =>
        validate(
          result,
          result === 'INVALID' ? null : voucher({ validBranchName: { en: 'Hittin', ar: 'حطين' } }),
        ),
    });
    mount();
    await enter();
    const box = await screen.findByTestId('staff-result');
    expect(box).toHaveAttribute('data-result', result);
    expect(box).toHaveClass(`dd-result--${tone}`);
    expect(screen.queryByTestId('redeem-open')).toBeNull();
  });

  it('the suspended and refunded messages tell staff what to do, in Arabic too', async () => {
    stub({ '/redemptions/validate': () => validate('VOUCHER_SUSPENDED') });
    mount('ar');
    await enter();
    const box = await screen.findByTestId('staff-result');
    expect(box).toHaveTextContent('القسيمة موقوفة');
    expect(box).toHaveTextContent('لا تقم باستردادها');
  });
});
