import { loadDotEnv, loadEnv } from '../src/common/env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { seedDev } from '../src/seed/dev-seed';
import { seedCommercialFixtures } from '../src/seed/commercial-fixtures';
import {
  seedAiFixtures,
  seedSubscriptionCatalog,
  seedSubscriptionFixtures,
} from '../src/seed/subscription-catalog';

async function main() {
  loadDotEnv();
  const env = loadEnv();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  // Seeded business and admin accounts share ONE development password that every developer chooses locally.
  // It is never stored in the repository, never generated for you and never printed.
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 12) {
    console.error(
      [
        'SEED_USER_PASSWORD is required (at least 12 characters).',
        'Choose your own local development password and set it before seeding, for example in PowerShell:',
        '  $env:SEED_USER_PASSWORD = "<your own password>"',
        'Do not reuse a real password and do not commit it. Re-seeding resets every seeded account to this value.',
      ].join('\n'),
    );
    process.exit(1);
  }
  try {
    const result = await seedDev(prisma, {
      password,
      fieldEncryptionKey: env.FIELD_ENCRYPTION_KEY,
      storageDir: env.STORAGE_PROVIDER === 'local' ? env.STORAGE_LOCAL_DIR : undefined,
    });
    await seedCommercialFixtures(prisma);
    await seedSubscriptionCatalog(prisma);
    await seedSubscriptionFixtures(prisma);
    await seedAiFixtures(prisma);
    console.log('\nSeed complete.');
    console.log(
      `  organizations: ${Object.keys(result.organizations).length}, branches: ${Object.keys(result.branches).length}, accounts: ${result.accounts.length}`,
    );
    console.log('\n  Seeded accounts use your SEED_USER_PASSWORD (not printed).');
    console.log(
      '\n  Accounts (business users sign in with email + password; admins also use a TOTP code from GET /v1/dev/totp?email=...):',
    );
    for (const a of result.accounts) {
      console.log(
        `   - [${a.audience}] ${a.email ?? a.mobile}  role=${a.role}  org=${a.organization}${a.branch ? '  branch=' + a.branch : ''}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
