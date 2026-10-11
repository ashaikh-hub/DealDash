import { Injectable } from '@nestjs/common';
import {
  CASE_OPEN_STATUSES,
  RECON_EXCEPTION_STATUSES,
  type SlaArea,
  type SlaState,
} from '@dealdash/types';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AlertsService } from '../visibility/alerts.service';
import { opsConfig } from './ops-util';

export interface SlaItem {
  area: SlaArea;
  subjectType: string;
  id: string;
  reference: string;
  priority: string;
  startedAt: string;
  warnAt: string;
  dueAt: string;
  state: SlaState;
  escalationLevel: number;
  organizationId: string | null;
}

/**
 * SLA / escalation (Stage 8) on the existing alert and task engine. Targets, warning thresholds and escalation steps are
 * configuration per area and priority (`operations.sla`). The sweep moves cases ON_TRACK -> WARNING -> BREACHED, raises an alert at
 * each step (deduplicated), and escalates a breach level by level to the configured roles (a task in their inbox, an in-app notice,
 * an ESCALATION note on the case, an audit record). Other work (approvals, refunds, adjustments, reconciliation, settlement, fraud,
 * restrictions, moderation, data requests) is timed from when it started.
 */
@Injectable()
export class SlaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly alerts: AlertsService,
  ) {}

  private timing(
    rule: { targetHours: Record<string, number>; warnPct: number } | undefined,
    priority: string,
    start: Date,
    now: Date,
  ) {
    const hours = rule?.targetHours[priority] ?? rule?.targetHours.NORMAL ?? 72;
    const due = new Date(start.getTime() + hours * 3_600_000);
    const warn = new Date(start.getTime() + hours * (rule?.warnPct ?? 75) * 36_000);
    const state: SlaState = now >= due ? 'BREACHED' : now >= warn ? 'WARNING' : 'ON_TRACK';
    return { due, warn, state };
  }

  /** Everything with an SLA that is still open, with its state (cases use their own SLA due date). */
  async items(now = new Date()): Promise<SlaItem[]> {
    const cfg = await opsConfig(this.config);
    const out: SlaItem[] = [];
    const push = (
      area: SlaArea,
      subjectType: string,
      r: {
        id: string;
        reference: string;
        createdAt: Date;
        priority?: string;
        organizationId?: string | null;
      },
    ) => {
      const priority = r.priority ?? 'NORMAL';
      const t = this.timing(cfg.sla[area], priority, r.createdAt, now);
      out.push({
        area,
        subjectType,
        id: r.id,
        reference: r.reference,
        priority,
        startedAt: r.createdAt.toISOString(),
        warnAt: t.warn.toISOString(),
        dueAt: t.due.toISOString(),
        state: t.state,
        escalationLevel: 0,
        organizationId: r.organizationId ?? null,
      });
    };
    for (const c of await this.prisma.disputeCase.findMany({
      where: { status: { in: [...CASE_OPEN_STATUSES] } },
      take: 500,
    })) {
      const warn =
        c.slaWarnAt ??
        new Date(c.createdAt.getTime() + (c.slaDueAt.getTime() - c.createdAt.getTime()) * 0.75);
      out.push({
        area: 'CASE',
        subjectType: 'DisputeCase',
        id: c.id,
        reference: c.reference,
        priority: c.priority,
        startedAt: c.createdAt.toISOString(),
        warnAt: warn.toISOString(),
        dueAt: c.slaDueAt.toISOString(),
        state: now >= c.slaDueAt ? 'BREACHED' : now >= warn ? 'WARNING' : 'ON_TRACK',
        escalationLevel: c.escalationLevel,
        organizationId: c.organizationId,
      });
    }
    for (const t of await this.prisma.approvalTask.findMany({
      where: { status: 'OPEN', kind: { not: 'SLA_ESCALATION' } },
      take: 300,
    }))
      push('APPROVAL', 'ApprovalTask', {
        id: t.id,
        reference: t.title.slice(0, 60),
        createdAt: t.createdAt,
        priority: t.priority,
        organizationId: t.organizationId,
      });
    for (const r of await this.prisma.refund.findMany({
      where: { status: { in: ['REQUESTED', 'UNDER_REVIEW', 'FAILED'] } },
      take: 300,
    }))
      push('REFUND', 'Refund', {
        id: r.id,
        reference: r.reference,
        createdAt: r.createdAt,
        organizationId: r.organizationId,
      });
    for (const a of await this.prisma.adjustmentRequest.findMany({
      where: { status: { in: ['PENDING_APPROVAL', 'FAILED'] } },
      take: 300,
    }))
      push('ADJUSTMENT', 'AdjustmentRequest', {
        id: a.id,
        reference: a.reference,
        createdAt: a.createdAt,
        organizationId: a.organizationId,
      });
    for (const i of await this.prisma.reconciliationItem.findMany({
      where: { status: { in: [...RECON_EXCEPTION_STATUSES] } },
      take: 300,
    }))
      push('RECONCILIATION', 'ReconciliationItem', {
        id: i.id,
        reference: i.reference,
        createdAt: i.createdAt,
        organizationId: i.organizationId,
      });
    for (const s of await this.prisma.settlement.findMany({
      where: { status: { in: ['HELD', 'DISPUTE_HOLD', 'FAILED'] } },
      take: 300,
    }))
      push('SETTLEMENT', 'Settlement', {
        id: s.id,
        reference: s.reference,
        createdAt: s.updatedAt,
        organizationId: s.organizationId,
      });
    for (const f of await this.prisma.riskFlag.findMany({
      where: { status: { in: ['OPEN', 'IN_REVIEW'] }, domain: { not: 'WATCH' } },
      take: 300,
    }))
      push('FRAUD', 'RiskFlag', {
        id: f.id,
        reference: f.ruleCode ?? f.domain,
        createdAt: f.createdAt,
        priority: f.decision === 'BLOCK' ? 'HIGH' : 'NORMAL',
        organizationId: f.subjectOrganizationId,
      });
    for (const r of await this.prisma.operationalRestriction.findMany({
      where: { status: 'PENDING_APPROVAL' },
      take: 300,
    }))
      push('RESTRICTION', 'OperationalRestriction', {
        id: r.id,
        reference: r.reference,
        createdAt: r.createdAt,
        priority: 'HIGH',
        organizationId: r.organizationId,
      });
    for (const m of await this.prisma.moderationItem.findMany({
      where: { status: { in: ['PENDING_REVIEW', 'REPORTED'] } },
      take: 300,
    }))
      push('MODERATION', 'ModerationItem', {
        id: m.id,
        reference: `${m.subjectType}:${m.subjectId.slice(0, 8)}`,
        createdAt: m.createdAt,
        organizationId: m.organizationId,
      });
    for (const d of await this.prisma.dataRequest.findMany({
      where: { status: { in: ['REQUESTED', 'PENDING_APPROVAL'] } },
      take: 300,
    }))
      push('DATA_REQUEST', 'DataRequest', {
        id: d.id,
        reference: d.reference,
        createdAt: d.createdAt,
      });
    for (const c of await this.prisma.integrationConnection.findMany({
      where: { status: 'ACTIVE', errorCount: { gt: 0 } },
      take: 100,
    }))
      push('INTEGRATION', 'IntegrationConnection', {
        id: c.id,
        reference: c.name,
        createdAt: c.lastSuccessfulSyncAt ?? c.createdAt,
        priority: 'HIGH',
        organizationId: c.organizationId,
      });
    return out;
  }

  async overview(now = new Date()) {
    const items = await this.items(now);
    const areas = [...new Set(items.map((i) => i.area))];
    return {
      generatedAt: now.toISOString(),
      byArea: areas.map((a) => ({
        area: a,
        open: items.filter((i) => i.area === a).length,
        warning: items.filter((i) => i.area === a && i.state === 'WARNING').length,
        breached: items.filter((i) => i.area === a && i.state === 'BREACHED').length,
      })),
      items: items
        .filter((i) => i.state !== 'ON_TRACK')
        .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
        .slice(0, 200),
    };
  }

  /** The sweep (job): states, alerts and escalation. Returns the number of changes. */
  async sweep(now = new Date()) {
    const cfg = await opsConfig(this.config);
    let changes = 0;
    const items = await this.items(now);
    for (const i of items) {
      if (i.state === 'ON_TRACK') continue;
      if (i.subjectType === 'DisputeCase') {
        const c = await this.prisma.disputeCase.findUnique({ where: { id: i.id } });
        if (!c) continue;
        if (c.slaState !== i.state) {
          await this.prisma.disputeCase.update({
            where: { id: c.id },
            data: { slaState: i.state },
          });
          changes++;
        }
      }
      await this.alerts
        .raise({
          code: i.state === 'BREACHED' ? 'SLA_BREACHED' : 'SLA_WARNING',
          organizationId: null,
          subjectType: i.subjectType,
          subjectId: i.id,
          once: true,
          data: { area: i.area, reference: i.reference, dueAt: i.dueAt },
        })
        .catch(() => null);
      if (i.state !== 'BREACHED') continue;
      // escalation: each configured level once its delay after the breach has passed
      const steps = cfg.sla[i.area]?.escalation ?? [];
      const minutesLate = (now.getTime() - new Date(i.dueAt).getTime()) / 60_000;
      const current =
        i.subjectType === 'DisputeCase'
          ? i.escalationLevel
          : await this.prisma.approvalTask.count({
              where: { kind: 'SLA_ESCALATION', entityType: i.subjectType, entityId: i.id },
            });
      for (const step of steps
        .filter((s) => s.level > current && minutesLate >= s.afterBreachMinutes)
        .sort((a, b) => a.level - b.level)) {
        await this.escalate(i, step);
        changes++;
      }
    }
    return changes;
  }

  private async escalate(i: SlaItem, step: { level: number; toRoles: string[] }) {
    const created = await this.prisma.approvalTask
      .create({
        data: {
          kind: 'SLA_ESCALATION',
          status: 'OPEN',
          priority: step.level >= 2 ? 'CRITICAL' : 'HIGH',
          title: `SLA breached (${i.area}, level ${step.level}): ${i.reference}`,
          detail: `${i.area}:L${step.level}`,
          organizationId: i.organizationId,
          entityType: i.subjectType,
          entityId: i.id,
          requiredPermission: 'admin.operations.read',
          dedupeKey: `sla:${i.subjectType}:${i.id}:L${step.level}`,
          dueAt: new Date(),
        },
      })
      .then(() => true)
      .catch((e: { code?: string }) => {
        if (e.code === 'P2002') return false;
        throw e;
      });
    if (!created) return;
    const recipients = await this.prisma.organizationMembership.findMany({
      where: {
        status: 'ACTIVE',
        organization: { type: 'DEALDASH' },
        role: { code: { in: step.toRoles } },
      },
      select: { userId: true },
    });
    if (recipients.length)
      await this.prisma.notification.createMany({
        data: [...new Set(recipients.map((r) => r.userId))].map((userId) => ({
          userId,
          type: 'ALERT' as const,
          dedupeKey: `sla:${i.id}:L${step.level}`,
          data: {
            code: 'SLA_BREACHED',
            level: step.level,
            area: i.area,
            reference: i.reference,
            href: i.subjectType === 'DisputeCase' ? `/cases?id=${i.id}` : '/sla',
          },
        })),
        skipDuplicates: true,
      });
    if (i.subjectType === 'DisputeCase') {
      await this.prisma.disputeCase.update({
        where: { id: i.id },
        data: { escalationLevel: step.level, lastEscalatedAt: new Date() },
      });
      await this.prisma.caseNote.create({
        data: {
          caseId: i.id,
          visibility: 'INTERNAL',
          kind: 'ESCALATION',
          authorKind: 'SYSTEM',
          body: `SLA breached: escalated to level ${step.level} (${step.toRoles.join(', ')}).`,
        },
      });
    }
    await this.audit.record({
      action: 'SLA_ESCALATED',
      entityType: i.subjectType,
      entityId: i.id,
      actorRole: 'SYSTEM',
      subjectOrganizationId: i.organizationId,
      newState: { area: i.area, level: step.level, toRoles: step.toRoles, dueAt: i.dueAt },
    });
  }
}
