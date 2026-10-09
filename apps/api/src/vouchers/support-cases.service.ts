import { Injectable } from '@nestjs/common';
import type { SupportCaseStatus, SupportCaseType } from '@dealdash/types';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { newRef } from './voucher-content';
import { VoucherCoreService } from './voucher-core.service';

/**
 * Minimal support cases linked to commerce objects (voucher, order, payment, refund, redemption). A case stores the customer's
 * words and links only: no payment detail is copied onto it, and the admin view hides provider data from Support.
 */
@Injectable()
export class SupportCasesService {
  constructor(private readonly core: VoucherCoreService) {}

  private get prisma() {
    return this.core.prisma;
  }

  async create(
    actor: Actor,
    input: {
      type: SupportCaseType;
      subject: string;
      body: string;
      voucherInstanceId?: string;
      orderId?: string;
    },
    meta: RequestMeta,
  ) {
    let orderId = input.orderId ?? null;
    const instanceId = input.voucherInstanceId ?? null;
    let redemptionId: string | null = null;
    if (instanceId) {
      const inst = await this.prisma.voucherInstance.findFirst({
        where: { id: instanceId, ownerUserId: actor.userId },
        include: { redemptions: { orderBy: { redeemedAt: 'desc' }, take: 1 } },
      });
      if (!inst) throw AppError.notFound();
      orderId = inst.orderId;
      redemptionId = inst.redemptions[0]?.id ?? null;
    }
    let paymentId: string | null = null;
    let refundId: string | null = null;
    if (orderId) {
      const order = await this.prisma.voucherOrder.findFirst({
        where: { id: orderId, userId: actor.userId },
        include: {
          payments: { orderBy: { createdAt: 'desc' }, take: 1 },
          refunds: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      if (!order) throw AppError.notFound();
      paymentId = order.payments[0]?.id ?? null;
      refundId = order.refunds[0]?.id ?? null;
    }
    const open = await this.prisma.supportCase.count({
      where: { userId: actor.userId, status: { not: 'RESOLVED' } },
    });
    if (open >= 5)
      throw AppError.rateLimited(
        'RATE_LIMITED',
        'You already have several open requests. Please wait for a reply.',
      );
    const row = await this.prisma.$transaction(async (tx) => {
      const c = await tx.supportCase.create({
        data: {
          reference: newRef('SC'),
          userId: actor.userId,
          type: input.type,
          subject: input.subject,
          body: input.body,
          voucherInstanceId: instanceId,
          orderId,
          paymentId,
          refundId,
          redemptionId,
        },
      });
      await this.core.audit.record(
        {
          action: 'support_case.create',
          entityType: 'SupportCase',
          entityId: c.id,
          actor,
          newState: { type: input.type, orderId, voucherInstanceId: instanceId },
          meta,
        },
        tx,
      );
      return c;
    });
    return {
      id: row.id,
      reference: row.reference,
      type: row.type,
      status: row.status,
      subject: row.subject,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listAdmin(q: { limit: number; status?: SupportCaseStatus }) {
    const rows = await this.prisma.supportCase.findMany({
      where: q.status ? { status: q.status } : {},
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
      select: { id: true, displayName: true, customer: { select: { firstName: true } } },
    });
    const orders = await this.prisma.voucherOrder.findMany({
      where: { id: { in: rows.map((r) => r.orderId).filter((x): x is string => !!x) } },
      select: { id: true, reference: true },
    });
    const insts = await this.prisma.voucherInstance.findMany({
      where: { id: { in: rows.map((r) => r.voucherInstanceId).filter((x): x is string => !!x) } },
      select: { id: true, reference: true },
    });
    return rows.map((c) => {
      const u = users.find((x) => x.id === c.userId);
      return {
        id: c.id,
        reference: c.reference,
        type: c.type,
        status: c.status,
        subject: c.subject,
        createdAt: c.createdAt.toISOString(),
        customerFirstName: u?.customer?.firstName || u?.displayName.split(' ')[0] || null,
        body: c.body,
        orderReference: orders.find((o) => o.id === c.orderId)?.reference ?? null,
        voucherReference: insts.find((i) => i.id === c.voucherInstanceId)?.reference ?? null,
        note: c.resolutionNote,
      };
    });
  }

  async update(
    actor: Actor,
    id: string,
    input: { status: SupportCaseStatus; note?: string },
    meta: RequestMeta,
  ) {
    const c = await this.prisma.supportCase.findUnique({ where: { id } });
    if (!c) throw AppError.notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.supportCase.update({
        where: { id },
        data: {
          status: input.status,
          resolutionNote: input.note ?? c.resolutionNote,
          handledByUserId: actor.userId,
        },
      });
      await this.core.audit.record(
        {
          action: 'support_case.update',
          entityType: 'SupportCase',
          entityId: id,
          actor,
          reason: input.note ?? null,
          previousState: { status: c.status },
          newState: { status: input.status },
          meta,
        },
        tx,
      );
    });
    return (await this.listAdmin({ limit: 100 })).find((x) => x.id === id)!;
  }
}
