import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_ENV } from '../common/env';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { ImportService } from './import.service';
import { IngestService } from './ingest.service';
import { IntegrationService } from './integration.service';
import {
  AdminImportsController,
  AdminIntegrationsController,
  AdminMasterController,
  CustomerNetworkOffersController,
  IngestController,
  OrgIntegrationsController,
} from './master.controllers';
import { MasterService } from './master.service';
import { NetworkOffersService } from './network-offers.service';

/**
 * Shared platform, Phase 2: merchant master data (referenced vs registered), provenance and conflicts, bulk import and the
 * integration framework. No scheme- or bank-specific connector lives here.
 */
@Module({
  imports: [JobsModule],
  controllers: [
    AdminMasterController,
    AdminImportsController,
    AdminIntegrationsController,
    OrgIntegrationsController,
    IngestController,
    CustomerNetworkOffersController,
  ],
  providers: [
    MasterService,
    IngestService,
    IntegrationService,
    ImportService,
    NetworkOffersService,
  ],
  exports: [MasterService, IngestService, IntegrationService, ImportService, NetworkOffersService],
})
export class MasterModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly integrations: IntegrationService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    this.jobs.register('integrations.sweep', async () => {
      await this.integrations.markStale();
      await this.integrations.deliverDue(async (url, body, headers) => {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(8000),
        });
        return { ok: res.ok, status: res.status };
      });
    });
    if (this.env.NODE_ENV !== 'test' && process.env.JOB_WORKER_ENABLED !== 'false') {
      const enqueue = () => {
        const slot = Math.floor(Date.now() / 60_000);
        void this.jobs
          .enqueue(
            'integrations.sweep',
            {},
            { idempotencyKey: `integrations.sweep:${slot}`, maxAttempts: 1 },
          )
          .catch(() => undefined);
      };
      enqueue();
      setInterval(enqueue, 60_000).unref();
    }
  }
}
