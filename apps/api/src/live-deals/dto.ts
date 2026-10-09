import { createZodDto } from 'nestjs-zod';
import {
  acceptedSchema,
  adminAuditRowSchema,
  adminDealAnalyticsSchema,
  appConfigSchema,
  adminDealDetailSchema,
  adminDealListQuerySchema,
  adminDealRowSchema,
  categoryInputSchema,
  categoryUpdateSchema,
  dealCategoryViewSchema,
  dealDecisionSchema,
  dealDecisionViewSchema,
  dealDetailSchema,
  dealEventBatchSchema,
  dealPageSchema,
  dealSaveResultSchema,
  dealSubmitResultSchema,
  discoveryQuerySchema,
  eligibilityOptionsSchema,
  envelope,
  fileViewSchema,
  homeFeedSchema,
  homeQuerySchema,
  liveDealCreateSchema,
  liveDealEndSchema,
  liveDealListQuerySchema,
  liveDealPauseSchema,
  liveDealRowSchema,
  liveDealSaveSchema,
  liveDealViewSchema,
  merchantPageSchema,
  nearbyDealsQuerySchema,
  paginationQuerySchema,
  performanceQuerySchema,
  performanceSchema,
  savedItemsSchema,
  searchResultSchema,
  uploadIntentResultSchema,
  uploadIntentSchema,
} from '@dealdash/validation';
import { z } from 'zod';

// ---- requests
export class LiveDealCreateDto extends createZodDto(liveDealCreateSchema) {}
export class LiveDealSaveDto extends createZodDto(liveDealSaveSchema) {}
export class LiveDealListQueryDto extends createZodDto(liveDealListQuerySchema) {}
export class LiveDealPauseDto extends createZodDto(liveDealPauseSchema) {}
export class LiveDealEndDto extends createZodDto(liveDealEndSchema) {}
export class PerformanceQueryDto extends createZodDto(performanceQuerySchema) {}
export class DealDecisionDto extends createZodDto(dealDecisionSchema) {}
export class AdminDealListQueryDto extends createZodDto(adminDealListQuerySchema) {}
export class AuditPageDto extends createZodDto(paginationQuerySchema) {}
export class CategoryCreateDto extends createZodDto(categoryInputSchema) {}
export class CategoryUpdateDto extends createZodDto(categoryUpdateSchema) {}
export class DiscoveryQueryDto extends createZodDto(discoveryQuerySchema) {}
export class NearbyQueryDto extends createZodDto(nearbyDealsQuerySchema) {}
export class HomeQueryDto extends createZodDto(homeQuerySchema) {}
export class DealEventBatchDto extends createZodDto(dealEventBatchSchema) {}
export class DealMediaIntentDto extends createZodDto(
  uploadIntentSchema.pick({ fileName: true, mimeType: true, sizeBytes: true }),
) {}

// ---- responses
export class LiveDealResponse extends createZodDto(envelope(liveDealViewSchema)) {}
export class LiveDealRowListResponse extends createZodDto(envelope(z.array(liveDealRowSchema))) {}
export class DealSaveResponse extends createZodDto(envelope(dealSaveResultSchema)) {}
export class DealSubmitResponse extends createZodDto(envelope(dealSubmitResultSchema)) {}
export class DealPreviewResponse extends createZodDto(envelope(dealDetailSchema)) {}
export class DealHistoryResponse extends createZodDto(envelope(z.array(dealDecisionViewSchema))) {}
export class DealPerformanceResponse extends createZodDto(envelope(performanceSchema)) {}
export class DealSummaryResponse extends createZodDto(
  envelope(z.object({ counts: z.record(z.string(), z.number()), total: z.number() })),
) {}
export class DealOptionsResponse extends createZodDto(
  envelope(
    z.object({
      categories: z.array(dealCategoryViewSchema),
      eligibility: eligibilityOptionsSchema,
    }),
  ),
) {}
export class AdminDealListResponse extends createZodDto(envelope(z.array(adminDealRowSchema))) {}
export class AdminDealDetailResponse extends createZodDto(envelope(adminDealDetailSchema)) {}
export class AdminDealAnalyticsResponse extends createZodDto(envelope(adminDealAnalyticsSchema)) {}
export class AdminDealAuditResponse extends createZodDto(envelope(z.array(adminAuditRowSchema))) {}
export class CategoryResponse extends createZodDto(envelope(dealCategoryViewSchema)) {}
export class CategoryListResponse extends createZodDto(envelope(z.array(dealCategoryViewSchema))) {}
export class DealCardListResponse extends createZodDto(envelope(dealPageSchema)) {}
export class DealDetailResponse extends createZodDto(envelope(dealDetailSchema)) {}
export class MerchantPageResponse extends createZodDto(envelope(merchantPageSchema)) {}
export class HomeFeedResponse extends createZodDto(envelope(homeFeedSchema)) {}
export class SearchResponse extends createZodDto(envelope(searchResultSchema)) {}
export class SavedItemsResponse extends createZodDto(envelope(savedItemsSchema)) {}
export class SavedStateResponse extends createZodDto(envelope(z.object({ saved: z.boolean() }))) {}
export class EventsAcceptedResponse extends createZodDto(
  envelope(z.object({ accepted: z.number().int() })),
) {}
export class MediaIntentResponse extends createZodDto(envelope(uploadIntentResultSchema)) {}
export class MediaViewResponse extends createZodDto(envelope(fileViewSchema)) {}
export class AcceptedOkResponse extends createZodDto(envelope(acceptedSchema)) {}
export class AppConfigResponse extends createZodDto(envelope(appConfigSchema)) {}
