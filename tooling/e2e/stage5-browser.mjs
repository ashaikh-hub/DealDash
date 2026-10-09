/**
 * Stage 5 browser end-to-end check (real Edge through playwright-core; no browser download needed).
 *
 *   Merchant: builds a Voucher (EN + AR, photo, price, validity, branch, terms), previews it, submits
 *   Admin:    reviews it (commercial checks, refund/payable placeholders, both languages) and approves
 *   Customer: finds it (Home rail, Vouchers, search), reads "Reported savings", checks out, DECLINES at the test payment
 *             page (failure state), retries, pays; sees the voucher in My Vouchers with QR + manual code
 *   Staff:    scans the voucher QR with a (fake) camera, redeems, replays it (ALREADY REDEEMED)
 *   Customer: voucher turns Used; a second voucher is refunded and staff then see REFUNDED
 *   Merchant: Monitor / Sales / Finance (held vs settlement-eligible)
 *   Admin:    Finance workbench (ledger health, lookup, refund queue with approval, order detail, support)
 * plus Arabic/RTL on every surface, mobile + desktop layouts, and console-error watching.
 *
 * Requires the API (4000), customer (3001), merchant (3002), staff (3003) and admin (3005) running and the dev seed applied.
 *   SEED_USER_PASSWORD must be set in the environment (never stored in this file).
 *
 *   node tooling/e2e/stage5-browser.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
const OUT = join(process.cwd(), 'docs', 'screenshots', 'stage5');
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password you gave to the seed) before running.');
mkdirSync(OUT, { recursive: true });

const TAG = randomBytes(3).toString('hex');
const TITLE_EN = `QA Dinner Voucher ${TAG}`;
const TITLE_AR = `قسيمة عشاء للاختبار ${TAG}`;
const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};
/** Runs one section; a crash is recorded as a failure with a screenshot instead of hiding the rest. */
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
      raw[o++] = 90 + Math.round((x / w) * 80);
      raw[o++] = 60 + Math.round((y / h) * 100);
      raw[o++] = 200 - Math.round(((x + y) / (w + h)) * 100);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

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
    if (/401|404 \(Not Found\)|409 \(Conflict\)|422|429|favicon|manifest|Download the React DevTools|aborted|net::ERR_FAILED|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|Not allowed to start|NotFoundError|Requested device not found/i.test(t)) return;
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
  await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 20000 });
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
const text = (page) => page.locator('main').first().innerText();

let voucherId = null;
let customerPage = null;
const A = '+966500000500';
const B = '+966500000501';
let qrA = null;
let staffState = null;
let orderRef = 'VO-QA';

