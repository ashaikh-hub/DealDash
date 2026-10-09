import { z } from 'zod';
import {
  REWARD_ADJUSTMENT_STATUSES,
  REWARD_BUCKETS,
  REWARD_ENTRY_TYPES,
  REWARD_ITEM_STATUSES,
  RISK_DECISIONS,
  RISK_FLAG_STATUSES,
  RISK_REVIEW_OUTCOMES,
  RISK_SIGNALS,
  WATCH_ACTIONS,
  WATCH_EVENT_TYPES,
  WATCH_FUNDING_SOURCES,
  WATCH_LINK_TYPES,
  WATCH_OUTCOMES,
  WATCH_REASON_CLASSES,
  WATCH_STATUSES,
  WATCH_VIEW_STATUSES,
} from '@dealdash/types';
import { dealEligibilitySchema, eligibilityViewSchema } from './deals';

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const bi = (max: number) =>
  z
    .object({
      en: z.string().trim().max(max).default(''),
      ar: z.string().trim().max(max).default(''),
    })
    .default({ en: '', ar: '' });
const biText = z.object({ en: z.string(), ar: z.string() });

// ------------------------------------------------------------------ campaign content (what the merchant writes and DealDash reviews)
/**
 * NOTE: there is deliberately NO reward-amount field. The customer reward is DealDash's alone (WE-01); the merchant buys
 * paid qualifying views and may only set repeat-view rules that are equal to or stricter than the platform minimum.
 */
export const watchContentSchema = z.object({
  title: bi(80),
  description: bi(300),
  ctaLabel: bi(30),
  link: z
    .object({ type: z.enum(WATCH_LINK_TYPES).default('NONE'), id: uuid.nullable().default(null) })
    .default({ type: 'NONE', id: null }),
  videoFileId: uuid.nullable().default(null),
  thumbnailFileId: uuid.nullable().default(null),
  /** Video length in seconds, read from the file when it is uploaded; qualification thresholds are derived from it. */
  durationSec: z.number().int().min(1).max(600).nullable().default(null),
  startAt: isoDate.nullable().default(null),
  endAt: isoDate.nullable().default(null),
  targeting: z
    .object({
      cities: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
      eligibility: dealEligibilitySchema.default({ kind: 'PUBLIC', valueRefs: [], expression: null }),
      /** Riyadh wall-clock hours (0-24) when the campaign is served; null = all day. */
      timeWindow: z
        .object({
          startHour: z.number().int().min(0).max(23),
          endHour: z.number().int().min(1).max(24),
        })
        .nullable()
        .default(null),
      /** Optional: serve customers near these branches' city only (geography detail); empty = whole city. */
      branchIds: z.array(uuid).max(50).default([]),
    })
    .default(() => ({
      cities: [],
      eligibility: { kind: 'PUBLIC' as const, valueRefs: [], expression: null },
      timeWindow: null,
      branchIds: [],
    })),
  /** Merchant may only be equal or stricter than the platform minimum repeat-view window (WE-03). Null = platform minimum. */
  frequency: z
    .object({ repeatWindowHours: z.number().int().min(1).max(720).nullable().default(null) })
    .default({ repeatWindowHours: null }),
  /** Number of PAID qualifying views the merchant buys. The budget is this x the DealDash rate card. */
  paidViews: z.number().int().min(0).max(1_000_000).default(0),
});
export type WatchContent = z.infer<typeof watchContentSchema>;
export const emptyWatchContent = (): WatchContent => watchContentSchema.parse({});

export interface WatchLimits {
  minDurationSec: number;
  maxDurationSec: number;
  maxVideoBytes: number;
  minPaidViews: number;
  maxPaidViews: number;
  maxCampaignDays: number;
}
export const DEFAULT_WATCH_LIMITS: WatchLimits = {
  minDurationSec: 5,
  maxDurationSec: 60,
  maxVideoBytes: 50 * 1024 * 1024,
  minPaidViews: 10,
  maxPaidViews: 100_000,
  maxCampaignDays: 90,
};

export interface WatchIssue {
  field: string;
  code:
    | 'REQUIRED'
    | 'REQUIRED_EN'
    | 'REQUIRED_AR'
    | 'VALUE_RANGE'
    | 'IN_PAST'
    | 'END_BEFORE_START'
    | 'DURATION_RANGE'
    | 'VIEWS_RANGE'
    | 'FREQUENCY_LOOSER'
    | 'PERIOD_TOO_LONG';
}

