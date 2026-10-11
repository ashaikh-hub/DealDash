import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { CommercialHub } from './commercial-hub';
import { CommercialInputsEditor, CommercialPanel, CommercialSummary } from '@dealdash/app-shell';
import type { CommercialInput } from '@dealdash/validation';
import { emptyCommercialInput } from '@dealdash/validation';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/en/commercial',
  useSearchParams: () => new URLSearchParams(),
}));
Object.defineProperty(window, 'scrollTo', { value: vi.fn(), configurable: true });

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const SPONSOR = '018f0000-0000-7000-8000-0000000000bb';
const SUBJECT = '018f0000-0000-7000-8000-0000000000d1';
const CASE = '018f0000-0000-7000-8000-0000000000c1';
const QUOTE = '018f0000-0000-7000-8000-0000000000c2';
const PERMS = ['merchant.commercial.read', 'merchant.commercial.accept', 'merchant.deals.read'];
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

interface Call {
  url: string;
  method: string;
  body?: string;
}
type R = { status?: number; body: unknown };
function stub(routes: Record<string, R | ((c: Call) => R)>, perms = PERMS) {
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
      };
      calls.push(call);
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.includes('/v1/auth/me')) return json(200, { data: me(perms), meta: {} });
      for (const key of Object.keys(routes).sort((a, b) => b.length - a.length))
        if (url.includes(key)) {
          const r = routes[key]!;
          const res = typeof r === 'function' ? r(call) : r;
          return json(res.status ?? 200, res.body);
        }
      return json(404, { errors: [{ code: 'NOT_FOUND', message: 'x' }], meta: {} });
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());
const mount = (ui: React.ReactNode, locale: 'en' | 'ar' = 'en') =>
  render(<Providers locale={locale}>{ui}</Providers>);

const totals = (over: Record<string, unknown> = {}) => ({
  currency: 'SAR',
  maxUnits: 5,
  dealdashChargesHalalas: 500,
  taxHalalas: 0,
  taxStatus: 'NOT_CONFIGURED',
  maxCashPayableToDealDashHalalas: 500,
  nettedChargesHalalas: 0,
  maxSponsorLiabilityHalalas: 1000,
  sponsorLiability: [{ organizationId: SPONSOR, amountHalalas: 1000 }],
  merchantCashContributionHalalas: 0,
  maxMerchantBenefitCommitmentHalalas: 9000,
  customerBenefitTotalHalalas: 10000,
  totalEconomicCommitmentHalalas: 10500,
  issues: [],
  ...over,
});
const line = (kind: string, code: string, amount: number, over: Record<string, unknown> = {}) => ({
  kind,
  code,
  label: { en: code, ar: code },
  partyOrganizationId: ORG,
  partyRole: 'OWNER',
  basis: 'PER_UNIT',
  units: 5,
  unitHalalas: amount / 5,
  amountHalalas: amount,
  cash: kind !== 'MERCHANT_BENEFIT' && kind !== 'CUSTOMER_FUNDING',
  collection: 'CASH',
  trigger: 'VERIFIED_REDEMPTION',
  taxable: false,
  ...over,
});
const preview = (over: Record<string, unknown> = {}) => ({
  lines: [
    line('DEALDASH_CHARGE', 'Redemption fee', 500),
    line('SPONSOR_FUNDING', 'Sponsor funding', 1000, {
      partyOrganizationId: SPONSOR,
      partyRole: 'SPONSOR',
    }),
    line('MERCHANT_BENEFIT', 'Merchant benefit', 9000, {
      collection: null,
      trigger: 'VERIFIED_REDEMPTION',
    }),
  ],
  totals: totals(),
  pricing: { source: 'DEFAULT', reference: null, versionKey: 'D:1', unusedTreatment: null },
  parties: [
    {
      role: 'OWNER',
      organizationId: ORG,
      requiredChecks: ['REVIEWED_TERMS', 'UNDERSTAND_CHARGES', 'CONFIRM_FUNDING', 'ACCEPT_TERMS'],
    },
    {
      role: 'SPONSOR',
      organizationId: SPONSOR,
      requiredChecks: ['REVIEWED_TERMS', 'CONFIRM_FUNDING', 'ACCEPT_TERMS'],
    },
  ],
  fundingRequirements: [],
  workflow: [],
  ...over,
});
const caseView = (over: Record<string, unknown> = {}) => ({
  id: CASE,
  reference: 'CC-000001',
  product: 'EXCLUSIVE',
  subjectId: SUBJECT,
  status: 'AWAITING_ACCEPTANCE',
  ownerOrganizationId: ORG,
  fulfilmentOrganizationId: ORG,
  developmentFixture: false,
  unusedTreatment: null,
  quotation: {
    id: QUOTE,
    reference: 'QT-000001',
    version: 1,
    status: 'PENDING_ACCEPTANCE',
    createdAt: new Date().toISOString(),
    delta: null,
  },
  preview: preview(),
  acceptances: [],
  approvals: [],
  funding: [],
  blockers: [{ code: 'ACCEPTANCE_MISSING', party: 'OWNER', detail: ORG }],
  submitBlockers: [{ code: 'ACCEPTANCE_MISSING', party: 'OWNER', detail: ORG }],
  allowedActions: ['ACCEPT'],
  hold: { active: false, reason: null },
  updatedAt: new Date().toISOString(),
  ...over,
});

