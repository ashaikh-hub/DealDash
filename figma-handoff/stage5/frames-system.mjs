import { wrap, C, TONES, WALLET_TONE, REFUND_TONE, VOUCHER_TONE } from './lib.mjs';
import { customer } from './frames-customer.mjs';
import { staff } from './frames-staff.mjs';
import { merchant } from './frames-merchant.mjs';
import { admin } from './frames-admin.mjs';

const label = (f, x, y, s) => f.text(x, y, s, { size: 12, weight: 800, fill: C.ink2 });
const chips = (f, x, y, list, tones, o = {}) =>
  list.forEach((s, i) =>
    f.pill(x + (i % (o.per ?? 6)) * (o.gap ?? 190), y + Math.floor(i / (o.per ?? 6)) * 40, s, {
      ...TONES[tones[i]],
      size: 12,
    }),
  );
const T = (f) => f.t;

export const components = [
  {
    id: 'VK01',
    name: 'Customer voucher components',
    h: 1000,
    items: [
      'Voucher card (list)',
      'Voucher card (carousel)',
      'Price / value display',
      'Reported-savings label + note',
      'Validity + remaining chips',
      'Checkout summary',
      'Payment state (processing / pending / failed / success)',
      'QR / code card',
      'Voucher status chip (wallet)',
      'Refund status chip + box',
      'Wallet row',
      'Buy / Pay CTA bar',
    ],
    draw(f) {
      const t = T(f);
      f.text(24, 40, 'VK01 Customer voucher components (Stage 5)', { size: 22, weight: 800 });
      label(f, 24, 84, 'Price / value display + reported-savings label (never a guarantee)');
      f.rect(24, 96, 360, 96, { r: 16, fill: C.purple50, stroke: C.lilac });
      f.text(40, 120, t('vch.youPay'), { size: 11, fill: C.ink2 });
      f.text(40, 152, 'SAR 90.00', { size: 26, weight: 800, fill: C.purple, ltr: true });
      f.text(200, 120, t('vch.voucherValue'), { size: 11, fill: C.ink2 });
      f.text(200, 146, 'SAR 120.00', { size: 15, weight: 800, ltr: true });
      f.text(
        40,
        178,
        t('vch.reportedSavings') + ' ' + t('vch.savingsAmount', { amount: 'SAR 30.00', pct: 25 }),
        { size: 12, weight: 800, fill: C.green },
      );
      wrap(f, 400, 120, t('vch.savingsNote'), 86, { max: 4 });
      label(f, 24, 230, 'Validity / remaining chips');
      f.pill(24, 242, t('vch.validDays', { n: 30 }), { ...TONES.info, size: 12 });
      f.pill(330, 242, t('vch.onlyLeft', { n: 3 }), { ...TONES.warning, size: 12 });
      f.pill(470, 242, t('vch.perPerson', { n: 2 }), { ...TONES.neutral, size: 12 });
      f.pill(650, 242, t('vch.soldOut'), { ...TONES.warning, size: 12 });
      label(f, 24, 310, 'Wallet voucher status');
      chips(
        f,
        24,
        322,
        ['ACTIVE', 'USED', 'EXPIRED', 'REFUNDED', 'REFUND_PENDING', 'VOIDED'].map((s) =>
          t(`vwallet.${s}`),
        ),
        ['ACTIVE', 'USED', 'EXPIRED', 'REFUNDED', 'REFUND_PENDING', 'VOIDED'].map(
          (s) => WALLET_TONE[s],
        ),
      );
      label(f, 24, 410, 'Refund status (customer wording)');
      chips(
        f,
        24,
        422,
        [
          'REQUESTED',
          'UNDER_REVIEW',
          'APPROVED',
          'PROCESSING',
          'REFUNDED',
          'REJECTED',
          'FAILED',
        ].map((s) => t(`vrefund.${s}`)),
        [
          'REQUESTED',
          'UNDER_REVIEW',
          'APPROVED',
          'PROCESSING',
          'REFUNDED',
          'REJECTED',
          'FAILED',
        ].map((s) => REFUND_TONE[s]),
        { per: 4, gap: 200 },
      );
      label(f, 24, 520, 'Payment states (order status page)');
      [
        ['info', '⟳', t('ord.processing')],
        ['warning', '⌛', t('ord.awaiting')],
        ['danger', '!', t('ord.failed')],
        ['success', '✓', t('ord.success')],
      ].forEach(([tone, g, s], i) => {
        const x = 24 + i * 290;
        const col = {
          info: [C.lilac, C.purple],
          warning: [C.warnBg, C.warn],
          danger: [C.dangerBg, C.danger],
          success: [C.greenBg, C.green],
        }[tone];
        f.card(x, 534, 270, 130, { r: 20 });
        f.circle(x + 135, 574, 22, { fill: col[0] });
        f.text(x + 135, 582, g, {
          size: 22,
          weight: 800,
          fill: col[1],
          align: 'middle',
          ltr: true,
        });
        f.text(x + 135, 624, s, { size: 14, weight: 800, align: 'middle' });
      });
      label(f, 24, 700, 'Checkout summary rows');
      f.card(24, 712, 420, 190, { r: 20 });
      [
        [t('ck.faceValue'), 'SAR 120.00'],
        [t('ck.price'), 'SAR 90.00'],
        [t('ck.quantity'), '1'],
        [t('ck.savings'), 'SAR 30.00'],
        [t('ck.total'), 'SAR 90.00'],
      ].forEach(([k, v], i) => {
        f.text(44, 744 + i * 30, k, {
          size: 12,
          weight: i === 4 ? 800 : 500,
          fill: i === 4 ? C.navy : C.ink2,
        });
        f.text(424, 744 + i * 30, v, { size: 13, weight: 700, align: 'end', ltr: true });
      });
      label(f, 480, 700, 'QR / code card');
      f.rect(480, 712, 260, 200, { r: 20, stroke: '#B9A4FF', dash: true, fill: '#fff' });
      f.qr(520, 722, 180);
      f.text(610, 904, 'K7QM-9T2X', { size: 14, weight: 800, align: 'middle', ltr: true });
      label(f, 780, 700, 'Rules');
      [
        'QR and codes never mirror (LTR island). Western digits in Arabic.',
        'Wording: "Reported savings"; no guarantee claims.',
        'MVP does NOT show: gifting, promo codes, loyalty-point payment, partial redemption, saved cards, quantity stepper.',
        'Voucher is created only after a CONFIRMED payment.',
      ].forEach((s, i) => wrap(f, 780, 724 + i * 44, s, 62, { max: 2 }));
    },
  },
  {
    id: 'VK02',
    name: 'Merchant voucher components',
    h: 900,
    items: [
      'Voucher builder stepper (6 steps)',
      'Value / price fields (SAR, integer halalas)',
      'Reported-savings preview',
      'Validity selector (days / fixed date)',
      'Inventory / issuance controls',
      'Per-customer limit',
      'Customer preview panel (card / detail, EN / AR)',
      'Analytics KPI card',
      'Funnel + verified-money cards',
      'Voucher status chip (10 states)',
      'Sales table (first name only)',
      'Reason dialog',
    ],
    draw(f) {
      const t = T(f);
      f.text(24, 40, 'VK02 Merchant voucher components (Stage 5)', { size: 22, weight: 800 });
      label(f, 24, 80, 'Builder stepper');
      ['offer', 'content', 'validity', 'branches', 'rules', 'review'].forEach((n, i) => {
        const x = 24 + i * 190;
        f.circle(x + 14, 112, 13, {
          fill: i === 2 ? C.purple : i < 2 ? C.mint : '#fff',
          stroke: i > 2 ? C.line : undefined,
          sw: 2,
        });
        f.text(x + 14, 117, i < 2 ? '✓' : String(i + 1), {
          size: 12,
          weight: 800,
          fill: i <= 2 ? '#fff' : C.ink2,
          align: 'middle',
          ltr: true,
        });
        f.text(x + 36, 117, t(`mv.step.${n}`).slice(0, 18), {
          size: 13,
          weight: i === 2 ? 800 : 600,
        });
      });
      label(f, 24, 170, 'Value / price fields + reported savings');
      [
        [t('mv.face'), '120'],
        [t('mv.price'), '90'],
      ].forEach(([k, v], i) => {
        f.text(24 + i * 220, 200, k, { size: 12, weight: 700, fill: C.ink2 });
        f.rect(24 + i * 220, 208, 200, 40, { r: 12, fill: '#fff', stroke: C.line });
        f.text(40 + i * 220, 234, v, { size: 13, ltr: true });
      });
      f.rect(470, 200, 300, 48, { r: 12, fill: C.lilac });
      f.text(486, 230, 'SAR 30.00 (25%)', { size: 14, weight: 800, fill: C.green, ltr: true });
      label(f, 24, 290, 'Validity selector');
      [
        [true, t('validity.DAYS_FROM_PURCHASE')],
        [false, t('validity.FIXED_DATE')],
      ].forEach(([on, s], i) => {
        f.circle(34 + i * 260, 322, 9, {
          stroke: on ? C.purple : C.line,
          sw: 2,
          fill: on ? C.purple : 'none',
        });
        f.text(54 + i * 260, 327, s, { size: 13, weight: 600 });
      });
      label(f, 24, 370, 'Inventory / issuance controls');
      f.rect(24, 382, 520, 56, { r: 14, fill: '#fff', stroke: C.line });
      f.text(40, 416, t('mv.qty'), { size: 13, weight: 700 });
      f.rect(370, 392, 70, 36, { r: 10, fill: C.slate });
      f.text(405, 416, '50', { size: 14, weight: 800, align: 'middle', ltr: true });
      f.button(450, 392, 80, 36, '+ ' + t('mv.addCapacity').slice(0, 8), {
        fill: C.lilac,
        color: C.purple,
        size: 11,
      });
      label(f, 24, 480, 'KPI cards');
      [
        ['12', t('mv.kpi.sold')],
        ['5', t('mv.kpi.used')],
        ['42%', t('mv.kpi.rate')],
        ['37 / 50', t('mv.kpi.remaining')],
      ].forEach(([v, l], i) => {
        f.card(24 + i * 150, 492, 140, 78, { r: 16 });
        f.text(40 + i * 150, 532, v, { size: 22, weight: 800, ltr: true });
        f.text(40 + i * 150, 556, l.slice(0, 18), { size: 11, fill: C.ink2 });
      });
      label(f, 24, 610, 'Voucher status chips (merchant + admin)');
      chips(
        f,
        24,
        622,
        [
          'DRAFT',
          'PENDING_REVIEW',
          'NEEDS_CHANGES',
          'REJECTED',
          'SCHEDULED',
          'ON_SALE',
          'PAUSED',
          'SOLD_OUT',
          'ENDED',
          'SUSPENDED',
        ].map((s) => t(`vstatus.${s}`)),
        [
          'DRAFT',
          'PENDING_REVIEW',
          'NEEDS_CHANGES',
          'REJECTED',
          'SCHEDULED',
          'ON_SALE',
          'PAUSED',
          'SOLD_OUT',
          'ENDED',
          'SUSPENDED',
        ].map((s) => VOUCHER_TONE[s]),
      );
      label(f, 24, 730, 'Sales row (privacy)');
      f.card(24, 742, 900, 50, { r: 14 });
      f.text(40, 772, 'VC-K7QM9T   Layla   SAR 90.00', { size: 13, weight: 700, ltr: true });
      f.pill(520, 754, t('vinst.REDEEMED'), { ...TONES.info, size: 11 });
      f.pill(640, 754, t('mv.reverse'), { ...TONES.neutral, size: 11 });
      f.text(
        24,
        830,
        'Rule: merchants see first name + status only; never phone, e-mail or payment data. Money shown = verified payments and redemptions only.',
        { size: 12, fill: C.ink2 },
      );
    },
  },
  {
    id: 'VK03',
    name: 'Merchant Staff voucher components',
    h: 760,
    items: [
      'Voucher validation result card (ok / warn / stop)',
      'Voucher detail facts (value to honour)',
      'Redemption confirmation sheet (voucher)',
      'Scanner viewport (reused)',
      'Manual code field (reused)',
      'History row with kind',
    ],
    draw(f) {
      const t = T(f);
      f.text(24, 40, 'VK03 Merchant Staff voucher components (Stage 5)', { size: 22, weight: 800 });
      label(f, 24, 80, 'Validation results (Stage 4 colour model, voucher results added)');
      [
        ['green', C.greenBg, C.mint, ['st.valid', 'st.done']],
        [
          'amber',
          C.warnBg,
          C.amber,
          ['st.result.NOT_VALID_YET', 'st.result.EXPIRED', 'st.result.WRONG_BRANCH'],
        ],
        [
          'red',
          C.dangerBg,
          '#C9213D',
          [
            'st.result.INVALID_CODE',
            'st.result.ALREADY_REDEEMED',
            'st.result.VOUCHER_SUSPENDED',
            'st.result.REFUNDED',
            'st.result.CAMPAIGN_UNAVAILABLE',
          ],
        ],
      ].forEach(([n, bg, bd, keys], i) => {
        f.rect(24, 92 + i * 120, 560, 108, { r: 20, fill: bg, stroke: bd, sw: 2 });
        f.text(44, 120 + i * 120, n, { size: 14, weight: 800 });
        keys.forEach((k, j) =>
          f.pill(44 + (j % 3) * 176, 134 + Math.floor(j / 3) * 34 + i * 120, t(k).slice(0, 18), {
            fill: '#fff',
            color: C.navy,
            size: 11,
          }),
        );
      });
      label(f, 620, 80, 'Voucher detail facts');
      f.card(620, 92, 520, 230, { r: 20 });
      [
        [t('st.voucher'), 'SAR 120 dinner voucher'],
        [t('st.voucherValue'), 'SAR 120.00'],
        [t('st.customer'), 'Layla'],
        [t('st.branch'), 'Al Nakheel'],
        [t('res.reference'), 'VC-K7QM9T'],
      ].forEach(([k, v], i) => {
        f.text(640, 128 + i * 38, k, { size: 12, fill: C.ink2 });
        f.text(1120, 128 + i * 38, v, {
          size: 13,
          weight: 800,
          align: 'end',
          ltr: /^SAR|^VC/.test(v),
        });
      });
      label(f, 620, 350, 'Confirmation sheet warning');
      f.rect(620, 362, 520, 78, { r: 14, fill: C.warnBg });
      (t('st.confirmSheet.warnVoucher').match(/.{1,70}(\s|$)/g) ?? [])
        .slice(0, 3)
        .forEach((l, i) =>
          f.text(636, 388 + i * 18, l.trim(), { size: 12, weight: 700, fill: C.warn }),
        );
      label(f, 24, 470, 'Confirm button (locked after tap)');
      f.button(24, 482, 360, 56, t('st.confirm'), { fill: '#0E8F6A' });
      label(f, 24, 580, 'Rules');
      [
        'All tap targets >= 56 px. A result is never colour-only: glyph + title + next action.',
        'Idempotency-Key is created once per confirm and reused on retry; success is shown only after the server confirms.',
        'Staff see the value to honour and the customer first name; never a phone number.',
      ].forEach((s, i) => f.text(24, 606 + i * 24, s, { size: 12, fill: C.ink2 }));
    },
  },
  {
    id: 'VK04',
    name: 'Admin voucher and finance components',
    h: 900,
    items: [
      'Voucher review panel (merchant + commercial checks)',
      'Discount flag',
      'Placeholder rules card (refund / payable / expiry)',
      'Decision panel',
      'Payment status chip',
      'Refund workbench row + actions',
      'Maker-checker note',
      'Payable status table',
      'Financial event / audit row',
      'Ledger health chip',
      'Order facts card',
      'Redacted field',
    ],
    draw(f) {
      const t = T(f);
      f.text(24, 40, 'VK04 Admin voucher and finance components (Stage 5)', {
        size: 22,
        weight: 800,
      });
      label(f, 24, 80, 'Decision panel');
      f.card(24, 92, 320, 190, { r: 18 });
      f.text(44, 124, t('av.decision'), { size: 15, weight: 800 });
      f.button(44, 138, 280, 36, t('ah.approve'), { size: 13 });
      f.button(44, 182, 280, 36, t('ah.requestChanges'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
        size: 13,
      });
      f.button(44, 226, 280, 36, t('ah.reject'), { fill: C.red, size: 13 });
      label(f, 380, 80, 'Commercial checks + discount flag');
      f.card(380, 92, 460, 190, { r: 18 });
      f.text(400, 124, 'SAR 120.00 / SAR 90.00 · SAR 30.00 (25%)', {
        size: 13,
        weight: 700,
        ltr: true,
      });
      f.rect(400, 144, 420, 34, { r: 10, fill: C.warnBg });
      f.text(412, 166, t('av.discountFlag', { pct: 70 }).slice(0, 60), {
        size: 11,
        weight: 700,
        fill: C.warn,
      });
      f.rect(400, 188, 420, 34, { r: 10, fill: C.greenBg });
      f.text(412, 210, t('av.discountOk'), { size: 11, weight: 700, fill: C.green });
      label(f, 24, 320, 'Payment statuses');
      chips(
        f,
        24,
        332,
        [
          'CREATED',
          'PENDING',
          'SUCCEEDED',
          'FAILED',
          'CANCELLED',
          'REFUND_PENDING',
          'REFUNDED',
          'REVERSED',
        ].map((s) => t(`vpay.${s}`)),
        ['neutral', 'warning', 'success', 'danger', 'neutral', 'warning', 'info', 'neutral'],
        { per: 4, gap: 200 },
      );
      label(f, 24, 440, 'Refund workbench row');
      f.card(24, 452, 800, 70, { r: 14 });
      f.text(40, 482, 'RF-5T69DR', { size: 13, weight: 700, ltr: true });
      f.pill(190, 466, t('vrefund.UNDER_REVIEW'), { ...TONES.warning, size: 11 });
      f.button(560, 468, 100, 36, t('fin.refund.approve'), { size: 12 });
      f.button(670, 468, 100, 36, t('fin.refund.reject'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
        size: 12,
      });
      f.text(40, 508, t('fin.refund.checker'), { size: 11, fill: C.warn, weight: 700 });
      label(f, 24, 560, 'Ledger health + payable status');
      f.pill(24, 572, t('fin.ledger.balanced'), { ...TONES.success, size: 12 });
      f.pill(300, 572, t('fin.ledger.unbalanced'), { ...TONES.danger, size: 12 });
      f.card(24, 616, 800, 100, { r: 14 });
      [
        [t('fin.col.held'), 'SAR 400.00'],
        [t('fin.col.eligible'), 'SAR 72.00'],
        [t('fin.col.fee'), 'SAR 8.00'],
        [t('fin.col.refunded'), 'SAR 0.00'],
      ].forEach(([k, v], i) => {
        f.text(44 + i * 190, 652, k, { size: 11, fill: C.ink2 });
        f.text(44 + i * 190, 682, v, { size: 16, weight: 800, ltr: true });
      });
      label(f, 24, 750, 'Financial event / audit row + redacted field');
      f.card(24, 762, 800, 50, { r: 12 });
      f.text(
        40,
        792,
        '18:20  ' +
          t('vjournal.REDEMPTION') +
          '  ' +
          t('vledger.MERCHANT_SETTLEMENT_ELIGIBLE') +
          '  +SAR 81.00',
        { size: 12, weight: 600, ltr: false },
      );
      f.text(40, 840, t('fin.providerRef') + ': ' + t('fin.hidden'), { size: 12, fill: C.ink2 });
    },
  },
  {
    id: 'VK05',
    name: 'Shared status and state patterns (Stage 5)',
    h: 800,
    items: [
      'Order statuses (5)',
      'Payment statuses (9)',
      'Voucher instance statuses (5)',
      'Refund statuses (7)',
      'Payable event types (8)',
      'Ledger journal types (6)',
      'Support case statuses',
      'Alerts: info / success / warning / danger',
      'Provider callback outcomes (5)',
    ],
    draw(f) {
      const t = T(f);
      f.text(24, 40, 'VK05 Shared status and state patterns (Stage 5)', { size: 22, weight: 800 });
      label(f, 24, 80, 'Order');
      chips(
        f,
        24,
        92,
        ['PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED'].map((s) => t(`vorder.${s}`)),
        ['warning', 'success', 'danger', 'neutral', 'neutral'],
      );
      label(f, 24, 150, 'Voucher instance');
      chips(
        f,
        24,
        162,
        ['ACTIVE', 'REDEEMED', 'EXPIRED', 'REFUNDED', 'VOIDED'].map((s) => t(`vinst.${s}`)),
        ['success', 'info', 'neutral', 'neutral', 'warning'],
      );
      label(f, 24, 220, 'Payable event');
      chips(
        f,
        24,
        232,
        [
          'SOLD',
          'ISSUED',
          'REDEEMED',
          'ELIGIBLE',
          'REFUNDED',
          'REDEMPTION_REVERSED',
          'EXPIRED',
          'ADJUSTMENT',
        ].map((s) => t(`vpayable.${s}`)),
        ['neutral', 'info', 'info', 'success', 'neutral', 'warning', 'neutral', 'neutral'],
        { per: 4, gap: 260 },
      );
      label(f, 24, 330, 'Ledger journals');
      chips(
        f,
        24,
        342,
        ['SALE', 'REDEMPTION', 'REFUND', 'REVERSAL', 'EXPIRY', 'ADJUSTMENT'].map((s) =>
          t(`vjournal.${s}`),
        ),
        ['info', 'success', 'neutral', 'warning', 'neutral', 'neutral'],
      );
      label(f, 24, 400, 'Provider callbacks');
      chips(
        f,
        24,
        412,
        ['APPLIED', 'DUPLICATE', 'IGNORED', 'REJECTED', 'LATE_SUCCESS'].map((s) =>
          t(`vevent.${s}`),
        ),
        ['success', 'neutral', 'neutral', 'danger', 'warning'],
      );
      label(f, 24, 470, 'Support cases');
      chips(
        f,
        24,
        482,
        ['OPEN', 'IN_PROGRESS', 'RESOLVED'].map((s) => t(`vcase.status.${s}`)),
        ['warning', 'info', 'success'],
      );
      label(f, 24, 550, 'Alerts');
      [
        ['info', t('mv.note').slice(0, 70)],
        ['success', t('ord.success')],
        ['warning', t('ord.pendingSlow').slice(0, 70)],
        ['danger', t('error.ORDER_NOT_PAYABLE').slice(0, 70)],
      ].forEach(([k, s], i) => {
        const col = { info: C.lilac, success: C.greenBg, warning: C.warnBg, danger: C.dangerBg }[k];
        f.rect(24, 562 + i * 52, 700, 42, { r: 14, fill: col });
        f.text(40, 589 + i * 52, s, { size: 13, weight: 600 });
      });
      f.text(
        760,
        590,
        'Order status is what the customer is charged for; the voucher exists only after the payment is SUCCEEDED.',
        { size: 12, fill: C.ink2 },
      );
    },
  },
];

