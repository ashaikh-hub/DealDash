import { ADMIN_NAV, C, DESKTOP, MERCHANT_NAV, TONES, chip, kpi, portalChrome, table, tabs } from './lib.mjs';

const W = DESKTOP.w;
// accepts the pair in either order: the Arabic string is detected, so a frame can never show the wrong language
const L = (f, a, b) => {
  const [en, ar] = /[\u0600-\u06FF]/.test(a) ? [b, a] : [a, b];
  return f.lang === 'ar' ? ar : en;
};
const M = (f, active) => portalChrome(f, { surface: 'merchant', active: f.t(active), items: MERCHANT_NAV(f.t) });
const A = (f, active) => portalChrome(f, { surface: 'admin', active: f.t(active), items: ADMIN_NAV(f.t) });
const X0 = 272; // content start (after the sidebar + gutter)

function segment(f, x, y) {
  f.rect(x, y, 260, 40, { r: 20, fill: C.slate });
  f.rect(x + 130, y + 3, 127, 34, { r: 17, fill: '#fff' });
  f.text(x + 65, y + 25, f.t('mh.tabLive'), { size: 13, weight: 700, fill: C.ink2, align: 'middle' });
  f.text(x + 193, y + 25, f.t('mh.tabHot'), { size: 13, weight: 700, fill: C.purple, align: 'middle' });
}

function stepper(f, step) {
  const names = ['basics', 'content', 'limits', 'stock', 'rules', 'review'].map((s) => f.t(`mhs.${s}`));
  f.card(X0, 150, 220, 330, { r: 20 });
  names.forEach((n, i) => {
    const y = 176 + i * 50;
    f.circle(X0 + 36, y + 14, 13, { fill: i === step ? C.purple : i < step ? C.mint : '#fff', stroke: i > step ? C.line : undefined, sw: 2 });
    f.text(X0 + 36, y + 19, i < step ? '✓' : String(i + 1), { size: 12, weight: 800, fill: i <= step ? '#fff' : C.ink2, align: 'middle', ltr: true });
    f.text(X0 + 60, y + 19, n, { size: 13, weight: i === step ? 800 : 600, fill: i === step ? C.purple : C.navy });
  });
}

function builderShell(f, step, title, help, draw) {
  M(f, 'nav.campaigns');
  f.text(X0, 100, '← ' + f.t('mdeal.back'), { size: 13, weight: 700, fill: C.purple });
  f.text(X0, 128, f.t('mhb.newTitle'), { size: 22, weight: 800 });
  f.pill(X0 + 190, 108, f.t('hotstatus.DRAFT'), { ...TONES.neutral, size: 11 });
  f.pill(W - 220 - 190, 108, f.t('builder.translationComplete'), { ...TONES.success, size: 11 });
  stepper(f, step);
  const cx = X0 + 240;
  f.card(cx, 150, 560, 680, { r: 20 });
  f.text(cx + 24, 184, f.t('builder.step', { n: step + 1, total: 6 }), { size: 11, fill: C.ink2 });
  f.text(cx + 24, 210, title, { size: 18, weight: 800 });
  f.text(cx + 24, 230, help, { size: 12, fill: C.ink2 });
  draw(cx + 24, 262);
  f.line(cx + 24, 770, cx + 536, 770);
  f.button(cx + 24, 780, 100, 40, f.t('mhb.back'), { fill: '#fff', color: C.navy, stroke: C.line, size: 13 });
  f.button(cx + 320, 780, 100, 40, f.t('mhb.save'), { fill: C.lilac, color: C.purple, size: 13 });
  f.button(cx + 432, 780, 104, 40, step === 5 ? f.t('mhb.submit') : f.t('mhb.next'), { size: 13 });
  // live customer preview
  const px = cx + 580;
  f.card(px, 150, W - px - 32, 680, { r: 20 });
  f.text(px + 20, 182, f.t('mhb.preview'), { size: 15, weight: 800 });
  f.photo(px + 20, 204, W - px - 72, 120, { r: 16 });
  f.hotGradient(px + 30, 214, 52, 22, 11);
  f.text(px + 56, 229, f.t('hot.badge'), { size: 10, weight: 800, fill: '#fff', align: 'middle' });
  f.text(px + 20, 350, L(f, 'عشاء سريع الليلة', 'Flash dinner tonight'), { size: 14, weight: 800 });
  f.pill(px + 20, 364, '2h 15m', { ...TONES.warning, size: 11, ltr: true });
  f.pill(px + 90, 364, f.t('hot.onlyLeft', { n: 5 }), { ...TONES.danger, size: 11 });
}

function field(f, x, y, wd, label, value, o = {}) {
  f.text(x, y, label, { size: 12, weight: 700, fill: C.ink2 });
  f.rect(x, y + 8, wd, o.h ?? 40, { r: 12, fill: o.disabled ? C.slate : '#fff', stroke: o.error ? C.danger : C.line });
  f.text(x + 14, y + 8 + (o.h ?? 40) / 2 + 5, value, { size: 13, fill: o.placeholder ? C.ink2 : C.navy, ltr: o.ltr });
}
function biField(f, x, y, label, en, ar, o = {}) {
  field(f, x, y, 250, `${label} (English) *`, en, o);
  field(f, x + 270, y, 250, `${label} (العربية) *`, ar, o);
}

const mon = (f, tabIdx, body) => {
  M(f, 'nav.campaigns');
  f.text(X0, 100, '← ' + f.t('mdeal.back'), { size: 13, weight: 700, fill: C.purple });
  f.text(X0, 132, L(f, 'عشاء سريع الليلة', 'Flash dinner tonight'), { size: 24, weight: 800 });
  f.pill(X0 + 250, 112, f.t('hotstatus.LIVE'), { ...TONES.success, size: 11 });
  f.button(W - 220 - 330, 104, 100, 40, f.t('mm.addStock'), { fill: '#fff', color: C.navy, stroke: C.line, size: 12 });
  f.button(W - 220 - 220, 104, 90, 40, f.t('mm.pause'), { fill: '#fff', color: C.navy, stroke: C.line, size: 12 });
  f.button(W - 220 - 120, 104, 140, 40, f.t('mm.cancelDeal'), { fill: C.red, size: 12 });
  tabs(f, X0, 160, [f.t('mm.tabMonitor'), f.t('mm.tabReservations'), f.t('mm.tabResults'), f.t('mm.tabActivity')], tabIdx);
  body(X0, 214);
};

