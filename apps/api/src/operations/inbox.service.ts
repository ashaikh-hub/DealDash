import { Injectable } from '@nestjs/common';
import { CASE_OPEN_STATUSES, RECON_EXCEPTION_STATUSES, type PermissionCode } from '@dealdash/types';
import { PrismaService } from '../prisma/prisma.service';

export type InboxPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface InboxItem {
  /** Screens translate `kind`; `title` is only the English fallback line. */
  kind: string;
  title: string;
  /** What the task is about: the campaign, rule, file, field or case reference. */
  subject: string | null;
  /** A machine code the screen can translate (for example SLA_MISSED), never free text. */
  detail: string | null;
  priority: InboxPriority;
  organizationId: string | null;
  entityType: string;
  entityId: string;
  dueAt: string | null;
  createdAt: string;
  /** Permission a viewer needs to see and act on it. */
  requiredPermission: PermissionCode;
}

const RANK: Record<InboxPriority, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const byUrgency = (a: InboxItem, b: InboxItem) =>
  RANK[a.priority] - RANK[b.priority] || a.createdAt.localeCompare(b.createdAt);

/**
 * The task inbox. Most tasks are DERIVED from state that already exists (a campaign waiting for review, a rule waiting for
 * approval, an overdue case), so they can never go stale or be forgotten; only tasks with no home of their own are stored
 * (ApprovalTask). Each task carries the permission needed to see it, so an inbox never shows what the viewer could not act on.
 * Snoozing is deliberately NOT part of the MVP: it would hide approvals that are subject to SLAs and four-eyes control.
 */