describe('CommercialSummary', () => {
  it('shows cash, sponsor funding and the non-cash merchant benefit as separate figures and never merges them', async () => {
    mount(<CommercialSummary preview={preview() as never} locale="en" />);
    expect(await screen.findByTestId('cm-total-cash')).toHaveTextContent('5.00');
    expect(screen.getByTestId('cm-total-sponsor')).toHaveTextContent('10.00');
    expect(screen.getByTestId('cm-total-benefit')).toHaveTextContent('90.00');
    expect(screen.getByTestId('cm-line-SPONSOR_FUNDING')).toBeInTheDocument();
    expect(screen.getByTestId('cm-line-MERCHANT_BENEFIT')).toHaveTextContent('non-cash');
    // an unconfigured tax is stated, never invented
    expect(screen.getByTestId('cm-tax-note')).toHaveTextContent('Tax is not configured yet');
  });

  it('explains an unbounded cost and shows the amendment figures (original, revised, additional)', async () => {
    mount(
      <CommercialSummary
        preview={preview({ totals: totals({ issues: ['UNBOUNDED_FEE'] }) }) as never}
        locale="en"
        delta={{
          maxCashPayableToDealDash: { original: 500, additional: 250, revised: 750 },
          maxSponsorLiability: { original: 1000, additional: 0, revised: 1000 },
        }}
      />,
    );
    expect(await screen.findByTestId('cm-issues')).toHaveTextContent('Set a limit');
    expect(screen.getByTestId('cm-delta')).toHaveTextContent('5.00');
    expect(screen.getByTestId('cm-delta')).toHaveTextContent('7.50');
  });

  it('renders in Arabic', async () => {
    mount(<CommercialSummary preview={preview() as never} locale="ar" />, 'ar');
    expect(await screen.findByText('التزام التاجر بالمنفعة (غير نقدي)')).toBeInTheDocument();
  });
});

describe('CommercialPanel', () => {
  it('needs every acknowledgement before the terms can be accepted, then reports the stored acceptance', async () => {
    let accepted = false;
    const calls = stub({
      '/commercial/case': () => ({
        body: {
          data: accepted
            ? caseView({
                status: 'AWAITING_FUNDING',
                acceptances: [
                  {
                    reference: 'AC-000007',
                    role: 'OWNER',
                    organizationId: ORG,
                    userName: 'Owner',
                    userRole: 'MERCHANT_OWNER',
                    onBehalf: false,
                    createdAt: new Date().toISOString(),
                    quotationId: QUOTE,
                  },
                ],
                submitBlockers: [],
                allowedActions: [],
                blockers: [{ code: 'ACCEPTANCE_MISSING', party: 'SPONSOR', detail: SPONSOR }],
              })
            : caseView(),
          meta: {},
        },
      }),
      [`/commercial/cases/${CASE}/accept`]: () => {
        accepted = true;
        return { body: { data: { ok: true }, meta: {} } };
      },
    });
    const ready = vi.fn();
    mount(
      <CommercialPanel
        orgId={ORG}
        product="EXCLUSIVE"
        subjectId={SUBJECT}
        content={{}}
        onReady={ready}
      />,
    );
    const accept = await screen.findByTestId('cm-accept');
    expect(accept).toBeDisabled();
    const user = userEvent.setup();
    for (const c of ['REVIEWED_TERMS', 'UNDERSTAND_CHARGES', 'CONFIRM_FUNDING']) {
      await user.click(
        within(screen.getByTestId(`cm-check-${c}`).parentElement!).getByRole('checkbox'),
      );
      expect(screen.getByTestId('cm-accept')).toBeDisabled();
    }
    await user.click(
      within(screen.getByTestId('cm-check-ACCEPT_TERMS').parentElement!).getByRole('checkbox'),
    );
    expect(screen.getByTestId('cm-accept')).toBeEnabled();
    await user.click(screen.getByTestId('cm-accept'));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/accept') && c.method === 'POST')).toBe(true),
    );
    const sent = JSON.parse(calls.find((c) => c.url.includes('/accept'))!.body!);
    expect(sent.quotationId).toBe(QUOTE);
    expect(sent.checks).toHaveLength(4);
    expect(await screen.findByTestId('cm-accepted-ref')).toHaveTextContent('AC-000007');
    // the Submit button waits for this: owner accepted => ready
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true));
    // the other party is still listed as waiting and its absence is a blocker
    expect(screen.getByTestId('cm-party-SPONSOR')).toHaveTextContent('Waiting');
    expect(screen.getByTestId('cm-blocker-ACCEPTANCE_MISSING')).toBeInTheDocument();
  });

  it('offers no way to accept without the permission, and says the draft must be saved first', async () => {
    stub({ '/commercial/preview': { body: { data: preview(), meta: {} } } }, [
      'merchant.commercial.read',
    ]);
    const ready = vi.fn();
    mount(
      <CommercialPanel
        orgId={ORG}
        product="EXCLUSIVE"
        subjectId={null}
        content={{ title: 'x' }}
        onReady={ready}
      />,
    );
    expect(await screen.findByTestId('cm-panel')).toHaveTextContent('Save the draft');
    expect(screen.queryByTestId('cm-accept')).toBeNull();
    expect(ready).toHaveBeenLastCalledWith(false);
  });

  it('shows funding, a pay button for prepaid amounts and the approval step with its own approve button', async () => {
    stub({
      '/commercial/case': {
        body: {
          data: caseView({
            status: 'AWAITING_FUNDING',
            quotation: {
              id: QUOTE,
              reference: 'QT-000001',
              version: 1,
              status: 'ACCEPTED',
              createdAt: new Date().toISOString(),
              delta: null,
            },
            acceptances: [],
            funding: [
              {
                id: 'f1',
                organizationId: ORG,
                role: 'OWNER',
                kind: 'CHARGE',
                mode: 'PREPAID',
                upfrontHalalas: 0,
                usageMaxHalalas: 500,
                maxHalalas: 500,
                receivedHalalas: 0,
                utilizedHalalas: 0,
                earnedHalalas: 0,
                remainingCommitmentHalalas: 500,
                outstandingHalalas: 500,
                status: 'OPEN',
              },
            ],
            approvals: [
              { step: 'FINANCE_APPROVER', status: 'PENDING', decidedByName: null, reason: null },
            ],
            allowedActions: ['PAY', 'APPROVE_FINANCE'],
            blockers: [
              { code: 'FUNDING_MISSING', party: 'OWNER', detail: '500' },
              { code: 'APPROVAL_PENDING', party: 'FINANCE_APPROVER', detail: null },
            ],
            submitBlockers: [],
          }),
          meta: {},
        },
      },
    });
    mount(<CommercialPanel orgId={ORG} product="EXCLUSIVE" subjectId={SUBJECT} content={{}} />);
    expect(await screen.findByTestId('cm-pay')).toBeInTheDocument();
    expect(screen.getByTestId('cm-funding')).toHaveTextContent('Prepaid');
    expect(screen.getByTestId('cm-approve-FINANCE_APPROVER')).toBeInTheDocument();
    expect(screen.getByTestId('cm-blocker-FUNDING_MISSING')).toBeInTheDocument();
    expect(screen.getByTestId('cm-approvals')).toHaveTextContent('Finance approver');
  });
});

