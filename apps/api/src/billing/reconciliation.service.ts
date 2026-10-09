import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { FinanceAccess } from './finance-access.service';

export const RECON_DIMENSIONS = [
  'BUSINESS_ACCOUNT',
  'LEGAL_ENTITY',
  'PRODUCT',
  'CAMPAIGN',
  'FUNDING_PARTY',
  'MERCHANT',
  'SPONSOR',
  'CURRENCY',
] as const;
export type ReconDimension = (typeof RECON_DIMENSIONS)[number];

interface Bucket {
  key: string;
  currency: string;
  billedMinor: number;
  prepaidDrawdownMinor: number;
  nettedMinor: number;
  campaignCaseMinor: number;
  pendingMinor: number;
  invoicedMinor: number;
  paidMinor: number;
  fundingReceivedMinor: number;
  fundingUtilizedMinor: number;
  merchantPayableMinor: number;
  merchantSettledMinor: number;
  differences: string[];
}

/**
 * Reconciliation on the shared finance platform. Every billing event is collected exactly once (invoice, prepaid draw-down, netting
 * from the merchant payable or the campaign case); this view groups them by the requested dimension next to invoices, payments,
 * funding and merchant payables, and checks each product flow (Watch & Earn, Exclusive Deals, Vouchers, Loyalty). Read-only.
 */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    a: FinanceAccess,
    q: { by: ReconDimension; organizationId?: string; from?: Date; to?: Date; currency?: string },
  ) {
    if (!(RECON_DIMENSIONS as readonly string[]).includes(q.by))
      throw AppError.validation('Unknown dimension', 'by');
    if (
      !a.admin &&
      (q.by === 'MERCHANT' || q.by === 'SPONSOR' || q.by === 'FUNDING_PARTY') &&
      !a.organizationId
    )
      throw AppError.forbidden();
    const org = a.admin ? q.organizationId : a.organizationId!;
    const at: Prisma.DateTimeFilter = {
      ...(q.from ? { gte: q.from } : {}),
      ...(q.to ? { lt: q.to } : {}),
    };
    const hasAt = !!(q.from || q.to);
    const leFilter = a.legalEntityIds ? { in: a.legalEntityIds } : undefined;
    const buckets = new Map<string, Bucket>();
    const b = (key: string, currency: string) => {
      const k = `${key}|${currency}`;
      let x = buckets.get(k);
      if (!x)
        buckets.set(
          k,
          (x = {
            key,
            currency,
            billedMinor: 0,
            prepaidDrawdownMinor: 0,
            nettedMinor: 0,
            campaignCaseMinor: 0,
            pendingMinor: 0,
            invoicedMinor: 0,
            paidMinor: 0,
            fundingReceivedMinor: 0,
            fundingUtilizedMinor: 0,
            merchantPayableMinor: 0,
            merchantSettledMinor: 0,
            differences: [],
          }),
        );
      return x;
    };

    // ---- billing events
    const events = await this.prisma.commercialBillingEvent.findMany({
      where: {
        ...(org ? { organizationId: org } : {}),
        ...(leFilter ? { billingLegalEntityId: leFilter } : {}),
        ...(hasAt ? { occurredAt: at } : {}),
        ...(q.currency ? { currency: q.currency } : {}),
        status: { not: 'VOID' },
      },
      select: {
        organizationId: true,
        businessAccountId: true,
        billingLegalEntityId: true,
        legalEntityId: true,
        product: true,
        campaignId: true,
        currency: true,
        amountMinor: true,
        status: true,
        collection: true,
        invoiceLineId: true,
        eventType: true,
      },
    });
    let orphanInvoiceDue = 0;
    for (const e of events) {
      const key = this.keyOf(q.by, {
        organizationId: e.organizationId,
        businessAccountId: e.businessAccountId,
        legalEntityId: e.billingLegalEntityId ?? e.legalEntityId,
        product: e.product,
        campaignId: e.campaignId,
        currency: e.currency,
      });
      if (key === null) continue;
      const x = b(key, e.currency);
      const amt = e.amountMinor ?? 0;
      if (e.status === 'PENDING') x.pendingMinor += amt;
      else if (e.collection === 'INVOICE_DUE') {
        x.billedMinor += amt;
        if (!e.invoiceLineId) orphanInvoiceDue++;
      } else if (e.collection === 'PREPAID_DRAWDOWN') x.prepaidDrawdownMinor += amt;
      else if (e.collection === 'NETTED_FROM_PAYABLE') x.nettedMinor += amt;
      else if (e.collection === 'CAMPAIGN_CASE') x.campaignCaseMinor += amt;
    }

    // ---- invoices and payments (document level)
    if (
      q.by !== 'CAMPAIGN' &&
      q.by !== 'PRODUCT' &&
      q.by !== 'SPONSOR' &&
      q.by !== 'FUNDING_PARTY'
    ) {
      const docs = await this.prisma.financeDocument.findMany({
        where: {
          ...(org ? { organizationId: org } : {}),
          ...(leFilter ? { legalEntityId: leFilter } : {}),
          ...(hasAt ? { issuedAt: at } : {}),
          ...(q.currency ? { currency: q.currency } : {}),
          type: { in: ['INVOICE', 'TAX_INVOICE', 'DEBIT_NOTE', 'CREDIT_NOTE'] },
          status: { notIn: ['DRAFT', 'PENDING_APPROVAL', 'CANCELLED', 'VOID'] },
        },
        select: {
          organizationId: true,
          businessAccountId: true,
          legalEntityId: true,
          currency: true,
          type: true,
          totalHalalas: true,
          paidHalalas: true,
        },
      });
      for (const d of docs) {
        const key = this.keyOf(q.by, {
          organizationId: d.organizationId,
          businessAccountId: d.businessAccountId,
          legalEntityId: d.legalEntityId,
          product: null,
          campaignId: null,
          currency: d.currency,
        });
        if (key === null) continue;
        const x = b(key, d.currency);
        x.invoicedMinor += d.type === 'CREDIT_NOTE' ? -d.totalHalalas : d.totalHalalas;
        x.paidMinor += d.type === 'CREDIT_NOTE' ? 0 : d.paidHalalas;
      }
    }

    // ---- funding parties (commercial cases: owner charges, sponsor funding)
    if (
      q.by === 'FUNDING_PARTY' ||
      q.by === 'SPONSOR' ||
      q.by === 'CAMPAIGN' ||
      q.by === 'PRODUCT'
    ) {
      const commitments = await this.prisma.fundingCommitment.findMany({
        where: {
          ...(org ? { organizationId: org } : {}),
          ...(q.by === 'SPONSOR' ? { role: 'SPONSOR' } : {}),
          ...(hasAt ? { createdAt: at } : {}),
        },
        include: { case: { select: { product: true, subjectId: true } } },
      });
      for (const c of commitments) {
        const key =
          q.by === 'CAMPAIGN'
            ? c.case.subjectId
            : q.by === 'PRODUCT'
              ? c.case.product
              : `${c.organizationId}:${c.role}`;
        const x = b(key, 'SAR');
        x.fundingReceivedMinor += c.receivedHalalas;
        x.fundingUtilizedMinor += c.utilizedHalalas + c.upfrontEarnedHalalas;
      }
    }

    // ---- merchant payables (voucher sales, payable to the merchant less commission)
    if (q.by === 'MERCHANT' || q.by === 'PRODUCT' || q.by === 'CURRENCY') {
      const pay = await this.prisma.merchantPayableEvent.groupBy({
        by: ['organizationId', 'type'],
        where: { ...(org ? { organizationId: org } : {}), ...(hasAt ? { createdAt: at } : {}) },
        _sum: { amountHalalas: true },
      });
      const settled = await this.prisma.merchantPayableEvent.groupBy({
        by: ['organizationId'],
        where: {
          ...(org ? { organizationId: org } : {}),
          settlementId: { not: null },
          ...(hasAt ? { createdAt: at } : {}),
        },
        _sum: { amountHalalas: true },
      });
      for (const r of pay) {
        const x = b(
          q.by === 'MERCHANT' ? r.organizationId : q.by === 'PRODUCT' ? 'VOUCHER' : 'SAR',
          'SAR',
        );
        x.merchantPayableMinor += r._sum.amountHalalas ?? 0;
      }
      for (const r of settled)
        b(
          q.by === 'MERCHANT' ? r.organizationId : q.by === 'PRODUCT' ? 'VOUCHER' : 'SAR',
          'SAR',
        ).merchantSettledMinor += r._sum.amountHalalas ?? 0;
    }

    const rows = [...buckets.values()].map((x) => {
      if (x.billedMinor > 0 && x.invoicedMinor > 0 && x.invoicedMinor < x.billedMinor)
        x.differences.push('BILLED_NOT_FULLY_INVOICED');
      if (x.fundingUtilizedMinor > x.fundingReceivedMinor && q.by !== 'FUNDING_PARTY')
        x.differences.push('UTILIZED_ABOVE_RECEIVED_FUNDING');
      return { ...x, status: x.differences.length ? 'DIFFERENCE' : 'MATCHED' };
    });
    return {
      by: q.by,
      rows: rows.sort((p, r) => p.key.localeCompare(r.key)),
      integrity: { invoiceDueWithoutInvoiceLine: orphanInvoiceDue },
      flows: await this.flows(org ?? null, a.legalEntityIds),
    };
  }

  private keyOf(
    by: ReconDimension,
    r: {
      organizationId: string;
      businessAccountId: string | null;
      legalEntityId: string | null;
      product: string | null;
      campaignId: string | null;
      currency: string;
    },
  ): string | null {
    switch (by) {
      case 'BUSINESS_ACCOUNT':
        return r.businessAccountId ?? `org:${r.organizationId}`;
      case 'LEGAL_ENTITY':
        return r.legalEntityId ?? 'UNASSIGNED';
      case 'PRODUCT':
        return r.product ?? 'PLATFORM';
      case 'CAMPAIGN':
        return r.campaignId;
      case 'CURRENCY':
        return r.currency;
      default:
        return r.organizationId;
    }
  }

  /**
   * Product flow checks (SAR general ledger products). Each states the money in, the money used and what is left, and whether the
   * product's own counters agree with the finance records.
   */
  async flows(organizationId: string | null, legalEntityIds: string[] | null) {
    if (legalEntityIds) return [];
    const org = organizationId ? { organizationId } : {};
    // Watch & Earn: funded = spent + remaining (+ released); billed qualified-view usage = spent
    const watch = await this.prisma.watchCampaign.aggregate({
      where: org,
      _sum: { fundedHalalas: true, spentHalalas: true, unusedHalalas: true },
    });
    const watchFunding = await this.prisma.watchFunding.aggregate({
      where: org,
      _sum: { amountHalalas: true },
    });
    const watchBilled = await this.prisma.commercialBillingEvent.aggregate({
      where: { ...org, eventType: 'QUALIFIED_VIEW_USAGE', status: { not: 'VOID' } },
      _sum: { amountMinor: true },
    });
    // Exclusive Deals: verified redemptions billed vs the case utilisation (charges)
    const exclusiveUtil = await this.prisma.fundingCommitment.aggregate({
      where: { ...org, kind: 'CHARGE', case: { product: 'EXCLUSIVE' } },
      _sum: { utilizedHalalas: true, receivedHalalas: true },
    });
    const exclusiveBilled = await this.prisma.commercialBillingEvent.aggregate({
      where: {
        ...org,
        eventType: 'VERIFIED_REDEMPTION_USAGE',
        product: 'EXCLUSIVE',
        status: { not: 'VOID' },
      },
      _sum: { amountMinor: true },
    });
    // Vouchers: commission billed (netted) vs commission retained on the payable
    const voucherCommission = await this.prisma.commercialBillingEvent.aggregate({
      where: { ...org, eventType: 'VOUCHER_TRANSACTION_COMMISSION', status: { not: 'VOID' } },
      _sum: { amountMinor: true },
    });
    const voucherFees = await this.prisma.merchantPayableEvent.aggregate({
      where: { ...org, type: 'SOLD' },
      _sum: { feeHalalas: true, amountHalalas: true },
    });
    const voucherSettled = await this.prisma.merchantPayableEvent.aggregate({
      where: { ...org, settlementId: { not: null } },
      _sum: { amountHalalas: true },
    });
    // Loyalty: points outstanding (liability) — points are not money until funded / redeemed
    const loyalty = organizationId
      ? await this.prisma.$queryRaw<Array<{ remaining: bigint | null }>>(
          Prisma.sql`SELECT SUM(l."remaining") AS remaining FROM "RewardLot" l JOIN "RewardEntry" e ON e."id" = l."entryId" WHERE e."fundingOrganizationId" = ${organizationId}::uuid AND (l."expiresAt" IS NULL OR l."expiresAt" > now())`,
        )
      : await this.prisma.$queryRaw<Array<{ remaining: bigint | null }>>(
          Prisma.sql`SELECT SUM("remaining") AS remaining FROM "RewardLot" WHERE "expiresAt" IS NULL OR "expiresAt" > now()`,
        );
    const w = watch._sum;
    const watchFunded = w.fundedHalalas ?? 0;
    const flows = [
      {
        product: 'WATCH',
        measures: {
          fundingRecordedMinor: watchFunding._sum.amountHalalas ?? 0,
          fundedMinor: watchFunded,
          spentMinor: w.spentHalalas ?? 0,
          releasedMinor: w.unusedHalalas ?? 0,
          qualifiedViewsBilledMinor: watchBilled._sum.amountMinor ?? 0,
        },
        checks: [
          {
            check: 'FUNDING_RECORDS_MATCH_CAMPAIGN_BUDGETS',
            ok: (watchFunding._sum.amountHalalas ?? 0) === watchFunded,
          },
          {
            check: 'SPEND_WITHIN_FUNDING',
            ok: (w.spentHalalas ?? 0) + (w.unusedHalalas ?? 0) <= watchFunded,
          },
        ],
      },
      {
        product: 'EXCLUSIVE',
        measures: {
          caseUtilizedMinor: exclusiveUtil._sum.utilizedHalalas ?? 0,
          caseReceivedMinor: exclusiveUtil._sum.receivedHalalas ?? 0,
          redemptionsBilledMinor: exclusiveBilled._sum.amountMinor ?? 0,
        },
        checks: [
          {
            check: 'BILLED_REDEMPTIONS_WITHIN_UTILISATION',
            ok:
              (exclusiveBilled._sum.amountMinor ?? 0) <=
                (exclusiveUtil._sum.utilizedHalalas ?? 0) ||
              (exclusiveUtil._sum.utilizedHalalas ?? 0) === 0,
          },
        ],
      },
      {
        product: 'VOUCHER',
        measures: {
          commissionBilledMinor: voucherCommission._sum.amountMinor ?? 0,
          commissionRetainedMinor: voucherFees._sum.feeHalalas ?? 0,
          payableAccruedMinor: voucherFees._sum.amountHalalas ?? 0,
          payableSettledMinor: voucherSettled._sum.amountHalalas ?? 0,
        },
        checks: [
          {
            check: 'COMMISSION_BILLED_NOT_ABOVE_RETAINED',
            ok:
              (voucherCommission._sum.amountMinor ?? 0) <= (voucherFees._sum.feeHalalas ?? 0) ||
              (voucherFees._sum.feeHalalas ?? 0) === 0,
          },
        ],
      },
      {
        product: 'LOYALTY',
        measures: { pointsOutstanding: Number(loyalty[0]?.remaining ?? 0) },
        checks: [{ check: 'POINTS_LIABILITY_REPORTED', ok: true }],
      },
    ];
    return flows.map((f) => ({
      ...f,
      status: f.checks.every((c) => c.ok) ? 'MATCHED' : 'DIFFERENCE',
    }));
  }
}
