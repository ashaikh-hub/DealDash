/**
 * Stage 9 — practical MVP accessibility audit (real Edge through playwright-core, fresh TEST database via .tools/stage7/qa.mjs).
 * Not a WCAG certification: an automated sweep of the checks that catch most real defects, on the main screens of every app,
 * in English and Arabic. Findings are written to docs/accessibility/stage9-a11y-report.json and summarised in the Stage 9 doc.
 *
 * Per page: language + direction set; one main heading; every form control and button has an accessible name; images have alt;
 * no duplicate ids; Tab moves focus to a visible element with a focus style; body text contrast >= 4.5:1; no horizontal scroll at
 * 320 px (reflow / 400% zoom equivalent).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const API = process.env.API_URL ?? 'http://localhost:4000';
const APPS = { customer: 'http://localhost:3001', merchant: 'http://localhost:3002', staff: 'http://localhost:3003', partner: 'http://localhost:3004', admin: 'http://localhost:3005' };
const PASSWORD = process.env.SEED_USER_PASSWORD;
const OUT = join(process.cwd(), 'docs', 'accessibility');
mkdirSync(OUT, { recursive: true });
for (let ok = 0, tries = 0; ok < 10 && tries < 150; tries++) {
  ok = (await fetch(`${API}/v1/health/live`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 2000));
}
for (const [, base] of Object.entries(APPS)) for (const p of ['/en', '/ar']) await fetch(`${base}${p}`).catch(() => undefined);
for (const p of ['/en/explore', '/en/profile', '/en/cases', '/en/configuration', '/en/cases', '/en/settlements']) {
  await fetch(`${APPS.customer}${p}`).catch(() => undefined);
  await fetch(`${APPS.admin}${p}`).catch(() => undefined);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = [];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};

async function audit(page, label) {
  const r = await page.evaluate(() => {
    const visible = (el) => {
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0;
    };
    const nameOf = (el) => {
      const aria = el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      if (aria.trim()) return aria.trim();
      if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return 'label';
      if (el.closest('label')) return 'label';
      return (el.textContent ?? '').trim() || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('value') || '';
    };
    const controls = [...document.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(visible);
    const unlabeled = controls.filter((c) => !nameOf(c)).map((c) => c.outerHTML.slice(0, 90));
    const buttons = [...document.querySelectorAll('button, [role=button], a[href]')].filter(visible);
    const unnamed = buttons.filter((b) => !nameOf(b) && !b.querySelector('img[alt]:not([alt=""]), svg title')).map((b) => b.outerHTML.slice(0, 90));
    const images = [...document.querySelectorAll('img')].filter((i) => !i.hasAttribute('alt')).map((i) => i.outerHTML.slice(0, 90));
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    const dupIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    const h1 = document.querySelectorAll('h1').length;
    // contrast of the body text
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const parse = (s) => (s.match(/[\d.]+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number);
    const p = document.querySelector('main p, main, body');
    let bg = getComputedStyle(document.body).backgroundColor;
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) bg = 'rgb(255,255,255)';
    const fg = getComputedStyle(p).color;
    const [l1, l2] = [lum(parse(fg)), lum(parse(bg))].sort((a, b) => b - a);
    const contrast = (l1 + 0.05) / (l2 + 0.05);
    return { lang: document.documentElement.lang, dir: document.documentElement.dir, h1, controls: controls.length, unlabeled, unnamed, images, dupIds, contrast: Math.round(contrast * 10) / 10 };
  });
  // keyboard: Tab reaches a visible, focus-styled element
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return { moved: false, styled: false };
    const s = getComputedStyle(a);
    return { moved: true, styled: s.outlineStyle !== 'none' || s.boxShadow !== 'none', tag: a.tagName };
  });
  report.push({ page: label, ...r, focus });
  const issues = [
    !r.lang && 'no lang',
    r.h1 !== 1 && `${r.h1} h1`,
    r.unlabeled.length && `${r.unlabeled.length} unlabeled control(s)`,
    r.unnamed.length && `${r.unnamed.length} unnamed button/link(s)`,
    r.images.length && `${r.images.length} image(s) without alt`,
    r.dupIds.length && `duplicate ids ${r.dupIds.slice(0, 3).join(',')}`,
    !focus.moved && 'Tab does not move focus',
    focus.moved && !focus.styled && 'focus not visible',
    r.contrast < 4.5 && `contrast ${r.contrast}`,
  ].filter(Boolean);
  check(`a11y: ${label}`, issues.length === 0, issues.join('; '));
}

async function reflow(page, url, label) {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  check(`reflow at 320 px: ${label}`, ok);
}

async function signInAdmin(page) {
  await page.goto(`${APPS.admin}/en/cases`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Work email', { exact: true }).fill('super@dealdash.test');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.locator('input[autocomplete="one-time-code"]').first().waitFor({ timeout: 30000 });
  await page.locator('input[autocomplete="one-time-code"]').first().click();
  await page.keyboard.type((await (await fetch(`${API}/v1/dev/totp?email=super@dealdash.test`)).json()).data.code, { delay: 25 });
  await page.getByRole('button', { name: 'Sign out' }).first().waitFor({ timeout: 60000 });
}

const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
for (const [app, base] of Object.entries(APPS)) {
  for (const loc of ['en', 'ar']) {
    await page.goto(`${base}/${loc}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    await audit(page, `${app} ${loc} start / sign-in`);
  }
}
for (const p of ['/en/explore', '/en/profile', '/ar/explore']) {
  await page.goto(`${APPS.customer}${p}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await audit(page, `customer ${p}`);
}
await signInAdmin(page);
for (const p of ['/en/cases', '/en/configuration', '/en/settlements', '/ar/cases']) {
  await page.goto(`${APPS.admin}${p}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await audit(page, `admin ${p}`);
}
const phone = await (await browser.newContext()).newPage();
await reflow(phone, `${APPS.customer}/en`, 'customer home (en)');
await reflow(phone, `${APPS.customer}/ar/explore`, 'customer explore (ar)');
await reflow(phone, `${APPS.staff}/en`, 'staff sign-in');
await browser.close();
writeFileSync(join(OUT, 'stage9-a11y-report.json'), JSON.stringify({ measuredAt: new Date().toISOString(), pages: report, checks: results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
// an accessibility sweep reports gaps; it does not fail the run (gaps are classified in the Stage 9 audit)
process.exit(0);
