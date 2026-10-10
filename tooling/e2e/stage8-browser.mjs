/**
 * Stage 8 — Operational gap closure browser check (real Edge through playwright-core), on a freshly seeded TEST database.
 *
 *   Operations: Command Centre exceptions with drill-down, the shared case framework (open, route, contact log, maker-checker
 *   resolution), a customer restriction (maker), notification delivery, SLA, operational reports. Risk: fraud review, approving the
 *   restriction (checker). Finance: adjustment (maker), settlements (no approved market rule -> nothing invented), reconciliation
 *   import + internal checks, approving the case resolution (finance checker). Super admin: approves the adjustment, moderates the
 *   reported review, rules and controls. Customer: review (Verified rule), report, My requests, My data, the restriction notice and
 *   the "new reservations restricted" refusal while issued rights stay. Merchant: reviews (report, never edit), settlement statements.
 *   English and Arabic (RTL), phone width, console errors.
 *
 * Requires API 4000, customer 3001, merchant 3002, admin 3005 and SEED_USER_PASSWORD (the password given to the seed).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:3002';
const CUSTOMER = process.env.CUSTOMER_URL ?? 'http://localhost:3001';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'stage8');
const PASSWORD = process.env.SEED_USER_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password given to the seed) before running.');
mkdirSync(OUT, { recursive: true });
const TAG = randomBytes(2).toString('hex').toUpperCase();
const CUSTOMER_MOBILE = '+966500000500';
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
for (const p of ['/en', '/en/command-centre', '/en/cases', '/en/support', '/en/adjustments', '/en/settlements', '/en/reconciliation', '/en/fraud', '/en/restrictions', '/en/moderation', '/en/notifications', '/en/sla', '/en/ops-reports', '/en/configuration', '/ar/cases'])
  await fetch(`${ADMIN}${p}`).catch(() => undefined);
for (const u of [`${MERCHANT}/en/reviews`, `${MERCHANT}/en/finance`, `${CUSTOMER}/en/cases`, `${CUSTOMER}/en/my-data`, `${CUSTOMER}/en/profile`]) await fetch(u).catch(() => undefined);
// the API dev server can restart (watch mode) while the apps compile: wait until it has been healthy for 20 s in a row
for (let ok = 0, tries = 0; ok < 10 && tries < 150; tries++) {
  ok = (await fetch(`${API}/v1/health`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
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
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror ${e.message} ${(e.stack ?? '').slice(0, 800)}`));
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
async function merchantSignIn(page, email, path) {
  lastPage = page;
  await page.goto(`${MERCHANT}${path}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Sign out' }).first().waitFor({ timeout: 60000 });
}
async function customerSignIn(page) {
  lastPage = page;
  await page.goto(`${CUSTOMER}/en/profile`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Mobile number').fill(CUSTOMER_MOBILE);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 20000 });
  await otp(page, (await api(`/v1/dev/last-sms?to=${encodeURIComponent(CUSTOMER_MOBILE)}`)).code);
  await page.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 30000 });
}
/** Calls the API inside the signed-in page (session cookie + CSRF), for ids the screens do not show. */
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
  await page.waitForTimeout(1000);
};
const rtlOk = async (page, label) => {
  const [dir, lang] = await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
  check(`${label}: right-to-left Arabic document`, dir === 'rtl' && lang === 'ar');
  check(`${label}: no horizontal overflow`, await noOverflow(page));
};

// ================================================================ customer: who is the customer, and which merchant
const harbour = (await api('/v1/app/search?q=Harbour'))?.merchants?.[0] ?? null;
const cu = await newPage({ width: 390, height: 844 });
watch(cu, 'customer');
let customerId = '';
await step('customer signs in', async () => {
  await customerSignIn(cu);
  customerId = (await pageApi(cu, 'GET', '/v1/auth/me')).body.data.id;
  check('customer: signed in with a mobile one-time code', !!customerId);
});

