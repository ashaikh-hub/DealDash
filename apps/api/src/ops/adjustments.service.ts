import { Injectable, Logger } from '@nestjs/common';
import type { AdjustmentDirection, AdjustmentKind } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { InvoicingService } from '../billing/invoicing.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { FinanceAdminService as CommercialFinanceAdmin } from '../finance/finance-admin.service';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { FinanceAdminService as VoucherFinanceAdmin } from '../vouchers/finance-admin.service';
import { LedgerService } from '../vouchers/ledger.service';
import { RewardsLedgerService } from '../watch/rewards-ledger.service';
import { opsConfig, ref, requiresSecondPerson } from './ops-util';

export interface AdjustmentInput {
  kind: AdjustmentKind;
  direction: AdjustmentDirection;
  amountMinor?: number;
  points?: number;
  currency?: string;
  organizationId?: string | null;
  businessAccountId?: string | null;
  customerUserId?: string | null;
  legalEntityId?: string | null;
  contractId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  caseId?: string | null;
  reasonCode: string;
  reason: string;
  idempotencyKey?: string | null;
}

const POINTS_KINDS: readonly string[] = ['POINTS_ADJUSTMENT', 'REWARD_REVERSAL'];
const DOCUMENT_KINDS: readonly string[] = ['INVOICE_CORRECTION', 'CREDIT_NOTE', 'DEBIT_NOTE'];
const COMMERCIAL_KINDS: readonly string[] = [
  'FUNDING_ADJUSTMENT',
  'CAMPAIGN_UTILIZATION_CORRECTION',
  'ADMIN_ADJUSTMENT',
];

/**
 * Governed financial adjustments. A request records who asked, why, for which market / legal entity / contract / source record,
 * and whether a second person must approve (configuration `operations.approvals.adjustments`). Applying an approved request NEVER
 * edits the original record: it posts a new record through the engine that owns the money (a billing credit / debit note, a
 * payable adjustment, a balanced ledger journal, a commercial finance adjustment or a points adjustment) and links it here.
 * Original -> reversal / adjustment -> corrected position, always append-only and audited.
 */
@Injectable()
export class AdjustmentsService {
  private readonly logger = new Logger('Adjustments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly markets: MarketService,
    private readonly ledger: LedgerService,
    private readonly invoicing: InvoicingService,
    private readonly commercialFinance: CommercialFinanceAdmin,
    private readonly voucherFinance: VoucherFinanceAdmin,
    private readonly rewards: RewardsLedgerService,
  ) {}

  view(a: Prisma.AdjustmentRequestGetPayload<object>, actor?: Actor) {
    return {
      id: a.id,
      reference: a.reference,
      kind: a.kind,
      status: a.status,
      direction: a.direction,
      amountMinor: a.amountMinor,
      points: a.points,
      currency: a.currency,
      market: a.market,
      legalEntityId: a.legalEntityId,
      contractId: a.contractId,
      organizationId: a.organizationId,
      businessAccountId: a.businessAccountId,
      customerUserId: a.customerUserId,
      sourceType: a.sourceType,
      sourceId: a.sourceId,
      caseId: a.caseId,
      reasonCode: a.reasonCode,
      reason: a.reason,
      requiresApproval: a.requiresApproval,
      requestedByUserId: a.requestedByUserId,
      decidedByUserId: a.decidedByUserId,
      decidedAt: a.decidedAt?.toISOString() ?? null,
      decisionReason: a.decisionReason,
      appliedRef: a.appliedRef,
      appliedAt: a.appliedAt?.toISOString() ?? null,
      failureReason: a.failureReason,
      createdAt: a.createdAt.toISOString(),
      /** The viewer can approve: a different person with the approval permission. */
      canDecide:
        !!actor &&
        a.status === 'PENDING_APPROVAL' &&
        a.requestedByUserId !== actor.userId &&
        this.canApprove(actor, a.kind),
    };
  }

  private canApprove(actor: Actor, kind: string) {
    return POINTS_KINDS.includes(kind)
      ? actor.permissions.has('admin.finance.approve') ||
          actor.permissions.has('admin.rewards.manage')
      : actor.permissions.has('admin.finance.approve');
  }