/** Completeness and platform limits. Pure and shared: the builder shows these live; the API refuses to submit with any. */
export function watchIssues(
  c: WatchContent,
  o: { now?: Date; limits?: WatchLimits; minRepeatWindowHours?: number } = {},
): WatchIssue[] {
  const limits = o.limits ?? DEFAULT_WATCH_LIMITS;
  const out: WatchIssue[] = [];
  const bilingual = (field: string, v: { en: string; ar: string }) => {
    if (!v.en.trim()) out.push({ field, code: 'REQUIRED_EN' });
    if (!v.ar.trim()) out.push({ field, code: 'REQUIRED_AR' });
  };
  bilingual('title', c.title);
  bilingual('description', c.description);
  bilingual('ctaLabel', c.ctaLabel);
  if (!c.videoFileId) out.push({ field: 'videoFileId', code: 'REQUIRED' });
  if (c.durationSec === null) out.push({ field: 'durationSec', code: 'REQUIRED' });
  else if (c.durationSec < limits.minDurationSec || c.durationSec > limits.maxDurationSec)
    out.push({ field: 'durationSec', code: 'DURATION_RANGE' });
  if (!c.startAt) out.push({ field: 'startAt', code: 'REQUIRED' });
  if (!c.endAt) out.push({ field: 'endAt', code: 'REQUIRED' });
  if (c.startAt && c.endAt) {
    const s = new Date(c.startAt).getTime();
    const e = new Date(c.endAt).getTime();
    if (e <= s) out.push({ field: 'endAt', code: 'END_BEFORE_START' });
    else if (e - s > limits.maxCampaignDays * 86_400_000)
      out.push({ field: 'endAt', code: 'PERIOD_TOO_LONG' });
  }
  if (c.endAt && o.now && new Date(c.endAt).getTime() <= o.now.getTime())
    out.push({ field: 'endAt', code: 'IN_PAST' });
  if (c.targeting.cities.length < 1) out.push({ field: 'targeting.cities', code: 'REQUIRED' });
  if (c.link.type !== 'NONE' && c.link.type !== 'MERCHANT' && !c.link.id)
    out.push({ field: 'link', code: 'REQUIRED' });
  if (c.paidViews < limits.minPaidViews || c.paidViews > limits.maxPaidViews)
    out.push({ field: 'paidViews', code: 'VIEWS_RANGE' });
  if (
    c.frequency.repeatWindowHours !== null &&
    o.minRepeatWindowHours !== undefined &&
    c.frequency.repeatWindowHours < o.minRepeatWindowHours
  )
    out.push({ field: 'frequency.repeatWindowHours', code: 'FREQUENCY_LOOSER' });
  return out;
}

export function watchTranslationStatus(c: WatchContent) {
  const missing: Array<'en' | 'ar'> = [];
  for (const lang of ['en', 'ar'] as const)
    if (!c.title[lang].trim() || !c.description[lang].trim() || !c.ctaLabel[lang].trim())
      missing.push(lang);
  return { complete: missing.length === 0, missing };
}

/** Fields whose change after approval needs a new review. Wording of the title/description is minor. */
export function watchMaterialChanges(before: WatchContent, after: WatchContent): string[] {
  const out: string[] = [];
  const diff = (k: string, a: unknown, b: unknown) =>
    JSON.stringify(a) !== JSON.stringify(b) && out.push(k);
  diff('videoFileId', before.videoFileId, after.videoFileId);
  diff('link', before.link, after.link);
  diff('targeting', before.targeting, after.targeting);
  diff('startAt', before.startAt, after.startAt);
  diff('endAt', before.endAt, after.endAt);
  diff('frequency', before.frequency, after.frequency);
  diff('paidViews', before.paidViews, after.paidViews);
  return out;
}

