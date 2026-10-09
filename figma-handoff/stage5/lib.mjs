/**
 * Stage 5 drawing helpers. They sit on top of the approved Stage 4 kit (tokens, frame(), chrome, tables) and draw the
 * Stage 5 building blocks (voucher card, price box, order summary, wallet ticket, status box, ledger rows) from the
 * SAME copy as the app (EN + AR dictionaries) so a frame cannot drift from the implementation.
 */
import { formatMoney } from '../../packages/localization/dist/index.mjs';
export * from '../stage4/lib.mjs';
import { C, MOBILE, TONES, customerChrome as baseChrome } from '../stage4/lib.mjs';

/** Customer chrome as shipped in Stage 5: header has My Deals (ticket) and My Vouchers (tag) icons next to the language switch. */
export function customerChrome(f, o = {}) {
  baseChrome(f, o);
  if (o.top === false) return;
  f.circle(MOBILE.w - 142, 30, 18, { fill: '#fff', stroke: C.line });
  f.icon(MOBILE.w - 152, 20, 'tag', { size: 20 });
}

/** Accepts the pair in either order: the Arabic string is detected, so a frame never shows the wrong language. */
export const L = (f, a, b) => {
  const [en, ar] = /[؀-ۿ]/.test(a) ? [b, a] : [a, b];
  return f.lang === 'ar' ? ar : en;
};
export const sar = (f, halalas) => formatMoney(f.lang, halalas);
export const W = MOBILE.w;

const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Replaces f.text so mixed Arabic/Latin strings get their base direction from the first strong character (dates, SAR amounts and references inside Arabic sentences read correctly). */
/** Word-wrapped paragraph (never cuts a word); returns the y after the last line. */
export function wrap(f, x, y, s, chars, o = {}) {
  const words = String(s).split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > chars) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  const lh = o.lh ?? 16;
  lines.slice(0, o.max ?? 3).forEach((l, i) =>
    f.text(x, y + i * lh, l, {
      size: o.size ?? 11,
      fill: o.fill ?? C.ink2,
      weight: o.weight ?? 500,
    }),
  );
  return y + Math.min(lines.length, o.max ?? 3) * lh;
}

export function bidi(f) {
  const orig = f.text;
  f.text = (x, y, s, o = {}) => {
    if (o.ltr || !/[\u0600-\u06FF]/.test(String(s))) return orig(x, y, s, o);
    const align = o.align ?? 'start';
    const ax = f.rtl ? f.w - x : x;
    const anchor = align === 'middle' ? 'middle' : (align === 'start') === !f.rtl ? 'start' : 'end';
    f.raw(
      `<text x="${ax}" y="${y}" font-family="'Plus Jakarta Sans','IBM Plex Sans Arabic',system-ui,sans-serif" font-size="${o.size ?? 14}" font-weight="${o.weight ?? 500}" fill="${o.fill ?? C.navy}" text-anchor="${anchor}" unicode-bidi="plaintext">${escXml(s)}</text>`,
    );
  };
  return f;
}

export const MERCHANT_NAV5 = (t) => [
  t('nav.dashboard'),
  t('nav.profile'),
  t('nav.branches'),
  t('nav.team'),
  t('nav.campaigns'),
  t('nav.vouchers'),
  t('nav.redemptions'),
  t('nav.insights'),
  t('nav.finance'),
];
export const ADMIN_NAV5 = (t) => [
  t('nav.dashboard'),
  t('nav.merchants'),
  t('nav.liveDeals'),
  t('nav.hotDeals'),
  t('nav.vouchers'),
  t('nav.reservations'),
  t('nav.finance'),
  t('nav.organizations'),
  t('nav.customers'),
  t('nav.audit'),
  t('nav.configuration'),
];
/** Admin finance role sees a short navigation (what the role may use). */
export const FINANCE_NAV5 = (t) => [t('nav.dashboard'), t('nav.finance'), t('nav.organizations')];

