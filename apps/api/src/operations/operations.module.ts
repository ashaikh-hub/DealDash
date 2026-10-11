import { Global, Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { ActivityService } from './activity.service';
import { ConflictService } from './conflict.service';
import { DisputeService } from './dispute.service';
import { InboxService } from './inbox.service';
import { LaunchControlService } from './launch-control.service';
import { AdminOperationsController, OrgOperationsController } from './operations.controllers';
import { RestrictionCheckService } from './restriction-check.service';

/** Shared operations: task inbox, dispute / exception cases, offer-conflict detection and plain-language activity history. */
@Global()
@Module({
  imports: [MerchantsModule],
  controllers: [AdminOperationsController, OrgOperationsController],
  providers: [
    DisputeService,
    ConflictService,
    InboxService,
    ActivityService,
    RestrictionCheckService,
    LaunchControlService,
  ],
  exports: [
    DisputeService,
    ConflictService,
    InboxService,
    ActivityService,
    RestrictionCheckService,
    LaunchControlService,
  ],
})
export class OperationsModule {}
