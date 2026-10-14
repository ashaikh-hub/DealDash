/**
 * Launch readiness G-2 — the STAGING seed. Staging releases only run forward migrations (the migration job never seeds), so a fresh
 * staging database would hold no market data, no demo merchants and no accounts. This loads the same SYNTHETIC data as the development
 * seed (never a copy of any real database), prepares the Pakistan TESTING market through the governed services, and uploads the sample
 * images to the staging bucket (the development seed only writes them to a local folder).
 *
 * Runs once, on an EMPTY staging database, from the one-off Cloud Run job `<prefix>-seed` (infra/terraform). The shared seed password
 * and the shared authenticator key come from Secret Manager; neither is generated, printed or logged here.
 */
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
import { appEnvOf, type ApiEnv } from '@dealdash/config';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request-context';
import type { PrismaClient } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageProvider } from '../providers/interfaces';
import { seedCommercialFixtures } from './commercial-fixtures';
import { seedDev } from './dev-seed';
import { adminActor, pkMarketContext, preparePkTestingMarket } from './pk-testing-market';
import {
  seedAiFixtures,
  seedSubscriptionCatalog,
  seedSubscriptionFixtures,
} from './subscription-catalog';

export const STAGING_SEED_DONE = 'staging.seed.completed';

export interface StagingSeedSummary {
  organizations: number;
  branches: number;
  accounts: number;
  filesUploaded: number;
  pakistan: string[];
}

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
};

async function* walk(dir: string): AsyncGenerator<string> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

/**
 * Uploads every file under `dir` to object storage under its relative path (the storage key the seed recorded), through the same
 * pre-signed upload the apps use. The content type is the recorded one when known.
 */
export async function uploadSeedFiles(
  dir: string,
  storage: Pick<StorageProvider, 'createUploadUrl'>,
  mimeOf: (key: string) => Promise<string | undefined>,
  http: typeof fetch = fetch,
): Promise<number> {
  let n = 0;
  for await (const path of walk(dir)) {
    const key = relative(dir, path).split(sep).join('/');
    const data = await readFile(path);
    const contentType =
      (await mimeOf(key)) ?? MIME_BY_EXT[extname(key).toLowerCase()] ?? 'application/octet-stream';
    const up = await storage.createUploadUrl({ key, contentType, maxBytes: data.length });
    const res = await http(up.url, { method: up.method, headers: up.headers, body: data });
    if (!res.ok) throw new Error(`Uploading a seed file failed (HTTP ${res.status})`);
    n++;
  }
  return n;
}

/** Refusals checked before anything is written. Messages never contain a secret. */
export async function stagingSeedProblems(
  prisma: Pick<PrismaClient, 'user' | 'auditLog'>,
  env: Pick<ApiEnv, 'APP_ENV' | 'NODE_ENV'>,
  secrets: { password?: string; mfaSecret?: string },
): Promise<string[]> {
  const problems: string[] = [];
  if (appEnvOf(env) !== 'staging')
    problems.push('APP_ENV must be staging (this seed never runs anywhere else)');
  if (!secrets.password || secrets.password.length < 16)
    problems.push('SEED_USER_PASSWORD is required (at least 16 characters, from Secret Manager)');
  if (!secrets.mfaSecret || !/^[A-Z2-7]{32,}$/.test(secrets.mfaSecret))
    problems.push(
      'SEED_ADMIN_TOTP_SECRET is required (base32, at least 32 characters, from Secret Manager)',
    );
  if (problems.length) return problems;
  if (await prisma.auditLog.findFirst({ where: { action: STAGING_SEED_DONE } }))
    problems.push('This staging database was already seeded (the seed runs once)');
  else if ((await prisma.user.count()) > 0)
    problems.push(
      'The database already has accounts: the staging seed only runs on an empty database',
    );
  return problems;
}

export async function runStagingSeed(
  prisma: PrismaClient,
  env: ApiEnv,
  secrets: { password: string; mfaSecret: string },
  storage: Pick<StorageProvider, 'createUploadUrl'>,
  http: typeof fetch = fetch,
): Promise<StagingSeedSummary> {
  const problems = await stagingSeedProblems(prisma, env, secrets);
  if (problems.length) throw new Error(`Staging seed refused:\n - ${problems.join('\n - ')}`);

  const dir = await mkdtemp(join(tmpdir(), 'dd-staging-seed-'));
  try {
    const result = await seedDev(prisma, {
      password: secrets.password,
      fieldEncryptionKey: env.FIELD_ENCRYPTION_KEY,
      storageDir: dir,
      mfaSecret: secrets.mfaSecret,
    });
    await seedCommercialFixtures(prisma);
    await seedSubscriptionCatalog(prisma);
    await seedSubscriptionFixtures(prisma);
    await seedAiFixtures(prisma);

    // Pakistan stays TESTING (no PKR commercial value, no activation); the development-only UAT gate is NOT set in staging
    const meta: RequestMeta = {
      requestId: `staging-seed-${Date.now()}`,
      ip: null,
      userAgent: 'prisma/staging-seed.ts',
      locale: 'en',
    };
    const ctx = pkMarketContext(prisma, env);
    const pakistan = await preparePkTestingMarket(
      prisma,
      ctx,
      await adminActor(prisma, 'staging-seed'),
      meta,
    );

    const filesUploaded = await uploadSeedFiles(
      dir,
      storage,
      async (key) =>
        (await prisma.storedFile.findUnique({ where: { storageKey: key } }))?.mimeType ?? undefined,
      http,
    );

    const summary: StagingSeedSummary = {
      organizations: Object.keys(result.organizations).length,
      branches: Object.keys(result.branches).length,
      accounts: result.accounts.length,
      filesUploaded,
      pakistan,
    };
    await new AuditService(prisma as unknown as PrismaService).record({
      action: STAGING_SEED_DONE,
      entityType: 'Database',
      entityId: null,
      reason: 'Launch readiness G-2: synthetic staging data (one-off)',
      newState: summary,
      source: 'SYSTEM',
      meta,
    });
    return summary;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
