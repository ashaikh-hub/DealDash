import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { hotDealContentSchema } from '@dealdash/validation';
import type { HotDealStatus, ReservationStatus } from '@dealdash/types';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { denormalizeHot, newManualCode, newQrToken, newReference } from '../hot-deals/hot-content';
import { EligibilityService } from '../live-deals/eligibility.service';
import type { PrismaService } from '../prisma/prisma.service';
import { makeDevImagePng, type Rgb } from './png';

export interface Stage4SeedInput {
  prisma: PrismaClient;
  organizations: Record<string, string>;
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
}

const HOUR = 3_600_000;
const MIN = 60_000;
const bi = (en: string, ar: string) => ({ en, ar });

type Org = 'merchantA' | 'merchantB' | 'najd' | 'bloom' | 'pulse' | 'page';

interface Sim {
  /** Demo customer index (0..) */
  who: number;
  status: ReservationStatus;
  branch: number;
  qty?: number;
  minutesAgo: number;
}

interface HotSeed {
  org: Org;
  category: string;
  status: HotDealStatus;
  limitType: 'TIME' | 'QUANTITY' | 'TIME_AND_QUANTITY';
  reservations: boolean;
  label: { en: string; ar: string };
  title: { en: string; ar: string };
  short: { en: string; ar: string };
  description: { en: string; ar: string };
  terms: { en: string; ar: string };
  branches: Array<[string, number]>; // branch name, units
  startHours: number;
  endHours: number | null;
  mechanic: 'PERCENTAGE_OFF' | 'AMOUNT_OFF' | 'EVERYDAY_PROMOTION' | 'SERVICE_OFFER';
  value: number | null;
  perCustomer?: number;
  holdMinutes?: number | null;
  eligibility?: { kind: 'EMPLOYER'; ref: string };
  pausedBy?: 'MERCHANT' | 'DEALDASH';
  feedback?: { en: string; ar: string };
  sims?: Sim[];
}

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

