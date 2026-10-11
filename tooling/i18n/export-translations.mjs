/**
 * Stage 9 (B5): exports every English / Arabic string for native-language review.
 *
 *   node tooling/i18n/export-translations.mjs [out.csv]      (default: docs/translations/dealdash-translations.csv)
 *
 * Needs the built localization package (pnpm build:packages). One row per key: key, module (the dictionary / stage that owns it),
 * area (key prefix), screen context, English, current Arabic, placeholders, status. Status is NEEDS_NATIVE_REVIEW for every key
 * the reviewer has not approved yet (nothing is ever marked native-approved by this tool). The reviewer fills `ar_reviewed`,
 * `reviewer` and `review_status` (APPROVED / CORRECTED) and the file goes back through import-translations.mjs.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = process.argv[2] ?? join(root, 'docs', 'translations', 'dealdash-translations.csv');
const loc = await import(pathToFileURL(join(root, 'packages', 'localization', 'dist', 'index.mjs')).href);
const { en, ar, arReviewStatus } = loc;

// which source file (module) owns each key: the last file that defines it wins, matching the merge order of dictionaries.ts
const srcDir = join(root, 'packages', 'localization', 'src');
const order = ['dictionaries.ts', 'dictionaries.stage2.ts', 'dictionaries.stage3.ts', 'dictionaries.stage4.ts', 'dictionaries.stage5.ts', 'dictionaries.stage6.ts', 'dictionaries.commercial.ts', 'dictionaries.platform.ts', 'dictionaries.subscription.ts', 'dictionaries.phase45.ts', 'dictionaries.markets.ts', 'dictionaries.partners.ts', 'dictionaries.stage8.ts', 'dictionaries.stage9.ts'];
const MODULE = {
  'dictionaries.ts': 'Stage 1 foundation (shell, sign-in)',
  'dictionaries.stage2.ts': 'Stage 2 merchant onboarding',
  'dictionaries.stage3.ts': 'Stage 3 Live Deals and discovery',
  'dictionaries.stage4.ts': 'Stage 4 Exclusive Deals and redemption',
  'dictionaries.stage5.ts': 'Stage 5 Vouchers, payments, refunds',
  'dictionaries.stage6.ts': 'Stage 6 Watch & Earn and rewards',
  'dictionaries.commercial.ts': 'Commercial finance',
  'dictionaries.platform.ts': 'Shared platform (Phase 1-3)',
  'dictionaries.subscription.ts': 'Subscription and licensing',
  'dictionaries.phase45.ts': 'Phase 4/5 visibility, billing, AI',
  'dictionaries.markets.ts': 'Market configuration',
  'dictionaries.partners.ts': 'Stage 7 Partner Portal',
  'dictionaries.stage8.ts': 'Stage 8 operations',
  'dictionaries.stage9.ts': 'Stage 9 production readiness',
};
const owner = {};
for (const f of order) {
  if (!readdirSync(srcDir).includes(f)) continue;
  const text = readFileSync(join(srcDir, f), 'utf8');
  for (const m of text.matchAll(/^\s+'([A-Za-z0-9_.-]+)':/gm)) owner[m[1]] = f;
}
// where the string is seen (key prefix -> screen / surface)
const CONTEXT = [
  [/^nav\./, 'Navigation menus (all portals)'],
  [/^error\./, 'Error messages (all portals)'],
  [/^notif\./, 'Customer app: notifications'],
  [/^(cust|deal|merch|explore|home|search|profile)\./, 'Customer app'],
  [/^(wat|rw|reward)\./, 'Customer app / Admin: Watch & Earn and rewards'],
  [/^(hot|res|redeem|staff)\./, 'Exclusive Deals / staff redemption'],
  [/^(v|voucher|vpayable|mf|order|pay|refund)\w*\./, 'Vouchers, payments, merchant finance'],
  [/^(onb|ob|app|doc|team|branch)\w*\./, 'Merchant onboarding / organisation'],
  [/^(op|s8)\./, 'Operations (Admin, merchant, customer care)'],
  [/^s9\./, 'Production controls (Admin) and customer case replies'],
  [/^(cc|vis|bill|ai)\./, 'Command Centre, analytics, billing, AI'],
  [/^(mkt)\./, 'Admin: Markets'],
  [/^(pt)\./, 'Partner Portal'],
  [/^(sub|plan|cm|lo)\./, 'Subscriptions, commercial, loyalty'],
];
const contextOf = (k) => CONTEXT.find(([re]) => re.test(k))?.[1] ?? 'Shared';
const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(' ');
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

const header = ['key', 'module', 'area', 'screen_context', 'english', 'arabic_current', 'placeholders', 'status', 'ar_reviewed', 'reviewer', 'review_status', 'reviewer_note'];
const lines = [header.join(',')];
const keys = Object.keys(en).sort();
for (const k of keys) {
  const st = arReviewStatus?.[k]?.status ?? 'NEEDS_NATIVE_REVIEW';
  lines.push([k, MODULE[owner[k]] ?? 'Unknown', k.split('.')[0], contextOf(k), en[k], ar[k], vars(en[k]), st, '', '', '', ''].map(esc).join(','));
}
mkdirSync(dirname(out), { recursive: true });
// UTF-8 with BOM so spreadsheet tools open the Arabic correctly
writeFileSync(out, `﻿${lines.join('\r\n')}\r\n`, 'utf8');
const byStatus = keys.reduce((m, k) => ((m[arReviewStatus?.[k]?.status ?? 'NEEDS_NATIVE_REVIEW'] = (m[arReviewStatus?.[k]?.status ?? 'NEEDS_NATIVE_REVIEW'] ?? 0) + 1), m), {});
console.log(`exported ${keys.length} strings to ${out}`);
console.log(`status: ${JSON.stringify(byStatus)}`);
