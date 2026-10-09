import { Injectable } from '@nestjs/common';
import { ENTITLEMENT_PRODUCT_OF, NEW_EXPOSURE_ACTIONS, PROTECTED_ACTIONS, type PermissionCode } from '@dealdash/types';
import type { Actor } from '../common/request-context';
import { EntitlementService } from '../platform/entitlement.service';
import { ScopeService, type ScopeTarget } from '../platform/scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsageService } from './usage.service';

export interface AccessInput {
  organizationId: string;
  legalEntityId?: string | null;
  /** What is being attempted: a new-exposure action, a protected one, or nothing (just "is this product / feature available"). */
  action?: string;
  product?: string;
  feature?: string;
  limitKey?: string;
  /** Add this many when checking a count limit (default 1). */
  delta?: number;
  actor?: Actor | null;
  permission?: PermissionCode;
  scopeTarget?: ScopeTarget;
  campaign?: { product: 'VOUCHER' | 'WATCH' | 'EXCLUSIVE' | 'LIVE_BENEFIT' | 'LOYALTY'; subjectId: string };
  at?: Date;
}

export interface AccessCheck {
  step: number;
  code: string;
  ok: boolean;
  /** A stable machine reason a screen translates; never invented prose. */
  reason: string | null;
  detail?: Record<string, unknown>;
}

export interface AccessDecision {
  allowed: boolean;
  /** Protected actions (redemption, refund, invoice access, history, fulfilment) are never blocked by the commercial engine. */
  protectedAction: boolean;
  checks: AccessCheck[];
  reasons: string[];
  /** What would fix it (upgrade, add-on, contact finance ...), from data. */
  remedies: string[];
}

/**
 * The twelve-step commercial authorization, in one place and with reasons. Backend enforcement still happens inside the product
 * services (EntitlementService / UsageService); this service answers the same question WITHOUT side effects, so a screen, support or
 * the AI layer can say exactly why something is unavailable, from the real contract, entitlement, usage and financial state.
 *   1 business account active   2 legal entity active   3 contract in force   4 plan / licence usable   5 product entitled
 *   6 feature entitled   7 role authorized   8 scope authorized   9 usage within limit   10 add-on available
 *   11 commercial acceptance complete   12 financial status allows
 */
