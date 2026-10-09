import { Inject, Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { EDITABLE_DOCUMENT_STATUSES, OPEN_RECEIVABLE_STATUSES, type BillingCollection } from '@dealdash/types';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { CommercialService } from '../finance/commercial.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PROVIDER, type EmailProvider } from '../providers/interfaces';
import { SystemConfigService } from '../system-config/system-config.service';
import { BillingAccountsService, convertMinor } from './billing-accounts.service';
import type { FinanceAccess } from './finance-access.service';

type Db = Prisma.TransactionClient | PrismaService;
type BillingEventRow = Prisma.CommercialBillingEventGetPayload<object>;
const D = 86_400_000;

export interface BillingConfig {
  defaultPaymentTermsDays: number;
  overdueGraceDays: number;
  issueApprovalThresholdMinor: Record<string, number>;
  agingBucketDays: number[];
  writeOffAllowed: boolean;
  quotationValidityDays: number;
  overdueDrivesPastDue: boolean;
}

/** Plain-language line names (EN / AR) for billing event types. */
const LINE_NAME: Record<string, [string, string]> = {
  MONTHLY_SUBSCRIPTION_RENEWAL: ['Monthly subscription', 'اشتراك شهري'],
  ANNUAL_LICENCE_RENEWAL: ['Annual licence', 'ترخيص سنوي'],
  LICENCE_ACTIVATION: ['Licence activation', 'تفعيل الترخيص'],
  PLAN_CHANGE_ADJUSTMENT: ['Plan change adjustment', 'تسوية تغيير الباقة'],
  SETUP_FEE: ['Setup fee', 'رسوم الإعداد'],
  INTEGRATION_FEE: ['Integration fee', 'رسوم التكامل'],
  API_FEE: ['API integration fee', 'رسوم تكامل واجهة البرمجة'],
  ADD_ON_FEE: ['Add-on', 'إضافة'],
  PREMIUM_ANALYTICS_FEE: ['Premium analytics', 'تحليلات متقدمة'],
  FEATURED_PLACEMENT_FEE: ['Featured placement', 'الإبراز المميز'],
  CAMPAIGN_SETUP_FEE: ['Campaign setup', 'إعداد الحملة'],
  QUALIFIED_VIEW_USAGE: ['Qualified views', 'المشاهدات المؤهلة'],
  VERIFIED_REDEMPTION_USAGE: ['Verified redemptions', 'عمليات الاسترداد الموثّقة'],
  OVERAGE_USAGE: ['Usage above the allowance', 'استخدام يتجاوز الحد'],
  VOUCHER_TRANSACTION_COMMISSION: ['Voucher commission', 'عمولة القسائم'],
};

/**
 * Invoicing on the ONE shared finance platform. Billing events are collected exactly once: only INVOICE_DUE events (subscriptions,
 * licences, setup / integration / API fees, add-ons, overage, premium services) become receivable invoice lines; usage already drawn
 * from prepaid funding, commission netted from the merchant payable and credit-mode campaign usage (invoiced by the commercial-case
 * closure) are consumed into reconciliation with their settlement reference. Issued documents never change; corrections are notes.
 */
@Injectable()
export class InvoicingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commercial: CommercialService,
    private readonly accounts: BillingAccountsService,
    private readonly config: SystemConfigService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
  ) {}

  async settings(): Promise<BillingConfig> {
    const c = (await this.config.get<Partial<BillingConfig>>(CONFIG_KEYS.FINANCE_BILLING)) ?? {};
    return {
      defaultPaymentTermsDays: c.defaultPaymentTermsDays ?? 30,
      overdueGraceDays: c.overdueGraceDays ?? 7,
      issueApprovalThresholdMinor: c.issueApprovalThresholdMinor ?? {},
      agingBucketDays: c.agingBucketDays ?? [30, 60, 90],
      writeOffAllowed: c.writeOffAllowed ?? false,
      quotationValidityDays: c.quotationValidityDays ?? 14,
      overdueDrivesPastDue: c.overdueDrivesPastDue ?? false,
    };
  }

  // ---------------------------------------------------------------- collection: how a billing event is settled (no double billing)
  async collectionOf(db: Db, e: BillingEventRow): Promise<{ collection: BillingCollection; settlementRef: string | null }> {
    switch (e.eventType) {
      case 'QUALIFIED_VIEW_USAGE':
        return { collection: 'PREPAID_DRAWDOWN', settlementRef: `WATCH_BUDGET:${e.campaignId ?? ''}` };
      case 'VOUCHER_TRANSACTION_COMMISSION':
        return { collection: 'NETTED_FROM_PAYABLE', settlementRef: `MERCHANT_PAYABLE:${e.organizationId}` };
      case 'VERIFIED_REDEMPTION_USAGE':
      case 'FEATURED_PLACEMENT_FEE':
      case 'CAMPAIGN_SETUP_FEE': {
        if (!e.campaignId) return { collection: e.amountMinor ? 'INVOICE_DUE' : 'NOT_BILLABLE', settlementRef: null };
        const c = await db.commercialCase.findFirst({ where: { subjectId: e.campaignId }, include: { commitments: { where: { kind: 'CHARGE' } } } });
        if (!c) return { collection: e.amountMinor ? 'INVOICE_DUE' : 'NOT_BILLABLE', settlementRef: null };
        const credit = c.commitments.some((m) => m.mode === 'CREDIT');
        return { collection: credit ? 'CAMPAIGN_CASE' : 'PREPAID_DRAWDOWN', settlementRef: `CASE:${c.reference}` };
      }
      default:
        return { collection: e.amountMinor === null || e.amountMinor === undefined ? 'NOT_BILLABLE' : 'INVOICE_DUE', settlementRef: null };
    }
  }

  /** Tax rate for a country (configuration; statutory treatment is VALIDATE-KSA / market validation). null = not configured. */
  private async taxBps(db: Db, country: string): Promise<number | null> {
    const c = await db.countryConfiguration.findUnique({ where: { code: country } });
    const p = (c?.taxProfile ?? {}) as { vatBps?: number; status?: string };
    return typeof p.vatBps === 'number' && p.status === 'CONFIGURED' ? p.vatBps : null;
  }

  // ---------------------------------------------------------------- billing run
  /**
   * Consumes pending billing events. Non-receivable collections are consumed at once (with their settlement reference). INVOICE_DUE
   * events become DRAFT invoices, one per billing account, when the account is due (or always when `force`). Events already on a draft
   * line are never picked twice.
   */
  async run(actor: Actor | null, opts: { organizationId?: string; force?: boolean; now?: Date } = {}) {
    const now = opts.now ?? new Date();
    const events = await this.prisma.commercialBillingEvent.findMany({ where: { status: 'PENDING', occurredAt: { lte: now }, ...(opts.organizationId ? { organizationId: opts.organizationId } : {}) }, orderBy: { occurredAt: 'asc' }, take: 5000 });
    const onLines = new Set((await this.prisma.invoiceLine.findMany({ where: { billingEventId: { in: events.map((e) => e.id) } }, select: { billingEventId: true } })).map((l) => l.billingEventId));
    const due = new Map<string, BillingEventRow[]>();
    const leCurrency = new Map<string, string>();
    let consumed = 0;
    for (const e of events) {
      if (onLines.has(e.id)) continue;
      const { collection, settlementRef } = await this.collectionOf(this.prisma, e);
      if (collection !== 'INVOICE_DUE') {
        await this.prisma.commercialBillingEvent.update({ where: { id: e.id }, data: { status: 'CONSUMED', consumedAt: now, collection, settlementRef } });
        consumed++;
        continue;
      }
      // the billed legal entity is invoiced in its own currency; a different event currency needs an approved exchange rate
      const leId = e.billingLegalEntityId ?? e.legalEntityId ?? '';
      if (leId && !leCurrency.has(leId)) leCurrency.set(leId, (await this.prisma.legalEntity.findUnique({ where: { id: leId }, select: { currency: true } }))?.currency ?? e.currency);
      const key = `${e.organizationId}|${leId}|${(leId && leCurrency.get(leId)) || e.currency}`;
      due.set(key, [...(due.get(key) ?? []), e]);
    }
    const drafts: string[] = [];
    const blocked: Array<{ organizationId: string; legalEntityId: string | null; currency: string; code: string }> = [];
    for (const [key, list] of due) {
      const [orgId, leId, currency] = key.split('|') as [string, string, string];
      const acc = await this.accounts.ensure(this.prisma, orgId, leId || null, currency);
      if (!opts.force && !this.isDue(acc, now)) continue;
      if (acc.status === 'CLOSED') continue;
      try {
        drafts.push(await this.draftFromEvents(actor, acc, list, now));
      } catch (err) {
        if (!(err instanceof AppError) || err.code !== 'FX_RATE_REQUIRED') throw err;
        // never converted without a controlled rate: the events wait for the next run
        blocked.push({ organizationId: orgId, legalEntityId: leId || null, currency, code: err.code });
      }
    }
    return { consumed, drafts, blocked };
  }

  private isDue(acc: { billingFrequency: string; lastBilledAt: Date | null }, now: Date) {
    if (acc.billingFrequency === 'PER_EVENT') return true;
    if (acc.billingFrequency === 'ON_DEMAND') return false;
    const last = acc.lastBilledAt;
    if (!last) return true;
    const days = acc.billingFrequency === 'MONTHLY' ? 28 : acc.billingFrequency === 'QUARTERLY' ? 89 : 360;
    return now.getTime() - last.getTime() >= days * D;
  }

  private async draftFromEvents(actor: Actor | null, acc: Prisma.BusinessAccountGetPayload<object>, events: BillingEventRow[], now: Date): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const tax = await this.taxBps(tx, acc.country);
      const lines: Prisma.InvoiceLineCreateManyDocumentInput[] = [];
      let n = 1;
      let fx: { id: string; rate: string; base: string } | null = null;
      for (const e of events) {
        let amount = e.amountMinor ?? 0;
        let unit = e.unitRateMinor;
        if (e.currency !== acc.currency) {
          const r = await this.accounts.rateFor(tx, e.currency, acc.currency, e.occurredAt);
          fx = { id: r.id, rate: r.rate, base: e.currency };
          amount = convertMinor(amount, r.rate);
          unit = unit === null ? null : convertMinor(unit, r.rate);
        }
        const name = LINE_NAME[e.eventType] ?? [e.eventType, e.eventType];
        const lineTax = tax === null ? 0 : Math.round((amount * tax) / 10_000);
        lines.push({ lineNo: n++, kind: 'CHARGE', description: name[0], descriptionAr: name[1], product: e.product, campaignId: e.campaignId, contractId: e.contractId, billingEventId: e.id, eventType: e.eventType, quantity: e.quantity, unitPriceMinor: unit, amountMinor: amount, taxRateBps: tax, taxMinor: lineTax, currency: acc.currency, pricingVersionKey: e.pricingVersionKey, collection: 'INVOICE_DUE' });
      }
      const subtotal = lines.reduce((s, l) => s + l.amountMinor, 0);
      const taxTotal = lines.reduce((s, l) => s + (l.taxMinor ?? 0), 0);
      const contracts = [...new Set(events.map((e) => e.contractId).filter(Boolean))];
      const d = await tx.financeDocument.create({
        data: {
          number: `DRAFT-${crypto.randomUUID()}`,
          type: tax === null ? 'INVOICE' : 'TAX_INVOICE',
          status: 'DRAFT',
          businessAccountId: acc.id,
          organizationId: acc.organizationId,
          legalEntityId: acc.legalEntityId,
          contractId: contracts.length === 1 ? contracts[0]! : null,
          currency: acc.currency,
          transactionCurrency: fx ? fx.base : acc.currency,
          settlementCurrency: acc.currency,
          fxRateId: fx?.id ?? null,
          fxRate: fx?.rate ?? null,
          subtotalHalalas: subtotal,
          taxHalalas: taxTotal,
          totalHalalas: subtotal + taxTotal,
          periodStart: events[0]!.occurredAt,
          periodEnd: events[events.length - 1]!.occurredAt,
          sourceKind: 'BILLING_RUN',
          statutory: { status: tax === null ? 'TAX_NOT_CONFIGURED_VALIDATE' : 'TAX_CONFIGURED', taxBps: tax } as Prisma.InputJsonValue,
          createdByUserId: actor?.userId ?? null,
          invoiceLines: { createMany: { data: lines } },
        },
      });
      await tx.businessAccount.update({ where: { id: acc.id }, data: { lastBilledAt: now } });
      await this.audit.record({ action: 'INVOICE_DRAFTED', entityType: 'FinanceDocument', entityId: d.id, actor: actor ?? null, subjectOrganizationId: acc.organizationId, newState: { lines: lines.length, total: subtotal + taxTotal, currency: acc.currency }, meta: null, source: actor ? 'USER' : 'BILLING_RUN' }, tx);
      return d.id;
    });
  }

  // ---------------------------------------------------------------- document lifecycle
  private prefix(type: string) {
    return ({ INVOICE: 'INV', TAX_INVOICE: 'TINV', PROFORMA_INVOICE: 'PRO', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN', RECEIPT: 'RC', ADJUSTMENT_NOTE: 'ADJ', STATEMENT: 'SOA', PURCHASE_ORDER: 'PO' } as Record<string, string>)[type] ?? 'DOC';
  }

  /**
   * Issues a draft. At or above the configured amount it first waits for a second finance person (PENDING_APPROVAL). A PO is drawn
   * on when the account requires one (no PO / not enough room: refused). Issuing assigns the sequential number and due date and
   * consumes the billing events (each exactly once).
   */
  async issue(actor: Actor, id: string, meta: RequestMeta) {
    const d = await this.prisma.financeDocument.findUnique({ where: { id }, include: { invoiceLines: true } });
    if (!d) throw AppError.notFound();
    if (d.status !== 'DRAFT' && d.status !== 'PENDING_APPROVAL') throw new AppError('INVALID_STATE', 'Only a draft can be issued', 409);
    const cfg = await this.settings();
    const threshold = cfg.issueApprovalThresholdMinor[d.currency];
    if (d.status === 'DRAFT' && threshold !== undefined && d.totalHalalas >= threshold) {
      await this.prisma.$transaction(async (tx) => {
        await tx.financeDocument.update({ where: { id }, data: { status: 'PENDING_APPROVAL', createdByUserId: d.createdByUserId ?? actor.userId } });
        await this.audit.record({ action: 'INVOICE_SUBMITTED_FOR_APPROVAL', entityType: 'FinanceDocument', entityId: id, actor, subjectOrganizationId: d.organizationId, newState: { total: d.totalHalalas }, meta }, tx);
      });
      return this.view(id);
    }
    if (d.status === 'PENDING_APPROVAL') {
      if (!actor.permissions.has('admin.finance.approve')) throw AppError.forbidden();
      if (d.createdByUserId === actor.userId) throw new AppError('APPROVAL_REQUIRED', 'A different finance person must approve this document', 403);
    }
    const acc = await this.prisma.businessAccount.findUniqueOrThrow({ where: { id: d.businessAccountId } });
    await this.prisma.$transaction(async (tx) => {
      let poId: string | null = d.purchaseOrderId;
      if (acc.poRequired && d.type !== 'CREDIT_NOTE' && d.type !== 'PROFORMA_INVOICE' && !poId) {
        const r = await this.accounts.poFor(tx, acc, d.totalHalalas);
        if (!r.po) throw new AppError(r.code!, r.code === 'PO_REQUIRED' ? 'This billing account requires a purchase order' : 'The purchase order does not have enough remaining value', 409);
        poId = r.po.id;
      }
      const number = await this.commercial.nextNumber(tx, d.type.toLowerCase(), this.prefix(d.type));
      const issuedAt = new Date();
      const dueAt = d.type === 'CREDIT_NOTE' || d.type === 'PROFORMA_INVOICE' || d.type === 'RECEIPT' ? null : new Date(issuedAt.getTime() + acc.paymentTermsDays * D);
      const res = await tx.financeDocument.updateMany({ where: { id, status: d.status }, data: { number, status: 'ISSUED', issuedAt, dueAt, purchaseOrderId: poId, approvedByUserId: d.status === 'PENDING_APPROVAL' ? actor.userId : null, approvedAt: d.status === 'PENDING_APPROVAL' ? issuedAt : null } });
      if (res.count !== 1) throw new AppError('INVALID_STATE', 'This document changed meanwhile', 409);
      for (const l of d.invoiceLines.filter((x) => x.billingEventId))
        await tx.commercialBillingEvent.update({ where: { id: l.billingEventId! }, data: { status: 'CONSUMED', consumedAt: issuedAt, collection: 'INVOICE_DUE', invoiceLineId: l.id, settlementRef: number } });
      if (d.type === 'CREDIT_NOTE' && d.relatedDocumentId) await this.applyCredit(tx, d.relatedDocumentId);
      await this.audit.record({ action: 'FINANCE_DOCUMENT_ISSUED', entityType: 'FinanceDocument', entityId: id, actor, subjectOrganizationId: d.organizationId, newState: { number, type: d.type, total: d.totalHalalas, currency: d.currency, purchaseOrderId: poId }, meta, approvalRef: d.status === 'PENDING_APPROVAL' ? actor.userId : null }, tx);
    });
    return this.view(id);
  }

  /** Delivery to the invoice contact (email adapter); the document is SENT. */
  async send(actor: Actor, id: string, meta: RequestMeta) {
    const d = await this.prisma.financeDocument.findUnique({ where: { id } });
    if (!d) throw AppError.notFound();
    if (!['ISSUED', 'SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(d.status)) throw new AppError('INVALID_STATE', 'Only an issued document can be sent', 409);
    const acc = await this.prisma.businessAccount.findUniqueOrThrow({ where: { id: d.businessAccountId } });
    const to = (acc.invoiceContact as { email?: string }).email ?? (acc.financeContact as { email?: string }).email;
    if (to) await this.email.send({ to, templateKey: `finance.${d.type.toLowerCase()}`, subject: `DealDash ${d.number}`, body: `${d.number}: ${d.totalHalalas} ${d.currency}` });
    await this.prisma.$transaction(async (tx) => {
      await tx.financeDocument.update({ where: { id }, data: { sentAt: new Date(), ...(d.status === 'ISSUED' ? { status: 'SENT' } : {}) } });
      await this.audit.record({ action: 'FINANCE_DOCUMENT_SENT', entityType: 'FinanceDocument', entityId: id, actor, subjectOrganizationId: d.organizationId, newState: { to: to ? 'invoice_contact' : 'none' }, meta }, tx);
    });
    return this.view(id);
  }

  /** Only a draft (or one waiting for approval) is cancelled; its billing events return to the next run. An issued one needs a credit note. */
  async cancelDraft(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    const d = await this.prisma.financeDocument.findUnique({ where: { id } });
    if (!d) throw AppError.notFound();
    if (!(EDITABLE_DOCUMENT_STATUSES as readonly string[]).includes(d.status)) throw new AppError('DOCUMENT_IMMUTABLE', 'An issued document is corrected with a credit note, never cancelled', 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { documentId: id } });
      await tx.financeDocument.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
      await this.audit.record({ action: 'FINANCE_DOCUMENT_CANCELLED', entityType: 'FinanceDocument', entityId: id, actor, subjectOrganizationId: d.organizationId, reason, meta }, tx);
    });
    return this.view(id);
  }

  /** Credit (or debit) note against an issued invoice. A credit note can never exceed what is still owed. */
  async note(actor: Actor, invoiceId: string, b: { kind: 'CREDIT_NOTE' | 'DEBIT_NOTE'; amountMinor: number; reason: string }, meta: RequestMeta) {
    const inv = await this.prisma.financeDocument.findUnique({ where: { id: invoiceId } });
    if (!inv) throw AppError.notFound();
    if (!['INVOICE', 'TAX_INVOICE'].includes(inv.type)) throw AppError.validation('A note refers to an invoice', 'invoiceId');
    if (!(OPEN_RECEIVABLE_STATUSES as readonly string[]).includes(inv.status) && inv.status !== 'PAID') throw new AppError('INVALID_STATE', 'This invoice cannot be corrected now', 409);
    if (b.amountMinor <= 0) throw AppError.validation('A positive amount is required', 'amountMinor');
    if (b.kind === 'CREDIT_NOTE') {
      const credited = await this.creditedOn(this.prisma, invoiceId);
      if (b.amountMinor > inv.totalHalalas - credited) throw AppError.validation('A credit note cannot exceed the invoice', 'amountMinor');
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const d = await tx.financeDocument.create({
        data: {
          number: `DRAFT-${crypto.randomUUID()}`,
          type: b.kind,
          status: 'DRAFT',
          businessAccountId: inv.businessAccountId,
          organizationId: inv.organizationId,
          legalEntityId: inv.legalEntityId,
          contractId: inv.contractId,
          relatedDocumentId: inv.id,
          currency: inv.currency,
          subtotalHalalas: b.amountMinor,
          totalHalalas: b.amountMinor,
          notes: b.reason,
          sourceKind: 'MANUAL',
          createdByUserId: actor.userId,
          statutory: inv.statutory as Prisma.InputJsonValue,
          invoiceLines: { create: [{ lineNo: 1, kind: b.kind === 'CREDIT_NOTE' ? 'CREDIT' : 'CHARGE', description: b.reason, amountMinor: b.amountMinor, currency: inv.currency, collection: 'INVOICE_DUE' }] },
        },
      });
      await this.audit.record({ action: `${b.kind}_DRAFTED`, entityType: 'FinanceDocument', entityId: d.id, actor, subjectOrganizationId: inv.organizationId, newState: { invoice: inv.number, amount: b.amountMinor }, reason: b.reason, meta }, tx);
      return d.id;
    });
    return this.issue(actor, id, meta);
  }

  async creditedOn(db: Db, invoiceId: string) {
    const r = await db.financeDocument.aggregate({ where: { relatedDocumentId: invoiceId, type: 'CREDIT_NOTE', status: { in: ['ISSUED', 'SENT'] } }, _sum: { totalHalalas: true } });
    return r._sum.totalHalalas ?? 0;
  }

  /** After a credit note: the invoice is CREDITED when nothing is owed any more, else it stays open with less to pay. */
  private async applyCredit(tx: Prisma.TransactionClient, invoiceId: string) {
    const inv = await tx.financeDocument.findUniqueOrThrow({ where: { id: invoiceId } });
    const credited = await this.creditedOn(tx, invoiceId);
    if (inv.paidHalalas + credited >= inv.totalHalalas) await tx.financeDocument.update({ where: { id: invoiceId }, data: { status: inv.paidHalalas > 0 ? 'PAID' : 'CREDITED' } });
  }

  /** Write-off of what is left on an invoice (only where the country's rules allow it: VALIDATE-KSA, off by default). */
  async writeOff(actor: Actor, invoiceId: string, reason: string, meta: RequestMeta) {
    const cfg = await this.settings();
    if (!cfg.writeOffAllowed) throw new AppError('FORBIDDEN', 'Writing off receivables is not enabled (statutory confirmation pending)', 403);
    if (!actor.permissions.has('admin.finance.approve')) throw AppError.forbidden();
    const inv = await this.prisma.financeDocument.findUnique({ where: { id: invoiceId } });
    if (!inv || !(OPEN_RECEIVABLE_STATUSES as readonly string[]).includes(inv.status)) throw new AppError('INVALID_STATE', 'Only an open invoice can be written off', 409);
    const left = inv.totalHalalas - inv.paidHalalas - (await this.creditedOn(this.prisma, invoiceId));
    await this.prisma.$transaction(async (tx) => {
      await tx.financeDocument.create({ data: { number: await this.commercial.nextNumber(tx, 'adjustment_note', 'ADJ'), type: 'ADJUSTMENT_NOTE', status: 'ISSUED', businessAccountId: inv.businessAccountId, organizationId: inv.organizationId, legalEntityId: inv.legalEntityId, relatedDocumentId: inv.id, currency: inv.currency, subtotalHalalas: left, totalHalalas: left, notes: reason, sourceKind: 'MANUAL', createdByUserId: actor.userId, statutory: {} } });
      await tx.financeDocument.update({ where: { id: invoiceId }, data: { status: 'WRITTEN_OFF', writtenOffAt: new Date(), writtenOffByUserId: actor.userId } });
      await this.audit.record({ action: 'INVOICE_WRITTEN_OFF', entityType: 'FinanceDocument', entityId: invoiceId, actor, subjectOrganizationId: inv.organizationId, newState: { amount: left }, reason, meta }, tx);
    });
    return this.view(invoiceId);
  }

  /** A proforma (request for payment, never a receivable): for a prepaid campaign's outstanding funding, or explicit lines. */
  async proforma(actor: Actor, b: { organizationId: string; caseId?: string; lines?: Array<{ description: string; amountMinor: number }>; currency?: string }, meta: RequestMeta) {
    let lines = b.lines ?? [];
    let quotationId: string | null = null;
    if (b.caseId) {
      const c = await this.prisma.commercialCase.findUnique({ where: { id: b.caseId }, include: { commitments: true } });
      if (!c || (c.ownerOrganizationId !== b.organizationId && !c.commitments.some((m) => m.organizationId === b.organizationId))) throw AppError.notFound();
      quotationId = c.acceptedQuotationId ?? c.currentQuotationId;
      lines = c.commitments.filter((m) => m.organizationId === b.organizationId && m.mode === 'PREPAID' && !m.adapterManaged).map((m) => ({ description: `${m.kind === 'CHARGE' ? 'Campaign funding' : 'Sponsor funding'} ${c.reference}`, amountMinor: Math.max(0, m.upfrontHalalas + m.usageMaxHalalas - m.receivedHalalas) })).filter((l) => l.amountMinor > 0);
    }
    if (!lines.length) throw new AppError('INVALID_STATE', 'Nothing is due', 409);
    const currency = b.currency ?? 'SAR';
    const id = await this.prisma.$transaction(async (tx) => {
      const acc = await this.accounts.ensure(tx, b.organizationId, null, currency);
      const total = lines.reduce((s, l) => s + l.amountMinor, 0);
      const d = await tx.financeDocument.create({
        data: { number: await this.commercial.nextNumber(tx, 'proforma_invoice', 'PRO'), type: 'PROFORMA_INVOICE', status: 'DRAFT', businessAccountId: acc.id, organizationId: b.organizationId, legalEntityId: acc.legalEntityId, caseId: b.caseId ?? null, quotationId, currency, subtotalHalalas: total, totalHalalas: total, sourceKind: 'QUOTATION', createdByUserId: actor.userId, statutory: { note: 'PROFORMA_NOT_A_TAX_INVOICE' }, invoiceLines: { create: lines.map((l, i) => ({ lineNo: i + 1, kind: 'CHARGE', description: l.description, amountMinor: l.amountMinor, currency, collection: 'PREPAID_DRAWDOWN' })) } },
      });
      await tx.financeDocument.update({ where: { id: d.id }, data: { status: 'ISSUED' } });
      await this.audit.record({ action: 'PROFORMA_ISSUED', entityType: 'FinanceDocument', entityId: d.id, actor, subjectOrganizationId: b.organizationId, newState: { total, currency }, meta }, tx);
      return d.id;
    });
    return this.view(id);
  }

  // ---------------------------------------------------------------- reading
  async list(a: FinanceAccess, f: { organizationId?: string; type?: string; status?: string; businessAccountId?: string }) {
    const where: Prisma.FinanceDocumentWhereInput = {
      AND: [
        a.admin ? (f.organizationId ? { organizationId: f.organizationId } : {}) : { organizationId: a.organizationId! },
        a.legalEntityIds ? { legalEntityId: { in: a.legalEntityIds } } : {},
        f.type ? { type: f.type as never } : { type: { not: 'PURCHASE_ORDER' } },
        f.status ? { status: f.status as never } : {},
        f.businessAccountId ? { businessAccountId: f.businessAccountId } : {},
        // a business never sees DealDash's drafts
        a.admin ? {} : { status: { notIn: ['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'] } },
      ],
    };
    const rows = await this.prisma.financeDocument.findMany({ where, orderBy: { issuedAt: 'desc' }, take: 200 });
    return Promise.all(rows.map((d) => this.summary(d)));
  }

  private async summary(d: Prisma.FinanceDocumentGetPayload<object>) {
    const credited = d.type === 'INVOICE' || d.type === 'TAX_INVOICE' ? await this.creditedOn(this.prisma, d.id) : 0;
    return {
      id: d.id,
      number: d.number,
      type: d.type,
      status: d.status,
      organizationId: d.organizationId,
      legalEntityId: d.legalEntityId,
      businessAccountId: d.businessAccountId,
      currency: d.currency,
      subtotalMinor: d.subtotalHalalas,
      taxMinor: d.taxHalalas,
      totalMinor: d.totalHalalas,
      paidMinor: d.paidHalalas,
      creditedMinor: credited,
      outstandingMinor: ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE'].includes(d.type) && (OPEN_RECEIVABLE_STATUSES as readonly string[]).includes(d.status) ? Math.max(0, d.totalHalalas - d.paidHalalas - credited) : 0,
      issuedAt: d.issuedAt.toISOString(),
      dueAt: d.dueAt?.toISOString() ?? null,
      periodStart: d.periodStart?.toISOString() ?? null,
      periodEnd: d.periodEnd?.toISOString() ?? null,
      sourceKind: d.sourceKind,
      relatedDocumentId: d.relatedDocumentId,
      purchaseOrderId: d.purchaseOrderId,
      fxRate: d.fxRate,
      transactionCurrency: d.transactionCurrency,
      statutory: d.statutory as Record<string, unknown>,
    };
  }

  async view(id: string, a?: FinanceAccess) {
    const d = await this.prisma.financeDocument.findUnique({ where: { id }, include: { invoiceLines: { orderBy: { lineNo: 'asc' } }, allocations: { where: { reversedAt: null } } } });
    if (!d) throw AppError.notFound();
    if (a && !a.admin) {
      if (d.organizationId !== a.organizationId || (a.legalEntityIds && (!d.legalEntityId || !a.legalEntityIds.includes(d.legalEntityId)))) throw AppError.notFound();
      if (['DRAFT', 'PENDING_APPROVAL', 'CANCELLED'].includes(d.status)) throw AppError.notFound();
    }
    return {
      ...(await this.summary(d)),
      lines: d.invoiceLines.length
        ? d.invoiceLines.map((l) => ({ lineNo: l.lineNo, kind: l.kind, description: l.description, descriptionAr: l.descriptionAr, product: l.product, campaignId: l.campaignId, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, amountMinor: l.amountMinor, taxRateBps: l.taxRateBps, taxMinor: l.taxMinor, pricingVersionKey: l.pricingVersionKey, eventType: l.eventType, collection: l.collection }))
        : ((d.lines as unknown as Array<{ description: string; amountHalalas: number }>) ?? []).map((l, i) => ({ lineNo: i + 1, kind: 'CHARGE', description: l.description, descriptionAr: null, product: null, campaignId: null, quantity: 1, unitPriceMinor: null, amountMinor: l.amountHalalas, taxRateBps: null, taxMinor: 0, pricingVersionKey: null, eventType: null, collection: 'CAMPAIGN_CASE' })),
      payments: d.allocations.map((x) => ({ paymentId: x.paymentId, amountMinor: x.amountMinor, allocatedAt: x.allocatedAt.toISOString() })),
      notes: d.notes,
      sentAt: d.sentAt?.toISOString() ?? null,
      approvedAt: d.approvedAt?.toISOString() ?? null,
      disputeCaseId: d.disputeCaseId,
    };
  }
}
