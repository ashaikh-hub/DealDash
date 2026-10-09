import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Audiences, RequirePermissions } from '../common/decorators';
import {
  OrganizationListResponse,
  OrganizationResponse,
  OrganizationsQueryDto,
} from '../common/dto';
import { AppError } from '../common/errors';
import { keysetPage, Page, parseSort } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';

const view = (o: {
  id: string;
  type: string;
  status: string;
  nameEn: string;
  nameAr: string;
  createdAt: Date;
}) => ({
  id: o.id,
  type: o.type as 'DEALDASH' | 'MERCHANT' | 'PARTNER',
  status: o.status as 'DRAFT' | 'ACTIVE' | 'SUSPENDED',
  nameEn: o.nameEn,
  nameAr: o.nameAr,
  createdAt: o.createdAt.toISOString(),
});

/** DealDash-internal cross-tenant view, available only with admin permissions. */
@ApiTags('admin')
@Controller('admin/organizations')
@Audiences('admin')
export class AdminOrganizationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('admin.org.read')
  @ApiOkResponse({ type: OrganizationListResponse })
  async list(@Query() q: OrganizationsQueryDto) {
    const page = await keysetPage({
      findMany: (query) => this.prisma.organization.findMany(query),
      baseWhere: q.type ? { type: q.type } : {},
      sort: parseSort(q.sort, { field: 'createdAt', dir: 'desc' }),
      limit: q.limit,
      cursor: q.cursor,
    });
    return new Page(page.items.map(view), page.nextCursor);
  }

  @Get(':id')
  @RequirePermissions('admin.org.read')
  @ApiOkResponse({ type: OrganizationResponse })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw AppError.notFound();
    return view(org);
  }
}