  async list(
    f: { status?: string; kind?: string; organizationId?: string; caseId?: string },
    actor: Actor,
  ) {
    const rows = await this.prisma.adjustmentRequest.findMany({
      where: {
        ...(f.status ? { status: f.status } : {}),
        ...(f.kind ? { kind: f.kind } : {}),
        ...(f.organizationId ? { organizationId: f.organizationId } : {}),
        ...(f.caseId ? { caseId: f.caseId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.view(r, actor));
  }

  async get(id: string, actor: Actor) {
    const r = await this.prisma.adjustmentRequest.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    return this.view(r, actor);
  }

  /** Validates the request against its kind and resolves market / legal entity / business account from the business. */
  private async prepare(b: AdjustmentInput) {
    const amount = b.amountMinor ?? 0;
    const points = b.points ?? 0;
    if (POINTS_KINDS.includes(b.kind)) {
      if (!b.customerUserId || points <= 0)
        throw AppError.validation('A customer and a number of points are required', 'points');
      if (b.kind === 'REWARD_REVERSAL' && b.direction !== 'DEBIT')
        throw AppError.validation('A reward reversal removes points', 'direction');
      const u = await this.prisma.user.findFirst({
        where: { id: b.customerUserId, userType: 'CUSTOMER' },
        select: { id: true },
      });
      if (!u) throw AppError.validation('The customer was not found', 'customerUserId');
      return {
        amount: 0,
        points,
        market: null as string | null,
        legalEntityId: null as string | null,
        businessAccountId: null as string | null,
      };
    }
    if (amount <= 0) throw AppError.validation('A positive amount is required', 'amountMinor');
    if (b.kind === 'RECONCILIATION_ADJUSTMENT')
      return { amount, points: 0, market: null, legalEntityId: null, businessAccountId: null };
    if (!b.organizationId)
      throw AppError.validation('Choose the business this adjustment is for', 'organizationId');
    const org = await this.prisma.organization.findUnique({
      where: { id: b.organizationId },
      select: { id: true, type: true },
    });
    if (!org) throw AppError.validation('The business was not found', 'organizationId');
    if (b.kind === 'SETTLEMENT_ADJUSTMENT' && org.type !== 'MERCHANT')
      throw AppError.validation('Settlement adjustments are for merchants', 'organizationId');
    if (DOCUMENT_KINDS.includes(b.kind)) {
      if (b.sourceType !== 'FinanceDocument' || !b.sourceId)
        throw AppError.validation('Choose the invoice to correct', 'sourceId');
      const doc = await this.prisma.financeDocument.findUnique({ where: { id: b.sourceId } });
      if (!doc || doc.organizationId !== b.organizationId)
        throw AppError.validation('The invoice does not belong to this business', 'sourceId');
      if (b.kind === 'CREDIT_NOTE' && b.direction !== 'CREDIT')
        throw AppError.validation('A credit note is a credit', 'direction');
      if (b.kind === 'DEBIT_NOTE' && b.direction !== 'DEBIT')
        throw AppError.validation('A debit note is a debit', 'direction');
      return {
        amount,
        points: 0,
        market: doc.market,
        legalEntityId: doc.legalEntityId,
        businessAccountId: doc.businessAccountId,
      };
    }
    let legalEntityId = b.legalEntityId ?? null;
    const businessAccountId = b.businessAccountId ?? null;
    if (businessAccountId) {
      const acc = await this.prisma.businessAccount.findUnique({
        where: { id: businessAccountId },
      });
      if (!acc || acc.organizationId !== b.organizationId)
        throw AppError.validation(
          'The business account does not belong to this business',
          'businessAccountId',
        );
      legalEntityId ??= acc.legalEntityId;
    }
    if (legalEntityId) {
      const le = await this.prisma.legalEntity.findUnique({ where: { id: legalEntityId } });
      if (!le || le.organizationId !== b.organizationId)
        throw AppError.validation(
          'The legal entity does not belong to this business',
          'legalEntityId',
        );
    }
    const market = await this.markets
      .resolveMarket(b.organizationId, { legalEntityId })
      .catch(() => null);
    return { amount, points: 0, market, legalEntityId, businessAccountId };
  }

  /** Maker: record the request; below its threshold (and where configuration allows) it is applied at once. */
  async request(actor: Actor, b: AdjustmentInput, meta: RequestMeta) {
    const p = await this.prepare(b);
    // money adjustments are in the stated currency, else the market's (never assumed)
    const currency =
      b.currency ??
      (p.market ? (await this.markets.profile(p.market)).currency : null) ??
      (b.organizationId
        ? (await this.markets.profileOfOrganization(b.organizationId)).currency
        : null);
    const cfg = await opsConfig(this.config);
    if (!cfg.reasons.adjustment.some((r) => r.code === b.reasonCode))
      throw AppError.validation('Choose a configured reason', 'reasonCode');
    const needs = requiresSecondPerson(
      cfg.approvals.adjustments[b.kind],
      POINTS_KINDS.includes(b.kind) ? p.points : p.amount,
    );
    const key = `adj-req:${b.idempotencyKey ?? meta.requestId}`;
    const prior = await this.prisma.adjustmentRequest.findUnique({
      where: { idempotencyKey: key },
    });
    if (prior) return this.view(prior, actor);
    if (
      b.caseId &&
      !(await this.prisma.disputeCase.findUnique({ where: { id: b.caseId }, select: { id: true } }))
    )
      throw AppError.validation('The case was not found', 'caseId');
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.adjustmentRequest.create({
        data: {
          reference: ref('ADJ'),
          kind: b.kind,
          status: needs ? 'PENDING_APPROVAL' : 'APPROVED',
          direction: b.direction,
          amountMinor: p.amount,
          points: p.points,
          currency:
            currency ??
            (await this.markets.profile((await this.markets.settings()).defaultMarket)).currency,
          market: p.market,
          legalEntityId: p.legalEntityId,
          contractId: b.contractId ?? null,
          organizationId: b.organizationId ?? null,
          businessAccountId: p.businessAccountId,
          customerUserId: b.customerUserId ?? null,
          sourceType: b.sourceType ?? null,
          sourceId: b.sourceId ?? null,
          caseId: b.caseId ?? null,
          reasonCode: b.reasonCode,
          reason: b.reason,
          requiresApproval: needs,
          requestedByUserId: actor.userId,
          requestedByRole: actor.membership?.roleCode ?? null,
          idempotencyKey: key,
        },
      });
      await this.audit.record(
        {
          action: 'ADJUSTMENT_REQUESTED',
          entityType: 'AdjustmentRequest',
          entityId: r.id,
          actor,
          subjectOrganizationId: r.organizationId,
          reason: b.reason,
          newState: {
            kind: b.kind,
            direction: b.direction,
            amountMinor: p.amount,
            points: p.points,
            requiresApproval: needs,
            sourceType: b.sourceType,
            sourceId: b.sourceId,
          },
          market: p.market,
          legalEntityId: p.legalEntityId,
          meta,
        },
        tx,
      );
      return r;
    });
    if (!needs) return this.view(await this.apply(actor, row.id, meta), actor);
    return this.view(row, actor);
  }

  /** Checker: a different person approves (then it is applied) or rejects. */
  async decide(actor: Actor, id: string, approve: boolean, reason: string, meta: RequestMeta) {
    const a = await this.prisma.adjustmentRequest.findUnique({ where: { id } });
    if (!a) throw AppError.notFound();
    if (a.status !== 'PENDING_APPROVAL')
      throw new AppError('INVALID_STATE', 'This adjustment was already decided', 409);
    if (a.requestedByUserId === actor.userId)
      throw new AppError(
        'CHECKER_REQUIRED',
        'A different person must approve this adjustment',
        403,
      );
    if (!this.canApprove(actor, a.kind)) throw AppError.forbidden();
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.adjustmentRequest.updateMany({
        where: { id, status: 'PENDING_APPROVAL' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          decidedByUserId: actor.userId,
          decidedAt: new Date(),
          decisionReason: reason,
        },
      });
      if (r.count !== 1)
        throw new AppError(
          'VERSION_CONFLICT',
          'This adjustment changed. Reload and try again.',
          409,
        );
      await this.audit.record(
        {
          action: approve ? 'ADJUSTMENT_APPROVED' : 'ADJUSTMENT_REJECTED',
          entityType: 'AdjustmentRequest',
          entityId: id,
          actor,
          subjectOrganizationId: a.organizationId,
          reason,
          approvalRef: a.requestedByUserId,
          previousState: { status: 'PENDING_APPROVAL' },
          newState: { status: approve ? 'APPROVED' : 'REJECTED' },
          market: a.market,
          legalEntityId: a.legalEntityId,
          meta,
        },
        tx,
      );
    });
    if (approve) return this.view(await this.apply(actor, id, meta), actor);
    return this.get(id, actor);
  }