export const VOUCHER_TONE = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  NEEDS_CHANGES: 'warning',
  REJECTED: 'danger',
  SCHEDULED: 'info',
  ON_SALE: 'success',
  PAUSED: 'neutral',
  SOLD_OUT: 'warning',
  ENDED: 'neutral',
  SUSPENDED: 'danger',
};
export const vchip = (f, status) => ({
  label: f.t(`vstatus.${status}`),
  ...TONES[VOUCHER_TONE[status]],
});
export const WALLET_TONE = {
  ACTIVE: 'success',
  USED: 'info',
  EXPIRED: 'neutral',
  REFUNDED: 'neutral',
  REFUND_PENDING: 'warning',
  VOIDED: 'warning',
};
export const REFUND_TONE = {
  REQUESTED: 'warning',
  UNDER_REVIEW: 'warning',
  APPROVED: 'info',
  PROCESSING: 'info',
  REFUNDED: 'success',
  REJECTED: 'neutral',
  FAILED: 'danger',
};

export const TITLE = (f) => L(f, 'قسيمة عشاء بقيمة 120 ريال', 'SAR 120 dinner voucher');
export const MERCHANT = (f) => L(f, 'نجد كيتشن', 'Najd Kitchen');

/** Purple "Voucher" badge on a card or hero. */
export function voucherBadge(f, x, y) {
  f.rect(x, y, 78, 22, { r: 11, fill: C.purple });
  f.text(x + 39, y + 15, f.t('vch.badge'), {
    size: 10,
    weight: 800,
    fill: '#fff',
    align: 'middle',
  });
}

/** Voucher card, list variant (112px photo + body). */
export function voucherListCard(f, y, o = {}) {
  const t = f.t;
  f.card(16, y, W - 32, 132, { r: 20 });
  f.photo(16, y, 112, 132, { r: 20, colors: o.colors ?? ['#FFB27A', '#581845'] });
  voucherBadge(f, 24, y + 10);
  f.pill(24, y + 98, sar(f, o.face ?? 12000), {
    fill: C.purple,
    color: '#fff',
    size: 11,
    ltr: true,
  });
  if (o.sold)
    f.pill(W - 110, y + 10, t('vch.soldOut'), { fill: C.warnBg, color: C.warn, size: 11 });
  f.text(140, y + 28, o.title ?? TITLE(f), { size: 14, weight: 800 });
  f.text(140, y + 48, o.merchant ?? MERCHANT(f), { size: 12, fill: C.ink2 });
  f.text(140, y + 78, sar(f, o.price ?? 9000), { size: 16, weight: 800, ltr: true });
  f.pill(140 + 76, y + 62, `${o.pct ?? 25}%`, {
    fill: C.greenBg,
    color: C.green,
    size: 11,
    ltr: true,
  });
  if (o.left !== undefined && !o.sold)
    f.pill(140, y + 94, t('vch.onlyLeft', { n: o.left }), {
      fill: C.dangerBg,
      color: C.danger,
      size: 11,
    });
  f.text(W - 24, y + 120, '⌖ 640 ' + L(f, 'م', 'm'), {
    size: 11,
    fill: C.ink2,
    align: 'end',
    ltr: true,
  });
  if (o.locked)
    f.pill(W - 120, y + 94, '⚿ ' + t('elig.locked'), { fill: '#fff', color: C.navy, size: 10 });
}

