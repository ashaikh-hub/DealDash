import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PERMISSION_CODES, type PermissionCode } from '@dealdash/types';
import {
  accessCheckResultSchema,
  accessCheckSchema,
  accessMeSchema,
  assignableRolesSchema,
  assignmentCreateSchema,
  assignmentRevokeSchema,
  assignmentViewSchema,
  contractCreateSchema,
  contractEndSchema,
  contractViewSchema,
  countryUpsertSchema,
  countryViewSchema,
  entitlementViewSchema,
  envelope,
  legalEntityCreateSchema,
  legalEntityViewSchema,
  memberViewSchema,
  scopeConvertSchema,
  unitCreateSchema,
  unitUpdateSchema,
  unitViewSchema,
} from '@dealdash/validation';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  RequirePermissions,
  ScopeAware,
} from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { ContractService } from './contract.service';
import { CountryService } from './country.service';
import { DelegationService } from './delegation.service';
import { EntitlementService } from './entitlement.service';
import { HierarchyService } from './hierarchy.service';
import { ScopeService } from './scope.service';

class LegalEntityCreateDto extends createZodDto(legalEntityCreateSchema) {}
class LegalEntityListResponse extends createZodDto(envelope(z.array(legalEntityViewSchema))) {}
class LegalEntityResponse extends createZodDto(envelope(legalEntityViewSchema)) {}
class UnitCreateDto extends createZodDto(unitCreateSchema) {}
class UnitUpdateDto extends createZodDto(unitUpdateSchema) {}
class UnitListResponse extends createZodDto(envelope(z.array(unitViewSchema))) {}
class UnitResponse extends createZodDto(envelope(unitViewSchema)) {}
class UnitKindsResponse extends createZodDto(envelope(z.array(z.string()))) {}
class MemberListResponse extends createZodDto(envelope(z.array(memberViewSchema))) {}
class ScopeConvertDto extends createZodDto(scopeConvertSchema) {}
class RolesResponse extends createZodDto(envelope(assignableRolesSchema)) {}
class AssignmentCreateDto extends createZodDto(assignmentCreateSchema) {}
class AssignmentRevokeDto extends createZodDto(assignmentRevokeSchema) {}
class AssignmentListResponse extends createZodDto(envelope(z.array(assignmentViewSchema))) {}
class AssignmentResponse extends createZodDto(envelope(assignmentViewSchema)) {}
class AccessCheckDto extends createZodDto(accessCheckSchema) {}
class AccessCheckResponse extends createZodDto(envelope(accessCheckResultSchema)) {}
class AccessMeResponse extends createZodDto(envelope(accessMeSchema)) {}
class EntitlementResponse extends createZodDto(envelope(entitlementViewSchema)) {}
class OkResponse extends createZodDto(envelope(z.object({ ok: z.literal(true) }))) {}
class ContractCreateDto extends createZodDto(contractCreateSchema) {}
class ContractEndDto extends createZodDto(contractEndSchema) {}
class ContractListResponse extends createZodDto(envelope(z.array(contractViewSchema))) {}
class ContractResponse extends createZodDto(envelope(contractViewSchema)) {}
class CountryUpsertDto extends createZodDto(countryUpsertSchema) {}
class CountryListResponse extends createZodDto(envelope(z.array(countryViewSchema))) {}
class CountryResponse extends createZodDto(envelope(countryViewSchema.nullable())) {}

type StructurePermission = 'structure.read' | 'structure.manage' | 'access.manage';

/**
 * Organization structure and delegated access for BUSINESS accounts (merchants and partners share one set of routes). The route
 * stays coarse; every handler asks ScopeService the real question (this permission, in this scope), so there is exactly one scope
 * mechanism. Another organization's id is a 404.
 */
@ScopeAware()
@ApiTags('organization-structure')
@Controller('orgs/:orgId')
@Audiences('merchant', 'partner')
export class OrgStructureController {
  constructor(
    private readonly hierarchy: HierarchyService,
    private readonly delegation: DelegationService,
    private readonly entitlements: EntitlementService,
    private readonly countries: CountryService,
    private readonly scope: ScopeService,
  ) {}

