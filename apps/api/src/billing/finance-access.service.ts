import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '@dealdash/types';
import { AppError } from '../common/errors';
import type { Actor } from '../common/request-context';
import { ScopeService } from '../platform/scope.service';
import { PrismaService } from '../prisma/prisma.service';

/** What a finance request may see: the organization and, for a scoped member, only the legal entities in their scope. */
export interface FinanceAccess {
  admin: boolean;
  organizationId: string | null;
  /** null = every legal entity of the organization (or every organization for DealDash). */
  legalEntityIds: string[] | null;
  canManage: boolean;
}

/**
 * Finance access = role + scope. Business members need the finance permission; a scoped member sees only the legal entities their
 * role assignments cover; branch-bound members (staff, branch admins) never see finance. DealDash needs admin.finance.read / manage.
 */
@Injectable()
export class FinanceAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async resolve(
    actor: Actor,
    orgId: string | null,
    mode: 'read' | 'manage',
  ): Promise<FinanceAccess> {
    if (actor.audience === 'admin') {
      const need: PermissionCode = mode === 'read' ? 'admin.finance.read' : 'admin.finance.manage';
      if (!actor.permissions.has(need)) throw AppError.forbidden();
      return {
        admin: true,
        organizationId: orgId,
        legalEntityIds: null,
        canManage: actor.permissions.has('admin.finance.manage'),
      };
    }
    const m = actor.membership;
    if (
      !m ||
      !orgId ||
      m.organizationId !== orgId ||
      (m.organizationType !== 'MERCHANT' && m.organizationType !== 'PARTNER')
    )
      throw AppError.notFound();
    const prefix = m.organizationType === 'PARTNER' ? 'partner' : 'merchant';
    const read = `${prefix}.finance.read` as PermissionCode;
    const manage = `${prefix}.finance.manage` as PermissionCode;
    const need = mode === 'read' ? read : manage;
    if (!actor.permissions.has(need)) throw AppError.forbidden();
    if (m.branchId)
      throw new AppError('SCOPE_FORBIDDEN', 'Finance is not available to branch-level access', 403);
    if (!m.scoped)
      return {
        admin: false,
        organizationId: orgId,
        legalEntityIds: null,
        canManage: actor.permissions.has(manage),
      };
    const les = await this.prisma.legalEntity.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    });
    const allowed: string[] = [];
    for (const le of les)
      if (await this.scope.can(actor, need, { organizationId: orgId, legalEntityId: le.id }))
        allowed.push(le.id);
    if (!allowed.length)
      throw new AppError(
        'SCOPE_FORBIDDEN',
        'Your access does not cover any legal entity of this business',
        403,
      );
    return {
      admin: false,
      organizationId: orgId,
      legalEntityIds: allowed,
      canManage: actor.permissions.has(manage),
    };
  }

  /** 404 unless the document / account belongs to what the caller may see. */
  assertSees(a: FinanceAccess, row: { organizationId: string; legalEntityId?: string | null }) {
    if (a.admin) return;
    if (row.organizationId !== a.organizationId) throw AppError.notFound();
    if (a.legalEntityIds && (!row.legalEntityId || !a.legalEntityIds.includes(row.legalEntityId)))
      throw AppError.notFound();
  }
}
