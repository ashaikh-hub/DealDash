import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { ApiEnv } from '@dealdash/config';
import {
  SAVING_SOURCES,
  cardSetupResultSchema,
  cardSetupStartResultSchema,
  cardSetupStartSchema,
  envelope,
  savedCardListSchema,
  savingLogSchema,
  savingsSummarySchema,
  savingStateSchema,
} from '@dealdash/validation';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  Public,
  RequirePermissions,
} from '../common/decorators';
import { APP_ENV } from '../common/env';
import type { Actor, RequestMeta } from '../common/request-context';
import { CustomerAllowedGuard } from '../customer-account/customer-account.module';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../providers/interfaces';
import { MOCK_TEST_CARDS, MockPaymentProvider, type MockTestCard } from '../providers/mocks';
import { DevSocialController } from '../identity/social-auth.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { SavingsService } from './savings.service';

class CardListResponse extends createZodDto(envelope(savedCardListSchema)) {}
class SetupStartDto extends createZodDto(cardSetupStartSchema) {}
class SetupStartResponse extends createZodDto(envelope(cardSetupStartResultSchema)) {}
class SetupResultResponse extends createZodDto(envelope(cardSetupResultSchema)) {}
class SavingLogDto extends createZodDto(savingLogSchema) {}
class SavingStateResponse extends createZodDto(envelope(savingStateSchema)) {}
class SavingsResponse extends createZodDto(envelope(savingsSummarySchema)) {}

/** Saved cards: list, add (provider's hosted page), make default, remove. Always the signed-in customer's own cards. */
@ApiTags('customer-payment-methods')
@Controller('app/payment-methods')
@Audiences('customer')
export class CustomerPaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Get()
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: CardListResponse })
  list(@CurrentActor() actor: Actor) {
    return this.methods.list(actor.userId);
  }

  @Post('setups')
  @HttpCode(200)
  @RequirePermissions('customer.profile.write')
  @UseGuards(CustomerAllowedGuard)
  @ApiOkResponse({ type: SetupStartResponse })
  start(@Body() b: SetupStartDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.methods.startSetup(actor, b, meta);
  }

  @Post('setups/:id/finish')
  @HttpCode(200)
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: SetupResultResponse })
  finish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.methods.finishSetup(actor, id, meta);
  }

  @Put(':id/default')
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: CardListResponse })
  setDefault(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.methods.setDefault(actor, id, meta);
  }

  @Delete(':id')
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: CardListResponse })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.methods.remove(actor, id, meta);
  }
}

const sourceParam = z.enum(SAVING_SOURCES);

/** "Log my saving": the customer's own savings record and running total. */
@ApiTags('customer-savings')
@Controller('app/savings')
@Audiences('customer')
export class CustomerSavingsController {
  constructor(private readonly savings: SavingsService) {}

  @Get()
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: SavingsResponse })
  summary(@CurrentActor() actor: Actor) {
    return this.savings.summary(actor.userId);
  }

  @Get(':sourceType/:sourceId')
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: SavingStateResponse })
  state(
    @Param('sourceType') sourceType: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @CurrentActor() actor: Actor,
  ) {
    const s = sourceParam.safeParse(sourceType);
    if (!s.success) throw new NotFoundException();
    return this.savings.state(actor.userId, s.data, sourceId);
  }

  @Post()
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: SavingStateResponse })
  log(@Body() b: SavingLogDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.savings.log(actor, b, meta);
  }
}

const devCardSchema = z.object({
  outcome: z.enum(['SAVED', 'CANCELLED']),
  card: z
    .enum(Object.keys(MOCK_TEST_CARDS) as [MockTestCard, ...MockTestCard[]])
    .default('VISA_4242'),
});
class DevCardDto extends createZodDto(devCardSchema) {}

/**
 * Development-only stand-in for the payment provider's hosted "add a card" page: the tester picks a TEST card from a list (no card
 * number is typed or sent); the app then asks the API to finish the setup, which reads the outcome from the provider as in production.
 * Also tells the mock payment page which saved card is being charged. Refused in production.
 */
@ApiExcludeController()
@Controller('dev/payment-methods')
export class DevPaymentMethodsController {
  constructor(
    @Inject(APP_ENV) private readonly env: ApiEnv,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  private mock() {
    if (this.env.NODE_ENV === 'production' || !(this.provider instanceof MockPaymentProvider))
      throw new NotFoundException();
    return this.provider;
  }

  @Post(':setupRef/complete')
  @Public()
  @HttpCode(200)
  complete(@Param('setupRef') setupRef: string, @Body() b: DevCardDto) {
    if (!this.mock().completeCardSetup(setupRef, b.outcome, b.card)) throw new NotFoundException();
    return { done: true };
  }

  @Get('cards/:token')
  @Public()
  async describe(@Param('token') token: string) {
    return this.mock().describeCard(token);
  }
}

/** Customer experience (2026-10-16): saved cards and "Log my saving". */
@Module({
  controllers: [CustomerPaymentMethodsController, CustomerSavingsController],
  providers: [PaymentMethodsService, SavingsService],
  exports: [PaymentMethodsService, SavingsService],
})
export class CustomerExperienceModule {}

/** Development-only pages for the customer experience mocks (card page, Google / Apple screen). Not registered in production. */
@Module({ controllers: [DevPaymentMethodsController, DevSocialController] })
export class DevCustomerExperienceModule {}
