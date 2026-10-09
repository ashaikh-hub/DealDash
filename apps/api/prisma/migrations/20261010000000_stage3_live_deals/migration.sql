-- CreateEnum
CREATE TYPE "LiveDealStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES', 'SCHEDULED', 'LIVE', 'PAUSED', 'EXPIRED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "LiveDealRevisionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LiveDealAction" AS ENUM ('CREATE', 'UPDATE', 'SUBMIT', 'AUTO_APPROVE', 'REQUEST_CHANGES', 'APPROVE', 'REJECT', 'ACTIVATE', 'EXPIRE', 'PAUSE', 'RESUME', 'SUSPEND', 'REINSTATE', 'END', 'MINOR_EDIT', 'REVISION_SAVED', 'REVISION_SUBMIT', 'REVISION_AUTO_APPROVE', 'REVISION_REQUEST_CHANGES', 'REVISION_APPROVE', 'REVISION_REJECT', 'REVISION_DISCARD');

-- CreateEnum
CREATE TYPE "LiveDealMechanic" AS ENUM ('PERCENTAGE_OFF', 'AMOUNT_OFF', 'BOGO', 'BUNDLE', 'MEAL_DEAL', 'SERVICE_OFFER', 'EVERYDAY_PROMOTION', 'OTHER');

-- CreateEnum
CREATE TYPE "RedemptionMode" AS ENUM ('GENERAL', 'CONTROLLED');

-- CreateEnum
CREATE TYPE "DealPausedBy" AS ENUM ('MERCHANT', 'DEALDASH');

-- CreateEnum
CREATE TYPE "EligibilityKind" AS ENUM ('PUBLIC', 'GEOGRAPHY', 'EMPLOYER', 'BANK_CARD', 'SCHEME');

-- CreateEnum
CREATE TYPE "EligibilityAttributeType" AS ENUM ('GEOGRAPHY', 'EMPLOYER', 'CARD', 'SCHEME');

-- CreateEnum
CREATE TYPE "EligibilityLevel" AS ENUM ('SELF_DECLARED', 'OTP_VERIFIED', 'ISSUER_VERIFIED');