@Injectable()
export class CommercialAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly usage: UsageService,
    private readonly scope: ScopeService,
  ) {}

  async evaluate(i: AccessInput): Promise<AccessDecision> {
    const at = i.at ?? new Date();
    const checks: AccessCheck[] = [];
    const add = (step: number, code: string, ok: boolean, reason: string | null, detail?: Record<string, unknown>) => checks.push({ step, code, ok, reason: ok ? null : reason, detail });
    const remedies = new Set<string>();
    const protectedAction = (PROTECTED_ACTIONS as readonly string[]).includes(i.action ?? '');
    if (protectedAction)
      return { allowed: true, protectedAction: true, checks: [{ step: 0, code: 'PROTECTED_ACTION', ok: true, reason: null }], reasons: [], remedies: [] };

    const org = await this.prisma.organization.findUnique({ where: { id: i.organizationId }, select: { status: true } });
    add(1, 'BUSINESS_ACCOUNT_ACTIVE', org?.status === 'ACTIVE', 'BUSINESS_ACCOUNT_NOT_ACTIVE', { status: org?.status ?? null });
    if (i.legalEntityId) {
      const le = await this.prisma.legalEntity.findFirst({ where: { id: i.legalEntityId, organizationId: i.organizationId }, select: { status: true } });
      add(2, 'LEGAL_ENTITY_ACTIVE', le?.status === 'ACTIVE', 'LEGAL_ENTITY_NOT_ACTIVE', { status: le?.status ?? null });
    }
    const e = await this.entitlements.effective(i.organizationId, at, { legalEntityId: i.legalEntityId });
    const inForce = e.source === 'DEFAULT_PLAN' || ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'].includes(e.lifecycle ?? '');
    const pending = await this.prisma.contract.findFirst({ where: { organizationId: i.organizationId, status: 'PENDING_ACTIVATION' }, select: { id: true } });
    add(3, 'CONTRACT_IN_FORCE', inForce, pending && e.source === 'DEFAULT_PLAN' ? 'CONTRACT_WAITING_FOR_ACCEPTANCE' : 'NO_CONTRACT_IN_FORCE', { source: e.source, lifecycle: e.lifecycle, planCode: e.planCode });
    if (!inForce) remedies.add('CONTACT_DEALDASH');

    const block = i.action && (NEW_EXPOSURE_ACTIONS as readonly string[]).includes(i.action) ? await this.entitlements.newExposureBlock(i.organizationId, i.action, at) : null;
    add(4, 'PLAN_USABLE', block?.code !== 'CONTRACT_ENDED', 'CONTRACT_ENDED', { lifecycle: e.lifecycle });

    if (i.product) {
      const key = (ENTITLEMENT_PRODUCT_OF as Record<string, string>)[i.product] ?? i.product;
      const ok = e.products.includes(key);
      add(5, 'PRODUCT_ENTITLED', ok, 'PRODUCT_NOT_IN_PLAN', { product: key });
      if (!ok) remedies.add('UPGRADE_PLAN').add('REQUEST_ADD_ON');
    }
    if (i.feature) {
      const ok = e.features.includes(i.feature);
      add(6, 'FEATURE_ENTITLED', ok, 'FEATURE_NOT_IN_PLAN', { feature: i.feature });
      if (!ok) remedies.add('UPGRADE_PLAN').add('REQUEST_ADD_ON');
    }
    if (i.actor && i.permission) {
      const ok = i.actor.permissions.has(i.permission);
      add(7, 'ROLE_AUTHORIZED', ok, 'ROLE_NOT_AUTHORIZED', { permission: i.permission });
      if (!ok) remedies.add('ASK_AN_ADMIN');
    }
    if (i.actor && i.permission && i.scopeTarget) {
      const ok = await this.scope.can(i.actor, i.permission, i.scopeTarget);
      add(8, 'SCOPE_AUTHORIZED', ok, 'SCOPE_NOT_AUTHORIZED', { target: i.scopeTarget });
      if (!ok) remedies.add('ASK_AN_ADMIN');
    }
    const limitKey = i.limitKey ?? (i.action === 'ADD_BRANCH' ? 'branches.max' : i.action === 'ADD_USER' ? 'users.max' : i.action === 'ACTIVATE_CAMPAIGN' || i.action === 'NEW_PAID_CAMPAIGN' ? 'campaigns.max_active' : undefined);
    if (limitKey) {
      const d = e.limitDetails[limitKey];
      if (d && d.value !== null) {
        const resource = ['branches.max', 'users.max', 'campaigns.max_active', 'legal_entities.max', 'brands.max', 'markets.max'].includes(limitKey);
        const used = resource ? await this.usage.currentCount(i.organizationId, limitKey, { legalEntityId: i.legalEntityId }) : await this.usage.periodValue(i.organizationId, limitKey, { legalEntityId: i.legalEntityId, at });
        const over = used + (i.delta ?? 1) > d.value;
        const blocking = over && (d.mode === 'HARD' || d.softAction === 'REQUIRE_APPROVAL');
        add(9, 'USAGE_WITHIN_LIMIT', !blocking, 'LIMIT_REACHED', { limitKey, used, limit: d.value, mode: d.mode, overageAllowed: over && !blocking });
        if (blocking) remedies.add('UPGRADE_PLAN').add('REQUEST_ADD_ON').add('REDUCE_USAGE');
        else if (over) remedies.add('OVERAGE_APPLIES');
        const addOns = await this.prisma.addOnDefinition.findMany({ where: { status: 'ACTIVE' } });
        const useful = addOns.filter((a) => (a.effect as Array<{ key: string }>).some((x) => x.key === limitKey));
        add(10, 'ADD_ON_AVAILABLE', !blocking || useful.length > 0, 'NO_ADD_ON_FOR_THIS_LIMIT', { addOns: useful.map((a) => a.code) });
      }
    }
    if (i.campaign) {
      const c = await this.prisma.commercialCase.findUnique({ where: { product_subjectId: { product: i.campaign.product, subjectId: i.campaign.subjectId } } });
      add(11, 'COMMERCIAL_ACCEPTANCE_COMPLETE', !!c?.acceptedQuotationId, 'COMMERCIAL_ACCEPTANCE_MISSING', { caseStatus: c?.status ?? null });
    } else if (pending) add(11, 'COMMERCIAL_ACCEPTANCE_COMPLETE', e.source === 'CONTRACT', 'CONTRACT_WAITING_FOR_ACCEPTANCE');
    const fin = await this.entitlements.financialStatus(i.organizationId, at);
    const finBlocked = block !== null && block.code !== 'CONTRACT_ENDED';
    add(12, 'FINANCIAL_STATUS_ALLOWS', !finBlocked, block?.code ?? 'FINANCIAL_STATUS_BLOCKS', { status: fin.status, graceUntil: fin.graceUntil });
    if (finBlocked) remedies.add('SETTLE_PAYMENT').add('CONTACT_DEALDASH_FINANCE');

    const failed = checks.filter((c) => !c.ok);
    return { allowed: failed.length === 0, protectedAction: false, checks: checks.sort((a, b) => a.step - b.step), reasons: failed.map((c) => c.reason!).filter(Boolean), remedies: [...remedies] };
  }
}