  /** Posts the correcting record through the engine that owns it. Exactly once per request (status claim). */
  private async apply(actor: Actor, id: string, meta: RequestMeta) {
    const claimed = await this.prisma.adjustmentRequest.updateMany({
      where: { id, status: 'APPROVED', appliedAt: null },
      data: { appliedAt: new Date() },
    });
    const a = await this.prisma.adjustmentRequest.findUniqueOrThrow({ where: { id } });
    if (claimed.count !== 1) return a;
    const sign = a.direction === 'CREDIT' ? 1 : -1;
    try {
      let appliedRef: Record<string, unknown>;
      if (DOCUMENT_KINDS.includes(a.kind)) {
        // billing's own credit / debit note (it keeps its issuance approval and sequence rules)
        const doc = (await this.invoicing.note(
          actor,
          a.sourceId!,
          {
            kind: a.direction === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
            amountMinor: a.amountMinor,
            reason: `${a.reference}: ${a.reason}`,
          },
          meta,
        )) as { id?: string; status?: string } | null;
        appliedRef = { kind: 'FINANCE_DOCUMENT', id: doc?.id ?? null, status: doc?.status ?? null };
      } else if (a.kind === 'SETTLEMENT_ADJUSTMENT') {
        const r = await this.voucherFinance.adjust(
          actor,
          {
            organizationId: a.organizationId!,
            amountHalalas: sign * a.amountMinor,
            reason: `${a.reference}: ${a.reason}`,
            currency: a.currency,
          },
          meta,
        );
        appliedRef = { kind: 'PAYABLE_ADJUSTMENT', id: r.journalId };
      } else if (a.kind === 'RECONCILIATION_ADJUSTMENT') {
        const j = await this.prisma.$transaction((tx) =>
          this.ledger.post(tx, {
            type: 'ADJUSTMENT',
            sourceType: 'AdjustmentRequest',
            sourceId: a.id,
            idempotencyKey: `adj-apply:${a.id}`,
            currency: a.currency,
            memo: `Reconciliation adjustment ${a.reference}: ${a.reason}`,
            reasonCode: a.reasonCode,
            actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
            lines: [
              { family: 'PSP_CLEARING', amountHalalas: sign * a.amountMinor },
              { family: 'ADJUSTMENTS', amountHalalas: -sign * a.amountMinor },
            ],
          }),
        );
        appliedRef = { kind: 'JOURNAL', id: j.journalId };
      } else if (POINTS_KINDS.includes(a.kind)) {
        // the rewards ledger is the only writer of points: an already-approved points adjustment record, applied through it
        const entryId = await this.prisma.$transaction(async (tx) => {
          const accountId = await this.rewards.ensureAccount(tx, a.customerUserId!);
          const ra = await tx.rewardAdjustment.create({
            data: {
              accountId,
              points: sign * a.points,
              reasonCode: a.reasonCode,
              ticketRef: a.reference,
              reason: a.reason,
              status: 'APPROVED',
              requestedByUserId: a.requestedByUserId,
              decidedByUserId: actor.userId,
              decidedAt: new Date(),
              decisionReason: a.decisionReason ?? 'Applied from the governed adjustment workflow',
            },
          });
          const e = await this.rewards.applyAdjustment(
            tx,
            {
              id: ra.id,
              userId: a.customerUserId!,
              points: sign * a.points,
              reasonCode: a.reasonCode,
            },
            { userId: actor.userId, role: actor.membership?.roleCode ?? null },
          );
          await tx.rewardAdjustment.update({ where: { id: ra.id }, data: { entryId: e.id } });
          return e.id;
        });
        appliedRef = { kind: 'REWARD_ADJUSTMENT', id: entryId };
      } else if (COMMERCIAL_KINDS.includes(a.kind)) {
        const caseId = a.sourceType === 'CommercialCase' ? a.sourceId! : undefined;
        const r = await this.commercialFinance.adjust(
          actor,
          {
            caseId,
            organizationId: a.organizationId!,
            kind: a.direction as 'CREDIT' | 'DEBIT',
            amountHalalas: a.amountMinor,
            reason: `${a.reference}: ${a.reason}`,
          },
          meta,
        );
        appliedRef = { kind: 'FINANCE_ADJUSTMENT', id: r.id };
      } else
        throw new AppError(
          'ADJUSTMENT_NOT_APPLICABLE',
          'This adjustment kind cannot be applied',
          409,
        );
      await this.prisma.$transaction(async (tx) => {
        await tx.adjustmentRequest.update({
          where: { id },
          data: { status: 'APPLIED', appliedRef: appliedRef as Prisma.InputJsonValue },
        });
        if (a.caseId)
          await tx.caseNote.create({
            data: {
              caseId: a.caseId,
              authorUserId: actor.userId,
              visibility: 'INTERNAL',
              kind: 'SYSTEM',
              authorKind: 'SYSTEM',
              body: `Adjustment ${a.reference} applied (${a.kind} ${a.direction} ${a.amountMinor || a.points}).`,
            },
          });
        await this.audit.record(
          {
            action: 'ADJUSTMENT_APPLIED',
            entityType: 'AdjustmentRequest',
            entityId: id,
            actor,
            subjectOrganizationId: a.organizationId,
            approvalRef: a.decidedByUserId,
            newState: { status: 'APPLIED', appliedRef },
            market: a.market,
            legalEntityId: a.legalEntityId,
            meta,
          },
          tx,
        );
      });
    } catch (e) {
      const msg = e instanceof AppError ? `${e.code}: ${e.message}` : (e as Error).message;
      this.logger.warn(`Adjustment ${a.reference} failed: ${msg}`);
      await this.prisma.adjustmentRequest.update({
        where: { id },
        data: { status: 'FAILED', failureReason: msg.slice(0, 500) },
      });
      await this.audit.record({
        action: 'ADJUSTMENT_FAILED',
        entityType: 'AdjustmentRequest',
        entityId: id,
        actor,
        subjectOrganizationId: a.organizationId,
        reason: msg.slice(0, 300),
        market: a.market,
        meta,
      });
    }
    return this.prisma.adjustmentRequest.findUniqueOrThrow({ where: { id } });
  }

  /** A failed application can be retried by a finance approver (still exactly once). */
  async retry(actor: Actor, id: string, meta: RequestMeta) {
    const a = await this.prisma.adjustmentRequest.findUnique({ where: { id } });
    if (!a) throw AppError.notFound();
    if (a.status !== 'FAILED')
      throw new AppError('INVALID_STATE', 'Only a failed adjustment can be retried', 409);
    if (!this.canApprove(actor, a.kind)) throw AppError.forbidden();
    await this.prisma.adjustmentRequest.updateMany({
      where: { id, status: 'FAILED' },
      data: { status: 'APPROVED', appliedAt: null, failureReason: null },
    });
    await this.audit.record({
      action: 'ADJUSTMENT_RETRIED',
      entityType: 'AdjustmentRequest',
      entityId: id,
      actor,
      subjectOrganizationId: a.organizationId,
      market: a.market,
      meta,
    });
    return this.view(await this.apply(actor, id, meta), actor);
  }
}
