/**
 * Stage 9: logical database backup (custom-format pg_dump) with verification and a manifest. Complements - never replaces - the
 * managed database's automated snapshots and point-in-time recovery in production (docs/DISASTER_RECOVERY.md).
 *
 *   node --env-file=.env apps/api/scripts/ops/db-backup.mjs <label> [--out <dir>] [--url-env DATABASE_URL]   (from the repo root)
 *
 *  - reads the connection string from the named environment variable (never printed); refuses a *_test database
 *  - writes <dir>/<db>-<label>-<UTC timestamp>.dump and refuses to overwrite anything
 *  - verifies the dump is readable (pg_restore --list) and not empty
 *  - writes <file>.manifest.json: sha256, size, entry count, row counts of the key tables, PostgreSQL / migration versions
 * Encryption at rest and off-site copies are the storage platform's job (encrypted bucket with retention lock); see the runbook.
 * PG_BIN may point at the PostgreSQL bin folder (default: the Windows install path, else PATH).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

const args = process.argv.slice(2);
const label = (args[0] ?? '').replace(/[^a-z0-9-]/gi, '');
if (!label) throw new Error('Usage: db-backup.mjs <label> [--out <dir>] [--url-env DATABASE_URL]');
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const outDir = opt('--out', join('.tools', 'backups'));
const urlEnv = opt('--url-env', 'DATABASE_URL');
const url = process.env[urlEnv];
if (!url) throw new Error(`${urlEnv} is not set`);
const conn = url.split('?')[0];
const db = new URL(conn).pathname.replace(/^\//, '');
if (db.endsWith('_test')) throw new Error('This is a test database; refusing');
const bin =
  process.env.PG_BIN ??
  (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\18\\bin' : '');
const tool = (name) =>
  bin ? join(bin, process.platform === 'win32' ? `${name}.exe` : name) : name;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, 'Z');
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${db}-${label}-${stamp}.dump`);
if (existsSync(file)) throw new Error(`${file} already exists`);

const dump = spawnSync(
  tool('pg_dump'),
  ['--format=custom', '--no-owner', `--file=${file}`, `--dbname=${url}`],
  { stdio: ['ignore', 'inherit', 'pipe'] },
);
if (dump.status !== 0) {
  console.error((dump.stderr?.toString() ?? '').replaceAll(conn, '<connection>'));
  process.exit(dump.status ?? 1);
}
const list = spawnSync(tool('pg_restore'), ['--list', file], { encoding: 'utf8' });
const entries = (list.stdout ?? '').split('\n').filter((l) => l && !l.startsWith(';')).length;
const size = statSync(file).size;
if (list.status !== 0 || entries === 0 || size === 0) {
  console.error('VERIFICATION FAILED: the dump is not readable or empty');
  process.exit(1);
}
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
const version = (await client.query('SHOW server_version')).rows[0].server_version;
await client.end();
const manifest = {
  database: db,
  label,
  createdAt: new Date().toISOString(),
  file: file.split(/[\\/]/).pop(),
  sizeBytes: size,
  sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
  entries,
  postgres: version,
  rowCounts: counts,
};
writeFileSync(`${file}.manifest.json`, JSON.stringify(manifest, null, 2));
console.log(
  `backup of ${db} written to ${file} (${size} bytes, ${entries} entries, verified); manifest ${file}.manifest.json`,
);
