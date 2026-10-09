-- CreateEnum
CREATE TYPE "CommercialProduct" AS ENUM ('VOUCHER', 'WATCH', 'EXCLUSIVE', 'LIVE_BENEFIT');

-- CreateEnum
CREATE TYPE "CommercialStatus" AS ENUM ('PRICING_DRAFT', 'AWAITING_ACCEPTANCE', 'ACCEPTED', 'AWAITING_FUNDING', 'PARTIALLY_FUNDED', 'FULLY_FUNDED', 'CREDIT_APPROVED', 'FINANCIAL_HOLD', 'RECONCILED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'PENDING_ACCEPTANCE', 'ACCEPTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PartyRole" AS ENUM ('OWNER', 'SPONSOR', 'FULFILMENT_MERCHANT');

-- CreateEnum
CREATE TYPE "ApprovalStepKind" AS ENUM ('INTERNAL_APPROVER', 'FINANCE_APPROVER');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FundingMode" AS ENUM ('PREPAID', 'CREDIT');

-- CreateEnum
CREATE TYPE "CommitmentKind" AS ENUM ('CHARGE', 'SPONSOR_FUNDING');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FinanceDocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'RECEIPT', 'PURCHASE_ORDER');

-- CreateEnum
CREATE TYPE "FinanceDocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PricingScope" AS ENUM ('GLOBAL', 'ENTITY_TYPE', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "UnusedTreatment" AS ENUM ('REFUND', 'CREDIT_ACCOUNT', 'CARRY_FORWARD', 'TRANSFER_CAMPAIGN', 'NON_REFUNDABLE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerAccountFamily" ADD VALUE 'CAMPAIGN_FUNDS_HELD';
ALTER TYPE "LedgerAccountFamily" ADD VALUE 'RECEIVABLE';
ALTER TYPE "LedgerAccountFamily" ADD VALUE 'FUNDING_UTILIZED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerJournalType" ADD VALUE 'FUNDING_RECEIVED';
ALTER TYPE "LedgerJournalType" ADD VALUE 'FUNDING_UTILIZED';
ALTER TYPE "LedgerJournalType" ADD VALUE 'FUNDING_RELEASED';
ALTER TYPE "LedgerJournalType" ADD VALUE 'DOCUMENT_ADJUSTMENT';

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "taxNumber" TEXT,
    "country" TEXT NOT NULL DEFAULT 'SA',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessAccount" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "fundingMode" "FundingMode" NOT NULL DEFAULT 'PREPAID',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingAgreement" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "PricingScope" NOT NULL,
    "organizationId" UUID,
    "entityType" TEXT,
    "market" TEXT,
    "product" "CommercialProduct",
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingAgreementVersion" (
    "id" UUID NOT NULL,
    "agreementId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "components" JSONB NOT NULL,
    "taxBps" INTEGER,
    "unusedTreatment" "UnusedTreatment",
    "reference" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingAgreementVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialApprovalRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "scope" TEXT NOT NULL DEFAULT 'CAMPAIGN',
    "product" "CommercialProduct",
    "entityType" TEXT,
    "organizationId" UUID,
    "riskTier" TEXT,
    "minLiabilityHalalas" INTEGER,
    "steps" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialCase" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "product" "CommercialProduct" NOT NULL,
    "subjectId" UUID NOT NULL,
    "ownerOrganizationId" UUID NOT NULL,
    "fulfilmentOrganizationId" UUID NOT NULL,
    "businessAccountId" UUID,
    "status" "CommercialStatus" NOT NULL DEFAULT 'PRICING_DRAFT',
    "unusedTreatment" "UnusedTreatment",
    "transferTargetCaseId" UUID,
    "currentQuotationId" UUID,
    "acceptedQuotationId" UUID,
    "developmentFixture" BOOLEAN NOT NULL DEFAULT false,
    "maxCashHalalas" INTEGER NOT NULL DEFAULT 0,
    "benefitCommitmentHalalas" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CommercialCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "inputs" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "pricingVersionId" UUID,
    "pricingSnapshot" JSONB NOT NULL DEFAULT '{}',
    "unusedTreatment" "UnusedTreatment",
    "requiredParties" JSONB NOT NULL DEFAULT '[]',
    "delta" JSONB,
    "createdByUserId" UUID NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialAcceptance" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "caseId" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "role" "PartyRole" NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID,
    "userId" UUID NOT NULL,
    "userRole" TEXT,
    "userName" TEXT,
    "onBehalfAuthorizationId" UUID,
    "checks" JSONB NOT NULL,
    "textVersion" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "amounts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "CommercialAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialApproval" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "step" "ApprovalStepKind" NOT NULL,
    "status" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" UUID,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "CommercialApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingCommitment" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "role" "PartyRole" NOT NULL,
    "kind" "CommitmentKind" NOT NULL,
    "mode" "FundingMode" NOT NULL,
    "upfrontHalalas" INTEGER NOT NULL DEFAULT 0,
    "usageMaxHalalas" INTEGER NOT NULL DEFAULT 0,
    "perUnitHalalas" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL DEFAULT 'VERIFIED_REDEMPTION',
    "receivedHalalas" INTEGER NOT NULL DEFAULT 0,
    "upfrontEarnedHalalas" INTEGER NOT NULL DEFAULT 0,
    "utilizedHalalas" INTEGER NOT NULL DEFAULT 0,
    "releasedHalalas" INTEGER NOT NULL DEFAULT 0,
    "adapterManaged" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingCommitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtilizationEvent" (
    "id" UUID NOT NULL,
    "commitmentId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "amountHalalas" INTEGER NOT NULL,
    "journalId" UUID,
    "reversedAt" TIMESTAMP(3),
    "reversalJournalId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UtilizationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancePayment" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "businessAccountId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "caseId" UUID,
    "commitmentId" UUID,
    "documentId" UUID,
    "amountHalalas" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "externalReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "recordedByUserId" UUID,
    "recordedByRole" TEXT,
    "journalId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceDocument" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" "FinanceDocumentType" NOT NULL,
    "status" "FinanceDocumentStatus" NOT NULL DEFAULT 'ISSUED',
    "businessAccountId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "caseId" UUID,
    "relatedDocumentId" UUID,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "subtotalHalalas" INTEGER NOT NULL DEFAULT 0,
    "taxHalalas" INTEGER NOT NULL DEFAULT 0,
    "totalHalalas" INTEGER NOT NULL DEFAULT 0,
    "paidHalalas" INTEGER NOT NULL DEFAULT 0,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "statutory" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditFacility" (
    "id" UUID NOT NULL,
    "businessAccountId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "limitHalalas" INTEGER NOT NULL,
    "paymentTermsDays" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "agreementReference" TEXT NOT NULL,
    "status" "CreditStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requestedByUserId" UUID NOT NULL,
    "requestedByName" TEXT,
    "decidedByUserId" UUID,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditFacility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialHold" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "businessAccountId" UUID,
    "caseId" UUID,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "placedByUserId" UUID NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedByUserId" UUID,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "FinancialHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceAdjustment" (
    "id" UUID NOT NULL,
    "caseId" UUID,
    "businessAccountId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amountHalalas" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "documentId" UUID,
    "journalId" UUID,
    "createdByUserId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseReconciliation" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "snapshot" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedByUserId" UUID,
    "closedAt" TIMESTAMP(3),
    "treatment" JSONB,

    CONSTRAINT "CaseReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceSequence" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FinanceSequence_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AdminAuthorization" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ACT_ON_BEHALF',
    "reference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalEntity_organizationId_idx" ON "LegalEntity"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_organizationId_legalName_key" ON "LegalEntity"("organizationId", "legalName");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessAccount_organizationId_currency_key" ON "BusinessAccount"("organizationId", "currency");

-- CreateIndex
CREATE INDEX "PricingAgreement_scope_status_idx" ON "PricingAgreement"("scope", "status");

-- CreateIndex
CREATE INDEX "PricingAgreement_organizationId_idx" ON "PricingAgreement"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingAgreementVersion_agreementId_version_key" ON "PricingAgreementVersion"("agreementId", "version");

-- CreateIndex
CREATE INDEX "CommercialApprovalRule_scope_active_idx" ON "CommercialApprovalRule"("scope", "active");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialCase_reference_key" ON "CommercialCase"("reference");

-- CreateIndex
CREATE INDEX "CommercialCase_ownerOrganizationId_idx" ON "CommercialCase"("ownerOrganizationId");

-- CreateIndex
CREATE INDEX "CommercialCase_fulfilmentOrganizationId_idx" ON "CommercialCase"("fulfilmentOrganizationId");

-- CreateIndex
CREATE INDEX "CommercialCase_status_idx" ON "CommercialCase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialCase_product_subjectId_key" ON "CommercialCase"("product", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_reference_key" ON "Quotation"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_caseId_version_key" ON "Quotation"("caseId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAcceptance_reference_key" ON "CommercialAcceptance"("reference");

-- CreateIndex
CREATE INDEX "CommercialAcceptance_caseId_idx" ON "CommercialAcceptance"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialAcceptance_quotationId_role_organizationId_key" ON "CommercialAcceptance"("quotationId", "role", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialApproval_quotationId_step_key" ON "CommercialApproval"("quotationId", "step");

-- CreateIndex
CREATE INDEX "FundingCommitment_caseId_idx" ON "FundingCommitment"("caseId");

-- CreateIndex
CREATE INDEX "FundingCommitment_organizationId_idx" ON "FundingCommitment"("organizationId");

-- CreateIndex
CREATE INDEX "UtilizationEvent_caseId_idx" ON "UtilizationEvent"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "UtilizationEvent_commitmentId_sourceType_sourceId_key" ON "UtilizationEvent"("commitmentId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePayment_reference_key" ON "FinancePayment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "FinancePayment_idempotencyKey_key" ON "FinancePayment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancePayment_organizationId_receivedAt_idx" ON "FinancePayment"("organizationId", "receivedAt");

-- CreateIndex
CREATE INDEX "FinancePayment_caseId_idx" ON "FinancePayment"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceDocument_number_key" ON "FinanceDocument"("number");

-- CreateIndex
CREATE INDEX "FinanceDocument_organizationId_type_idx" ON "FinanceDocument"("organizationId", "type");

-- CreateIndex
CREATE INDEX "FinanceDocument_caseId_idx" ON "FinanceDocument"("caseId");

-- CreateIndex
CREATE INDEX "CreditFacility_organizationId_status_idx" ON "CreditFacility"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FinancialHold_organizationId_status_idx" ON "FinancialHold"("organizationId", "status");

-- CreateIndex
CREATE INDEX "FinancialHold_caseId_status_idx" ON "FinancialHold"("caseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceAdjustment_idempotencyKey_key" ON "FinanceAdjustment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinanceAdjustment_organizationId_idx" ON "FinanceAdjustment"("organizationId");

-- CreateIndex
CREATE INDEX "CaseReconciliation_caseId_computedAt_idx" ON "CaseReconciliation"("caseId", "computedAt");

-- CreateIndex
CREATE INDEX "AdminAuthorization_organizationId_idx" ON "AdminAuthorization"("organizationId");

-- AddForeignKey
ALTER TABLE "BusinessAccount" ADD CONSTRAINT "BusinessAccount_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingAgreementVersion" ADD CONSTRAINT "PricingAgreementVersion_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "PricingAgreement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CommercialCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialAcceptance" ADD CONSTRAINT "CommercialAcceptance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CommercialCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialAcceptance" ADD CONSTRAINT "CommercialAcceptance_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialApproval" ADD CONSTRAINT "CommercialApproval_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CommercialCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialApproval" ADD CONSTRAINT "CommercialApproval_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingCommitment" ADD CONSTRAINT "FundingCommitment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CommercialCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ================================================================ hand-written guarantees
ALTER TABLE "FundingCommitment"
  ADD CONSTRAINT "FundingCommitment_amounts_non_negative" CHECK ("upfrontHalalas" >= 0 AND "usageMaxHalalas" >= 0 AND "perUnitHalalas" >= 0 AND "receivedHalalas" >= 0 AND "upfrontEarnedHalalas" >= 0 AND "utilizedHalalas" >= 0 AND "releasedHalalas" >= 0),
  ADD CONSTRAINT "FundingCommitment_earned_within_upfront" CHECK ("upfrontEarnedHalalas" <= "upfrontHalalas"),
  -- Financial exposure can never silently exceed the approved commitment.
  ADD CONSTRAINT "FundingCommitment_utilized_within_max" CHECK ("utilizedHalalas" <= "usageMaxHalalas");
ALTER TABLE "FinancePayment" ADD CONSTRAINT "FinancePayment_amount_positive" CHECK ("amountHalalas" > 0);
ALTER TABLE "FinanceAdjustment" ADD CONSTRAINT "FinanceAdjustment_amount_positive" CHECK ("amountHalalas" > 0 AND "kind" IN ('CREDIT', 'DEBIT'));
ALTER TABLE "CreditFacility" ADD CONSTRAINT "CreditFacility_limit_positive" CHECK ("limitHalalas" > 0 AND "paymentTermsDays" >= 0);
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_amounts" CHECK ("subtotalHalalas" >= 0 AND "taxHalalas" >= 0 AND "totalHalalas" >= 0 AND "paidHalalas" >= 0);
-- At most one pending or active credit facility per business account.
CREATE UNIQUE INDEX "CreditFacility_one_open" ON "CreditFacility"("businessAccountId") WHERE "status" IN ('PENDING_APPROVAL', 'ACTIVE');
-- At most one active financial hold per case / per organisation-wide hold.
CREATE UNIQUE INDEX "FinancialHold_one_active_case" ON "FinancialHold"("caseId") WHERE "status" = 'ACTIVE' AND "caseId" IS NOT NULL;
CREATE UNIQUE INDEX "FinancialHold_one_active_org" ON "FinancialHold"("organizationId") WHERE "status" = 'ACTIVE' AND "caseId" IS NULL;
-- The accepted commercial record is permanent.
CREATE TRIGGER "CommercialAcceptance_append_only" BEFORE UPDATE OR DELETE ON "CommercialAcceptance" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();