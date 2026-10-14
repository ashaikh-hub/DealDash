/**
 * Brand-safe category artwork for cards without merchant media (original vector art: brand gradients, soft shapes and the app's own
 * category icons; no photographs, no third-party marks). Writes apps/customer/public/brand/art-<category>.svg.
 *
 *   node tooling/design/make-category-art.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'apps', 'customer', 'public', 'brand');
mkdirSync(OUT, { recursive: true });

// icon paths: the app's category icons (packages/app-shell/src/deals/icons.tsx), 24px grid
const ICON = {
  dining: '<path d="M6 3v8a2 2 0 0 0 2 2v8M10 3v8a2 2 0 0 1-2 2M18 3c-2 2-3 5-3 8h3v10"/>',
  cafes: '<path d="M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 9h2a2 2 0 0 1 0 4h-2M7 3v2M11 3v2"/>',
  shopping: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  beauty: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  entertainment:
    '<path d="M4 8a2 2 0 0 0 0 4 2 2 0 0 0 0 4v2h16v-2a2 2 0 0 1 0-4 2 2 0 0 1 0-4V6H4zM13 6v12"/>',
  services: '<path d="M14 6a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0-2-2z"/>',
  fitness: '<path d="M6 8v8M9 6v12M15 6v12M18 8v8M9 12h6M3 10v4M21 10v4"/>',
  other:
    '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
};

const ART = {
  dining: ['#FF8A5B', '#C2410C', ICON.dining],
  cafes: ['#C99266', '#6B3E26', ICON.cafes],
  shopping: ['#FFB347', '#E8590C', ICON.shopping],
  beauty_wellness: ['#F472B6', '#9D4EDD', ICON.beauty],
  entertainment: ['#FFC23D', '#F06A00', ICON.entertainment],
  services: ['#38BDF8', '#2563EB', ICON.services],
  fitness: ['#2FD3A2', '#0E7C66', ICON.fitness],
  other: ['#7E4DFF', '#2B1F7A', ICON.other],
};

const dots = () => {
  let s = '';
  for (let y = 24; y < 400; y += 28) for (let x = 24; x < 640; x += 28) s += `<circle cx="${x}" cy="${y}" r="1.4"/>`;
  return s;
};

function card(from, to, icon, extra = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" preserveAspectRatio="xMidYMid slice">
<defs>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>
<radialGradient id="l" cx="0.78" cy="0.18" r="0.6"><stop offset="0" stop-color="#fff" stop-opacity="0.38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="640" height="400" fill="url(#g)"/>
<rect width="640" height="400" fill="url(#l)"/>
<g fill="#fff" opacity="0.10">${dots()}</g>
<circle cx="560" cy="360" r="170" fill="#fff" opacity="0.08"/>
<circle cx="70" cy="40" r="110" fill="#fff" opacity="0.07"/>
${extra}
<g transform="translate(212 92) scale(9)" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.92">${icon}</g>
</svg>
`;
}

for (const [code, [from, to, icon]] of Object.entries(ART))
  writeFileSync(join(OUT, `art-${code}.svg`), card(from, to, icon));

// Watch & Earn: navy video art (play button, sound-wave bars) so video cards are recognisable at a glance
const bars = [40, 70, 110, 80, 130, 95, 60, 120, 85, 50, 100, 70, 45]
  .map((h, i) => `<rect x="${92 + i * 36}" y="${330 - h}" width="14" height="${h}" rx="7"/>`)
  .join('');
writeFileSync(
  join(OUT, 'art-watch.svg'),
  card(
    '#4B2BD6',
    '#0F0C42',
    '<circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4z" fill="#fff"/>',
    `<g fill="#fff" opacity="0.14">${bars}</g>`,
  ),
);
console.log(`category art -> ${OUT}`);
