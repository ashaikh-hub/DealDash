import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

// Load the repo-root .env (never committed) when present. Real environment variables take precedence.
const rootEnv = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnv)) {
  try {
    process.loadEnvFile(rootEnv);
  } catch {
    /* ignore */
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // The CLI uses DATABASE_URL. Test scripts override it explicitly (see scripts/db.ts).
    url: process.env.DATABASE_URL ?? 'postgresql://dealdash_app:unset@localhost:5432/dealdash_dev',
  },
});
