import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  OptionalActor,
  Public,
  RequirePermissions,
} from '../common/decorators';
import { AppError } from '../common/errors';
import type { Actor } from '../common/request-context';
import { HomeQueryDto } from '../live-deals/dto';
import {
  RewardActivityQueryDto,
  RewardActivityResponse,
  RewardCatalogueResponse,
  RewardRedeemDto,
  RewardRedeemedResponse,
  RewardSummaryResponse,
  WatchCompleteDto,
  WatchDetailResponse,
  WatchEventsDto,
  WatchEventsResponse,
  WatchHubQueryDto,
  WatchHubResponse,
  WatchOutcomeResponse,
  WatchViewStartDto,
  WatchViewStartedResponse,
} from './dto';
import { RewardsLedgerService } from './rewards-ledger.service';
import { WatchDiscoveryService } from './watch-discovery.service';
import { WatchQualificationService } from './watch-qualification.service';

const customerId = (actor?: Actor) => (actor?.userType === 'CUSTOMER' ? actor.userId : null);

/**
 * Customer Watch & Earn: discovery (public), watching (signed-in customers) and rewards. The player reports events; the SERVER
 * decides every outcome. Reward points are a non-cash incentive: no SAR value is ever returned.
 */
@ApiTags('customer-watch')
@Controller('app')
@Audiences('customer')
export class CustomerWatchController {
  constructor(
    private readonly discovery: WatchDiscoveryService,
    private readonly qualification: WatchQualificationService,
    private readonly rewards: RewardsLedgerService,
  ) {}

  @Get('watch')
  @Public()
  @ApiOkResponse({ type: WatchHubResponse })
  hub(@Query() q: WatchHubQueryDto, @OptionalActor() actor?: Actor) {
    return this.discovery.hub(customerId(actor), q);
  }

  @Get('watch/campaigns/:id')
  @Public()
  @ApiOkResponse({ type: WatchDetailResponse })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: HomeQueryDto,
    @OptionalActor() actor?: Actor,
  ) {
    return this.discovery.detail(customerId(actor), id, q);
  }

  @Post('watch/views')
  @HttpCode(200)
  @RequirePermissions('customer.rewards.manage')
  @ApiOkResponse({ type: WatchViewStartedResponse })
  start(@Body() body: WatchViewStartDto, @CurrentActor() actor: Actor) {
    return this.qualification.start(actor.userId, body);
  }

  @Post('watch/views/:id/events')
  @HttpCode(200)
  @RequirePermissions('customer.rewards.manage')
  @ApiOkResponse({ type: WatchEventsResponse })
  events(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchEventsDto,
    @Headers('x-view-token') token: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    if (!token) throw AppError.forbidden('This viewing session is not valid');
    return this.qualification.events(actor.userId, id, token, body.events);
  }

  @Post('watch/views/:id/complete')
  @HttpCode(200)
  @RequirePermissions('customer.rewards.manage')
  @ApiOkResponse({ type: WatchOutcomeResponse })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: WatchCompleteDto,
    @Headers('x-view-token') token: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    if (!token) throw AppError.forbidden('This viewing session is not valid');
    return this.qualification.complete(actor.userId, id, token, body.positionSec);
  }

  @Get('watch/views/:id')
  @RequirePermissions('customer.rewards.manage')
  @ApiOkResponse({ type: WatchOutcomeResponse })
  outcome(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.qualification.outcome(actor.userId, id);
  }

  // ---------------------------------------------------------------- rewards
  @Get('rewards')
  @RequirePermissions('customer.rewards.manage')
  @ApiOkResponse({ type: RewardSummaryResponse })
  summary(@CurrentActor() actor: Actor) {
    return this.rewards.summary(actor.userId);
  }

  @Get('rewards/activity')
  @RequirePermissions('customer.rewards.manage')
  @ApiOkResponse({ type: RewardActivityResponse })
  activity(@Query() q: RewardActivityQueryDto, @CurrentActor() actor: Actor) {
    return this.rewards.activity(actor.userId, q);
  }

  @Get('rewards/catalogue')
  @RequirePermissions('customer.rewards.manage')
  @ApiOkResponse({ type: RewardCatalogueResponse })
  catalogue(@CurrentActor() actor: Actor) {
    return this.rewards.catalogue(actor.userId);
  }

  @Post('rewards/redeem')
  @HttpCode(200)
  @Idempotent()
  @RequirePermissions('customer.rewards.manage')
  @ApiOkResponse({ type: RewardRedeemedResponse })
  redeem(
    @Body() body: RewardRedeemDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: Actor,
  ) {
    return this.rewards.redeem(actor.userId, body.itemId, key ?? randomUUID());
  }
}
