import { Body, Controller, HttpCode, Module, Post, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ConsoleAnalyticsSink, type AnalyticsEvent, type AnalyticsSink } from '@dealdash/analytics';
import { AcceptedResponse, AnalyticsBatchDto } from '../common/dto';
import { OptionalActor, Public } from '../common/decorators';
import type { Actor } from '../common/request-context';

export const ANALYTICS_SINK = Symbol('ANALYTICS_SINK');

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(@Inject(ANALYTICS_SINK) private readonly sink: AnalyticsSink) {}

  /**
   * Event ingestion (development adapter: logs and buffers). The server stamps user and organisation from the
   * session so clients cannot spoof identity; events are PII-free and never read by operational code.
   */
  @Post('events')
  @Public()
  @HttpCode(202)
  @ApiOkResponse({ type: AcceptedResponse })
  async ingest(@Body() body: AnalyticsBatchDto, @OptionalActor() actor?: Actor) {
    for (const e of body.events) {
      const event: AnalyticsEvent = {
        ...e,
        userId: actor?.userId ?? null,
        organizationId: actor?.membership?.organizationId ?? null,
      };
      await this.sink.track(event);
    }
    return { accepted: true };
  }
}

@Module({
  controllers: [AnalyticsController],
  providers: [
    {
      provide: ANALYTICS_SINK,
      useFactory: () => new ConsoleAnalyticsSink({ log: () => undefined }),
    },
  ],
  exports: [ANALYTICS_SINK],
})
export class AnalyticsModule {}
