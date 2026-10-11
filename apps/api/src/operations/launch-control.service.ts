import { Injectable, Optional } from '@nestjs/common';
import {
  CONFIG_KEYS,
  DEFAULT_LAUNCH_CONTROLS,
  launchControlsSchema,
  type LaunchAction,
  type LaunchControls,
} from '@dealdash/config';
import { AppError } from '../common/errors';
import { MarketService } from '../platform/markets/market.service';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * Stage 9: launch controls, enforced at the same points as restrictions (new reservations, purchases, Watch & Earn views) and at
 * campaign activation. A controlled pilot limits new exposure to allow-listed business accounts; a market stop refuses one kind of
 * NEW action in that market. Nothing already issued is touched: vouchers stay redeemable, reservations stay honoured, points stay.
 * With the defaults (pilot OPEN, no stop) every check returns at once.
 */
@Injectable()
export class LaunchControlService {
  constructor(
    private readonly config: SystemConfigService,
    @Optional() private readonly markets?: MarketService,
  ) {}

  async controls(): Promise<LaunchControls> {
    const raw = await this.config.get<unknown>(CONFIG_KEYS.LAUNCH_CONTROLS).catch(() => null);
    const parsed = launchControlsSchema.safeParse(raw ?? DEFAULT_LAUNCH_CONTROLS);
    // an unreadable value never opens anything up silently: it is treated as the safe default and reported by readiness
    return parsed.success ? parsed.data : DEFAULT_LAUNCH_CONTROLS;
  }

  private static stopped(c: LaunchControls, market: string, action: LaunchAction) {
    return !!c.stops[market]?.[action];
  }

  private static anyStop(c: LaunchControls) {
    return Object.values(c.stops).some((s) => Object.values(s).some(Boolean));
  }

  /** New customer exposure at a business (reservation, purchase, view). */
  async assertCustomerAction(
    organizationId: string,
    action: Exclude<LaunchAction, 'NEW_CAMPAIGNS'>,
  ) {
    const c = await this.controls();
    if (c.pilot.mode === 'ALLOWLIST' && !c.pilot.merchantOrganizationIds.includes(organizationId))
      throw new AppError('PILOT_NOT_ENABLED', 'This offer is not available yet', 409);
    if (!LaunchControlService.anyStop(c) || !this.markets) return;
    const market = await this.markets.resolveMarket(organizationId);
    if (LaunchControlService.stopped(c, market, action))
      throw new AppError(
        'LAUNCH_PAUSED',
        'This is paused for now. Anything you already have stays valid.',
        409,
      );
  }

  /** A campaign going live (merchant- or partner-owned). */
  async assertCampaignActivation(ownerOrganizationId: string, market: string | null) {
    const c = await this.controls();
    if (
      c.pilot.mode === 'ALLOWLIST' &&
      !c.pilot.merchantOrganizationIds.includes(ownerOrganizationId) &&
      !c.pilot.partnerOrganizationIds.includes(ownerOrganizationId)
    )
      throw new AppError('PILOT_NOT_ENABLED', 'This business is not part of the pilot yet', 409);
    if (!LaunchControlService.anyStop(c)) return;
    const m =
      market ?? (this.markets ? await this.markets.resolveMarket(ownerOrganizationId) : null);
    if (m && LaunchControlService.stopped(c, m, 'NEW_CAMPAIGNS'))
      throw new AppError('LAUNCH_PAUSED', 'New campaigns are paused in this market for now', 409);
  }
}
