-- Reservation commitment model, build phase 1 (founder decision 2026-10-15, RC-01..RC-90; docs/DEALDASH_BUSINESS_RULES.md addendum).
-- A reservation is no longer a free inventory hold by default. This migration only ADDS: the commitment columns on HotDeal and
-- Reservation, two enums and one event type. Nothing is removed or renamed, no payment is implemented here.
--
-- Existing data (RC-22): Hot Deals with reservations on keep working as FREE (legacy); existing reservations are FREE, need no payment,
-- and count as confirmed when they were created. They stay valid until they are redeemed, cancelled or expire. Required columns are added
-- with a constant default (fills existing rows), then the default is dropped so new rows must state their commitment.

-- CreateEnum
CREATE TYPE "ReservationCommitment" AS ENUM ('FREE', 'FULL_PREPAYMENT', 'DEPOSIT', 'CARD_PREAUTH');

-- CreateEnum
CREATE TYPE "ReservationPaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'AUTHORISED', 'CAPTURED', 'VOIDED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FORFEITED');

-- AlterEnum (RC-52: strike reset)
ALTER TYPE "ReservationEventType" ADD VALUE 'STRIKE_RESET';

-- HotDeal: reservation is off by default (RC-03); commitment columns are derived from content
ALTER TABLE "HotDeal" ALTER COLUMN "reservationsEnabled" SET DEFAULT false;
ALTER TABLE "HotDeal" ADD COLUMN "commitmentMethod" "ReservationCommitment",
ADD COLUMN "commitmentAmountMinor" INTEGER,
ADD COLUMN "depositRefundable" BOOLEAN,
ADD COLUMN "cancelCutoffMinutes" INTEGER,
ADD COLUMN "noShowRefundPercent" INTEGER,
ADD COLUMN "reservationPolicy" JSONB;
UPDATE "HotDeal" SET "commitmentMethod" = 'FREE' WHERE "reservationsEnabled";
ALTER TABLE "HotDeal" ADD CONSTRAINT "HotDeal_commitment_ranges" CHECK (
  ("commitmentAmountMinor" IS NULL OR "commitmentAmountMinor" >= 0)
  AND ("cancelCutoffMinutes" IS NULL OR "cancelCutoffMinutes" >= 0)
  AND ("noShowRefundPercent" IS NULL OR "noShowRefundPercent" BETWEEN 0 AND 100)
);

-- Reservation: commitment snapshot; existing rows are FREE, payment not required, confirmed at creation
ALTER TABLE "Reservation" ADD COLUMN "commitmentMethod" "ReservationCommitment" NOT NULL DEFAULT 'FREE',
ADD COLUMN "amountMinor" INTEGER,
ADD COLUMN "currency" TEXT,
ADD COLUMN "depositRefundable" BOOLEAN,
ADD COLUMN "cancelCutoffAt" TIMESTAMP(3),
ADD COLUMN "noShowRefundPercent" INTEGER,
ADD COLUMN "termsSnapshot" JSONB,
ADD COLUMN "paymentStatus" "ReservationPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN "paymentDueAt" TIMESTAMP(3),
ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "strikeResetAt" TIMESTAMP(3),
ADD COLUMN "strikeResetByUserId" UUID,
ADD COLUMN "strikeResetReason" TEXT;
ALTER TABLE "Reservation" ALTER COLUMN "commitmentMethod" DROP DEFAULT;
ALTER TABLE "Reservation" ALTER COLUMN "paymentStatus" DROP DEFAULT;
UPDATE "Reservation" SET "confirmedAt" = "createdAt" WHERE "confirmedAt" IS NULL;
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_commitment_ranges" CHECK (
  ("amountMinor" IS NULL OR "amountMinor" >= 0)
  AND ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$')
  AND ("noShowRefundPercent" IS NULL OR "noShowRefundPercent" BETWEEN 0 AND 100)
  -- a FREE reservation never carries money
  AND ("commitmentMethod" <> 'FREE' OR ("amountMinor" IS NULL AND "paymentStatus" = 'NOT_REQUIRED'))
);
