-- Reservation commitment model, build phase 3 (founder decision 2026-10-15, RC-90..RC-95): card pre-authorisation, mock provider only.
-- Additive only. A card hold is its own record (ReservationAuthorisation); nothing is posted to the ledger while a hold is only
-- authorised. A capture becomes a SUCCEEDED ReservationPayment and is settled like any paid amount (phase 2 rules, RC-73 one fee).

-- CreateEnum
CREATE TYPE "ReservationAuthStatus" AS ENUM ('REQUESTED', 'AUTHORISED', 'FAILED', 'CANCELLED', 'EXPIRED', 'RELEASED', 'CAPTURED', 'PARTIALLY_CAPTURED');

-- AlterEnum
ALTER TYPE "ReservationEventType" ADD VALUE 'AUTHORISATION_REQUESTED';
ALTER TYPE "ReservationEventType" ADD VALUE 'AUTHORISED';
ALTER TYPE "ReservationEventType" ADD VALUE 'AUTHORISATION_FAILED';
ALTER TYPE "ReservationEventType" ADD VALUE 'AUTHORISATION_EXPIRED';
ALTER TYPE "ReservationEventType" ADD VALUE 'HOLD_RELEASED';
ALTER TYPE "ReservationEventType" ADD VALUE 'HOLD_CAPTURED';
ALTER TYPE "NotificationType" ADD VALUE 'RESERVATION_HOLD_RELEASED';
ALTER TYPE "NotificationType" ADD VALUE 'RESERVATION_HOLD_CAPTURED';

-- CreateTable
CREATE TABLE "ReservationAuthorisation" (
    "id" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "status" "ReservationAuthStatus" NOT NULL DEFAULT 'REQUESTED',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "redirectUrl" TEXT,
    "failureCode" TEXT,
    "authorisedAt" TIMESTAMP(3),
    "authExpiresAt" TIMESTAMP(3),
    "pendingCaptureMinor" INTEGER,
    "captureReason" TEXT,
    "releaseRequestedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "capturedMinor" INTEGER NOT NULL DEFAULT 0,
    "capturedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReservationAuthorisation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReservationAuthorisation_amounts" CHECK (
      "amountMinor" > 0
      AND "capturedMinor" >= 0 AND "capturedMinor" <= "amountMinor"
      AND ("pendingCaptureMinor" IS NULL OR ("pendingCaptureMinor" > 0 AND "pendingCaptureMinor" <= "amountMinor"))
    ),
    CONSTRAINT "ReservationAuthorisation_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);

-- AlterTable
ALTER TABLE "PaymentEvent" ADD COLUMN "reservationAuthorisationId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "ReservationAuthorisation_providerReference_key" ON "ReservationAuthorisation"("providerReference");
CREATE UNIQUE INDEX "ReservationAuthorisation_idempotencyKey_key" ON "ReservationAuthorisation"("idempotencyKey");
CREATE INDEX "ReservationAuthorisation_reservationId_createdAt_idx" ON "ReservationAuthorisation"("reservationId", "createdAt");
CREATE INDEX "ReservationAuthorisation_status_authExpiresAt_idx" ON "ReservationAuthorisation"("status", "authExpiresAt");
-- at most ONE open hold request per reservation, and at most ONE live hold
CREATE UNIQUE INDEX "ReservationAuthorisation_one_open_request" ON "ReservationAuthorisation"("reservationId")
  WHERE "status" = 'REQUESTED';
CREATE UNIQUE INDEX "ReservationAuthorisation_one_live_hold" ON "ReservationAuthorisation"("reservationId")
  WHERE "status" = 'AUTHORISED';

-- AddForeignKey
ALTER TABLE "ReservationAuthorisation" ADD CONSTRAINT "ReservationAuthorisation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_reservationAuthorisationId_fkey" FOREIGN KEY ("reservationAuthorisationId") REFERENCES "ReservationAuthorisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PaymentEvent_reservationAuthorisationId_idx" ON "PaymentEvent"("reservationAuthorisationId");
