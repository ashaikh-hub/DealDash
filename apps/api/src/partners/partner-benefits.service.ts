import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EligibilityExpression, EligibilityKind } from '@dealdash/types';
import type { liveDealBenefitSchema } from '@dealdash/validation';
import type { z } from 'zod';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { TenantService } from '../identity/tenant.service';
import { DealCoreService } from '../live-deals/deal-core.service';
import { EligibilityService, evaluateEligibility } from '../live-deals/eligibility.service';
import { MarketService } from '../platform/markets/market.service';
import { PartnerAccessService } from './partner-access.service';
import { PartnerNetworkService } from './partner-network.service';
import { PartnerProgramsService } from './partner-programs.service';

type BenefitInput = z.infer<typeof liveDealBenefitSchema>;
type Row = Prisma.LiveDealPartnerBenefitGetPayload<object>;
const OPEN_DEAL = ['SCHEDULED', 'LIVE', 'PAUSED'];
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Partner-linked additional benefit on an existing Live Deal (card-holder extra, scheme benefit, employer benefit). The public Live
 * Deal stays visible to everyone; the extra benefit is shown to customers according to the SHARED eligibility engine. It is part of
 * the Live Deal proposition — never an Exclusive Deal by itself — and views, clicks, saves or directions are never a redemption.
 *
 * PROPOSED (partner) -> MERCHANT_APPROVED (the merchant that owns the deal) -> ACTIVE (DealDash). Every step is audited.
 */
