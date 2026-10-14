import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  SENSITIVE_ATTRIBUTE_TYPES,
  UNLOCKABLE_ATTRIBUTE_TYPES,
  type EligibilityAttributeType,
  type EligibilityExpression,
  type EligibilityKind,
  type EligibilityLevel,
  type EligibilityResult,
  type UnlockAction,
} from '@dealdash/types';
import { CONFIG_KEYS } from '@dealdash/config';
import { ELIGIBILITY_EXPRESSION_LIMITS, eligibilityExpressionShape } from '@dealdash/validation';
import { AppError } from '../common/errors';
import { SystemConfigService } from '../system-config/system-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { UNLOCK_COPY } from './deal-content';

/** The customer facts the engine needs. Guests have no userId and no attributes. */
export interface EligibilityContext {
  userId: string | null;
  /** City used for geography rules: the profile city, else the browsing city. */
  city: string;
  /** Market (ISO country code) the customer is in; defaults to the enabled market. */
  country?: string;
  attributes: ReadonlyArray<{
    attrType: EligibilityAttributeType;
    valueRef: string;
    level: EligibilityLevel;
    status: string;
    expiresAt: Date | null;
    /** FD-S7-3: trusted source of a card verification (issuer / scheme API, approved partner feed, tokenized mechanism). */
    verificationSource?: string | null;
    evidenceRef?: string | null;
  }>;
  now: Date;
}

/** Card attributes whose issuer / product / tier / scheme may only count as ISSUER_VERIFIED with trusted evidence (FD-S7-3). */
const CARD_ATTRIBUTE_TYPES: readonly string[] = ['CARD', 'CARD_PRODUCT', 'CARD_TIER', 'SCHEME'];
/**
 * FD-S7-3: BIN / IIN metadata, a customer's selection or a self-declaration is never "verified". A card attribute claiming
 * ISSUER_VERIFIED without a trusted source and evidence is treated as declared (the database refuses new rows like that anyway).
 */
export function trustedLevel(a: {
  attrType: string;
  level: EligibilityLevel;
  verificationSource?: string | null;
  evidenceRef?: string | null;
}): EligibilityLevel {
  if (
    a.level === 'ISSUER_VERIFIED' &&
    CARD_ATTRIBUTE_TYPES.includes(a.attrType) &&
    (!a.verificationSource || !a.evidenceRef)
  )
    return 'SELF_DECLARED';
  return a.level;
}

export interface EligibilityCondition {
  attrType: EligibilityAttributeType;
  valueRef: string;
  requiredLevel: EligibilityLevel;
}

export interface EligibilityOutcome {
  result: EligibilityResult;
  unlockAction: UnlockAction | null;
  message: { en: string; ar: string } | null;
}

const LEVEL_RANK: Record<EligibilityLevel, number> = {
  SELF_DECLARED: 1,
  OTP_VERIFIED: 2,
  ISSUER_VERIFIED: 3,
};

type LegacyKind = Exclude<EligibilityKind, 'PUBLIC' | 'COMPOSITE'>;
const ATTR_BY_KIND: Record<LegacyKind, EligibilityAttributeType> = {
  GEOGRAPHY: 'GEOGRAPHY',
  EMPLOYER: 'EMPLOYER',
  BANK_CARD: 'CARD',
  SCHEME: 'SCHEME',
};

/** Level a customer attribute must reach for each rule kind (cards are selection-only in the MVP; employer needs a work-email OTP). */
const REQUIRED_LEVEL: Record<LegacyKind, EligibilityLevel> = {
  GEOGRAPHY: 'SELF_DECLARED',
  EMPLOYER: 'OTP_VERIFIED',
  BANK_CARD: 'SELF_DECLARED',
  SCHEME: 'SELF_DECLARED',
};

const norm = (s: string) => s.trim().toLowerCase();

/** Partner types whose organisation ids a partner attribute may reference (Stage 7 widened CARD and EMPLOYER). */
const PARTNER_TYPES_OF_ATTR: Record<
  string,
  Array<'BANK' | 'FINANCIAL_INSTITUTION' | 'SCHEME' | 'EMPLOYER' | 'CORPORATE'>
> = {
  CARD: ['BANK', 'FINANCIAL_INSTITUTION'],
  SCHEME: ['SCHEME'],
  EMPLOYER: ['EMPLOYER', 'CORPORATE'],
};

