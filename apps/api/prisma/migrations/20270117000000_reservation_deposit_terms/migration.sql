-- Founder UAT 2026-10-16: paid limited-stock Exclusive Deals — deposit treatment choices kept on each reservation (snapshot of the
-- terms the customer accepted). Additive and nullable: existing reservations keep the original rules (refundable only before the
-- cut-off; credited toward the bill).

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN "depositLateRefund" BOOLEAN,
ADD COLUMN "depositCredited" BOOLEAN;
