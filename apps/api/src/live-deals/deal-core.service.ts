import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import {
  DEFAULT_CITY,
  canTransitionLiveDeal,
  type LiveDealAction,
  type LiveDealStatus,
} from '@dealdash/types';
import type { LiveDealContent } from '@dealdash/validation';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { AccessScopeService } from '../platform/access-scope.service';
import { TenantService } from '../identity/tenant.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { denormalize, parseContent, statusAfterApproval } from './deal-content';
import { EligibilityService } from './eligibility.service';

export const DEAL_INCLUDE = {
  category: true,
  organization: { include: { merchant: true } },
  branches: { include: { branch: true } },
  ruleSet: { include: { conditions: true } },
} satisfies Prisma.LiveDealInclude;
export type DealRow = Prisma.LiveDealGetPayload<{ include: typeof DEAL_INCLUDE }>;

export const OPEN_REVISION_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES'] as const;

export interface ActorInfo {
  userId: string | null;
  role: string | null;
  name: string | null;
  byDealDash: boolean;
}

export const SYSTEM_ACTOR: ActorInfo = {
  userId: null,
  role: 'SYSTEM',
  name: 'DealDash system',
  byDealDash: true,
};

export function actorInfo(actor: Actor | null): ActorInfo {
  if (!actor) return SYSTEM_ACTOR;
  return {
    userId: actor.userId,
    role: actor.membership?.roleCode ?? null,
    name: actor.displayName,
    byDealDash: actor.membership?.organizationType === 'DEALDASH',
  };
}

export interface RecordInput {
  action: LiveDealAction;
  from?: LiveDealStatus | null;
  to?: LiveDealStatus | null;
  actor: Actor | null;
  reason?: string | null;
  reasonAr?: string | null;
  fields?: string[];
  revisionId?: string | null;
  snapshot?: unknown;
  meta?: RequestMeta | null;
}

/** Shared domain operations for Live Deals: loading, reference checks, the state machine, history and audit. */
@Injectable()
export class DealCoreService {
  constructor(
    readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenant: TenantService,
    private readonly config: SystemConfigService,
    private readonly eligibility: EligibilityService,
    readonly access: AccessScopeService,
  ) {}

