/**
 * Customer app visual QA before staging (real Edge through playwright-core). Extends customer-visual.mjs with:
 *  - personas: guest, "new" (signed in, profile set-up unfinished) and "member" (signed in, set-up complete). Test customers are
 *    signed in through the development OTP endpoint (/v1/dev/last-sms): no password or secret is used.
 *  - languages: English, Arabic and Urdu (Urdu and Arabic must be right-to-left)
 *  - widths: 320, 390, 412 and 1280
 *  - simulated states: empty lists, API failure, slow loading and offline
 * Per capture: horizontal overflow, page direction, elements pushed outside the viewport (outside a scroller), broken images, failed
 * requests, page errors and small tap targets. Screenshots go to .tools/qa-shots (not committed).
 *
 * Requires the API (4000) and customer (3001) apps running in development.
 *
 *   node tooling/e2e/customer-qa.mjs                   everything
 *   node tooling/e2e/customer-qa.mjs --layout          the layout matrix only
 *   node tooling/e2e/customer-qa.mjs --states          the state matrix only
 *   node tooling/e2e/customer-qa.mjs --only=/explore   screens whose path starts with this
 *   add --widths=390,1280 and/or --locales=en,ur to narrow
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const APP = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const OUT = join(process.cwd(), '.tools', 'qa-shots');
mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const arg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const runLayout = !args.includes('--states');
const runStates = !args.includes('--layout');
const only = arg('only');
const widthFilter = arg('widths')?.split(',').map(Number);
const localeFilter = arg('locales')?.split(',');

for (let ok = 0, tries = 0; ok < 2 && tries < 150; tries++) {
  ok = (await fetch(`${API}/v1/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  if (ok < 2) await new Promise((r) => setTimeout(r, 2000));
}
for (let tries = 0; tries < 150; tries++) {
  if (await fetch(`${APP}/en`).then((r) => r.ok).catch(() => false)) break;
  await new Promise((r) => setTimeout(r, 2000));
}
const get = async (p) => (await (await fetch(`${API}${p}`)).json()).data;

const WIDTHS = [
  ['small', 320, 640],
  ['iphone', 390, 844],
  ['android', 412, 915],
  ['desktop', 1280, 900],
].filter(([, w]) => !widthFilter || widthFilter.includes(w));
const LOCALES = ['en', 'ar', 'ur'].filter((l) => !localeFilter || localeFilter.includes(l));

// ---------------------------------------------------------------- live ids for detail pages
const home = await get('/v1/app/home?city=Riyadh');
const deal = home?.nearYou?.[0] ?? home?.liveNow?.[0];
const hot = (await get('/v1/app/hot-deals?city=Riyadh&limit=1'))?.[0];
const voucher = (await get('/v1/app/vouchers?city=Riyadh&limit=1'))?.[0];
const watch = (await get('/v1/app/watch?city=Riyadh'))?.campaigns?.[0];

/** [path, persona] pairs for the layout matrix. */
const SCREENS = [
  ['/', 'guest'],
  ['/', 'member'],
  ['/explore', 'guest'],
  ['/explore?view=map', 'guest'],
  ['/search?q=brunch', 'guest'],
  ['/hot', 'guest'],
  ['/vouchers', 'guest'],
  ['/watch', 'guest'],
  ['/rewards', 'member'],
  ['/benefits', 'member'],
  ['/profile', 'guest'],
  ['/profile', 'member'],
  ['/account', 'member'],
  ['/welcome', 'new'],
  ['/welcome?step=BIRTH_DATE', 'new'],
  ['/welcome?step=GENDER', 'new'],
  ['/welcome?step=CITY', 'new'],
  ['/welcome?step=INTERESTS', 'new'],
  ['/welcome?step=CONSENTS', 'new'],
  ['/reservations', 'member'],
  ['/my-vouchers', 'member'],
  ['/saved', 'member'],
  ['/cases', 'member'],
  ['/my-data', 'member'],
  ...(deal ? [[`/deals/${deal.id}`, 'guest']] : []),
  ...(deal?.merchantId ? [[`/merchants/${deal.merchantId}`, 'guest']] : []),
  ...(hot ? [[`/hot/${hot.id}`, 'member']] : []),
  ...(voucher ? [[`/vouchers/${voucher.id}`, 'member']] : []),
  ...(watch ? [[`/watch/${watch.id}`, 'member']] : []),
].filter(([p]) => !only || p.startsWith(only));

