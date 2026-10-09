import {
  wrap,
  C,
  TONES,
  DESKTOP,
  L,
  X0,
  sar,
  portalChrome,
  MERCHANT_NAV5,
  chip,
  kpi,
  table,
  tabs,
  vchip,
  TITLE,
  MERCHANT,
  shortField,
  voucherBadge,
} from './lib.mjs';

const W = DESKTOP.w;
const M = (f, active = 'nav.vouchers') =>
  portalChrome(f, { surface: 'merchant', active: f.t(active), items: MERCHANT_NAV5(f.t) });
const meta = (extra) => ({
  journey: 'Create',
  device: 'desktop',
  svg: true,
  isNew: true,
  sheets: [],
  priority: 'P1',
  ...extra,
});

function segment(f, x, y) {
  f.rect(x, y, 330, 40, { r: 20, fill: C.slate });
  f.rect(x + 223, y + 3, 104, 34, { r: 17, fill: '#fff' });
  [
    [f.t('mh.tabLive'), 55],
    [f.t('mh.tabHot'), 165],
    [f.t('mv.tab'), 275],
  ].forEach(([s, cx], i) =>
    f.text(x + cx, y + 25, s, {
      size: 13,
      weight: 700,
      fill: i === 2 ? C.purple : C.ink2,
      align: 'middle',
    }),
  );
}

function stepper(f, step) {
  const names = ['offer', 'content', 'validity', 'branches', 'rules', 'review'].map((s) =>
    f.t(`mv.step.${s}`),
  );
  f.card(X0, 150, 220, 330, { r: 20 });
  names.forEach((n, i) => {
    const y = 176 + i * 50;
    f.circle(X0 + 36, y + 14, 13, {
      fill: i === step ? C.purple : i < step ? C.mint : '#fff',
      stroke: i > step ? C.line : undefined,
      sw: 2,
    });
    f.text(X0 + 36, y + 19, i < step ? '✓' : String(i + 1), {
      size: 12,
      weight: 800,
      fill: i <= step ? '#fff' : C.ink2,
      align: 'middle',
      ltr: true,
    });
    f.text(X0 + 60, y + 19, n.slice(0, 20), {
      size: 13,
      weight: i === step ? 800 : 600,
      fill: i === step ? C.purple : C.navy,
    });
  });
}

function preview(f, px, o = {}) {
  const t = f.t;
  const wd = W - px - 32;
  f.card(px, 150, wd, 680, { r: 20 });
  f.text(px + 20, 182, t('mhb.preview'), { size: 15, weight: 800 });
  f.rect(px + 20, 194, 150, 30, { r: 15, fill: C.slate });
  f.text(px + 62, 214, t('review.previewCard'), {
    size: 12,
    weight: 800,
    fill: C.purple,
    align: 'middle',
  });
  f.text(px + 128, 214, t('review.previewDetail'), {
    size: 12,
    weight: 600,
    fill: C.ink2,
    align: 'middle',
  });
  f.photo(px + 20, 240, wd - 40, 120, { r: 16 });
  voucherBadge(f, px + 30, 250);
  f.pill(px + 30, 326, sar(f, o.face ?? 12000), {
    fill: C.purple,
    color: '#fff',
    size: 11,
    ltr: true,
  });
  f.text(px + 20, 388, o.title ?? TITLE(f), { size: 14, weight: 800 });
  f.text(px + 20, 408, MERCHANT(f), { size: 12, fill: C.ink2 });
  const w = f.pill(px + 20, 420, sar(f, o.price ?? 9000), {
    fill: C.slate,
    color: C.navy,
    size: 12,
    ltr: true,
  });
  f.pill(px + 26 + w, 420, `${o.pct ?? 25}%`, {
    fill: C.greenBg,
    color: C.green,
    size: 11,
    ltr: true,
  });
  f.text(
    px + 20,
    478,
    t('vch.reportedSavings') + ' ' + t('vch.savingsAmount', { amount: sar(f, 3000), pct: 25 }),
    { size: 12, weight: 800, fill: C.green },
  );
  (t('vch.savingsNote').match(/.{1,40}(\s|$)/g) ?? [])
    .slice(0, 4)
    .forEach((l, i) => f.text(px + 20, 504 + i * 16, l.trim(), { size: 11, fill: C.ink2 }));
}

function builderShell(f, step, o, draw) {
  const t = f.t;
  M(f);
  f.text(X0, 100, '← ' + t('mdeal.back'), { size: 13, weight: 700, fill: C.purple });
  f.text(X0, 128, t('mv.newTitle'), { size: 22, weight: 800 });
  const st = o.status ?? 'DRAFT';
  f.pill(X0 + 170, 108, t(`vstatus.${st}`), {
    ...TONES[{ DRAFT: 'neutral', NEEDS_CHANGES: 'warning' }[st] ?? 'neutral'],
    size: 11,
  });
  f.pill(W - 220 - 190, 108, t('builder.translationComplete'), { ...TONES.success, size: 11 });
  if (o.banner) {
    f.rect(X0 + 240, 136, 560 + 580 - 240 - 0, 0, {});
  }
  stepper(f, step);
  const cx = X0 + 240;
  f.card(cx, 150, 560, 680, { r: 20 });
  f.text(cx + 24, 184, t('builder.step', { n: step + 1, total: 6 }), { size: 11, fill: C.ink2 });
  f.text(
    cx + 24,
    210,
    t(`mv.step.${['offer', 'content', 'validity', 'branches', 'rules', 'review'][step]}`),
    { size: 18, weight: 800 },
  );
  f.text(
    cx + 24,
    230,
    t(`mv.stepHelp.${['offer', 'content', 'validity', 'branches', 'rules', 'review'][step]}`).slice(
      0,
      78,
    ),
    { size: 12, fill: C.ink2 },
  );
  draw(cx + 24, 262);
  f.line(cx + 24, 770, cx + 536, 770);
  f.button(cx + 24, 780, 100, 40, t('mhb.back'), {
    fill: '#fff',
    color: C.navy,
    stroke: C.line,
    size: 13,
  });
  f.button(cx + 320, 780, 100, 40, t('mhb.save'), { fill: C.lilac, color: C.purple, size: 13 });
  f.button(cx + 432, 780, 104, 40, step === 5 ? t('mhb.submit') : t('mhb.next'), { size: 13 });
  preview(f, cx + 580, o.preview);
}