/**
 * Pure rule evaluation (no I/O). Customer visibility rule (UXD-05 / FDR-03):
 *  - eligible                                    -> ELIGIBLE (usable)
 *  - not eligible but can reasonably unlock      -> LOCKED_UNLOCKABLE with an explanation and an unlock action
 *  - definitely not eligible, no realistic path  -> HIDDEN (never returned in normal discovery)
 * Conditions of one rule set are alternatives (any one satisfies the rule).
 */
export function evaluateEligibility(
  kind: EligibilityKind,
  conditions: readonly EligibilityCondition[],
  ctx: EligibilityContext,
  /** Nested rule (kind COMPOSITE). The one shared evaluator handles it exactly like the flat kinds. */
  expression?: unknown,
): EligibilityOutcome {
  if (kind === 'COMPOSITE') {
    // A composite rule without a usable expression can never be satisfied: fail closed (hidden), not open.
    return expression
      ? evaluateExpressionOutcome(expression as EligibilityExpression, ctx)
      : { result: 'HIDDEN', unlockAction: null, message: null };
  }
  if (kind === 'PUBLIC' || conditions.length === 0)
    return { result: 'ELIGIBLE', unlockAction: null, message: null };

  const usable = ctx.attributes
    .filter(
      (a) => a.status === 'VERIFIED' && (!a.expiresAt || a.expiresAt.getTime() > ctx.now.getTime()),
    )
    .map((a) => ({ ...a, level: trustedLevel(a) }));
  const meets = (c: EligibilityCondition) =>
    usable.some(
      (a) =>
        a.attrType === c.attrType &&
        norm(a.valueRef) === norm(c.valueRef) &&
        LEVEL_RANK[a.level] >= LEVEL_RANK[c.requiredLevel],
    );

  if (kind === 'GEOGRAPHY') {
    // Geography cannot be unlocked by verification: a customer outside the area has no realistic path.
    const inArea = conditions.some((c) => norm(c.valueRef) === norm(ctx.city));
    return inArea
      ? { result: 'ELIGIBLE', unlockAction: null, message: null }
      : { result: 'HIDDEN', unlockAction: null, message: null };
  }

  if (conditions.some(meets)) return { result: 'ELIGIBLE', unlockAction: null, message: null };

  const attrType = ATTR_BY_KIND[kind];
  const locked = (action: UnlockAction): EligibilityOutcome => ({
    result: 'LOCKED_UNLOCKABLE',
    unlockAction: ctx.userId ? action : 'SIGN_IN',
    message: ctx.userId ? UNLOCK_COPY[action] : UNLOCK_COPY.SIGN_IN,
  });

  if (kind === 'EMPLOYER') {
    // A customer who already has a verified DIFFERENT employer cannot realistically unlock this one: hide it.
    const hasOtherEmployer = usable.some(
      (a) =>
        a.attrType === attrType && !conditions.some((c) => norm(c.valueRef) === norm(a.valueRef)),
    );
    if (hasOtherEmployer) return { result: 'HIDDEN', unlockAction: null, message: null };
    return locked('VERIFY_EMPLOYER');
  }
  // Cards and schemes: a customer can add any benefit, so the offer stays visible but locked.
  return locked(kind === 'BANK_CARD' ? 'ADD_BANK_BENEFIT' : 'JOIN_SCHEME');
}

// ---------------------------------------------------------------- nested rules (AND / OR / NOT)
type NodeState =
  { state: 'MET' } | { state: 'IMPOSSIBLE' } | { state: 'UNLOCKABLE'; action: UnlockAction };

const UNLOCK_BY_ATTR: Partial<Record<EligibilityAttributeType, UnlockAction>> = {
  EMPLOYER: 'VERIFY_EMPLOYER',
  CARD: 'ADD_BANK_BENEFIT',
  CARD_PRODUCT: 'ADD_BANK_BENEFIT',
  CARD_TIER: 'ADD_BANK_BENEFIT',
  SCHEME: 'JOIN_SCHEME',
  MEMBERSHIP: 'JOIN_SCHEME',
};

function usableAttributes(ctx: EligibilityContext) {
  return ctx.attributes
    .filter(
      (a) => a.status === 'VERIFIED' && (!a.expiresAt || a.expiresAt.getTime() > ctx.now.getTime()),
    )
    .map((a) => ({ ...a, level: trustedLevel(a) }));
}

