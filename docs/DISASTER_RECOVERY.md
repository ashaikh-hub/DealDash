# DealDash — Backup and Disaster Recovery

Stage 9 (production readiness). Provider-neutral: the hosting provider is **not selected** (founder decision; see
`PROVIDER_READINESS_MATRIX.md`). This document states what DealDash requires from the platform, what the repository provides, what was
actually tested, and what stays open.

## 1. Objectives (placeholders until the founder sets them)

| Measure | Proposed starting value | Status |
|---|---|---|
| RPO (maximum data loss) | ≤ 5 minutes (managed PostgreSQL with continuous WAL archiving / point-in-time recovery) | **FOUNDER DECISION** |
| RTO (maximum time to restore service) | ≤ 4 hours for a full regional database loss; ≤ 30 minutes for an application rollback | **FOUNDER DECISION** |
| Backup retention | 35 days point-in-time; monthly logical backups kept 12 months | **FOUNDER DECISION + VALIDATE-KSA** (retention law) |
| Restore drill | Monthly in staging; before every launch milestone | Required |

The values above are engineering proposals, not commitments. They are confirmed once hosting is contracted and the cost is known.

## 2. What must be protected

| Asset | Where | Protection |
|---|---|---|
| Transactional data (orders, payments, refunds, ledger, settlements, rewards, audit) | PostgreSQL | Managed PITR + daily logical backup (`db-backup.mjs`) + restore drill |
| Uploaded files (evidence, merchant media, invoices) | Object storage (**adapter not built; vendor not selected**) | Versioned bucket, retention lock, cross-region copy |
| Secrets (session, field-encryption key, provider keys, webhook secrets) | Platform secret manager (**not selected**) | Two-person access; documented rotation; **the field-encryption key must be escrowed** — losing it makes encrypted fields unrecoverable |
| Configuration | `SystemConfiguration` rows (versioned, governed) | Inside the database backup; every change has history and rollback (B7) |
| Code and release artefacts | Git + container registry + release record (notes, migration list, SBOM) | Tag per release; previous tag is the application rollback target |

## 3. Tooling in the repository (Stage 9)

- `apps/api/scripts/ops/db-backup.mjs <label> [--out <dir>] [--url-env DATABASE_URL]` — custom-format `pg_dump`, refuses `_test`
  databases, never overwrites, verifies the dump (`pg_restore --list`), writes a manifest (sha256, size, entry count, key-table row
  counts, PostgreSQL and migration versions). The connection string is read from the environment and never printed.
- `apps/api/scripts/ops/db-restore-verify.mjs <file.dump> [--url-env TEST_DATABASE_URL]` — restores into a database whose name ends
  in `_test`, `_restore` or `_staging` only (never development or production; non-local hosts need `RESTORE_ALLOW_REMOTE=true`),
  then proves the result: no restore errors, key-table row counts equal the manifest, migrations present, **every ledger journal
  balances**. **Stage 9 fix:** the target is now emptied first (extension objects such as PostGIS kept). Before the fix, objects
  created after the backup survived `pg_restore --clean`, so a "restored" database could silently mix two schema versions (found
  during the migration rehearsal below).

## 4. Tests actually performed (2026-10-11, local)

| Test | Result |
|---|---|
| Logical backup of the development database (pre-migration) | `dealdash_dev-pre-stage9-migration-20261011T075858Z.dump`, 1,514,101 bytes, 1,182 entries, verified |
| Restore into an empty `dealdash_test` + verification | **RESTORE VERIFIED** in 3–4 s; 11 key tables match the manifest; 0 unbalanced journals; 0 errors |
| Migration rehearsal on the restored copy of real data | Found a defect (below); the corrected migration applied cleanly; backfill verified |
| Post-migration backup | `dealdash_dev-post-stage9-migration-20261011T080249Z.dump`, 1,522,048 bytes, 1,193 entries, verified |

Not performed (no hosting yet): managed PITR restore, cross-region restore, object-storage restore, a full-environment rebuild.
These are **go-live checklist items** (`GO_LIVE_CHECKLIST.md`).

### Incident record: Stage 9 migration on development (2026-10-11)
- **What happened.** `20270106000000_stage9_production_readiness` applied cleanly to the (empty) test database but failed on the
  development database: the backfill `UPDATE "CaseNote"` was refused by the append-only trigger `CaseNote_append_only`. Prisma runs
  the statements one by one, so the first two (`ADD COLUMN authorKind`, `ADD COLUMN evidenceRef`) had already been applied.
- **Recovery (no data lost).** The development database had been backed up first. A guarded one-off script removed only those two
  new columns (it refused unless the migration was recorded as failed, no later Stage 9 object existed, and both columns held only
  defaults); the attempt was marked rolled back (`prisma migrate resolve --rolled-back`); the corrected migration was applied.
- **Fix.** The backfill now lifts the append-only guard for the two statements only (`DISABLE TRIGGER` … `ENABLE TRIGGER`), the same
  pattern as the Phase 3 `RewardEntry` backfill. Rehearsed first on a restored copy of the development data: 12 business-authored
  notes → `BUSINESS`, 12 → `DEALDASH`, trigger re-enabled, note content checksum unchanged. Then applied to development: identical
  result, no schema drift, users unchanged (60).
- **Lesson → control.** A migration that passes on an empty database proves little. **Every release's migrations are rehearsed on a
  restored copy of production data in staging before production** (runbook §6, go-live checklist).

## 5. Recovery procedures

### 5.1 Bad application release (most likely)
Redeploy the previous tag (`release.yml`, manual, protected environment). Migrations are forward-only and additive, so the previous
application version runs on the newer schema. If a migration itself is wrong, fix forward with a new migration; never edit an
applied migration.

### 5.2 Bad data change (operator error, faulty job)
1. Stop the cause: emergency stop in Rules and controls (launch controls) or pause the job.
2. Identify the window from the audit log (every change is recorded with actor, reason and before/after state).
3. Restore the database to a **new** instance at a point just before the change (PITR); never overwrite production in place.
4. Compare and repair through the application's own audited operations (adjustments, reversals) — not by editing tables. Ledger
   tables are append-only by design.

### 5.3 Loss of the database instance or region
1. Declare an incident (runbook §9); turn on emergency stops for new purchases / reservations so nothing new is accepted.
2. Restore the latest PITR point into the recovery region (**VALIDATE-KSA**: the recovery region must satisfy the residency answer).
3. Run `db-restore-verify` checks against the restored instance (row counts, ledger balance), point the API at it, run the smoke test.
4. Reconcile payments with the payment provider for the gap window (payment webhooks are idempotent and can be replayed).

### 5.4 Lost or leaked secret
Rotate in the secret manager; restart the API (sessions signed with the old session secret end). A leaked **field-encryption key**
requires re-encryption of protected fields: a planned, scripted operation (post-launch item E-5).

## 6. Responsibilities
Engineering owns the tooling and the drills; the founder approves RPO/RTO, retention and the hosting contract; finance confirms
payment reconciliation after any restore.
