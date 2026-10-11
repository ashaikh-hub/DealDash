import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { APP_ENV } from '../common/env';
import { FinanceModule } from '../finance/finance.module';
import { HotDealsModule } from '../hot-deals/hot-deals.module';
import { NotificationsService } from '../hot-deals/notifications.service';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { VisibilityModule } from '../visibility/visibility.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { WatchModule } from '../watch/watch.module';
import { AdjustmentsService } from './adjustments.service';
import { ConfigGovernanceService } from './config-governance.service';
import { AdminControlsController, ProviderCallbacksController } from './controls.controller';
import { DataRequestsService } from './data-requests.service';
import {
  AdminOpsController,
  CustomerOpsController,
  MerchantOpsController,
} from './ops.controllers';
import { OpsReportsService } from './ops-reports.service';
import { ReconciliationOpsService } from './reconciliation-ops.service';
import { RestrictionsService } from './restrictions.service';
import { ReviewsService } from './reviews.service';
import { RiskOpsService } from './risk-ops.service';
import { SettlementService } from './settlement.service';
import { SlaService } from './sla.service';
import { SupportOpsService } from './support-ops.service';

/**
 * Stage 8: operational gap closure on the shared engines (case framework, refunds, ledger, billing, rewards, alerts and tasks,
 * market configuration). No second engine: every service here composes the existing ones and adds the operational workflow.
 */
@Module({
  imports: [
    FinanceModule,
    BillingModule,
    VouchersModule,
    WatchModule,
    HotDealsModule,
    VisibilityModule,
    JobsModule,
  ],
  controllers: [
    AdminOpsController,
    MerchantOpsController,
    CustomerOpsController,
    AdminControlsController,
    ProviderCallbacksController,
  ],
  providers: [
    ConfigGovernanceService,
    AdjustmentsService,
    SettlementService,
    ReconciliationOpsService,
    RestrictionsService,
    RiskOpsService,
    ReviewsService,
    SlaService,
    SupportOpsService,
    DataRequestsService,
    OpsReportsService,
  ],
  exports: [
    AdjustmentsService,
    SettlementService,
    ReconciliationOpsService,
    RestrictionsService,
    RiskOpsService,
    ReviewsService,
    SlaService,
    SupportOpsService,
    DataRequestsService,
    OpsReportsService,
  ],
})
export class OpsModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly sla: SlaService,
    private readonly notifications: NotificationsService,
    private readonly restrictions: RestrictionsService,
    private readonly risk: RiskOpsService,
    private readonly governance: ConfigGovernanceService,
    private readonly settlements: SettlementService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    this.jobs.register('ops.sla', async () => {
      await this.sla.sweep();
    });
    this.jobs.register('ops.notifications', async () => {
      await this.notifications.sweepUntracked();
      await this.notifications.retryDue();
    });
    this.jobs.register('ops.restrictions', async () => {
      await this.restrictions.expire();
    });
    this.jobs.register('ops.risk', async () => {
      await this.risk.scan();
    });
    // Stage 9 (B7): approved configuration changes take effect at their effective time
    this.jobs.register('ops.config', async () => {
      await this.governance.applyDue();
    });
    // Stage 9 (B2): payout instructions still pending at the provider are checked (covers a missed callback)
    this.jobs.register('ops.payouts', async () => {
      await this.settlements.pollPendingPayouts();
    });
    if (this.env.NODE_ENV === 'test' || process.env.JOB_WORKER_ENABLED === 'false') return;
    const every = (type: string, ms: number) => {
      const enqueue = () => {
        const slot = Math.floor(Date.now() / ms);
        void this.jobs
          .enqueue(type, {}, { idempotencyKey: `${type}:${slot}`, maxAttempts: 1 })
          .catch(() => undefined);
      };
      enqueue();
      setInterval(enqueue, ms).unref();
    };
    every('ops.sla', 300_000);
    every('ops.notifications', 60_000);
    every('ops.restrictions', 300_000);
    every('ops.risk', 900_000);
    every('ops.config', 60_000);
    every('ops.payouts', 300_000);
  }
}
