import { Injectable } from '@nestjs/common';
import type { RestrictionKind } from '@dealdash/types';
import { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import type { Actor, RequestMeta } from '../common/request-context';
import { FinanceAdminService as CommercialFinanceAdmin } from '../finance/finance-admin.service';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AlertsService } from '../visibility/alerts.service';
import { D, opsConfig, ref } from './ops-util';

/** The subject each kind applies to, and the scopes it may restrict. */
const KIND: Record<
  RestrictionKind,
  { subject: 'USER' | 'ORGANIZATION' | 'BRANCH' | 'CONNECTION'; scopes: string[] }
> = {
  CUSTOMER_RESTRICTION: {
    subject: 'USER',
    scopes: ['NEW_RESERVATIONS', 'NEW_PURCHASES', 'NEW_VIEWS'],
  },
  MERCHANT_CAMPAIGN_HOLD: { subject: 'ORGANIZATION', scopes: ['NEW_EXPOSURE'] },
  BRANCH_REDEMPTION_HOLD: { subject: 'BRANCH', scopes: ['REDEMPTION'] },
  USER_SUSPENSION: { subject: 'USER', scopes: ['SIGN_IN'] },
  INTEGRATION_SUSPENSION: { subject: 'CONNECTION', scopes: ['API'] },
  FINANCIAL_HOLD: { subject: 'ORGANIZATION', scopes: ['PAYOUT', 'NEW_PAID_CAMPAIGN'] },
};

type Row = Prisma.OperationalRestrictionGetPayload<object>;

/**
 * Governed restrictions and holds (Stage 8). A request records the reason, scope and period; where configuration says so
 * (`operations.approvals.restrictions`) a DIFFERENT person approves it before it takes effect. It is applied through the existing
 * enforcement point of its kind (the reservation restriction, the merchant exposure gate, staff redemption, user status and
 * sessions, the integration connection, the financial hold) and lifted or expired the same way. A restriction stops NEW actions:
 * it never invalidates a customer's issued voucher, held reservation or earned reward. The subject is told where configured.
 */
