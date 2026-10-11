/**
 * Phases 4 and 5 browser check (real Edge through playwright-core; no browser download needed).
 *
 *   Merchant owner:   performance overview, drill-down report, targets (adds one: forecast labelled as an estimate), alerts,
 *                     alert rules (adds one), notification preferences, billing workspace, Growth assistant (answer + draft)
 *   Campaign manager: sees Performance and the assistant but not Billing (role-aware navigation)
 *   DealDash ops:     Operations Command Centre (campaign / transaction / financial / integration / risk / platform health),
 *                     integrations, alerts, customer support timeline
 *   DealDash finance: billing and receivables (documents, billing run, exchange rates), analytics with business drill-down
 *   DealDash admin:   AI governance: evaluation pack, usage (not priced), audit
 *   Customer:         Best-deal assistant (never reserves or buys by itself)
 * plus Arabic / right-to-left for every new screen, phone-width layouts and console errors. Test records it creates are archived
 * or switched off at the end (audited, nothing deleted).
 *
 * Requires the API (4000), customer (3001), merchant (3002) and admin (3005) apps running and the dev seed applied.
 * The seed password comes from the environment (never stored in this file):
 *   SEED_USER_PASSWORD
 *
 *   node tooling/e2e/phase45-browser.mjs
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:3002';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'phase45');
const PASSWORD = process.env.SEED_USER_PASSWORD;
const CUSTOMER_MOBILE = process.env.QA_CUSTOMER_MOBILE ?? '+966500000002';
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password you gave to the seed) before running.');
mkdirSync(OUT, { recursive: true });

const TAG = randomBytes(3).toString('hex');
// the development API runs under `node --watch` and can restart a few times right after start: wait until it answers steadily
for (let ok = 0, tries = 0; ok < 5 && tries < 120; tries++) {
  ok = (await fetch(`${API}/v1/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 2000));
}
// development servers compile a route on first request; warm every route first so a compile never reloads a page mid-check
for (const [base, paths] of [
  [MERCHANT, ['performance', 'billing', 'assistant']],
  [ADMIN, ['command-centre', 'analytics', 'billing', 'ai']],
  [CUSTOMER, ['profile', 'assistant']],
])
  for (const path of paths) for (const l of ['en', 'ar']) await fetch(`${base}/${l}/${path}`).catch(() => undefined);
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
    if (/401|403|404 \(Not Found\)|409|422|429|favicon|manifest|Download the React DevTools|aborted|net::ERR_FAILED|Failed to fetch/i.test(t)) return;
    consoleErrors.push(`[${label}] ${t}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror ${e.message}`));
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
/** A call from inside the signed-in page (session cookie + CSRF). */
const pageApi = (page, method, path, body) =>
  page.evaluate(
    async ({ API, method, path, body }) => {
      const me = (await (await fetch(`${API}/v1/auth/me`, { credentials: 'include' })).json()).data;
      const r = await fetch(`${API}${path}`, { method, credentials: 'include', headers: { 'content-type': 'application/json', 'X-CSRF-Token': me.csrfToken, 'Idempotency-Key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null), orgId: me.activeMembership?.organizationId ?? null };
    },
    { API, method, path, body },
  );
const arabicPage = async (page, base, path, label) => {
  await page.goto(`${base}/ar/${path}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 45000 });
  await page.waitForTimeout(800);
  const dir = await page.evaluate(() => document.documentElement.dir);
  const h1 = await page.getByRole('heading', { level: 1 }).first().innerText();
  check(`${label}: /ar/${path} is right-to-left with an Arabic heading`, dir === 'rtl' && /[؀-ۿ]/.test(h1), `${dir} ${h1}`);
  check(`${label}: /ar/${path} has no horizontal overflow`, await noOverflow(page));
  check(`${label}: /ar/${path} uses Western digits only`, !/[٠-٩]/.test(await page.locator('main').innerText()));
  await shot(page, `${label}-ar-${path.replace(/\//g, '-')}`);
};

let targetId = null;
let ruleId = null;
let orgId = null;

// ============================================================ merchant owner
const m = await newPage();
watch(m, 'merchant');
await signIn(m, MERCHANT, 'owner@harbourgrill.test', 'performance');
await step('merchant: performance overview', async () => {
  await m.getByTestId('vis-overview').waitFor({ timeout: 30000 });
  await m.locator('[data-testid^="vis-product-"]').first().waitFor({ timeout: 30000 });
  const text = await m.getByTestId('vis-overview').innerText();
  check('merchant: performance overview shows products, data freshness and the honesty note', /Exclusive Deals|Live Deals|Vouchers/.test(text) && /Data as of/.test(text) && /not a sale/.test(text));
  const nav = await m.locator('.dd-sidebar').innerText();
  check('merchant: navigation shows Performance, Billing and Assistant for the owner', ['Performance', 'Billing', 'Assistant'].every((x) => nav.includes(x)));
  await shot(m, 'merchant-performance-overview');
});
await step('merchant: drill-down report', async () => {
  await m.getByRole('tab', { name: 'Drill-down report' }).click();
  await m.getByTestId('vis-report').waitFor({ timeout: 20000 });
  await m.waitForTimeout(1500);
  await m.getByTestId('vis-groupby').selectOption('BRANCH');
  await m.waitForTimeout(1500);
  const text = await m.getByTestId('vis-report').innerText();
  check('merchant: drill-down report groups by branch', /Branch/.test(text));
  await m.getByTestId('vis-groupby').selectOption('LEGAL_ENTITY');
  await m.waitForTimeout(1500);
  const after = await m.getByTestId('vis-report').innerText();
  check('merchant: grouping by legal entity is decided by the entitlement (table or a clear message)', /Legal entity|Not available to you/.test(after));
  await shot(m, 'merchant-performance-report');
});
await step('merchant: adds a target (target vs actual, expected-to-date, forecast labelled)', async () => {
  await m.getByRole('tab', { name: 'Targets' }).click();
  await m.getByTestId('vis-target-form').waitFor({ timeout: 20000 });
  await m.getByLabel('Target name').fill(`QA target ${TAG}`);
  await m.getByLabel('Target', { exact: true }).fill('25');
  await m.getByTestId('vis-target-create').click();
  await m.getByText('Target added.').waitFor({ timeout: 20000 });
  const card = m.locator('[data-testid^="vis-target-"]', { hasText: `QA target ${TAG}` }).first();
  await card.waitFor({ timeout: 20000 });
  targetId = (await card.getAttribute('data-testid')).replace('vis-target-', '');
  const text = await card.innerText();
  check('merchant: target shows actual, expected to date and a forecast labelled as an estimate', /Actual/.test(text) && /Expected to date/.test(text) && /Forecast · estimate/.test(text));
  await shot(m, 'merchant-targets');
});
await step('merchant: alerts list', async () => {
  await m.getByRole('tab', { name: 'Alerts' }).click();
  await m.getByTestId('vis-alerts').waitFor({ timeout: 20000 });
  await m.waitForTimeout(1500);
  check('merchant: alerts tab loads (alerts or an empty state)', /Alerts are grouped/.test(await m.getByTestId('vis-alerts').innerText()));
  await shot(m, 'merchant-alerts');
});
await step('merchant: adds an alert rule with escalation', async () => {
  await m.getByRole('tab', { name: 'Alert rules' }).click();
  await m.getByTestId('vis-rule-form').waitFor({ timeout: 20000 });
  await m.getByLabel('Rule name').fill(`QA budget rule ${TAG}`);
  await m.getByLabel('Escalate after (minutes)').fill('60');
  await m.getByTestId('vis-rule-create').click();
  await m.getByText('Alert rule added.').waitFor({ timeout: 20000 });
  const row = m.locator('[data-testid^="vis-rule-"]', { hasText: `QA budget rule ${TAG}` }).first();
  await row.waitFor({ timeout: 20000 });
  ruleId = (await row.getAttribute('data-testid')).replace('vis-rule-', '');
  check('merchant: the rule shows its type, frequency, channels and escalation', /Budget expected to run out/.test(await row.innerText()) && /escalates after 60 min/.test(await row.innerText()));
  await shot(m, 'merchant-alert-rules');
});
await step('merchant: notification preferences', async () => {
  await m.getByRole('tab', { name: 'Notification preferences' }).click();
  const perf = m.getByTestId('vis-pref-PERFORMANCE');
  await perf.waitFor({ timeout: 20000 });
  await perf.getByRole('combobox').selectOption('DIGEST');
  await m.getByText('Saved', { exact: false }).first().waitFor({ timeout: 20000 });
  check('merchant: a preference is saved (performance alerts as a daily digest)', (await perf.getByRole('combobox').inputValue()) === 'DIGEST');
  await perf.getByRole('combobox').selectOption('IMMEDIATE');
  await shot(m, 'merchant-preferences');
});
await step('merchant: billing workspace', async () => {
  await m.goto(`${MERCHANT}/en/billing`, { waitUntil: 'domcontentloaded' });
  await m.getByTestId('billing-workspace').waitFor({ timeout: 30000 });
  await m.waitForTimeout(1500);
  const tabs = await m.getByRole('tab').allInnerTexts();
  check('merchant: billing has invoices, accounts, receivables, purchase orders, statement and reconciliation', ['Invoices and notes', 'Billing accounts', 'Receivables', 'Purchase orders', 'Statement', 'Reconciliation'].every((x) => tabs.includes(x)), tabs.join(','));
  await shot(m, 'merchant-billing-documents');
  await m.getByRole('tab', { name: 'Billing accounts' }).click();
  await m.getByTestId('bill-accounts').waitFor({ timeout: 20000 });
  await m.waitForTimeout(1000);
  check('merchant: billing accounts show the legal entity and payment terms', /Legal entity/.test(await m.getByTestId('bill-accounts').innerText()) && /Payment terms/.test(await m.getByTestId('bill-accounts').innerText()));
  await shot(m, 'merchant-billing-accounts');
  await m.getByRole('tab', { name: 'Reconciliation' }).click();
  await m.getByTestId('bill-recon').waitFor({ timeout: 20000 });
  await m.waitForTimeout(1500);
  await shot(m, 'merchant-billing-reconciliation');
  check('merchant: reconciliation explains each billing event is settled exactly once', /settled exactly once/.test(await m.getByTestId('bill-recon').innerText()));
});
await step('merchant: Growth assistant answers with labelled statements and drafts for approval', async () => {
  await m.goto(`${MERCHANT}/en/assistant`, { waitUntil: 'domcontentloaded' });
  await m.getByTestId('ai-panel').waitFor({ timeout: 30000 });
  await m.getByRole('button', { name: 'How are we doing this month?' }).click();
  await m.getByTestId('ai-answer').waitFor({ timeout: 30000 });
  check('merchant: assistant answer is labelled AI suggested with fact statements', /AI suggested/.test(await m.getByTestId('ai-answer').innerText()) && (await m.locator('[data-testid^="ai-statement-"]').count()) > 0);
  await m.getByLabel('Let it prepare drafts for my approval').check();
  await m.getByLabel('Ask a question').fill('I want a plan to grow redemptions');
  await m.getByTestId('ai-send').click();
  await m.getByTestId('ai-draft-CAMPAIGN_PLAN').waitFor({ timeout: 30000 });
  check('merchant: a campaign plan arrives as an AI draft waiting for approval', /AI drafted/.test(await m.getByTestId('ai-draft-CAMPAIGN_PLAN').innerText()));
  await shot(m, 'merchant-assistant');
});
orgId = (await pageApi(m, 'GET', '/v1/auth/me')).orgId;

// ============================================================ campaign manager: role-aware navigation
const cm = await newPage();
watch(cm, 'campaigns');
await signIn(cm, MERCHANT, 'campaigns@harbourgrill.test', 'performance');
await step('campaign manager: sees Performance and Assistant but not Billing', async () => {
  await cm.getByTestId('performance-workspace').waitFor({ timeout: 30000 });
  const nav = await cm.locator('.dd-sidebar').innerText();
  check('campaign manager: navigation has Performance and Assistant, no Billing', nav.includes('Performance') && nav.includes('Assistant') && !nav.includes('Billing'));
  await cm.goto(`${MERCHANT}/en/billing`, { waitUntil: 'domcontentloaded' });
  await cm.waitForTimeout(2500);
  check('campaign manager: the billing page is not shown', (await cm.getByTestId('billing-workspace').count()) === 0);
});

// ============================================================ DealDash operations
const ops = await newPage();
watch(ops, 'ops');
await signIn(ops, ADMIN, 'operations@dealdash.test', 'command-centre', true);
await step('ops: Command Centre health sections', async () => {
  await ops.getByTestId('cc-campaigns').waitFor({ timeout: 45000 });
  const ids = ['cc-campaigns', 'cc-transactions', 'cc-finance', 'cc-integrations', 'cc-risk', 'cc-platform'];
  let all = true;
  for (const id of ids) all = all && (await ops.getByTestId(id).count()) === 1;
  check('ops: Command Centre shows campaign, transaction, financial, integration, risk and platform health', all);
  const integ = await ops.getByTestId('cc-integrations').innerText();
  check('ops: integrations show states and mock adapters honestly', /Mock \(not live\)/.test(integ) && /(Healthy|Not configured|Not updated|Degraded|Failing)/.test(integ));
  await shot(ops, 'admin-command-centre');
});
await step('ops: integrations and alerts tabs', async () => {
  await ops.getByRole('tab', { name: 'Integrations' }).click();
  await ops.getByTestId('vis-integrations').waitFor({ timeout: 20000 });
  await shot(ops, 'admin-integrations');
  await ops.getByRole('tab', { name: 'Alerts' }).click();
  await ops.getByTestId('vis-alerts').waitFor({ timeout: 20000 });
  await ops.waitForTimeout(1200);
  check('ops: platform alerts list loads', true);
  await shot(ops, 'admin-alerts');
});
await step('ops: customer support timeline (masked mobile, references only)', async () => {
  await ops.getByRole('tab', { name: 'Customer timeline' }).click();
  await ops.getByLabel('Find a customer (mobile or name)').fill('500000001');
  await ops.getByRole('button', { name: 'Search' }).click();
  const pick = ops.getByTestId('support-timeline').getByRole('button').filter({ hasText: '•' }).first();
  await pick.waitFor({ timeout: 20000 });
  await pick.click();
  await ops.getByTestId('timeline-items').waitFor({ timeout: 20000 });
  const text = await ops.getByTestId('support-timeline').innerText();
  check('ops: the customer journey is listed with a masked mobile number', /•••/.test(text) && /Account created|Account/.test(text));
  await shot(ops, 'admin-support-timeline');
});
await arabicPage(ops, ADMIN, 'command-centre', 'admin').catch((e) => check('admin: Arabic command centre', false, String(e.message).slice(0, 200)));

// ============================================================ DealDash finance
const fin = await newPage();
watch(fin, 'finance');
await signIn(fin, ADMIN, 'finance@dealdash.test', 'billing', true);
await step('finance: billing and receivables', async () => {
  await fin.getByTestId('admin-billing').waitFor({ timeout: 30000 });
  await fin.waitForTimeout(1500);
  const tabs = await fin.getByRole('tab').allInnerTexts();
  check('finance: billing has documents, accounts, receivables, payments, POs, exchange rates and reconciliation', ['Invoices and notes', 'Billing accounts', 'Receivables', 'Record payment', 'Purchase orders', 'Exchange rates', 'Reconciliation'].every((x) => tabs.includes(x)), tabs.join(','));
  check('finance: a billing run can be started (drafts are never issued automatically)', (await fin.getByTestId('bill-run').count()) === 1);
  await shot(fin, 'admin-billing-documents');
  await fin.getByRole('tab', { name: 'Receivables' }).click();
  await fin.getByTestId('bill-receivables').waitFor({ timeout: 20000 });
  await fin.waitForTimeout(1200);
  await shot(fin, 'admin-billing-receivables');
  await fin.getByRole('tab', { name: 'Exchange rates' }).click();
  await fin.getByTestId('bill-fx').waitFor({ timeout: 20000 });
  check('finance: exchange rates explain that nothing converts without an approved rate', /without an approved rate/.test(await fin.getByTestId('bill-fx').innerText()));
  await shot(fin, 'admin-billing-fx');
  await fin.getByRole('tab', { name: 'Reconciliation' }).click();
  await fin.getByTestId('bill-recon').waitFor({ timeout: 20000 });
  await fin.waitForTimeout(1500);
  check('finance: reconciliation shows product flow checks', (await fin.getByTestId('bill-flows').count()) === 1);
  await shot(fin, 'admin-billing-reconciliation');
});
await step('finance: analytics drill-down by business', async () => {
  await fin.goto(`${ADMIN}/en/analytics`, { waitUntil: 'domcontentloaded' });
  await fin.getByTestId('vis-overview').waitFor({ timeout: 30000 });
  await fin.getByRole('tab', { name: 'Drill-down report' }).click();
  await fin.getByTestId('vis-report').waitFor({ timeout: 20000 });
  await fin.waitForTimeout(2000);
  check('finance: analytics groups by business first', /Business/.test(await fin.getByTestId('vis-report').innerText()));
  await shot(fin, 'admin-analytics-report');
});
await arabicPage(fin, ADMIN, 'billing', 'admin').catch((e) => check('admin: Arabic billing', false, String(e.message).slice(0, 200)));

// ============================================================ DealDash super admin: AI governance
const sa = await newPage();
watch(sa, 'super');
await signIn(sa, ADMIN, 'super@dealdash.test', 'ai', true);
await step('super admin: AI evaluation pack and usage', async () => {
  await sa.getByTestId('admin-ai').waitFor({ timeout: 30000 });
  await sa.getByRole('tab', { name: 'Evaluations' }).click();
  await sa.getByTestId('ai-run-evals').click();
  await sa.getByText(/\d+ passed, 0 failed/).waitFor({ timeout: 30000 });
  check('super admin: every AI evaluation case passes', true);
  await shot(sa, 'admin-ai-evaluations');
  await sa.getByRole('tab', { name: 'Usage' }).click();
  await sa.getByTestId('ai-usage').getByText(/AI is not priced/).waitFor({ timeout: 20000 });
  check('super admin: AI usage is metered and shown as not priced', true);
  await shot(sa, 'admin-ai-usage');
  await sa.getByRole('tab', { name: 'Audit' }).click();
  await sa.getByTestId('ai-audit').locator('table').waitFor({ timeout: 20000 });
  check('super admin: AI audit lists the interactions (including the merchant’s questions above)', (await sa.getByTestId('ai-audit').locator('tbody tr').count()) > 0);
  await shot(sa, 'admin-ai-audit');
});
await arabicPage(sa, ADMIN, 'ai', 'admin').catch((e) => check('admin: Arabic AI', false, String(e.message).slice(0, 200)));
await arabicPage(sa, ADMIN, 'analytics', 'admin').catch((e) => check('admin: Arabic analytics', false, String(e.message).slice(0, 200)));

// ============================================================ customer: Best-deal assistant
const c = await newPage({ width: 390, height: 844 });
watch(c, 'customer');
await step('customer: Best-deal assistant (never reserves or buys by itself)', async () => {
  await c.goto(`${CUSTOMER}/en/profile`, { waitUntil: 'domcontentloaded' });
  await c.getByLabel('Mobile number').fill(CUSTOMER_MOBILE);
  await c.getByRole('button', { name: 'Send code' }).click();
  await c.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 20000 });
  await otp(c, (await api(`/v1/dev/last-sms?to=${encodeURIComponent(CUSTOMER_MOBILE)}`)).code);
  await c.getByTestId('assistant-link').waitFor({ timeout: 30000 });
  await c.getByTestId('assistant-link').click();
  await c.getByTestId('ai-panel').waitFor({ timeout: 30000 });
  const before = (await pageApi(c, 'GET', '/v1/app/reservations?tab=active')).body?.data?.length ?? 0;
  await c.getByRole('button', { name: 'Best deals near me' }).click();
  await c.getByTestId('ai-answer').waitFor({ timeout: 30000 });
  check('customer: the assistant answers with labelled statements and offers it can explain', /AI suggested/.test(await c.getByTestId('ai-answer').innerText()));
  check('customer: no drafting or approval controls for customers', (await c.getByLabel('Let it prepare drafts for my approval').count()) === 0);
  await c.getByLabel('Ask a question').fill('Reserve the best one for me');
  await c.getByTestId('ai-send').click();
  await c.getByText(/can’t buy, reserve, pay/).waitFor({ timeout: 30000 });
  const after = (await pageApi(c, 'GET', '/v1/app/reservations?tab=active')).body?.data?.length ?? 0;
  check('customer: asking the assistant to reserve creates no reservation', after === before, `${before} -> ${after}`);
  check('customer: assistant fits a phone screen', await noOverflow(c));
  await shot(c, 'customer-assistant');
  await c.goto(`${CUSTOMER}/ar/assistant`, { waitUntil: 'domcontentloaded' });
  await c.getByTestId('ai-panel').waitFor({ timeout: 30000 });
  check('customer: Arabic assistant is right-to-left', (await c.evaluate(() => document.documentElement.dir)) === 'rtl' && /المساعد/.test(await c.getByTestId('ai-panel').innerText()));
  check('customer: Arabic assistant has no horizontal overflow', await noOverflow(c));
  await shot(c, 'customer-ar-assistant');
});

// ============================================================ merchant Arabic and phone width
for (const p of ['performance', 'billing', 'assistant']) await arabicPage(m, MERCHANT, p, 'merchant').catch((e) => check(`merchant: Arabic ${p}`, false, String(e.message).slice(0, 200)));
const phone = await newPage({ width: 390, height: 844 });
watch(phone, 'phone');
await signIn(phone, MERCHANT, 'owner@harbourgrill.test', 'performance');
for (const p of ['performance', 'billing', 'assistant']) {
  await step(`phone: ${p}`, async () => {
    await phone.goto(`${MERCHANT}/en/${p}`, { waitUntil: 'domcontentloaded' });
    await phone.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30000 });
    await phone.waitForTimeout(1200);
    check(`phone width: ${p} has no horizontal page overflow`, await noOverflow(phone));
    await shot(phone, `phone-${p}`);
  });
}

// ============================================================ cleanup: archive the QA target, switch the QA rule off (audited)
await step('cleanup: archive the QA target and switch off the QA alert rule', async () => {
  const a = targetId && orgId ? await pageApi(m, 'POST', `/v1/orgs/${orgId}/targets/${targetId}/archive`, {}) : { status: 0 };
  const r = ruleId && orgId ? await pageApi(m, 'PUT', `/v1/orgs/${orgId}/alert-rules/${ruleId}`, { name: `QA budget rule ${TAG}`, code: 'BUDGET_PROJECTED_EXHAUST', enabled: false }) : { status: 0 };
  check('cleanup: QA target archived and QA rule switched off', [200, 201].includes(a.status) && r.status === 200, `${a.status} ${r.status}`);
});

check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
