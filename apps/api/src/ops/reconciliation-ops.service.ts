import { Injectable } from '@nestjs/common';
import { RECON_EXCEPTION_STATUSES, type ReconSource, type ReconStatus } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { DisputeService } from '../operations/dispute.service';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { D, ref } from './ops-util';

export interface StatementLine {
  reference: string;
  amountMinor: number;
  currency?: string;
  occurredAt: string;
}
const STATEMENT_SOURCES: readonly ReconSource[] = [
  'PAYMENT_GATEWAY',
  'REFUND',
  'SETTLEMENT',
  'RECEIPT',
];
/** Amounts equal but dates further apart than this are a TIMING_DIFFERENCE (explained by cut-off, not by money). */
const TIMING_TOLERANCE_MS = D;

interface Internal {
  type: string;
  id: string;
  reference: string | null;
  amountMinor: number;
  currency: string;
  at: Date | null;
  final: boolean;
  organizationId: string | null;
}

/**
 * Reconciliation exceptions (Stage 8). Two inputs: an external statement (payment gateway, refunds, settlement payouts, receipts)
 * matched line by line against DealDash records by reference, amount, currency and date; and internal consistency checks between
 * the operational records and the ledger (voucher purchases, redemptions, merchant payable, sponsor / Watch & Earn / loyalty
 * funding, invoices). Every line becomes an item: MATCHED, or an exception (PARTIAL_MATCH, MISSING_INTERNAL, MISSING_EXTERNAL,
 * AMOUNT_MISMATCH, DUPLICATE, TIMING_DIFFERENCE, MANUAL_REVIEW) that is worked to RESOLVED with an owner and a resolution; where
 * money must move the resolution links a governed adjustment. Nothing here edits a financial record.
 */
