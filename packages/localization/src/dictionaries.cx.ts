/**
 * Customer experience gap closure (2026-10-16): entry screen, "Browse offers by", the merchant page actions, Exclusive Deal
 * scarcity and timing, the pay-and-reserve summary, the reservation ticket guidance and the My Deals statuses.
 * Pairs are [English, Arabic]; the Arabic is a working translation that needs native review before launch. Urdu: dictionaries.ur.ts.
 */
const CX = {
  // entry
  'cx.entry.title': ['Deals near you, ready when you are', 'عروض قريبة منك، جاهزة متى أردت'],
  'cx.entry.body': [
    'Sign in to reserve, buy vouchers and unlock card and employer offers.',
    'سجّل الدخول للحجز وشراء القسائم وفتح عروض البطاقات وجهات العمل.',
  ],
  'cx.entry.skip': ['Skip for now', 'تخطَّ الآن'],
  'cx.entry.guestNote': [
    'Browse as a guest. We ask you to sign in only when you reserve or buy.',
    'تصفّح كزائر. نطلب تسجيل الدخول فقط عند الحجز أو الشراء.',
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
