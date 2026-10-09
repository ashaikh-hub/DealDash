import { C, TONES } from './lib.mjs';
import { customer } from './frames-customer.mjs';
import { staff } from './frames-staff.mjs';
import { merchant, admin } from './frames-portals.mjs';

/** Component sheets are laid out on a wide canvas: label + specimen rows. */
function label(f, x, y, s) { f.text(x, y, s, { size: 12, weight: 800, fill: C.ink2 }); }

const tokenStrip = (f, x, y) => {
  [['navy', C.navy], ['purple', C.purple], ['lilac', C.lilac], ['mint', C.mint], ['amber', C.amber], ['red', C.red], ['bg', C.bg], ['line', C.line]].forEach(([n, c], i) => {
    f.rect(x + i * 96, y, 84, 44, { r: 12, fill: c, stroke: C.line });
    f.text(x + i * 96, y + 62, n, { size: 11, fill: C.ink2 });
  });
  f.hotGradient(x + 8 * 96, y, 84, 44, 12);
  f.text(x + 8 * 96, y + 62, 'hot gradient', { size: 11, fill: C.ink2 });
};

export const components = [
  {
    id: 'K01', name: 'Customer components', h: 900,
    items: ['Exclusive Deal card (list + carousel)', 'Countdown (calm/soon/urgent/ended)', 'Inventory badge', 'Branch selector', 'Reserve CTA bar', 'Reservation status chip', 'QR/code card', 'Sold-out state'],
    draw(f) {
      f.text(24, 40, 'K01 Customer components (Stage 4)', { size: 22, weight: 800 });
      tokenStrip(f, 24, 70);
      label(f, 24, 170, 'Countdown tones'); [['2d 4h', C.slate, C.ink2], ['45m 00s', C.warnBg, C.warn], ['04m 12s', C.dangerBg, C.danger], ['Ended', C.slate, C.ink2]].forEach(([s, bg, col], i) => f.pill(24 + i * 130, 182, s, { fill: bg, color: col, size: 14, ltr: true }));
      label(f, 24, 250, 'Inventory badges'); [['Only 3 left', C.dangerBg, C.danger], ['12 left', C.slate, C.ink2], ['Sold out', C.warnBg, C.warn], ['Walk in', C.slate, C.ink2]].forEach(([s, bg, col], i) => f.pill(24 + i * 150, 262, s, { fill: bg, color: col, size: 12 }));
      label(f, 24, 330, 'Reservation status chips'); ['HELD:success', 'REDEEMED:info', 'NOT_COMPLETED:warning', 'CANCELLED:neutral'].forEach((s, i) => { const [k, tone] = s.split(':'); f.pill(24 + i * 240, 342, { HELD: 'Active', REDEEMED: 'Used', NOT_COMPLETED: 'Reservation not completed', CANCELLED: 'Cancelled' }[k], { ...TONES[tone], size: 12 }); });
      label(f, 24, 410, 'Branch selector (selected / default / sold out)');
      [[true, 'Najd Kitchen Al Nakheel', '3 left'], [false, 'Najd Kitchen Hittin', '2 left'], [false, 'Najd Kitchen Olaya', 'Sold out here']].forEach(([on, n, s], i) => {
        const x = 24 + i * 380; f.rect(x, 424, 360, 64, { r: 16, fill: i === 2 ? C.slate : on ? C.purple50 : '#fff', stroke: on ? C.purple : C.line, sw: on ? 1.5 : 1 });
        f.circle(x + 28, 456, 9, { stroke: on ? C.purple : C.line, sw: 2, fill: on ? C.purple : 'none' }); f.text(x + 50, 452, n, { size: 13, weight: 800, fill: i === 2 ? C.ink2 : C.navy }); f.pill(x + 220, 440, s, { fill: i === 2 ? C.dangerBg : C.warnBg, color: i === 2 ? C.danger : C.warn, size: 10 });
      });
      label(f, 24, 530, 'Reserve CTA bar (enabled / disabled)');
      [[false, 'Reserve for free'], [true, 'Sold out']].forEach(([dis, s], i) => { const x = 24 + i * 380; f.card(x, 544, 360, 80, { r: 16 }); f.text(x + 16, 574, 'Free to reserve', { size: 14, weight: 800 }); f.text(x + 16, 594, 'Held for 30 minutes', { size: 11, fill: C.ink2 }); f.button(x + 190, 558, 156, 48, s, { fill: dis ? C.line : C.purple, color: dis ? C.ink2 : '#fff', size: 13 }); });
      label(f, 24, 660, 'QR / code card'); f.rect(24, 674, 260, 200, { r: 20, stroke: '#B9A4FF', dash: true, fill: '#fff' }); f.qr(64, 684, 180); f.text(154, 868, 'K7QM-9T2X', { size: 14, weight: 800, align: 'middle', ltr: true });
      f.text(320, 700, 'Rules: QR and code never mirror in RTL (LTR island). Western digits in Arabic.', { size: 12, fill: C.ink2 });
      f.text(320, 722, 'Reserve CTA is always FREE: no price, no payment, no activation (S20/S26/S31 corrected).', { size: 12, fill: C.ink2 });
      f.text(320, 744, 'Expired is worded "Reservation not completed" (neutral; no blame).', { size: 12, fill: C.ink2 });
    },
  },
  {
    id: 'K02', name: 'Merchant Portal components', h: 900,
    items: ['Exclusive Deal builder (stepper + preview)', 'Inventory controls', 'Reservation configuration', 'Campaign monitor', 'Reservation table', 'Performance cards'],
    draw(f) {
      f.text(24, 40, 'K02 Merchant Portal components (Stage 4)', { size: 22, weight: 800 });
      label(f, 24, 80, 'Builder stepper (6 steps)'); ['Offer', 'Content', 'Time & limits', 'Branches & stock', 'Eligibility & terms', 'Review'].forEach((n, i) => { const x = 24 + i * 190; f.circle(x + 14, 112, 13, { fill: i === 2 ? C.purple : i < 2 ? C.mint : '#fff', stroke: i > 2 ? C.line : undefined, sw: 2 }); f.text(x + 14, 117, i < 2 ? '✓' : String(i + 1), { size: 12, weight: 800, fill: i <= 2 ? '#fff' : C.ink2, align: 'middle', ltr: true }); f.text(x + 36, 117, n, { size: 13, weight: i === 2 ? 800 : 600 }); });
      label(f, 24, 170, 'Limit-type cards'); [['Time only', false], ['Quantity only', false], ['Time and quantity', true]].forEach(([n, on], i) => { f.rect(24 + i * 220, 182, 208, 80, { r: 16, fill: on ? C.purple50 : '#fff', stroke: on ? C.purple : C.line, sw: on ? 1.5 : 1 }); f.text(24 + i * 220 + 14, 228, n, { size: 13, weight: 800 }); });
      label(f, 24, 300, 'Inventory controls (units / add / remove)'); f.rect(24, 312, 500, 56, { r: 14, fill: '#fff', stroke: C.line }); f.text(40, 346, 'Najd Kitchen Al Nakheel', { size: 13, weight: 700 }); f.rect(360, 322, 70, 36, { r: 10, fill: C.slate }); f.text(395, 346, '12', { size: 14, weight: 800, align: 'middle', ltr: true }); f.button(440, 322, 72, 36, '+ Add', { fill: C.lilac, color: C.purple, size: 12 });
      label(f, 24, 410, 'Reservation configuration'); [['Hold (minutes)', '30'], ['Per customer', '1'], ['Max active per customer', '3']].forEach(([k, v], i) => { f.text(24 + i * 220, 440, k, { size: 12, weight: 700, fill: C.ink2 }); f.rect(24 + i * 220, 448, 160, 40, { r: 12, fill: '#fff', stroke: C.line }); f.text(40 + i * 220, 474, v, { size: 13, ltr: true }); });
      label(f, 24, 530, 'Campaign monitor tiles'); [['Live', 'Status'], ['02:14:55', 'Time left'], ['4', 'Available'], ['2', 'Reserved'], ['2', 'Redeemed'], ['1', 'Not completed']].forEach(([v, l], i) => { f.card(24 + i * 150, 544, 140, 78, { r: 16 }); f.text(40 + i * 150, 584, v, { size: 22, weight: 800, ltr: true }); f.text(40 + i * 150, 608, l, { size: 11, fill: C.ink2 }); });
      label(f, 24, 660, 'Stock bar'); f.rect(24, 674, 900, 14, { r: 7, fill: C.slate }); f.rect(24, 674, 220, 14, { r: 7, fill: C.purple }); f.rect(244, 674, 220, 14, { fill: C.amber }); f.rect(464, 674, 460, 14, { r: 7, fill: C.mint });
      ['Available (purple)', 'Reserved (amber)', 'Redeemed (mint)'].forEach((s, i) => f.text(24 + i * 180, 712, s, { size: 11, fill: C.ink2 }));
      label(f, 24, 760, 'Reservation table row + performance funnel bar'); f.card(24, 772, 900, 50, { r: 14 }); f.text(40, 802, '…T2X7   Layla   Al Nakheel   1', { size: 13, weight: 700, ltr: true }); f.pill(500, 784, 'Active', { ...TONES.success, size: 11 }); f.rect(600, 790, 300, 14, { r: 7, fill: C.slate }); f.rect(600, 790, 120, 14, { r: 7, fill: C.purple });
    },
  },
  {
    id: 'K03', name: 'Merchant Staff components', h: 900,
    items: ['Scanner viewport', 'Manual entry field', 'Validation result card (ok/warn/stop)', 'Status states', 'Confirm redemption button', 'Success state'],
    draw(f) {
      f.text(24, 40, 'K03 Merchant Staff components (Stage 4)', { size: 22, weight: 800 });
      label(f, 24, 80, 'Scanner viewport'); f.rect(24, 92, 240, 240, { r: 24, fill: C.dark }); f.rect(24 + 50, 92 + 50, 140, 140, { r: 18, stroke: '#fff', sw: 3 });
      label(f, 300, 80, 'Manual entry'); f.rect(300, 92, 300, 64, { r: 14, fill: '#fff', stroke: C.purple, sw: 2 }); f.text(450, 134, 'K7QM-9T2X', { size: 26, weight: 800, align: 'middle', ltr: true }); f.button(300, 172, 300, 52, 'Check code', { size: 14 });
      label(f, 640, 80, 'Result cards: tone map'); [['green: success', C.greenBg, '#1FBF8F', 'Valid · Redeemed'], ['amber: recoverable', C.warnBg, '#F5A524', 'Expired · Not valid yet · Wrong branch'], ['red: hard failure', C.dangerBg, '#E93A52', 'Invalid · Already redeemed · Not eligible · Not active · Campaign suspended']].forEach(([n, bg, bd, s], i) => { f.rect(640, 92 + i * 80, 520, 68, { r: 20, fill: bg, stroke: bd, sw: 2 }); f.text(660, 120 + i * 80, n, { size: 14, weight: 800 }); f.text(660, 142 + i * 80, s, { size: 12, fill: C.ink2 }); });
      label(f, 24, 380, 'Buttons'); f.button(24, 392, 300, 56, 'Redeem (opens the confirmation sheet)', { fill: '#0E8F6A', size: 13 }); f.button(340, 392, 300, 56, 'Cancel', { fill: '#fff', color: C.navy, stroke: C.line }); f.button(656, 392, 300, 56, 'Scan next', {});
      label(f, 24, 490, 'Journey: SCAN → VALIDATE → REDEEM'); ['SCAN', 'VALIDATE', 'REDEEM'].forEach((s, i) => { const x = 24 + i * 260; f.rect(x, 504, 230, 70, { r: 18, fill: i === 0 ? C.lilac : i === 1 ? C.warnBg : C.greenBg }); f.text(x + 115, 546, s, { size: 18, weight: 800, align: 'middle' }); if (i < 2) f.text(x + 245, 546, '→', { size: 22, weight: 800, align: 'middle', fill: C.ink2, ltr: true }); });
      label(f, 640, 380, 'Confirmation sheet'); f.rect(640, 392, 330, 56, { r: 14, fill: C.warnBg }); f.text(654, 425, 'This cannot be undone. Once redeemed…', { size: 12, weight: 700, fill: C.warn }); label(f, 990, 380, 'Torch (when supported)'); f.circle(1040, 420, 26, { fill: C.amber }); label(f, 1090, 380, 'OTP'); for (let i = 0; i < 6; i++) f.rect(1090 + i * 17, 392, 14, 40, { r: 4, fill: '#fff', stroke: C.line }); label(f, 24, 620, 'Targets'); f.text(24, 644, 'All tap targets >= 56 px high. Result colour is never the only signal: every state has a glyph and a plain-language title.', { size: 13 });
      f.text(24, 668, 'Idempotency-Key is created once per confirm and reused on retry. Success is only shown after the server confirms.', { size: 13 });
    },
  },
  {
    id: 'K04', name: 'Admin components', h: 800,
    items: ['Review workbench', 'Inventory view', 'Reservation activity', 'Decision panel', 'Audit timeline'],
    draw(f) {
      f.text(24, 40, 'K04 Admin components (Stage 4)', { size: 22, weight: 800 });
      label(f, 24, 80, 'Decision panel'); f.card(24, 92, 320, 230, { r: 18 }); f.text(44, 124, 'Decision', { size: 15, weight: 800 }); f.button(44, 140, 280, 40, 'Approve', { size: 13 }); f.button(44, 190, 280, 40, 'Request changes', { fill: '#fff', color: C.navy, stroke: C.line, size: 13 }); f.button(44, 240, 280, 40, 'Reject', { fill: C.red, size: 13 });
      label(f, 380, 80, 'Inventory view'); f.card(380, 92, 460, 140, { r: 18 }); [['Branch', 'Total', 'Avail', 'Held', 'Used'], ['Al Nakheel', '12', '2', '2', '8'], ['Hittin', '8', '2', '0', '6']].forEach((r, i) => r.forEach((c, j) => f.text(400 + [0, 190, 260, 330, 400][j], 126 + i * 36, c, { size: 12, weight: i ? 600 : 800, fill: i ? C.navy : C.ink2, ltr: j > 0 })));
      label(f, 380, 270, 'Reservation activity lookup'); f.rect(380, 282, 300, 44, { r: 12, fill: '#fff', stroke: C.line }); f.text(396, 310, 'DD-K7QM9T', { size: 13, ltr: true }); f.button(692, 282, 100, 44, 'Search', { size: 13 });
      label(f, 24, 370, 'Audit timeline'); [['Approved', C.mint], ['Changes requested', C.amber], ['Submitted', C.purple]].forEach(([s, col], i) => { const y = 392 + i * 70; f.circle(40, y + 8, 8, { fill: col }); if (i < 2) f.line(40, y + 18, 40, y + 70, { stroke: C.line, sw: 2 }); f.text(64, y + 12, s, { size: 14, weight: 800 }); f.text(64, y + 32, 'Operations · 8 Oct 10:30', { size: 11, fill: C.ink2 }); });
      label(f, 380, 370, 'Review workbench cards'); f.card(380, 382, 220, 120, { r: 18 }); f.text(396, 412, 'Merchant', { size: 13, weight: 800 }); f.card(612, 382, 228, 120, { r: 18 }); f.text(628, 412, 'Reservation rules', { size: 13, weight: 800 }); f.card(380, 514, 220, 120, { r: 18 }); f.text(396, 544, 'EN / AR content', { size: 13, weight: 800 }); f.card(612, 514, 228, 120, { r: 18 }); f.text(628, 544, 'Customer preview', { size: 13, weight: 800 });
      label(f, 24, 640, 'Reason dialog rule'); f.text(24, 664, 'Request changes / reject / pause / suspend / cancel / cancel reservation / lift restriction / reverse: reason REQUIRED (EN), Arabic optional.', { size: 13 });
    },
  },
  {
    id: 'K05', name: 'Shared status and state patterns', h: 700,
    items: ['Exclusive Deal status chips (11)', 'Loading skeleton', 'Empty state', 'Error + retry', 'Offline banner', 'Alerts (info/warning/danger/success)'],
    draw(f) {
      f.text(24, 40, 'K05 Shared status and state patterns', { size: 22, weight: 800 });
      label(f, 24, 80, 'Exclusive Deal statuses'); [['Draft', 'neutral'], ['Pending review', 'warning'], ['Needs changes', 'warning'], ['Scheduled', 'info'], ['Live', 'success'], ['Paused', 'neutral'], ['Sold out', 'warning'], ['Expired', 'neutral'], ['Cancelled', 'neutral'], ['Rejected', 'danger'], ['Suspended', 'danger']].forEach(([s, tone], i) => f.pill(24 + (i % 6) * 190, 92 + Math.floor(i / 6) * 44, s, { ...TONES[tone], size: 12 }));
      label(f, 24, 220, 'Alerts'); [['info', 'Reserving is free. We hold your spot for 30 minutes.'], ['success', 'Reservation confirmed.'], ['warning', 'Only 3 left.'], ['danger', 'Connection lost. Nothing was charged. Try again.']].forEach(([k, s], i) => { const col = { info: C.lilac, success: C.greenBg, warning: C.warnBg, danger: C.dangerBg }[k]; f.rect(24, 232 + i * 56, 560, 46, { r: 14, fill: col }); f.text(40, 261 + i * 56, s, { size: 13, weight: 600 }); });
      label(f, 640, 220, 'Skeleton'); f.card(640, 232, 400, 120, { r: 20 }); f.rect(640, 232, 112, 120, { r: 20, fill: C.slate }); f.rect(768, 252, 180, 14, { r: 7, fill: C.slate }); f.rect(768, 278, 100, 10, { r: 5, fill: C.slate });
      label(f, 24, 480, 'Offline banner'); f.rect(24, 492, 560, 56, { r: 14, fill: C.warnBg }); f.text(40, 526, '≈  You appear to be offline. Check your connection.', { size: 13, weight: 700, fill: '#5a3b00' });
      label(f, 640, 480, 'Empty / error'); f.circle(740, 560, 28, { fill: C.lilac }); f.text(790, 556, 'Nothing hot right now', { size: 15, weight: 800 }); f.circle(740, 630, 28, { fill: C.dangerBg }); f.text(790, 626, 'We could not load this. Retry', { size: 15, weight: 800 });
    },
  },
];

