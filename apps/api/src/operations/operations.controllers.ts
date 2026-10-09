import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { PermissionCode } from '@dealdash/types';
import { Audiences, CurrentActor, Idempotent, Meta, RequirePermissions, ScopeAware } from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { AccessScopeService } from '../platform/access-scope.service';
import { ActivityService } from './activity.service';
import { ConflictService } from './conflict.service';
import { ATTACHMENT_TYPES, DISPUTE_PRIORITIES, DisputeService } from './dispute.service';
import { InboxService } from './inbox.service';

const uuid = z.string().uuid();
const openSchema = z.object({
  type: z.string().trim().min(3).max(60),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).nullable().optional(),
  priority: z.enum(DISPUTE_PRIORITIES).optional(),
  product: z.string().trim().max(30).nullable().optional(),
  relatedType: z.string().trim().max(60).nullable().optional(),
  relatedId: uuid.nullable().optional(),
  targetOrganizationId: uuid.nullable().optional(),
  customerUserId: uuid.nullable().optional(),
});
const noteSchema = z.object({ body: z.string().trim().min(1).max(2000), visibility: z.enum(['INTERNAL', 'SHARED']).default('SHARED') });
const assignSchema = z.object({ ownerUserId: uuid });
const resolveSchema = z.object({
  outcome: z.enum(['RESOLVED', 'CLOSED']),
  resolution: z.string().trim().min(3).max(1000),
  financialAdjustmentId: uuid.nullable().optional(),
});
const decideSchema = z.object({ decision: z.enum(['ACKNOWLEDGED', 'REQUIRES_CHANGE']), note: z.string().trim().min(3).max(500) });
const intentSchema = z.object({ fileName: z.string().trim().min(1).max(160), mimeType: z.string().trim().min(3).max(100), sizeBytes: z.number().int().min(1).max(50_000_000) });
const attachSchema = z.object({
  fileId: uuid,
  type: z.enum(ATTACHMENT_TYPES).default('DOCUMENT'),
  label: z.string().trim().max(120).nullable().optional(),
  visibility: z.enum(['INTERNAL', 'SHARED']).optional(),
});
class IntentDto extends createZodDto(intentSchema) {}
class AttachDto extends createZodDto(attachSchema) {}
class OpenDto extends createZodDto(openSchema) {}
class NoteDto extends createZodDto(noteSchema) {}
class AssignDto extends createZodDto(assignSchema) {}
class ResolveDto extends createZodDto(resolveSchema) {}
class DecideDto extends createZodDto(decideSchema) {}

const businessPerm = (actor: Actor, orgId: string, suffix: string): PermissionCode => {
  const m = actor.membership;
  if (!m || m.organizationId !== orgId || (m.organizationType !== 'MERCHANT' && m.organizationType !== 'PARTNER')) throw AppError.notFound();
  return `${m.organizationType === 'PARTNER' ? 'partner' : 'merchant'}.${suffix}` as PermissionCode;
};
/** Fine-grained scoped members are refused here: these views are organization-wide until each is scope-aware. */
const requireOrgWide = (actor: Actor, orgId: string, suffix: string) => {
  const code = businessPerm(actor, orgId, suffix);
  if (!actor.permissions.has(code) || actor.membership!.scoped) throw new AppError('SCOPE_FORBIDDEN', 'You do not have permission to do this', 403);
};

@ApiTags('admin-operations')
@Controller('admin')
@Audiences('admin')
export class AdminOperationsController {
  constructor(
    private readonly disputes: DisputeService,
    private readonly conflicts: ConflictService,
    private readonly inbox: InboxService,
    private readonly activity: ActivityService,
  ) {}

  @Get('inbox')
  items(@CurrentActor() actor: Actor) {
    return this.inbox.forAdmin(actor.permissions);
  }

  @Get('activity')
  @RequirePermissions('admin.platform.read')
  history(@Query('organizationId') organizationId?: string, @Query('entityType') entityType?: string, @Query('entityId') entityId?: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.activity.list({ organizationId, entityType, entityId, before, limit: limit ? Number(limit) : undefined }, 'admin');
  }

  // ------------------------------------------------------------ disputes
  @Get('disputes')
  @RequirePermissions('admin.disputes.read')
  listDisputes(@Query('status') status?: string, @Query('organizationId') organizationId?: string) {
    return this.disputes.list({ ...(status ? { status } : {}), ...(organizationId ? { organizationId } : {}) }, false);
  }

  @Get('disputes/:id')
  @RequirePermissions('admin.disputes.read')
  getDispute(@Param('id', ParseUUIDPipe) id: string) {
    return this.disputes.get(id);
  }

  @Post('disputes')
  @Idempotent()
  @RequirePermissions('admin.disputes.manage')
  openDispute(@Body() b: OpenDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.disputes.open(actor, null, b, meta);
  }

  @Post('disputes/:id/notes')
  @Idempotent()
  @RequirePermissions('admin.disputes.manage')
  noteDispute(@Param('id', ParseUUIDPipe) id: string, @Body() b: NoteDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.disputes.note(actor, id, undefined, b.body, b.visibility, meta);
  }

