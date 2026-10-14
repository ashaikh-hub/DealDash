/**
 * Customer "My benefits" (Business Rules §5 EL, §6 EM, §7 BC). Wording rules: an employer is "verified" (a work-email code proves
 * it, EM-25); a card is "added" / "matched", never "verified" (BC-04); offers that need a card say the card is shown at the merchant
 * (BC-09 / BC-10). Pairs are [English, Arabic]; the Arabic is a working translation that needs native review before launch (B5).
 */
const BEN = {
  'profile.benefits': ['My benefits', 'مزاياي'],
  'ben.title': ['My benefits', 'مزاياي'],
  'ben.sub': [
    'Link your employer and add your cards to unlock offers made for you.',
    'اربط جهة عملك وأضف بطاقاتك لفتح العروض المخصصة لك.',
  ],
  'ben.signInTitle': ['Sign in to see your benefits', 'سجّل الدخول لترى مزاياك'],
  'ben.signInBody': [
    'Your employer and cards unlock offers made for you.',
    'جهة عملك وبطاقاتك تفتح لك عروضاً مخصصة.',
  ],
  'ben.loadError': ['We could not load your benefits.', 'تعذّر تحميل مزاياك.'],

  // employer
  'ben.employer.title': ['Employer', 'جهة العمل'],
  'ben.employer.none': [
    'Add your employer to unlock offers for its staff.',
    'أضف جهة عملك لفتح العروض المخصصة لموظفيها.',
  ],
  'ben.employer.add': ['Add employer', 'إضافة جهة العمل'],
  'ben.employer.renew': ['Confirm again', 'التأكيد مجدداً'],
  'ben.employer.change': ['Change employer', 'تغيير جهة العمل'],
  'ben.employer.remove': ['Remove employer', 'إزالة جهة العمل'],
  'ben.employer.removeConfirm': [
    'Offers for its staff will lock. Anything you already reserved or bought stays valid.',
    'ستُقفل العروض المخصصة لموظفيها. ما حجزته أو اشتريته سابقاً يبقى صالحاً.',
  ],
  'ben.employer.verifiedOn': ['Verified on {date}', 'تم التحقق في {date}'],
  'ben.employer.until': ['Valid until {date}', 'صالح حتى {date}'],
  'ben.employer.renewBy': ['Renew by {date}', 'جدّد قبل {date}'],
  'ben.employer.renewFrom': [
    'Confirm your work email again before {date} to keep these offers.',
    'أكّد بريد العمل مجدداً قبل {date} لتحتفظ بهذه العروض.',
  ],
  'ben.employer.grace': [
    'Renewal is due. Your staff offers keep working until {date}. Confirm your work email to keep them.',
    'حان موعد التجديد. تبقى عروض الموظفين متاحة لك حتى {date}. أكّد بريد العمل لتحتفظ بها.',
  ],
  'ben.employer.expiredHelp': [
    'Confirm your work email again to unlock your staff offers.',
    'أكّد بريد العمل مجدداً لفتح عروض الموظفين.',
  ],
  'ben.status.PENDING': ['Waiting for your code', 'بانتظار الرمز'],
  'ben.status.VERIFIED': ['Verified employee', 'موظف موثّق'],
  'ben.status.REVERIFICATION_DUE': ['Renewal due', 'حان موعد التجديد'],
  'ben.status.EXPIRED': ['Expired', 'منتهي'],
  'ben.status.FAILED': ['Not confirmed', 'لم يتم التأكيد'],
  'ben.status.REVOKED': ['Removed', 'تمت الإزالة'],

  // cards
  'ben.cards.title': ['Cards', 'البطاقات'],
  'ben.cards.none': [
    'Add the cards you hold to see offers for them. We never ask for card numbers.',
    'أضف البطاقات التي تملكها لترى عروضها. لا نطلب أرقام البطاقات أبداً.',
  ],
  'ben.cards.add': ['Add a card', 'إضافة بطاقة'],
  'ben.cards.added': ['Added', 'مضافة'],
  'ben.cards.remove': ['Remove', 'إزالة'],
  'ben.cards.limit': [
    'You have added the most cards allowed ({n}). Remove one to add another.',
    'أضفت الحد الأقصى من البطاقات ({n}). أزل بطاقة لإضافة أخرى.',
  ],
  'ben.cards.note': [
    'Cards you add are matched to offers. When an offer needs a card, show it at the merchant.',
    'البطاقات التي تضيفها تُطابق مع العروض. عندما يتطلب العرض بطاقة، أظهرها لدى التاجر.',
  ],

  // sections
  'ben.tabs': ['Benefit sections', 'أقسام المزايا'],
  'ben.tab.unlocked': ['Unlocked', 'مفتوحة'],
  'ben.tab.available': ['To unlock', 'للفتح'],
  'ben.tab.active': ['In use', 'قيد الاستخدام'],
  'ben.tab.used': ['Used', 'مستخدمة'],
  'ben.tab.expired': ['Expired', 'منتهية'],
  'ben.tab.history': ['History', 'السجل'],
  'ben.via': ['Benefit from {partner}', 'ميزة من {partner}'],
  'ben.empty.unlocked': ['No unlocked benefits yet', 'لا توجد مزايا مفتوحة بعد'],
  'ben.empty.unlockedBody': [
    'Add your employer or a card to unlock offers made for you.',
    'أضف جهة عملك أو بطاقة لفتح العروض المخصصة لك.',
  ],
  'ben.empty.available': ['Nothing more to unlock right now', 'لا شيء آخر للفتح حالياً'],
  'ben.empty.availableBody': [
    'New partner offers appear here when they go live in your city.',
    'تظهر عروض الشركاء الجديدة هنا عند إطلاقها في مدينتك.',
  ],
  'ben.empty.active': ['No benefits in use', 'لا توجد مزايا قيد الاستخدام'],
  'ben.empty.used': ['No benefits used yet', 'لم تستخدم أي ميزة بعد'],
  'ben.empty.expired': ['No expired benefits', 'لا توجد مزايا منتهية'],
  'ben.empty.history': ['No benefit activity yet', 'لا يوجد نشاط للمزايا بعد'],
  'ben.use.RESERVATION': ['Reservation', 'حجز'],
  'ben.use.VOUCHER': ['Voucher', 'قسيمة'],
  'ben.use.HELD': ['Reserved', 'محجوز'],
  'ben.use.ACTIVE': ['Ready to use', 'جاهزة للاستخدام'],
  'ben.use.REDEEMED': ['Used', 'مستخدم'],
  'ben.use.EXPIRED': ['Expired', 'منتهي'],
  'ben.use.CANCELLED': ['Cancelled', 'ملغى'],
  'ben.use.REFUNDED': ['Refunded', 'مسترد'],
  'ben.use.VOIDED': ['Void', 'ملغاة'],
  'ben.use.until': ['Use by {date}', 'استخدم قبل {date}'],
  'ben.use.on': ['Used on {date}', 'استُخدم في {date}'],

  // history and notifications
  'ben.ev.EMPLOYER_CODE_SENT': ['Code sent to confirm {name}', 'أُرسل رمز لتأكيد {name}'],
  'ben.ev.EMPLOYER_VERIFIED': ['{name} confirmed as your employer', 'تم تأكيد {name} كجهة عملك'],
  'ben.ev.EMPLOYER_RENEWAL_DUE': [
    'Renew your {name} staff benefits: confirm your work email',
    'جدّد مزايا موظفي {name}: أكّد بريد العمل',
  ],
  'ben.ev.EMPLOYER_EXPIRED': [
    'Your {name} staff benefits have expired',
    'انتهت مزايا موظفي {name} الخاصة بك',
  ],
  'ben.ev.EMPLOYER_REMOVED': ['You removed {name}', 'أزلت {name}'],
  'ben.ev.CARD_ADDED': ['{name} added', 'تمت إضافة {name}'],
  'ben.ev.CARD_REMOVED': ['{name} removed', 'تمت إزالة {name}'],
  'notif.BENEFIT_UPDATED': ['Your benefits were updated', 'تم تحديث مزاياك'],

  // add sheets
  'ben.sheet.employerTitle': ['Add your employer', 'أضف جهة عملك'],
  'ben.sheet.chooseEmployer': ['Your employer', 'جهة عملك'],
  'ben.sheet.notListed': [
    'Only DealDash partner employers can be added.',
    'يمكن إضافة جهات العمل الشريكة لديل داش فقط.',
  ],
  'ben.sheet.noEmployers': [
    'No partner employers are available in your city yet.',
    'لا توجد جهات عمل شريكة في مدينتك بعد.',
  ],
  'ben.sheet.email': ['Work email', 'بريد العمل'],
  'ben.sheet.emailHelp': [
    'Use your own official work email. We send a code to it and only ever show it masked.',
    'استخدم بريد عملك الرسمي الخاص بك. نرسل إليه رمزاً ولا نعرضه إلا مخفياً.',
  ],
  'ben.sheet.sendCode': ['Send code', 'إرسال الرمز'],
  'ben.sheet.codeSent': [
    'We sent a 6-digit code to {email}',
    'أرسلنا رمزاً من 6 أرقام إلى {email}',
  ],
  'ben.sheet.code': ['Code', 'الرمز'],
  'ben.sheet.verify': ['Confirm', 'تأكيد'],
  'ben.sheet.resend': ['Use a different email', 'استخدام بريد آخر'],
  'ben.sheet.cardTitle': ['Add a card', 'أضف بطاقة'],
  'ben.sheet.chooseCard': ['Choose a card you hold', 'اختر بطاقة تملكها'],
  'ben.sheet.noCards': [
    'No partner cards are available in your city yet.',
    'لا توجد بطاقات شريكة في مدينتك بعد.',
  ],
  'ben.sheet.cardNote': [
    'Pick the bank and card type only. DealDash never asks for card numbers.',
    'اختر البنك ونوع البطاقة فقط. لا تطلب ديل داش أرقام البطاقات أبداً.',
  ],

  // errors
  'error.BENEFIT_EMAIL_DOMAIN': [
    'This email is not one of your employer’s work domains.',
    'هذا البريد ليس من نطاقات بريد جهة عملك.',
  ],
  'error.BENEFIT_EMAIL_NOT_ALLOWED': [
    'Use your own work email, not a shared or personal address.',
    'استخدم بريد عملك الخاص، وليس بريداً مشتركاً أو شخصياً.',
  ],
  'error.BENEFIT_EMAIL_IN_USE': [
    'This work email is already linked to another DealDash account.',
    'بريد العمل هذا مرتبط بحساب آخر في ديل داش.',
  ],
  'error.BENEFIT_PROGRAM_UNAVAILABLE': [
    'This benefit is not available any more.',
    'هذه الميزة لم تعد متاحة.',
  ],
  'error.BENEFIT_CARD_LIMIT': [
    'You have added the most cards allowed. Remove one first.',
    'أضفت الحد الأقصى من البطاقات. أزل بطاقة أولاً.',
  ],
} as const satisfies Record<string, readonly [string, string]>;

type BenefitPairs = typeof BEN;
export type BenefitKey = keyof BenefitPairs;
const pick = (index: 0 | 1) =>
  Object.fromEntries(Object.entries(BEN).map(([k, v]) => [k, v[index]])) as Record<
    BenefitKey,
    string
  >;
export const enBenefits = pick(0);
export const arBenefits = pick(1);
