import { Injectable } from '@nestjs/common';
import type { PermissionCode } from '@dealdash/types';
import { AppError } from '../common/errors';
import type { Actor } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService, type Grant, type ScopeTarget } from './scope.service';

export type CampaignProduct = 'LIVE_DEAL' | 'EXCLUSIVE' | 'VOUCHER' | 'WATCH';
type Mode = 'read' | 'write';

/** The permission that governs reading / changing each product (the same codes the controllers' coarse guard uses). */
const PERMISSION: Record<CampaignProduct, Record<Mode, PermissionCode>> = {
  LIVE_DEAL: { read: 'merchant.deals.read', write: 'merchant.deals.manage' },
  EXCLUSIVE: { read: 'merchant.deals.read', write: 'merchant.deals.manage' },
  VOUCHER: { read: 'merchant.deals.read', write: 'merchant.vouchers.manage' },
  WATCH: { read: 'merchant.watch.read', write: 'merchant.watch.manage' },
};

/** The branches a campaign content object touches. Empty = not tied to a branch (an organization-level campaign). */
export function branchesOf(product: CampaignProduct, content: unknown): string[] {
  const c = (content ?? {}) as {
    branchIds?: string[];
    allocations?: Array<{ branchId: string }>;
    targeting?: { branchIds?: string[] };
  };
  const ids =
    product === 'EXCLUSIVE'
      ? (c.allocations ?? []).map((a) => a.branchId)
      : product === 'WATCH'
        ? (c.targeting?.branchIds ?? [])
        : (c.branchIds ?? []);
  return [...new Set(ids)];
}

/**
 * Scope enforcement for the older (pre-platform) merchant endpoints. They all go through here, so there is ONE answer to
 * "may this member touch this campaign / branch / organization-level thing?":
 *
 *   - ordinary members (not `scoped`) keep their organization-wide role: nothing changes for them;
 *   - scoped members (access only through role assignments) are checked against ScopeService on every call: reads need any
 *     one of the record's branches in scope, writes need ALL of them, narrowing scopes (product / campaign) must match, and
 *     organization-level work (finance, team, loyalty, disputes) needs an organization-wide grant for that permission.
 *
 * Lists are filtered on the server (an id allow-list), never by the front end.
 */
@Injectable()
export class AccessScopeService {
  constructor(
    private readonly scope: ScopeService,
    private readonly prisma: PrismaService,
  ) {}

  isScoped(actor: Actor): boolean {
    // a partner working on its own campaign was scope-checked by the partner service against the PARTNER's grants
    if (actor.partnerContext) return false;
    return !!actor.membership?.scoped;
  }

  /** Organization-level work: scoped members need an organization-wide grant of this permission. */
  async org(actor: Actor, permission: PermissionCode): Promise<void> {
    if (!this.isScoped(actor)) return;
    await this.scope.require(actor, permission, {
      organizationId: actor.membership!.organizationId,
    });
  }

  /** Is the actor allowed this organization-level permission (no throw)? */
  async canOrg(actor: Actor, permission: PermissionCode): Promise<boolean> {
    if (!this.isScoped(actor)) return true;
    return this.scope.can(actor, permission, { organizationId: actor.membership!.organizationId });
  }

  private targets(
    product: CampaignProduct,
    organizationId: string,
    campaignId: string | null,
    branches: string[],
  ): ScopeTarget[] {
    const base = { organizationId, product, campaignId };
    return branches.length ? branches.map((b) => ({ ...base, branchId: b })) : [base];
  }

  /** One existing campaign. Read needs any of its branches in scope; write needs all of them. */
  async campaign(
    actor: Actor,
    product: CampaignProduct,
    row: { id: string; organizationId: string; content: unknown },
    mode: Mode,
  ): Promise<void> {
    if (!this.isScoped(actor)) return;
    const perm = PERMISSION[product][mode];
    const ts = this.targets(product, row.organizationId, row.id, branchesOf(product, row.content));
    const readPerm = PERMISSION[product].read;
    let readable = false;
    for (const t of ts) if (await this.scope.can(actor, readPerm, t)) readable = true;
    // existence is not revealed to someone who cannot even read it
    if (!readable) throw AppError.notFound();
    if (mode === 'write') return this.scope.requireAll(actor, perm, ts);
  }