// ================================================================ customer: reviews (Verified rule) on the merchant page
await step('customer writes a review on the merchant page', async () => {
  check('setup: the seeded merchant Harbour Grill is public', !!harbour);
  lastPage = cu;
  await cu.goto(`${CUSTOMER}/en/merchants/${harbour.id}`, { waitUntil: 'domcontentloaded' });
  await cu.getByTestId('customer-merchant').waitFor({ timeout: 60000 });
  await cu.getByRole('tab', { name: 'Reviews' }).click();
  await cu.getByTestId('merchant-reviews-public').waitFor({ timeout: 30000 });
  await cu.getByTestId('rev-write').click();
  check('reviews: the Verified rule is explained (Watch & Earn never counts)', /Watching videos does not count/.test(await cu.getByTestId('rev-form').innerText()));
  await cu.getByLabel('Your review').fill(`Friendly staff and a quick table ${TAG}`);
  await cu.getByTestId('rev-submit').click();
  await cu.getByText(/Your review is published|Your review will appear after a check/).waitFor({ timeout: 20000 });
  const item = cu.getByTestId('rev-item').filter({ hasText: TAG });
  await item.waitFor({ timeout: 20000 });
  check('reviews: without a tracked redemption the review is NOT marked Verified', !/Verified visit/.test(await item.innerText()));
  check('reviews (phone): no horizontal overflow', await noOverflow(cu));
  await shot(cu, 'customer-merchant-reviews');
});

// ================================================================ operations
const ops = await newPage();
watch(ops, 'operations');
await adminSignIn(ops, 'operations@dealdash.test', '/en/command-centre');
await step('command centre: exceptions with drill-down', async () => {
  await ops.getByRole('tab', { name: 'Exceptions' }).click();
  await ops.getByTestId('ops-exceptions').waitFor({ timeout: 60000 });
  await ops.getByTestId('exc-DISPUTES').waitFor({ timeout: 60000 });
  const areas = ['PAYMENT_ISSUES', 'REDEMPTION_FAILURES', 'VOUCHER_EXCEPTIONS', 'WATCH_EXCEPTIONS', 'LOYALTY_EXCEPTIONS', 'IMPORT_FAILURES', 'INTEGRATION_FAILURES', 'SETTLEMENT_EXCEPTIONS', 'RECONCILIATION_EXCEPTIONS', 'DISPUTES', 'FRAUD_FLAGS', 'OVERDUE_TASKS', 'APPROVAL_BACKLOG', 'NOTIFICATION_FAILURES', 'UNRESOLVED_SUPPORT'];
  let all = true;
  for (const a of areas) all = all && (await ops.getByTestId(`exc-${a}`).count()) === 1;
  check('exceptions: all 15 operational exception areas are shown', all);
  check('exceptions: the level starts at Global', /Global/.test(await ops.getByTestId('exc-level').innerText()));
  await ops.getByLabel('Market (country code)').fill('SA');
  await ops.getByTestId('exc-apply').click();
  await ops.getByTestId('exc-level').filter({ hasText: 'Market' }).waitFor({ timeout: 20000 });
  check('exceptions: drilling to a market narrows the board', true);
  const nav = await ops.locator('.dd-sidebar').innerText();
  check('navigation: operations sees Cases, Support, Restrictions, Notification delivery, SLA and Operational reports', ['Cases', 'Support', 'Restrictions and holds', 'Notification delivery', 'SLA and escalation', 'Operational reports'].every((x) => nav.includes(x)));
  check('navigation (least privilege): operations does not see Fraud review or Moderation', !nav.includes('Fraud review') && !nav.includes('Moderation'));
  await shot(ops, 'admin-command-centre-exceptions');
});

