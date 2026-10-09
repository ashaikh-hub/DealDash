import { Injectable } from '@nestjs/common';
import {
  BILLING_ACCOUNT_STATUSES,
  BILLING_FREQUENCIES,
  BILLING_METHODS,
  type BillingAccountStatus,
} from '@dealdash/types';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { CommercialService } from '../finance/commercial.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { FinanceAccess } from './finance-access.service';

type Db = Prisma.TransactionClient | PrismaService;
const D = 86_400_000;

/** Exact decimal multiplication of an integer minor amount by a rate written as text (no floating point drift). */
export function convertMinor(amountMinor: number, rate: string): number {
  const [i, f = ''] = rate.split('.');
  const scale = 10n ** BigInt(f.length);
  const r = BigInt(`${i}${f}`);
  const num = BigInt(amountMinor) * r;
  // round half up
  return Number((num * 2n + scale) / (2n * scale));
}

export interface BillingAccountPatch {
  name?: string | null;
  billingAddress?: Record<string, unknown>;
  financeContact?: Record<string, unknown>;
  invoiceContact?: Record<string, unknown>;
  taxId?: string | null;
  // DealDash only
  paymentTermsDays?: number;
  billingFrequency?: string;
  billingMethod?: string;
  contractId?: string | null;
  poRequired?: boolean;
}

/**
 * Billing accounts (Phase 5 legal-entity finance scope), purchase orders and controlled FX rates. A billing account belongs to one
 * organization and one legal entity in one currency; one of them is the default per currency. The legal entity, never a brand or a
 * branch, is the billed party.
 */
