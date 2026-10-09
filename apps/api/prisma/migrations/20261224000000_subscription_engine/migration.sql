-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "accountManager" TEXT,
ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "billingCadence" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "billingLegalEntityId" UUID,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "developmentFixture" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "enforcement" JSONB,
ADD COLUMN     "graceDays" INTEGER,
ADD COLUMN     "graceUntil" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CUSTOM_ENTERPRISE',
ADD COLUMN     "market" TEXT,
ADD COLUMN     "nextBillingAt" TIMESTAMP(3),
ADD COLUMN     "nextRenewalAt" TIMESTAMP(3),
ADD COLUMN     "pastDueSince" TIMESTAMP(3),
ADD COLUMN     "planVersionId" UUID,
ADD COLUMN     "pricingVersionKey" TEXT,
ADD COLUMN     "renewalState" TEXT NOT NULL DEFAULT 'MANUAL_RENEWAL',
ADD COLUMN     "supportLevel" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ContractEntitlement" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'HARD',
ADD COLUMN     "note" TEXT,
ADD COLUMN     "overageRateMinor" INTEGER,
ADD COLUMN     "period" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "softAction" TEXT NOT NULL DEFAULT 'WARN',
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'CONTRACT',
ADD COLUMN     "sourceRef" TEXT,
ADD COLUMN     "warnPercents" INTEGER[] DEFAULT ARRAY[80, 100]::INTEGER[];

-- CreateTable
CREATE TABLE "CommercialPlan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "descriptionEn" TEXT,
    "descriptionAr" TEXT,
    "entityType" TEXT NOT NULL,
    "contractKind" TEXT NOT NULL,
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "negotiated" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialPlanVersion" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "defaultCadence" TEXT NOT NULL DEFAULT 'MONTHLY',
    "prices" JSONB NOT NULL DEFAULT '[]',
    "fees" JSONB NOT NULL DEFAULT '[]',
    "addOnPrices" JSONB NOT NULL DEFAULT '{}',
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "addOnCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportLevel" TEXT,
    "trialDays" INTEGER,
    "graceDays" INTEGER,
    "enforcement" JSONB,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "referencePricing" JSONB NOT NULL DEFAULT '{}',
    "developmentFixture" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID,
    "publishedByUserId" UUID,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceItem" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'EACH',
    "product" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceItemVersion" (
    "id" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "amountMinor" INTEGER,
    "rateBps" INTEGER,
    "tiers" JSONB,
    "minAmountMinor" INTEGER,
    "maxAmountMinor" INTEGER,
    "indicative" BOOLEAN NOT NULL DEFAULT false,
    "rangeMin" INTEGER,
    "rangeMax" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "reference" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceItemVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddOnDefinition" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "effect" JSONB NOT NULL,
    "priceItemCode" TEXT,
    "eligiblePlanCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddOnDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractLegalEntity" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'COVERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractLegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractAmendment" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "fromVersion" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "effectiveMode" TEXT NOT NULL DEFAULT 'IMMEDIATE',
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "targetPlanVersionId" UUID,
    "change" JSONB NOT NULL,
    "fromSnapshot" JSONB NOT NULL,
    "toSnapshot" JSONB NOT NULL,
    "impact" JSONB NOT NULL,
    "reason" TEXT,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "requestedByUserId" UUID NOT NULL,
    "requestedByOrg" BOOLEAN NOT NULL DEFAULT false,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "acceptanceId" UUID,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractAcceptance" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "contractId" UUID NOT NULL,
    "amendmentId" UUID,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID,
    "userId" UUID NOT NULL,
    "userRole" TEXT,
    "userName" TEXT,
    "onBehalfAuthorizationId" UUID,
    "planVersionId" UUID,
    "pricingVersionKey" TEXT,
    "termsVersion" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "acceptedAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "maxExposureMinor" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "billingCadence" TEXT NOT NULL,
    "approvalRef" TEXT,
    "terms" JSONB NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "ContractAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractAddOn" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "cadence" TEXT NOT NULL DEFAULT 'MONTHLY',
    "pricingVersionKey" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "approvedByUserId" UUID,
    "acceptanceId" UUID,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractTrial" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "trialPlanVersionId" UUID NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "entitlementSnapshot" JSONB NOT NULL,
    "priceMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "postTrialPlanCode" TEXT,
    "promotionId" UUID,
    "approvedByUserId" UUID,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractTrial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractPromotion" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "originalPriceMinor" INTEGER,
    "promoPriceMinor" INTEGER,
    "discountBps" INTEGER,
    "waived" BOOLEAN NOT NULL DEFAULT false,
    "creditMinor" INTEGER,
    "currency" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "postPromotion" TEXT NOT NULL DEFAULT 'REVERT_TO_STANDARD',
    "postPlanCode" TEXT,
    "approvedByUserId" UUID,
    "approvalRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractRate" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "itemCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "amountMinor" INTEGER,
    "rateBps" INTEGER,
    "discountBps" INTEGER,
    "waived" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "approvalRef" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMeter" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityKey" TEXT NOT NULL DEFAULT '',
    "metricKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMeter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID,
    "contractId" UUID,
    "metricKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "product" TEXT,
    "feature" TEXT,
    "market" TEXT,
    "campaignId" UUID,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "pricingVersionKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialBillingEvent" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "businessAccountId" UUID,
    "legalEntityId" UUID,
    "billingLegalEntityId" UUID,
    "contractId" UUID,
    "planCode" TEXT,
    "planVersionId" UUID,
    "product" TEXT,
    "feature" TEXT,
    "campaignId" UUID,
    "sourceEventId" TEXT,
    "pricingVersionKey" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'EACH',
    "unitRateMinor" INTEGER,
    "amountMinor" INTEGER,
    "currency" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billingCategory" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "consumedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommercialBillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialSignal" (
    "id" UUID NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "organizationId" UUID NOT NULL,
    "legalEntityId" UUID,
    "contractId" UUID,
    "metricKey" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "CommercialSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommercialPlan_code_key" ON "CommercialPlan"("code");

