import { Inject, Injectable, Optional } from '@nestjs/common';
import { UsageService } from '../subscription/usage.service';
import { LoyaltyIssuanceService } from '../loyalty/loyalty-issuance.service';
import { reasonClassOf, type WatchEventType, type WatchReason } from '@dealdash/types';
import type { WatchEventsResult, WatchOutcomeView, WatchViewStarted } from '@dealdash/validation';
import { Prisma } from '../generated/prisma/client';
import type { AnalyticsSink } from '@dealdash/analytics';
import { ANALYTICS_SINK } from '../analytics/analytics.module';
import { AppError } from '../common/errors';
import { NotificationsService, type NotificationInput } from '../hot-deals/notifications.service';
import { EligibilityService, evaluateEligibility } from '../live-deals/eligibility.service';
import { RewardsLedgerService } from './rewards-ledger.service';
import { RiskService } from './risk.service';
import {
  hashDevice,
  hashToken,
  inTimeWindow,
  newPromptId,
  newViewToken,
  nextRiyadhMidnight,
  startOfRiyadhDay,
} from './watch-content';
import { WatchCoreService } from './watch-core.service';
import { WatchFundingService } from './watch-funding.service';

/** The server-side state of one viewing session (stored in WatchView.prompt). The client never sees these thresholds. */
interface Session {
  /** Position at which the still-watching prompt appears (null = no prompt on this view). */
  atPositionSec: number | null;
  id: string | null;
  issuedAt: string | null;
  answeredAt: string | null;
  responseMs: number | null;
  passed: boolean | null;
  /** Set while the app is in the background. */
  bgSince: string | null;
}
const emptySession = (): Session => ({
  atPositionSec: null,
  id: null,
  issuedAt: null,
  answeredAt: null,
  responseMs: null,
  passed: null,
  bgSince: null,
});
const readSession = (raw: unknown): Session => ({
  ...emptySession(),
  ...((raw ?? {}) as Partial<Session>),
});

const MAX_STORED_EVENTS = 800;

export interface IncomingViewEvent {
  type: WatchEventType;
  positionSec: number;
  clientAt?: number;
  promptId?: string;
}

/**
 * The qualifying-view pipeline. THE SERVER DECIDES (WE-29): the app only reports what the player did; every threshold, timer
 * and verdict lives here. A simple start never earns anything. A view qualifies only if all of these hold, evaluated from the
 * server-stamped timeline: the session is valid and unexpired; the app stayed in the foreground; enough real playback time
 * passed (it can never exceed elapsed server time, so skipping or seeking earns nothing); a server-scheduled still-watching
 * prompt (when this view has one) was answered in time; the campaign is still live; the customer is within the repeat and daily
 * limits; the account and device are within caps and not blocked; and the risk screen did not block it. Only then is the
 * merchant's budget charged (one conditional SQL update, never overspent) and the reward written (exactly once per view).
 */
@Injectable()
export class WatchQualificationService {
  constructor(
    private readonly core: WatchCoreService,
    private readonly funding: WatchFundingService,
    private readonly rewards: RewardsLedgerService,
    private readonly risk: RiskService,
    private readonly eligibility: EligibilityService,
    private readonly notifications: NotificationsService,
    @Inject(ANALYTICS_SINK) private readonly sink: AnalyticsSink,
    @Optional() private readonly loyalty?: LoyaltyIssuanceService,
    @Optional() private readonly usage?: UsageService,
  ) {}

  private get prisma() {
    return this.core.prisma;
  }

  private unavailable(cls: string, message: string, status = 409): never {
    throw new AppError('VIEW_NOT_ALLOWED', message, status, cls);
  }

