import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { VisibilityModule } from '../visibility/visibility.module';
import { AI_PROVIDER, BuiltinAiProvider } from './ai-provider';
import { AiEvalService } from './ai-eval.service';
import { AdminAiController, CustomerAiController, OrgAiController } from './ai.controllers';
import { AiService } from './ai.service';

/**
 * Governed AI agents (Phase 5). Product services (discovery, wallet, reservations) are resolved at call time through the module
 * graph and always called as the requesting person; the provider only classifies the request.
 */
@Module({
  imports: [VisibilityModule, BillingModule],
  controllers: [CustomerAiController, OrgAiController, AdminAiController],
  providers: [
    AiService,
    AiEvalService,
    { provide: AI_PROVIDER, useFactory: () => new BuiltinAiProvider() },
  ],
  exports: [AiService],
})
export class AiModule {}
