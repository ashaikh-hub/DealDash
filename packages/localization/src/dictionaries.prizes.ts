/**
 * Watch & Earn instant prizes (FDR-19 decided 2026-10-16: instant probabilistic allocation) and Watch & Earn favourites: merchant and
 * partner set-up, DealDash guardrails and monitoring, staff redemption and the customer experience. Pairs are [English, Arabic]; the
 * Arabic is a working translation that needs native review before launch (B5). Urdu: dictionaries.ur.ts.
 */
const PRIZES = {
  // ---- DealDash guardrails (Admin -> Rules and controls)
  's9.cfg.tab.prizes': ['Instant prizes', 'الجوائز الفورية'],
  'aprize.intro': [
    'Limits on the instant prizes merchants and partners may add to Watch & Earn campaigns. Every qualified view still earns the points; the server decides each prize from the campaign probability and stock.',
    'حدود الجوائز الفورية التي يضيفها التجار والشركاء إلى حملات شاهد واكسب. كل مشاهدة مؤهلة تكسب النقاط؛ ويقرر الخادم كل جائزة وفق احتمال الحملة والمخزون.',
  ],
  'aprize.enabled': ['Instant prizes are allowed', 'الجوائز الفورية مسموحة'],
  'aprize.maxPct': ['Highest win chance (%)', 'أعلى نسبة فوز (%)'],
  'aprize.maxInventory': ['Most prizes per campaign', 'أكبر عدد جوائز لكل حملة'],
  'aprize.maxPerCustomer': ['Most prizes per customer', 'أكبر عدد جوائز لكل عميل'],
  'aprize.maxValidity': ['Longest validity (days)', 'أطول صلاحية (أيام)'],
  'aprize.maxLiability': ['Highest liability per campaign', 'أعلى التزام لكل حملة'],

  // ---- merchant / partner set-up
  'mprize.title': ['Instant prize (optional)', 'جائزة فورية (اختياري)'],
  'mprize.help': [
    'You provide and fulfil the prizes. Every qualified view earns DealDash points; right after a qualified view DealDash decides whether that customer wins one prize, using your win chance and the prizes left. A customer is never promised a prize.',
    'أنت توفّر الجوائز وتسلّمها. كل مشاهدة مؤهلة تكسب نقاط ديل داش؛ وبعدها مباشرة يقرر ديل داش إن كان العميل يفوز بجائزة وفق نسبة الفوز والجوائز المتبقية. لا تُوعد أي جائزة مسبقاً.',
  ],
  'mprize.add': ['Add an instant prize', 'إضافة جائزة فورية'],
  'mprize.remove': ['Remove the prize', 'إزالة الجائزة'],
  'mprize.name': ['Prize', 'الجائزة'],
  'mprize.kind': ['Prize type', 'نوع الجائزة'],
  'mprize.kind.FREE_ITEM': ['Free item', 'منتج مجاني'],
  'mprize.kind.DISCOUNT': ['Discount', 'خصم'],
  'mprize.kind.EXPERIENCE': ['Experience', 'تجربة'],
  'mprize.inventory': ['Number of prizes', 'عدد الجوائز'],
  'mprize.pct': ['Win chance per qualified view (%)', 'نسبة الفوز لكل مشاهدة مؤهلة (%)'],
  'mprize.pctHelp': [
    '100% = every qualified view wins while prizes last. DealDash allows up to {max}%.',
    '100% = كل مشاهدة مؤهلة تفوز حتى نفاد الجوائز. يسمح ديل داش حتى {max}%.',
  ],
  'mprize.perCustomer': ['Prizes per customer', 'الجوائز لكل عميل'],
  'mprize.validity': ['Days to redeem', 'أيام الاستخدام'],
  'mprize.branches': ['Where it is redeemed', 'مكان الاستخدام'],
  'mprize.allBranches': ['All your branches', 'كل فروعك'],
  'mprize.unitValue': ['Your value of one prize', 'قيمة الجائزة الواحدة لديك'],
  'mprize.liability': ['Maximum liability: {amount}', 'أقصى التزام: {amount}'],
  'mprize.ack': [
    'We fund these prizes and will honour every prize won at the chosen branches within the validity.',
    'نحن نموّل هذه الجوائز وسنسلّم كل جائزة يفوز بها العملاء في الفروع المختارة خلال الصلاحية.',
  ],
  'issue.PRIZES_DISABLED': [
    'Instant prizes are not enabled by DealDash',
    'الجوائز الفورية غير مفعّلة من ديل داش',
  ],
  'issue.PRIZE_ABOVE_GUARDRAIL': [
    'Above the limit DealDash allows',
    'أعلى من الحد الذي يسمح به ديل داش',
  ],
  'issue.ACKNOWLEDGEMENT_REQUIRED': [
    'Confirm that you fund and honour the prizes',
    'أكّد أنك تموّل الجوائز وتسلّمها',
  ],
  'issue.field.prize': ['Instant prize', 'الجائزة الفورية'],
  'issue.field.prize.title': ['Prize', 'الجائزة'],
  'issue.field.prize.winProbabilityBps': ['Win chance', 'نسبة الفوز'],
  'issue.field.prize.inventory': ['Number of prizes', 'عدد الجوائز'],
  'issue.field.prize.perCustomerLimit': ['Prizes per customer', 'الجوائز لكل عميل'],
  'issue.field.prize.validityDays': ['Days to redeem', 'أيام الاستخدام'],
  'issue.field.prize.unitValueMinor': ['Prize value', 'قيمة الجائزة'],
  'issue.field.prize.acknowledged': ['Prize confirmation', 'تأكيد الجائزة'],

  // ---- merchant / DealDash monitor
  'wprize.mon.title': ['Instant prizes', 'الجوائز الفورية'],
  'wprize.mon.remaining': ['Prizes left', 'الجوائز المتبقية'],
  'wprize.mon.awarded': ['Won', 'فاز بها'],
  'wprize.mon.redeemed': ['Redeemed', 'مستخدمة'],
  'wprize.mon.issued': ['Waiting to be redeemed', 'بانتظار الاستخدام'],
  'wprize.mon.expired': ['Expired unused', 'انتهت دون استخدام'],
  'wprize.mon.notWon': ['Draws without a prize', 'سحوبات بلا جائزة'],
  'wprize.mon.ineligible': ['Not eligible (limit, review, stock)', 'غير مؤهلة (حد، مراجعة، مخزون)'],
  'wprize.mon.chance': ['Win chance', 'نسبة الفوز'],
  'wprize.mon.liability': ['Maximum liability', 'أقصى التزام'],

  // ---- staff
  'st.prize': ['Prize', 'الجائزة'],
  'st.kind.PRIZE': ['Watch & Earn prize', 'جائزة شاهد واكسب'],
  'st.validBodyPrize': [
    'A Watch & Earn prize the customer won. Give the prize, then confirm.',
    'جائزة شاهد واكسب فاز بها العميل. سلّم الجائزة ثم أكّد.',
  ],
  'st.doneBodyPrize': ['Prize handed over.', 'تم تسليم الجائزة.'],
  'st.confirmSheet.titlePrize': ['Hand over this prize?', 'تسليم هذه الجائزة؟'],
  'st.confirmSheet.warnPrize': [
    'Confirm only when you give the prize. A prize can be used once.',
    'أكّد فقط عند تسليم الجائزة. تُستخدم الجائزة مرة واحدة.',
  ],

  // ---- customer
  'wprize.instant': ['Instant reward', 'مكافأة فورية'],
  'wprize.chance': ['Instant reward chance', 'فرصة مكافأة فورية'],
  'wprize.left': ['{n} left', 'متبقٍ {n}'],
  'wprize.detail': ['Instant prize', 'جائزة فورية'],
  'wprize.detailBody': [
    'Watch to the end to earn your points. Each qualified view also has a chance to win: {prize} ({n} left).',
    'شاهد حتى النهاية لتكسب نقاطك. لكل مشاهدة مؤهلة أيضاً فرصة للفوز: {prize} (متبقٍ {n}).',
  ],
  'wprize.detailBodyGuaranteed': [
    'Watch to the end to earn your points and win {prize} instantly, while prizes last ({n} left).',
    'شاهد حتى النهاية لتكسب نقاطك وتفوز بـ {prize} فوراً حتى نفاد الجوائز (متبقٍ {n}).',
  ],
  'wprize.won': ['You won!', 'لقد فزت!'],
  'wprize.wonBody': ['{prize} from {merchant}', '{prize} من {merchant}'],
  'wprize.notWon': [
    'No prize this time. Your points are yours.',
    'لا جائزة هذه المرة. نقاطك محفوظة.',
  ],
  'wprize.show': ['Show this code at the branch', 'اعرض هذا الرمز في الفرع'],
  'wprize.validUntil': ['Valid until {date}', 'صالحة حتى {date}'],
  'wprize.at': ['At: {branches}', 'في: {branches}'],
  'wprize.yours': ['Your prizes', 'جوائزك'],
  'wprize.yoursEmpty': [
    'Prizes you win from Watch & Earn appear here.',
    'تظهر هنا الجوائز التي تفوز بها من شاهد واكسب.',
  ],
  'wprize.status.ISSUED': ['Ready to use', 'جاهزة للاستخدام'],
  'wprize.status.REDEEMED': ['Used', 'مستخدمة'],
  'wprize.status.EXPIRED': ['Expired', 'منتهية'],
  'wprize.status.NOT_WON': ['Not won', 'لم تفز'],
  'wprize.view': ['View prize', 'عرض الجائزة'],
  'wprize.notFound': ['This prize could not be found', 'تعذّر العثور على هذه الجائزة'],
  // in-app winner notification (shared notification engine)
  'notif.PRIZE_WON': ['You won {deal} from {merchant}', 'فزت بجائزة {deal} من {merchant}'],
  'notif.prizeValid': ['Valid until {date} · View prize', 'صالحة حتى {date} · عرض الجائزة'],
  'wsave.save': ['Save', 'حفظ'],
  'wsave.saved': ['Saved', 'محفوظ'],
  'wsave.signIn': ['Sign in to save videos', 'سجّل الدخول لحفظ المقاطع'],
  'wsave.section': ['Saved Watch & Earn', 'شاهد واكسب المحفوظة'],

  // ---- partner
  'pt.watch.prize': ['Instant prize (optional)', 'جائزة فورية (اختياري)'],
} as const satisfies Record<string, readonly [string, string]>;

type PrizePairs = typeof PRIZES;
export type PrizeKey = keyof PrizePairs;
const pick = (index: 0 | 1) =>
  Object.fromEntries(Object.entries(PRIZES).map(([k, v]) => [k, v[index]])) as Record<
    PrizeKey,
    string
  >;
export const enPrizes = pick(0);
export const arPrizes = pick(1);
