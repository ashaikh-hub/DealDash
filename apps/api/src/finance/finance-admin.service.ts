import { Injectable, Optional } from '@nestjs/common';
import { SignalService } from '../subscription/signal.service';
import type { CommercialProduct, UnusedTreatment } from '@dealdash/types';
import type { ReconciliationView } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../vouchers/ledger.service';
import { CommercialRegistry } from './commercial.registry';
import { CommercialService } from './commercial.service';
import { PricingService } from './pricing.service';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** DealDash Finance: agreements, credit, holds, payments, documents, adjustments, reconciliation. Every action is audited. */
@Injectable()
export class FinanceAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly commercial: CommercialService,
    private readonly registry: CommercialRegistry,
    private readonly pricing: PricingService,
    @Optional() private readonly signals?: SignalService,
  ) {}

  private act(actor: Actor, action: string, entityType: string, entityId: string, org: string | null, state: unknown, meta: RequestMeta, reason?: string | null) {
    return {
      action,
      entityType,
      entityId,
      actor,
      subjectOrganizationId: org,
      reason: reason ?? null,
      newState: state,
      meta,
    };
  }

  // ---------------------------------------------------------------- pricing agreements and approval rules
  async createAgreement(
    actor: Actor,
    b: {
      name: string;
      scope: 'GLOBAL' | 'ENTITY_TYPE' | 'ORGANIZATION';
      organizationId?: string;
      entityType?: string;
      market?: string;
      product?: CommercialProduct;
      priority: number;
      components: Record<string, unknown[]>;
      taxBps: number | null;
      unusedTreatment: UnusedTreatment | null;
      reference?: string;
    },
    meta: RequestMeta,
  ) {
    if (b.scope === 'ORGANIZATION' && !b.organizationId) throw AppError.validation('An organisation is required', 'organizationId');
    if (b.scope === 'ENTITY_TYPE' && !b.entityType) throw AppError.validation('An entity type is required', 'entityType');
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.pricingAgreement.create({
        data: {
          name: b.name,
          scope: b.scope,
          organizationId: b.organizationId ?? null,
          entityType: b.entityType ?? null,
          market: b.market ?? null,
          product: b.product ?? null,
          priority: b.priority,
          createdByUserId: actor.userId,
          versions: {
            create: {
              version: 1,
              components: b.components as unknown as Prisma.InputJsonValue,
              taxBps: b.taxBps,
              unusedTreatment: b.unusedTreatment,
              reference: b.reference ?? null,
              createdByUserId: actor.userId,
            },
          },
        },
      });
      await this.audit.record(this.act(actor, 'PRICING_AGREEMENT_CREATED', 'PricingAgreement', a.id, b.organizationId ?? null, { name: b.name, scope: b.scope }, meta), tx);
      return { id: a.id };
    });
  }

  /** A change is a NEW version; accepted quotations keep the version they were priced with. */
  async addVersion(
    actor: Actor,
    agreementId: string,
    b: { components: Record<string, unknown[]>; taxBps: number | null; unusedTreatment: UnusedTreatment | null; reference?: string },
    meta: RequestMeta,
  ) {
    const a = await this.prisma.pricingAgreement.findUnique({ where: { id: agreementId }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } });
    if (!a) throw AppError.notFound();
    const next = (a.versions[0]?.version ?? 0) + 1;
    await this.prisma.$transaction(async (tx) => {
      if (a.versions[0]) await tx.pricingAgreementVersion.update({ where: { id: a.versions[0].id }, data: { effectiveTo: new Date() } });
      await tx.pricingAgreementVersion.create({
        data: {
          agreementId,
          version: next,
          components: b.components as unknown as Prisma.InputJsonValue,
          taxBps: b.taxBps,
          unusedTreatment: b.unusedTreatment,
          reference: b.reference ?? null,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record(this.act(actor, 'PRICING_AGREEMENT_VERSIONED', 'PricingAgreement', agreementId, a.organizationId, { version: next }, meta), tx);
    });
    return { version: next };
  }

  async listAgreements() {
    const rows = await this.prisma.pricingAgreement.findMany({
      orderBy: { createdAt: 'desc' },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      take: 100,
    });
    return rows.map((a) => ({
      id: a.id,
      name: a.name,
      scope: a.scope,
      organizationId: a.organizationId,
      entityType: a.entityType,
      product: a.product,
      priority: a.priority,
      status: a.status,
      version: a.versions[0]?.version ?? 0,
      reference: a.versions[0]?.reference ?? null,
      unusedTreatment: a.versions[0]?.unusedTreatment ?? null,
      taxBps: a.versions[0]?.taxBps ?? null,
      components: (a.versions[0]?.components ?? {}) as unknown as Record<string, unknown>,
    }));
  }

  async createRule(actor: Actor, b: Prisma.CommercialApprovalRuleUncheckedCreateInput & { steps: string[] }, meta: RequestMeta) {
    const r = await this.prisma.$transaction(async (tx) => {
      const x = await tx.commercialApprovalRule.create({ data: { ...b, steps: b.steps as unknown as Prisma.InputJsonValue, createdByUserId: actor.userId } });
      await this.audit.record(this.act(actor, 'APPROVAL_RULE_CREATED', 'CommercialApprovalRule', x.id, x.organizationId, { name: x.name }, meta), tx);
      return x;
    });
    return { id: r.id };
  }

  async listRules() {
    const rows = await this.prisma.commercialApprovalRule.findMany({ orderBy: [{ scope: 'asc' }, { priority: 'asc' }] });
    return rows.map((r) => ({ id: r.id, name: r.name, active: r.active, scope: r.scope, product: r.product, entityType: r.entityType, organizationId: r.organizationId, minLiabilityHalalas: r.minLiabilityHalalas, steps: r.steps as unknown as string[] }));
  }

  async setRuleActive(actor: Actor, id: string, active: boolean, meta: RequestMeta) {
    const r = await this.prisma.commercialApprovalRule.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.commercialApprovalRule.update({ where: { id }, data: { active } });
      await this.audit.record(this.act(actor, 'APPROVAL_RULE_TOGGLED', 'CommercialApprovalRule', id, r.organizationId, { active }, meta), tx);
    });
  }

  // ---------------------------------------------------------------- authorisation to act on behalf (until the Partner Portal)
  async createAuthorization(actor: Actor, b: { organizationId: string; reference: string; reason: string; validUntil: string }, meta: RequestMeta) {
    const until = new Date(b.validUntil);
    if (Number.isNaN(until.getTime()) || until <= new Date()) throw AppError.validation('The authorisation must end in the future', 'validUntil');
    const org = await this.prisma.organization.findUnique({ where: { id: b.organizationId } });
    if (!org) throw AppError.notFound();
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.adminAuthorization.create({ data: { organizationId: b.organizationId, reference: b.reference, reason: b.reason, validUntil: until, createdByUserId: actor.userId } });
      await this.audit.record(this.act(actor, 'ADMIN_AUTHORIZATION_CREATED', 'AdminAuthorization', a.id, b.organizationId, { reference: b.reference, validUntil: b.validUntil }, meta, b.reason), tx);
      return { id: a.id };
    });
  }

  async listAuthorizations(organizationId?: string) {
    const rows = await this.prisma.adminAuthorization.findMany({ where: organizationId ? { organizationId } : {}, orderBy: { createdAt: 'desc' }, take: 50 });
    return rows.map((a) => ({ id: a.id, organizationId: a.organizationId, reference: a.reference, reason: a.reason, validUntil: a.validUntil.toISOString(), revoked: Boolean(a.revokedAt) }));
  }

  async revokeAuthorization(actor: Actor, id: string, meta: RequestMeta) {
    const a = await this.prisma.adminAuthorization.findUnique({ where: { id } });
    if (!a) throw AppError.notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.adminAuthorization.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(this.act(actor, 'ADMIN_AUTHORIZATION_REVOKED', 'AdminAuthorization', id, a.organizationId, null, meta), tx);
    });
  }

  // ---------------------------------------------------------------- credit facilities (maker-checker, configurable)
  async requestCredit(actor: Actor, b: { organizationId: string; limitHalalas: number; paymentTermsDays: number; expiresAt: string; agreementReference: string }, meta: RequestMeta) {
    const expires = new Date(b.expiresAt);
    if (Number.isNaN(expires.getTime()) || expires <= new Date()) throw AppError.validation('The facility must expire in the future', 'expiresAt');
    const org = await this.prisma.organization.findUnique({ where: { id: b.organizationId } });
    if (!org || org.status !== 'ACTIVE') throw AppError.validation('The business must be active', 'organizationId');
    return this.prisma.$transaction(async (tx) => {
      const acc = await this.commercial.accountOf(tx, b.organizationId);
      let f;
      try {
        f = await tx.creditFacility.create({
          data: { businessAccountId: acc.id, organizationId: b.organizationId, limitHalalas: b.limitHalalas, paymentTermsDays: b.paymentTermsDays, expiresAt: expires, agreementReference: b.agreementReference, requestedByUserId: actor.userId, requestedByName: actor.displayName },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') throw new AppError('INVALID_STATE', 'This business already has an open credit facility', 409);
        throw err;
      }
      await this.audit.record(this.act(actor, 'CREDIT_REQUESTED', 'CreditFacility', f.id, b.organizationId, { limit: b.limitHalalas, terms: b.paymentTermsDays }, meta), tx);
      return { id: f.id };
    });
  }

  async decideCredit(actor: Actor, id: string, decision: 'ACTIVE' | 'REJECTED', reason: string, meta: RequestMeta) {
    const f = await this.prisma.creditFacility.findUnique({ where: { id } });
    if (!f) throw AppError.notFound();
    if (f.status !== 'PENDING_APPROVAL') throw new AppError('INVALID_STATE', 'This request was already decided', 409);
    const steps = await this.pricing.workflow(f.organizationId, 'EXCLUSIVE', f.limitHalalas, 'CREDIT');
    if (steps.length && f.requestedByUserId === actor.userId)
      throw new AppError('APPROVAL_REQUIRED', 'A different person must approve credit (maker-checker)', 403);
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.creditFacility.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: decision, decidedByUserId: actor.userId, decidedByName: actor.displayName, decidedAt: new Date(), decisionReason: reason } });
      if (res.count !== 1) throw new AppError('INVALID_STATE', 'This request was already decided', 409);
      if (decision === 'ACTIVE') await tx.businessAccount.update({ where: { id: f.businessAccountId }, data: { fundingMode: 'CREDIT' } });
      await this.audit.record(this.act(actor, decision === 'ACTIVE' ? 'CREDIT_APPROVED' : 'CREDIT_REJECTED', 'CreditFacility', id, f.organizationId, { limit: f.limitHalalas }, meta, reason), tx);
    });
  }

  async setCreditStatus(actor: Actor, id: string, status: 'SUSPENDED' | 'ACTIVE', reason: string, meta: RequestMeta) {
    const f = await this.prisma.creditFacility.findUnique({ where: { id } });
    if (!f) throw AppError.notFound();
    const from = status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    if (f.status !== from) throw new AppError('INVALID_STATE', `A ${f.status} facility cannot become ${status}`, 409);
    await this.prisma.$transaction(async (tx) => {
      await tx.creditFacility.update({ where: { id }, data: { status } });
      await this.audit.record(this.act(actor, status === 'SUSPENDED' ? 'CREDIT_SUSPENDED' : 'CREDIT_REINSTATED', 'CreditFacility', id, f.organizationId, null, meta, reason), tx);
    });
  }

  async listCredit() {
    const rows = await this.prisma.creditFacility.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const out = [];
    for (const f of rows) {
      const exposure = await this.commercial.creditExposure(f.organizationId);
      const steps = await this.pricing.workflow(f.organizationId, 'EXCLUSIVE', f.limitHalalas, 'CREDIT');
      const expired = f.status === 'ACTIVE' && f.expiresAt <= new Date();
      out.push({
        id: f.id,
        organizationId: f.organizationId,
        currency: f.currency,
        limitHalalas: f.limitHalalas,
        exposureHalalas: exposure,
        availableHalalas: f.status === 'ACTIVE' && !expired ? Math.max(0, f.limitHalalas - exposure) : 0,
        paymentTermsDays: f.paymentTermsDays,
        expiresAt: f.expiresAt.toISOString(),
        agreementReference: f.agreementReference,
        status: (expired ? 'EXPIRED' : f.status) as 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'REJECTED',
        requestedByName: f.requestedByName,
        decidedByName: f.decidedByName,
        decisionReason: f.decisionReason,
        needsChecker: steps.length > 0,
      });
    }
    return out;
  }

  /**
   * Re-reads the agreement that now applies to the business and records its treatment of unused funding on an already accepted
   * case. The treatment is always the agreement's (never chosen here); it is refused when the agreement is silent.
   */
  async applyAgreementTreatment(actor: Actor, caseId: string, meta: RequestMeta) {
    const c = await this.prisma.commercialCase.findUnique({ where: { id: caseId } });
    if (!c) throw AppError.notFound();
    if (c.status === 'CLOSED') throw new AppError('INVALID_STATE', 'This case is closed', 409);
    const p = await this.pricing.resolve(c.ownerOrganizationId, c.product);
    if (!p.unusedTreatment) throw AppError.validation('The applicable agreement does not state a treatment for unused funding');
    await this.prisma.$transaction(async (tx) => {
      await tx.commercialCase.update({ where: { id: caseId }, data: { unusedTreatment: p.unusedTreatment } });
      await this.audit.record(this.act(actor, 'UNUSED_TREATMENT_APPLIED', 'CommercialCase', caseId, c.ownerOrganizationId, { treatment: p.unusedTreatment, agreement: p.reference }, meta), tx);
    });
    return { treatment: p.unusedTreatment };
  }

  // ---------------------------------------------------------------- holds
  async placeHold(actor: Actor, b: { organizationId: string; caseId?: string; reason: string }, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      let h;
      try {
        h = await tx.financialHold.create({ data: { organizationId: b.organizationId, caseId: b.caseId ?? null, reason: b.reason, placedByUserId: actor.userId } });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') throw new AppError('INVALID_STATE', 'A hold is already active here', 409);
        throw err;
      }
      await this.audit.record(this.act(actor, 'FINANCIAL_HOLD_PLACED', 'FinancialHold', h.id, b.organizationId, { caseId: b.caseId ?? null }, meta, b.reason), tx);
      const cases = await tx.commercialCase.findMany({ where: b.caseId ? { id: b.caseId } : { ownerOrganizationId: b.organizationId, status: { notIn: ['CLOSED', 'RECONCILED'] } }, select: { id: true } });
      for (const c of cases) await this.commercial.refreshStatus(tx, c.id);
      // Phase 4 turns this into an alert; an organization-level hold is what the financial-status interface reports
      await this.signals?.raise({ type: 'FINANCIAL_HOLD', dedupeKey: `hold:${h.id}`, organizationId: b.organizationId, payload: { caseId: b.caseId ?? null, reason: b.reason } }, tx);
      return { id: h.id };
    });
  }

  async releaseHold(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    const h = await this.prisma.financialHold.findUnique({ where: { id } });
    if (!h) throw AppError.notFound();
    await this.prisma.$transaction(async (tx) => {
      const res = await tx.financialHold.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'RELEASED', releasedByUserId: actor.userId, releasedAt: new Date(), releaseReason: reason } });
      if (res.count !== 1) throw new AppError('INVALID_STATE', 'This hold is not active', 409);
      await this.audit.record(this.act(actor, 'FINANCIAL_HOLD_RELEASED', 'FinancialHold', id, h.organizationId, null, meta, reason), tx);
      const cases = await tx.commercialCase.findMany({ where: h.caseId ? { id: h.caseId } : { ownerOrganizationId: h.organizationId, status: 'FINANCIAL_HOLD' }, select: { id: true } });
      for (const c of cases) {
        await tx.commercialCase.update({ where: { id: c.id }, data: { status: 'AWAITING_FUNDING' } });
        await this.commercial.refreshStatus(tx, c.id);
      }
    });
  }

  async listHolds() {
    const rows = await this.prisma.financialHold.findMany({ orderBy: { placedAt: 'desc' }, take: 100 });
    return rows.map((h) => ({ id: h.id, organizationId: h.organizationId, caseId: h.caseId, reason: h.reason, status: h.status, placedAt: h.placedAt.toISOString(), releasedAt: iso(h.releasedAt), releaseReason: h.releaseReason }));
  }

  // ---------------------------------------------------------------- payments, documents, adjustments
  async recordPayment(actor: Actor, b: { organizationId: string; caseId?: string; amountHalalas: number; method: string; externalReference?: string }, meta: RequestMeta) {
    const where = { organizationId: b.organizationId, adapterManaged: false, ...(b.caseId ? { caseId: b.caseId } : {}) };
    const ms = await this.prisma.fundingCommitment.findMany({ where, orderBy: { createdAt: 'asc' } });
    const open = ms.filter((m) => m.upfrontHalalas + m.usageMaxHalalas > m.receivedHalalas);
    if (!open.length) throw new AppError('INVALID_STATE', 'There is no open commitment to apply this payment to', 409);
    let left = b.amountHalalas;
    for (const m of open) {
      const x = Math.min(left, m.upfrontHalalas + m.usageMaxHalalas - m.receivedHalalas);
      if (x <= 0) continue;
      await this.commercial.receivePayment({ commitmentId: m.id, amountHalalas: x, method: b.method, actor, key: `${meta.requestId}:${m.id}`, externalReference: b.externalReference });
      left -= x;
    }
    if (left > 0) throw new AppError('INVALID_STATE', `${left} halalas could not be applied (over-payment is refused)`, 409);
    return { appliedHalalas: b.amountHalalas };
  }

  async createDocument(
    actor: Actor,
    b: { type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'RECEIPT' | 'PURCHASE_ORDER'; organizationId: string; caseId?: string; relatedDocumentId?: string; lines: Array<{ description: string; amountHalalas: number }>; taxHalalas: number; dueInDays?: number; notes?: string; statutory?: Record<string, unknown> },
    meta: RequestMeta,
  ) {
    if ((b.type === 'CREDIT_NOTE' || b.type === 'DEBIT_NOTE') && !b.relatedDocumentId) throw AppError.validation('A credit or debit note must refer to an invoice', 'relatedDocumentId');
    const prefix = { INVOICE: 'INV', CREDIT_NOTE: 'CN', DEBIT_NOTE: 'DN', RECEIPT: 'RC', PURCHASE_ORDER: 'PO' }[b.type];
    return this.prisma.$transaction(async (tx) => {
      if (b.relatedDocumentId) {
        const rel = await tx.financeDocument.findUnique({ where: { id: b.relatedDocumentId } });
        if (!rel || rel.organizationId !== b.organizationId) throw AppError.validation('The related document was not found', 'relatedDocumentId');
      }
      const acc = await this.commercial.accountOf(tx, b.organizationId);
      const subtotal = b.lines.reduce((n, l) => n + l.amountHalalas, 0);
      const d = await tx.financeDocument.create({
        data: {
          number: await this.commercial.nextNumber(tx, b.type.toLowerCase(), prefix),
          type: b.type,
          businessAccountId: acc.id,
          organizationId: b.organizationId,
          caseId: b.caseId ?? null,
          relatedDocumentId: b.relatedDocumentId ?? null,
          subtotalHalalas: subtotal,
          taxHalalas: b.taxHalalas,
          totalHalalas: subtotal + b.taxHalalas,
          lines: b.lines as unknown as Prisma.InputJsonValue,
          dueAt: b.dueInDays !== undefined ? new Date(Date.now() + b.dueInDays * 86_400_000) : null,
          // statutory format (tax invoice number, QR, e-invoicing) is configuration and VALIDATE-KSA
          statutory: { status: 'VALIDATE_KSA', ...(b.statutory ?? {}) } as unknown as Prisma.InputJsonValue,
          notes: b.notes ?? null,
          createdByUserId: actor.userId,
        },
      });
      await this.audit.record(this.act(actor, 'FINANCE_DOCUMENT_ISSUED', 'FinanceDocument', d.id, b.organizationId, { number: d.number, type: b.type, total: d.totalHalalas }, meta), tx);
      return { id: d.id, number: d.number };
    });
  }

  async listDocuments(organizationId?: string, caseId?: string) {
    const rows = await this.prisma.financeDocument.findMany({ where: { ...(organizationId ? { organizationId } : {}), ...(caseId ? { caseId } : {}) }, orderBy: { issuedAt: 'desc' }, take: 100 });
    return rows.map((d) => ({
      id: d.id,
      number: d.number,
      type: d.type,
      status: d.status,
      organizationId: d.organizationId,
      caseId: d.caseId,
      currency: d.currency,
      subtotalHalalas: d.subtotalHalalas,
      taxHalalas: d.taxHalalas,
      totalHalalas: d.totalHalalas,
      paidHalalas: d.paidHalalas,
      issuedAt: d.issuedAt.toISOString(),
      dueAt: iso(d.dueAt),
      lines: d.lines as unknown as Array<{ description: string; amountHalalas: number }>,
      statutory: d.statutory as unknown as Record<string, unknown>,
    }));
  }

  async listPayments(organizationId?: string) {
    const rows = await this.prisma.financePayment.findMany({ where: organizationId ? { organizationId } : {}, orderBy: { receivedAt: 'desc' }, take: 100 });
    return rows.map((p) => ({ id: p.id, reference: p.reference, organizationId: p.organizationId, caseId: p.caseId, amountHalalas: p.amountHalalas, method: p.method, externalReference: p.externalReference, receivedAt: p.receivedAt.toISOString() }));
  }

  /** Manual credit / debit to a business account: a balanced, idempotent ledger journal (never an edit). */
  async adjust(actor: Actor, b: { caseId?: string; organizationId: string; kind: 'CREDIT' | 'DEBIT'; amountHalalas: number; reason: string }, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const acc = await this.commercial.accountOf(tx, b.organizationId);
      const sign = b.kind === 'CREDIT' ? 1 : -1;
      const j = await this.ledger.post(tx, {
        type: 'DOCUMENT_ADJUSTMENT',
        sourceType: 'FINANCE_ADJUSTMENT',
        sourceId: b.caseId ?? acc.id,
        idempotencyKey: `adj:${meta.requestId}`,
        memo: b.reason,
        reasonCode: b.kind,
        actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
        lines: [
          { family: 'ADJUSTMENTS', amountHalalas: sign * b.amountHalalas },
          { family: 'CAMPAIGN_FUNDS_HELD', organizationId: b.organizationId, amountHalalas: -sign * b.amountHalalas },
        ],
      });
      const a = await tx.financeAdjustment.create({
        data: { caseId: b.caseId ?? null, businessAccountId: acc.id, organizationId: b.organizationId, kind: b.kind, amountHalalas: b.amountHalalas, reason: b.reason, journalId: j.journalId, createdByUserId: actor.userId, idempotencyKey: `adj:${meta.requestId}` },
      });
      await this.audit.record(this.act(actor, 'FINANCE_ADJUSTMENT', 'FinanceAdjustment', a.id, b.organizationId, { kind: b.kind, amount: b.amountHalalas }, meta, b.reason), tx);
      return { id: a.id };
    });
  }

  // ---------------------------------------------------------------- cases and overview
  async listCases(q: { limit: number; cursor?: string; status?: string; product?: string; organizationId?: string }) {
    const where: Prisma.CommercialCaseWhereInput = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.product ? { product: q.product as never } : {}),
      ...(q.organizationId ? { ownerOrganizationId: q.organizationId } : {}),
    };
    const page = await keysetPage({
      findMany: (args) => this.prisma.commercialCase.findMany(args),
      baseWhere: where as Record<string, unknown>,
      sort: { field: 'updatedAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const orgs = await this.prisma.organization.findMany({ where: { id: { in: page.items.map((c) => c.ownerOrganizationId) } }, select: { id: true, nameEn: true, nameAr: true } });
    return new Page(
      page.items.map((c) => {
        const o = orgs.find((x) => x.id === c.ownerOrganizationId);
        return { id: c.id, reference: c.reference, product: c.product, subjectId: c.subjectId, title: null, status: c.status, ownerOrganizationId: c.ownerOrganizationId, ownerName: { en: o?.nameEn ?? '', ar: o?.nameAr ?? '' }, maxCashHalalas: c.maxCashHalalas, benefitCommitmentHalalas: c.benefitCommitmentHalalas, developmentFixture: c.developmentFixture, updatedAt: c.updatedAt.toISOString() };
      }),
      page.nextCursor,
    );
  }

  async overview() {
    const grouped = await this.prisma.commercialCase.groupBy({ by: ['status'], _count: true });
    const [receivables, held, utilized, holds, pending] = await Promise.all([
      this.sumFamily('RECEIVABLE'),
      this.sumFamily('CAMPAIGN_FUNDS_HELD'),
      this.sumFamily('FUNDING_UTILIZED'),
      this.prisma.financialHold.count({ where: { status: 'ACTIVE' } }),
      this.prisma.creditFacility.count({ where: { status: 'PENDING_APPROVAL' } }),
    ]);
    return {
      cases: Object.fromEntries(grouped.map((g) => [g.status, g._count])),
      receivablesHalalas: receivables,
      fundsHeldHalalas: -held,
      fundingUtilizedHalalas: -utilized,
      openHolds: holds,
      pendingCredit: pending,
      exceptions: await this.prisma.commercialCase.count({ where: { status: { in: ['FINANCIAL_HOLD'] } } }),
      statutoryNote: 'statutory_formats_validate_ksa' as const,
    };
  }

  private async sumFamily(family: 'RECEIVABLE' | 'CAMPAIGN_FUNDS_HELD' | 'FUNDING_UTILIZED') {
    const m = await this.ledger.balancesByOrganization(family);
    let n = 0;
    for (const v of m.values()) n += v;
    return n;
  }

  // ---------------------------------------------------------------- reconciliation and closure
  async reconcile(caseId: string): Promise<ReconciliationView> {
    const c = await this.prisma.commercialCase.findUnique({ where: { id: caseId }, include: { commitments: true } });
    if (!c) throw AppError.notFound();
    const adapter = this.registry.get(c.product);
    const inv = await adapter.inventory(c.subjectId);
    const remaining = Math.max(0, inv.configured - inv.redeemed - inv.expiredOrUnused - inv.invalidOrCancelled);
    const managed = adapter.managedFunding ? await adapter.managedFunding(c.subjectId) : null;
    const exceptions: string[] = [];
    const financial = c.commitments.map((m) => {
      const committed = m.upfrontHalalas + m.usageMaxHalalas;
      const received = m.adapterManaged && managed ? managed.fundedHalalas : m.receivedHalalas;
      const used = m.adapterManaged && managed ? managed.spentHalalas : m.utilizedHalalas + m.upfrontEarnedHalalas;
      const outstanding = m.mode === 'CREDIT' ? Math.max(0, used - received) : Math.max(0, committed - received);
      const unused = m.mode === 'PREPAID' ? Math.max(0, received - used - m.releasedHalalas) : 0;
      if (received > committed) exceptions.push(`OVERFUNDED:${m.id}`);
      if (used > committed) exceptions.push(`OVERDRAWN:${m.id}`);
      return { organizationId: m.organizationId, kind: m.kind, committedHalalas: committed, receivedHalalas: received, utilizedHalalas: used, outstandingHalalas: outstanding, unusedHalalas: unused, releasedHalalas: m.releasedHalalas };
    });
    if (inv.redeemed > inv.issued) exceptions.push('REDEEMED_EXCEEDS_ISSUED');
    const q = c.acceptedQuotationId ? await this.prisma.quotation.findUnique({ where: { id: c.acceptedQuotationId } }) : null;
    const lines = (q?.lines as unknown as Array<{ kind: string; unitHalalas: number; amountHalalas: number }>) ?? [];
    const benefitPerUnit = lines.find((l) => l.kind === 'MERCHANT_BENEFIT')?.unitHalalas ?? 0;
    const benefitCommitted = lines.find((l) => l.kind === 'MERCHANT_BENEFIT')?.amountHalalas ?? 0;
    const latest = await this.prisma.caseReconciliation.findFirst({ where: { caseId }, orderBy: { computedAt: 'desc' } });
    return {
      id: latest?.id ?? null,
      caseId,
      status: latest?.status ?? 'NOT_RUN',
      computedAt: new Date().toISOString(),
      inventory: { ...inv, remaining },
      financial,
      // The merchant's own benefit is a non-cash commitment: reported on its own and never mixed with cash or sponsor funds.
      merchantBenefit: { committedHalalas: benefitCommitted, redeemedHalalas: benefitPerUnit * inv.redeemed, unusedHalalas: Math.max(0, benefitCommitted - benefitPerUnit * inv.redeemed), note: 'non_cash_unused_commitment' },
      exceptions,
      treatment: c.unusedTreatment,
    };
  }

  /**
   * Closure. Unused PREPAID funding is treated exactly as the agreement says (refund / account credit / carry forward /
   * transfer / non-refundable); there is no default. Earned charges are invoiced. The campaign must have ended.
   */
  async closeCase(actor: Actor, caseId: string, transferTargetCaseId: string | null, meta: RequestMeta) {
    const c = await this.prisma.commercialCase.findUnique({ where: { id: caseId }, include: { commitments: true } });
    if (!c) throw AppError.notFound();
    if (c.status === 'CLOSED') throw new AppError('INVALID_STATE', 'This case is already closed', 409);
    const adapter = this.registry.get(c.product);
    const subject = await adapter.load(c.subjectId);
    if (!subject.finished) throw new AppError('INVALID_STATE', 'The campaign has not ended yet', 409);
    const rec = await this.reconcile(caseId);
    const hasUnused = rec.financial.some((f) => f.unusedHalalas > 0);
    if (hasUnused && !c.unusedTreatment) throw new AppError('ACTIVATION_BLOCKED', 'The agreement does not say what happens to unused funding', 409);
    if (c.unusedTreatment === 'TRANSFER_CAMPAIGN' && hasUnused && !transferTargetCaseId) throw AppError.validation('A target campaign is required', 'transferTargetCaseId');
    await this.prisma.$transaction(async (tx) => {
      const acc = await this.commercial.accountOf(tx, c.ownerOrganizationId);
      let invoiceTotal = 0;
      for (const m of c.commitments.filter((x) => !x.adapterManaged)) {
        const used = m.utilizedHalalas + m.upfrontEarnedHalalas;
        if (m.kind === 'CHARGE') invoiceTotal += used;
        const unused = m.mode === 'PREPAID' ? Math.max(0, m.receivedHalalas - used - m.releasedHalalas) : 0;
        if (unused > 0 && c.unusedTreatment) {
          const t = c.unusedTreatment;
          if (t === 'REFUND')
            await this.ledger.post(tx, { type: 'FUNDING_RELEASED', sourceType: 'COMMERCIAL_CASE', sourceId: c.id, idempotencyKey: `release:${m.id}`, memo: 'Unused funding refunded', actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null }, lines: [{ family: 'CAMPAIGN_FUNDS_HELD', organizationId: m.organizationId, amountHalalas: unused }, { family: 'PSP_CLEARING', amountHalalas: -unused }] });
          else if (t === 'NON_REFUNDABLE')
            await this.ledger.post(tx, { type: 'FUNDING_RELEASED', sourceType: 'COMMERCIAL_CASE', sourceId: c.id, idempotencyKey: `release:${m.id}`, memo: 'Unused funding retained (non-refundable by agreement)', actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null }, lines: [{ family: 'CAMPAIGN_FUNDS_HELD', organizationId: m.organizationId, amountHalalas: unused }, { family: 'PLATFORM_REVENUE', amountHalalas: -unused }] });
          else if (t === 'TRANSFER_CAMPAIGN' && transferTargetCaseId) {
            const target = await tx.fundingCommitment.findFirst({ where: { caseId: transferTargetCaseId, organizationId: m.organizationId, kind: m.kind, adapterManaged: false } });
            if (!target) throw AppError.validation('The target campaign has no matching commitment', 'transferTargetCaseId');
            const room = target.upfrontHalalas + target.usageMaxHalalas - target.receivedHalalas;
            if (room < unused) throw AppError.validation('The target campaign cannot take that much', 'transferTargetCaseId');
            await tx.fundingCommitment.update({ where: { id: target.id }, data: { receivedHalalas: { increment: unused } } });
          }
          // CREDIT_ACCOUNT / CARRY_FORWARD keep the funds in the business's held balance (no journal needed)
          await tx.fundingCommitment.update({ where: { id: m.id }, data: { releasedHalalas: unused, status: 'CLOSED' } });
        } else await tx.fundingCommitment.update({ where: { id: m.id }, data: { status: 'CLOSED' } });
      }
      if (invoiceTotal > 0) {
        const q = c.acceptedQuotationId ? await tx.quotation.findUnique({ where: { id: c.acceptedQuotationId } }) : null;
        const taxBps = (q?.pricingSnapshot as unknown as { taxBps: number | null } | undefined)?.taxBps ?? null;
        const tax = taxBps === null ? 0 : Math.round((invoiceTotal * taxBps) / 10_000);
        const credit = c.commitments.some((m) => m.mode === 'CREDIT');
        await tx.financeDocument.create({
          data: { number: await this.commercial.nextNumber(tx, 'invoice', 'INV'), type: 'INVOICE', status: credit ? 'ISSUED' : 'PAID', businessAccountId: acc.id, organizationId: c.ownerOrganizationId, caseId: c.id, subtotalHalalas: invoiceTotal, taxHalalas: tax, totalHalalas: invoiceTotal + tax, paidHalalas: credit ? 0 : invoiceTotal + tax, lines: [{ description: `Campaign ${c.reference}`, amountHalalas: invoiceTotal }] as unknown as Prisma.InputJsonValue, statutory: { status: 'VALIDATE_KSA', taxConfigured: taxBps !== null } as unknown as Prisma.InputJsonValue },
        });
      }
      await tx.caseReconciliation.create({ data: { caseId, status: rec.exceptions.length ? 'EXCEPTIONS' : 'RECONCILED', snapshot: rec as unknown as Prisma.InputJsonValue, closedByUserId: actor.userId, closedAt: new Date(), treatment: { treatment: c.unusedTreatment, transferTargetCaseId } as unknown as Prisma.InputJsonValue } });
      await tx.commercialCase.update({ where: { id: caseId }, data: { status: 'CLOSED', closedAt: new Date(), transferTargetCaseId } });
      await this.audit.record(this.act(actor, 'COMMERCIAL_CASE_CLOSED', 'CommercialCase', caseId, c.ownerOrganizationId, { treatment: c.unusedTreatment, exceptions: rec.exceptions }, meta), tx);
    });
    return this.reconcile(caseId);
  }
}