describe('CommercialInputsEditor', () => {
  it('turns SAR into integer halalas and manages sponsors; charges are never entered here', async () => {
    const changes: CommercialInput[] = [];
    const Harness = () => {
      const [v, setV] = useState<CommercialInput>(emptyCommercialInput());
      return (
        <CommercialInputsEditor
          value={v}
          product="EXCLUSIVE"
          onChange={(n) => {
            changes.push(n);
            setV(n);
          }}
        />
      );
    };
    mount(<Harness />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Normal price (SAR)'), '50');
    await user.type(screen.getByLabelText('Deal price (SAR)'), '30.5');
    const last = changes[changes.length - 1]!;
    expect(last.normalPriceHalalas).toBe(5000);
    expect(last.dealPriceHalalas).toBe(3050);
    await user.click(screen.getByTestId('cm-add-sponsor'));
    await user.type(screen.getByLabelText('Sponsor funds per redemption (SAR)'), '2');
    expect(changes[changes.length - 1]!.sponsors[0]!.perUnitHalalas).toBe(200);
    expect(screen.queryByLabelText(/commission|fee/i)).toBeNull();
  });
});

describe('CommercialHub', () => {
  it('lists every agreement the business is party to, in each role, and opens one', async () => {
    stub({
      [`/commercial/cases`]: () => ({
        body: {
          data: [
            {
              id: CASE,
              reference: 'CC-000001',
              product: 'EXCLUSIVE',
              subjectId: SUBJECT,
              title: { en: 'Flash dinner', ar: 'عشاء سريع' },
              status: 'AWAITING_ACCEPTANCE',
              ownerOrganizationId: SPONSOR,
              ownerName: { en: 'Alpha Grill', ar: 'ألفا' },
              maxCashHalalas: 500,
              benefitCommitmentHalalas: 9000,
              developmentFixture: false,
              myRole: 'FULFILMENT_MERCHANT',
            },
          ],
          meta: {},
        },
      }),
      '/commercial/case': {
        body: {
          data: caseView({ ownerOrganizationId: SPONSOR, fulfilmentOrganizationId: ORG }),
          meta: {},
        },
      },
    });
    mount(<CommercialHub />);
    const row = await screen.findByTestId('cmh-row-CC-000001');
    expect(row).toHaveTextContent('Fulfilling merchant');
    expect(row).toHaveTextContent('Flash dinner');
    await userEvent.setup().click(screen.getByTestId('cmh-open-CC-000001'));
    expect(await screen.findByTestId('cm-panel')).toBeInTheDocument();
  });
});
