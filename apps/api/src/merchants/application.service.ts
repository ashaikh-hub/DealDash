import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { ApiEnv } from '@dealdash/config';
import { isValidSaudiIban, maskIban, normalizeIban } from '@dealdash/validation';
import type {
  agreementAcceptSchema,
  businessDetailsSchema,
  categoryBrandingSchema,
  documentAttachSchema,
  merchantRegisterSchema,
  representativeSchema,
  settlementSchema,
} from '@dealdash/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { encryptField, hashPassword } from '../common/crypto';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { AuthService } from '../identity/auth.service';
import { TenantService } from '../identity/tenant.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContactVerificationService } from './contact-verification.service';
import { MerchantReadService, namesMatch } from './merchant-read.service';

type Agg = Awaited<ReturnType<MerchantReadService['loadAggregate']>>;

@Injectable()
export class ApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: MerchantReadService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly verify: ContactVerificationService,
    private readonly auth: AuthService,
    private readonly tenant: TenantService,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  // ------------------------------------------------------------------ registration (public)
  async register(dto: z.infer<typeof merchantRegisterSchema>, meta: RequestMeta) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing)
      throw AppError.conflict(
        'EMAIL_TAKEN',
        'An account with this email already exists. Sign in or use another email.',
      );
    const seq = await this.prisma.$queryRaw<
      Array<{ n: bigint }>
    >`SELECT nextval('merchant_application_ref_seq') AS n`;
    const n = seq[0]!.n;
    const reference = `DD-M-${n}`;
    const ownerRole = await this.prisma.role.findUniqueOrThrow({
      where: { code: 'MERCHANT_OWNER' },
    });
    const passwordHash = await hashPassword(dto.password);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          userType: 'MERCHANT_USER',
          status: 'INVITED',
          email: dto.email,
          displayName: dto.tradeNameEn,
          passwordHash,
          locale: meta.locale,
        },
      });
      const org = await tx.organization.create({
        data: {
          type: 'MERCHANT',
          status: 'DRAFT',
          nameEn: dto.tradeNameEn,
          nameAr: dto.tradeNameAr ?? dto.tradeNameEn,
          merchant: {
            create: {
              legalName: '',
              tradeNameEn: dto.tradeNameEn,
              tradeNameAr: dto.tradeNameAr ?? null,
            },
          },
          application: { create: { reference } },
        },
      });
      await tx.organizationMembership.create({
        data: { userId: user.id, organizationId: org.id, roleId: ownerRole.id },
      });
      await this.audit.record(
        {
          action: 'merchant.registered',
          entityType: 'Organization',
          entityId: org.id,
          reason: reference,
          actorUserId: user.id,
          actorOrganizationId: org.id,
          actorRole: 'MERCHANT_OWNER',
          subjectOrganizationId: org.id,
          meta,
        },
        tx,
      );
      return { user, org };
    });

    const sent = await this.verify.send('EMAIL_VERIFY', dto.email, meta);
    return {
      organizationId: created.org.id,
      emailCodeSent: true,
      expiresInSeconds: sent.expiresInSeconds,
    };
  }

  async resendCode(email: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same response whether or not the address exists (no enumeration).
    if (
      user &&
      user.status === 'INVITED' &&
      user.userType === 'MERCHANT_USER' &&
      !user.emailVerifiedAt
    )
      await this.verify.send('EMAIL_VERIFY', email, meta);
    return { organizationId: null, emailCodeSent: true, expiresInSeconds: 0 };
  }

  async verifyEmail(email: string, code: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: true },
    });
    if (!user || user.userType !== 'MERCHANT_USER' || user.status !== 'INVITED')
      throw new AppError('OTP_INVALID', 'The code is not valid', 400);
    await this.verify.check('EMAIL_VERIFY', email, code);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', emailVerifiedAt: new Date() },
    });
    const orgId = user.memberships[0]?.organizationId ?? null;
    await this.audit.record({
      action: 'merchant.email_verified',
      entityType: 'User',
      entityId: user.id,
      actorUserId: user.id,
      subjectOrganizationId: orgId,
      meta,
    });
    return {
      result: await this.auth.startSession(user.id, 'merchant', meta),
      organizationId: orgId,
    };
  }

  // ------------------------------------------------------------------ context helpers
  private async context(
    actor: Actor,
    organizationId: string,
    opts: { editable?: boolean } = {},
  ): Promise<Agg> {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    const agg = await this.read.loadAggregate(organizationId);
    if (
      opts.editable &&
      !(agg.org.status === 'DRAFT' && this.read.isEditable(agg.application.status))
    ) {
      throw new AppError(
        'APPLICATION_LOCKED',
        'The application cannot be edited in its current status',
        409,
      );
    }
    return agg;
  }

  async detail(actor: Actor, organizationId: string) {
    const agg = await this.context(actor, organizationId);
    const completeness = await this.read.completeness(agg);
    const reqs = await this.read.requirements();
    return {
      organizationId,
      organizationStatus: agg.org.status,
      editable: agg.org.status === 'DRAFT' && this.read.isEditable(agg.application.status),
      application: this.read.applicationView(agg.application, agg.merchant.riskTier),
      business: await this.read.businessView(agg.merchant, organizationId),
      representative: this.read.representativeView(agg.merchant.representative),
      settlement: this.read.settlementView(agg.merchant.settlement, [
        agg.merchant.legalName,
        agg.merchant.legalNameAr ?? '',
      ]),
      documents: this.read.documentViews(agg.documents),
      requirements: reqs,
      categories: await this.read.categories(),
      branches: this.read.branchViews(agg.branches),
      agreement: {
        current: {
          id: agg.agreement.id,
          version: agg.agreement.version,
          titleEn: agg.agreement.titleEn,
          titleAr: agg.agreement.titleAr,
          bodyEn: agg.agreement.bodyEn,
          bodyAr: agg.agreement.bodyAr,
          placeholder: agg.agreement.placeholder,
        },
        acceptance: agg.acceptance
          ? {
              id: agg.acceptance.id,
              agreementVersion: agg.agreement.version,
              signatoryName: agg.acceptance.signatoryName,
              signatoryRole: agg.acceptance.signatoryRole,
              entityLegalName: agg.acceptance.entityLegalName,
              acceptedAt: agg.acceptance.acceptedAt.toISOString(),
              status: agg.acceptance.status,
              method: agg.acceptance.method,
            }
          : null,
      },
      contact: {
        email: agg.owner?.email ?? '',
        emailVerified: !!agg.owner?.emailVerifiedAt,
        mobile: agg.owner?.mobile ?? null,
        mobileVerified: !!agg.owner?.mobileVerifiedAt,
      },
      completeness,
      ready: completeness.every((c) => c.complete),
      trustLevel: agg.merchant.trustLevel,
    };
  }

  // ------------------------------------------------------------------ sections
  async updateBusiness(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof businessDetailsSchema>,
    meta: RequestMeta,
  ) {
    const agg = await this.context(actor, organizationId, { editable: true });
    const before = agg.merchant;
    await this.prisma.$transaction(async (tx) => {
      await tx.merchant.update({
        where: { organizationId },
        data: {
          legalName: dto.legalNameEn,
          legalNameAr: dto.legalNameAr,
          tradeNameEn: dto.tradeNameEn,
          tradeNameAr: dto.tradeNameAr,
          commercialRegistrationNumber: dto.commercialRegistrationNumber,
          taxNumber: dto.taxNumber ?? null,
          businessType: dto.businessType ?? null,
          registeredAddress: dto.registeredAddress,
          businessPhone: dto.businessPhone ?? null,
          businessEmail: dto.businessEmail ?? null,
        },
      });
      await tx.organization.update({
        where: { id: organizationId },
        data: { nameEn: dto.tradeNameEn, nameAr: dto.tradeNameAr },
      });
      await this.audit.record(
        {
          action: 'merchant.application.updated',
          entityType: 'MerchantApplication',
          entityId: agg.application.id,
          reason: 'BUSINESS',
          previousState: { registrationNumber: before.commercialRegistrationNumber },
          newState: { registrationNumber: dto.commercialRegistrationNumber },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    return this.detail(actor, organizationId);
  }

  async updateCategory(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof categoryBrandingSchema>,
    meta: RequestMeta,
  ) {
    const agg = await this.context(actor, organizationId, { editable: true });
    const cats = await this.read.categories();
    if (!cats.some((c) => c.code === dto.categoryCode))
      throw AppError.validation('Choose a category from the list', 'categoryCode');
    const checkImage = async (id: string | null | undefined, kind: string, field: string) => {
      if (!id) return;
      const f = await this.files.requireAvailable(id, organizationId);
      if (f.kind !== kind)
        throw new AppError(
          'FILE_INVALID',
          `This file was not uploaded as a ${kind.toLowerCase()}`,
          400,
          field,
        );
    };
    await checkImage(dto.logoFileId, 'LOGO', 'logoFileId');
    await checkImage(dto.coverFileId, 'COVER', 'coverFileId');
    for (const g of dto.galleryFileIds ?? []) await checkImage(g, 'GALLERY', 'galleryFileIds');
    const catName = cats.find((c) => c.code === dto.categoryCode)!;
    await this.prisma.merchant.update({
      where: { organizationId },
      data: {
        categoryCode: dto.categoryCode,
        category: catName.nameEn,
        subCategory: dto.subCategory ?? null,
        descriptionEn: dto.descriptionEn,
        descriptionAr: dto.descriptionAr,
        logoFileId: dto.logoFileId ?? agg.merchant.logoFileId,
        coverFileId: dto.coverFileId ?? agg.merchant.coverFileId,
        galleryFileIds: dto.galleryFileIds ?? (agg.merchant.galleryFileIds as string[]),
      },
    });
    await this.audit.record({
      action: 'merchant.application.updated',
      entityType: 'MerchantApplication',
      entityId: agg.application.id,
      reason: 'CATEGORY',
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.detail(actor, organizationId);
  }

  async updateRepresentative(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof representativeSchema>,
    meta: RequestMeta,
  ) {
    const agg = await this.context(actor, organizationId, { editable: true });
    const data = {
      fullName: dto.fullName,
      role: dto.role,
      idReferenceEnc: encryptField(dto.idReference, this.env.FIELD_ENCRYPTION_KEY),
      idReferenceLast4: dto.idReference.slice(-4),
      mobile: dto.mobile,
      email: dto.email,
      isSignatory: dto.isSignatory,
    };
    await this.prisma.merchantRepresentative.upsert({
      where: { organizationId },
      update: data,
      create: { organizationId, ...data },
    });
    await this.audit.record({
      action: 'merchant.application.updated',
      entityType: 'MerchantApplication',
      entityId: agg.application.id,
      reason: 'REPRESENTATIVE',
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.detail(actor, organizationId);
  }

  async updateSettlement(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof settlementSchema>,
    meta: RequestMeta,
  ) {
    const agg = await this.context(actor, organizationId, { editable: true });
    if (!isValidSaudiIban(dto.iban))
      throw AppError.validation('Enter a valid Saudi IBAN (SA + 22 digits)', 'iban');
    const iban = normalizeIban(dto.iban);
    const data = {
      bankName: dto.bankName,
      ibanEnc: encryptField(iban, this.env.FIELD_ENCRYPTION_KEY),
      ibanMasked: maskIban(iban),
      accountHolderName: dto.accountHolderName,
      verificationStatus: 'UNVERIFIED',
      verifiedByUserId: null,
      verifiedAt: null,
    };
    await this.prisma.merchantSettlementAccount.upsert({
      where: { organizationId },
      update: data,
      create: { organizationId, ...data },
    });
    // The audit trail never contains the IBAN itself, only its masked form.
    await this.audit.record({
      action: 'merchant.settlement.updated',
      entityType: 'MerchantSettlementAccount',
      entityId: organizationId,
      newState: { ibanMasked: data.ibanMasked, bankName: dto.bankName },
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    void agg;
    return this.detail(actor, organizationId);
  }

  // ------------------------------------------------------------------ documents
  async attachDocument(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof documentAttachSchema>,
    meta: RequestMeta,
  ) {
    const agg = await this.context(actor, organizationId, { editable: true });
    const reqs = await this.read.requirements();
    const requirement = reqs.find((r) => r.code === dto.requirementCode);
    if (!requirement) throw AppError.validation('Unknown document type', 'requirementCode');
    if (requirement.expiryRequired && !dto.expiryDate)
      throw AppError.validation('An expiry date is required for this document', 'expiryDate');
    if (
      dto.expiryDate &&
      new Date(dto.expiryDate) < new Date(new Date().toISOString().slice(0, 10))
    )
      throw AppError.validation('This document has already expired', 'expiryDate');
    const file = await this.files.requireAvailable(dto.fileId, organizationId);
    if (file.kind !== 'DOCUMENT')
      throw new AppError('FILE_INVALID', 'This file was not uploaded as a document', 400, 'fileId');
    const doc = await this.prisma.$transaction(async (tx) => {
      if (dto.requirementCode !== 'OTHER') {
        await tx.merchantDocument.updateMany({
          where: {
            organizationId,
            requirementCode: dto.requirementCode,
            status: { not: 'SUPERSEDED' },
          },
          data: { status: 'SUPERSEDED' },
        });
      }
      const created = await tx.merchantDocument.create({
        data: {
          organizationId,
          requirementCode: dto.requirementCode,
          fileId: file.id,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
          uploadedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'merchant.document.uploaded',
          entityType: 'MerchantDocument',
          entityId: created.id,
          reason: dto.requirementCode,
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
      return created;
    });
    void agg;
    void doc;
    return this.detail(actor, organizationId);
  }

  async removeDocument(
    actor: Actor,
    organizationId: string,
    documentId: string,
    meta: RequestMeta,
  ) {
    await this.context(actor, organizationId, { editable: true });
    const doc = await this.prisma.merchantDocument.findFirst({
      where: { id: documentId, organizationId, status: { not: 'SUPERSEDED' } },
    });
    if (!doc) throw AppError.notFound();
    await this.prisma.merchantDocument.update({
      where: { id: doc.id },
      data: { status: 'SUPERSEDED' },
    });
    await this.audit.record({
      action: 'merchant.document.removed',
      entityType: 'MerchantDocument',
      entityId: doc.id,
      reason: doc.requirementCode,
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.detail(actor, organizationId);
  }

  // ------------------------------------------------------------------ mobile verification (applicant)
  async requestMobile(actor: Actor, organizationId: string, mobile: string, meta: RequestMeta) {
    await this.context(actor, organizationId, { editable: true });
    const taken = await this.prisma.user.findUnique({ where: { mobile } });
    if (taken && taken.id !== actor.userId)
      throw AppError.conflict(
        'EMAIL_TAKEN',
        'This mobile number is already used by another account',
      );
    return this.verify.send('MERCHANT_MOBILE', mobile, meta);
  }

  async verifyMobile(
    actor: Actor,
    organizationId: string,
    mobile: string,
    code: string,
    meta: RequestMeta,
  ) {
    await this.context(actor, organizationId, { editable: true });
    await this.verify.check('MERCHANT_MOBILE', mobile, code);
    await this.prisma.user.update({
      where: { id: actor.userId },
      data: { mobile, mobileVerifiedAt: new Date() },
    });
    await this.audit.record({
      action: 'merchant.mobile_verified',
      entityType: 'User',
      entityId: actor.userId,
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.detail(actor, organizationId);
  }

  // ------------------------------------------------------------------ agreement
  async acceptAgreement(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof agreementAcceptSchema>,
    meta: RequestMeta,
  ) {
    const agg = await this.context(actor, organizationId);
    const status = agg.application.status;
    const canSign =
      (agg.org.status === 'DRAFT' && this.read.isEditable(status)) ||
      (agg.org.status === 'DRAFT' && status === 'APPROVED');
    if (!canSign)
      throw new AppError(
        'APPLICATION_LOCKED',
        'The agreement cannot be signed in the current status',
        409,
      );
    const rep = agg.merchant.representative;
    if (!rep || !rep.isSignatory)
      throw new AppError(
        'SIGNATORY_ONLY',
        'Add the authorised representative who signs the agreement first',
        409,
      );
    if (!namesMatch(dto.signatureName, rep.fullName))
      throw new AppError(
        'SIGNATORY_ONLY',
        'Only the named authorised signatory can sign the agreement',
        403,
        'signatureName',
      );
    if (agg.acceptance) return this.detail(actor, organizationId);

    await this.prisma.$transaction(async (tx) => {
      await tx.agreementAcceptance.updateMany({
        where: { organizationId, status: 'ACCEPTED' },
        data: { status: 'SUPERSEDED' },
      });
      const acc = await tx.agreementAcceptance.create({
        data: {
          organizationId,
          agreementVersionId: agg.agreement.id,
          signatoryUserId: actor.userId,
          signatoryName: rep.fullName,
          signatoryRole: rep.role,
          signatoryIdLast4: rep.idReferenceLast4,
          entityLegalName: agg.merchant.legalName,
          signatureText: dto.signatureName,
          ip: meta.ip,
          userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
        },
      });
      await this.audit.record(
        {
          action: 'merchant.agreement.accepted',
          entityType: 'AgreementAcceptance',
          entityId: acc.id,
          reason: `v${agg.agreement.version}`,
          newState: { signatory: rep.fullName, version: agg.agreement.version },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
      // Approved earlier and waiting for the signature: signing activates the merchant (MR-05).
      if (status === 'APPROVED') {
        await tx.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE' } });
        await tx.merchant.update({ where: { organizationId }, data: { activatedAt: new Date() } });
        await this.audit.record(
          {
            action: 'merchant.activated',
            entityType: 'Organization',
            entityId: organizationId,
            reason: 'agreement signed after approval',
            actor,
            subjectOrganizationId: organizationId,
            meta,
          },
          tx,
        );
      }
    });
    return this.detail(actor, organizationId);
  }

  // ------------------------------------------------------------------ submit
  async submit(actor: Actor, organizationId: string, meta: RequestMeta) {
    const agg = await this.context(actor, organizationId, { editable: true });
    const completeness = await this.read.completeness(agg);
    const missing = completeness.filter((c) => !c.complete);
    if (missing.length) {
      throw new AppError(
        'APPLICATION_INCOMPLETE',
        `Complete these sections first: ${missing.map((m) => m.section).join(', ')}`,
        422,
      );
    }
    const version = agg.application.version + 1;
    const resubmission = agg.application.status === 'CHANGES_REQUESTED';
    await this.prisma.$transaction(async (tx) => {
      await tx.applicationSubmission.create({
        data: { applicationId: agg.application.id, version, snapshot: this.read.snapshot(agg) },
      });
      await tx.merchantApplication.update({
        where: { id: agg.application.id },
        data: {
          status: resubmission ? 'RESUBMITTED' : 'SUBMITTED',
          version,
          submittedAt: new Date(),
          requestedChanges: Prisma.DbNull,
          awaitingSecondReview: false,
          firstApproverUserId: null,
        },
      });
      await tx.applicationDecision.create({
        data: {
          applicationId: agg.application.id,
          decision: 'RESUBMITTED',
          message: resubmission ? 'Applicant resubmitted after changes' : 'Application submitted',
          decidedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: resubmission
            ? 'merchant.application.resubmitted'
            : 'merchant.application.submitted',
          entityType: 'MerchantApplication',
          entityId: agg.application.id,
          reason: `version ${version}`,
          previousState: { status: agg.application.status },
          newState: { status: resubmission ? 'RESUBMITTED' : 'SUBMITTED', version },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    return this.detail(actor, organizationId);
  }

  // ------------------------------------------------------------------ post-activation profile edits
  async updateProfile(
    actor: Actor,
    organizationId: string,
    dto: {
      tradeNameEn?: string;
      tradeNameAr?: string;
      descriptionEn?: string;
      descriptionAr?: string;
      businessPhone?: string;
      businessEmail?: string;
      subCategory?: string;
    },
    meta: RequestMeta,
  ) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (org.status !== 'ACTIVE')
      throw new AppError('ORG_NOT_ACTIVE', 'Profile changes are available after activation', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchant.update({ where: { organizationId }, data: dto });
      if (dto.tradeNameEn || dto.tradeNameAr) {
        await tx.organization.update({
          where: { id: organizationId },
          data: {
            ...(dto.tradeNameEn ? { nameEn: dto.tradeNameEn } : {}),
            ...(dto.tradeNameAr ? { nameAr: dto.tradeNameAr } : {}),
          },
        });
      }
      await this.audit.record(
        {
          action: 'merchant.profile.updated',
          entityType: 'Merchant',
          entityId: organizationId,
          newState: Object.keys(dto),
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    return { ok: true };
  }
}
