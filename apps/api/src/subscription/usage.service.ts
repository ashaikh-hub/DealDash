import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { METRIC_OF_LIMIT, PERIOD_LIMITS, RESOURCE_LIMITS } from '@dealdash/types';
import { AppError } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import { EntitlementService } from '../platform/entitlement.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { BillingEventService } from './billing-event.service';
import { periodBounds } from './policy';

export interface UsageLine {
  limitKey: string;
  metricKey: string;
  kind: 'RESOURCE' | 'PERIOD';
  used: number;
  limit: number | null;
  remaining: number | null;
  percent: number | null;
  mode: string;
  period: string;
  source: string;
  warnPercents: number[];
}

/**
 * Usage measurement. THREE different things, never mixed:
 *   A. current RESOURCE COUNTS   (branches 4 of 5): read live from the source of truth, so they can never drift;
 *   B. PERIOD USAGE              (API calls 70,000 of 100,000 this month): a meter advanced by a conditional update;
 *   C. BILLABLE BUSINESS EVENTS  (a qualified view, a verified redemption): recorded once, with an idempotency key.
 * Entitlement says what is allowed; this service says how much has been used and enforces HARD / SOFT limits at the moment of use.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly entitlements: EntitlementService,
    private readonly billing: BillingEventService,
  ) {}

  // ---------------------------------------------------------------- A. resource counts
  async currentCount(
    organizationId: string,
    limitKey: string,
    opts: { legalEntityId?: string | null } = {},
  ): Promise<number> {
    const le = opts.legalEntityId ?? null;
    switch (limitKey) {
      case 'branches.max': {
        if (!le)
          return this.prisma.merchantBranch.count({ where: { organizationId, status: 'ACTIVE' } });
        return this.branchesOfLegalEntity(organizationId, le);
      }
      case 'users.max': {
        const cfg =
          (await this.config.get<{
            users?: { includePendingInvitations?: boolean; excludeRoles?: string[] };
          }>(CONFIG_KEYS.COMMERCIAL_METRICS)) ?? {};
        const exclude = cfg.users?.excludeRoles ?? [];
        const members = await this.prisma.organizationMembership.count({
          where: {
            organizationId,
            status: 'ACTIVE',
            ...(exclude.length ? { role: { code: { notIn: exclude } } } : {}),
          },
        });
        const pending =
          cfg.users?.includePendingInvitations === false
            ? 0
            : await this.prisma.invitation.count({
                where: { organizationId, status: 'PENDING', expiresAt: { gt: new Date() } },
              });
        return members + pending;
      }
      case 'campaigns.max_active':
        return this.prisma.commercialCase.count({
          where: {
            ownerOrganizationId: organizationId,
            status: { notIn: ['CLOSED', 'RECONCILED'] },
            acceptedQuotationId: { not: null },
          },
        });
      case 'legal_entities.max':
        return this.prisma.legalEntity.count({ where: { organizationId, status: 'ACTIVE' } });
      case 'brands.max':
        return this.prisma.organizationUnit.count({
          where: { organizationId, kind: 'BRAND', status: 'ACTIVE' },
        });
      case 'markets.max': {
        const rows = await this.prisma.legalEntity.findMany({
          where: { organizationId, status: 'ACTIVE' },
          select: { country: true },
          distinct: ['country'],
        });
        return rows.length;
      }
      default:
        throw AppError.validation(`"${limitKey}" is not a resource limit`, 'limitKey');
    }
  }

  /** Active branches that belong to a legal entity (through the organization-unit tree; a unit inherits the nearest ancestor's entity). */
  private async branchesOfLegalEntity(
    organizationId: string,
    legalEntityId: string,
  ): Promise<number> {
    const units = await this.prisma.organizationUnit.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { id: true, parentId: true, legalEntityId: true, branchId: true },
    });
    const byId = new Map(units.map((u) => [u.id, u]));
    const eff = (u: (typeof units)[number]): string | null => {
      for (
        let cur: (typeof units)[number] | undefined = u, guard = 0;
        cur && guard < 64;
        guard++, cur = cur.parentId ? byId.get(cur.parentId) : undefined
      )
        if (cur.legalEntityId) return cur.legalEntityId;
      return null;
    };
    const ids = units.filter((u) => u.branchId && eff(u) === legalEntityId).map((u) => u.branchId!);
    if (!ids.length) return 0;
    return this.prisma.merchantBranch.count({
      where: { id: { in: ids }, organizationId, status: 'ACTIVE' },
    });
  }

  /** Refuses (HARD) or warns (SOFT) before one more resource is created. `delta` > 1 for bulk creation. */
  async assertResourceWithin(
    organizationId: string,
    limitKey: string,
    opts: { legalEntityId?: string | null; delta?: number } = {},
  ) {
    const current = await this.currentCount(organizationId, limitKey, opts);
    return this.entitlements.requireWithinLimit(
      organizationId,
      limitKey,
      current + (opts.delta ?? 1) - 1,
      { legalEntityId: opts.legalEntityId },
    );
  }

  // ---------------------------------------------------------------- B. period meters (and C. the usage fact)
  /**
   * Records `quantity` of a period metric exactly once per idempotency key and enforces the limit atomically: a HARD limit is a
   * conditional UPDATE, so concurrent requests can never exceed it. A SOFT limit lets the use continue and, when the contract says
   * OVERAGE_CHARGE, emits an overage billing event for the portion above the limit.
   */
  async consume(input: {
    organizationId: string;
    limitKey: string;
    quantity?: number;
    idempotencyKey: string;
    legalEntityId?: string | null;
    sourceType: string;
    sourceId: string;
    product?: string | null;
    feature?: string | null;
    campaignId?: string | null;
    at?: Date;
  }): Promise<{ recorded: boolean; value: number; limit: number | null; overage: number }> {
    const at = input.at ?? new Date();
    const qty = input.quantity ?? 1;
    const e = await this.entitlements.effective(input.organizationId, at, {
      legalEntityId: input.legalEntityId,
    });
    const d = e.limitDetails[input.limitKey];
    const metricKey = METRIC_OF_LIMIT[input.limitKey] ?? input.limitKey;
    const contract = e.contractId
      ? await this.prisma.contract.findUnique({ where: { id: e.contractId } })
      : null;
    const period = d && d.period !== 'NONE' ? d.period : 'MONTH';
    const bounds = periodBounds(
      period,
      at,
      contract ? { from: contract.effectiveFrom, until: contract.effectiveUntil } : undefined,
    );
    const leKey = input.legalEntityId ?? '';
    const limit = d?.value ?? null;
    let result: { recorded: boolean; value: number; overage: number };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const exists = await tx.usageEvent.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: { id: true },
        });
        if (exists) {
          const m = await tx.usageMeter.findUnique({
            where: {
              organizationId_legalEntityKey_metricKey_periodStart: {
                organizationId: input.organizationId,
                legalEntityKey: leKey,
                metricKey,
                periodStart: bounds.start,
              },
            },
          });
          return { recorded: false, value: m?.value ?? 0, overage: 0 };
        }
        await tx.usageEvent.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            organizationId: input.organizationId,
            legalEntityId: input.legalEntityId ?? null,
            contractId: e.contractId,
            metricKey,
            quantity: qty,
            product: input.product ?? null,
            feature: input.feature ?? null,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            campaignId: input.campaignId ?? null,
            occurredAt: at,
            market: contract?.market ?? null,
          },
        });
        await tx.$executeRaw`INSERT INTO "UsageMeter" ("id", "organizationId", "legalEntityKey", "metricKey", "periodStart", "periodEnd", "value", "updatedAt")
          VALUES (gen_random_uuid(), ${input.organizationId}::uuid, ${leKey}, ${metricKey}, ${bounds.start}, ${bounds.end}, 0, now())
          ON CONFLICT ("organizationId", "legalEntityKey", "metricKey", "periodStart") DO NOTHING`;
        const hard =
          d && limit !== null && (d.mode === 'HARD' || d.softAction === 'REQUIRE_APPROVAL');
        const rows = hard
          ? await tx.$queryRaw<
              Array<{ value: number }>
            >`UPDATE "UsageMeter" SET "value" = "value" + ${qty}, "updatedAt" = now()
              WHERE "organizationId" = ${input.organizationId}::uuid AND "legalEntityKey" = ${leKey} AND "metricKey" = ${metricKey}
                AND "periodStart" = ${bounds.start} AND "value" + ${qty} <= ${limit}
              RETURNING "value"`
          : await tx.$queryRaw<
              Array<{ value: number }>
            >`UPDATE "UsageMeter" SET "value" = "value" + ${qty}, "updatedAt" = now()
              WHERE "organizationId" = ${input.organizationId}::uuid AND "legalEntityKey" = ${leKey} AND "metricKey" = ${metricKey}
                AND "periodStart" = ${bounds.start}
              RETURNING "value"`;
        if (!rows.length)
          throw new AppError(
            'ENTITLEMENT_LIMIT_REACHED',
            `Your contract allows at most ${limit} (${input.limitKey}) per period`,
            403,
          );
        const value = rows[0]!.value;
        let overage = 0;
        if (d && limit !== null && value > limit) {
          overage = Math.min(qty, value - limit);
          if (d.softAction === 'OVERAGE_CHARGE' && d.overageRateMinor !== null && overage > 0)
            await this.billing.emit(
              {
                idempotencyKey: `overage:${input.idempotencyKey}`,
                organizationId: input.organizationId,
                eventType: 'OVERAGE_USAGE',
                contractId: e.contractId,
                legalEntityId: input.legalEntityId ?? null,
                feature: input.feature ?? null,
                product: input.product ?? null,
                sourceEventId: input.sourceId,
                pricingVersionKey: `LIM:${e.contractId}:${input.limitKey}`,
                quantity: overage,
                unit: 'EACH',
                unitRateMinor: d.overageRateMinor,
                amountMinor: overage * d.overageRateMinor,
                occurredAt: at,
                metadata: {
                  limitKey: input.limitKey,
                  limit,
                  periodStart: bounds.start.toISOString(),
                },
              },
              tx,
            );
        }
        return { recorded: true, value, overage };
      });
    } catch (err) {
      if (d && limit !== null && err instanceof AppError)
        await this.entitlements.raiseLimitSignals(
          input.organizationId,
          input.limitKey,
          d,
          limit,
          e.contractId,
          input.legalEntityId ?? null,
        );
      throw err;
    }
    if (d && limit !== null && result.recorded)
      await this.entitlements.raiseLimitSignals(
        input.organizationId,
        input.limitKey,
        d,
        result.value,
        e.contractId,
        input.legalEntityId ?? null,
      );
    return { ...result, limit };
  }

  /** What a period meter reads right now (0 when nothing was recorded in the period). */
  async periodValue(
    organizationId: string,
    limitKey: string,
    opts: { legalEntityId?: string | null; at?: Date } = {},
  ): Promise<number> {
    const at = opts.at ?? new Date();
    const e = await this.entitlements.effective(organizationId, at, {
      legalEntityId: opts.legalEntityId,
    });
    const d = e.limitDetails[limitKey];
    const contract = e.contractId
      ? await this.prisma.contract.findUnique({ where: { id: e.contractId } })
      : null;
    const b = periodBounds(
      d && d.period !== 'NONE' ? d.period : 'MONTH',
      at,
      contract ? { from: contract.effectiveFrom, until: contract.effectiveUntil } : undefined,
    );
    const m = await this.prisma.usageMeter.findUnique({
      where: {
        organizationId_legalEntityKey_metricKey_periodStart: {
          organizationId,
          legalEntityKey: opts.legalEntityId ?? '',
          metricKey: METRIC_OF_LIMIT[limitKey] ?? limitKey,
          periodStart: b.start,
        },
      },
    });
    return m?.value ?? 0;
  }

  // ---------------------------------------------------------------- C. billable business events
  /**
   * A billable fact (a qualified view, a verified redemption, a voucher transaction): the usage fact AND the billing hook, both
   * idempotent on the same source event. Safe to call inside the product's own transaction.
   */
  async recordBillable(
    input: {
      organizationId: string;
      metric: 'qualified_views' | 'verified_redemptions' | 'voucher_transactions';
      eventType:
        'QUALIFIED_VIEW_USAGE' | 'VERIFIED_REDEMPTION_USAGE' | 'VOUCHER_TRANSACTION_COMMISSION';
      sourceType: string;
      sourceId: string;
      product: string;
      campaignId?: string | null;
      quantity?: number;
      unitRateMinor?: number | null;
      amountMinor?: number | null;
      currency?: string;
      pricingVersionKey?: string | null;
      occurredAt?: Date;
      metadata?: Record<string, unknown>;
    },
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const key = `usage:${input.metric}:${input.sourceType}:${input.sourceId}`;
    const at = input.occurredAt ?? new Date();
    await db.usageEvent
      .create({
        data: {
          idempotencyKey: key,
          organizationId: input.organizationId,
          metricKey: input.metric,
          quantity: input.quantity ?? 1,
          product: input.product,
          campaignId: input.campaignId ?? null,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          pricingVersionKey: input.pricingVersionKey ?? null,
          occurredAt: at,
        },
      })
      .catch((e: { code?: string }) => {
        if (e.code !== 'P2002') throw e;
      });
    return this.billing.emit(
      {
        idempotencyKey: `bill:${input.eventType}:${input.sourceType}:${input.sourceId}`,
        organizationId: input.organizationId,
        eventType: input.eventType,
        product: input.product,
        campaignId: input.campaignId ?? null,
        sourceEventId: input.sourceId,
        pricingVersionKey: input.pricingVersionKey ?? null,
        quantity: input.quantity ?? 1,
        unit:
          input.eventType === 'QUALIFIED_VIEW_USAGE'
            ? 'PER_VIEW'
            : input.eventType === 'VERIFIED_REDEMPTION_USAGE'
              ? 'PER_REDEMPTION'
              : 'PERCENT',
        unitRateMinor: input.unitRateMinor ?? null,
        amountMinor: input.amountMinor ?? null,
        currency: input.currency,
        occurredAt: at,
        metadata: input.metadata,
      },
      db,
    );
  }

  /** A reversed source event voids its still-pending billing event (the usage fact stays as history). */
  async voidBillable(
    eventType:
      'QUALIFIED_VIEW_USAGE' | 'VERIFIED_REDEMPTION_USAGE' | 'VOUCHER_TRANSACTION_COMMISSION',
    sourceId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    return this.billing.voidBySource(eventType, sourceId, db);
  }

  private readonly pricingKeys = new Map<string, { key: string | null; at: number }>();

  /** The campaign pricing version (PAV:<agreement version>) accepted for a campaign, cached briefly (it is read on hot paths). */
  async campaignPricingKey(
    product: 'VOUCHER' | 'WATCH' | 'EXCLUSIVE' | 'LIVE_BENEFIT' | 'LOYALTY',
    campaignId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<string | null> {
    const k = `${product}:${campaignId}`;
    const hit = this.pricingKeys.get(k);
    if (hit && Date.now() - hit.at < 300_000) return hit.key;
    const c = await db.commercialCase.findUnique({
      where: { product_subjectId: { product, subjectId: campaignId } },
      select: { acceptedQuotationId: true },
    });
    const q = c?.acceptedQuotationId
      ? await db.quotation.findUnique({
          where: { id: c.acceptedQuotationId },
          select: { pricingVersionId: true },
        })
      : null;
    const key = q?.pricingVersionId ? `PAV:${q.pricingVersionId}` : null;
    if (key) this.pricingKeys.set(k, { key, at: Date.now() });
    return key;
  }

  // ---------------------------------------------------------------- the picture for screens, support and the AI layer
  async usageView(
    organizationId: string,
    opts: { legalEntityId?: string | null; at?: Date } = {},
  ): Promise<UsageLine[]> {
    const e = await this.entitlements.effective(organizationId, opts.at ?? new Date(), {
      legalEntityId: opts.legalEntityId,
    });
    const lines: UsageLine[] = [];
    for (const [key, d] of Object.entries(e.limitDetails)) {
      const resource = (RESOURCE_LIMITS as readonly string[]).includes(key);
      const period = (PERIOD_LIMITS as readonly string[]).includes(key);
      if (!resource && !period) continue;
      const used = resource
        ? await this.currentCount(organizationId, key, { legalEntityId: opts.legalEntityId })
        : await this.periodValue(organizationId, key, opts);
      const limit = d.value;
      lines.push({
        limitKey: key,
        metricKey: METRIC_OF_LIMIT[key] ?? key,
        kind: resource ? 'RESOURCE' : 'PERIOD',
        used,
        limit,
        remaining: limit === null ? null : Math.max(0, limit - used),
        percent: limit === null || limit === 0 ? null : Math.round((used / limit) * 100),
        mode: d.mode,
        period: d.period,
        source: d.source,
        warnPercents: d.warnPercents,
      });
    }
    return lines.sort((a, b) => a.limitKey.localeCompare(b.limitKey));
  }
}
