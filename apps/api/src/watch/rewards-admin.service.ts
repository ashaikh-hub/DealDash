import { Injectable } from '@nestjs/common';
import type {
  RewardAccountRow,
  RewardAdjustmentView,
  RewardAdminOverview,
  RewardLedgerRow,
} from '@dealdash/validation';
import { z } from 'zod';
import { rewardItemSaveSchema } from '@dealdash/validation';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { actorInfo } from '../live-deals/deal-core.service';
import { RewardsLedgerService } from './rewards-ledger.service';
import { WatchCoreService } from './watch-core.service';

type ItemInput = z.infer<typeof rewardItemSaveSchema>;

const mask = (mobile: string | null | undefined, id: string) =>
  mobile ? `${mobile.slice(0, 4)}••••${mobile.slice(-3)}` : `Customer ${id.slice(0, 8)}`;

/** DealDash administration of rewards: liability view, ledger inspection, manual adjustments and the redemption catalogue. */
@Injectable()
export class RewardsAdminService {
  constructor(
    private readonly core: WatchCoreService,
    private readonly ledger: RewardsLedgerService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  async overview(): Promise<RewardAdminOverview> {
    const [sums, rules, rule, items, redeemed] = await Promise.all([
      this.prisma.rewardAccount.aggregate({
        _sum: { availableBalance: true, heldBalance: true },
        _count: { _all: true },
      }),
      this.core.rewardsRules(),
      this.core.rewardRule(),
      this.prisma.rewardCatalogueItem.findMany({
        orderBy: [{ status: 'asc' }, { pointsCost: 'asc' }],
      }),
      this.prisma.rewardRedemption.groupBy({ by: ['itemId'], _count: { _all: true } }),
    ]);
    const rb = new Map(redeemed.map((r) => [r.itemId, r._count._all]));
    return {
      liability: {
        availableBalance: sums._sum.availableBalance ?? 0,
        heldBalance: sums._sum.heldBalance ?? 0,
        accounts: sums._count._all,
      },
      rules: {
        expiryDays: rules.expiryDays,
        negativeBalancePolicy: rules.negativeBalancePolicy,
        adjustmentCheckerThresholdPoints: rules.adjustmentCheckerThresholdPoints,
        rewardRule: rule.tiers,
        pointValueShown: false,
      },
      items: items.map((i) => ({
        id: i.id,
        name: { en: i.nameEn, ar: i.nameAr },
        description: { en: i.descriptionEn, ar: i.descriptionAr },
        pointsCost: i.pointsCost,
        stock: i.stock,
        status: i.status,
        isSample: i.isSample,
        redeemed: rb.get(i.id) ?? 0,
      })),
    };
  }

  async accounts(q: { q: string; limit: number }): Promise<RewardAccountRow[]> {
    const users = await this.prisma.user.findMany({
      where: {
        userType: 'CUSTOMER',
        OR: [
          { mobile: { contains: q.q } },
          { displayName: { contains: q.q, mode: 'insensitive' } },
          { id: q.q.length === 36 ? q.q : undefined },
        ],
      },
      select: { id: true, mobile: true },
      take: q.limit,
    });
    const accs = users.length
      ? await this.prisma.rewardAccount.findMany({
          where: { userId: { in: users.map((u) => u.id) } },
        })
      : [];
    const byUser = new Map(accs.map((a) => [a.userId, a]));
    return users.map((u) => {
      const a = byUser.get(u.id);
      return {
        userId: u.id,
        label: mask(u.mobile, u.id),
        availableBalance: a?.availableBalance ?? 0,
        heldBalance: a?.heldBalance ?? 0,
        lifetimeEarned: a?.lifetimeEarned ?? 0,
        lifetimeRedeemed: a?.lifetimeRedeemed ?? 0,
      };
    });
  }

  async ledgerList(q: {
    limit: number;
    cursor?: string;
    userId?: string;
    type?: string;
  }): Promise<Page<RewardLedgerRow>> {
    const acc = q.userId
      ? await this.prisma.rewardAccount.findUnique({ where: { userId: q.userId } })
      : null;
    if (q.userId && !acc) return new Page([], null);
    const page = await keysetPage({
      findMany: (query) =>
        this.prisma.rewardEntry.findMany({ ...query, include: { account: true } }),
      baseWhere: { ...(acc ? { accountId: acc.id } : {}), ...(q.type ? { type: q.type } : {}) },
      sort: { field: 'createdAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    const views = await this.ledger.views(page.items);
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(page.items.map((e) => e.account.userId))] } },
      select: { id: true, mobile: true },
    });
    const m = new Map(users.map((u) => [u.id, u.mobile]));
    return new Page(
      page.items.map((e, i) => ({
        ...views[i]!,
        // admins see the real reason code and the actor role (customers do not)
        reasonClass: e.reasonCode,
        userId: e.account.userId,
        accountLabel: mask(m.get(e.account.userId), e.account.userId),
        reasonCode: e.reasonCode,
        actorRole: e.actorRole ?? e.actorType,
        sourceId: e.sourceId,
      })),
      page.nextCursor,
    );
  }

  /** Cached balances against the ledger: they must agree exactly (used by the admin check and by tests). */
  async reconcile(userId?: string) {
    const rows = await this.prisma.$queryRaw<
      Array<{
        userId: string;
        cachedAvailable: number;
        ledgerAvailable: bigint;
        cachedHeld: number;
        ledgerHeld: bigint;
      }>
    >`SELECT a."userId", a."availableBalance" AS "cachedAvailable", a."heldBalance" AS "cachedHeld",
             COALESCE(SUM(e."points") FILTER (WHERE e."bucket" = 'AVAILABLE'), 0)::bigint AS "ledgerAvailable",
             COALESCE(SUM(e."points") FILTER (WHERE e."bucket" = 'HELD'), 0)::bigint AS "ledgerHeld"
      FROM "RewardAccount" a LEFT JOIN "RewardEntry" e ON e."accountId" = a."id"
      GROUP BY a."id"`;
    const bad = rows.filter(
      (r) =>
        (!userId || r.userId === userId) &&
        (r.cachedAvailable !== Number(r.ledgerAvailable) || r.cachedHeld !== Number(r.ledgerHeld)),
    );
    return { accounts: rows.length, mismatches: bad.length };
  }

  // ---------------------------------------------------------------- adjustments
  private async view(
    a: {
      id: string;
      accountId: string;
      points: number;
      reasonCode: string;
      ticketRef: string;
      reason: string;
      status: string;
      requestedByUserId: string;
      requestedByName: string | null;
      decidedByName: string | null;
      createdAt: Date;
    },
    actor: Actor | null,
    threshold: number,
    userId: string,
    mobile: string | null,
  ): Promise<RewardAdjustmentView> {
    const needsChecker = Math.abs(a.points) >= threshold;
    const can =
      a.status === 'PENDING' &&
      !!actor?.permissions.has('admin.rewards.manage') &&
      (!needsChecker || a.requestedByUserId !== actor.userId);
    return {
      id: a.id,
      userId,
      accountLabel: mask(mobile, userId),
      points: a.points,
      reasonCode: a.reasonCode,
      ticketRef: a.ticketRef,
      reason: a.reason,
      status: a.status as never,
      requestedByName: a.requestedByName,
      decidedByName: a.decidedByName,
      needsChecker,
      actions: can ? ['approve', 'reject'] : [],
      createdAt: a.createdAt.toISOString(),
    };
  }

  private async views(rows: Parameters<RewardsAdminService['view']>[0][], actor: Actor | null) {
    const rules = await this.core.rewardsRules();
    const accs = rows.length
      ? await this.prisma.rewardAccount.findMany({
          where: { id: { in: rows.map((r) => r.accountId) } },
        })
      : [];
    const users = accs.length
      ? await this.prisma.user.findMany({
          where: { id: { in: accs.map((a) => a.userId) } },
          select: { id: true, mobile: true },
        })
      : [];
    return Promise.all(
      rows.map((r) => {
        const acc = accs.find((a) => a.id === r.accountId)!;
        return this.view(
          r,
          actor,
          rules.adjustmentCheckerThresholdPoints,
          acc.userId,
          users.find((u) => u.id === acc.userId)?.mobile ?? null,
        );
      }),
    );
  }

  async adjustments(actor: Actor, q: { limit: number; status?: string }) {
    const rows = await this.prisma.rewardAdjustment.findMany({
      where: q.status ? { status: q.status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return this.views(rows, actor);
  }

  async requestAdjustment(
    actor: Actor,
    body: { userId: string; points: number; reasonCode: string; ticketRef: string; reason: string },
    meta: RequestMeta,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: body.userId, userType: 'CUSTOMER' },
    });
    if (!user) throw AppError.notFound();
    const info = actorInfo(actor);
    const created = await this.prisma.$transaction(async (tx) => {
      const accountId = await this.ledger.ensureAccount(tx, body.userId);
      const a = await tx.rewardAdjustment.create({
        data: {
          accountId,
          points: body.points,
          reasonCode: body.reasonCode,
          ticketRef: body.ticketRef,
          reason: body.reason,
          requestedByUserId: actor.userId,
          requestedByName: info.name,
        },
      });
      await this.core.audit.record(
        {
          action: 'reward.adjustment_requested',
          entityType: 'RewardAdjustment',
          entityId: a.id,
          reason: body.reason,
          newState: { points: body.points, ticketRef: body.ticketRef },
          actor,
          meta,
        },
        tx,
      );
      return a;
    });
    return (await this.views([created], actor))[0]!;
  }

  async decideAdjustment(
    actor: Actor,
    id: string,
    approve: boolean,
    reason: string,
    meta: RequestMeta,
  ) {
    const a = await this.prisma.rewardAdjustment.findUnique({ where: { id } });
    if (!a) throw AppError.notFound();
    if (a.status !== 'PENDING')
      throw new AppError('INVALID_STATE', 'This request was already decided', 409);
    const rules = await this.core.rewardsRules();
    if (
      approve &&
      Math.abs(a.points) >= rules.adjustmentCheckerThresholdPoints &&
      a.requestedByUserId === actor.userId
    )
      throw new AppError(
        'CHECKER_REQUIRED',
        'A different administrator must approve this adjustment',
        403,
      );
    const info = actorInfo(actor);
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.rewardAdjustment.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          decidedByUserId: actor.userId,
          decidedByName: info.name,
          decidedAt: new Date(),
          decisionReason: reason,
        },
      });
      if (claim.count !== 1)
        throw new AppError('VERSION_CONFLICT', 'This request was decided already', 409);
      if (approve) {
        const acc = await tx.rewardAccount.findUniqueOrThrow({ where: { id: a.accountId } });
        const entry = await this.ledger.applyAdjustment(
          tx,
          { id: a.id, userId: acc.userId, points: a.points, reasonCode: a.reasonCode },
          { userId: actor.userId, role: info.role },
        );
        await tx.rewardAdjustment.update({ where: { id }, data: { entryId: entry.id } });
      }
      await this.core.audit.record(
        {
          action: approve ? 'reward.adjustment_approved' : 'reward.adjustment_rejected',
          entityType: 'RewardAdjustment',
          entityId: id,
          reason,
          newState: { points: a.points },
          actor,
          meta,
        },
        tx,
      );
    });
    const fresh = await this.prisma.rewardAdjustment.findUniqueOrThrow({ where: { id } });
    return (await this.views([fresh], actor))[0]!;
  }

  // ---------------------------------------------------------------- catalogue (configurable; sample items are flagged)
  async saveItem(actor: Actor, id: string | null, body: ItemInput, meta: RequestMeta) {
    const data = {
      nameEn: body.name.en,
      nameAr: body.name.ar,
      descriptionEn: body.description.en,
      descriptionAr: body.description.ar,
      pointsCost: body.pointsCost,
      stock: body.stock,
      status: body.status,
      validityDays: body.validityDays,
      isSample: body.isSample,
    };
    const item = await this.prisma.$transaction(async (tx) => {
      const row = id
        ? await tx.rewardCatalogueItem.update({ where: { id }, data }).catch(() => {
            throw AppError.notFound();
          })
        : await tx.rewardCatalogueItem.create({ data: { ...data, createdByUserId: actor.userId } });
      await this.core.audit.record(
        {
          action: id ? 'reward.item_updated' : 'reward.item_created',
          entityType: 'RewardCatalogueItem',
          entityId: row.id,
          newState: { pointsCost: row.pointsCost, status: row.status, stock: row.stock },
          actor,
          meta,
        },
        tx,
      );
      return row;
    });
    return item.id;
  }
}
