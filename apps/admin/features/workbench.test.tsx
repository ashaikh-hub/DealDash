import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Providers } from '../app/[locale]/providers';
import { WorkbenchPage } from './workbench';

const ORG = '018f0000-0000-7000-8000-0000000000aa';
const ME = '018f0000-0000-7000-8000-000000000001';
const OTHER = '018f0000-0000-7000-8000-000000000002';

const me = (permissions: string[]) => ({
  id: ME,
  userType: 'ADMIN_USER',
  displayName: 'Reviewer',
  locale: 'en',
  audience: 'admin',
  mfaVerified: true,
  mfaRequired: true,
  csrfToken: 'csrf',
  activeMembership: {
    organizationId: 'dd',
    organizationType: 'DEALDASH',
    organizationName: { en: 'DealDash', ar: 'ديل داش' },
    organizationStatus: 'ACTIVE',
    roleCode: 'DEALDASH_RISK_COMPLIANCE',
    branchId: null,
  },
  memberships: [],
  permissions,
});

const complete = [
  'BUSINESS',
  'DOCUMENTS',
  'REPRESENTATIVE',
  'CATEGORY',
  'BRANCHES',
  'SETTLEMENT',
  'AGREEMENT',
  'VERIFICATION',
].map((section) => ({ section, complete: true, issues: [] }));

const detail = (
  over: {
    application?: Record<string, unknown>;
    completeness?: unknown;
    [k: string]: unknown;
  } = {},
) => {
  const { application: appOver, completeness: compOver, ...rest } = over;
  return {
    organizationId: ORG,
    organizationStatus: 'DRAFT',
    trustLevel: 'NEW',
    suspendedReason: null,
    application: {
      id: 'a',
      reference: 'DD-M-2001',
      status: 'IN_REVIEW',
      version: 1,
      submittedAt: '2026-10-01T10:00:00Z',
      decidedAt: null,
      riskTier: 'STANDARD',
      awaitingSecondReview: false,
      rejectionReason: null,
      rejectionReasonAr: null,
      appealable: true,
      requestedChanges: null,
      assignedTo: 'Reviewer',
      assignedToUserId: ME,
      firstApproverUserId: null,
      ...(appOver ?? {}),
    },
    business: {
      legalNameEn: 'Olive Co.',
      legalNameAr: 'شركة الزيتون',
      tradeNameEn: 'Olive Bakery',
      tradeNameAr: 'مخبز الزيتون',
      commercialRegistrationNumber: '1010000003',
      taxNumber: null,
      businessType: null,
      registeredAddress: 'Riyadh',
      businessPhone: null,
      businessEmail: null,
      categoryCode: 'cafes',
      subCategory: null,
      descriptionEn: 'd',
      descriptionAr: 'و',
      logoFileId: null,
      coverFileId: null,
      galleryFileIds: [],
      logoUrl: null,
      coverUrl: null,
    },
    category: { code: 'cafes', nameEn: 'Cafes', nameAr: 'المقاهي' },
    representative: {
      fullName: 'Sara',
      role: 'Owner',
      idReferenceMasked: '••••0001',
      mobile: '+966500000001',
      email: 's@x.test',
      isSignatory: true,
    },
    settlement: {
      bankName: 'Bank',
      ibanMasked: 'SA79 **** **** **** 0077',
      accountHolderName: 'Olive Co.',
      nameMatches: true,
      verificationStatus: 'UNVERIFIED',
      payoutHold: false,
    },
    documents: [
      {
        id: '018f0000-0000-7000-8000-0000000000d1',
        requirementCode: 'CR',
        fileId: '018f0000-0000-7000-8000-0000000000f1',
        fileName: 'cr.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        expiryDate: '2031-01-01',
        status: 'UPLOADED',
        reviewerNote: null,
        uploadedAt: '2026-10-01T09:00:00Z',
        url: 'http://localhost:4000/v1/storage/download/token',
      },
    ],
    requirements: [
      {
        code: 'CR',
        nameEn: 'Commercial registration',
        nameAr: 'السجل التجاري',
        required: true,
        expiryRequired: true,
        placeholder: true,
      },
    ],
    branches: [],
    users: [],
    acceptances: [],
    currentAgreementVersion: '1.0',
    completeness: compOver ?? complete,
    decisions: [],
    notes: [],
    riskSuggestion: { suggestedTier: 'STANDARD', reasons: [] },
    changedSinceLastSubmission: [],
    duplicateRegistrationNumber: false,
    audit: [],
    ...rest,
  };
};

