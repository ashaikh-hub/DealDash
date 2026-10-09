import { Module } from '@nestjs/common';
import { AdminOrganizationsController } from './admin-organizations.controller';
import { BranchesService } from './branches.service';
import { MerchantsController } from './merchants.controller';
import { PartnersController } from './partners.controller';

@Module({
  controllers: [MerchantsController, PartnersController, AdminOrganizationsController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class OrganizationsModule {}
