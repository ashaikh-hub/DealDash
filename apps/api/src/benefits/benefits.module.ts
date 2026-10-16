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
  Query,
  UseGuards,
  type OnModuleInit,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  benefitCardAddSchema,
  benefitEmployerStartResultSchema,
  benefitEmployerStartSchema,
  benefitEmployerVerifySchema,
  benefitHistoryItemSchema,
  benefitOfferSchema,
  benefitOffersQuerySchema,
  benefitOptionsQuerySchema,
  benefitOptionsSchema,
  benefitsOverviewSchema,
  benefitUsageItemSchema,
  benefitUsageQuerySchema,
  brandCardSchema,
  cardOfferActivateSchema,
  cardOfferActivationItemSchema,
  cardOfferStateSchema,
  employeePassSchema,
  envelope,
  type OfferProduct,
} from '@dealdash/validation';
import { APP_ENV } from '../common/env';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  OptionalActor,
  Public,
  RequirePermissions,
} from '../common/decorators';
import type { Actor, RequestMeta } from '../common/request-context';
import { CustomerAllowedGuard } from '../customer-account/customer-account.module';
import { HotDealsModule } from '../hot-deals/hot-deals.module';
import { JobsModule } from '../jobs/jobs.module';
import { JobsService } from '../jobs/jobs.service';
import { LiveDealsModule } from '../live-deals/live-deals.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { BenefitsService } from './benefits.service';
import { CardOffersService } from './card-offers.service';

// ---- DTOs
class EmployerStartDto extends createZodDto(benefitEmployerStartSchema) {}
class EmployerVerifyDto extends createZodDto(benefitEmployerVerifySchema) {}
class CardAddDto extends createZodDto(benefitCardAddSchema) {}
class OffersQueryDto extends createZodDto(benefitOffersQuerySchema) {}
class UsageQueryDto extends createZodDto(benefitUsageQuerySchema) {}
class OptionsQueryDto extends createZodDto(benefitOptionsQuerySchema) {}
class OverviewResponse extends createZodDto(envelope(benefitsOverviewSchema)) {}
class OptionsResponse extends createZodDto(envelope(benefitOptionsSchema)) {}
class StartResponse extends createZodDto(envelope(benefitEmployerStartResultSchema)) {}
class OffersResponse extends createZodDto(envelope(z.array(benefitOfferSchema))) {}
class UsageResponse extends createZodDto(envelope(z.array(benefitUsageItemSchema))) {}
class HistoryResponse extends createZodDto(envelope(z.array(benefitHistoryItemSchema))) {}
class EmployeePassResponse extends createZodDto(envelope(employeePassSchema)) {}
class CardOfferStateResponse extends createZodDto(envelope(cardOfferStateSchema)) {}
class CardOfferListResponse extends createZodDto(
  envelope(z.array(cardOfferActivationItemSchema)),
) {}
class CardOfferActivateDto extends createZodDto(cardOfferActivateSchema) {}

/**
 * Customer "My benefits". Every route acts on the signed-in customer only (keyed by the session, never by a client id).
 * Reading uses the profile-read permission; changing a benefit uses profile-write (a benefit is part of the customer profile).
 */
@ApiTags('customer-benefits')
@Controller('app/benefits')
@Audiences('customer')
export class CustomerBenefitsController {
  constructor(private readonly benefits: BenefitsService) {}

  @Get()
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: OverviewResponse })
  overview(@Query() q: OptionsQueryDto, @CurrentActor() actor: Actor) {
    return this.benefits.overview(actor.userId, q.city);
  }

  @Get('options')
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: OptionsResponse })
  options(@Query() q: OptionsQueryDto, @CurrentActor() actor: Actor) {
    return this.benefits.options(actor.userId, q.city);
  }

  @Get('offers')
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: OffersResponse })
  offers(@Query() q: OffersQueryDto, @CurrentActor() actor: Actor) {
    return this.benefits.offers(actor.userId, q);
  }

  @Get('usage')
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: UsageResponse })
  usage(@Query() q: UsageQueryDto, @CurrentActor() actor: Actor) {
    return this.benefits.usage(actor.userId, q.tab);
  }

  @Get('history')
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: HistoryResponse })
  history(@CurrentActor() actor: Actor) {
    return this.benefits.history(actor.userId);
  }

  /** Employee Pass: the verified employer shown as a pass (active / inactive). */
  @Get('employee-pass')
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: EmployeePassResponse })
  employeePass(@CurrentActor() actor: Actor) {
    return this.benefits.employeePass(actor.userId);
  }

  @Post('employer/code')
  @HttpCode(200)
  @RequirePermissions('customer.profile.write')
  @UseGuards(CustomerAllowedGuard)
  @ApiOkResponse({ type: StartResponse })
  employerStart(
    @Body() b: EmployerStartDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.benefits.employerStart(actor, b, meta);
  }

  @Post('employer/verify')
  @HttpCode(200)
  @RequirePermissions('customer.profile.write')
  @UseGuards(CustomerAllowedGuard)
  @ApiOkResponse({ type: OverviewResponse })
  employerVerify(
    @Body() b: EmployerVerifyDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.benefits.employerVerify(actor, b, meta);
  }

  @Delete('employer')
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: OverviewResponse })
  employerRemove(@CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.benefits.employerRemove(actor, meta);
  }

  @Post('cards')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('customer.profile.write')
  @UseGuards(CustomerAllowedGuard)
  @ApiOkResponse({ type: OverviewResponse })
  cardAdd(@Body() b: CardAddDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.benefits.cardAdd(actor, b.programId, meta);
  }

  @Delete('cards/:programId')
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: OverviewResponse })
  cardRemove(
    @Param('programId', ParseUUIDPipe) programId: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.benefits.cardRemove(actor, programId, meta);
  }
}

