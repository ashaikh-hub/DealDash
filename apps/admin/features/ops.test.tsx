import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { AdminCasesPage, AdminRulesPage, AdminSlaPage, OpsExceptionsPanel } from './ops-control';
import { AdminAdjustmentsPage, AdminReconciliationPage, AdminSettlementsPage } from './ops-finance';
import { AdminNotificationsPage, AdminSupportPage } from './ops-service';
import { AdminFraudPage, AdminModerationPage, AdminRestrictionsPage } from './ops-trust';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/cases',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ME = '018f0000-0000-7000-8000-000000000009';
const OTHER = '018f0000-0000-7000-8000-000000000010';
const ORG = '018f0000-0000-7000-8000-0000000000b1';
const me = (permissions: string[]) => ({
  id: ME,
  userType: 'ADMIN_USER',
  displayName: 'Operations',
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
    roleCode: 'DEALDASH_OPERATIONS',
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
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms), meta: {} });
      const path = url.split('?')[0]!;
      const method = init?.method ?? 'GET';
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length)) {
        const [m, p] = key.includes(' ') ? key.split(' ') : ['GET', key];
        if (method === m && path.endsWith(p!)) return json(routes[key]!.status ?? 200, routes[key]!.body);
      }
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());
const show = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') => render(<Providers locale={locale}>{ui}</Providers>);
const REASONS = ok({
  adjustment: [{ code: 'GOODWILL', en: 'Goodwill', ar: 'حسن نية' }],
  hold: [{ code: 'FRAUD_SUSPECTED', en: 'Suspected fraud under review', ar: 'اشتباه' }],
  moderation: [{ code: 'SPAM', en: 'Spam', ar: 'مزعج' }],
  refund: [],
  dispute: [],
});
const adjustment = (over: Record<string, unknown>) => ({
  id: 'a1',
  reference: 'ADJ-1',
  kind: 'SETTLEMENT_ADJUSTMENT',
  status: 'PENDING_APPROVAL',
  direction: 'CREDIT',
  amountMinor: 250000,
  points: null,
  currency: 'SAR',
  market: 'SA',
  organizationId: ORG,
  customerUserId: null,
  caseId: null,
  reasonCode: 'GOODWILL',
  reason: 'Goodwill after the outage',
  requiresApproval: true,
  decisionReason: null,
  appliedRef: null,
  failureReason: null,
  createdAt: new Date().toISOString(),
  canDecide: false,
  ...over,
});

