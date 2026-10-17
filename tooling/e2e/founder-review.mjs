/**
 * Founder visual review set (2026-10-16): screenshots of the REAL running customer app with the current development data.
 * Requires the API (4000) and customer app (3001) running in development. A development test customer is signed in through the
 * development OTP endpoint (no password). The reservation journeys go through the development mock payment page only.
 *
 *   node tooling/e2e/founder-review.mjs            390 px English review set + 320 / 412 / Arabic representative checks
 *
 * Screenshots -> docs/screenshots/founder-review/ ; summary -> docs/screenshots/founder-review/report.txt
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const APP = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'founder-review');
// every run starts from an empty folder so no screenshot from an earlier build is left behind
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const lines = [];
const log = (s) => {
  lines.push(s);
  console.log(s);
};

for (let ok = 0, tries = 0; ok < 2 && tries < 150; tries++) {
  ok = (await fetch(`${API}/v1/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  if (ok < 2) await new Promise((r) => setTimeout(r, 2000));
}
for (let tries = 0; tries < 150; tries++) {
  if (await fetch(`${APP}/en`).then((r) => r.ok).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 2000));
}
const get = async (p) => (await (await fetch(`${API}${p}`)).json()).data;

// ---------------------------------------------------------------- current development data: pick a free and a paid Exclusive Deal
const hotList = (await get('/v1/app/hot-deals?city=Riyadh&limit=50')) ?? [];
let freeDeal = null;
let paidDeal = null;
for (const h of hotList) {
  if (h.availability !== 'AVAILABLE') continue;
  const d = await get(`/v1/app/hot-deals/${h.id}?city=Riyadh`);
  if (!d?.reservationsEnabled || !(d.branches ?? []).some((b) => b.canReserve)) continue;
  // prefer the development demo deals with stock for the journeys (free: percentage off; paid: deposit credited to the bill)
  if (!d.commitment && (!freeDeal || /kabsa night/i.test(d.title.en))) freeDeal = d;
  if (
    d.commitment &&
    d.commitment.method !== 'CARD_PREAUTH' &&
    (!paidDeal || /weekend grill for two/i.test(d.title.en))
  )
    paidDeal = d;
}
log(`exclusive deals in Riyadh: ${hotList.length}; free reservable: ${freeDeal ? freeDeal.title.en : 'NONE'}; paid reservable: ${paidDeal ? `${paidDeal.title.en} (${paidDeal.commitment.method})` : 'NONE'}`);

// ---------------------------------------------------------------- signed-in development customer (set-up complete)
const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function member() {
  const ctx = await browser.newContext();
  const mobile = `+96659${Math.floor(1000000 + Math.random() * 8999999)}`;
  await ctx.request.post(`${API}/v1/auth/otp/request`, { data: { mobile, audience: 'customer' } });
  const sms = await get(`/v1/dev/last-sms?to=${encodeURIComponent(mobile)}`);
  const res = await ctx.request.post(`${API}/v1/auth/otp/verify`, {
    data: { mobile, code: sms.code, audience: 'customer' },
  });
  const csrf = (await res.json()).data.csrfToken;
  const put = (path, data) => ctx.request.put(`${API}${path}`, { data, headers: { 'X-CSRF-Token': csrf } });
  await put('/v1/app/me/profile', { firstName: 'Akif', lastName: 'Review', email: 'akif.review@example.com' });
  await put('/v1/app/me/profile', { dateOfBirth: '1990-04-12' });
  await put('/v1/app/me/profile', { city: 'Riyadh', gender: 'PREFER_NOT_TO_SAY' });
  await put('/v1/app/me/consents', {
    source: 'ONBOARDING',
    items: [
      { kind: 'TERMS', granted: true },
      { kind: 'PRIVACY', granted: true },
      { kind: 'NOTIFICATIONS', granted: true },
    ],
  });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}
const session = await member();

// ---------------------------------------------------------------- helpers
async function open(width, locale, path) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: session,
    // a phone in central Riyadh that shares its location (cards then show distances)
    geolocation: { latitude: 24.7136, longitude: 46.6753 },
    permissions: ['geolocation'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  await page.goto(`${APP}/${locale}${path}`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForTimeout(800);
  return { ctx, page, errors };
}
async function checks(page) {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dir: document.documentElement.dir || 'ltr',
  }));
}
const tag = (width, locale) => `${String(width)}-${locale}`;
/** Screenshot one element (scrolled into view) or the viewport. */
async function shot(page, file, selector, { viewport = false } = {}) {
  try {
    if (selector) {
      const el = page.locator(selector).first();
      await el.waitFor({ state: 'visible', timeout: 30_000 });
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      if (viewport) await page.screenshot({ path: join(OUT, file) });
      else {
        // a section shot shows the whole section: the fixed tab bar (captured on its own) must not cover the cards
        await page.addStyleTag({ content: 'nav.dd-tabbar{visibility:hidden !important}' });
        await el.screenshot({ path: join(OUT, file) });
        await page.addStyleTag({ content: 'nav.dd-tabbar{visibility:visible !important}' });
      }
    } else await page.screenshot({ path: join(OUT, file) });
    return 'ok';
  } catch (e) {
    await page.screenshot({ path: join(OUT, file.replace('.png', '-FAIL.png')) }).catch(() => {});
    return `FAIL ${e.message.split('\n')[0]}`;
  }
}

