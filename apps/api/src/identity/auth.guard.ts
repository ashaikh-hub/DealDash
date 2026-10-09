import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CONFIG_KEYS } from '@dealdash/config';
import { AUDIENCES, AUDIENCE_DEFINITIONS, type Audience } from '@dealdash/types';
import { AuditService } from '../audit/audit.service';
import { ALLOW_PRE_MFA, AUDIENCES_KEY, IS_PUBLIC, PERMISSIONS_KEY, SCOPE_AWARE } from '../common/decorators';
import { safeEqual } from '../common/crypto';
import { ScopeService } from '../platform/scope.service';
import { AppError } from '../common/errors';
import { metaFromRequest, type AppRequest } from '../common/request-context';
import { SystemConfigService } from '../system-config/system-config.service';
import { ActorService } from './actor.service';
import { SessionService } from './session.service';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(req: AppRequest, name: string): string | undefined {
  const cookies = (req as AppRequest & { cookies?: Record<string, string> }).cookies;
  return cookies?.[name];
}

/**
 * Global guard: resolves the session into an Actor, enforces audience, admin MFA and CSRF (cookie sessions).
 * Permission checks happen in PermissionsGuard; tenant checks in TenantService (inside handlers).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly actors: ActorService,
    private readonly config: SystemConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const audiences = this.reflector.getAllAndOverride<Audience[]>(AUDIENCES_KEY, targets) ?? [
      ...AUDIENCES,
    ];
    const allowPreMfa = this.reflector.getAllAndOverride<boolean>(ALLOW_PRE_MFA, targets) ?? false;

    // Locate a token: Authorization bearer first (native clients), then the audience cookies (web apps).
    let token: string | undefined;
    let viaCookie = false;
    const header = req.get('authorization');
    if (header?.toLowerCase().startsWith('bearer ')) token = header.slice(7).trim();
    else {
      for (const aud of audiences) {
        const value = readCookie(req, AUDIENCE_DEFINITIONS[aud].cookieName);
        if (value) {
          token = value;
          viaCookie = true;
          break;
        }
      }
    }

    if (!token) {
      if (isPublic) return true;
      throw AppError.authRequired();
    }

    const session = await this.sessions.resolve(token);
    if (!session) {
      if (isPublic) return true;
      throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.', 401);
    }
    if (!audiences.includes(session.audience as Audience)) {
      if (isPublic) return true;
      throw AppError.forbidden('This session cannot be used for this application');
    }

    const mfaPolicy =
      session.audience === 'admin'
        ? await this.config.getBoolean(CONFIG_KEYS.ADMIN_MFA_REQUIRED, true)
        : false;
    const actor = await this.actors.build(session, viaCookie, mfaPolicy);

    if (!isPublic) {
      if (actor.mfaRequired && !actor.mfaVerified && !allowPreMfa) {
        throw new AppError('MFA_REQUIRED', 'Two-step verification is required', 401);
      }
      if (viaCookie && UNSAFE.has(req.method)) {
        const sent = req.get('x-csrf-token') ?? '';
        if (!sent || !safeEqual(sent, this.sessions.csrfFor(session.id))) {
          throw AppError.forbidden('Missing or invalid CSRF token');
        }
      }
    }

    req.actor = actor;
    return true;
  }
}

/** Enforces @RequirePermissions at the backend for every request (never rely on UI hiding). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets) ?? [];
    if (required.length === 0) return true;

    const actor = req.actor;
    if (!actor) throw AppError.authRequired();

    const missing = required.filter((p) => !actor.permissions.has(p as never));
    if (missing.length === 0) {
      // A scoped member's coarse permissions are the union of their assignments. Unless the route checks scope itself, each
      // required permission must be held for the WHOLE organization (deny by default).
      const m = actor.membership;
      if (m?.scoped && !this.reflector.getAllAndOverride<boolean>(SCOPE_AWARE, targets)) {
        for (const p of required) {
          if (await this.scope.can(actor, p as never, { organizationId: m.organizationId })) continue;
          await this.audit.record({
            action: 'access.denied',
            entityType: 'Route',
            entityId: `${req.method} ${req.route?.path ?? req.path}`,
            reason: `Scope: ${p} is not held organization-wide`,
            actor,
            meta: metaFromRequest(req),
          });
          throw new AppError('SCOPE_FORBIDDEN', 'You do not have access to this part of the organization', 403);
        }
      }
      return true;
    }

    await this.audit.record({
      action: 'access.denied',
      entityType: 'Route',
      entityId: `${req.method} ${req.route?.path ?? req.path}`,
      reason: `Missing permission(s): ${missing.join(', ')}`,
      actor,
      meta: metaFromRequest(req),
    });
    throw AppError.forbidden();
  }
}
