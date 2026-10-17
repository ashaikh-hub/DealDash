import { FinanceModule } from '../finance/finance.module';
import { WatchCommercialAdapter } from './watch-commercial.adapter';
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { APP_ENV } from '../common/env';
import { HotDealsModule } from '../hot-deals/hot-deals.module';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { LiveDealsModule } from '../live-deals/live-deals.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import {
  AdminRewardsController,
  AdminRiskController,
  AdminWatchController,
} from './admin-watch.controller';
import { CustomerWatchController } from './customer-watch.controller';
import { MerchantWatchController } from './merchant-watch.controller';
import { MerchantWatchService } from './merchant-watch.service';
import { RewardsAdminService } from './rewards-admin.service';
import { RewardsLedgerService } from './rewards-ledger.service';
import { RiskService } from './risk.service';
import { WatchCoreService } from './watch-core.service';
import { WatchDiscoveryService } from './watch-discovery.service';
import { WatchFundingService } from './watch-funding.service';
import { WatchLifecycleService } from './watch-lifecycle.service';
import { WatchPrizeService } from './watch-prize.service';
import { WatchQualificationService } from './watch-qualification.service';
import { WatchReviewService } from './watch-review.service';
import { WatchViewService } from './watch-view.service';

/**
 * Stage 6: Watch & Earn (a separate advertising / reward campaign domain with its own lifecycle, budget and qualifying-view
 * pipeline) and the Rewards ledger (non-cash points). Reuses the Stage 5 ledger for campaign money. Touches no Partner Portal
 * and no Play & Win code.
 */
@Module({
  imports: [
    MerchantsModule,
    LiveDealsModule,
    HotDealsModule,
    JobsModule,
    AnalyticsModule,
    VouchersModule,
    FinanceModule,
  ],
  controllers: [
    MerchantWatchController,
    AdminWatchController,
    AdminRiskController,
    AdminRewardsController,
    CustomerWatchController,
  ],
  providers: [
    WatchCommercialAdapter,
    WatchCoreService,
    WatchViewService,
    WatchFundingService,
    RewardsLedgerService,
    RiskService,
    WatchQualificationService,
    WatchDiscoveryService,
    MerchantWatchService,
    WatchReviewService,
    RewardsAdminService,
    WatchLifecycleService,
    // instant prizes (FDR-19): the server-side draw, the customer's prizes and staff redemption of prize codes
    WatchPrizeService,
  ],
  exports: [
    WatchPrizeService,
    WatchLifecycleService,
    RewardsLedgerService,
    WatchQualificationService,
    WatchCoreService,
    // Stage 7 / FD-S7-1: partner-owned Watch & Earn campaigns run on this engine
    MerchantWatchService,
    WatchFundingService,
  ],
})
export class WatchModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly lifecycle: WatchLifecycleService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    this.jobs.register('watch.sweep', async () => this.lifecycle.sweep());
    if (this.env.NODE_ENV !== 'test' && process.env.JOB_WORKER_ENABLED !== 'false') {
      const enqueue = () => {
        const slot = Math.floor(Date.now() / 30_000);
        void this.jobs
          .enqueue('watch.sweep', {}, { idempotencyKey: `watch.sweep:${slot}`, maxAttempts: 1 })
          .catch(() => undefined);
      };
      enqueue();
      setInterval(enqueue, 30_000).unref();
    }
  }
}