function stubApi(
  meBody: unknown,
  body: unknown,
  calls: Array<{ method: string; url: string; body?: unknown }> = [],
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const json = (status: number, b: unknown) =>
        new Response(JSON.stringify(b), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      calls.push({
        method: init?.method ?? 'GET',
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith('/v1/auth/me')) return json(200, { data: meBody, meta: {} });
      return json(200, { data: body, meta: {} });
    }),
  );
}

const review = ['admin.merchants.review'];
const manage = ['admin.merchants.review', 'admin.merchants.manage'];

describe('admin merchant review workbench', () => {
  it('shows the decision actions to the assigned reviewer and a claim button otherwise', async () => {
    stubApi(me(review), detail());
    const { unmount } = render(
      <Providers locale="en">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Claim for review' })).toBeNull();
    unmount();

    stubApi(
      me(review),
      detail({ application: { status: 'SUBMITTED', assignedTo: null, assignedToUserId: null } }),
    );
    render(
      <Providers locale="en">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    expect(await screen.findByRole('button', { name: 'Claim for review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('does not offer decisions on an application assigned to someone else', async () => {
    stubApi(
      me(review),
      detail({ application: { assignedTo: 'Another Reviewer', assignedToUserId: OTHER } }),
    );
    render(
      <Providers locale="en">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    expect(
      await screen.findByText('This application is assigned to Another Reviewer.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('blocks approval while any section is incomplete', async () => {
    const incomplete = complete.map((c) =>
      c.section === 'DOCUMENTS' ? { ...c, complete: false, issues: ['x'] } : c,
    );
    stubApi(me(review), detail({ completeness: incomplete }));
    render(
      <Providers locale="en">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(
      screen.getByText('Complete all sections and review every document before approving.'),
    ).toBeInTheDocument();
  });

  it('enhanced review: the first approver cannot give the final approval', async () => {
    stubApi(
      me(review),
      detail({
        application: { riskTier: 'ENHANCED', awaitingSecondReview: true, firstApproverUserId: ME },
      }),
    );
    render(
      <Providers locale="en">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    expect(
      await screen.findByText(/A different reviewer must give the final approval/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('request changes needs a section and a message before it can be confirmed', async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    stubApi(me(review), detail(), calls);
    render(
      <Providers locale="en">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Request changes' }));
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Documents', { selector: 'input' }));
    await userEvent.type(
      screen.getByLabelText('Message to the merchant (English)'),
      'Please re-upload',
    );
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/request-changes'))).toBe(true));
    const body = calls.find((c) => c.url.endsWith('/request-changes'))!.body as {
      sections: string[];
      message: string;
    };
    expect(body.sections).toEqual(['DOCUMENTS']);
    expect(body.message).toBe('Please re-upload');
  });

  it('suspend and trust actions are only shown with the manage permission', async () => {
    stubApi(me(review), detail({ organizationStatus: 'ACTIVE' }));
    const { unmount } = render(
      <Providers locale="en">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    await screen.findByRole('button', { name: 'Change review tier' });
    expect(screen.queryByRole('button', { name: 'Suspend merchant' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change trust level' })).toBeNull();
    unmount();
    stubApi(me(manage), detail({ organizationStatus: 'ACTIVE' }));
    render(
      <Providers locale="en">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    expect(await screen.findByRole('button', { name: 'Suspend merchant' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change trust level' })).toBeInTheDocument();
  });

  it('opens documents through the signed link in a new tab, safely', async () => {
    stubApi(me(review), detail());
    render(
      <Providers locale="en">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    await userEvent.click(await screen.findByRole('tab', { name: /Documents/ }));
    const link = screen.getByRole('link', { name: 'cr.pdf' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('renders Arabic labels, Arabic category name and left-to-right identifiers', async () => {
    stubApi(me(review), detail());
    render(
      <Providers locale="ar">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    expect(await screen.findByRole('button', { name: 'موافقة' })).toBeInTheDocument();
    expect(screen.getByText('المقاهي')).toBeInTheDocument();
    expect(screen.getByText('DD-M-2001')).toHaveClass('dd-ltr');
    expect(screen.getByText('مراجعة عادية', { selector: '.dd-chip' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Decision history/);
  });

  it('shows no access to a role without the review permission', async () => {
    stubApi(me(['admin.audit.read']), detail());
    render(
      <Providers locale="en">
        <WorkbenchPage orgId={ORG} />
      </Providers>,
    );
    expect(await screen.findByText(/You do not have access/i)).toBeInTheDocument();
  });
});
