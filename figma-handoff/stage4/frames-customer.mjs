import { C, MOBILE, customerChrome, TONES } from './lib.mjs';

const W = MOBILE.w;
const cd = (f, tone) =>
  ({ calm: C.ink2, soon: C.warn, urgent: C.danger, over: C.ink2 })[tone] ?? C.ink2;

/** Exclusive Deal card, list variant (112px photo + body). */
function listCard(f, y, o = {}) {
  const t = f.t;
  const L = f.lang === 'ar';
  f.card(16, y, W - 32, 132, { r: 20 });
  f.photo(16, y, 112, 132, { r: 20, colors: o.colors });
  f.hotGradient(24, y + 10, 52, 22, 11);
  f.text(50, y + 25, t('hot.badge'), { size: 10, weight: 800, fill: '#fff', align: 'middle' });
  f.pill(24, y + 98, L ? 'خصم 40%' : '40% off', { fill: C.purple, color: '#fff', size: 11 });
  if (o.sold) f.pill(24, y + 10, t('hot.soldOut'), { fill: C.warnBg, color: C.warn, size: 11 });
  f.text(
    140,
    y + 28,
    o.title ?? (L ? 'ذروة الغداء: خصم 40% على الكبسة' : 'Lunch rush: 40% off kabsa'),
    { size: 14, weight: 800 },
  );
  f.text(140, y + 48, o.merchant ?? (L ? 'نجد كيتشن' : 'Najd Kitchen'), { size: 12, fill: C.ink2 });
  let cx = 140;
  if (!o.sold) {
    cx +=
      f.pill(cx, y + 62, o.time ?? (L ? '2 س 15 د' : '2h 15m'), {
        fill: o.timeFill ?? C.warnBg,
        color: o.timeColor ?? C.warn,
        size: 11,
        ltr: true,
      }) + 6;
    if (o.left !== null && o.left !== undefined)
      f.pill(
        cx,
        y + 62,
        o.left <= 5 ? t('hot.onlyLeft', { n: o.left }) : t('hot.left', { n: o.left }),
        { fill: C.dangerBg, color: C.danger, size: 11 },
      );
  }
  f.text(140, y + 112, '⌖ 640 ' + (L ? 'م' : 'm'), { size: 11, fill: C.ink2, ltr: true });
  if (o.locked) {
    f.rect(140, y + 92, 200, 0, {});
    f.pill(W - 110, y + 94, '⚿ ' + t('elig.locked'), { fill: '#fff', color: C.navy, size: 10 });
  }
}

function carousel(f, x, y, o = {}) {
  const t = f.t;
  f.card(x, y, 224, 226, { r: 20 });
  f.photo(x, y, 224, 140, { r: 20 });
  f.hotGradient(x + 10, y + 10, 52, 22, 11);
  f.text(x + 36, y + 25, t('hot.badge'), { size: 10, weight: 800, fill: '#fff', align: 'middle' });
  f.pill(x + 10, y + 106, f.lang === 'ar' ? 'خصم 40%' : '40% off', {
    fill: C.purple,
    color: '#fff',
    size: 11,
  });
  f.text(
    x + 14,
    y + 166,
    o.title ?? (f.lang === 'ar' ? 'طبق عائلي بخصم 40%' : 'Family platter 40% off'),
    { size: 14, weight: 800 },
  );
  f.text(x + 14, y + 186, f.lang === 'ar' ? 'نجد كيتشن' : 'Najd Kitchen', {
    size: 12,
    fill: C.ink2,
  });
  const w1 = f.pill(x + 14, y + 194, '2h 15m', {
    fill: C.warnBg,
    color: C.warn,
    size: 11,
    ltr: true,
  });
  f.pill(x + 20 + w1, y + 194, t('hot.onlyLeft', { n: 3 }), {
    fill: C.dangerBg,
    color: C.danger,
    size: 11,
  });
}

function header(f, title, back = true) {
  if (back) f.icon(16, 20, 'x', { size: 22, bg: 'rgba(15,12,66,.55)' });
  f.text(W / 2, 38, title, { size: 16, weight: 800, align: 'middle' });
}