  // ---------------------------------------------------------------- eligibility to start
  /** Everything that decides whether this customer may start this video now. Also used by discovery for card states. */
  async startVerdict(
    userId: string,
    campaignId: string,
    now: Date,
  ): Promise<{
    availability:
      'AVAILABLE' | 'ALREADY_EARNED' | 'DAILY_CAP' | 'BUDGET_EXHAUSTED' | 'ENDED' | 'UNAVAILABLE';
    availableAgainAt: Date | null;
  }> {
    const c = await this.prisma.watchCampaign.findUnique({
      where: { id: campaignId },
      include: { organization: true },
    });
    if (!c || c.organization.status !== 'ACTIVE')
      return { availability: 'UNAVAILABLE', availableAgainAt: null };
    if (c.status === 'COMPLETED')
      return { availability: 'BUDGET_EXHAUSTED', availableAgainAt: null };
    if (c.status === 'EXPIRED' || (c.endAt && c.endAt <= now))
      return { availability: 'ENDED', availableAgainAt: null };
    if (c.status !== 'LIVE' || (c.startAt && c.startAt > now))
      return { availability: 'UNAVAILABLE', availableAgainAt: null };
    const content = this.core.content(c);
    if (!inTimeWindow(content.targeting.timeWindow, now))
      return { availability: 'UNAVAILABLE', availableAgainAt: null };
    if (
      c.qualifiedViews >= c.paidViews ||
      c.fundedHalalas - c.spentHalalas < c.chargePerViewHalalas
    )
      return { availability: 'BUDGET_EXHAUSTED', availableAgainAt: null };
    const f = await this.core.frequency();
    const windowStart = new Date(now.getTime() - c.repeatWindowHours * 3_600_000);
    const earned = await this.prisma.watchView.findMany({
      where: { userId, campaignId, status: 'QUALIFIED', qualifiedAt: { gte: windowStart } },
      orderBy: { qualifiedAt: 'asc' },
      select: { qualifiedAt: true },
    });
    if (earned.length >= f.maxQualifiedPerCustomerPerCampaign) {
      const first = earned[0]!.qualifiedAt!;
      return {
        availability: 'ALREADY_EARNED',
        availableAgainAt: new Date(first.getTime() + c.repeatWindowHours * 3_600_000),
      };
    }
    const today = startOfRiyadhDay(now);
    const todayCount = await this.prisma.watchView.count({
      where: { userId, status: 'QUALIFIED', qualifiedAt: { gte: today } },
    });
    if (todayCount >= f.customerDailyCap)
      return { availability: 'DAILY_CAP', availableAgainAt: nextRiyadhMidnight(now) };
    return { availability: 'AVAILABLE', availableAgainAt: null };
  }

