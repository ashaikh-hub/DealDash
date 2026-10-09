-- CreateEnum
CREATE TYPE "WatchStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES', 'REJECTED', 'SCHEDULED', 'LIVE', 'PAUSED', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "WatchAction" AS ENUM ('CREATE', 'UPDATE', 'SUBMIT', 'AUTO_APPROVE', 'REQUEST_CHANGES', 'APPROVE', 'REJECT', 'ACTIVATE', 'PAUSE', 'RESUME', 'SUSPEND', 'REINSTATE', 'STOP', 'CANCEL', 'COMPLETE', 'EXPIRE', 'FUND', 'CLOSE_OUT');

-- CreateEnum
CREATE TYPE "WatchViewStatus" AS ENUM ('STARTED', 'QUALIFIED', 'INVALID', 'CAPPED', 'CREDITED_BACK');

-- CreateEnum
CREATE TYPE "WatchFundingSource" AS ENUM ('MOCK_PAYMENT', 'ADMIN_CREDIT');

-- CreateEnum
CREATE TYPE "RiskDecision" AS ENUM ('ALLOW', 'HOLD', 'FLAG', 'BLOCK');

-- CreateEnum
CREATE TYPE "RiskFlagStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'DECIDED');

-- CreateEnum
CREATE TYPE "RewardEntryType" AS ENUM ('EARN', 'HOLD', 'RELEASE', 'REVERSE', 'REDEEM', 'EXPIRE', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RewardBucket" AS ENUM ('AVAILABLE', 'HELD');

-- CreateEnum
CREATE TYPE "RewardAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RewardItemStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- AlterEnum
ALTER TYPE "DealEventType" ADD VALUE 'CTA_CLICK';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerAccountFamily" ADD VALUE 'CAMPAIGN_BUDGET';
ALTER TYPE "LedgerAccountFamily" ADD VALUE 'CAMPAIGN_UNUSED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerJournalType" ADD VALUE 'CAMPAIGN_FUNDING';
ALTER TYPE "LedgerJournalType" ADD VALUE 'CAMPAIGN_CONSUMPTION';
ALTER TYPE "LedgerJournalType" ADD VALUE 'CAMPAIGN_CREDIT_BACK';
ALTER TYPE "LedgerJournalType" ADD VALUE 'CAMPAIGN_RELEASE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'REWARD_EARNED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_HELD';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_RELEASED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_REVERSED';
ALTER TYPE "NotificationType" ADD VALUE 'REWARD_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'CAMPAIGN_COMPLETED';

-- CreateTable
CREATE TABLE "WatchCampaign" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "WatchStatus" NOT NULL DEFAULT 'DRAFT',
    "statusBeforeSuspension" "WatchStatus",
    "pausedBy" "DealPausedBy",
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "videoFileId" UUID,
    "thumbnailFileId" UUID,
    "durationSec" INTEGER,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "eligibilityKind" "EligibilityKind" NOT NULL DEFAULT 'PUBLIC',
    "repeatWindowHours" INTEGER NOT NULL DEFAULT 24,
    "paidViews" INTEGER NOT NULL DEFAULT 0,
    "qualifiedViews" INTEGER NOT NULL DEFAULT 0,
    "chargePerViewHalalas" INTEGER NOT NULL DEFAULT 0,
    "rateCardVersion" INTEGER,
    "requiredBudgetHalalas" INTEGER NOT NULL DEFAULT 0,
    "fundedHalalas" INTEGER NOT NULL DEFAULT 0,
    "spentHalalas" INTEGER NOT NULL DEFAULT 0,
    "unusedHalalas" INTEGER NOT NULL DEFAULT 0,
    "closedOutAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchCampaignHistory" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "action" "WatchAction" NOT NULL,
    "fromStatus" "WatchStatus",
    "toStatus" "WatchStatus",
    "reason" TEXT,
    "reasonAr" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "actorUserId" UUID,
    "actorRole" TEXT,
    "actorName" TEXT,
    "byDealDash" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchCampaignHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchFunding" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "amountHalalas" INTEGER NOT NULL,
    "source" "WatchFundingSource" NOT NULL,
    "reference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "journalId" UUID,
    "createdByUserId" UUID,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchFunding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchView" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "WatchViewStatus" NOT NULL DEFAULT 'STARTED',
    "reason" TEXT,
    "city" TEXT,
    "durationSec" INTEGER NOT NULL,
    "requiredSeconds" INTEGER NOT NULL DEFAULT 0,
    "watchedSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "positionSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastEventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "qualifiedAt" TIMESTAMP(3),
    "stillWatchingNeeded" BOOLEAN NOT NULL DEFAULT false,
    "prompt" JSONB,
    "chargeHalalas" INTEGER NOT NULL DEFAULT 0,
    "rewardPoints" INTEGER NOT NULL DEFAULT 0,
    "rewardState" TEXT,
    "rewardEntryId" UUID,
    "consumptionJournalId" UUID,
    "riskDecision" "RiskDecision",
    "riskScore" INTEGER,
    "riskSignals" JSONB NOT NULL DEFAULT '[]',
    "creditedBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchViewEvent" (
    "id" UUID NOT NULL,
    "viewId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "positionSec" DOUBLE PRECISION NOT NULL,
    "clientAt" BIGINT,
    "serverAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB,

    CONSTRAINT "WatchViewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceLink" (
    "id" UUID NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskFlag" (
    "id" UUID NOT NULL,
    "status" "RiskFlagStatus" NOT NULL DEFAULT 'OPEN',
    "decision" "RiskDecision" NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 0,
    "signals" JSONB NOT NULL DEFAULT '[]',
    "subjectUserId" UUID,
    "subjectDeviceHash" TEXT,
    "campaignId" UUID,
    "viewId" UUID,
    "rewardEntryId" UUID,
    "outcome" TEXT,
    "reviewedByUserId" UUID,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskBlock" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'WATCH',
    "reason" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),

    CONSTRAINT "RiskBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardAccount" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "availableBalance" INTEGER NOT NULL DEFAULT 0,
    "heldBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRedeemed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardEntry" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "type" "RewardEntryType" NOT NULL,
    "bucket" "RewardBucket" NOT NULL,
    "points" INTEGER NOT NULL,
    "availableAfter" INTEGER NOT NULL,
    "heldAfter" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "reasonCode" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "actorUserId" UUID,
    "actorRole" TEXT,
    "expiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardLot" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardCatalogueItem" (
    "id" UUID NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descriptionEn" TEXT NOT NULL DEFAULT '',
    "descriptionAr" TEXT NOT NULL DEFAULT '',
    "pointsCost" INTEGER NOT NULL,
    "stock" INTEGER,
    "status" "RewardItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "validityDays" INTEGER,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardCatalogueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "pointsCost" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardAdjustment" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "ticketRef" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RewardAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" UUID NOT NULL,
    "requestedByName" TEXT,
    "decidedByUserId" UUID,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "entryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WatchCampaign_organizationId_status_idx" ON "WatchCampaign"("organizationId", "status");

-- CreateIndex
CREATE INDEX "WatchCampaign_status_startAt_endAt_idx" ON "WatchCampaign"("status", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "WatchCampaignHistory_campaignId_createdAt_idx" ON "WatchCampaignHistory"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchFunding_reference_key" ON "WatchFunding"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "WatchFunding_idempotencyKey_key" ON "WatchFunding"("idempotencyKey");

-- CreateIndex
CREATE INDEX "WatchFunding_campaignId_createdAt_idx" ON "WatchFunding"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchView_tokenHash_key" ON "WatchView"("tokenHash");

-- CreateIndex
CREATE INDEX "WatchView_campaignId_status_startedAt_idx" ON "WatchView"("campaignId", "status", "startedAt");

-- CreateIndex
CREATE INDEX "WatchView_userId_startedAt_idx" ON "WatchView"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "WatchView_deviceHash_startedAt_idx" ON "WatchView"("deviceHash", "startedAt");

-- CreateIndex
CREATE INDEX "WatchView_userId_campaignId_qualifiedAt_idx" ON "WatchView"("userId", "campaignId", "qualifiedAt");

-- CreateIndex
CREATE INDEX "WatchViewEvent_viewId_serverAt_idx" ON "WatchViewEvent"("viewId", "serverAt");

-- CreateIndex
CREATE INDEX "DeviceLink_userId_idx" ON "DeviceLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceLink_deviceHash_userId_key" ON "DeviceLink"("deviceHash", "userId");

-- CreateIndex
CREATE INDEX "RiskFlag_status_createdAt_idx" ON "RiskFlag"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RiskFlag_subjectUserId_idx" ON "RiskFlag"("subjectUserId");

-- CreateIndex
CREATE INDEX "RiskFlag_campaignId_status_idx" ON "RiskFlag"("campaignId", "status");

-- CreateIndex
CREATE INDEX "RiskBlock_kind_subjectId_active_idx" ON "RiskBlock"("kind", "subjectId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RewardAccount_userId_key" ON "RewardAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardEntry_idempotencyKey_key" ON "RewardEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RewardEntry_accountId_createdAt_idx" ON "RewardEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "RewardEntry_sourceType_sourceId_idx" ON "RewardEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardLot_entryId_key" ON "RewardLot"("entryId");

-- CreateIndex
CREATE INDEX "RewardLot_accountId_expiresAt_idx" ON "RewardLot"("accountId", "expiresAt");

-- CreateIndex
CREATE INDEX "RewardCatalogueItem_status_idx" ON "RewardCatalogueItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_code_key" ON "RewardRedemption"("code");

-- CreateIndex
CREATE INDEX "RewardRedemption_accountId_createdAt_idx" ON "RewardRedemption"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_accountId_idempotencyKey_key" ON "RewardRedemption"("accountId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RewardAdjustment_status_createdAt_idx" ON "RewardAdjustment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RewardAdjustment_accountId_idx" ON "RewardAdjustment"("accountId");

-- AddForeignKey
ALTER TABLE "WatchCampaign" ADD CONSTRAINT "WatchCampaign_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchCampaignHistory" ADD CONSTRAINT "WatchCampaignHistory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WatchCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchFunding" ADD CONSTRAINT "WatchFunding_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WatchCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchView" ADD CONSTRAINT "WatchView_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WatchCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchViewEvent" ADD CONSTRAINT "WatchViewEvent_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "WatchView"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardEntry" ADD CONSTRAINT "RewardEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RewardAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardLot" ADD CONSTRAINT "RewardLot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RewardAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RewardAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RewardCatalogueItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ================================================================ hand-written guarantees (not expressible in the Prisma schema)

-- Campaign budget can never be overspent and views can never exceed the paid quantity. Together with the conditional UPDATE
-- used at qualification time this makes a hard cap with zero tolerance (WE-51).
ALTER TABLE "WatchCampaign"
  ADD CONSTRAINT "WatchCampaign_money_non_negative" CHECK ("fundedHalalas" >= 0 AND "spentHalalas" >= 0 AND "unusedHalalas" >= 0 AND "requiredBudgetHalalas" >= 0 AND "chargePerViewHalalas" >= 0),
  ADD CONSTRAINT "WatchCampaign_spend_within_funding" CHECK ("spentHalalas" <= "fundedHalalas"),
  ADD CONSTRAINT "WatchCampaign_views_within_paid" CHECK ("qualifiedViews" >= 0 AND "qualifiedViews" <= "paidViews"),
  ADD CONSTRAINT "WatchCampaign_period_order" CHECK ("status" IN ('DRAFT', 'NEEDS_CHANGES') OR "endAt" IS NULL OR "startAt" IS NULL OR "endAt" > "startAt");

ALTER TABLE "WatchFunding" ADD CONSTRAINT "WatchFunding_amount_positive" CHECK ("amountHalalas" > 0);

-- A customer has at most ONE open viewing session (maximum concurrent sessions = 1).
CREATE UNIQUE INDEX "WatchView_one_started_per_user" ON "WatchView"("userId") WHERE "status" = 'STARTED';
ALTER TABLE "WatchView" ADD CONSTRAINT "WatchView_amounts" CHECK ("chargeHalalas" >= 0 AND "rewardPoints" >= 0 AND "durationSec" > 0);

-- A view can be rewarded at most once: duplicate reward prevention at the database level.
CREATE UNIQUE INDEX "RewardEntry_one_credit_per_view" ON "RewardEntry"("sourceType", "sourceId") WHERE "sourceType" = 'VIEW' AND "type" IN ('EARN', 'HOLD');
-- ... and a view's merchant charge is posted at most once.
CREATE UNIQUE INDEX "WatchView_one_consumption" ON "WatchView"("consumptionJournalId") WHERE "consumptionJournalId" IS NOT NULL;

-- Reward balances: the held bucket never goes negative; lots never go below zero or above what was credited. The available
-- bucket MAY go negative only through a reversal of already spent points (policy rewards.rules.negativeBalancePolicy, FDR-24).
ALTER TABLE "RewardAccount" ADD CONSTRAINT "RewardAccount_held_non_negative" CHECK ("heldBalance" >= 0);
ALTER TABLE "RewardLot" ADD CONSTRAINT "RewardLot_remaining_bounds" CHECK ("remaining" >= 0 AND "remaining" <= "points" AND "points" > 0);
ALTER TABLE "RewardEntry" ADD CONSTRAINT "RewardEntry_points_non_zero" CHECK ("points" <> 0);
ALTER TABLE "RewardCatalogueItem" ADD CONSTRAINT "RewardCatalogueItem_valid" CHECK ("pointsCost" > 0 AND ("stock" IS NULL OR "stock" >= 0));

-- Only one active block per subject.
CREATE UNIQUE INDEX "RiskBlock_one_active" ON "RiskBlock"("kind", "subjectId", "scope") WHERE "active";

-- Append-only: the ledger of rewards, the view timeline and campaign history are never edited or deleted.
CREATE TRIGGER "RewardEntry_append_only" BEFORE UPDATE OR DELETE ON "RewardEntry" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "WatchViewEvent_append_only" BEFORE UPDATE OR DELETE ON "WatchViewEvent" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "WatchCampaignHistory_append_only" BEFORE UPDATE OR DELETE ON "WatchCampaignHistory" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();