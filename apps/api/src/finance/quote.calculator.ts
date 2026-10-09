import { createHash } from 'node:crypto';
import type {
  ChargeTrigger,
  CollectionMethod,
  PartyRole,
  PricingComponent,
  QuoteLineKind,
} from '@dealdash/types';

/** The economic facts of a campaign, supplied by a product adapter. Money is integer halalas. */
export interface Economics {
  currency: string;
  /** Redemptions / vouchers / paid views the campaign can generate. 0 = unlimited (liability cannot be bounded). */
  maxUnits: number;
  unitLabel: 'REDEMPTION' | 'VOUCHER' | 'VIEW';
  /** Per unit, the figures a percentage charge can be based on. MEDIA_SPEND is the campaign total (Watch & Earn). */
  base: { SELLING_PRICE: number; FACE_VALUE: number; BENEFIT_VALUE: number; MEDIA_SPEND_TOTAL: number };
  /** What the customer saves per unit (normal price minus deal price, face value minus price, ...). */
  customerBenefitPerUnit: number;
  /** Sponsors (banks, schemes, corporates) and what each funds per unit. */
  sponsors: Array<{ organizationId: string; perUnitHalalas: number; trigger: ChargeTrigger }>;
  /** Cash the merchant contributes per unit toward the benefit (netted from what DealDash pays the merchant). */
  merchantCashPerUnit: number;
  ownerOrganizationId: string;
  fulfilmentOrganizationId: string;
  /** Watch & Earn: the advertiser's media spend is a DealDash charge funded through the campaign budget. */
  mediaSpend?: { totalHalalas: number; perUnitHalalas: number };
  validity: { startAt: string | null; endAt: string | null };
  inventory: { total: number | null; dailyQuota: number | null };
  /** True while an unaccepted amendment overrides the units stored on the campaign. */
  amendment?: boolean;
}

export interface QuoteLine {
  kind: QuoteLineKind;
  code: string;
  label: { en: string; ar: string };
  /** The business the line belongs to (who is charged / who commits). */
  partyOrganizationId: string | null;
  partyRole: PartyRole | null;
  basis: string;
  units: number;
  unitHalalas: number;
  /** The maximum this line can reach. */
  amountHalalas: number;
  /** Cash moves money; a non-cash line is a fulfilment commitment (never DealDash revenue, never cash liability). */
  cash: boolean;
  collection: CollectionMethod | null;
  trigger: ChargeTrigger | null;
  taxable: boolean;
  /** Placeholder / validation notes shown to the user (for example tax not configured). */
  note?: string;
}

export interface QuoteTotals {
  currency: string;
  maxUnits: number;
  /** Total DealDash charges (before tax) that can be collected in cash. */
  dealdashChargesHalalas: number;
  taxHalalas: number;
  taxStatus: 'NOT_CONFIGURED' | 'APPLIED' | 'NOT_APPLICABLE';
  /** Maximum cash payable to DealDash: charges and tax collected in cash (prepaid or on approved credit). */
  maxCashPayableToDealDashHalalas: number;
  /** Charges deducted from what DealDash pays the merchant (netted), shown separately. */
  nettedChargesHalalas: number;
  /** Maximum sponsor funding, in total and per sponsor. */
  maxSponsorLiabilityHalalas: number;
  sponsorLiability: Array<{ organizationId: string; amountHalalas: number }>;
  merchantCashContributionHalalas: number;
  /** Non-cash fulfilment commitment of the merchant (the benefit it honours). Never added to cash. */
  maxMerchantBenefitCommitmentHalalas: number;
  customerBenefitTotalHalalas: number;
  /** Informational: cash obligations plus the non-cash commitment, shown but never merged into one liability. */
  totalEconomicCommitmentHalalas: number;
  issues: string[];
}

export interface PricingContext {
  components: PricingComponent[];
  taxBps: number | null;
  currency: string;
}

const round = (n: number) => Math.round(n);