// ---------------------------------------------------------------- Home sections
const HOME_PARTS = [
  ['01-home-top', null],
  ['02-browse-offers-by', '[data-testid="home-browse-by"]'],
  ['03-hero', '.dd-hero'],
  ['04-live-deals', '[data-testid="home-live-deals"]'],
  ['05-exclusive-deals', '[data-testid="hot-rail"]'],
  ['06-watch-earn', '[data-testid="watch-rail"]'],
  ['07-vouchers', '[data-testid="voucher-rail"]'],
  ['08-rewards', '[data-testid="home-rewards"]'],
];
async function homeSet(width, locale) {
  const { ctx, page, errors } = await open(width, locale, '');
  for (const [name, sel] of HOME_PARTS) log(`${tag(width, locale)} ${name}: ${await shot(page, `${name}-${tag(width, locale)}.png`, sel)}`);
  // bottom navigation: the viewport with the fixed tab bar, scrolled into the page
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(400);
  log(`${tag(width, locale)} 09-bottom-nav: ${await shot(page, `09-bottom-nav-${tag(width, locale)}.png`, null)}`);
  // carousel density: cards available per section, and how many are fully or partly in view
  const rails = await page.evaluate(() =>
    ['home-live-deals', 'hot-rail', 'watch-rail', 'voucher-rail', 'home-ending-soon'].map((id) => {
      const rail = document.querySelector(`[data-testid="${id}"] .dd-rail`);
      if (!rail) return `${id}=none`;
      const box = rail.getBoundingClientRect();
      const cards = [...rail.children];
      const visible = cards.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.right > box.left && r.left < box.right;
      }).length;
      return `${id}=${cards.length} (in view ${visible})`;
    }),
  );
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="customer-home"] > *')]
      .map((e) => e.getAttribute('data-testid') || e.getAttribute('aria-label') || e.className.split(' ')[0])
      .filter(Boolean)
      .join(' > '),
  );
  const c = await checks(page);
  await page.screenshot({ path: join(OUT, `00-home-full-${tag(width, locale)}.png`), fullPage: true });
  log(`${tag(width, locale)} home: ${rails.join(', ')} overflow=${c.overflow} dir=${c.dir} pageErrors=${errors.length}`);
  log(`${tag(width, locale)} order: ${order}`);
  await ctx.close();
}

