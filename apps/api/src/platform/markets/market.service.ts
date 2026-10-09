import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  MARKET_APPROVAL_REQUIRED,
  MARKET_AVAILABLE_STATUSES,
  MARKET_PRODUCT_STATUSES,
  MARKET_PRODUCTS,
  MARKET_STATUSES,
  MARKET_TRANSITIONS,
  ROUNDING_RULES,
  type MarketStatus,
  type PermissionCode,
} from '@dealdash/types';
import { AuditService } from '../../audit/audit.service';
import { AppError } from '../../common/errors';
import type { Actor, RequestMeta } from '../../common/request-context';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemConfigService } from '../../system-config/system-config.service';
import { ScopeService } from '../scope.service';

type Db = Prisma.TransactionClient | PrismaService;
type MarketRow = Prisma.CountryConfigurationGetPayload<object>;

export interface MarketsConfig {
  availableStatuses: string[];
  defaultMarket: string;
  defaultPricingMarkets: string[];
  campaignLedgerCurrencies: string[];
}

export interface MarketMasterInput {
  nameEn: string;
  nameAr: string;
  regionCode?: string | null;
  isoAlpha3?: string | null;
  currency: string;
  supportedCurrencies?: string[];
  billingCurrency?: string | null;
  settlementCurrency?: string | null;
  taxCurrency?: string | null;
  currencyDecimals?: number;
  roundingRule?: string;
  languages: string[];
  defaultLanguage?: string;
  timezone?: string;
  callingCode?: string | null;
  formatting?: Record<string, unknown>;
  launchDate?: string | null;
  dealdashLegalEntityId?: string | null;
  supportContact?: Record<string, unknown>;
}

const MARKET_SCOPE = (code: string) => `COUNTRY:${code}`;

/**
 * The ONE market master: `CountryConfiguration` extended (no parallel framework). GLOBAL -> REGION (grouping only) -> MARKET. The market
 * drives tax, currency, invoicing, payments, settlement, product availability and launch state. DealDash staff manage it with the
 * existing permissions + scope (a market-scoped administrator holds a COUNTRY grant) and every change is audited under `COUNTRY:<code>`.
 */
