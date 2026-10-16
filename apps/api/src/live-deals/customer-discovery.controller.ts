import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  Audiences,
  CurrentActor,
  OptionalActor,
  Public,
  RequirePermissions,
} from '../common/decorators';
import type { Actor } from '../common/request-context';
import { CategoriesService } from './categories.service';
import { DealEventsService } from './deal-events.service';
import { DiscoveryService } from './discovery.service';
import {
  AppConfigResponse,
  CategoryListResponse,
  DealCardListResponse,
  DealDetailResponse,
  DealEventBatchDto,
  DiscoveryQueryDto,
  EventsAcceptedResponse,
  FollowStateResponse,
  HomeFeedResponse,
  HomeQueryDto,
  MerchantPageResponse,
  NearbyQueryDto,
  SavedItemsResponse,
  SavedStateResponse,
  SearchResponse,
} from './dto';

const customerId = (actor?: Actor) => (actor?.userType === 'CUSTOMER' ? actor.userId : null);

/**
 * Customer discovery. Reads are public (guests can browse) and use the signed-in customer, when there is one, only to
 * apply eligibility and show saved state. Nothing here exposes merchant portal data: only approved, customer-facing content.
 */
@ApiTags('customer-discovery')
@Controller('app')
@Audiences('customer')
export class CustomerDiscoveryController {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly categories: CategoriesService,
    private readonly events: DealEventsService,
  ) {}

  @Get('config')
  @Public()
  @ApiOkResponse({ type: AppConfigResponse })
  appConfig() {
    return this.discovery.appConfig();
  }

  @Get('categories')
  @Public()
  @ApiOkResponse({ type: CategoryListResponse })
  listCategories() {
    return this.categories.list();
  }

  @Get('home')
  @Public()
  @ApiOkResponse({ type: HomeFeedResponse })
  home(@Query() q: HomeQueryDto, @OptionalActor() actor?: Actor) {
    return this.discovery.home(q, customerId(actor));
  }

  @Get('deals')
  @Public()
  @ApiOkResponse({ type: DealCardListResponse })
  deals(@Query() q: DiscoveryQueryDto, @OptionalActor() actor?: Actor) {
    return this.discovery.list(q, customerId(actor));
  }

  @Get('deals/nearby')
  @Public()
  @ApiOkResponse({ type: DealCardListResponse })
  nearby(@Query() q: NearbyQueryDto, @OptionalActor() actor?: Actor) {
    return this.discovery.nearby(q, customerId(actor));
  }

  @Get('search')
  @Public()
  @ApiOkResponse({ type: SearchResponse })
  search(@Query() q: DiscoveryQueryDto, @OptionalActor() actor?: Actor) {
    return this.discovery.search(q, customerId(actor));
  }

  @Get('live-deals/:id')
  @Public()
  @ApiOkResponse({ type: DealDetailResponse })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: HomeQueryDto,
    @OptionalActor() actor?: Actor,
  ) {
    return this.discovery.detail(id, customerId(actor), q);
  }

  @Get('merchants/:id')
  @Public()
  @ApiOkResponse({ type: MerchantPageResponse })
  merchant(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: HomeQueryDto,
    @OptionalActor() actor?: Actor,
  ) {
    return this.discovery.merchantPage(id, customerId(actor), q);
  }

  /** Discovery signals from the app (impression, detail view, merchant page view, directions click). */
  @Post('events')
  @Public()
  @HttpCode(202)
  @ApiOkResponse({ type: EventsAcceptedResponse })
  recordEvents(@Body() body: DealEventBatchDto, @OptionalActor() actor?: Actor) {
    return this.events.record(body.events, actor);
  }

  // ---- saved (signed-in customers)
  @Get('saved')
  @RequirePermissions('customer.saved.manage')
  @ApiOkResponse({ type: SavedItemsResponse })
  saved(@CurrentActor() actor: Actor) {
    return this.discovery.saved(actor.userId);
  }

  @Post('saved/live-deals/:id')
  @HttpCode(200)
  @RequirePermissions('customer.saved.manage')
  @ApiOkResponse({ type: SavedStateResponse })
  save(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.discovery.save(actor.userId, id);
  }

  @Delete('saved/live-deals/:id')
  @RequirePermissions('customer.saved.manage')
  @ApiOkResponse({ type: SavedStateResponse })
  unsave(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.discovery.unsave(actor.userId, id);
  }

  // ---- follow a merchant (signed-in customers)
  @Put('merchants/:id/follow')
  @RequirePermissions('customer.saved.manage')
  @ApiOkResponse({ type: FollowStateResponse })
  follow(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.discovery.follow(actor.userId, id);
  }

  @Delete('merchants/:id/follow')
  @RequirePermissions('customer.saved.manage')
  @ApiOkResponse({ type: FollowStateResponse })
  unfollow(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.discovery.unfollow(actor.userId, id);
  }
}
