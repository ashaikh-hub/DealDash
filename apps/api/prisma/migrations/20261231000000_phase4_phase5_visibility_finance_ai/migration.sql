-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FinanceDocumentStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "FinanceDocumentStatus" ADD VALUE 'SENT';
ALTER TYPE "FinanceDocumentStatus" ADD VALUE 'PARTIALLY_PAID';
ALTER TYPE "FinanceDocumentStatus" ADD VALUE 'OVERDUE';
ALTER TYPE "FinanceDocumentStatus" ADD VALUE 'DISPUTED';
ALTER TYPE "FinanceDocumentStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "FinanceDocumentStatus" ADD VALUE 'CREDITED';
ALTER TYPE "FinanceDocumentStatus" ADD VALUE 'WRITTEN_OFF';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FinanceDocumentType" ADD VALUE 'PROFORMA_INVOICE';
ALTER TYPE "FinanceDocumentType" ADD VALUE 'TAX_INVOICE';
ALTER TYPE "FinanceDocumentType" ADD VALUE 'ADJUSTMENT_NOTE';
ALTER TYPE "FinanceDocumentType" ADD VALUE 'STATEMENT';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ALERT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "QuotationStatus" ADD VALUE 'REJECTED';
ALTER TYPE "QuotationStatus" ADD VALUE 'MODIFICATION_REQUESTED';
ALTER TYPE "QuotationStatus" ADD VALUE 'EXPIRED';

-- DropIndex
DROP INDEX "BusinessAccount_organizationId_currency_key";

-- AlterTable
ALTER TABLE "BusinessAccount" ADD COLUMN     "billingAddress" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "billingFrequency" TEXT NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "billingMethod" TEXT NOT NULL DEFAULT 'INVOICE',
ADD COLUMN     "contractId" UUID,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'SA',
ADD COLUMN     "financeContact" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "invoiceContact" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastBilledAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT,
ADD COLUMN     "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "poRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "CommercialBillingEvent" ADD COLUMN     "collection" TEXT,
ADD COLUMN     "invoiceLineId" UUID,
ADD COLUMN     "settlementRef" TEXT;

-- AlterTable
ALTER TABLE "FinanceDocument" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" UUID,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "contractId" UUID,
ADD COLUMN     "disputeCaseId" UUID,
ADD COLUMN     "disputedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "externalReference" TEXT,
ADD COLUMN     "fileId" UUID,
ADD COLUMN     "fxRate" TEXT,
ADD COLUMN     "fxRateId" UUID,
ADD COLUMN     "legalEntityId" UUID,
ADD COLUMN     "overdueAt" TIMESTAMP(3),
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "purchaseOrderId" UUID,
ADD COLUMN     "quotationId" UUID,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "settlementCurrency" TEXT,
ADD COLUMN     "sourceKind" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "taxAmountInTaxCurrency" INTEGER,
ADD COLUMN     "taxCurrency" TEXT,
ADD COLUMN     "transactionCurrency" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "writtenOffAt" TIMESTAMP(3),
ADD COLUMN     "writtenOffByUserId" UUID;