-- CreateIndex
CREATE INDEX "CommercialPlan_entityType_status_idx" ON "CommercialPlan"("entityType", "status");

-- CreateIndex
CREATE INDEX "CommercialPlanVersion_planId_market_status_idx" ON "CommercialPlanVersion"("planId", "market", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialPlanVersion_planId_market_version_key" ON "CommercialPlanVersion"("planId", "market", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PriceItem_code_key" ON "PriceItem"("code");

-- CreateIndex
CREATE INDEX "PriceItemVersion_itemId_market_status_idx" ON "PriceItemVersion"("itemId", "market", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PriceItemVersion_itemId_market_version_key" ON "PriceItemVersion"("itemId", "market", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AddOnDefinition_code_key" ON "AddOnDefinition"("code");

-- CreateIndex
CREATE INDEX "ContractLegalEntity_legalEntityId_idx" ON "ContractLegalEntity"("legalEntityId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractLegalEntity_contractId_legalEntityId_role_key" ON "ContractLegalEntity"("contractId", "legalEntityId", "role");

-- CreateIndex
CREATE INDEX "ContractAmendment_contractId_status_idx" ON "ContractAmendment"("contractId", "status");

-- CreateIndex
CREATE INDEX "ContractAmendment_status_effectiveAt_idx" ON "ContractAmendment"("status", "effectiveAt");

-- CreateIndex
CREATE INDEX "ContractAmendment_organizationId_idx" ON "ContractAmendment"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractAcceptance_reference_key" ON "ContractAcceptance"("reference");

-- CreateIndex
CREATE INDEX "ContractAcceptance_contractId_createdAt_idx" ON "ContractAcceptance"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "ContractAcceptance_organizationId_idx" ON "ContractAcceptance"("organizationId");

-- CreateIndex
CREATE INDEX "ContractAddOn_contractId_status_idx" ON "ContractAddOn"("contractId", "status");

-- CreateIndex
CREATE INDEX "ContractTrial_contractId_status_idx" ON "ContractTrial"("contractId", "status");

-- CreateIndex
CREATE INDEX "ContractTrial_status_endAt_idx" ON "ContractTrial"("status", "endAt");

-- CreateIndex
CREATE INDEX "ContractPromotion_contractId_status_idx" ON "ContractPromotion"("contractId", "status");

-- CreateIndex
CREATE INDEX "ContractPromotion_status_endAt_idx" ON "ContractPromotion"("status", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContractRate_contractId_itemCode_version_key" ON "ContractRate"("contractId", "itemCode", "version");

-- CreateIndex
CREATE INDEX "UsageMeter_organizationId_metricKey_idx" ON "UsageMeter"("organizationId", "metricKey");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMeter_organizationId_legalEntityKey_metricKey_periodSt_key" ON "UsageMeter"("organizationId", "legalEntityKey", "metricKey", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEvent_idempotencyKey_key" ON "UsageEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UsageEvent_organizationId_metricKey_occurredAt_idx" ON "UsageEvent"("organizationId", "metricKey", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialBillingEvent_idempotencyKey_key" ON "CommercialBillingEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CommercialBillingEvent_organizationId_occurredAt_idx" ON "CommercialBillingEvent"("organizationId", "occurredAt");

-- CreateIndex
CREATE INDEX "CommercialBillingEvent_status_eventType_idx" ON "CommercialBillingEvent"("status", "eventType");

-- CreateIndex
CREATE INDEX "CommercialBillingEvent_contractId_idx" ON "CommercialBillingEvent"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialSignal_dedupeKey_key" ON "CommercialSignal"("dedupeKey");

-- CreateIndex
CREATE INDEX "CommercialSignal_organizationId_createdAt_idx" ON "CommercialSignal"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CommercialSignal_consumedAt_type_idx" ON "CommercialSignal"("consumedAt", "type");

-- CreateIndex
CREATE INDEX "Contract_status_graceUntil_idx" ON "Contract"("status", "graceUntil");

-- CreateIndex
CREATE INDEX "Contract_planVersionId_idx" ON "Contract"("planVersionId");

-- CreateIndex
CREATE INDEX "ContractEntitlement_contractId_source_idx" ON "ContractEntitlement"("contractId", "source");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "CommercialPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialPlanVersion" ADD CONSTRAINT "CommercialPlanVersion_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CommercialPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceItemVersion" ADD CONSTRAINT "PriceItemVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PriceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractLegalEntity" ADD CONSTRAINT "ContractLegalEntity_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractAmendment" ADD CONSTRAINT "ContractAmendment_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractAcceptance" ADD CONSTRAINT "ContractAcceptance_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractAddOn" ADD CONSTRAINT "ContractAddOn_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractTrial" ADD CONSTRAINT "ContractTrial_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractPromotion" ADD CONSTRAINT "ContractPromotion_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractRate" ADD CONSTRAINT "ContractRate_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The campaign keeps the contract and billing trigger that governed it.
ALTER TABLE "CommercialCase" ADD COLUMN     "billingModel" TEXT,
ADD COLUMN     "billingTrigger" TEXT,
ADD COLUMN     "contractId" UUID;
CREATE INDEX "CommercialCase_contractId_idx" ON "CommercialCase"("contractId");

-- ============================================================================================================
-- Data: the old two-state contract status becomes the commercial lifecycle (ENDED -> SUPERSEDED when a successor starts exactly then, else CANCELLED).
-- No contract or entitlement row is deleted or changed otherwise.
-- ============================================================================================================
UPDATE "Contract" c SET "status" = 'SUPERSEDED'
 WHERE c."status" = 'ENDED' AND EXISTS (
   SELECT 1 FROM "Contract" n WHERE n."organizationId" = c."organizationId" AND n."id" <> c."id"
     AND n."legalEntityId" IS NOT DISTINCT FROM c."legalEntityId" AND n."effectiveFrom" = c."effectiveUntil");
UPDATE "Contract" SET "status" = 'CANCELLED', "cancelledAt" = "effectiveUntil" WHERE "status" = 'ENDED';
UPDATE "Contract" SET "activatedAt" = "effectiveFrom" WHERE "status" IN ('ACTIVE', 'CANCELLED', 'SUPERSEDED', 'EXPIRED') AND "activatedAt" IS NULL;

-- ============================================================================================================
-- Integrity
-- ============================================================================================================
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_lifecycle" CHECK ("status" IN ('DRAFT', 'PENDING_ACTIVATION', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED'));
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_kind" CHECK ("kind" IN ('MERCHANT_SUBSCRIPTION', 'MERCHANT_ENTERPRISE', 'BANK_ENTERPRISE', 'SCHEME_NETWORK_LICENCE', 'CORPORATE_PARTNER', 'CUSTOM_ENTERPRISE'));
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_renewal" CHECK ("renewalState" IN ('AUTO_RENEW', 'MANUAL_RENEWAL', 'NON_RENEWING', 'RENEWAL_PENDING'));
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_cadence" CHECK ("billingCadence" IN ('NONE', 'MONTHLY', 'ANNUAL', 'MULTI_YEAR', 'MANUAL', 'CUSTOM'));
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_version" CHECK ("version" >= 1 AND ("graceDays" IS NULL OR "graceDays" >= 0));
ALTER TABLE "ContractEntitlement" ADD CONSTRAINT "ContractEntitlement_values" CHECK (
  "source" IN ('CONTRACT', 'PLAN', 'OVERRIDE', 'ADDON') AND "mode" IN ('HARD', 'SOFT')
  AND "period" IN ('NONE', 'DAY', 'MONTH', 'YEAR', 'CONTRACT_TERM') AND "softAction" IN ('WARN', 'OVERAGE_CHARGE', 'REQUIRE_APPROVAL')
  AND ("limitValue" IS NULL OR "limitValue" >= 0) AND ("overageRateMinor" IS NULL OR "overageRateMinor" >= 0));
ALTER TABLE "CommercialPlan" ADD CONSTRAINT "CommercialPlan_values" CHECK ("status" IN ('ACTIVE', 'RETIRED') AND "entityType" IN ('MERCHANT', 'BANK', 'SCHEME', 'CORPORATE', 'PARTNER'));
ALTER TABLE "CommercialPlanVersion" ADD CONSTRAINT "CommercialPlanVersion_values" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED') AND "version" >= 1 AND ("trialDays" IS NULL OR "trialDays" >= 0) AND ("graceDays" IS NULL OR "graceDays" >= 0));
ALTER TABLE "PriceItem" ADD CONSTRAINT "PriceItem_values" CHECK ("status" IN ('ACTIVE', 'INACTIVE'));
ALTER TABLE "PriceItemVersion" ADD CONSTRAINT "PriceItemVersion_values" CHECK (
  "status" IN ('DRAFT', 'PUBLISHED', 'RETIRED') AND "model" IN ('FIXED', 'PER_UNIT', 'PERCENT_BPS', 'TIERED') AND "version" >= 1
  AND ("amountMinor" IS NULL OR "amountMinor" >= 0) AND ("rateBps" IS NULL OR ("rateBps" >= 0 AND "rateBps" <= 10000))
  AND ("model" <> 'PERCENT_BPS' OR "rateBps" IS NOT NULL OR "indicative"));
ALTER TABLE "AddOnDefinition" ADD CONSTRAINT "AddOnDefinition_values" CHECK ("status" IN ('ACTIVE', 'RETIRED'));
ALTER TABLE "ContractLegalEntity" ADD CONSTRAINT "ContractLegalEntity_role" CHECK ("role" IN ('CONTRACTING', 'COVERED', 'BILLING'));
ALTER TABLE "ContractAmendment" ADD CONSTRAINT "ContractAmendment_values" CHECK (
  "type" IN ('UPGRADE', 'DOWNGRADE', 'ADD_ON', 'RENEWAL', 'PRICING', 'ENTITLEMENT', 'MARKET_ADDITION', 'EXTENSION')
  AND "status" IN ('PROPOSED', 'ACCEPTED', 'APPLIED', 'REJECTED', 'CANCELLED')
  AND "effectiveMode" IN ('IMMEDIATE', 'NEXT_BILLING_CYCLE', 'CUSTOM_EFFECTIVE_DATE') AND "fromVersion" >= 1);
ALTER TABLE "ContractAcceptance" ADD CONSTRAINT "ContractAcceptance_amounts" CHECK ("acceptedAmountMinor" >= 0 AND "maxExposureMinor" >= 0);
ALTER TABLE "ContractAddOn" ADD CONSTRAINT "ContractAddOn_values" CHECK ("status" IN ('PROPOSED', 'ACTIVE', 'ENDED', 'CANCELLED') AND "quantity" >= 1 AND "priceMinor" >= 0);
ALTER TABLE "ContractTrial" ADD CONSTRAINT "ContractTrial_values" CHECK ("status" IN ('ACTIVE', 'CONVERTED', 'EXPIRED', 'CANCELLED') AND "endAt" > "startAt");
ALTER TABLE "ContractPromotion" ADD CONSTRAINT "ContractPromotion_values" CHECK (
  "kind" IN ('FREE_ONBOARDING', 'PROMOTIONAL_PRICE', 'SETUP_WAIVER', 'CAMPAIGN_CREDIT', 'TEMPORARY_UPGRADE', 'ENTERPRISE_TRIAL')
  AND "status" IN ('ACTIVE', 'ENDED', 'CANCELLED') AND "endAt" > "startAt" AND "postPromotion" IN ('REVERT_TO_STANDARD', 'CONVERT_TO_PLAN', 'END')
  AND ("discountBps" IS NULL OR ("discountBps" >= 0 AND "discountBps" <= 10000)));
ALTER TABLE "ContractRate" ADD CONSTRAINT "ContractRate_values" CHECK ("model" IN ('FIXED', 'PER_UNIT', 'PERCENT_BPS', 'TIERED') AND ("discountBps" IS NULL OR ("discountBps" >= 0 AND "discountBps" <= 10000)));
ALTER TABLE "UsageMeter" ADD CONSTRAINT "UsageMeter_value" CHECK ("value" >= 0 AND "periodEnd" > "periodStart");
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_quantity" CHECK ("quantity" >= 0);
ALTER TABLE "CommercialBillingEvent" ADD CONSTRAINT "CommercialBillingEvent_values" CHECK (
  "billingCategory" IN ('SUBSCRIPTION_LICENCE', 'SETUP_INTEGRATION', 'PRODUCT_USAGE', 'TRANSACTION_COMMISSION', 'CAMPAIGN_ADVERTISING', 'PREMIUM_SERVICE')
  AND "status" IN ('PENDING', 'CONSUMED', 'VOID') AND "quantity" >= 0 AND ("amountMinor" IS NULL OR "amountMinor" >= 0) AND ("unitRateMinor" IS NULL OR "unitRateMinor" >= 0));

-- Acceptances and usage facts are immutable evidence.
CREATE TRIGGER "ContractAcceptance_append_only" BEFORE UPDATE OR DELETE ON "ContractAcceptance" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();
CREATE TRIGGER "UsageEvent_append_only" BEFORE UPDATE OR DELETE ON "UsageEvent" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();

-- A published plan version / price version is never edited: a change is a new version. Only retiring it (status, end date) is allowed.
CREATE OR REPLACE FUNCTION dd_published_version_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'DRAFT' THEN RETURN OLD; END IF;
    RAISE EXCEPTION '% is published and cannot be deleted', TG_TABLE_NAME USING ERRCODE = '23000';
  END IF;
  IF OLD."status" IN ('PUBLISHED', 'RETIRED') THEN
    IF to_jsonb(NEW) - 'status' - 'effectiveUntil' - 'publishedAt' - 'publishedByUserId' IS DISTINCT FROM to_jsonb(OLD) - 'status' - 'effectiveUntil' - 'publishedAt' - 'publishedByUserId' THEN
      RAISE EXCEPTION '% is published: create a new version instead of editing it', TG_TABLE_NAME USING ERRCODE = '23000';
    END IF;
    IF OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED' THEN
      RAISE EXCEPTION '% is retired', TG_TABLE_NAME USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "CommercialPlanVersion_frozen" BEFORE UPDATE OR DELETE ON "CommercialPlanVersion" FOR EACH ROW EXECUTE FUNCTION dd_published_version_frozen();
CREATE TRIGGER "PriceItemVersion_frozen" BEFORE UPDATE OR DELETE ON "PriceItemVersion" FOR EACH ROW EXECUTE FUNCTION dd_published_version_frozen();

-- A billing event is financial evidence: only Phase 5 may move its processing state (status, consumedAt); nothing else changes, nothing is deleted.
CREATE OR REPLACE FUNCTION dd_billing_event_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'CommercialBillingEvent is append-only' USING ERRCODE = '23000'; END IF;
  IF to_jsonb(NEW) - 'status' - 'consumedAt' IS DISTINCT FROM to_jsonb(OLD) - 'status' - 'consumedAt' THEN
    RAISE EXCEPTION 'CommercialBillingEvent is append-only (only its processing state may change)' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "CommercialBillingEvent_guard" BEFORE UPDATE OR DELETE ON "CommercialBillingEvent" FOR EACH ROW EXECUTE FUNCTION dd_billing_event_guard();