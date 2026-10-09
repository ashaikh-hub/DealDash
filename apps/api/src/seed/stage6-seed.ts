import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { WatchStatus } from '@dealdash/types';
import { watchContentSchema } from '@dealdash/validation';
import { type Prisma, type PrismaClient } from '../generated/prisma/client';
import { denormalizeWatch } from '../watch/watch-content';
import { makeDevImagePng, type Rgb } from './png';

export interface Stage6SeedInput {
  prisma: PrismaClient;
  organizations: Record<string, string>;
  storageDir?: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const bi = (en: string, ar: string) => ({ en, ar });
const CHARGE = 100; // mock rate card (halalas per qualified view)

type Org = 'merchantA' | 'merchantB' | 'najd' | 'bloom' | 'pulse' | 'page';
interface Seed {
  key: string;
  org: Org;
  status: WatchStatus;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  cta: { en: string; ar: string };
  link?: 'MERCHANT' | 'NONE';
  durationSec: number;
  paid: number;
  funded: number; // halalas
  qualified: number;
  startDays: number; // relative to now (negative = past)
  endDays: number;
  employerOnly?: boolean;
  pausedBy?: 'MERCHANT' | 'DEALDASH';
  feedback?: { en: string; ar: string };
  palette: [Rgb, Rgb];
}

const SEEDS: Seed[] = [
  {
    key: 'harbour-live',
    org: 'merchantA',
    status: 'LIVE',
    title: bi('Meet the chef: our weekend grill', 'تعرّف على الشيف: مشاوي نهاية الأسبوع'),
    description: bi(
      'A quick look at how our weekend grill platter is prepared.',
      'نظرة سريعة على كيفية تحضير طبق المشاوي لنهاية الأسبوع.',
    ),
    cta: bi('See our offers', 'شاهد عروضنا'),
    durationSec: 12,
    paid: 200,
    funded: 200 * CHARGE,
    qualified: 24,
    startDays: -5,
    endDays: 20,
    palette: [
      [200, 90, 40],
      [250, 190, 80],
    ],
  },
  {
    key: 'najd-nearly-done',
    org: 'najd',
    status: 'LIVE',
    title: bi('Najd Kitchen: the tasting evening', 'مطبخ نجد: أمسية التذوق'),
    description: bi(
      'Our roaster explains this month’s single-origin beans.',
      'محمّصنا يشرح حبوب هذا الشهر.',
    ),
    cta: bi('Visit us', 'زرنا'),
    durationSec: 12,
    paid: 10,
    funded: 10 * CHARGE,
    qualified: 8,
    startDays: -3,
    endDays: 10,
    palette: [
      [90, 60, 40],
      [200, 160, 110],
    ],
  },
  {
    key: 'bloom-employer',
    org: 'bloom',
    status: 'LIVE',
    title: bi('Bloom Beauty: a calm hour', 'بلوم بيوتي: ساعة هدوء'),
    description: bi(
      'A short tour of our relaxation rooms, for employer-programme members.',
      'جولة قصيرة في غرف الاسترخاء لأعضاء برنامج جهة العمل.',
    ),
    cta: bi('Learn more', 'اعرف المزيد'),
    durationSec: 12,
    paid: 100,
    funded: 100 * CHARGE,
    qualified: 3,
    startDays: -2,
    endDays: 14,
    employerOnly: true,
    palette: [
      [80, 140, 120],
      [220, 240, 230],
    ],
  },
  {
    key: 'pulse-scheduled',
    org: 'pulse',
    status: 'SCHEDULED',
    title: bi('Pulse Fitness: new year classes', 'بالس فتنس: حصص العام الجديد'),
    description: bi(
      'A preview of the classes starting next week.',
      'لمحة عن الحصص التي تبدأ الأسبوع القادم.',
    ),
    cta: bi('See classes', 'شاهد الحصص'),
    durationSec: 12,
    paid: 150,
    funded: 150 * CHARGE,
    qualified: 0,
    startDays: 3,
    endDays: 30,
    palette: [
      [40, 60, 140],
      [120, 160, 240],
    ],
  },
  {
    key: 'page-pending',
    org: 'page',
    status: 'PENDING_REVIEW',
    title: bi('Page & Co: staff picks', 'بيج آند كو: اختيارات الفريق'),
    description: bi(
      'Our staff share the books they loved this season.',
      'فريقنا يشارك الكتب التي أحبّها هذا الموسم.',
    ),
    cta: bi('Browse books', 'تصفّح الكتب'),
    durationSec: 12,
    paid: 80,
    funded: 80 * CHARGE,
    qualified: 0,
    startDays: 1,
    endDays: 21,
    palette: [
      [120, 70, 100],
      [230, 200, 220],
    ],
  },
  {
    key: 'harbour-changes',
    org: 'merchantA',
    status: 'NEEDS_CHANGES',
    title: bi('Harbour Grill: lunch menu', 'هاربر غريل: قائمة الغداء'),
    description: bi('A look at the new lunch menu.', 'نظرة على قائمة الغداء الجديدة.'),
    cta: bi('See the menu', 'شاهد القائمة'),
    durationSec: 12,
    paid: 60,
    funded: 60 * CHARGE,
    qualified: 0,
    startDays: 2,
    endDays: 16,
    feedback: bi(
      'The Arabic description needs to match the English one. Please check the opening hours shown in the video.',
      'يجب أن يطابق الوصف العربي الوصف الإنجليزي. يرجى مراجعة ساعات العمل الظاهرة في الفيديو.',
    ),
    palette: [
      [200, 90, 40],
      [250, 210, 150],
    ],
  },
  {
    key: 'najd-draft',
    org: 'najd',
    status: 'DRAFT',
    title: bi('Najd Kitchen: behind the kitchen door', 'مطبخ نجد: خلف باب المطبخ'),
    description: bi('', ''),
    cta: bi('', ''),
    durationSec: 12,
    paid: 50,
    funded: 0,
    qualified: 0,
    startDays: 4,
    endDays: 20,
    palette: [
      [90, 60, 40],
      [180, 140, 100],
    ],
  },
  {
    key: 'harbour-paused',
    org: 'merchantA',
    status: 'PAUSED',
    pausedBy: 'MERCHANT',
    title: bi('Harbour Grill: seafood night', 'هاربر غريل: ليلة المأكولات البحرية'),
    description: bi(
      'Join us for seafood night every Thursday.',
      'انضم إلينا لليلة المأكولات البحرية كل خميس.',
    ),
    cta: bi('Reserve', 'احجز'),
    durationSec: 12,
    paid: 120,
    funded: 120 * CHARGE,
    qualified: 31,
    startDays: -8,
    endDays: 12,
    palette: [
      [30, 90, 130],
      [150, 200, 230],
    ],
  },
  {
    key: 'bloom-suspended',
    org: 'bloom',
    status: 'SUSPENDED',
    title: bi('Bloom Beauty: weekend special', 'بلوم بيوتي: عرض نهاية الأسبوع'),
    description: bi('A weekend special at our studio.', 'عرض خاص لنهاية الأسبوع في الاستوديو.'),
    cta: bi('Learn more', 'اعرف المزيد'),
    durationSec: 12,
    paid: 90,
    funded: 90 * CHARGE,
    qualified: 12,
    startDays: -6,
    endDays: 9,
    palette: [
      [100, 120, 100],
      [210, 230, 210],
    ],
  },
  {
    key: 'pulse-completed',
    org: 'pulse',
    status: 'COMPLETED',
    title: bi('Pulse Fitness: first class free', 'بالس فتنس: الحصة الأولى مجانية'),
    description: bi('How your first class works.', 'كيف تعمل حصتك الأولى.'),
    cta: bi('Join', 'انضم'),
    durationSec: 12,
    paid: 40,
    funded: 40 * CHARGE,
    qualified: 40,
    startDays: -20,
    endDays: -2,
    palette: [
      [40, 60, 140],
      [140, 170, 240],
    ],
  },
  {
    key: 'page-expired',
    org: 'page',
    status: 'EXPIRED',
    title: bi('Page & Co: summer reading', 'بيج آند كو: قراءات الصيف'),
    description: bi('Summer reading picks.', 'اختيارات قراءة الصيف.'),
    cta: bi('Browse', 'تصفّح'),
    durationSec: 12,
    paid: 100,
    funded: 100 * CHARGE,
    qualified: 62,
    startDays: -30,
    endDays: -3,
    palette: [
      [150, 90, 60],
      [240, 210, 180],
    ],
  },
];

/** Sample redemption catalogue. Every item is flagged `isSample`: the real catalogue is a founder / operations decision (RW-06). */
const CATALOGUE = [
  { en: 'Sample: coffee voucher', ar: 'نموذج: قسيمة قهوة', cost: 30, stock: 50 },
  { en: 'Sample: dessert voucher', ar: 'نموذج: قسيمة حلوى', cost: 80, stock: 20 },
  { en: 'Sample: lunch voucher', ar: 'نموذج: قسيمة غداء', cost: 200, stock: 10 },
  { en: 'Sample: out-of-stock item', ar: 'نموذج: عنصر نفد من المخزون', cost: 150, stock: 0 },
];

async function sampleVideo(): Promise<Buffer | null> {
  const candidates = [
    resolve(process.cwd(), 'src/seed/fixtures/sample-video.webm'),
    resolve(process.cwd(), 'apps/api/src/seed/fixtures/sample-video.webm'),
  ];
  const p = candidates.find((c) => existsSync(c));
  return p ? readFile(p) : null;
}

/**
 * Stage 6 development data: Watch & Earn campaigns in every lifecycle state with consistent budgets and ledger journals, demo
 * views and rewards for the sample customers (earned, held, flagged), the sample reward catalogue and a risk case. The sample
 * video is a generated 12 s clip. Everything is clearly development data; no real money, provider or customer is involved.
 */
export async function seedStage6(input: Stage6SeedInput) {
  const { prisma, organizations } = input;
  if ((await prisma.watchCampaign.count()) > 0) return;
  const video = await sampleVideo();
  if (!video) return; // fixture missing: skip rather than seed unplayable campaigns
  const now = Date.now();
  const operations = await prisma.user.findUnique({ where: { email: 'operations@dealdash.test' } });
  const employerId = organizations.employer!;
  const customers: string[] = [];
  for (const mobile of [
    '+966500000001',
    '+966500000002',
    '+966500000400',
    '+966500000401',
    '+966500000402',
  ]) {
    const u = await prisma.user.findUnique({ where: { mobile } });
    if (u) customers.push(u.id);
  }
  if (!customers.length || !operations) return;

  async function store(orgId: string, kind: string, name: string, mime: string, data: Buffer) {
    const key = `merchants/${orgId}/${kind.toLowerCase()}/seed-${name}`;
    if (input.storageDir) {
      const p = resolve(input.storageDir, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, data);
    }
    const row = {
      organizationId: orgId,
      kind,
      originalName: name,
      mimeType: mime,
      declaredSize: data.length,
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      storageKey: key,
      status: 'AVAILABLE' as const,
      completedAt: new Date(),
    };
    return prisma.storedFile.upsert({ where: { storageKey: key }, update: row, create: row });
  }

  const account = async (tx: Prisma.TransactionClient, family: string, orgId: string | null) =>
    (await tx.ledgerAccount.findFirst({
      where: { family: family as never, organizationId: orgId },
    })) ?? tx.ledgerAccount.create({ data: { family: family as never, organizationId: orgId } });
  async function journal(
    type: 'CAMPAIGN_FUNDING' | 'CAMPAIGN_CONSUMPTION' | 'CAMPAIGN_RELEASE',
    key: string,
    sourceId: string,
    at: Date,
    lines: Array<{ family: string; org: string | null; amount: number }>,
  ) {
    return prisma.$transaction(async (tx) => {
      const j = await tx.ledgerJournal.create({
        data: {
          type,
          sourceType: 'WatchCampaign',
          sourceId,
          idempotencyKey: key,
          postedAt: at,
          postedByRole: 'SEED',
        },
      });
      for (const l of lines.filter((x) => x.amount !== 0))
        await tx.ledgerEntry.create({
          data: {
            journalId: j.id,
            accountId: (await account(tx, l.family, l.org)).id,
            amountHalalas: l.amount,
            createdAt: at,
          },
        });
      return j.id;
    });
  }

  // ---- reward ledger accumulators (cached balances are written from the same numbers as the entries)
  const balances = new Map<
    string,
    { available: number; held: number; earned: number; redeemed: number }
  >();
  const entries: Prisma.RewardEntryUncheckedCreateInput[] = [];
  const bal = (u: string) => {
    let b = balances.get(u);
    if (!b) balances.set(u, (b = { available: 0, held: 0, earned: 0, redeemed: 0 }));
    return b;
  };
  const accountIds = new Map<string, string>();
  async function accountOf(u: string) {
    let id = accountIds.get(u);
    if (!id) {
      id = (await prisma.rewardAccount.create({ data: { userId: u } })).id;
      accountIds.set(u, id);
    }
    return id;
  }
  async function credit(u: string, points: number, viewId: string, at: Date, held: boolean) {
    const b = bal(u);
    const accountId = await accountOf(u);
    if (held) {
      b.held += points;
      b.earned += points;
      entries.push({
        accountId,
        type: 'HOLD',
        bucket: 'HELD',
        points,
        availableAfter: b.available,
        heldAfter: b.held,
        sourceType: 'VIEW',
        sourceId: viewId,
        reasonCode: 'REVIEW_HOLD',
        idempotencyKey: `seed:reward:${viewId}:hold`,
        createdAt: at,
      });
    } else {
      b.available += points;
      b.earned += points;
      entries.push({
        accountId,
        type: 'EARN',
        bucket: 'AVAILABLE',
        points,
        availableAfter: b.available,
        heldAfter: b.held,
        sourceType: 'VIEW',
        sourceId: viewId,
        idempotencyKey: `seed:reward:${viewId}:earn`,
        createdAt: at,
      });
    }
  }

  let idx = 0;
  const campaignByKey = new Map<string, string>();
  for (const d of SEEDS) {
    idx++;
    const orgId = organizations[d.org];
    if (!orgId) continue;
    const owner = await prisma.organizationMembership.findFirst({
      where: { organizationId: orgId, role: { code: 'MERCHANT_OWNER' } },
    });
    if (!owner) continue;
    const vid = await store(orgId, 'WATCH_VIDEO', `${d.key}.webm`, 'video/webm', video);
    const thumb = await store(
      orgId,
      'DEAL_IMAGE',
      `${d.key}.png`,
      'image/png',
      makeDevImagePng(960, 600, d.palette[0], d.palette[1], 90 + idx * 7),
    );
    const startAt = new Date(now + d.startDays * DAY);
    const endAt = new Date(now + d.endDays * DAY);
    const content = watchContentSchema.parse({
      title: d.title,
      description: d.description,
      ctaLabel: d.cta,
      link: { type: d.link ?? 'MERCHANT', id: null },
      videoFileId: vid.id,
      thumbnailFileId: thumb.id,
      durationSec: d.durationSec,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      targeting: {
        cities: ['Riyadh'],
        eligibility: d.employerOnly
          ? { kind: 'EMPLOYER', valueRefs: [employerId] }
          : { kind: 'PUBLIC', valueRefs: [] },
      },
      paidViews: d.paid,
    });
    const spent = d.qualified * CHARGE;
    const final = ['COMPLETED', 'EXPIRED'].includes(d.status);
    const unused = final ? d.funded - spent : 0;
    const created = await prisma.watchCampaign.create({
      data: {
        organizationId: orgId,
        status: d.status,
        statusBeforeSuspension: d.status === 'SUSPENDED' ? 'LIVE' : null,
        pausedBy:
          d.status === 'PAUSED'
            ? (d.pausedBy ?? 'MERCHANT')
            : d.status === 'SUSPENDED'
              ? 'DEALDASH'
              : null,
        content: content as unknown as Prisma.InputJsonValue,
        ...denormalizeWatch(content),
        chargePerViewHalalas: CHARGE,
        rateCardVersion: 1,
        requiredBudgetHalalas: d.paid * CHARGE,
        fundedHalalas: d.funded,
        spentHalalas: spent,
        qualifiedViews: d.qualified,
        unusedHalalas: unused,
        closedOutAt: final ? new Date(now + d.endDays * DAY) : null,
        repeatWindowHours: 24,
        submittedAt: d.status === 'DRAFT' ? null : new Date(now - 6 * DAY),
        publishedAt: ['LIVE', 'PAUSED', 'SUSPENDED', 'COMPLETED', 'EXPIRED', 'SCHEDULED'].includes(
          d.status,
        )
          ? new Date(now - 7 * DAY)
          : null,
        endedAt: final ? new Date(now + d.endDays * DAY) : null,
        createdByUserId: owner.userId,
        updatedByUserId: owner.userId,
      },
    });
    campaignByKey.set(d.key, created.id);
    const hist = (
      action: string,
      from: WatchStatus | null,
      to: WatchStatus | null,
      at: Date,
      by: 'merchant' | 'admin' | 'system',
      reason?: string,
      reasonAr?: string,
    ) =>
      prisma.watchCampaignHistory.create({
        data: {
          campaignId: created.id,
          action: action as never,
          fromStatus: from,
          toStatus: to,
          reason: reason ?? null,
          reasonAr: reasonAr ?? null,
          actorUserId: by === 'system' ? null : by === 'admin' ? operations.id : owner.userId,
          actorRole:
            by === 'system' ? 'SYSTEM' : by === 'admin' ? 'DEALDASH_OPERATIONS' : 'MERCHANT_OWNER',
          actorName: by === 'system' ? null : by === 'admin' ? 'DealDash Operations' : 'Owner',
          byDealDash: by === 'admin',
          createdAt: at,
        },
      });
    await hist('CREATE', null, 'DRAFT', new Date(now - 7 * DAY), 'merchant');
    if (d.status !== 'DRAFT') {
      await hist('SUBMIT', 'DRAFT', 'PENDING_REVIEW', new Date(now - 6 * DAY), 'merchant');
      if (d.status === 'NEEDS_CHANGES')
        await hist(
          'REQUEST_CHANGES',
          'PENDING_REVIEW',
          'NEEDS_CHANGES',
          new Date(now - 2 * DAY),
          'admin',
          d.feedback?.en,
          d.feedback?.ar,
        );
      else if (d.status !== 'PENDING_REVIEW')
        await hist(
          'APPROVE',
          'PENDING_REVIEW',
          d.status === 'SCHEDULED' ? 'SCHEDULED' : 'LIVE',
          new Date(now - 5 * DAY),
          'admin',
          'Content and budget checked',
        );
    }
    if (d.status === 'PAUSED')
      await hist('PAUSE', 'LIVE', 'PAUSED', new Date(now - DAY), 'merchant');
    if (d.status === 'SUSPENDED')
      await hist(
        'SUSPEND',
        'LIVE',
        'SUSPENDED',
        new Date(now - DAY),
        'admin',
        'Policy review in progress',
        'مراجعة السياسة قيد التنفيذ',
      );
    if (d.status === 'COMPLETED')
      await hist(
        'COMPLETE',
        'LIVE',
        'COMPLETED',
        new Date(now + d.endDays * DAY),
        'system',
        'All paid views were delivered',
      );
    if (d.status === 'EXPIRED')
      await hist('EXPIRE', 'LIVE', 'EXPIRED', new Date(now + d.endDays * DAY), 'system');

    // ---- money: funding journal, consumption total, close-out release
    if (d.funded > 0) {
      const at = new Date(now - 6 * DAY);
      const jid = await journal('CAMPAIGN_FUNDING', `seed:fund:${created.id}`, created.id, at, [
        { family: 'PSP_CLEARING', org: null, amount: d.funded },
        { family: 'CAMPAIGN_BUDGET', org: orgId, amount: -d.funded },
      ]);
      await prisma.watchFunding.create({
        data: {
          campaignId: created.id,
          organizationId: orgId,
          amountHalalas: d.funded,
          source: 'MOCK_PAYMENT',
          reference: `WF-SEED${idx.toString().padStart(2, '0')}`,
          idempotencyKey: `seed:fund:${created.id}`,
          journalId: jid,
          createdByUserId: owner.userId,
          createdByName: 'Owner',
          createdAt: at,
        },
      });
    }
    if (spent > 0)
      await journal(
        'CAMPAIGN_CONSUMPTION',
        `seed:consume:${created.id}`,
        created.id,
        new Date(now - DAY),
        [
          { family: 'CAMPAIGN_BUDGET', org: orgId, amount: spent },
          { family: 'PLATFORM_REVENUE', org: null, amount: -spent },
        ],
      );
    if (unused > 0)
      await journal(
        'CAMPAIGN_RELEASE',
        `seed:release:${created.id}`,
        created.id,
        new Date(now + d.endDays * DAY),
        [
          { family: 'CAMPAIGN_BUDGET', org: orgId, amount: unused },
          { family: 'CAMPAIGN_UNUSED', org: orgId, amount: -unused },
        ],
      );

    // ---- demo views (qualified), spread over days and customers, with rewards
    const points = 20;
    for (let i = 0; i < d.qualified; i++) {
      const user = customers[i % customers.length]!;
      const at = new Date(now - (1 + (i % 5)) * DAY - HOUR + i * 60_000);
      const sample = d.key === 'harbour-live' && i === 0;
      const view = await prisma.watchView.create({
        data: {
          campaignId: created.id,
          userId: user,
          deviceHash: createHash('sha256').update(`seed-device:${user}`).digest('hex'),
          tokenHash: createHash('sha256').update(`seed-view:${created.id}:${i}`).digest('hex'),
          status: 'QUALIFIED',
          durationSec: d.durationSec,
          requiredSeconds: 10,
          watchedSeconds: d.durationSec,
          positionSec: d.durationSec,
          startedAt: at,
          lastEventAt: at,
          expiresAt: new Date(at.getTime() + 60_000),
          completedAt: at,
          qualifiedAt: at,
          chargeHalalas: CHARGE,
          rewardPoints: points,
          rewardState: 'EARNED',
          riskDecision: 'ALLOW',
          riskScore: 0,
          createdAt: at,
        },
      });
      // customers earn on the first views only (keeps the demo balances readable); the rest stay merchant-side history
      if (i < customers.length * 2 || sample) {
        await credit(user, points, view.id, at, false);
        await prisma.watchView.update({ where: { id: view.id }, data: { rewardState: 'EARNED' } });
      } else
        await prisma.watchView.update({
          where: { id: view.id },
          data: { rewardState: null, rewardPoints: 0 },
        });
    }
  }

  // ---- a held reward with an open risk case for the sample customer
  const harbour = campaignByKey.get('harbour-live');
  if (harbour) {
    const user = customers[0]!;
    const at = new Date(now - 4 * HOUR);
    const view = await prisma.watchView.create({
      data: {
        campaignId: harbour,
        userId: user,
        deviceHash: createHash('sha256').update('seed-device:shared').digest('hex'),
        tokenHash: createHash('sha256').update('seed-view:held').digest('hex'),
        status: 'QUALIFIED',
        durationSec: 12,
        requiredSeconds: 10,
        watchedSeconds: 12,
        positionSec: 12,
        startedAt: at,
        lastEventAt: at,
        expiresAt: new Date(at.getTime() + 60_000),
        completedAt: at,
        qualifiedAt: at,
        chargeHalalas: 0,
        rewardPoints: 20,
        rewardState: 'HELD',
        riskDecision: 'FLAG',
        riskScore: 65,
        riskSignals: [
          { code: 'DEVICE_SHARED_ACCOUNTS', weight: 40, detail: '3 accounts use this device' },
          {
            code: 'AUTOMATION_PATTERN',
            weight: 25,
            detail: 'Heartbeat spacing is unusually regular (3.1 ms)',
          },
        ],
        createdAt: at,
      },
    });
    await credit(user, 20, view.id, at, true);
    await prisma.riskFlag.create({
      data: {
        decision: 'FLAG',
        severity: 65,
        signals: [
          { code: 'DEVICE_SHARED_ACCOUNTS', weight: 40, detail: '3 accounts use this device' },
          {
            code: 'AUTOMATION_PATTERN',
            weight: 25,
            detail: 'Heartbeat spacing is unusually regular (3.1 ms)',
          },
        ],
        subjectUserId: user,
        subjectDeviceHash: createHash('sha256').update('seed-device:shared').digest('hex'),
        campaignId: harbour,
        viewId: view.id,
        createdAt: at,
      },
    });
  }

  // ---- flush reward accounts + entries + lots
  for (const [u, b] of balances) {
    const accountId = await accountOf(u);
    await prisma.rewardAccount.update({
      where: { id: accountId },
      data: {
        availableBalance: b.available,
        heldBalance: b.held,
        lifetimeEarned: b.earned,
        lifetimeRedeemed: b.redeemed,
      },
    });
  }
  for (const e of entries) {
    const row = await prisma.rewardEntry.create({ data: e });
    if (e.type === 'EARN')
      await prisma.rewardLot.create({
        data: {
          accountId: e.accountId,
          entryId: row.id,
          points: e.points,
          remaining: e.points,
          expiresAt: null,
        },
      });
  }

  // ---- sample catalogue
  for (const c of CATALOGUE)
    await prisma.rewardCatalogueItem.create({
      data: {
        nameEn: c.en,
        nameAr: c.ar,
        descriptionEn:
          'Sample reward for development. The real catalogue is configured by DealDash.',
        descriptionAr: 'مكافأة تجريبية للتطوير. يضبط فريق ديل داش الكتالوج الحقيقي.',
        pointsCost: c.cost,
        stock: c.stock,
        isSample: true,
        validityDays: 30,
        createdByUserId: operations.id,
      },
    });
}
