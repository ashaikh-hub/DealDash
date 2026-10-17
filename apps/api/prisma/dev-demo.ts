/**
 * Development demo data (founder visual review 2026-10-16). Adds, to an EXISTING development database, enough live content for the
 * customer Home carousels to show their real density, using the seeded fictional demo merchants only:
 *  - Exclusive Deals: a PAID_RESERVATION deposit deal (credited to the bill), a PAID_RESERVATION full-prepayment deal (fixed price),
 *    a booking-fee deposit deal, and two FREE_RESERVATION deals (percentage off, free benefit) with generous limited stock;
 *  - Watch & Earn: live, funded campaigns (mock funding, the same ledger journal the Stage 6 seed writes), one of them with a real
 *    instant prize (FDR-19: 30 % win chance, 40 prizes, redeemed at the merchant) that the server draws against like any campaign.
 * Same patterns as the development seed (src/seed/stage4-seed.ts, stage6-seed.ts). Idempotent: an existing demo item (matched by
 * title) only has its end time extended. Every item is marked as development data (terms / description "Development demo", seed
 * placeholder media, history reason). It never creates, changes or resets a user, a password or any other business data, and it
 * refuses to run outside development.
 *
 *   pnpm --filter @dealdash/api db:dev:demo      (DATABASE_URL from the repo-root .env)
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { hotDealContentSchema, watchContentSchema } from '@dealdash/validation';
import { loadDotEnv, loadEnv } from '../src/common/env';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';
import { denormalizeHot } from '../src/hot-deals/hot-content';
import { EligibilityService } from '../src/live-deals/eligibility.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { makeDevImagePng, type Rgb } from '../src/seed/png';
import { denormalizeWatch } from '../src/watch/watch-content';

const DAY = 86_400_000;
const MIN = 60_000;
/** The Stage 6 seed's mock rate card and currency (the Riyadh demo merchants are the KSA market fixture). */
const CHARGE = 100;
const WATCH_CURRENCY = 'SAR';
const bi = (en: string, ar: string) => ({ en, ar });
const DEMO_TERMS = bi(
  'Development demo offer. One per reservation. Not combinable with other offers.',
  'عرض تجريبي للتطوير. واحد لكل حجز. لا يُجمع مع عروض أخرى.',
);

interface HotDemo {
  branch: string;
  category: string;
  mechanic: 'PERCENTAGE_OFF' | 'AMOUNT_OFF' | 'EVERYDAY_PROMOTION';
  value: number | null;
  label: { en: string; ar: string };
  title: { en: string; ar: string };
  short: { en: string; ar: string };
  description: { en: string; ar: string };
  units: number;
  holdMinutes: number;
  commitment: Record<string, unknown> | null;
  palette: [Rgb, Rgb];
}

