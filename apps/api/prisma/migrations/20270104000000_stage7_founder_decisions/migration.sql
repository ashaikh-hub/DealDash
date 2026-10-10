-- Stage 7 founder decisions (FD-S7-1, FD-S7-3). Additive only.

-- FD-S7-1: Watch & Earn campaign creator and budget owner (Sponsor / Funder), recorded separately from the merchant that holds it.
ALTER TABLE "WatchCampaign" ADD COLUMN     "creatorOrganizationId" UUID,
ADD COLUMN     "sponsorOrganizationId" UUID;
CREATE INDEX "WatchCampaign_sponsorOrganizationId_idx" ON "WatchCampaign"("sponsorOrganizationId");

-- FD-S7-3: verification evidence for card issuer / product / tier / scheme attributes.
ALTER TABLE "EligibilityAttribute" ADD COLUMN     "evidenceRef" TEXT,
ADD COLUMN     "verificationSource" TEXT;

ALTER TABLE "EligibilityAttribute" ADD CONSTRAINT "EligibilityAttribute_verificationSource_check"
  CHECK ("verificationSource" IS NULL OR "verificationSource" IN ('ISSUER_API','SCHEME_API','PARTNER_FEED','TOKENIZED_VERIFICATION','APPROVED_SOURCE'));
-- A card attribute is ISSUER_VERIFIED only with a trusted source AND evidence. BIN / IIN metadata, a customer's selection or a
-- self-declaration alone can never be stored as verified. NOT VALID: enforced for every new or changed row; earlier development rows
-- (if any) are left untouched rather than rewritten.
ALTER TABLE "EligibilityAttribute" ADD CONSTRAINT "EligibilityAttribute_card_verification_check"
  CHECK (
    "attrType"::text NOT IN ('CARD','CARD_PRODUCT','CARD_TIER','SCHEME')
    OR "level"::text <> 'ISSUER_VERIFIED'
    OR ("verificationSource" IS NOT NULL AND "evidenceRef" IS NOT NULL)
  ) NOT VALID;