  private perm(actor: Actor, p: StructurePermission): PermissionCode {
    return `${actor.membership?.organizationType === 'PARTNER' ? 'partner' : 'merchant'}.${p}` as PermissionCode;
  }

  private own(actor: Actor, orgId: string) {
    const m = actor.membership;
    if (
      !m ||
      m.organizationId !== orgId ||
      (m.organizationType !== 'MERCHANT' && m.organizationType !== 'PARTNER')
    )
      throw AppError.notFound();
  }

  /** Holding the permission anywhere in the organization is enough to read (the data is then filtered by scope). */
  private async need(actor: Actor, orgId: string, p: StructurePermission) {
    this.own(actor, orgId);
    if (!actor.permissions.has(this.perm(actor, p)))
      throw new AppError('SCOPE_FORBIDDEN', 'You do not have permission to do this', 403);
  }

  @Get('legal-entities')
  @ApiOkResponse({ type: LegalEntityListResponse })
  async legalEntities(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.need(actor, orgId, 'structure.read');
    return this.hierarchy.listLegalEntities(orgId);
  }

  @Post('legal-entities')
  @Idempotent()
  @ApiOkResponse({ type: LegalEntityResponse })
  async createLegalEntity(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: LegalEntityCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.own(actor, orgId);
    // a legal entity belongs to the whole business account: only an organization-wide manager may create one
    await this.scope.require(actor, this.perm(actor, 'structure.manage'), {
      organizationId: orgId,
    });
    return this.hierarchy.createLegalEntity(actor, orgId, b, meta);
  }

  @Get('unit-kinds')
  @ApiOkResponse({ type: UnitKindsResponse })
  async unitKinds(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.need(actor, orgId, 'structure.read');
    return this.hierarchy.unitKinds();
  }

  @Get('units')
  @ApiOkResponse({ type: UnitListResponse })
  async units(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.need(actor, orgId, 'structure.read');
    const all = await this.hierarchy.listUnits(orgId);
    const grants = (await this.scope.grantsOf(actor)).filter((g) =>
      g.permissions.has(this.perm(actor, 'structure.read')),
    );
    if (grants.some((g) => g.set.orgWide)) return all;
    const visible = new Set<string>();
    for (const g of grants) for (const u of g.set.unitIds) visible.add(u);
    return all.filter((u) => visible.has(u.id));
  }

  @Post('units')
  @Idempotent()
  @ApiOkResponse({ type: UnitResponse })
  async createUnit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: UnitCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.own(actor, orgId);
    return this.hierarchy.createUnit(actor, orgId, b, meta);
  }

  @Patch('units/:id')
  @ApiOkResponse({ type: UnitResponse })
  async updateUnit(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: UnitUpdateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.own(actor, orgId);
    return this.hierarchy.updateUnit(actor, orgId, id, b, meta);
  }

  @Get('members')
  @ApiOkResponse({ type: MemberListResponse })
  async members(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.need(actor, orgId, 'access.manage');
    return this.delegation.members(orgId);
  }

  @Post('members/:membershipId/scoped')
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: OkResponse })
  async setScoped(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() b: ScopeConvertDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.need(actor, orgId, 'access.manage');
    await this.delegation.setScoped(actor, orgId, membershipId, b.scoped, meta);
    return { ok: true as const };
  }

  @Get('roles')
  @ApiOkResponse({ type: RolesResponse })
  async roles(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.need(actor, orgId, 'access.manage');
    return this.delegation.assignableRoles(actor);
  }

  @Get('assignments')
  @ApiOkResponse({ type: AssignmentListResponse })
  async assignments(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    await this.need(actor, orgId, 'access.manage');
    return this.delegation.list(actor, orgId);
  }

  @Post('assignments')
  @Idempotent()
  @ApiOkResponse({ type: AssignmentResponse })
  async grant(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: AssignmentCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.need(actor, orgId, 'access.manage');
    return this.delegation.grant(actor, orgId, b, meta);
  }

  @Post('assignments/:id/revoke')
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: OkResponse })
  async revoke(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: AssignmentRevokeDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.need(actor, orgId, 'access.manage');
    await this.delegation.revoke(actor, orgId, id, b.reason, meta);
    return { ok: true as const };
  }

  /** What the caller can do and where: the grants behind the permissions (useful for the UI and for support). */
  @Get('access/me')
  @ApiOkResponse({ type: AccessMeResponse })
  async accessMe(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.own(actor, orgId);
    const grants = await this.scope.grantsOf(actor);
    return {
      scoped: !!actor.membership?.scoped,
      grants: grants.map((g) => ({
        roleCode: g.roleCode,
        permissions: [...g.permissions].sort(),
        scope: { kind: g.spec.kind, ref: g.spec.ref, product: g.spec.product ?? null },
        origin: g.origin,
      })),
    };
  }

  /** Asks the one scope mechanism a yes/no question about the caller's own access. */
  @Post('access/check')
  @HttpCode(200)
  @ApiOkResponse({ type: AccessCheckResponse })
  async accessCheck(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() b: AccessCheckDto,
    @CurrentActor() actor: Actor,
  ) {
    this.own(actor, orgId);
    if (!(PERMISSION_CODES as readonly string[]).includes(b.permission))
      throw AppError.validation('Unknown permission', 'permission');
    const { permission, ...target } = b;
    return {
      allowed: await this.scope.can(actor, permission as PermissionCode, {
        organizationId: orgId,
        ...target,
      }),
    };
  }

  @Get('entitlements')
  @ApiOkResponse({ type: EntitlementResponse })
  async entitlementsOf(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.own(actor, orgId);
    return this.entitlements.effective(orgId);
  }

  @Get('market')
  @ApiOkResponse({ type: CountryResponse })
  async market(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.own(actor, orgId);
    return this.countries.forOrganization(orgId);
  }
}

