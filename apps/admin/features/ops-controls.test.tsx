import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';

/** The shape the server returns for `operations` (a trimmed copy of the defaults). */
const reason = (code: string, en: string, ar: string) => ({ code, en, ar });
const DEFAULT_OPERATIONS_CONFIG = {
  caseApprovalAboveMinor: 0,
  sla: {
    CASE: {
      targetHours: { LOW: 120, NORMAL: 72, HIGH: 24, CRITICAL: 4 },
      warnPct: 75,
      escalation: [],
    },
  },
  approvals: {
    adjustments: {
      CREDIT_NOTE: { mode: 'ALWAYS', thresholdMinor: 0 },
      SETTLEMENT_ADJUSTMENT: { mode: 'ABOVE_THRESHOLD', thresholdMinor: 100_000 },
    },
    directAdjustmentMaxMinor: 100_000,
    orderRefund: { mode: 'ALWAYS', thresholdMinor: 0 },
    refundReviewCheckerAboveMinor: null,
    restrictions: { CUSTOMER_RESTRICTION: 'ALWAYS' },
    settlementOverride: 'ALWAYS',
    dataRequests: 'ALWAYS',
  },
  reasons: {
    refund: [reason('CUSTOMER_REQUEST', 'Customer request', 'طلب العميل')],
    dispute: [reason('OTHER', 'Other', 'أخرى')],
    adjustment: [reason('CORRECTION', 'Correction of an error', 'تصحيح خطأ')],
    hold: [reason('POLICY_BREACH', 'Policy breach', 'مخالفة السياسة')],
    moderation: [reason('SPAM', 'Spam', 'رسائل مزعجة')],
  },
  risk: {
    rules: {
      REPEATED_CODE_ATTEMPTS: { enabled: true, threshold: 5, windowMinutes: 60, decision: 'FLAG' },
    },
  },
  restrictions: {
    maxDays: { CUSTOMER_RESTRICTION: 30 },
    notifySubject: { CUSTOMER_RESTRICTION: true },
  },
  notifications: { maxAttempts: 3, retryMinutes: [5, 30, 120], templates: {} },
  reviews: {
    mode: 'PUBLISH_THEN_MODERATE',
    perMerchantDays: 30,
    minTextLength: 10,
    hideAfterReports: 3,
  },
};
import { AdminRulesPage } from './ops-controls';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/configuration',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ME = '018f0000-0000-7000-8000-000000000009';
const me = (permissions: string[]) => ({
  id: ME,
  userType: 'ADMIN_USER',
  displayName: 'Admin',
  locale: 'en',
  audience: 'admin',
  mfaVerified: true,
  mfaRequired: true,
  csrfToken: 'csrf',
  activeMembership: {
    organizationId: '018f0000-0000-7000-8000-0000000000dd',
    organizationType: 'DEALDASH',
    organizationName: { en: 'DealDash', ar: 'ديل داش' },
    organizationStatus: 'ACTIVE',
    roleCode: 'DEALDASH_SUPER_ADMIN',
    branchId: null,
  },
  memberships: [],
  permissions,
});
type R = { status?: number; body: unknown };
const ok = (data: unknown): R => ({ body: { data, meta: {} } });
const calls: Array<{ method: string; path: string; body: unknown }> = [];
function stub(routes: Record<string, R>, perms: string[]) {
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms), meta: {} });
      const path = url.split('?')[0]!;
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length)) {
        const [m, p] = key.includes(' ') ? key.split(' ') : ['GET', key];
        if (method === m && path.endsWith(p!))
          return json(routes[key]!.status ?? 200, routes[key]!.body);
      }
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());
const show = (locale: 'en' | 'ar' = 'en') =>
  render(
    <Providers locale={locale}>
      <AdminRulesPage />
    </Providers>,
  );

const overview = (open: unknown[] = []) =>
  ok({
    configs: [
      {
        key: 'operations',
        value: DEFAULT_OPERATIONS_CONFIG,
        version: 3,
        updatedAt: null,
        kind: 'OBJECT',
        group: null,
        min: null,
        max: null,
      },
      {
        key: 'launch.controls',
        value: {
          pilot: { mode: 'OPEN', merchantOrganizationIds: [], partnerOrganizationIds: [] },
          stops: {},
        },
        version: 1,
        updatedAt: null,
        kind: 'OBJECT',
        group: null,
        min: null,
        max: null,
      },
      {
        key: 'rewards.rules',
        value: { negativeBalancePolicy: 'ALLOW_NEGATIVE', refundReversalRounding: 'FLOOR' },
        version: 1,
        updatedAt: null,
        kind: 'OBJECT',
        group: null,
        min: null,
        max: null,
      },
      {
        key: 'reservation.max_active',
        value: 3,
        version: 2,
        updatedAt: null,
        kind: 'SCALAR',
        group: 'INVENTORY',
        min: 1,
        max: 20,
      },
    ],
    open,
    recent: [],
  });
const request = (over: Record<string, unknown>) => ({
  id: 'r1',
  reference: 'CFG-1',
  key: 'operations',
  section: 'reasons.refund',
  status: 'PENDING_APPROVAL',
  reason: 'New pilot reason',
  effectiveFrom: null,
  restoresVersion: null,
  decisionReason: null,
  appliedVersion: null,
  createdAt: new Date().toISOString(),
  canDecide: false,
  canCancel: true,
  ...over,
});