const brandQuerySchema = z.object({
  city: z.string().trim().max(40).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
class BrandQueryDto extends createZodDto(brandQuerySchema) {}
class BrandListResponse extends createZodDto(envelope(z.array(brandCardSchema))) {}

/** "Browse offers by brand" (public: guests browse too; a signed-in customer's eligibility applies). */
@ApiTags('customer-discovery')
@Controller('app')
@Audiences('customer')
export class CustomerBrandsController {
  constructor(private readonly benefits: BenefitsService) {}

  @Get('brands')
  @Public()
  @ApiOkResponse({ type: BrandListResponse })
  brands(@Query() q: BrandQueryDto, @OptionalActor() actor?: Actor) {
    return this.benefits.brands(actor?.userType === 'CUSTOMER' ? actor.userId : null, q);
  }
}

const productParam = z.enum(['live', 'hot', 'voucher']);
const productOf = (p: string): OfferProduct => {
  const r = productParam.safeParse(p);
  if (!r.success) throw new NotFoundException();
  return r.data.toUpperCase() as OfferProduct;
};

/** Card-linked offers: the activation state on an offer page (guests see which cards open it), activation, and the history. */
@ApiTags('customer-benefits')
@Controller('app/card-offers')
@Audiences('customer')
export class CustomerCardOffersController {
  constructor(private readonly cardOffers: CardOffersService) {}

  @Get()
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: CardOfferListResponse })
  list(@CurrentActor() actor: Actor) {
    return this.cardOffers.list(actor.userId);
  }

  @Get(':product/:id')
  @Public()
  @ApiOkResponse({ type: CardOfferStateResponse })
  state(
    @Param('product') product: string,
    @Param('id', ParseUUIDPipe) id: string,
    @OptionalActor() actor?: Actor,
  ) {
    return this.cardOffers.state(
      actor?.userType === 'CUSTOMER' ? actor.userId : null,
      productOf(product),
      id,
    );
  }

  @Post(':product/:id/activate')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('customer.profile.write')
  @UseGuards(CustomerAllowedGuard)
  @ApiOkResponse({ type: CardOfferStateResponse })
  activate(
    @Param('product') product: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: CardOfferActivateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cardOffers.activate(actor, productOf(product), id, b.programId, meta);
  }
}

/** Customer "My benefits": employer work-email verification, added cards, benefit offers, usage and history. */
@Module({
  imports: [LiveDealsModule, HotDealsModule, VouchersModule, JobsModule],
  controllers: [CustomerBenefitsController, CustomerBrandsController, CustomerCardOffersController],
  providers: [BenefitsService, CardOffersService],
  exports: [BenefitsService, CardOffersService],
})
export class BenefitsModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly benefits: BenefitsService,
    @Inject(APP_ENV) private readonly env: { NODE_ENV: string },
  ) {}

  onModuleInit() {
    this.jobs.register('benefits.sweep', async () => this.benefits.sweep());
    if (this.env.NODE_ENV !== 'test' && process.env.JOB_WORKER_ENABLED !== 'false') {
      // employer expiry / renewal reminders: hourly is ample (dates are compared directly; the engine never uses an expired benefit)
      const enqueue = () => {
        const hour = Math.floor(Date.now() / 3_600_000);
        void this.jobs
          .enqueue(
            'benefits.sweep',
            {},
            { idempotencyKey: `benefits.sweep:${hour}`, maxAttempts: 1 },
          )
          .catch(() => undefined);
      };
      enqueue();
      setInterval(enqueue, 3_600_000).unref();
    }
  }
}
