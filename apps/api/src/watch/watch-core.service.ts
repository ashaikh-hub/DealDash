import { Inject, Injectable } from '@nestjs/common';
import { CONFIG_KEYS } from '@dealdash/config';
import { canTransitionWatch, type WatchAction, type WatchStatus } from '@dealdash/types';
import {
  DEFAULT_WATCH_LIMITS,
  DEFAULT_WATCH_PRIZE_GUARDRAILS,
  type WatchPrizeGuardrails,
  type WatchBudget,
  type WatchContent,
  type WatchLimits,
} from '@dealdash/validation';
import type { Prisma } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppError } from '../common/errors';
import { CommercialService } from '../finance/commercial.service';
import { CampaignVersionService } from '../platform/campaign-version.service';
import type { Actor, RequestMeta } from '../common/request-context';
import { FilesService } from '../files/files.service';
import { AccessScopeService } from '../platform/access-scope.service';
import { MarketService } from '../platform/markets/market.service';
import { TenantService } from '../identity/tenant.service';
import { actorInfo, DealCoreService } from '../live-deals/deal-core.service';
import { EligibilityService } from '../live-deals/eligibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { STORAGE_PROVIDER, type StorageProvider } from '../providers/interfaces';
import { SystemConfigService } from '../system-config/system-config.service';
import {
  denormalizeWatch,
  mp4DurationSec,
  parseWatchContent,
  watchStatusAfterApproval,
} from './watch-content';

export const WATCH_INCLUDE = {
  organization: { include: { merchant: true } },
} satisfies Prisma.WatchCampaignInclude;
export type WatchRowData = Prisma.WatchCampaignGetPayload<{ include: typeof WATCH_INCLUDE }>;

/** Statuses in which the campaign was already approved (material changes are no longer possible). */
export const WATCH_APPROVED_STATUSES: readonly WatchStatus[] = [
  'SCHEDULED',
  'LIVE',
  'PAUSED',
  'SUSPENDED',
];

export interface WatchRecordInput {
  action: WatchAction;
  from?: WatchStatus | null;
  to?: WatchStatus | null;
  actor: Actor | null;
  reason?: string | null;
  reasonAr?: string | null;
  fields?: string[];
  snapshot?: unknown;
  meta?: RequestMeta | null;
}

export interface RateCard {
  chargePerViewHalalas: number;
  version: number;
  /** Currency of `chargePerViewHalalas` (the card was set in SAR before markets existed). */
  currency?: string;
  /** Market-specific rates in that market's own currency (minor units), e.g. { PK: { chargePerViewHalalas: 2500 } }. */
  markets?: Record<string, { chargePerViewHalalas: number; version?: number }>;
}
export interface RewardRule {
  version: number;
  tiers: Array<{ upToSec: number; points: number }>;
}
export interface StillWatching {
  mode: 'NEVER' | 'RANDOM' | 'ALWAYS';
  probability: number;
  minDurationSec: number;
  timeoutSec: number;
  graceSec: number;
}
export interface QualifyingPolicy {
  watchPct: number;
  watchSeconds: number | null;
  resumeGraceSec: number;
  heartbeatSec: number;
  maxSessionFactor: number;
  stillWatching: StillWatching;
}
export interface FrequencyPolicy {
  minRepeatWindowHours: number;
  maxQualifiedPerCustomerPerCampaign: number;
  customerDailyCap: number;
  deviceMaxAccounts: number;
  accountMaxDevices: number;
  maxConcurrentSessions: number;
}
export interface FraudPolicy {
  holdHours: number;
  thresholds: { hold: number; flag: number; block: number };
  newAccountHours: number;
  newAccountMaxViews: number;
  velocityWindowMinutes: number;
  velocityMaxStarts: number;
  minPromptResponseMs: number;
  regularityStdDevMs: number;
  dailyCapStreakDays: number;
}
export interface RewardsRules {
  expiryDays: number | null;
  expiryReminderDays: number;
  lifetimeBalanceCap: number | null;
  negativeBalancePolicy: 'ALLOW_NEGATIVE' | 'HOLD_AT_ZERO';
  adjustmentCheckerThresholdPoints: number;
}

