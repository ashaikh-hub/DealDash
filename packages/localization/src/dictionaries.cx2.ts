/**
 * Customer experience gap closure, part 2 (2026-10-16): Google / Apple sign-in, saved cards, card-linked offer activation, "Log my
 * saving", the Employee Pass, merchant galleries and per-deal reviews. Pairs are [English, Arabic]; the Arabic is a working translation
 * that needs native review before launch. Urdu: dictionaries.ur.ts. Brand names (Google, Apple, Visa ...) arrive as {placeholders}.
 */
const CX2 = {
  // ---- Google / Apple sign-in
  'cx.so.p.GOOGLE': ['Google', 'جوجل'],
  'cx.so.p.APPLE': ['Apple', 'آبل'],
  'cx.so.continue': ['Continue with {provider}', 'المتابعة باستخدام {provider}'],
  'cx.so.or': ['or', 'أو'],
  'cx.so.working': ['Signing you in…', 'جارٍ تسجيل دخولك…'],
  'cx.so.cancelled': [
    'Sign-in was cancelled. Try again or use your phone number.',
    'تم إلغاء تسجيل الدخول. حاول مرة أخرى أو استخدم رقم جوالك.',
  ],
  'cx.so.failed': [
    'We could not sign you in with {provider}. Try again or use your phone number.',
    'تعذّر تسجيل دخولك باستخدام {provider}. حاول مرة أخرى أو استخدم رقم جوالك.',
  ],
  'cx.so.expired': [
    'This sign-in has expired. Please start again.',
    'انتهت صلاحية تسجيل الدخول هذا. يرجى البدء من جديد.',
  ],
  'cx.so.unavailable': [
    'Sign-in with {provider} is not available yet. Use your phone number.',
    'تسجيل الدخول باستخدام {provider} غير متاح بعد. استخدم رقم جوالك.',
  ],
  'cx.so.phoneTitle': ['One last step', 'خطوة أخيرة'],
  'cx.so.phoneBody': [
    'Confirm your mobile number. If you already have a DealDash account with this number, we link {provider} to it. Otherwise we create your account.',
    'أكّد رقم جوالك. إذا كان لديك حساب في ديل داش بهذا الرقم فسنربط {provider} به، وإلا فسننشئ حسابك.',
  ],
  'cx.so.as': [
    'Signed in with {provider} as {name}',
    'تم تسجيل الدخول باستخدام {provider} باسم {name}',
  ],
  'cx.so.mobile': ['Mobile number', 'رقم الجوال'],
  'cx.so.sendCode': ['Send code', 'إرسال الرمز'],
  'cx.so.codeSent': ['Enter the code we sent to {mobile}', 'أدخل الرمز الذي أرسلناه إلى {mobile}'],
  'cx.so.code': ['6-digit code', 'رمز من 6 أرقام'],
  'cx.so.confirm': ['Confirm and continue', 'تأكيد ومتابعة'],
  'cx.so.linkedExisting': [
    '{provider} is now linked to your DealDash account. Welcome back!',
    'تم ربط {provider} بحسابك في ديل داش. أهلاً بعودتك!',
  ],
  'cx.so.linkedNew': [
    'Your DealDash account is ready and linked to {provider}.',
    'حسابك في ديل داش جاهز ومرتبط بـ {provider}.',
  ],
  'cx.so.notLinked': [
    'You are signed in with your phone. This account is already linked to another {provider} account, so nothing was changed.',
    'تم تسجيل دخولك برقم جوالك. هذا الحساب مرتبط مسبقاً بحساب {provider} آخر، لذلك لم يتغيّر شيء.',
  ],
  'cx.so.linked': ['{provider} is now linked to your account.', 'تم ربط {provider} بحسابك.'],
  'cx.so.conflict': [
    'This {provider} account is already linked to another DealDash account.',
    'حساب {provider} هذا مرتبط مسبقاً بحساب آخر في ديل داش.',
  ],
  'cx.so.back': ['Back to sign-in', 'العودة إلى تسجيل الدخول'],
  'cx.so.next': ['Continue', 'متابعة'],
  'cx.so.title': ['Linked accounts', 'الحسابات المرتبطة'],
  'cx.so.help': [
    'Sign in faster with Google or Apple. Your phone number stays your main sign-in.',
    'سجّل الدخول أسرع باستخدام جوجل أو آبل. يبقى رقم جوالك وسيلة الدخول الأساسية.',
  ],
  'cx.so.isLinked': ['Linked', 'مرتبط'],
  'cx.so.notLinkedYet': ['Not linked', 'غير مرتبط'],
  'cx.so.link': ['Link', 'ربط'],
  'cx.so.unlink': ['Unlink', 'إلغاء الربط'],
  'cx.so.unlinked': ['{provider} was unlinked.', 'تم إلغاء ربط {provider}.'],
  'cx.so.mockTitle': ['{provider} sign-in (development)', 'تسجيل الدخول بـ {provider} (تطوير)'],
  'cx.so.mockBody': [
    'This screen stands in for {provider} until the real sign-in is connected. Choose an account to continue to DealDash.',
    'تحلّ هذه الشاشة محل {provider} حتى يتم ربط تسجيل الدخول الحقيقي. اختر حساباً للمتابعة إلى ديل داش.',
  ],
  'cx.so.mockOther': ['Use another account', 'استخدام حساب آخر'],
  'cx.so.mockName': ['Name', 'الاسم'],
  'cx.so.mockEmail': ['Email', 'البريد الإلكتروني'],
  'cx.so.mockCancel': ['Cancel', 'إلغاء'],
  'cx.so.mockFail': ['Simulate an error', 'محاكاة خطأ'],
  // ---- saved cards
  'cx.pm.title': ['Payment methods', 'طرق الدفع'],
  'cx.pm.sub': [
    'Cards you saved for faster checkout. DealDash never sees or stores your full card number.',
    'البطاقات التي حفظتها لدفع أسرع. لا ترى ديل داش رقم بطاقتك الكامل ولا تحفظه.',
  ],
  'cx.pm.empty': ['No saved cards yet', 'لا توجد بطاقات محفوظة بعد'],
  'cx.pm.emptyBody': [
    'Add a card to pay for reservations in one tap.',
    'أضف بطاقة لتدفع ثمن الحجوزات بلمسة واحدة.',
  ],
  'cx.pm.add': ['Add a card', 'إضافة بطاقة'],
  'cx.pm.asDefault': ['Make it my default card', 'اجعلها بطاقتي الافتراضية'],
  'cx.pm.default': ['Default', 'افتراضية'],
  'cx.pm.makeDefault': ['Make default', 'تعيين كافتراضية'],
  'cx.pm.remove': ['Remove', 'إزالة'],
  'cx.pm.removeConfirm': [
    'Remove this card? You can add it again at any time.',
    'هل تريد إزالة هذه البطاقة؟ يمكنك إضافتها مرة أخرى في أي وقت.',
  ],
  'cx.pm.keep': ['Keep card', 'الاحتفاظ بالبطاقة'],
  'cx.pm.removed': ['Card removed.', 'تمت إزالة البطاقة.'],
  'cx.pm.defaultSet': ['Default card updated.', 'تم تحديث البطاقة الافتراضية.'],
  'cx.pm.ending': ['{brand} ending {last4}', '{brand} تنتهي بـ {last4}'],
  'cx.pm.expires': ['Expires {date}', 'تنتهي {date}'],
  'cx.pm.expired': ['Expired', 'منتهية'],
  'cx.pm.saved': ['Card saved.', 'تم حفظ البطاقة.'],
  'cx.pm.duplicate': ['This card is already saved.', 'هذه البطاقة محفوظة مسبقاً.'],
  'cx.pm.cancelled': ['Adding the card was cancelled.', 'تم إلغاء إضافة البطاقة.'],
  'cx.pm.failed': [
    'The card could not be added. Try another card.',
    'تعذّرت إضافة البطاقة. جرّب بطاقة أخرى.',
  ],
  'cx.pm.checking': ['Checking your card…', 'جارٍ التحقق من بطاقتك…'],
  'cx.pm.secure': [
    'You add the card on the payment provider’s secure page.',
    'تضيف البطاقة على الصفحة الآمنة لمزوّد الدفع.',
  ],
  'cx.pm.unavailable': ['Saving cards is not available yet.', 'حفظ البطاقات غير متاح بعد.'],
  'cx.pm.payWith': ['Pay with', 'الدفع باستخدام'],
  'cx.pm.newCard': ['A new card on the payment page', 'بطاقة جديدة في صفحة الدفع'],
  'cx.pm.change': ['Change', 'تغيير'],
  'cx.pm.choose': ['Choose how to pay', 'اختر طريقة الدفع'],
  'cx.pm.manage': ['Manage cards', 'إدارة البطاقات'],
  'cx.pm.paying': ['Paying with {card}', 'الدفع باستخدام {card}'],
  'cx.pm.mockTitle': ['Add a card (development payment page)', 'إضافة بطاقة (صفحة دفع تجريبية)'],
  'cx.pm.mockBody': [
    'This page stands in for the payment provider’s secure card form. Pick a test card: no card number is entered or stored.',
    'تحلّ هذه الصفحة محل نموذج البطاقة الآمن لمزوّد الدفع. اختر بطاقة تجريبية: لا يُدخل أي رقم بطاقة ولا يُحفظ.',
  ],
  'cx.pm.mockCard': ['Test {brand} card ending {last4}', 'بطاقة {brand} تجريبية تنتهي بـ {last4}'],
  'cx.pm.mockDeclined': ['A card that will be declined', 'بطاقة سيتم رفضها'],
  'cx.pm.mockSave': ['Save card', 'حفظ البطاقة'],
  'cx.pm.mockCancel': ['Cancel', 'إلغاء'],
  // ---- card-linked offers
  'cx.ca.title': ['Card offer', 'عرض البطاقة'],
  'cx.ca.body': [
    'Activate this offer on your card before you use it.',
    'فعّل هذا العرض على بطاقتك قبل استخدامه.',
  ],
  'cx.ca.activate': ['Activate offer', 'تفعيل العرض'],
  'cx.ca.activateOn': ['Activate on {card}', 'تفعيل على {card}'],
  'cx.ca.activated': ['Activated on {card}', 'مفعّل على {card}'],
  'cx.ca.activatedOn': ['Activated {date}', 'تم التفعيل {date}'],
  'cx.ca.chooseCard': ['Choose the card', 'اختر البطاقة'],
  'cx.ca.needsCard': [
    'Add an eligible card to activate this offer.',
    'أضف بطاقة مؤهلة لتفعيل هذا العرض.',
  ],
  'cx.ca.worksWith': ['Works with cards from {issuers}', 'يعمل مع بطاقات {issuers}'],
  'cx.ca.addCard': ['Add your card', 'أضف بطاقتك'],
  'cx.ca.unavailable': [
    'This offer can no longer be activated.',
    'لم يعد بالإمكان تفعيل هذا العرض.',
  ],
  'cx.ca.signIn': ['Sign in to activate this card offer.', 'سجّل الدخول لتفعيل عرض البطاقة هذا.'],
  'cx.ca.history': ['Activated card offers', 'عروض البطاقات المفعّلة'],
  'cx.ca.empty': ['No activated card offers yet', 'لا توجد عروض بطاقات مفعّلة بعد'],
  'cx.ca.st.ACTIVE': ['Active', 'فعّال'],
  'cx.ca.st.ENDED': ['Offer ended', 'انتهى العرض'],
  'cx.ca.st.CARD_REMOVED': ['Card removed', 'أُزيلت البطاقة'],
  'ben.tab.activated': ['Activated', 'المفعّلة'],
  'ben.ev.OFFER_ACTIVATED': ['Card offer activated: {name}', 'تم تفعيل عرض البطاقة: {name}'],
  // ---- Log my saving
  'cx.sv.title': ['Log my saving', 'سجّل توفيري'],
  'cx.sv.body': [
    'How much did you save with this deal? It adds to your total savings.',
    'كم وفّرت مع هذا العرض؟ يُضاف إلى إجمالي توفيرك.',
  ],
  'cx.sv.amount': ['Amount saved ({currency})', 'المبلغ الذي وفّرته ({currency})'],
  'cx.sv.suggested': ['The offer says you save {amount}', 'يقول العرض إنك توفّر {amount}'],
  'cx.sv.log': ['Log saving', 'تسجيل التوفير'],
  'cx.sv.logged': ['You saved {amount} with this deal', 'وفّرت {amount} مع هذا العرض'],
  'cx.sv.loggedOn': ['Logged {date}', 'سُجّل {date}'],
  'cx.sv.thanks': ['Saving logged. Nice one!', 'تم تسجيل التوفير. أحسنت!'],
  'cx.sv.total': ['You have saved {amount} with DealDash', 'وفّرت {amount} مع ديل داش'],
  'cx.sv.count': ['{n} logged savings', '{n} توفيرات مسجّلة'],
  'cx.sv.pageTitle': ['My savings', 'توفيري'],
  'cx.sv.empty': ['No savings logged yet', 'لا يوجد توفير مسجّل بعد'],
  'cx.sv.emptyBody': [
    'After you use a deal, log what you saved to see your total here.',
    'بعد استخدام عرض، سجّل ما وفّرته لترى إجماليك هنا.',
  ],
  'cx.sv.invalid': ['Enter an amount greater than zero.', 'أدخل مبلغاً أكبر من صفر.'],
  'cx.sv.view': ['View my savings', 'عرض توفيري'],
  // ---- Employee Pass
  'cx.ep.title': ['Employee Pass', 'بطاقة الموظف'],
  'cx.ep.active': ['Active', 'فعّالة'],
  'cx.ep.inactive': ['Inactive', 'غير فعّالة'],
  'cx.ep.holder': ['Pass holder', 'حامل البطاقة'],
  'cx.ep.employer': ['Employer', 'جهة العمل'],
  'cx.ep.number': ['Pass number', 'رقم البطاقة'],
  'cx.ep.validUntil': ['Valid until {date}', 'صالحة حتى {date}'],
  'cx.ep.verifiedOn': ['Verified {date}', 'تم التحقق {date}'],
  'cx.ep.workEmail': ['Work email', 'بريد العمل'],
  'cx.ep.live': ['Live pass · {time}', 'بطاقة مباشرة · {time}'],
  'cx.ep.show': [
    'Show this pass at the counter when an offer is for employees of your company.',
    'اعرض هذه البطاقة عند الكاشير عندما يكون العرض لموظفي جهة عملك.',
  ],
  'cx.ep.reason.EXPIRED': [
    'Your employer verification has expired. Verify again to use employee offers.',
    'انتهت صلاحية التحقق من جهة عملك. تحقّق مرة أخرى لاستخدام عروض الموظفين.',
  ],
  'cx.ep.reason.PENDING': [
    'Finish verifying your work email to activate your pass.',
    'أكمل التحقق من بريد العمل لتفعيل بطاقتك.',
  ],
  'cx.ep.reason.NONE': [
    'Verify your employer to get your Employee Pass and unlock employee offers.',
    'تحقّق من جهة عملك لتحصل على بطاقة الموظف وتفتح عروض الموظفين.',
  ],
  'cx.ep.reason.RENEWAL_DUE': [
    'Renew your verification soon to keep your pass active.',
    'جدّد التحقق قريباً لتبقى بطاقتك فعّالة.',
  ],
  'cx.ep.verify': ['Verify my employer', 'التحقق من جهة عملي'],
  'cx.ep.renew': ['Renew verification', 'تجديد التحقق'],
  'cx.ep.offers': ['Offers for {employer} employees', 'عروض لموظفي {employer}'],
  'cx.ep.noOffers': [
    'No employee offers near you right now.',
    'لا توجد عروض للموظفين بالقرب منك حالياً.',
  ],
  'cx.ep.open': ['View Employee Pass', 'عرض بطاقة الموظف'],
  'cx.ep.signIn': ['Sign in to see your Employee Pass.', 'سجّل الدخول لعرض بطاقة الموظف.'],
  // ---- merchant gallery
  'cx.g.photos': ['Photos', 'الصور'],
  'cx.g.open': ['Open photo {n} of {total}', 'فتح الصورة {n} من {total}'],
  'cx.g.none': ['No photos from this business yet', 'لا توجد صور من هذا النشاط بعد'],
  // ---- per-deal reviews
  'cx.rv.title': ['Reviews of this deal', 'تقييمات هذا العرض'],
  'cx.rv.none': ['No reviews of this deal yet', 'لا توجد تقييمات لهذا العرض بعد'],
  'cx.rv.write': ['Rate this deal', 'قيّم هذا العرض'],
  'cx.rv.notRedeemed': [
    'You can review this deal after you use it.',
    'يمكنك تقييم هذا العرض بعد استخدامه.',
  ],
  'cx.rv.already': ['You have reviewed this deal. Thank you!', 'لقد قيّمت هذا العرض. شكراً لك!'],
  'cx.rv.limit': [
    'You recently reviewed this business. You can review it again later.',
    'قيّمت هذا النشاط مؤخراً. يمكنك تقييمه مرة أخرى لاحقاً.',
  ],
  'cx.rv.signIn': [
    'Customers who used this deal can review it. Sign in to write yours.',
    'يمكن للعملاء الذين استخدموا هذا العرض تقييمه. سجّل الدخول لكتابة تقييمك.',
  ],
  'cx.rv.rating': ['Your rating', 'تقييمك'],
  'cx.rv.star': ['{n} out of 5 stars', '{n} من 5 نجوم'],
  'cx.rv.text': ['Tell others about this deal', 'أخبر الآخرين عن هذا العرض'],
  'cx.rv.help': [
    'At least 10 characters. Do not include card numbers.',
    '10 أحرف على الأقل. لا تكتب أرقام البطاقات.',
  ],
  'cx.rv.post': ['Post review', 'نشر التقييم'],
  'cx.rv.cancel': ['Cancel', 'إلغاء'],
  'cx.rv.thanks': ['Thanks! Your review is published.', 'شكراً! تم نشر تقييمك.'],
  'cx.rv.pending': [
    'Thanks! Your review appears after a quick check.',
    'شكراً! سيظهر تقييمك بعد مراجعة سريعة.',
  ],
  'cx.rv.verified': ['Verified visit', 'زيارة موثّقة'],
  'cx.rv.merchant': ['Reviews of {merchant}', 'تقييمات {merchant}'],
  'cx.rv.dealRating': ['Deal rating', 'تقييم العرض'],
  'cx.rv.rate': ['Rate your visit', 'قيّم زيارتك'],
  // ---- remote UAT (G-7): the label on every screen of a staging build
  'shell.envStaging': ['STAGING · Test data only', 'بيئة اختبار · بيانات تجريبية فقط'],
  // ---- profile menu
  'cx.menu.payments': ['Payment methods', 'طرق الدفع'],
  'cx.menu.pass': ['Employee Pass', 'بطاقة الموظف'],
  'cx.menu.savings': ['My savings', 'توفيري'],
  // ---- errors
  'error.SOCIAL_SIGN_IN_UNAVAILABLE': [
    'This sign-in option is not available yet. Use your phone number.',
    'خيار تسجيل الدخول هذا غير متاح بعد. استخدم رقم جوالك.',
  ],
  'error.SOCIAL_SIGN_IN_EXPIRED': [
    'This sign-in has expired. Please start again.',
    'انتهت صلاحية تسجيل الدخول هذا. يرجى البدء من جديد.',
  ],
  'error.SOCIAL_ALREADY_LINKED': [
    'This account is already linked to another DealDash account.',
    'هذا الحساب مرتبط مسبقاً بحساب آخر في ديل داش.',
  ],
  'error.PAYMENT_METHOD_NOT_FOUND': [
    'That card is no longer available. Choose another card or add a new one.',
    'هذه البطاقة لم تعد متاحة. اختر بطاقة أخرى أو أضف بطاقة جديدة.',
  ],
  'error.PAYMENT_METHOD_EXPIRED': [
    'This card has expired. Choose another card.',
    'انتهت صلاحية هذه البطاقة. اختر بطاقة أخرى.',
  ],
  'error.CARD_SAVING_UNAVAILABLE': [
    'Saving cards is not available right now.',
    'حفظ البطاقات غير متاح حالياً.',
  ],
  'error.OFFER_ACTIVATION_NOT_ALLOWED': [
    'This offer cannot be activated on that card.',
    'لا يمكن تفعيل هذا العرض على تلك البطاقة.',
  ],
  'error.SAVING_NOT_ALLOWED': [
    'You can log a saving after you use the deal.',
    'يمكنك تسجيل التوفير بعد استخدام العرض.',
  ],
  'error.SAVING_ALREADY_LOGGED': [
    'You already logged the saving for this deal.',
    'لقد سجّلت التوفير لهذا العرض مسبقاً.',
  ],
  'error.REVIEW_ALREADY_EXISTS': [
    'You have already reviewed this deal.',
    'لقد قيّمت هذا العرض مسبقاً.',
  ],
} as const satisfies Record<string, readonly [string, string]>;

type Cx2Pairs = typeof CX2;
export type Cx2Key = keyof Cx2Pairs;
const pick = (index: 0 | 1) =>
  Object.fromEntries(Object.entries(CX2).map(([k, v]) => [k, v[index]])) as Record<Cx2Key, string>;
export const enCx2 = pick(0);
export const arCx2 = pick(1);
