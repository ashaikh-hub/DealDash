-- Stage 8: operational gap closure (shared case framework, adjustments, settlement, reconciliation exceptions, risk operations,
-- restrictions / holds, reviews and moderation, notification delivery, data requests). Additive only.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerJournalType" ADD VALUE 'SETTLEMENT_PAYOUT';
ALTER TYPE "LedgerJournalType" ADD VALUE 'SETTLEMENT_REVERSAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'CASE_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_RESTRICTION';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "legalEntityId" UUID,
ADD COLUMN     "market" TEXT;

-- AlterTable
ALTER TABLE "CaseNote" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "direction" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'NOTE';

-- AlterTable
ALTER TABLE "DisputeCase" ADD COLUMN     "approvalDecidedAt" TIMESTAMP(3),
ADD COLUMN     "approvalDecidedByUserId" UUID,
ADD COLUMN     "approvalReason" TEXT,
ADD COLUMN     "approvalRequestedAt" TIMESTAMP(3),
ADD COLUMN     "approvalRequestedByUserId" UUID,
ADD COLUMN     "approvalState" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "assignedTeam" TEXT,
ADD COLUMN     "businessAccountId" UUID,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "customerNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "escalationLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "financialImpactMinor" INTEGER,
ADD COLUMN     "lastEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "legalEntityId" UUID,
ADD COLUMN     "market" TEXT,
ADD COLUMN     "proposedResolution" TEXT,
ADD COLUMN     "queue" TEXT,
ADD COLUMN     "reasonCode" TEXT,
ADD COLUMN     "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "slaState" TEXT NOT NULL DEFAULT 'ON_TRACK',
ADD COLUMN     "slaWarnAt" TIMESTAMP(3),
ADD COLUMN     "sourceEvent" TEXT,
ADD COLUMN     "sourceEventId" TEXT,
ADD COLUMN     "supportCaseId" UUID,
ADD COLUMN     "transactionRef" TEXT;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "caseId" UUID;

-- AlterTable
ALTER TABLE "RiskFlag" ADD COLUMN     "branchId" UUID,
ADD COLUMN     "caseId" UUID,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "domain" TEXT NOT NULL DEFAULT 'WATCH',
ADD COLUMN     "market" TEXT,
ADD COLUMN     "ruleCode" TEXT,
ADD COLUMN     "subjectOrganizationId" UUID;

