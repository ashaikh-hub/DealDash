import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { DEFAULT_UNIT_KINDS } from '@dealdash/types';
import type { LegalEntityView, UnitView } from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { ScopeService } from './scope.service';

/**
 * Business Account (the Organization) -> Legal Entities -> flexible Organization Units. A legal entity is a real legal and billing
 * party with its own country, currency and tax profile; a unit is an operating label (brand, franchisee, region, branch ...).
 * Brand, legal entity, franchisee, branch owner and settlement entity are all separate and are never assumed equal.
 */
@Injectable()
export class HierarchyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly scope: ScopeService,
  ) {}

  // ---------------------------------------------------------------- legal entities
  async listLegalEntities(organizationId: string): Promise<LegalEntityView[]> {
    const rows = await this.prisma.legalEntity.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id,
      legalName: r.legalName,
      registrationNumber: r.registrationNumber,
      taxNumber: r.taxNumber,
      country: r.country,
      currency: r.currency,
      status: r.status,
    }));
  }

  async createLegalEntity(
    actor: Actor,
    organizationId: string,
    b: { legalName: string; registrationNumber?: string; taxNumber?: string; country: string; currency: string },
    meta: RequestMeta,
  ): Promise<LegalEntityView> {
    const country = await this.prisma.countryConfiguration.findUnique({ where: { code: b.country } });
    if (!country) throw AppError.validation('This country is not configured', 'country');
    const dup = await this.prisma.legalEntity.findUnique({
      where: { organizationId_legalName: { organizationId, legalName: b.legalName } },
    });
    if (dup) throw new AppError('INVALID_STATE', 'A legal entity with this name already exists', 409);
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.legalEntity.create({
        data: {
          organizationId,
          legalName: b.legalName,
          registrationNumber: b.registrationNumber ?? null,
          taxNumber: b.taxNumber ?? null,
          country: b.country,
          currency: b.currency,
        },
      });
      await this.audit.record(
        {
          action: 'LEGAL_ENTITY_CREATED',
          entityType: 'LegalEntity',
          entityId: r.id,
          actor,
          subjectOrganizationId: organizationId,
          newState: { legalName: r.legalName, country: r.country, currency: r.currency },
          scope: 'ORGANIZATION',
          meta,
        },
        tx,
      );
      return r;
    });
    this.scope.invalidate(organizationId);
    return {
      id: row.id,
      legalName: row.legalName,
      registrationNumber: row.registrationNumber,
      taxNumber: row.taxNumber,
      country: row.country,
      currency: row.currency,
      status: row.status,
    };
  }

  // ---------------------------------------------------------------- units
  async unitKinds(): Promise<string[]> {
    const c = await this.config.get<{ kinds?: string[] }>(CONFIG_KEYS.PLATFORM_UNIT_KINDS);
    return c.kinds?.length ? c.kinds : [...DEFAULT_UNIT_KINDS];
  }

  async listUnits(organizationId: string): Promise<UnitView[]> {
    const units = await this.prisma.organizationUnit.findMany({
      where: { organizationId },
      orderBy: [{ depth: 'asc' }, { code: 'asc' }],
    });
    const byId = new Map(units.map((u) => [u.id, u]));
    const eff = (u: (typeof units)[number], pick: (x: (typeof units)[number]) => string | null) => {
      for (let cur: (typeof units)[number] | undefined = u, g = 0; cur && g < 64; g++, cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
        const v = pick(cur);
        if (v) return v;
      }
      return null;
    };
    return units.map((u) => ({
      id: u.id,
      parentId: u.parentId,
      kind: u.kind,
      code: u.code,
      name: { en: u.nameEn, ar: u.nameAr },
      legalEntityId: u.legalEntityId,
      effectiveLegalEntityId: eff(u, (x) => x.legalEntityId),
      operatorLegalEntityId: u.operatorLegalEntityId,
      settlementLegalEntityId: u.settlementLegalEntityId,
      country: u.country,
      effectiveCountry: eff(u, (x) => x.country),
      city: u.city,
      branchId: u.branchId,
      depth: u.depth,
      status: u.status,
    }));
  }

  private async assertLegalEntities(organizationId: string, ids: Array<string | null | undefined>) {
    for (const id of ids.filter((x): x is string => !!x)) {
      const le = await this.prisma.legalEntity.findFirst({ where: { id, organizationId } });
      if (!le) throw AppError.validation('The legal entity was not found in this business account', 'legalEntityId');
    }
  }

  async createUnit(
    actor: Actor,
    organizationId: string,
    b: {
      kind: string;
      code: string;
      nameEn: string;
      nameAr: string;
      parentId: string | null;
      legalEntityId: string | null;
      operatorLegalEntityId: string | null;
      settlementLegalEntityId: string | null;
      country: string | null;
      city: string | null;
      branchId: string | null;
    },
    meta: RequestMeta,
  ): Promise<UnitView> {
    const kinds = await this.unitKinds();
    if (!kinds.includes(b.kind)) throw AppError.validation('This kind of unit is not allowed', 'kind');
    const parent = b.parentId
      ? await this.prisma.organizationUnit.findFirst({ where: { id: b.parentId, organizationId } })
      : null;
    if (b.parentId && !parent) throw AppError.validation('The parent unit was not found', 'parentId');
    // creating under a parent needs authority over the parent: nobody adds structure outside their own scope
    await this.scope.require(actor, actor.membership?.organizationType === 'PARTNER' ? 'partner.structure.manage' : 'merchant.structure.manage', {
      organizationId,
      unitId: parent?.id ?? null,
    });
    await this.assertLegalEntities(organizationId, [b.legalEntityId, b.operatorLegalEntityId, b.settlementLegalEntityId]);
    if (b.country) {
      const c = await this.prisma.countryConfiguration.findUnique({ where: { code: b.country } });
      if (!c) throw AppError.validation('This country is not configured', 'country');
    }
    if (b.branchId) {
      const br = await this.prisma.merchantBranch.findFirst({ where: { id: b.branchId, organizationId } });
      if (!br) throw AppError.validation('The branch was not found', 'branchId');
      if (await this.prisma.organizationUnit.findUnique({ where: { branchId: b.branchId } }))
        throw new AppError('INVALID_STATE', 'This branch already has a unit', 409);
    }
    const id = randomUUID();
    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const r = await tx.organizationUnit.create({
          data: {
            id,
            organizationId,
            parentId: parent?.id ?? null,
            kind: b.kind,
            code: b.code,
            nameEn: b.nameEn,
            nameAr: b.nameAr,
            legalEntityId: b.legalEntityId,
            operatorLegalEntityId: b.operatorLegalEntityId,
            settlementLegalEntityId: b.settlementLegalEntityId,
            country: b.country,
            city: b.city,
            branchId: b.branchId,
            path: `${parent?.path ?? '/'}${id}/`,
            depth: (parent?.depth ?? -1) + 1,
            createdByUserId: actor.userId,
          },
        });
        await this.audit.record(
          {
            action: 'ORG_UNIT_CREATED',
            entityType: 'OrganizationUnit',
            entityId: r.id,
            actor,
            subjectOrganizationId: organizationId,
            newState: { kind: r.kind, code: r.code, parentId: r.parentId, branchId: r.branchId },
            scope: parent ? `UNIT:${parent.id}` : 'ORGANIZATION',
            meta,
          },
          tx,
        );
        return r;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new AppError('INVALID_STATE', 'A unit with this code already exists', 409);
      throw e;
    }
    this.scope.invalidate(organizationId);
    return (await this.listUnits(organizationId)).find((u) => u.id === row.id)!;
  }

  async updateUnit(
    actor: Actor,
    organizationId: string,
    id: string,
    b: {
      nameEn?: string;
      nameAr?: string;
      legalEntityId?: string | null;
      operatorLegalEntityId?: string | null;
      settlementLegalEntityId?: string | null;
      status?: 'ACTIVE' | 'INACTIVE';
    },
    meta: RequestMeta,
  ): Promise<UnitView> {
    const u = await this.prisma.organizationUnit.findFirst({ where: { id, organizationId } });
    if (!u) throw AppError.notFound();
    await this.scope.require(actor, actor.membership?.organizationType === 'PARTNER' ? 'partner.structure.manage' : 'merchant.structure.manage', {
      organizationId,
      unitId: u.id,
    });
    await this.assertLegalEntities(organizationId, [b.legalEntityId, b.operatorLegalEntityId, b.settlementLegalEntityId]);
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationUnit.update({ where: { id }, data: b });
      await this.audit.record(
        {
          action: 'ORG_UNIT_UPDATED',
          entityType: 'OrganizationUnit',
          entityId: id,
          actor,
          subjectOrganizationId: organizationId,
          previousState: {
            nameEn: u.nameEn,
            nameAr: u.nameAr,
            legalEntityId: u.legalEntityId,
            operatorLegalEntityId: u.operatorLegalEntityId,
            settlementLegalEntityId: u.settlementLegalEntityId,
            status: u.status,
          },
          newState: b,
          scope: `UNIT:${id}`,
          meta,
        },
        tx,
      );
    });
    this.scope.invalidate(organizationId);
    return (await this.listUnits(organizationId)).find((x) => x.id === id)!;
  }
}
