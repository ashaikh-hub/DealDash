import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { liveDealContentSchema, type LiveDealContentInput } from '@dealdash/validation';
import type { LiveDealAction, LiveDealStatus } from '@dealdash/types';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { denormalize } from '../live-deals/deal-content';
import { EligibilityService } from '../live-deals/eligibility.service';
import type { PrismaService } from '../prisma/prisma.service';
import { makeDevImagePng, type Rgb } from './png';
import type { seedStage2 } from './stage2-seed';

export interface Stage3SeedInput {
  prisma: PrismaClient;
  organizations: Record<string, string>;
  branches: Record<string, string>;
  passwordHash: string;
  roles: Map<string, string>;
  storageDir?: string;
  accounts: Array<{
    email?: string;
    mobile?: string;
    role: string;
    organization: string;
    audience: string;
    branch?: string;
  }>;
  helpers: Awaited<ReturnType<typeof seedStage2>>;
}

const DAY = 86_400_000;
const bi = (en: string, ar: string) => ({ en, ar });

/** Placeholder palettes per category (development imagery only; real merchants upload their own photos). */
const PALETTE: Record<string, [Rgb, Rgb]> = {
  dining: [
    [255, 122, 89],
    [88, 24, 69],
  ],
  cafes: [
    [226, 170, 104],
    [74, 44, 32],
  ],
  beauty_wellness: [
    [255, 143, 177],
    [110, 40, 98],
  ],
  fitness: [
    [45, 212, 191],
    [15, 23, 42],
  ],
  shopping: [
    [96, 165, 250],
    [30, 27, 75],
  ],
};

type Merchant = 'merchantA' | 'merchantB' | 'najd' | 'bloom' | 'pulse' | 'page';

interface SeedDeal {
  org: Merchant;
  category: keyof typeof PALETTE;
  status: LiveDealStatus;
  mechanic: LiveDealContentInput['mechanic'];
  value: number | null;
  label: { en: string; ar: string };
  title: { en: string; ar: string };
  short: { en: string; ar: string };
  description: { en: string; ar: string };
  terms: { en: string; ar: string; blocks?: Record<string, unknown> };
  branchNames: string[];
  startDays: number;
  endDays: number | null;
  eligibility?: { kind: 'EMPLOYER' | 'BANK_CARD' | 'SCHEME' | 'GEOGRAPHY'; ref: string };
  images?: number;
  feedback?: { en: string; ar: string };
  revision?: {
    value: number;
    label: { en: string; ar: string };
    title: { en: string; ar: string };
  };
  pausedBy?: 'MERCHANT' | 'DEALDASH';
  suspendedReason?: { en: string; ar: string };
  /** Relative popularity for the demo discovery signals. */
  weight?: number;
}

