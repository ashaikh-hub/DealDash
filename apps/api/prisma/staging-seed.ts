/**
 * Launch readiness G-2 — one-off STAGING seed (synthetic data). Run by the Cloud Run job `<prefix>-seed` (infra/terraform), started with
 * `node tooling/deploy/seed-gcp.mjs` after the first release. Never reads a .env file: every setting comes from the job, and the process
 * refuses unless it is a complete, safe staging configuration (production boot check) on an empty database.
 *
 *   node_modules/.bin/tsx prisma/staging-seed.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { appEnvOf, productionSafetyProblems } from '@dealdash/config';
import { loadEnv } from '../src/common/env';
import { PrismaClient } from '../src/generated/prisma/client';
import { S3StorageProvider } from '../src/providers/s3-storage';
import { runStagingSeed } from '../src/seed/staging-seed';

async function main() {
  const env = loadEnv();
  const problems = [
    ...(env.NODE_ENV !== 'production' || appEnvOf(env) !== 'staging'
      ? ['NODE_ENV=production and APP_ENV=staging are required']
      : []),
    ...(env.STORAGE_PROVIDER !== 's3' ? ['STORAGE_PROVIDER=s3 is required'] : []),
    ...productionSafetyProblems(env),
  ];
  if (problems.length) throw new Error(`Staging seed refused:\n - ${problems.join('\n - ')}`);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  const storage = new S3StorageProvider({
    endpoint: env.S3_ENDPOINT ?? '',
    bucket: env.S3_BUCKET ?? '',
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    pathStyle: env.S3_PATH_STYLE,
  });
  try {
    const summary = await runStagingSeed(
      prisma,
      env,
      {
        password: process.env.SEED_USER_PASSWORD ?? '',
        mfaSecret: process.env.SEED_ADMIN_TOTP_SECRET ?? '',
      },
      storage,
    );
    // counts only: no credential, no personal data
    console.log(JSON.stringify({ stagingSeed: 'complete', ...summary }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
