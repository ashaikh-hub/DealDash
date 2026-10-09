import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Audiences, RequirePermissions } from '../common/decorators';
import { AuditListResponse, AuditQueryDto } from '../common/dto';
import { keysetPage, Page } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('admin')
@Controller('admin/audit')
@Audiences('admin')
export class AdminAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('admin.audit.read')
  @ApiOkResponse({ type: AuditListResponse })
  async list(@Query() q: AuditQueryDto) {
    const baseWhere: Record<string, unknown> = {};
    if (q.action) baseWhere.action = q.action;
    if (q.entityType) baseWhere.entityType = q.entityType;
    if (q.organizationId)
      baseWhere.OR = [
        { actorOrganizationId: q.organizationId },
        { subjectOrganizationId: q.organizationId },
      ];
    const page = await keysetPage({
      findMany: (query) => this.prisma.auditLog.findMany(query),
      baseWhere,
      sort: { field: 'occurredAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    return new Page(
      page.items.map((a) => ({
        id: a.id,
        occurredAt: a.occurredAt.toISOString(),
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        actorUserId: a.actorUserId,
        actorRole: a.actorRole,
        actorOrganizationId: a.actorOrganizationId,
        subjectOrganizationId: a.subjectOrganizationId,
        reason: a.reason,
        requestId: a.requestId,
      })),
      page.nextCursor,
    );
  }
}