export function voucherCarousel(f, x, y, o = {}) {
  f.card(x, y, 224, 226, { r: 20 });
  f.photo(x, y, 224, 140, { r: 20, colors: o.colors ?? ['#FFB27A', '#581845'] });
  voucherBadge(f, x + 10, y + 10);
  f.pill(x + 10, y + 106, sar(f, o.face ?? 12000), {
    fill: C.purple,
    color: '#fff',
    size: 11,
    ltr: true,
  });
  f.text(x + 14, y + 166, o.title ?? TITLE(f), { size: 14, weight: 800 });
  f.text(x + 14, y + 186, o.merchant ?? MERCHANT(f), { size: 12, fill: C.ink2 });
  const w = f.pill(x + 14, y + 194, sar(f, o.price ?? 9000), {
    fill: C.slate,
    color: C.navy,
    size: 12,
    ltr: true,
  });
  f.pill(x + 20 + w, y + 194, `${o.pct ?? 25}%`, {
    fill: C.greenBg,
    color: C.green,
    size: 11,
    ltr: true,
  });
}

/** Reported savings box shared by detail and checkout. Wording: "Reported savings", never a guarantee. */
export function priceBox(f, x, y, wd) {
  const t = f.t;
  f.rect(x, y, wd, 96, { r: 16, fill: C.purple50, stroke: C.lilac });
  f.text(x + 16, y + 24, t('vch.youPay'), { size: 11, fill: C.ink2 });
  f.text(x + 16, y + 56, sar(f, 9000), { size: 26, weight: 800, fill: C.purple, ltr: true });
  f.text(x + 170, y + 24, t('vch.voucherValue'), { size: 11, fill: C.ink2 });
  f.text(x + 170, y + 50, sar(f, 12000), { size: 15, weight: 800, ltr: true });
  f.text(
    x + 16,
    y + 82,
    t('vch.reportedSavings') + ' ' + t('vch.savingsAmount', { amount: sar(f, 3000), pct: 25 }),
    { size: 12, weight: 800, fill: C.green },
  );
}

export function savingsNote(f, x, y, wd) {
  const s = f.t('vch.savingsNote');
  const per = Math.floor(wd / 6.4);
  (s.match(new RegExp(`.{1,${per}}(\\s|$)`, 'g')) ?? [])
    .slice(0, 3)
    .forEach((l, i) => f.text(x, y + i * 16, l.trim(), { size: 11, fill: C.ink2 }));
}

/** Detail hero + sheet. o.state: active | sold | ended | locked | limit */
export function detailBase(f, o = {}) {
  const t = f.t;
  f.photo(0, 0, W, 260, { colors: ['#FFB27A', '#581845'] });
  f.icon(16, 20, 'x', { size: 34, bg: 'rgba(15,12,66,.6)' });
  f.text(20, 216, MERCHANT(f), { size: 26, weight: 800, fill: '#fff' });
  f.text(20, 238, L(f, 'المطاعم · النخيل · 640 م', 'Dining · Al Nakheel · 640 m'), {
    size: 12,
    fill: '#fff',
  });
  f.card(16, 244, W - 32, o.sheetH ?? 476, { r: 24 });
  f.text(36, 284, t('vch.worth', { value: sar(f, 12000) }), {
    size: 26,
    weight: 800,
    fill: C.purple,
    ltr: false,
  });
  voucherBadge(f, W - 36 - 78, 262);
  f.text(36, 312, TITLE(f), { size: 15, weight: 700 });
  f.text(36, 332, L(f, 'ادفع 90 ريالاً وتناول بقيمة 120', 'Pay SAR 90, dine for SAR 120'), {
    size: 12,
    fill: C.ink2,
  });
  priceBox(f, 36, 346, W - 72);
  savingsNote(f, 36, 462, W - 72);
  let x = 36;
  f.pill(x, 516, t('vch.validDays', { n: 30 }), { fill: C.lilac, color: C.purple, size: 11 });
  if (o.state === 'active' || !o.state)
    f.pill(x, 546, t('vch.onlyLeft', { n: 3 }), { fill: C.warnBg, color: C.warn, size: 11 });
  f.text(36, 596, t('vch.howTitle'), { size: 13, weight: 800 });
  [1, 2, 3].forEach((n, i) => {
    f.circle(48, 618 + i * 26, 10, { fill: C.lilac });
    f.text(48, 622 + i * 26, String(n), {
      size: 11,
      weight: 800,
      fill: C.purple,
      align: 'middle',
      ltr: true,
    });
    f.text(68, 622 + i * 26, t(`vch.how${n}`), { size: 12, weight: 700 });
  });
}

