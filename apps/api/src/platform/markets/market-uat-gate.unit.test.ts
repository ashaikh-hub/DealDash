import { describe, expect, it } from 'vitest';
import type { ApiEnv } from '@dealdash/config';
import type { AuditService } from '../../audit/audit.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../../system-config/system-config.service';
import { MarketService } from './market.service';

/**
 * Founder decision 2026-10-13 (Pakistan development UAT, option a): a TESTING market may take new business in development / UAT only.
 * Staging and production keep the normal lifecycle + readiness gates whatever the stored setting says; PILOT / ACTIVE are unchanged.
 */
type Env = Pick<ApiEnv, 'APP_ENV' | 'NODE_ENV'>;

function service(stored: Record<string, unknown> | null, env?: Env, status = 'TESTING') {
  const db = {
    countryConfiguration: { findUnique: async () => ({ status }) },
    marketProduct: { findUnique: async () => ({ status }) },
  } as unknown as PrismaService;
  const config = { get: async () => stored } as unknown as SystemConfigService;
  return new MarketService(db, {} as AuditService, config, null as never, env);
}

const OPT_IN = { developmentUatTestingOpen: true };
const local: Env = { NODE_ENV: 'development' } as Env; // appEnvOf -> 'local'
const development: Env = { APP_ENV: 'development', NODE_ENV: 'development' } as Env;
const test: Env = { NODE_ENV: 'test' } as Env;
const staging: Env = { APP_ENV: 'staging', NODE_ENV: 'production' } as Env;
const production: Env = { NODE_ENV: 'production' } as Env; // appEnvOf -> 'production'
const productionExplicit: Env = { APP_ENV: 'production', NODE_ENV: 'production' } as Env;

describe('development UAT gate for TESTING markets', () => {
  it('a TESTING market permits new business in development / UAT when the database opted in', async () => {
    for (const env of [local, development, test]) {
      const svc = service(OPT_IN, env);
      expect((await svc.isAvailable('PK', 'VOUCHER')).ok).toBe(true);
      const s = await svc.settings();
      expect(s.developmentUatTestingOpen).toBe(true);
      expect(s.availableStatuses).toEqual(['PILOT', 'ACTIVE', 'TESTING']);
    }
  });

  it('the same TESTING market does NOT permit new business in staging or production, even with the setting stored', async () => {
    for (const env of [staging, production, productionExplicit]) {
      const svc = service(OPT_IN, env);
      const a = await svc.isAvailable('PK', 'VOUCHER');
      expect(a).toMatchObject({ ok: false, reason: 'MARKET', marketStatus: 'TESTING' });
      const s = await svc.settings();
      expect(s.developmentUatTestingOpen).toBe(false);
      expect(s.availableStatuses).toEqual(['PILOT', 'ACTIVE']);
    }
  });

  it('stays closed without the opt-in, and when no process environment is known (hand-wired seeds / scripts)', async () => {
    expect((await service(null, development).isAvailable('PK', 'VOUCHER')).ok).toBe(false);
    expect(
      (await service({ developmentUatTestingOpen: false }, local).isAvailable('PK', 'WATCH')).ok,
    ).toBe(false);
    expect((await service(OPT_IN, undefined).isAvailable('PK', 'VOUCHER')).ok).toBe(false);
  });

  it('PILOT and ACTIVE behaviour is unchanged in every environment, with or without the opt-in', async () => {
    for (const env of [local, development, test, staging, production]) {
      for (const status of ['PILOT', 'ACTIVE'])
        for (const stored of [null, OPT_IN])
          expect((await service(stored, env, status).isAvailable('SA', 'VOUCHER')).ok).toBe(true);
      for (const status of ['PLANNED', 'CONFIGURING', 'SUSPENDED', 'CLOSED'])
        expect((await service(OPT_IN, env, status).isAvailable('SA', 'VOUCHER')).ok).toBe(false);
    }
  });

  it('a configured status list is respected; the gate only ever adds TESTING', async () => {
    const svc = service({ availableStatuses: ['ACTIVE'], ...OPT_IN }, production);
    expect((await svc.settings()).availableStatuses).toEqual(['ACTIVE']);
    expect(
      (await service({ availableStatuses: ['ACTIVE'], ...OPT_IN }, local).settings())
        .availableStatuses,
    ).toEqual(['ACTIVE', 'TESTING']);
  });
});