function detailBase(f, o = {}) {
  const t = f.t;
  const L = f.lang === 'ar';
  f.photo(0, 0, W, 280, { colors: ['#FFB27A', '#581845'] });
  f.icon(16, 20, 'x', { size: 34, bg: 'rgba(15,12,66,.6)' });
  f.text(20, 236, L ? 'نجد كيتشن' : 'Najd Kitchen', { size: 26, weight: 800, fill: '#fff' });
  f.text(20, 258, L ? 'المطاعم · النخيل · 640 م' : 'Dining · Al Nakheel · 640 m', {
    size: 12,
    fill: '#fff',
  });
  f.card(16, 256, W - 32, o.sheetH ?? 330, { r: 24 });
  f.text(36, 296, L ? 'خصم 40%' : '40% off', { size: 32, weight: 800, fill: C.purple });
  f.hotGradient(W - 36 - 54, 274, 54, 22, 11);
  f.text(W - 36 - 27, 289, t('hot.badge'), {
    size: 10,
    weight: 800,
    fill: '#fff',
    align: 'middle',
  });
  f.text(36, 322, L ? 'ذروة الغداء: خصم 40% على الكبسة' : 'Lunch rush: 40% off kabsa', {
    size: 15,
    weight: 700,
  });
  f.text(36, 342, L ? 'طبق عائلي اليوم' : 'Family platter today', { size: 12, fill: C.ink2 });
  // urgency strip
  const sold = o.state === 'sold';
  f.rect(36, 356, W - 72, 62, { r: 16, fill: sold || o.state === 'ended' ? C.slate : C.warnBg });
  f.text(
    50,
    376,
    sold ? t('hot.soldOut') : o.state === 'ended' ? t('hot.ended') : t('res.timeLeft'),
    { size: 11, fill: C.ink2 },
  );
  const tone = o.tone ?? 'soon';
  f.text(50, 405, sold || o.state === 'ended' ? '—' : (o.time ?? (L ? '2 س 15 د' : '2h 15m')), {
    size: 22,
    weight: 800,
    fill: cd(f, tone),
    ltr: true,
  });
  if (!sold && o.state !== 'ended') {
    f.text(170, 376, t('mm.available'), { size: 11, fill: C.ink2 });
    f.text(170, 405, String(o.left ?? 5), { size: 22, weight: 800, ltr: true });
    f.text(260, 376, t('res.holdWord'), { size: 11, fill: C.ink2 });
    f.text(260, 405, t('res.minutes', { n: 30 }), { size: 18, weight: 800 });
  }
  let x = 36;
  x += f.pill(x, 430, t('hot.free'), { fill: C.greenBg, color: C.green, size: 11 }) + 6;
  f.pill(x, 430, t('elig.PUBLIC'), { fill: C.lilac, color: C.purple, size: 11 });
  f.text(36, 486, t('hot.howTitle'), { size: 13, weight: 800 });
  [1, 2, 3].forEach((n, i) => {
    f.circle(48, 508 + i * 26, 10, { fill: C.lilac });
    f.text(48, 512 + i * 26, String(n), {
      size: 11,
      weight: 800,
      fill: C.purple,
      align: 'middle',
      ltr: true,
    });
    f.text(68, 512 + i * 26, n === 2 ? t('hot.how2', { min: 30 }) : t(`hot.how${n}`), {
      size: 12,
      weight: 700,
    });
  });
}

function bar(f, label, o = {}) {
  f.rect(0, 744, W, 100, { fill: '#fff', stroke: C.line });
  f.text(20, 776, o.title ?? f.t('hot.free'), { size: 14, weight: 800 });
  f.text(20, 796, o.sub ?? f.t('hot.holdInfo', { min: 30 }), { size: 11, fill: C.ink2 });
  f.button(W - 20 - 170, 760, 170, 52, label, {
    fill: o.disabled ? C.line : C.purple,
    color: o.disabled ? C.ink2 : '#fff',
  });
}

function sheet(f, h, title) {
  f.rect(0, 0, W, 844, { fill: C.navy, opacity: 0.45 });
  f.rect(0, 844 - h, W, h, { r: 26, fill: '#fff' });
  f.rect(W / 2 - 20, 844 - h + 8, 40, 4, { r: 2, fill: C.line });
  f.text(20, 844 - h + 44, title, { size: 18, weight: 800 });
  f.icon(W - 20 - 30, 844 - h + 22, 'x', { size: 28 });
}