@Injectable()
export class PartnerBenefitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
    private readonly access: PartnerAccessService,
    private readonly network: PartnerNetworkService,
    private readonly programs: PartnerProgramsService,
    private readonly eligibility: EligibilityService,
    private readonly liveCore: DealCoreService,
    private readonly markets: MarketService,
  ) {}

  private view(r: Row, names?: Map<string, { nameEn: string; nameAr: string }>) {
    return {
      id: r.id,
      reference: r.reference,
      liveDealId: r.liveDealId,
      partnerOrganizationId: r.partnerOrganizationId,
      partnerNameEn: names?.get(r.partnerOrganizationId)?.nameEn ?? null,
      partnerNameAr: names?.get(r.partnerOrganizationId)?.nameAr ?? null,
      merchantOrganizationId: r.merchantOrganizationId,
      merchantNameEn: names?.get(r.merchantOrganizationId)?.nameEn ?? null,
      merchantNameAr: names?.get(r.merchantOrganizationId)?.nameAr ?? null,
      kind: r.kind,
      valueNumber: r.valueNumber === null ? null : Number(r.valueNumber),
      labelEn: r.labelEn,
      labelAr: r.labelAr,
      termsEn: r.termsEn,
      termsAr: r.termsAr,
      eligibility: r.eligibility,
      market: r.market,
      status: r.status,
      startAt: r.startAt?.toISOString() ?? null,
      endAt: r.endAt?.toISOString() ?? null,
      version: r.version,
      decisionReason: r.decisionReason,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async withNames(rows: Row[]) {
    const ids = [
      ...new Set(rows.flatMap((r) => [r.partnerOrganizationId, r.merchantOrganizationId])),
    ];
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const names = new Map(orgs.map((o) => [o.id, o]));
    return rows.map((r) => this.view(r, names));
  }

  private async transition(
    r: Row,
    to: string,
    actor: Actor,
    reason: string | null,
    meta: RequestMeta,
    extra: Prisma.LiveDealPartnerBenefitUncheckedUpdateInput = {},
  ) {
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.liveDealPartnerBenefit.updateMany({
        where: { id: r.id, status: r.status },
        data: {
          ...(extra as object),
          status: to,
          version: { increment: 1 },
          decisionReason: reason,
        },
      });
      if (u.count !== 1) throw new AppError('INVALID_STATE', 'This benefit changed meanwhile', 409);
      await this.audit.record(
        {
          action: 'partner.benefit.status_changed',
          entityType: 'LiveDealPartnerBenefit',
          entityId: r.id,
          previousState: { status: r.status },
          newState: { status: to },
          reason,
          actor,
          subjectOrganizationId: r.partnerOrganizationId,
          meta,
        },
        tx,
      );
    });
    return this.withNames([
      await this.prisma.liveDealPartnerBenefit.findUniqueOrThrow({ where: { id: r.id } }),
    ]).then((x) => x[0]!);
  }

  // ---------------------------------------------------------------- partner
  /** Live Deals of the partner's registered network merchants that can carry a benefit. */
  async candidates(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireModule(p, 'LIVE_DEAL_BENEFITS');
    const ids = await this.network.networkIds(organizationId);
    const orgs = (
      await this.prisma.masterMerchant.findMany({
        where: { id: { in: ids }, registration: 'REGISTERED', organizationId: { not: null } },
        select: { organizationId: true },
      })
    ).map((m) => m.organizationId!);
    const deals = await this.prisma.liveDeal.findMany({
      where: { organizationId: { in: orgs }, status: { in: OPEN_DEAL as never } },
      include: { organization: { select: { nameEn: true, nameAr: true } } },
      take: 200,
      orderBy: { updatedAt: 'desc' },
    });
    return deals.map((d) => ({
      id: d.id,
      titleEn: d.titleEn,
      titleAr: d.titleAr,
      status: d.status,
      merchantOrganizationId: d.organizationId,
      merchantNameEn: d.organization.nameEn,
      merchantNameAr: d.organization.nameAr,
    }));
  }

  async listForPartner(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    const markets = await this.access.authorizedMarkets(actor, p, 'partner.campaigns.read');
    return this.withNames(
      await this.prisma.liveDealPartnerBenefit.findMany({
        where: { partnerOrganizationId: organizationId, market: { in: markets } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    );
  }

  async propose(actor: Actor, organizationId: string, b: BenefitInput, meta: RequestMeta) {
    const p = await this.access.requirePartner(actor, organizationId);
    this.access.requireOperating(p);
    await this.access.requireModule(p, 'LIVE_DEAL_BENEFITS');
    const deal = await this.prisma.liveDeal.findUnique({ where: { id: b.liveDealId } });
    if (!deal || !OPEN_DEAL.includes(deal.status))
      throw AppError.validation('Choose a published Live Deal', 'liveDealId');
    if (!(await this.network.isRegisteredMember(organizationId, deal.organizationId)))
      throw new AppError(
        'PARTNER_MERCHANT_NOT_IN_NETWORK',
        'The merchant of this Live Deal is not in your network',
        409,
      );
    const market = await this.markets.marketOfCampaign(deal.organizationId, deal.content);
    await this.access.requireMarket(actor, p, market, 'partner.campaigns.manage');
    await this.markets.requireAvailable(organizationId, 'MEMBER_BENEFIT', { market });
    if (b.endAt && b.startAt && new Date(b.endAt) <= new Date(b.startAt))
      throw AppError.validation('The end must be after the start', 'endAt');
    if (b.eligibility.kind === 'COMPOSITE')
      await this.programs.validateRule(p, b.eligibility.expression as EligibilityExpression);
    else
      await this.eligibility.validateReferences(b.eligibility, await this.liveCore.enabledCities());
    // a partner's legacy rule can only name itself (a bank cannot target another bank's card holders)
    if (
      ['BANK_CARD', 'SCHEME', 'EMPLOYER'].includes(b.eligibility.kind) &&
      b.eligibility.valueRefs.some((v) => v !== organizationId)
    )
      throw AppError.validation(
        'A partner benefit can only target your own customers',
        'eligibility',
      );
    const ref = `PB-${Array.from({ length: 6 }, () => ALPHA[randomInt(ALPHA.length)]).join('')}`;
    const row = await this.prisma.$transaction(async (tx) => {
      const setId = await this.eligibility.syncRuleSet(
        tx,
        null,
        organizationId,
        b.eligibility as { kind: EligibilityKind; valueRefs: string[]; expression?: unknown },
      );
      const r = await tx.liveDealPartnerBenefit.create({
        data: {
          reference: ref,
          liveDealId: deal.id,
          partnerOrganizationId: organizationId,
          merchantOrganizationId: deal.organizationId,
          kind: b.kind,
          valueNumber: b.valueNumber,
          labelEn: b.labelEn,
          labelAr: b.labelAr,
          termsEn: b.termsEn,
          termsAr: b.termsAr,
          eligibilityRuleSetId: setId,
          eligibility: b.eligibility as unknown as Prisma.InputJsonValue,
          market,
          startAt: b.startAt ? new Date(b.startAt) : null,
          endAt: b.endAt ? new Date(b.endAt) : null,
          proposedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'partner.benefit.proposed',
          entityType: 'LiveDealPartnerBenefit',
          entityId: r.id,
          newState: { liveDealId: deal.id, kind: b.kind, market },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
      return r;
    });
    return (await this.withNames([row]))[0]!;
  }

  async withdraw(
    actor: Actor,
    organizationId: string,
    id: string,
    reason: string,
    meta: RequestMeta,
  ) {
    await this.access.requirePartner(actor, organizationId);
    const r = await this.prisma.liveDealPartnerBenefit.findFirst({
      where: { id, partnerOrganizationId: organizationId },
    });
    if (!r) throw AppError.notFound();
    if (!['PROPOSED', 'MERCHANT_APPROVED', 'ACTIVE', 'SUSPENDED'].includes(r.status))
      throw new AppError('INVALID_STATE', 'This benefit is already closed', 409);
    return this.transition(
      r,
      r.status === 'ACTIVE' || r.status === 'SUSPENDED' ? 'ENDED' : 'WITHDRAWN',
      actor,
      reason,
      meta,
    );
  }

  // ---------------------------------------------------------------- merchant (owner of the Live Deal)
  async listForMerchant(actor: Actor, organizationId: string) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
    return this.withNames(
      await this.prisma.liveDealPartnerBenefit.findMany({
        where: { merchantOrganizationId: organizationId },
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    );
  }

  async merchantDecide(
    actor: Actor,
    organizationId: string,
    id: string,
    decision: 'APPROVE' | 'REJECT',
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    if (this.tenant.isBranchBound(actor) || actor.membership?.scoped) throw AppError.forbidden();
    const r = await this.prisma.liveDealPartnerBenefit.findFirst({
      where: { id, merchantOrganizationId: organizationId },
    });
    if (!r) throw AppError.notFound();
    if (decision === 'REJECT' && !reason)
      throw AppError.validation('A reason is required', 'reason');
    if (decision === 'APPROVE' && r.status !== 'PROPOSED')
      throw new AppError('INVALID_STATE', 'Only a proposed benefit can be approved', 409);
    if (decision === 'REJECT' && !['PROPOSED', 'MERCHANT_APPROVED', 'ACTIVE'].includes(r.status))
      throw new AppError('INVALID_STATE', 'This benefit is already closed', 409);
    if (decision === 'APPROVE')
      return this.transition(r, 'MERCHANT_APPROVED', actor, reason ?? null, meta, {
        merchantDecidedByUserId: actor.userId,
        merchantDecidedAt: new Date(),
      });
    return this.transition(r, r.status === 'ACTIVE' ? 'ENDED' : 'REJECTED', actor, reason!, meta, {
      merchantDecidedByUserId: actor.userId,
      merchantDecidedAt: new Date(),
    });
  }

  // ---------------------------------------------------------------- DealDash
  async listForAdmin(status?: string) {
    return this.withNames(
      await this.prisma.liveDealPartnerBenefit.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: 'desc' },
        take: 300,
      }),
    );
  }

  async adminDecide(
    actor: Actor,
    id: string,
    action: 'approve' | 'reject' | 'suspend' | 'reinstate',
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    const r = await this.prisma.liveDealPartnerBenefit.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    if (action !== 'approve' && action !== 'reinstate' && !reason)
      throw AppError.validation('A reason is required', 'reason');
    if (r.proposedByUserId === actor.userId)
      throw new AppError('APPROVAL_REQUIRED', 'A different person must decide', 403);
    switch (action) {
      case 'approve': {
        if (r.status !== 'MERCHANT_APPROVED')
          throw new AppError('INVALID_STATE', 'The merchant has not approved this benefit', 409);
        const partner = await this.access.load(r.partnerOrganizationId);
        this.access.requireOperating(partner);
        // availability is re-checked at activation (market and product may have changed since the proposal)
        await this.markets.requireAvailable(r.partnerOrganizationId, 'MEMBER_BENEFIT', {
          market: r.market,
        });
        return this.transition(r, 'ACTIVE', actor, reason ?? null, meta, {
          approvedByUserId: actor.userId,
          approvedAt: new Date(),
        });
      }
      case 'reject':
        if (!['PROPOSED', 'MERCHANT_APPROVED'].includes(r.status))
          throw new AppError('INVALID_STATE', 'Only a pending benefit can be rejected', 409);
        return this.transition(r, 'REJECTED', actor, reason!, meta);
      case 'suspend':
        if (r.status !== 'ACTIVE')
          throw new AppError('INVALID_STATE', 'Only an active benefit can be suspended', 409);
        return this.transition(r, 'SUSPENDED', actor, reason!, meta);
      case 'reinstate':
        if (r.status !== 'SUSPENDED')
          throw new AppError('INVALID_STATE', 'Only a suspended benefit can be reinstated', 409);
        return this.transition(r, 'ACTIVE', actor, reason ?? null, meta);
    }
  }

  // ---------------------------------------------------------------- customer (the public Live Deal stays public)
  /**
   * The partner benefits shown on a Live Deal for this customer: ELIGIBLE ones with "you qualify", LOCKED_UNLOCKABLE ones with the way
   * to unlock, HIDDEN ones not at all. Showing it is not a redemption and is not counted as one.
   */
  async forCustomer(liveDealId: string, userId: string | null, city: string | undefined) {
    const now = new Date();
    const deal = await this.prisma.liveDeal.findUnique({
      where: { id: liveDealId },
      select: { status: true },
    });
    if (!deal || deal.status !== 'LIVE') return [];
    const rows = await this.prisma.liveDealPartnerBenefit.findMany({
      where: {
        liveDealId,
        status: 'ACTIVE',
        AND: [
          { OR: [{ startAt: null }, { startAt: { lte: now } }] },
          { OR: [{ endAt: null }, { endAt: { gt: now } }] },
        ],
      },
    });
    if (!rows.length) return [];
    const partners = await this.prisma.organization.findMany({
      where: {
        id: { in: rows.map((r) => r.partnerOrganizationId) },
        status: 'ACTIVE',
        partner: { is: { lifecycle: 'ACTIVE' } },
      },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const ctx = await this.eligibility.contextFor(userId, city ?? '', now);
    const out = [];
    for (const r of rows) {
      const partner = partners.find((p) => p.id === r.partnerOrganizationId);
      if (!partner) continue;
      const set = r.eligibilityRuleSetId
        ? await this.prisma.eligibilityRuleSet.findUnique({
            where: { id: r.eligibilityRuleSetId },
            include: { conditions: true },
          })
        : null;
      const o = set
        ? evaluateEligibility(
            set.kind as EligibilityKind,
            set.conditions.map((c) => ({
              attrType: c.attrType as never,
              valueRef: c.valueRef,
              requiredLevel: c.requiredLevel as never,
            })),
            ctx,
            set.expression,
          )
        : { result: 'ELIGIBLE' as const, unlockAction: null, message: null };
      if (o.result === 'HIDDEN') continue;
      out.push({
        reference: r.reference,
        partnerNameEn: partner.nameEn,
        partnerNameAr: partner.nameAr,
        kind: r.kind,
        valueNumber: r.valueNumber === null ? null : Number(r.valueNumber),
        labelEn: r.labelEn,
        labelAr: r.labelAr,
        termsEn: r.termsEn,
        termsAr: r.termsAr,
        endAt: r.endAt?.toISOString() ?? null,
        result: o.result,
        unlockAction: o.unlockAction,
      });
    }
    return out;
  }
}
