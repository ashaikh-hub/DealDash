/**
 * Customer brand restoration (visual pass): the DealDash proposition on the home screen, the ecosystem shortcuts, the rewards card
 * and the quieter install prompt. Presentation copy only — no business rule is stated here that the product does not already apply
 * (points are not cash; Exclusive Deals are reserved free). Pairs are [English, Arabic]; the Arabic is a working translation that
 * needs native review before launch (B5).
 */
const BRAND = {
  'brand.tagline': [
    'Discover Deals. Watch. Get Rewarded.',
    'اكتشف العروض. شاهد. واحصل على المكافآت.',
  ],
  'home.heroKicker': ['{city}', '{city}'],
  'home.heroLive': ['Live Deals', 'العروض الحية'],
  'home.heroTitle': ['Amazing experiences near you', 'تجارب مذهلة بالقرب منك'],
  'home.heroBody': [
    'Discover. Watch. Get rewarded. Enjoy more.',
    'اكتشف. شاهد. احصل على المكافآت. واستمتع أكثر.',
  ],
  'home.heroCta': ['Explore deals', 'استكشف العروض'],
  'home.ecosystem': ['Everything on DealDash', 'كل ما في ديل داش'],
  'home.eco.live': ['Live Deals', 'العروض الحية'],
  'home.eco.liveSub': ['Happening now', 'متاحة الآن'],
  'home.eco.exclusive': ['Exclusive Deals', 'العروض الحصرية'],
  'home.eco.exclusiveSub': ['Limited stock', 'كمية محدودة'],
  'home.eco.vouchers': ['Vouchers', 'القسائم'],
  'home.eco.vouchersSub': ['Pay less', 'ادفع أقل'],
  'home.eco.watch': ['Watch & Earn', 'شاهد واكسب'],
  'home.eco.watchSub': ['Earn points', 'اكسب النقاط'],
  'home.eco.rewards': ['Rewards', 'المكافآت'],
  'home.eco.rewardsSub': ['Redeem points', 'استبدل النقاط'],
  'home.rewardsTitle': ['Your rewards', 'مكافآتك'],
  'home.rewardsPoints': ['{points} points available', '{points} نقطة متاحة'],
  'home.rewardsCta': ['View rewards', 'عرض المكافآت'],
  'home.rewardsGuestTitle': ['Earn points as you discover', 'اكسب النقاط أثناء الاستكشاف'],
  'home.rewardsGuestBody': [
    'Watch short videos from places you love and collect points to redeem for rewards.',
    'شاهد مقاطع قصيرة من أماكنك المفضلة واجمع نقاطاً تستبدلها بمكافآت.',
  ],
  'home.rewardsGuestCta': ['Start earning', 'ابدأ الكسب'],
  'shell.installBody': [
    'Get the DealDash app on your home screen',
    'أضف تطبيق ديل داش إلى شاشتك الرئيسية',
  ],
  'shell.installDismiss': ['Not now', 'ليس الآن'],
  'vch.saveChip': ['Save {pct}%', 'وفّر {pct}%'],
  // approved header and Home (founder direction 2026-10-16)
  'hdr.updates': ['Notifications', 'الإشعارات'],
  'hdr.hi': ['Hi {name}', 'مرحباً {name}'],
  'hdr.hiThere': ['Hi there', 'مرحباً'],
  'hdr.points': ['{n} pts', '{n} نقطة'],
  'hdr.signIn': ['Sign in', 'تسجيل الدخول'],
  'home.browse.title': ['Browse Offers By', 'تصفّح العروض حسب'],
  'home.browse.sub': [
    'Recent deals by card, employer or brand',
    'أحدث العروض حسب البطاقة أو جهة العمل أو العلامة',
  ],
  'home.browse.allOffers': ['All offers', 'كل العروض'],
  'home.browse.new': ['New offers', 'عروض جديدة'],
  'home.browse.ending': ['Ending soon', 'تنتهي قريباً'],
  'hot.card.paid': ['Pay & Reserve', 'ادفع واحجز'],
  'hot.card.free': ['Free reservation', 'حجز مجاني'],
  'wat.prop': ['Watch {sec}s · earn points', 'شاهد {sec} ث · واكسب النقاط'],
} as const satisfies Record<string, readonly [string, string]>;

type BrandPairs = typeof BRAND;
export type BrandKey = keyof BrandPairs;
const pick = (index: 0 | 1) =>
  Object.fromEntries(Object.entries(BRAND).map(([k, v]) => [k, v[index]])) as Record<
    BrandKey,
    string
  >;
export const enBrand = pick(0);
export const arBrand = pick(1);
