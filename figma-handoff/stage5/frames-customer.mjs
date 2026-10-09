import {
  C,
  TONES,
  L,
  W,
  MERCHANT,
  TITLE,
  sar,
  customerChrome,
  detailBase,
  buyBar,
  sheetShell,
  topBar,
  orderSummary,
  statusBox,
  walletRow,
  walletTabs,
  walletTicket,
  voucherListCard,
  voucherCarousel,
  voucherBadge,
  priceBox,
} from './lib.mjs';

const OLD = (n, why) => `${n} (${why})`;

function searchRow(f, y) {
  f.rect(16, y, W - 32, 44, { r: 22, fill: '#fff', stroke: C.line });
  f.text(52, y + 27, f.t('vch.searchPlaceholder'), { size: 13, fill: C.ink2 });
}
function sortRow(f, y, active = 0) {
  let x = 16;
  ['newest', 'price_low', 'price_high', 'savings', 'nearest'].slice(0, 4).forEach((k, i) => {
    x +=
      f.pill(x, y, f.t(`vch.sort.${k}`), {
        fill: i === active ? C.purple : '#fff',
        color: i === active ? '#fff' : C.navy,
        size: 11,
      }) + 6;
  });
}

function ckBase(f, o = {}) {
  const t = f.t;
  topBar(f, t('ck.title'));
  orderSummary(f, 66);
  f.text(32, 330, t('ck.holdNote') + ' 09:42', { size: 12, fill: C.ink2, ltr: false });
  f.card(16, 344, W - 32, 136, { r: 20 });
  f.text(32, 372, t('ck.method'), { size: 13, weight: 800 });
  f.circle(40, 400, 9, { fill: C.purple });
  f.text(58, 405, t('ck.methodTest'), { size: 13, weight: 700 });
  f.text(32, 432, t('ck.methodNote').slice(0, 52), { size: 11, fill: C.ink2 });
  f.text(32, 450, t('ck.methodNote').slice(52, 110), { size: 11, fill: C.ink2 });
  const on = !!o.accepted;
  f.rect(20, 500, 22, 22, {
    r: 6,
    fill: on ? C.purple : '#fff',
    stroke: on ? C.purple : o.termsError ? C.danger : C.line,
    sw: 1.5,
  });
  if (on) f.text(31, 517, '✓', { size: 14, weight: 800, fill: '#fff', align: 'middle', ltr: true });
  f.text(52, 517, t('ck.terms'), { size: 12, weight: 700 });
  f.text(52, 538, t('vch.termsTitle'), { size: 12, weight: 700, fill: C.purple });
  if (o.termsError) f.text(52, 558, t('ck.termsRequired'), { size: 11, fill: C.danger });
  if (o.note) {
    f.rect(16, 574, W - 32, 52, { r: 14, fill: C.warnBg });
    f.text(30, 596, o.note.slice(0, 46), { size: 12, weight: 700, fill: C.warn });
    f.text(30, 614, o.note.slice(46, 96), { size: 12, weight: 700, fill: C.warn });
  }
  f.button(16, 700, W - 32, 52, o.cta ?? t('ck.pay', { amount: sar(f, 9000) }), {
    fill: o.disabledCta ? C.line : C.purple,
    color: o.disabledCta ? C.ink2 : '#fff',
  });
  f.text(W / 2, 786, t('ck.cancel'), { size: 13, weight: 700, fill: C.ink2, align: 'middle' });
}

const refundSheetBody = (f, h, reviewNote) => {
  const t = f.t;
  sheetShell(f, h, t('wal.refund.title'));
  const body = t('wal.refund.body');
  (body.match(/.{1,50}(\s|$)/g) ?? [])
    .slice(0, 4)
    .forEach((l, i) => f.text(20, 844 - h + 72 + i * 18, l.trim(), { size: 12, fill: C.ink2 }));
  let y = 844 - h + 154;
  if (reviewNote) {
    f.rect(20, y, W - 40, 56, { r: 14, fill: C.lilac });
    (t('wal.refund.review').match(/.{1,46}(\s|$)/g) ?? [])
      .slice(0, 2)
      .forEach((l, i) => f.text(32, y + 24 + i * 16, l.trim(), { size: 11, weight: 600 }));
    y += 68;
  }
  f.text(20, y + 14, t('wal.refund.reason'), { size: 12, weight: 700, fill: C.ink2 });
  f.rect(20, y + 22, W - 40, 44, { r: 12, fill: '#fff', stroke: C.line });
  f.text(34, y + 50, t('vreason.CHANGED_MIND'), { size: 13 });
  f.text(20, y + 90, t('wal.refund.note'), { size: 12, weight: 700, fill: C.ink2 });
  f.rect(20, y + 98, W - 40, 56, { r: 12, fill: '#fff', stroke: C.line });
  f.button(20, 844 - 100, W - 40, 48, t('wal.refund.submit'));
};

