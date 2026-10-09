import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemConfigService } from '../src/system-config/system-config.service';
import { DB_READY, createTestApp, type TestApp } from './helpers';

/** Cities are configuration, not code: the public app config reflects Admin > Configuration. */
describe.skipIf(!DB_READY)('Public app configuration (cities)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    // back to the seeded defaults for the next test file
    await t.prisma.systemConfiguration.updateMany({
      where: { key: 'discovery.enabled_cities' },
      data: { value: ['Riyadh'] },
    });
    await t.prisma.systemConfiguration.updateMany({
      where: { key: 'discovery.city_centers' },
      data: { value: { Riyadh: { nameAr: 'الرياض', latitude: 24.7136, longitude: 46.6753 } } },
    });
    t.app.get(SystemConfigService).invalidate();
    await t.close();
  });

  it('Riyadh is the initial pilot city and carries its centre, but only as configuration', async () => {
    const res = await t.http.get('/v1/app/config');
    expect(res.status).toBe(200);
    expect(res.body.data.defaultCity).toBe('Riyadh');
    expect(res.body.data.cities[0]).toMatchObject({ name: 'Riyadh', nameAr: 'الرياض' });
    expect(res.body.data.cities[0].latitude).toBeCloseTo(24.7136, 3);
  });

  it('adding a city in configuration adds it to the app and to discovery without a code change', async () => {
    const set = (key: string, value: unknown) =>
      t.prisma.systemConfiguration.upsert({
        where: { key },
        create: { key, value: value as never, version: 1 },
        update: { value: value as never },
      });
    await set('discovery.enabled_cities', ['Riyadh', 'Jeddah']);
    await set('discovery.city_centers', {
      Riyadh: { nameAr: 'الرياض', latitude: 24.7136, longitude: 46.6753 },
      Jeddah: { nameAr: 'جدة', latitude: 21.5433, longitude: 39.1728 },
    });
    t.app.get(SystemConfigService).invalidate();
    const cfg = await t.http.get('/v1/app/config');
    expect(cfg.body.data.cities.map((c: { name: string }) => c.name)).toEqual(['Riyadh', 'Jeddah']);
    expect(cfg.body.data.cities[1]).toMatchObject({ nameAr: 'جدة' });
    // the new city is enabled for discovery (an empty list, not "not live yet")
    const home = await t.http.get('/v1/app/home?city=Jeddah');
    expect(home.body.data.cityEnabled).toBe(true);
    const hot = await t.http.get('/v1/app/hot-deals?city=Jeddah');
    expect(hot.status).toBe(200);
    expect(hot.body.data).toEqual([]);
    // a city that is not configured is not live
    const off = await t.http.get('/v1/app/home?city=Dammam');
    expect(off.body.data.cityEnabled).toBe(false);
  });
});
