import { Injectable, Optional } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  ENTITLEMENT_PRODUCT_OF,
  ACCEPTANCE_TEXT_VERSION,
  type AcceptanceCheck,
  type ApprovalStep,
  type CommercialProduct,
  type PartyRole,
  type PermissionCode,
  type UnusedTreatment,
} from '@dealdash/types';
import type {
  ActivationBlocker,
  CommercialCaseView,
  CommercialPreview,
} from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { TenantService } from '../identity/tenant.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../vouchers/ledger.service';
import { CommercialRegistry } from './commercial.registry';
import { CampaignVersionService } from '../platform/campaign-version.service';
import { EntitlementService } from '../platform/entitlement.service';
import { BillingEventService } from '../subscription/billing-event.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PricingService, type ResolvedPricing } from './pricing.service';
import { MarketService } from '../platform/markets/market.service';
import {
  amendmentDelta,
  calculateQuote,
  economicsHash,
  type Economics,
  type QuoteLine,
  type QuoteTotals,
} from './quote.calculator';

type Tx = Prisma.TransactionClient;
const CASH_TRIGGER_EVENT = 'VERIFIED_REDEMPTION';

interface RequiredParty {
  role: PartyRole;
  organizationId: string;
  requiredChecks: AcceptanceCheck[];
}
interface FundingReq {
  organizationId: string;
  role: PartyRole;
  kind: 'CHARGE' | 'SPONSOR_FUNDING';
  mode: 'PREPAID' | 'CREDIT';
  upfrontHalalas: number;
  usageMaxHalalas: number;
  perUnitHalalas: number;
  managed: boolean;
  maxHalalas: number;
}

/**
 * Shared Commercial Governance & Finance platform: calculates the economics of a campaign, records who has to accept what, keeps
 * every accepted version permanently, gates activation, tracks funding and verified utilisation through the ledger, and
 * reconciles at closure. Product rules live in the product adapters; nothing here is product specific.
 */
