/**
 * Customer app visual check (real Edge through playwright-core) at 320, 390 (iPhone), 412 (Android) and 1280 (desktop, centred mobile
 * frame), in English and Arabic (RTL). Guest browsing only: no sign-in, no password needed (signed-in screens show their guest state).
 * Per screen: horizontal overflow, page direction, failed requests, and touch targets smaller than 32 x 32 px. Writes full-page and
 * first-screen screenshots to docs/screenshots/customer-visual.
 *
 * Requires the API (4000) and customer (3001) apps running.
 *
 *   node tooling/e2e/customer-visual.mjs                 Home only
 *   node tooling/e2e/customer-visual.mjs /explore /hot   the given screens
 *   node tooling/e2e/customer-visual.mjs --all           every major customer screen (detail pages use live ids from the public API)
 *   add --widths=390 to limit the widths
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const APP = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'customer-visual');
mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);

for (let ok = 0, tries = 0; ok < 2 && tries < 120; tries++) {
  ok = (await fetch(`${API}/v1/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  if (ok < 2) await new Promise((r) => setTimeout(r, 2000));
}
const get = async (p) => (await (await fetch(`${API}${p}`)).json()).data;

let paths = args.filter((a) => a.startsWith('/'));
if (args.includes('--all')) {
  const home = await get('/v1/app/home?city=Riyadh');
  const deal = home.nearYou[0] ?? home.liveNow[0];
  const hot = (await get('/v1/app/hot-deals?city=Riyadh&limit=1'))[0];
  const voucher = (await get('/v1/app/vouchers?city=Riyadh&limit=1'))[0];
  const watch = (await get('/v1/app/watch?city=Riyadh'))?.campaigns?.[0];
  paths = [
    '/',
    '/explore',
    '/search?q=brunch',
    '/search?q=zzzz-no-match',
    '/hot',
    '/vouchers',
    '/watch',
    '/rewards',
    '/profile',
    '/reservations',
    '/my-vouchers',
    '/saved',
    ...(deal ? [`/deals/${deal.id}`] : []),
    ...(deal?.merchantId ? [`/merchants/${deal.merchantId}`] : []),
    ...(hot ? [`/hot/${hot.id}`] : []),
    ...(voucher ? [`/vouchers/${voucher.id}`] : []),
    ...(watch ? [`/watch/${watch.id}`] : []),
  ];
}
if (!paths.length) paths = ['/'];
const only = args.find((a) => a.startsWith('--widths='))?.slice(9).split(',').map(Number);
const widths = [
  ['small', 320, 640],
  ['iphone', 390, 844],
  ['android', 412, 915],
  ['desktop', 1280, 900],
].filter(([, w]) => !only || only.includes(w));

const slug = (p) =>
  p === '/'
    ? 'home'
    : p
        .replace(/^\//, '')
        .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'id')
        .replace(/\W+/g, '-');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
let failures = 0;
for (const path of paths)
  for (const locale of ['en', 'ar'])
    for (const [name, width, height] of widths) {
      const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [];
      // a guest's session probe answers 401 by design; every other failed request is reported with its URL
      page.on('response', (r) => {
        if (r.status() >= 400 && !(r.status() === 401 && /\/v1\/(auth\/me|me)\b/.test(r.url())))
          errors.push(`${r.status()} ${r.url()}`);
      });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${APP}/${locale}${path === '/' ? '' : path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
      // scroll through the page so lazily-loaded card images are fetched before the full-page capture
      for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += height / 2) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(100);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      const dir = await page.evaluate(() => document.documentElement.dir);
      // interactive controls that are hard to tap (both sides under 32px), excluding inline text links
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('button, a[href], [role="button"], input, select')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height) return false;
            const inlineText = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
            return !inlineText && r.width < 32 && r.height < 32;
          })
          .map((el) => (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 24)),
      );
      const file = `${slug(path)}-${locale}-${name}.png`;
      await page.screenshot({ path: join(OUT, file), fullPage: true });
      await page.screenshot({ path: join(OUT, file.replace('.png', '-first.png')) });
      const ok = overflow <= 0 && errors.length === 0 && dir === (locale === 'ar' ? 'rtl' : 'ltr');
      if (!ok) failures++;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${slug(path)} ${locale} ${width}px  overflow=${overflow} errors=${errors.length}${errors.length ? ' [' + errors.slice(0, 2).join(' | ') + ']' : ''} smallTargets=${small.length}${small.length ? ' [' + small.slice(0, 3).join(', ') + ']' : ''}`,
      );
      await ctx.close();
    }
await browser.close();
process.exit(failures ? 1 : 0);
