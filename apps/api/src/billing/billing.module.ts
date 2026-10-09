import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_ENV } from '../common/env';
import { CommercialService } from '../finance/commercial.service';
import { FinanceModule } from '../finance/finance.module';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { BillingAccountsService } from './billing-accounts.service';
import { AdminBillingController, OrgBillingController } from './billing.controllers';
import { FinanceAccessService } from './finance-access.service';
import { InvoicingService } from './invoicing.service';
import { ReceivablesService } from './receivables.service';
import { ReconciliationService } from './reconciliation.service';

/**
 * Phase 5 billing on the ONE shared finance platform (it extends FinanceModule's documents, payments, holds and credit; it is not a
 * second finance system). Background pass `billing.daily` (hourly slot): lapse expired quotations, mark overdue invoices, consume
 * billing events and draft due invoices. Drafts are never issued automatically: issuing is a Finance action.
 */
@Module({
  imports: [FinanceModule, JobsModule],
  controllers: [OrgBillingController, AdminBillingController],
  providers: [FinanceAccessService, BillingAccountsService, InvoicingService, ReceivablesService, ReconciliationService],
  exports: [FinanceAccessService, BillingAccountsService, InvoicingService, ReceivablesService, ReconciliationService],
})
export class BillingModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly invoicing: InvoicingService,
    private readonly ar: ReceivablesService,
    private readonly commercial: CommercialService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    this.jobs.register('billing.daily', async () => {
      await this.commercial.expireDueQuotations();
      await this.ar.markOverdue();
      await this.invoicing.run(null);
    });
    if (this.env.NODE_ENV === 'test' || process.env.JOB_WORKER_ENABLED === 'false') return;
    const ms = 3_600_000;
    const enqueue = () => void this.jobs.enqueue('billing.daily', {}, { idempotencyKey: `billing.daily:${Math.floor(Date.now() / ms)}`, maxAttempts: 1 }).catch(() => undefined);
    enqueue();
    setInterval(enqueue, ms).unref();
  }
}