const HOT: HotDemo[] = [
  {
    // PAID_RESERVATION: refundable deposit, credited toward the final bill (kept from the first demo)
    branch: 'Harbour Grill Olaya',
    category: 'dining',
    mechanic: 'PERCENTAGE_OFF',
    value: 30,
    label: bi('30% off', 'خصم 30%'),
    title: bi('Weekend grill for two: 30% off', 'شواء نهاية الأسبوع لشخصين: خصم 30%'),
    short: bi('Limited tables · deposit secures yours', 'طاولات محدودة · العربون يضمن طاولتك'),
    description: bi(
      'Development demo. A mixed grill platter for two at 30% off. Pay a small deposit to secure a table; it comes off your bill.',
      'عرض تجريبي للتطوير. طبق مشويات مشكلة لشخصين بخصم 30%. ادفع عربوناً صغيراً لتضمن طاولتك، ويُخصم من فاتورتك.',
    ),
    units: 8,
    holdMinutes: 60,
    commitment: {
      method: 'DEPOSIT',
      amountMinor: 2_500,
      depositRefundable: true,
      depositLateRefund: false,
      depositCredited: true,
      cancelCutoffMinutes: 30,
      noShowRefundPercent: null,
    },
    palette: [
      [255, 122, 89],
      [88, 24, 69],
    ],
  },
  {
    // FREE_RESERVATION, percentage off, fresh stock for the free journey
    branch: 'Najd Kitchen Al Nakheel',
    category: 'dining',
    mechanic: 'PERCENTAGE_OFF',
    value: 25,
    label: bi('25% off', 'خصم 25%'),
    title: bi('Family kabsa night: 25% off', 'ليلة الكبسة العائلية: خصم 25%'),
    short: bi('Reserve free · limited platters', 'احجز مجاناً · أطباق محدودة'),
    description: bi(
      'Development demo. A family kabsa platter at 25% off. Reserve free and show your code at the branch.',
      'عرض تجريبي للتطوير. طبق كبسة عائلي بخصم 25%. احجز مجاناً واعرض الرمز في الفرع.',
    ),
    units: 40,
    holdMinutes: 45,
    commitment: { method: 'FREE' },
    palette: [
      [226, 120, 60],
      [90, 40, 30],
    ],
  },
  {
    // FREE_RESERVATION, free benefit
    branch: 'Daily Dose KAFD',
    category: 'cafes',
    mechanic: 'EVERYDAY_PROMOTION',
    value: null,
    label: bi('Free pastry', 'معجنات مجانية'),
    title: bi('Free pastry with any coffee', 'معجنات مجانية مع أي قهوة'),
    short: bi('Morning only · limited pastries', 'صباحاً فقط · كمية محدودة'),
    description: bi(
      'Development demo. Order any coffee and get a pastry free. Reserve free while pastries last.',
      'عرض تجريبي للتطوير. اطلب أي قهوة واحصل على معجنات مجاناً. احجز مجاناً حتى نفاد الكمية.',
    ),
    units: 25,
    holdMinutes: 30,
    commitment: { method: 'FREE' },
    palette: [
      [226, 170, 104],
      [74, 44, 32],
    ],
  },
  {
    // PAID_RESERVATION, full prepayment, fixed amount off
    branch: 'Najd Kitchen Al Nakheel',
    category: 'dining',
    mechanic: 'AMOUNT_OFF',
    value: 40,
    label: bi('SAR 40 off', 'خصم 40 ريال'),
    title: bi('Set lunch for two: SAR 40 off', 'غداء لشخصين: خصم 40 ريال'),
    short: bi('Prepay to secure · limited sittings', 'ادفع مسبقاً · جلسات محدودة'),
    description: bi(
      'Development demo. A set lunch for two with SAR 40 off. Prepay the offer price to secure one of the limited sittings.',
      'عرض تجريبي للتطوير. غداء لشخصين بخصم 40 ريال. ادفع سعر العرض مسبقاً لتضمن إحدى الجلسات المحدودة.',
    ),
    units: 10,
    holdMinutes: 90,
    commitment: {
      method: 'FULL_PREPAYMENT',
      amountMinor: 12_000,
      depositRefundable: null,
      cancelCutoffMinutes: 60,
      noShowRefundPercent: 50,
    },
    palette: [
      [200, 90, 40],
      [250, 190, 80],
    ],
  },
  {
    // PAID_RESERVATION, booking-fee deposit (not credited), refundable on any cancellation
    branch: 'Daily Dose KAFD',
    category: 'cafes',
    mechanic: 'PERCENTAGE_OFF',
    value: 40,
    label: bi('40% off', 'خصم 40%'),
    title: bi('Coffee tasting for two: 40% off', 'تذوق القهوة لشخصين: خصم 40%'),
    short: bi('Small booking fee · few seats', 'رسوم حجز صغيرة · مقاعد قليلة'),
    description: bi(
      'Development demo. A guided coffee tasting for two at 40% off. A small booking fee holds your seats.',
      'عرض تجريبي للتطوير. جلسة تذوق قهوة لشخصين بخصم 40%. رسوم حجز صغيرة تحفظ مقاعدك.',
    ),
    units: 6,
    holdMinutes: 60,
    commitment: {
      method: 'DEPOSIT',
      amountMinor: 1_000,
      depositRefundable: true,
      depositLateRefund: true,
      depositCredited: false,
      cancelCutoffMinutes: 30,
      noShowRefundPercent: null,
    },
    palette: [
      [140, 90, 60],
      [40, 24, 18],
    ],
  },
];

