import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { canTransitionHotDeal, type HotDealAction, type HotDealStatus } from '@dealdash/types';
import {
  DEFAULT_HOT_LIMITS,
  commitmentIssues,
  needsInventory,
  type HotDealContent,
  type HotDealIssue,
  type HotDealLimits,
} from '@dealdash/validation';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { CommercialService } from '../finance/commercial.service';
import { CampaignVersionService } from '../platform/campaign-version.service';
import type { Actor, RequestMeta } from '../common/request-context';
import { AccessScopeService } from '../platform/access-scope.service';
import { TenantService } from '../identity/tenant.service';
import { actorInfo, type ActorInfo } from '../live-deals/deal-core.service';
import { DealCoreService } from '../live-deals/deal-core.service';
import { EligibilityService } from '../live-deals/eligibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { denormalizeHot, hotStatusAfterApproval, parseHotContent } from './hot-content';
import { ReservationPolicyService } from './reservation-policy.service';

export const HOT_INCLUDE = {
  category: true,
  organization: { include: { merchant: true } },
  inventory: { include: { branch: true } },
  ruleSet: { include: { conditions: true } },
} satisfies Prisma.HotDealInclude;
export type HotRow = Prisma.HotDealGetPayload<{ include: typeof HOT_INCLUDE }>;

export type { ActorInfo };

/** Statuses in which customers may hold or redeem units. */
export const RESERVABLE_STATUSES: readonly HotDealStatus[] = ['LIVE'];
/** Statuses where the deal is already approved (material changes are no longer possible). */
export const HOT_APPROVED_STATUSES: readonly HotDealStatus[] = [
  'SCHEDULED',
  'LIVE',
  'PAUSED',
  'SOLD_OUT',
  'SUSPENDED',
];

export interface HotRecordInput {
  action: HotDealAction;
  from?: HotDealStatus | null;
  to?: HotDealStatus | null;
  actor: Actor | null;
  reason?: string | null;
  reasonAr?: string | null;
  fields?: string[];
  snapshot?: unknown;
  meta?: RequestMeta | null;
}

export interface NoShowConfig {
  threshold: number;
  windowDays: number;
  blockDays: number;
}

/** Shared domain operations for Exclusive Deals: loading, reference checks, the state machine, history, audit and platform rules. */
@Injectable()
export class HotCoreService {
  constructor(
    readonly prisma: PrismaService,
    readonly commercial: CommercialService,
    readonly versions: CampaignVersionService,
    readonly audit: AuditService,
    private readonly tenant: TenantService,
    private readonly config: SystemConfigService,
    private readonly eligibility: EligibilityService,
    private readonly liveCore: DealCoreService,
    readonly access: AccessScopeService,
    readonly reservationPolicy: ReservationPolicyService,
  ) {}

  // ---------------------------------------------------------------- reservation commitment (founder decision 2026-10-15)
  /** RC-04 / RC-05 / RC-20 / RC-21: the deal's commitment checked against its effective reservation policy. */
  async commitmentIssues(organizationId: string, c: HotDealContent): Promise<HotDealIssue[]> {
    if (!c.reservationsEnabled) return [];
    const policy = await this.reservationPolicy.forDeal(organizationId, c);
    return commitmentIssues(c, policy.commitment);
  }

