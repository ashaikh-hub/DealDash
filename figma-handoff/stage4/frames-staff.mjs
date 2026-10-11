import { C, MOBILE, staffChrome, staffHeader, TONES } from './lib.mjs';

const W = MOBILE.w;
// accepts the pair in either order: the Arabic string is detected, so a frame can never show the wrong language
const L = (f, a, b) => {
  const [en, ar] = /[\u0600-\u06FF]/.test(a) ? [b, a] : [a, b];
  return f.lang === 'ar' ? ar : en;
};

/** The one adaptive result view. tone: ok | warn | stop. Matches apps/staff/features/redeem.tsx (ResultView). */
function result(f, o) {
  const tone = {
    ok: [C.greenBg, C.green],
    warn: [C.warnBg, '#F5A524'],
    stop: [C.dangerBg, '#C9213D'],
  }[o.tone];
  staffHeader(f);
  const nLines = Math.min(3, ((o.body ?? '').match(/.{1,44}(\s|$)/g) ?? []).length);
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
  const lines = (o.body ?? '').match(/.{1,44}(\s|$)/g) ?? [];
  lines
    .slice(0, 3)
    .forEach((s, i) => f.text(W / 2, 236 + i * 22, s.trim(), { size: 15, align: 'middle' }));
  let y = 236 + Math.min(3, lines.length) * 22 + 16;
  if (o.facts) {
    f.rect(32, y, W - 64, o.facts.length * 36 + 16, { r: 16, fill: '#fff' });
    o.facts.forEach(([k, v], i) => {
      f.text(46, y + 32 + i * 36, k, { size: 13, fill: C.ink2 });
      f.text(W - 46, y + 32 + i * 36, v, {
        size: 14,
        weight: 800,
        align: 'end',
        ltr: /^[\d:. -]+$/.test(v) || /^(RD|DD)-/.test(v),
      });
    });
    y += o.facts.length * 36 + 32;
  }
  (o.buttons ?? []).forEach((b, i) => {
    f.button(32, y + i * 68, W - 64, 56, b.label, {
      fill: b.fill ?? C.purple,
      color: b.color ?? '#fff',
      stroke: b.stroke,
    });
  });
}

const facts = (f, extra = []) => [
  [f.t('st.offer'), L(f, 'حلى مجاني مع أي طبق', 'Free dessert with any main')],
  [f.t('st.quantity'), '1'],
  [f.t('st.customer'), L(f, 'ليلى', 'Layla')],
  [f.t('st.branch'), L(f, 'النخيل', 'Al Nakheel')],
  ...extra,
  [f.t('res.reference'), 'DD-K7QM9T'],
];
const next = (f) => [{ label: f.t('st.scanNext') }];

