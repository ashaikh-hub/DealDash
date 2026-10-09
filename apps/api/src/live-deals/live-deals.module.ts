import { Module, type OnModuleInit, Inject } from '@nestjs/common';
import { APP_ENV } from '../common/env';
import { AnalyticsModule } from '../analytics/analytics.module';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { MerchantsModule } from '../merchants/merchants.module';
import { AdminCategoriesController, AdminLiveDealsController } from './admin-live-deals.controller';
import { CategoriesService } from './categories.service';
import { CustomerDiscoveryController } from './customer-discovery.controller';
import { DealCoreService } from './deal-core.service';
import { DealEventsService } from './deal-events.service';
import { DealPresenterService } from './deal-presenter.service';
import { DealReviewService } from './deal-review.service';
import { DealViewService } from './deal-view.service';
import { DiscoveryService } from './discovery.service';
import { EligibilityService } from './eligibility.service';
import { GuardrailsService } from './guardrails.service';
import { DealLifecycleService } from './lifecycle.service';
import { MerchantDealsService } from './merchant-deals.service';
import { MerchantLiveDealsController } from './merchant-live-deals.controller';

/**
 * Stage 3: Live Deals (their own lifecycle, review and versioning), categories, eligibility visibility,
 * customer discovery (PostGIS + PostgreSQL search) and discovery analytics.
 */
@Module({
  imports: [MerchantsModule, AnalyticsModule, JobsModule],
  controllers: [
    MerchantLiveDealsController,
    AdminLiveDealsController,
    AdminCategoriesController,
    CustomerDiscoveryController,
  ],
  providers: [
    EligibilityService,
    GuardrailsService,
    CategoriesService,
    DealCoreService,
    DealPresenterService,
    DealViewService,
    DealEventsService,
    MerchantDealsService,
    DealReviewService,
    DiscoveryService,
    DealLifecycleService,
  ],
  // Exclusive Deals (Stage 4) reuse the same kernel: references, eligibility, guardrails, categories, discovery helpers.
  exports: [
    DealLifecycleService,
    DiscoveryService,
    DealCoreService,
    EligibilityService,
    GuardrailsService,
    CategoriesService,
  ],
})
export class LiveDealsModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly lifecycle: DealLifecycleService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    this.jobs.register('live_deals.sweep', async () => this.lifecycle.sweep());
    if (this.env.NODE_ENV !== 'test' && process.env.JOB_WORKER_ENABLED !== 'false') {
      // One sweep job per minute; the idempotency key makes several API instances enqueue it only once.
      const enqueue = () => {
        const minute = Math.floor(Date.now() / 60_000);
        void this.jobs
          .enqueue(
            'live_deals.sweep',
            {},
            { idempotencyKey: `live_deals.sweep:${minute}`, maxAttempts: 1 },
          )
          .catch(() => undefined);
      };
      enqueue();
      setInterval(enqueue, 60_000).unref();
    }
  }
}
