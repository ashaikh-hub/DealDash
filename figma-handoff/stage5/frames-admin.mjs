import {
  wrap,
  C,
  TONES,
  DESKTOP,
  L,
  X0,
  sar,
  portalChrome,
  ADMIN_NAV5,
  FINANCE_NAV5,
  chip,
  kpi,
  table,
  tabs,
  vchip,
  TITLE,
  REFUND_TONE,
  voucherBadge,
} from './lib.mjs';

const W = DESKTOP.w;
const A = (f, active = 'nav.vouchers') =>
  portalChrome(f, { surface: 'admin', active: f.t(active), items: ADMIN_NAV5(f.t) });
const FIN = (f) =>
  portalChrome(f, { surface: 'admin', active: f.t('nav.finance'), items: FINANCE_NAV5(f.t) });
const meta = (extra) => ({
  journey: 'Review',
  device: 'desktop',
  svg: true,
  isNew: true,
  sheets: [],
  priority: 'P1',
  ...extra,
});
const rchip = (f, s) => ({ label: f.t(`vrefund.${s}`), ...TONES[REFUND_TONE[s]] });

function finTabs(f, active) {
  const t = f.t;
  f.text(X0, 100, t('fin.title'), { size: 28, weight: 800 });
  f.text(X0, 124, t('fin.sub').slice(0, 110), { size: 13, fill: C.ink2 });
  f.rect(X0, 142, W - X0 - 32, 40, { r: 20, fill: C.slate });
  [t('fin.tabOverview'), t('fin.tabLookup'), t('fin.tabRefunds'), t('fin.tabCases')].forEach(
    (s, i) => {
      const w = (W - X0 - 32) / 4;
      if (i === active) f.rect(X0 + 3 + i * w, 145, w - 6, 34, { r: 17, fill: '#fff' });
      f.text(X0 + w / 2 + i * w, 168, s, {
        size: 13,
        weight: 700,
        fill: i === active ? C.purple : C.ink2,
        align: 'middle',
      });
    },
  );
}

function reviewTop(f, status = 'PENDING_REVIEW') {
  A(f);
  f.text(X0, 100, '← ' + f.t('av.back'), { size: 13, weight: 700, fill: C.purple });
  f.text(X0, 132, TITLE(f), { size: 24, weight: 800 });
  f.pill(X0 + 330, 112, f.t(`vstatus.${status}`), { ...vchip(f, status), size: 11 });
}

function commercial(f, x, y, wd, flag) {
  const t = f.t;
  f.card(x, y, wd, flag ? 330 : 270, { r: 20 });
  f.text(x + 20, y + 32, t('av.commercial'), { size: 16, weight: 800 });
  [
    [t('mv.face'), sar(f, 12000)],
    [t('mv.price'), sar(f, 9000)],
    [t('av.savingsClaim'), 'SAR 30.00 (25%)'],
    [t('av.stock'), '0 / 50 (' + t('mv.kpi.held') + ': 0)'],
    [t('mv.summary.validity'), t('vch.validDays', { n: 30 })],
    [t('mv.eligibility'), t('elig.PUBLIC')],
    [t('mv.perCustomer'), '2'],
    [t('mv.summary.branches'), 'Najd Kitchen Al Nakheel'],
  ].forEach(([k, v], i) => {
    const cx = x + 20 + (i % 3) * (wd / 3),
      cy = y + 60 + Math.floor(i / 3) * 52;
    f.text(cx, cy, k.slice(0, 28), { size: 11, fill: C.ink2 });
    f.text(cx, cy + 20, v.slice(0, 32), { size: 13, weight: 700, ltr: /^SAR|^\d/.test(v) });
  });
  f.rect(x + 20, y + 214, wd - 40, 44, { r: 12, fill: flag ? C.warnBg : C.greenBg });
  wrap(
    f,
    x + 34,
    y + 240,
    flag ? t('av.discountFlag', { pct: 70 }) : t('av.discountOk'),
    Math.floor(wd / 6.6),
    { size: 12, weight: 700, fill: flag ? C.warn : C.green, max: 2 },
  );
  if (flag) {
    f.rect(x + 20, y + 270, wd - 40, 30, { r: 8, fill: C.dangerBg });
    f.text(x + 34, y + 290, '⚑ ' + t('guardrail.reason.DISCOUNT_ABOVE_RANGE'), {
      size: 11,
      weight: 700,
      fill: C.danger,
    });
  }
}

function rulesCard(f, x, y, wd) {
  const t = f.t;
  f.card(x, y, wd, 196, { r: 20 });
  f.text(x + 20, y + 30, t('av.refundPolicyTitle'), { size: 14, weight: 800 });
  wrap(
    f,
    x + 20,
    y + 52,
    t('av.refundPolicy', { hours: 24, after: t('av.refundAfter.REVIEW') }),
    Math.floor(wd / 6.2),
    { max: 2 },
  );
  f.text(x + 20, y + 100, t('av.payableRuleTitle'), { size: 14, weight: 800 });
  wrap(
    f,
    x + 20,
    y + 122,
    t('av.payableRule', { point: t('mf.accrual.REDEMPTION'), pct: 10, fixed: 'SAR 0.00' }),
    Math.floor(wd / 6.2),
    { max: 2 },
  );
  wrap(
    f,
    x + 20,
    y + 170,
    t('av.expiredPolicy', { policy: t('av.expiredPolicy.UNDECIDED_VALIDATE_KSA') }),
    Math.floor(wd / 6.2),
    { max: 1 },
  );
}

