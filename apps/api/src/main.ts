import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { buildOpenApiDocument, createApp } from './app.factory';
import { loadDotEnv, loadEnv } from './common/env';

async function bootstrap() {
  loadDotEnv();
  const env = loadEnv();
  const app = await createApp(env);
  const document = buildOpenApiDocument(app, env);
  if (env.NODE_ENV !== 'production') SwaggerModule.setup('docs', app, document);
  await app.listen(env.API_PORT);
  Logger.log(
    `DealDash API listening on ${env.API_PUBLIC_URL} (docs: ${env.API_PUBLIC_URL}/docs)`,
    'Bootstrap',
  );
}

bootstrap().catch((e) => {
  // Show a clear message (validation errors never include secrets).
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