export function buyBar(f, label, o = {}) {
  f.rect(0, 744, W, 100, { fill: '#fff', stroke: C.line });
  f.text(20, 780, sar(f, 9000), { size: 18, weight: 800, ltr: true });
  f.text(20, 800, f.t('vch.worth', { value: sar(f, 12000) }), { size: 11, fill: C.ink2 });
  f.button(W - 20 - 190, 760, 190, 52, label, {
    fill: o.disabled ? C.line : C.purple,
    color: o.disabled ? C.ink2 : '#fff',
  });
}

export function sheetShell(f, h, title) {
  f.rect(0, 0, W, 844, { fill: C.navy, opacity: 0.45 });
  f.rect(0, 844 - h, W, h, { r: 26, fill: '#fff' });
  f.rect(W / 2 - 20, 844 - h + 8, 40, 4, { r: 2, fill: C.line });
  f.text(20, 844 - h + 44, title, { size: 18, weight: 800 });
  f.icon(W - 20 - 30, 844 - h + 22, 'x', { size: 28 });
}

export function topBar(f, title) {
  f.icon(16, 20, 'x', { size: 22, bg: 'rgba(15,12,66,.55)' });
  f.text(W / 2, 38, title, { size: 16, weight: 800, align: 'middle' });
}

/** Order summary card (checkout and status pages). */
export function orderSummary(f, y) {
  const t = f.t;
  f.card(16, y, W - 32, 236, { r: 20 });
  f.photo(32, y + 16, 48, 48, { r: 14 });
  f.text(92, y + 36, TITLE(f), { size: 14, weight: 800 });
  f.text(92, y + 54, MERCHANT(f), { size: 12, fill: C.ink2 });
  [
    [t('ck.faceValue'), sar(f, 12000)],
    [t('ck.price'), sar(f, 9000)],
    [t('ck.quantity'), '1'],
    [t('ck.savings'), sar(f, 3000)],
  ].forEach(([k, v], i) => {
    f.text(32, y + 96 + i * 26, k, { size: 12, fill: C.ink2 });
    f.text(W - 32, y + 96 + i * 26, v, { size: 13, weight: 700, align: 'end', ltr: true });
  });
  f.line(32, y + 196, W - 32, y + 196);
  f.text(32, y + 222, t('ck.total'), { size: 15, weight: 800 });
  f.text(W - 32, y + 222, sar(f, 9000), { size: 17, weight: 800, align: 'end', ltr: true });
}

/** Centered status box (payment processing / success / failure). */
export function statusBox(f, y, tone, glyph, title, body, extra) {
  const col = {
    success: [C.greenBg, C.green],
    danger: [C.dangerBg, C.danger],
    warning: [C.warnBg, C.warn],
    info: [C.lilac, C.purple],
  }[tone];
  f.card(16, y, W - 32, extra?.h ?? 250, { r: 24 });
  f.circle(W / 2, y + 56, 30, { fill: col[0] });
  f.text(W / 2, y + 66, glyph, { size: 28, weight: 800, fill: col[1], align: 'middle', ltr: true });
  f.text(W / 2, y + 118, title, { size: 20, weight: 800, align: 'middle' });
  (body.match(/.{1,40}(\s|$)/g) ?? [])
    .slice(0, 3)
    .forEach((l, i) =>
      f.text(W / 2, y + 144 + i * 20, l.trim(), { size: 13, fill: C.ink2, align: 'middle' }),
    );
  return y + (extra?.h ?? 250);
}