const DEALS: SeedDeal[] = [
  {
    org: 'merchantA',
    category: 'dining',
    status: 'LIVE',
    mechanic: 'PERCENTAGE_OFF',
    value: 30,
    label: bi('30% off', 'خصم 30%'),
    title: bi('30% off the tasting menu', 'خصم 30% على قائمة التذوق'),
    short: bi('Dinner for two, seven courses', 'عشاء لشخصين، سبعة أطباق'),
    description: bi(
      'Enjoy our seven-course tasting menu for two at 30% off, every evening. Seasonal dishes from our grill, finished with a dessert of the day.',
      'استمتعوا بقائمة التذوق ذات الأطباق السبعة لشخصين بخصم 30% كل مساء. أطباق موسمية من الشواية، وتُختم بحلوى اليوم.',
    ),
    terms: {
      en: 'Valid for dinner service only. Booking recommended.',
      ar: 'صالح لخدمة العشاء فقط. يُنصح بالحجز المسبق.',
      blocks: { fullPriceItemsOnly: true, validFrom: '18:00', validTo: '23:00' },
    },
    branchNames: ['Harbour Grill Olaya', 'Harbour Grill Al Malqa'],
    startDays: -5,
    endDays: 9,
    images: 2,
    weight: 10,
  },
  {
    org: 'merchantA',
    category: 'dining',
    status: 'SCHEDULED',
    mechanic: 'EVERYDAY_PROMOTION',
    value: null,
    label: bi('Free dessert', 'حلى مجاني'),
    title: bi('Free dessert with any main course', 'حلى مجاني مع أي طبق رئيسي'),
    short: bi('Starts this week at Olaya', 'يبدأ هذا الأسبوع في العليا'),
    description: bi(
      'Choose any main course and pick a dessert on the house. One free dessert per main course.',
      'اختاروا أي طبق رئيسي واحصلوا على حلى من اختياركم هدية من المطعم. حلى مجاني واحد لكل طبق رئيسي.',
    ),
    terms: {
      en: 'Dessert menu items only. Not valid with other offers.',
      ar: 'ينطبق على أصناف قائمة الحلويات فقط. لا يُجمع مع عروض أخرى.',
      blocks: { notCombinable: true },
    },
    branchNames: ['Harbour Grill Olaya'],
    startDays: 2,
    endDays: 16,
  },
  {
    org: 'merchantA',
    category: 'dining',
    status: 'PENDING_REVIEW',
    mechanic: 'AMOUNT_OFF',
    value: 15,
    label: bi('SAR 15 off', 'خصم 15 ريال'),
    title: bi('Lunch combo: SAR 15 off', 'وجبة الغداء: خصم 15 ريالاً'),
    short: bi('Any main with a drink', 'أي طبق رئيسي مع مشروب'),
    description: bi(
      'Order any main course with a soft drink at lunchtime and take SAR 15 off the bill.',
      'اطلبوا أي طبق رئيسي مع مشروب غازي وقت الغداء واحصلوا على خصم 15 ريالاً من الفاتورة.',
    ),
    terms: {
      en: 'Monday to Thursday, 12:00 to 16:00.',
      ar: 'من الاثنين إلى الخميس، من 12:00 إلى 16:00.',
      blocks: { validDays: ['mon', 'tue', 'wed', 'thu'], validFrom: '12:00', validTo: '16:00' },
    },
    branchNames: ['Harbour Grill Olaya'],
    startDays: 1,
    endDays: 30,
  },
  {
    org: 'merchantA',
    category: 'dining',
    status: 'NEEDS_CHANGES',
    mechanic: 'PERCENTAGE_OFF',
    value: 20,
    label: bi('20% off', 'خصم 20%'),
    title: bi('Weekend brunch 20% off', 'بوفيه عطلة نهاية الأسبوع بخصم 20%'),
    short: bi('Friday and Saturday brunch', 'إفطار الجمعة والسبت'),
    description: bi(
      'A relaxed weekend brunch with live grill stations. Enjoy 20% off for tables of four or more.',
      'إفطار هادئ في عطلة نهاية الأسبوع مع محطات شواء مباشرة. خصم 20% للطاولات من أربعة أشخاص فأكثر.',
    ),
    terms: {
      en: 'Valid Friday and Saturday.',
      ar: 'صالح يومي الجمعة والسبت.',
      blocks: { validDays: ['fri', 'sat'] },
    },
    branchNames: ['Harbour Grill Al Malqa'],
    startDays: 3,
    endDays: 40,
    feedback: {
      en: 'Please state the minimum table size in the terms and add a clear end date.',
      ar: 'يرجى ذكر الحد الأدنى لحجم الطاولة في الشروط وإضافة تاريخ انتهاء واضح.',
    },
  },
  {
    org: 'merchantA',
    category: 'dining',
    status: 'LIVE',
    mechanic: 'PERCENTAGE_OFF',
    value: 25,
    label: bi('25% off', 'خصم 25%'),
    title: bi('Team lunch: 25% off for employees', 'غداء الفريق: خصم 25% للموظفين'),
    short: bi('For verified Sample Employer staff', 'لموظفي شركة صاحب العمل المعتمدين'),
    description: bi(
      'Verified employees of our partner employer enjoy 25% off lunch for groups of three or more.',
      'يحصل موظفو جهة العمل الشريكة المعتمدون على خصم 25% على الغداء للمجموعات من ثلاثة أشخاص فأكثر.',
    ),
    terms: { en: 'Show your employee ID at the till.', ar: 'أبرزوا بطاقة الموظف عند الدفع.' },
    branchNames: ['Harbour Grill Olaya'],
    startDays: -3,
    endDays: 60,
    eligibility: { kind: 'EMPLOYER', ref: 'employer' },
    weight: 4,
  },
  {
    org: 'merchantA',
    category: 'dining',
    status: 'LIVE',
    mechanic: 'PERCENTAGE_OFF',
    value: 15,
    label: bi('15% off', 'خصم 15%'),
    title: bi('15% off with Riyad Bank cards', 'خصم 15% ببطاقات بنك الرياض'),
    short: bi('Pay with your eligible card', 'ادفعوا ببطاقتكم المؤهلة'),
    description: bi(
      'Pay the bill with an eligible Riyad Bank card and enjoy 15% off your meal.',
      'ادفعوا الفاتورة ببطاقة بنك الرياض المؤهلة واستمتعوا بخصم 15% على وجبتكم.',
    ),
    terms: {
      en: 'Valid on the final bill before tips.',
      ar: 'ينطبق على الفاتورة النهائية قبل الإكرامية.',
    },
    branchNames: ['Harbour Grill Olaya', 'Harbour Grill Al Malqa'],
    startDays: -8,
    endDays: 52,
    eligibility: { kind: 'BANK_CARD', ref: 'bank' },
    weight: 3,
  },
  {
    org: 'merchantA',
    category: 'dining',
    status: 'LIVE',
    mechanic: 'PERCENTAGE_OFF',
    value: 20,
    label: bi('20% off', 'خصم 20%'),
    title: bi('Family grill platter 20% off', 'طبق المشويات العائلي بخصم 20%'),
    short: bi('Serves four to five', 'يكفي أربعة إلى خمسة أشخاص'),
    description: bi(
      'Our mixed grill platter for the whole family, with rice, salads and sauces, at 20% off.',
      'طبق المشويات المشكلة للعائلة كاملة، مع الأرز والسلطات والصلصات، بخصم 20%.',
    ),
    terms: { en: 'Dine in only.', ar: 'للأكل داخل المطعم فقط.' },
    branchNames: ['Harbour Grill Al Malqa'],
    startDays: -6,
    endDays: 20,
    revision: {
      value: 35,
      label: bi('35% off', 'خصم 35%'),
      title: bi('Family grill platter 35% off', 'طبق المشويات العائلي بخصم 35%'),
    },
    weight: 6,
  },
  {
    org: 'merchantB',
    category: 'cafes',
    status: 'LIVE',
    mechanic: 'BOGO',
    value: null,
    label: bi('Buy 1 get 1', 'اشترِ 1 واحصل على 1'),
    title: bi('Buy one get one free on smoothies', 'اشترِ سموذي واحصل على الثاني مجاناً'),
    short: bi('All day at KAFD', 'طوال اليوم في المركز المالي'),
    description: bi(
      'Buy any smoothie and get a second one free. Fresh fruit, blended to order.',
      'اشتروا أي سموذي واحصلوا على الثاني مجاناً. فواكه طازجة تُحضَّر عند الطلب.',
    ),
    terms: {
      en: 'The free smoothie must be of equal or lesser value.',
      ar: 'يجب أن يكون السموذي المجاني بنفس القيمة أو أقل.',
    },
    branchNames: ['Daily Dose KAFD'],
    startDays: -2,
    endDays: null,
    images: 2,
    weight: 9,
  },
  {
    org: 'merchantB',
    category: 'cafes',
    status: 'PAUSED',
    mechanic: 'BUNDLE',
    value: null,
    label: bi('3 for SAR 45', '3 بـ 45 ريال'),
    title: bi('Cold-pressed juice bundle', 'باقة العصائر المعصورة على البارد'),
    short: bi('Three bottles, one price', 'ثلاث زجاجات بسعر واحد'),
    description: bi(
      'Pick any three cold-pressed juices for SAR 45. Paused while we restock.',
      'اختاروا أي ثلاثة عصائر معصورة على البارد بـ 45 ريالاً. متوقف مؤقتاً حتى يتوفر المخزون.',
    ),
    terms: { en: 'While stock lasts.', ar: 'حتى نفاد الكمية.' },
    branchNames: ['Daily Dose KAFD'],
    startDays: -10,
    endDays: 25,
    pausedBy: 'MERCHANT',
  },
  {
    org: 'merchantB',
    category: 'cafes',
    status: 'EXPIRED',
    mechanic: 'PERCENTAGE_OFF',
    value: 15,
    label: bi('15% off', 'خصم 15%'),
    title: bi('Summer coolers 15% off', 'مشروبات الصيف المنعشة بخصم 15%'),
    short: bi('Iced drinks all month', 'مشروبات باردة طوال الشهر'),
    description: bi(
      'Beat the heat with 15% off every iced drink.',
      'تغلبوا على الحر مع خصم 15% على كل المشروبات الباردة.',
    ),
    terms: { en: 'Iced drinks only.', ar: 'للمشروبات الباردة فقط.' },
    branchNames: ['Daily Dose KAFD'],
    startDays: -40,
    endDays: -5,
  },
  {
    org: 'najd',
    category: 'dining',
    status: 'LIVE',
    mechanic: 'AMOUNT_OFF',
    value: 40,
    label: bi('SAR 40 off', 'خصم 40 ريالاً'),
    title: bi('Family meal: SAR 40 off', 'وجبة العائلة: خصم 40 ريالاً'),
    short: bi('Traditional Najdi feast', 'مائدة نجدية تقليدية'),
    description: bi(
      'Share a traditional Najdi family meal, kabsa and sides included, and take SAR 40 off.',
      'شاركوا مائدة نجدية عائلية تقليدية تشمل الكبسة والأطباق الجانبية واحصلوا على خصم 40 ريالاً.',
    ),
    terms: {
      en: 'Minimum spend SAR 200.',
      ar: 'الحد الأدنى للإنفاق 200 ريال.',
      blocks: { minimumSpendHalalas: 20000 },
    },
    branchNames: ['Najd Kitchen Al Nakheel', 'Najd Kitchen Hittin'],
    startDays: -4,
    endDays: 14,
    images: 2,
    weight: 8,
  },
  {
    org: 'najd',
    category: 'dining',
    status: 'LIVE',
    mechanic: 'SERVICE_OFFER',
    value: null,
    label: bi('Free coffee', 'قهوة مجانية'),
    title: bi('Free Arabic coffee for mada card holders', 'قهوة عربية مجانية لحاملي بطاقة مدى'),
    short: bi('With any meal', 'مع أي وجبة'),
    description: bi(
      'Pay with a participating card scheme and receive a pot of Arabic coffee on the house.',
      'ادفعوا عبر شبكة بطاقات مشاركة واحصلوا على دلة قهوة عربية هدية من المطعم.',
    ),
    terms: { en: 'One pot per table.', ar: 'دلة واحدة لكل طاولة.' },
    branchNames: ['Najd Kitchen Al Nakheel'],
    startDays: -2,
    endDays: 45,
    eligibility: { kind: 'SCHEME', ref: 'scheme' },
    weight: 2,
  },
  {
    org: 'bloom',
    category: 'beauty_wellness',
    status: 'LIVE',
    mechanic: 'PERCENTAGE_OFF',
    value: 20,
    label: bi('20% off', 'خصم 20%'),
    title: bi('20% off your first facial', 'خصم 20% على أول جلسة عناية بالبشرة'),
    short: bi('Deep cleansing and glow facial', 'تنظيف عميق وإشراقة للبشرة'),
    description: bi(
      'New clients enjoy 20% off a 60-minute deep cleansing facial with a certified therapist.',
      'يحصل العملاء الجدد على خصم 20% على جلسة تنظيف عميق للبشرة لمدة 60 دقيقة مع أخصائية معتمدة.',
    ),
    terms: {
      en: 'New clients only. Appointment required.',
      ar: 'للعملاء الجدد فقط. الموعد مطلوب.',
    },
    branchNames: ['Bloom Beauty Olaya'],
    startDays: -7,
    endDays: 21,
    images: 2,
    weight: 7,
  },
  {
    org: 'pulse',
    category: 'fitness',
    status: 'LIVE',
    mechanic: 'PERCENTAGE_OFF',
    value: 50,
    label: bi('50% off', 'خصم 50%'),
    title: bi('First month 50% off', 'الشهر الأول بنصف السعر'),
    short: bi('Full gym access, no joining fee', 'دخول كامل للنادي بدون رسوم انضمام'),
    description: bi(
      'Join Pulse Fitness Club and pay half price for your first month, with full access to equipment and classes.',
      'انضموا إلى نادي بلس للياقة وادفعوا نصف السعر للشهر الأول مع دخول كامل للأجهزة والحصص.',
    ),
    terms: { en: 'New members only.', ar: 'للأعضاء الجدد فقط.' },
    branchNames: ['Pulse Fitness Al Malqa', 'Pulse Fitness KAFD'],
    startDays: -9,
    endDays: 30,
    images: 2,
    weight: 8,
  },
  {
    org: 'pulse',
    category: 'fitness',
    status: 'SUSPENDED',
    mechanic: 'SERVICE_OFFER',
    value: null,
    label: bi('Free trial week', 'أسبوع تجريبي مجاني'),
    title: bi('Free trial week', 'أسبوع تجريبي مجاني'),
    short: bi('Seven days, no commitment', 'سبعة أيام بلا التزام'),
    description: bi('Try the club free for seven days.', 'جرّبوا النادي مجاناً لمدة سبعة أيام.'),
    terms: { en: 'One trial per person.', ar: 'تجربة واحدة لكل شخص.' },
    branchNames: ['Pulse Fitness KAFD'],
    startDays: -12,
    endDays: 18,
    suspendedReason: {
      en: 'Under review after customer reports about unavailable trial slots.',
      ar: 'قيد المراجعة بعد بلاغات من العملاء عن عدم توفر مواعيد التجربة.',
    },
  },
  {
    org: 'page',
    category: 'shopping',
    status: 'LIVE',
    mechanic: 'PERCENTAGE_OFF',
    value: 10,
    label: bi('10% off', 'خصم 10%'),
    title: bi("Riyadh readers' week: 10% off novels", 'أسبوع قرّاء الرياض: خصم 10% على الروايات'),
    short: bi('Fiction in Arabic and English', 'روايات بالعربية والإنجليزية'),
    description: bi(
      'Every novel in the shop is 10% off for residents of Riyadh. Ask our team for recommendations.',
      'جميع الروايات في المكتبة بخصم 10% لسكان الرياض. اسألوا فريقنا عن التوصيات.',
    ),
    terms: { en: 'Excludes textbooks and stationery.', ar: 'لا يشمل الكتب الدراسية والقرطاسية.' },
    branchNames: ['Page & Co Diriyah'],
    startDays: -1,
    endDays: 7,
    eligibility: { kind: 'GEOGRAPHY', ref: 'Riyadh' },
    weight: 3,
  },
];

