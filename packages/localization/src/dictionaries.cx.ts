/**
 * Customer experience gap closure (2026-10-16): entry screen, "Browse offers by", the merchant page actions, Exclusive Deal
 * scarcity and timing, the pay-and-reserve summary, the reservation ticket guidance and the My Deals statuses.
 * Pairs are [English, Arabic]; the Arabic is a working translation that needs native review before launch. Urdu: dictionaries.ur.ts.
 */
const CX = {
  // entry
  'cx.entry.skip': ['Skip for now', 'تخطَّ الآن'],
  'cx.entry.guestNote': [
    'Browse as a guest. We ask you to sign in only when you reserve or buy.',
    'تصفّح كزائر. نطلب تسجيل الدخول فقط عند الحجز أو الشراء.',
  ],
  'cx.entry.welcome': ['Welcome', 'أهلاً بك'],
  'cx.entry.tagline': ['Discover deals. Watch. Get rewarded.', 'اكتشف العروض. شاهد. واربح.'],
  'cx.entry.sub': [
    'Sign in to see offers for your cards and keep your saved deals.',
    'سجّل الدخول لرؤية عروض بطاقاتك والاحتفاظ بعروضك المحفوظة.',
  ],
  'cx.entry.phone': ['Continue with phone number', 'المتابعة برقم الجوال'],
  'cx.entry.terms': [
    'By continuing you agree to the Terms and Privacy Policy.',
    'بالمتابعة فإنك توافق على الشروط وسياسة الخصوصية.',
  ],
  'cx.signin.reserve': ['Sign in to reserve this offer.', 'سجّل الدخول لحجز هذا العرض.'],
  'cx.signin.follow': [
    'Sign in to follow this business.',
    'سجّل الدخول لمتابعة هذا النشاط التجاري.',
  ],
  // browse offers by
  'cx.browse.title': ['Browse offers by', 'تصفّح العروض حسب'],
  'cx.browse.all': ['All', 'الكل'],
  'cx.browse.card': ['By card', 'حسب البطاقة'],
  'cx.browse.employer': ['By employer', 'حسب جهة العمل'],
  'cx.browse.brand': ['By brand', 'حسب العلامة'],
  'cx.browse.cardHint': [
    'Offers for bank cards and card schemes',
    'عروض لبطاقات البنوك وشبكات البطاقات',
  ],
  'cx.browse.employerHint': ['Offers for verified employees', 'عروض لموظفي الجهات الموثّقة'],
  'cx.browse.addCard': ['Add your card to unlock more', 'أضف بطاقتك لفتح المزيد'],
  'cx.browse.addEmployer': ['Verify your employer to unlock more', 'وثّق جهة عملك لفتح المزيد'],
  'cx.browse.hot': ['Exclusive deals', 'عروض حصرية'],
  'cx.browse.live': ['Live deals', 'عروض مباشرة'],
  'cx.browse.vouchers': ['Vouchers', 'القسائم'],
  'cx.browse.none': ['No offers here yet', 'لا توجد عروض هنا بعد'],
  'cx.brand.offers': ['{n} offers', '{n} عروض'],
  'cx.browse.forYou': ['Offers for you', 'عروض لك'],
  'cx.browse.unlockCard': ['Unlock with another card', 'افتح ببطاقة أخرى'],
  'cx.browse.unlockEmployer': ['Unlock with your employer', 'افتح عبر جهة عملك'],
  // merchant
  'cx.m.follow': ['Follow', 'متابعة'],
  'cx.m.following': ['Following', 'تتابعه'],
  'cx.m.followers': ['{n} followers', '{n} متابعين'],
  'cx.m.whatsapp': ['WhatsApp', 'واتساب'],
  'cx.m.share': ['Share', 'مشاركة'],
  'cx.m.shareText': ['Offers at {merchant} on DealDash', 'عروض {merchant} على DealDash'],
  'cx.m.copied': ['Link copied', 'تم نسخ الرابط'],
  'cx.m.reviews': ['{n} reviews', '{n} تقييمات'],
  'cx.m.noRating': ['No ratings yet', 'لا تقييمات بعد'],
  // exclusive deal detail
  'cx.hot.starts': ['Starts', 'يبدأ'],
  'cx.hot.ends': ['Ends', 'ينتهي'],
  'cx.hot.left': ['{n} of {total} left', 'متبقٍ {n} من {total}'],
  'cx.hot.ffs': ['First come, first served', 'الأولوية لمن يحجز أولاً'],
  'cx.hot.openTitle': ['Open to everyone', 'متاح للجميع'],
  'cx.hot.openBody': ['No card or employer needed.', 'لا يلزم بطاقة أو جهة عمل.'],
  'cx.hot.reqTitle': ['Who can use it', 'من يمكنه الاستخدام'],
  'cx.hot.photos': ['Photos', 'الصور'],
  'cx.hot.photoN': ['Photo {i} of {n}', 'الصورة {i} من {n}'],
  'cx.hot.verified': ['Verified: {name}', 'موثّق: {name}'],
  'cx.hot.verifiedEmployer': [
    'Your verified employer benefit applies to this offer.',
    'تنطبق ميزة جهة عملك الموثّقة على هذا العرض.',
  ],
  'cx.hot.verifiedCard': ['Your card qualifies for this offer.', 'بطاقتك مؤهلة لهذا العرض.'],
  'cx.hot.away': ['{d} away', 'على بعد {d}'],
  'cx.hot.fromBranch': ['from {place}', 'من {place}'],
  'cx.hot.fromMerchant': ['From {merchant}', 'من {merchant}'],
  'cx.hot.media': ['Video and photos from the merchant', 'فيديو وصور من التاجر'],
  'cx.hot.photosN': ['Photos ({n})', 'الصور ({n})'],
  'cx.hot.before': ['Before you go', 'قبل أن تذهب'],
  'cx.hot.video': ['Video', 'فيديو'],
  'cx.hot.earn': ['Watch to earn up to {n} points', 'شاهد واربح حتى {n} نقطة'],
  'cx.pay.tab': ['Payments', 'المدفوعات'],
  'cx.pay.totalPaid': ['Total paid', 'إجمالي المدفوع'],
  'cx.pay.refundedTotal': ['Refunded', 'المسترد'],
  'cx.pay.note': [
    'Every reservation payment, card hold and voucher you pay for is listed here.',
    'تظهر هنا كل مدفوعات الحجوزات والمبالغ المحجوزة على البطاقة والقسائم التي تدفع ثمنها.',
  ],
  'cx.pay.all': ['All payments', 'كل المدفوعات'],
  'cx.pay.empty': ['No payments yet', 'لا توجد مدفوعات بعد'],
  'cx.pay.kindReservation': ['Reservation', 'حجز'],
  'cx.pay.kindVoucher': ['Voucher', 'قسيمة'],
  'cx.pay.st.HELD': ['Held until redeemed', 'محجوز حتى الاستخدام'],
  'cx.pay.st.CREDITED': ['Credited to bill', 'خُصم من الفاتورة'],
  'cx.pay.st.USED': ['Used', 'مستخدم'],
  'cx.pay.ord.PENDING_PAYMENT': ['Waiting for payment', 'بانتظار الدفع'],
  'cx.pay.ord.PAID': ['Paid', 'مدفوع'],
  'cx.pay.ord.FAILED': ['Payment failed', 'فشل الدفع'],
  'cx.pay.ord.CANCELLED': ['Cancelled', 'ملغى'],
  'cx.pay.ord.EXPIRED': ['Not completed', 'لم يكتمل'],
  'cx.pay.qty': ['Quantity', 'الكمية'],
  'cx.pay.perCustomer': ['Up to {n} per customer', 'حتى {n} لكل عميل'],
  'cx.pay.less': ['One fewer', 'أقل بواحد'],
  'cx.pay.more': ['One more', 'أكثر بواحد'],
  // pay and reserve
  'cx.pay.offer': ['Offer', 'العرض'],
  'cx.pay.method': ['Payment method', 'طريقة الدفع'],
  'cx.pay.methodValue': ['Card, on the secure payment page', 'بطاقة، في صفحة الدفع الآمنة'],
  'cx.pay.charged': ['Charged now', 'يُخصم الآن'],
  'cx.pay.held': ['Held on your card', 'يُحجز على بطاقتك'],
  // ticket
  'cx.t.valid': ['Valid', 'صالح'],
  'cx.t.howTitle': ['How to use it', 'طريقة الاستخدام'],
  'cx.t.step1': [
    'Go to {merchant} while your reservation is valid.',
    'توجّه إلى {merchant} ما دام حجزك صالحاً.',
  ],
  'cx.t.step2': [
    'Show the QR or code to staff before you order.',
    'اعرض رمز QR أو الرمز للموظف قبل الطلب.',
  ],
  'cx.t.step3': ['Staff check your reservation.', 'يتحقق الموظف من حجزك.'],
  'cx.t.step4.FREE': [
    'Pay at the till as usual, with the offer applied.',
    'ادفع عند الكاشير كالمعتاد مع تطبيق العرض.',
  ],
  'cx.t.step4.FULL_PREPAYMENT': [
    'Your paid offer is applied; nothing more to pay for it.',
    'يُطبَّق عرضك المدفوع؛ لا شيء إضافي لدفعه مقابله.',
  ],
  'cx.t.step4.DEPOSIT': [
    'Your deposit is taken off the bill; pay the rest at the till.',
    'يُخصم العربون من الفاتورة؛ ادفع الباقي عند الكاشير.',
  ],
  'cx.t.step4.CARD_PREAUTH': [
    'The card hold is handled as your terms say; pay at the till.',
    'يُعالَج الحجز على البطاقة وفق شروطك؛ ادفع عند الكاشير.',
  ],
  'cx.t.terms': ['View terms', 'عرض الشروط'],
  'cx.t.validFor': ['Reservation valid for', 'الحجز صالح لمدة'],
  'cx.t.show': ['Show this to staff before you order.', 'اعرض هذا للموظف قبل الطلب.'],
  'cx.t.paid.FULL_PREPAYMENT': ['Paid: {amount}.', 'المدفوع: {amount}.'],
  'cx.t.paid.DEPOSIT': [
    'Deposit paid: {amount}, credited to your bill.',
    'العربون المدفوع: {amount}، يُخصم من فاتورتك.',
  ],
  'cx.t.paid.CARD_PREAUTH': ['Held on your card: {amount}.', 'المحجوز على بطاقتك: {amount}.'],
  'cx.t.directions': ['Get directions', 'الاتجاهات'],
  'cx.t.done': ['Done', 'تم'],
  'cx.row.reservation': ['Reservation', 'حجز'],
  'cx.row.paid': ['Paid {amount}', 'مدفوع {amount}'],
  'cx.row.held': ['Held {amount}', 'محجوز {amount}'],
  'cx.row.validFor': ['Reservation valid for', 'الحجز صالح لمدة'],
  // my deals statuses
  'cx.st.RESERVED': ['Reserved', 'محجوز'],
  'cx.st.ACTIVE': ['Active', 'فعّال'],
  'cx.st.USED': ['Used', 'مستخدم'],
  'cx.st.EXPIRED': ['Expired', 'منتهي'],
  'cx.st.CANCELLED': ['Cancelled', 'ملغى'],
  'cx.st.REFUNDED': ['Refunded', 'مسترد'],
  'cx.st.PAYMENT_FAILED': ['Payment failed', 'فشل الدفع'],
  'cx.row.expires': ['Expires {time}', 'ينتهي {time}'],
  'cx.row.pay': ['Complete payment', 'أكمل الدفع'],
} as const satisfies Record<string, readonly [string, string]>;

type CxPairs = typeof CX;
export type CxKey = keyof CxPairs;
const pick = (index: 0 | 1) =>
  Object.fromEntries(Object.entries(CX).map(([k, v]) => [k, v[index]])) as Record<CxKey, string>;
export const enCx = pick(0);
export const arCx = pick(1);
