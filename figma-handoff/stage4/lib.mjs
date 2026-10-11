/**
 * Tiny SVG drawing kit for the Stage 4 Figma handoff. Frames are drawn from the SAME design tokens as the app
 * (Figma Files/dealdash-figma/design-tokens.json + packages/ui/src/styles.css) and use the SAME copy as the app
 * (packages/localization dictionaries, English and Arabic), so a frame can never drift from the implementation.
 * RTL frames are true mirrors: positions are given from the START edge and flipped for Arabic; numbers, QR codes and
 * codes stay left-to-right islands.
 */
import { dictionaries } from '../../packages/localization/dist/index.mjs';

export const C = {
  navy: '#0F0C42',
  purple: '#5B1AFC',
  purple2: '#7E4DFF',
  lilac: '#EEE8FF',
  purple50: '#F6F3FF',
  mint: '#1FBF8F',
  amber: '#F5A524',
  red: '#E93A52',
  bg: '#F8F9FD',
  card: '#FFFFFF',
  ink2: '#5B5E80',
  line: '#E3E1F0',
  slate: '#EEF0F8',
  green: '#0B7A5A',
  greenBg: '#E2F7F0',
  warn: '#8A5A00',
  warnBg: '#FEF1D9',
  danger: '#B3203A',
  dangerBg: '#FDE8EB',
  dark: '#0B0A2E',
};

export const tr = (lang, key, vars = {}) => {
  const s = dictionaries[lang][key] ?? dictionaries.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
};
export const T = (lang) => (key, vars) => tr(lang, key, vars);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = "'Plus Jakarta Sans','IBM Plex Sans Arabic',system-ui,sans-serif";

