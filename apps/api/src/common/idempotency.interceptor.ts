import { CallHandler, Injectable, NestInterceptor, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { catchError, from, mergeMap, of, tap, throwError, type Observable } from 'rxjs';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sha256 } from './crypto';
import { IDEMPOTENT } from './decorators';
import { AppError } from './errors';
import type { AppRequest } from './request-context';

const TTL_MS = 24 * 3600_000;

/**
 * Idempotency pattern for commands: same key + same body replays the stored result; same key with a
 * different body is rejected. Mark routes with @Idempotent().
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return next.handle();

    const req = context.switchToHttp().getRequest<AppRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const key = req.get('idempotency-key');
    if (!key || key.length < 8 || key.length > 100) {
      throw AppError.validation(
        'The Idempotency-Key header (8 to 100 characters) is required',
        'Idempotency-Key',
      );
    }
    const scope = req.actor?.userId ?? 'anonymous';
    const requestHash = sha256(`${req.method} ${req.path} ${JSON.stringify(req.body ?? {})}`);

    return from(this.claim(scope, key, req, requestHash)).pipe(
      mergeMap((claim) => {
        if (claim.replay) {
          res.setHeader('Idempotent-Replay', 'true');
          return of(claim.body);
        }
        return next.handle().pipe(
          tap({
            next: (body) => {
              void this.prisma.idempotencyKey
                .update({
                  where: { scope_key: { scope, key } },
                  data: {
                    responseStatus: 200,
                    responseBody: (body ?? null) as Prisma.InputJsonValue,
                  },
                })
                .catch(() => undefined);
            },
          }),
          catchError((err: unknown) =>
            // A failed command must be retryable with the same key.
            from(this.prisma.idempotencyKey.deleteMany({ where: { scope, key } })).pipe(
              mergeMap(() => throwError(() => err)),
            ),
          ),
        );
      }),
    );
  }

  private async claim(scope: string, key: string, req: AppRequest, requestHash: string) {
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          scope,
          key,
          method: req.method,
          path: req.path,
          requestHash,
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
      return { replay: false as const };
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      const existing = await this.prisma.idempotencyKey.findUnique({
        where: { scope_key: { scope, key } },
      });
      if (!existing) return { replay: false as const };
      if (existing.requestHash !== requestHash) {
        throw AppError.conflict(
          'IDEMPOTENCY_CONFLICT',
          'This Idempotency-Key was already used with a different request',
        );
      }
      if (existing.responseStatus === null) {
        throw AppError.conflict(
          'IDEMPOTENCY_CONFLICT',
          'A request with this Idempotency-Key is still being processed',
        );
      }
      return { replay: true as const, body: existing.responseBody };
    }
  }
}
