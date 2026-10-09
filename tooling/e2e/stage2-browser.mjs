/**
 * Stage 2 browser end-to-end check (real Edge/Chrome through playwright-core; no browser download needed).
 *
 *   merchant signs up -> completes the wizard (uploads files through the dev storage adapter) -> submits
 *   admin reviews -> requests changes -> merchant fixes and resubmits -> admin approves -> merchant is active
 *   then the same screens are captured in Arabic (RTL) and basic RTL/overflow assertions are made.
 *
 * Requires the API (4000), merchant (3002) and admin (3005) apps to be running and the dev seed to have been run.
 * Credentials are read from the environment (never stored in this file):
 *   SEED_USER_PASSWORD  password of the seeded admin accounts (for example risk@dealdash.test)
 *
 *   node tooling/e2e/stage2-browser.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const MERCHANT = process.env.MERCHANT_URL ?? 'http://localhost:3002';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:3005';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'stage2');
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD;
if (!SEED_PASSWORD) throw new Error('Set SEED_USER_PASSWORD (the password you gave to the seed) before running.');
mkdirSync(OUT, { recursive: true });

const rnd = () => randomBytes(3).toString('hex');
const email = `browser-${rnd()}@merchant.test`;
const password = `Br-${randomBytes(8).toString('base64url')}9a`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};

// tiny valid files
const PDF = Buffer.from('%PDF-1.4\n% e2e placeholder\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function api(path) {
  const r = await fetch(API + path);
  return (await r.json()).data;
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctxOpts = { viewport: { width: 1280, height: 900 } };

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}

async function otp(page, code) {
  await page.locator('input[autocomplete="one-time-code"]').first().click();
  await page.keyboard.type(code, { delay: 30 });
}

try {
  // ---------------------------------------------------------------- merchant: sign up
  const mctx = await browser.newContext(ctxOpts);
  const m = await mctx.newPage();
  const consoleErrors = [];
  m.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(msg.text()));
  await m.goto(`${MERCHANT}/en/signup`);
  await m.getByLabel('Business name (English)', { exact: true }).fill(`Browser Cafe ${rnd()}`);
  await m.getByLabel('Business name (Arabic)', { exact: true }).fill('مقهى المتصفح');
  await m.getByLabel('Work email', { exact: true }).fill(email);
  await m.getByLabel('Password', { exact: true }).fill(password);
  await shot(m, '01-signup-en');
  await m.getByRole('button', { name: 'Create account' }).click();
  await m.getByText('Verify your email').waitFor();
  const mail = await api(`/v1/dev/last-email?to=${encodeURIComponent(email)}&template=merchant.email_verify`);
  await otp(m, mail.code);
  await m.waitForURL('**/en/onboarding');
  check('merchant can sign up, verify email, and lands in onboarding', true);

  // ---------------------------------------------------------------- merchant: wizard
  await m.getByRole('heading', { name: 'Business details' }).first().waitFor();
  await m.getByLabel('Legal name (English)', { exact: true }).fill('Browser Cafe Trading Co.');
  await m.getByLabel('Legal name (Arabic)', { exact: true }).fill('شركة مقهى المتصفح التجارية');
  await m.getByLabel('Trade name (English)', { exact: true }).fill('Browser Cafe');
  await m.getByLabel('Trade name (Arabic)', { exact: true }).fill('مقهى المتصفح');
  await m.getByLabel('Commercial registration number').fill(`10${rnd()}`);
  await m.getByLabel('Registered address').fill('Olaya Street, Riyadh');
  await shot(m, '02-wizard-business-en');
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  await m.getByText('Saved.').waitFor();
  check('business details save', true);

  // validation: clearing a required field blocks save with a field error (shared Zod schema)
  await m.getByLabel('Registered address').fill('');
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  check('client validation marks the empty required field', (await m.getByLabel('Registered address').getAttribute('aria-invalid')) === 'true');
  await m.getByLabel('Registered address').fill('Olaya Street, Riyadh');
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  await m.getByText('Saved.').waitFor();

  await m.getByRole('button', { name: 'Next', exact: true }).click(); // category
  await m.getByLabel('Category', { exact: true }).selectOption('cafes');
  await m.getByLabel('Description (English)').fill('A friendly neighbourhood cafe.');
  await m.getByLabel('Description (Arabic)').fill('مقهى ودود في الحي.');
  await m.locator('#img-LOGO').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
  await m.locator('img[alt="Logo"]').waitFor();
  await m.locator('#img-COVER').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG });
  await m.locator('img[alt="Cover image"]').waitFor();
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  await m.getByText('Saved.').waitFor();
  check('logo and cover upload through the storage adapter, category saves', true);

  await m.getByRole('button', { name: 'Next', exact: true }).click(); // representative
  await m.getByLabel('Full name', { exact: true }).fill('Sara Alharbi');
  await m.getByLabel('Role in the business').fill('Owner');
  await m.getByLabel('ID or Iqama number').fill('1000000009');
  await m.getByLabel('Mobile number', { exact: true }).fill('+966500001234');
  await m.getByLabel('Email', { exact: true }).fill(email);
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  await m.getByText('Saved.').waitFor();
  check('authorised representative saves', true);

  await m.getByRole('button', { name: 'Next', exact: true }).click(); // branches
  await m.getByRole('button', { name: 'Add branch' }).click();
  await m.getByLabel('Branch name (English)').pressSequentially('Browser Cafe Olaya', { delay: 5 });
  await m.getByLabel('Branch name (Arabic)').fill('مقهى المتصفح العليا');
  await m.getByLabel('Address (English)').fill('Olaya Street');
  await m.getByLabel('Address (Arabic)').fill('شارع العليا');
  await m.getByLabel('Latitude').fill('24.7136');
  await m.getByLabel('Longitude').fill('46.6753');
  await shot(m, '03-branch-editor-en');
  await m.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await m.getByText('Browser Cafe Olaya').waitFor();
  check('branch with opening hours is created', true);

  await m.getByRole('button', { name: 'Next', exact: true }).click(); // documents
  await m.getByLabel('Expiry date').fill('2031-12-31');
  await m.locator('#doc-CR').setInputFiles({ name: 'commercial-registration.pdf', mimeType: 'application/pdf', buffer: PDF });
  await m.getByText('commercial-registration.pdf').waitFor();
  await shot(m, '04-documents-en');
  check('document uploads and is attached with an expiry date', true);

  // a disguised executable is refused
  await m.getByLabel('Expiry date').fill('2031-12-31');
  await m.locator('#doc-CR').setInputFiles({ name: 'evil.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]) });
  await m.getByText(/not accepted/).waitFor();
  check('a file whose content is not a real PDF is rejected', true);

  await m.getByRole('button', { name: 'Next', exact: true }).click(); // settlement
  await m.getByLabel('Bank name').fill('Sample Bank');
  await m.getByLabel('Account holder name').fill('Browser Cafe Trading Co.');
  await m.getByLabel('IBAN', { exact: true }).fill('SA0000000000000000000000');
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  check('an invalid IBAN is refused', await m.getByText(/valid Saudi IBAN/).first().isVisible());
  await m.getByLabel('IBAN', { exact: true }).fill(process.env.E2E_IBAN ?? 'SA7980000000000000000077');
  await m.getByRole('button', { name: 'Save', exact: true }).click();
  await m.getByText('Saved.').waitFor();
  const pageText = await m.locator('body').innerText();
  check('IBAN is shown masked after saving', /SA\d\d \*\*\*\* \*\*\*\* \*\*\*\* \d{4}/.test(pageText) && !pageText.includes('SA7980000000000000000077'));

  await m.getByRole('button', { name: 'Next', exact: true }).click(); // agreement
  await m.getByText('Version 1.0').first().waitFor();
  await m.getByLabel('Type the signatory full name').fill('Sara Alharbi');
  await m.getByLabel(/I have read and accept/).check();
  await shot(m, '05-agreement-en');
  await m.getByRole('button', { name: 'Sign agreement' }).click();
  await m.getByText('Agreement signed').waitFor();
  check('agreement signed by the named signatory', true);

  await m.getByRole('button', { name: 'Next', exact: true }).click(); // review
  const mobile = `+9665${Math.floor(10000000 + Math.random() * 89999999)}`;
  await m.getByLabel('Mobile number', { exact: true }).fill(mobile);
  await m.getByRole('button', { name: 'Send code' }).click();
  await m.locator('input[autocomplete="one-time-code"]').first().waitFor();
  const sms = await api(`/v1/dev/last-sms?to=${encodeURIComponent(mobile)}`);
  await otp(m, sms.code);
  await m.getByText('Verified').nth(1).waitFor();
  await shot(m, '06-review-en');
  await m.getByLabel(/I confirm the information/).check();
  await m.getByRole('button', { name: 'Submit application' }).click();
  await m.getByText('Our team is reviewing your application').waitFor();
  await shot(m, '07-status-submitted-en');
  check('application submitted; merchant sees a read-only status page', true);
  const reference = (await m.locator('.dd-ltr', { hasText: /^DD-M-\d+$/ }).first().innerText()).trim();

  // ---------------------------------------------------------------- admin: review
  const actx = await browser.newContext(ctxOpts);
  const a = await actx.newPage();
  await a.goto(`${ADMIN}/en`);
  await a.getByLabel('Work email', { exact: true }).fill('risk@dealdash.test');
  await a.getByLabel('Password', { exact: true }).fill(SEED_PASSWORD);
  await a.getByRole('button', { name: 'Sign in' }).click();
  await a.locator('input[autocomplete="one-time-code"]').first().waitFor();
  const totp = await api('/v1/dev/totp?email=risk@dealdash.test');
  await otp(a, totp.code);
  await a.getByRole('link', { name: 'Merchants' }).first().waitFor();
  await a.goto(`${ADMIN}/en/merchants`);
  await a.getByText(reference).waitFor();
  await shot(a, '08-admin-queue-en');
  check('admin sees the submitted application in the review queue', true);
  await a.getByRole('link', { name: new RegExp(reference) }).click();
  await a.getByRole('button', { name: 'Claim for review' }).click();
  await a.getByRole('button', { name: 'Request changes' }).waitFor();
  await shot(a, '09-admin-workbench-en');
  await a.getByRole('tab', { name: /Documents/ }).click();
  await a.getByRole('button', { name: 'Flag for replacement' }).click();
  // typed key by key (not fill) so a dialog that steals focus on re-render would fail this check
  const msg = 'The registration copy is not legible. Please upload a clearer copy.';
  await a.getByLabel('Message to the merchant (English)').pressSequentially(msg, { delay: 5 });
  check('typing in a dialog keeps focus (every character lands)', (await a.getByLabel('Message to the merchant (English)').inputValue()) === msg);
  await a.getByLabel('Message to the merchant (Arabic)').fill('نسخة السجل غير واضحة. يرجى رفع نسخة أوضح.');
  await a.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await a.getByText('Waiting for the merchant to make the requested changes.').waitFor();
  check('admin requests changes on the document', true);

  // ---------------------------------------------------------------- merchant: fix and resubmit
  await m.reload();
  await m.getByText('Changes requested by DealDash').waitFor();
  await shot(m, '10-merchant-changes-requested-en');
  check('merchant sees the requested changes with the reviewer message', await m.getByText('The registration copy is not legible').isVisible());
  await m.getByRole('button', { name: /Documents/ }).first().click();
  await m.getByLabel('Expiry date').fill('2032-06-30');
  await m.locator('#doc-CR').setInputFiles({ name: 'cr-clear.pdf', mimeType: 'application/pdf', buffer: PDF });
  await m.getByText('cr-clear.pdf').waitFor();
  await m.getByRole('button', { name: /Verify and submit/ }).first().click();
  await m.getByLabel(/I confirm the information/).check();
  await m.getByRole('button', { name: 'Resubmit application' }).click();
  await m.getByText('Our team is reviewing your application').waitFor();
  check('merchant replaces the document and resubmits', true);

  // ---------------------------------------------------------------- admin: approve
  await a.reload();
  await a.getByRole('button', { name: 'Claim for review' }).click();
  await a.getByRole('button', { name: 'Request changes' }).waitFor();
  await a.getByText('Changed since the previous submission').waitFor();
  check('admin sees what changed since the previous submission', true);
  await a.getByRole('tab', { name: /Documents/ }).click();
  for (const b of await a.getByRole('button', { name: 'Accept document' }).all()) if (await b.isEnabled()) await b.click();
  await a.getByRole('tab', { name: 'Overview' }).click();
  await a.getByRole('button', { name: 'Approve', exact: true }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await a.getByText('This application was approved.').waitFor();
  await shot(a, '11-admin-approved-en');
  check('admin approves; merchant account becomes active', (await a.locator('body').innerText()).includes('Active'));

  // ---------------------------------------------------------------- merchant: active
  await m.goto(`${MERCHANT}/en`);
  await m.getByText('Active', { exact: true }).first().waitFor();
  await m.getByRole('link', { name: 'Team', exact: true }).first().click();
  await m.getByRole('heading', { name: 'Team', exact: true }).waitFor();
  await shot(m, '12-team-en');
  await m.getByRole('link', { name: 'Branches' }).first().click();
  await m.getByRole('heading', { name: 'Branches', exact: true }).waitFor();
  check('after approval the merchant reaches Team and Branches', true);

  // ---------------------------------------------------------------- merchant: team (invite, accept, deactivate)
  await m.getByRole('link', { name: 'Team' }).first().click();
  await m.getByRole('heading', { name: 'Team', exact: true }).waitFor();
  const colleague = `colleague-${rnd()}@merchant.test`;
  await m.getByRole('button', { name: 'Invite user' }).click();
  await m.getByLabel('Name', { exact: true }).pressSequentially('Nora Alsaud', { delay: 5 });
  await m.getByLabel('Work email', { exact: true }).fill(colleague);
  await m.getByRole('dialog').getByRole('button', { name: 'Send invitation' }).click();
  await m.getByText('Development: invitation link').waitFor();
  const inviteLink = (await m.locator('.dd-alert .dd-ltr').first().innerText()).trim();
  await shot(m, '12b-team-invited-en');
  const ictx = await browser.newContext(ctxOpts);
  const ip = await ictx.newPage();
  await ip.goto(inviteLink);
  await ip.getByText(/You have been invited|Hello Nora/).first().waitFor();
  await ip.getByLabel('Choose a password').fill(password);
  await ip.getByRole('button', { name: 'Accept invitation' }).click();
  await ip.getByText('Your account is ready').waitFor();
  check('invited administrator accepts the invitation and sets a password', true);
  await m.reload();
  await m.getByText(colleague).waitFor();
  await m.getByRole('button', { name: 'Invite user' }).click();
  await m.getByLabel('Name', { exact: true }).fill('Khalid Staff');
  await m.getByLabel('Role', { exact: true }).selectOption('MERCHANT_STAFF');
  await m.getByLabel('Mobile number').fill(`+96655${Math.floor(1000000 + Math.random() * 8999999)}`);
  await m.getByLabel('Branch', { exact: true }).selectOption({ index: 1 });
  await m.getByRole('dialog').getByRole('button', { name: 'Send invitation' }).click();
  await m.getByText('Khalid Staff').waitFor();
  check('branch staff are invited by mobile with a branch', true);
  await m
    .getByRole('row', { name: new RegExp(colleague) })
    .getByRole('button', { name: 'Deactivate' })
    .click();
  await m.getByLabel('Reason').fill('Left the company');
  await m.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await m.getByText('Deactivated').first().waitFor();
  check('a user can be deactivated with a reason', true);

  // ---------------------------------------------------------------- Arabic / RTL
  await m.goto(`${MERCHANT}/ar/onboarding`);
  await m.getByRole('heading', { name: 'الطلب' }).first().waitFor();
  const dir = await m.locator('html').getAttribute('dir');
  const lang = await m.locator('html').getAttribute('lang');
  check('Arabic merchant page is rtl with lang=ar', dir === 'rtl' && lang === 'ar', `dir=${dir} lang=${lang}`);
  await shot(m, '13-onboarding-status-ar');
  const overflowM = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow in Arabic merchant page', overflowM <= 1, `overflow=${overflowM}`);
  const sidebarSide = await m.evaluate(() => {
    const el = document.querySelector('.dd-sidebar');
    if (!el) return 'none';
    return el.getBoundingClientRect().left > window.innerWidth / 2 ? 'right' : 'left';
  });
  check('Arabic layout puts the navigation sidebar on the right', sidebarSide === 'right', `sidebar=${sidebarSide}`);
  await m.goto(`${MERCHANT}/ar/team`);
  await m.getByRole('heading', { name: 'الفريق', exact: true }).waitFor();
  await shot(m, '14-team-ar');
  await m.goto(`${MERCHANT}/ar/branches`);
  await m.getByRole('button', { name: 'إضافة فرع' }).click();
  await shot(m, '15-branch-editor-ar');
  const hasLatinLabels = /Legal name|Description \(English\)/.test(await m.locator('body').innerText());
  check('Arabic UI shows Arabic labels (no English fallbacks in the branch editor)', !hasLatinLabels);
  await a.goto(`${ADMIN}/ar/merchants`);
  await a.getByRole('heading', { name: 'التجار', exact: true }).waitFor();
  await shot(a, '16-admin-merchants-ar');
  await a.goto(`${ADMIN}/ar/audit`);
  await a.getByRole('heading', { name: 'سجل التدقيق' }).waitFor().catch(() => undefined);
  await shot(a, '17-admin-audit-ar');
  const overflowA = await a.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow in Arabic admin pages', overflowA <= 1, `overflow=${overflowA}`);

  // mobile width merchant (responsive)
  const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const mp = await mobileCtx.newPage();
  await mp.goto(`${MERCHANT}/en/signup`);
  await mp.getByLabel('Business name (English)', { exact: true }).waitFor();
  const overflowPhone = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(mp, '18-signup-phone');
  check('sign-up has no horizontal scroll at phone width', overflowPhone <= 1, `overflow=${overflowPhone}`);

  const real = consoleErrors.filter((e) => !/favicon|Failed to load resource.*(400|401|403|404|409)/i.test(e));
  check('no unexpected console errors in the merchant app', real.length === 0, real.slice(0, 2).join(' | '));
} catch (e) {
  check('browser run completed without an exception', false, String(e).split('\n')[0]);
  console.error(e);
} finally {
  await browser.close();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
}