export const staff = [
  {
    id: 'T01',
    name: 'Sign in: mobile number',
    journey: 'Sign in',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T01)',
    svg: false,
    isNew: true,
    comps: ['Phone field', 'Primary button', 'Language switch'],
    sheets: [],
    states: ['enter number', 'no access / not invited'],
    route: '/ (LoginPanel via RequireAuth)',
    priority: 'P1',
    shot: null,
    draw(f) {
      f.text(W / 2, 150, f.t('brand.name'), {
        size: 32,
        weight: 800,
        fill: C.purple,
        align: 'middle',
      });
      f.text(W / 2, 176, f.t('app.staff'), { size: 13, fill: C.ink2, align: 'middle' });
      f.text(24, 250, f.t('st.signInTitle'), { size: 24, weight: 800 });
      f.text(24, 274, f.t('st.signInBody').slice(0, 50), { size: 13, fill: C.ink2 });
      f.text(24, 292, f.t('st.signInBody').slice(50, 110), { size: 13, fill: C.ink2 });
      f.text(24, 336, f.t('auth.mobile'), { size: 12, weight: 700, fill: C.ink2 });
      f.rect(24, 346, W - 48, 56, { r: 14, fill: '#fff', stroke: C.line });
      f.text(40, 381, '+966 5X XXX XXXX', { size: 15, fill: C.ink2, ltr: true });
      f.button(24, 424, W - 48, 56, f.t('auth.sendCode'));
    },
  },
  {
    id: 'T02',
    name: 'Sign in: one-time code',
    journey: 'Sign in',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T01)',
    svg: false,
    isNew: true,
    comps: ['OTP boxes (always LTR)', 'Resend'],
    sheets: [],
    states: ['wrong code', 'expired code', 'locked out'],
    route: '/ (LoginPanel)',
    priority: 'P1',
    shot: null,
    draw(f) {
      f.text(W / 2, 150, f.t('brand.name'), {
        size: 32,
        weight: 800,
        fill: C.purple,
        align: 'middle',
      });
      f.text(24, 250, f.t('auth.code'), { size: 24, weight: 800 });
      for (let i = 0; i < 6; i++) {
        const x = 24 + i * 57;
        f.rect(x, 300, 48, 60, {
          r: 12,
          fill: '#fff',
          stroke: i === 3 ? C.purple : C.line,
          sw: i === 3 ? 2 : 1,
        });
        if (i < 3)
          f.text(x + 24, 340, String(4 + i), { size: 22, weight: 800, align: 'middle', ltr: true });
      }
      f.text(24, 392, f.t('error.OTP_INVALID'), { size: 12, fill: C.danger });
      f.button(24, 420, W - 48, 56, f.t('auth.verify'));
      f.text(W / 2, 508, f.t('auth.resend'), {
        size: 13,
        weight: 700,
        fill: C.purple,
        align: 'middle',
      });
    },
  },
  {
    id: 'T03',
    name: 'Scanner (camera) with manual-entry fallback',
    journey: 'SCAN',
    device: 'mobile',
    rtl: true,
    figma: 'none (Business console - Redeem is REPLACED)',
    svg: true,
    isNew: true,
    comps: [
      'Scanner viewport',
      'Today counts',
      'Enter-code button',
      'Bottom bar (Scan/History/Account)',
    ],
    sheets: [],
    states: ['camera starting', 'scanning', 'camera denied → manual form'],
    route: '/ (staff/features/redeem.tsx)',
    priority: 'P1',
    shot: 'staff-01-scan-en',
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.scanTitle'), { size: 28, weight: 800 });
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
  },
  {
    id: 'T04',
    name: 'Manual code entry (also camera-denied)',
    journey: 'SCAN',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T02 manual sheet)',
    svg: true,
    isNew: true,
    comps: ['Code field (large, LTR)', 'Primary button', 'Warning alert'],
    sheets: [],
    states: ['camera denied', 'no camera', 'rate limited'],
    route: '/ (ManualEntry)',
    priority: 'P1',
    shot: 'staff-10-no-camera-en',
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.enterCode'), { size: 28, weight: 800 });
      f.rect(16, 112, W - 32, 64, { r: 14, fill: C.warnBg });
      f.text(30, 136, f.t('st.cameraUnavailable').slice(0, 44), {
        size: 12,
        weight: 700,
        fill: C.warn,
      });
      f.text(30, 154, f.t('st.cameraUnavailable').slice(44, 90), {
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
  },
  {
    id: 'T05',
    name: 'VALIDATE: valid reservation',
    journey: 'VALIDATE',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T03)',
    svg: true,
    isNew: true,
    comps: ['Result card (ok)', 'Facts list', 'Confirm button', 'Countdown'],
    sheets: [],
    states: ['valid'],
    route: '/ (ResultView)',
    priority: 'P1',
    shot: 'staff-02-valid-en',
    draw(f) {
      result(f, {
        tone: 'ok',
        glyph: '✓',
        title: f.t('st.valid'),
        body: f.t('st.validBody'),
        facts: facts(f, [[f.t('st.expires'), '19:42']]),
        buttons: [
          { label: f.t('st.redeem'), fill: '#0E8F6A' },
          { label: f.t('st.cancelScan'), fill: '#fff', color: C.navy, stroke: C.line },
        ],
      });
    },
  },
  {
    id: 'T06',
    name: 'REDEEM: processing (locked)',
    journey: 'REDEEM',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T04)',
    svg: true,
    isNew: true,
    comps: ['Working card (aria-busy)'],
    sheets: [],
    states: ['checking', 'confirming (no double tap)'],
    route: '/ (phase working)',
    priority: 'P2',
    shot: null,
    draw(f) {
      staffHeader(f);
      f.rect(16, 120, W - 32, 140, { r: 26, fill: C.warnBg, stroke: '#F5A524', sw: 2 });
      f.text(W / 2, 200, f.t('st.confirming'), { size: 26, weight: 800, align: 'middle' });
      f.text(W / 2, 232, f.t('st.unsure').slice(0, 50), {
        size: 11,
        fill: C.ink2,
        align: 'middle',
      });
    },
  },
  {
    id: 'T07',
    name: 'REDEEM: success',
    journey: 'REDEEM',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T04)',
    svg: true,
    isNew: true,
    comps: ['Result card (ok)', 'Reference', 'Scan next'],
    sheets: [],
    states: ['redeemed + reference'],
    route: '/ (phase done)',
    priority: 'P1',
    shot: 'staff-03-redeemed-en',
    draw(f) {
      result(f, {
        tone: 'ok',
        glyph: '✓',
        title: f.t('st.done'),
        body: f.t('st.doneBody'),
        facts: facts(f).map(([k, v]) => (k === f.t('res.reference') ? [k, 'RD-ABC234'] : [k, v])),
        buttons: next(f),
      });
    },
  },
  {
    id: 'T08',
    name: 'Invalid code',
    journey: 'VALIDATE',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T03)',
    svg: true,
    isNew: true,
    comps: ['Result card (stop)'],
    sheets: [],
    states: ['unknown / malformed / other merchant (no leak)'],
    route: '/ (ResultView)',
    priority: 'P1',
    shot: 'staff-05-invalid-en',
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
  },
  {
    id: 'T09',
    name: 'Expired reservation ("Reservation not completed")',
    journey: 'VALIDATE',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T03)',
    svg: true,
    isNew: true,
    comps: ['Result card (warn)'],
    sheets: [],
    states: ['hold ended'],
    route: '/ (ResultView)',
    priority: 'P1',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'warn',
        glyph: '◔',
        title: f.t('st.result.EXPIRED'),
        body: f.t('st.result.EXPIRED.body'),
        facts: facts(f, [[f.t('st.expires'), '10:12']]),
        buttons: next(f),
      });
    },
  },
  {
    id: 'T10',
    name: 'Already redeemed',
    journey: 'VALIDATE',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T03)',
    svg: true,
    isNew: true,
    comps: ['Result card (stop)', 'Facts: when/where'],
    sheets: [],
    states: ['replay / duplicate scan / lost race'],
    route: '/ (ResultView)',
    priority: 'P1',
    shot: 'staff-04-already-used-en',
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
  },
  {
    id: 'T11',
    name: 'Wrong branch',
    journey: 'VALIDATE',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T03)',
    svg: true,
    isNew: true,
    comps: ['Result card (stop)'],
    sheets: [],
    states: ['valid at another branch of the same merchant'],
    route: '/ (ResultView)',
    priority: 'P1',
    shot: 'staff-07-wrong-branch-en',
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
  },
  {
    id: 'T12',
    name: 'Eligibility failed',
    journey: 'VALIDATE',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T03)',
    svg: true,
    isNew: true,
    comps: ['Result card (stop)', 'Requirement text (no personal data)'],
    sheets: [],
    states: ['rule needs current eligibility'],
    route: '/ (ResultView)',
    priority: 'P2',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'stop',
        glyph: '⊘',
        title: f.t('st.result.INELIGIBLE'),
        body: f.t('st.result.INELIGIBLE.body', { requirement: 'verified employee' }),
        facts: facts(f),
        buttons: next(f),
      });
    },
  },
  {
    id: 'T13',
    name: 'Reservation not active (cancelled)',
    journey: 'VALIDATE',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T03)',
    svg: true,
    isNew: true,
    comps: ['Result card (stop)'],
    sheets: [],
    states: ['cancelled or released'],
    route: '/ (ResultView)',
    priority: 'P2',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'stop',
        glyph: '✕',
        title: f.t('st.result.NOT_ACTIVE'),
        body: f.t('st.result.NOT_ACTIVE.body'),
        facts: facts(f),
        buttons: next(f),
      });
    },
  },
  {
    id: 'T14',
    name: 'Campaign suspended / blocked / paused (red)',
    journey: 'VALIDATE',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T03)',
    svg: true,
    isNew: true,
    comps: ['Result card (stop)'],
    sheets: [],
    states: ['paused', 'suspended', 'cancelled campaign'],
    route: '/ (ResultView)',
    priority: 'P2',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'stop',
        glyph: '⚿',
        title: f.t('st.result.CAMPAIGN_UNAVAILABLE'),
        body: f.t('st.result.CAMPAIGN_UNAVAILABLE.body'),
        facts: facts(f),
        buttons: next(f),
      });
    },
  },
  {
    id: 'T15',
    name: 'Connectivity error with retry (same key)',
    journey: 'REDEEM',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc §8)',
    svg: true,
    isNew: true,
    comps: ['Offline panel', 'Retry button'],
    sheets: [],
    states: [
      'request lost',
      'retry reuses Idempotency-Key',
      'never shows success without server confirmation',
    ],
    route: '/ (phase offline)',
    priority: 'P1',
    shot: 'staff-06-offline-en',
    draw(f) {
      staffHeader(f);
      f.rect(16, 80, W - 32, 440, { r: 26, fill: C.warnBg, stroke: '#F5A524', sw: 2 });
      f.circle(W / 2, 140, 32, { fill: '#F5A524' });
      f.text(W / 2, 150, '≈', {
        size: 34,
        weight: 800,
        fill: '#3B2A00',
        align: 'middle',
        ltr: true,
      });
      f.text(W / 2, 208, f.t('st.offlineTitle'), { size: 26, weight: 800, align: 'middle' });
      f.text(W / 2, 240, f.t('st.offlineBody').slice(0, 44), { size: 14, align: 'middle' });
      f.text(W / 2, 262, f.t('st.offlineBody').slice(44, 88), { size: 14, align: 'middle' });
      f.text(W / 2, 284, f.t('st.offlineBody').slice(88, 140), { size: 14, align: 'middle' });
      f.text(W / 2, 330, f.t('st.unsure').slice(0, 56), {
        size: 11,
        fill: C.ink2,
        align: 'middle',
      });
      f.button(32, 380, W - 64, 56, f.t('st.retry'));
      f.button(32, 446, W - 64, 56, f.t('st.cancelScan'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
      });
    },
  },
  {
    id: 'T16',
    name: 'Offline banner and disabled actions',
    journey: 'REDEEM',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc §8)',
    svg: true,
    isNew: true,
    comps: ['Offline banner', 'Disabled button'],
    sheets: [],
    states: ['device offline: banner, check/confirm disabled'],
    route: '/ (offline-banner)',
    priority: 'P2',
    shot: 'staff-06b-offline-banner-en',
    draw(f) {
      staffHeader(f);
      f.rect(16, 76, W - 32, 70, { r: 16, fill: C.warnBg });
      f.text(32, 102, '≈  ' + f.t('st.offlineTitle'), { size: 14, weight: 800, fill: '#5a3b00' });
      f.text(32, 122, f.t('st.offlineBody').slice(0, 52), { size: 11, fill: '#5a3b00' });
      f.text(16, 190, f.t('st.enterCode'), { size: 28, weight: 800 });
      f.rect(16, 220, W - 32, 72, { r: 14, fill: '#fff', stroke: C.line });
      f.text(W / 2, 268, 'K7QM-9T2X', {
        size: 30,
        weight: 800,
        align: 'middle',
        ltr: true,
        fill: C.ink2,
      });
      f.button(16, 316, W - 32, 56, f.t('st.check'), { fill: C.line, color: C.ink2 });
      staffChrome(f, f.t('nav.scan'));
    },
  },
  {
    id: 'T17',
    name: 'Rate limited (too many wrong codes)',
    journey: 'VALIDATE',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc §8)',
    svg: true,
    isNew: true,
    comps: ['Result card (stop)'],
    sheets: [],
    states: ['5 wrong codes per minute'],
    route: '/ (phase error)',
    priority: 'P3',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'stop',
        glyph: '!',
        title: f.t('st.offlineTitle').replace(f.t('st.offlineTitle'), f.t('state.error')),
        body: f.t('st.rateLimited'),
        h: 300,
        buttons: next(f),
      });
    },
  },
  {
    id: 'T18',
    name: 'Today / history',
    journey: 'History',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T05)',
    svg: true,
    isNew: true,
    comps: ['Day toggle', 'Count tiles', 'Search field', 'Filter chips', 'History row (tappable)'],
    sheets: ['T24 Scan details sheet'],
    states: ['today', 'yesterday', 'empty', 'error + retry', 'search results (T23)'],
    route: '/history',
    priority: 'P1',
    shot: 'staff-08-history-en',
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.historyTitle'), { size: 28, weight: 800 });
      f.rect(16, 112, 200, 40, { r: 20, fill: C.slate });
      f.rect(19, 115, 97, 34, { r: 17, fill: '#fff' });
      f.text(67, 137, f.t('st.today'), { size: 13, weight: 700, fill: C.purple, align: 'middle' });
      f.text(167, 137, f.t('st.yesterday'), {
        size: 13,
        weight: 700,
        fill: C.ink2,
        align: 'middle',
      });
      f.card(16, 168, 170, 70, { r: 16 });
      f.text(32, 206, '3', { size: 26, weight: 800, ltr: true });
      f.text(32, 226, f.t('st.filterRedeemed'), { size: 11, fill: C.ink2 });
      f.card(204, 168, 170, 70, { r: 16 });
      f.text(220, 206, '2', { size: 26, weight: 800, ltr: true });
      f.text(220, 226, f.t('st.filterRejected'), { size: 11, fill: C.ink2 });
      f.rect(16, 252, W - 32, 44, { r: 14, fill: '#fff', stroke: C.line });
      f.text(32, 280, f.t('st.searchPlaceholder'), { size: 13, fill: C.ink2 });
      let x = 16;
      ['st.filterAll', 'st.filterRedeemed', 'st.filterRejected'].forEach((k, i) => {
        x +=
          f.pill(x, 310, f.t(k), {
            fill: i === 0 ? C.purple : '#fff',
            color: i === 0 ? '#fff' : C.navy,
            size: 12,
          }) + 8;
      });
      [
        ['st.result.REDEEMED', 'success'],
        ['st.result.ALREADY_REDEEMED', 'danger'],
        ['st.result.WRONG_BRANCH', 'danger'],
        ['st.result.REDEEMED', 'success'],
      ].forEach(([k, tone], i) => {
        const y = 358 + i * 76;
        f.card(16, y, W - 32, 64, { r: 16 });
        f.pill(28, y + 18, f.t(k), { fill: TONES[tone].fill, color: TONES[tone].color, size: 10 });
        f.text(150, y + 28, L(f, 'حلى مجاني مع أي طبق', 'Free dessert with any main'), {
          size: 12,
          weight: 800,
        });
        f.text(150, y + 46, '10:4' + i + ' · Layla · ×1 · QR', {
          size: 11,
          fill: C.ink2,
          ltr: true,
        });
      });
      staffChrome(f, f.t('nav.history'));
    },
  },
  {
    id: 'T19',
    name: 'Account',
    journey: 'Account',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T06)',
    svg: true,
    isNew: true,
    comps: ['Account card', 'Language pills', 'Sign out'],
    sheets: [],
    states: ['single branch', 'all branches', 'no redeem permission'],
    route: '/account',
    priority: 'P2',
    shot: 'staff-09-account-en',
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.accountTitle'), { size: 28, weight: 800 });
      f.card(16, 116, W - 32, 220, { r: 22 });
      f.text(32, 148, f.t('st.signedInAs', { name: 'Khalid' }), { size: 15, weight: 800 });
      f.text(32, 184, f.t('st.workingAt'), { size: 11, fill: C.ink2 });
      f.text(32, 204, 'Najd Kitchen · Al Nakheel', { size: 14, weight: 800 });
      f.text(32, 240, f.t('st.privacy').slice(0, 52), { size: 11, fill: C.ink2 });
      f.button(32, 272, W - 64, 48, f.t('auth.signOut'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
      });
      staffChrome(f, f.t('nav.account'));
    },
  },
  {
    id: 'T20',
    name: 'Camera permission denied',
    journey: 'SCAN',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc §8)',
    svg: true,
    isNew: true,
    comps: ['Scanner empty state', 'Enter-code button'],
    sheets: [],
    states: ['denied', 'unavailable'],
    route: '/ (CameraScanner)',
    priority: 'P2',
    shot: null,
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.scanTitle'), { size: 28, weight: 800 });
      f.rect(16, 132, W - 32, W - 32, { r: 24, fill: C.dark });
      f.circle(W / 2, 250, 26, { stroke: '#fff', sw: 2 });
      f.text(W / 2, 258, '!', { size: 28, weight: 800, fill: '#fff', align: 'middle' });
      f.text(W / 2, 320, f.t('st.cameraDenied').slice(0, 40), {
        size: 13,
        fill: '#fff',
        align: 'middle',
      });
      f.text(W / 2, 340, f.t('st.cameraDenied').slice(40, 84), {
        size: 13,
        fill: '#fff',
        align: 'middle',
      });
      f.button(16, 132 + W - 32 + 16, W - 32, 52, '⌨  ' + f.t('st.enterCode'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
      });
      staffChrome(f, f.t('nav.scan'));
    },
  },

  // ------------------------------------------------------------------ final Stage 4 decisions (closed gaps)
  {
    id: 'T21',
    name: 'REDEEM: confirmation bottom sheet',
    journey: 'REDEEM',
    device: 'mobile',
    rtl: true,
    figma: 'none (approved bottom-sheet confirmation, design doc T04)',
    svg: true,
    isNew: true,
    comps: [
      'Result card (valid)',
      'Bottom sheet',
      'Facts list',
      'Irreversible warning alert',
      'Confirm / Cancel buttons',
    ],
    sheets: ['Redeem confirmation bottom sheet (locks while submitting)'],
    states: ['open', 'submitting (buttons locked, no double submit)', 'offline (Confirm disabled)'],
    route: '/ (BottomSheet in apps/staff/features/redeem.tsx)',
    priority: 'P1',
    shot: 'staff-02b-confirm-sheet-en',
    draw(f) {
      result(f, {
        tone: 'ok',
        glyph: '✓',
        title: f.t('st.valid'),
        body: f.t('st.validBody'),
        facts: facts(f, [[f.t('st.expires'), '19:42']]),
        buttons: [
          { label: f.t('st.redeem'), fill: '#0E8F6A' },
          { label: f.t('st.cancelScan'), fill: '#fff', color: C.navy, stroke: C.line },
        ],
      });
      f.rect(0, 0, W, 844, { fill: C.navy, opacity: 0.45 });
      f.rect(0, 420, W, 424, { r: 26, fill: '#fff' });
      f.rect(W / 2 - 20, 428, 40, 4, { r: 2, fill: C.line });
      f.text(20, 470, f.t('st.confirmSheet.title'), { size: 20, weight: 800 });
      f.icon(W - 20 - 30, 448, 'x', { size: 28 });
      f.rect(20, 486, W - 40, 150, { r: 16, fill: C.bg });
      [
        [f.t('st.offer'), L(f, 'حلى مجاني مع أي طبق', 'Free dessert with any main')],
        [f.t('st.confirmSheet.benefit'), L(f, 'حلى مجاني', 'Free dessert')],
        [f.t('st.customer'), L(f, 'ليلى', 'Layla')],
        [f.t('st.branch'), L(f, 'النخيل', 'Al Nakheel')],
        [f.t('res.reference'), 'DD-K7QM9T'],
      ].forEach(([k, v], i) => {
        f.text(36, 514 + i * 28, k, { size: 12, fill: C.ink2 });
        f.text(W - 36, 514 + i * 28, v, {
          size: 13,
          weight: 800,
          align: 'end',
          ltr: /^DD-/.test(v),
        });
      });
      f.rect(20, 648, W - 40, 62, { r: 14, fill: C.warnBg });
      f.text(34, 672, f.t('st.confirmSheet.warn').slice(0, 52), {
        size: 12,
        weight: 700,
        fill: C.warn,
      });
      f.text(34, 690, f.t('st.confirmSheet.warn').slice(52, 110), {
        size: 12,
        weight: 700,
        fill: C.warn,
      });
      f.button(20, 724, W - 40, 56, f.t('st.confirm'), { fill: '#0E8F6A' });
      f.button(20, 788, W - 40, 44, f.t('common.cancel'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
        size: 14,
      });
    },
  },
  {
    id: 'T22',
    name: 'Not valid yet (amber)',
    journey: 'VALIDATE',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T03)',
    svg: true,
    isNew: true,
    comps: ['Result card (warn)', 'Facts incl. start time', 'Scan next'],
    sheets: [],
    states: ['campaign scheduled or start time ahead; shows when it starts; never offers Redeem'],
    route: '/ (ResultView, result NOT_VALID_YET)',
    priority: 'P1',
    shot: null,
    draw(f) {
      result(f, {
        tone: 'warn',
        glyph: '◔',
        title: f.t('st.result.NOT_VALID_YET'),
        body: f.t('st.result.NOT_VALID_YET.body'),
        facts: facts(f, [[f.t('st.startsAt'), '8 Oct 18:00']]),
        buttons: next(f),
      });
    },
  },
  {
    id: 'T23',
    name: 'History: search by code',
    journey: 'History',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T05)',
    svg: true,
    isNew: true,
    comps: [
      'Search field (LTR)',
      'Day toggle',
      'Count tiles',
      'Filter chips',
      'History row (tappable)',
    ],
    sheets: [],
    states: ['results', 'no matches', 'loading'],
    route: '/history (search, q=last letters of the code)',
    priority: 'P1',
    shot: 'staff-08c-history-search-en',
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.historyTitle'), { size: 28, weight: 800 });
      f.rect(16, 112, 200, 40, { r: 20, fill: C.slate });
      f.rect(19, 115, 97, 34, { r: 17, fill: '#fff' });
      f.text(67, 137, f.t('st.today'), { size: 13, weight: 700, fill: C.purple, align: 'middle' });
      f.text(167, 137, f.t('st.yesterday'), {
        size: 13,
        weight: 700,
        fill: C.ink2,
        align: 'middle',
      });
      f.text(16, 182, f.t('st.searchLabel'), { size: 12, weight: 700, fill: C.ink2 });
      f.rect(16, 190, W - 32, 48, { r: 14, fill: '#fff', stroke: C.purple, sw: 2 });
      f.text(32, 220, '9T2X', { size: 15, weight: 700, ltr: true });
      f.card(16, 256, W - 32, 64, { r: 16 });
      f.pill(28, 274, f.t('st.result.REDEEMED'), { ...TONES.success, size: 10 });
      f.text(150, 284, L(f, 'حلى مجاني مع أي طبق', 'Free dessert with any main'), {
        size: 12,
        weight: 800,
      });
      f.text(150, 302, '10:41 · Layla · ×1 · QR', { size: 11, fill: C.ink2, ltr: true });
      f.circle(W / 2, 450, 34, { fill: C.lilac });
      f.text(W / 2, 520, f.t('st.noMatches'), {
        size: 14,
        weight: 700,
        fill: C.ink2,
        align: 'middle',
      });
      f.text(
        W / 2,
        546,
        L(f, '(no-match state, shown when the code finds nothing)', '(حالة عدم وجود نتائج)'),
        { size: 11, fill: C.ink2, align: 'middle' },
      );
      staffChrome(f, f.t('nav.history'));
    },
  },
  {
    id: 'T24',
    name: 'History: scan detail sheet',
    journey: 'History',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T05 detail)',
    svg: true,
    isNew: true,
    comps: ['Bottom sheet', 'Facts list', 'Status chip'],
    sheets: ['Scan details bottom sheet'],
    states: ['redeemed', 'rejected (any result)', 'no personal data beyond first name'],
    route: '/history (BottomSheet history-detail)',
    priority: 'P2',
    shot: 'staff-08b-history-detail-en',
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.historyTitle'), { size: 28, weight: 800 });
      f.card(16, 132, W - 32, 64, { r: 16 });
      f.rect(0, 0, W, 844, { fill: C.navy, opacity: 0.45 });
      f.rect(0, 380, W, 464, { r: 26, fill: '#fff' });
      f.rect(W / 2 - 20, 388, 40, 4, { r: 2, fill: C.line });
      f.text(20, 430, f.t('st.detail.title'), { size: 20, weight: 800 });
      f.icon(W - 20 - 30, 408, 'x', { size: 28 });
      f.rect(20, 450, W - 40, 250, { r: 16, fill: C.bg });
      [
        [f.t('st.detail.result'), f.t('st.result.REDEEMED')],
        [f.t('st.offer'), L(f, 'حلى مجاني مع أي طبق', 'Free dessert with any main')],
        [f.t('st.customer'), L(f, 'ليلى', 'Layla')],
        [f.t('st.quantity'), '1'],
        [f.t('st.detail.time'), '10:41'],
        [f.t('st.detail.how'), f.t('st.source.QR')],
        [f.t('res.reference'), 'RD-ABC234'],
      ].forEach(([k, v], i) => {
        f.text(36, 482 + i * 34, k, { size: 12, fill: C.ink2 });
        f.text(W - 36, 482 + i * 34, v, {
          size: 13,
          weight: 800,
          align: 'end',
          ltr: /^(RD-|\d)/.test(v),
        });
      });
      f.button(20, 720, W - 40, 56, f.t('st.close'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
      });
    },
  },
  {
    id: 'T25',
    name: 'Scanner with torch control and wake-lock note',
    journey: 'SCAN',
    device: 'mobile',
    rtl: true,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: [
      'Scanner viewport',
      'Torch toggle (only where the camera supports it)',
      'Enter-code button',
    ],
    sheets: [],
    states: [
      'torch off',
      'torch on (amber)',
      'torch unsupported: control hidden',
      'wake lock held where supported (silent progressive enhancement)',
    ],
    route: '/ (CameraScanner)',
    priority: 'P2',
    shot: null,
    draw(f) {
      staffHeader(f);
      f.text(16, 96, f.t('st.scanTitle'), { size: 28, weight: 800 });
      f.rect(16, 132, W - 32, W - 32, { r: 24, fill: C.dark });
      f.rect(16 + 66, 132 + 66, W - 32 - 132, W - 32 - 132, { r: 22, stroke: '#fff', sw: 3 });
      f.circle(W - 16 - 36, 132 + 36, 24, { fill: C.amber });
      f.icon(W - 16 - 48, 132 + 24, 'flame', { size: 24, color: C.navy });
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
      f.text(16, 132 + W - 32 + 100, f.t('st.torchOff'), { size: 11, fill: C.ink2 });
      staffChrome(f, f.t('nav.scan'));
    },
  },
  {
    id: 'T26',
    name: 'OTP: wrong code and expired code',
    journey: 'Sign in',
    device: 'mobile',
    rtl: true,
    figma: 'none (design doc T01)',
    svg: true,
    isNew: true,
    comps: ['OTP boxes (one input drawn as six)', 'Danger alert', 'Resend button'],
    sheets: [],
    states: [
      'wrong code (boxes red, cleared, no "tries left")',
      'expired code',
      'new code sent (success note)',
      'too many requests (backend-controlled)',
    ],
    route: '/ (LoginPanel / OtpInput in packages/ui)',
    priority: 'P1',
    shot: null,
    draw(f) {
      f.text(W / 2, 110, f.t('brand.name'), {
        size: 32,
        weight: 800,
        fill: C.purple,
        align: 'middle',
      });
      f.text(24, 170, f.t('auth.code'), { size: 24, weight: 800 });
      f.rect(24, 188, W - 48, 46, { r: 14, fill: C.dangerBg });
      f.text(40, 217, f.t('error.OTP_INVALID'), { size: 13, weight: 700, fill: C.danger });
      for (let i = 0; i < 6; i++)
        f.rect(24 + i * 57, 252, 48, 60, { r: 12, fill: '#fff', stroke: C.red });
      f.button(24, 336, W - 48, 52, f.t('auth.resend'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
      });
      f.line(24, 430, W - 24, 430);
      f.rect(24, 452, W - 48, 46, { r: 14, fill: C.warnBg });
      f.text(40, 481, f.t('error.OTP_EXPIRED').slice(0, 46), {
        size: 13,
        weight: 700,
        fill: C.warn,
      });
      for (let i = 0; i < 6; i++)
        f.rect(24 + i * 57, 516, 48, 60, { r: 12, fill: '#fff', stroke: C.line });
      f.button(24, 600, W - 48, 52, f.t('auth.resend'), { fill: C.purple });
      f.rect(24, 672, W - 48, 46, { r: 14, fill: C.greenBg });
      f.text(40, 701, f.t('auth.codeSent'), { size: 13, weight: 700, fill: C.green });
    },
  },
];
