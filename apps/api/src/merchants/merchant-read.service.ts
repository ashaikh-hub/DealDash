import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS, type DocumentRequirementConfig } from '@dealdash/config';
import { APPLICATION_EDITABLE, type ApplicationSection } from '@dealdash/types';
import { normalizeArabic } from '@dealdash/localization';
import { FilesService } from '../files/files.service';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

export const nameKey = (v: string) =>
  normalizeArabic(v.normalize('NFKC').toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, '');
export const namesMatch = (a: string, b: string) => nameKey(a) !== '' && nameKey(a) === nameKey(b);

export interface Completeness {
  section: ApplicationSection | 'VERIFICATION';
  complete: boolean;
  issues: string[];
}

/** Builds merchant application views and the completeness checklist. Read-only; shared by Merchant and Admin. */
@Injectable()
export class MerchantReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly files: FilesService,
  ) {}

  async currentAgreement() {
    const a = await this.prisma.agreementVersion.findFirst({
      where: { kind: 'MERCHANT', active: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!a) throw new AppError('SERVICE_UNAVAILABLE', 'No merchant agreement is configured', 503);
    return a;
  }

  async requirements(): Promise<DocumentRequirementConfig[]> {
    return this.config.get<DocumentRequirementConfig[]>(CONFIG_KEYS.MERCHANT_DOCUMENT_REQUIREMENTS);
  }

  async categories() {
    return this.config.get<Array<{ code: string; nameEn: string; nameAr: string }>>(
      CONFIG_KEYS.MERCHANT_CATEGORIES,
    );
  }

  async loadAggregate(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: {
        merchant: { include: { representative: true, settlement: true } },
        application: true,
        branches: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!org || org.type !== 'MERCHANT' || !org.merchant || !org.application)
      throw AppError.notFound();
    const documents = await this.prisma.merchantDocument.findMany({
      where: { organizationId },
      include: { file: true },
      orderBy: { createdAt: 'asc' },
    });
    const agreement = await this.currentAgreement();
    const acceptance = await this.prisma.agreementAcceptance.findFirst({
      where: { organizationId, agreementVersionId: agreement.id, status: 'ACCEPTED' },
      orderBy: { acceptedAt: 'desc' },
    });
    const owner = await this.prisma.organizationMembership.findFirst({
      where: { organizationId, role: { code: 'MERCHANT_OWNER' }, status: 'ACTIVE' },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      org,
      merchant: org.merchant,
      application: org.application,
      branches: org.branches,
      documents,
      agreement,
      acceptance,
      owner: owner?.user ?? null,
    };
  }

  // ------------------------------------------------------------------ completeness checklist (the Submit gate)
  async completeness(
    agg: Awaited<ReturnType<MerchantReadService['loadAggregate']>>,
  ): Promise<Completeness[]> {
    const m = agg.merchant;
    const reqs = await this.requirements();
    const cats = await this.categories();
    const issues = (section: Completeness['section'], list: string[]): Completeness => ({
      section,
      complete: list.length === 0,
      issues: list,
    });

    const business: string[] = [];
    if (!m.legalName) business.push('Legal business name (English)');
    if (!m.legalNameAr) business.push('Legal business name (Arabic)');
    if (!m.tradeNameEn || !m.tradeNameAr) business.push('Trade name in English and Arabic');
    if (!m.commercialRegistrationNumber) business.push('Commercial registration number');
    if (!m.registeredAddress) business.push('Registered address');

    const live = agg.documents.filter((d) => d.status !== 'SUPERSEDED');
    const docs: string[] = [];
    for (const r of reqs.filter((x) => x.required)) {
      const d = live.find((x) => x.requirementCode === r.code && x.status !== 'REJECTED');
      if (!d) docs.push(`${r.nameEn}: upload required`);
      else if (r.expiryRequired && !d.expiryDate) docs.push(`${r.nameEn}: expiry date required`);
    }
    for (const d of live.filter((x) => x.status === 'REJECTED'))
      docs.push(
        `${d.file.originalName}: rejected, upload a replacement${d.reviewerNote ? ` (${d.reviewerNote})` : ''}`,
      );

    const rep: string[] = agg.merchant.representative ? [] : ['Authorised representative details'];
    if (agg.merchant.representative && !agg.merchant.representative.isSignatory)
      rep.push('The representative must be the person who signs the agreement');

    const category: string[] = [];
    if (!m.categoryCode || !cats.some((c) => c.code === m.categoryCode))
      category.push('Business category');
    if (!m.descriptionEn || !m.descriptionAr) category.push('Description in English and Arabic');
    if (!m.logoFileId) category.push('Logo');
    if (!m.coverFileId) category.push('Cover image');

    const branches: string[] = [];
    const active = agg.branches.filter((b) => b.status === 'ACTIVE');
    if (active.length === 0) branches.push('At least one branch');
    for (const b of active) {
      if (b.latitude === null || b.longitude === null) branches.push(`${b.nameEn}: map location`);
      if (!b.hours) branches.push(`${b.nameEn}: opening hours`);
    }

    const settlement: string[] = [];
    const s = agg.merchant.settlement;
    if (!s) settlement.push('Settlement bank details');
    else if (
      !namesMatch(s.accountHolderName, m.legalName) &&
      !(m.legalNameAr && namesMatch(s.accountHolderName, m.legalNameAr))
    ) {
      settlement.push('Account holder name must match the legal business name');
    }

    const agreement: string[] = agg.acceptance
      ? []
      : [`Accept agreement version ${agg.agreement.version}`];

    const verification: string[] = [];
    if (!agg.owner?.emailVerifiedAt) verification.push('Email verification');
    if (!agg.owner?.mobileVerifiedAt) verification.push('Mobile verification');

    return [
      issues('BUSINESS', business),
      issues('DOCUMENTS', docs),
      issues('REPRESENTATIVE', rep),
      issues('CATEGORY', category),
      issues('BRANCHES', branches),
      issues('SETTLEMENT', settlement),
      issues('AGREEMENT', agreement),
      issues('VERIFICATION', verification),
    ];
  }

  // ------------------------------------------------------------------ view builders
  applicationView(
    a: Awaited<ReturnType<MerchantReadService['loadAggregate']>>['application'],
    riskTier: string,
  ) {
    const rc = a.requestedChanges as null | {
      sections: string[];
      documentIds: string[];
      message: string;
      messageAr?: string | null;
      at: string;
    };
    return {
      id: a.id,
      reference: a.reference,
      status: a.status,
      version: a.version,
      submittedAt: a.submittedAt?.toISOString() ?? null,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      riskTier: riskTier as 'STANDARD' | 'ENHANCED',
      awaitingSecondReview: a.awaitingSecondReview,
      rejectionReason: a.rejectionReason,
      rejectionReasonAr: a.rejectionReasonAr,
      appealable: a.appealable,
      requestedChanges:
        a.status === 'CHANGES_REQUESTED' && rc
          ? {
              sections: rc.sections as never,
              documentIds: rc.documentIds,
              message: rc.message,
              messageAr: rc.messageAr ?? null,
              at: rc.at,
            }
          : null,
    };
  }

  async businessView(
    m: Awaited<ReturnType<MerchantReadService['loadAggregate']>>['merchant'],
    organizationId: string,
  ) {
    return {
      legalNameEn: m.legalName || null,
      legalNameAr: m.legalNameAr,
      tradeNameEn: m.tradeNameEn,
      tradeNameAr: m.tradeNameAr,
      commercialRegistrationNumber: m.commercialRegistrationNumber,
      taxNumber: m.taxNumber,
      businessType: m.businessType,
      registeredAddress: m.registeredAddress,
      businessPhone: m.businessPhone,
      businessEmail: m.businessEmail,
      categoryCode: m.categoryCode,
      subCategory: m.subCategory,
      descriptionEn: m.descriptionEn,
      descriptionAr: m.descriptionAr,
      logoFileId: m.logoFileId,
      coverFileId: m.coverFileId,
      galleryFileIds: (m.galleryFileIds as string[]) ?? [],
      logoUrl: await this.files.urlOrNull(m.logoFileId, organizationId),
      coverUrl: await this.files.urlOrNull(m.coverFileId, organizationId),
    };
  }

  representativeView(
    r: NonNullable<
      Awaited<ReturnType<MerchantReadService['loadAggregate']>>['merchant']['representative']
    > | null,
  ) {
    return r
      ? {
          fullName: r.fullName,
          role: r.role,
          idReferenceMasked: `••••${r.idReferenceLast4}`,
          mobile: r.mobile,
          email: r.email,
          isSignatory: r.isSignatory,
        }
      : null;
  }

  settlementView(
    s: Awaited<ReturnType<MerchantReadService['loadAggregate']>>['merchant']['settlement'],
    legalNames: string[],
  ) {
    return s
      ? {
          bankName: s.bankName,
          ibanMasked: s.ibanMasked,
          accountHolderName: s.accountHolderName,
          nameMatches: legalNames.some((n) => n && namesMatch(s.accountHolderName, n)),
          verificationStatus: s.verificationStatus as 'UNVERIFIED' | 'VERIFIED',
          payoutHold: s.payoutHold,
        }
      : null;
  }

  documentViews(docs: Awaited<ReturnType<MerchantReadService['loadAggregate']>>['documents']) {
    return docs
      .filter((d) => d.status !== 'SUPERSEDED')
      .map((d) => ({
        id: d.id,
        requirementCode: d.requirementCode,
        fileId: d.fileId,
        fileName: d.file.originalName,
        mimeType: d.file.mimeType,
        sizeBytes: d.file.sizeBytes ?? 0,
        expiryDate: d.expiryDate ? d.expiryDate.toISOString().slice(0, 10) : null,
        status: d.status,
        reviewerNote: d.reviewerNote,
        uploadedAt: d.createdAt.toISOString(),
      }));
  }

  branchViews(branches: Awaited<ReturnType<MerchantReadService['loadAggregate']>>['branches']) {
    return branches.map((b) => ({
      id: b.id,
      nameEn: b.nameEn,
      nameAr: b.nameAr,
      addressEn: b.addressEn,
      addressAr: b.addressAr,
      city: b.city,
      latitude: b.latitude === null ? null : Number(b.latitude),
      longitude: b.longitude === null ? null : Number(b.longitude),
      phone: b.phone,
      status: b.status,
      hours: b.hours ?? null,
      holidayHours: b.holidayHours ?? null,
    }));
  }

  /** Flat, non-sensitive snapshot stored at each submission to show what changed on resubmission. */
  snapshot(agg: Awaited<ReturnType<MerchantReadService['loadAggregate']>>): Record<string, string> {
    const m = agg.merchant;
    const r = m.representative;
    const s = m.settlement;
    const flat: Record<string, string> = {
      'business.legalNameEn': m.legalName ?? '',
      'business.legalNameAr': m.legalNameAr ?? '',
      'business.tradeNameEn': m.tradeNameEn ?? '',
      'business.tradeNameAr': m.tradeNameAr ?? '',
      'business.registrationNumber': m.commercialRegistrationNumber ?? '',
      'business.taxNumber': m.taxNumber ?? '',
      'business.address': m.registeredAddress ?? '',
      'category.code': m.categoryCode ?? '',
      'category.descriptionEn': m.descriptionEn ?? '',
      'category.descriptionAr': m.descriptionAr ?? '',
      'category.logo': m.logoFileId ?? '',
      'category.cover': m.coverFileId ?? '',
      'representative.name': r?.fullName ?? '',
      'representative.role': r?.role ?? '',
      'representative.mobile': r?.mobile ?? '',
      'representative.email': r?.email ?? '',
      'settlement.bank': s?.bankName ?? '',
      'settlement.iban': s?.ibanMasked ?? '',
      'settlement.holder': s?.accountHolderName ?? '',
      'agreement.accepted': agg.acceptance ? agg.agreement.version : '',
    };
    for (const d of agg.documents.filter((x) => x.status !== 'SUPERSEDED'))
      flat[`documents.${d.requirementCode}.${d.id.slice(0, 8)}`] =
        `${d.file.originalName}:${d.status}`;
    for (const b of agg.branches)
      flat[`branches.${b.id.slice(0, 8)}`] =
        `${b.nameEn}|${b.status}|${b.latitude}|${b.longitude}|${JSON.stringify(b.hours ?? null)}`;
    return flat;
  }

  isEditable(status: string) {
    return (APPLICATION_EDITABLE as readonly string[]).includes(status);
  }
}
