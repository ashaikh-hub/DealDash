-- Customer "My benefits": employer work-email verification and added cards on the existing eligibility attribute model.
-- Additive only: nullable columns, one defaulted timestamp, one index, one notification type. No existing row changes meaning.

ALTER TABLE "EligibilityAttribute"
  ADD COLUMN "programId" UUID,
  ADD COLUMN "contactHash" TEXT,
  ADD COLUMN "contactEnc" TEXT,
  ADD COLUMN "contactMasked" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "EligibilityAttribute_attrType_contactHash_idx" ON "EligibilityAttribute"("attrType", "contactHash");

ALTER TYPE "NotificationType" ADD VALUE 'BENEFIT_UPDATED';
