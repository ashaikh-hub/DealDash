-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES', 'REJECTED', 'SCHEDULED', 'ON_SALE', 'PAUSED', 'SOLD_OUT', 'ENDED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VoucherAction" AS ENUM ('CREATE', 'UPDATE', 'SUBMIT', 'AUTO_APPROVE', 'REQUEST_CHANGES', 'APPROVE', 'REJECT', 'ACTIVATE', 'SOLD_OUT', 'REOPEN', 'END', 'PAUSE', 'RESUME', 'SUSPEND', 'REINSTATE', 'MINOR_EDIT', 'STOCK_CHANGED');

-- CreateEnum
CREATE TYPE "VoucherValidityType" AS ENUM ('FIXED_DATE', 'DAYS_FROM_PURCHASE');

-- CreateEnum
CREATE TYPE "VoucherInstanceStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'EXPIRED', 'REFUNDED', 'VOIDED');

-- CreateEnum
CREATE TYPE "VoucherOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentEventOutcome" AS ENUM ('APPLIED', 'DUPLICATE', 'IGNORED', 'REJECTED', 'LATE_SUCCESS');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PROCESSING', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundKind" AS ENUM ('CUSTOMER_REQUEST', 'ADMIN_INITIATED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "LedgerAccountFamily" AS ENUM ('PSP_CLEARING', 'MERCHANT_HELD', 'MERCHANT_SETTLEMENT_ELIGIBLE', 'PLATFORM_REVENUE', 'EXPIRED_VALUE', 'ADJUSTMENTS');