@Injectable()
export class ReconciliationOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly disputes: DisputeService,
    private readonly markets: MarketService,
  ) {}

  view(i: Prisma.ReconciliationItemGetPayload<object>) {
    return {
      id: i.id,
      reference: i.reference,
      runId: i.runId,
      source: i.source,
      status: i.status,
      matchStatus: i.matchStatus,
      externalReference: i.externalReference,
      externalAmountMinor: i.externalAmountMinor,
      externalAt: i.externalAt?.toISOString() ?? null,
      internalType: i.internalType,
      internalId: i.internalId,
      internalReference: i.internalReference,
      internalAmountMinor: i.internalAmountMinor,
      internalAt: i.internalAt?.toISOString() ?? null,
      varianceMinor: i.varianceMinor,
      currency: i.currency,
      market: i.market,
      organizationId: i.organizationId,
      ownerUserId: i.ownerUserId,
      resolution: i.resolution,
      adjustmentRequestId: i.adjustmentRequestId,
      caseId: i.caseId,
      resolvedAt: i.resolvedAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    };
  }

  async list(f: {
    status?: string;
    source?: string;
    exceptions?: boolean;
    runId?: string;
    organizationId?: string;
  }) {
    const rows = await this.prisma.reconciliationItem.findMany({
      where: {
        ...(f.status
          ? { status: f.status }
          : f.exceptions
            ? { status: { in: [...RECON_EXCEPTION_STATUSES] } }
            : {}),
        ...(f.source ? { source: f.source } : {}),
        ...(f.runId ? { runId: f.runId } : {}),
        ...(f.organizationId ? { organizationId: f.organizationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map((r) => this.view(r));
  }

  async runs() {
    const rows = await this.prisma.reconciliationRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      source: r.source,
      kind: r.kind,
      fileName: r.fileName,
      currency: r.currency,
      periodFrom: r.periodFrom?.toISOString() ?? null,
      periodTo: r.periodTo?.toISOString() ?? null,
      totals: r.totals,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async findInternal(source: ReconSource, reference: string): Promise<Internal | null> {
    if (source === 'PAYMENT_GATEWAY') {
      const p = await this.prisma.payment.findUnique({
        where: { providerReference: reference },
        include: { order: { select: { organizationId: true, reference: true, currency: true } } },
      });
      return p
        ? {
            type: 'Payment',
            id: p.id,
            reference: p.order.reference,
            amountMinor: p.amountHalalas,
            currency: p.currency,
            at: p.completedAt ?? p.createdAt,
            final: ['SUCCEEDED', 'REFUND_PENDING', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(
              p.status,
            ),
            organizationId: p.order.organizationId,
          }
        : null;
    }
    if (source === 'REFUND') {
      const r = await this.prisma.refund.findFirst({
        where: { providerRefundReference: reference },
      });
      return r
        ? {
            type: 'Refund',
            id: r.id,
            reference: r.reference,
            amountMinor: r.amountHalalas,
            currency: r.currency,
            at: r.refundedAt ?? r.updatedAt,
            final: r.status === 'REFUNDED',
            organizationId: r.organizationId,
          }
        : null;
    }
    if (source === 'SETTLEMENT') {
      const p = await this.prisma.settlementPayout.findFirst({
        where: { externalRef: reference, status: 'PAID' },
        include: { settlement: true },
      });
      return p
        ? {
            type: 'SettlementPayout',
            id: p.id,
            reference: p.settlement.reference,
            amountMinor: p.amountMinor,
            currency: p.settlement.currency,
            at: p.createdAt,
            final: true,
            organizationId: p.settlement.organizationId,
          }
        : null;
    }
    const f = await this.prisma.financePayment.findFirst({
      where: { externalReference: reference },
    });
    return f
      ? {
          type: 'FinancePayment',
          id: f.id,
          reference: f.reference,
          amountMinor: f.amountHalalas,
          currency: f.currency,
          at: f.receivedAt,
          final: f.status !== 'REVERSED',
          organizationId: f.organizationId,
        }
      : null;
  }

  private classify(
    line: StatementLine,
    internal: Internal | null,
    seen: Set<string>,
    currency: string,
  ): ReconStatus {
    if (seen.has(line.reference)) return 'DUPLICATE';
    if (!internal) return 'MISSING_INTERNAL';
    if (!internal.final) return 'PARTIAL_MATCH';
    if (
      (line.currency ?? currency) !== internal.currency ||
      line.amountMinor !== internal.amountMinor
    )
      return 'AMOUNT_MISMATCH';
    if (
      internal.at &&
      Math.abs(new Date(line.occurredAt).getTime() - internal.at.getTime()) > TIMING_TOLERANCE_MS
    )
      return 'TIMING_DIFFERENCE';
    return 'MATCHED';
  }

  /** An external statement: each line matched by reference, then every internal record of the period missing from it. */
  async importStatement(
    actor: Actor,
    b: {
      source: ReconSource;
      currency?: string;
      fileName?: string | null;
      periodFrom?: string | null;
      periodTo?: string | null;
      lines: StatementLine[];
    },
    meta: RequestMeta,
  ) {
    if (!STATEMENT_SOURCES.includes(b.source))
      throw new AppError(
        'RECON_INVALID',
        'Statements can be imported for payment gateway, refund, settlement and receipt sources',
        400,
      );
    // a statement is in its stated currency, else the default market's (configured, never a hard-coded country)
    const currency =
      b.currency ??
      (await this.markets.profile((await this.markets.settings()).defaultMarket)).currency;
    const from = b.periodFrom ? new Date(b.periodFrom) : null;
    const to = b.periodTo ? new Date(b.periodTo) : null;
    const run = await this.prisma.reconciliationRun.create({
      data: {
        reference: ref('RCN'),
        source: b.source,
        kind: 'STATEMENT',
        fileName: b.fileName ?? null,
        periodFrom: from,
        periodTo: to,
        currency,
        createdByUserId: actor.userId,
      },
    });
    const seen = new Set<string>();
    const matchedIds = new Set<string>();
    const counts: Record<string, number> = {};
    for (const line of b.lines) {
      const internal = await this.findInternal(b.source, line.reference);
      const status = this.classify(line, internal, seen, currency);
      seen.add(line.reference);
      if (internal) matchedIds.add(internal.id);
      counts[status] = (counts[status] ?? 0) + 1;
      await this.prisma.reconciliationItem.create({
        data: {
          reference: ref('RCI'),
          runId: run.id,
          source: b.source,
          status,
          matchStatus: status,
          externalReference: line.reference,
          externalAmountMinor: line.amountMinor,
          externalAt: new Date(line.occurredAt),
          internalType: internal?.type ?? null,
          internalId: internal?.id ?? null,
          internalReference: internal?.reference ?? null,
          internalAmountMinor: internal?.amountMinor ?? null,
          internalAt: internal?.at ?? null,
          varianceMinor: line.amountMinor - (internal?.amountMinor ?? 0),
          currency: line.currency ?? currency,
          organizationId: internal?.organizationId ?? null,
        },
      });
      if (b.source === 'SETTLEMENT' && internal && status !== 'DUPLICATE') {
        const payout = await this.prisma.settlementPayout.findUnique({
          where: { id: internal.id },
          select: { settlementId: true },
        });
        if (payout)
          await this.prisma.settlement.update({
            where: { id: payout.settlementId },
            data: { reconciliationStatus: status === 'MATCHED' ? 'MATCHED' : 'EXCEPTION' },
          });
      }
    }
    // records DealDash holds for the period that the statement does not mention
    if (from && to) {
      const missing: Internal[] = [];
      if (b.source === 'PAYMENT_GATEWAY')
        for (const p of await this.prisma.payment.findMany({
          where: {
            status: { in: ['SUCCEEDED', 'REFUNDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'] },
            completedAt: { gte: from, lte: to },
            currency,
          },
          include: { order: { select: { organizationId: true, reference: true, currency: true } } },
          take: 1000,
        }))
          if (!matchedIds.has(p.id) && p.providerReference)
            missing.push({
              type: 'Payment',
              id: p.id,
              reference: p.providerReference,
              amountMinor: p.amountHalalas,
              currency: p.currency,
              at: p.completedAt,
              final: true,
              organizationId: p.order.organizationId,
            });
      if (b.source === 'REFUND')
        for (const r of await this.prisma.refund.findMany({
          where: { status: 'REFUNDED', refundedAt: { gte: from, lte: to } },
          take: 1000,
        }))
          if (!matchedIds.has(r.id))
            missing.push({
              type: 'Refund',
              id: r.id,
              reference: r.providerRefundReference ?? r.reference,
              amountMinor: r.amountHalalas,
              currency: r.currency,
              at: r.refundedAt,
              final: true,
              organizationId: r.organizationId,
            });
      if (b.source === 'SETTLEMENT')
        for (const p of await this.prisma.settlementPayout.findMany({
          where: { status: 'PAID', createdAt: { gte: from, lte: to } },
          include: { settlement: true },
          take: 1000,
        }))
          if (!matchedIds.has(p.id))
            missing.push({
              type: 'SettlementPayout',
              id: p.id,
              reference: p.externalRef,
              amountMinor: p.amountMinor,
              currency: p.settlement.currency,
              at: p.createdAt,
              final: true,
              organizationId: p.settlement.organizationId,
            });
      for (const m of missing) {
        counts.MISSING_EXTERNAL = (counts.MISSING_EXTERNAL ?? 0) + 1;
        await this.prisma.reconciliationItem.create({
          data: {
            reference: ref('RCI'),
            runId: run.id,
            source: b.source,
            status: 'MISSING_EXTERNAL',
            matchStatus: 'MISSING_EXTERNAL',
            internalType: m.type,
            internalId: m.id,
            internalReference: m.reference,
            internalAmountMinor: m.amountMinor,
            internalAt: m.at,
            varianceMinor: -m.amountMinor,
            currency: m.currency,
            organizationId: m.organizationId,
          },
        });
      }
    }
    await this.prisma.reconciliationRun.update({
      where: { id: run.id },
      data: { totals: { lines: b.lines.length, ...counts } },
    });
    await this.audit.record({
      action: 'RECONCILIATION_STATEMENT_IMPORTED',
      entityType: 'ReconciliationRun',
      entityId: run.id,
      actor,
      newState: { source: b.source, lines: b.lines.length, ...counts },
      meta,
    });
    return {
      runId: run.id,
      reference: run.reference,
      totals: { lines: b.lines.length, ...counts },
    };
  }

  /** Internal consistency checks between operational records and the ledger. Re-running never duplicates an open exception. */
  async consistency(actor: Actor, meta: RequestMeta, now = new Date()) {
    const since = new Date(now.getTime() - 90 * D);
    const run = await this.prisma.reconciliationRun.create({
      data: {
        reference: ref('RCN'),
        source: 'INTERNAL',
        kind: 'CONSISTENCY',
        createdByUserId: actor.userId,
      },
    });
    const counts: Record<string, number> = {};
    const raise = async (
      source: ReconSource,
      status: ReconStatus,
      i: {
        type: string;
        id: string;
        reference: string | null;
        expected: number;
        actual: number;
        organizationId: string | null;
        /** ISO currency of the amounts; `XXX` (ISO 4217 'no currency') for count / points checks. */
        currency: string;
      },
    ) => {
      const dedupeKey = `${source}:${i.type}:${i.id}`;
      const open = await this.prisma.reconciliationItem.findUnique({ where: { dedupeKey } });
      if (open && open.status !== 'RESOLVED') return;
      counts[source] = (counts[source] ?? 0) + 1;
      const data = {
        reference: ref('RCI'),
        runId: run.id,
        source,
        status,
        matchStatus: status,
        internalType: i.type,
        internalId: i.id,
        internalReference: i.reference,
        internalAmountMinor: i.actual,
        externalAmountMinor: i.expected,
        varianceMinor: i.actual - i.expected,
        currency: i.currency,
        organizationId: i.organizationId,
      };
      if (open)
        await this.prisma.reconciliationItem.update({
          where: { id: open.id },
          data: {
            ...data,
            ownerUserId: null,
            resolution: null,
            resolvedAt: null,
            resolvedByUserId: null,
            adjustmentRequestId: null,
          },
        });
      else await this.prisma.reconciliationItem.create({ data: { ...data, dedupeKey } });
    };
    // voucher purchase: a confirmed payment must have its sale journal
    for (const p of await this.prisma.payment.findMany({
      where: {
        status: { in: ['SUCCEEDED', 'REFUNDED', 'REFUND_PENDING'] },
        completedAt: { gte: since },
      },
      include: { order: { select: { organizationId: true, reference: true, currency: true } } },
      take: 2000,
    })) {
      const j = await this.prisma.ledgerJournal.findUnique({
        where: { idempotencyKey: `sale:${p.id}` },
        include: { entries: true },
      });
      if (!j)
        await raise('VOUCHER_PURCHASE', 'MISSING_INTERNAL', {
          type: 'Payment',
          id: p.id,
          reference: p.order.reference,
          expected: p.amountHalalas,
          actual: 0,
          organizationId: p.order.organizationId,
          currency: p.order.currency,
        });
    }
    // voucher redemption: a valid redemption must have its payable events
    for (const r of await this.prisma.voucherRedemption.findMany({
      where: { status: 'REDEEMED', redeemedAt: { gte: since } },
      take: 2000,
    })) {
      const ev = await this.prisma.merchantPayableEvent.count({
        where: { instanceId: r.instanceId, type: 'REDEEMED' },
      });
      if (!ev)
        await raise('VOUCHER_REDEMPTION', 'MISSING_INTERNAL', {
          type: 'VoucherRedemption',
          id: r.id,
          reference: r.reference,
          expected: 1,
          actual: 0,
          organizationId: r.organizationId,
          currency: 'XXX', // a count, not money
        });
    }
    // Watch & Earn funding: the campaign's funded total equals its funding records
    for (const c of await this.prisma.watchCampaign.findMany({
      where: { fundedHalalas: { gt: 0 } },
      select: {
        id: true,
        fundedHalalas: true,
        organizationId: true,
        sponsorOrganizationId: true,
        currency: true,
      },
      take: 2000,
    })) {
      const sum =
        (
          await this.prisma.watchFunding.aggregate({
            where: { campaignId: c.id },
            _sum: { amountHalalas: true },
          })
        )._sum.amountHalalas ?? 0;
      if (sum !== c.fundedHalalas)
        await raise('WATCH_FUNDING', 'AMOUNT_MISMATCH', {
          type: 'WatchCampaign',
          id: c.id,
          reference: null,
          expected: sum,
          actual: c.fundedHalalas,
          organizationId: c.sponsorOrganizationId ?? c.organizationId,
          currency: c.currency,
        });
    }
    // sponsor funding: never used beyond what was committed
    for (const f of await this.prisma.fundingCommitment.findMany({
      where: { kind: 'SPONSOR_FUNDING' },
      include: { case: { select: { currency: true } } },
      take: 2000,
    }))
      if (f.utilizedHalalas > f.upfrontHalalas + f.usageMaxHalalas)
        await raise('SPONSOR_FUNDING', 'AMOUNT_MISMATCH', {
          type: 'FundingCommitment',
          id: f.id,
          reference: null,
          expected: f.upfrontHalalas + f.usageMaxHalalas,
          actual: f.utilizedHalalas,
          organizationId: f.organizationId,
          currency: f.case.currency,
        });
    // loyalty funding: a rule's allocated counter equals the points it actually issued
    for (const r of await this.prisma.loyaltyRule.findMany({
      where: { allocatedPoints: { gt: 0 } },
      take: 2000,
    })) {
      const sum =
        (
          await this.prisma.rewardEntry.aggregate({
            where: { ruleId: r.id, type: { in: ['EARN', 'BONUS'] } },
            _sum: { points: true },
          })
        )._sum.points ?? 0;
      if (sum !== r.allocatedPoints)
        await raise('LOYALTY_FUNDING', 'AMOUNT_MISMATCH', {
          type: 'LoyaltyRule',
          id: r.id,
          reference: r.name,
          expected: sum,
          actual: r.allocatedPoints,
          organizationId: r.fundingOrganizationId ?? r.organizationId,
          currency: 'XXX', // points, not money
        });
    }
    // invoices: the paid amount equals the live allocations
    for (const d of await this.prisma.financeDocument.findMany({
      where: { paidHalalas: { gt: 0 }, type: { in: ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE'] } },
      take: 2000,
    })) {
      const sum =
        (
          await this.prisma.paymentAllocation.aggregate({
            where: { documentId: d.id, reversedAt: null },
            _sum: { amountMinor: true },
          })
        )._sum.amountMinor ?? 0;
      if (sum !== d.paidHalalas)
        await raise('INVOICE', 'AMOUNT_MISMATCH', {
          type: 'FinanceDocument',
          id: d.id,
          reference: d.number,
          expected: sum,
          actual: d.paidHalalas,
          organizationId: d.organizationId,
          currency: d.currency,
        });
    }
    // merchant payable: the settlement-eligible ledger balance equals the payable events net of recorded settlement payouts
    // checked per (merchant, currency): amounts in different currencies are never netted against each other
    const orgs = await this.prisma.merchantPayableEvent.findMany({
      distinct: ['organizationId', 'currency'],
      select: { organizationId: true, currency: true },
      take: 1000,
    });
    for (const { organizationId, currency } of orgs) {
      const ev = await this.prisma.merchantPayableEvent.groupBy({
        by: ['type'],
        where: {
          organizationId,
          currency,
          type: { in: ['ELIGIBLE', 'REDEMPTION_REVERSED', 'ADJUSTMENT'] },
        },
        _sum: { amountHalalas: true },
      });
      const s = (t: string) => ev.find((e) => e.type === t)?._sum.amountHalalas ?? 0;
      const paid =
        (
          await this.prisma.settlementPayout.aggregate({
            where: { status: 'PAID', settlement: { organizationId, currency } },
            _sum: { amountMinor: true },
          })
        )._sum.amountMinor ?? 0;
      const reversed =
        (
          await this.prisma.settlementPayout.aggregate({
            where: { status: 'REVERSED', settlement: { organizationId, currency } },
            _sum: { amountMinor: true },
          })
        )._sum.amountMinor ?? 0;
      const expected = s('ELIGIBLE') - s('REDEMPTION_REVERSED') + s('ADJUSTMENT') - paid + reversed;
      const acc = await this.prisma.ledgerAccount.findFirst({
        where: { family: 'MERCHANT_SETTLEMENT_ELIGIBLE', organizationId, currency },
      });
      const bal = acc
        ? -(
            (
              await this.prisma.ledgerEntry.aggregate({
                where: { accountId: acc.id },
                _sum: { amountHalalas: true },
              })
            )._sum.amountHalalas ?? 0
          )
        : 0;
      if (bal !== expected)
        await raise('MERCHANT_PAYABLE', 'AMOUNT_MISMATCH', {
          type: 'Organization',
          id: organizationId,
          reference: null,
          expected,
          actual: bal,
          organizationId,
          currency,
        });
    }
    await this.prisma.reconciliationRun.update({ where: { id: run.id }, data: { totals: counts } });
    await this.audit.record({
      action: 'RECONCILIATION_CONSISTENCY_RUN',
      entityType: 'ReconciliationRun',
      entityId: run.id,
      actor,
      newState: counts,
      meta,
    });
    return { runId: run.id, reference: run.reference, totals: counts };
  }

  private async load(id: string) {
    const i = await this.prisma.reconciliationItem.findUnique({ where: { id } });
    if (!i) throw AppError.notFound();
    return i;
  }

  async assign(actor: Actor, id: string, ownerUserId: string, meta: RequestMeta) {
    const i = await this.load(id);
    if (i.status === 'RESOLVED' || i.status === 'MATCHED')
      throw new AppError('INVALID_STATE', 'This item needs no work', 409);
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerUserId, memberships: { some: { organization: { type: 'DEALDASH' } } } },
      select: { id: true },
    });
    if (!owner) throw AppError.validation('The owner must be a DealDash user', 'ownerUserId');
    await this.prisma.reconciliationItem.update({
      where: { id },
      data: { ownerUserId, status: i.status === 'MANUAL_REVIEW' ? i.status : i.status },
    });
    await this.audit.record({
      action: 'RECONCILIATION_ASSIGNED',
      entityType: 'ReconciliationItem',
      entityId: id,
      actor,
      subjectOrganizationId: i.organizationId,
      previousState: { owner: i.ownerUserId },
      newState: { owner: ownerUserId },
      meta,
    });
    return this.view(await this.load(id));
  }

  /** Marks an exception for a person to look at closely (it stays an exception until resolved). */
  async review(actor: Actor, id: string, note: string, meta: RequestMeta) {
    const i = await this.load(id);
    if (!(RECON_EXCEPTION_STATUSES as readonly string[]).includes(i.status))
      throw new AppError('INVALID_STATE', 'Only an exception can be reviewed', 409);
    await this.prisma.reconciliationItem.update({
      where: { id },
      data: { status: 'MANUAL_REVIEW', ownerUserId: i.ownerUserId ?? actor.userId },
    });
    await this.audit.record({
      action: 'RECONCILIATION_MANUAL_REVIEW',
      entityType: 'ReconciliationItem',
      entityId: id,
      actor,
      subjectOrganizationId: i.organizationId,
      reason: note,
      previousState: { status: i.status },
      newState: { status: 'MANUAL_REVIEW' },
      meta,
    });
    return this.view(await this.load(id));
  }

  /** Resolves an exception. Where money moved, the governed adjustment is linked (it must exist and be applied or pending). */
  async resolve(
    actor: Actor,
    id: string,
    b: { resolution: string; adjustmentRequestId?: string | null },
    meta: RequestMeta,
  ) {
    const i = await this.load(id);
    if (!(RECON_EXCEPTION_STATUSES as readonly string[]).includes(i.status))
      throw new AppError('INVALID_STATE', 'Only an open exception can be resolved', 409);
    if (b.adjustmentRequestId) {
      const a = await this.prisma.adjustmentRequest.findUnique({
        where: { id: b.adjustmentRequestId },
      });
      if (!a || ['REJECTED', 'FAILED'].includes(a.status))
        throw AppError.validation(
          'Link an adjustment that is applied or waiting for approval',
          'adjustmentRequestId',
        );
    }
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.reconciliationItem.updateMany({
        where: { id, status: i.status },
        data: {
          status: 'RESOLVED',
          resolution: b.resolution,
          adjustmentRequestId: b.adjustmentRequestId ?? null,
          resolvedAt: new Date(),
          resolvedByUserId: actor.userId,
        },
      });
      if (r.count !== 1)
        throw new AppError('VERSION_CONFLICT', 'The item changed. Reload and try again.', 409);
      await this.audit.record(
        {
          action: 'RECONCILIATION_RESOLVED',
          entityType: 'ReconciliationItem',
          entityId: id,
          actor,
          subjectOrganizationId: i.organizationId,
          reason: b.resolution,
          previousState: { status: i.status },
          newState: { status: 'RESOLVED', adjustmentRequestId: b.adjustmentRequestId ?? null },
          meta,
        },
        tx,
      );
    });
    return this.view(await this.load(id));
  }

  /** Opens a RECONCILIATION_EXCEPTION case for an item that needs a cross-team investigation (finance, merchant, partner). */
  async openCase(actor: Actor, id: string, meta: RequestMeta) {
    const i = await this.load(id);
    if (i.caseId) return this.disputes.get(i.caseId);
    const c = await this.disputes.open(
      actor,
      null,
      {
        type: 'RECONCILIATION_EXCEPTION',
        title: `${i.source} ${i.status}: ${i.externalReference ?? i.internalReference ?? i.reference}`,
        description: `Variance ${i.varianceMinor} ${i.currency}`,
        priority: Math.abs(i.varianceMinor) >= 100_000 ? 'HIGH' : 'NORMAL',
        targetOrganizationId: i.organizationId,
        relatedType: 'ReconciliationItem',
        relatedId: i.id,
        sourceEvent: 'RECONCILIATION_EXCEPTION',
        sourceEventId: i.id,
        transactionRef: i.externalReference ?? i.internalReference,
        financialImpactMinor: Math.abs(i.varianceMinor) || null,
        currency: i.currency,
      },
      meta,
    );
    await this.prisma.reconciliationItem.update({ where: { id }, data: { caseId: c.id } });
    return c;
  }
}