export const merchant = [
  {
    id: 'M01', name: 'Campaigns: Exclusive Deals list', journey: 'Create', device: 'desktop', rtl: true, figma: '58 Business console - Campaigns (REPLACED by Merchant Portal)', svg: true, isNew: true,
    comps: ['Sidebar nav', 'Live/Hot switch', 'Info alert (free)', 'Filters', 'Status chip', 'Table'], sheets: [], states: ['loading', 'empty', 'error', 'no manage permission (no create button)'], route: '/deals/hot', priority: 'P1', shot: 'merchant-01-hot-hub-en',
    draw(f) {
      M(f, 'nav.campaigns');
      f.text(X0, 100, f.t('mh.title'), { size: 28, weight: 800 });
      f.text(X0, 124, f.t('mh.sub'), { size: 13, fill: C.ink2 });
      f.button(W - 220 - 190, 84, 190, 44, '+ ' + f.t('mh.create'), { size: 13 });
      segment(f, X0, 148);
      f.rect(X0, 202, W - X0 - 32, 44, { r: 14, fill: C.lilac });
      f.text(X0 + 16, 229, 'ⓘ ' + f.t('mh.freeNote'), { size: 13, weight: 600, fill: C.navy });
      f.rect(X0, 262, 280, 40, { r: 12, fill: '#fff', stroke: C.line });
      f.text(X0 + 14, 287, f.t('mdeal.hub.search'), { size: 13, fill: C.ink2 });
      f.rect(X0 + 296, 262, 200, 40, { r: 12, fill: '#fff', stroke: C.line });
      f.text(X0 + 310, 287, f.t('mdeal.hub.allStatuses'), { size: 13, fill: C.ink2 });
      table(f, X0, 322, W - X0 - 32, [{ label: f.t('mdeal.col.title'), w: 340 }, { label: f.t('mh.colBranches'), w: 110 }, { label: f.t('mh.colWindow'), w: 220 }, { label: f.t('mh.colStock'), w: 160 }, { label: f.t('mdeal.col.status'), w: 150 }], [
        ['Lunch rush: 40% off kabsa', '2', '8 Oct – 8 Oct', '12 / 20', chip(f.t('hotstatus.LIVE'), 'success')],
        ['Weekend breakfast: SAR 20 off', '1', '9 Oct – ' + f.t('mh.untilStock'), '—', chip(f.t('hotstatus.NEEDS_CHANGES'), 'warning')],
        ['Walk-in: free day pass', '2', '8 Oct – 8 Oct', f.t('mh.reservationsOff'), chip(f.t('hotstatus.LIVE'), 'success')],
        ['Last-minute manicure slots', '1', '8 Oct – 8 Oct', '0 / 2', chip(f.t('hotstatus.SOLD_OUT'), 'warning')],
        ['Cold brew flash sale', '1', '8 Oct – 8 Oct', '20 / 20', chip(f.t('hotstatus.PAUSED'), 'neutral')],
      ]);
    },
  },
  {
    id: 'M02', name: 'Builder 1/6: Offer', journey: 'Create', device: 'desktop', rtl: false, figma: '63 Business - Create Exclusive Deal (REPLACED by 6-step builder)', svg: true, isNew: true,
    comps: ['Stepper', 'Select', 'Number input', 'Preview panel'], sheets: [], states: ['draft saved', 'validation per step', 'autosave 30 s'], route: '/deals/hot/new', priority: 'P1', shot: 'merchant-02-hot-builder-empty-en',
    draw(f) { builderShell(f, 0, f.t('mhs.basics'), f.t('mhsh.basics'), (x, y) => { field(f, x, y, 250, f.t('mhb.category') + ' *', 'Dining'); field(f, x + 270, y, 250, f.t('mhb.mechanic') + ' *', 'Percentage off'); field(f, x, y + 80, 160, f.t('field.valuePercent') + ' *', '45', { ltr: true }); }); },
  },
  {
    id: 'M03', name: 'Builder 2/6: Content (bilingual + photos)', journey: 'Create', device: 'desktop', rtl: false, figma: '63 Business - Create Exclusive Deal', svg: true, isNew: true,
    comps: ['Bilingual field pair (EN LTR / AR RTL)', 'Photo uploader + alt text', 'Translation status chip'], sheets: [], states: ['missing Arabic (blocks Next)', 'upload error', 'min size rules'], route: '/deals/hot/new (step 2)', priority: 'P1', shot: 'merchant-03-hot-builder-content-en',
    draw(f) { builderShell(f, 1, f.t('mhs.content'), f.t('mhsh.content'), (x, y) => { biField(f, x, y, f.t('mhb.offerLabel'), '45% off', 'خصم 45%'); biField(f, x, y + 78, f.t('mhb.title'), 'Flash dinner tonight', 'عشاء سريع الليلة'); biField(f, x, y + 156, f.t('mhb.shortDescription'), 'Two platters only', 'طبقان فقط'); biField(f, x, y + 234, f.t('mhb.description'), 'A flash offer…', 'عرض سريع…', { h: 90 }); f.text(x, y + 380, f.t('mhb.photos'), { size: 13, weight: 800 }); f.photo(x, y + 392, 160, 100, { r: 12 }); f.rect(x + 176, y + 392, 160, 100, { r: 12, stroke: C.line, dash: true }); f.text(x + 256, y + 448, '+ ' + f.t('media.add'), { size: 12, fill: C.purple, weight: 700, align: 'middle' }); }); },
  },
  {
    id: 'M04', name: 'Builder 3/6: Time & limits (time / quantity / both)', journey: 'Create', device: 'desktop', rtl: true, figma: '63 Business - Create Exclusive Deal', svg: true, isNew: true,
    comps: ['Limit-type cards', 'Reservations switch', 'Datetime fields (Riyadh time)', 'Per-customer + hold fields'], sheets: [], states: ['time only = walk-in (no reservation fields)', 'quantity only', 'time + quantity', 'live: locked fields'], route: '/deals/hot/new (step 3)', priority: 'P1', shot: 'merchant-04-hot-builder-limits-en',
    draw(f) {
      builderShell(f, 2, f.t('mhs.limits'), f.t('mhsh.limits'), (x, y) => {
        ['TIME', 'QUANTITY', 'TIME_AND_QUANTITY'].forEach((k, i) => {
          const on = i === 2;
          f.rect(x + i * 176, y, 168, 96, { r: 16, fill: on ? C.purple50 : '#fff', stroke: on ? C.purple : C.line, sw: on ? 1.5 : 1 });
          f.text(x + i * 176 + 14, y + 30, f.t(`mhb.limit.${k}`), { size: 13, weight: 800 });
          f.text(x + i * 176 + 14, y + 52, f.t(`mhb.limit.${k}.help`).slice(0, 24), { size: 10, fill: C.ink2 });
          f.text(x + i * 176 + 14, y + 66, f.t(`mhb.limit.${k}.help`).slice(24, 50), { size: 10, fill: C.ink2 });
        });
        f.rect(x, y + 118, 18, 18, { r: 5, fill: C.purple });
        f.text(x + 28, y + 132, f.t('mhb.reservationsOn'), { size: 13, weight: 700 });
        field(f, x, y + 170, 250, f.t('mhb.start') + ' * (' + f.t('field.riyadhTime') + ')', '2026-10-08  10:00', { ltr: true });
        field(f, x + 270, y + 170, 250, f.t('mhb.end') + ' * (' + f.t('field.riyadhTime') + ')', '2026-10-08  16:00', { ltr: true });
        field(f, x, y + 250, 160, f.t('mhb.perCustomer') + ' *', '1', { ltr: true });
        field(f, x + 270, y + 250, 160, f.t('mhb.hold'), '30', { ltr: true, placeholder: true });
      });
    },
  },
  {
    id: 'M05', name: 'Limit configurations side by side (board)', journey: 'Create', device: 'desktop', rtl: false, figma: 'none', svg: false, isNew: true,
    comps: ['Limit-type cards'], sheets: [], states: ['time-only walk-in', 'quantity-only', 'time + quantity'], route: 'hot-builder.tsx step 3', priority: 'P2', shot: null,
    draw(f) {
      M(f, 'nav.campaigns');
      f.text(X0, 100, 'Three ways to limit an Exclusive Deal', { size: 24, weight: 800 });
      [['TIME', 'Walk-in', ['Reservations: off', 'Stock: none (not tracked)', 'Needs: start + end', 'Customer: views, visits, no code'], false], ['QUANTITY', 'Reserve until gone', ['Reservations: on', 'Stock: units per branch', 'End: optional (while stocks last)', 'Customer: reserves free, QR code'], true], ['TIME_AND_QUANTITY', 'Reserve, ends at time or sold out', ['Reservations: on', 'Stock: units per branch', 'Needs: start + end (max 72 h)', 'Status: SOLD_OUT reopens when units return'], true]].forEach(([k, sub, lines], i) => {
        const x = X0 + i * 372;
        f.card(x, 140, 352, 360, { r: 20 });
        f.text(x + 20, 176, f.t(`mhb.limit.${k}`), { size: 18, weight: 800 });
        f.text(x + 20, 198, sub, { size: 12, fill: C.ink2 });
        lines.forEach((l, j) => f.text(x + 20, 240 + j * 34, '• ' + l, { size: 13 }));
      });
    },
  },
  {
    id: 'M06', name: 'Builder 4/6: Branches & stock (inventory)', journey: 'Create', device: 'desktop', rtl: false, figma: '63 Business - Create Exclusive Deal', svg: true, isNew: true,
    comps: ['Branch checkbox rows', 'Units input'], sheets: [], states: ['no stock tracked (walk-in)', 'units too high', 'live: locked, use Add stock'], route: '/deals/hot/new (step 4)', priority: 'P1', shot: 'merchant-05-hot-builder-stock-en',
    draw(f) { builderShell(f, 3, f.t('mhs.stock'), f.t('mhsh.stock'), (x, y) => { f.text(x, y, f.t('mhb.branchesStockHelp'), { size: 12, fill: C.ink2 }); [['Najd Kitchen Al Nakheel', 12, true], ['Najd Kitchen Hittin', 8, true], ['Najd Kitchen Olaya', 0, false]].forEach(([n, u, on], i) => { const yy = y + 24 + i * 64; f.rect(x, yy, 520, 52, { r: 14, fill: '#fff', stroke: C.line }); f.rect(x + 14, yy + 17, 18, 18, { r: 5, fill: on ? C.purple : '#fff', stroke: C.line }); f.text(x + 44, yy + 32, n, { size: 13, weight: 700 }); if (on) { f.text(x + 340, yy + 22, f.t('mhb.units'), { size: 10, fill: C.ink2 }); f.rect(x + 340, yy + 26, 80, 20, { r: 8, fill: C.slate }); f.text(x + 380, yy + 41, String(u), { size: 12, weight: 800, align: 'middle', ltr: true }); } }); }); },
  },
  {
    id: 'M07', name: 'Builder 5/6: Eligibility & terms', journey: 'Create', device: 'desktop', rtl: false, figma: '63 Business - Create Exclusive Deal', svg: true, isNew: true,
    comps: ['Radio list', 'Partner checkboxes', 'Terms toggles', 'Bilingual terms text'], sheets: [], states: ['public', 'geography', 'employer', 'bank card', 'scheme'], route: '/deals/hot/new (step 5)', priority: 'P2', shot: null,
    draw(f) { builderShell(f, 4, f.t('mhs.rules'), f.t('mhsh.rules'), (x, y) => { f.text(x, y, f.t('mhb.eligibility'), { size: 13, weight: 800 }); ['PUBLIC', 'GEOGRAPHY', 'EMPLOYER', 'BANK_CARD', 'SCHEME'].forEach((k, i) => { f.circle(x + 9, y + 30 + i * 30, 8, { stroke: C.line, sw: 2, fill: i === 0 ? C.purple : 'none' }); f.text(x + 26, y + 35 + i * 30, f.t(`elig.${k}`), { size: 13 }); }); f.text(x, y + 200, f.t('mhb.terms'), { size: 13, weight: 800 }); f.rect(x, y + 214, 18, 18, { r: 5, fill: C.purple }); f.text(x + 28, y + 228, f.t('terms.notCombinable'), { size: 13 }); f.rect(x, y + 244, 18, 18, { r: 5, fill: '#fff', stroke: C.line }); f.text(x + 28, y + 258, f.t('terms.fullPriceOnly'), { size: 13 }); field(f, x, y + 290, 250, f.t('field.termsText') + ' (English) *', 'Show your reservation code…', { h: 70 }); field(f, x + 270, y + 290, 250, f.t('field.termsText') + ' (العربية) *', 'اعرض رمز الحجز…', { h: 70 }); }); },
  },
  {
    id: 'M08', name: 'Builder 6/6: Review & submit', journey: 'Create → Review', device: 'desktop', rtl: false, figma: '63 Business - Create Exclusive Deal', svg: true, isNew: true,
    comps: ['Summary list', 'Guardrail alert', 'Fix-first list with links', 'Submit'], sheets: [], states: ['complete', 'issues with Fix links', 'live edit: only wording allowed', 'result: Sent for review / Published / Scheduled'], route: '/deals/hot/new (step 6)', priority: 'P1', shot: 'merchant-05b-hot-builder-review-en',
    draw(f) { builderShell(f, 5, f.t('mhs.review'), f.t('mhsh.review'), (x, y) => { f.rect(x, y, 520, 44, { r: 14, fill: C.greenBg }); f.text(x + 16, y + 28, '✓ ' + f.t('dreview.complete'), { size: 13, weight: 800, fill: '#064d3a' }); f.rect(x, y + 58, 520, 56, { r: 14, fill: C.warnBg }); f.text(x + 16, y + 82, f.t('guardrail.manual'), { size: 12, weight: 700, fill: C.warn }); [[f.t('mhb.category'), 'Dining'], [f.t('mhb.limitType'), f.t('hotlimit.TIME_AND_QUANTITY')], [f.t('mhb.title'), 'Flash dinner tonight'], [f.t('mhb.branchesStock'), 'Al Nakheel (12), Hittin (8)'], [f.t('mhb.eligibility'), f.t('elig.PUBLIC')]].forEach(([k, v], i) => { f.line(x, y + 150 + i * 44, x + 520, y + 150 + i * 44); f.text(x, y + 176 + i * 44, k, { size: 12, fill: C.ink2 }); f.text(x + 200, y + 176 + i * 44, v, { size: 13, weight: 700 }); }); }); },
  },
  {
    id: 'M09', name: 'Status and banner board (Draft … Rejected)', journey: 'Lifecycle', device: 'desktop', rtl: false, figma: 'none', svg: false, isNew: true,
    comps: ['Status chip', 'Banners (info/warning/danger)'], sheets: [], states: ['DRAFT', 'PENDING_REVIEW', 'NEEDS_CHANGES', 'SCHEDULED', 'LIVE', 'PAUSED', 'SOLD_OUT', 'EXPIRED', 'CANCELLED', 'REJECTED', 'SUSPENDED'], route: 'hot-utils.tsx HotStatusChip', priority: 'P1', shot: null,
    draw(f) {
      M(f, 'nav.campaigns');
      f.text(X0, 100, 'Exclusive Deal statuses (merchant view)', { size: 24, weight: 800 });
      const rows = [['DRAFT', 'neutral', 'Edit freely. Autosaves every 30 s.'], ['PENDING_REVIEW', 'warning', 'Being reviewed. Editing is locked.'], ['NEEDS_CHANGES', 'warning', 'DealDash asked for changes (reason shown, EN/AR). Fix & resubmit.'], ['SCHEDULED', 'info', 'Approved, starts later. Wording fixes only.'], ['LIVE', 'success', 'Visible to customers. Pause, cancel, add stock, wording fixes.'], ['PAUSED', 'neutral', 'Hidden. Merchant pause can resume; DealDash pause cannot.'], ['SOLD_OUT', 'warning', 'No units left. Visible and marked. Add stock reopens it.'], ['EXPIRED', 'neutral', 'Ended. Held reservations stay valid until their hold ends.'], ['CANCELLED', 'neutral', 'Ended early. Held reservations cancelled, customers told.'], ['REJECTED', 'danger', 'Not approved. Reason shown.'], ['SUSPENDED', 'danger', 'Stopped by DealDash. Redemption blocked.']];
      rows.forEach(([s, tone, note], i) => { const y = 130 + i * 62; f.card(X0, y, 900, 50, { r: 14 }); f.pill(X0 + 16, y + 12, f.t(`hotstatus.${s}`), { ...TONES[tone], size: 12 }); f.text(X0 + 190, y + 31, note, { size: 13 }); });
    },
  },
  {
    id: 'M10', name: 'Exclusive Deal monitor: Live monitor', journey: 'Operate', device: 'desktop', rtl: true, figma: '58 Business console - Campaigns (monitor not in old design)', svg: true, isNew: true,
    comps: ['KPI tiles', 'Countdown', 'Stock bar + legend', 'Per-branch table', 'Auto-refresh footer'], sheets: ['Add stock dialog', 'Pause dialog', 'Cancel dialog'], states: ['live', 'sold out', 'paused by DealDash (warning)', 'read-only role (no controls)'], route: '/deals/hot/[id]', priority: 'P1', shot: 'merchant-07-hot-monitor-en',
    draw(f) {
      mon(f, 0, (x, y) => {
        const cards = [[f.t('hotstatus.LIVE'), f.t('mm.status')], ['02:14:55', f.t('mm.timeLeft')], ['4', f.t('mm.available')], ['2', f.t('mm.reserved')], ['2', f.t('mm.redeemed')], ['1', f.t('mm.notCompleted')], ['1', f.t('mm.expiringSoon')]];
        cards.forEach(([v, l], i) => kpi(f, x + i * 150, y, 140, v, l));
        f.card(x, y + 102, 1040, 300, { r: 20 });
        f.text(x + 20, y + 134, f.t('mm.stock'), { size: 16, weight: 800 });
        f.rect(x + 20, y + 150, 1000, 14, { r: 7, fill: C.slate });
        f.rect(x + 20, y + 150, 250, 14, { r: 7, fill: C.purple });
        f.rect(x + 270, y + 150, 250, 14, { fill: C.amber });
        f.rect(x + 520, y + 150, 500, 14, { r: 7, fill: C.mint });
        table(f, x + 8, y + 184, 1024, [{ label: f.t('mm.col.branch'), w: 360 }, { label: f.t('mm.total'), w: 160 }, { label: f.t('mm.available'), w: 160 }, { label: f.t('mm.reserved'), w: 160 }, { label: f.t('mm.redeemed'), w: 160 }], [['Najd Kitchen Al Nakheel', '12', '2', '2', '1'], ['Najd Kitchen Hittin', '8', '2', '0', '1']], { rowH: 40 });
        f.text(x, y + 424, f.t('mm.autoRefresh'), { size: 12, fill: C.ink2 });
      });
    },
  },
  {
    id: 'M11', name: 'Exclusive Deal monitor: Reservations', journey: 'Operate', device: 'desktop', rtl: false, figma: 'none', svg: true, isNew: true,
    comps: ['Filters', 'Reservation table', 'Cancel-with-reason dialog'], sheets: ['Cancel reservation dialog (reason required)'], states: ['empty', 'held', 'used', 'not completed', 'cancelled'], route: '/deals/hot/[id] (tab)', priority: 'P1', shot: 'merchant-08-hot-reservations-en',
    draw(f) { mon(f, 1, (x, y) => { table(f, x, y, 1040, [{ label: f.t('mm.col.code'), w: 120 }, { label: f.t('mm.col.customer'), w: 160 }, { label: f.t('mm.col.branch'), w: 260 }, { label: f.t('mm.col.qty'), w: 80 }, { label: f.t('mm.col.status'), w: 160 }, { label: f.t('mm.col.time'), w: 160 }, { label: '', w: 100 }], [['…T2X7', 'Layla', 'Al Nakheel', '1', chip(f.t('resstatus.HELD'), 'success'), '10:42', f.t('mm.cancelRes')], ['…AB12', 'Omar', 'Hittin', '1', chip(f.t('resstatus.EXPIRED'), 'warning'), '10:12', ''], ['…QZ77', 'Noura', 'Al Nakheel', '1', chip(f.t('resstatus.REDEEMED'), 'info'), '09:58', ''], ['…M3K9', 'Faisal', 'Hittin', '1', chip(f.t('resstatus.CANCELLED'), 'neutral'), '09:30', '']]); f.text(x, y + 280, 'First name and last four characters only. No phone number, no e-mail.', { size: 12, fill: C.ink2 }); }); },
  },
  {
    id: 'M12', name: 'Exclusive Deal monitor: Results (funnel)', journey: 'Operate', device: 'desktop', rtl: false, figma: '60 Business console - Analytics (pattern only)', svg: true, isNew: true,
    comps: ['Funnel bars', 'KPI tiles', 'Caveat text'], sheets: [], states: ['no data yet (–)'], route: '/deals/hot/[id] (tab)', priority: 'P2', shot: 'merchant-09-hot-results-en',
    draw(f) { mon(f, 2, (x, y) => { f.card(x, y, 1040, 330, { r: 20 }); f.text(x + 20, y + 34, f.t('mm.funnel'), { size: 16, weight: 800 }); [[f.t('mm.impressions'), 120, 120], [f.t('mm.detailViews'), 40, 40], [f.t('mm.created'), 6, 6], [f.t('mm.used'), 2, 2]].forEach(([l, n, v], i) => { const yy = y + 60 + i * 44; f.text(x + 20, yy + 14, l, { size: 13 }); f.rect(x + 200, yy, 700, 18, { r: 9, fill: C.slate }); f.rect(x + 200, yy, Math.max(24, (n / 120) * 700), 18, { r: 9, fill: C.purple }); f.text(x + 920, yy + 14, String(v), { size: 13, weight: 800, ltr: true }); }); kpi(f, x + 20, y + 250, 200, '15%', f.t('mm.viewToRes')); kpi(f, x + 240, y + 250, 200, '33.3%', f.t('mm.resToUsed')); f.text(x + 480, y + 296, f.t('mm.funnelNote'), { size: 12, fill: C.ink2 }); }); },
  },
  {
    id: 'M13', name: 'Exclusive Deal monitor: Activity', journey: 'Operate', device: 'desktop', rtl: false, figma: 'none', svg: true, isNew: true,
    comps: ['Timeline list'], sheets: [], states: ['empty'], route: '/deals/hot/[id] (tab)', priority: 'P3', shot: 'merchant-10-hot-activity-en',
    draw(f) { mon(f, 3, (x, y) => { f.card(x, y, 1040, 330, { r: 20 }); [['resevent.REDEEMED', '10:42', 'QR · …T2X7'], ['resevent.CREATED', '10:41', '…T2X7'], ['hotaction.APPROVE', '09:55', 'DealDash'], ['hotaction.SUBMIT', '09:40', 'Owner']].forEach(([k, tm, who], i) => { f.text(x + 20, y + 44 + i * 58, '2026-10-08 ' + tm, { size: 12, fill: C.ink2, ltr: true }); f.text(x + 220, y + 44 + i * 58, f.t(k), { size: 14, weight: 800 }); f.text(x + 220, y + 62 + i * 58, who, { size: 12, fill: C.ink2 }); }); }); },
  },
  {
    id: 'M14', name: 'Add / remove stock dialog', journey: 'Operate', device: 'desktop', rtl: false, figma: 'none', svg: true, isNew: true,
    comps: ['Modal', 'Segment (add/remove)', 'Select', 'Number field', 'Danger alert'], sheets: ['modal'], states: ['add', 'remove (only unreserved)', 'INVENTORY_BELOW_COMMITTED error'], route: '/deals/hot/[id] (StockDialog)', priority: 'P2', shot: null,
    draw(f) { mon(f, 0, () => {}); f.rect(0, 0, W, DESKTOP.h, { fill: C.navy, opacity: 0.45 }); f.rect(480, 200, 520, 440, { r: 20, fill: '#fff' }); f.text(504, 244, f.t('mm.addStock'), { size: 18, weight: 800 }); f.text(504, 270, f.t('mm.stockHelp').slice(0, 70), { size: 12, fill: C.ink2 }); field(f, 504, 310, 472, f.t('mm.col.branch'), 'Najd Kitchen Al Nakheel (Available: 2)'); f.rect(504, 380, 280, 40, { r: 20, fill: C.slate }); f.rect(507, 383, 137, 34, { r: 17, fill: '#fff' }); f.text(575, 405, f.t('mm.addStock'), { size: 12, weight: 700, fill: C.purple, align: 'middle' }); f.text(715, 405, f.t('mm.removeStock').slice(0, 18), { size: 12, weight: 700, fill: C.ink2, align: 'middle' }); field(f, 504, 450, 160, f.t('mm.stockAmount'), '5', { ltr: true }); f.rect(504, 520, 472, 44, { r: 12, fill: C.dangerBg }); f.text(518, 548, f.t('error.INVENTORY_BELOW_COMMITTED').slice(0, 62), { size: 11, fill: C.danger }); f.button(864, 584, 112, 40, f.t('mm.addStock'), { size: 12 }); f.button(744, 584, 100, 40, f.t('common.cancel'), { fill: '#fff', color: C.navy, stroke: C.line, size: 12 }); },
  },
  {
    id: 'M15', name: 'Redemptions (with reverse)', journey: 'Operate', device: 'desktop', rtl: false, figma: '59 Business console - Redeem (REPLACED by Staff app)', svg: true, isNew: true,
    comps: ['Table', 'Reverse dialog (reason required)'], sheets: ['Reverse dialog'], states: ['reversed badge', 'no reverse permission', 'outside window'], route: '/redemptions', priority: 'P1', shot: 'merchant-12-redemptions-en',
    draw(f) { M(f, 'nav.redemptions'); f.text(X0, 100, f.t('mm.redemptionsTitle'), { size: 28, weight: 800 }); f.text(X0, 124, f.t('mm.redemptionsSub'), { size: 13, fill: C.ink2 }); table(f, X0, 150, W - X0 - 32, [{ label: f.t('mm.col.ref'), w: 140 }, { label: f.t('mm.col.deal'), w: 300 }, { label: f.t('mm.col.branch'), w: 200 }, { label: f.t('mm.col.staff'), w: 160 }, { label: f.t('mm.col.source'), w: 130 }, { label: f.t('mm.col.time'), w: 160 }, { label: '', w: 120 }], [['RD-ABC234', 'Lunch rush: 40% off', 'Al Nakheel', 'Khalid', f.t('mm.source.QR'), '10:42', f.t('mm.reverse')], ['RD-XYZ789', 'Lunch rush: 40% off', 'Al Nakheel', 'Khalid', f.t('mm.source.MANUAL'), '10:20', chip(f.t('mm.reversedBadge'), 'warning')]]); },
  },
  {
    id: 'M16', name: 'Needs changes banner on the Exclusive Deal', journey: 'Review', device: 'desktop', rtl: false, figma: 'none', svg: true, isNew: true,
    comps: ['Warning banner with reviewer reason (EN/AR)'], sheets: [], states: ['needs changes', 'rejected (danger)', 'pending (info)'], route: '/deals/hot/[id]', priority: 'P2', shot: null,
    draw(f) { M(f, 'nav.campaigns'); f.text(X0, 100, 'Weekend breakfast: SAR 20 off', { size: 24, weight: 800 }); f.pill(X0 + 400, 82, f.t('hotstatus.NEEDS_CHANGES'), { ...TONES.warning, size: 11 }); f.rect(X0, 124, W - X0 - 32, 72, { r: 16, fill: C.warnBg }); f.text(X0 + 20, 152, f.t('banner.needsChanges'), { size: 14, weight: 800, fill: C.warn }); f.text(X0 + 20, 176, 'Please add the opening hours of the breakfast service to the terms.', { size: 13, fill: C.warn }); f.button(W - 220 - 130, 140, 150, 40, f.t('mhb.submit'), { size: 12 }); },
  },
];

