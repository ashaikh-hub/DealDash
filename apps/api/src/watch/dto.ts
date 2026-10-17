import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  adminCreditSchema,
  adminWatchDetailSchema,
  adminWatchListQuerySchema,
  adminWatchOverviewSchema,
  adminWatchRowSchema,
  envelope,
  paginationQuerySchema,
  riskDecisionSchema,
  riskFlagDetailSchema,
  riskFlagListQuerySchema,
  riskFlagRowSchema,
  rewardAccountRowSchema,
  rewardAccountSearchSchema,
  rewardActivityQuerySchema,
  rewardAdjustmentCreateSchema,
  rewardAdjustmentDecisionSchema,
  rewardAdjustmentListQuerySchema,
  rewardAdjustmentViewSchema,
  rewardAdminOverviewSchema,
  rewardEntryViewSchema,
  rewardItemSaveSchema,
  rewardItemViewSchema,
  rewardLedgerQuerySchema,
  rewardLedgerRowSchema,
  rewardRedeemSchema,
  uploadIntentResultSchema,
  uploadIntentSchema,
  rewardRedeemedSchema,
  rewardSummarySchema,
  watchBudgetDetailSchema,
  watchCancelSchema,
  watchCreateSchema,
  watchDecisionSchema,
  watchDetailSchema,
  watchEventsResultSchema,
  watchEventsSchema,
  watchFundSchema,
  watchHubQuerySchema,
  watchHubSchema,
  watchListQuerySchema,
  watchMonitorSchema,
  watchOptionsSchema,
  watchOutcomeSchema,
  watchPauseSchema,
  watchRowSchema,
  watchSaveResultSchema,
  watchSaveSchema,
  watchSubmitResultSchema,
  watchViewSchema,
  watchViewStartSchema,
  watchViewStartedSchema,
  watchCompleteSchema,
  watchCardSchema,
  wonPrizeSchema,
} from '@dealdash/validation';

const uuid = z.string().uuid();
const watchMediaIntent = uploadIntentSchema
  .pick({ fileName: true, mimeType: true, sizeBytes: true })
  .extend({ kind: z.enum(['WATCH_VIDEO', 'DEAL_IMAGE']).default('WATCH_VIDEO') });