/** DealDash Admin: contracts and entitlements, market configuration and a read view of any organization's structure. */
@ApiTags('admin-platform')
@Controller('admin/platform')
@Audiences('admin')
export class AdminPlatformController {
  constructor(
    private readonly contracts: ContractService,
    private readonly countries: CountryService,
    private readonly hierarchy: HierarchyService,
    private readonly entitlements: EntitlementService,
    private readonly delegation: DelegationService,
  ) {}

  @Get('contracts')
  @RequirePermissions('admin.platform.read')
  @ApiOkResponse({ type: ContractListResponse })
  list(@Query('organizationId') organizationId?: string) {
    return this.contracts.list(organizationId);
  }

  @Post('contracts')
  @Idempotent()
  @RequirePermissions('admin.contracts.manage')
  @ApiOkResponse({ type: ContractResponse })
  create(@Body() b: ContractCreateDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.contracts.create(actor, b, meta);
  }

  @Post('contracts/:id/end')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.contracts.manage')
  @ApiOkResponse({ type: OkResponse })
  async end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ContractEndDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    await this.contracts.end(actor, id, b.reason, b.effectiveUntil, meta);
    return { ok: true as const };
  }

  @Get('organizations/:orgId/entitlements')
  @RequirePermissions('admin.platform.read')
  @ApiOkResponse({ type: EntitlementResponse })
  entitlementsOf(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.entitlements.effective(orgId);
  }

  @Get('organizations/:orgId/units')
  @RequirePermissions('admin.platform.read')
  @ApiOkResponse({ type: UnitListResponse })
  units(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.hierarchy.listUnits(orgId);
  }

  @Get('organizations/:orgId/legal-entities')
  @RequirePermissions('admin.platform.read')
  @ApiOkResponse({ type: LegalEntityListResponse })
  legalEntities(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.hierarchy.listLegalEntities(orgId);
  }

  @Get('organizations/:orgId/members')
  @RequirePermissions('admin.platform.read')
  @ApiOkResponse({ type: MemberListResponse })
  members(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.delegation.members(orgId);
  }

  @Get('countries')
  @RequirePermissions('admin.platform.read')
  @ApiOkResponse({ type: CountryListResponse })
  countriesList() {
    return this.countries.list();
  }

  @Post('countries/:code')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('admin.platform.manage')
  @ApiOkResponse({ type: CountryResponse })
  upsertCountry(
    @Param('code') code: string,
    @Body() b: CountryUpsertDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.countries.upsert(actor, code, b, meta);
  }
}