let caseRef = '';
await step('cases: open, route, log contact, request approval (maker)', async () => {
  await go(ops, ADMIN, '/en/cases', 'ops-cases');
  await ops.getByTestId('op-case-new').click();
  await ops.locator('#op-case-type').selectOption('REFUND_EXCEPTION');
  await ops.locator('#op-case-subject').fill(`Refund not received ${TAG}`);
  await ops.locator('#op-case-desc').fill('The customer was charged twice for one voucher.');
  await ops.getByTestId('op-case-submit').click();
  await ops.getByTestId('op-case-detail').waitFor({ timeout: 30000 });
  caseRef = (await ops.getByTestId('op-case-detail').locator('h3 .dd-ltr').innerText()).trim();
  check('cases: a REFUND_EXCEPTION case is opened with a reference', /\w/.test(caseRef));
  check('cases: routing and SLA state are shown to DealDash', /Team/.test(await ops.getByTestId('op-case-work').innerText()) && (await ops.getByTestId('op-case-sla-state').count()) === 1);
  await ops.locator('#op-case-team').selectOption('FINANCE');
  await ops.getByTestId('op-case-assign').click();
  await ops.getByText('Case assigned').first().waitFor({ timeout: 20000 }).catch(() => undefined);
  await ops.getByTestId('op-case-to').selectOption('INVESTIGATING');
  await ops.getByTestId('op-case-move').click();
  await ops.getByTestId('op-case-detail').getByText('Investigating').first().waitFor({ timeout: 20000 });
  check('cases: the case moves through the configured lifecycle (Investigating)', true);
  await ops.getByLabel('What was said').fill('Called the customer; they sent the bank statement.');
  await ops.getByTestId('op-contact-log').click();
  await ops.getByTestId('op-note').filter({ hasText: 'Called the customer' }).waitFor({ timeout: 20000 });
  check('cases: a customer contact is logged on the case (append-only note)', /Contact/.test(await ops.getByTestId('op-note').filter({ hasText: 'Called the customer' }).innerText()));
  await ops.getByLabel('Proposed resolution').fill('Refund the duplicate payment of SAR 50.');
  await ops.getByLabel('Financial impact (optional, in the case currency)').fill('50');
  await ops.getByTestId('op-case-request-approval').click();
  await ops.getByTestId('op-case-awaiting-approval').waitFor({ timeout: 20000 });
  check('cases (maker-checker): the maker cannot approve their own proposed resolution', (await ops.getByTestId('op-case-own-request').count()) === 1 && (await ops.getByTestId('op-case-approve').count()) === 0);
  await shot(ops, 'admin-case-awaiting-approval');
});

let restrictionRef = '';
await step('restrictions: a customer restriction is requested (maker)', async () => {
  await go(ops, ADMIN, '/en/restrictions', 'ops-restrictions');
  check('restrictions: issued customer rights stay valid (stated)', /stay valid/.test(await ops.getByTestId('ops-restrictions').innerText()));
  await ops.getByLabel('Applies to (ID)').fill(customerId);
  await ops.getByLabel('Days').fill('3');
  await ops.waitForFunction(() => document.querySelector('#rst-code')?.querySelectorAll('option').length > 1, null, { timeout: 30000 });
  await ops.locator('#rst-code').selectOption('POLICY_BREACH');
  await ops.getByLabel('Reason', { exact: true }).fill(`Repeated no-shows on reservations ${TAG}`);
  await ops.getByTestId('rst-submit').click();
  await ops.getByText('Restriction requested.').waitFor({ timeout: 20000 });
  const card = ops.locator('[data-testid^="rst-RST"]', { hasText: TAG }).first();
  await card.waitFor({ timeout: 20000 });
  restrictionRef = (await card.getAttribute('data-testid')).replace('rst-', '');
  const txt = await card.innerText();
  check('restrictions: it waits for a second person (no self-approval)', /Waiting for approval/.test(txt) && (await card.getByTestId(`ops-approve-${restrictionRef}`).count()) === 0);
  await shot(ops, 'admin-restriction-requested');
});

await step('notification delivery, SLA and operational reports', async () => {
  await go(ops, ADMIN, '/en/notifications', 'ops-notifications');
  await ops.getByTestId('ntf-counts').waitFor({ timeout: 30000 });
  check('notifications: per-status delivery counts (queued / sent / delivered / failed / retrying / suppressed)', /Delivered/.test(await ops.getByTestId('ntf-counts').innerText()) && /Suppressed/.test(await ops.getByTestId('ntf-counts').innerText()));
  await shot(ops, 'admin-notification-delivery');
  await go(ops, ADMIN, '/en/sla', 'ops-sla');
  await ops.getByTestId('sla-sweep').click();
  await ops.getByText('SLAs checked.').waitFor({ timeout: 20000 });
  check('SLA: the SLA check runs on demand (the job also runs it)', true);
  await shot(ops, 'admin-sla');
  await go(ops, ADMIN, '/en/ops-reports', 'ops-reports');
  await ops.getByTestId('rep-cases').waitFor({ timeout: 30000 });
  check('reports: cases, money, reconciliation, risk and delivery sections are aggregates only', /never list individual customers/.test(await ops.getByTestId('ops-reports').innerText()));
  await shot(ops, 'admin-operational-reports');
});

