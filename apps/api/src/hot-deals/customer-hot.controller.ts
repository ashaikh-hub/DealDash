import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
import { CustomerReadyGuard } from '../customer-account/customer-account.module';
import { HomeQueryDto } from '../live-deals/dto';
import {
  CustomerCancelDto,
  HotCardListResponse,
  HotDetailResponse,
  HotDiscoveryQueryDto,
  MarkReadDto,
  NotificationListResponse,
  ReservationCreateDto,
  ReservationListQueryDto,
  ReservationListResponse,
  ReservationResponse,
  UpdatedResponse,
} from './dto';
import { HotDiscoveryService } from './hot-discovery.service';
import { NotificationsService } from './notifications.service';
import { ReservationsService } from './reservations.service';

const customerId = (actor?: Actor) => (actor?.userType === 'CUSTOMER' ? actor.userId : null);

/**
 * Customer Exclusive Deals and free reservations. Reading is public (guests can browse); reserving, My Deals and
 * notifications need a signed-in customer. There is no payment step anywhere in this flow.
 */
@ApiTags('customer-hot-deals')
@Controller('app')
@Audiences('customer')
export class CustomerHotController {
  constructor(
    private readonly discovery: HotDiscoveryService,
    private readonly reservations: ReservationsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Get('hot-deals')
  @Public()
  @ApiOkResponse({ type: HotCardListResponse })
  list(@Query() q: HotDiscoveryQueryDto, @OptionalActor() actor?: Actor) {
    return this.discovery.list(q, customerId(actor));
  }

  @Get('hot-deals/:id')
  @Public()
  @ApiOkResponse({ type: HotDetailResponse })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: HomeQueryDto,
    @OptionalActor() actor?: Actor,
  ) {
    return this.discovery.detail(id, customerId(actor), q);
  }

  /** Free reservation. Creating it confirms it; the units are held for the deal's hold time. */
  @Post('hot-deals/:id/reservations')
  @Idempotent()
  @HttpCode(201)
  @RequirePermissions('customer.reservations.manage')
  @UseGuards(CustomerReadyGuard)
  @ApiOkResponse({ type: ReservationResponse })
  reserve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReservationCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.reservations.reserve(actor, id, body, meta);
  }

  @Get('reservations')
  @RequirePermissions('customer.reservations.manage')
  @ApiOkResponse({ type: ReservationListResponse })
  mine(@Query() q: ReservationListQueryDto, @CurrentActor() actor: Actor) {
    return this.reservations.listMine(actor.userId, q.tab, q.limit);
  }

  @Get('reservations/:id')
  @RequirePermissions('customer.reservations.manage')
  @ApiOkResponse({ type: ReservationResponse })
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.reservations.getMine(actor.userId, id);
  }

  /** Paid reservations (2026-10-15, RC-31): another payment attempt inside the payment window. */
  @Post('reservations/:id/pay')
  @HttpCode(200)
  @RequirePermissions('customer.reservations.manage')
  @ApiOkResponse({ type: ReservationResponse })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.reservations.retryPayment(actor, id, meta);
  }

  @Post('reservations/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('customer.reservations.manage')
  @ApiOkResponse({ type: ReservationResponse })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CustomerCancelDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.reservations.cancel(
      id,
      'CUSTOMER',
      actor,
      { userId: actor.userId },
      body.reason ?? null,
      meta,
    );
  }

  // ---- in-app notifications
  @Get('notifications')
  @RequirePermissions('customer.reservations.manage')
  @ApiOkResponse({ type: NotificationListResponse })
  inbox(@CurrentActor() actor: Actor) {
    return this.notifications.list(actor.userId);
  }

  @Post('notifications/read')
  @HttpCode(200)
  @RequirePermissions('customer.reservations.manage')
  @ApiOkResponse({ type: UpdatedResponse })
  read(@Body() body: MarkReadDto, @CurrentActor() actor: Actor) {
    return this.notifications.markRead(actor.userId, body.id ?? null);
  }
}