function ticket(f, o = {}) {
  const t = f.t;
  const L = f.lang === 'ar';
  header(f, t('res.title'));
  let y = 70;
  if (o.confirmed) {
    f.rect(16, y, W - 32, 62, { r: 18, fill: C.greenBg });
    f.circle(48, y + 31, 19, { fill: C.green });
    f.text(48, y + 38, '✓', { size: 20, weight: 800, fill: '#fff', align: 'middle' });
    f.text(78, y + 26, t('res.confirmed'), { size: 14, weight: 800, fill: '#064d3a' });
    f.text(78, y + 46, t('res.confirmedBody', { min: 30 }).slice(0, 44), {
      size: 11,
      fill: '#064d3a',
    });
    y += 76;
  }
  const state = o.state ?? 'HELD';
  const live = state === 'HELD';
  const tone = {
    HELD: 'success',
    REDEEMED: 'info',
    NOT_COMPLETED: 'warning',
    CANCELLED_BY_YOU: 'neutral',
  }[state];
  const ch = f.pill(32, y + 16, t(`res.state.${state}`), {
    fill: TONES[tone].fill,
    color: TONES[tone].color,
    size: 11,
  });
  void ch;
  f.text(W - 32, y + 31, 'DD-K7QM9T', { size: 11, fill: C.ink2, align: 'end', ltr: true });
  f.card(16, y, W - 32, live ? 660 : 440, { r: 24 });
  f.pill(32, y + 16, t(`res.state.${state}`), {
    fill: TONES[tone].fill,
    color: TONES[tone].color,
    size: 11,
  });
  f.text(32, y + 66, L ? 'ذروة الغداء: خصم 40% على الكبسة' : 'Lunch rush: 40% off kabsa', {
    size: 18,
    weight: 800,
  });
  f.text(32, y + 88, L ? 'نجد كيتشن · خصم 40%' : 'Najd Kitchen · 40% off', {
    size: 12,
    fill: C.ink2,
  });
  let yy = y + 104;
  if (live) {
    const urgent = o.urgent;
    f.rect(32, yy, W - 64, 50, { r: 14, fill: urgent ? C.dangerBg : C.slate });
    f.text(46, yy + 30, t('res.timeLeft'), { size: 11, fill: C.ink2 });
    f.text(W - 46, yy + 33, urgent ? '04:12' : '27:48', {
      size: 24,
      weight: 800,
      fill: urgent ? C.danger : C.navy,
      align: 'end',
      ltr: true,
    });
    yy += 66;
    f.rect(46, yy, W - 92, 232, { r: 20, stroke: '#B9A4FF', dash: true, fill: '#fff' });
    f.qr(W / 2 - 100, yy + 12, 200);
    f.text(W / 2, yy + 224, t('res.qrHint'), { size: 11, fill: C.ink2, align: 'middle' });
    yy += 248;
    f.text(W / 2, yy + 10, t('res.manualHint'), { size: 11, fill: C.ink2, align: 'middle' });
    f.text(W / 2, yy + 42, 'K7QM-9T2X', { size: 28, weight: 800, align: 'middle', ltr: true });
    yy += 62;
  } else {
    f.circle(W / 2, yy + 40, 28, { fill: C.slate });
    f.text(W / 2, yy + 50, state === 'REDEEMED' ? '✓' : state === 'NOT_COMPLETED' ? '◔' : '✕', {
      size: 26,
      weight: 800,
      fill: C.ink2,
      align: 'middle',
      ltr: true,
    });
    const msg =
      state === 'REDEEMED'
        ? t('res.usedOn', { date: '8 Oct 2026' })
        : state === 'NOT_COMPLETED'
          ? t('res.notCompletedBody')
          : t('res.cancelled');
    f.text(W / 2, yy + 100, msg.slice(0, 48), { size: 12, align: 'middle', fill: C.ink2 });
    if (msg.length > 48)
      f.text(W / 2, yy + 118, msg.slice(48, 100), { size: 12, align: 'middle', fill: C.ink2 });
    yy += 150;
  }
  f.line(32, yy, W - 32, yy);
  f.text(32, yy + 24, t('res.branch'), { size: 11, fill: C.ink2 });
  f.text(32, yy + 42, L ? 'نجد كيتشن النخيل' : 'Najd Kitchen Al Nakheel', {
    size: 13,
    weight: 700,
  });
  f.text(W - 32, yy + 24, t('res.quantity'), { size: 11, fill: C.ink2, align: 'end' });
  f.text(W - 32, yy + 42, '1', { size: 13, weight: 700, align: 'end', ltr: true });
  f.button(32, yy + 62, (W - 76) / 2, 44, t('res.directions'), {
    fill: C.lilac,
    color: C.purple,
    size: 13,
  });
  f.button(32 + (W - 76) / 2 + 12, yy + 62, (W - 76) / 2, 44, t('res.call'), {
    fill: '#fff',
    color: C.navy,
    stroke: C.line,
    size: 13,
  });
  if (live)
    f.button(32, yy + 118, W - 64, 44, t('res.cancel'), {
      fill: '#fff',
      color: C.navy,
      stroke: C.line,
      size: 13,
    });
  else
    f.button(
      32,
      yy + 118,
      W - 64,
      44,
      state === 'REDEEMED' ? t('res.viewOffer') : t('res.reserveAgain'),
      { fill: C.lilac, color: C.purple, size: 13 },
    );
}

function myDeals(f, tab, rows) {
  const t = f.t;
  f.text(16, 80, t('res.title'), { size: 28, weight: 800 });
  f.rect(16, 100, 300, 40, { r: 20, fill: C.slate });
  ['Active', 'Past', 'Updates'].forEach((k, i) => {
    const on = i === tab;
    if (on) f.rect(19 + i * 99, 103, 96, 34, { r: 17, fill: '#fff' });
    f.text(19 + i * 99 + 48, 125, t(`res.tab${k}`), {
      size: 13,
      weight: 700,
      fill: on ? C.purple : C.ink2,
      align: 'middle',
    });
  });
  rows.forEach((r, i) => {
    const y = 160 + i * 84;
    f.card(16, y, W - 32, 72, { r: 18 });
    f.photo(28, y + 12, 48, 48, { r: 14 });
    f.text(88, y + 30, r.title, { size: 14, weight: 800 });
    f.text(88, y + 48, r.sub, { size: 11, fill: C.ink2 });
    f.pill(88, y + 52, t(`res.state.${r.state}`), {
      ...TONES[r.tone],
      fill: TONES[r.tone].fill,
      color: TONES[r.tone].color,
      size: 10,
    });
  });
}

// accepts the pair in either order: the Arabic string is detected, so a frame can never show the wrong language
const L = (f, a, b) => {
  const [en, ar] = /[\u0600-\u06FF]/.test(a) ? [b, a] : [a, b];
  return f.lang === 'ar' ? ar : en;
};
const NOTE =
  'Illustrative reference of the implemented screen; real QR codes are generated by the app.';