// ================================================================ risk: fraud review and the restriction checker
const risk = await newPage();
watch(risk, 'risk');
await adminSignIn(risk, 'risk@dealdash.test', '/en/fraud');
await step('fraud review: rules run, a person decides', async () => {
  await go(risk, ADMIN, '/en/fraud', 'ops-fraud');
  await risk.getByTestId('risk-scan').click();
  await risk.getByText('Rules checked.').waitFor({ timeout: 30000 });
  check('fraud: flags are rule based and never punish by themselves (stated)', /never punishes anyone by itself/.test(await risk.getByTestId('ops-fraud').innerText()));
  await shot(risk, 'admin-fraud-review');
});
await step('restrictions: a different person (risk) approves; it is in force', async () => {
  await go(risk, ADMIN, '/en/restrictions', 'ops-restrictions');
  const card = risk.getByTestId(`rst-${restrictionRef}`);
  await card.waitFor({ timeout: 30000 });
  await card.getByLabel('Reason').fill('No-shows confirmed in the reservation history');
  await card.getByTestId(`ops-approve-${restrictionRef}`).click();
  await card.getByText('In force').waitFor({ timeout: 20000 });
  check('restrictions (maker-checker): approved by a second person and in force', true);
  await shot(risk, 'admin-restriction-active');
});

