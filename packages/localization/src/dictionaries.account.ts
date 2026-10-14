/**
 * Customer account: profile set-up (CS-02), account settings (CS-05), notification choices (CS-06), consents, the account gate and
 * global states (offline, session ended), and the Live Deals map. Wording rules: Terms / Privacy are required, marketing is always
 * separate and optional (NT-40); gender is optional and never used for targeting (VK-06); the age block states the rule only.
 * Pairs are [English, Arabic]; the Arabic is a working translation that needs native review before launch (B5).
 */
const ACCOUNT = {
  // ---- profile entries
  'profile.account': ['Account settings', 'إعدادات الحساب'],
  'profile.notifications': ['Notifications', 'الإشعارات'],
  'profile.privacy': ['Privacy and consents', 'الخصوصية والموافقات'],
  'profile.setup': ['Finish setting up your profile', 'أكمل إعداد ملفك الشخصي'],
  'profile.setupBody': [
    'It takes a minute. Then you can reserve, buy and earn points.',
    'يستغرق ذلك دقيقة. بعدها يمكنك الحجز والشراء وكسب النقاط.',
  ],

  // ---- set-up wizard
  'acct.setup.title': ['Set up your profile', 'إعداد ملفك الشخصي'],
  'acct.setup.step': ['Step {n} of {total}', 'الخطوة {n} من {total}'],
  'acct.setup.continue': ['Continue', 'متابعة'],
  'acct.setup.skip': ['Skip for now', 'تخطَّ الآن'],
  'acct.setup.back': ['Back', 'رجوع'],
  'acct.setup.signIn': [
    'Sign in with your mobile number to set up your profile.',
    'سجّل الدخول برقم جوالك لإعداد ملفك الشخصي.',
  ],
  'acct.details.title': ['About you', 'عنك'],
  'acct.firstName': ['First name', 'الاسم الأول'],
  'acct.lastName': ['Last name (optional)', 'اسم العائلة (اختياري)'],
  'acct.email': ['Email', 'البريد الإلكتروني'],
  'acct.emailHelp': [
    'For your receipts. We only send offers if you allow it.',
    'لإرسال إيصالاتك. لا نرسل العروض إلا بموافقتك.',
  ],
  'acct.dob.title': ['Your date of birth', 'تاريخ ميلادك'],
  'acct.dob': ['Date of birth', 'تاريخ الميلاد'],
  'acct.dobHelp': [
    'DealDash is for people {age} and over. Once confirmed, only support can change it.',
    'ديل داش للأشخاص من عمر {age} عاماً فأكثر. بعد التأكيد لا يمكن تغييره إلا عبر الدعم.',
  ],
  'acct.dobLocked': [
    'Confirmed. Contact support to correct it.',
    'تم التأكيد. تواصل مع الدعم لتصحيحه.',
  ],
  'acct.gender.title': ['Gender (optional)', 'الجنس (اختياري)'],
  'acct.genderHelp': [
    'Optional. It is never used to target offers.',
    'اختياري. لا يُستخدم أبداً لاستهداف العروض.',
  ],
  'acct.gender.FEMALE': ['Female', 'أنثى'],
  'acct.gender.MALE': ['Male', 'ذكر'],
  'acct.gender.PREFER_NOT_TO_SAY': ['Prefer not to say', 'أفضّل عدم الإفصاح'],
  'acct.city.title': ['Your city', 'مدينتك'],
  'acct.cityHelp': ['We show deals in your city first.', 'نعرض عروض مدينتك أولاً.'],
  'acct.interests.title': ['What do you enjoy?', 'ما الذي تستمتع به؟'],
  'acct.interestsHelp': [
    'Pick a few categories (optional). You can change them any time.',
    'اختر بعض الفئات (اختياري). يمكنك تغييرها في أي وقت.',
  ],
  'acct.consents.title': ['Your agreements', 'موافقاتك'],
  'acct.consents.required': [
    'Please accept the Terms of Use and the Privacy Policy to continue.',
    'يرجى قبول شروط الاستخدام وسياسة الخصوصية للمتابعة.',
  ],
  'acct.consents.optional': ['Optional', 'اختياري'],
  'acct.consent.TERMS': ['I accept the Terms of Use', 'أوافق على شروط الاستخدام'],
  'acct.consent.PRIVACY': ['I accept the Privacy Policy', 'أوافق على سياسة الخصوصية'],
  'acct.consent.MARKETING_PUSH': [
    'Send me offers and news as notifications',
    'أرسل لي العروض والأخبار كإشعارات',
  ],
  'acct.consent.MARKETING_EMAIL': [
    'Send me offers and news by email',
    'أرسل لي العروض والأخبار بالبريد الإلكتروني',
  ],
  'acct.consent.LOCATION': [
    'Use my location to sort deals near me',
    'استخدم موقعي لترتيب العروض القريبة مني',
  ],
  'acct.consent.NOTIFICATIONS': [
    'Notifications about my reservations, vouchers and account',
    'إشعارات عن حجوزاتي وقسائمي وحسابي',
  ],
  'acct.consents.readTerms': ['Read the Terms of Use', 'اقرأ شروط الاستخدام'],
  'acct.consents.readPrivacy': ['Read the Privacy Policy', 'اقرأ سياسة الخصوصية'],
  'acct.consents.pending': [
    'The final text is being prepared and will be published before launch.',
    'يجري إعداد النص النهائي وسيُنشر قبل الإطلاق.',
  ],
  'acct.consents.version': ['Version {v}', 'الإصدار {v}'],
  'acct.consents.accepted': ['Accepted on {date}', 'تمت الموافقة في {date}'],
  'acct.consents.withdrawn': ['Turned off on {date}', 'أُوقفت في {date}'],
  'acct.consents.cannotWithdraw': [
    'Required to use DealDash. To stop using DealDash, request account deletion in My data.',
    'مطلوبة لاستخدام ديل داش. لإيقاف استخدامه اطلب حذف الحساب من «بياناتي».',
  ],
  'acct.done.title': ["You're all set, {name}", 'كل شيء جاهز يا {name}'],
  'acct.done.body': [
    'Unlock more offers made for you by adding your employer or the cards you hold.',
    'افتح المزيد من العروض المخصصة لك بإضافة جهة عملك أو بطاقاتك.',
  ],
  'acct.done.benefits': ['Add my benefits', 'أضف مزاياي'],
  'acct.done.home': ['Start exploring', 'ابدأ الاستكشاف'],
  'acct.blocked.title': [
    'DealDash is for people {age} and over',
    'ديل داش للأشخاص من عمر {age} عاماً فأكثر',
  ],
  'acct.blocked.body': [
    'We could not set up your account. We have not kept your details.',
    'تعذّر إعداد حسابك. لم نحتفظ ببياناتك.',
  ],
  'acct.reaccept.title': ['We updated our Terms', 'حدّثنا شروطنا'],
  'acct.reaccept.body': [
    'Please review and accept them to keep reserving, buying and earning.',
    'يرجى مراجعتها وقبولها لمواصلة الحجز والشراء والكسب.',
  ],
  'acct.reaccept.cta': ['Review and accept', 'المراجعة والقبول'],

  // ---- account gate + global states
  'acct.gate.title': ['Finish setting up your profile', 'أكمل إعداد ملفك الشخصي'],
  'acct.gate.body': [
    'It takes a minute. Then you can reserve, buy and earn points.',
    'يستغرق ذلك دقيقة. بعدها يمكنك الحجز والشراء وكسب النقاط.',
  ],
  'acct.gate.cta': ['Continue setting up', 'متابعة الإعداد'],
  'acct.session.title': ['Your session ended', 'انتهت جلستك'],
  'acct.session.body': ['Sign in again to continue.', 'سجّل الدخول مجدداً للمتابعة.'],
  'acct.offline': [
    "You're offline. Saved codes still show; other actions wait until you reconnect.",
    'أنت غير متصل. تظهر الرموز المحفوظة؛ والإجراءات الأخرى تنتظر عودة الاتصال.',
  ],

  // ---- account settings
  'acct.title': ['Account settings', 'إعدادات الحساب'],
  'acct.personal': ['Personal details', 'البيانات الشخصية'],
  'acct.save': ['Save changes', 'حفظ التغييرات'],
  'acct.saved': ['Saved', 'تم الحفظ'],
  'acct.mobile': ['Mobile number', 'رقم الجوال'],
  'acct.mobile.change': ['Change number', 'تغيير الرقم'],
  'acct.mobile.new': ['New mobile number', 'رقم الجوال الجديد'],
  'acct.mobile.help': [
    'Include the country code, for example +966 5X XXX XXXX.',
    'أدخل رمز الدولة، مثلاً ‎+966 5X XXX XXXX.',
  ],
  'acct.mobile.sendCode': ['Send code', 'إرسال الرمز'],
  'acct.mobile.codeSent': [
    'We sent a 6-digit code to {mobile}',
    'أرسلنا رمزاً من 6 أرقام إلى {mobile}',
  ],
  'acct.mobile.code': ['Code', 'الرمز'],
  'acct.mobile.verify': ['Confirm new number', 'تأكيد الرقم الجديد'],
  'acct.mobile.changed': ['Your mobile number was changed.', 'تم تغيير رقم جوالك.'],
  'acct.language': ['Language', 'اللغة'],
  'acct.legal': ['Legal', 'الشؤون القانونية'],
  'acct.data': ['My data and account deletion', 'بياناتي وحذف الحساب'],

  // ---- notifications (CS-06)
  'acct.notif.title': ['Notifications', 'الإشعارات'],
  'acct.notif.intro': [
    'Messages about your reservations, vouchers, payments and account always reach you. Choose the rest.',
    'تصلك دائماً الرسائل المتعلقة بحجوزاتك وقسائمك ومدفوعاتك وحسابك. اختر الباقي.',
  ],
  'acct.notif.cat.ORDERS': ['Reservations, vouchers and payments', 'الحجوزات والقسائم والمدفوعات'],
  'acct.notif.cat.ACCOUNT': ['Account, support and security', 'الحساب والدعم والأمان'],
  'acct.notif.cat.REWARDS': ['Rewards and points', 'المكافآت والنقاط'],
  'acct.notif.cat.BENEFITS': ['My benefits', 'مزاياي'],
  'acct.notif.required': ['Always on', 'مفعّلة دائماً'],
  'acct.notif.pushShort': ['Push', 'فوري'],
  'acct.doc.TERMS': ['Terms of Use', 'شروط الاستخدام'],
  'acct.doc.PRIVACY': ['Privacy Policy', 'سياسة الخصوصية'],
  'acct.notif.push': ['Push notifications', 'الإشعارات الفورية'],
  'acct.notif.inbox': [
    'Everything also stays in Updates, even when push is off.',
    'يبقى كل شيء أيضاً في «التحديثات» حتى عند إيقاف الإشعارات الفورية.',
  ],
  'acct.notif.pushAllowed': ['Allow push notifications', 'السماح بالإشعارات الفورية'],
  'acct.notif.pushOff': [
    'Push notifications are off for your account. Messages still appear in Updates.',
    'الإشعارات الفورية متوقفة لحسابك. تظهر الرسائل في «التحديثات».',
  ],
  'acct.notif.marketing': ['Offers and news', 'العروض والأخبار'],
  'acct.notif.marketingHelp': [
    'Only if you opt in. You can stop at any time.',
    'فقط إن وافقت. يمكنك الإيقاف في أي وقت.',
  ],

  // ---- explore + map
  'explore.forMyBenefits': ['For my benefits', 'لمزاياي'],
  'map.list': ['List', 'القائمة'],
  'map.map': ['Map', 'الخريطة'],
  'map.title': ['Live Deals map', 'خريطة العروض الحية'],
  'map.youAreHere': ['You are here', 'أنت هنا'],
  'map.cityCentre': ['City centre', 'وسط المدينة'],
  'map.zoomIn': ['Zoom in', 'تكبير'],
  'map.zoomOut': ['Zoom out', 'تصغير'],
  'map.recenter': ['Back to my area', 'العودة إلى منطقتي'],
  'map.dealsHere': ['{n} deals here', '{n} عروض هنا'],
  'map.noLocation': [
    '{n} deals have no map location. See them in the list.',
    '{n} عروض بلا موقع على الخريطة. تجدها في القائمة.',
  ],
  'map.empty': ['No deals to show on the map', 'لا توجد عروض لعرضها على الخريطة'],
  'map.ringsYou': ['Rings show 1, 3 and 5 km from you', 'تُظهر الدوائر 1 و3 و5 كم من موقعك'],
  'map.ringsCity': [
    'Rings show 1, 3 and 5 km from the city centre',
    'تُظهر الدوائر 1 و3 و5 كم من وسط المدينة',
  ],
  'map.close': ['Close', 'إغلاق'],
  'map.label': [
    'Map of Live Deals. Use the list view for a text version.',
    'خريطة العروض الحية. استخدم عرض القائمة لنسخة نصية.',
  ],

  // ---- notifications + errors
  'notif.ACCOUNT_WELCOME': [
    'Welcome to DealDash, {firstName}',
    'مرحباً بك في ديل داش يا {firstName}',
  ],
  'error.ONBOARDING_REQUIRED': [
    'Finish setting up your profile to continue.',
    'أكمل إعداد ملفك الشخصي للمتابعة.',
  ],
  'error.CONSENT_REQUIRED': [
    'Our Terms changed. Please review and accept them to continue.',
    'تغيّرت شروطنا. يرجى مراجعتها وقبولها للمتابعة.',
  ],
  'error.AGE_RESTRICTED': [
    'DealDash is for people over the minimum age. This account cannot be used.',
    'ديل داش مخصص لمن تجاوزوا الحد الأدنى للعمر. لا يمكن استخدام هذا الحساب.',
  ],
  'error.PROFILE_DOB_LOCKED': [
    'Your date of birth is already confirmed. Contact support to correct it.',
    'تاريخ ميلادك مؤكد بالفعل. تواصل مع الدعم لتصحيحه.',
  ],
  'error.MOBILE_IN_USE': [
    'This number is already linked to another DealDash account.',
    'هذا الرقم مرتبط بحساب آخر في ديل داش.',
  ],
} as const satisfies Record<string, readonly [string, string]>;

type AccountPairs = typeof ACCOUNT;
export type AccountKey = keyof AccountPairs;
const pick = (index: 0 | 1) =>
  Object.fromEntries(Object.entries(ACCOUNT).map(([k, v]) => [k, v[index]])) as Record<
    AccountKey,
    string
  >;
export const enAccount = pick(0);
export const arAccount = pick(1);