interface WatchDemo {
  key: string;
  branch: string;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  cta: { en: string; ar: string };
  palette: [Rgb, Rgb];
  /** Optional instant prize (FDR-19): a real configuration the server draws against (development demo stock). */
  prize?: Record<string, unknown>;
}
const WATCH: WatchDemo[] = [
  {
    key: 'demo-dose-pastry-prize',
    branch: 'Daily Dose KAFD',
    title: bi('Win a free pastry with your coffee', 'اربح معجنات مجانية مع قهوتك'),
    description: bi(
      'Development demo. Watch to earn your points; each qualified view also has a chance to win a free pastry.',
      'عرض تجريبي للتطوير. شاهد لتكسب نقاطك؛ ولكل مشاهدة مؤهلة فرصة للفوز بمعجنات مجانية.',
    ),
    cta: bi('Visit us', 'زرنا'),
    palette: [
      [226, 170, 104],
      [74, 44, 32],
    ],
    prize: {
      title: bi('Free pastry', 'معجنات مجانية'),
      kind: 'FREE_ITEM',
      inventory: 40,
      winProbabilityBps: 3_000,
      perCustomerLimit: 1,
      validityDays: 14,
      branchIds: [],
      unitValueMinor: 1_200,
      acknowledged: true,
    },
  },
  {
    key: 'demo-najd-kabsa',
    branch: 'Najd Kitchen Al Nakheel',
    title: bi('Najd Kitchen: how we make kabsa', 'مطبخ نجد: كيف نحضّر الكبسة'),
    description: bi(
      'Development demo. A short look inside our kitchen.',
      'عرض تجريبي للتطوير. نظرة قصيرة داخل مطبخنا.',
    ),
    cta: bi('See our offers', 'شاهد عروضنا'),
    palette: [
      [226, 120, 60],
      [90, 40, 30],
    ],
  },
  {
    key: 'demo-dose-latte',
    branch: 'Daily Dose KAFD',
    title: bi('Daily Dose: latte art in 15 seconds', 'ديلي دوز: فن اللاتيه في 15 ثانية'),
    description: bi(
      'Development demo. Our barista pours a rosetta.',
      'عرض تجريبي للتطوير. باريستا يرسم على اللاتيه.',
    ),
    cta: bi('Visit us', 'زرنا'),
    palette: [
      [226, 170, 104],
      [74, 44, 32],
    ],
  },
  {
    key: 'demo-harbour-dessert',
    branch: 'Harbour Grill Olaya',
    title: bi('Harbour Grill: dessert of the week', 'هاربر غريل: حلوى الأسبوع'),
    description: bi(
      'Development demo. This week’s dessert, plated.',
      'عرض تجريبي للتطوير. حلوى هذا الأسبوع.',
    ),
    cta: bi('See our offers', 'شاهد عروضنا'),
    palette: [
      [200, 90, 40],
      [250, 210, 150],
    ],
  },
];

