/**
 * Local database tooling for Windows/macOS/Linux (no Docker, no bash).
 *
 *   pnpm --filter @dealdash/api db:setup      one-time: dealdash_app role, dealdash_dev + dealdash_test, PostGIS (needs the postgres superuser password once)
 *   pnpm --filter @dealdash/api db:migrate    apply migrations to DATABASE_URL
 *   pnpm --filter @dealdash/api db:seed       seed development data
 *   pnpm --filter @dealdash/api db:reset      wipe + migrate + seed dealdash_dev
 *   pnpm --filter @dealdash/api db:test:reset wipe + migrate dealdash_test
 *   pnpm --filter @dealdash/api db:status     connection, migrations, PostGIS (no credentials printed)
 *   pnpm --filter @dealdash/api db:postgis    (re)enable PostGIS in dev/test (needs the superuser)
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { Client } from 'pg';

const API_DIR = resolve(__dirname, '..');
const ROOT = resolve(API_DIR, '../..');
const ENV_FILE = resolve(ROOT, '.env');
const APP_ROLE = 'dealdash_app';
const DEV_DB = 'dealdash_dev';
const TEST_DB = 'dealdash_test';

function loadEnvFile() {
  if (existsSync(ENV_FILE)) {
    try {
      process.loadEnvFile(ENV_FILE);
    } catch {
      /* ignore */
    }
  }
}

function dbNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}
function hostOf(url: string): string {
  return new URL(url).hostname;
}
function redact(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.username ? u.username + ':***@' : ''}${u.host}${u.pathname}`;
}

function assertSafeTarget(url: string, kind: 'dev' | 'test') {
  const name = dbNameOf(url);
  const host = hostOf(url);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host))
    throw new Error(`Refusing to reset a non-local database (${host}).`);
  if (!name.endsWith(kind === 'test' ? '_test' : '_dev')) {
    throw new Error(`Refusing to reset "${name}": the database name must end with "_${kind}".`);
  }
}

function prisma(args: string[], url: string) {
  const r = spawnSync('pnpm', ['exec', 'prisma', ...args], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) throw new Error(`prisma ${args.join(' ')} failed`);
}

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Drops every table/enum/function in schema public that is NOT part of an extension (keeps PostGIS intact). */
const WIPE_SQL = `
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname); END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname); END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig); END LOOP;
END $$;`;

async function wipe(url: string) {
  await withClient(url, (c) => c.query(WIPE_SQL));
}

async function readSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error(
      'A password is required but no interactive terminal is available. Set ADMIN_DATABASE_URL in your local .env instead.',
    );
  const muted = new Writable({ write: (_chunk, _enc, cb) => cb() });
  process.stdout.write(question);
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((res) => {
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      res(answer);
    });
  });
}

/** Creates .env from .env.example (or fills its placeholders) with generated secrets. Never overwrites real values. */
function ensureEnvFile(appPassword: string) {
  const existed = existsSync(ENV_FILE);
  const original = readFileSync(existed ? ENV_FILE : resolve(ROOT, '.env.example'), 'utf8');
  const secret = () => randomBytes(36).toString('base64url');
  const text = original
    .replaceAll(
      'postgresql://dealdash_app:CHANGE_ME@',
      `postgresql://dealdash_app:${encodeURIComponent(appPassword)}@`,
    )
    .replace('SESSION_SECRET="CHANGE_ME_LONG_RANDOM"', `SESSION_SECRET="${secret()}"`)
    .replace(
      'FIELD_ENCRYPTION_KEY="CHANGE_ME_32_CHARS_MINIMUM_RANDOM"',
      `FIELD_ENCRYPTION_KEY="${secret()}"`,
    );
  if (existed && text === original) return false;
  writeFileSync(ENV_FILE, text, { mode: 0o600 });
  return true;
}

