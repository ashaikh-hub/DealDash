import { Injectable } from '@nestjs/common';
import { ALL_LIMIT_KEYS, SUBSCRIPTION_FEATURES, SUBSCRIPTION_PRODUCTS } from '@dealdash/types';
import type { z } from 'zod';
import type {
  addOnDefinitionSchema,
  planCreateSchema,
  planVersionDraftSchema,
  priceItemCreateSchema,
  priceItemVersionSchema,
} from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type PlanInput = z.infer<typeof planCreateSchema>;
type DraftInput = z.infer<typeof planVersionDraftSchema>;
type ItemInput = z.infer<typeof priceItemCreateSchema>;
type ItemVersionInput = z.infer<typeof priceItemVersionSchema>;
type AddOnInput = z.infer<typeof addOnDefinitionSchema>;

type PlanVersionRow = Prisma.CommercialPlanVersionGetPayload<{ include: { plan: true } }>;

/**
 * The plan catalog and the price book. A plan is a reusable template; a plan VERSION is a per-market snapshot (prices, entitlements,
 * limits, grace, enforcement). Published versions are immutable (a database rule too): a change is a new version, published by a
 * DIFFERENT person than its author. Contracts copy a version when a business enters a plan, so editing a plan never changes a customer.
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- views
  versionView(v: PlanVersionRow) {
    return {
      id: v.id,
      planId: v.planId,
      planCode: v.plan.code,
      market: v.market,
      currency: v.currency,
      version: v.version,
      status: v.status,
      effectiveFrom: v.effectiveFrom.toISOString(),
      effectiveUntil: v.effectiveUntil?.toISOString() ?? null,
      defaultCadence: v.defaultCadence,
      prices: v.prices,
      fees: v.fees,
      addOnPrices: v.addOnPrices,
      entitlements: v.entitlements,
      addOnCodes: v.addOnCodes,
      supportLevel: v.supportLevel,
      trialDays: v.trialDays,
      graceDays: v.graceDays,
      enforcement: v.enforcement,
      rules: v.rules,
      referencePricing: v.referencePricing,
      developmentFixture: v.developmentFixture,
      publishedAt: v.publishedAt?.toISOString() ?? null,
    };
  }

  private planView(p: Prisma.CommercialPlanGetPayload<{ include: { versions: true } }>) {
    return {
      id: p.id,
      code: p.code,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      descriptionEn: p.descriptionEn,
      descriptionAr: p.descriptionAr,
      entityType: p.entityType,
      contractKind: p.contractKind,
      isFree: p.isFree,
      negotiated: p.negotiated,
      status: p.status,
      sortOrder: p.sortOrder,
      versions: p.versions
        .sort((a, b) => a.market.localeCompare(b.market) || b.version - a.version)
        .map((v) => ({
          id: v.id,
          market: v.market,
          currency: v.currency,
          version: v.version,
          status: v.status,
          effectiveFrom: v.effectiveFrom.toISOString(),
          effectiveUntil: v.effectiveUntil?.toISOString() ?? null,
          prices: v.prices,
          defaultCadence: v.defaultCadence,
          developmentFixture: v.developmentFixture,
        })),
    };
  }

  // ---------------------------------------------------------------- catalog
  async listPlans(opts: { entityType?: string; market?: string; includeRetired?: boolean } = {}) {
    const rows = await this.prisma.commercialPlan.findMany({
      where: {
        ...(opts.entityType ? { entityType: opts.entityType } : {}),
        ...(opts.includeRetired ? {} : { status: 'ACTIVE' }),
      },
      include: { versions: opts.market ? { where: { market: opts.market } } : true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map((p) => this.planView(p));
  }

  async getPlan(code: string) {
    const p = await this.prisma.commercialPlan.findUnique({
      where: { code },
      include: { versions: true },
    });
    if (!p) throw AppError.notFound();
    return this.planView(p);
  }

  async createPlan(actor: Actor, b: PlanInput, meta: RequestMeta) {
    if (await this.prisma.commercialPlan.findUnique({ where: { code: b.code } }))
      throw new AppError('VERSION_CONFLICT', 'A plan with this code already exists', 409);
    const p = await this.prisma.$transaction(async (tx) => {
      const row = await tx.commercialPlan.create({
        data: { ...b, createdByUserId: actor.userId },
        include: { versions: true },
      });
      await this.audit.record(
        {
          action: 'PLAN_CREATED',
          entityType: 'CommercialPlan',
          entityId: row.id,
          actor,
          newState: { code: b.code, entityType: b.entityType, kind: b.contractKind },
          meta,
        },
        tx,
      );
      return row;
    });
    return this.planView(p);
  }

  async updatePlan(
    actor: Actor,
    code: string,
    b: Partial<
      Pick<
        PlanInput,
        | 'nameEn'
        | 'nameAr'
        | 'descriptionEn'
        | 'descriptionAr'
        | 'sortOrder'
        | 'negotiated'
        | 'isFree'
      >
    > & { status?: 'ACTIVE' | 'RETIRED' },
    meta: RequestMeta,
  ) {
    const p = await this.prisma.commercialPlan.findUnique({ where: { code } });
    if (!p) throw AppError.notFound();
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.commercialPlan.update({
        where: { code },
        data: b,
        include: { versions: true },
      });
      await this.audit.record(
        {
          action: 'PLAN_UPDATED',
          entityType: 'CommercialPlan',
          entityId: p.id,
          actor,
          previousState: { status: p.status },
          newState: b,
          meta,
        },
        tx,
      );
      return r;
    });
    return this.planView(row);
  }

  // ---------------------------------------------------------------- versions
  /** Entitlement vocabulary is checked here so a typo can never become an unenforceable promise. */
  private validateDraft(d: DraftInput) {
    const bad = (m: string, f: string) => AppError.validation(m, f);
    for (const p of d.entitlements.products)
      if (!(SUBSCRIPTION_PRODUCTS as readonly string[]).includes(p))
        throw bad(`Unknown product "${p}"`, 'entitlements.products');
    for (const f of d.entitlements.features)
      if (!(SUBSCRIPTION_FEATURES as readonly string[]).includes(f))
        throw bad(`Unknown feature "${f}"`, 'entitlements.features');
    for (const l of d.entitlements.limits) {
      if (!(ALL_LIMIT_KEYS as readonly string[]).includes(l.key))
        throw bad(`Unknown limit "${l.key}"`, 'entitlements.limits');
      if (l.mode === 'SOFT' && l.softAction === 'OVERAGE_CHARGE' && l.overageRateMinor === null)
        throw bad('An overage charge needs a rate', 'entitlements.limits');
    }
    const seen = new Set<string>();
    for (const l of d.entitlements.limits) {
      if (seen.has(l.key)) throw bad(`Limit "${l.key}" is listed twice`, 'entitlements.limits');
      seen.add(l.key);
    }
    if (
      d.prices.length &&
      !d.prices.some((p) => p.cadence === d.defaultCadence) &&
      d.defaultCadence !== 'NONE'
    )
      throw bad('The default billing cadence needs a price', 'prices');
  }

  async createDraft(actor: Actor, planCode: string, d: DraftInput, meta: RequestMeta) {
    const plan = await this.prisma.commercialPlan.findUnique({ where: { code: planCode } });
    if (!plan) throw AppError.notFound();
    this.validateDraft(d);
    for (const code of d.addOnCodes)
      if (!(await this.prisma.addOnDefinition.findUnique({ where: { code } })))
        throw AppError.validation(`Unknown add-on "${code}"`, 'addOnCodes');
    const row = await this.prisma.$transaction(async (tx) => {
      const last = await tx.commercialPlanVersion.aggregate({
        _max: { version: true },
        where: { planId: plan.id, market: d.market },
      });
      const v = await tx.commercialPlanVersion.create({
        data: {
          planId: plan.id,
          market: d.market,
          currency: d.currency,
          version: (last._max.version ?? 0) + 1,
          defaultCadence: d.defaultCadence,
          prices: d.prices as Prisma.InputJsonValue,
          fees: d.fees as Prisma.InputJsonValue,
          addOnPrices: d.addOnPrices as Prisma.InputJsonValue,
          entitlements: d.entitlements as Prisma.InputJsonValue,
          addOnCodes: d.addOnCodes,
          supportLevel: d.supportLevel,
          trialDays: d.trialDays,
          graceDays: d.graceDays,
          enforcement: (d.enforcement ?? undefined) as Prisma.InputJsonValue | undefined,
          rules: d.rules as Prisma.InputJsonValue,
          referencePricing: d.referencePricing as Prisma.InputJsonValue,
          effectiveFrom: d.effectiveFrom ? new Date(d.effectiveFrom) : new Date(),
          createdByUserId: actor.userId,
        },
        include: { plan: true },
      });
      await this.audit.record(
        {
          action: 'PLAN_VERSION_DRAFTED',
          entityType: 'CommercialPlanVersion',
          entityId: v.id,
          actor,
          newState: { plan: planCode, market: d.market, version: v.version },
          meta,
        },
        tx,
      );
      return v;
    });
    return this.versionView(row);
  }

  async updateDraft(actor: Actor, versionId: string, d: DraftInput, meta: RequestMeta) {
    const v = await this.prisma.commercialPlanVersion.findUnique({
      where: { id: versionId },
      include: { plan: true },
    });
    if (!v) throw AppError.notFound();
    if (v.status !== 'DRAFT')
      throw new AppError(
        'INVALID_STATE',
        'A published version cannot be edited: create a new version',
        409,
      );
    this.validateDraft(d);
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.commercialPlanVersion.update({
        where: { id: versionId },
        data: {
          currency: d.currency,
          defaultCadence: d.defaultCadence,
          prices: d.prices as Prisma.InputJsonValue,
          fees: d.fees as Prisma.InputJsonValue,
          addOnPrices: d.addOnPrices as Prisma.InputJsonValue,
          entitlements: d.entitlements as Prisma.InputJsonValue,
          addOnCodes: d.addOnCodes,
          supportLevel: d.supportLevel,
          trialDays: d.trialDays,
          graceDays: d.graceDays,
          enforcement: (d.enforcement ?? Prisma.DbNull) as Prisma.InputJsonValue,
          rules: d.rules as Prisma.InputJsonValue,
          referencePricing: d.referencePricing as Prisma.InputJsonValue,
          ...(d.effectiveFrom ? { effectiveFrom: new Date(d.effectiveFrom) } : {}),
        },
        include: { plan: true },
      });
      await this.audit.record(
        {
          action: 'PLAN_VERSION_UPDATED',
          entityType: 'CommercialPlanVersion',
          entityId: versionId,
          actor,
          meta,
        },
        tx,
      );
      return r;
    });
    return this.versionView(row);
  }

  /** Publishing makes the version the one new agreements receive. A different person than the author publishes it. */
  async publish(actor: Actor, versionId: string, meta: RequestMeta, approvalRef?: string) {
    const v = await this.prisma.commercialPlanVersion.findUnique({
      where: { id: versionId },
      include: { plan: true },
    });
    if (!v) throw AppError.notFound();
    if (v.status !== 'DRAFT')
      throw new AppError('INVALID_STATE', 'This version is not a draft', 409);
    if (v.createdByUserId === actor.userId)
      throw new AppError(
        'APPROVAL_REQUIRED',
        'A different person must publish a plan version',
        403,
      );
    const row = await this.prisma.$transaction(async (tx) => {
      const from = v.effectiveFrom > new Date() ? v.effectiveFrom : new Date();
      // the version it replaces ends where this one starts (history is kept, never deleted)
      await tx.commercialPlanVersion.updateMany({
        where: {
          planId: v.planId,
          market: v.market,
          status: 'PUBLISHED',
          id: { not: v.id },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: from } }],
        },
        data: { effectiveUntil: from },
      });
      const r = await tx.commercialPlanVersion.update({
        where: { id: versionId },
        data: {
          status: 'PUBLISHED',
          effectiveFrom: from,
          publishedAt: new Date(),
          publishedByUserId: actor.userId,
        },
        include: { plan: true },
      });
      await this.audit.record(
        {
          action: 'PLAN_VERSION_PUBLISHED',
          entityType: 'CommercialPlanVersion',
          entityId: versionId,
          actor,
          approvalRef: approvalRef ?? null,
          newState: { plan: v.plan.code, market: v.market, version: v.version },
          meta,
        },
        tx,
      );
      return r;
    });
    return this.versionView(row);
  }

  async retire(actor: Actor, versionId: string, reason: string, meta: RequestMeta) {
    const v = await this.prisma.commercialPlanVersion.findUnique({
      where: { id: versionId },
      include: { plan: true },
    });
    if (!v) throw AppError.notFound();
    if (v.status !== 'PUBLISHED')
      throw new AppError('INVALID_STATE', 'Only a published version can be retired', 409);
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.commercialPlanVersion.update({
        where: { id: versionId },
        data: { status: 'RETIRED', effectiveUntil: v.effectiveUntil ?? new Date() },
        include: { plan: true },
      });
      await this.audit.record(
        {
          action: 'PLAN_VERSION_RETIRED',
          entityType: 'CommercialPlanVersion',
          entityId: versionId,
          actor,
          reason,
          meta,
        },
        tx,
      );
      return r;
    });
    return this.versionView(row);
  }

  /** The published version of a plan for a market at a moment (what a new agreement receives). */
  async resolveVersion(
    planCode: string,
    market: string | null | undefined,
    at = new Date(),
  ): Promise<PlanVersionRow> {
    const plan = await this.prisma.commercialPlan.findUnique({ where: { code: planCode } });
    if (!plan || plan.status !== 'ACTIVE')
      throw new AppError('PLAN_NOT_AVAILABLE', `The plan ${planCode} is not available`, 404);
    const v = await this.prisma.commercialPlanVersion.findFirst({
      where: {
        planId: plan.id,
        ...(market ? { market } : {}),
        status: 'PUBLISHED',
        effectiveFrom: { lte: at },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
      },
      orderBy: { version: 'desc' },
      include: { plan: true },
    });
    if (!v)
      throw new AppError(
        'PLAN_NOT_AVAILABLE',
        `The plan ${planCode} has no published version${market ? ` for ${market}` : ''}`,
        404,
      );
    return v;
  }

  async getVersion(id: string) {
    const v = await this.prisma.commercialPlanVersion.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!v) throw AppError.notFound();
    return v;
  }

  // ---------------------------------------------------------------- price book
  async listItems(market?: string) {
    const items = await this.prisma.priceItem.findMany({
      include: { versions: market ? { where: { market } } : true },
      orderBy: { code: 'asc' },
    });
    return items.map((i) => ({
      id: i.id,
      code: i.code,
      nameEn: i.nameEn,
      nameAr: i.nameAr,
      category: i.category,
      unit: i.unit,
      product: i.product,
      status: i.status,
      versions: i.versions
        .sort((a, b) => a.market.localeCompare(b.market) || b.version - a.version)
        .map((v) => ({
          id: v.id,
          market: v.market,
          currency: v.currency,
          version: v.version,
          status: v.status,
          model: v.model,
          amountMinor: v.amountMinor,
          rateBps: v.rateBps,
          indicative: v.indicative,
          rangeMin: v.rangeMin,
          rangeMax: v.rangeMax,
          effectiveFrom: v.effectiveFrom.toISOString(),
          effectiveUntil: v.effectiveUntil?.toISOString() ?? null,
          reference: v.reference,
        })),
    }));
  }

  async createItem(actor: Actor, b: ItemInput, meta: RequestMeta) {
    if (await this.prisma.priceItem.findUnique({ where: { code: b.code } }))
      throw new AppError('VERSION_CONFLICT', 'A price item with this code already exists', 409);
    const i = await this.prisma.$transaction(async (tx) => {
      const row = await tx.priceItem.create({ data: b });
      await this.audit.record(
        {
          action: 'PRICE_ITEM_CREATED',
          entityType: 'PriceItem',
          entityId: row.id,
          actor,
          newState: { code: b.code, category: b.category },
          meta,
        },
        tx,
      );
      return row;
    });
    return { id: i.id, code: i.code };
  }

  async createItemVersion(actor: Actor, itemCode: string, b: ItemVersionInput, meta: RequestMeta) {
    const item = await this.prisma.priceItem.findUnique({ where: { code: itemCode } });
    if (!item) throw AppError.notFound();
    const v = await this.prisma.$transaction(async (tx) => {
      const last = await tx.priceItemVersion.aggregate({
        _max: { version: true },
        where: { itemId: item.id, market: b.market },
      });
      const row = await tx.priceItemVersion.create({
        data: {
          itemId: item.id,
          market: b.market,
          currency: b.currency,
          version: (last._max.version ?? 0) + 1,
          model: b.model,
          amountMinor: b.amountMinor,
          rateBps: b.rateBps,
          tiers: (b.tiers ?? undefined) as Prisma.InputJsonValue | undefined,
          minAmountMinor: b.minAmountMinor,
          maxAmountMinor: b.maxAmountMinor,
          indicative: b.indicative,
          rangeMin: b.rangeMin,
          rangeMax: b.rangeMax,
          effectiveFrom: b.effectiveFrom ? new Date(b.effectiveFrom) : new Date(),
          reference: b.reference,
          status: 'DRAFT',
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'PRICE_VERSION_DRAFTED',
          entityType: 'PriceItemVersion',
          entityId: row.id,
          actor,
          newState: { item: itemCode, market: b.market, version: row.version },
          meta,
        },
        tx,
      );
      return row;
    });
    return { id: v.id, version: v.version, status: v.status };
  }

  async publishItemVersion(actor: Actor, versionId: string, meta: RequestMeta) {
    const v = await this.prisma.priceItemVersion.findUnique({
      where: { id: versionId },
      include: { item: true },
    });
    if (!v) throw AppError.notFound();
    if (v.status !== 'DRAFT')
      throw new AppError('INVALID_STATE', 'This version is not a draft', 409);
    if (v.createdByUserId === actor.userId)
      throw new AppError(
        'APPROVAL_REQUIRED',
        'A different person must publish a price version',
        403,
      );
    await this.prisma.$transaction(async (tx) => {
      const from = v.effectiveFrom > new Date() ? v.effectiveFrom : new Date();
      await tx.priceItemVersion.updateMany({
        where: {
          itemId: v.itemId,
          market: v.market,
          status: 'PUBLISHED',
          id: { not: v.id },
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: from } }],
        },
        data: { effectiveUntil: from },
      });
      await tx.priceItemVersion.update({
        where: { id: versionId },
        data: { status: 'PUBLISHED', effectiveFrom: from },
      });
      await this.audit.record(
        {
          action: 'PRICE_VERSION_PUBLISHED',
          entityType: 'PriceItemVersion',
          entityId: versionId,
          actor,
          newState: { item: v.item.code, market: v.market, version: v.version },
          meta,
        },
        tx,
      );
    });
    return { id: versionId, status: 'PUBLISHED' as const };
  }

  // ---------------------------------------------------------------- add-on catalog
  async listAddOns() {
    return this.prisma.addOnDefinition.findMany({ orderBy: { code: 'asc' } });
  }

  async createAddOn(actor: Actor, b: AddOnInput, meta: RequestMeta) {
    if (await this.prisma.addOnDefinition.findUnique({ where: { code: b.code } }))
      throw new AppError('VERSION_CONFLICT', 'An add-on with this code already exists', 409);
    for (const e of b.effect) {
      const ok =
        e.kind === 'PRODUCT'
          ? (SUBSCRIPTION_PRODUCTS as readonly string[]).includes(e.key)
          : e.kind === 'FEATURE'
            ? (SUBSCRIPTION_FEATURES as readonly string[]).includes(e.key)
            : (ALL_LIMIT_KEYS as readonly string[]).includes(e.key);
      if (!ok) throw AppError.validation(`Unknown ${e.kind.toLowerCase()} "${e.key}"`, 'effect');
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.addOnDefinition.create({
        data: { ...b, effect: b.effect as Prisma.InputJsonValue },
      });
      await this.audit.record(
        {
          action: 'ADDON_DEFINED',
          entityType: 'AddOnDefinition',
          entityId: r.id,
          actor,
          newState: { code: b.code },
          meta,
        },
        tx,
      );
      return r;
    });
    return row;
  }
}
