import { FinanceModule } from '../finance/finance.module';
import { HotCommercialAdapter } from './hot-commercial.adapter';
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_ENV } from '../common/env';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { LiveDealsModule } from '../live-deals/live-deals.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { AdminReservationsService } from './admin-reservations.service';
import { AdminHotDealsController, AdminReservationsController } from './admin-hot-deals.controller';
import { CustomerHotController } from './customer-hot.controller';
import { HotCoreService } from './hot-core.service';
import { HotDiscoveryService } from './hot-discovery.service';
import { HotLifecycleService } from './hot-lifecycle.service';
import { HotReviewService } from './hot-review.service';
import { HotViewService } from './hot-view.service';
import { MerchantHotDealsController } from './merchant-hot-deals.controller';
import { MerchantHotDealsService } from './merchant-hot-deals.service';
import { NotificationsService } from './notifications.service';
import { RedemptionService } from './redemption.service';
import { ReservationPolicyService } from './reservation-policy.service';
import { ReservationsService } from './reservations.service';
import { StaffController } from './staff.controller';

/**
 * Stage 4: Exclusive Deals (own lifecycle), per-branch inventory, reservations (commitment model 2026-10-15: FREE only by policy),
 * merchant staff redemption,
 * no-show foundation and the in-app notification foundation. Reuses the Stage 3 kernel (eligibility, guardrails,
 * categories, media, audit); touches no payment, voucher, Watch & Earn, Rewards or Partner code.
 */
@Module({
  imports: [MerchantsModule, LiveDealsModule, JobsModule, FinanceModule],
  controllers: [
    MerchantHotDealsController,
    AdminHotDealsController,
    AdminReservationsController,
    CustomerHotController,
    StaffController,
  ],
  providers: [
    HotCommercialAdapter,
    ReservationPolicyService,
    HotCoreService,
    HotViewService,
    NotificationsService,
    ReservationsService,
    RedemptionService,
    MerchantHotDealsService,
    HotReviewService,
    HotDiscoveryService,
    AdminReservationsService,
    HotLifecycleService,
  ],
  exports: [
    ReservationPolicyService,
    ReservationsService,
    HotDiscoveryService,
    HotLifecycleService,
    NotificationsService,
    RedemptionService,
    MerchantHotDealsService,
  ],
})
export class HotDealsModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly lifecycle: HotLifecycleService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    this.jobs.register('hot_deals.sweep', async () => this.lifecycle.sweep());
    if (this.env.NODE_ENV !== 'test' && process.env.JOB_WORKER_ENABLED !== 'false') {
      // One sweep per 30 seconds (holds are short); the idempotency key makes several instances enqueue it only once.
      const enqueue = () => {
        const slot = Math.floor(Date.now() / 30_000);
        void this.jobs
          .enqueue(
            'hot_deals.sweep',
            {},
            { idempotencyKey: `hot_deals.sweep:${slot}`, maxAttempts: 1 },
          )
          .catch(() => undefined);
      };
      enqueue();
      setInterval(enqueue, 30_000).unref();
    }
  }
}
