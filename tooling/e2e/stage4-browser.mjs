/**
 * Stage 4 browser end-to-end check (real Edge through playwright-core; no browser download needed).
 *
 *   Merchant: creates an Exclusive Deal (EN + AR, photo, branch stock, limits), previews it, submits
 *   Admin:    reviews it (inventory, rules, both languages), requests changes, later approves
 *   Customer: sees it on Home / Exclusive Deals, reserves it FREE (no payment step), gets a QR + manual code
 *   Staff:    scans the QR with a (fake) camera, confirms, replays the QR, tries a wrong branch, types a code,
 *             and loses the connection while confirming (same Idempotency-Key on retry)
 *   Customer: sees the ticket turn into "Used"; the last unit sells out for the next customer
 *   Merchant: live monitor, reservations, results, redemptions (reverse), add stock
 *   Admin:    live monitor, restrictions (lift), reservation lookup
 * plus Arabic/RTL on every surface, responsive layouts, loading/error states and permissions.
 *
 * The QR is read from the camera by the real scanner code. Chrome's fake-camera flags feed it a video of the customer's
 * QR; that proves the scanner logic in a real browser but NOT a real phone camera (see docs/STAGE4.md: real-device test).
 *
 * Requires the API (4000), customer (3001), merchant (3002), staff (3003) and admin (3005) running and the dev seed applied.
 *   SEED_USER_PASSWORD must be set in the environment (never stored in this file).
 *
 *   node tooling/e2e/stage4-browser.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { acceptCommercial, payCommercial } from './commercial-steps.mjs';

const API = process.env.API_URL ?? 'http://localhost:4000';
const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:3002';
const STAFF = process.env.STAFF_URL ?? 'http://localhost:3003';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'stage4');
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password you gave to the seed) before running.');
mkdirSync(OUT, { recursive: true });

const TAG = randomBytes(3).toString('hex');
const TITLE_EN = `QA Flash ${TAG}`;
const TITLE_AR = `عرض سريع للاختبار ${TAG}`;
const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};

// ---- a real PNG (no image library)
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
      raw[o++] = 255 - Math.round((x / w) * 80);
      raw[o++] = 110 + Math.round((y / h) * 60);
      raw[o++] = 70 + Math.round(((x + y) / (w + h)) * 120);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- a short video (Y4M) of a QR code, for Chrome's fake camera
const requireFromShell = createRequire(join(process.cwd(), 'packages', 'app-shell', 'package.json'));
const qrcode = requireFromShell('qrcode-generator');
function qrVideo(text, file) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const total = n + 8;
  const W = 640;
  const H = 480;
  const scale = Math.floor((Math.min(W, H) * 0.86) / total);
  const ox = Math.floor((W - total * scale) / 2);
  const oy = Math.floor((H - total * scale) / 2);
  const Y = Buffer.alloc(W * H, 235);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (qr.isDark(r, c))
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) Y[(oy + (r + 4) * scale + dy) * W + ox + (c + 4) * scale + dx] = 16;
  const U = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, U, U]);
  writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...Array.from({ length: 20 }, () => frame)]));
}

const api = async (path) => (await (await fetch(API + path)).json()).data;
const edge = (extra = []) => chromium.launch({ channel: 'msedge', headless: true, args: extra });
const browser = await edge();
const shot = (page, name, full = true) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full, caret: 'initial' });
const watch = (page, label) => {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/401|404 \(Not Found\)|409 \(Conflict\)|429|favicon|manifest|Download the React DevTools|aborted|net::ERR_FAILED|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|Not allowed to start|NotFoundError|Requested device not found/i.test(t)) return; // expected 401/409 probes, deliberate offline tests, camera-less runs
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
async function mobileSignIn(page, url, mobile, waitFor) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Send code' }).click();
  try {
    await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 20000 });
  } catch (e) {
    await page.screenshot({ path: join(OUT, `zz-signin-failure-${mobile.slice(-3)}.png`), fullPage: true });
    console.log('sign-in page text:', (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300));
    throw e;
  }
  check('the OTP step is one accessible input drawn as six boxes', (await page.locator('input[autocomplete="one-time-code"]').count()) === 1 && (await page.locator('.dd-otp__box').count()) === 6 && !/tries? left|attempts? (left|remaining)/i.test(await page.locator('body').innerText()));
  await shot(page, 'staff-00-otp-en', false);
  await otp(page, await sms(mobile));
  await waitFor();
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

let customerA;
try {
  // ================================================================ 1. merchant builds an Exclusive Deal
  const mctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const m = await mctx.newPage();
  watch(m, 'merchant');
  await signInPortal(m, MERCHANT, 'owner@najdkitchen.test', 'deals/hot');
  await m.getByTestId('hot-hub').waitFor({ timeout: 90000 });
  await m.locator('[data-testid="hot-row"]').first().waitFor({ timeout: 30000 });
  const hotRows = await m.locator('[data-testid="hot-row"]').count();
  check('merchant sees the Exclusive Deals hub next to Live Deals with seeded Exclusive Deals', hotRows >= 2 && (await m.getByTestId('deals-type-switch').getByRole('link', { name: 'Live Deals' }).isVisible()), `${hotRows} rows`);
  check('hub states that reservations are free', (await m.getByText(/Reservations are free/).count()) > 0);
  await shot(m, 'merchant-01-hot-hub-en');

  await m.getByRole('link', { name: /New Exclusive Deal/ }).first().click();
  await m.getByTestId('hot-builder').waitFor();
  const steps = await m.locator('.dd-stepper li').allInnerTexts();
  check('builder has the six Exclusive Deal steps', steps.length === 6, steps.map((s) => s.split('\n')[0]).join(' | '));
  await shot(m, 'merchant-02-hot-builder-empty-en');
  await m.locator('#f-categoryId').selectOption({ label: 'Dining' });
  await m.locator('#f-mechanic').selectOption('PERCENTAGE_OFF');
  await m.locator('#f-valueNumber').fill('45');
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  await m.getByRole('heading', { name: 'Content' }).waitFor();
  await m.locator('#f-title-en').fill(TITLE_EN);
  await m.locator('#f-offerLabel-en').fill('45% off');
  await m.locator('#f-shortDescription-en').fill('Two platters only');
  await m.locator('#f-description-en').fill('A flash offer on two family platters.');
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  check('the next step is blocked and names the missing Arabic text', (await m.getByText('Arabic text is required').count()) > 0);
  await m.locator('#f-offerLabel-ar').fill('خصم 45%');
  await m.locator('#f-title-ar').fill(TITLE_AR);
  await m.locator('#f-shortDescription-ar').fill('طبقان فقط');
  await m.locator('#f-description-ar').fill('عرض سريع على طبقين عائليين.');
  await m.locator('#deal-image').setInputFiles({ name: 'platter.png', mimeType: 'image/png', buffer: png(900, 560) });
  await m.locator('#alt-en-0').waitFor({ timeout: 30000 });
  await m.locator('#alt-en-0').fill('Family platter');
  await m.locator('#alt-ar-0').fill('طبق عائلي');
  await shot(m, 'merchant-03-hot-builder-content-en');
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  await m.getByRole('heading', { name: 'Time & limits' }).waitFor();
  check('limits step offers time / quantity / both and free reservations', (await m.getByRole('button', { name: /Time only/ }).count()) > 0 && (await m.getByLabel('Customers reserve for free').isChecked()));
  await m.getByLabel('Start as soon as approved').check();
  const end = new Date(Date.now() + 3 * 3600_000 + 3 * 3600_000); // Riyadh wall clock is UTC+3
  await m.locator('#f-endAt').fill(end.toISOString().slice(0, 16));
  await shot(m, 'merchant-04-hot-builder-limits-en');
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  await m.getByRole('heading', { name: 'Branches & stock' }).waitFor();
  await m.getByLabel('Najd Kitchen Al Nakheel').check();
  await m.locator('input[id^="units-"]').first().fill('2');
  await shot(m, 'merchant-05-hot-builder-stock-en');
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  await m.getByRole('heading', { name: 'Eligibility & terms' }).waitFor();
  await m.locator('#f-terms-en').fill('Show your reservation code at the counter.');
  await m.locator('#f-terms-ar').fill('اعرض رمز الحجز عند الكاشير.');
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  await m.getByRole('heading', { name: 'Review', exact: true }).waitFor();
  await m.getByText('Everything is complete').waitFor({ timeout: 15000 }).catch(() => {});
  const reviewText = await m.locator('main').innerText();
  check('review confirms the offer is complete and will be reviewed by DealDash', /Everything is complete/.test(reviewText) && /reviewed by DealDash/i.test(reviewText), /Fix the items/.test(reviewText) ? reviewText.slice(0, 400).replace(/\s+/g, ' ') : '');
  await shot(m, 'merchant-05b-hot-builder-review-en');
  // commercial governance: the owner reviews the economics and accepts before anything can be sent to DealDash
  await acceptCommercial(m, { save: async () => { const b = m.getByTestId('hot-save'); if (await b.isEnabled()) await b.click(); } });
  check('the commercial summary shows the charge, the non-cash benefit and the acknowledgements before submitting', (await m.getByTestId('cm-total-cash').count()) > 0 && (await m.getByTestId('cm-total-benefit').count()) > 0);
  await payCommercial(m);
  await m.getByTestId('hot-submit').click();
  await m.getByTestId('builder-result').waitFor({ timeout: 30000 });
  check('merchant submits the Exclusive Deal for review', (await m.getByText('Sent for review').count()) > 0);
  await shot(m, 'merchant-06-hot-submitted-en');

  // ================================================================ 2. admin reviews
  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await actx.newPage();
  watch(a, 'admin');
  await signInPortal(a, ADMIN, 'operations@dealdash.test', 'hot-deals', true);
  await a.getByTestId('admin-hot-deals').waitFor({ timeout: 90000 });
  await a.getByRole('link', { name: TITLE_EN }).waitFor({ timeout: 30000 });
  check('the Exclusive Deal appears in the admin review queue', true);
  await shot(a, 'admin-01-hot-queue-en');
  await a.getByRole('link', { name: TITLE_EN }).click();
  await a.getByTestId('hot-review').waitFor();
  check('admin sees both languages side by side', (await a.getByTestId('content-en').getByText(TITLE_EN).count()) === 1 && (await a.getByTestId('content-ar').getByText(TITLE_AR).count()) === 1);
  check('admin sees per-branch inventory and the reservation rules (30 min hold, 3 not-completed rule)', (await a.getByTestId('admin-inventory').getByText('Najd Kitchen Al Nakheel').count()) === 1 && (await a.getByTestId('hot-rules').getByText('30 min').count()) === 1 && (await a.getByTestId('hot-rules').getByText(/3 reservations not completed/).count()) === 1);
  check('admin sees the customer preview with the free reservation model', (await a.getByTestId('admin-preview').getByText('Free to reserve').count()) > 0);
  check('admin sees the per-Hot-Deal activity feed', (await a.getByTestId('hot-activity-feed').count()) === 1);
  await shot(a, 'admin-02-hot-review-en');
  await a.getByTestId('act-request_changes').click();
  await a.getByTestId('decision-confirm').click();
  check('a decision without a reason is refused', (await a.getByText('Please give a reason (at least 3 characters)').count()) > 0);
  await a.locator('#dec-reason').fill('Please add that the offer is for dine-in only.');
  await a.locator('#dec-reason-ar').fill('يرجى ذكر أن العرض للتناول في المطعم فقط.');
  await a.getByTestId('decision-confirm').click();
  await a.getByText('Done', { exact: true }).waitFor();
  check('admin requests changes with an English and Arabic reason', (await a.getByText('Changes requested').count()) > 0);

  // merchant: sees the feedback, fixes, resubmits
  await m.goto(`${MERCHANT}/en/deals/hot`, { waitUntil: 'domcontentloaded' });
  await m.getByRole('link', { name: TITLE_EN }).click();
  await m.getByTestId('hot-detail').waitFor();
  check('merchant sees DealDash\'s reason on the Exclusive Deal', (await m.getByText('Please add that the offer is for dine-in only.').count()) > 0);
  await m.getByRole('link', { name: 'Edit', exact: true }).click();
  await m.getByTestId('hot-builder').waitFor();
  await m.getByRole('button', { name: /Eligibility & terms/ }).click();
  await m.locator('#f-terms-en').fill('Dine-in only. Show your reservation code at the counter.');
  await m.locator('#f-terms-ar').fill('للتناول في المطعم فقط. اعرض رمز الحجز عند الكاشير.');
  await m.getByRole('button', { name: /Review/ }).click();
  // commercial governance: Submit stays disabled while there are unsaved edits; saving a wording-only change keeps the accepted terms
  await m.getByTestId('hot-save').click();
  await m.waitForFunction(() => !document.querySelector('[data-testid="hot-submit"]')?.hasAttribute('disabled'), null, { timeout: 30000 });
  await m.getByTestId('hot-submit').click();
  await m.getByTestId('builder-result').waitFor({ timeout: 30000 });
  check('merchant corrects and resubmits', (await m.getByText('Sent for review').count()) > 0);
  await a.goto(`${ADMIN}/en/hot-deals`, { waitUntil: 'domcontentloaded' });
  await a.getByRole('link', { name: TITLE_EN }).click();
  await a.getByTestId('act-approve').click();
  await a.getByTestId('decision-confirm').click();
  await a.getByText('Done', { exact: true }).waitFor();
  check('admin approves; the Exclusive Deal goes Live', (await a.getByText('Live', { exact: true }).count()) > 0);

  // ================================================================ 3. customer: discover + reserve for free
  const cctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: [], locale: 'en-GB' });
  const c = await cctx.newPage();
  watch(c, 'customer');
  await c.goto(`${CUSTOMER}/en`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('customer-home').waitFor({ timeout: 90000 });
  await c.getByTestId('hot-rail').waitFor({ timeout: 30000 });
  check('guests see the Exclusive Deals rail on Home with live countdowns', (await c.getByTestId('hot-rail').locator('[data-testid="countdown"]').count()) >= 1);
  const tabs = await c.locator('nav.dd-tabbar a').allInnerTexts();
  check('customer tabs are the five approved destinations, Watch & Earn in the centre', tabs.join('|') === 'Home|Explore|Watch & Earn|Rewards|Profile', tabs.join('|'));
  check('My Deals is reachable from the header', await c.getByTestId('my-deals-link').isVisible());
  check('no horizontal overflow on the phone', await noOverflow(c));
  await shot(c, 'customer-01-home-hot-rail-en', false);
  await c.goto(`${CUSTOMER}/en/hot`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('hot-list').waitFor();
  await c.getByRole('link', { name: TITLE_EN }).first().waitFor({ timeout: 30000 });
  const soldOutCards = await c.getByText('Sold out', { exact: true }).count();
  check('Exclusive Deals list shows the new deal and keeps sold-out offers visible and marked', soldOutCards >= 1, `${soldOutCards} sold-out`);
  await shot(c, 'customer-02-hot-list-en');
  await c.getByRole('link', { name: TITLE_EN }).first().click();
  await c.getByTestId('customer-hot-deal').waitFor();
  const detailText = await c.locator('main').innerText();
  check('detail shows a live countdown, units left, and "Free to reserve"', (await c.getByTestId('hot-timer').locator('[data-testid="countdown"]').count()) === 1 && (await c.getByTestId('hot-remaining-total').innerText()) === '2' && /Free to reserve/.test(detailText));
  check('there is no payment, deposit or price anywhere in the flow', !/deposit|SAR 15|pay now|checkout|card number|\bSAR\b/i.test(detailText));
  check('a guest is asked to sign in to reserve', await c.getByTestId('hot-signin').isVisible());
  await shot(c, 'customer-03-hot-detail-guest-en', false);

  const A = '+966500000400';
  const B = '+966500000401';
  await mobileSignIn(c, `${CUSTOMER}/en/profile`, A, () => c.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 }));
  customerA = c;
  await c.goto(`${CUSTOMER}/en/hot`, { waitUntil: 'domcontentloaded' });
  await c.getByRole('link', { name: TITLE_EN }).first().click();
  await c.getByTestId('hot-reserve').click();
  await c.getByTestId('reserve-sheet').waitFor();
  check('the reserve sheet says it is free and how long it is held', (await c.getByTestId('reserve-sheet').getByText(/It is free/).count()) === 1 && (await c.getByTestId('reserve-sheet').getByText(/30 minutes/).count()) === 1);
  await shot(c, 'customer-04-reserve-sheet-en', false);
  await c.getByTestId('reserve-confirm').click();
  await c.getByTestId('reservation-ticket').waitFor({ timeout: 30000 });
  check('reserving is instant and shows a confirmation, QR code and manual code', (await c.getByText('Reservation confirmed').count()) > 0 && (await c.getByRole('img', { name: 'QR code for your reservation' }).isVisible()) && /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test((await c.getByTestId('manual-code').innerText()).trim()));
  const timer1 = await c.getByTestId('ticket-timer').innerText();
  check('the hold timer counts down from about 30 minutes', /(29|30)m|2\dm/.test(timer1.replace('\n', ' ')), timer1.replace('\n', ' '));
  await shot(c, 'customer-05-ticket-en', false);
  await shot(c, 'customer-06-ticket-en-full');
  const ticketUrl = c.url();
  const manualA = (await c.getByTestId('manual-code').innerText()).trim();
  const reservationA = ticketUrl.split('/').pop().split('?')[0];
  const detailsA = (await pageApi(c, 'GET', `/v1/app/reservations/${reservationA}`)).body.data;
  const qrA = detailsA.code.qr;
  check('the QR payload is an opaque token (not an id) and expires with the hold', /^DD1\.[A-Za-z0-9_-]{22}$/.test(qrA) && !qrA.includes(reservationA));

  // second customer takes the last unit; third finds it sold out
  const c2 = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  watch(c2, 'customer2');
  await mobileSignIn(c2, `${CUSTOMER}/en/profile`, B, () => c2.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 }));
  await c2.goto(`${CUSTOMER}/en/hot`, { waitUntil: 'domcontentloaded' });
  await c2.getByRole('link', { name: TITLE_EN }).first().click();
  await c2.getByTestId('hot-reserve').click();
  await c2.getByTestId('reserve-confirm').click();
  await c2.getByTestId('reservation-ticket').waitFor({ timeout: 30000 });
  const manualB = (await c2.getByTestId('manual-code').innerText()).trim();
  const detailsB = (await pageApi(c2, 'GET', `/v1/app/reservations/${c2.url().split('/').pop().split('?')[0]}`)).body.data;
  const c3 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await mobileSignIn(c3, `${CUSTOMER}/en/profile`, '+966500000402', () => c3.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 }));
  await c3.goto(`${CUSTOMER}/en/hot`, { waitUntil: 'domcontentloaded' });
  await c3.getByRole('link', { name: TITLE_EN }).first().click();
  await c3.getByRole('button', { name: 'Sold out' }).waitFor({ timeout: 30000 });
  check('with the last unit gone, the next customer sees "Sold out" (disabled) with an explanation', (await c3.getByRole('button', { name: 'Sold out' }).isDisabled()) && (await c3.getByText(/All units are reserved or used/).count()) > 0);
  await shot(c3, 'customer-07-sold-out-en', false);
  const raced = await pageApi(c3, 'POST', `/v1/app/hot-deals/${detailsA.deal.id}/reservations`, { branchId: detailsA.branch.id, quantity: 1 });
  check('trying anyway is refused calmly (409 OUT_OF_STOCK), stock never negative', raced.status === 409 && raced.body.errors[0].code === 'OUT_OF_STOCK');

  // My Deals
  await c.goto(`${CUSTOMER}/en/reservations`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('my-deals').waitFor();
  await c.getByTestId('reservation-row').first().waitFor();
  check('My Deals lists the active reservation', (await c.getByTestId('reservation-row').count()) >= 1 && (await c.getByText('Reserved', { exact: true }).count()) >= 1);
  await shot(c, 'customer-08-my-deals-en', false);

  // ================================================================ 4. staff scans with a (fake) camera
  const video = join(tmpdir(), `qa-qr-${TAG}.y4m`);
  qrVideo(qrA, video);
  const cam = await edge(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`]);
  const sctx = await cam.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] });
  const s = await sctx.newPage();
  watch(s, 'staff');
  const STAFF_MOBILE = '+966500000102';
  await mobileSignIn(s, `${STAFF}/en`, STAFF_MOBILE, () => s.getByTestId('staff-scan').waitFor({ timeout: 60000 }));
  check('staff sign in with a mobile OTP and land on the scanner', true);
  await s.getByTestId('scanner').waitFor();
  await shot(s, 'staff-01-scan-en', false);
  const res1 = await s.getByTestId('staff-result').waitFor({ timeout: 40000 }).then(() => s.getByTestId('staff-result'));
  check('the camera reads the QR and shows VALID with the offer, quantity and first name', (await res1.getAttribute('data-result')) === 'VALID' && (await res1.getByText(TITLE_EN).count()) === 1 && /Layla|Omar|Noura|Faisal/.test(await res1.innerText()));
  check('staff see no phone number, e-mail, campaign or finance data', !/\+966|@|finance|campaign|revenue/i.test(await s.locator('main').innerText()));
  await shot(s, 'staff-02-valid-en', false);
  await s.getByTestId('redeem-open').click();
  await s.getByTestId('redeem-sheet').waitFor({ timeout: 10000 });
  check('the Redeem button opens a confirmation sheet with a clear irreversible warning', /cannot be undone/i.test(await s.getByTestId('redeem-sheet').innerText()) && (await s.getByTestId('staff-result').getAttribute('data-result')) === 'VALID');
  await shot(s, 'staff-02b-confirm-sheet-en', false);
  await s.getByTestId('confirm-redeem').click();
  await s.getByText('Redeemed', { exact: true }).first().waitFor({ timeout: 30000 });
  check('confirming redeems and shows a reference', (await s.getByTestId('staff-result').getAttribute('data-result')) === 'REDEEMED' && /RD-[A-Z2-9]{6}/.test(await s.getByTestId('staff-result').innerText()));
  await shot(s, 'staff-03-redeemed-en', false);
  await s.getByTestId('scan-next').click();
  const res2 = await s.getByTestId('staff-result').waitFor({ timeout: 40000 }).then(() => s.getByTestId('staff-result'));
  check('scanning the same QR again reports "Already used" (replay protection)', (await res2.getAttribute('data-result')) === 'ALREADY_REDEEMED');
  await shot(s, 'staff-04-already-used-en', false);
  await s.getByTestId('scan-next').click();

  // manual fallback: type customer B's code; then offline while confirming
  await s.getByTestId('enter-code').click({ timeout: 3000 }).catch(() => {});
  await s.locator('#manual-code').fill('QQQQ-QQQQ');
  await s.getByTestId('check-code').click();
  await s.getByTestId('staff-result').waitFor();
  check('an unknown typed code reads "Code not recognised"', (await s.getByTestId('staff-result').getAttribute('data-result')) === 'INVALID_CODE');
  await shot(s, 'staff-05-invalid-en', false);
  await s.getByTestId('scan-next').click();
  await s.getByTestId('enter-code').click({ timeout: 3000 }).catch(() => {});
  await s.locator('#manual-code').fill(manualB.toLowerCase().replace('-', ' '));
  await s.getByTestId('check-code').click();
  await s.getByTestId('redeem-open').waitFor({ timeout: 30000 });
  await s.getByTestId('redeem-open').click();
  await s.getByTestId('confirm-redeem').waitFor({ timeout: 10000 });
  // a flaky connection: the confirm request is lost on its way (the phone still believes it is online)
  await s.route('**/v1/staff/redemptions', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
  await s.getByTestId('confirm-redeem').click();
  await s.getByTestId('staff-offline').waitFor({ timeout: 30000 });
  check('losing the connection while confirming shows a clear offline state with retry (no offline redemption)', (await s.getByText(/needs an internet connection/i).count()) > 0);
  await shot(s, 'staff-06-offline-en', false);
  await s.unroute('**/v1/staff/redemptions');
  await s.getByTestId('retry').click();
  await s.getByText('Redeemed', { exact: true }).first().waitFor({ timeout: 30000 });
  const refB = await s.getByTestId('staff-result').innerText();
  check('after reconnecting, retry redeems exactly once (same Idempotency-Key)', /RD-[A-Z2-9]{6}/.test(refB));
  await s.getByTestId('scan-next').click();
  // fully offline device: the banner appears and confirming is impossible
  await sctx.setOffline(true);
  await s.getByTestId('offline-banner').waitFor({ timeout: 15000 });
  check('a device that is offline shows a banner and cannot check codes', (await s.getByTestId('check-code').count()) === 0 || (await s.getByTestId('check-code').isDisabled()));
  await shot(s, 'staff-06b-offline-banner-en', false);
  await sctx.setOffline(false);
  await s.getByTestId('offline-banner').waitFor({ state: 'detached', timeout: 15000 });
  // wrong branch: reserve the seeded Najd deal at the OTHER branch and try it at Al Nakheel
  const lunch = (await pageApi(c, 'GET', '/v1/app/hot-deals?q=Lunch%20rush&limit=5')).body.data.find((d) => /Lunch rush/.test(d.title.en));
  const lunchDetail = (await pageApi(c, 'GET', `/v1/app/hot-deals/${lunch.id}`)).body.data;
  const hittin = lunchDetail.branches.find((b) => /Hittin/.test(b.name.en));
  const wrong = await pageApi(c2, 'POST', `/v1/app/hot-deals/${lunch.id}/reservations`, { branchId: hittin.id, quantity: 1 });
  check('a reservation at another branch can be made', wrong.status === 201, `${wrong.status}`);
  await s.getByTestId('enter-code').click({ timeout: 3000 }).catch(() => {});
  await s.locator('#manual-code').fill(wrong.body.data.code.manual);
  await s.getByTestId('check-code').click();
  await s.getByTestId('staff-result').waitFor();
  check('a staff member of another branch sees "Wrong branch" and where it is valid', (await s.getByTestId('staff-result').getAttribute('data-result')) === 'WRONG_BRANCH' && (await s.getByText(/valid at Najd Kitchen Hittin/).count()) > 0);
  check('Wrong branch is amber (recoverable), not red', /dd-result--warn/.test((await s.getByTestId('staff-result').getAttribute('class')) ?? ''));
  await shot(s, 'staff-07-wrong-branch-en', false);
  await s.getByTestId('scan-next').click();
  await s.getByRole('link', { name: 'History' }).click();
  await s.getByTestId('staff-history').waitFor();
  await s.getByTestId('history-row').first().waitFor({ timeout: 30000 });
  const rowsText = await s.getByTestId('history-row').allInnerTexts();
  check('staff history lists redeemed and rejected scans with counts', rowsText.length >= 4 && Number(await s.getByTestId('count-redeemed').innerText()) >= 2 && Number(await s.getByTestId('count-rejected').innerText()) >= 2, `${rowsText.length} rows`);
  await shot(s, 'staff-08-history-en');
  await s.getByTestId('history-row').first().click();
  await s.getByTestId('history-detail').waitFor({ timeout: 10000 });
  check('tapping a history row opens a detail sheet without phone or e-mail', (await s.getByTestId('history-detail').getByText('Scan details').count()) === 1 && !/\+966|@/.test(await s.getByTestId('history-detail').innerText()));
  await shot(s, 'staff-08b-history-detail-en', false);
  await s.getByTestId('history-detail').getByRole('button', { name: 'Close' }).first().click();
  await s.getByLabel('Search by code').fill('WWWW');
  await s.getByText('No scans match that code').waitFor({ timeout: 15000 });
  check('history search filters by code and shows an empty state when nothing matches', true);
  await shot(s, 'staff-08c-history-search-en', false);
  await s.getByLabel('Search by code').fill('');
  await s.getByRole('link', { name: 'Account' }).click();
  await s.getByTestId('staff-account').waitFor();
  check('staff account shows the merchant and the single branch scope', (await s.getByText('Najd Kitchen').count()) > 0 && (await s.getByText(/Al Nakheel/).count()) > 0);
  await shot(s, 'staff-09-account-en', false);

  // camera-less device: manual entry with an explanation
  const nocam = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  watch(nocam, 'staff-nocamera');
  await mobileSignIn(nocam, `${STAFF}/en`, '+966500000103', () => nocam.getByTestId('staff-scan').waitFor({ timeout: 60000 }));
  await nocam.getByTestId('manual-entry').waitFor({ timeout: 30000 });
  check('without a camera the manual code form is shown with a plain-language explanation', (await nocam.getByText(/camera/i).count()) > 0);
  await shot(nocam, 'staff-10-no-camera-en', false);

  // ================================================================ 5. customer sees "Used"; others expire
  await c.goto(ticketUrl.replace('?new=1', ''), { waitUntil: 'domcontentloaded' });
  await c.getByTestId('reservation-ticket').waitFor();
  await c.getByText(/Used on/).waitFor({ timeout: 30000 });
  check('the customer\'s ticket now reads "Used" and the QR is gone', (await c.getByTestId('manual-code').count()) === 0);
  await shot(c, 'customer-09-ticket-used-en', false);
  await c.goto(`${CUSTOMER}/en/reservations?tab=updates`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('notification').first().waitFor({ timeout: 30000 });
  const notes = await c.getByTestId('notification').allInnerTexts();
  check('in-app updates show confirmed and used events', notes.some((n) => /Reservation confirmed/.test(n)) && notes.some((n) => /Used at/.test(n)), notes.map((n) => n.split('\n')[0]).join(' | '));
  await shot(c, 'customer-10-updates-en', false);

  // cancel flow with a fresh reservation
  const lunchOnly = await pageApi(c, 'POST', `/v1/app/hot-deals/${lunch.id}/reservations`, { branchId: lunchDetail.branches[0].id, quantity: 1 });
  await c.goto(`${CUSTOMER}/en/reservations/${lunchOnly.body.data.id}`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('ticket-cancel').click();
  await c.getByTestId('ticket-cancel-yes').click();
  await c.getByText('Cancelled by you').first().waitFor({ timeout: 30000 });
  check('the customer can cancel; the units go back and the ticket shows "Cancelled by you"', (await c.getByTestId('manual-code').count()) === 0);
  await shot(c, 'customer-11-cancelled-en', false);

  // ================================================================ 6. merchant monitor + redemptions
  await m.goto(`${MERCHANT}/en/deals/hot`, { waitUntil: 'domcontentloaded' });
  await m.getByRole('link', { name: TITLE_EN }).click();
  await m.getByTestId('hot-monitor').waitFor();
  check('live monitor shows 0 available, 0 reserved, 2 used for the sold-out deal', (await m.getByTestId('kpi-available').innerText()).startsWith('0') && (await m.getByTestId('kpi-redeemed').innerText()).startsWith('2'));
  check('monitor shows no revenue or sales figures', !/revenue|SAR\s*\d|sales/i.test((await m.getByTestId('hot-monitor').innerText()).replace('DealDash does not measure sales or revenue.', '')));
  await shot(m, 'merchant-07-hot-monitor-en');
  await m.getByRole('tab', { name: 'Reservations' }).click();
  await m.getByTestId('res-row').first().waitFor();
  const resRows = await m.getByTestId('res-row').allInnerTexts();
  check('reservations tab shows first name and the last four characters only', resRows.length === 2 && !/\+966|@|DD1\./.test(resRows.join(' ')));
  await shot(m, 'merchant-08-hot-reservations-en');
  await m.getByRole('tab', { name: 'Results' }).click();
  await m.getByTestId('hot-results').waitFor();
  check('results show the measurable funnel with a no-revenue note', (await m.getByText(/does not measure sales or revenue/).count()) > 0);
  await shot(m, 'merchant-09-hot-results-en');
  await m.getByRole('tab', { name: 'Activity' }).click();
  await m.getByTestId('hot-activity').waitFor();
  await shot(m, 'merchant-10-hot-activity-en');
  // adding stock to a live deal raises the commercial commitment: commercial governance asks for the amendment to be accepted first
  await m.getByTestId('open-stock').click();
  await m.getByTestId('stock-confirm').click();
  await m.getByText(/Stock updated|Review the amended terms and accept them first/).first().waitFor({ timeout: 30000 });
  check('adding stock to a sold-out Exclusive Deal is governed: done, or the commercial amendment is requested first', true);
  await shot(m, 'merchant-11-hot-stock-added-en');
  await m.goto(`${MERCHANT}/en/redemptions`, { waitUntil: 'domcontentloaded' });
  await m.getByTestId('redemption-row').first().waitFor({ timeout: 30000 });
  check('the Redemptions page lists both redemptions with staff and method', (await m.getByTestId('redemption-row').count()) >= 2);
  await shot(m, 'merchant-12-redemptions-en');
  await m.getByTestId('reverse-open').first().click();
  check('reversal needs a reason', await m.getByTestId('reverse-confirm').isDisabled());
  await m.getByLabel(/Reason/).fill('Scanned the wrong customer (QA)');
  await m.getByTestId('reverse-confirm').click();
  await m.getByText('Use reversed').waitFor({ timeout: 30000 });
  check('a manager can reverse a redemption with a reason (staff cannot)', true);
  await shot(m, 'merchant-13-redemption-reversed-en');

  // ================================================================ 7. admin monitor, restrictions, lookup
  await a.goto(`${ADMIN}/en/hot-deals`, { waitUntil: 'domcontentloaded' });
  await a.getByRole('tab', { name: 'Live monitor' }).click();
  await a.getByTestId('admin-hot-monitor').waitFor({ timeout: 30000 });
  const kpi = async (id) => parseInt((await a.getByTestId(id).innerText()).split('\n')[0], 10);
  check('admin live monitor shows counts and last-24-hours reservation activity', (await kpi('k-created')) >= 3 && (await kpi('k-used')) >= 2, `created=${await kpi('k-created')} used=${await kpi('k-used')}`);
  await shot(a, 'admin-03-hot-monitor-en');
  await a.goto(`${ADMIN}/en/reservations`, { waitUntil: 'domcontentloaded' });
  await a.getByTestId('restrictions-table').waitFor({ timeout: 30000 });
  check('admin sees the seeded temporary restriction (masked number) and can lift it', (await a.getByTestId('lift-open').count()) >= 1 && /•••/.test(await a.getByTestId('restrictions-table').innerText()));
  await shot(a, 'admin-04-restrictions-en');
  await a.getByTestId('lift-open').first().click();
  await a.getByLabel(/Reason/).fill('Customer contacted support (QA)');
  await a.getByTestId('reason-confirm').click();
  await a.getByText('Restriction lifted').waitFor({ timeout: 30000 });
  check('lifting a restriction requires and records a reason', true);
  await a.getByRole('tab', { name: 'Find a reservation' }).click();
  await a.getByLabel('Find a reservation').fill(detailsB.publicRef);
  await a.getByRole('button', { name: 'Search' }).click();
  await a.getByTestId('found-reservation').first().waitFor({ timeout: 30000 });
  check('admin finds a reservation by its reference', (await a.getByTestId('found-reservation').count()) === 1);
  await shot(a, 'admin-05-reservation-lookup-en');

  // ================================================================ 8. Arabic / RTL on every surface
  await c.goto(`${CUSTOMER}/ar`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('hot-rail').waitFor({ timeout: 60000 });
  await rtlOk(c, 'customer home (ar)');
  await shot(c, 'customer-12-home-hot-ar', false);
  await c.goto(`${CUSTOMER}/ar/hot`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('hot-list').waitFor();
  await c.getByRole('link', { name: TITLE_AR }).first().waitFor({ timeout: 30000 });
  await rtlOk(c, 'customer Exclusive Deals (ar)');
  await shot(c, 'customer-13-hot-list-ar');
  await c.getByRole('link', { name: TITLE_AR }).first().click();
  await c.getByTestId('customer-hot-deal').waitFor();
  await rtlOk(c, 'customer Exclusive Deal detail (ar)');
  await shot(c, 'customer-14-hot-detail-ar', false);
  const ar2 = await pageApi(c, 'POST', `/v1/app/hot-deals/${lunch.id}/reservations`, { branchId: lunchDetail.branches[0].id, quantity: 1 });
  await c.goto(`${CUSTOMER}/ar/reservations/${ar2.body.data.id}`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('reservation-ticket').waitFor();
  await rtlOk(c, 'customer ticket (ar)');
  check('Arabic ticket keeps the QR payload and manual code left-to-right', (await c.getByTestId('manual-code').evaluate((el) => getComputedStyle(el).direction)) === 'ltr');
  await shot(c, 'customer-15-ticket-ar', false);
  await c.goto(`${CUSTOMER}/ar/reservations?tab=past`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('my-deals').waitFor();
  await rtlOk(c, 'My Deals (ar)');
  await shot(c, 'customer-16-my-deals-ar', false);
  await m.goto(`${MERCHANT}/ar/deals/hot`, { waitUntil: 'domcontentloaded' });
  await m.getByTestId('hot-hub').waitFor({ timeout: 60000 });
  await rtlOk(m, 'merchant Exclusive Deals (ar)');
  await shot(m, 'merchant-14-hot-hub-ar');
  await m.getByRole('link', { name: TITLE_AR }).click();
  await m.getByTestId('hot-monitor').waitFor();
  await rtlOk(m, 'merchant live monitor (ar)');
  await shot(m, 'merchant-15-hot-monitor-ar');
  await m.goto(`${MERCHANT}/ar/deals/hot/new`, { waitUntil: 'domcontentloaded' });
  await m.getByTestId('hot-builder').waitFor();
  await rtlOk(m, 'merchant Exclusive Deal builder (ar)');
  await shot(m, 'merchant-16-hot-builder-ar');
  await a.goto(`${ADMIN}/ar/hot-deals`, { waitUntil: 'domcontentloaded' });
  await a.getByTestId('admin-hot-deals').waitFor({ timeout: 60000 });
  await rtlOk(a, 'admin Exclusive Deals (ar)');
  await shot(a, 'admin-06-hot-queue-ar');
  await a.getByRole('tab', { name: 'كل العروض الحصرية' }).click();
  await a.getByRole('link', { name: TITLE_AR }).first().click();
  await a.getByTestId('hot-review').waitFor();
  await rtlOk(a, 'admin Exclusive Deal review (ar)');
  await shot(a, 'admin-07-hot-review-ar');
  await s.goto(`${STAFF}/ar`, { waitUntil: 'domcontentloaded' });
  await s.getByTestId('staff-scan').waitFor({ timeout: 60000 });
  await rtlOk(s, 'staff scan (ar)');
  await shot(s, 'staff-11-scan-ar', false);
  // the (fake) camera is still looking at customer A's QR: the scanner reads it again and reports it as already used
  await s.getByTestId('staff-result').waitFor({ timeout: 40000 });
  await rtlOk(s, 'staff result (ar)');
  check('Arabic staff result is shown in Arabic', (await s.getByText('سبق استخدامه').count()) > 0);
  await shot(s, 'staff-12-already-used-ar', false);
  await s.getByTestId('scan-next').click();
  await s.getByRole('link', { name: 'السجل' }).click();
  await s.getByTestId('staff-history').waitFor();
  await rtlOk(s, 'staff history (ar)');
  await shot(s, 'staff-13-history-ar');

  // responsive: tablet-width merchant monitor and small phone customer ticket
  await m.setViewportSize({ width: 820, height: 1000 });
  await m.goto(`${MERCHANT}/en/deals/hot`, { waitUntil: 'domcontentloaded' });
  await m.getByTestId('hot-hub').waitFor();
  check('merchant Exclusive Deals hub fits a tablet width', await noOverflow(m));
  await c.setViewportSize({ width: 360, height: 700 });
  await c.goto(`${CUSTOMER}/en/hot`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('hot-list').waitFor();
  check('customer Exclusive Deals fits a 360px phone', await noOverflow(c));
  await shot(c, 'customer-17-hot-list-360-en', false);
  await s.setViewportSize({ width: 360, height: 640 });
  await s.goto(`${STAFF}/en`, { waitUntil: 'domcontentloaded' });
  await s.getByTestId('staff-scan').waitFor();
  check('staff scanner fits a small 360px phone', await noOverflow(s));

  // ================================================================ 9. states and permissions
  const probe = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  watch(probe, 'states');
  await probe.route('**/v1/app/hot-deals**', (route) => route.abort());
  await probe.goto(`${CUSTOMER}/en/hot`, { waitUntil: 'domcontentloaded' });
  await probe.getByText(/could not load deals/i).waitFor({ timeout: 30000 });
  check('Exclusive Deals shows an error state with retry when the API is unreachable', await probe.getByRole('button', { name: 'Try again' }).isVisible());
  await shot(probe, 'customer-18-hot-error-en', false);
  await probe.unroute('**/v1/app/hot-deals**');
  await probe.goto(`${CUSTOMER}/en/hot/11111111-1111-4111-8111-111111111111`, { waitUntil: 'domcontentloaded' });
  await probe.getByText('This Exclusive Deal is not available any more').waitFor({ timeout: 30000 });
  check('a missing or hidden Exclusive Deal shows a friendly not-available state', true);
  await shot(probe, 'customer-19-hot-missing-en', false);
  await probe.goto(`${CUSTOMER}/en/reservations`, { waitUntil: 'domcontentloaded' });
  await probe.getByText('Sign in to see your reservations').waitFor({ timeout: 30000 });
  check('My Deals asks a guest to sign in', true);

  const fin = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  watch(fin, 'finance');
  await signInPortal(fin, MERCHANT, 'finance@harbourgrill.test', 'deals/hot');
  await fin.getByText('You do not have access to this page.').waitFor({ timeout: 60000 });
  check('merchant Finance has no access to Exclusive Deals', true);
  await shot(fin, 'merchant-17-finance-no-access-en', false);
  const sup = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  watch(sup, 'support');
  await signInPortal(sup, ADMIN, 'support@dealdash.test', 'hot-deals', true);
  await sup.getByText('You do not have access to this page.').waitFor({ timeout: 60000 });
  check('DealDash Support cannot review Exclusive Deals (no menu item)', (await sup.getByRole('link', { name: 'Exclusive Deals' }).count()) === 0 && (await sup.getByRole('link', { name: 'Reservations' }).count()) === 1);
  await sup.goto(`${ADMIN}/en/reservations`, { waitUntil: 'domcontentloaded' });
  await sup.getByTestId('reservation-tools').waitFor({ timeout: 60000 });
  check('Support can use the reservation tools (restrictions and lookup)', true);
  await shot(sup, 'admin-08-support-reservations-en', false);
  await cam.close();
} catch (e) {
  check('script completed without an unexpected error', false, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '));
  try {
    if (customerA) await customerA.screenshot({ path: join(OUT, 'zz-failure.png'), fullPage: true });
  } catch {
    /* best effort */
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
if (consoleErrors.length) {
  console.log(`\nUnexpected console errors (${consoleErrors.length}):`);
  for (const e of [...new Set(consoleErrors)].slice(0, 20)) console.log('  ' + e);
}
if (failed.length) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
}
process.exit(failed.length || consoleErrors.length ? 1 : 0);
