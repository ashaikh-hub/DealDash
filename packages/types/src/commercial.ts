/**
 * Shared commercial governance and finance vocabulary (Vouchers, Watch & Earn, Exclusive Deals, later products).
 *
 * Principle: any action that creates a DealDash charge, a sponsor or merchant funding obligation, an inventory commitment, a
 * customer-benefit commitment, a financial liability or a reimbursement obligation must (1) calculate the economics, (2) show
 * them to the responsible business entity, (3) identify who owes / commits what, (4) obtain the required approval, (5) obtain
 * explicit acknowledgement, (6) preserve the accepted version, (7) prevent silent increases, (8) feed Finance, (9) track actual
 * utilisation and (10) reconcile at closure. Money is integer halalas. No rate, threshold or tax value is hard-coded:
 * everything comes from configuration, agreements or Admin settings. Statutory formats and tax / accounting recognition are
 * VALIDATE-KSA and configurable.
 */

export const COMMERCIAL_PRODUCTS = [
  'VOUCHER',
  'WATCH',
  'EXCLUSIVE',
  'LIVE_BENEFIT',
  'LOYALTY',
] as const;
export type CommercialProduct = (typeof COMMERCIAL_PRODUCTS)[number];

/** Commercial status is independent of the campaign's operational status (an approved campaign can still be blocked). */
export const COMMERCIAL_STATUSES = [
  'PRICING_DRAFT',
  'AWAITING_ACCEPTANCE',
  'ACCEPTED',
  'AWAITING_FUNDING',
  'PARTIALLY_FUNDED',
  'FULLY_FUNDED',
  'CREDIT_APPROVED',
  'FINANCIAL_HOLD',
  'RECONCILED',
  'CLOSED',
] as const;
export type CommercialStatus = (typeof COMMERCIAL_STATUSES)[number];

export const PRICING_BASES = ['FIXED', 'PER_UNIT', 'PERCENT_OF_BASE'] as const;
export type PricingBasis = (typeof PRICING_BASES)[number];
export const PRICING_BASE_OF = [
  'SELLING_PRICE',
  'FACE_VALUE',
  'MEDIA_SPEND',
  'BENEFIT_VALUE',
] as const;
export type PricingBaseOf = (typeof PRICING_BASE_OF)[number];
/** When the charge is incurred. UPFRONT is earned at activation, the others per verified event. */
export const CHARGE_TRIGGERS = ['UPFRONT', 'VERIFIED_REDEMPTION', 'SALE'] as const;
export type ChargeTrigger = (typeof CHARGE_TRIGGERS)[number];
/** CASH is collected from the party (prepaid or on credit); NETTED is deducted from what DealDash pays the merchant. */
export const COLLECTION_METHODS = ['CASH', 'NETTED'] as const;
export type CollectionMethod = (typeof COLLECTION_METHODS)[number];

export interface PricingComponent {
  code: string;
  label: { en: string; ar: string };
  enabled: boolean;
  basis: PricingBasis;
  /** FIXED: amount. PER_UNIT: amount per redemption / voucher / view. */
  amountHalalas?: number;
  /** PERCENT_OF_BASE: basis points of `base` x units. */
  bps?: number;
  base?: PricingBaseOf;
  trigger: ChargeTrigger;
  collection: CollectionMethod;
  taxable: boolean;
  /** The line is never lower than this (a minimum campaign charge). */
  minimumHalalas?: number;
}

export const QUOTE_LINE_KINDS = [
  'DEALDASH_CHARGE',
  'SPONSOR_FUNDING',
  'MERCHANT_CASH_CONTRIBUTION',
  'MERCHANT_BENEFIT',
  'CUSTOMER_FUNDING',
  'TAX',
] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export const PARTY_ROLES = ['OWNER', 'SPONSOR', 'FULFILMENT_MERCHANT'] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const FUNDING_MODES = ['PREPAID', 'CREDIT'] as const;
export type FundingMode = (typeof FUNDING_MODES)[number];

export const APPROVAL_STEPS = ['INTERNAL_APPROVER', 'FINANCE_APPROVER'] as const;
export type ApprovalStep = (typeof APPROVAL_STEPS)[number];

/** Commercial agreement drives the treatment of unused sponsor funding. There is no global default. */
export const UNUSED_TREATMENTS = [
  'REFUND',
  'CREDIT_ACCOUNT',
  'CARRY_FORWARD',
  'TRANSFER_CAMPAIGN',
  'NON_REFUNDABLE',
] as const;
export type UnusedTreatment = (typeof UNUSED_TREATMENTS)[number];

export const FINANCE_DOCUMENT_TYPES = [
  'INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'RECEIPT',
  'PURCHASE_ORDER',
] as const;
export type FinanceDocumentType = (typeof FINANCE_DOCUMENT_TYPES)[number];

export const CREDIT_STATUSES = [
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
  'REJECTED',
] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

/** The seven explicit acknowledgements. Which ones apply depends on the party's lines in the quotation. */
export const ACCEPTANCE_CHECKS = [
  'REVIEWED_TERMS',
  'UNDERSTAND_CHARGES',
  'CONFIRM_FUNDING',
  'CONFIRM_BENEFIT',
  'CONFIRM_INVENTORY',
  'HONOUR_REDEMPTIONS',
  'ACCEPT_TERMS',
] as const;
export type AcceptanceCheck = (typeof ACCEPTANCE_CHECKS)[number];
/** Bumped when the wording changes; stored with every acceptance. */
export const ACCEPTANCE_TEXT_VERSION = '2026-11-v1';

export const FINANCIAL_ACTIONS_NOTE =
  'Statutory invoice formats, e-invoicing, tax documents and accounting recognition are configurable and VALIDATE-KSA.';
