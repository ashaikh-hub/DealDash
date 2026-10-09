/**
 * Shared platform, Phase 3 browser check (real Edge through playwright-core; no browser download needed).
 *
 *   Merchant: opens a case, writes a note, attaches evidence, opens the evidence
 *   Admin:    sees the case, adds an INTERNAL note and INTERNAL evidence, takes the case, closes it
 *   Merchant: sees the closure, the shared note and shared evidence only (nothing internal)
 *   Admin:    creates a loyalty rule, cannot approve their own, a second person approves; finance view; offer-conflict scan
 *   Merchant: creates a merchant-funded loyalty rule; sending it for approval is refused until the commercial terms are accepted
 * plus Arabic / right-to-left for every Phase 3 screen, a phone-width layout and console errors.
 *
 * Requires the API (4000), merchant (3002) and admin (3005) apps running and the dev seed applied.
 * The seed password comes from the environment (never stored in this file):
 *   SEED_USER_PASSWORD
 *
 *   node tooling/e2e/phase3-browser.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:3002';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'phase3');
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password you gave to the seed) before running.');
mkdirSync(OUT, { recursive: true });

const TAG = randomBytes(3).toString('hex');
const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};

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
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true, caret: 'initial' });
const watch = (page, label) => {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/401|403|404 \(Not Found\)|409|422|favicon|manifest|Download the React DevTools|aborted|net::ERR_FAILED|Failed to fetch/i.test(t)) return; // expected refusals the screens show in words
    consoleErrors.push(`[${label}] ${t}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror ${e.message}`));
  if (process.env.DEBUG_HTTP)
    page.on('response', async (r) => {
      if (r.status() >= 400 && r.url().startsWith(API)) console.log('  HTTP', r.status(), r.request().method(), r.url().replace(API, ''), (await r.text().catch(() => '')).slice(0, 200));
    });
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const otp = async (page, code) => {
  await page.locator('input[autocomplete="one-time-code"]').first().click();
  await page.keyboard.type(code, { delay: 25 });
};
async function signIn(page, base, email, route, adminTotp = false) {
  await page.goto(`${base}/en/${route}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (adminTotp) {
    await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 30000 });
    await otp(page, (await api(`/v1/dev/totp?email=${email}`)).code);
  }
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 45000 });
}
const newPage = async (viewport = { width: 1280, height: 900 }) => {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  return ctx.newPage();
};
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    check(name, false, String(e.message ?? e).split('\n')[0].slice(0, 220));
  }
};

const subject = `QA payout question ${TAG}`;
let reference = '';

// ============================================================ merchant: opens a case with evidence
const m = await newPage();
watch(m, 'merchant');
await signIn(m, MERCHANT, 'owner@harbourgrill.test', 'operations');
await step('merchant: operations workspace with inbox, cases and activity', async () => {
  const tabs = await m.getByRole('tab').allInnerTexts();
  check('merchant: operations workspace with inbox, cases and activity', ['Inbox', 'Cases', 'Activity'].every((x) => tabs.includes(x)), tabs.join(','));
  await shot(m, 'merchant-inbox');
});
await step('merchant: opens a case', async () => {
  await m.getByRole('tab', { name: 'Cases' }).click();
  await m.getByTestId('op-case-new').click();
  await m.getByLabel('Short title').fill(subject);
  await m.getByLabel('Details').fill('The last payout is lower than the statement.');
  await m.getByTestId('op-case-submit').click();
  const detail = m.getByTestId('op-case-detail');
  await detail.waitFor({ timeout: 20000 });
  reference = (await detail.locator('h3 .dd-ltr').innerText()).trim();
  check('merchant: opens a case', /^DC-[0-9A-F]{8}$/.test(reference), reference);
});
await step('merchant: writes a note', async () => {
  const detail = m.getByTestId('op-case-detail');
  await detail.getByLabel('Your note').fill('Statement attached for reference');
  await detail.getByTestId('op-note-add').click();
  await detail.getByText('Statement attached for reference').waitFor({ timeout: 15000 });
  check('merchant: writes a note (shared with DealDash by design: no visibility choice shown)', (await detail.getByLabel('Who can read it').count()) === 0);
});
await step('merchant: attaches evidence and opens it', async () => {
  const detail = m.getByTestId('op-case-detail');
  await m.setInputFiles('#op-ev-file', { name: 'statement.png', mimeType: 'image/png', buffer: png(640, 400) });
  await detail.getByTestId('op-evidence-item').first().waitFor({ timeout: 30000 });
  const text = await detail.getByTestId('op-evidence').innerText();
  check('merchant: attaches evidence', /statement\.png/.test(text), text.replace(/\s+/g, ' ').slice(0, 120));
  const [popup] = await Promise.all([m.waitForEvent('popup', { timeout: 15000 }), detail.getByRole('button', { name: 'Open' }).first().click()]);
  const status = await popup.evaluate(() => document.contentType).catch(() => '');
  check('merchant: evidence opens through a signed link', !!popup.url() && popup.url().startsWith('http'), `${status} ${popup.url().slice(0, 50)}`);
  await popup.close();
  await shot(m, 'merchant-case');
});

// ============================================================ admin: internal note + evidence, takes and closes
const a = await newPage();
watch(a, 'admin');
await signIn(a, ADMIN, 'super@dealdash.test', 'operations', true);
await step('admin: sees the case and DealDash-only controls', async () => {
  await a.getByRole('tab', { name: 'Cases' }).click();
  await a.getByTestId(`op-case-open-${reference}`).click();
  const detail = a.getByTestId('op-case-detail');
  await detail.waitFor({ timeout: 20000 });
  check('admin: sees the case with the business’s note and file', (await detail.innerText()).includes('Statement attached for reference') && (await detail.getByTestId('op-evidence-item').count()) === 1);
  check('admin: has the DealDash-only controls (visibility, take, close)', (await detail.getByLabel('Who can read it').count()) === 1 && (await detail.getByTestId('op-case-assign').count()) === 1 && (await detail.getByTestId('op-case-resolve').count()) === 1);
});
await step('admin: internal note and internal evidence', async () => {
  const detail = a.getByTestId('op-case-detail');
  await detail.getByLabel('Your note').fill('INTERNAL ledger check ' + TAG);
  await detail.getByLabel('Who can read it').selectOption('INTERNAL');
  await detail.getByTestId('op-note-add').click();
  await detail.getByText('INTERNAL ledger check ' + TAG).waitFor({ timeout: 15000 });
  await detail.locator('#op-ev-vis').selectOption('INTERNAL');
  await a.setInputFiles('#op-ev-file', { name: 'internal.png', mimeType: 'image/png', buffer: png(640, 400) });
  await detail.getByText('internal.png').waitFor({ timeout: 30000 });
  check('admin: adds an internal note and internal evidence', (await detail.getByText('DealDash only').count()) >= 2);
  await shot(a, 'admin-case');
});
await step('admin: takes the case and closes it with a recorded reason', async () => {
  const detail = a.getByTestId('op-case-detail');
  await detail.getByTestId('op-case-assign').click();
  await detail.getByText('You now own this case.').waitFor({ timeout: 15000 });
  await detail.getByLabel('What was decided and why').fill('Fee rule explained to the business');
  await detail.getByTestId('op-case-resolve').click();
  await detail.getByText('This case is closed.').waitFor({ timeout: 15000 });
  check('admin: takes the case and closes it', (await detail.getByTestId('op-note-add').count()) === 0 && (await a.locator('#op-ev-file').count()) === 0);
});

// ============================================================ merchant: sees closure, nothing internal
await step('merchant: sees the closure and nothing internal', async () => {
  await m.reload({ waitUntil: 'domcontentloaded' });
  await m.getByRole('tab', { name: 'Cases' }).click();
  await m.getByTestId(`op-case-open-${reference}`).click();
  const detail = m.getByTestId('op-case-detail');
  await detail.waitFor({ timeout: 20000 });
  const text = await detail.innerText();
  check('merchant: sees the closure and the reason', /This case is closed\./.test(text) && /Fee rule explained/.test(text));
  check('merchant: sees NO internal note or internal evidence', !text.includes('INTERNAL ledger check') && !/internal\.png/.test(text) && (await detail.getByTestId('op-evidence-item').count()) === 1);
  await m.getByRole('tab', { name: 'Activity' }).click();
  await m.getByTestId('op-activity-row').first().waitFor({ timeout: 15000 });
  const act = await m.getByTestId('op-activity').innerText();
  check('merchant: activity history in plain language without staff identities', /A case was opened/.test(act) && /DealDash/.test(act) && !/super@dealdash/.test(act));
  await shot(m, 'merchant-activity');
});

// ============================================================ admin: loyalty (maker-checker), finance view, conflicts
await step('admin: creates a loyalty rule and cannot approve their own', async () => {
  await a.goto(`${ADMIN}/en/loyalty`, { waitUntil: 'domcontentloaded' });
  await a.getByTestId('lo-new').click();
  await a.getByLabel('Rule name').fill(`QA Welcome ${TAG}`);
  await a.getByTestId('lo-create').click();
  const row = a.getByTestId(`lo-rule-QA Welcome ${TAG}`);
  await row.waitFor({ timeout: 20000 });
  await row.getByTestId(`lo-submit-QA Welcome ${TAG}`).click();
  await row.getByText('Waiting for approval').waitFor({ timeout: 15000 });
  await row.getByTestId(`lo-approve-QA Welcome ${TAG}`).click();
  await a.getByText('A different person must approve this (two-person control).').waitFor({ timeout: 15000 });
  check('admin: loyalty rule created and the author cannot approve it', true);
  await shot(a, 'admin-loyalty');
});
const f = await newPage();
watch(f, 'finance');
await signIn(f, ADMIN, 'finance@dealdash.test', 'loyalty', true);
await step('admin: a second person approves', async () => {
  const row = f.getByTestId(`lo-rule-QA Welcome ${TAG}`);
  await row.waitFor({ timeout: 20000 });
  check('finance: can approve but not create', (await f.getByTestId('lo-new').count()) === 0);
  await row.getByTestId(`lo-approve-QA Welcome ${TAG}`).click();
  await row.getByText('Active').waitFor({ timeout: 15000 });
  check('admin: a second person approves and the rule becomes active', true);
  await f.getByRole('tab', { name: 'Points and funding' }).click();
  await f.getByText('Points are not money and have no fixed cash value.').first().waitFor({ timeout: 10000 });
  check('finance: the finance view states that points have no fixed cash value', true);
  await shot(f, 'admin-loyalty-finance');
});
await step('admin: offer-conflict review and scan', async () => {
  await a.goto(`${ADMIN}/en/operations`, { waitUntil: 'domcontentloaded' });
  await a.getByRole('tab', { name: 'Offer conflicts' }).click();
  await a.getByTestId('op-conf-scan').click();
  await a.getByTestId('op-conflicts').waitFor({ timeout: 15000 });
  await a.getByTestId('op-banner').waitFor({ timeout: 15000 });
  const errors = await a.locator('[data-testid=op-banner] .dd-alert--danger').allInnerTexts();
  check('admin: offer conflicts tab and scan work', errors.length === 0, errors.join(' | ').slice(0, 160));
  await shot(a, 'admin-conflicts');
});

// ============================================================ merchant: funded loyalty rule is gated by the commercial terms
await step('merchant: a funded rule cannot go for approval before the commercial terms are accepted', async () => {
  await m.goto(`${MERCHANT}/en/loyalty`, { waitUntil: 'domcontentloaded' });
  await m.getByTestId('lo-new').click();
  await m.getByLabel('Rule name').fill(`QA Merchant bonus ${TAG}`);
  await m.getByLabel('The funder pays per point (SAR)').fill('0.04');
  await m.getByTestId('lo-create').click();
  const row = m.getByTestId(`lo-rule-QA Merchant bonus ${TAG}`);
  await row.waitFor({ timeout: 20000 });
  await row.getByTestId(`lo-submit-QA Merchant bonus ${TAG}`).click();
  await m.getByText('Review and accept the commercial terms before continuing.').waitFor({ timeout: 15000 });
  check('merchant: funded rule is refused until the commercial terms are accepted (in words)', true);
  await shot(m, 'merchant-loyalty');
});

// ============================================================ Arabic / RTL on every Phase 3 screen
for (const [page, base, label, paths] of [
  [m, MERCHANT, 'merchant', ['operations', 'loyalty']],
  [a, ADMIN, 'admin', ['operations', 'loyalty']],
]) {
  for (const p of paths) {
    await step(`${label}: Arabic ${p}`, async () => {
      await page.goto(`${base}/ar/${p}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 });
      const dir = await page.evaluate(() => document.documentElement.dir);
      const h1 = await page.getByRole('heading', { level: 1 }).first().innerText();
      const arabic = /[؀-ۿ]/.test(h1);
      check(`${label}: /ar/${p} is right-to-left with an Arabic heading`, dir === 'rtl' && arabic, `${dir} ${h1}`);
      check(`${label}: /ar/${p} has no horizontal overflow`, await noOverflow(page));
      await shot(page, `${label}-ar-${p}`);
    });
  }
}
await step('merchant: Arabic cases tab', async () => {
  await m.goto(`${MERCHANT}/ar/operations`, { waitUntil: 'domcontentloaded' });
  await m.getByRole('tab', { name: 'القضايا' }).click();
  await m.getByTestId(`op-case-open-${reference}`).waitFor({ timeout: 20000 });
  await m.getByTestId(`op-case-open-${reference}`).click();
  const detail = m.getByTestId('op-case-detail');
  await detail.waitFor({ timeout: 15000 });
  const text = await detail.innerText();
  check('merchant: Arabic case detail has Arabic labels and Western digits in the reference', /الأدلة/.test(text) && /DC-[0-9A-F]{8}/.test(text) && /مغلقة|تم الحل/.test(await m.getByTestId(`op-case-${reference}`).innerText()));
  check('merchant: Arabic case detail has no horizontal overflow', await noOverflow(m));
  await shot(m, 'merchant-ar-case');
});

// ============================================================ phone width
const phone = await newPage({ width: 390, height: 844 });
watch(phone, 'phone');
await signIn(phone, MERCHANT, 'owner@harbourgrill.test', 'operations');
for (const p of ['operations', 'loyalty']) {
  await step(`phone: ${p}`, async () => {
    await phone.goto(`${MERCHANT}/en/${p}`, { waitUntil: 'domcontentloaded' });
    await phone.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 });
    check(`phone width: ${p} has no horizontal page overflow`, await noOverflow(phone));
    await shot(phone, `phone-${p}`);
  });
}

// ============================================================ cleanup: the QA earning rule must not keep paying in the dev database
await step('cleanup: pause the QA earning rule this run created (audited, nothing deleted)', async () => {
  const outcome = await a.evaluate(
    async ({ apiUrl, name }) => {
      const me = (await (await fetch(`${apiUrl}/v1/auth/me`, { credentials: 'include' })).json()).data;
      const rules = (await (await fetch(`${apiUrl}/v1/admin/loyalty/rules`, { credentials: 'include' })).json()).data ?? [];
      const rule = rules.find((r) => r.name === name && r.status === 'ACTIVE');
      if (!rule) return 'none';
      const r = await fetch(`${apiUrl}/v1/admin/loyalty/rules/${rule.id}/pause`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'X-CSRF-Token': me.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ reason: 'QA browser run finished: the test rule is paused so it does not keep earning' }),
      });
      return String(r.status);
    },
    { apiUrl: API, name: `QA Welcome ${TAG}` },
  );
  check('cleanup: the QA earning rule is paused at the end of the run', outcome === '200' || outcome === 'none', outcome);
});

check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
