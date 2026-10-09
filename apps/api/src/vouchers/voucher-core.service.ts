import { Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { canTransitionVoucher, type VoucherAction, type VoucherStatus } from '@dealdash/types';
import {
  DEFAULT_VOUCHER_LIMITS,
  type VoucherContent,
  type VoucherLimits,
} from '@dealdash/validation';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { CommercialService } from '../finance/commercial.service';
import { CampaignVersionService } from '../platform/campaign-version.service';
import type { Actor, RequestMeta } from '../common/request-context';
import { AccessScopeService } from '../platform/access-scope.service';
import { TenantService } from '../identity/tenant.service';
import { actorInfo, DealCoreService } from '../live-deals/deal-core.service';
import { EligibilityService } from '../live-deals/eligibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import {
  denormalizeVoucher,
  parseVoucherContent,
  voucherStatusAfterApproval,
} from './voucher-content';

export const VOUCHER_INCLUDE = {
  category: true,
  organization: { include: { merchant: true } },
  branches: { include: { branch: true } },
  ruleSet: { include: { conditions: true } },
} satisfies Prisma.VoucherInclude;
export type VoucherRow = Prisma.VoucherGetPayload<{ include: typeof VOUCHER_INCLUDE }>;

/** Statuses where the voucher is already approved (material changes are no longer possible). */
export const VOUCHER_APPROVED_STATUSES: readonly VoucherStatus[] = [
  'SCHEDULED',
  'ON_SALE',
  'PAUSED',
  'SOLD_OUT',
  'SUSPENDED',
];

export interface VoucherRecordInput {
  action: VoucherAction;
  from?: VoucherStatus | null;
  to?: VoucherStatus | null;
  actor: Actor | null;
  reason?: string | null;
  reasonAr?: string | null;
  fields?: string[];
  snapshot?: unknown;
  meta?: RequestMeta | null;
}

export interface RefundPolicy {
  windowHours: number;
  outsideWindow: 'REVIEW' | 'BLOCK';
  /** Admin-initiated refunds above this many halalas need a second approver (0 = always). */
  checkerThresholdHalalas: number;
}
export interface FeeRule {
  percentBps: number;
  fixedHalalas: number;
  version: number;
}

/** Shared domain operations for Vouchers: loading, reference checks, the state machine, history, audit and platform rules. */
@Injectable()
export class VoucherCoreService {
  constructor(
    readonly prisma: PrismaService,
    readonly commercial: CommercialService,
    readonly versions: CampaignVersionService,
    readonly audit: AuditService,
    readonly config: SystemConfigService,
    private readonly tenant: TenantService,
    private readonly eligibility: EligibilityService,
    private readonly liveCore: DealCoreService,
    readonly access: AccessScopeService,
  ) {}