const HOT: HotSeed[] = [
  {
    org: 'najd',
    category: 'dining',
    status: 'LIVE',
    limitType: 'TIME_AND_QUANTITY',
    reservations: true,
    mechanic: 'PERCENTAGE_OFF',
    value: 40,
    label: bi('40% off', 'خصم 40%'),
    title: bi('Lunch rush: 40% off kabsa platters', 'ذروة الغداء: خصم 40% على أطباق الكبسة'),
    short: bi('Family platter, today until 3 pm', 'طبق عائلي، اليوم حتى الثالثة عصراً'),
    description: bi(
      'Reserve a family kabsa platter at 40% off. Limited platters per branch, ready when you arrive.',
      'احجزوا طبق كبسة عائلي بخصم 40%. عدد محدود من الأطباق لكل فرع، وجاهز عند وصولكم.',
    ),
    terms: {
      en: 'Show your reservation code at the counter. One platter per reservation.',
      ar: 'اعرضوا رمز الحجز عند الكاشير. طبق واحد لكل حجز.',
    },
    branches: [
      ['Najd Kitchen Al Nakheel', 12],
      ['Najd Kitchen Hittin', 8],
    ],
    startHours: -2,
    endHours: 3,
    sims: [
      { who: 0, status: 'REDEEMED', branch: 0, minutesAgo: 70 },
      { who: 1, status: 'REDEEMED', branch: 0, minutesAgo: 55 },
      { who: 2, status: 'CANCELLED', branch: 1, minutesAgo: 40 },
      { who: 3, status: 'EXPIRED', branch: 1, minutesAgo: 95 },
    ],
  },
  {
    org: 'merchantA',
    category: 'dining',
    status: 'LIVE',
    limitType: 'QUANTITY',
    reservations: true,
    mechanic: 'EVERYDAY_PROMOTION',
    value: null,
    label: bi('Free dessert', 'حلى مجاني'),
    title: bi('Tonight: free dessert with any main', 'الليلة: حلى مجاني مع أي طبق رئيسي'),
    short: bi('Only 6 left at Olaya', 'متبقي 6 فقط في العليا'),
    description: bi(
      'Pick any main course tonight and a dessert is on us. Reserve to keep one of the last six.',
      'اختاروا أي طبق رئيسي الليلة والحلى علينا. احجزوا لتضمنوا واحدة من آخر ست حصص.',
    ),
    terms: {
      en: 'Dessert menu items only. Not combinable.',
      ar: 'أصناف الحلويات فقط. لا يُجمع مع عروض أخرى.',
    },
    branches: [['Harbour Grill Olaya', 6]],
    startHours: -1,
    endHours: null,
    sims: [
      { who: 0, status: 'REDEEMED', branch: 0, minutesAgo: 30 },
      { who: 1, status: 'REDEEMED', branch: 0, minutesAgo: 25 },
      { who: 2, status: 'REDEEMED', branch: 0, minutesAgo: 20 },
      { who: 4, status: 'REDEEMED', branch: 0, minutesAgo: 10 },
    ],
  },
  {
    org: 'merchantB',
    category: 'cafes',
    status: 'LIVE',
    limitType: 'TIME_AND_QUANTITY',
    reservations: true,
    mechanic: 'EVERYDAY_PROMOTION',
    value: null,
    label: bi('2 for 1', 'اثنان بسعر واحد'),
    title: bi('Happy hour: two smoothies for one', 'ساعة سعيدة: سموذي اثنان بسعر واحد'),
    short: bi('Until 6 pm, any size', 'حتى السادسة مساءً، أي حجم'),
    description: bi(
      'Order any smoothie and get a second one free during happy hour. Reserve your spot at the counter.',
      'اطلبوا أي سموذي واحصلوا على الثاني مجاناً خلال الساعة السعيدة. احجزوا مكانكم.',
    ),
    terms: {
      en: 'Second smoothie of equal or lower price.',
      ar: 'السموذي الثاني بسعر مساوٍ أو أقل.',
    },
    branches: [['Daily Dose KAFD', 30]],
    startHours: -1,
    endHours: 2,
    perCustomer: 2,
    sims: [{ who: 5, status: 'REDEEMED', branch: 0, minutesAgo: 35 }],
  },
  {
    org: 'bloom',
    category: 'beauty_wellness',
    status: 'SOLD_OUT',
    limitType: 'TIME_AND_QUANTITY',
    reservations: true,
    mechanic: 'PERCENTAGE_OFF',
    value: 35,
    label: bi('35% off', 'خصم 35%'),
    title: bi('Last-minute manicure slots', 'مواعيد مانيكير في اللحظة الأخيرة'),
    short: bi('Two slots, 35% off', 'موعدان بخصم 35%'),
    description: bi(
      'Two same-day manicure slots at 35% off.',
      'موعدا مانيكير في نفس اليوم بخصم 35%.',
    ),
    terms: { en: 'Same-day slots only.', ar: 'مواعيد اليوم نفسه فقط.' },
    branches: [['Bloom Beauty Olaya', 2]],
    startHours: -3,
    endHours: 4,
    sims: [
      { who: 0, status: 'REDEEMED', branch: 0, minutesAgo: 90 },
      { who: 1, status: 'REDEEMED', branch: 0, minutesAgo: 60 },
    ],
  },
  {
    org: 'pulse',
    category: 'fitness',
    status: 'LIVE',
    limitType: 'TIME',
    reservations: false,
    mechanic: 'SERVICE_OFFER',
    value: null,
    label: bi('Free day pass', 'تذكرة يوم مجانية'),
    title: bi('Walk-in: free day pass until 8 pm', 'زيارة مباشرة: تذكرة يوم مجانية حتى الثامنة'),
    short: bi('No reservation needed', 'لا حاجة للحجز'),
    description: bi(
      'Come by either branch before 8 pm today and train for free. Just show this offer at reception.',
      'مروا على أي فرع قبل الثامنة مساءً اليوم وتدرّبوا مجاناً. اعرضوا هذا العرض عند الاستقبال.',
    ),
    terms: {
      en: 'One day pass per person. ID required.',
      ar: 'تذكرة واحدة لكل شخص. الهوية مطلوبة.',
    },
    branches: [
      ['Pulse Fitness Al Malqa', 0],
      ['Pulse Fitness KAFD', 0],
    ],
    startHours: -1,
    endHours: 5,
  },
  {
    org: 'page',
    category: 'shopping',
    status: 'LIVE',
    limitType: 'TIME_AND_QUANTITY',
    reservations: true,
    mechanic: 'PERCENTAGE_OFF',
    value: 25,
    label: bi('25% off', 'خصم 25%'),
    title: bi('Employees: 25% off bestsellers', 'للموظفين: خصم 25% على الأكثر مبيعاً'),
    short: bi('For verified employees, today only', 'للموظفين الموثّقين، اليوم فقط'),
    description: bi(
      'A flash offer for verified employees of our partner company. Reserve a bestseller at 25% off.',
      'عرض سريع لموظفي الشركة الشريكة الموثّقين. احجزوا كتاباً من الأكثر مبيعاً بخصم 25%.',
    ),
    terms: {
      en: 'Verified employees only. One book per reservation.',
      ar: 'للموظفين الموثّقين فقط. كتاب واحد لكل حجز.',
    },
    branches: [['Page & Co Diriyah', 15]],
    startHours: -1,
    endHours: 4,
    eligibility: { kind: 'EMPLOYER', ref: 'employer' },
  },
  {
    org: 'merchantA',
    category: 'dining',
    status: 'SCHEDULED',
    limitType: 'TIME_AND_QUANTITY',
    reservations: true,
    mechanic: 'PERCENTAGE_OFF',
    value: 30,
    label: bi('30% off', 'خصم 30%'),
    title: bi('Late-night grill special', 'عرض الشواء المتأخر'),
    short: bi('Starts in a few hours', 'يبدأ بعد ساعات'),
    description: bi(
      'Late-night grill platters at 30% off, from 10 pm.',
      'أطباق شواء متأخرة بخصم 30% من العاشرة مساءً.',
    ),
    terms: { en: 'From 10 pm. While stocks last.', ar: 'من العاشرة مساءً. حتى نفاد الكمية.' },
    branches: [['Harbour Grill Al Malqa', 10]],
    startHours: 4,
    endHours: 9,
  },
  {
    org: 'pulse',
    category: 'fitness',
    status: 'PENDING_REVIEW',
    limitType: 'TIME_AND_QUANTITY',
    reservations: true,
    mechanic: 'PERCENTAGE_OFF',
    value: 20,
    label: bi('20% off', 'خصم 20%'),
    title: bi('Spin class spots at 20% off', 'مقاعد حصة السبينينج بخصم 20%'),
    short: bi('Tonight 7 pm class', 'حصة السابعة مساءً'),
    description: bi(
      'Twelve spots in tonight’s 7 pm spin class at 20% off.',
      'اثنا عشر مقعداً في حصة السبينينج الليلة بخصم 20%.',
    ),
    terms: { en: 'Arrive 10 minutes early.', ar: 'الوصول قبل الحصة بعشر دقائق.' },
    branches: [['Pulse Fitness KAFD', 12]],
    startHours: 1,
    endHours: 6,
  },
  {
    org: 'najd',
    category: 'dining',
    status: 'NEEDS_CHANGES',
    limitType: 'QUANTITY',
    reservations: true,
    mechanic: 'AMOUNT_OFF',
    value: 20,
    label: bi('SAR 20 off', 'خصم 20 ريال'),
    title: bi('Weekend breakfast: SAR 20 off', 'فطور نهاية الأسبوع: خصم 20 ريال'),
    short: bi('Breakfast platters, limited', 'أطباق فطور بكمية محدودة'),
    description: bi(
      'SAR 20 off the Najdi breakfast platter.',
      'خصم 20 ريال على طبق الفطور النجدي.',
    ),
    terms: { en: 'Weekend mornings.', ar: 'صباح عطلة نهاية الأسبوع.' },
    branches: [['Najd Kitchen Hittin', 10]],
    startHours: 6,
    endHours: null,
    feedback: {
      en: 'Please add the opening hours of the breakfast service to the terms.',
      ar: 'يرجى إضافة ساعات تقديم الفطور إلى الشروط.',
    },
  },
  {
    org: 'merchantB',
    category: 'cafes',
    status: 'PAUSED',
    limitType: 'TIME_AND_QUANTITY',
    reservations: true,
    mechanic: 'PERCENTAGE_OFF',
    value: 25,
    label: bi('25% off', 'خصم 25%'),
    title: bi('Cold brew flash sale', 'تخفيضات سريعة على القهوة الباردة'),
    short: bi('Paused while we restock', 'متوقف مؤقتاً أثناء التوريد'),
    description: bi(
      'Cold brew at 25% off while stocks last.',
      'قهوة باردة بخصم 25% حتى نفاد الكمية.',
    ),
    terms: { en: 'While stocks last.', ar: 'حتى نفاد الكمية.' },
    branches: [['Daily Dose KAFD', 20]],
    startHours: -2,
    endHours: 5,
    pausedBy: 'MERCHANT',
  },
  {
    org: 'bloom',
    category: 'beauty_wellness',
    status: 'EXPIRED',
    limitType: 'TIME_AND_QUANTITY',
    reservations: true,
    mechanic: 'PERCENTAGE_OFF',
    value: 30,
    label: bi('30% off', 'خصم 30%'),
    title: bi('Yesterday: facial flash offer', 'أمس: عرض سريع على العناية بالبشرة'),
    short: bi('Ended', 'انتهى'),
    description: bi('A facial at 30% off, one day only.', 'جلسة عناية بالبشرة بخصم 30% ليوم واحد.'),
    terms: { en: 'Booked slots only.', ar: 'للمواعيد المحجوزة فقط.' },
    branches: [['Bloom Beauty Olaya', 8]],
    startHours: -30,
    endHours: -6,
    sims: [
      { who: 0, status: 'REDEEMED', branch: 0, minutesAgo: 24 * 60 },
      { who: 1, status: 'REDEEMED', branch: 0, minutesAgo: 24 * 60 - 40 },
      { who: 2, status: 'EXPIRED', branch: 0, minutesAgo: 24 * 60 - 90 },
      { who: 3, status: 'CANCELLED', branch: 0, minutesAgo: 24 * 60 - 120 },
    ],
  },
];

