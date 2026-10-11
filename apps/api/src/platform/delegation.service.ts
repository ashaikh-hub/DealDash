import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  NARROWING_SCOPE_KINDS,
  PLATFORM_PRODUCTS,
  scopeLabel,
  type PermissionCode,
  type RoleCode,
  type ScopeKind,
  type ScopeSpec,
} from '@dealdash/types';
import type { AssignmentView, ScopeInput } from '@dealdash/validation';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { ScopeService } from './scope.service';

/** Roles that can be held in a business organization, by organization type. */
const ROLE_PREFIX = { MERCHANT: 'MERCHANT_', PARTNER: 'PARTNER_' } as const;

/**
 * Delegated administration. A user may grant (and revoke) a role in a scope only inside what they hold themselves: the check lives in
 * ScopeService.assertCanDelegate, so there is exactly one delegation rule. Everything is audited with the scope it happened in.
 */
@Injectable()
export class DelegationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly scope: ScopeService,
  ) {}

  private accessPermission(actor: Actor): PermissionCode {
    return actor.membership?.organizationType === 'PARTNER'
      ? 'partner.access.manage'
      : 'merchant.access.manage';
  }

  /** Scope kinds each role may be held in (configuration). A role not listed can only be held organization-wide. */
  async roleScopes(): Promise<Record<string, ScopeKind[]>> {
    return this.config.get<Record<string, ScopeKind[]>>(CONFIG_KEYS.PLATFORM_ROLE_SCOPES);
  }

  async assignableRoles(actor: Actor) {
    const type = actor.membership!.organizationType as 'MERCHANT' | 'PARTNER';
    const prefix = ROLE_PREFIX[type];
    if (!prefix) return [];
    const [roles, scopes] = await Promise.all([
      this.prisma.role.findMany({
        where: { code: { startsWith: prefix } },
        orderBy: { code: 'asc' },
      }),
      this.roleScopes(),
    ]);
    return roles.map((r) => ({
      roleCode: r.code,
      name: r.name,
      scopeKinds: scopes[r.code] ?? (['ORGANIZATION'] as ScopeKind[]),
    }));
  }

  async members(organizationId: string) {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { organizationId, status: 'ACTIVE' },
      include: { user: { select: { id: true, displayName: true, email: true } }, role: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      membershipId: m.id,
      userId: m.userId,
      displayName: m.user.displayName,
      email: m.user.email,
      roleCode: m.role.code,
      branchId: m.branchId,
      scoped: m.scoped,
    }));
  }

  /** Turns a member into a scoped member (permissions only through assignments) or back to an organization-wide role. */
  async setScoped(
    actor: Actor,
    organizationId: string,
    membershipId: string,
    scoped: boolean,
    meta: RequestMeta,
  ) {
    const m = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, organizationId, status: 'ACTIVE' },
      include: { role: true },
    });
    if (!m) throw AppError.notFound();
    if (m.userId === actor.userId)
      throw new AppError('SCOPE_FORBIDDEN', 'You cannot change your own access', 403);
    if (m.role.code === 'MERCHANT_OWNER')
      throw new AppError('INVALID_STATE', 'The owner cannot be scoped', 409);
    // converting back to an organization-wide role hands out that role everywhere: the actor must hold it everywhere
    await this.scope.assertCanDelegate(
      actor,
      this.accessPermission(actor),
      m.role.code as RoleCode,
      {
        kind: 'ORGANIZATION',
        ref: null,
      },
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMembership.update({ where: { id: m.id }, data: { scoped } });
      if (!scoped)
        await tx.roleAssignment.updateMany({
          where: { membershipId: m.id, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt: new Date(), revokedByUserId: actor.userId },
        });
      await this.audit.record(
        {
          action: scoped ? 'MEMBER_SCOPED' : 'MEMBER_UNSCOPED',
          entityType: 'OrganizationMembership',
          entityId: m.id,
          actor,
          subjectOrganizationId: organizationId,
          previousState: { scoped: m.scoped },
          newState: { scoped },
          scope: 'ORGANIZATION',
          meta,
        },
        tx,
      );
    });
    this.scope.invalidate(organizationId);
  }

  // ---------------------------------------------------------------- validation of a scope request
  private async validateRef(
    organizationId: string,
    kind: ScopeKind,
    ref: string | null,
    product: string | null,
  ) {
    if (kind === 'ORGANIZATION') return;
    if (!ref) throw AppError.validation('A scope reference is required', 'scope.ref');
    const bad = (field: string) =>
      AppError.validation('The scope target was not found in this business account', field);
    if (kind === 'UNIT') {
      if (!(await this.prisma.organizationUnit.findFirst({ where: { id: ref, organizationId } })))
        throw bad('scope.ref');
    } else if (kind === 'LEGAL_ENTITY') {
      if (!(await this.prisma.legalEntity.findFirst({ where: { id: ref, organizationId } })))
        throw bad('scope.ref');
    } else if (kind === 'BRANCH') {
      if (!(await this.prisma.merchantBranch.findFirst({ where: { id: ref, organizationId } })))
        throw bad('scope.ref');
    } else if (kind === 'COUNTRY') {
      if (!(await this.prisma.countryConfiguration.findUnique({ where: { code: ref } })))
        throw bad('scope.ref');
    } else if (kind === 'PRODUCT') {
      if (!(PLATFORM_PRODUCTS as readonly string[]).includes(ref)) throw bad('scope.ref');
    } else if (kind === 'CAMPAIGN') {
      const found =
        product === 'EXCLUSIVE'
          ? await this.prisma.hotDeal.findFirst({
              where: { id: ref, organizationId },
              select: { id: true },
            })
          : product === 'VOUCHER'
            ? await this.prisma.voucher.findFirst({
                where: { id: ref, organizationId },
                select: { id: true },
              })
            : product === 'WATCH'
              ? await this.prisma.watchCampaign.findFirst({
                  where: { id: ref, organizationId },
                  select: { id: true },
                })
              : product === 'LIVE_DEAL'
                ? await this.prisma.liveDeal.findFirst({
                    where: { id: ref, organizationId },
                    select: { id: true },
                  })
                : null;
      if (!found) throw bad('scope.ref');
    }
  }

  private toSpec(s: ScopeInput): ScopeSpec {
    return { kind: s.kind, ref: s.ref, product: s.product, envelope: s.envelope };
  }

  // ---------------------------------------------------------------- assignments
  async grant(
    actor: Actor,
    organizationId: string,
    b: {
      membershipId: string;
      roleCode: string;
      scope: ScopeInput;
      validUntil: string | null;
      reason?: string;
    },
    meta: RequestMeta,
  ): Promise<AssignmentView> {
    const m = await this.prisma.organizationMembership.findFirst({
      where: { id: b.membershipId, organizationId, status: 'ACTIVE' },
    });
    if (!m) throw AppError.notFound();
    if (m.userId === actor.userId)
      throw new AppError('SCOPE_FORBIDDEN', 'You cannot change your own access', 403);
    if (!m.scoped)
      throw new AppError(
        'INVALID_STATE',
        'Make this member a scoped member before assigning scoped roles',
        409,
      );
    const type = actor.membership!.organizationType as 'MERCHANT' | 'PARTNER';
    const role = await this.prisma.role.findUnique({ where: { code: b.roleCode } });
    if (!role || !ROLE_PREFIX[type] || !role.code.startsWith(ROLE_PREFIX[type]))
      throw AppError.validation('This role cannot be assigned here', 'roleCode');
    const allowed = (await this.roleScopes())[role.code] ?? ['ORGANIZATION'];
    const spec = this.toSpec(b.scope);
    if (!allowed.includes(spec.kind))
      throw AppError.validation(
        `The ${role.code} role cannot be held in a ${spec.kind} scope`,
        'scope.kind',
      );
    if (spec.envelope) {
      if (!(NARROWING_SCOPE_KINDS as readonly string[]).includes(spec.kind))
        throw AppError.validation('Only narrowing scopes have an envelope', 'scope.envelope');
      if ((NARROWING_SCOPE_KINDS as readonly string[]).includes(spec.envelope.kind))
        throw AppError.validation('The envelope must be a structural scope', 'scope.envelope');
      await this.validateRef(organizationId, spec.envelope.kind, spec.envelope.ref, null);
    }
    await this.validateRef(organizationId, spec.kind, spec.ref, spec.product ?? null);
    const until = b.validUntil ? new Date(b.validUntil) : null;
    if (until && until <= new Date())
      throw AppError.validation('The end date must be in the future', 'validUntil');
    // the one delegation rule: nobody grants more than they hold, in a scope that contains the new one
    await this.scope.assertCanDelegate(
      actor,
      this.accessPermission(actor),
      role.code as RoleCode,
      spec,
    );
    let row;
    try {
      row = await this.prisma.$transaction(async (tx) => {
        const r = await tx.roleAssignment.create({
          data: {
            organizationId,
            membershipId: m.id,
            userId: m.userId,
            roleId: role.id,
            scopeKind: spec.kind,
            scopeRef: spec.ref,
            scopeProduct: spec.product ?? null,
            envelopeKind: spec.envelope?.kind ?? null,
            envelopeRef: spec.envelope?.ref ?? null,
            validUntil: until,
            grantedByUserId: actor.userId,
            grantedByRole: actor.membership?.roleCode ?? null,
            reason: b.reason ?? null,
          },
        });
        await this.audit.record(
          {
            action: 'ROLE_ASSIGNED',
            entityType: 'RoleAssignment',
            entityId: r.id,
            actor,
            subjectOrganizationId: organizationId,
            newState: {
              userId: m.userId,
              role: role.code,
              scope: scopeLabel(spec),
              validUntil: b.validUntil,
            },
            reason: b.reason ?? null,
            scope: scopeLabel(spec),
            meta,
          },
          tx,
        );
        return r;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new AppError(
          'INVALID_STATE',
          'This member already holds this role in this scope',
          409,
        );
      throw e;
    }
    this.scope.invalidate(organizationId);
    return (await this.view(organizationId, row.id))!;
  }

  async revoke(
    actor: Actor,
    organizationId: string,
    id: string,
    reason: string,
    meta: RequestMeta,
  ) {
    const a = await this.prisma.roleAssignment.findFirst({
      where: { id, organizationId },
      include: { role: true },
    });
    if (!a) throw AppError.notFound();
    if (a.status !== 'ACTIVE')
      throw new AppError('INVALID_STATE', 'This assignment is not active', 409);
    const spec: ScopeSpec = {
      kind: a.scopeKind as ScopeKind,
      ref: a.scopeRef,
      product: a.scopeProduct,
      envelope: a.envelopeKind ? { kind: a.envelopeKind as ScopeKind, ref: a.envelopeRef } : null,
    };
    // you can only withdraw what you could have granted
    await this.scope.assertCanDelegate(
      actor,
      this.accessPermission(actor),
      a.role.code as RoleCode,
      spec,
    );
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.roleAssignment.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedByUserId: actor.userId },
      });
      if (res.count !== 1)
        throw new AppError('INVALID_STATE', 'This assignment is not active', 409);
      await this.audit.record(
        {
          action: 'ROLE_REVOKED',
          entityType: 'RoleAssignment',
          entityId: id,
          actor,
          subjectOrganizationId: organizationId,
          previousState: { userId: a.userId, role: a.role.code, scope: scopeLabel(spec) },
          reason,
          scope: scopeLabel(spec),
          meta,
        },
        tx,
      );
    });
    this.scope.invalidate(organizationId);
  }

  private async scopeName(
    organizationId: string,
    kind: string,
    ref: string | null,
  ): Promise<string | null> {
    if (!ref) return null;
    if (kind === 'UNIT')
      return (
        (
          await this.prisma.organizationUnit.findUnique({
            where: { id: ref },
            select: { nameEn: true },
          })
        )?.nameEn ?? null
      );
    if (kind === 'LEGAL_ENTITY')
      return (
        (
          await this.prisma.legalEntity.findUnique({
            where: { id: ref },
            select: { legalName: true },
          })
        )?.legalName ?? null
      );
    if (kind === 'BRANCH')
      return (
        (
          await this.prisma.merchantBranch.findUnique({
            where: { id: ref },
            select: { nameEn: true },
          })
        )?.nameEn ?? null
      );
    void organizationId;
    return ref;
  }

  private async toView(
    a: Awaited<ReturnType<typeof this.loadRows>>[number],
  ): Promise<AssignmentView> {
    return {
      id: a.id,
      membershipId: a.membershipId,
      userId: a.userId,
      userName: a.membership.user.displayName,
      roleCode: a.role.code,
      scope: {
        kind: a.scopeKind as ScopeKind,
        ref: a.scopeRef,
        product: a.scopeProduct,
        envelope: a.envelopeKind ? { kind: a.envelopeKind as ScopeKind, ref: a.envelopeRef } : null,
      },
      scopeName: await this.scopeName(a.organizationId, a.scopeKind, a.scopeRef),
      status: a.status,
      validFrom: a.validFrom.toISOString(),
      validUntil: a.validUntil?.toISOString() ?? null,
      grantedByUserId: a.grantedByUserId,
      reason: a.reason,
      createdAt: a.createdAt.toISOString(),
    };
  }

  private loadRows(where: Record<string, unknown>) {
    return this.prisma.roleAssignment.findMany({
      where,
      include: { role: true, membership: { include: { user: { select: { displayName: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async view(organizationId: string, id: string) {
    const rows = await this.loadRows({ id, organizationId });
    return rows[0] ? this.toView(rows[0]) : null;
  }

  /** A scoped administrator sees only the assignments inside the scope they can manage. */
  async list(actor: Actor, organizationId: string): Promise<AssignmentView[]> {
    const rows = await this.loadRows({ organizationId });
    const grants = (await this.scope.grantsOf(actor)).filter((g) =>
      g.permissions.has(this.accessPermission(actor)),
    );
    const out: AssignmentView[] = [];
    for (const r of rows) {
      const inner = await this.scope.resolve(organizationId, {
        kind: r.scopeKind as ScopeKind,
        ref: r.scopeRef,
        product: r.scopeProduct,
        envelope: r.envelopeKind ? { kind: r.envelopeKind as ScopeKind, ref: r.envelopeRef } : null,
      });
      if (grants.some((g) => this.scope.covers(g.set, inner))) out.push(await this.toView(r));
    }
    return out;
  }
}
