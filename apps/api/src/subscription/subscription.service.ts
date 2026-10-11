import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { IN_FORCE_LIFECYCLE, type BillingEventType } from '@dealdash/types';
import type { PlanEntitlements } from '@dealdash/validation';
import { z } from 'zod';
import type { assignPlanSchema } from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { Prisma } from '../generated/prisma/client';
import { EntitlementService } from '../platform/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { BillingEventService } from './billing-event.service';
import { PlanService } from './plan.service';
import { addDays, addMonths, DAY_MS, resolvePolicy } from './policy';
import { PricingResolver } from './pricing.resolver';
import { SignalService } from './signal.service';
import { UsageService } from './usage.service';

type AssignInput = z.infer<typeof assignPlanSchema>;
type Tx = Prisma.TransactionClient;
type PlanVersionRow = Prisma.CommercialPlanVersionGetPayload<{ include: { plan: true } }>;

/** Allowed lifecycle moves. Upgrades, downgrades, add-ons and renewals are amendments, never statuses. */
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['PENDING_ACTIVATION', 'ACTIVE', 'TRIAL', 'CANCELLED'],
  PENDING_ACTIVATION: ['ACTIVE', 'TRIAL', 'CANCELLED'],
  TRIAL: ['ACTIVE', 'PENDING_ACTIVATION', 'EXPIRED', 'CANCELLED'],
  ACTIVE: ['PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'],
  PAST_DUE: ['ACTIVE', 'SUSPENDED', 'CANCELLED'],
  SUSPENDED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
};

const ref = (p: string) => `${p}-${randomBytes(4).toString('hex').toUpperCase()}`;

/** Partner plans must match the partner type (a bank plan cannot be given to a card scheme). */
export function planFitsOrganization(
  plan: { entityType: string },
  org: { type: string; partner?: { partnerType: string } | null },
): boolean {
  if (plan.entityType === 'MERCHANT') return org.type === 'MERCHANT';
  if (org.type !== 'PARTNER') return false;
  const t = org.partner?.partnerType;
  return (
    plan.entityType === 'PARTNER' ||
    (plan.entityType === 'BANK' && t === 'BANK') ||
    (plan.entityType === 'SCHEME' && t === 'SCHEME') ||
    (plan.entityType === 'CORPORATE' && t === 'EMPLOYER')
  );
}