async function setup() {
  loadEnvFile();
  let adminUrl = process.env.ADMIN_DATABASE_URL;
  const looksUnset = !adminUrl || adminUrl.includes('CHANGE_ME');
  if (looksUnset) {
    const pw = await readSecret(
      'PostgreSQL "postgres" superuser password (typed locally, never stored): ',
    );
    adminUrl = `postgresql://postgres:${encodeURIComponent(pw)}@localhost:5432/postgres`;
  }

  // Password for the least-privilege application role: reuse the one already in .env, or generate one.
  let appPassword: string;
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('CHANGE_ME')) {
    appPassword = decodeURIComponent(new URL(process.env.DATABASE_URL).password);
  } else {
    appPassword = randomBytes(18).toString('base64url');
  }
  // In CI the environment is already complete; locally, create .env (mode 600) with generated secrets.
  const created = process.env.CI ? false : ensureEnvFile(appPassword);
  if (created) loadEnvFile();

  await withClient(adminUrl!, async (c) => {
    const version = (await c.query('SHOW server_version')).rows[0].server_version as string;
    console.log(`Connected to PostgreSQL ${version}`);

    const exists = (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE]))
      .rowCount;
    const pwLiteral = `'${appPassword.replaceAll("'", "''")}'`;
    if (!exists)
      await c.query(
        `CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${pwLiteral}`,
      );
    else
      await c.query(
        `ALTER ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${pwLiteral}`,
      );
    console.log(
      `Role ${APP_ROLE}: ${exists ? 'updated' : 'created'} (no superuser, no createdb, no createrole)`,
    );

    for (const db of [DEV_DB, TEST_DB]) {
      const has = (await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [db])).rowCount;
      if (!has) await c.query(`CREATE DATABASE ${db} OWNER ${APP_ROLE} ENCODING 'UTF8'`);
      console.log(`Database ${db}: ${has ? 'exists' : 'created'}`);
      await c.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
      await c.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${APP_ROLE}`);
    }
  });

  await enablePostgis(adminUrl!);
  console.log(
    `\nDone. ${created ? 'Created .env (never commit it).' : 'Using existing .env.'} Next: pnpm db:migrate && pnpm db:seed`,
  );
}

async function enablePostgis(adminUrl: string) {
  for (const db of [DEV_DB, TEST_DB]) {
    const u = new URL(adminUrl);
    u.pathname = `/${db}`;
    try {
      await withClient(u.toString(), async (c) => {
        const avail = (
          await c.query(
            "SELECT default_version FROM pg_available_extensions WHERE name = 'postgis'",
          )
        ).rows[0];
        if (!avail) {
          console.log(
            `PostGIS is NOT installed on this PostgreSQL server (database ${db}). Install it, then run: pnpm db:postgis`,
          );
          return;
        }
        await c.query('CREATE EXTENSION IF NOT EXISTS postgis');
        const v = (await c.query('SELECT PostGIS_Version() AS v')).rows[0].v as string;
        console.log(`PostGIS enabled in ${db}: ${v}`);
      });
    } catch (e) {
      console.log(`Could not enable PostGIS in ${db}: ${(e as Error).message}`);
    }
  }
}

async function status() {
  loadEnvFile();
  for (const [label, url] of [
    ['dev', process.env.DATABASE_URL],
    ['test', process.env.TEST_DATABASE_URL],
  ] as const) {
    if (!url) {
      console.log(`${label}: not configured`);
      continue;
    }
    try {
      await withClient(url, async (c) => {
        const v = (await c.query('SHOW server_version')).rows[0].server_version;
        const applied = await c
          .query(
            'SELECT count(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
          )
          .then(
            (r) => r.rows[0].n as number,
            () => 0,
          );
        const onDisk = readdirSync(resolve(API_DIR, 'prisma/migrations'), {
          withFileTypes: true,
        }).filter((d) => d.isDirectory()).length;
        const pg = await c.query('SELECT extversion FROM pg_extension WHERE extname = $1', [
          'postgis',
        ]);
        console.log(
          `${label}: ${redact(url)}  PostgreSQL ${v}  migrations ${applied}/${onDisk}  PostGIS ${pg.rows[0]?.extversion ?? 'not enabled'}`,
        );
      });
    } catch (e) {
      console.log(`${label}: ${redact(url)}  NOT REACHABLE (${(e as Error).message})`);
    }
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  loadEnvFile();
  switch (cmd) {
    case 'setup':
      return setup();
    case 'status':
      return status();
    case 'postgis': {
      let adminUrl = process.env.ADMIN_DATABASE_URL;
      if (!adminUrl || adminUrl.includes('CHANGE_ME')) {
        const pw = await readSecret('PostgreSQL "postgres" superuser password: ');
        adminUrl = `postgresql://postgres:${encodeURIComponent(pw)}@localhost:5432/postgres`;
      }
      return enablePostgis(adminUrl);
    }
    case 'migrate': {
      const url = arg === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL is not set. Run pnpm db:setup first.');
      return prisma(['migrate', 'deploy'], url);
    }
    case 'seed': {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
      return prisma(['db', 'seed'], process.env.DATABASE_URL);
    }
    case 'reset': {
      const kind = arg === 'test' ? 'test' : 'dev';
      const url = kind === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
      if (!url)
        throw new Error(`${kind === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set.`);
      assertSafeTarget(url, kind);
      console.log(`Resetting ${dbNameOf(url)} (all data will be deleted)...`);
      await wipe(url);
      prisma(['migrate', 'deploy'], url);
      if (kind === 'dev') prisma(['db', 'seed'], url);
      console.log(`${dbNameOf(url)} reset complete.`);
      return;
    }
    default:
      console.log(
        'Usage: tsx scripts/db.ts <setup|status|postgis|migrate [test]|seed|reset [dev|test]>',
      );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