describe('Stage 9 rules and controls (B7)', () => {
  it('the requester cannot approve their own change; a different approver sees approve / reject', async () => {
    stub({ '/v1/admin/controls': overview([request({})]) }, [
      'admin.config.read',
      'admin.config.manage',
    ]);
    const v = show();
    const card = await screen.findByTestId('cfg-req-CFG-1');
    expect(card).toHaveTextContent('Waiting for approval');
    expect(within(card).queryByTestId('ops-approve-CFG-1')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    v.unmount();
    vi.unstubAllGlobals();
    stub(
      {
        '/v1/admin/controls': overview([request({ canDecide: true, canCancel: false })]),
        'POST /v1/admin/controls/requests/r1/decide': ok(request({ status: 'APPLIED' })),
      },
      ['admin.config.read', 'admin.config.manage'],
    );
    show();
    await screen.findByTestId('cfg-req-CFG-1');
    await userEvent.type(screen.getByLabelText('Reason'), 'Agreed with operations');
    await userEvent.click(screen.getByTestId('ops-approve-CFG-1'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      decision: 'APPROVE',
      reason: 'Agreed with operations',
    });
  });

  it('reasons are edited in a form (never JSON); invalid rows block the proposal; the proposal carries the version it was made against', async () => {
    stub(
      { '/v1/admin/controls': overview(), 'POST /v1/admin/controls/requests': ok(request({})) },
      ['admin.config.read', 'admin.config.manage'],
    );
    show();
    await userEvent.click(await screen.findByRole('tab', { name: 'Reasons' }));
    const section = await screen.findByTestId('cfg-reasons');
    expect(within(section).queryByRole('textbox', { name: /JSON/ })).toBeNull();
    await userEvent.click(screen.getByTestId('cfg-reason-add'));
    const submit = screen.getByTestId('cfg-submit-reasons.refund');
    await userEvent.type(screen.getByLabelText('Reason'), 'Pilot goodwill reason');
    // the new row is empty: blocked
    expect(submit).toBeDisabled();
    const codes = within(section).getAllByLabelText('Reason code');
    await userEvent.type(codes.at(-1)!, 'pilot_goodwill');
    await userEvent.type(
      within(section).getAllByLabelText('English label').at(-1)!,
      'Pilot goodwill',
    );
    await userEvent.type(
      within(section).getAllByLabelText('Arabic label').at(-1)!,
      'حسن نية للتجربة',
    );
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    const body = calls.find((c) => c.method === 'POST')?.body as {
      key: string;
      section: string;
      baseVersion: number;
      value: { reasons: { refund: Array<{ code: string }> } };
    };
    expect(body).toMatchObject({ key: 'operations', section: 'reasons.refund', baseVersion: 3 });
    expect(body.value.reasons.refund.at(-1)?.code).toBe('PILOT_GOODWILL');
    expect(
      await screen.findByText('Change proposed. A second person must approve it.'),
    ).toBeInTheDocument();
  });

  it('a scalar control is limited to its allowed range', async () => {
    stub({ '/v1/admin/controls': overview() }, ['admin.config.read', 'admin.config.manage']);
    show();
    await userEvent.click(
      await screen.findByRole('tab', { name: 'Redemption, inventory and security' }),
    );
    const input = await screen.findByLabelText(/Active reservations per customer/);
    await userEvent.type(screen.getAllByLabelText('Reason')[0]!, 'Pilot capacity');
    await userEvent.clear(input);
    await userEvent.type(input, '50');
    expect(screen.getByTestId('cfg-submit-reservation.max_active')).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '4');
    expect(screen.getByTestId('cfg-submit-reservation.max_active')).toBeEnabled();
  });

  it('emergency stops: immediate with a reason; a person without launch control only sees the state', async () => {
    stub(
      {
        '/v1/admin/controls': overview(),
        'POST /v1/admin/controls/launch/stops': ok({
          pilot: { mode: 'OPEN', merchantOrganizationIds: [], partnerOrganizationIds: [] },
          stops: { SA: { NEW_PURCHASES: true } },
        }),
      },
      ['admin.config.read', 'admin.launch.control'],
    );
    const v = show();
    await userEvent.click(await screen.findByRole('tab', { name: 'Launch controls' }));
    const stops = await screen.findByTestId('cfg-stops');
    expect(stops).toHaveTextContent('refuses only NEW actions');
    const btn = screen.getByTestId('cfg-stop-NEW_PURCHASES');
    expect(btn).toBeDisabled();
    await userEvent.type(within(stops).getByLabelText('Reason'), 'Payment provider incident');
    await userEvent.click(btn);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      market: 'SA',
      action: 'NEW_PURCHASES',
      stopped: true,
      reason: 'Payment provider incident',
    });
    expect(await within(stops).findByText(/New voucher purchases: stopped/)).toBeInTheDocument();
    v.unmount();
    vi.unstubAllGlobals();
    stub({ '/v1/admin/controls': overview() }, ['admin.config.read']);
    show();
    await userEvent.click(await screen.findByRole('tab', { name: 'Launch controls' }));
    await screen.findByTestId('cfg-stops');
    expect(screen.queryByTestId('cfg-stop-NEW_PURCHASES')).toBeNull();
  });

  it('Arabic: the controls screen renders right-to-left copy', async () => {
    stub({ '/v1/admin/controls': overview() }, ['admin.config.read']);
    show('ar');
    expect(await screen.findByRole('tab', { name: 'ضوابط الإطلاق' })).toBeInTheDocument();
  });
});
