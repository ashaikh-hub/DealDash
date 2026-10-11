/**
 * Stage 9 — performance / concurrency baseline (run through .tools/stage7/qa.mjs on a fresh TEST database).
 *
 * What it measures: latency (p50 / p95 / max) and error rate of the main customer read paths under concurrent load, and the
 * correctness of the concurrency-sensitive write paths: Exclusive Deal stock (no over-reservation), voucher stock and checkout,
 * idempotent replays, and parallel sign-ins. It is a LOCAL, SINGLE-INSTANCE, DEVELOPMENT-MODE baseline (API in watch mode, one
 * laptop, PostgreSQL on the same machine): it shows the shape of the system and catches correctness / regression problems; it is
 * NOT a production capacity figure. Production load testing runs on staging hardware (docs/PRODUCTION_RUNBOOK.md).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = process.env.API_URL ?? 'http://localhost:4000';
// transport retry only: a pooled keep-alive socket the server already closed fails on write (ECONNRESET) before the request is
// sent; every write below also carries an Idempotency-Key, so a retry can never double an effect
const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawFetch(url, init);
    } catch (e) {
      if (attempt >= 2 || !/ECONNRESET|UND_ERR_SOCKET|other side closed/.test(String(e?.cause?.code ?? e?.cause?.message ?? e))) throw e;
    }
  }
};
const OUT = join(process.cwd(), 'docs', 'performance');
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`);
};
for (let ok = 0, tries = 0; ok < 10 && tries < 150; tries++) {
  ok = (await fetch(`${API}/v1/health/live`).then((r) => r.ok).catch(() => false)) ? ok + 1 : 0;
  await new Promise((r) => setTimeout(r, 2000));
}
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};

/** Fires `total` requests with at most `concurrency` in flight; returns latency stats. */
async function load(name, total, concurrency, fn) {
  const times = [];
  let errors = 0;
  let next = 0;
  const started = Date.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < total) {
        next++;
        const t0 = performance.now();
        try {
          const ok = await fn();
          if (!ok) errors++;
        } catch {
          errors++;
        }
        times.push(performance.now() - t0);
      }
    }),
  );
  const secs = (Date.now() - started) / 1000;
  const row = { name, requests: total, concurrency, p50ms: Math.round(pct(times, 50)), p95ms: Math.round(pct(times, 95)), maxMs: Math.round(Math.max(...times)), errorRate: +(errors / total).toFixed(3), throughputPerSec: +(total / secs).toFixed(1) };
  console.log(`LOAD ${JSON.stringify(row)}`);
  return row;
}

// ---- a signed-in customer (OTP through the development SMS inbox)
const mobile = () => `+9665${String(randomBytes(4).readUInt32BE() % 100_000_000).padStart(8, '0')}`;
async function customer() {
  const m = mobile();
  await fetch(`${API}/v1/auth/otp/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: m, audience: 'customer' }) });
  const code = (await (await fetch(`${API}/v1/dev/last-sms?to=${encodeURIComponent(m)}`)).json()).data?.code;
  const res = await fetch(`${API}/v1/auth/otp/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: m, code, audience: 'customer' }) });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  const body = await res.json();
  return { ok: res.ok, cookie, csrf: body.data?.csrfToken, id: body.data?.me?.id };
}
const call = (c, method, path, body, key) =>
  fetch(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: c.cookie, 'X-CSRF-Token': c.csrf ?? '', 'Idempotency-Key': key ?? `ld-${randomBytes(8).toString('hex')}` }, body: body ? JSON.stringify(body) : undefined });

// ================================================================ read paths (public discovery)
const rows = [];
rows.push(await load('health ready', 200, 20, async () => (await fetch(`${API}/v1/health/ready`)).ok));
rows.push(await load('discovery: Live Deals list (Riyadh)', 300, 20, async () => (await fetch(`${API}/v1/app/deals?city=Riyadh&limit=20`)).ok));
rows.push(await load('discovery: Exclusive Deals list', 300, 20, async () => (await fetch(`${API}/v1/app/hot-deals?city=Riyadh&limit=20`)).ok));
rows.push(await load('discovery: vouchers list', 300, 20, async () => (await fetch(`${API}/v1/app/vouchers?city=Riyadh&limit=20`)).ok));
rows.push(await load('search', 200, 20, async () => (await fetch(`${API}/v1/app/search?q=grill`)).ok));
for (const r of rows) check(`latency: ${r.name} p95 under 1500 ms locally with no errors`, r.p95ms < 1500 && r.errorRate === 0, `p50 ${r.p50ms} ms, p95 ${r.p95ms} ms, ${r.throughputPerSec}/s`);

