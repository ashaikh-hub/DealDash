import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import type { ApprovalStep, CommercialProduct, PricingComponent, UnusedTreatment } from '@dealdash/types';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import type { PricingContext } from './quote.calculator';

export interface ResolvedPricing extends PricingContext {
  source: 'AGREEMENT' | 'DEFAULT';
  reference: string | null;
  versionKey: string;
  versionId: string | null;
  unusedTreatment: UnusedTreatment | null;
}

interface DefaultPricing {
  version: number;
  currency: string;
  taxBps: number | null;
  unusedTreatment: UnusedTreatment | null;
  products: Record<string, PricingComponent[]>;
}

/**
 * Resolves the pricing that applies to an organisation and product: the most specific active agreement version wins
 * (organisation, then entity type, then global; lower `priority` first), otherwise the Admin default. Nothing here is a
 * hard-coded rate.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
  ) {}

  async resolve(organizationId: string, product: CommercialProduct, now = new Date()): Promise<ResolvedPricing> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    });
    const rows = await this.prisma.pricingAgreement.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { scope: 'ORGANIZATION', organizationId },
          { scope: 'ENTITY_TYPE', entityType: org?.type ?? '__none__' },
          { scope: 'GLOBAL' },
        ],
        AND: [{ OR: [{ product: null }, { product }] }],
      },
      include: {
        versions: {
          where: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    const rank = { ORGANIZATION: 0, ENTITY_TYPE: 1, GLOBAL: 2 } as const;
    const best = rows
      .filter((r) => r.versions.length)
      .sort((a, b) => rank[a.scope] - rank[b.scope] || a.priority - b.priority)[0];
    const def = await this.config.get<DefaultPricing>(CONFIG_KEYS.COMMERCIAL_DEFAULT_PRICING);
    if (best) {
      const v = best.versions[0]!;
      const comps = (v.components as unknown as Record<string, PricingComponent[]>)[product];
      return {
        components: comps ?? def.products[product] ?? [],
        taxBps: v.taxBps,
        currency: def.currency,
        source: 'AGREEMENT',
        reference: v.reference ?? best.name,
        versionKey: `A:${v.id}`,
        versionId: v.id,
        unusedTreatment: v.unusedTreatment ?? def.unusedTreatment,
      };
    }
    return {
      components: def.products[product] ?? [],
      taxBps: def.taxBps,
      currency: def.currency,
      source: 'DEFAULT',
      reference: null,
      versionKey: `D:${def.version}`,
      versionId: null,
      unusedTreatment: def.unusedTreatment,
    };
  }

  /**
   * Development and test fixtures only: a clearly marked GLOBAL agreement that states what happens to unused funding. Real
   * environments must configure their own agreements; without one, campaigns with sponsor funding or a pre-funded budget cannot
   * go live (founder decision: the treatment of unused funding is agreement-driven and never defaulted).
   */
  async ensureDevAgreement() {
    if (process.env.NODE_ENV === 'production') throw new Error('Not available in production');
    const name = 'DEV FIXTURE agreement (MOCK, not a real commercial agreement)';
    const found = await this.prisma.pricingAgreement.findFirst({ where: { name } });
    if (found) return found.id;
    const def = await this.config.get<DefaultPricing>(CONFIG_KEYS.COMMERCIAL_DEFAULT_PRICING);
    const a = await this.prisma.pricingAgreement.create({
      data: {
        name,
        scope: 'GLOBAL',
        priority: 900,
        createdByUserId: '00000000-0000-0000-0000-000000000000',
        versions: {
          create: {
            version: 1,
            components: def.products as unknown as Prisma.InputJsonValue,
            taxBps: def.taxBps,
            unusedTreatment: 'CREDIT_ACCOUNT',
            reference: 'DEV-FIXTURE',
            createdByUserId: '00000000-0000-0000-0000-000000000000',
          },
        },
      },
    });
    return a.id;
  }

  /**
   * The approval steps a campaign needs. Business-configured rules decide (liability, entity type, product, risk tier); with no
   * matching rule nothing extra is required, so a small merchant is never forced into maker-checker.
   */
  async workflow(
    organizationId: string,
    product: CommercialProduct,
    liabilityHalalas: number,
    scope: 'CAMPAIGN' | 'CREDIT' = 'CAMPAIGN',
  ): Promise<ApprovalStep[]> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    });
    const rules = await this.prisma.commercialApprovalRule.findMany({
      where: { active: true, scope },
      orderBy: { priority: 'asc' },
    });
    const hit = rules.find(
      (r) =>
        (!r.product || r.product === product) &&
        (!r.entityType || r.entityType === org?.type) &&
        (!r.organizationId || r.organizationId === organizationId) &&
        (r.minLiabilityHalalas === null || liabilityHalalas >= r.minLiabilityHalalas),
    );
    return hit ? ((hit.steps as ApprovalStep[]) ?? []) : [];
  }
}
