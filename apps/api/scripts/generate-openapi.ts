import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import 'reflect-metadata';
import { buildOpenApiDocument, createApp } from '../src/app.factory';
import { loadEnv } from '../src/common/env';

/** Builds the OpenAPI contract without a database connection and writes it for the typed client generator. */
async function main() {
  process.env.DD_SKIP_DB_CONNECT = '1';
  // The document needs the module graph but never queries the database; a syntactically valid URL is enough.
  const env = loadEnv({
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://openapi:openapi@localhost:5432/openapi',
    SESSION_SECRET: process.env.SESSION_SECRET ?? 'openapi-generation-only-secret',
    FIELD_ENCRYPTION_KEY:
      process.env.FIELD_ENCRYPTION_KEY ?? 'openapi-generation-only-key-0000000000',
    NODE_ENV: 'test',
  });
  const app = await createApp(env, { logger: false });
  await app.init();
  const doc = buildOpenApiDocument(app, env);
  const out = resolve(__dirname, '../../../packages/api-client/openapi.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  console.log(`OpenAPI written to ${out} (${Object.keys(doc.paths).length} paths)`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
