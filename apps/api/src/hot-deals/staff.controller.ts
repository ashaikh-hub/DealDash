import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  RequirePermissions,
} from '../common/decorators';
import type { Actor, AppRequest, RequestMeta } from '../common/request-context';
import {
  StaffCodeDto,
  StaffHistoryQueryDto,
  StaffHistoryResponse,
  StaffMeResponse,
  StaffRedeemResponse,
  StaffValidationResponse,
} from './dto';
import { RedemptionService } from './redemption.service';

/**
 * Merchant Staff (frontline) API. The audience is `staff` only; the caller's scope (merchant, optionally one branch) comes
 * from their membership, never from the request. Staff can validate and redeem; they cannot see campaigns, finance or
 * customer details beyond a first name, and they cannot reverse a redemption.
 */
@ApiTags('staff')
@Controller('staff')
@Audiences('staff')
export class StaffController {
  constructor(private readonly redemptions: RedemptionService) {}

  @Get('me')
  @RequirePermissions('merchant.redemptions.read')
  @ApiOkResponse({ type: StaffMeResponse })
  me(@CurrentActor() actor: Actor) {
    return this.redemptions.me(actor);
  }

  /** Check a code without redeeming it (the confirmation screen). */
  @Post('redemptions/validate')
  @HttpCode(200)
  @RequirePermissions('merchant.redemptions.perform')
  @ApiOkResponse({ type: StaffValidationResponse })
  validate(@Body() body: StaffCodeDto, @CurrentActor() actor: Actor) {
    return this.redemptions.validate(actor, body, body.branchId ?? null);
  }

  /**
   * Redeem. Requires an Idempotency-Key: a retry after a bad connection returns the same result and never redeems twice.
   * Online only; there is no offline redemption.
   */
  @Post('redemptions')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('merchant.redemptions.perform')
  @ApiOkResponse({ type: StaffRedeemResponse })
  redeem(
    @Body() body: StaffCodeDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
    @Req() req: AppRequest,
  ) {
    return this.redemptions.redeem(
      actor,
      body,
      req.get('idempotency-key') ?? null,
      body.branchId ?? null,
      meta,
    );
  }

  @Get('history')
  @RequirePermissions('merchant.redemptions.read')
  @ApiOkResponse({ type: StaffHistoryResponse })
  history(@Query() q: StaffHistoryQueryDto, @CurrentActor() actor: Actor) {
    return this.redemptions.history(actor, q);
  }
}
