import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(__dirname, '../prisma/migrations');
const migrations = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const sql = (name: string) => readFileSync(join(dir, name, 'migration.sql'), 'utf8');

describe('migration files (static checks; database-level checks run in the e2e suite)', () => {
  it('are timestamp-ordered with a provider lock file', () => {
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    for (const m of migrations) expect(m).toMatch(/^\d{14}_[a-z0-9_]+$/);
    expect(readFileSync(join(dir, 'migration_lock.toml'), 'utf8')).toContain(
      'provider = "postgresql"',
    );
  });

  it('enable PostGIS before any geography column is created', () => {
    const init = sql(migrations[0]!);
    expect(init.indexOf('CREATE EXTENSION IF NOT EXISTS postgis')).toBeGreaterThanOrEqual(0);
    expect(init.indexOf('CREATE EXTENSION IF NOT EXISTS postgis')).toBeLessThan(
      init.indexOf('geography(Point,4326)'),
    );
    expect(init).toContain('USING GIST');
  });

  it('make the audit log append-only and derive branch geography by trigger', () => {
    const all = migrations.map(sql).join('\n');
    expect(all).toMatch(/AuditLog_no_update_delete/);
    expect(all).toMatch(/AuditLog_no_truncate/);
    expect(all).toMatch(/MerchantBranch_sync_location/);
  });

  it('never contain credentials or hard-coded passwords', () => {
    const all = migrations.map(sql).join('\n').toLowerCase();
    expect(all).not.toMatch(/password\s*['"=]/);
    expect(all).not.toMatch(/postgresql:\/\//);
  });
});
