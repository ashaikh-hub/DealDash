import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { OPEN_RECEIVABLE_STATUSES, type AgingBucket } from '@dealdash/types';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { CommercialService } from '../finance/commercial.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../vouchers/ledger.service';
import type { FinanceAccess } from './finance-access.service';
import { InvoicingService } from './invoicing.service';

const D = 86_400_000;
const RECEIVABLE_TYPES = ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE'] as const;

/**
 * Accounts receivable on the shared finance platform: payments (partial, unallocated credit), allocation, aging, overdue, disputes
 * and statements of account. AR is the document subledger per currency; nothing is converted between currencies here.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commercial: CommercialService,
    private readonly invoicing: InvoicingService,
    private readonly ledger: LedgerService,
  ) {}

  private async outstanding(
    db: Prisma.TransactionClient | PrismaService,
    d: { id: string; type: string; totalHalalas: number; paidHalalas: number },
  ) {
    const credited = d.type === 'DEBIT_NOTE' ? 0 : await this.invoicing.creditedOn(db, d.id);
    return Math.max(0, d.totalHalalas - d.paidHalalas - credited);
  }

  // ---------------------------------------------------------------- payments and allocation
  async recordPayment(
    actor: Actor,
    b: {
      businessAccountId: string;
      amountMinor: number;
      currency: string;
      method: string;
      externalReference?: string | null;
      receivedAt?: string | null;
      allocations?: Array<{ documentId: string; amountMinor: number }>;
    },
    meta: RequestMeta,
  ) {
    const acc = await this.prisma.businessAccount.findUnique({
      where: { id: b.businessAccountId },
    });
    if (!acc) throw AppError.notFound();
    if (b.currency !== acc.currency)
      throw AppError.validation(
        `This account is billed in ${acc.currency}: record the payment in ${acc.currency} (no automatic conversion)`,
        'currency',
      );
    if (b.amountMinor <= 0)
      throw AppError.validation('A positive amount is required', 'amountMinor');
    return this.prisma.$transaction(async (tx) => {
      const pay = await tx.financePayment.create({
        data: {
          reference: await this.commercial.nextNumber(tx, 'payment', 'PAY'),
          businessAccountId: acc.id,
          organizationId: acc.organizationId,
          legalEntityId: acc.legalEntityId,
          amountHalalas: b.amountMinor,
          currency: b.currency,
          method: b.method,
          externalReference: b.externalReference ?? null,
          status: 'RECEIVED',
          recordedByUserId: actor.userId,
          recordedByRole: actor.membership?.roleCode ?? null,
          idempotencyKey: `billing-pay:${meta.requestId}`,
          receivedAt: b.receivedAt ? new Date(b.receivedAt) : new Date(),
        },
      });
      const open = await tx.financeDocument.findMany({
        where: {
          businessAccountId: acc.id,
          type: { in: [...RECEIVABLE_TYPES] },
          status: { in: [...OPEN_RECEIVABLE_STATUSES] as never },
        },
        orderBy: [{ dueAt: 'asc' }, { issuedAt: 'asc' }],
      });
      let plan: Array<{ documentId: string; amountMinor: number }>;
      if (b.allocations?.length) {
        const total = b.allocations.reduce((s, x) => s + x.amountMinor, 0);
        if (total > b.amountMinor)
          throw new AppError('OVERPAYMENT', 'The allocations exceed the payment', 422);
        plan = b.allocations;
      } else {
        // oldest first; whatever is left stays as unallocated credit on the account
        let left = b.amountMinor;
        plan = [];
        for (const d of open) {
          if (left <= 0) break;
          const x = Math.min(left, await this.outstanding(tx, d));
          if (x > 0) {
            plan.push({ documentId: d.id, amountMinor: x });
            left -= x;
          }
        }
      }
      for (const p of plan)
        await this.allocateIn(tx, actor, pay.id, p.documentId, p.amountMinor, acc.id);
      // lines are written while the document is a draft, then it is issued (issued documents and their lines are immutable)
      const receipt = await tx.financeDocument.create({
        data: {
          number: await this.commercial.nextNumber(tx, 'receipt', 'RC'),
          type: 'RECEIPT',
          status: 'DRAFT',
          businessAccountId: acc.id,
          organizationId: acc.organizationId,
          legalEntityId: acc.legalEntityId,
          currency: acc.currency,
          subtotalHalalas: b.amountMinor,
          totalHalalas: b.amountMinor,
          paidHalalas: b.amountMinor,
          sourceKind: 'PAYMENT',
          notes: pay.reference,
          createdByUserId: actor.userId,
          statutory: {},
          invoiceLines: {
            create: plan.map((p, i) => ({
              lineNo: i + 1,
              kind: 'INFORMATIONAL',
              description: `Payment ${pay.reference} applied`,
              amountMinor: p.amountMinor,
              currency: acc.currency,
              collection: 'INVOICE_DUE',
              settledByRef: p.documentId,
            })),
          },
        },
      });
      await tx.financeDocument.update({ where: { id: receipt.id }, data: { status: 'ISSUED' } });
      await this.audit.record(
        {
          action: 'BILLING_PAYMENT_RECORDED',
          entityType: 'FinancePayment',
          entityId: pay.id,
          actor,
          subjectOrganizationId: acc.organizationId,
          newState: {
            amount: b.amountMinor,
            currency: b.currency,
            method: b.method,
            allocations: plan,
          },
          meta,
        },
        tx,
      );
      return {
        paymentId: pay.id,
        reference: pay.reference,
        allocatedMinor: plan.reduce((s, p) => s + p.amountMinor, 0),
        unallocatedMinor: b.amountMinor - plan.reduce((s, p) => s + p.amountMinor, 0),
      };
    });
  }

  private async allocateIn(
    tx: Prisma.TransactionClient,
    actor: Actor,
    paymentId: string,
    documentId: string,
    amount: number,
    accountId: string,
  ) {
    const d = await tx.financeDocument.findUnique({ where: { id: documentId } });
    if (
      !d ||
      d.businessAccountId !== accountId ||
      !(RECEIVABLE_TYPES as readonly string[]).includes(d.type)
    )
      throw AppError.validation('The document is not a receivable of this account', 'documentId');
    if (!(OPEN_RECEIVABLE_STATUSES as readonly string[]).includes(d.status))
      throw new AppError('INVALID_STATE', `${d.number} is not open`, 409);
    const out = await this.outstanding(tx, d);
    if (amount <= 0 || amount > out)
      throw new AppError('OVERPAYMENT', `At most ${out} can be applied to ${d.number}`, 422);
    await tx.paymentAllocation.create({
      data: {
        paymentId,
        documentId,
        amountMinor: amount,
        currency: d.currency,
        allocatedByUserId: actor.userId,
      },
    });
    const paid = d.paidHalalas + amount;
    const left = out - amount;
    await tx.financeDocument.update({
      where: { id: documentId },
      data: {
        paidHalalas: paid,
        status:
          left === 0
            ? 'PAID'
            : d.status === 'OVERDUE' || d.status === 'DISPUTED'
              ? d.status
              : 'PARTIALLY_PAID',
      },
    });
  }

  async unallocated(db: Prisma.TransactionClient | PrismaService, paymentId: string) {
    const p = await db.financePayment.findUniqueOrThrow({ where: { id: paymentId } });
    const a = await db.paymentAllocation.aggregate({
      where: { paymentId, reversedAt: null },
      _sum: { amountMinor: true },
    });
    return p.amountHalalas - (a._sum.amountMinor ?? 0);
  }

  /** Applies unallocated credit from an earlier payment to a document. */
  async allocate(
    actor: Actor,
    paymentId: string,
    documentId: string,
    amountMinor: number,
    meta: RequestMeta,
  ) {
    const p = await this.prisma.financePayment.findUnique({ where: { id: paymentId } });
    if (!p) throw AppError.notFound();
    await this.prisma.$transaction(async (tx) => {
      if (amountMinor > (await this.unallocated(tx, paymentId)))
        throw new AppError('OVERPAYMENT', 'Not enough unallocated credit on this payment', 422);
      await this.allocateIn(tx, actor, paymentId, documentId, amountMinor, p.businessAccountId);
      await this.audit.record(
        {
          action: 'BILLING_PAYMENT_ALLOCATED',
          entityType: 'FinancePayment',
          entityId: paymentId,
          actor,
          subjectOrganizationId: p.organizationId,
          newState: { documentId, amount: amountMinor },
          meta,
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- AR, aging, overdue
  async markOverdue(now = new Date()) {
    const r = await this.prisma.financeDocument.updateMany({
      where: {
        type: { in: [...RECEIVABLE_TYPES] },
        status: { in: ['ISSUED', 'SENT', 'PARTIALLY_PAID'] },
        dueAt: { lt: now },
      },
      data: { status: 'OVERDUE', overdueAt: now },
    });
    return r.count;
  }

  private bucket(dueAt: Date | null, now: Date, days: number[]): AgingBucket {
    if (!dueAt || dueAt >= now) return 'CURRENT';
    const late = Math.floor((now.getTime() - dueAt.getTime()) / D);
    const [a = 30, b = 60, c = 90] = days;
    return late <= a ? 'D1_30' : late <= b ? 'D31_60' : late <= c ? 'D61_90' : 'D90_PLUS';
  }

  async receivables(a: FinanceAccess, f: { organizationId?: string } = {}, now = new Date()) {
    const cfg = await this.invoicing.settings();
    const where: Prisma.BusinessAccountWhereInput = {
      ...(a.admin
        ? f.organizationId
          ? { organizationId: f.organizationId }
          : {}
        : { organizationId: a.organizationId! }),
      ...(a.legalEntityIds ? { legalEntityId: { in: a.legalEntityIds } } : {}),
    };
    const accounts = await this.prisma.businessAccount.findMany({
      where,
      include: { legalEntity: { select: { legalName: true } } },
      take: 300,
    });
    const out = [];
    for (const acc of accounts) {
      const docs = await this.prisma.financeDocument.findMany({
        where: {
          businessAccountId: acc.id,
          type: { in: [...RECEIVABLE_TYPES, 'CREDIT_NOTE'] },
          status: { notIn: ['DRAFT', 'PENDING_APPROVAL', 'CANCELLED', 'VOID'] },
        },
      });
      const aging: Record<AgingBucket, number> = {
        CURRENT: 0,
        D1_30: 0,
        D31_60: 0,
        D61_90: 0,
        D90_PLUS: 0,
      };
      let invoiced = 0;
      let paid = 0;
      let credited = 0;
      let outstanding = 0;
      let overdue = 0;
      let disputed = 0;
      for (const d of docs) {
        if (d.type === 'CREDIT_NOTE') {
          credited += d.totalHalalas;
          continue;
        }
        invoiced += d.totalHalalas;
        paid += d.paidHalalas;
        if (!(OPEN_RECEIVABLE_STATUSES as readonly string[]).includes(d.status)) continue;
        const o = await this.outstanding(this.prisma, d);
        outstanding += o;
        if (d.status === 'DISPUTED') disputed += o;
        if (d.dueAt && d.dueAt < now) overdue += o;
        aging[this.bucket(d.dueAt, now, cfg.agingBucketDays)] += o;
      }
      const pays = await this.prisma.financePayment.findMany({
        where: { businessAccountId: acc.id },
        select: { id: true },
      });
      let credit = 0;
      for (const p of pays) credit += await this.unallocated(this.prisma, p.id);
      // prepaid campaign funds held (SAR general ledger): a deposit the business holds with DealDash, not a payment of invoices
      const deposits =
        acc.currency === 'SAR' && acc.isDefault
          ? -(await this.ledger.balance('CAMPAIGN_FUNDS_HELD', acc.organizationId))
          : 0;
      const holds = await this.prisma.financialHold.count({
        where: {
          organizationId: acc.organizationId,
          status: 'ACTIVE',
          OR: [{ businessAccountId: acc.id }, { businessAccountId: null }],
        },
      });
      out.push({
        businessAccountId: acc.id,
        organizationId: acc.organizationId,
        legalEntityId: acc.legalEntityId,
        legalName: acc.legalEntity.legalName,
        currency: acc.currency,
        status: acc.status,
        invoicedMinor: invoiced,
        paidMinor: paid,
        creditedMinor: credited,
        outstandingMinor: outstanding,
        overdueMinor: overdue,
        disputedMinor: disputed,
        unallocatedCreditMinor: credit,
        depositsMinor: deposits,
        aging,
        financialHolds: holds,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- disputes
  async dispute(
    actor: Actor,
    a: FinanceAccess,
    invoiceId: string,
    reason: string,
    meta: RequestMeta,
  ) {
    const d = await this.prisma.financeDocument.findUnique({ where: { id: invoiceId } });
    if (!d) throw AppError.notFound();
    if (
      !a.admin &&
      (d.organizationId !== a.organizationId ||
        (a.legalEntityIds && (!d.legalEntityId || !a.legalEntityIds.includes(d.legalEntityId))))
    )
      throw AppError.notFound();
    if (
      !(RECEIVABLE_TYPES as readonly string[]).includes(d.type) ||
      !['ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(d.status)
    )
      throw new AppError('INVALID_STATE', 'Only an open invoice can be disputed', 409);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.disputeCase.create({
        data: {
          reference: `DC-${randomBytes(4).toString('hex').toUpperCase()}`,
          type: 'OTHER',
          organizationId: d.organizationId,
          relatedType: 'FinanceDocument',
          relatedId: d.id,
          title: `Invoice ${d.number} disputed`,
          description: reason,
          priority: 'HIGH',
          status: 'OPEN',
          openedByUserId: actor.userId,
          openedByOrganizationId: actor.membership?.organizationId ?? null,
          slaDueAt: new Date(Date.now() + 5 * D),
        },
      });
      await tx.financeDocument.update({
        where: { id: d.id },
        data: { status: 'DISPUTED', disputedAt: new Date(), disputeCaseId: c.id },
      });
      await this.audit.record(
        {
          action: 'INVOICE_DISPUTED',
          entityType: 'FinanceDocument',
          entityId: d.id,
          actor,
          subjectOrganizationId: d.organizationId,
          newState: { case: c.reference },
          reason,
          meta,
        },
        tx,
      );
      return { caseId: c.id, reference: c.reference };
    });
  }

  /** DealDash closes a dispute: upheld (credit note for the agreed amount) or rejected (the invoice is owed again). */
  async resolveDispute(
    actor: Actor,
    invoiceId: string,
    b: { outcome: 'UPHELD' | 'REJECTED'; creditMinor?: number; reason: string },
    meta: RequestMeta,
  ) {
    const d = await this.prisma.financeDocument.findUnique({ where: { id: invoiceId } });
    if (!d || d.status !== 'DISPUTED')
      throw new AppError('INVALID_STATE', 'This invoice is not disputed', 409);
    const back =
      d.dueAt && d.dueAt < new Date() ? 'OVERDUE' : d.paidHalalas > 0 ? 'PARTIALLY_PAID' : 'ISSUED';
    await this.prisma.$transaction(async (tx) => {
      await tx.financeDocument.update({ where: { id: invoiceId }, data: { status: back } });
      if (d.disputeCaseId)
        await tx.disputeCase.update({
          where: { id: d.disputeCaseId },
          data: {
            status: 'RESOLVED',
            resolution: `${b.outcome}: ${b.reason}`,
            resolvedAt: new Date(),
            resolvedByUserId: actor.userId,
          },
        });
      await this.audit.record(
        {
          action: 'INVOICE_DISPUTE_RESOLVED',
          entityType: 'FinanceDocument',
          entityId: invoiceId,
          actor,
          subjectOrganizationId: d.organizationId,
          newState: { outcome: b.outcome },
          reason: b.reason,
          meta,
        },
        tx,
      );
    });
    if (b.outcome === 'UPHELD' && b.creditMinor)
      await this.invoicing.note(
        actor,
        invoiceId,
        { kind: 'CREDIT_NOTE', amountMinor: b.creditMinor, reason: b.reason },
        meta,
      );
    return this.invoicing.view(invoiceId);
  }

  // ---------------------------------------------------------------- statement of account
  async statement(a: FinanceAccess, businessAccountId: string, from: Date, to: Date) {
    const acc = await this.prisma.businessAccount.findUnique({
      where: { id: businessAccountId },
      include: { legalEntity: { select: { legalName: true } } },
    });
    if (!acc) throw AppError.notFound();
    if (
      !a.admin &&
      (acc.organizationId !== a.organizationId ||
        (a.legalEntityIds && !a.legalEntityIds.includes(acc.legalEntityId)))
    )
      throw AppError.notFound();
    const docs = await this.prisma.financeDocument.findMany({
      where: {
        businessAccountId,
        type: { in: [...RECEIVABLE_TYPES, 'CREDIT_NOTE'] },
        status: { notIn: ['DRAFT', 'PENDING_APPROVAL', 'CANCELLED', 'VOID'] },
        issuedAt: { lt: to },
      },
      orderBy: { issuedAt: 'asc' },
    });
    const pays = await this.prisma.financePayment.findMany({
      where: { businessAccountId, receivedAt: { lt: to } },
      orderBy: { receivedAt: 'asc' },
    });
    const sign = (t: string) => (t === 'CREDIT_NOTE' ? -1 : 1);
    let opening = 0;
    for (const d of docs) if (d.issuedAt < from) opening += sign(d.type) * d.totalHalalas;
    for (const p of pays) if (p.receivedAt < from) opening -= p.amountHalalas;
    const entries = [
      ...docs
        .filter((d) => d.issuedAt >= from)
        .map((d) => ({
          at: d.issuedAt,
          kind: d.type,
          reference: d.number,
          debitMinor: sign(d.type) > 0 ? d.totalHalalas : 0,
          creditMinor: sign(d.type) < 0 ? d.totalHalalas : 0,
        })),
      ...pays
        .filter((p) => p.receivedAt >= from)
        .map((p) => ({
          at: p.receivedAt,
          kind: 'PAYMENT',
          reference: p.reference,
          debitMinor: 0,
          creditMinor: p.amountHalalas,
        })),
    ].sort((x, y) => x.at.getTime() - y.at.getTime());
    let running = opening;
    const lines = entries.map((e) => {
      running += e.debitMinor - e.creditMinor;
      return {
        at: e.at.toISOString(),
        kind: e.kind,
        reference: e.reference,
        debitMinor: e.debitMinor,
        creditMinor: e.creditMinor,
        balanceMinor: running,
      };
    });
    return {
      businessAccountId,
      organizationId: acc.organizationId,
      legalName: acc.legalEntity.legalName,
      currency: acc.currency,
      from: from.toISOString(),
      to: to.toISOString(),
      openingMinor: opening,
      closingMinor: running,
      lines,
    };
  }

  /** Keeps a dated, numbered copy of a statement (immutable once issued). */
  async issueStatement(
    actor: Actor,
    a: FinanceAccess,
    businessAccountId: string,
    from: Date,
    to: Date,
    meta: RequestMeta,
  ) {
    const s = await this.statement(a, businessAccountId, from, to);
    const acc = await this.prisma.businessAccount.findUniqueOrThrow({
      where: { id: businessAccountId },
    });
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.financeDocument.create({
        data: {
          number: await this.commercial.nextNumber(tx, 'statement', 'SOA'),
          type: 'STATEMENT',
          status: 'ISSUED',
          businessAccountId,
          organizationId: acc.organizationId,
          legalEntityId: acc.legalEntityId,
          currency: acc.currency,
          subtotalHalalas: Math.max(0, s.closingMinor),
          totalHalalas: Math.max(0, s.closingMinor),
          periodStart: from,
          periodEnd: to,
          lines: s.lines as unknown as Prisma.InputJsonValue,
          sourceKind: 'STATEMENT',
          createdByUserId: actor.userId,
          statutory: {
            openingMinor: s.openingMinor,
            closingMinor: s.closingMinor,
            note: 'TOTAL_IS_AMOUNT_DUE_CREDIT_BALANCE_IN_CLOSING',
          } as Prisma.InputJsonValue,
        },
      });
      await this.audit.record(
        {
          action: 'STATEMENT_ISSUED',
          entityType: 'FinanceDocument',
          entityId: d.id,
          actor,
          subjectOrganizationId: acc.organizationId,
          newState: { from: s.from, to: s.to, closing: s.closingMinor },
          meta,
        },
        tx,
      );
      return { id: d.id, number: d.number, ...s };
    });
  }
}