export const admin = [
  {
    id: 'A01', name: 'Exclusive Deal review queue', journey: 'Review', device: 'desktop', rtl: true, figma: 'none (Admin visual design: campaign queue pattern)', svg: true, isNew: true,
    comps: ['Tabs (Queue/All/Monitor)', 'Search', 'Table', 'Status chip'], sheets: [], states: ['empty queue', 'loading', 'error'], route: '/hot-deals', priority: 'P1', shot: 'admin-01-hot-queue-en',
    draw(f) { A(f, 'nav.hotDeals'); f.text(X0, 100, f.t('ah.title'), { size: 28, weight: 800 }); f.text(X0, 124, f.t('ah.sub'), { size: 13, fill: C.ink2 }); tabs(f, X0, 150, [f.t('ah.tabQueue'), f.t('ah.tabAll'), f.t('ah.tabMonitor')], 0); table(f, X0, 210, W - X0 - 32, [{ label: f.t('ah.col.deal'), w: 360 }, { label: f.t('ah.col.merchant'), w: 240 }, { label: f.t('ah.col.units'), w: 120 }, { label: f.t('ah.col.submitted'), w: 200 }, { label: f.t('adeal.col.status'), w: 160 }], [['Flash dinner tonight', 'Najd Kitchen', '20', '8 Oct 10:15', chip(f.t('hotstatus.PENDING_REVIEW'), 'warning')], ['Spin class spots at 20% off', 'Pulse Fitness', '12', '8 Oct 09:40', chip(f.t('hotstatus.PENDING_REVIEW'), 'warning')]]); },
  },
  {
    id: 'A02', name: 'Exclusive Deal review workbench', journey: 'Review', device: 'desktop', rtl: true, figma: 'none (Admin visual design: review workbench pattern)', svg: true, isNew: true,
    comps: ['Merchant card', 'Reservation rules card', 'Inventory table', 'EN/AR content columns', 'Media grid', 'History timeline', 'Reservation activity feed (A10)', 'Decision panel', 'Customer preview'], sheets: ['Decision dialog'], states: ['pending review', 'live (control actions)', 'suspended', 'support: no access'], route: '/hot-deals/[id]', priority: 'P1', shot: 'admin-02-hot-review-en',
    draw(f) {
      A(f, 'nav.hotDeals');
      f.text(X0, 100, '← ' + f.t('adeal.back'), { size: 13, weight: 700, fill: C.purple });
      f.text(X0, 132, 'Flash dinner tonight', { size: 24, weight: 800 });
      f.pill(X0 + 280, 112, f.t('hotstatus.PENDING_REVIEW'), { ...TONES.warning, size: 11 });
      const lw = 760;
      f.card(X0, 156, lw, 130, { r: 18 }); f.text(X0 + 20, 186, f.t('adeal.merchant'), { size: 15, weight: 800 }); [['Najd Kitchen', 'ACTIVE'], [f.t('adeal.trust.NEW'), 'STANDARD']].forEach(([a, b], i) => { f.text(X0 + 20, 214 + i * 28, a, { size: 13 }); f.text(X0 + 300, 214 + i * 28, b, { size: 13, weight: 700 }); });
      f.card(X0, 302, lw, 210, { r: 18 }); f.text(X0 + 20, 332, f.t('ah.detail.rules'), { size: 15, weight: 800 }); [[f.t('ah.rule.enabled'), f.t('ah.on')], [f.t('ah.rule.hold'), f.t('res.minutes', { n: 30 })], [f.t('ah.rule.perCustomer'), '1'], [f.t('ah.rule.maxActive'), '3'], [f.t('ah.rule.noShow'), f.t('ah.rule.noShowValue', { n: 3, days: 7 })]].forEach(([k, v], i) => { f.text(X0 + 20, 362 + i * 28, k, { size: 12, fill: C.ink2 }); f.text(X0 + 260, 362 + i * 28, v, { size: 13, weight: 700 }); });
      f.card(X0, 528, lw, 170, { r: 18 }); f.text(X0 + 20, 558, f.t('ah.detail.inventory'), { size: 15, weight: 800 }); table(f, X0 + 8, 572, lw - 16, [{ label: f.t('mm.col.branch'), w: 300 }, { label: f.t('mm.total'), w: 110 }, { label: f.t('mm.available'), w: 110 }, { label: f.t('mm.reserved'), w: 110 }, { label: f.t('mm.redeemed'), w: 110 }], [['Al Nakheel', '12', '12', '0', '0'], ['Hittin', '8', '8', '0', '0']], { rowH: 34 });
      [0, 1].forEach((i) => { f.card(X0 + i * 384, 714, 376, 160, { r: 18 }); f.text(X0 + i * 384 + 16, 742, i ? 'العربية' : 'English', { size: 11, weight: 800, fill: C.ink2 }); f.text(X0 + i * 384 + 16, 772, i ? 'عشاء سريع الليلة' : 'Flash dinner tonight', { size: 16, weight: 800 }); f.text(X0 + i * 384 + 16, 800, i ? 'عرض سريع على طبقين' : 'A flash offer on two platters', { size: 13 }); });
      const rx = X0 + lw + 20;
      f.card(rx, 156, W - rx - 32, 250, { r: 18 }); f.text(rx + 20, 186, f.t('adeal.decision'), { size: 15, weight: 800 }); f.rect(rx + 20, 200, W - rx - 72, 44, { r: 12, fill: C.lilac }); f.text(rx + 32, 227, f.t('guardrail.manual').slice(0, 40), { size: 11, fill: C.navy, weight: 700 }); f.button(rx + 20, 258, W - rx - 72, 40, f.t('ah.approve'), { size: 13 }); f.button(rx + 20, 306, W - rx - 72, 40, f.t('ah.requestChanges'), { fill: '#fff', color: C.navy, stroke: C.line, size: 13 }); f.button(rx + 20, 354, W - rx - 72, 40, f.t('ah.reject'), { fill: C.red, size: 13 });
      f.card(rx, 422, W - rx - 32, 440, { r: 18 }); f.text(rx + 20, 452, f.t('ah.preview'), { size: 15, weight: 800 }); f.photo(rx + 20, 470, W - rx - 72, 130, { r: 14 }); f.text(rx + 20, 630, 'Flash dinner tonight', { size: 14, weight: 800 }); f.pill(rx + 20, 644, '2h 15m', { ...TONES.warning, size: 11, ltr: true }); f.pill(rx + 90, 644, f.t('hot.free'), { ...TONES.success, size: 11 });
    },
  },
  {
    id: 'A03', name: 'Decision dialog (approve / request changes / reject / pause / suspend / cancel)', journey: 'Review', device: 'desktop', rtl: false, figma: 'none', svg: true, isNew: true,
    comps: ['Modal', 'Reason (EN) required', 'Reason (AR) optional', 'Confirm (danger for reject/suspend/cancel)'], sheets: ['modal'], states: ['reason required error', 'success "Done"'], route: '/hot-deals/[id]', priority: 'P1', shot: null,
    draw(f) {
      A(f, 'nav.hotDeals'); f.rect(0, 0, W, DESKTOP.h, { fill: C.navy, opacity: 0.45 });
      f.rect(470, 180, 540, 470, { r: 20, fill: '#fff' });
      f.text(494, 224, f.t('ah.requestChanges'), { size: 18, weight: 800 });
      f.text(494, 250, f.t('adeal.reasonHelp').slice(0, 64), { size: 12, fill: C.ink2 });
      field(f, 494, 290, 492, f.t('adeal.reason'), 'Please add that the offer is dine-in only.', { h: 80, error: false });
      field(f, 494, 410, 492, f.t('ah.reasonAr'), 'يرجى ذكر أن العرض للتناول في المطعم فقط.', { h: 80 });
      f.text(494, 540, f.t('modal.reasonRequired'), { size: 12, fill: C.danger });
      f.button(884, 580, 102, 44, f.t('adeal.confirm'), { size: 13 }); f.button(764, 580, 100, 44, f.t('common.cancel'), { fill: '#fff', color: C.navy, stroke: C.line, size: 13 });
    },
  },
  {
    id: 'A04', name: 'Pause / suspend / reinstate controls on a live Exclusive Deal', journey: 'Control', device: 'desktop', rtl: false, figma: 'none', svg: true, isNew: true,
    comps: ['Decision panel (control actions)', 'Status chip'], sheets: ['Decision dialog'], states: ['LIVE: pause/suspend/cancel', 'PAUSED: resume/suspend', 'SUSPENDED: reinstate'], route: '/hot-deals/[id]', priority: 'P1', shot: null,
    draw(f) {
      A(f, 'nav.hotDeals'); f.text(X0, 100, 'Flash dinner tonight', { size: 24, weight: 800 }); f.pill(X0 + 280, 80, f.t('hotstatus.LIVE'), { ...TONES.success, size: 11 });
      ['LIVE', 'PAUSED', 'SUSPENDED'].forEach((s, i) => { const x = X0 + i * 380; f.card(x, 150, 360, 280, { r: 18 }); f.pill(x + 20, 170, f.t(`hotstatus.${s}`), { ...TONES[s === 'LIVE' ? 'success' : s === 'PAUSED' ? 'neutral' : 'danger'], size: 11 }); const acts = { LIVE: ['pause', 'suspend', 'cancelDeal'], PAUSED: ['resume', 'suspend', 'cancelDeal'], SUSPENDED: ['reinstate', 'cancelDeal'] }[s]; acts.forEach((a, j) => f.button(x + 20, 212 + j * 52, 320, 42, f.t(`ah.${a}`), { fill: a === 'suspend' || a === 'cancelDeal' ? C.red : '#fff', color: a === 'suspend' || a === 'cancelDeal' ? '#fff' : C.navy, stroke: C.line, size: 13 })); });
      f.text(X0, 470, 'Support has no review or control permission. Operations and Merchant Management do.', { size: 13, fill: C.ink2 });
    },
  },
  {
    id: 'A05', name: 'Live Exclusive Deal monitor (platform)', journey: 'Monitor', device: 'desktop', rtl: true, figma: 'none', svg: true, isNew: true,
    comps: ['KPI tiles', 'Table of live deals'], sheets: [], states: ['loading', 'error'], route: '/hot-deals (Live monitor tab)', priority: 'P1', shot: 'admin-03-hot-monitor-en',
    draw(f) { A(f, 'nav.hotDeals'); f.text(X0, 100, f.t('ah.title'), { size: 28, weight: 800 }); tabs(f, X0, 130, [f.t('ah.tabQueue'), f.t('ah.tabAll'), f.t('ah.tabMonitor')], 2); [[3, 'hotstatus.LIVE'], [1, 'hotstatus.SOLD_OUT'], [2, 'hotstatus.PENDING_REVIEW'], [0, 'hotstatus.PAUSED'], [1, 'hotstatus.SUSPENDED']].forEach(([n, k], i) => kpi(f, X0 + i * 190, 190, 176, n, f.t(k))); f.text(X0, 304, f.t('ah.overview'), { size: 16, weight: 800 }); [[4, 'ah.heldNow'], [12, 'ah.createdDay'], [7, 'ah.usedDay'], [3, 'ah.notCompletedDay'], [2, 'ah.cancelledDay'], [1, 'ah.restrictions']].forEach(([n, k], i) => kpi(f, X0 + i * 190, 320, 176, n, f.t(k))); table(f, X0, 420, W - X0 - 32, [{ label: f.t('ah.col.deal'), w: 360 }, { label: f.t('ah.col.merchant'), w: 240 }, { label: f.t('mm.available'), w: 120 }, { label: f.t('mm.reserved'), w: 120 }, { label: f.t('mm.redeemed'), w: 120 }, { label: f.t('adeal.col.status'), w: 140 }], [['Lunch rush: 40% off kabsa', 'Najd Kitchen', '2', '1', '5', chip(f.t('hotstatus.LIVE'), 'success')], ['Happy hour', 'Daily Dose', '22', '0', '8', chip(f.t('hotstatus.LIVE'), 'success')]]); },
  },
  {
    id: 'A06', name: 'Reservation activity: lookup, cancel, reverse', journey: 'Support', device: 'desktop', rtl: false, figma: 'none', svg: true, isNew: true,
    comps: ['Search field', 'Reservation card', 'Reason dialog'], sheets: ['Reason dialog'], states: ['not found', 'held → cancel', 'redeemed → reverse'], route: '/reservations (Find a reservation)', priority: 'P1', shot: 'admin-05-reservation-lookup-en',
    draw(f) { A(f, 'nav.reservations'); f.text(X0, 100, f.t('nav.reservations'), { size: 28, weight: 800 }); tabs(f, X0, 130, [f.t('ah.restrictionsTitle'), f.t('ah.lookup')], 1); field(f, X0, 200, 300, f.t('ah.lookup'), 'DD-K7QM9T', { ltr: true }); f.button(X0 + 320, 208, 110, 40, f.t('ah.search'), { size: 13 }); f.card(X0, 280, 760, 150, { r: 18 }); f.text(X0 + 20, 312, 'DD-K7QM9T', { size: 16, weight: 800, ltr: true }); f.pill(X0 + 660, 296, f.t('resstatus.HELD'), { ...TONES.success, size: 11 }); f.text(X0 + 20, 340, 'Lunch rush · Al Nakheel · ×1', { size: 13 }); f.text(X0 + 20, 362, '8 Oct 10:41 → 11:11', { size: 12, fill: C.ink2, ltr: true }); f.button(X0 + 20, 380, 180, 36, f.t('ah.cancelRes'), { fill: '#fff', color: C.navy, stroke: C.line, size: 12 }); },
  },
  {
    id: 'A07', name: 'Customer restrictions (no-show review)', journey: 'Support', device: 'desktop', rtl: false, figma: 'none', svg: true, isNew: true,
    comps: ['Table', 'Lift dialog (reason required)'], sheets: ['Lift dialog'], states: ['active', 'lifted', 'ended', 'empty'], route: '/reservations (Restrictions)', priority: 'P1', shot: 'admin-04-restrictions-en',
    draw(f) { A(f, 'nav.reservations'); f.text(X0, 100, f.t('nav.reservations'), { size: 28, weight: 800 }); f.text(X0, 124, f.t('ah.restrictionsSub').slice(0, 120), { size: 13, fill: C.ink2 }); tabs(f, X0, 150, [f.t('ah.restrictionsTitle'), f.t('ah.lookup')], 0); table(f, X0, 210, W - X0 - 32, [{ label: f.t('ah.col.customer'), w: 320 }, { label: f.t('ah.col.strikes'), w: 140 }, { label: f.t('ah.col.until'), w: 220 }, { label: f.t('ah.col.status'), w: 180 }, { label: '', w: 160 }], [['Faisal (demo) +966•••403', '3', '15 Oct 2026', chip(f.t('ah.restrictionStatus.ACTIVE'), 'warning'), f.t('ah.lift')], ['Noura (demo) +966•••402', '3', '2 Oct 2026', chip(f.t('ah.restrictionStatus.ENDED'), 'neutral'), '']]); },
  },
  {
    id: 'A08', name: 'Audit and decision history (timeline)', journey: 'Audit', device: 'desktop', rtl: false, figma: 'none', svg: true, isNew: true,
    comps: ['Timeline', 'Actor/role meta'], sheets: [], states: ['empty'], route: '/hot-deals/[id] (History card)', priority: 'P2', shot: 'admin-02-hot-review-en',
    draw(f) { A(f, 'nav.hotDeals'); f.card(X0, 100, 760, 520, { r: 18 }); f.text(X0 + 20, 134, f.t('ah.history'), { size: 16, weight: 800 }); [['hotaction.APPROVE', 'Operations (DEALDASH_OPERATIONS) · 8 Oct 10:30', 'Offer is clear and limits are reasonable.', C.mint], ['hotaction.REQUEST_CHANGES', 'Operations · 8 Oct 10:20', 'Please add that the offer is dine-in only.', C.amber], ['hotaction.SUBMIT', 'Owner (MERCHANT_OWNER) · 8 Oct 10:15', 'PILOT_MANUAL_REVIEW', C.purple], ['hotaction.CREATE', 'Owner · 8 Oct 10:05', '', C.purple]].forEach(([k, meta, body, col], i) => { const y = 170 + i * 96; f.circle(X0 + 34, y + 14, 8, { fill: col }); if (i < 3) f.line(X0 + 34, y + 24, X0 + 34, y + 96, { stroke: C.line, sw: 2 }); f.text(X0 + 60, y + 18, f.t(k), { size: 14, weight: 800 }); f.text(X0 + 60, y + 38, meta, { size: 11, fill: C.ink2 }); if (body) f.text(X0 + 60, y + 58, body, { size: 12 }); }); },
  },
  {
    id: 'A09', name: 'Customer preview inside the workbench', journey: 'Review', device: 'desktop', rtl: false, figma: 'none', svg: true, isNew: true,
    comps: ['Preview frame (EN/AR toggle)', 'Exclusive Deal card', 'Exclusive Deal detail (embedded)'], sheets: [], states: ['EN', 'AR (RTL)', 'locked eligibility shown'], route: '/hot-deals/[id] (aside)', priority: 'P2', shot: 'admin-07-hot-review-ar',
    draw(f) { A(f, 'nav.hotDeals'); f.card(X0 + 400, 100, 360, 700, { r: 18 }); f.text(X0 + 420, 132, f.t('ah.preview'), { size: 15, weight: 800 }); f.pill(X0 + 640, 114, 'EN', { ...TONES.info, size: 11 }); f.pill(X0 + 680, 114, 'عربي', { ...TONES.neutral, size: 11 }); f.photo(X0 + 420, 150, 320, 120, { r: 14 }); f.text(X0 + 420, 300, 'Flash dinner tonight', { size: 15, weight: 800 }); f.rect(X0 + 420, 320, 320, 54, { r: 14, fill: C.warnBg }); f.text(X0 + 434, 352, '2h 15m · ' + f.t('hot.free'), { size: 14, weight: 800, ltr: true }); f.text(X0, 140, 'The preview renders the SAME customer components (HotCardView, HotDetailView embedded), so reviewers see exactly what customers see.', { size: 13, fill: C.ink2 }); },
  },

  {
    id: 'A10', name: 'Per-Hot-Deal reservation and activity feed', journey: 'Monitor', device: 'desktop', rtl: true, figma: 'none', svg: true, isNew: true,
    comps: ['Activity feed card', 'Timeline row (time, event, ref, actor)', 'Refresh button', 'Show more'], sheets: [], states: ['loading', 'empty "No activity yet"', 'error', 'more than 15 events: Show more'], route: '/hot-deals/[id] (ActivityFeed card under History)', priority: 'P1', shot: 'admin-02-hot-review-en',
    draw(f) {
      A(f, 'nav.hotDeals');
      f.text(X0, 100, '← ' + f.t('adeal.back'), { size: 13, weight: 700, fill: C.purple });
      f.text(X0, 132, 'Flash dinner tonight', { size: 24, weight: 800 });
      f.pill(X0 + 280, 112, f.t('hotstatus.LIVE'), { ...TONES.success, size: 11 });
      f.card(X0, 164, 760, 470, { r: 18 });
      f.text(X0 + 20, 198, f.t('ah.activity'), { size: 16, weight: 800 });
      f.button(X0 + 640, 178, 100, 36, f.t('ah.activityRefresh'), { fill: '#fff', color: C.navy, stroke: C.line, size: 12 });
      [['resevent.REDEEMED', '10:42', '…T2X7', 'QR'], ['resevent.CREATED', '10:41', '…T2X7', ''], ['resevent.EXPIRED', '10:12', '…AB12', ''], ['resevent.CANCELLED', '09:58', '…M3K9', 'Customer'], ['resevent.CREATED', '09:40', '…M3K9', ''], ['hotaction.APPROVE', '09:30', '', 'Operations']].forEach(([k, tm, ref, who], i) => {
        const y = 240 + i * 58;
        f.text(X0 + 20, y + 14, '2026-10-08 ' + tm, { size: 12, fill: C.ink2, ltr: true });
        f.text(X0 + 200, y + 14, f.t(k), { size: 14, weight: 800 });
        if (ref) f.text(X0 + 200, y + 34, ref + (who ? ' · ' + who : ''), { size: 12, fill: C.ink2, ltr: true });
        else if (who) f.text(X0 + 200, y + 34, who, { size: 12, fill: C.ink2 });
        if (i < 5) f.line(X0 + 20, y + 46, X0 + 740, y + 46);
      });
      f.button(X0 + 20, 590, 130, 34, f.t('ah.activityMore'), { fill: '#fff', color: C.navy, stroke: C.line, size: 12 });
    },
  },];