@Injectable()
export class BillingAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly commercial: CommercialService,
  ) {}

  // ---------------------------------------------------------------- accounts
  /** Finds or opens the account for (organization, legal entity, currency). The first account of a currency becomes the default. */
  async ensure(db: Db, organizationId: string, legalEntityId: string | null, currency: string) {
    const le = legalEntityId
      ? await db.legalEntity.findFirst({ where: { id: legalEntityId, organizationId } })
      : await db.legalEntity.findFirst({
          where: { organizationId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
        });
    if (!le) {
      // no legal entity yet: the commercial default account creates one from the business's legal name
      if (currency === 'SAR') return this.commercial.accountOf(db, organizationId);
      throw AppError.validation('This business has no legal entity to bill', 'legalEntityId');
    }
    const found = await db.businessAccount.findUnique({
      where: {
        organizationId_legalEntityId_currency: { organizationId, legalEntityId: le.id, currency },
      },
    });
    if (found) return found;
    const hasDefault = await db.businessAccount.count({
      where: { organizationId, currency, isDefault: true },
    });
    try {
      return await db.businessAccount.create({
        data: {
          organizationId,
          legalEntityId: le.id,
          currency,
          isDefault: hasDefault === 0,
          country: le.country,
          taxId: le.taxNumber,
          name: le.legalName,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      return db.businessAccount.findUniqueOrThrow({
        where: {
          organizationId_legalEntityId_currency: { organizationId, legalEntityId: le.id, currency },
        },
      });
    }
  }

  async list(a: FinanceAccess, organizationId?: string) {
    const where: Prisma.BusinessAccountWhereInput = {
      ...(a.admin
        ? organizationId
          ? { organizationId }
          : {}
        : { organizationId: a.organizationId! }),
      ...(a.legalEntityIds ? { legalEntityId: { in: a.legalEntityIds } } : {}),
    };
    const rows = await this.prisma.businessAccount.findMany({
      where,
      include: {
        legalEntity: {
          select: { legalName: true, country: true, currency: true, taxNumber: true },
        },
      },
      orderBy: [{ organizationId: 'asc' }, { currency: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async get(a: FinanceAccess, id: string) {
    const r = await this.prisma.businessAccount.findUnique({
      where: { id },
      include: {
        legalEntity: {
          select: { legalName: true, country: true, currency: true, taxNumber: true },
        },
      },
    });
    if (!r) throw AppError.notFound();
    if (
      !a.admin &&
      (r.organizationId !== a.organizationId ||
        (a.legalEntityIds && !a.legalEntityIds.includes(r.legalEntityId)))
    )
      throw AppError.notFound();
    return this.view(r);
  }

  private async view(
    r: Prisma.BusinessAccountGetPayload<{
      include: {
        legalEntity: {
          select: { legalName: true; country: true; currency: true; taxNumber: true };
        };
      };
    }>,
  ) {
    const credit = await this.prisma.creditFacility.findFirst({
      where: {
        businessAccountId: r.id,
        status: { in: ['ACTIVE', 'SUSPENDED', 'PENDING_APPROVAL'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    const exposure = credit ? await this.commercial.creditExposure(r.organizationId) : 0;
    const pos = await this.purchaseOrders(
      { admin: true, organizationId: null, legalEntityIds: null, canManage: false },
      { businessAccountId: r.id },
    );
    return {
      id: r.id,
      organizationId: r.organizationId,
      legalEntityId: r.legalEntityId,
      legalEntity: {
        legalName: r.legalEntity.legalName,
        country: r.legalEntity.country,
        taxNumber: r.legalEntity.taxNumber,
      },
      name: r.name ?? r.legalEntity.legalName,
      currency: r.currency,
      country: r.country,
      isDefault: r.isDefault,
      status: r.status as BillingAccountStatus,
      fundingMode: r.fundingMode,
      billingAddress: r.billingAddress as Record<string, unknown>,
      taxId: r.taxId,
      financeContact: r.financeContact as Record<string, unknown>,
      invoiceContact: r.invoiceContact as Record<string, unknown>,
      paymentTermsDays: r.paymentTermsDays,
      billingFrequency: r.billingFrequency,
      billingMethod: r.billingMethod,
      contractId: r.contractId,
      poRequired: r.poRequired,
      lastBilledAt: r.lastBilledAt?.toISOString() ?? null,
      credit: credit
        ? {
            id: credit.id,
            status: credit.status,
            limitMinor: credit.limitHalalas,
            exposureMinor: exposure,
            availableMinor:
              credit.status === 'ACTIVE' && credit.expiresAt > new Date()
                ? Math.max(0, credit.limitHalalas - exposure)
                : 0,
            paymentTermsDays: credit.paymentTermsDays,
            expiresAt: credit.expiresAt.toISOString(),
          }
        : null,
      purchaseOrders: pos.filter((p) => p.status === 'ACTIVE').length,
    };
  }

  /** Business members edit contacts and address; terms, frequency, method, contract and the PO rule are DealDash's. */
  async update(
    actor: Actor,
    a: FinanceAccess,
    id: string,
    b: BillingAccountPatch,
    meta: RequestMeta,
  ) {
    const r = await this.prisma.businessAccount.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    if (
      !a.admin &&
      (r.organizationId !== a.organizationId ||
        (a.legalEntityIds && !a.legalEntityIds.includes(r.legalEntityId)))
    )
      throw AppError.notFound();
    const dealdashOnly = [
      'paymentTermsDays',
      'billingFrequency',
      'billingMethod',
      'contractId',
      'poRequired',
    ] as const;
    if (!a.admin && dealdashOnly.some((k) => b[k] !== undefined))
      throw new AppError(
        'FORBIDDEN',
        'Payment terms, billing frequency and method, the contract and the PO rule are set by DealDash',
        403,
      );
    if (
      b.billingFrequency &&
      !(BILLING_FREQUENCIES as readonly string[]).includes(b.billingFrequency)
    )
      throw AppError.validation('Unknown billing frequency', 'billingFrequency');
    if (b.billingMethod && !(BILLING_METHODS as readonly string[]).includes(b.billingMethod))
      throw AppError.validation('Unknown billing method', 'billingMethod');
    if (
      b.contractId &&
      !(await this.prisma.contract.count({
        where: { id: b.contractId, organizationId: r.organizationId },
      }))
    )
      throw AppError.validation('The contract is not this business’s', 'contractId');
    const data: Prisma.BusinessAccountUpdateInput = {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.billingAddress ? { billingAddress: b.billingAddress as Prisma.InputJsonValue } : {}),
      ...(b.financeContact ? { financeContact: b.financeContact as Prisma.InputJsonValue } : {}),
      ...(b.invoiceContact ? { invoiceContact: b.invoiceContact as Prisma.InputJsonValue } : {}),
      ...(b.taxId !== undefined ? { taxId: b.taxId } : {}),
      ...(b.paymentTermsDays !== undefined ? { paymentTermsDays: b.paymentTermsDays } : {}),
      ...(b.billingFrequency ? { billingFrequency: b.billingFrequency } : {}),
      ...(b.billingMethod ? { billingMethod: b.billingMethod } : {}),
      ...(b.contractId !== undefined ? { contractId: b.contractId } : {}),
      ...(b.poRequired !== undefined ? { poRequired: b.poRequired } : {}),
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.businessAccount.update({ where: { id }, data });
      await this.audit.record(
        {
          action: 'BILLING_ACCOUNT_UPDATED',
          entityType: 'BusinessAccount',
          entityId: id,
          actor,
          subjectOrganizationId: r.organizationId,
          previousState: {
            paymentTermsDays: r.paymentTermsDays,
            billingFrequency: r.billingFrequency,
            billingMethod: r.billingMethod,
            poRequired: r.poRequired,
          },
          newState: b,
          meta,
        },
        tx,
      );
    });
    return this.get(a, id);
  }

  /** Account status (DealDash): a financial hold is also placed / released as an organization-level hold (the existing mechanism). */
  async setStatus(
    actor: Actor,
    id: string,
    status: BillingAccountStatus,
    reason: string,
    meta: RequestMeta,
  ) {
    if (!(BILLING_ACCOUNT_STATUSES as readonly string[]).includes(status))
      throw AppError.validation('Unknown status', 'status');
    const r = await this.prisma.businessAccount.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    if (r.status === status) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.businessAccount.update({ where: { id }, data: { status } });
      if (
        status === 'FINANCIAL_HOLD' &&
        !(await tx.financialHold.findFirst({
          where: { organizationId: r.organizationId, businessAccountId: id, status: 'ACTIVE' },
        }))
      )
        await tx.financialHold.create({
          data: {
            organizationId: r.organizationId,
            businessAccountId: id,
            reason,
            placedByUserId: actor.userId,
          },
        });
      if (r.status === 'FINANCIAL_HOLD' && status !== 'FINANCIAL_HOLD')
        await tx.financialHold.updateMany({
          where: { organizationId: r.organizationId, businessAccountId: id, status: 'ACTIVE' },
          data: {
            status: 'RELEASED',
            releasedAt: new Date(),
            releasedByUserId: actor.userId,
            releaseReason: reason,
          },
        });
      await this.audit.record(
        {
          action: 'BILLING_ACCOUNT_STATUS',
          entityType: 'BusinessAccount',
          entityId: id,
          actor,
          subjectOrganizationId: r.organizationId,
          previousState: { status: r.status },
          newState: { status },
          reason,
          meta,
        },
        tx,
      );
    });
  }

  // ---------------------------------------------------------------- purchase orders
  /** Remaining value of a PO: its value minus every non-cancelled document that draws on it. */
  async poRemaining(db: Db, poId: string): Promise<number> {
    const po = await db.financeDocument.findUniqueOrThrow({ where: { id: poId } });
    const used = await db.financeDocument.aggregate({
      where: { purchaseOrderId: poId, status: { notIn: ['CANCELLED', 'VOID', 'DRAFT'] } },
      _sum: { totalHalalas: true },
    });
    return Math.max(0, po.totalHalalas - (used._sum.totalHalalas ?? 0));
  }

  /** A usable PO for this amount, or the reason there is none (PO_REQUIRED / PO_INSUFFICIENT). */
  async poFor(
    db: Db,
    account: { id: string; organizationId: string; currency: string },
    amountMinor: number,
    at = new Date(),
  ) {
    const pos = await db.financeDocument.findMany({
      where: {
        type: 'PURCHASE_ORDER',
        businessAccountId: account.id,
        currency: account.currency,
        status: { in: ['ISSUED', 'SENT'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
      },
      orderBy: { issuedAt: 'asc' },
    });
    if (!pos.length) return { po: null, code: 'PO_REQUIRED' as const };
    for (const po of pos)
      if ((await this.poRemaining(db, po.id)) >= amountMinor) return { po, code: null };
    return { po: null, code: 'PO_INSUFFICIENT' as const };
  }

  async createPurchaseOrder(
    actor: Actor,
    a: FinanceAccess,
    b: {
      organizationId: string;
      legalEntityId?: string | null;
      currency: string;
      poNumber: string;
      valueMinor: number;
      expiresAt?: string | null;
      fileId?: string | null;
      notes?: string | null;
    },
    meta: RequestMeta,
  ) {
    const orgId = a.admin ? b.organizationId : a.organizationId!;
    if (!a.canManage) throw AppError.forbidden();
    if (b.valueMinor <= 0) throw AppError.validation('A PO has a positive value', 'valueMinor');
    if (b.expiresAt && new Date(b.expiresAt) <= new Date())
      throw AppError.validation('The PO must expire in the future', 'expiresAt');
    if (a.legalEntityIds && (!b.legalEntityId || !a.legalEntityIds.includes(b.legalEntityId)))
      throw AppError.notFound();
    if (
      b.fileId &&
      !(await this.prisma.storedFile.count({ where: { id: b.fileId, organizationId: orgId } }))
    )
      throw AppError.validation('The file was not found', 'fileId');
    return this.prisma.$transaction(async (tx) => {
      const acc = await this.ensure(tx, orgId, b.legalEntityId ?? null, b.currency);
      const dup = await tx.financeDocument.findFirst({
        where: {
          type: 'PURCHASE_ORDER',
          businessAccountId: acc.id,
          externalReference: b.poNumber,
          status: { notIn: ['CANCELLED', 'VOID'] },
        },
      });
      if (dup) throw new AppError('INVALID_STATE', 'This PO number is already recorded', 409);
      const d = await tx.financeDocument.create({
        data: {
          number: await this.commercial.nextNumber(tx, 'purchase_order', 'PO'),
          type: 'PURCHASE_ORDER',
          status: 'ISSUED',
          businessAccountId: acc.id,
          organizationId: orgId,
          legalEntityId: acc.legalEntityId,
          currency: b.currency,
          subtotalHalalas: b.valueMinor,
          totalHalalas: b.valueMinor,
          externalReference: b.poNumber,
          expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
          fileId: b.fileId ?? null,
          notes: b.notes ?? null,
          sourceKind: 'MANUAL',
          createdByUserId: actor.userId,
          statutory: {},
        },
      });
      await this.audit.record(
        {
          action: 'PURCHASE_ORDER_RECORDED',
          entityType: 'FinanceDocument',
          entityId: d.id,
          actor,
          subjectOrganizationId: orgId,
          newState: { poNumber: b.poNumber, value: b.valueMinor, currency: b.currency },
          meta,
        },
        tx,
      );
      return d.id;
    });
  }

  async purchaseOrders(
    a: FinanceAccess,
    f: { organizationId?: string; businessAccountId?: string },
  ) {
    const rows = await this.prisma.financeDocument.findMany({
      where: {
        type: 'PURCHASE_ORDER',
        ...(a.admin
          ? f.organizationId
            ? { organizationId: f.organizationId }
            : {}
          : { organizationId: a.organizationId! }),
        ...(a.legalEntityIds ? { legalEntityId: { in: a.legalEntityIds } } : {}),
        ...(f.businessAccountId ? { businessAccountId: f.businessAccountId } : {}),
      },
      orderBy: { issuedAt: 'desc' },
      take: 200,
    });
    const out = [];
    for (const r of rows) {
      const remaining = await this.poRemaining(this.prisma, r.id);
      const expired = r.expiresAt !== null && r.expiresAt <= new Date();
      out.push({
        id: r.id,
        number: r.number,
        poNumber: r.externalReference,
        organizationId: r.organizationId,
        legalEntityId: r.legalEntityId,
        businessAccountId: r.businessAccountId,
        currency: r.currency,
        valueMinor: r.totalHalalas,
        remainingMinor: remaining,
        usedMinor: r.totalHalalas - remaining,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        status:
          r.status === 'CANCELLED' || r.status === 'VOID'
            ? 'CANCELLED'
            : expired
              ? 'EXPIRED'
              : remaining <= 0
                ? 'EXHAUSTED'
                : 'ACTIVE',
        fileId: r.fileId,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- FX (controlled: never converted without an approved rate)
  async proposeRate(
    actor: Actor,
    b: {
      baseCurrency: string;
      quoteCurrency: string;
      rate: string;
      source: string;
      rateDate: string;
      isManualOverride?: boolean;
      overrideReason?: string | null;
    },
    meta: RequestMeta,
  ) {
    // a manual override of the source rate is allowed only with a reason (still maker-checker approved and audited)
    if (b.isManualOverride && !(b.overrideReason ?? '').trim()) throw AppError.validation('A manual override needs a reason', 'overrideReason');
    if (!/^[0-9]+(\.[0-9]{1,10})?$/.test(b.rate) || Number(b.rate) <= 0)
      throw AppError.validation('A rate is a positive decimal (up to 10 places)', 'rate');
    if (b.baseCurrency === b.quoteCurrency)
      throw AppError.validation('Two different currencies are needed', 'quoteCurrency');
    try {
      const r = await this.prisma.fxRate.create({
        data: {
          baseCurrency: b.baseCurrency,
          quoteCurrency: b.quoteCurrency,
          rate: b.rate,
          source: b.source,
          rateDate: new Date(b.rateDate),
          createdByUserId: actor.userId,
          isManualOverride: b.isManualOverride ?? false,
          overrideReason: b.overrideReason ?? null,
        },
      });
      await this.audit.record({
        action: 'FX_RATE_PROPOSED',
        entityType: 'FxRate',
        entityId: r.id,
        actor,
        newState: {
          pair: `${b.baseCurrency}/${b.quoteCurrency}`,
          rate: b.rate,
          source: b.source,
          rateDate: b.rateDate,
        },
        meta,
      });
      return r;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        throw new AppError(
          'INVALID_STATE',
          'A rate for this pair, date and source already exists',
          409,
        );
      throw e;
    }
  }

  async decideRate(actor: Actor, id: string, approve: boolean, meta: RequestMeta) {
    const r = await this.prisma.fxRate.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    if (r.status !== 'PENDING_APPROVAL')
      throw new AppError('INVALID_STATE', 'This rate was already decided', 409);
    if (r.createdByUserId === actor.userId)
      throw new AppError(
        'APPROVAL_REQUIRED',
        'A different finance person must approve an exchange rate',
        403,
      );
    await this.prisma.$transaction(async (tx) => {
      await tx.fxRate.update({
        where: { id },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          approvedByUserId: actor.userId,
          approvedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          action: approve ? 'FX_RATE_APPROVED' : 'FX_RATE_REJECTED',
          entityType: 'FxRate',
          entityId: id,
          actor,
          newState: { rate: r.rate },
          meta,
        },
        tx,
      );
    });
  }

  listRates() {
    return this.prisma.fxRate.findMany({
      orderBy: [{ rateDate: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  /** The approved rate base -> quote in force on a date (latest on or before it). */
  async rateFor(db: Db, base: string, quote: string, at: Date) {
    const r = await db.fxRate.findFirst({
      where: {
        baseCurrency: base,
        quoteCurrency: quote,
        status: 'APPROVED',
        rateDate: { lte: new Date(at.getTime() + D) },
      },
      orderBy: { rateDate: 'desc' },
    });
    if (!r)
      throw new AppError(
        'FX_RATE_REQUIRED',
        `An approved ${base}/${quote} exchange rate is needed`,
        409,
      );
    return r;
  }
}
