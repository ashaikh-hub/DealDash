import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { ApiEnv } from '@dealdash/config';
import { APP_ENV } from '../common/env';
import { Meta, Public } from '../common/decorators';
import type { RequestMeta } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../providers/interfaces';
import { MockPaymentProvider } from '../providers/mocks';
import { PaymentsService } from '../vouchers/payments.service';
import { VouchersModule } from '../vouchers/vouchers.module';

/**
 * Development-only stand-in for a real provider's hosted page, for RESERVATION payments and card holds (phase 4, mobile testing).
 * It settles the mock payment / hold and then delivers the SAME signed webhook the provider would send, through the SAME shared
 * webhook path. Refused in production. Kept out of the voucher module so voucher code is unchanged.
 */
@ApiExcludeController()
@Controller('dev/reservations')
export class DevReservationPaymentsController {
  constructor(
    @Inject(APP_ENV) private readonly env: ApiEnv,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  private async find(providerReference: string) {
    if (this.env.NODE_ENV === 'production' || !(this.provider instanceof MockPaymentProvider))
      throw new NotFoundException();
    const hold = await this.prisma.reservationAuthorisation.findUnique({
      where: { providerReference },
      select: { reservationId: true },
    });
    const pay = hold
      ? null
      : await this.prisma.reservationPayment.findUnique({
          where: { providerReference },
          select: { reservationId: true },
        });
    const reservationId = hold?.reservationId ?? pay?.reservationId;
    if (!reservationId) throw new NotFoundException();
    return { reservationId, hold: !!hold, provider: this.provider };
  }

  /** Which reservation a mock payment / hold belongs to (the mock page shows it before approving). */
  @Get(':providerReference')
  @Public()
  async lookup(@Param('providerReference') providerReference: string) {
    const { reservationId, hold } = await this.find(providerReference);
    return { reservationId, kind: hold ? 'HOLD' : 'PAYMENT' };
  }

  @Post(':providerReference/complete')
  @Public()
  @HttpCode(200)
  async complete(
    @Param('providerReference') providerReference: string,
    @Body() body: { outcome?: 'SUCCEEDED' | 'FAILED' },
    @Meta() meta: RequestMeta,
  ) {
    const { reservationId, hold, provider } = await this.find(providerReference);
    const ok = (body?.outcome ?? 'SUCCEEDED') === 'SUCCEEDED';
    const event = hold
      ? {
          eventId: `evt_${providerReference}_${ok ? 'AUTHORISED' : 'FAILED'}`,
          kind: 'AUTHORISATION' as const,
          providerReference,
          status: ok ? ('AUTHORISED' as const) : ('FAILED' as const),
          failureCode: ok ? undefined : 'CARD_DECLINED',
        }
      : {
          eventId: `evt_${providerReference}_${ok ? 'SUCCEEDED' : 'FAILED'}`,
          kind: 'PAYMENT' as const,
          providerReference,
          status: ok ? ('SUCCEEDED' as const) : ('FAILED' as const),
          failureCode: ok ? undefined : 'CARD_DECLINED',
          methodType: 'mock_card',
        };
    if (hold) provider.settleHold(providerReference, ok ? 'AUTHORISED' : 'FAILED');
    else provider.settle(providerReference, ok ? 'SUCCEEDED' : 'FAILED');
    const { rawBody, signature } = MockPaymentProvider.buildWebhook(event);
    const result = await this.payments.handleWebhook(rawBody, signature, meta);
    return { reservationId, outcome: result.outcome };
  }
}

@Module({ imports: [VouchersModule], controllers: [DevReservationPaymentsController] })
export class DevReservationPaymentsModule {}
