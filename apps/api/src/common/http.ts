import {
  CallHandler,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
  type ExecutionContext,
  type NestMiddleware,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { map, type Observable } from 'rxjs';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';
import { negotiateLocale } from '@dealdash/localization';
import type { ApiErrorItem } from '@dealdash/types';
import { AppError } from './errors';
import { Page } from './pagination';
import type { AppRequest } from './request-context';

/** Assigns a request id and basic metadata to every request. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: AppRequest, res: Response, next: NextFunction) {
    const incoming = req.get('x-request-id');
    const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    req.meta = {
      requestId,
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
      locale: negotiateLocale(req.get('accept-language')),
    };
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}

/** Wraps successful responses in { data, meta } and lifts pagination cursors into meta. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    return next.handle().pipe(
      map((body: unknown) => {
        const meta: Record<string, unknown> = {
          requestId: req.meta?.requestId,
          locale: req.meta?.locale,
        };
        if (body instanceof Page)
          return { data: body.items, meta: { ...meta, nextCursor: body.nextCursor } };
        return { data: body ?? null, meta };
      }),
    );
  }
}

/** Standard error shape: { errors: [{ code, message, field? }], meta } with stable codes. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<AppRequest>();
    const meta = { requestId: req.meta?.requestId, locale: req.meta?.locale };

    let status = 500;
    let errors: ApiErrorItem[] = [{ code: 'INTERNAL', message: 'An unexpected error occurred' }];

    if (exception instanceof ZodValidationException) {
      status = 400;
      const zodError = exception.getZodError() as ZodError;
      errors = zodError.issues.map((issue) => ({
        code: 'VALIDATION_FAILED',
        message: issue.message,
        field: issue.path.join('.') || undefined,
      }));
    } else if (exception instanceof AppError) {
      status = exception.getStatus();
      errors = exception.extra?.length
        ? exception.extra
        : [{ code: exception.code, message: exception.message, field: exception.field }];
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      const code =
        status === 401
          ? 'AUTH_REQUIRED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 404
              ? 'NOT_FOUND'
              : status === 429
                ? 'RATE_LIMITED'
                : status >= 500
                  ? 'INTERNAL'
                  : 'VALIDATION_FAILED';
      errors = (Array.isArray(message) ? message : [message]).map((m) => ({
        code,
        message: String(m),
      }));
    } else {
      this.logger.error(
        `Unhandled error on ${req.method} ${req.url} [${meta.requestId}]: ${exception instanceof Error ? exception.stack : String(exception)}`,
      );
    }

    res.status(status).json({ errors, meta });
  }
}