/** Wallet list row. */
export function walletRow(f, y, state, o = {}) {
  const t = f.t;
  f.card(16, y, W - 32, 92, { r: 18 });
  f.photo(28, y + 14, 56, 56, { r: 14, colors: o.colors });
  f.text(96, y + 30, o.title ?? TITLE(f), { size: 14, weight: 800 });
  f.text(96, y + 48, (o.merchant ?? MERCHANT(f)) + ' · VC-K7QM9T', { size: 11, fill: C.ink2 });
  f.pill(96, y + 56, t(`vwallet.${state}`), { ...TONES[WALLET_TONE[state]], size: 10 });
  if (state === 'ACTIVE')
    f.text(W - 28, y + 74, t('wal.expires', { date: '7 Nov 2026' }).slice(0, 26), {
      size: 10,
      fill: C.ink2,
      align: 'end',
      ltr: true,
    });
  f.text(W - 28, y + 30, '›', { size: 20, weight: 800, fill: C.ink2, align: 'end', ltr: true });
}

export function walletTabs(f, tab) {
  const t = f.t;
  f.text(16, 80, t('wal.title'), { size: 28, weight: 800 });
  f.rect(16, 100, W - 32, 40, { r: 20, fill: C.slate });
  ['Active', 'Used', 'Expired', 'Refunded'].forEach((k, i) => {
    const x = 19 + i * ((W - 38) / 4);
    if (i === tab) f.rect(x, 103, (W - 38) / 4 - 3, 34, { r: 17, fill: '#fff' });
    f.text(x + (W - 38) / 8, 125, t(`wal.tab${k}`), {
      size: 12,
      weight: 700,
      fill: i === tab ? C.purple : C.ink2,
      align: 'middle',
    });
  });
}