@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly scope: ScopeService,
  ) {}

  async settings(): Promise<MarketsConfig> {
    const c = (await this.config.get<Partial<MarketsConfig>>(CONFIG_KEYS.MARKETS)) ?? {};
    return {
      availableStatuses: c.availableStatuses ?? [...MARKET_AVAILABLE_STATUSES],
      defaultMarket: c.defaultMarket ?? 'SA',
      defaultPricingMarkets: c.defaultPricingMarkets ?? ['SA'],
      campaignLedgerCurrencies: c.campaignLedgerCurrencies ?? ['SAR'],
    };
  }

  // ---------------------------------------------------------------- scope (existing role + scope framework)
  /** A market-scoped DealDash administrator (scoped membership with COUNTRY grants) may act only in the markets granted. */
  async assertScope(actor: Actor, permission: PermissionCode, code: string) {
    if (!actor.permissions.has(permission)) throw AppError.forbidden();
    if (!actor.membership?.scoped) return;
    await this.scope.require(actor, permission, {
      organizationId: actor.membership.organizationId,
      country: code,
    });
  }

  /** Markets this actor may see for a permission (null = all). */
  async visibleCodes(actor: Actor, permission: PermissionCode): Promise<Set<string> | null> {
    if (!actor.membership?.scoped) return null;
    const all = await this.prisma.countryConfiguration.findMany({ select: { code: true } });
    const out = new Set<string>();
    for (const m of all)
      if (
        await this.scope.can(actor, permission, {
          organizationId: actor.membership.organizationId,
          country: m.code,
        })
      )
        out.add(m.code);
    return out;
  }

  // ---------------------------------------------------------------- master
  view(r: MarketRow) {
    return {
      code: r.code,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      regionCode: r.regionCode,
      isoAlpha3: r.isoAlpha3,
      status: r.status as MarketStatus,
      enabled: r.enabled,
      currency: r.currency,
      supportedCurrencies: r.supportedCurrencies,
      billingCurrency: r.billingCurrency ?? r.currency,
      settlementCurrency: r.settlementCurrency ?? r.currency,
      taxCurrency: r.taxCurrency ?? r.currency,
      currencyDecimals: r.currencyDecimals,
      roundingRule: r.roundingRule,
      languages: r.languages,
      defaultLanguage: r.defaultLanguage,
      timezone: r.timezone,
      callingCode: r.callingCode,
      formatting: r.formatting as Record<string, unknown>,
      launchDate: r.launchDate?.toISOString() ?? null,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      version: r.version,
      approvalStatus: r.approvalStatus,
      pending: r.pendingStatus
        ? {
            status: r.pendingStatus,
            reason: r.pendingReason,
            requestedByUserId: r.pendingRequestedByUserId,
            requestedAt: r.pendingRequestedAt?.toISOString() ?? null,
          }
        : null,
      createdByUserId: r.createdByUserId,
      approvedByUserId: r.approvedByUserId,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      dealdashLegalEntityId: r.dealdashLegalEntityId,
      supportContact: r.supportContact as Record<string, unknown>,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async load(code: string) {
    const r = await this.prisma.countryConfiguration.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!r) throw AppError.notFound();
    return r;
  }

  listRows() {
    return this.prisma.countryConfiguration.findMany({
      orderBy: [{ regionCode: 'asc' }, { code: 'asc' }],
    });
  }

  async productCounts(code: string): Promise<Record<string, number>> {
    const rows = await this.prisma.marketProduct.groupBy({
      by: ['status'],
      where: { market: code },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((p) => [p.status, p._count._all]));
  }

  async regions() {
    return this.prisma.marketRegion.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
  }

  async upsertRegion(
    actor: Actor,
    b: { code: string; nameEn: string; nameAr: string; sortOrder?: number },
    meta: RequestMeta,
  ) {
    const code = b.code.toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(code))
      throw AppError.validation('Use an upper-case region code', 'code');
    const before = await this.prisma.marketRegion.findUnique({ where: { code } });
    const r = await this.prisma.marketRegion.upsert({
      where: { code },
      update: { nameEn: b.nameEn, nameAr: b.nameAr, sortOrder: b.sortOrder ?? 100 },
      create: { code, nameEn: b.nameEn, nameAr: b.nameAr, sortOrder: b.sortOrder ?? 100 },
    });
    await this.audit.record({
      action: before ? 'MARKET_REGION_UPDATED' : 'MARKET_REGION_CREATED',
      entityType: 'MarketRegion',
      entityId: code,
      actor,
      previousState: before ?? undefined,
      newState: r,
      meta,
    });
    return r;
  }

  private async validateMaster(db: Db, code: string, b: MarketMasterInput) {
    const ccy = (x: string) => /^[A-Z]{3}$/.test(x);
    if (!ccy(b.currency)) throw AppError.validation('Use a three-letter currency code', 'currency');
    const supported = [...new Set([b.currency, ...(b.supportedCurrencies ?? [])])];
    if (!supported.every(ccy))
      throw AppError.validation('Use three-letter currency codes', 'supportedCurrencies');
    for (const [f, v] of [
      ['billingCurrency', b.billingCurrency],
      ['settlementCurrency', b.settlementCurrency],
      ['taxCurrency', b.taxCurrency],
    ] as const)
      if (v && !supported.includes(v))
        throw AppError.validation(`${f} must be one of the market's supported currencies`, f);
    if (b.roundingRule && !(ROUNDING_RULES as readonly string[]).includes(b.roundingRule))
      throw AppError.validation('Unknown rounding rule', 'roundingRule');
    if (b.currencyDecimals !== undefined && (b.currencyDecimals < 0 || b.currencyDecimals > 4))
      throw AppError.validation('Currency decimals are 0 to 4', 'currencyDecimals');
    const lang = b.defaultLanguage ?? b.languages[0];
    if (!lang || !b.languages.includes(lang))
      throw AppError.validation(
        'The default language must be one of the supported languages',
        'defaultLanguage',
      );
    if (b.timezone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: b.timezone });
      } catch {
        throw AppError.validation('Unknown time zone', 'timezone');
      }
    }
    if (b.regionCode && !(await db.marketRegion.findUnique({ where: { code: b.regionCode } })))
      throw AppError.validation('Unknown region', 'regionCode');
    if (b.isoAlpha3 && !/^[A-Z]{3}$/.test(b.isoAlpha3))
      throw AppError.validation('Use the ISO 3166 alpha-3 code', 'isoAlpha3');
    if (b.dealdashLegalEntityId) {
      const le = await db.legalEntity.findUnique({
        where: { id: b.dealdashLegalEntityId },
        include: { accounts: false },
      });
      const org = le
        ? await db.organization.findUnique({
            where: { id: le.organizationId },
            select: { type: true },
          })
        : null;
      if (!le || org?.type !== 'DEALDASH')
        throw AppError.validation('Choose a DealDash legal entity', 'dealdashLegalEntityId');
      if (le.country !== code)
        throw AppError.validation(
          'The DealDash legal entity must be registered in this market',
          'dealdashLegalEntityId',
        );
    }
    return { supported, lang };
  }

  /** Creates a market (PLANNED, every product DISABLED) or updates its master data. The lifecycle is changed separately (gated). */
  async upsert(actor: Actor, rawCode: string, b: MarketMasterInput, meta: RequestMeta) {
    const code = rawCode.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code))
      throw AppError.validation('Use the two-letter ISO country code', 'code');
    await this.assertScope(actor, 'admin.markets.manage', code);
    const before = await this.prisma.countryConfiguration.findUnique({ where: { code } });
    return this.prisma.$transaction(async (tx) => {
      const { supported, lang } = await this.validateMaster(tx, code, b);
      const data = {
        nameEn: b.nameEn,
        nameAr: b.nameAr,
        regionCode: b.regionCode ?? null,
        isoAlpha3: b.isoAlpha3 ?? null,
        currency: b.currency,
        supportedCurrencies: supported,
        billingCurrency: b.billingCurrency ?? null,
        settlementCurrency: b.settlementCurrency ?? null,
        taxCurrency: b.taxCurrency ?? null,
        currencyDecimals: b.currencyDecimals ?? 2,
        roundingRule: b.roundingRule ?? 'HALF_UP',
        languages: b.languages,
        defaultLanguage: lang,
        timezone: b.timezone ?? 'UTC',
        callingCode: b.callingCode ?? null,
        formatting: (b.formatting ?? { numerals: 'WESTERN' }) as Prisma.InputJsonValue,
        launchDate: b.launchDate ? new Date(b.launchDate) : null,
        dealdashLegalEntityId: b.dealdashLegalEntityId ?? null,
        supportContact: (b.supportContact ?? {}) as Prisma.InputJsonValue,
      };
      const row = before
        ? await tx.countryConfiguration.update({
            where: { code },
            data: { ...data, version: { increment: 1 } },
          })
        : await tx.countryConfiguration.create({
            data: {
              code,
              ...data,
              status: 'PLANNED',
              enabled: false,
              createdByUserId: actor.userId,
            },
          });
      if (!before) await this.ensureProducts(tx, code, 'DISABLED');
      await this.audit.record(
        {
          action: before ? 'MARKET_UPDATED' : 'MARKET_CREATED',
          entityType: 'CountryConfiguration',
          entityId: code,
          actor,
          previousState: before ? this.view(before) : undefined,
          newState: this.view(row),
          scope: MARKET_SCOPE(code),
          meta,
        },
        tx,
      );
      return this.view(row);
    });
  }

  async ensureProducts(db: Db, code: string, status: string) {
    await db.marketProduct.createMany({
      data: MARKET_PRODUCTS.map((product) => ({ market: code, product, status })),
      skipDuplicates: true,
    });
  }

  // ---------------------------------------------------------------- lifecycle (activation gate + maker-checker)
  /**
   * Moves a market along its lifecycle. Moving to PILOT or ACTIVE runs the activation gate (passed in by the caller) and waits for a second
   * approver; other moves (configuring, testing, suspending, closing) take effect at once. Nothing is silently activated.
   */
  async requestTransition(
    actor: Actor,
    code: string,
    to: MarketStatus,
    reason: string,
    gate: (to: MarketStatus) => Promise<void>,
    meta: RequestMeta,
  ) {
    await this.assertScope(actor, 'admin.markets.manage', code);
    const m = await this.load(code);
    if (!(MARKET_STATUSES as readonly string[]).includes(to))
      throw AppError.validation('Unknown market status', 'status');
    const from = m.status as MarketStatus;
    if (!MARKET_TRANSITIONS[from].includes(to))
      throw new AppError('MARKET_TRANSITION_INVALID', `A ${from} market cannot move to ${to}`, 409);
    if (m.pendingStatus)
      throw new AppError(
        'MARKET_TRANSITION_INVALID',
        'Another status change is waiting for approval',
        409,
      );
    await gate(to);
    if (MARKET_APPROVAL_REQUIRED.includes(to)) {
      await this.prisma.$transaction(async (tx) => {
        await tx.countryConfiguration.update({
          where: { code: m.code },
          data: {
            approvalStatus: 'PENDING',
            pendingStatus: to,
            pendingReason: reason,
            pendingRequestedByUserId: actor.userId,
            pendingRequestedAt: new Date(),
          },
        });
        await this.audit.record(
          {
            action: 'MARKET_STATUS_REQUESTED',
            entityType: 'CountryConfiguration',
            entityId: m.code,
            actor,
            previousState: { status: from },
            newState: { status: to, pending: true },
            reason,
            scope: MARKET_SCOPE(m.code),
            meta,
          },
          tx,
        );
      });
      return this.view(await this.load(code));
    }
    return this.apply(actor, m, to, reason, null, meta);
  }

  async decideTransition(
    actor: Actor,
    code: string,
    approve: boolean,
    reason: string | null,
    gate: (to: MarketStatus) => Promise<void>,
    meta: RequestMeta,
  ) {
    await this.assertScope(actor, 'admin.markets.approve', code);
    const m = await this.load(code);
    if (!m.pendingStatus)
      throw new AppError(
        'MARKET_TRANSITION_INVALID',
        'No status change is waiting for approval',
        409,
      );
    if (m.pendingRequestedByUserId === actor.userId)
      throw new AppError(
        'APPROVAL_REQUIRED',
        'A different administrator must approve this market status change',
        403,
      );
    if (!approve) {
      await this.prisma.$transaction(async (tx) => {
        await tx.countryConfiguration.update({
          where: { code: m.code },
          data: {
            approvalStatus: 'APPROVED',
            pendingStatus: null,
            pendingReason: null,
            pendingRequestedByUserId: null,
            pendingRequestedAt: null,
          },
        });
        await this.audit.record(
          {
            action: 'MARKET_STATUS_REJECTED',
            entityType: 'CountryConfiguration',
            entityId: m.code,
            actor,
            newState: { rejected: m.pendingStatus },
            reason: reason ?? undefined,
            scope: MARKET_SCOPE(m.code),
            meta,
          },
          tx,
        );
      });
      return this.view(await this.load(code));
    }
    const to = m.pendingStatus as MarketStatus;
    // the gate is checked again at approval time: configuration may have changed in between
    await gate(to);
    return this.apply(
      actor,
      m,
      to,
      m.pendingReason ?? reason ?? '',
      m.pendingRequestedByUserId,
      meta,
    );
  }

  private async apply(
    actor: Actor,
    m: MarketRow,
    to: MarketStatus,
    reason: string,
    requestedBy: string | null,
    meta: RequestMeta,
  ) {
    const now = new Date();
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.countryConfiguration.update({
        where: { code: m.code },
        data: {
          status: to,
          // the legacy flag stays consistent with the lifecycle: visible / commercially open only in PILOT or ACTIVE
          enabled: to === 'PILOT' || to === 'ACTIVE',
          approvalStatus: 'APPROVED',
          pendingStatus: null,
          pendingReason: null,
          pendingRequestedByUserId: null,
          pendingRequestedAt: null,
          version: { increment: 1 },
          ...(requestedBy ? { approvedByUserId: actor.userId, approvedAt: now } : {}),
          ...((to === 'PILOT' || to === 'ACTIVE') && !m.launchDate ? { launchDate: now } : {}),
          ...(to === 'CLOSED' ? { effectiveTo: now } : {}),
        },
      });
      await this.audit.record(
        {
          action: 'MARKET_STATUS_CHANGED',
          entityType: 'CountryConfiguration',
          entityId: m.code,
          actor,
          previousState: { status: m.status },
          newState: { status: to, requestedBy },
          reason,
          approvalRef: requestedBy ? actor.userId : null,
          scope: MARKET_SCOPE(m.code),
          meta,
        },
        tx,
      );
      return r;
    });
    return this.view(row);
  }

  // ---------------------------------------------------------------- product availability
  async products(code: string) {
    await this.load(code);
    return this.prisma.marketProduct.findMany({
      where: { market: code.toUpperCase() },
      orderBy: { product: 'asc' },
    });
  }

  async setProduct(
    actor: Actor,
    code: string,
    product: string,
    status: string,
    notes: string | null,
    meta: RequestMeta,
  ) {
    await this.assertScope(actor, 'admin.markets.manage', code);
    const m = await this.load(code);
    if (!(MARKET_PRODUCTS as readonly string[]).includes(product))
      throw AppError.validation('Unknown product', 'product');
    if (!(MARKET_PRODUCT_STATUSES as readonly string[]).includes(status))
      throw AppError.validation('Unknown product status', 'status');
    // a product cannot be more open than its market
    const open = ['PILOT', 'ACTIVE'];
    if (open.includes(status) && !['TESTING', 'PILOT', 'ACTIVE'].includes(m.status))
      throw new AppError(
        'MARKET_TRANSITION_INVALID',
        `Products can be piloted or activated only when the market is TESTING, PILOT or ACTIVE (it is ${m.status})`,
        409,
      );
    if (status === 'ACTIVE' && m.status !== 'ACTIVE')
      throw new AppError(
        'MARKET_TRANSITION_INVALID',
        'A product can be ACTIVE only in an ACTIVE market (use PILOT)',
        409,
      );
    const before = await this.prisma.marketProduct.findUnique({
      where: { market_product: { market: m.code, product } },
    });
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.marketProduct.upsert({
        where: { market_product: { market: m.code, product } },
        update: { status, notes, updatedByUserId: actor.userId, effectiveFrom: new Date() },
        create: { market: m.code, product, status, notes, updatedByUserId: actor.userId },
      });
      await this.audit.record(
        {
          action: 'MARKET_PRODUCT_CHANGED',
          entityType: 'MarketProduct',
          entityId: r.id,
          actor,
          previousState: before ? { status: before.status } : undefined,
          newState: { product, status },
          reason: notes ?? undefined,
          scope: MARKET_SCOPE(m.code),
          meta,
        },
        tx,
      );
      return r;
    });
    return row;
  }

  // ---------------------------------------------------------------- which market applies (never another country's by accident)
  /**
   * The market of a business: an explicit market, else the legal entity's country, else its in-force contract's market, else its first
   * legal entity's country, else the configured default market (a business with no legal entity yet).
   */
  async resolveMarket(
    organizationId: string,
    opts: { market?: string | null; legalEntityId?: string | null; at?: Date } = {},
    db: Db = this.prisma,
  ): Promise<string> {
    if (opts.market) return opts.market.toUpperCase();
    if (opts.legalEntityId) {
      const le = await db.legalEntity.findFirst({
        where: { id: opts.legalEntityId, organizationId },
        select: { country: true },
      });
      if (le) return le.country;
    }
    const at = opts.at ?? new Date();
    const c = await db.contract.findFirst({
      where: {
        organizationId,
        market: { not: null },
        status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'] },
        effectiveFrom: { lte: at },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
      select: { market: true },
    });
    if (c?.market) return c.market;
    const le = await db.legalEntity.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { country: true },
    });
    if (le) return le.country;
    return (await this.settings()).defaultMarket;
  }

  /**
   * The market of a campaign: the country of the branches it runs at (a campaign can never span markets), else the business's market.
   */
  async marketOfCampaign(
    organizationId: string,
    content: unknown,
    db: Db = this.prisma,
  ): Promise<string> {
    const c = (content ?? {}) as {
      branchIds?: unknown;
      allocations?: Array<{ branchId?: string }>;
    };
    const ids = [
      ...(Array.isArray(c.branchIds) ? (c.branchIds as string[]) : []),
      ...(Array.isArray(c.allocations)
        ? c.allocations.map((a) => a.branchId).filter((x): x is string => !!x)
        : []),
    ];
    if (ids.length) {
      const rows = await db.merchantBranch.findMany({
        where: { id: { in: ids }, organizationId },
        select: { country: true },
      });
      const countries = [...new Set(rows.map((r) => r.country).filter(Boolean))];
      if (countries.length > 1)
        throw new AppError(
          'MARKET_CONFIG_INVALID',
          'A campaign cannot run in more than one market: create one campaign per country',
          422,
        );
      if (countries.length === 1) return countries[0]!;
    }
    return this.resolveMarket(organizationId, {}, db);
  }

  /** Is the product open for new business in this market (market AND product in an available status)? */
  async isAvailable(market: string, product: string, db: Db = this.prisma) {
    const s = await this.settings();
    const m = await db.countryConfiguration.findUnique({
      where: { code: market },
      select: { status: true },
    });
    if (!m || !s.availableStatuses.includes(m.status))
      return {
        ok: false as const,
        reason: 'MARKET' as const,
        marketStatus: m?.status ?? null,
        productStatus: null,
      };
    const p = await db.marketProduct.findUnique({
      where: { market_product: { market, product } },
      select: { status: true },
    });
    if (!p || !s.availableStatuses.includes(p.status))
      return {
        ok: false as const,
        reason: 'PRODUCT' as const,
        marketStatus: m.status,
        productStatus: p?.status ?? null,
      };
    return { ok: true as const, reason: null, marketStatus: m.status, productStatus: p.status };
  }

  /** New campaigns / exposure only where the market and the product are open. Issued customer rights are never routed through here. */
  async requireAvailable(
    organizationId: string,
    product: string,
    opts: { market?: string | null; legalEntityId?: string | null } = {},
  ) {
    const market = await this.resolveMarket(organizationId, opts);
    const a = await this.isAvailable(market, product);
    if (!a.ok)
      throw new AppError(
        'MARKET_PRODUCT_UNAVAILABLE',
        a.reason === 'MARKET'
          ? `DealDash is not open in ${market} yet`
          : `${product} is not available in ${market}`,
        403,
      );
    return market;
  }

  /** Markets a business operates in, with what is open there (Stage 7 partner screens consume the same view). */
  async forOrganization(organizationId: string) {
    const les = await this.prisma.legalEntity.findMany({
      where: { organizationId },
      select: { id: true, legalName: true, country: true, currency: true },
    });
    const codes = [
      ...new Set([...les.map((l) => l.country), await this.resolveMarket(organizationId)]),
    ];
    const s = await this.settings();
    const markets = await this.prisma.countryConfiguration.findMany({
      where: { code: { in: codes } },
    });
    const products = await this.prisma.marketProduct.findMany({ where: { market: { in: codes } } });
    return markets.map((m) => ({
      code: m.code,
      nameEn: m.nameEn,
      nameAr: m.nameAr,
      status: m.status,
      currency: m.currency,
      supportedCurrencies: m.supportedCurrencies,
      timezone: m.timezone,
      open: s.availableStatuses.includes(m.status),
      legalEntities: les
        .filter((l) => l.country === m.code)
        .map((l) => ({ id: l.id, legalName: l.legalName, currency: l.currency })),
      products: products
        .filter((p) => p.market === m.code)
        .map((p) => ({
          product: p.product,
          status: p.status,
          available:
            s.availableStatuses.includes(m.status) && s.availableStatuses.includes(p.status),
        })),
    }));
  }

  // ---------------------------------------------------------------- audit history
  async history(code: string, take = 200) {
    return this.prisma.auditLog.findMany({
      where: { scope: MARKET_SCOPE(code.toUpperCase()) },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(take, 500),
    });
  }
}

export { MARKET_SCOPE };
