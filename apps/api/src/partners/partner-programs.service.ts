import { Injectable } from '@nestjs/common';
import {
  looksLikeCardNumber,
  type EligibilityAttributeType,
  type EligibilityExpression,
  type EligibilityLevel,
} from '@dealdash/types';
import type { cardProgramSchema, employerProgramSchema } from '@dealdash/validation';
import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { DealCoreService } from '../live-deals/deal-core.service';
import { EligibilityService, evaluateExpressionOutcome } from '../live-deals/eligibility.service';
import { PartnerAccessService, type PartnerRow } from './partner-access.service';

type CardProgramInput = z.infer<typeof cardProgramSchema>;
type EmployerProgramInput = z.infer<typeof employerProgramSchema>;

/**
 * Card programmes, employer programmes and saved eligibility rules. Rules are stored and evaluated by the SHARED eligibility engine
 * (EligibilityRuleSet + EligibilityService): the portal only builds the tree. Card data is limited to BIN / IIN prefixes with issuer,
 * scheme, product and tier; a customer's card link is never "verified" without evidence from the programme's verification method.
 */
@Injectable()
export class PartnerProgramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: PartnerAccessService,
    private readonly eligibility: EligibilityService,
    private readonly liveCore: DealCoreService,
  ) {}

  // ---------------------------------------------------------------- card programmes
  async cardPrograms(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireModule(p, 'CARD_PROGRAMS');
    const markets = await this.access.authorizedMarkets(actor, p, 'partner.eligibility.read');
    const rows = await this.prisma.partnerCardProgram.findMany({
      where: { partnerOrganizationId: organizationId, market: { in: markets } },
      orderBy: [{ status: 'asc' }, { code: 'asc' }],
    });
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async saveCardProgram(
    actor: Actor,
    organizationId: string,
    b: CardProgramInput,
    meta: RequestMeta,
  ) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireModule(p, 'CARD_PROGRAMS');
    await this.access.requireMarket(actor, p, b.market, 'partner.eligibility.manage');
    for (const v of [b.code, b.nameEn, b.nameAr, b.issuerName, b.productCode])
      if (looksLikeCardNumber(v))
        throw new AppError('CARD_DATA_FORBIDDEN', 'Card numbers are never stored', 422);
    const existing = await this.prisma.partnerCardProgram.findUnique({
      where: {
        partnerOrganizationId_code: { partnerOrganizationId: organizationId, code: b.code },
      },
    });
    const data = {
      nameEn: b.nameEn,
      nameAr: b.nameAr,
      scheme: b.scheme,
      issuerName: b.issuerName,
      productCode: b.productCode,
      tier: b.tier,
      binPrefixes: [...new Set(b.binPrefixes)],
      market: b.market,
      verificationMethod: b.verificationMethod,
      status: b.status,
    };
    const row = existing
      ? await this.prisma.partnerCardProgram.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await this.prisma.partnerCardProgram.create({
          data: {
            ...data,
            partnerOrganizationId: organizationId,
            code: b.code,
            createdByUserId: actor.userId,
          },
        });
    await this.audit.record({
      action: existing ? 'partner.card_program.updated' : 'partner.card_program.created',
      entityType: 'PartnerCardProgram',
      entityId: row.id,
      previousState: existing
        ? {
            status: existing.status,
            tier: existing.tier,
            binPrefixes: existing.binPrefixes.length,
            version: existing.version,
          }
        : null,
      newState: {
        code: row.code,
        status: row.status,
        tier: row.tier,
        binPrefixes: row.binPrefixes.length,
        version: row.version,
      },
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return row;
  }

  // ---------------------------------------------------------------- employer / corporate programmes
  async employerPrograms(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireModule(p, 'EMPLOYER_PROGRAMS');
    const markets = await this.access.authorizedMarkets(actor, p, 'partner.eligibility.read');
    const rows = await this.prisma.partnerEmployerProgram.findMany({
      where: { partnerOrganizationId: organizationId, market: { in: markets } },
      orderBy: { code: 'asc' },
    });
    // aggregate only: how many customers verified a work email of this employer (never who)
    const verified = await this.prisma.eligibilityAttribute.count({
      where: { attrType: 'EMPLOYER', valueRef: organizationId, status: 'VERIFIED' },
    });
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      verifiedMembers: verified,
    }));
  }

  async saveEmployerProgram(
    actor: Actor,
    organizationId: string,
    b: EmployerProgramInput,
    meta: RequestMeta,
  ) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireModule(p, 'EMPLOYER_PROGRAMS');
    await this.access.requireMarket(actor, p, b.market, 'partner.eligibility.manage');
    // a domain belongs to one employer programme across DealDash (otherwise one company could unlock another's benefits)
    const clash = await this.prisma.partnerEmployerProgram.findFirst({
      where: {
        partnerOrganizationId: { not: organizationId },
        status: { not: 'RETIRED' },
        domains: { hasSome: b.domains },
      },
    });
    if (clash)
      throw AppError.conflict(
        'VALIDATION_FAILED',
        'One of these e-mail domains is already used by another employer programme',
      );
    const existing = await this.prisma.partnerEmployerProgram.findUnique({
      where: {
        partnerOrganizationId_code: { partnerOrganizationId: organizationId, code: b.code },
      },
    });
    const data = {
      nameEn: b.nameEn,
      nameAr: b.nameAr,
      domains: [...new Set(b.domains)],
      market: b.market,
      status: b.status,
    };
    const row = existing
      ? await this.prisma.partnerEmployerProgram.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
        })
      : await this.prisma.partnerEmployerProgram.create({
          data: {
            ...data,
            partnerOrganizationId: organizationId,
            code: b.code,
            createdByUserId: actor.userId,
          },
        });
    await this.audit.record({
      action: existing ? 'partner.employer_program.updated' : 'partner.employer_program.created',
      entityType: 'PartnerEmployerProgram',
      entityId: row.id,
      newState: { code: row.code, status: row.status, domains: row.domains, version: row.version },
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return row;
  }

  // ---------------------------------------------------------------- eligibility rules (shared engine)
  /** What the builder may offer this partner: its type's attributes, its own card programmes / employer programmes, enabled cities. */
  async builderOptions(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    const profile = await this.access.profileOf(p.partnerType);
    const cards = await this.prisma.partnerCardProgram.findMany({
      where: { partnerOrganizationId: organizationId, status: 'ACTIVE' },
      select: {
        code: true,
        nameEn: true,
        nameAr: true,
        scheme: true,
        productCode: true,
        tier: true,
      },
    });
    const employers = await this.prisma.partnerEmployerProgram.findMany({
      where: { partnerOrganizationId: organizationId, status: 'ACTIVE' },
      select: { code: true, nameEn: true, nameAr: true },
    });
    return {
      attributes: profile.eligibilityAttributes,
      self: { id: organizationId, nameEn: p.nameEn, nameAr: p.nameAr, partnerType: p.partnerType },
      cardPrograms: cards,
      employerPrograms: employers,
      cities: await this.liveCore.enabledCities(),
      markets: await this.access.authorizedMarkets(actor, p, 'partner.eligibility.read'),
    };
  }

  /** The partner may only build rules over its own type's attributes; card product / tier values must be its own active programmes. */
  async validateRule(p: PartnerRow, expression: EligibilityExpression) {
    const profile = await this.access.profileOf(p.partnerType);
    const cards = await this.prisma.partnerCardProgram.findMany({
      where: { partnerOrganizationId: p.organizationId, status: 'ACTIVE' },
      select: { productCode: true, tier: true, scheme: true },
    });
    const walk = (n: EligibilityExpression) => {
      if (n.op === 'NOT') return walk(n.child);
      if (n.op !== 'ATTR') return n.children.forEach(walk);
      if (!profile.eligibilityAttributes.includes(n.attr))
        throw new AppError(
          'PARTNER_CAPABILITY_UNAVAILABLE',
          `${n.attr} is not available to this partner type`,
          403,
        );
      for (const v of n.values)
        if (looksLikeCardNumber(v))
          throw new AppError('CARD_DATA_FORBIDDEN', 'Card numbers are never used in rules', 422);
      if (
        n.attr === 'CARD_PRODUCT' &&
        n.values.some((v) => !cards.some((c) => c.productCode === v))
      )
        throw AppError.validation(
          'Choose card products from your active card programmes',
          'expression',
        );
      if (
        n.attr === 'CARD_TIER' &&
        n.values.some((v) => !cards.some((c) => c.tier === v.toLowerCase()))
      )
        throw AppError.validation('Choose tiers from your active card programmes', 'expression');
    };
    walk(expression);
    await this.eligibility.validateExpression(expression, await this.liveCore.enabledCities());
  }

  async rules(actor: Actor, organizationId: string) {
    await this.access.requirePartner(actor, organizationId);
    const rows = await this.prisma.eligibilityRuleSet.findMany({
      where: { ownerOrganizationId: organizationId, name: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      expression: r.expression,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async saveRule(
    actor: Actor,
    organizationId: string,
    b: { name: string; expression: EligibilityExpression },
    meta: RequestMeta,
  ) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.validateRule(p, b.expression);
    const row = await this.prisma.eligibilityRuleSet.create({
      data: {
        ownerOrganizationId: organizationId,
        kind: 'COMPOSITE',
        name: b.name,
        expression: b.expression as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      action: 'partner.eligibility_rule.created',
      entityType: 'EligibilityRuleSet',
      entityId: row.id,
      newState: { name: b.name },
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return {
      id: row.id,
      name: row.name,
      expression: row.expression,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** "Who would qualify?" against a sample customer profile, using the same evaluator customers are judged by. */
  async test(
    actor: Actor,
    organizationId: string,
    b: {
      expression: EligibilityExpression;
      sample: {
        attributes: Array<{ attr: string; value: string; level?: string }>;
        city?: string;
        country?: string;
      };
    },
  ) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.validateRule(p, b.expression);
    const out = evaluateExpressionOutcome(b.expression, {
      userId: 'sample',
      city: b.sample.city ?? '',
      country: b.sample.country,
      now: new Date(),
      attributes: b.sample.attributes.map((a) => ({
        attrType: a.attr as EligibilityAttributeType,
        valueRef: a.value,
        level: (a.level ?? 'SELF_DECLARED') as EligibilityLevel,
        status: 'VERIFIED',
        expiresAt: null,
      })),
    });
    return { result: out.result, unlockAction: out.unlockAction };
  }
}
