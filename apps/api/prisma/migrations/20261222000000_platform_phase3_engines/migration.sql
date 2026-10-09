-- AlterEnum
ALTER TYPE "CommercialProduct" ADD VALUE 'LOYALTY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EligibilityAttributeType" ADD VALUE 'COUNTRY';
ALTER TYPE "EligibilityAttributeType" ADD VALUE 'CARD_PRODUCT';
ALTER TYPE "EligibilityAttributeType" ADD VALUE 'CARD_TIER';
ALTER TYPE "EligibilityAttributeType" ADD VALUE 'SEGMENT';
ALTER TYPE "EligibilityAttributeType" ADD VALUE 'MEMBERSHIP';
ALTER TYPE "EligibilityAttributeType" ADD VALUE 'PRODUCT_OWNERSHIP';
ALTER TYPE "EligibilityAttributeType" ADD VALUE 'AGE_BAND';
ALTER TYPE "EligibilityAttributeType" ADD VALUE 'GENDER';

-- AlterEnum
ALTER TYPE "EligibilityKind" ADD VALUE 'COMPOSITE';

-- AlterEnum
ALTER TYPE "RewardEntryType" ADD VALUE 'BONUS';

-- AlterTable
ALTER TABLE "EligibilityRuleSet" ADD COLUMN     "expression" JSONB;

-- AlterTable
ALTER TABLE "Redemption" ADD COLUMN     "campaignVersion" INTEGER;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "campaignVersion" INTEGER;

-- AlterTable
ALTER TABLE "RewardCatalogueItem" ADD COLUMN     "destinationRef" TEXT,
ADD COLUMN     "destinationType" TEXT NOT NULL DEFAULT 'CATALOGUE',
ADD COLUMN     "ownerOrganizationId" UUID;

-- AlterTable
ALTER TABLE "RewardEntry" ADD COLUMN     "campaignVersion" INTEGER,
ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "financialRef" UUID,
ADD COLUMN     "fundingOrganizationId" UUID,
ADD COLUMN     "fundingSource" TEXT NOT NULL DEFAULT 'DEALDASH',
ADD COLUMN     "ruleId" UUID,
ADD COLUMN     "sourceCampaignId" UUID,
ADD COLUMN     "sourceProduct" TEXT;

-- AlterTable
ALTER TABLE "UtilizationEvent" ADD COLUMN     "campaignVersion" INTEGER;

-- AlterTable
ALTER TABLE "VoucherInstance" ADD COLUMN     "campaignVersion" INTEGER;

-- AlterTable
ALTER TABLE "VoucherRedemption" ADD COLUMN     "campaignVersion" INTEGER;

-- AlterTable
ALTER TABLE "WatchView" ADD COLUMN     "campaignVersion" INTEGER;

-- CreateTable
CREATE TABLE "LoyaltyRule" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "eventType" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BASE',
    "productScope" TEXT,
    "campaignId" UUID,
    "organizationId" UUID,
    "basePoints" INTEGER NOT NULL DEFAULT 0,
    "bonusPoints" INTEGER NOT NULL DEFAULT 0,
    "multiplierBps" INTEGER NOT NULL DEFAULT 10000,
    "pointsPer100Halalas" INTEGER NOT NULL DEFAULT 0,
    "dailyCap" INTEGER,
    "monthlyCap" INTEGER,
    "customerCap" INTEGER,
    "eligibilityRuleSetId" UUID,
    "fundingSource" TEXT NOT NULL DEFAULT 'DEALDASH',
    "fundingOrganizationId" UUID,
    "fundingHalalasPerPoint" INTEGER,
    "expiryDays" INTEGER,
    "maxAllocationPoints" INTEGER,
    "allocatedPoints" INTEGER NOT NULL DEFAULT 0,
    "reversedPoints" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignVersion" (
    "id" UUID NOT NULL,
    "product" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "quotationId" UUID,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalTask" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "organizationId" UUID,
    "product" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "branchId" UUID,
    "country" TEXT,
    "requiredPermission" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,
    "resolution" TEXT,

    CONSTRAINT "ApprovalTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisputeCase" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "product" TEXT,
    "organizationId" UUID,
    "customerUserId" UUID,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "ownerUserId" UUID,
    "openedByUserId" UUID,
    "openedByOrganizationId" UUID,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,
    "financialAdjustmentId" UUID,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisputeCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseNote" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "authorUserId" UUID,
    "authorOrganizationId" UUID,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferConflictFlag" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "type" TEXT NOT NULL,
    "aProduct" TEXT NOT NULL,
    "aId" UUID NOT NULL,
    "bProduct" TEXT NOT NULL,
    "bId" UUID NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "decidedByUserId" UUID,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferConflictFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoyaltyRule_status_eventType_idx" ON "LoyaltyRule"("status", "eventType");

-- CreateIndex
CREATE INDEX "LoyaltyRule_organizationId_idx" ON "LoyaltyRule"("organizationId");

