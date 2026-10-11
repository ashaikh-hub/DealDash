/**
 * Stage 9: restore test. Restores a backup into a NON-production database and proves it is usable: the restore completes, the key
 * tables have the row counts recorded in the backup's manifest (when there is one), and every migration is present.
 *
 *   node --env-file=.env apps/api/scripts/ops/db-restore-verify.mjs <file.dump> [--url-env TEST_DATABASE_URL]   (from the repo root)
 *
 * Refuses any target whose database name does not end in _test, _restore or _staging (production is never a restore-test target),
 * and any non-local host unless RESTORE_ALLOW_REMOTE=true (a staging restore drill). The target's contents are REPLACED.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const file = args[0];
if (!file || !existsSync(file))
  throw new Error('Usage: db-restore-verify.mjs <file.dump> [--url-env TEST_DATABASE_URL]');
const i = args.indexOf('--url-env');
const urlEnv = i >= 0 ? args[i + 1] : 'TEST_DATABASE_URL';
const url = process.env[urlEnv];
if (!url) throw new Error(`${urlEnv} is not set`);
const u = new URL(url.split('?')[0]);
const db = u.pathname.replace(/^\//, '');
if (!/_(test|restore|staging)$/.test(db))
  throw new Error(
    `Refusing to restore into "${db}": the target must end in _test, _restore or _staging`,
  );
if (
  !['localhost', '127.0.0.1', '::1'].includes(u.hostname) &&
  process.env.RESTORE_ALLOW_REMOTE !== 'true'
)
  throw new Error('Refusing a non-local target without RESTORE_ALLOW_REMOTE=true');
const bin =
  process.env.PG_BIN ??
  (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\18\\bin' : '');
const tool = (name) =>
  bin ? join(bin, process.platform === 'win32' ? `${name}.exe` : name) : name;

const started = Date.now();
// A restore must produce exactly the backup: objects created after the backup was taken (newer tables, functions, types) would
// otherwise survive `--clean` (which only drops what the dump contains) and make the target a mix of two versions. So the target
// is emptied first, keeping only extension-owned objects (PostGIS). The name check above means this never touches dev or production.
const WIPE_SQL = `
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP %s IF EXISTS public.%I CASCADE',
         CASE (SELECT relkind FROM pg_class WHERE relname = r.relname AND relnamespace = 'public'::regnamespace)
           WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.relname);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname); END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig); END LOOP;
END $$;`;
{
  const wipe = new pg.Client({ connectionString: url });
  await wipe.connect();
  try {
    await wipe.query(WIPE_SQL);
  } finally {
    await wipe.end();
  }
}
// The restore runs as the least-privilege application role. Extensions (PostGIS) and the objects they own (spatial_ref_sys) belong
// to the database administrator and already exist in the target, so they are left out of the restore list instead of granting
// superuser rights to the restore.
const listing = spawnSync(tool('pg_restore'), ['--list', file], { encoding: 'utf8' });
if (listing.status !== 0) throw new Error('The backup file is not readable');
const listFile = `${file}.restore-list.txt`;
writeFileSync(
  listFile,
  listing.stdout
    .split('\n')
    .filter((l) => !/ EXTENSION | spatial_ref_sys /.test(l))
    .join('\n'),
);
const r = spawnSync(
  tool('pg_restore'),
  [
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '-L',
    listFile,
    `--dbname=${url}`,
    file,
  ],
  { encoding: 'utf8' },
);
const errors = (r.stderr ?? '').split('\n').filter((l) => /error:/i.test(l));
const client = new pg.Client({ connectionString: url });
await client.connect();
const counts = {};
for (const t of [
  'User',
  'Organization',
  'VoucherOrder',
  'VoucherInstance',
  'Payment',
  'Refund',
  'LedgerJournal',
  'RewardEntry',
  'AuditLog',
  'Settlement',
  '_prisma_migrations',
])
  counts[t] = Number(
    (
      await client
        .query(`SELECT count(*)::bigint AS n FROM "${t}"`)
        .catch(() => ({ rows: [{ n: -1 }] }))
    ).rows[0].n,
  );
const balanced = (
  await client
    .query(
      `SELECT count(*)::int AS n FROM (SELECT "journalId" FROM "LedgerEntry" GROUP BY "journalId" HAVING sum("amountHalalas") <> 0) x`,
    )
    .catch(() => ({ rows: [{ n: -1 }] }))
).rows[0].n;
await client.end();
const manifestFile = `${file}.manifest.json`;
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null;
const mismatches = manifest
  ? Object.entries(manifest.rowCounts)
      .filter(([t, n]) => counts[t] !== n)
      .map(([t, n]) => `${t}: backup ${n}, restored ${counts[t]}`)
  : [];
const ok =
  errors.length === 0 &&
  mismatches.length === 0 &&
  counts._prisma_migrations > 0 &&
  counts.User >= 0 &&
  balanced === 0;
console.log(
  JSON.stringify(
    {
      restoredInto: db,
      seconds: Math.round((Date.now() - started) / 1000),
      rowCounts: counts,
      manifestChecked: !!manifest,
      mismatches,
      unbalancedJournals: balanced,
      errors: errors.slice(0, 5),
      result: ok ? 'RESTORE VERIFIED' : 'RESTORE FAILED',
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);
