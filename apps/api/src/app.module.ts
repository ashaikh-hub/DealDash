import {
  Global,
  MiddlewareConsumer,
  Module,
  type DynamicModule,
  type NestModule,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { mockProviderPagesEnabled, stagingTestInboxEnabled, type ApiEnv } from '@dealdash/config';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { APP_ENV } from './common/env';
import { AllExceptionsFilter, EnvelopeInterceptor, RequestContextMiddleware } from './common/http';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { CustomersModule } from './customers/customers.controller';
import { DevModule } from './dev/dev.module';
import { DevReservationPaymentsModule } from './hot-deals/dev-reservation-payments.module';
import { HealthModule } from './health/health.module';
import { HotDealsModule } from './hot-deals/hot-deals.module';
import { IdentityModule } from './identity/identity.module';
import { JobsModule } from './jobs/jobs.module';
import { LiveDealsModule } from './live-deals/live-deals.module';
import { MerchantsModule } from './merchants/merchants.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProvidersModule } from './providers/providers.module';
import { SystemConfigModule } from './system-config/system-config.module';
import { VouchersModule } from './vouchers/vouchers.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { OperationsModule } from './operations/operations.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { MasterModule } from './master/master.module';
import { PlatformModule } from './platform/platform.module';
import { WatchModule } from './watch/watch.module';
import { VisibilityModule } from './visibility/visibility.module';
import { BillingModule } from './billing/billing.module';
import { AiModule } from './ai/ai.module';
import { PartnersModule } from './partners/partners.module';
import { OpsModule } from './ops/ops.module';
import { BenefitsModule } from './benefits/benefits.module';
import { CustomerAccountModule } from './customer-account/customer-account.module';
import {
  CustomerExperienceModule,
  DevCustomerExperienceModule,
} from './customer-experience/customer-experience.module';
import { StagingTestInboxModule } from './staging/test-inbox';

/**
 * Development helpers per tier. The SMS inbox / TOTP helpers (DevModule) never exist in a production build, staging included. The
 * development provider pages (mock payment / card hold, mock card page, mock Google / Apple) also run in STAGING when development
 * adapters are explicitly allowed (remote UAT, G-5), so testers can finish paid and sign-in flows. Never in production.
 */
export function developmentModules(
  env: Pick<ApiEnv, 'APP_ENV' | 'NODE_ENV' | 'ALLOW_MOCK_PROVIDERS'>,
): Array<
  typeof DevModule | typeof DevReservationPaymentsModule | typeof DevCustomerExperienceModule
> {
  return [
    ...(env.NODE_ENV === 'production' ? [] : [DevModule]),
    ...(mockProviderPagesEnabled(env)
      ? [DevReservationPaymentsModule, DevCustomerExperienceModule]
      : []),
  ];
}

@Global()
@Module({})
export class AppConfigModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [{ provide: APP_ENV, useValue: env }],
      exports: [APP_ENV],
    };
  }
}

/** Domain modules of the modular monolith (Stages 1 to 5). */
@Module({})
export class AppModule implements NestModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(env),
        PrismaModule,
        AuditModule,
        SystemConfigModule,
        ProvidersModule,
        IdentityModule,
        CustomerAccountModule,
        OrganizationsModule,
        MerchantsModule,
        LiveDealsModule,
        HotDealsModule,
        VouchersModule,
        PlatformModule,
        LoyaltyModule,
        OperationsModule,
        SubscriptionModule,
        MasterModule,
        WatchModule,
        VisibilityModule,
        BillingModule,
        AiModule,
        PartnersModule,
        OpsModule,
        CustomersModule,
        BenefitsModule,
        CustomerExperienceModule,
        AnalyticsModule,
        JobsModule,
        HealthModule,
        ...developmentModules(env),
        // launch readiness G-1: the staging test inbox is not even routed in any other tier
        ...(stagingTestInboxEnabled(env) ? [StagingTestInboxModule] : []),
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Order: envelope (outer) wraps idempotency (inner), so replays are enveloped consistently.
        { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*path');
  }
}