export const customer = [
  {
    id: 'VC36',
    name: 'Voucher ticket: Active, refund under review (QR still works)',
    journey: 'Own → Refund',
    device: 'mobile',
    rtl: true,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['QR card', 'Refund status box (under review)', 'No refund button'],
    sheets: [],
    states: ['UNDER_REVIEW outside the usual period: voucher stays usable until a decision'],
    route: '/my-vouchers/[id]',
    priority: 'P1',
    shot: null,
    draw(f) {
      walletTicket(f, 'ACTIVE', { refundBox: ['warning', f.t('wal.refund.UNDER_REVIEW')] });
    },
  },
  {
    id: 'VC01',
    name: 'Home: Vouchers rail',
    journey: 'Discover',
    device: 'mobile',
    rtl: true,
    figma: '02 Home - Food and Drink (rail pattern)',
    svg: true,
    isNew: true,
    comps: [
      'Voucher card (carousel)',
      'Price / value display',
      'Reported-savings chip',
      'Header with My Deals + My Vouchers icons',
      'Tab bar (3 tabs)',
    ],
    sheets: [],
    states: ['rail hidden when nothing is on sale', 'loading skeleton'],
    route: '/ (VoucherRail in customer/features/vouchers.tsx)',
    priority: 'P1',
    shot: 'customer-01-home-voucher-rail-en',
    draw(f) {
      customerChrome(f);
      f.text(16, 90, f.t('cust.tagline'), { size: 13, fill: C.ink2 });
      searchRow(f, 104);
      f.text(16, 182, '▭ ' + f.t('vch.rail'), { size: 18, weight: 800 });
      f.text(16, 202, f.t('vch.railSub'), { size: 12, fill: C.ink2 });
      f.text(W - 16, 182, f.t('cust.seeAll'), {
        size: 12,
        weight: 700,
        fill: C.purple,
        align: 'end',
      });
      voucherCarousel(f, 16, 218);
      voucherCarousel(f, 252, 218, {
        title: L(f, 'قسيمة سبا بقيمة 200 ريال', 'SAR 200 spa voucher'),
        face: 20000,
        price: 15000,
        colors: ['#E8B7C8', '#6E2862'],
        merchant: L(f, 'استوديو بلوم', 'Bloom Beauty Studio'),
      });
      f.text(16, 490, f.t('cust.liveOffers'), { size: 18, weight: 800 });
    },
  },
  {
    id: 'VC02',
    name: 'Vouchers discovery (list, search, sort)',
    journey: 'Discover',
    device: 'mobile',
    rtl: true,
    figma: '09 Explore - Vouchers',
    svg: true,
    isNew: false,
    comps: [
      'Voucher card (list)',
      'Search field',
      'Sort chips',
      'Eligibility filter chip',
      'Reported-savings chip',
    ],
    sheets: [],
    states: ['sold-out card', 'locked card', 'no match', 'loading', 'empty', 'error'],
    route: '/vouchers',
    priority: 'P1',
    shot: 'customer-02-vouchers-list-en',
    draw(f) {
      customerChrome(f);
      f.text(16, 84, f.t('vch.title'), { size: 28, weight: 800 });
      f.text(16, 104, f.t('vch.sub').slice(0, 56), { size: 12, fill: C.ink2 });
      searchRow(f, 116);
      sortRow(f, 170);
      voucherListCard(f, 212, { left: 3 });
      voucherListCard(f, 356, {
        title: L(f, 'قسيمة لياقة بقيمة 150 ريال', 'SAR 150 fitness voucher'),
        merchant: L(f, 'بالس فيتنس', 'Pulse Fitness'),
        face: 15000,
        price: 12000,
        pct: 20,
        colors: ['#9ED8FF', '#1E1B4B'],
        locked: true,
      });
      voucherListCard(f, 500, {
        sold: true,
        title: L(f, 'قسيمة كتب بقيمة 100 ريال', 'SAR 100 books voucher'),
        merchant: L(f, 'مكتبة بيج آند كو', 'Page & Co Books'),
        face: 10000,
        price: 8000,
        pct: 20,
        colors: ['#E8B7C8', '#6E2862'],
      });
    },
  },
  {
    id: 'VC03',
    name: 'Voucher card states (board)',
    journey: 'Discover',
    device: 'mobile',
    rtl: false,
    figma: '09 Explore - Vouchers (card)',
    svg: true,
    isNew: true,
    comps: ['Voucher card (list)', 'Voucher card (carousel)', 'Sold-out overlay', 'Lock chip'],
    sheets: [],
    states: ['available', 'low stock (<=10)', 'locked (eligibility)', 'sold out'],
    route: 'packages/app-shell/src/vouchers/voucher-views.tsx (VoucherCardView)',
    priority: 'P2',
    shot: null,
    draw(f) {
      f.text(16, 40, 'Voucher card states', { size: 20, weight: 800 });
      voucherListCard(f, 64, { left: 12, label: 'available' });
      voucherListCard(f, 208, { left: 3 });
      voucherListCard(f, 352, { locked: true, colors: ['#9ED8FF', '#1E1B4B'] });
      voucherListCard(f, 496, { sold: true, colors: ['#E8B7C8', '#6E2862'] });
      ['available', 'low stock', 'locked', 'sold out'].forEach((s, i) =>
        f.text(W - 24, 60 + i * 144 + 8, s, { size: 10, fill: C.ink2, align: 'end' }),
      );
      f.text(16, 660, f.t('vch.noMatch'), { size: 14, weight: 800 });
      f.text(16, 680, f.t('vch.emptyBody'), { size: 12, fill: C.ink2 });
      voucherCarousel(f, 16, 700);
    },
  },
  {
    id: 'VC04',
    name: 'Voucher detail (available, guest or signed in)',
    journey: 'Discover → Buy',
    device: 'mobile',
    rtl: true,
    figma: '22 Deal - Voucher (OUTDATED: gift, reviews, video points, "one or more visits")',
    svg: true,
    isNew: false,
    comps: [
      'Hero gallery',
      'Price / value box',
      'Reported-savings label + note',
      'Validity + remaining chips',
      'How it works',
      'Branch card',
      'Sticky Buy bar',
    ],
    sheets: ['VC09 Checkout'],
    states: [
      'available',
      'low stock',
      'sold out',
      'ended',
      'not on sale',
      'limit reached',
      'locked',
      'guest (Sign in to buy)',
    ],
    route: '/vouchers/[id]',
    priority: 'P1',
    shot: 'customer-03-voucher-detail-en',
    draw(f) {
      detailBase(f);
      buyBar(f, f.t('vch.buy'));
    },
  },
  {
    id: 'VC05',
    name: 'Voucher detail: locked (eligibility)',
    journey: 'Discover',
    device: 'mobile',
    rtl: false,
    figma: '24 Deal - Employer offer; 23 Deal - Bank card offer',
    svg: true,
    isNew: true,
    comps: ['Locked panel', 'Lock chip', 'Disabled Buy bar'],
    sheets: [],
    states: ['LOCKED_UNLOCKABLE', 'no card or employer data shown'],
    route: '/vouchers/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      detailBase(f, { state: 'locked', sheetH: 470 });
      f.rect(36, 528, W - 72, 70, { r: 14, fill: C.lilac });
      f.icon(46, 546, 'lock', { size: 22 });
      f.text(78, 560, L(f, 'للموظفين المعتمدين فقط', 'For verified employees only'), {
        size: 13,
        weight: 800,
      });
      f.text(78, 580, f.t('elig.noCardData').slice(0, 48), { size: 11, fill: C.ink2 });
      buyBar(f, f.t('vch.locked'), { disabled: true });
    },
  },
  {
    id: 'VC06',
    name: 'Voucher detail: sold out',
    journey: 'Discover',
    device: 'mobile',
    rtl: true,
    figma: '22 Deal - Voucher',
    svg: true,
    isNew: true,
    comps: ['Warning alert', 'Disabled Buy bar'],
    sheets: [],
    states: ['SOLD_OUT (units can return from expiry)'],
    route: '/vouchers/[id]',
    priority: 'P1',
    shot: null,
    draw(f) {
      detailBase(f, { state: 'sold' });
      f.rect(36, 640, W - 72, 52, { r: 14, fill: C.warnBg });
      (f.t('vch.soldOutBody').match(/.{1,46}(\s|$)/g) ?? [])
        .slice(0, 2)
        .forEach((l, i) =>
          f.text(50, 662 + i * 16, l.trim(), { size: 11, weight: 700, fill: C.warn }),
        );
      buyBar(f, f.t('vch.soldOut'), { disabled: true });
    },
  },
  {
    id: 'VC07',
    name: 'Voucher detail: sale ended / limit reached / not on sale',
    journey: 'Discover',
    device: 'mobile',
    rtl: false,
    figma: '22 Deal - Voucher',
    svg: true,
    isNew: true,
    comps: ['Disabled Buy bar variants'],
    sheets: [],
    states: ['ENDED', 'LIMIT_REACHED', 'NOT_ON_SALE'],
    route: '/vouchers/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      f.text(16, 40, 'Buy bar variants on the detail page', { size: 18, weight: 800 });
      [
        [f.t('vch.ended'), 'sale ended'],
        [f.t('vch.limitReached'), 'limit reached'],
        [f.t('vch.notOnSale'), 'not on sale'],
        [f.t('vch.locked'), 'locked'],
        [f.t('vch.signInToBuy'), 'guest'],
        [f.t('vch.buy'), 'available'],
      ].forEach(([label, note], i) => {
        const y = 70 + i * 120;
        f.rect(0, y, W, 100, { fill: '#fff', stroke: C.line });
        f.text(20, y + 36, sar(f, 9000), { size: 18, weight: 800, ltr: true });
        f.text(20, y + 56, note, { size: 11, fill: C.ink2 });
        f.button(W - 20 - 190, y + 24, 190, 52, label, {
          fill: i === 5 || i === 4 ? C.purple : C.line,
          color: i >= 4 ? '#fff' : C.ink2,
        });
      });
    },
  },
  {
    id: 'VC08',
    name: 'Voucher unavailable (not found / not offered)',
    journey: 'Discover',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Empty state', 'Back link'],
    sheets: [],
    states: ['404', 'not visible to this account'],
    route: '/vouchers/[id]',
    priority: 'P3',
    shot: null,
    draw(f) {
      customerChrome(f);
      f.circle(W / 2, 300, 40, { fill: C.lilac });
      f.text(W / 2, 372, f.t('vch.unavailable'), { size: 20, weight: 800, align: 'middle' });
      f.text(W / 2, 400, f.t('vch.unavailableBody').slice(0, 46), {
        size: 13,
        fill: C.ink2,
        align: 'middle',
      });
      f.text(W / 2, 440, f.t('vch.seeAll'), {
        size: 14,
        weight: 800,
        fill: C.purple,
        align: 'middle',
      });
    },
  },
  {
    id: 'VC09',
    name: 'Checkout',
    journey: 'Buy',
    device: 'mobile',
    rtl: true,
    figma: OLD(
      '28 Checkout - voucher',
      'OUTDATED: gift, promo code, loyalty points, saved cards, quantity stepper, "VAT included"',
    ),
    svg: true,
    isNew: false,
    comps: [
      'Checkout summary',
      'Price / value display',
      'Hold countdown',
      'Payment method card (test)',
      'Terms checkbox',
      'Pay CTA',
    ],
    sheets: [],
    states: ['terms not accepted', 'hold expired', 'previous attempt failed', 'no retries left'],
    route: '/checkout/[orderId]',
    priority: 'P1',
    shot: 'customer-04-checkout-en',
    draw(f) {
      ckBase(f, { accepted: true });
    },
  },
  {
    id: 'VC10',
    name: 'Checkout: terms not accepted',
    journey: 'Buy',
    device: 'mobile',
    rtl: false,
    figma: '28 Checkout - voucher',
    svg: true,
    isNew: true,
    comps: ['Terms checkbox (error)', 'Inline error'],
    sheets: [],
    states: ['terms required before Pay'],
    route: '/checkout/[orderId]',
    priority: 'P2',
    shot: null,
    draw(f) {
      ckBase(f, { termsError: true });
    },
  },
  {
    id: 'VC11',
    name: 'Checkout: previous attempt failed (retry)',
    journey: 'Buy → Retry',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Warning note', 'Pay CTA'],
    sheets: [],
    states: ['FAILED payment, attempts left'],
    route: '/checkout/[orderId]',
    priority: 'P1',
    shot: null,
    draw(f) {
      ckBase(f, { accepted: true, note: f.t('ord.failed') + ' ' + f.t('ord.failedBody') });
    },
  },
  {
    id: 'VC12',
    name: 'Checkout: hold expired',
    journey: 'Buy',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Status box (warning)', 'Back to the voucher'],
    sheets: [],
    states: ['hold ended: nothing charged, unit released'],
    route: '/checkout/[orderId]',
    priority: 'P1',
    shot: null,
    draw(f) {
      topBar(f, f.t('ck.title'));
      const y = statusBox(f, 90, 'warning', '◔', f.t('ck.expired'), f.t('ck.expiredBody'), {
        h: 260,
      });
      f.button(40, y - 70, W - 80, 48, f.t('ck.again'));
    },
  },
  {
    id: 'VC13',
    name: 'Payment page (provider hand-off; test page in dev)',
    journey: 'Buy → Pay',
    device: 'mobile',
    rtl: true,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Info alert', 'Order summary', 'Approve / Decline (test only)'],
    sheets: [],
    states: ['test provider page: nothing is charged', 'real provider page replaces this frame'],
    route: '/pay/[orderId]?mock_payment=…',
    priority: 'P2',
    shot: 'customer-05-test-payment-en',
    draw(f) {
      f.rect(16, 24, W - 32, 74, { r: 14, fill: C.lilac });
      f.text(30, 50, f.t('pay.mock.title'), { size: 13, weight: 800 });
      (f.t('pay.mock.body').match(/.{1,48}(\s|$)/g) ?? [])
        .slice(0, 2)
        .forEach((l, i) => f.text(30, 70 + i * 16, l.trim(), { size: 11, fill: C.ink2 }));
      orderSummary(f, 114);
      f.button(16, 372, W - 32, 52, f.t('pay.mock.approve'));
      f.button(16, 436, W - 32, 52, f.t('pay.mock.decline'), { fill: C.red });
      f.text(W / 2, 520, f.t('pay.mock.back'), {
        size: 13,
        weight: 700,
        fill: C.ink2,
        align: 'middle',
      });
    },
  },
  {
    id: 'VC14',
    name: 'Payment processing',
    journey: 'Buy → Pay',
    device: 'mobile',
    rtl: true,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Status box (spinner)', 'Order summary', 'Reference'],
    sheets: [],
    states: ['PENDING: polls every 2 s', 'aria-busy'],
    route: '/orders/[id]',
    priority: 'P1',
    shot: null,
    draw(f) {
      statusBox(f, 24, 'info', '⟳', f.t('ord.processing'), f.t('ord.processingBody'), { h: 200 });
      orderSummary(f, 244);
      f.text(16, 506, f.t('ord.reference') + ': ORD-DDZYFX', {
        size: 11,
        fill: C.ink2,
        ltr: false,
      });
    },
  },
  {
    id: 'VC15',
    name: 'Payment pending (slow confirmation)',
    journey: 'Buy → Pay',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Status box', 'Open payment page link'],
    sheets: [],
    states: [
      'PENDING after 30 s: still no voucher until confirmed',
      'closed the payment page: awaiting payment',
    ],
    route: '/orders/[id]',
    priority: 'P1',
    shot: null,
    draw(f) {
      const y = statusBox(f, 24, 'warning', '◔', f.t('ord.processing'), f.t('ord.pendingSlow'), {
        h: 240,
      });
      f.button(40, y - 66, W - 80, 44, f.t('ord.openPayment'), {
        fill: '#fff',
        color: C.navy,
        stroke: C.line,
        size: 13,
      });
      statusBox(f, y + 24, 'info', '⌛', f.t('ord.awaiting'), f.t('ord.awaitingBody'), { h: 240 });
    },
  },
  {
    id: 'VC16',
    name: 'Payment failed (retry available)',
    journey: 'Buy → Retry',
    device: 'mobile',
    rtl: true,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Status box (danger)', 'Failure reason', 'Retry CTA with attempts left'],
    sheets: [],
    states: ['CARD_DECLINED', 'CANCELLED', 'PROVIDER_ERROR', 'INITIATION_TIMEOUT'],
    route: '/orders/[id]',
    priority: 'P1',
    shot: 'customer-06-payment-failed-en',
    draw(f) {
      const y = statusBox(f, 24, 'danger', '!', f.t('ord.failed'), f.t('ord.failedBody'), {
        h: 300,
      });
      f.text(W / 2, 170 + 22, f.t('ord.failure.CARD_DECLINED'), {
        size: 12,
        fill: C.ink2,
        align: 'middle',
      });
      f.button(40, y - 100, W - 80, 48, f.t('ord.retry', { n: 2 }));
      f.text(W / 2, y - 28, f.t('ck.again'), {
        size: 13,
        weight: 700,
        fill: C.purple,
        align: 'middle',
      });
      orderSummary(f, y + 20);
    },
  },
  {
    id: 'VC17',
    name: 'Payment failed: no retries left / order closed',
    journey: 'Buy → Retry',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Status box', 'Back to the voucher'],
    sheets: [],
    states: ['retry limit reached', 'CANCELLED', 'EXPIRED'],
    route: '/orders/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      const y = statusBox(f, 24, 'danger', '!', f.t('ord.failed'), f.t('ord.noRetries'), {
        h: 230,
      });
      f.text(W / 2, y - 24, f.t('ck.again'), {
        size: 13,
        weight: 700,
        fill: C.purple,
        align: 'middle',
      });
      statusBox(f, y + 24, 'warning', '◔', f.t('ord.cancelled'), f.t('ck.expiredBody'), { h: 230 });
    },
  },
  {
    id: 'VC18',
    name: 'Payment success / purchase confirmation',
    journey: 'Buy → Own',
    device: 'mobile',
    rtl: true,
    figma: '33 Receipt sheet (voucher receipt)',
    svg: true,
    isNew: true,
    comps: ['Status box (success)', 'View my voucher CTA', 'Order summary'],
    sheets: [],
    states: ['PAID: voucher exists only now'],
    route: '/orders/[id]',
    priority: 'P1',
    shot: 'customer-07-payment-success-en',
    draw(f) {
      const y = statusBox(f, 24, 'success', '✓', f.t('ord.success'), f.t('ord.successBody'), {
        h: 250,
      });
      f.button(40, y - 76, W - 80, 48, f.t('ord.viewVoucher'));
      orderSummary(f, y + 20);
      f.text(16, y + 276, f.t('ord.reference') + ': ORD-DDZYFX', { size: 11, fill: C.ink2 });
    },
  },
  {
    id: 'VC19',
    name: 'My Vouchers: Active',
    journey: 'Own',
    device: 'mobile',
    rtl: true,
    figma: '52 My Deals - active',
    svg: true,
    isNew: false,
    comps: ['Wallet tabs', 'Wallet row', 'Voucher status chip'],
    sheets: [],
    states: ['active list', 'refund in progress row', 'loading', 'empty', 'signed out'],
    route: '/my-vouchers',
    priority: 'P1',
    shot: 'customer-09-my-vouchers-en',
    draw(f) {
      customerChrome(f);
      walletTabs(f, 0);
      walletRow(f, 160, 'ACTIVE');
      walletRow(f, 264, 'ACTIVE', {
        title: L(f, 'قسيمة سبا بقيمة 200 ريال', 'SAR 200 spa voucher'),
        merchant: L(f, 'استوديو بلوم', 'Bloom Beauty Studio'),
        colors: ['#E8B7C8', '#6E2862'],
      });
      walletRow(f, 368, 'REFUND_PENDING', {
        title: L(f, 'قسيمة لياقة بقيمة 150 ريال', 'SAR 150 fitness voucher'),
        merchant: L(f, 'بالس فيتنس', 'Pulse Fitness'),
        colors: ['#9ED8FF', '#1E1B4B'],
      });
    },
  },
  {
    id: 'VC20',
    name: 'My Vouchers: Used',
    journey: 'Own',
    device: 'mobile',
    rtl: false,
    figma: '52 My Deals - active (past)',
    svg: true,
    isNew: true,
    comps: ['Wallet tabs', 'Wallet row'],
    sheets: [],
    states: ['used', 'empty'],
    route: '/my-vouchers?tab=used',
    priority: 'P2',
    shot: 'customer-13-wallet-used-en',
    draw(f) {
      customerChrome(f);
      walletTabs(f, 1);
      walletRow(f, 160, 'USED');
      walletRow(f, 264, 'USED', {
        title: L(f, 'قسيمة لياقة بقيمة 150 ريال', 'SAR 150 fitness voucher'),
        merchant: L(f, 'بالس فيتنس', 'Pulse Fitness'),
      });
    },
  },
  {
    id: 'VC21',
    name: 'My Vouchers: Expired',
    journey: 'Own',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Wallet tabs', 'Wallet row'],
    sheets: [],
    states: ['expired (value treatment is VALIDATE-KSA)', 'empty'],
    route: '/my-vouchers?tab=expired',
    priority: 'P2',
    shot: 'customer-13-wallet-expired-en',
    draw(f) {
      customerChrome(f);
      walletTabs(f, 2);
      walletRow(f, 160, 'EXPIRED');
    },
  },
  {
    id: 'VC22',
    name: 'My Vouchers: Refunded',
    journey: 'Own → Refund',
    device: 'mobile',
    rtl: false,
    figma: '53 My Deals - payments (replaced)',
    svg: true,
    isNew: true,
    comps: ['Wallet tabs', 'Wallet row'],
    sheets: [],
    states: ['refunded', 'empty'],
    route: '/my-vouchers?tab=refunded',
    priority: 'P2',
    shot: 'customer-13-wallet-refunded-en',
    draw(f) {
      customerChrome(f);
      walletTabs(f, 3);
      walletRow(f, 160, 'REFUNDED');
    },
  },
  {
    id: 'VC23',
    name: 'Voucher ticket: Active (QR, code, branches, terms, refund)',
    journey: 'Own → Redeem',
    device: 'mobile',
    rtl: true,
    figma: OLD(
      '32 Code - voucher',
      'OUTDATED: "spend in one or more visits"; MVP redeems the full value once',
    ),
    svg: true,
    isNew: false,
    comps: [
      'QR card (LTR island)',
      'Manual code',
      'Voucher status chip',
      'Facts row',
      'Directions button',
      'Terms disclosure',
      'Request a refund',
      'Support link',
    ],
    sheets: ['VC28 Refund sheet', 'VC31 Support sheet'],
    states: ['just issued (confirmation banner)', 'active', 'refund window ended'],
    route: '/my-vouchers/[id]',
    priority: 'P1',
    shot: 'customer-08-wallet-ticket-en',
    draw(f) {
      walletTicket(f, 'ACTIVE', { justIssued: true, refundCta: true });
    },
  },
  {
    id: 'VC24',
    name: 'Voucher ticket: Used / Redeemed',
    journey: 'Own',
    device: 'mobile',
    rtl: true,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Past-state card (no QR)', 'Facts row'],
    sheets: [],
    states: ['USED: no QR, no refund button, support still available'],
    route: '/my-vouchers/[id]',
    priority: 'P1',
    shot: 'customer-10-voucher-used-en',
    draw(f) {
      walletTicket(f, 'USED', { refundHint: f.t('wal.refund.used') });
    },
  },
  {
    id: 'VC25',
    name: 'Voucher ticket: Expired',
    journey: 'Own',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Past-state card (no QR)'],
    sheets: [],
    states: ['EXPIRED'],
    route: '/my-vouchers/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      walletTicket(f, 'EXPIRED');
    },
  },
  {
    id: 'VC26',
    name: 'Voucher ticket: Refunded',
    journey: 'Own → Refund',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Past-state card (no QR)', 'Refund status box'],
    sheets: [],
    states: ['REFUNDED to original payment method'],
    route: '/my-vouchers/[id]',
    priority: 'P1',
    shot: 'customer-12-refund-status-en',
    draw(f) {
      walletTicket(f, 'REFUNDED', { refundBox: ['success', f.t('wal.refund.REFUNDED')] });
    },
  },
  {
    id: 'VC27',
    name: 'Voucher ticket: refund in progress (voucher no longer usable)',
    journey: 'Own → Refund',
    device: 'mobile',
    rtl: true,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: [
      'Refund status box',
      'Voucher status chip (Refund in progress)',
      'Past-state card (no QR)',
    ],
    sheets: [],
    states: ['APPROVED / PROCESSING / FAILED: instance is VOIDED, QR removed, wording stays calm'],
    route: '/my-vouchers/[id]',
    priority: 'P1',
    shot: null,
    draw(f) {
      walletTicket(f, 'REFUND_PENDING', { refundBox: ['info', f.t('wal.refund.PROCESSING')] });
    },
  },
  {
    id: 'VC28',
    name: 'Refund request sheet',
    journey: 'Own → Refund',
    device: 'mobile',
    rtl: true,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Bottom sheet', 'Reason select', 'Note field', 'Primary button'],
    sheets: [],
    states: ['inside window (auto)', 'outside window (review note)', 'error'],
    route: '/my-vouchers/[id] (WalletTicket sheet)',
    priority: 'P1',
    shot: 'customer-11-refund-sheet-en',
    draw(f) {
      walletTicket(f, 'ACTIVE', { refundCta: true });
      refundSheetBody(f, 470, false);
    },
  },
  {
    id: 'VC29',
    name: 'Refund request sheet: outside the usual period',
    journey: 'Own → Refund',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Bottom sheet', 'Info alert (review)'],
    sheets: [],
    states: ['REVIEW_REQUIRED'],
    route: '/my-vouchers/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      walletTicket(f, 'ACTIVE', { refundCta: true });
      refundSheetBody(f, 540, true);
    },
  },
  {
    id: 'VC30',
    name: 'Refund status wording (board)',
    journey: 'Refund',
    device: 'mobile',
    rtl: true,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Refund status chip', 'Refund status box'],
    sheets: [],
    states: [
      'REQUESTED',
      'UNDER_REVIEW',
      'APPROVED',
      'PROCESSING',
      'REFUNDED',
      'REJECTED',
      'FAILED',
    ],
    route: 'packages/app-shell/src/vouchers/voucher-views.tsx (WalletTicket)',
    priority: 'P1',
    shot: null,
    draw(f) {
      f.text(16, 44, f.t('wal.refund.title'), { size: 20, weight: 800 });
      [
        'REQUESTED',
        'UNDER_REVIEW',
        'APPROVED',
        'PROCESSING',
        'REFUNDED',
        'REJECTED',
        'FAILED',
      ].forEach((s, i) => {
        const y = 70 + i * 96;
        const tone = {
          REQUESTED: 'warning',
          UNDER_REVIEW: 'warning',
          APPROVED: 'info',
          PROCESSING: 'info',
          REFUNDED: 'success',
          REJECTED: 'neutral',
          FAILED: 'warning',
        }[s];
        f.card(16, y, W - 32, 84, { r: 16 });
        f.pill(32, y + 14, f.t(`vrefund.${s}`), { ...TONES[tone], size: 11 });
        f.text(W - 32, y + 28, 'RF-K7QM9T', { size: 11, fill: C.ink2, align: 'end', ltr: true });
        (f.t(`wal.refund.${s}`).match(/.{1,46}(\s|$)/g) ?? [])
          .slice(0, 2)
          .forEach((l, j) => f.text(32, y + 56 + j * 16, l.trim(), { size: 12, fill: C.ink2 }));
      });
    },
  },
  {
    id: 'VC31',
    name: 'Support request sheet',
    journey: 'Own → Support',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Bottom sheet', 'Subject + message fields'],
    sheets: [],
    states: ['open case exists: "A support request is open"'],
    route: '/my-vouchers/[id]',
    priority: 'P2',
    shot: null,
    draw(f) {
      walletTicket(f, 'ACTIVE', { refundCta: true });
      sheetShell(f, 420, f.t('wal.support'));
      f.text(20, 844 - 420 + 82, f.t('wal.support.subject'), {
        size: 12,
        weight: 700,
        fill: C.ink2,
      });
      f.rect(20, 844 - 420 + 90, W - 40, 44, { r: 12, fill: '#fff', stroke: C.line });
      f.text(20, 844 - 420 + 160, f.t('wal.support.body'), { size: 12, weight: 700, fill: C.ink2 });
      f.rect(20, 844 - 420 + 168, W - 40, 90, { r: 12, fill: '#fff', stroke: C.line });
      f.button(20, 844 - 100, W - 40, 48, f.t('wal.support.send'));
    },
  },
  {
    id: 'VC32',
    name: 'Updates: voucher notifications',
    journey: 'Own',
    device: 'mobile',
    rtl: false,
    figma: '05 Home - Notifications',
    svg: true,
    isNew: true,
    comps: ['Notification row', 'Unread dot'],
    sheets: [],
    states: [
      'purchase received',
      'voucher ready',
      'expiring soon',
      'refund update',
      'redeemed',
      'payment failed',
    ],
    route: '/reservations?tab=updates',
    priority: 'P2',
    shot: null,
    draw(f) {
      customerChrome(f);
      f.text(16, 84, f.t('res.title'), { size: 28, weight: 800 });
      [
        'PURCHASE_SUCCEEDED',
        'VOUCHER_ISSUED',
        'VOUCHER_EXPIRING',
        'REFUND_UPDATED',
        'VOUCHER_REDEEMED',
        'PAYMENT_FAILED',
      ].forEach((k, i) => {
        const y = 120 + i * 84;
        f.card(16, y, W - 32, 72, { r: 16, fill: i < 2 ? C.purple50 : '#fff' });
        f.circle(46, y + 36, 17, { fill: C.lilac });
        f.text(46, y + 42, i === 5 ? '!' : i === 2 ? '◔' : '✓', {
          size: 15,
          weight: 800,
          fill: C.purple,
          align: 'middle',
          ltr: true,
        });
        f.text(
          74,
          y + 32,
          f.t(`notif.${k}`, { deal: TITLE(f).slice(0, 22), merchant: MERCHANT(f) }).slice(0, 38),
          { size: 13, weight: 700 },
        );
        f.text(74, y + 52, '8 Oct 2026, 18:13', { size: 11, fill: C.ink2, ltr: true });
      });
    },
  },
  {
    id: 'VC33',
    name: 'Loading skeletons (list, detail, ticket)',
    journey: 'States',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Skeleton card', 'Skeleton hero'],
    sheets: [],
    states: ['loading'],
    route: 'all voucher routes',
    priority: 'P3',
    shot: null,
    draw(f) {
      customerChrome(f);
      [0, 1, 2].forEach((i) => {
        f.card(16, 90 + i * 148, W - 32, 132, { r: 20 });
        f.rect(16, 90 + i * 148, 112, 132, { r: 20, fill: C.slate });
        f.rect(144, 110 + i * 148, 180, 14, { r: 7, fill: C.slate });
        f.rect(144, 136 + i * 148, 110, 10, { r: 5, fill: C.slate });
      });
    },
  },
  {
    id: 'VC34',
    name: 'Empty states (no vouchers, nothing active, nothing here)',
    journey: 'States',
    device: 'mobile',
    rtl: true,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Empty state', 'Primary link'],
    sheets: [],
    states: [
      'no vouchers on sale',
      'My Vouchers: none active',
      'other tabs: nothing here',
      'signed out',
    ],
    route: '/vouchers, /my-vouchers',
    priority: 'P2',
    shot: null,
    draw(f) {
      customerChrome(f);
      walletTabs(f, 0);
      f.circle(W / 2, 260, 40, { fill: C.lilac });
      f.text(W / 2, 332, f.t('wal.emptyActive'), { size: 20, weight: 800, align: 'middle' });
      f.text(W / 2, 360, f.t('wal.emptyActiveBody'), { size: 13, fill: C.ink2, align: 'middle' });
      f.button(100, 392, W - 200, 48, f.t('vch.title'));
      f.text(W / 2, 520, f.t('vch.empty'), { size: 16, weight: 800, align: 'middle' });
      f.text(W / 2, 546, f.t('vch.emptyBody').slice(0, 46), {
        size: 12,
        fill: C.ink2,
        align: 'middle',
      });
    },
  },
  {
    id: 'VC35',
    name: 'Error and connection lost (nothing charged)',
    journey: 'States',
    device: 'mobile',
    rtl: false,
    figma: 'none',
    svg: true,
    isNew: true,
    comps: ['Error state + retry', 'Danger alert'],
    sheets: [],
    states: ['load error', 'connection lost while starting checkout', 'stock lost (409)'],
    route: 'all voucher routes',
    priority: 'P2',
    shot: null,
    draw(f) {
      customerChrome(f);
      f.circle(W / 2, 250, 40, { fill: C.dangerBg });
      f.text(W / 2, 322, f.t('cust.loadError'), { size: 18, weight: 800, align: 'middle' });
      f.button(100, 350, W - 200, 48, f.t('cust.retry'));
      f.rect(16, 470, W - 32, 52, { r: 14, fill: C.dangerBg });
      f.text(30, 492, f.t('hot.connError').slice(0, 46), { size: 12, weight: 700, fill: C.danger });
      f.rect(16, 540, W - 32, 52, { r: 14, fill: C.dangerBg });
      f.text(30, 562, f.t('error.ORDER_NOT_PAYABLE').slice(0, 46), {
        size: 12,
        weight: 700,
        fill: C.danger,
      });
    },
  },
];
void voucherBadge;
void priceBox;
