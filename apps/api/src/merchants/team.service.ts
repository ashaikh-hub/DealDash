import { Inject, Injectable } from '@nestjs/common';
import { CONFIG_KEYS, type ApiEnv } from '@dealdash/config';
import type {
  invitationAcceptSchema,
  roleChangeSchema,
  teamInviteSchema,
} from '@dealdash/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { hashPassword, randomToken, sha256 } from '../common/crypto';
import { APP_ENV } from '../common/env';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { AccessScopeService } from '../platform/access-scope.service';
import { EntitlementService } from '../platform/entitlement.service';
import { UsageService } from '../subscription/usage.service';
import { TenantService } from '../identity/tenant.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  EMAIL_PROVIDER,
  SMS_PROVIDER,
  type EmailProvider,
  type SmsProvider,
} from '../providers/interfaces';
import { SystemConfigService } from '../system-config/system-config.service';

/** Merchant users and staff. Owner-only for the OWNER role; the last active owner can never be removed. */
@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantService,
    private readonly audit: AuditService,
    private readonly access: AccessScopeService,
    private readonly entitlements: EntitlementService,
    private readonly usage: UsageService,
    private readonly config: SystemConfigService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  async list(actor: Actor, organizationId: string) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    await this.access.org(actor, 'merchant.users.manage');
    const [memberships, invitations] = await Promise.all([
      this.prisma.organizationMembership.findMany({
        where: { organizationId },
        include: { user: true, role: true, branch: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.invitation.findMany({
        where: { organizationId, status: { in: ['PENDING', 'EXPIRED'] } },
        include: { role: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      users: memberships.map((m) => ({
        membershipId: m.id,
        userId: m.userId,
        name: m.user.displayName,
        email: m.user.email,
        mobile: m.user.mobile,
        roleCode: m.role.code as never,
        branchId: m.branchId,
        branchName: m.branch?.nameEn ?? null,
        status: (m.status === 'ACTIVE' ? 'ACTIVE' : 'DEACTIVATED') as 'ACTIVE' | 'DEACTIVATED',
        lastActiveAt: m.user.lastLoginAt?.toISOString() ?? null,
      })),
      invitations: invitations.map((i) => ({
        id: i.id,
        name: i.name,
        email: i.email,
        mobile: i.mobile,
        roleCode: i.role.code as never,
        branchId: i.branchId,
        status: (i.status === 'PENDING' && i.expiresAt < new Date()
          ? 'EXPIRED'
          : i.status) as never,
        expiresAt: i.expiresAt.toISOString(),
      })),
    };
  }

  private async requireBranch(organizationId: string, branchId: string) {
    const b = await this.prisma.merchantBranch.findFirst({
      where: { id: branchId, organizationId, status: 'ACTIVE' },
    });
    if (!b) throw AppError.validation('Choose an active branch of your business', 'branchId');
    return b;
  }

  async invite(
    actor: Actor,
    organizationId: string,
    dto: z.infer<typeof teamInviteSchema>,
    meta: RequestMeta,
  ) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
    await this.access.org(actor, 'merchant.users.manage');
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    if (org.status !== 'ACTIVE')
      throw new AppError(
        'ORG_NOT_ACTIVE',
        'Team invitations are available after your account is approved',
        409,
      );
    if (dto.branchId) await this.requireBranch(organizationId, dto.branchId);
    // the plan's user limit counts active members and pending invitations; a suspended or ended agreement takes on no new users
    await this.entitlements.requireNewExposure(organizationId, 'ADD_USER');
    await this.usage.assertResourceWithin(organizationId, 'users.max');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: dto.roleCode } });
    if (dto.email && (await this.prisma.user.findUnique({ where: { email: dto.email } })))
      throw AppError.conflict('EMAIL_TAKEN', 'This email is already registered');
    if (dto.mobile && (await this.prisma.user.findUnique({ where: { mobile: dto.mobile } })))
      throw AppError.conflict('EMAIL_TAKEN', 'This mobile number is already registered');

    const ttl = await this.config.getNumber(CONFIG_KEYS.MERCHANT_INVITE_TTL_HOURS, 72);
    const token = randomToken(24);
    const inv = await this.prisma.$transaction(async (tx) => {
      // Re-inviting the same contact replaces the earlier pending invitation.
      await tx.invitation.updateMany({
        where: {
          organizationId,
          status: 'PENDING',
          OR: [
            ...(dto.email ? [{ email: dto.email }] : []),
            ...(dto.mobile ? [{ mobile: dto.mobile }] : []),
          ],
        },
        data: { status: 'REVOKED' },
      });
      const created = await tx.invitation.create({
        data: {
          organizationId,
          name: dto.name,
          email: dto.email ?? null,
          mobile: dto.mobile ?? null,
          roleId: role.id,
          branchId: dto.branchId ?? null,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + ttl * 3600_000),
          invitedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'merchant.user.invited',
          entityType: 'Invitation',
          entityId: created.id,
          reason: dto.roleCode,
          newState: { role: dto.roleCode, branchId: dto.branchId ?? null },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
      return created;
    });
    const link = `${this.env.MERCHANT_APP_URL}/${meta.locale}/accept-invite?token=${token}`;
    if (dto.email) {
      await this.email.send({
        to: dto.email,
        templateKey: 'merchant.invite',
        locale: meta.locale,
        subject: `You are invited to ${org.nameEn} on DealDash`,
        body: `Accept your invitation: ${link}`,
      });
    } else if (dto.mobile) {
      await this.sms.send({
        to: dto.mobile,
        templateKey: 'merchant.invite',
        locale: meta.locale,
        body: `You are invited to ${org.nameEn} on DealDash for Business. Accept: ${link}`,
      });
    }
    return {
      id: inv.id,
      name: inv.name,
      email: inv.email,
      mobile: inv.mobile,
      roleCode: dto.roleCode,
      branchId: inv.branchId,
      status: 'PENDING' as const,
      expiresAt: inv.expiresAt.toISOString(),
    };
  }

  async revokeInvitation(
    actor: Actor,
    organizationId: string,
    invitationId: string,
    meta: RequestMeta,
  ) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    await this.access.org(actor, 'merchant.users.manage');
    const inv = await this.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId, status: 'PENDING' },
    });
    if (!inv) throw AppError.notFound();
    await this.prisma.invitation.update({ where: { id: inv.id }, data: { status: 'REVOKED' } });
    await this.audit.record({
      action: 'merchant.user.invitation_revoked',
      entityType: 'Invitation',
      entityId: inv.id,
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.list(actor, organizationId);
  }

  async preview(token: string) {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { role: true },
    });
    if (!inv || inv.status !== 'PENDING' || inv.expiresAt < new Date())
      throw new AppError(
        'INVALID_STATE',
        'This invitation is no longer valid. Ask your administrator to send a new one.',
        410,
      );
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: inv.organizationId },
    });
    return {
      name: inv.name,
      organizationName: org.nameEn,
      roleCode: inv.role.code,
      signInWith: inv.role.code === 'MERCHANT_STAFF' ? ('MOBILE' as const) : ('EMAIL' as const),
    };
  }

  /** Public: the invitee accepts with the emailed/SMS link token. Creates the account and the membership. */
  async accept(
    token: string,
    dto: z.infer<typeof invitationAcceptSchema> | null,
    meta: RequestMeta,
  ) {
    const inv = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { role: true },
    });
    if (!inv || inv.status !== 'PENDING' || inv.expiresAt < new Date())
      throw new AppError(
        'INVALID_STATE',
        'This invitation is no longer valid. Ask your administrator to send a new one.',
        410,
      );
    const isStaff = inv.role.code === 'MERCHANT_STAFF';
    if (!isStaff && !dto) throw AppError.validation('Choose a password', 'password');
    if (inv.email && (await this.prisma.user.findUnique({ where: { email: inv.email } })))
      throw AppError.conflict('EMAIL_TAKEN', 'This email is already registered');
    if (inv.mobile && (await this.prisma.user.findUnique({ where: { mobile: inv.mobile } })))
      throw AppError.conflict('EMAIL_TAKEN', 'This mobile number is already registered');
    const passwordHash = !isStaff && dto ? await hashPassword(dto.password) : null;
    // Stage 7: partner invitations use the same invitation record; the account is a partner user
    const orgType = (
      await this.prisma.organization.findUniqueOrThrow({
        where: { id: inv.organizationId },
        select: { type: true },
      })
    ).type;
    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          userType: orgType === 'PARTNER' ? 'PARTNER_USER' : 'MERCHANT_USER',
          status: 'ACTIVE',
          displayName: inv.name,
          email: inv.email,
          mobile: inv.mobile,
          passwordHash,
          locale: meta.locale,
          emailVerifiedAt: inv.email ? new Date() : null,
          mobileVerifiedAt: inv.mobile ? new Date() : null,
        },
      });
      await tx.organizationMembership.create({
        data: {
          userId: u.id,
          organizationId: inv.organizationId,
          roleId: inv.roleId,
          branchId: inv.branchId,
        },
      });
      await tx.invitation.update({
        where: { id: inv.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), createdUserId: u.id, tokenHash: null },
      });
      await this.audit.record(
        {
          action: 'merchant.user.joined',
          entityType: 'User',
          entityId: u.id,
          reason: inv.role.code,
          actorUserId: u.id,
          actorOrganizationId: inv.organizationId,
          actorRole: inv.role.code,
          subjectOrganizationId: inv.organizationId,
          meta,
        },
        tx,
      );
      return u;
    });
    return {
      userId: user.id,
      role: inv.role.code,
      signInWith: isStaff ? ('MOBILE' as const) : ('EMAIL' as const),
    };
  }

  private async activeOwners(organizationId: string) {
    return this.prisma.organizationMembership.count({
      where: { organizationId, status: 'ACTIVE', role: { code: 'MERCHANT_OWNER' } },
    });
  }

  private async target(actor: Actor, organizationId: string, membershipId: string) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
    await this.access.org(actor, 'merchant.users.manage');
    const m = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId },
      include: { role: true, user: true },
    });
    if (!m) throw AppError.notFound();
    return m;
  }

  async changeRole(
    actor: Actor,
    organizationId: string,
    membershipId: string,
    dto: z.infer<typeof roleChangeSchema>,
    meta: RequestMeta,
  ) {
    const m = await this.target(actor, organizationId, membershipId);
    if (
      actor.membership?.roleCode !== 'MERCHANT_OWNER' &&
      (dto.roleCode === 'MERCHANT_OWNER' || m.role.code === 'MERCHANT_OWNER')
    ) {
      throw AppError.forbidden('Only an owner can change owner roles');
    }
    if (
      m.userId === actor.userId &&
      m.role.code === 'MERCHANT_OWNER' &&
      dto.roleCode !== 'MERCHANT_OWNER' &&
      (await this.activeOwners(organizationId)) <= 1
    ) {
      throw new AppError('LAST_OWNER', 'There must be at least one owner', 409);
    }
    if (
      m.role.code === 'MERCHANT_OWNER' &&
      dto.roleCode !== 'MERCHANT_OWNER' &&
      (await this.activeOwners(organizationId)) <= 1
    ) {
      throw new AppError('LAST_OWNER', 'There must be at least one owner', 409);
    }
    const staff = dto.roleCode === 'MERCHANT_STAFF';
    if (staff && !dto.branchId)
      throw AppError.validation('Choose the branch for staff', 'branchId');
    if (dto.branchId) await this.requireBranch(organizationId, dto.branchId);
    if (staff !== (m.role.code === 'MERCHANT_STAFF'))
      throw AppError.validation(
        'Staff accounts sign in differently; invite them again with the new role',
        'roleCode',
      );
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code: dto.roleCode } });
    await this.prisma.organizationMembership.update({
      where: { id: m.id },
      data: { roleId: role.id, branchId: staff ? dto.branchId : null },
    });
    await this.audit.record({
      action: 'merchant.user.role_changed',
      entityType: 'OrganizationMembership',
      entityId: m.id,
      previousState: { role: m.role.code, branchId: m.branchId },
      newState: { role: dto.roleCode, branchId: staff ? dto.branchId : null },
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.list(actor, organizationId);
  }

  async deactivate(
    actor: Actor,
    organizationId: string,
    membershipId: string,
    reason: string,
    meta: RequestMeta,
  ) {
    const m = await this.target(actor, organizationId, membershipId);
    if (m.status !== 'ACTIVE') return this.list(actor, organizationId);
    if (m.role.code === 'MERCHANT_OWNER' && actor.membership?.roleCode !== 'MERCHANT_OWNER')
      throw AppError.forbidden('Only an owner can deactivate an owner');
    if (m.role.code === 'MERCHANT_OWNER' && (await this.activeOwners(organizationId)) <= 1)
      throw new AppError('LAST_OWNER', 'There must be at least one owner', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.update({
        where: { id: m.id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await tx.userSession.updateMany({
        where: { userId: m.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'merchant.user.deactivated',
          entityType: 'OrganizationMembership',
          entityId: m.id,
          reason,
          previousState: { status: 'ACTIVE' },
          newState: { status: 'REVOKED' },
          actor,
          subjectOrganizationId: organizationId,
          meta,
        },
        tx,
      );
    });
    return this.list(actor, organizationId);
  }

  async reactivate(actor: Actor, organizationId: string, membershipId: string, meta: RequestMeta) {
    const m = await this.target(actor, organizationId, membershipId);
    if (m.status === 'ACTIVE') return this.list(actor, organizationId);
    await this.entitlements.requireNewExposure(organizationId, 'ADD_USER');
    await this.usage.assertResourceWithin(organizationId, 'users.max');
    await this.prisma.organizationMembership.update({
      where: { id: m.id },
      data: { status: 'ACTIVE', revokedAt: null },
    });
    await this.audit.record({
      action: 'merchant.user.reactivated',
      entityType: 'OrganizationMembership',
      entityId: m.id,
      actor,
      subjectOrganizationId: organizationId,
      meta,
    });
    return this.list(actor, organizationId);
  }
}
