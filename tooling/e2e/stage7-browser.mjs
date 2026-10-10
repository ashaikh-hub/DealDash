/**
 * Stage 7 — Partner Portal browser check (real Edge through playwright-core), on a freshly seeded database.
 *
 *   Partner admin (bank): home, organization / readiness, merchant network (referenced vs registered, provenance, manual add),
 *   eligibility (rule test by the shared engine, card programme with BIN prefix only), campaign builder -> Exclusive Deal at a
 *   registered network merchant with the shared commercial panel, Live Deal partner benefit, users and access, finance, performance,
 *   integrations (key shown once), tasks; analyst (read-only, no users page); employer (modules hidden by type / contract);
 *   merchant decides the partner benefit; DealDash approves it (second person) and reviews partners; the customer sees the extra on
 *   the public Live Deal. English and Arabic (RTL), phone width, console errors.
 *
 * Requires API 4000, customer 3001, merchant 3002, partner 3004, admin 3005 and SEED_USER_PASSWORD (the password given to the seed).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const PARTNER = process.env.PARTNER_URL ?? 'http://localhost:3004';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:3002';
const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'stage7');
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password given to the seed) before running.');
mkdirSync(OUT, { recursive: true });
const TAG = randomBytes(2).toString('hex').toUpperCase();
const results = [];
const consoleErrors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};
for (let ok = 0, tries = 0; ok < 5 && tries < 150; tries++) {
  ok = (await fetch(`${API}/v1/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 2000));
}
// warm the routes (first compile of a Next.js dev route is slow)
for (const p of ['/en', '/ar', '/en/network', '/en/campaigns', '/en/campaigns/new', '/en/organization', '/en/eligibility', '/en/users', '/en/finance', '/en/performance', '/en/integrations', '/en/tasks'])
  await fetch(`${PARTNER}${p}`).catch(() => undefined);
for (const u of [`${ADMIN}/en/partners`, `${MERCHANT}/en/partner-benefits`, `${CUSTOMER}/en`]) await fetch(u).catch(() => undefined);

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
const newPage = async (viewport = { width: 1280, height: 900 }) => (await browser.newContext({ viewport })).newPage();
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
async function signIn(page, base, email, path = '/en', mfa = false) {
  lastPage = page;
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (mfa) {
    await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 30000 });
    await page.locator('input[autocomplete="one-time-code"]').first().click();
    await page.keyboard.type((await api(`/v1/dev/totp?email=${email}`)).code, { delay: 25 });
  }
  // signed in = the sign-out button is shown (the sign-in panel has its own heading, so a heading proves nothing)
  await page.getByRole('button', { name: 'Sign out' }).first().waitFor({ timeout: 60000 });
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 60000 });
}
const go = async (page, path, testId) => {
  lastPage = page;
  await page.goto(`${PARTNER}${path}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId(testId).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
};

// ================================================================ partner administrator (bank)
const pa = await newPage();
watch(pa, 'partner-admin');
await signIn(pa, PARTNER, 'admin@bank.test');
await step('partner home', async () => {
  await pa.getByTestId('pt-home-lifecycle').waitFor({ timeout: 60000 });
  check('home: the bank is an Active partner', /Active/.test(await pa.getByTestId('pt-home-lifecycle').innerText()));
  check('home: network and markets are shown', Number((await pa.getByTestId('pt-kpi-network').innerText()).replace(/\D/g, '')) >= 2 && /SA/.test(await pa.getByTestId('pt-kpi-markets').innerText()));
  check('home: ROI is not invented', /does not hold your revenue data/.test(await pa.locator('main').innerText()));
  const nav = await pa.locator('.dd-sidebar').innerText();
  check('navigation: the Stage 7 portal sections are present', ['Merchant network', 'Campaigns', 'Eligibility', 'Finance', 'Integrations', 'Tasks and approvals', 'AI copilot', 'Users and access', 'Settings'].every((x) => nav.includes(x)));
  await shot(pa, 'partner-home');
});
await step('organization and readiness', async () => {
  await go(pa, '/en/organization', 'pt-readiness');
  const r = await pa.getByTestId('pt-readiness').innerText();
  check('organization: the live onboarding checklist lists agreement, billing, funding and local validations', /Agreement \/ licence/.test(r) && /Billing account/.test(r) && /Local validations/.test(r));
  check('organization: the markets table lists Saudi Arabia', /SA/.test(await pa.getByTestId('pt-markets').innerText()));
  await shot(pa, 'partner-organization');
});
await step('merchant network', async () => {
  await go(pa, '/en/network', 'pt-network-table');
  const tbl = await pa.getByTestId('pt-network-table').innerText();
  check('network: a referenced merchant and a registered merchant are told apart', /Referenced \(network\)/.test(tbl) && /Registered and active/.test(tbl));
  await shot(pa, 'partner-network');
  await pa.getByTestId('pt-network-table').locator('tr', { hasText: 'Corner Bakery' }).getByRole('button', { name: 'Open' }).click();
  await pa.getByTestId('pt-net-detail').waitFor({ timeout: 20000 });
  check('network: a referenced merchant has no controlled product (Exclusive, vouchers, staff redemption, settlement)', /Exclusive Deals ✕/.test(await pa.getByTestId('pt-net-caps').innerText()) && /Staff redemption ✕/.test(await pa.getByTestId('pt-net-caps').innerText()));
  check('network: provenance shows the source record id', /SB-NET-001/.test(await pa.getByTestId('pt-net-provenance').innerText()));
  await shot(pa, 'partner-network-detail');
  await go(pa, '/en/network', 'pt-network-table');
  await pa.getByRole('tab', { name: 'Add a merchant' }).click();
  await pa.getByLabel('Name (English)').fill(`QA Juice Bar ${TAG}`);
  await pa.getByLabel('First outlet name').fill(`QA Juice Bar Olaya ${TAG}`);
  await pa.getByTestId('pt-net-add-submit').click();
  await pa.getByText('Merchant added to your network.').waitFor({ timeout: 20000 });
  check('network: a merchant is added by hand through the shared pipeline', true);
  await shot(pa, 'partner-network-add');
  await pa.getByRole('tab', { name: 'Bulk file' }).click();
  await pa.getByTestId('pt-bulk-form').waitFor({ timeout: 20000 });
  await shot(pa, 'partner-network-bulk');
});
await step('FD-S7-4: partner Live Deal for a network merchant (awaits DealDash confirmation)', async () => {
  await go(pa, '/en/offers', 'pt-offer-create');
  await pa.waitForFunction(() => document.querySelector('#of-m')?.querySelectorAll('option').length > 0, null, { timeout: 30000 });
  await pa.getByLabel('Publication authority (agreement reference)').fill(`SB-DINING-${TAG}`);
  await pa.getByLabel('Your offer ID').fill(`QA-OFFER-${TAG}`);
  await pa.getByTestId('pt-offer-create').getByLabel('Title (English)').fill(`Sample Bank dining ${TAG}`);
  await pa.getByTestId('pt-offer-create').getByLabel('Title (Arabic)').fill('عرض مطاعم البنك');
  await pa.getByLabel('Benefit (English)').fill('15% off the bill');
  await pa.getByTestId('pt-offer-submit').click();
  await pa.getByText('Live Deal added. DealDash will confirm the publication right.').waitFor({ timeout: 20000 });
  await pa.getByTestId(`pt-offer-pub-QA-OFFER-${TAG}`).waitFor({ timeout: 20000 });
  check('offers: the partner Live Deal waits for DealDash to confirm the publication right', /Awaiting DealDash confirmation/.test(await pa.getByTestId(`pt-offer-pub-QA-OFFER-${TAG}`).innerText()));
  check('offers: it is not shown to customers yet', !(await fetch(`${API}/v1/app/network-offers?q=${encodeURIComponent(TAG)}`).then((r) => r.json())).data.length);
  await shot(pa, 'partner-offers');
});
await step('FD-S7-1: Watch & Earn budgets the partner owns', async () => {
  await go(pa, '/en/watch', 'pt-watch');
  await pa.getByRole('heading', { name: 'Budgets you own' }).waitFor({ timeout: 30000 });
  check('watch: the partner sees the budgets it owns and can create one at a registered network merchant', (await pa.getByTestId('pt-watch-own-form').count()) === 1);
  await shot(pa, 'partner-watch-owned');
});
await step('eligibility and card privacy', async () => {
  await go(pa, '/en/eligibility', 'pt-rule-builder');
  await pa.getByTestId('pt-rule-test').click();
  await pa.getByTestId('pt-rule-result').waitFor({ timeout: 20000 });
  check('eligibility: a rule is tested by the shared engine', /Qualifies|Could qualify|Does not qualify/.test(await pa.getByTestId('pt-rule-result').innerText()));
  await shot(pa, 'partner-eligibility');
  await pa.getByRole('tab', { name: 'Card programmes' }).click();
  await pa.getByTestId('pt-card-table').waitFor({ timeout: 20000 });
  const cards = await pa.getByTestId('pt-card-table').innerText();
  check('card programmes keep a BIN prefix only (no card number anywhere on the page)', /412345/.test(cards) && !/\d{12,}/.test(await pa.locator('main').innerText()));
  await shot(pa, 'partner-card-programmes');
});
let campaignUrl = '';
await step('campaign builder (Exclusive Deal at a registered network merchant)', async () => {
  await go(pa, '/en/campaigns/new', 'pt-cb-merchant');
  const merchants = pa.getByTestId('pt-cb-merchant');
  const value = await merchants.locator('option').nth(1).getAttribute('value');
  await merchants.selectOption(value);
  await pa.locator('[data-testid^="pt-cb-branch-"]').first().waitFor({ timeout: 20000 });
  await pa.locator('[data-testid^="pt-cb-branch-"]').first().check();
  await pa.getByLabel('Title (English)').fill(`Bank card night ${TAG}`);
  await pa.getByLabel('Title (Arabic)').fill('ليلة بطاقات البنك');
  await pa.getByLabel('Offer label (English)').fill('SAR 20 off dinner');
  await pa.getByLabel('Offer label (Arabic)').fill('خصم 20 ريال على العشاء');
  await pa.getByLabel('Description (English)').fill('An evening for card holders at this restaurant.');
  await pa.getByLabel('Description (Arabic)').fill('أمسية لحاملي البطاقات في هذا المطعم.');
  await pa.getByLabel('Normal price (SAR)').fill('100');
  await pa.getByLabel('Deal price (SAR)').fill('80');
  await pa.getByLabel('Units per outlet').fill('5');
  await pa.getByLabel('You fund per redemption (SAR)').fill('5');
  await shot(pa, 'partner-campaign-builder');
  await pa.getByTestId('pt-cb-create').click();
  await pa.getByTestId('pt-camp-title').waitFor({ timeout: 60000 });
  campaignUrl = pa.url();
  await pa.getByTestId('cm-panel').waitFor({ timeout: 30000 });
  const panel = await pa.getByTestId('cm-panel').innerText();
  check('campaign: created on the shared engine; the commercial panel shows the partner as owner and the merchant as fulfilment', /Fulfilment merchant|fulfilment/i.test(panel) && /Owner|owner/.test(panel));
  check('campaign: the sponsor funding is its own line', /Sponsor/i.test(panel));
  await shot(pa, 'partner-campaign-detail');
});
await step('Live Deal partner benefit proposed', async () => {
  await go(pa, '/en/campaigns', 'pt-camp-table');
  await shot(pa, 'partner-campaigns');
  await pa.getByRole('tab', { name: 'Live Deal benefits' }).click();
  await pa.getByTestId('pt-ben-form').waitFor({ timeout: 30000 });
  await pa.getByLabel('Value').fill('10');
  await pa.getByLabel('Label (English)').fill(`Extra 10 with Sample Bank cards ${TAG}`);
  await pa.getByLabel('Label (Arabic)').fill('خصم إضافي مع بطاقات البنك التجريبي');
  await pa.getByTestId('pt-ben-propose').click();
  await pa.getByText('Sent. The merchant decides first, then DealDash.').waitFor({ timeout: 20000 });
  check('benefit: proposed to the merchant', /Waiting for the merchant/.test(await pa.getByTestId('pt-ben-table').innerText()));
  await shot(pa, 'partner-benefits');
});
await step('users, finance, performance, integrations, tasks', async () => {
  await go(pa, '/en/users', 'pt-user-table');
  check('users: partner roles only are offered', !(await pa.getByTestId('pt-invite-form').innerText()).includes('DealDash'));
  await shot(pa, 'partner-users');
  await go(pa, '/en/finance', 'pt-finance');
  await pa.waitForTimeout(1500);
  await shot(pa, 'partner-finance');
  await go(pa, '/en/performance', 'pt-perf-by');
  await pa.waitForTimeout(1500);
  check('performance: forecast and expected-to-date are labelled as estimates', /Estimate/.test(await pa.locator('main').innerText()) || (await pa.getByTestId('pt-performance').innerText()).includes('Nothing here yet'));
  await shot(pa, 'partner-performance');
  await go(pa, '/en/integrations', 'pt-integrations');
  await pa.getByLabel('Connection name').fill(`QA feed ${TAG}`);
  await pa.getByLabel('Source system').fill(`qa-feed-${TAG.toLowerCase()}`);
  await pa.getByTestId('pt-int-create').click();
  await pa.getByTestId('pt-int-key').waitFor({ timeout: 20000 });
  check('integrations: the API key is shown once, at creation', /not be shown again/.test(await pa.getByTestId('pt-int-key').innerText()));
  await shot(pa, 'partner-integrations');
  await pa.reload({ waitUntil: 'domcontentloaded' });
  await pa.getByTestId('pt-int-table').waitFor({ timeout: 30000 });
  check('integrations: after reload the key is gone', (await pa.getByTestId('pt-int-key').count()) === 0);
  await go(pa, '/en/tasks', 'op-inbox');
  await shot(pa, 'partner-tasks');
  check('tasks: the shared inbox lists the commercial acceptance for the new campaign', /Commercial terms waiting for your acceptance/.test(await pa.getByTestId('op-inbox').innerText()));
});
await step('Arabic (RTL) and phone width', async () => {
  await pa.goto(`${PARTNER}/ar`, { waitUntil: 'domcontentloaded' });
  await pa.getByTestId('pt-home-lifecycle').waitFor({ timeout: 60000 });
  const dir = await pa.evaluate(() => document.documentElement.dir);
  check('arabic: the partner home is right-to-left with an Arabic heading', dir === 'rtl' && /[؀-ۿ]/.test(await pa.getByRole('heading', { level: 1 }).first().innerText()));
  check('arabic: Western digits only', !/[٠-٩]/.test(await pa.locator('main').innerText()));
  check('arabic: no horizontal overflow', await noOverflow(pa));
  await shot(pa, 'partner-ar-home');
  await pa.goto(`${PARTNER}/ar/network`, { waitUntil: 'domcontentloaded' });
  await pa.getByTestId('pt-network-table').waitFor({ timeout: 60000 });
  check('arabic: the network page has no horizontal overflow', await noOverflow(pa));
  await shot(pa, 'partner-ar-network');
});
const phone = await newPage({ width: 390, height: 844 });
watch(phone, 'phone');
await signIn(phone, PARTNER, 'admin@bank.test');
await step('phone width', async () => {
  await phone.getByTestId('pt-home-lifecycle').waitFor({ timeout: 60000 });
  check('phone: home has no horizontal page overflow', await noOverflow(phone));
  await shot(phone, 'partner-phone-home');
  await phone.goto(`${PARTNER}/en/campaigns`, { waitUntil: 'domcontentloaded' });
  await phone.getByTestId('pt-camp-table').waitFor({ timeout: 60000 });
  check('phone: campaigns have no horizontal page overflow', await noOverflow(phone));
  await shot(phone, 'partner-phone-campaigns');
});

// ================================================================ analyst (read-only) and employer (type / contract)
const an = await newPage();
watch(an, 'analyst');
await signIn(an, PARTNER, 'analyst@bank.test');
await step('analyst: read-only', async () => {
  const nav = await an.locator('.dd-sidebar').innerText();
  check('analyst: no users / integrations in the navigation', !nav.includes('Users and access') && !nav.includes('Integrations'));
  await an.goto(`${PARTNER}/en/users`, { waitUntil: 'domcontentloaded' });
  await an.getByText('You do not have access to this page.').waitFor({ timeout: 60000 });
  check('analyst: the users page is permission-denied', true);
  await shot(an, 'partner-permission-denied');
});
const emp = await newPage();
watch(emp, 'employer');
await signIn(emp, PARTNER, 'admin@employer.test');
await step('employer: modules follow the partner type and contract', async () => {
  await emp.waitForTimeout(2500);
  const nav = await emp.locator('.dd-sidebar').innerText();
  check('employer: no Offers / Integrations in the navigation (not offered to the type or not in the contract)', !nav.includes('Offers') && !nav.includes('Integrations'));
  await emp.goto(`${PARTNER}/en/watch`, { waitUntil: 'domcontentloaded' });
  await emp.locator('[data-testid="pt-not-offered"],[data-testid="pt-not-entitled"]').first().waitFor({ timeout: 60000 });
  check('employer: Watch & Earn sponsorship shows the not-offered / not-entitled state', true);
  await shot(emp, 'partner-not-entitled');
});

// ================================================================ merchant decides; DealDash approves; customer sees it
const mo = await newPage();
watch(mo, 'merchant');
await signIn(mo, MERCHANT, 'owner@harbourgrill.test', '/en/partner-benefits');
let benefitId = '';
await step('merchant decides the partner benefit', async () => {
  await mo.goto(`${MERCHANT}/en/partner-benefits`, { waitUntil: 'domcontentloaded' });
  const row = mo.locator('[data-testid^="mp-benefit-"]', { hasText: TAG }).first();
  await row.waitFor({ timeout: 60000 });
  benefitId = (await row.getAttribute('data-testid')).replace('mp-benefit-', '');
  await shot(mo, 'merchant-partner-benefits');
  await mo.getByTestId(`mp-approve-${benefitId}`).click();
  await mo.locator(`[data-testid="mp-benefit-${benefitId}"]`, { hasText: 'Waiting for DealDash' }).waitFor({ timeout: 20000 });
  check('merchant: the merchant approved its own Live Deal benefit first', true);
});
const dd = await newPage();
watch(dd, 'dealdash');
await signIn(dd, ADMIN, 'partner-management@dealdash.test', '/en/partners', true);
await step('DealDash partners workspace and benefit approval', async () => {
  await dd.goto(`${ADMIN}/en/partners`, { waitUntil: 'domcontentloaded' });
  await dd.getByTestId('ap-list').waitFor({ timeout: 60000 });
  check('admin: partners are listed with type, lifecycle and readiness', /Bank/.test(await dd.getByTestId('ap-list').innerText()) && /Active/.test(await dd.getByTestId('ap-list').innerText()));
  await shot(dd, 'admin-partners');
  await dd.getByTestId('ap-list').locator('tr', { hasText: 'Riyad Bank' }).getByRole('button', { name: 'Open' }).click();
  await dd.getByTestId('ap-readiness').waitFor({ timeout: 30000 });
  await shot(dd, 'admin-partner-detail');
  await dd.getByRole('button', { name: 'Back' }).click();
  await dd.getByRole('tab', { name: 'Partner benefits waiting for DealDash' }).click();
  await dd.getByTestId(`ap-ben-approve-${benefitId}`).click();
  await dd.getByTestId('ap-benefits').locator('tr', { hasText: TAG }).getByText('Active').waitFor({ timeout: 20000 });
  check('admin: a second person (DealDash) activated the benefit after the merchant', true);
  await shot(dd, 'admin-partner-benefits');
});
await step('FD-S7-4: DealDash confirms the partner publication right; the Live Deal becomes public', async () => {
  await dd.getByRole('tab', { name: 'Partner Live Deals to confirm' }).click();
  const row = dd.getByTestId('ap-offers').locator('tr', { hasText: `Sample Bank dining ${TAG}` });
  await row.waitFor({ timeout: 30000 });
  check('admin: the publication authority reference is shown for the decision', /SB-DINING-/.test(await row.innerText()));
  await shot(dd, 'admin-partner-offers');
  await row.getByRole('button', { name: 'Confirm publication right' }).click();
  await dd.getByTestId('ap-banner').waitFor({ timeout: 20000 });
  await row.waitFor({ state: 'detached', timeout: 20000 });
  const shown = (await fetch(`${API}/v1/app/network-offers?q=${encodeURIComponent(TAG)}`).then((r) => r.json())).data;
  check('customer discovery: the confirmed partner Live Deal is public (frictionless, no redemption)', shown.some((o) => o.titleEn.includes(TAG)));
});
const cu = await newPage({ width: 390, height: 844 });
watch(cu, 'customer');
await step('customer sees the partner extra on the public Live Deal', async () => {
  const rows = await api('/v1/admin/partners/benefits').catch(() => null);
  void rows;
  const dealId = await fetch(`${API}/v1/app/deals?city=Riyadh&limit=50`).then((r) => r.json()).then((j) => j.data?.items ?? j.data ?? []).then((items) => items.map((i) => i.id));
  let found = false;
  for (const id of dealId) {
    const b = await fetch(`${API}/v1/app/live-deals/${id}/partner-benefits`).then((r) => r.json()).then((j) => j.data ?? []);
    if (b.some((x) => x.labelEn.includes(TAG))) {
      await cu.goto(`${CUSTOMER}/en/deals/${id}`, { waitUntil: 'domcontentloaded' });
      await cu.getByTestId('deal-partner-benefits').waitFor({ timeout: 60000 });
      found = /Add your card or membership to unlock|You qualify/.test(await cu.getByTestId('deal-partner-benefits').innerText());
      await shot(cu, 'customer-live-deal-partner-benefit');
      break;
    }
  }
  check('customer: the public Live Deal shows the partner extra (eligibility-controlled, not a redemption)', found);
});

check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (campaignUrl) console.log(`campaign: ${campaignUrl}`);
process.exit(failed.length ? 1 : 0);
