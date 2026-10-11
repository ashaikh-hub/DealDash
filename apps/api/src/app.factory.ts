import { VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { ApiEnv } from '@dealdash/config';
import { AppModule } from './app.module';
import { JsonLogger, accessLog } from './common/logger';
import { rateLimiter } from './common/rate-limit';

export async function createApp(
  env: ApiEnv,
  opts: { logger?: boolean } = {},
): Promise<INestApplication> {
  const json = env.LOG_FORMAT === 'json' ? new JsonLogger() : null;
  const app = await NestFactory.create(AppModule.forRoot(env), {
    logger: opts.logger === false ? false : (json ?? ['log', 'warn', 'error']),
    // the payment webhook verifies the provider's signature over the exact bytes it received
    rawBody: true,
  });

  // Stage 9: real client IPs behind the reverse proxy / load balancer (rate limits and audit), only for the configured hops
  if (env.TRUST_PROXY_HOPS > 0)
    (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
      'trust proxy',
      env.TRUST_PROXY_HOPS,
    );
  app.use(
    helmet({
      // the API serves JSON only: nothing may frame it, and browsers must keep to HTTPS once seen (production behind TLS)
      frameguard: { action: 'deny' },
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  if (json && opts.logger !== false) app.use(accessLog(json));
  if (env.RATE_LIMIT_PER_MINUTE > 0 || env.AUTH_RATE_LIMIT_PER_MINUTE > 0)
    app.use(
      rateLimiter({
        perMinute: env.RATE_LIMIT_PER_MINUTE,
        authPerMinute: env.AUTH_RATE_LIMIT_PER_MINUTE,
      }),
    );
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
