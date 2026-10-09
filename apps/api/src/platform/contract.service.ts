import { Injectable } from '@nestjs/common';
import { ENTITLEMENT_PRODUCT_OF, IN_FORCE_LIFECYCLE, PLATFORM_FEATURES, PLATFORM_LIMITS, PLATFORM_PRODUCTS } from '@dealdash/types';
import type { z } from 'zod';
import type { contractCreateSchema } from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

type ContractInput = z.infer<typeof contractCreateSchema>;
void ENTITLEMENT_PRODUCT_OF;

/**
 * Contracts carry the product, feature and limit entitlements. Nothing is overwritten: ending a contract keeps it, and a new contract
 * starts where the previous one ended. DealDash Admin is the only party that manages contracts.
 */
@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private validateEntitlements(items: ContractInput['entitlements']) {
    for (const e of items) {
      const ok =
        e.kind === 'PRODUCT'
          ? (PLATFORM_PRODUCTS as readonly string[]).includes(e.key)
          : e.kind === 'FEATURE'
            ? (PLATFORM_FEATURES as readonly string[]).includes(e.key)
            : (PLATFORM_LIMITS as readonly string[]).includes(e.key) && e.limitValue !== null;
      if (!ok) throw AppError.validation(`Unknown ${e.kind.toLowerCase()} entitlement "${e.key}"`, 'entitlements');
    }
  }

  private view(c: Awaited<ReturnType<ContractService['load']>>[number]) {
    return {
      id: c.id,
      organizationId: c.organizationId,
      legalEntityId: c.legalEntityId,
      name: c.name,
      reference: c.reference,
      planCode: c.planCode,
      status: c.status,
      kind: c.kind,
      market: c.market,
      currency: c.currency,
      billingCadence: c.billingCadence,
      renewalState: c.renewalState,
      version: c.version,
      planVersionId: c.planVersionId,
      billingLegalEntityId: c.billingLegalEntityId,
      effectiveFrom: c.effectiveFrom.toISOString(),
      effectiveUntil: c.effectiveUntil?.toISOString() ?? null,
      entitlements: c.entitlements.map((e) => ({
        kind: e.kind as 'PRODUCT' | 'FEATURE' | 'LIMIT',
        key: e.key,
        enabled: e.enabled,
        limitValue: e.limitValue,
        source: e.source,
        mode: e.mode,
        period: e.period,
      })),
    };
  }

  private load(where: Record<string, unknown>) {
    return this.prisma.contract.findMany({
      where,
      include: { entitlements: true },
      orderBy: { effectiveFrom: 'desc' },
      take: 200,
    });
  }

  async list(organizationId?: string) {
    return (await this.load(organizationId ? { organizationId } : {})).map((c) => this.view(c));
  }

  async create(actor: Actor, b: ContractInput, meta: RequestMeta) {
    const org = await this.prisma.organization.findUnique({ where: { id: b.organizationId } });
    if (!org) throw AppError.validation('The organization was not found', 'organizationId');
    if (b.legalEntityId) {
      const le = await this.prisma.legalEntity.findFirst({ where: { id: b.legalEntityId, organizationId: b.organizationId } });
      if (!le) throw AppError.validation('The legal entity was not found', 'legalEntityId');
    }
    for (const id of [...b.coveredLegalEntityIds, ...(b.billingLegalEntityId ? [b.billingLegalEntityId] : [])]) {
      const le = await this.prisma.legalEntity.findFirst({ where: { id, organizationId: b.organizationId } });
      if (!le) throw AppError.validation('A covered or billing legal entity was not found in this business', 'coveredLegalEntityIds');
    }
    this.validateEntitlements(b.entitlements);
    const from = b.effectiveFrom ? new Date(b.effectiveFrom) : new Date();
    const until = b.effectiveUntil ? new Date(b.effectiveUntil) : null;
    if (until && until <= from) throw AppError.validation('The contract must end after it starts', 'effectiveUntil');
    const created = await this.prisma.$transaction(async (tx) => {
      // the previous open contract for the same party ends exactly when this one starts (history is kept)
      const open = await tx.contract.findMany({
        where: { organizationId: b.organizationId, legalEntityId: b.legalEntityId, status: { in: [...IN_FORCE_LIFECYCLE] }, effectiveUntil: null },
      });
      for (const o of open) {
        if (from <= o.effectiveFrom) throw AppError.validation('A newer contract already exists from this date', 'effectiveFrom');
        await tx.contract.update({ where: { id: o.id }, data: { status: 'SUPERSEDED', effectiveUntil: from } });
        await tx.contractEntitlement.updateMany({
          where: { contractId: o.id, effectiveUntil: null },
          data: { effectiveUntil: from },
        });
      }
      const c = await tx.contract.create({
        data: {
          organizationId: b.organizationId,
          legalEntityId: b.legalEntityId,
          name: b.name,
          reference: b.reference ?? null,
          planCode: b.planCode ?? null,
          kind: b.kind,
          market: b.market ?? null,
          currency: b.currency ?? null,
          billingCadence: b.billingCadence,
          billingLegalEntityId: b.billingLegalEntityId,
          renewalState: b.renewalState,
          activatedAt: from,
          effectiveFrom: from,
          effectiveUntil: until,
          createdByUserId: actor.userId,
          coverage: { create: b.coveredLegalEntityIds.map((id) => ({ legalEntityId: id, role: 'COVERED' })) },
          entitlements: {
            create: b.entitlements.map((e) => ({
              kind: e.kind,
              key: e.key,
              enabled: e.enabled,
              limitValue: e.kind === 'LIMIT' ? e.limitValue : null,
              mode: e.mode,
              period: e.period,
              softAction: e.softAction,
              effectiveFrom: from,
              effectiveUntil: until,
            })),
          },
        },
      });
      await this.audit.record(
        {
          action: 'CONTRACT_CREATED',
          entityType: 'Contract',
          entityId: c.id,
          actor,
          subjectOrganizationId: b.organizationId,
          newState: { name: b.name, entitlements: b.entitlements, effectiveFrom: from, effectiveUntil: until },
          scope: b.legalEntityId ? `LEGAL_ENTITY:${b.legalEntityId}` : 'ORGANIZATION',
          meta,
        },
        tx,
      );
      return c;
    });
    return this.view((await this.load({ id: created.id }))[0]!);
  }

  async end(actor: Actor, id: string, reason: string, effectiveUntil: string | undefined, meta: RequestMeta) {
    const c = await this.prisma.contract.findUnique({ where: { id } });
    if (!c) throw AppError.notFound();
    if (!(IN_FORCE_LIFECYCLE as readonly string[]).includes(c.status)) throw new AppError('INVALID_STATE', 'This contract has already ended', 409);
    const until = effectiveUntil ? new Date(effectiveUntil) : new Date();
    if (until <= c.effectiveFrom) throw AppError.validation('The end must be after the start', 'effectiveUntil');
    await this.prisma.$transaction(async (tx) => {
      await tx.contract.update({ where: { id }, data: { status: 'CANCELLED', effectiveUntil: until, cancelledAt: new Date() } });
      await tx.contractEntitlement.updateMany({ where: { contractId: id, effectiveUntil: null }, data: { effectiveUntil: until } });
      await this.audit.record(
        {
          action: 'CONTRACT_ENDED',
          entityType: 'Contract',
          entityId: id,
          actor,
          subjectOrganizationId: c.organizationId,
          reason,
          newState: { effectiveUntil: until },
          meta,
        },
        tx,
      );
    });
  }
}
