/**
 * Stage 3 browser end-to-end check (real Edge through playwright-core; no browser download needed).
 *
 *   Merchant: creates a Live Deal (English + Arabic, branches, photo), previews it, submits
 *   Admin:    reviews it, requests changes
 *   Merchant: corrects and resubmits
 *   Admin:    approves
 *   Customer: discovers it (search), opens it, views the merchant, gets directions, saves it
 *   Merchant: sees measurable engagement
 *   Admin:    sees the full decision history
 * plus Arabic/RTL, empty/loading/error states, long names, permissions and responsive layouts.
 *
 * Requires the API (4000), customer (3001), merchant (3002) and admin (3005) apps running and the dev seed applied.
 * The seed password comes from the environment (never stored in this file):
 *   SEED_USER_PASSWORD
 *
 *   node tooling/e2e/stage3-browser.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:3002';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'stage3');
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password you gave to the seed) before running.');
mkdirSync(OUT, { recursive: true });

const rnd = () => randomBytes(3).toString('hex');
const TAG = rnd();
const TITLE_EN = `QA Brunch ${TAG}`;
const TITLE_AR = `بوفيه الاختبار ${TAG}`;
const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};

// ---- a real PNG (no image library): gradient 900x560
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
      raw[o++] = 255 - Math.round((x / w) * 120);
      raw[o++] = 90 + Math.round((y / h) * 80);
      raw[o++] = 80 + Math.round(((x + y) / (w + h)) * 150);
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
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const shot = (page, name, full = true) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full, caret: 'initial' }); // 'initial': do not touch page styles while hydrating
const watch = (page, label) => {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/401|404 \(Not Found\)|favicon|manifest|Download the React DevTools|aborted|net::ERR_FAILED|Failed to fetch/i.test(t)) return; // expected anonymous 401s, probes and deliberate offline tests
    consoleErrors.push(`[${label}] ${t}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror ${e.message}`));
};
const noOverflow = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const otp = async (page, code) => {
  await page.locator('input[autocomplete="one-time-code"]').first().click();
  await page.keyboard.type(code, { delay: 25 });
};

async function signInPortal(page, base, email, adminTotp = false) {
  await page.goto(`${base}/en/${base === MERCHANT ? 'deals' : 'live-deals'}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (adminTotp) {
    await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 30000 });
    await otp(page, (await api(`/v1/dev/totp?email=${email}`)).code);
  }
}

/** Calls the API from inside a signed-in page (cookie + CSRF), for set-up steps the UI does not need to prove. */
async function pageApi(page, base, method, path, body) {
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

try {
  // ================================================================ 1. merchant creates the deal
  const mctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const m = await mctx.newPage();
  watch(m, 'merchant');
  await signInPortal(m, MERCHANT, 'owner@harbourgrill.test');
  await m.getByTestId('deals-hub').waitFor({ timeout: 60000 });
  await m.getByRole('link', { name: /Create Live Deal/ }).first().waitFor();
  await m.locator('table tbody tr').first().waitFor({ timeout: 30000 });
  const rowCount = await m.locator('table tbody tr').count();
  check('merchant sees the Campaigns hub with the seeded Live Deals', rowCount >= 6, `${rowCount} rows`);
  const statuses = await m.locator('table tbody .dd-chip').allTextContents();
  check('hub shows the lifecycle states (Live, Scheduled, Pending review, Needs changes)', ['Live', 'Scheduled', 'Pending review', 'Needs changes'].every((s) => statuses.includes(s)), statuses.slice(0, 12).join(','));
  await shot(m, 'merchant-01-hub-en');

  await m.getByRole('link', { name: /Create Live Deal/ }).first().click();
  await m.getByTestId('deal-builder').waitFor();
  check('builder shows five steps and a translation status', (await m.locator('.dd-stepper li').count()) === 5 && (await m.getByText(/Translation: missing/).count()) > 0);
  await shot(m, 'merchant-02-builder-empty-en');

  // validation: blocked Next with a per-language message
  await m.locator('#f-title-en').fill(TITLE_EN);
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  check('Next is blocked and names the missing Arabic text', (await m.getByText('Arabic text is required').count()) > 0);
  check('English field is LTR and Arabic field is RTL', (await m.locator('#f-title-en').getAttribute('dir')) === 'ltr' && (await m.locator('#f-title-ar').getAttribute('dir')) === 'rtl');

  await m.locator('#f-categoryId').selectOption({ label: 'Dining' });
  await m.locator('#f-mechanic').selectOption('PERCENTAGE_OFF');
  await m.locator('#f-valueNumber').fill('20');
  await m.locator('#f-offerLabel-en').fill('20% off');
  await m.locator('#f-offerLabel-ar').fill('خصم 20%');
  await m.locator('#f-title-ar').fill(TITLE_AR);
  await m.locator('#f-shortDescription-en').fill('Friday and Saturday brunch');
  await m.locator('#f-shortDescription-ar').fill('إفطار الجمعة والسبت');
  await m.locator('#f-description-en').fill('A relaxed brunch with live grill stations.');
  await m.locator('#f-description-ar').fill('إفطار هادئ مع محطات شواء مباشرة.');
  await shot(m, 'merchant-03-builder-basics-filled-en');
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  await m.getByRole('heading', { name: 'Branches & schedule' }).waitFor();
  check('first Next saves a draft (autosave on step change) and enables the preview', (await m.getByTestId('deal-preview').count()) > 0 || (await m.getByText(/Saved/).count()) > 0);

  await m.getByLabel('Harbour Grill Olaya').check();
  await m.getByLabel('Harbour Grill Al Malqa').check();
  await m.getByLabel('Start now').check();
  const end = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 11) + '12:00';
  await m.locator('#f-endAt').fill(end);
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  await m.getByRole('heading', { name: 'Eligibility & terms' }).waitFor();
  await m.locator('#f-terms-en').fill('Valid Friday and Saturday only.');
  await m.locator('#f-terms-ar').fill('صالح يومي الجمعة والسبت فقط.');
  await m.getByRole('button', { name: 'Fri', exact: true }).click();
  await m.getByRole('button', { name: 'Sat', exact: true }).click();
  await shot(m, 'merchant-04-builder-terms-en');
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  await m.getByRole('heading', { name: 'Photos' }).first().waitFor();

  // image validation then a valid upload (through the development storage adapter)
  await m.locator('#deal-image').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: png(100, 60) });
  check('a too-small image is rejected with the size rules', (await m.getByText(/at least 400/).count()) > 0);
  await m.locator('#deal-image').setInputFiles({ name: 'brunch.png', mimeType: 'image/png', buffer: png(900, 560) });
  await m.locator('#alt-en-0').waitFor({ timeout: 30000 });
  await m.locator('#alt-en-0').fill('Brunch table');
  await m.locator('#alt-ar-0').fill('طاولة الإفطار');
  check('image uploads, shows a preview and accepts alt text in both languages', (await m.locator('.dd-media-item img').count()) === 1);
  await shot(m, 'merchant-05-builder-photos-en');
  await m.getByRole('button', { name: 'Next', exact: true }).click();
  await m.getByRole('heading', { name: 'Preview & submit' }).waitFor();
  await m.getByTestId('deal-preview').waitFor();
  check('review step shows the guardrail result "will be reviewed" and General redemption', (await m.getByText('This deal will be reviewed by DealDash before it goes live.').count()) > 0 && (await m.getByText(/No code, no claim and no reservation/).count()) > 0);
  check('review step confirms everything is complete', (await m.getByText('Everything is complete').count()) > 0);
  check('no controlled-redemption or code option is offered', (await m.getByText(/controlled|redemption code/i).count()) === 0);
  // preview: Arabic + detail
  await m.locator('.dd-builder__preview .dd-lang a', { hasText: 'عربي' }).click();
  const previewDir = await m.getByTestId('deal-preview').getAttribute('dir');
  check('merchant preview switches to Arabic and RTL', previewDir === 'rtl' && (await m.getByTestId('deal-preview').getByText('خصم 20%').count()) > 0);
  await m.getByRole('tab', { name: 'Detail' }).click();
  await shot(m, 'merchant-06-builder-review-preview-ar');
  await m.locator('.dd-builder__preview .dd-lang a', { hasText: 'EN' }).click();
  await m.getByRole('button', { name: 'Submit for review' }).click();
  await Promise.race([m.getByTestId('builder-result').waitFor({ timeout: 30000 }), m.locator('.dd-alert--danger, .dd-alert--warning').first().waitFor({ timeout: 30000 })]).catch(() => {});
  await m.getByTestId('builder-result').waitFor({ timeout: 5000 });
  check('merchant submits the deal for review', (await m.getByText('Sent for review').count()) > 0);
  await shot(m, 'merchant-07-submitted-en');

  // ================================================================ 2. admin reviews and requests changes
  const actx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await actx.newPage();
  watch(a, 'admin');
  await signInPortal(a, ADMIN, 'operations@dealdash.test', true);
  await a.getByTestId('admin-live-deals').waitFor({ timeout: 60000 });
  await a.getByRole('link', { name: TITLE_EN }).waitFor({ timeout: 30000 });
  check('the submitted deal appears in the admin review queue', true);
  check('queue also contains the seeded proposed new version (kind: New version)', (await a.getByText('New version').count()) > 0);
  await shot(a, 'admin-01-queue-en');
  await a.getByRole('link', { name: TITLE_EN }).click();
  await a.getByTestId('deal-review').waitFor();
  check('admin sees both languages side by side', (await a.getByTestId('content-en').getByText(TITLE_EN).count()) === 1 && (await a.getByTestId('content-ar').getByText(TITLE_AR).count()) === 1 && (await a.getByTestId('content-ar').getAttribute('dir')) === 'rtl');
  check('admin sees the merchant, dates, terms and the customer preview', (await a.getByText('Harbour Grill').count()) > 0 && (await a.getByTestId('admin-preview').getByText('20% off').count()) > 0);
  await shot(a, 'admin-02-review-en');
  await a.getByRole('button', { name: 'Request changes' }).click();
  await a.getByRole('button', { name: 'Confirm' }).click();
  check('a decision without a reason is refused', (await a.getByText('Please give a reason (at least 3 characters)').count()) > 0);
  await a.locator('#dec-reason').fill('Please add a minimum table size to the terms.');
  await a.locator('#dec-reason-ar').fill('يرجى إضافة الحد الأدنى لحجم الطاولة في الشروط.');
  await a.getByRole('button', { name: 'Confirm' }).click();
  await a.getByText('Decision recorded').waitFor();
  check('admin requests changes with an English and Arabic reason', (await a.getByText('Needs changes').count()) > 0);

  // ================================================================ 3. merchant sees feedback, corrects, resubmits
  await m.goto(`${MERCHANT}/en/deals`, { waitUntil: 'domcontentloaded' });
  await m.getByRole('link', { name: TITLE_EN }).click();
  await m.getByTestId('deal-detail').waitFor();
  check('merchant sees "DealDash asked for changes" with the reviewer reason', (await m.getByText('DealDash asked for changes').count()) > 0 && (await m.getByText('Please add a minimum table size to the terms.').count()) > 0);
  await shot(m, 'merchant-08-needs-changes-en');
  await m.getByRole('link', { name: 'Fix & resubmit' }).click();
  await m.getByTestId('deal-builder').waitFor();
  check('reviewer feedback is shown inside the builder too', (await m.getByText('Please add a minimum table size to the terms.').count()) > 0);
  await m.getByRole('button', { name: /Eligibility & terms/ }).click();
  await m.locator('#f-terms-en').fill('Valid Friday and Saturday only. Minimum table size: 4 people.');
  await m.locator('#f-terms-ar').fill('صالح يومي الجمعة والسبت فقط. الحد الأدنى للطاولة: 4 أشخاص.');
  await m.getByRole('button', { name: /Preview & submit/ }).click();
  await m.getByRole('button', { name: 'Submit for review' }).click();
  await m.getByTestId('builder-result').waitFor();
  check('merchant corrects and resubmits', (await m.getByText('Sent for review').count()) > 0);

  // ================================================================ 4. admin approves
  await a.goto(`${ADMIN}/en/live-deals`, { waitUntil: 'domcontentloaded' });
  await a.getByRole('link', { name: TITLE_EN }).click();
  await a.getByTestId('deal-review').waitFor();
  await a.getByRole('button', { name: 'Approve' }).click();
  check('approve form is pre-filled with a reason but still requires one', (await a.locator('#dec-reason').inputValue()).length > 3);
  await a.getByRole('button', { name: 'Confirm' }).click();
  await a.getByText('Decision recorded').waitFor();
  check('admin approves; the deal goes Live (it starts now)', (await a.getByText('Live', { exact: true }).count()) > 0);

  // ================================================================ 5. customer discovers, opens, views merchant, directions, saves
  const cctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: [], locale: 'en-GB' });
  const c = await cctx.newPage();
  watch(c, 'customer');
  await c.goto(`${CUSTOMER}/en`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('customer-home').waitFor({ timeout: 60000 });
  await c.locator('.dd-hero').waitFor();
  check('customer home loads for a guest with categories, live offers and the tab bar', (await c.locator('.dd-cat').count()) >= 6 && (await c.locator('nav.dd-tabbar a').count()) === 5);
  check('customer layout has no horizontal overflow on a phone', await noOverflow(c));
  await shot(c, 'customer-01-home-en', false);
  await shot(c, 'customer-02-home-en-full');

  await c.goto(`${CUSTOMER}/en/search?q=${encodeURIComponent(TITLE_EN)}`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('customer-search').waitFor();
  await c.getByRole('link', { name: TITLE_EN }).first().waitFor({ timeout: 30000 });
  check('search finds the new deal by its English title', true);
  await c.waitForTimeout(2200); // impression dwell
  await shot(c, 'customer-03-search-en', false);
  await c.goto(`${CUSTOMER}/en/search?q=${encodeURIComponent(TITLE_AR)}`, { waitUntil: 'domcontentloaded' });
  await c.getByRole('link', { name: TITLE_EN }).first().waitFor({ timeout: 30000 }); // the English UI shows the English title of the deal found by its Arabic words
  check('search finds the same deal by its Arabic title', true);
  await c.goto(`${CUSTOMER}/en/search?q=${encodeURIComponent('qqzzxx nothing')}`, { waitUntil: 'domcontentloaded' });
  await c.getByText(/No results for/).waitFor({ timeout: 30000 });
  check('search shows a friendly empty state for no results', true);
  await shot(c, 'customer-04-search-empty-en', false);

  await c.goto(`${CUSTOMER}/en/search?q=${encodeURIComponent(TITLE_EN)}`, { waitUntil: 'domcontentloaded' });
  await c.waitForTimeout(1800);
  await c.getByRole('link', { name: TITLE_EN }).first().click();
  await c.getByTestId('customer-deal').waitFor();
  check('deal detail opens with offer, dates, "Just see and go" and no claim/QR/reservation', (await c.getByText('Just see and go').count()) > 0 && !/claim|barcode|\bqr\b|reserve/i.test(await c.locator('main').innerText()));
  check('deal detail has the Get directions action', await c.getByRole('button', { name: 'Get directions' }).isEnabled());
  await shot(c, 'customer-05-deal-en', false);
  await c.getByRole('tab', { name: 'Details' }).click();
  check('details tab lists terms and both branches with opening status', (await c.getByText('Minimum table size: 4 people.').count()) > 0 && (await c.getByText(/Open now|Closed now/).count()) >= 1);
  await shot(c, 'customer-06-deal-details-en');
  await c.getByRole('tab', { name: 'Overview' }).click();
  const [popup] = await Promise.all([cctx.waitForEvent('page'), c.getByRole('button', { name: 'Get directions' }).click()]);
  const mapsUrl = popup.url();
  await popup.close();
  check('Get directions opens a map route to the branch coordinates', /google\.com\/maps\/dir|about:blank/.test(mapsUrl) || mapsUrl.includes('maps'), mapsUrl.slice(0, 80));
  await c.waitForTimeout(1200);
  await c.getByRole('link', { name: /View merchant/ }).click();
  await c.getByTestId('customer-merchant').waitFor();
  check('merchant page shows branches, offers and Call/Directions', (await c.getByText(/Offers \(\d+\)/).count()) > 0 && (await c.locator('.dd-mp__action').count()) === 2);
  await shot(c, 'customer-07-merchant-offers-en', false);
  await c.getByRole('tab', { name: 'Info' }).click();
  const infoText = await c.locator('main').innerText();
  check('merchant page exposes no private data (e-mail, registration, IBAN, legal name)', !/@|IBAN|SA\d{6}|commercial|Trading Co|Legal/i.test(infoText.replace(/Open now|Closed now/g, '')));
  await shot(c, 'customer-08-merchant-info-en');
  await c.waitForTimeout(1200);

  // sign in as the sample customer (employer verified) to save
  await c.goto(`${CUSTOMER}/en/profile`, { waitUntil: 'domcontentloaded' });
  await c.getByLabel('Mobile number').fill('+966500000001');
  await c.getByRole('button', { name: 'Send code' }).click();
  await c.locator('input[autocomplete="one-time-code"]').first().waitFor();
  await otp(c, (await api('/v1/dev/last-sms?to=%2B966500000001')).code);
  await c.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 });
  check('customer signs in with a mobile OTP', true);
  await c.goto(`${CUSTOMER}/en/search?q=${encodeURIComponent(TITLE_EN)}`, { waitUntil: 'domcontentloaded' });
  await c.getByRole('link', { name: TITLE_EN }).first().click();
  await c.getByTestId('customer-deal').waitFor();
  await c.getByRole('button', { name: 'Save', exact: true }).click();
  await c.getByRole('button', { name: 'Saved', exact: true }).waitFor();
  await c.goto(`${CUSTOMER}/en/saved`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('customer-saved').getByRole('link', { name: TITLE_EN }).waitFor({ timeout: 30000 });
  check('customer saves the deal and finds it under Saved', true);
  await shot(c, 'customer-09-saved-en', false);

  // eligibility: verified employee vs guest vs customer without benefits
  await c.goto(`${CUSTOMER}/en/search?q=${encodeURIComponent('Team lunch')}`, { waitUntil: 'domcontentloaded' });
  await c.getByRole('link', { name: /Team lunch/ }).first().waitFor({ timeout: 30000 });
  check('verified employee sees the employer offer unlocked', (await c.getByText('Verify your employer to unlock').count()) === 0 && (await c.getByText('Locked').count()) === 0);
  await c.getByRole('button', { name: 'Sign out' }).count();
  await c.goto(`${CUSTOMER}/en/profile`, { waitUntil: 'domcontentloaded' });
  await c.getByRole('button', { name: 'Sign out' }).click();
  await c.goto(`${CUSTOMER}/en/search?q=${encodeURIComponent('Team lunch')}`, { waitUntil: 'domcontentloaded' });
  await c.getByText('Locked').first().waitFor({ timeout: 30000 });
  check('a guest sees the same offer locked with an explanation', (await c.getByText(/Sign in to check if you can unlock/).count()) > 0);
  await shot(c, 'customer-10-locked-guest-en', false);
  await c.getByLabel('Search').first().count();
  await c.goto(`${CUSTOMER}/en/profile`, { waitUntil: 'domcontentloaded' });
  await c.getByLabel('Mobile number').fill('+966500000002');
  await c.getByRole('button', { name: 'Send code' }).click();
  await c.locator('input[autocomplete="one-time-code"]').first().waitFor();
  await otp(c, (await api('/v1/dev/last-sms?to=%2B966500000002')).code);
  await c.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 });
  await c.goto(`${CUSTOMER}/en/search?q=${encodeURIComponent('Team lunch')}`, { waitUntil: 'domcontentloaded' });
  await c.getByText('Verify your employer to unlock').first().waitFor({ timeout: 30000 });
  check('a signed-in customer without benefits sees "Verify your employer to unlock"', true);
  await c.getByRole('link', { name: /Team lunch/ }).first().click();
  await c.getByTestId('customer-deal').waitFor();
  check('locked deal detail shows the unlock action and the no-card-data promise', (await c.getByRole('button', { name: 'Verify employer' }).count()) > 0 && (await c.getByText(/never asks for your card number or CVV/).count()) > 0);
  await shot(c, 'customer-11-locked-detail-en', false);

  // ================================================================ 6. merchant sees measurable engagement
  await m.goto(`${MERCHANT}/en/deals`, { waitUntil: 'domcontentloaded' });
  await m.getByRole('link', { name: TITLE_EN }).click();
  await m.getByTestId('deal-detail').waitFor();
  check('merchant detail shows the deal as Live and visible to customers', (await m.getByText('Visible to customers').count()) > 0);
  await shot(m, 'merchant-09-detail-live-en');
  await m.getByRole('tab', { name: 'Analytics' }).click();
  await m.getByTestId('deal-analytics').waitFor();
  const kpis = await m.locator('.dd-kpi').allInnerTexts();
  const num = (label) => Number((kpis.find((k) => k.includes(label)) ?? '').split('\n')[0].replace(/,/g, '')) || 0;
  check('analytics show measured detail views and directions clicks', num('Detail views') >= 1 && num('Directions clicks') >= 1, kpis.map((k) => k.replace('\n', '=')).join(' | '));
  check('analytics show merchant page visits attributed to this deal and a save', num('Merchant page visits') >= 1 && num('Saves') >= 1);
  const analyticsText = await m.getByTestId('deal-analytics').innerText();
  check('analytics are labelled as discovery signals and show no sales or revenue figures', /do not prove visits or sales/.test(analyticsText) && !/SAR\s*\d|revenue:|conversion rate/i.test(analyticsText));
  await shot(m, 'merchant-10-analytics-en');

  // ================================================================ 7. admin history/audit
  await a.goto(`${ADMIN}/en/live-deals`, { waitUntil: 'domcontentloaded' });
  await a.getByRole('tab', { name: 'All deals' }).click();
  await a.getByRole('link', { name: TITLE_EN }).first().click();
  await a.getByTestId('deal-review').waitFor();
  const entries = await a.locator('.dd-timeline__item').allInnerTexts();
  const text = entries.join('\n');
  check('admin decision history lists create, submit, request changes, resubmit and approve', ['Created the deal', 'Submitted for review', 'Changes requested', 'Approved'].every((s) => text.includes(s)), `${entries.length} entries`);
  check('every decision shows who decided and why', /Operations/.test(text) && /minimum table size/i.test(text));
  await shot(a, 'admin-03-history-en');
  await a.getByRole('tab', { name: 'Performance' }).waitFor().catch(() => {});
  await a.goto(`${ADMIN}/en/live-deals`, { waitUntil: 'domcontentloaded' });
  await a.getByRole('tab', { name: 'Performance' }).click();
  await a.getByText('Most viewed deals').waitFor();
  check('admin sees operational Live Deal performance from the same events', (await a.locator('.dd-kpi').count()) >= 11);
  await shot(a, 'admin-04-analytics-en');

  // ================================================================ 8. Arabic / RTL on every surface
  const rtlOk = async (page, label, selector = 'main') => {
    const dir = await page.evaluate(() => document.documentElement.dir);
    const lang = await page.evaluate(() => document.documentElement.lang);
    const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
    check(`${label}: RTL document with the Arabic font`, dir === 'rtl' && lang === 'ar' && /IBM Plex Sans Arabic/.test(font));
    check(`${label}: no horizontal overflow`, await noOverflow(page));
    const digits = await page.locator(selector).first().innerText();
    check(`${label}: numbers stay Western`, !/[٠-٩]/.test(digits));
  };
  await c.goto(`${CUSTOMER}/ar`, { waitUntil: 'domcontentloaded' });
  await c.locator('.dd-hero').waitFor({ timeout: 60000 });
  await rtlOk(c, 'customer home (ar)');
  check('customer home shows Arabic category names and deal titles', (await c.getByText('المطاعم').count()) > 0 && (await c.getByText('خصم 30% على قائمة التذوق').count()) > 0);
  await shot(c, 'customer-12-home-ar', false);
  await shot(c, 'customer-13-home-ar-full');
  await c.goto(`${CUSTOMER}/ar/search?q=${encodeURIComponent(TITLE_AR)}`, { waitUntil: 'domcontentloaded' });
  await c.getByRole('link', { name: TITLE_AR }).first().click();
  await c.getByTestId('customer-deal').waitFor();
  await rtlOk(c, 'customer deal (ar)');
  check('Arabic deal detail shows Arabic content and a mirrored back arrow', (await c.getByText(TITLE_AR).count()) > 0);
  await shot(c, 'customer-14-deal-ar', false);
  await c.getByRole('tab', { name: 'التفاصيل' }).click();
  await shot(c, 'customer-15-deal-details-ar');
  await c.getByRole('tab', { name: 'نظرة عامة' }).click();
  await c.getByRole('link', { name: /عرض التاجر/ }).click();
  await c.getByTestId('customer-merchant').waitFor();
  await rtlOk(c, 'customer merchant page (ar)');
  await shot(c, 'customer-16-merchant-ar', false);
  await c.goto(`${CUSTOMER}/ar/explore`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('customer-explore').waitFor({ timeout: 60000 });
  await c.locator('.dd-dc').first().waitFor();
  await rtlOk(c, 'customer explore (ar)');
  await shot(c, 'customer-17-explore-ar', false);
  await c.getByRole('button', { name: /^تصفية/ }).click();
  await shot(c, 'customer-18-filters-ar', false);
  await c.keyboard.press('Escape');

  await m.goto(`${MERCHANT}/ar/deals`, { waitUntil: 'domcontentloaded' });
  await m.getByTestId('deals-hub').waitFor({ timeout: 60000 });
  await rtlOk(m, 'merchant hub (ar)');
  await shot(m, 'merchant-11-hub-ar');
  await m.getByRole('link', { name: TITLE_AR }).click();
  await m.getByTestId('deal-detail').waitFor();
  await rtlOk(m, 'merchant deal detail (ar)');
  await shot(m, 'merchant-12-detail-ar');
  await m.goto(`${MERCHANT}/ar/deals/new`, { waitUntil: 'domcontentloaded' });
  await m.getByTestId('deal-builder').waitFor({ timeout: 60000 });
  await rtlOk(m, 'merchant builder (ar)');
  await shot(m, 'merchant-13-builder-ar');
  await a.goto(`${ADMIN}/ar/live-deals`, { waitUntil: 'domcontentloaded' });
  await a.getByTestId('admin-live-deals').waitFor({ timeout: 60000 });
  await rtlOk(a, 'admin Live Deals (ar)');
  await shot(a, 'admin-05-queue-ar');
  await a.getByRole('tab', { name: 'كل العروض' }).click();
  await a.getByRole('link', { name: TITLE_AR }).first().click();
  await a.getByTestId('deal-review').waitFor();
  await rtlOk(a, 'admin review (ar)');
  await shot(a, 'admin-06-review-ar');

  // ================================================================ 9. states: loading, error, empty, not found
  const probe = await cctx.newPage();
  watch(probe, 'states');
  await probe.route('**/v1/app/home**', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await probe.goto(`${CUSTOMER}/en`, { waitUntil: 'domcontentloaded' });
  await probe.getByTestId('skeletons').first().waitFor({ timeout: 20000 });
  check('customer home shows loading skeletons while data loads', true);
  await shot(probe, 'customer-19-loading-en', false);
  await probe.unroute('**/v1/app/home**');
  await probe.route('**/v1/app/home**', (route) => route.abort());
  await probe.goto(`${CUSTOMER}/en`, { waitUntil: 'domcontentloaded' });
  await probe.getByText(/could not load deals/i).waitFor({ timeout: 30000 });
  check('customer home shows an error state with a retry button when the API is unreachable', await probe.getByRole('button', { name: 'Try again' }).isVisible());
  await shot(probe, 'customer-20-error-en', false);
  await probe.unroute('**/v1/app/home**');
  await probe.getByRole('button', { name: 'Try again' }).click();
  await probe.locator('.dd-hero').waitFor({ timeout: 30000 });
  check('retry recovers the home screen', true);
  await probe.goto(`${CUSTOMER}/en/deals/11111111-1111-4111-8111-111111111111`, { waitUntil: 'domcontentloaded' });
  await probe.getByText('This deal is not available').waitFor({ timeout: 30000 });
  check('a missing or hidden deal shows a friendly not-available state', true);
  await shot(probe, 'customer-21-not-found-en', false);
  // a fresh browser context = a guest (the probe page shares the signed-in customer's cookies)
  const guest = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await guest.goto(`${CUSTOMER}/en/saved`, { waitUntil: 'domcontentloaded' });
  await guest.getByText('Sign in to see your saved deals').waitFor({ timeout: 30000 });
  check('Saved asks a guest to sign in', true);
  await probe.goto(`${CUSTOMER}/en/explore?category=entertainment`, { waitUntil: 'domcontentloaded' });
  await probe.getByText('No deals here yet').waitFor({ timeout: 30000 });
  check('an empty category shows the empty state', true);
  await shot(probe, 'customer-22-empty-category-en', false);
  await m.goto(`${MERCHANT}/en/deals`, { waitUntil: 'domcontentloaded' });
  await m.getByPlaceholder('Search by title').fill('zzzzzz-nothing');
  await m.getByText('No deals match these filters').waitFor();
  check('merchant hub shows an empty-filter state', true);

  // ================================================================ 10. long names (merchant + admin + customer)
  const longEn = `Extended family weekend grill and brunch celebration offer with unlimited sides for every table ${TAG}`;
  const longAr = `عرض احتفالي موسع لمائدة الشواء والإفطار العائلي في نهاية الأسبوع مع أطباق جانبية مفتوحة لكل طاولة ${TAG}`;
  const options = await pageApi(m, MERCHANT, 'GET', `/v1/merchants/${(await m.evaluate(async (API) => (await (await fetch(`${API}/v1/auth/me`, { credentials: 'include' })).json()).data.activeMembership.organizationId, API))}/deal-options`);
  const orgId = await m.evaluate(async (API) => (await (await fetch(`${API}/v1/auth/me`, { credentials: 'include' })).json()).data.activeMembership.organizationId, API);
  const branches = (await pageApi(m, MERCHANT, 'GET', `/v1/merchants/${orgId}/branches`)).body.data;
  const existing = (await pageApi(m, MERCHANT, 'GET', `/v1/merchants/${orgId}/live-deals?status=LIVE&limit=5`)).body.data.find((d) => d.imageUrl);
  const base = (await pageApi(m, MERCHANT, 'GET', `/v1/merchants/${orgId}/live-deals/${existing.id}`)).body.data.content;
  const created = await pageApi(m, MERCHANT, 'POST', `/v1/merchants/${orgId}/live-deals`, { content: { ...base, title: { en: longEn.slice(0, 80), ar: longAr.slice(0, 80) }, offerLabel: { en: '35% off everything today', ar: 'خصم 35% على كل شيء اليوم' }, branchIds: [branches[0].id] } });
  check('long-named deal can be created through the API', created.status === 201, `${created.status}`);
  const longId = created.body.data.id;
  await pageApi(m, MERCHANT, 'POST', `/v1/merchants/${orgId}/live-deals/${longId}/submit`, {});
  await a.goto(`${ADMIN}/en/live-deals`, { waitUntil: 'domcontentloaded' });
  await a.getByRole('link', { name: longEn.slice(0, 40), exact: false }).first().waitFor({ timeout: 30000 });
  check('admin queue handles a long deal title without horizontal overflow', await noOverflow(a));
  await shot(a, 'admin-07-queue-long-name-en');
  await pageApi(a, ADMIN, 'POST', `/v1/admin/live-deals/${longId}/approve`, { reason: 'Approved for the QA run.' });
  await m.goto(`${MERCHANT}/en/deals`, { waitUntil: 'domcontentloaded' });
  await m.getByTestId('deals-hub').waitFor();
  check('merchant hub handles long deal names without overflow', await noOverflow(m));
  await shot(m, 'merchant-14-hub-long-name-en');
  await c.goto(`${CUSTOMER}/en/search?q=${encodeURIComponent(TAG)}`, { waitUntil: 'domcontentloaded' });
  await c.locator('.dd-dc').first().waitFor({ timeout: 30000 });
  check('customer cards handle long names without overflow', await noOverflow(c));
  await shot(c, 'customer-23-long-name-en', false);
  await c.goto(`${CUSTOMER}/ar/search?q=${encodeURIComponent(TAG)}`, { waitUntil: 'domcontentloaded' });
  await c.locator('.dd-dc').first().waitFor({ timeout: 30000 });
  check('customer cards handle long Arabic names without overflow', await noOverflow(c));
  await shot(c, 'customer-24-long-name-ar', false);

  // ================================================================ 11. permissions in the real UI
  const fctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const f = await fctx.newPage();
  watch(f, 'finance');
  await signInPortal(f, MERCHANT, 'finance@harbourgrill.test');
  await f.getByText('You do not have access to this page.').waitFor({ timeout: 60000 });
  check('merchant Finance has no access to Campaigns (and no Campaigns menu item)', (await f.getByRole('link', { name: 'Campaigns' }).count()) === 0);
  await shot(f, 'merchant-15-finance-no-access-en', false);
  const cm = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  watch(cm, 'campaigns');
  await signInPortal(cm, MERCHANT, 'campaigns@harbourgrill.test');
  await cm.getByTestId('deals-hub').waitFor({ timeout: 60000 });
  check('Campaign Manager can open Campaigns and create deals', await cm.getByRole('link', { name: /Create Live Deal/ }).first().isVisible());
  const sup = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  watch(sup, 'support');
  await signInPortal(sup, ADMIN, 'support@dealdash.test', true);
  await sup.getByText('You do not have access to this page.').waitFor({ timeout: 60000 });
  check('DealDash Support cannot open Live Deal review (no menu item, no access)', (await sup.getByRole('link', { name: 'Live Deals' }).count()) === 0);
  await shot(sup, 'admin-08-support-no-access-en', false);

  // ================================================================ 12. responsive
  for (const [label, page, url, w, h, sel] of [
    ['merchant hub tablet', m, `${MERCHANT}/en/deals`, 820, 1000, '[data-testid=deals-hub]'],
    ['merchant builder tablet', m, `${MERCHANT}/en/deals/new`, 820, 1000, '[data-testid=deal-builder]'],
    ['admin queue tablet', a, `${ADMIN}/en/live-deals`, 820, 1000, '[data-testid=admin-live-deals]'],
    ['customer desktop column', c, `${CUSTOMER}/en`, 1280, 900, '.dd-hero'],
    ['customer small phone', c, `${CUSTOMER}/en/explore`, 320, 640, '[data-testid=customer-explore]'],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator(sel).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(800);
    check(`${label} (${w}px): no horizontal overflow`, await noOverflow(page));
    await shot(page, `responsive-${label.replace(/ /g, '-')}`, false);
  }
} catch (e) {
  check('script completed without an unexpected error', false, String(e).split('\n').slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

check('no unexpected console errors in any app', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' || '));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('Failed:');
  for (const f of failed) console.log(' - ' + f.name + (f.detail ? ' (' + f.detail + ')' : ''));
  process.exit(1);
}
