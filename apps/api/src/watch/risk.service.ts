import { Injectable, Optional } from '@nestjs/common';
import { UsageService } from '../subscription/usage.service';
import { LoyaltyIssuanceService } from '../loyalty/loyalty-issuance.service';
import type { RiskDecision, RiskReviewOutcome, RiskSignal } from '@dealdash/types';
import type { RiskFlagDetail, RiskFlagRow } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import { AppError } from '../common/errors';
import { keysetPage, Page } from '../common/pagination';
import type { Actor, RequestMeta } from '../common/request-context';
import { actorInfo } from '../live-deals/deal-core.service';
import { WatchFundingService } from './watch-funding.service';
import { RewardsLedgerService } from './rewards-ledger.service';
import { startOfRiyadhDay } from './watch-content';
import { WatchCoreService, type FraudPolicy, type FrequencyPolicy } from './watch-core.service';

export interface RiskSignalHit {
  code: RiskSignal;
  weight: number;
  detail: string;
}
export interface RiskAssessment {
  score: number;
  decision: RiskDecision;
  signals: RiskSignalHit[];
}

const std = (xs: number[]) => {
  if (xs.length < 2) return Infinity;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/**
 * Rule-based fraud and abuse screening (no machine learning in the MVP). Each rule adds a weighted signal; the total decides
 * ALLOW / HOLD / FLAG / BLOCK against configurable thresholds. Signals and thresholds are Admin-only: customers see a plain
 * reason class and merchants see only aggregate counts, so the detection logic is never revealed. Device identity is a random
 * per-installation id the app generates: no fingerprinting. Whether this needs consent is a VALIDATE-KSA item.
 */
@Injectable()
export class RiskService {
  constructor(
    private readonly core: WatchCoreService,
    private readonly rewards: RewardsLedgerService,
    private readonly funding: WatchFundingService,
    @Optional() private readonly loyalty?: LoyaltyIssuanceService,
    @Optional() private readonly usage?: UsageService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  // ---------------------------------------------------------------- blocks and device links
  async isBlocked(userId: string, deviceHash: string): Promise<boolean> {
    const n = await this.prisma.riskBlock.count({
      where: {
        active: true,
        scope: 'WATCH',
        OR: [
          { kind: 'ACCOUNT', subjectId: userId },
          { kind: 'DEVICE', subjectId: deviceHash },
        ],
      },
    });
    return n > 0;
  }

  /** Records that this account used this installation (and refuses when a cap on accounts or devices would be exceeded). */
  async linkDevice(
    userId: string,
    deviceHash: string,
    now: Date,
  ): Promise<'OK' | 'DEVICE_LIMIT' | 'ACCOUNT_LIMIT'> {
    const f = await this.core.frequency();
    const existing = await this.prisma.deviceLink.findUnique({
      where: { deviceHash_userId: { deviceHash, userId } },
    });
    if (existing) {
      await this.prisma.deviceLink.update({
        where: { id: existing.id },
        data: { lastSeenAt: now },
      });
      return 'OK';
    }
    const [accountsOnDevice, devicesOnAccount] = await Promise.all([
      this.prisma.deviceLink.count({ where: { deviceHash } }),
      this.prisma.deviceLink.count({ where: { userId } }),
    ]);
    if (accountsOnDevice >= f.deviceMaxAccounts) return 'DEVICE_LIMIT';
    if (devicesOnAccount >= f.accountMaxDevices) return 'ACCOUNT_LIMIT';
    await this.prisma.deviceLink.createMany({
      data: [{ deviceHash, userId, firstSeenAt: now, lastSeenAt: now }],
      skipDuplicates: true,
    });
    return 'OK';
  }

  // ---------------------------------------------------------------- assessment (at completion)
  async assess(
    db: Prisma.TransactionClient,
    policy: { f: FrequencyPolicy; fraud: FraudPolicy },
    view: {
      id: string;
      userId: string;
      deviceHash: string;
      campaignId: string;
      startedAt: Date;
      watchedSeconds: number;
      prompt: unknown;
    },
    now: Date,
    repeatWindowHours: number,
  ): Promise<RiskAssessment> {
    const { f, fraud } = policy;
    const hits: RiskSignalHit[] = [];
    const hit = (code: RiskSignal, weight: number, detail: string) =>
      hits.push({ code, weight, detail });

    const [accountBlock, deviceBlock] = await Promise.all([
      db.riskBlock.count({
        where: { active: true, scope: 'WATCH', kind: 'ACCOUNT', subjectId: view.userId },
      }),
      db.riskBlock.count({
        where: { active: true, scope: 'WATCH', kind: 'DEVICE', subjectId: view.deviceHash },
      }),
    ]);
    if (accountBlock) hit('ACCOUNT_BLOCKLISTED', 100, 'Account is blocked from earning');
    if (deviceBlock) hit('DEVICE_BLOCKLISTED', 100, 'Device is blocked from earning');

    const accountsOnDevice = await db.deviceLink.count({ where: { deviceHash: view.deviceHash } });
    if (accountsOnDevice > f.deviceMaxAccounts)
      hit('DEVICE_SHARED_ACCOUNTS', 40, `${accountsOnDevice} accounts use this device`);

    const user = await db.user.findUnique({
      where: { id: view.userId },
      select: { createdAt: true },
    });
    if (user && now.getTime() - user.createdAt.getTime() < fraud.newAccountHours * 3_600_000) {
      const n = await db.watchView.count({
        where: {
          userId: view.userId,
          status: 'QUALIFIED',
          qualifiedAt: { gte: new Date(now.getTime() - 86_400_000) },
        },
      });
      if (n >= fraud.newAccountMaxViews)
        hit('NEW_ACCOUNT_BURST', 35, `New account with ${n} rewarded views today`);
    }

    const elapsedSec = (now.getTime() - view.startedAt.getTime()) / 1000;
    if (view.watchedSeconds > elapsedSec + 2)
      hit('IMPOSSIBLE_TIMELINE', 100, 'Watched time exceeds elapsed time');

    const beats = await db.watchViewEvent.findMany({
      where: { viewId: view.id, type: 'HEARTBEAT' },
      orderBy: { serverAt: 'asc' },
      select: { serverAt: true },
      take: 400,
    });
    if (beats.length >= 8) {
      const gaps: number[] = [];
      for (let i = 1; i < beats.length; i++)
        gaps.push(beats[i]!.serverAt.getTime() - beats[i - 1]!.serverAt.getTime());
      if (std(gaps) < fraud.regularityStdDevMs)
        hit(
          'AUTOMATION_PATTERN',
          25,
          `Heartbeat spacing is unusually regular (${std(gaps).toFixed(1)} ms)`,
        );
    }

    const prompt = view.prompt as { responseMs?: number } | null;
    if (typeof prompt?.responseMs === 'number' && prompt.responseMs < fraud.minPromptResponseMs)
      hit('PROMPT_TOO_FAST', 35, `Prompt answered in ${prompt.responseMs} ms`);

    const starts = await db.watchView.count({
      where: {
        userId: view.userId,
        startedAt: { gte: new Date(now.getTime() - fraud.velocityWindowMinutes * 60_000) },
      },
    });
    if (starts > fraud.velocityMaxStarts)
      hit('VIEW_VELOCITY', 40, `${starts} views started in ${fraud.velocityWindowMinutes} minutes`);

    if (fraud.dailyCapStreakDays > 0) {
      const today = startOfRiyadhDay(now);
      const from = new Date(today.getTime() - fraud.dailyCapStreakDays * 86_400_000);
      const rows = await db.$queryRaw<Array<{ day: Date; n: number }>>(Prisma.sql`
        SELECT date_trunc('day', ("qualifiedAt" AT TIME ZONE 'Asia/Riyadh')) AS day, count(*)::int AS n
        FROM "WatchView" WHERE "userId" = ${view.userId}::uuid AND "status" = 'QUALIFIED'
          AND "qualifiedAt" >= ${from} AND "qualifiedAt" < ${today}
        GROUP BY 1`);
      if (rows.filter((r) => r.n >= f.customerDailyCap).length >= fraud.dailyCapStreakDays)
        hit(
          'DAILY_CAP_STREAK',
          30,
          `Reached the daily cap ${fraud.dailyCapStreakDays} days in a row`,
        );
    }

    const other = await db.watchView.count({
      where: {
        campaignId: view.campaignId,
        deviceHash: view.deviceHash,
        userId: { not: view.userId },
        status: 'QUALIFIED',
        qualifiedAt: { gte: new Date(now.getTime() - repeatWindowHours * 3_600_000) },
      },
    });
    if (other > 0)
      hit(
        'REPEAT_CAMPAIGN',
        30,
        'Another account on this device already earned from this campaign',
      );

    const score = hits.reduce((n, h) => n + h.weight, 0);
    const t = fraud.thresholds;
    const decision: RiskDecision =
      accountBlock || deviceBlock || score >= t.block
        ? 'BLOCK'
        : score >= t.flag
          ? 'FLAG'
          : score >= t.hold
            ? 'HOLD'
            : 'ALLOW';
    return { score, decision, signals: hits };
  }

  /** Opens a case for Admin (FLAG and BLOCK decisions; also manual). */
  async openFlag(
    tx: Prisma.TransactionClient,
    f: {
      decision: RiskDecision;
      score: number;
      signals: RiskSignalHit[];
      userId: string;
      deviceHash: string;
      campaignId: string;
      viewId: string;
      rewardEntryId?: string | null;
    },
  ) {
    return tx.riskFlag.create({
      data: {
        decision: f.decision,
        severity: f.score,
        signals: f.signals as unknown as Prisma.InputJsonValue,
        subjectUserId: f.userId,
        subjectDeviceHash: f.deviceHash,
        campaignId: f.campaignId,
        viewId: f.viewId,
        rewardEntryId: f.rewardEntryId ?? null,
      },
    });
  }

  // ---------------------------------------------------------------- admin: cases
  private label(
    userId: string | null,
    mobile: string | null | undefined,
    deviceHash: string | null,
  ) {
    if (userId)
      return mobile
        ? `${mobile.slice(0, 4)}••••${mobile.slice(-3)}`
        : `Customer ${userId.slice(0, 8)}`;
    return `Device ${(deviceHash ?? '').slice(0, 8)}`;
  }

  private async rows(flags: Array<Awaited<ReturnType<RiskService['loadFlags']>>[number]>) {
    const userIds = [...new Set(flags.map((f) => f.subjectUserId).filter((x): x is string => !!x))];
    const campaignIds = [
      ...new Set(flags.map((f) => f.campaignId).filter((x): x is string => !!x)),
    ];
    const [users, campaigns] = await Promise.all([
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, mobile: true },
          })
        : [],
      campaignIds.length
        ? this.prisma.watchCampaign.findMany({
            where: { id: { in: campaignIds } },
            select: { id: true, titleEn: true, titleAr: true },
          })
        : [],
    ]);
    const u = new Map(users.map((x) => [x.id, x.mobile]));
    const c = new Map(campaigns.map((x) => [x.id, x]));
    return flags.map((f): RiskFlagRow => ({
      id: f.id,
      createdAt: f.createdAt.toISOString(),
      decision: f.decision,
      severity: f.severity,
      status: f.status,
      signals: (f.signals as unknown as RiskSignalHit[]).map((s) => s.code),
      subject: {
        kind: f.subjectUserId ? 'ACCOUNT' : 'DEVICE',
        label: this.label(f.subjectUserId, u.get(f.subjectUserId ?? ''), f.subjectDeviceHash),
      },
      campaign:
        f.campaignId && c.get(f.campaignId)
          ? {
              id: f.campaignId,
              title: { en: c.get(f.campaignId)!.titleEn, ar: c.get(f.campaignId)!.titleAr },
            }
          : null,
      viewId: f.viewId,
      outcome: (f.outcome ?? null) as RiskReviewOutcome | null,
      reviewedByName: f.reviewedByName,
    }));
  }

  private loadFlags(ids: string[]) {
    return this.prisma.riskFlag.findMany({ where: { id: { in: ids } } });
  }

  async list(q: {
    limit: number;
    cursor?: string;
    status?: string;
    decision?: string;
  }): Promise<Page<RiskFlagRow>> {
    const page = await keysetPage({
      findMany: (query) => this.prisma.riskFlag.findMany(query),
      baseWhere: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.decision ? { decision: q.decision } : {}),
      },
      sort: { field: 'createdAt', dir: 'desc' },
      limit: q.limit,
      cursor: q.cursor,
    });
    return new Page(await this.rows(page.items), page.nextCursor);
  }

  async detail(id: string): Promise<RiskFlagDetail> {
    const f = await this.prisma.riskFlag.findUnique({ where: { id } });
    if (!f) throw AppError.notFound();
    const [row] = await this.rows([f]);
    const events = f.viewId
      ? await this.prisma.watchViewEvent.findMany({
          where: { viewId: f.viewId },
          orderBy: { serverAt: 'asc' },
          take: 300,
        })
      : [];
    const [accountsOnDevice, devicesOnAccount, recentViews] = await Promise.all([
      f.subjectDeviceHash
        ? this.prisma.deviceLink.count({ where: { deviceHash: f.subjectDeviceHash } })
        : 0,
      f.subjectUserId ? this.prisma.deviceLink.count({ where: { userId: f.subjectUserId } }) : 0,
      f.subjectUserId
        ? this.prisma.watchView.count({
            where: {
              userId: f.subjectUserId,
              startedAt: { gte: new Date(Date.now() - 86_400_000) },
            },
          })
        : 0,
    ]);
    return {
      ...row!,
      signalDetails: f.signals as unknown as RiskFlagDetail['signalDetails'],
      timeline: events.map((e) => ({
        type: e.type,
        positionSec: e.positionSec,
        at: e.serverAt.toISOString(),
      })),
      linked: { accountsOnDevice, devicesOnAccount, recentViews },
      rewardEntryId: f.rewardEntryId,
      reviewReason: f.reviewReason,
    };
  }

  /** Admin decision on a case. Every outcome is audited; fund and reward effects are applied in one transaction. */
  async decide(
    actor: Actor,
    id: string,
    body: { outcome: RiskReviewOutcome; reason: string },
    meta: RequestMeta,
  ) {
    const f = await this.prisma.riskFlag.findUnique({ where: { id } });
    if (!f) throw AppError.notFound();
    if (f.status === 'DECIDED')
      throw new AppError('INVALID_STATE', 'This case has already been decided', 409);
    const info = actorInfo(actor);
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.riskFlag.updateMany({
        where: { id, status: { not: 'DECIDED' } },
        data: {
          status: 'DECIDED',
          outcome: body.outcome,
          reviewedByUserId: actor.userId,
          reviewedByName: info.name,
          reviewedAt: new Date(),
          reviewReason: body.reason,
        },
      });
      if (claim.count !== 1)
        throw new AppError('VERSION_CONFLICT', 'The case was decided already', 409);
      const rolePair = { userId: actor.userId, role: info.role };
      const view = f.viewId ? await tx.watchView.findUnique({ where: { id: f.viewId } }) : null;
      const reverseView = async () => {
        if (!view) return;
        await this.rewards.reverse(tx, view.id, 'FRAUD_REVIEW', rolePair);
        // loyalty points earned from this view follow the same verdict
        await this.loyalty?.reverseForSource(tx, { sourceType: 'EVENT', sourceId: `view:${view.id}`, reason: 'FRAUD_REVIEW', actor: { userId: actor.userId, role: info.role } });
        if (view.status === 'QUALIFIED') {
          const c = await tx.watchCampaign.findUniqueOrThrow({ where: { id: view.campaignId } });
          await this.funding.creditBack(tx, c, view, 'fraud review');
          // the merchant's charge came back, so the billing hook for that view is void (while Phase 5 has not consumed it)
          await this.usage?.voidBillable('QUALIFIED_VIEW_USAGE', view.id, tx);
          await tx.watchView.update({
            where: { id: view.id },
            data: { status: 'CREDITED_BACK', reason: 'FRAUD_REVERSED', creditedBackAt: new Date() },
          });
        }
      };
      switch (body.outcome) {
        case 'CLEAR':
          if (view) await this.rewards.release(tx, view.id, 'REVIEW_CLEARED', rolePair);
          break;
        case 'HOLD_REWARDS':
          break;
        case 'REVERSE_REWARDS':
          await reverseView();
          break;
        case 'BLOCK_DEVICE':
        case 'BLOCK_ACCOUNT': {
          const kind = body.outcome === 'BLOCK_DEVICE' ? 'DEVICE' : 'ACCOUNT';
          const subject = kind === 'DEVICE' ? f.subjectDeviceHash : f.subjectUserId;
          if (subject)
            await tx.$executeRaw`INSERT INTO "RiskBlock" ("id", "kind", "subjectId", "scope", "reason", "active", "createdByUserId")
              VALUES (gen_random_uuid(), ${kind}, ${subject}, 'WATCH', ${body.reason}, true, ${actor.userId}::uuid)
              ON CONFLICT ("kind", "subjectId", "scope") WHERE "active" DO NOTHING`;
          await reverseView();
          break;
        }
        case 'PAUSE_CAMPAIGN':
          if (f.campaignId) {
            const c = await tx.watchCampaign.findUniqueOrThrow({ where: { id: f.campaignId } });
            if (c.status === 'LIVE' || c.status === 'SCHEDULED')
              await this.core.transition(tx, c, 'PAUSED', {
                action: 'PAUSE',
                actor,
                reason: `Fraud review: ${body.reason}`,
                data: { pausedBy: 'DEALDASH' },
                meta,
              });
          }
          break;
      }
      await this.core.audit.record(
        {
          action: 'risk.case_decided',
          entityType: 'RiskFlag',
          entityId: id,
          reason: body.reason,
          newState: { outcome: body.outcome },
          actor,
          meta,
        },
        tx,
      );
    });
    return this.detail(id);
  }
}
