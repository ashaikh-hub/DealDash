/**
 * Reservation commitment model (founder decision 2026-10-15, RC rules): why a merchant's reservation set-up is refused, the fields it
 * concerns, and the customer errors while paid reservations wait for the payment step (build phase 2). Kept apart from the frozen
 * Stage 4 copy, whose "free reservation, no deposit wording" rule this decision superseded. The neutral "not completed" wording for an
 * unused reservation still applies (no "no-show" or "penalty" in the copy).
 * Pairs are [English, Arabic]; the Arabic is a working translation that needs native review before launch.
 */
const RESERVATION = {
  'issue.METHOD_REQUIRED': [
    'Choose how customers commit to a reservation: full payment, deposit or card hold',
    'اختر طريقة تأكيد الحجز: الدفع الكامل أو العربون أو حجز مبلغ على البطاقة',
  ],
  'issue.METHOD_NOT_ALLOWED': [
    'This reservation method is not available for your business',
    'طريقة الحجز هذه غير متاحة لنشاطك التجاري',
  ],
  'issue.AMOUNT_OUT_OF_RANGE': ['Outside the allowed amount', 'خارج المبلغ المسموح'],
  'issue.CUTOFF_OUT_OF_RANGE': [
    'Outside the allowed cancellation time',
    'خارج وقت الإلغاء المسموح',
  ],
  'issue.REFUND_PERCENT_OUT_OF_RANGE': [
    'Outside the allowed refund share',
    'خارج نسبة الاسترداد المسموحة',
  ],
  'issue.NOT_ALLOWED': ['Not allowed for your business', 'غير مسموح لنشاطك التجاري'],
  'issue.field.commitment': ['Reservation payment terms', 'شروط الدفع للحجز'],
  'issue.field.commitment.method': ['Reservation method', 'طريقة الحجز'],
  'issue.field.commitment.amountMinor': ['Amount per unit', 'المبلغ لكل وحدة'],
  'issue.field.commitment.depositRefundable': ['Refundable deposit', 'عربون قابل للاسترداد'],
  'issue.field.commitment.cancelCutoffMinutes': ['Cancellation cut-off', 'آخر موعد للإلغاء'],
  'issue.field.commitment.noShowRefundPercent': [
    'Refund if cancelled late or not completed',
    'الاسترداد عند الإلغاء المتأخر أو عدم إكمال الحجز',
  ],
  // phase 2 customer reservation states
  'res.state.PAYMENT_PENDING': ['Waiting for payment', 'بانتظار الدفع'],
  'res.state.PAYMENT_FAILED': ['Not paid, nothing charged', 'لم يتم الدفع، لم يُخصم أي مبلغ'],
  // phase 2 customer notifications (payment success is the reservation confirmation)
  'notif.RESERVATION_PAYMENT_FAILED': [
    'Your reservation payment at {merchant} did not go through',
    'لم تتم عملية الدفع لحجزك لدى {merchant}',
  ],
  'notif.RESERVATION_REFUND_UPDATED': [
    'Refund update for your reservation at {merchant}',
    'تحديث استرداد مبلغ حجزك لدى {merchant}',
  ],
  'notif.RESERVATION_FORFEITED': [
    'Your reservation amount at {merchant} was kept under the terms you accepted',
    'تم الاحتفاظ بمبلغ حجزك لدى {merchant} وفق الشروط التي وافقت عليها',
  ],
  // phase 3 card pre-authorisation
  'notif.RESERVATION_HOLD_RELEASED': [
    'The hold on your card for {merchant} was released',
    'تم إلغاء حجز المبلغ على بطاقتك لدى {merchant}',
  ],
  'notif.RESERVATION_HOLD_CAPTURED': [
    'An amount was charged from your card hold for {merchant}',
    'تم خصم مبلغ من الحجز على بطاقتك لدى {merchant}',
  ],
  'error.RESERVATION_METHOD_REQUIRED': [
    'This offer cannot be reserved right now.',
    'لا يمكن حجز هذا العرض الآن.',
  ],
  'error.RESERVATION_PAYMENT_UNAVAILABLE': [
    'Reserving this offer needs a payment, which is not available yet.',
    'حجز هذا العرض يتطلب دفعاً غير متاح بعد.',
  ],
} as const satisfies Record<string, readonly [string, string]>;

type ReservationPairs = typeof RESERVATION;
export type ReservationKey = keyof ReservationPairs;
const pick = (index: 0 | 1) =>
  Object.fromEntries(Object.entries(RESERVATION).map(([k, v]) => [k, v[index]])) as Record<
    ReservationKey,
    string
  >;
export const enReservation = pick(0);
export const arReservation = pick(1);
