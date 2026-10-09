/**
 * Phase 5: shared billing and finance vocabulary (one platform for subscriptions, licences, campaigns, vouchers, Watch & Earn,
 * loyalty, placements and future products). Product economics stay in the products; nothing here is product specific.
 * Money is an integer in the minor unit of an explicit currency.
 */

export const BILLING_ACCOUNT_STATUSES = [
  'ACTIVE',
  'CREDIT_HOLD',
  'FINANCIAL_HOLD',
  'SUSPENDED',
  'CLOSED',
] as const;
export type BillingAccountStatus = (typeof BILLING_ACCOUNT_STATUSES)[number];
export const BILLING_FREQUENCIES = [
  'PER_EVENT',
  'MONTHLY',
  'QUARTERLY',
  'ANNUAL',
  'ON_DEMAND',
] as const;
export type BillingFrequency = (typeof BILLING_FREQUENCIES)[number];
export const BILLING_METHODS = [
  'INVOICE',
  'BANK_TRANSFER',
  'CARD',
  'PREPAID_BALANCE',
  'DIRECT_DEBIT',
] as const;
export type BillingMethod = (typeof BILLING_METHODS)[number];

/** Configurable billing models (a contract or price item picks one; none is hard-coded as "the" model). */
export const BILLING_MODELS = [
  'SUBSCRIPTION',
  'ENTERPRISE_LICENCE',
  'NETWORK_LICENCE',
  'SETUP_FEE',
  'INTEGRATION_FEE',
  'API_FEE',
  'FIXED_CAMPAIGN_FEE',
  'USAGE',
  'COST_PER_QUALIFIED_VIEW',
  'COST_PER_ENGAGEMENT',
  'COST_PER_ACTION',
  'VERIFIED_REDEMPTION_FEE',
  'PERCENTAGE_FEE',
  'COMMISSION',
  'PREPAID',
  'POSTPAID',
  'DEPOSIT_PLUS_USAGE',
  'APPROVED_CREDIT',
  'RECURRING',
  'CONTRACT_SPECIFIC',
] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];

/**
 * How a billing event is collected. Only INVOICE_DUE creates a receivable through periodic invoicing; the others were already funded,
 * are netted at settlement, or are invoiced by the commercial-case closure: the same usage is never billed twice.
 */
export const BILLING_COLLECTIONS = [
  'INVOICE_DUE',
  'PREPAID_DRAWDOWN',
  'NETTED_FROM_PAYABLE',
  'CAMPAIGN_CASE',
  'NOT_BILLABLE',
] as const;
export type BillingCollection = (typeof BILLING_COLLECTIONS)[number];

export const FINANCE_DOCUMENT_KINDS = [
  'PROFORMA_INVOICE',
  'TAX_INVOICE',
  'INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'RECEIPT',
  'ADJUSTMENT_NOTE',
  'PURCHASE_ORDER',
  'STATEMENT',
] as const;
export type FinanceDocumentKind = (typeof FINANCE_DOCUMENT_KINDS)[number];
export const RECEIVABLE_DOCUMENT_TYPES: readonly FinanceDocumentKind[] = [
  'TAX_INVOICE',
  'INVOICE',
  'DEBIT_NOTE',
];

export const FINANCE_DOCUMENT_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'ISSUED',
  'SENT',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'DISPUTED',
  'CANCELLED',
  'CREDITED',
  'WRITTEN_OFF',
  'VOID',
] as const;
export type FinanceDocumentState = (typeof FINANCE_DOCUMENT_STATUSES)[number];
/** Once a document leaves these states its amounts, lines and party never change (corrections are notes). */
export const EDITABLE_DOCUMENT_STATUSES: readonly FinanceDocumentState[] = [
  'DRAFT',
  'PENDING_APPROVAL',
];
/** States in which an amount is still owed. */
export const OPEN_RECEIVABLE_STATUSES: readonly FinanceDocumentState[] = [
  'ISSUED',
  'SENT',
  'PARTIALLY_PAID',
  'OVERDUE',
  'DISPUTED',
];

export const AGING_BUCKETS = ['CURRENT', 'D1_30', 'D31_60', 'D61_90', 'D90_PLUS'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const QUOTATION_DECISIONS = ['ACCEPT', 'REJECT', 'REQUEST_MODIFICATION'] as const;

export const FX_RATE_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETIRED'] as const;

/** Reconciliation flows per product, in order. */
export const RECONCILIATION_FLOWS = {
  WATCH: [
    'FUNDED',
    'UTILIZED',
    'POINTS_ISSUED',
    'REWARDS_ALLOCATED',
    'REWARDS_REDEEMED',
    'EXPIRED',
    'UNUSED',
  ],
  EXCLUSIVE: ['SPONSOR_COMMITMENT', 'UTILIZED', 'REMAINING', 'RECONCILED'],
  VOUCHER: [
    'CUSTOMER_CASH',
    'VOUCHERS_ISSUED',
    'REDEEMED',
    'MERCHANT_PAYABLE',
    'REFUNDED',
    'SETTLED',
  ],
  LOYALTY: ['FUNDED', 'ISSUED', 'REDEEMED', 'EXPIRED', 'REVERSED', 'REMAINING'],
} as const;
