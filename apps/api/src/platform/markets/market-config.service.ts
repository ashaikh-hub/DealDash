import { Injectable } from '@nestjs/common';
import {
  INVOICE_CONFIG_KINDS,
  INVOICE_REQUIRED_FIELDS,
  MARKET_POLICY_CATEGORIES,
  MARKET_POLICY_KEYS,
  MARKET_PRODUCTS,
  MARKET_VALIDATION_STATUSES,
  PAYMENT_METHODS,
  PROVIDER_CAPABILITIES,
  PROVIDER_ENVIRONMENTS,
  PROVIDER_STATUSES,
  RECONCILIATION_METHODS,
  ROUNDING_RULES,
  SECRET_REF_PATTERN,
  SETTLEMENT_FREQUENCIES,
  TAXABLE_ITEMS,
  TAX_TYPES,
  VALIDATION_STATES,
  type MarketPolicyCategory,
  type RoundingRule,
} from '@dealdash/types';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/errors';
import type { Actor, RequestMeta } from '../../common/request-context';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MARKET_SCOPE, MarketService } from './market.service';

type Db = Prisma.TransactionClient | PrismaService;
export type ConfigTable = 'taxRule' | 'invoiceConfig' | 'settlementRule' | 'marketPolicy';
type VersionedRow = {
  id: string;
  market: string;
  version: number;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdByUserId: string;
};

const ENTITY: Record<ConfigTable, string> = {
  taxRule: 'TaxRule',
  invoiceConfig: 'InvoiceConfig',
  settlementRule: 'SettlementRule',
  marketPolicy: 'MarketPolicy',
};
const inRange = (r: { effectiveFrom: Date; effectiveTo: Date | null }, at: Date) =>
  r.effectiveFrom <= at && (!r.effectiveTo || r.effectiveTo > at);

/** Rounds a rational minor amount by a rounding rule (exact integer arithmetic). */
export function roundMinor(numerator: bigint, denominator: bigint, rule: RoundingRule): number {
  const q = numerator / denominator;
  const r = numerator % denominator;
  if (r === 0n) return Number(q);
  const twice = r * 2n;
  switch (rule) {
    case 'DOWN':
      return Number(q);
    case 'UP':
      return Number(q + 1n);
    case 'HALF_EVEN':
      return Number(twice > denominator || (twice === denominator && q % 2n === 1n) ? q + 1n : q);
    default:
      return Number(twice >= denominator ? q + 1n : q);
  }
}

/** Tax on an amount under a rule: exclusive (added on top) or inclusive (contained in the amount). */
export function taxOf(
  amountMinor: number,
  rule: { rateBps: number; inclusive: boolean; exempt: boolean; roundingRule: string },
) {
  if (rule.exempt || rule.rateBps === 0)
    return { netMinor: amountMinor, taxMinor: 0, grossMinor: amountMinor };
  const rr = rule.roundingRule as RoundingRule;
  if (rule.inclusive) {
    const tax = roundMinor(
      BigInt(amountMinor) * BigInt(rule.rateBps),
      BigInt(10_000 + rule.rateBps),
      rr,
    );
    return { netMinor: amountMinor - tax, taxMinor: tax, grossMinor: amountMinor };
  }
  const tax = roundMinor(BigInt(amountMinor) * BigInt(rule.rateBps), 10_000n, rr);
  return { netMinor: amountMinor, taxMinor: tax, grossMinor: amountMinor + tax };
}

/**
 * Market configuration that affects money and compliance: tax rules, invoice configuration, settlement rules and market policies are
 * effective-dated and versioned (draft -> second-person approval -> superseded or retired; approved rows are frozen in the database), so
 * a later change never rewrites what already applied. Providers and the validation register are audited. Nothing statutory is assumed:
 * a requirement that needs confirmation carries a validation code that lives in the market validation register.
 */