// ------------------------------------------------------------------ requests
export const watchCreateSchema = z.object({ content: watchContentSchema });
export const watchSaveSchema = z.object({
  content: watchContentSchema,
  expectedVersion: z.number().int().min(1).optional(),
});
export const watchListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(WATCH_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});
export const watchFundSchema = z.object({
  amountHalalas: z.number().int().min(100).max(1_000_000_000),
});
export const watchPauseSchema = z.object({ reason: z.string().trim().min(3).max(300).optional() });
export const watchCancelSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const watchDecisionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  reasonAr: z.string().trim().max(500).optional(),
  fields: z.array(z.string().max(80)).max(30).optional(),
});
export const adminWatchListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(WATCH_STATUSES).optional(),
  queue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  merchantId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
});
export const adminCreditSchema = z.object({
  amountHalalas: z.number().int().min(100).max(1_000_000_000),
  reason: z.string().trim().min(3).max(300),
});

// customer
export const watchHubQuerySchema = z.object({
  city: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const watchViewStartSchema = z.object({
  campaignId: uuid,
  /** Random id the app generates and keeps on this device (no fingerprinting). */
  deviceId: z.string().trim().min(8).max(80),
  city: z.string().trim().max(40).optional(),
});
export const watchEventSchema = z.object({
  type: z.enum(WATCH_EVENT_TYPES),
  positionSec: z.number().min(0).max(36_000),
  /** Client clock (milliseconds since the epoch). Never trusted: the server stamps its own time. */
  clientAt: z.number().int().optional(),
  promptId: z.string().max(40).optional(),
});
export const watchEventsSchema = z.object({ events: z.array(watchEventSchema).min(1).max(40) });
export const watchCompleteSchema = z.object({ positionSec: z.number().min(0).max(36_000) });
export const rewardActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
  type: z.enum(REWARD_ENTRY_TYPES).optional(),
});
export const rewardRedeemSchema = z.object({ itemId: uuid });

// admin: risk and rewards
export const riskFlagListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
  status: z.enum(RISK_FLAG_STATUSES).optional(),
  decision: z.enum(RISK_DECISIONS).optional(),
});
export const riskDecisionSchema = z.object({
  outcome: z.enum(RISK_REVIEW_OUTCOMES),
  reason: z.string().trim().min(3).max(500),
});
export const rewardAccountSearchSchema = z.object({
  q: z.string().trim().min(3).max(60),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const rewardLedgerQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(200).optional(),
  userId: uuid.optional(),
  type: z.enum(REWARD_ENTRY_TYPES).optional(),
});
export const rewardAdjustmentCreateSchema = z.object({
  userId: uuid,
  /** Signed points: positive credits, negative debits. */
  points: z
    .number()
    .int()
    .min(-100_000)
    .max(100_000)
    .refine((n) => n !== 0, 'points must not be zero'),
  reasonCode: z.string().trim().min(2).max(40),
  ticketRef: z.string().trim().min(2).max(60),
  reason: z.string().trim().min(3).max(500),
});
export const rewardAdjustmentDecisionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export const rewardAdjustmentListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(REWARD_ADJUSTMENT_STATUSES).optional(),
});
export const rewardItemSaveSchema = z.object({
  name: z.object({ en: z.string().trim().min(1).max(80), ar: z.string().trim().min(1).max(80) }),
  description: z.object({
    en: z.string().trim().max(300).default(''),
    ar: z.string().trim().max(300).default(''),
  }),
  pointsCost: z.number().int().min(1).max(10_000_000),
  /** Null = unlimited stock. */
  stock: z.number().int().min(0).max(1_000_000).nullable().default(null),
  status: z.enum(REWARD_ITEM_STATUSES).default('ACTIVE'),
  validityDays: z.number().int().min(1).max(3650).nullable().default(null),
  isSample: z.boolean().default(false),
});

// ------------------------------------------------------------------ responses
export const watchBudgetSchema = z.object({
  paidViews: z.number().int(),
  qualifiedViews: z.number().int(),
  remainingViews: z.number().int(),
  /** Charge per paid qualifying view in halalas (DealDash rate card snapshot; configurable, not a final price). */
  chargePerViewHalalas: z.number().int(),
  requiredHalalas: z.number().int(),
  fundedHalalas: z.number().int(),
  spentHalalas: z.number().int(),
  remainingHalalas: z.number().int(),
  /** Budget released at close-out: separately identifiable; its treatment is configurable / VALIDATE-KSA. */
  unusedHalalas: z.number().int(),
  closedOut: z.boolean(),
  unusedTreatment: z.string(),
  fundingRequired: z.boolean(),
});
export type WatchBudget = z.infer<typeof watchBudgetSchema>;

