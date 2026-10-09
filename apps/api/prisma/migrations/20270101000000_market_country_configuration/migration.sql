-- AlterTable
ALTER TABLE "CommercialBillingEvent" ADD COLUMN     "market" TEXT;

-- AlterTable
ALTER TABLE "CommercialCase" ADD COLUMN     "market" TEXT;

-- AlterTable
ALTER TABLE "CountryConfiguration" ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedByUserId" UUID,
ADD COLUMN     "billingCurrency" TEXT,
ADD COLUMN     "callingCode" TEXT,
ADD COLUMN     "createdByUserId" UUID,
ADD COLUMN     "currencyDecimals" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "dealdashLegalEntityId" UUID,
ADD COLUMN     "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "formatting" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "isoAlpha3" TEXT,
ADD COLUMN     "launchDate" TIMESTAMP(3),
ADD COLUMN     "pendingReason" TEXT,
ADD COLUMN     "pendingRequestedAt" TIMESTAMP(3),
ADD COLUMN     "pendingRequestedByUserId" UUID,
ADD COLUMN     "pendingStatus" TEXT,
ADD COLUMN     "regionCode" TEXT,
ADD COLUMN     "roundingRule" TEXT NOT NULL DEFAULT 'HALF_UP',
ADD COLUMN     "settlementCurrency" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PLANNED',
ADD COLUMN     "supportContact" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "supportedCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "taxCurrency" TEXT,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "FinanceDocument" ADD COLUMN     "invoiceConfigId" UUID,
ADD COLUMN     "market" TEXT;

-- AlterTable
ALTER TABLE "FxRate" ADD COLUMN     "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overrideReason" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "taxRuleId" UUID,
ADD COLUMN     "taxRuleVersion" INTEGER,
ADD COLUMN     "taxableItem" TEXT;