export const customer = [
  {
    id: 'C01',
    name: 'Home: Exclusive Deals rail',
    journey: 'Discover',
    device: 'mobile',
    rtl: true,
    figma: '02 Home - Food and Drink / 06 Home - Best Deal for Me (rail pattern)',
    svg: true,
    isNew: true,
    comps: [
      'Exclusive Deal card (carousel)',
      'Countdown',
      'Inventory badge',
      'Header + My Deals icon',
      'Tab bar (3 tabs)',
    ],
    sheets: [],
    states: ['rail hidden when nothing is hot', 'loading skeleton'],
    route: '/ (HotRail in customer/features/hot.tsx)',
    priority: 'P1',
    shot: 'customer-01-home-hot-rail-en',
    draw(f) {
      customerChrome(f);
      f.text(16, 90, f.t('cust.tagline'), { size: 13, fill: C.ink2 });
      f.rect(16, 104, W - 32, 44, { r: 22, fill: '#fff', stroke: C.line });
      f.text(52, 131, f.t('cust.searchPlaceholder'), { size: 13, fill: C.ink2 });
      f.circle(0, 0, 0, {});
      f.text(16, 182, '♨ ' + f.t('hot.nearYou'), { size: 18, weight: 800 });
      f.text(16, 202, f.t('hot.nearYouSub'), { size: 12, fill: C.ink2 });
      f.text(W - 16, 182, f.t('cust.seeAll'), {
        size: 12,
        weight: 700,
        fill: C.purple,
        align: 'end',
      });
      carousel(f, 16, 218);
      carousel(f, 252, 218);
      f.text(16, 490, f.t('cust.liveOffers'), { size: 18, weight: 800 });
      f.text(16, 510, f.t('cust.happeningNow'), { size: 12, fill: C.ink2 });
      carousel(f, 16, 526);
    },
  },
  {
    id: 'C02',
    name: 'Exclusive Deals discovery (list)',
    journey: 'Discover',
    device: 'mobile',
    rtl: true,
    figma: '08 Explore - Exclusive Deals',
    svg: true,
    isNew: false,
    comps: ['Exclusive Deal card (list)', 'Sort chips', 'Countdown', 'Inventory badge'],
    sheets: [],
    states: ['sold-out card sinks to bottom', 'locked card', 'loading', 'empty', 'error'],
    route: '/hot',
    priority: 'P1',
    shot: 'customer-02-hot-list-en',
    draw(f) {
      customerChrome(f);
      f.text(16, 84, f.t('hot.title'), { size: 28, weight: 800 });
      f.text(16, 104, f.t('hot.sub'), { size: 12, fill: C.ink2 });
      let x = 16;
      ['ending_soon', 'nearest', 'newest'].forEach((k, i) => {
        x +=
          f.pill(x, 118, f.t(`hot.sort.${k}`), {
            fill: i === 0 ? C.purple : '#fff',
            color: i === 0 ? '#fff' : C.navy,
            size: 12,
          }) + 8;
      });
      listCard(f, 162, { left: 3 });
      listCard(f, 306, {
        left: 12,
        locked: true,
        colors: ['#9ED8FF', '#1E1B4B'],
        title: L(f, 'للموظفين: خصم 25% على الأكثر مبيعاً', 'Employees: 25% off bestsellers'),
        merchant: L(f, 'مكتبة بيج آند كو', 'Page & Co Books'),
      });
      listCard(f, 450, {
        sold: true,
        colors: ['#E8B7C8', '#6E2862'],
        title: L(f, 'مواعيد مانيكير في اللحظة الأخيرة', 'Last-minute manicure slots'),
        merchant: L(f, 'استوديو بلوم', 'Bloom Beauty Studio'),
      });
    },
  },
  {
    id: 'C03',
    name: 'Exclusive Deal detail: reservable (active)',
    journey: 'Discover → Reserve',
    device: 'mobile',
    rtl: true,
    figma: '20 Deal - Hot limited reserve (OUTDATED: paid SAR 15)',
    svg: true,
    isNew: false,
    comps: [
      'Hero gallery',
      'Urgency strip (countdown + units + hold)',
      'How it works',
      'Branch card',
      'Sticky Reserve bar',
    ],
    sheets: ['C06 Reserve sheet'],
    states: [
      'active',
      'low stock',
      'sold out',
      'ended',
      'locked',
      'restricted',
      'already reserved',
      'limit reached',
    ],
    route: '/hot/[id]',
    priority: 'P1',
    shot: 'customer-03-hot-detail-guest-en',
    draw(f) {
      detailBase(f, { left: 5 });
      bar(f, f.t('hot.reserve'));
    },
  },
  {
    id: 'C04',
    name: 'Countdown and stock states (board)',
    journey: 'Discover',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: false,
    isNew: true,
    comps: ['Countdown', 'Inventory badge'],
    sheets: [],
    states: [
      'calm (>1h)',
      'soon (<1h, amber)',
      'urgent (<5 min, red)',
      'ended',
      'low stock (≤5)',
      'sold out',
    ],
    route: 'packages/app-shell/src/hot/countdown.tsx',
    priority: 'P2',
    shot: null,
    draw(f) {
      f.text(16, 40, 'Countdown tone and stock badge states', { size: 18, weight: 800 });
      f.text(
        16,
        60,
        'Tone changes at 1 hour (amber) and 5 minutes (red). Time follows the SERVER clock.',
        { size: 12, fill: C.ink2 },
      );
      const rows = [
        ['calm', '2d 4h', C.ink2, C.slate, '>= 1 hour'],
        ['soon', '45m 00s', C.warn, C.warnBg, '< 1 hour'],
        ['urgent', '04m 12s', C.danger, C.dangerBg, '< 5 minutes'],
        ['ended', 'Ended', C.ink2, C.slate, '0'],
      ];
      rows.forEach(([n, v, col, bg, note], i) => {
        const y = 88 + i * 70;
        f.card(16, y, W - 32, 58, { r: 16 });
        f.text(32, y + 24, n, { size: 12, weight: 800, fill: C.ink2 });
        f.text(32, y + 44, note, { size: 11, fill: C.ink2 });
        f.pill(W - 150, y + 14, v, { fill: bg, color: col, size: 14, ltr: true });
      });
      [
        ['Only 3 left', C.dangerBg, C.danger],
        ['12 left', C.slate, C.ink2],
        ['Sold out', C.warnBg, C.warn],
        ['Walk in, no reservation', C.slate, C.ink2],
        ['While stocks last', C.slate, C.ink2],
      ].forEach(([s, bg, col], i) => {
        f.pill(16 + (i % 2) * 190, 396 + Math.floor(i / 2) * 44, s, {
          fill: bg,
          color: col,
          size: 12,
        });
      });
    },
  },
  {
    id: 'C05',
    name: 'Exclusive Deal detail: low stock (urgent)',
    journey: 'Reserve',
    device: 'mobile',
    rtl: false,
    figma: '20 Deal - Hot limited reserve',
    svg: true,
    isNew: true,
    comps: ['Urgency strip', 'Branch card with units left'],
    sheets: [],
    states: ['only N left', 'countdown urgent'],
    route: '/hot/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      detailBase(f, { left: 2, tone: 'urgent', time: '04m 12s' });
      bar(f, f.t('hot.reserve'));
    },
  },
  {
    id: 'C06',
    name: 'Reserve sheet: branch selection (free)',
    journey: 'Reserve',
    device: 'mobile',
    rtl: true,
    figma: '26 Deal - Reserve sheet (REPLACE: remove payment/card)',
    svg: true,
    isNew: true,
    comps: ['Bottom sheet', 'Branch selector (radio cards)', 'Reserve CTA'],
    sheets: ['sheet'],
    states: ['branch chosen', 'stock race error', 'connection error', 'submitting'],
    route: '/hot/[id] (reserve sheet in app-shell/hot/hot-views.tsx)',
    priority: 'P1',
    shot: 'customer-04-reserve-sheet-en',
    draw(f) {
      detailBase(f, {});
      sheet(f, 520, f.t('hot.confirmTitle'));
      const y0 = 844 - 520;
      f.text(20, y0 + 70, f.t('hot.confirmBody', { min: 30 }).slice(0, 52), {
        size: 12,
        fill: C.ink2,
      });
      f.text(20, y0 + 88, f.t('hot.confirmBody', { min: 30 }).slice(52, 110), {
        size: 12,
        fill: C.ink2,
      });
      f.text(20, y0 + 122, f.t('hot.chooseBranch'), { size: 13, weight: 800 });
      [
        [L(f, 'نجد كيتشن النخيل', 'Najd Kitchen Al Nakheel'), 3, true],
        [L(f, 'نجد كيتشن حطين', 'Najd Kitchen Hittin'), 2, false],
      ].forEach(([n, left, on], i) => {
        const y = y0 + 138 + i * 76;
        f.rect(20, y, W - 40, 64, {
          r: 16,
          fill: on ? C.purple50 : '#fff',
          stroke: on ? C.purple : C.line,
          sw: on ? 1.5 : 1,
        });
        f.circle(44, y + 32, 9, {
          stroke: on ? C.purple : C.line,
          sw: 2,
          fill: on ? C.purple : 'none',
        });
        f.text(66, y + 28, n, { size: 13, weight: 800 });
        f.text(66, y + 46, L(f, 'الرياض · ', 'Riyadh · ') + (i ? '4.1 km' : '640 m'), {
          size: 11,
          fill: C.ink2,
        });
        f.pill(W - 130, y + 18, f.t('hot.unitsAtBranch', { n: left }), {
          fill: C.warnBg,
          color: C.warn,
          size: 10,
        });
      });
      f.button(20, y0 + 306, W - 40, 52, f.t('hot.confirm'));
      f.button(20, y0 + 368, W - 40, 48, f.t('common.cancel'), { fill: C.lilac, color: C.purple });
      f.text(W / 2, y0 + 446, f.t('hot.noPayment'), { size: 11, fill: C.ink2, align: 'middle' });
    },
  },
  {
    id: 'C07',
    name: 'Reservation confirmation',
    journey: 'Reserve → Visit',
    device: 'mobile',
    rtl: true,
    figma: '31 Code - reservation (MODIFY: remove "Token paid SAR 15")',
    svg: true,
    isNew: false,
    comps: ['Confirmation banner', 'QR/code card', 'Hold timer'],
    sheets: [],
    states: ['just confirmed'],
    route: '/reservations/[id]?new=1',
    priority: 'P1',
    shot: 'customer-05-ticket-en',
    draw(f) {
      ticket(f, { confirmed: true, state: 'HELD' });
    },
  },
  {
    id: 'C08',
    name: 'Reservation active (QR + code + timer)',
    journey: 'Visit merchant',
    device: 'mobile',
    rtl: true,
    figma: '31 Code - reservation',
    svg: true,
    isNew: false,
    comps: ['QR/code card', 'Hold timer', 'Directions/Call/Cancel'],
    sheets: ['Cancel confirm modal'],
    states: ['active'],
    route: '/reservations/[id]',
    priority: 'P1',
    shot: 'customer-06-ticket-en-full',
    draw(f) {
      ticket(f, { state: 'HELD' });
    },
  },
  {
    id: 'C09',
    name: 'Reservation expiring (under 5 minutes)',
    journey: 'Visit merchant',
    device: 'mobile',
    rtl: false,
    figma: '31 Code - reservation',
    svg: true,
    isNew: true,
    comps: ['Hold timer (urgent)', 'QR/code card'],
    sheets: [],
    states: ['timer red <5 min', 'in-app "ends soon" notification at 10 min'],
    route: '/reservations/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      ticket(f, { state: 'HELD', urgent: true });
    },
  },
  {
    id: 'C10',
    name: 'Reservation not completed (expired)',
    journey: 'Expiry',
    device: 'mobile',
    rtl: true,
    figma: '31 Code - reservation (Expired state)',
    svg: true,
    isNew: true,
    comps: ['Reservation status chip', 'Past-state card'],
    sheets: [],
    states: ['neutral wording: "Reservation not completed"'],
    route: '/reservations/[id]',
    priority: 'P1',
    shot: null,
    draw(f) {
      ticket(f, { state: 'NOT_COMPLETED' });
    },
  },
  {
    id: 'C11',
    name: 'Reservation cancelled by customer',
    journey: 'Cancel',
    device: 'mobile',
    rtl: false,
    figma: '31 Code - reservation (Cancelled state)',
    svg: true,
    isNew: true,
    comps: ['Reservation status chip'],
    sheets: [],
    states: ['cancelled by you', 'cancelled by the business'],
    route: '/reservations/[id]',
    priority: 'P2',
    shot: 'customer-11-cancelled-en',
    draw(f) {
      ticket(f, { state: 'CANCELLED_BY_YOU' });
    },
  },
  {
    id: 'C12',
    name: 'Reservation redeemed (Used)',
    journey: 'Redeem',
    device: 'mobile',
    rtl: false,
    figma: '31 Code - reservation (Redeemed state)',
    svg: true,
    isNew: true,
    comps: ['Reservation status chip'],
    sheets: [],
    states: ['used (QR removed)'],
    route: '/reservations/[id]',
    priority: 'P1',
    shot: 'customer-09-ticket-used-en',
    draw(f) {
      ticket(f, { state: 'REDEEMED' });
    },
  },
  {
    id: 'C13',
    name: 'Exclusive Deal detail: sold out',
    journey: 'Race',
    device: 'mobile',
    rtl: true,
    figma: '20 Deal - Hot limited reserve (sold-out state)',
    svg: true,
    isNew: true,
    comps: ['Urgency strip (off)', 'Sold-out alert', 'Disabled CTA'],
    sheets: [],
    states: ['sold out (stays visible)'],
    route: '/hot/[id]',
    priority: 'P1',
    shot: 'customer-07-sold-out-en',
    draw(f) {
      detailBase(f, { state: 'sold', sheetH: 330 });
      f.rect(36, 440, W - 72, 0, {});
      bar(f, f.t('hot.soldOut'), { disabled: true });
    },
  },
  {
    id: 'C14',
    name: 'Exclusive Deal detail: campaign ended',
    journey: 'Discover',
    device: 'mobile',
    rtl: false,
    figma: '21 Deal - Hot time-limited (ended state)',
    svg: true,
    isNew: true,
    comps: ['Urgency strip (ended)', 'Disabled CTA'],
    sheets: [],
    states: ['ended (not listed, direct link only)'],
    route: '/hot/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      detailBase(f, { state: 'ended' });
      bar(f, f.t('hot.ended'), { disabled: true });
    },
  },
  {
    id: 'C15',
    name: 'Exclusive Deal detail: locked (eligibility)',
    journey: 'Eligibility',
    device: 'mobile',
    rtl: false,
    figma: '24 Deal - Employer offer',
    svg: true,
    isNew: true,
    comps: ['Locked panel', 'Unlock CTA'],
    sheets: [],
    states: ['locked with reason + action (hidden when no realistic path)'],
    route: '/hot/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      detailBase(f, { sheetH: 330 });
      f.rect(36, 448, W - 72, 0, {});
      f.rect(0, 744, W, 100, { fill: '#fff', stroke: C.line });
      f.icon(24, 764, 'lock', { size: 26, color: C.purple });
      f.text(60, 782, f.t('elig.unlock.VERIFY_EMPLOYER'), { size: 13, weight: 800 });
      f.text(60, 800, f.t('elig.noCardData').slice(0, 44), { size: 10, fill: C.ink2 });
      f.button(W - 150, 760, 130, 48, f.t('hot.lockedReserve'), { size: 12 });
    },
  },
  {
    id: 'C16',
    name: 'Exclusive Deal detail: reservations paused (restriction)',
    journey: 'Restriction',
    device: 'mobile',
    rtl: false,
    figma: 'none (CU-47 notice referenced in MVP doc)',
    svg: false,
    isNew: true,
    comps: ['Warning alert', 'Disabled CTA'],
    sheets: [],
    states: ['neutral temporary pause, end date, browsing still allowed'],
    route: '/hot/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      detailBase(f, {});
      f.rect(36, 450, W - 72, 74, { r: 14, fill: C.warnBg });
      f.text(48, 472, f.t('hot.restricted', { date: '15 Oct' }).slice(0, 46), {
        size: 11,
        fill: C.warn,
        weight: 700,
      });
      f.text(48, 490, f.t('hot.restricted', { date: '15 Oct' }).slice(46, 100), {
        size: 11,
        fill: C.warn,
        weight: 700,
      });
      f.text(48, 508, f.t('hot.restrictedWhy').slice(0, 54), { size: 10, fill: C.warn });
      bar(f, f.t('hot.reserve'), { disabled: true });
    },
  },
  {
    id: 'C17',
    name: 'My Deals: Active',
    journey: 'Visit merchant',
    device: 'mobile',
    rtl: true,
    figma: '52 My Deals - active (MODIFY: no "Paid SAR 15")',
    svg: true,
    isNew: false,
    comps: ['Segmented tabs', 'Reservation row'],
    sheets: [],
    states: ['empty', 'loading', 'sign-in'],
    route: '/reservations',
    priority: 'P1',
    shot: 'customer-08-my-deals-en',
    draw(f) {
      customerChrome(f, { tab: f.t('nav.profile') });
      myDeals(f, 0, [
        {
          title: L(f, 'ذروة الغداء: خصم 40%', 'Lunch rush: 40% off'),
          sub: L(f, 'نجد كيتشن · النخيل', 'Najd Kitchen · Al Nakheel'),
          state: 'HELD',
          tone: 'success',
        },
        {
          title: L(f, 'ساعة سعيدة: سموذي', 'Happy hour: smoothies'),
          sub: L(f, 'ديلي دوز · المركز المالي', 'Daily Dose · KAFD'),
          state: 'HELD',
          tone: 'success',
        },
      ]);
    },
  },
  {
    id: 'C18',
    name: 'My Deals: Past',
    journey: 'History',
    device: 'mobile',
    rtl: false,
    figma: '52 My Deals - active (Past tab)',
    svg: true,
    isNew: true,
    comps: ['Segmented tabs', 'Reservation row (past states)'],
    sheets: [],
    states: ['used', 'not completed', 'cancelled by you', 'cancelled by the business'],
    route: '/reservations?tab=past',
    priority: 'P2',
    shot: null,
    draw(f) {
      customerChrome(f, { tab: f.t('nav.profile') });
      myDeals(f, 1, [
        {
          title: 'Lunch rush: 40% off',
          sub: 'Najd Kitchen · Al Nakheel',
          state: 'REDEEMED',
          tone: 'info',
        },
        {
          title: 'Happy hour: smoothies',
          sub: 'Daily Dose · KAFD',
          state: 'NOT_COMPLETED',
          tone: 'warning',
        },
        {
          title: 'Facial flash offer',
          sub: 'Bloom Beauty · Olaya',
          state: 'CANCELLED_BY_YOU',
          tone: 'neutral',
        },
        {
          title: 'Dessert on us',
          sub: 'Harbour Grill · Olaya',
          state: 'CANCELLED_BY_MERCHANT',
          tone: 'neutral',
        },
      ]);
    },
  },
  {
    id: 'C19',
    name: 'My Deals: Updates (in-app notifications)',
    journey: 'Notify',
    device: 'mobile',
    rtl: false,
    figma: '05 Home - Notifications',
    svg: true,
    isNew: true,
    comps: ['Notification row'],
    sheets: [],
    states: ['unread highlight', 'empty'],
    route: '/reservations?tab=updates',
    priority: 'P2',
    shot: 'customer-10-updates-en',
    draw(f) {
      customerChrome(f, { tab: f.t('nav.profile') });
      f.text(16, 80, f.t('res.title'), { size: 28, weight: 800 });
      [
        'RESERVATION_CONFIRMED',
        'RESERVATION_EXPIRING',
        'REDEMPTION_SUCCESS',
        'RESERVATION_EXPIRED',
      ].forEach((k, i) => {
        const y = 160 + i * 74;
        f.rect(16, y, W - 32, 62, {
          r: 16,
          fill: i < 2 ? C.purple50 : '#fff',
          stroke: i < 2 ? '#B9A4FF' : C.line,
        });
        f.circle(44, y + 31, 18, { fill: C.lilac });
        f.text(
          72,
          y + 28,
          f.t(`notif.${k}`, { merchant: 'Najd Kitchen', deal: 'Lunch rush' }).slice(0, 36),
          { size: 12, weight: 800 },
        );
        f.text(72, y + 46, f.t('notif.justNow'), { size: 11, fill: C.ink2 });
      });
      f.rect(16, 100, 300, 40, { r: 20, fill: C.slate });
      ['Active', 'Past', 'Updates'].forEach((k, i) => {
        if (i === 2) f.rect(19 + i * 99, 103, 96, 34, { r: 17, fill: '#fff' });
        f.text(19 + i * 99 + 48, 125, f.t(`res.tab${k}`), {
          size: 13,
          weight: 700,
          fill: i === 2 ? C.purple : C.ink2,
          align: 'middle',
        });
      });
    },
  },
  {
    id: 'C20',
    name: 'Loading (skeleton)',
    journey: 'States',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: false,
    isNew: true,
    comps: ['Skeleton card'],
    sheets: [],
    states: ['loading'],
    route: '/hot',
    priority: 'P3',
    shot: null,
    draw(f) {
      customerChrome(f);
      f.text(16, 84, f.t('hot.title'), { size: 28, weight: 800 });
      for (let i = 0; i < 4; i++) {
        f.card(16, 130 + i * 140, W - 32, 124, { r: 20 });
        f.rect(16, 130 + i * 140, 112, 124, { r: 20, fill: C.slate });
        f.rect(140, 150 + i * 140, 180, 14, { r: 7, fill: C.slate });
        f.rect(140, 176 + i * 140, 100, 10, { r: 5, fill: C.slate });
      }
    },
  },
  {
    id: 'C21',
    name: 'Empty: no Exclusive Deals / no reservations',
    journey: 'States',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: false,
    isNew: true,
    comps: ['Empty state'],
    sheets: [],
    states: ['no Exclusive Deals', 'no active reservations', 'no past reservations'],
    route: '/hot, /reservations',
    priority: 'P3',
    shot: null,
    draw(f) {
      customerChrome(f);
      f.text(16, 84, f.t('hot.title'), { size: 28, weight: 800 });
      f.circle(W / 2, 300, 44, { fill: C.lilac });
      f.text(W / 2, 400, f.t('hot.empty'), { size: 18, weight: 800, align: 'middle' });
      f.text(W / 2, 424, f.t('hot.emptyBody').slice(0, 50), {
        size: 12,
        fill: C.ink2,
        align: 'middle',
      });
      f.button(W / 2 - 90, 460, 180, 46, f.t('hot.seeAll'), { size: 12 });
    },
  },
  {
    id: 'C22',
    name: 'Error and not-available',
    journey: 'States',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: false,
    isNew: true,
    comps: ['Error state', 'Retry button'],
    sheets: [],
    states: ['could not load (retry)', 'Exclusive Deal not available any more'],
    route: '/hot, /hot/[id]',
    priority: 'P3',
    shot: 'customer-18-hot-error-en',
    draw(f) {
      customerChrome(f);
      f.circle(W / 2, 250, 40, { fill: C.dangerBg });
      f.text(W / 2, 255, '!', { size: 36, weight: 800, fill: C.danger, align: 'middle' });
      f.text(W / 2, 330, f.t('cust.loadError'), { size: 18, weight: 800, align: 'middle' });
      f.button(W / 2 - 70, 356, 140, 44, f.t('cust.retry'), { fill: C.lilac, color: C.purple });
      f.line(40, 470, W - 40, 470);
      f.circle(W / 2, 560, 40, { fill: C.slate });
      f.text(W / 2, 640, f.t('hot.unavailable'), { size: 16, weight: 800, align: 'middle' });
      f.text(W / 2, 662, f.t('hot.unavailableBody').slice(0, 48), {
        size: 11,
        fill: C.ink2,
        align: 'middle',
      });
    },
  },
  {
    id: 'C23',
    name: 'Connection lost while reserving (sheet error)',
    journey: 'Reserve',
    device: 'mobile',
    rtl: false,
    figma: '26 Deal - Reserve sheet',
    svg: true,
    isNew: true,
    comps: ['Bottom sheet', 'Danger alert'],
    sheets: ['sheet'],
    states: ['offline', 'out of stock (409)', 'limit reached', 'too many active'],
    route: '/hot/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      detailBase(f, {});
      sheet(f, 360, f.t('hot.confirmTitle'));
      const y0 = 844 - 360;
      f.rect(20, y0 + 70, W - 40, 56, { r: 14, fill: C.dangerBg });
      f.text(34, y0 + 94, f.t('hot.connError').slice(0, 46), {
        size: 12,
        weight: 700,
        fill: C.danger,
      });
      f.text(34, y0 + 112, f.t('hot.connError').slice(46, 90), {
        size: 12,
        weight: 700,
        fill: C.danger,
      });
      f.button(20, y0 + 148, W - 40, 52, f.t('hot.confirm'));
      f.button(20, y0 + 210, W - 40, 48, f.t('common.cancel'), { fill: C.lilac, color: C.purple });
      f.rect(20, y0 + 276, W - 40, 56, { r: 14, fill: C.warnBg });
      f.text(34, y0 + 300, f.t('error.OUT_OF_STOCK'), { size: 12, weight: 700, fill: C.warn });
      f.text(34, y0 + 318, '(409) ' + f.t('hot.branchSoldOut'), { size: 11, fill: C.warn });
    },
  },
  {
    id: 'C24',
    name: 'Branch sold out inside the sheet',
    journey: 'Race',
    device: 'mobile',
    rtl: false,
    figma: '26 Deal - Reserve sheet',
    svg: true,
    isNew: true,
    comps: ['Branch selector (disabled option)'],
    sheets: ['sheet'],
    states: ['one branch sold out, another available'],
    route: '/hot/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      detailBase(f, {});
      sheet(f, 440, f.t('hot.confirmTitle'));
      const y0 = 844 - 440;
      f.text(20, y0 + 90, f.t('hot.chooseBranch'), { size: 13, weight: 800 });
      f.rect(20, y0 + 104, W - 40, 64, { r: 16, fill: C.slate, stroke: C.line });
      f.text(66, y0 + 132, 'Najd Kitchen Al Nakheel', { size: 13, weight: 800, fill: C.ink2 });
      f.pill(W - 140, y0 + 122, f.t('hot.branchSoldOut'), {
        fill: C.dangerBg,
        color: C.danger,
        size: 10,
      });
      f.rect(20, y0 + 180, W - 40, 64, { r: 16, fill: C.purple50, stroke: C.purple, sw: 1.5 });
      f.circle(44, y0 + 212, 9, { fill: C.purple });
      f.text(66, y0 + 208, 'Najd Kitchen Hittin', { size: 13, weight: 800 });
      f.pill(W - 130, y0 + 198, f.t('hot.unitsAtBranch', { n: 2 }), {
        fill: C.warnBg,
        color: C.warn,
        size: 10,
      });
      f.button(20, y0 + 270, W - 40, 52, f.t('hot.confirm'));
    },
  },
];
void NOTE;