export const watchViewSchema = z.object({
  id: uuid,
  organizationId: uuid,
  status: z.enum(WATCH_STATUSES),
  version: z.number().int(),
  content: watchContentSchema,
  videoUrl: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  budget: watchBudgetSchema,
  pausedBy: z.enum(['MERCHANT', 'DEALDASH']).nullable(),
  submittedAt: z.string().nullable(),
  publishedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  translation: z.object({ complete: z.boolean(), missing: z.array(z.enum(['en', 'ar'])) }),
  issues: z.array(z.object({ field: z.string(), code: z.string() })),
  guardrail: z.object({
    outcome: z.enum(['AUTO_PUBLISH', 'MANUAL_REVIEW']),
    reasons: z.array(z.string()),
  }),
  latestDecision: z
    .object({
      id: uuid,
      action: z.enum(WATCH_ACTIONS),
      reason: z.string().nullable(),
      reasonAr: z.string().nullable(),
      fields: z.array(z.string()),
      actorRole: z.string().nullable(),
      actorName: z.string().nullable(),
      byDealDash: z.boolean(),
      createdAt: z.string(),
    })
    .nullable(),
  allowedActions: z.array(z.string()),
  serverNow: z.string(),
});
export type WatchCampaignView = z.infer<typeof watchViewSchema>;