const DEMO_STAFF: Array<{ mobile: string; name: string; org: Org; branch: string; key: string }> = [
  {
    mobile: '+966500000102',
    name: 'Najd Kitchen Al Nakheel Staff',
    org: 'najd',
    branch: 'Najd Kitchen Al Nakheel',
    key: 'staffNajd',
  },
  {
    mobile: '+966500000103',
    name: 'Pulse Fitness Al Malqa Staff',
    org: 'pulse',
    branch: 'Pulse Fitness Al Malqa',
    key: 'staffPulse',
  },
  {
    mobile: '+966500000104',
    name: 'Daily Dose Staff',
    org: 'merchantB',
    branch: 'Daily Dose KAFD',
    key: 'staffDose',
  },
];

/**
 * Stage 4 development data: Exclusive Deals in every lifecycle state with per-branch stock, a history of free reservations
 * (redeemed, not completed, cancelled), staff accounts for several merchants, and synthetic discovery signals for the
 * funnel. A live HELD reservation is deliberately NOT seeded: holds are short, so reserve one in the customer app to try
 * the Staff app (see docs/STAGE4.md). Idempotent and clearly development data.
 */
export async function seedStage4(input: Stage4SeedInput) {
  const { prisma, organizations, roles, accounts } = input;
  const now = Date.now();
  const operations = await prisma.user.findUnique({ where: { email: 'operations@dealdash.test' } });
  const category = new Map((await prisma.category.findMany()).map((c) => [c.code, c.id]));
  const eligibilityService = new EligibilityService(prisma as unknown as PrismaService);
  const employerId = organizations.employer!;

  // ---------------------------------------------------------------- staff accounts (mobile + OTP, one branch each)
  const staffRole = roles.get('MERCHANT_STAFF');
  const staffByOrg = new Map<string, string>();
  for (const s of DEMO_STAFF) {
    const orgId = organizations[s.org];
    const branch = orgId
      ? await prisma.merchantBranch.findFirst({
          where: { organizationId: orgId, nameEn: s.branch },
        })
      : null;
    if (!orgId || !branch || !staffRole) continue;
    let user = await prisma.user.findUnique({ where: { mobile: s.mobile } });
    if (!user)
      user = await prisma.user.create({
        data: {
          userType: 'MERCHANT_USER',
          mobile: s.mobile,
          displayName: s.name,
          mobileVerifiedAt: new Date(),
        },
      });
    const has = await prisma.organizationMembership.findFirst({
      where: { userId: user.id, organizationId: orgId },
    });
    if (!has)
      await prisma.organizationMembership.create({
        data: { userId: user.id, organizationId: orgId, roleId: staffRole, branchId: branch.id },
      });
    staffByOrg.set(s.org, user.id);
    accounts.push({
      mobile: s.mobile,
      role: 'MERCHANT_STAFF',
      organization: s.org,
      audience: 'staff',
      branch: s.branch,
    });
  }
  const olayaStaff = await prisma.user.findUnique({ where: { mobile: '+966500000100' } });
  if (olayaStaff) staffByOrg.set('merchantA', olayaStaff.id);

  // ---------------------------------------------------------------- demo customers
  const customers: string[] = [];
  const sample = await prisma.user.findUnique({ where: { mobile: '+966500000001' } });
  const second = await prisma.user.findUnique({ where: { mobile: '+966500000002' } });
  if (sample) customers.push(sample.id);
  if (second) customers.push(second.id);
  for (let i = 0; i < 4; i++) {
    const mobile = `+96650000040${i}`;
    let u = await prisma.user.findUnique({ where: { mobile } });
    if (!u)
      u = await prisma.user.create({
        data: {
          userType: 'CUSTOMER',
          mobile,
          displayName: ['Layla', 'Omar', 'Noura', 'Faisal'][i]! + ' (demo)',
          customer: {
            create: {
              firstName: ['Layla', 'Omar', 'Noura', 'Faisal'][i],
              city: 'Riyadh',
              onboardingState: 'COMPLETE',
            },
          },
        },
      });
    customers.push(u.id);
  }

  // ---------------------------------------------------------------- imagery
  async function dealImage(orgId: string, name: string, palette: [Rgb, Rgb], seed: number) {
    const key = `merchants/${orgId}/deal_image/seed-${name}`;
    const data = makeDevImagePng(960, 600, palette[0], palette[1], seed);
    if (input.storageDir) {
      const p = resolve(input.storageDir, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    }
    const row = {
      organizationId: orgId,
      kind: 'DEAL_IMAGE',
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

  // ---------------------------------------------------------------- history + audit helper
  async function history(
    dealId: string,
    orgId: string,
    owner: { id: string; role: string } | null,
    rows: Array<{
      action: Prisma.HotDealHistoryUncheckedCreateInput['action'];
      from?: HotDealStatus;
      to?: HotDealStatus;
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
      await prisma.hotDealHistory.create({
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
          action: `hot_deal.${r.action.toLowerCase()}`,
          entityType: 'HotDeal',
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

  // ---------------------------------------------------------------- Exclusive Deals
  for (const [idx, d] of HOT.entries()) {
    const orgId = organizations[d.org];
    if (!orgId) continue;
    const exists = await prisma.hotDeal.findFirst({
      where: { organizationId: orgId, titleEn: d.title.en },
    });
    if (exists) continue;
    const branchRows = await prisma.merchantBranch.findMany({
      where: { organizationId: orgId, nameEn: { in: d.branches.map(([n]) => n) } },
    });
    const byName = new Map(branchRows.map((b) => [b.nameEn, b]));
    const palette = PALETTE[d.category]!;
    const file = await dealImage(
      orgId,
      `hot-${idx}-${d.title.en
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 30)}`,
      palette,
      40 + idx * 7,
    );
    const start = new Date(now + d.startHours * HOUR);
    const end = d.endHours === null ? null : new Date(now + d.endHours * HOUR);
    const content = hotDealContentSchema.parse({
      categoryId: category.get(d.category),
      mechanic: d.mechanic,
      valueNumber: d.value,
      offerLabel: d.label,
      title: d.title,
      shortDescription: d.short,
      description: d.description,
      media: [
        {
          fileId: file.id,
          altEn: `${d.title.en} (illustration)`,
          altAr: `${d.title.ar} (صورة توضيحية)`,
        },
      ],
      limitType: d.limitType,
      reservationsEnabled: d.reservations,
      allocations: d.branches.map(([n, units]) => ({ branchId: byName.get(n)!.id, units })),
      perCustomerLimit: d.perCustomer ?? 1,
      holdMinutes: d.holdMinutes ?? null,
      startAt: start.toISOString(),
      endAt: end ? end.toISOString() : null,
      eligibility: d.eligibility
        ? { kind: d.eligibility.kind, valueRefs: [employerId] }
        : { kind: 'PUBLIC', valueRefs: [] },
      terms: { textEn: d.terms.en, textAr: d.terms.ar },
    });
    const owner = await prisma.organizationMembership.findFirst({
      where: { organizationId: orgId, role: { code: 'MERCHANT_OWNER' } },
    });
    const ownerInfo = owner ? { id: owner.userId, role: 'MERCHANT_OWNER' } : null;
    const ruleSetId = await eligibilityService.syncRuleSet(
      prisma as unknown as Prisma.TransactionClient,
      null,
      orgId,
      content.eligibility,
    );
    const published = ['SCHEDULED', 'LIVE', 'PAUSED', 'SOLD_OUT', 'EXPIRED'].includes(d.status);
    const submittedAt = new Date(Math.min(now, start.getTime()) - 2 * HOUR);
    const deal = await prisma.hotDeal.create({
      data: {
        organizationId: orgId,
        status: d.status,
        pausedBy: d.status === 'PAUSED' ? (d.pausedBy ?? 'MERCHANT') : null,
        content: content as unknown as Prisma.InputJsonValue,
        ...denormalizeHot(content),
        eligibilityRuleSetId: ruleSetId,
        submittedAt:
          d.status === 'DRAFT'
            ? null
            : d.status === 'PENDING_REVIEW'
              ? new Date(now - 90 * MIN)
              : submittedAt,
        publishedAt: published ? new Date(Math.min(now, start.getTime())) : null,
        endedAt: d.status === 'EXPIRED' ? end : null,
        createdByUserId: owner?.userId ?? operations!.id,
        updatedByUserId: owner?.userId ?? null,
        createdAt: new Date(submittedAt.getTime() - HOUR),
      },
    });

    // stock rows and the reservations that explain them
    const sims = d.sims ?? [];
    const orgBranches = d.branches.map(([n]) => byName.get(n)!);
    const used = orgBranches.map((_, i) => ({
      redeemed: sims
        .filter((s) => s.branch === i && s.status === 'REDEEMED')
        .reduce((n, s) => n + (s.qty ?? 1), 0),
    }));
    for (const [i, [name, units]] of d.branches.entries()) {
      const tracked = d.reservations && units > 0;
      const redeemed = used[i]!.redeemed;
      await prisma.hotDealInventory.create({
        data: {
          dealId: deal.id,
          branchId: byName.get(name)!.id,
          tracked,
          total: tracked ? units : 0,
          redeemed: tracked ? redeemed : 0,
          available: tracked ? units - redeemed : 0,
          released: tracked
            ? sims.filter((s) => s.branch === i && ['EXPIRED', 'CANCELLED'].includes(s.status))
                .length
            : 0,
        },
      });
    }
    const holdMinutes = 30;
    let strikes = 0;
    for (const s of sims) {
      const branch = orgBranches[s.branch]!;
      const userId = customers[s.who % customers.length]!;
      const createdAt = new Date(now - s.minutesAgo * MIN);
      const expiresAt = new Date(createdAt.getTime() + holdMinutes * MIN);
      const r = await prisma.reservation.create({
        data: {
          reference: newReference(),
          dealId: deal.id,
          branchId: branch.id,
          organizationId: orgId,
          userId,
          quantity: s.qty ?? 1,
          status: s.status,
          holdMinutes,
          expiresAt,
          qrToken: newQrToken(),
          manualCode: newManualCode(),
          redeemedAt: s.status === 'REDEEMED' ? new Date(createdAt.getTime() + 12 * MIN) : null,
          cancelledAt: s.status === 'CANCELLED' ? new Date(createdAt.getTime() + 5 * MIN) : null,
          cancelledBy: s.status === 'CANCELLED' ? 'CUSTOMER' : null,
          noShowCounted: s.status === 'EXPIRED',
          createdAt,
          // development seed: FREE reservations (allowed on development machines only, RC-05)
          commitmentMethod: 'FREE',
          paymentStatus: 'NOT_REQUIRED',
          confirmedAt: createdAt,
        },
      });
      const ev: Prisma.ReservationEventUncheckedCreateInput[] = [
        {
          reservationId: r.id,
          type: 'CREATED',
          toStatus: 'HELD',
          actorUserId: userId,
          actorRole: 'CUSTOMER',
          createdAt,
        },
      ];
      if (s.status === 'REDEEMED') {
        ev.push({
          reservationId: r.id,
          type: 'REDEEMED',
          fromStatus: 'HELD',
          toStatus: 'REDEEMED',
          actorUserId: staffByOrg.get(d.org) ?? null,
          actorRole: 'MERCHANT_STAFF',
          note: 'QR',
          createdAt: r.redeemedAt!,
        });
        await prisma.redemption.create({
          data: {
            reservationId: r.id,
            dealId: deal.id,
            branchId: branch.id,
            organizationId: orgId,
            staffUserId: staffByOrg.get(d.org) ?? operations!.id,
            source: 'QR',
            reference: `RD-${newReference().slice(3)}`,
            redeemedAt: r.redeemedAt!,
          },
        });
      }
      if (s.status === 'CANCELLED')
        ev.push({
          reservationId: r.id,
          type: 'CANCELLED',
          fromStatus: 'HELD',
          toStatus: 'CANCELLED',
          actorUserId: userId,
          actorRole: 'CUSTOMER',
          createdAt: r.cancelledAt!,
        });
      if (s.status === 'EXPIRED') {
        strikes++;
        ev.push({
          reservationId: r.id,
          type: 'EXPIRED',
          fromStatus: 'HELD',
          toStatus: 'EXPIRED',
          actorRole: 'SYSTEM',
          createdAt: expiresAt,
        });
        ev.push({
          reservationId: r.id,
          type: 'NO_SHOW_COUNTED',
          actorRole: 'SYSTEM',
          createdAt: expiresAt,
        });
      }
      await prisma.reservationEvent.createMany({ data: ev });
      await prisma.dealEvent.create({
        data: {
          type:
            s.status === 'REDEEMED'
              ? 'RESERVATION_REDEEMED'
              : s.status === 'CANCELLED'
                ? 'RESERVATION_CANCELLED'
                : 'RESERVATION_EXPIRED',
          productType: 'HOT',
          dealId: deal.id,
          merchantOrgId: orgId,
          branchId: branch.id,
          userId,
          anonymousId: `user:${userId}`.slice(0, 64),
          occurredAt: s.status === 'REDEEMED' ? r.redeemedAt! : expiresAt,
        },
      });
      await prisma.dealEvent.create({
        data: {
          type: 'RESERVATION_CREATED',
          productType: 'HOT',
          dealId: deal.id,
          merchantOrgId: orgId,
          branchId: branch.id,
          userId,
          anonymousId: `user:${userId}`.slice(0, 64),
          occurredAt: createdAt,
        },
      });
    }
    void strikes;

    // synthetic discovery signals so the funnel is not empty on live and finished deals
    if (['LIVE', 'SOLD_OUT', 'PAUSED', 'EXPIRED'].includes(d.status)) {
      const rows: Prisma.DealEventCreateManyInput[] = [];
      const impressions = 40 + idx * 9;
      const details = Math.round(impressions * 0.35);
      for (let i = 0; i < impressions; i++)
        rows.push({
          type: 'IMPRESSION',
          productType: 'HOT',
          dealId: deal.id,
          merchantOrgId: orgId,
          anonymousId: `seed-hot-${deal.id.slice(0, 8)}-i-${i}`,
          occurredAt: new Date(now - (i % 90) * MIN),
        });
      for (let i = 0; i < details; i++)
        rows.push({
          type: 'DETAIL_VIEW',
          productType: 'HOT',
          dealId: deal.id,
          merchantOrgId: orgId,
          branchId: orgBranches[i % orgBranches.length]!.id,
          anonymousId: `seed-hot-${deal.id.slice(0, 8)}-d-${i}`,
          occurredAt: new Date(now - (i % 80) * MIN),
        });
      await prisma.dealEvent.createMany({ data: rows });
    }

    // lifecycle history
    const t0 = submittedAt.getTime();
    const rows: Parameters<typeof history>[3] = [
      { action: 'CREATE', to: 'DRAFT', at: new Date(t0 - HOUR) },
    ];
    if (d.status !== 'DRAFT')
      rows.push({
        action: 'SUBMIT',
        from: 'DRAFT',
        to: 'PENDING_REVIEW',
        at: d.status === 'PENDING_REVIEW' ? new Date(now - 90 * MIN) : new Date(t0),
      });
    if (d.status === 'NEEDS_CHANGES')
      rows.push({
        action: 'REQUEST_CHANGES',
        from: 'PENDING_REVIEW',
        to: 'NEEDS_CHANGES',
        at: new Date(now - 30 * MIN),
        byDealDash: true,
        reason: d.feedback!.en,
        reasonAr: d.feedback!.ar,
        fields: ['terms'],
      });
    if (published)
      rows.push({
        action: 'APPROVE',
        from: 'PENDING_REVIEW',
        to: d.startHours > 0 ? 'SCHEDULED' : 'LIVE',
        at: new Date(t0 + 20 * MIN),
        byDealDash: true,
        reason: 'Offer is clear and limits are reasonable.',
        reasonAr: 'العرض واضح والحدود معقولة.',
      });
    if (published && d.startHours <= 0)
      rows.push({
        action: 'ACTIVATE',
        from: 'SCHEDULED',
        to: 'LIVE',
        at: new Date(Math.max(start.getTime(), t0 + 30 * MIN)),
      });
    if (d.status === 'SOLD_OUT')
      rows.push({ action: 'SOLD_OUT', from: 'LIVE', to: 'SOLD_OUT', at: new Date(now - 60 * MIN) });
    if (d.status === 'PAUSED')
      rows.push({
        action: 'PAUSE',
        from: 'LIVE',
        to: 'PAUSED',
        at: new Date(now - 45 * MIN),
        reason: 'Restocking',
      });
    if (d.status === 'EXPIRED')
      rows.push({ action: 'EXPIRE', from: 'LIVE', to: 'EXPIRED', at: end! });
    await history(deal.id, orgId, ownerInfo, rows);
  }

  // a sample customer with a temporary restriction, so Operations sees one in the restrictions list
  const flagged = customers[5];
  if (flagged && (await prisma.customerRestriction.count({ where: { userId: flagged } })) === 0)
    await prisma.customerRestriction.create({
      data: {
        userId: flagged,
        status: 'ACTIVE',
        reason: '3 reservations not completed within 30 days (development sample)',
        strikes: 3,
        startsAt: new Date(now - 2 * 86_400_000),
        endsAt: new Date(now + 5 * 86_400_000),
      },
    });
}
