/**
 * Read-only audit of what the customer Home shows (public endpoints only, no sign-in): per card, the title, whether it has
 * merchant media, and whether that media is a development seed placeholder (storage key `.../seed-*`, decoded from the signed
 * development download token). Nothing is written.
 *
 *   node tooling/e2e/customer-feed-audit.mjs [city=Riyadh]
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const city = process.argv[2] ?? 'Riyadh';
const get = async (p) => (await (await fetch(`${API}${p}`)).json()).data;

const media = (url) => {
  if (!url) return 'NONE';
  const token = url.split('/v1/storage/download/')[1];
  if (!token) return 'URL';
  try {
    const body = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'));
    return /\/seed-/.test(body.key ?? '') ? 'SEED-PLACEHOLDER' : 'UPLOAD';
  } catch {
    return 'URL';
  }
};
const title = (t) => (typeof t === 'string' ? t : (t?.en ?? ''));
const show = (label, rows, pick) => {
  console.log(`\n== ${label} (${rows.length})`);
  for (const r of rows) console.log(`  ${media(pick(r)).padEnd(16)} ${title(r.title)}`);
};

const home = await get(`/v1/app/home?city=${encodeURIComponent(city)}`);
show('home.liveNow', home.liveNow, (d) => d.imageUrl);
show('home.nearYou', home.nearYou, (d) => d.imageUrl);
show('home.endingSoon', home.endingSoon, (d) => d.imageUrl);
const ids = (xs) => new Set(xs.map((d) => d.id));
const near = ids(home.nearYou);
console.log(
  `\noverlap: liveNow∩nearYou=${home.liveNow.filter((d) => near.has(d.id)).length}, endingSoon∩nearYou=${home.endingSoon.filter((d) => near.has(d.id)).length}`,
);
show('hot-deals', await get(`/v1/app/hot-deals?city=${encodeURIComponent(city)}&limit=10`), (d) => d.imageUrl);
show('vouchers', await get(`/v1/app/vouchers?city=${encodeURIComponent(city)}&limit=10`), (d) => d.imageUrl);
const hub = await get(`/v1/app/watch?city=${encodeURIComponent(city)}`);
show('watch', hub?.campaigns ?? [], (c) => c.thumbnailUrl);