  /** Loads the campaign (404 for another business's) and checks the actor's scope against it. */
  async guard(
    actor: Actor,
    product: CampaignProduct,
    organizationId: string,
    id: string,
    mode: Mode,
  ): Promise<void> {
    if (!this.isScoped(actor)) return;
    const args = {
      where: { id, organizationId },
      select: { id: true, organizationId: true, content: true },
    };
    const row =
      product === 'LIVE_DEAL'
        ? await this.prisma.liveDeal.findFirst(args)
        : product === 'EXCLUSIVE'
          ? await this.prisma.hotDeal.findFirst(args)
          : product === 'VOUCHER'
            ? await this.prisma.voucher.findFirst(args)
            : await this.prisma.watchCampaign.findFirst(args);
    if (!row) throw AppError.notFound();
    await this.campaign(actor, product, row, mode);
  }

  /** A campaign being created or its branches being changed: every branch must be in scope (no campaign id exists yet). */
  async newCampaign(
    actor: Actor,
    product: CampaignProduct,
    organizationId: string,
    content: unknown,
  ): Promise<void> {
    if (!this.isScoped(actor)) return;
    const perm = PERMISSION[product].write;
    await this.scope.requireAll(
      actor,
      perm,
      this.targets(product, organizationId, null, branchesOf(product, content)),
    );
  }

  /** `null` = no restriction; otherwise the ids of this organization's campaigns the actor may read. */
  async visibleCampaignIds(
    actor: Actor,
    product: CampaignProduct,
    organizationId: string,
  ): Promise<string[] | null> {
    if (!this.isScoped(actor)) return null;
    const perm = PERMISSION[product].read;
    const grants = (await this.scope.grantsOf(actor)).filter((g) => g.permissions.has(perm));
    if (!grants.length) return [];
    const rows = await this.rows(product, organizationId);
    const out: string[] = [];
    for (const r of rows)
      if (
        await this.anyBranch(
          grants,
          perm,
          this.targets(product, organizationId, r.id, branchesOf(product, r.content)),
        )
      )
        out.push(r.id);
    return out;
  }

  private async anyBranch(grants: Grant[], perm: PermissionCode, ts: ScopeTarget[]) {
    for (const t of ts) if (await this.scope.canWith(grants, perm, t)) return true;
    return false;
  }

  private rows(
    product: CampaignProduct,
    organizationId: string,
  ): Promise<Array<{ id: string; content: unknown }>> {
    const args = { where: { organizationId }, select: { id: true, content: true } };
    switch (product) {
      case 'LIVE_DEAL':
        return this.prisma.liveDeal.findMany(args);
      case 'EXCLUSIVE':
        return this.prisma.hotDeal.findMany(args);
      case 'VOUCHER':
        return this.prisma.voucher.findMany(args);
      case 'WATCH':
        return this.prisma.watchCampaign.findMany(args);
    }
  }

  // ---------------------------------------------------------------- branches (redemptions, branch records)
  /** `null` = every branch; otherwise exactly the branches the actor holds the permission for. */
  async visibleBranches(actor: Actor, permission: PermissionCode): Promise<Set<string> | null> {
    if (!this.isScoped(actor)) return null;
    return this.scope.visibleBranchIds(actor, permission);
  }

  async branch(
    actor: Actor,
    permission: PermissionCode,
    branchId: string,
    opts: { product?: CampaignProduct; campaignId?: string } = {},
  ): Promise<void> {
    if (!this.isScoped(actor)) return;
    const m = actor.membership!;
    const t: ScopeTarget = {
      organizationId: m.organizationId,
      branchId,
      product: opts.product ?? null,
      campaignId: opts.campaignId ?? null,
    };
    if (!(await this.scope.can(actor, permission, t))) throw AppError.notFound();
  }
}
