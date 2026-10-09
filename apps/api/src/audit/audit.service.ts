import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { AuditAction } from '@dealdash/types';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  previousState?: unknown;
  newState?: unknown;
  /** Actor performing the action. Omit for system/unauthenticated events and pass actorUserId instead. */
  actor?: Pick<Actor, 'userId' | 'membership'> | null;
  actorUserId?: string | null;
  actorOrganizationId?: string | null;
  actorRole?: string | null;
  /** The organisation the action is ABOUT (for merchant-scoped audit trails). */
  subjectOrganizationId?: string | null;
  meta?: Partial<RequestMeta> | null;
  /** The scope the actor acted under, for example BRANCH:<id> or COUNTRY:SA. */
  scope?: string | null;
  /** Ties several records of one business operation together. Defaults to the request id. */
  correlationId?: string | null;
  /** The approval (task, quotation, authorisation) that allowed the action. */
  approvalRef?: string | null;
  /** Where the change came from: UI, API, IMPORT, SYNC, AI_ASSISTED, SYSTEM ... */
  source?: string | null;
}

/**
 * Shared audit framework. Records are append-only: there is no update or delete API, and database
 * triggers reject UPDATE/DELETE/TRUNCATE on AuditLog.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async record(
    entry: AuditEntry,
    db: Pick<PrismaService, 'auditLog'> | Prisma.TransactionClient = this.prisma,
  ) {
    const row = await db.auditLog.create({
      data: {
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        reason: entry.reason ?? null,
        previousState: (entry.previousState ?? undefined) as Prisma.InputJsonValue | undefined,
        newState: (entry.newState ?? undefined) as Prisma.InputJsonValue | undefined,
        actorUserId: entry.actor?.userId ?? entry.actorUserId ?? null,
        actorOrganizationId:
          entry.actor?.membership?.organizationId ?? entry.actorOrganizationId ?? null,
        actorRole: entry.actor?.membership?.roleCode ?? entry.actorRole ?? null,
        subjectOrganizationId: entry.subjectOrganizationId ?? null,
        ip: entry.meta?.ip ?? null,
        userAgent: entry.meta?.userAgent ? entry.meta.userAgent.slice(0, 300) : null,
        requestId: entry.meta?.requestId ?? null,
        scope: entry.scope ?? null,
        correlationId: entry.correlationId ?? entry.meta?.requestId ?? null,
        approvalRef: entry.approvalRef ?? null,
        source: entry.source ?? null,
      },
    });
    this.logger.debug(`${entry.action} ${entry.entityType}:${entry.entityId ?? '-'}`);
    return row;
  }
}
