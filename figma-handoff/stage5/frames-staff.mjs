import {
  C,
  TONES,
  L,
  W,
  TITLE,
  sar,
  MOBILE,
  staffChrome,
  staffHeader,
  sheetShell,
} from './lib.mjs';

/** Same adaptive result view as Stage 4 (apps/staff/features/redeem.tsx ResultView), now with the voucher variant. */
function result(f, o) {
  const tone = {
    ok: [C.greenBg, C.green],
    warn: [C.warnBg, '#F5A524'],
    stop: [C.dangerBg, '#C9213D'],
  }[o.tone];
  staffHeader(f);
  const lines = (o.body ?? '').match(/.{1,44}(\s|$)/g) ?? [];
  const nLines = Math.min(3, lines.length);
  const autoH =
    236 +
    nLines * 22 +
    16 +
    (o.facts ? o.facts.length * 36 + 32 : 0) +
    (o.buttons?.length ?? 0) * 68 +
    16 -
    80;
  f.rect(16, 80, W - 32, o.h ?? autoH, { r: 26, fill: tone[0], stroke: tone[1], sw: 2 });
  f.circle(W / 2, 140, 32, { fill: tone[1] });
  f.text(W / 2, 152, o.glyph, {
    size: 34,
    weight: 800,
    fill: o.tone === 'warn' ? '#3B2A00' : '#fff',
    align: 'middle',
    ltr: true,
  });
  f.text(W / 2, 208, o.title, { size: 26, weight: 800, align: 'middle' });
  lines
    .slice(0, 3)
    .forEach((s, i) => f.text(W / 2, 236 + i * 22, s.trim(), { size: 15, align: 'middle' }));
  let y = 236 + nLines * 22 + 16;
  if (o.facts) {
    f.rect(32, y, W - 64, o.facts.length * 36 + 16, { r: 16, fill: '#fff' });
    o.facts.forEach(([k, v], i) => {
      f.text(46, y + 32 + i * 36, k, { size: 13, fill: C.ink2 });
      f.text(W - 46, y + 32 + i * 36, v, {
        size: 14,
        weight: 800,
        align: 'end',
        ltr: /^[\d:. -]+$/.test(v) || /^(RD|VC|SAR)/.test(v),
      });
    });
    y += o.facts.length * 36 + 32;
  }
  (o.buttons ?? []).forEach((b, i) =>
    f.button(32, y + i * 68, W - 64, 56, b.label, {
      fill: b.fill ?? C.purple,
      color: b.color ?? '#fff',
      stroke: b.stroke,
    }),
  );
}

const facts = (f, extra = []) => [
  [f.t('st.voucher'), TITLE(f)],
  [f.t('st.voucherValue'), sar(f, 12000)],
  [f.t('st.customer'), L(f, 'ليلى', 'Layla')],
  [f.t('st.branch'), L(f, 'النخيل', 'Al Nakheel')],
  ...extra,
  [f.t('res.reference'), 'VC-K7QM9T'],
];
const next = (f) => [{ label: f.t('st.scanNext') }];
const meta = (extra) => ({
  journey: 'Redeem',
  device: 'mobile',
  svg: true,
  isNew: true,
  sheets: [],
  priority: 'P1',
  ...extra,
});

function historyRow(f, y, res, tone, title, time) {
  f.card(16, y, W - 32, 76, { r: 16 });
  f.pill(28, y + 14, res, { ...TONES[tone], size: 10 });
  f.text(28, y + 54, title, { size: 13, weight: 800 });
  f.text(W - 28, y + 28, time, { size: 11, fill: C.ink2, align: 'end', ltr: true });
  f.text(W - 28, y + 54, f.t('st.kind.VOUCHER') + ' · ' + f.t('st.source.QR'), {
    size: 11,
    fill: C.ink2,
    align: 'end',
  });
}

