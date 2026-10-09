-- CreateEnum
CREATE TYPE "HotDealStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES', 'SCHEDULED', 'LIVE', 'PAUSED', 'SOLD_OUT', 'EXPIRED', 'CANCELLED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "HotDealAction" AS ENUM ('CREATE', 'UPDATE', 'SUBMIT', 'AUTO_APPROVE', 'REQUEST_CHANGES', 'APPROVE', 'REJECT', 'ACTIVATE', 'SOLD_OUT', 'REOPEN', 'EXPIRE', 'PAUSE', 'RESUME', 'SUSPEND', 'REINSTATE', 'CANCEL', 'MINOR_EDIT', 'STOCK_CHANGED');

-- CreateEnum
CREATE TYPE "HotDealLimitType" AS ENUM ('TIME', 'QUANTITY', 'TIME_AND_QUANTITY');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'REDEEMED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('CUSTOMER', 'MERCHANT', 'DEALDASH', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReservationEventType" AS ENUM ('CREATED', 'EXPIRING_NOTICE', 'CANCELLED', 'EXPIRED', 'NO_SHOW_COUNTED', 'REDEEMED', 'REDEMPTION_REVERSED');

-- CreateEnum
CREATE TYPE "RestrictionStatus" AS ENUM ('ACTIVE', 'LIFTED', 'ENDED');

