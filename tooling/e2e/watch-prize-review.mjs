/**
 * Founder visual review (2026-10-17): Watch & Earn instant prize journey on the REAL running customer app with the development demo
 * campaign "Win a free pastry with your coffee" (dev-demo.ts). Fresh development customers (development OTP) watch the video in the
 * browser until the SERVER awards a prize (its probability is not forced); the first non-winning view is captured too.
 * Requires the API (4000) and customer app (3001) running in development.
 *
 *   node tooling/e2e/watch-prize-review.mjs
 *
 * Screenshots -> docs/screenshots/watch-prize-review/ ; summary -> report.txt there.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const APP = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'watch-prize-review');
const PRIZE_TITLE = /win a free pastry/i;
const MAX_VIEWS = 12;
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
const hub = await get('/v1/app/watch?city=Riyadh&limit=50');
const prizeCampaign = (hub?.campaigns ?? []).find((c) => PRIZE_TITLE.test(c.title.en));
if (!prizeCampaign) {
  console.error('The development demo prize campaign is not live: run pnpm --filter @dealdash/api db:dev:demo');
  process.exit(1);
}
log(`prize campaign: ${prizeCampaign.title.en} (${prizeCampaign.id}) remaining=${prizeCampaign.instantPrize?.remaining ?? 'none'} guaranteed=${prizeCampaign.instantPrize?.guaranteed}`);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
/** A fresh development customer with set-up complete (each can qualify once per campaign). */
async function member() {
  const ctx = await browser.newContext();
  const mobile = `+96658${Math.floor(1000000 + Math.random() * 8999999)}`;
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
async function open(state, locale, path, width = 390) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    storageState: state,
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
const checks = (page) =>
  page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    dir: document.documentElement.dir || 'ltr',
  }));
async function shot(page, file, selector) {
  try {
    if (selector) {
      const el = page.locator(selector).first();
      await el.waitFor({ state: 'visible', timeout: 30_000 });
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: join(OUT, file) });
    return 'ok';
  } catch (e) {
    await page.screenshot({ path: join(OUT, file.replace('.png', '-FAIL.png')) }).catch(() => {});
    return `FAIL ${e.message.split('\n')[0]}`;
  }
}

/** Watches the prize campaign in the browser as a fresh customer; returns the session, the open page and the server's outcome. */
async function watchOnce(locale) {
  const state = await member();
  const { ctx, page, errors } = await open(state, locale, `/watch/${prizeCampaign.id}`);
  await page.getByTestId('watch-start').click();
  await page.getByTestId('player-video').waitFor({ timeout: 30_000 });
  const tap = page.getByTestId('player-tap');
  if (await tap.isVisible().catch(() => false)) await tap.click().catch(() => {});
  const outcome = page.getByTestId('player-outcome');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await outcome.isVisible().catch(() => false)) break;
    const prompt = page.getByTestId('player-prompt-confirm');
    if (await prompt.isVisible().catch(() => false)) await prompt.click().catch(() => {});
    if (await tap.isVisible().catch(() => false)) await tap.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await outcome.waitFor({ timeout: 5000 });
  const kind = await outcome.getAttribute('data-outcome');
  const won = (await page.getByTestId('prize-code').count()) > 0;
  const notWon = (await page.getByTestId('prize-not-won').count()) > 0;
  return { state, ctx, page, errors, kind, won, notWon };
}

