-- Reservation commitment model, build phase 2 (founder decision 2026-10-15, RC-30..RC-82): payment, deposit, refund and forfeit.
-- Additive only. Reservation money lives in its OWN tables (ReservationPayment, ReservationRefund) so the voucher Payment / Refund
-- rows and every engine reading them are unchanged; the shared provider webhook is routed by provider reference. Existing rows are
-- untouched (all new reservation columns are nullable; existing reservations are FREE and carry no money).

-- AlterEnum: reservation status (payment window, payment failed)
ALTER TYPE "ReservationStatus" ADD VALUE 'PENDING_PAYMENT';
ALTER TYPE "ReservationStatus" ADD VALUE 'PAYMENT_FAILED';

-- AlterEnum: reservation money events (audit trail RC-82)
ALTER TYPE "ReservationEventType" ADD VALUE 'PAYMENT_PENDING';
ALTER TYPE "ReservationEventType" ADD VALUE 'PAYMENT_SUCCEEDED';
ALTER TYPE "ReservationEventType" ADD VALUE 'PAYMENT_FAILED';
ALTER TYPE "ReservationEventType" ADD VALUE 'REFUND_REQUESTED';
ALTER TYPE "ReservationEventType" ADD VALUE 'REFUNDED';
ALTER TYPE "ReservationEventType" ADD VALUE 'REFUND_FAILED';
ALTER TYPE "ReservationEventType" ADD VALUE 'FORFEITED';
ALTER TYPE "ReservationEventType" ADD VALUE 'SETTLED_TO_MERCHANT';

-- AlterEnum: customer notifications
ALTER TYPE "NotificationType" ADD VALUE 'RESERVATION_PAYMENT_FAILED';
ALTER TYPE "NotificationType" ADD VALUE 'RESERVATION_REFUND_UPDATED';
ALTER TYPE "NotificationType" ADD VALUE 'RESERVATION_FORFEITED';

-- AlterEnum: ledger journal types
ALTER TYPE "LedgerJournalType" ADD VALUE 'RESERVATION_PAYMENT';
ALTER TYPE "LedgerJournalType" ADD VALUE 'RESERVATION_SETTLEMENT';
ALTER TYPE "LedgerJournalType" ADD VALUE 'RESERVATION_REFUND';

-- Reservation: commission in force and what happened to the money
ALTER TABLE "Reservation" ADD COLUMN "commissionBps" INTEGER,
ADD COLUMN "keptMinor" INTEGER,
ADD COLUMN "feeMinor" INTEGER,
ADD COLUMN "settledAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_settlement_ranges" CHECK (
  ("commissionBps" IS NULL OR "commissionBps" BETWEEN 0 AND 10000)
  AND ("keptMinor" IS NULL OR "keptMinor" >= 0)
  AND ("feeMinor" IS NULL OR ("feeMinor" >= 0 AND "feeMinor" <= COALESCE("keptMinor", 0)))
);

-- CreateTable
CREATE TABLE "ReservationPayment" (
    "id" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "redirectUrl" TEXT,
    "failureCode" TEXT,
    "methodType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReservationPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReservationPayment_amount_positive" CHECK ("amountMinor" > 0),
    CONSTRAINT "ReservationPayment_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);

-- CreateTable
CREATE TABLE "ReservationRefund" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "reservationId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PROCESSING',
    "reasonCode" TEXT NOT NULL,
    "providerRefundReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "failureCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "ReservationRefund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ReservationRefund_amount_positive" CHECK ("amountMinor" > 0),
    CONSTRAINT "ReservationRefund_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$')
);

-- AlterTable: the shared provider webhook log can point at a reservation payment attempt
ALTER TABLE "PaymentEvent" ADD COLUMN "reservationPaymentId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "ReservationPayment_providerReference_key" ON "ReservationPayment"("providerReference");
CREATE UNIQUE INDEX "ReservationPayment_idempotencyKey_key" ON "ReservationPayment"("idempotencyKey");
CREATE INDEX "ReservationPayment_reservationId_createdAt_idx" ON "ReservationPayment"("reservationId", "createdAt");
CREATE INDEX "ReservationPayment_status_createdAt_idx" ON "ReservationPayment"("status", "createdAt");
-- at most ONE open payment attempt per reservation (a double tap cannot charge twice)
CREATE UNIQUE INDEX "ReservationPayment_one_open_attempt" ON "ReservationPayment"("reservationId")
  WHERE "status" IN ('CREATED', 'PENDING');
CREATE UNIQUE INDEX "ReservationRefund_reference_key" ON "ReservationRefund"("reference");
CREATE UNIQUE INDEX "ReservationRefund_providerRefundReference_key" ON "ReservationRefund"("providerRefundReference");
CREATE UNIQUE INDEX "ReservationRefund_idempotencyKey_key" ON "ReservationRefund"("idempotencyKey");
CREATE INDEX "ReservationRefund_status_createdAt_idx" ON "ReservationRefund"("status", "createdAt");
CREATE INDEX "ReservationRefund_reservationId_idx" ON "ReservationRefund"("reservationId");
CREATE INDEX "ReservationRefund_organizationId_createdAt_idx" ON "ReservationRefund"("organizationId", "createdAt");
CREATE INDEX "PaymentEvent_reservationPaymentId_receivedAt_idx" ON "PaymentEvent"("reservationPaymentId", "receivedAt");

-- AddForeignKey
ALTER TABLE "ReservationPayment" ADD CONSTRAINT "ReservationPayment_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationRefund" ADD CONSTRAINT "ReservationRefund_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReservationRefund" ADD CONSTRAINT "ReservationRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "ReservationPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_reservationPaymentId_fkey" FOREIGN KEY ("reservationPaymentId") REFERENCES "ReservationPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