function bilingual(f, x, y, wd) {
  const t = f.t;
  [
    [
      'en',
      'English',
      'SAR 120 dinner voucher',
      'Pay SAR 90, dine for SAR 120',
      'A dinner voucher for any dish.',
      'Show the QR code at the counter.',
    ],
    [
      'ar',
      'Arabic',
      'قسيمة عشاء بقيمة 120 ريال',
      'ادفع 90 وتناول بقيمة 120',
      'قسيمة عشاء لأي طبق.',
      'اعرض رمز QR عند الكاشير.',
    ],
  ].forEach(([lang, _name, a, b, c, d], i) => {
    const cx = x + i * (wd / 2 + 8);
    f.card(cx, y, wd / 2 - 8, 250, { r: 20 });
    f.text(cx + 20, y + 28, lang === 'en' ? t('adeal.english') : t('adeal.arabic'), {
      size: 11,
      weight: 800,
      fill: C.ink2,
    });
    [
      [t('mv.title2'), a],
      [t('mv.short'), b],
      [t('mv.long'), c],
      [t('mv.rules'), d],
    ].forEach(([k, v], j) => {
      f.text(cx + 20, y + 58 + j * 46, k, { size: 11, fill: C.ink2 });
      f.text(cx + 20, y + 76 + j * 46, v, { size: 13, weight: j === 0 ? 800 : 500 });
    });
  });
}

function decision(f, x, y, actions) {
  const t = f.t;
  f.card(x, y, 296, 70 + actions.length * 52, { r: 20 });
  f.text(x + 20, y + 32, t('av.decision'), { size: 16, weight: 800 });
  actions.forEach(([label, kind], i) =>
    f.button(x + 20, y + 48 + i * 52, 256, 40, label, {
      fill: kind === 'primary' ? C.purple : kind === 'danger' ? C.red : '#fff',
      color: kind === 'outline' ? C.navy : '#fff',
      stroke: kind === 'outline' ? C.line : undefined,
      size: 13,
    }),
  );
}

function previewCard(f, x, y) {
  const t = f.t;
  f.card(x, y, 296, 300, { r: 20 });
  f.text(x + 20, y + 30, t('av.preview'), { size: 16, weight: 800 });
  f.photo(x + 20, y + 46, 256, 110, { r: 16 });
  voucherBadge(f, x + 30, y + 56);
  f.pill(x + 30, y + 120, sar(f, 12000), { fill: C.purple, color: '#fff', size: 11, ltr: true });
  f.text(x + 20, y + 184, TITLE(f), { size: 14, weight: 800 });
  f.text(x + 20, y + 206, L(f, 'نجد كيتشن', 'Najd Kitchen'), { size: 12, fill: C.ink2 });
  const w = f.pill(x + 20, y + 218, sar(f, 9000), {
    fill: C.slate,
    color: C.navy,
    size: 12,
    ltr: true,
  });
  f.pill(x + 26 + w, y + 218, '25%', { fill: C.greenBg, color: C.green, size: 11, ltr: true });
  f.text(x + 20, y + 276, t('vch.reportedSavings') + ' SAR 30.00 (25%)', {
    size: 11,
    weight: 800,
    fill: C.green,
  });
}

function merchantCard(f, x, y, wd) {
  const t = f.t;
  f.card(x, y, wd, 150, { r: 20 });
  f.text(x + 20, y + 30, t('adeal.merchant'), { size: 16, weight: 800 });
  [
    [t('adeal.merchant'), L(f, 'نجد كيتشن', 'Najd Kitchen')],
    [t('av.legalEntity'), 'Najd Kitchen Co.'],
    [t('av.registration'), '1010000006'],
    [t('adeal.risk'), 'STANDARD'],
    [t('adeal.merchantStatus'), 'ACTIVE'],
    [t('adeal.col.merchant'), t('adeal.trust.NEW')],
  ].forEach(([k, v], i) => {
    const cx = x + 20 + (i % 3) * (wd / 3),
      cy = y + 60 + Math.floor(i / 3) * 44;
    f.text(cx, cy, k, { size: 11, fill: C.ink2 });
    f.text(cx, cy + 18, v, { size: 13, weight: 700, ltr: /^\d/.test(v) });
  });
}

const orderFacts = (f, x, y, wd, redacted) => {
  const t = f.t;
  f.card(x, y, wd, 150, { r: 20 });
  [
    [t('fin.customer'), 'Layla  +966•••••1234'],
    [t('fin.voucher'), TITLE(f).slice(0, 36) + ' · ' + L(f, 'نجد كيتشن', 'Najd Kitchen')],
    [t('fin.col.amount'), 'SAR 90.00'],
    [t('fin.terms'), '2026-10-v1 · 8 Oct 2026, 18:11'],
    [t('fin.providerRef'), redacted ? t('fin.hidden') : 'MP-7K2QX9'],
  ].forEach(([k, v], i) => {
    f.text(x + 20, y + 34 + i * 26, k, { size: 12, fill: C.ink2 });
    f.text(x + wd - 20, y + 34 + i * 26, v, {
      size: 13,
      weight: 700,
      align: 'end',
      ltr: /^SAR|^MP/.test(v),
    });
  });
};