-- CreateEnum
CREATE TYPE "EligibilityAttributeStatus" AS ENUM ('PENDING', 'VERIFIED', 'REVERIFICATION_DUE', 'EXPIRED', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DealEventType" AS ENUM ('IMPRESSION', 'DETAIL_VIEW', 'MERCHANT_PAGE_VIEW', 'SAVE', 'UNSAVE', 'DIRECTIONS_CLICK');

-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "icon" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityRuleSet" (
    "id" UUID NOT NULL,
    "ownerOrganizationId" UUID,
    "kind" "EligibilityKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityCondition" (
    "id" UUID NOT NULL,
    "ruleSetId" UUID NOT NULL,
    "attrType" "EligibilityAttributeType" NOT NULL,
    "operator" TEXT NOT NULL DEFAULT 'EQUALS',
    "valueRef" TEXT NOT NULL,
    "requiredLevel" "EligibilityLevel" NOT NULL DEFAULT 'OTP_VERIFIED',

    CONSTRAINT "EligibilityCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityAttribute" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "attrType" "EligibilityAttributeType" NOT NULL,
    "valueRef" TEXT NOT NULL,
    "level" "EligibilityLevel" NOT NULL DEFAULT 'SELF_DECLARED',
    "status" "EligibilityAttributeStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT NOT NULL DEFAULT 'SELF',
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveDeal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "status" "LiveDealStatus" NOT NULL DEFAULT 'DRAFT',
    "statusBeforeSuspension" "LiveDealStatus",
    "pausedBy" "DealPausedBy",
    "version" INTEGER NOT NULL DEFAULT 1,
    "content" JSONB NOT NULL,
    "categoryId" UUID,
    "mechanic" "LiveDealMechanic",
    "titleEn" TEXT NOT NULL DEFAULT '',
    "titleAr" TEXT NOT NULL DEFAULT '',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "eligibilityKind" "EligibilityKind" NOT NULL DEFAULT 'PUBLIC',
    "eligibilityRuleSetId" UUID,
    "redemptionMode" "RedemptionMode" NOT NULL DEFAULT 'GENERAL',
    "submittedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveDeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveDealBranch" (
    "dealId" UUID NOT NULL,
    "branchId" UUID NOT NULL,

    CONSTRAINT "LiveDealBranch_pkey" PRIMARY KEY ("dealId","branchId")
);

-- CreateTable
CREATE TABLE "LiveDealRevision" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "LiveDealRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "materialFields" JSONB NOT NULL DEFAULT '[]',
    "baseVersion" INTEGER NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveDealRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveDealHistory" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "revisionId" UUID,
    "action" "LiveDealAction" NOT NULL,
    "fromStatus" "LiveDealStatus",
    "toStatus" "LiveDealStatus",
    "reason" TEXT,
    "reasonAr" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "actorUserId" UUID,
    "actorRole" TEXT,
    "actorName" TEXT,
    "byDealDash" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveDealHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedItem" (
    "userId" UUID NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" UUID NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedItem_pkey" PRIMARY KEY ("userId","objectType","objectId")
);

-- CreateTable
CREATE TABLE "DealEvent" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "DealEventType" NOT NULL,
    "dealId" UUID,
    "merchantOrgId" UUID NOT NULL,
    "branchId" UUID,
    "sourceDealId" UUID,
    "userId" UUID,
    "anonymousId" TEXT NOT NULL,

    CONSTRAINT "DealEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_code_key" ON "Category"("code");

-- CreateIndex
CREATE INDEX "Category_active_sortOrder_idx" ON "Category"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "EligibilityCondition_ruleSetId_idx" ON "EligibilityCondition"("ruleSetId");

-- CreateIndex
CREATE INDEX "EligibilityAttribute_userId_status_idx" ON "EligibilityAttribute"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityAttribute_userId_attrType_valueRef_key" ON "EligibilityAttribute"("userId", "attrType", "valueRef");

-- CreateIndex
CREATE INDEX "LiveDeal_organizationId_status_idx" ON "LiveDeal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LiveDeal_status_startAt_endAt_idx" ON "LiveDeal"("status", "startAt", "endAt");

-- CreateIndex
CREATE INDEX "LiveDeal_categoryId_status_idx" ON "LiveDeal"("categoryId", "status");

-- CreateIndex
CREATE INDEX "LiveDealBranch_branchId_idx" ON "LiveDealBranch"("branchId");

-- CreateIndex
CREATE INDEX "LiveDealRevision_status_submittedAt_idx" ON "LiveDealRevision"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveDealRevision_dealId_number_key" ON "LiveDealRevision"("dealId", "number");

-- CreateIndex
CREATE INDEX "LiveDealHistory_dealId_createdAt_idx" ON "LiveDealHistory"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "SavedItem_objectType_objectId_idx" ON "SavedItem"("objectType", "objectId");

-- CreateIndex
CREATE INDEX "DealEvent_dealId_type_occurredAt_idx" ON "DealEvent"("dealId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "DealEvent_merchantOrgId_type_occurredAt_idx" ON "DealEvent"("merchantOrgId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "DealEvent_occurredAt_idx" ON "DealEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "EligibilityCondition" ADD CONSTRAINT "EligibilityCondition_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "EligibilityRuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDeal" ADD CONSTRAINT "LiveDeal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDeal" ADD CONSTRAINT "LiveDeal_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDeal" ADD CONSTRAINT "LiveDeal_eligibilityRuleSetId_fkey" FOREIGN KEY ("eligibilityRuleSetId") REFERENCES "EligibilityRuleSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDealBranch" ADD CONSTRAINT "LiveDealBranch_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "LiveDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDealBranch" ADD CONSTRAINT "LiveDealBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "MerchantBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDealRevision" ADD CONSTRAINT "LiveDealRevision_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "LiveDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDealHistory" ADD CONSTRAINT "LiveDealHistory_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "LiveDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------------------------------------------------------------- Stage 3 hand-written parts (constraints Prisma cannot express)

-- Arabic-aware normalisation used by search: unify alef forms, remove diacritics and tatweel, map teh marbuta and alef maksura.
CREATE OR REPLACE FUNCTION dd_norm_ar(input text) RETURNS text AS $$
  SELECT lower(
    regexp_replace(
      translate(coalesce(input, ''), 'أإآىة', 'اااية'),
      '[\u064B-\u065F\u0670\u0640]', '', 'g'
    )
  );
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- Data-quality guards.
ALTER TABLE "LiveDeal" ADD CONSTRAINT "LiveDeal_dates_ordered" CHECK ("endAt" IS NULL OR "startAt" IS NULL OR "endAt" > "startAt");
ALTER TABLE "LiveDeal" ADD CONSTRAINT "LiveDeal_version_positive" CHECK ("version" >= 1);

-- Only one open (not yet decided) revision per deal.
CREATE UNIQUE INDEX "LiveDealRevision_one_open_per_deal" ON "LiveDealRevision"("dealId") WHERE "status" IN ('DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES');

-- Discovery reads only look at deals that can be visible.
CREATE INDEX "LiveDeal_discoverable_idx" ON "LiveDeal"("startAt", "endAt") WHERE "status" IN ('SCHEDULED', 'LIVE');

-- Deal history and discovery events are append-only (same rule as the audit log).
CREATE OR REPLACE FUNCTION dd_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% is not allowed)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LiveDealHistory_no_update_delete" BEFORE UPDATE OR DELETE ON "LiveDealHistory" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "DealEvent_no_update_delete" BEFORE UPDATE OR DELETE ON "DealEvent" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();