export function frame(w, h, { lang = 'en', bg = C.bg, name = '' } = {}) {
  const rtl = lang === 'ar';
  const els = [];
  const X = (x, wd = 0) => (rtl ? w - x - wd : x);
  let gid = 0;
  const api = {
    w,
    h,
    rtl,
    lang,
    t: T(lang),
    raw: (s) => els.push(s),
    rect(x, y, wd, ht, o = {}) {
      const stroke = o.stroke
        ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"${o.dash ? ' stroke-dasharray="6 4"' : ''}`
        : '';
      const rr = o.r ?? 0;
      els.push(
        `<rect x="${X(x, wd)}" y="${y}" width="${wd}" height="${ht}" rx="${rr}" fill="${o.fill ?? 'none'}"${o.opacity ? ` opacity="${o.opacity}"` : ''}${stroke}/>`,
      );
    },
    circle(cx, cy, r, o = {}) {
      els.push(
        `<circle cx="${rtl ? w - cx : cx}" cy="${cy}" r="${r}" fill="${o.fill ?? 'none'}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1}"` : ''}/>`,
      );
    },
    line(x1, y1, x2, y2, o = {}) {
      els.push(
        `<line x1="${rtl ? w - x1 : x1}" y1="${y1}" x2="${rtl ? w - x2 : x2}" y2="${y2}" stroke="${o.stroke ?? C.line}" stroke-width="${o.sw ?? 1}"${o.dash ? ' stroke-dasharray="6 4"' : ''}/>`,
      );
    },
    /** x is the distance from the START edge (left in LTR, right in RTL). align: start | end | middle. */
    text(x, y, s, o = {}) {
      const align = o.align ?? 'start';
      const ax = rtl ? w - x : x;
      // Physical anchors (no root direction attribute) so browsers and Figma place text identically.
      const anchor = align === 'middle' ? 'middle' : (align === 'start') === !rtl ? 'start' : 'end';
      const ltr = o.ltr ? ' direction="ltr" unicode-bidi="isolate"' : '';
      els.push(
        `<text x="${ax}" y="${y}" font-family="${FONT}" font-size="${o.size ?? 14}" font-weight="${o.weight ?? 500}" fill="${o.fill ?? C.navy}" text-anchor="${anchor}"${ltr}${o.opacity ? ` opacity="${o.opacity}"` : ''}>${esc(s)}</text>`,
      );
    },
    /** Rounded pill with a label; returns its width. */
    pill(x, y, s, o = {}) {
      const size = o.size ?? 12;
      const pad = o.pad ?? 10;
      const wd = Math.ceil(s.length * size * (rtl ? 0.52 : 0.58)) + pad * 2;
      api.rect(x, y, wd, size + 12, { r: (size + 12) / 2, fill: o.fill ?? C.lilac });
      api.text(x + wd / 2, y + size + 2, s, {
        size,
        weight: o.weight ?? 700,
        fill: o.color ?? C.purple,
        align: 'middle',
        ltr: o.ltr,
      });
      return wd;
    },
    button(x, y, wd, ht, s, o = {}) {
      api.rect(x, y, wd, ht, { r: o.r ?? ht / 2, fill: o.fill ?? C.purple, stroke: o.stroke });
      api.text(x + wd / 2, y + ht / 2 + 5, s, {
        size: o.size ?? 15,
        weight: 700,
        fill: o.color ?? '#fff',
        align: 'middle',
      });
    },
    card(x, y, wd, ht, o = {}) {
      api.rect(x, y, wd, ht, { r: o.r ?? 20, fill: o.fill ?? C.card, stroke: o.stroke ?? C.line });
    },
    /** Placeholder photo (gradient). */
    photo(x, y, wd, ht, o = {}) {
      const id = `g${gid++}`;
      const [a, b] = o.colors ?? ['#FF9A6B', '#581845'];
      els.push(
        `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`,
      );
      api.rect(x, y, wd, ht, { r: o.r ?? 0, fill: `url(#${id})` });
    },
    hotGradient(x, y, wd, ht, r) {
      const id = `g${gid++}`;
      els.push(
        `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FF7A1A"/><stop offset="1" stop-color="#E93A52"/></linearGradient></defs>`,
      );
      api.rect(x, y, wd, ht, { r, fill: `url(#${id})` });
    },
    /** Pseudo QR (illustrative: real QR codes are generated by the app). */
    qr(x, y, size) {
      api.rect(x, y, size, size, { r: 8, fill: '#fff' });
      const n = 25;
      const cell = (size - 24) / n;
      let seed = 7;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      let d = '';
      const finder = (r, c) => (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
          if (!finder(r, c) && rnd() > 0.52)
            d += `M${12 + c * cell} ${12 + r * cell}h${cell}v${cell}h-${cell}z`;
      // QR codes never mirror
      els.push(
        `<g transform="translate(${rtl ? w - x - size : x} ${y})"><path d="${d.replace(/M([\d.]+) ([\d.]+)/g, (_, a, b) => `M${a} ${b}`)}" fill="${C.navy}"/></g>`,
      );
      for (const [fr, fc] of [
        [0, 0],
        [0, n - 7],
        [n - 7, 0],
      ]) {
        const fx = (rtl ? w - x - size : x) + 12 + fc * cell;
        const fy = y + 12 + fr * cell;
        els.push(
          `<rect x="${fx}" y="${fy}" width="${7 * cell}" height="${7 * cell}" fill="${C.navy}"/><rect x="${fx + cell}" y="${fy + cell}" width="${5 * cell}" height="${5 * cell}" fill="#fff"/><rect x="${fx + 2 * cell}" y="${fy + 2 * cell}" width="${3 * cell}" height="${3 * cell}" fill="${C.navy}"/>`,
        );
      }
    },
    icon(x, y, kind, o = {}) {
      const s = o.size ?? 20;
      const col = o.color ?? C.navy;
      const cx = x + s / 2;
      const cy = y + s / 2;
      api.circle(cx, cy, s / 2, { fill: o.bg ?? 'none', stroke: o.bg ? undefined : col, sw: 1.6 });
      const glyph =
        {
          check: '✓',
          x: '✕',
          clock: '◔',
          alert: '!',
          pin: '⌖',
          lock: '⚿',
          flame: '♨',
          ticket: '▭',
          wifi: '≈',
          scan: '▣',
          info: 'i',
          cam: '◉',
        }[kind] ?? '•';
      api.text(x + s / 2, y + s / 2 + s * 0.22, glyph, {
        size: s * 0.6,
        weight: 800,
        fill: o.glyph ?? (o.bg ? '#fff' : col),
        align: 'middle',
        ltr: true,
      });
    },
    toString() {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" data-frame="${esc(name)}"><rect width="${w}" height="${h}" fill="${bg}"/>${els.join('')}</svg>`;
    },
  };
  return api;
}

// ---------------------------------------------------------------- shared building blocks
export const MOBILE = { w: 390, h: 844 };
export const DESKTOP = { w: 1440, h: 900 };

export function customerChrome(f, { tab = 'Home', top = true } = {}) {
  const t = f.t;
  if (top) {
    f.text(16, 38, t('brand.name'), { size: 20, weight: 800, fill: C.purple });
    f.circle(MOBILE.w - 100, 30, 18, { fill: '#fff', stroke: C.line });
    f.icon(MOBILE.w - 110, 20, 'ticket', { size: 20 });
    f.pill(MOBILE.w - 70, 18, f.rtl ? 'EN' : 'عربي', { fill: C.slate, color: C.ink2, size: 11 });
  }
  f.rect(0, 770, MOBILE.w, 74, { fill: '#fff', stroke: C.line });
  const tabs = [t('nav.home'), t('nav.explore'), t('nav.profile')];
  tabs.forEach((label, i) => {
    const cx = 65 + i * 130;
    f.circle(cx, 795, 11, {
      fill: label === tab ? C.lilac : 'none',
      stroke: label === tab ? C.purple : C.ink2,
      sw: 1.6,
    });
    f.text(cx, 826, label, {
      size: 11,
      weight: 700,
      fill: label === tab ? C.purple : C.ink2,
      align: 'middle',
    });
  });
}

export function staffChrome(f, active) {
  const t = f.t;
  f.rect(0, 770, MOBILE.w, 74, { fill: '#fff', stroke: C.line });
  [t('nav.scan'), t('nav.history'), t('nav.account')].forEach((label, i) => {
    const cx = 65 + i * 130;
    f.circle(cx, 795, 11, {
      fill: label === active ? C.lilac : 'none',
      stroke: label === active ? C.purple : C.ink2,
      sw: 1.6,
    });
    f.text(cx, 826, label, {
      size: 11,
      weight: 700,
      fill: label === active ? C.purple : C.ink2,
      align: 'middle',
    });
  });
}

export function staffHeader(f, branch = true) {
  f.text(16, 38, f.t('brand.name'), { size: 20, weight: 800, fill: C.purple });
  f.text(16, 56, f.t('app.staff'), { size: 11, fill: C.ink2 });
  if (branch)
    f.pill(MOBILE.w - 150, 18, f.lang === 'ar' ? 'النخيل' : 'Al Nakheel', {
      fill: C.slate,
      color: C.ink2,
      size: 11,
    });
}

export function portalChrome(f, { surface, active, items }) {
  const t = f.t;
  f.rect(0, 0, 240, DESKTOP.h, { fill: '#fff', stroke: C.line });
  f.text(24, 44, t('brand.name'), { size: 22, weight: 800, fill: C.purple });
  f.text(24, 62, surface === 'merchant' ? t('app.merchant') : t('app.admin'), {
    size: 11,
    fill: C.ink2,
  });
  items.forEach((label, i) => {
    const y = 90 + i * 40;
    if (label === active) f.rect(12, y, 216, 34, { r: 10, fill: C.lilac });
    f.text(28, y + 22, label, {
      size: 13,
      weight: label === active ? 800 : 600,
      fill: label === active ? C.purple : C.navy,
    });
  });
  f.rect(240, 0, DESKTOP.w - 240, 64, { fill: '#fff', stroke: C.line });
  f.pill(DESKTOP.w - 440, 18, f.rtl ? 'EN' : 'عربي', { fill: C.slate, color: C.ink2, size: 11 });
  f.text(DESKTOP.w - 470, 40, surface === 'merchant' ? 'Najd Kitchen' : 'Operations', {
    size: 13,
    weight: 700,
    align: 'end',
  });
}

export const MERCHANT_NAV = (t) => [
  t('nav.dashboard'),
  t('nav.profile'),
  t('nav.branches'),
  t('nav.team'),
  t('nav.campaigns'),
  t('nav.redemptions'),
  t('nav.insights'),
  t('nav.finance'),
];
export const ADMIN_NAV = (t) => [
  t('nav.dashboard'),
  t('nav.merchants'),
  t('nav.liveDeals'),
  t('nav.hotDeals'),
  t('nav.reservations'),
  t('nav.organizations'),
  t('nav.customers'),
  t('nav.audit'),
  t('nav.configuration'),
];

export function table(f, x, y, wd, cols, rows, o = {}) {
  const rh = o.rowH ?? 46;
  f.card(x, y, wd, rh * (rows.length + 1) + 8, { r: 16 });
  let cx = x + 16;
  const widths = cols.map((c) => c.w);
  cols.forEach((c, i) => {
    f.text(cx, y + 30, c.label, {
      size: 11,
      weight: 800,
      fill: C.ink2,
      align: c.num ? 'start' : 'start',
    });
    cx += widths[i];
  });
  rows.forEach((r, ri) => {
    const ry = y + rh * (ri + 1);
    f.line(x + 12, ry, x + wd - 12, ry);
    let rx = x + 16;
    r.forEach((cell, i) => {
      if (cell && typeof cell === 'object') {
        f.pill(rx, ry + 10, cell.label, { fill: cell.fill, color: cell.color, size: 11 });
      } else
        f.text(rx, ry + 29, String(cell), {
          size: 13,
          weight: i === 0 ? 700 : 500,
          ltr: /^[\d/ .:%…-]+$/.test(String(cell)),
        });
      rx += widths[i];
    });
  });
}

export const TONES = {
  success: { fill: C.greenBg, color: C.green },
  warning: { fill: C.warnBg, color: C.warn },
  danger: { fill: C.dangerBg, color: C.danger },
  info: { fill: C.lilac, color: C.purple },
  neutral: { fill: C.slate, color: C.ink2 },
};
export const chip = (label, tone) => ({ label, ...TONES[tone] });

export function kpi(f, x, y, wd, value, label) {
  f.card(x, y, wd, 78, { r: 16 });
  f.text(x + 16, y + 40, String(value), { size: 26, weight: 800, ltr: true });
  f.text(x + 16, y + 62, label, { size: 12, weight: 700, fill: C.ink2 });
}

export function tabs(f, x, y, labels, active) {
  let cx = x;
  labels.forEach((l, i) => {
    const wd = Math.ceil(l.length * 7.2) + 28;
    f.text(cx + wd / 2, y + 20, l, {
      size: 13,
      weight: i === active ? 800 : 600,
      fill: i === active ? C.purple : C.ink2,
      align: 'middle',
    });
    if (i === active) f.rect(cx, y + 30, wd, 3, { r: 2, fill: C.purple });
    cx += wd;
  });
  f.line(x, y + 33, x + 760, y + 33);
}
