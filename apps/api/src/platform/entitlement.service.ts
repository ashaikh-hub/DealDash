import { Inject, Injectable, Optional } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  IN_FORCE_LIFECYCLE,
  MARKET_PRODUCTS,
  METRIC_OF_LIMIT,
  type FinancialStatus,
} from '@dealdash/types';
import { AppError } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FINANCIAL_STATUS_PROVIDER,
  deriveFinancialStatus,
  resolvePolicy,
  type EnforcementPolicy,
  type FinancialStatusProvider,
  type FinancialStatusView,
} from '../subscription/policy';
import { SystemConfigService } from '../system-config/system-config.service';
import { MarketService } from './markets/market.service';
import type { EntitlementView } from '@dealdash/validation';

interface DefaultPlan {
  products: string[];
  features: string[];
  limits: Record<string, number>;
}

/** Whether a row is in force at a moment. Configuration is never overwritten: history is kept and the date range decides. */
export const effectiveAt = (r: { effectiveFrom: Date; effectiveUntil: Date | null }, at: Date) =>
  r.effectiveFrom <= at && (r.effectiveUntil === null || r.effectiveUntil > at);

export interface LimitDetail {
  /** null = unlimited by this contract */
  value: number | null;
  mode: 'HARD' | 'SOFT';
  period: string;
  warnPercents: number[];
  softAction: string;
  overageRateMinor: number | null;
  /** Where the effective value comes from, so "why is this the limit" is answerable from data. */
  source: 'PLAN' | 'CONTRACT' | 'OVERRIDE';
  base: number | null;
  override: number | null;
  addOns: number;
  contractId: string;
}

export interface EntitlementDetail extends EntitlementView {
  lifecycle: string | null;
  kind: string | null;
  planCode: string | null;
  limitDetails: Record<string, LimitDetail>;
  /** product / feature -> where it comes from */
  provenance: Record<string, { source: string; enabled: boolean }>;
  contracts: Array<{
    id: string;
    kind: string;
    planCode: string | null;
    lifecycle: string;
    legalEntityId: string | null;
  }>;
}

type Row = Prisma.ContractEntitlementGetPayload<object>;

/**
 * Organization -> (Legal Entity) -> Contract -> product, feature and limit entitlements. An organization with an in-force contract gets
 * EXACTLY what the contract says: the plan default, replaced by any contract OVERRIDE, plus ADD-ONs. An organization with no contract at
 * all falls back to the configured default plan for its type, so existing merchants keep working while a partner gets nothing until a
 * contract says otherwise. The backend enforces it; the UI only reflects it.
 *
 * Entitlement says WHAT IS ALLOWED. Usage meters (UsageService) say how much has been used. The commercial lifecycle and financial
 * state decide whether NEW exposure is allowed; issued customer rights are never decided here.
 */
