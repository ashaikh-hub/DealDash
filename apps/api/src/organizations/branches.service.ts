import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { TenantService } from '../identity/tenant.service';
import { AccessScopeService } from '../platform/access-scope.service';
import { EntitlementService } from '../platform/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from '../subscription/usage.service';

type BranchRow = {
  id: string;
  organizationId: string;
  nameEn: string;
  nameAr: string;
  addressEn: string;
  addressAr: string;
  city: string;
  latitude: Prisma.Decimal | number | null;
  longitude: Prisma.Decimal | number | null;
  status: string;
  phone?: string | null;
  hours?: unknown;
  holidayHours?: unknown;
};

export const branchView = (b: BranchRow) => ({
  id: b.id,
  organizationId: b.organizationId,
  nameEn: b.nameEn,
  nameAr: b.nameAr,
  addressEn: b.addressEn,
  addressAr: b.addressAr,
  city: b.city,
  latitude: b.latitude === null ? null : Number(b.latitude),
  longitude: b.longitude === null ? null : Number(b.longitude),
  status: b.status,
  phone: b.phone ?? null,
  hours: b.hours ?? null,
  holidayHours: b.holidayHours ?? null,
});

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly access: AccessScopeService,
    private readonly entitlements: EntitlementService,
    private readonly usage: UsageService,
  ) {}

  /** Tenant-scoped: always filtered by organisation, and by branch for branch-scoped memberships. */
  async list(actor: Actor, organizationId: string) {
    const visible = await this.access.visibleBranches(actor, 'merchant.branch.read');
    const rows = await this.prisma.merchantBranch.findMany({
      where: {
        organizationId,
        ...this.tenant.branchScopeWhere(actor),
        ...(visible ? { id: { in: [...visible] } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(branchView);
  }

  async get(actor: Actor, organizationId: string, branchId: string) {
    this.tenant.assertBranchAccess(actor, branchId);
    await this.access.branch(actor, 'merchant.branch.read', branchId);
    const row = await this.prisma.merchantBranch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!row) throw AppError.notFound();
    return branchView(row);
  }

  async create(
    actor: Actor,
    organizationId: string,
    input: {
      nameEn: string;
      nameAr: string;
      addressEn: string;
      addressAr: string;
      city: string;
      latitude: number;
      longitude: number;
      phone?: string;
      hours?: unknown;
      holidayHours?: unknown;
    },
    meta: RequestMeta,
  ) {
    // Branch staff can never create branches; a scoped member needs an organization-wide grant.
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
    await this.access.org(actor, 'merchant.branch.manage');
    await this.requireEditable(organizationId);
    // the plan's branch limit (HARD refuses, SOFT warns / charges) and the new-exposure rule of a suspended or ended agreement
    await this.entitlements.requireNewExposure(organizationId, 'ADD_BRANCH');
    await this.usage.assertResourceWithin(organizationId, 'branches.max');
    return this.prisma.$transaction(async (tx) => {
      const { hours, holidayHours, ...rest } = input;
      const row = await tx.merchantBranch.create({
        data: {
          organizationId,
          ...rest,
          hours: (hours ?? undefined) as Prisma.InputJsonValue | undefined,
          holidayHours: (holidayHours ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await this.audit.record(
        {
          action: 'merchant.branch.created',
          entityType: 'MerchantBranch',
          entityId: row.id,
          newState: branchView(row),
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
      return branchView(row);
    });
  }

  /** Branch edits are locked while a submitted application is awaiting review. */
  private async requireEditable(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { application: true },
    });
    if (!org) throw AppError.notFound();
    if (org.status === 'SUSPENDED')
      throw new AppError('ORG_NOT_ACTIVE', 'This account is suspended', 409);
    const s = org.application?.status;
    if (org.status === 'DRAFT' && s && !['DRAFT', 'CHANGES_REQUESTED', 'APPROVED'].includes(s)) {
      throw new AppError(
        'APPLICATION_LOCKED',
        'Branches cannot be changed while the application is under review',
        409,
      );
    }
  }

  async update(
    actor: Actor,
    organizationId: string,
    branchId: string,
    input: Partial<{
      nameEn: string;
      nameAr: string;
      addressEn: string;
      addressAr: string;
      city: string;
      latitude: number;
      longitude: number;
      phone: string;
      hours: unknown;
      holidayHours: unknown;
    }>,
    meta: RequestMeta,
  ) {
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
    await this.access.branch(actor, 'merchant.branch.manage', branchId);
    await this.requireEditable(organizationId);
    const before = await this.prisma.merchantBranch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!before) throw AppError.notFound();
    const { hours, holidayHours, ...rest } = input;
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.merchantBranch.update({
        where: { id: branchId },
        data: {
          ...rest,
          ...(hours !== undefined ? { hours: hours as Prisma.InputJsonValue } : {}),
          ...(holidayHours !== undefined
            ? { holidayHours: holidayHours as Prisma.InputJsonValue }
            : {}),
        },
      });
      await this.audit.record(
        {
          action: 'merchant.branch.updated',
          entityType: 'MerchantBranch',
          entityId: row.id,
          previousState: branchView(before),
          newState: branchView(row),
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
      return branchView(row);
    });
  }

  async setStatus(
    actor: Actor,
    organizationId: string,
    branchId: string,
    status: 'ACTIVE' | 'CLOSED',
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
    await this.access.branch(actor, 'merchant.branch.manage', branchId);
    await this.requireEditable(organizationId);
    const before = await this.prisma.merchantBranch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!before) throw AppError.notFound();
    if (before.status === status) return branchView(before);
    if (status === 'CLOSED') {
      const org = await this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
      });
      const active = await this.prisma.merchantBranch.count({
        where: { organizationId, status: 'ACTIVE' },
      });
      if (org.status === 'ACTIVE' && active <= 1)
        throw new AppError(
          'LAST_ACTIVE_BRANCH',
          'An active merchant must keep at least one active branch',
          409,
        );
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.merchantBranch.update({ where: { id: branchId }, data: { status } });
      await this.audit.record(
        {
          action: status === 'CLOSED' ? 'merchant.branch.closed' : 'merchant.branch.reopened',
          entityType: 'MerchantBranch',
          entityId: row.id,
          reason,
          previousState: { status: before.status },
          newState: { status },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
      return branchView(row);
    });
  }
  /**
   * Nearby search with PostGIS: geography distance in metres, ST_DWithin radius filter (uses the GiST index).
   * Raw SQL with bound parameters only (no string concatenation). Public discovery data only.
   */
  async nearby(lat: number, lng: number, radiusMeters: number, limit: number) {
    const rows = await this.prisma.$queryRaw<
      Array<BranchRow & { distance: number; latitude: number; longitude: number }>
    >(Prisma.sql`
      SELECT b."id", b."organizationId", b."nameEn", b."nameAr", b."addressEn", b."addressAr", b."city",
             b."latitude"::float8 AS "latitude", b."longitude"::float8 AS "longitude", b."status"::text AS "status",
             ST_Distance(b."location", ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography) AS "distance"
      FROM "MerchantBranch" b
      WHERE b."status" = 'ACTIVE'
        AND b."location" IS NOT NULL
        AND ST_DWithin(b."location", ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::geography, ${radiusMeters}::float8)
      ORDER BY "distance" ASC
      LIMIT ${limit}::int
    `);
    return rows.map((r) => ({ ...branchView(r), distanceMeters: Math.round(Number(r.distance)) }));
  }
}
