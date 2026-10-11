-- Stage 9: production and launch readiness. B1 configurable settlement rule (cut-off, reserve, payout method, retries, tax
-- treatment), B2 payout instructions, B6 customer case replies, B7 governed configuration change requests, legal holds.

-- B6: who wrote a case note, and the evidence reference a customer gives
ALTER TABLE "CaseNote" ADD COLUMN "authorKind" TEXT NOT NULL DEFAULT 'DEALDASH';
ALTER TABLE "CaseNote" ADD COLUMN "evidenceRef" TEXT;
-- Case notes are append-only (a trigger blocks every UPDATE), so this one-time backfill of the NEW authorKind column lifts the guard
-- for these two statements only (same pattern as the Phase 3 RewardEntry backfill). Note text, visibility, authors and every
-- original column are untouched.
ALTER TABLE "CaseNote" DISABLE TRIGGER "CaseNote_append_only";
UPDATE "CaseNote" SET "authorKind" = 'BUSINESS' WHERE "authorOrganizationId" IS NOT NULL;
UPDATE "CaseNote" SET "authorKind" = 'SYSTEM' WHERE "authorOrganizationId" IS NULL AND ("kind" = 'SYSTEM' OR "authorUserId" IS NULL);
ALTER TABLE "CaseNote" ENABLE TRIGGER "CaseNote_append_only";

-- B1: settlement rule controls
ALTER TABLE "SettlementRule" ADD COLUMN "cutoffTime" TEXT;
ALTER TABLE "SettlementRule" ADD COLUMN "reserveBps" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SettlementRule" ADD COLUMN "reserveReleaseDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SettlementRule" ADD COLUMN "payoutMethod" TEXT NOT NULL DEFAULT 'BANK_TRANSFER';
ALTER TABLE "SettlementRule" ADD COLUMN "failedRetryMaxAttempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "SettlementRule" ADD COLUMN "taxTreatment" TEXT NOT NULL DEFAULT 'INFORMATIONAL';

-- B1 / B2: reserves and payout instructions on a statement
ALTER TABLE "Settlement" ADD COLUMN "reserveMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Settlement" ADD COLUMN "reserveReleaseAt" TIMESTAMP(3);
ALTER TABLE "Settlement" ADD COLUMN "reserveReleasedIntoId" UUID;
ALTER TABLE "Settlement" ADD COLUMN "reserveReleasedMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Settlement" ADD COLUMN "payoutAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SettlementPayout" ADD COLUMN "provider" TEXT;

-- B7: governed configuration change requests
CREATE TABLE "ConfigChangeRequest" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "restoresVersion" INTEGER,
    "requestedByUserId" UUID NOT NULL,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "appliedVersion" INTEGER,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConfigChangeRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConfigChangeRequest_reference_key" ON "ConfigChangeRequest"("reference");
CREATE INDEX "ConfigChangeRequest_key_status_idx" ON "ConfigChangeRequest"("key", "status");
CREATE INDEX "ConfigChangeRequest_status_effectiveFrom_idx" ON "ConfigChangeRequest"("status", "effectiveFrom");

-- legal holds (privacy operations)
CREATE TABLE "LegalHold" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "caseId" UUID,
    "placedByUserId" UUID NOT NULL,
    "liftedByUserId" UUID,
    "liftReason" TEXT,
    "liftedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LegalHold_reference_key" ON "LegalHold"("reference");
CREATE INDEX "LegalHold_subjectType_subjectId_idx" ON "LegalHold"("subjectType", "subjectId");

-- ---------------------------------------------------------------- integrity
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_authorKind" CHECK ("authorKind" IN ('DEALDASH', 'BUSINESS', 'CUSTOMER', 'SYSTEM'));
-- a customer message is always shared with DealDash and never an internal note
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_customer_shared" CHECK ("authorKind" <> 'CUSTOMER' OR ("visibility" = 'SHARED' AND "authorOrganizationId" IS NULL));
ALTER TABLE "CaseNote" ADD CONSTRAINT "CaseNote_evidenceRef" CHECK ("evidenceRef" IS NULL OR length("evidenceRef") BETWEEN 1 AND 120);

ALTER TABLE "SettlementRule" ADD CONSTRAINT "SettlementRule_stage9_values" CHECK (
  ("cutoffTime" IS NULL OR "cutoffTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  AND "reserveBps" BETWEEN 0 AND 10000 AND "reserveReleaseDays" >= 0 AND "failedRetryMaxAttempts" BETWEEN 0 AND 20
  AND "payoutMethod" IN ('BANK_TRANSFER', 'PAYOUT_PROVIDER', 'MANUAL')
  AND "taxTreatment" IN ('INFORMATIONAL', 'WITHHELD'));

ALTER TABLE "Settlement" DROP CONSTRAINT "Settlement_status_check";
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_status_check" CHECK ("status" IN ('PENDING','ELIGIBLE','HELD','DISPUTE_HOLD','PAYOUT_PENDING','PARTIALLY_PAID','COMPLETED','FAILED','REVERSED'));
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_reserve_check" CHECK ("reserveMinor" >= 0 AND "reserveReleasedMinor" >= 0 AND "payoutAttempts" >= 0);
ALTER TABLE "SettlementPayout" ADD CONSTRAINT "SettlementPayout_status_check" CHECK ("status" IN ('INSTRUCTED','PAID','FAILED','REVERSED'));

ALTER TABLE "ConfigChangeRequest" ADD CONSTRAINT "ConfigChangeRequest_values" CHECK (
  "status" IN ('PENDING_APPROVAL', 'SCHEDULED', 'APPLIED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')
  AND "baseVersion" >= 0 AND length("reason") >= 3
  AND ("decidedByUserId" IS NULL OR "decidedByUserId" <> "requestedByUserId"));

ALTER TABLE "LegalHold" ADD CONSTRAINT "LegalHold_values" CHECK (
  "subjectType" IN ('USER', 'ORGANIZATION') AND length("reason") >= 3
  AND ("liftedAt" IS NULL OR ("liftedByUserId" IS NOT NULL AND "liftReason" IS NOT NULL)));
