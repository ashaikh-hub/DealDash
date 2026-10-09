-- CreateEnum
CREATE TYPE "MasterRegistration" AS ENUM ('REFERENCED', 'REGISTERED');

-- DropIndex
DROP INDEX "OrganizationUnit_path_idx";

-- CreateTable
CREATE TABLE "MasterBrand" (
    "id" UUID NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "normalizedName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterBrand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterMerchant" (
    "id" UUID NOT NULL,
    "registration" "MasterRegistration" NOT NULL DEFAULT 'REFERENCED',
    "organizationId" UUID,
    "brandId" UUID,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "normalizedName" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'SA',
    "categoryCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterMerchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterBranch" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "addressEn" TEXT,
    "addressAr" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'SA',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "normalizedKey" TEXT NOT NULL,
    "merchantBranchId" UUID,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MasterBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferencedOffer" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "titleEn" TEXT NOT NULL,
    "titleAr" TEXT,
    "benefitEn" TEXT NOT NULL,
    "benefitAr" TEXT,
    "termsEn" TEXT,
    "termsAr" TEXT,
    "categoryCode" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'IN_STORE',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "branchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferencedOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalEntityReference" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceOrganizationId" UUID,
    "sourceRecordId" TEXT NOT NULL,
    "connectionId" UUID,
    "importJobId" UUID,
    "importMethod" TEXT NOT NULL,
    "sourceOwner" TEXT,
    "editableBy" TEXT NOT NULL DEFAULT 'SOURCE',
    "syncStatus" TEXT NOT NULL DEFAULT 'SYNCED',
    "overrideStatus" TEXT NOT NULL DEFAULT 'NONE',
    "publicationConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "publicationRef" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastSourceUpdateAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalEntityReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityAlias" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchCandidate" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "aId" UUID NOT NULL,
    "bId" UUID NOT NULL,
    "confidence" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataConflict" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "sourceValue" JSONB NOT NULL,
    "localValue" JSONB NOT NULL,
    "policy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedByUserId" UUID,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityOverride" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "kind" TEXT NOT NULL,
    "validUntil" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "EntityOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "kind" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "fileName" TEXT,
    "fileHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "totals" JSONB NOT NULL DEFAULT '{}',
    "createdByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "status" TEXT NOT NULL,
    "action" TEXT,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "matchedEntityId" UUID,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConnection" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "name" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'API_PUSH',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "apiVersion" TEXT NOT NULL DEFAULT '1',
    "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 120,
    "publicationAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "publicationRef" TEXT,
    "staleAfterMinutes" INTEGER NOT NULL DEFAULT 1440,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastSourceUpdateAt" TIMESTAMP(3),
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "idempotencyKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "received" INTEGER NOT NULL DEFAULT 0,
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "conflicts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "result" JSONB,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailedRecord" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "syncJobId" UUID,
    "recordType" TEXT,
    "sourceRecordId" TEXT,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,

    CONSTRAINT "FailedRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MasterBrand_normalizedName_idx" ON "MasterBrand"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "MasterMerchant_organizationId_key" ON "MasterMerchant"("organizationId");

-- CreateIndex
CREATE INDEX "MasterMerchant_normalizedName_country_idx" ON "MasterMerchant"("normalizedName", "country");

-- CreateIndex
CREATE INDEX "MasterMerchant_registration_idx" ON "MasterMerchant"("registration");

-- CreateIndex
CREATE UNIQUE INDEX "MasterBranch_merchantBranchId_key" ON "MasterBranch"("merchantBranchId");

-- CreateIndex
CREATE INDEX "MasterBranch_merchantId_idx" ON "MasterBranch"("merchantId");

-- CreateIndex
CREATE INDEX "MasterBranch_normalizedKey_idx" ON "MasterBranch"("normalizedKey");

-- CreateIndex
CREATE INDEX "ReferencedOffer_merchantId_status_idx" ON "ReferencedOffer"("merchantId", "status");

-- CreateIndex
CREATE INDEX "ReferencedOffer_validUntil_idx" ON "ReferencedOffer"("validUntil");

-- CreateIndex
CREATE INDEX "ExternalEntityReference_entityType_entityId_idx" ON "ExternalEntityReference"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ExternalEntityReference_sourceOrganizationId_idx" ON "ExternalEntityReference"("sourceOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalEntityReference_sourceSystem_entityType_sourceRecor_key" ON "ExternalEntityReference"("sourceSystem", "entityType", "sourceRecordId");

-- CreateIndex
CREATE INDEX "EntityAlias_entityType_normalizedAlias_idx" ON "EntityAlias"("entityType", "normalizedAlias");

-- CreateIndex
CREATE UNIQUE INDEX "EntityAlias_entityType_entityId_normalizedAlias_key" ON "EntityAlias"("entityType", "entityId", "normalizedAlias");

-- CreateIndex
CREATE INDEX "MatchCandidate_status_confidence_idx" ON "MatchCandidate"("status", "confidence");

-- CreateIndex
CREATE UNIQUE INDEX "MatchCandidate_entityType_aId_bId_key" ON "MatchCandidate"("entityType", "aId", "bId");

-- CreateIndex
CREATE INDEX "DataConflict_status_createdAt_idx" ON "DataConflict"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DataConflict_entityType_entityId_idx" ON "DataConflict"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "EntityOverride_entityType_entityId_field_idx" ON "EntityOverride"("entityType", "entityId", "field");

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_status_idx" ON "ImportJob"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportJob_organizationId_kind_fileHash_key" ON "ImportJob"("organizationId", "kind", "fileHash");

-- CreateIndex
CREATE INDEX "ImportRow_jobId_status_idx" ON "ImportRow"("jobId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_jobId_rowNumber_key" ON "ImportRow"("jobId", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConnection_keyPrefix_key" ON "IntegrationConnection"("keyPrefix");

-- CreateIndex
CREATE INDEX "IntegrationConnection_organizationId_status_idx" ON "IntegrationConnection"("organizationId", "status");

-- CreateIndex
CREATE INDEX "SyncJob_connectionId_startedAt_idx" ON "SyncJob"("connectionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SyncJob_connectionId_idempotencyKey_key" ON "SyncJob"("connectionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "FailedRecord_connectionId_status_idx" ON "FailedRecord"("connectionId", "status");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_connectionId_idx" ON "WebhookEndpoint"("connectionId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "MasterMerchant" ADD CONSTRAINT "MasterMerchant_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "MasterBrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasterBranch" ADD CONSTRAINT "MasterBranch_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MasterMerchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferencedOffer" ADD CONSTRAINT "ReferencedOffer_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MasterMerchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailedRecord" ADD CONSTRAINT "FailedRecord_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ================================================================ hand-written guarantees (Phase 2)
-- A registered merchant is linked to a DealDash organization; a referenced (network) merchant never is.
ALTER TABLE "MasterMerchant" ADD CONSTRAINT "MasterMerchant_registration_link" CHECK (("registration" = 'REGISTERED') = ("organizationId" IS NOT NULL));
ALTER TABLE "ReferencedOffer" ADD CONSTRAINT "ReferencedOffer_dates" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom");
ALTER TABLE "ReferencedOffer" ADD CONSTRAINT "ReferencedOffer_channel" CHECK ("channel" IN ('IN_STORE', 'ONLINE', 'BOTH'));
-- a duplicate pair is stored once, in canonical order
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_pair" CHECK ("aId" < "bId" AND "confidence" BETWEEN 0 AND 100 AND "status" IN ('PENDING', 'MERGED', 'REJECTED', 'ALIAS', 'LINKED'));
ALTER TABLE "ExternalEntityReference" ADD CONSTRAINT "ExternalEntityReference_values" CHECK (
  "entityType" IN ('MERCHANT', 'BRAND', 'BRANCH', 'OFFER')
  AND "importMethod" IN ('MANUAL', 'BULK', 'API', 'FEED')
  AND "editableBy" IN ('SOURCE', 'DEALDASH', 'MERCHANT')
  AND "overrideStatus" IN ('NONE', 'LOCAL', 'TEMPORARY', 'PERMANENT', 'PENDING_RECONCILIATION'));
ALTER TABLE "EntityOverride" ADD CONSTRAINT "EntityOverride_kind" CHECK ("kind" IN ('LOCAL', 'TEMPORARY', 'PERMANENT') AND ("kind" <> 'TEMPORARY' OR "validUntil" IS NOT NULL));
ALTER TABLE "DataConflict" ADD CONSTRAINT "DataConflict_status" CHECK ("status" IN ('OPEN', 'RESOLVED') AND "policy" IN ('SOURCE_WINS', 'DEALDASH_WINS', 'MERCHANT_WINS', 'MANUAL_REVIEW'));
ALTER TABLE "IntegrationConnection" ADD CONSTRAINT "IntegrationConnection_limits" CHECK ("rateLimitPerMinute" > 0 AND "staleAfterMinutes" > 0 AND "kind" IN ('API_PUSH', 'FEED_PULL', 'WEBHOOK') AND "status" IN ('ACTIVE', 'PAUSED', 'REVOKED'));
ALTER TABLE "FailedRecord" ADD CONSTRAINT "FailedRecord_status" CHECK ("status" IN ('OPEN', 'RETRIED', 'DISCARDED', 'RESOLVED'));
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_status" CHECK ("status" IN ('PENDING', 'DELIVERED', 'DEAD'));
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_status" CHECK ("status" IN ('UPLOADED', 'VALIDATED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED'));
-- the same file is not imported twice by the same business (NULL organizations count as one: DealDash Admin)
CREATE UNIQUE INDEX "ImportJob_admin_file" ON "ImportJob" ("kind", "fileHash") WHERE "organizationId" IS NULL;
ALTER TABLE "MasterMerchant" ADD COLUMN "mergedIntoId" UUID;
ALTER TABLE "ImportJob" ADD COLUMN "publicationRef" TEXT;
ALTER TABLE "MasterMerchant" ADD CONSTRAINT "MasterMerchant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
