/**
 * Shared UI dictionaries. Keep keys identical in both languages (enforced by a test).
 * Only foundation strings exist now; product copy arrives with each product stage.
 * Arabic copy here is a working draft for native review (QA item), not final wording.
 */
import { arStage2, enStage2 } from './dictionaries.stage2';
import { arStage3, enStage3 } from './dictionaries.stage3';
import { arStage4, enStage4 } from './dictionaries.stage4';
import { arStage5, enStage5 } from './dictionaries.stage5';
import { arCommercial, enCommercial } from './dictionaries.commercial';
import { arStage6, enStage6 } from './dictionaries.stage6';
import { arPlatform, enPlatform } from './dictionaries.platform';
import { arSubscription, enSubscription } from './dictionaries.subscription';
import { arPhase45, enPhase45 } from './dictionaries.phase45';
import { arMarkets, enMarkets } from './dictionaries.markets';
import { arPartners, enPartners } from './dictionaries.partners';
import { arStage8, enStage8 } from './dictionaries.stage8';
import { arStage9, enStage9 } from './dictionaries.stage9';
import { arReviewed } from './dictionaries.ar-reviewed';

const enBase = {
  'brand.name': 'DealDash',
  'app.customer': 'DealDash',
  'app.merchant': 'DealDash for Business',
  'app.staff': 'DealDash Staff',
  'app.partner': 'DealDash Partners',
  'app.admin': 'DealDash Admin',

  'nav.home': 'Home',
  'nav.dashboard': 'Dashboard',
  'nav.profile': 'Profile',
  'nav.branches': 'Branches',
  'nav.team': 'Team',
  'nav.deals': 'Deals',
  'nav.vouchers': 'Vouchers',
  'nav.watch': 'Watch & Earn',
  'nav.redemptions': 'Redemptions',
  'nav.insights': 'Insights',
  'nav.finance': 'Finance',
  'nav.scan': 'Scan',
  'nav.history': 'History',
  'nav.account': 'Account',
  'nav.campaigns': 'Campaigns',
  'nav.eligibility': 'Eligibility',
  'nav.merchants': 'Merchants',
  'nav.reports': 'Reports',
  'nav.organization': 'Organization',
  'nav.users': 'Users',
  'nav.organizations': 'Organizations',
  'nav.customers': 'Customers',
  'nav.audit': 'Audit log',
  'nav.configuration': 'Configuration',
  'nav.jobs': 'Jobs',
  'nav.support': 'Support',

  'auth.signIn': 'Sign in',
  'auth.signOut': 'Sign out',
  'auth.signedInAs': 'Signed in as',
  'auth.notSignedIn': 'You are not signed in',
  'auth.mobile': 'Mobile number',
  'auth.email': 'Work email',
  'auth.password': 'Password',
  'auth.sendCode': 'Send code',
  'auth.code': 'Verification code',
  'auth.verify': 'Verify',
  'auth.mfaTitle': 'Two-step verification',
  'auth.mfaHint': 'Enter the 6-digit code from your authenticator app.',
  'auth.role': 'Role',
  'auth.organization': 'Organization',
  'auth.permissions': 'Permissions',
  'auth.devHint':
    'Development: the code is printed in the API console and available at /v1/dev/last-sms.',

  'shell.permissionAware': 'Navigation shows only what your role allows.',
  'shell.noAccess': 'You do not have access to this page.',
  'shell.language': 'Language',
  'shell.apiStatus': 'API status',
  'shell.apiOk': 'Connected',
  'shell.apiDown': 'Not reachable',
  'shell.foundationNote': 'Foundation shell. Product features arrive in later stages.',

  'rtl.title': 'Right-to-left check',
  'rtl.body': 'Offer at Nobu Riyadh, valid until 31 Oct. Pay SAR 80, get SAR 100.',
  'rtl.mixed': 'Merchant: Nobu مطعم نوبو · Branch: Olaya',
  'rtl.tableMerchant': 'Merchant',
  'rtl.tableBranch': 'Branch',
  'rtl.tableStatus': 'Status',

  'status.active': 'Active',
  'status.pending': 'Pending',
  'status.suspended': 'Suspended',

  'state.loading': 'Loading…',
  'state.empty': 'Nothing here yet',
  'state.error': 'Something went wrong',
  'state.retry': 'Try again',

  'error.generic': 'Something went wrong. Please try again.',
  'error.AUTH_INVALID': 'The details you entered are not correct.',
  'error.OTP_INVALID': 'That code is not correct.',
  'error.OTP_EXPIRED': 'The code has expired. Request a new one.',
  'error.OTP_RATE_LIMITED': 'Please wait a moment before requesting another code.',
  'error.OTP_LOCKED': 'Too many attempts. Request a new code.',
  'error.MFA_INVALID': 'That verification code is not correct.',
  'error.RATE_LIMITED': 'Too many attempts. Try again later.',
  'error.VALIDATION_FAILED': 'Please check the details and try again.',
  'shell.placeholder': 'This page arrives in a later stage.',
  'shell.installApp': 'Install app',
  'shell.permissionCount': 'Permissions: {count}',
  'shell.devCode': 'Development code',
  'auth.resend': 'Send a new code',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.close': 'Close',
  'common.save': 'Save',
} as const;

export const en = {
  ...enBase,
  ...enStage2,
  ...enStage3,
  ...enStage4,
  ...enStage5,
  ...enStage6,
  ...enCommercial,
  ...enPlatform,
  ...enSubscription,
  ...enPhase45,
  ...enMarkets,
  ...enPartners,
  ...enStage8,
  ...enStage9,
} as const;

export type DictionaryKey = keyof typeof en;
export type Dictionary = Record<DictionaryKey, string>;