  // ---------------------------------------------------------------- start
  async start(
    userId: string,
    input: { campaignId: string; deviceId: string; city?: string },
    now = new Date(),
  ): Promise<WatchViewStarted> {
    const c = await this.prisma.watchCampaign.findUnique({
      where: { id: input.campaignId },
      include: { organization: { include: { merchant: true } } },
    });
    if (!c || c.organization.status !== 'ACTIVE') throw AppError.notFound();
    await this.core.commercial.assertCustomerExposureAllowed(c.organizationId, { userId, scope: 'NEW_VIEWS' });
    const verdict = await this.startVerdict(userId, c.id, now);
    if (verdict.availability !== 'AVAILABLE') {
      const map = {
        ALREADY_EARNED: 'ALREADY_EARNED',
        DAILY_CAP: 'DAILY_CAP',
        BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
        ENDED: 'UNAVAILABLE',
        UNAVAILABLE: 'UNAVAILABLE',
      } as const;
      this.unavailable(map[verdict.availability], 'This video is not available for you right now');
    }
    const content = this.core.content(c);
    // targeting: the browsing/profile city and the eligibility rule must both allow this customer
    const ctx = await this.eligibility.contextFor(
      userId,
      input.city ?? content.targeting.cities[0] ?? 'Riyadh',
      now,
    );
    const inCity = content.targeting.cities.some(
      (x) => x.trim().toLowerCase() === ctx.city.trim().toLowerCase(),
    );
    if (!inCity)
      this.unavailable('UNAVAILABLE', 'This video is not available for you right now', 403);
    const outcome = evaluateEligibility(
      content.targeting.eligibility.kind,
      this.eligibility.conditionsFor(content.targeting.eligibility),
      ctx,
      content.targeting.eligibility.expression,
    );
    if (outcome.result !== 'ELIGIBLE')
      this.unavailable('UNAVAILABLE', 'This video is not available for you right now', 403);

    const deviceHash = hashDevice(input.deviceId);
    if (await this.risk.isBlocked(userId, deviceHash))
      this.unavailable('OTHER', 'This video is not available for you right now', 403);
    const link = await this.risk.linkDevice(userId, deviceHash, now);
    if (link !== 'OK')
      this.unavailable('DAILY_CAP', 'This video is not available for you right now', 429);

    const q = await this.core.qualifying();
    const durationSec = c.durationSec ?? content.durationSec ?? 0;
    if (!c.videoFileId || durationSec <= 0) throw AppError.notFound();
    const required = this.core.requiredSeconds(q, durationSec);
    const sw = q.stillWatching;
    const needsPrompt =
      sw.mode === 'ALWAYS' ||
      (sw.mode === 'RANDOM' && durationSec >= sw.minDurationSec && Math.random() < sw.probability);
    const session: Session = {
      ...emptySession(),
      atPositionSec: needsPrompt
        ? Math.max(1, Math.round(durationSec * (0.35 + Math.random() * 0.25)))
        : null,
    };
    const token = newViewToken();
    const expiresAt = new Date(now.getTime() + (durationSec * q.maxSessionFactor + 30) * 1000);
    let viewId: string;
    try {
      viewId = await this.prisma.$transaction(async (tx) => {
        // one open session per customer: starting another video abandons the previous one
        await tx.watchView.updateMany({
          where: { userId, status: 'STARTED' },
          data: { status: 'INVALID', reason: 'SESSION_EXPIRED' as WatchReason },
        });
        const v = await tx.watchView.create({
          data: {
            campaignVersion: await this.core.versions.current(tx, 'WATCH', c.id),
            campaignId: c.id,
            userId,
            deviceHash,
            tokenHash: hashToken(token),
            city: ctx.city,
            durationSec,
            requiredSeconds: required,
            startedAt: now,
            lastEventAt: now,
            expiresAt,
            stillWatchingNeeded: needsPrompt,
            prompt: session as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.watchViewEvent.create({
          data: { viewId: v.id, type: 'STARTED', positionSec: 0, serverAt: now },
        });
        return v.id;
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002')
        this.unavailable('OTHER', 'Another video is already playing', 409);
      throw e;
    }
    const urls = await this.core.playbackUrl(
      c.videoFileId,
      Math.ceil(durationSec * q.maxSessionFactor + 60),
    );
    const poster = c.thumbnailFileId ? await this.core.playbackUrl(c.thumbnailFileId, 3600) : null;
    void this.sink.track({
      name: 'watch.view_started',
      userId,
      organizationId: c.organizationId,
      timestamp: now.toISOString(),
      context: { app: 'customer' },
      properties: { campaignId: c.id },
    });
    return {
      viewId,
      viewToken: token,
      playbackUrl: urls ?? '',
      posterUrl: poster,
      durationSec,
      heartbeatSec: q.heartbeatSec,
      expiresAt: expiresAt.toISOString(),
      serverNow: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------- events
  private async lock(tx: Prisma.TransactionClient, viewId: string) {
    await tx.$queryRaw`SELECT "id" FROM "WatchView" WHERE "id" = ${viewId}::uuid FOR UPDATE`;
  }

  private authorise(
    v: { tokenHash: string; userId: string } | null,
    userId: string,
    token: string,
  ): asserts v is NonNullable<typeof v> {
    if (!v || v.userId !== userId) throw AppError.notFound();
    if (v.tokenHash !== hashToken(token))
      throw AppError.forbidden('This viewing session is not valid');
  }

  async events(
    userId: string,
    viewId: string,
    token: string,
    events: IncomingViewEvent[],
    now = new Date(),
  ): Promise<WatchEventsResult> {
    const q = await this.core.qualifying();
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, viewId);
      const v = await tx.watchView.findUnique({ where: { id: viewId } });
      this.authorise(v, userId, token);
      if (v.status !== 'STARTED')
        return { state: v.status, prompt: null, serverNow: now.toISOString() };
      const s = readSession(v.prompt);
      let pos = v.positionSec;
      let watched = v.watchedSeconds;
      let last = v.lastEventAt;
      let invalid: WatchReason | null = null;
      let prompt: WatchEventsResult['prompt'] = null;
      const sw = q.stillWatching;
      const deadlineMs = (sw.timeoutSec + sw.graceSec) * 1000;
      const log: Array<{
        type: string;
        positionSec: number;
        clientAt: bigint | null;
        data?: object;
      }> = [];

      if (now > v.expiresAt) invalid = 'SESSION_EXPIRED';

      for (const e of events) {
        if (invalid) break;
        log.push({
          type: e.type,
          positionSec: e.positionSec,
          clientAt: e.clientAt ? BigInt(e.clientAt) : null,
        });
        const promptOpen = !!s.issuedAt && !s.answeredAt;
        if (promptOpen && now.getTime() - new Date(s.issuedAt!).getTime() > deadlineMs) {
          invalid = 'STILL_WATCHING_FAILED';
          break;
        }
        switch (e.type) {
          case 'HEARTBEAT': {
            if (s.bgSince || promptOpen) {
              last = now;
              break;
            }
            const elapsed = Math.max(0, (now.getTime() - last.getTime()) / 1000);
            const delta = e.positionSec - pos;
            // Playback can never advance faster than real time: a jump (seek) or a stalled clock earns nothing.
            if (delta > 0 && delta <= elapsed * 1.5 + 1)
              watched = Math.min(
                v.durationSec,
                watched + Math.min(delta, elapsed + 0.5, q.heartbeatSec * 3),
              );
            pos = Math.max(pos, Math.min(e.positionSec, v.durationSec));
            last = now;
            if (
              v.stillWatchingNeeded &&
              s.atPositionSec !== null &&
              !s.issuedAt &&
              pos >= s.atPositionSec
            ) {
              s.id = newPromptId();
              s.issuedAt = now.toISOString();
              prompt = { id: s.id, deadlineSec: sw.timeoutSec };
              log.push({ type: 'PROMPT_ISSUED', positionSec: pos, clientAt: null });
            } else if (promptOpen && s.id) {
              prompt = { id: s.id, deadlineSec: sw.timeoutSec };
            }
            break;
          }
          case 'BACKGROUND':
            if (!s.bgSince) s.bgSince = now.toISOString();
            break;
          case 'FOREGROUND':
            if (s.bgSince) {
              if ((now.getTime() - new Date(s.bgSince).getTime()) / 1000 > q.resumeGraceSec)
                invalid = 'BACKGROUND_TIMEOUT';
              s.bgSince = null;
              last = now;
            }
            break;
          case 'PROMPT_ANSWERED':
            if (promptOpen && e.promptId && e.promptId === s.id) {
              s.answeredAt = now.toISOString();
              s.responseMs = now.getTime() - new Date(s.issuedAt!).getTime();
              s.passed = s.responseMs <= deadlineMs;
              if (!s.passed) invalid = 'STILL_WATCHING_FAILED';
              last = now;
            }
            break;
          default:
            break;
        }
      }
      // an issued prompt that stays unanswered past its deadline invalidates the view even without a later event
      if (
        !invalid &&
        s.issuedAt &&
        !s.answeredAt &&
        now.getTime() - new Date(s.issuedAt).getTime() > deadlineMs
      )
        invalid = 'STILL_WATCHING_FAILED';

      if (log.length) {
        const stored = await tx.watchViewEvent.count({ where: { viewId } });
        const room = Math.max(0, MAX_STORED_EVENTS - stored);
        await tx.watchViewEvent.createMany({
          data: log
            .filter((l) => l.type !== 'HEARTBEAT' || room > 0)
            .slice(0, Math.max(room, 40))
            .map((l) => ({
              viewId,
              type: l.type,
              positionSec: l.positionSec,
              clientAt: l.clientAt,
              serverAt: now,
            })),
        });
      }
      await tx.watchView.update({
        where: { id: viewId },
        data: {
          watchedSeconds: watched,
          positionSec: pos,
          lastEventAt: now,
          prompt: s as unknown as Prisma.InputJsonValue,
          ...(invalid ? { status: 'INVALID', reason: invalid, completedAt: null } : {}),
        },
      });
      return {
        state: invalid ? ('INVALID' as const) : ('STARTED' as const),
        prompt: invalid ? null : prompt,
        serverNow: now.toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------- completion
  async complete(
    userId: string,
    viewId: string,
    token: string,
    positionSec: number,
    now = new Date(),
  ): Promise<WatchOutcomeView> {
    const pending: NotificationInput[] = [];
    const after: Array<() => void> = [];
    // every configuration value is read BEFORE the transaction: nothing inside it needs a second database connection
    const [q, f, fraud, rule, rewardRules] = await Promise.all([
      this.core.qualifying(),
      this.core.frequency(),
      this.core.fraud(),
      this.core.rewardRule(),
      this.core.rewardsRules(),
    ]);
    await this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, viewId);
        const v = await tx.watchView.findUnique({ where: { id: viewId } });
        this.authorise(v, userId, token);
        if (v.status !== 'STARTED') return; // already decided: the stored outcome is returned below (idempotent)
        const c = await tx.watchCampaign.findUniqueOrThrow({ where: { id: v.campaignId } });
        const s = readSession(v.prompt);
        const reject = async (
          status: 'INVALID' | 'CAPPED',
          reason: WatchReason,
          extra: Prisma.WatchViewUncheckedUpdateInput = {},
        ) => {
          await tx.watchView.update({
            where: { id: viewId },
            data: { status, reason, completedAt: now, ...extra },
          });
          await tx.watchViewEvent.create({
            data: { viewId, type: 'ENDED', positionSec, serverAt: now },
          });
        };

        // final credit for the time since the last heartbeat (same rules as a heartbeat)
        let watched = v.watchedSeconds;
        let pos = v.positionSec;
        if (!s.bgSince && !(s.issuedAt && !s.answeredAt)) {
          const elapsed = Math.max(0, (now.getTime() - v.lastEventAt.getTime()) / 1000);
          const delta = positionSec - pos;
          if (delta > 0 && delta <= elapsed * 1.5 + 1)
            watched = Math.min(
              v.durationSec,
              watched + Math.min(delta, elapsed + 0.5, q.heartbeatSec * 3),
            );
          pos = Math.max(pos, Math.min(positionSec, v.durationSec));
        }
        const deadlineMs = (q.stillWatching.timeoutSec + q.stillWatching.graceSec) * 1000;

        if (now > new Date(v.expiresAt.getTime() + 5000))
          return reject('INVALID', 'SESSION_EXPIRED', {
            watchedSeconds: watched,
            positionSec: pos,
          });
        if (s.bgSince && (now.getTime() - new Date(s.bgSince).getTime()) / 1000 > q.resumeGraceSec)
          return reject('INVALID', 'BACKGROUND_TIMEOUT', {
            watchedSeconds: watched,
            positionSec: pos,
          });
        if (
          s.issuedAt &&
          !s.answeredAt &&
          now.getTime() - new Date(s.issuedAt).getTime() > deadlineMs
        )
          return reject('INVALID', 'STILL_WATCHING_FAILED', {
            watchedSeconds: watched,
            positionSec: pos,
          });
        if (v.stillWatchingNeeded && s.passed !== true)
          return reject('INVALID', s.issuedAt ? 'STILL_WATCHING_FAILED' : 'NOT_COMPLETED', {
            watchedSeconds: watched,
            positionSec: pos,
          });
        // enough REAL playback time (a small tolerance for heartbeat granularity, never for skipping)
        if (watched + 0.75 < v.requiredSeconds)
          return reject('INVALID', 'NOT_COMPLETED', { watchedSeconds: watched, positionSec: pos });
        if (c.status !== 'LIVE')
          return reject('INVALID', 'CAMPAIGN_UNAVAILABLE', {
            watchedSeconds: watched,
            positionSec: pos,
          });

        // limits are re-checked at the moment of qualification (not only at start)
        const earnedInWindow = await tx.watchView.count({
          where: {
            userId,
            campaignId: c.id,
            status: 'QUALIFIED',
            qualifiedAt: { gte: new Date(now.getTime() - c.repeatWindowHours * 3_600_000) },
          },
        });
        if (earnedInWindow >= f.maxQualifiedPerCustomerPerCampaign)
          return reject('INVALID', 'ALREADY_EARNED', { watchedSeconds: watched, positionSec: pos });
        const today = await tx.watchView.count({
          where: { userId, status: 'QUALIFIED', qualifiedAt: { gte: startOfRiyadhDay(now) } },
        });
        if (today >= f.customerDailyCap)
          return reject('CAPPED', 'DAILY_CAP', { watchedSeconds: watched, positionSec: pos });

        const assessment = await this.risk.assess(
          tx,
          { f, fraud },
          { ...v, watchedSeconds: watched, prompt: s },
          now,
          c.repeatWindowHours,
        );
        const riskData = {
          riskDecision: assessment.decision,
          riskScore: assessment.score,
          riskSignals: assessment.signals as unknown as Prisma.InputJsonValue,
          watchedSeconds: watched,
          positionSec: pos,
        };
        if (assessment.decision === 'BLOCK') {
          await reject('INVALID', 'RISK_BLOCKED', riskData);
          await this.risk.openFlag(tx, {
            ...assessment,
            userId,
            deviceHash: v.deviceHash,
            campaignId: c.id,
            viewId,
          });
          return;
        }

        // charge the merchant: ONE conditional update decides (never overspends, never exceeds the paid views)
        const spent = await this.funding.consume(tx, c, viewId, c.chargePerViewHalalas);
        if (!spent.ok) return reject('CAPPED', 'BUDGET_EXHAUSTED', riskData);

        const points = this.core.pointsFor(rule, v.durationSec);
        const held = assessment.decision !== 'ALLOW';
        const entry = await this.rewards.earnForView(
          tx,
          userId,
          viewId,
          points,
          held,
          now,
          rewardRules.expiryDays,
        );
        const claim = await tx.watchView.updateMany({
          where: { id: viewId, status: 'STARTED' },
          data: {
            status: 'QUALIFIED',
            qualifiedAt: now,
            completedAt: now,
            chargeHalalas: c.chargePerViewHalalas,
            consumptionJournalId: spent.journalId,
            rewardPoints: points,
            rewardState: entry ? (held ? 'HELD' : 'EARNED') : null,
            rewardEntryId: entry?.id ?? null,
            ...riskData,
          },
        });
        if (claim.count !== 1)
          throw new AppError('VERSION_CONFLICT', 'This view was already decided', 409);
        // the billable fact: the merchant is charged for this qualified view (usage + the billing hook Phase 5 consumes, once per view)
        await this.usage?.recordBillable(
          {
            organizationId: c.organizationId,
            metric: 'qualified_views',
            eventType: 'QUALIFIED_VIEW_USAGE',
            sourceType: 'VIEW',
            sourceId: viewId,
            product: 'WATCH',
            campaignId: c.id,
            unitRateMinor: c.chargePerViewHalalas,
            amountMinor: c.chargePerViewHalalas,
            currency: 'SAR',
            pricingVersionKey: await this.usage.campaignPricingKey('WATCH', c.id, tx),
            occurredAt: now,
          },
          tx,
        );
        // loyalty rules on a verified view (never on a held / flagged one: those wait for review and are not rewarded twice)
        if (!held)
          await this.loyalty?.issueForEvent(tx, {
            eventType: 'QUALIFIED_VIEW',
            userId,
            product: 'WATCH',
            campaignId: c.id,
            organizationId: c.organizationId,
            sourceType: 'VIEW',
            sourceId: viewId,
            now,
          });
        await tx.watchViewEvent.create({
          data: { viewId, type: 'QUALIFIED', positionSec: pos, serverAt: now },
        });
        if (assessment.decision === 'FLAG')
          await this.risk.openFlag(tx, {
            ...assessment,
            userId,
            deviceHash: v.deviceHash,
            campaignId: c.id,
            viewId,
            rewardEntryId: entry?.id ?? null,
          });
        if (spent.exhausted) {
          try {
            await this.core.transition(tx, c, 'COMPLETED', {
              action: 'COMPLETE',
              actor: null,
              reason: 'All paid views were delivered',
              data: { endedAt: now },
            });
            await this.funding.closeOut(tx, c, now);
            pending.push({
              userId:
                (
                  await tx.organizationMembership.findFirst({
                    where: { organizationId: c.organizationId, status: 'ACTIVE' },
                    orderBy: { createdAt: 'asc' },
                    select: { userId: true },
                  })
                )?.userId ?? userId,
              type: 'CAMPAIGN_COMPLETED',
              dedupeKey: `campaign-completed:${c.id}`,
              data: { campaignId: c.id, dealTitleEn: c.titleEn },
            });
          } catch {
            /* another transaction completed the campaign first */
          }
        }
        if (points > 0)
          pending.push({
            userId,
            type: held ? 'REWARD_HELD' : 'REWARD_EARNED',
            dedupeKey: `reward:${viewId}`,
            data: {
              points,
              viewId,
              campaignId: c.id,
              dealTitleEn: c.titleEn,
              dealTitleAr: c.titleAr,
            },
          });
        after.push(() => {
          void this.sink.track({
            name: 'watch.view_qualified',
            userId,
            organizationId: c.organizationId,
            timestamp: now.toISOString(),
            context: { app: 'customer' },
            properties: { campaignId: c.id },
          });
          if (points > 0)
            void this.sink.track({
              name: held ? 'reward.held' : 'reward.issued',
              userId,
              organizationId: c.organizationId,
              timestamp: now.toISOString(),
              context: { app: 'customer' },
              properties: { campaignId: c.id, points },
            });
        });
        if (pending.length) {
          const created = await this.notifications.emit(tx, pending);
          after.push(() => void this.notifications.dispatch(created));
        }
      },
      { timeout: 20_000, maxWait: 10_000 },
    );
    for (const fn of after) fn();
    return this.outcome(userId, viewId, now);
  }

  // ---------------------------------------------------------------- outcome (what the customer sees)
  async outcome(userId: string, viewId: string, now = new Date()): Promise<WatchOutcomeView> {
    const v = await this.prisma.watchView.findFirst({
      where: { id: viewId, userId },
      include: { campaign: true },
    });
    if (!v) throw AppError.notFound();
    const summary = await this.rewards.summary(userId, now);
    const balance = {
      availableBalance: summary.availableBalance,
      heldBalance: summary.heldBalance,
    };
    const content = this.core.content(v.campaign);
    if (v.status === 'QUALIFIED' || v.status === 'CREDITED_BACK') {
      const held = v.rewardState === 'HELD';
      return {
        viewId,
        outcome: held ? 'HELD' : 'QUALIFIED',
        state: v.status,
        reasonClass: null,
        reward:
          v.rewardPoints > 0 ? { points: v.rewardPoints, status: held ? 'HELD' : 'EARNED' } : null,
        balance,
        link: { type: content.link.type, id: content.link.id },
        serverNow: now.toISOString(),
      };
    }
    return {
      viewId,
      outcome: v.status === 'CAPPED' ? 'CAPPED' : 'NOT_QUALIFIED',
      state: v.status,
      reasonClass: reasonClassOf((v.reason ?? null) as WatchReason | null),
      reward: null,
      balance,
      link: null,
      serverNow: now.toISOString(),
    };
  }
}
