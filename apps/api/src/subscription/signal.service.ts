import { Injectable } from '@nestjs/common';
import type { CommercialSignalType } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * The commercial signal outbox. Phase 4 turns these into alerts; this is deliberately NOT an alert engine (no channels, no
 * recipients, no escalation): it records that something commercially relevant happened, once per threshold and period.
 */
@Injectable()
export class SignalService {
  constructor(private readonly prisma: PrismaService) {}

  async raise(
    s: {
      type: CommercialSignalType;
      dedupeKey: string;
      organizationId: string;
      legalEntityId?: string | null;
      contractId?: string | null;
      metricKey?: string | null;
      payload?: Record<string, unknown>;
    },
    db: Db = this.prisma,
  ): Promise<boolean> {
    try {
      await db.commercialSignal.create({
        data: {
          dedupeKey: s.dedupeKey,
          type: s.type,
          organizationId: s.organizationId,
          legalEntityId: s.legalEntityId ?? null,
          contractId: s.contractId ?? null,
          metricKey: s.metricKey ?? null,
          payload: (s.payload ?? {}) as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return false;
      throw e;
    }
  }

  list(filter: { organizationId?: string; type?: string; unconsumed?: boolean; limit?: number }) {
    return this.prisma.commercialSignal.findMany({
      where: {
        ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.unconsumed ? { consumedAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.limit ?? 100, 500),
    });
  }

  /** Phase 4 marks the signals it has turned into alerts. */
  async markConsumed(ids: string[]) {
    return (
      await this.prisma.commercialSignal.updateMany({
        where: { id: { in: ids }, consumedAt: null },
        data: { consumedAt: new Date() },
      })
    ).count;
  }
}
