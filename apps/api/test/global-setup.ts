import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

const API_DIR = resolve(__dirname, '..');
const ROOT = resolve(API_DIR, '../..');

/**
 * Prepares the TEST database once per run: wipes it (only if its name ends with "_test" on localhost) and applies
 * all migrations. If TEST_DATABASE_URL is not configured, database tests are skipped (and reported as skipped),
 * while pure unit tests still run.
 */
export default async function setup() {
  const envFile = resolve(ROOT, '.env');
  if (existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      /* ignore */
    }
  }
  const url = process.env.TEST_DATABASE_URL;
  process.env.DD_DB_READY = '0';
  if (!url || url.includes('CHANGE_ME')) {
    console.warn(
      '\n[test setup] TEST_DATABASE_URL is not set: database tests will be SKIPPED. Run `pnpm db:setup` first.\n',
    );
    return;
  }
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (!name.endsWith('_test') || !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    throw new Error(
      `Refusing to run tests against "${name}" on ${parsed.hostname}: TEST_DATABASE_URL must be a local *_test database.`,
    );
  }

  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (e) {
    console.warn(
      `\n[test setup] Cannot connect to the test database (${(e as Error).message}). Database tests will be SKIPPED.\n`,
    );
    return;
  }
  try {
    // Reset: drop everything that is not part of an extension (keeps PostGIS), then migrate.
    await client.query(`
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
END $$;`);
  } finally {
    await client.end();
  }

  const r = spawnSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
    shell: true,
    encoding: 'utf8',
  });
  if (r.status !== 0)
    throw new Error(`Migrations failed on the test database:\n${r.stdout}\n${r.stderr}`);
  process.env.DD_DB_READY = '1';
}
