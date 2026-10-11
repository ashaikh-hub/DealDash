import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { productionSafetyProblems } from '@dealdash/config';
import { buildOpenApiDocument, createApp } from './app.factory';
import { loadDotEnv, loadEnv } from './common/env';

async function bootstrap() {
  loadDotEnv();
  const env = loadEnv();
  // Stage 9: a production / staging process refuses to start with an unsafe configuration (names the settings, never the values)
  const problems = productionSafetyProblems(env);
  if (problems.length)
    throw new Error(
      `Refusing to start: unsafe production configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
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
