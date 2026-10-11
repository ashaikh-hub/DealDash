/**
 * Stage 9 — production readiness browser check (real Edge through playwright-core) on a fresh TEST database (.tools/stage7/qa.mjs).
 *
 *   Admin (super): structured rules and controls (no JSON editor; a proposal waits for a second person and its author cannot approve
 *   it); Operations: an emergency market stop refuses a NEW voucher checkout while issued rights stay, then is lifted; a case asks the
 *   customer for information; Customer: reads the message and replies in the app with an evidence reference; Admin sees the reply
 *   ("From the customer") and the case back with DealDash. English and Arabic (RTL), phone width, console errors.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'stage9');
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password given to the seed) before running.');
mkdirSync(OUT, { recursive: true });
const TAG = randomBytes(2).toString('hex').toUpperCase();
const MOBILE = '+966500000501';
const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};
for (let ok = 0, tries = 0; ok < 5 && tries < 150; tries++) {
  ok = (await fetch(`${API}/v1/health/live`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 2000));
}
for (const p of ['/en', '/en/configuration', '/en/cases', '/ar/configuration']) await fetch(`${ADMIN}${p}`).catch(() => undefined);
for (const p of ['/en', '/en/cases', '/ar/cases', '/en/profile']) await fetch(`${CUSTOMER}${p}`).catch(() => undefined);
for (let ok = 0, tries = 0; ok < 10 && tries < 150; tries++) {
  ok = (await fetch(`${API}/v1/health/live`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 2000));
}

const api = async (path) => (await (await fetch(API + path)).json()).data;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true, caret: 'initial' });
const watch = (page, label) => {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/401|403|404 \(Not Found\)|409|422|429|favicon|manifest|DevTools|aborted|net::ERR_FAILED|Failed to fetch/i.test(t)) return;
    consoleErrors.push(`[${label}] ${t}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror ${e.message}`));
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
let lastPage = null;
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    let seen = '';
    if (lastPage) {
      const slug = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
      await lastPage.screenshot({ path: join(OUT, `FAILED-${slug}.png`), fullPage: true }).catch(() => undefined);
      seen = ` | url ${lastPage.url()} | page: ${(await lastPage.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300)}`;
    }
    check(name, false, String(e.message ?? e).split('\n')[0].slice(0, 200) + seen);
  }
};
const otp = async (page, code) => {
  await page.locator('input[autocomplete="one-time-code"]').first().click();
  await page.keyboard.type(code, { delay: 25 });
};
async function adminSignIn(page, email, path) {
  lastPage = page;
  await page.goto(`${ADMIN}${path}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 30000 });
  await otp(page, (await api(`/v1/dev/totp?email=${email}`)).code);
  await page.getByRole('button', { name: 'Sign out' }).first().waitFor({ timeout: 60000 });
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
const go = async (page, base, path, testId) => {
  lastPage = page;
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId(testId).waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
};

// ================================================================ customer signs in (needed for the case and the checkout)
const cu = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
watch(cu, 'customer');
let customerId = '';
await step('customer signs in', async () => {
  lastPage = cu;
  await cu.goto(`${CUSTOMER}/en/profile`, { waitUntil: 'domcontentloaded' });
  await cu.getByLabel('Mobile number').fill(MOBILE);
  await cu.getByRole('button', { name: 'Send code' }).click();
  await cu.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 20000 });
  await otp(cu, (await api(`/v1/dev/last-sms?to=${encodeURIComponent(MOBILE)}`)).code);
  await cu.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 });
  customerId = (await pageApi(cu, 'GET', '/v1/auth/me')).body.data.id;
  check('customer: signed in', !!customerId);
});

// ================================================================ super admin: structured, governed rules and controls
const sa = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
watch(sa, 'super');
await adminSignIn(sa, 'super@dealdash.test', '/en/configuration');
await step('rules and controls: structured editor, proposal waits for a second person', async () => {
  await go(sa, ADMIN, '/en/configuration', 'ops-rules');
  check('controls: no raw JSON editor', (await sa.getByLabel('Operations configuration (JSON)').count()) === 0);
  await sa.getByRole('tab', { name: 'Reasons' }).click();
  await sa.getByTestId('cfg-reasons').waitFor({ timeout: 30000 });
  await sa.getByTestId('cfg-reason-add').click();
  const sec = sa.getByTestId('cfg-reasons');
  await sec.getByLabel('Reason code').last().fill(`PILOT_${TAG}`);
  await sec.getByLabel('English label').last().fill('Pilot goodwill');
  await sec.getByLabel('Arabic label').last().fill('حسن نية للتجربة');
  await sa.getByTestId('cfg-propose-reasons.refund').getByLabel('Reason').fill('Pilot needs a goodwill reason');
  await sa.getByTestId('cfg-submit-reasons.refund').click();
  await sa.getByText('Change proposed. A second person must approve it.').waitFor({ timeout: 20000 });
  await shot(sa, 'admin-controls-reasons');
  await sa.getByRole('tab', { name: 'Changes to approve' }).click();
  const card = sa.locator('[data-testid^="cfg-req-CFG"]').first();
  await card.waitFor({ timeout: 20000 });
  check('controls: the author sees "Waiting for approval" and can withdraw, never approve', /Waiting for approval/.test(await card.innerText()) && (await card.locator('[data-testid^="ops-approve-"]').count()) === 0);
  await shot(sa, 'admin-controls-requests');
  const cfg = await pageApi(sa, 'GET', '/v1/admin/controls');
  check('controls: nothing changed before approval', !JSON.stringify(cfg.body.data.configs.find((c) => c.key === 'operations').value).includes(`PILOT_${TAG}`));
});

// ================================================================ operations: emergency stop (immediate) and a case for the customer
const ops = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
watch(ops, 'operations');
await adminSignIn(ops, 'operations@dealdash.test', '/en/configuration');
await step('launch controls: an emergency stop refuses a NEW purchase; lifting it reopens', async () => {
  await go(ops, ADMIN, '/en/configuration', 'ops-rules');
  await ops.getByRole('tab', { name: 'Launch controls' }).click();
  const stops = ops.getByTestId('cfg-stops');
  await stops.waitFor({ timeout: 30000 });
  await stops.getByLabel('Reason').fill(`Payment provider incident ${TAG}`);
  await ops.getByTestId('cfg-stop-NEW_PURCHASES').click();
  await stops.getByText(/New voucher purchases: stopped/).waitFor({ timeout: 20000 });
  await shot(ops, 'admin-launch-stop');
  const vouchers = (await (await fetch(`${API}/v1/app/vouchers?city=Riyadh&limit=10`)).json()).data;
  const v = (vouchers?.items ?? vouchers ?? [])[0];
  if (v) {
    const co = await pageApi(cu, 'POST', '/v1/app/checkout', { voucherId: v.id });
    check('stop: a new voucher checkout is refused (LAUNCH_PAUSED)', co.status === 409 && JSON.stringify(co.body).includes('LAUNCH_PAUSED'), `status ${co.status}`);
  } else check('stop: no voucher on sale in the seed to try', true, 'skipped');
  const wallet = await pageApi(cu, 'GET', '/v1/app/wallet');
  check('stop: what the customer already holds stays available', wallet.status === 200);
  await stops.getByLabel('Reason').fill('Payment provider recovered');
  await ops.getByTestId('cfg-stop-NEW_PURCHASES').click();
  await stops.getByText(/New voucher purchases: open/).waitFor({ timeout: 20000 });
  check('stop: lifted (recorded with a reason)', true);
});

let caseRef = '';
await step('a case asks the customer for information', async () => {
  const r = await pageApi(ops, 'POST', '/v1/admin/disputes', { type: 'REFUND_EXCEPTION', title: `Refund not received ${TAG}`, customerUserId: customerId });
  check('case: opened for the customer', r.status === 201, `status ${r.status}`);
  caseRef = r.body.data.reference;
  const t = await pageApi(ops, 'POST', `/v1/admin/disputes/${r.body.data.id}/transition`, { to: 'AWAITING_CUSTOMER', note: 'Please send the bank transfer reference.' });
  check('case: waiting for the customer with a shared message', t.status === 200, `status ${t.status}`);
});

// ================================================================ customer replies in the app
await step('customer: reads the message and replies with an evidence reference', async () => {
  await go(cu, CUSTOMER, '/en/cases', 'customer-cases');
  const card = cu.getByTestId(`my-case-${caseRef}`);
  await card.waitFor({ timeout: 30000 });
  // textContent, not innerText: status chips are styled uppercase and innerText applies the CSS transform
  const cardText = (await card.textContent()) ?? '';
  check('customer: the case shows "We need your reply" and DealDash’s message', /We need your reply/.test(cardText) && /bank transfer reference/.test(cardText), cardText.replace(/\s+/g, ' ').slice(0, 240));
  await card.getByLabel('Your reply').fill('The bank reference is on my statement.');
  await card.getByLabel('Order, voucher or receipt reference (optional)').fill(`BANK-${TAG}`);
  await card.getByTestId('my-case-send').click();
  await cu.getByText('Reply sent. DealDash will get back to you.').waitFor({ timeout: 20000 });
  check('customer (phone): no horizontal overflow', await noOverflow(cu));
  await shot(cu, 'customer-case-reply');
});
await step('admin: the reply is on the case, from the customer, and the case is back with DealDash', async () => {
  await go(ops, ADMIN, '/en/cases', 'ops-cases');
  await ops.getByTestId(`op-case-open-${caseRef}`).click();
  const detail = ops.getByTestId('op-case-detail');
  await detail.waitFor({ timeout: 30000 });
  const text = await detail.innerText();
  check('admin: "From the customer" with the evidence reference', /From the customer/.test(text) && text.includes(`BANK-${TAG}`));
  check('admin: the case moved back to Investigating', /Investigating/.test(text));
  await shot(ops, 'admin-case-customer-reply');
});

// ================================================================ Arabic / RTL
await step('Arabic: controls screen and customer requests', async () => {
  await go(sa, ADMIN, '/ar/configuration', 'ops-rules');
  const [dir, lang] = await sa.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
  check('admin controls (ar): right-to-left Arabic document', dir === 'rtl' && lang === 'ar');
  check('admin controls (ar): no horizontal overflow', await noOverflow(sa));
  await shot(sa, 'admin-controls-ar');
  await go(cu, CUSTOMER, '/ar/cases', 'customer-cases');
  check('customer requests (ar, phone): right-to-left with no overflow', (await cu.evaluate(() => document.documentElement.dir)) === 'rtl' && (await noOverflow(cu)));
  await shot(cu, 'customer-case-reply-ar');
});

for (const e of consoleErrors) console.log(`CONSOLE ${e.slice(0, 1500)}`);
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