const biField = (f, x, y, label, en, ar, o = {}) => {
  shortField(f, x, y, 250, `${label} (${f.t('builder.langEn')}) *`, en, o);
  shortField(f, x + 270, y, 250, `${label} (${f.t('builder.langAr')}) *`, ar, o);
};

const checkbox = (f, x, y, on, label) => {
  f.rect(x, y, 20, 20, {
    r: 6,
    fill: on ? C.purple : '#fff',
    stroke: on ? C.purple : C.line,
    sw: 1.5,
  });
  if (on)
    f.text(x + 10, y + 15, '✓', {
      size: 13,
      weight: 800,
      fill: '#fff',
      align: 'middle',
      ltr: true,
    });
  f.text(x + 32, y + 15, label, { size: 13, weight: 600 });
};

function detailShell(f, tabIdx, status, body, o = {}) {
  const t = f.t;
  M(f);
  f.text(X0, 100, '← ' + t('mdeal.back'), { size: 13, weight: 700, fill: C.purple });
  f.text(X0, 132, TITLE(f), { size: 24, weight: 800 });
  f.pill(X0 + 330, 112, t(`vstatus.${status}`), { ...vchip(f, status), size: 11 });
  if (o.actions !== false) {
    f.button(W - 220 - 450, 104, 120, 40, t('mv.addCapacity'), {
      fill: '#fff',
      color: C.navy,
      stroke: C.line,
      size: 12,
    });
    f.button(W - 220 - 320, 104, 120, 40, t('mv.pause'), {
      fill: '#fff',
      color: C.navy,
      stroke: C.line,
      size: 12,
    });
    f.button(W - 220 - 190, 104, 110, 40, t('mv.end'), { fill: C.red, size: 12 });
  }
  if (o.banner) {
    f.rect(X0, 156, W - X0 - 32, 44, { r: 14, fill: o.banner[0] });
    f.text(X0 + 16, 183, o.banner[1].slice(0, 120), {
      size: 13,
      weight: 700,
      fill: o.banner[2] ?? C.navy,
    });
  }
  const ty = o.banner ? 212 : 160;
  tabs(f, X0, ty, [t('mv.tabMonitor'), t('mv.tabSales'), t('mv.tabActivity')], tabIdx);
  body(X0, ty + 56);
}

function monitorBody(f) {
  const t = f.t;
  return (x, y) => {
    [
      [12, t('mv.kpi.sold')],
      [6, t('mv.kpi.active')],
      [5, t('mv.kpi.used')],
      [0, t('mv.kpi.expired')],
      [1, t('mv.kpi.refunded')],
      ['42%', t('mv.kpi.rate')],
      ['37 / 50', t('mv.kpi.remaining')],
      [1, t('mv.kpi.held')],
    ].forEach(([v, l], i) => kpi(f, x + (i % 4) * 224, y + Math.floor(i / 4) * 94, 212, v, l));
    f.card(x, y + 200, 440, 190, { r: 20 });
    f.text(x + 20, y + 232, t('mv.funnel'), { size: 15, weight: 800 });
    [
      [t('mv.funnel.impressions'), '300'],
      [t('mv.funnel.views'), '80'],
      [t('mv.funnel.checkouts'), '20'],
      [t('mv.funnel.paid'), '12'],
      [t('mv.funnel.failed'), '3'],
    ].forEach(([k, v], i) => {
      f.text(x + 20, y + 262 + i * 24, k, { size: 12, fill: C.ink2 });
      f.text(x + 420, y + 262 + i * 24, v, { size: 13, weight: 800, align: 'end', ltr: true });
    });
    f.card(x + 456, y + 200, 440, 190, { r: 20 });
    f.text(x + 476, y + 232, t('mv.money'), { size: 15, weight: 800 });
    [
      [t('mv.money.sold'), sar(f, 96000)],
      [t('mv.money.redeemed'), sar(f, 40000)],
      [t('mv.money.eligible'), sar(f, 36000)],
      [t('mv.money.refunded'), sar(f, 8000)],
    ].forEach(([k, v], i) => {
      f.text(x + 476, y + 262 + i * 26, k, { size: 12, fill: C.ink2 });
      f.text(x + 876, y + 262 + i * 26, v, { size: 13, weight: 800, align: 'end', ltr: true });
    });
    f.text(x + 476, y + 372, t('mv.moneyNote').slice(0, 70), { size: 10, fill: C.ink2 });
    f.text(x, y + 424, t('mv.capacity'), { size: 13, weight: 800 });
    f.rect(x, y + 436, 896, 14, { r: 7, fill: C.slate });
    f.rect(x, y + 436, 240, 14, { r: 7, fill: C.purple });
    f.rect(x + 240, y + 436, 18, 14, { fill: C.amber });
  };
}