const summary = z.object({
  counts: z.record(z.string(), z.number()),
  total: z.number(),
  money: z.object({
    fundedHalalas: z.number(),
    spentHalalas: z.number(),
    unusedHalalas: z.number(),
    qualifiedViews: z.number(),
  }),
});
const historyRow = z.object({
  id: uuid,
  action: z.string(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  reason: z.string().nullable(),
  reasonAr: z.string().nullable(),
  fields: z.array(z.string()),
  actorRole: z.string().nullable(),
  actorName: z.string().nullable(),
  byDealDash: z.boolean(),
  createdAt: z.string(),
});
const auditRow = z.object({
  id: uuid,
  occurredAt: z.string(),
  action: z.string(),
  actorRole: z.string().nullable(),
  actorUserId: z.string().nullable(),
  reason: z.string().nullable(),
  entityType: z.string(),
});
const itemId = z.object({ id: uuid });
const reconcile = z.object({ accounts: z.number(), mismatches: z.number() });

// ---- requests
export class WatchCreateDto extends createZodDto(watchCreateSchema) {}
export class WatchSaveDto extends createZodDto(watchSaveSchema) {}
export class WatchListQueryDto extends createZodDto(watchListQuerySchema) {}
export class WatchFundDto extends createZodDto(watchFundSchema) {}
export class WatchPauseDto extends createZodDto(watchPauseSchema) {}
export class WatchCancelDto extends createZodDto(watchCancelSchema) {}
export class WatchDecisionDto extends createZodDto(watchDecisionSchema) {}
export class AdminWatchListQueryDto extends createZodDto(adminWatchListQuerySchema) {}
export class AdminCreditDto extends createZodDto(adminCreditSchema) {}
export class WatchAuditPageDto extends createZodDto(paginationQuerySchema) {}
export class WatchHubQueryDto extends createZodDto(watchHubQuerySchema) {}
export class WatchViewStartDto extends createZodDto(watchViewStartSchema) {}
export class WatchEventsDto extends createZodDto(watchEventsSchema) {}
export class WatchCompleteDto extends createZodDto(watchCompleteSchema) {}
export class RewardActivityQueryDto extends createZodDto(rewardActivityQuerySchema) {}
export class RewardRedeemDto extends createZodDto(rewardRedeemSchema) {}
export class RiskFlagListQueryDto extends createZodDto(riskFlagListQuerySchema) {}
export class RiskDecisionDto extends createZodDto(riskDecisionSchema) {}
export class RewardAccountSearchDto extends createZodDto(rewardAccountSearchSchema) {}
export class RewardLedgerQueryDto extends createZodDto(rewardLedgerQuerySchema) {}
export class RewardAdjustmentCreateDto extends createZodDto(rewardAdjustmentCreateSchema) {}
export class RewardAdjustmentDecisionDto extends createZodDto(rewardAdjustmentDecisionSchema) {}
export class RewardAdjustmentListQueryDto extends createZodDto(rewardAdjustmentListQuerySchema) {}
export class RewardItemSaveDto extends createZodDto(rewardItemSaveSchema) {}

export class WatchMediaIntentDto extends createZodDto(watchMediaIntent) {}

// ---- responses
export class WatchMediaIntentResponse extends createZodDto(envelope(uploadIntentResultSchema)) {}
export class WatchOptionsResponse extends createZodDto(envelope(watchOptionsSchema)) {}
export class WatchResponse extends createZodDto(envelope(watchViewSchema)) {}
export class WatchRowListResponse extends createZodDto(envelope(z.array(watchRowSchema))) {}
export class WatchSaveResponse extends createZodDto(envelope(watchSaveResultSchema)) {}
export class WatchSubmitResponse extends createZodDto(envelope(watchSubmitResultSchema)) {}
export class WatchSummaryResponse extends createZodDto(envelope(summary)) {}
export class WatchHistoryResponse extends createZodDto(envelope(z.array(historyRow))) {}
export class WatchPreviewResponse extends createZodDto(envelope(watchDetailSchema)) {}
export class WatchMonitorResponse extends createZodDto(envelope(watchMonitorSchema)) {}
export class WatchBudgetResponse extends createZodDto(envelope(watchBudgetDetailSchema)) {}
export class WatchAuditResponse extends createZodDto(envelope(z.array(auditRow))) {}
export class AdminWatchListResponse extends createZodDto(envelope(z.array(adminWatchRowSchema))) {}
export class AdminWatchDetailResponse extends createZodDto(envelope(adminWatchDetailSchema)) {}
export class AdminWatchOverviewResponse extends createZodDto(envelope(adminWatchOverviewSchema)) {}
export class WatchHubResponse extends createZodDto(envelope(watchHubSchema)) {}
export class WatchDetailResponse extends createZodDto(envelope(watchDetailSchema)) {}
export class WatchViewStartedResponse extends createZodDto(envelope(watchViewStartedSchema)) {}
export class WatchEventsResponse extends createZodDto(envelope(watchEventsResultSchema)) {}
export class WatchOutcomeResponse extends createZodDto(envelope(watchOutcomeSchema)) {}
export class WatchCardsResponse extends createZodDto(envelope(z.array(watchCardSchema))) {}
export class WonPrizesResponse extends createZodDto(envelope(z.array(wonPrizeSchema))) {}
export class WonPrizeResponse extends createZodDto(envelope(wonPrizeSchema)) {}
export class RewardSummaryResponse extends createZodDto(envelope(rewardSummarySchema)) {}
export class RewardActivityResponse extends createZodDto(
  envelope(z.array(rewardEntryViewSchema)),
) {}
export class RewardCatalogueResponse extends createZodDto(
  envelope(z.array(rewardItemViewSchema)),
) {}
export class RewardRedeemedResponse extends createZodDto(envelope(rewardRedeemedSchema)) {}
export class RiskFlagListResponse extends createZodDto(envelope(z.array(riskFlagRowSchema))) {}
export class RiskFlagDetailResponse extends createZodDto(envelope(riskFlagDetailSchema)) {}
export class RewardAccountListResponse extends createZodDto(
  envelope(z.array(rewardAccountRowSchema)),
) {}
export class RewardLedgerResponse extends createZodDto(envelope(z.array(rewardLedgerRowSchema))) {}
export class RewardAdjustmentListResponse extends createZodDto(
  envelope(z.array(rewardAdjustmentViewSchema)),
) {}
export class RewardAdjustmentResponse extends createZodDto(envelope(rewardAdjustmentViewSchema)) {}
export class RewardAdminOverviewResponse extends createZodDto(
  envelope(rewardAdminOverviewSchema),
) {}
export class RewardItemSavedResponse extends createZodDto(envelope(itemId)) {}
export class RewardReconcileResponse extends createZodDto(envelope(reconcile)) {}
