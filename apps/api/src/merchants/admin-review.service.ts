import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { CONFIG_KEYS, type MerchantRiskCriteria } from '@dealdash/config';
import { normalizeArabic } from '@dealdash/localization';
import type { ROLE_CODES } from '@dealdash/types';
import type {
  approveSchema,
  documentReviewSchema,
  rejectSchema,
  requestChangesSchema,
  riskTierSchema,
  suspendSchema,
  trustLevelSchema,
} from '@dealdash/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { keysetPage, Page, parseSort } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../providers/interfaces';
import { SystemConfigService } from '../system-config/system-config.service';
import { MerchantReadService, namesMatch } from './merchant-read.service';

type RoleCode = (typeof ROLE_CODES)[number];

const REVIEWABLE = ['SUBMITTED', 'RESUBMITTED', 'IN_REVIEW'] as const;

/** Admin merchant review workbench: every state change is transactional and audited with the actor and reason. */
@Injectable()
export class AdminReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly read: MerchantReadService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  // ------------------------------------------------------------------ lists
  async listMerchants(q: {
    limit: number;
    cursor?: string;
    status?: string;
    trust?: string;
    risk?: string;
    q?: string;
  }) {
    const where: Prisma.OrganizationWhereInput = {
      type: 'MERCHANT',
      ...(q.status ? { status: q.status as never } : {}),
      merchant: {
        ...(q.trust ? { trustLevel: q.trust as never } : {}),
        ...(q.risk ? { riskTier: q.risk as never } : {}),
      },
    };
    if (q.q) {
      const term = q.q.trim();
      const norm = normalizeArabic(term);
      where.OR = [
        { nameEn: { contains: term, mode: 'insensitive' } },
        { nameAr: { contains: term } },
        { nameAr: { contains: norm } },
        { merchant: { commercialRegistrationNumber: { contains: term } } },
        { application: { reference: { contains: term, mode: 'insensitive' } } },
      ];
    }
    const page = await keysetPage({
      findMany: (query) =>
        this.prisma.organization.findMany({
          ...query,
          include: { merchant: true, application: true, _count: { select: { branches: true } } },
        }),
      baseWhere: where as Record<string, unknown>,
      sort: parseSort(undefined, { field: 'createdAt', dir: 'desc' }),
      limit: q.limit,
      cursor: q.cursor,
    });
    const assignees = await this.userNames(page.items.map((o) => o.application?.assignedToUserId));
    return new Page(
      page.items.map((o) => this.row(o as never, assignees)),
      page.nextCursor,
    );
  }

  async queue(
    actor: Actor,
    q: { limit: number; cursor?: string; status?: string; risk?: string; assigned?: string },
  ) {
    const where: Prisma.MerchantApplicationWhereInput = {
      status: q.status
        ? (q.status as never)
        : { in: [...REVIEWABLE, 'CHANGES_REQUESTED'] as never },
      ...(q.risk ? { organization: { merchant: { riskTier: q.risk as never } } } : {}),
      ...(q.assigned === 'me' ? { assignedToUserId: actor.userId } : {}),
      ...(q.assigned === 'unassigned' ? { assignedToUserId: null } : {}),
    };
    const page = await keysetPage({
      findMany: (query) =>
        this.prisma.merchantApplication.findMany({
          ...query,
          include: {
            organization: { include: { merchant: true, _count: { select: { branches: true } } } },
          },
        }),
      baseWhere: where as Record<string, unknown>,
      sort: parseSort(undefined, { field: 'createdAt', dir: 'asc' }),
      limit: q.limit,
      cursor: q.cursor,
    });
    const assignees = await this.userNames(page.items.map((a) => a.assignedToUserId));
    return new Page(
      page.items.map((a) => this.row({ ...a.organization, application: a } as never, assignees)),
      page.nextCursor,
    );
  }

  private row(
    o: {
      id: string;
      nameEn: string;
      nameAr: string;
      status: string;
      createdAt: Date;
      merchant: { trustLevel: string; riskTier: string } | null;
      application: {
        status: string;
        reference: string;
        submittedAt: Date | null;
        assignedToUserId: string | null;
      } | null;
      _count?: { branches: number };
    },
    assignees: Map<string, string>,
  ) {
    return {
      organizationId: o.id,
      tradeNameEn: o.nameEn,
      tradeNameAr: o.nameAr,
      status: o.status as 'DRAFT' | 'ACTIVE' | 'SUSPENDED',
      trustLevel: (o.merchant?.trustLevel ?? 'NEW') as 'NEW' | 'STANDARD' | 'TRUSTED',
      riskTier: (o.merchant?.riskTier ?? 'STANDARD') as 'STANDARD' | 'ENHANCED',
      applicationStatus: (o.application?.status ?? null) as never,
      reference: o.application?.reference ?? null,
      branches: o._count?.branches ?? 0,
      submittedAt: o.application?.submittedAt?.toISOString() ?? null,
      assignedTo: o.application?.assignedToUserId
        ? (assignees.get(o.application.assignedToUserId) ?? null)
        : null,
      createdAt: o.createdAt.toISOString(),
    };
  }

  private async userNames(ids: Array<string | null | undefined>) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((u) => [u.id, u.displayName]));
  }

  // ------------------------------------------------------------------ detail
  async detail(organizationId: string) {
    const agg = await this.read.loadAggregate(organizationId);
    const app = agg.application;
    const [decisions, notes, submissions, users, acceptances, auditRows, dup] = await Promise.all([
      this.prisma.applicationDecision.findMany({
        where: { applicationId: app.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.applicationNote.findMany({
        where: { applicationId: app.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.applicationSubmission.findMany({
        where: { applicationId: app.id },
        orderBy: { version: 'desc' },
        take: 2,
      }),
      this.prisma.organizationMembership.findMany({
        where: { organizationId },
        include: { user: true, role: true, branch: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.agreementAcceptance.findMany({
        where: { organizationId },
        include: { version: true },
        orderBy: { acceptedAt: 'desc' },
      }),
      this.prisma.auditLog.findMany({
        where: {
          OR: [{ subjectOrganizationId: organizationId }, { actorOrganizationId: organizationId }],
        },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      }),
      agg.merchant.commercialRegistrationNumber
        ? this.prisma.merchant.count({
            where: {
              commercialRegistrationNumber: agg.merchant.commercialRegistrationNumber,
              organizationId: { not: organizationId },
            },
          })
        : Promise.resolve(0),
    ]);
    const names = await this.userNames([
      app.assignedToUserId,
      app.firstApproverUserId,
      ...decisions.map((d) => d.decidedByUserId),
      ...notes.map((n) => n.authorUserId),
    ]);

    const documents = await Promise.all(
      this.read.documentViews(agg.documents).map(async (d) => ({
        ...d,
        url: (await this.files.urlOrNull(d.fileId, organizationId)) ?? '',
      })),
    );

    let changed: string[] = [];
    if (submissions.length === 2) {
      const [cur, prev] = [
        submissions[0]!.snapshot as Record<string, string>,
        submissions[1]!.snapshot as Record<string, string>,
      ];
      changed = [...new Set([...Object.keys(cur), ...Object.keys(prev)])]
        .filter((k) => cur[k] !== prev[k])
        .sort();
    }

    return {
      organizationId,
      organizationStatus: agg.org.status,
      trustLevel: agg.merchant.trustLevel,
      suspendedReason: agg.merchant.suspendedReason,
      application: {
        ...this.read.applicationView(app, agg.merchant.riskTier),
        assignedTo: app.assignedToUserId ? (names.get(app.assignedToUserId) ?? null) : null,
        assignedToUserId: app.assignedToUserId,
        firstApproverUserId: app.firstApproverUserId,
      },
      business: await this.read.businessView(agg.merchant, organizationId),
      category:
        (await this.read.categories()).find((c) => c.code === agg.merchant.categoryCode) ?? null,
      representative: this.read.representativeView(agg.merchant.representative),
      settlement: this.read.settlementView(agg.merchant.settlement, [
        agg.merchant.legalName,
        agg.merchant.legalNameAr ?? '',
      ]),
      documents,
      requirements: await this.read.requirements(),
      branches: this.read.branchViews(agg.branches),
      users: users.map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        name: m.user.displayName,
        email: m.user.email,
        mobile: m.user.mobile,
        roleCode: m.role.code as RoleCode,
        branchId: m.branchId,
        branchName: m.branch?.nameEn ?? null,
        status: (m.status === 'ACTIVE'
          ? m.user.status === 'INVITED'
            ? 'INVITED'
            : 'ACTIVE'
          : 'DEACTIVATED') as 'ACTIVE' | 'INVITED' | 'DEACTIVATED',
        lastActiveAt: m.user.lastLoginAt?.toISOString() ?? null,
      })),
      acceptances: acceptances.map((a) => ({
        id: a.id,
        agreementVersion: a.version.version,
        signatoryName: a.signatoryName,
        signatoryRole: a.signatoryRole,
        entityLegalName: a.entityLegalName,
        acceptedAt: a.acceptedAt.toISOString(),
        status: a.status,
        method: a.method,
      })),
      currentAgreementVersion: agg.agreement.version,
      completeness: await this.read.completeness(agg),
      decisions: decisions.map((d) => ({
        id: d.id,
        decision: d.decision,
        message: d.message,
        messageAr: d.messageAr,
        sections: d.sections as string[],
        decidedBy: d.decidedByUserId ? (names.get(d.decidedByUserId) ?? 'Unknown') : 'Applicant',
        at: d.createdAt.toISOString(),
      })),
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        author: names.get(n.authorUserId) ?? 'Unknown',
        at: n.createdAt.toISOString(),
      })),
      riskSuggestion: await this.suggestRisk(agg),
      changedSinceLastSubmission: changed,
      duplicateRegistrationNumber: dup > 0,
      audit: auditRows.map((a) => ({
        id: a.id,
        occurredAt: a.occurredAt.toISOString(),
        action: a.action,
        actorRole: a.actorRole,
        actorUserId: a.actorUserId,
        reason: a.reason,
        entityType: a.entityType,
      })),
    };
  }

  /** Suggestion only: a reviewer must set the tier. Criteria are configuration (MOCK), not a legal rule. */
  private async suggestRisk(agg: Awaited<ReturnType<MerchantReadService['loadAggregate']>>) {
    const crit = await this.config.get<MerchantRiskCriteria>(CONFIG_KEYS.MERCHANT_RISK_CRITERIA);
    const reasons: string[] = [];
    if (agg.merchant.categoryCode && crit.enhancedCategories.includes(agg.merchant.categoryCode))
      reasons.push('Category flagged for enhanced review');
    const s = agg.merchant.settlement;
    if (
      crit.ibanNameMismatchSuggestsEnhanced &&
      s &&
      !namesMatch(s.accountHolderName, agg.merchant.legalName) &&
      !(agg.merchant.legalNameAr && namesMatch(s.accountHolderName, agg.merchant.legalNameAr))
    ) {
      reasons.push('Bank account holder differs from the legal business name');
    }
    if (crit.rejectedDocumentSuggestsEnhanced && agg.documents.some((d) => d.status === 'REJECTED'))
      reasons.push('A document was rejected during review');
    return {
      suggestedTier: (reasons.length ? 'ENHANCED' : 'STANDARD') as 'STANDARD' | 'ENHANCED',
      reasons,
    };
  }

  // ------------------------------------------------------------------ helpers
  private async load(organizationId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, type: 'MERCHANT' },
      include: { application: true, merchant: true },
    });
    if (!org?.application || !org.merchant) throw AppError.notFound();
    return { org, app: org.application, merchant: org.merchant };
  }

  private requireReviewable(status: string) {
    if (!(REVIEWABLE as readonly string[]).includes(status)) {
      throw new AppError('INVALID_STATE', 'This application is not awaiting review', 409);
    }
  }

  private async notify(organizationId: string, subject: string, body: string) {
    const owner = await this.prisma.organizationMembership.findFirst({
      where: { organizationId, role: { code: 'MERCHANT_OWNER' } },
      include: { user: true },
    });
    if (owner?.user.email)
      await this.email.send({
        to: owner.user.email,
        templateKey: 'merchant.application_update',
        subject,
        body,
        locale: (owner.user.locale as 'en' | 'ar') ?? 'en',
      });
  }

  // ------------------------------------------------------------------ workflow
  async claim(actor: Actor, organizationId: string, meta: RequestMeta) {
    const { app } = await this.load(organizationId);
    this.requireReviewable(app.status);
    if (
      app.assignedToUserId &&
      app.assignedToUserId !== actor.userId &&
      app.status === 'IN_REVIEW'
    ) {
      throw new AppError(
        'INVALID_STATE',
        'This application is already assigned to another reviewer',
        409,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.merchantApplication.update({
        where: { id: app.id },
        data: { status: 'IN_REVIEW', assignedToUserId: actor.userId },
      });
      await tx.applicationDecision.create({
        data: { applicationId: app.id, decision: 'CLAIMED', decidedByUserId: actor.userId },
      });
      await this.audit.record(
        {
          action: 'merchant.application.claimed',
          entityType: 'MerchantApplication',
          entityId: app.id,
          previousState: { status: app.status },
          newState: { status: 'IN_REVIEW' },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    return this.detail(organizationId);
  }

  /** Hands the application back to the queue (reviewer unavailable, or a second reviewer is needed). */
  async release(actor: Actor, organizationId: string, meta: RequestMeta) {
    const { app } = await this.load(organizationId);
    this.requireReviewable(app.status);
    if (app.assignedToUserId !== actor.userId)
      throw new AppError(
        'INVALID_STATE',
        'Only the assigned reviewer can release this application',
        409,
      );
    await this.prisma.merchantApplication.update({
      where: { id: app.id },
      data: { assignedToUserId: null },
    });
    await this.audit.record({
      action: 'merchant.application.released',
      entityType: 'MerchantApplication',
      entityId: app.id,
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.detail(organizationId);
  }
  private requireAssignee(actor: Actor, app: { status: string; assignedToUserId: string | null }) {
    this.requireReviewable(app.status);
    if (app.status !== 'IN_REVIEW' || app.assignedToUserId !== actor.userId) {
      throw new AppError('INVALID_STATE', 'Claim this application before making a decision', 409);
    }
  }

  async reviewDocument(
    actor: Actor,
    organizationId: string,
    documentId: string,
    dto: z.infer<typeof documentReviewSchema>,
    meta: RequestMeta,
  ) {
    const { app } = await this.load(organizationId);
    this.requireAssignee(actor, app);
    const doc = await this.prisma.merchantDocument.findFirst({
      where: { id: documentId, organizationId, status: { not: 'SUPERSEDED' } },
    });
    if (!doc) throw AppError.notFound();
    if (dto.decision === 'REJECT' && !dto.note)
      throw AppError.validation('A reason is required when rejecting a document', 'note');
    await this.prisma.merchantDocument.update({
      where: { id: doc.id },
      data: {
        status: dto.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
        reviewerNote: dto.note ?? null,
        reviewedByUserId: actor.userId,
        reviewedAt: new Date(),
      },
    });
    await this.audit.record({
      action:
        dto.decision === 'ACCEPT' ? 'merchant.document.accepted' : 'merchant.document.rejected',
      entityType: 'MerchantDocument',
      entityId: doc.id,
      reason: dto.note ?? doc.requirementCode,
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.detail(organizationId);
  }

  async requestChanges(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof requestChangesSchema>,
    meta: RequestMeta,
  ) {
    const { app } = await this.load(organizationId);
    this.requireAssignee(actor, app);
    await this.prisma.$transaction(async (tx) => {
      const payload = {
        sections: dto.sections,
        documentIds: dto.documentIds,
        message: dto.message,
        messageAr: dto.messageAr ?? null,
        at: new Date().toISOString(),
      };
      await tx.merchantApplication.update({
        where: { id: app.id },
        data: {
          status: 'CHANGES_REQUESTED',
          requestedChanges: payload,
          awaitingSecondReview: false,
          firstApproverUserId: null,
        },
      });
      if (dto.documentIds.length) {
        await tx.merchantDocument.updateMany({
          where: { organizationId, id: { in: dto.documentIds }, status: { not: 'SUPERSEDED' } },
          data: {
            status: 'REJECTED',
            reviewerNote: dto.message,
            reviewedByUserId: actor.userId,
            reviewedAt: new Date(),
          },
        });
      }
      await tx.applicationDecision.create({
        data: {
          applicationId: app.id,
          decision: 'REQUEST_CHANGES',
          message: dto.message,
          messageAr: dto.messageAr ?? null,
          sections: dto.sections,
          documentIds: dto.documentIds,
          decidedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'merchant.application.changes_requested',
          entityType: 'MerchantApplication',
          entityId: app.id,
          reason: dto.message,
          previousState: { status: app.status },
          newState: { status: 'CHANGES_REQUESTED', sections: dto.sections },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    await this.notify(
      organizationId,
      'DealDash: changes requested on your application',
      `Our team asked for changes: ${dto.message}`,
    );
    return this.detail(organizationId);
  }

  async approve(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof approveSchema>,
    meta: RequestMeta,
  ) {
    const { app, merchant } = await this.load(organizationId);
    this.requireAssignee(actor, app);
    const agg = await this.read.loadAggregate(organizationId);
    const gaps = (await this.read.completeness(agg)).filter((c) => !c.complete);
    if (gaps.length)
      throw new AppError(
        'APPLICATION_INCOMPLETE',
        `Cannot approve: ${gaps.map((g) => g.section).join(', ')} incomplete`,
        422,
      );
    const pending = agg.documents.filter((d) => d.status === 'UPLOADED' || d.status === 'REJECTED');
    if (pending.length)
      throw new AppError(
        'INVALID_STATE',
        'Review every document before approving (accept or replace each one)',
        409,
      );

    // Enhanced tier: two different reviewers must approve.
    if (merchant.riskTier === 'ENHANCED') {
      if (!app.firstApproverUserId) {
        await this.prisma.$transaction(async (tx) => {
          await tx.merchantApplication.update({
            where: { id: app.id },
            data: {
              awaitingSecondReview: true,
              firstApproverUserId: actor.userId,
              assignedToUserId: null,
              status: 'IN_REVIEW',
            },
          });
          await tx.applicationDecision.create({
            data: {
              applicationId: app.id,
              decision: 'APPROVE_RECOMMENDED',
              message: dto.note ?? null,
              decidedByUserId: actor.userId,
            },
          });
          await this.audit.record(
            {
              action: 'merchant.application.first_approval',
              entityType: 'MerchantApplication',
              entityId: app.id,
              reason: dto.note ?? 'enhanced review: awaiting second reviewer',
              actor,
              subjectOrganizationId: organizationId,
              meta,
            },
            tx,
          );
        });
        return this.detail(organizationId);
      }
      if (app.firstApproverUserId === actor.userId) {
        throw new AppError(
          'SECOND_REVIEW_REQUIRED',
          'Enhanced review needs a second, different reviewer to give the final approval',
          409,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const activate = !!agg.acceptance;
      await tx.merchantApplication.update({
        where: { id: app.id },
        data: {
          status: 'APPROVED',
          decidedAt: new Date(),
          decidedByUserId: actor.userId,
          awaitingSecondReview: false,
        },
      });
      if (activate) {
        await tx.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE' } });
        await tx.merchant.update({ where: { organizationId }, data: { activatedAt: new Date() } });
      }
      await tx.applicationDecision.create({
        data: {
          applicationId: app.id,
          decision: 'APPROVE',
          message: dto.note ?? null,
          decidedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'merchant.application.approved',
          entityType: 'MerchantApplication',
          entityId: app.id,
          reason: dto.note ?? null,
          previousState: { status: app.status },
          newState: { status: 'APPROVED', organizationStatus: activate ? 'ACTIVE' : 'DRAFT' },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
      if (activate)
        await this.audit.record(
          {
            action: 'merchant.activated',
            entityType: 'Organization',
            entityId: organizationId,
            reason: 'approved with current agreement accepted',
            actor,
            subjectOrganizationId: organizationId,
            meta,
          },
          tx,
        );
    });
    await this.notify(
      organizationId,
      'DealDash: your merchant application was approved',
      'Congratulations. Your DealDash merchant account is approved.',
    );
    return this.detail(organizationId);
  }

  async reject(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof rejectSchema>,
    meta: RequestMeta,
  ) {
    const { app } = await this.load(organizationId);
    this.requireAssignee(actor, app);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchantApplication.update({
        where: { id: app.id },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          decidedByUserId: actor.userId,
          rejectionReason: dto.reason,
          rejectionReasonAr: dto.reasonAr ?? null,
          appealable: dto.appealable,
          awaitingSecondReview: false,
          firstApproverUserId: null,
        },
      });
      await tx.applicationDecision.create({
        data: {
          applicationId: app.id,
          decision: 'REJECT',
          message: dto.reason,
          messageAr: dto.reasonAr ?? null,
          decidedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'merchant.application.rejected',
          entityType: 'MerchantApplication',
          entityId: app.id,
          reason: dto.reason,
          previousState: { status: app.status },
          newState: { status: 'REJECTED', appealable: dto.appealable },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    await this.notify(
      organizationId,
      'DealDash: update on your merchant application',
      `Your application was not approved. Reason: ${dto.reason}`,
    );
    return this.detail(organizationId);
  }

  // ------------------------------------------------------------------ lifecycle & trust
  async suspend(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof suspendSchema>,
    meta: RequestMeta,
  ) {
    const { org } = await this.load(organizationId);
    if (org.status !== 'ACTIVE')
      throw new AppError('INVALID_STATE', 'Only an active merchant can be suspended', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: { status: 'SUSPENDED' },
      });
      await tx.merchant.update({
        where: { organizationId },
        data: { suspendedReason: dto.reason, suspendedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'merchant.suspended',
          entityType: 'Organization',
          entityId: organizationId,
          reason: dto.reason,
          previousState: { status: 'ACTIVE' },
          newState: { status: 'SUSPENDED' },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    await this.notify(
      organizationId,
      'DealDash: your merchant account is suspended',
      `Your account was suspended. Reason: ${dto.reason}`,
    );
    return this.detail(organizationId);
  }

  async reactivate(
    actor: Actor,
    organizationId: string,
    dto: { reason: string },
    meta: RequestMeta,
  ) {
    const { org } = await this.load(organizationId);
    if (org.status !== 'SUSPENDED')
      throw new AppError('INVALID_STATE', 'Only a suspended merchant can be reactivated', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: organizationId }, data: { status: 'ACTIVE' } });
      await tx.merchant.update({
        where: { organizationId },
        data: { suspendedReason: null, suspendedAt: null },
      });
      await this.audit.record(
        {
          action: 'merchant.reactivated',
          entityType: 'Organization',
          entityId: organizationId,
          reason: dto.reason,
          previousState: { status: 'SUSPENDED' },
          newState: { status: 'ACTIVE' },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    await this.notify(
      organizationId,
      'DealDash: your merchant account is active again',
      'Your account has been reactivated.',
    );
    return this.detail(organizationId);
  }

  async setRiskTier(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof riskTierSchema>,
    meta: RequestMeta,
  ) {
    const { app, merchant } = await this.load(organizationId);
    if (merchant.riskTier === dto.tier) return this.detail(organizationId);
    await this.prisma.$transaction(async (tx) => {
      await tx.merchant.update({ where: { organizationId }, data: { riskTier: dto.tier } });
      // Changing the tier resets any first approval: the new tier's rule applies from scratch.
      await tx.merchantApplication.update({
        where: { id: app.id },
        data: { awaitingSecondReview: false, firstApproverUserId: null },
      });
      await tx.applicationDecision.create({
        data: {
          applicationId: app.id,
          decision: 'RISK_TIER_CHANGED',
          message: dto.reason,
          decidedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'merchant.risk_tier.changed',
          entityType: 'Merchant',
          entityId: organizationId,
          reason: dto.reason,
          previousState: { riskTier: merchant.riskTier },
          newState: { riskTier: dto.tier },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    return this.detail(organizationId);
  }

  async setTrustLevel(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof trustLevelSchema>,
    meta: RequestMeta,
  ) {
    const { merchant } = await this.load(organizationId);
    if (merchant.trustLevel === dto.level) return this.detail(organizationId);
    await this.prisma.merchant.update({
      where: { organizationId },
      data: { trustLevel: dto.level },
    });
    await this.audit.record({
      action: 'merchant.trust_level.changed',
      entityType: 'Merchant',
      entityId: organizationId,
      reason: dto.reason,
      previousState: { trustLevel: merchant.trustLevel },
      newState: { trustLevel: dto.level },
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.detail(organizationId);
  }

  async addNote(actor: Actor, organizationId: string, body: string, meta: RequestMeta) {
    const { app } = await this.load(organizationId);
    const note = await this.prisma.applicationNote.create({
      data: { applicationId: app.id, authorUserId: actor.userId, body },
    });
    await this.audit.record({
      action: 'merchant.note.added',
      entityType: 'ApplicationNote',
      entityId: note.id,
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.detail(organizationId);
  }

  async verifyBank(
    actor: Actor,
    organizationId: string,
    note: string | undefined,
    meta: RequestMeta,
  ) {
    const { merchant } = await this.load(organizationId);
    const s = await this.prisma.merchantSettlementAccount.findUnique({ where: { organizationId } });
    if (!s) throw new AppError('INVALID_STATE', 'No settlement account on file', 409);
    await this.prisma.merchantSettlementAccount.update({
      where: { organizationId },
      data: {
        verificationStatus: 'VERIFIED',
        verifiedByUserId: actor.userId,
        verifiedAt: new Date(),
      },
    });
    await this.audit.record({
      action: 'merchant.settlement.verified',
      entityType: 'MerchantSettlementAccount',
      entityId: organizationId,
      reason: note ?? 'manual verification (no bank verification service integrated)',
      newState: { ibanMasked: s.ibanMasked },
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    void merchant;
    return this.detail(organizationId);
  }

  async auditTrail(organizationId: string, q: { limit: number; cursor?: string }) {
    await this.load(organizationId);
    const page = await keysetPage({
      findMany: (query) => this.prisma.auditLog.findMany(query),
      baseWhere: {
        OR: [{ subjectOrganizationId: organizationId }, { actorOrganizationId: organizationId }],
      },
      sort: { field: 'occurredAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    return new Page(
      page.items.map((a) => ({
        id: a.id,
        occurredAt: a.occurredAt.toISOString(),
        action: a.action,
        actorRole: a.actorRole,
        actorUserId: a.actorUserId,
        reason: a.reason,
        entityType: a.entityType,
      })),
      page.nextCursor,
    );
  }
}
