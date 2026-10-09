-- An offer-conflict decision can also be "the merchant must change the offer".
ALTER TABLE "OfferConflictFlag" DROP CONSTRAINT "OfferConflictFlag_values";
ALTER TABLE "OfferConflictFlag" ADD CONSTRAINT "OfferConflictFlag_values" CHECK ("status" IN ('OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'REQUIRES_CHANGE'));