/** One attribute test. Facts the customer cannot change (city, country, assigned segment, owned products) are never "unlockable". */
function evalAttr(
  node: Extract<EligibilityExpression, { op: 'ATTR' }>,
  ctx: EligibilityContext,
  usable: ReturnType<typeof usableAttributes>,
): NodeState {
  const wanted = node.values.map(norm);
  if (node.attr === 'GEOGRAPHY')
    return wanted.includes(norm(ctx.city)) ? { state: 'MET' } : { state: 'IMPOSSIBLE' };
  if (node.attr === 'COUNTRY')
    return wanted.includes(norm(ctx.country ?? 'SA')) ? { state: 'MET' } : { state: 'IMPOSSIBLE' };
  const need = LEVEL_RANK[node.level ?? 'SELF_DECLARED'];
  const met = usable.some(
    (a) =>
      a.attrType === node.attr && wanted.includes(norm(a.valueRef)) && LEVEL_RANK[a.level] >= need,
  );
  if (met) return { state: 'MET' };
  if (!UNLOCKABLE_ATTRIBUTE_TYPES.includes(node.attr)) return { state: 'IMPOSSIBLE' };
  // an employer the customer cannot change to: a verified DIFFERENT employer closes the path
  if (
    node.attr === 'EMPLOYER' &&
    usable.some((a) => a.attrType === 'EMPLOYER' && !wanted.includes(norm(a.valueRef)))
  )
    return { state: 'IMPOSSIBLE' };
  return { state: 'UNLOCKABLE', action: UNLOCK_BY_ATTR[node.attr] ?? 'JOIN_SCHEME' };
}

function evalNode(
  n: EligibilityExpression,
  ctx: EligibilityContext,
  usable: ReturnType<typeof usableAttributes>,
): NodeState {
  if (n.op === 'ATTR') return evalAttr(n, ctx, usable);
  if (n.op === 'NOT')
    return evalNode(n.child, ctx, usable).state === 'MET'
      ? { state: 'IMPOSSIBLE' }
      : { state: 'MET' };
  const kids = n.children.map((c) => evalNode(c, ctx, usable));
  if (n.op === 'AND') {
    if (kids.some((k) => k.state === 'IMPOSSIBLE')) return { state: 'IMPOSSIBLE' };
    return (
      kids.find(
        (k): k is Extract<NodeState, { state: 'UNLOCKABLE' }> => k.state === 'UNLOCKABLE',
      ) ?? { state: 'MET' }
    );
  }
  if (kids.some((k) => k.state === 'MET')) return { state: 'MET' };
  return (
    kids.find(
      (k): k is Extract<NodeState, { state: 'UNLOCKABLE' }> => k.state === 'UNLOCKABLE',
    ) ?? { state: 'IMPOSSIBLE' }
  );
}

// ---------------------------------------------------------------- My benefits: which offers are partner benefits, and whose
/** Attributes a customer obtains through My benefits (employer work email, added cards, schemes / memberships). */
const BENEFIT_ATTRIBUTE_TYPES: readonly string[] = [
  'EMPLOYER',
  'CARD',
  'CARD_PRODUCT',
  'CARD_TIER',
  'SCHEME',
  'MEMBERSHIP',
];

/** The partner references a rule mentions: organisation ids (employer / issuer / scheme), card product codes and tiers. */
export interface PartnerRefs {
  organizationIds: string[];
  productCodes: string[];
  tiers: string[];
}

export function partnerRefsOf(
  kind: EligibilityKind,
  conditions: ReadonlyArray<{ attrType: string; valueRef: string }>,
  expression?: unknown,
): PartnerRefs {
  const out: PartnerRefs = { organizationIds: [], productCodes: [], tiers: [] };
  const add = (attr: string, value: string) => {
    if (attr === 'CARD_PRODUCT') out.productCodes.push(value);
    else if (attr === 'CARD_TIER') out.tiers.push(value.toLowerCase());
    else if (BENEFIT_ATTRIBUTE_TYPES.includes(attr)) out.organizationIds.push(value);
  };
  if (kind === 'COMPOSITE' && expression) {
    const walk = (n: EligibilityExpression) => {
      if (n.op === 'ATTR') return n.values.forEach((v) => add(n.attr, v));
      // a NOT branch never grants a benefit: it is not an attribution
      if (n.op === 'NOT') return;
      n.children.forEach(walk);
    };
    walk(expression as EligibilityExpression);
  } else conditions.forEach((c) => add(c.attrType, c.valueRef));
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    organizationIds: uniq(out.organizationIds),
    productCodes: uniq(out.productCodes),
    tiers: uniq(out.tiers),
  };
}

