/**
 * Lists and extracts the photographs embedded in the approved customer UI package (Figma Files/dealdash-figma/svg/*.svg, base64
 * data URIs), de-duplicated by content hash, so the customer app can reuse the approved imagery instead of new stock.
 *
 *   node tooling/design/extract-figma-images.mjs [outDir=.tools/brand-extract]
 *   node tooling/design/extract-figma-images.mjs --publish      (writes the PUBLISHABLE set below to apps/customer/public/brand)
 *
 * Writes <outDir>/<hash>.<ext> and <outDir>/index.json ({ hash: { bytes, ext, screens: [...] } }). Nothing else is touched.
 *
 * Only brand-free images are publishable. Mock-up images that show a real third-party trademark (restaurant, coffee, retail,
 * electronics and sportswear logos) and flattened banners with baked-in text are NEVER published: the customer app must not imply
 * a partnership or a merchant that does not exist.
 */
const PUBLISHABLE = {
  '6ad8ecbca0c8': 'hero-dining.jpg', // plated dish, warm restaurant light (650x280)
  '950481d94d0f': 'dish.jpg',
  '062b2902c5bd': 'ambience-1.jpg', // restaurant interiors
  bfe417677b3f: 'ambience-2.jpg',
  '7c8af8c262d7': 'ambience-3.jpg',
  '3712d31ba592': 'cat-dining.jpg', // product cut-outs used by the approved category tiles
  f27d3fa3ab4a: 'cat-cafes.jpg',
  '95d52cf9b6a9': 'cat-shopping.jpg',
  c9450d9e7ec9: 'cat-groceries.jpg',
  fa1fcb4a8199: 'cat-electronics.jpg',
  '63e177838abd': 'cat-fashion.jpg',
};
const publish = process.argv.includes('--publish');
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'Figma Files', 'dealdash-figma', 'svg');
const OUT =
  (!publish && process.argv[2]) || join(process.cwd(), '.tools', 'brand-extract');
const PUBLISH_DIR = join(process.cwd(), 'apps', 'customer', 'public', 'brand');
mkdirSync(OUT, { recursive: true });

const index = {};
const re = /data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)/g;
for (const f of readdirSync(SRC).filter((x) => x.endsWith('.svg')).sort()) {
  const svg = readFileSync(join(SRC, f), 'utf8');
  for (const m of svg.matchAll(re)) {
    const buf = Buffer.from(m[2], 'base64');
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    if (!index[hash]) {
      index[hash] = { bytes: buf.length, ext, screens: [] };
      writeFileSync(join(OUT, `${hash}.${ext}`), buf);
      if (publish && PUBLISHABLE[hash]) {
        mkdirSync(PUBLISH_DIR, { recursive: true });
        writeFileSync(join(PUBLISH_DIR, PUBLISHABLE[hash]), buf);
      }
    }
    if (!index[hash].screens.includes(f)) index[hash].screens.push(f);
  }
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2));
const rows = Object.entries(index).sort((a, b) => b[1].screens.length - a[1].screens.length);
console.log(`${rows.length} unique images -> ${OUT}`);
for (const [h, v] of rows)
  console.log(`${h}.${v.ext}  ${(v.bytes / 1024).toFixed(0)} KB  ${v.screens.length} screens  e.g. ${v.screens.slice(0, 3).join(', ')}`);
