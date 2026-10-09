import { Module, type OnModuleInit } from '@nestjs/common';
import { LedgerService } from '../vouchers/ledger.service';
import { CommercialRegistry } from './commercial.registry';
import { CommercialService } from './commercial.service';
import { FinanceAdminService } from './finance-admin.service';
import { AdminFinanceController, MerchantCommercialController } from './finance.controllers';
import { PricingService } from './pricing.service';

/**
 * The shared Commercial Governance & Finance platform. It depends on no product module: each product registers a
 * `CommercialAdapter` (Vouchers, Watch & Earn, Exclusive Deals) and calls the gate / utilisation hooks.
 */
@Module({
  controllers: [MerchantCommercialController, AdminFinanceController],
  providers: [LedgerService, CommercialRegistry, PricingService, CommercialService, FinanceAdminService],
  exports: [LedgerService, CommercialRegistry, PricingService, CommercialService, FinanceAdminService],
})
export class FinanceModule implements OnModuleInit {
  onModuleInit() {
    // adapters register themselves from their own modules
  }
}