-- AlterTable
ALTER TABLE "FinancePayment" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'SAR',
ADD COLUMN     "legalEntityId" UUID;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "modificationRequest" TEXT,
ADD COLUMN     "modificationRequestedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedByUserId" UUID,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "validUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "eventClass" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" UUID,
    "legalEntityId" UUID,
    "unitId" UUID,
    "branchId" UUID,
    "campaignId" UUID,
    "country" TEXT,
    "city" TEXT,
    "userId" UUID,
    "anonymousId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amountMinor" INTEGER,
    "currency" TEXT,
    "points" INTEGER,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "financeRefType" TEXT,
    "financeRefId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsWatermark" (
    "source" TEXT NOT NULL,
    "cursorAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsWatermark_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "MetricAggregate" (
    "id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT '',
    "legalEntityId" TEXT NOT NULL DEFAULT '',
    "branchId" TEXT NOT NULL DEFAULT '',
    "campaignId" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,
    "amountMinor" BIGINT NOT NULL DEFAULT 0,
    "points" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT '',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTarget" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "product" TEXT,
    "campaignId" UUID,
    "branchId" UUID,
    "legalEntityId" UUID,
    "targetValue" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "currency" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'UP',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "thresholds" INTEGER[] DEFAULT ARRAY[25, 50, 75, 90, 100]::INTEGER[],
    "lastMilestone" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "threshold" INTEGER,
    "thresholds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "frequency" TEXT NOT NULL DEFAULT 'IMMEDIATE',
    "severity" TEXT,
    "channels" TEXT[] DEFAULT ARRAY['IN_APP']::TEXT[],
    "recipientRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recipientUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "legalEntityId" UUID,
    "country" TEXT,
    "branchId" UUID,
    "product" TEXT,
    "campaignId" UUID,
    "escalation" JSONB NOT NULL DEFAULT '[]',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" UUID NOT NULL,
    "ruleId" UUID,
    "organizationId" UUID,
    "code" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "legalEntityId" UUID,
    "branchId" UUID,
    "campaignId" UUID,
    "product" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "action" TEXT,
    "actionHref" TEXT,
    "actionPermission" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "nextEscalationAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "userId" UUID,
    "channel" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY['IN_APP']::TEXT[],
    "frequency" TEXT NOT NULL DEFAULT 'IMMEDIATE',
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CHARGE',
    "description" TEXT NOT NULL,
    "descriptionAr" TEXT,
    "product" TEXT,
    "campaignId" UUID,
    "contractId" UUID,
    "billingEventId" UUID,
    "eventType" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER,
    "amountMinor" INTEGER NOT NULL,
    "taxRateBps" INTEGER,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "pricingVersionKey" TEXT,
    "collection" TEXT NOT NULL DEFAULT 'INVOICE_DUE',
    "settledByRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "allocatedByUserId" UUID,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" UUID NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "rateDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInteraction" (
    "id" UUID NOT NULL,
    "agent" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID,
    "legalEntityId" UUID,
    "roleCode" TEXT,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "request" TEXT NOT NULL,
    "intent" TEXT,
    "autonomyLevel" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "answer" JSONB NOT NULL DEFAULT '{}',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "unitsIn" INTEGER NOT NULL DEFAULT 0,
    "unitsOut" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAction" (
    "id" UUID NOT NULL,
    "interactionId" UUID,
    "draftId" UUID,
    "tool" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "outputSummary" JSONB NOT NULL DEFAULT '{}',
    "actorUserId" UUID NOT NULL,
    "organizationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDraft" (
    "id" UUID NOT NULL,
    "interactionId" UUID NOT NULL,
    "agent" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "organizationId" UUID,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "requiredPermission" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageRecord" (
    "id" UUID NOT NULL,
    "interactionId" UUID,
    "organizationId" UUID,
    "businessAccountId" UUID,
    "legalEntityId" UUID,
    "product" TEXT,
    "campaignId" UUID,
    "agent" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "estimatedCostMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_idempotencyKey_key" ON "AnalyticsEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_organizationId_name_occurredAt_idx" ON "AnalyticsEvent"("organizationId", "name", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_campaignId_name_occurredAt_idx" ON "AnalyticsEvent"("campaignId", "name", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_branchId_occurredAt_idx" ON "AnalyticsEvent"("branchId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_occurredAt_idx" ON "AnalyticsEvent"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "MetricAggregate_organizationId_bucket_bucketStart_idx" ON "MetricAggregate"("organizationId", "bucket", "bucketStart");

-- CreateIndex
CREATE INDEX "MetricAggregate_campaignId_bucket_bucketStart_idx" ON "MetricAggregate"("campaignId", "bucket", "bucketStart");

-- CreateIndex
CREATE UNIQUE INDEX "MetricAggregate_bucket_bucketStart_name_organizationId_lega_key" ON "MetricAggregate"("bucket", "bucketStart", "name", "organizationId", "legalEntityId", "branchId", "campaignId", "country", "currency");

-- CreateIndex
CREATE INDEX "CampaignTarget_organizationId_status_idx" ON "CampaignTarget"("organizationId", "status");

-- CreateIndex
CREATE INDEX "CampaignTarget_campaignId_idx" ON "CampaignTarget"("campaignId");

-- CreateIndex
CREATE INDEX "AlertRule_organizationId_code_idx" ON "AlertRule"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AlertEvent_dedupeKey_key" ON "AlertEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "AlertEvent_organizationId_status_createdAt_idx" ON "AlertEvent"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "AlertEvent_status_nextEscalationAt_idx" ON "AlertEvent"("status", "nextEscalationAt");

-- CreateIndex
CREATE INDEX "AlertDelivery_userId_createdAt_idx" ON "AlertDelivery"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertDelivery_alertId_userId_channel_level_key" ON "AlertDelivery"("alertId", "userId", "channel", "level");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_category_key" ON "NotificationPreference"("userId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_billingEventId_key" ON "InvoiceLine"("billingEventId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_documentId_lineNo_key" ON "InvoiceLine"("documentId", "lineNo");

-- CreateIndex
CREATE INDEX "PaymentAllocation_documentId_idx" ON "PaymentAllocation"("documentId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "FxRate_baseCurrency_quoteCurrency_status_rateDate_idx" ON "FxRate"("baseCurrency", "quoteCurrency", "status", "rateDate");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_baseCurrency_quoteCurrency_rateDate_source_key" ON "FxRate"("baseCurrency", "quoteCurrency", "rateDate", "source");

-- CreateIndex
CREATE INDEX "AiInteraction_userId_createdAt_idx" ON "AiInteraction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiInteraction_organizationId_createdAt_idx" ON "AiInteraction"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAction_interactionId_idx" ON "AiAction"("interactionId");

-- CreateIndex
CREATE INDEX "AiAction_draftId_idx" ON "AiAction"("draftId");

-- CreateIndex
CREATE INDEX "AiDraft_organizationId_status_idx" ON "AiDraft"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AiUsageRecord_organizationId_occurredAt_idx" ON "AiUsageRecord"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "AiUsageRecord_agent_kind_occurredAt_idx" ON "AiUsageRecord"("agent", "kind", "occurredAt");

-- CreateIndex
CREATE INDEX "BusinessAccount_organizationId_currency_idx" ON "BusinessAccount"("organizationId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessAccount_organizationId_legalEntityId_currency_key" ON "BusinessAccount"("organizationId", "legalEntityId", "currency");

-- CreateIndex
CREATE INDEX "FinanceDocument_businessAccountId_status_idx" ON "FinanceDocument"("businessAccountId", "status");

-- CreateIndex
CREATE INDEX "FinanceDocument_status_dueAt_idx" ON "FinanceDocument"("status", "dueAt");

-- CreateIndex
CREATE INDEX "FinanceDocument_purchaseOrderId_idx" ON "FinanceDocument"("purchaseOrderId");

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "AlertEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinanceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "FinancePayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinanceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================================================================================
-- Hand-written integrity rules (the vocabularies come from packages/types and must stay identical)
-- =====================================================================================================================================

-- ---------------------------------------------------------------- Phase 5: billing accounts (legal-entity finance scope)
-- Existing accounts stay the default account of their organization and currency; nothing moves.
UPDATE "BusinessAccount" b SET "taxId" = le."taxNumber", "country" = le."country" FROM "LegalEntity" le WHERE le."id" = b."legalEntityId";
CREATE UNIQUE INDEX "BusinessAccount_one_default_per_currency" ON "BusinessAccount"("organizationId", "currency") WHERE "isDefault";
ALTER TABLE "BusinessAccount" ADD CONSTRAINT "BusinessAccount_billing_values" CHECK (
  "status" IN ('ACTIVE', 'CREDIT_HOLD', 'FINANCIAL_HOLD', 'SUSPENDED', 'CLOSED') AND "billingFrequency" IN ('PER_EVENT', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'ON_DEMAND') AND "billingMethod" IN ('INVOICE', 'BANK_TRANSFER', 'CARD', 'PREPAID_BALANCE', 'DIRECT_DEBIT')
  AND "paymentTermsDays" BETWEEN 0 AND 365);

-- ---------------------------------------------------------------- Phase 4: analytics taxonomy and integrity
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_taxonomy" CHECK (
  "name" IN ('LIVE_IMPRESSION', 'LIVE_DETAIL_VIEW', 'LIVE_MERCHANT_PAGE_VISIT', 'LIVE_SAVE', 'LIVE_DIRECTIONS', 'LIVE_ONLINE_CLICK', 'MEMBER_BENEFIT_ACTIVATION', 'MEMBER_BENEFIT_REDEMPTION_VERIFIED', 'EXCLUSIVE_IMPRESSION', 'EXCLUSIVE_VIEW', 'EXCLUSIVE_SAVE', 'EXCLUSIVE_DIRECTIONS', 'EXCLUSIVE_CREDENTIAL_ISSUED', 'EXCLUSIVE_RESERVATION_CANCELLED', 'EXCLUSIVE_RESERVATION_EXPIRED', 'EXCLUSIVE_REDEMPTION_VERIFIED', 'EXCLUSIVE_REDEMPTION_REVERSED', 'EXCLUSIVE_REDEMPTION_REJECTED', 'VOUCHER_VIEW', 'VOUCHER_CHECKOUT_STARTED', 'VOUCHER_PAYMENT_SUCCEEDED', 'VOUCHER_PAYMENT_FAILED', 'VOUCHER_ISSUED', 'VOUCHER_REDEEMED', 'VOUCHER_REDEMPTION_REVERSED', 'VOUCHER_REDEMPTION_REJECTED', 'VOUCHER_EXPIRED', 'VOUCHER_REFUNDED', 'WATCH_VIDEO_SERVED', 'WATCH_VIEW_STARTED', 'WATCH_VIEW_COMPLETED', 'WATCH_QUALIFIED_VIEW', 'WATCH_VIEW_CREDITED_BACK', 'WATCH_VIEW_REJECTED', 'WATCH_FRAUD_HOLD', 'WATCH_ACTION', 'WATCH_FUNDED', 'POINTS_ISSUED', 'POINTS_HELD', 'POINTS_RELEASED', 'POINTS_REDEEMED', 'POINTS_EXPIRED', 'POINTS_REVERSED', 'REWARD_ALLOCATED') AND "product" IN ('LIVE', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY', 'PLATFORM') AND "eventClass" IN ('ENGAGEMENT', 'INTENT', 'CREDENTIAL', 'VERIFIED_OUTCOME', 'FINANCIAL') AND "quantity" >= 0
  -- a client-reported engagement or intent is never a verified outcome
  AND NOT ("verified" AND "eventClass" IN ('ENGAGEMENT', 'INTENT')));
CREATE TRIGGER "AnalyticsEvent_append_only" BEFORE UPDATE OR DELETE ON "AnalyticsEvent" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
ALTER TABLE "MetricAggregate" ADD CONSTRAINT "MetricAggregate_bucket" CHECK ("bucket" IN ('HOUR', 'DAY') AND "count" >= 0);
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_values" CHECK (
  "metric" IN ('IMPRESSIONS', 'QUALIFIED_VIEWS', 'REDEMPTIONS', 'VOUCHER_SALES', 'CUSTOMER_ACQUISITION', 'CONVERSION', 'CPVA', 'INVENTORY_UTILIZATION', 'REWARD_REDEMPTION', 'LOYALTY_UTILIZATION', 'BRANCH_PERFORMANCE', 'SPEND', 'SPONSOR_FUNDING_UTILIZATION') AND "targetValue" > 0 AND "periodEnd" > "periodStart"
  AND "direction" IN ('UP', 'DOWN', 'CAP') AND "unit" IN ('COUNT', 'MINOR', 'BPS', 'POINTS')
  AND "status" IN ('ACTIVE', 'ARCHIVED') AND "source" IN ('MANUAL', 'AI_DRAFT'));
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_values" CHECK (
  "code" IN ('TARGET_MILESTONE', 'CAMPAIGN_BEHIND_TARGET', 'CAMPAIGN_LOW_ACTIVITY', 'BUDGET_PROJECTED_EXHAUST', 'INVENTORY_PROJECTED_EXHAUST', 'VOUCHER_INVENTORY_LOW', 'REWARD_INVENTORY_LOW', 'POINTS_FUNDING_LOW', 'SPONSOR_FUNDING_NEAR_LIMIT', 'CREDIT_NEAR_LIMIT', 'PO_NEAR_LIMIT', 'CAMPAIGN_EXPIRY_APPROACHING', 'VOUCHER_EXPIRY_APPROACHING', 'REWARD_EXPIRY_APPROACHING', 'QUOTATION_EXPIRING', 'INVOICE_DUE', 'INVOICE_OVERDUE', 'SETTLEMENT_PENDING', 'FEED_STALE', 'INTEGRATION_ERROR', 'PAYMENT_FAILURES_RISING', 'REDEMPTION_REJECTIONS_RISING', 'SUSPICIOUS_BRANCH_ACTIVITY', 'RECONCILIATION_DIFFERENCE', 'FUNDING_REQUIRED', 'MERCHANT_APPROVAL_REQUIRED', 'SUBSCRIPTION_LIMIT', 'SUBSCRIPTION_LIFECYCLE', 'FINANCIAL_HOLD') AND "frequency" IN ('IMMEDIATE', 'DIGEST', 'CRITICAL_ONLY') AND ("severity" IS NULL OR "severity" IN ('INFO', 'WARNING', 'CRITICAL'))
  AND "channels" <@ ARRAY['IN_APP', 'EMAIL', 'PUSH', 'SMS', 'TASK_INBOX']::text[]);
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_values" CHECK (
  "code" IN ('TARGET_MILESTONE', 'CAMPAIGN_BEHIND_TARGET', 'CAMPAIGN_LOW_ACTIVITY', 'BUDGET_PROJECTED_EXHAUST', 'INVENTORY_PROJECTED_EXHAUST', 'VOUCHER_INVENTORY_LOW', 'REWARD_INVENTORY_LOW', 'POINTS_FUNDING_LOW', 'SPONSOR_FUNDING_NEAR_LIMIT', 'CREDIT_NEAR_LIMIT', 'PO_NEAR_LIMIT', 'CAMPAIGN_EXPIRY_APPROACHING', 'VOUCHER_EXPIRY_APPROACHING', 'REWARD_EXPIRY_APPROACHING', 'QUOTATION_EXPIRING', 'INVOICE_DUE', 'INVOICE_OVERDUE', 'SETTLEMENT_PENDING', 'FEED_STALE', 'INTEGRATION_ERROR', 'PAYMENT_FAILURES_RISING', 'REDEMPTION_REJECTIONS_RISING', 'SUSPICIOUS_BRANCH_ACTIVITY', 'RECONCILIATION_DIFFERENCE', 'FUNDING_REQUIRED', 'MERCHANT_APPROVAL_REQUIRED', 'SUBSCRIPTION_LIMIT', 'SUBSCRIPTION_LIFECYCLE', 'FINANCIAL_HOLD') AND "severity" IN ('INFO', 'WARNING', 'CRITICAL') AND "status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED') AND "escalationLevel" >= 0);
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_values" CHECK (
  "channel" IN ('IN_APP', 'EMAIL', 'PUSH', 'SMS', 'TASK_INBOX') AND "status" IN ('SENT', 'QUEUED_DIGEST', 'SKIPPED_PREFERENCE', 'SKIPPED_SEVERITY', 'FAILED'));
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_values" CHECK (
  "category" IN ('PERFORMANCE', 'INVENTORY', 'FUNDING', 'FINANCE', 'COMMERCIAL', 'INTEGRATION', 'RISK', 'SUBSCRIPTION', 'OPERATIONS', 'ALL') AND "frequency" IN ('IMMEDIATE', 'DIGEST', 'CRITICAL_ONLY') AND "channels" <@ ARRAY['IN_APP', 'EMAIL', 'PUSH', 'SMS', 'TASK_INBOX']::text[]);

-- ---------------------------------------------------------------- Phase 5: documents, lines, payments, FX
ALTER TABLE "FinanceDocument" ADD CONSTRAINT "FinanceDocument_source_kind" CHECK ("sourceKind" IN ('CAMPAIGN_CASE', 'BILLING_RUN', 'MANUAL', 'QUOTATION', 'STATEMENT', 'PAYMENT'));
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_values" CHECK (
  "kind" IN ('CHARGE', 'INFORMATIONAL', 'CREDIT', 'ADJUSTMENT') AND "collection" IN ('INVOICE_DUE', 'PREPAID_DRAWDOWN', 'NETTED_FROM_PAYABLE', 'CAMPAIGN_CASE', 'NOT_BILLABLE')
  AND "quantity" >= 0 AND "taxMinor" >= 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_amount" CHECK ("amountMinor" > 0);
ALTER TABLE "FxRate" ADD CONSTRAINT "FxRate_values" CHECK (
  "status" IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RETIRED') AND "baseCurrency" <> "quoteCurrency"
  AND "rate" ~ '^[0-9]+(\.[0-9]{1,10})?$' AND "rate"::numeric > 0);

-- An issued financial record is never silently changed or deleted: amounts, lines, party and dates are frozen once it leaves
-- DRAFT / PENDING_APPROVAL; corrections are credit, debit or adjustment notes. Status, payment progress and delivery may move on.
CREATE OR REPLACE FUNCTION dd_finance_document_guard() RETURNS trigger AS $$
DECLARE frozen text[] := ARRAY['number', 'type', 'businessAccountId', 'organizationId', 'caseId', 'relatedDocumentId', 'currency',
  'subtotalHalalas', 'taxHalalas', 'totalHalalas', 'lines', 'issuedAt', 'dueAt', 'legalEntityId', 'contractId', 'periodStart',
  'periodEnd', 'transactionCurrency', 'settlementCurrency', 'fxRateId', 'fxRate', 'taxCurrency', 'taxAmountInTaxCurrency',
  'purchaseOrderId', 'quotationId', 'createdAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status"::text IN ('DRAFT', 'PENDING_APPROVAL') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'An issued finance document cannot be deleted (DOCUMENT_IMMUTABLE)' USING ERRCODE = '23000';
  END IF;
  IF OLD."status"::text NOT IN ('DRAFT', 'PENDING_APPROVAL') AND (to_jsonb(NEW) - ARRAY(SELECT jsonb_object_keys(to_jsonb(NEW)) EXCEPT SELECT unnest(frozen)))
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY(SELECT jsonb_object_keys(to_jsonb(OLD)) EXCEPT SELECT unnest(frozen))) THEN
    RAISE EXCEPTION 'An issued finance document is immutable (DOCUMENT_IMMUTABLE)' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "FinanceDocument_guard" BEFORE UPDATE OR DELETE ON "FinanceDocument" FOR EACH ROW EXECUTE FUNCTION dd_finance_document_guard();

CREATE OR REPLACE FUNCTION dd_invoice_line_guard() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT "status"::text INTO st FROM "FinanceDocument" WHERE "id" = COALESCE(NEW."documentId", OLD."documentId");
  IF st IS NOT NULL AND st NOT IN ('DRAFT', 'PENDING_APPROVAL') THEN
    RAISE EXCEPTION 'Lines of an issued finance document are immutable (DOCUMENT_IMMUTABLE)' USING ERRCODE = '23000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "InvoiceLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine" FOR EACH ROW EXECUTE FUNCTION dd_invoice_line_guard();
CREATE TRIGGER "PaymentAllocation_no_delete" BEFORE DELETE ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();

-- The subscription billing hook: Phase 5 may now record ONCE how an event was collected and which invoice line it became.
CREATE OR REPLACE FUNCTION dd_billing_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CommercialBillingEvent is append-only' USING ERRCODE = '23000'; END IF;
  IF to_jsonb(NEW) - 'status' - 'consumedAt' - 'collection' - 'settlementRef' - 'invoiceLineId'
     IS DISTINCT FROM to_jsonb(OLD) - 'status' - 'consumedAt' - 'collection' - 'settlementRef' - 'invoiceLineId' THEN
    RAISE EXCEPTION 'CommercialBillingEvent is append-only (only its processing state may change)' USING ERRCODE = '23000';
  END IF;
  IF (OLD."collection" IS NOT NULL AND NEW."collection" IS DISTINCT FROM OLD."collection")
     OR (OLD."settlementRef" IS NOT NULL AND NEW."settlementRef" IS DISTINCT FROM OLD."settlementRef")
     OR (OLD."invoiceLineId" IS NOT NULL AND NEW."invoiceLineId" IS DISTINCT FROM OLD."invoiceLineId") THEN
    RAISE EXCEPTION 'A billing event is consumed once (its collection and invoice line never change)' USING ERRCODE = '23000';
  END IF;
  IF NEW."collection" IS NOT NULL AND NEW."collection" NOT IN ('INVOICE_DUE', 'PREPAID_DRAWDOWN', 'NETTED_FROM_PAYABLE', 'CAMPAIGN_CASE', 'NOT_BILLABLE') THEN
    RAISE EXCEPTION 'Unknown collection %', NEW."collection" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- Phase 5: governed AI audit (append-only) and drafts
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_values" CHECK (
  "agent" IN ('CUSTOMER_BEST_DEAL', 'MERCHANT_GROWTH', 'PARTNER_CAMPAIGN', 'OPERATIONS_SUPPORT', 'ADMIN_FINANCE') AND "status" IN ('ANSWERED', 'DENIED', 'ERROR') AND "autonomyLevel" BETWEEN 0 AND 5);
ALTER TABLE "AiAction" ADD CONSTRAINT "AiAction_values" CHECK ("tier" IN ('READ', 'DRAFT', 'EXECUTE') AND "state" IN ('SUGGESTED', 'DRAFTED', 'HUMAN_APPROVED', 'SYSTEM_EXECUTED', 'REJECTED', 'DENIED'));
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_values" CHECK (
  "agent" IN ('CUSTOMER_BEST_DEAL', 'MERCHANT_GROWTH', 'PARTNER_CAMPAIGN', 'OPERATIONS_SUPPORT', 'ADMIN_FINANCE') AND "kind" IN ('CAMPAIGN_PLAN', 'CAMPAIGN_TARGETS', 'ALERT_RULES', 'SUPPORT_HANDOFF', 'CAMPAIGN_PORTFOLIO') AND "status" IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED'));
ALTER TABLE "AiUsageRecord" ADD CONSTRAINT "AiUsageRecord_values" CHECK (
  "agent" IN ('CUSTOMER_BEST_DEAL', 'MERCHANT_GROWTH', 'PARTNER_CAMPAIGN', 'OPERATIONS_SUPPORT', 'ADMIN_FINANCE') AND "kind" IN ('REQUEST', 'ANALYSIS', 'DRAFT', 'SUPPORT_ASSIST', 'TOOL_CALL', 'ACTION') AND "units" >= 0 AND "estimatedCostMinor" >= 0);
CREATE TRIGGER "AiInteraction_append_only" BEFORE UPDATE OR DELETE ON "AiInteraction" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "AiAction_append_only" BEFORE UPDATE OR DELETE ON "AiAction" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "AiUsageRecord_append_only" BEFORE UPDATE OR DELETE ON "AiUsageRecord" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();