export const admin = [
  meta({
    id: 'VA19',
    name: 'Workbench: English and Arabic content side by side',
    rtl: true,
    figma: 'A02 Stage 4 (REUSED)',
    isNew: false,
    comps: ['EN / AR content columns (Arabic right-to-left)', 'Terms (both languages)'],
    states: ['both languages must be complete before approval'],
    route: '/vouchers/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      reviewTop(f);
      bilingual(f, X0, 156, 1136);
      f.card(X0, 430, 1136, 120, { r: 20 });
      f.text(X0 + 20, 462, f.t('adeal.terms'), { size: 15, weight: 800 });
      f.text(X0 + 20, 492, 'One voucher per visit. Not valid with other offers.', { size: 13 });
      f.text(X0 + 1116, 492, 'قسيمة واحدة لكل زيارة. لا تُجمع مع عروض أخرى.', {
        size: 13,
        align: 'end',
      });
    },
  }),
  meta({
    id: 'VA01',
    name: 'Voucher review queue',
    rtl: true,
    figma: 'A01 Stage 4 queue pattern (REUSED)',
    isNew: false,
    comps: [
      'Sidebar nav (Vouchers, Finance)',
      'Queue / All tabs',
      'Filters',
      'Voucher status chip',
      'Table',
    ],
    states: ['queue empty', 'loading', 'error', 'load more'],
    route: '/vouchers',
    shot: 'admin-01-voucher-queue-en',
    draw(f) {
      const t = f.t;
      A(f);
      f.text(X0, 100, t('av.title'), { size: 28, weight: 800 });
      f.text(X0, 124, t('av.sub').slice(0, 100), { size: 13, fill: C.ink2 });
      f.rect(X0, 148, 300, 40, { r: 20, fill: C.slate });
      f.rect(X0 + 3, 151, 146, 34, { r: 17, fill: '#fff' });
      f.text(X0 + 76, 173, t('av.tabQueue'), {
        size: 13,
        weight: 700,
        fill: C.purple,
        align: 'middle',
      });
      f.text(X0 + 226, 173, t('av.tabAll'), {
        size: 13,
        weight: 700,
        fill: C.ink2,
        align: 'middle',
      });
      f.rect(X0, 204, 280, 40, { r: 12, fill: '#fff', stroke: C.line });
      f.text(X0 + 14, 229, t('mdeal.hub.search'), { size: 13, fill: C.ink2 });
      table(
        f,
        X0,
        262,
        W - X0 - 32,
        [
          { label: t('av.col.voucher'), w: 300 },
          { label: t('av.col.merchant'), w: 200 },
          { label: t('av.col.price'), w: 190 },
          { label: t('av.col.qty'), w: 100 },
          { label: t('av.col.submitted'), w: 190 },
          { label: t('mdeal.col.status'), w: 150 },
        ],
        [
          [
            TITLE(f),
            L(f, 'نجد كيتشن', 'Najd Kitchen'),
            'SAR 120.00 / 90.00',
            '50',
            '8 Oct 2026, 18:01',
            vchip(f, 'PENDING_REVIEW'),
          ],
          [
            L(f, 'قسيمة سبا بقيمة 200 ريال', 'SAR 200 spa voucher'),
            L(f, 'استوديو بلوم', 'Bloom Beauty Studio'),
            'SAR 200.00 / 40.00',
            '20',
            '8 Oct 2026, 16:40',
            vchip(f, 'PENDING_REVIEW'),
          ],
          [
            L(f, 'قسيمة لياقة بقيمة 150 ريال', 'SAR 150 fitness voucher'),
            L(f, 'بالس فيتنس', 'Pulse Fitness'),
            'SAR 150.00 / 120.00',
            '30',
            '7 Oct 2026, 12:10',
            vchip(f, 'PENDING_REVIEW'),
          ],
        ],
      );
    },
  }),
  meta({
    id: 'VA02',
    name: 'All vouchers (status filter)',
    rtl: false,
    figma: 'A01 pattern',
    isNew: true,
    comps: ['Status filter', 'Table'],
    states: ['all statuses', 'filtered', 'no match'],
    route: '/vouchers (All)',
    priority: 'P2',
    shot: null,
    draw(f) {
      const t = f.t;
      A(f);
      f.text(X0, 100, t('av.title'), { size: 28, weight: 800 });
      f.rect(X0, 148, 300, 40, { r: 20, fill: C.slate });
      f.rect(X0 + 151, 151, 146, 34, { r: 17, fill: '#fff' });
      f.text(X0 + 76, 173, t('av.tabQueue'), {
        size: 13,
        weight: 700,
        fill: C.ink2,
        align: 'middle',
      });
      f.text(X0 + 226, 173, t('av.tabAll'), {
        size: 13,
        weight: 700,
        fill: C.purple,
        align: 'middle',
      });
      f.rect(X0, 204, 280, 40, { r: 12, fill: '#fff', stroke: C.line });
      f.text(X0 + 14, 229, t('mdeal.hub.search'), { size: 13, fill: C.ink2 });
      f.rect(X0 + 296, 204, 200, 40, { r: 12, fill: '#fff', stroke: C.line });
      f.text(X0 + 310, 229, t('mdeal.hub.allStatuses'), { size: 13, fill: C.ink2 });
      table(
        f,
        X0,
        262,
        W - X0 - 32,
        [
          { label: t('av.col.voucher'), w: 300 },
          { label: t('av.col.merchant'), w: 200 },
          { label: t('av.col.price'), w: 190 },
          { label: t('av.col.qty'), w: 100 },
          { label: t('av.col.submitted'), w: 190 },
          { label: t('mdeal.col.status'), w: 150 },
        ],
        ['ON_SALE', 'PAUSED', 'SOLD_OUT', 'SCHEDULED', 'SUSPENDED', 'REJECTED', 'ENDED'].map(
          (s, i) => [
            TITLE(f),
            L(f, 'نجد كيتشن', 'Najd Kitchen'),
            'SAR 120.00 / 90.00',
            String(50 - i * 5),
            `${8 - i} Oct 2026, 10:00`,
            vchip(f, s),
          ],
        ),
      );
    },
  }),
  meta({
    id: 'VA03',
    name: 'Review workbench (merchant, commercial checks, rules, EN/AR, preview)',
    rtl: true,
    figma: 'A02 Stage 4 workbench pattern (REUSED)',
    isNew: false,
    comps: [
      'Merchant card',
      'Commercial checks card',
      'Discount flag',
      'Placeholder rules card',
      'EN/AR columns',
      'Decision panel',
      'Customer preview',
    ],
    states: ['pending review', 'live (control actions)', 'read-only role'],
    route: '/vouchers/[id]',
    shot: 'admin-02-voucher-review-en',
    draw(f) {
      reviewTop(f);
      merchantCard(f, X0, 156, 820);
      commercial(f, X0, 326, 820, false);
      rulesCard(f, X0, 616, 820);
      decision(f, X0 + 840, 156, [
        [f.t('ah.approve'), 'primary'],
        [f.t('ah.requestChanges'), 'outline'],
        [f.t('ah.reject'), 'danger'],
      ]);
      previewCard(f, X0 + 840, 410);
    },
  }),
  meta({
    id: 'VA04',
    name: 'Workbench: price, value, savings claim, validity, branches, eligibility',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Commercial checks card', 'Discount flag (above threshold)', 'Guardrail chip'],
    states: ['within usual range', 'above threshold (flag + guardrail reason)'],
    route: '/vouchers/[id]',
    priority: 'P1',
    shot: null,
    draw(f) {
      reviewTop(f);
      merchantCard(f, X0, 156, 1000);
      commercial(f, X0, 326, 1000, true);
      f.text(
        X0,
        666,
        'Reviewer checks: the stated face value is real, the savings claim is reasonable, validity and branches match the merchant, eligibility is correct.',
        { size: 12, fill: C.ink2 },
      );
    },
  }),
  meta({
    id: 'VA05',
    name: 'Decision dialogs: approve, request changes, reject (reason required)',
    rtl: false,
    figma: 'A03 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Reason dialog (EN + optional AR)'],
    states: ['approve (reason prefilled)', 'request changes', 'reject'],
    route: '/vouchers/[id]',
    shot: null,
    draw(f) {
      const t = f.t;
      f.text(32, 44, 'Voucher decision dialogs', { size: 22, weight: 800 });
      [
        [t('ah.approve'), false],
        [t('ah.requestChanges'), false],
        [t('ah.reject'), true],
      ].forEach(([title, danger], i) => {
        const x = 32 + i * 470;
        f.card(x, 80, 440, 400, { r: 20 });
        f.text(x + 24, 118, title, { size: 18, weight: 800 });
        f.text(x + 24, 156, t('modal.reason') + ' *', { size: 12, weight: 700, fill: C.ink2 });
        f.rect(x + 24, 166, 392, 90, { r: 12, fill: '#fff', stroke: C.line });
        f.text(x + 24, 286, t('ah.reasonAr'), { size: 12, weight: 700, fill: C.ink2 });
        f.rect(x + 24, 296, 392, 70, { r: 12, fill: '#fff', stroke: C.line });
        f.button(x + 24, 410, 120, 44, t('common.cancel'), {
          fill: '#fff',
          color: C.navy,
          stroke: C.line,
          size: 13,
        });
        f.button(x + 160, 410, 256, 44, title, { fill: danger ? C.red : C.purple, size: 13 });
      });
    },
  }),
  meta({
    id: 'VA06',
    name: 'Live voucher controls: pause, resume, suspend, reinstate',
    rtl: false,
    figma: 'A04 Stage 4 (REUSED)',
    isNew: false,
    comps: ['Decision panel (control actions)', 'Status chip'],
    states: [
      'ON_SALE: pause, suspend',
      'PAUSED: resume, suspend',
      'SUSPENDED: reinstate (sold vouchers are blocked at the counter)',
    ],
    route: '/vouchers/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      const t = f.t;
      f.text(32, 44, 'Control actions by status', { size: 22, weight: 800 });
      [
        [
          'ON_SALE',
          [
            [t('ah.pause'), 'outline'],
            [t('ah.suspend'), 'danger'],
          ],
        ],
        [
          'PAUSED',
          [
            [t('ah.resume'), 'primary'],
            [t('ah.suspend'), 'danger'],
          ],
        ],
        ['SUSPENDED', [[t('ah.reinstate'), 'primary']]],
      ].forEach(([s, acts], i) => {
        const x = 32 + i * 440;
        f.pill(x, 80, t(`vstatus.${s}`), { ...vchip(f, s), size: 12 });
        decision(f, x, 120, acts);
      });
      f.text(
        32,
        360,
        'Requires admin.campaigns.control. Pause or end never blocks vouchers already sold; only Suspend does (staff see "Voucher on hold").',
        { size: 12, fill: C.ink2 },
      );
    },
  }),
  meta({
    id: 'VA07',
    name: 'Decision history and audit trail',
    journey: 'Audit',
    rtl: true,
    figma: 'A08 Stage 4 timeline (REUSED)',
    isNew: false,
    comps: ['Timeline', 'Financial event / audit row'],
    states: ['actor, role, reason (EN + AR), fields changed'],
    route: '/vouchers/[id] (history)',
    shot: null,
    draw(f) {
      const t = f.t;
      reviewTop(f, 'ON_SALE');
      f.card(X0, 156, 860, 420, { r: 20 });
      f.text(X0 + 20, 190, t('av.history'), { size: 16, weight: 800 });
      [
        ['APPROVE', C.mint, 'Operations (DEALDASH_OPERATIONS)'],
        ['SUBMIT', C.purple, 'Najd Kitchen Owner'],
        ['UPDATE', C.purple, 'Najd Kitchen Owner'],
        ['CREATE', C.purple, 'Najd Kitchen Owner'],
      ].forEach(([a, col, who], i) => {
        const y = 220 + i * 84;
        f.circle(X0 + 34, y + 10, 8, { fill: col });
        if (i < 3) f.line(X0 + 34, y + 22, X0 + 34, y + 84, { stroke: C.line, sw: 2 });
        f.text(X0 + 60, y + 14, t(`vaction.${a}`), { size: 14, weight: 800 });
        f.text(X0 + 60, y + 34, `${who} · 8 Oct 2026, 18:0${i}`, { size: 11, fill: C.ink2 });
        if (a === 'APPROVE')
          f.text(X0 + 60, y + 56, 'Voucher is clear and the commercial rules are reasonable.', {
            size: 12,
          });
      });
    },
  }),
  meta({
    id: 'VA08',
    name: 'Finance overview: ledger health and merchant payable',
    journey: 'Finance',
    rtl: true,
    figma: 'none',
    isNew: true,
    comps: [
      'Stat card',
      'Ledger health chip',
      'Ledger family list',
      'Merchant payable table',
      'Legal placeholder note',
    ],
    states: ['balanced', 'NOT balanced (danger)', 'no payment rights: tab hidden'],
    route: '/finance',
    shot: 'admin-04-finance-overview-en',
    draw(f) {
      const t = f.t;
      FIN(f);
      finTabs(f, 0);
      [
        [t('fin.overview.pending'), 2],
        [t('fin.overview.refundsOpen'), 1],
        [t('fin.overview.refundsFailed'), 0],
        [t('fin.overview.payments24'), 9],
        [t('fin.overview.failed24'), 1],
        [t('fin.overview.refunds24'), 0],
      ].forEach(([l, v], i) =>
        kpi(f, X0 + (i % 3) * 300, 202 + Math.floor(i / 3) * 92, 288, v, l.slice(0, 34)),
      );
      f.card(X0, 392, 880, 210, { r: 20 });
      f.text(X0 + 20, 424, t('fin.ledger'), { size: 16, weight: 800 });
      f.pill(X0 + 20, 436, t('fin.ledger.balanced'), { ...TONES.success, size: 11 });
      [
        [t('fin.ledger.held'), 40000],
        [t('fin.ledger.eligible'), 7200],
        [t('fin.ledger.revenue'), 800],
        [t('fin.ledger.psp'), 48000],
        [t('fin.ledger.expired'), 0],
      ].forEach(([k, v], i) => {
        f.text(X0 + 20, 490 + i * 22, k, { size: 12, fill: C.ink2 });
        f.text(X0 + 860, 490 + i * 22, sar(f, v), {
          size: 13,
          weight: 700,
          align: 'end',
          ltr: true,
        });
      });
      table(
        f,
        X0,
        622,
        880,
        [
          { label: t('fin.col.merchant'), w: 220 },
          { label: t('fin.col.held'), w: 130 },
          { label: t('fin.col.eligible'), w: 150 },
          { label: t('fin.col.fee'), w: 120 },
          { label: t('fin.col.refunded'), w: 120 },
          { label: t('fin.col.expired'), w: 100 },
        ],
        [
          [
            L(f, 'نجد كيتشن', 'Najd Kitchen'),
            'SAR 400.00',
            'SAR 72.00',
            'SAR 8.00',
            'SAR 0.00',
            'SAR 0.00',
          ],
        ],
        { rowH: 46 },
      );
      f.text(X0, 730, t('fin.legal').slice(0, 130), { size: 11, fill: C.ink2 });
    },
  }),
  meta({
    id: 'VA09',
    name: 'Payment, purchase, voucher, refund and redemption lookup',
    journey: 'Finance',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Search field (>= 4 chars)', 'Results table (kind, reference, status)'],
    states: ['no results', 'Support: starts here (no Overview tab)'],
    route: '/finance (Lookup)',
    shot: 'admin-05-finance-lookup-en',
    draw(f) {
      const t = f.t;
      FIN(f);
      finTabs(f, 1);
      f.rect(X0, 202, 480, 44, { r: 12, fill: '#fff', stroke: C.purple, sw: 2 });
      f.text(X0 + 16, 230, 'ORD-DDZYFX', { size: 14, weight: 700, ltr: true });
      f.button(X0 + 496, 202, 100, 44, t('fin.searchGo'), { size: 13 });
      f.text(X0, 270, t('fin.search'), { size: 11, fill: C.ink2 });
      table(
        f,
        X0,
        290,
        W - X0 - 32,
        [
          { label: t('fin.col.type'), w: 160 },
          { label: t('fin.col.ref'), w: 200 },
          { label: t('fin.col.status'), w: 170 },
          { label: t('fin.col.amount'), w: 140 },
          { label: t('fin.col.merchant'), w: 200 },
          { label: t('fin.col.when'), w: 200 },
        ],
        [
          [
            t('fin.kind.ORDER'),
            'ORD-DDZYFX',
            t('vorder.PAID'),
            'SAR 90.00',
            L(f, 'نجد كيتشن', 'Najd Kitchen'),
            '8 Oct 2026, 18:13',
          ],
          [
            t('fin.kind.VOUCHER'),
            'VC-K7QM9T',
            t('vinst.REDEEMED'),
            'SAR 90.00',
            L(f, 'نجد كيتشن', 'Najd Kitchen'),
            '8 Oct 2026, 18:13',
          ],
          [
            t('fin.kind.PAYMENT'),
            'MP-7K2QX9',
            t('vpay.SUCCEEDED'),
            'SAR 90.00',
            L(f, 'نجد كيتشن', 'Najd Kitchen'),
            '8 Oct 2026, 18:12',
          ],
          [
            t('fin.kind.REFUND'),
            'RF-SGQYQR',
            t('vrefund.REFUNDED'),
            'SAR 90.00',
            L(f, 'نجد كيتشن', 'Najd Kitchen'),
            '8 Oct 2026, 18:13',
          ],
          [
            t('fin.kind.REDEMPTION'),
            'RD-ABC234',
            'REDEEMED',
            'SAR 90.00',
            L(f, 'نجد كيتشن', 'Najd Kitchen'),
            '8 Oct 2026, 18:20',
          ],
        ],
      );
    },
  }),
  meta({
    id: 'VA10',
    name: 'Order detail: customer, voucher, payments, callbacks, instance',
    journey: 'Finance',
    rtl: true,
    figma: 'none',
    isNew: true,
    comps: [
      'Order facts card',
      'Payment status table',
      'Provider callback list',
      'Voucher instance card',
      'Action buttons (reverse, exceptional refund)',
    ],
    states: ['PAID', 'FAILED attempts', 'late success refunded'],
    route: '/finance/orders/[id]',
    shot: 'admin-06-finance-order-en',
    draw(f) {
      const t = f.t;
      FIN(f);
      f.text(X0, 100, '← ' + t('fin.back'), { size: 13, weight: 700, fill: C.purple });
      f.text(X0, 132, t('fin.order', { ref: 'ORD-DDZYFX' }), { size: 24, weight: 800, ltr: false });
      f.pill(X0 + 330, 112, t('vorder.PAID'), { ...TONES.success, size: 11 });
      f.button(W - 220 - 330, 104, 150, 40, t('fin.reverse'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
        size: 12,
      });
      f.button(W - 220 - 170, 104, 190, 40, t('fin.refund.create'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
        size: 12,
      });
      orderFacts(f, X0, 156, 860, false);
      f.card(X0, 326, 860, 190, { r: 20 });
      f.text(X0 + 20, 358, t('fin.payments'), { size: 15, weight: 800 });
      [
        [t('vpay.FAILED'), 'MP-3H1ZA7', '1'],
        [t('vpay.SUCCEEDED'), 'MP-7K2QX9', '2'],
      ].forEach(([s, ref, n], i) => {
        f.text(X0 + 20, 394 + i * 30, '#' + n, { size: 12, ltr: true });
        f.text(X0 + 80, 394 + i * 30, s, { size: 13, weight: 700 });
        f.text(X0 + 300, 394 + i * 30, ref, { size: 12, ltr: true });
        f.text(X0 + 840, 394 + i * 30, 'SAR 90.00', { size: 13, align: 'end', ltr: true });
      });
      f.text(X0 + 20, 470, t('fin.events'), { size: 12, weight: 800 });
      f.text(
        X0 + 20,
        490,
        '18:12 · PAYMENT SUCCEEDED · ' + t('vevent.APPLIED') + ' · ' + t('fin.signature'),
        { size: 11, fill: C.ink2 },
      );
      f.card(X0, 536, 860, 140, { r: 20 });
      f.text(X0 + 20, 568, t('fin.instance'), { size: 15, weight: 800 });
      [
        [t('fin.col.ref'), 'VC-K7QM9T'],
        [t('fin.col.status'), t('vinst.REDEEMED')],
        [t('fin.redemption'), 'RD-ABC234 · Al Nakheel · 8 Oct 2026, 18:20'],
      ].forEach(([k, v], i) => {
        f.text(X0 + 20, 598 + i * 26, k, { size: 12, fill: C.ink2 });
        f.text(X0 + 840, 598 + i * 26, v, {
          size: 13,
          weight: 700,
          align: 'end',
          ltr: /^VC|^RD/.test(v),
        });
      });
    },
  }),
  meta({
    id: 'VA11',
    name: 'Order detail: ledger journals, payable events, support cases',
    journey: 'Finance',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Journal row (entries per ledger family)', 'Payable event row', 'Support case row'],
    states: ['SALE, REDEMPTION, REFUND, REVERSAL journals; every journal balances to zero'],
    route: '/finance/orders/[id]',
    priority: 'P1',
    shot: null,
    draw(f) {
      const t = f.t;
      FIN(f);
      f.text(X0, 100, '← ' + t('fin.back'), { size: 13, weight: 700, fill: C.purple });
      f.card(X0, 130, 860, 330, { r: 20 });
      f.text(X0 + 20, 162, t('fin.journals'), { size: 15, weight: 800 });
      [
        [
          t('vjournal.SALE'),
          [
            [t('vledger.PSP_CLEARING'), 9000],
            [t('vledger.MERCHANT_HELD'), -9000],
          ],
        ],
        [
          t('vjournal.REDEMPTION'),
          [
            [t('vledger.MERCHANT_HELD'), 9000],
            [t('vledger.PLATFORM_REVENUE'), -900],
            [t('vledger.MERCHANT_SETTLEMENT_ELIGIBLE'), -8100],
          ],
        ],
      ].forEach(([title, es], i) => {
        const y = 190 + i * 130;
        f.text(X0 + 20, y + 14, title, { size: 13, weight: 800 });
        f.text(X0 + 840, y + 14, '8 Oct 2026, 18:1' + (2 + i * 8), {
          size: 11,
          fill: C.ink2,
          align: 'end',
          ltr: true,
        });
        es.forEach(([a, v], j) => {
          f.text(X0 + 40, y + 40 + j * 22, a, { size: 12, fill: C.ink2 });
          f.text(
            X0 + 840,
            y + 40 + j * 22,
            (v < 0 ? '-' : '+') + sar(f, Math.abs(v)).replace(/^-/, ''),
            { size: 12, weight: 700, align: 'end', ltr: true },
          );
        });
      });
      f.card(X0, 480, 860, 120, { r: 20 });
      f.text(X0 + 20, 512, t('fin.payable'), { size: 15, weight: 800 });
      [
        [t('vpayable.ISSUED'), 'SAR 90.00', '18:12'],
        [t('vpayable.REDEEMED'), 'SAR 90.00', '18:20'],
        [t('vpayable.ELIGIBLE'), 'SAR 81.00', '18:20'],
      ].forEach(([k, v, w], i) => {
        f.text(X0 + 20, 540 + i * 20, k, { size: 12 });
        f.text(X0 + 420, 540 + i * 20, v, { size: 12, weight: 700, ltr: true });
        f.text(X0 + 840, 540 + i * 20, w, { size: 11, fill: C.ink2, align: 'end', ltr: true });
      });
      f.card(X0, 620, 860, 80, { r: 20 });
      f.text(X0 + 20, 652, t('fin.cases'), { size: 15, weight: 800 });
      f.text(X0 + 20, 676, t('fin.noCases'), { size: 12, fill: C.ink2 });
    },
  }),
  meta({
    id: 'VA12',
    name: 'Order detail as Support (provider data redacted)',
    journey: 'Finance',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Redacted field "hidden for your role"', 'No reverse / refund buttons'],
    states: ['Support: lookup only, no Overview tab, no provider reference or callbacks'],
    route: '/finance/orders/[id]',
    priority: 'P1',
    shot: null,
    draw(f) {
      const t = f.t;
      FIN(f);
      f.text(X0, 100, '← ' + t('fin.back'), { size: 13, weight: 700, fill: C.purple });
      f.text(X0, 132, t('fin.order', { ref: 'ORD-DDZYFX' }), { size: 24, weight: 800 });
      orderFacts(f, X0, 156, 860, true);
      f.rect(X0, 330, 860, 46, { r: 14, fill: C.lilac });
      f.text(X0 + 16, 358, t('fin.hidden') + ': ' + t('fin.providerRef') + ', ' + t('fin.events'), {
        size: 12,
        weight: 700,
      });
    },
  }),
  meta({
    id: 'VA13',
    name: 'Refund queue (status, maker-checker)',
    journey: 'Refund',
    rtl: true,
    figma: 'none',
    isNew: true,
    comps: [
      'Status filter',
      'Refund table',
      'Refund status chip',
      'Approve / Reject / Retry buttons',
      'Needs-second-approver note',
    ],
    states: [
      'under review',
      'approved / processing',
      'failed (retry)',
      'admin exception waiting for a different approver',
    ],
    route: '/finance (Refunds)',
    shot: 'admin-07-finance-refunds-en',
    draw(f) {
      const t = f.t;
      FIN(f);
      finTabs(f, 2);
      f.rect(X0, 202, 220, 40, { r: 12, fill: '#fff', stroke: C.line });
      f.text(X0 + 14, 227, t('mdeal.hub.allStatuses'), { size: 13, fill: C.ink2 });
      const rows = [
        ['RF-5T69DR', 'ORD-7H2B46', 'UNDER_REVIEW', 'Omar'],
        ['RF-ADMIN1', 'ORD-3C9K1M', 'REQUESTED', 'Layla'],
        ['RF-MQVYNV', 'ORD-RRNBGH', 'REFUNDED', 'Layla'],
        ['RF-F2L8TQ', 'ORD-9P4D7S', 'FAILED', 'Sara'],
      ];
      f.card(X0, 262, W - X0 - 32, 60 * rows.length + 56, { r: 16 });
      [
        t('fin.col.ref'),
        t('fin.col.merchant'),
        t('fin.col.amount'),
        t('fin.col.status'),
        t('fin.col.when'),
      ].forEach((c, i) =>
        f.text(X0 + 16 + [0, 250, 430, 560, 720][i], 292, c, {
          size: 11,
          weight: 800,
          fill: C.ink2,
        }),
      );
      rows.forEach(([ref, ord, st, who], i) => {
        const y = 308 + i * 60;
        f.line(X0 + 12, y, W - 44, y);
        f.text(X0 + 16, y + 24, ref, { size: 13, weight: 700, ltr: true });
        f.text(X0 + 16, y + 44, ord + ' · ' + t('vreason.CHANGED_MIND') + ' · ' + who, {
          size: 11,
          fill: C.ink2,
        });
        f.text(X0 + 266, y + 32, L(f, 'نجد كيتشن', 'Najd Kitchen'), { size: 13 });
        f.text(X0 + 446, y + 32, 'SAR 90.00', { size: 13, weight: 700, ltr: true });
        f.pill(X0 + 576, y + 16, t(`vrefund.${st}`), { ...rchip(f, st), size: 11 });
        f.text(X0 + 736, y + 32, '8 Oct 2026, 18:13', { size: 11, fill: C.ink2, ltr: true });
        if (st === 'UNDER_REVIEW') {
          f.button(X0 + 900, y + 12, 90, 36, t('fin.refund.approve'), { size: 12 });
          f.button(X0 + 1000, y + 12, 90, 36, t('fin.refund.reject'), {
            fill: '#fff',
            color: C.navy,
            stroke: C.line,
            size: 12,
          });
        }
        if (st === 'REQUESTED')
          f.text(X0 + 900, y + 36, t('fin.refund.checker'), {
            size: 11,
            fill: C.warn,
            weight: 700,
          });
        if (st === 'FAILED')
          f.button(X0 + 900, y + 12, 90, 36, t('fin.refund.retry'), {
            fill: '#fff',
            color: C.navy,
            stroke: C.line,
            size: 12,
          });
      });
    },
  }),
  meta({
    id: 'VA14',
    name: 'Refund review dialogs (approve, reject, exceptional refund)',
    journey: 'Refund',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Reason dialog', 'Customer-visible reason note', 'Maker-checker note'],
    states: [
      'reason required (recorded)',
      'reject reason is shown to the customer',
      'redeemed voucher: reverse first',
    ],
    route: '/finance',
    priority: 'P1',
    shot: null,
    draw(f) {
      const t = f.t;
      f.text(32, 44, 'Refund workbench dialogs', { size: 22, weight: 800 });
      [
        [t('fin.refund.approve'), null, false],
        [t('fin.refund.reject'), t('fin.refund.rejectNote'), true],
        [t('fin.refund.create'), t('fin.refund.createBody'), false],
      ].forEach(([title, body, danger], i) => {
        const x = 32 + i * 470;
        f.card(x, 80, 440, 400, { r: 20 });
        f.text(x + 24, 118, title, { size: 18, weight: 800 });
        if (body)
          (body.match(/.{1,50}(\s|$)/g) ?? [])
            .slice(0, 3)
            .forEach((l, j) => f.text(x + 24, 146 + j * 18, l.trim(), { size: 12, fill: C.ink2 }));
        f.text(x + 24, 220, t('fin.refund.reason') + ' *', { size: 12, weight: 700, fill: C.ink2 });
        f.rect(x + 24, 230, 392, 110, { r: 12, fill: '#fff', stroke: C.line });
        f.button(x + 24, 410, 120, 44, t('common.cancel'), {
          fill: '#fff',
          color: C.navy,
          stroke: C.line,
          size: 13,
        });
        f.button(x + 160, 410, 256, 44, title, { fill: danger ? C.red : C.purple, size: 13 });
      });
    },
  }),
  meta({
    id: 'VA15',
    name: 'Refund case in the order: customer-visible status path',
    journey: 'Refund',
    rtl: true,
    figma: 'none',
    isNew: true,
    comps: ['Refund status chip', 'Refund row with actions'],
    states: [
      'REQUESTED → UNDER_REVIEW → APPROVED → PROCESSING → REFUNDED',
      'REJECTED',
      'FAILED → retry',
    ],
    route: '/finance/orders/[id]',
    priority: 'P1',
    shot: null,
    draw(f) {
      const t = f.t;
      FIN(f);
      f.text(X0, 100, t('fin.refunds'), { size: 22, weight: 800 });
      ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'REFUNDED'].forEach((s, i) => {
        const x = X0 + i * 190;
        f.card(x, 140, 176, 90, { r: 16 });
        f.pill(x + 14, 154, t(`vrefund.${s}`), { ...rchip(f, s), size: 11 });
        f.text(x + 14, 206, i < 4 ? '→' : '✓', { size: 16, weight: 800, fill: C.ink2, ltr: true });
      });
      f.card(X0, 260, 940, 150, { r: 20 });
      [
        [t('vrefund.REJECTED'), 'The reason you give is shown to the customer.'],
        [t('vrefund.FAILED'), 'Customer sees "We are finishing your refund." Admin can retry.'],
        [t('vrefund.REFUNDED'), 'Instance becomes REFUNDED; the staff scan shows REFUNDED.'],
      ].forEach(([k, v], i) => {
        f.pill(X0 + 20, 280 + i * 40, k, {
          ...rchip(f, ['REJECTED', 'FAILED', 'REFUNDED'][i]),
          size: 11,
        });
        f.text(X0 + 190, 298 + i * 40, v, { size: 12 });
      });
    },
  }),
  meta({
    id: 'VA16',
    name: 'Merchant payable status',
    journey: 'Finance',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Merchant payable table', 'Placeholder legal note'],
    states: [
      'held, settlement-eligible, fees, refunded, expired (settlement runs are a later stage)',
    ],
    route: '/finance (Overview)',
    priority: 'P2',
    shot: null,
    draw(f) {
      const t = f.t;
      FIN(f);
      finTabs(f, 0);
      f.text(X0, 222, t('fin.merchants'), { size: 16, weight: 800 });
      table(
        f,
        X0,
        240,
        W - X0 - 32,
        [
          { label: t('fin.col.merchant'), w: 260 },
          { label: t('fin.col.held'), w: 160 },
          { label: t('fin.col.eligible'), w: 200 },
          { label: t('fin.col.fee'), w: 140 },
          { label: t('fin.col.refunded'), w: 140 },
          { label: t('fin.col.expired'), w: 120 },
        ],
        [
          ['Najd Kitchen', 'SAR 400.00', 'SAR 72.00', 'SAR 8.00', 'SAR 0.00', 'SAR 0.00'],
          ['Bloom Beauty Studio', 'SAR 300.00', 'SAR 0.00', 'SAR 0.00', 'SAR 0.00', 'SAR 0.00'],
          ['Pulse Fitness', 'SAR 240.00', 'SAR 108.00', 'SAR 12.00', 'SAR 120.00', 'SAR 0.00'],
        ],
      );
      f.rect(X0, 430, W - X0 - 32, 46, { r: 14, fill: C.lilac });
      f.text(X0 + 16, 458, t('fin.legal').slice(0, 130), { size: 12, weight: 600 });
    },
  }),
  meta({
    id: 'VA17',
    name: 'Redemption lookup and reversal',
    journey: 'Finance',
    rtl: false,
    figma: 'A06 Stage 4 pattern',
    isNew: true,
    comps: ['Order detail redemption block', 'Reverse dialog (reason required)'],
    states: ['reverse a redeemed voucher so it can be refunded', 'REVERSED shows reason'],
    route: '/finance/orders/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      const t = f.t;
      FIN(f);
      f.card(X0, 130, 860, 150, { r: 20 });
      f.text(X0 + 20, 162, t('fin.redemption'), { size: 15, weight: 800 });
      [
        [t('fin.col.ref'), 'RD-ABC234'],
        [t('fin.col.status'), 'REDEEMED'],
        [t('fin.col.when'), '8 Oct 2026, 18:20 · Al Nakheel'],
      ].forEach(([k, v], i) => {
        f.text(X0 + 20, 194 + i * 26, k, { size: 12, fill: C.ink2 });
        f.text(X0 + 840, 194 + i * 26, v, {
          size: 13,
          weight: 700,
          align: 'end',
          ltr: /^RD|^8/.test(v),
        });
      });
      f.card(X0 + 100, 320, 480, 330, { r: 20 });
      f.text(X0 + 124, 360, t('fin.reverse'), { size: 18, weight: 800 });
      (t('fin.reverseBody').match(/.{1,56}(\s|$)/g) ?? [])
        .slice(0, 4)
        .forEach((l, i) => f.text(X0 + 124, 390 + i * 18, l.trim(), { size: 12, fill: C.ink2 }));
      f.text(X0 + 124, 480, t('fin.refund.reason') + ' *', { size: 12, weight: 700, fill: C.ink2 });
      f.rect(X0 + 124, 490, 432, 80, { r: 12, fill: '#fff', stroke: C.line });
      f.button(X0 + 124, 590, 120, 40, t('common.cancel'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
        size: 13,
      });
      f.button(X0 + 260, 590, 296, 40, t('fin.reverse'), { fill: C.red, size: 13 });
    },
  }),
  meta({
    id: 'VA18',
    name: 'Support cases (voucher / payment / refund)',
    journey: 'Support',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Case card', 'Status select', 'Note field'],
    states: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'empty'],
    route: '/finance (Support cases)',
    priority: 'P2',
    shot: 'admin-09-finance-cases-en',
    draw(f) {
      const t = f.t;
      FIN(f);
      finTabs(f, 3);
      [
        ['VOUCHER_ISSUE', 'OPEN'],
        ['REFUND_QUESTION', 'IN_PROGRESS'],
      ].forEach(([type, st], i) => {
        const y = 202 + i * 190;
        f.card(X0, y, W - X0 - 32, 170, { r: 16 });
        f.text(X0 + 20, y + 32, 'My voucher QR does not open', { size: 15, weight: 800 });
        f.text(W - 52, y + 32, 'SC-4K9M2X', { size: 11, fill: C.ink2, align: 'end', ltr: true });
        f.text(
          X0 + 20,
          y + 54,
          t('fin.case.from', { name: 'Layla', type: t(`vcase.type.${type}`) }) + ' · ORD-DDZYFX',
          { size: 12, fill: C.ink2 },
        );
        f.text(X0 + 20, y + 82, 'The code appears blank on my phone after the refund request.', {
          size: 13,
        });
        f.rect(X0 + 20, y + 106, 200, 40, { r: 12, fill: '#fff', stroke: C.line });
        f.text(X0 + 34, y + 131, t(`vcase.status.${st}`), { size: 13 });
        f.rect(X0 + 236, y + 106, 420, 40, { r: 12, fill: '#fff', stroke: C.line });
        f.text(X0 + 250, y + 131, t('fin.case.note'), { size: 13, fill: C.ink2 });
        f.button(X0 + 672, y + 106, 100, 40, t('fin.case.save'), { size: 13 });
      });
    },
  }),
];
void tabs;
void chip;
