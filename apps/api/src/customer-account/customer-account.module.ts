import {
  Body,
  Controller,
  Get,
  Global,
  HttpCode,
  Injectable,
  Module,
  Post,
  Put,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import {
  customerConsentsUpdateSchema,
  customerMobileStartResultSchema,
  customerMobileStartSchema,
  customerMobileVerifySchema,
  customerNotificationSettingsSchema,
  customerNotificationSettingsUpdateSchema,
  customerProfileSchema,
  customerProfileUpdateSchema,
  envelope,
} from '@dealdash/validation';
import { Audiences, CurrentActor, Meta, RequirePermissions } from '../common/decorators';
import type { Actor, AppRequest, RequestMeta } from '../common/request-context';
import { CustomerAccountService } from './customer-account.service';

class ProfileUpdateDto extends createZodDto(customerProfileUpdateSchema) {}
class ConsentsUpdateDto extends createZodDto(customerConsentsUpdateSchema) {}
class NotificationSettingsUpdateDto extends createZodDto(
  customerNotificationSettingsUpdateSchema,
) {}
class MobileStartDto extends createZodDto(customerMobileStartSchema) {}
class MobileVerifyDto extends createZodDto(customerMobileVerifySchema) {}
class ProfileResponse extends createZodDto(envelope(customerProfileSchema)) {}
class NotificationSettingsResponse extends createZodDto(
  envelope(customerNotificationSettingsSchema),
) {}
class MobileStartResponse extends createZodDto(envelope(customerMobileStartResultSchema)) {}

/**
 * Route guard: reserving, buying, watching to earn and redeeming need a ready customer account (profile complete, age checked,
 * current Terms / Privacy). Business sessions are not affected.
 */
@Injectable()
export class CustomerReadyGuard implements CanActivate {
  constructor(private readonly account: CustomerAccountService) {}
  async canActivate(ctx: ExecutionContext) {
    const actor = ctx.switchToHttp().getRequest<AppRequest>().actor;
    if (actor?.audience === 'customer') await this.account.assertReady(actor.userId);
    return true;
  }
}

/** Route guard: an under-age (blocked) customer account cannot change benefits or other account data. */
@Injectable()
export class CustomerAllowedGuard implements CanActivate {
  constructor(private readonly account: CustomerAccountService) {}
  async canActivate(ctx: ExecutionContext) {
    const actor = ctx.switchToHttp().getRequest<AppRequest>().actor;
    if (actor?.audience === 'customer') await this.account.assertAllowed(actor.userId);
    return true;
  }
}

/** The signed-in customer's own account: profile set-up, consents, notification choices and mobile number. */
@ApiTags('customer-account')
@Controller('app/me')
@Audiences('customer')
export class CustomerAccountController {
  constructor(private readonly account: CustomerAccountService) {}

  @Get('profile')
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: ProfileResponse })
  profile(@CurrentActor() actor: Actor) {
    return this.account.profile(actor.userId);
  }

  @Put('profile')
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: ProfileResponse })
  updateProfile(
    @Body() b: ProfileUpdateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.account.updateProfile(actor, b, meta);
  }

  @Put('consents')
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: ProfileResponse })
  updateConsents(
    @Body() b: ConsentsUpdateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.account.updateConsents(actor, b, meta);
  }

  @Get('notification-settings')
  @RequirePermissions('customer.profile.read')
  @ApiOkResponse({ type: NotificationSettingsResponse })
  notificationSettings(@CurrentActor() actor: Actor) {
    return this.account.notificationSettings(actor.userId);
  }

  @Put('notification-settings')
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: NotificationSettingsResponse })
  updateNotificationSettings(
    @Body() b: NotificationSettingsUpdateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.account.updateNotificationSettings(actor, b, meta);
  }

  @Post('mobile/code')
  @HttpCode(200)
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: MobileStartResponse })
  mobileStart(@Body() b: MobileStartDto, @CurrentActor() actor: Actor, @Meta() meta: RequestMeta) {
    return this.account.mobileStart(actor, b.mobile, meta);
  }

  @Post('mobile/verify')
  @HttpCode(200)
  @RequirePermissions('customer.profile.write')
  @ApiOkResponse({ type: ProfileResponse })
  mobileVerify(
    @Body() b: MobileVerifyDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.account.mobileVerify(actor, b.mobile, b.code, meta);
  }
}

/** Global so the product modules can put the readiness guards on their customer routes. */
@Global()
@Module({
  controllers: [CustomerAccountController],
  providers: [CustomerAccountService, CustomerReadyGuard, CustomerAllowedGuard],
  exports: [CustomerAccountService, CustomerReadyGuard, CustomerAllowedGuard],
})
export class CustomerAccountModule {}