/* ---------------------------------------------------------------- flows */
export const flows = [
  {
    id: 'F01', name: 'Merchant creates Exclusive Deal → Admin approves', h: 660,
    steps: [
      { surface: 'Merchant', title: 'Campaigns → Exclusive Deals', lines: ['Free-reservation note', 'Create Exclusive Deal'], ref: 'M01' },
      { surface: 'Merchant', title: 'Builder 1-3', lines: ['Offer, bilingual content,', 'time/quantity limits'], ref: 'M02 M03 M04' },
      { surface: 'Merchant', title: 'Builder 4-5', lines: ['Branch stock (units)', 'Eligibility + terms'], ref: 'M06 M07' },
      { surface: 'Merchant', title: 'Review & submit', lines: ['Guardrail check,', 'fix-first list'], ref: 'M08', tone: 'success' },
      { surface: 'Admin', title: 'Review queue', lines: ['Pending review row'], ref: 'A01', tone: 'warning' },
      { surface: 'Admin', title: 'Workbench', lines: ['Rules, inventory, EN/AR,', 'preview, history'], ref: 'A02 A09', tone: 'warning' },
      { surface: 'Admin', title: 'Decision', lines: ['Approve → Live/Scheduled', 'or Request changes (reason)'], ref: 'A03', tone: 'success' },
      { surface: 'Merchant', title: 'Monitor', lines: ['Status Live,', 'stock and reservations'], ref: 'M10', tone: 'success' },
    ],
    note: 'Needs changes returns to Builder with the reviewer reason shown (M16). Pilot: every Exclusive Deal is manually reviewed.',
  },
  {
    id: 'F02', name: 'Customer discovers → reserves → confirmation → visits merchant', h: 660,
    steps: [
      { surface: 'Customer', title: 'Discover', lines: ['Home rail or /hot list', 'sorted ending soon'], ref: 'C01 C02' },
      { surface: 'Customer', title: 'Exclusive Deal detail', lines: ['Countdown, units left,', 'free, how it works'], ref: 'C03' },
      { surface: 'Customer', title: 'Reserve sheet', lines: ['Choose branch', 'Reserve for free'], ref: 'C06' },
      { surface: 'Customer', title: 'Confirmation', lines: ['Reservation confirmed,', 'QR + code + hold timer'], ref: 'C07', tone: 'success' },
      { surface: 'Customer', title: 'My Deals → Active', lines: ['Open the ticket', 'when at the counter'], ref: 'C17 C08', tone: 'success' },
      { surface: 'Customer', title: 'Visit merchant', lines: ['Directions or Call,', 'show the QR'], ref: 'C08' },
      { surface: 'Staff', title: 'Staff redeems', lines: ['See flow F03'], ref: 'T05 T07', tone: 'success' },
      { surface: 'Customer', title: 'Used', lines: ['Ticket shows Used,', 'in-app update sent'], ref: 'C12 C19', tone: 'neutral' },
    ],
    note: 'No payment step exists anywhere in this flow. Sign-in is requested at Reserve if the guest is not signed in.',
  },
  {
    id: 'F03', name: 'Staff scans → validates → redeems', h: 660,
    steps: [
      { surface: 'Staff', title: 'SCAN', lines: ['Camera scanner or', 'Enter code'], ref: 'T03 T04' },
      { surface: 'Staff', title: 'VALIDATE', lines: ['Server checks owner,', 'branch, state, rules'], ref: 'T05', tone: 'warning' },
      { surface: 'Staff', title: 'Valid (green)', lines: ['Offer, qty, customer,', 'branch, hold ends', 'CTA: Redeem'], ref: 'T05', tone: 'success' },
      { surface: 'Staff', title: 'REDEEM: confirm sheet', lines: ['Offer, benefit, first name,', 'branch + irreversible warning', 'Confirm (locked after tap)'], ref: 'T21 T06', tone: 'success' },
      { surface: 'Staff', title: 'Success', lines: ['Redeemed + reference', 'Scan next'], ref: 'T07', tone: 'success' },
      { surface: 'Staff', title: 'Not accepted', lines: ['AMBER: Expired, Not valid', 'yet, Wrong branch', 'RED: Invalid, Used, Not', 'eligible, Not active, Blocked'], ref: 'T08-T14 T22', tone: 'danger' },
      { surface: 'Staff', title: 'Connection lost', lines: ['Retry reuses the same key', 'so it never double redeems'], ref: 'T15 T16', tone: 'warning' },
      { surface: 'Staff', title: 'History', lines: ['Today / Yesterday,', 'counts and filters'], ref: 'T18' },
    ],
    note: 'Success is only shown after the server confirms. Every failure has a glyph, a title and a next action: Scan next.',
  },
  {
    id: 'F04', name: 'Reservation expires → inventory returns → customer sees expired', h: 660,
    steps: [
      { surface: 'Customer', title: 'Reserved', lines: ['Hold timer running,', 'unit moved to Reserved'], ref: 'C08', tone: 'success' },
      { surface: 'Customer', title: 'Ending soon', lines: ['Timer red < 5 min;', 'in-app notice at 10 min'], ref: 'C09', tone: 'warning' },
      { surface: 'System', title: 'Hold elapses', lines: ['Sweeper marks EXPIRED,', 'unit returns to Available'], ref: 'docs/STAGE4.md', tone: 'neutral' },
      { surface: 'Merchant', title: 'Monitor updates', lines: ['Available +1,', 'Not completed +1'], ref: 'M10 M11', tone: 'neutral' },
      { surface: 'Customer', title: 'Reservation not completed', lines: ['Neutral wording, no blame,', 'QR removed'], ref: 'C10', tone: 'warning' },
      { surface: 'Customer', title: 'Reserve again', lines: ['If stock remains and the', 'campaign is live'], ref: 'C03', tone: 'info' },
      { surface: 'Staff', title: 'Late scan', lines: ['Expired result: ask the', 'customer to reserve again'], ref: 'T09', tone: 'warning' },
      { surface: 'Admin', title: 'No-show review', lines: ['3 in 30 days → 7-day', 'reservation pause (liftable)'], ref: 'A07', tone: 'neutral' },
    ],
    note: 'Expiry is lazy and swept; a held reservation is never lost silently and the unit returns exactly once.',
  },
  {
    id: 'F05', name: 'Last unit → one customer succeeds → second sees sold out', h: 660,
    steps: [
      { surface: 'Customer A', title: 'Sees "Only 1 left"', lines: ['Urgent badge', 'Reserve for free'], ref: 'C03 C05', tone: 'warning' },
      { surface: 'Customer B', title: 'Sees "Only 1 left"', lines: ['Same moment,', 'same unit'], ref: 'C03 C05', tone: 'warning' },
      { surface: 'Server', title: 'Atomic stock move', lines: ['One conditional UPDATE:', 'available 1 → 0 (once)'], ref: 'docs/STAGE4.md', tone: 'neutral' },
      { surface: 'Customer A', title: 'Confirmed', lines: ['QR + code + timer'], ref: 'C07', tone: 'success' },
      { surface: 'Customer B', title: 'Out of stock', lines: ['Sheet error: someone', 'got the last one'], ref: 'C23', tone: 'danger' },
      { surface: 'Customer B', title: 'Sold out', lines: ['Detail shows Sold out,', 'CTA disabled'], ref: 'C13', tone: 'warning' },
      { surface: 'Merchant', title: 'Sold out status', lines: ['Status SOLD_OUT,', 'visible not hidden'], ref: 'M09 M10', tone: 'warning' },
      { surface: 'System', title: 'Unit returns?', lines: ['If A expires/cancels the', 'deal reopens (LIVE)'], ref: 'F04', tone: 'neutral' },
    ],
    note: 'Never oversold: CHECK total = available + reserved + redeemed. The loser gets a calm, specific message and keeps browsing.',
  },
];

export const ALL = {
  customer,
  merchant,
  staff,
  admin,
};