/** A partner benefit = an offer whose rule needs something the customer gets through My benefits (not public, not just a city). */
export function isPartnerBenefitRule(
  kind: EligibilityKind,
  conditions: ReadonlyArray<{ attrType: string; valueRef: string }>,
  expression?: unknown,
): boolean {
  if (kind === 'PUBLIC' || kind === 'GEOGRAPHY') return false;
  const r = partnerRefsOf(kind, conditions, expression);
  return r.organizationIds.length + r.productCodes.length + r.tiers.length > 0;
}

/** Pure evaluation of a nested rule into the same three outcomes every product already understands. */
export function evaluateExpressionOutcome(
  expression: EligibilityExpression,
  ctx: EligibilityContext,
): EligibilityOutcome {
  const s = evalNode(expression, ctx, usableAttributes(ctx));
  if (s.state === 'MET') return { result: 'ELIGIBLE', unlockAction: null, message: null };
  if (s.state === 'IMPOSSIBLE') return { result: 'HIDDEN', unlockAction: null, message: null };
  return {
    result: 'LOCKED_UNLOCKABLE',
    unlockAction: ctx.userId ? s.action : 'SIGN_IN',
    message: ctx.userId ? UNLOCK_COPY[s.action] : UNLOCK_COPY.SIGN_IN,
  };
}
/** Rule-set storage plus customer attribute loading. One engine for every product (Live Deals first). */
@Injectable()
export class EligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    /** Optional so scripts that only store rule sets (the seeds) can build the service without the configuration layer. */
    private readonly config?: SystemConfigService,
  ) {}

  /**
   * Replaces the deal's rule set from the authored eligibility. PUBLIC deals have no rule set.
   * Returns the new rule set id (or null) and removes the previous set.
   */
  async syncRuleSet(
    tx: Prisma.TransactionClient,
    previousRuleSetId: string | null,
    organizationId: string,
    eligibility: { kind: EligibilityKind; valueRefs: string[]; expression?: unknown },
  ): Promise<string | null> {
    if (previousRuleSetId) {
      await tx.eligibilityRuleSet.deleteMany({ where: { id: previousRuleSetId } });
    }
    if (eligibility.kind === 'PUBLIC') return null;
    if (eligibility.kind === 'COMPOSITE') {
      const set = await tx.eligibilityRuleSet.create({
        data: {
          ownerOrganizationId: organizationId,
          kind: 'COMPOSITE',
          expression: eligibility.expression as Prisma.InputJsonValue,
        },
      });
      return set.id;
    }
    const kind = eligibility.kind;
    const set = await tx.eligibilityRuleSet.create({
      data: {
        ownerOrganizationId: organizationId,
        kind,
        conditions: {
          create: eligibility.valueRefs.map((valueRef) => ({
            attrType: ATTR_BY_KIND[kind],
            valueRef,
            requiredLevel: REQUIRED_LEVEL[kind],
          })),
        },
      },
    });
    return set.id;
  }

  /** Conditions for authored (not yet stored) eligibility; used by previews and tests. */
  conditionsFor(eligibility: {
    kind: EligibilityKind;
    valueRefs: string[];
  }): EligibilityCondition[] {
    if (eligibility.kind === 'PUBLIC' || eligibility.kind === 'COMPOSITE') return [];
    const kind = eligibility.kind;
    return eligibility.valueRefs.map((valueRef) => ({
      attrType: ATTR_BY_KIND[kind],
      valueRef,
      requiredLevel: REQUIRED_LEVEL[kind],
    }));
  }

  /** Validates that the chosen partner organisations / cities exist and fit the rule kind (tenant-neutral reference data). */
  async validateReferences(
    eligibility: { kind: EligibilityKind; valueRefs: string[]; expression?: unknown },
    enabledCities: readonly string[],
  ) {
    const { kind, valueRefs } = eligibility;
    if (kind === 'COMPOSITE') {
      if (!eligibility.expression)
        throw AppError.validation('A nested rule is required', 'eligibility');
      return this.validateExpression(
        eligibility.expression as EligibilityExpression,
        enabledCities,
      );
    }
    if (kind === 'PUBLIC') return;
    if (kind === 'GEOGRAPHY') {
      const bad = valueRefs.filter((c) => !enabledCities.some((e) => norm(e) === norm(c)));
      if (bad.length)
        throw AppError.validation(`City is not enabled: ${bad.join(', ')}`, 'eligibility');
      return;
    }
    // Stage 7: card issuers include financial institutions; employer programmes include corporates
    const partnerTypes =
      PARTNER_TYPES_OF_ATTR[
        kind === 'EMPLOYER' ? 'EMPLOYER' : kind === 'BANK_CARD' ? 'CARD' : 'SCHEME'
      ]!;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (valueRefs.some((v) => !uuid.test(v)))
      throw AppError.validation('Choose partners from the list', 'eligibility');
    const found = await this.prisma.organization.count({
      where: {
        id: { in: valueRefs },
        type: 'PARTNER',
        status: 'ACTIVE',
        partner: { is: { partnerType: { in: partnerTypes } } },
      },
    });
    if (found !== new Set(valueRefs).size)
      throw AppError.validation('One of the selected partners is not available', 'eligibility');
  }

  /**
   * A nested rule must be small enough to read, use only attributes the market allows and, for partner attributes, point at real,
   * active partners. Age and gender stay off until the market validates them (VALIDATE-KSA).
   */
  async validateExpression(
    expression: EligibilityExpression,
    enabledCities: readonly string[],
  ): Promise<void> {
    const shape = eligibilityExpressionShape(expression);
    if (
      shape.depth > ELIGIBILITY_EXPRESSION_LIMITS.maxDepth ||
      shape.nodes > ELIGIBILITY_EXPRESSION_LIMITS.maxNodes
    )
      throw AppError.validation('This rule is too deep or too large', 'eligibility');
    const cfg = this.config
      ? await this.config.get<{ sensitiveAttributesEnabled: boolean }>(
          CONFIG_KEYS.PLATFORM_ELIGIBILITY,
        )
      : { sensitiveAttributesEnabled: false };
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const partnerIds: Record<string, Set<string>> = {
      EMPLOYER: new Set(),
      CARD: new Set(),
      SCHEME: new Set(),
    };
    const walk = (n: EligibilityExpression) => {
      if (n.op === 'NOT') return walk(n.child);
      if (n.op !== 'ATTR') return n.children.forEach(walk);
      if (SENSITIVE_ATTRIBUTE_TYPES.includes(n.attr) && !cfg.sensitiveAttributesEnabled)
        throw AppError.validation('This criterion is not enabled in this market', 'eligibility');
      if (n.attr === 'GEOGRAPHY') {
        const bad = n.values.filter((c) => !enabledCities.some((e) => norm(e) === norm(c)));
        if (bad.length)
          throw AppError.validation(`City is not enabled: ${bad.join(', ')}`, 'eligibility');
      }
      if (n.attr in partnerIds) {
        if (n.values.some((v) => !uuid.test(v)))
          throw AppError.validation('Choose partners from the list', 'eligibility');
        n.values.forEach((v) => partnerIds[n.attr]!.add(v));
      }
    };
    walk(expression);

    for (const [attr, ids] of Object.entries(partnerIds)) {
      if (!ids.size) continue;
      const found = await this.prisma.organization.count({
        where: {
          id: { in: [...ids] },
          type: 'PARTNER',
          status: 'ACTIVE',
          partner: { is: { partnerType: { in: PARTNER_TYPES_OF_ATTR[attr]! } } },
        },
      });
      if (found !== ids.size)
        throw AppError.validation('One of the selected partners is not available', 'eligibility');
    }
  }

  async attributesFor(userId: string | null) {
    if (!userId) return [];
    return this.prisma.eligibilityAttribute.findMany({ where: { userId } });
  }

  async contextFor(
    userId: string | null,
    browsingCity: string,
    now = new Date(),
  ): Promise<EligibilityContext> {
    let city = browsingCity;
    if (userId) {
      const c = await this.prisma.customer.findUnique({ where: { userId } });
      if (c?.city) city = c.city;
    }
    return { userId, city, attributes: await this.attributesFor(userId), now };
  }

  /** Active partner choices for the merchant builder (names only). */
  async options() {
    const rows = await this.prisma.organization.findMany({
      where: { type: 'PARTNER', status: 'ACTIVE' },
      include: { partner: true },
      orderBy: { nameEn: 'asc' },
    });
    const pick = (t: string) =>
      rows
        .filter((r) => r.partner?.partnerType === t)
        .map((r) => ({ id: r.id, nameEn: r.nameEn, nameAr: r.nameAr }));
    const pickAll = (ts: readonly string[]) => ts.flatMap(pick);
    return {
      employers: pickAll(PARTNER_TYPES_OF_ATTR.EMPLOYER!),
      banks: pickAll(PARTNER_TYPES_OF_ATTR.CARD!),
      schemes: pickAll(PARTNER_TYPES_OF_ATTR.SCHEME!),
    };
  }
}