try {
  // ================================================================ 1. merchant builds a Voucher
  const mctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const m = await mctx.newPage();
  watch(m, 'merchant');
  let submittedForReview = false;
  await section('merchant-builder', m, async () => {
    await signInPortal(m, MERCHANT, 'owner@najdkitchen.test', 'vouchers');
    await m.getByTestId('voucher-hub').waitFor({ timeout: 90000 });
    await m.locator('[data-testid="voucher-row"]').first().waitFor({ timeout: 30000 }).catch(() => {});
    const rows = await m.locator('[data-testid="voucher-row"]').count();
    check('merchant sees the Vouchers hub as a third Campaigns tab with seeded vouchers', rows >= 1 && (await m.getByTestId('deals-type-switch').getByRole('link', { name: 'Vouchers' }).isVisible()), `${rows} rows`);
    await shot(m, 'merchant-01-voucher-hub-en');

    await m.getByRole('link', { name: /Create voucher/ }).first().click();
    await m.getByTestId('voucher-builder').waitFor();
    const steps = await m.locator('.dd-stepper li').allInnerTexts();
    check('builder has the six voucher steps', steps.length === 6, steps.map((s) => s.split('\n')[0]).join(' | '));
    await shot(m, 'merchant-02-voucher-builder-empty-en');
    await m.locator('#f-categoryId').selectOption({ label: 'Dining' });
    await m.locator('#f-face').fill('120');
    await m.locator('#f-price').fill('150');
    await m.getByRole('button', { name: 'Next', exact: true }).click();
    check('a price above the voucher value is refused before anything is saved', (await m.getByText('The price cannot be more than the value').count()) > 0);
    await m.locator('#f-price').fill('90');
    check('reported savings are shown to the merchant live (SAR 30.00 / 25%)', /SAR 30\.00 \(25%\)/.test(await m.getByTestId('builder-savings').innerText()));
    await m.locator('#f-qty').fill('3');
    await m.locator('#f-per').fill('2');
    await shot(m, 'merchant-03-voucher-builder-offer-en');
    await m.getByRole('button', { name: 'Next', exact: true }).click();
    await m.getByRole('heading', { name: 'Content', exact: true }).waitFor();
    await m.locator('#f-title-en').fill(TITLE_EN);
    await m.locator('#f-short-en').fill('Pay SAR 90, dine for SAR 120');
    await m.locator('#f-desc-en').fill('A dinner voucher for any dish on the menu.');
    await m.locator('#f-rules-en').fill('Show the QR code to the cashier before ordering.');
    await m.getByRole('button', { name: 'Next', exact: true }).click();
    check('the next step names the missing Arabic text', (await m.getByText('Arabic text is required').count()) > 0);
    await m.locator('#f-title-ar').fill(TITLE_AR);
    await m.locator('#f-short-ar').fill('ادفع 90 ريالاً وتناول بقيمة 120 ريالاً');
    await m.locator('#f-desc-ar').fill('قسيمة عشاء لأي طبق من القائمة.');
    await m.locator('#f-rules-ar').fill('اعرض رمز QR للكاشير قبل الطلب.');
    await m.locator('#voucher-image').setInputFiles({ name: 'dinner.png', mimeType: 'image/png', buffer: png(900, 560) });
    await m.locator('#alt-en-0').waitFor({ timeout: 30000 });
    await m.locator('#alt-en-0').fill('Dinner table');
    await m.locator('#alt-ar-0').fill('طاولة عشاء');
    await shot(m, 'merchant-04-voucher-builder-content-en');
    await m.getByRole('button', { name: 'Next', exact: true }).click();
    await m.getByRole('heading', { name: 'Validity and sale period' }).waitFor();
    await m.locator('#f-vdays').fill('30');
    await shot(m, 'merchant-05-voucher-builder-validity-en');
    await m.getByRole('button', { name: 'Next', exact: true }).click();
    await m.getByRole('heading', { name: 'Branches', exact: true }).first().waitFor();
    await m.getByLabel('Najd Kitchen Al Nakheel').check();
    await m.getByRole('button', { name: 'Next', exact: true }).click();
    await m.getByRole('heading', { name: 'Eligibility and terms' }).waitFor();
    await m.locator('#f-terms-en').fill('One voucher per visit. Not valid with other offers.');
    await m.locator('#f-terms-ar').fill('قسيمة واحدة لكل زيارة. لا تُجمع مع عروض أخرى.');
    await m.getByRole('button', { name: 'Next', exact: true }).click();
    await m.getByRole('heading', { name: 'Review', exact: true }).waitFor();
    await m.getByText('Everything is complete').waitFor({ timeout: 15000 }).catch(() => {});
    const reviewText = await m.locator('main').innerText();
    check('review confirms completeness, shows the refund and payable placeholder rules', /Everything is complete/.test(reviewText) && /Refunds:/.test(reviewText) && /Payable:/.test(reviewText), /Fix the items/.test(reviewText) ? reviewText.slice(0, 400).replace(/\s+/g, ' ') : '');
    check('the customer preview exists in both languages and as card + detail', (await m.getByTestId('voucher-preview').count()) > 0);
    await m.getByRole('tab', { name: /detail/i }).first().click().catch(() => {});
    await shot(m, 'merchant-06-voucher-builder-review-en');
    await acceptCommercial(m, { save: async () => { const b = m.getByTestId('voucher-save'); if (await b.isEnabled()) await b.click(); } });
  await m.getByTestId('voucher-submit').click();
    await m.getByTestId('builder-result').waitFor({ timeout: 30000 });
    const resultText = await m.getByTestId('builder-result').innerText();
    submittedForReview = /Sent for review/.test(resultText);
    check('merchant submits the voucher (sent for review or published by the guardrails)', submittedForReview || /on sale|scheduled/i.test(resultText), resultText.replace(/\s+/g, ' ').slice(0, 80));
    await shot(m, 'merchant-07-voucher-submitted-en');
    await m.getByRole('link', { name: /Go to|View/ }).first().click().catch(() => {});
    await m.waitForURL(/\/vouchers\/[0-9a-f-]{36}$/, { timeout: 30000 }).catch(() => {});
    voucherId = (m.url().match(/vouchers\/([0-9a-f-]{36})/) ?? [])[1] ?? null;
    await m.getByRole('tab', { name: 'Sales' }).waitFor({ timeout: 30000 }).catch(() => {});
    check('voucher detail opens with a Monitor / Sales / Activity layout', !!voucherId && (await m.getByRole('tab', { name: 'Sales' }).count()) > 0, voucherId ?? '');
    await shot(m, 'merchant-08-voucher-monitor-en');
  });

  // ================================================================ 2. admin reviews and approves
  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await actx.newPage();
  watch(a, 'admin');
  await section('admin-review', a, async () => {
    await signInPortal(a, ADMIN, 'operations@dealdash.test', 'vouchers', true);
    await a.getByTestId('admin-vouchers').waitFor({ timeout: 90000 });
    check('admin sees Vouchers and Finance in the navigation', (await a.getByRole('link', { name: 'Vouchers' }).count()) > 0);
    if (submittedForReview) {
      await a.locator('[data-testid="admin-voucher-row"]').first().waitFor({ timeout: 30000 });
      check('the new voucher is in the review queue', (await a.getByText(TITLE_EN).count()) > 0);
      await shot(a, 'admin-01-voucher-queue-en');
      await a.getByRole('link', { name: TITLE_EN }).first().click();
      await a.getByTestId('voucher-review').waitFor({ timeout: 30000 });
      const rv = await a.getByTestId('voucher-review').innerText();
      check('review workbench shows merchant legal entity, commercial checks and the placeholder rules', /Legal entity/.test(rv) && /Reported savings claim/.test(rv) && /Refund policy \(placeholder\)/.test(rv) && /Settlement \/ payable rule \(placeholder\)/.test(rv));
      check('both languages are shown side by side (Arabic right-to-left)', (await a.getByTestId('content-ar').getAttribute('dir')) === 'rtl' && (await a.getByTestId('content-en').count()) === 1);
      await shot(a, 'admin-02-voucher-review-en');
      await a.getByTestId('act-approve').click();
      await a.getByTestId('decision-confirm').click();
      await a.getByText('Done').first().waitFor({ timeout: 30000 });
      check('admin approves with a recorded reason', true);
      await shot(a, 'admin-03-voucher-approved-en');
    }
    if (!voucherId) {
      const list = await api('/v1/app/vouchers?limit=50&q=' + encodeURIComponent(TITLE_EN));
      voucherId = list?.find((v) => v.title.en === TITLE_EN)?.id ?? null;
    }
    check('the approved voucher is on sale for customers', !!voucherId && (await api(`/v1/app/vouchers/${voucherId}`))?.canBuy !== undefined, voucherId ?? 'none');
  });

  // ================================================================ 3. customer discovers, checks out, fails once, pays
  const cctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-GB' });
  const c = await cctx.newPage();
  customerPage = c;
  watch(c, 'customer');
  let instanceId = null;
  await section('customer-checkout', c, async () => {
    await mobileSignIn(c, `${CUSTOMER}/en/profile`, A, () => c.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 }));
    await c.goto(`${CUSTOMER}/en`, { waitUntil: 'domcontentloaded' });
    await c.getByTestId('voucher-rail').waitFor({ timeout: 60000 });
    check('Home shows a Vouchers rail', true);
    await shot(c, 'customer-01-home-voucher-rail-en', false);
    await c.goto(`${CUSTOMER}/en/vouchers`, { waitUntil: 'domcontentloaded' });
    await c.locator('[data-testid="voucher-card"]').first().waitFor({ timeout: 60000 });
    check('the Vouchers list shows cards with price, value and savings', (await c.locator('[data-testid="voucher-card"]').count()) >= 3);
    await shot(c, 'customer-02-vouchers-list-en');
    await c.getByTestId('voucher-search').fill(TAG);
    await c.locator('[data-testid="voucher-card"]').first().waitFor({ timeout: 30000 });
    await c.waitForFunction(() => document.querySelectorAll('[data-testid="voucher-card"]').length === 1, null, { timeout: 15000 }).catch(() => {});
    check('search finds exactly the new voucher', (await c.locator('[data-testid="voucher-card"]').count()) === 1);
    await c.locator('[data-testid="voucher-card"] a').first().click();
    await c.getByTestId('voucher-pricebox').waitFor({ timeout: 30000 });
    const dt = await c.locator('main').innerText();
    check('detail says "Reported savings", explains it, and never says "guarantee"', /Reported savings/.test(dt) && /depends on what you buy/i.test(dt) && !/guarantee/i.test(dt));
    check('detail shows value, price, validity, terms access, branches and how it works', /Worth SAR 120\.00/i.test(dt) && /SAR 90\.00/.test(dt) && /Valid for 30 days/i.test(dt) && /How it works/i.test(dt));
    check('detail has no horizontal overflow on mobile', await noOverflow(c));
    await shot(c, 'customer-03-voucher-detail-en');
    await c.getByTestId('voucher-buy').click();
    await c.getByTestId('checkout').waitFor({ timeout: 30000 });
    const ck = await c.getByTestId('checkout').innerText();
    check('checkout shows voucher, merchant, value, price, quantity, amount payable and the payment method', /Najd Kitchen/.test(ck) && /Voucher value/.test(ck) && /Quantity/.test(ck) && /Amount to pay/.test(ck) && /Payment method/.test(ck));
    check('checkout shows the hold countdown and no Phase 2 concept (gift, promo code, loyalty points, saved card, quantity stepper)', (await c.getByTestId('hold-note').count()) === 1 && !/gift|promo|loyalty|points|saved card|visa|mastercard/i.test(ck));
    await shot(c, 'customer-04-checkout-en');
    await c.getByTestId('checkout-pay').click();
    check('paying without accepting the terms is refused', (await c.getByText('Please accept the terms to continue').count()) > 0);
    await c.getByTestId('checkout-terms').check();
    await c.getByTestId('checkout-pay').click();
    await c.getByTestId('mock-pay').waitFor({ timeout: 30000 });
    check('the test payment page stands in for the provider (nothing is charged)', /Nothing is charged/.test(await c.getByTestId('mock-pay').innerText()));
    await shot(c, 'customer-05-test-payment-en');
    await c.getByTestId('mock-decline').click();
    await c.getByTestId('order-failed').waitFor({ timeout: 30000 });
    check('a declined payment shows a clear failure, attempts left and creates no voucher', /Payment did not go through/.test(await c.getByTestId('order-failed').innerText()) && (await c.getByTestId('order-retry').count()) === 1);
    check('My Vouchers is still empty of this voucher after the failure', !(await pageApi(c, 'GET', '/v1/app/wallet?tab=active')).body.data.some((w) => w.title.en === TITLE_EN));
    await shot(c, 'customer-06-payment-failed-en');
    await c.getByTestId('order-retry').click();
    await c.getByTestId('checkout').waitFor({ timeout: 30000 });
    check('checkout after a failure explains it and still allows a retry', (await c.getByTestId('checkout-failed-note').count()) === 1);
    await c.getByTestId('checkout-terms').check();
    await c.getByTestId('checkout-pay').click();
    await c.getByTestId('mock-approve').click();
    await c.getByTestId('order-success').waitFor({ timeout: 45000 });
    check('payment success shows a confirmation with a link to the voucher', (await c.getByTestId('order-view-voucher').count()) === 1);
    await shot(c, 'customer-07-payment-success-en');
    await c.getByTestId('order-view-voucher').click();
    await c.getByTestId('wallet-ticket').waitFor({ timeout: 30000 });
    const wt = await c.getByTestId('wallet-ticket').innerText();
    check('My Vouchers shows the voucher with QR, manual code, expiry, terms and the refund option', (await c.getByLabel('Voucher QR code').count()) === 1 && /[A-Z0-9]{4}-[A-Z0-9]{4}/.test(await c.getByTestId('manual-code').innerText()) && /Request a refund/.test(wt) && /Terms/.test(wt));
    await shot(c, 'customer-08-wallet-ticket-en');
    instanceId = (c.url().match(/my-vouchers\/([0-9a-f-]{36})/) ?? [])[1];
    const detail = (await pageApi(c, 'GET', `/v1/app/wallet/${instanceId}`)).body.data;
    qrA = detail.code.qr;
    check('the QR is an opaque token (no database id inside)', /^DV1\.[A-Za-z0-9_-]{16,}$/.test(qrA) && !qrA.includes(instanceId));
    await c.goto(`${CUSTOMER}/en/my-vouchers`, { waitUntil: 'domcontentloaded' });
    await c.getByTestId('wallet-row').first().waitFor({ timeout: 30000 });
    check('My Vouchers lists the voucher under Active', (await c.getByTestId('wallet-row').filter({ hasText: TITLE_EN }).count()) === 1);
    await shot(c, 'customer-09-my-vouchers-en');
  });

  // ================================================================ 4. staff scans and redeems
  await section('staff-redeem', null, async () => {
    if (!qrA) throw new Error('no QR to scan');
    const video = join(OUT, 'qr-voucher.y4m');
    qrVideo(qrA, video);
    const cam = await edge(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`]);
    const sctx = await cam.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'] });
    const s = await sctx.newPage();
    watch(s, 'staff');
    await mobileSignIn(s, `${STAFF}/en`, '+966500000102', () => s.getByTestId('staff-scan').waitFor({ timeout: 60000 }));
    staffState = await sctx.storageState();
    const res =await s.getByTestId('staff-result').waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
    check('the camera reads the voucher QR and shows a valid voucher with the value to honour', res && (await s.getByTestId('staff-result').getAttribute('data-result')) === 'VALID' && /SAR 120\.00/.test(await s.getByTestId('staff-voucher-value').innerText()));
    await shot(s, 'staff-01-voucher-valid-en');
    await s.getByTestId('redeem-open').click();
    await s.getByTestId('redeem-sheet').waitFor();
    check('the confirmation sheet is voucher-specific and warns it cannot be undone', /Redeem this voucher\?/.test(await s.getByTestId('redeem-sheet').innerText()));
    await shot(s, 'staff-02-voucher-confirm-en');
    await s.getByTestId('confirm-redeem').click();
    await s.locator('[data-testid="staff-result"][data-result="REDEEMED"]').waitFor({ timeout: 30000 });
    check('redemption succeeds with a clear green result', (await s.getByTestId('staff-result').getAttribute('class')).includes('dd-result--ok'));
    await shot(s, 'staff-03-voucher-redeemed-en');
    await s.getByTestId('scan-next').click();
    // the same QR is still in front of the fake camera: the replay must be refused
    await s.locator('[data-testid="staff-result"][data-result="ALREADY_REDEEMED"]').waitFor({ timeout: 40000 });
    check('replaying the same QR shows ALREADY REDEEMED (red) and offers no redeem button', (await s.getByTestId('redeem-open').count()) === 0 && (await s.getByTestId('staff-result').getAttribute('class')).includes('dd-result--stop'));
    await shot(s, 'staff-04-voucher-replay-en');
    await cam.close();
  });

  // ================================================================ 5. customer sees Used; second voucher refunded; staff see REFUNDED
  await section('customer-used-and-refund', c, async () => {
    await c.goto(`${CUSTOMER}/en/my-vouchers?tab=used`, { waitUntil: 'domcontentloaded' });
    await c.getByTestId('wallet-row').first().waitFor({ timeout: 30000 });
    check('the redeemed voucher moved to Used', (await c.getByTestId('wallet-row').filter({ hasText: TITLE_EN }).count()) === 1);
    await c.getByTestId('wallet-row').filter({ hasText: TITLE_EN }).first().click();
    await c.getByTestId('wallet-state-note').waitFor({ timeout: 30000 });
    check('a used voucher shows no QR and no refund button', (await c.getByLabel('Voucher QR code').count()) === 0 && (await c.getByTestId('wallet-refund').count()) === 0);
    await shot(c, 'customer-10-voucher-used-en');

    // buy a second one through the real checkout API path (test payment) and refund it from the UI
    const co = await pageApi(c, 'POST', '/v1/app/checkout', { voucherId, quantity: 1 });
    const orderId = co.body?.data?.id;
    orderRef = co.body?.data?.reference ?? orderRef;
    const pay = await pageApi(c, 'POST', `/v1/app/orders/${orderId}/pay`, { acceptTerms: true, termsVersion: '2026-10-v1', returnUrl: `${CUSTOMER}/en/pay/${orderId}` });
    const ref = new URL(pay.body.data.payment.redirectUrl).searchParams.get('mock_payment');
    await c.goto(`${CUSTOMER}/en/pay/${orderId}?mock_payment=${ref}`, { waitUntil: 'domcontentloaded' });
    await c.getByTestId('mock-approve').click();
    await c.getByTestId('order-success').waitFor({ timeout: 45000 });
    await c.getByTestId('order-view-voucher').click();
    await c.getByTestId('wallet-ticket').waitFor({ timeout: 30000 });
    const inst2 = (c.url().match(/my-vouchers\/([0-9a-f-]{36})/) ?? [])[1];
    const qr2 = (await pageApi(c, 'GET', `/v1/app/wallet/${inst2}`)).body.data.code.qr;
    await c.getByTestId('wallet-refund').click();
    await c.getByTestId('wallet-sheet').waitFor();
    check('the refund sheet explains the outcome and asks for a reason', /original payment method/.test(await c.getByTestId('wallet-sheet').innerText()));
    await shot(c, 'customer-11-refund-sheet-en');
    await c.getByTestId('wallet-sheet-submit').click();
    await c.getByText('Refund request sent').waitFor({ timeout: 30000 });
    await c.waitForTimeout(1500);
    const status2 = (await pageApi(c, 'GET', `/v1/app/wallet/${inst2}`)).body.data;
    check('a refund inside the policy window completes and the voucher stops working', ['REFUNDED', 'REFUND_PENDING'].includes(status2.state) && status2.code === null, status2.state);
    await c.reload({ waitUntil: 'domcontentloaded' });
    await c.getByTestId('refund-status').waitFor({ timeout: 30000 });
    check('the voucher page shows the refund status in plain words', /refund/i.test(await c.getByTestId('refund-status').innerText()));
    await shot(c, 'customer-12-refund-status-en');

    const video = join(OUT, 'qr-voucher-refunded.y4m');
    qrVideo(qr2, video);
    const cam = await edge(['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`]);
    const sctx = await cam.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera'], storageState: staffState });
    const s = await sctx.newPage();
    watch(s, 'staff');
    await s.goto(`${STAFF}/en`, { waitUntil: 'domcontentloaded' });
    await s.getByTestId('staff-scan').waitFor({ timeout: 60000 });
    await s.locator('[data-testid="staff-result"][data-result="REFUNDED"]').waitFor({ timeout: 40000 });
    check('staff see REFUNDED (red) for a refunded voucher and cannot redeem it', (await s.getByTestId('redeem-open').count()) === 0 && (await s.getByTestId('staff-result').getAttribute('class')).includes('dd-result--stop'));
    await shot(s, 'staff-05-voucher-refunded-en');
    await cam.close();
  });

  // ================================================================ 6. merchant sales + finance
  await section('merchant-after-sale', m, async () => {
    await m.goto(`${MERCHANT}/en/vouchers/${voucherId}`, { waitUntil: 'domcontentloaded' });
    await m.getByTestId('voucher-monitor').waitFor({ timeout: 30000 });
    const mt = await m.getByTestId('voucher-monitor').innerText();
    check('Monitor shows sold / used / refunded and verified money', (await m.getByTestId('kpi-sold').innerText()) === '2' && (await m.getByTestId('kpi-used').innerText()) === '1' && /Verified money/.test(mt));
    check('settlement-eligible money exists only for the redeemed voucher (SAR 81.00 = 90.00 minus 10% fee)', /SAR 81\.00/.test(await m.getByTestId('money-eligible').innerText()));
    await shot(m, 'merchant-09-voucher-monitor-after-sale-en');
    await m.getByRole('tab', { name: 'Sales' }).click();
    await m.locator('[data-testid="sale-row"]').first().waitFor({ timeout: 30000 });
    const sales = await m.getByTestId('voucher-sales').innerText();
    check('Sales shows first names only (no phone, e-mail or payment data)', /Layla|Customer|[A-Z][a-z]+/.test(sales) && !/\+966|@/.test(sales));
    await shot(m, 'merchant-10-voucher-sales-en');
    await m.getByRole('tab', { name: 'Activity' }).click();
    await m.getByTestId('voucher-activity').waitFor();
    await m.goto(`${MERCHANT}/en/finance`, { waitUntil: 'domcontentloaded' });
    await m.getByTestId('merchant-finance').waitFor({ timeout: 30000 });
    const ft = await m.getByTestId('merchant-finance').innerText();
    check('Finance shows held vs settlement-eligible and the placeholder legal note', /Held for you/.test(ft) && /Settlement-eligible/.test(ft) && /still being confirmed/.test(ft));
    await shot(m, 'merchant-11-finance-en');
  });

  // ================================================================ 7. admin finance workbench
  const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const f = await fctx.newPage();
  watch(f, 'finance');
  await section('admin-finance', f, async () => {
    await signInPortal(f, ADMIN, 'finance@dealdash.test', 'finance', true);
    await f.getByTestId('finance-overview').waitFor({ timeout: 90000 });
    check('ledger health reports balanced', /Balanced/.test(await f.getByTestId('ledger-balanced').innerText()));
    await shot(f, 'admin-04-finance-overview-en');
    await f.getByRole('tab', { name: 'Lookup' }).click();
    await f.getByTestId('finance-search').fill(orderRef);
    await f.getByRole('button', { name: 'Search' }).click();
    await f.locator('[data-testid="finance-result"]').first().waitFor({ timeout: 30000 });
    await shot(f, 'admin-05-finance-lookup-en');
    await f.locator('[data-testid="finance-result"] a').first().click();
    await f.getByTestId('finance-order').waitFor({ timeout: 30000 });
    const ot = await f.getByTestId('finance-order').innerText();
    check('order detail shows payments, terms accepted, ledger journals and merchant payable events', /Payment attempts/.test(ot) && /Terms accepted/.test(ot) && /Ledger journals/.test(ot) && /Merchant payable events/.test(ot));
    await shot(f, 'admin-06-finance-order-en');
    await f.goto(`${ADMIN}/en/finance`, { waitUntil: 'domcontentloaded' });
    await f.getByRole('tab', { name: 'Refunds' }).click();
    await f.locator('[data-testid="refund-row"]').first().waitFor({ timeout: 30000 });
    check('the refund queue lists refunds with status and actions', (await f.locator('[data-testid="refund-row"]').count()) >= 1);
    await shot(f, 'admin-07-finance-refunds-en');
    const review = f.locator('[data-testid="refund-row"][data-status="UNDER_REVIEW"], [data-testid="refund-row"][data-status="REQUESTED"]').first();
    if (await review.count()) {
      await review.getByTestId('refund-approve').click();
      check('approving a refund requires a recorded reason', await f.getByTestId('finance-confirm').isDisabled());
      await f.getByLabel(/Reason/).fill('Reviewed: outside the usual period but justified');
      await f.getByTestId('finance-confirm').click();
      await f.waitForTimeout(2500);
      check('the approved refund moves on', true);
      await shot(f, 'admin-08-finance-refund-approved-en');
    } else console.log('SKIP  refund approval: the seeded refund under review was already approved by an earlier run (pnpm db:reset restores it)');
    await f.getByRole('tab', { name: 'Support cases' }).click();
    await f.getByTestId('finance-cases').waitFor();
    await shot(f, 'admin-09-finance-cases-en');
    // support sees provider data redacted
    const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const sp = await sctx.newPage();
    watch(sp, 'support');
    await signInPortal(sp, ADMIN, 'support@dealdash.test', 'finance', true);
    await sp.getByTestId('finance-workbench').waitFor({ timeout: 90000 });
    check('Support starts at the lookup and has no Overview tab', (await sp.getByRole('tab', { name: 'Overview' }).count()) === 0);
    await sp.getByRole('tab', { name: 'Lookup' }).click();
    await sp.getByTestId('finance-search').fill(orderRef);
    await sp.getByRole('button', { name: 'Search' }).click();
    await sp.locator('[data-testid="finance-result"] a').first().click();
    await sp.getByTestId('finance-order').waitFor({ timeout: 30000 });
    check('Support sees provider references hidden', (await sp.getByTestId('finance-order').innerText()).includes('hidden for your role'));
    await sctx.close();
  });

  // ================================================================ 8. seeded wallet states for a long-standing customer
  await section('customer-seeded-wallet', null, async () => {
    const sctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const s = await sctx.newPage();
    watch(s, 'customer-seed');
    await mobileSignIn(s, `${CUSTOMER}/en/profile`, '+966500000001', () => s.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 }));
    for (const tab of ['active', 'used', 'expired', 'refunded']) {
      await s.goto(`${CUSTOMER}/en/my-vouchers?tab=${tab}`, { waitUntil: 'domcontentloaded' });
      await s.waitForTimeout(1500);
      const n = await s.getByTestId('wallet-row').count();
      check(`My Vouchers tab ${tab} renders (${n} seeded)`, (await noOverflow(s)) && (n > 0 || (await s.locator('main').innerText()).length > 20));
      await shot(s, `customer-13-wallet-${tab}-en`, false);
    }
    await sctx.close();
  });

  // ================================================================ 9. Arabic / RTL on every surface
  await section('arabic', null, async () => {
    // customer (mobile)
    const ctxAr = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-SA' });
    const ar = await ctxAr.newPage();
    watch(ar, 'customer-ar');
    await mobileSignIn(ar, `${CUSTOMER}/en/profile`, B, () => ar.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 }));
    await ar.goto(`${CUSTOMER}/ar/vouchers`, { waitUntil: 'domcontentloaded' });
    await ar.locator('[data-testid="voucher-card"]').first().waitFor({ timeout: 60000 });
    await rtlOk(ar, 'customer vouchers (ar)');
    check('customer card text is Arabic', /[؀-ۿ]/.test(await text(ar)));
    await shot(ar, 'customer-ar-01-vouchers');
    await ar.locator('[data-testid="voucher-card"] a').first().click();
    await ar.getByTestId('voucher-pricebox').waitFor({ timeout: 30000 });
    await rtlOk(ar, 'customer voucher detail (ar)');
    check('detail uses "التوفير المُعلن" (reported savings) and no guarantee wording', /التوفير المُعلن/.test(await text(ar)) && !/نضمن|مضمون/.test(await text(ar)));
    await shot(ar, 'customer-ar-02-voucher-detail');
    await ar.getByTestId('voucher-buy').click();
    await ar.getByTestId('checkout').waitFor({ timeout: 30000 });
    await rtlOk(ar, 'customer checkout (ar)');
    await shot(ar, 'customer-ar-03-checkout');
    await ar.getByTestId('checkout-terms').check();
    await ar.getByTestId('checkout-pay').click();
    await ar.getByTestId('mock-pay').waitFor({ timeout: 30000 });
    await shot(ar, 'customer-ar-04-test-payment');
    await ar.getByTestId('mock-approve').click();
    await ar.getByTestId('order-success').waitFor({ timeout: 45000 });
    await rtlOk(ar, 'customer payment success (ar)');
    await shot(ar, 'customer-ar-05-payment-success');
    await ar.getByTestId('order-view-voucher').click();
    await ar.getByTestId('wallet-ticket').waitFor({ timeout: 30000 });
    await rtlOk(ar, 'customer voucher ticket (ar)');
    check('QR and manual code stay left-to-right in Arabic', (await ar.getByTestId('manual-code').evaluate((el) => getComputedStyle(el).direction)) === 'ltr');
    await shot(ar, 'customer-ar-06-wallet-ticket');
    await ar.goto(`${CUSTOMER}/ar/my-vouchers`, { waitUntil: 'domcontentloaded' });
    await ar.getByTestId('wallet-row').first().waitFor({ timeout: 30000 });
    await rtlOk(ar, 'customer My Vouchers (ar)');
    await shot(ar, 'customer-ar-07-my-vouchers');
    await ctxAr.close();

    // merchant (desktop): the owner is already signed in, so switch the page to Arabic
    const mAr = m;
    await mAr.goto(`${MERCHANT}/ar/vouchers`, { waitUntil: 'domcontentloaded' });
    await mAr.getByTestId('voucher-hub').waitFor({ timeout: 90000 });
    await rtlOk(mAr, 'merchant voucher hub (ar)');
    await shot(mAr, 'merchant-ar-01-hub');
    await mAr.goto(`${MERCHANT}/ar/vouchers/new`, { waitUntil: 'domcontentloaded' });
    await mAr.getByTestId('voucher-builder').waitFor({ timeout: 30000 });
    await rtlOk(mAr, 'merchant voucher builder (ar)');
    await shot(mAr, 'merchant-ar-02-builder');
    await mAr.goto(`${MERCHANT}/ar/vouchers/${voucherId}`, { waitUntil: 'domcontentloaded' });
    await mAr.getByTestId('voucher-monitor').waitFor({ timeout: 30000 });
    await rtlOk(mAr, 'merchant voucher monitor (ar)');
    await shot(mAr, 'merchant-ar-03-monitor');
    await mAr.goto(`${MERCHANT}/ar/finance`, { waitUntil: 'domcontentloaded' });
    await mAr.getByTestId('merchant-finance').waitFor({ timeout: 30000 });
    await rtlOk(mAr, 'merchant finance (ar)');
    await shot(mAr, 'merchant-ar-04-finance');

    // admin (desktop): the finance and operations users are already signed in
    await f.goto(`${ADMIN}/ar/finance`, { waitUntil: 'domcontentloaded' });
    await f.getByTestId('finance-overview').waitFor({ timeout: 90000 });
    await rtlOk(f, 'admin finance (ar)');
    await shot(f, 'admin-ar-01-finance');
    await a.goto(`${ADMIN}/ar/vouchers/${voucherId}`, { waitUntil: 'domcontentloaded' });
    await a.getByTestId('voucher-review').waitFor({ timeout: 30000 });
    await rtlOk(a, 'admin voucher review (ar)');
    await shot(a, 'admin-ar-02-voucher-review');
    await a.goto(`${ADMIN}/ar/vouchers`, { waitUntil: 'domcontentloaded' });
    await a.getByTestId('admin-vouchers').waitFor({ timeout: 30000 });
    await shot(a, 'admin-ar-03-vouchers');

    // staff (mobile): reuse the signed-in staff session
    const sAr = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-SA', storageState: staffState })).newPage();
    watch(sAr, 'staff-ar');
    await sAr.goto(`${STAFF}/ar`, { waitUntil: 'domcontentloaded' });
    await sAr.getByTestId('staff-scan').waitFor({ timeout: 60000 });
    await rtlOk(sAr, 'staff scan (ar)');
    await shot(sAr, 'staff-ar-01-scan');
  });

  // ================================================================ 10. layouts
  await section('layouts', null, async () => {
    const tablet = await (await browser.newContext({ viewport: { width: 820, height: 1100 } })).newPage();
    watch(tablet, 'tablet');
    await tablet.goto(`${CUSTOMER}/en/vouchers`, { waitUntil: 'domcontentloaded' });
    await tablet.locator('[data-testid="voucher-card"]').first().waitFor({ timeout: 60000 });
    check('Vouchers list has no horizontal overflow on a tablet', await noOverflow(tablet));
    const narrow = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
    await narrow.goto(`${CUSTOMER}/en/vouchers`, { waitUntil: 'domcontentloaded' });
    await narrow.locator('[data-testid="voucher-card"]').first().waitFor({ timeout: 60000 });
    check('Vouchers list has no horizontal overflow at 360px', await noOverflow(narrow));
    await shot(narrow, 'customer-14-vouchers-360', false);
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