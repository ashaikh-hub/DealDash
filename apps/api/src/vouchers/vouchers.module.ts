import { FinanceModule } from '../finance/finance.module';
import { VoucherCommercialAdapter } from './voucher-commercial.adapter';
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { APP_ENV } from '../common/env';
import { HotDealsModule } from '../hot-deals/hot-deals.module';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { LiveDealsModule } from '../live-deals/live-deals.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { AdminFinanceController, AdminVouchersController } from './admin-vouchers.controller';
import {
  CustomerVouchersController,
  DevPaymentsController,
  PaymentWebhookController,
} from './customer-vouchers.controller';
import { FinanceAdminService } from './finance-admin.service';
import { LedgerService } from './ledger.service';
import { MerchantVouchersController } from './merchant-vouchers.controller';
import { MerchantVouchersService } from './merchant-vouchers.service';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { SupportCasesService } from './support-cases.service';
import { VoucherCoreService } from './voucher-core.service';
import { VoucherDiscoveryService } from './voucher-discovery.service';
import { VoucherEventsService } from './voucher-events.service';
import { VoucherLifecycleService } from './voucher-lifecycle.service';
import { VoucherRedemptionService } from './voucher-redemption.service';
import { VoucherReviewService } from './voucher-review.service';
import { VoucherViewService } from './voucher-view.service';
import { WalletService } from './wallet.service';

/**
 * Stage 5: Vouchers (own lifecycle), checkout and payments through the provider abstraction, voucher ownership and QR
 * redemption (plugged into the Stage 4 Staff redemption flow), refunds, expiry, the append-only ledger foundation and the
 * merchant payable foundation. Touches no Watch & Earn, Rewards or Partner code.
 */
@Module({
  imports: [
    MerchantsModule,
    LiveDealsModule,
    HotDealsModule,
    JobsModule,
    AnalyticsModule,
    FinanceModule,
  ],
  controllers: [
    MerchantVouchersController,
    AdminVouchersController,
    AdminFinanceController,
    CustomerVouchersController,
    PaymentWebhookController,
    DevPaymentsController,
  ],
  providers: [
    VoucherCommercialAdapter,
    VoucherCoreService,
    VoucherViewService,
    VoucherEventsService,
    LedgerService,
    RefundsService,
    PaymentsService,
    WalletService,
    VoucherRedemptionService,
    MerchantVouchersService,
    VoucherReviewService,
    VoucherDiscoveryService,
    FinanceAdminService,
    SupportCasesService,
    VoucherLifecycleService,
  ],
  exports: [
    VoucherLifecycleService,
    PaymentsService,
    RefundsService,
    LedgerService,
    MerchantVouchersService,
    FinanceAdminService,
  ],
})
export class VouchersModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly lifecycle: VoucherLifecycleService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    this.jobs.register('vouchers.sweep', async () => this.lifecycle.sweep());
    if (this.env.NODE_ENV !== 'test' && process.env.JOB_WORKER_ENABLED !== 'false') {
      // One sweep per 30 seconds (checkout holds are short); the idempotency key makes several instances enqueue it once.
      const enqueue = () => {
        const slot = Math.floor(Date.now() / 30_000);
        void this.jobs
          .enqueue(
            'vouchers.sweep',
            {},
            { idempotencyKey: `vouchers.sweep:${slot}`, maxAttempts: 1 },
          )
          .catch(() => undefined);
      };
      enqueue();
      setInterval(enqueue, 30_000).unref();
    }
  }
}