const EMPTY_HOME = {
  city: 'Riyadh',
  cityEnabled: true,
  categories: [],
  liveNow: [],
  nearYou: [],
  endingSoon: [],
};
const LIST_PATHS = new Set([
  '/v1/app/deals',
  '/v1/app/hot-deals',
  '/v1/app/vouchers',
  '/v1/app/reservations',
  '/v1/app/wallet',
  '/v1/app/saved',
  '/v1/app/notifications',
  '/v1/app/benefits/offers',
  '/v1/app/benefits/usage',
  '/v1/app/benefits/history',
  '/v1/app/me/cases',
  '/v1/app/me/data-requests',
  '/v1/app/rewards/activity',
  '/v1/app/rewards/catalogue',
]);
/** [label, path, persona, mode] for the state matrix (390 px, every language). */
const STATES = [
  ['guest-profile', '/profile', 'guest', 'normal'],
  ['guest-benefits', '/benefits', 'guest', 'normal'],
  ['guest-rewards', '/rewards', 'guest', 'normal'],
  ['guest-reservations', '/reservations', 'guest', 'normal'],
  ['guest-my-vouchers', '/my-vouchers', 'guest', 'normal'],
  ['guest-account', '/account', 'guest', 'normal'],
  ['guest-welcome', '/welcome', 'guest', 'normal'],
  ['new-home-banner', '/', 'new', 'normal'],
  ['new-profile', '/profile', 'new', 'normal'],
  ['empty-home', '/', 'guest', 'empty'],
  ['empty-explore', '/explore', 'guest', 'empty'],
  ['empty-map', '/explore?view=map', 'guest', 'empty'],
  ['empty-hot', '/hot', 'guest', 'empty'],
  ['empty-vouchers', '/vouchers', 'guest', 'empty'],
  ['empty-reservations', '/reservations', 'member', 'empty'],
  ['empty-my-vouchers', '/my-vouchers', 'member', 'empty'],
  ['empty-saved', '/saved', 'member', 'empty'],
  ['empty-benefits', '/benefits', 'member', 'empty'],
  ['empty-rewards', '/rewards', 'member', 'empty'],
  ['error-home', '/', 'guest', 'error'],
  ['error-explore', '/explore', 'guest', 'error'],
  ['error-hot', '/hot', 'guest', 'error'],
  ['error-vouchers', '/vouchers', 'guest', 'error'],
  ['error-watch', '/watch', 'guest', 'error'],
  ['error-benefits', '/benefits', 'member', 'error'],
  ['error-rewards', '/rewards', 'member', 'error'],
  ['error-account', '/account', 'member', 'error'],
  ...(deal ? [['error-deal', `/deals/${deal.id}`, 'guest', 'error']] : []),
  ['loading-home', '/', 'guest', 'loading'],
  ['loading-explore', '/explore', 'guest', 'loading'],
  ['loading-benefits', '/benefits', 'member', 'loading'],
  ['loading-account', '/account', 'member', 'loading'],
  ['offline-explore', '/explore', 'guest', 'offline'],
].filter(([, p]) => !only || p.startsWith(only));

// ---------------------------------------------------------------- personas (development OTP; no password)
const browser = await chromium.launch({ channel: 'msedge', headless: true });
async function persona(kind) {
  if (kind === 'guest') return undefined;
  const ctx = await browser.newContext();
  const mobile = `+96659${Math.floor(1000000 + Math.random() * 8999999)}`;
  await ctx.request.post(`${API}/v1/auth/otp/request`, { data: { mobile, audience: 'customer' } });
  const sms = await get(`/v1/dev/last-sms?to=${encodeURIComponent(mobile)}`);
  const res = await ctx.request.post(`${API}/v1/auth/otp/verify`, {
    data: { mobile, code: sms.code, audience: 'customer' },
  });
  const csrf = (await res.json()).data.csrfToken;
  if (kind === 'member') {
    const put = (path, data) =>
      ctx.request.put(`${API}${path}`, { data, headers: { 'X-CSRF-Token': csrf } });
    await put('/v1/app/me/profile', { firstName: 'Layla', lastName: 'QA', email: 'layla.qa@example.com' });
    await put('/v1/app/me/profile', { dateOfBirth: '1993-05-17' });
    await put('/v1/app/me/profile', { city: 'Riyadh', gender: 'PREFER_NOT_TO_SAY' });
    await put('/v1/app/me/consents', {
      source: 'ONBOARDING',
      items: [
        { kind: 'TERMS', granted: true },
        { kind: 'PRIVACY', granted: true },
        { kind: 'NOTIFICATIONS', granted: true },
      ],
    });
  }
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}
const sessions = { guest: undefined, new: await persona('new'), member: await persona('member') };

// ---------------------------------------------------------------- one capture
const slug = (p) =>
  p === '/'
    ? 'home'
    : p
        .replace(/^\//, '')
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'id')
        .replace(/\W+/g, '-');
