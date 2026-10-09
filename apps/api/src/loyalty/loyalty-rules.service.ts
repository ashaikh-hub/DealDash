import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import type { LoyaltyRuleCreate, LoyaltyRuleView } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { CommercialService } from '../finance/commercial.service';
import { EligibilityService } from '../live-deals/eligibility.service';
import { CampaignVersionService } from '../platform/campaign-version.service';
import { EntitlementService } from '../platform/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

interface LoyaltyConfig {
  maxAllocationPerRule: number | null;
  approvalRequired: boolean;
  eventTypes: string[];
}
/** Which funding sources a kind of business may name. DealDash funds its own rules only through Admin. */
const SOURCES_BY_ORG: Record<string, string[]> = {
  MERCHANT: ['MERCHANT', 'CAMPAIGN'],
  PARTNER: ['BANK', 'SCHEME', 'CORPORATE', 'SPONSOR', 'CAMPAIGN'],
};

type Row = Prisma.LoyaltyRuleGetPayload<object>;

/**
 * Loyalty rule lifecycle. A rule is effective-dated, capped, and names its funder. A rule paid by a business goes through the same
 * commercial governance as every other funding obligation (quotation, acceptance, prepaid funds, hold, amendment), and every rule
 * is approved by DealDash before it can issue points. Nothing is a fixed example or a global points value.
 */
