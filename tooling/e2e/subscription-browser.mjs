/**
 * Subscription / licensing / entitlement browser check (real Edge through playwright-core; no browser download needed).
 *
 *   Merchant: Plan and usage shows the plan, status, price in the contract currency, renewal, usage meters, entitlements, add-ons,
 *             plan history; previews a downgrade (impact before anything changes), requests it for the next billing cycle, then
 *             cancels it (nothing changes); asks why something is unavailable
 *   Merchant Finance user: sees the plan, cannot request a change
 *   Admin:    agreements (enterprise kinds, fixtures marked), agreement detail with terms, pricing version, entitlements, acceptances
 *             and lifecycle; plan catalog with country versions; price book; add-ons; billing events; signals; readiness
 * plus Arabic / right-to-left for both screens, phone-width layout and console errors.
 *
 * Requires the API (4000), merchant (3002) and admin (3005) apps running and the dev seed applied.
 * The seed password comes from the environment (never stored in this file):
 *   SEED_USER_PASSWORD
 *
 *   node tooling/e2e/subscription-browser.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:3002';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'subscription');
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password you gave to the seed) before running.');
mkdirSync(OUT, { recursive: true });

const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};
const api = async (path) => (await (await fetch(API + path)).json()).data;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true, caret: 'initial' });
const watch = (page, label) => {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/401|403|404 \(Not Found\)|409|422|favicon|manifest|Download the React DevTools|aborted|net::ERR_FAILED|Failed to fetch/i.test(t)) return;
    consoleErrors.push(`[${label}] ${t}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror ${e.message}`));
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
async function signIn(page, base, email, route, adminTotp = false) {
  await page.goto(`${base}/en/${route}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (adminTotp) {
    await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 30000 });
    await page.locator('input[autocomplete="one-time-code"]').first().click();
    await page.keyboard.type((await api(`/v1/dev/totp?email=${email}`)).code, { delay: 25 });
  }
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

// ============================================================ merchant: plan and usage
const m = await newPage();
watch(m, 'merchant');
await signIn(m, MERCHANT, 'owner@harbourgrill.test', 'plan');
await step('merchant: plan, status, price, usage, entitlements', async () => {
  await m.getByTestId('sb-plan-name').waitFor({ timeout: 30000 });
  const plan = await m.getByTestId('sb-plan-name').innerText();
  const status = await m.getByTestId('sb-status').innerText();
  const price = await m.getByTestId('sb-price').innerText();
  check('merchant: current plan and lifecycle shown', /Business/.test(plan) && /Active/.test(status), `${plan} / ${status}`);
  // dev merchants run on unpriced development fixtures (never billed); real Pakistan prices are checked in the admin catalog below
  check('merchant: an unpriced development fixture says "No charge" and is marked as a fixture', /No charge/.test(price) && /Test fixture/.test(price), price);
  check('merchant: branch usage meter against the plan limit', await m.getByTestId('sb-meter-branches.max').isVisible());
  const included = await m.getByTestId('sb-included').innerText();
  check('merchant: products and features included', /Live Deals/.test(included) && /API access/.test(included), included.slice(0, 120));
  check('merchant: invoices are pointed to Finance, not shown here', await m.getByText('Invoices, payments and statements are in Finance.').isVisible());
  await shot(m, 'merchant-plan');
});
await step('merchant: downgrade preview shows the impact before anything changes', async () => {
  await m.getByTestId('sb-plan-GROWTH').getByRole('button', { name: 'See the difference' }).click();
  const impact = m.getByTestId('sb-impact');
  await impact.waitFor({ timeout: 20000 });
  const text = await impact.innerText();
  check('merchant: impact lists the new price, the date and the limit changes', /New price:/.test(text) && /When:/.test(text) && /Branches: 25 → 5/.test(text) && /You lose/.test(text), text.replace(/\n/g, ' ').slice(0, 200));
  await m.getByLabel('When').selectOption('NEXT_BILLING_CYCLE');
  await m.waitForTimeout(800);
  await shot(m, 'merchant-impact');
  await m.getByRole('button', { name: 'Request this change' }).click();
  await m.getByText('Requested. Accept it below to apply it.').waitFor({ timeout: 20000 });
  const waiting = m.getByTestId('sb-waiting');
  await waiting.waitFor({ timeout: 15000 });
  check('merchant: requested change waits for acceptance (nothing applied yet)', /Waiting for acceptance/.test(await waiting.innerText()) && /Business/.test(await m.getByTestId('sb-plan-name').innerText()));
  await waiting.getByRole('button', { name: 'Cancel' }).first().click();
  await m.getByText('Change cancelled.').waitFor({ timeout: 15000 });
  check('merchant: a change can be cancelled before it applies; the plan is unchanged', /Business/.test(await m.getByTestId('sb-plan-name').innerText()));
});
await step('merchant: why is something unavailable', async () => {
  const panel = m.getByTestId('sb-explain');
  await panel.getByRole('button', { name: 'Check' }).click();
  await panel.getByTestId('sb-explain-checks').waitFor({ timeout: 15000 });
  const text = await panel.innerText();
  check('merchant: explain answers from the real agreement (allowed, with the checks)', /Allowed/.test(text) && /Agreement in force/.test(text) && /Within your limit/.test(text), text.replace(/\n/g, ' ').slice(0, 160));
});

// ============================================================ admin: subscriptions workspace
const a = await newPage();
watch(a, 'admin');
await signIn(a, ADMIN, 'super@dealdash.test', 'subscriptions', true);
await step('admin: agreements list', async () => {
  await a.getByTestId('sb-agreements').waitFor({ timeout: 30000 });
  await a.getByRole('button', { name: 'Harbour Grill' }).first().waitFor({ timeout: 20000 });
  const tabs = await a.getByRole('tab').allInnerTexts();
  check('admin: workspace tabs (agreements, catalog, price book, add-ons, changes, billing events, signals, readiness)', ['Agreements', 'Plan catalog', 'Price book', 'Add-ons', 'Changes', 'Billing events', 'Signals', 'Readiness'].every((x) => tabs.includes(x)), tabs.join(','));
  check('admin: development fixtures are marked', (await a.getByText('Test fixture').count()) > 0);
  await shot(a, 'admin-agreements');
});
await step('admin: agreement detail', async () => {
  await a.getByRole('button', { name: 'Harbour Grill' }).first().click();
  const terms = a.getByTestId('sb-terms');
  await terms.waitFor({ timeout: 20000 });
  const t = await terms.innerText();
  check('admin: terms with the pricing version retained', /PLV:/.test(t), t.replace(/\n/g, ' ').slice(0, 160));
  check('admin: effective-dated entitlements', /Branches/.test(await a.getByTestId('sb-entitlements').innerText()));
  check('admin: lifecycle actions state that suspension blocks new exposure only', await a.getByText(/Suspension stops NEW exposure only/).isVisible());
  check('admin: a lifecycle action needs a reason', await a.getByTestId('sb-life-suspend').isDisabled());
  await shot(a, 'admin-agreement');
  await a.getByRole('button', { name: 'Back to the list' }).click();
});
await step('admin: catalog, price book, add-ons', async () => {
  await a.getByRole('tab', { name: 'Plan catalog' }).click();
  const growth = a.getByTestId('sb-catalog-GROWTH');
  await growth.waitFor({ timeout: 20000 });
  check('admin: plan catalog shows the Pakistan version and price', /PK/.test(await growth.innerText()) && /PKR 4,999\.00/.test(await growth.innerText()));
  check('admin: enterprise plans are negotiated (indicative references only)', /Indicative/.test(await a.getByTestId('sb-catalog-MERCHANT_ENTERPRISE').innerText()));
  await shot(a, 'admin-catalog');
  await a.getByRole('tab', { name: 'Price book' }).click();
  await a.getByTestId('sb-item-VOUCHER_COMMISSION').waitFor({ timeout: 20000 });
  check('admin: price book shows the commission range', /8 %.*12 %|8%.*12%/.test(await a.getByTestId('sb-item-VOUCHER_COMMISSION').innerText()), await a.getByTestId('sb-item-VOUCHER_COMMISSION').innerText());
  check('admin: Play & Win is not active (Phase 2)', /Not active/.test(await a.getByTestId('sb-item-PLAY_AND_WIN').innerText()));
  await shot(a, 'admin-pricebook');
  await a.getByRole('tab', { name: 'Add-ons' }).click();
  await a.getByTestId('sb-addon-EXTRA_BRANCH').waitFor({ timeout: 20000 });
  check('admin: add-ons extend the contract (extra branch adds to the branch limit)', /Branches \+1/.test(await a.getByTestId('sb-addon-EXTRA_BRANCH').innerText()));
});
await step('admin: billing events, signals, readiness', async () => {
  await a.getByRole('tab', { name: 'Billing events' }).click();
  await a.getByTestId('sb-billing').waitFor({ timeout: 20000 });
  check('admin: billing events state that funding is never DealDash revenue', /never DealDash revenue/.test(await a.getByTestId('sb-billing').innerText()));
  await a.getByRole('tab', { name: 'Signals' }).click();
  await a.getByTestId('sb-signals').waitFor({ timeout: 20000 });
  check('admin: signals panel (Phase 4 outbox)', /alert engine \(Phase 4\)/.test(await a.getByTestId('sb-signals').innerText()));
  await a.getByRole('tab', { name: 'Readiness' }).click();
  await a.getByTestId('sb-readiness').waitFor({ timeout: 20000 });
  await a.waitForTimeout(1500);
  const r = await a.getByTestId('sb-readiness').innerText();
  // Stage 7: the dev seed now gives the sample bank and employer their own agreements (Bank Enterprise / Corporate Partner), so launch
  // readiness must NOT list them any more; businesses without an agreement of their own are still listed (or the panel says none).
  check('admin: readiness lists only businesses without an agreement of their own (the Stage 7 sample partners have one)', !/Riyad Bank/.test(r) && !/Sample Employer/.test(r), r.replace(/\n/g, ' ').slice(0, 200));
  await shot(a, 'admin-readiness');
});

// ============================================================ Arabic / RTL
for (const [page, base, label, path] of [
  [m, MERCHANT, 'merchant', 'plan'],
  [a, ADMIN, 'admin', 'subscriptions'],
]) {
  await step(`${label}: Arabic ${path}`, async () => {
    await page.goto(`${base}/ar/${path}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 });
    if (label === 'merchant') await page.getByTestId('sb-price').waitFor({ timeout: 20000 });
    else await page.getByTestId('sb-agreements').waitFor({ timeout: 20000 });
    const dir = await page.evaluate(() => document.documentElement.dir);
    const h1 = await page.getByRole('heading', { level: 1 }).first().innerText();
    check(`${label}: /ar/${path} is right-to-left with an Arabic heading`, dir === 'rtl' && /[؀-ۿ]/.test(h1), `${dir} ${h1}`);
    check(`${label}: /ar/${path} has no horizontal overflow`, await noOverflow(page));
    if (label === 'merchant') {
      const price = await page.getByTestId('sb-price').innerText();
      check('merchant: Arabic price label', /بدون رسوم/.test(price), price);
      const meter = await page.getByTestId('sb-meter-branches.max').innerText();
      check('merchant: Arabic usage keeps Western digits', /\d+ من \d+/.test(meter), meter.replace(/\n/g, ' '));
    }
    await shot(page, `${label}-ar-${path}`);
  });
}

// ============================================================ phone width
const phone = await newPage({ width: 390, height: 844 });
watch(phone, 'phone');
await signIn(phone, MERCHANT, 'owner@harbourgrill.test', 'plan');
await step('phone: plan and usage', async () => {
  await phone.getByTestId('sb-plan-name').waitFor({ timeout: 30000 });
  check('phone width: plan and usage has no horizontal page overflow', await noOverflow(phone));
  await shot(phone, 'phone-plan');
});

check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