@Injectable()
export class EntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    @Optional()
    @Inject(FINANCIAL_STATUS_PROVIDER)
    private readonly financial?: FinancialStatusProvider,
    @Optional() private readonly markets?: MarketService,
  ) {}

  // ---------------------------------------------------------------- resolution
  async effective(
    organizationId: string,
    at = new Date(),
    opts: { legalEntityId?: string | null } = {},
  ): Promise<EntitlementDetail> {
    const all = await this.prisma.contract.findMany({
      where: {
        organizationId,
        status: { in: [...IN_FORCE_LIFECYCLE] },
        effectiveFrom: { lte: at },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
      },
      include: { entitlements: true, coverage: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    // a contract applies to a legal entity when it names it (contracting or covered) or is a Business Account level contract
    const le = opts.legalEntityId ?? null;
    const contracts = le
      ? all.filter(
          (c) =>
            c.legalEntityId === le ||
            c.coverage.some((x) => x.legalEntityId === le) ||
            (c.legalEntityId === null && c.coverage.length === 0),
        )
      : all;
    if (contracts.length) {
      const products = new Set<string>();
      const features = new Set<string>();
      const limitDetails: Record<string, LimitDetail> = {};
      const provenance: EntitlementDetail['provenance'] = {};
      for (const c of contracts) {
        const rows = c.entitlements.filter((e) => effectiveAt(e, at));
        const groups = new Map<string, Row[]>();
        for (const r of rows)
          groups.set(`${r.kind}:${r.key}`, [...(groups.get(`${r.kind}:${r.key}`) ?? []), r]);
        for (const [k, g] of groups) {
          const [kind, key] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
          const newest = (xs: Row[]) =>
            [...xs].sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
          const planRow = newest(g.filter((r) => r.source === 'PLAN' || r.source === 'CONTRACT'));
          const overrideRow = newest(g.filter((r) => r.source === 'OVERRIDE'));
          const addOns = g.filter((r) => r.source === 'ADDON');
          const base = overrideRow ?? planRow;
          if (kind === 'LIMIT') {
            if (!base) continue;
            const extra = addOns.reduce((n, r) => n + (r.limitValue ?? 0), 0);
            const value = base.limitValue === null ? null : base.limitValue + extra;
            const cand: LimitDetail = {
              value,
              mode: base.mode as 'HARD' | 'SOFT',
              period: base.period,
              warnPercents: base.warnPercents,
              softAction: base.softAction,
              overageRateMinor: base.overageRateMinor,
              source: overrideRow ? 'OVERRIDE' : planRow?.source === 'PLAN' ? 'PLAN' : 'CONTRACT',
              base: planRow?.limitValue ?? null,
              override: overrideRow?.limitValue ?? null,
              addOns: extra,
              contractId: c.id,
            };
            const prev = limitDetails[key];
            // several contracts of the same organization: the most generous one applies (unlimited beats any number)
            if (
              !prev || prev.value === null ? !prev : cand.value === null || cand.value > prev.value
            )
              limitDetails[key] = cand;
          } else {
            const enabled = (base?.enabled ?? false) || addOns.some((r) => r.enabled);
            if (!enabled) continue;
            (kind === 'PRODUCT' ? products : features).add(key);
            provenance[`${kind}:${key}`] = {
              source:
                addOns.some((r) => r.enabled) && !base?.enabled
                  ? 'ADDON'
                  : overrideRow
                    ? 'OVERRIDE'
                    : (base?.source ?? 'CONTRACT'),
              enabled: true,
            };
          }
        }
      }
      const limits: Record<string, number> = {};
      for (const [key, d] of Object.entries(limitDetails))
        if (d.value !== null) limits[key] = d.value;
      const primary = contracts[0]!;
      return {
        source: 'CONTRACT',
        contractId: primary.id,
        products: [...products],
        features: [...features],
        limits,
        limitDetails,
        provenance,
        lifecycle: primary.status,
        kind: primary.kind,
        planCode: primary.planCode,
        contracts: contracts.map((c) => ({
          id: c.id,
          kind: c.kind,
          planCode: c.planCode,
          lifecycle: c.status,
          legalEntityId: c.legalEntityId,
        })),
      };
    }
    // an organization whose agreement ENDED (cancelled or expired) does not fall back to the default plan: it has no entitlements to take on new
    // exposure, while everything already issued to customers and all history stay untouched (nothing here deletes or hides data)
    const ended = await this.prisma.contract.findFirst({
      where: { organizationId, status: { in: ['CANCELLED', 'EXPIRED'] } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (ended)
      return {
        source: 'CONTRACT',
        contractId: null,
        products: [],
        features: [],
        limits: {},
        limitDetails: {},
        provenance: {},
        lifecycle: ended.status,
        kind: ended.kind,
        planCode: ended.planCode,
        contracts: [],
      };
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    });
    const plans = await this.config.get<Record<string, DefaultPlan>>(
      CONFIG_KEYS.PLATFORM_DEFAULT_ENTITLEMENTS,
    );
    const plan = plans[org?.type ?? 'MERCHANT'] ?? { products: [], features: [], limits: {} };
    const limitDetails: Record<string, LimitDetail> = {};
    for (const [key, value] of Object.entries(plan.limits))
      limitDetails[key] = {
        value,
        mode: 'HARD',
        period: 'NONE',
        warnPercents: [80, 100],
        softAction: 'WARN',
        overageRateMinor: null,
        source: 'CONTRACT',
        base: value,
        override: null,
        addOns: 0,
        contractId: '',
      };
    return {
      source: 'DEFAULT_PLAN',
      contractId: null,
      products: plan.products,
      features: plan.features,
      limits: plan.limits,
      limitDetails,
      provenance: {},
      lifecycle: null,
      kind: null,
      planCode: null,
      contracts: [],
    };
  }

  // ---------------------------------------------------------------- financial state and policy
  async financialStatus(organizationId: string, at = new Date()): Promise<FinancialStatusView> {
    return this.financial
      ? this.financial.statusFor(organizationId, { at })
      : deriveFinancialStatus(this.prisma, organizationId, at);
  }

  async policyFor(organizationId: string, at = new Date()): Promise<EnforcementPolicy> {
    const c = await this.prisma.contract.findFirst({
      where: {
        organizationId,
        status: { in: [...IN_FORCE_LIFECYCLE] },
        effectiveFrom: { lte: at },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      include: { planVersion: true },
    });
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { type: true },
    });
    return resolvePolicy(this.config, c, c?.planVersion ?? null, org?.type ?? null);
  }

  /**
   * NEW exposure (a new paid campaign, a new branch, a new user, a premium feature, an API operation) is refused when the contract is
   * suspended, past its grace, ended or cancelled, or the account is on a financial hold. Redemption, refund, invoice and history access
   * are never routed through here: customer rights and the merchant's access to its own money and records are not "new exposure".
   */
  async requireNewExposure(organizationId: string, action: string, at = new Date()): Promise<void> {
    const reason = await this.newExposureBlock(organizationId, action, at);
    if (reason) throw new AppError(reason.code, reason.message, 403);
  }

  /** The reason an action is refused, or null. Used by `requireNewExposure` and by the explain endpoint. */
  async newExposureBlock(
    organizationId: string,
    action: string,
    at = new Date(),
  ): Promise<{
    code: 'COMMERCIAL_SUSPENDED' | 'FINANCIAL_HOLD' | 'CONTRACT_ENDED';
    message: string;
  } | null> {
    const policy = await this.policyFor(organizationId, at);
    const fin = await this.financialStatus(organizationId, at);
    const status: FinancialStatus = fin.status;
    if (status === 'SUSPENDED' && policy.blockedWhenSuspended.includes(action))
      return {
        code: 'COMMERCIAL_SUSPENDED',
        message:
          'Your subscription is suspended: new paid activity is blocked until it is reinstated',
      };
    if (
      status === 'PAST_DUE' &&
      policy.treatElapsedGraceAsSuspended &&
      policy.blockedWhenSuspended.includes(action)
    )
      return {
        code: 'COMMERCIAL_SUSPENDED',
        message: 'The payment grace period has ended: new paid activity is blocked',
      };
    if (status === 'FINANCIAL_HOLD' && policy.blockedOnFinancialHold.includes(action))
      return {
        code: 'FINANCIAL_HOLD',
        message: 'A financial hold is in place. Contact DealDash Finance',
      };
    // an organization whose agreement ended (cancelled or expired) cannot take on new exposure
    const e = await this.effective(organizationId, at);
    if (
      (e.lifecycle === 'CANCELLED' || e.lifecycle === 'EXPIRED') &&
      policy.blockedWhenEnded.includes(action)
    )
      return {
        code: 'CONTRACT_ENDED',
        message: 'Your contract has ended: new paid activity is not available',
      };
    return null;
  }

  /**
   * A suspended agreement keeps its live, prepaid campaigns running by default (customers and prepaid commitments are protected). A contract or
   * plan can choose STOP_NEW_EXPOSURE: no NEW reservations, purchases or views start. Credentials already issued always keep working;
   * redemption, refund and reward paths never call this. The customer only ever sees a generic 'unavailable'.
   */
  async assertLiveCampaignOpen(organizationId: string, at = new Date()): Promise<void> {
    const policy = await this.policyFor(organizationId, at);
    if (policy.liveCampaignsWhenSuspended === 'CONTINUE') return;
    const fin = await this.financialStatus(organizationId, at);
    if (
      fin.status === 'SUSPENDED' ||
      (fin.status === 'PAST_DUE' && policy.treatElapsedGraceAsSuspended)
    )
      throw new AppError('OFFER_UNAVAILABLE', 'This offer is not available right now', 409);
  }

  // ---------------------------------------------------------------- the simple checks used across the product
  /**
   * The contract must include the product AND the product must be open in the market where it is used (market product availability):
   * being live in one country says nothing about another.
   */
  async requireProduct(
    organizationId: string,
    product: string,
    opts: { legalEntityId?: string | null; market?: string | null } = {},
  ): Promise<void> {
    const e = await this.effective(organizationId, new Date(), {
      legalEntityId: opts.legalEntityId,
    });
    if (!e.products.includes(product))
      throw new AppError('ENTITLEMENT_REQUIRED', `Your contract does not include ${product}`, 403);
    if (this.markets && (MARKET_PRODUCTS as readonly string[]).includes(product))
      await this.markets.requireAvailable(organizationId, product, opts);
  }

  async requireFeature(
    organizationId: string,
    feature: string,
    opts: { legalEntityId?: string | null } = {},
  ): Promise<void> {
    const e = await this.effective(organizationId, new Date(), opts);
    if (!e.features.includes(feature))
      throw new AppError('ENTITLEMENT_REQUIRED', `Your contract does not include ${feature}`, 403);
  }

  /**
   * Throws when `current` already reached a HARD limit. A SOFT limit lets the action continue (warning, overage charge) unless the
   * contract says REQUIRE_APPROVAL. A missing limit means the contract does not limit it. Raises the Phase 4 signals on the way.
   */
  async requireWithinLimit(
    organizationId: string,
    limitKey: string,
    current: number,
    opts: { legalEntityId?: string | null; at?: Date } = {},
  ): Promise<{ overage: boolean; limit: number | null; percent: number | null }> {
    const e = await this.effective(organizationId, opts.at ?? new Date(), {
      legalEntityId: opts.legalEntityId,
    });
    const d = e.limitDetails[limitKey];
    if (!d || d.value === null) return { overage: false, limit: null, percent: null };
    const after = current + 1;
    const percent = d.value > 0 ? Math.round((after / d.value) * 100) : 100;
    await this.raiseLimitSignals(
      organizationId,
      limitKey,
      d,
      after,
      e.contractId,
      opts.legalEntityId ?? null,
    );
    if (current >= d.value) {
      if (d.mode === 'HARD' || d.softAction === 'REQUIRE_APPROVAL')
        throw new AppError(
          'ENTITLEMENT_LIMIT_REACHED',
          `Your contract allows at most ${d.value} (${limitKey})`,
          403,
        );
      return { overage: true, limit: d.value, percent };
    }
    return { overage: false, limit: d.value, percent };
  }

  /** Raises BRANCH_LIMIT_80_PERCENT, BRANCH_LIMIT_REACHED, USER_LIMIT_APPROACHING ... once per threshold and limit value. */
  async raiseLimitSignals(
    organizationId: string,
    limitKey: string,
    d: LimitDetail,
    used: number,
    contractId: string | null,
    legalEntityId: string | null,
  ) {
    if (d.value === null || d.value <= 0) return;
    const pct = (used / d.value) * 100;
    const reached = used >= d.value;
    const metric = METRIC_OF_LIMIT[limitKey] ?? limitKey;
    const family =
      limitKey === 'branches.max'
        ? 'BRANCH'
        : limitKey === 'users.max'
          ? 'USER'
          : limitKey === 'api.requests'
            ? 'API'
            : null;
    const approaching = d.warnPercents.filter((p) => p < 100 && pct >= p).sort((a, b) => b - a)[0];
    const type = reached
      ? family === 'BRANCH'
        ? 'BRANCH_LIMIT_REACHED'
        : family
          ? `${family}_LIMIT_REACHED`
          : 'LIMIT_REACHED'
      : approaching !== undefined
        ? family === 'BRANCH'
          ? approaching === 80
            ? 'BRANCH_LIMIT_80_PERCENT'
            : 'LIMIT_APPROACHING'
          : family === 'USER'
            ? 'USER_LIMIT_APPROACHING'
            : family === 'API'
              ? 'API_LIMIT_APPROACHING'
              : 'LIMIT_APPROACHING'
        : null;
    if (!type) return;
    const dedupeKey = `limit:${organizationId}:${legalEntityId ?? ''}:${limitKey}:${type}:${d.value}`;
    await this.prisma.commercialSignal
      .create({
        data: {
          dedupeKey,
          type,
          organizationId,
          legalEntityId,
          contractId: contractId || null,
          metricKey: metric,
          payload: { limitKey, limit: d.value, used, percent: Math.round(pct) },
        },
      })
      .catch((err: { code?: string }) => {
        if (err.code !== 'P2002') throw err;
      });
  }
}
