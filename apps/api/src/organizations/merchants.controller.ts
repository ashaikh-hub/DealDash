import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  RequirePermissions,
  ScopeAware,
} from '../common/decorators';
import {
  BranchListResponse,
  BranchResponse,
  CreateBranchDto,
  MerchantResponse,
} from '../common/dto';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { TenantService } from '../identity/tenant.service';
import { PrismaService } from '../prisma/prisma.service';
import { BranchesService } from './branches.service';

/** Merchant tenant routes: strictly the caller's own organisation (other ids return 404). */
@ApiTags('merchants')
@Controller('merchants/:orgId')
@Audiences('merchant', 'staff')
export class MerchantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly branches: BranchesService,
  ) {}

  @ScopeAware()
  @Get()
  @RequirePermissions('merchant.profile.read')
  @ApiOkResponse({ type: MerchantResponse })
  async profile(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, type: 'MERCHANT' },
      include: { merchant: true },
    });
    if (!org?.merchant) throw AppError.notFound();
    return {
      organizationId: org.id,
      nameEn: org.nameEn,
      nameAr: org.nameAr,
      legalName: org.merchant.legalName,
      status: org.status,
    };
  }

  @ScopeAware()
  @Get('branches')
  @RequirePermissions('merchant.branch.read')
  @ApiOkResponse({ type: BranchListResponse })
  async listBranches(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    return this.branches.list(actor, orgId);
  }

  @ScopeAware()
  @Get('branches/:branchId')
  @RequirePermissions('merchant.branch.read')
  @ApiOkResponse({ type: BranchResponse })
  async getBranch(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @CurrentActor() actor: Actor,
  ) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    return this.branches.get(actor, orgId, branchId);
  }

  @ScopeAware()
  @Post('branches')
  @Idempotent()
  @RequirePermissions('merchant.branch.manage')
  @ApiOkResponse({ type: BranchResponse })
  async createBranch(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() body: CreateBranchDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    this.tenant.requireOwnOrganization(actor, orgId, 'MERCHANT');
    return this.branches.create(actor, orgId, body, meta);
  }
}