const NEW_MERCHANTS: Array<{
  key: Exclude<Merchant, 'merchantA' | 'merchantB'>;
  nameEn: string;
  nameAr: string;
  email: string;
  mobile: string;
  category: string;
  ref: string;
  cr: string;
  iban: string;
  descriptionEn: string;
  descriptionAr: string;
  branches: Array<[string, string, number, number]>;
}> = [
  {
    key: 'najd',
    nameEn: 'Najd Kitchen',
    nameAr: 'نجد كيتشن',
    email: 'owner@najdkitchen.test',
    mobile: '+966500000211',
    category: 'restaurants',
    ref: 'DD-M-3001',
    cr: '1010000006',
    iban: '000000000000000006',
    descriptionEn: 'Traditional Najdi cooking, kabsa and family platters in the heart of Riyadh.',
    descriptionAr: 'مطبخ نجدي تقليدي، كبسة ومائدة عائلية في قلب الرياض.',
    branches: [
      ['Najd Kitchen Al Nakheel', 'نجد كيتشن النخيل', 24.7745, 46.7384],
      ['Najd Kitchen Hittin', 'نجد كيتشن حطين', 24.7594, 46.6097],
    ],
  },
  {
    key: 'bloom',
    nameEn: 'Bloom Beauty Studio',
    nameAr: 'استوديو بلوم للجمال',
    email: 'owner@bloombeauty.test',
    mobile: '+966500000212',
    category: 'beauty',
    ref: 'DD-M-3002',
    cr: '1010000007',
    iban: '000000000000000007',
    descriptionEn: 'A calm studio for skin care, hair and nails with certified therapists.',
    descriptionAr: 'استوديو هادئ للعناية بالبشرة والشعر والأظافر مع أخصائيات معتمدات.',
    branches: [['Bloom Beauty Olaya', 'بلوم للجمال العليا', 24.6989, 46.6867]],
  },
  {
    key: 'pulse',
    nameEn: 'Pulse Fitness Club',
    nameAr: 'نادي بلس للياقة',
    email: 'owner@pulsefitness.test',
    mobile: '+966500000213',
    category: 'fitness',
    ref: 'DD-M-3003',
    cr: '1010000008',
    iban: '000000000000000008',
    descriptionEn: 'Modern equipment, group classes and personal coaching, open late.',
    descriptionAr: 'أجهزة حديثة وحصص جماعية وتدريب شخصي، ونفتح حتى وقت متأخر.',
    branches: [
      ['Pulse Fitness Al Malqa', 'بلس للياقة الملقا', 24.8152, 46.6301],
      ['Pulse Fitness KAFD', 'بلس للياقة المركز المالي', 24.7701, 46.6402],
    ],
  },
  {
    key: 'page',
    nameEn: 'Page & Co Books',
    nameAr: 'مكتبة بيج آند كو',
    email: 'owner@pageandco.test',
    mobile: '+966500000214',
    category: 'retail',
    ref: 'DD-M-3004',
    cr: '1010000009',
    iban: '000000000000000009',
    descriptionEn:
      'An independent bookshop with Arabic and English fiction, non-fiction and a reading corner.',
    descriptionAr: 'مكتبة مستقلة تضم روايات وكتباً بالعربية والإنجليزية وركناً للقراءة.',
    branches: [['Page & Co Diriyah', 'مكتبة بيج آند كو الدرعية', 24.7341, 46.5766]],
  },
];

