/**
 * Generates every Stage 5 handoff SVG + manifest.json + reference-screenshots/.   node figma-handoff/stage5/build-svgs.mjs
 * Frames are drawn from the real design tokens and the real EN/AR dictionaries (same approach as Stage 4). Output is
 * import-ready for Figma (drag the .svg files onto a page; text stays editable; fonts: Plus Jakarta Sans / IBM Plex Sans Arabic).
 * The historical "Figma Files" folder and figma-handoff/stage4 are never written to.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dictionaries } from '../../packages/localization/dist/index.mjs';
import { DESKTOP, MOBILE, bidi, frame as baseFrame } from './lib.mjs';
const frame = (...a) => bidi(baseFrame(...a));
import { ALL, components, flows } from './frames-system.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
for (const d of ['customer', 'merchant', 'staff', 'admin', 'components', 'flows'])
  rmSync(join(here, d), { recursive: true, force: true });
const manifest = [];
const missing = new Set();

// Surface any copy key that is not in the real dictionaries (would render as the raw key).
for (const lang of ['en', 'ar']) {
  const d = dictionaries[lang];
  dictionaries[lang] = new Proxy(d, {
    get: (t, k) => {
      if (typeof k === 'string' && !(k in t) && !(k in dictionaries.en)) missing.add(k);
      return t[k];
    },
  });
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
const PAGE = {
  customer: '01 Customer App',
  merchant: '02 Merchant Portal',
  staff: '03 Merchant Staff',
  admin: '04 Admin Portal',
  components: '06 Components',
  flows: '07 User Flows',
};

function emit(surface, spec, lang) {
  const size = spec.device === 'desktop' ? DESKTOP : MOBILE;
  const f = frame(size.w, size.h, { lang, name: `${spec.id} ${spec.name}` });
  spec.draw(f);
  const file = `${spec.id}-${slug(spec.name)}${lang === 'ar' ? '-ar' : ''}.svg`;
  mkdirSync(join(here, surface), { recursive: true });
  writeFileSync(join(here, surface, file), f.toString(), 'utf8');
  manifest.push({
    id: spec.id,
    lang,
    surface,
    page: PAGE[surface],
    file: `${surface}/${file}`,
    w: size.w,
    h: size.h,
  });
}

for (const [surface, specs] of Object.entries(ALL)) {
  for (const spec of [...specs].sort((a, b) => a.id.localeCompare(b.id))) {
    emit(surface, spec, 'en');
    if (spec.rtl) emit(surface, spec, 'ar');
  }
}
const CW = 1200;
for (const c of components) {
  const f = frame(CW, c.h, { name: `${c.id} ${c.name}`, bg: '#fff' });
  c.draw(f);
  const file = `${c.id}-${slug(c.name)}.svg`;
  mkdirSync(join(here, 'components'), { recursive: true });
  writeFileSync(join(here, 'components', file), f.toString(), 'utf8');
  manifest.push({
    id: c.id,
    lang: 'en',
    surface: 'components',
    page: PAGE.components,
    file: `components/${file}`,
    w: CW,
    h: c.h,
  });
}
for (const fl of flows) {
  const f = frame(1200, fl.h, { name: `${fl.id} ${fl.name}`, bg: '#fff' });
  const per = 4;
  f.text(24, 40, `${fl.id} ${fl.name}`, { size: 22, weight: 800 });
  const tones = {
    info: ['#EEE8FF', '#5B1AFC'],
    success: ['#E2F7F0', '#0B7A5A'],
    warning: ['#FEF1D9', '#8A5A00'],
    danger: ['#FDE8EB', '#B3203A'],
    neutral: ['#EEF0F8', '#5B5E80'],
  };
  fl.steps.forEach((s, i) => {
    const col = i % per,
      row = Math.floor(i / per);
    const x = 24 + col * 290,
      y = 90 + row * 250;
    f.card(x, y, 262, 200, { r: 20 });
    f.circle(x + 28, y + 30, 14, { fill: '#5B1AFC' });
    f.text(x + 28, y + 35, String(i + 1), {
      size: 13,
      weight: 800,
      fill: '#fff',
      align: 'middle',
      ltr: true,
    });
    const [bg, c2] = tones[s.tone ?? 'info'];
    f.pill(x + 52, y + 16, s.surface, { fill: bg, color: c2, size: 10 });
    f.text(x + 16, y + 66, s.title, { size: 14, weight: 800 });
    (s.lines ?? []).forEach((l, j) =>
      f.text(x + 16, y + 92 + j * 20, l, { size: 12, fill: '#5B5E80' }),
    );
    f.text(x + 16, y + 186, s.ref ?? '', { size: 10, fill: '#5B1AFC', weight: 700 });
    if (col < per - 1 && i < fl.steps.length - 1)
      f.text(x + 276, y + 105, '→', {
        size: 22,
        weight: 800,
        fill: '#5B5E80',
        align: 'middle',
        ltr: true,
      });
  });
  f.text(24, 90 + Math.ceil(fl.steps.length / per) * 250 + 10, fl.note, {
    size: 13,
    fill: '#5B5E80',
  });
  const file = `${fl.id}-${slug(fl.name)}.svg`;
  mkdirSync(join(here, 'flows'), { recursive: true });
  writeFileSync(join(here, 'flows', file), f.toString(), 'utf8');
  manifest.push({
    id: fl.id,
    lang: 'en',
    surface: 'flows',
    page: PAGE.flows,
    file: `flows/${file}`,
    w: 1200,
    h: fl.h,
  });
}

// ---- reference screenshots (from the working Stage 5 app; EN and AR) copied into the handoff folders
const shotsDir = join(root, 'docs', 'screenshots', 'stage5');
const refDir = join(here, 'reference-screenshots');
rmSync(refDir, { recursive: true, force: true });
const refs = [];
const surfaceOf = (n) =>
  n.startsWith('customer')
    ? 'customer'
    : n.startsWith('merchant')
      ? 'merchant'
      : n.startsWith('staff')
        ? 'staff'
        : n.startsWith('admin')
          ? 'admin'
          : null;
if (existsSync(shotsDir))
  for (const n of readdirSync(shotsDir).filter((x) => x.endsWith('.png') && !x.startsWith('zz-'))) {
    const s = surfaceOf(n);
    if (!s) continue;
    mkdirSync(join(refDir, s), { recursive: true });
    copyFileSync(join(shotsDir, n), join(refDir, s, n));
    refs.push(`${s}/${n}`);
  }

const specs = Object.entries(ALL).flatMap(([surface, list]) =>
  [...list]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((s) => ({
      surface,
      id: s.id,
      name: s.name,
      journey: s.journey,
      device: s.device,
      rtl: !!s.rtl,
      figma: s.figma,
      isNew: s.isNew,
      comps: s.comps,
      sheets: s.sheets,
      states: s.states,
      route: s.route,
      priority: s.priority,
      shot: s.shot,
    })),
);
const brokenShots = specs
  .filter((s) => s.shot && !refs.some((r) => r.endsWith(`${s.shot}.png`)))
  .map((s) => `${s.id}:${s.shot}`);
writeFileSync(
  join(here, 'manifest.json'),
  JSON.stringify(
    {
      generated: new Date().toISOString(),
      files: manifest,
      screens: specs,
      components: components.map((c) => ({ id: c.id, name: c.name, items: c.items })),
      flows: flows.map((x) => ({ id: x.id, name: x.name, steps: x.steps.length })),
      referenceScreenshots: refs,
      pages: PAGE,
    },
    null,
    2,
  ),
  'utf8',
);

console.log(`SVG files: ${manifest.length}`);
for (const s of ['customer', 'merchant', 'staff', 'admin', 'components', 'flows']) {
  const m = manifest.filter((x) => x.surface === s);
  console.log(
    `  ${s}: ${m.length} (EN ${m.filter((x) => x.lang === 'en').length}, AR ${m.filter((x) => x.lang === 'ar').length})`,
  );
}
console.log(`Component specimen items: ${components.reduce((n, c) => n + c.items.length, 0)}`);
console.log(
  `Reference screenshots: ${refs.length}${brokenShots.length ? ` (missing: ${brokenShots.join(', ')})` : ''}`,
);
console.log(
  missing.size
    ? `MISSING DICTIONARY KEYS (${missing.size}):\n  ` + [...missing].sort().join('\n  ')
    : 'All copy keys resolved from the real dictionaries.',
);