  // ---------------------------------------------------------------- tenant scope
  /** Merchant deal routes: own organisation only (404 otherwise) and never for branch staff. Scoped members are checked per record by AccessScopeService. */
  requireMerchantScope(actor: Actor, organizationId: string) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
  }

  // ---------------------------------------------------------------- loading
  async loadOwned(organizationId: string, id: string): Promise<DealRow> {
    const row = await this.prisma.liveDeal.findFirst({
      where: { id, organizationId },
      include: DEAL_INCLUDE,
    });
    if (!row) throw AppError.notFound();
    return row;
  }

  async loadAny(id: string): Promise<DealRow> {
    const row = await this.prisma.liveDeal.findUnique({ where: { id }, include: DEAL_INCLUDE });
    if (!row) throw AppError.notFound();
    return row;
  }

  openRevision(dealId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    return db.liveDealRevision.findFirst({
      where: { dealId, status: { in: [...OPEN_REVISION_STATUSES] } },
    });
  }

  async enabledCities(): Promise<string[]> {
    return (await this.config.get<string[]>(CONFIG_KEYS.ENABLED_CITIES)) ?? ['Riyadh'];
  }

  /** The first enabled city is the default; the literal is only a last resort when configuration is empty. */
  async defaultCity(): Promise<string> {
    return (await this.enabledCities())[0] ?? DEFAULT_CITY;
  }

  async cityCenters(): Promise<
    Record<string, { latitude: number; longitude: number; nameAr?: string }>
  > {
    return (await this.config.get(CONFIG_KEYS.DISCOVERY_CITY_CENTERS)) ?? {};
  }

  async materialFields(): Promise<string[]> {
    return (await this.config.get<string[]>(CONFIG_KEYS.LIVE_DEAL_MATERIAL_FIELDS)) ?? [];
  }

  // ---------------------------------------------------------------- validation of references (tenant safe)
  /**
   * Every id inside the content must belong to the merchant (branches, images) or to reference data (category, partners).
   * Another merchant's ids are reported exactly like unknown ids, so their existence is not revealed.
   */
  async validateReferences(organizationId: string, c: LiveDealContent) {
    if (c.startAt && c.endAt && new Date(c.endAt).getTime() <= new Date(c.startAt).getTime())
      throw AppError.validation('The end date must be after the start date', 'endAt');
    if (c.categoryId) {
      const cat = await this.prisma.category.findFirst({
        where: { id: c.categoryId, active: true },
      });
      if (!cat) throw AppError.validation('Choose a category from the list', 'categoryId');
    }
    if (c.branchIds.length) {
      const n = await this.prisma.merchantBranch.count({
        where: { id: { in: c.branchIds }, organizationId },
      });
      if (n !== new Set(c.branchIds).size)
        throw AppError.validation('Choose branches of your own business', 'branchIds');
    }
    if (c.media.length) {
      const ids = c.media.map((m) => m.fileId);
      const n = await this.prisma.storedFile.count({
        where: { id: { in: ids }, organizationId, kind: 'DEAL_IMAGE', status: 'AVAILABLE' },
      });
      if (n !== new Set(ids).size)
        throw AppError.validation('One of the images is not available. Upload it again.', 'media');
    }
    if (c.redemptionMode === 'CONTROLLED') {
      const enabled = await this.config.getBoolean(CONFIG_KEYS.LIVE_DEAL_CONTROLLED_ENABLED, false);
      if (!enabled)
        throw new AppError(
          'CONTROLLED_NOT_ENABLED',
          'Controlled redemption is not enabled yet. General Live Deals need no code or claim.',
          409,
          'redemptionMode',
        );
    }
    await this.eligibility.validateReferences(c.eligibility, await this.enabledCities());
  }

  /** At least one participating branch must be active (LD-11). */
  async requireActiveBranch(organizationId: string, branchIds: string[]) {
    const n = await this.prisma.merchantBranch.count({
      where: { id: { in: branchIds }, organizationId, status: 'ACTIVE' },
    });
    if (n < 1)
      throw new AppError('DEAL_INCOMPLETE', 'Choose at least one active branch', 422, 'branchIds', [
        {
          code: 'DEAL_INCOMPLETE',
          message: 'Choose at least one active branch',
          field: 'branchIds',
        },
      ]);
  }

  // ---------------------------------------------------------------- history + audit
  async record(
    tx: Prisma.TransactionClient,
    deal: { id: string; organizationId: string },
    e: RecordInput,
  ) {
    const info = actorInfo(e.actor);
    await tx.liveDealHistory.create({
      data: {
        dealId: deal.id,
        revisionId: e.revisionId ?? null,
        action: e.action,
        fromStatus: e.from ?? null,
        toStatus: e.to ?? null,
        reason: e.reason ?? null,
        reasonAr: e.reasonAr ?? null,
        fields: (e.fields ?? []) as Prisma.InputJsonValue,
        actorUserId: info.userId,
        actorRole: info.role,
        actorName: info.name,
        byDealDash: info.byDealDash,
        snapshot: (e.snapshot ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await this.audit.record(
      {
        action: `live_deal.${e.action.toLowerCase()}`,
        entityType: 'LiveDeal',
        entityId: deal.id,
        reason: e.reason ?? null,
        previousState: e.from ? { status: e.from } : undefined,
        newState: e.to ? { status: e.to, revisionId: e.revisionId ?? undefined } : undefined,
        actor: e.actor,
        actorRole: e.actor ? undefined : 'SYSTEM',
        subjectOrganizationId: deal.organizationId,
        meta: e.meta ?? null,
      },
      tx,
    );
  }

  /**
   * The ONLY way a deal changes status. Illegal transitions are rejected; a concurrent change is detected by the
   * conditional update (status must still be what we read).
   */
  async transition(
    tx: Prisma.TransactionClient,
    deal: { id: string; organizationId: string; status: LiveDealStatus },
    to: LiveDealStatus,
    e: Omit<RecordInput, 'from' | 'to'> & { data?: Prisma.LiveDealUncheckedUpdateManyInput },
  ) {
    if (!canTransitionLiveDeal(deal.status, to))
      throw new AppError('INVALID_STATE', `A ${deal.status} deal cannot become ${to}`, 409);
    const { data, ...rest } = e;
    const res = await tx.liveDeal.updateMany({
      where: { id: deal.id, status: deal.status },
      data: {
        ...(data ?? {}),
        status: to,
        updatedByUserId: e.actor?.userId ?? null,
        version: { increment: 1 },
      },
    });
    if (res.count !== 1)
      throw new AppError('VERSION_CONFLICT', 'The deal changed. Reload and try again.', 409);
    await this.record(tx, deal, { ...rest, from: deal.status, to });
  }

  // ---------------------------------------------------------------- content
  /** Writes content, derived columns, participating branches and the eligibility rule set in one place. */
  async applyContent(
    tx: Prisma.TransactionClient,
    deal: { id: string; organizationId: string; eligibilityRuleSetId: string | null },
    content: LiveDealContent,
    userId: string | null,
    opts: { bumpVersion?: boolean } = {},
  ) {
    const ruleSetId = await this.eligibility.syncRuleSet(
      tx,
      deal.eligibilityRuleSetId,
      deal.organizationId,
      content.eligibility,
    );
    await tx.liveDeal.update({
      where: { id: deal.id },
      data: {
        content: content as unknown as Prisma.InputJsonValue,
        ...denormalize(content),
        eligibilityRuleSetId: ruleSetId,
        ...(opts.bumpVersion === false ? {} : { version: { increment: 1 } }),
        updatedByUserId: userId,
      },
    });
    const wanted = new Set(content.branchIds);
    const current = await tx.liveDealBranch.findMany({ where: { dealId: deal.id } });
    const have = new Set(current.map((b) => b.branchId));
    const remove = [...have].filter((b) => !wanted.has(b));
    const add = [...wanted].filter((b) => !have.has(b));
    if (remove.length)
      await tx.liveDealBranch.deleteMany({ where: { dealId: deal.id, branchId: { in: remove } } });
    if (add.length)
      await tx.liveDealBranch.createMany({
        data: add.map((branchId) => ({ dealId: deal.id, branchId })),
      });
  }

  async merchantTrust(organizationId: string) {
    const m = await this.prisma.merchant.findUnique({ where: { organizationId } });
    return m?.trustLevel ?? 'NEW';
  }

  // ---------------------------------------------------------------- approval (shared by admin decisions and guardrail auto-publish)
  /** A reviewed (or auto-approved) NEW deal becomes SCHEDULED or LIVE depending on its start time. */
  async approveDeal(
    tx: Prisma.TransactionClient,
    deal: DealRow,
    e: {
      action: 'APPROVE' | 'AUTO_APPROVE';
      actor: Actor | null;
      reason?: string | null;
      reasonAr?: string | null;
      meta?: RequestMeta | null;
    },
    now = new Date(),
  ) {
    const to = statusAfterApproval(deal.startAt, deal.endAt, now);
    await this.transition(tx, deal, to, {
      ...e,
      data: { publishedAt: deal.publishedAt ?? now, pausedBy: null },
    });
    return to;
  }

  /**
   * Approving a revision publishes the proposed content as the new live version (version counter moves on) and
   * activates a scheduled deal whose start time has arrived. The old content is kept in the history snapshot.
   */
  async approveRevision(
    tx: Prisma.TransactionClient,
    deal: DealRow,
    revision: { id: string; content: unknown; status: string },
    e: {
      action: 'REVISION_APPROVE' | 'REVISION_AUTO_APPROVE';
      actor: Actor | null;
      reason?: string | null;
      reasonAr?: string | null;
      meta?: RequestMeta | null;
    },
    now = new Date(),
  ) {
    const before = parseContent(deal.content);
    const next = parseContent(revision.content);
    await this.applyContent(tx, deal, next, e.actor?.userId ?? null);
    await tx.liveDealRevision.update({
      where: { id: revision.id },
      data: { status: 'APPROVED', decidedAt: now, decidedByUserId: e.actor?.userId ?? null },
    });
    await this.record(tx, deal, {
      action: e.action,
      from: deal.status,
      to: deal.status,
      actor: e.actor,
      reason: e.reason,
      reasonAr: e.reasonAr,
      revisionId: revision.id,
      snapshot: { before, after: next },
      meta: e.meta,
    });
    // A scheduled deal whose (possibly changed) start time has arrived goes live now.
    if (deal.status === 'SCHEDULED') {
      const start = next.startAt ? new Date(next.startAt) : null;
      if (!start || start.getTime() <= now.getTime())
        await this.transition(tx, { ...deal, status: 'SCHEDULED' }, 'LIVE', {
          action: 'ACTIVATE',
          actor: null,
          reason: 'Start time reached',
        });
    }
  }
}