/**
 * Subscription and licence lifecycle on top of the existing Contract. A business enters a plan: the plan version is COPIED into the
 * contract (PLAN entitlement rows), the contract is accepted by an authorised person, and from then on the contract (with its overrides
 * and add-ons) is the authority. Nothing is deleted: ending a plan end-dates rows, history stays.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly plans: PlanService,
    private readonly pricing: PricingResolver,
    private readonly billing: BillingEventService,
    private readonly signals: SignalService,
    private readonly entitlements: EntitlementService,
    private readonly usage: UsageService,
  ) {}

  // ---------------------------------------------------------------- plan -> contract
  /** Writes the plan version's products, features and limits as PLAN rows (a snapshot: later plan edits never touch the contract). */
  async materialize(
    tx: Tx,
    contractId: string,
    v: PlanVersionRow,
    from: Date,
    until: Date | null,
    source: 'PLAN' = 'PLAN',
    sourceRef?: string,
  ) {
    const e = (v.entitlements ?? {}) as Partial<PlanEntitlements>;
    const rows: Prisma.ContractEntitlementCreateManyInput[] = [
      ...(e.products ?? []).map((key) => ({
        contractId,
        kind: 'PRODUCT',
        key,
        enabled: true,
        effectiveFrom: from,
        effectiveUntil: until,
        source,
        sourceRef,
      })),
      ...(e.features ?? []).map((key) => ({
        contractId,
        kind: 'FEATURE',
        key,
        enabled: true,
        effectiveFrom: from,
        effectiveUntil: until,
        source,
        sourceRef,
      })),
      ...(e.limits ?? []).map((l) => ({
        contractId,
        kind: 'LIMIT',
        key: l.key,
        enabled: true,
        limitValue: l.value,
        mode: l.mode,
        period: l.period,
        warnPercents: l.warnPercents,
        softAction: l.softAction,
        overageRateMinor: l.overageRateMinor,
        effectiveFrom: from,
        effectiveUntil: until,
        source,
        sourceRef,
      })),
    ];
    if (rows.length) await tx.contractEntitlement.createMany({ data: rows });
  }

  async snapshot(db: PrismaService | Tx, contractId: string, at = new Date()) {
    const c = await db.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: { entitlements: true },
    });
    return {
      version: c.version,
      status: c.status,
      planCode: c.planCode,
      planVersionId: c.planVersionId,
      market: c.market,
      currency: c.currency,
      billingCadence: c.billingCadence,
      renewalState: c.renewalState,
      effectiveUntil: c.effectiveUntil?.toISOString() ?? null,
      pricingVersionKey: c.pricingVersionKey,
      entitlements: c.entitlements
        .filter(
          (e) => e.effectiveFrom <= at && (e.effectiveUntil === null || e.effectiveUntil > at),
        )
        .map((e) => ({
          kind: e.kind,
          key: e.key,
          enabled: e.enabled,
          limitValue: e.limitValue,
          source: e.source,
          mode: e.mode,
          period: e.period,
        })),
    };
  }

  /** What is shown to, and recorded from, an accepting person: plan, price, setup, add-ons, usage pricing, term, billing, renewal, tax where configured. */
  async terms(contractId: string, at = new Date()) {
    const c = await this.prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: {
        planVersion: { include: { plan: true } },
        addOns: { where: { status: { in: ['PROPOSED', 'ACTIVE'] } } },
      },
    });
    const sub = c.planVersionId
      ? await this.pricing.subscription(contractId, at).catch(() => null)
      : null;
    const fees: Array<{ code: string; amountMinor: number | null; indicative: boolean }> = [];
    for (const f of (c.planVersion?.fees ?? []) as Array<{ code: string }>) {
      const r = await this.pricing.fee(contractId, f.code, at);
      fees.push({
        code: f.code,
        amountMinor: r.indicative ? null : r.amountMinor,
        indicative: r.indicative,
      });
    }
    const addOns = [];
    for (const a of c.addOns) {
      const r = await this.pricing.addOn(contractId, a.code, at);
      addOns.push({
        code: a.code,
        quantity: a.quantity,
        unitPriceMinor: a.priceMinor || (r.amountMinor ?? 0),
        cadence: a.cadence,
      });
    }
    const usagePricing = c.market
      ? (
          await this.prisma.priceItem.findMany({
            where: { status: 'ACTIVE' },
            include: {
              versions: {
                where: { market: c.market, status: 'PUBLISHED' },
                orderBy: { version: 'desc' },
                take: 1,
              },
            },
          })
        )
          .filter((i) => i.versions[0])
          .map((i) => ({
            code: i.code,
            model: i.versions[0]!.model,
            amountMinor: i.versions[0]!.amountMinor,
            rateBps: i.versions[0]!.rateBps,
            indicative: i.versions[0]!.indicative,
          }))
      : [];
    const country = c.market
      ? await this.prisma.countryConfiguration.findUnique({ where: { code: c.market } })
      : null;
    const base = sub && !sub.indicative ? (sub.amountMinor ?? 0) : 0;
    const oneOff = fees.reduce((n, f) => n + (f.amountMinor ?? 0), 0);
    const addOnTotal = addOns.reduce((n, a) => n + a.unitPriceMinor * a.quantity, 0);
    return {
      plan: c.planVersion
        ? {
            code: c.planVersion.plan.code,
            nameEn: c.planVersion.plan.nameEn,
            nameAr: c.planVersion.plan.nameAr,
            version: c.planVersion.version,
            market: c.planVersion.market,
          }
        : { code: c.planCode },
      kind: c.kind,
      currency: c.currency ?? c.planVersion?.currency ?? 'SAR',
      basePrice: sub
        ? {
            amountMinor: sub.indicative ? null : sub.amountMinor,
            cadence: c.billingCadence,
            indicative: sub.indicative,
            pricingVersionKey: sub.pricingVersionKey,
          }
        : null,
      fees,
      addOns,
      usagePricing,
      term: {
        effectiveFrom: c.effectiveFrom.toISOString(),
        effectiveUntil: c.effectiveUntil?.toISOString() ?? null,
      },
      billingCadence: c.billingCadence,
      renewalState: c.renewalState,
      // a statutory tax treatment is never stated here: only the configured profile of the market is carried
      tax: country ? { country: country.code, profile: country.taxProfile } : null,
      maxExposureMinor: base + oneOff + addOnTotal,
      termsVersion: c.termsVersion ?? 'v1',
    };
  }

  // ---------------------------------------------------------------- assign
  async assign(
    actor: Actor,
    b: AssignInput & { onBehalfAuthorizationId?: string },
    meta: RequestMeta,
  ) {
    const org = await this.prisma.organization.findUnique({
      where: { id: b.organizationId },
      include: { partner: true },
    });
    if (!org) throw AppError.validation('The organization was not found', 'organizationId');
    for (const id of [b.legalEntityId, b.billingLegalEntityId, ...b.coveredLegalEntityIds]) {
      if (!id) continue;
      if (
        !(await this.prisma.legalEntity.findFirst({
          where: { id, organizationId: b.organizationId },
        }))
      )
        throw AppError.validation('A legal entity was not found in this business', 'legalEntityId');
    }
    const le = b.legalEntityId
      ? await this.prisma.legalEntity.findUnique({ where: { id: b.legalEntityId } })
      : await this.prisma.legalEntity.findFirst({
          where: { organizationId: b.organizationId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
        });
    const market = b.market ?? le?.country ?? null;
    const plan = await this.prisma.commercialPlan.findUnique({ where: { code: b.planCode } });
    if (!plan)
      throw new AppError('PLAN_NOT_AVAILABLE', `The plan ${b.planCode} does not exist`, 404);
    if (!planFitsOrganization(plan, org))
      throw AppError.validation('This plan is not for this kind of business', 'planCode');
    const version = await this.plans.resolveVersion(b.planCode, market);
    const from = b.effectiveFrom ? new Date(b.effectiveFrom) : new Date();
    const until = b.effectiveUntil ? new Date(b.effectiveUntil) : null;
    if (until && until <= from)
      throw AppError.validation('The agreement must end after it starts', 'effectiveUntil');
    const cadence = b.cadence ?? (version.defaultCadence as string);
    const trial = b.trial;
    const free = plan.isFree || (!plan.negotiated && !(version.prices as unknown[]).length);
    if (b.activate && !free) {
      if (!b.onBehalfAuthorizationId)
        throw AppError.validation(
          'Activating a paid plan for the customer needs a recorded authorisation (or the customer accepts it)',
          'onBehalfAuthorizationId',
        );
      const auth = await this.prisma.adminAuthorization.findFirst({
        where: {
          id: b.onBehalfAuthorizationId,
          organizationId: b.organizationId,
          revokedAt: null,
          validUntil: { gt: new Date() },
        },
      });
      if (!auth)
        throw AppError.validation(
          'A valid authorisation record for this business is required',
          'onBehalfAuthorizationId',
        );
    }
    const status = trial ? 'TRIAL' : free || b.activate ? 'ACTIVE' : 'PENDING_ACTIVATION';
    const trialEnd = trial ? addDays(from, trial.days ?? version.trialDays ?? 14) : null;
    const created = await this.prisma.$transaction(async (tx) => {
      // a new in-force agreement for the same party supersedes the previous one from this date (history kept)
      const open = await tx.contract.findMany({
        where: {
          organizationId: b.organizationId,
          legalEntityId: b.legalEntityId,
          status: { in: [...IN_FORCE_LIFECYCLE] },
          effectiveUntil: null,
          kind: plan.contractKind,
        },
      });
      if (status !== 'PENDING_ACTIVATION')
        for (const o of open) {
          if (from <= o.effectiveFrom)
            throw AppError.validation(
              'A newer agreement already exists from this date',
              'effectiveFrom',
            );
          await tx.contract.update({
            where: { id: o.id },
            data: { status: 'SUPERSEDED', effectiveUntil: from },
          });
          await tx.contractEntitlement.updateMany({
            where: { contractId: o.id, effectiveUntil: null },
            data: { effectiveUntil: from },
          });
        }
      const c = await tx.contract.create({
        data: {
          organizationId: b.organizationId,
          legalEntityId: b.legalEntityId,
          name: b.name ?? `${plan.nameEn} (${market ?? 'ALL'})`,
          reference: b.reference ?? null,
          planCode: plan.code,
          planVersionId: version.id,
          kind: plan.contractKind,
          market,
          currency: version.currency,
          billingCadence: cadence,
          billingLegalEntityId: b.billingLegalEntityId,
          renewalState: b.renewalState,
          status,
          effectiveFrom: from,
          effectiveUntil: until,
          createdByUserId: actor.userId,
          activatedAt: status === 'PENDING_ACTIVATION' ? null : from,
          supportLevel: version.supportLevel,
          accountManager: b.accountManager ?? null,
          graceDays: null,
          pricingVersionKey: `PLV:${version.id}`,
          termsVersion: `${plan.code}-${market ?? 'ALL'}-v${version.version}`,
          developmentFixture: b.developmentFixture,
          nextBillingAt:
            status === 'ACTIVE' && cadence === 'MONTHLY'
              ? addMonths(from, 1)
              : status === 'ACTIVE' && cadence === 'ANNUAL'
                ? addMonths(from, 12)
                : null,
          nextRenewalAt:
            status === 'ACTIVE' && cadence === 'MONTHLY'
              ? addMonths(from, 1)
              : status === 'ACTIVE' && cadence === 'ANNUAL'
                ? addMonths(from, 12)
                : (until ?? null),
          coverage: {
            create: b.coveredLegalEntityIds.map((id) => ({ legalEntityId: id, role: 'COVERED' })),
          },
        },
      });
      // a PENDING agreement carries its entitlements dated from the intended start: they are not in force until the status says so
      await this.materialize(tx, c.id, version, from, trial ? trialEnd : until);
      if (trial) {
        await tx.contractTrial.create({
          data: {
            contractId: c.id,
            trialPlanVersionId: version.id,
            startAt: from,
            endAt: trialEnd!,
            entitlementSnapshot: (version.entitlements ?? {}) as Prisma.InputJsonValue,
            priceMinor: 0,
            currency: version.currency,
            postTrialPlanCode: trial.postTrialPlanCode,
            approvedByUserId: actor.userId,
          },
        });
      }
      await this.audit.record(
        {
          action: 'SUBSCRIPTION_ASSIGNED',
          entityType: 'Contract',
          entityId: c.id,
          actor,
          subjectOrganizationId: b.organizationId,
          approvalRef: b.approvalRef ?? null,
          newState: { plan: plan.code, market, version: version.version, status, trial: !!trial },
          scope: b.legalEntityId ? `LEGAL_ENTITY:${b.legalEntityId}` : 'ORGANIZATION',
          meta,
        },
        tx,
      );
      if (status === 'ACTIVE') await this.billActivation(tx, c.id, from);
      return c;
    });
    return this.contractView(created.id);
  }

  /** First charges when an agreement becomes active: the first period and any non-indicative setup / integration fees. Idempotent. */
  async billActivation(db: Tx | PrismaService, contractId: string, at: Date) {
    const c = await db.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: { planVersion: true },
    });
    if (!c.planVersionId) return;
    const sub = await this.pricing.subscription(contractId, at, undefined, db);
    if (
      c.billingCadence !== 'NONE' &&
      sub.amountMinor !== null &&
      !sub.indicative &&
      sub.amountMinor > 0
    ) {
      const annual = c.billingCadence === 'ANNUAL' || c.billingCadence === 'MULTI_YEAR';
      await this.billing.emit(
        {
          idempotencyKey: `renewal:${contractId}:${at.toISOString().slice(0, 10)}:${annual ? 'A' : 'M'}`,
          organizationId: c.organizationId,
          eventType: annual ? 'ANNUAL_LICENCE_RENEWAL' : 'MONTHLY_SUBSCRIPTION_RENEWAL',
          contractId,
          feature: 'SUBSCRIPTION',
          pricingVersionKey: sub.pricingVersionKey,
          unit: annual ? 'PER_YEAR' : 'PER_MONTH',
          unitRateMinor: sub.unitRateMinor,
          amountMinor: sub.amountMinor,
          currency: sub.currency,
          occurredAt: at,
          metadata: { phase: 'ACTIVATION', cadence: c.billingCadence, waived: sub.waived },
        },
        db,
      );
    }
    const typeOf: Record<string, BillingEventType> = {
      SETUP_FEE: 'SETUP_FEE',
      INTEGRATION_FEE: 'INTEGRATION_FEE',
      API_FEE: 'API_FEE',
    };
    for (const f of (c.planVersion?.fees ?? []) as Array<{ code: string }>) {
      const type =
        typeOf[f.code] ??
        (f.code.startsWith('INTEGRATION')
          ? 'INTEGRATION_FEE'
          : f.code.startsWith('API')
            ? 'API_FEE'
            : f.code.startsWith('SETUP')
              ? 'SETUP_FEE'
              : null);
      if (!type) continue;
      const r = await this.pricing.fee(contractId, f.code, at, db);
      if (r.amountMinor === null || r.indicative || r.amountMinor <= 0) continue;
      await this.billing.emit(
        {
          idempotencyKey: `fee:${contractId}:${f.code}`,
          organizationId: c.organizationId,
          eventType: type,
          contractId,
          feature: f.code,
          pricingVersionKey: r.pricingVersionKey,
          unitRateMinor: r.amountMinor,
          amountMinor: r.amountMinor,
          currency: r.currency,
          occurredAt: at,
          metadata: { feeCode: f.code, waived: r.waived },
        },
        db,
      );
    }
  }

  // ---------------------------------------------------------------- acceptance (the customer's commitment)
  /** The authorised person accepts the agreement's commercial terms: the contract becomes active, the acceptance is stored (immutable). */
  async acceptContract(
    actor: Actor,
    contractId: string,
    language: 'en' | 'ar',
    meta: RequestMeta,
    opts: { onBehalfAuthorizationId?: string; approvalRef?: string; amendmentId?: string } = {},
  ) {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!c) throw AppError.notFound();
    const onBehalf = actor.membership?.organizationType === 'DEALDASH';
    if (!onBehalf && actor.membership?.organizationId !== c.organizationId)
      throw AppError.notFound();
    if (!opts.amendmentId && c.status !== 'PENDING_ACTIVATION')
      throw new AppError('INVALID_STATE', 'This agreement is not waiting for acceptance', 409);
    if (onBehalf) {
      const auth = opts.onBehalfAuthorizationId
        ? await this.prisma.adminAuthorization.findFirst({
            where: {
              id: opts.onBehalfAuthorizationId,
              organizationId: c.organizationId,
              revokedAt: null,
              validUntil: { gt: new Date() },
            },
          })
        : null;
      if (!auth)
        throw AppError.validation(
          'A valid authorisation record for this business is required',
          'onBehalfAuthorizationId',
        );
    }
    const t = await this.terms(contractId);
    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { displayName: true },
      });
      const acc = await tx.contractAcceptance.create({
        data: {
          reference: ref('CA'),
          contractId,
          amendmentId: opts.amendmentId ?? null,
          organizationId: c.organizationId,
          legalEntityId: c.legalEntityId,
          userId: actor.userId,
          userRole: actor.membership?.roleCode ?? null,
          userName: user?.displayName ?? null,
          onBehalfAuthorizationId: onBehalf ? (opts.onBehalfAuthorizationId ?? null) : null,
          planVersionId: c.planVersionId,
          pricingVersionKey: c.pricingVersionKey,
          termsVersion: t.termsVersion,
          currency: t.currency,
          acceptedAmountMinor: t.basePrice?.amountMinor ?? 0,
          maxExposureMinor: t.maxExposureMinor,
          effectiveFrom: c.effectiveFrom,
          billingCadence: c.billingCadence,
          approvalRef: opts.approvalRef ?? null,
          terms: t as unknown as Prisma.InputJsonValue,
          language,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        },
      });
      if (!opts.amendmentId) {
        const now = new Date();
        const start = c.effectiveFrom > now ? c.effectiveFrom : now;
        await tx.contract.update({
          where: { id: contractId },
          data: {
            status: 'ACTIVE',
            activatedAt: start,
            effectiveFrom: start,
            nextBillingAt:
              c.billingCadence === 'MONTHLY'
                ? addMonths(start, 1)
                : c.billingCadence === 'ANNUAL'
                  ? addMonths(start, 12)
                  : null,
            nextRenewalAt:
              c.billingCadence === 'MONTHLY'
                ? addMonths(start, 1)
                : c.billingCadence === 'ANNUAL'
                  ? addMonths(start, 12)
                  : c.effectiveUntil,
          },
        });
        // the entitlements were dated from the intended start; re-date them if the acceptance came later
        if (start > c.effectiveFrom)
          await tx.contractEntitlement.updateMany({
            where: { contractId, effectiveFrom: c.effectiveFrom },
            data: { effectiveFrom: start },
          });
        const open = await tx.contract.findMany({
          where: {
            organizationId: c.organizationId,
            legalEntityId: c.legalEntityId,
            id: { not: contractId },
            status: { in: [...IN_FORCE_LIFECYCLE] },
            effectiveUntil: null,
            kind: c.kind,
          },
        });
        for (const o of open) {
          await tx.contract.update({
            where: { id: o.id },
            data: { status: 'SUPERSEDED', effectiveUntil: start },
          });
          await tx.contractEntitlement.updateMany({
            where: { contractId: o.id, effectiveUntil: null },
            data: { effectiveUntil: start },
          });
        }
        await this.billActivation(tx, contractId, start);
      }
      await this.audit.record(
        {
          action: 'CONTRACT_ACCEPTED',
          entityType: 'Contract',
          entityId: contractId,
          actor,
          subjectOrganizationId: c.organizationId,
          approvalRef: opts.approvalRef ?? null,
          newState: { acceptance: acc.reference, maxExposureMinor: t.maxExposureMinor },
          meta,
        },
        tx,
      );
      return acc;
    });
    return {
      acceptanceId: result.id,
      reference: result.reference,
      contract: await this.contractView(contractId),
    };
  }

  // ---------------------------------------------------------------- lifecycle
  private async move(
    actor: Actor | null,
    contractId: string,
    to: string,
    reason: string,
    meta: RequestMeta | null,
    patch: Prisma.ContractUncheckedUpdateInput = {},
  ) {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!c) throw AppError.notFound();
    if (!(TRANSITIONS[c.status] ?? []).includes(to))
      throw new AppError('INVALID_STATE', `A ${c.status} agreement cannot become ${to}`, 409);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.contract.updateMany({
        where: { id: contractId, status: c.status },
        data: { status: to, ...patch },
      });
      if (r.count !== 1)
        throw new AppError('VERSION_CONFLICT', 'The agreement changed. Reload and try again.', 409);
      await this.audit.record(
        {
          action: `SUBSCRIPTION_${to}`,
          entityType: 'Contract',
          entityId: contractId,
          actor: actor ?? undefined,
          actorRole: actor ? undefined : 'SYSTEM',
          subjectOrganizationId: c.organizationId,
          reason,
          previousState: { status: c.status },
          newState: { status: to },
          meta: meta ?? undefined,
        },
        tx,
      );
    });
    return c;
  }

  /** Payment is overdue: the grace period starts (configurable per contract, plan, entity type, market). Nothing destructive happens. */
  async markPastDue(
    actor: Actor | null,
    contractId: string,
    reason: string,
    meta: RequestMeta | null,
    now = new Date(),
  ) {
    const c = await this.prisma.contract.findUniqueOrThrow({
      where: { id: contractId },
      include: { planVersion: true },
    });
    const org = await this.prisma.organization.findUnique({
      where: { id: c.organizationId },
      select: { type: true, partner: { select: { partnerType: true } } },
    });
    const policy = await resolvePolicy(
      this.config,
      c,
      c.planVersion,
      org?.partner?.partnerType ?? org?.type ?? null,
    );
    const graceUntil = new Date(now.getTime() + policy.graceDays * DAY_MS);
    await this.move(actor, contractId, 'PAST_DUE', reason, meta, { pastDueSince: now, graceUntil });
    await this.signals.raise({
      type: 'PAYMENT_GRACE_STARTED',
      dedupeKey: `grace:${contractId}:${now.toISOString().slice(0, 10)}`,
      organizationId: c.organizationId,
      contractId,
      payload: { graceUntil: graceUntil.toISOString(), graceDays: policy.graceDays },
    });
    return this.contractView(contractId);
  }

  async suspend(
    actor: Actor | null,
    contractId: string,
    reason: string,
    meta: RequestMeta | null,
    now = new Date(),
  ) {
    const c = await this.move(actor, contractId, 'SUSPENDED', reason, meta, { suspendedAt: now });
    await this.signals.raise({
      type: 'CONTRACT_SUSPENDED',
      dedupeKey: `suspended:${contractId}:${now.toISOString().slice(0, 10)}`,
      organizationId: c.organizationId,
      contractId,
      payload: { reason },
    });
    return this.contractView(contractId);
  }

  /** Back to good standing (paid, or reinstated by DealDash with a reason). */
  async reinstate(
    actor: Actor | null,
    contractId: string,
    reason: string,
    meta: RequestMeta | null,
  ) {
    await this.move(actor, contractId, 'ACTIVE', reason, meta, {
      pastDueSince: null,
      graceUntil: null,
      suspendedAt: null,
    });
    return this.contractView(contractId);
  }

  /** Ends the agreement. New exposure stops; history, finance, audit and issued customer rights are untouched (entitlement rows are end-dated, never deleted). */
  async cancel(
    actor: Actor | null,
    contractId: string,
    reason: string,
    meta: RequestMeta | null,
    at = new Date(),
  ) {
    const c = await this.move(actor, contractId, 'CANCELLED', reason, meta, {
      cancelledAt: at,
      effectiveUntil: at,
      renewalState: 'NON_RENEWING',
    });
    await this.prisma.contractEntitlement.updateMany({
      where: { contractId, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }] },
      data: { effectiveUntil: at },
    });
    await this.prisma.contractAddOn.updateMany({
      where: { contractId, status: { in: ['PROPOSED', 'ACTIVE'] } },
      data: { status: 'CANCELLED' },
    });
    void c;
    return this.contractView(contractId);
  }

  async setRenewalState(
    actor: Actor,
    contractId: string,
    renewalState: string,
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!c) throw AppError.notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.contract.update({ where: { id: contractId }, data: { renewalState } });
      await this.audit.record(
        {
          action: 'RENEWAL_STATE_CHANGED',
          entityType: 'Contract',
          entityId: contractId,
          actor,
          subjectOrganizationId: c.organizationId,
          reason: reason ?? null,
          previousState: { renewalState: c.renewalState },
          newState: { renewalState },
          meta,
        },
        tx,
      );
    });
    return this.contractView(contractId);
  }

  // ---------------------------------------------------------------- renewal
  /** Renews the current period: a billing event for the new period and the next dates. Idempotent per period. */
  async renew(actor: Actor | null, contractId: string, meta: RequestMeta | null, now = new Date()) {
    const c = await this.prisma.contract.findUnique({ where: { id: contractId } });
    if (!c) throw AppError.notFound();
    if (!['ACTIVE', 'PAST_DUE'].includes(c.status))
      throw new AppError('INVALID_STATE', `A ${c.status} agreement cannot be renewed`, 409);
    if (c.billingCadence === 'NONE') return this.contractView(contractId);
    const due = c.nextRenewalAt ?? c.nextBillingAt ?? now;
    const annual = c.billingCadence === 'ANNUAL' || c.billingCadence === 'MULTI_YEAR';
    const monthly = c.billingCadence === 'MONTHLY';
    const next = monthly ? addMonths(due, 1) : annual ? addMonths(due, 12) : null;
    await this.prisma.$transaction(async (tx) => {
      const sub = await this.pricing.subscription(contractId, due, undefined, tx);
      if (sub.amountMinor !== null && !sub.indicative && sub.amountMinor > 0)
        await this.billing.emit(
          {
            idempotencyKey: `renewal:${contractId}:${due.toISOString().slice(0, 10)}:${annual ? 'A' : 'M'}`,
            organizationId: c.organizationId,
            eventType: annual ? 'ANNUAL_LICENCE_RENEWAL' : 'MONTHLY_SUBSCRIPTION_RENEWAL',
            contractId,
            feature: 'SUBSCRIPTION',
            pricingVersionKey: sub.pricingVersionKey,
            unit: annual ? 'PER_YEAR' : 'PER_MONTH',
            unitRateMinor: sub.unitRateMinor,
            amountMinor: sub.amountMinor,
            currency: sub.currency,
            occurredAt: due,
            metadata: { phase: 'RENEWAL', cadence: c.billingCadence, waived: sub.waived },
          },
          tx,
        );
      const patch: Prisma.ContractUncheckedUpdateInput = {
        nextBillingAt: next,
        nextRenewalAt: next,
        renewalState: c.renewalState === 'RENEWAL_PENDING' ? 'AUTO_RENEW' : c.renewalState,
      };
      // a fixed-term licence is extended by its term; the previous end is kept in the amendment record
      if (annual && c.effectiveUntil) {
        const newUntil = addMonths(c.effectiveUntil, 12);
        patch.effectiveUntil = newUntil;
        await tx.contractEntitlement.updateMany({
          where: { contractId, effectiveUntil: c.effectiveUntil },
          data: { effectiveUntil: newUntil },
        });
        await tx.contractAmendment.create({
          data: {
            contractId,
            organizationId: c.organizationId,
            fromVersion: c.version,
            type: 'RENEWAL',
            status: 'APPLIED',
            effectiveMode: 'IMMEDIATE',
            effectiveAt: due,
            change: { newEndAt: newUntil.toISOString() },
            fromSnapshot: { effectiveUntil: c.effectiveUntil.toISOString() },
            toSnapshot: { effectiveUntil: newUntil.toISOString() },
            impact: {},
            reason: 'Renewal',
            requestedByUserId: actor?.userId ?? c.createdByUserId,
            appliedAt: now,
          },
        });
        patch.version = { increment: 1 };
      }
      await tx.contract.update({ where: { id: contractId }, data: patch });
      await this.audit.record(
        {
          action: 'SUBSCRIPTION_RENEWED',
          entityType: 'Contract',
          entityId: contractId,
          actor: actor ?? undefined,
          actorRole: actor ? undefined : 'SYSTEM',
          subjectOrganizationId: c.organizationId,
          newState: { period: due.toISOString(), next: next?.toISOString() ?? null },
          meta: meta ?? undefined,
        },
        tx,
      );
    });
    return this.contractView(contractId);
  }

  // ---------------------------------------------------------------- the scheduled pass
  /** Moves everything that is due: trials, promotions, grace, expiry, renewals, and raises the approaching-date signals. Idempotent. */
  async runDue(now = new Date()) {
    const done = {
      trialsEnded: 0,
      promotionsEnded: 0,
      suspended: 0,
      expired: 0,
      renewed: 0,
      pendingRenewals: 0,
      signals: 0,
    };
    const sig = (await this.config.get<{ leadDays: Record<string, number> }>(
      CONFIG_KEYS.COMMERCIAL_SIGNALS,
    )) ?? { leadDays: {} };
    const lead = (k: string, d: number) => sig.leadDays?.[k] ?? d;
    // trials
    for (const t of await this.prisma.contractTrial.findMany({
      where: { status: 'ACTIVE', endAt: { lte: now } },
      include: { contract: true },
    })) {
      await this.endTrial(t.id, now);
      done.trialsEnded++;
    }
    for (const t of await this.prisma.contractTrial.findMany({
      where: { status: 'ACTIVE', endAt: { gt: now, lte: addDays(now, lead('TRIAL_EXPIRING', 7)) } },
    })) {
      const c = await this.prisma.contract.findUnique({ where: { id: t.contractId } });
      if (
        c &&
        (await this.signals.raise({
          type: 'TRIAL_EXPIRING',
          dedupeKey: `trial-expiring:${t.id}`,
          organizationId: c.organizationId,
          contractId: c.id,
          payload: { endAt: t.endAt.toISOString() },
        }))
      )
        done.signals++;
    }
    // promotions
    for (const p of await this.prisma.contractPromotion.findMany({
      where: { status: 'ACTIVE', endAt: { lte: now } },
      include: { contract: true },
    })) {
      await this.prisma.contractPromotion.update({
        where: { id: p.id },
        data: { status: 'ENDED' },
      });
      await this.audit.record({
        action: 'PROMOTION_ENDED',
        entityType: 'ContractPromotion',
        entityId: p.id,
        actorRole: 'SYSTEM',
        subjectOrganizationId: p.contract.organizationId,
        newState: { post: p.postPromotion },
      });
      done.promotionsEnded++;
    }
    for (const p of await this.prisma.contractPromotion.findMany({
      where: {
        status: 'ACTIVE',
        endAt: { gt: now, lte: addDays(now, lead('PROMOTION_EXPIRING', 7)) },
      },
      include: { contract: true },
    }))
      if (
        await this.signals.raise({
          type: 'PROMOTION_EXPIRING',
          dedupeKey: `promotion-expiring:${p.id}`,
          organizationId: p.contract.organizationId,
          contractId: p.contractId,
          payload: { endAt: p.endAt.toISOString() },
        })
      )
        done.signals++;
    // grace elapsed -> suspended
    const policyOn =
      (
        await this.config.get<{ autoSuspendAfterGrace?: boolean }>(
          CONFIG_KEYS.COMMERCIAL_ENFORCEMENT,
        )
      )?.autoSuspendAfterGrace ?? true;
    if (policyOn)
      for (const c of await this.prisma.contract.findMany({
        where: { status: 'PAST_DUE', graceUntil: { lte: now } },
      })) {
        await this.suspend(null, c.id, 'Payment grace period ended', null, now).catch(
          () => undefined,
        );
        done.suspended++;
      }
    // fixed-term ends and renewals
    for (const c of await this.prisma.contract.findMany({
      where: { status: { in: ['ACTIVE', 'PAST_DUE'] }, effectiveUntil: { lte: now } },
    })) {
      if (c.renewalState === 'AUTO_RENEW' && c.status === 'ACTIVE' && c.billingCadence !== 'NONE') {
        await this.renew(null, c.id, null, now).catch(() => undefined);
        done.renewed++;
      } else if (c.renewalState === 'MANUAL_RENEWAL' && c.status === 'ACTIVE') {
        await this.prisma.contract.update({
          where: { id: c.id },
          data: { renewalState: 'RENEWAL_PENDING' },
        });
        done.pendingRenewals++;
      } else {
        await this.move(null, c.id, 'EXPIRED', 'Contract term ended', null).catch(() => undefined);
        await this.prisma.contractEntitlement.updateMany({
          where: { contractId: c.id, effectiveUntil: null },
          data: { effectiveUntil: now },
        });
        done.expired++;
      }
    }
    // a rolling agreement that asked not to renew ends when its current period ends (nothing is deleted: rows are end-dated)
    for (const c of await this.prisma.contract.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        effectiveUntil: null,
        renewalState: 'NON_RENEWING',
        nextRenewalAt: { lte: now },
      },
    })) {
      const end = c.nextRenewalAt!;
      await this.move(null, c.id, 'EXPIRED', 'Not renewed at the end of the period', null, {
        effectiveUntil: end,
      }).catch(() => undefined);
      await this.prisma.contractEntitlement.updateMany({
        where: {
          contractId: c.id,
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: end } }],
        },
        data: { effectiveUntil: end },
      });
      done.expired++;
    }
    // rolling renewals (monthly / annual without a fixed end)
    for (const c of await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        effectiveUntil: null,
        renewalState: 'AUTO_RENEW',
        billingCadence: { in: ['MONTHLY', 'ANNUAL'] },
        nextRenewalAt: { lte: now },
      },
    })) {
      await this.renew(null, c.id, null, now).catch(() => undefined);
      done.renewed++;
    }
    for (const c of await this.prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        renewalState: { in: ['MANUAL_RENEWAL', 'RENEWAL_PENDING'] },
        nextRenewalAt: { lte: now },
      },
    }))
      if (c.renewalState === 'MANUAL_RENEWAL') {
        await this.prisma.contract.update({
          where: { id: c.id },
          data: { renewalState: 'RENEWAL_PENDING' },
        });
        done.pendingRenewals++;
      }
    // approaching dates
    for (const c of await this.prisma.contract.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        nextRenewalAt: { gt: now, lte: addDays(now, lead('RENEWAL_APPROACHING', 30)) },
      },
    }))
      if (
        await this.signals.raise({
          type: 'RENEWAL_APPROACHING',
          dedupeKey: `renewal-approaching:${c.id}:${c.nextRenewalAt!.toISOString().slice(0, 10)}`,
          organizationId: c.organizationId,
          contractId: c.id,
          payload: { at: c.nextRenewalAt!.toISOString() },
        })
      )
        done.signals++;
    for (const c of await this.prisma.contract.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        effectiveUntil: { gt: now, lte: addDays(now, lead('CONTRACT_EXPIRING', 30)) },
      },
    }))
      if (
        await this.signals.raise({
          type: 'CONTRACT_EXPIRING',
          dedupeKey: `contract-expiring:${c.id}:${c.effectiveUntil!.toISOString().slice(0, 10)}`,
          organizationId: c.organizationId,
          contractId: c.id,
          payload: { at: c.effectiveUntil!.toISOString() },
        })
      )
        done.signals++;
    return done;
  }

  /** A trial ended: convert to the configured post-trial plan, else expire (never silently Starter unless the platform is configured to). */
  async endTrial(trialId: string, now = new Date()) {
    const t = await this.prisma.contractTrial.findUniqueOrThrow({
      where: { id: trialId },
      include: { contract: true },
    });
    const c = t.contract;
    const cfg =
      (await this.config.get<{
        convertToStarterWhenNoPostPlan?: boolean;
        starterPlanCode?: string;
      }>(CONFIG_KEYS.COMMERCIAL_TRIAL)) ?? {};
    const planCode =
      t.postTrialPlanCode ??
      (cfg.convertToStarterWhenNoPostPlan ? (cfg.starterPlanCode ?? 'STARTER') : null);
    await this.prisma.$transaction(async (tx) => {
      await tx.contractEntitlement.updateMany({
        where: { contractId: c.id, effectiveUntil: null },
        data: { effectiveUntil: t.endAt },
      });
      await tx.contractEntitlement.updateMany({
        where: { contractId: c.id, effectiveUntil: { gt: t.endAt } },
        data: { effectiveUntil: t.endAt },
      });
      if (!planCode) {
        await tx.contract.update({
          where: { id: c.id },
          data: { status: 'EXPIRED', effectiveUntil: t.endAt },
        });
        await tx.contractTrial.update({ where: { id: t.id }, data: { status: 'EXPIRED' } });
        await this.audit.record(
          {
            action: 'TRIAL_EXPIRED',
            entityType: 'Contract',
            entityId: c.id,
            actorRole: 'SYSTEM',
            subjectOrganizationId: c.organizationId,
            newState: { trial: t.id },
          },
          tx,
        );
        return;
      }
      const version = await this.plans.resolveVersion(planCode, c.market, now);
      const free = version.plan.isFree || !(version.prices as unknown[]).length;
      await tx.contract.update({
        where: { id: c.id },
        data: {
          status: free ? 'ACTIVE' : 'PENDING_ACTIVATION',
          planCode,
          planVersionId: version.id,
          kind: version.plan.contractKind,
          pricingVersionKey: `PLV:${version.id}`,
          currency: version.currency,
          billingCadence: version.defaultCadence,
          version: { increment: 1 },
          effectiveFrom: t.endAt,
          effectiveUntil: null,
          activatedAt: free ? t.endAt : null,
          termsVersion: `${planCode}-${c.market ?? 'ALL'}-v${version.version}`,
        },
      });
      await this.materialize(tx, c.id, version, t.endAt, null);
      await tx.contractTrial.update({ where: { id: t.id }, data: { status: 'CONVERTED' } });
      await this.audit.record(
        {
          action: 'TRIAL_CONVERTED',
          entityType: 'Contract',
          entityId: c.id,
          actorRole: 'SYSTEM',
          subjectOrganizationId: c.organizationId,
          newState: { plan: planCode, needsAcceptance: !free },
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- views
  async contractView(id: string) {
    const c = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        entitlements: true,
        planVersion: { include: { plan: true } },
        coverage: true,
        addOns: true,
        trials: true,
        promotions: true,
        rates: true,
      },
    });
    if (!c) throw AppError.notFound();
    return {
      id: c.id,
      organizationId: c.organizationId,
      legalEntityId: c.legalEntityId,
      billingLegalEntityId: c.billingLegalEntityId,
      coveredLegalEntityIds: c.coverage
        .filter((x) => x.role === 'COVERED')
        .map((x) => x.legalEntityId),
      name: c.name,
      reference: c.reference,
      kind: c.kind,
      status: c.status,
      renewalState: c.renewalState,
      market: c.market,
      currency: c.currency,
      billingCadence: c.billingCadence,
      version: c.version,
      planCode: c.planCode,
      planName: c.planVersion
        ? { en: c.planVersion.plan.nameEn, ar: c.planVersion.plan.nameAr }
        : null,
      planVersionId: c.planVersionId,
      planVersion: c.planVersion?.version ?? null,
      effectiveFrom: c.effectiveFrom.toISOString(),
      effectiveUntil: c.effectiveUntil?.toISOString() ?? null,
      pastDueSince: c.pastDueSince?.toISOString() ?? null,
      graceUntil: c.graceUntil?.toISOString() ?? null,
      suspendedAt: c.suspendedAt?.toISOString() ?? null,
      nextBillingAt: c.nextBillingAt?.toISOString() ?? null,
      nextRenewalAt: c.nextRenewalAt?.toISOString() ?? null,
      supportLevel: c.supportLevel,
      accountManager: c.accountManager,
      pricingVersionKey: c.pricingVersionKey,
      developmentFixture: c.developmentFixture,
      entitlements: c.entitlements.map((e) => ({
        id: e.id,
        kind: e.kind,
        key: e.key,
        enabled: e.enabled,
        limitValue: e.limitValue,
        source: e.source,
        mode: e.mode,
        period: e.period,
        softAction: e.softAction,
        effectiveFrom: e.effectiveFrom.toISOString(),
        effectiveUntil: e.effectiveUntil?.toISOString() ?? null,
      })),
      addOns: c.addOns.map((a) => ({
        id: a.id,
        code: a.code,
        quantity: a.quantity,
        priceMinor: a.priceMinor,
        currency: a.currency,
        cadence: a.cadence,
        status: a.status,
        startAt: a.startAt.toISOString(),
        endAt: a.endAt?.toISOString() ?? null,
        autoRenew: a.autoRenew,
      })),
      trial:
        c.trials
          .map((t) => ({
            id: t.id,
            status: t.status,
            startAt: t.startAt.toISOString(),
            endAt: t.endAt.toISOString(),
            postTrialPlanCode: t.postTrialPlanCode,
          }))
          .at(-1) ?? null,
      promotions: c.promotions.map((p) => ({
        id: p.id,
        kind: p.kind,
        itemCode: p.itemCode,
        status: p.status,
        originalPriceMinor: p.originalPriceMinor,
        promoPriceMinor: p.promoPriceMinor,
        discountBps: p.discountBps,
        waived: p.waived,
        startAt: p.startAt.toISOString(),
        endAt: p.endAt.toISOString(),
        postPromotion: p.postPromotion,
      })),
      rates: c.rates.map((r) => ({
        id: r.id,
        itemCode: r.itemCode,
        version: r.version,
        model: r.model,
        amountMinor: r.amountMinor,
        rateBps: r.rateBps,
        discountBps: r.discountBps,
        waived: r.waived,
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveUntil: r.effectiveUntil?.toISOString() ?? null,
      })),
    };
  }

  /** Contracts for the admin list (filters by organization, kind, lifecycle). */
  async list(filter: { organizationId?: string; kind?: string; status?: string; limit?: number }) {
    const rows = await this.prisma.contract.findMany({
      where: {
        ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.status ? { status: filter.status } : {}),
      },
      include: { planVersion: { include: { plan: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 100, 300),
    });
    const orgs = new Map(
      (
        await this.prisma.organization.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.organizationId))] } },
          select: { id: true, nameEn: true, nameAr: true, type: true },
        })
      ).map((o) => [o.id, o]),
    );
    return rows.map((c) => ({
      id: c.id,
      organizationId: c.organizationId,
      organization: orgs.get(c.organizationId)
        ? { en: orgs.get(c.organizationId)!.nameEn, ar: orgs.get(c.organizationId)!.nameAr }
        : null,
      name: c.name,
      kind: c.kind,
      status: c.status,
      planCode: c.planCode,
      market: c.market,
      currency: c.currency,
      billingCadence: c.billingCadence,
      renewalState: c.renewalState,
      effectiveFrom: c.effectiveFrom.toISOString(),
      effectiveUntil: c.effectiveUntil?.toISOString() ?? null,
      nextRenewalAt: c.nextRenewalAt?.toISOString() ?? null,
      developmentFixture: c.developmentFixture,
    }));
  }

  /** Launch readiness: organizations that still run on the default plan and have no agreement of their own. */
  async unassigned() {
    const orgs = await this.prisma.organization.findMany({
      where: { type: { in: ['MERCHANT', 'PARTNER'] }, status: 'ACTIVE' },
      select: {
        id: true,
        nameEn: true,
        nameAr: true,
        type: true,
        partner: { select: { partnerType: true } },
      },
    });
    const withContract = new Set(
      (
        await this.prisma.contract.findMany({
          where: { status: { in: [...IN_FORCE_LIFECYCLE, 'PENDING_ACTIVATION'] } },
          select: { organizationId: true },
        })
      ).map((c) => c.organizationId),
    );
    return orgs
      .filter((o) => !withContract.has(o.id))
      .map((o) => ({
        organizationId: o.id,
        name: { en: o.nameEn, ar: o.nameAr },
        type: o.type,
        partnerType: o.partner?.partnerType ?? null,
      }));
  }

  /** The governed picture of an organization's commercial position (screens, support, and the AI layer read this; nobody invents terms). */
  async summaryFor(
    organizationId: string,
    opts: { legalEntityId?: string | null; at?: Date } = {},
  ) {
    const at = opts.at ?? new Date();
    const e = await this.entitlements.effective(organizationId, at, {
      legalEntityId: opts.legalEntityId,
    });
    const fin = await this.entitlements.financialStatus(organizationId, at);
    const usageLines = await this.usage.usageView(organizationId, {
      legalEntityId: opts.legalEntityId,
      at,
    });
    const contract = e.contractId ? await this.contractView(e.contractId) : null;
    const price =
      e.contractId && contract?.planVersionId
        ? await this.pricing.subscription(e.contractId, at).catch(() => null)
        : null;
    const history = await this.prisma.contractAmendment.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    const prior = await this.prisma.contract.findMany({
      where: { organizationId, status: { in: ['SUPERSEDED', 'CANCELLED', 'EXPIRED'] } },
      orderBy: { effectiveFrom: 'desc' },
      take: 10,
      select: {
        id: true,
        planCode: true,
        status: true,
        effectiveFrom: true,
        effectiveUntil: true,
        kind: true,
      },
    });
    return {
      source: e.source,
      lifecycle: e.lifecycle,
      financialStatus: fin,
      contract,
      price: price
        ? {
            amountMinor: price.indicative ? null : price.amountMinor,
            currency: price.currency,
            cadence: contract?.billingCadence,
            indicative: price.indicative,
            waived: price.waived,
            pricingVersionKey: price.pricingVersionKey,
            adjustments: price.adjustments,
          }
        : null,
      products: e.products,
      features: e.features,
      limits: Object.entries(e.limitDetails).map(([key, d]) => ({
        key,
        value: d.value,
        mode: d.mode,
        period: d.period,
        source: d.source,
        base: d.base,
        override: d.override,
        addOns: d.addOns,
      })),
      usage: usageLines,
      amendments: history.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        effectiveAt: a.effectiveAt.toISOString(),
        effectiveMode: a.effectiveMode,
        targetPlanVersionId: a.targetPlanVersionId,
        reason: a.reason,
        forced: a.forced,
        createdAt: a.createdAt.toISOString(),
      })),
      previousAgreements: prior.map((p) => ({
        id: p.id,
        planCode: p.planCode,
        status: p.status,
        kind: p.kind,
        effectiveFrom: p.effectiveFrom.toISOString(),
        effectiveUntil: p.effectiveUntil?.toISOString() ?? null,
      })),
    };
  }
}
