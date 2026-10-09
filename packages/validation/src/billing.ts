import { z } from 'zod';
import {
  BILLING_ACCOUNT_STATUSES,
  BILLING_FREQUENCIES,
  BILLING_METHODS,
  FINANCE_DOCUMENT_KINDS,
  FINANCE_DOCUMENT_STATUSES,
} from '@dealdash/types';

const uuid = z.string().uuid();
const iso = z.string().datetime({ offset: true });
const currency = z.string().trim().length(3).toUpperCase();
const minor = z.number().int().positive().max(1_000_000_000_000);
const reason = z.string().trim().min(3).max(500);
const contact = z
  .object({
    name: z.string().trim().max(120).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    phone: z.string().trim().max(30).optional(),
  })
  .strict();
const address = z
  .object({
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
    country: z.string().trim().length(2).toUpperCase().optional(),
  })
  .strict();

export const quotationDeclineSchema = z.object({
  quotationId: uuid,
  decision: z.enum(['REJECT', 'REQUEST_MODIFICATION']),
  reason,
});

export const billingAccountPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(200).nullable().optional(),
    billingAddress: address.optional(),
    financeContact: contact.optional(),
    invoiceContact: contact.optional(),
    taxId: z.string().trim().max(40).nullable().optional(),
    paymentTermsDays: z.number().int().min(0).max(180).optional(),
    billingFrequency: z.enum(BILLING_FREQUENCIES).optional(),
    billingMethod: z.enum(BILLING_METHODS).optional(),
    contractId: uuid.nullable().optional(),
    poRequired: z.boolean().optional(),
  })
  .strict();

export const billingAccountStatusSchema = z.object({
  status: z.enum(BILLING_ACCOUNT_STATUSES),
  reason,
});

export const purchaseOrderSchema = z.object({
  organizationId: uuid.optional(),
  legalEntityId: uuid.nullable().optional(),
  currency,
  poNumber: z.string().trim().min(1).max(60),
  valueMinor: minor,
  expiresAt: iso.nullable().optional(),
  fileId: uuid.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const fxRateSchema = z.object({
  baseCurrency: currency,
  quoteCurrency: currency,
  rate: z
    .string()
    .trim()
    .regex(/^[0-9]+(\.[0-9]{1,10})?$/, 'A positive decimal with up to 10 places'),
  source: z.string().trim().min(2).max(80),
  rateDate: iso,
});

export const billingRunSchema = z.object({
  organizationId: uuid.optional(),
  force: z.boolean().default(false),
});

export const financeNoteSchema = z.object({
  kind: z.enum(['CREDIT_NOTE', 'DEBIT_NOTE']),
  amountMinor: minor,
  reason,
});

export const billingPaymentSchema = z.object({
  businessAccountId: uuid,
  amountMinor: minor,
  currency,
  method: z.enum(['BANK_TRANSFER', 'CARD', 'CHEQUE', 'CASH', 'OFFSET', 'OTHER']),
  externalReference: z.string().trim().max(100).nullable().optional(),
  receivedAt: iso.nullable().optional(),
  allocations: z
    .array(z.object({ documentId: uuid, amountMinor: minor }))
    .max(50)
    .optional(),
});

export const paymentAllocationSchema = z.object({ documentId: uuid, amountMinor: minor });

export const invoiceDisputeSchema = z.object({ reason });
export const disputeResolutionSchema = z.object({
  outcome: z.enum(['UPHELD', 'REJECTED']),
  creditMinor: minor.optional(),
  reason,
});
export const documentReasonSchema = z.object({ reason });

export const proformaSchema = z
  .object({
    organizationId: uuid,
    caseId: uuid.optional(),
    currency: currency.optional(),
    lines: z
      .array(z.object({ description: z.string().trim().min(2).max(200), amountMinor: minor }))
      .max(50)
      .optional(),
  })
  .refine((b) => b.caseId || (b.lines && b.lines.length), {
    message: 'A case or at least one line is required',
  });

export const statementQuerySchema = z.object({ from: iso, to: iso });

export const financeDocumentQuerySchema = z.object({
  organizationId: uuid.optional(),
  type: z.enum(FINANCE_DOCUMENT_KINDS).optional(),
  status: z.enum(FINANCE_DOCUMENT_STATUSES).optional(),
  businessAccountId: uuid.optional(),
});

export const reconciliationQuerySchema = z.object({
  by: z.enum([
    'BUSINESS_ACCOUNT',
    'LEGAL_ENTITY',
    'PRODUCT',
    'CAMPAIGN',
    'FUNDING_PARTY',
    'MERCHANT',
    'SPONSOR',
    'CURRENCY',
  ]),
  organizationId: uuid.optional(),
  currency: currency.optional(),
  from: iso.optional(),
  to: iso.optional(),
});

export const receivablesQuerySchema = z.object({ organizationId: uuid.optional() });