/**
 * Pure calculation of a commercial quotation. No value is hard-coded here: every rate comes from the pricing context (agreement
 * version or the Admin default), every volume from the campaign. Sponsor funding and merchant benefit are NEVER treated as
 * DealDash revenue, and cash is kept apart from non-cash commitments.
 */
export function calculateQuote(e: Economics, pricing: PricingContext): { lines: QuoteLine[]; totals: QuoteTotals } {
  const lines: QuoteLine[] = [];
  const issues: string[] = [];
  const units = e.maxUnits;

  // ---- DealDash charges
  if (e.mediaSpend && e.mediaSpend.totalHalalas > 0) {
    lines.push({
      kind: 'DEALDASH_CHARGE',
      code: 'media_spend',
      label: { en: 'Media spend (verified views)', ar: 'الإنفاق الإعلاني (المشاهدات الموثّقة)' },
      partyOrganizationId: e.ownerOrganizationId,
      partyRole: 'OWNER',
      basis: 'PER_UNIT',
      units,
      unitHalalas: e.mediaSpend.perUnitHalalas,
      amountHalalas: e.mediaSpend.totalHalalas,
      cash: true,
      collection: 'CASH',
      trigger: 'VERIFIED_REDEMPTION',
      taxable: false,
    });
  }
  for (const c of pricing.components.filter((x) => x.enabled)) {
    let amount = 0;
    let unitHalalas = 0;
    let lineUnits = 1;
    if (c.basis === 'FIXED') amount = c.amountHalalas ?? 0;
    else if (c.basis === 'PER_UNIT') {
      unitHalalas = c.amountHalalas ?? 0;
      lineUnits = units;
      amount = unitHalalas * units;
      if (units === 0 && unitHalalas > 0) issues.push(`UNBOUNDED_${c.code.toUpperCase()}`);
    } else {
      const bps = c.bps ?? 0;
      const baseTotal =
        c.base === 'MEDIA_SPEND'
          ? e.base.MEDIA_SPEND_TOTAL
          : (c.base === 'FACE_VALUE'
              ? e.base.FACE_VALUE
              : c.base === 'BENEFIT_VALUE'
                ? e.base.BENEFIT_VALUE
                : e.base.SELLING_PRICE) * units;
      amount = round((baseTotal * bps) / 10_000);
      unitHalalas = units > 0 ? round(amount / units) : 0;
      lineUnits = units;
      if (units === 0 && c.base !== 'MEDIA_SPEND' && bps > 0) issues.push(`UNBOUNDED_${c.code.toUpperCase()}`);
    }
    if (c.minimumHalalas && amount < c.minimumHalalas) amount = c.minimumHalalas;
    lines.push({
      kind: 'DEALDASH_CHARGE',
      code: c.code,
      label: c.label,
      partyOrganizationId: e.ownerOrganizationId,
      partyRole: 'OWNER',
      basis: c.basis,
      units: lineUnits,
      unitHalalas,
      amountHalalas: amount,
      cash: true,
      collection: c.collection,
      trigger: c.trigger,
      taxable: c.taxable,
    });
  }

  // ---- tax (configured only; never an invented rate)
  const taxable = lines.filter((l) => l.kind === 'DEALDASH_CHARGE' && l.taxable && l.collection === 'CASH');
  const taxBase = taxable.reduce((n, l) => n + l.amountHalalas, 0);
  const taxHalalas = pricing.taxBps === null ? 0 : round((taxBase * pricing.taxBps) / 10_000);
  const taxStatus: QuoteTotals['taxStatus'] =
    pricing.taxBps === null ? (taxBase > 0 ? 'NOT_CONFIGURED' : 'NOT_APPLICABLE') : 'APPLIED';
  lines.push({
    kind: 'TAX',
    code: 'tax',
    label: { en: 'Applicable tax', ar: 'الضريبة المطبقة' },
    partyOrganizationId: e.ownerOrganizationId,
    partyRole: 'OWNER',
    basis: 'PERCENT_OF_BASE',
    units: 1,
    unitHalalas: 0,
    amountHalalas: taxHalalas,
    cash: true,
    collection: 'CASH',
    trigger: 'UPFRONT',
    taxable: false,
    note: pricing.taxBps === null ? 'TAX_NOT_CONFIGURED_VALIDATE_KSA' : undefined,
  });

  // ---- sponsor funding (separate obligations, one line per sponsor)
  let sponsorPerUnit = 0;
  for (const s of e.sponsors.filter((x) => x.perUnitHalalas > 0)) {
    sponsorPerUnit += s.perUnitHalalas;
    if (units === 0) issues.push('UNBOUNDED_SPONSOR_FUNDING');
    lines.push({
      kind: 'SPONSOR_FUNDING',
      code: 'sponsor_funding',
      label: { en: 'Sponsor funding', ar: 'تمويل الراعي' },
      partyOrganizationId: s.organizationId,
      partyRole: 'SPONSOR',
      basis: 'PER_UNIT',
      units,
      unitHalalas: s.perUnitHalalas,
      amountHalalas: s.perUnitHalalas * units,
      cash: true,
      collection: 'CASH',
      trigger: s.trigger,
      taxable: false,
    });
  }

  // ---- merchant cash contribution (netted) and non-cash benefit commitment
  if (e.merchantCashPerUnit > 0)
    lines.push({
      kind: 'MERCHANT_CASH_CONTRIBUTION',
      code: 'merchant_cash',
      label: { en: 'Merchant cash contribution', ar: 'مساهمة التاجر النقدية' },
      partyOrganizationId: e.fulfilmentOrganizationId,
      partyRole: e.fulfilmentOrganizationId === e.ownerOrganizationId ? 'OWNER' : 'FULFILMENT_MERCHANT',
      basis: 'PER_UNIT',
      units,
      unitHalalas: e.merchantCashPerUnit,
      amountHalalas: e.merchantCashPerUnit * units,
      cash: true,
      collection: 'NETTED',
      trigger: 'VERIFIED_REDEMPTION',
      taxable: false,
    });
  const merchantBenefitPerUnit = Math.max(0, e.customerBenefitPerUnit - sponsorPerUnit - e.merchantCashPerUnit);
  if (sponsorPerUnit + e.merchantCashPerUnit > e.customerBenefitPerUnit && e.customerBenefitPerUnit > 0)
    issues.push('FUNDING_EXCEEDS_BENEFIT');
  if (merchantBenefitPerUnit > 0)
    lines.push({
      kind: 'MERCHANT_BENEFIT',
      code: 'merchant_benefit',
      label: { en: 'Merchant benefit / fulfilment commitment (non-cash)', ar: 'التزام التاجر بالمنفعة (غير نقدي)' },
      partyOrganizationId: e.fulfilmentOrganizationId,
      partyRole: e.fulfilmentOrganizationId === e.ownerOrganizationId ? 'OWNER' : 'FULFILMENT_MERCHANT',
      basis: 'PER_UNIT',
      units,
      unitHalalas: merchantBenefitPerUnit,
      amountHalalas: merchantBenefitPerUnit * units,
      cash: false,
      collection: null,
      trigger: 'VERIFIED_REDEMPTION',
      taxable: false,
    });
  if (merchantBenefitPerUnit > 0 && units === 0) issues.push('UNBOUNDED_MERCHANT_BENEFIT');
  if (e.customerBenefitPerUnit > 0)
    lines.push({
      kind: 'CUSTOMER_FUNDING',
      code: 'customer_benefit',
      label: { en: 'Customer saving (information)', ar: 'وفر العميل (للعلم)' },
      partyOrganizationId: null,
      partyRole: null,
      basis: 'PER_UNIT',
      units,
      unitHalalas: e.customerBenefitPerUnit,
      amountHalalas: e.customerBenefitPerUnit * units,
      cash: false,
      collection: null,
      trigger: null,
      taxable: false,
    });

  // ---- totals
  const sum = (f: (l: QuoteLine) => boolean) => lines.filter(f).reduce((n, l) => n + l.amountHalalas, 0);
  const charges = sum((l) => l.kind === 'DEALDASH_CHARGE' && l.collection === 'CASH');
  const netted = sum((l) => l.kind === 'DEALDASH_CHARGE' && l.collection === 'NETTED');
  const sponsorTotal = sum((l) => l.kind === 'SPONSOR_FUNDING');
  const merchantBenefit = sum((l) => l.kind === 'MERCHANT_BENEFIT');
  const merchantCash = sum((l) => l.kind === 'MERCHANT_CASH_CONTRIBUTION');
  const perSponsor = new Map<string, number>();
  for (const l of lines.filter((x) => x.kind === 'SPONSOR_FUNDING'))
    perSponsor.set(l.partyOrganizationId!, (perSponsor.get(l.partyOrganizationId!) ?? 0) + l.amountHalalas);
  const totals: QuoteTotals = {
    currency: e.currency,
    maxUnits: units,
    dealdashChargesHalalas: charges + netted,
    taxHalalas,
    taxStatus,
    maxCashPayableToDealDashHalalas: charges + taxHalalas,
    nettedChargesHalalas: netted,
    maxSponsorLiabilityHalalas: sponsorTotal,
    sponsorLiability: [...perSponsor].map(([organizationId, amountHalalas]) => ({ organizationId, amountHalalas })),
    merchantCashContributionHalalas: merchantCash,
    maxMerchantBenefitCommitmentHalalas: merchantBenefit,
    customerBenefitTotalHalalas: sum((l) => l.kind === 'CUSTOMER_FUNDING'),
    totalEconomicCommitmentHalalas: charges + taxHalalas + netted + sponsorTotal + merchantCash + merchantBenefit,
    issues: [...new Set(issues)],
  };
  return { lines, totals };
}

