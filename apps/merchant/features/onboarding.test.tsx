import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { OnboardingPage } from './onboarding';
import { validateWith } from './forms';
import { businessDetailsSchema } from '@dealdash/validation';

const ORG = '018f0000-0000-7000-8000-0000000000aa';

const me = (permissions: string[], status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' = 'DRAFT') => ({
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
    organizationStatus: status,
    roleCode: 'MERCHANT_OWNER',
    branchId: null,
  },
  memberships: [],
  permissions,
});

const requirement = {
  code: 'CR',
  nameEn: 'Commercial registration',
  nameAr: 'السجل التجاري',
  required: true,
  expiryRequired: true,
  placeholder: true,
};

const application = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  organizationStatus: 'DRAFT',
  editable: true,
  application: {
    id: 'a',
    reference: 'DD-M-1234',
    status: 'DRAFT',
    version: 0,
    submittedAt: null,
    decidedAt: null,
    riskTier: 'STANDARD',
    awaitingSecondReview: false,
    rejectionReason: null,
    rejectionReasonAr: null,
    appealable: true,
    requestedChanges: null,
  },
  business: {
    legalNameEn: null,
    legalNameAr: null,
    tradeNameEn: 'Test Cafe',
    tradeNameAr: null,
    commercialRegistrationNumber: null,
    taxNumber: null,
    businessType: null,
    registeredAddress: null,
    businessPhone: null,
    businessEmail: null,
    categoryCode: null,
    subCategory: null,
    descriptionEn: null,
    descriptionAr: null,
    logoFileId: null,
    coverFileId: null,
    galleryFileIds: [],
    logoUrl: null,
    coverUrl: null,
  },
  representative: null,
  settlement: null,
  documents: [],
  requirements: [requirement],
  categories: [{ code: 'cafes', nameEn: 'Cafes', nameAr: 'المقاهي' }],
  branches: [],
  agreement: {
    current: {
      id: 'g',
      version: '1.0',
      titleEn: 'Agreement',
      titleAr: 'اتفاقية',
      bodyEn: 'Body',
      bodyAr: 'نص',
      placeholder: true,
    },
    acceptance: null,
  },
  contact: { email: 'owner@test.dd', emailVerified: true, mobile: null, mobileVerified: false },
  completeness: [
    { section: 'BUSINESS', complete: false, issues: ['Legal business name (English)'] },
    { section: 'DOCUMENTS', complete: false, issues: ['Commercial registration: upload required'] },
    { section: 'REPRESENTATIVE', complete: false, issues: ['Authorised representative details'] },
    { section: 'CATEGORY', complete: false, issues: ['Business category'] },
    { section: 'BRANCHES', complete: false, issues: ['At least one branch'] },
    { section: 'SETTLEMENT', complete: false, issues: ['Settlement bank details'] },
    { section: 'AGREEMENT', complete: false, issues: ['Accept agreement version 1.0'] },
    { section: 'VERIFICATION', complete: false, issues: ['Mobile verification'] },
  ],
  ready: false,
  trustLevel: 'NEW',
  ...over,
});

function stubApi(
  meBody: unknown,
  app: unknown,
  calls: Array<{ method: string; url: string; body?: unknown }> = [],
) {
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
      calls.push({
        method: init?.method ?? 'GET',
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith('/v1/auth/me')) return json(200, { data: meBody, meta: {} });
      if (url.endsWith('/application')) return json(200, { data: app, meta: {} });
      return json(200, { data: app, meta: {} });
    }),
  );
}

const perms = [
  'merchant.profile.read',
  'merchant.application.manage',
  'merchant.agreement.sign',
  'merchant.branch.read',
  'merchant.branch.manage',
];

