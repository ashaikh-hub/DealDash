import { Injectable } from '@nestjs/common';
import type { DataRequestType } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { opsConfig, ref } from './ops-util';

type Row = Prisma.DataRequestGetPayload<object>;

/**
 * Customer data requests (privacy, Stage 8): EXPORT (a copy of the customer's data) and DELETION (personal data anonymised; the
 * financial, audit and legal records the law requires are retained and only reference an anonymous account). Retention periods,
 * response deadlines and lawful exceptions are VALIDATE-<market> (VK-11 / VK-15): nothing here decides them. A request is approved
 * by a different person (configuration), and a deletion is refused while the customer still holds rights or open matters
 * (active vouchers, held reservations, open refunds or cases) so nothing they are owed is lost.
 */
@Injectable()
export class DataRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
  ) {}

  view(r: Row, forCustomer = false) {
    return {
      id: r.id,
      reference: r.reference,
      type: r.type,
      status: r.status,
      customerUserId: forCustomer ? undefined : r.customerUserId,
      requestedVia: r.requestedVia,
      reason: forCustomer ? undefined : r.reason,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionReason: r.decisionReason,
      completedAt: r.completedAt?.toISOString() ?? null,
      result: r.status === 'COMPLETED' ? r.result : null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async list(f: { status?: string; customerUserId?: string }) {
    const rows = await this.prisma.dataRequest.findMany({
      where: {
        ...(f.status ? { status: f.status } : {}),
        ...(f.customerUserId ? { customerUserId: f.customerUserId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.view(r));
  }

  async mine(userId: string) {
    const rows = await this.prisma.dataRequest.findMany({
      where: { customerUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => this.view(r, true));
  }

  // ---------------------------------------------------------------- Stage 9: legal holds (when one is required is VALIDATE-<market>)
  async legalHolds(subjectId?: string) {
    const rows = await this.prisma.legalHold.findMany({
      where: subjectId ? { subjectId } : { liftedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((h) => ({
      id: h.id,
      reference: h.reference,
      subjectType: h.subjectType,
      subjectId: h.subjectId,
      reason: h.reason,
      caseId: h.caseId,
      active: !h.liftedAt,
      placedByUserId: h.placedByUserId,
      liftedAt: h.liftedAt?.toISOString() ?? null,
      liftReason: h.liftReason,
      createdAt: h.createdAt.toISOString(),
    }));
  }

  async placeHold(
    actor: Actor,
    b: {
      subjectType: 'USER' | 'ORGANIZATION';
      subjectId: string;
      reason: string;
      caseId?: string | null;
    },
    meta: RequestMeta,
  ) {
    const h = await this.prisma.$transaction(async (tx) => {
      const row = await tx.legalHold.create({
        data: {
          reference: ref('LH'),
          subjectType: b.subjectType,
          subjectId: b.subjectId,
          reason: b.reason,
          caseId: b.caseId ?? null,
          placedByUserId: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'LEGAL_HOLD_PLACED',
          entityType: 'LegalHold',
          entityId: row.id,
          actor,
          reason: b.reason,
          newState: { subjectType: b.subjectType, subjectId: b.subjectId },
          meta,
        },
        tx,
      );
      return row;
    });
    return (await this.legalHolds(h.subjectId)).find((x) => x.id === h.id)!;
  }

  /** Lifting a hold is a second person's decision (the one who placed it cannot lift it). */
  async liftHold(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    const h = await this.prisma.legalHold.findUnique({ where: { id } });
    if (!h || h.liftedAt) throw AppError.notFound();
    if (h.placedByUserId === actor.userId)
      throw new AppError('CHECKER_REQUIRED', 'A different person must lift this legal hold', 403);
    await this.prisma.$transaction(async (tx) => {
      await tx.legalHold.update({
        where: { id },
        data: { liftedAt: new Date(), liftedByUserId: actor.userId, liftReason: reason },
      });
      await this.audit.record(
        { action: 'LEGAL_HOLD_LIFTED', entityType: 'LegalHold', entityId: id, actor, reason, meta },
        tx,
      );
    });
    return (await this.legalHolds(h.subjectId)).find((x) => x.id === id)!;
  }

  /** What would stop a deletion now (the customer's rights and open matters). */
  async blockers(userId: string) {
    const [vouchers, reservations, refunds, cases, holds] = await Promise.all([
      this.prisma.voucherInstance.count({
        where: { ownerUserId: userId, status: { in: ['ACTIVE', 'VOIDED'] } },
      }),
      this.prisma.reservation.count({ where: { userId, status: 'HELD' } }),
      this.prisma.refund.count({
        where: {
          order: { userId },
          status: { in: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'FAILED'] },
        },
      }),
      this.prisma.disputeCase.count({
        where: { customerUserId: userId, status: { notIn: ['RESOLVED', 'CLOSED', 'REJECTED'] } },
      }),
      // Stage 9: a legal hold in force stops deletion / anonymisation
      this.prisma.legalHold.count({
        where: { subjectType: 'USER', subjectId: userId, liftedAt: null },
      }),
    ]);
    const out: string[] = [];
    if (holds) out.push(`LEGAL_HOLD:${holds}`);
    if (vouchers) out.push(`ACTIVE_VOUCHERS:${vouchers}`);
    if (reservations) out.push(`HELD_RESERVATIONS:${reservations}`);
    if (refunds) out.push(`OPEN_REFUNDS:${refunds}`);
    if (cases) out.push(`OPEN_CASES:${cases}`);
    return out;
  }

  async create(
    actor: Actor,
    b: { customerUserId: string; type: DataRequestType; reason?: string | null },
    via: 'CUSTOMER' | 'SUPPORT',
    meta: RequestMeta,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: b.customerUserId, userType: 'CUSTOMER' },
      include: { customer: true },
    });
    if (!user) throw AppError.notFound();
    if (user.status === 'CLOSED')
      throw new AppError('INVALID_STATE', 'This account is already closed', 409);
    if (
      await this.prisma.dataRequest.count({
        where: {
          customerUserId: b.customerUserId,
          type: b.type,
          status: { in: ['REQUESTED', 'PENDING_APPROVAL'] },
        },
      })
    )
      throw new AppError('INVALID_STATE', 'A request of this kind is already in progress', 409);
    const cfg = await opsConfig(this.config);
    const needs = cfg.approvals.dataRequests !== 'NEVER';
    const r = await this.prisma.$transaction(async (tx) => {
      const row = await tx.dataRequest.create({
        data: {
          reference: ref('DSR'),
          type: b.type,
          status: needs ? 'PENDING_APPROVAL' : 'REQUESTED',
          customerUserId: b.customerUserId,
          requestedByUserId: actor.userId,
          requestedVia: via,
          reason: b.reason ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'DATA_REQUEST_CREATED',
          entityType: 'DataRequest',
          entityId: row.id,
          actor,
          reason: b.reason ?? null,
          newState: { type: b.type, via, requiresApproval: needs },
          meta,
        },
        tx,
      );
      return row;
    });
    if (!needs) return this.view(await this.execute(actor, r.id, meta), via === 'CUSTOMER');
    return this.view(r, via === 'CUSTOMER');
  }

  /** A different person approves (then it runs) or rejects with a reason. */
  async decide(actor: Actor, id: string, approve: boolean, reason: string, meta: RequestMeta) {
    const r = await this.prisma.dataRequest.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    if (r.status !== 'PENDING_APPROVAL')
      throw new AppError('INVALID_STATE', 'This request was already decided', 409);
    if (r.requestedByUserId === actor.userId)
      throw new AppError('CHECKER_REQUIRED', 'A different person must approve this request', 403);
    if (approve && r.type === 'DELETION') {
      const b = await this.blockers(r.customerUserId);
      if (b.length)
        throw new AppError(
          'INVALID_STATE',
          `The customer still has rights or open matters: ${b.join(', ')}`,
          409,
        );
    }
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.dataRequest.updateMany({
        where: { id, status: 'PENDING_APPROVAL' },
        data: {
          status: approve ? 'REQUESTED' : 'REJECTED',
          decidedByUserId: actor.userId,
          decidedAt: new Date(),
          decisionReason: reason,
        },
      });
      if (u.count !== 1)
        throw new AppError('VERSION_CONFLICT', 'The request changed. Reload and try again.', 409);
      await this.audit.record(
        {
          action: approve ? 'DATA_REQUEST_APPROVED' : 'DATA_REQUEST_REJECTED',
          entityType: 'DataRequest',
          entityId: id,
          actor,
          reason,
          approvalRef: r.requestedByUserId,
          meta,
        },
        tx,
      );
    });
    if (approve) return this.view(await this.execute(actor, id, meta));
    return this.view(await this.prisma.dataRequest.findUniqueOrThrow({ where: { id } }));
  }

  private async execute(actor: Actor, id: string, meta: RequestMeta) {
    const r = await this.prisma.dataRequest.findUniqueOrThrow({ where: { id } });
    const userId = r.customerUserId;
    let result: Record<string, unknown>;
    if (r.type === 'EXPORT') {
      const [user, orders, vouchers, reservations, points, reviews, cases] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            displayName: true,
            email: true,
            mobile: true,
            locale: true,
            createdAt: true,
            customer: { select: { firstName: true, lastName: true, email: true, city: true } },
          },
        }),
        this.prisma.voucherOrder.findMany({
          where: { userId },
          select: {
            reference: true,
            totalHalalas: true,
            currency: true,
            status: true,
            createdAt: true,
          },
        }),
        this.prisma.voucherInstance.findMany({
          where: { ownerUserId: userId },
          select: { reference: true, status: true, issuedAt: true, expiresAt: true },
        }),
        this.prisma.reservation.findMany({
          where: { userId },
          select: { reference: true, status: true, createdAt: true },
        }),
        this.prisma.rewardAccount.findUnique({
          where: { userId },
          select: { availableBalance: true, heldBalance: true, lifetimeEarned: true },
        }),
        this.prisma.review.findMany({
          where: { customerUserId: userId },
          select: { rating: true, text: true, status: true, createdAt: true },
        }),
        this.prisma.disputeCase.findMany({
          where: { customerUserId: userId },
          select: { reference: true, type: true, status: true, createdAt: true },
        }),
      ]);
      result = {
        format: 'JSON',
        generatedAt: new Date().toISOString(),
        profile: user,
        orders,
        vouchers,
        reservations,
        points,
        reviews,
        cases,
      };
    } else {
      const b = await this.blockers(userId);
      if (b.length)
        throw new AppError(
          'INVALID_STATE',
          `The customer still has rights or open matters: ${b.join(', ')}`,
          409,
        );
      const anon = `deleted-${r.reference.toLowerCase()}`;
      await this.prisma.$transaction(async (tx) => {
        // an account keeps one contact field by rule: a non-personal placeholder that can never receive anything
        await tx.user.update({
          where: { id: userId },
          data: {
            status: 'CLOSED',
            displayName: 'Deleted customer',
            email: `${anon}@deleted.invalid`,
            mobile: null,
            passwordHash: null,
            mfaSecretEnc: null,
          },
        });
        await tx.customer.updateMany({
          where: { userId },
          data: { firstName: null, lastName: null, email: null, city: null },
        });
        await tx.userSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.eligibilityAttribute.deleteMany({ where: { userId } });
        await tx.notificationPreference.deleteMany({ where: { userId } });
        await tx.deviceLink.deleteMany({ where: { userId } });
        await tx.review.updateMany({
          where: { customerUserId: userId, status: { not: 'REMOVED' } },
          data: { status: 'REMOVED', moderationReason: 'ACCOUNT_DELETED' },
        });
      });
      // financial records (orders, payments, refunds, ledger), audit and case history are kept and point to the anonymous account
      result = {
        anonymisedAs: anon,
        retained: ['ORDERS', 'PAYMENTS', 'REFUNDS', 'LEDGER', 'AUDIT', 'CASES'],
        retentionBasis: 'VALIDATE-MARKET (VK-11 / VK-15)',
      };
    }
    await this.prisma.dataRequest.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        result: result as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      action: r.type === 'EXPORT' ? 'DATA_EXPORTED' : 'CUSTOMER_DATA_DELETED',
      entityType: 'DataRequest',
      entityId: id,
      actor,
      newState: r.type === 'EXPORT' ? { sections: Object.keys(result).length } : result,
      meta,
    });
    return this.prisma.dataRequest.findUniqueOrThrow({ where: { id } });
  }
}
