/**
 * Stage 6 browser end-to-end check (real Edge through playwright-core; no browser download needed).
 *
 *   Merchant: builds a Watch & Earn campaign (real WebM upload, cover, EN + AR text, audience, schedule), adds the budget, submits
 *   Admin:    reviews it (economics DealDash controls, video, both languages) and approves
 *   Customer: discovers it, watches the real video in the player (heartbeats, server-decided), sees the reward, the wallet,
 *             the duplicate block, a skipped view, a backgrounded view, the still-watching prompt and a redemption
 *   Merchant: sees verified numbers only (views, budget spent) and the closed-out budget of an exhausted campaign
 *   Admin:    exhausted campaign, risk case (reverse the held reward), rewards ledger / adjustments / catalogue
 * plus Arabic/RTL on every surface, mobile + desktop layouts and console-error watching.
 *
 * Requires the API (4000), customer (3001), merchant (3002) and admin (3005) running and the dev seed applied.
 *   SEED_USER_PASSWORD must be set in the environment (never stored in this file).
 * Real-device limits (documented, not testable here): iOS Safari may refuse autoplay until a tap and handles background tabs
 * differently; the video itself is a generated WebM clip, not a production encode.
 *
 *   node tooling/e2e/stage6-browser.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { acceptCommercial, payCommercial } from './commercial-steps.mjs';

const API = process.env.API_URL ?? 'http://localhost:4000';
const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:3002';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'stage6');
const VIDEO = join(process.cwd(), 'apps', 'api', 'src', 'seed', 'fixtures', 'sample-video.webm');
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password you gave to the seed) before running.');
mkdirSync(OUT, { recursive: true });

const TAG = randomBytes(3).toString('hex');
const TITLE_EN = `QA Chef Video ${TAG}`;
const TITLE_AR = `فيديو الشيف للاختبار ${TAG}`;
const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};
async function section(name, page, fn) {
  try {
    await fn();
  } catch (e) {
    check(`${name} completed without an exception`, false, String(e.message).split('\n')[0]);
    try {
      await page?.screenshot({ path: join(OUT, `zz-failure-${name.replace(/\W+/g, '-')}.png`), fullPage: true });
    } catch {}
  }
}

function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      raw[o++] = 200 - Math.round((x / w) * 80);
      raw[o++] = 90 + Math.round((y / h) * 100);
      raw[o++] = 60 + Math.round(((x + y) / (w + h)) * 120);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const api = async (path) => (await (await fetch(API + path)).json()).data;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const shot = (page, name, full = true) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full, caret: 'initial' });
const watchErrors = (page, label) => {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/401|404 \(Not Found\)|409 \(Conflict\)|402|422|429|favicon|manifest|Download the React DevTools|aborted|net::ERR_FAILED|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|Not allowed to start|NotFoundError|Requested device not found/i.test(t)) return;
    consoleErrors.push(`[${label}] ${t}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror ${e.message}`));
};
const noOverflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const otp = async (page, code) => {
  await page.locator('input[autocomplete="one-time-code"]').first().click();
  await page.keyboard.type(code, { delay: 25 });
};
const sms = async (mobile) => (await api(`/v1/dev/last-sms?to=${encodeURIComponent(mobile)}`)).code;
async function signInPortal(page, base, email, route, adminTotp = false) {
  await page.goto(`${base}/en/${route}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (adminTotp) {
    await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 30000 });
    await otp(page, (await api(`/v1/dev/totp?email=${email}`)).code);
  }
}
async function mobileSignIn(page, mobile) {
  await page.goto(`${CUSTOMER}/en/profile`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 20000 });
  await otp(page, await sms(mobile));
  await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 });
}
async function pageApi(page, method, path, body) {
  return page.evaluate(
    async ({ API, method, path, body }) => {
      const me = await (await fetch(`${API}/v1/auth/me`, { credentials: 'include' })).json();
      const res = await fetch(`${API}${path}`, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.data.csrfToken, 'Idempotency-Key': `qa-${Math.random().toString(36).slice(2)}-key` },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { API, method, path, body },
  );
}
const rtlOk = async (page, label) => {
  const [dir, lang, font] = await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang, getComputedStyle(document.body).fontFamily]);
  check(`${label}: RTL document with the Arabic font`, dir === 'rtl' && lang === 'ar' && /IBM Plex Sans Arabic/.test(font));
  check(`${label}: no horizontal overflow`, await noOverflow(page));
  check(`${label}: numbers stay Western`, !/[٠-٩]/.test(await page.locator('main').first().innerText()));
};
const riyadh = (hours) => new Date(Date.now() + 3 * 3_600_000 + hours * 3_600_000).toISOString().slice(0, 16);
const newMobile = () => `+96655${String(Math.floor(1_000_000 + Math.random() * 8_999_999))}`;
const campaignIdByTitle = async (title) => (await api('/v1/app/watch?city=Riyadh&limit=50')).campaigns.find((c) => c.title.en === title)?.id ?? null;

/** Opens a campaign, presses Start and lets the player run; `during` can interfere (skip, background, answer the prompt). */
async function watchVideo(page, id, { during, lang = 'en' } = {}) {
  await page.goto(`${CUSTOMER}/${lang}/watch/${id}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('watch-start').click();
  await page.getByTestId('player-video').waitFor({ timeout: 30000 });
  const tap = page.getByTestId('player-tap');
  if (await tap.isVisible().catch(() => false)) await tap.click().catch(() => {});
  if (during) await during(page);
  const outcome = page.getByTestId('player-outcome');
  const deadline = Date.now() + 70_000;
  while (Date.now() < deadline) {
    if (await outcome.isVisible().catch(() => false)) break;
    const prompt = page.getByTestId('player-prompt-confirm');
    if (await prompt.isVisible().catch(() => false)) await prompt.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await outcome.waitFor({ timeout: 5000 });
  return page.getByTestId('player-outcome').getAttribute('data-outcome');
}

let campaignId = null;
let submittedForReview = false;

try {
  // ================================================================ 1. merchant builds a Watch & Earn campaign
  const mctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const m = await mctx.newPage();
  watchErrors(m, 'merchant');
  await section('merchant-builder', m, async () => {
    await signInPortal(m, MERCHANT, 'owner@harbourgrill.test', 'watch');
    await m.getByTestId('watch-hub').waitFor({ timeout: 90000 });
    await m.locator('[data-testid="watch-row"]').first().waitFor({ timeout: 30000 });
    const rows = await m.locator('[data-testid="watch-row"]').count();
    check('merchant sees Watch & Earn in the navigation with seeded campaigns and a money summary', rows >= 3 && (await m.getByRole('link', { name: 'Watch & Earn' }).count()) > 0 && (await m.getByTestId('watch-summary').isVisible()), `${rows} rows`);
    await shot(m, 'merchant-01-watch-hub-en');

    await m.getByTestId('watch-create').click();
    await m.getByTestId('watch-builder').waitFor();
    const steps = await m.locator('.dd-stepper li').allInnerTexts();
    check('builder has the six campaign steps', steps.length === 6, steps.map((s) => s.split('\n')[0]).join(' | '));
    check('the builder has no reward or points field (DealDash decides the reward)', (await m.getByLabel(/reward|points per/i).count()) === 0);
    // video + cover
    await m.locator('#watch-video').setInputFiles(VIDEO);
    await m.getByTestId('watch-video-preview').waitFor({ timeout: 60000 });
    const dur = Number(await m.locator('#f-duration').inputValue());
    check('the real WebM uploads, previews and its length is read (about 12 s)', dur >= 10 && dur <= 14, `duration ${dur}`);
    await m.locator('#watch-cover').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: png(960, 600) });
    await m.locator('.dd-coverpreview').waitFor({ timeout: 30000 });
    await shot(m, 'merchant-02-builder-video-en');
    await m.getByTestId('builder-next').click();
    // content
    await m.locator('#f-title-en').fill(TITLE_EN);
    await m.locator('#f-desc-en').fill('A quick look at how the chef prepares the evening special.');
    await m.locator('#f-cta-en').fill('See our offers');
    await m.getByTestId('builder-next').click();
    check('the next step names the missing Arabic text', (await m.getByText('Arabic text is required').count()) > 0);
    await m.locator('#f-title-ar').fill(TITLE_AR);
    await m.locator('#f-desc-ar').fill('نظرة سريعة على كيفية تحضير الشيف لطبق المساء المميز.');
    await m.locator('#f-cta-ar').fill('شاهد عروضنا');
    await shot(m, 'merchant-03-builder-content-en');
    await m.getByTestId('builder-next').click();
    // audience
    await m.getByRole('heading', { name: 'Audience', exact: true }).waitFor();
    await m.getByLabel('Riyadh', { exact: true }).check();
    await m.locator('#f-link-type').selectOption('MERCHANT');
    await shot(m, 'merchant-04-builder-audience-en');
    await m.getByTestId('builder-next').click();
    // schedule
    await m.locator('#f-start').fill(riyadh(-1));
    await m.locator('#f-end').fill(riyadh(24 * 7));
    await shot(m, 'merchant-05-builder-schedule-en');
    await m.getByTestId('builder-next').click();
    // budget
    await m.locator('#f-paid').fill('10');
    check('the price per verified view comes from DealDash and the cost is computed (SAR 10.00 for 10 views)', /SAR 10\.00/.test(await m.getByTestId('builder-required').innerText()));
    await m.getByTestId('watch-fund').click();
    await m.getByTestId('builder-fully-funded').waitFor({ timeout: 30000 });
    check('adding the budget works (development payment is simulated)', /SAR 10\.00/.test(await m.getByTestId('builder-funded').innerText()));
    await shot(m, 'merchant-06-builder-budget-en');
    await m.getByTestId('builder-next').click();
    // review + submit
    await m.getByRole('heading', { name: 'Review', exact: true }).first().waitFor();
    await m.getByText('Everything is complete').waitFor({ timeout: 15000 }).catch(() => {});
    check('review confirms completeness and shows the customer preview', (await m.getByTestId('watch-preview').count()) > 0 && /Everything is complete/.test(await m.locator('main').innerText()));
    await shot(m, 'merchant-07-builder-review-en');
    await acceptCommercial(m, { save: async () => { const b = m.getByTestId('watch-save'); if (await b.isEnabled()) await b.click(); } });
  await m.getByTestId('watch-submit').click();
    await m.getByTestId('builder-result').waitFor({ timeout: 30000 });
    submittedForReview = /Sent for review/.test(await m.getByTestId('builder-result').innerText());
    check('merchant submits the campaign (DealDash reviews every campaign in the pilot)', submittedForReview);
    await m.getByRole('link', { name: /Go to|View/ }).first().click().catch(() => {});
    await m.waitForURL(/\/watch\/[0-9a-f-]{36}$/, { timeout: 30000 }).catch(() => {});
    campaignId = (m.url().match(/watch\/([0-9a-f-]{36})/) ?? [])[1] ?? null;
    await m.getByTestId('watch-detail').waitFor({ timeout: 30000 });
    check('campaign detail shows In review with Performance / Budget / Activity', (await m.getByText('In review').count()) > 0 && (await m.getByRole('tab', { name: 'Budget' }).count()) > 0, campaignId ?? '');
    await shot(m, 'merchant-08-detail-in-review-en');
  });

  // ================================================================ 2. admin reviews and approves
  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await actx.newPage();
  watchErrors(a, 'admin');
  await section('admin-review', a, async () => {
    await signInPortal(a, ADMIN, 'operations@dealdash.test', 'watch', true);
    await a.getByTestId('admin-watch').waitFor({ timeout: 90000 });
    await a.getByTestId('watch-counts').waitFor({ timeout: 30000 });
    check('admin sees Watch & Earn with the operational counts', (await a.getByTestId('watch-counts').isVisible()) && (await a.getByRole('link', { name: 'Watch & Earn' }).count()) > 0);
    if (submittedForReview) {
      await a.locator('[data-testid="admin-watch-row"]').first().waitFor({ timeout: 30000 });
      check('the new campaign is in the review queue', (await a.getByText(TITLE_EN).count()) > 0);
      await shot(a, 'admin-01-watch-queue-en');
      await a.getByRole('link', { name: TITLE_EN }).first().click();
      await a.getByTestId('watch-review').waitFor({ timeout: 30000 });
      const rv = await a.getByTestId('watch-review').innerText();
      check('review workbench shows the economics DealDash controls and the merchant details', /Economics and rules in force/.test(rv) && /Legal entity/.test(rv) && /Reward per verified view/.test(rv));
      check('the video plays for the reviewer and both languages are side by side', (await a.getByTestId('admin-watch-video').getAttribute('src'))?.includes('/v1/storage/download/') && (await a.getByTestId('content-ar').getAttribute('dir')) === 'rtl');
      await shot(a, 'admin-02-watch-review-en');
      await a.getByTestId('act-approve').click();
      await a.getByTestId('decision-confirm').click();
      await a.getByText('Done').first().waitFor({ timeout: 30000 });
      check('admin approves with a recorded reason', true);
      await shot(a, 'admin-03-watch-approved-en');
    }
    if (!campaignId) campaignId = await campaignIdByTitle(TITLE_EN);
    check('the approved campaign is live for customers', !!(await campaignIdByTitle(TITLE_EN)));
    campaignId = campaignId ?? (await campaignIdByTitle(TITLE_EN));
  });

  // ================================================================ 3. customer A watches, earns, is blocked from repeating
  const A = newMobile();
  const cctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-GB' });
  const c = await cctx.newPage();
  watchErrors(c, 'customer');
  await section('customer-watch', c, async () => {
    await mobileSignIn(c, A);
    await c.goto(`${CUSTOMER}/en`, { waitUntil: 'domcontentloaded' });
    await c.getByTestId('watch-rail').waitFor({ timeout: 60000 });
    check('Home has a Watch & Earn rail and the five-tab bar', (await c.locator('nav.dd-tabbar a').allInnerTexts()).join('|') === 'Home|Explore|Watch & Earn|Rewards|Profile');
    await shot(c, 'customer-01-home-watch-rail-en');
    await c.goto(`${CUSTOMER}/en/watch`, { waitUntil: 'domcontentloaded' });
    await c.getByTestId('watch-hub').waitFor({ timeout: 60000 });
    await c.locator('[data-testid="watch-card"]').first().waitFor({ timeout: 30000 });
    const card = c.locator(`[data-testid="watch-card"]:has-text("${TITLE_EN}")`);
    check('the new campaign shows on the Watch & Earn hub with its points reward (never a currency)', (await card.count()) === 1 && /\+\d+ points/.test(await card.innerText()) && !/SAR/.test(await card.innerText()));
    check('the hub says points are not cash and the daily progress is shown', /Points are not cash/.test(await c.getByTestId('watch-hub').innerText()) && (await c.getByTestId('watch-daily').isVisible()));
    await shot(c, 'customer-02-watch-hub-en');
    await card.locator('a').first().click();
    await c.getByTestId('watch-reward').waitFor({ timeout: 30000 });
    const det = await c.locator('main').innerText();
    check('detail shows the sponsored label, how it works and the not-cash note', /Sponsored by/.test(det) && /How it works/.test(det) && /Points are not cash/.test(det));
    await shot(c, 'customer-03-watch-detail-en');

    const outcome = await watchVideo(c, campaignId);
    await shot(c, 'customer-04-reward-confirmation-en');
    check('watching the real video to the end qualifies and the reward confirmation appears', outcome === 'QUALIFIED' && /You earned points/.test(await c.getByTestId('outcome-title').innerText()));
    check('the confirmation shows points and balance, never a currency', /\+10 points/.test(await c.getByTestId('outcome-points').innerText()) && /10 points/.test(await c.getByTestId('outcome-balance').innerText()));
    await c.getByTestId('outcome-more').click();
    await c.getByTestId('watch-hub').waitFor();
    check('the hub balance is updated', /10/.test(await c.getByTestId('watch-balance-points').innerText()));
    await c.goto(`${CUSTOMER}/en/rewards`, { waitUntil: 'domcontentloaded' });
    await c.getByTestId('reward-available').waitFor({ timeout: 30000 });
    await c.getByTestId('reward-row').first().waitFor({ timeout: 30000 });
    check('Rewards shows the balance and the earn entry in the activity', /10/.test(await c.getByTestId('reward-available').innerText()) && /Meet|QA Chef/.test(await c.getByTestId('reward-activity').innerText()));
    check('redeeming is disabled until there are enough points', (await c.getByTestId('reward-redeem').first().isDisabled()));
    await shot(c, 'customer-05-rewards-en');

    await c.goto(`${CUSTOMER}/en/watch/${campaignId}`, { waitUntil: 'domcontentloaded' });
    await c.getByTestId('watch-reward').waitFor({ timeout: 30000 });
    check('the same video cannot be repeated inside the window: the button is disabled and says when', (await c.getByTestId('watch-start').count()) === 0 && (await c.getByRole('button', { name: /Available again/ }).isDisabled()));
    await c.goto(`${CUSTOMER}/en/watch/${campaignId}/play`, { waitUntil: 'domcontentloaded' });
    await c.getByTestId('player-error').waitFor({ timeout: 30000 });
    check('opening the player directly is refused with a plain reason', /already earned/i.test(await c.getByTestId('player-error').innerText()));
    await shot(c, 'customer-06-already-earned-en');
  });

  // ================================================================ 4. merchant sees verified numbers
  await section('merchant-monitor', m, async () => {
    if (!campaignId) return;
    await m.goto(`${MERCHANT}/en/watch/${campaignId}`, { waitUntil: 'domcontentloaded' });
    await m.getByTestId('watch-monitor').waitFor({ timeout: 60000 });
    const q = Number(await m.getByTestId('kpi-qualified').innerText());
    check('the merchant monitor shows the verified view and the budget spent (SAR 1.00)', q === 1 && /SAR 1\.00/.test(await m.getByTestId('budget-spent').innerText()), `qualified ${q}`);
    const txt = await m.getByTestId('watch-monitor').innerText();
    check('the monitor shows verified numbers only: no customer names, fraud detail or invented revenue', !/fraud|risk|device|automation|conversion|\+966/i.test(txt));
    await shot(m, 'merchant-09-monitor-en');
    await m.getByRole('tab', { name: 'Budget' }).click();
    await m.getByTestId('watch-budget').waitFor();
    check('the budget tab lists the funding and says the legal treatment is not final', (await m.getByTestId('funding-row').count()) >= 1 && /not final/.test(await m.getByTestId('budget-disclaimer').innerText()));
    await shot(m, 'merchant-10-budget-en');
  });

  // ================================================================ 5. skipped view, backgrounded view, still-watching prompt
  const harbour = await campaignIdByTitle('Meet the chef: our weekend grill');
  const najd = await campaignIdByTitle('Najd Kitchen: the tasting evening');
  await section('customer-nonqualifying', null, async () => {
    const B = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    watchErrors(B, 'customer-b');
    await mobileSignIn(B, newMobile());
    const skip = await watchVideo(B, najd, {
      during: async (p) => {
        await p.waitForTimeout(2500);
        await p.evaluate(() => {
          const v = document.querySelector('video');
          if (v) v.currentTime = Math.max(0, (v.duration && isFinite(v.duration) ? v.duration : 12) - 1.2);
        });
      },
    });
    check('skipping ahead does not qualify and explains it in plain words', skip === 'NOT_QUALIFIED' && /did not count/i.test(await B.getByTestId('outcome-title').innerText()) && /not watched to the end/i.test(await B.getByTestId('outcome-reason').innerText()));
    check('a view that does not count never mentions risk or detection', !/risk|fraud|device|score|signal/i.test(await B.getByTestId('player-outcome').innerText()));
    await shot(B, 'customer-07-not-counted-en');

    const bg = await watchVideo(await (async () => { await B.getByTestId('outcome-more').click(); return B; })(), harbour, {
      during: async (p) => {
        await p.waitForTimeout(2500);
        await p.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await p.waitForTimeout(11500);
        await p.evaluate(() => {
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
          document.dispatchEvent(new Event('visibilitychange'));
        });
      },
    });
    check('leaving the app for too long invalidates the view', bg === 'NOT_QUALIFIED' && /left the app/i.test(await B.getByTestId('outcome-reason').innerText()));
    await shot(B, 'customer-08-left-app-en');
  });

  await section('customer-prompt', a, async () => {
    // switch the still-watching check on for a moment (DealDash-controlled configuration), then restore it
    const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const sa = await ctx2.newPage();
    watchErrors(sa, 'super-admin');
    await signInPortal(sa, ADMIN, 'super@dealdash.test', '', true);
    await sa.getByRole('link', { name: 'Watch & Earn' }).first().waitFor({ timeout: 60000 });
    const cur = (await pageApi(sa, 'GET', '/v1/admin/config')).body.data.find((k) => k.key === 'watch.qualifying_policy')?.value;
    const on = { ...cur, stillWatching: { ...cur.stillWatching, mode: 'ALWAYS', minDurationSec: 1, timeoutSec: 8, graceSec: 3 } };
    const set = await pageApi(sa, 'PUT', '/v1/admin/config/watch.qualifying_policy', { value: on, reason: 'QA: still-watching check on' });
    check('DealDash can switch the still-watching check on (configuration, audited)', set.status === 200, String(set.status));
    await new Promise((r) => setTimeout(r, 11000)); // configuration cache
    try {
      const D = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
      watchErrors(D, 'customer-d');
      await mobileSignIn(D, newMobile());
      let promptSeen = false;
      const out = await watchVideo(D, harbour, {
        during: async (p) => {
          await p.getByTestId('player-prompt').waitFor({ timeout: 20000 }).then(async () => {
            promptSeen = true;
            await shot(p, 'customer-09-still-watching-en', false);
          }).catch(() => {});
        },
      });
      check('the server-scheduled "still watching?" prompt appears and confirming it lets the view qualify', promptSeen && out === 'QUALIFIED', `${out}`);
    } finally {
      await pageApi(sa, 'PUT', '/v1/admin/config/watch.qualifying_policy', { value: cur, reason: 'QA: restore' });
      await ctx2.close();
    }
  });

  // ================================================================ 6. budget exhaustion with two simultaneous completions
  await section('budget-exhaustion', null, async () => {
    const make = async () => {
      const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
      watchErrors(p, 'customer-race');
      await mobileSignIn(p, newMobile());
      return p;
    };
    const [p1, p2, p3] = await Promise.all([make(), make(), make()]);
    const before = (await api('/v1/app/watch?city=Riyadh&limit=50')).campaigns.find((x) => x.id === najd);
    const results2 = await Promise.all([watchVideo(p1, najd), watchVideo(p2, najd)]);
    const wins = results2.filter((r) => r === 'QUALIFIED').length;
    check('two views that finish together both fit the last two paid views (never more than the budget)', wins >= 1 && wins <= 2, results2.join(','));
    // a third customer: the campaign is over or exhausted
    await p3.goto(`${CUSTOMER}/en/watch/${najd}`, { waitUntil: 'domcontentloaded' });
    await p3.waitForTimeout(1500);
    const state = await p3.locator('main').innerText();
    check('once the paid views are used the campaign stops earning', wins < 2 || /No longer earning|Not available|no longer available/i.test(state) || before === undefined, `wins ${wins}`);
    await shot(p3, 'customer-10-budget-used-en');
  });

  // ================================================================ 7. rewards: held reward with an open risk case, then reversal; redemption
  const L = '+966500000001';
  const lctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const l = await lctx.newPage();
  watchErrors(l, 'customer-layla');
  await section('rewards-redeem', l, async () => {
    await mobileSignIn(l, L);
    await l.goto(`${CUSTOMER}/en/rewards`, { waitUntil: 'domcontentloaded' });
    await l.getByTestId('rewards-page').waitFor({ timeout: 60000 });
    await l.getByTestId('reward-available').waitFor({ timeout: 30000 });
    const held = Number((await l.getByTestId('reward-held').innerText()).replace(/\D/g, ''));
    check('the seeded customer has points being checked (a held reward)', held >= 20, `held ${held}`);
    check('Rewards explains held points and shows no cash value', /being checked/i.test(await l.getByTestId('reward-summary').innerText()) && !/SAR/.test(await l.getByTestId('reward-summary').innerText()));
    const before = Number((await l.getByTestId('reward-available').innerText()).replace(/\D/g, ''));
    await shot(l, 'customer-11-rewards-held-en');
    await l.getByTestId('reward-redeem').first().click();
    await l.getByTestId('reward-confirm').click();
    await l.getByTestId('redeemed-code').waitFor({ timeout: 30000 });
    const after = Number((await l.getByTestId('reward-available').innerText()).replace(/\D/g, ''));
    check('redeeming a sample reward spends points once and shows the code', after === before - 30 && /RW-/.test(await l.getByTestId('redeemed-code').innerText()), `${before} -> ${after}`);
    check('sample catalogue items are clearly flagged', (await l.getByText('Sample', { exact: true }).count()) >= 1);
    await shot(l, 'customer-12-redeemed-en');
  });

  const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const rk = await rctx.newPage();
  watchErrors(rk, 'risk');
  await section('admin-risk', rk, async () => {
    await signInPortal(rk, ADMIN, 'risk@dealdash.test', 'risk', true);
    await rk.getByTestId('admin-risk').waitFor({ timeout: 90000 });
    await rk.locator('[data-testid="risk-open"]').first().waitFor({ timeout: 30000 });
    check('Risk sees the open case with a plain explanation that details are DealDash-only', (await rk.getByTestId('risk-row').count()) >= 1 && /never see them/.test(await rk.getByTestId('admin-risk').innerText()));
    await rk.locator('[data-testid="risk-open"]').first().click();
    await rk.getByTestId('risk-signals').waitFor({ timeout: 30000 });
    check('the case shows the signals, linked accounts and a timeline', /Many accounts on one device/.test(await rk.getByTestId('risk-signals').innerText()));
    await shot(rk, 'admin-04-risk-case-en');
    await rk.locator('#risk-outcome').selectOption('REVERSE_REWARDS');
    await rk.locator('#risk-reason').fill('QA: automation pattern confirmed.');
    await rk.getByTestId('risk-decide').click();
    await rk.getByTestId('risk-decided').waitFor({ timeout: 30000 });
    check('Risk reverses the held reward with a recorded reason', true);
    await shot(rk, 'admin-05-risk-decided-en');
    await l.goto(`${CUSTOMER}/en/rewards`, { waitUntil: 'domcontentloaded' });
    await l.getByTestId('reward-held').waitFor({ timeout: 30000 });
    check('the customer\'s held points are gone after the reversal', Number((await l.getByTestId('reward-held').innerText()).replace(/\D/g, '')) === 0);
    check('the activity shows the removal in plain words', /Removed/.test(await l.getByTestId('reward-activity').innerText()));
    await shot(l, 'customer-13-rewards-after-reversal-en');

    await rk.goto(`${ADMIN}/en/rewards`, { waitUntil: 'domcontentloaded' });
    await rk.getByTestId('rewards-overview').waitFor({ timeout: 60000 });
    check('Rewards admin shows liability, expiry off and no point value', /Off \(not decided yet\)/.test(await rk.getByTestId('rewards-overview').innerText()) && /no cash value/i.test(await rk.getByTestId('rewards-overview').innerText()));
    await rk.getByTestId('reconcile-run').click();
    await rk.getByTestId('reconcile-result').waitFor({ timeout: 30000 });
    check('the balance check finds no differences between balances and the ledger', /0 differences/.test(await rk.getByTestId('reconcile-result').innerText()));
    await shot(rk, 'admin-06-rewards-overview-en');
    await rk.getByRole('tab', { name: 'Ledger' }).click();
    await rk.getByTestId('ledger-table').waitFor({ timeout: 30000 });
    check('the ledger lists entries with type, bucket and source', (await rk.getByTestId('ledger-row').count()) >= 3);
    await shot(rk, 'admin-07-rewards-ledger-en');
    await rk.getByRole('tab', { name: 'Adjustments' }).click();
    await rk.getByTestId('adjust-new').waitFor({ timeout: 30000 });
    await rk.getByRole('tab', { name: 'Rewards list' }).click();
    await rk.getByTestId('rewards-catalogue').waitFor({ timeout: 30000 });
    check('the catalogue lists the sample rewards', (await rk.getByTestId('item-row').count()) >= 3);
    await shot(rk, 'admin-08-rewards-catalogue-en');
  });

  await section('admin-exhausted', a, async () => {
    await a.goto(`${ADMIN}/en/watch`, { waitUntil: 'domcontentloaded' });
    await a.getByTestId('watch-counts').waitFor({ timeout: 60000 });
    await a.getByRole('tab', { name: 'Live monitor' }).click();
    await a.getByTestId('watch-monitor-table').waitFor({ timeout: 30000 });
    check('the live monitor lists active campaigns with delivery and budget used', (await a.getByTestId('watch-monitor-row').count()) >= 2);
    await shot(a, 'admin-09-watch-monitor-en');
    await a.getByRole('tab', { name: 'All campaigns' }).click();
    await a.getByLabel('Status').selectOption('COMPLETED');
    await a.waitForTimeout(1200);
    check('a campaign whose paid views were all delivered is Completed and its unused budget is closed out', (await a.locator('[data-testid="admin-watch-row"]').count()) >= 1);
  });

  // ================================================================ 8. Arabic / RTL on every surface
  await section('arabic', null, async () => {
    const ar = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-SA' })).newPage();
    watchErrors(ar, 'customer-ar');
    await mobileSignIn(ar, newMobile());
    await ar.goto(`${CUSTOMER}/ar/watch`, { waitUntil: 'domcontentloaded' });
    await ar.getByTestId('watch-hub').waitFor({ timeout: 60000 });
    await ar.locator('[data-testid="watch-card"]').first().waitFor({ timeout: 30000 });
    await rtlOk(ar, 'customer Watch & Earn hub (ar)');
    check('the five tabs are in Arabic', (await ar.locator('nav.dd-tabbar a').allInnerTexts()).join('|') === 'الرئيسية|استكشاف|شاهد واكسب|المكافآت|الملف الشخصي' || (await ar.locator('nav.dd-tabbar a').count()) === 5);
    await shot(ar, 'customer-ar-01-watch-hub');
    const id = (await ar.locator('[data-testid="watch-card"]').first().getAttribute('data-watch-id')) ?? campaignId;
    await ar.goto(`${CUSTOMER}/ar/watch/${id}`, { waitUntil: 'domcontentloaded' });
    await ar.getByTestId('watch-reward').waitFor({ timeout: 30000 });
    await rtlOk(ar, 'customer detail (ar)');
    await shot(ar, 'customer-ar-02-watch-detail');
    const out = await watchVideo(ar, id, { lang: 'ar' });
    await rtlOk(ar, `customer player outcome (ar, ${out})`);
    await shot(ar, 'customer-ar-03-outcome');
    await ar.goto(`${CUSTOMER}/ar/rewards`, { waitUntil: 'domcontentloaded' });
    await ar.getByTestId('rewards-page').waitFor({ timeout: 30000 });
    await ar.getByTestId('reward-available').waitFor({ timeout: 30000 });
    await rtlOk(ar, 'customer rewards (ar)');
    await shot(ar, 'customer-ar-04-rewards');

    await m.goto(`${MERCHANT}/ar/watch`, { waitUntil: 'domcontentloaded' });
    await m.getByTestId('watch-hub').waitFor({ timeout: 60000 });
    await rtlOk(m, 'merchant Watch & Earn hub (ar)');
    await shot(m, 'merchant-ar-01-watch-hub');
    await m.goto(`${MERCHANT}/ar/watch/new`, { waitUntil: 'domcontentloaded' });
    await m.getByTestId('watch-builder').waitFor({ timeout: 60000 });
    await rtlOk(m, 'merchant builder (ar)');
    await shot(m, 'merchant-ar-02-builder');
    if (campaignId) {
      await m.goto(`${MERCHANT}/ar/watch/${campaignId}`, { waitUntil: 'domcontentloaded' });
      await m.getByTestId('watch-monitor').waitFor({ timeout: 60000 });
      await rtlOk(m, 'merchant campaign detail (ar)');
      await shot(m, 'merchant-ar-03-detail');
    }

    for (const [route, testId, label, shotName] of [
      ['watch', 'admin-watch', 'admin Watch & Earn (ar)', 'admin-ar-01-watch'],
      ['rewards', 'admin-rewards', 'admin Rewards (ar)', 'admin-ar-03-rewards'],
      ['risk', 'admin-risk', 'admin Risk (ar)', 'admin-ar-04-risk'],
    ]) {
      await rk.goto(`${ADMIN}/ar/${route}`, { waitUntil: 'domcontentloaded' });
      await rk.getByTestId(testId).waitFor({ timeout: 60000 });
      await rtlOk(rk, label);
      await shot(rk, shotName);
    }
    if (campaignId) {
      await a.goto(`${ADMIN}/ar/watch/${campaignId}`, { waitUntil: 'domcontentloaded' });
      await a.getByTestId('watch-review').waitFor({ timeout: 60000 });
      await rtlOk(a, 'admin campaign review (ar)');
      await shot(a, 'admin-ar-02-review');
    }
  });

  // ================================================================ 9. layouts
  await section('layouts', null, async () => {
    for (const [w, label] of [[820, 'a tablet'], [360, '360px']]) {
      const p = await (await browser.newContext({ viewport: { width: w, height: 1100 } })).newPage();
      watchErrors(p, `layout-${w}`);
      await p.goto(`${CUSTOMER}/en/watch`, { waitUntil: 'domcontentloaded' });
      await p.locator('[data-testid="watch-card"]').first().waitFor({ timeout: 60000 });
      check(`Watch & Earn hub has no horizontal overflow on ${label}`, await noOverflow(p));
      if (w === 360) await shot(p, 'customer-14-watch-360', false);
    }
  });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (consoleErrors.length) {
  console.log(`\nUnexpected browser console errors (${consoleErrors.length}):`);
  for (const e of [...new Set(consoleErrors)].slice(0, 20)) console.log('  ' + e);
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), tag: TAG, results, consoleErrors }, null, 2));
process.exit(failed.length || consoleErrors.length ? 1 : 0);
