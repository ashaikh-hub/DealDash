import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiExcludeController, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { ApiEnv } from '@dealdash/config';
import {
  Audiences,
  CurrentActor,
  Idempotent,
  Meta,
  OptionalActor,
  Public,
  RequirePermissions,
} from '../common/decorators';
import { APP_ENV } from '../common/env';
import type { Actor, RequestMeta } from '../common/request-context';
import { HomeQueryDto } from '../live-deals/dto';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../providers/interfaces';
import { MockPaymentProvider } from '../providers/mocks';
import {
  CheckoutCreateDto,
  OrderListQueryDto,
  OrderListResponse,
  OrderResponse,
  PayOrderDto,
  RefundRequestDto,
  RefundResponse,
  SupportCaseCreateDto,
  SupportCaseResponse,
  VoucherCardListResponse,
  VoucherDetailResponse,
  VoucherDiscoveryQueryDto,
  WalletDetailResponse,
  WalletListResponse,
  WalletQueryDto,
} from './dto';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { SupportCasesService } from './support-cases.service';
import { VoucherDiscoveryService } from './voucher-discovery.service';
import { WalletService } from './wallet.service';

const customerId = (actor?: Actor) => (actor?.userType === 'CUSTOMER' ? actor.userId : null);

/**
 * Customer vouchers: discovery (public), checkout, payment, My Vouchers and refund requests (signed-in customers). A voucher
 * exists in My Vouchers only after the payment provider confirmed the payment (webhook or server-side status check).
 */
@ApiTags('customer-vouchers')
@Controller('app')
@Audiences('customer')
export class CustomerVouchersController {
  constructor(
    private readonly discovery: VoucherDiscoveryService,
    private readonly payments: PaymentsService,
    private readonly wallet: WalletService,
    private readonly refunds: RefundsService,
    private readonly cases: SupportCasesService,
  ) {}

  @Get('vouchers')
  @Public()
  @ApiOkResponse({ type: VoucherCardListResponse })
  list(@Query() q: VoucherDiscoveryQueryDto, @OptionalActor() actor?: Actor) {
    return this.discovery.list(q, customerId(actor));
  }

  @Get('vouchers/:id')
  @Public()
  @ApiOkResponse({ type: VoucherDetailResponse })
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: HomeQueryDto,
    @OptionalActor() actor?: Actor,
  ) {
    return this.discovery.detail(id, customerId(actor), q);
  }

  /** Starts checkout: holds the voucher for a few minutes. Nothing is charged yet. */
  @Post('checkout')
  @Idempotent()
  @HttpCode(201)
  @RequirePermissions('customer.vouchers.manage')
  @ApiOkResponse({ type: OrderResponse })
  checkout(
    @Body() body: CheckoutCreateDto,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.payments.startCheckout(actor, body, key ?? null, meta);
  }

  @Get('orders')
  @RequirePermissions('customer.vouchers.manage')
  @ApiOkResponse({ type: OrderListResponse })
  orders(@Query() q: OrderListQueryDto, @CurrentActor() actor: Actor) {
    return this.payments.listOrders(actor.userId, q.limit);
  }

  @Get('orders/:id')
  @RequirePermissions('customer.vouchers.manage')
  @ApiOkResponse({ type: OrderResponse })
  order(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.payments.getOrder(actor.userId, id);
  }

  /** Accepts the terms and starts a payment attempt. The response carries where to complete payment. */
  @Post('orders/:id/pay')
  @Idempotent()
  @HttpCode(200)
  @RequirePermissions('customer.vouchers.manage')
  @ApiOkResponse({ type: OrderResponse })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PayOrderDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.payments.pay(actor, id, body, meta);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('customer.vouchers.manage')
  @ApiOkResponse({ type: OrderResponse })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.payments.cancelOrder(actor, id, meta);
  }

  @Get('wallet')
  @RequirePermissions('customer.vouchers.manage')
  @ApiOkResponse({ type: WalletListResponse })
  mine(@Query() q: WalletQueryDto, @CurrentActor() actor: Actor) {
    return this.wallet.list(actor.userId, q.tab, q.limit);
  }

  @Get('wallet/:id')
  @RequirePermissions('customer.vouchers.manage')
  @ApiOkResponse({ type: WalletDetailResponse })
  one(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.wallet.detail(actor.userId, id);
  }

  @Post('wallet/:id/refund')
  @Idempotent()
  @HttpCode(201)
  @RequirePermissions('customer.vouchers.manage')
  @ApiOkResponse({ type: RefundResponse })
  refund(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RefundRequestDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.refunds.requestByCustomer(actor, id, body, meta);
  }

  @Post('support-cases')
  @Idempotent()
  @HttpCode(201)
  @RequirePermissions('customer.vouchers.manage')
  @ApiOkResponse({ type: SupportCaseResponse })
  supportCase(
    @Body() body: SupportCaseCreateDto,
    @CurrentActor() actor: Actor,
    @Meta() meta: RequestMeta,
  ) {
    return this.cases.create(actor, body, meta);
  }
}

/**
 * Payment provider callbacks. Public (the provider is not a user) and protected by the provider's signature, a freshness
 * window and a unique event id. The raw body is verified exactly as received.
 */
@ApiExcludeController()
@Controller('webhooks')
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payments')
  @Public()
  @HttpCode(200)
  async payment(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-dealdash-signature') signature: string | undefined,
    @Meta() meta: RequestMeta,
  ) {
    const raw = req.rawBody?.toString('utf8');
    if (!raw) throw new BadRequestException('Empty body');
    return this.payments.handleWebhook(raw, signature, meta);
  }
}

/**
 * Development-only: stands in for the hosted payment page of a real provider. It settles the mock payment and then delivers
 * the SAME signed webhook the provider would send, through the SAME code path. Not registered in production.
 */
@ApiExcludeController()
@Controller('dev')
export class DevPaymentsController {
  constructor(
    @Inject(APP_ENV) private readonly env: ApiEnv,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly payments: PaymentsService,
  ) {}

  @Post('payments/:providerReference/complete')
  @Public()
  @HttpCode(200)
  async complete(
    @Param('providerReference') providerReference: string,
    @Body() body: { outcome?: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; duplicate?: boolean },
    @Meta() meta: RequestMeta,
  ) {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
    const outcome = body?.outcome ?? 'SUCCEEDED';
    if (this.provider instanceof MockPaymentProvider)
      this.provider.settle(providerReference, outcome);
    const { rawBody, signature } = MockPaymentProvider.buildWebhook({
      eventId: `evt_${providerReference}_${outcome}`,
      kind: 'PAYMENT',
      providerReference,
      status: outcome,
      failureCode: outcome === 'FAILED' ? 'CARD_DECLINED' : undefined,
      methodType: 'mock_card',
    });
    const first = await this.payments.handleWebhook(rawBody, signature, meta);
    // development switch to watch duplicate-callback handling in the browser
    const second = body?.duplicate
      ? await this.payments.handleWebhook(rawBody, signature, meta)
      : null;
    return { first, second };
  }
}