-- CreateEnum
CREATE TYPE "LedgerJournalType" AS ENUM ('SALE', 'REDEMPTION', 'REFUND', 'REVERSAL', 'EXPIRY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayableEventType" AS ENUM ('SOLD', 'ISSUED', 'REDEEMED', 'ELIGIBLE', 'REFUNDED', 'REDEMPTION_REVERSED', 'EXPIRED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "SupportCaseType" AS ENUM ('VOUCHER_ISSUE', 'PAYMENT_ISSUE', 'REFUND_QUESTION', 'REDEMPTION_ISSUE', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DealEventType" ADD VALUE 'CHECKOUT_STARTED';
ALTER TYPE "DealEventType" ADD VALUE 'PAYMENT_INITIATED';
ALTER TYPE "DealEventType" ADD VALUE 'PAYMENT_SUCCEEDED';
ALTER TYPE "DealEventType" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "DealEventType" ADD VALUE 'VOUCHER_ISSUED';
ALTER TYPE "DealEventType" ADD VALUE 'WALLET_VIEWED';
ALTER TYPE "DealEventType" ADD VALUE 'VOUCHER_REDEEMED';
ALTER TYPE "DealEventType" ADD VALUE 'REFUND_REQUESTED';
ALTER TYPE "DealEventType" ADD VALUE 'REFUND_COMPLETED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'PURCHASE_SUCCEEDED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'VOUCHER_ISSUED';
ALTER TYPE "NotificationType" ADD VALUE 'VOUCHER_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'REFUND_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'VOUCHER_REDEEMED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RedemptionResult" ADD VALUE 'VOUCHER_SUSPENDED';
ALTER TYPE "RedemptionResult" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "RedemptionAttempt" ADD COLUMN     "voucherInstanceId" UUID;

-- CreateTable
CREATE TABLE "Voucher" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "statusBeforeSuspension" "VoucherStatus",
    "pausedBy" "DealPausedBy",
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "categoryId" UUID,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "faceValueHalalas" INTEGER NOT NULL DEFAULT 0,
    "sellingPriceHalalas" INTEGER NOT NULL DEFAULT 0,
    "totalQty" INTEGER NOT NULL DEFAULT 0,
    "heldQty" INTEGER NOT NULL DEFAULT 0,
    "soldQty" INTEGER NOT NULL DEFAULT 0,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "validityType" "VoucherValidityType" NOT NULL DEFAULT 'DAYS_FROM_PURCHASE',
    "validityDays" INTEGER,
    "validUntil" TIMESTAMP(3),
    "saleStartAt" TIMESTAMP(3),
    "saleEndAt" TIMESTAMP(3),
    "eligibilityKind" "EligibilityKind" NOT NULL DEFAULT 'PUBLIC',
    "eligibilityRuleSetId" UUID,
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherBranch" (
    "voucherId" UUID NOT NULL,
    "branchId" UUID NOT NULL,

    CONSTRAINT "VoucherBranch_pkey" PRIMARY KEY ("voucherId","branchId")
);

-- CreateTable
CREATE TABLE "VoucherHistory" (
    "id" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "action" "VoucherAction" NOT NULL,
    "fromStatus" "VoucherStatus",
    "toStatus" "VoucherStatus",
    "reason" TEXT,
    "reasonAr" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "actorUserId" UUID,
    "actorRole" TEXT,
    "actorName" TEXT,
    "byDealDash" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherOrder" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceHalalas" INTEGER NOT NULL,
    "faceValueHalalas" INTEGER NOT NULL,
    "totalHalalas" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "status" "VoucherOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "holdExpiresAt" TIMESTAMP(3) NOT NULL,
    "termsVersion" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "returnUrl" TEXT,
    "idempotencyKey" TEXT,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amountHalalas" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "methodType" TEXT,
    "redirectUrl" TEXT,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" UUID NOT NULL,
    "paymentId" UUID,
    "providerEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "signatureVerified" BOOLEAN NOT NULL,
    "outcome" "PaymentEventOutcome" NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "instanceId" UUID,
    "organizationId" UUID NOT NULL,
    "amountHalalas" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "kind" "RefundKind" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reason" TEXT,
    "requestedByUserId" UUID,
    "requestedByRole" TEXT,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "providerRefundReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherInstance" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "voucherId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 1,
    "organizationId" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "status" "VoucherInstanceStatus" NOT NULL DEFAULT 'ACTIVE',
    "purchasePriceHalalas" INTEGER NOT NULL,
    "faceValueHalalas" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "qrToken" TEXT NOT NULL,
    "manualCode" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "expiringNoticeSentAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherRedemption" (
    "id" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "voucherId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "staffUserId" UUID NOT NULL,
    "source" "RedemptionSource" NOT NULL,
    "status" "RedemptionStatus" NOT NULL DEFAULT 'REDEEMED',
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedByUserId" UUID,
    "reverseReason" TEXT,

    CONSTRAINT "VoucherRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "family" "LedgerAccountFamily" NOT NULL,
    "organizationId" UUID,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerJournal" (
    "id" UUID NOT NULL,
    "type" "LedgerJournalType" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "memo" TEXT,
    "reasonCode" TEXT,
    "feeRuleVersion" INTEGER,
    "reversesJournalId" UUID,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedByUserId" UUID,
    "postedByRole" TEXT,

    CONSTRAINT "LedgerJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "amountHalalas" INTEGER NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantPayableEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "voucherId" UUID,
    "instanceId" UUID,
    "type" "PayableEventType" NOT NULL,
    "amountHalalas" INTEGER NOT NULL,
    "feeHalalas" INTEGER NOT NULL DEFAULT 0,
    "journalId" UUID,
    "settlementId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantPayableEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportCase" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "type" "SupportCaseType" NOT NULL,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "voucherInstanceId" UUID,
    "orderId" UUID,
    "paymentId" UUID,
    "refundId" UUID,
    "redemptionId" UUID,
    "resolutionNote" TEXT,
    "handledByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Voucher_organizationId_status_idx" ON "Voucher"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Voucher_status_saleStartAt_saleEndAt_idx" ON "Voucher"("status", "saleStartAt", "saleEndAt");

-- CreateIndex
CREATE INDEX "Voucher_categoryId_status_idx" ON "Voucher"("categoryId", "status");

-- CreateIndex
CREATE INDEX "VoucherBranch_branchId_idx" ON "VoucherBranch"("branchId");

-- CreateIndex
CREATE INDEX "VoucherHistory_voucherId_createdAt_idx" ON "VoucherHistory"("voucherId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherOrder_reference_key" ON "VoucherOrder"("reference");

-- CreateIndex
CREATE INDEX "VoucherOrder_userId_createdAt_idx" ON "VoucherOrder"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VoucherOrder_voucherId_status_idx" ON "VoucherOrder"("voucherId", "status");

-- CreateIndex
CREATE INDEX "VoucherOrder_status_holdExpiresAt_idx" ON "VoucherOrder"("status", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "VoucherOrder_organizationId_createdAt_idx" ON "VoucherOrder"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherOrder_userId_idempotencyKey_key" ON "VoucherOrder"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerReference_key" ON "Payment"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_orderId_createdAt_idx" ON "Payment"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_providerEventId_key" ON "PaymentEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentId_receivedAt_idx" ON "PaymentEvent"("paymentId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_reference_key" ON "Refund"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_instanceId_idx" ON "Refund"("instanceId");

-- CreateIndex
CREATE INDEX "Refund_organizationId_createdAt_idx" ON "Refund"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherInstance_reference_key" ON "VoucherInstance"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherInstance_qrToken_key" ON "VoucherInstance"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherInstance_manualCode_key" ON "VoucherInstance"("manualCode");

-- CreateIndex
CREATE INDEX "VoucherInstance_ownerUserId_status_expiresAt_idx" ON "VoucherInstance"("ownerUserId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "VoucherInstance_voucherId_status_idx" ON "VoucherInstance"("voucherId", "status");

-- CreateIndex
CREATE INDEX "VoucherInstance_organizationId_issuedAt_idx" ON "VoucherInstance"("organizationId", "issuedAt");

-- CreateIndex
CREATE INDEX "VoucherInstance_status_expiresAt_idx" ON "VoucherInstance"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherInstance_orderId_seq_key" ON "VoucherInstance"("orderId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherRedemption_reference_key" ON "VoucherRedemption"("reference");

-- CreateIndex
CREATE INDEX "VoucherRedemption_organizationId_redeemedAt_idx" ON "VoucherRedemption"("organizationId", "redeemedAt");

-- CreateIndex
CREATE INDEX "VoucherRedemption_branchId_redeemedAt_idx" ON "VoucherRedemption"("branchId", "redeemedAt");

-- CreateIndex
CREATE INDEX "VoucherRedemption_staffUserId_redeemedAt_idx" ON "VoucherRedemption"("staffUserId", "redeemedAt");

-- CreateIndex
CREATE INDEX "LedgerAccount_organizationId_family_idx" ON "LedgerAccount"("organizationId", "family");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerJournal_idempotencyKey_key" ON "LedgerJournal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerJournal_sourceType_sourceId_idx" ON "LedgerJournal"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "LedgerJournal_postedAt_idx" ON "LedgerJournal"("postedAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_journalId_idx" ON "LedgerEntry"("journalId");

-- CreateIndex
CREATE INDEX "MerchantPayableEvent_organizationId_createdAt_idx" ON "MerchantPayableEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "MerchantPayableEvent_instanceId_idx" ON "MerchantPayableEvent"("instanceId");

-- CreateIndex
CREATE INDEX "MerchantPayableEvent_type_createdAt_idx" ON "MerchantPayableEvent"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportCase_reference_key" ON "SupportCase"("reference");

-- CreateIndex
CREATE INDEX "SupportCase_userId_createdAt_idx" ON "SupportCase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportCase_status_createdAt_idx" ON "SupportCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportCase_orderId_idx" ON "SupportCase"("orderId");

-- CreateIndex
CREATE INDEX "SupportCase_voucherInstanceId_idx" ON "SupportCase"("voucherInstanceId");

-- CreateIndex
CREATE INDEX "RedemptionAttempt_voucherInstanceId_idx" ON "RedemptionAttempt"("voucherInstanceId");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_eligibilityRuleSetId_fkey" FOREIGN KEY ("eligibilityRuleSetId") REFERENCES "EligibilityRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBranch" ADD CONSTRAINT "VoucherBranch_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBranch" ADD CONSTRAINT "VoucherBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "MerchantBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherHistory" ADD CONSTRAINT "VoucherHistory_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherOrder" ADD CONSTRAINT "VoucherOrder_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "VoucherOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "VoucherOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "VoucherInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherInstance" ADD CONSTRAINT "VoucherInstance_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherInstance" ADD CONSTRAINT "VoucherInstance_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "VoucherOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "VoucherInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "LedgerJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------- hand-written integrity rules (not expressible in Prisma)

-- Voucher inventory can never go negative and never oversell: total >= held (unpaid checkouts) + sold.
ALTER TABLE "Voucher"
  ADD CONSTRAINT "Voucher_inventory_non_negative" CHECK ("totalQty" >= 0 AND "heldQty" >= 0 AND "soldQty" >= 0),
  ADD CONSTRAINT "Voucher_inventory_balanced" CHECK ("totalQty" >= "heldQty" + "soldQty"),
  ADD CONSTRAINT "Voucher_money_non_negative" CHECK ("faceValueHalalas" >= 0 AND "sellingPriceHalalas" >= 0),
  ADD CONSTRAINT "Voucher_per_customer_limit" CHECK ("perCustomerLimit" >= 1),
  -- drafts may be incomplete while being edited; once submitted the price can never exceed the face value and the window is ordered
  ADD CONSTRAINT "Voucher_price_not_above_face" CHECK ("status" IN ('DRAFT', 'NEEDS_CHANGES') OR "sellingPriceHalalas" <= "faceValueHalalas"),
  ADD CONSTRAINT "Voucher_sale_window_order" CHECK ("status" IN ('DRAFT', 'NEEDS_CHANGES') OR "saleEndAt" IS NULL OR "saleStartAt" IS NULL OR "saleEndAt" > "saleStartAt");

ALTER TABLE "VoucherOrder"
  ADD CONSTRAINT "VoucherOrder_amounts" CHECK ("quantity" >= 1 AND "unitPriceHalalas" > 0 AND "totalHalalas" = "unitPriceHalalas" * "quantity");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountHalalas" > 0),
  ADD CONSTRAINT "Payment_attempt_positive" CHECK ("attemptNo" >= 1);

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amount_positive" CHECK ("amountHalalas" > 0);

-- At most one OPEN payment attempt per order: a second tap or a duplicated request can never start a second charge.
CREATE UNIQUE INDEX "Payment_one_open_per_order" ON "Payment"("orderId") WHERE "status" IN ('CREATED', 'PENDING');

-- Exactly one active redemption per voucher instance: the database stops a double redemption even if the application is bypassed.
CREATE UNIQUE INDEX "VoucherRedemption_one_active_per_instance" ON "VoucherRedemption"("instanceId") WHERE "status" = 'REDEEMED';
-- A redeem Idempotency-Key is single-use per staff member.
CREATE UNIQUE INDEX "VoucherRedemption_staff_idempotency" ON "VoucherRedemption"("staffUserId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

-- One live refund case per voucher instance (rejected cases may be followed by a new one).
CREATE UNIQUE INDEX "Refund_one_live_per_instance" ON "Refund"("instanceId") WHERE "instanceId" IS NOT NULL AND "status" <> 'REJECTED';

-- Ledger accounts: one platform account per family, one merchant account per (family, organization).
CREATE UNIQUE INDEX "LedgerAccount_platform_unique" ON "LedgerAccount"("family") WHERE "organizationId" IS NULL;
CREATE UNIQUE INDEX "LedgerAccount_org_unique" ON "LedgerAccount"("family", "organizationId") WHERE "organizationId" IS NOT NULL;

-- Append-only evidence and financial tables (reuses the Stage 3 trigger function): corrections are new, reversing rows.
CREATE TRIGGER "VoucherHistory_append_only" BEFORE UPDATE OR DELETE ON "VoucherHistory" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "PaymentEvent_append_only" BEFORE UPDATE OR DELETE ON "PaymentEvent" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "LedgerJournal_append_only" BEFORE UPDATE OR DELETE ON "LedgerJournal" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "LedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "MerchantPayableEvent_append_only" BEFORE UPDATE OR DELETE ON "MerchantPayableEvent" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();

-- Every ledger journal must balance (its entries sum to zero). Checked when the transaction commits, so a journal can be
-- written entry by entry but can never be committed unbalanced.
CREATE OR REPLACE FUNCTION dd_ledger_journal_balanced() RETURNS trigger AS $$
DECLARE total bigint;
BEGIN
  SELECT COALESCE(SUM("amountHalalas"), 0) INTO total FROM "LedgerEntry" WHERE "journalId" = NEW."journalId";
  IF total <> 0 THEN
    RAISE EXCEPTION 'Ledger journal % does not balance (sum %)', NEW."journalId", total USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "LedgerEntry_journal_balanced" AFTER INSERT ON "LedgerEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION dd_ledger_journal_balanced();