@Injectable()
export class LoyaltyRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly commercial: CommercialService,
    private readonly eligibility: EligibilityService,
    private readonly entitlements: EntitlementService,
    private readonly versions: CampaignVersionService,
  ) {}

  private cfg() {
    return this.config.get<LoyaltyConfig>(CONFIG_KEYS.PLATFORM_LOYALTY);
  }

  private bad(msg: string, field?: string) {
    return new AppError('LOYALTY_RULE_INVALID', msg, 422, field);
  }

  async view(r: Row): Promise<LoyaltyRuleView> {
    let commercialStatus: string | null = null;
    if (r.fundingSource !== 'DEALDASH') {
      const id = await this.commercial.caseIdOf('LOYALTY', r.id);
      if (id) commercialStatus = (await this.prisma.commercialCase.findUnique({ where: { id }, select: { status: true } }))?.status ?? null;
    }
    const set = r.eligibilityRuleSetId
      ? await this.prisma.eligibilityRuleSet.findUnique({ where: { id: r.eligibilityRuleSetId }, select: { kind: true } })
      : null;
    return {
      id: r.id,
      name: r.name,
      status: r.status as LoyaltyRuleView['status'],
      eventType: r.eventType,
      kind: r.kind,
      productScope: r.productScope,
      campaignId: r.campaignId,
      organizationId: r.organizationId,
      basePoints: r.basePoints,
      bonusPoints: r.bonusPoints,
      multiplierBps: r.multiplierBps,
      pointsPer100Halalas: r.pointsPer100Halalas,
      dailyCap: r.dailyCap,
      monthlyCap: r.monthlyCap,
      customerCap: r.customerCap,
      eligibilityKind: set?.kind ?? null,
      fundingSource: r.fundingSource,
      fundingOrganizationId: r.fundingOrganizationId,
      fundingHalalasPerPoint: r.fundingHalalasPerPoint,
      expiryDays: r.expiryDays,
      maxAllocationPoints: r.maxAllocationPoints,
      allocatedPoints: r.allocatedPoints,
      reversedPoints: r.reversedPoints,
      remainingAllocation: r.maxAllocationPoints === null ? null : r.maxAllocationPoints - r.allocatedPoints,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveUntil: r.effectiveUntil?.toISOString() ?? null,
      commercialStatus,
      createdAt: r.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------- create / read
  /** `orgId` = the business creating it (business routes); null = DealDash Admin. */
  async create(actor: Actor, orgId: string | null, b: LoyaltyRuleCreate, meta: RequestMeta): Promise<LoyaltyRuleView> {
    const cfg = await this.cfg();
    if (!cfg.eventTypes.includes(b.eventType)) throw this.bad('This kind of event does not earn points', 'eventType');
    if (cfg.maxAllocationPerRule !== null && b.maxAllocationPoints > cfg.maxAllocationPerRule)
      throw this.bad(`A rule may allocate at most ${cfg.maxAllocationPerRule} points`, 'maxAllocationPoints');
    let ownerOrg = b.organizationId;
    if (orgId) {
      ownerOrg = orgId;
      const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
      await this.entitlements.requireProduct(orgId, 'LOYALTY');
      if (b.fundingSource === 'DEALDASH') throw this.bad('A business cannot create a DealDash-funded rule', 'fundingSource');
      if (!(SOURCES_BY_ORG[org.type] ?? []).includes(b.fundingSource)) throw this.bad('This funding source is not available to your business', 'fundingSource');
      if (b.fundingOrganizationId !== orgId) throw this.bad('A business funds its own rules', 'fundingOrganizationId');
    } else if (b.fundingOrganizationId) {
      const f = await this.prisma.organization.findFirst({ where: { id: b.fundingOrganizationId, status: 'ACTIVE', type: { in: ['MERCHANT', 'PARTNER'] } } });
      if (!f) throw this.bad('The funding organization was not found or is not active', 'fundingOrganizationId');
    }
    if (ownerOrg) {
      const o = await this.prisma.organization.findUnique({ where: { id: ownerOrg } });
      if (!o) throw this.bad('The owner organization was not found', 'organizationId');
    }
    if (b.campaignId) {
      if (!b.productScope) throw this.bad('A campaign rule needs its product', 'productScope');
      const where = { id: b.campaignId, ...(ownerOrg ? { organizationId: ownerOrg } : {}) };
      const found =
        b.productScope === 'EXCLUSIVE'
          ? await this.prisma.hotDeal.findFirst({ where, select: { id: true } })
          : b.productScope === 'VOUCHER'
            ? await this.prisma.voucher.findFirst({ where, select: { id: true } })
            : b.productScope === 'WATCH'
              ? await this.prisma.watchCampaign.findFirst({ where, select: { id: true } })
              : await this.prisma.liveDeal.findFirst({ where, select: { id: true } });
      if (!found) throw this.bad('The campaign was not found', 'campaignId');
    }
    const from = b.effectiveFrom ? new Date(b.effectiveFrom) : new Date();
    const until = b.effectiveUntil ? new Date(b.effectiveUntil) : null;
    if (b.eligibility && b.eligibility.kind !== 'PUBLIC') {
      const cities = (await this.config.get<string[]>(CONFIG_KEYS.ENABLED_CITIES)) ?? ['Riyadh'];
      await this.eligibility.validateReferences(b.eligibility, cities);
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const ruleSetId = b.eligibility && b.eligibility.kind !== 'PUBLIC' ? await this.eligibility.syncRuleSet(tx, null, ownerOrg ?? actor.membership!.organizationId, b.eligibility) : null;
      const r = await tx.loyaltyRule.create({
        data: {
          name: b.name,
          eventType: b.eventType,
          kind: b.kind,
          productScope: b.productScope,
          campaignId: b.campaignId,
          organizationId: ownerOrg,
          basePoints: b.basePoints,
          bonusPoints: b.bonusPoints,
          multiplierBps: b.multiplierBps,
          pointsPer100Halalas: b.pointsPer100Halalas,
          dailyCap: b.dailyCap,
          monthlyCap: b.monthlyCap,
          customerCap: b.customerCap,
          eligibilityRuleSetId: ruleSetId,
          fundingSource: b.fundingSource,
          fundingOrganizationId: b.fundingOrganizationId,
          fundingHalalasPerPoint: b.fundingHalalasPerPoint,
          expiryDays: b.expiryDays,
          maxAllocationPoints: b.maxAllocationPoints,
          effectiveFrom: from,
          effectiveUntil: until,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record(
        { action: 'LOYALTY_RULE_CREATED', entityType: 'LoyaltyRule', entityId: r.id, actor, subjectOrganizationId: ownerOrg, newState: { name: b.name, eventType: b.eventType, funding: b.fundingSource, max: b.maxAllocationPoints }, scope: ownerOrg ? 'ORGANIZATION' : 'PLATFORM', meta },
        tx,
      );
      return r;
    });
    return this.view(row);
  }

  async list(where: Prisma.LoyaltyRuleWhereInput) {
    const rows = await this.prisma.loyaltyRule.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async load(id: string, organizationId?: string | null) {
    const r = await this.prisma.loyaltyRule.findFirst({ where: { id, ...(organizationId !== undefined ? { organizationId } : {}) } });
    if (!r) throw AppError.notFound();
    return r;
  }

  // ---------------------------------------------------------------- lifecycle
  private async move(
    actor: Actor,
    r: Row,
    to: string,
    action: string,
    meta: RequestMeta,
    extra: Prisma.LoyaltyRuleUncheckedUpdateInput = {},
    reason?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.loyaltyRule.updateMany({ where: { id: r.id, status: r.status }, data: { status: to, ...extra } });
      if (res.count !== 1) throw new AppError('VERSION_CONFLICT', 'The rule changed. Reload and try again.', 409);
      await this.audit.record(
        { action, entityType: 'LoyaltyRule', entityId: r.id, actor, subjectOrganizationId: r.organizationId, previousState: { status: r.status }, newState: { status: to }, reason: reason ?? null, scope: r.organizationId ? 'ORGANIZATION' : 'PLATFORM', meta },
        tx,
      );
      if (to === 'ACTIVE')
        await this.versions.recordLive(tx, { product: 'LOYALTY', subjectId: r.id, organizationId: r.organizationId ?? r.fundingOrganizationId ?? actor.membership!.organizationId, content: this.snapshot(r), reason: 'APPROVED', userId: actor.userId });
    });
  }

  private snapshot(r: Row) {
    const { id, createdAt, updatedAt, allocatedPoints, reversedPoints, status, approvedAt, approvedByUserId, ...rest } = r;
    void id; void createdAt; void updatedAt; void allocatedPoints; void reversedPoints; void status; void approvedAt; void approvedByUserId;
    return rest;
  }

  async submit(actor: Actor, id: string, organizationId: string | null | undefined, meta: RequestMeta) {
    const r = await this.load(id, organizationId);
    if (r.status !== 'DRAFT') throw new AppError('INVALID_STATE', `A ${r.status} rule cannot be submitted`, 409);
    if (r.fundingSource !== 'DEALDASH') await this.commercial.assertCanSubmit('LOYALTY', id, actor);
    await this.move(actor, r, 'PENDING_APPROVAL', 'LOYALTY_RULE_SUBMITTED', meta);
    return this.view(await this.load(id));
  }

  /** DealDash approval. A different person than the author approves; a funded rule must also clear the commercial gate. */
  async approve(actor: Actor, id: string, meta: RequestMeta, reason?: string) {
    const r = await this.load(id);
    if (r.status !== 'PENDING_APPROVAL') throw new AppError('INVALID_STATE', 'This rule is not waiting for approval', 409);
    if (r.createdByUserId === actor.userId) throw new AppError('APPROVAL_REQUIRED', 'A different person must approve this rule', 403);
    if (r.fundingSource !== 'DEALDASH') await this.commercial.assertCanActivate('LOYALTY', id);
    await this.move(actor, r, 'ACTIVE', 'LOYALTY_RULE_APPROVED', meta, { approvedByUserId: actor.userId, approvedAt: new Date() }, reason);
    return this.view(await this.load(id));
  }

  async reject(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    const r = await this.load(id);
    if (r.status !== 'PENDING_APPROVAL') throw new AppError('INVALID_STATE', 'This rule is not waiting for approval', 409);
    await this.move(actor, r, 'REJECTED', 'LOYALTY_RULE_REJECTED', meta, {}, reason);
    return this.view(await this.load(id));
  }

  async pause(actor: Actor, id: string, organizationId: string | null | undefined, reason: string | undefined, meta: RequestMeta) {
    const r = await this.load(id, organizationId);
    if (r.status !== 'ACTIVE') throw new AppError('INVALID_STATE', 'Only an active rule can be paused', 409);
    await this.move(actor, r, 'PAUSED', 'LOYALTY_RULE_PAUSED', meta, {}, reason);
    return this.view(await this.load(id));
  }

  async resume(actor: Actor, id: string, organizationId: string | null | undefined, meta: RequestMeta) {
    const r = await this.load(id, organizationId);
    if (r.status !== 'PAUSED') throw new AppError('INVALID_STATE', 'Only a paused rule can be resumed', 409);
    if (r.fundingSource !== 'DEALDASH') await this.commercial.assertCanActivate('LOYALTY', id);
    await this.move(actor, r, 'ACTIVE', 'LOYALTY_RULE_RESUMED', meta);
    return this.view(await this.load(id));
  }

  async end(actor: Actor, id: string, organizationId: string | null | undefined, reason: string | undefined, meta: RequestMeta) {
    const r = await this.load(id, organizationId);
    if (!['ACTIVE', 'PAUSED', 'DRAFT'].includes(r.status)) throw new AppError('INVALID_STATE', `A ${r.status} rule cannot be ended`, 409);
    await this.move(actor, r, 'ENDED', 'LOYALTY_RULE_ENDED', meta, { effectiveUntil: new Date() }, reason);
    return this.view(await this.load(id));
  }

  /**
   * Raising the ceiling raises the liability. A funded rule goes through the commercial amendment (the funder re-accepts and funds
   * the difference); a DealDash-funded rule needs the approval permission and a different person than the author.
   */
  async increaseAllocation(actor: Actor, id: string, organizationId: string | null | undefined, newMax: number, meta: RequestMeta) {
    const r = await this.load(id, organizationId);
    if (!['ACTIVE', 'PAUSED', 'DRAFT'].includes(r.status)) throw new AppError('INVALID_STATE', `A ${r.status} rule cannot be changed`, 409);
    if (r.maxAllocationPoints !== null && newMax <= r.maxAllocationPoints) throw this.bad('Only an increase needs this step', 'maxAllocationPoints');
    const cfg = await this.cfg();
    if (cfg.maxAllocationPerRule !== null && newMax > cfg.maxAllocationPerRule) throw this.bad(`A rule may allocate at most ${cfg.maxAllocationPerRule} points`, 'maxAllocationPoints');
    if (r.status !== 'DRAFT') {
      if (r.fundingSource !== 'DEALDASH') await this.commercial.requireCoverage('LOYALTY', id, newMax, actor);
      else if (r.createdByUserId === actor.userId) throw new AppError('APPROVAL_REQUIRED', 'A different person must approve a higher DealDash allocation', 403);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.loyaltyRule.update({ where: { id }, data: { maxAllocationPoints: newMax } });
      if (r.status !== 'DRAFT') {
        const fresh = await tx.loyaltyRule.findUniqueOrThrow({ where: { id } });
        await this.versions.recordLive(tx, { product: 'LOYALTY', subjectId: id, organizationId: r.organizationId ?? r.fundingOrganizationId ?? actor.membership!.organizationId, content: this.snapshot(fresh), reason: 'AMENDMENT', userId: actor.userId });
      }
      await this.audit.record(
        { action: 'LOYALTY_ALLOCATION_INCREASED', entityType: 'LoyaltyRule', entityId: id, actor, subjectOrganizationId: r.organizationId, previousState: { max: r.maxAllocationPoints }, newState: { max: newMax }, scope: r.organizationId ? 'ORGANIZATION' : 'PLATFORM', meta },
        tx,
      );
    });
    return this.view(await this.load(id));
  }
}
