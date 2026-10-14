-- Launch readiness G-1: the staging test inbox. STAGING ONLY: development adapters keep what they "send" to configured synthetic test
-- recipients (encrypted body, 24 hours) so testers can sign in before a real SMS / e-mail provider exists. Additive only: one new,
-- empty table; nothing existing changes. Development, test and production tiers never write to it.

CREATE TABLE "StagingTestMessage" (
    "id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "subject" TEXT,
    "bodyEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StagingTestMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StagingTestMessage_channel" CHECK ("channel" IN ('SMS', 'EMAIL'))
);

CREATE INDEX "StagingTestMessage_createdAt_idx" ON "StagingTestMessage"("createdAt");

CREATE INDEX "StagingTestMessage_recipient_createdAt_idx" ON "StagingTestMessage"("recipient", "createdAt");
