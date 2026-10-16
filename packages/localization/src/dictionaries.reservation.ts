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
  'error.RESERVATION_TERMS_REQUIRED': [
    'Please accept the reservation terms to continue.',
    'يرجى قبول شروط الحجز للمتابعة.',
  ],
  'error.RESERVATION_METHOD_REQUIRED': [
    'This offer cannot be reserved right now.',
    'لا يمكن حجز هذا العرض الآن.',
  ],
  'error.RESERVATION_PAYMENT_UNAVAILABLE': [
    'Reserving this offer needs a payment, which is not available yet.',
    'حجز هذا العرض يتطلب دفعاً غير متاح بعد.',
  ],

  // ---------------------------------------------------------------- phase 4: customer reservation journey (RC-81)
  'rsv.method.FULL_PREPAYMENT': ['Pay in full to reserve', 'ادفع المبلغ كاملاً للحجز'],
  'rsv.method.DEPOSIT': ['Deposit to reserve', 'عربون للحجز'],
  'rsv.method.CARD_PREAUTH': ['Card hold to reserve', 'حجز مبلغ على البطاقة للحجز'],
  'rsv.methodName.FULL_PREPAYMENT': ['Full payment', 'دفع كامل'],
  'rsv.methodName.DEPOSIT': ['Deposit', 'عربون'],
  'rsv.methodName.CARD_PREAUTH': ['Card hold', 'حجز على البطاقة'],
  'rsv.bar.FULL_PREPAYMENT': ['{amount} to reserve', '{amount} للحجز'],
  'rsv.bar.DEPOSIT': ['{amount} deposit', 'عربون {amount}'],
  'rsv.bar.CARD_PREAUTH': ['{amount} card hold', 'حجز {amount} على البطاقة'],
  'rsv.termsTitle': ['Reservation terms', 'شروط الحجز'],
  'rsv.how1.FULL_PREPAYMENT': ['Pay to reserve', 'ادفع للحجز'],
  'rsv.how1.DEPOSIT': ['Pay a deposit', 'ادفع العربون'],
  'rsv.how1.CARD_PREAUTH': ['Hold an amount on your card', 'احجز مبلغاً على بطاقتك'],
  'rsv.how1b': ['Pick a branch, then pay securely.', 'اختر فرعاً ثم ادفع بأمان.'],
  'rsv.confirmTitle': ['Review and pay', 'راجع وادفع'],
  'rsv.payNow': ['To pay now', 'المبلغ المطلوب الآن'],
  'rsv.holdNow': ['Held on your card, not charged', 'يُحجز على بطاقتك دون خصم'],
  'rsv.collectedBy': [
    'DealDash collects this payment for {merchant}. The offer and its price are set by {merchant}; DealDash handles the payment and refunds.',
    'تحصّل DealDash هذا المبلغ نيابةً عن {merchant}. العرض وسعره يحددهما {merchant}، وتتولى DealDash الدفع والاسترداد.',
  ],
  'rsv.use.FULL_PREPAYMENT': [
    'At the branch: show your code. The reserved offer is already paid.',
    'في الفرع: اعرض رمزك. العرض المحجوز مدفوع مسبقاً.',
  ],
  'rsv.use.DEPOSIT': [
    'At the branch: your deposit is credited to your bill.',
    'في الفرع: يُخصم العربون من فاتورتك.',
  ],
  'rsv.use.RELEASE': [
    'At the branch: the hold is released and you pay as usual.',
    'في الفرع: يُلغى الحجز على البطاقة وتدفع كالمعتاد.',
  ],
  'rsv.use.CAPTURE': [
    'At the branch: the held amount is charged as part of your bill.',
    'في الفرع: يُخصم المبلغ المحجوز كجزء من فاتورتك.',
  ],
  'rsv.immediate': [
    'The held amount is charged as soon as your card is approved.',
    'يُخصم المبلغ المحجوز فور موافقة بطاقتك.',
  ],
  'rsv.cancelFree.FULL_PREPAYMENT': [
    'Cancel up to {min} min before your reservation ends for a full refund.',
    'ألغِ قبل انتهاء حجزك بـ {min} دقيقة على الأقل لاسترداد المبلغ كاملاً.',
  ],
  'rsv.cancelFree.DEPOSIT': [
    'Cancel up to {min} min before your reservation ends to get your deposit back.',
    'ألغِ قبل انتهاء حجزك بـ {min} دقيقة على الأقل لاسترداد العربون.',
  ],
  'rsv.cancelFree.CARD_PREAUTH': [
    'Cancel up to {min} min before your reservation ends and nothing is charged.',
    'ألغِ قبل انتهاء حجزك بـ {min} دقيقة على الأقل ولن يُخصم أي مبلغ.',
  ],
  'rsv.nonRefundable': [
    'This deposit is non-refundable, even if you cancel early.',
    'هذا العربون غير قابل للاسترداد حتى عند الإلغاء المبكر.',
  ],
  'rsv.late.FULL_PREPAYMENT': [
    'If you cancel later or do not use the reservation in time, {pct}% is refunded.',
    'إذا ألغيت بعد ذلك أو لم تستخدم الحجز في الوقت المحدد، يُسترد {pct}٪.',
  ],
  'rsv.late.DEPOSIT': [
    'If you cancel later or do not use the reservation in time, the deposit is kept by the business.',
    'إذا ألغيت بعد ذلك أو لم تستخدم الحجز في الوقت المحدد، يحتفظ النشاط التجاري بالعربون.',
  ],
  'rsv.late.CARD_PREAUTH': [
    'If you cancel later or do not use the reservation in time, {amount} is charged from the hold.',
    'إذا ألغيت بعد ذلك أو لم تستخدم الحجز في الوقت المحدد، يُخصم {amount} من المبلغ المحجوز.',
  ],
  'rsv.lateNothing': [
    'If you cancel later or do not use the reservation in time, nothing is charged.',
    'إذا ألغيت بعد ذلك أو لم تستخدم الحجز في الوقت المحدد، لن يُخصم أي مبلغ.',
  ],
  'rsv.strikes': [
    'Reservations not used in time also count toward your reservation limits.',
    'الحجوزات غير المستخدمة في وقتها تُحتسب أيضاً ضمن حدود الحجز لديك.',
  ],
  'rsv.window': [
    'Complete payment within {min} min, or the reservation is released and nothing is charged.',
    'أكمل الدفع خلال {min} دقيقة، وإلا يُلغى الحجز دون خصم أي مبلغ.',
  ],
  'rsv.holdLength': [
    'Your reservation is held for {min} min once payment is confirmed.',
    'يُحجز لك العرض لمدة {min} دقيقة بعد تأكيد الدفع.',
  ],
  'rsv.accept': [
    'I accept these payment, cancellation and refund terms',
    'أوافق على شروط الدفع والإلغاء والاسترداد هذه',
  ],
  'rsv.cta.FULL_PREPAYMENT': ['Pay {amount} and reserve', 'ادفع {amount} واحجز'],
  'rsv.cta.DEPOSIT': ['Pay {amount} deposit and reserve', 'ادفع عربون {amount} واحجز'],
  'rsv.cta.CARD_PREAUTH': ['Hold {amount} and reserve', 'احجز {amount} على البطاقة واحجز'],
  'rsv.redirecting': ['Opening secure payment…', 'جارٍ فتح صفحة الدفع الآمنة…'],
  'rsv.secure': [
    'You finish on a secure payment page. DealDash never sees your card details.',
    'تُكمل الدفع في صفحة دفع آمنة. لا تطّلع DealDash على بيانات بطاقتك.',
  ],
  'rsv.section': ['Payment', 'الدفع'],
  'rsv.amountPaid': ['Paid', 'المدفوع'],
  'rsv.amountHeld': ['Held on card', 'المحجوز على البطاقة'],
  'rsv.amountDue': ['To pay', 'المطلوب دفعه'],
  'rsv.status.NOT_REQUIRED': ['No payment', 'بدون دفع'],
  'rsv.status.PENDING': ['Waiting for payment', 'بانتظار الدفع'],
  'rsv.status.PAID': ['Paid', 'مدفوع'],
  'rsv.status.AUTHORISED': ['Card hold active', 'الحجز على البطاقة فعّال'],
  'rsv.status.CAPTURED': ['Charged', 'تم الخصم'],
  'rsv.status.VOIDED': ['Hold released', 'أُلغي الحجز على البطاقة'],
  'rsv.status.FAILED': ['Payment failed', 'فشل الدفع'],
  'rsv.status.PARTIALLY_REFUNDED': ['Partly refunded', 'مسترد جزئياً'],
  'rsv.status.REFUNDED': ['Refunded', 'مسترد'],
  'rsv.status.FORFEITED': ['Kept under the terms', 'محتفظ به وفق الشروط'],
  'rsv.hold.REQUESTED': ['Hold requested', 'طُلب الحجز على البطاقة'],
  'rsv.hold.AUTHORISED': ['Hold active', 'الحجز فعّال'],
  'rsv.hold.FAILED': ['Hold failed', 'فشل الحجز على البطاقة'],
  'rsv.hold.CANCELLED': ['Hold cancelled', 'أُلغي طلب الحجز'],
  'rsv.hold.EXPIRED': ['Hold lapsed', 'انتهت صلاحية الحجز'],
  'rsv.hold.RELEASED': ['Hold released', 'أُلغي الحجز على البطاقة'],
  'rsv.hold.CAPTURED': ['Charged', 'تم الخصم'],
  'rsv.hold.PARTIALLY_CAPTURED': ['Partly charged, rest released', 'خُصم جزء وأُلغي الباقي'],
  'rsv.pendingBody': [
    'Finish the payment to get your reservation code.',
    'أكمل الدفع للحصول على رمز الحجز.',
  ],
  'rsv.payTimeLeft': ['Time left to pay', 'الوقت المتبقي للدفع'],
  'rsv.continuePay': ['Continue to payment', 'متابعة الدفع'],
  'rsv.failedBody': [
    'The payment did not go through and nothing was charged. You can try again while time is left.',
    'لم يتم الدفع ولم يُخصم أي مبلغ. يمكنك المحاولة مجدداً ما دام الوقت متاحاً.',
  ],
  'rsv.retry': ['Try payment again', 'أعد محاولة الدفع'],
  'rsv.expiredBody': [
    'The payment was not completed in time. Nothing was charged and the reservation was released.',
    'لم يكتمل الدفع في الوقت المحدد. لم يُخصم أي مبلغ وأُلغي الحجز.',
  ],
  'rsv.cutoffAt': ['Free cancellation until {time}', 'إلغاء مجاني حتى {time}'],
  'rsv.cutoffPassed': ['Free cancellation ended at {time}', 'انتهى الإلغاء المجاني في {time}'],
  'rsv.refunds': ['Refunds', 'المبالغ المستردة'],
  'rsv.refund.REQUESTED': ['Requested', 'مطلوب'],
  'rsv.refund.UNDER_REVIEW': ['Under review', 'قيد المراجعة'],
  'rsv.refund.APPROVED': ['Approved', 'معتمد'],
  'rsv.refund.REJECTED': ['Not approved', 'غير معتمد'],
  'rsv.refund.PROCESSING': ['In progress', 'قيد التنفيذ'],
  'rsv.refund.REFUNDED': ['Refunded', 'تم الاسترداد'],
  'rsv.refund.FAILED': ['Delayed, we are retrying', 'متأخر، نعيد المحاولة'],
  'rsv.kept': ['Kept under the terms', 'محتفظ به وفق الشروط'],
  'rsv.charged': ['Charged', 'المخصوم'],
  'rsv.released': ['Released', 'المُعاد'],
  'rsv.cancelBefore': [
    'You are within the free cancellation time: refundable amounts are returned in full.',
    'أنت ضمن وقت الإلغاء المجاني: تُعاد المبالغ القابلة للاسترداد كاملة.',
  ],
  'rsv.cancelAfter': [
    'The free cancellation time has passed, so the late-cancellation terms apply.',
    'انتهى وقت الإلغاء المجاني، لذا تُطبق شروط الإلغاء المتأخر.',
  ],

  // ---------------------------------------------------------------- phase 4: merchant (RC-20, RC-80)
  'resstatus.PENDING_PAYMENT': ['Waiting for payment', 'بانتظار الدفع'],
  'resstatus.PAYMENT_FAILED': ['Payment failed', 'فشل الدفع'],
  'resevent.STRIKE_RESET': ['Strike reset by DealDash', 'أعادت DealDash ضبط المخالفة'],
  'resevent.PAYMENT_PENDING': ['Waiting for payment', 'بانتظار الدفع'],
  'resevent.PAYMENT_SUCCEEDED': ['Payment received', 'تم استلام الدفع'],
  'resevent.PAYMENT_FAILED': ['Payment failed', 'فشل الدفع'],
  'resevent.REFUND_REQUESTED': ['Refund requested', 'طُلب الاسترداد'],
  'resevent.REFUNDED': ['Refunded', 'تم الاسترداد'],
  'resevent.REFUND_FAILED': ['Refund failed, retrying', 'فشل الاسترداد، تتم إعادة المحاولة'],
  'resevent.FORFEITED': ['Kept under the terms', 'محتفظ به وفق الشروط'],
  'resevent.SETTLED_TO_MERCHANT': ['Settled to you', 'سُوّي لصالحك'],
  'resevent.AUTHORISATION_REQUESTED': ['Card hold requested', 'طُلب الحجز على البطاقة'],
  'resevent.AUTHORISED': ['Card hold approved', 'تمت الموافقة على الحجز'],
  'resevent.AUTHORISATION_FAILED': ['Card hold failed', 'فشل الحجز على البطاقة'],
  'resevent.AUTHORISATION_EXPIRED': ['Card hold lapsed', 'انتهت صلاحية الحجز'],
  'resevent.HOLD_RELEASED': ['Card hold released', 'أُلغي الحجز على البطاقة'],
  'resevent.HOLD_CAPTURED': ['Card hold charged', 'خُصم من الحجز على البطاقة'],
  'mrsv.title': ['Reservation payment', 'الدفع عند الحجز'],
  'mrsv.help': [
    'How customers commit when they reserve. DealDash collects the money for you and keeps only any agreed commission.',
    'طريقة التزام العملاء عند الحجز. تحصّل DealDash المبلغ لصالحك ولا تحتفظ إلا بالعمولة المتفق عليها إن وُجدت.',
  ],
  'mrsv.offNote': [
    'Reservations are off: customers simply visit while the offer lasts.',
    'الحجز متوقف: يزور العملاء الفرع ما دام العرض قائماً.',
  ],
  'mrsv.method': ['Commitment method', 'طريقة الالتزام'],
  'mrsv.method.FREE': ['Free (testing only)', 'مجاني (للاختبار فقط)'],
  'mrsv.method.FULL_PREPAYMENT': ['Full prepayment', 'دفع مسبق كامل'],
  'mrsv.method.DEPOSIT': ['Deposit', 'عربون'],
  'mrsv.method.CARD_PREAUTH': ['Card pre-authorisation', 'حجز مبلغ على البطاقة'],
  'mrsv.methodHelp.FREE': [
    'No payment. Allowed only in development or testing markets.',
    'بدون دفع. مسموح فقط في بيئات التطوير أو الأسواق التجريبية.',
  ],
  'mrsv.methodHelp.FULL_PREPAYMENT': [
    'The customer pays the full deal price when reserving.',
    'يدفع العميل سعر العرض كاملاً عند الحجز.',
  ],
  'mrsv.methodHelp.DEPOSIT': [
    'The customer pays a deposit; your staff credit it to the bill.',
    'يدفع العميل عربوناً، ويخصمه موظفوك من الفاتورة.',
  ],
  'mrsv.methodHelp.CARD_PREAUTH': [
    'An amount is held on the customer’s card; it is charged only under the terms below.',
    'يُحجز مبلغ على بطاقة العميل، ولا يُخصم إلا وفق الشروط أدناه.',
  ],
  'mrsv.amount.FULL_PREPAYMENT': ['Price per unit', 'السعر لكل وحدة'],
  'mrsv.amount.DEPOSIT': ['Deposit per unit', 'العربون لكل وحدة'],
  'mrsv.amount.CARD_PREAUTH': ['Hold per unit', 'المبلغ المحجوز لكل وحدة'],
  'mrsv.depositBy': ['Set the deposit as', 'حدد العربون'],
  'mrsv.depositFixed': ['A fixed amount', 'مبلغ ثابت'],
  'mrsv.depositPercent': ['A share of the price', 'نسبة من السعر'],
  'mrsv.depositPrice': ['Full price per unit', 'السعر الكامل لكل وحدة'],
  'mrsv.depositPct': ['Deposit share (%)', 'نسبة العربون (٪)'],
  'mrsv.depositResult': ['Deposit per unit: {amount}', 'العربون لكل وحدة: {amount}'],
  'mrsv.rangeAmount': ['Allowed: {min} to {max}', 'المسموح: من {min} إلى {max}'],
  'mrsv.maxAmount': ['Up to {max}', 'حتى {max}'],
  'mrsv.refundable': [
    'Refund the deposit if the customer cancels in time',
    'استرداد العربون إذا ألغى العميل في الوقت المحدد',
  ],
  'mrsv.refundableOnly': [
    'Deposits are always refundable when the customer cancels in time.',
    'العربون قابل للاسترداد دائماً عند الإلغاء في الوقت المحدد.',
  ],
  // deposit treatment (founder UAT 2026-10-16)
  'mrsv.depositRefund': ['If the customer cancels', 'إذا ألغى العميل'],
  'mrsv.depositRefund.ANY': [
    'Refundable: returned whenever the customer cancels',
    'قابل للاسترداد: يُعاد متى ألغى العميل',
  ],
  'mrsv.depositRefund.BEFORE_CUTOFF': [
    'Conditionally refundable: returned only if they cancel before the cut-off',
    'قابل للاسترداد بشرط: يُعاد فقط عند الإلغاء قبل الموعد النهائي',
  ],
  'mrsv.depositRefund.NEVER': [
    'Non-refundable: kept even if they cancel early (where permitted)',
    'غير قابل للاسترداد: يُحتفظ به حتى عند الإلغاء المبكر (حيث يُسمح بذلك)',
  ],
  'mrsv.depositCredited': [
    'Credit the deposit toward the customer’s final bill',
    'خصم العربون من الفاتورة النهائية للعميل',
  ],
  'mrsv.depositCreditedHelp': [
    'Untick for a booking fee that is not deducted from the bill. A deposit not used in time is kept either way.',
    'ألغِ التحديد لرسوم حجز لا تُخصم من الفاتورة. يُحتفظ بالعربون في الحالتين إذا لم يُستخدم الحجز في الوقت المحدد.',
  ],
  'rsv.use.DEPOSIT_FEE': [
    'At the branch: this is a booking fee. It is not taken off your bill; you pay your full bill.',
    'في الفرع: هذه رسوم حجز ولا تُخصم من فاتورتك؛ تدفع فاتورتك كاملة.',
  ],
  'rsv.cancelAny.DEPOSIT': [
    'Cancel any time before your reservation ends and your deposit is refunded.',
    'ألغِ في أي وقت قبل انتهاء حجزك ويُسترد العربون.',
  ],
  'rsv.late.DEPOSIT_NOSHOW': [
    'If you do not use the reservation in time, the deposit is kept by the business.',
    'إذا لم تستخدم الحجز في الوقت المحدد، يحتفظ النشاط التجاري بالعربون.',
  ],
  // partner Exclusive Deal builder: reservation mode (founder UAT 2026-10-16)
  'pt.camp.step.reservation': ['Reservation', 'الحجز'],
  'pt.camp.resMode': ['Reservation mode', 'نوع الحجز'],
  'pt.camp.resMode.NONE': ['No reservation (walk-in)', 'بدون حجز (حضور مباشر)'],
  'pt.camp.resMode.FREE': ['Free reservation', 'حجز مجاني'],
  'pt.camp.resMode.PAID': [
    'Paid reservation (secures limited stock)',
    'حجز مدفوع (يضمن الكمية المحدودة)',
  ],
  'pt.camp.resHelp.NONE': [
    'Customers redeem at the branch while the offer lasts; no stock is held for them.',
    'يستخدم العملاء العرض في الفرع طوال مدته؛ لا تُحجز لهم كمية.',
  ],
  'pt.camp.resHelp.FREE': [
    'Only where DealDash policy allows free reservations (testing markets). Otherwise choose a paid reservation.',
    'فقط حيث تسمح سياسة DealDash بالحجز المجاني (أسواق الاختبار). وإلا اختر حجزاً مدفوعاً.',
  ],
  'pt.camp.resHelp.PAID': [
    'The customer pays the amount to secure a unit. Limits come from the merchant’s market policy and are checked when you submit. This is not a voucher purchase.',
    'يدفع العميل المبلغ لضمان وحدة. الحدود من سياسة سوق التاجر وتُراجع عند الإرسال. هذا ليس شراء قسيمة.',
  ],
  'pt.camp.holdMinutes': [
    'Hold length in minutes (empty = DealDash default)',
    'مدة الحجز بالدقائق (فارغ = الافتراضي)',
  ],
  'pt.camp.perCustomer': ['Per customer limit', 'الحد لكل عميل'],
  'mrsv.out.title': ['Paid reservations', 'الحجوزات المدفوعة'],
  'mrsv.out.awaiting': ['Awaiting payment (units held)', 'بانتظار الدفع (وحدات محجوزة)'],
  'mrsv.out.paid': ['Paid', 'مدفوعة'],
  'mrsv.out.holds': ['Card holds', 'مبالغ محجوزة على البطاقة'],
  'mrsv.out.failed': ['Payment failed (units released)', 'فشل الدفع (أُعيدت الوحدات)'],
  'mrsv.out.refunded': ['Refunded or released', 'مستردة أو مُلغاة'],
  'mrsv.out.kept': ['Kept under the terms', 'محتفظ بها وفق الشروط'],
  'mrsv.out.note': [
    'Units waiting for payment are held for the payment window only, then released automatically. Amounts are in the Reservations tab.',
    'تُحجز الوحدات بانتظار الدفع خلال مهلة الدفع فقط ثم تُعاد تلقائياً. المبالغ في تبويب الحجوزات.',
  ],
  'srsv.DEPOSIT_FEE': [
    'Booking fee {amount}, do not deduct it from the bill',
    'رسوم حجز {amount}، لا تخصمها من الفاتورة',
  ],
  'mrsv.nonRefundableNote': [
    'A non-refundable deposit is shown to the customer before they pay.',
    'يُعرض العربون غير القابل للاسترداد على العميل قبل الدفع.',
  ],
  'mrsv.cutoff': [
    'Free cancellation cut-off (minutes before the hold ends)',
    'آخر موعد للإلغاء المجاني (دقائق قبل انتهاء الحجز)',
  ],
  'mrsv.cutoffHelp': ['Allowed: {min} to {max} minutes.', 'المسموح: من {min} إلى {max} دقيقة.'],
  'mrsv.refundPct': [
    'Refunded on a late cancellation or not completed (%)',
    'المسترد عند الإلغاء المتأخر أو عدم إكمال الحجز (٪)',
  ],
  'mrsv.refundPctHelp': [
    'Allowed: {min}% to {max}%. Empty = {def}%.',
    'المسموح: من {min}٪ إلى {max}٪. فارغ = {def}٪.',
  ],
  'mrsv.releasePct': [
    'Released, not charged, on a late cancellation or not completed (%)',
    'المُعاد دون خصم عند الإلغاء المتأخر أو عدم إكمال الحجز (٪)',
  ],
  'mrsv.releasePctHelp': [
    '100% = nothing is charged. A lower share needs DealDash to allow partial charges.',
    '100٪ = لا يُخصم شيء. النسبة الأقل تتطلب سماح DealDash بالخصم الجزئي.',
  ],
  'mrsv.depositLate': [
    'A late cancellation or not completed: the deposit is kept for you.',
    'عند الإلغاء المتأخر أو عدم إكمال الحجز: يُحتفظ بالعربون لصالحك.',
  ],
  'mrsv.onRedemption.RELEASE': [
    'At redemption the hold is released; the customer pays at the till.',
    'عند الاستخدام يُلغى الحجز ويدفع العميل عند الكاشير.',
  ],
  'mrsv.onRedemption.CAPTURE': [
    'At redemption the held amount is charged as part payment.',
    'عند الاستخدام يُخصم المبلغ المحجوز كدفعة جزئية.',
  ],
  'mrsv.commission': [
    'DealDash commission on reservation money kept for you: {pct}%.',
    'عمولة DealDash على مبالغ الحجز المحتفظ بها لصالحك: {pct}٪.',
  ],
  'mrsv.extraFee': [
    'Your agreement also adds the per-redemption fee on paid reservations.',
    'اتفاقيتك تضيف أيضاً رسوم الاستخدام على الحجوزات المدفوعة.',
  ],
  'mrsv.limitsFrom': [
    'Limits are set by DealDash for your market and business.',
    'تحدد DealDash هذه الحدود لسوقك ونشاطك التجاري.',
  ],
  'mrsv.fin.title': ['Reservation money', 'مبالغ الحجوزات'],
  'mrsv.fin.note': [
    'Totals for the reservations listed below.',
    'المجاميع للحجوزات المعروضة أدناه.',
  ],
  'mrsv.fin.collected': ['Collected', 'المحصّل'],
  'mrsv.fin.refunded': ['Refunded', 'المسترد'],
  'mrsv.fin.pending': ['Refunds pending', 'استردادات معلّقة'],
  'mrsv.fin.kept': ['Kept for you', 'المحتفظ به لك'],
  'mrsv.fin.fee': ['DealDash commission', 'عمولة DealDash'],
  'mrsv.fin.net': ['Net to you', 'الصافي لك'],
  'mrsv.fin.holds': ['Active card holds', 'حجوزات البطاقات الفعالة'],
  'mrsv.col.payment': ['Payment', 'الدفع'],
  'mrsv.details': ['Payment details', 'تفاصيل الدفع'],
  'mrsv.hideDetails': ['Hide details', 'إخفاء التفاصيل'],
  'mrsv.amount': ['Amount', 'المبلغ'],
  'mrsv.redemptionFee': ['Per-redemption fee', 'رسوم الاستخدام'],
  'mrsv.redemptionFeeNone': [
    'Not charged: the reservation commission is the only fee',
    'لم تُحتسب: عمولة الحجز هي الرسوم الوحيدة',
  ],
  'mrsv.captured': ['Charged from hold', 'المخصوم من الحجز'],
  'mrsv.released': ['Released', 'المُعاد'],

  // ---------------------------------------------------------------- phase 4: staff (RC-60, read-only)
  'srsv.title': ['Payment', 'الدفع'],
  'srsv.FULL_PREPAYMENT': ['Paid in full', 'مدفوع بالكامل'],
  'srsv.DEPOSIT': ['Deposit {amount}, credit it to the bill', 'عربون {amount}، اخصمه من الفاتورة'],
  'srsv.CARD_PREAUTH': ['Card hold {amount}', 'حجز {amount} على البطاقة'],
  'srsv.paidAmount': ['Amount paid: {amount}', 'المبلغ المدفوع: {amount}'],
  'srsv.holdRelease': [
    'The hold is released when you redeem; the customer pays at the till.',
    'يُلغى الحجز عند الاستخدام ويدفع العميل عند الكاشير.',
  ],
  'srsv.notPaid': [
    'Payment not completed. Do not honour this reservation.',
    'لم يكتمل الدفع. لا تقبل هذا الحجز.',
  ],
  'srsv.refunded': ['Refunded {amount}', 'مسترد {amount}'],
  'srsv.kept': ['Kept {amount}', 'محتفظ به {amount}'],
  'srsv.fixed': [
    'Payment terms are fixed. Staff cannot change them.',
    'شروط الدفع ثابتة ولا يمكن للموظفين تغييرها.',
  ],

  // ---------------------------------------------------------------- phase 4: admin reservation policy (RC-04..RC-12, RC-52, RC-74, RC-96)
  'nav.reservationPolicy': ['Reservation policy', 'سياسة الحجز'],
  'apol.intro': [
    'How customers commit to reservations, by market, category and merchant. Changes are proposed with a reason and approved by a second person.',
    'طريقة التزام العملاء بالحجوزات حسب السوق والفئة والتاجر. تُقترح التغييرات مع سبب ويعتمدها شخص آخر.',
  ],
  'apol.scope': ['Edit', 'تعديل'],
  'apol.scope.baseline': ['Platform default', 'الإعداد الافتراضي للمنصة'],
  'apol.scope.market': ['Market default', 'الإعداد الافتراضي للسوق'],
  'apol.scope.category': ['Category override', 'استثناء الفئة'],
  'apol.scope.merchant': ['Merchant override', 'استثناء التاجر'],
  'apol.market': ['Market', 'السوق'],
  'apol.category': ['Category', 'الفئة'],
  'apol.merchant': ['Merchant', 'التاجر'],
  'apol.merchantSearch': ['Search merchants', 'ابحث عن التجار'],
  'apol.choose': ['Choose…', 'اختر…'],
  'apol.inherit': ['Inherit', 'وراثة'],
  'apol.inheritHelp': [
    'Fields left on “Inherit” take the value from the level below (merchant > category > market > platform default).',
    'الحقول المتروكة على «وراثة» تأخذ قيمتها من المستوى الأدنى (التاجر > الفئة > السوق > الافتراضي).',
  ],
  'apol.override': ['Override', 'استثناء'],
  'apol.effective': ['Effective policy', 'السياسة المطبقة'],
  'apol.effectiveHelp': [
    'What a deal in this market (and category / merchant, if chosen) gets now, and where each value comes from.',
    'ما ينطبق الآن على عرض في هذا السوق (والفئة / التاجر إن اختيرا)، ومصدر كل قيمة.',
  ],
  'apol.from': ['from {level}', 'من {level}'],
  'apol.level.BASELINE': ['platform default', 'الافتراضي'],
  'apol.level.MARKET': ['market', 'السوق'],
  'apol.level.CATEGORY': ['category', 'الفئة'],
  'apol.level.MERCHANT': ['merchant', 'التاجر'],
  'apol.problems': ['These values conflict: {list}', 'هذه القيم متعارضة: {list}'],
  'apol.freeAllowedNow': ['Free reservation here: allowed', 'الحجز المجاني هنا: مسموح'],
  'apol.freeBlockedNow': ['Free reservation here: not allowed', 'الحجز المجاني هنا: غير مسموح'],
  'apol.freeNote': [
    'Free reservation is honoured only on development / test machines or in a market whose status is Testing. Live markets never offer it.',
    'لا يُطبق الحجز المجاني إلا في بيئات التطوير والاختبار أو في سوق حالته «تجريبي». الأسواق الفعلية لا تتيحه أبداً.',
  ],
  'apol.free.null': ['Environment default', 'حسب البيئة'],
  'apol.free.true': ['Allowed (test markets only)', 'مسموح (للأسواق التجريبية فقط)'],
  'apol.free.false': ['Not allowed', 'غير مسموح'],
  'apol.sec.methods': ['Methods', 'الطرق'],
  'apol.sec.amounts': ['Amounts', 'المبالغ'],
  'apol.sec.cancel': ['Cancellation and refunds', 'الإلغاء والاسترداد'],
  'apol.sec.preauth': ['Card holds', 'الحجز على البطاقة'],
  'apol.sec.fees': ['Fees', 'الرسوم'],
  'apol.sec.finance': ['Finance alerts', 'تنبيهات المالية'],
  'apol.f.freeAllowed': ['Free reservation', 'الحجز المجاني'],
  'apol.f.allowedMethods': ['Methods merchants may choose', 'الطرق المتاحة للتجار'],
  'apol.f.depositMinMinor': ['Smallest deposit', 'أقل عربون'],
  'apol.f.depositMaxMinor': ['Largest deposit', 'أكبر عربون'],
  'apol.f.nonRefundableDepositAllowed': [
    'Merchants may make deposits non-refundable',
    'يمكن للتجار جعل العربون غير قابل للاسترداد',
  ],
  'apol.f.preauthMaxMinor': ['Largest card hold', 'أكبر مبلغ حجز على البطاقة'],
  'apol.f.cutoffMinMinutes': ['Shortest cancellation cut-off (min)', 'أقصر مهلة إلغاء (دقيقة)'],
  'apol.f.cutoffMaxMinutes': ['Longest cancellation cut-off (min)', 'أطول مهلة إلغاء (دقيقة)'],
  'apol.f.paymentWindowMinutes': ['Time to pay (min)', 'مهلة الدفع (دقيقة)'],
  'apol.f.prepaymentRefundMinPercent': [
    'Late-cancellation refund, lowest (%)',
    'أدنى نسبة استرداد عند الإلغاء المتأخر (٪)',
  ],
  'apol.f.prepaymentRefundMaxPercent': [
    'Late-cancellation refund, highest (%)',
    'أعلى نسبة استرداد عند الإلغاء المتأخر (٪)',
  ],
  'apol.f.prepaymentRefundDefaultPercent': [
    'Late-cancellation refund, default (%)',
    'نسبة الاسترداد الافتراضية عند الإلغاء المتأخر (٪)',
  ],
  'apol.f.commissionBps': ['DealDash commission (basis points)', 'عمولة DealDash (نقاط أساس)'],
  'apol.f.additionalRedemptionFee': [
    'Also charge the per-redemption fee on paid reservations',
    'احتساب رسوم الاستخدام أيضاً على الحجوزات المدفوعة',
  ],
  'apol.f.preauthImmediateCapture': [
    'Charge the hold as soon as it is approved',
    'خصم المبلغ المحجوز فور الموافقة',
  ],
  'apol.f.preauthPartialCaptureAllowed': [
    'Allow charging part of a hold',
    'السماح بخصم جزء من المبلغ المحجوز',
  ],
  'apol.f.preauthOnRedemption': ['At redemption', 'عند الاستخدام'],
  'apol.f.preauthOnRedemption.RELEASE': ['Release the hold', 'إلغاء الحجز'],
  'apol.f.preauthOnRedemption.CAPTURE': ['Charge the hold', 'خصم المبلغ المحجوز'],
  'apol.f.captureFailureAlertThreshold': [
    'Refused charges before a finance alert',
    'عدد مرات رفض الخصم قبل تنبيه المالية',
  ],
  'apol.extraFeeWarn': [
    'Only as a merchant override, backed by a signed agreement that explicitly adds the per-redemption fee.',
    'فقط كاستثناء لتاجر بموجب اتفاقية موقعة تضيف رسوم الاستخدام صراحةً.',
  ],
  'apol.yes': ['Yes', 'نعم'],
  'apol.no': ['No', 'لا'],
  'apol.minorHelp': ['In {currency}.', 'بعملة {currency}.'],
  'apol.noOverride': [
    'No override yet: every field is inherited.',
    'لا يوجد استثناء بعد: كل الحقول موروثة.',
  ],
  'apol.removeOverride': ['Remove this override', 'إزالة هذا الاستثناء'],
  'apol.pending': [
    'A change to the reservation policy is waiting for approval in Rules and controls.',
    'يوجد تغيير على سياسة الحجز بانتظار الاعتماد في «القواعد والضوابط».',
  ],
  'apol.noshow': ['Not-completed reservation limits', 'حدود الحجوزات غير المكتملة'],
  'apol.noshowHelp': [
    'Applies to free and paid reservations. A late cancellation is never counted.',
    'تنطبق على الحجوزات المجانية والمدفوعة. الإلغاء المتأخر لا يُحتسب أبداً.',
  ],
  'apol.noshow.threshold': [
    'Not completed before blocking',
    'عدد الحجوزات غير المكتملة قبل الإيقاف',
  ],
  'apol.noshow.windowDays': ['Counted over (days)', 'تُحتسب خلال (أيام)'],
  'apol.noshow.blockDays': [
    'Block new reservations for (days)',
    'إيقاف الحجوزات الجديدة لمدة (أيام)',
  ],
  'apol.strikes': ['Strike reset', 'إعادة ضبط المخالفات'],
  'apol.strikesHelp': [
    'Reset a customer’s counted strikes, with a reason, from the reservation tools (restrictions or lookup).',
    'أعد ضبط مخالفات العميل مع ذكر السبب من أدوات الحجز (القيود أو البحث).',
  ],
  'apol.openTools': ['Open reservation tools', 'فتح أدوات الحجز'],
  'ah.resetStrikes': ['Reset strikes', 'إعادة ضبط المخالفات'],
  'ah.resetStrike': ['Reset strike', 'إعادة ضبط المخالفة'],
  'ah.strikesReset': ['Strikes reset: {n}', 'تمت إعادة ضبط المخالفات: {n}'],
  'ah.refundsTab': ['Failed refunds', 'الاستردادات المتعثرة'],
  'ah.refundsEmpty': ['No failed reservation refunds', 'لا توجد استردادات حجز متعثرة'],
  'ah.refundRetry': ['Retry refund', 'إعادة محاولة الاسترداد'],
  'ah.refundRetried': ['Refund sent again', 'أُعيد إرسال الاسترداد'],
  'ah.attempts': ['Attempts: {n}', 'المحاولات: {n}'],
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