/** Stable fingerprint of the economics a quotation was based on: any change to it supersedes an earlier acceptance. */
export function economicsHash(e: Economics, pricingVersionKey: string): string {
  const stable = {
    p: pricingVersionKey,
    c: e.currency,
    u: e.maxUnits,
    b: e.base,
    cb: e.customerBenefitPerUnit,
    s: [...e.sponsors].sort((a, b) => a.organizationId.localeCompare(b.organizationId)),
    m: e.merchantCashPerUnit,
    o: e.ownerOrganizationId,
    f: e.fulfilmentOrganizationId,
    ms: e.mediaSpend ?? null,
    v: e.validity,
    i: e.inventory,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 32);
}

/** Original, additional and revised commitments for an amendment (never a silent increase). */
export function amendmentDelta(original: QuoteTotals, revised: QuoteTotals) {
  const d = (a: number, b: number) => ({ original: a, additional: b - a, revised: b });
  return {
    maxCashPayableToDealDash: d(original.maxCashPayableToDealDashHalalas, revised.maxCashPayableToDealDashHalalas),
    maxSponsorLiability: d(original.maxSponsorLiabilityHalalas, revised.maxSponsorLiabilityHalalas),
    maxMerchantBenefitCommitment: d(
      original.maxMerchantBenefitCommitmentHalalas,
      revised.maxMerchantBenefitCommitmentHalalas,
    ),
    totalEconomicCommitment: d(original.totalEconomicCommitmentHalalas, revised.totalEconomicCommitmentHalalas),
    maxUnits: d(original.maxUnits, revised.maxUnits),
    increasesExposure:
      revised.maxCashPayableToDealDashHalalas > original.maxCashPayableToDealDashHalalas ||
      revised.maxSponsorLiabilityHalalas > original.maxSponsorLiabilityHalalas ||
      revised.maxMerchantBenefitCommitmentHalalas > original.maxMerchantBenefitCommitmentHalalas ||
      revised.merchantCashContributionHalalas > original.merchantCashContributionHalalas ||
      revised.maxUnits > original.maxUnits,
  };
}
