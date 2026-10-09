/**
 * Generates every Stage 4 handoff SVG + manifest.json.   node figma-handoff/stage4/build-svgs.mjs
 * Frames are drawn from the real design tokens and the real EN/AR dictionaries. Output is import-ready for Figma
 * (drag the .svg files into a page; text stays editable text, fonts: Plus Jakarta Sans / IBM Plex Sans Arabic).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dictionaries } from '../../packages/localization/dist/index.mjs';
import { DESKTOP, MOBILE, frame } from './lib.mjs';
import { ALL, components, flows } from './frames-system.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// regenerate from scratch so renamed frames never leave stale files behind
for (const d of ['customer', 'merchant', 'staff', 'admin', 'components', 'flows'])
  rmSync(join(here, d), { recursive: true, force: true });
const manifest = [];
const missing = new Set();

// Surface any copy key that is not in the real dictionaries (would render as the raw key).
const origGet = (lang) => dictionaries[lang];
for (const lang of ['en', 'ar']) {
  const d = origGet(lang);
  const handler = { get: (t, k) => { if (typeof k === 'string' && !(k in t) && !(k in dictionaries.en)) missing.add(k); return t[k]; } };
  dictionaries[lang] = new Proxy(d, handler);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

function emit(surface, spec, lang) {
  const size = spec.device === 'desktop' ? DESKTOP : MOBILE;
  const f = frame(size.w, size.h, { lang, name: `${spec.id} ${spec.name}` });
  spec.draw(f);
  const file = `${spec.id}-${slug(spec.name)}${lang === 'ar' ? '-ar' : ''}.svg`;
  const dir = join(here, surface);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), f.toString(), 'utf8');
  manifest.push({ id: spec.id, lang, surface, file: `${surface}/${file}`, w: size.w, h: size.h });
}

for (const [surface, specs] of Object.entries(ALL)) {
  for (const spec of specs) {
    emit(surface, spec, 'en');
    if (spec.rtl) emit(surface, spec, 'ar');
  }
}

for (const c of components) {
  const f = frame(CW(), c.h, { name: `${c.id} ${c.name}`, bg: '#fff' });
  c.draw(f);
  const file = `${c.id}-${slug(c.name)}.svg`;
  mkdirSync(join(here, 'components'), { recursive: true });
  writeFileSync(join(here, 'components', file), f.toString(), 'utf8');
  manifest.push({ id: c.id, lang: 'en', surface: 'components', file: `components/${file}`, w: CW(), h: c.h });
}
function CW() { return 1200; }

// Flow boards
{
  for (const fl of flows) {
    const f = frame(1200, fl.h, { name: `${fl.id} ${fl.name}`, bg: '#fff' });
    const per = 4;
    f.text(24, 40, `${fl.id} ${fl.name}`, { size: 22, weight: 800 });
    fl.steps.forEach((s, i) => {
      const col = i % per, row = Math.floor(i / per);
      const x = 24 + col * 290, y = 90 + row * 250;
      const tones = { info: ['#EEE8FF', '#5B1AFC'], success: ['#E2F7F0', '#0B7A5A'], warning: ['#FEF1D9', '#8A5A00'], danger: ['#FDE8EB', '#B3203A'], neutral: ['#EEF0F8', '#5B5E80'] };
      f.card(x, y, 262, 200, { r: 20 });
      f.circle(x + 28, y + 30, 14, { fill: '#5B1AFC' });
      f.text(x + 28, y + 35, String(i + 1), { size: 13, weight: 800, fill: '#fff', align: 'middle', ltr: true });
      const [bg, col2] = tones[s.tone ?? 'info'];
      f.pill(x + 52, y + 16, s.surface, { fill: bg, color: col2, size: 10 });
      f.text(x + 16, y + 66, s.title, { size: 14, weight: 800 });
      (s.lines ?? []).forEach((l, j) => f.text(x + 16, y + 92 + j * 20, l, { size: 12, fill: '#5B5E80' }));
      f.text(x + 16, y + 186, s.ref ?? '', { size: 10, fill: '#5B1AFC', weight: 700 });
      if (col < per - 1 && i < fl.steps.length - 1) f.text(x + 276, y + 105, '→', { size: 22, weight: 800, fill: '#5B5E80', align: 'middle', ltr: true });
    });
    f.text(24, 90 + Math.ceil(fl.steps.length / per) * 250 + 10, fl.note, { size: 13, fill: '#5B5E80' });
    const file = `${fl.id}-${slug(fl.name)}.svg`;
    mkdirSync(join(here, 'flows'), { recursive: true });
    writeFileSync(join(here, 'flows', file), f.toString(), 'utf8');
    manifest.push({ id: fl.id, lang: 'en', surface: 'flows', file: `flows/${file}`, w: 1200, h: fl.h });
  }
}

// Spec table data for docs generation
const specs = Object.entries(ALL).flatMap(([surface, list]) => list.map((s) => ({ surface, id: s.id, name: s.name, journey: s.journey, device: s.device, rtl: !!s.rtl, figma: s.figma, svg: s.svg, isNew: s.isNew, comps: s.comps, sheets: s.sheets, states: s.states, route: s.route, priority: s.priority, shot: s.shot })));
writeFileSync(join(here, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), files: manifest, screens: specs, components: components.map((c) => ({ id: c.id, name: c.name, items: c.items })), flows: flows.map((x) => ({ id: x.id, name: x.name, steps: x.steps.length })) }, null, 2), 'utf8');

console.log(`SVG files: ${manifest.length}`);
for (const s of ['customer', 'merchant', 'staff', 'admin', 'components', 'flows']) {
  const m = manifest.filter((x) => x.surface === s);
  console.log(`  ${s}: ${m.length} (EN ${m.filter((x) => x.lang === 'en').length}, AR ${m.filter((x) => x.lang === 'ar').length})`);
}
console.log(missing.size ? `MISSING DICTIONARY KEYS (${missing.size}):\n  ` + [...missing].sort().join('\n  ') : 'All copy keys resolved from the real dictionaries.');
