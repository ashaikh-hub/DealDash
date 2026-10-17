-- Watch & Earn instant prizes (WE-05, WE-44; FDR-19 decided 2026-10-16: instant probabilistic allocation). Additive.

-- campaign prize counters (awarding is one conditional update: prizesAwarded < prizeInventory)
ALTER TABLE "WatchCampaign" ADD COLUMN "prizeInventory" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "prizesAwarded" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WatchCampaign" ADD CONSTRAINT "WatchCampaign_prize_counts_non_negative"
  CHECK ("prizesAwarded" >= 0 AND "prizeInventory" >= 0);

-- CreateEnum
CREATE TYPE "WatchPrizeStatus" AS ENUM ('NOT_WON', 'ISSUED', 'REDEEMED', 'EXPIRED');

-- CreateTable
CREATE TABLE "WatchPrizeDraw" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "viewId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "eligible" BOOLEAN NOT NULL,
    "ineligibleReason" TEXT,
    "probabilityBps" INTEGER NOT NULL,
    "roll" INTEGER,
    "won" BOOLEAN NOT NULL,
    "inventoryBefore" INTEGER NOT NULL,
    "inventoryAfter" INTEGER NOT NULL,
    "status" "WatchPrizeStatus" NOT NULL DEFAULT 'NOT_WON',
    "prizeTitleEn" TEXT NOT NULL DEFAULT '',
    "prizeTitleAr" TEXT NOT NULL DEFAULT '',
    "prizeKind" TEXT,
    "reference" TEXT,
    "qrToken" TEXT,
    "manualCode" TEXT,
    "branchIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),
    "redeemedBranchId" UUID,
    "redeemedByUserId" UUID,
    "redeemIdempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchPrizeDraw_pkey" PRIMARY KEY ("id"),
    -- a decision is consistent: a prize is only issued when the view was eligible and won, with a code and an expiry
    CONSTRAINT "WatchPrizeDraw_won_consistent" CHECK (
      ("won" = false AND "status" = 'NOT_WON' AND "manualCode" IS NULL)
      OR ("won" = true AND "eligible" = true AND "status" <> 'NOT_WON' AND "manualCode" IS NOT NULL AND "expiresAt" IS NOT NULL)
    ),
    CONSTRAINT "WatchPrizeDraw_probability_range" CHECK ("probabilityBps" BETWEEN 0 AND 10000)
);

-- CreateIndex
CREATE UNIQUE INDEX "WatchPrizeDraw_viewId_key" ON "WatchPrizeDraw"("viewId");
CREATE UNIQUE INDEX "WatchPrizeDraw_reference_key" ON "WatchPrizeDraw"("reference");
CREATE UNIQUE INDEX "WatchPrizeDraw_qrToken_key" ON "WatchPrizeDraw"("qrToken");
CREATE UNIQUE INDEX "WatchPrizeDraw_manualCode_key" ON "WatchPrizeDraw"("manualCode");
CREATE INDEX "WatchPrizeDraw_campaignId_won_idx" ON "WatchPrizeDraw"("campaignId", "won");
CREATE INDEX "WatchPrizeDraw_userId_campaignId_idx" ON "WatchPrizeDraw"("userId", "campaignId");
CREATE INDEX "WatchPrizeDraw_organizationId_status_idx" ON "WatchPrizeDraw"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "WatchPrizeDraw" ADD CONSTRAINT "WatchPrizeDraw_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "WatchView"("id") ON DELETE CASCADE ON UPDATE CASCADE;