@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async forAdmin(permissions: ReadonlySet<string>): Promise<InboxItem[]> {
    const now = new Date();
    const out: InboxItem[] = [];
    const add = (i: InboxItem) => {
      if (permissions.has(i.requiredPermission)) out.push(i);
    };
    type Reviewable = {
      id: string;
      organizationId: string;
      titleEn?: string;
      submittedAt: Date | null;
      createdAt: Date;
    };
    const reviews = async (entityType: string, rows: Promise<Reviewable[]>) => {
      for (const r of await rows)
        add({
          kind: 'CAMPAIGN_REVIEW',
          title: `${entityType} waiting for review${r.titleEn ? `: ${r.titleEn}` : ''}`,
          subject: r.titleEn || null,
          detail: entityType,
          priority: 'NORMAL',
          organizationId: r.organizationId,
          entityType,
          entityId: r.id,
          dueAt: null,
          createdAt: (r.submittedAt ?? r.createdAt).toISOString(),
          requiredPermission: 'admin.campaigns.review',
        });
    };
    const sel = {
      id: true,
      organizationId: true,
      titleEn: true,
      submittedAt: true,
      createdAt: true,
    } as const;
    await reviews(
      'LIVE_DEAL',
      this.prisma.liveDeal.findMany({
        where: { status: 'PENDING_REVIEW' },
        select: sel,
        take: 100,
      }),
    );
    await reviews(
      'EXCLUSIVE',
      this.prisma.hotDeal.findMany({ where: { status: 'PENDING_REVIEW' }, select: sel, take: 100 }),
    );
    await reviews(
      'VOUCHER',
      this.prisma.voucher.findMany({ where: { status: 'PENDING_REVIEW' }, select: sel, take: 100 }),
    );
    for (const r of await this.prisma.loyaltyRule.findMany({
      where: { status: 'PENDING_APPROVAL' },
      take: 100,
    }))
      add({
        kind: 'LOYALTY_APPROVAL',
        title: `Loyalty rule waiting for approval: ${r.name}`,
        subject: r.name,
        detail: null,
        priority: 'NORMAL',
        organizationId: r.organizationId,
        entityType: 'LoyaltyRule',
        entityId: r.id,
        dueAt: null,
        createdAt: r.createdAt.toISOString(),
        requiredPermission: 'admin.loyalty.approve',
      });
    for (const j of await this.prisma.importJob.findMany({
      where: { status: 'PENDING_APPROVAL' },
      take: 100,
    }))
      add({
        kind: 'IMPORT_APPROVAL',
        title: `Import waiting for approval${j.fileName ? `: ${j.fileName}` : ''}`,
        subject: j.fileName,
        detail: null,
        priority: 'NORMAL',
        organizationId: j.organizationId,
        entityType: 'ImportJob',
        entityId: j.id,
        dueAt: null,
        createdAt: j.createdAt.toISOString(),
        requiredPermission: 'admin.master.manage',
      });
    for (const c of await this.prisma.dataConflict.findMany({
      where: { status: 'OPEN' },
      take: 100,
    }))
      add({
        kind: 'DATA_CONFLICT',
        title: `Source data disagrees on ${c.field}`,
        subject: c.field,
        detail: c.sourceSystem,
        priority: 'NORMAL',
        organizationId: null,
        entityType: 'DataConflict',
        entityId: c.id,
        dueAt: null,
        createdAt: c.createdAt.toISOString(),
        requiredPermission: 'admin.master.manage',
      });
    for (const m of await this.prisma.matchCandidate.findMany({
      where: { status: 'PENDING' },
      take: 100,
    }))
      add({
        kind: 'DUPLICATE_SUGGESTION',
        title: 'Possible duplicate merchant',
        subject: `${m.confidence}%`,
        detail: null,
        priority: 'LOW',
        organizationId: null,
        entityType: 'MatchCandidate',
        entityId: m.id,
        dueAt: null,
        createdAt: m.createdAt.toISOString(),
        requiredPermission: 'admin.master.manage',
      });
    for (const f of await this.prisma.offerConflictFlag.findMany({
      where: { status: 'OPEN' },
      take: 100,
    }))
      add({
        kind: 'OFFER_CONFLICT',
        title: `Offer conflict: ${f.type}`,
        subject: f.type,
        detail: null,
        priority: 'NORMAL',
        organizationId: f.organizationId,
        entityType: 'OfferConflictFlag',
        entityId: f.id,
        dueAt: null,
        createdAt: f.createdAt.toISOString(),
        requiredPermission: 'admin.conflicts.manage',
      });
    for (const d of await this.prisma.disputeCase.findMany({
      where: { status: { in: [...CASE_OPEN_STATUSES] } },
      orderBy: { slaDueAt: 'asc' },
      take: 100,
    })) {
      const late = d.slaDueAt < now;
      add({
        kind: d.status === 'AWAITING_APPROVAL' ? 'CASE_APPROVAL' : 'DISPUTE',
        title: `${d.reference}: ${d.title}`,
        subject: `${d.reference}: ${d.title}`,
        detail: late ? 'SLA_MISSED' : d.status === 'AWAITING_APPROVAL' ? 'APPROVAL_REQUIRED' : null,
        priority: late ? 'CRITICAL' : (d.priority as InboxPriority),
        organizationId: d.organizationId,
        entityType: 'DisputeCase',
        entityId: d.id,
        dueAt: d.slaDueAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
        requiredPermission:
          d.status === 'AWAITING_APPROVAL' ? 'admin.disputes.manage' : 'admin.disputes.read',
      });
    }
    // ---- Stage 8: approvals and exception queues (derived from state, so they never go stale)
    for (const a of await this.prisma.adjustmentRequest.findMany({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }))
      add({
        kind: 'ADJUSTMENT_APPROVAL',
        title: `Financial adjustment waiting for approval: ${a.reference}`,
        subject: a.reference,
        detail: a.kind,
        priority: 'HIGH',
        organizationId: a.organizationId,
        entityType: 'AdjustmentRequest',
        entityId: a.id,
        dueAt: null,
        createdAt: a.createdAt.toISOString(),
        requiredPermission: 'admin.finance.approve',
      });
    for (const r of await this.prisma.operationalRestriction.findMany({
      where: { status: 'PENDING_APPROVAL' },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }))
      add({
        kind: 'RESTRICTION_APPROVAL',
        title: `Restriction waiting for approval: ${r.reference}`,
        subject: r.reference,
        detail: r.kind,
        priority: 'HIGH',
        organizationId: r.organizationId,
        entityType: 'OperationalRestriction',
        entityId: r.id,
        dueAt: null,
        createdAt: r.createdAt.toISOString(),
        requiredPermission: 'admin.restrictions.approve',
      });
    for (const r of await this.prisma.refund.findMany({
      where: { status: { in: ['REQUESTED', 'UNDER_REVIEW'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }))
      add({
        kind: 'REFUND_REVIEW',
        title: `Refund waiting for a decision: ${r.reference}`,
        subject: r.reference,
        detail: r.status,
        priority: 'NORMAL',
        organizationId: r.organizationId,
        entityType: 'Refund',
        entityId: r.id,
        dueAt: null,
        createdAt: r.createdAt.toISOString(),
        requiredPermission: 'admin.refunds.manage',
      });
    for (const s of await this.prisma.settlement.findMany({
      where: { status: { in: ['HELD', 'DISPUTE_HOLD', 'FAILED'] } },
      take: 100,
    }))
      add({
        kind: 'SETTLEMENT_EXCEPTION',
        title: `Settlement needs attention: ${s.reference}`,
        subject: s.reference,
        detail: s.status,
        priority: s.status === 'FAILED' ? 'HIGH' : 'NORMAL',
        organizationId: s.organizationId,
        entityType: 'Settlement',
        entityId: s.id,
        dueAt: null,
        createdAt: s.updatedAt.toISOString(),
        requiredPermission: 'admin.settlements.manage',
      });
    for (const i of await this.prisma.reconciliationItem.findMany({
      where: { status: { in: [...RECON_EXCEPTION_STATUSES] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }))
      add({
        kind: 'RECONCILIATION_EXCEPTION',
        title: `Reconciliation exception: ${i.reference}`,
        subject: i.reference,
        detail: i.status,
        priority: 'NORMAL',
        organizationId: i.organizationId,
        entityType: 'ReconciliationItem',
        entityId: i.id,
        dueAt: null,
        createdAt: i.createdAt.toISOString(),
        requiredPermission: 'admin.reconciliation.manage',
      });
    for (const f of await this.prisma.riskFlag.findMany({
      where: { status: { in: ['OPEN', 'IN_REVIEW'] }, domain: { not: 'WATCH' } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }))
      add({
        kind: 'FRAUD_REVIEW',
        title: `Risk flag to review: ${f.ruleCode ?? f.domain}`,
        subject: f.ruleCode,
        detail: f.domain,
        priority: f.decision === 'BLOCK' ? 'HIGH' : 'NORMAL',
        organizationId: f.subjectOrganizationId,
        entityType: 'RiskFlag',
        entityId: f.id,
        dueAt: null,
        createdAt: f.createdAt.toISOString(),
        requiredPermission: 'admin.risk.manage',
      });
    for (const m of await this.prisma.moderationItem.findMany({
      where: { status: { in: ['PENDING_REVIEW', 'REPORTED'] } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }))
      add({
        kind: 'MODERATION_REVIEW',
        title: `Content to moderate: ${m.subjectType}`,
        subject: m.subjectType,
        detail: m.status,
        priority: 'NORMAL',
        organizationId: m.organizationId,
        entityType: 'ModerationItem',
        entityId: m.id,
        dueAt: null,
        createdAt: m.createdAt.toISOString(),
        requiredPermission: 'admin.content.manage',
      });
    for (const r of await this.prisma.dataRequest.findMany({
      where: { status: 'PENDING_APPROVAL' },
      take: 100,
    }))
      add({
        kind: 'DATA_REQUEST',
        title: `Data request waiting for approval: ${r.reference}`,
        subject: r.reference,
        detail: r.type,
        priority: 'NORMAL',
        organizationId: null,
        entityType: 'DataRequest',
        entityId: r.id,
        dueAt: null,
        createdAt: r.createdAt.toISOString(),
        requiredPermission: 'admin.privacy.approve',
      });
    const failedDeliveries = await this.prisma.notificationDelivery.count({
      where: { status: 'FAILED' },
    });
    if (failedDeliveries)
      add({
        kind: 'NOTIFICATION_FAILURE',
        title: `Notifications that could not be delivered: ${failedDeliveries}`,
        subject: String(failedDeliveries),
        detail: 'FAILED',
        priority: 'NORMAL',
        organizationId: null,
        entityType: 'NotificationDelivery',
        entityId: 'FAILED',
        dueAt: null,
        createdAt: now.toISOString(),
        requiredPermission: 'admin.notifications.manage',
      });
    // ---- Stage 7: partner onboarding review, activation approval (second person) and partner benefits waiting for DealDash
    for (const p of await this.prisma.partner.findMany({
      where: { OR: [{ lifecycle: 'UNDER_REVIEW' }, { pendingLifecycle: { not: null } }] },
      include: { organization: { select: { nameEn: true } } },
      take: 100,
    }))
      add({
        kind: p.pendingLifecycle ? 'PARTNER_ACTIVATION' : 'PARTNER_REVIEW',
        title: p.pendingLifecycle
          ? `Partner activation waiting for a second approver: ${p.organization.nameEn}`
          : `Partner onboarding waiting for review: ${p.organization.nameEn}`,
        subject: p.organization.nameEn,
        detail: p.pendingLifecycle ?? p.lifecycle,
        priority: 'NORMAL',
        organizationId: p.organizationId,
        entityType: 'Partner',
        entityId: p.organizationId,
        dueAt: null,
        createdAt: (p.pendingRequestedAt ?? p.submittedAt ?? p.updatedAt).toISOString(),
        requiredPermission: p.pendingLifecycle ? 'admin.partners.approve' : 'admin.partners.manage',
      });
    for (const b of await this.prisma.liveDealPartnerBenefit.findMany({
      where: { status: 'MERCHANT_APPROVED' },
      take: 100,
    }))
      add({
        kind: 'PARTNER_BENEFIT_REVIEW',
        title: `Partner benefit waiting for DealDash approval: ${b.labelEn}`,
        subject: b.labelEn,
        detail: b.reference,
        priority: 'NORMAL',
        organizationId: b.partnerOrganizationId,
        entityType: 'LiveDealPartnerBenefit',
        entityId: b.id,
        dueAt: null,
        createdAt: (b.merchantDecidedAt ?? b.createdAt).toISOString(),
        requiredPermission: 'admin.partners.review',
      });
    // newest first; an SLA escalation shows once per escalated record (its latest level), not once per level
    const seenEscalations = new Set<string>();
    for (const t of await this.prisma.approvalTask.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })) {
      if (t.kind === 'SLA_ESCALATION') {
        const k = `${t.entityType}:${t.entityId}`;
        if (seenEscalations.has(k)) continue;
        seenEscalations.add(k);
      }
      add({
        kind: t.kind,
        title: t.title,
        subject: t.title,
        detail: t.detail,
        priority: t.priority as InboxPriority,
        organizationId: t.organizationId,
        entityType: t.entityType ?? 'ApprovalTask',
        entityId: t.entityId ?? t.id,
        dueAt: t.dueAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        requiredPermission: t.requiredPermission as PermissionCode,
      });
    }
    return out.sort(byUrgency);
  }

  /** A business sees only its own tasks: its drafts needing changes, rules, cases and conflicts that concern it. */
  async forOrganization(organizationId: string): Promise<InboxItem[]> {
    const now = new Date();
    const out: InboxItem[] = [];
    const code =
      (
        await this.prisma.organization.findUniqueOrThrow({
          where: { id: organizationId },
          select: { type: true },
        })
      ).type === 'PARTNER'
        ? 'partner'
        : 'merchant';
    const loyaltyPerm = `${code}.loyalty.manage` as PermissionCode;
    const disputePerm = `${code}.disputes.manage` as PermissionCode;
    const changes = [
      ...(
        await this.prisma.liveDeal.findMany({
          where: { organizationId, status: 'NEEDS_CHANGES' },
          select: { id: true, titleEn: true, updatedAt: true },
          take: 100,
        })
      ).map((r) => ({ ...r, p: 'LIVE_DEAL' })),
      ...(
        await this.prisma.hotDeal.findMany({
          where: { organizationId, status: 'NEEDS_CHANGES' },
          select: { id: true, titleEn: true, updatedAt: true },
          take: 100,
        })
      ).map((r) => ({ ...r, p: 'EXCLUSIVE' })),
    ];
    for (const r of changes)
      out.push({
        kind: 'CHANGES_REQUESTED',
        title: `DealDash asked for changes: ${r.titleEn}`,
        subject: r.titleEn,
        detail: r.p,
        priority: 'HIGH',
        organizationId,
        entityType: r.p,
        entityId: r.id,
        dueAt: null,
        createdAt: r.updatedAt.toISOString(),
        requiredPermission: 'merchant.deals.manage',
      });
    for (const r of await this.prisma.loyaltyRule.findMany({
      where: {
        OR: [{ organizationId }, { fundingOrganizationId: organizationId }],
        status: { in: ['DRAFT', 'PENDING_APPROVAL'] },
      },
      take: 100,
    }))
      out.push({
        kind: 'LOYALTY_RULE',
        title: `Loyalty rule ${r.status === 'DRAFT' ? 'not yet submitted' : 'waiting for DealDash'}: ${r.name}`,
        subject: r.name,
        detail: r.status,
        priority: 'LOW',
        organizationId,
        entityType: 'LoyaltyRule',
        entityId: r.id,
        dueAt: null,
        createdAt: r.createdAt.toISOString(),
        requiredPermission: loyaltyPerm,
      });
    for (const d of await this.prisma.disputeCase.findMany({
      where: { organizationId, status: { in: [...CASE_OPEN_STATUSES] } },
      take: 100,
    }))
      out.push({
        kind:
          d.status === 'AWAITING_MERCHANT' || d.status === 'AWAITING_PARTNER'
            ? 'CASE_RESPONSE_REQUIRED'
            : 'DISPUTE',
        title: `${d.reference}: ${d.title}`,
        subject: `${d.reference}: ${d.title}`,
        detail: d.slaDueAt < now ? 'SLA_MISSED' : null,
        priority:
          d.status === 'AWAITING_MERCHANT' || d.status === 'AWAITING_PARTNER'
            ? 'HIGH'
            : (d.priority as InboxPriority),
        organizationId,
        entityType: 'DisputeCase',
        entityId: d.id,
        dueAt: d.slaDueAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
        requiredPermission: disputePerm,
      });
    for (const f of await this.prisma.offerConflictFlag.findMany({
      where: { organizationId, status: 'REQUIRES_CHANGE' },
      take: 100,
    }))
      out.push({
        kind: 'OFFER_CONFLICT',
        title: `Offer needs a change: ${f.type}`,
        subject: f.type,
        detail: f.decisionNote,
        priority: 'HIGH',
        organizationId,
        entityType: 'OfferConflictFlag',
        entityId: f.id,
        dueAt: null,
        createdAt: f.createdAt.toISOString(),
        requiredPermission: 'merchant.deals.manage',
      });
    // ---- Stage 7: commercial acceptances waiting on this business (as owner, sponsor or fulfilment merchant)
    const pendingQuotes = await this.prisma.quotation.findMany({
      where: {
        status: 'PENDING_ACCEPTANCE',
        case: {
          OR: [
            { ownerOrganizationId: organizationId },
            { fulfilmentOrganizationId: organizationId },
            { commitments: { some: { organizationId } } },
          ],
        },
      },
      include: {
        case: { select: { id: true, reference: true, currentQuotationId: true } },
        acceptances: { select: { organizationId: true } },
      },
      take: 100,
    });
    for (const q of pendingQuotes) {
      if (q.case.currentQuotationId !== q.id) continue;
      const parties = (q.requiredParties as Array<{ organizationId: string }> | null) ?? [];
      if (
        !parties.some((x) => x.organizationId === organizationId) ||
        q.acceptances.some((a) => a.organizationId === organizationId)
      )
        continue;
      out.push({
        kind: 'COMMERCIAL_ACCEPTANCE',
        title: `Commercial terms waiting for your acceptance: ${q.case.reference}`,
        subject: q.case.reference,
        detail: q.reference,
        priority: 'HIGH',
        organizationId,
        entityType: 'CommercialCase',
        entityId: q.case.id,
        dueAt: q.validUntil?.toISOString() ?? null,
        createdAt: q.createdAt.toISOString(),
        requiredPermission: `${code}.commercial.accept` as PermissionCode,
      });
    }
    // ---- Stage 7: partner benefits on the merchant's Live Deals waiting for its decision
    if (code === 'merchant')
      for (const b of await this.prisma.liveDealPartnerBenefit.findMany({
        where: { merchantOrganizationId: organizationId, status: 'PROPOSED' },
        take: 100,
      }))
        out.push({
          kind: 'PARTNER_BENEFIT_DECISION',
          title: `Partner benefit waiting for your decision: ${b.labelEn}`,
          subject: b.labelEn,
          detail: b.reference,
          priority: 'NORMAL',
          organizationId,
          entityType: 'LiveDealPartnerBenefit',
          entityId: b.id,
          dueAt: null,
          createdAt: b.createdAt.toISOString(),
          requiredPermission: 'merchant.deals.manage',
        });
    // ---- Stage 7: imports DealDash sent back, and integrations failing or stale
    for (const j of await this.prisma.importJob.findMany({
      where: { organizationId, status: { in: ['REJECTED', 'APPROVED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }))
      out.push({
        kind: j.status === 'REJECTED' ? 'IMPORT_REJECTED' : 'IMPORT_READY',
        title:
          j.status === 'REJECTED'
            ? `Import sent back: ${j.fileName ?? j.kind}`
            : `Import approved, ready to run: ${j.fileName ?? j.kind}`,
        subject: j.fileName ?? j.kind,
        detail: j.rejectionReason,
        priority: j.status === 'REJECTED' ? 'NORMAL' : 'LOW',
        organizationId,
        entityType: 'ImportJob',
        entityId: j.id,
        dueAt: null,
        createdAt: j.updatedAt.toISOString(),
        requiredPermission: `${code}.imports.manage` as PermissionCode,
      });
    for (const c of await this.prisma.integrationConnection.findMany({
      where: { organizationId, status: 'ACTIVE' },
      take: 50,
    })) {
      const stale =
        !c.lastSuccessfulSyncAt ||
        c.lastSuccessfulSyncAt.getTime() < now.getTime() - c.staleAfterMinutes * 60_000;
      const failed = await this.prisma.failedRecord.count({
        where: { connectionId: c.id, status: 'OPEN' },
      });
      if (!stale && !failed) continue;
      out.push({
        kind: 'INTEGRATION_ISSUE',
        title: `Integration needs attention: ${c.name}`,
        subject: c.name,
        detail: failed ? `FAILED_RECORDS:${failed}` : 'STALE',
        priority: failed ? 'HIGH' : 'NORMAL',
        organizationId,
        entityType: 'IntegrationConnection',
        entityId: c.id,
        dueAt: null,
        createdAt: (c.lastSyncAt ?? c.createdAt).toISOString(),
        requiredPermission: `${code}.integrations.manage` as PermissionCode,
      });
    }
    return out.sort(byUrgency);
  }
}
