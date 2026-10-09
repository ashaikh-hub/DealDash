import type { Request } from 'express';
import type { Audience, MembershipView, PermissionCode, RoleCode, UserType } from '@dealdash/types';

/** The authenticated caller, resolved by the AuthGuard on every request. */
export interface Actor {
  userId: string;
  userType: UserType;
  displayName: string;
  audience: Audience;
  sessionId: string;
  mfaVerified: boolean;
  mfaRequired: boolean;
  /** Active membership (organisation + role + optional branch scope). Null for customers. */
  membership: {
    id: string;
    organizationId: string;
    organizationType: 'DEALDASH' | 'MERCHANT' | 'PARTNER';
    roleCode: RoleCode;
    branchId: string | null;
    /** Scoped member: permissions come only from role assignments, each with its own scope (see ScopeService). */
    scoped: boolean;
  } | null;
  memberships: MembershipView[];
  permissions: ReadonlySet<PermissionCode>;
  viaCookie: boolean;
}

export interface RequestMeta {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  locale: 'en' | 'ar';
}

export type AppRequest = Request & { actor?: Actor; meta?: RequestMeta };

export function metaFromRequest(req: AppRequest): RequestMeta {
  return (
    req.meta ?? {
      requestId: 'unknown',
      ip: req.ip ?? null,
      userAgent: req.get?.('user-agent') ?? null,
      locale: 'en',
    }
  );
}