const results = [];
async function capture({ label, path, who, locale, name, width, height, mode = 'normal' }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    storageState: sessions[who],
  });
  const page = await ctx.newPage();
  const errors = [];
  if (mode === 'error')
    await page.route(/\/v1\/app\//, (route) =>
      route.request().url().includes('/v1/app/config') ? route.continue() : route.abort(),
    );
  if (mode === 'empty')
    await page.route(/\/v1\/app\//, (route) => {
      const u = new URL(route.request().url());
      if (route.request().method() !== 'GET') return route.continue();
      if (u.pathname === '/v1/app/home')
        return route.fulfill({ json: { data: EMPTY_HOME, meta: {} } });
      if (LIST_PATHS.has(u.pathname)) return route.fulfill({ json: { data: [], meta: {} } });
      return route.continue();
    });
  if (mode === 'loading')
    await page.route(/\/v1\/app\//, async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      return route.continue().catch(() => undefined);
    });
  page.on('response', (r) => {
    if (mode !== 'normal') return;
    if (r.status() >= 400 && !(r.status() === 401 && /\/v1\/(auth\/me|me)\b/.test(r.url())))
      errors.push(`${r.status()} ${r.url().replace(API, '')}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 120)}`));
  await page.goto(`${APP}/${locale}${path === '/' ? '' : path}`, {
    waitUntil: mode === 'loading' ? 'domcontentloaded' : 'networkidle',
  });
  await page.waitForTimeout(mode === 'loading' ? 1200 : 900);
  if (mode === 'offline') {
    await ctx.setOffline(true);
    await page.waitForTimeout(500);
  }
  if (mode !== 'loading') {
    for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += height / 2) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(80);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    if (mode !== 'offline') await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(300);
  }
  const m = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
      }
      return false;
    };
    const name = (el) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
    const outside = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        const st = getComputedStyle(el);
        if (st.position === 'fixed' || st.visibility === 'hidden') return false;
        return (r.right > vw + 1 || r.left < -1) && !scroller(el);
      })
      .map(name);
    const brokenImages = [...document.images]
      .filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute('src'))
      .map((i) => i.getAttribute('src').slice(0, 60));
    const small = [...document.querySelectorAll('button, a[href], [role="button"], input, select')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return false;
        if (el.matches('input[type=checkbox], input[type=radio]')) return false;
        const inlineText = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
        return !inlineText && r.width < 32 && r.height < 32;
      })
      .map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24));
    // text that is cut off: single-line elements whose content is wider than their box without an ellipsis
    const clipped = [...document.querySelectorAll('button, .dd-pill, .dd-chip, .dd-tab, h1, h2')]
      .filter((el) => {
        const st = getComputedStyle(el);
        return el.scrollWidth > el.clientWidth + 2 && st.textOverflow !== 'ellipsis' && st.overflow === 'hidden';
      })
      .map((el) => (el.textContent || '').trim().slice(0, 24));
    // text cut off by a container that hides overflow (not a scroller, not an ellipsis by design)
    const hiddenClip = [...document.querySelectorAll('body *')]
      .filter((el) => {
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).textOverflow === 'ellipsis') return false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const st = getComputedStyle(p);
          if (st.overflowX === 'auto' || st.overflowX === 'scroll') return false;
          if (st.overflowX === 'hidden' || st.overflow === 'hidden') {
            if (st.textOverflow === 'ellipsis' || st.webkitLineClamp !== 'none') return false;
            const pr = p.getBoundingClientRect();
            return r.right > pr.right + 2 || r.left < pr.left - 2;
          }
        }
        return false;
      })
      .map((el) => `${name(el)} "${(el.textContent || '').trim().slice(0, 20)}"`);
    return {
      hiddenClip: [...new Set(hiddenClip)].slice(0, 3),
      overflow: document.documentElement.scrollWidth - vw,
      dir: document.documentElement.dir,
      outside: [...new Set(outside)].slice(0, 4),
      brokenImages,
      small: [...new Set(small)].slice(0, 4),
      clipped: clipped.slice(0, 4),
    };
  });
  const file = `${label}-${locale}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: mode !== 'loading' });
  const wantDir = locale === 'en' ? 'ltr' : 'rtl';
  const problems = [
    ...(m.overflow > 0 ? [`overflow=${m.overflow}`] : []),
    ...(m.dir !== wantDir ? [`dir=${m.dir}`] : []),
    ...(m.outside.length ? [`outside=[${m.outside.join(', ')}]`] : []),
    ...(m.brokenImages.length ? [`brokenImages=[${m.brokenImages.join(', ')}]`] : []),
    ...(m.clipped.length ? [`clipped=[${m.clipped.join(', ')}]`] : []),
    ...(m.hiddenClip.length ? [`hiddenClip=[${m.hiddenClip.join(', ')}]`] : []),
    ...(errors.length ? [`errors=[${errors.slice(0, 3).join(' | ')}]`] : []),
  ];
  const notes = m.small.length ? [`smallTargets=[${m.small.join(', ')}]`] : [];
  results.push({ label, path, who, locale, width, mode, problems, notes, file });
  console.log(
    `${problems.length ? 'FAIL' : 'PASS'}  ${label} ${locale} ${width}px ${who}${mode !== 'normal' ? ' ' + mode : ''}  ${[...problems, ...notes].join('  ')}`,
  );
  await ctx.close();
}

if (runLayout)
  for (const [path, who] of SCREENS)
    for (const locale of LOCALES)
      for (const [name, width, height] of WIDTHS)
        await capture({ label: `${slug(path)}-${who}`, path, who, locale, name, width, height });
if (runStates)
  for (const [label, path, who, mode] of STATES)
    for (const locale of LOCALES)
      await capture({ label, path, who, locale, name: 'iphone', width: 390, height: 844, mode });

await browser.close();
writeFileSync(join(process.cwd(), '.tools', 'qa-report.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => r.problems.length);
console.log(`\n${results.length} captures, ${failed.length} with problems`);
process.exit(failed.length ? 1 : 0);
