/**
 * Catalog sync (Stage 8): brings the permission catalogue, the role-permission matrix, create-only configuration defaults and the
 * reference catalogs of an EXISTING database up to date with the code, without the development seed. It never creates, changes or
 * resets a user, a password, a business or any transactional data, so it is safe after a migration on a database people use.
 *
 *   pnpm --filter @dealdash/api db:catalog:sync      (DATABASE_URL from the repo-root .env)
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { loadDotEnv, loadEnv } from '../src/common/env';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedCatalog } from '../src/seed/catalog';

async function main() {
  loadDotEnv();
  const env = loadEnv();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  try {
    const before = {
      permissions: await prisma.permission.count(),
      grants: await prisma.rolePermission.count(),
      users: await prisma.user.count(),
    };
    await seedCatalog(prisma);
    const after = {
      permissions: await prisma.permission.count(),
      grants: await prisma.rolePermission.count(),
      users: await prisma.user.count(),
    };
    console.log(
      `catalog synced: permissions ${before.permissions} -> ${after.permissions}, role grants ${before.grants} -> ${after.grants}, users unchanged (${before.users} -> ${after.users})`,
    );
    if (after.users !== before.users) throw new Error('user count changed: this must never happen');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
