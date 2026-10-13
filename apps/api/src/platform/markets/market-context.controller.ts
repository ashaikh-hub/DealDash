import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OptionalActor, Public } from '../../common/decorators';
import type { Actor } from '../../common/request-context';
import { MarketService } from './market.service';

/**
 * Launch readiness: the market a screen should display money and time in when a value does not carry its own — the signed-in
 * business's market (its active organisation), else the customer's city's market, else the configured default market. Values from
 * Market / Country Configuration only; nothing country-specific is assumed by the apps.
 */
@ApiTags('markets')
@Controller('market-context')
export class MarketContextController {
  constructor(private readonly markets: MarketService) {}

  @Get()
  @Public()
  async context(@Query('city') city?: string, @OptionalActor() actor?: Actor) {
    const org = actor?.membership?.organizationId ?? null;
    const isDealDash = actor?.userType === 'ADMIN_USER';
    const code =
      org && !isDealDash
        ? await this.markets.resolveMarket(org)
        : await this.markets.marketOfCity(city?.slice(0, 80) ?? null);
    const p = await this.markets.profile(code);
    return {
      market: p.code,
      currency: p.currency,
      currencyDecimals: p.currencyDecimals,
      timeZone: p.timezone,
      source: org && !isDealDash ? 'ORGANIZATION' : city ? 'CITY' : 'DEFAULT',
    };
  }
}