/** Wallet detail ticket. state: ACTIVE | USED | EXPIRED | REFUNDED | REFUND_PENDING. */
export function walletTicket(f, state, o = {}) {
  const t = f.t;
  topBar(f, t('wal.title'));
  let y = 70;
  if (o.justIssued) {
    f.rect(16, y, W - 32, 62, { r: 18, fill: C.greenBg });
    f.circle(48, y + 31, 19, { fill: C.green });
    f.text(48, y + 38, '✓', { size: 20, weight: 800, fill: '#fff', align: 'middle', ltr: true });
    f.text(78, y + 26, t('ord.success'), { size: 14, weight: 800, fill: '#064d3a' });
    f.text(78, y + 46, t('ord.successBody').slice(0, 44), { size: 11, fill: '#064d3a' });
    y += 76;
  }
  const live = state === 'ACTIVE';
  f.card(16, y, W - 32, live ? 616 + (o.refundCta ? 74 : 0) + (o.refundBox ? 68 : 0) : 520, {
    r: 24,
  });
  f.pill(32, y + 16, t(`vwallet.${state}`), { ...TONES[WALLET_TONE[state]], size: 11 });
  f.text(W - 32, y + 31, 'VC-K7QM9T', { size: 11, fill: C.ink2, align: 'end', ltr: true });
  f.text(32, y + 66, TITLE(f), { size: 18, weight: 800 });
  f.text(32, y + 88, MERCHANT(f) + ' · ' + sar(f, 12000), { size: 12, fill: C.ink2, ltr: false });
  let yy = y + 104;
  if (live) {
    f.rect(46, yy, W - 92, 232, { r: 20, stroke: '#B9A4FF', dash: true, fill: '#fff' });
    f.qr(W / 2 - 100, yy + 12, 200);
    f.text(W / 2, yy + 224, t('wal.qrHint'), { size: 11, fill: C.ink2, align: 'middle' });
    yy += 248;
    f.text(W / 2, yy + 10, t('wal.manualHint'), { size: 11, fill: C.ink2, align: 'middle' });
    f.text(W / 2, yy + 42, 'K7QM-9T2X', { size: 28, weight: 800, align: 'middle', ltr: true });
    yy += 62;
  } else {
    f.circle(W / 2, yy + 40, 28, { fill: C.slate });
    f.text(W / 2, yy + 50, { USED: '✓', EXPIRED: '◔', REFUNDED: 'i', REFUND_PENDING: 'i' }[state], {
      size: 26,
      weight: 800,
      fill: C.ink2,
      align: 'middle',
      ltr: true,
    });
    const msg = {
      USED: t('wal.usedBody'),
      EXPIRED: t('wal.expiredBody'),
      REFUNDED: t('wal.refundedBody'),
      REFUND_PENDING: t('wal.pendingBody'),
    }[state];
    (msg.match(/.{1,42}(\s|$)/g) ?? [])
      .slice(0, 3)
      .forEach((l, i) =>
        f.text(W / 2, yy + 100 + i * 18, l.trim(), { size: 12, align: 'middle', fill: C.ink2 }),
      );
    yy += 150;
  }
  f.line(32, yy, W - 32, yy);
  [
    [t('wal.validTo'), '7 Nov 2026'],
    [t('wal.order'), 'ORD-DDZYFX'],
    [t('ck.price'), sar(f, 9000)],
  ].forEach(([k, v], i) => {
    f.text(32 + i * 118, yy + 24, k, { size: 11, fill: C.ink2 });
    f.text(32 + i * 118, yy + 44, v, { size: 12, weight: 700, ltr: true });
  });
  yy += 62;
  if (o.refundBox) {
    const [tone, msg] = o.refundBox;
    f.rect(32, yy, W - 64, 56, {
      r: 14,
      fill: tone === 'warning' ? C.warnBg : tone === 'success' ? C.greenBg : C.lilac,
    });
    f.text(46, yy + 22, t('wal.refund.status', { ref: 'RF-K7QM9T' }), { size: 12, weight: 800 });
    f.text(46, yy + 42, msg.slice(0, 48), { size: 11, fill: C.ink2 });
    yy += 68;
  }
  f.button(32, yy, (W - 76) / 2, 44, '⌖ ' + t('wal.directions'), {
    fill: C.lilac,
    color: C.purple,
    size: 13,
  });
  f.button(32 + (W - 76) / 2 + 12, yy, (W - 76) / 2, 44, t('deal.overview'), {
    fill: '#fff',
    color: C.navy,
    stroke: C.line,
    size: 13,
  });
  yy += 54;
  f.text(32, yy + 18, '▸ ' + t('vch.termsTitle'), { size: 13, weight: 800 });
  yy += 34;
  if (o.refundCta) {
    f.button(32, yy, W - 64, 44, t('wal.refund.cta'), {
      fill: '#fff',
      color: C.navy,
      stroke: C.line,
      size: 13,
    });
    f.text(W / 2, yy + 62, t('wal.refund.windowEnds', { date: '9 Oct 2026' }), {
      size: 11,
      fill: C.ink2,
      align: 'middle',
    });
    yy += 74;
  } else if (o.refundHint) {
    f.text(32, yy + 18, o.refundHint.slice(0, 52), { size: 11, fill: C.ink2 });
    yy += 34;
  }
  f.text(W / 2, yy + 22, t('wal.support.open'), {
    size: 13,
    weight: 800,
    fill: C.purple,
    align: 'middle',
  });
}

// ---------------------------------------------------------------- portal helpers (desktop)
export const X0 = 272;
export const shortField = (f, x, y, wd, label, value, o = {}) => {
  f.text(x, y, label, { size: 12, weight: 700, fill: C.ink2 });
  f.rect(x, y + 8, wd, o.h ?? 40, {
    r: 12,
    fill: o.disabled ? C.slate : '#fff',
    stroke: o.error ? C.danger : C.line,
    sw: o.error ? 1.5 : 1,
  });
  f.text(x + 14, y + 8 + (o.h ?? 40) / 2 + 5, value, {
    size: 13,
    fill: o.placeholder ? C.ink2 : C.navy,
    ltr: o.ltr,
  });
  if (o.error) f.text(x, y + 66, o.error, { size: 11, fill: C.danger });
};
