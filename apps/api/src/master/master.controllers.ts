import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { PermissionCode } from '@dealdash/types';
import {
  conflictDecisionSchema,
  conflictViewSchema,
  connectionCreateSchema,
  connectionCreatedSchema,
  connectionViewSchema,
  envelope,
  failedDecisionSchema,
  failedRecordViewSchema,
  healthViewSchema,
  importDecisionSchema,
  importJobViewSchema,
  importRowViewSchema,
  importUploadSchema,
  ingestRequestSchema,
  ingestResultSchema,
  linkRegisteredSchema,
  masterListQuerySchema,
  masterMerchantViewSchema,
  matchCandidateViewSchema,
  matchDecisionSchema,
  networkOfferViewSchema,
  overrideCreateSchema,
  webhookCreateSchema,
} from '@dealdash/validation';
import { Audiences, CurrentActor, Idempotent, Meta, Public, RequirePermissions } from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { EntitlementService } from '../platform/entitlement.service';
import { UsageService } from '../subscription/usage.service';
import { ImportService } from './import.service';
import { IntegrationService } from './integration.service';
import { MasterService } from './master.service';
import { NetworkOffersService } from './network-offers.service';

class MasterListQueryDto extends createZodDto(masterListQuerySchema) {}
class MasterListResponse extends createZodDto(envelope(z.array(masterMerchantViewSchema))) {}
class MasterResponse extends createZodDto(envelope(masterMerchantViewSchema)) {}
class CandidateListResponse extends createZodDto(envelope(z.array(matchCandidateViewSchema))) {}
class MatchDecisionDto extends createZodDto(matchDecisionSchema) {}
class LinkRegisteredDto extends createZodDto(linkRegisteredSchema) {}
class OverrideCreateDto extends createZodDto(overrideCreateSchema) {}
class ConflictListResponse extends createZodDto(envelope(z.array(conflictViewSchema))) {}
class ConflictDecisionDto extends createZodDto(conflictDecisionSchema) {}
class OkResponse extends createZodDto(envelope(z.object({ ok: z.literal(true) }))) {}
class IdResponse extends createZodDto(envelope(z.object({ id: z.string() }))) {}
class UploadDto extends createZodDto(importUploadSchema) {}
class ImportDecisionDto extends createZodDto(importDecisionSchema) {}
class ImportJobResponse extends createZodDto(envelope(importJobViewSchema)) {}
class ImportJobListResponse extends createZodDto(envelope(z.array(importJobViewSchema))) {}
class ImportRowListResponse extends createZodDto(envelope(z.array(importRowViewSchema))) {}
class ConnectionCreateDto extends createZodDto(connectionCreateSchema) {}
class ConnectionCreatedResponse extends createZodDto(envelope(connectionCreatedSchema)) {}
class ConnectionListResponse extends createZodDto(envelope(z.array(connectionViewSchema))) {}
class HealthResponse extends createZodDto(envelope(healthViewSchema)) {}
class FailedListResponse extends createZodDto(envelope(z.array(failedRecordViewSchema))) {}
class FailedDecisionDto extends createZodDto(failedDecisionSchema) {}
class WebhookCreateDto extends createZodDto(webhookCreateSchema) {}
class StatusDto extends createZodDto(z.object({ status: z.enum(['ACTIVE', 'PAUSED', 'REVOKED']) })) {}
class IngestResponse extends createZodDto(envelope(ingestResultSchema)) {}
class NetworkOfferListResponse extends createZodDto(envelope(z.array(networkOfferViewSchema))) {}
class NetworkQueryDto extends createZodDto(
  z.object({ country: z.string().length(2).toUpperCase().optional(), city: z.string().max(80).optional(), q: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }),
) {}

const view = (c: Awaited<ReturnType<IntegrationService['list']>>[number]) => ({
  id: c.id,
  organizationId: c.organizationId,
  name: c.name,
  sourceSystem: c.sourceSystem,
  kind: c.kind,
  status: c.status,
  keyPrefix: c.keyPrefix,
  scopes: c.scopes,
  apiVersion: c.apiVersion,
  rateLimitPerMinute: c.rateLimitPerMinute,
  publicationAuthorized: c.publicationAuthorized,
  publicationRef: c.publicationRef,
  staleAfterMinutes: c.staleAfterMinutes,
  createdAt: c.createdAt.toISOString(),
});

/** DealDash Admin: merchant master data, duplicate review, linking, overrides and conflicts. */
@ApiTags('admin-master')
@Controller('admin/master')
@Audiences('admin')
export class AdminMasterController {
  constructor(private readonly master: MasterService) {}