-- CreateTable
CREATE TABLE "MarketRegion" (
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketRegion_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "MarketProduct" (
    "id" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISABLED',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "legalEntityId" UUID,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "taxType" TEXT NOT NULL,
    "rateBps" INTEGER NOT NULL,
    "inclusive" BOOLEAN NOT NULL DEFAULT false,
    "applicability" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "exemptionReason" TEXT,
    "registrationRef" TEXT,
    "roundingRule" TEXT NOT NULL DEFAULT 'HALF_UP',
    "taxCurrency" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "validationCode" TEXT,
    "notes" TEXT,
    "createdByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceConfig" (
    "id" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "legalEntityId" UUID,
    "documentKind" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "prefix" TEXT NOT NULL,
    "sequenceKey" TEXT NOT NULL,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qrRequired" BOOLEAN NOT NULL DEFAULT false,
    "eInvoiceProvider" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'VALIDATION_REQUIRED',
    "validationCode" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementRule" (
    "id" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "legalEntityId" UUID,
    "product" TEXT,
    "organizationId" UUID,
    "contractId" UUID,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "cycleDays" INTEGER NOT NULL DEFAULT 0,
    "minimumMinor" INTEGER NOT NULL DEFAULT 0,
    "destinationRef" TEXT,
    "payableTreatment" TEXT NOT NULL DEFAULT 'NET_OF_FEES',
    "sponsorTreatment" TEXT NOT NULL DEFAULT 'SEPARATE_LINE',
    "feeBps" INTEGER,
    "reconciliationMethod" TEXT NOT NULL DEFAULT 'STATEMENT_MATCH',
    "holdDays" INTEGER NOT NULL DEFAULT 0,
    "disputeTreatment" TEXT NOT NULL DEFAULT 'HOLD_DISPUTED_AMOUNT',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "validationCode" TEXT,
    "createdByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketProvider" (
    "id" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "method" TEXT,
    "currency" TEXT,
    "merchantAccountRef" TEXT,
    "refundSupported" BOOLEAN,
    "credentialRef" TEXT,
    "webhookRef" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'MOCK',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'CONFIGURING',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketPolicy" (
    "id" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "product" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "value" JSONB NOT NULL DEFAULT '{}',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "validationCode" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" UUID NOT NULL,
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketValidationItem" (
    "id" UUID NOT NULL,
    "market" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "product" TEXT,
    "ownerUserId" UUID,
    "ownerTeam" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "blocksActivation" BOOLEAN NOT NULL DEFAULT true,
    "evidenceRef" TEXT,
    "decision" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "reviewDate" TIMESTAMP(3),
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMP(3),
    "sourceRef" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketValidationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketProduct_market_product_key" ON "MarketProduct"("market", "product");

-- CreateIndex
CREATE INDEX "TaxRule_market_status_effectiveFrom_idx" ON "TaxRule"("market", "status", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRule_market_code_version_key" ON "TaxRule"("market", "code", "version");

-- CreateIndex
CREATE INDEX "InvoiceConfig_market_documentKind_status_idx" ON "InvoiceConfig"("market", "documentKind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceConfig_market_documentKind_legalEntityId_version_key" ON "InvoiceConfig"("market", "documentKind", "legalEntityId", "version");

-- CreateIndex
CREATE INDEX "SettlementRule_market_status_idx" ON "SettlementRule"("market", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementRule_market_code_version_key" ON "SettlementRule"("market", "code", "version");

-- CreateIndex
CREATE INDEX "MarketProvider_market_capability_status_idx" ON "MarketProvider"("market", "capability", "status");

-- CreateIndex
CREATE INDEX "MarketPolicy_market_category_status_idx" ON "MarketPolicy"("market", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketPolicy_market_category_key_product_version_key" ON "MarketPolicy"("market", "category", "key", "product", "version");

-- CreateIndex
CREATE INDEX "MarketValidationItem_market_status_idx" ON "MarketValidationItem"("market", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketValidationItem_market_code_key" ON "MarketValidationItem"("market", "code");

-- CreateIndex
CREATE INDEX "CountryConfiguration_regionCode_idx" ON "CountryConfiguration"("regionCode");

-- CreateIndex
CREATE INDEX "CountryConfiguration_status_idx" ON "CountryConfiguration"("status");


-- ======================================================================================================================
-- Hand-written: Market / country configuration hardening (extends CountryConfiguration; no parallel framework).
-- ======================================================================================================================

-- Regions group markets for reporting and administration only (never a tax or regulatory authority).
INSERT INTO "MarketRegion" ("code", "nameEn", "nameAr", "sortOrder") VALUES
  ('GCC', 'Gulf Cooperation Council', 'دول مجلس التعاون الخليجي', 10),
  ('SOUTH_ASIA', 'South Asia', 'جنوب آسيا', 20)
ON CONFLICT ("code") DO NOTHING;

-- Existing markets: the enabled pilot market becomes PILOT (validation items are still open); the others are PLANNED. Facts that are
-- not statutory (ISO codes, calling codes, time zones, region grouping) are filled in; nothing tax- or law-related is assumed.
UPDATE "CountryConfiguration" SET
  "status" = CASE WHEN "enabled" THEN 'PILOT' ELSE 'PLANNED' END,
  "supportedCurrencies" = ARRAY["currency"],
  "defaultLanguage" = COALESCE("languages"[1], 'en'),
  "regionCode" = CASE WHEN "code" IN ('SA', 'AE', 'QA', 'BH', 'KW', 'OM') THEN 'GCC' WHEN "code" IN ('PK') THEN 'SOUTH_ASIA' ELSE NULL END,
  "isoAlpha3" = CASE "code" WHEN 'SA' THEN 'SAU' WHEN 'AE' THEN 'ARE' WHEN 'QA' THEN 'QAT' WHEN 'PK' THEN 'PAK' ELSE NULL END,
  "callingCode" = CASE "code" WHEN 'SA' THEN '+966' WHEN 'AE' THEN '+971' WHEN 'QA' THEN '+974' WHEN 'PK' THEN '+92' ELSE NULL END,
  "timezone" = CASE "code" WHEN 'SA' THEN 'Asia/Riyadh' WHEN 'AE' THEN 'Asia/Dubai' WHEN 'QA' THEN 'Asia/Qatar' WHEN 'PK' THEN 'Asia/Karachi' ELSE 'UTC' END,
  "formatting" = '{"numerals": "WESTERN", "dateFormat": "dd MMM yyyy", "timeFormat": "HH:mm"}'::jsonb,
  "launchDate" = CASE WHEN "enabled" THEN "createdAt" ELSE NULL END,
  "effectiveFrom" = "createdAt";

-- Product availability: everything that runs today in the pilot market stays available (PILOT); other markets start DISABLED.
INSERT INTO "MarketProduct" ("id", "market", "product", "status", "updatedAt")
SELECT gen_random_uuid(), c."code", p.product, CASE WHEN c."enabled" THEN 'PILOT' ELSE 'DISABLED' END, CURRENT_TIMESTAMP
FROM "CountryConfiguration" c
CROSS JOIN unnest(ARRAY['LIVE_DEAL', 'MEMBER_BENEFIT', 'EXCLUSIVE', 'VOUCHER', 'WATCH', 'LOYALTY', 'SPONSORED_CAMPAIGNS', 'PUSH_CAMPAIGNS',
  'FEATURED_PLACEMENT', 'HOMEPAGE_PLACEMENT', 'CATEGORY_SPONSORSHIP', 'MERCHANT_SUBSCRIPTION', 'ENTERPRISE_LICENCE', 'AI_ASSISTANT']) AS p(product)
ON CONFLICT ("market", "product") DO NOTHING;

-- Campaign market: back-filled from the owner's first legal entity (campaigns without one keep NULL and resolve at runtime).
UPDATE "CommercialCase" cc SET "market" = le."country"
FROM (SELECT DISTINCT ON ("organizationId") "organizationId", "country" FROM "LegalEntity" ORDER BY "organizationId", "createdAt") le
WHERE cc."ownerOrganizationId" = le."organizationId" AND cc."market" IS NULL;

-- ---------------------------------------------------------------- vocabulary checks
ALTER TABLE "CountryConfiguration" ADD CONSTRAINT "CountryConfiguration_market_values" CHECK (
  "code" ~ '^[A-Z]{2}$' AND "status" IN ('PLANNED', 'CONFIGURING', 'TESTING', 'PILOT', 'ACTIVE', 'SUSPENDED', 'CLOSED')
  AND "roundingRule" IN ('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP') AND "currencyDecimals" BETWEEN 0 AND 4
  AND "approvalStatus" IN ('APPROVED', 'PENDING')
  AND ("pendingStatus" IS NULL OR "pendingStatus" IN ('PLANNED', 'CONFIGURING', 'TESTING', 'PILOT', 'ACTIVE', 'SUSPENDED', 'CLOSED'))
  AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"));
ALTER TABLE "MarketProduct" ADD CONSTRAINT "MarketProduct_values" CHECK (
  "status" IN ('DISABLED', 'CONFIGURING', 'TESTING', 'PILOT', 'ACTIVE', 'SUSPENDED') AND length("product") > 0);
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_values" CHECK (
  "rateBps" BETWEEN 0 AND 10000 AND "status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RETIRED')
  AND "taxType" IN ('VAT', 'GST', 'SALES_TAX', 'WITHHOLDING', 'DIGITAL_SERVICES', 'OTHER')
  AND "roundingRule" IN ('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP') AND ("exempt" = false OR "rateBps" = 0)
  AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom") AND cardinality("applicability") > 0);
ALTER TABLE "InvoiceConfig" ADD CONSTRAINT "InvoiceConfig_values" CHECK (
  "documentKind" IN ('TAX_INVOICE', 'INVOICE', 'COMMERCIAL_INVOICE', 'PROFORMA_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE')
  AND "validationStatus" IN ('CONFIGURED', 'VALIDATION_REQUIRED', 'VALIDATED') AND "status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RETIRED')
  AND "prefix" ~ '^[A-Z0-9][A-Z0-9-]{0,15}$' AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"));
CREATE UNIQUE INDEX "InvoiceConfig_market_kind_version_no_entity" ON "InvoiceConfig" ("market", "documentKind", "version") WHERE "legalEntityId" IS NULL;
ALTER TABLE "SettlementRule" ADD CONSTRAINT "SettlementRule_values" CHECK (
  "frequency" IN ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'ON_DEMAND') AND "status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RETIRED')
  AND "reconciliationMethod" IN ('STATEMENT_MATCH', 'PER_TRANSACTION', 'BATCH_TOTAL')
  AND "minimumMinor" >= 0 AND "holdDays" >= 0 AND "cycleDays" >= 0 AND ("feeBps" IS NULL OR "feeBps" BETWEEN 0 AND 10000)
  AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"));
-- secrets never live in configuration rows: credential / webhook fields hold references only
ALTER TABLE "MarketProvider" ADD CONSTRAINT "MarketProvider_values" CHECK (
  "capability" IN ('PAYMENT', 'SMS_OTP', 'EMAIL', 'PUSH', 'VIDEO', 'STORAGE_CDN', 'MAPS', 'E_INVOICING', 'KYB', 'IDENTITY', 'ANALYTICS')
  AND "environment" IN ('MOCK', 'SANDBOX', 'PRODUCTION') AND "status" IN ('DISABLED', 'CONFIGURING', 'TESTING', 'ACTIVE', 'SUSPENDED')
  AND ("method" IS NULL OR "method" IN ('CARD', 'WALLET', 'BANK_TRANSFER', 'LOCAL_METHOD'))
  AND ("credentialRef" IS NULL OR "credentialRef" ~ '^(env|secret):[A-Za-z0-9_./-]{2,120}$')
  AND ("webhookRef" IS NULL OR "webhookRef" ~ '^(env|secret):[A-Za-z0-9_./-]{2,120}$')
  AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"));
ALTER TABLE "MarketPolicy" ADD CONSTRAINT "MarketPolicy_values" CHECK (
  "category" IN ('REFUND_EXPIRY', 'KYB', 'PRIVACY_CONSENT', 'LEGAL_TERMS', 'SUPPORT', 'RESTRICTION')
  AND "status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RETIRED') AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"));
ALTER TABLE "MarketValidationItem" ADD CONSTRAINT "MarketValidationItem_values" CHECK (
  "status" IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'ACCEPTED_RISK', 'NOT_APPLICABLE') AND length("code") > 0);

-- ---------------------------------------------------------------- approved configuration is never rewritten
-- An APPROVED (or RETIRED) tax rule, invoice configuration, settlement rule or policy may only be closed (effectiveTo set) or
-- retired; any other change is a new version. Only drafts can be deleted.
CREATE OR REPLACE FUNCTION dd_market_config_guard() RETURNS trigger AS $$
DECLARE mutable text[] := ARRAY['effectiveTo', 'status'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" IN ('DRAFT', 'PENDING_APPROVAL') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Approved market configuration cannot be deleted (MARKET_CONFIG_IMMUTABLE)' USING ERRCODE = '23000';
  END IF;
  IF OLD."status" IN ('APPROVED', 'RETIRED') THEN
    IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
      RAISE EXCEPTION 'Approved market configuration is versioned, not edited (MARKET_CONFIG_IMMUTABLE)' USING ERRCODE = '23000';
    END IF;
    IF NEW."status" NOT IN ('APPROVED', 'RETIRED') OR (OLD."status" = 'RETIRED' AND NEW."status" <> 'RETIRED') THEN
      RAISE EXCEPTION 'Approved market configuration can only be retired (MARKET_CONFIG_IMMUTABLE)' USING ERRCODE = '23000';
    END IF;
    IF OLD."effectiveTo" IS NOT NULL AND (NEW."effectiveTo" IS NULL OR NEW."effectiveTo" > OLD."effectiveTo") THEN
      RAISE EXCEPTION 'A closed configuration period cannot be reopened (MARKET_CONFIG_IMMUTABLE)' USING ERRCODE = '23000';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "TaxRule_guard" BEFORE UPDATE OR DELETE ON "TaxRule" FOR EACH ROW EXECUTE FUNCTION dd_market_config_guard();
CREATE TRIGGER "InvoiceConfig_guard" BEFORE UPDATE OR DELETE ON "InvoiceConfig" FOR EACH ROW EXECUTE FUNCTION dd_market_config_guard();
CREATE TRIGGER "SettlementRule_guard" BEFORE UPDATE OR DELETE ON "SettlementRule" FOR EACH ROW EXECUTE FUNCTION dd_market_config_guard();
CREATE TRIGGER "MarketPolicy_guard" BEFORE UPDATE OR DELETE ON "MarketPolicy" FOR EACH ROW EXECUTE FUNCTION dd_market_config_guard();
-- markets and validation items are never deleted (history is kept; a market is CLOSED, an item resolved / not applicable)
CREATE TRIGGER "MarketValidationItem_no_delete" BEFORE DELETE ON "MarketValidationItem" FOR EACH ROW EXECUTE FUNCTION dd_block_mutation();

-- ---------------------------------------------------------------- issued documents also freeze the market and invoice configuration
CREATE OR REPLACE FUNCTION dd_finance_document_guard() RETURNS trigger AS $$
DECLARE frozen text[] := ARRAY['number', 'type', 'businessAccountId', 'organizationId', 'caseId', 'relatedDocumentId', 'currency',
  'subtotalHalalas', 'taxHalalas', 'totalHalalas', 'lines', 'issuedAt', 'dueAt', 'legalEntityId', 'contractId', 'periodStart',
  'periodEnd', 'transactionCurrency', 'settlementCurrency', 'fxRateId', 'fxRate', 'taxCurrency', 'taxAmountInTaxCurrency',
  'purchaseOrderId', 'quotationId', 'createdAt', 'market', 'invoiceConfigId'];
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
