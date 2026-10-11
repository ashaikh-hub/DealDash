import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Never shown to a business: who inside DealDash did it is a role, not a name, and technical fields stay internal. */
const humanise = (action: string) => {
  const s = action.replace(/[._]/g, ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/**
 * Activity history in plain language. Built on the one audit log (nothing is copied): the entry's action becomes a sentence, the
 * technical detail (before/after state, IP, user agent) stays in the audit log for people allowed to read it.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  /** `organizationId` = a business's own trail; undefined = DealDash (any organization, optional filters). */
  async list(
    q: {
      organizationId?: string;
      entityType?: string;
      entityId?: string;
      before?: string;
      limit?: number;
    },
    audience: 'business' | 'admin',
  ) {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 100);
    const where: Prisma.AuditLogWhereInput = {
      ...(q.organizationId ? { subjectOrganizationId: q.organizationId } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.before ? { occurredAt: { lt: new Date(q.before) } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const orgIds = [
      ...new Set(page.map((r) => r.actorOrganizationId).filter((x): x is string => !!x)),
    ];
    const orgs = new Map(
      (
        await this.prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, type: true },
        })
      ).map((o) => [o.id, o.type]),
    );
    return {
      items: page.map((r) => ({
        id: r.id,
        at: r.occurredAt.toISOString(),
        summary: humanise(r.action),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        reason: r.reason,
        // a business sees whether DealDash or its own team acted, never which DealDash person
        actor:
          audience === 'admin'
            ? { userId: r.actorUserId, role: r.actorRole, organizationId: r.actorOrganizationId }
            : {
                by:
                  r.actorOrganizationId && orgs.get(r.actorOrganizationId) === 'DEALDASH'
                    ? 'DEALDASH'
                    : r.actorUserId
                      ? 'YOUR_TEAM'
                      : 'SYSTEM',
              },
        scope: r.scope,
        correlationId: audience === 'admin' ? r.correlationId : null,
      })),
      next: rows.length > limit ? (page[page.length - 1]?.occurredAt.toISOString() ?? null) : null,
    };
  }
}