-- CreateIndex
CREATE INDEX "CampaignVersion_product_subjectId_status_idx" ON "CampaignVersion"("product", "subjectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVersion_product_subjectId_version_key" ON "CampaignVersion"("product", "subjectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalTask_dedupeKey_key" ON "ApprovalTask"("dedupeKey");

-- CreateIndex
CREATE INDEX "ApprovalTask_status_organizationId_idx" ON "ApprovalTask"("status", "organizationId");

-- CreateIndex
CREATE INDEX "ApprovalTask_kind_status_idx" ON "ApprovalTask"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DisputeCase_reference_key" ON "DisputeCase"("reference");

-- CreateIndex
CREATE INDEX "DisputeCase_status_slaDueAt_idx" ON "DisputeCase"("status", "slaDueAt");

-- CreateIndex
CREATE INDEX "DisputeCase_organizationId_status_idx" ON "DisputeCase"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DisputeCase_customerUserId_idx" ON "DisputeCase"("customerUserId");

-- CreateIndex
CREATE INDEX "CaseNote_caseId_createdAt_idx" ON "CaseNote"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "OfferConflictFlag_status_createdAt_idx" ON "OfferConflictFlag"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferConflictFlag_type_aId_bId_key" ON "OfferConflictFlag"("type", "aId", "bId");

-- CreateIndex
CREATE INDEX "RewardEntry_ruleId_createdAt_idx" ON "RewardEntry"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "RewardEntry_fundingSource_fundingOrganizationId_idx" ON "RewardEntry"("fundingSource", "fundingOrganizationId");

-- AddForeignKey
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "DisputeCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ================================================================ hand-written guarantees and backfill (Phase 3)
ALTER TABLE "LoyaltyRule" ADD CONSTRAINT "LoyaltyRule_values" CHECK (
  "status" IN ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'ENDED', 'REJECTED')
  AND "kind" IN ('BASE', 'BONUS')
  AND "fundingSource" IN ('DEALDASH', 'MERCHANT', 'BANK', 'SCHEME', 'CORPORATE', 'CAMPAIGN', 'SPONSOR')
  AND "basePoints" >= 0 AND "bonusPoints" >= 0 AND "multiplierBps" BETWEEN 0 AND 1000000 AND "pointsPer100Halalas" >= 0
  AND ("effectiveUntil" IS NULL OR "effectiveUntil" > "effectiveFrom"));
-- an active rule always has a ceiling (no uncontrolled liability), and issued points can never exceed it
ALTER TABLE "LoyaltyRule" ADD CONSTRAINT "LoyaltyRule_allocation" CHECK (
  "allocatedPoints" >= 0 AND "reversedPoints" >= 0 AND "reversedPoints" <= "allocatedPoints"
  AND ("maxAllocationPoints" IS NULL OR "allocatedPoints" <= "maxAllocationPoints")
  AND ("status" NOT IN ('PENDING_APPROVAL', 'ACTIVE') OR "maxAllocationPoints" IS NOT NULL));
-- funded points name the funder and the agreed rate
ALTER TABLE "LoyaltyRule" ADD CONSTRAINT "LoyaltyRule_funding" CHECK (
  "fundingSource" = 'DEALDASH' OR ("fundingOrganizationId" IS NOT NULL AND "fundingHalalasPerPoint" IS NOT NULL AND "fundingHalalasPerPoint" >= 0));
ALTER TABLE "CampaignVersion" ADD CONSTRAINT "CampaignVersion_values" CHECK ("version" >= 1 AND "status" IN ('DRAFT', 'LIVE', 'SUPERSEDED'));
-- only one version of a campaign is live at a time
CREATE UNIQUE INDEX "CampaignVersion_one_live" ON "CampaignVersion" ("product", "subjectId") WHERE "status" = 'LIVE';
ALTER TABLE "ApprovalTask" ADD CONSTRAINT "ApprovalTask_values" CHECK ("status" IN ('OPEN', 'DONE', 'DISMISSED') AND "priority" IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL'));
ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_values" CHECK ("status" IN ('OPEN', 'IN_REVIEW', 'WAITING', 'RESOLVED', 'CLOSED') AND "priority" IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL'));
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_visibility" CHECK ("visibility" IN ('INTERNAL', 'SHARED'));
-- notes are history: never edited or deleted
CREATE TRIGGER "CaseNote_append_only" BEFORE UPDATE OR DELETE ON "CaseNote" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
ALTER TABLE "OfferConflictFlag" ADD CONSTRAINT "OfferConflictFlag_values" CHECK ("status" IN ('OPEN', 'ACKNOWLEDGED', 'DISMISSED'));
-- campaign versions are frozen history: the content of a version is never changed (only its status / end date)
CREATE OR REPLACE FUNCTION dd_campaign_version_frozen() RETURNS trigger AS $$
BEGIN
  IF NEW."content" IS DISTINCT FROM OLD."content" OR NEW."contentHash" <> OLD."contentHash" OR NEW."version" <> OLD."version" OR NEW."subjectId" <> OLD."subjectId" THEN
    RAISE EXCEPTION 'A campaign version is immutable';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "CampaignVersion_frozen" BEFORE UPDATE ON "CampaignVersion" FOR EACH ROW EXECUTE FUNCTION dd_campaign_version_frozen();
-- Existing points were all issued by Watch & Earn views and funded by DealDash. The ledger is append-only (a trigger blocks every UPDATE),
-- so this one-time backfill of the NEW, previously empty provenance columns lifts the guard for the duration of the statement only.
-- Amounts, buckets, balances and every original column are untouched.
ALTER TABLE "RewardEntry" DISABLE TRIGGER "RewardEntry_append_only";
UPDATE "RewardEntry" e SET "sourceProduct" = 'WATCH', "sourceCampaignId" = v."campaignId"
  FROM "WatchView" v WHERE e."sourceType" = 'VIEW' AND e."sourceId" = v."id"::text AND e."sourceProduct" IS NULL;
ALTER TABLE "RewardEntry" ENABLE TRIGGER "RewardEntry_append_only";