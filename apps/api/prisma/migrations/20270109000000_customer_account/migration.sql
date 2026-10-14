-- Customer account: profile set-up and consents (Blueprint §5, Customer MVP CS-02 / CS-05), and the employer renewal date that
-- separates "renewal due" from the end of the grace period (EM-20).
-- Additive only: nullable / defaulted columns, one new table, one index. Existing employer verifications keep their current end date
-- as their renewal date (no grace is added to a verification made before this change).

ALTER TABLE "Customer"
  ADD COLUMN "dobEnc" TEXT,
  ADD COLUMN "ageVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "interests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "onboardedAt" TIMESTAMP(3);

CREATE TABLE "CustomerConsent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerConsent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerConsent_userId_kind_createdAt_idx" ON "CustomerConsent"("userId", "kind", "createdAt");

ALTER TABLE "EligibilityAttribute" ADD COLUMN "renewDueAt" TIMESTAMP(3);

UPDATE "EligibilityAttribute" SET "renewDueAt" = "expiresAt"
  WHERE "attrType" = 'EMPLOYER' AND "expiresAt" IS NOT NULL AND "renewDueAt" IS NULL;

ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNT_WELCOME';

-- CS-06: the customer's optional notification categories share the preference table with business alert categories. The check is
-- widened by exactly these two values; every existing value stays allowed.
ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_values";
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_values" CHECK (
  "category" IN ('PERFORMANCE', 'INVENTORY', 'FUNDING', 'FINANCE', 'COMMERCIAL', 'INTEGRATION', 'RISK', 'SUBSCRIPTION', 'OPERATIONS', 'ALL',
                 'CUSTOMER_REWARDS', 'CUSTOMER_BENEFITS')
  AND "frequency" IN ('IMMEDIATE', 'DIGEST', 'CRITICAL_ONLY') AND "channels" <@ ARRAY['IN_APP', 'EMAIL', 'PUSH', 'SMS', 'TASK_INBOX']::text[]);
