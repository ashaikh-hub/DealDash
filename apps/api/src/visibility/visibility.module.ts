import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { APP_ENV } from '../common/env';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { VouchersModule } from '../vouchers/vouchers.module';
import { AlertsService } from './alerts.service';
import { AnalyticsProjector } from './analytics-projector.service';
import { EarlyWarningService } from './early-warning.service';
import { MetricsService } from './metrics.service';
import { OperationsCentreService } from './operations-centre.service';
import { ReportingService } from './reporting.service';
import { TargetsService } from './targets.service';
import { AdminVisibilityController, NotificationPreferenceController, OrgVisibilityController } from './visibility.controllers';

/**
 * Phase 4: visibility and operations on the modular monolith (no Kafka, no extra infrastructure). Background passes:
 *   visibility.analytics  every minute  - project new source records into the taxonomy, re-aggregate recent hours
 *   visibility.alerts     every 5 min   - subscription signals, target milestones, early warnings, escalation
 *   visibility.digest     hourly        - digests for people who asked for them
 */
@Module({
  imports: [JobsModule, VouchersModule],
  controllers: [OrgVisibilityController, NotificationPreferenceController, AdminVisibilityController],
  providers: [AnalyticsProjector, MetricsService, ReportingService, TargetsService, AlertsService, EarlyWarningService, OperationsCentreService],
  exports: [AnalyticsProjector, MetricsService, ReportingService, TargetsService, AlertsService, EarlyWarningService, OperationsCentreService],
})
export class VisibilityModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly projector: AnalyticsProjector,
    private readonly metrics: MetricsService,
    private readonly alerts: AlertsService,
    private readonly targets: TargetsService,
    private readonly warnings: EarlyWarningService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    this.jobs.register('visibility.analytics', async () => {
      await this.projector.project();
      await this.metrics.aggregate();
    });
    this.jobs.register('visibility.alerts', async () => {
      await this.alerts.consumeSignals();
      await this.targets.evaluate();
      await this.warnings.run();
      await this.alerts.escalate();
    });
    this.jobs.register('visibility.digest', async () => {
      await this.alerts.sendDigests();
    });
    if (this.env.NODE_ENV === 'test' || process.env.JOB_WORKER_ENABLED === 'false') return;
    const every = (type: string, ms: number) => {
      const enqueue = () => {
        const slot = Math.floor(Date.now() / ms);
        void this.jobs.enqueue(type, {}, { idempotencyKey: `${type}:${slot}`, maxAttempts: 1 }).catch(() => undefined);
      };
      enqueue();
      setInterval(enqueue, ms).unref();
    };
    every('visibility.analytics', 60_000);
    every('visibility.alerts', 300_000);
    every('visibility.digest', 3_600_000);
  }
}