-- CreateTable
CREATE TABLE "AdjustmentRequest" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "direction" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL DEFAULT 0,
    "points" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "market" TEXT,
    "legalEntityId" UUID,
    "contractId" UUID,
    "organizationId" UUID,
    "businessAccountId" UUID,
    "customerUserId" UUID,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "caseId" UUID,
    "reasonCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "requestedByRole" TEXT,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "appliedRef" JSONB,
    "appliedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "product" TEXT,
    "settlementRuleId" UUID,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "grossMinor" INTEGER NOT NULL DEFAULT 0,
    "feesMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "adjustmentsMinor" INTEGER NOT NULL DEFAULT 0,
    "carriedForwardMinor" INTEGER NOT NULL DEFAULT 0,
    "carriedIntoId" UUID,
    "heldByUserId" UUID,
    "payableMinor" INTEGER NOT NULL DEFAULT 0,
    "paidMinor" INTEGER NOT NULL DEFAULT 0,
    "settlementDate" TIMESTAMP(3),
    "destinationRef" TEXT,
    "reconciliationStatus" TEXT NOT NULL DEFAULT 'UNRECONCILED',
    "holdReason" TEXT,
    "failureReason" TEXT,
    "createdByUserId" UUID,
    "approvedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementItem" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "payableEventId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementPayout" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "externalRef" TEXT,
    "journalId" UUID,
    "reason" TEXT,
    "recordedByUserId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationRun" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'STATEMENT',
    "fileName" TEXT,
    "periodFrom" TIMESTAMP(3),
    "periodTo" TIMESTAMP(3),
    "currency" TEXT,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationItem" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "runId" UUID,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "matchStatus" TEXT NOT NULL,
    "externalReference" TEXT,
    "externalAmountMinor" INTEGER,
    "externalAt" TIMESTAMP(3),
    "internalType" TEXT,
    "internalId" TEXT,
    "internalReference" TEXT,
    "internalAmountMinor" INTEGER,
    "internalAt" TIMESTAMP(3),
    "varianceMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "market" TEXT,
    "organizationId" UUID,
    "ownerUserId" UUID,
    "resolution" TEXT,
    "adjustmentRequestId" UUID,
    "caseId" UUID,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalRestriction" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "organizationId" UUID,
    "branchId" UUID,
    "market" TEXT,
    "scope" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reasonCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "liftedByUserId" UUID,
    "liftedAt" TIMESTAMP(3),
    "liftReason" TEXT,
    "caseId" UUID,
    "riskFlagId" UUID,
    "appliedRef" JSONB,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "merchantOrganizationId" UUID NOT NULL,
    "customerUserId" UUID NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "status" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedInteractionType" TEXT,
    "verifiedInteractionId" UUID,
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "moderatedByUserId" UUID,
    "moderatedAt" TIMESTAMP(3),
    "moderationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewReport" (
    "id" UUID NOT NULL,
    "reviewId" UUID NOT NULL,
    "reporterType" TEXT NOT NULL,
    "reporterUserId" UUID NOT NULL,
    "reporterOrganizationId" UUID,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationItem" (
    "id" UUID NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "product" TEXT,
    "organizationId" UUID,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'REPORT',
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reportCount" INTEGER NOT NULL DEFAULT 0,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "notificationId" UUID,
    "alertId" UUID,
    "userId" UUID,
    "organizationId" UUID,
    "channel" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "market" TEXT,
    "locale" TEXT,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "failureReason" TEXT,
    "suppressedReason" TEXT,
    "providerMessageId" TEXT,
    "consentChecked" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "nextRetryAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "customerUserId" UUID NOT NULL,
    "market" TEXT,
    "requestedByUserId" UUID NOT NULL,
    "requestedVia" TEXT NOT NULL,
    "reason" TEXT,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "result" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdjustmentRequest_reference_key" ON "AdjustmentRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "AdjustmentRequest_idempotencyKey_key" ON "AdjustmentRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AdjustmentRequest_status_createdAt_idx" ON "AdjustmentRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AdjustmentRequest_organizationId_createdAt_idx" ON "AdjustmentRequest"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AdjustmentRequest_kind_status_idx" ON "AdjustmentRequest"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_reference_key" ON "Settlement"("reference");

-- CreateIndex
CREATE INDEX "Settlement_organizationId_status_idx" ON "Settlement"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Settlement_status_createdAt_idx" ON "Settlement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Settlement_market_status_idx" ON "Settlement"("market", "status");

-- CreateIndex
CREATE INDEX "SettlementItem_settlementId_idx" ON "SettlementItem"("settlementId");

-- CreateIndex
CREATE INDEX "SettlementItem_payableEventId_idx" ON "SettlementItem"("payableEventId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementPayout_idempotencyKey_key" ON "SettlementPayout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SettlementPayout_settlementId_createdAt_idx" ON "SettlementPayout"("settlementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationRun_reference_key" ON "ReconciliationRun"("reference");

-- CreateIndex
CREATE INDEX "ReconciliationRun_source_createdAt_idx" ON "ReconciliationRun"("source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationItem_reference_key" ON "ReconciliationItem"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationItem_dedupeKey_key" ON "ReconciliationItem"("dedupeKey");

-- CreateIndex
CREATE INDEX "ReconciliationItem_status_createdAt_idx" ON "ReconciliationItem"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReconciliationItem_source_status_idx" ON "ReconciliationItem"("source", "status");

-- CreateIndex
CREATE INDEX "ReconciliationItem_organizationId_status_idx" ON "ReconciliationItem"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OperationalRestriction_reference_key" ON "OperationalRestriction"("reference");

-- CreateIndex
CREATE INDEX "OperationalRestriction_kind_status_idx" ON "OperationalRestriction"("kind", "status");

-- CreateIndex
CREATE INDEX "OperationalRestriction_subjectType_subjectId_status_idx" ON "OperationalRestriction"("subjectType", "subjectId", "status");

-- CreateIndex
CREATE INDEX "OperationalRestriction_branchId_status_idx" ON "OperationalRestriction"("branchId", "status");

-- CreateIndex
CREATE INDEX "OperationalRestriction_status_endsAt_idx" ON "OperationalRestriction"("status", "endsAt");

-- CreateIndex
CREATE INDEX "Review_merchantOrganizationId_status_createdAt_idx" ON "Review"("merchantOrganizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Review_customerUserId_merchantOrganizationId_idx" ON "Review"("customerUserId", "merchantOrganizationId");

-- CreateIndex
CREATE INDEX "Review_status_createdAt_idx" ON "Review"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewReport_status_createdAt_idx" ON "ReviewReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewReport_reviewId_reporterUserId_key" ON "ReviewReport"("reviewId", "reporterUserId");

-- CreateIndex
CREATE INDEX "ModerationItem_status_createdAt_idx" ON "ModerationItem"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationItem_subjectType_subjectId_key" ON "ModerationItem"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_dedupeKey_key" ON "NotificationDelivery"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextRetryAt_idx" ON "NotificationDelivery"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_userId_createdAt_idx" ON "NotificationDelivery"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_channel_status_createdAt_idx" ON "NotificationDelivery"("channel", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataRequest_reference_key" ON "DataRequest"("reference");

-- CreateIndex
CREATE INDEX "DataRequest_status_createdAt_idx" ON "DataRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DataRequest_customerUserId_idx" ON "DataRequest"("customerUserId");

-- CreateIndex
CREATE INDEX "DisputeCase_market_status_idx" ON "DisputeCase"("market", "status");

-- CreateIndex
CREATE INDEX "DisputeCase_assignedTeam_status_idx" ON "DisputeCase"("assignedTeam", "status");

-- CreateIndex
CREATE INDEX "DisputeCase_slaState_status_idx" ON "DisputeCase"("slaState", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiskFlag_dedupeKey_key" ON "RiskFlag"("dedupeKey");

-- CreateIndex
CREATE INDEX "RiskFlag_domain_status_idx" ON "RiskFlag"("domain", "status");

-- AddForeignKey
ALTER TABLE "SettlementItem" ADD CONSTRAINT "SettlementItem_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementPayout" ADD CONSTRAINT "SettlementPayout_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- integrity rules (Stage 8)
-- the shared case lifecycle (Phase 3 statuses stay valid for existing cases)
ALTER TABLE "DisputeCase" DROP CONSTRAINT "DisputeCase_values";
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_values" CHECK (
  "status" IN ('OPEN', 'INVESTIGATING', 'AWAITING_CUSTOMER', 'AWAITING_MERCHANT', 'AWAITING_PARTNER', 'AWAITING_FINANCE', 'AWAITING_APPROVAL', 'RESOLVED', 'CLOSED', 'REJECTED', 'IN_REVIEW', 'WAITING')
  AND "priority" IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')
  AND "severity" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
  AND "approvalState" IN ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED')
  AND "slaState" IN ('ON_TRACK', 'WARNING', 'BREACHED', 'MET')
);
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_kind" CHECK ("kind" IN ('NOTE', 'CONTACT', 'ESCALATION', 'SYSTEM'));
-- Stage 8 alert codes (SLA, delivery failures, fraud flags, settlement / reconciliation exceptions, restrictions)
ALTER TABLE "AlertEvent" DROP CONSTRAINT "AlertEvent_values";
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_values" CHECK (
  "code" IN ('TARGET_MILESTONE', 'CAMPAIGN_BEHIND_TARGET', 'CAMPAIGN_LOW_ACTIVITY', 'BUDGET_PROJECTED_EXHAUST', 'INVENTORY_PROJECTED_EXHAUST', 'VOUCHER_INVENTORY_LOW', 'REWARD_INVENTORY_LOW', 'POINTS_FUNDING_LOW', 'SPONSOR_FUNDING_NEAR_LIMIT', 'CREDIT_NEAR_LIMIT', 'PO_NEAR_LIMIT', 'CAMPAIGN_EXPIRY_APPROACHING', 'VOUCHER_EXPIRY_APPROACHING', 'REWARD_EXPIRY_APPROACHING', 'QUOTATION_EXPIRING', 'INVOICE_DUE', 'INVOICE_OVERDUE', 'SETTLEMENT_PENDING', 'FEED_STALE', 'INTEGRATION_ERROR', 'PAYMENT_FAILURES_RISING', 'REDEMPTION_REJECTIONS_RISING', 'SUSPICIOUS_BRANCH_ACTIVITY', 'RECONCILIATION_DIFFERENCE', 'FUNDING_REQUIRED', 'MERCHANT_APPROVAL_REQUIRED', 'SUBSCRIPTION_LIMIT', 'SUBSCRIPTION_LIFECYCLE', 'FINANCIAL_HOLD',
             'SLA_WARNING', 'SLA_BREACHED', 'NOTIFICATION_FAILURE', 'FRAUD_FLAG_RAISED', 'SETTLEMENT_EXCEPTION', 'RECONCILIATION_EXCEPTION', 'RESTRICTION_PLACED', 'RESTRICTION_LIFTED')
  AND "severity" IN ('INFO', 'WARNING', 'CRITICAL') AND "status" IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED') AND "escalationLevel" >= 0);
ALTER TABLE "AlertRule" DROP CONSTRAINT "AlertRule_values";
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_values" CHECK (
  "code" IN ('TARGET_MILESTONE', 'CAMPAIGN_BEHIND_TARGET', 'CAMPAIGN_LOW_ACTIVITY', 'BUDGET_PROJECTED_EXHAUST', 'INVENTORY_PROJECTED_EXHAUST', 'VOUCHER_INVENTORY_LOW', 'REWARD_INVENTORY_LOW', 'POINTS_FUNDING_LOW', 'SPONSOR_FUNDING_NEAR_LIMIT', 'CREDIT_NEAR_LIMIT', 'PO_NEAR_LIMIT', 'CAMPAIGN_EXPIRY_APPROACHING', 'VOUCHER_EXPIRY_APPROACHING', 'REWARD_EXPIRY_APPROACHING', 'QUOTATION_EXPIRING', 'INVOICE_DUE', 'INVOICE_OVERDUE', 'SETTLEMENT_PENDING', 'FEED_STALE', 'INTEGRATION_ERROR', 'PAYMENT_FAILURES_RISING', 'REDEMPTION_REJECTIONS_RISING', 'SUSPICIOUS_BRANCH_ACTIVITY', 'RECONCILIATION_DIFFERENCE', 'FUNDING_REQUIRED', 'MERCHANT_APPROVAL_REQUIRED', 'SUBSCRIPTION_LIMIT', 'SUBSCRIPTION_LIFECYCLE', 'FINANCIAL_HOLD',
             'SLA_WARNING', 'SLA_BREACHED', 'NOTIFICATION_FAILURE', 'FRAUD_FLAG_RAISED', 'SETTLEMENT_EXCEPTION', 'RECONCILIATION_EXCEPTION', 'RESTRICTION_PLACED', 'RESTRICTION_LIFTED')
  AND "frequency" IN ('IMMEDIATE', 'DIGEST', 'CRITICAL_ONLY') AND ("severity" IS NULL OR "severity" IN ('INFO', 'WARNING', 'CRITICAL'))
  AND "channels" <@ ARRAY['IN_APP', 'EMAIL', 'PUSH', 'SMS', 'TASK_INBOX']::text[]);
-- Stage 8 operations copilot drafts
ALTER TABLE "AiDraft" DROP CONSTRAINT "AiDraft_values";
ALTER TABLE "AiDraft" ADD CONSTRAINT "AiDraft_values" CHECK (
  "agent" IN ('CUSTOMER_BEST_DEAL', 'MERCHANT_GROWTH', 'PARTNER_CAMPAIGN', 'OPERATIONS_SUPPORT', 'ADMIN_FINANCE') AND "kind" IN ('CAMPAIGN_PLAN', 'CAMPAIGN_TARGETS', 'ALERT_RULES', 'SUPPORT_HANDOFF', 'CAMPAIGN_PORTFOLIO', 'CUSTOMER_RESPONSE', 'MERCHANT_REQUEST') AND "status" IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXPIRED'));
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
-- Verified only with evidence of a DealDash-tracked merchant interaction (FDC-05); Watch & Earn viewing is never one of them.
ALTER TABLE "Review" ADD CONSTRAINT "Review_verified_evidence_check"
  CHECK (NOT "verified" OR ("verifiedInteractionId" IS NOT NULL AND "verifiedInteractionType" IN ('VOUCHER_REDEMPTION','EXCLUSIVE_REDEMPTION','CONTROLLED_OFFER_REDEMPTION')));
ALTER TABLE "Review" ADD CONSTRAINT "Review_status_check" CHECK ("status" IN ('PENDING_REVIEW','PUBLISHED','REPORTED','HIDDEN','REMOVED'));
ALTER TABLE "AdjustmentRequest" ADD CONSTRAINT "AdjustmentRequest_amounts_check" CHECK ("amountMinor" >= 0 AND "points" >= 0 AND ("amountMinor" > 0 OR "points" > 0));
ALTER TABLE "AdjustmentRequest" ADD CONSTRAINT "AdjustmentRequest_direction_check" CHECK ("direction" IN ('CREDIT','DEBIT'));
ALTER TABLE "AdjustmentRequest" ADD CONSTRAINT "AdjustmentRequest_status_check" CHECK ("status" IN ('PENDING_APPROVAL','APPROVED','APPLIED','REJECTED','FAILED'));
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_status_check" CHECK ("status" IN ('PENDING','ELIGIBLE','HELD','DISPUTE_HOLD','PARTIALLY_PAID','COMPLETED','FAILED','REVERSED'));
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_paid_check" CHECK ("paidMinor" >= 0 AND "paidMinor" <= GREATEST("payableMinor", 0));
ALTER TABLE "SettlementPayout" ADD CONSTRAINT "SettlementPayout_amount_check" CHECK ("amountMinor" > 0);
ALTER TABLE "OperationalRestriction" ADD CONSTRAINT "OperationalRestriction_status_check" CHECK ("status" IN ('PENDING_APPROVAL','ACTIVE','LIFTED','EXPIRED','REJECTED'));
ALTER TABLE "OperationalRestriction" ADD CONSTRAINT "OperationalRestriction_dates_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_status_check" CHECK ("status" IN ('QUEUED','SENT','DELIVERED','FAILED','RETRYING','SUPPRESSED'));
ALTER TABLE "ReconciliationItem" ADD CONSTRAINT "ReconciliationItem_status_check" CHECK ("status" IN ('MATCHED','PARTIAL_MATCH','MISSING_INTERNAL','MISSING_EXTERNAL','AMOUNT_MISMATCH','DUPLICATE','TIMING_DIFFERENCE','MANUAL_REVIEW','RESOLVED'));
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_type_check" CHECK ("type" IN ('EXPORT','DELETION'));

-- Settlement lines and payouts are history: never edited or deleted (a failure or reversal is a new payout row).
CREATE TRIGGER "SettlementPayout_append_only" BEFORE UPDATE OR DELETE ON "SettlementPayout" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "SettlementItem_append_only" BEFORE UPDATE OR DELETE ON "SettlementItem" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();