describe('merchant onboarding wizard', () => {
  it('shows the eight steps with the reference and per-step progress (English, LTR)', async () => {
    stubApi(me(perms), application());
    render(
      <Providers locale="en">
        <OnboardingPage />
      </Providers>,
    );
    expect(await screen.findByRole('heading', { name: 'Application' })).toBeInTheDocument();
    expect(screen.getByText('DD-M-1234')).toHaveClass('dd-ltr');
    const steps = within(screen.getByRole('list', { name: 'Application steps' })).getAllByRole(
      'button',
    );
    expect(steps).toHaveLength(8);
    expect(screen.getByText('Step 1 of 8')).toBeInTheDocument();
  });

  it('flags the sections the reviewer asked to change and shows the message', async () => {
    stubApi(
      me(perms),
      application({
        application: {
          id: 'a',
          reference: 'DD-M-1234',
          status: 'CHANGES_REQUESTED',
          version: 1,
          submittedAt: '2026-10-01T00:00:00Z',
          decidedAt: null,
          riskTier: 'STANDARD',
          awaitingSecondReview: false,
          rejectionReason: null,
          rejectionReasonAr: null,
          appealable: true,
          requestedChanges: {
            sections: ['DOCUMENTS'],
            documentIds: [],
            message: 'The registration is not legible',
            messageAr: 'السجل غير واضح',
            at: '2026-10-02T00:00:00Z',
          },
        },
      }),
    );
    render(
      <Providers locale="en">
        <OnboardingPage />
      </Providers>,
    );
    expect(await screen.findByText('Changes requested by DealDash')).toBeInTheDocument();
    expect(screen.getByText('The registration is not legible')).toBeInTheDocument();
    expect(screen.getAllByText('Needs your attention').length).toBe(1);
  });

  it('shows the Arabic reviewer message and Arabic labels in RTL', async () => {
    stubApi(
      me(perms),
      application({
        application: {
          id: 'a',
          reference: 'DD-M-1234',
          status: 'CHANGES_REQUESTED',
          version: 1,
          submittedAt: null,
          decidedAt: null,
          riskTier: 'STANDARD',
          awaitingSecondReview: false,
          rejectionReason: null,
          rejectionReasonAr: null,
          appealable: true,
          requestedChanges: {
            sections: ['BUSINESS'],
            documentIds: [],
            message: 'english message',
            messageAr: 'السجل غير واضح',
            at: '2026-10-02T00:00:00Z',
          },
        },
      }),
    );
    render(
      <Providers locale="ar">
        <OnboardingPage />
      </Providers>,
    );
    expect(await screen.findByText('السجل غير واضح')).toBeInTheDocument();
    expect(screen.queryByText('english message')).toBeNull();
    expect(screen.getByText('بيانات النشاط', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByText('DD-M-1234')).toHaveClass('dd-ltr'); // identifiers keep left-to-right order
    expect(document.body.textContent).not.toMatch(/Legal name \(English\)/);
  });

  it('blocks saving invalid business data with field errors and does not call the API', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    stubApi(me(perms), application(), calls);
    render(
      <Providers locale="en">
        <OnboardingPage />
      </Providers>,
    );
    await screen.findByRole('heading', { name: 'Application' });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Please fix the highlighted fields.')).toBeInTheDocument();
    expect(screen.getByLabelText('Legal name (English)')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('disables Submit until the application is ready and the declaration is ticked', async () => {
    stubApi(
      me(perms),
      application({
        ready: true,
        completeness: application().completeness.map((c: { section: string }) => ({
          ...c,
          complete: true,
          issues: [],
        })),
      }),
    );
    render(
      <Providers locale="en">
        <OnboardingPage />
      </Providers>,
    );
    await screen.findByRole('heading', { name: 'Application' });
    await userEvent.click(screen.getByRole('button', { name: /Verify and submit/ }));
    const submit = await screen.findByRole('button', { name: 'Submit application' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/I confirm the information/));
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it('becomes a read-only status page once submitted (no edit controls)', async () => {
    stubApi(
      me(perms),
      application({
        editable: false,
        application: {
          id: 'a',
          reference: 'DD-M-1234',
          status: 'SUBMITTED',
          version: 1,
          submittedAt: '2026-10-01T10:00:00Z',
          decidedAt: null,
          riskTier: 'STANDARD',
          awaitingSecondReview: false,
          rejectionReason: null,
          rejectionReasonAr: null,
          appealable: true,
          requestedChanges: null,
        },
      }),
    );
    render(
      <Providers locale="en">
        <OnboardingPage />
      </Providers>,
    );
    expect(await screen.findByText(/Our team is reviewing your application/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Application steps' })).toBeNull();
  });

  it('shows the rejection reason and whether the decision can be discussed', async () => {
    stubApi(
      me(perms),
      application({
        editable: false,
        application: {
          id: 'a',
          reference: 'DD-M-1234',
          status: 'REJECTED',
          version: 1,
          submittedAt: '2026-10-01T10:00:00Z',
          decidedAt: '2026-10-02T10:00:00Z',
          riskTier: 'STANDARD',
          awaitingSecondReview: false,
          rejectionReason: 'Unable to verify the business',
          rejectionReasonAr: null,
          appealable: false,
          requestedChanges: null,
        },
      }),
    );
    render(
      <Providers locale="en">
        <OnboardingPage />
      </Providers>,
    );
    expect(await screen.findByText('Unable to verify the business')).toBeInTheDocument();
    expect(screen.getByText('This decision is final.')).toBeInTheDocument();
  });

  it('shows no access to a role without the application permission', async () => {
    stubApi(me(['merchant.profile.read']), application());
    render(
      <Providers locale="en">
        <OnboardingPage />
      </Providers>,
    );
    expect(await screen.findByText(/You do not have access/i)).toBeInTheDocument();
  });
});

describe('form validation helper', () => {
  it('reuses the shared schema; English shows its message, Arabic a translated generic one', () => {
    const empty = {
      legalNameEn: '',
      legalNameAr: '',
      tradeNameEn: '',
      tradeNameAr: '',
      commercialRegistrationNumber: '',
      registeredAddress: '',
    };
    const en = validateWith(businessDetailsSchema, empty, 'en');
    const ar = validateWith(businessDetailsSchema, empty, 'ar');
    expect(en.ok).toBe(false);
    if (!en.ok && !ar.ok) {
      expect(Object.keys(en.fields)).toContain('legalNameEn');
      expect(ar.fields.legalNameEn).toBe('هذا الحقل مطلوب.');
    }
  });
});
