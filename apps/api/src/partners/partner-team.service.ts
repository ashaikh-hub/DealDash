import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@dealdash/config';
import type { RoleCode } from '@dealdash/types';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../common/crypto';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../providers/interfaces';
import { EntitlementService } from '../platform/entitlement.service';
import { ScopeService } from '../platform/scope.service';
import { UsageService } from '../subscription/usage.service';
import { PartnerAccessService } from './partner-access.service';

/**
 * Partner users. Invitations, the membership and its role are the shared identity records (the same Invitation / membership model
 * merchants use). Market, legal-entity, product and campaign scope is the shared scoped role assignment (`/orgs/:orgId/assignments`).
 * A delegated administrator can never grant a role holding a permission it does not hold itself (ScopeService.assertCanDelegate).
 */
@Injectable()
export class PartnerTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: PartnerAccessService,
    private readonly scope: ScopeService,
    private readonly entitlements: EntitlementService,
    private readonly usage: UsageService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  private async guard(actor: Actor, organizationId: string) {
    const p = await this.access.requirePartner(actor, organizationId);
    await this.access.requireOrgWide(actor, 'partner.users.manage');
    return p;
  }

  private async assertCanGrant(actor: Actor, roleCode: string) {
    if (!roleCode.startsWith('PARTNER_'))
      throw AppError.validation('Choose a partner role', 'roleCode');
    await this.scope
      .assertCanDelegate(
        actor,
        'partner.users.manage',
        roleCode as RoleCode,
        { kind: 'ORGANIZATION', ref: null, product: null, envelope: null } as never,
      )
      .catch((e: unknown) => {
        if ((e as { code?: string }).code === 'SCOPE_FORBIDDEN')
          throw new AppError(
            'DELEGATION_EXCEEDED',
            'You cannot grant more access than you hold',
            403,
          );
        throw e;
      });
  }

  async list(actor: Actor, organizationId: string) {
    await this.guard(actor, organizationId);
    const [members, invitations, assignments] = await Promise.all([
      this.prisma.organizationMembership.findMany({
        where: { organizationId },
        include: { user: true, role: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.invitation.findMany({
        where: { organizationId, status: { in: ['PENDING', 'EXPIRED'] } },
        include: { role: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.roleAssignment.findMany({
        where: { organizationId, status: 'ACTIVE' },
        select: { membershipId: true },
      }),
    ]);
    const scopedCount = new Map<string, number>();
    for (const a of assignments)
      scopedCount.set(a.membershipId, (scopedCount.get(a.membershipId) ?? 0) + 1);
    return {
      users: members.map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        name: m.user.displayName,
        email: m.user.email,
        roleCode: m.role.code,
        scoped: m.scoped,
        assignments: scopedCount.get(m.id) ?? 0,
        status: m.status === 'ACTIVE' ? 'ACTIVE' : 'DEACTIVATED',
        lastActiveAt: m.user.lastLoginAt?.toISOString() ?? null,
        isMe: m.userId === actor.userId,
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        name: i.name,
        email: i.email,
        roleCode: i.role.code,
        status: i.status === 'PENDING' && i.expiresAt < new Date() ? 'EXPIRED' : i.status,
        expiresAt: i.expiresAt.toISOString(),
      })),
    };
  }

  async invite(
    actor: Actor,
    organizationId: string,
    b: { name: string; email: string; roleCode: string },
    meta: RequestMeta,
  ) {
    const p = await this.guard(actor, organizationId);
    if (p.lifecycle === 'REJECTED')
      throw new AppError('PARTNER_NOT_ACTIVE', 'This partner account is closed', 409);
    await this.assertCanGrant(actor, b.roleCode);
    await this.entitlements.requireNewExposure(organizationId, 'ADD_USER');
    await this.usage.assertResourceWithin(organizationId, 'users.max');
    if (await this.prisma.user.findUnique({ where: { email: b.email } }))
      throw AppError.conflict('EMAIL_TAKEN', 'This email is already registered');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: b.roleCode } });
    const ttl = (await this.access.settings()).inviteTtlHours ?? 72;
    const token = randomToken(24);
    const inv = await this.prisma.$transaction(async (tx) => {
      await tx.invitation.updateMany({
        where: { organizationId, status: 'PENDING', email: b.email },
        data: { status: 'REVOKED' },
      });
      const created = await tx.invitation.create({
        data: {
          organizationId,
          name: b.name,
          email: b.email,
          roleId: role.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + ttl * 3600_000),
          invitedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'partner.user.invited',
          entityType: 'Invitation',
          entityId: created.id,
          reason: b.roleCode,
          newState: { role: b.roleCode },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
      return created;
    });
    await this.email.send({
      to: b.email,
      templateKey: 'partner.invite',
      locale: meta.locale,
      subject: `You are invited to ${p.nameEn} on DealDash for Partners`,
      body: `Accept your invitation: ${this.env.PARTNER_APP_URL}/${meta.locale}/accept-invite?token=${token}`,
    });
    return {
      id: inv.id,
      name: inv.name,
      email: inv.email,
      roleCode: b.roleCode,
      status: 'PENDING',
      expiresAt: inv.expiresAt.toISOString(),
    };
  }

  async revokeInvitation(actor: Actor, organizationId: string, id: string, meta: RequestMeta) {
    await this.guard(actor, organizationId);
    const inv = await this.prisma.invitation.findFirst({
      where: { id, organizationId, status: 'PENDING' },
    });
    if (!inv) throw AppError.notFound();
    await this.prisma.invitation.update({ where: { id }, data: { status: 'REVOKED' } });
    await this.audit.record({
      action: 'partner.user.invitation_revoked',
      entityType: 'Invitation',
      entityId: id,
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.list(actor, organizationId);
  }

  private async target(actor: Actor, organizationId: string, membershipId: string) {
    await this.guard(actor, organizationId);
    const m = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId },
      include: { role: true },
    });
    if (!m) throw AppError.notFound();
    if (m.userId === actor.userId) throw AppError.forbidden('You cannot change your own access');
    // a delegated administrator can only manage people whose role it could have granted
    await this.assertCanGrant(actor, m.role.code);
    return m;
  }

  private async activeAdmins(organizationId: string) {
    return this.prisma.organizationMembership.count({
      where: { organizationId, status: 'ACTIVE', scoped: false, role: { code: 'PARTNER_ADMIN' } },
    });
  }

  async changeRole(
    actor: Actor,
    organizationId: string,
    membershipId: string,
    roleCode: string,
    meta: RequestMeta,
  ) {
    const m = await this.target(actor, organizationId, membershipId);
    await this.assertCanGrant(actor, roleCode);
    if (
      m.role.code === 'PARTNER_ADMIN' &&
      roleCode !== 'PARTNER_ADMIN' &&
      (await this.activeAdmins(organizationId)) <= 1
    )
      throw new AppError('LAST_OWNER', 'There must be at least one partner administrator', 409);
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    await this.prisma.organizationMembership.update({
      where: { id: m.id },
      data: { roleId: role.id },
    });
    this.scope.invalidate(organizationId);
    await this.audit.record({
      action: 'partner.user.role_changed',
      entityType: 'OrganizationMembership',
      entityId: m.id,
      previousState: { role: m.role.code },
      newState: { role: roleCode },
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.list(actor, organizationId);
  }

  async setActive(
    actor: Actor,
    organizationId: string,
    membershipId: string,
    active: boolean,
    reason: string,
    meta: RequestMeta,
  ) {
    const m = await this.target(actor, organizationId, membershipId);
    if (active === (m.status === 'ACTIVE')) return this.list(actor, organizationId);
    if (
      !active &&
      m.role.code === 'PARTNER_ADMIN' &&
      !m.scoped &&
      (await this.activeAdmins(organizationId)) <= 1
    )
      throw new AppError('LAST_OWNER', 'There must be at least one partner administrator', 409);
    if (active) {
      await this.entitlements.requireNewExposure(organizationId, 'ADD_USER');
      await this.usage.assertResourceWithin(organizationId, 'users.max');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.update({
        where: { id: m.id },
        data: active
          ? { status: 'ACTIVE', revokedAt: null }
          : { status: 'REVOKED', revokedAt: new Date() },
      });
      if (!active)
        await tx.userSession.updateMany({
          where: { userId: m.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await this.audit.record(
        {
          action: active ? 'partner.user.reactivated' : 'partner.user.deactivated',
          entityType: 'OrganizationMembership',
          entityId: m.id,
          reason,
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    this.scope.invalidate(organizationId);
    return this.list(actor, organizationId);
  }
}