/* ---------------------------------------------------------------- flows */
export const flows = [
  {
    id: 'VF01',
    name: 'Merchant creates Voucher → submits → Admin approves',
    h: 660,
    steps: [
      {
        surface: 'Merchant',
        title: 'Campaigns → Vouchers',
        lines: ['Third tab, payable note,', 'Create voucher'],
        ref: 'VM01',
      },
      {
        surface: 'Merchant',
        title: 'Offer',
        lines: ['Value, price, reported', 'savings, quantity, limit'],
        ref: 'VM03 VM04',
      },
      {
        surface: 'Merchant',
        title: 'Content + validity',
        lines: ['EN + AR, photos,', 'validity, sale window'],
        ref: 'VM05 VM06',
      },
      {
        surface: 'Merchant',
        title: 'Branches + terms',
        lines: ['Participating branches,', 'eligibility, terms'],
        ref: 'VM07 VM08',
      },
      {
        surface: 'Merchant',
        title: 'Review and submit',
        lines: ['Customer preview,', 'refund / payable notes'],
        ref: 'VM09 VM10 VM11',
        tone: 'success',
      },
      {
        surface: 'Admin',
        title: 'Review queue',
        lines: ['Pending review row'],
        ref: 'VA01',
        tone: 'warning',
      },
      {
        surface: 'Admin',
        title: 'Workbench',
        lines: ['Commercial checks, rules,', 'EN / AR, preview'],
        ref: 'VA03 VA04 VA19',
        tone: 'warning',
      },
      {
        surface: 'Admin',
        title: 'Decision',
        lines: ['Approve → On sale', 'or Request changes / Reject'],
        ref: 'VA05 VM12',
        tone: 'success',
      },
    ],
    note: 'Changes requested returns the voucher to the builder with the reviewer reason (VM12). Pilot: every voucher is manually reviewed.',
  },
  {
    id: 'VF02',
    name: 'Customer discovers → buys → checkout → payment success → My Vouchers',
    h: 660,
    steps: [
      {
        surface: 'Customer',
        title: 'Discover',
        lines: ['Home rail or /vouchers,', 'search and sort'],
        ref: 'VC01 VC02',
      },
      {
        surface: 'Customer',
        title: 'Voucher detail',
        lines: ['Price, value, Reported', 'savings, how it works'],
        ref: 'VC04',
      },
      {
        surface: 'Customer',
        title: 'Checkout',
        lines: ['Summary, hold timer,', 'terms, Pay'],
        ref: 'VC09',
      },
      {
        surface: 'Customer',
        title: 'Payment page',
        lines: ['Provider page', '(test page in development)'],
        ref: 'VC13',
      },
      {
        surface: 'Customer',
        title: 'Processing',
        lines: ['Polls until the payment', 'is confirmed'],
        ref: 'VC14',
        tone: 'warning',
      },
      {
        surface: 'Customer',
        title: 'Success',
        lines: ['Payment received,', 'View my voucher'],
        ref: 'VC18',
        tone: 'success',
      },
      {
        surface: 'Customer',
        title: 'Ticket just issued',
        lines: ['QR + manual code,', 'confirmation banner'],
        ref: 'VC23',
        tone: 'success',
      },
      {
        surface: 'Customer',
        title: 'My Vouchers → Active',
        lines: ['Wallet list with', 'state chips'],
        ref: 'VC19',
        tone: 'success',
      },
    ],
    note: 'The voucher is created only after a confirmed payment. No gifting, promo code, loyalty-point payment or saved-card selection exists in the MVP.',
  },
  {
    id: 'VF03',
    name: 'Customer voucher QR → Staff scan → validate → redeem',
    h: 660,
    steps: [
      {
        surface: 'Customer',
        title: 'Voucher QR',
        lines: ['Active ticket,', 'brightness and code'],
        ref: 'VC23',
      },
      { surface: 'Staff', title: 'Scan', lines: ['Camera or', 'manual code'], ref: 'VS01 VS02' },
      {
        surface: 'Staff',
        title: 'Validate',
        lines: ['Server checks owner, branch,', 'validity, status'],
        ref: 'VS03',
        tone: 'warning',
      },
      {
        surface: 'Staff',
        title: 'Valid + value',
        lines: ['Voucher value to honour,', 'customer first name'],
        ref: 'VS03',
        tone: 'success',
      },
      {
        surface: 'Staff',
        title: 'Confirm sheet',
        lines: ['Irreversible warning,', 'Confirm (locked after tap)'],
        ref: 'VS04',
        tone: 'success',
      },
      {
        surface: 'Staff',
        title: 'Redeemed',
        lines: ['Reference RD-…,', 'Scan next'],
        ref: 'VS06',
        tone: 'success',
      },
      {
        surface: 'Staff',
        title: 'Not accepted',
        lines: [
          'Amber: not yet valid, expired,',
          'wrong branch. Red: invalid,',
          'used, suspended, refunded',
        ],
        ref: 'VS07-VS14',
        tone: 'danger',
      },
      {
        surface: 'Customer',
        title: 'Voucher now Used',
        lines: ['No QR, no refund button,', 'in-app update'],
        ref: 'VC24',
        tone: 'neutral',
      },
    ],
    note: 'Redemption uses the Stage 4 staff framework. The merchant amount becomes settlement-eligible only after redemption (net of the platform fee).',
  },
  {
    id: 'VF04',
    name: 'Customer refund request → Admin review → refund complete',
    h: 660,
    steps: [
      {
        surface: 'Customer',
        title: 'Active voucher',
        lines: ['Request a refund', '(before use)'],
        ref: 'VC23',
      },
      {
        surface: 'Customer',
        title: 'Refund sheet',
        lines: ['Reason + note,', 'inside window: automatic'],
        ref: 'VC28',
      },
      {
        surface: 'Customer',
        title: 'Outside window',
        lines: ['Review note: voucher', 'stays usable until a decision'],
        ref: 'VC29',
        tone: 'warning',
      },
      {
        surface: 'Admin',
        title: 'Refund queue',
        lines: ['Under review row,', 'Approve / Reject'],
        ref: 'VA13',
        tone: 'warning',
      },
      {
        surface: 'Admin',
        title: 'Reason dialog',
        lines: ['Reason recorded;', 'reject reason shown to customer'],
        ref: 'VA14',
        tone: 'warning',
      },
      {
        surface: 'Admin',
        title: 'Order and ledger',
        lines: ['Refund + REFUND journal,', 'redeemed needs reversal first'],
        ref: 'VA10 VA11 VA15 VA17',
        tone: 'info',
      },
      {
        surface: 'Customer',
        title: 'Refund status',
        lines: ['Plain-language status,', 'Refunded tab'],
        ref: 'VC27 VC30',
        tone: 'success',
      },
      {
        surface: 'Staff',
        title: 'Scan after refund',
        lines: ['REFUNDED (red),', 'cannot redeem'],
        ref: 'VS13',
        tone: 'danger',
      },
    ],
    note: 'Admin-initiated refunds need a different administrator to approve (maker-checker). Refund rights and the window are placeholders (VALIDATE-KSA).',
  },
  {
    id: 'VF05',
    name: 'Payment failure / pending / retry',
    h: 660,
    steps: [
      {
        surface: 'Customer',
        title: 'Pay',
        lines: ['Terms accepted,', 'attempt 1 starts'],
        ref: 'VC09',
      },
      {
        surface: 'Customer',
        title: 'Declined',
        lines: ['Failure reason,', 'no voucher created'],
        ref: 'VC16',
        tone: 'danger',
      },
      {
        surface: 'Customer',
        title: 'Retry',
        lines: ['Checkout shows the note,', 'attempts left'],
        ref: 'VC11',
        tone: 'warning',
      },
      {
        surface: 'Customer',
        title: 'Pending / slow',
        lines: ['Still waiting for', 'confirmation (30 s+)'],
        ref: 'VC15',
        tone: 'warning',
      },
      {
        surface: 'Customer',
        title: 'Success on retry',
        lines: ['Voucher issued once,', 'duplicate callbacks ignored'],
        ref: 'VC18',
        tone: 'success',
      },
      {
        surface: 'Customer',
        title: 'No retries left',
        lines: ['Attempt limit reached,', 'start again'],
        ref: 'VC17',
        tone: 'danger',
      },
      {
        surface: 'Customer',
        title: 'Hold expired',
        lines: ['Nothing charged,', 'unit released'],
        ref: 'VC12',
        tone: 'warning',
      },
      {
        surface: 'Admin',
        title: 'Lookup',
        lines: ['Attempts, callbacks,', 'late success auto-refund'],
        ref: 'VA09 VA10',
        tone: 'info',
      },
    ],
    note: 'Late success after cancel or expiry posts the sale and an automatic system refund; no voucher is issued. Provider references are hidden from Support.',
  },
];

export const ALL = { customer, merchant, staff, admin };
