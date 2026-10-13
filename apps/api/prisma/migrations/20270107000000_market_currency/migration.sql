-- Launch readiness (founder decision 2026-10-11): currency resolves from Market / Country Configuration and is stored explicitly on
-- every originating financial record. Not a redesign of Stages 5 / 6: the same records, made market-aware.
--
-- Existing rows: every voucher, Watch & Earn and ledger record created so far was priced and recorded in SAR (those engines were
-- SAR-only), so they keep SAR — nothing is converted or rewritten. New rows must state their currency (the defaults are removed).
-- Columns are added with a constant default, which fills existing rows WITHOUT an UPDATE, so append-only triggers are never
-- involved; the default is then dropped.

-- originating product records
ALTER TABLE "Voucher" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SAR';
ALTER TABLE "Voucher" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "WatchCampaign" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SAR';
ALTER TABLE "WatchCampaign" ALTER COLUMN "currency" DROP DEFAULT;

-- the commercial case (shared engine) states the currency its quotation, funding and documents are in
ALTER TABLE "CommercialCase" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SAR';
ALTER TABLE "CommercialCase" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "CommercialCase" ADD CONSTRAINT "CommercialCase_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');

-- financial events carry their currency explicitly
ALTER TABLE "Refund" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SAR';
ALTER TABLE "Refund" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "MerchantPayableEvent" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SAR';
ALTER TABLE "MerchantPayableEvent" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "WatchFunding" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SAR';
ALTER TABLE "WatchFunding" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "LedgerJournal" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'SAR';
ALTER TABLE "LedgerJournal" ALTER COLUMN "currency" DROP DEFAULT;

-- no silent SAR / SA default on records that already had a currency (or country) column
ALTER TABLE "VoucherOrder" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "LedgerAccount" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "LegalEntity" ALTER COLUMN "country" DROP DEFAULT;
ALTER TABLE "LegalEntity" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "BusinessAccount" ALTER COLUMN "country" DROP DEFAULT;
ALTER TABLE "BusinessAccount" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "FinancePayment" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "FinanceDocument" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "CreditFacility" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "AiUsageRecord" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "AdjustmentRequest" ALTER COLUMN "currency" DROP DEFAULT;
ALTER TABLE "ReconciliationItem" ALTER COLUMN "currency" DROP DEFAULT;

-- ISO 4217 shape
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "WatchCampaign" ADD CONSTRAINT "WatchCampaign_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "MerchantPayableEvent" ADD CONSTRAINT "MerchantPayableEvent_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "WatchFunding" ADD CONSTRAINT "WatchFunding_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "LedgerJournal" ADD CONSTRAINT "LedgerJournal_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');

-- ledger accounts are per currency: a business selling in two markets has one account per family AND currency
DROP INDEX "LedgerAccount_platform_unique";
DROP INDEX "LedgerAccount_org_unique";
CREATE UNIQUE INDEX "LedgerAccount_platform_unique" ON "LedgerAccount"("family", "currency") WHERE "organizationId" IS NULL;
CREATE UNIQUE INDEX "LedgerAccount_org_unique" ON "LedgerAccount"("family", "organizationId", "currency") WHERE "organizationId" IS NOT NULL;

-- a journal is single-currency: every entry's account must be in the journal's currency (no implicit FX inside the ledger)
CREATE OR REPLACE FUNCTION dd_ledger_entry_currency() RETURNS trigger AS $$
DECLARE jc TEXT; ac TEXT;
BEGIN
  SELECT "currency" INTO jc FROM "LedgerJournal" WHERE "id" = NEW."journalId";
  SELECT "currency" INTO ac FROM "LedgerAccount" WHERE "id" = NEW."accountId";
  IF jc IS DISTINCT FROM ac THEN
    RAISE EXCEPTION 'Ledger entry account currency % differs from journal currency %', ac, jc USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "LedgerEntry_currency_matches_journal" BEFORE INSERT ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION dd_ledger_entry_currency();
