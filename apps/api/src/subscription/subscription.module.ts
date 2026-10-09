import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_ENV } from '../common/env';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { CommercialAccessService } from './access.service';
import { AmendmentService } from './amendment.service';
import { BillingEventService } from './billing-event.service';
import { PlanService } from './plan.service';
import { PricingResolver } from './pricing.resolver';
import { SignalService } from './signal.service';
import { SubscriptionService } from './subscription.service';
import { AdminSubscriptionController, OrgSubscriptionController } from './subscription.controllers';
import { UsageService } from './usage.service';

/**
 * Subscription, licensing and commercial plan engine. It extends the Contract / Entitlement platform (PlatformModule); it is
 * Global because every product enforces entitlements and records usage through it. Phase 5 consumes the billing events and replaces
 * the financial-status provider; Phase 4 consumes the signals.
 */
@Global()
@Module({
  imports: [JobsModule],
  controllers: [AdminSubscriptionController, OrgSubscriptionController],
  providers: [PlanService, PricingResolver, BillingEventService, SignalService, UsageService, SubscriptionService, AmendmentService, CommercialAccessService],
  exports: [PlanService, PricingResolver, BillingEventService, SignalService, UsageService, SubscriptionService, AmendmentService, CommercialAccessService],
})
export class SubscriptionModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly subs: SubscriptionService,
    private readonly amendments: AmendmentService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    // trials, grace, expiry, renewals, promotions, approaching-date signals and accepted changes whose effective date has arrived
    this.jobs.register('subscription.run_due', async () => {
      await this.subs.runDue();
      await this.amendments.applyDue();
    });
    if (this.env.NODE_ENV !== 'test' && process.env.JOB_WORKER_ENABLED !== 'false') {
      const enqueue = () => {
        const slot = Math.floor(Date.now() / 3_600_000);
        void this.jobs.enqueue('subscription.run_due', {}, { idempotencyKey: `subscription.run_due:${slot}`, maxAttempts: 1 }).catch(() => undefined);
      };
      enqueue();
      setInterval(enqueue, 3_600_000).unref();
    }
  }
}
