-- Reservation commitment model, phase 2 closure (founder decision 2026-10-15, RC-73 / RC-74): one DealDash fee per customer
-- transaction. A paid reservation pays the reservation commission; the Exclusive Deal per-redemption fee is NOT charged as well,
-- unless the merchant's agreement explicitly allows it (policy `additionalRedemptionFee`, snapshotted here per reservation).
-- Additive only: existing reservations default to "not allowed" and have no redemption fee recorded.

ALTER TABLE "Reservation" ADD COLUMN "additionalFeeAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "redemptionFeeMinor" INTEGER;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_redemption_fee_range" CHECK (
  "redemptionFeeMinor" IS NULL OR "redemptionFeeMinor" >= 0
);
