/**
 * Stage 9 — Production and launch readiness: customer case replies (B6), governed rules and controls (B7), launch controls, payout
 * instructions (B2), notification throttling (B3) and legal holds. Pairs are [English, Arabic]; the Arabic is a working translation
 * that needs native review before launch (B5: see tooling/i18n and docs/STAGE9_PRODUCTION_LAUNCH_READINESS.md).
 */
const S9 = {
  // ---------------------------------------------------------------- errors
  'error.PILOT_NOT_ENABLED': ['This is not available yet.', 'هذا غير متاح بعد.'],
  'error.LAUNCH_PAUSED': [
    'This is paused for now. Anything you already have stays valid.',
    'هذا متوقف مؤقتاً. كل ما لديك يبقى صالحاً.',
  ],
  'error.CONFIG_CHANGE_STALE': [
    'This setting changed since you opened it. Reload and make the change again.',
    'تغيّر هذا الإعداد منذ فتحته. أعد التحميل وأجرِ التغيير مرة أخرى.',
  ],
  'error.PROVIDER_NOT_CONFIGURED': [
    'This provider is not set up yet.',
    'لم يتم إعداد هذا المزوّد بعد.',
  ],
  'error.LEGAL_HOLD_ACTIVE': [
    'A legal hold is in place for this account.',
    'يوجد حجز قانوني على هذا الحساب.',
  ],
  'error.MARKET_CURRENCY_MISMATCH': [
    'These amounts are in different currencies. DealDash must set pricing for this market first.',
    'هذه المبالغ بعملات مختلفة. يجب أن تحدد ديل داش التسعير لهذا السوق أولاً.',
  ],

  // ---------------------------------------------------------------- B6: customer case replies
  's9.case.you': ['You', 'أنت'],
  's9.case.dealdash': ['DealDash', 'ديل داش'],
  's9.case.fromCustomer': ['From the customer', 'من العميل'],
  's9.case.evidence': ['Evidence', 'الإثبات'],
  's9.case.moveNoteCustomer': [
    'The customer reads this note in the app and can reply. The business on this case can also see it. Never include card numbers or internal details.',
    'يقرأ العميل هذه الملاحظة في التطبيق ويمكنه الرد. ويمكن للنشاط التجاري المرتبط بهذه القضية رؤيتها أيضاً. لا تكتب أرقام البطاقات أو تفاصيل داخلية.',
  ],
  's9.case.moveNoteBusiness': [
    'The business reads this note on its case and can reply. The customer on this case can also see it.',
    'يقرأ النشاط التجاري هذه الملاحظة في قضيته ويمكنه الرد. ويمكن للعميل المرتبط بهذه القضية رؤيتها أيضاً.',
  ],
  's9.case.reply': ['Your reply', 'ردك'],
  's9.case.evidenceLabel': [
    'Order, voucher or receipt reference (optional)',
    'مرجع الطلب أو القسيمة أو الإيصال (اختياري)',
  ],
  's9.case.evidenceHelp': ['Never enter a card number.', 'لا تُدخل رقم بطاقة أبداً.'],
  's9.case.send': ['Send reply', 'إرسال الرد'],
  's9.case.sent': [
    'Reply sent. DealDash will get back to you.',
    'تم إرسال الرد. ستعود إليك ديل داش.',
  ],

  // ---------------------------------------------------------------- B7: rules and controls (structured, governed)
  's9.cfg.intro': [
    'Change how DealDash operates without editing code: reasons, service levels, approval thresholds, fraud rules, notification limits, review policy, redemption, inventory and security limits, and launch controls. Every change is checked, approved by a second person, versioned and can be rolled back.',
    'غيّر طريقة عمل ديل داش دون تعديل البرمجة: الأسباب ومستويات الخدمة وحدود الاعتماد وقواعد الاحتيال وحدود الإشعارات وسياسة التقييمات وحدود الاستخدام والمخزون والأمان وضوابط الإطلاق. كل تغيير يُتحقق منه ويعتمده شخص آخر ويُرقّم ويمكن التراجع عنه.',
  ],
  's9.cfg.tab.requests': ['Changes to approve', 'تغييرات للاعتماد'],
  's9.cfg.tab.reasons': ['Reasons', 'الأسباب'],
  's9.cfg.tab.sla': ['Service levels', 'مستويات الخدمة'],
  's9.cfg.tab.approvals': ['Approvals and thresholds', 'الاعتمادات والحدود'],
  's9.cfg.tab.risk': ['Fraud rules', 'قواعد الاحتيال'],
  's9.cfg.tab.notify': ['Notifications and restrictions', 'الإشعارات والقيود'],
  's9.cfg.tab.reviews': ['Review policy', 'سياسة التقييمات'],
  's9.cfg.tab.platform': ['Redemption, inventory and security', 'الاستخدام والمخزون والأمان'],
  's9.cfg.tab.launch': ['Launch controls', 'ضوابط الإطلاق'],
  's9.cfg.tab.history': ['History and rollback', 'السجل والتراجع'],
  's9.cfg.effective': ['Takes effect', 'يسري من'],
  's9.cfg.effectiveHelp': [
    'Leave empty to apply as soon as it is approved.',
    'اتركه فارغاً ليُطبَّق فور اعتماده.',
  ],
  's9.cfg.propose': ['Propose change', 'اقتراح التغيير'],
  's9.cfg.proposed': [
    'Change proposed. A second person must approve it.',
    'تم اقتراح التغيير. يجب أن يعتمده شخص آخر.',
  ],
  's9.cfg.approvalNote': [
    'You cannot approve your own change. Nothing changes until it is approved.',
    'لا يمكنك اعتماد تغييرك. لا يتغير شيء حتى يُعتمد.',
  ],
  's9.cfg.status.PENDING_APPROVAL': ['Waiting for approval', 'بانتظار الاعتماد'],
  's9.cfg.status.SCHEDULED': ['Approved, takes effect later', 'معتمد، يسري لاحقاً'],
  's9.cfg.status.APPLIED': ['In effect', 'سارٍ'],
  's9.cfg.status.REJECTED': ['Rejected', 'مرفوض'],
  's9.cfg.status.CANCELLED': ['Withdrawn', 'مسحوب'],
  's9.cfg.status.SUPERSEDED': [
    'Not applied (the setting changed first)',
    'لم يُطبَّق (تغيّر الإعداد أولاً)',
  ],
  's9.cfg.restores': ['Restores', 'يستعيد'],
  's9.cfg.approved': ['Change approved.', 'تم اعتماد التغيير.'],
  's9.cfg.rejected': ['Change rejected.', 'تم رفض التغيير.'],
  's9.cfg.withdraw': ['Withdraw', 'سحب'],
  's9.cfg.withdrawn': ['Change withdrawn.', 'تم سحب التغيير.'],
  's9.cfg.open': ['Waiting for a decision', 'بانتظار القرار'],
  's9.cfg.noOpen': ['No changes waiting.', 'لا توجد تغييرات بانتظار القرار.'],
  's9.cfg.recent': ['Recent decisions', 'آخر القرارات'],
  's9.cfg.list': ['List', 'القائمة'],
  's9.cfg.reasons.refund': ['Refund reasons', 'أسباب الاسترداد'],
  's9.cfg.reasons.dispute': ['Case reasons', 'أسباب القضايا'],
  's9.cfg.reasons.adjustment': ['Adjustment reasons', 'أسباب التسويات'],
  's9.cfg.reasons.hold': ['Restriction and hold reasons', 'أسباب القيود والإيقافات'],
  's9.cfg.reasons.moderation': ['Moderation reasons', 'أسباب الإشراف'],
  's9.cfg.labelEn': ['English label', 'التسمية بالإنجليزية'],
  's9.cfg.labelAr': ['Arabic label', 'التسمية بالعربية'],
  's9.cfg.remove': ['Remove', 'إزالة'],
  's9.cfg.addReason': ['Add a reason', 'إضافة سبب'],
  's9.cfg.reasonRules': [
    'Each reason needs a unique code (capital letters, digits, _) and both labels.',
    'يحتاج كل سبب إلى رمز فريد (أحرف كبيرة وأرقام و _) وكلتا التسميتين.',
  ],
  's9.cfg.hours': ['hours', 'ساعات'],
  's9.cfg.warnPct': ['Warn at (% of the target)', 'التنبيه عند (% من الهدف)'],
  's9.cfg.mode': ['Second person', 'الشخص الثاني'],
  's9.cfg.threshold': ['Above', 'أعلى من'],
  's9.cfg.modes.ALWAYS': ['Always', 'دائماً'],
  's9.cfg.modes.ABOVE_THRESHOLD': ['Above the amount', 'أعلى من المبلغ'],
  's9.cfg.modes.NEVER': ['Never', 'أبداً'],
  's9.cfg.directMax': ['Direct adjustment limit', 'حد التسوية المباشرة'],
  's9.cfg.caseAbove': ['Case resolutions need approval above', 'حلول القضايا تحتاج اعتماداً فوق'],
  's9.cfg.caseAboveHelp': ['Leave empty: never.', 'اتركه فارغاً: أبداً.'],
  's9.cfg.rule': ['Rule', 'القاعدة'],
  's9.cfg.enabled': ['On', 'مفعّلة'],
  's9.cfg.window': ['Window (minutes)', 'المدة (دقائق)'],
  's9.cfg.decision': ['Decision', 'القرار'],
  's9.cfg.maxAttempts': ['Delivery attempts', 'محاولات التوصيل'],
  's9.cfg.retryMinutes': ['Minutes between retries', 'الدقائق بين المحاولات'],
  's9.cfg.retryHelp': [
    'Comma-separated, for example 5, 30, 120.',
    'مفصولة بفواصل، مثل 5، 30، 120.',
  ],
  's9.cfg.throttle': [
    'Messages per person per channel per hour',
    'الرسائل لكل شخص لكل قناة في الساعة',
  ],
  's9.cfg.maxDays': ['Longest restriction or hold (days)', 'أطول قيد أو إيقاف (أيام)'],
  's9.cfg.reviewMode': ['Publishing', 'النشر'],
  's9.cfg.reviewModes.PUBLISH_THEN_MODERATE': [
    'Publish, then moderate reports',
    'النشر ثم مراجعة البلاغات',
  ],
  's9.cfg.reviewModes.PRE_MODERATION': ['Approve before publishing', 'الاعتماد قبل النشر'],
  's9.cfg.perMerchantDays': [
    'One review per merchant every (days)',
    'تقييم واحد لكل تاجر كل (أيام)',
  ],
  's9.cfg.minText': ['Shortest review (characters)', 'أقصر تقييم (أحرف)'],
  's9.cfg.hideAfter': ['Hide after this many reports', 'الإخفاء بعد هذا العدد من البلاغات'],
  's9.cfg.control': ['Control', 'الضابط'],
  's9.cfg.group.REDEMPTION': ['Redemption', 'الاستخدام'],
  's9.cfg.group.INVENTORY': ['Inventory', 'المخزون'],
  's9.cfg.group.SECURITY': ['Security', 'الأمان'],
  's9.cfg.scalar.redemption.manual_attempts_per_minute': [
    'Manual code attempts per minute (staff)',
    'محاولات إدخال الرمز يدوياً في الدقيقة (الموظفون)',
  ],
  's9.cfg.scalar.redemption.reversal_window_hours': [
    'Hours a redemption can be reversed',
    'الساعات المسموح فيها بعكس الاستخدام',
  ],
  's9.cfg.scalar.reservation.hold_minutes': ['Reservation hold (minutes)', 'مدة حجز العرض (دقائق)'],
  's9.cfg.scalar.reservation.max_active': [
    'Active reservations per customer',
    'الحجوزات النشطة لكل عميل',
  ],
  's9.cfg.scalar.vouchers.checkout_hold_minutes': [
    'Voucher checkout hold (minutes)',
    'مدة حجز القسيمة عند الدفع (دقائق)',
  ],
  's9.cfg.scalar.auth.otp.max_attempts': [
    'Code attempts per sign-in code',
    'المحاولات لكل رمز دخول',
  ],
  's9.cfg.scalar.auth.otp.max_requests_per_hour': [
    'Sign-in codes per number per hour',
    'رموز الدخول لكل رقم في الساعة',
  ],
  's9.cfg.scalar.auth.password.max_failed_attempts': [
    'Wrong passwords before a lock',
    'كلمات المرور الخاطئة قبل القفل',
  ],
  's9.cfg.pointsRounding': [
    'Points taken back on a partial refund',
    'النقاط المستردة عند الاسترداد الجزئي',
  ],
  's9.cfg.pointsRoundingHelp': [
    'Points × refunded share, rounded this way. A full refund always takes back everything.',
    'النقاط × الحصة المستردة، مقرّبة بهذه الطريقة. الاسترداد الكامل يسترد كل النقاط دائماً.',
  ],
  's9.cfg.rounding.FLOOR': [
    'Round down (in the customer’s favour)',
    'التقريب للأسفل (لصالح العميل)',
  ],
  's9.cfg.rounding.NEAREST': ['Round to nearest', 'التقريب لأقرب عدد'],
  's9.cfg.rounding.CEIL': ['Round up', 'التقريب للأعلى'],
  's9.cfg.setting': ['Setting', 'الإعداد'],
  's9.cfg.rollback': ['Propose going back to this version', 'اقتراح العودة لهذا الإصدار'],

  // ---------------------------------------------------------------- launch controls
  's9.launch.pilot': ['Controlled pilot', 'التجربة المحدودة'],
  's9.launch.pilotIntro': [
    'During a pilot, only the business accounts listed here take new customers or launch campaigns. Everything already issued stays valid.',
    'خلال التجربة، فقط الحسابات التجارية المدرجة هنا تستقبل عملاء جدداً أو تطلق حملات. كل ما صدر يبقى صالحاً.',
  ],
  's9.launch.mode': ['Who is live', 'من هو متاح'],
  's9.launch.open': ['Every enabled business', 'كل نشاط تجاري مفعّل'],
  's9.launch.allowlist': ['Only the listed businesses (pilot)', 'فقط الأنشطة المدرجة (تجربة)'],
  's9.launch.merchants': ['Merchant business account IDs', 'معرّفات الحسابات التجارية للتجار'],
  's9.launch.partners': ['Partner business account IDs', 'معرّفات الحسابات التجارية للشركاء'],
  's9.launch.idsHelp': ['One ID per line.', 'معرّف واحد في كل سطر.'],
  's9.launch.stops': ['Emergency stops', 'الإيقاف الطارئ'],
  's9.launch.stopsIntro': [
    'A stop takes effect at once for the whole market and refuses only NEW actions. Vouchers, reservations and points customers already hold stay valid. Record why.',
    'يسري الإيقاف فوراً على السوق كله ويرفض الإجراءات الجديدة فقط. القسائم والحجوزات والنقاط التي يملكها العملاء تبقى صالحة. سجّل السبب.',
  ],
  's9.launch.action.NEW_PURCHASES': ['New voucher purchases', 'شراء قسائم جديدة'],
  's9.launch.action.NEW_RESERVATIONS': ['New reservations', 'حجوزات جديدة'],
  's9.launch.action.NEW_VIEWS': ['New Watch & Earn views', 'مشاهدات جديدة في شاهد واكسب'],
  's9.launch.action.NEW_CAMPAIGNS': ['New campaigns going live', 'إطلاق حملات جديدة'],
  's9.launch.isStopped': ['stopped', 'موقوف'],
  's9.launch.isOpen': ['open', 'مفتوح'],
  's9.launch.stop': ['Stop', 'إيقاف'],
  's9.launch.lift': ['Lift stop', 'رفع الإيقاف'],
  's9.launch.stopped': [
    'Stopped. Only new actions are refused.',
    'تم الإيقاف. تُرفض الإجراءات الجديدة فقط.',
  ],
  's9.launch.lifted': ['Stop lifted.', 'تم رفع الإيقاف.'],

  // ---------------------------------------------------------------- B1 / B2: settlement
  's9.set.instruct': ['Send payout to the provider', 'إرسال الدفعة إلى المزوّد'],
  's9.set.instructed': [
    'Payout sent. The statement waits for the bank’s answer.',
    'تم إرسال الدفعة. ينتظر الكشف رد البنك.',
  ],
  's9.set.instructNote': [
    'A finance approver who did not prepare the statement sends it. Failed payouts can be sent again a limited number of times.',
    'يرسلها معتمد مالي لم يُعدّ الكشف. يمكن إعادة إرسال الدفعات الفاشلة لعدد محدود من المرات.',
  ],
  's9.set.pending': [
    'The payout was sent and is waiting for the bank or payout provider.',
    'تم إرسال الدفعة وهي بانتظار البنك أو مزوّد الدفع.',
  ],
  's9.set.reserve': ['Reserve withheld', 'الاحتياطي المحتجز'],
  's9.set.reserveReleased': ['Earlier reserves released', 'احتياطيات سابقة مُفرج عنها'],

  // ---------------------------------------------------------------- B2 / B3 vocabulary
  's8.setStatus.PAYOUT_PENDING': [
    'Payout sent, waiting for the bank',
    'تم إرسال الدفعة، بانتظار البنك',
  ],
  's8.payout.INSTRUCTED': ['Sent to the payout provider', 'أُرسلت إلى مزوّد الدفع'],
  's8.suppressed.THROTTLED': [
    'Too many messages this hour (limit)',
    'رسائل كثيرة في هذه الساعة (الحد)',
  ],
} as const satisfies Record<string, readonly [string, string]>;

type Stage9Pairs = typeof S9;
export type Stage9Key = keyof Stage9Pairs;
const pick = (index: 0 | 1) =>
  Object.fromEntries(Object.entries(S9).map(([k, v]) => [k, v[index]])) as Record<
    Stage9Key,
    string
  >;

export const enStage9 = pick(0);
export const arStage9 = pick(1);