@Injectable()
export class CommercialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly registry: CommercialRegistry,
    private readonly pricing: PricingService,
    private readonly tenant: TenantService,
    private readonly entitlements: EntitlementService,
    private readonly versions: CampaignVersionService,
    // optional so the development fixtures (which build this service by hand) keep working without the subscription engine
    @Optional() private readonly systemConfig?: SystemConfigService,
    @Optional() private readonly billingEvents?: BillingEventService,
    @Optional() private readonly markets?: MarketService,
  ) {}

  // ---------------------------------------------------------------- numbering (statutory formats are configuration / VALIDATE-KSA)
  async nextNumber(tx: Tx, key: string, prefix: string): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ value: number }>>(Prisma.sql`
      INSERT INTO "FinanceSequence" ("key", "value") VALUES (${key}, 1)
      ON CONFLICT ("key") DO UPDATE SET "value" = "FinanceSequence"."value" + 1
      RETURNING "value"`);
    return `${prefix}-${String(rows[0]!.value).padStart(6, '0')}`;
  }

  // ---------------------------------------------------------------- accounts
  /** The organization's DEFAULT billing account in SAR (other legal entities can hold their own accounts: Phase 5). */
  async accountOf(tx: Tx | PrismaService, organizationId: string) {
    const found = await tx.businessAccount.findFirst({
      where: { organizationId, currency: 'SAR', isDefault: true },
    });
    if (found) return found;
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { merchant: { select: { legalName: true } } },
    });
    const legalName = org.merchant?.legalName ?? org.nameEn;
    const entity = await tx.legalEntity.upsert({
      where: { organizationId_legalName: { organizationId, legalName } },
      update: {},
      create: { organizationId, legalName },
    });
    try {
      return await tx.businessAccount.create({
        data: { organizationId, legalEntityId: entity.id, currency: 'SAR' },
      });
    } catch {
      return tx.businessAccount.findFirstOrThrow({
        where: { organizationId, currency: 'SAR', isDefault: true },
      });
    }
  }

  /** Active, unexpired credit facility and its remaining headroom (exposure is computed, never stored). */
  async creditPosition(organizationId: string, now = new Date()) {
    const f = await this.prisma.creditFacility.findFirst({
      where: { organizationId, status: 'ACTIVE', expiresAt: { gt: now } },
    });
    const exposure = await this.creditExposure(organizationId);
    return {
      facility: f,
      exposureHalalas: exposure,
      availableHalalas: f ? Math.max(0, f.limitHalalas - exposure) : 0,
    };
  }

  async creditExposure(organizationId: string): Promise<number> {
    const rows = await this.prisma.fundingCommitment.findMany({
      where: { organizationId, mode: 'CREDIT' },
      select: {
        status: true,
        upfrontHalalas: true,
        usageMaxHalalas: true,
        receivedHalalas: true,
        utilizedHalalas: true,
        upfrontEarnedHalalas: true,
      },
    });
    const commitments = rows.reduce(
      (n, c) =>
        n +
        (c.status === 'OPEN'
          ? Math.max(0, c.upfrontHalalas + c.usageMaxHalalas - c.receivedHalalas)
          : Math.max(0, c.utilizedHalalas + c.upfrontEarnedHalalas - c.receivedHalalas)),
      0,
    );
    // plus open receivables billed outside campaign cases (subscriptions, licences, fees): unpaid invoices use credit too
    const ar = await this.prisma.financeDocument.aggregate({
      where: {
        organizationId,
        currency: 'SAR',
        type: { in: ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE'] },
        sourceKind: { in: ['BILLING_RUN', 'MANUAL'] },
        status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE', 'DISPUTED'] },
      },
      _sum: { totalHalalas: true, paidHalalas: true },
    });
    return commitments + Math.max(0, (ar._sum.totalHalalas ?? 0) - (ar._sum.paidHalalas ?? 0));
  }

  // ---------------------------------------------------------------- calculation
  private checksFor(role: PartyRole, t: QuoteTotals, ownerIsFulfilment: boolean): AcceptanceCheck[] {
    const c = new Set<AcceptanceCheck>(['REVIEWED_TERMS']);
    const benefit = t.maxMerchantBenefitCommitmentHalalas > 0 || t.customerBenefitTotalHalalas > 0;
    if (role === 'SPONSOR') c.add('CONFIRM_FUNDING');
    else {
      if (role === 'OWNER' && (t.dealdashChargesHalalas > 0 || t.taxHalalas > 0)) c.add('UNDERSTAND_CHARGES');
      if (role === 'OWNER' && (t.merchantCashContributionHalalas > 0 || t.maxCashPayableToDealDashHalalas > 0))
        c.add('CONFIRM_FUNDING');
      if (role === 'FULFILMENT_MERCHANT' || ownerIsFulfilment) {
        if (benefit) c.add('CONFIRM_BENEFIT');
        if (t.maxUnits > 0) {
          c.add('CONFIRM_INVENTORY');
          c.add('HONOUR_REDEMPTIONS');
        }
      }
    }
    c.add('ACCEPT_TERMS');
    return [...c];
  }

  private partiesOf(e: Economics, lines: QuoteLine[], t: QuoteTotals): RequiredParty[] {
    const ownerIsFulfilment = e.ownerOrganizationId === e.fulfilmentOrganizationId;
    const parties: RequiredParty[] = [
      {
        role: 'OWNER',
        organizationId: e.ownerOrganizationId,
        requiredChecks: this.checksFor('OWNER', t, ownerIsFulfilment),
      },
    ];
    if (!ownerIsFulfilment)
      parties.push({
        role: 'FULFILMENT_MERCHANT',
        organizationId: e.fulfilmentOrganizationId,
        requiredChecks: this.checksFor('FULFILMENT_MERCHANT', t, false),
      });
    const sponsorOrgs = new Set(
      lines.filter((l) => l.kind === 'SPONSOR_FUNDING' && l.amountHalalas > 0).map((l) => l.partyOrganizationId!),
    );
    for (const org of sponsorOrgs)
      if (org !== e.ownerOrganizationId && org !== e.fulfilmentOrganizationId)
        parties.push({ role: 'SPONSOR', organizationId: org, requiredChecks: this.checksFor('SPONSOR', t, false) });
    return parties;
  }

  private async fundingOf(
    e: Economics,
    lines: QuoteLine[],
    t: QuoteTotals,
    adapterManaged: boolean,
    mediaKind: 'CHARGE' | 'SPONSOR_FUNDING' = 'CHARGE',
  ): Promise<FundingReq[]> {
    const out: FundingReq[] = [];
    const ownerCash = lines.filter(
      (l) => l.kind === 'DEALDASH_CHARGE' && l.collection === 'CASH' && l.code !== 'media_spend',
    );
    const upfront = ownerCash.filter((l) => l.trigger === 'UPFRONT').reduce((n, l) => n + l.amountHalalas, 0) + t.taxHalalas;
    const perEvent = ownerCash.filter((l) => l.trigger !== 'UPFRONT');
    const usage = perEvent.reduce((n, l) => n + l.amountHalalas, 0);
    const perUnit = perEvent.reduce((n, l) => n + l.unitHalalas, 0);
    if (upfront + usage > 0)
      out.push({
        organizationId: e.ownerOrganizationId,
        role: 'OWNER',
        kind: 'CHARGE',
        mode: 'PREPAID',
        upfrontHalalas: upfront,
        usageMaxHalalas: usage,
        perUnitHalalas: perUnit,
        managed: false,
        maxHalalas: upfront + usage,
      });
    const media = lines.find((l) => l.code === 'media_spend');
    if (media && media.amountHalalas > 0)
      out.push({
        organizationId: e.ownerOrganizationId,
        role: 'OWNER',
        kind: mediaKind,
        mode: 'PREPAID',
        upfrontHalalas: 0,
        usageMaxHalalas: media.amountHalalas,
        perUnitHalalas: media.unitHalalas,
        managed: adapterManaged,
        maxHalalas: media.amountHalalas,
      });
    for (const s of lines.filter((l) => l.kind === 'SPONSOR_FUNDING' && l.amountHalalas > 0))
      out.push({
        organizationId: s.partyOrganizationId!,
        role: 'SPONSOR',
        kind: 'SPONSOR_FUNDING',
        mode: 'PREPAID',
        upfrontHalalas: 0,
        usageMaxHalalas: s.amountHalalas,
        perUnitHalalas: s.unitHalalas,
        managed: false,
        maxHalalas: s.amountHalalas,
      });
    // credit applies when the business has an approved facility with room for the whole maximum (never partially)
    for (const f of out) {
      if (f.managed) continue;
      const pos = await this.creditPosition(f.organizationId);
      const account = await this.accountOf(this.prisma, f.organizationId);
      if (account.fundingMode === 'CREDIT' && pos.facility && pos.availableHalalas >= f.maxHalalas) f.mode = 'CREDIT';
    }
    return out;
  }

  /** The numbers a business sees BEFORE it submits: derived server-side from the builder's current content. */
  async preview(
    product: CommercialProduct,
    organizationId: string,
    content: unknown,
    subjectId: string | null,
    override?: Partial<Economics>,
  ): Promise<CommercialPreview & { hash: string; economics: Economics; pricingRaw: ResolvedPricing; market: string | null }> {
    const adapter = this.registry.get(product);
    const economics = { ...(await adapter.economics(organizationId, content, subjectId)), ...(override ?? {}) };
    // the campaign's market (its branches' country, else the business's market) decides pricing and tax; never another country's
    const market = this.markets ? await this.markets.marketOfCampaign(economics.ownerOrganizationId, content) : null;
    const pricing = await this.pricing.resolve(economics.ownerOrganizationId, product, new Date(), market);
    if (this.markets) {
      const ledger = (await this.markets.settings()).campaignLedgerCurrencies;
      if (!ledger.includes(pricing.currency))
        throw new AppError('MARKET_CURRENCY_NOT_SUPPORTED', `Campaign funding in ${pricing.currency} is not supported yet (the campaign ledger supports ${ledger.join(', ')})`, 409);
    }
    const { lines, totals } = calculateQuote(economics, pricing);
    const funding = await this.fundingOf(economics, lines, totals, Boolean(adapter.managedFunding), adapter.fundingKind);
    const workflow = await this.pricing.workflow(
      economics.ownerOrganizationId,
      product,
      totals.maxCashPayableToDealDashHalalas + totals.maxSponsorLiabilityHalalas,
    );
    return {
      lines,
      totals,
      pricing: {
        source: pricing.source,
        reference: pricing.reference,
        versionKey: pricing.versionKey,
        unusedTreatment: pricing.unusedTreatment,
      },
      parties: this.partiesOf(economics, lines, totals),
      fundingRequirements: funding.map((f) => ({
        organizationId: f.organizationId,
        role: f.role,
        mode: f.mode,
        upfrontHalalas: f.upfrontHalalas,
        usageMaxHalalas: f.usageMaxHalalas,
        maxHalalas: f.maxHalalas,
      })),
      workflow,
      hash: economicsHash(economics, pricing.versionKey),
      economics,
      pricingRaw: pricing,
      market,
    };
  }

  // ---------------------------------------------------------------- quotations
  /**
   * Creates (or refreshes) the case and its current quotation from the stored campaign. Any change to the economics produces a
   * new quotation version that must be accepted again; an earlier acceptance is kept as a permanent record.
   */
  async syncQuotation(
    product: CommercialProduct,
    subjectId: string,
    actor: Actor | null = null,
    override?: Partial<Economics>,
  ) {
    const adapter = this.registry.get(product);
    const subject = await adapter.load(subjectId);
    const p = await this.preview(product, subject.organizationId, subject.content, subjectId, override);
    const existing = await this.prisma.commercialCase.findUnique({
      where: { product_subjectId: { product, subjectId } },
    });
    const current = existing?.currentQuotationId
      ? await this.prisma.quotation.findUnique({ where: { id: existing.currentQuotationId } })
      : null;
    // an expired, rejected or modification-requested quotation is never reused: the same economics are re-quoted as a new version
    const reusable = current && !['EXPIRED', 'REJECTED', 'MODIFICATION_REQUESTED'].includes(current.status) && !(current.status === 'PENDING_ACCEPTANCE' && current.validUntil && current.validUntil <= new Date());
    if (existing && current && reusable && (current.inputs as { hash?: string }).hash === p.hash)
      return { caseId: existing.id, quotationId: current.id, created: false };
    const accepted = existing?.acceptedQuotationId
      ? await this.prisma.quotation.findUnique({ where: { id: existing.acceptedQuotationId } })
      : null;
    const e = p.economics;
    const nonDraft = subject.status !== 'DRAFT' && subject.status !== 'NEEDS_CHANGES';
    // Once live, a change that does not raise any commitment needs no new acceptance; a pending amendment stays until decided.
    if (existing && accepted && nonDraft && !override && existing.currentQuotationId) {
      const d = amendmentDelta(accepted.totals as unknown as QuoteTotals, p.totals);
      if (!d.increasesExposure) return { caseId: existing.id, quotationId: existing.currentQuotationId, created: false };
    }
    // the campaign keeps the contract in force and what it is billed on, so billing is never inferred later from dashboard totals
    const billing = this.systemConfig
      ? ((await this.systemConfig.get<Record<string, { trigger: string; model: string }>>(CONFIG_KEYS.COMMERCIAL_CAMPAIGN_BILLING)) ?? {})[product]
      : undefined;
    const contractId = existing?.contractId ?? (await this.entitlements.effective(e.ownerOrganizationId)).contractId;
    const validityDays = this.systemConfig ? ((await this.systemConfig.get<{ quotationValidityDays?: number }>(CONFIG_KEYS.FINANCE_BILLING))?.quotationValidityDays ?? 14) : 14;
    return this.prisma.$transaction(async (tx) => {
      const c =
        existing ??
        (await tx.commercialCase.create({
          data: {
            reference: await this.nextNumber(tx, 'case', 'CC'),
            product,
            subjectId,
            ownerOrganizationId: e.ownerOrganizationId,
            fulfilmentOrganizationId: e.fulfilmentOrganizationId,
            createdByUserId: actor?.userId ?? subject.organizationId,
            contractId,
            billingTrigger: billing?.trigger ?? null,
            billingModel: billing?.model ?? null,
            market: p.market,
          },
        }));
      const version = (current?.version ?? 0) + 1;
      // The accepted commitments stay in force until the amended version is accepted (live campaigns); a draft is replaced.
      const keepAccepted = Boolean(accepted) && subject.status !== 'DRAFT' && subject.status !== 'NEEDS_CHANGES';
      if (current && (current.status === 'PENDING_ACCEPTANCE' || current.status === 'DRAFT'))
        await tx.quotation.update({ where: { id: current.id }, data: { status: 'SUPERSEDED', supersededAt: new Date() } });
      const q = await tx.quotation.create({
        data: {
          caseId: c.id,
          version,
          reference: await this.nextNumber(tx, 'quote', 'QT'),
          status: 'PENDING_ACCEPTANCE',
          validUntil: new Date(Date.now() + validityDays * 86_400_000),
          inputs: { hash: p.hash, economics: e } as unknown as Prisma.InputJsonValue,
          lines: p.lines as unknown as Prisma.InputJsonValue,
          totals: p.totals as unknown as Prisma.InputJsonValue,
          pricingVersionId: p.pricingRaw.versionId,
          pricingSnapshot: {
            versionKey: p.pricing.versionKey,
            source: p.pricing.source,
            reference: p.pricing.reference,
            components: p.pricingRaw.components,
            taxBps: p.pricingRaw.taxBps,
            market: p.market,
            taxRuleId: p.pricingRaw.taxRuleId ?? null,
            taxRuleVersion: p.pricingRaw.taxRuleVersion ?? null,
            workflow: p.workflow,
            fundingRequirements: p.fundingRequirements,
          } as unknown as Prisma.InputJsonValue,
          unusedTreatment: p.pricing.unusedTreatment,
          requiredParties: p.parties as unknown as Prisma.InputJsonValue,
          delta: keepAccepted
            ? (amendmentDelta(accepted!.totals as unknown as QuoteTotals, p.totals) as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          createdByUserId: actor?.userId ?? c.createdByUserId,
          createdByName: actor?.displayName ?? null,
        },
      });
      await tx.commercialCase.update({
        where: { id: c.id },
        data: {
          currentQuotationId: q.id,
          ownerOrganizationId: e.ownerOrganizationId,
          fulfilmentOrganizationId: e.fulfilmentOrganizationId,
          market: p.market,
          maxCashHalalas: p.totals.maxCashPayableToDealDashHalalas + p.totals.maxSponsorLiabilityHalalas,
          benefitCommitmentHalalas: p.totals.maxMerchantBenefitCommitmentHalalas,
          ...(keepAccepted ? {} : { acceptedQuotationId: null, status: 'AWAITING_ACCEPTANCE' as const }),
          unusedTreatment: keepAccepted ? undefined : p.pricing.unusedTreatment,
        },
      });
      await this.audit.record(
        {
          action: keepAccepted ? 'COMMERCIAL_AMENDMENT_REQUESTED' : 'COMMERCIAL_QUOTATION_CREATED',
          entityType: 'CommercialCase',
          entityId: c.id,
          actor,
          subjectOrganizationId: e.ownerOrganizationId,
          newState: { quotation: q.reference, version, totals: p.totals },
        },
        tx,
      );
      return { caseId: c.id, quotationId: q.id, created: true };
    });
  }

  // ---------------------------------------------------------------- quotation decisions other than acceptance
  /** A pending quotation past its validity lapses (EXPIRED); the next sync re-quotes. Returns whether it changed. */
  async expireQuotation(id: string): Promise<boolean> {
    const r = await this.prisma.quotation.updateMany({ where: { id, status: 'PENDING_ACCEPTANCE', validUntil: { lte: new Date() } }, data: { status: 'EXPIRED' } });
    if (r.count) await this.audit.record({ action: 'COMMERCIAL_QUOTATION_EXPIRED', entityType: 'Quotation', entityId: id, actor: null, source: 'SYSTEM' });
    return r.count > 0;
  }

  /** Scheduled pass: expires every lapsed pending quotation. */
  async expireDueQuotations(now = new Date()) {
    const due = await this.prisma.quotation.findMany({ where: { status: 'PENDING_ACCEPTANCE', validUntil: { lte: now } }, select: { id: true }, take: 500 });
    let n = 0;
    for (const q of due) if (await this.expireQuotation(q.id)) n++;
    return n;
  }

  /**
   * A required party rejects the quotation or asks for a modification. Nothing is committed; the campaign cannot activate until a
   * new version is accepted. The decision and the reason are kept on the quotation and in the audit trail.
   */
  /** The calling business (merchant or, since Stage 7, partner) and its permission prefix. Own organization only (404 otherwise). */
  private businessOf(actor: Actor): { organizationId: string; prefix: 'merchant' | 'partner' } {
    const type = actor.membership?.organizationType === 'PARTNER' ? 'PARTNER' : 'MERCHANT';
    const organizationId = this.tenant.requireOwnOrganization(actor, actor.membership?.organizationId ?? '', type);
    return { organizationId, prefix: type === 'PARTNER' ? 'partner' : 'merchant' };
  }

  async decline(actor: Actor, organizationId: string, caseId: string, quotationId: string, decision: 'REJECT' | 'REQUEST_MODIFICATION', reason: string, meta: RequestMeta) {
    const q = await this.prisma.quotation.findFirst({ where: { id: quotationId, caseId } });
    if (!q) throw AppError.notFound();
    const parties = await this.requiredParties(q);
    if (!parties.some((p) => p.organizationId === organizationId)) throw AppError.notFound();
    if (q.status !== 'PENDING_ACCEPTANCE') throw new AppError('INVALID_STATE', 'Only a quotation waiting for acceptance can be declined', 409);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.quotation.updateMany({
        where: { id: q.id, status: 'PENDING_ACCEPTANCE' },
        data: decision === 'REJECT' ? { status: 'REJECTED', rejectedAt: now, rejectedByUserId: actor.userId, rejectionReason: reason } : { status: 'MODIFICATION_REQUESTED', modificationRequestedAt: now, modificationRequest: reason },
      });
      if (r.count !== 1) throw new AppError('INVALID_STATE', 'This quotation changed meanwhile', 409);
      await this.audit.record({ action: decision === 'REJECT' ? 'COMMERCIAL_QUOTATION_REJECTED' : 'COMMERCIAL_MODIFICATION_REQUESTED', entityType: 'CommercialCase', entityId: caseId, actor, subjectOrganizationId: organizationId, newState: { quotation: q.reference }, reason, meta }, tx);
    });
  }

  // ---------------------------------------------------------------- acceptance
  private async requiredParties(q: { requiredParties: Prisma.JsonValue }): Promise<RequiredParty[]> {
    return (q.requiredParties as unknown as RequiredParty[]) ?? [];
  }

  /** The role an organisation plays on a quotation (null = not a party). */
  private roleOf(parties: RequiredParty[], organizationId: string): PartyRole | null {
    return parties.find((p) => p.organizationId === organizationId)?.role ?? null;
  }

  async accept(
    actor: Actor,
    caseId: string,
    quotationId: string,
    checks: AcceptanceCheck[],
    language: 'en' | 'ar',
    meta: RequestMeta,
    on?: { organizationId: string; authorizationId: string; role: PartyRole },
  ) {
    const c = await this.prisma.commercialCase.findUnique({ where: { id: caseId } });
    if (!c) throw AppError.notFound();
    const q = await this.prisma.quotation.findFirst({ where: { id: quotationId, caseId } });
    if (!q) throw AppError.notFound();
    if (q.status !== 'PENDING_ACCEPTANCE' || c.currentQuotationId !== q.id)
      throw new AppError(
        'COMMERCIAL_AMENDMENT_REQUIRED',
        'This quotation is no longer current. Review the latest version and accept it.',
        409,
      );
    if (q.validUntil && q.validUntil <= new Date()) {
      await this.expireQuotation(q.id);
      throw new AppError('QUOTATION_EXPIRED', 'This quotation has expired. Request a new quotation to continue.', 409);
    }
    const parties = await this.requiredParties(q);
    let organizationId: string;
    let onBehalfId: string | null = null;
    if (on) {
      if (actor.membership?.organizationType !== 'DEALDASH' || !actor.permissions.has('admin.finance.manage'))
        throw AppError.forbidden();
      // Admin may act for the owner or a sponsor under an auditable authorisation. NEVER for the fulfilment merchant.
      if (on.role === 'FULFILMENT_MERCHANT') throw AppError.forbidden('A fulfilment merchant must approve its own obligations');
      const auth = await this.prisma.adminAuthorization.findFirst({
        where: { id: on.authorizationId, organizationId: on.organizationId, revokedAt: null, validUntil: { gt: new Date() } },
      });
      if (!auth) throw AppError.validation('A valid authorisation record for this business is required');
      organizationId = on.organizationId;
      onBehalfId = auth.id;
    } else {
      const biz = this.businessOf(actor);
      organizationId = biz.organizationId;
      if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
      if (!actor.permissions.has(`${biz.prefix}.commercial.accept` as PermissionCode)) throw AppError.forbidden();
    }
    const party = parties.find((p) => p.organizationId === organizationId && (!on || p.role === on.role));
    if (!party) throw AppError.forbidden('You are not a party to this quotation');
    const missing = party.requiredChecks.filter((x) => !checks.includes(x));
    if (missing.length)
      throw new AppError('COMMERCIAL_ACCEPTANCE_REQUIRED', `Every acknowledgement is required (${missing.join(', ')})`, 422);
    const econ = (q.inputs as unknown as { economics: Economics }).economics;
    if (party.role !== 'SPONSOR') {
      const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
      if (!org || org.status !== 'ACTIVE') throw new AppError('ACTIVATION_BLOCKED', 'The business is not active', 409);
    }
    const totals = q.totals as unknown as QuoteTotals;
    const result = await this.prisma.$transaction(async (tx) => {
      const acc = await this.accountOf(tx, organizationId);
      await tx.commercialAcceptance
        .create({
          data: {
            reference: await this.nextNumber(tx, 'acceptance', 'AC'),
            caseId,
            quotationId,
            role: party.role,
            organizationId,
            legalEntityId: acc.legalEntityId,
            userId: actor.userId,
            userRole: actor.membership?.roleCode ?? null,
            userName: actor.displayName,
            onBehalfAuthorizationId: onBehalfId,
            checks: checks as unknown as Prisma.InputJsonValue,
            textVersion: ACCEPTANCE_TEXT_VERSION,
            language,
            amounts: {
              quotation: q.reference,
              version: q.version,
              maxCashPayableToDealDashHalalas: totals.maxCashPayableToDealDashHalalas,
              maxSponsorLiabilityHalalas: totals.maxSponsorLiabilityHalalas,
              merchantBenefitHalalas: totals.maxMerchantBenefitCommitmentHalalas,
              maxUnits: totals.maxUnits,
            } as unknown as Prisma.InputJsonValue,
            ip: meta.ip,
            userAgent: meta.userAgent,
          },
        })
        .catch((err: unknown) => {
          if ((err as { code?: string }).code === 'P2002')
            throw new AppError('INVALID_STATE', 'This quotation was already accepted by your business', 409);
          throw err;
        });
      const all = await tx.commercialAcceptance.findMany({ where: { quotationId } });
      const done = parties.every((p) => all.some((a) => a.organizationId === p.organizationId && a.role === p.role));
      if (done) await this.finalizeAcceptance(tx, c.id, q.id, econ, actor);
      await this.audit.record(
        {
          action: 'COMMERCIAL_ACCEPTED',
          entityType: 'CommercialCase',
          entityId: caseId,
          actor,
          subjectOrganizationId: organizationId,
          reason: onBehalfId ? `On behalf (authorisation ${onBehalfId})` : null,
          newState: { quotation: q.reference, role: party.role, complete: done },
          meta,
        },
        tx,
      );
      return { complete: done };
    });
    return result;
  }

  /** All required parties accepted: this version becomes the binding commitment; funding commitments and approval steps appear. */
  private async finalizeAcceptance(tx: Tx, caseId: string, quotationId: string, econ: Economics, actor: Actor | null) {
    const q = await tx.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    const c = await tx.commercialCase.findUniqueOrThrow({ where: { id: caseId } });
    if (c.acceptedQuotationId && c.acceptedQuotationId !== quotationId)
      await tx.quotation.update({
        where: { id: c.acceptedQuotationId },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
    await tx.quotation.update({ where: { id: quotationId }, data: { status: 'ACCEPTED' } });
    const adapter = this.registry.get(c.product);
    const lines = q.lines as unknown as QuoteLine[];
    const totals = q.totals as unknown as QuoteTotals;
    const reqs = await this.fundingOf(econ, lines, totals, Boolean(adapter.managedFunding), adapter.fundingKind);
    for (const r of reqs) {
      const kind = r.kind;
      const existing = await tx.fundingCommitment.findFirst({
        where: { caseId, organizationId: r.organizationId, kind, adapterManaged: r.managed },
      });
      if (existing) {
        // An amendment can raise the commitment; it can never fall below what has already been drawn.
        await tx.fundingCommitment.update({
          where: { id: existing.id },
          data: {
            quotationId,
            upfrontHalalas: Math.max(r.upfrontHalalas, existing.upfrontEarnedHalalas),
            usageMaxHalalas: Math.max(r.usageMaxHalalas, existing.utilizedHalalas),
            perUnitHalalas: r.perUnitHalalas,
          },
        });
      } else {
        await tx.fundingCommitment.create({
          data: {
            caseId,
            quotationId,
            organizationId: r.organizationId,
            role: r.role,
            kind,
            mode: r.mode,
            upfrontHalalas: r.upfrontHalalas,
            usageMaxHalalas: r.usageMaxHalalas,
            perUnitHalalas: r.perUnitHalalas,
            adapterManaged: r.managed,
          },
        });
      }
    }
    const pricingTreatment = q.unusedTreatment;
    const steps = await this.pricing.workflow(
      c.ownerOrganizationId,
      c.product,
      totals.maxCashPayableToDealDashHalalas + totals.maxSponsorLiabilityHalalas,
    );
    for (const step of steps)
      await tx.commercialApproval.upsert({
        where: { quotationId_step: { quotationId, step } },
        update: {},
        create: { caseId, quotationId, step },
      });
    await tx.commercialCase.update({
      where: { id: caseId },
      data: {
        acceptedQuotationId: quotationId,
        unusedTreatment: pricingTreatment,
        status: reqs.length ? 'AWAITING_FUNDING' : 'ACCEPTED',
      },
    });
    await this.refreshStatus(tx, caseId);
    void actor;
  }

  /** Commercial status is derived, separate from the campaign's operational status. */
  async refreshStatus(tx: Tx | PrismaService, caseId: string) {
    const c = await tx.commercialCase.findUniqueOrThrow({
      where: { id: caseId },
      include: { commitments: true },
    });
    if (c.status === 'CLOSED' || c.status === 'RECONCILED') return c.status;
    const hold = await this.activeHold(tx, c.ownerOrganizationId, c.id);
    let status = c.status;
    if (hold) status = 'FINANCIAL_HOLD';
    else if (!c.acceptedQuotationId) status = c.currentQuotationId ? 'AWAITING_ACCEPTANCE' : 'PRICING_DRAFT';
    else {
      const cash = c.commitments.filter((m) => !m.adapterManaged);
      const credit = cash.filter((m) => m.mode === 'CREDIT');
      const prepaid = cash.filter((m) => m.mode === 'PREPAID');
      const covered = (m: (typeof cash)[number]) => m.receivedHalalas >= m.upfrontHalalas + m.usageMaxHalalas;
      const any = prepaid.some((m) => m.receivedHalalas > 0);
      if (!cash.length) status = 'ACCEPTED';
      else if (prepaid.every(covered) && credit.length) status = 'CREDIT_APPROVED';
      else if (prepaid.every(covered)) status = 'FULLY_FUNDED';
      else status = any ? 'PARTIALLY_FUNDED' : 'AWAITING_FUNDING';
    }
    if (status !== c.status) await tx.commercialCase.update({ where: { id: caseId }, data: { status } });
    return status;
  }

  async activeHold(tx: Tx | PrismaService, organizationId: string, caseId: string | null) {
    return tx.financialHold.findFirst({
      where: {
        status: 'ACTIVE',
        OR: [{ caseId: null, organizationId }, ...(caseId ? [{ caseId }] : [])],
      },
    });
  }

  // ---------------------------------------------------------------- approvals (configurable maker-checker)
  async decideApproval(
    actor: Actor,
    caseId: string,
    quotationId: string,
    step: ApprovalStep,
    decision: 'APPROVED' | 'REJECTED',
    reason: string | undefined,
    meta: RequestMeta,
  ) {
    const c = await this.prisma.commercialCase.findUnique({ where: { id: caseId } });
    if (!c) throw AppError.notFound();
    const biz = this.businessOf(actor);
    if (biz.organizationId !== c.ownerOrganizationId) throw AppError.notFound();
    const need = `${biz.prefix}.commercial.${step === 'INTERNAL_APPROVER' ? 'approve_internal' : 'approve_finance'}` as PermissionCode;
    if (!actor.permissions.has(need)) throw AppError.forbidden();
    const ap = await this.prisma.commercialApproval.findUnique({
      where: { quotationId_step: { quotationId, step } },
    });
    if (!ap || ap.caseId !== caseId) throw AppError.notFound();
    if (ap.status !== 'PENDING') throw new AppError('INVALID_STATE', 'This approval was already decided', 409);
    // Maker-checker: the person who accepted the quotation cannot also approve it.
    const accepted = await this.prisma.commercialAcceptance.findFirst({
      where: { quotationId, userId: actor.userId },
    });
    if (accepted)
      throw new AppError('APPROVAL_REQUIRED', 'A different person must approve (maker-checker)', 403);
    const other = await this.prisma.commercialApproval.findFirst({
      where: { quotationId, decidedByUserId: actor.userId },
    });
    if (other) throw new AppError('APPROVAL_REQUIRED', 'Each approval step needs a different person', 403);
    if (decision === 'REJECTED' && !reason) throw AppError.validation('A reason is required', 'reason');
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.commercialApproval.updateMany({
        where: { id: ap.id, status: 'PENDING' },
        data: {
          status: decision,
          decidedByUserId: actor.userId,
          decidedByName: actor.displayName,
          decidedAt: new Date(),
          reason: reason ?? null,
        },
      });
      if (res.count !== 1) throw new AppError('INVALID_STATE', 'This approval was already decided', 409);
      await this.audit.record(
        {
          action: 'COMMERCIAL_APPROVAL_DECIDED',
          entityType: 'CommercialCase',
          entityId: caseId,
          actor,
          subjectOrganizationId: c.ownerOrganizationId,
          reason,
          newState: { step, decision },
          meta,
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- gates
  async blockers(caseId: string): Promise<ActivationBlocker[]> {
    const c = await this.prisma.commercialCase.findUnique({
      where: { id: caseId },
      include: { commitments: true },
    });
    if (!c) return [{ code: 'NO_COMMERCIAL_CASE', party: null, detail: null }];
    const out: ActivationBlocker[] = [];
    const add = (code: string, party: string | null = null, detail: string | null = null) =>
      out.push({ code, party, detail });
    const cur = c.currentQuotationId ? await this.prisma.quotation.findUnique({ where: { id: c.currentQuotationId } }) : null;
    if (!cur) {
      add('NO_QUOTATION');
      return out;
    }
    const totals = cur.totals as unknown as QuoteTotals;
    if (totals.issues.length) add('UNBOUNDED_LIABILITY', null, totals.issues.join(','));
    if (c.acceptedQuotationId !== cur.id) {
      const parties = await this.requiredParties(cur);
      const acc = await this.prisma.commercialAcceptance.findMany({ where: { quotationId: cur.id } });
      for (const p of parties)
        if (!acc.some((a) => a.organizationId === p.organizationId && a.role === p.role))
          add('ACCEPTANCE_MISSING', p.role, p.organizationId);
      if (c.acceptedQuotationId) add('AMENDMENT_NOT_ACCEPTED', null, cur.reference);
    }
    const adapter = this.registry.get(c.product);
    if (c.fulfilmentOrganizationId !== c.ownerOrganizationId) {
      const f = await this.prisma.organization.findUnique({
        where: { id: c.fulfilmentOrganizationId },
        include: { merchant: { select: { organizationId: true } } },
      });
      if (!f || f.status !== 'ACTIVE' || f.type !== 'MERCHANT' || !f.merchant)
        add('FULFILMENT_NOT_ONBOARDED', 'FULFILMENT_MERCHANT', c.fulfilmentOrganizationId);
    }
    if (c.acceptedQuotationId) {
      const apps = await this.prisma.commercialApproval.findMany({ where: { quotationId: c.acceptedQuotationId } });
      for (const a of apps) if (a.status !== 'APPROVED') add(a.status === 'REJECTED' ? 'APPROVAL_REJECTED' : 'APPROVAL_PENDING', a.step);
      const hasSponsor = c.commitments.some((m) => m.kind === 'SPONSOR_FUNDING');
      const hasManaged = c.commitments.some((m) => m.adapterManaged);
      if ((hasSponsor || hasManaged) && !c.unusedTreatment) add('UNUSED_FUNDING_TREATMENT_NOT_CONFIGURED');
      const managed = adapter.managedFunding ? await adapter.managedFunding(c.subjectId) : null;
      for (const m of c.commitments) {
        if (m.adapterManaged) {
          if (managed && managed.fundedHalalas < managed.requiredHalalas)
            add('FUNDING_MISSING', m.role, `${managed.requiredHalalas - managed.fundedHalalas}`);
          continue;
        }
        const max = m.upfrontHalalas + m.usageMaxHalalas;
        if (m.mode === 'PREPAID' && m.receivedHalalas < max)
          add('FUNDING_MISSING', m.role, `${max - m.receivedHalalas}`);
        if (m.mode === 'CREDIT') {
          const pos = await this.creditPosition(m.organizationId);
          if (!pos.facility) add('CREDIT_NOT_ACTIVE', m.role, m.organizationId);
          else if (await this.creditExposure(m.organizationId) > pos.facility.limitHalalas)
            add('CREDIT_LIMIT_EXCEEDED', m.role, m.organizationId);
        }
      }
    }
    if (await this.activeHold(this.prisma, c.ownerOrganizationId, c.id)) add('FINANCIAL_HOLD');
    return out;
  }

  /** Blockers that stop SUBMISSION: the owner must have reviewed and accepted before anything is sent to DealDash. */
  async submitBlockers(caseId: string): Promise<ActivationBlocker[]> {
    const c = await this.prisma.commercialCase.findUnique({ where: { id: caseId } });
    if (!c?.currentQuotationId) return [{ code: 'NO_QUOTATION', party: null, detail: null }];
    const q = await this.prisma.quotation.findUniqueOrThrow({ where: { id: c.currentQuotationId } });
    const owner = await this.prisma.commercialAcceptance.findFirst({
      where: { quotationId: q.id, role: 'OWNER', organizationId: c.ownerOrganizationId },
    });
    const out: ActivationBlocker[] = [];
    if (!owner && c.acceptedQuotationId !== q.id) out.push({ code: 'ACCEPTANCE_MISSING', party: 'OWNER', detail: c.ownerOrganizationId });
    const totals = q.totals as unknown as QuoteTotals;
    if (totals.issues.length) out.push({ code: 'UNBOUNDED_LIABILITY', party: null, detail: totals.issues.join(',') });
    return out;
  }

  /** Called by a product when a merchant submits a campaign. Refreshes the quotation and demands the owner's acceptance. */
  async assertCanSubmit(product: CommercialProduct, subjectId: string, actor: Actor | null) {
    await this.assertEntitled(product, subjectId);
    const { caseId } = await this.syncQuotation(product, subjectId, actor);
    const b = await this.submitBlockers(caseId);
    if (b.length)
      throw new AppError(
        'COMMERCIAL_ACCEPTANCE_REQUIRED',
        `Review and accept the commercial terms before submitting (${b.map((x) => x.code).join(', ')})`,
        422,
      );
    return caseId;
  }

  /** Customer entry points (a new reservation, purchase or view) ask this; redemption, refund and reward paths never do. */
  assertCustomerExposureAllowed(organizationId: string) {
    return this.entitlements.assertLiveCampaignOpen(organizationId);
  }

  /** The decisive gate: nothing goes live (manual approval, auto-approval, scheduled activation) with open blockers. */
  async blockersFor(product: CommercialProduct, subjectId: string): Promise<ActivationBlocker[]> {
    const { caseId } = await this.syncQuotation(product, subjectId);
    return this.blockers(caseId);
  }

  /** The contract must include the product, and the organization must be inside its campaign limit (backend enforced). */
  async assertEntitled(product: CommercialProduct, subjectId: string) {
    const subject = await this.registry.get(product).load(subjectId);
    // Stage 7: the campaign is entitled through its COMMERCIAL OWNER's contract (a partner creator / budget owner, else the merchant)
    const owner = (await this.registry.get(product).economics(subject.organizationId, subject.content, subjectId)).ownerOrganizationId;
    // the product must be in the contract AND open in the campaign's market (never inherited from another country)
    const market = this.markets ? await this.markets.marketOfCampaign(subject.organizationId, subject.content) : null;
    await this.entitlements.requireProduct(owner, ENTITLEMENT_PRODUCT_OF[product], { market });
    // a suspended / ended agreement, an elapsed grace or a financial hold refuses NEW paid exposure (issued customer rights are untouched)
    await this.entitlements.requireNewExposure(owner, 'ACTIVATE_CAMPAIGN');
    const open = await this.prisma.commercialCase.count({
      where: {
        ownerOrganizationId: owner,
        status: { notIn: ['CLOSED', 'RECONCILED'] },
        // only campaigns the owner has already committed to count toward the limit (drafts and previews do not)
        acceptedQuotationId: { not: null },
        NOT: { product, subjectId },
      },
    });
    await this.entitlements.requireWithinLimit(owner, 'campaigns.max_active', open);
  }

  async assertCanActivate(product: CommercialProduct, subjectId: string) {
    await this.assertEntitled(product, subjectId);
    const b = await this.blockersFor(product, subjectId);
    if (b.length)
      throw new AppError(
        'ACTIVATION_BLOCKED',
        `This campaign cannot go live yet (${b.map((x) => x.code).join(', ')})`,
        409,
      );
  }

  /**
   * A live campaign may only grow beyond what was accepted after the amendment (new totals, delta, re-acceptance by every party).
   * Raising stock first creates the amendment quotation and refuses; once accepted, the same request succeeds.
   */
  async requireCoverage(product: CommercialProduct, subjectId: string, newUnits: number, actor: Actor | null) {
    const c = await this.prisma.commercialCase.findUnique({ where: { product_subjectId: { product, subjectId } } });
    const accepted = c?.acceptedQuotationId
      ? await this.prisma.quotation.findUnique({ where: { id: c.acceptedQuotationId } })
      : null;
    const acceptedUnits = accepted ? (accepted.inputs as unknown as { economics: Economics }).economics.maxUnits : -1;
    if (accepted && newUnits <= acceptedUnits) return;
    const subject = await this.registry.get(product).load(subjectId);
    await this.entitlements.requireNewExposure(subject.organizationId, 'UPGRADE_EXPOSURE');
    await this.syncQuotation(product, subjectId, actor, { maxUnits: newUnits });
    throw new AppError(
      'COMMERCIAL_AMENDMENT_REQUIRED',
      'This change raises the commercial commitment. Review the amendment and accept it first.',
      409,
    );
  }

  /** Guards stock / quota / validity increases on a campaign that is already live: the amendment must be accepted first. */
  async assertAmendmentAccepted(product: CommercialProduct, subjectId: string) {
    const { caseId } = await this.syncQuotation(product, subjectId);
    const c = await this.prisma.commercialCase.findUniqueOrThrow({ where: { id: caseId } });
    if (c.acceptedQuotationId !== c.currentQuotationId)
      throw new AppError(
        'COMMERCIAL_AMENDMENT_REQUIRED',
        'This change raises the commercial commitment. Review the amendment and accept it first.',
        409,
      );
  }

  // ---------------------------------------------------------------- earning and utilisation (through the ledger)
  private async post(
    tx: Tx,
    m: {
      id: string;
      organizationId: string;
      kind: 'CHARGE' | 'SPONSOR_FUNDING';
      mode: 'PREPAID' | 'CREDIT';
    },
    amount: number,
    key: string,
    caseId: string,
    memo: string,
  ) {
    const credit = m.kind === 'CHARGE' ? ('PLATFORM_REVENUE' as const) : ('FUNDING_UTILIZED' as const);
    const debit = m.mode === 'PREPAID' ? ('CAMPAIGN_FUNDS_HELD' as const) : ('RECEIVABLE' as const);
    return this.ledger.post(tx, {
      type: 'FUNDING_UTILIZED',
      sourceType: 'COMMERCIAL_CASE',
      sourceId: caseId,
      idempotencyKey: key,
      memo,
      lines: [
        { family: debit, organizationId: m.organizationId, amountHalalas: amount },
        { family: credit, organizationId: m.kind === 'CHARGE' ? null : m.organizationId, amountHalalas: -amount },
      ],
    });
  }

  /** The campaign pricing version that governed a quotation, as an event key (PAV:<agreement version>). */
  async pricingKeyOf(db: Tx | PrismaService, quotationId: string | null | undefined): Promise<string | null> {
    if (!quotationId) return null;
    const q = await db.quotation.findUnique({ where: { id: quotationId }, select: { pricingVersionId: true } });
    return q?.pricingVersionId ? `PAV:${q.pricingVersionId}` : null;
  }

  /** Upfront (fixed) charges are earned once, when the campaign goes live. Recognition timing is VALIDATE-KSA. */
  async earnUpfront(product: CommercialProduct, subjectId: string, tx?: Tx) {
    const db = tx ?? this.prisma;
    const c = await db.commercialCase.findUnique({ where: { product_subjectId: { product, subjectId } } });
    if (!c) return;
    const run = async (t: Tx) => {
      const ms = await t.fundingCommitment.findMany({ where: { caseId: c.id, upfrontHalalas: { gt: 0 } } });
      for (const m of ms) {
        const res = await t.fundingCommitment.updateMany({
          where: { id: m.id, upfrontEarnedHalalas: 0 },
          data: { upfrontEarnedHalalas: m.upfrontHalalas },
        });
        if (res.count === 1) {
          await this.post(t, m, m.upfrontHalalas, `earn-upfront:${m.id}`, c.id, 'Upfront charge earned');
          // the billing hook of the CAMPAIGN_ACTIVATION trigger: only DealDash's own charge to the campaign owner is revenue
          if (m.kind === 'CHARGE' && this.billingEvents)
            await this.billingEvents.emit(
              {
                idempotencyKey: `bill:CAMPAIGN_SETUP_FEE:commitment:${m.id}`,
                organizationId: m.organizationId,
                eventType: 'CAMPAIGN_SETUP_FEE',
                contractId: c.contractId,
                product: product === 'LIVE_BENEFIT' ? 'LIVE_DEAL' : product,
                campaignId: subjectId,
                sourceEventId: m.id,
                pricingVersionKey: await this.pricingKeyOf(t, m.quotationId),
                unitRateMinor: m.upfrontHalalas,
                amountMinor: m.upfrontHalalas,
                occurredAt: new Date(),
                metadata: { caseId: c.id, trigger: c.billingTrigger },
              },
              t,
            );
        }
      }
    };
    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  /**
   * A verified event (a redemption, a sale) draws down the commitments. Idempotent per source; capped at the commitment (the
   * database also refuses an overdraw).
   */
  async recordUtilization(
    product: CommercialProduct,
    subjectId: string,
    src: { sourceType: string; sourceId: string; units?: number },
    tx?: Tx,
  ) {
    const db = tx ?? this.prisma;
    const c = await db.commercialCase.findUnique({ where: { product_subjectId: { product, subjectId } } });
    if (!c) return { applied: 0, eventIds: [] as string[] };
    const units = src.units ?? 1;
    const run = async (t: Tx) => {
      let applied = 0;
      const eventIds: string[] = [];
      const ms = await t.fundingCommitment.findMany({
        where: { caseId: c.id, adapterManaged: false, perUnitHalalas: { gt: 0 }, trigger: CASH_TRIGGER_EVENT, status: 'OPEN' },
      });
      for (const m of ms) {
        const want = m.perUnitHalalas * units;
        const seen = await t.utilizationEvent.findUnique({
          where: { commitmentId_sourceType_sourceId: { commitmentId: m.id, sourceType: src.sourceType, sourceId: src.sourceId } },
        });
        if (seen) continue;
        const room = Math.max(0, m.usageMaxHalalas - m.utilizedHalalas);
        const amount = Math.min(want, room);
        if (amount > 0) {
          const res = await t.$executeRaw`UPDATE "FundingCommitment" SET "utilizedHalalas" = "utilizedHalalas" + ${amount}
            WHERE "id" = ${m.id}::uuid AND "utilizedHalalas" + ${amount} <= "usageMaxHalalas"`;
          if (res !== 1) continue;
        }
        const j = amount > 0 ? await this.post(t, m, amount, `util:${m.id}:${src.sourceType}:${src.sourceId}`, c.id, 'Verified event') : null;
        const ev = await t.utilizationEvent.create({
          data: {
            campaignVersion: await this.versions.current(t, c.product, c.subjectId),
            commitmentId: m.id,
            caseId: c.id,
            sourceType: src.sourceType,
            sourceId: src.sourceId,
            units,
            amountHalalas: amount,
            journalId: j?.journalId ?? null,
          },
        });
        eventIds.push(ev.id);
        applied += amount;
      }
      return { applied, eventIds };
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /**
   * How many more units (points, redemptions) the prepaid funding still covers. Null when the case has no per-unit funding at all
   * (so the caller can tell 'nothing funded' from 'fully used').
   */
  async remainingUnits(product: CommercialProduct, subjectId: string, db: Tx | PrismaService = this.prisma): Promise<number | null> {
    const c = await db.commercialCase.findUnique({ where: { product_subjectId: { product, subjectId } } });
    if (!c || !c.acceptedQuotationId) return null;
    const ms = await db.fundingCommitment.findMany({ where: { caseId: c.id, adapterManaged: false, perUnitHalalas: { gt: 0 }, status: 'OPEN' } });
    if (!ms.length) return null;
    return Math.min(...ms.map((m) => Math.max(0, Math.floor((m.usageMaxHalalas - m.utilizedHalalas) / m.perUnitHalalas))));
  }

  /** A reversed redemption gives the drawn amount back (a new reversing journal; history is never edited). */
  async reverseUtilization(
    product: CommercialProduct,
    subjectId: string,
    src: { sourceType: string; sourceId: string },
    tx?: Tx,
  ) {
    const db = tx ?? this.prisma;
    const c = await db.commercialCase.findUnique({ where: { product_subjectId: { product, subjectId } } });
    if (!c) return;
    const run = async (t: Tx) => {
      const evs = await t.utilizationEvent.findMany({
        where: { caseId: c.id, sourceType: src.sourceType, sourceId: src.sourceId, reversedAt: null },
      });
      for (const ev of evs) {
        const res = await t.utilizationEvent.updateMany({ where: { id: ev.id, reversedAt: null }, data: { reversedAt: new Date() } });
        if (res.count !== 1) continue;
        if (ev.amountHalalas > 0) {
          await t.$executeRaw`UPDATE "FundingCommitment" SET "utilizedHalalas" = "utilizedHalalas" - ${ev.amountHalalas}
            WHERE "id" = ${ev.commitmentId}::uuid AND "utilizedHalalas" >= ${ev.amountHalalas}`;
          if (ev.journalId) {
            const r = await this.ledger.reverse(t, ev.journalId, {
              sourceType: 'COMMERCIAL_CASE',
              sourceId: c.id,
              idempotencyKey: `util-rev:${ev.id}`,
              memo: 'Redemption reversed',
            });
            await t.utilizationEvent.update({ where: { id: ev.id }, data: { reversalJournalId: r.journalId } });
          }
        }
      }
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  async acceptedQuotationId(product: CommercialProduct, subjectId: string): Promise<string | null> {
    return (
      (await this.prisma.commercialCase.findUnique({ where: { product_subjectId: { product, subjectId } }, select: { acceptedQuotationId: true } }))
        ?.acceptedQuotationId ?? null
    );
  }

  // ---------------------------------------------------------------- views
  async subjectOrganization(product: CommercialProduct, subjectId: string) {
    return (await this.registry.get(product).load(subjectId)).organizationId;
  }

  async caseIdOf(product: CommercialProduct, subjectId: string) {
    return (await this.prisma.commercialCase.findUnique({ where: { product_subjectId: { product, subjectId } }, select: { id: true } }))?.id ?? null;
  }

  /** Every case the business is a party to: as owner, fulfilment merchant, or a sponsor named on a quotation. */
  async listForOrganization(organizationId: string) {
    const rows = await this.prisma.commercialCase.findMany({
      where: {
        OR: [
          { ownerOrganizationId: organizationId },
          { fulfilmentOrganizationId: organizationId },
          { commitments: { some: { organizationId } } },
          { quotations: { some: { requiredParties: { array_contains: [{ organizationId }] } } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const owners = await this.prisma.organization.findMany({
      where: { id: { in: rows.map((c) => c.ownerOrganizationId) } },
      select: { id: true, nameEn: true, nameAr: true },
    });
    const out = [];
    for (const c of rows) {
      let title: { en: string; ar: string } | null = null;
      try {
        title = (await this.registry.get(c.product).load(c.subjectId)).title;
      } catch {
        title = null;
      }
      const o = owners.find((x) => x.id === c.ownerOrganizationId);
      const q = c.currentQuotationId
        ? await this.prisma.quotation.findUnique({ where: { id: c.currentQuotationId }, select: { requiredParties: true } })
        : null;
      const mine = ((q?.requiredParties as unknown as RequiredParty[]) ?? []).find((p) => p.organizationId === organizationId);
      out.push({
        id: c.id,
        reference: c.reference,
        product: c.product,
        subjectId: c.subjectId,
        title,
        status: c.status,
        ownerOrganizationId: c.ownerOrganizationId,
        ownerName: { en: o?.nameEn ?? '', ar: o?.nameAr ?? '' },
        maxCashHalalas: c.maxCashHalalas,
        benefitCommitmentHalalas: c.benefitCommitmentHalalas,
        developmentFixture: c.developmentFixture,
        updatedAt: c.updatedAt.toISOString(),
        myRole: mine?.role ?? (c.ownerOrganizationId === organizationId ? 'OWNER' : null),
      });
    }
    return out;
  }

  async view(caseId: string, actor: Actor, viewerOrganizationId: string | null): Promise<CommercialCaseView> {
    const c = await this.prisma.commercialCase.findUnique({
      where: { id: caseId },
      include: { commitments: true, acceptances: { orderBy: { createdAt: 'asc' } }, approvals: true, quotations: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!c) throw AppError.notFound();
    const isAdmin = actor.membership?.organizationType === 'DEALDASH';
    if (!isAdmin) {
      const parties = c.currentQuotationId
        ? await this.prisma.quotation.findUnique({ where: { id: c.currentQuotationId } }).then((q) => (q ? ((q.requiredParties as unknown as RequiredParty[]) ?? []) : []))
        : [];
      const involved =
        viewerOrganizationId === c.ownerOrganizationId ||
        viewerOrganizationId === c.fulfilmentOrganizationId ||
        parties.some((p) => p.organizationId === viewerOrganizationId);
      if (!involved) throw AppError.notFound();
    }
    const q = c.quotations[0] ?? null;
    const blockers = await this.blockers(c.id);
    const submitBlockers = await this.submitBlockers(c.id);
    const hold = await this.activeHold(this.prisma, c.ownerOrganizationId, c.id);
    // Sponsors see only their own lines; the owner and DealDash see everything.
    const full = isAdmin || viewerOrganizationId === c.ownerOrganizationId || viewerOrganizationId === c.fulfilmentOrganizationId;
    const mine = (orgId: string) => full || orgId === viewerOrganizationId;
    const allowed: string[] = [];
    if (q?.status === 'PENDING_ACCEPTANCE' && viewerOrganizationId && (actor.permissions.has('merchant.commercial.accept') || actor.permissions.has('partner.commercial.accept'))) {
      const parties = (q.requiredParties as unknown as RequiredParty[]) ?? [];
      const p = parties.find((x) => x.organizationId === viewerOrganizationId);
      if (p && !c.acceptances.some((a) => a.quotationId === q.id && a.organizationId === viewerOrganizationId && a.role === p.role)) allowed.push('ACCEPT');
    }
    if (c.commitments.some((m) => m.mode === 'PREPAID' && !m.adapterManaged && m.organizationId === viewerOrganizationId && m.receivedHalalas < m.upfrontHalalas + m.usageMaxHalalas))
      allowed.push('PAY');
    for (const a of c.approvals)
      if (a.status === 'PENDING' && a.quotationId === c.acceptedQuotationId && viewerOrganizationId === c.ownerOrganizationId)
        allowed.push(a.step === 'INTERNAL_APPROVER' ? 'APPROVE_INTERNAL' : 'APPROVE_FINANCE');
    return {
      id: c.id,
      reference: c.reference,
      product: c.product,
      subjectId: c.subjectId,
      status: c.status,
      ownerOrganizationId: c.ownerOrganizationId,
      fulfilmentOrganizationId: c.fulfilmentOrganizationId,
      developmentFixture: c.developmentFixture,
      unusedTreatment: c.unusedTreatment,
      quotation: q
        ? { id: q.id, reference: q.reference, version: q.version, status: q.status, createdAt: q.createdAt.toISOString(), delta: q.delta }
        : null,
      preview: q ? this.previewOf(q, full ? null : viewerOrganizationId, c) : null,
      acceptances: c.acceptances
        .filter((a) => mine(a.organizationId))
        .map((a) => ({
          reference: a.reference,
          role: a.role,
          organizationId: a.organizationId,
          userName: a.userName,
          userRole: a.userRole,
          onBehalf: Boolean(a.onBehalfAuthorizationId),
          createdAt: a.createdAt.toISOString(),
          quotationId: a.quotationId,
        })),
      approvals: c.approvals.map((a) => ({ step: a.step, status: a.status, decidedByName: a.decidedByName, reason: a.reason })),
      funding: c.commitments
        .filter((m) => mine(m.organizationId))
        .map((m) => {
          const max = m.upfrontHalalas + m.usageMaxHalalas;
          const earned = m.upfrontEarnedHalalas + m.utilizedHalalas;
          return {
            id: m.id,
            organizationId: m.organizationId,
            role: m.role,
            kind: m.kind,
            mode: m.mode,
            upfrontHalalas: m.upfrontHalalas,
            usageMaxHalalas: m.usageMaxHalalas,
            maxHalalas: max,
            receivedHalalas: m.receivedHalalas,
            utilizedHalalas: m.utilizedHalalas,
            earnedHalalas: earned,
            remainingCommitmentHalalas: Math.max(0, max - earned),
            outstandingHalalas: m.mode === 'CREDIT' ? Math.max(0, earned - m.receivedHalalas) : Math.max(0, max - m.receivedHalalas),
            status: m.status,
          };
        }),
      blockers,
      submitBlockers,
      allowedActions: allowed,
      hold: { active: Boolean(hold), reason: hold?.reason ?? null },
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  private previewOf(
    q: { lines: Prisma.JsonValue; totals: Prisma.JsonValue; pricingSnapshot: Prisma.JsonValue; requiredParties: Prisma.JsonValue; unusedTreatment: UnusedTreatment | null },
    sponsorOrgId: string | null,
    c: { id: string },
  ): CommercialPreview {
    void c;
    const snap = q.pricingSnapshot as unknown as {
      source: 'AGREEMENT' | 'DEFAULT';
      reference: string | null;
      versionKey: string;
      workflow?: CommercialPreview['workflow'];
      fundingRequirements?: CommercialPreview['fundingRequirements'];
    };
    let lines = q.lines as unknown as QuoteLine[];
    let totals = q.totals as unknown as QuoteTotals;
    let parties = (q.requiredParties as unknown as RequiredParty[]) ?? [];
    if (sponsorOrgId) {
      // a sponsor sees only its own funding obligation: never the merchant's pricing or benefit
      lines = lines.filter((l) => l.partyOrganizationId === sponsorOrgId && l.kind === 'SPONSOR_FUNDING');
      totals = { ...totals, dealdashChargesHalalas: 0, taxHalalas: 0, maxCashPayableToDealDashHalalas: 0, nettedChargesHalalas: 0, merchantCashContributionHalalas: 0, maxMerchantBenefitCommitmentHalalas: 0, customerBenefitTotalHalalas: 0, totalEconomicCommitmentHalalas: lines.reduce((n, l) => n + l.amountHalalas, 0), sponsorLiability: totals.sponsorLiability.filter((s) => s.organizationId === sponsorOrgId), maxSponsorLiabilityHalalas: lines.reduce((n, l) => n + l.amountHalalas, 0) };
      parties = parties.filter((p) => p.organizationId === sponsorOrgId);
    }
    return {
      lines: lines as CommercialPreview['lines'],
      totals,
      pricing: { source: snap.source, reference: snap.reference, versionKey: snap.versionKey, unusedTreatment: q.unusedTreatment },
      parties,
      fundingRequirements: (snap.fundingRequirements ?? []).filter((f) => !sponsorOrgId || f.organizationId === sponsorOrgId),
      workflow: snap.workflow ?? [],
    };
  }

  // ---------------------------------------------------------------- development / test fixtures
  /**
   * Development and test fixtures only: walks the REAL flow (quotation, every party's acceptance, mock funding) so seeded and test
   * campaigns satisfy the gate, and marks the case as a development fixture. Refused in production; not exposed over HTTP.
   */
  async devComplete(product: CommercialProduct, subjectId: string) {
    if (process.env.NODE_ENV === 'production') throw new Error('devComplete is not available in production');
    await this.pricing.ensureDevAgreement();
    const { caseId } = await this.syncQuotation(product, subjectId);
    const c = await this.prisma.commercialCase.findUniqueOrThrow({ where: { id: caseId } });
    if (c.acceptedQuotationId !== c.currentQuotationId) {
      const q = await this.prisma.quotation.findUniqueOrThrow({ where: { id: c.currentQuotationId! } });
      const parties = (q.requiredParties as unknown as RequiredParty[]) ?? [];
      const econ = (q.inputs as unknown as { economics: Economics }).economics;
      await this.prisma.$transaction(async (tx) => {
        for (const p of parties) {
          const acc = await this.accountOf(tx, p.organizationId);
          await tx.commercialAcceptance.upsert({
            where: { quotationId_role_organizationId: { quotationId: q.id, role: p.role, organizationId: p.organizationId } },
            update: {},
            create: {
              reference: await this.nextNumber(tx, 'acceptance', 'AC'),
              caseId,
              quotationId: q.id,
              role: p.role,
              organizationId: p.organizationId,
              legalEntityId: acc.legalEntityId,
              userId: c.createdByUserId.length === 36 ? c.createdByUserId : p.organizationId,
              userName: 'Development fixture',
              checks: p.requiredChecks as unknown as Prisma.InputJsonValue,
              textVersion: ACCEPTANCE_TEXT_VERSION,
              language: 'en',
              amounts: { developmentFixture: true },
            },
          });
        }
        await this.finalizeAcceptance(tx, caseId, q.id, econ, null);
        await tx.commercialCase.update({ where: { id: caseId }, data: { developmentFixture: true } });
        const apps = await tx.commercialApproval.findMany({ where: { quotationId: q.id, status: 'PENDING' } });
        for (const a of apps)
          await tx.commercialApproval.update({ where: { id: a.id }, data: { status: 'APPROVED', decidedAt: new Date(), decidedByName: 'Development fixture' } });
      });
    }
    // fund every prepaid commitment in full through the same ledger path as a real payment
    const ms = await this.prisma.fundingCommitment.findMany({ where: { caseId, adapterManaged: false, mode: 'PREPAID' } });
    for (const m of ms) {
      const need = m.upfrontHalalas + m.usageMaxHalalas - m.receivedHalalas;
      if (need > 0) await this.receivePayment({ commitmentId: m.id, amountHalalas: need, method: 'DEV_FIXTURE', actor: null, key: `dev-fund:${m.id}:${m.receivedHalalas}` });
    }
    await this.prisma.$transaction((tx) => this.refreshStatus(tx, caseId));
    return caseId;
  }

  // ---------------------------------------------------------------- payments
  /** Money in against one commitment. Prepaid funds are held; credit payments settle the receivable. Over-funding is refused. */
  async receivePayment(p: {
    commitmentId: string;
    amountHalalas: number;
    method: string;
    actor: Actor | null;
    key: string;
    externalReference?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const m = await tx.fundingCommitment.findUniqueOrThrow({ where: { id: p.commitmentId } });
      const max = m.upfrontHalalas + m.usageMaxHalalas;
      const existing = await tx.financePayment.findUnique({ where: { idempotencyKey: p.key } });
      if (existing) return existing;
      const res = await tx.$executeRaw`UPDATE "FundingCommitment" SET "receivedHalalas" = "receivedHalalas" + ${p.amountHalalas}
        WHERE "id" = ${m.id}::uuid AND "receivedHalalas" + ${p.amountHalalas} <= ${max}`;
      if (res !== 1) throw new AppError('INVALID_STATE', `The amount is more than the remaining commitment (${Math.max(0, max - m.receivedHalalas)} halalas)`, 409);
      const acc = await this.accountOf(tx, m.organizationId);
      const ref = await this.nextNumber(tx, 'payment', 'PY');
      const j = await this.ledger.post(tx, {
        type: 'FUNDING_RECEIVED',
        sourceType: 'FINANCE_PAYMENT',
        sourceId: m.caseId,
        idempotencyKey: `pay:${p.key}`,
        memo: `Payment ${ref} (${p.method})`,
        actor: p.actor ? { userId: p.actor.userId, role: p.actor.membership?.roleCode ?? null } : null,
        lines: [
          { family: 'PSP_CLEARING', amountHalalas: p.amountHalalas, memo: 'Funds received (development mock / manual record)' },
          { family: m.mode === 'PREPAID' ? 'CAMPAIGN_FUNDS_HELD' : 'RECEIVABLE', organizationId: m.organizationId, amountHalalas: -p.amountHalalas },
        ],
      });
      const payment = await tx.financePayment.create({
        data: {
          reference: ref,
          businessAccountId: acc.id,
          organizationId: m.organizationId,
          caseId: m.caseId,
          commitmentId: m.id,
          amountHalalas: p.amountHalalas,
          method: p.method,
          externalReference: p.externalReference ?? null,
          recordedByUserId: p.actor?.userId ?? null,
          recordedByRole: p.actor?.membership?.roleCode ?? null,
          journalId: j.journalId,
          idempotencyKey: p.key,
        },
      });
      await tx.financeDocument.create({
        data: {
          number: await this.nextNumber(tx, 'receipt', 'RC'),
          type: 'RECEIPT',
          businessAccountId: acc.id,
          organizationId: m.organizationId,
          caseId: m.caseId,
          subtotalHalalas: p.amountHalalas,
          totalHalalas: p.amountHalalas,
          paidHalalas: p.amountHalalas,
          status: 'PAID',
          lines: [{ description: `Payment ${ref}`, amountHalalas: p.amountHalalas }],
          statutory: { status: 'VALIDATE_KSA' },
        },
      });
      await this.audit.record(
        {
          action: 'FINANCE_PAYMENT_RECORDED',
          entityType: 'CommercialCase',
          entityId: m.caseId,
          actor: p.actor,
          subjectOrganizationId: m.organizationId,
          newState: { reference: ref, amountHalalas: p.amountHalalas, method: p.method },
        },
        tx,
      );
      await this.refreshStatus(tx, m.caseId);
      return payment;
    });
  }

  /** A business pays what it owes on a case (development mock of a payment provider; the real PSP is VALIDATE-KSA). */
  async pay(actor: Actor, caseId: string, amount: number | undefined, meta: RequestMeta) {
    const c = await this.prisma.commercialCase.findUnique({ where: { id: caseId }, include: { commitments: true } });
    if (!c) throw AppError.notFound();
    const biz = this.businessOf(actor);
    const org = biz.organizationId;
    if (!actor.permissions.has(`${biz.prefix}.finance.manage` as PermissionCode) && !actor.permissions.has(`${biz.prefix}.commercial.accept` as PermissionCode)) throw AppError.forbidden();
    const mine = c.commitments.filter((m) => m.organizationId === org && !m.adapterManaged && m.mode === 'PREPAID');
    if (!mine.length) throw AppError.notFound();
    let left = amount ?? Infinity;
    const key = meta.requestId;
    let total = 0;
    for (const m of mine) {
      const room = m.upfrontHalalas + m.usageMaxHalalas - m.receivedHalalas;
      const x = Math.min(room, left);
      if (x <= 0) continue;
      await this.receivePayment({ commitmentId: m.id, amountHalalas: x, method: 'CARD_DEV_MOCK', actor, key: `${key}:${m.id}` });
      left -= x;
      total += x;
    }
    if (total === 0) throw new AppError('INVALID_STATE', 'Nothing is due', 409);
    return { paidHalalas: total };
  }
}
