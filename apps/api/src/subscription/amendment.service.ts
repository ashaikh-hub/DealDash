import { Injectable } from '@nestjs/common';
import { RESOURCE_LIMITS, type BillingEventType } from '@dealdash/types';
import type { PlanEntitlements } from '@dealdash/validation';
import { z } from 'zod';
import type {
  amendmentProposeSchema,
  contractRateSchema,
  promotionSchema,
} from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { Prisma } from '../generated/prisma/client';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingEventService } from './billing-event.service';
import { PlanService } from './plan.service';
import { addMonths } from './policy';
import { PricingResolver } from './pricing.resolver';
import { planFitsOrganization, SubscriptionService } from './subscription.service';
import { UsageService } from './usage.service';

type Propose = z.infer<typeof amendmentProposeSchema>;
type PromotionInput = z.infer<typeof promotionSchema>;
type RateInput = z.infer<typeof contractRateSchema>;
type Tx = Prisma.TransactionClient;

export interface Impact {
  type: string;
  from: { planCode: string | null; amountMinor: number | null; cadence: string };
  to: {
    planCode: string | null;
    amountMinor: number | null;
    cadence: string;
    indicative: boolean;
  } | null;
  priceDeltaMinor: number | null;
  currency: string;
  effectiveAt: string;
  effectiveMode: string;
  added: { products: string[]; features: string[] };
  removed: { products: string[]; features: string[] };
  limitChanges: Array<{ key: string; from: number | null; to: number | null }>;
  /** Downgrade: current usage above the new limits. The data is never deleted; the excess must be resolved first. */
  excess: Array<{ key: string; newLimit: number; current: number; excess: number }>;
  blocked: boolean;
  needsAcceptance: boolean;
  remediation: string[];
  fees: Array<{ code: string; amountMinor: number | null; indicative: boolean }>;
}

/**
 * Commercial CHANGE EVENTS on a contract: upgrade, downgrade, add-on, renewal, pricing, entitlement, market addition, extension.
 * A change is never a status: it is an amendment with the previous contract version, the change, the commercial impact shown before
 * acceptance, the acceptance (immutable) and the new effective version. Downgrades are blocked while usage exceeds the new limits, and
 * nothing is ever deleted.
 */