@Injectable()
export class RestrictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: SystemConfigService,
    private readonly markets: MarketService,
    private readonly finance: CommercialFinanceAdmin,
    private readonly alerts: AlertsService,
  ) {}

  view(r: Row, actor?: Actor) {
    return {
      id: r.id,
      reference: r.reference,
      kind: r.kind,
      status: r.status,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      organizationId: r.organizationId,
      branchId: r.branchId,
      market: r.market,
      scope: r.scope,
      reasonCode: r.reasonCode,
      reason: r.reason,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      requiresApproval: r.requiresApproval,
      requestedByUserId: r.requestedByUserId,
      decidedByUserId: r.decidedByUserId,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionReason: r.decisionReason,
      liftedAt: r.liftedAt?.toISOString() ?? null,
      liftReason: r.liftReason,
      caseId: r.caseId,
      riskFlagId: r.riskFlagId,
      createdAt: r.createdAt.toISOString(),
      canDecide:
        !!actor &&
        r.status === 'PENDING_APPROVAL' &&
        r.requestedByUserId !== actor.userId &&
        actor.permissions.has('admin.restrictions.approve'),
    };
  }

  async list(
    f: { status?: string; kind?: string; subjectId?: string; organizationId?: string },
    actor: Actor,
  ) {
    const rows = await this.prisma.operationalRestriction.findMany({
      where: {
        ...(f.status ? { status: f.status } : {}),
        ...(f.kind ? { kind: f.kind } : {}),
        ...(f.subjectId ? { subjectId: f.subjectId } : {}),
        ...(f.organizationId ? { organizationId: f.organizationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.view(r, actor));
  }

  /** Validates the subject of a kind; returns its organization, branch and market. */
  private async subject(kind: RestrictionKind, subjectId: string, actor: Actor) {
    const k = KIND[kind];
    if (k.subject === 'USER') {
      const u = await this.prisma.user.findUnique({
        where: { id: subjectId },
        include: { memberships: { where: { status: 'ACTIVE' }, include: { organization: true } } },
      });
      if (!u) throw AppError.validation('The user was not found', 'subjectId');
      if (kind === 'CUSTOMER_RESTRICTION' && u.userType !== 'CUSTOMER')
        throw AppError.validation('A customer restriction is for a customer', 'subjectId');
      if (u.id === actor.userId)
        throw AppError.validation('You cannot restrict your own account', 'subjectId');
      if (
        kind === 'USER_SUSPENSION' &&
        u.memberships.some((m) => m.organization.type === 'DEALDASH')
      )
        throw AppError.validation(
          'DealDash staff accounts are suspended through user management',
          'subjectId',
        );
      const org = u.memberships[0]?.organizationId ?? null;
      return {
        organizationId: org,
        branchId: null,
        market: org ? await this.markets.resolveMarket(org).catch(() => null) : null,
      };
    }
    if (k.subject === 'ORGANIZATION') {
      const o = await this.prisma.organization.findUnique({ where: { id: subjectId } });
      if (!o || (o.type !== 'MERCHANT' && o.type !== 'PARTNER'))
        throw AppError.validation('Choose a merchant or partner', 'subjectId');
      if (kind === 'MERCHANT_CAMPAIGN_HOLD' && o.type !== 'MERCHANT')
        throw AppError.validation('A campaign hold is for a merchant', 'subjectId');
      return {
        organizationId: o.id,
        branchId: null,
        market: await this.markets.resolveMarket(o.id).catch(() => null),
      };
    }
    if (k.subject === 'BRANCH') {
      const b = await this.prisma.merchantBranch.findUnique({ where: { id: subjectId } });
      if (!b) throw AppError.validation('The branch was not found', 'subjectId');
      return { organizationId: b.organizationId, branchId: b.id, market: b.country };
    }
    const c = await this.prisma.integrationConnection.findUnique({ where: { id: subjectId } });
    if (!c) throw AppError.validation('The connection was not found', 'subjectId');
    return {
      organizationId: c.organizationId,
      branchId: null,
      market: c.organizationId
        ? await this.markets.resolveMarket(c.organizationId).catch(() => null)
        : null,
    };
  }

  /** Maker: request a restriction or hold. Applied at once only where configuration says no second person is needed. */
  async request(
    actor: Actor,
    b: {
      kind: RestrictionKind;
      subjectId: string;
      scope?: string[];
      reasonCode: string;
      reason: string;
      endsAt?: string | null;
      days?: number | null;
      caseId?: string | null;
      riskFlagId?: string | null;
    },
    meta: RequestMeta,
  ) {
    const cfg = await opsConfig(this.config);
    if (!cfg.reasons.hold.some((r) => r.code === b.reasonCode))
      throw AppError.validation('Choose a configured reason', 'reasonCode');
    const s = await this.subject(b.kind, b.subjectId, actor);
    const scope = b.scope?.length ? b.scope : KIND[b.kind].scopes;
    if (scope.some((x) => !KIND[b.kind].scopes.includes(x)))
      throw AppError.validation('This scope does not apply to this kind', 'scope');
    const now = new Date();
    const maxDays = cfg.restrictions.maxDays[b.kind] ?? 30;
    const endsAt = b.endsAt
      ? new Date(b.endsAt)
      : new Date(now.getTime() + (b.days ?? maxDays) * D);
    if (endsAt <= now) throw AppError.validation('The end must be in the future', 'endsAt');
    if (endsAt.getTime() - now.getTime() > maxDays * D)
      throw AppError.validation(
        `A ${b.kind} lasts at most ${maxDays} days without a new decision`,
        'endsAt',
      );
    const open = await this.prisma.operationalRestriction.findFirst({
      where: {
        kind: b.kind,
        subjectId: b.subjectId,
        status: { in: ['PENDING_APPROVAL', 'ACTIVE'] },
      },
    });
    if (open)
      throw new AppError(
        'RESTRICTION_ACTIVE',
        `A ${b.kind} for this subject is already ${open.status}`,
        409,
      );
    const needs = (cfg.approvals.restrictions[b.kind] ?? 'ALWAYS') !== 'NEVER';
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.operationalRestriction.create({
        data: {
          reference: ref('RST'),
          kind: b.kind,
          status: needs ? 'PENDING_APPROVAL' : 'ACTIVE',
          subjectType: KIND[b.kind].subject,
          subjectId: b.subjectId,
          organizationId: s.organizationId,
          branchId: s.branchId,
          market: s.market,
          scope,
          reasonCode: b.reasonCode,
          reason: b.reason,
          startsAt: now,
          endsAt,
          requiresApproval: needs,
          requestedByUserId: actor.userId,
          caseId: b.caseId ?? null,
          riskFlagId: b.riskFlagId ?? null,
        },
      });
      await this.audit.record(
        {
          action: 'RESTRICTION_REQUESTED',
          entityType: 'OperationalRestriction',
          entityId: r.id,
          actor,
          subjectOrganizationId: s.organizationId,
          reason: b.reason,
          newState: {
            kind: b.kind,
            subjectId: b.subjectId,
            scope,
            endsAt: endsAt.toISOString(),
            requiresApproval: needs,
          },
          market: s.market,
          meta,
        },
        tx,
      );
      return r;
    });
    if (!needs) await this.apply(actor, row, meta);
    return this.view(
      await this.prisma.operationalRestriction.findUniqueOrThrow({ where: { id: row.id } }),
      actor,
    );
  }

  /** Checker: a different person with the approval permission. */
  async decide(actor: Actor, id: string, approve: boolean, reason: string, meta: RequestMeta) {
    const r = await this.prisma.operationalRestriction.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    if (r.status !== 'PENDING_APPROVAL')
      throw new AppError('INVALID_STATE', 'This restriction was already decided', 409);
    if (r.requestedByUserId === actor.userId)
      throw new AppError(
        'CHECKER_REQUIRED',
        'A different person must approve this restriction',
        403,
      );
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.operationalRestriction.updateMany({
        where: { id, status: 'PENDING_APPROVAL' },
        data: approve
          ? {
              status: 'ACTIVE',
              decidedByUserId: actor.userId,
              decidedAt: new Date(),
              decisionReason: reason,
              startsAt: new Date(),
            }
          : {
              status: 'REJECTED',
              decidedByUserId: actor.userId,
              decidedAt: new Date(),
              decisionReason: reason,
            },
      });
      if (u.count !== 1)
        throw new AppError(
          'VERSION_CONFLICT',
          'The restriction changed. Reload and try again.',
          409,
        );
      await this.audit.record(
        {
          action: approve ? 'RESTRICTION_APPROVED' : 'RESTRICTION_REJECTED',
          entityType: 'OperationalRestriction',
          entityId: id,
          actor,
          subjectOrganizationId: r.organizationId,
          reason,
          approvalRef: r.requestedByUserId,
          previousState: { status: r.status },
          newState: { status: approve ? 'ACTIVE' : 'REJECTED' },
          market: r.market,
          meta,
        },
        tx,
      );
    });
    const fresh = await this.prisma.operationalRestriction.findUniqueOrThrow({ where: { id } });
    if (approve) await this.apply(actor, fresh, meta);
    return this.view(
      await this.prisma.operationalRestriction.findUniqueOrThrow({ where: { id } }),
      actor,
    );
  }

  /** Applies an ACTIVE restriction through the enforcement point of its kind. */
  private async apply(actor: Actor, r: Row, meta: RequestMeta) {
    let appliedRef: Record<string, unknown> = {};
    if (r.kind === 'CUSTOMER_RESTRICTION' && r.scope.includes('NEW_RESERVATIONS')) {
      // the Stage 4 reservation restriction (strikes 0 = an operational decision, not no-shows)
      const cr = await this.prisma.customerRestriction.create({
        data: {
          userId: r.subjectId,
          reason: `${r.reference}: ${r.reason}`,
          strikes: 0,
          startsAt: r.startsAt,
          endsAt: r.endsAt,
        },
      });
      appliedRef = { customerRestrictionId: cr.id };
    } else if (r.kind === 'USER_SUSPENSION') {
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: r.subjectId }, data: { status: 'SUSPENDED' } }),
        this.prisma.userSession.updateMany({
          where: { userId: r.subjectId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ]);
    } else if (r.kind === 'INTEGRATION_SUSPENSION') {
      // PAUSED is the connection's existing "not accepting records" state (authentication refuses it)
      await this.prisma.integrationConnection.update({
        where: { id: r.subjectId },
        data: { status: 'PAUSED' },
      });
    } else if (r.kind === 'FINANCIAL_HOLD') {
      const h = (await this.finance.placeHold(
        actor,
        { organizationId: r.subjectId, reason: `${r.reference}: ${r.reason}` },
        meta,
      )) as { id?: string } | null;
      appliedRef = { financialHoldId: h?.id ?? null };
    }
    // MERCHANT_CAMPAIGN_HOLD, BRANCH_REDEMPTION_HOLD and the purchase / view scopes are read live by RestrictionCheckService
    await this.prisma.operationalRestriction.update({
      where: { id: r.id },
      data: { appliedRef: appliedRef as Prisma.InputJsonValue },
    });
    await this.notify(r, 'PLACED');
  }

  private async unapply(actor: Actor | null, r: Row, meta: RequestMeta | null) {
    const applied = (r.appliedRef ?? {}) as {
      customerRestrictionId?: string;
      financialHoldId?: string;
    };
    if (applied.customerRestrictionId)
      await this.prisma.customerRestriction.updateMany({
        where: { id: applied.customerRestrictionId, status: 'ACTIVE' },
        data: {
          status: 'LIFTED',
          liftedAt: new Date(),
          liftedByUserId: actor?.userId ?? null,
          liftedReason: 'Operational restriction ended',
        },
      });
    if (r.kind === 'USER_SUSPENSION')
      await this.prisma.user.updateMany({
        where: { id: r.subjectId, status: 'SUSPENDED' },
        data: { status: 'ACTIVE' },
      });
    if (r.kind === 'INTEGRATION_SUSPENSION')
      await this.prisma.integrationConnection.updateMany({
        where: { id: r.subjectId, status: 'PAUSED' },
        data: { status: 'ACTIVE' },
      });
    if (applied.financialHoldId && actor && meta) {
      const h = await this.prisma.financialHold.findUnique({
        where: { id: applied.financialHoldId },
      });
      if (h?.status === 'ACTIVE')
        await this.finance.releaseHold(actor, h.id, `${r.reference} lifted`, meta);
    }
    await this.notify(r, 'LIFTED');
  }

  /** Lifting reduces a restriction: one person with the manage permission, with a reason. */
  async lift(actor: Actor, id: string, reason: string, meta: RequestMeta) {
    const r = await this.prisma.operationalRestriction.findUnique({ where: { id } });
    if (!r) throw AppError.notFound();
    if (r.status !== 'ACTIVE')
      throw new AppError('INVALID_STATE', 'Only an active restriction can be lifted', 409);
    const u = await this.prisma.operationalRestriction.updateMany({
      where: { id, status: 'ACTIVE' },
      data: {
        status: 'LIFTED',
        liftedByUserId: actor.userId,
        liftedAt: new Date(),
        liftReason: reason,
      },
    });
    if (u.count !== 1)
      throw new AppError('VERSION_CONFLICT', 'The restriction changed. Reload and try again.', 409);
    await this.unapply(actor, r, meta);
    await this.prisma.approvalTask.updateMany({
      where: { dedupeKey: `hold-review:${id}`, status: 'OPEN' },
      data: {
        status: 'DONE',
        resolvedAt: new Date(),
        resolvedByUserId: actor.userId,
        resolution: 'LIFTED',
      },
    });
    await this.audit.record({
      action: 'RESTRICTION_LIFTED',
      entityType: 'OperationalRestriction',
      entityId: id,
      actor,
      subjectOrganizationId: r.organizationId,
      reason,
      previousState: { status: 'ACTIVE' },
      newState: { status: 'LIFTED' },
      market: r.market,
      meta,
    });
    return this.view(
      await this.prisma.operationalRestriction.findUniqueOrThrow({ where: { id } }),
      actor,
    );
  }

  /**
   * Expired restrictions end on their own (job). A financial hold never releases itself: at its end date a person is asked to
   * release or renew it (money controls are not loosened silently).
   */
  async expire(now = new Date()) {
    const due = await this.prisma.operationalRestriction.findMany({
      where: { status: 'ACTIVE', endsAt: { lte: now } },
      take: 200,
    });
    for (const r of due) {
      if (r.kind === 'FINANCIAL_HOLD') {
        await this.prisma.approvalTask
          .create({
            data: {
              kind: 'HOLD_REVIEW_DUE',
              status: 'OPEN',
              priority: 'HIGH',
              title: `Financial hold reached its end date: ${r.reference}`,
              detail: r.kind,
              organizationId: r.organizationId,
              entityType: 'OperationalRestriction',
              entityId: r.id,
              requiredPermission: 'admin.restrictions.manage',
              dedupeKey: `hold-review:${r.id}`,
              dueAt: now,
            },
          })
          .catch((e: { code?: string }) => {
            if (e.code !== 'P2002') throw e;
          });
        continue;
      }
      const u = await this.prisma.operationalRestriction.updateMany({
        where: { id: r.id, status: 'ACTIVE' },
        data: { status: 'EXPIRED' },
      });
      if (u.count !== 1) continue;
      await this.unapply(null, r, null);
      await this.audit.record({
        action: 'RESTRICTION_EXPIRED',
        entityType: 'OperationalRestriction',
        entityId: r.id,
        actorRole: 'SYSTEM',
        subjectOrganizationId: r.organizationId,
        market: r.market,
      });
    }
    return due.length;
  }

  /** The subject is told where configuration says so: a customer in-app; a business through its alerts. */
  private async notify(r: Row, event: 'PLACED' | 'LIFTED') {
    const cfg = await opsConfig(this.config);
    if (!cfg.restrictions.notifySubject[r.kind]) return;
    if (r.subjectType === 'USER') {
      await this.prisma.notification.createMany({
        data: [
          {
            userId: r.subjectId,
            type: 'ACCOUNT_RESTRICTION',
            dedupeKey: `restriction:${r.id}:${event}`,
            data: {
              reference: r.reference,
              kind: r.kind,
              event,
              scope: r.scope,
              endsAt: r.endsAt.toISOString(),
            },
          },
        ],
        skipDuplicates: true,
      });
    } else if (r.organizationId) {
      await this.alerts
        .raise({
          code: event === 'PLACED' ? 'RESTRICTION_PLACED' : 'RESTRICTION_LIFTED',
          organizationId: r.organizationId,
          subjectType: 'OperationalRestriction',
          subjectId: r.id,
          branchId: r.branchId,
          country: r.market,
          once: true,
          data: { reference: r.reference, kind: r.kind, endsAt: r.endsAt.toISOString() },
        })
        .catch(() => null);
    }
    await this.prisma.operationalRestriction.update({
      where: { id: r.id },
      data: { notifiedAt: new Date() },
    });
  }
}
