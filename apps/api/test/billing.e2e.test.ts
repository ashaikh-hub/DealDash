import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BILLING_EVENT_TYPES, type BillingEventType } from '@dealdash/types';
import { DB_READY, createBusinessUser, createTestApp, idem, passwordSession, type Session, type TestApp } from './helpers';
import { buildHotWorld, type HotWorld } from './hot-fixtures';
import { InvoicingService } from '../src/billing/invoicing.service';
import { ReceivablesService } from '../src/billing/receivables.service';
import { ReceivablesFinancialStatusProvider } from '../src/billing/financial-status.provider';
import { CommercialService } from '../src/finance/commercial.service';
import { FINANCIAL_STATUS_PROVIDER, type FinancialStatusProvider } from '../src/subscription/policy';

/**
 * Phase 5 billing on the shared finance platform: legal-entity billing accounts and scope, billing runs (each billing event collected
 * exactly once), invoice approval and immutability, payments and allocation, notes, PO and FX controls, receivables, overdue and the
 * financial status, disputes, statements, reconciliation and the quotation decisions.
 */
describe.skipIf(!DB_READY)('Phase 5: billing and finance', () => {
  let t: TestApp;
  let w: HotWorld;
  let fin1: Session;
  let fin2: Session;
  let le1: string;
  let le2: string;
  let leAe: string;
  let scopedLe1: Session;
  const inv: Record<string, string> = {};
  const acct: Record<string, string> = {};

  const orgA = () => w.A.orgId;
  const get = (s: Session, path: string) => w.api(s).get(path);
  const post = (s: Session, path: string, body: unknown = {}) => w.api(s).post(path).set('Idempotency-Key', idem()).send(body as object);
  const put = (s: Session, path: string, body: unknown) => w.api(s).put(path).send(body as object);
  const event = (eventType: BillingEventType, amountMinor: number, legalEntityId: string, extra: Record<string, unknown> = {}) =>
    t.prisma.commercialBillingEvent.create({
      data: { idempotencyKey: `test:${randomUUID()}`, organizationId: orgA(), legalEntityId, billingLegalEntityId: legalEntityId, eventType, billingCategory: BILLING_EVENT_TYPES[eventType], amountMinor, currency: 'SAR', quantity: 1, ...extra },
    });
  const run = () => t.app.get(InvoicingService).run(null, { organizationId: orgA(), force: true });
  const draftFor = async (legalEntityId: string) => t.prisma.financeDocument.findFirstOrThrow({ where: { organizationId: orgA(), legalEntityId, status: 'DRAFT', sourceKind: 'BILLING_RUN' }, orderBy: { createdAt: 'desc' } });

  beforeAll(async () => {
    t = await createTestApp();
    w = await buildHotWorld(t);
    const dd = await t.prisma.organizationMembership.findFirstOrThrow({ where: { userId: w.superAdmin.me.id } });
    const finUser = async () => passwordSession(t, await createBusinessUser(t.prisma, { role: 'DEALDASH_FINANCE', orgId: dd.organizationId, userType: 'ADMIN_USER', mfa: true }), 'admin', { completeMfa: true });
    fin1 = await finUser();
    fin2 = await finUser();
    const le = async (legalName: string, country: string, currency: string) => {
      const r = await post(w.ownerA, `/v1/orgs/${orgA()}/legal-entities`, { legalName, country, currency });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.data.id as string;
    };
    le1 = await le('Alpha Grill Riyadh LLC', 'SA', 'SAR');
    le2 = await le('Alpha Grill Jeddah LLC', 'SA', 'SAR');
    leAe = await le('Alpha Grill Dubai FZ', 'AE', 'AED');
    // a finance member scoped to ONE legal entity
    const u = await createBusinessUser(t.prisma, { role: 'MERCHANT_FINANCE', orgId: orgA(), userType: 'MERCHANT_USER', label: 'fin-le1' });
    const m = await t.prisma.organizationMembership.findFirstOrThrow({ where: { userId: u.id, organizationId: orgA() } });
    expect((await post(w.ownerA, `/v1/orgs/${orgA()}/members/${m.id}/scoped`, { scoped: true })).status).toBe(200);
    const asg = await post(w.ownerA, `/v1/orgs/${orgA()}/assignments`, { membershipId: m.id, roleCode: 'MERCHANT_FINANCE', scope: { kind: 'LEGAL_ENTITY', ref: le1 } });
    expect(asg.status, JSON.stringify(asg.body)).toBe(201);
    const fresh = await t.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    scopedLe1 = await passwordSession(t, { id: fresh.id, email: fresh.email! } as never, 'merchant');
  });
  afterAll(() => t?.close());

  describe('billing run: each billing event is collected exactly once', () => {
    it('drafts invoices per legal entity for INVOICE_DUE events and consumes prepaid / netted usage without invoicing it', async () => {
      await event('ANNUAL_LICENCE_RENEWAL', 100_000, le1);
      await event('SETUP_FEE', 50_000, le2);
      await event('LICENCE_ACTIVATION', 12_000_000, le2);
      const view = await event('QUALIFIED_VIEW_USAGE', 300, le1, { product: 'WATCH', campaignId: randomUUID() });
      const commission = await event('VOUCHER_TRANSACTION_COMMISSION', 500, le1, { product: 'VOUCHER' });
      const r = await run();
      expect(r.drafts).toHaveLength(2);
      expect(r.consumed).toBeGreaterThanOrEqual(2);
      expect(await t.prisma.commercialBillingEvent.findUniqueOrThrow({ where: { id: view.id } })).toMatchObject({ status: 'CONSUMED', collection: 'PREPAID_DRAWDOWN', invoiceLineId: null });
      expect(await t.prisma.commercialBillingEvent.findUniqueOrThrow({ where: { id: commission.id } })).toMatchObject({ status: 'CONSUMED', collection: 'NETTED_FROM_PAYABLE' });
      const d1 = await draftFor(le1);
      const d2 = await draftFor(le2);
      expect(d1.totalHalalas).toBe(100_000);
      expect(d2.totalHalalas).toBe(12_050_000);
      inv.le1 = d1.id;
      inv.le2 = d2.id;
      // a second run never picks the same events again
      expect((await run()).drafts).toHaveLength(0);
    });

    it('a business never sees DealDash drafts', async () => {
      const list = (await get(w.financeA, `/v1/orgs/${orgA()}/billing/documents`)).body.data.map((d: { id: string }) => d.id);
      expect(list).not.toContain(inv.le1);
      expect((await get(w.financeA, `/v1/orgs/${orgA()}/billing/documents/${inv.le1}`)).status).toBe(404);
    });

    it('issuing numbers the invoice, sets the due date and links each billing event to its invoice line', async () => {
      const r = await post(fin1, `/v1/admin/billing/documents/${inv.le1}/issue`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.status).toBe('ISSUED');
      expect(r.body.data.number).toMatch(/^(INV|TINV)-\d{6}$/);
      expect(r.body.data.dueAt).toBeTruthy();
      // tax not configured for the market: stated, never invented
      expect(r.body.data.statutory.status).toBe('TAX_NOT_CONFIGURED_VALIDATE');
      expect(r.body.data.lines[0]).toMatchObject({ description: 'Annual licence', descriptionAr: 'ترخيص سنوي', amountMinor: 100_000, collection: 'INVOICE_DUE' });
      const ev = await t.prisma.commercialBillingEvent.findFirstOrThrow({ where: { organizationId: orgA(), eventType: 'ANNUAL_LICENCE_RENEWAL' } });
      expect(ev.status).toBe('CONSUMED');
      expect(ev.invoiceLineId).toBeTruthy();
      expect(ev.settlementRef).toBe(r.body.data.number);
    });

    it('an issued document is immutable: no edit, no delete, no cancellation (corrections are notes)', async () => {
      await expect(t.prisma.financeDocument.update({ where: { id: inv.le1 }, data: { totalHalalas: 1 } })).rejects.toThrow();
      await expect(t.prisma.financeDocument.delete({ where: { id: inv.le1 } })).rejects.toThrow();
      await expect(t.prisma.invoiceLine.updateMany({ where: { documentId: inv.le1 }, data: { amountMinor: 1 } })).rejects.toThrow();
      const c = await post(fin1, `/v1/admin/billing/documents/${inv.le1}/cancel`, { reason: 'Try to cancel' });
      expect(c.status).toBe(409);
      expect(c.body.errors[0].code).toBe('DOCUMENT_IMMUTABLE');
    });

    it('a large invoice needs a second finance person', async () => {
      const first = await post(fin1, `/v1/admin/billing/documents/${inv.le2}/issue`);
      expect(first.body.data.status).toBe('PENDING_APPROVAL');
      const self = await post(fin1, `/v1/admin/billing/documents/${inv.le2}/issue`);
      expect(self.status).toBe(403);
      expect(self.body.errors[0].code).toBe('APPROVAL_REQUIRED');
      expect((await post(w.ops, `/v1/admin/billing/documents/${inv.le2}/issue`)).status).toBe(403);
      const ok = await post(fin2, `/v1/admin/billing/documents/${inv.le2}/issue`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.status).toBe('ISSUED');
      expect(ok.body.data.approvedAt).toBeTruthy();
    });
  });

  describe('legal-entity finance scope', () => {
    it('a member scoped to one legal entity sees only its accounts and documents; other access is refused', async () => {
      const docs = (await get(scopedLe1, `/v1/orgs/${orgA()}/billing/documents`)).body.data.map((d: { id: string }) => d.id);
      expect(docs).toContain(inv.le1);
      expect(docs).not.toContain(inv.le2);
      expect((await get(scopedLe1, `/v1/orgs/${orgA()}/billing/documents/${inv.le2}`)).status).toBe(404);
      const accounts = (await get(scopedLe1, `/v1/orgs/${orgA()}/billing/accounts`)).body.data;
      expect(accounts.every((a: { legalEntityId: string }) => a.legalEntityId === le1)).toBe(true);
      const all = (await get(w.financeA, `/v1/orgs/${orgA()}/billing/accounts`)).body.data;
      acct.le1 = all.find((a: { legalEntityId: string; currency: string }) => a.legalEntityId === le1 && a.currency === 'SAR').id;
      acct.le2 = all.find((a: { legalEntityId: string; currency: string }) => a.legalEntityId === le2 && a.currency === 'SAR').id;
      expect((await get(scopedLe1, `/v1/orgs/${orgA()}/billing/accounts/${acct.le2}`)).status).toBe(404);
      expect((await get(w.ownerB, `/v1/orgs/${orgA()}/billing/documents`)).status).toBe(404);
      expect((await get(w.ownerB, `/v1/orgs/${w.B.orgId}/billing/documents/${inv.le1}`)).status).toBe(404);
      expect((await get(w.branchScopedA, `/v1/orgs/${orgA()}/billing/documents`)).status).toBe(403);
      expect((await get(w.campaignsA, `/v1/orgs/${orgA()}/billing/documents`)).status).toBe(403);
      expect([401, 403]).toContain((await get(w.staffA, `/v1/orgs/${orgA()}/billing/documents`)).status);
      expect([401, 403]).toContain((await get(w.ownerA, `/v1/admin/billing/documents`)).status);
    });

    it('the business edits contacts; terms and the PO rule are DealDash decisions', async () => {
      const ok = await put(w.financeA, `/v1/orgs/${orgA()}/billing/accounts/${acct.le1}`, { invoiceContact: { name: 'AP team', email: 'ap@alpha.test' } });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.invoiceContact.email).toBe('ap@alpha.test');
      expect((await put(w.financeA, `/v1/orgs/${orgA()}/billing/accounts/${acct.le1}`, { paymentTermsDays: 90 })).status).toBe(403);
      expect((await put(scopedLe1, `/v1/orgs/${orgA()}/billing/accounts/${acct.le2}`, { taxId: 'X' })).status).toBe(404);
    });
  });

  describe('payments, notes and receivables', () => {
    it('partial payment, then overpayment kept as unallocated credit; never in another currency', async () => {
      const p1 = await post(fin1, '/v1/admin/billing/payments', { businessAccountId: acct.le1, amountMinor: 40_000, currency: 'SAR', method: 'BANK_TRANSFER' });
      expect(p1.status, JSON.stringify(p1.body)).toBe(201);
      expect(p1.body.data).toMatchObject({ allocatedMinor: 40_000, unallocatedMinor: 0 });
      let d = (await get(fin1, `/v1/admin/billing/documents/${inv.le1}`)).body.data;
      expect(d).toMatchObject({ status: 'PARTIALLY_PAID', paidMinor: 40_000, outstandingMinor: 60_000 });
      const over = await post(fin1, '/v1/admin/billing/payments', { businessAccountId: acct.le1, amountMinor: 10_000, currency: 'SAR', method: 'BANK_TRANSFER', allocations: [{ documentId: inv.le1, amountMinor: 70_000 }] });
      expect(over.status).toBe(422);
      expect(over.body.errors[0].code).toBe('OVERPAYMENT');
      const p2 = await post(fin1, '/v1/admin/billing/payments', { businessAccountId: acct.le1, amountMinor: 80_000, currency: 'SAR', method: 'BANK_TRANSFER' });
      expect(p2.body.data).toMatchObject({ allocatedMinor: 60_000, unallocatedMinor: 20_000 });
      d = (await get(fin1, `/v1/admin/billing/documents/${inv.le1}`)).body.data;
      expect(d).toMatchObject({ status: 'PAID', outstandingMinor: 0 });
      expect(d.payments).toHaveLength(2);
      expect((await post(fin1, '/v1/admin/billing/payments', { businessAccountId: acct.le1, amountMinor: 1_000, currency: 'USD', method: 'BANK_TRANSFER' })).status).toBe(400);
      // payment receipts are issued documents
      expect(await t.prisma.financeDocument.count({ where: { businessAccountId: acct.le1, type: 'RECEIPT', status: 'ISSUED' } })).toBe(2);
      const ar = (await get(w.financeA, `/v1/orgs/${orgA()}/billing/receivables`)).body.data.find((a: { businessAccountId: string }) => a.businessAccountId === acct.le1);
      expect(ar).toMatchObject({ invoicedMinor: 100_000, paidMinor: 100_000, outstandingMinor: 0, unallocatedCreditMinor: 20_000 });
    });

    it('credit and debit notes correct an invoice; a credit note can never exceed it', async () => {
      const cn = await post(fin1, `/v1/admin/billing/documents/${inv.le2}/notes`, { kind: 'CREDIT_NOTE', amountMinor: 50_000, reason: 'Setup fee waived' });
      expect(cn.status, JSON.stringify(cn.body)).toBe(201);
      expect(cn.body.data).toMatchObject({ type: 'CREDIT_NOTE', status: 'ISSUED', relatedDocumentId: inv.le2 });
      expect(cn.body.data.number).toMatch(/^CN-/);
      const d = (await get(fin1, `/v1/admin/billing/documents/${inv.le2}`)).body.data;
      expect(d).toMatchObject({ creditedMinor: 50_000, outstandingMinor: 12_000_000 });
      const tooMuch = await post(fin1, `/v1/admin/billing/documents/${inv.le2}/notes`, { kind: 'CREDIT_NOTE', amountMinor: 12_000_001, reason: 'Too much' });
      expect(tooMuch.status).toBe(400);
      const dn = await post(fin1, `/v1/admin/billing/documents/${inv.le2}/notes`, { kind: 'DEBIT_NOTE', amountMinor: 1_000, reason: 'Late documentation fee' });
      expect(dn.body.data).toMatchObject({ type: 'DEBIT_NOTE', status: 'ISSUED' });
      expect(dn.body.data.dueAt).toBeTruthy();
    });

    it('a business disputes an invoice; DealDash resolves it', async () => {
      const r = await post(w.financeA, `/v1/orgs/${orgA()}/billing/documents/${inv.le2}/dispute`, { reason: 'The licence started a month later' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect((await get(w.financeA, `/v1/orgs/${orgA()}/billing/documents/${inv.le2}`)).body.data).toMatchObject({ status: 'DISPUTED', disputeCaseId: r.body.data.caseId });
      expect((await post(scopedLe1, `/v1/orgs/${orgA()}/billing/documents/${inv.le2}/dispute`, { reason: 'Not mine to dispute' })).status).toBe(404);
      const res = await post(fin1, `/v1/admin/billing/documents/${inv.le2}/dispute/resolve`, { outcome: 'REJECTED', reason: 'Licence dates confirmed' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe('ISSUED');
      expect((await t.prisma.disputeCase.findUniqueOrThrow({ where: { id: r.body.data.caseId } })).status).toBe('RESOLVED');
    });

    it('overdue invoices are reported in the financial status; they drive PAST_DUE only when Finance switches that on', async () => {
      const later = new Date(Date.now() + 45 * 86_400_000);
      expect(await t.app.get(ReceivablesService).markOverdue(later)).toBeGreaterThanOrEqual(1);
      expect((await t.prisma.financeDocument.findUniqueOrThrow({ where: { id: inv.le2 } })).status).toBe('OVERDUE');
      const provider = t.app.get<FinancialStatusProvider>(FINANCIAL_STATUS_PROVIDER);
      expect(provider).toBeInstanceOf(ReceivablesFinancialStatusProvider);
      const s = await provider.statusFor(orgA(), { at: later });
      expect(s.status).toBe('GRACE');
      expect(s.reasons).toContain('INVOICES_OVERDUE_GRACE_ELAPSED');
      const strict = new ReceivablesFinancialStatusProvider(t.prisma as never, { get: async () => ({ overdueGraceDays: 7, overdueDrivesPastDue: true }) } as never);
      expect((await strict.statusFor(orgA(), { at: later })).status).toBe('PAST_DUE');
      // AR aging and the credit exposure include the open invoice
      const ar = (await get(fin1, `/v1/admin/billing/receivables?organizationId=${orgA()}`)).body.data.find((a: { businessAccountId: string }) => a.businessAccountId === acct.le2);
      expect(ar.outstandingMinor).toBe(12_001_000);
      expect(ar.aging.CURRENT + ar.aging.D1_30).toBe(12_001_000);
      expect(await t.app.get(CommercialService).creditExposure(orgA())).toBeGreaterThanOrEqual(12_001_000);
    });

    it('statements of account show opening, movements and the running balance', async () => {
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();
      const s = await get(w.financeA, `/v1/orgs/${orgA()}/billing/accounts/${acct.le1}/statement?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      expect(s.body.data.openingMinor).toBe(0);
      expect(s.body.data.lines.map((l: { kind: string }) => l.kind)).toEqual(expect.arrayContaining(['PAYMENT']));
      expect(s.body.data.closingMinor).toBe(100_000 - 120_000);
      const issued = await post(fin1, `/v1/admin/billing/accounts/${acct.le1}/statement`, { from, to });
      expect(issued.status, JSON.stringify(issued.body)).toBe(201);
      expect(issued.body.data.number).toMatch(/^SOA-/);
    });

    it('write-off stays disabled until the statutory treatment is confirmed', async () => {
      const r = await post(fin2, `/v1/admin/billing/documents/${inv.le2}/write-off`, { reason: 'Uncollectable' });
      expect(r.status).toBe(403);
    });
  });

  describe('purchase orders and exchange rates', () => {
    it('an account that requires a PO cannot be invoiced without enough PO value', async () => {
      expect((await put(fin1, `/v1/admin/billing/accounts/${acct.le1}`, { poRequired: true })).status).toBe(200);
      await event('ADD_ON_FEE', 30_000, le1);
      await run();
      const d = await draftFor(le1);
      const none = await post(fin1, `/v1/admin/billing/documents/${d.id}/issue`);
      expect(none.status).toBe(409);
      expect(none.body.errors[0].code).toBe('PO_REQUIRED');
      expect((await post(w.financeA, `/v1/orgs/${orgA()}/billing/purchase-orders`, { legalEntityId: le1, currency: 'SAR', poNumber: 'PO-SMALL', valueMinor: 10_000 })).status).toBe(201);
      const small = await post(fin1, `/v1/admin/billing/documents/${d.id}/issue`);
      expect(small.body.errors[0].code).toBe('PO_INSUFFICIENT');
      expect((await post(w.financeA, `/v1/orgs/${orgA()}/billing/purchase-orders`, { legalEntityId: le1, currency: 'SAR', poNumber: 'PO-BIG', valueMinor: 100_000 })).status).toBe(201);
      const ok = await post(fin1, `/v1/admin/billing/documents/${d.id}/issue`);
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const pos = (await get(w.financeA, `/v1/orgs/${orgA()}/billing/purchase-orders`)).body.data;
      const big = pos.find((p: { poNumber: string }) => p.poNumber === 'PO-BIG');
      expect(ok.body.data.purchaseOrderId).toBe(big.id);
      expect(big).toMatchObject({ remainingMinor: 70_000, usedMinor: 30_000, status: 'ACTIVE' });
      expect((await post(scopedLe1, `/v1/orgs/${orgA()}/billing/purchase-orders`, { legalEntityId: le2, currency: 'SAR', poNumber: 'PO-X', valueMinor: 1_000 })).status).toBe(404);
    });

    it('no conversion without an approved rate; a rate needs a second person', async () => {
      await event('INTEGRATION_FEE', 10_000, leAe);
      const blocked = await run();
      expect(blocked.blocked).toEqual([expect.objectContaining({ legalEntityId: leAe, currency: 'AED', code: 'FX_RATE_REQUIRED' })]);
      const rate = await post(fin1, '/v1/admin/billing/fx-rates', { baseCurrency: 'SAR', quoteCurrency: 'AED', rate: '0.9790', source: `TEST-${randomUUID().slice(0, 8)}`, rateDate: new Date(Date.now() - 3_600_000).toISOString() });
      expect(rate.status, JSON.stringify(rate.body)).toBe(201);
      expect((await post(fin1, `/v1/admin/billing/fx-rates/${rate.body.data.id}/approve`)).status).toBe(403);
      expect((await post(fin2, `/v1/admin/billing/fx-rates/${rate.body.data.id}/approve`)).status).toBe(200);
      const r = await run();
      expect(r.drafts).toHaveLength(1);
      const d = await draftFor(leAe);
      expect(d).toMatchObject({ currency: 'AED', transactionCurrency: 'SAR', settlementCurrency: 'AED', fxRate: '0.9790', totalHalalas: 9_790 });
    });
  });

  describe('proforma, reconciliation and quotations', () => {
    it('a proforma requests payment and is never a receivable', async () => {
      const r = await post(fin1, '/v1/admin/billing/proforma', { organizationId: orgA(), lines: [{ description: 'Campaign funding', amountMinor: 25_000 }] });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.data).toMatchObject({ type: 'PROFORMA_INVOICE', status: 'ISSUED', outstandingMinor: 0 });
      expect(r.body.data.statutory.note).toBe('PROFORMA_NOT_A_TAX_INVOICE');
    });

    it('reconciliation by product shows how each flow was collected, with product flow checks', async () => {
      const r = await get(w.financeA, `/v1/orgs/${orgA()}/billing/reconciliation?by=PRODUCT`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const row = (k: string) => r.body.data.rows.find((x: { key: string }) => x.key === k);
      expect(row('WATCH')).toMatchObject({ prepaidDrawdownMinor: 300, billedMinor: 0 });
      expect(row('VOUCHER')).toMatchObject({ nettedMinor: 500, billedMinor: 0 });
      expect(r.body.data.integrity.invoiceDueWithoutInvoiceLine).toBe(0);
      expect(r.body.data.flows.map((f: { product: string }) => f.product)).toEqual(['WATCH', 'EXCLUSIVE', 'VOUCHER', 'LOYALTY']);
      const byLe = await get(w.financeA, `/v1/orgs/${orgA()}/billing/reconciliation?by=LEGAL_ENTITY`);
      expect(byLe.body.data.rows.find((x: { key: string }) => x.key === le1).billedMinor).toBe(100_000 + 30_000);
      expect((await get(fin1, `/v1/admin/billing/reconciliation?by=MERCHANT&organizationId=${orgA()}`)).status).toBe(200);
    });

    it('a quotation can be rejected or sent back for changes; an expired one cannot be accepted and is re-quoted', async () => {
      const deal = await w.createHot('A', w.hotContent('A', 3));
      const commercial = t.app.get(CommercialService);
      const q1 = await commercial.syncQuotation('EXCLUSIVE', deal.id);
      const decline = (quotationId: string, decision: string) => post(w.ownerA, `/v1/orgs/${orgA()}/billing/quotations/${q1.caseId}/decline`, { quotationId, decision, reason: 'The fee is higher than agreed' });
      expect((await post(w.ownerB, `/v1/orgs/${w.B.orgId}/billing/quotations/${q1.caseId}/decline`, { quotationId: q1.quotationId, decision: 'REJECT', reason: 'Not mine at all' })).status).toBe(404);
      expect((await decline(q1.quotationId, 'REQUEST_MODIFICATION')).status).toBe(200);
      expect(await t.prisma.quotation.findUniqueOrThrow({ where: { id: q1.quotationId } })).toMatchObject({ status: 'MODIFICATION_REQUESTED', modificationRequest: 'The fee is higher than agreed' });
      expect((await decline(q1.quotationId, 'REJECT')).status).toBe(409);
      const q2 = await commercial.syncQuotation('EXCLUSIVE', deal.id);
      expect(q2.quotationId).not.toBe(q1.quotationId);
      expect((await t.prisma.quotation.findUniqueOrThrow({ where: { id: q2.quotationId } })).validUntil).toBeTruthy();
      await t.prisma.quotation.update({ where: { id: q2.quotationId }, data: { validUntil: new Date(Date.now() - 1000) } });
      const acc = await post(w.ownerA, `/v1/merchants/${orgA()}/commercial/cases/${q2.caseId}/accept`, { quotationId: q2.quotationId, checks: ['REVIEWED_TERMS', 'ACCEPT_TERMS'], language: 'en' });
      expect(acc.status).toBe(409);
      expect(acc.body.errors[0].code).toBe('QUOTATION_EXPIRED');
      expect((await t.prisma.quotation.findUniqueOrThrow({ where: { id: q2.quotationId } })).status).toBe('EXPIRED');
      const q3 = await commercial.syncQuotation('EXCLUSIVE', deal.id);
      expect(q3.quotationId).not.toBe(q2.quotationId);
      expect((await t.prisma.quotation.findUniqueOrThrow({ where: { id: q3.quotationId } })).status).toBe('PENDING_ACCEPTANCE');
    });

    it('a financial hold on a billing account holds the business; releasing it restores standing', async () => {
      const hold = await post(fin1, `/v1/admin/billing/accounts/${acct.le1}/status`, { status: 'FINANCIAL_HOLD', reason: 'Collections review' });
      expect(hold.status, JSON.stringify(hold.body)).toBe(200);
      const provider = t.app.get<FinancialStatusProvider>(FINANCIAL_STATUS_PROVIDER);
      expect((await provider.statusFor(orgA())).status).toBe('FINANCIAL_HOLD');
      await post(fin1, `/v1/admin/billing/accounts/${acct.le1}/status`, { status: 'ACTIVE', reason: 'Review complete' });
      expect((await provider.statusFor(orgA())).reasons).not.toContain('FINANCIAL_HOLD');
      expect(await t.prisma.auditLog.count({ where: { action: 'BILLING_ACCOUNT_STATUS', entityId: acct.le1 } })).toBe(2);
    });
  });
});