async function journey(locale) {
  const t = (s) => `${s}-390-${locale}.png`;
  // the card on the Watch & Earn page (the prize opportunity, never a promise)
  const state0 = await member();
  for (const width of [390, 320]) {
    const { ctx, page } = await open(state0, locale, '/watch', width);
    const card = `[data-testid="watch-grid"] [data-testid="watch-card"]:has([data-testid="watch-instant"])`;
    const pill = page.locator(`${card} [data-testid="watch-instant"]`).first();
    const file = width === 390 ? t('01-watch-card') : `01b-watch-card-320-${locale}.png`;
    const res = await shot(page, file, card);
    // the pill is never cut: its content fits inside it and it stays inside its card
    const fit = await pill
      .evaluate((el) => {
        const c = el.closest('[data-testid="watch-card"]').getBoundingClientRect();
        const r = el.getBoundingClientRect();
        return el.scrollWidth <= el.clientWidth + 1 && r.left >= c.left - 1 && r.right <= c.right + 1;
      })
      .catch(() => false);
    log(`${locale} ${width}px watch card: ${res} pill="${(await pill.innerText().catch(() => '')).trim()}" fits=${fit ? 'yes' : 'NO (clipped)'}`);
    await ctx.close();
  }
  let winner = null;
  let lostShot = false;
  // both journeys are captured: keep watching (fresh customers) until there is a non-winning view AND a win
  for (let i = 1; i <= MAX_VIEWS && (!winner || !lostShot); i++) {
    const v = await watchOnce(locale);
    log(`${locale} view ${i}: outcome=${v.kind} prize=${v.won ? 'WON' : v.notWon ? 'not won' : 'no decision shown'} pageErrors=${v.errors.length}`);
    if (v.won) {
      if (winner) await v.ctx.close();
      else winner = v;
      continue;
    }
    if (v.notWon && !lostShot) {
      lostShot = true;
      await v.page.evaluate(() => window.scrollTo(0, 0));
      log(`${locale} 02-not-won: ${await shot(v.page, t('02-not-won'), '[data-testid="prize-not-won"]')}`);
      const n = await v.ctx.request.get(`${API}/v1/app/notifications`);
      const items = (await n.json()).data?.items ?? [];
      log(`${locale} non-winner notifications: ${items.map((x) => x.type).join(', ') || 'none'} (PRIZE_WON present: ${items.some((x) => x.type === 'PRIZE_WON') ? 'YES - WRONG' : 'no'})`);
    }
    await v.ctx.close();
  }
  if (!winner) {
    log(`${locale} no win in ${MAX_VIEWS} views (probability is not forced); rerun for the winner screens`);
    return;
  }
  // the win screen (the prize and its code, straight from the server's decision)
  await winner.page.evaluate(() => window.scrollTo(0, 0));
  log(`${locale} 03-win: ${await shot(winner.page, t('03-win'), '[data-testid="outcome-title"]')}`);
  log(`${locale} 03b-win-code: ${await shot(winner.page, t('03b-win-code'), '[data-testid="prize-code"]')}`);
  const c0 = await checks(winner.page);
  await winner.ctx.close();

  // the in-app notification (shared inbox: header bell -> Updates)
  const inbox = await open(winner.state, locale, '');
  const badge = (await inbox.page.locator('[data-testid="notifications-unread"]').first().innerText().catch(() => '')).trim();
  log(`${locale} 04a-header-bell: ${await shot(inbox.page, t('04a-header-bell'), null)} unreadBadge="${badge}"`);
  await inbox.page.goto(`${APP}/${locale}/reservations?tab=updates`, { waitUntil: 'networkidle' });
  await inbox.page.waitForTimeout(800);
  const note = inbox.page.locator('[data-testid="notification"][data-type="PRIZE_WON"]');
  const count = await note.count();
  log(`${locale} 04-notification: ${await shot(inbox.page, t('04-notification'), '[data-testid="notification"][data-type="PRIZE_WON"]')} prizeNotifications=${count} text="${(await note.first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim()}"`);
  // the notification opens the prize under Rewards (the redemption credential)
  await Promise.all([
    inbox.page.waitForURL(/\/rewards\/prizes\//, { timeout: 30_000 }).catch(() => undefined),
    note.first().click(),
  ]);
  await inbox.page.waitForLoadState('networkidle');
  await inbox.page.waitForTimeout(800);
  log(`${locale} notification opens: ${inbox.page.url().replace(APP, '')}`);
  log(`${locale} 06-prize-credential: ${await shot(inbox.page, t('06-prize-credential'), '[data-testid="prize-code"]')}`);
  const c1 = await checks(inbox.page);
  // Rewards -> Your prizes
  await inbox.page.goto(`${APP}/${locale}/rewards`, { waitUntil: 'networkidle' });
  await inbox.page.waitForTimeout(800);
  log(`${locale} 05-your-prizes: ${await shot(inbox.page, t('05-your-prizes'), '[data-testid="your-prizes"]')}`);
  const c2 = await checks(inbox.page);
  log(`${locale} checks: win overflow=${c0.overflow} dir=${c0.dir}; prize overflow=${c1.overflow}; rewards overflow=${c2.overflow}; pageErrors=${winner.errors.length + inbox.errors.length}`);
  // the notification carries nothing internal
  const raw = JSON.stringify(((await (await inbox.ctx.request.get(`${API}/v1/app/notifications`)).json()).data?.items ?? []).filter((x) => x.type === 'PRIZE_WON'));
  log(`${locale} notification payload exposes probability/roll/stock/code: ${/probab|roll|inventory|Bps|manual|qr/i.test(raw) ? 'YES - WRONG' : 'no'}`);
  await inbox.ctx.close();
}

await journey('en');
await journey('ar');
await browser.close();
writeFileSync(join(OUT, 'report.txt'), lines.join('\n') + '\n');