async function main() {
  loadDotEnv();
  const env = loadEnv() as ReturnType<typeof loadEnv> & { NODE_ENV?: string; APP_ENV?: string };
  if (env.NODE_ENV === 'production' || (env.APP_ENV && env.APP_ENV !== 'development'))
    throw new Error('development demo data only: refusing to run outside development');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
  });
  const now = Date.now();
  const endAt = new Date(now + 14 * DAY);

  /** A development illustration (storage key "seed-": the customer app treats it as a development placeholder). */
  async function image(
    orgId: string,
    kind: string,
    name: string,
    palette: [Rgb, Rgb],
    seed: number,
  ) {
    const key = `merchants/${orgId}/${kind.toLowerCase()}/seed-${name}`;
    const data = makeDevImagePng(960, 600, palette[0], palette[1], seed);
    if (env.STORAGE_PROVIDER === 'local' && env.STORAGE_LOCAL_DIR) {
      const p = resolve(env.STORAGE_LOCAL_DIR, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    }
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
  const branchNamed = async (name: string) => {
    const b = await prisma.merchantBranch.findFirst({ where: { nameEn: name } });
    if (!b) throw new Error(`the development seed branch "${name}" was not found`);
    return b;
  };
  const ownerOf = async (orgId: string) =>
    (
      await prisma.organizationMembership.findFirst({
        where: { organizationId: orgId, role: { code: 'MERCHANT_OWNER' } },
      })
    )?.userId ?? null;

  try {
    // ---------------------------------------------------------------- Exclusive Deals
    const categories = new Map((await prisma.category.findMany()).map((c) => [c.code, c.id]));
    const eligibility = new EligibilityService(prisma as unknown as PrismaService);
    for (const [i, d] of HOT.entries()) {
      const branch = await branchNamed(d.branch);
      const orgId = branch.organizationId;
      const existing = await prisma.hotDeal.findFirst({
        where: { organizationId: orgId, titleEn: d.title.en },
      });
      if (existing) {
        const content = hotDealContentSchema.parse(existing.content);
        await prisma.hotDeal.update({
          where: { id: existing.id },
          data: {
            content: { ...content, endAt: endAt.toISOString() } as unknown as Prisma.InputJsonValue,
            endAt,
            status: 'LIVE',
          },
        });
        console.log(`exclusive deal present, end time extended: ${d.title.en}`);
        continue;
      }
      const owner = await ownerOf(orgId);
      if (!owner) throw new Error(`no merchant owner for "${d.branch}"`);
      const file = await image(orgId, 'DEAL_IMAGE', `demo-hot-${i}`, d.palette, 97 + i * 11);
      const content = hotDealContentSchema.parse({
        categoryId: categories.get(d.category),
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
        limitType: 'TIME_AND_QUANTITY',
        reservationsEnabled: true,
        commitment: d.commitment ?? { method: null },
        allocations: [{ branchId: branch.id, units: d.units }],
        perCustomerLimit: 1,
        holdMinutes: d.holdMinutes,
        startAt: new Date(now - 60 * MIN).toISOString(),
        endAt: endAt.toISOString(),
        eligibility: { kind: 'PUBLIC', valueRefs: [] },
        commercial: { maxRedemptions: d.units },
        terms: { textEn: DEMO_TERMS.en, textAr: DEMO_TERMS.ar },
      });
      const ruleSetId = await eligibility.syncRuleSet(
        prisma as unknown as Prisma.TransactionClient,
        null,
        orgId,
        content.eligibility,
      );
      const deal = await prisma.hotDeal.create({
        data: {
          organizationId: orgId,
          status: 'LIVE',
          content: content as unknown as Prisma.InputJsonValue,
          ...denormalizeHot(content),
          eligibilityRuleSetId: ruleSetId,
          submittedAt: new Date(now - 120 * MIN),
          publishedAt: new Date(now - 60 * MIN),
          createdByUserId: owner,
          updatedByUserId: owner,
        },
      });
      await prisma.hotDealInventory.create({
        data: {
          dealId: deal.id,
          branchId: branch.id,
          tracked: true,
          total: d.units,
          available: d.units,
          redeemed: 0,
          released: 0,
        },
      });
      await prisma.hotDealHistory.create({
        data: {
          dealId: deal.id,
          action: 'APPROVE',
          fromStatus: 'PENDING_REVIEW',
          toStatus: 'LIVE',
          reason: 'Development demo for the founder visual review.',
          fields: [] as Prisma.InputJsonValue,
          actorRole: 'SYSTEM',
          actorName: 'Development demo',
          byDealDash: true,
        },
      });
      console.log(`exclusive deal created: ${d.title.en}`);
    }

    /**
     * Mock funding: the same balanced journal the Stage 6 seed writes (no real money). Idempotent per campaign: a campaign that
     * already has its funding is left alone; the reference is unique per campaign.
     */
    async function ensureFunded(campaignId: string, orgId: string, owner: string, funded: number) {
      if (funded <= 0) return;
      if (await prisma.watchFunding.count({ where: { campaignId } })) return;
      const fundKey = `dev-demo:fund:${campaignId}`;
      await prisma.$transaction(async (tx) => {
        const account = async (family: string, org: string | null) =>
          (await tx.ledgerAccount.findFirst({
            where: { family: family as never, organizationId: org, currency: WATCH_CURRENCY },
          })) ??
          tx.ledgerAccount.create({
            data: { family: family as never, organizationId: org, currency: WATCH_CURRENCY },
          });
        const j = await tx.ledgerJournal.create({
          data: {
            type: 'CAMPAIGN_FUNDING',
            currency: WATCH_CURRENCY,
            sourceType: 'WatchCampaign',
            sourceId: campaignId,
            idempotencyKey: fundKey,
            postedByRole: 'SEED',
          },
        });
        await tx.ledgerEntry.create({
          data: {
            journalId: j.id,
            accountId: (await account('PSP_CLEARING', null)).id,
            amountHalalas: funded,
          },
        });
        await tx.ledgerEntry.create({
          data: {
            journalId: j.id,
            accountId: (await account('CAMPAIGN_BUDGET', orgId)).id,
            amountHalalas: -funded,
          },
        });
        await tx.watchFunding.create({
          data: {
            campaignId,
            organizationId: orgId,
            currency: WATCH_CURRENCY,
            amountHalalas: funded,
            source: 'MOCK_PAYMENT',
            reference: `WF-DEMO-${campaignId.slice(-8).toUpperCase()}`,
            idempotencyKey: fundKey,
            journalId: j.id,
            createdByUserId: owner,
            createdByName: 'Development demo',
          },
        });
      });
    }

    // ---------------------------------------------------------------- Watch & Earn (live, funded with mock funding)
    const video = await prisma.storedFile.findFirst({
      where: { kind: 'WATCH_VIDEO', storageKey: { endsWith: '/seed-harbour-live.webm' } },
    });
    if (!video) throw new Error('the development seed video was not found (Stage 6 seed)');
    for (const [i, w] of WATCH.entries()) {
      const branch = await branchNamed(w.branch);
      const orgId = branch.organizationId;
      const existing = await prisma.watchCampaign.findFirst({
        where: { organizationId: orgId, titleEn: w.title.en },
      });
      const owner = await ownerOf(orgId);
      if (!owner) throw new Error(`no merchant owner for "${w.branch}"`);
      if (existing) {
        const content = watchContentSchema.parse(existing.content);
        await prisma.watchCampaign.update({
          where: { id: existing.id },
          data: {
            content: { ...content, endAt: endAt.toISOString() } as unknown as Prisma.InputJsonValue,
            endAt,
          },
        });
        // a campaign left without its mock funding by an interrupted earlier run is funded now (once)
        await ensureFunded(existing.id, orgId, owner, existing.fundedHalalas);
        console.log(`watch campaign present, end time extended: ${w.title.en}`);
        continue;
      }
      const thumb = await image(orgId, 'DEAL_IMAGE', w.key, w.palette, 140 + i * 13);
      const paidViews = 100;
      const funded = paidViews * CHARGE;
      const content = watchContentSchema.parse({
        title: w.title,
        description: w.description,
        ctaLabel: w.cta,
        link: { type: 'MERCHANT', id: null },
        videoFileId: video.id,
        thumbnailFileId: thumb.id,
        durationSec: 12,
        startAt: new Date(now - DAY).toISOString(),
        endAt: endAt.toISOString(),
        targeting: { cities: ['Riyadh'], eligibility: { kind: 'PUBLIC', valueRefs: [] } },
        paidViews,
        prize: w.prize ?? null,
      });
      const campaign = await prisma.watchCampaign.create({
        data: {
          organizationId: orgId,
          currency: WATCH_CURRENCY,
          status: 'LIVE',
          content: content as unknown as Prisma.InputJsonValue,
          ...denormalizeWatch(content),
          chargePerViewHalalas: CHARGE,
          rateCardVersion: 1,
          requiredBudgetHalalas: funded,
          fundedHalalas: funded,
          spentHalalas: 0,
          qualifiedViews: 0,
          unusedHalalas: 0,
          repeatWindowHours: 24,
          submittedAt: new Date(now - 2 * DAY),
          publishedAt: new Date(now - DAY),
          createdByUserId: owner,
          updatedByUserId: owner,
        },
      });
      await prisma.watchCampaignHistory.create({
        data: {
          campaignId: campaign.id,
          action: 'APPROVE' as never,
          fromStatus: 'PENDING_REVIEW',
          toStatus: 'LIVE',
          reason: 'Development demo for the founder visual review.',
          actorRole: 'SYSTEM',
          actorName: 'Development demo',
          byDealDash: true,
        },
      });
      await ensureFunded(campaign.id, orgId, owner, funded);
      console.log(`watch campaign created: ${w.title.en}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