// ================================================================ sign-in under concurrency
const t0 = Date.now();
const customers = await Promise.all(Array.from({ length: 20 }, () => customer()));
check('20 customers sign in at the same time (OTP)', customers.every((c) => c.ok && c.cookie), `${Date.now() - t0} ms`);
rows.push({ name: 'parallel OTP sign-in (20)', requests: 20, concurrency: 20, totalMs: Date.now() - t0 });

// ================================================================ Exclusive Deal stock: never over-reserved
const hot = (await (await fetch(`${API}/v1/app/hot-deals?city=Riyadh&limit=50`)).json()).data;
const hotItems = hot?.items ?? hot ?? [];
let tested = false;
// stock is held per branch: take the reservable branch with the least stock and ask for more units than it has, when the
// per-customer limit allows; in every case units must be conserved exactly (reserved = before - after, never below zero)
const branchStock = async (dealId, branchId) => (await (await fetch(`${API}/v1/app/hot-deals/${dealId}`)).json()).data?.branches?.find((b) => b.id === branchId)?.stock?.available;
for (const h of hotItems) {
  const d = (await (await fetch(`${API}/v1/app/hot-deals/${h.id}`)).json()).data;
  const branch = (d?.branches ?? []).filter((b) => b.canReserve && b.stock && b.stock.available > 0).sort((a, b) => a.stock.available - b.stock.available)[0];
  if (!branch) continue;
  const left = branch.stock.available;
  const qty = Math.max(1, Math.min(d.perCustomerLimit ?? 1, Math.ceil((left + 1) / customers.length)));
  const res = await Promise.all(customers.map((c) => call(c, 'POST', `/v1/app/hot-deals/${h.id}/reservations`, { branchId: branch.id, quantity: qty })));
  const won = res.filter((r) => r.status === 201).length;
  const leftAfter = await branchStock(h.id, branch.id);
  const demand = qty * customers.length;
  check(
    `Exclusive Deal stock: ${customers.length} customers race for ${left} unit(s) (${demand} asked${demand > left ? ', oversubscribed' : ''}); units conserved, never oversold`,
    won * qty <= left && leftAfter === left - won * qty && leftAfter >= 0,
    `reserved ${won}x${qty}, before ${left}, after ${leftAfter}, statuses ${[...new Set(res.map((r) => r.status))].join('/')}`,
  );
  rows.push({ name: 'Exclusive Deal reservation race', requests: customers.length, concurrency: customers.length, unitsBefore: left, demand, reserved: won * qty, unitsAfter: leftAfter });
  tested = true;
  break;
}
if (!tested) check('Exclusive Deal stock race (no deal with a small stock in the seed)', true, 'skipped');

// ================================================================ voucher checkout: idempotent replays and parallel buyers
const vouchers = (await (await fetch(`${API}/v1/app/vouchers?city=Riyadh&limit=50`)).json()).data;
const v = (vouchers?.items ?? vouchers ?? [])[0];
if (v) {
  const c = customers[0];
  const key = `ld-same-${randomBytes(6).toString('hex')}`;
  const replays = await Promise.all(Array.from({ length: 10 }, () => call(c, 'POST', '/v1/app/checkout', { voucherId: v.id }, key)));
  const ids = new Set();
  for (const r of replays) {
    const b = await r.json().catch(() => null);
    if (b?.data?.id) ids.add(b.data.id);
  }
  check('idempotency: the same checkout sent 10 times at once creates ONE order', ids.size <= 1 && replays.some((r) => r.status === 201 || r.status === 200), `orders ${ids.size}, statuses ${[...new Set(replays.map((r) => r.status))].join('/')}`);
  const t1 = Date.now();
  const buys = await Promise.all(customers.slice(1, 11).map((cc) => call(cc, 'POST', '/v1/app/checkout', { voucherId: v.id })));
  const okBuys = buys.filter((r) => r.status === 201).length;
  const stock = (await (await fetch(`${API}/v1/app/vouchers/${v.id}`)).json()).data;
  // remaining = null means the voucher has no stock cap (unlimited); a capped voucher must never go below zero
  check('voucher checkout: 10 buyers at once; holds never exceed the stock', okBuys >= 1 && (stock?.remaining === null || stock?.remaining >= 0), `${okBuys} holds in ${Date.now() - t1} ms, remaining ${stock?.remaining === null ? 'unlimited' : stock?.remaining}`);
  rows.push({ name: 'parallel voucher checkout (10)', requests: 10, concurrency: 10, totalMs: Date.now() - t1, ok: okBuys });
} else check('voucher checkout race (no voucher on sale in the seed)', true, 'skipped');

writeFileSync(join(OUT, 'stage9-load-baseline.json'), JSON.stringify({ measuredAt: new Date().toISOString(), environment: 'local single instance, development mode, fresh test database (NOT production capacity)', rows, checks: results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