  // ---------------------------------------------------------------- tenant scope
  /** Merchant routes: own organisation only (404 otherwise) and never for branch staff. Scoped members are checked per record by AccessScopeService. */
  requireMerchantScope(actor: Actor, organizationId: string) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
  }

  // ---------------------------------------------------------------- loading
  async loadOwned(organizationId: string, id: string): Promise<HotRow> {
    const row = await this.prisma.hotDeal.findFirst({
      where: { id, organizationId },
      include: HOT_INCLUDE,
    });
    if (!row) throw AppError.notFound();
    return row;
  }

  async loadAny(id: string): Promise<HotRow> {
    const row = await this.prisma.hotDeal.findUnique({ where: { id }, include: HOT_INCLUDE });
    if (!row) throw AppError.notFound();
    return row;
  }

  // ---------------------------------------------------------------- platform rules (all configuration, never hard-coded policy)
  enabledCities() {
    return this.liveCore.enabledCities();
  }

  async limits(): Promise<HotDealLimits> {
    const l =
      (await this.config.get<
        Partial<{ maxHours: number; maxPerCustomer: number; maxUnitsPerBranch: number }>
      >(CONFIG_KEYS.HOT_DEAL_LIMITS)) ?? {};
    const h =
      (await this.config.get<Partial<{ minMinutes: number; maxMinutes: number }>>(
        CONFIG_KEYS.RESERVATION_HOLD_LIMITS,
      )) ?? {};
    return {
      maxHours: l.maxHours ?? DEFAULT_HOT_LIMITS.maxHours,
      maxPerCustomer: l.maxPerCustomer ?? DEFAULT_HOT_LIMITS.maxPerCustomer,
      maxUnitsPerBranch: l.maxUnitsPerBranch ?? DEFAULT_HOT_LIMITS.maxUnitsPerBranch,
      holdMinMinutes: h.minMinutes ?? DEFAULT_HOT_LIMITS.holdMinMinutes,
      holdMaxMinutes: h.maxMinutes ?? DEFAULT_HOT_LIMITS.holdMaxMinutes,
    };
  }

  async showRemainingThreshold(): Promise<number> {
    const l = await this.config.get<{ showRemainingThreshold?: number }>(
      CONFIG_KEYS.HOT_DEAL_LIMITS,
    );
    return l?.showRemainingThreshold ?? 1000;
  }

  /** Minutes a reservation for this deal is held: the deal's own setting, else the platform default (initially 30). */
  async holdMinutes(deal: { holdMinutes: number | null }): Promise<number> {
    const fallback = await this.config.getNumber(CONFIG_KEYS.RESERVATION_HOLD_MINUTES, 30);
    const { holdMinMinutes, holdMaxMinutes } = await this.limits();
    const v = deal.holdMinutes ?? fallback;
    return Math.min(holdMaxMinutes, Math.max(holdMinMinutes, v));
  }

  maxActiveReservations() {
    return this.config.getNumber(CONFIG_KEYS.RESERVATION_MAX_ACTIVE, 3);
  }

  async noShow(): Promise<NoShowConfig> {
    const v = (await this.config.get<Partial<NoShowConfig>>(CONFIG_KEYS.RESERVATION_NOSHOW)) ?? {};
    return {
      threshold: v.threshold ?? 3,
      windowDays: v.windowDays ?? 30,
      blockDays: v.blockDays ?? 7,
    };
  }

  expiringNoticeMinutes() {
    return this.config.getNumber(CONFIG_KEYS.RESERVATION_EXPIRING_NOTICE_MINUTES, 10);
  }

  // ---------------------------------------------------------------- validation of references (tenant safe)
  async validateReferences(organizationId: string, c: HotDealContent) {
    if (c.startAt && c.endAt && new Date(c.endAt).getTime() <= new Date(c.startAt).getTime())
      throw AppError.validation('The end date must be after the start date', 'endAt');
    if (c.categoryId) {
      const cat = await this.prisma.category.findFirst({
        where: { id: c.categoryId, active: true },
      });
      if (!cat) throw AppError.validation('Choose a category from the list', 'categoryId');
    }
    const branchIds = c.allocations.map((a) => a.branchId);
    if (branchIds.length) {
      const n = await this.prisma.merchantBranch.count({
        where: { id: { in: branchIds }, organizationId },
      });
      if (n !== new Set(branchIds).size)
        throw AppError.validation('Choose branches of your own business', 'allocations');
    }
    if (c.media.length) {
      const ids = c.media.map((m) => m.fileId);
      const n = await this.prisma.storedFile.count({
        where: { id: { in: ids }, organizationId, kind: 'DEAL_IMAGE', status: 'AVAILABLE' },
      });
      if (n !== new Set(ids).size)
        throw AppError.validation('One of the images is not available. Upload it again.', 'media');
    }
    await this.eligibility.validateReferences(c.eligibility, await this.enabledCities());
  }

  /** At least one participating branch must be active (HD-04). */
  async requireActiveBranch(organizationId: string, branchIds: string[]) {
    const n = await this.prisma.merchantBranch.count({
      where: { id: { in: branchIds }, organizationId, status: 'ACTIVE' },
    });
    if (n < 1)
      throw new AppError(
        'DEAL_INCOMPLETE',
        'Choose at least one active branch',
        422,
        'allocations',
        [
          {
            code: 'DEAL_INCOMPLETE',
            message: 'Choose at least one active branch',
            field: 'allocations',
          },
        ],
      );
  }

  async merchantTrust(organizationId: string) {
    const m = await this.prisma.merchant.findUnique({ where: { organizationId } });
    return m?.trustLevel ?? 'NEW';
  }

  // ---------------------------------------------------------------- history + audit
  async record(
    tx: Prisma.TransactionClient,
    deal: { id: string; organizationId: string },
    e: HotRecordInput,
  ) {
    const info = actorInfo(e.actor);
    await tx.hotDealHistory.create({
      data: {
        dealId: deal.id,
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
        action: `hot_deal.${e.action.toLowerCase()}`,
        entityType: 'HotDeal',
        entityId: deal.id,
        reason: e.reason ?? null,
        previousState: e.from ? { status: e.from } : undefined,
        newState: e.to ? { status: e.to } : undefined,
        actor: e.actor,
        actorRole: e.actor ? undefined : 'SYSTEM',
        subjectOrganizationId: deal.organizationId,
        meta: e.meta ?? null,
      },
      tx,
    );
  }

  /**
   * The ONLY way an Exclusive Deal changes status on purpose. Illegal transitions are rejected; a concurrent change is
   * detected by the conditional update (status must still be what we read).
   */
  async transition(
    tx: Prisma.TransactionClient,
    deal: { id: string; organizationId: string; status: HotDealStatus },
    to: HotDealStatus,
    e: Omit<HotRecordInput, 'from' | 'to'> & { data?: Prisma.HotDealUncheckedUpdateManyInput },
  ) {
    if (!canTransitionHotDeal(deal.status, to))
      throw new AppError('INVALID_STATE', `A ${deal.status} deal cannot become ${to}`, 409);
    const { data, ...rest } = e;
    const res = await tx.hotDeal.updateMany({
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
  /**
   * Writes content, derived columns and the eligibility rule set. Per-branch stock rows are created or resized ONLY while
   * the deal has never been live (nothing can be reserved yet); afterwards stock changes go through the stock endpoint.
   */
  async applyContent(
    tx: Prisma.TransactionClient,
    deal: {
      id: string;
      organizationId: string;
      eligibilityRuleSetId: string | null;
      status: HotDealStatus;
    },
    content: HotDealContent,
    userId: string | null,
    opts: { bumpVersion?: boolean } = {},
  ) {
    const ruleSetId = await this.eligibility.syncRuleSet(
      tx,
      deal.eligibilityRuleSetId,
      deal.organizationId,
      content.eligibility,
    );
    await tx.hotDeal.update({
      where: { id: deal.id },
      data: {
        content: content as unknown as Prisma.InputJsonValue,
        ...denormalizeHot(content),
        eligibilityRuleSetId: ruleSetId,
        ...(opts.bumpVersion === false ? {} : { version: { increment: 1 } }),
        updatedByUserId: userId,
      },
    });
    if (deal.status === 'DRAFT' || deal.status === 'NEEDS_CHANGES') {
      const tracked = needsInventory(content);
      const wanted = new Map(content.allocations.map((a) => [a.branchId, a.units]));
      const current = await tx.hotDealInventory.findMany({ where: { dealId: deal.id } });
      const have = new Set(current.map((r) => r.branchId));
      const remove = [...have].filter((b) => !wanted.has(b));
      if (remove.length)
        await tx.hotDealInventory.deleteMany({
          where: { dealId: deal.id, branchId: { in: remove } },
        });
      for (const [branchId, units] of wanted) {
        const total = tracked ? units : 0;
        await tx.hotDealInventory.upsert({
          where: { dealId_branchId: { dealId: deal.id, branchId } },
          create: { dealId: deal.id, branchId, total, available: total, tracked },
          update: { total, available: total, reserved: 0, redeemed: 0, tracked },
        });
      }
    }
  }

  // ---------------------------------------------------------------- approval (admin decisions and guardrail auto-publish)
  async approveDeal(
    tx: Prisma.TransactionClient,
    deal: HotRow,
    e: {
      action: 'APPROVE' | 'AUTO_APPROVE';
      actor: Actor | null;
      reason?: string | null;
      reasonAr?: string | null;
      meta?: RequestMeta | null;
    },
    now = new Date(),
  ) {
    const to = hotStatusAfterApproval(deal.startAt, deal.endAt, now);
    // RC-12: the reservation policy in force when the deal goes live is kept on it; later policy changes never alter it
    const content = parseHotContent(deal.content);
    const policy = content.reservationsEnabled
      ? this.reservationPolicy.snapshot(
          await this.reservationPolicy.forDeal(deal.organizationId, content),
          now,
        )
      : null;
    await this.transition(tx, deal, to, {
      ...e,
      data: {
        publishedAt: deal.publishedAt ?? now,
        pausedBy: null,
        ...(policy ? { reservationPolicy: policy as Prisma.InputJsonValue } : {}),
      },
    });
    await this.commercial.earnUpfront('EXCLUSIVE', deal.id, tx);
    await this.versions.recordLive(tx, {
      product: 'EXCLUSIVE',
      subjectId: deal.id,
      organizationId: deal.organizationId,
      content: deal.content,
      reason: 'APPROVED',
      userId: e.actor?.userId ?? null,
      now,
    });
    return to;
  }
}