@Injectable()
export class AmendmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
    private readonly pricing: PricingResolver,
    private readonly billing: BillingEventService,
    private readonly usage: UsageService,
    private readonly subscriptions: SubscriptionService,
    private readonly markets: MarketService,
  ) {}

  // ---------------------------------------------------------------- impact (shown before anything is accepted)
  async impactOf(
    contractId: string,
    b: Propose,
    now = new Date(),
  ): Promise<{ impact: Impact; target: Awaited<ReturnType<PlanService['getVersion']>> | null }> {
    const c = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { planVersion: { include: { plan: true } }, entitlements: true },
    });
    if (!c) throw AppError.notFound();
    const effectiveAt = this.effectiveAtOf(c, b, now);
    const cur = await this.pricing.subscription(contractId, now).catch(() => null);
    const empty: Impact = {
      type: b.type,
      from: {
        planCode: c.planCode,
        amountMinor: cur && !cur.indicative ? cur.amountMinor : null,
        cadence: c.billingCadence,
      },
      to: null,
      priceDeltaMinor: null,
      currency: c.currency ?? (await this.markets.currencyFor(c.organizationId, c.market)),
      effectiveAt: effectiveAt.toISOString(),
      effectiveMode: b.effectiveMode,
      added: { products: [], features: [] },
      removed: { products: [], features: [] },
      limitChanges: [],
      excess: [],
      blocked: false,
      needsAcceptance: false,
      remediation: [],
      fees: [],
    };
    if (b.type !== 'UPGRADE' && b.type !== 'DOWNGRADE') {
      if (b.type === 'ADD_ON' && b.addOn) {
        const r = await this.pricing.addOn(contractId, b.addOn.code, now);
        const total = (r.amountMinor ?? 0) * b.addOn.quantity;
        empty.priceDeltaMinor = total;
        empty.needsAcceptance = total > 0;
        empty.fees = [
          {
            code: `ADDON:${b.addOn.code}`,
            amountMinor: r.indicative ? null : total,
            indicative: r.indicative,
          },
        ];
      } else if (b.type === 'PRICING' && b.pricing) {
        const increases = b.pricing.amountMinor !== null || b.pricing.rateBps !== null;
        empty.needsAcceptance = increases && !b.pricing.waived && b.pricing.discountBps === null;
      } else if (b.type === 'EXTENSION') {
        empty.needsAcceptance = true;
      }
      return { impact: empty, target: null };
    }
    if (!b.targetPlanCode)
      throw AppError.validation('Choose the plan to move to', 'targetPlanCode');
    const org = await this.prisma.organization.findUnique({
      where: { id: c.organizationId },
      include: { partner: true },
    });
    const target = await this.plans.resolveVersion(b.targetPlanCode, c.market, now);
    if (!org || !planFitsOrganization(target.plan, org))
      throw AppError.validation('This plan is not for this kind of business', 'targetPlanCode');
    if (target.id === c.planVersionId)
      throw new AppError('AMENDMENT_INVALID', 'The agreement is already on this plan version', 409);
    const cadence = target.defaultCadence as string;
    const points =
      (target.prices as Array<{ cadence: string; amountMinor: number; indicative?: boolean }>) ??
      [];
    const point = points.find((p) => p.cadence === cadence);
    const toAmount = point && !point.indicative ? point.amountMinor : null;
    const fromAmount = empty.from.amountMinor;
    const fees: Impact['fees'] = (
      (target.fees as Array<{ code: string; amountMinor: number; indicative?: boolean }>) ?? []
    ).map((f) => ({
      code: f.code,
      amountMinor: f.indicative ? null : f.amountMinor,
      indicative: !!f.indicative,
    }));
    const nowRows = c.entitlements.filter(
      (e) => e.effectiveFrom <= now && (e.effectiveUntil === null || e.effectiveUntil > now),
    );
    const curProducts = new Set(
      nowRows.filter((e) => e.kind === 'PRODUCT' && e.enabled).map((e) => e.key),
    );
    const curFeatures = new Set(
      nowRows.filter((e) => e.kind === 'FEATURE' && e.enabled).map((e) => e.key),
    );
    const te = (target.entitlements ?? {}) as Partial<PlanEntitlements>;
    const tProducts = new Set(te.products ?? []);
    const tFeatures = new Set(te.features ?? []);
    const limitsNow = new Map<string, number | null>();
    for (const r of nowRows.filter(
      (x) => x.kind === 'LIMIT' && (x.source === 'PLAN' || x.source === 'CONTRACT'),
    ))
      limitsNow.set(r.key, r.limitValue);
    const limitChanges: Impact['limitChanges'] = [];
    for (const l of te.limits ?? [])
      if ((limitsNow.get(l.key) ?? undefined) !== l.value)
        limitChanges.push({
          key: l.key,
          from: limitsNow.has(l.key) ? limitsNow.get(l.key)! : null,
          to: l.value,
        });
    for (const [k, v] of limitsNow)
      if (!(te.limits ?? []).some((l) => l.key === k))
        limitChanges.push({ key: k, from: v, to: null });
    // usage against the NEW limits (overrides and add-ons the contract already holds are kept, so they count as part of the new limit)
    const excess: Impact['excess'] = [];
    const eff = await this.usage
      .usageView(c.organizationId, { legalEntityId: c.legalEntityId, at: now })
      .catch(() => []);
    for (const l of te.limits ?? []) {
      if (l.value === null) continue;
      const held = nowRows.filter(
        (x) =>
          x.kind === 'LIMIT' &&
          x.key === l.key &&
          (x.source === 'ADDON' || x.source === 'OVERRIDE'),
      );
      const override = held
        .filter((x) => x.source === 'OVERRIDE')
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
      const base = override ? override.limitValue : l.value;
      const newLimit =
        base === null
          ? null
          : base +
            held.filter((x) => x.source === 'ADDON').reduce((n, x) => n + (x.limitValue ?? 0), 0);
      if (newLimit === null) continue;
      const line = eff.find((u) => u.limitKey === l.key);
      const used =
        line?.used ??
        ((RESOURCE_LIMITS as readonly string[]).includes(l.key)
          ? await this.usage.currentCount(c.organizationId, l.key, {
              legalEntityId: c.legalEntityId,
            })
          : 0);
      if (used > newLimit)
        excess.push({ key: l.key, newLimit, current: used, excess: used - newLimit });
    }
    const removed = {
      products: [...curProducts].filter((p) => !tProducts.has(p)),
      features: [...curFeatures].filter((f) => !tFeatures.has(f)),
    };
    const remediation: string[] = [];
    if (excess.length)
      remediation.push('DEACTIVATE_EXCESS', 'SCHEDULE_FOR_LATER', 'BUY_ADD_ON', 'CANCEL_DOWNGRADE');
    const type = b.type;
    const impact: Impact = {
      ...empty,
      to: {
        planCode: target.plan.code,
        amountMinor: toAmount,
        cadence,
        indicative: !!point?.indicative || (!point && !target.plan.isFree),
      },
      priceDeltaMinor:
        toAmount !== null && fromAmount !== null
          ? toAmount - fromAmount
          : toAmount !== null && fromAmount === null
            ? toAmount
            : null,
      added: {
        products: [...tProducts].filter((p) => !curProducts.has(p)),
        features: [...tFeatures].filter((f) => !curFeatures.has(f)),
      },
      removed,
      limitChanges,
      excess,
      blocked:
        type === 'DOWNGRADE' && excess.length > 0 && b.effectiveMode === 'IMMEDIATE' && !b.forced,
      needsAcceptance:
        (toAmount ?? 0) > (fromAmount ?? 0) || fees.some((f) => (f.amountMinor ?? 0) > 0),
      remediation,
      fees,
    };
    return { impact, target };
  }

  private effectiveAtOf(
    c: { nextRenewalAt: Date | null; nextBillingAt: Date | null },
    b: Propose,
    now: Date,
  ): Date {
    if (b.effectiveMode === 'NEXT_BILLING_CYCLE') return c.nextRenewalAt ?? c.nextBillingAt ?? now;
    if (b.effectiveMode === 'CUSTOM_EFFECTIVE_DATE') {
      if (!b.effectiveAt) throw AppError.validation('Choose the effective date', 'effectiveAt');
      const d = new Date(b.effectiveAt);
      if (d < new Date(now.getTime() - 60_000))
        throw AppError.validation('The effective date cannot be in the past', 'effectiveAt');
      return d;
    }
    return now;
  }

  /** Shows the impact without saving anything (the "what changes if I upgrade" answer). */
  async preview(contractId: string, b: Propose) {
    return (await this.impactOf(contractId, b)).impact;
  }

  // ---------------------------------------------------------------- propose
  async propose(actor: Actor, contractId: string, b: Propose, meta: RequestMeta, byOrg: boolean) {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!c) throw AppError.notFound();
    if (
      byOrg &&
      (actor.membership?.organizationId !== c.organizationId ||
        !['UPGRADE', 'DOWNGRADE', 'ADD_ON'].includes(b.type))
    )
      throw byOrg && actor.membership?.organizationId !== c.organizationId
        ? AppError.notFound()
        : AppError.forbidden();
    if (
      !['ACTIVE', 'TRIAL', 'PAST_DUE'].includes(c.status) &&
      !(b.type === 'RENEWAL' || b.type === 'EXTENSION')
    )
      throw new AppError('INVALID_STATE', `A ${c.status} agreement cannot be changed`, 409);
    if (b.forced && byOrg) throw AppError.forbidden();
    if (b.forced && (!b.reason || b.reason.trim().length < 5))
      throw AppError.validation('A forced change needs a reason', 'reason');
    if (['ENTITLEMENT', 'PRICING', 'MARKET_ADDITION', 'EXTENSION'].includes(b.type) && byOrg)
      throw AppError.forbidden();
    if (b.type === 'ENTITLEMENT' && (!b.entitlements?.length || !b.reason))
      throw AppError.validation(
        'An entitlement override needs the entitlements and a reason',
        'entitlements',
      );
    if (b.type === 'MARKET_ADDITION') {
      if (!b.market) throw AppError.validation('Choose the market to add', 'market');
      if (!(await this.prisma.countryConfiguration.findUnique({ where: { code: b.market } })))
        throw AppError.validation('This market is not configured', 'market');
    }
    if (b.type === 'EXTENSION' && !b.newEndAt)
      throw AppError.validation('Choose the new end date', 'newEndAt');
    if (b.type === 'PRICING' && !b.pricing)
      throw AppError.validation('Choose the price to change', 'pricing');
    if (b.type === 'ADD_ON' && !b.addOn) throw AppError.validation('Choose the add-on', 'addOn');
    const now = new Date();
    const { impact, target } = await this.impactOf(contractId, b, now);
    const effectiveAt = this.effectiveAtOf(c, b, now);
    const from = await this.subscriptions.snapshot(this.prisma, contractId, now);
    if (b.type === 'ADD_ON' && b.addOn) {
      const def = await this.prisma.addOnDefinition.findUnique({ where: { code: b.addOn.code } });
      const pv = c.planVersionId
        ? await this.prisma.commercialPlanVersion.findUnique({ where: { id: c.planVersionId } })
        : null;
      if (!def || def.status !== 'ACTIVE')
        throw AppError.validation('This add-on is not available', 'addOn');
      if (
        !(pv?.addOnCodes.includes(def.code) || def.eligiblePlanCodes.includes(c.planCode ?? '')) &&
        c.kind === 'MERCHANT_SUBSCRIPTION'
      )
        throw AppError.validation('This add-on is not available on your plan', 'addOn');
      // a business can only buy an add-on that has a price; DealDash grants an unpriced or negotiated one itself
      if (byOrg) {
        const p = await this.pricing.addOn(contractId, def.code, now);
        if (p.amountMinor === null || p.indicative)
          throw new AppError(
            'PRICING_NOT_AVAILABLE',
            'This add-on is not priced yet: ask DealDash to arrange it',
            409,
          );
      }
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const a = await tx.contractAmendment.create({
        data: {
          contractId,
          organizationId: c.organizationId,
          fromVersion: c.version,
          type: b.type,
          status: 'PROPOSED',
          effectiveMode: b.effectiveMode,
          effectiveAt,
          targetPlanVersionId: target?.id ?? null,
          change: JSON.parse(JSON.stringify(b)) as Prisma.InputJsonValue,
          fromSnapshot: from as unknown as Prisma.InputJsonValue,
          toSnapshot: {} as Prisma.InputJsonValue,
          impact: impact as unknown as Prisma.InputJsonValue,
          reason: b.reason ?? null,
          forced: b.forced,
          requestedByUserId: actor.userId,
          requestedByOrg: byOrg,
        },
      });
      await this.audit.record(
        {
          action: `AMENDMENT_PROPOSED_${b.type}`,
          entityType: 'ContractAmendment',
          entityId: a.id,
          actor,
          subjectOrganizationId: c.organizationId,
          reason: b.reason ?? null,
          newState: { type: b.type, effectiveAt, forced: b.forced, blocked: impact.blocked },
          meta,
        },
        tx,
      );
      return a;
    });
    return this.view(row.id);
  }

  // ---------------------------------------------------------------- accept (re-acceptance by an authorised person)
  async accept(
    actor: Actor,
    amendmentId: string,
    language: 'en' | 'ar',
    meta: RequestMeta,
    opts: { onBehalfAuthorizationId?: string; approvalRef?: string } = {},
  ) {
    const a = await this.prisma.contractAmendment.findUnique({ where: { id: amendmentId } });
    if (!a) throw AppError.notFound();
    const isAdmin = actor.membership?.organizationType === 'DEALDASH';
    if (!isAdmin && actor.membership?.organizationId !== a.organizationId)
      throw AppError.notFound();
    if (a.status !== 'PROPOSED')
      throw new AppError('INVALID_STATE', `A ${a.status} change cannot be accepted`, 409);
    if (
      ['ENTITLEMENT', 'MARKET_ADDITION', 'EXTENSION'].includes(a.type) &&
      !(a.impact as unknown as Impact).needsAcceptance
    )
      throw new AppError(
        'INVALID_STATE',
        'This is a DealDash change: a second DealDash person approves it',
        409,
      );
    const b = a.change as unknown as Propose;
    // facts are re-read at acceptance: a downgrade is blocked again if usage still exceeds the new limits
    const { impact } = await this.impactOf(
      a.contractId,
      { ...b, effectiveAt: a.effectiveAt.toISOString() },
      new Date(),
    );
    if (impact.blocked)
      throw new AppError(
        'DOWNGRADE_BLOCKED',
        'Your current usage is above the new plan limits. Resolve the excess first, schedule the change for later or buy an add-on.',
        409,
      );
    // administrative changes (entitlement, pricing, market, extension requested by DealDash) need a second DealDash person to apply them
    if (!impact.needsAcceptance) {
      await this.prisma.contractAmendment.update({
        where: { id: amendmentId },
        data: { status: 'ACCEPTED', impact: impact as unknown as Prisma.InputJsonValue },
      });
    } else {
      await this.subscriptions.acceptContract(actor, a.contractId, language, meta, {
        ...opts,
        amendmentId,
      });
      await this.prisma.contractAmendment.update({
        where: { id: amendmentId },
        data: {
          status: 'ACCEPTED',
          impact: impact as unknown as Prisma.InputJsonValue,
          acceptanceId: (
            await this.prisma.contractAcceptance.findFirstOrThrow({
              where: { amendmentId },
              orderBy: { createdAt: 'desc' },
            })
          ).id,
        },
      });
    }
    await this.audit.record({
      action: 'AMENDMENT_ACCEPTED',
      entityType: 'ContractAmendment',
      entityId: amendmentId,
      actor,
      subjectOrganizationId: a.organizationId,
      newState: { type: a.type, acceptance: impact.needsAcceptance },
      meta,
    });
    if (
      a.effectiveAt <= new Date() &&
      !['ENTITLEMENT', 'PRICING', 'MARKET_ADDITION', 'EXTENSION'].includes(a.type)
    )
      return this.apply(actor, amendmentId, meta);
    return this.view(amendmentId);
  }

  async reject(actor: Actor, amendmentId: string, reason: string, meta: RequestMeta) {
    const a = await this.prisma.contractAmendment.findUnique({ where: { id: amendmentId } });
    if (!a) throw AppError.notFound();
    const isAdmin = actor.membership?.organizationType === 'DEALDASH';
    if (!isAdmin && actor.membership?.organizationId !== a.organizationId)
      throw AppError.notFound();
    if (!['PROPOSED', 'ACCEPTED'].includes(a.status))
      throw new AppError('INVALID_STATE', `A ${a.status} change cannot be cancelled`, 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.contractAmendment.update({
        where: { id: amendmentId },
        data: {
          status: isAdmin && a.requestedByUserId !== actor.userId ? 'REJECTED' : 'CANCELLED',
        },
      });
      const addOn = (a.change as { addOn?: { code: string } }).addOn;
      if (a.type === 'ADD_ON' && addOn)
        await tx.contractAddOn.updateMany({
          where: { contractId: a.contractId, code: addOn.code, status: 'PROPOSED' },
          data: { status: 'CANCELLED' },
        });
      await this.audit.record(
        {
          action: 'AMENDMENT_CANCELLED',
          entityType: 'ContractAmendment',
          entityId: amendmentId,
          actor,
          subjectOrganizationId: a.organizationId,
          reason,
          meta,
        },
        tx,
      );
    });
    return this.view(amendmentId);
  }

  // ---------------------------------------------------------------- apply (the new effective version)
  /** Applies an accepted change: end-dates what it replaces, writes the new rows, raises the contract version, emits the billing hook. */
  async apply(
    actor: Actor | null,
    amendmentId: string,
    meta: RequestMeta | null,
    now = new Date(),
  ) {
    const a = await this.prisma.contractAmendment.findUnique({ where: { id: amendmentId } });
    if (!a) throw AppError.notFound();
    const needsApproval = ['ENTITLEMENT', 'PRICING', 'MARKET_ADDITION', 'EXTENSION'].includes(
      a.type,
    );
    if (!['PROPOSED', 'ACCEPTED'].includes(a.status))
      throw new AppError('INVALID_STATE', `A ${a.status} change cannot be applied`, 409);
    if (needsApproval) {
      // a DealDash-initiated administrative change: a DIFFERENT person than the requester approves it (two-person control),
      // and the customer re-accepts first when the change raises its commitment
      if (!actor || a.requestedByUserId === actor.userId)
        throw new AppError('APPROVAL_REQUIRED', 'A different person must approve this change', 403);
      if ((a.impact as unknown as Impact).needsAcceptance && a.status !== 'ACCEPTED')
        throw new AppError(
          'COMMERCIAL_ACCEPTANCE_REQUIRED',
          'The customer must accept this change first',
          422,
        );
    } else if (a.status !== 'ACCEPTED')
      throw new AppError('INVALID_STATE', 'This change has not been accepted yet', 409);
    const c = await this.prisma.contract.findUniqueOrThrow({
      where: { id: a.contractId },
      include: { planVersion: { include: { plan: true } } },
    });
    if (
      c.version !== a.fromVersion &&
      !['ADD_ON', 'ENTITLEMENT', 'PRICING', 'MARKET_ADDITION'].includes(a.type)
    )
      throw new AppError(
        'VERSION_CONFLICT',
        'The agreement changed since this was proposed. Propose it again.',
        409,
      );
    const b = a.change as unknown as Propose;
    if (a.type === 'DOWNGRADE' && !a.forced) {
      const { impact } = await this.impactOf(
        a.contractId,
        { ...b, effectiveMode: 'IMMEDIATE', forced: false },
        now,
      );
      if (impact.excess.length)
        throw new AppError('DOWNGRADE_BLOCKED', 'Usage is still above the new plan limits', 409);
    }
    const at = a.effectiveAt > now ? a.effectiveAt : now;
    await this.prisma.$transaction(async (tx) => {
      switch (a.type) {
        case 'UPGRADE':
        case 'DOWNGRADE':
          await this.applyPlanChange(tx, c, a, at);
          break;
        case 'ADD_ON':
          await this.applyAddOn(tx, c, a, b, at, actor);
          break;
        case 'ENTITLEMENT':
          await this.applyOverride(tx, c, a, b, at);
          break;
        case 'PRICING':
          await this.applyPricing(tx, c, a, b, at, actor);
          break;
        case 'EXTENSION': {
          const newEnd = new Date(b.newEndAt!);
          if (c.effectiveUntil && newEnd <= c.effectiveUntil)
            throw AppError.validation('The new end must be after the current end', 'newEndAt');
          await tx.contractEntitlement.updateMany({
            where: { contractId: c.id, effectiveUntil: c.effectiveUntil },
            data: { effectiveUntil: newEnd },
          });
          await tx.contract.update({
            where: { id: c.id },
            data: { effectiveUntil: newEnd, nextRenewalAt: newEnd },
          });
          break;
        }
        case 'MARKET_ADDITION':
          // markets are recorded on the amendment; the covered markets of a contract are its own market plus every applied addition
          break;
        case 'RENEWAL':
          break;
      }
      const to = await this.subscriptions.snapshot(tx, c.id, at);
      await tx.contract.update({ where: { id: c.id }, data: { version: { increment: 1 } } });
      await tx.contractAmendment.update({
        where: { id: a.id },
        data: {
          status: 'APPLIED',
          appliedAt: now,
          toSnapshot: to as unknown as Prisma.InputJsonValue,
          approvedByUserId: actor?.userId ?? null,
          approvedAt: actor ? now : null,
        },
      });
      await this.audit.record(
        {
          action: `AMENDMENT_APPLIED_${a.type}`,
          entityType: 'ContractAmendment',
          entityId: a.id,
          actor: actor ?? undefined,
          actorRole: actor ? undefined : 'SYSTEM',
          subjectOrganizationId: a.organizationId,
          reason: a.reason ?? null,
          previousState: { version: c.version },
          newState: { version: c.version + 1, effectiveAt: at, forced: a.forced },
          meta: meta ?? undefined,
        },
        tx,
      );
    });
    if (a.type === 'RENEWAL') await this.subscriptions.renew(actor, c.id, meta, now);
    return this.view(amendmentId);
  }

  private async applyPlanChange(
    tx: Tx,
    c: Prisma.ContractGetPayload<{ include: { planVersion: { include: { plan: true } } } }>,
    a: Prisma.ContractAmendmentGetPayload<object>,
    at: Date,
  ) {
    const target = await tx.commercialPlanVersion.findUniqueOrThrow({
      where: { id: a.targetPlanVersionId! },
      include: { plan: true },
    });
    const impact = a.impact as unknown as Impact;
    // the PLAN rows of the previous plan end now; overrides and add-ons are contract-specific and stay
    await tx.contractEntitlement.updateMany({
      where: {
        contractId: c.id,
        source: { in: ['PLAN', 'CONTRACT'] },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
      },
      data: { effectiveUntil: at },
    });
    await this.subscriptions.materialize(tx, c.id, target, at, c.effectiveUntil);
    const cadence = target.defaultCadence as string;
    const wasFree = (impact.from.amountMinor ?? 0) === 0;
    await tx.contract.update({
      where: { id: c.id },
      data: {
        planCode: target.plan.code,
        planVersionId: target.id,
        kind: target.plan.contractKind,
        currency: target.currency,
        billingCadence: target.plan.isFree ? 'NONE' : cadence,
        pricingVersionKey: `PLV:${target.id}`,
        termsVersion: `${target.plan.code}-${c.market ?? 'ALL'}-v${target.version}`,
        supportLevel: target.supportLevel,
        ...(wasFree && !target.plan.isFree
          ? {
              nextBillingAt: cadence === 'ANNUAL' ? addMonths(at, 12) : addMonths(at, 1),
              nextRenewalAt: cadence === 'ANNUAL' ? addMonths(at, 12) : addMonths(at, 1),
            }
          : {}),
        ...(target.plan.isFree ? { nextBillingAt: null, nextRenewalAt: null } : {}),
      },
    });
    // billing hook: a first period (and setup fees) when leaving a free plan, else the price difference for Phase 5 to prorate
    if (wasFree && !target.plan.isFree) {
      await this.subscriptions.billActivation(tx, c.id, at);
    } else if (impact.priceDeltaMinor !== null && impact.priceDeltaMinor !== 0) {
      const type: BillingEventType = 'PLAN_CHANGE_ADJUSTMENT';
      await this.billing.emit(
        {
          idempotencyKey: `planchange:${a.id}`,
          organizationId: c.organizationId,
          eventType: type,
          contractId: c.id,
          feature: 'SUBSCRIPTION',
          pricingVersionKey: `PLV:${target.id}`,
          unit: cadence === 'ANNUAL' ? 'PER_YEAR' : 'PER_MONTH',
          unitRateMinor: impact.to?.amountMinor ?? null,
          amountMinor: Math.abs(impact.priceDeltaMinor),
          currency: target.currency,
          occurredAt: at,
          metadata: {
            direction: impact.priceDeltaMinor > 0 ? 'UPGRADE' : 'DOWNGRADE',
            from: impact.from.planCode,
            to: target.plan.code,
            priceDeltaMinor: impact.priceDeltaMinor,
            prorationByPhase5: true,
          },
        },
        tx,
      );
    }
  }

  private async applyAddOn(
    tx: Tx,
    c: Prisma.ContractGetPayload<object>,
    a: Prisma.ContractAmendmentGetPayload<object>,
    b: Propose,
    at: Date,
    actor: Actor | null,
  ) {
    const def = await tx.addOnDefinition.findUniqueOrThrow({ where: { code: b.addOn!.code } });
    const price = await this.pricing.addOn(c.id, def.code, at, tx);
    const unit = price.amountMinor ?? 0;
    const end = b.addOn!.endAt ? new Date(b.addOn!.endAt) : null;
    const row = await tx.contractAddOn.create({
      data: {
        contractId: c.id,
        organizationId: c.organizationId,
        code: def.code,
        quantity: b.addOn!.quantity,
        priceMinor: unit,
        currency: price.currency,
        cadence: c.billingCadence === 'NONE' ? 'MONTHLY' : c.billingCadence,
        pricingVersionKey: price.pricingVersionKey,
        startAt: at,
        endAt: end,
        autoRenew: b.addOn!.autoRenew,
        status: 'ACTIVE',
        approvedByUserId: actor?.userId ?? null,
        acceptanceId: a.acceptanceId,
        createdByUserId: a.requestedByUserId,
      },
    });
    const effect = def.effect as Array<{ kind: string; key: string; perUnit: number }>;
    await tx.contractEntitlement.createMany({
      data: effect.map((e) => ({
        contractId: c.id,
        kind: e.kind,
        key: e.key,
        enabled: true,
        limitValue: e.kind === 'LIMIT' ? e.perUnit * b.addOn!.quantity : null,
        effectiveFrom: at,
        effectiveUntil: end,
        source: 'ADDON',
        sourceRef: row.id,
      })),
    });
    if (unit > 0)
      await this.billing.emit(
        {
          idempotencyKey: `addon:${row.id}:${at.toISOString().slice(0, 10)}`,
          organizationId: c.organizationId,
          eventType: def.code.includes('ANALYTICS') ? 'PREMIUM_ANALYTICS_FEE' : 'ADD_ON_FEE',
          contractId: c.id,
          feature: def.code,
          pricingVersionKey: price.pricingVersionKey,
          quantity: b.addOn!.quantity,
          unitRateMinor: unit,
          amountMinor: unit * b.addOn!.quantity,
          currency: price.currency,
          occurredAt: at,
          metadata: { addOnId: row.id, cadence: row.cadence, waived: price.waived },
        },
        tx,
      );
  }

  private async applyOverride(
    tx: Tx,
    c: Prisma.ContractGetPayload<object>,
    a: Prisma.ContractAmendmentGetPayload<object>,
    b: Propose,
    at: Date,
  ) {
    for (const e of b.entitlements ?? []) {
      // a newer override replaces the previous override of the same key from this date (history kept)
      await tx.contractEntitlement.updateMany({
        where: {
          contractId: c.id,
          kind: e.kind,
          key: e.key,
          source: 'OVERRIDE',
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
        },
        data: { effectiveUntil: at },
      });
      await tx.contractEntitlement.create({
        data: {
          contractId: c.id,
          kind: e.kind,
          key: e.key,
          enabled: e.enabled,
          limitValue: e.kind === 'LIMIT' ? e.value : null,
          mode: e.mode ?? 'HARD',
          period: e.period ?? 'NONE',
          softAction: e.softAction ?? 'WARN',
          overageRateMinor: e.overageRateMinor ?? null,
          effectiveFrom: at,
          effectiveUntil: null,
          source: 'OVERRIDE',
          sourceRef: a.id,
          note: a.reason,
        },
      });
    }
  }

  private async applyPricing(
    tx: Tx,
    c: Prisma.ContractGetPayload<object>,
    a: Prisma.ContractAmendmentGetPayload<object>,
    b: Propose,
    at: Date,
    actor: Actor | null,
  ) {
    const p = b.pricing!;
    const last = await tx.contractRate.aggregate({
      _max: { version: true },
      where: { contractId: c.id, itemCode: p.itemCode },
    });
    await tx.contractRate.updateMany({
      where: {
        contractId: c.id,
        itemCode: p.itemCode,
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
      },
      data: { effectiveUntil: at },
    });
    await tx.contractRate.create({
      data: {
        contractId: c.id,
        itemCode: p.itemCode,
        version: (last._max.version ?? 0) + 1,
        model: p.rateBps !== null ? 'PERCENT_BPS' : 'FIXED',
        amountMinor: p.amountMinor,
        rateBps: p.rateBps,
        discountBps: p.discountBps,
        waived: p.waived,
        currency: c.currency ?? (await this.markets.currencyFor(c.organizationId, c.market)),
        effectiveFrom: at,
        approvalRef: a.id,
        createdByUserId: actor?.userId ?? a.requestedByUserId,
      },
    });
  }

  // ---------------------------------------------------------------- promotions and negotiated rates (admin)
  async addPromotion(actor: Actor, contractId: string, b: PromotionInput, meta: RequestMeta) {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!c) throw AppError.notFound();
    if (new Date(b.endAt) <= new Date(b.startAt))
      throw AppError.validation('The promotion must end after it starts', 'endAt');
    if (b.kind === 'PROMOTIONAL_PRICE' && b.promoPriceMinor === null && b.discountBps === null)
      throw AppError.validation(
        'A promotional price needs a price or a discount',
        'promoPriceMinor',
      );
    const row = await this.prisma.$transaction(async (tx) => {
      const p = await tx.contractPromotion.create({
        data: {
          contractId,
          kind: b.kind,
          itemCode: b.itemCode,
          originalPriceMinor: b.originalPriceMinor,
          promoPriceMinor: b.promoPriceMinor,
          discountBps: b.discountBps,
          waived: b.waived || b.kind === 'SETUP_WAIVER' || b.kind === 'FREE_ONBOARDING',
          creditMinor: b.creditMinor,
          currency: c.currency ?? (await this.markets.currencyFor(c.organizationId, c.market)),
          startAt: new Date(b.startAt),
          endAt: new Date(b.endAt),
          postPromotion: b.postPromotion,
          postPlanCode: b.postPlanCode,
          approvedByUserId: actor.userId,
          approvalRef: b.approvalRef ?? null,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'PROMOTION_ADDED',
          entityType: 'ContractPromotion',
          entityId: p.id,
          actor,
          subjectOrganizationId: c.organizationId,
          approvalRef: b.approvalRef ?? null,
          newState: { kind: b.kind, item: b.itemCode, start: b.startAt, end: b.endAt },
          meta,
        },
        tx,
      );
      return p;
    });
    return this.subscriptions.contractView(row.contractId);
  }

  async addRate(actor: Actor, contractId: string, b: RateInput, meta: RequestMeta) {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!c) throw AppError.notFound();
    const from = b.effectiveFrom ? new Date(b.effectiveFrom) : new Date();
    await this.prisma.$transaction(async (tx) => {
      const last = await tx.contractRate.aggregate({
        _max: { version: true },
        where: { contractId, itemCode: b.itemCode },
      });
      await tx.contractRate.updateMany({
        where: {
          contractId,
          itemCode: b.itemCode,
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: from } }],
        },
        data: { effectiveUntil: from },
      });
      const r = await tx.contractRate.create({
        data: {
          contractId,
          itemCode: b.itemCode,
          version: (last._max.version ?? 0) + 1,
          model: b.model,
          amountMinor: b.amountMinor,
          rateBps: b.rateBps,
          discountBps: b.discountBps,
          waived: b.waived,
          currency: c.currency ?? (await this.markets.currencyFor(c.organizationId, c.market)),
          effectiveFrom: from,
          effectiveUntil: b.effectiveUntil ? new Date(b.effectiveUntil) : null,
          approvalRef: b.approvalRef ?? null,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'CONTRACT_RATE_ADDED',
          entityType: 'ContractRate',
          entityId: r.id,
          actor,
          subjectOrganizationId: c.organizationId,
          approvalRef: b.approvalRef ?? null,
          newState: { item: b.itemCode, version: r.version, waived: b.waived },
          meta,
        },
        tx,
      );
    });
    return this.subscriptions.contractView(contractId);
  }

  // ---------------------------------------------------------------- views
  async view(id: string) {
    const a = await this.prisma.contractAmendment.findUnique({ where: { id } });
    if (!a) throw AppError.notFound();
    return {
      id: a.id,
      contractId: a.contractId,
      organizationId: a.organizationId,
      type: a.type,
      status: a.status,
      effectiveMode: a.effectiveMode,
      effectiveAt: a.effectiveAt.toISOString(),
      fromVersion: a.fromVersion,
      reason: a.reason,
      forced: a.forced,
      requestedByOrg: a.requestedByOrg,
      change: a.change,
      impact: a.impact as unknown as Impact,
      fromSnapshot: a.fromSnapshot,
      toSnapshot: a.toSnapshot,
      acceptanceId: a.acceptanceId,
      appliedAt: a.appliedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    };
  }

  async list(filter: { contractId?: string; organizationId?: string; status?: string }) {
    const rows = await this.prisma.contractAmendment.findMany({
      where: { ...filter },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return Promise.all(rows.map((r) => this.view(r.id)));
  }

  /** Applies every accepted change whose effective date has arrived (the scheduled "next billing cycle" and custom-date changes). */
  async applyDue(now = new Date()) {
    let applied = 0;
    let blocked = 0;
    for (const a of await this.prisma.contractAmendment.findMany({
      where: { status: 'ACCEPTED', effectiveAt: { lte: now } },
    })) {
      try {
        await this.apply(null, a.id, null, now);
        applied++;
      } catch (e) {
        if (e instanceof AppError && e.code === 'DOWNGRADE_BLOCKED') blocked++;
        else throw e;
      }
    }
    return { applied, blocked };
  }
}
