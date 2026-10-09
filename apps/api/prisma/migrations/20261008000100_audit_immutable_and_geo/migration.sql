-- 1) Audit log is append-only: block UPDATE, DELETE and TRUNCATE for every role (including the owner).
--    (Only a deliberate, reviewed migration can drop these triggers.)
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% is not allowed)', TG_OP USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_no_update_delete"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();

-- 2) Branch geography is derived from latitude/longitude by the database (single source of truth).
--    The application writes plain decimal coordinates; PostGIS maintains the geography point.
CREATE OR REPLACE FUNCTION merchant_branch_sync_location() RETURNS trigger AS $$
BEGIN
  IF NEW."latitude" IS NULL OR NEW."longitude" IS NULL THEN
    NEW."location" := NULL;
  ELSE
    NEW."location" := ST_SetSRID(ST_MakePoint(NEW."longitude"::float8, NEW."latitude"::float8), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MerchantBranch_sync_location"
  BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "MerchantBranch"
  FOR EACH ROW EXECUTE FUNCTION merchant_branch_sync_location();

-- 3) Data-quality guards.
ALTER TABLE "MerchantBranch"
  ADD CONSTRAINT "MerchantBranch_lat_range" CHECK ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90)),
  ADD CONSTRAINT "MerchantBranch_lng_range" CHECK ("longitude" IS NULL OR ("longitude" BETWEEN -180 AND 180));

ALTER TABLE "User"
  ADD CONSTRAINT "User_contact_present" CHECK ("mobile" IS NOT NULL OR "email" IS NOT NULL);