  // ---------------------------------------------------------------- tenant scope
  /** Merchant routes: own organisation only (404 otherwise) and never for branch staff. Scoped members are checked per record by AccessScopeService. */
  requireMerchantScope(actor: Actor, organizationId: string) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
  }

  // ---------------------------------------------------------------- loading
  async loadOwned(organizationId: string, id: string): Promise<VoucherRow> {
    const row = await this.prisma.voucher.findFirst({
      where: { id, organizationId },
      include: VOUCHER_INCLUDE,
    });
    if (!row) throw AppError.notFound();
    return row;
  }

  async loadAny(id: string): Promise<VoucherRow> {
    const row = await this.prisma.voucher.findUnique({ where: { id }, include: VOUCHER_INCLUDE });
    if (!row) throw AppError.notFound();
    return row;
  }

  // ---------------------------------------------------------------- platform rules (configuration, never hard-coded policy)
  enabledCities() {
    return this.liveCore.enabledCities();
  }

  async limits(): Promise<VoucherLimits> {
    const l = (await this.config.get<Partial<VoucherLimits>>(CONFIG_KEYS.VOUCHER_LIMITS)) ?? {};
    return { ...DEFAULT_VOUCHER_LIMITS, ...l };
  }

  /** Minutes unpaid checkout units are held (VC-11). */
  checkoutHoldMinutes() {
    return this.config.getNumber(CONFIG_KEYS.VOUCHER_CHECKOUT_HOLD_MINUTES, 10);
  }
  paymentRetryLimit() {
    return this.config.getNumber(CONFIG_KEYS.VOUCHER_PAYMENT_RETRY_LIMIT, 3);
  }
  expiryReminderDays() {
    return this.config.getNumber(CONFIG_KEYS.VOUCHER_EXPIRY_REMINDER_DAYS, 3);
  }
  webhookToleranceSeconds() {
    return this.config.getNumber(CONFIG_KEYS.PAYMENT_WEBHOOK_TOLERANCE_SECONDS, 300);
  }

  /** MOCK defaults. The real values are a founder / VALIDATE-KSA decision (VK-04). */
  async refundPolicy(): Promise<RefundPolicy> {
    const v =
      (await this.config.get<Partial<RefundPolicy>>(CONFIG_KEYS.VOUCHER_REFUND_POLICY)) ?? {};
    return {
      windowHours: v.windowHours ?? 24,
      outsideWindow: v.outsideWindow === 'BLOCK' ? 'BLOCK' : 'REVIEW',
      checkerThresholdHalalas: v.checkerThresholdHalalas ?? 0,
    };
  }

  async feeRule(): Promise<FeeRule> {
    const v = (await this.config.get<Partial<FeeRule>>(CONFIG_KEYS.VOUCHER_FEE_RULE)) ?? {};
    return {
      percentBps: v.percentBps ?? 1000,
      fixedHalalas: v.fixedHalalas ?? 0,
      version: v.version ?? 1,
    };
  }

  /** Platform fee for a redeemed price under the versioned rule: percentage plus fixed, never more than the price. */
  computeFee(priceHalalas: number, rule: FeeRule): number {
    const fee = Math.round((priceHalalas * rule.percentBps) / 10_000) + rule.fixedHalalas;
    return Math.max(0, Math.min(priceHalalas, fee));
  }

  async accrualPoint(): Promise<string> {
    return (
      (await this.config.get<string>(CONFIG_KEYS.VOUCHER_PAYABLE_ACCRUAL_POINT)) ?? 'REDEMPTION'
    );
  }
  async expiredValuePolicy(): Promise<string> {
    return (
      (await this.config.get<string>(CONFIG_KEYS.VOUCHER_EXPIRED_VALUE_POLICY)) ??
      'UNDECIDED_VALIDATE_KSA'
    );
  }

  // ---------------------------------------------------------------- validation of references (tenant safe)
  async validateReferences(organizationId: string, c: VoucherContent) {
    if (
      c.saleStartAt &&
      c.saleEndAt &&
      new Date(c.saleEndAt).getTime() <= new Date(c.saleStartAt).getTime()
    )
      throw AppError.validation('The sale end must be after the sale start', 'saleEndAt');
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
    await this.eligibility.validateReferences(c.eligibility, await this.enabledCities());
  }

  /** At least one participating branch must be active. */
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

  async merchantTrust(organizationId: string) {
    const m = await this.prisma.merchant.findUnique({ where: { organizationId } });
    return m?.trustLevel ?? 'NEW';
  }

  // ---------------------------------------------------------------- history + audit
  async record(
    tx: Prisma.TransactionClient,
    voucher: { id: string; organizationId: string },
    e: VoucherRecordInput,
  ) {
    const info = actorInfo(e.actor);
    await tx.voucherHistory.create({
      data: {
        voucherId: voucher.id,
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
        action: `voucher.${e.action.toLowerCase()}`,
        entityType: 'Voucher',
        entityId: voucher.id,
        reason: e.reason ?? null,
        previousState: e.from ? { status: e.from } : undefined,
        newState: e.to ? { status: e.to } : undefined,
        actor: e.actor,
        actorRole: e.actor ? undefined : 'SYSTEM',
        subjectOrganizationId: voucher.organizationId,
        meta: e.meta ?? null,
      },
      tx,
    );
  }

  /**
   * The ONLY way a Voucher changes status on purpose. Illegal transitions are rejected; a concurrent change is detected by
   * the conditional update (status must still be what we read).
   */
  async transition(
    tx: Prisma.TransactionClient,
    voucher: { id: string; organizationId: string; status: VoucherStatus },
    to: VoucherStatus,
    e: Omit<VoucherRecordInput, 'from' | 'to'> & { data?: Prisma.VoucherUncheckedUpdateManyInput },
  ) {
    if (!canTransitionVoucher(voucher.status, to))
      throw new AppError('INVALID_STATE', `A ${voucher.status} voucher cannot become ${to}`, 409);
    const { data, ...rest } = e;
    const res = await tx.voucher.updateMany({
      where: { id: voucher.id, status: voucher.status },
      data: {
        ...(data ?? {}),
        status: to,
        updatedByUserId: e.actor?.userId ?? null,
        version: { increment: 1 },
      },
    });
    if (res.count !== 1)
      throw new AppError('VERSION_CONFLICT', 'The voucher changed. Reload and try again.', 409);
    await this.record(tx, voucher, { ...rest, from: voucher.status, to });
  }

  // ---------------------------------------------------------------- content
  /**
   * Writes content, derived columns, the eligibility rule set and branch applicability. Issuance capacity is set from the
   * content ONLY while the voucher has never been on sale; afterwards it changes through the stock endpoint.
   */
  async applyContent(
    tx: Prisma.TransactionClient,
    voucher: {
      id: string;
      organizationId: string;
      eligibilityRuleSetId: string | null;
      status: VoucherStatus;
    },
    content: VoucherContent,
    userId: string | null,
    opts: { bumpVersion?: boolean } = {},
  ) {
    const ruleSetId = await this.eligibility.syncRuleSet(
      tx,
      voucher.eligibilityRuleSetId,
      voucher.organizationId,
      content.eligibility,
    );
    const editable = voucher.status === 'DRAFT' || voucher.status === 'NEEDS_CHANGES';
    await tx.voucher.update({
      where: { id: voucher.id },
      data: {
        content: content as unknown as Prisma.InputJsonValue,
        ...denormalizeVoucher(content),
        ...(editable ? { totalQty: content.totalQty } : {}),
        eligibilityRuleSetId: ruleSetId,
        ...(opts.bumpVersion === false ? {} : { version: { increment: 1 } }),
        updatedByUserId: userId,
      },
    });
    if (editable) {
      const wanted = new Set(content.branchIds);
      const current = await tx.voucherBranch.findMany({ where: { voucherId: voucher.id } });
      const have = new Set(current.map((r) => r.branchId));
      const remove = [...have].filter((b) => !wanted.has(b));
      if (remove.length)
        await tx.voucherBranch.deleteMany({
          where: { voucherId: voucher.id, branchId: { in: remove } },
        });
      const add = [...wanted].filter((b) => !have.has(b));
      if (add.length)
        await tx.voucherBranch.createMany({
          data: add.map((branchId) => ({ voucherId: voucher.id, branchId })),
          skipDuplicates: true,
        });
    }
  }

  /** Approval (admin decisions and guardrail auto-publish). */
  async approve(
    tx: Prisma.TransactionClient,
    voucher: VoucherRow,
    e: {
      action: 'APPROVE' | 'AUTO_APPROVE';
      actor: Actor | null;
      reason?: string | null;
      reasonAr?: string | null;
      meta?: RequestMeta | null;
    },
    now = new Date(),
  ) {
    const to = voucherStatusAfterApproval(voucher.saleStartAt, voucher.saleEndAt, now);
    await this.transition(tx, voucher, to, {
      ...e,
      data: { publishedAt: voucher.publishedAt ?? now, pausedBy: null },
    });
    await this.commercial.earnUpfront('VOUCHER', voucher.id, tx);
    await this.versions.recordLive(tx, {
      product: 'VOUCHER',
      subjectId: voucher.id,
      organizationId: voucher.organizationId,
      content: voucher.content,
      reason: 'APPROVED',
      userId: e.actor?.userId ?? null,
      now,
    });
    return to;
  }

  content(row: { content: unknown }): VoucherContent {
    return parseVoucherContent(row.content);
  }
}
