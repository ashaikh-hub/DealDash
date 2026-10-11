import { Global, Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { LiveDealsModule } from '../live-deals/live-deals.module';
import { LoyaltyCommercialAdapter } from './loyalty-commercial.adapter';
import { LoyaltyFinanceService } from './loyalty-finance.service';
import { LoyaltyIssuanceService } from './loyalty-issuance.service';
import { LoyaltyRulesService } from './loyalty-rules.service';
import { AdminLoyaltyController, OrgLoyaltyController } from './loyalty.controllers';
import { PointsLedgerService } from './points-ledger.service';

/**
 * Shared loyalty: the one points ledger plus configurable rules, issuance, funding and finance views. Global because every product
 * earns through it; it depends on the shared finance and eligibility engines, never on a product.
 */
@Global()
@Module({
  imports: [FinanceModule, LiveDealsModule],
  controllers: [AdminLoyaltyController, OrgLoyaltyController],
  providers: [
    PointsLedgerService,
    LoyaltyIssuanceService,
    LoyaltyRulesService,
    LoyaltyFinanceService,
    LoyaltyCommercialAdapter,
  ],
  exports: [
    PointsLedgerService,
    LoyaltyIssuanceService,
    LoyaltyRulesService,
    LoyaltyFinanceService,
  ],
})
export class LoyaltyModule {}
