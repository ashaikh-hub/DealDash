import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Audience, PermissionCode } from '@dealdash/types';
import { metaFromRequest, type Actor, type AppRequest, type RequestMeta } from './request-context';

export const IS_PUBLIC = 'dd:public';
export const AUDIENCES_KEY = 'dd:audiences';
export const PERMISSIONS_KEY = 'dd:permissions';
export const ALLOW_PRE_MFA = 'dd:allow_pre_mfa';
export const IDEMPOTENT = 'dd:idempotent';
export const SCOPE_AWARE = 'dd:scope_aware';

/** No authentication required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Which app audiences may call this route (session audience must match). */
export const Audiences = (...audiences: Audience[]) => SetMetadata(AUDIENCES_KEY, audiences);

/** All listed permissions are required. Enforced by the backend for every call. */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Allows a session that has not completed MFA yet (for the MFA endpoints themselves). */
export const AllowPreMfa = () => SetMetadata(ALLOW_PRE_MFA, true);

/**
 * Marks a route whose service enforces scope itself (per branch / campaign / organization level, through AccessScopeService or
 * ScopeService). Every other route used by a scoped member is held to the SAFE default: the member must hold each required
 * permission organization-wide. A route can therefore never leak a partial-scope member's data by forgetting to check.
 */
export const ScopeAware = () => SetMetadata(SCOPE_AWARE, true);

/** Requires the Idempotency-Key header; replays the stored response for the same key and body. */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<AppRequest>();
  if (!req.actor) throw new Error('CurrentActor used on a route without authentication');
  return req.actor;
});

export const OptionalActor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Actor | undefined => {
    return ctx.switchToHttp().getRequest<AppRequest>().actor;
  },
);

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  return metaFromRequest(ctx.switchToHttp().getRequest<AppRequest>());
});
