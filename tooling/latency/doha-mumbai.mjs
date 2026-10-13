/**
 * Launch readiness (founder decision 2): Doha (me-central1) vs Mumbai (asia-south1) latency from PAKISTANI networks, with Dammam
 * (me-central2) as the KSA reference. Real measurements only — nothing is estimated or filled in.
 *
 * Source: Globalping (free public probe network, no account) probes located in Pakistan, against Google's official per-region
 * latency endpoints (gcping: a minimal Cloud Run service in each region, https://global.gcping.com). For each probe and region:
 *   - HTTPS GET timings: DNS, TCP connect, TLS, time to first byte (includes the trip to the REGION), total;
 *   - repeated rounds -> stability (spread) and failures;
 *   - ICMP ping to the endpoint host -> packet loss / RTT to Google's nearest edge (anycast front end, NOT the region).
 * Cloud Run hosts are served through Google's global front ends, so DNS / TCP / TLS mostly reflect the nearest Google edge and the
 * region difference shows in first-byte and total time — exactly what a Cloud Run deployment would give users.
 *
 * Limits: probes are fixed-line / ISP / data-centre networks; Pakistani MOBILE carriers (Jazz, Zong, Telenor, Ufone) are only
 * covered if Globalping has probes there at run time — otherwise that part of the test plan needs real devices (see the doc).
 *
 *   node tooling/latency/doha-mumbai.mjs [--rounds 3]
 * Writes docs/performance/latency-doha-mumbai-<date>.json and .md
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROUNDS = Number(process.argv[process.argv.indexOf('--rounds') + 1]) || 3;
const REGIONS = { 'me-central1': 'Doha', 'asia-south1': 'Mumbai', 'me-central2': 'Dammam (KSA reference)' };
const GP = 'https://api.globalping.io/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const endpoints = await (await fetch('https://global.gcping.com/api/endpoints')).json();
const probes = (await (await fetch(`${GP}/probes`)).json()).filter((p) => p.location.country === 'PK');
if (!probes.length) throw new Error('No Globalping probes in Pakistan right now');
console.log(`${probes.length} probes in Pakistan`);

async function measure(body) {
  const res = await fetch(`${GP}/measurements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 429) throw new Error('Globalping rate limit reached — rerun later or with fewer rounds');
  if (!res.ok) throw new Error(`Globalping refused the measurement (${res.status}): ${await res.text()}`);
  const { id } = await res.json();
  for (let i = 0; i < 60; i++) {
    await sleep(1500);
    const m = await (await fetch(`${GP}/measurements/${id}`)).json();
    if (m.status !== 'in-progress') return m;
  }
  throw new Error(`measurement ${id} did not finish`);
}

const rows = [];
for (let round = 1; round <= ROUNDS; round++) {
  for (const [region, label] of Object.entries(REGIONS)) {
    const url = new URL(endpoints[region].URL);
    const m = await measure({
      type: 'http',
      target: url.host,
      locations: [{ country: 'PK' }],
      limit: probes.length,
      measurementOptions: { protocol: 'HTTPS', request: { method: 'GET', path: '/api/ping' } },
    });
    for (const r of m.results) {
      const t = r.result.timings ?? {};
      rows.push({
        round, region, label,
        probe: `${r.probe.city} | ${r.probe.network} (AS${r.probe.asn})`,
        status: r.result.status === 'finished' ? r.result.statusCode : r.result.status,
        dns: t.dns ?? null, tcp: t.tcp ?? null, tls: t.tls ?? null, firstByte: t.firstByte ?? null, total: t.total ?? null,
      });
    }
    console.log(`round ${round} ${label}: ${m.results.length} probes`);
  }
}

const loss = [];
for (const [region, label] of Object.entries(REGIONS)) {
  const host = new URL(endpoints[region].URL).host;
  const m = await measure({ type: 'ping', target: host, locations: [{ country: 'PK' }], limit: probes.length, measurementOptions: { packets: 16 } });
  for (const r of m.results)
    loss.push({ region, label, probe: `${r.probe.city} | ${r.probe.network} (AS${r.probe.asn})`, avgMs: r.result.stats?.avg ?? null, lossPct: r.result.stats?.loss ?? null });
}

const med = (a) => {
  const s = a.filter((x) => typeof x === 'number').sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const p90 = (a) => {
  const s = a.filter((x) => typeof x === 'number').sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : null;
};
const summary = Object.entries(REGIONS).map(([region, label]) => {
  const r = rows.filter((x) => x.region === region);
  const ok = r.filter((x) => x.status === 200);
  const l = loss.filter((x) => x.region === region);
  return {
    region, label, samples: r.length, failures: r.length - ok.length,
    medianDns: med(ok.map((x) => x.dns)), medianTcp: med(ok.map((x) => x.tcp)), medianTls: med(ok.map((x) => x.tls)),
    medianFirstByte: med(ok.map((x) => x.firstByte)), p90FirstByte: p90(ok.map((x) => x.firstByte)),
    medianTotal: med(ok.map((x) => x.total)), p90Total: p90(ok.map((x) => x.total)),
    medianEdgePingMs: med(l.map((x) => x.avgMs)), maxEdgeLossPct: Math.max(0, ...l.map((x) => x.lossPct ?? 0)),
  };
});

const date = new Date().toISOString().slice(0, 10);
const dir = join(process.cwd(), 'docs', 'performance');
mkdirSync(dir, { recursive: true });
const meta = { measuredAt: new Date().toISOString(), source: 'Globalping probes in Pakistan -> gcping per-region endpoints', rounds: ROUNDS, probes: probes.map((p) => `${p.location.city} | ${p.location.network} (AS${p.location.asn})`) };
writeFileSync(join(dir, `latency-doha-mumbai-${date}.json`), JSON.stringify({ ...meta, summary, rows, loss }, null, 2));
const md = [
  `# Doha vs Mumbai latency from Pakistan — ${date}`,
  '',
  `Real measurements: ${meta.source}, ${ROUNDS} rounds, ${probes.length} probes (fixed-line / ISP / data-centre networks; no mobile carriers unless listed).`,
  'First byte and total include the trip to the region; DNS / TCP / TLS mostly reflect Google\'s nearest edge. Ping = Google edge, not region.',
  '',
  '| Region | Samples | Failures | DNS | TCP | TLS | First byte (median / p90) | Total (median / p90) | Edge ping | Max loss |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...summary.map((s) => `| ${s.label} (${s.region}) | ${s.samples} | ${s.failures} | ${s.medianDns} ms | ${s.medianTcp} ms | ${s.medianTls} ms | ${s.medianFirstByte} / ${s.p90FirstByte} ms | ${s.medianTotal} / ${s.p90Total} ms | ${s.medianEdgePingMs} ms | ${s.maxEdgeLossPct}% |`),
  '',
  '## Probes',
  ...meta.probes.map((p) => `- ${p}`),
  '',
].join('\n');
writeFileSync(join(dir, `latency-doha-mumbai-${date}.md`), md);
console.log(md);