@Injectable()
export class MarketConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
  ) {}

  private delegate(db: Db, table: ConfigTable) {
    return db[table] as unknown as {
      findUnique(a: unknown): Promise<VersionedRow | null>;
      findMany(a: unknown): Promise<VersionedRow[]>;
      update(a: unknown): Promise<VersionedRow>;
      create(a: unknown): Promise<VersionedRow>;
      aggregate(a: unknown): Promise<{ _max: { version: number | null } }>;
    };
  }

  /** The rows of the same identity (all versions of one rule). */
  private identity(table: ConfigTable, r: Record<string, unknown>): Record<string, unknown> {
    switch (table) {
      case 'taxRule':
      case 'settlementRule':
        return { market: r.market, code: r.code };
      case 'invoiceConfig':
        return {
          market: r.market,
          documentKind: r.documentKind,
          legalEntityId: r.legalEntityId ?? null,
        };
      case 'marketPolicy':
        return { market: r.market, category: r.category, key: r.key, product: r.product ?? '' };
    }
  }

  private async createDraft(
    actor: Actor,
    table: ConfigTable,
    data: Record<string, unknown>,
    meta: RequestMeta,
  ) {
    const market = String(data.market);
    await this.markets.assertScope(actor, 'admin.markets.manage', market);
    await this.markets.load(market);
    return this.prisma.$transaction(async (tx) => {
      const d = this.delegate(tx, table);
      const last = await d.aggregate({
        where: this.identity(table, data),
        _max: { version: true },
      });
      const row = await d.create({
        data: {
          ...data,
          version: (last._max.version ?? 0) + 1,
          status: 'DRAFT',
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: `${ENTITY[table].toUpperCase()}_DRAFTED`,
          entityType: ENTITY[table],
          entityId: row.id,
          actor,
          newState: row as unknown as Record<string, unknown>,
          scope: MARKET_SCOPE(market),
          meta,
        },
        tx,
      );
      return row;
    });
  }

  /**
   * A second administrator approves a draft. The approved version takes over from the previous approved version of the same rule,
   * whose period is closed at the new version's start (it is never edited otherwise). Overlapping or earlier starts are refused.
   */
  async approve(actor: Actor, table: ConfigTable, id: string, meta: RequestMeta) {
    const d0 = this.delegate(this.prisma, table);
    const row = await d0.findUnique({ where: { id } });
    if (!row) throw AppError.notFound();
    await this.markets.assertScope(actor, 'admin.markets.approve', row.market);
    if (row.status !== 'DRAFT' && row.status !== 'PENDING_APPROVAL')
      throw new AppError('INVALID_STATE', 'Only a draft can be approved', 409);
    if (row.createdByUserId === actor.userId)
      throw new AppError(
        'APPROVAL_REQUIRED',
        'A different administrator must approve market configuration',
        403,
      );
    const full = row as unknown as Record<string, unknown>;
    return this.prisma.$transaction(async (tx) => {
      const d = this.delegate(tx, table);
      const current = (
        await d.findMany({ where: { ...this.identity(table, full), status: 'APPROVED' } })
      ).filter((c) => !c.effectiveTo || c.effectiveTo > row.effectiveFrom);
      for (const c of current) {
        if (c.effectiveFrom >= row.effectiveFrom)
          throw new AppError(
            'MARKET_CONFIG_INVALID',
            `Version ${c.version} already applies from ${c.effectiveFrom.toISOString().slice(0, 10)}: a new version must start after it`,
            409,
          );
        await d.update({ where: { id: c.id }, data: { effectiveTo: row.effectiveFrom } });
      }
      const ok = await d.update({
        where: { id },
        data: { status: 'APPROVED', approvedByUserId: actor.userId, approvedAt: new Date() },
      });
      await this.audit.record(
        {
          action: `${ENTITY[table].toUpperCase()}_APPROVED`,
          entityType: ENTITY[table],
          entityId: id,
          actor,
          previousState: { superseded: current.map((c) => ({ id: c.id, version: c.version })) },
          newState: { version: ok.version, effectiveFrom: ok.effectiveFrom },
          approvalRef: actor.userId,
          scope: MARKET_SCOPE(row.market),
          meta,
        },
        tx,
      );
      return ok;
    });
  }

  /** Retires an approved version from a date (default now); history is kept. */
  async retire(
    actor: Actor,
    table: ConfigTable,
    id: string,
    reason: string,
    meta: RequestMeta,
    at = new Date(),
  ) {
    const row = await this.delegate(this.prisma, table).findUnique({ where: { id } });
    if (!row) throw AppError.notFound();
    await this.markets.assertScope(actor, 'admin.markets.manage', row.market);
    if (row.status !== 'APPROVED')
      throw new AppError('INVALID_STATE', 'Only an approved version can be retired', 409);
    const end =
      row.effectiveTo && row.effectiveTo < at
        ? row.effectiveTo
        : at <= row.effectiveFrom
          ? new Date(row.effectiveFrom.getTime() + 1)
          : at;
    return this.prisma.$transaction(async (tx) => {
      const r = await this.delegate(tx, table).update({
        where: { id },
        data: { status: 'RETIRED', effectiveTo: end },
      });
      await this.audit.record(
        {
          action: `${ENTITY[table].toUpperCase()}_RETIRED`,
          entityType: ENTITY[table],
          entityId: id,
          actor,
          newState: { effectiveTo: end },
          reason,
          scope: MARKET_SCOPE(row.market),
          meta,
        },
        tx,
      );
      return r;
    });
  }

  async list(table: ConfigTable, market: string) {
    return this.delegate(this.prisma, table).findMany({
      where: { market: market.toUpperCase() },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    });
  }

  // ---------------------------------------------------------------- tax
  async draftTax(
    actor: Actor,
    market: string,
    b: {
      code: string;
      legalEntityId?: string | null;
      taxType: string;
      rateBps: number;
      inclusive?: boolean;
      applicability: string[];
      exempt?: boolean;
      exemptionReason?: string | null;
      registrationRef?: string | null;
      roundingRule?: string;
      taxCurrency?: string | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
      validationCode?: string | null;
      notes?: string | null;
    },
    meta: RequestMeta,
  ) {
    if (!(TAX_TYPES as readonly string[]).includes(b.taxType))
      throw AppError.validation('Unknown tax type', 'taxType');
    if (
      !b.applicability.length ||
      !b.applicability.every((x) => x === '*' || (TAXABLE_ITEMS as readonly string[]).includes(x))
    )
      throw AppError.validation('Choose what the rule applies to', 'applicability');
    if (b.exempt && b.rateBps !== 0)
      throw AppError.validation('An exemption has a zero rate', 'rateBps');
    if (b.roundingRule && !(ROUNDING_RULES as readonly string[]).includes(b.roundingRule))
      throw AppError.validation('Unknown rounding rule', 'roundingRule');
    const code = market.toUpperCase();
    await this.assertLegalEntity(b.legalEntityId ?? null, code);
    const m = await this.markets.load(code);
    if (b.taxCurrency && !m.supportedCurrencies.includes(b.taxCurrency))
      throw AppError.validation(
        'The tax currency must be a supported currency of the market',
        'taxCurrency',
      );
    return this.createDraft(
      actor,
      'taxRule',
      {
        market: code,
        code: b.code.toUpperCase(),
        legalEntityId: b.legalEntityId ?? null,
        taxType: b.taxType,
        rateBps: b.rateBps,
        inclusive: b.inclusive ?? false,
        applicability: b.applicability,
        exempt: b.exempt ?? false,
        exemptionReason: b.exemptionReason ?? null,
        registrationRef: b.registrationRef ?? null,
        roundingRule: b.roundingRule ?? m.roundingRule,
        taxCurrency: b.taxCurrency ?? null,
        effectiveFrom: new Date(b.effectiveFrom),
        effectiveTo: b.effectiveTo ? new Date(b.effectiveTo) : null,
        validationCode: b.validationCode ?? null,
        notes: b.notes ?? null,
      },
      meta,
    );
  }

  /**
   * The approved tax rule for a market, taxable item, legal entity and date. Only rules of THIS market are considered: there is never a
   * fallback to another country's rule (null means "not configured", which documents show as such).
   */
  async resolveTax(
    market: string,
    item: string,
    opts: { legalEntityId?: string | null; at?: Date } = {},
    db: Db = this.prisma,
  ) {
    const at = opts.at ?? new Date();
    const rows = await db.taxRule.findMany({
      where: { market, status: { in: ['APPROVED', 'RETIRED'] }, effectiveFrom: { lte: at } },
    });
    const live = rows.filter(
      (r) =>
        inRange(r, at) &&
        (r.applicability.includes('*') || r.applicability.includes(item)) &&
        (!r.legalEntityId || r.legalEntityId === opts.legalEntityId),
    );
    // legal-entity-specific first, then an item-specific rule over a catch-all, then the latest version
    return (
      live.sort(
        (a, b) =>
          Number(!!b.legalEntityId) - Number(!!a.legalEntityId) ||
          Number(b.applicability.includes(item)) - Number(a.applicability.includes(item)) ||
          b.version - a.version,
      )[0] ?? null
    );
  }

  // ---------------------------------------------------------------- invoices
  async draftInvoiceConfig(
    actor: Actor,
    market: string,
    b: {
      documentKind: string;
      legalEntityId?: string | null;
      prefix: string;
      sequenceKey?: string;
      languages: string[];
      requiredFields?: string[];
      qrRequired?: boolean;
      eInvoiceProvider?: string | null;
      validationStatus?: string;
      validationCode?: string | null;
      effectiveFrom: string;
      effectiveTo?: string | null;
      notes?: string | null;
    },
    meta: RequestMeta,
  ) {
    if (!(INVOICE_CONFIG_KINDS as readonly string[]).includes(b.documentKind))
      throw AppError.validation('Unknown document kind', 'documentKind');
    if (!/^[A-Z0-9][A-Z0-9-]{0,15}$/.test(b.prefix))
      throw AppError.validation('Use upper-case letters, digits and dashes', 'prefix');
    if (
      (b.requiredFields ?? []).some(
        (f) => !(INVOICE_REQUIRED_FIELDS as readonly string[]).includes(f),
      )
    )
      throw AppError.validation('Unknown required field', 'requiredFields');
    if (
      b.validationStatus &&
      !(VALIDATION_STATES as readonly string[]).includes(b.validationStatus)
    )
      throw AppError.validation('Unknown validation status', 'validationStatus');
    const code = market.toUpperCase();
    await this.assertLegalEntity(b.legalEntityId ?? null, code);
    const m = await this.markets.load(code);
    if (b.languages.some((l) => !m.languages.includes(l)))
      throw AppError.validation('Invoice languages must be market languages', 'languages');
    return this.createDraft(
      actor,
      'invoiceConfig',
      {
        market: code,
        documentKind: b.documentKind,
        legalEntityId: b.legalEntityId ?? null,
        prefix: b.prefix,
        sequenceKey: b.sequenceKey ?? `invoice:${code}:${b.documentKind}:${b.prefix}`,
        languages: b.languages,
        requiredFields: b.requiredFields ?? [],
        qrRequired: b.qrRequired ?? false,
        eInvoiceProvider: b.eInvoiceProvider ?? null,
        validationStatus: b.validationStatus ?? 'VALIDATION_REQUIRED',
        validationCode: b.validationCode ?? null,
        effectiveFrom: new Date(b.effectiveFrom),
        effectiveTo: b.effectiveTo ? new Date(b.effectiveTo) : null,
        notes: b.notes ?? null,
      },
      meta,
    );
  }

  async resolveInvoiceConfig(
    market: string,
    kind: string,
    opts: { legalEntityId?: string | null; at?: Date } = {},
    db: Db = this.prisma,
  ) {
    const at = opts.at ?? new Date();
    const rows = await db.invoiceConfig.findMany({
      where: {
        market,
        documentKind: kind,
        status: { in: ['APPROVED', 'RETIRED'] },
        effectiveFrom: { lte: at },
      },
    });
    return (
      rows
        .filter(
          (r) => inRange(r, at) && (!r.legalEntityId || r.legalEntityId === opts.legalEntityId),
        )
        .sort(
          (a, b) => Number(!!b.legalEntityId) - Number(!!a.legalEntityId) || b.version - a.version,
        )[0] ?? null
    );
  }

  // ---------------------------------------------------------------- settlement
  async draftSettlement(
    actor: Actor,
    market: string,
    b: {
      code: string;
      legalEntityId?: string | null;
      product?: string | null;
      organizationId?: string | null;
      contractId?: string | null;
      currency: string;
      frequency: string;
      cycleDays?: number;
      minimumMinor?: number;
      destinationRef?: string | null;
      payableTreatment?: string;
      sponsorTreatment?: string;
      feeBps?: number | null;
      reconciliationMethod?: string;
      holdDays?: number;
      disputeTreatment?: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
      validationCode?: string | null;
    },
    meta: RequestMeta,
  ) {
    if (!(SETTLEMENT_FREQUENCIES as readonly string[]).includes(b.frequency))
      throw AppError.validation('Unknown settlement frequency', 'frequency');
    if (
      b.reconciliationMethod &&
      !(RECONCILIATION_METHODS as readonly string[]).includes(b.reconciliationMethod)
    )
      throw AppError.validation('Unknown reconciliation method', 'reconciliationMethod');
    if (b.product && !(MARKET_PRODUCTS as readonly string[]).includes(b.product))
      throw AppError.validation('Unknown product', 'product');
    const code = market.toUpperCase();
    const m = await this.markets.load(code);
    if (!m.supportedCurrencies.includes(b.currency))
      throw AppError.validation(
        'The settlement currency must be a supported currency of the market',
        'currency',
      );
    await this.assertLegalEntity(b.legalEntityId ?? null, code);
    if (
      b.contractId &&
      !(await this.prisma.contract.count({
        where: {
          id: b.contractId,
          ...(b.organizationId ? { organizationId: b.organizationId } : {}),
        },
      }))
    )
      throw AppError.validation('Unknown contract', 'contractId');
    if (b.destinationRef && /\d{10,}/.test(b.destinationRef))
      throw AppError.validation(
        'Use a reference to the secure payout destination, never an account number',
        'destinationRef',
      );
    return this.createDraft(
      actor,
      'settlementRule',
      {
        market: code,
        code: b.code.toUpperCase(),
        legalEntityId: b.legalEntityId ?? null,
        product: b.product ?? null,
        organizationId: b.organizationId ?? null,
        contractId: b.contractId ?? null,
        currency: b.currency,
        frequency: b.frequency,
        cycleDays: b.cycleDays ?? 0,
        minimumMinor: b.minimumMinor ?? 0,
        destinationRef: b.destinationRef ?? null,
        payableTreatment: b.payableTreatment ?? 'NET_OF_FEES',
        sponsorTreatment: b.sponsorTreatment ?? 'SEPARATE_LINE',
        feeBps: b.feeBps ?? null,
        reconciliationMethod: b.reconciliationMethod ?? 'STATEMENT_MATCH',
        holdDays: b.holdDays ?? 0,
        disputeTreatment: b.disputeTreatment ?? 'HOLD_DISPUTED_AMOUNT',
        effectiveFrom: new Date(b.effectiveFrom),
        effectiveTo: b.effectiveTo ? new Date(b.effectiveTo) : null,
        validationCode: b.validationCode ?? null,
      },
      meta,
    );
  }

  /** The most specific approved settlement rule: contract > business > legal entity > product > market-wide (same market, same currency). */
  async resolveSettlement(
    market: string,
    opts: {
      legalEntityId?: string | null;
      product?: string | null;
      organizationId?: string | null;
      contractId?: string | null;
      currency?: string | null;
      at?: Date;
    } = {},
    db: Db = this.prisma,
  ) {
    const at = opts.at ?? new Date();
    const rows = await db.settlementRule.findMany({
      where: {
        market,
        status: { in: ['APPROVED', 'RETIRED'] },
        effectiveFrom: { lte: at },
        ...(opts.currency ? { currency: opts.currency } : {}),
      },
    });
    const fits = rows.filter(
      (r) =>
        inRange(r, at) &&
        (!r.contractId || r.contractId === opts.contractId) &&
        (!r.organizationId || r.organizationId === opts.organizationId) &&
        (!r.legalEntityId || r.legalEntityId === opts.legalEntityId) &&
        (!r.product || r.product === opts.product),
    );
    const score = (r: (typeof rows)[number]) =>
      (r.contractId ? 8 : 0) +
      (r.organizationId ? 4 : 0) +
      (r.legalEntityId ? 2 : 0) +
      (r.product ? 1 : 0);
    return fits.sort((a, b) => score(b) - score(a) || b.version - a.version)[0] ?? null;
  }

  // ---------------------------------------------------------------- policies (refund / expiry, KYB, privacy / consent / residency, terms, support)
  async draftPolicy(
    actor: Actor,
    market: string,
    b: {
      category: string;
      key: string;
      product?: string | null;
      value: Record<string, unknown>;
      required?: boolean;
      validationCode?: string | null;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
    },
    meta: RequestMeta,
  ) {
    if (!(MARKET_POLICY_CATEGORIES as readonly string[]).includes(b.category))
      throw AppError.validation('Unknown policy category', 'category');
    if (!MARKET_POLICY_KEYS[b.category as MarketPolicyCategory].includes(b.key))
      throw AppError.validation('Unknown policy for this category', 'key');
    if (b.product && !(MARKET_PRODUCTS as readonly string[]).includes(b.product))
      throw AppError.validation('Unknown product', 'product');
    return this.createDraft(
      actor,
      'marketPolicy',
      {
        market: market.toUpperCase(),
        category: b.category,
        key: b.key,
        product: b.product ?? '',
        value: b.value as Prisma.InputJsonValue,
        required: b.required ?? false,
        validationCode: b.validationCode ?? null,
        effectiveFrom: b.effectiveFrom ? new Date(b.effectiveFrom) : new Date(),
        effectiveTo: b.effectiveTo ? new Date(b.effectiveTo) : null,
      },
      meta,
    );
  }

  /** A product-specific policy refines the market-wide one. */
  async resolvePolicy(
    market: string,
    category: string,
    key: string,
    opts: { product?: string | null; at?: Date } = {},
    db: Db = this.prisma,
  ) {
    const at = opts.at ?? new Date();
    const rows = (
      await db.marketPolicy.findMany({
        where: {
          market,
          category,
          key,
          status: { in: ['APPROVED', 'RETIRED'] },
          effectiveFrom: { lte: at },
        },
      })
    ).filter((r) => inRange(r, at) && (r.product === '' || r.product === (opts.product ?? '')));
    return (
      rows.sort(
        (a, b) => Number(b.product !== '') - Number(a.product !== '') || b.version - a.version,
      )[0] ?? null
    );
  }

  // ---------------------------------------------------------------- providers (references only, never secrets)
  private checkProvider(b: {
    capability: string;
    method?: string | null;
    environment?: string;
    status?: string;
    credentialRef?: string | null;
    webhookRef?: string | null;
  }) {
    if (!(PROVIDER_CAPABILITIES as readonly string[]).includes(b.capability))
      throw AppError.validation('Unknown provider capability', 'capability');
    if (b.method && !(PAYMENT_METHODS as readonly string[]).includes(b.method))
      throw AppError.validation('Unknown payment method', 'method');
    if (b.method && b.capability !== 'PAYMENT')
      throw AppError.validation('Only payment providers have a payment method', 'method');
    if (b.environment && !(PROVIDER_ENVIRONMENTS as readonly string[]).includes(b.environment))
      throw AppError.validation('Unknown environment', 'environment');
    if (b.status && !(PROVIDER_STATUSES as readonly string[]).includes(b.status))
      throw AppError.validation('Unknown provider status', 'status');
    for (const f of ['credentialRef', 'webhookRef'] as const)
      if (b[f] && !SECRET_REF_PATTERN.test(b[f]!))
        throw AppError.validation(
          'Store a reference to the secret store (env:NAME or secret:NAME), never the secret itself',
          f,
        );
  }

  async upsertProvider(
    actor: Actor,
    market: string,
    id: string | null,
    b: {
      capability: string;
      providerCode: string;
      method?: string | null;
      currency?: string | null;
      merchantAccountRef?: string | null;
      refundSupported?: boolean | null;
      credentialRef?: string | null;
      webhookRef?: string | null;
      environment?: string;
      priority?: number;
      isFallback?: boolean;
      status?: string;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
      notes?: string | null;
    },
    meta: RequestMeta,
  ) {
    const code = market.toUpperCase();
    await this.markets.assertScope(actor, 'admin.markets.manage', code);
    const m = await this.markets.load(code);
    this.checkProvider(b);
    if (b.currency && !m.supportedCurrencies.includes(b.currency))
      throw AppError.validation(
        'The payment currency must be a supported currency of the market',
        'currency',
      );
    // a production provider cannot point at a mock
    if (b.environment === 'PRODUCTION' && /mock/i.test(b.providerCode))
      throw AppError.validation(
        'A mock adapter cannot be configured for production',
        'environment',
      );
    const before = id
      ? await this.prisma.marketProvider.findFirst({ where: { id, market: code } })
      : null;
    if (id && !before) throw AppError.notFound();
    const data = {
      capability: b.capability,
      providerCode: b.providerCode,
      method: b.method ?? null,
      currency: b.currency ?? null,
      merchantAccountRef: b.merchantAccountRef ?? null,
      refundSupported: b.refundSupported ?? null,
      credentialRef: b.credentialRef ?? null,
      webhookRef: b.webhookRef ?? null,
      environment: b.environment ?? 'MOCK',
      priority: b.priority ?? 100,
      isFallback: b.isFallback ?? false,
      status: b.status ?? 'CONFIGURING',
      effectiveFrom: b.effectiveFrom
        ? new Date(b.effectiveFrom)
        : (before?.effectiveFrom ?? new Date()),
      effectiveTo: b.effectiveTo ? new Date(b.effectiveTo) : null,
      notes: b.notes ?? null,
    };
    return this.prisma.$transaction(async (tx) => {
      const row = before
        ? await tx.marketProvider.update({
            where: { id: before.id },
            data: { ...data, version: { increment: 1 }, updatedByUserId: actor.userId },
          })
        : await tx.marketProvider.create({
            data: { market: code, ...data, createdByUserId: actor.userId },
          });
      await this.audit.record(
        {
          action: before ? 'MARKET_PROVIDER_UPDATED' : 'MARKET_PROVIDER_CREATED',
          entityType: 'MarketProvider',
          entityId: row.id,
          actor,
          previousState: before ?? undefined,
          newState: row,
          scope: MARKET_SCOPE(code),
          meta,
        },
        tx,
      );
      return row;
    });
  }

  async providers(market: string) {
    return this.prisma.marketProvider.findMany({
      where: { market: market.toUpperCase() },
      orderBy: [{ capability: 'asc' }, { isFallback: 'asc' }, { priority: 'asc' }],
    });
  }

  /** Providers to use for a capability in a market, in routing order (primary by priority, then approved fallbacks). */
  async selectProviders(
    market: string,
    capability: string,
    opts: { method?: string | null; currency?: string | null; at?: Date } = {},
    db: Db = this.prisma,
  ) {
    const at = opts.at ?? new Date();
    const rows = await db.marketProvider.findMany({
      where: { market, capability, status: 'ACTIVE', effectiveFrom: { lte: at } },
    });
    return rows
      .filter(
        (r) =>
          inRange(r, at) &&
          (!opts.method || !r.method || r.method === opts.method) &&
          (!opts.currency || !r.currency || r.currency === opts.currency),
      )
      .sort((a, b) => Number(a.isFallback) - Number(b.isFallback) || a.priority - b.priority);
  }

  // ---------------------------------------------------------------- validation register (one place for VALIDATE-<market> items)
  async validations(f: {
    market?: string | null;
    status?: string | null;
    visible?: Set<string> | null;
  }) {
    const rows = await this.prisma.marketValidationItem.findMany({
      where: {
        ...(f.market ? { market: f.market.toUpperCase() } : {}),
        ...(f.status ? { status: f.status } : {}),
      },
      orderBy: [{ market: 'asc' }, { code: 'asc' }],
    });
    return f.visible ? rows.filter((r) => f.visible!.has(r.market)) : rows;
  }

  async createValidation(
    actor: Actor,
    market: string,
    b: {
      code: string;
      topic: string;
      description: string;
      product?: string | null;
      ownerUserId?: string | null;
      ownerTeam?: string | null;
      blocksActivation?: boolean;
      reviewDate?: string | null;
      sourceRef?: string | null;
    },
    meta: RequestMeta,
  ) {
    const code = market.toUpperCase();
    await this.markets.assertScope(actor, 'admin.markets.manage', code);
    await this.markets.load(code);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const r = await tx.marketValidationItem.create({
          data: {
            market: code,
            code: b.code.toUpperCase(),
            topic: b.topic,
            description: b.description,
            product: b.product ?? null,
            ownerUserId: b.ownerUserId ?? null,
            ownerTeam: b.ownerTeam ?? null,
            blocksActivation: b.blocksActivation ?? true,
            reviewDate: b.reviewDate ? new Date(b.reviewDate) : null,
            sourceRef: b.sourceRef ?? null,
            createdByUserId: actor.userId,
          },
        });
        await this.audit.record(
          {
            action: 'MARKET_VALIDATION_CREATED',
            entityType: 'MarketValidationItem',
            entityId: r.id,
            actor,
            newState: r,
            scope: MARKET_SCOPE(code),
            meta,
          },
          tx,
        );
        return r;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new AppError(
          'INVALID_STATE',
          'This validation code already exists in the market',
          409,
        );
      throw e;
    }
  }

  /** Progress an item. Closing it (resolved / accepted risk / not applicable) needs a decision and the approve permission. */
  async updateValidation(
    actor: Actor,
    id: string,
    b: {
      status?: string;
      decision?: string | null;
      evidenceRef?: string | null;
      ownerUserId?: string | null;
      ownerTeam?: string | null;
      effectiveDate?: string | null;
      reviewDate?: string | null;
      blocksActivation?: boolean;
    },
    meta: RequestMeta,
  ) {
    const item = await this.prisma.marketValidationItem.findUnique({ where: { id } });
    if (!item) throw AppError.notFound();
    await this.markets.assertScope(actor, 'admin.markets.manage', item.market);
    if (b.status && !(MARKET_VALIDATION_STATUSES as readonly string[]).includes(b.status))
      throw AppError.validation('Unknown status', 'status');
    const closing = b.status && ['RESOLVED', 'ACCEPTED_RISK', 'NOT_APPLICABLE'].includes(b.status);
    if (closing) {
      await this.markets.assertScope(actor, 'admin.markets.approve', item.market);
      if (!(b.decision ?? item.decision))
        throw AppError.validation('Record the decision before closing the item', 'decision');
      if (b.status === 'RESOLVED' && !(b.evidenceRef ?? item.evidenceRef))
        throw AppError.validation(
          'Attach the evidence or reference for the resolution',
          'evidenceRef',
        );
    }
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.marketValidationItem.update({
        where: { id },
        data: {
          ...(b.status ? { status: b.status } : {}),
          ...(b.decision !== undefined ? { decision: b.decision } : {}),
          ...(b.evidenceRef !== undefined ? { evidenceRef: b.evidenceRef } : {}),
          ...(b.ownerUserId !== undefined ? { ownerUserId: b.ownerUserId } : {}),
          ...(b.ownerTeam !== undefined ? { ownerTeam: b.ownerTeam } : {}),
          ...(b.effectiveDate !== undefined
            ? { effectiveDate: b.effectiveDate ? new Date(b.effectiveDate) : null }
            : {}),
          ...(b.reviewDate !== undefined
            ? { reviewDate: b.reviewDate ? new Date(b.reviewDate) : null }
            : {}),
          ...(b.blocksActivation !== undefined ? { blocksActivation: b.blocksActivation } : {}),
          ...(closing ? { approvedByUserId: actor.userId, approvedAt: new Date() } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'MARKET_VALIDATION_UPDATED',
          entityType: 'MarketValidationItem',
          entityId: id,
          actor,
          previousState: { status: item.status, decision: item.decision },
          newState: { status: r.status, decision: r.decision, evidenceRef: r.evidenceRef },
          approvalRef: closing ? actor.userId : null,
          scope: MARKET_SCOPE(item.market),
          meta,
        },
        tx,
      );
      return r;
    });
  }

  private async assertLegalEntity(legalEntityId: string | null, market: string) {
    if (!legalEntityId) return;
    const le = await this.prisma.legalEntity.findUnique({
      where: { id: legalEntityId },
      select: { country: true },
    });
    if (!le) throw AppError.validation('Unknown legal entity', 'legalEntityId');
    if (le.country !== market)
      throw AppError.validation(
        'The legal entity is registered in another market',
        'legalEntityId',
      );
  }
}
