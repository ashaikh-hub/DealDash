import { VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { ApiEnv } from '@dealdash/config';
import { AppModule } from './app.module';

export async function createApp(
  env: ApiEnv,
  opts: { logger?: boolean } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(env), {
    logger: opts.logger === false ? false : ['log', 'warn', 'error'],
    // the payment webhook verifies the provider's signature over the exact bytes it received
    rawBody: true,
  });

  app.use(helmet());
  app.use(cookieParser());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept-Language',
      'Idempotency-Key',
      'X-CSRF-Token',
      'X-Request-Id',
      'X-Client-Version',
      // Watch & Earn: the viewing-session token sent by the player
      'X-View-Token',
    ],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replay'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApiDocument(app: INestApplication, env: ApiEnv): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('DealDash API')
    .setDescription(
      'DealDash MVP API (Stage 1 foundation). Responses are wrapped as { data, meta }; errors as { errors, meta }.',
    )
    .setVersion('1.0')
    .addServer(env.API_PUBLIC_URL)
    .addCookieAuth('dd_session', { type: 'apiKey', in: 'cookie', name: 'dd_session' }, 'cookie')
    .addBearerAuth()
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}
