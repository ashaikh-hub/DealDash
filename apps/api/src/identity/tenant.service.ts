import { Injectable } from '@nestjs/common';
import type { OrganizationType } from '@dealdash/types';
import { AppError } from '../common/errors';
import type { Actor } from '../common/request-context';

/**
 * Tenant isolation rules (mandatory pattern for every future module):
 *  1. A tenant route works only on the caller's OWN organisation. Another organisation's id yields 404
 *     (never 403) so its existence is not revealed.
 *  2. A branch-scoped membership (for example staff) may only see its own branch; other branch ids yield 404.
 *  3. Queries always include the organisation id in the WHERE clause (never fetch by id alone).
 */
@Injectable()
export class TenantService {
  /** Returns the organisation id the caller may use, or throws 404 for any other organisation. */
  requireOwnOrganization(actor: Actor, organizationId: string, type: OrganizationType): string {
    const m = actor.membership;
    if (!m || m.organizationId !== organizationId || m.organizationType !== type)
      throw AppError.notFound();
    return m.organizationId;
  }

  /** Returns a Prisma `where` fragment restricting branches to the caller's scope. */
  branchScopeWhere(actor: Actor): { id?: string } {
    const branchId = actor.membership?.branchId;
    return branchId ? { id: branchId } : {};
  }

  assertBranchAccess(actor: Actor, branchId: string): void {
    const scoped = actor.membership?.branchId;
    if (scoped && scoped !== branchId) throw AppError.notFound();
  }

  /**
   * Whether the caller is restricted to part of the organization (a single branch, or a scoped member whose access comes only from
   * scoped role assignments). Endpoints that are not scope-aware refuse such callers, so a scoped user can never reach more than
   * their scope through an older route. Scope-aware services use ScopeService instead.
   */
  /** A membership bound to one branch (branch staff). They run redemptions; they never manage campaigns. */
  isBranchBound(actor: Actor): boolean {
    return !!actor.membership?.branchId;
  }

  isBranchScoped(actor: Actor): boolean {
    return !!actor.membership?.branchId || !!actor.membership?.scoped;
  }
}