// ---------------------------------------------------------------- reservation journeys (development data, mock payment page)
async function journey(width, locale, deal, kind) {
  if (!deal) {
    log(`${tag(width, locale)} ${kind}: SKIPPED (no reservable ${kind} Exclusive Deal in the current development data)`);
    return;
  }
  const { ctx, page, errors } = await open(width, locale, `/hot/${deal.id}`);
  const banner = async () =>
    (await page.locator('.dd-alert, [role="status"]').allTextContents().catch(() => [])).join(' ') +
    ' ' +
    ((await page.textContent('body').catch(() => '')) ?? '');
  if (kind === 'paid') log(`${tag(width, locale)} 10-exclusive-detail: ${await shot(page, `10-exclusive-detail-${tag(width, locale)}.png`, null)}`);
  else log(`${tag(width, locale)} 11a-free-detail: ${await shot(page, `11a-free-detail-${tag(width, locale)}.png`, null)}`);
  await page.click('[data-testid="hot-reserve"]');
  await page.waitForSelector('[data-testid="reserve-sheet"]', { timeout: 30_000 });
  const radio = page.locator('[data-testid="reserve-sheet"] input[type="radio"]');
  if ((await radio.count()) > 0) await radio.first().check();
  if (kind === 'free') {
    log(`${tag(width, locale)} 11b-reserve-free: ${await shot(page, `11b-reserve-free-sheet-${tag(width, locale)}.png`, null)}`);
    await page.click('[data-testid="reserve-confirm"]');
    await page.waitForSelector('[data-testid="ticket-timer"]', { timeout: 60_000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    log(`${tag(width, locale)} 11c-free-confirmation-countdown: ${await shot(page, `11c-free-confirmation-countdown-${tag(width, locale)}.png`, null)}`);
    log(`${tag(width, locale)} 11d-free-credential: ${await shot(page, `11d-free-credential-${tag(width, locale)}.png`, '[data-testid="manual-code"]', { viewport: true })}`);
    log(`${tag(width, locale)} free confirmation says free: ${/It is free/.test(await banner()) || locale !== 'en' ? 'yes' : 'NO'}`);
  } else {
    log(`${tag(width, locale)} 12-pay-and-reserve-sheet: ${await shot(page, `12-pay-and-reserve-sheet-${tag(width, locale)}.png`, null)}`);
    await page.locator('[data-testid="sheet-terms"]').scrollIntoViewIfNeeded();
    await page.check('[data-testid="reserve-accept"]');
    await page.waitForTimeout(300);
    log(`${tag(width, locale)} 13-payment-terms: ${await shot(page, `13-payment-terms-${tag(width, locale)}.png`, null)}`);
    await page.click('[data-testid="reserve-confirm"]');
    await page.waitForSelector('[data-testid="mock-reservation-pay"]', { timeout: 60_000 });
    await page.waitForTimeout(600);
    log(`${tag(width, locale)} 13b-payment-page: ${await shot(page, `13b-payment-page-${tag(width, locale)}.png`, null)}`);
    await page.click('[data-testid="mock-approve"]');
    await page.waitForSelector('[data-testid="ticket-timer"]', { timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    log(`${tag(width, locale)} 14-reservation-success: ${await shot(page, `14-reservation-success-${tag(width, locale)}.png`, null)}`);
    const text = await banner();
    log(
      `${tag(width, locale)} paid success wording: ${/It is free|الحجز مجاني/.test(text) ? 'STILL SAYS FREE' : 'corrected (no "It is free")'}${/Payment received/.test(text) ? ', says "Payment received and your unit is secured"' : ''}`,
    );
    log(`${tag(width, locale)} 16-credential: ${await shot(page, `16-credential-${tag(width, locale)}.png`, '[data-testid="manual-code"]', { viewport: true })}`);
    await page.click('[data-testid="ticket-cancel"]');
    await page.waitForSelector('[data-testid="ticket-cancel-yes"]', { timeout: 30_000 });
    log(`${tag(width, locale)} 15a-cancel-confirm: ${await shot(page, `15a-cancel-confirm-${tag(width, locale)}.png`, null)}`);
    await page.click('[data-testid="ticket-cancel-yes"]');
    await page.waitForTimeout(2500);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    log(`${tag(width, locale)} 15b-cancelled-refund: ${await shot(page, `15b-cancelled-refund-${tag(width, locale)}.png`, '[data-testid="reservation-money"]', { viewport: true })}`);
  }
  const c = await checks(page);
  log(`${tag(width, locale)} ${kind} journey: overflow=${c.overflow} dir=${c.dir} pageErrors=${errors.length}${errors.length ? ' ' + errors[0] : ''}`);
  await ctx.close();
}

/** Where My Vouchers is reached: the header no longer carries it; the Profile menu does (founder decision pending). */
async function myVouchers(width, locale) {
  const { ctx, page } = await open(width, locale, '/profile');
  const link = page.locator('[data-testid="my-vouchers-link"]');
  const found = (await link.count()) > 0;
  if (found) {
    await link.evaluate((el) => {
      el.style.outline = '3px solid #ff4d6a';
      el.style.outlineOffset = '3px';
      el.style.borderRadius = '6px';
    });
  }
  log(`${tag(width, locale)} 17-my-vouchers-location: ${found ? await shot(page, `17-my-vouchers-location-${tag(width, locale)}.png`, '[data-testid="my-vouchers-link"]', { viewport: true }) : 'NOT FOUND'}`);
  if (found) {
    // client-side navigation: wait for the address to change before reading it
    await Promise.all([
      page.waitForURL(/\/my-vouchers/, { timeout: 30_000 }).catch(() => undefined),
      link.click(),
    ]);
    await page.waitForLoadState('networkidle');
    log(`${tag(width, locale)} my vouchers opens: ${page.url().replace(APP, '')}`);
    log(`${tag(width, locale)} 17b-my-vouchers-page: ${await shot(page, `17b-my-vouchers-page-${tag(width, locale)}.png`, null)}`);
  }
  await ctx.close();
}

/** The full Watch & Earn page (same card language as Home). */
async function watchPage(width, locale) {
  const { ctx, page, errors } = await open(width, locale, '/watch');
  const cards = await page.locator('[data-testid="watch-grid"] [data-testid="watch-card"]').count();
  log(`${tag(width, locale)} 06b-watch-page: ${await shot(page, `06b-watch-page-${tag(width, locale)}.png`, '[data-testid="watch-grid"]', { viewport: true })} cards=${cards} overflow=${(await checks(page)).overflow} pageErrors=${errors.length}`);
  await ctx.close();
}

// main review set: 390 px English
await homeSet(390, 'en');
await watchPage(390, 'en');
await watchPage(390, 'ar');
await myVouchers(390, 'en');
await journey(390, 'en', freeDeal, 'free');
await journey(390, 'en', paidDeal, 'paid');
// representative checks
await homeSet(320, 'en');
await homeSet(412, 'en');
await homeSet(390, 'ar');
await homeSet(320, 'ar');
await journey(390, 'ar', paidDeal, 'paid');

await browser.close();
writeFileSync(join(OUT, 'report.txt'), lines.join('\n') + '\n');
