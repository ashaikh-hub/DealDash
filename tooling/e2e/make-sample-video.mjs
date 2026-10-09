// Generates the small sample campaign video used by the development seed and the browser QA (no ffmpeg needed).
// Usage: node tooling/e2e/make-sample-video.mjs <output.webm> [seconds]
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const out = process.argv[2];
const secs = Number(process.argv[3] || 12);
if (!out) {
  console.error('usage: node make-sample-video.mjs <output.webm> [seconds]');
  process.exit(1);
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const b64 = await page.evaluate(async (seconds) => {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const ctx = c.getContext('2d');
  const stream = c.captureStream(15);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 150000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(500);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      ctx.fillStyle = `hsl(${(t * 40) % 360},60%,45%)`;
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText('DealDash sample', 40, 90);
      ctx.fillText(t.toFixed(1) + ' s', 40, 130);
      if (t < seconds) requestAnimationFrame(draw);
      else resolve();
    };
    draw();
  });
  rec.stop();
  await done;
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}, secs);
const data = Buffer.from(b64, 'base64');
writeFileSync(out, data);
await browser.close();
console.log('written', out, data.length, 'bytes');