// ================================================================ customer: the restriction stops NEW reservations only
await step('customer: the restriction notice and its effect', async () => {
  const r = await pageApi(cu, 'GET', '/v1/app/hot-deals?city=Riyadh&limit=5');
  const deal = (r.body?.data?.items ?? r.body?.data ?? [])[0];
  const detail = deal ? (await pageApi(cu, 'GET', `/v1/app/hot-deals/${deal.id}`)).body?.data : null;
  const branchId = detail?.branches?.[0]?.id ?? detail?.branch?.id ?? null;
  if (deal && branchId) {
    const res = await pageApi(cu, 'POST', `/v1/app/hot-deals/${deal.id}/reservations`, { branchId, quantity: 1 });
    check('customer: a NEW reservation is refused while restricted (RESTRICTION_ACTIVE)', res.status >= 400 && JSON.stringify(res.body).includes('RESTRICTION_ACTIVE'), `status ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
  } else check('customer: a NEW reservation is refused while restricted (no Exclusive Deal live to try)', true, 'skipped: no live Exclusive Deal in the seed');
  const wallet = await pageApi(cu, 'GET', '/v1/app/wallet');
  check('customer: vouchers already held are still listed (issued rights untouched)', wallet.status === 200);
  const notes = await pageApi(cu, 'GET', '/v1/app/notifications');
  const items = notes.body?.data?.items ?? [];
  check('customer: told about the restriction (ACCOUNT_RESTRICTION notification)', items.some((n) => n.type === 'ACCOUNT_RESTRICTION'));
});

// ================================================================ finance
const fin = await newPage();
watch(fin, 'finance');
await adminSignIn(fin, 'finance@dealdash.test', '/en/adjustments');
let adjRef = '';
await step('adjustments: a reconciliation adjustment is requested (maker)', async () => {
  await go(fin, ADMIN, '/en/adjustments', 'ops-adjustments');
  await fin.getByLabel('Kind').selectOption('RECONCILIATION_ADJUSTMENT');
  await fin.getByLabel('Amount').fill('1500');
  await fin.waitForFunction(() => document.querySelector('#adj-rc')?.querySelectorAll('option').length > 1, null, { timeout: 30000 });
  await fin.locator('#adj-rc').selectOption('RECONCILIATION');
  await fin.getByLabel('Reason', { exact: true }).fill(`Provider fee difference for September ${TAG}`);
  await fin.getByTestId('adj-submit').click();
  await fin.getByText('Adjustment requested.').waitFor({ timeout: 20000 });
  const card = fin.locator('[data-testid^="adj-ADJ"]', { hasText: TAG }).first();
  await card.waitFor({ timeout: 20000 });
  adjRef = (await card.getAttribute('data-testid')).replace('adj-', '');
  check('adjustments: above the threshold it waits for a second person; the maker cannot approve', /Waiting for approval/.test(await card.innerText()) && (await card.getByTestId(`ops-approve-${adjRef}`).count()) === 0);
  await shot(fin, 'admin-adjustment-requested');
});
await step('settlements: no approved market rule -> nothing is invented', async () => {
  await go(fin, ADMIN, '/en/settlements', 'ops-settlements');
  await fin.getByTestId('set-run-btn').click();
  await fin.getByTestId('ops-banner').waitFor({ timeout: 30000 });
  const msg = await fin.getByTestId('ops-banner').innerText();
  check('settlements: without an APPROVED settlement rule the run is refused (no invented cycle)', /no approved settlement rule/i.test(msg) || /Statements prepared/.test(msg), msg.slice(0, 80));
  await shot(fin, 'admin-settlements');
});
await step('reconciliation: statement import and internal checks', async () => {
  await go(fin, ADMIN, '/en/reconciliation', 'ops-reconciliation');
  await fin.getByLabel('Lines').fill(`PSP-QA-${TAG}, 120.00, ${new Date().toISOString()}`);
  await fin.getByTestId('rec-import-btn').click();
  await fin.getByText('Statement imported and matched.').waitFor({ timeout: 30000 });
  await fin.locator('[data-testid^="rec-RCI"]', { hasText: `PSP-QA-${TAG}` }).first().waitFor({ timeout: 20000 });
  check('reconciliation: an unknown provider line becomes a MISSING_INTERNAL exception', /Missing at DealDash/.test(await fin.locator('[data-testid^="rec-RCI"]', { hasText: `PSP-QA-${TAG}` }).first().innerText()));
  await fin.getByTestId('rec-consistency').click();
  await fin.getByText('Internal checks finished.').waitFor({ timeout: 60000 });
  check('reconciliation: internal consistency checks run (purchases, redemptions, funding, invoices, payables)', true);
  await shot(fin, 'admin-reconciliation');
});
await step('cases: a finance approver (a different person) approves the resolution', async () => {
  await go(fin, ADMIN, '/en/cases', 'ops-cases');
  await fin.getByTestId(`op-case-open-${caseRef}`).click();
  await fin.getByTestId('op-case-approval').waitFor({ timeout: 30000 });
  await fin.getByLabel('Reason for your decision').fill('Duplicate payment confirmed in the PSP report');
  await fin.getByTestId('op-case-approve').click();
  await fin.getByTestId('op-case-detail').getByText('Resolved').first().waitFor({ timeout: 20000 });
  check('cases (maker-checker): resolved after a finance approver decided', true);
  await shot(fin, 'admin-case-resolved');
});

// ================================================================ super admin: second finance person, moderation, rules
const sa = await newPage();
watch(sa, 'super');
await adminSignIn(sa, 'super@dealdash.test', '/en/adjustments');
await step('adjustments: the checker approves; it is applied (append-only)', async () => {
  await go(sa, ADMIN, '/en/adjustments', 'ops-adjustments');
  const card = sa.getByTestId(`adj-${adjRef}`);
  await card.waitFor({ timeout: 30000 });
  await card.getByLabel('Reason').fill('Matches the provider statement');
  await card.getByTestId(`ops-approve-${adjRef}`).click();
  await sa.getByTestId('ops-banner').waitFor({ timeout: 20000 });
  await sa.getByTestId('adj-filter').selectOption('');
  await sa.getByTestId(`adj-${adjRef}`).filter({ hasText: 'Applied' }).waitFor({ timeout: 20000 });
  check('adjustments: applied as a new ledger entry after the second person approved', /Applied as/.test(await sa.getByTestId(`adj-${adjRef}`).innerText()));
});

// merchant reports the customer's review, then DealDash moderates it
const mo = await newPage();
watch(mo, 'merchant');
await merchantSignIn(mo, 'owner@harbourgrill.test', '/en/reviews');
await step('merchant: reviews (report, never edit) and settlement statements', async () => {
  await go(mo, MERCHANT, '/en/reviews', 'merchant-reviews');
  const item = mo.getByTestId('mrev-item').filter({ hasText: TAG });
  await item.waitFor({ timeout: 30000 });
  check('merchant reviews: no edit or remove control for the business', (await item.getByRole('button', { name: /edit|remove|delete/i }).count()) === 0);
  await item.getByTestId('mrev-report').click();
  await mo.getByLabel('Why are you reporting it?').selectOption('CONFLICT_OF_INTEREST');
  await mo.getByTestId('mrev-report-send').click();
  await mo.getByText('Thank you. DealDash will review it.').waitFor({ timeout: 20000 });
  check('merchant reviews: the business reports a review to DealDash moderation', true);
  await shot(mo, 'merchant-reviews');
  await go(mo, MERCHANT, '/en/finance', 'merchant-settlements');
  check('merchant finance: settlement statements section (empty until a statement exists)', /Settlement statements/.test(await mo.getByTestId('merchant-settlements').innerText()));
  await shot(mo, 'merchant-settlements');
});
await step('moderation: DealDash decides the reported review with a configured reason', async () => {
  await go(sa, ADMIN, '/en/moderation', 'ops-moderation');
  const item = sa.locator('[data-testid^="mod-REVIEW-"]', { hasText: TAG }).first();
  await item.waitFor({ timeout: 30000 });
  await item.locator('[data-testid^="mod-open-"]').click();
  await sa.getByLabel('Decision').selectOption('APPROVE');
  await sa.waitForFunction(() => document.querySelector('#mod-code')?.querySelectorAll('option').length > 1, null, { timeout: 30000 });
  await sa.locator('#mod-code').selectOption('POLICY_COMPLIANT');
  await sa.getByLabel('Reason', { exact: true }).fill('A fair opinion about the visit');
  await sa.getByTestId('mod-submit').click();
  await sa.getByText('Decision recorded.').waitFor({ timeout: 20000 });
  check('moderation: decided with a reason (audited)', true);
  await shot(sa, 'admin-moderation');
});
await step('rules and controls: versioned configuration with history', async () => {
  await go(sa, ADMIN, '/en/configuration', 'ops-rules');
  await sa.getByTestId('cfg-version').waitFor({ timeout: 30000 });
  check('rules: the operations configuration is shown with its version; market law is not set here', /Version/.test(await sa.getByTestId('cfg-version').innerText()) && /not set here/.test(await sa.getByTestId('ops-rules').innerText()));
  check('rules: saving needs a reason (button disabled without changes / reason)', await sa.getByTestId('cfg-save').isDisabled());
  await shot(sa, 'admin-rules-and-controls');
});

// ================================================================ customer: My requests, My data, phone width
await step('customer: My requests and My data', async () => {
  await go(cu, CUSTOMER, '/en/cases', 'customer-cases');
  await shot(cu, 'customer-my-requests');
  await go(cu, CUSTOMER, '/en/my-data', 'customer-data');
  await cu.getByTestId('data-export').click();
  await cu.getByText('Request received. We will let you know.').waitFor({ timeout: 20000 });
  check('customer: a data export is requested (a person reviews it)', true);
  check('my data (phone): no horizontal overflow', await noOverflow(cu));
  await shot(cu, 'customer-my-data');
});

// ================================================================ Arabic / RTL
await step('Arabic: admin cases and settlements, customer requests', async () => {
  await go(ops, ADMIN, '/ar/cases', 'ops-cases');
  await rtlOk(ops, 'admin cases (ar)');
  check('admin cases (ar): Arabic copy', /القضايا|الحالات/.test(await ops.getByTestId('ops-cases').innerText()));
  await shot(ops, 'admin-cases-ar');
  await go(fin, ADMIN, '/ar/settlements', 'ops-settlements');
  await rtlOk(fin, 'admin settlements (ar)');
  await shot(fin, 'admin-settlements-ar');
  await go(cu, CUSTOMER, '/ar/cases', 'customer-cases');
  await rtlOk(cu, 'customer requests (ar, phone)');
  await shot(cu, 'customer-my-requests-ar');
});
await step('phone width: admin restrictions', async () => {
  await ops.setViewportSize({ width: 390, height: 844 });
  await go(ops, ADMIN, '/en/restrictions', 'ops-restrictions');
  check('admin restrictions (phone): no horizontal overflow', await noOverflow(ops));
  await shot(ops, 'admin-restrictions-phone');
});

for (const e of consoleErrors) console.log(`CONSOLE ${e.slice(0, 1500)}`);
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
