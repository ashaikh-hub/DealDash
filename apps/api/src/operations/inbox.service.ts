import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '@dealdash/types';
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
const byUrgency = (a: InboxItem, b: InboxItem) => RANK[a.priority] - RANK[b.priority] || a.createdAt.localeCompare(b.createdAt);

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
    type Reviewable = { id: string; organizationId: string; titleEn?: string; submittedAt: Date | null; createdAt: Date };
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
    const sel = { id: true, organizationId: true, titleEn: true, submittedAt: true, createdAt: true } as const;
    await reviews('LIVE_DEAL', this.prisma.liveDeal.findMany({ where: { status: 'PENDING_REVIEW' }, select: sel, take: 100 }));
    await reviews('EXCLUSIVE', this.prisma.hotDeal.findMany({ where: { status: 'PENDING_REVIEW' }, select: sel, take: 100 }));
    await reviews('VOUCHER', this.prisma.voucher.findMany({ where: { status: 'PENDING_REVIEW' }, select: sel, take: 100 }));
    for (const r of await this.prisma.loyaltyRule.findMany({ where: { status: 'PENDING_APPROVAL' }, take: 100 }))
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
    for (const j of await this.prisma.importJob.findMany({ where: { status: 'PENDING_APPROVAL' }, take: 100 }))
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
    for (const c of await this.prisma.dataConflict.findMany({ where: { status: 'OPEN' }, take: 100 }))
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
    for (const m of await this.prisma.matchCandidate.findMany({ where: { status: 'PENDING' }, take: 100 }))
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
    for (const f of await this.prisma.offerConflictFlag.findMany({ where: { status: 'OPEN' }, take: 100 }))
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
    for (const d of await this.prisma.disputeCase.findMany({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } }, orderBy: { slaDueAt: 'asc' }, take: 100 })) {
      const late = d.slaDueAt < now;
      add({
        kind: 'DISPUTE',
        title: `${d.reference}: ${d.title}`,
        subject: `${d.reference}: ${d.title}`,
        detail: late ? 'SLA_MISSED' : null,
        priority: late ? 'CRITICAL' : (d.priority as InboxPriority),
        organizationId: d.organizationId,
        entityType: 'DisputeCase',
        entityId: d.id,
        dueAt: d.slaDueAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
        requiredPermission: 'admin.disputes.read',
      });
    }
    for (const t of await this.prisma.approvalTask.findMany({ where: { status: 'OPEN' }, take: 100 }))
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
    return out.sort(byUrgency);
  }

  /** A business sees only its own tasks: its drafts needing changes, rules, cases and conflicts that concern it. */
  async forOrganization(organizationId: string): Promise<InboxItem[]> {
    const now = new Date();
    const out: InboxItem[] = [];
    const code = (await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { type: true } })).type === 'PARTNER' ? 'partner' : 'merchant';
    const loyaltyPerm = `${code}.loyalty.manage` as PermissionCode;
    const disputePerm = `${code}.disputes.manage` as PermissionCode;
    const changes = [
      ...(await this.prisma.liveDeal.findMany({ where: { organizationId, status: 'NEEDS_CHANGES' }, select: { id: true, titleEn: true, updatedAt: true }, take: 100 })).map((r) => ({ ...r, p: 'LIVE_DEAL' })),
      ...(await this.prisma.hotDeal.findMany({ where: { organizationId, status: 'NEEDS_CHANGES' }, select: { id: true, titleEn: true, updatedAt: true }, take: 100 })).map((r) => ({ ...r, p: 'EXCLUSIVE' })),
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
    for (const r of await this.prisma.loyaltyRule.findMany({ where: { OR: [{ organizationId }, { fundingOrganizationId: organizationId }], status: { in: ['DRAFT', 'PENDING_APPROVAL'] } }, take: 100 }))
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
    for (const d of await this.prisma.disputeCase.findMany({ where: { organizationId, status: { in: ['OPEN', 'IN_REVIEW'] } }, take: 100 }))
      out.push({
        kind: 'DISPUTE',
        title: `${d.reference}: ${d.title}`,
        subject: `${d.reference}: ${d.title}`,
        detail: d.slaDueAt < now ? 'SLA_MISSED' : null,
        priority: d.priority as InboxPriority,
        organizationId,
        entityType: 'DisputeCase',
        entityId: d.id,
        dueAt: d.slaDueAt.toISOString(),
        createdAt: d.createdAt.toISOString(),
        requiredPermission: disputePerm,
      });
    for (const f of await this.prisma.offerConflictFlag.findMany({ where: { organizationId, status: 'REQUIRES_CHANGE' }, take: 100 }))
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
    return out.sort(byUrgency);
  }
}