  @Get('merchants')
  @RequirePermissions('admin.master.read')
  @ApiOkResponse({ type: MasterListResponse })
  list(@Query() q: MasterListQueryDto) {
    return this.master.list(q);
  }

  @Get('merchants/:id')
  @RequirePermissions('admin.master.read')
  @ApiOkResponse({ type: MasterResponse })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.master.get(id);
  }

  @Get('candidates')
  @RequirePermissions('admin.master.read')
  @ApiOkResponse({ type: CandidateListResponse })
  candidates(@Query('status') status?: string) {
    return this.master.candidates(status ?? 'PENDING');
  }

  @Post('candidates/:id/decide')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.master.manage')
  @ApiOkResponse({ type: OkResponse })
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body() b: MatchDecisionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    await this.master.decideMatch(actor, id, b, meta);
    return { ok: true as const };
  }

  @Post('merchants/:id/link-registered')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.master.manage')
  @ApiOkResponse({ type: IdResponse })
  async link(@Param('id', ParseUUIDPipe) id: string, @Body() b: LinkRegisteredDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return { id: await this.master.linkRegistered(actor, id, b.organizationId, meta) };
  }

  @Post('registered/:orgId/ensure')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.master.manage')
  @ApiOkResponse({ type: IdResponse })
  async ensure(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return { id: await this.master.ensureRegisteredMaster(orgId) };
  }

  @Get('conflicts')
  @RequirePermissions('admin.master.read')
  @ApiOkResponse({ type: ConflictListResponse })
  conflicts(@Query('status') status?: string) {
    return this.master.conflicts(status ?? 'OPEN');
  }

  @Post('conflicts/:id/resolve')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.master.manage')
  @ApiOkResponse({ type: OkResponse })
  async resolve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ConflictDecisionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    await this.master.resolveConflict(actor, id, b, meta);
    return { ok: true as const };
  }

  @Post('overrides')
  @Idempotent()
  @RequirePermissions('admin.master.manage')
  @ApiOkResponse({ type: IdResponse })
  override(@Body() b: OverrideCreateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.master.createOverride(actor, b, meta);
  }
}

/** DealDash Admin imports: any business's file can be reviewed and approved here, by a different person than the uploader. */
@ApiTags('admin-imports')
@Controller('admin/imports')
@Audiences('admin')
export class AdminImportsController {
  constructor(private readonly imports: ImportService) {}

  @Get()
  @RequirePermissions('admin.imports.manage')
  @ApiOkResponse({ type: ImportJobListResponse })
  list(@Query('status') status?: string, @Query('scope') scope?: string) {
    return this.imports.list(scope === 'ALL' ? undefined : null, status);
  }

  @Post()
  @Idempotent()
  @RequirePermissions('admin.imports.manage')
  @ApiOkResponse({ type: ImportJobResponse })
  upload(@Body() b: UploadDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.imports.upload(actor, null, b, meta);
  }

  @Get(':id')
  @RequirePermissions('admin.imports.manage')
  @ApiOkResponse({ type: ImportJobResponse })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.get(id);
  }

  @Get(':id/rows')
  @RequirePermissions('admin.imports.manage')
  @ApiOkResponse({ type: ImportRowListResponse })
  rows(@Param('id', ParseUUIDPipe) id: string, @Query('status') status?: string) {
    return this.imports.rows(id, undefined, status);
  }

  @Get(':id/errors.csv')
  @RequirePermissions('admin.imports.manage')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  errors(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.errorReport(id);
  }

  @Post(':id/submit')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.imports.manage')
  @ApiOkResponse({ type: ImportJobResponse })
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.imports.submitForApproval(actor, id, null, meta);
  }

  @Post(':id/approve')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.imports.manage')
  @ApiOkResponse({ type: ImportJobResponse })
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: ImportDecisionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.imports.decide(actor, id, 'APPROVE', b.reason, meta);
  }

  @Post(':id/reject')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.imports.manage')
  @ApiOkResponse({ type: ImportJobResponse })
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: ImportDecisionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.imports.decide(actor, id, 'REJECT', b.reason, meta);
  }

  @Post(':id/execute')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.imports.manage')
  @ApiOkResponse({ type: ImportJobResponse })
  async execute(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    const j = await this.imports.get(id);
    return this.imports.execute(actor, id, j.organizationId, meta);
  }

  @Post(':id/cancel')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.imports.manage')
  @ApiOkResponse({ type: OkResponse })
  async cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    const j = await this.imports.get(id);
    await this.imports.cancel(actor, id, j.organizationId, meta);
    return { ok: true as const };
  }
}

