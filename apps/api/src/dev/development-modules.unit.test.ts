import { describe, expect, it } from 'vitest';
import { developmentModules } from '../app.module';
import { DevCustomerExperienceModule } from '../customer-experience/customer-experience.module';
import { DevReservationPaymentsModule } from '../hot-deals/dev-reservation-payments.module';
import { DevModule } from './dev.module';

/**
 * Remote UAT (G-5): which development modules each tier registers. Staging testers can finish paid reservations, card holds,
 * saved cards and Google / Apple sign-in on the development provider pages, but never read SMS codes or TOTP codes through
 * /v1/dev (those helpers stay off in every production build). Production registers none.
 */
describe('development modules per tier', () => {
  const env = (NODE_ENV: string, APP_ENV?: string, ALLOW_MOCK_PROVIDERS = false) =>
    ({ NODE_ENV, APP_ENV, ALLOW_MOCK_PROVIDERS }) as never;

  it('local development and tests: every helper', () => {
    expect(developmentModules(env('development'))).toEqual([
      DevModule,
      DevReservationPaymentsModule,
      DevCustomerExperienceModule,
    ]);
    expect(developmentModules(env('test'))).toContain(DevModule);
  });

  it('staging with development adapters: the provider pages only (no SMS inbox, no TOTP helper)', () => {
    const mods = developmentModules(env('production', 'staging', true));
    expect(mods).toEqual([DevReservationPaymentsModule, DevCustomerExperienceModule]);
    expect(mods).not.toContain(DevModule);
  });

  it('staging without development adapters, and production: nothing', () => {
    expect(developmentModules(env('production', 'staging', false))).toEqual([]);
    expect(developmentModules(env('production', 'production', false))).toEqual([]);
    expect(developmentModules(env('production', 'production', true))).toEqual([]);
  });
});