export const staff = [
  meta({
    id: 'VS01',
    name: 'Scan: camera (reservation or voucher)',
    journey: 'SCAN',
    rtl: true,
    figma: 'T03 Stage 4 scanner (REUSED, title widened)',
    isNew: false,
    comps: [
      'Scanner viewport',
      'Today counts',
      'Enter-code button',
      'Bottom bar (Scan / History / Account)',
    ],
    states: ['camera starting', 'scanning', 'camera denied → manual form'],
    route: '/ (staff/features/redeem.tsx)',
    shot: 'staff-01-voucher-valid-en',
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.scanTitle'), { size: 24, weight: 800 });
      f.text(
        16,
        116,
        f.t('st.today') +
          ': ' +
          f.t('st.redeemedCount', { n: 3 }) +
          ' · ' +
          f.t('st.rejectedCount', { n: 1 }),
        { size: 12, fill: C.ink2 },
      );
      f.rect(16, 132, W - 32, W - 32, { r: 24, fill: C.dark });
      f.rect(16 + 66, 132 + 66, W - 32 - 132, W - 32 - 132, { r: 22, stroke: '#fff', sw: 3 });
      f.rect(16, 132 + W - 32 - 44, W - 32, 44, { fill: 'rgba(11,10,46,.75)' });
      f.text(W / 2, 132 + W - 32 - 16, f.t('st.scanHint'), {
        size: 13,
        weight: 700,
        fill: '#fff',
        align: 'middle',
      });
      f.button(16, 132 + W - 32 + 16, W - 32, 52, '⌨  ' + f.t('st.enterCode'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
      });
      f.text(16, 132 + W - 32 + 96, f.t('st.privacy').slice(0, 60), { size: 11, fill: C.ink2 });
      staffChrome(f, f.t('nav.scan'));
    },
  }),
  meta({
    id: 'VS02',
    name: 'Manual code entry ("Reservation or voucher code")',
    journey: 'SCAN',
    rtl: true,
    figma: 'T04 Stage 4 manual entry (REUSED, label widened)',
    isNew: false,
    comps: ['Code field (large, LTR)', 'Primary button', 'Warning alert'],
    states: ['camera denied', 'no camera', 'rate limited'],
    route: '/ (ManualEntry)',
    shot: 'staff-ar-01-scan',
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.enterCode'), { size: 28, weight: 800 });
      f.rect(16, 112, W - 32, 64, { r: 14, fill: C.warnBg });
      f.text(30, 136, f.t('st.cameraUnavailable').slice(0, 44), {
        size: 12,
        weight: 700,
        fill: C.warn,
      });
      f.text(16, 210, f.t('st.codeLabel'), { size: 12, weight: 700, fill: C.ink2 });
      f.rect(16, 220, W - 32, 72, { r: 14, fill: '#fff', stroke: C.purple, sw: 2 });
      f.text(W / 2, 268, 'K7QM-9T2X', { size: 30, weight: 800, align: 'middle', ltr: true });
      f.text(16, 312, f.t('st.codeHint'), { size: 11, fill: C.ink2 });
      f.button(16, 336, W - 32, 56, f.t('st.check'));
      f.button(16, 404, W - 32, 56, '▣  ' + f.t('st.useCamera'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
      });
      staffChrome(f, f.t('nav.scan'));
    },
  }),
  meta({
    id: 'VS03',
    name: 'VALIDATE: valid voucher (value to honour)',
    journey: 'VALIDATE',
    rtl: true,
    figma: 'T05 Stage 4 result card (REUSED, voucher facts)',
    isNew: false,
    comps: ['Result card (ok)', 'Voucher detail facts', 'Voucher value', 'Redeem button'],
    states: ['VALID'],
    route: '/ (ResultView, kind = VOUCHER)',
    shot: 'staff-01-voucher-valid-en',
    draw(f) {
      result(f, {
        tone: 'ok',
        glyph: '✓',
        title: f.t('st.valid'),
        body: f.t('st.validBodyVoucher'),
        facts: facts(f, [[f.t('st.expires'), '19 Nov 2026']]),
        buttons: [
          { label: f.t('st.redeem'), fill: '#0E8F6A' },
          { label: f.t('st.cancelScan'), fill: '#fff', color: C.navy, stroke: C.line },
        ],
      });
    },
  }),
  meta({
    id: 'VS04',
    name: 'REDEEM: confirmation sheet (voucher)',
    journey: 'REDEEM',
    rtl: true,
    figma: 'T21 Stage 4 confirm sheet (REUSED, voucher wording)',
    isNew: false,
    comps: ['Bottom sheet', 'Facts list', 'Irreversible warning', 'Confirm (locked after tap)'],
    states: ['confirm', 'processing'],
    route: '/ (BottomSheet redeem-sheet)',
    shot: 'staff-02-voucher-confirm-en',
    draw(f) {
      result(f, {
        tone: 'ok',
        glyph: '✓',
        title: f.t('st.valid'),
        body: f.t('st.validBodyVoucher'),
        facts: facts(f),
        buttons: [{ label: f.t('st.redeem'), fill: '#0E8F6A' }],
      });
      sheetShell(f, 520, f.t('st.confirmSheet.titleVoucher'));
      [
        [f.t('st.voucher'), TITLE(f)],
        [f.t('st.voucherValue'), sar(f, 12000)],
        [f.t('st.customer'), L(f, 'ليلى', 'Layla')],
        [f.t('st.branch'), L(f, 'النخيل', 'Al Nakheel')],
        [f.t('res.reference'), 'VC-K7QM9T'],
      ].forEach(([k, v], i) => {
        f.text(20, 844 - 520 + 90 + i * 34, k, { size: 12, fill: C.ink2 });
        f.text(W - 20, 844 - 520 + 90 + i * 34, v, {
          size: 13,
          weight: 800,
          align: 'end',
          ltr: /^(SAR|VC)/.test(v),
        });
      });
      f.rect(20, 844 - 520 + 270, W - 40, 70, { r: 14, fill: C.warnBg });
      (f.t('st.confirmSheet.warnVoucher').match(/.{1,44}(\s|$)/g) ?? [])
        .slice(0, 3)
        .forEach((l, i) =>
          f.text(32, 844 - 520 + 294 + i * 17, l.trim(), { size: 12, weight: 700, fill: C.warn }),
        );
      f.button(20, 844 - 136, W - 40, 56, f.t('st.confirm'), { fill: '#0E8F6A' });
      f.button(20, 844 - 68, W - 40, 48, f.t('common.cancel'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
      });
    },
  }),
  meta({
    id: 'VS05',
    name: 'REDEEM: processing (locked)',
    journey: 'REDEEM',
    rtl: false,
    figma: 'T06 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Working card (aria-busy)'],
    states: ['checking', 'confirming (no double tap)'],
    route: '/ (phase working)',
    priority: 'P2',
    shot: null,
    draw(f) {
      staffHeader(f);
      f.rect(16, 120, W - 32, 140, { r: 26, fill: C.warnBg, stroke: '#F5A524', sw: 2 });
      f.text(W / 2, 200, f.t('st.confirming'), { size: 26, weight: 800, align: 'middle' });
    },
  }),
  meta({
    id: 'VS06',
    name: 'REDEEM: success',
    journey: 'REDEEM',
    rtl: true,
    figma: 'T07 Stage 4 (REUSED, voucher wording)',
    isNew: false,
    comps: ['Result card (ok)', 'Reference', 'Scan next'],
    states: ['redeemed + reference RD-…'],
    route: '/ (phase done)',
    shot: 'staff-03-voucher-redeemed-en',
    draw(f) {
      result(f, {
        tone: 'ok',
        glyph: '✓',
        title: f.t('st.done'),
        body: f.t('st.doneVoucher'),
        facts: facts(f).map(([k, v]) => (k === f.t('res.reference') ? [k, 'RD-ABC234'] : [k, v])),
        buttons: next(f),
      });
    },
  }),
  meta({
    id: 'VS07',
    name: 'Invalid code',
    journey: 'VALIDATE',
    rtl: false,
    figma: 'T08 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Result card (stop)'],
    states: ['unknown / malformed QR / other merchant (no leak)'],
    route: '/ (ResultView)',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'stop',
        glyph: '✕',
        title: f.t('st.result.INVALID_CODE'),
        body: f.t('st.result.INVALID_CODE.body'),
        h: 330,
        buttons: next(f),
      });
    },
  }),
  meta({
    id: 'VS08',
    name: 'Not yet valid (amber)',
    journey: 'VALIDATE',
    rtl: false,
    figma: 'T22 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Result card (warn)', 'Start date fact'],
    states: ['voucher valid from a future date'],
    route: '/ (ResultView)',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'warn',
        glyph: '◔',
        title: f.t('st.result.NOT_VALID_YET'),
        body: f.t('st.result.NOT_VALID_YET.body'),
        facts: facts(f, [[f.t('st.startsAt'), '12 Nov 2026']]),
        buttons: next(f),
      });
    },
  }),
  meta({
    id: 'VS09',
    name: 'Expired (amber)',
    journey: 'VALIDATE',
    rtl: false,
    figma: 'T09 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Result card (warn)'],
    states: ['validity ended'],
    route: '/ (ResultView)',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'warn',
        glyph: '◔',
        title: f.t('st.result.EXPIRED'),
        body: f.t('st.result.EXPIRED.body'),
        facts: facts(f, [[f.t('st.expires'), '7 Nov 2026']]),
        buttons: next(f),
      });
    },
  }),
  meta({
    id: 'VS10',
    name: 'Already redeemed (red)',
    journey: 'VALIDATE',
    rtl: true,
    figma: 'T10 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Result card (stop)', 'Facts: when / where'],
    states: ['replay / duplicate scan / lost race'],
    route: '/ (ResultView)',
    shot: 'staff-04-voucher-replay-en',
    draw(f) {
      result(f, {
        tone: 'stop',
        glyph: '!',
        title: f.t('st.result.ALREADY_REDEEMED'),
        body: f.t('st.result.ALREADY_REDEEMED.body'),
        facts: facts(f, [[f.t('st.usedAt'), '10:42 · ' + L(f, 'النخيل', 'Al Nakheel')]]),
        buttons: next(f),
      });
    },
  }),
  meta({
    id: 'VS11',
    name: 'Wrong branch (amber)',
    journey: 'VALIDATE',
    rtl: false,
    figma: 'T11 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Result card (warn)', 'Valid-at branch'],
    states: ['valid at another branch of the same merchant'],
    route: '/ (ResultView)',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'warn',
        glyph: '⌖',
        title: f.t('st.result.WRONG_BRANCH'),
        body: f.t('st.result.WRONG_BRANCH.body', { branch: L(f, 'حطين', 'Hittin') }),
        facts: facts(f),
        buttons: next(f),
      });
    },
  }),
  meta({
    id: 'VS12',
    name: 'Voucher suspended by DealDash (red)',
    journey: 'VALIDATE',
    rtl: true,
    figma: 'none (new result)',
    isNew: true,
    comps: ['Result card (stop)'],
    states: ['VOUCHER_SUSPENDED: sold vouchers are blocked only by suspension'],
    route: '/ (ResultView)',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'stop',
        glyph: '⊘',
        title: f.t('st.result.VOUCHER_SUSPENDED'),
        body: f.t('st.result.VOUCHER_SUSPENDED.body'),
        facts: facts(f),
        buttons: next(f),
      });
    },
  }),
  meta({
    id: 'VS13',
    name: 'Refunded / cancelled voucher (red)',
    journey: 'VALIDATE',
    rtl: true,
    figma: 'none (new result)',
    isNew: true,
    comps: ['Result card (stop)'],
    states: ['REFUNDED (also while a refund is in progress)'],
    route: '/ (ResultView)',
    shot: 'staff-05-voucher-refunded-en',
    draw(f) {
      result(f, {
        tone: 'stop',
        glyph: '✕',
        title: f.t('st.result.REFUNDED'),
        body: f.t('st.result.REFUNDED.body'),
        facts: facts(f),
        buttons: next(f),
      });
    },
  }),
  meta({
    id: 'VS14',
    name: 'Merchant or campaign suspended (red)',
    journey: 'VALIDATE',
    rtl: false,
    figma: 'T13 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Result card (stop)'],
    states: ['CAMPAIGN_UNAVAILABLE', 'NOT_ACTIVE', 'INELIGIBLE (n/a for paid vouchers)'],
    route: '/ (ResultView)',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'stop',
        glyph: '⊘',
        title: f.t('st.result.CAMPAIGN_UNAVAILABLE'),
        body: f.t('st.result.CAMPAIGN_UNAVAILABLE.body'),
        facts: facts(f),
        buttons: next(f),
      });
    },
  }),
  meta({
    id: 'VS15',
    name: 'Connectivity error while confirming (safe retry)',
    journey: 'REDEEM',
    rtl: true,
    figma: 'T15 / T16 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Offline card', 'Retry (same Idempotency-Key)', 'Offline banner'],
    states: ['offline banner', 'lost connection while confirming', 'rate limited'],
    route: '/ (phase offline)',
    shot: null,
    draw(f) {
      staffHeader(f);
      f.rect(16, 72, W - 32, 56, { r: 14, fill: C.warnBg });
      f.text(30, 96, '≈ ' + f.t('st.offlineTitle'), { size: 13, weight: 800 });
      f.text(30, 114, f.t('st.offlineBody').slice(0, 48), { size: 11, fill: C.ink2 });
      f.rect(16, 150, W - 32, 330, { r: 26, fill: C.warnBg, stroke: '#F5A524', sw: 2 });
      f.circle(W / 2, 214, 32, { fill: '#F5A524' });
      f.text(W / 2, 226, '≈', {
        size: 32,
        weight: 800,
        fill: '#3B2A00',
        align: 'middle',
        ltr: true,
      });
      f.text(W / 2, 282, f.t('st.offlineTitle'), { size: 24, weight: 800, align: 'middle' });
      (f.t('st.unsure').match(/.{1,44}(\s|$)/g) ?? [])
        .slice(0, 2)
        .forEach((l, i) => f.text(W / 2, 310 + i * 20, l.trim(), { size: 13, align: 'middle' }));
      f.button(32, 372, W - 64, 56, f.t('st.retry'));
      f.button(32, 440, W - 64, 56, f.t('st.cancelScan'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
      });
    },
  }),
  meta({
    id: 'VS16',
    name: 'History: vouchers and reservations',
    journey: 'History',
    rtl: true,
    figma: 'T18 Stage 4 (REUSED, voucher rows)',
    isNew: false,
    comps: ['Filter chips', 'History row (result chip + kind)', 'Counts'],
    states: ['today / yesterday', 'empty', 'search by code'],
    route: '/history',
    priority: 'P2',
    shot: null,
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.historyTitle'), { size: 28, weight: 800 });
      f.text(
        16,
        118,
        f.t('st.today') +
          ': ' +
          f.t('st.redeemedCount', { n: 4 }) +
          ' · ' +
          f.t('st.rejectedCount', { n: 2 }),
        { size: 12, fill: C.ink2 },
      );
      let x = 16;
      [f.t('st.filterAll'), f.t('st.filterRedeemed'), f.t('st.filterRejected')].forEach((s, i) => {
        x +=
          f.pill(x, 132, s, {
            fill: i === 0 ? C.purple : '#fff',
            color: i === 0 ? '#fff' : C.navy,
            size: 12,
          }) + 8;
      });
      historyRow(f, 176, f.t('st.result.REDEEMED'), 'success', TITLE(f), '10:42');
      historyRow(f, 264, f.t('st.result.REFUNDED'), 'danger', TITLE(f), '10:31');
      historyRow(f, 352, f.t('st.result.ALREADY_REDEEMED'), 'danger', TITLE(f), '10:30');
      historyRow(
        f,
        440,
        f.t('st.result.EXPIRED'),
        'warning',
        L(f, 'قسيمة سبا بقيمة 200 ريال', 'SAR 200 spa voucher'),
        '09:58',
      );
      historyRow(
        f,
        528,
        f.t('st.result.REDEEMED'),
        'success',
        L(f, 'حلى مجاني مع أي طبق', 'Free dessert with any main'),
        '09:12',
      );
      staffChrome(f, f.t('nav.history'));
    },
  }),
  meta({
    id: 'VS17',
    name: 'History detail sheet (voucher)',
    journey: 'History',
    rtl: false,
    figma: 'T23 / T24 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Bottom sheet', 'Facts list (no phone number)'],
    states: ['result, voucher, customer first name, time, source'],
    route: '/history',
    priority: 'P2',
    shot: null,
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.historyTitle'), { size: 28, weight: 800 });
      sheetShell(f, 480, f.t('st.detail.title'));
      [
        [f.t('st.detail.result'), f.t('st.result.REDEEMED')],
        [f.t('st.voucher'), TITLE(f)],
        [f.t('st.customer'), L(f, 'ليلى', 'Layla')],
        [f.t('st.detail.time'), '8 Oct 2026, 10:42'],
        [f.t('st.detail.how'), f.t('st.source.QR')],
        [f.t('res.reference'), 'RD-ABC234'],
      ].forEach(([k, v], i) => {
        f.text(20, 844 - 480 + 92 + i * 38, k, { size: 12, fill: C.ink2 });
        f.text(W - 20, 844 - 480 + 92 + i * 38, v, {
          size: 13,
          weight: 800,
          align: 'end',
          ltr: /^(RD|8 Oct)/.test(v),
        });
      });
      f.button(20, 844 - 88, W - 40, 56, f.t('st.close'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
      });
    },
  }),
  meta({
    id: 'VS18',
    name: 'Result colour model (board)',
    journey: 'Reference',
    rtl: false,
    figma: 'Stage 4 K03 (extended)',
    isNew: true,
    comps: ['Result card tones'],
    states: [
      'green: Valid, Redeemed',
      'amber: Not valid yet, Expired, Wrong branch',
      'red: Invalid, Already redeemed, Voucher suspended, Refunded, Campaign suspended, Not active',
    ],
    route: 'apps/staff/features/redeem.tsx (toneOf)',
    priority: 'P1',
    shot: null,
    draw(f) {
      f.text(16, 40, 'Staff result colours (Stage 4 model, extended)', { size: 18, weight: 800 });
      [
        [C.greenBg, C.green, ['st.valid', 'st.done']],
        [
          C.warnBg,
          '#F5A524',
          ['st.result.NOT_VALID_YET', 'st.result.EXPIRED', 'st.result.WRONG_BRANCH'],
        ],
        [
          C.dangerBg,
          '#C9213D',
          [
            'st.result.INVALID_CODE',
            'st.result.ALREADY_REDEEMED',
            'st.result.VOUCHER_SUSPENDED',
            'st.result.REFUNDED',
            'st.result.CAMPAIGN_UNAVAILABLE',
            'st.result.NOT_ACTIVE',
          ],
        ],
      ].forEach(([bg, bd, keys], bi) => {
        const y = 70 + [0, 130, 280][bi];
        f.rect(16, y, W - 32, 40 + keys.length * 26 + 14, { r: 20, fill: bg, stroke: bd, sw: 2 });
        f.text(32, y + 28, ['green: success', 'amber: recoverable', 'red: hard failure'][bi], {
          size: 14,
          weight: 800,
        });
        keys.forEach((k, i) =>
          f.text(32, y + 54 + i * 26, '•  ' + f.t(k), { size: 13, weight: 600 }),
        );
      });
      f.text(
        16,
        560,
        'Colour is never the only signal: every result has a glyph, a title and a next action.',
        { size: 12, fill: C.ink2 },
      );
    },
  }),
];
void MOBILE;
