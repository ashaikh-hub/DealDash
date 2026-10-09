import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Audiences, CurrentActor, RequirePermissions } from '../common/decorators';
import { PartnerResponse } from '../common/dto';
import { AppError } from '../common/errors';
import type { Actor } from '../common/request-context';
import { TenantService } from '../identity/tenant.service';
import { PrismaService } from '../prisma/prisma.service';

/** Partner tenant routes: Bank A can never read Bank B, Employer A never Employer B (404). */
@ApiTags('partners')
@Controller('partners/:orgId')
@Audiences('partner')
export class PartnersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
  ) {}

  @Get()
  @RequirePermissions('partner.profile.read')
  @ApiOkResponse({ type: PartnerResponse })
  async profile(@Param('orgId', ParseUUIDPipe) orgId: string, @CurrentActor() actor: Actor) {
    this.tenant.requireOwnOrganization(actor, orgId, 'PARTNER');
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, type: 'PARTNER' },
      include: { partner: true },
    });
    if (!org?.partner) throw AppError.notFound();
    return {
      organizationId: org.id,
      nameEn: org.nameEn,
      nameAr: org.nameAr,
      partnerType: org.partner.partnerType,
      status: org.status,
    };
  }
}
