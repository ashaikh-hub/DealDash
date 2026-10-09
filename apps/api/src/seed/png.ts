import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export type Rgb = [number, number, number];

/**
 * Generates a PNG (no image library): a diagonal gradient with soft circles and a darker lower third, so development
 * data looks like a designed card instead of a flat rectangle. Placeholder imagery only; never real merchant photos.
 */
export function makeDevImagePng(
  width: number,
  height: number,
  from: Rgb,
  to: Rgb,
  seed = 1,
): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  const circles = [0, 1, 2].map((i) => ({
    x: (((seed * 37 + i * 211) % 100) / 100) * width,
    y: (((seed * 53 + i * 97) % 100) / 100) * height * 0.8,
    r: (0.16 + ((seed + i) % 3) * 0.07) * width,
  }));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const t = (x / width + y / height) / 2;
      let r = from[0] + (to[0] - from[0]) * t;
      let g = from[1] + (to[1] - from[1]) * t;
      let b = from[2] + (to[2] - from[2]) * t;
      for (const c of circles) {
        const d = Math.hypot(x - c.x, y - c.y);
        if (d < c.r) {
          const k = 0.18 * (1 - d / c.r);
          r += (255 - r) * k;
          g += (255 - g) * k;
          b += (255 - b) * k;
        }
      }
      if (y > height * 0.62) {
        const k = ((y - height * 0.62) / (height * 0.38)) * 0.45;
        r *= 1 - k;
        g *= 1 - k;
        b *= 1 - k;
      }
      raw[o++] = Math.max(0, Math.min(255, Math.round(r)));
      raw[o++] = Math.max(0, Math.min(255, Math.round(g)));
      raw[o++] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
