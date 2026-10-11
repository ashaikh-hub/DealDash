/**
 * Market / country configuration browser check (real Edge through playwright-core).
 *
 *   DealDash finance (manage + approve): market list, a market's overview, products, tax (draft), currency, invoice, payments,
 *   settlement, providers, legal / compliance, validation register (VALIDATE-KSA items mapped from the business rules), readiness
 *   and activation gate, audit history; a second administrator approves the draft; English and Arabic (RTL); phone width.
 *   DealDash operations (read only): sees markets without forms.
 *
 * Requires the API (4000) and admin (3005) apps running and the dev seed applied. SEED_USER_PASSWORD from the environment.
 *
 *   node tooling/e2e/markets-browser.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'markets');
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password you gave to the seed) before running.');
mkdirSync(OUT, { recursive: true });
const TAG = randomBytes(2).toString('hex').toUpperCase();
const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};
for (let ok = 0, tries = 0; ok < 5 && tries < 120; tries++) {
  ok = (await fetch(`${API}/v1/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 2000));
}
for (const l of ['en', 'ar']) await fetch(`${ADMIN}/${l}/markets`).catch(() => undefined);
const api = async (path) => (await (await fetch(API + path)).json()).data;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true, caret: 'initial' });
const watch = (page, label) => {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/401|403|404 \(Not Found\)|409|422|favicon|manifest|DevTools|aborted|net::ERR_FAILED|Failed to fetch/i.test(t)) return;
    consoleErrors.push(`[${label}] ${t}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror ${e.message}`));
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const otp = async (page, code) => {
  await page.locator('input[autocomplete="one-time-code"]').first().click();
  await page.keyboard.type(code, { delay: 25 });
};
async function signIn(page, email) {
  await page.goto(`${ADMIN}/en/markets`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 30000 });
  await otp(page, (await api(`/v1/dev/totp?email=${email}`)).code);
  // signed in = the shell's Sign out button (the sign-in panel itself is the page's h1 since Stage 9)
  await page.getByRole('button', { name: 'Sign out' }).first().waitFor({ timeout: 60000 });
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 45000 });
}
const newPage = async (viewport = { width: 1280, height: 900 }) => (await browser.newContext({ viewport })).newPage();
const step = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    check(name, false, String(e.message ?? e).split('\n')[0].slice(0, 220));
  }
};
const openMarket = async (page, code) => {
  await page.getByTestId(`mkt-row-${code}`).getByRole('button').click();
  await page.getByTestId('market-detail').waitFor({ timeout: 20000 });
};
const tab = async (page, name, testId) => {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.getByTestId(testId).waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
};

const fin = await newPage();
watch(fin, 'finance');
await signIn(fin, 'finance@dealdash.test');
await step('finance: market list', async () => {
  await fin.getByTestId('mkt-list').waitFor({ timeout: 30000 });
  await fin.getByTestId('mkt-row-SA').waitFor({ timeout: 30000 });
  const sa = await fin.getByTestId('mkt-row-SA').innerText();
  check('finance: Saudi Arabia is listed as a Pilot market in the GCC region with its readiness', /Pilot/.test(sa) && /Gulf Cooperation Council/.test(sa) && /(Not ready|Validation required|Ready)/.test(sa));
  const nav = await fin.locator('.dd-sidebar').innerText();
  check('finance: Markets is in the navigation', nav.includes('Markets'));
  await shot(fin, 'admin-markets-list');
});
await step('finance: Saudi Arabia market tabs', async () => {
  await openMarket(fin, 'SA');
  await shot(fin, 'admin-market-overview');
  check('finance: overview shows the lifecycle and activation gate', /Lifecycle and activation gate/.test(await fin.getByTestId('mkt-lifecycle').innerText()));
  await tab(fin, 'Products', 'mkt-products');
  check('finance: products show per-market availability', /Exclusive Deals/.test(await fin.getByTestId('mkt-products').innerText()));
  await shot(fin, 'admin-market-products');
  await tab(fin, 'Tax', 'mkt-tax');
  await shot(fin, 'admin-market-tax');
  await tab(fin, 'Currency', 'mkt-currency');
  check('finance: currency shows default, billing, settlement and tax currency', /Settlement currency/.test(await fin.getByTestId('mkt-currency').innerText()));
  await shot(fin, 'admin-market-currency');
  await tab(fin, 'Invoice', 'mkt-invoice');
  await shot(fin, 'admin-market-invoice');
  await tab(fin, 'Payments', 'mkt-payments');
  await shot(fin, 'admin-market-payments');
  await tab(fin, 'Settlement', 'mkt-settlement');
  await shot(fin, 'admin-market-settlement');
  await tab(fin, 'Providers', 'mkt-providers');
  await shot(fin, 'admin-market-providers');
  await tab(fin, 'Legal and compliance', 'mkt-compliance');
  await shot(fin, 'admin-market-compliance');
  await tab(fin, 'Validation register', 'mkt-validations');
  await fin.getByTestId('mkt-validation-VALIDATE-KSA-VK-03').waitFor({ timeout: 20000 });
  const v = await fin.getByTestId('mkt-validations').innerText();
  check('finance: the register holds the existing VALIDATE-KSA items and the launch-readiness items', /VALIDATE-KSA-VK-03/.test(v) && /VALIDATE-KSA-AI-CONSENT/.test(v) && /VALIDATE-KSA-ARABIC-REVIEW/.test(v));
  await shot(fin, 'admin-market-validations');
  await tab(fin, 'Readiness', 'mkt-readiness');
  const r = await fin.getByTestId('mkt-readiness').innerText();
  check('finance: readiness lists every launch check with its state (no silent activation)', /Tax treatment/.test(r) && /Local validations signed off/.test(r) && /(Missing|Validation required)/.test(r));
  await shot(fin, 'admin-market-readiness');
  await tab(fin, 'Audit history', 'mkt-history');
  await shot(fin, 'admin-market-history');
});
await step('finance: drafts a tax rule version (a second administrator approves it)', async () => {
  await fin.goto(`${ADMIN}/en/markets`, { waitUntil: 'domcontentloaded' });
  await fin.getByTestId('mkt-row-AE').waitFor({ timeout: 30000 });
  await openMarket(fin, 'AE');
  await tab(fin, 'Tax', 'mkt-tax');
  await fin.getByLabel('Rule code').fill(`QA-${TAG}`);
  await fin.getByLabel('Rate (%)').fill('5');
  await fin.getByLabel('Effective from').fill(new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10));
  await fin.getByTestId('mkt-tax-draft').click();
  await fin.getByText('Draft saved. A second administrator approves it.').waitFor({ timeout: 20000 });
  const row = fin.getByTestId('mkt-versions-tax-rules').locator('tbody tr', { hasText: `QA-${TAG}` }).first();
  await row.waitFor({ timeout: 20000 });
  check('finance: the creator of a draft cannot approve it', (await row.getByRole('button', { name: 'Approve' }).count()) === 0 && /A different administrator must approve/.test(await row.innerText()));
  await shot(fin, 'admin-market-tax-draft');
});
await step('finance: Arabic right-to-left', async () => {
  await fin.goto(`${ADMIN}/ar/markets`, { waitUntil: 'domcontentloaded' });
  await fin.getByTestId('mkt-row-SA').waitFor({ timeout: 30000 });
  const dir = await fin.evaluate(() => document.documentElement.dir);
  const h1 = await fin.getByRole('heading', { level: 1 }).first().innerText();
  check('admin: /ar/markets is right-to-left with an Arabic heading', dir === 'rtl' && /[؀-ۿ]/.test(h1), `${dir} ${h1}`);
  check('admin: /ar/markets has no horizontal overflow', await noOverflow(fin));
  check('admin: /ar/markets uses Western digits only', !/[٠-٩]/.test(await fin.locator('main').innerText()));
  await shot(fin, 'admin-ar-markets');
  await openMarket(fin, 'SA');
  await fin.getByRole('tab', { name: 'الجاهزية' }).click();
  await fin.getByTestId('mkt-readiness').waitFor({ timeout: 20000 });
  await fin.waitForTimeout(800);
  check('admin: Arabic readiness is right-to-left without overflow', await noOverflow(fin));
  await shot(fin, 'admin-ar-market-readiness');
});

const ops = await newPage();
watch(ops, 'ops');
await signIn(ops, 'operations@dealdash.test');
await step('operations: read-only access', async () => {
  await ops.getByTestId('mkt-row-SA').waitFor({ timeout: 30000 });
  check('operations: no "add a market" form for a read-only role', (await ops.getByTestId('mkt-new').count()) === 0);
  await openMarket(ops, 'SA');
  check('operations: no master form or status change for a read-only role', (await ops.getByTestId('mkt-master-form').count()) === 0 && (await ops.getByTestId('mkt-request-status').count()) === 0);
});

const sa = await newPage();
watch(sa, 'super');
await signIn(sa, 'super@dealdash.test');
await step('second administrator approves the draft', async () => {
  await sa.getByTestId('mkt-row-AE').waitFor({ timeout: 30000 });
  await openMarket(sa, 'AE');
  await tab(sa, 'Tax', 'mkt-tax');
  const row = sa.getByTestId('mkt-versions-tax-rules').locator('tbody tr', { hasText: `QA-${TAG}` }).first();
  await row.getByRole('button', { name: 'Approve' }).click();
  await sa.getByText('Approved.').waitFor({ timeout: 20000 });
  check('second administrator: the draft is approved', /Approved/.test(await sa.getByTestId('mkt-versions-tax-rules').locator('tbody tr', { hasText: `QA-${TAG}` }).first().innerText()));
  // tidy up: the QA version is retired (approved configuration is never deleted)
  await sa.getByTestId('mkt-versions-tax-rules').locator('tbody tr', { hasText: `QA-${TAG}` }).first().getByRole('button', { name: 'Retire' }).click();
  await sa.getByText('Retired (history kept).').waitFor({ timeout: 20000 });
  check('cleanup: the QA tax version is retired (history kept)', true);
});

const phone = await newPage({ width: 390, height: 844 });
watch(phone, 'phone');
await signIn(phone, 'finance@dealdash.test');
await step('phone width', async () => {
  await phone.getByTestId('mkt-row-SA').waitFor({ timeout: 30000 });
  check('phone width: markets list has no horizontal page overflow', await noOverflow(phone));
  await shot(phone, 'phone-markets');
  await openMarket(phone, 'SA');
  check('phone width: market detail has no horizontal page overflow', await noOverflow(phone));
  await shot(phone, 'phone-market-detail');
});

check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