export const merchant = [
  meta({
    id: 'VM01',
    name: 'Campaigns: Vouchers list (third tab)',
    rtl: true,
    figma: '58 Business console - Campaigns (REPLACED by Merchant Portal)',
    isNew: true,
    comps: [
      'Sidebar nav (Vouchers, Finance)',
      'Live / Hot / Vouchers switch',
      'Info alert (payable note)',
      'Filters',
      'Voucher status chip',
      'Table',
    ],
    states: ['loading', 'empty', 'error', 'no manage permission'],
    route: '/vouchers',
    shot: 'merchant-01-voucher-hub-en',
    draw(f) {
      const t = f.t;
      M(f);
      f.text(X0, 100, t('mv.title'), { size: 28, weight: 800 });
      f.text(X0, 124, t('mv.sub').slice(0, 90), { size: 13, fill: C.ink2 });
      f.button(W - 220 - 190, 84, 190, 44, '+ ' + t('mv.create'), { size: 13 });
      segment(f, X0, 148);
      f.rect(X0, 202, W - X0 - 32, 44, { r: 14, fill: C.lilac });
      f.text(X0 + 16, 229, 'ⓘ ' + t('mv.note').slice(0, 120), { size: 13, weight: 600 });
      f.rect(X0, 262, 280, 40, { r: 12, fill: '#fff', stroke: C.line });
      f.text(X0 + 14, 287, t('mdeal.hub.search'), { size: 13, fill: C.ink2 });
      f.rect(X0 + 296, 262, 200, 40, { r: 12, fill: '#fff', stroke: C.line });
      f.text(X0 + 310, 287, t('mdeal.hub.allStatuses'), { size: 13, fill: C.ink2 });
      table(
        f,
        X0,
        322,
        W - X0 - 32,
        [
          { label: t('mdeal.col.title'), w: 330 },
          { label: t('mv.colValue'), w: 190 },
          { label: t('mv.colSale'), w: 200 },
          { label: t('mv.colSold'), w: 100 },
          { label: t('mv.colUsed'), w: 90 },
          { label: t('mdeal.col.status'), w: 150 },
        ],
        [
          [
            TITLE(f),
            'SAR 120.00 / 90.00',
            '8 Oct – ' + t('mv.untilEnd'),
            '12 / 50',
            '5',
            vchip(f, 'ON_SALE'),
          ],
          [
            L(f, 'قسيمة سبا بقيمة 200 ريال', 'SAR 200 spa voucher'),
            'SAR 200.00 / 150.00',
            '8 Oct – ' + t('mv.untilEnd'),
            '3 / 20',
            '1',
            vchip(f, 'PAUSED'),
          ],
          [
            L(f, 'قسيمة قهوة بقيمة 50 ريال', 'SAR 50 coffee voucher'),
            'SAR 50.00 / 40.00',
            '- – -',
            '0 / 100',
            '0',
            vchip(f, 'PENDING_REVIEW'),
          ],
          [
            L(f, 'قسيمة إفطار بقيمة 80 ريال', 'SAR 80 breakfast voucher'),
            'SAR 80.00 / 60.00',
            '- – -',
            '0 / 30',
            '0',
            vchip(f, 'NEEDS_CHANGES'),
          ],
          [
            L(f, 'قسيمة هدية بقيمة 100 ريال', 'SAR 100 gift voucher'),
            'SAR 100.00 / 80.00',
            '8 Oct – ' + t('mv.untilEnd'),
            '20 / 20',
            '9',
            vchip(f, 'SOLD_OUT'),
          ],
          [
            L(f, 'قسيمة موسمية', 'Seasonal voucher'),
            'SAR 60.00 / 45.00',
            '1 Sep – 30 Sep',
            '14 / 40',
            '14',
            vchip(f, 'ENDED'),
          ],
        ],
      );
    },
  }),
  meta({
    id: 'VM02',
    name: 'Vouchers: empty state',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Empty state', 'Primary button'],
    states: ['no vouchers yet'],
    route: '/vouchers',
    priority: 'P2',
    shot: null,
    draw(f) {
      const t = f.t;
      M(f);
      f.text(X0, 100, t('mv.title'), { size: 28, weight: 800 });
      f.button(W - 220 - 190, 84, 190, 44, '+ ' + t('mv.create'), { size: 13 });
      segment(f, X0, 148);
      f.circle(X0 + 440, 380, 44, { fill: C.lilac });
      f.text(X0 + 440, 470, t('mv.empty'), { size: 22, weight: 800, align: 'middle' });
      f.text(X0 + 440, 498, t('mv.emptyBody').slice(0, 90), {
        size: 13,
        fill: C.ink2,
        align: 'middle',
      });
      f.button(X0 + 340, 524, 200, 48, t('mv.create'));
    },
  }),
  meta({
    id: 'VM03',
    name: 'Builder 1/6: Offer (value, price, savings, quantity)',
    rtl: true,
    figma: '63 Business - Create Exclusive Deal (REPLACED pattern)',
    isNew: true,
    comps: [
      'Stepper',
      'Value / price fields (SAR)',
      'Reported-savings preview',
      'Issuance limit',
      'Per-customer limit',
      'Customer preview panel',
    ],
    states: ['draft saved', 'autosave 30 s', 'per-step validation'],
    route: '/vouchers/new',
    shot: 'merchant-03-voucher-builder-offer-en',
    draw(f) {
      builderShell(f, 0, {}, (x, y) => {
        const t = f.t;
        shortField(f, x, y, 520, t('mhb.category') + ' *', L(f, 'المطاعم', 'Dining'));
        shortField(f, x, y + 80, 250, t('mv.face') + ' *', '120', { ltr: true });
        shortField(f, x + 270, y + 80, 250, t('mv.price') + ' *', '90', { ltr: true });
        f.text(x, y + 160, t('mv.faceHelp'), { size: 11, fill: C.ink2 });
        f.rect(x, y + 176, 520, 64, { r: 14, fill: C.lilac });
        f.text(x + 16, y + 202, t('mv.customerSaves'), { size: 12, weight: 800 });
        f.text(x + 16, y + 224, 'SAR 30.00 (25%)', {
          size: 15,
          weight: 800,
          fill: C.green,
          ltr: true,
        });
        shortField(f, x, y + 260, 250, t('mv.qty') + ' *', '50', { ltr: true });
        shortField(f, x + 270, y + 260, 250, t('mv.perCustomer') + ' *', '2', { ltr: true });
        f.text(x, y + 340, t('mv.qtyHelp'), { size: 11, fill: C.ink2 });
      });
    },
  }),
  meta({
    id: 'VM04',
    name: 'Builder 1/6: validation (price above value)',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Field error state', 'Inline error'],
    states: ['PRICE_ABOVE_FACE blocks Next; nothing saved'],
    route: '/vouchers/new',
    priority: 'P2',
    shot: null,
    draw(f) {
      builderShell(f, 0, {}, (x, y) => {
        const t = f.t;
        shortField(f, x, y, 520, t('mhb.category') + ' *', 'Dining');
        shortField(f, x, y + 80, 250, t('mv.face') + ' *', '120', { ltr: true });
        shortField(f, x + 270, y + 80, 250, t('mv.price') + ' *', '150', {
          ltr: true,
          error: t('issue.PRICE_ABOVE_FACE'),
        });
        f.text(x, y + 280, t('builder.itemsNeedAttention', { n: 1 }), {
          size: 12,
          weight: 700,
          fill: C.danger,
        });
      });
    },
  }),
  meta({
    id: 'VM05',
    name: 'Builder 2/6: Content (English + Arabic, photos)',
    rtl: false,
    figma: '63 Business - Create Exclusive Deal',
    isNew: true,
    comps: [
      'Bilingual field pair (EN LTR / AR RTL)',
      'Photo uploader + alt text',
      'Translation status chip',
    ],
    states: ['missing Arabic blocks Next', 'upload error', 'photo size rules'],
    route: '/vouchers/new (step 2)',
    shot: 'merchant-04-voucher-builder-content-en',
    draw(f) {
      builderShell(f, 1, {}, (x, y) => {
        const t = f.t;
        biField(f, x, y, t('mv.title2'), 'SAR 120 dinner voucher', 'قسيمة عشاء بقيمة 120 ريال');
        biField(
          f,
          x,
          y + 78,
          t('mv.short'),
          'Pay SAR 90, dine for SAR 120',
          'ادفع 90 وتناول بقيمة 120',
        );
        biField(f, x, y + 156, t('mv.long'), 'A dinner voucher…', 'قسيمة عشاء…', { h: 70 });
        biField(f, x, y + 262, t('mv.rules'), 'Show the QR code…', 'اعرض رمز QR…', { h: 70 });
        f.text(x, y + 380, t('mv.photos'), { size: 13, weight: 800 });
        f.photo(x, y + 392, 160, 100, { r: 12 });
        f.rect(x + 176, y + 392, 160, 100, { r: 12, stroke: C.line, dash: true });
        f.text(x + 256, y + 448, '+ ' + t('media.add'), {
          size: 12,
          fill: C.purple,
          weight: 700,
          align: 'middle',
        });
      });
    },
  }),
  meta({
    id: 'VM06',
    name: 'Builder 3/6: Validity and sale period',
    rtl: true,
    figma: 'none',
    isNew: true,
    comps: [
      'Radio group (days from purchase / fixed date)',
      'Number field',
      'Datetime fields (Riyadh time)',
      'No-end checkbox',
    ],
    states: ['days', 'fixed date', 'live: locked'],
    route: '/vouchers/new (step 3)',
    shot: 'merchant-05-voucher-builder-validity-en',
    draw(f) {
      builderShell(f, 2, {}, (x, y) => {
        const t = f.t;
        f.text(x, y + 6, t('mv.validityType') + ' *', { size: 13, weight: 800 });
        [
          [true, t('validity.DAYS_FROM_PURCHASE')],
          [false, t('validity.FIXED_DATE')],
        ].forEach(([on, s], i) => {
          f.circle(x + 10, y + 36 + i * 30, 9, {
            stroke: on ? C.purple : C.line,
            sw: 2,
            fill: on ? C.purple : 'none',
          });
          f.text(x + 30, y + 41 + i * 30, s, { size: 13, weight: 600 });
        });
        shortField(f, x, y + 100, 200, t('mv.validityDays') + ' *', '30', { ltr: true });
        f.text(x, y + 180, t('mv.saleHelp').slice(0, 80), { size: 11, fill: C.ink2 });
        shortField(f, x, y + 210, 250, t('mv.saleStart') + ' (' + t('field.riyadhTime') + ')', '', {
          placeholder: true,
        });
        shortField(
          f,
          x + 270,
          y + 210,
          250,
          t('mv.saleEnd') + ' (' + t('field.riyadhTime') + ')',
          '',
          { disabled: true },
        );
        checkbox(f, x + 270, y + 270, true, t('mv.noEnd'));
      });
    },
  }),
  meta({
    id: 'VM07',
    name: 'Builder 4/6: Participating branches',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Branch checklist'],
    states: ['at least one branch required', 'live: locked'],
    route: '/vouchers/new (step 4)',
    priority: 'P2',
    shot: null,
    draw(f) {
      builderShell(f, 3, {}, (x, y) => {
        f.text(x, y + 6, f.t('mv.branchesHelp'), { size: 12, fill: C.ink2 });
        [
          [true, 'Najd Kitchen Al Nakheel'],
          [true, 'Najd Kitchen Hittin'],
          [false, 'Najd Kitchen Olaya'],
        ].forEach(([on, s], i) => {
          f.rect(x, y + 30 + i * 56, 520, 46, { r: 14, fill: '#fff', stroke: C.line });
          checkbox(f, x + 16, y + 43 + i * 56, on, s);
        });
      });
    },
  }),
  meta({
    id: 'VM08',
    name: 'Builder 5/6: Eligibility and terms',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Eligibility radios', 'Terms checkboxes', 'Valid-day chips', 'Bilingual terms'],
    states: ['public', 'city', 'employer', 'bank card', 'scheme'],
    route: '/vouchers/new (step 5)',
    priority: 'P2',
    shot: null,
    draw(f) {
      builderShell(f, 4, {}, (x, y) => {
        const t = f.t;
        f.text(x, y + 6, t('mv.eligibility'), { size: 13, weight: 800 });
        ['PUBLIC', 'GEOGRAPHY', 'EMPLOYER', 'BANK_CARD', 'SCHEME'].forEach((k, i) => {
          f.circle(x + 10, y + 34 + i * 28, 9, {
            stroke: i === 0 ? C.purple : C.line,
            sw: 2,
            fill: i === 0 ? C.purple : 'none',
          });
          f.text(x + 30, y + 39 + i * 28, t(`elig.${k}`), { size: 13, weight: 600 });
        });
        f.text(x, y + 190, t('mhb.terms'), { size: 13, weight: 800 });
        checkbox(f, x, y + 204, true, t('terms.fullPriceOnly'));
        checkbox(f, x, y + 236, false, t('terms.notCombinable'));
        shortField(f, x, y + 290, 250, t('field.termsText') + ' (EN) *', 'One voucher per visit.', {
          h: 64,
        });
        shortField(
          f,
          x + 270,
          y + 290,
          250,
          t('field.termsText') + ' (AR) *',
          'قسيمة واحدة لكل زيارة.',
          { h: 64 },
        );
      });
    },
  }),
  meta({
    id: 'VM09',
    name: 'Builder 6/6: Review and submit',
    rtl: true,
    figma: 'none',
    isNew: true,
    comps: [
      'Success alert',
      'Guardrail alert',
      'Summary card',
      'Refund + payable placeholder notes',
      'Submit button',
    ],
    states: ['complete', 'fix-first list', 'auto-publish vs manual review', 'live: save changes'],
    route: '/vouchers/new (step 6)',
    shot: 'merchant-06-voucher-builder-review-en',
    draw(f) {
      builderShell(f, 5, {}, (x, y) => {
        const t = f.t;
        f.rect(x, y, 520, 40, { r: 12, fill: C.greenBg });
        f.text(x + 14, y + 26, t('dreview.complete'), { size: 13, weight: 700, fill: C.green });
        f.rect(x, y + 52, 520, 54, { r: 12, fill: C.warnBg });
        f.text(x + 14, y + 74, t('mv.guardrail.manual').slice(0, 60), {
          size: 12,
          weight: 700,
          fill: C.warn,
        });
        f.text(x + 14, y + 94, '• ' + t('guardrail.reason.PILOT_MANUAL_REVIEW').slice(0, 60), {
          size: 11,
          fill: C.warn,
        });
        f.card(x, y + 122, 520, 190, { r: 16 });
        [
          [t('mv.title2'), TITLE(f)],
          [t('mv.summary.pricing'), 'SAR 120.00 / SAR 90.00'],
          [t('mv.qty'), '50'],
          [t('mv.summary.validity'), t('vch.validDays', { n: 30 })],
          [t('mv.summary.branches'), 'Al Nakheel, Hittin'],
          [t('mv.eligibility'), t('elig.PUBLIC')],
        ].forEach(([k, v], i) => {
          f.text(x + 16, y + 150 + i * 28, k, { size: 12, fill: C.ink2 });
          f.text(x + 504, y + 150 + i * 28, v, {
            size: 12,
            weight: 700,
            align: 'end',
            ltr: /^SAR|^\d/.test(v),
          });
        });
        f.rect(x, y + 326, 520, 46, { r: 12, fill: C.lilac });
        wrap(f, x + 14, y + 346, t('mv.refundPolicy', { hours: 24 }), 84, {
          size: 11,
          weight: 600,
          fill: C.navy,
          max: 2,
        });
        f.rect(x, y + 384, 520, 46, { r: 12, fill: C.lilac });
        wrap(f, x + 14, y + 404, t('mv.payableRule'), 84, {
          size: 11,
          weight: 600,
          fill: C.navy,
          max: 2,
        });
      });
    },
  }),
  meta({
    id: 'VM10',
    name: 'Customer preview panel (card + detail, EN / AR)',
    rtl: true,
    figma: 'none',
    isNew: true,
    comps: ['Preview panel', 'EN / AR switch', 'Card / Detail tabs'],
    states: ['no preview before first save', 'locked / sold-out previews'],
    route: '/vouchers/new (aside)',
    priority: 'P2',
    shot: null,
    draw(f) {
      M(f);
      f.text(X0, 100, f.t('mhb.preview'), { size: 22, weight: 800 });
      preview(f, X0 + 60);
      preview(f, X0 + 520, {
        title: L(f, 'قسيمة سبا بقيمة 200 ريال', 'SAR 200 spa voucher'),
        face: 20000,
        price: 15000,
      });
    },
  }),
  meta({
    id: 'VM11',
    name: 'Submitted: sent for review',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Result card', 'Go to voucher link'],
    states: ['SENT_FOR_REVIEW', 'PUBLISHED', 'SCHEDULED', 'minor edit applied'],
    route: '/vouchers/new (result)',
    priority: 'P2',
    shot: 'merchant-07-voucher-submitted-en',
    draw(f) {
      M(f);
      f.card(X0, 120, 760, 260, { r: 20 });
      f.circle(X0 + 56, 184, 26, { fill: C.greenBg });
      f.text(X0 + 56, 193, '✓', {
        size: 26,
        weight: 800,
        fill: C.green,
        align: 'middle',
        ltr: true,
      });
      f.text(X0 + 100, 190, f.t('mv.sentForReview'), { size: 26, weight: 800 });
      f.text(X0 + 100, 222, f.t('mv.reviewBody').slice(0, 90), { size: 14, fill: C.ink2 });
      f.button(X0 + 24, 296, 220, 48, f.t('review.goToDeal'));
    },
  }),
  meta({
    id: 'VM12',
    name: 'Builder: changes requested (reviewer reason)',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Warning banner with reason', 'Status chip'],
    states: ['NEEDS_CHANGES → resubmit'],
    route: '/vouchers/[id]/edit',
    priority: 'P1',
    shot: null,
    draw(f) {
      builderShell(f, 0, { status: 'NEEDS_CHANGES' }, (x, y) => {
        const t = f.t;
        f.rect(x, y - 18, 520, 56, { r: 12, fill: C.warnBg });
        f.text(x + 14, y + 4, t('banner.needsChanges'), { size: 12, weight: 800, fill: C.warn });
        f.text(x + 14, y + 24, 'The savings claim looks high. Please confirm the value.', {
          size: 12,
          fill: C.warn,
        });
        shortField(f, x, y + 70, 250, t('mv.face') + ' *', '120', { ltr: true });
        shortField(f, x + 270, y + 70, 250, t('mv.price') + ' *', '90', { ltr: true });
      });
    },
  }),
  meta({
    id: 'VM13',
    name: 'Voucher status board (all merchant-visible states)',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Voucher status chip', 'Banner variants'],
    states: [
      'Draft',
      'Pending review',
      'Changes requested',
      'Scheduled',
      'On sale',
      'Paused (by merchant / by DealDash)',
      'Sold out',
      'Ended',
      'Rejected',
      'Suspended',
    ],
    route: 'apps/merchant/features/voucher-utils.tsx',
    priority: 'P1',
    shot: null,
    draw(f) {
      const t = f.t;
      M(f);
      f.text(X0, 100, 'Voucher statuses and what the merchant sees', { size: 22, weight: 800 });
      const rows = [
        ['DRAFT', 'Edit everything; Submit for review'],
        ['PENDING_REVIEW', t('mhb.pendingEdit')],
        ['NEEDS_CHANGES', t('banner.needsChanges') + ': reviewer reason shown; edit and resubmit'],
        ['SCHEDULED', 'Approved; goes on sale at the start time; wording edits only'],
        ['ON_SALE', 'Selling; Pause, End, Add capacity, wording edits'],
        ['PAUSED', t('mv.pausedByDealDash')],
        ['SOLD_OUT', 'All units sold or held; add capacity to reopen'],
        ['ENDED', 'Sale ended; sold vouchers stay valid and redeemable'],
        ['REJECTED', 'Rejected with a reason; create a new voucher'],
        ['SUSPENDED', t('mv.suspendedNote')],
      ];
      rows.forEach(([s, d], i) => {
        const y = 130 + i * 62;
        f.card(X0, y, W - X0 - 32, 52, { r: 14 });
        f.pill(X0 + 16, y + 12, t(`vstatus.${s}`), { ...vchip(f, s), size: 11 });
        f.text(X0 + 200, y + 31, d.slice(0, 130), { size: 13 });
      });
    },
  }),
  meta({
    id: 'VM14',
    name: 'Voucher detail: Monitor (sales, funnel, verified money)',
    journey: 'Monitor',
    rtl: true,
    figma: 'none',
    isNew: true,
    comps: ['KPI card', 'Funnel card', 'Verified-money card', 'Capacity bar', 'Action buttons'],
    states: ['no finance permission hides the money card', 'live refresh every 20 s'],
    route: '/vouchers/[id]',
    shot: 'merchant-09-voucher-monitor-after-sale-en',
    draw(f) {
      detailShell(f, 0, 'ON_SALE', monitorBody(f));
    },
  }),
  meta({
    id: 'VM15',
    name: 'Voucher detail: Sales (first name only, reverse use)',
    journey: 'Monitor',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Sales table', 'Status chip', 'Reverse button'],
    states: ['privacy note: first name and status only', 'reverse needs a reason'],
    route: '/vouchers/[id] (Sales)',
    shot: 'merchant-10-voucher-sales-en',
    draw(f) {
      detailShell(f, 1, 'ON_SALE', (x, y) => {
        const t = f.t;
        f.text(x, y, t('mv.salesPrivacy'), { size: 12, fill: C.ink2 });
        table(
          f,
          x,
          y + 16,
          W - X0 - 32,
          [
            { label: t('mv.col.ref'), w: 150 },
            { label: t('mv.col.customer'), w: 150 },
            { label: t('mv.col.paid'), w: 130 },
            { label: t('mv.col.status'), w: 140 },
            { label: t('mv.col.when'), w: 200 },
            { label: t('mv.col.branch'), w: 150 },
            { label: '', w: 120 },
          ],
          [
            [
              'VC-K7QM9T',
              'Layla',
              'SAR 90.00',
              chip(t('vinst.REDEEMED'), 'info'),
              '8 Oct 2026, 18:20',
              'Al Nakheel',
              chip(t('mv.reverse'), 'neutral'),
            ],
            [
              'VC-P3WX2A',
              'Omar',
              'SAR 90.00',
              chip(t('vinst.ACTIVE'), 'success'),
              '8 Oct 2026, 17:02',
              '–',
              '',
            ],
            [
              'VC-H9ZD4B',
              'Sara',
              'SAR 90.00',
              chip(t('vinst.REFUNDED'), 'neutral'),
              '7 Oct 2026, 11:40',
              '–',
              '',
            ],
            [
              'VC-M2NQ8C',
              'Khalid',
              'SAR 90.00',
              chip(t('vinst.EXPIRED'), 'neutral'),
              '2 Sep 2026, 09:15',
              '–',
              '',
            ],
          ],
        );
      });
    },
  }),
  meta({
    id: 'VM16',
    name: 'Voucher detail: Activity',
    journey: 'Monitor',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Activity card'],
    states: ['created, edited, submitted, approved, paused…'],
    route: '/vouchers/[id] (Activity)',
    priority: 'P2',
    shot: null,
    draw(f) {
      detailShell(f, 2, 'ON_SALE', (x, y) => {
        ['APPROVE', 'SUBMIT', 'MINOR_EDIT', 'UPDATE', 'CREATE'].forEach((a, i) => {
          f.card(x, y + i * 70, 760, 60, { r: 14 });
          f.text(x + 16, y + 26 + i * 70, f.t(`vaction.${a}`), { size: 14, weight: 800 });
          f.text(x + 744, y + 26 + i * 70, `8 Oct 2026, 1${8 - i}:0${i}`, {
            size: 11,
            fill: C.ink2,
            align: 'end',
            ltr: true,
          });
          f.text(x + 16, y + 46 + i * 70, a === 'APPROVE' ? 'DealDash' : 'Najd Kitchen Owner', {
            size: 11,
            fill: C.ink2,
          });
        });
      });
    },
  }),
  meta({
    id: 'VM17',
    name: 'Dialogs: pause, end sale, capacity, reverse use',
    journey: 'Monitor',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Reason dialog', 'Capacity dialog'],
    states: ['reason required for End and Reverse', 'optional for Pause'],
    route: '/vouchers/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      const t = f.t;
      f.text(32, 44, 'Merchant dialogs', { size: 22, weight: 800 });
      const dlg = (x, y, title, body, btn, danger, extra) => {
        f.card(x, y, 420, 330, { r: 20 });
        f.text(x + 24, y + 40, title, { size: 17, weight: 800 });
        (body.match(/.{1,50}(\s|$)/g) ?? [])
          .slice(0, 3)
          .forEach((l, i) => f.text(x + 24, y + 70 + i * 18, l.trim(), { size: 12, fill: C.ink2 }));
        if (extra) extra(x, y);
        f.text(x + 24, y + 176, t('mv.reason') + (btn === t('mv.pause') ? '' : ' *'), {
          size: 12,
          weight: 700,
          fill: C.ink2,
        });
        f.rect(x + 24, y + 186, 372, 70, { r: 12, fill: '#fff', stroke: C.line });
        f.button(x + 24, y + 270, 120, 40, t('common.cancel'), {
          fill: '#fff',
          color: C.navy,
          stroke: C.line,
          size: 13,
        });
        f.button(x + 160, y + 270, 236, 40, btn, { fill: danger ? C.red : C.purple, size: 13 });
      };
      dlg(32, 80, t('mv.pause'), '', t('mv.pause'), false);
      dlg(484, 80, t('mv.endTitle'), t('mv.endBody'), t('mv.end'), true);
      dlg(32, 440, t('mv.reverseTitle'), t('mv.reverseBody'), t('mv.reverse'), true);
      f.card(484, 440, 420, 330, { r: 20 });
      f.text(508, 480, t('mv.capacity'), { size: 17, weight: 800 });
      (t('mv.capacityHelp').match(/.{1,50}(\s|$)/g) ?? [])
        .slice(0, 2)
        .forEach((l, i) => f.text(508, 510 + i * 18, l.trim(), { size: 12, fill: C.ink2 }));
      f.rect(508, 560, 372, 36, { r: 18, fill: C.slate });
      f.rect(511, 563, 183, 30, { r: 15, fill: '#fff' });
      f.text(602, 583, t('mv.addCapacity'), {
        size: 12,
        weight: 800,
        fill: C.purple,
        align: 'middle',
      });
      f.text(786, 583, t('mv.removeCapacity'), {
        size: 12,
        weight: 600,
        fill: C.ink2,
        align: 'middle',
      });
      shortField(f, 508, 620, 160, t('mv.capacityAmount'), '10', { ltr: true });
      f.button(508, 700, 372, 40, t('mv.addCapacity'), { size: 13 });
    },
  }),
  meta({
    id: 'VM18',
    name: 'Finance: held vs settlement-eligible',
    journey: 'Finance',
    rtl: true,
    figma: 'none',
    isNew: true,
    comps: ['Money card', 'Counts line', 'Legal placeholder alert', 'Payable events table'],
    states: ['loading', 'error', 'no finance permission'],
    route: '/finance',
    shot: 'merchant-11-finance-en',
    draw(f) {
      const t = f.t;
      M(f, 'nav.finance');
      f.text(X0, 100, t('mf.title'), { size: 28, weight: 800 });
      f.text(X0, 124, t('mf.sub').slice(0, 100), { size: 13, fill: C.ink2 });
      [
        [t('mf.held'), 40000],
        [t('mf.eligible'), 7200],
        [t('mf.fee'), 800],
        [t('mf.refunded'), 0],
        [t('mf.expired'), 0],
      ].forEach(([l, v], i) => {
        f.card(X0 + (i % 3) * 300, 150 + Math.floor(i / 3) * 96, 288, 84, { r: 16 });
        f.text(X0 + 16 + (i % 3) * 300, 180 + Math.floor(i / 3) * 96, sar(f, v), {
          size: 24,
          weight: 800,
          ltr: true,
        });
        f.text(X0 + 16 + (i % 3) * 300, 204 + Math.floor(i / 3) * 96, l.slice(0, 40), {
          size: 11,
          fill: C.ink2,
        });
      });
      f.text(X0, 360, t('mf.counts', { sold: 6, redeemed: 1, refunded: 0, expired: 0 }), {
        size: 12,
        fill: C.ink2,
        ltr: false,
      });
      f.text(X0, 380, t('mf.accrual', { point: t('mf.accrual.REDEMPTION') }), {
        size: 12,
        fill: C.ink2,
      });
      f.rect(X0, 394, W - X0 - 32, 46, { r: 14, fill: C.lilac });
      f.text(X0 + 16, 422, t('mf.legal').slice(0, 130), { size: 12, weight: 600 });
      f.text(X0, 470, t('mf.events'), { size: 16, weight: 800 });
      table(
        f,
        X0,
        486,
        W - X0 - 32,
        [
          { label: t('mf.col.event'), w: 220 },
          { label: t('mf.col.voucher'), w: 320 },
          { label: t('mf.col.amount'), w: 150 },
          { label: t('mf.col.fee'), w: 130 },
          { label: t('mf.col.when'), w: 200 },
        ],
        [
          [
            t('vpayable.ELIGIBLE'),
            TITLE(f) + ' · VC-K7QM9T',
            'SAR 72.00',
            'SAR 8.00',
            '8 Oct 2026, 18:20',
          ],
          [
            t('vpayable.ISSUED'),
            TITLE(f) + ' · VC-P3WX2A',
            'SAR 80.00',
            'SAR 0.00',
            '8 Oct 2026, 17:02',
          ],
          [
            t('vpayable.REFUNDED'),
            TITLE(f) + ' · VC-H9ZD4B',
            'SAR 80.00',
            'SAR 0.00',
            '7 Oct 2026, 11:40',
          ],
        ],
      );
    },
  }),
  meta({
    id: 'VM19',
    name: 'Live voucher: wording edits only (material fields locked)',
    rtl: false,
    figma: 'none',
    isNew: true,
    comps: ['Info alert', 'Disabled fields with lock note'],
    states: [
      'minor edit applied immediately; price / value / validity / branches / terms need a new voucher',
    ],
    route: '/vouchers/[id]/edit',
    priority: 'P2',
    shot: null,
    draw(f) {
      builderShell(f, 0, { status: 'DRAFT' }, (x, y) => {
        const t = f.t;
        f.rect(x, y - 18, 520, 56, { r: 12, fill: C.lilac });
        (t('mv.liveEditNote').match(/.{1,86}(\s|$)/g) ?? [])
          .slice(0, 2)
          .forEach((l, i) => f.text(x + 14, y + 4 + i * 18, l.trim(), { size: 11, weight: 600 }));
        shortField(f, x, y + 70, 250, t('mv.face') + ' *', '120', { ltr: true, disabled: true });
        shortField(f, x + 270, y + 70, 250, t('mv.price') + ' *', '90', {
          ltr: true,
          disabled: true,
        });
        f.text(x, y + 140, t('mv.lockedField'), { size: 11, fill: C.ink2 });
      });
    },
  }),
];
