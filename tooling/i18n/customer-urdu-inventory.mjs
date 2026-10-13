/**
 * Launch readiness (Pakistan pilot, founder decision 7): inventory of the strings the CUSTOMER app can show, for Urdu translation.
 * Scans apps/customer and the shared app-shell components the customer app renders for translation-key literals (t('key'),
 * k('prefix', value) -> every key under the prefix), joins them with the English source and writes a translator CSV:
 *   docs/translations/customer-urdu-inventory.csv  (key, english, placeholders, urdu, status=NEEDS_TRANSLATION, notes)
 * Business portals stay English for the pilot. Nothing is marked translated or reviewed by this tool.
 *
 *   node tooling/i18n/customer-urdu-inventory.mjs   (after `pnpm build:packages`, from the repo root)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const { en } = await import(pathToFileURL(join(root, 'packages/localization/dist/index.js')).href);
const keys = new Set(Object.keys(en));

// customer app + the shared component folders it renders (business-only views are excluded)
const dirs = [
  'apps/customer',
  'packages/app-shell/src/deals',
  'packages/app-shell/src/hot',
  'packages/app-shell/src/vouchers',
  'packages/app-shell/src/watch',
  'packages/ui/src',
];
const files = ['packages/app-shell/src/app-shell.tsx', 'packages/app-shell/src/login-panel.tsx', 'packages/app-shell/src/gates.tsx'];
const walk = (d) => {
  for (const name of readdirSync(join(root, d))) {
    if (['node_modules', '.next', 'dist'].includes(name)) continue;
    const p = join(d, name);
    if (statSync(join(root, p)).isDirectory()) walk(p);
    else if (/\.(tsx?|mjs)$/.test(name) && !/\.test\./.test(name)) files.push(p);
  }
};
dirs.forEach(walk);

const used = new Set(['error.generic']);
for (const f of files) {
  const src = readFileSync(join(root, f), 'utf8');
  for (const m of src.matchAll(/['"`]([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)['"`]/g)) {
    const lit = m[1];
    if (keys.has(lit)) used.add(lit);
    else for (const k of keys) if (k.startsWith(`${lit}.`)) used.add(k); // dynamic keys built from a prefix
  }
}
for (const k of keys) if (k.startsWith('error.')) used.add(k); // API errors can reach any customer screen

const esc = (s) => `"${String(s).replaceAll('"', '""')}"`;
const rows = [...used].sort().map((k) => {
  const english = en[k];
  const ph = [...english.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).join(' ');
  return [k, english, ph, '', 'NEEDS_TRANSLATION', ''].map(esc).join(',');
});
const out = join(root, 'docs', 'translations', 'customer-urdu-inventory.csv');
writeFileSync(out, `key,english,placeholders,urdu,status,notes\n${rows.join('\n')}\n`);
const words = [...used].reduce((n, k) => n + en[k].split(/\s+/).length, 0);
console.log(`customer strings: ${used.size} keys, ~${words} English words -> ${out}`);