/** DealDash Admin integrations (own connections and a read view of every business's). */
@ApiTags('admin-integrations')
@Controller('admin/integrations')
@Audiences('admin')
export class AdminIntegrationsController {
  constructor(private readonly integrations: IntegrationService) {}

  @Get()
  @RequirePermissions('admin.integrations.manage')
  @ApiOkResponse({ type: ConnectionListResponse })
  async list() {
    return (await this.integrations.list(undefined)).map(view);
  }

  @Post()
  @Idempotent()
  @RequirePermissions('admin.integrations.manage')
  @ApiOkResponse({ type: ConnectionCreatedResponse })
  async create(@Body() b: ConnectionCreateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    const { row, apiKey } = await this.integrations.create(actor, b.organizationId ?? null, b, meta);
    return { ...view(row), apiKey };
  }

  @Post(':id/status')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.integrations.manage')
  @ApiOkResponse({ type: OkResponse })
  async status(@Param('id', ParseUUIDPipe) id: string, @Body() b: StatusDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    const c = (await this.integrations.list(undefined)).find((x) => x.id === id);
    if (!c) throw AppError.notFound();
    await this.integrations.setStatus(actor, id, c.organizationId, b.status, meta);
    return { ok: true as const };
  }

  @Get(':id/health')
  @RequirePermissions('admin.integrations.manage')
  @ApiOkResponse({ type: HealthResponse })
  health(@Param('id', ParseUUIDPipe) id: string) {
    return this.integrations.health(id, undefined);
  }

  @Get(':id/failed')
  @RequirePermissions('admin.integrations.manage')
  @ApiOkResponse({ type: FailedListResponse })
  failed(@Param('id', ParseUUIDPipe) id: string, @Query('status') status?: string) {
    return this.integrations.failedRecords(id, status ?? 'OPEN');
  }

  @Post(':id/failed/:fid')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.integrations.manage')
  @ApiOkResponse({ type: OkResponse })
  async decideFailed(@Param('id', ParseUUIDPipe) id: string, @Param('fid', ParseUUIDPipe) fid: string, @Body() b: FailedDecisionDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    await this.integrations.decideFailed(actor, id, fid, b.action, b.reason, meta);
    return { ok: true as const };
  }

  @Post(':id/webhooks')
  @Idempotent()
  @RequirePermissions('admin.integrations.manage')
  async webhook(@Param('id', ParseUUIDPipe) id: string, @Body() b: WebhookCreateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    const c = (await this.integrations.list(undefined)).find((x) => x.id === id);
    if (!c) throw AppError.notFound();
    return this.integrations.addEndpoint(actor, id, c.organizationId, b, meta);
  }
}

type OrgPermission = 'imports.manage' | 'integrations.manage';

/**
 * A business's own imports and integrations (partners now, merchants for their own outlets). The contract must include the feature
 * (BULK_IMPORT / API_ACCESS) and the caller the permission; the business only ever sees its own jobs and connections.
 */
@ApiTags('organization-integrations')
@Controller('orgs/:orgId')
@Audiences('merchant', 'partner')
export class OrgIntegrationsController {
  constructor(
    private readonly imports: ImportService,
    private readonly integrations: IntegrationService,
    private readonly entitlements: EntitlementService,
  ) {}

  private need(actor: Actor, orgId: string, p: OrgPermission) {
    const m = actor.membership;
    if (!m || m.organizationId !== orgId || (m.organizationType !== 'MERCHANT' && m.organizationType !== 'PARTNER')) throw AppError.notFound();
    const code = `${m.organizationType === 'PARTNER' ? 'partner' : 'merchant'}.${p}` as PermissionCode;
    if (!actor.permissions.has(code) || m.scoped) throw new AppError('SCOPE_FORBIDDEN', 'You do not have permission to do this', 403);
  }

