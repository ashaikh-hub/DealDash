import { Injectable } from '@nestjs/common';
import { BILLING_EVENT_TYPES, IN_FORCE_LIFECYCLE, type BillingEventType } from '@dealdash/types';
import { AppError } from '../common/errors';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface BillingEventInput {
  idempotencyKey: string;
  organizationId: string;
  eventType: BillingEventType;
  contractId?: string | null;
  legalEntityId?: string | null;
  product?: string | null;
  feature?: string | null;
  campaignId?: string | null;
  sourceEventId?: string | null;
  pricingVersionKey?: string | null;
  quantity?: number;
  unit?: string;
  unitRateMinor?: number | null;
  amountMinor?: number | null;
  currency?: string;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * The standard commercial billing event (the hook Phase 5 consumes for invoices and receivables). It records WHAT happened, WHO is billed,
 * under WHICH contract and pricing version, and the amount where it is already resolved. It posts nothing to the ledger.
 *
 * Idempotent: the same qualified view, redemption or renewal can never create a second event. Only revenue classifications exist here:
 * customer points funding, merchant reward commitments, sponsor funding, loyalty funding and customer subsidies are not DealDash
 * revenue and have no event type.
 */
@Injectable()
export class BillingEventService {
  constructor(private readonly prisma: PrismaService) {}

  /** Who is billed: the contract's billing legal entity, else the contracting entity, else the organization's first legal entity. */
  async billingParty(
    db: Db,
    organizationId: string,
    contract?: { billingLegalEntityId: string | null; legalEntityId: string | null } | null,
  ): Promise<string | null> {
    const direct = contract?.billingLegalEntityId ?? contract?.legalEntityId ?? null;
    if (direct) return direct;
    const first = await db.legalEntity.findFirst({
      where: { organizationId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return first?.id ?? null;
  }

  async emit(
    input: BillingEventInput,
    db: Db = this.prisma,
  ): Promise<{ id: string; created: boolean }> {
    const category = BILLING_EVENT_TYPES[input.eventType];
    if (!category)
      throw AppError.validation(`Unknown billing event type "${input.eventType}"`, 'eventType');
    const existing = await db.commercialBillingEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
    const at = input.occurredAt ?? new Date();
    const contract = input.contractId
      ? await db.contract.findUnique({ where: { id: input.contractId } })
      : await db.contract.findFirst({
          where: {
            organizationId: input.organizationId,
            status: { in: [...IN_FORCE_LIFECYCLE] },
            effectiveFrom: { lte: at },
            OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: at } }],
          },
          orderBy: { effectiveFrom: 'desc' },
        });
    const legalEntityId = input.legalEntityId ?? contract?.legalEntityId ?? null;
    const billingLegalEntityId = await this.billingParty(db, input.organizationId, contract);
    const le = billingLegalEntityId
      ? await db.legalEntity.findUnique({
          where: { id: billingLegalEntityId },
          select: { currency: true, country: true },
        })
      : null;
    const currency = input.currency ?? contract?.currency ?? le?.currency ?? 'SAR';
    const account = await db.businessAccount.findFirst({
      where: { organizationId: input.organizationId, currency },
      select: { id: true },
    });
    try {
      const row = await db.commercialBillingEvent.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          organizationId: input.organizationId,
          businessAccountId: account?.id ?? null,
          legalEntityId,
          billingLegalEntityId,
          contractId: contract?.id ?? null,
          planCode: contract?.planCode ?? null,
          planVersionId: contract?.planVersionId ?? null,
          product: input.product ?? null,
          feature: input.feature ?? null,
          campaignId: input.campaignId ?? null,
          sourceEventId: input.sourceEventId ?? null,
          pricingVersionKey: input.pricingVersionKey ?? contract?.pricingVersionKey ?? null,
          quantity: input.quantity ?? 1,
          unit: input.unit ?? 'EACH',
          unitRateMinor: input.unitRateMinor ?? null,
          amountMinor: input.amountMinor ?? null,
          currency,
          // the billed party's market: its tax, invoice and currency rules apply
          market: le?.country ?? contract?.market ?? null,
          occurredAt: at,
          billingCategory: category,
          eventType: input.eventType,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return { id: row.id, created: true };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const again = await db.commercialBillingEvent.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
          select: { id: true },
        });
        return { id: again.id, created: false };
      }
      throw e;
    }
  }

  list(filter: {
    organizationId?: string;
    eventType?: string;
    status?: string;
    contractId?: string;
    limit?: number;
  }) {
    return this.prisma.commercialBillingEvent.findMany({
      where: {
        ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        ...(filter.eventType ? { eventType: filter.eventType } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.contractId ? { contractId: filter.contractId } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(filter.limit ?? 100, 500),
    });
  }

  /**
   * A reversed source event (a fraud-reversed view, a reversed redemption) voids its billing event while it is still PENDING. An event Phase 5 has
   * already consumed is not touched here: Phase 5 corrects it with a credit note.
   */
  async voidBySource(
    eventType: BillingEventType,
    sourceEventId: string,
    db: Db = this.prisma,
  ): Promise<number> {
    return (
      await db.commercialBillingEvent.updateMany({
        where: { eventType, sourceEventId, status: 'PENDING' },
        data: { status: 'VOID' },
      })
    ).count;
  }

  /** The only change a billing event ever sees: Phase 5 marks it processed. */
  async markConsumed(ids: string[]) {
    const r = await this.prisma.commercialBillingEvent.updateMany({
      where: { id: { in: ids }, status: 'PENDING' },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });
    return r.count;
  }
}
