import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIENCE_DEFINITIONS } from '@dealdash/types';
import { EMAIL_PROVIDER } from '../src/providers/interfaces';
import { MockEmailProvider } from '../src/providers/mocks';
import { PLACEHOLDER_PDF, PLACEHOLDER_PNG, buildSaudiIban } from '../src/seed/stage2-seed';
import {
  DB_READY,
  TEST_PASSWORD,
  call,
  createBusinessUser,
  createDealDashOrg,
  createMerchantOrg,
  createTestApp,
  otpSession,
  passwordSession,
  type Session,
  type TestApp,
} from './helpers';

const uid = () => randomBytes(3).toString('hex');
const HOURS = Object.fromEntries(
  ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [
    d,
    { closed: false, intervals: [{ open: '09:00', close: '22:00' }] },
  ]),
);
const GOOD_IBAN = buildSaudiIban('80', '000000000000000077');

describe.skipIf(!DB_READY)('Stage 2: merchant onboarding, review and lifecycle', () => {
  let t: TestApp;
  let emails: MockEmailProvider;
  let risk: Session; // DEALDASH_RISK_COMPLIANCE (review)
  let risk2: Session; // a second reviewer
  let mm: Session; // DEALDASH_MERCHANT_MANAGEMENT (review + manage)
  let support: Session;

  beforeAll(async () => {
    t = await createTestApp();
    emails = t.app.get(EMAIL_PROVIDER) as MockEmailProvider;
    const dd = await createDealDashOrg(t.prisma);
    const mk = async (role: Parameters<typeof createBusinessUser>[1]['role']) =>
      passwordSession(
        t,
        await createBusinessUser(t.prisma, {
          role,
          orgId: dd.id,
          userType: 'ADMIN_USER',
          mfa: true,
        }),
        'admin',
        { completeMfa: true },
      );
    risk = await mk('DEALDASH_RISK_COMPLIANCE');
    risk2 = await mk('DEALDASH_RISK_COMPLIANCE');
    mm = await mk('DEALDASH_MERCHANT_MANAGEMENT');
    support = await mk('DEALDASH_SUPPORT');
  });
  afterAll(() => t?.close());

  // ---------------------------------------------------------------- helpers
  const cookieOf = (res: { headers: Record<string, unknown> }, name: string) =>
    ([] as string[])
      .concat((res.headers['set-cookie'] as string[] | string | undefined) ?? [])
      .find((c) => c.startsWith(`${name}=`))
      ?.split(';')[0] ?? '';

  async function register(label = 'Cafe') {
    const email = `${label.toLowerCase()}-${uid()}@merchant.test`;
    const reg = await t.http.post('/v1/merchant-signup/register').send({
      email,
      password: TEST_PASSWORD,
      tradeNameEn: `${label} ${uid()}`,
      tradeNameAr: 'مقهى الاختبار',
    });
    expect(reg.status).toBe(200);
    const code = /\b(\d{6})\b/.exec(emails.lastTo(email, 'merchant.email_verify')?.body ?? '')?.[1];
    expect(code).toBeTruthy();
    const ver = await t.http.post('/v1/merchant-signup/verify-email').send({ email, code });
    expect(ver.status).toBe(200);
    const session: Session = {
      cookie: cookieOf(ver, AUDIENCE_DEFINITIONS.merchant.cookieName),
      csrf: ver.body.data.login.csrfToken,
      audience: 'merchant',
      me: ver.body.data.login.me,
    };
    return { email, orgId: reg.body.data.organizationId as string, session };
  }

  async function upload(
    s: Session,
    orgId: string,
    kind: 'DOCUMENT' | 'LOGO' | 'COVER',
    name: string,
    mime: string,
    bytes: Buffer,
  ) {
    const intent = await call(t, s)
      .post(`/v1/merchants/${orgId}/files/intent`)
      .send({ kind, fileName: name, mimeType: mime, sizeBytes: bytes.length });
    expect(intent.status, JSON.stringify(intent.body)).toBe(200);
    const path = new URL(intent.body.data.uploadUrl).pathname;
    const put = await t.http.put(path).set('Content-Type', mime).send(bytes);
    expect(put.status).toBe(200);
    const done = await call(t, s).post(
      `/v1/merchants/${orgId}/files/${intent.body.data.fileId}/complete`,
    );
    return { fileId: intent.body.data.fileId as string, done };
  }

  /** Fills every section so the application is ready to submit. */
  async function fillAll(
    r: Awaited<ReturnType<typeof register>>,
    opts: { legal?: string; holder?: string } = {},
  ) {
    const { orgId, session: s } = r;
    const legal = opts.legal ?? `Test Trading ${uid()} Co.`;
    const base = `/v1/merchants/${orgId}/application`;
    expect(
      (
        await call(t, s)
          .put(`${base}/business`)
          .send({
            legalNameEn: legal,
            legalNameAr: 'شركة الاختبار التجارية',
            tradeNameEn: 'Test Cafe',
            tradeNameAr: 'مقهى الاختبار',
            commercialRegistrationNumber: `10${uid()}`,
            registeredAddress: 'Riyadh',
          })
      ).status,
    ).toBe(200);
    const logo = await upload(s, orgId, 'LOGO', 'logo.png', 'image/png', PLACEHOLDER_PNG);
    const cover = await upload(s, orgId, 'COVER', 'cover.png', 'image/png', PLACEHOLDER_PNG);
    expect(
      (
        await call(t, s).put(`${base}/category`).send({
          categoryCode: 'cafes',
          descriptionEn: 'A cafe',
          descriptionAr: 'مقهى',
          logoFileId: logo.fileId,
          coverFileId: cover.fileId,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(t, s).put(`${base}/representative`).send({
          fullName: 'Sara Alharbi',
          role: 'Owner',
          idReference: '1000000009',
          mobile: '+966500001234',
          email: r.email,
          isSignatory: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(t, s)
          .put(`${base}/settlement`)
          .send({
            bankName: 'Sample Bank',
            iban: GOOD_IBAN,
            accountHolderName: opts.holder ?? legal,
          })
      ).status,
    ).toBe(200);
    const doc = await upload(s, orgId, 'DOCUMENT', 'cr.pdf', 'application/pdf', PLACEHOLDER_PDF);
    expect(
      (
        await call(t, s)
          .post(`${base}/documents`)
          .send({ requirementCode: 'CR', fileId: doc.fileId, expiryDate: '2031-01-01' })
      ).status,
    ).toBe(200);
    const branch = await call(t, s)
      .post(`/v1/merchants/${orgId}/branches`)
      .set('Idempotency-Key', `br-${uid()}-${uid()}`)
      .send({
        nameEn: 'Main',
        nameAr: 'الرئيسي',
        addressEn: 'Olaya',
        addressAr: 'العليا',
        city: 'Riyadh',
        latitude: 24.7,
        longitude: 46.7,
        hours: HOURS,
      });
    expect(branch.status, JSON.stringify(branch.body)).toBe(201);
    const mobile = '+9665' + String(Math.floor(10000000 + Math.random() * 89999999));
    expect((await call(t, s).post(`${base}/mobile/request`).send({ mobile })).status).toBe(200);
    const code = /\b(\d{6})\b/.exec(t.sms.lastTo(mobile)?.body ?? '')?.[1];
    expect((await call(t, s).post(`${base}/mobile/verify`).send({ mobile, code })).status).toBe(
      200,
    );
    expect(
      (
        await call(t, s)
          .post(`${base}/agreement/accept`)
          .send({ signatureName: 'Sara Alharbi', accept: true })
      ).status,
    ).toBe(200);
    return { base, docId: undefined as string | undefined };
  }

  const detail = async (r: Awaited<ReturnType<typeof register>>) =>
    (await call(t, r.session).get(`/v1/merchants/${r.orgId}/application`)).body.data;
  const adminDetail = async (s: Session, orgId: string) =>
    (await call(t, s).get(`/v1/admin/merchants/${orgId}`)).body.data;
  const submit = (r: Awaited<ReturnType<typeof register>>) =>
    call(t, r.session)
      .post(`/v1/merchants/${r.orgId}/application/submit`)
      .send({ declaration: true });
  const acceptAllDocs = async (s: Session, orgId: string) => {
    const d = await adminDetail(s, orgId);
    for (const doc of d.documents.filter((x: { status: string }) => x.status === 'UPLOADED')) {
      await call(t, s)
        .post(`/v1/admin/merchants/${orgId}/documents/${doc.id}/review`)
        .send({ decision: 'ACCEPT' })
        .expect(200);
    }
  };

  // ---------------------------------------------------------------- registration
  it('registers a merchant, verifies email, and starts a draft application with a reference', async () => {
    const r = await register('Reg');
    const d = await detail(r);
    expect(d.organizationStatus).toBe('DRAFT');
    expect(d.application.status).toBe('DRAFT');
    expect(d.application.reference).toMatch(/^DD-M-\d+$/);
    expect(d.contact.emailVerified).toBe(true);
    expect(d.requirements.map((x: { code: string }) => x.code)).toContain('CR');
    expect(d.requirements.every((x: { placeholder: boolean }) => x.placeholder)).toBe(true); // VALIDATE-KSA: requirements are configurable mocks
    expect(d.agreement.current.placeholder).toBe(true);
  });

  it('rejects a wrong verification code, duplicate emails, and weak passwords', async () => {
    const email = `dup-${uid()}@merchant.test`;
    await t.http
      .post('/v1/merchant-signup/register')
      .send({ email, password: TEST_PASSWORD, tradeNameEn: 'Dup' })
      .expect(200);
    await t.http
      .post('/v1/merchant-signup/verify-email')
      .send({ email, code: '000000' })
      .expect(400);
    await t.http
      .post('/v1/merchant-signup/register')
      .send({ email, password: TEST_PASSWORD, tradeNameEn: 'Dup2' })
      .expect(409);
    await t.http
      .post('/v1/merchant-signup/register')
      .send({ email: `w-${uid()}@merchant.test`, password: 'short', tradeNameEn: 'Weak' })
      .expect(400);
  });

  it('cannot sign in or call the API before the email is verified', async () => {
    const email = `unv-${uid()}@merchant.test`;
    await t.http
      .post('/v1/merchant-signup/register')
      .send({ email, password: TEST_PASSWORD, tradeNameEn: 'Unverified' })
      .expect(200);
    const login = await t.http
      .post('/v1/auth/login')
      .send({ email, password: TEST_PASSWORD, audience: 'merchant' });
    expect([401, 403]).toContain(login.status);
  });

  // ---------------------------------------------------------------- completeness gate
  it('blocks submission until every section is complete and names what is missing', async () => {
    const r = await register('Gate');
    const res = await submit(r);
    expect(res.status).toBe(422);
    expect(res.body.errors[0].code).toBe('APPLICATION_INCOMPLETE');
    const d = await detail(r);
    expect(d.ready).toBe(false);
    expect(d.completeness.filter((c: { complete: boolean }) => !c.complete).length).toBeGreaterThan(
      5,
    );
  });

  it('validates IBAN (format + checksum), masks it in responses, and never writes it to the audit trail', async () => {
    const r = await register('Iban');
    const base = `/v1/merchants/${r.orgId}/application/settlement`;
    await call(t, r.session)
      .put(base)
      .send({ bankName: 'B', iban: 'SA0000000000000000000000', accountHolderName: 'X' })
      .expect(400);
    await call(t, r.session)
      .put(base)
      .send({ bankName: 'B', iban: 'GB82WEST12345698765432', accountHolderName: 'X' })
      .expect(400);
    const ok = await call(t, r.session)
      .put(base)
      .send({ bankName: 'B', iban: GOOD_IBAN, accountHolderName: 'X' });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toContain(GOOD_IBAN);
    expect(ok.body.data.settlement.ibanMasked).toMatch(/^SA\d\d \*\*\*\* \*\*\*\* \*\*\*\* \d{4}$/);
    const stored = await t.prisma.merchantSettlementAccount.findUniqueOrThrow({
      where: { organizationId: r.orgId },
    });
    expect(stored.ibanEnc).not.toContain(GOOD_IBAN); // encrypted at rest
    const audit = JSON.stringify(
      await t.prisma.auditLog.findMany({ where: { subjectOrganizationId: r.orgId } }),
    );
    expect(audit).not.toContain(GOOD_IBAN);
  });

  it('stores the representative ID encrypted and returns only the last four characters', async () => {
    const r = await register('Rep');
    const res = await call(t, r.session)
      .put(`/v1/merchants/${r.orgId}/application/representative`)
      .send({
        fullName: 'Omar',
        role: 'Owner',
        idReference: '1000000009',
        mobile: '+966500001111',
        email: r.email,
        isSignatory: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.data.representative.idReferenceMasked).toBe('••••0009');
    expect(JSON.stringify(res.body)).not.toContain('1000000009');
    const row = await t.prisma.merchantRepresentative.findUniqueOrThrow({
      where: { organizationId: r.orgId },
    });
    expect(row.idReferenceEnc).not.toContain('1000000009');
  });

  // ---------------------------------------------------------------- file upload (development storage adapter)
  describe('document upload through the development storage adapter', () => {
    it('uploads, verifies, and serves a PDF through a short-lived signed URL', async () => {
      const r = await register('File');
      const { fileId, done } = await upload(
        r.session,
        r.orgId,
        'DOCUMENT',
        'My CR.pdf',
        'application/pdf',
        PLACEHOLDER_PDF,
      );
      expect(done.status).toBe(200);
      expect(done.body.data.sizeBytes).toBe(PLACEHOLDER_PDF.length);
      const row = await t.prisma.storedFile.findUniqueOrThrow({ where: { id: fileId } });
      expect(row.status).toBe('AVAILABLE');
      expect(row.sha256).toHaveLength(64);
      const url = await call(t, r.session).get(`/v1/merchants/${r.orgId}/files/${fileId}/url`);
      expect(url.status).toBe(200);
      const dl = await t.http.get(new URL(url.body.data.url).pathname);
      expect(dl.status).toBe(200);
      expect(dl.headers['content-type']).toContain('application/pdf');
      expect(dl.headers['x-content-type-options']).toBe('nosniff');
    });

    it('rejects disallowed types and oversize files before upload', async () => {
      const r = await register('Bad');
      const base = `/v1/merchants/${r.orgId}/files/intent`;
      await call(t, r.session)
        .post(base)
        .send({
          kind: 'DOCUMENT',
          fileName: 'a.exe',
          mimeType: 'application/x-msdownload',
          sizeBytes: 100,
        })
        .expect(400);
      await call(t, r.session)
        .post(base)
        .send({
          kind: 'DOCUMENT',
          fileName: 'big.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 50 * 1024 * 1024,
        })
        .expect(400);
      await call(t, r.session)
        .post(base)
        .send({ kind: 'LOGO', fileName: 'logo.pdf', mimeType: 'application/pdf', sizeBytes: 100 })
        .expect(400);
    });

    it('rejects content that does not match the declared type, and executables disguised as PDFs', async () => {
      const r = await register('Spoof');
      const png = await upload(
        r.session,
        r.orgId,
        'DOCUMENT',
        'fake.pdf',
        'application/pdf',
        PLACEHOLDER_PNG,
      );
      expect(png.done.status).toBe(400);
      expect(
        (await t.prisma.storedFile.findUniqueOrThrow({ where: { id: png.fileId } })).status,
      ).toBe('REJECTED');
      const exe = await upload(
        r.session,
        r.orgId,
        'DOCUMENT',
        'evil.pdf',
        'application/pdf',
        Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]),
      );
      expect(exe.done.status).toBe(400);
    });

    it('does not accept an upload larger than declared, a tampered token, or a completion without an upload', async () => {
      const r = await register('Tamper');
      const intent = await call(t, r.session)
        .post(`/v1/merchants/${r.orgId}/files/intent`)
        .send({ kind: 'DOCUMENT', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 20 });
      const path = new URL(intent.body.data.uploadUrl).pathname;
      await t.http
        .put(path)
        .set('Content-Type', 'application/pdf')
        .send(Buffer.alloc(500, 1))
        .catch(() => undefined);
      await t.http
        .put(path + 'x')
        .set('Content-Type', 'application/pdf')
        .send(Buffer.alloc(5, 1))
        .expect(403);
      await t.http.put(path).set('Content-Type', 'image/png').send(Buffer.alloc(5, 1)).expect(400);
      await call(t, r.session)
        .post(`/v1/merchants/${r.orgId}/files/${intent.body.data.fileId}/complete`)
        .expect(400);
      await t.http.get('/v1/storage/download/not-a-token').expect(403);
    });

    it('keeps files private to the owning organisation', async () => {
      const a = await register('FileA');
      const b = await register('FileB');
      const { fileId } = await upload(
        a.session,
        a.orgId,
        'DOCUMENT',
        'a.pdf',
        'application/pdf',
        PLACEHOLDER_PDF,
      );
      await call(t, b.session).get(`/v1/merchants/${b.orgId}/files/${fileId}/url`).expect(404);
      await call(t, b.session).get(`/v1/merchants/${a.orgId}/files/${fileId}/url`).expect(404);
      const attach = await call(t, b.session)
        .post(`/v1/merchants/${b.orgId}/application/documents`)
        .send({ requirementCode: 'CR', fileId, expiryDate: '2031-01-01' });
      expect(attach.status).toBe(400);
      expect(attach.body.errors[0].code).toBe('FILE_INVALID');
    });
  });

  // ---------------------------------------------------------------- end to end: submit -> review -> changes -> resubmit -> approve
  it('Merchant -> Submit -> Admin review -> Request changes -> Resubmit -> Approve (activation)', async () => {
    const r = await register('E2E');
    await fillAll(r);
    expect((await detail(r)).ready).toBe(true);

    // Before activation: restricted permissions
    await call(t, r.session).get(`/v1/merchants/${r.orgId}/team`).expect(403);

    const sub = await submit(r);
    expect(sub.status).toBe(200);
    expect(sub.body.data.application.status).toBe('SUBMITTED');
    expect(sub.body.data.editable).toBe(false);
    await call(t, r.session)
      .put(`/v1/merchants/${r.orgId}/application/business`)
      .send({
        legalNameEn: 'X',
        legalNameAr: 'س',
        tradeNameEn: 'X',
        tradeNameAr: 'س',
        commercialRegistrationNumber: '123',
        registeredAddress: 'Y',
      })
      .expect(409);
    await call(t, r.session)
      .post(`/v1/merchants/${r.orgId}/branches`)
      .set('Idempotency-Key', `br-${uid()}-${uid()}`)
      .send({
        nameEn: 'B2',
        nameAr: 'ب',
        addressEn: 'a',
        addressAr: 'ع',
        city: 'Riyadh',
        latitude: 24.7,
        longitude: 46.7,
      })
      .expect(409);

    // Admin sees it in the queue and must claim before deciding
    const queue = await call(t, risk).get('/v1/admin/merchants/queue?limit=100');
    expect(
      queue.body.data.some((x: { organizationId: string }) => x.organizationId === r.orgId),
    ).toBe(true);
    await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/approve`).send({}).expect(409);
    const claimed = await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/claim`);
    expect(claimed.body.data.application.status).toBe('IN_REVIEW');
    await call(t, risk2).post(`/v1/admin/merchants/${r.orgId}/claim`).expect(409);

    // Request changes (rejects the CR document, asks for a section)
    const d1 = await adminDetail(risk, r.orgId);
    const crDoc = d1.documents.find((x: { requirementCode: string }) => x.requirementCode === 'CR');
    expect(crDoc.url).toContain('/v1/storage/download/');
    const rc = await call(t, risk)
      .post(`/v1/admin/merchants/${r.orgId}/request-changes`)
      .send({
        sections: ['DOCUMENTS'],
        documentIds: [crDoc.id],
        message: 'The registration is not legible',
        messageAr: 'السجل غير واضح',
      });
    expect(rc.status).toBe(200);
    expect(rc.body.data.application.status).toBe('CHANGES_REQUESTED');

    const asMerchant = await detail(r);
    expect(asMerchant.application.status).toBe('CHANGES_REQUESTED');
    expect(asMerchant.application.requestedChanges.message).toBe('The registration is not legible');
    expect(asMerchant.application.requestedChanges.sections).toEqual(['DOCUMENTS']);
    expect(asMerchant.editable).toBe(true);
    expect(asMerchant.ready).toBe(false); // rejected document must be replaced

    // Resubmit without fixing -> still blocked
    expect((await submit(r)).status).toBe(422);

    // Fix: replace the CR
    const fresh = await upload(
      r.session,
      r.orgId,
      'DOCUMENT',
      'cr-clear.pdf',
      'application/pdf',
      PLACEHOLDER_PDF,
    );
    await call(t, r.session)
      .post(`/v1/merchants/${r.orgId}/application/documents`)
      .send({ requirementCode: 'CR', fileId: fresh.fileId, expiryDate: '2032-01-01' })
      .expect(200);
    const re = await submit(r);
    expect(re.status).toBe(200);
    expect(re.body.data.application.status).toBe('RESUBMITTED');
    expect(re.body.data.application.version).toBe(2);

    // Reviewer sees what changed
    const d2 = await adminDetail(risk, r.orgId);
    expect(d2.changedSinceLastSubmission.length).toBeGreaterThan(0);
    expect(d2.decisions.map((x: { decision: string }) => x.decision)).toEqual(
      expect.arrayContaining(['CLAIMED', 'REQUEST_CHANGES', 'RESUBMITTED']),
    );

    // Approve needs claim + all documents reviewed
    await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/claim`).expect(200);
    await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/approve`).send({}).expect(409); // new document not reviewed yet
    await acceptAllDocs(risk, r.orgId);
    const ok = await call(t, risk)
      .post(`/v1/admin/merchants/${r.orgId}/approve`)
      .send({ note: 'Looks good' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.application.status).toBe('APPROVED');
    expect(ok.body.data.organizationStatus).toBe('ACTIVE');

    // Merchant is active: operational permissions open, application locked
    await call(t, r.session).get(`/v1/merchants/${r.orgId}/team`).expect(200);
    expect((await detail(r)).organizationStatus).toBe('ACTIVE');

    // Audit trail covers the whole journey, tagged to the merchant
    const actions = (
      await t.prisma.auditLog.findMany({ where: { subjectOrganizationId: r.orgId } })
    ).map((a) => a.action);
    for (const a of [
      'merchant.registered',
      'merchant.application.updated',
      'merchant.document.uploaded',
      'merchant.agreement.accepted',
      'merchant.application.submitted',
      'merchant.application.claimed',
      'merchant.application.changes_requested',
      'merchant.application.resubmitted',
      'merchant.document.accepted',
      'merchant.application.approved',
      'merchant.activated',
    ]) {
      expect(actions, a).toContain(a);
    }
    const approvedRow = await t.prisma.auditLog.findFirstOrThrow({
      where: { subjectOrganizationId: r.orgId, action: 'merchant.application.approved' },
    });
    expect(approvedRow.actorUserId).toBeTruthy();
    expect(approvedRow.actorRole).toBe('DEALDASH_RISK_COMPLIANCE');
    expect(approvedRow.reason).toBe('Looks good');
    expect(approvedRow.requestId).toBeTruthy();
    const trail = await call(t, risk).get(`/v1/admin/merchants/${r.orgId}/audit`);
    expect(trail.body.data.length).toBeGreaterThan(10);
  });

  it('Merchant -> Submit -> Admin review -> Reject (with reason); merchant sees it and cannot edit', async () => {
    const r = await register('Rej');
    await fillAll(r);
    expect((await submit(r)).status).toBe(200);
    await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/claim`).expect(200);
    await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/reject`).send({}).expect(400); // reason required
    const rej = await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/reject`).send({
      reason: 'Unable to verify the business',
      reasonAr: 'تعذر التحقق من النشاط',
      appealable: false,
    });
    expect(rej.status).toBe(200);
    expect(rej.body.data.application.status).toBe('REJECTED');
    const d = await detail(r);
    expect(d.application.status).toBe('REJECTED');
    expect(d.application.rejectionReason).toBe('Unable to verify the business');
    expect(d.application.rejectionReasonAr).toBe('تعذر التحقق من النشاط');
    expect(d.organizationStatus).toBe('DRAFT'); // never activated
    expect(d.editable).toBe(false);
    await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/approve`).send({}).expect(409); // decided applications are final
    const row = await t.prisma.auditLog.findFirstOrThrow({
      where: { subjectOrganizationId: r.orgId, action: 'merchant.application.rejected' },
    });
    expect(row.reason).toBe('Unable to verify the business');
  });

  it('request-changes requires a reviewer who has claimed the application, and a message', async () => {
    const r = await register('RcRule');
    await fillAll(r);
    await submit(r);
    await call(t, risk)
      .post(`/v1/admin/merchants/${r.orgId}/request-changes`)
      .send({ sections: ['BUSINESS'], message: 'x' })
      .expect(409);
    await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/claim`).expect(200);
    await call(t, risk)
      .post(`/v1/admin/merchants/${r.orgId}/request-changes`)
      .send({ sections: [], message: 'x' })
      .expect(400);
    await call(t, risk)
      .post(`/v1/admin/merchants/${r.orgId}/request-changes`)
      .send({ sections: ['BUSINESS'] })
      .expect(400);
    await call(t, risk2)
      .post(`/v1/admin/merchants/${r.orgId}/request-changes`)
      .send({ sections: ['BUSINESS'], message: 'not mine' })
      .expect(409);
  });

  // ---------------------------------------------------------------- risk tier, trust level, enhanced review
  it('enhanced risk tier requires a second, different reviewer to approve', async () => {
    const r = await register('Enh');
    await fillAll(r);
    await submit(r);
    await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/claim`).expect(200);
    await acceptAllDocs(risk, r.orgId);
    await call(t, risk)
      .post(`/v1/admin/merchants/${r.orgId}/risk-tier`)
      .send({ tier: 'ENHANCED' })
      .expect(400); // reason required
    const tier = await call(t, risk)
      .post(`/v1/admin/merchants/${r.orgId}/risk-tier`)
      .send({ tier: 'ENHANCED', reason: 'High-value category' });
    expect(tier.body.data.application.riskTier).toBe('ENHANCED');

    const first = await call(t, risk)
      .post(`/v1/admin/merchants/${r.orgId}/approve`)
      .send({ note: 'First approval' });
    expect(first.status).toBe(200);
    expect(first.body.data.application.status).toBe('IN_REVIEW');
    expect(first.body.data.application.awaitingSecondReview).toBe(true);
    expect(first.body.data.organizationStatus).toBe('DRAFT');

    // The same person cannot give the final approval, even after re-claiming
    await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/claim`).expect(200);
    const again = await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/approve`).send({});
    expect(again.status).toBe(409);
    expect(again.body.errors[0].code).toBe('SECOND_REVIEW_REQUIRED');

    await call(t, risk2).post(`/v1/admin/merchants/${r.orgId}/claim`).expect(409); // still held by the first reviewer
    await call(t, risk).post(`/v1/admin/merchants/${r.orgId}/release`).expect(200);
    await call(t, risk2).post(`/v1/admin/merchants/${r.orgId}/claim`).expect(200);
    const final = await call(t, risk2)
      .post(`/v1/admin/merchants/${r.orgId}/approve`)
      .send({ note: 'Second approval' });
    expect(final.status).toBe(200);
    expect(final.body.data.application.status).toBe('APPROVED');
    expect(final.body.data.organizationStatus).toBe('ACTIVE');
    const actions = (
      await t.prisma.auditLog.findMany({ where: { subjectOrganizationId: r.orgId } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'merchant.risk_tier.changed',
        'merchant.application.first_approval',
        'merchant.application.approved',
      ]),
    );
  });

  it('suggests the enhanced tier when the bank account holder differs from the legal name (suggestion only)', async () => {
    const r = await register('Sugg');
    await fillAll(r, { holder: 'A Different Holder LLC' });
    await submit(r);
    const d = await adminDetail(risk, r.orgId);
    expect(d.riskSuggestion.suggestedTier).toBe('ENHANCED');
    expect(d.riskSuggestion.reasons.join(' ')).toMatch(/Bank account holder/);
    expect(d.application.riskTier).toBe('STANDARD'); // never changed automatically
    // holder mismatch also blocks submission readiness is not required; the checklist flags it
    expect(
      d.completeness.find((c: { section: string }) => c.section === 'SETTLEMENT'),
    ).toBeTruthy();
  });

  it('trust level changes need admin.merchants.manage, a reason, and are audited with before/after', async () => {
    const r = await register('Trust');
    await call(t, risk)
      .post(`/v1/admin/merchants/${r.orgId}/trust-level`)
      .send({ level: 'TRUSTED', reason: 'x' })
      .expect(403);
    await call(t, mm)
      .post(`/v1/admin/merchants/${r.orgId}/trust-level`)
      .send({ level: 'TRUSTED' })
      .expect(400);
    const res = await call(t, mm)
      .post(`/v1/admin/merchants/${r.orgId}/trust-level`)
      .send({ level: 'TRUSTED', reason: 'Long track record' });
    expect(res.body.data.trustLevel).toBe('TRUSTED');
    const row = await t.prisma.auditLog.findFirstOrThrow({
      where: { subjectOrganizationId: r.orgId, action: 'merchant.trust_level.changed' },
    });
    expect(row.previousState).toEqual({ trustLevel: 'NEW' });
    expect(row.newState).toEqual({ trustLevel: 'TRUSTED' });
    expect(row.reason).toBe('Long track record');
  });

  // ---------------------------------------------------------------- suspend / reactivate
  it('suspends and reactivates an active merchant; the merchant loses and regains access immediately', async () => {
    const m = await createMerchantOrg(t.prisma, 'Susp2', 1);
    await t.prisma.merchantApplication.create({
      data: { organizationId: m.orgId, reference: `DD-T-${uid()}`, status: 'APPROVED' },
    });
    const owner = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    await call(t, owner).get(`/v1/merchants/${m.orgId}/branches`).expect(200);

    await call(t, risk)
      .post(`/v1/admin/merchants/${m.orgId}/suspend`)
      .send({ reason: 'x' })
      .expect(403); // review role cannot suspend
    await call(t, mm).post(`/v1/admin/merchants/${m.orgId}/suspend`).send({}).expect(400);
    const s = await call(t, mm)
      .post(`/v1/admin/merchants/${m.orgId}/suspend`)
      .send({ reason: 'Customer complaints under investigation' });
    expect(s.body.data.organizationStatus).toBe('SUSPENDED');
    expect(s.body.data.suspendedReason).toBe('Customer complaints under investigation');
    await call(t, owner).get(`/v1/merchants/${m.orgId}/branches`).expect(403);
    const profile = await call(t, owner).get(`/v1/merchants/${m.orgId}`);
    expect(profile.body.data.status).toBe('SUSPENDED');
    await call(t, mm)
      .post(`/v1/admin/merchants/${m.orgId}/suspend`)
      .send({ reason: 'again' })
      .expect(409);

    const re = await call(t, mm)
      .post(`/v1/admin/merchants/${m.orgId}/reactivate`)
      .send({ reason: 'Resolved' });
    expect(re.body.data.organizationStatus).toBe('ACTIVE');
    await call(t, owner).get(`/v1/merchants/${m.orgId}/branches`).expect(200);
    const actions = (
      await t.prisma.auditLog.findMany({ where: { subjectOrganizationId: m.orgId } })
    ).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['merchant.suspended', 'merchant.reactivated']));
  });

  // ---------------------------------------------------------------- permissions and isolation
  it('admin permissions: only review/manage roles reach the workbench; merchants and customers cannot', async () => {
    const m = await register('Perm');
    await call(t, support).get('/v1/admin/merchants').expect(403);
    await call(t, support).get(`/v1/admin/merchants/${m.orgId}`).expect(403);
    await call(t, risk).get('/v1/admin/merchants').expect(200);
    await call(t, m.session).get('/v1/admin/merchants').expect(401); // wrong app audience
    await call(t, m.session).get(`/v1/admin/merchants/${m.orgId}`).expect(401);
    await t.http.get('/v1/admin/merchants').expect(401);
    const cust = await otpSession(t, '+966500000001', 'customer').catch(() => null);
    if (cust) await call(t, cust).get('/v1/admin/merchants').expect(401);
  });

  it('merchant permissions: MERCHANT_ADMIN cannot run the application or sign; finance/campaign cannot manage the team', async () => {
    const m = await createMerchantOrg(t.prisma, 'PermM', 1);
    await t.prisma.merchantApplication.create({
      data: { organizationId: m.orgId, reference: `DD-T-${uid()}`, status: 'APPROVED' },
    });
    const sessionFor = async (role: Parameters<typeof createBusinessUser>[1]['role']) =>
      passwordSession(
        t,
        await createBusinessUser(t.prisma, { role, orgId: m.orgId, userType: 'MERCHANT_USER' }),
        'merchant',
      );
    const admin = await sessionFor('MERCHANT_ADMIN');
    const finance = await sessionFor('MERCHANT_FINANCE');
    const campaigns = await sessionFor('MERCHANT_CAMPAIGN_MANAGER');
    const owner = await sessionFor('MERCHANT_OWNER');
    const sub = `/v1/merchants/${m.orgId}/application/submit`;
    await call(t, admin).post(sub).send({ declaration: true }).expect(403);
    await call(t, admin)
      .post(`/v1/merchants/${m.orgId}/application/agreement/accept`)
      .send({ signatureName: 'x', accept: true })
      .expect(403);
    await call(t, admin).get(`/v1/merchants/${m.orgId}/team`).expect(200);
    await call(t, finance).get(`/v1/merchants/${m.orgId}/team`).expect(403);
    await call(t, campaigns).get(`/v1/merchants/${m.orgId}/team`).expect(403);
    await call(t, finance)
      .patch(`/v1/merchants/${m.orgId}/branches/${m.branchIds[0]}`)
      .send({ nameEn: 'x' })
      .expect(403);
    await call(t, owner)
      .patch(`/v1/merchants/${m.orgId}/branches/${m.branchIds[0]}`)
      .send({ nameEn: 'Renamed' })
      .expect(200);
  });

  it('tenant isolation: one merchant cannot read, change, upload for, or review-act on another (always 404)', async () => {
    const a = await register('IsoA');
    const b = await register('IsoB');
    await fillAll(b);
    const base = `/v1/merchants/${b.orgId}`;
    for (const url of [
      `${base}/application`,
      `${base}/files/${'0'.repeat(8)}-0000-4000-8000-000000000000/url`,
    ]) {
      expect((await call(t, a.session).get(url)).status, url).toBe(404);
    }
    // A draft merchant has no team permission at all; it must never get data from another tenant either way.
    expect([403, 404]).toContain((await call(t, a.session).get(`${base}/team`)).status);
    await call(t, a.session)
      .put(`${base}/application/business`)
      .send({
        legalNameEn: 'Hijack',
        legalNameAr: 'س',
        tradeNameEn: 'H',
        tradeNameAr: 'س',
        commercialRegistrationNumber: '123',
        registeredAddress: 'Y',
      })
      .expect(404);
    await call(t, a.session)
      .post(`${base}/application/submit`)
      .send({ declaration: true })
      .expect(404);
    await call(t, a.session)
      .post(`${base}/files/intent`)
      .send({ kind: 'DOCUMENT', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 })
      .expect(404);
    await call(t, a.session)
      .post(`${base}/team/invitations`)
      .set('Idempotency-Key', `k-${uid()}-${uid()}`)
      .send({ name: 'X', email: `x-${uid()}@t.test`, roleCode: 'MERCHANT_ADMIN' })
      .then((x) => expect([403, 404]).toContain(x.status));
    expect((await detail(b)).business.legalNameEn).not.toBe('Hijack');
    // and the application of B is untouched by A's attempts
    expect((await detail(b)).application.status).toBe('DRAFT');
  });

  it('a merchant document can never be attached from, or read through, a different organisation', async () => {
    const a = await register('DocA');
    const b = await register('DocB');
    const f = await upload(
      b.session,
      b.orgId,
      'DOCUMENT',
      'b.pdf',
      'application/pdf',
      PLACEHOLDER_PDF,
    );
    const res = await call(t, a.session)
      .post(`/v1/merchants/${a.orgId}/application/documents`)
      .send({ requirementCode: 'CR', fileId: f.fileId, expiryDate: '2031-01-01' });
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------- agreement
  it('only the named signatory can accept, and the acceptance records version, signatory, entity, time and IP', async () => {
    const r = await register('Agr');
    const base = `/v1/merchants/${r.orgId}/application`;
    await call(t, r.session)
      .post(`${base}/agreement/accept`)
      .send({ signatureName: 'Sara Alharbi', accept: true })
      .expect(409); // no representative yet
    await call(t, r.session).put(`${base}/business`).send({
      legalNameEn: 'Agr Co',
      legalNameAr: 'شركة',
      tradeNameEn: 'Agr',
      tradeNameAr: 'ا',
      commercialRegistrationNumber: '1010',
      registeredAddress: 'Riyadh',
    });
    await call(t, r.session).put(`${base}/representative`).send({
      fullName: 'Sara Alharbi',
      role: 'Owner',
      idReference: '1000000009',
      mobile: '+966500001234',
      email: r.email,
      isSignatory: true,
    });
    const wrong = await call(t, r.session)
      .post(`${base}/agreement/accept`)
      .send({ signatureName: 'Someone Else', accept: true });
    expect(wrong.status).toBe(403);
    expect(wrong.body.errors[0].code).toBe('SIGNATORY_ONLY');
    const ok = await call(t, r.session)
      .post(`${base}/agreement/accept`)
      .send({ signatureName: 'sara alharbi', accept: true });
    expect(ok.status).toBe(200);
    const acc = ok.body.data.agreement.acceptance;
    expect(acc.agreementVersion).toBe('1.0');
    expect(acc.signatoryName).toBe('Sara Alharbi');
    expect(acc.entityLegalName).toBe('Agr Co');
    const row = await t.prisma.agreementAcceptance.findFirstOrThrow({
      where: { organizationId: r.orgId },
    });
    expect(row.ip).toBeTruthy();
    expect(row.acceptedAt).toBeInstanceOf(Date);
  });

  // ---------------------------------------------------------------- branches
  it('branch hours are validated; the last active branch of an active merchant cannot be closed; staff cannot edit', async () => {
    const m = await createMerchantOrg(t.prisma, 'Br', 2);
    await t.prisma.merchantApplication.create({
      data: { organizationId: m.orgId, reference: `DD-T-${uid()}`, status: 'APPROVED' },
    });
    const owner = await passwordSession(
      t,
      await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      }),
      'merchant',
    );
    const b1 = `/v1/merchants/${m.orgId}/branches/${m.branchIds[0]}`;
    const bad = {
      ...HOURS,
      mon: { closed: false, intervals: [{ open: '18:00', close: '10:00' }] },
    };
    await call(t, owner).patch(b1).send({ hours: bad }).expect(400);
    const overlap = {
      ...HOURS,
      tue: {
        closed: false,
        intervals: [
          { open: '09:00', close: '14:00' },
          { open: '13:00', close: '20:00' },
        ],
      },
    };
    await call(t, owner).patch(b1).send({ hours: overlap }).expect(400);
    const good = await call(t, owner).patch(b1).send({ hours: HOURS, phone: '+966110000000' });
    expect(good.status).toBe(200);
    expect(good.body.data.hours.mon.intervals[0].open).toBe('09:00');
    await call(t, owner)
      .post(`${b1}/status`)
      .send({ status: 'CLOSED', reason: 'Renovation' })
      .expect(200);
    const last = await call(t, owner)
      .post(`/v1/merchants/${m.orgId}/branches/${m.branchIds[1]}/status`)
      .send({ status: 'CLOSED' });
    expect(last.status).toBe(409);
    expect(last.body.errors[0].code).toBe('LAST_ACTIVE_BRANCH');
    await call(t, owner).post(`${b1}/status`).send({ status: 'ACTIVE' }).expect(200);

    const staff = await t.prisma.user.create({
      data: {
        userType: 'MERCHANT_USER',
        mobile: `+96655${Math.floor(1000000 + Math.random() * 8999999)}`,
        displayName: 'S',
        status: 'ACTIVE',
      },
    });
    const role = await t.prisma.role.findUniqueOrThrow({ where: { code: 'MERCHANT_STAFF' } });
    await t.prisma.organizationMembership.create({
      data: {
        userId: staff.id,
        organizationId: m.orgId,
        roleId: role.id,
        branchId: m.branchIds[0],
      },
    });
    const ss = await otpSession(t, staff.mobile!, 'staff');
    // Staff sessions belong to the staff app: the merchant-portal management API is closed to them.
    expect([401, 403]).toContain((await call(t, ss).patch(b1).send({ nameEn: 'x' })).status);
  });

  // ---------------------------------------------------------------- team
  describe('team and staff', () => {
    async function activeMerchant() {
      const m = await createMerchantOrg(t.prisma, 'Team', 2);
      await t.prisma.merchantApplication.create({
        data: { organizationId: m.orgId, reference: `DD-T-${uid()}`, status: 'APPROVED' },
      });
      const ownerUser = await createBusinessUser(t.prisma, {
        role: 'MERCHANT_OWNER',
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      });
      const owner = await passwordSession(t, ownerUser, 'merchant');
      return { m, owner, ownerUser };
    }
    const invite = (s: Session, orgId: string, body: Record<string, unknown>) =>
      call(t, s)
        .post(`/v1/merchants/${orgId}/team/invitations`)
        .set('Idempotency-Key', `inv-${uid()}-${uid()}`)
        .send(body);

    it('cannot invite before the account is active', async () => {
      const r = await register('TeamEarly');
      const res = await call(t, r.session).get(`/v1/merchants/${r.orgId}/team`);
      expect(res.status).toBe(403);
    });

    it('invites an admin by email; the invitee accepts with a password, signs in, and is audited', async () => {
      const { m, owner } = await activeMerchant();
      const email = `inv-${uid()}@merchant.test`;
      const inv = await invite(owner, m.orgId, { name: 'Nora', email, roleCode: 'MERCHANT_ADMIN' });
      expect(inv.status).toBe(200);
      const link = emails.lastTo(email, 'merchant.invite')!.body;
      const token = /token=([\w-]+)/.exec(link)![1]!;
      const preview = await t.http.get(`/v1/merchant-signup/invitations/${token}`);
      expect(preview.body.data.roleCode).toBe('MERCHANT_ADMIN');
      await t.http.post(`/v1/merchant-signup/invitations/${token}/accept`).send({}).expect(400); // password required
      await t.http
        .post(`/v1/merchant-signup/invitations/${token}/accept`)
        .send({ password: 'weak' })
        .expect(400);
      await t.http
        .post(`/v1/merchant-signup/invitations/${token}/accept`)
        .send({ password: TEST_PASSWORD })
        .expect(200);
      await t.http
        .post(`/v1/merchant-signup/invitations/${token}/accept`)
        .send({ password: TEST_PASSWORD })
        .expect(410); // single use
      const login = await t.http
        .post('/v1/auth/login')
        .send({ email, password: TEST_PASSWORD, audience: 'merchant' });
      expect(login.status).toBe(200);
      const list = await call(t, owner).get(`/v1/merchants/${m.orgId}/team`);
      expect(list.body.data.users.map((u: { email: string }) => u.email)).toContain(email);
      const actions = (
        await t.prisma.auditLog.findMany({ where: { subjectOrganizationId: m.orgId } })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['merchant.user.invited', 'merchant.user.joined']),
      );
    });

    it('invites branch staff by mobile; staff sign in with OTP and see only their branch', async () => {
      const { m, owner } = await activeMerchant();
      const mobile = `+96655${Math.floor(1000000 + Math.random() * 8999999)}`;
      await invite(owner, m.orgId, { name: 'Khalid', mobile, roleCode: 'MERCHANT_STAFF' }).expect(
        400,
      ); // branch required
      await invite(owner, m.orgId, {
        name: 'Khalid',
        mobile,
        roleCode: 'MERCHANT_STAFF',
        branchId: '00000000-0000-4000-8000-000000000000',
      }).expect(400); // not this org's branch
      const other = await createMerchantOrg(t.prisma, 'OtherTeam', 1);
      await invite(owner, m.orgId, {
        name: 'Khalid',
        mobile,
        roleCode: 'MERCHANT_STAFF',
        branchId: other.branchIds[0],
      }).expect(400); // another org's branch
      const ok = await invite(owner, m.orgId, {
        name: 'Khalid',
        mobile,
        roleCode: 'MERCHANT_STAFF',
        branchId: m.branchIds[0],
      });
      expect(ok.status).toBe(200);
      const token = /token=([\w-]+)/.exec(t.sms.lastTo(mobile)!.body)![1]!;
      await t.http.post(`/v1/merchant-signup/invitations/${token}/accept`).send({}).expect(200);
      const staff = await otpSession(t, mobile, 'staff');
      expect(staff.me.activeMembership?.branchId ?? staff.me.memberships?.[0]?.branchId).toBe(
        m.branchIds[0],
      );
      const branches = await call(t, staff).get(`/v1/merchants/${m.orgId}/branches`);
      expect(branches.body.data).toHaveLength(1);
      await call(t, staff).get(`/v1/merchants/${m.orgId}/branches/${m.branchIds[1]}`).expect(404);
    });

    it('protects the last owner, changes roles, and deactivation ends the user session immediately', async () => {
      const { m, owner, ownerUser } = await activeMerchant();
      const list0 = await call(t, owner).get(`/v1/merchants/${m.orgId}/team`);
      const ownerMembership = list0.body.data.users.find(
        (u: { userId: string }) => u.userId === ownerUser.id,
      ).membershipId;
      const last = await call(t, owner)
        .post(`/v1/merchants/${m.orgId}/team/${ownerMembership}/deactivate`)
        .send({ reason: 'x' });
      expect(last.status).toBe(409);
      expect(last.body.errors[0].code).toBe('LAST_OWNER');
      const demote = await call(t, owner)
        .patch(`/v1/merchants/${m.orgId}/team/${ownerMembership}/role`)
        .send({ roleCode: 'MERCHANT_ADMIN' });
      expect(demote.status).toBe(409);

      const adminUser = await createBusinessUser(t.prisma, {
        role: 'MERCHANT_ADMIN',
        orgId: m.orgId,
        userType: 'MERCHANT_USER',
      });
      const adminS = await passwordSession(t, adminUser, 'merchant');
      await call(t, adminS).get(`/v1/merchants/${m.orgId}/team`).expect(200);
      const list1 = await call(t, owner).get(`/v1/merchants/${m.orgId}/team`);
      const adminMembership = list1.body.data.users.find(
        (u: { userId: string }) => u.userId === adminUser.id,
      ).membershipId;
      // admin cannot touch the owner
      await call(t, adminS)
        .post(`/v1/merchants/${m.orgId}/team/${ownerMembership}/deactivate`)
        .send({ reason: 'x' })
        .expect(403);
      const role = await call(t, owner)
        .patch(`/v1/merchants/${m.orgId}/team/${adminMembership}/role`)
        .send({ roleCode: 'MERCHANT_FINANCE' });
      expect(role.status).toBe(200);
      await call(t, adminS).get(`/v1/merchants/${m.orgId}/team`).expect(403); // finance cannot manage the team
      await call(t, owner)
        .post(`/v1/merchants/${m.orgId}/team/${adminMembership}/deactivate`)
        .send({ reason: 'Left the company' })
        .expect(200);
      await call(t, adminS).get(`/v1/merchants/${m.orgId}/branches`).expect(401);
      const relog = await t.http
        .post('/v1/auth/login')
        .send({ email: adminUser.email, password: TEST_PASSWORD, audience: 'merchant' });
      expect([401, 403]).toContain(relog.status);
    });

    it('team membership ids from another merchant are 404', async () => {
      const a = await activeMerchant();
      const b = await activeMerchant();
      const bTeam = await call(t, b.owner).get(`/v1/merchants/${b.m.orgId}/team`);
      const bMembership = bTeam.body.data.users[0].membershipId;
      await call(t, a.owner).get(`/v1/merchants/${b.m.orgId}/team`).expect(404);
      await call(t, a.owner)
        .post(`/v1/merchants/${b.m.orgId}/team/invitations`)
        .set('Idempotency-Key', `x-${uid()}-${uid()}`)
        .send({ name: 'X', email: `x-${uid()}@t.test`, roleCode: 'MERCHANT_ADMIN' })
        .expect(404);
      await call(t, a.owner)
        .post(`/v1/merchants/${a.m.orgId}/team/${bMembership}/deactivate`)
        .send({ reason: 'x' })
        .expect(404);
      await call(t, a.owner)
        .patch(`/v1/merchants/${a.m.orgId}/team/${bMembership}/role`)
        .send({ roleCode: 'MERCHANT_FINANCE' })
        .expect(404);
    });
  });

  // ---------------------------------------------------------------- Arabic
  it('stores and finds Arabic merchant data (normalised search) and bilingual decisions', async () => {
    const r = await register('Ar');
    await call(t, r.session)
      .put(`/v1/merchants/${r.orgId}/application/business`)
      .send({
        legalNameEn: 'Arabic Co',
        legalNameAr: 'شركة المأكولات العربية',
        tradeNameEn: 'Arabic Trade',
        tradeNameAr: 'مطعم الأصالة',
        commercialRegistrationNumber: '1010123456',
        registeredAddress: 'الرياض، العليا',
      })
      .expect(200);
    const d = await detail(r);
    expect(d.business.legalNameAr).toBe('شركة المأكولات العربية');
    expect(d.business.registeredAddress).toBe('الرياض، العليا');
    const found = await call(t, risk).get(
      '/v1/admin/merchants?limit=100&q=' + encodeURIComponent('الأصالة'),
    );
    expect(
      found.body.data.some((x: { organizationId: string }) => x.organizationId === r.orgId),
    ).toBe(true);
    const byRef = await call(t, risk).get(
      '/v1/admin/merchants?q=' + encodeURIComponent(d.application.reference),
    );
    expect(
      byRef.body.data.some((x: { organizationId: string }) => x.organizationId === r.orgId),
    ).toBe(true);
  });

  it('list filters work (status, trust, risk) and keyset pagination returns a cursor', async () => {
    const p1 = await call(t, risk).get('/v1/admin/merchants?limit=2');
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta.nextCursor).toBeTruthy();
    const p2 = await call(t, risk).get(
      `/v1/admin/merchants?limit=2&cursor=${p1.body.meta.nextCursor}`,
    );
    expect(p2.body.data[0].organizationId).not.toBe(p1.body.data[0].organizationId);
    const drafts = await call(t, risk).get('/v1/admin/merchants?status=DRAFT&limit=100');
    expect(drafts.body.data.every((x: { status: string }) => x.status === 'DRAFT')).toBe(true);
  });
});
