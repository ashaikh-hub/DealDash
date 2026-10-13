import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { AdminOrderDetail, FinanceOverview } from '@dealdash/validation';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { merchantDisplayName } from '../live-deals/deal-presenter.service';
import { LedgerService } from './ledger.service';
import { MerchantVouchersService } from './merchant-vouchers.service';
import { newRef, parseVoucherContent } from './voucher-content';
import { VoucherCoreService } from './voucher-core.service';
import { RefundsService } from './refunds.service';

const maskMobile = (m: string | null) => (m ? `${m.slice(0, 4)}•••${m.slice(-3)}` : null);

/**
 * Admin finance and support lookups for Stage 5: payment, order, voucher, refund and redemption lookup, merchant payable
 * status and the ledger health check. This is the MINIMUM workbench for Stage 5; settlement operations are Stage 8.
 * Support users see the same records with provider references hidden.
 */
@Injectable()
export class FinanceAdminService {
  constructor(
    private readonly core: VoucherCoreService,
    private readonly ledger: LedgerService,
    private readonly refunds: RefundsService,
    private readonly merchantVouchers: MerchantVouchersService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  /** Payments / refunds / ledger overview in ONE currency (default: the default market's), with the list of currencies in use. */
  async overview(currencyIn?: string): Promise<FinanceOverview> {
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [pending, open, failed, pay24, fail24, ref24, trial] = await Promise.all([
      this.prisma.voucherOrder.count({ where: { status: 'PENDING_PAYMENT' } }),
      this.prisma.refund.count({
        where: { status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING'] } },
      }),
      this.prisma.refund.count({ where: { status: 'FAILED' } }),
      this.prisma.payment.count({ where: { createdAt: { gte: dayAgo } } }),
      this.prisma.payment.count({ where: { createdAt: { gte: dayAgo }, status: 'FAILED' } }),
      this.prisma.refund.count({ where: { createdAt: { gte: dayAgo } } }),
      this.ledger.trialBalance(),
    ]);
    const currencies = (
      await this.prisma.ledgerAccount.findMany({
        distinct: ['currency'],
        select: { currency: true },
      })
    )
      .map((a) => a.currency)
      .sort();
    const fallback = (
      await this.core.markets.profile((await this.core.markets.settings()).defaultMarket)
    ).currency;
    const currency =
      currencyIn ?? (currencies.includes(fallback) ? fallback : (currencies[0] ?? fallback));
    const byOrg = async (family: Parameters<LedgerService['balancesByOrganization']>[0]) =>
      new Map(
        (await this.ledger.balancesByOrganization(family))
          .filter((r) => r.currency === currency)
          .map((r) => [r.organizationId, r.total]),
      );
    const [held, eligible, revenue, psp, expired] = await Promise.all([
      byOrg('MERCHANT_HELD'),
      byOrg('MERCHANT_SETTLEMENT_ELIGIBLE'),
      this.ledger.balance('PLATFORM_REVENUE', null, currency),
      this.ledger.balance('PSP_CLEARING', null, currency),
      byOrg('EXPIRED_VALUE'),
    ]);
    const sum = (m: Map<string | null, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    const orgIds = [
      ...new Set(
        [...held.keys(), ...eligible.keys(), ...expired.keys()].filter((x): x is string => !!x),
      ),
    ];
    const orgs = orgIds.length
      ? await this.prisma.organization.findMany({ where: { id: { in: orgIds } } })
      : [];
    const fees = orgIds.length
      ? await this.prisma.merchantPayableEvent.groupBy({
          by: ['organizationId', 'type'],
          where: {
            organizationId: { in: orgIds },
            currency,
            type: { in: ['REFUNDED', 'ELIGIBLE', 'REDEMPTION_REVERSED'] },
          },
          _sum: { amountHalalas: true, feeHalalas: true },
        })
      : [];
    const f = (org: string, t: string, k: 'amountHalalas' | 'feeHalalas') =>
      fees.find((x) => x.organizationId === org && x.type === t)?._sum[k] ?? 0;
    return {
      counts: {
        ordersPendingPayment: pending,
        refundsOpen: open,
        refundsFailed: failed,
        paymentsLast24h: pay24,
        failedLast24h: fail24,
        refundsLast24h: ref24,
      },
      currency,
      currencies: currencies.length ? currencies : [currency],
      ledger: {
        balanced: trial.balanced,
        journals: trial.journals,
        heldHalalas: -sum(held),
        settlementEligibleHalalas: -sum(eligible),
        platformRevenueHalalas: -revenue,
        pspClearingHalalas: psp,
        expiredValueHalalas: -sum(expired),
      },
      merchants: orgs
        .map((o) => ({
          merchant: { id: o.id, nameEn: o.nameEn, nameAr: o.nameAr },
          heldHalalas: -(held.get(o.id) ?? 0),
          settlementEligibleHalalas: -(eligible.get(o.id) ?? 0),
          platformFeeHalalas:
            f(o.id, 'ELIGIBLE', 'feeHalalas') - f(o.id, 'REDEMPTION_REVERSED', 'feeHalalas'),
          refundedHalalas: f(o.id, 'REFUNDED', 'amountHalalas'),
          expiredValueHalalas: -(expired.get(o.id) ?? 0),
        }))
        .sort((a, b) => b.heldHalalas - a.heldHalalas),
      disclaimerKey: 'legal_treatment_validate_ksa',
    };
  }

  /** Finds the order behind a reference: order, voucher, refund, redemption reference or a provider payment reference. */
  async search(q: string, limit: number) {
    const key = q.trim();
    const upper = key.toUpperCase();
    type Row = {
      kind: 'ORDER' | 'PAYMENT' | 'VOUCHER' | 'REFUND' | 'REDEMPTION';
      orderId: string;
      reference: string;
      status: string;
      amountHalalas: number;
      merchant: { en: string; ar: string };
      createdAt: string;
    };
    const rows: Row[] = [];
    const orderInclude = {
      voucher: { select: { organization: { include: { merchant: true } } } },
    } satisfies Prisma.VoucherOrderInclude;
    const add = (
      kind: Row['kind'],
      o: Prisma.VoucherOrderGetPayload<{ include: typeof orderInclude }>,
      reference: string,
      status: string,
    ) =>
      rows.push({
        kind,
        orderId: o.id,
        reference,
        status,
        amountHalalas: o.totalHalalas,
        merchant: merchantDisplayName(o.voucher.organization),
        createdAt: o.createdAt.toISOString(),
      });
    const orders = await this.prisma.voucherOrder.findMany({
      where: { reference: { startsWith: upper } },
      include: orderInclude,
      take: limit,
    });
    for (const o of orders) add('ORDER', o, o.reference, o.status);
    const pays = await this.prisma.payment.findMany({
      where: { providerReference: key },
      include: { order: { include: orderInclude } },
      take: limit,
    });
    for (const p of pays) add('PAYMENT', p.order, p.providerReference ?? key, p.status);
    const inst = await this.prisma.voucherInstance.findMany({
      where: { reference: { startsWith: upper } },
      include: { order: { include: orderInclude } },
      take: limit,
    });
    for (const i of inst) add('VOUCHER', i.order, i.reference, i.status);
    const refs = await this.prisma.refund.findMany({
      where: { reference: { startsWith: upper } },
      include: { order: { include: orderInclude } },
      take: limit,
    });
    for (const r of refs) add('REFUND', r.order, r.reference, r.status);
    const reds = await this.prisma.voucherRedemption.findMany({
      where: { reference: { startsWith: upper } },
      include: { instance: { include: { order: { include: orderInclude } } } },
      take: limit,
    });
    for (const r of reds) add('REDEMPTION', r.instance.order, r.reference, r.status);
    return rows.slice(0, limit);
  }

  async orderDetail(actor: Actor, orderId: string): Promise<AdminOrderDetail> {
    const o = await this.prisma.voucherOrder.findUnique({
      where: { id: orderId },
      include: {
        voucher: { include: { organization: { include: { merchant: true } } } },
        payments: {
          orderBy: { attemptNo: 'asc' },
          include: { events: { orderBy: { receivedAt: 'asc' } } },
        },
        instances: {
          include: { redemptions: { orderBy: { redeemedAt: 'desc' } } },
          orderBy: { seq: 'asc' },
        },
        refunds: {
          orderBy: { createdAt: 'desc' },
          include: {
            order: {
              include: { voucher: { include: { organization: { include: { merchant: true } } } } },
            },
            payment: true,
            instance: true,
          },
        },
      },
    });
    if (!o) throw AppError.notFound();
    const seeProvider = actor.permissions.has('admin.payments.read');
    const user = await this.prisma.user.findUnique({
      where: { id: o.userId },
      select: { id: true, displayName: true, mobile: true },
    });
    const inst = o.instances[0] ?? null;
    const red = inst?.redemptions[0] ?? null;
    const redBranch = red
      ? await this.prisma.merchantBranch.findUnique({ where: { id: red.branchId } })
      : null;
    const journalsRaw = await this.prisma.ledgerJournal.findMany({
      where: {
        OR: [
          { sourceType: 'Payment', sourceId: { in: o.payments.map((p) => p.id) } },
          { sourceType: 'Refund', sourceId: { in: o.refunds.map((r) => r.id) } },
          ...(red ? [{ sourceType: 'VoucherRedemption', sourceId: red.id }] : []),
          ...(inst ? [{ sourceType: 'VoucherInstance', sourceId: inst.id }] : []),
        ],
      },
      orderBy: { postedAt: 'asc' },
      include: { entries: { include: { account: true } } },
    });
    const events = await this.prisma.merchantPayableEvent.findMany({
      where: {
        OR: [
          ...(inst ? [{ instanceId: inst.id }] : []),
          { note: { contains: o.id } },
          { note: { contains: o.reference } },
          ...o.payments.map((p) => ({ note: { contains: p.id } })),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    const cases = await this.prisma.supportCase.findMany({
      where: { orderId: o.id },
      orderBy: { createdAt: 'desc' },
    });
    const title = parseVoucherContent(o.voucher.content).title;
    const canReverse =
      !!red && red.status === 'REDEEMED' && actor.permissions.has('admin.refunds.manage');
    return {
      order: {
        id: o.id,
        reference: o.reference,
        status: o.status,
        totalHalalas: o.totalHalalas,
        quantity: o.quantity,
        createdAt: o.createdAt.toISOString(),
        paidAt: o.paidAt ? o.paidAt.toISOString() : null,
        termsVersion: o.termsVersion,
        termsAcceptedAt: o.termsAcceptedAt ? o.termsAcceptedAt.toISOString() : null,
        customer: {
          userId: o.userId,
          displayName: user?.displayName.split(' ')[0] ?? '',
          mobileMasked: maskMobile(user?.mobile ?? null),
        },
        voucher: {
          id: o.voucherId,
          title,
          merchant: merchantDisplayName(o.voucher.organization),
          merchantId: o.organizationId,
        },
      },
      payments: o.payments.map((p) => ({
        id: p.id,
        status: p.status,
        amountHalalas: p.amountHalalas,
        attemptNo: p.attemptNo,
        providerReference: seeProvider ? p.providerReference : null,
        failureCode: p.failureCode,
        createdAt: p.createdAt.toISOString(),
        completedAt: p.completedAt ? p.completedAt.toISOString() : null,
      })),
      events: o.payments.flatMap((p) =>
        p.events.map((e) => ({
          id: e.id,
          kind: e.kind,
          status: e.status,
          outcome: e.outcome,
          signatureVerified: e.signatureVerified,
          receivedAt: e.receivedAt.toISOString(),
          note: e.note,
        })),
      ),
      instance: inst
        ? {
            id: inst.id,
            reference: inst.reference,
            status: inst.status,
            expiresAt: inst.expiresAt.toISOString(),
            redeemedAt: inst.redeemedAt ? inst.redeemedAt.toISOString() : null,
            redemption: red
              ? {
                  id: red.id,
                  reference: red.reference,
                  status: red.status,
                  redeemedAt: red.redeemedAt.toISOString(),
                  branch: redBranch
                    ? { en: redBranch.nameEn, ar: redBranch.nameAr }
                    : { en: '', ar: '' },
                  reversedAt: red.reversedAt ? red.reversedAt.toISOString() : null,
                  reverseReason: red.reverseReason,
                }
              : null,
          }
        : null,
      refunds: await Promise.all(o.refunds.map((r) => this.refunds.adminRow(r, actor))),
      journals: journalsRaw.map((j) => ({
        id: j.id,
        type: j.type,
        postedAt: j.postedAt.toISOString(),
        memo: j.memo,
        entries: j.entries.map((e) => ({
          account: `${e.account.family}${e.account.organizationId ? '' : ''}`,
          amountHalalas: e.amountHalalas,
          // entry memos can carry the provider's transaction reference: hidden from Support
          memo: seeProvider ? e.memo : null,
        })),
      })),
      payableEvents: events.map((e) => ({
        id: e.id,
        type: e.type,
        amountHalalas: e.amountHalalas,
        feeHalalas: e.feeHalalas,
        instanceReference: inst?.reference ?? null,
        voucherTitle: title,
        createdAt: e.createdAt.toISOString(),
        note: e.note,
      })),
      cases: cases.map((c) => ({
        id: c.id,
        reference: c.reference,
        type: c.type,
        status: c.status,
        subject: c.subject,
        createdAt: c.createdAt.toISOString(),
      })),
      canSeeProviderData: seeProvider,
      canReverseRedemption: canReverse,
      canCreateRefund:
        actor.permissions.has('admin.refunds.manage') && !!inst && inst.status === 'ACTIVE',
    };
  }

  async merchantPayable(orgId: string) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, type: 'MERCHANT' },
    });
    if (!org) throw AppError.notFound();
    return this.merchantVouchers.payableOf(orgId);
  }

  async merchantPayableEvents(orgId: string, q: { limit: number; cursor?: string }) {
    const org = await this.prisma.organization.findFirst({
      where: { id: orgId, type: 'MERCHANT' },
    });
    if (!org) throw AppError.notFound();
    return this.merchantVouchers.payableEventsOf(orgId, q);
  }

  /**
   * Manual adjustment (LG-06): a reasoned, audited, append-only journal against the merchant's settlement-eligible balance.
   * Maker-checker thresholds and the settlement link arrive with Stage 8; the structure is here.
   */
  async adjust(
    actor: Actor,
    input: { organizationId: string; amountHalalas: number; reason: string; currency?: string },
    meta: RequestMeta,
  ) {
    const org = await this.prisma.organization.findFirst({
      where: { id: input.organizationId, type: 'MERCHANT' },
    });
    if (!org) throw AppError.notFound();
    // an adjustment is in the merchant's market currency unless the request names one (never converted)
    const currency =
      input.currency ?? (await this.core.markets.profileOfOrganization(org.id)).currency;
    const id = newRef('ADJ');
    return this.prisma.$transaction(async (tx) => {
      const j = await this.ledger.post(tx, {
        type: 'ADJUSTMENT',
        sourceType: 'Adjustment',
        sourceId: org.id,
        idempotencyKey: `adjustment:${org.id}:${id}:${Date.now()}`,
        memo: `Adjustment ${id}: ${input.reason}`,
        reasonCode: 'MANUAL_ADJUSTMENT',
        currency,
        actor: { userId: actor.userId, role: actor.membership?.roleCode ?? null },
        lines: [
          {
            family: 'MERCHANT_SETTLEMENT_ELIGIBLE',
            organizationId: org.id,
            amountHalalas: -input.amountHalalas,
          },
          { family: 'ADJUSTMENTS', amountHalalas: input.amountHalalas },
        ],
      });
      await tx.merchantPayableEvent.create({
        data: {
          organizationId: org.id,
          type: 'ADJUSTMENT',
          amountHalalas: input.amountHalalas,
          currency,
          journalId: j.journalId,
          note: input.reason,
        },
      });
      await this.core.audit.record(
        {
          action: 'ledger.adjustment',
          entityType: 'LedgerJournal',
          entityId: j.journalId,
          actor,
          reason: input.reason,
          subjectOrganizationId: org.id,
          newState: { amountHalalas: input.amountHalalas },
          meta,
        },
        tx,
      );
      return { journalId: j.journalId, reference: id };
    });
  }
}
