import { Global, Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { ActivityService } from './activity.service';
import { ConflictService } from './conflict.service';
import { DisputeService } from './dispute.service';
import { InboxService } from './inbox.service';
import { AdminOperationsController, OrgOperationsController } from './operations.controllers';

/** Shared operations: task inbox, dispute / exception cases, offer-conflict detection and plain-language activity history. */
@Global()
@Module({
  imports: [MerchantsModule],
  controllers: [AdminOperationsController, OrgOperationsController],
  providers: [DisputeService, ConflictService, InboxService, ActivityService],
  exports: [DisputeService, ConflictService, InboxService, ActivityService],
})
export class OperationsModule {}