const D = {
  rate: { chargePerViewHalalas: 100, version: 1 } as RateCard,
  reward: {
    version: 1,
    tiers: [
      { upToSec: 15, points: 10 },
      { upToSec: 30, points: 20 },
      { upToSec: 600, points: 30 },
    ],
  } as RewardRule,
  qualifying: {
    watchPct: 80,
    watchSeconds: null,
    resumeGraceSec: 10,
    heartbeatSec: 2,
    maxSessionFactor: 3,
    stillWatching: {
      mode: 'RANDOM',
      probability: 0.3,
      minDurationSec: 20,
      timeoutSec: 8,
      graceSec: 3,
    },
  } as QualifyingPolicy,
  frequency: {
    minRepeatWindowHours: 24,
    maxQualifiedPerCustomerPerCampaign: 1,
    customerDailyCap: 10,
    deviceMaxAccounts: 2,
    accountMaxDevices: 3,
    maxConcurrentSessions: 1,
  } as FrequencyPolicy,
  fraud: {
    holdHours: 24,
    thresholds: { hold: 30, flag: 60, block: 90 },
    newAccountHours: 24,
    newAccountMaxViews: 5,
    velocityWindowMinutes: 10,
    velocityMaxStarts: 8,
    minPromptResponseMs: 250,
    regularityStdDevMs: 15,
    dailyCapStreakDays: 3,
  } as FraudPolicy,
  rewards: {
    expiryDays: null,
    expiryReminderDays: 7,
    lifetimeBalanceCap: null,
    negativeBalancePolicy: 'ALLOW_NEGATIVE',
    adjustmentCheckerThresholdPoints: 100,
  } as RewardsRules,
};

/**
 * Shared domain operations for Watch & Earn: loading, reference checks, the state machine, history, audit and the platform rules.
 * Every platform rule is read from configuration (never hard-coded policy): the rate card, the reward rule, the qualifying
 * policy, frequency and fraud settings are DealDash-controlled, versioned and changeable without a deploy.
 */
@Injectable()
export class WatchCoreService {
  constructor(
    readonly prisma: PrismaService,
    readonly commercial: CommercialService,
    readonly versions: CampaignVersionService,
    readonly audit: AuditService,
    readonly config: SystemConfigService,
    private readonly tenant: TenantService,
    private readonly eligibility: EligibilityService,
    private readonly liveCore: DealCoreService,
    private readonly files: FilesService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    readonly access: AccessScopeService,
    readonly markets: MarketService,
  ) {}

  // ---------------------------------------------------------------- tenant scope
  requireMerchantScope(actor: Actor, organizationId: string) {
    this.tenant.requireOwnOrganization(actor, organizationId, 'MERCHANT');
    if (this.tenant.isBranchBound(actor)) throw AppError.forbidden();
  }

  // ---------------------------------------------------------------- loading
  async loadOwned(organizationId: string, id: string): Promise<WatchRowData> {
    const row = await this.prisma.watchCampaign.findFirst({
      where: { id, organizationId },
      include: WATCH_INCLUDE,
    });
    if (!row) throw AppError.notFound();
    return row;
  }
  async loadAny(id: string): Promise<WatchRowData> {
    const row = await this.prisma.watchCampaign.findUnique({
      where: { id },
      include: WATCH_INCLUDE,
    });
    if (!row) throw AppError.notFound();
    return row;
  }
  content(row: { content: unknown }): WatchContent {
    return parseWatchContent(row.content);
  }

