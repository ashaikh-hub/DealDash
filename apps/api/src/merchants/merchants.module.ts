import { Module } from '@nestjs/common';
import { FilesService } from '../files/files.service';
import { StorageController } from '../files/storage.controller';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AdminMerchantsController } from './admin-merchants.controller';
import { AdminReviewService } from './admin-review.service';
import { ApplicationService } from './application.service';
import { ContactVerificationService } from './contact-verification.service';
import {
  MerchantApplicationController,
  MerchantSignupController,
  MerchantTeamController,
} from './merchant-onboarding.controller';
import { MerchantReadService } from './merchant-read.service';
import { TeamService } from './team.service';

/** Stage 2: merchant onboarding, application, team, files and the admin review workbench. */
@Module({
  imports: [OrganizationsModule],
  controllers: [
    MerchantSignupController,
    MerchantApplicationController,
    MerchantTeamController,
    AdminMerchantsController,
    StorageController,
  ],
  providers: [
    FilesService,
    MerchantReadService,
    ContactVerificationService,
    ApplicationService,
    TeamService,
    AdminReviewService,
  ],
  exports: [FilesService, MerchantReadService],
})
export class MerchantsModule {}