  @Post('disputes/:id/assign')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.disputes.manage')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() b: AssignDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.disputes.assign(actor, id, b.ownerUserId, meta);
  }

  @Post('disputes/:id/resolve')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.disputes.manage')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ResolveDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.disputes.resolve(actor, id, b, meta);
  }

  @Post('disputes/:id/attachments/intent')
  @HttpCode(200)
  @RequirePermissions('admin.disputes.manage')
  attachmentIntent(@Param('id', ParseUUIDPipe) id: string, @Body() b: IntentDto, @CurrentActor() actor: Actor) {
    return this.disputes.attachmentIntent(actor, id, undefined, b);
  }

  @Post('disputes/:id/attachments')
  @Idempotent()
  @RequirePermissions('admin.disputes.manage')
  attach(@Param('id', ParseUUIDPipe) id: string, @Body() b: AttachDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.disputes.attach(actor, id, undefined, b, meta);
  }

  @Get('disputes/:id/attachments/:attachmentId/url')
  @RequirePermissions('admin.disputes.read')
  attachmentUrl(@Param('id', ParseUUIDPipe) id: string, @Param('attachmentId') attachmentId: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.disputes.attachmentUrl(actor, id, attachmentId, undefined, meta);
  }
  // ------------------------------------------------------------ offer conflicts
  @Get('conflicts')
  @RequirePermissions('admin.conflicts.manage')
  listConflicts(@Query('status') status?: string) {
    return this.conflicts.list(status ? { status } : {});
  }

  @Post('conflicts/scan')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.conflicts.manage')
  scan() {
    return this.conflicts.scan();
  }

  @Post('conflicts/:id/decide')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.conflicts.manage')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() b: DecideDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.conflicts.decide(actor, id, b.decision, b.note, meta);
  }
}

@ApiTags('organization-operations')
@Controller('orgs/:orgId')
@Audiences('merchant', 'partner')
export class OrgOperationsController {
  constructor(
    private readonly disputes: DisputeService,
    private readonly inbox: InboxService,
    private readonly activity: ActivityService,
    private readonly access: AccessScopeService,
  ) {}

  /** Scope-aware: campaign tasks follow the member's scope; organization-level tasks need an organization-wide grant. */
  @Get('inbox')
  @ScopeAware()
  async items(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    const m = actor.membership;
    if (!m || m.organizationId !== orgId || (m.organizationType !== 'MERCHANT' && m.organizationType !== 'PARTNER')) throw AppError.notFound();
    const out = [];
    for (const i of await this.inbox.forOrganization(orgId)) {
      if (!actor.permissions.has(i.requiredPermission)) continue;
      if (this.access.isScoped(actor)) {
        if (i.entityType === 'LIVE_DEAL' || i.entityType === 'EXCLUSIVE') {
          try {
            await this.access.guard(actor, i.entityType, orgId, i.entityId, 'read');
          } catch {
            continue;
          }
        } else if (!(await this.access.canOrg(actor, i.requiredPermission))) continue;
      }
      out.push(i);
    }
    return out;
  }

  @Get('activity')
  history(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor, @Query('entityType') entityType?: string, @Query('entityId') entityId?: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    requireOrgWide(actor, orgId, 'activity.read');
    return this.activity.list({ organizationId: orgId, entityType, entityId, before, limit: limit ? Number(limit) : undefined }, 'business');
  }

  @Get('disputes')
  list(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    requireOrgWide(actor, orgId, 'disputes.manage');
    return this.disputes.list({ organizationId: orgId }, true);
  }

  @Get('disputes/:id')
  get(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    requireOrgWide(actor, orgId, 'disputes.manage');
    return this.disputes.get(id, orgId);
  }

  @Post('disputes')
  @Idempotent()
  open(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() b: OpenDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    requireOrgWide(actor, orgId, 'disputes.manage');
    return this.disputes.open(actor, orgId, b, meta);
  }

  @Post('disputes/:id/notes')
  @Idempotent()
  note(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: NoteDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    requireOrgWide(actor, orgId, 'disputes.manage');
    return this.disputes.note(actor, id, orgId, b.body, 'SHARED', meta);
  }

  @Post('disputes/:id/attachments/intent')
  @HttpCode(200)
  attachmentIntent(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: IntentDto, @CurrentActor() actor: Actor) {
    requireOrgWide(actor, orgId, 'disputes.manage');
    return this.disputes.attachmentIntent(actor, id, orgId, b);
  }

  @Post('disputes/:id/attachments')
  @Idempotent()
  attach(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: AttachDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    requireOrgWide(actor, orgId, 'disputes.manage');
    return this.disputes.attach(actor, id, orgId, b, meta);
  }

  @Get('disputes/:id/attachments/:attachmentId/url')
  attachmentUrl(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Param('attachmentId') attachmentId: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    requireOrgWide(actor, orgId, 'disputes.manage');
    return this.disputes.attachmentUrl(actor, id, attachmentId, orgId, meta);
  }
}