  @Get('imports')
  @ApiOkResponse({ type: ImportJobListResponse })
  async listImports(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'imports.manage');
    return this.imports.list(orgId);
  }

  @Post('imports')
  @Idempotent()
  @ApiOkResponse({ type: ImportJobResponse })
  async upload(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() b: UploadDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'imports.manage');
    return this.imports.upload(actor, orgId, b, meta);
  }

  @Get('imports/:id')
  @ApiOkResponse({ type: ImportJobResponse })
  async getImport(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'imports.manage');
    return this.imports.get(id, orgId);
  }

  @Get('imports/:id/rows')
  @ApiOkResponse({ type: ImportRowListResponse })
  async importRows(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Query('status') status?: string) {
    this.need(actor, orgId, 'imports.manage');
    return this.imports.rows(id, orgId, status);
  }

  @Get('imports/:id/errors.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async importErrors(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'imports.manage');
    return this.imports.errorReport(id, orgId);
  }

  @Post('imports/:id/submit')
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: ImportJobResponse })
  async submitImport(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'imports.manage');
    return this.imports.submitForApproval(actor, id, orgId, meta);
  }

  @Post('imports/:id/cancel')
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: OkResponse })
  async cancelImport(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'imports.manage');
    await this.imports.cancel(actor, id, orgId, meta);
    return { ok: true as const };
  }

  @Get('integrations')
  @ApiOkResponse({ type: ConnectionListResponse })
  async listConnections(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'integrations.manage');
    return (await this.integrations.list(orgId)).map(view);
  }

  @Post('integrations')
  @Idempotent()
  @ApiOkResponse({ type: ConnectionCreatedResponse })
  async createConnection(@Param('orgId', ParseUUIDPipe) orgId: string, @Body() b: ConnectionCreateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'integrations.manage');
    await this.entitlements.requireFeature(orgId, 'API_ACCESS');
    // a business cannot authorise DealDash to publish by itself: publication rights are confirmed by DealDash after the contract
    const { row, apiKey } = await this.integrations.create(actor, orgId, { ...b, publicationAuthorized: false, publicationRef: undefined }, meta);
    return { ...view(row), apiKey };
  }

  @Post('integrations/:id/status')
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: OkResponse })
  async connectionStatus(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: StatusDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'integrations.manage');
    await this.integrations.setStatus(actor, id, orgId, b.status, meta);
    return { ok: true as const };
  }

  @Get('integrations/:id/health')
  @ApiOkResponse({ type: HealthResponse })
  async health(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'integrations.manage');
    return this.integrations.health(id, orgId);
  }

  @Get('integrations/:id/failed')
  @ApiOkResponse({ type: FailedListResponse })
  async failed(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    this.need(actor, orgId, 'integrations.manage');
    await this.integrations.health(id, orgId); // 404 for a connection of another business
    return this.integrations.failedRecords(id, 'OPEN');
  }

  @Post('integrations/:id/webhooks')
  @Idempotent()
  async webhook(@Param('orgId', ParseUUIDPipe) orgId: string, @Param('id', ParseUUIDPipe) id: string, @Body() b: WebhookCreateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    this.need(actor, orgId, 'integrations.manage');
    await this.entitlements.requireFeature(orgId, 'WEBHOOKS');
    return this.integrations.addEndpoint(actor, id, orgId, b, meta);
  }
}

/** The ingest endpoint external sources call. Authenticated by API key, not by a user session. */
@ApiTags('integrations-ingest')
@Controller('integrations/ingest')
export class IngestController {
  constructor(
    private readonly integrations: IntegrationService,
    private readonly entitlements: EntitlementService,
    private readonly usage: UsageService,
  ) {}

  @Post()
  @Public()
  @HttpCode(200)
  @ApiOkResponse({ type: IngestResponse })
  async ingest(@Headers('x-dealdash-key') key: string | undefined, @Headers('idempotency-key') idem: string | undefined, @Body() body: unknown) {
    const c = await this.integrations.authenticate(key);
    if (c.organizationId) {
      // the contract's API allowance: a request is one unit, counted once per idempotency key
      await this.entitlements.requireNewExposure(c.organizationId, 'API_OPERATION');
      await this.usage.consume({ organizationId: c.organizationId, limitKey: 'api.requests', idempotencyKey: `api:${c.id}:${idem ?? randomUUID()}`, sourceType: 'API', sourceId: idem ?? c.id, feature: 'API_ACCESS' });
    }
    const parsed = ingestRequestSchema.safeParse(body);
    if (!parsed.success) throw AppError.validation(parsed.error.issues[0]?.message ?? 'Invalid request', 'body');
    return this.integrations.ingestBatch(c, parsed.data.records, idem);
  }

  @Get('health')
  @Public()
  @ApiOkResponse({ type: HealthResponse })
  async health(@Headers('x-dealdash-key') key: string | undefined) {
    const c = await this.integrations.authenticate(key);
    return this.integrations.health(c.id, c.organizationId);
  }
}

/** Customer discovery of network offers (only those DealDash has the right to show; see NetworkOffersService). */
@ApiTags('network-offers')
@Controller('app/network-offers')
export class CustomerNetworkOffersController {
  constructor(private readonly offers: NetworkOffersService) {}

  @Get()
  @Public()
  @ApiOkResponse({ type: NetworkOfferListResponse })
  list(@Query() q: NetworkQueryDto) {
    return this.offers.visible(q);
  }
}