export const watchRowSchema = z.object({
  id: uuid,
  status: z.enum(WATCH_STATUSES),
  title: biText,
  paidViews: z.number().int(),
  qualifiedViews: z.number().int(),
  fundedHalalas: z.number().int(),
  spentHalalas: z.number().int(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  thumbnailUrl: z.string().nullable(),
  updatedAt: z.string(),
});
export type WatchRow = z.infer<typeof watchRowSchema>;

export const watchSaveResultSchema = z.object({
  campaign: watchViewSchema,
  outcome: z.enum(['SAVED', 'APPLIED_MINOR']),
});
export const watchSubmitResultSchema = z.object({
  campaign: watchViewSchema,
  outcome: z.enum(['SENT_FOR_REVIEW', 'PUBLISHED', 'SCHEDULED']),
});

export const watchFundingRowSchema = z.object({
  id: uuid,
  amountHalalas: z.number().int(),
  source: z.enum(WATCH_FUNDING_SOURCES),
  reference: z.string(),
  createdAt: z.string(),
  byName: z.string().nullable(),
});
export const watchBudgetDetailSchema = z.object({
  budget: watchBudgetSchema,
  funding: z.array(watchFundingRowSchema),
  /** Ledger view of this campaign's money (journal types, newest first). */
  journals: z.array(
    z.object({
      id: uuid,
      type: z.string(),
      postedAt: z.string(),
      amountHalalas: z.number().int(),
      memo: z.string().nullable(),
    }),
  ),
  disclaimerKey: z.literal('legal_treatment_validate_ksa'),
});

export const watchMonitorSchema = z.object({
  status: z.enum(WATCH_STATUSES),
  serverNow: z.string(),
  budget: watchBudgetSchema,
  delivery: z.object({
    paidViews: z.number().int(),
    qualifiedViews: z.number().int(),
    remainingViews: z.number().int(),
    pct: z.number(),
    /** Share of the schedule elapsed, to compare pace with delivery. */
    schedulePct: z.number().nullable(),
  }),
  funnel: z.object({
    impressions: z.number().int(),
    opened: z.number().int(),
    started: z.number().int(),
    completed: z.number().int(),
    qualified: z.number().int(),
    invalid: z.number().int(),
    capped: z.number().int(),
    /** Invalid views by category only: never customer identities and never the detection logic. */
    invalidByCategory: z.record(z.string(), z.number().int()),
    ctaClicks: z.number().int(),
  }),
  reach: z.object({ uniqueViewers: z.number().int(), averageFrequency: z.number() }),
  completionRatePct: z.number().nullable(),
  /** Spend per qualified view where views exist (verified spend only). */
  costPerQualifiedViewHalalas: z.number().int().nullable(),
  rewards: z.object({
    rewardedViews: z.number().int(),
    pointsIssued: z.number().int(),
    heldViews: z.number().int(),
  }),
  disclaimerKey: z.literal('views_and_verified_spend_only'),
});
export type WatchMonitor = z.infer<typeof watchMonitorSchema>;

export const watchOptionsSchema = z.object({
  limits: z.object({
    minDurationSec: z.number(),
    maxDurationSec: z.number(),
    maxVideoBytes: z.number(),
    minPaidViews: z.number(),
    maxPaidViews: z.number(),
    maxCampaignDays: z.number(),
  }),
  rateCard: z.object({
    chargePerViewHalalas: z.number().int(),
    version: z.number().int(),
    placeholder: z.literal(true),
  }),
  minRepeatWindowHours: z.number().int(),
  cities: z.array(z.string()),
  unusedBudgetTreatment: z.string(),
});

// ---- customer
export const watchCardSchema = z.object({
  id: uuid,
  merchantId: uuid,
  merchantName: biText,
  merchantLogoUrl: z.string().nullable(),
  title: biText,
  description: biText,
  thumbnailUrl: z.string().nullable(),
  durationSec: z.number().int(),
  /** Indicative reward from DealDash's rule (points only, never a SAR value). */
  rewardPoints: z.number().int(),
  availability: z.enum([
    'AVAILABLE',
    'ALREADY_EARNED',
    'DAILY_CAP',
    'BUDGET_EXHAUSTED',
    'ENDED',
    'NOT_ELIGIBLE',
    'UNAVAILABLE',
  ]),
  /** When the customer can earn from this video again (already earned) or when the daily cap resets. */
  availableAgainAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  distanceMeters: z.number().nullable(),
  eligibility: eligibilityViewSchema,
  serverNow: z.string(),
});
export type WatchCard = z.infer<typeof watchCardSchema>;

export const watchDetailSchema = watchCardSchema.extend({
  ctaLabel: biText,
  link: z.object({ type: z.enum(WATCH_LINK_TYPES), id: uuid.nullable(), label: biText.nullable() }),
  canStart: z.boolean(),
  /** "Sponsored by <merchant>" disclosure (wording subject to VALIDATE-KSA). */
  sponsored: z.literal(true),
});
export type WatchDetail = z.infer<typeof watchDetailSchema>;

export const watchHubSchema = z.object({
  campaigns: z.array(watchCardSchema),
  daily: z.object({ earnedViews: z.number().int(), cap: z.number().int(), resetsAt: z.string() }),
  balance: z.object({ availableBalance: z.number().int(), heldBalance: z.number().int() }),
  serverNow: z.string(),
});

export const watchViewStartedSchema = z.object({
  viewId: uuid,
  viewToken: z.string(),
  playbackUrl: z.string(),
  posterUrl: z.string().nullable(),
  durationSec: z.number().int(),
  /** How often the player sends heartbeats. The thresholds themselves are never sent to the client. */
  heartbeatSec: z.number().int(),
  expiresAt: z.string(),
  serverNow: z.string(),
});
export const watchEventsResultSchema = z.object({
  state: z.enum(WATCH_VIEW_STATUSES),
  /** A still-watching prompt the player must show now (scheduled by the server), or null. */
  prompt: z.object({ id: z.string(), deadlineSec: z.number().int() }).nullable(),
  serverNow: z.string(),
});
export const watchOutcomeSchema = z.object({
  viewId: uuid,
  outcome: z.enum(WATCH_OUTCOMES),
  state: z.enum(WATCH_VIEW_STATUSES),
  reasonClass: z.enum(WATCH_REASON_CLASSES).nullable(),
  reward: z.object({ points: z.number().int(), status: z.enum(['EARNED', 'HELD']) }).nullable(),
  balance: z
    .object({ availableBalance: z.number().int(), heldBalance: z.number().int() })
    .nullable(),
  /** After a qualified view: where the campaign link leads (own merchant offers only). */
  link: z.object({ type: z.enum(WATCH_LINK_TYPES), id: uuid.nullable() }).nullable(),
  serverNow: z.string(),
});
export type WatchOutcomeView = z.infer<typeof watchOutcomeSchema>;

export const rewardSummarySchema = z.object({
  availableBalance: z.number().int(),
  heldBalance: z.number().int(),
  lifetimeEarned: z.number().int(),
  lifetimeRedeemed: z.number().int(),
  expiringSoon: z.object({ points: z.number().int(), at: z.string() }).nullable(),
  /** Always false in the MVP: points are not cash, not withdrawable, not transferable. */
  cashValueShown: z.literal(false),
  catalogueCount: z.number().int(),
});
export type RewardSummary = z.infer<typeof rewardSummarySchema>;

export const rewardEntryViewSchema = z.object({
  id: uuid,
  type: z.enum(REWARD_ENTRY_TYPES),
  /** Signed points in the bucket named by `bucket`. */
  points: z.number().int(),
  bucket: z.enum(REWARD_BUCKETS),
  balanceAfter: z.number().int(),
  sourceType: z.string(),
  title: biText.nullable(),
  merchantName: biText.nullable(),
  reasonClass: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type RewardEntryView = z.infer<typeof rewardEntryViewSchema>;

export const rewardItemViewSchema = z.object({
  id: uuid,
  name: biText,
  description: biText,
  pointsCost: z.number().int(),
  stockLeft: z.number().int().nullable(),
  isSample: z.boolean(),
  canRedeem: z.boolean(),
});
export const rewardRedeemedSchema = z.object({
  redemptionId: uuid,
  itemName: biText,
  pointsCost: z.number().int(),
  code: z.string(),
  availableBalance: z.number().int(),
});

// ---- admin
export const adminWatchRowSchema = watchRowSchema.extend({
  merchant: z.object({ id: uuid, nameEn: z.string(), nameAr: z.string(), trustLevel: z.string() }),
  submittedAt: z.string().nullable(),
  flags: z.number().int(),
});
export const adminWatchDetailSchema = watchViewSchema.extend({
  merchant: z.object({
    id: uuid,
    nameEn: z.string(),
    nameAr: z.string(),
    legalName: z.string().nullable(),
    commercialRegistration: z.string().nullable(),
    status: z.string(),
    trustLevel: z.string(),
    riskTier: z.string(),
  }),
  history: z.array(
    z.object({
      id: uuid,
      action: z.enum(WATCH_ACTIONS),
      fromStatus: z.enum(WATCH_STATUSES).nullable(),
      toStatus: z.enum(WATCH_STATUSES).nullable(),
      reason: z.string().nullable(),
      reasonAr: z.string().nullable(),
      fields: z.array(z.string()),
      actorRole: z.string().nullable(),
      actorName: z.string().nullable(),
      byDealDash: z.boolean(),
      createdAt: z.string(),
    }),
  ),
  preview: watchDetailSchema,
  adminActions: z.array(z.string()),
  /** What the reviewer must check beyond the content: DealDash-controlled economics and settings in force. */
  economics: z.object({
    chargePerViewHalalas: z.number().int(),
    rateCardVersion: z.number().int(),
    estimatedCostHalalas: z.number().int(),
    rewardPoints: z.number().int(),
    rewardRuleVersion: z.number().int(),
    qualifyingWatchPct: z.number(),
    stillWatchingMode: z.string(),
    repeatWindowHours: z.number().int(),
    customerDailyCap: z.number().int(),
    deviceMaxAccounts: z.number().int(),
    holdHours: z.number().int(),
    reviewAbovePaidViews: z.number().int(),
    largeBudgetFlag: z.boolean(),
    unusedBudgetTreatment: z.string(),
  }),
});
export type AdminWatchDetail = z.infer<typeof adminWatchDetailSchema>;

export const adminWatchOverviewSchema = z.object({
  counts: z.object({
    live: z.number().int(),
    pendingReview: z.number().int(),
    paused: z.number().int(),
    exhausted: z.number().int(),
    openFlags: z.number().int(),
    qualified24h: z.number().int(),
    invalid24h: z.number().int(),
    rewardsIssued24h: z.number().int(),
    rewardsHeld: z.number().int(),
  }),
  campaigns: z.array(
    z.object({
      id: uuid,
      title: biText,
      merchantName: biText,
      status: z.enum(WATCH_STATUSES),
      paidViews: z.number().int(),
      qualifiedViews: z.number().int(),
      budgetPct: z.number(),
      fundedHalalas: z.number().int(),
      spentHalalas: z.number().int(),
      openFlags: z.number().int(),
    }),
  ),
  disclaimerKey: z.literal('legal_treatment_validate_ksa'),
});

export const riskFlagRowSchema = z.object({
  id: uuid,
  createdAt: z.string(),
  decision: z.enum(RISK_DECISIONS),
  severity: z.number().int(),
  status: z.enum(RISK_FLAG_STATUSES),
  signals: z.array(z.enum(RISK_SIGNALS)),
  subject: z.object({ kind: z.enum(['ACCOUNT', 'DEVICE']), label: z.string() }),
  campaign: z.object({ id: uuid, title: biText }).nullable(),
  viewId: uuid.nullable(),
  outcome: z.enum(RISK_REVIEW_OUTCOMES).nullable(),
  reviewedByName: z.string().nullable(),
});
export type RiskFlagRow = z.infer<typeof riskFlagRowSchema>;
export const riskFlagDetailSchema = riskFlagRowSchema.extend({
  signalDetails: z.array(
    z.object({ code: z.enum(RISK_SIGNALS), weight: z.number().int(), detail: z.string() }),
  ),
  /** Timeline of the flagged view (event types and times only). */
  timeline: z.array(z.object({ type: z.string(), positionSec: z.number(), at: z.string() })),
  linked: z.object({
    accountsOnDevice: z.number().int(),
    devicesOnAccount: z.number().int(),
    recentViews: z.number().int(),
  }),
  rewardEntryId: uuid.nullable(),
  reviewReason: z.string().nullable(),
});

export const rewardLedgerRowSchema = rewardEntryViewSchema.extend({
  userId: uuid,
  accountLabel: z.string(),
  reasonCode: z.string().nullable(),
  actorRole: z.string().nullable(),
  sourceId: z.string().nullable(),
});
export const rewardAccountRowSchema = z.object({
  userId: uuid,
  label: z.string(),
  availableBalance: z.number().int(),
  heldBalance: z.number().int(),
  lifetimeEarned: z.number().int(),
  lifetimeRedeemed: z.number().int(),
});
export const rewardAdjustmentViewSchema = z.object({
  id: uuid,
  userId: uuid,
  accountLabel: z.string(),
  points: z.number().int(),
  reasonCode: z.string(),
  ticketRef: z.string(),
  reason: z.string(),
  status: z.enum(REWARD_ADJUSTMENT_STATUSES),
  requestedByName: z.string().nullable(),
  decidedByName: z.string().nullable(),
  needsChecker: z.boolean(),
  /** Actions the caller may take right now (a different admin must approve above the threshold). */
  actions: z.array(z.enum(['approve', 'reject'])),
  createdAt: z.string(),
});
export const rewardAdminOverviewSchema = z.object({
  liability: z.object({
    availableBalance: z.number().int(),
    heldBalance: z.number().int(),
    accounts: z.number().int(),
  }),
  rules: z.object({
    expiryDays: z.number().int().nullable(),
    negativeBalancePolicy: z.string(),
    adjustmentCheckerThresholdPoints: z.number().int(),
    rewardRule: z.array(z.object({ upToSec: z.number(), points: z.number() })),
    pointValueShown: z.literal(false),
  }),
  items: z.array(
    z.object({
      id: uuid,
      name: biText,
      description: biText,
      pointsCost: z.number().int(),
      stock: z.number().int().nullable(),
      status: z.enum(REWARD_ITEM_STATUSES),
      isSample: z.boolean(),
      redeemed: z.number().int(),
    }),
  ),
});

export type RewardAdminOverview = z.infer<typeof rewardAdminOverviewSchema>;
export type RewardAdjustmentView = z.infer<typeof rewardAdjustmentViewSchema>;
export type AdminWatchOverview = z.infer<typeof adminWatchOverviewSchema>;
export type RiskFlagDetail = z.infer<typeof riskFlagDetailSchema>;
export type RewardItemView = z.infer<typeof rewardItemViewSchema>;
export type RewardLedgerRow = z.infer<typeof rewardLedgerRowSchema>;
export type RewardAccountRow = z.infer<typeof rewardAccountRowSchema>;
export type WatchHub = z.infer<typeof watchHubSchema>;
export type WatchViewStarted = z.infer<typeof watchViewStartedSchema>;
export type WatchEventsResult = z.infer<typeof watchEventsResultSchema>;
export type WatchBudgetDetail = z.infer<typeof watchBudgetDetailSchema>;
export type AdminWatchRow = z.infer<typeof adminWatchRowSchema>;