-- CreateEnum
CREATE TYPE "RedemptionStatus" AS ENUM ('REDEEMED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RedemptionResult" AS ENUM ('VALID', 'REDEEMED', 'INVALID_CODE', 'EXPIRED', 'ALREADY_REDEEMED', 'WRONG_BRANCH', 'INELIGIBLE', 'NOT_ACTIVE', 'CAMPAIGN_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "RedemptionSource" AS ENUM ('QR', 'MANUAL');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('RESERVATION_CONFIRMED', 'RESERVATION_EXPIRING', 'RESERVATION_EXPIRED', 'RESERVATION_CANCELLED', 'REDEMPTION_SUCCESS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DealEventType" ADD VALUE 'RESERVATION_CREATED';
ALTER TYPE "DealEventType" ADD VALUE 'RESERVATION_CANCELLED';
ALTER TYPE "DealEventType" ADD VALUE 'RESERVATION_EXPIRED';
ALTER TYPE "DealEventType" ADD VALUE 'RESERVATION_REDEEMED';

-- AlterTable
ALTER TABLE "DealEvent" ADD COLUMN     "productType" TEXT NOT NULL DEFAULT 'LIVE';

-- CreateTable
CREATE TABLE "HotDeal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "HotDealStatus" NOT NULL DEFAULT 'DRAFT',
    "statusBeforeSuspension" "HotDealStatus",
    "pausedBy" "DealPausedBy",
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "categoryId" UUID,
    "mechanic" "LiveDealMechanic",
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "limitType" "HotDealLimitType" NOT NULL DEFAULT 'QUANTITY',
    "reservationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "holdMinutes" INTEGER,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "eligibilityKind" "EligibilityKind" NOT NULL DEFAULT 'PUBLIC',
    "eligibilityRuleSetId" UUID,
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HotDealInventory" (
    "dealId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "available" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "redeemed" INTEGER NOT NULL DEFAULT 0,
    "released" INTEGER NOT NULL DEFAULT 0,
    "tracked" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HotDealInventory_pkey" PRIMARY KEY ("dealId","branchId")
);

-- CreateTable
CREATE TABLE "HotDealHistory" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "action" "HotDealAction" NOT NULL,
    "fromStatus" "HotDealStatus",
    "toStatus" "HotDealStatus",
    "reason" TEXT,
    "reasonAr" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "actorUserId" UUID,
    "actorRole" TEXT,
    "actorName" TEXT,
    "byDealDash" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HotDealHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "dealId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "holdMinutes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "qrToken" TEXT NOT NULL,
    "manualCode" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" "CancelledBy",
    "cancelReason" TEXT,
    "noShowCounted" BOOLEAN NOT NULL DEFAULT false,
    "expiringNoticeSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationEvent" (
    "id" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "type" "ReservationEventType" NOT NULL,
    "fromStatus" "ReservationStatus",
    "toStatus" "ReservationStatus",
    "actorUserId" UUID,
    "actorRole" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Redemption" (
    "id" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
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

    CONSTRAINT "Redemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedemptionAttempt" (
    "id" UUID NOT NULL,
    "staffUserId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "reservationId" UUID,
    "codeHint" TEXT NOT NULL,
    "source" "RedemptionSource" NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'REDEEM',
    "result" "RedemptionResult" NOT NULL,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedemptionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRestriction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "RestrictionStatus" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT NOT NULL,
    "strikes" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "liftedAt" TIMESTAMP(3),
    "liftedByUserId" UUID,
    "liftedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HotDeal_organizationId_status_idx" ON "HotDeal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "HotDeal_status_startAt_endAt_idx" ON "HotDeal"("status", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "HotDeal_categoryId_status_idx" ON "HotDeal"("categoryId", "status");

-- CreateIndex
CREATE INDEX "HotDealInventory_branchId_idx" ON "HotDealInventory"("branchId");

-- CreateIndex
CREATE INDEX "HotDealHistory_dealId_createdAt_idx" ON "HotDealHistory"("dealId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_reference_key" ON "Reservation"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_qrToken_key" ON "Reservation"("qrToken");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_manualCode_key" ON "Reservation"("manualCode");

-- CreateIndex
CREATE INDEX "Reservation_userId_status_expiresAt_idx" ON "Reservation"("userId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Reservation_dealId_status_idx" ON "Reservation"("dealId", "status");

-- CreateIndex
CREATE INDEX "Reservation_branchId_status_expiresAt_idx" ON "Reservation"("branchId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Reservation_organizationId_createdAt_idx" ON "Reservation"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ReservationEvent_reservationId_createdAt_idx" ON "ReservationEvent"("reservationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Redemption_reference_key" ON "Redemption"("reference");

-- CreateIndex
CREATE INDEX "Redemption_organizationId_redeemedAt_idx" ON "Redemption"("organizationId", "redeemedAt");

-- CreateIndex
CREATE INDEX "Redemption_branchId_redeemedAt_idx" ON "Redemption"("branchId", "redeemedAt");

-- CreateIndex
CREATE INDEX "Redemption_staffUserId_redeemedAt_idx" ON "Redemption"("staffUserId", "redeemedAt");

-- CreateIndex
CREATE INDEX "RedemptionAttempt_staffUserId_createdAt_idx" ON "RedemptionAttempt"("staffUserId", "createdAt");

-- CreateIndex
CREATE INDEX "RedemptionAttempt_organizationId_createdAt_idx" ON "RedemptionAttempt"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "RedemptionAttempt_reservationId_idx" ON "RedemptionAttempt"("reservationId");

-- CreateIndex
CREATE INDEX "CustomerRestriction_userId_status_endsAt_idx" ON "CustomerRestriction"("userId", "status", "endsAt");

-- CreateIndex
CREATE INDEX "CustomerRestriction_status_endsAt_idx" ON "CustomerRestriction"("status", "endsAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "HotDeal" ADD CONSTRAINT "HotDeal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotDeal" ADD CONSTRAINT "HotDeal_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotDeal" ADD CONSTRAINT "HotDeal_eligibilityRuleSetId_fkey" FOREIGN KEY ("eligibilityRuleSetId") REFERENCES "EligibilityRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotDealInventory" ADD CONSTRAINT "HotDealInventory_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "HotDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotDealInventory" ADD CONSTRAINT "HotDealInventory_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "MerchantBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotDealHistory" ADD CONSTRAINT "HotDealHistory_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "HotDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "HotDeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "MerchantBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationEvent" ADD CONSTRAINT "ReservationEvent_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Redemption" ADD CONSTRAINT "Redemption_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------- hand-written integrity rules (not expressible in Prisma)

-- Inventory can never go negative and always balances: total = available + reserved + redeemed.
ALTER TABLE "HotDealInventory"
  ADD CONSTRAINT "HotDealInventory_non_negative" CHECK ("total" >= 0 AND "available" >= 0 AND "reserved" >= 0 AND "redeemed" >= 0 AND "released" >= 0),
  ADD CONSTRAINT "HotDealInventory_balanced" CHECK ("total" = "available" + "reserved" + "redeemed");

ALTER TABLE "HotDeal"
  ADD CONSTRAINT "HotDeal_window_order" CHECK ("endAt" IS NULL OR "startAt" IS NULL OR "endAt" > "startAt"),
  ADD CONSTRAINT "HotDeal_per_customer_limit" CHECK ("perCustomerLimit" >= 1),
  ADD CONSTRAINT "HotDeal_hold_minutes" CHECK ("holdMinutes" IS NULL OR "holdMinutes" BETWEEN 1 AND 1440);

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_quantity_positive" CHECK ("quantity" >= 1),
  ADD CONSTRAINT "Reservation_cancel_consistent" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

-- Exactly one active redemption per reservation: the database stops a double redemption even if the application is bypassed.
CREATE UNIQUE INDEX "Redemption_one_active_per_reservation" ON "Redemption"("reservationId") WHERE "status" = 'REDEEMED';
-- An idempotency key is single-use per staff member.
CREATE UNIQUE INDEX "Redemption_staff_idempotency" ON "Redemption"("staffUserId", "idempotencyKey") WHERE "idempotencyKey" IS NOT NULL;

-- One active restriction per customer at a time.
CREATE UNIQUE INDEX "CustomerRestriction_one_active" ON "CustomerRestriction"("userId") WHERE "status" = 'ACTIVE';

-- Append-only evidence tables (reuses the Stage 3 trigger function).
CREATE TRIGGER "HotDealHistory_append_only" BEFORE UPDATE OR DELETE ON "HotDealHistory" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "ReservationEvent_append_only" BEFORE UPDATE OR DELETE ON "ReservationEvent" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "RedemptionAttempt_append_only" BEFORE UPDATE OR DELETE ON "RedemptionAttempt" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();