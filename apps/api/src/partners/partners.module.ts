import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { HotDealsModule } from '../hot-deals/hot-deals.module';
import { LiveDealsModule } from '../live-deals/live-deals.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { MasterModule } from '../master/master.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { OperationsModule } from '../operations/operations.module';
import { VisibilityModule } from '../visibility/visibility.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { WatchModule } from '../watch/watch.module';
import { PartnerAccessService } from './partner-access.service';
import { PartnerBenefitsService } from './partner-benefits.service';
import { PartnerCampaignsService } from './partner-campaigns.service';
import { PartnerDashboardService } from './partner-dashboard.service';
import { PartnerNetworkService } from './partner-network.service';
import { PartnerOnboardingService } from './partner-onboarding.service';
import { PartnerProgramsService } from './partner-programs.service';
import { PartnerTeamService } from './partner-team.service';
import {
  AdminPartnersController,
  CustomerPartnerBenefitsController,
  MerchantPartnerBenefitsController,
  PartnerPortalController,
} from './partners.controllers';

/** Stage 7: the Enterprise Partner Portal. A governed front end on the shared platform: no engine of its own. */
@Module({
  imports: [
    FinanceModule,
    HotDealsModule,
    VouchersModule,
    LiveDealsModule,
    LoyaltyModule,
    MasterModule,
    MerchantsModule,
    OperationsModule,
    VisibilityModule,
    WatchModule,
  ],
  controllers: [
    PartnerPortalController,
    AdminPartnersController,
    MerchantPartnerBenefitsController,
    CustomerPartnerBenefitsController,
  ],
  providers: [
    PartnerAccessService,
    PartnerOnboardingService,
    PartnerTeamService,
    PartnerNetworkService,
    PartnerProgramsService,
    PartnerCampaignsService,
    PartnerBenefitsService,
    PartnerDashboardService,
  ],
  exports: [PartnerAccessService, PartnerNetworkService],
})
export class PartnersModule {}
