-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PartnerType" ADD VALUE 'FINANCIAL_INSTITUTION';
ALTER TYPE "PartnerType" ADD VALUE 'CORPORATE';
ALTER TYPE "PartnerType" ADD VALUE 'STRATEGIC_PARTNER';
ALTER TYPE "PartnerType" ADD VALUE 'OTHER_APPROVED_PARTNER';

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" UUID,
ADD COLUMN     "contacts" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "lifecycle" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "lifecycleReason" TEXT,
ADD COLUMN     "parentGroup" TEXT,
ADD COLUMN     "pendingLifecycle" TEXT,
ADD COLUMN     "pendingReason" TEXT,
ADD COLUMN     "pendingRequestedAt" TIMESTAMP(3),
ADD COLUMN     "pendingRequestedByUserId" UUID,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "requestedMarkets" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" UUID,
ADD COLUMN     "signatory" JSONB,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "taxNumber" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "EligibilityRuleSet" ADD COLUMN     "name" TEXT;

-- AlterTable
ALTER TABLE "MatchCandidate" ADD COLUMN     "partnerSuggestedAt" TIMESTAMP(3),
ADD COLUMN     "partnerSuggestion" TEXT,
ADD COLUMN     "partnerSuggestionNote" TEXT,
ADD COLUMN     "partnerSuggestionOrgId" UUID;

-- CreateTable
CREATE TABLE "PartnerCardProgram" (
    "id" UUID NOT NULL,
    "partnerOrganizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "issuerName" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "binPrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "market" TEXT NOT NULL,
    "verificationMethod" TEXT NOT NULL DEFAULT 'SELF_DECLARED',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerCardProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerEmployerProgram" (
    "id" UUID NOT NULL,
    "partnerOrganizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "market" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerEmployerProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveDealPartnerBenefit" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "liveDealId" UUID NOT NULL,
    "partnerOrganizationId" UUID NOT NULL,
    "merchantOrganizationId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "valueNumber" DECIMAL(14,2),
    "labelEn" TEXT NOT NULL,
    "labelAr" TEXT NOT NULL,
    "termsEn" TEXT NOT NULL DEFAULT '',
    "termsAr" TEXT NOT NULL DEFAULT '',
    "eligibilityRuleSetId" UUID,
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "market" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "proposedByUserId" UUID NOT NULL,
    "merchantDecidedByUserId" UUID,
    "merchantDecidedAt" TIMESTAMP(3),
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveDealPartnerBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerCardProgram_scheme_tier_idx" ON "PartnerCardProgram"("scheme", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerCardProgram_partnerOrganizationId_code_key" ON "PartnerCardProgram"("partnerOrganizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerEmployerProgram_partnerOrganizationId_code_key" ON "PartnerEmployerProgram"("partnerOrganizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LiveDealPartnerBenefit_reference_key" ON "LiveDealPartnerBenefit"("reference");

-- CreateIndex
CREATE INDEX "LiveDealPartnerBenefit_liveDealId_status_idx" ON "LiveDealPartnerBenefit"("liveDealId", "status");

-- CreateIndex
CREATE INDEX "LiveDealPartnerBenefit_partnerOrganizationId_status_idx" ON "LiveDealPartnerBenefit"("partnerOrganizationId", "status");

-- CreateIndex
CREATE INDEX "LiveDealPartnerBenefit_merchantOrganizationId_status_idx" ON "LiveDealPartnerBenefit"("merchantOrganizationId", "status");

-- CreateIndex
CREATE INDEX "Partner_lifecycle_idx" ON "Partner"("lifecycle");

-- ================================================================ Stage 7 (hand-written): backfill, vocabularies, card-data guard
-- Partner organizations that are already live keep operating: they are recorded as ACTIVE (grandfathered, like the Saudi market's
-- PILOT state). Every other partner starts its onboarding at DRAFT.
UPDATE "Partner" p SET "lifecycle" = 'ACTIVE', "approvedAt" = NOW(), "lifecycleReason" = 'Grandfathered at Stage 7 (partner already active)'
FROM "Organization" o WHERE o."id" = p."organizationId" AND o."status" = 'ACTIVE';

ALTER TABLE "Partner" ADD CONSTRAINT "Partner_lifecycle_check" CHECK ("lifecycle" IN ('DRAFT','UNDER_REVIEW','CHANGES_REQUESTED','APPROVED','CONTRACT_ACTIVE','FINANCE_READY','PRODUCT_ENABLED','ACTIVE','SUSPENDED','REJECTED'));
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_pendingLifecycle_check" CHECK ("pendingLifecycle" IS NULL OR "pendingLifecycle" IN ('ACTIVE'));

ALTER TABLE "PartnerCardProgram" ADD CONSTRAINT "PartnerCardProgram_status_check" CHECK ("status" IN ('DRAFT','ACTIVE','RETIRED'));
ALTER TABLE "PartnerCardProgram" ADD CONSTRAINT "PartnerCardProgram_verification_check" CHECK ("verificationMethod" IN ('SELF_DECLARED','WORK_EMAIL_OTP','ISSUER_TOKEN','PARTNER_FEED'));
-- Only limited BIN / IIN prefixes (6 to 8 digits). A full card number (PAN) or a CVV can never be stored here.
ALTER TABLE "PartnerCardProgram" ADD CONSTRAINT "PartnerCardProgram_bin_prefix_check" CHECK (cardinality("binPrefixes") = 0 OR array_to_string("binPrefixes", ',') ~ '^[0-9]{6,8}(,[0-9]{6,8})*$');

ALTER TABLE "PartnerEmployerProgram" ADD CONSTRAINT "PartnerEmployerProgram_status_check" CHECK ("status" IN ('DRAFT','ACTIVE','RETIRED'));

ALTER TABLE "LiveDealPartnerBenefit" ADD CONSTRAINT "LiveDealPartnerBenefit_status_check" CHECK ("status" IN ('PROPOSED','MERCHANT_APPROVED','ACTIVE','REJECTED','WITHDRAWN','SUSPENDED','ENDED'));
ALTER TABLE "LiveDealPartnerBenefit" ADD CONSTRAINT "LiveDealPartnerBenefit_kind_check" CHECK ("kind" IN ('EXTRA_PERCENT','EXTRA_AMOUNT','FREE_ITEM','OTHER'));
ALTER TABLE "LiveDealPartnerBenefit" ADD CONSTRAINT "LiveDealPartnerBenefit_dates_check" CHECK ("endAt" IS NULL OR "startAt" IS NULL OR "endAt" > "startAt");

ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_partnerSuggestion_check" CHECK ("partnerSuggestion" IS NULL OR "partnerSuggestion" IN ('NOT_DUPLICATE','SUGGEST_MERGE'));