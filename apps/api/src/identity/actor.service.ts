import { Injectable } from '@nestjs/common';
import {
  MERCHANT_INACTIVE_ALLOWED,
  MERCHANT_SUSPENDED_ALLOWED,
  ROLE_PERMISSIONS,
  type Audience,
  type MembershipView,
  type PermissionCode,
  type RoleCode,
} from '@dealdash/types';
import type { Actor } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

type SessionWithUser = {
  id: string;
  audience: string;
  mfaVerified: boolean;
  activeMembershipId: string | null;
  user: {
    id: string;
    userType: Actor['userType'];
    displayName: string;
    mfaEnabled: boolean;
  };
};

const ROLE_CACHE_MS = 30_000;

/** Builds the Actor (identity + active membership + permissions) from a session. Permissions come from the database. */
@Injectable()
export class ActorService {
  private roleCache = new Map<string, { perms: Set<PermissionCode>; at: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async permissionsForRole(roleCode: RoleCode): Promise<Set<PermissionCode>> {
    const hit = this.roleCache.get(roleCode);
    if (hit && Date.now() - hit.at < ROLE_CACHE_MS) return hit.perms;
    const role = await this.prisma.role.findUnique({
      where: { code: roleCode },
      include: { permissions: { include: { permission: true } } },
    });
    // Falls back to the shared matrix only if the catalogue was never seeded (should not happen in practice).
    const perms = new Set<PermissionCode>(
      role
        ? (role.permissions.map((p) => p.permission.code) as PermissionCode[])
        : [...(ROLE_PERMISSIONS[roleCode] ?? [])],
    );
    this.roleCache.set(roleCode, { perms, at: Date.now() });
    return perms;
  }

  /**
   * A scoped member holds no organisation-wide role. The coarse permission set is the union of what its ACTIVE, in-date role
   * assignments grant somewhere; the fine-grained check (is it granted HERE?) is always made by ScopeService.
   */
  async scopedPermissions(membershipId: string): Promise<Set<PermissionCode>> {
    const now = new Date();
    const rows = await this.prisma.roleAssignment.findMany({
      where: {
        membershipId,
        status: 'ACTIVE',
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
      },
      include: { role: true },
    });
    const out = new Set<PermissionCode>();
    for (const r of rows) for (const p of await this.permissionsForRole(r.role.code as RoleCode)) out.add(p);
    return out;
  }

  clearCache() {
    this.roleCache.clear();
  }

  async loadMemberships(userId: string) {
    return this.prisma.organizationMembership.findMany({
      // Suspended MERCHANT organisations stay visible (with a minimal permission set) so the owner sees the status;
      // other organisation types lose access immediately when suspended.
      where: {
        userId,
        status: 'ACTIVE',
        OR: [
          { organization: { status: { not: 'SUSPENDED' } } },
          { organization: { type: 'MERCHANT' } },
        ],
      },
      include: { role: true, organization: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  toView(m: Awaited<ReturnType<ActorService['loadMemberships']>>[number]): MembershipView {
    return {
      organizationId: m.organizationId,
      organizationType: m.organization.type,
      organizationName: { en: m.organization.nameEn, ar: m.organization.nameAr },
      organizationStatus: m.organization.status,
      roleCode: m.role.code as RoleCode,
      branchId: m.branchId,
    };
  }

  async build(
    session: SessionWithUser,
    viaCookie: boolean,
    mfaRequiredByPolicy: boolean,
  ): Promise<Actor> {
    const { user } = session;
    const memberships = await this.loadMemberships(user.id);
    const audience = session.audience as Audience;

    // Only memberships whose organisation type fits the audience are usable in that app.
    const usable = memberships.filter((m) => {
      if (audience === 'admin') return m.organization.type === 'DEALDASH';
      if (audience === 'partner') return m.organization.type === 'PARTNER';
      if (audience === 'merchant')
        return m.organization.type === 'MERCHANT' && m.role.code !== 'MERCHANT_STAFF';
      if (audience === 'staff')
        return m.organization.type === 'MERCHANT' && m.role.code === 'MERCHANT_STAFF';
      return false;
    });
    const active = usable.find((m) => m.id === session.activeMembershipId) ?? usable[0] ?? null;

    let permissions: Set<PermissionCode>;
    if (user.userType === 'CUSTOMER') permissions = await this.permissionsForRole('CUSTOMER');
    else {
      permissions = active
        ? active.scoped
          ? await this.scopedPermissions(active.id)
          : await this.permissionsForRole(active.role.code as RoleCode)
        : new Set();
      // MR-05: a merchant that is not yet active (onboarding) or is suspended only keeps a restricted permission set.
      if (
        active &&
        active.organization.type === 'MERCHANT' &&
        active.organization.status !== 'ACTIVE'
      ) {
        const allowed = new Set<PermissionCode>(
          active.organization.status === 'SUSPENDED'
            ? MERCHANT_SUSPENDED_ALLOWED
            : MERCHANT_INACTIVE_ALLOWED,
        );
        permissions = new Set([...permissions].filter((p) => allowed.has(p)));
      }
    }

    return {
      userId: user.id,
      userType: user.userType,
      displayName: user.displayName,
      audience,
      sessionId: session.id,
      mfaVerified: session.mfaVerified,
      mfaRequired: mfaRequiredByPolicy || user.mfaEnabled,
      membership: active
        ? {
            id: active.id,
            organizationId: active.organizationId,
            organizationType: active.organization.type,
            roleCode: active.role.code as RoleCode,
            branchId: active.branchId,
            scoped: active.scoped,
          }
        : null,
      memberships: usable.map((m) => this.toView(m)),
      permissions,
      viaCookie,
    };
  }
}