describe('Stage 8 admin operations', () => {
  it('adjustments: the maker sees "waiting for a second person"; a different finance approver sees approve / reject; a request needs a configured reason', async () => {
    stub({ '/v1/admin/ops/adjustments': ok([adjustment({})]), '/v1/admin/ops/reasons': REASONS }, ['admin.finance.read', 'admin.finance.manage']);
    const view = show(<AdminAdjustmentsPage />);
    const card = await screen.findByTestId('adj-ADJ-1');
    expect(card).toHaveTextContent('Settlement adjustment');
    expect(card).toHaveTextContent('Waiting for approval');
    expect(within(card).getByTestId('ops-awaiting-ADJ-1')).toHaveTextContent('Waiting for a second person to decide.');
    expect(within(card).queryByTestId('ops-approve-ADJ-1')).toBeNull();
    // the request form stays disabled until amount, reason code and reason are given
    const submit = screen.getByTestId('adj-submit');
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Amount'), '100');
    await userEvent.selectOptions(await screen.findByLabelText('Reason code'), 'GOODWILL');
    await userEvent.type(screen.getByLabelText('Reason'), 'Goodwill credit agreed');
    expect(submit).toBeEnabled();
    view.unmount();
    vi.unstubAllGlobals();
    stub({ '/v1/admin/ops/adjustments': ok([adjustment({ canDecide: true })]), '/v1/admin/ops/reasons': REASONS, 'POST /v1/admin/ops/adjustments/a1/decide': ok(adjustment({ status: 'APPLIED' })) }, ['admin.finance.read', 'admin.finance.approve']);
    show(<AdminAdjustmentsPage />);
    await screen.findByTestId('adj-ADJ-1');
    const approve = screen.getByTestId('ops-approve-ADJ-1');
    expect(approve).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'Checked the outage report');
    await userEvent.click(approve);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ decision: 'APPROVE', reason: 'Checked the outage report' });
    expect(await screen.findByTestId('ops-banner')).toHaveTextContent('Adjustment approved and applied.');
  });

  it('adjustments: after approval the "All" filter shows the applied adjustment with its ledger reference', async () => {
    stub(
      {
        '/v1/admin/ops/adjustments': ok([adjustment({ status: 'APPLIED', canDecide: false, appliedRef: { kind: 'JOURNAL', id: 'JRN-1' }, decisionReason: 'Checked', direction: 'DEBIT', kind: 'RECONCILIATION_ADJUSTMENT', organizationId: null, currency: null })]),
        '/v1/admin/ops/reasons': REASONS,
      },
      ['admin.finance.read', 'admin.finance.approve', 'admin.finance.manage'],
    );
    show(<AdminAdjustmentsPage />);
    await userEvent.selectOptions(await screen.findByTestId('adj-filter'), '');
    expect(await screen.findByTestId('adj-ADJ-1')).toHaveTextContent('Applied as JOURNAL JRN-1');
  });

  it('settlements: a held statement shows the financial-hold state and only a release (with a reason)', async () => {
    const s = {
      id: 's1',
      reference: 'STL-1',
      organizationId: ORG,
      merchantNameEn: 'Corner Bakery',
      merchantNameAr: 'مخبز الزاوية',
      legalEntityId: null,
      market: 'SA',
      currency: 'SAR',
      product: 'VOUCHER',
      status: 'DISPUTE_HOLD',
      periodFrom: '2026-09-01T00:00:00.000Z',
      periodTo: '2026-09-30T00:00:00.000Z',
      grossMinor: 100000,
      feesMinor: 10000,
      taxMinor: 1500,
      adjustmentsMinor: 0,
      carriedForwardMinor: 0,
      payableMinor: 90000,
      paidMinor: 0,
      outstandingMinor: 90000,
      settlementDate: null,
      destinationRef: null,
      reconciliationStatus: 'UNRECONCILED',
      holdReason: 'Open dispute with a financial impact',
      failureReason: null,
      carriedIntoId: null,
      items: { ELIGIBLE: 3 },
      payouts: [],
    };
    stub({ '/v1/admin/ops/settlements': ok([s]), '/v1/admin/ops/settlements/s1': ok(s) }, ['admin.finance.read', 'admin.settlements.manage']);
    show(<AdminSettlementsPage />);
    expect(await screen.findByTestId('set-STL-1')).toHaveTextContent('On hold for a dispute');
    await userEvent.click(screen.getByTestId('set-open-STL-1'));
    expect(await screen.findByTestId('set-hold-state')).toHaveTextContent('Open dispute with a financial impact');
    expect(screen.queryByTestId('set-payout')).toBeNull();
    expect(screen.queryByTestId('set-hold')).toBeNull();
    expect(screen.getByTestId('set-release')).toBeDisabled();
    expect(screen.getByTestId('set-detail')).toHaveTextContent('Tax shown here is informational');
  });

  it('settlements: denied without finance read; an API refusal shows the access-denied state, not a crash', async () => {
    stub({}, ['admin.org.read']);
    const v = show(<AdminSettlementsPage />);
    expect(await screen.findByText('You do not have access to this page.')).toBeInTheDocument();
    v.unmount();
    vi.unstubAllGlobals();
    stub({ '/v1/admin/ops/settlements': { status: 403, body: { errors: [{ code: 'FORBIDDEN', message: 'no' }], meta: {} } } }, ['admin.finance.read']);
    show(<AdminSettlementsPage />);
    expect(await screen.findByTestId('ops-denied')).toHaveTextContent('You do not have access to this.');
  });

  it('reconciliation: exceptions with external / internal / difference, and a resolution needs a reason', async () => {
    stub(
      {
        '/v1/admin/ops/reconciliation/items': ok([
          { id: 'r1', reference: 'REC-1', runId: 'x', source: 'PAYMENT_GATEWAY', status: 'AMOUNT_MISMATCH', matchStatus: null, externalReference: 'PSP-9', externalAmountMinor: 10500, externalAt: null, internalType: 'Payment', internalId: 'p', internalReference: 'ORD-9', internalAmountMinor: 10000, internalAt: null, varianceMinor: 500, currency: 'SAR', market: 'SA', organizationId: ORG, ownerUserId: null, resolution: null, adjustmentRequestId: null, caseId: null, resolvedAt: null, createdAt: new Date().toISOString() },
        ]),
        '/v1/admin/ops/reconciliation/runs': ok([]),
      },
      ['admin.finance.read', 'admin.reconciliation.manage'],
    );
    show(<AdminReconciliationPage />);
    const row = await screen.findByTestId('rec-REC-1');
    expect(row).toHaveTextContent('Amount mismatch');
    expect(row).toHaveTextContent('PSP-9');
    expect(row).toHaveTextContent('ORD-9');
    await userEvent.click(screen.getByTestId('rec-resolve-open-REC-1'));
    expect(screen.getByTestId('rec-resolve-btn')).toBeDisabled();
  });

  it('fraud review: a person clears or confirms with a reason; nothing is restricted unless asked', async () => {
    stub(
      {
        '/v1/admin/ops/risk/flags': ok([{ id: 'f1', domain: 'BRANCH', ruleCode: 'REPEATED_CODE_ATTEMPTS', decision: 'FLAG', severity: 'HIGH', status: 'OPEN', signals: { attempts: 12 }, subjectUserId: null, subjectOrganizationId: ORG, branchId: 'b1', market: 'SA', caseId: null, outcome: null, reviewReason: null, createdAt: new Date().toISOString() }]),
        '/v1/admin/ops/reasons': REASONS,
        'POST /v1/admin/ops/risk/flags/f1/decide': ok({}),
      },
      ['admin.risk.manage'],
    );
    show(<AdminFraudPage />);
    const card = await screen.findByTestId('flag-REPEATED_CODE_ATTEMPTS');
    expect(card).toHaveTextContent('Repeated wrong codes');
    await userEvent.click(screen.getByTestId('flag-review-REPEATED_CODE_ATTEMPTS'));
    expect(screen.getByTestId('flag-decide')).toHaveTextContent('Confirming does not restrict anyone');
    // without restrictions.manage the "also restrict" option is not offered
    expect(screen.queryByText('Also request a restriction or hold')).toBeNull();
    await userEvent.type(screen.getByLabelText('Reason'), 'Staff member retrained');
    await userEvent.click(screen.getByTestId('flag-clear'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ outcome: 'CLEAR', reason: 'Staff member retrained', restriction: null });
  });

  it('restrictions: issued rights stay valid; a financial hold never auto-releases; the requester cannot decide', async () => {
    const base = { subjectType: 'ORGANIZATION', subjectId: ORG, organizationId: ORG, branchId: null, market: 'SA', scope: ['PAYOUT'], reasonCode: 'COMPLIANCE_REVIEW', reason: 'Bank details review', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString(), requiresApproval: true, requestedByUserId: ME, decidedByUserId: null, decidedAt: null, decisionReason: null, liftedAt: null, liftReason: null, caseId: null, riskFlagId: null, createdAt: new Date().toISOString() };
    stub(
      {
        '/v1/admin/ops/restrictions': ok([
          { ...base, id: 'r1', reference: 'RST-1', kind: 'FINANCIAL_HOLD', status: 'ACTIVE', canDecide: false },
          { ...base, id: 'r2', reference: 'RST-2', kind: 'CUSTOMER_RESTRICTION', subjectType: 'USER', scope: ['NEW_RESERVATIONS'], status: 'PENDING_APPROVAL', canDecide: false },
        ]),
        '/v1/admin/ops/reasons': REASONS,
      },
      ['admin.restrictions.manage', 'admin.restrictions.approve'],
    );
    show(<AdminRestrictionsPage />);
    expect(await screen.findByText('Restrictions stop new actions only. Vouchers, reservations and points a customer already holds stay valid.')).toBeInTheDocument();
    expect(within(await screen.findByTestId('rst-RST-1')).getByTestId('rst-financial-hold')).toHaveTextContent('never releases on its own');
    const pending = screen.getByTestId('rst-RST-2');
    expect(pending).toHaveTextContent('New Exclusive Deal reservations');
    expect(within(pending).getByTestId('ops-awaiting-RST-2')).toBeInTheDocument();
    expect(within(pending).queryByTestId('ops-approve-RST-2')).toBeNull();
  });

  it('moderation: a decision needs a configured reason and a written reason', async () => {
    stub(
      {
        '/v1/admin/ops/moderation': ok([{ id: 'm1', subjectType: 'REVIEW', subjectId: 'rv1', product: null, organizationId: ORG, status: 'REPORTED', source: 'REPORT', reasons: ['SPAM'], reportCount: 3, decidedByUserId: null, decidedAt: null, decisionReason: null, createdAt: new Date().toISOString(), review: { rating: 1, text: 'Buy followers here', verified: false, status: 'HIDDEN' } }]),
        '/v1/admin/ops/reasons': REASONS,
      },
      ['admin.content.manage'],
    );
    show(<AdminModerationPage />);
    const item = await screen.findByTestId('mod-REVIEW-rv1');
    expect(item).toHaveTextContent('Reports: 3');
    expect(item).toHaveTextContent('Spam');
    await userEvent.click(screen.getByTestId('mod-open-rv1'));
    expect(screen.getByTestId('mod-submit')).toBeDisabled();
  });

  it('notifications: counts per status, failures with their reason and a retry', async () => {
    stub(
      {
        '/v1/admin/ops/notifications': ok({ counts: { FAILED: 1, DELIVERED: 4 }, items: [{ id: 'd1', notificationId: 'n1', userId: 'u', channel: 'PUSH', provider: 'mock', templateCode: 'VOUCHER_ISSUED', templateVersion: 1, market: 'SA', locale: 'ar', status: 'FAILED', attempts: 3, maxAttempts: 3, failureReason: 'Provider unavailable', suppressedReason: null, consentChecked: true, nextRetryAt: null, lastAttemptAt: new Date().toISOString(), createdAt: new Date().toISOString() }] }),
      },
      ['admin.notifications.manage'],
    );
    show(<AdminNotificationsPage />);
    expect(await screen.findByTestId('ntf-counts')).toHaveTextContent('Failed: 1');
    const row = screen.getByTestId('ntf-d1');
    expect(row).toHaveTextContent('Provider unavailable');
    expect(row).toHaveTextContent('3 / 3');
    expect(screen.getByTestId('ntf-retry-d1')).toBeInTheDocument();
  });

  it('SLA: breached and warning work by area; nothing late shows "on track"', async () => {
    stub({ '/v1/admin/ops/sla': ok({ generatedAt: new Date().toISOString(), byArea: [{ area: 'CASE', open: 4, warning: 1, breached: 2 }], items: [{ id: 'c1', area: 'CASE', subjectType: 'DisputeCase', reference: 'CASE-1', state: 'BREACHED', dueAt: new Date().toISOString(), escalationLevel: 1 }] }) }, ['admin.operations.read']);
    const v = show(<AdminSlaPage />);
    expect(await screen.findByTestId('sla-area-CASE')).toHaveTextContent('SLA breached: 2');
    expect(screen.getByTestId('sla-CASE-1')).toHaveTextContent('SLA breached');
    v.unmount();
    vi.unstubAllGlobals();
    stub({ '/v1/admin/ops/sla': ok({ generatedAt: new Date().toISOString(), byArea: [], items: [] }) }, ['admin.operations.read']);
    show(<AdminSlaPage />);
    expect(await screen.findByText('Everything is on track.')).toBeInTheDocument();
  });

  it('command centre exceptions: every area, a market drill-down narrows the query', async () => {
    const values = Object.fromEntries(['PAYMENT_ISSUES', 'REDEMPTION_FAILURES', 'VOUCHER_EXCEPTIONS', 'WATCH_EXCEPTIONS', 'LOYALTY_EXCEPTIONS', 'IMPORT_FAILURES', 'INTEGRATION_FAILURES', 'SETTLEMENT_EXCEPTIONS', 'RECONCILIATION_EXCEPTIONS', 'DISPUTES', 'FRAUD_FLAGS', 'OVERDUE_TASKS', 'APPROVAL_BACKLOG', 'NOTIFICATION_FAILURES', 'UNRESOLVED_SUPPORT'].map((a, i) => [a, i]));
    stub({ '/v1/admin/ops/exceptions': ok({ generatedAt: new Date().toISOString(), values, markets: [{ market: 'SA', openCases: 5, breached: 1 }], businesses: [] }) }, ['admin.operations.read']);
    show(<OpsExceptionsPanel />);
    expect(await screen.findByTestId('exc-FRAUD_FLAGS')).toHaveTextContent('Fraud flags');
    expect(screen.getByTestId('exc-level')).toHaveTextContent('Global');
    await userEvent.click(screen.getByTestId('exc-market-SA'));
    expect(await screen.findByText(/Market \(country code\)$/, { selector: '[data-testid="exc-level"]' })).toBeInTheDocument();
  });

  it('cases: a resolution waiting for approval shows the awaiting-approval state; the requester cannot decide it', async () => {
    const c = { id: 'c1', reference: 'CASE-7', type: 'REFUND_EXCEPTION', organizationId: ORG, title: 'Refund not received', description: null, priority: 'HIGH', status: 'AWAITING_APPROVAL', slaDueAt: new Date(Date.now() + 3600000).toISOString(), overdue: false, resolution: null, resolvedAt: null, financialAdjustmentId: null, notes: [], attachments: [], severity: 'HIGH', market: 'SA', assignedTeam: 'FINANCE', proposedResolution: 'Refund 150 SAR', approvalState: 'PENDING', approvalRequestedByUserId: ME, slaState: 'WARNING', escalationLevel: 0, financialImpactMinor: 15000, currency: 'SAR' };
    stub({ '/v1/admin/disputes': ok([c]), '/v1/admin/disputes/c1': ok(c) }, ['admin.disputes.read', 'admin.disputes.manage']);
    show(<AdminCasesPage />);
    const row = await screen.findByTestId('op-case-CASE-7');
    expect(row).toHaveTextContent('Refund exception');
    expect(row).toHaveTextContent('Waiting for approval');
    expect(row).toHaveTextContent('High severity');
    await userEvent.click(screen.getByTestId('op-case-open-CASE-7'));
    expect(await screen.findByTestId('op-case-awaiting-approval')).toHaveTextContent('Refund 150 SAR');
    expect(screen.getByTestId('op-case-own-request')).toBeInTheDocument();
    expect(screen.queryByTestId('op-case-approve')).toBeNull();
    expect(screen.queryByTestId('op-case-resolve')).toBeNull();
    expect(screen.getByTestId('op-case-facts')).toHaveTextContent('Finance');
  });

  it('cases: a second person sees approve / send back; the decision posts with a reason', async () => {
    const c = { id: 'c1', reference: 'CASE-7', type: 'REFUND_EXCEPTION', organizationId: ORG, title: 'Refund not received', description: null, priority: 'HIGH', status: 'AWAITING_APPROVAL', slaDueAt: new Date(Date.now() + 3600000).toISOString(), overdue: false, resolution: null, resolvedAt: null, financialAdjustmentId: null, notes: [], attachments: [], severity: 'HIGH', proposedResolution: 'Refund 150 SAR', approvalRequestedByUserId: OTHER, slaState: 'ON_TRACK', escalationLevel: 0 };
    stub({ '/v1/admin/disputes': ok([c]), '/v1/admin/disputes/c1': ok(c), 'POST /v1/admin/disputes/c1/approval/decide': ok({ ...c, status: 'RESOLVED' }) }, ['admin.disputes.read', 'admin.disputes.manage', 'admin.finance.approve']);
    show(<AdminCasesPage />);
    await userEvent.click(await screen.findByTestId('op-case-open-CASE-7'));
    const approve = await screen.findByTestId('op-case-approve');
    expect(approve).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason for your decision'), 'Refund confirmed by finance');
    await userEvent.click(approve);
    expect(calls.find((x) => x.method === 'POST')?.body).toEqual({ decision: 'APPROVE', reason: 'Refund confirmed by finance' });
  });

  it('rules and controls: read-only without manage; saving needs valid JSON and a reason', async () => {
    const cfg = ok({ value: { reviews: { minTextLength: 10 } }, version: 3, updatedAt: new Date().toISOString() });
    stub({ '/v1/admin/ops/config': cfg, '/v1/admin/ops/config/history': ok([{ at: new Date().toISOString(), actorRole: 'DEALDASH_SUPER_ADMIN', reason: 'Initial', version: 3 }]) }, ['admin.config.read']);
    const v = show(<AdminRulesPage />);
    expect(await screen.findByTestId('cfg-version')).toHaveTextContent('Version 3');
    expect(screen.getByText('You can read these rules but not change them.')).toBeInTheDocument();
    expect(screen.queryByTestId('cfg-save')).toBeNull();
    expect(await screen.findByTestId('cfg-history')).toHaveTextContent('Initial');
    v.unmount();
    vi.unstubAllGlobals();
    stub({ '/v1/admin/ops/config': cfg, '/v1/admin/ops/config/history': ok([]) }, ['admin.config.read', 'admin.config.manage']);
    show(<AdminRulesPage />);
    const area = await screen.findByLabelText('Operations configuration (JSON)');
    await userEvent.clear(area);
    await userEvent.type(area, '{{"broken"');
    expect(screen.getByTestId('cfg-save')).toBeDisabled();
  });

  it('support: tabs follow permissions; escalating a support request opens a case', async () => {
    stub(
      {
        '/v1/admin/ops/support-requests': ok([{ id: 's1', reference: 'SUP-1', type: 'REFUND_QUESTION', status: 'OPEN', subject: 'Where is my refund?', body: 'Asked 3 days ago', userId: 'u', createdAt: new Date().toISOString(), escalatedCase: null }]),
        'POST /v1/admin/ops/support-requests/s1/escalate': ok({ id: 'c9', reference: 'CASE-9' }),
      },
      ['admin.support.manage', 'admin.disputes.manage'],
    );
    show(<AdminSupportPage />);
    expect(await screen.findByTestId('sup-SUP-1')).toHaveTextContent('Refund question');
    expect(screen.queryByRole('tab', { name: 'Refunds' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Privacy requests' })).toBeNull();
    await userEvent.click(screen.getByTestId('sup-escalate-SUP-1'));
    expect(await screen.findByTestId('ops-banner')).toHaveTextContent('Escalated to a case.');
  });

  it('Arabic: the operations screens render right-to-left copy', async () => {
    stub({ '/v1/admin/ops/settlements': ok([]) }, ['admin.finance.read']);
    show(<AdminSettlementsPage />, 'ar');
    expect(await screen.findByRole('heading', { name: 'التسويات مع التجار' })).toBeInTheDocument();
    expect(await screen.findByText('لا توجد تسويات هنا.')).toBeInTheDocument();
  });
});
