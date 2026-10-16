import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CONFIG_KEYS,
  DEFAULT_RESERVATION_POLICY,
  appEnvOf,
  freeReservationAllowed,
  reservationPolicySchema,
  resolveReservationPolicy,
  type ApiEnv,
  type ResolvedReservationPolicy,
  type ReservationPolicyConfig,
} from '@dealdash/config';
import type { CommitmentPolicy, HotDealContent } from '@dealdash/validation';
import { APP_ENV } from '../common/env';
import { MarketService } from '../platform/markets/market.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';

export interface EffectiveReservationPolicy extends ResolvedReservationPolicy {
  market: string;
  marketStatus: string | null;
  currency: string | null;
  currencyDecimals: number;
  /** RC-05, already decided for this environment and market. */
  freeAllowed: boolean;
  /** The shape the commitment check (`commitmentIssues`) takes. */
  commitment: CommitmentPolicy;
}

/**
 * Reservation commitment policy (founder decision 2026-10-15, RC-10..RC-12). The governed configuration `reservation.policy` holds a
 * baseline plus market / category / merchant overrides; the effective policy for a deal is merchant > category > market > baseline,
 * field by field. FREE reservations are allowed only on development / test machines or in a TESTING market (RC-05).
 */
@Injectable()
export class ReservationPolicyService {
  private readonly logger = new Logger('ReservationPolicy');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: SystemConfigService,
    private readonly markets: MarketService,
    @Inject(APP_ENV) private readonly env: ApiEnv,
  ) {}

  /** The stored policy (validated by governance on every change; an unreadable value falls back to the safe defaults, loudly). */
  async policyConfig(): Promise<ReservationPolicyConfig> {
    const raw = await this.config.get(CONFIG_KEYS.RESERVATION_POLICY);
    const parsed = reservationPolicySchema.safeParse(raw ?? DEFAULT_RESERVATION_POLICY);
    if (parsed.success) return parsed.data;
    this.logger.error('reservation.policy is invalid; using the default policy');
    return DEFAULT_RESERVATION_POLICY;
  }

  async effective(scope: {
    market: string;
    categoryId?: string | null;
    organizationId?: string | null;
  }): Promise<EffectiveReservationPolicy> {
    const market = scope.market.toUpperCase();
    const resolved = resolveReservationPolicy(await this.policyConfig(), { ...scope, market });
    const m = await this.prisma.countryConfiguration.findUnique({
      where: { code: market },
      select: { status: true, currency: true, currencyDecimals: true },
    });
    const marketStatus = m?.status ?? null;
    const freeAllowed = freeReservationAllowed(resolved.fields.freeAllowed, {
      tier: appEnvOf(this.env),
      marketStatus,
    });
    return {
      ...resolved,
      market,
      marketStatus,
      // amounts in the policy are minor units of the market's currency (screens format them with it)
      currency: m?.currency ?? null,
      currencyDecimals: m?.currencyDecimals ?? 2,
      freeAllowed,
      commitment: { ...resolved.fields, freeAllowed },
    };
  }

  /** The policy that applies to a deal: its branches' market, its category, its business. */
  async forDeal(organizationId: string, content: HotDealContent) {
    const market = await this.markets.marketOfCampaign(organizationId, content);
    return this.effective({ market, categoryId: content.categoryId, organizationId });
  }

  /** What is kept on the deal / reservation (RC-12): the values, where each came from, and when. */
  snapshot(p: EffectiveReservationPolicy, at = new Date()) {
    return {
      market: p.market,
      marketStatus: p.marketStatus,
      freeAllowed: p.freeAllowed,
      fields: p.fields,
      source: p.source,
      resolvedAt: at.toISOString(),
    };
  }
}