/** Deterministic pseudo-random numbers so a re-seed produces the same demo numbers. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Stage 3 development data: a few more fully onboarded Riyadh merchants, about 16 bilingual Live Deals in every
 * lifecycle state (including one proposed new version waiting for review), sample customers with and without benefits,
 * and a modest set of synthetic discovery signals so the merchant and admin analytics are not empty.
 * Everything is idempotent and clearly development data.
 */
export async function seedStage3(input: Stage3SeedInput) {
  const { prisma, organizations, passwordHash, roles, helpers, accounts } = input;

  // ---------------------------------------------------------------- partners used by eligibility examples
  async function partner(
    key: string,
    type: 'EMPLOYER' | 'BANK' | 'SCHEME',
    nameEn: string,
    nameAr: string,
  ) {
    if (organizations[key]) return organizations[key]!;
    let org = await prisma.organization.findFirst({ where: { type: 'PARTNER', nameEn } });
    if (!org) {
      org = await prisma.organization.create({
        data: {
          type: 'PARTNER',
          nameEn,
          nameAr,
          partner: { create: { partnerType: type, legalName: nameEn } },
        },
      });
    }
    return (organizations[key] = org.id);
  }
  const bankId = await partner('bank', 'BANK', 'Riyad Bank (sample)', 'بنك الرياض (تجريبي)');
  const employerId = await partner(
    'employer',
    'EMPLOYER',
    'Sample Employer Co.',
    'شركة صاحب العمل (تجريبي)',
  );
  const schemeId = await partner('scheme', 'SCHEME', 'Mada Cards (sample)', 'بطاقات مدى (تجريبي)');
  const refs: Record<string, string> = {
    bank: bankId,
    employer: employerId,
    scheme: schemeId,
    Riyadh: 'Riyadh',
  };

  // ---------------------------------------------------------------- merchants
  for (const m of NEW_MERCHANTS) {
    await helpers.newMerchant(m.key, m.nameEn, m.nameAr, m.email, m.mobile);
    const orgId = organizations[m.key]!;
    for (const [en, ar, lat, lng] of m.branches) await helpers.branchFor(orgId, en, ar, lat, lng);
    await helpers.fill({
      key: m.key,
      legal: [`${m.nameEn} Co.`, `شركة ${m.nameAr}`],
      trade: [m.nameEn, m.nameAr],
      category: m.category,
      ref: m.ref,
      status: 'APPROVED',
      ownerEmail: m.email,
      full: true,
      cr: m.cr,
      ibanAccount: m.iban,
      mobile: m.mobile,
      orgStatus: 'ACTIVE',
    });
    await prisma.merchant.update({
      where: { organizationId: orgId },
      data: {
        descriptionEn: m.descriptionEn,
        descriptionAr: m.descriptionAr,
        businessPhone: '+966112345678',
      },
    });
    accounts.push({
      email: m.email,
      role: 'MERCHANT_OWNER',
      organization: m.key,
      audience: 'merchant',
    });
  }
  for (const [key, descEn, descAr] of [
    [
      'merchantA',
      'Charcoal grill, seasonal tasting menus and family platters.',
      'مشويات على الفحم وقوائم تذوق موسمية ومائدة عائلية.',
    ],
    [
      'merchantB',
      'Fresh juices, smoothies and light bites in the financial district.',
      'عصائر طازجة وسموذي ووجبات خفيفة في المركز المالي.',
    ],
  ] as const) {
    await prisma.merchant.update({
      where: { organizationId: organizations[key]! },
      data: { descriptionEn: descEn, descriptionAr: descAr, businessPhone: '+966112345601' },
    });
  }

  // ---------------------------------------------------------------- merchant imagery (development placeholders)
  async function writeFile_(key: string, data: Buffer) {
    if (!input.storageDir) return;
    const p = resolve(input.storageDir, key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async function dealImage(
    orgId: string,
    name: string,
    w: number,
    h: number,
    palette: [Rgb, Rgb],
    seed: number,
    kind = 'DEAL_IMAGE',
  ) {
    const key = `merchants/${orgId}/${kind.toLowerCase()}/seed-${name}`;
    const data = makeDevImagePng(w, h, palette[0], palette[1], seed);
    await writeFile_(key, data);
    const row = {
      organizationId: orgId,
      kind,
      originalName: `${name}.png`,
      mimeType: 'image/png',
      declaredSize: data.length,
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      storageKey: key,
      status: 'AVAILABLE' as const,
      completedAt: new Date(),
    };
    return prisma.storedFile.upsert({ where: { storageKey: key }, update: row, create: row });
  }
  const merchantKeys: Merchant[] = ['merchantA', 'merchantB', 'najd', 'bloom', 'pulse', 'page'];
  const brand: Rgb[] = [
    [91, 26, 252],
    [31, 191, 143],
    [245, 165, 36],
    [255, 105, 155],
    [20, 184, 166],
    [59, 130, 246],
  ];
  for (const [i, key] of merchantKeys.entries()) {
    const orgId = organizations[key]!;
    const logo = await dealImage(orgId, 'logo', 256, 256, [brand[i]!, [15, 12, 66]], i + 3, 'LOGO');
    const cover = await dealImage(
      orgId,
      'cover',
      1200,
      560,
      [brand[i]!, [15, 12, 66]],
      i + 11,
      'COVER',
    );
    await prisma.merchant.update({
      where: { organizationId: orgId },
      data: { logoFileId: logo.id, coverFileId: cover.id },
    });
  }

  // ---------------------------------------------------------------- deals
  const operations = await prisma.user.findUnique({ where: { email: 'operations@dealdash.test' } });
  const eligibilityService = new EligibilityService(prisma as unknown as PrismaService);
  const now = Date.now();
  const category = new Map((await prisma.category.findMany()).map((c) => [c.code, c.id]));
  const created: Array<{
    id: string;
    deal: SeedDeal;
    orgId: string;
    branchIds: string[];
    start: Date;
    end: Date | null;
  }> = [];

  async function history(
    dealId: string,
    orgId: string,
    owner: { id: string; role: string } | null,
    rows: Array<{
      action: LiveDealAction;
      from?: LiveDealStatus;
      to?: LiveDealStatus;
      at: Date;
      byDealDash?: boolean;
      reason?: string;
      reasonAr?: string;
      fields?: string[];
    }>,
  ) {
    for (const r of rows) {
      const actor = r.byDealDash ? operations : owner ? { id: owner.id } : null;
      const role = r.byDealDash ? 'DEALDASH_OPERATIONS' : (owner?.role ?? null);
      await prisma.liveDealHistory.create({
        data: {
          dealId,
          action: r.action,
          fromStatus: r.from ?? null,
          toStatus: r.to ?? null,
          reason: r.reason ?? null,
          reasonAr: r.reasonAr ?? null,
          fields: (r.fields ?? []) as Prisma.InputJsonValue,
          actorUserId: actor?.id ?? null,
          actorRole: role,
          actorName: r.byDealDash ? 'Operations' : 'Merchant owner',
          byDealDash: !!r.byDealDash,
          createdAt: r.at,
        },
      });
      await prisma.auditLog.create({
        data: {
          occurredAt: r.at,
          action: `live_deal.${r.action.toLowerCase()}`,
          entityType: 'LiveDeal',
          entityId: dealId,
          reason: r.reason ?? null,
          previousState: r.from ? { status: r.from } : undefined,
          newState: r.to ? { status: r.to } : undefined,
          actorUserId: actor?.id ?? null,
          actorRole: role,
          actorOrganizationId: r.byDealDash ? organizations.dealdash : orgId,
          subjectOrganizationId: orgId,
        },
      });
    }
  }

  for (const d of DEALS) {
    const orgId = organizations[d.org]!;
    const existing = await prisma.liveDeal.findFirst({
      where: { organizationId: orgId, titleEn: d.title.en },
    });
    const branchRows = await prisma.merchantBranch.findMany({
      where: { organizationId: orgId, nameEn: { in: d.branchNames } },
    });
    const branchIds = branchRows.map((b) => b.id);
    const start = new Date(now + d.startDays * DAY);
    const end = d.endDays === null ? null : new Date(now + d.endDays * DAY);
    if (existing) {
      created.push({ id: existing.id, deal: d, orgId, branchIds, start, end });
      continue;
    }
    const n = d.images ?? 1;
    const palette = PALETTE[d.category]!;
    const media = [];
    for (let i = 0; i < n; i++) {
      const f = await dealImage(
        orgId,
        `${d.title.en
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .slice(0, 40)}-${i + 1}`,
        960,
        600,
        palette,
        d.title.en.length + i * 5,
      );
      media.push({
        fileId: f.id,
        altEn: `${d.title.en} (illustration)`,
        altAr: `${d.title.ar} (صورة توضيحية)`,
      });
    }
    const blocks = d.terms.blocks ?? {};
    const content = liveDealContentSchema.parse({
      categoryId: category.get(d.category),
      mechanic: d.mechanic,
      valueNumber: d.value,
      offerLabel: d.label,
      title: d.title,
      shortDescription: d.short,
      description: d.description,
      media,
      branchIds,
      startAt: start.toISOString(),
      endAt: end ? end.toISOString() : null,
      eligibility: d.eligibility
        ? { kind: d.eligibility.kind, valueRefs: [refs[d.eligibility.ref]!] }
        : { kind: 'PUBLIC', valueRefs: [] },
      terms: { blocks, textEn: d.terms.en, textAr: d.terms.ar },
    });
    const owner = await prisma.organizationMembership.findFirst({
      where: { organizationId: orgId, role: { code: 'MERCHANT_OWNER' } },
      include: { user: true },
    });
    const ownerInfo = owner ? { id: owner.userId, role: 'MERCHANT_OWNER' } : null;
    const ruleSetId = await eligibilityService.syncRuleSet(
      prisma as unknown as Prisma.TransactionClient,
      null,
      orgId,
      content.eligibility,
    );
    const published = ['SCHEDULED', 'LIVE', 'PAUSED', 'EXPIRED', 'SUSPENDED'].includes(d.status);
    const submittedAt = new Date(now + (d.startDays - 2) * DAY);
    const deal = await prisma.liveDeal.create({
      data: {
        organizationId: orgId,
        status: d.status,
        statusBeforeSuspension: d.status === 'SUSPENDED' ? 'LIVE' : null,
        pausedBy: d.status === 'PAUSED' ? (d.pausedBy ?? 'MERCHANT') : null,
        content: content as unknown as Prisma.InputJsonValue,
        ...denormalize(content),
        eligibilityRuleSetId: ruleSetId,
        submittedAt:
          d.status === 'DRAFT'
            ? null
            : d.status === 'PENDING_REVIEW'
              ? new Date(now - 3 * 3_600_000)
              : submittedAt,
        publishedAt: published ? new Date(Math.min(now, start.getTime())) : null,
        endedAt: d.status === 'EXPIRED' ? end : null,
        createdByUserId: owner?.userId ?? operations!.id,
        updatedByUserId: owner?.userId ?? null,
        createdAt: new Date(submittedAt.getTime() - DAY),
      },
    });
    await prisma.liveDealBranch.createMany({
      data: branchIds.map((branchId) => ({ dealId: deal.id, branchId })),
    });

    const t0 = submittedAt.getTime();
    const rows: Parameters<typeof history>[3] = [
      { action: 'CREATE', to: 'DRAFT', at: new Date(t0 - DAY) },
    ];
    if (d.status !== 'DRAFT')
      rows.push({
        action: 'SUBMIT',
        from: 'DRAFT',
        to: 'PENDING_REVIEW',
        at: d.status === 'PENDING_REVIEW' ? new Date(now - 3 * 3_600_000) : new Date(t0),
      });
    if (d.status === 'NEEDS_CHANGES')
      rows.push({
        action: 'REQUEST_CHANGES',
        from: 'PENDING_REVIEW',
        to: 'NEEDS_CHANGES',
        at: new Date(now - 20 * 3_600_000),
        byDealDash: true,
        reason: d.feedback!.en,
        reasonAr: d.feedback!.ar,
        fields: ['terms', 'endAt'],
      });
    if (published)
      rows.push({
        action: 'APPROVE',
        from: 'PENDING_REVIEW',
        to: d.startDays > 0 ? 'SCHEDULED' : 'LIVE',
        at: new Date(t0 + 3_600_000),
        byDealDash: true,
        reason: 'Content is complete and accurate.',
        reasonAr: 'المحتوى كامل ودقيق.',
      });
    if (d.status === 'LIVE' && d.startDays <= 0)
      rows.push({
        action: 'ACTIVATE',
        from: 'SCHEDULED',
        to: 'LIVE',
        at: new Date(Math.max(start.getTime(), t0 + 2 * 3_600_000)),
      });
    if (d.status === 'PAUSED')
      rows.push({
        action: 'PAUSE',
        from: 'LIVE',
        to: 'PAUSED',
        at: new Date(now - 2 * DAY),
        reason: 'Restocking',
      });
    if (d.status === 'EXPIRED')
      rows.push({ action: 'EXPIRE', from: 'LIVE', to: 'EXPIRED', at: end! });
    if (d.status === 'SUSPENDED')
      rows.push({
        action: 'SUSPEND',
        from: 'LIVE',
        to: 'SUSPENDED',
        at: new Date(now - DAY),
        byDealDash: true,
        reason: d.suspendedReason!.en,
        reasonAr: d.suspendedReason!.ar,
      });
    await history(deal.id, orgId, ownerInfo, rows);

    if (d.revision) {
      const next = liveDealContentSchema.parse({
        ...content,
        valueNumber: d.revision.value,
        offerLabel: d.revision.label,
        title: d.revision.title,
      });
      const rev = await prisma.liveDealRevision.create({
        data: {
          dealId: deal.id,
          number: 1,
          status: 'PENDING_REVIEW',
          content: next as unknown as Prisma.InputJsonValue,
          materialFields: ['valueNumber', 'offerLabel', 'title'],
          baseVersion: deal.version,
          createdByUserId: owner?.userId ?? operations!.id,
          submittedAt: new Date(now - 5 * 3_600_000),
        },
      });
      await history(deal.id, orgId, ownerInfo, [
        {
          action: 'REVISION_SAVED',
          from: 'LIVE',
          to: 'LIVE',
          at: new Date(now - 6 * 3_600_000),
          fields: ['valueNumber', 'offerLabel', 'title'],
        },
        {
          action: 'REVISION_SUBMIT',
          from: 'LIVE',
          to: 'LIVE',
          at: new Date(now - 5 * 3_600_000),
          fields: ['valueNumber', 'offerLabel', 'title'],
        },
      ]);
      void rev;
    }
    created.push({ id: deal.id, deal: d, orgId, branchIds, start, end });
  }

  // ---------------------------------------------------------------- demo discovery signals (synthetic, development only)
  if ((await prisma.dealEvent.count({ where: { anonymousId: { startsWith: 'seed-' } } })) === 0) {
    const rand = lcg(20261008);
    const data: Prisma.DealEventCreateManyInput[] = [];
    for (const c of created.filter(
      (x) => x.deal.status === 'LIVE' || x.deal.status === 'PAUSED' || x.deal.status === 'EXPIRED',
    )) {
      const w = c.deal.weight ?? 3;
      const days = Math.min(14, Math.max(1, Math.round((now - c.start.getTime()) / DAY)));
      for (let day = 0; day < days; day++) {
        const impressions = Math.round(w * (6 + rand() * 10));
        const detail = Math.round(impressions * (0.25 + rand() * 0.15));
        const directions = Math.round(detail * (0.18 + rand() * 0.12));
        const saves = Math.round(detail * (0.08 + rand() * 0.08));
        const pageViews = Math.round(detail * 0.3);
        const add = (
          type: Prisma.DealEventCreateManyInput['type'],
          n: number,
          withDeal = true,
          branch = false,
        ) => {
          for (let i = 0; i < n; i++)
            data.push({
              type,
              dealId: withDeal ? c.id : null,
              sourceDealId: withDeal ? null : c.id,
              merchantOrgId: c.orgId,
              branchId: branch ? c.branchIds[i % c.branchIds.length] : null,
              anonymousId: `seed-${c.id.slice(0, 8)}-${day}-${type}-${i}`,
              occurredAt: new Date(now - day * DAY - Math.floor(rand() * 20) * 3_600_000),
            });
        };
        add('IMPRESSION', impressions);
        add('DETAIL_VIEW', detail, true, true);
        add('MERCHANT_PAGE_VIEW', pageViews, false);
        add('DIRECTIONS_CLICK', directions, true, true);
        add('SAVE', saves);
      }
    }
    for (let i = 0; i < data.length; i += 1000)
      await prisma.dealEvent.createMany({ data: data.slice(i, i + 1000) });
  }

  // ---------------------------------------------------------------- customers: one with a verified employer, one without benefits
  const customerRole = roles.get('CUSTOMER');
  void customerRole;
  const sample = await prisma.user.findUnique({ where: { mobile: '+966500000001' } });
  if (sample) {
    await prisma.eligibilityAttribute.upsert({
      where: {
        userId_attrType_valueRef: { userId: sample.id, attrType: 'EMPLOYER', valueRef: employerId },
      },
      update: {},
      create: {
        userId: sample.id,
        attrType: 'EMPLOYER',
        valueRef: employerId,
        level: 'OTP_VERIFIED',
        status: 'VERIFIED',
        source: 'DEVELOPMENT_SEED',
        verifiedAt: new Date(),
      },
    });
  }
  let second = await prisma.user.findUnique({ where: { mobile: '+966500000002' } });
  if (!second) {
    second = await prisma.user.create({
      data: {
        userType: 'CUSTOMER',
        mobile: '+966500000002',
        displayName: 'Second Customer',
        customer: { create: { city: 'Riyadh', onboardingState: 'COMPLETE' } },
      },
    });
  }
  accounts.push({
    mobile: '+966500000002',
    role: 'CUSTOMER',
    organization: '-',
    audience: 'customer',
  });
  void passwordHash;
}