  // ---------------------------------------------------------------- platform rules (configuration)
  enabledCities() {
    return this.liveCore.enabledCities();
  }
  /** City centres (configuration): distances are measured from here when the customer did not share a position. */
  cityCenters() {
    return this.liveCore.cityCenters();
  }
  async limits(): Promise<WatchLimits> {
    const l = (await this.config.get<Partial<WatchLimits>>(CONFIG_KEYS.WATCH_LIMITS)) ?? {};
    return { ...DEFAULT_WATCH_LIMITS, ...l };
  }
  async rateCard(): Promise<RateCard> {
    return {
      ...D.rate,
      ...((await this.config.get<Partial<RateCard>>(CONFIG_KEYS.WATCH_RATE_CARD)) ?? {}),
    };
  }
  /**
   * The rate card for a campaign's market, in that market's currency: the market's own rate when configured, else the base card ONLY
   * when it is already in the market's currency. Otherwise the campaign cannot be priced there yet (no conversion is ever made).
   */
  async rateCardFor(
    organizationId: string,
    content: unknown,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<RateCard & { currency: string; market: string }> {
    const card = await this.rateCard();
    const m = await this.markets.profileOfCampaign(organizationId, content, db);
    const own = card.markets?.[m.code];
    if (own)
      return {
        ...card,
        chargePerViewHalalas: own.chargePerViewHalalas,
        version: own.version ?? card.version,
        currency: m.currency,
        market: m.code,
      };
    if ((card.currency ?? 'SAR') === m.currency)
      return { ...card, currency: m.currency, market: m.code };
    throw new AppError(
      'PRICING_NOT_AVAILABLE',
      `No Watch & Earn rate card is configured for ${m.code} (${m.currency}): DealDash must set one before campaigns can be priced there`,
      409,
    );
  }
  async rewardRule(): Promise<RewardRule> {
    const r = (await this.config.get<Partial<RewardRule>>(CONFIG_KEYS.WATCH_REWARD_RULE)) ?? {};
    return {
      version: r.version ?? D.reward.version,
      tiers: r.tiers?.length ? r.tiers : D.reward.tiers,
    };
  }
  async qualifying(): Promise<QualifyingPolicy> {
    const q =
      (await this.config.get<Partial<QualifyingPolicy>>(CONFIG_KEYS.WATCH_QUALIFYING_POLICY)) ?? {};
    return {
      ...D.qualifying,
      ...q,
      stillWatching: { ...D.qualifying.stillWatching, ...(q.stillWatching ?? {}) },
    };
  }
  async frequency(): Promise<FrequencyPolicy> {
    return {
      ...D.frequency,
      ...((await this.config.get<Partial<FrequencyPolicy>>(CONFIG_KEYS.WATCH_FREQUENCY)) ?? {}),
    };
  }
  async fraud(): Promise<FraudPolicy> {
    const f = (await this.config.get<Partial<FraudPolicy>>(CONFIG_KEYS.WATCH_FRAUD)) ?? {};
    return { ...D.fraud, ...f, thresholds: { ...D.fraud.thresholds, ...(f.thresholds ?? {}) } };
  }
  async rewardsRules(): Promise<RewardsRules> {
    return {
      ...D.rewards,
      ...((await this.config.get<Partial<RewardsRules>>(CONFIG_KEYS.REWARDS_RULES)) ?? {}),
    };
  }
  async unusedTreatment(): Promise<string> {
    return (
      (await this.config.get<string>(CONFIG_KEYS.WATCH_UNUSED_BUDGET_TREATMENT)) ??
      'UNDECIDED_VALIDATE_KSA'
    );
  }
  /** Instant-prize guardrails (FDR-19): DealDash's limits on what a merchant may configure. */
  async prizeGuardrails(): Promise<WatchPrizeGuardrails> {
    return {
      ...DEFAULT_WATCH_PRIZE_GUARDRAILS,
      ...((await this.config.get<Partial<WatchPrizeGuardrails>>(
        CONFIG_KEYS.WATCH_PRIZE_GUARDRAILS,
      )) ?? {}),
    };
  }
  async reviewAbovePaidViews(): Promise<number> {
    const g = await this.config.get<{ reviewAbovePaidViews?: number }>(
      CONFIG_KEYS.WATCH_GUARDRAILS,
    );
    return g?.reviewAbovePaidViews ?? 5000;
  }

  /** Points DealDash awards for a qualified view of a video of this length (the merchant never sets this). */
  pointsFor(rule: RewardRule, durationSec: number): number {
    const tiers = [...rule.tiers].sort((a, b) => a.upToSec - b.upToSec);
    return (tiers.find((t) => durationSec <= t.upToSec) ?? tiers[tiers.length - 1])?.points ?? 0;
  }
  /** Seconds that must really be watched for a video of this length. */
  requiredSeconds(p: QualifyingPolicy, durationSec: number): number {
    if (p.watchSeconds) return Math.min(durationSec, Math.max(1, Math.round(p.watchSeconds)));
    return Math.max(1, Math.ceil((durationSec * p.watchPct) / 100));
  }
  /** The effective repeat window: the merchant may only be equal or stricter than the platform minimum. */
  async repeatWindowHours(c: WatchContent): Promise<number> {
    const f = await this.frequency();
    return Math.max(f.minRepeatWindowHours, c.frequency.repeatWindowHours ?? 0);
  }

  // ---------------------------------------------------------------- budget
  async budgetOf(
    v: {
      paidViews: number;
      qualifiedViews: number;
      chargePerViewHalalas: number;
      requiredBudgetHalalas: number;
      fundedHalalas: number;
      spentHalalas: number;
      unusedHalalas: number;
      closedOutAt: Date | null;
      currency: string;
    },
    rate?: RateCard,
  ): Promise<WatchBudget> {
    const r = rate ?? (await this.rateCard());
    const charge = v.chargePerViewHalalas || r.chargePerViewHalalas;
    const required = v.requiredBudgetHalalas || v.paidViews * charge;
    return {
      currency: v.currency,
      paidViews: v.paidViews,
      qualifiedViews: v.qualifiedViews,
      remainingViews: Math.max(0, v.paidViews - v.qualifiedViews),
      chargePerViewHalalas: charge,
      requiredHalalas: required,
      fundedHalalas: v.fundedHalalas,
      spentHalalas: v.spentHalalas,
      remainingHalalas: Math.max(0, v.fundedHalalas - v.spentHalalas - v.unusedHalalas),
      unusedHalalas: v.unusedHalalas,
      closedOut: !!v.closedOutAt,
      unusedTreatment: await this.unusedTreatment(),
      fundingRequired: v.fundedHalalas < required,
    };
  }

  // ---------------------------------------------------------------- validation of references (tenant safe)
  async validateReferences(organizationId: string, c: WatchContent): Promise<WatchContent> {
    if (c.startAt && c.endAt && new Date(c.endAt).getTime() <= new Date(c.startAt).getTime())
      throw AppError.validation('The end must be after the start', 'endAt');
    let out = c;
    if (c.videoFileId) {
      const f = await this.prisma.storedFile.findFirst({
        where: { id: c.videoFileId, organizationId, kind: 'WATCH_VIDEO', status: 'AVAILABLE' },
      });
      if (!f)
        throw AppError.validation('The video is not available. Upload it again.', 'videoFileId');
      // The server's reading of an MP4 header wins over what the browser declared.
      if (f.mimeType === 'video/mp4' && (f.sizeBytes ?? 0) <= 64 * 1024 * 1024) {
        const data = await this.storage.read(f.storageKey, 64 * 1024 * 1024);
        const secs = data ? mp4DurationSec(data) : null;
        if (secs && secs > 0 && secs !== c.durationSec) out = { ...out, durationSec: secs };
      }
    }
    if (c.thumbnailFileId) {
      const ok = await this.prisma.storedFile.count({
        where: { id: c.thumbnailFileId, organizationId, kind: 'DEAL_IMAGE', status: 'AVAILABLE' },
      });
      if (!ok)
        throw AppError.validation(
          'The cover image is not available. Upload it again.',
          'thumbnailFileId',
        );
    }
    if (c.targeting.branchIds.length) {
      const n = await this.prisma.merchantBranch.count({
        where: { id: { in: c.targeting.branchIds }, organizationId },
      });
      if (n !== new Set(c.targeting.branchIds).size)
        throw AppError.validation('Choose branches of your own business', 'targeting.branchIds');
    }
    const cities = await this.enabledCities();
    const bad = c.targeting.cities.filter(
      (x) => !cities.some((e) => e.trim().toLowerCase() === x.trim().toLowerCase()),
    );
    if (bad.length)
      throw AppError.validation(`City is not enabled: ${bad.join(', ')}`, 'targeting.cities');
    await this.eligibility.validateReferences(c.targeting.eligibility, cities);
    // A link must point at the merchant's OWN offer (never another business's).
    const { type, id } = c.link;
    if (type !== 'NONE' && type !== 'MERCHANT' && id) {
      const own =
        type === 'LIVE_DEAL'
          ? await this.prisma.liveDeal.count({ where: { id, organizationId } })
          : type === 'HOT_DEAL'
            ? await this.prisma.hotDeal.count({ where: { id, organizationId } })
            : await this.prisma.voucher.count({ where: { id, organizationId } });
      if (!own) throw AppError.validation('Choose one of your own offers', 'link');
    }
    return out;
  }

  async merchantTrust(organizationId: string) {
    const m = await this.prisma.merchant.findUnique({ where: { organizationId } });
    return m?.trustLevel ?? 'NEW';
  }

  // ---------------------------------------------------------------- history + audit
  async record(
    tx: Prisma.TransactionClient,
    campaign: { id: string; organizationId: string },
    e: WatchRecordInput,
  ) {
    const info = actorInfo(e.actor);
    await tx.watchCampaignHistory.create({
      data: {
        campaignId: campaign.id,
        action: e.action,
        fromStatus: e.from ?? null,
        toStatus: e.to ?? null,
        reason: e.reason ?? null,
        reasonAr: e.reasonAr ?? null,
        fields: (e.fields ?? []) as Prisma.InputJsonValue,
        actorUserId: info.userId,
        actorRole: info.role,
        actorName: info.name,
        byDealDash: info.byDealDash,
        snapshot: (e.snapshot ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    await this.audit.record(
      {
        action: `watch.${e.action.toLowerCase()}`,
        entityType: 'WatchCampaign',
        entityId: campaign.id,
        reason: e.reason ?? null,
        previousState: e.from ? { status: e.from } : undefined,
        newState: e.to ? { status: e.to } : undefined,
        actor: e.actor,
        actorRole: e.actor ? undefined : 'SYSTEM',
        subjectOrganizationId: campaign.organizationId,
        meta: e.meta ?? null,
      },
      tx,
    );
  }

  /** The ONLY way a campaign changes status on purpose. Illegal transitions are rejected; a concurrent change is detected. */
  async transition(
    tx: Prisma.TransactionClient,
    campaign: { id: string; organizationId: string; status: WatchStatus },
    to: WatchStatus,
    e: Omit<WatchRecordInput, 'from' | 'to'> & {
      data?: Prisma.WatchCampaignUncheckedUpdateManyInput;
    },
  ) {
    if (!canTransitionWatch(campaign.status, to))
      throw new AppError('INVALID_STATE', `A ${campaign.status} campaign cannot become ${to}`, 409);
    const { data, ...rest } = e;
    const res = await tx.watchCampaign.updateMany({
      where: { id: campaign.id, status: campaign.status },
      data: {
        ...(data ?? {}),
        status: to,
        updatedByUserId: e.actor?.userId ?? null,
        version: { increment: 1 },
      },
    });
    if (res.count !== 1)
      throw new AppError('VERSION_CONFLICT', 'The campaign changed. Reload and try again.', 409);
    await this.record(tx, campaign, { ...rest, from: campaign.status, to });
  }

  // ---------------------------------------------------------------- content
  async applyContent(
    tx: Prisma.TransactionClient,
    campaign: { id: string; organizationId: string; status: WatchStatus; version: number },
    content: WatchContent,
    userId: string | null,
    opts: { bumpVersion?: boolean } = {},
  ) {
    const editable = campaign.status === 'DRAFT' || campaign.status === 'NEEDS_CHANGES';
    // priced in the campaign's market currency while editable; afterwards the stored rate and currency are what was quoted
    const rate = editable
      ? await this.rateCardFor(campaign.organizationId, content, tx)
      : await this.rateCard();
    // The budget is derived from the paid views and the rate card; it can only be re-priced while the campaign is editable.
    const money = editable
      ? {
          chargePerViewHalalas: rate.chargePerViewHalalas,
          rateCardVersion: rate.version,
          requiredBudgetHalalas: content.paidViews * rate.chargePerViewHalalas,
          currency: (rate as { currency: string }).currency,
        }
      : {};
    await tx.watchCampaign.update({
      where: { id: campaign.id },
      data: {
        content: content as unknown as Prisma.InputJsonValue,
        ...denormalizeWatch(content),

        ...money,
        repeatWindowHours: await this.repeatWindowHours(content),
        ...(opts.bumpVersion === false ? {} : { version: { increment: 1 } }),
        updatedByUserId: userId,
      },
    });
  }

  /** Approval (admin decisions and guardrail auto-publish). Funding must cover the whole budget first (no unfunded campaigns). */
  async approve(
    tx: Prisma.TransactionClient,
    c: WatchRowData,
    e: {
      action: 'APPROVE' | 'AUTO_APPROVE';
      actor: Actor | null;
      reason?: string | null;
      reasonAr?: string | null;
      meta?: RequestMeta | null;
    },
    now = new Date(),
  ) {
    if (c.fundedHalalas < c.requiredBudgetHalalas)
      throw new AppError('FUNDING_REQUIRED', 'The campaign budget is not fully funded', 409);
    const to = watchStatusAfterApproval(c.startAt, c.endAt, now);
    await this.transition(tx, c, to, {
      ...e,
      data: { publishedAt: c.publishedAt ?? now, pausedBy: null },
    });
    await this.commercial.earnUpfront('WATCH', c.id, tx);
    await this.versions.recordLive(tx, {
      product: 'WATCH',
      subjectId: c.id,
      organizationId: c.organizationId,
      content: c.content,
      reason: 'APPROVED',
      userId: e.actor?.userId ?? null,
      now,
    });
    return to;
  }

  /** Video playback URL for a signed-in viewer (short-lived; private storage). */
  async playbackUrl(fileId: string, seconds: number): Promise<string | null> {
    const m = await this.files.signedUrls([fileId], seconds);
    return m.get(fileId) ?? null;
  }
}