const arBase: Record<keyof typeof enBase, string> = {
  'brand.name': 'ديل داش',
  'app.customer': 'ديل داش',
  'app.merchant': 'ديل داش للأعمال',
  'app.staff': 'ديل داش للموظفين',
  'app.partner': 'ديل داش للشركاء',
  'app.admin': 'إدارة ديل داش',

  'nav.home': 'الرئيسية',
  'nav.dashboard': 'لوحة التحكم',
  'nav.profile': 'الملف الشخصي',
  'nav.branches': 'الفروع',
  'nav.team': 'الفريق',
  'nav.deals': 'العروض',
  'nav.vouchers': 'القسائم',
  'nav.watch': 'شاهد واكسب',
  'nav.redemptions': 'الاسترداد',
  'nav.insights': 'التحليلات',
  'nav.finance': 'المالية',
  'nav.scan': 'مسح',
  'nav.history': 'السجل',
  'nav.account': 'الحساب',
  'nav.campaigns': 'الحملات',
  'nav.eligibility': 'الأهلية',
  'nav.merchants': 'التجار',
  'nav.reports': 'التقارير',
  'nav.organization': 'المنظمة',
  'nav.users': 'المستخدمون',
  'nav.organizations': 'المنظمات',
  'nav.customers': 'العملاء',
  'nav.audit': 'سجل التدقيق',
  'nav.configuration': 'الإعدادات',
  'nav.jobs': 'المهام',
  'nav.support': 'الدعم',

  'auth.signIn': 'تسجيل الدخول',
  'auth.signOut': 'تسجيل الخروج',
  'auth.signedInAs': 'تم تسجيل الدخول باسم',
  'auth.notSignedIn': 'لم تقم بتسجيل الدخول',
  'auth.mobile': 'رقم الجوال',
  'auth.email': 'البريد الإلكتروني للعمل',
  'auth.password': 'كلمة المرور',
  'auth.sendCode': 'إرسال الرمز',
  'auth.code': 'رمز التحقق',
  'auth.verify': 'تحقق',
  'auth.mfaTitle': 'التحقق بخطوتين',
  'auth.mfaHint': 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة.',
  'auth.role': 'الدور',
  'auth.organization': 'المنظمة',
  'auth.permissions': 'الصلاحيات',
  'auth.devHint': 'للتطوير: يظهر الرمز في سجل الخادم وعلى /v1/dev/last-sms.',

  'shell.permissionAware': 'تعرض القائمة فقط ما يسمح به دورك.',
  'shell.noAccess': 'ليست لديك صلاحية الوصول إلى هذه الصفحة.',
  'shell.language': 'اللغة',
  'shell.apiStatus': 'حالة الخادم',
  'shell.apiOk': 'متصل',
  'shell.apiDown': 'غير متاح',
  'shell.foundationNote': 'هيكل أساسي. ستصل ميزات المنتج في مراحل لاحقة.',

  'rtl.title': 'اختبار الاتجاه من اليمين إلى اليسار',
  'rtl.body': 'عرض في مطعم نوبو الرياض، صالح حتى 31 أكتوبر. ادفع 80 ريالاً واحصل على 100 ريال.',
  'rtl.mixed': 'التاجر: Nobu مطعم نوبو · الفرع: العليا',
  'rtl.tableMerchant': 'التاجر',
  'rtl.tableBranch': 'الفرع',
  'rtl.tableStatus': 'الحالة',

  'status.active': 'نشط',
  'status.pending': 'قيد المراجعة',
  'status.suspended': 'موقوف',

  'state.loading': 'جارٍ التحميل…',
  'state.empty': 'لا يوجد شيء بعد',
  'state.error': 'حدث خطأ ما',
  'state.retry': 'حاول مرة أخرى',

  'error.generic': 'حدث خطأ ما. حاول مرة أخرى.',
  'error.AUTH_INVALID': 'البيانات المُدخلة غير صحيحة.',
  'error.OTP_INVALID': 'الرمز غير صحيح.',
  'error.OTP_EXPIRED': 'انتهت صلاحية الرمز. اطلب رمزاً جديداً.',
  'error.OTP_RATE_LIMITED': 'يرجى الانتظار قليلاً قبل طلب رمز آخر.',
  'error.OTP_LOCKED': 'محاولات كثيرة. اطلب رمزاً جديداً.',
  'error.MFA_INVALID': 'رمز التحقق غير صحيح.',
  'error.RATE_LIMITED': 'محاولات كثيرة. حاول لاحقاً.',
  'error.VALIDATION_FAILED': 'يرجى التحقق من البيانات والمحاولة مرة أخرى.',
  'shell.placeholder': 'ستتوفر هذه الصفحة في مرحلة لاحقة.',
  'shell.installApp': 'تثبيت التطبيق',
  'shell.permissionCount': 'الصلاحيات: {count}',
  'shell.devCode': 'رمز التطوير',
  'auth.resend': 'إرسال رمز جديد',
  'common.cancel': 'إلغاء',
  'common.confirm': 'تأكيد',
  'common.close': 'إغلاق',
  'common.save': 'حفظ',
};

export const ar: Dictionary = {
  ...arBase,
  ...arStage2,
  ...arStage3,
  ...arStage4,
  ...arStage5,
  ...arStage6,
  ...arCommercial,
  ...arPlatform,
  ...arSubscription,
  ...arPhase45,
  ...arMarkets,
  ...arPartners,
  ...arStage8,
  ...arStage9,
  // Stage 9 (B5): native-review corrections, applied last (only for keys that exist; generated by tooling/i18n/import-translations.mjs)
  ...(Object.fromEntries(
    Object.entries(arReviewed).filter(([k]) => k in en),
  ) as Partial<Dictionary>),
};

export const dictionaries = { en, ar } as const;
export { arReviewStatus } from './dictionaries.ar-reviewed';
